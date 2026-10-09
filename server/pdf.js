import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import { mm, SAFE_MM, fontPath } from './template.js';
import { userError } from './logo.js';

const MARK_OFFSET_MM = 3.5;
const MARK_LEN_MM = 5;
const MARK_MARGIN_MM = 9;
const REGISTRATION = [100, 100, 100, 100];

/** Géométrie des boxes en points, origine en bas à gauche (espace PDF). */
export function geometry(template, withMarks) {
  const margin = mm(withMarks ? MARK_MARGIN_MM : template.bleed);
  const W = mm(template.trim.w), H = mm(template.trim.h), b = mm(template.bleed);
  return {
    margin, W, H, b,
    media: [0, 0, W + 2 * margin, H + 2 * margin],
    trim: [margin, margin, margin + W, margin + H],
    bleed: [margin - b, margin - b, margin + W + b, margin + H + b],
  };
}

/**
 * Étape A : PDF vectoriel en DeviceCMYK pur.
 * values : { champ: texte }, logo : { file, width, height } | null.
 * Renvoie { warnings, geometry } ; écrit le PDF dans outFile.
 */
export async function buildPdf(template, values, { withMarks, logo, outFile }) {
  const g = geometry(template, withMarks);
  const warnings = [];
  const doc = new PDFDocument({
    autoFirstPage: false, margin: 0, compress: true, pdfVersion: '1.3',
    info: { Title: template.id, Producer: 'UnitsBusinessCards', Creator: 'UnitsBusinessCards' },
  });
  const stream = fs.createWriteStream(outFile);
  const done = new Promise((res, rej) => { stream.on('finish', res); stream.on('error', rej); });
  doc.pipe(stream);

  const color = (name) => template.palette[name];
  const toPt = (xmm, ymm) => [g.margin + mm(xmm), g.margin + mm(ymm)]; // origine PDFKit : haut-gauche du média

  try {
    for (const page of template.pages) {
      doc.addPage({ size: [g.media[2], g.media[3]], margin: 0 });
      Object.assign(doc.page.dictionary.data, { TrimBox: g.trim, BleedBox: g.bleed });

      for (const el of page.elements) {
        if (el.type === 'rect') {
          const [x, y] = toPt(el.x, el.y);
          doc.rect(x, y, mm(el.w), mm(el.h)).fillColor(color(el.fill)).fill();
        } else if (el.type === 'line') {
          const [x1, y1] = toPt(el.x1, el.y1), [x2, y2] = toPt(el.x2, el.y2);
          doc.moveTo(x1, y1).lineTo(x2, y2).lineWidth(el.width).strokeColor(color(el.stroke)).stroke();
        } else if (el.type === 'text') {
          drawText(doc, template, el, values, toPt, color, warnings);
        } else if (el.type === 'image' && logo) {
          drawLogo(doc, el, logo, toPt, warnings);
        }
      }
      if (withMarks) drawMarks(doc, g);
    }
  } catch (e) {
    doc.end();
    await done.catch(() => {});
    throw e;
  }
  doc.end();
  await done;
  return { warnings, geometry: g };
}

function drawText(doc, template, el, values, toPt, color, warnings) {
  const raw = el.field ? values[el.field] ?? '' : el.text;
  const label = el.label || el.field;
  const text = String(raw).normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!text) {
    if (el.field && !el.optional) throw userError(`Le champ « ${label} » est obligatoire.`);
    return;
  }
  if (/[\u0000-\u001f\u007f]/.test(text)) throw userError(`Le champ « ${label} » contient des caractères invalides.`);
  if (el.maxChars && [...text].length > el.maxChars) {
    throw userError(`Le champ « ${label} » est trop long (${[...text].length} caractères, maximum ${el.maxChars}).`);
  }

  doc.font(fontPath(el.font, template));
  const missing = [...new Set([...text].filter((ch) => !doc._font.font.hasGlyphForCodePoint(ch.codePointAt(0))))];
  if (missing.length) throw userError(`Le champ « ${label} » contient des caractères absents de la police : ${missing.join(' ')}`);

  const spacing = el.letterSpacing || 0;
  const maxW = mm(el.maxW);
  let size = el.size;
  const width = (s) => doc.fontSize(s).widthOfString(text, { characterSpacing: spacing });
  while (width(size) > maxW && size - 0.25 >= el.minSize - 1e-9) size -= 0.25;
  if (width(size) > maxW) {
    throw userError(`Le champ « ${label} » est trop long pour la carte, même au corps minimum (${el.minSize} pt) : raccourcissez-le.`);
  }
  if (size < el.size) warnings.push(`« ${label} » réduit à ${size} pt pour tenir dans la carte.`);

  const w = width(size);
  const align = el.align || 'left';
  const xmm = align === 'left' ? el.x : align === 'right' ? el.x - w / mm(1) : el.x - w / mm(1) / 2;
  const h = doc.currentLineHeight(false);
  const wMm = w / mm(1), hMm = h / mm(1);
  const T = template.trim;
  if (xmm < SAFE_MM || xmm + wMm > T.w - SAFE_MM || el.y < SAFE_MM || el.y + hMm > T.h - SAFE_MM) {
    throw userError(`Le champ « ${label} » sortirait de la zone de sécurité (3 mm du bord).`);
  }
  const [x, y] = toPt(xmm, el.y);
  doc.fillColor(color(el.fill)).text(text, x, y, { lineBreak: false, characterSpacing: spacing });
}

function drawLogo(doc, el, logo, toPt, warnings) {
  const [x, y] = toPt(el.x, el.y);
  const w = mm(el.w), h = mm(el.h);
  const scale = Math.min(w / logo.width, h / logo.height); // pt par pixel
  const ppi = 72 / scale;
  if (ppi < 150) throw userError(`Logo trop petit : ${Math.round(ppi)} ppi au format imprimé (minimum 150, idéal 300).`);
  if (ppi < 300) warnings.push(`Logo à ${Math.round(ppi)} ppi : le rendu imprimé peut manquer de finesse (idéal 300 ppi).`);
  doc.image(logo.file, x, y, { fit: [w, h], align: 'center', valign: 'center' });
}

function drawMarks(doc, g) {
  const o = mm(MARK_OFFSET_MM), len = mm(MARK_LEN_MM);
  const [l, t, r, b] = [g.trim[0], g.media[3] - g.trim[3], g.trim[2], g.media[3] - g.trim[1]]; // haut-gauche
  doc.lineWidth(0.25).strokeColor(REGISTRATION);
  for (const [x, dx] of [[l, -1], [r, 1]]) {
    for (const [y, dy] of [[t, -1], [b, 1]]) {
      doc.moveTo(x + dx * o, y).lineTo(x + dx * (o + len), y).stroke(); // horizontal
      doc.moveTo(x, y + dy * o).lineTo(x, y + dy * (o + len)).stroke(); // vertical
    }
  }
}
