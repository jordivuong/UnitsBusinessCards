import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { userError } from './logo.js';

/**
 * Rendu des bannières : le package HTML/CSS du modèle est affiché dans Chromium (sans réseau, sans JavaScript du modèle),
 * les valeurs sont posées par le serveur (textContent : aucun HTML injectable), puis on capture une image.
 */
const ORIGIN = 'http://banner.local';
const MIME = {
  html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
};
const CSP = "default-src 'none'; img-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'none'; frame-src 'none'; connect-src 'none'";
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
export const chromePath = () => CHROME_CANDIDATES.find((p) => fs.existsSync(p)) || null;
export const MAX_PIXELS = 16_000_000;

// --- Navigateur partagé : lancé à la demande, fermé après une minute d'inactivité (mémoire du serveur).
let browserP = null, idleTimer = null, active = 0;
const waiting = [];
async function getBrowser() {
  if (!browserP) {
    const exe = chromePath();
    if (!exe) throw new Error('Chromium introuvable (CHROME_PATH).');
    browserP = puppeteer.launch({
      executablePath: exe, headless: true,
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars', '--font-render-hinting=none', '--disable-extensions', '--mute-audio'],
    }).then((b) => { b.on('disconnected', () => { browserP = null; }); return b; }, (e) => { browserP = null; throw e; });
  }
  return browserP;
}
function arm() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    if (active) return arm();
    const b = await browserP?.catch(() => null);
    browserP = null;
    await b?.close().catch(() => {});
  }, 60_000);
  idleTimer.unref();
}
// Au plus 2 pages à la fois.
async function slot(fn) {
  if (active >= 2) await new Promise((r) => waiting.push(r));
  active++;
  try { return await fn(); } finally { active--; waiting.shift()?.(); arm(); }
}

/** Un fichier du package, chemin relatif sans échappement ; null si absent ou interdit. */
function packageFile(root, rel) {
  const clean = path.posix.normalize('/' + decodeURIComponent(rel)).slice(1);
  if (!clean || clean.split('/').some((p) => p.startsWith('.'))) return null;
  const f = path.join(root, clean);
  if (!f.startsWith(root + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return null;
  return f;
}

/**
 * Rend un format (page HTML) du modèle avec les valeurs saisies.
 * Renvoie { buffer, type } ; lève une erreur utilisateur si un texte déborde.
 */
export async function renderBanner(template, values, { format, scale = 1, type = 'png', quality = 90 }) {
  const fmt = template.formats.find((f) => f.id === format) || template.formats[0];
  if (!fmt) throw userError('Aucun format dans ce modèle.');
  if (![1, 2].includes(scale)) throw userError('Échelle inconnue (1 ou 2).');
  if (!['png', 'jpeg', 'webp'].includes(type)) throw userError('Format de fichier inconnu (png, jpeg ou webp).');
  if (fmt.w * fmt.h * scale * scale > MAX_PIXELS) throw userError('Image trop grande (16 mégapixels maximum).');
  const root = template.pkgDir;

  return slot(async () => {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: fmt.w, height: fmt.h, deviceScaleFactor: scale });
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const u = req.url();
        if (u.startsWith('data:')) return req.continue();
        if (!u.startsWith(`${ORIGIN}/`)) return req.abort('blockedbyclient'); // aucun accès réseau
        const f = packageFile(root, new URL(u).pathname.slice(1));
        if (!f) return req.respond({ status: 404, body: 'not found' });
        const ext = path.extname(f).slice(1).toLowerCase();
        req.respond({ status: 200, contentType: MIME[ext] || 'application/octet-stream', headers: { 'Content-Security-Policy': CSP, 'Cache-Control': 'no-store' }, body: fs.readFileSync(f) });
      });
      await page.goto(`${ORIGIN}/${encodeURI(fmt.file)}`, { waitUntil: 'load', timeout: 20_000 });
      await page.addStyleTag({ content: `[hidden]{display:none!important} html,body{margin:0;padding:0;width:${fmt.w}px;height:${fmt.h}px;overflow:hidden}` });

      const result = await page.evaluate(async (fields, vals) => {
        const overflow = [];
        for (const f of fields) {
          for (const el of document.querySelectorAll(`[data-field="${f.name}"]`)) {
            const v = String(vals[f.name] ?? '');
            if (!v) { el.hidden = true; continue; }
            el.textContent = v;
          }
        }
        await document.fonts.ready;
        for (const el of document.querySelectorAll('[data-field][data-fit]')) {
          if (el.hidden) continue;
          let size = parseFloat(getComputedStyle(el).fontSize);
          const min = parseFloat(el.dataset.minSize || '') || size / 2;
          const over = () => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
          while (over() && size > min) { size -= 0.5; el.style.fontSize = `${size}px`; }
          if (over()) overflow.push(el.dataset.field);
        }
        return { overflow, fontsOk: [...document.fonts].every((f) => f.status === 'loaded' || f.status === 'unloaded') };
      }, template.fields, values);

      if (result.overflow.length) {
        const labels = result.overflow.map((n) => `« ${template.fields.find((f) => f.name === n)?.label || n} »`);
        throw userError(`Le texte ${labels.join(', ')} est trop long pour le format ${fmt.label} : raccourcissez-le.`);
      }
      const opts = { type, clip: { x: 0, y: 0, width: fmt.w, height: fmt.h }, captureBeyondViewport: false };
      if (type !== 'png') opts.quality = quality;
      return { buffer: Buffer.from(await page.screenshot(opts)), type };
    } finally {
      await page.close().catch(() => {});
    }
  });
}

export async function closeBrowser() {
  clearTimeout(idleTimer);
  const b = await browserP?.catch(() => null);
  browserP = null;
  await b?.close().catch(() => {});
}
