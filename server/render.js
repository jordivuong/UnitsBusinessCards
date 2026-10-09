import fs from 'node:fs';
import path from 'node:path';
import { buildPdf } from './pdf.js';
import { toPdfX3 } from './gs.js';
import { checkPdf, CheckError } from './checks.js';
import { logoToCmyk, run } from './logo.js';
import { resolveProfile } from './profiles.js';

/**
 * Génère le PDF/X-3 d'une carte (étapes A, B, C) et ses aperçus PNG rastérisés depuis le PDF final.
 * Renvoie { pdf, previews, warnings }. Lève une erreur (user: true si elle est destinée au client).
 */
export async function renderCard(template, values, { dir, withMarks, logo, name }) {
  const profile = resolveProfile(template.profile);
  const stepA = path.join(dir, `${name}.cmyk.pdf`);
  const pdf = path.join(dir, `${name}.pdf`);

  const a = await buildPdf(template, values, { withMarks, logo, outFile: stepA });
  await toPdfX3(stepA, pdf, { dir, profile, title: template.id, marginPt: a.geometry.margin, bleedPt: a.geometry.b });
  fs.rmSync(stepA, { force: true });

  let c;
  try {
    c = await checkPdf(pdf, { geometry: a.geometry, pages: template.pages.length, palette: template.palette, withMarks });
  } catch (e) {
    if (e instanceof CheckError) {
      console.error('[controle]', name, e.message);
      throw Object.assign(new Error(`Le PDF généré n'a pas passé les contrôles imprimeur. ${e.message}`), { user: true });
    }
    throw e;
  }

  // Aperçu : ce que le client valide est rasterisé depuis le PDF final.
  await run('pdftoppm', ['-r', '150', '-png', pdf, path.join(dir, name)]);
  const previews = fs.readdirSync(dir).filter((f) => f.startsWith(`${name}-`) && f.endsWith('.png')).sort();
  return { pdf: path.basename(pdf), previews, warnings: [...a.warnings, ...c.warnings], geometry: a.geometry, testProfile: profile.isTest };
}

export async function prepareLogo(template, logoBuf, dir) {
  if (!logoBuf) return null;
  const slot = template.pages.flatMap((p) => p.elements).find((e) => e.type === 'image');
  if (!slot) return null;
  return logoToCmyk(logoBuf, { dir, iccPath: resolveProfile(template.profile).path, backgroundCmyk: template.palette[slot.background] });
}
