import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Régression : une bannière publiée (modèle sans profil d'impression) ne doit pas empêcher le démarrage du serveur.
test('démarrage du serveur avec un modèle de bannière publié', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ubc-start-'));
  const icc = path.join(tmp, 'icc'), admin = path.join(tmp, 'clients');
  fs.mkdirSync(icc);
  for (const f of ['ISOcoated_v2_300_eci.icc', 'FOGRA39L_coated.icc']) fs.writeFileSync(path.join(icc, f), 'x');
  const tdir = path.join(admin, 'acme', 'templates');
  fs.mkdirSync(path.join(tdir, 'b.pkg'), { recursive: true });
  fs.writeFileSync(path.join(admin, 'acme', 'client.json'), '{"name":"ACME"}');
  fs.writeFileSync(path.join(tdir, 'b.json'), JSON.stringify({ kind: 'digital', id: 'b', name: 'B', formats: [{ id: 'a', file: 'a.html', w: 100, h: 50, label: 'A' }], fields: [{ name: 'nom', label: 'Nom' }] }));
  const p = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: '0', DATA_DIR: path.join(tmp, 'data'), ICC_DIR: icc, ADMIN_CLIENTS_DIR: admin }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  p.stdout.on('data', (d) => (log += d)); p.stderr.on('data', (d) => (log += d));
  const outcome = await new Promise((resolve) => {
    const t = setTimeout(() => resolve('timeout'), 8000);
    p.on('exit', (code) => { clearTimeout(t); resolve(`exit ${code}`); });
    const iv = setInterval(() => { if (log.includes('UnitsBusinessCards sur')) { clearInterval(iv); clearTimeout(t); resolve('started'); } }, 50);
  });
  p.kill();
  assert.equal(outcome, 'started', log);
});
