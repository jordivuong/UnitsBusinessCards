import { test } from 'node:test';
import assert from 'node:assert/strict';
import { figmaToTemplate, parseName } from '../server/figma.js';

const solid = (r, g, b) => [{ type: 'SOLID', color: { r: r / 255, g: g / 255, b: b / 255, a: 1 } }];
const box = (x, y, width, height) => ({ absoluteBoundingBox: { x, y, width, height } });
const mmOfPt = (pt) => pt * 25.4 / 72; // la taille de police Figma est en mm (1 px = 1 mm)
const OX = 1000, OY = 500; // position du cadre dans le canevas Figma (doit être sans importance)

function fixture(mutate) {
  const text = (name, extra) => ({
    type: 'TEXT', name, characters: 'x', fills: solid(35, 31, 32), textAutoResize: 'HEIGHT',
    style: { fontPostScriptName: 'Inter-Regular', fontSize: mmOfPt(8), textAlignHorizontal: 'LEFT', lineHeightUnit: 'INTRINSIC_%' }, ...extra,
  });
  const root = {
    type: 'SECTION', name: 'carte-demo',
    children: [
      {
        type: 'FRAME', name: 'palette', ...box(OX, OY - 80, 100, 20), children: [
          { type: 'RECTANGLE', name: 'encre = 0/0/0/100', fills: solid(35, 31, 32), ...box(0, 0, 5, 5) },
          { type: 'RECTANGLE', name: 'accent = 85/20/0/0', fills: solid(45, 160, 225), ...box(0, 0, 5, 5) },
          { type: 'RECTANGLE', name: 'fond = 0/0/0/0', fills: solid(255, 255, 255), ...box(0, 0, 5, 5) },
        ],
      },
      {
        type: 'FRAME', name: 'page:recto bleed=3', ...box(OX, OY, 91, 61), children: [
          { type: 'RECTANGLE', name: 'fond fill=fond', fills: solid(255, 255, 255), ...box(OX, OY, 91, 61) },
          { type: 'RECTANGLE', name: 'filet', fills: solid(45, 160, 225), ...box(OX + 11, OY + 27, 14, 0.8) },
          text('champ:nom label="Nom" min=8 max=40', { ...box(OX + 11, OY + 13, 49, 6), style: { fontPostScriptName: 'Inter-SemiBold', fontSize: mmOfPt(11), textAlignHorizontal: 'LEFT', lineHeightUnit: 'INTRINSIC_%' } }),
          text('champ:site opt fill=encre', box(OX + 11, OY + 46, 69, 5)),
          text('texte', { ...box(OX + 11, OY + 40, 40, 5), characters: 'Fixe' }),
          { type: 'RECTANGLE', name: 'logo bg=fond', ...box(OX + 60, OY + 11, 20, 14) },
          { type: 'RECTANGLE', name: '_note', ...box(0, 0, 1, 1) },
        ],
      },
    ],
  };
  mutate?.(root);
  return root;
}

test('parseName', () => {
  assert.deepEqual(parseName('champ:nom label="Nom de famille" min=8 opt'), { kind: 'champ', key: 'nom', tags: { label: 'Nom de famille', min: '8', opt: true } });
});

test('conversion : coordonnées relatives à la coupe, couleurs, champs', () => {
  const { template, errors, warnings } = figmaToTemplate(fixture(), { id: 'demo', name: 'Démo' });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.deepEqual(template.trim, { w: 85, h: 55 });
  assert.deepEqual(template.palette.encre, [0, 0, 0, 100]);
  const els = template.pages[0].elements;
  assert.deepEqual(els[0], { type: 'rect', x: -3, y: -3, w: 91, h: 61, fill: 'fond' });
  assert.equal(els[1].fill, 'accent'); // déduit de la pastille la plus proche
  assert.equal(els[2].x, 8); assert.equal(els[2].y, 10); assert.equal(els[2].maxW, 49);
  assert.equal(els[2].field, 'nom'); assert.equal(els[2].minSize, 8); assert.equal(els[2].maxChars, 40);
  assert.equal(els[2].size, 11); assert.equal(els[3].size, 8);
  assert.equal(els[3].optional, true);
  assert.equal(els[4].text, 'Fixe');
  assert.deepEqual(els[5], { type: 'image', x: 57, y: 8, w: 20, h: 14, background: 'fond' });
  assert.equal(els.length, 6); // « _note » ignoré
});

const errorsOf = (mutate) => figmaToTemplate(fixture(mutate), { id: 'demo', name: 'D' }).errors.join('\n');

test('refus : opacité, effets, vecteur, largeur auto, couleur inconnue', () => {
  const page = (r) => r.children[1];
  assert.match(errorsOf((r) => { page(r).children[1].opacity = 0.5; }), /opacité/);
  assert.match(errorsOf((r) => { page(r).children[1].effects = [{ type: 'DROP_SHADOW' }]; }), /effets/);
  assert.match(errorsOf((r) => { page(r).children.push({ type: 'GROUP_INCONNU', name: 'forme', ...box(OX, OY, 1, 1) }); }), /non géré/);
  assert.match(errorsOf((r) => { page(r).children[2].textAutoResize = 'WIDTH_AND_HEIGHT'; }), /largeur automatique/);
  assert.match(errorsOf((r) => { page(r).children[2].name = 'champ:nom fill=inconnue'; }), /absente de la palette/);
  assert.match(errorsOf((r) => { r.children.shift(); }), /palette/);
});

