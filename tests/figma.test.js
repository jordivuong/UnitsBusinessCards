import { test } from 'node:test';
import assert from 'node:assert/strict';
import { figmaToTemplate, parseName } from '../server/figma.js';

const solid = (r, g, b) => [{ type: 'SOLID', color: { r: r / 255, g: g / 255, b: b / 255, a: 1 } }];
const box = (x, y, width, height) => ({ absoluteBoundingBox: { x, y, width, height } });
const OX = 1000, OY = 500; // position du cadre dans le canevas Figma (doit être sans importance)

function fixture(mutate) {
  const text = (name, extra) => ({
    type: 'TEXT', name, characters: 'x', fills: solid(35, 31, 32), textAutoResize: 'HEIGHT',
    style: { fontPostScriptName: 'Inter-Regular', fontSize: 8, textAlignHorizontal: 'LEFT', lineHeightUnit: 'INTRINSIC_%' }, ...extra,
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
          text('champ:nom label="Nom" min=8 max=40', { ...box(OX + 11, OY + 13, 49, 6), style: { fontPostScriptName: 'Inter-SemiBold', fontSize: 11, textAlignHorizontal: 'LEFT', lineHeightUnit: 'INTRINSIC_%' } }),
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
  assert.match(errorsOf((r) => { page(r).children.push({ type: 'VECTOR', name: 'forme', ...box(OX, OY, 1, 1) }); }), /non géré/);
  assert.match(errorsOf((r) => { page(r).children[2].textAutoResize = 'WIDTH_AND_HEIGHT'; }), /largeur automatique/);
  assert.match(errorsOf((r) => { page(r).children[1].fills = solid(10, 200, 10); }), /couleur non déterminée/);
  assert.match(errorsOf((r) => { page(r).children[2].name = 'champ:nom fill=inconnue'; }), /absente de la palette/);
  assert.match(errorsOf((r) => { r.children.shift(); }), /palette/);
});

test('avertissement : couleur Figma éloignée de la pastille déclarée', () => {
  const r = fixture((x) => { x.children[1].children[1].name = 'filet fill=encre'; });
  assert.match(figmaToTemplate(r, { id: 'demo', name: 'D' }).warnings.join(), /diffère/);
});
