import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from './config.js';
import { SLUG, RESERVED_SLUGS, validateTemplate, loadClients, resetClients, getClient, clientFontDirs } from './template.js';
import { figmaToTemplate } from './figma.js';
import { renderCard } from './render.js';
import { addUser, requireAdmin } from './auth.js';

const ID = /^[a-z0-9-]{1,40}$/;
const FONT_FILE = /^[A-Za-z0-9-]{1,80}\.otf$/;

/** Lien Figma → { file, node }. Seul l'hôte figma.com est accepté ; l'API appelée est toujours api.figma.com. */
export function parseFigmaUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { return null; }
  if (u.protocol !== 'https:' || !/^(www\.)?figma\.com$/.test(u.hostname)) return null;
  const m = u.pathname.match(/^\/(?:design|file)\/([0-9a-zA-Z]{22,128})(?:\/branch\/([0-9a-zA-Z]{22,128}))?/);
  const node = u.searchParams.get('node-id');
  if (!m || !node || !/^\d+[:-]\d+$/.test(node)) return null;
  return { file: m[2] || m[1], node: node.replace('-', ':') };
}

const isModel = (n) => (n.children || []).some((c) => /^palette\b/i.test(c.name)) && (n.children || []).some((c) => /^page:/i.test(c.name));
/**
 * Un lien vers une page ou un grand cadre contient souvent le modèle (section avec « palette » et « page:recto ») :
 * on le retrouve s'il est unique (2 niveaux de profondeur), sinon on demande le lien de la section voulue.
 */
export function findModelRoot(root) {
  if (isModel(root)) return { node: root };
  const found = [];
  const walk = (n, depth) => { for (const c of n.children || []) { if (isModel(c)) found.push(c); else if (depth < 2) walk(c, depth + 1); } };
  walk(root, 0);
  if (found.length === 1) return { node: found[0] };
  if (found.length > 1) return { error: `Ce lien contient plusieurs modèles (${found.map((n) => `« ${n.name} »`).join(', ')}) : copiez le lien de la section voulue (clic droit sur la section → Copy link to selection).` };
  return { node: root };
}

const userErr = (message, status = 422) => Object.assign(new Error(message), { status });

async function fetchFigmaNode({ file, node }) {
  if (!config.figmaToken) throw userErr("Le jeton Figma n'est pas configuré sur le serveur (FIGMA_TOKEN).", 503);
  let r;
  try {
    r = await fetch(`https://api.figma.com/v1/files/${file}/nodes?ids=${encodeURIComponent(node)}`, {
      headers: { 'X-Figma-Token': config.figmaToken }, signal: AbortSignal.timeout(30_000),
    });
  } catch { throw userErr('Figma est injoignable (délai dépassé).', 502); }
  if (r.status === 403) throw userErr("Figma a refusé l'accès : jeton invalide ou sans accès à ce fichier.");
  if (r.status === 404) throw userErr('Fichier ou section Figma introuvable : vérifiez le lien.');
  if (!r.ok) throw userErr(`Figma a répondu ${r.status}.`, 502);
  const doc = Object.values((await r.json()).nodes || {})[0]?.document;
  if (!doc) throw userErr('Section introuvable dans le fichier Figma : copiez le lien de la section du modèle (clic droit → Copy link to selection).');
  return doc;
}

const SAMPLE = {
  nom: 'Jeanne Martin', titre: 'Directrice commerciale', telephone: '01 23 45 67 89',
  email: 'jeanne.martin@exemple.fr', site: 'www.exemple.fr',
};
const sampleValues = (t) => Object.fromEntries(t.fields.map((f) => [f.name, String(SAMPLE[f.name] ?? f.label).slice(0, f.maxChars)]));

const drafts = new Map(); // brouillons d'import, en mémoire + tmp, 30 min
function dropDraft(id) {
  const d = drafts.get(id);
  if (d) { fs.rmSync(d.dir, { recursive: true, force: true }); drafts.delete(id); }
}
setInterval(() => { for (const [id, d] of drafts) if (Date.now() - d.created > config.jobTtlMs) dropDraft(id); }, 60_000).unref();

const clientDir = (slug) => path.join(config.adminDir, slug);
const needClient = (slug) => {
  if (!SLUG.test(slug || '') || !getClient(slug)) throw userErr('Client inconnu.', 404);
  return slug;
};

