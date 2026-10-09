import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  port: Number(process.env.PORT || 3000),
  dataDir: path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data')),
  iccDir: path.resolve(process.env.ICC_DIR || path.join(ROOT, 'icc')),
  fontsDir: path.join(ROOT, 'fonts'),
  templatesDir: path.join(ROOT, 'templates'),
  // Uniquement pour le développement : sans profil ECI, on utilise un profil CMJN générique de Ghostscript.
  allowTestProfile: process.env.ALLOW_TEST_PROFILE === '1',
  cookieSecure: process.env.COOKIE_SECURE === '1',
  maxRows: 100,
  jobTtlMs: 30 * 60 * 1000,
  gsTimeoutMs: 20_000,
};

/** Secret de session : variable d'environnement, sinon fichier généré une fois dans data/. */
export function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  fs.mkdirSync(config.dataDir, { recursive: true });
  const f = path.join(config.dataDir, 'session.secret');
  if (!fs.existsSync(f)) {
    fs.writeFileSync(f, cryptoRandom(), { mode: 0o600 });
  }
  return fs.readFileSync(f, 'utf8');
}

import crypto from 'node:crypto';
function cryptoRandom() {
  return crypto.randomBytes(32).toString('hex');
}
