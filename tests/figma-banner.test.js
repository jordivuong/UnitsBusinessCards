import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertBanner, findFormatFrames, bannerCss } from '../server/figma-banner.js';
import { unzipPackage, analyzePackage } from '../server/package.js';
import { zipSync, strToU8 } from 'fflate';

const solid = (r, g, b, a = 1) => ({ type: 'SOLID', color: { r: r / 255, g: g / 255, b: b / 255, a } });
const bb = (x, y, w, h) => ({ absoluteBoundingBox: { x, y, width: w, height: h } });
const text = (id, name, x, y, w, h, extra = {}) => ({
  id, type: 'TEXT', name, characters: 'Jeanne Martin', fills: [solid(18, 18, 18)], textAutoResize: 'HEIGHT', ...bb(x, y, w, h),
  style: { fontFamily: 'PP Mori', fontStyle: 'SemiBold', fontWeight: 600, fontSize: 40, lineHeightPx: 48, letterSpacing: 0, textAlignHorizontal: 'LEFT', textAlignVertical: 'TOP' }, ...extra,
});
const OX = 500, OY = 300;
const frame = (children, extra = {}) => ({ id: '9:1', type: 'FRAME', name: 'format:1200x628 label="Réseaux"', fills: [solid(255, 255, 255)], ...bb(OX, OY, 1200, 628), children, ...extra });

test('findFormatFrames : cadres directs, dans une section, ou introuvables', () => {
  const f = frame([]);
  assert.deepEqual(findFormatFrames({ name: 'Page', children: [f] }).frames, [f]);
  assert.deepEqual(findFormatFrames({ name: 'Page', children: [{ name: 'sec', type: 'SECTION', children: [f] }] }).frames, [f]);
  assert.deepEqual(findFormatFrames(f).frames, [f]);
  assert.match(findFormatFrames({ name: 'Page', children: [] }).error, /Aucun cadre/);
  assert.match(findFormatFrames({ name: 'P', children: [{ name: 'a', children: [f] }, { name: 'b', children: [f] }] }).error, /plusieurs/);
});

test('conversion : champ texte, décor exporté, positions relatives au cadre', () => {
  const out = convertBanner([frame([
    { id: '1:1', type: 'RECTANGLE', name: 'fond', fills: [solid(250, 240, 235)], ...bb(OX, OY, 1200, 628), absoluteRenderBounds: { x: OX, y: OY, width: 1200, height: 628 } },
    { id: '1:2', type: 'VECTOR', name: 'logo', fills: [solid(237, 91, 54)], ...bb(OX + 80, OY + 60, 90, 90), absoluteRenderBounds: { x: OX + 80, y: OY + 60, width: 90, height: 90 } },
    text('1:3', 'champ:nom label="Nom" max=40 min=24', OX + 80, OY + 240, 700, 60),
    text('1:4', 'champ:titre label="Fonction" opt nofit', OX + 80, OY + 320, 700, 40),
    { id: '1:5', type: 'RECTANGLE', name: '_repere', ...bb(0, 0, 1, 1) },
  ])]);
  assert.deepEqual(out.errors, []);
  const [fmt] = out.formats;
  assert.deepEqual([fmt.id, fmt.label, fmt.w, fmt.h], ['1200x628', 'Réseaux', 1200, 628]);
  assert.deepEqual(out.exports.map((e) => [e.id, e.format]), [['1:1', 'svg'], ['1:2', 'svg']]);
  assert.match(fmt.html, /<meta name="banner:size" content="1200x628">/);
  assert.match(fmt.html, /<img src="assets\/1-2\.svg" alt="" style="position:absolute;left:80px;top:60px;width:90px;height:90px;">/);
  assert.match(fmt.html, /data-field="nom" data-label="Nom" data-max="40" data-fit data-min-size="24" data-sample="Jeanne Martin"/);
  assert.match(fmt.html, /data-field="titre" data-label="Fonction" data-optional data-sample/);
  assert.doesNotMatch(fmt.html, /data-field="titre"[^>]*data-fit/);
  assert.doesNotMatch(fmt.html, /_repere/);
  assert.deepEqual(out.fonts, [{ ps: 'PPMori-SemiBold', family: 'PP Mori', weight: 600, italic: false }]);
  assert.match(bannerCss(out.fonts, (f) => `fonts/${f.ps}.otf`), /font-family: "PP Mori"; font-weight: 600; font-style: normal; src: url\(fonts\/PPMori-SemiBold\.otf\)/);
});

