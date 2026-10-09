// Conversion d'un arbre de nœuds Figma (API REST) en modèle JSON de l'app.
// Conventions : docs/FIGMA.md  (1 px Figma = 1 mm, y compris pour la taille de police ; couleurs CMJN dans le nom des calques).

const num = (v) => Math.round(v * 100) / 100;
const PT_PER_MM = 72 / 25.4;

/** "champ:nom label="Nom de famille" min=8 opt" → { kind, key, tags: {label, min, opt:true} } */
export function parseName(name) {
  const m = String(name).trim().match(/^([a-zé]+)(?::([\w-]+))?\s*(.*)$/i);
  if (!m) return { kind: '', key: '', tags: {} };
  const tags = {};
  for (const t of m[3].matchAll(/([\w-]+)(?:=(?:"([^"]*)"|(\S+)))?/g)) tags[t[1]] = t[2] ?? t[3] ?? true;
  return { kind: m[1].toLowerCase(), key: m[2] || '', tags };
}

const rgb = (c) => [c.r, c.g, c.b].map((v) => Math.round(v * 255));
const dist = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

/** Palette : rectangles du cadre « palette » nommés `encre = 0/0/0/100`. */
function readPalette(frame, errors) {
  const palette = {}, swatchRgb = {};
  for (const n of frame.children || []) {
    const m = String(n.name).match(/^([a-z0-9-]+)\s*=\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/);
    if (!m) { errors.push(`Palette : calque « ${n.name} » ignoré (format attendu : nom = C/M/J/N, ex. encre = 0/0/0/100).`); continue; }
    palette[m[1]] = m.slice(2, 6).map(Number);
    const f = solidFill(n);
    if (f) swatchRgb[m[1]] = rgb(f.color);
  }
  if (!Object.keys(palette).length) errors.push('Palette absente : ajoutez un cadre « palette » contenant les couleurs CMJN.');
  return { palette, swatchRgb };
}

function solidFill(n) {
  return (n.fills || []).find((f) => f.visible !== false && f.type === 'SOLID');
}

/** Couleur d'un élément : tag fill=/stroke= sinon pastille de palette la plus proche (à 8/255 près). */
function colorOf(n, tag, ctx, label) {
  const f = tag === 'stroke' ? (n.strokes || []).find((s) => s.visible !== false && s.type === 'SOLID') : solidFill(n);
  if (!f) { ctx.errors.push(`${label} : aucune couleur pleine.`); return null; }
  if ((f.opacity ?? 1) < 1 || (f.color.a ?? 1) < 1) ctx.errors.push(`${label} : opacité < 100 % interdite (transparence).`);
  const declared = ctx.tags[tag];
  const actual = rgb(f.color);
  if (declared && declared !== true) {
    if (!ctx.palette[declared]) { ctx.errors.push(`${label} : couleur « ${declared} » absente de la palette.`); return null; }
    const sw = ctx.swatchRgb[declared];
    if (sw && dist(sw, actual) > 40) ctx.warnings.push(`${label} : la couleur Figma diffère de la pastille « ${declared} » (aperçu seulement, le CMJN déclaré fait foi).`);
    return declared;
  }
  const near = Object.entries(ctx.swatchRgb).filter(([, s]) => dist(s, actual) <= 8).map(([k]) => k);
  if (near.length === 1) return near[0];
  ctx.errors.push(`${label} : couleur non déterminée, ajoutez ${tag}=<nom de palette>.`);
  return null;
}

/** Convertit un cadre de page (recto/verso) en liste d'éléments. */
function convertPage(frame, bleed, pal, errors, warnings) {
  const ox = frame.absoluteBoundingBox.x + bleed, oy = frame.absoluteBoundingBox.y + bleed;
  const elements = [];

  const walk = (nodes) => {
    for (const n of nodes || []) {
      if (n.visible === false) continue;
      const nm = String(n.name);
      if (nm.startsWith('_') || nm.startsWith('#')) continue; // notes du designer
      const label = `« ${nm} »`;
      const { kind, key, tags } = parseName(nm);
      const ctx = { errors, warnings, tags, ...pal };
      const b = n.absoluteBoundingBox;
      const x = b ? num(b.x - ox) : 0, y = b ? num(b.y - oy) : 0, w = b ? num(b.width) : 0, h = b ? num(b.height) : 0;

      if ((n.opacity ?? 1) < 1) errors.push(`${label} : opacité < 100 % interdite.`);
      if ((n.effects || []).some((e) => e.visible !== false)) errors.push(`${label} : effets (ombre, flou) interdits.`);
      if (n.blendMode && !['NORMAL', 'PASS_THROUGH'].includes(n.blendMode)) errors.push(`${label} : mode de fusion interdit.`);

      if (['GROUP', 'FRAME', 'SECTION', 'COMPONENT', 'INSTANCE'].includes(n.type)) { walk(n.children); continue; }

      if (n.type === 'RECTANGLE' && kind === 'logo') {
        const bg = tags.bg;
        elements.push({ type: 'image', x, y, w, h, background: bg === true ? undefined : bg });
        if (!bg || bg === true) errors.push(`${label} : ajoutez bg=<couleur de palette du fond derrière le logo>.`);
      } else if (n.type === 'RECTANGLE') {
        if ((n.strokes || []).some((s) => s.visible !== false)) errors.push(`${label} : contour non géré (utilisez un LINE ou un rectangle plein).`);
        const fill = colorOf(n, 'fill', ctx, label);
        if (fill) elements.push({ type: 'rect', x, y, w, h, fill });
      } else if (n.type === 'LINE') {
        const stroke = colorOf(n, 'stroke', ctx, label);
        const width = n.strokeWeight ?? 0;
        if (width < 0.25) errors.push(`${label} : filet de moins de 0,25 pt.`);
        if (h > 0.01 && w > 0.01) errors.push(`${label} : seuls les filets horizontaux ou verticaux sont gérés.`);
        if (stroke) elements.push({ type: 'line', x1: x, y1: y, x2: num(x + w), y2: num(y + h), width, stroke });
      } else if (n.type === 'TEXT') {
        const st = n.style || {};
        const font = tags.font && tags.font !== true ? tags.font : st.fontPostScriptName;
        if (!font) { errors.push(`${label} : police sans nom PostScript, ajoutez font=<NomPostScript>.`); continue; }
        if (st.lineHeightUnit && st.lineHeightUnit !== 'INTRINSIC_%') warnings.push(`${label} : interlignage non automatique (le texte peut être décalé verticalement ; vérifiez l'aperçu).`);
        const fill = colorOf(n, 'fill', ctx, label);
        const exactPt = st.fontSize * PT_PER_MM;
        const size = Math.round(exactPt * 4) / 4; // pas de 0,25 pt
        if (Math.abs(exactPt - size) > 0.06) warnings.push(`${label} : corps ${exactPt.toFixed(2)} pt arrondi à ${size} pt.`);
        const el = { type: 'text', font, size, minSize: tags.min && tags.min !== true ? Number(tags.min) : Math.max(6, Math.floor(size * 0.8 * 4) / 4), fill };
        const align = { LEFT: 'left', CENTER: 'center', RIGHT: 'right' }[st.textAlignHorizontal || 'LEFT'];
        el.x = align === 'left' ? x : align === 'center' ? num(x + w / 2) : num(x + w);
        el.y = y; el.maxW = w;
        if (align !== 'left') el.align = align;
        if (st.letterSpacing) el.letterSpacing = num(st.letterSpacing * PT_PER_MM);
        if (kind === 'champ') {
          if (!key) { errors.push(`${label} : nom de champ manquant (champ:nom).`); continue; }
          if (n.textAutoResize === 'WIDTH_AND_HEIGHT') errors.push(`${label} : largeur automatique ; fixez la largeur de la zone de texte (elle définit la largeur maximale).`);
          el.field = key;
          el.label = tags.label && tags.label !== true ? tags.label : key;
          el.maxChars = tags.max && tags.max !== true ? Number(tags.max) : 60;
          if (tags.opt) el.optional = true;
        } else if (kind === 'texte') {
          el.text = n.characters;
        } else {
          errors.push(`${label} : nommez ce texte « champ:<nom> » (modifiable) ou « texte » (fixe).`); continue;
        }
        if (!(el.minSize >= 6)) errors.push(`${label} : corps minimum inférieur à 6 pt.`);
        // Ordre des clés lisible dans le JSON
        elements.push(Object.fromEntries(['type', 'field', 'label', 'text', 'font', 'size', 'minSize', 'x', 'y', 'maxW', 'align', 'letterSpacing', 'fill', 'maxChars', 'optional'].filter((k) => k in el).map((k) => [k, el[k]])));
      } else {
        errors.push(`${label} : élément ${n.type} non géré (vectorisez en rectangle plein, ou retirez-le ; pas d'image ni de dégradé dans le modèle).`);
      }
    }
  };
  walk(frame.children);
  return elements;
}

/**
 * root : nœud Figma (SECTION/FRAME) contenant les cadres `page:recto`, `page:verso` (facultatif) et `palette`.
 * Renvoie { template, errors, warnings } ; template est null s'il y a des erreurs.
 */
export function figmaToTemplate(root, { id, name }) {
  const errors = [], warnings = [];
  const kids = root.children || [];
  const paletteFrame = kids.find((n) => /^palette\b/i.test(n.name));
  const pageFrames = kids.filter((n) => /^page:/i.test(n.name));
  if (!paletteFrame) errors.push('Cadre « palette » introuvable.');
  if (!pageFrames.length) errors.push('Aucun cadre « page:recto » trouvé.');
  if (pageFrames.length > 2) errors.push('Maximum 2 pages (recto, verso).');
  if (errors.length) return { template: null, errors, warnings };

  const first = parseName(pageFrames[0].name.replace(/^page:/i, 'page:'));
  const bleed = first.tags.bleed && first.tags.bleed !== true ? Number(first.tags.bleed) : 3;
  const profile = first.tags.profile && first.tags.profile !== true ? first.tags.profile : 'iso-coated-v2';
  const bb = pageFrames[0].absoluteBoundingBox;
  const trim = { w: num(bb.width - 2 * bleed), h: num(bb.height - 2 * bleed) };

  const pal = readPalette(paletteFrame, errors);
  const pages = pageFrames.map((f) => {
    const fb = f.absoluteBoundingBox;
    if (Math.abs(fb.width - bb.width) > 0.01 || Math.abs(fb.height - bb.height) > 0.01) errors.push(`${f.name} : dimensions différentes du recto.`);
    return { name: parseName(f.name).key, elements: convertPage(f, bleed, pal, errors, warnings) };
  });
  if (errors.length) return { template: null, errors, warnings };
  return { template: { id, name, profile, trim, bleed, palette: pal.palette, pages }, errors, warnings };
}
