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

export function validateTemplate(t, fontDirs = [config.fontsDir]) {
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
          t.builtin = root === config.clientsDir;
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
