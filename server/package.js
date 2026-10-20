import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { parse } from 'node-html-parser';

/**
 * Package de modèle de bannière : un ZIP de fichiers HTML/CSS, images et polices.
 *  - chaque *.html à la racine est un FORMAT (une mise en page) ; sa taille : <meta name="banner:size" content="728x90">
 *  - les textes variables portent data-field="nom" (+ data-label, data-max, data-optional, data-sample, data-fit, data-min-size)
 * Voir docs/BANNIERES.md.
 */
export const LIMITS = { zipBytes: 25 * 1024 * 1024, totalBytes: 60 * 1024 * 1024, fileBytes: 12 * 1024 * 1024, files: 300, formats: 12 };
const ALLOWED = /\.(html|css|png|jpe?g|gif|webp|svg|woff2?|ttf|otf|json|txt)$/i;
const FIELD = /^[a-z0-9][a-z0-9_-]{0,30}$/;
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const FORBIDDEN_TAGS = new Set(['script', 'iframe', 'object', 'embed', 'base', 'form', 'input', 'button', 'textarea', 'select']);
const MEDIA_TAGS = new Set(['img', 'image', 'picture', 'video', 'svg']);
const userErr = (m) => Object.assign(new Error(m), { user: true });

/** Dézippe en mémoire avec des garde-fous (taille, nombre, chemins) ; renvoie Map(chemin → Uint8Array). */
export function unzipPackage(buf) {
  if (buf.length > LIMITS.zipBytes) throw userErr('ZIP trop volumineux (25 Mo maximum).');
  let total = 0, count = 0;
  let raw;
  try {
    raw = unzipSync(new Uint8Array(buf), {
      filter: (f) => {
        if (f.name.endsWith('/')) return false;
        if (++count > LIMITS.files) throw userErr(`Trop de fichiers (${LIMITS.files} maximum).`);
        if (f.originalSize > LIMITS.fileBytes) throw userErr(`« ${f.name} » dépasse 12 Mo.`);
        if ((total += f.originalSize) > LIMITS.totalBytes) throw userErr('Contenu du ZIP trop volumineux (60 Mo maximum décompressé).');
        return true;
      },
    });
  } catch (e) {
    if (e.user) throw e;
    throw userErr('Fichier ZIP illisible. Compressez le dossier du modèle (HTML, CSS, images, polices) en .zip.');
  }
  for (const n of Object.keys(raw)) if (n.split('/').includes('..') || n.startsWith('/') || n.includes('\\')) throw userErr(`Chemin interdit dans le ZIP : « ${n} ».`);
  const names = Object.keys(raw).filter((n) => !/(^|\/)(__MACOSX|\.[^/]*)(\/|$)/.test(n)); // fichiers cachés ignorés
  // Un dossier unique à la racine (zip macOS d'un dossier) : on le retire.
  const tops = new Set(names.map((n) => n.split('/')[0]));
  const strip = tops.size === 1 && names.every((n) => n.includes('/')) ? `${[...tops][0]}/` : '';
  const files = new Map();
  for (const n of names) {
    const rel = path.posix.normalize(n.slice(strip.length));
    if (!rel || rel.startsWith('..') || rel.startsWith('/')) throw userErr(`Chemin interdit dans le ZIP : « ${n} ».`);
    if (!ALLOWED.test(rel)) throw userErr(`Type de fichier non accepté : « ${rel} » (autorisés : html, css, png, jpg, gif, webp, svg, woff, woff2, ttf, otf, json, txt).`);
    files.set(rel, raw[n]);
  }
  return files;
}

const isExternal = (u) => /^(https?:)?\/\//i.test(u.trim()) || /^(javascript|file|ftp):/i.test(u.trim());
const urlsInCss = (css) => [
  ...[...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)].map((m) => m[2]),
  ...[...css.matchAll(/@import\s+(?:url\()?\s*['"]([^'"]+)['"]/gi)].map((m) => m[1]),
];

/**
 * Analyse et valide le package. Renvoie { template, errors, warnings } ; template = { kind, formats, fields, rev } (sans id ni nom).
 */
