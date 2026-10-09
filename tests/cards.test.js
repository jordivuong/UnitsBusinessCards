import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ubc-cards-'));
const { createCard, getCard, updateCard, listCards, deleteCard, cleanValues } = await import('../server/cards.js');
const tpl = { fields: [{ name: 'nom' }, { name: 'titre' }] };

test('cartes : créer, modifier, lister, supprimer, isolation par client', () => {
  const c = createCard('acme', 'a@acme.fr', { templateId: 't', values: { nom: 'Jeanne' }, label: 'Jeanne' });
  assert.equal(getCard('acme', c.id).values.nom, 'Jeanne');
  assert.equal(getCard('autre', c.id), null);
  updateCard('acme', 'b@acme.fr', c.id, { values: { nom: 'Jeanne M.' }, label: 'Jeanne M.' });
  const [l] = listCards('acme');
  assert.deepEqual([l.values.nom, l.updatedBy, l.createdBy], ['Jeanne M.', 'b@acme.fr', 'a@acme.fr']);
  assert.equal(deleteCard('autre', c.id), false);
  assert.equal(deleteCard('acme', c.id), true);
  assert.equal(listCards('acme').length, 0);
  assert.equal(getCard('acme', '../../etc/passwd'), null);
});

test('cleanValues ne garde que les champs du modèle', () => {
  assert.deepEqual(cleanValues(tpl, { nom: ' A ', titre: 5, intrus: 'x' }), { nom: 'A', titre: '5' });
});
