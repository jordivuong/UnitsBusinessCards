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
/** clients/<slug>/client.json + clients/<slug>/templates/*.json (+ clients/<slug>/fonts/*.otf). */
export function loadClients() {
  if (cache) return cache;
  cache = new Map();
  if (!fs.existsSync(config.clientsDir)) return cache;
  for (const slug of fs.readdirSync(config.clientsDir)) {
    const dir = path.join(config.clientsDir, slug);
    if (!SLUG.test(slug) || !fs.statSync(dir).isDirectory()) continue;
    const meta = fs.existsSync(path.join(dir, 'client.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'client.json'), 'utf8')) : {};
    const fontDirs = [path.join(dir, 'fonts'), config.fontsDir];
    const templates = new Map();
    const tdir = path.join(dir, 'templates');
    for (const f of fs.existsSync(tdir) ? fs.readdirSync(tdir).filter((n) => n.endsWith('.json')) : []) {
      const t = validateTemplate(JSON.parse(fs.readFileSync(path.join(tdir, f), 'utf8')), fontDirs);
      t.fontDirs = fontDirs;
      t.client = slug;
      templates.set(t.id, t);
    }
    cache.set(slug, { slug, name: meta.name || slug, templates });
  }
  return cache;
}

export const getClient = (slug) => loadClients().get(slug);
export const getTemplate = (slug, id) => getClient(slug)?.templates.get(id);
