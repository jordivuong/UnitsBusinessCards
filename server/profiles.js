import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { config } from './config.js';

// Profils de sortie. Les fichiers ICC ne sont pas versionnés (licence ECI) : voir icc/README.md.
export const PROFILES = {
  'iso-coated-v2': {
    file: 'ISOcoated_v2_300_eci.icc',
    identifier: 'FOGRA39',
    condition: 'Offset commercial, papier couche (ISO Coated v2 300%, ECI)',
    tacMax: 300,
  },
  fogra39: {
    file: 'FOGRA39L_coated.icc',
    identifier: 'FOGRA39',
    condition: 'Coated FOGRA39 (ISO 12647-2:2004)',
    tacMax: 330,
  },
};

/** Renvoie { path, identifier, condition, tacMax, isTest } pour un profil, ou lève une erreur claire. */
export function resolveProfile(name) {
  const p = PROFILES[name];
  if (!p) throw new Error(`Profil de sortie inconnu : ${name}`);
  const file = path.join(config.iccDir, p.file);
  if (fs.existsSync(file)) return { ...p, path: file, isTest: false };
  if (config.allowTestProfile) {
    const gsIcc = findGsDefaultCmyk();
    if (gsIcc) return { ...p, path: gsIcc, isTest: true };
  }
  throw new Error(
    `Profil ICC introuvable : ${p.file}. Placez-le dans ${config.iccDir} (voir icc/README.md).`
  );
}

function findGsDefaultCmyk() {
  const r = spawnSync('gs', ['--version'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const v = r.stdout.trim();
  for (const base of ['/usr/share/ghostscript', '/usr/local/share/ghostscript']) {
    const f = path.join(base, v, 'iccprofiles', 'default_cmyk.icc');
    if (fs.existsSync(f)) return f;
  }
  return null;
}
