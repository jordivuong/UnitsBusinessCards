import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderCard } from './render.js';
import { renderBanner } from './banner.js';

/**
 * Aperçus (PNG rastérisés depuis le vrai PDF/X-3) de modèles et de cartes, mis en cache dans le dossier temporaire :
 * même contenu (modèle + valeurs) = même aperçu, sans régénération. Nettoyage au-delà de MAX entrées.
 */
const ROOT = path.join(os.tmpdir(), 'ubc-previews');
const MAX = 300;
const KEY = /^[a-f0-9]{24}$/;
export const isKey = (k) => KEY.test(k || '');

const SAMPLE = {
  nom: 'Jeanne Martin', titre: 'Directrice commerciale', telephone: '01 23 45 67 89',
  email: 'jeanne.martin@exemple.fr', site: 'www.exemple.fr',
};
export const sampleValues = (t) => Object.fromEntries(t.fields.map((f) => [f.name, String(f.sample ?? SAMPLE[f.name] ?? f.label).slice(0, f.maxChars)]));

// Au plus 2 rendus Ghostscript en parallèle (le serveur est petit).
let active = 0;
const queue = [];
function limited(fn) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      active++;
      try { resolve(await fn()); } catch (e) { reject(e); } finally { active--; queue.shift()?.(); }
    };
    active < 2 ? run() : queue.push(run);
  });
}

const inflight = new Map();
const keyOf = (t, values, scope) =>
  crypto.createHash('sha256').update(JSON.stringify([scope, t.id, t.profile, t.trim, t.bleed, t.palette, t.pages, t.formats, t.rev, values])).digest('hex').slice(0, 24);

function evict() {
  try {
    const dirs = fs.readdirSync(ROOT).map((n) => ({ n, t: fs.statSync(path.join(ROOT, n)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const d of dirs.slice(MAX)) fs.rmSync(path.join(ROOT, d.n), { recursive: true, force: true });
  } catch { /* nettoyage au mieux */ }
}

/** Renvoie { key, dir, files } (noms des PNG, une par page). Lève l'erreur de rendu (e.user pour un message client). */
export function previewFor(template, values, scope) {
  const key = keyOf(template, values, scope);
  const dir = path.join(ROOT, key), done = path.join(dir, 'done.json');
  if (fs.existsSync(done)) return Promise.resolve({ key, dir, files: JSON.parse(fs.readFileSync(done, 'utf8')) });
  if (!inflight.has(key)) {
    inflight.set(key, limited(async () => {
      fs.mkdirSync(dir, { recursive: true });
      try {
        let files;
        if (template.kind === 'digital') {
          files = [];
          for (const f of template.formats) {
            const out = await renderBanner(template, values, { format: f.id, scale: 1, type: 'png' });
            fs.writeFileSync(path.join(dir, `apercu-${f.id}.png`), out.buffer);
            files.push(`apercu-${f.id}.png`);
          }
        } else {
          files = (await renderCard(template, values, { dir, withMarks: false, logo: null, name: 'apercu' })).previews;
        }
        fs.writeFileSync(done, JSON.stringify(files));
        evict();
        return { key, dir, files };
      } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); throw e; }
    }).finally(() => inflight.delete(key)));
  }
  return inflight.get(key);
}

/** Fichier PNG d'un aperçu déjà généré (clé), ou null. */
export function previewFile(key, page) {
  if (!isKey(key) || !/^\d{1,2}$/.test(String(page))) return null;
  const dir = path.join(ROOT, key);
  try {
    const f = JSON.parse(fs.readFileSync(path.join(dir, 'done.json'), 'utf8'))[Number(page) - 1];
    return f ? path.join(dir, f) : null;
  } catch { return null; }
}
