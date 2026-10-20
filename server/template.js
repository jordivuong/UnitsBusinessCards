import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { PROFILES } from './profiles.js';

const MM = 72 / 25.4;
export const mm = (v) => v * MM;
export const SAFE_MM = 3;

const FORBIDDEN_KEYS = ['opacity', 'alpha', 'shadow', 'blendMode', 'rgb', 'hex'];

function fail(id, msg) {
  throw new Error(`Template ${id} : ${msg}`);
}

/** Modèle numérique (bannières) : formats HTML + champs texte ; les fichiers du package sont dans <id>.pkg/. */
function validateDigital(t) {
  const id = t.id || '(sans id)';
  if (!/^[a-z0-9-]+$/.test(t.id || '')) fail(id, 'id invalide');
  if (!Array.isArray(t.formats) || t.formats.length < 1 || t.formats.length > 12) fail(id, '1 à 12 formats attendus');
  const seen = new Set();
  for (const f of t.formats) {
    if (!/^[a-z0-9-]+$/.test(f.id || '') || seen.has(f.id)) fail(id, `format invalide : ${f.id}`);
    seen.add(f.id);
    if (!/^[A-Za-z0-9._-]+\.html$/i.test(f.file || '')) fail(id, `fichier de format invalide : ${f.file}`);
    if (!(Number.isInteger(f.w) && Number.isInteger(f.h) && f.w >= 16 && f.h >= 16 && f.w <= 4096 && f.h <= 4096)) fail(id, `taille invalide : ${f.id}`);
  }
  const names = new Set();
  for (const f of t.fields || []) {
    if (!/^[a-z0-9][a-z0-9_-]{0,30}$/.test(f.name || '') || names.has(f.name)) fail(id, `champ invalide : ${f.name}`);
    names.add(f.name);
  }
  t.fields = (t.fields || []).map((f) => ({ name: f.name, label: f.label || f.name, maxChars: f.maxChars || 80, optional: !!f.optional, sample: f.sample }));
  return t;
}

export function validateTemplate(t, fontDirs = [config.fontsDir]) {
  if (t.kind === 'digital') return validateDigital(t);
  const id = t.id || '(sans id)';
  if (!/^[a-z0-9-]+$/.test(t.id || '')) fail(id, 'id invalide');
  if (!(t.trim?.w > 0 && t.trim?.h > 0)) fail(id, 'format fini manquant');
  if (!(t.bleed >= 3)) fail(id, 'fonds perdus inférieurs à 3 mm');
  if (!PROFILES[t.profile]) fail(id, `profil inconnu (${t.profile})`);
  if (!Array.isArray(t.pages) || t.pages.length < 1 || t.pages.length > 2) fail(id, '1 ou 2 pages attendues');
  const tac = PROFILES[t.profile].tacMax;
  for (const [name, c] of Object.entries(t.palette || {})) {
    if (!Array.isArray(c) || c.length !== 4 || c.some((v) => !(v >= 0 && v <= 100))) fail(id, `couleur ${name} : CMJN 0-100 attendu`);
    if (c[0] + c[1] + c[2] + c[3] > tac) fail(id, `couleur ${name} : couverture d'encre ${c[0] + c[1] + c[2] + c[3]} % > ${tac} %`);
  }
  const W = t.trim.w, H = t.trim.h;
  const fieldNames = new Set();
  for (const page of t.pages) {
    for (const el of page.elements) {
      for (const k of FORBIDDEN_KEYS) if (k in el) fail(id, `propriété interdite : ${k}`);
      if (el.fill && !t.palette[el.fill]) fail(id, `couleur inconnue : ${el.fill}`);
      if (el.stroke && !t.palette[el.stroke]) fail(id, `couleur inconnue : ${el.stroke}`);
      if (el.type === 'path') {
        if (typeof el.d !== 'string' || !/^\s*[Mm]/.test(el.d) || el.d.length > 400_000 || !/^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]+$/.test(el.d)) fail(id, 'chemin vectoriel invalide');
        if (!t.palette[el.fill]) fail(id, `couleur inconnue : ${el.fill}`);
        if (!['evenodd', 'nonzero'].includes(el.rule)) fail(id, 'règle de remplissage invalide');
      }
      if (el.type === 'line' && !(el.width >= 0.25)) fail(id, 'filet de moins de 0,25 pt');
      if (el.type === 'text') {
        if (!fontPath(el.font, { fontDirs })) fail(id, `police introuvable : ${el.font}.otf (à placer dans le dossier fonts/ du client)`);
        if (!(el.minSize >= 6)) fail(id, 'corps minimum 6 pt');
        if (el.field) {
          if (fieldNames.has(el.field)) fail(id, `champ en double : ${el.field}`);
          fieldNames.add(el.field);
        }
      }
      if (el.type === 'image') {
        const inside = el.x >= SAFE_MM && el.y >= SAFE_MM && el.x + el.w <= W - SAFE_MM && el.y + el.h <= H - SAFE_MM;
        if (!inside) fail(id, 'emplacement de logo hors de la zone de sécurité');
        if (!t.palette[el.background]) fail(id, 'fond de référence du logo inconnu');
      }
    }
  }
  t.fields = [];
  for (const page of t.pages)
    for (const el of page.elements)
      if (el.type === 'text' && el.field)
        t.fields.push({ name: el.field, label: el.label || el.field, maxChars: el.maxChars || 60, optional: !!el.optional });
  return t;
}

