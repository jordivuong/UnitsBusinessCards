import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFigmaUrl } from '../server/admin.js';

const KEY = 'AbCdEfGhIjKlMnOpQrStUv';

test('parseFigmaUrl : lien de section', () => {
  assert.deepEqual(parseFigmaUrl(`https://www.figma.com/design/${KEY}/Nom?node-id=12-34&t=x`), { file: KEY, node: '12:34' });
  assert.deepEqual(parseFigmaUrl(`https://figma.com/design/${KEY}/branch/ZyXwVuTsRqPoNmLkJiHgFe/Nom?node-id=1-2`), { file: 'ZyXwVuTsRqPoNmLkJiHgFe', node: '1:2' });
});

test('parseFigmaUrl : refuse les liens douteux', () => {
  assert.equal(parseFigmaUrl(`https://evil.example/design/${KEY}/x?node-id=1-2`), null);
  assert.equal(parseFigmaUrl(`https://figma.com.evil.example/design/${KEY}/x?node-id=1-2`), null);
  assert.equal(parseFigmaUrl(`http://www.figma.com/design/${KEY}/x?node-id=1-2`), null);
  assert.equal(parseFigmaUrl(`https://www.figma.com/design/${KEY}/x`), null);
  assert.equal(parseFigmaUrl('pas un lien'), null);
});
