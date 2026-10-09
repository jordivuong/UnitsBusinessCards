import fs from 'node:fs';
import path from 'node:path';
import { run } from './logo.js';
import { config } from './config.js';

const SAFE_PS = /^[A-Za-z0-9_\-./ ]+$/;
const ps = (n) => n.toFixed(3);

/** Modèle PDFX_def.ps : seules des valeurs maîtrisées (profil, nombres) y sont écrites, jamais de texte client. */
export function pdfxDef({ profile, title, marginPt, bleedPt }) {
  if (!SAFE_PS.test(profile.path)) throw new Error('Chemin de profil ICC non autorisé.');
  const t = String(title).replace(/[^A-Za-z0-9-]/g, '');
  const o = (v) => `[${ps(v)} ${ps(v)} ${ps(v)} ${ps(v)}]`;
  return `%!
/ICCProfile (${profile.path}) def
[ /GTS_PDFXVersion (PDF/X-3:2002) /Title (${t}) /Trapped /False /DOCINFO pdfmark
[/_objdef {icc_PDFX} /type /stream /OBJ pdfmark
[{icc_PDFX} << /N 4 >> /PUT pdfmark
[{icc_PDFX} ICCProfile (r) file /PUT pdfmark
[/_objdef {OutputIntent_PDFX} /type /dict /OBJ pdfmark
[{OutputIntent_PDFX} <<
  /Type /OutputIntent
  /S /GTS_PDFX
  /OutputCondition (${profile.condition.replace(/[^A-Za-z0-9 ,.()%-]/g, '')})
  /Info (${profile.identifier})
  /OutputConditionIdentifier (${profile.identifier})
  /RegistryName (http://www.color.org)
  /DestOutputProfile {icc_PDFX}
>> /PUT pdfmark
[{Catalog} <</OutputIntents [ {OutputIntent_PDFX} ]>> /PUT pdfmark
<< /PDFXTrimBoxToMediaBoxOffset ${o(marginPt)}
   /PDFXBleedBoxToTrimBoxOffset ${o(bleedPt)}
   /PDFXSetBleedBoxToMediaBox false >> setpagedevice
`;
}

/** Étape B : PDF CMJN → PDF/X-3 (polices vectorisées, OutputIntent). */
export async function toPdfX3(inFile, outFile, { dir, profile, title, marginPt, bleedPt }) {
  const defFile = path.join(dir, 'PDFX_def.ps');
  fs.writeFileSync(defFile, pdfxDef({ profile, title, marginPt, bleedPt }));
  const args = [
    '-dBATCH', '-dNOPAUSE', '-dQUIET', '-dSAFER',
    `--permit-file-read=${profile.path}`, `--permit-file-read=${defFile}`,
    '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.3', '-dPDFX',
    '-sColorConversionStrategy=CMYK', '-sProcessColorModel=DeviceCMYK',
    '-dNoOutputFonts', '-dAutoRotatePages=/None',
    `-sOutputFile=${outFile}`, defFile, inFile,
  ];
  try {
    await run('gs', args, { timeout: config.gsTimeoutMs });
  } catch (e) {
    console.error('[gs]', e.message, (e.stderr || '').slice(0, 500));
    throw new Error('La génération du PDF imprimeur a échoué.');
  }
}
