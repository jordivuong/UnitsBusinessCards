import express from 'express';
import multer from 'multer';
import { ZipArchive } from 'archiver';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config, ROOT } from './config.js';
import { loadClients, getClient, getTemplate, SAFE_MM, SLUG, RESERVED_SLUGS } from './template.js';
import { readCsv, sampleCsv } from './csv.js';
import { renderCard } from './render.js';
import { resolveProfile } from './profiles.js';
import { userError } from './logo.js';
import { adminRouter } from './admin.js';
import { listCards, getCard, createCard, updateCard, deleteCard, cleanValues, cardLabel } from './cards.js';
import { isAdmin, clientOf, checkLogin, makeSession, setCookie, sessionMaxAge, requireAuth, currentUser, loginLimiter } from './auth.js';

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
  const { email, password, client } = req.body || {};
  if (!checkLogin(email, password)) return res.status(401).json({ error: 'E-mail ou mot de passe incorrect.' });
  // Page d'un client (/<client>) : seuls les comptes de ce client (et les administrateurs) s'y connectent.
  if (client && clientOf(email) !== client && !isAdmin(email))
    return res.status(403).json({ error: "Ce compte n'est pas rattaché à ce client : utilisez l'adresse qui vous a été communiquée." });
  setCookie(res, makeSession(email), sessionMaxAge);
  res.json({ email: String(email).trim().toLowerCase() });
});
app.post('/api/logout', (req, res) => { setCookie(res, '', 0); res.json({ ok: true }); });
app.get('/api/me', (req, res) => {
  const email = currentUser(req);
  email ? res.json({ email, client: getClient(clientOf(email))?.name || null, clientSlug: clientOf(email) || null, admin: isAdmin(email) }) : res.status(401).json({ error: 'Non connecté.' });
});

// Nom d'un client pour sa page de connexion (aucune autre donnée).
app.get('/api/public/client/:slug', (req, res) => {
  const c = SLUG.test(req.params.slug) && !RESERVED_SLUGS.has(req.params.slug) ? getClient(req.params.slug) : null;
  c ? res.json({ slug: c.slug, name: c.name }) : res.status(404).json({ error: 'Client inconnu.' });
});

// --- Administration (modèles Figma, polices, clients, comptes)
app.use('/api/admin', adminRouter());

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

