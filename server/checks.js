import fs from 'node:fs';
import zlib from 'node:zlib';
import { run } from './logo.js';

const TOL = 0.15; // pt

class CheckError extends Error {}
const bad = (msg) => { throw new CheckError(msg); };
export { CheckError };

function parseBox(out, name) {
  const m = out.match(new RegExp(`^${name}:\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)`, 'm'));
  return m ? m.slice(1, 5).map(Number) : null;
}

function sameBox(a, b) {
  return a && b && a.every((v, i) => Math.abs(v - b[i]) <= TOL);
}

/** Contenu décompressé de tous les flux du PDF (suffisant pour inspecter les opérateurs couleur). */
function contentStreams(buf) {
  const s = buf.toString('latin1');
  const out = [];
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endstream', start);
    if (end < 0) break;
    try {
      out.push(zlib.inflateSync(buf.subarray(start, end)).toString('latin1'));
    } catch { /* flux binaire (image, profil ICC) */ }
    re.lastIndex = end;
  }
  return out;
}

/**
 * Étape C : contrôles automatiques du PDF final. Lève CheckError (message français) au premier échec.
 * expected : { geometry, pages, palette (objet nom → [c,m,y,k]), withMarks }
 */
export async function checkPdf(file, expected) {
  const buf = fs.readFileSync(file);
  const raw = buf.toString('latin1');
  const warnings = [];

  const { out: info } = await run('pdfinfo', ['-box', file]);
  const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
  if (pages !== expected.pages) bad(`Nombre de pages inattendu (${pages}).`);
  const g = expected.geometry;
  if (!sameBox(parseBox(info, 'MediaBox'), g.media)) bad('Contrôle : MediaBox incorrecte.');
  if (!sameBox(parseBox(info, 'TrimBox'), g.trim)) bad('Contrôle : TrimBox (format fini) incorrecte.');
  const bleedExpected = expected.withMarks ? g.bleed : g.media;
  if (!sameBox(parseBox(info, 'BleedBox'), bleedExpected)) bad('Contrôle : BleedBox (fonds perdus) incorrecte.');

  const { out: fonts } = await run('pdffonts', [file]);
  const fontLines = fonts.trim().split('\n').slice(2).filter(Boolean);
  if (fontLines.length) bad('Contrôle : des polices ne sont pas vectorisées.');

  const { out: imgs } = await run('pdfimages', ['-list', file]);
  for (const line of imgs.trim().split('\n').slice(2).filter(Boolean)) {
    const cols = line.trim().split(/\s+/);
    // page num type width height color comp bpc enc interp object ID x-ppi y-ppi ...
    const color = cols[5], ppi = Math.min(Number(cols[12]), Number(cols[13]));
    if (color !== 'cmyk') bad(`Contrôle : image en espace « ${color} » (CMJN attendu).`);
    if (ppi < 150) bad(`Contrôle : image à ${ppi} ppi (minimum 150).`);
    if (ppi < 300) warnings.push(`Image à ${ppi} ppi (idéal 300).`);
  }

  if (!/^%PDF-1\.[34]/.test(raw)) bad('Contrôle : version PDF 1.3 ou 1.4 attendue.');
  if (!raw.includes('/GTS_PDFXVersion')) bad('Contrôle : marqueur PDF/X absent.');
  if (!/\/S\s*\/GTS_PDFX/.test(raw) || !raw.includes('/OutputIntents')) bad('Contrôle : OutputIntent PDF/X absent.');
  if (raw.includes('/SMask') || /\/Group\s*<</.test(raw) || /\/S\s*\/Transparency/.test(raw)) bad('Contrôle : transparence détectée (interdite en PDF/X-3).');
  if (/\/CA\s+[\d.]+|\/ca\s+[\d.]+/.test(raw) && /\/(CA|ca)\s+0?\.\d/.test(raw)) bad('Contrôle : opacité inférieure à 100 % détectée.');

  // Fidélité des couleurs : aucun RVB/gris, et chaque couleur CMJN est une couleur de la palette (ou le repérage des traits de coupe).
  const allowed = [...Object.values(expected.palette), [100, 100, 100, 100]];
  let colorOps = 0;
  for (const s of contentStreams(buf)) {
    if (/(^|\s)(rg|RG)(\s|$)/.test(s)) bad('Contrôle : couleur RVB détectée.');
    for (const m of s.matchAll(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+(k|K)(?=\s|$)/g)) {
      colorOps++;
      const v = m.slice(1, 5).map((x) => Number(x) * 100);
      if (!allowed.some((a) => a.every((c, i) => Math.abs(c - v[i]) < 0.6))) {
        bad(`Contrôle : couleur hors palette (C${v[0].toFixed(0)} M${v[1].toFixed(0)} J${v[2].toFixed(0)} N${v[3].toFixed(0)}).`);
      }
    }
  }
  if (!colorOps) bad('Contrôle : aucune couleur CMJN trouvée dans le PDF.');
  return { warnings };
}