export function analyzePackage(files) {
  const errors = [], warnings = [];
  const htmlFiles = [...files.keys()].filter((n) => /^[A-Za-z0-9._-]+\.html$/i.test(n)).sort();
  if (!htmlFiles.length) return { template: null, errors: ['Aucun fichier .html à la racine du ZIP (ex. index.html ou 728x90.html).'], warnings };
  if (htmlFiles.length > LIMITS.formats) return { template: null, errors: [`Trop de formats (${LIMITS.formats} maximum).`], warnings };

  const exists = (from, ref) => {
    const clean = ref.split(/[?#]/)[0];
    if (!clean || clean.startsWith('data:')) return true;
    let dec = clean;
    try { dec = decodeURIComponent(clean); } catch { /* garde tel quel */ }
    return files.has(path.posix.normalize(path.posix.join(path.posix.dirname(from), dec)));
  };
  const checkCss = (from, css) => {
    for (const u of urlsInCss(css)) {
      if (u.startsWith('data:')) continue;
      if (isExternal(u)) errors.push(`${from} : ressource externe interdite (${u}). Mettez l'image ou la police dans le ZIP.`);
      else if (!exists(from, u)) errors.push(`${from} : fichier introuvable « ${u} ».`);
    }
  };
  for (const [name, data] of files) {
    if (/\.css$/i.test(name)) checkCss(name, strFromU8(data));
    if (/\.svg$/i.test(name) && /<script|\son\w+\s*=|javascript:|<foreignObject|href\s*=\s*["']?https?:/i.test(strFromU8(data))) {
      errors.push(`${name} : SVG avec script ou lien externe interdit.`);
    }
  }

  const formats = [], fields = new Map();
  for (const file of htmlFiles) {
    const root = parse(strFromU8(files.get(file)), { comment: false });
    const base = file.replace(/\.html$/i, '');
    const size = root.querySelector('meta[name="banner:size"]')?.getAttribute('content')?.trim().match(/^(\d{2,4})\s*[x×]\s*(\d{2,4})$/i);
    if (!size) { errors.push(`${file} : taille manquante. Ajoutez <meta name="banner:size" content="728x90"> dans <head>.`); continue; }
    const w = Number(size[1]), h = Number(size[2]);
    if (w < 16 || h < 16 || w > 4096 || h > 4096) { errors.push(`${file} : taille ${w}×${h} hors limites (16 à 4096 px).`); continue; }
    const id = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!ID.test(id) || formats.some((f) => f.id === id)) { errors.push(`${file} : nom de format invalide ou en double.`); continue; }
    const label = root.querySelector('meta[name="banner:label"]')?.getAttribute('content')?.trim().slice(0, 60) || `${base} (${w}×${h})`;
    formats.push({ id, file, w, h, label });

    for (const el of root.querySelectorAll('*')) {
      const tag = (el.tagName || '').toLowerCase();
      if (FORBIDDEN_TAGS.has(tag)) errors.push(`${file} : balise <${tag}> interdite.`);
      if (tag === 'meta' && /refresh/i.test(el.getAttribute('http-equiv') || '')) errors.push(`${file} : redirection <meta http-equiv="refresh"> interdite.`);
      for (const [attr, val] of Object.entries(el.attributes)) {
        const a = attr.toLowerCase();
        if (a.startsWith('on')) errors.push(`${file} : attribut ${attr} (JavaScript) interdit.`);
        else if (['src', 'href', 'poster', 'srcset', 'xlink:href'].includes(a)) {
          for (const u of String(val).split(',').map((p) => p.trim().split(/\s+/)[0]).filter(Boolean)) {
            if (u.startsWith('#') || u.startsWith('data:')) continue;
            if (isExternal(u)) errors.push(`${file} : ressource externe interdite (${u}).`);
            else if (!exists(file, u)) errors.push(`${file} : fichier introuvable « ${u} ».`);
          }
        } else if (a === 'style') checkCss(file, val);
      }
    }
    for (const st of root.querySelectorAll('style')) checkCss(file, st.text);

    for (const el of root.querySelectorAll('[data-field]')) {
      const name = (el.getAttribute('data-field') || '').trim();
      if (!FIELD.test(name)) { errors.push(`${file} : nom de champ invalide « ${name} » (a-z, 0-9, - et _).`); continue; }
      if (MEDIA_TAGS.has((el.tagName || '').toLowerCase())) {
        errors.push(`${file} : le champ « ${name} » est une image : seuls les champs de texte sont gérés pour l'instant (mettez les images fixes sans data-field).`);
        continue;
      }
      if (!fields.has(name)) {
        fields.set(name, {
          name, label: (el.getAttribute('data-label') || name).trim().slice(0, 60),
          maxChars: Math.min(500, Math.max(1, Number(el.getAttribute('data-max')) || 80)),
          optional: el.hasAttribute('data-optional'), sample: (el.getAttribute('data-sample') || '').slice(0, 200) || undefined,
        });
      }
    }
  }
  if (!fields.size && !errors.length) warnings.push('Aucun champ variable (data-field) : toutes les bannières seraient identiques.');
  if (errors.length) return { template: null, errors: [...new Set(errors)], warnings };

  const h = crypto.createHash('sha256');
  for (const n of [...files.keys()].sort()) { h.update(n); h.update(files.get(n)); }
  return { template: { kind: 'digital', formats, fields: [...fields.values()], rev: h.digest('hex').slice(0, 16) }, errors, warnings };
}

export function writePackage(dir, files) {
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [rel, data] of files) {
    const f = path.join(dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, data);
  }
}