test('avertissement : corps non standard arrondi', () => {
  const r = fixture((x) => { x.children[1].children[2].style.fontSize = 4.0; });
  const out = figmaToTemplate(r, { id: 'demo', name: 'D' });
  assert.equal(out.template.pages[0].elements[2].size, 11.25);
  assert.match(out.warnings.join(), /arrondi/);
});

test('police : nom PostScript déduit de la famille et du style quand l\'API renvoie null', () => {
  const r = fixture((x) => { Object.assign(x.children[1].children[2].style, { fontPostScriptName: null, fontFamily: 'Inter', fontStyle: 'Semi Bold' }); });
  const out = figmaToTemplate(r, { id: 'demo', name: 'D' });
  assert.deepEqual(out.errors, []);
  assert.equal(out.template.pages[0].elements[2].font, 'Inter-SemiBold');
});

test('avertissement : couleur Figma éloignée de la pastille déclarée', () => {
  const r = fixture((x) => { x.children[1].children[1].name = 'filet fill=encre'; });
  assert.match(figmaToTemplate(r, { id: 'demo', name: 'D' }).warnings.join(), /diffère/);
});

const logoNode = (extra) => ({
  type: 'VECTOR', name: 'logo fill=encre', fills: solid(35, 31, 32), ...box(OX + 11, OY + 10, 12, 10),
  fillGeometry: [{ path: 'M 0.123456 0 L 12 0 L 12 10.5 Z M 2 2 L 4 2 L 4 4 Z', windingRule: 'EVENODD' }], ...extra,
});

test('formes vectorielles : logo, ellipse, rectangle arrondi, contour', () => {
  const page = (r) => r.children[1];
  const els = (mutate) => figmaToTemplate(fixture(mutate), { id: 'demo', name: 'D' });
  let out = els((r) => { page(r).children.push(logoNode()); });
  assert.deepEqual(out.errors, []);
  const path = out.template.pages[0].elements.find((e) => e.type === 'path');
  assert.deepEqual([path.x, path.y, path.fill, path.rule], [8, 7, 'encre', 'evenodd']);
  assert.match(path.d, /^M 0\.123 0 L 12 0/); // arrondi à 0,001 mm
  // rectangle arrondi + contour : chemins, pas de rect
  out = els((r) => { page(r).children.push({ type: 'RECTANGLE', name: 'bouton fill=accent', cornerRadius: 2, fills: solid(45, 160, 225), fillGeometry: [{ path: 'M 0 2 L 2 0 Z', windingRule: 'NONZERO' }], ...box(OX + 5, OY + 5, 10, 5) }); });
  assert.deepEqual(out.errors, []);
  assert.equal(out.template.pages[0].elements.filter((e) => e.type === 'path').length, 1);
  out = els((r) => { page(r).children.push(logoNode({ strokes: solid(45, 160, 225), strokeGeometry: [{ path: 'M 0 0 L 1 1 Z', windingRule: 'NONZERO' }], name: 'logo fill=encre stroke=accent' })); });
  assert.deepEqual(out.errors, []);
  assert.deepEqual(out.template.pages[0].elements.filter((e) => e.type === 'path').map((e) => e.fill), ['encre', 'accent']);
});

test('formes vectorielles : refus clairs', () => {
  const page = (r) => r.children[1];
  assert.match(errorsOf((r) => { page(r).children.push(logoNode({ fillGeometry: undefined })); }), /géométrie de remplissage absente/);
  assert.match(errorsOf((r) => { page(r).children.push(logoNode({ rotation: 0.5 })); }), /rotation/);
  assert.match(errorsOf((r) => { page(r).children.push(logoNode({ fills: [{ type: 'GRADIENT_LINEAR' }] })); }), /dégradé ou image/);
  assert.match(errorsOf((r) => { page(r).children.push(logoNode({ isMask: true })); }), /masque/);
});

test('couleur sans pastille identique : la plus proche, avec avertissement', () => {
  const out = figmaToTemplate(fixture((r) => { r.children[1].children.push(logoNode({ fills: solid(40, 36, 38), name: 'logo' })); }), { id: 'demo', name: 'D' });
  assert.deepEqual(out.errors, []);
  assert.equal(out.template.pages[0].elements.find((e) => e.type === 'path').fill, 'encre'); // proche à 8/255 près : sans avertissement
  const far = figmaToTemplate(fixture((r) => { r.children[1].children.push(logoNode({ fills: solid(10, 200, 10), name: 'logo' })); }), { id: 'demo', name: 'D' });
  assert.deepEqual(far.errors, []);
  assert.match(far.warnings.join('\n'), /« logo » : couleur approchée par « \w+ » \(écart \d+\/255\)/);
});