/** Chemin d'une police (nom PostScript) : dossier fonts/ du client d'abord, puis polices partagées. */
export function fontPath(name, template) {
  if (!/^[A-Za-z0-9-]+$/.test(name || '')) return null;
  for (const dir of template.fontDirs) {
    const f = path.join(dir, `${name}.otf`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

export const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** Identifiants interdits pour un client : ils sont des chemins du site (cards.units.design/<client>). */
export const RESERVED_SLUGS = new Set(['api', 'admin', 'fonts', 'static', 'assets']);

const settingsFile = (slug) => path.join(config.adminDir, slug, 'settings.json');
/** Réglages d'un client gérés depuis l'Admin : { hidden: [id de modèles non proposés pour de nouvelles cartes] }. */
export function readSettings(slug) {
  try {
    const s = JSON.parse(fs.readFileSync(settingsFile(slug), 'utf8'));
    return { hidden: Array.isArray(s.hidden) ? s.hidden.filter((x) => typeof x === 'string') : [] };
  } catch { return { hidden: [] }; }
}
export function writeSettings(slug, settings) {
  fs.mkdirSync(path.dirname(settingsFile(slug)), { recursive: true });
  fs.writeFileSync(settingsFile(slug) + '.tmp', JSON.stringify(settings, null, 2) + '\n');
  fs.renameSync(settingsFile(slug) + '.tmp', settingsFile(slug));
}
/** Client défini dans le dépôt (clients/) : non supprimable depuis l'Admin. */
export const isBuiltinClient = (slug) => SLUG.test(slug || '') && fs.existsSync(path.join(config.clientsDir, slug));

let cache;
export const resetClients = () => { cache = undefined; };
export const clientFontDirs = (slug) => [path.join(config.adminDir, slug, 'fonts'), path.join(config.clientsDir, slug, 'fonts'), config.fontsDir];

/**
 * clients/<slug>/client.json + templates/*.json + fonts/*.otf, lus dans le dépôt (clients/, intégré, lecture seule)
 * puis dans le volume de données (Admin). Un modèle Admin invalide est ignoré (journalisé) au lieu d'empêcher le démarrage.
 */
export function loadClients() {
  if (cache) return cache;
  cache = new Map();
  const roots = [config.clientsDir, config.adminDir];
  const slugs = new Set();
  for (const root of roots)
    if (fs.existsSync(root))
      for (const s of fs.readdirSync(root)) if (SLUG.test(s) && fs.statSync(path.join(root, s)).isDirectory()) slugs.add(s);
  for (const slug of slugs) {
    let name = slug;
    const templates = new Map();
    const fontDirs = clientFontDirs(slug);
    const hidden = new Set(readSettings(slug).hidden);
    for (const root of roots) {
      const dir = path.join(root, slug);
      if (!fs.existsSync(dir)) continue;
      const meta = path.join(dir, 'client.json');
      if (fs.existsSync(meta)) name = JSON.parse(fs.readFileSync(meta, 'utf8')).name || name;
      const tdir = path.join(dir, 'templates');
      for (const f of fs.existsSync(tdir) ? fs.readdirSync(tdir).filter((n) => n.endsWith('.json')) : []) {
        try {
          const t = validateTemplate(JSON.parse(fs.readFileSync(path.join(tdir, f), 'utf8')), fontDirs);
          t.fontDirs = fontDirs;
          t.client = slug;
          if (t.kind === 'digital') {
            t.pkgDir = path.join(tdir, `${t.id}.pkg`);
            if (!fs.existsSync(t.pkgDir)) throw new Error('dossier du package introuvable');
          }
          t.builtin = root === config.clientsDir;
          t.hidden = hidden.has(t.id);
          templates.set(t.id, t);
        } catch (e) {
          if (root === config.clientsDir) throw e;
          console.error(`[admin] modèle ignoré ${slug}/${f} : ${e.message}`);
        }
      }
    }
    cache.set(slug, { slug, name, templates });
  }
  return cache;
}

export const getClient = (slug) => loadClients().get(slug);
export const getTemplate = (slug, id) => getClient(slug)?.templates.get(id);
