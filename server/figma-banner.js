// Figma → package de bannière (HTML/CSS + images). Voir docs/BANNIERES.md.
//
// Principe « hybride » : le décor (tout ce qui n'est pas un champ) est exporté par Figma lui-même (SVG, ou PNG 2× si le calque
// contient des images/effets), et placé à sa position exacte ; seuls les textes `champ:…` deviennent de vrais textes HTML.
// Les conteneurs qui renferment un champ sont rendus en CSS (fond, dégradé, rayon, contour, ombre) pour pouvoir les traverser.
import fs from 'node:fs';
import { parseName } from './figma.js';

const r2 = (v) => Math.round(v * 100) / 100;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const rgba = (c, o = 1) => `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${r2((c.a ?? 1) * o)})`;
const CONTAINERS = new Set(['GROUP', 'FRAME', 'COMPONENT', 'INSTANCE', 'SECTION']);
const MAX_DECOR = 150;

export const isFormatFrame = (n) => /^format:/i.test(String(n.name || '')) && ['FRAME', 'COMPONENT', 'INSTANCE'].includes(n.type);
const isField = (n) => n.type === 'TEXT' && parseName(n.name).kind === 'champ';
const hasField = (n) => isField(n) || (n.children || []).some(hasField);
const skipped = (n) => n.visible === false || /^[_#]/.test(String(n.name));

/** Cadres « format:… » du lien : directs, ou dans un conteneur unique (2 niveaux). */
export function findFormatFrames(root) {
  if (isFormatFrame(root)) return { frames: [root] };
  const direct = (n) => (n.children || []).filter(isFormatFrame);
  if (direct(root).length) return { frames: direct(root) };
  const groups = [];
  const walk = (n, depth) => { for (const c of n.children || []) { if (direct(c).length) groups.push(c); else if (depth < 2) walk(c, depth + 1); } };
  walk(root, 0);
  if (groups.length === 1) return { frames: direct(groups[0]) };
  if (groups.length > 1) return { error: `Ce lien contient plusieurs ensembles de formats (${groups.map((g) => `« ${g.name} »`).join(', ')}) : copiez le lien de la section voulue.` };
  return { error: 'Aucun cadre « format:… » trouvé (nommez chaque taille de bannière par exemple « format:1200x628 »).' };
}

// --- Couleurs et fonds CSS
function gradientCss(fill, w, h, warn) {
  const o = fill.opacity ?? 1;
  const stops = fill.gradientStops || [];
  if (fill.type === 'GRADIENT_LINEAR') {
    const [a, b] = fill.gradientHandlePositions || [];
    if (!a || !b) return null;
    const p0 = { x: a.x * w, y: a.y * h }, p1 = { x: b.x * w, y: b.y * h };
    const L = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1, u = { x: (p1.x - p0.x) / L, y: (p1.y - p0.y) / L };
    const deg = (Math.atan2(u.y, u.x) * 180) / Math.PI + 90, rad = (deg * Math.PI) / 180;
    const Lcss = Math.abs(w * Math.sin(rad)) + Math.abs(h * Math.cos(rad)) || 1;
    const start = { x: w / 2 - (u.x * Lcss) / 2, y: h / 2 - (u.y * Lcss) / 2 };
    const t0 = (p0.x - start.x) * u.x + (p0.y - start.y) * u.y;
    return `linear-gradient(${r2(deg)}deg, ${stops.map((s) => `${rgba(s.color, o)} ${r2(((t0 + s.position * L) / Lcss) * 100)}%`).join(', ')})`;
  }
  if (fill.type === 'GRADIENT_RADIAL') {
    const [c, hx, hy] = fill.gradientHandlePositions || [];
    if (!c || !hx || !hy) return null;
    const rx = Math.hypot((hx.x - c.x) * w, (hx.y - c.y) * h), ry = Math.hypot((hy.x - c.x) * w, (hy.y - c.y) * h);
    return `radial-gradient(${r2(rx)}px ${r2(ry)}px at ${r2(c.x * w)}px ${r2(c.y * h)}px, ${stops.map((s) => `${rgba(s.color, o)} ${r2(s.position * 100)}%`).join(', ')})`;
  }
  warn(`dégradé « ${fill.type} » non reproduit en CSS : première couleur utilisée`);
  return stops[0] ? `linear-gradient(${rgba(stops[0].color, o)}, ${rgba(stops[0].color, o)})` : null;
}

/** Propriétés CSS de fond (liste de fills, du dessus vers le dessous) ; renvoie { css, images:[imageRef] }. */
function backgroundCss(node, w, h, warn, ctx) {
  const layers = [], sizes = [], repeats = [];
  for (const f of [...(node.fills || [])].reverse()) {
    if (f.visible === false) continue;
    if (f.type === 'SOLID') { const c = rgba(f.color, f.opacity ?? 1); layers.push(`linear-gradient(${c}, ${c})`); sizes.push('auto'); repeats.push('no-repeat'); }
    else if (f.type.startsWith('GRADIENT')) { const g = gradientCss(f, w, h, warn); if (g) { layers.push(g); sizes.push('auto'); repeats.push('no-repeat'); } }
    else if (f.type === 'IMAGE' && f.imageRef) {
      const file = ctx.imageAsset(f.imageRef);
      layers.push(`url(${file})`);
      sizes.push(f.scaleMode === 'FIT' ? 'contain' : f.scaleMode === 'STRETCH' ? '100% 100%' : f.scaleMode === 'TILE' ? 'auto' : 'cover');
      repeats.push(f.scaleMode === 'TILE' ? 'repeat' : 'no-repeat');
    } else warn(`remplissage « ${f.type} » non géré`);
  }
  if (!layers.length) return '';
  return `background-image:${layers.join(',')};background-size:${sizes.join(',')};background-repeat:${repeats.join(',')};background-position:center;`;
}

function boxCss(n, x, y, w, h, warn, ctx, { background = true } = {}) {
  let s = `position:absolute;left:${r2(x)}px;top:${r2(y)}px;width:${r2(w)}px;height:${r2(h)}px;box-sizing:border-box;`;
  if (background) s += backgroundCss(n, w, h, warn, ctx);
  const radii = n.rectangleCornerRadii || (n.cornerRadius ? [n.cornerRadius, n.cornerRadius, n.cornerRadius, n.cornerRadius] : null);
  if (radii?.some((v) => v > 0)) s += `border-radius:${radii.map((v) => `${r2(v)}px`).join(' ')};`;
  const stroke = (n.strokes || []).find((st) => st.visible !== false && st.type === 'SOLID');
  if (stroke && n.strokeWeight > 0) {
    if ((n.strokeDashes || []).length) warn('contour pointillé non reproduit');
    s += `border:${r2(n.strokeWeight)}px solid ${rgba(stroke.color, stroke.opacity ?? 1)};`;
  }
  const shadows = (n.effects || []).filter((e) => e.visible !== false && (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW'))
    .map((e) => `${e.type === 'INNER_SHADOW' ? 'inset ' : ''}${r2(e.offset?.x || 0)}px ${r2(e.offset?.y || 0)}px ${r2(e.radius || 0)}px ${r2(e.spread || 0)}px ${rgba(e.color)}`);
  if (shadows.length) s += `box-shadow:${shadows.join(',')};`;
  if ((n.effects || []).some((e) => e.visible !== false && /BLUR/.test(e.type))) warn('flou non reproduit sur un conteneur de champ');
  if ((n.opacity ?? 1) < 1) s += `opacity:${r2(n.opacity)};`;
  return s;
}

// --- Calques à exporter en image
const subtreeHas = (n, pred) => pred(n) || (n.children || []).some((c) => subtreeHas(c, pred));
const needsPng = (n) => subtreeHas(n, (m) =>
  m.visible !== false && (
    [...(m.fills || []), ...(m.strokes || [])].some((p) => p.visible !== false && (p.type === 'IMAGE' || p.type === 'GRADIENT_ANGULAR' || p.type === 'GRADIENT_DIAMOND'))
    || (m.effects || []).some((e) => e.visible !== false && /BLUR/.test(e.type)) || m.isMask
    || (m.blendMode && !['NORMAL', 'PASS_THROUGH'].includes(m.blendMode))));

const textCss = (n, w, h, tags, warn) => {
  const st = n.style || {};
  const fill = (n.fills || []).find((f) => f.visible !== false);
  let color = '#000';
  if (fill?.type === 'SOLID') color = rgba(fill.color, fill.opacity ?? 1);
  else if (fill?.type?.startsWith('GRADIENT') && fill.gradientStops?.[0]) { color = rgba(fill.gradientStops[0].color, fill.opacity ?? 1); warn('texte en dégradé : première couleur utilisée'); }
  const lh = st.lineHeightPx || (st.fontSize || 16) * 1.2;
  const wrap = h >= lh * 1.5;
  const align = { LEFT: 'left', CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'justify' }[st.textAlignHorizontal || 'LEFT'];
  const justify = { left: 'flex-start', center: 'center', right: 'flex-end', justify: 'flex-start' }[align];
  const items = { TOP: 'flex-start', CENTER: 'center', BOTTOM: 'flex-end' }[st.textAlignVertical || 'TOP'];
  let s = `font-family:"${st.fontFamily}",sans-serif;font-weight:${st.fontWeight || 400};font-style:${st.italic ? 'italic' : 'normal'};font-size:${r2(st.fontSize || 16)}px;`;
  s += `line-height:${r2(lh)}px;letter-spacing:${r2(st.letterSpacing || 0)}px;color:${color};text-align:${align};`;
  s += `display:flex;align-items:${items};justify-content:${justify};overflow:hidden;white-space:${wrap ? 'normal' : 'nowrap'};${wrap ? 'overflow-wrap:anywhere;' : ''}`;
  if (st.textCase === 'UPPER') s += 'text-transform:uppercase;'; else if (st.textCase === 'LOWER') s += 'text-transform:lowercase;'; else if (st.textCase === 'TITLE') s += 'text-transform:capitalize;';
  if (st.textDecoration === 'UNDERLINE') s += 'text-decoration:underline;'; else if (st.textDecoration === 'STRIKETHROUGH') s += 'text-decoration:line-through;';
  if ((n.opacity ?? 1) < 1) s += `opacity:${r2(n.opacity)};`;
  return s;
};

/**
 * Convertit les cadres de format en pages HTML. Pure (aucun réseau) :
 * renvoie { formats:[{id,label,w,h,html}], fonts:[{ps,family,weight,italic}], exports:[{id,file,format}], imageRefs:[{ref,file}], warnings, errors }.
 */
export function convertBanner(frames) {
  const errors = [], warnings = [];
  const formats = [], fonts = new Map(), exports = new Map(), images = new Map();
  const ids = new Set();

  for (const frame of frames) {
    const fb = frame.absoluteBoundingBox;
    const { key, tags } = parseName(frame.name.replace(/^format:/i, 'format:'));
    const w = Math.round(fb.width), h = Math.round(fb.height);
    const id = (key || `${w}x${h}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const label = tags.label && tags.label !== true ? tags.label : `${key || 'bannière'} (${w}×${h})`;
    const at = `format « ${frame.name} »`;
    if (!id || ids.has(id)) { errors.push(`${at} : identifiant en double ou vide.`); continue; }
    ids.add(id);
    if (Math.abs(frame.rotation || 0) > 1e-6) { errors.push(`${at} : rotation non gérée.`); continue; }

    const ctx = {
      imageAsset: (ref) => { const file = `assets/img-${ref.slice(0, 16)}.png`; images.set(ref, file); return file; },
    };
    const body = [];
    let decorCount = 0;
    const rel = (b) => ({ x: r2(b.x - fb.x), y: r2(b.y - fb.y), w: r2(b.width), h: r2(b.height) });

    const emit = (n) => {
      if (skipped(n)) return;
      const label2 = `« ${n.name} »`;
      const w2 = (m) => warnings.push(`${at}, ${label2} : ${m}.`);
      if (isField(n)) {
        const { key: fkey, tags: ft } = parseName(n.name);
        const b = n.absoluteBoundingBox, p = rel(b), st = n.style || {};
        if (!/^[a-z0-9][a-z0-9_-]{0,30}$/.test(fkey)) { errors.push(`${at}, ${label2} : nom de champ invalide (a-z, 0-9, - et _).`); return; }
        if (Math.abs(n.rotation || 0) > 1e-6) { errors.push(`${at}, ${label2} : texte pivoté non géré.`); return; }
        if (n.textAutoResize === 'WIDTH_AND_HEIGHT') { errors.push(`${at}, ${label2} : largeur automatique ; fixez la largeur de la zone de texte (elle définit la largeur maximale).`); return; }
        if (!st.fontFamily) { errors.push(`${at}, ${label2} : police inconnue.`); return; }
        const guessed = st.fontFamily && st.fontStyle ? `${st.fontFamily}-${st.fontStyle}`.replace(/\s+/g, '') : null;
        const ps = ft.font && ft.font !== true ? ft.font : st.fontPostScriptName || guessed;
        const fkeyFont = `${ps}|${st.fontFamily}|${st.fontWeight || 400}|${!!st.italic}`;
        if (ps) fonts.set(fkeyFont, { ps, family: st.fontFamily, weight: st.fontWeight || 400, italic: !!st.italic });
        const attrs = [`data-field="${esc(fkey)}"`, `data-label="${esc(ft.label && ft.label !== true ? ft.label : fkey)}"`];
        if (ft.max && ft.max !== true) attrs.push(`data-max="${esc(ft.max)}"`);
        if (ft.opt) attrs.push('data-optional');
        if (!ft.nofit) { attrs.push('data-fit'); const mn = ft.min && ft.min !== true ? Number(ft.min) : Math.max(8, Math.floor((st.fontSize || 16) * 0.5)); attrs.push(`data-min-size="${mn}"`); }
        const sample = ft.sample && ft.sample !== true ? ft.sample : n.characters;
        attrs.push(`data-sample="${esc(sample)}"`);
        const css = `position:absolute;left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;box-sizing:border-box;${textCss(n, p.w, p.h, ft, w2)}`;
        body.push(`    <div ${attrs.join(' ')} style="${esc(css)}">${esc(n.characters)}</div>`);
        return;
      }
      if (hasField(n)) { // conteneur d'un champ : son propre aspect en CSS, puis ses enfants dans l'ordre
        if (Math.abs(n.rotation || 0) > 1e-6) { errors.push(`${at}, ${label2} : conteneur de champ pivoté non géré.`); return; }
        if (n.type !== 'GROUP' && n.absoluteBoundingBox) {
          const p = rel(n.absoluteBoundingBox);
          const css = boxCss(n, p.x, p.y, p.w, p.h, w2, ctx);
          if (/background|border|shadow/.test(css)) body.push(`    <div style="${esc(css)}"></div>`);
        }
        for (const c of n.children || []) emit(c);
        return;
      }
      // Décor : exporté par Figma (SVG ou PNG 2×), placé à sa position exacte.
      const b = n.absoluteRenderBounds || n.absoluteBoundingBox;
      if (!b || !b.width || !b.height) return;
      if (++decorCount > MAX_DECOR) { if (decorCount === MAX_DECOR + 1) errors.push(`${at} : plus de ${MAX_DECOR} calques fixes : regroupez-les ou aplatissez-les dans Figma.`); return; }
      const fmt = needsPng(n) ? 'png' : 'svg';
      const file = `assets/${String(n.id).replace(/[^0-9A-Za-z]+/g, '-')}.${fmt}`;
      exports.set(n.id, { id: n.id, file, format: fmt });
      const p = rel(b);
      body.push(`    <img src="${file}" alt="" style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;">`);
    };
    for (const c of frame.children || []) emit(c);

    const bg = backgroundCss(frame, w, h, (m) => warnings.push(`${at} : ${m}.`), ctx);
    formats.push({
      id, label, w, h,
      html: `<!doctype html>\n<html lang="fr">\n<head>\n  <meta charset="utf-8">\n  <title>${esc(label)}</title>\n  <meta name="banner:size" content="${w}x${h}">\n  <meta name="banner:label" content="${esc(label)}">\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <div class="f" style="${esc(bg)}">\n${body.join('\n')}\n  </div>\n</body>\n</html>\n`,
    });
  }
  return { formats, fonts: [...fonts.values()], exports: [...exports.values()], imageRefs: [...images].map(([ref, file]) => ({ ref, file })), warnings, errors };
}

/** Feuille de style partagée : @font-face des polices embarquées + base des formats. */
export function bannerCss(fonts, fontFile) {
  const faces = fonts.map((f) => `@font-face { font-family: "${f.family}"; font-weight: ${f.weight}; font-style: ${f.italic ? 'italic' : 'normal'}; src: url(${fontFile(f)}); }`);
  return `/* Généré depuis Figma. Les calques fixes sont des images exportées par Figma ; les champs sont du texte. */\n${faces.join('\n')}\n* { box-sizing: border-box; }\nbody { background: #fff; }\n.f { position: relative; width: 100%; height: 100%; overflow: hidden; }\n`;
}

// --- Export réseau (API Figma) et assemblage du package ---------------------------------------------------------------

const MAX_ASSET = 12 * 1024 * 1024;
async function figmaGet(url, token, what) {
  let r;
  try { r = await fetch(url, { headers: { 'X-Figma-Token': token }, signal: AbortSignal.timeout(60_000) }); }
  catch { throw Object.assign(new Error(`Figma est injoignable (${what}).`), { user: true }); }
  if (r.status === 403) throw Object.assign(new Error("Figma a refusé l'accès : jeton invalide ou sans accès à ce fichier."), { user: true });
  if (r.status === 429) throw Object.assign(new Error('Figma limite le nombre de requêtes : réessayez dans une minute.'), { user: true });
  if (!r.ok) throw Object.assign(new Error(`Figma a répondu ${r.status} (${what}).`), { user: true });
  return r.json();
}
async function download(url, what) {
  let r;
  try { r = await fetch(url, { signal: AbortSignal.timeout(60_000) }); } catch { throw Object.assign(new Error(`Téléchargement impossible (${what}).`), { user: true }); }
  if (!r.ok) throw Object.assign(new Error(`Téléchargement impossible (${what}, ${r.status}).`), { user: true });
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_ASSET) throw Object.assign(new Error(`${what} dépasse 12 Mo : simplifiez ce calque.`), { user: true });
  return buf;
}

/**
 * Package complet depuis les cadres de format. findFont(postscriptName) → chemin du fichier de police ou null.
 * Renvoie { files: Map(chemin → Uint8Array), warnings, errors }.
 */
export async function exportBannerPackage(frames, { token, fileKey, findFont }) {
  const conv = convertBanner(frames);
  const warnings = [...conv.warnings];
  if (conv.errors.length) return { files: null, errors: conv.errors, warnings };

  const missing = [...new Set(conv.fonts.map((f) => f.ps).filter((ps) => !ps || !findFont(ps)))];
  if (missing.length) return { files: null, errors: [`Polices manquantes pour ce client : ${missing.map((m) => `${m}.otf`).join(', ')} — ajoutez-les dans « Polices » de sa fiche (.otf ou .ttf), puis relancez l'import.`], warnings };

  const enc = new TextEncoder();
  const files = new Map();
  for (const f of conv.fonts) files.set(`fonts/${f.ps}.otf`, new Uint8Array(fs.readFileSync(findFont(f.ps))));

  // Calques fixes : un appel par format d'image (svg 1×, png 2×), par lots.
  const byFormat = { svg: conv.exports.filter((e) => e.format === 'svg'), png: conv.exports.filter((e) => e.format === 'png') };
  for (const [format, list] of Object.entries(byFormat)) {
    for (let i = 0; i < list.length; i += 40) {
      const chunk = list.slice(i, i + 40);
      const q = new URLSearchParams({ ids: chunk.map((e) => e.id).join(','), format });
      if (format === 'png') q.set('scale', '2'); else { q.set('svg_outline_text', 'true'); q.set('svg_include_id', 'false'); }
      const out = await figmaGet(`https://api.figma.com/v1/images/${fileKey}?${q}`, token, "export des calques");
      if (out.err) throw Object.assign(new Error(`Export Figma refusé : ${out.err}`), { user: true });
      for (const e of chunk) {
        const url = out.images?.[e.id];
        if (!url) { warnings.push(`Le calque ${e.id} n'a pas pu être exporté par Figma (vide ?) : ignoré.`); files.set(e.file, enc.encode('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>')); continue; }
        const buf = await download(url, `calque ${e.id}`);
        if (format === 'svg' && !buf.subarray(0, 400).toString('utf8').includes('<svg')) throw Object.assign(new Error(`Export SVG invalide (calque ${e.id}).`), { user: true });
        files.set(e.file, new Uint8Array(buf));
      }
    }
  }
  // Images de fond (remplissages d'image des cadres et conteneurs de champs).
  if (conv.imageRefs.length) {
    const meta = (await figmaGet(`https://api.figma.com/v1/files/${fileKey}/images`, token, 'images du fichier')).meta?.images || {};
    for (const { ref, file } of conv.imageRefs) {
      if (!meta[ref]) { warnings.push(`Image de fond introuvable (${ref.slice(0, 8)}…).`); continue; }
      files.set(file, new Uint8Array(await download(meta[ref], 'image de fond')));
    }
  }
  files.set('style.css', enc.encode(bannerCss(conv.fonts, (f) => `fonts/${f.ps}.otf`)));
  for (const f of conv.formats) files.set(`${f.id}.html`, enc.encode(f.html));
  return { files, errors: [], warnings };
}