/** Génère les cartes de `rows` ({ line, values, cardId? }) et enregistre l'envoi (aperçus/PDF/ZIP) pendant jobTtlMs. */
async function runJob(user, template, rows, withMarks) {
  const t0 = Date.now();
  const id = crypto.randomBytes(16).toString('hex');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ubc-'));
  try {
    const cards = [], failed = [];
    let n = 0;
    for (const row of rows) {
      const name = `carte-${String(++n).padStart(2, '0')}-${slug(row.values.nom || row.values[template.fields[0].name])}`;
      try {
        const r = await renderCard(template, row.values, { dir, withMarks, logo: null, name });
        cards.push({ n, line: row.line, cardId: row.cardId, values: row.values, label: row.values.nom || name, pdf: r.pdf, previews: r.previews, warnings: r.warnings });
      } catch (e) {
        if (!e.user) console.error('[render]', e.message);
        failed.push({ line: row.line, cardId: row.cardId, label: row.values.nom || '', error: e.user ? e.message : 'Erreur interne lors de la génération.' });
      }
    }
    jobs.set(id, { dir, user, created: Date.now(), cards });
    console.log(`[job] ${id.slice(0, 8)} ${cards.length} ok, ${failed.length} erreurs, ${Date.now() - t0} ms`);
    return {
      id, withMarks, template: template.id, cards: cards.map((c) => ({ n: c.n, line: c.line, cardId: c.cardId, values: c.values, label: c.label, pages: c.previews.length, warnings: c.warnings })),
      failed, testProfile: (() => { try { return resolveProfile(template.profile).isTest; } catch { return null; } })(),
      geometry: { trim: template.trim, bleed: template.bleed, safe: SAFE_MM, marks: withMarks },
    };
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}
const fail = (res, e, tag) => {
  if (e.user) return res.status(422).json({ error: e.message });
  console.error(`[${tag}]`, e.message);
  res.status(500).json({ error: 'Erreur interne du serveur.' });
};

app.post('/api/jobs', requireAuth, upload.fields([{ name: 'csv', maxCount: 1 }]), async (req, res) => {
  try {
    const template = getTemplate(req.client, req.body?.templateId);
    if (!template) throw userError('Modèle introuvable.');
    const csvFile = req.files?.csv?.[0];
    if (!csvFile) throw userError('Ajoutez un fichier CSV.');
    if (csvFile.size > 1024 * 1024) throw userError('Le CSV est trop volumineux (1 Mo maximum).');
    const { rows, errors } = readCsv(csvFile.buffer, template, config.maxRows);
    if (errors.length) throw userError(errors.join(' '));
    const job = await runJob(req.user, template, rows, req.body.marks === '1');
    // Les cartes générées sont enregistrées : on les retrouve et on les modifie dans « Mes cartes ».
    for (const c of job.cards) {
      const saved = createCard(req.client, req.user, { templateId: template.id, values: c.values, label: cardLabel(template, c.values) });
      c.cardId = saved.id;
      jobs.get(job.id).cards.find((x) => x.n === c.n).cardId = saved.id;
    }
    res.json(job);
  } catch (e) { fail(res, e, 'jobs'); }
});

// --- Cartes enregistrées
const withTemplate = (client, card) => {
  const t = getTemplate(client, card.templateId);
  return { ...card, templateName: t?.name || card.templateId, available: !!t };
};
app.get('/api/cards', requireAuth, (req, res) => res.json(listCards(req.client).map((c) => withTemplate(req.client, c))));

app.delete('/api/cards/:id', requireAuth, (req, res) =>
  deleteCard(req.client, req.params.id) ? res.json({ ok: true }) : res.status(404).json({ error: 'Carte introuvable.' }));

/** Génère les PDF/aperçus de cartes enregistrées (ids) : ouverture, ou téléchargement groupé. */
app.post('/api/cards/render', requireAuth, async (req, res) => {
  try {
    const ids = [...new Set(Array.isArray(req.body?.ids) ? req.body.ids : [])].slice(0, config.maxRows);
    const saved = ids.map((id) => getCard(req.client, id)).filter(Boolean);
    if (!saved.length) throw userError('Aucune carte sélectionnée.');
    const tid = saved[0].templateId;
    if (saved.some((c) => c.templateId !== tid)) throw userError('Sélectionnez des cartes du même modèle.');
    const template = getTemplate(req.client, tid);
    if (!template) throw userError('Le modèle de ces cartes n\'est plus disponible.');
    res.json(await runJob(req.user, template, saved.map((c, i) => ({ line: i + 1, values: c.values, cardId: c.id })), req.body.marks === true));
  } catch (e) { fail(res, e, 'cards'); }
});

/** Modification des champs d'une carte : la carte n'est enregistrée que si la génération réussit. */
app.put('/api/cards/:id', requireAuth, async (req, res) => {
  try {
    const card = getCard(req.client, req.params.id);
    if (!card) return res.status(404).json({ error: 'Carte introuvable.' });
    const template = getTemplate(req.client, card.templateId);
    if (!template) throw userError('Le modèle de cette carte n\'est plus disponible.');
    const values = cleanValues(template, req.body?.values);
    const job = await runJob(req.user, template, [{ line: 1, values, cardId: card.id }], req.body?.marks === true);
    if (job.failed.length) throw userError(job.failed[0].error);
    updateCard(req.client, req.user, card.id, { values, label: cardLabel(template, values) });
    res.json(job);
  } catch (e) { fail(res, e, 'cards'); }
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

// cards.units.design/<client> : la même application, présentée pour ce client (la page lit l'adresse).
app.get(/^\/([a-z0-9][a-z0-9-]{0,39})\/$/, (req, res) => res.redirect(301, `/${req.params[0]}`));
app.get(/^\/([a-z0-9][a-z0-9-]{0,39})$/, (req, res) => {
  const slug = req.params[0];
  if (RESERVED_SLUGS.has(slug) || !getClient(slug)) return res.status(404).type('text').send('Page introuvable.');
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(ROOT, 'web', 'index.html'));
});

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
