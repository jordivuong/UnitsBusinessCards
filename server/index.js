import express from 'express';
import multer from 'multer';
import { ZipArchive } from 'archiver';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config, ROOT } from './config.js';
import { loadClients, getClient, getTemplate, SAFE_MM } from './template.js';
import { readCsv, sampleCsv } from './csv.js';
import { renderCard, prepareLogo } from './render.js';
import { resolveProfile } from './profiles.js';
import { sniff, userError } from './logo.js';
import { clientOf, checkLogin, makeSession, setCookie, sessionMaxAge, requireAuth, currentUser, loginLimiter } from './auth.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'");
  next();
});
app.use(express.json({ limit: '10kb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 2, fields: 10 },
});

/** Jobs en mémoire/tmp : aucune conservation au-delà de jobTtlMs. */
const jobs = new Map();
function dropJob(id) {
  const j = jobs.get(id);
  if (j) { fs.rmSync(j.dir, { recursive: true, force: true }); jobs.delete(id); }
}
setInterval(() => {
  for (const [id, j] of jobs) if (Date.now() - j.created > config.jobTtlMs) dropJob(id);
}, 60_000).unref();

// --- Authentification
app.post('/api/login', loginLimiter, (req, res) => {
  const { email, password } = req.body || {};
  if (!checkLogin(email, password)) return res.status(401).json({ error: 'E-mail ou mot de passe incorrect.' });
  setCookie(res, makeSession(email), sessionMaxAge);
  res.json({ email: String(email).trim().toLowerCase() });
});
app.post('/api/logout', (req, res) => { setCookie(res, '', 0); res.json({ ok: true }); });
app.get('/api/me', (req, res) => {
  const email = currentUser(req);
  email ? res.json({ email, client: getClient(clientOf(email))?.name || null }) : res.status(401).json({ error: 'Non connecté.' });
});

// --- Modèles
app.get('/api/templates', requireAuth, (req, res) => {
  res.json([...(getClient(req.client)?.templates.values() ?? [])].map((t) => ({
    id: t.id, name: t.name, trim: t.trim, bleed: t.bleed, safe: SAFE_MM,
    fields: t.fields, hasLogo: t.pages.some((p) => p.elements.some((e) => e.type === 'image')),
    testProfile: (() => { try { return resolveProfile(t.profile).isTest; } catch { return null; } })(),
  })));
});
app.get('/api/templates/:id/exemple.csv', requireAuth, (req, res) => {
  const t = getTemplate(req.client, req.params.id);
  if (!t) return res.status(404).json({ error: 'Modèle introuvable.' });
  res.type('text/csv; charset=utf-8').attachment(`exemple-${t.id}.csv`).send(sampleCsv(t));
});

// --- Génération
const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'carte';

app.post('/api/jobs', requireAuth, upload.fields([{ name: 'csv', maxCount: 1 }, { name: 'logo', maxCount: 1 }]), async (req, res) => {
  const t0 = Date.now();
  const id = crypto.randomBytes(16).toString('hex');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ubc-'));
  try {
    const template = getTemplate(req.client, req.body?.templateId);
    if (!template) throw userError('Modèle introuvable.');
    const csvFile = req.files?.csv?.[0];
    if (!csvFile) throw userError('Ajoutez un fichier CSV.');
    if (csvFile.size > 1024 * 1024) throw userError('Le CSV est trop volumineux (1 Mo maximum).');
    const withMarks = req.body.marks === '1';

    const { rows, errors } = readCsv(csvFile.buffer, template, config.maxRows);
    if (errors.length) throw userError(errors.join(' '));

    let logo = null;
    const logoFile = req.files?.logo?.[0];
    if (logoFile) {
      if (!sniff(logoFile.buffer)) throw userError('Le logo doit être un fichier PNG ou JPEG.');
      logo = await prepareLogo(template, logoFile.buffer, dir);
    }

    const cards = [], failed = [];
    let n = 0;
    for (const row of rows) {
      const name = `carte-${String(++n).padStart(2, '0')}-${slug(row.values.nom || row.values[template.fields[0].name])}`;
      try {
        const r = await renderCard(template, row.values, { dir, withMarks, logo, name });
        cards.push({ n, line: row.line, label: row.values.nom || name, pdf: r.pdf, previews: r.previews, warnings: r.warnings });
      } catch (e) {
        if (!e.user) console.error('[render]', e.message);
        failed.push({ line: row.line, label: row.values.nom || '', error: e.user ? e.message : 'Erreur interne lors de la génération.' });
      }
    }

    jobs.set(id, { dir, user: req.user, created: Date.now(), cards });
    console.log(`[job] ${id.slice(0, 8)} ${cards.length} ok, ${failed.length} erreurs, ${Date.now() - t0} ms`);
    res.json({
      id, withMarks, cards: cards.map((c) => ({ n: c.n, line: c.line, label: c.label, pages: c.previews.length, warnings: c.warnings })),
      failed, testProfile: (() => { try { return resolveProfile(template.profile).isTest; } catch { return null; } })(),
      geometry: { trim: template.trim, bleed: template.bleed, safe: SAFE_MM, marks: withMarks },
    });
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    if (e.user) return res.status(422).json({ error: e.message });
    console.error('[jobs]', e.message);
    res.status(500).json({ error: 'Erreur interne du serveur.' });
  }
});

function ownJob(req, res) {
  const j = jobs.get(req.params.id);
  if (!j || j.user !== req.user) { res.status(404).json({ error: 'Envoi introuvable ou expiré : recommencez la génération.' }); return null; }
  return j;
}
const card = (j, req) => j.cards.find((c) => c.n === Number(req.params.n));

app.get('/api/jobs/:id/cards/:n/preview/:page.png', requireAuth, (req, res) => {
  const j = ownJob(req, res); if (!j) return;
  const c = card(j, req); const f = c?.previews[Number(req.params.page) - 1];
  if (!f) return res.status(404).end();
  res.type('png').setHeader('Cache-Control', 'private, no-store');
  res.sendFile(path.join(j.dir, f));
});
app.get('/api/jobs/:id/cards/:n/pdf', requireAuth, (req, res) => {
  const j = ownJob(req, res); if (!j) return;
  const c = card(j, req); if (!c) return res.status(404).end();
  res.download(path.join(j.dir, c.pdf), c.pdf);
});
app.get('/api/jobs/:id/archive.zip', requireAuth, (req, res) => {
  const j = ownJob(req, res); if (!j) return;
  res.type('zip').attachment('cartes-de-visite-imprimeur.zip');
  const z = new ZipArchive({ zlib: { level: 6 } });
  z.on('error', () => res.destroy());
  z.pipe(res);
  for (const c of j.cards) z.file(path.join(j.dir, c.pdf), { name: c.pdf });
  z.finalize();
});

app.use(express.static(path.join(ROOT, 'web'), { index: 'index.html', setHeaders: (r) => r.setHeader('Cache-Control', 'no-cache') }));

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(422).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop volumineux (10 Mo maximum).' : 'Envoi invalide.' });
  console.error('[http]', err.message);
  res.status(500).json({ error: 'Erreur interne du serveur.' });
});

// Au démarrage : modèles valides et profil ICC présent (sinon refus, sauf mode test explicite).
try {
  for (const c of loadClients().values())
    for (const t of c.templates.values()) {
      const p = resolveProfile(t.profile);
      if (p.isTest) console.warn(`⚠ Profil ICC de TEST utilisé pour ${c.slug}/${t.id} : ne pas imprimer ces fichiers.`);
    }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
app.listen(config.port, () => console.log(`UnitsBusinessCards sur http://localhost:${config.port}`));
