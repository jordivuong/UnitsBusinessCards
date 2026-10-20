import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { unzipPackage, analyzePackage, writePackage } from '../server/package.js';
import { renderBanner, closeBrowser, chromePath } from '../server/banner.js';

const page = (extra = '', body = '<div class="b" data-field="nom" data-label="Nom" data-max="30">x</div>', size = '300x100') =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="banner:size" content="${size}">${extra}</head><body>${body}</body></html>`;
const pkg = (files) => unzipPackage(Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v])))));
const errorsOf = (files) => analyzePackage(pkg(files)).errors.join('\n');

test('package valide : formats, champs, révision', () => {
  const { template, errors } = analyzePackage(pkg({ 'a.html': page('<link rel="stylesheet" href="s.css">'), 's.css': '.b{color:red}' }));
  assert.deepEqual(errors, []);
  assert.deepEqual(template.formats, [{ id: 'a', file: 'a.html', w: 300, h: 100, label: 'a (300×100)' }]);
  assert.deepEqual(template.fields[0], { name: 'nom', label: 'Nom', maxChars: 30, optional: false, sample: undefined });
  assert.match(template.rev, /^[a-f0-9]{16}$/);
});

test('package : un dossier unique à la racine du ZIP est retiré, fichiers cachés ignorés', () => {
  const files = pkg({ 'mon-dossier/a.html': page(), '__MACOSX/mon-dossier/._a.html': 'x', 'mon-dossier/.DS_Store': 'x' });
  assert.deepEqual([...files.keys()], ['a.html']);
});

test('package : refus (script, JS inline, liens externes, fichiers manquants, images variables, taille)', () => {
  assert.match(errorsOf({ 'a.html': page('<script>alert(1)</script>') }), /<script> interdite/);
  assert.match(errorsOf({ 'a.html': page('', '<div onclick="x()" data-field="nom">x</div>') }), /onclick/);
  assert.match(errorsOf({ 'a.html': page('<link rel="stylesheet" href="https://cdn.example.com/x.css">') }), /ressource externe/);
  assert.match(errorsOf({ 'a.html': page('', '<img src="//evil.example/p.png">') }), /ressource externe/);
  assert.match(errorsOf({ 'a.html': page('<style>.b{background:url(http://evil.example/x.png)}</style>') }), /ressource externe/);
  assert.match(errorsOf({ 'a.html': page('', '<div style="background:url(javascript:alert(1))">x</div>') }), /ressource externe/);
  assert.match(errorsOf({ 'a.html': page('', '<img src="images/absent.png">') }), /introuvable/);
  assert.match(errorsOf({ 'a.html': page('', '<img data-field="logo" src="x.png">'), 'x.png': new Uint8Array(4) }), /image/);
  assert.match(errorsOf({ 'a.html': page('', '', '12x5000') }), /hors limites/);
  assert.match(errorsOf({ 'a.html': '<html><body>x</body></html>' }), /taille manquante/);
  assert.match(errorsOf({ 's.css': '@import url(https://x.example/a.css);', 'a.html': page() }), /ressource externe/);
  assert.match(errorsOf({ 'a.svg': '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>', 'a.html': page() }), /SVG/);
  assert.equal(analyzePackage(pkg({ 'x.txt': 'rien' })).template, null);
});

test('ZIP : chemins dangereux et types interdits', () => {
  assert.throws(() => pkg({ '../evil.html': page() }), /Chemin interdit/);
  assert.throws(() => pkg({ 'a.html': page(), 'run.sh': '#!/bin/sh' }), /Type de fichier non accepté/);
  assert.throws(() => unzipPackage(Buffer.from('pas un zip')), /ZIP illisible/);
});

const hasChrome = !!chromePath();
const build = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ubc-bn-'));
  const files2 = pkg(files);
  writePackage(dir, files2);
  const { template } = analyzePackage(files2);
  return { ...template, id: 't', name: 'T', pkgDir: dir };
};

test('rendu : PNG de la taille du format, texte posé sans HTML injectable, débordement refusé', { skip: !hasChrome }, async () => {
  const t = build({ 'a.html': page('<style>.b{width:200px;height:30px;font:20px sans-serif;overflow:hidden;white-space:nowrap}</style>', '<div class="b" data-field="nom" data-fit data-min-size="20">x</div>') });
  const out = await renderBanner(t, { nom: '<b>A</b>' }, { format: 'a', scale: 2, type: 'png' });
  assert.equal(out.buffer.subarray(1, 4).toString(), 'PNG');
  assert.equal(out.buffer.readUInt32BE(16), 600); // largeur 300 × 2
  assert.equal(out.buffer.readUInt32BE(20), 200);
  await assert.rejects(renderBanner(t, { nom: 'Un texte vraiment beaucoup trop long pour tenir dans la boîte' }, { format: 'a' }), /trop long/);
});

test('rendu : aucune requête réseau sortante (même hors validation)', { skip: !hasChrome }, async () => {
  let hits = 0;
  const srv = http.createServer((q, r) => { hits++; r.end('x'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ubc-bn-'));
  fs.writeFileSync(path.join(dir, 'a.html'), page(`<style>.b{background:url(${url}/bg.png)}</style>`, `<img src="${url}/i.png"><div class="b" data-field="nom">x</div>`));
  const t = { id: 't', fields: [{ name: 'nom', label: 'Nom' }], formats: [{ id: 'a', file: 'a.html', w: 300, h: 100, label: 'A' }], pkgDir: dir };
  await renderBanner(t, { nom: 'ok' }, { format: 'a' });
  srv.close();
  assert.equal(hits, 0);
  await closeBrowser();
});