test('conversion : le HTML généré passe la validation du package', () => {
  const out = convertBanner([frame([text('1:3', 'champ:nom label="Nom"', OX + 10, OY + 10, 400, 60)])]);
  const files = new Map([['style.css', strToU8(bannerCss(out.fonts, (f) => `fonts/${f.ps}.otf`).replace(/@font-face[^\n]*\n/g, ''))], ['1200x628.html', strToU8(out.formats[0].html)]]);
  const a = analyzePackage(files);
  assert.deepEqual(a.errors, []);
  assert.equal(a.template.fields[0].name, 'nom');
});

test('conversion : PNG si image/flou/fusion ; conteneur de champ en CSS (fond, dégradé, rayon, ombre)', () => {
  const card = {
    id: '2:1', type: 'FRAME', name: 'carte', cornerRadius: 24, ...bb(OX + 60, OY + 60, 600, 300),
    fills: [{ type: 'GRADIENT_LINEAR', gradientHandlePositions: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }, { x: 0, y: 1 }], gradientStops: [{ position: 0, color: { r: 1, g: 1, b: 1, a: 1 } }, { position: 1, color: { r: 0.9, g: 0.4, b: 0.2, a: 1 } }] }],
    effects: [{ type: 'DROP_SHADOW', offset: { x: 0, y: 8 }, radius: 24, spread: 0, color: { r: 0, g: 0, b: 0, a: 0.2 } }],
    children: [text('2:2', 'champ:nom', OX + 100, OY + 100, 500, 60), { id: '2:3', type: 'RECTANGLE', name: 'photo', fills: [{ type: 'IMAGE', imageRef: 'abcdef0123456789zz', scaleMode: 'FILL' }], ...bb(OX + 100, OY + 200, 100, 100), absoluteRenderBounds: { x: OX + 100, y: OY + 200, width: 100, height: 100 } }],
  };
  const out = convertBanner([frame([card, { id: '3:1', type: 'ELLIPSE', name: 'flou', fills: [solid(0, 0, 0)], effects: [{ type: 'LAYER_BLUR', radius: 10 }], ...bb(OX, OY, 50, 50), absoluteRenderBounds: { x: OX - 10, y: OY - 10, width: 70, height: 70 } }])]);
  assert.deepEqual(out.errors, []);
  assert.deepEqual(out.exports.map((e) => [e.id, e.format]), [['2:3', 'png'], ['3:1', 'png']]);
  const html = out.formats[0].html;
  assert.match(html, /border-radius:24px 24px 24px 24px;box-shadow:0px 8px 24px 0px rgba\(0,0,0,0\.2\)/);
  assert.match(html, /linear-gradient\(90deg, rgba\(255,255,255,1\) 0%, rgba\(230,102,51,1\) 100%\)/); // angle et arrêts recalculés pour CSS
  assert.match(html, /left:-10px;top:-10px;width:70px;height:70px/); // bornes de rendu (effets compris)
});

test('conversion : refus clairs', () => {
  const e = (children, extra) => convertBanner([frame(children, extra)]).errors.join('\n');
  assert.match(e([text('1', 'champ:nom', 0, 0, 10, 10, { textAutoResize: 'WIDTH_AND_HEIGHT' })]), /largeur automatique/);
  assert.match(e([text('1', 'champ:Nom Invalide', 0, 0, 10, 10)]), /nom de champ invalide/);
  assert.match(e([text('1', 'champ:nom', 0, 0, 10, 10, { rotation: 0.3 })]), /pivoté/);
  assert.match(e([], { rotation: 0.2 }), /rotation/);
  assert.match(e(Array.from({ length: 151 }, (_, i) => ({ id: `r${i}`, type: 'RECTANGLE', name: `r${i}`, fills: [solid(0, 0, 0)], ...bb(OX, OY, 5, 5) }))), /plus de 150 calques fixes/);
});