export function adminRouter() {
  const r = express.Router();
  r.use(requireAdmin);
  const fontUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 12, fields: 2 } });
  const wrap = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      console.error('[admin]', e.message);
      res.status(500).json({ error: 'Erreur interne du serveur.' });
    }
  };

  r.get('/state', wrap((req, res) => {
    const clients = [...loadClients().values()].map((c) => {
      const fonts = new Set();
      for (const d of clientFontDirs(c.slug).slice(0, 2))
        if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) if (FONT_FILE.test(f)) fonts.add(f.replace(/\.otf$/, ''));
      return {
        slug: c.slug, name: c.name, fonts: [...fonts].sort(),
        templates: [...c.templates.values()].map((t) => ({ id: t.id, name: t.name, builtin: !!t.builtin, fields: t.fields.length })),
      };
    });
    res.json({ clients, figmaConfigured: !!config.figmaToken });
  }));

  r.post('/clients', wrap((req, res) => {
    const { slug, name } = req.body || {};
    if (!SLUG.test(slug || '') || !String(name || '').trim()) throw userErr('Identifiant (a-z, 0-9, tirets) et nom requis.');
    if (RESERVED_SLUGS.has(slug)) throw userErr('Cet identifiant est réservé : choisissez-en un autre.');
    if (getClient(slug)) throw userErr('Ce client existe déjà.');
    const dir = clientDir(slug);
    for (const d of ['templates', 'fonts']) fs.mkdirSync(path.join(dir, d), { recursive: true });
    fs.writeFileSync(path.join(dir, 'client.json'), JSON.stringify({ name: String(name).trim().slice(0, 80) }, null, 2) + '\n');
    resetClients();
    res.json({ ok: true });
  }));

  r.post('/fonts', fontUpload.array('fonts', 12), wrap((req, res) => {
    const slug = needClient(req.query.client);
    if (!req.files?.length) throw userErr('Ajoutez au moins un fichier .otf.');
    const dir = path.join(clientDir(slug), 'fonts');
    fs.mkdirSync(dir, { recursive: true });
    const saved = [];
    for (const f of req.files) {
      if (!FONT_FILE.test(f.originalname)) throw userErr(`« ${f.originalname} » : nommez le fichier d'après le nom PostScript de la police (ex. Inter-SemiBold.otf).`);
      const magic = f.buffer.subarray(0, 4).toString('latin1');
      if (magic !== 'OTTO' && magic !== '\0\x01\0\0') throw userErr(`« ${f.originalname} » n'est pas une police OpenType (.otf).`);
      fs.writeFileSync(path.join(dir, f.originalname), f.buffer);
      saved.push(f.originalname.replace(/\.otf$/, ''));
    }
    res.json({ saved });
  }));

  // Import depuis Figma : valide, rend une carte d'essai, garde un brouillon (rien n'est publié).
  r.post('/import', wrap(async (req, res) => {
    const { client, url, id, name } = req.body || {};
    const slug = needClient(client);
    if (!ID.test(id || '')) throw userErr('Identifiant du modèle : a-z, 0-9 et tirets.');
    const ref = parseFigmaUrl(url);
    if (!ref) throw userErr('Lien Figma invalide : collez le lien de la section (il doit contenir node-id=…).');
    const builtin = getClient(slug).templates.get(id)?.builtin;
    if (builtin) throw userErr('Cet identifiant est celui d\'un modèle intégré : choisissez-en un autre.');

    const picked = findModelRoot(await fetchFigmaNode(ref));
    if (picked.error) throw userErr(picked.error);
    const root = picked.node;
    const { template, errors, warnings } = figmaToTemplate(root, { id, name: String(name || id).trim().slice(0, 80) });
    if (!template) return res.status(422).json({ error: 'Le design Figma ne respecte pas les conventions.', problems: errors, warnings });
    const fontDirs = clientFontDirs(slug);
    try { validateTemplate(structuredClone(template), fontDirs); } catch (e) { return res.status(422).json({ error: e.message, problems: [], warnings }); }

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ubc-draft-'));
    try {
      const t = validateTemplate(structuredClone(template), fontDirs);
      t.fontDirs = fontDirs; t.client = slug;
      const withMarks = false;
      const out = await renderCard(t, sampleValues(t), { dir, withMarks, logo: null, name: 'apercu' });
      const draft = crypto.randomBytes(16).toString('hex');
      drafts.set(draft, { dir, created: Date.now(), client: slug, template, previews: out.previews });
      res.json({
        draft, template: { id, name: template.name, trim: template.trim, fields: t.fields.map((f) => f.label) },
        previews: out.previews.length, warnings: [...warnings, ...out.warnings], testProfile: out.testProfile,
      });
    } catch (e) {
      fs.rmSync(dir, { recursive: true, force: true });
      if (e.user) throw userErr(e.message);
      throw e;
    }
  }));

  r.get('/drafts/:id/preview/:page.png', wrap((req, res) => {
    const d = drafts.get(req.params.id);
    const f = d?.previews[Number(req.params.page) - 1];
    if (!f) return res.status(404).end();
    res.type('png').setHeader('Cache-Control', 'private, no-store');
    res.sendFile(path.join(d.dir, f));
  }));

  r.post('/drafts/:id/publish', wrap((req, res) => {
    const d = drafts.get(req.params.id);
    if (!d) throw userErr('Brouillon expiré : relancez l\'import.', 404);
    const dir = path.join(clientDir(d.client), 'templates');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${d.template.id}.json`);
    fs.writeFileSync(file + '.tmp', JSON.stringify(d.template, null, 2) + '\n');
    fs.renameSync(file + '.tmp', file);
    dropDraft(req.params.id);
    resetClients();
    loadClients();
    res.json({ ok: true, id: d.template.id });
  }));

  r.delete('/templates/:client/:id', wrap((req, res) => {
    const slug = needClient(req.params.client);
    if (!ID.test(req.params.id)) throw userErr('Identifiant invalide.');
    const t = getClient(slug).templates.get(req.params.id);
    if (!t) throw userErr('Modèle introuvable.', 404);
    if (t.builtin) throw userErr('Modèle intégré au dépôt : il ne se retire pas depuis cette page.');
    fs.rmSync(path.join(clientDir(slug), 'templates', `${req.params.id}.json`), { force: true });
    resetClients();
    res.json({ ok: true });
  }));

  r.post('/users', wrap((req, res) => {
    const { email, password, client } = req.body || {};
    needClient(client);
    try { addUser(email, password, client); } catch (e) { throw userErr(e.message); }
    res.json({ ok: true });
  }));

  return r;
}
