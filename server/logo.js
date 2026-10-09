import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const MAX_PX = 6000;

export function sniff(buf) {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  return null;
}

export function run(cmd, args, { timeout = 20_000, input } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => p.kill('SIGKILL'), timeout);
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code, sig) => {
      clearTimeout(timer);
      if (code === 0) resolve({ out, err });
      else reject(Object.assign(new Error(`${cmd} a échoué (${sig || code})`), { stderr: err }));
    });
    p.stdin.end(input);
  });
}

/**
 * Convertit un logo PNG/JPEG en JPEG CMJN (qualité maximale) via ImageMagick/lcms2.
 * Les transparences sont aplaties sur la couleur de fond de l'emplacement.
 */
export async function logoToCmyk(buf, { dir, iccPath, backgroundCmyk }) {
  const kind = sniff(buf);
  if (!kind) throw userError('Le logo doit être un fichier PNG ou JPEG.');
  const src = path.join(dir, `logo-src.${kind}`);
  const dst = path.join(dir, 'logo-cmyk.jpg');
  fs.writeFileSync(src, buf);

  let dims;
  try {
    const { out } = await run('identify', ['-format', '%w %h %[channels]', `${src}[0]`]);
    dims = out.trim().split(' ');
  } catch {
    throw userError('Le logo est illisible ou corrompu.');
  }
  const [w, h] = [Number(dims[0]), Number(dims[1])];
  if (!(w > 0 && h > 0) || w > MAX_PX || h > MAX_PX) throw userError(`Dimensions du logo hors limites (maximum ${MAX_PX} px).`);

  const [c, m, y, k] = backgroundCmyk.map((v) => v / 100);
  const rgb = [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)].map((v) => Math.round(v * 255));
  await run('convert', [
    `${src}[0]`, '-auto-orient',
    '-background', `rgb(${rgb.join(',')})`, '-alpha', 'remove', '-alpha', 'off',
    '-colorspace', 'sRGB',
    '-intent', 'relative', '-black-point-compensation',
    '-profile', iccPath,
    '-colorspace', 'CMYK',
    '-sampling-factor', '1x1', '-quality', '100',
    `JPEG:${dst}`,
  ]);
  return { file: dst, width: w, height: h };
}

export function userError(message) {
  return Object.assign(new Error(message), { user: true });
}
