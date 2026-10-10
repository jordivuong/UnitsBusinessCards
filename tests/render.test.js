import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

process.env.ALLOW_TEST_PROFILE = '1';
const { getTemplate } = await import('../server/template.js');
const { renderCard } = await import('../server/render.js');
const { readCsv } = await import('../server/csv.js');

const hasGs = spawnSync('gs', ['--version']).status === 0;
const t = getTemplate('demo', 'classique-v1');
const base = { nom: 'Jeanne Martin', titre: 'Directrice', telephone: '', email: 'j@exemple.fr', site: '' };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ubc-test-'));

for (const withMarks of [false, true]) {
  test(`PDF/X-3 valide (traits de coupe : ${withMarks})`, { skip: !hasGs }, async () => {
    const dir = tmp();
    const r = await renderCard(t, base, { dir, withMarks, logo: null, name: 'c' });
    assert.ok(fs.existsSync(path.join(dir, r.pdf)));
    assert.equal(r.previews.length, 1);
  });
}

test('texte trop long : réduit puis refusé', { skip: !hasGs }, async () => {
  await assert.rejects(
    renderCard(t, { ...base, nom: 'Jean-Baptiste Alexandre de la Tour-Maubourg-Lamarque' }, { dir: tmp(), withMarks: false, logo: null, name: 'c' }),
    (e) => e.user && /trop long/.test(e.message)
  );
});

test('glyphe absent de la police', { skip: !hasGs }, async () => {
  await assert.rejects(
    renderCard(t, { ...base, nom: 'Jeanne 😀' }, { dir: tmp(), withMarks: false, logo: null, name: 'c' }),
    (e) => e.user && /absents de la police/.test(e.message)
  );
});

test('CSV : séparateur ; et en-têtes accentués', () => {
  const csv = Buffer.from('Nom;Fonction;Téléphone;E-mail\nJeanne;Chef;0102;j@x.fr\n');
  const { rows, errors } = readCsv(csv, t, 10);
  assert.deepEqual(errors, []);
  assert.equal(rows[0].values.titre, 'Chef');
});

test('CSV : colonne manquante et fichier binaire', () => {
  assert.match(readCsv(Buffer.from('Nom\nA\n'), t, 10).errors[0], /manquante/);
  assert.match(readCsv(Buffer.from([0x89, 0x50, 0, 1, 2]), t, 10).errors[0], /pas un CSV/);
});

// Forme vectorielle (logo) : anneau en règle pair-impair, couleur de la palette, dans le PDF final.
const withLogo = () => {
  const c = structuredClone(t);
  c.pages[0].elements.push({ type: 'path', x: 55, y: 8, fill: Object.keys(c.palette)[0], rule: 'evenodd', d: 'M 0 5 A 5 5 0 1 0 10 5 A 5 5 0 1 0 0 5 Z M 2 5 A 3 3 0 1 1 8 5 A 3 3 0 1 1 2 5 Z' });
  return c;
};

test('forme vectorielle : tracée en CMJN dans le PDF vectoriel (étape A)', async () => {
  const { buildPdf } = await import('../server/pdf.js');
  const dir = tmp(), out = path.join(dir, 'a.pdf');
  await buildPdf(withLogo(), base, { withMarks: false, logo: null, outFile: out });
  assert.ok(fs.statSync(out).size > 1000);
});

test('forme vectorielle : PDF/X-3 valide, couleurs de la palette', { skip: !hasGs }, async () => {
  const dir = tmp();
  const r = await renderCard(withLogo(), base, { dir, withMarks: false, logo: null, name: 'logo' });
  assert.ok(fs.existsSync(path.join(dir, r.pdf)));
});
