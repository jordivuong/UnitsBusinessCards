import { parse } from 'csv-parse/sync';

const norm = (s) =>
  String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

const ALIASES = {
  nom: ['nom', 'name', 'nomprenom', 'prenomnom'],
  titre: ['titre', 'fonction', 'poste', 'title', 'job'],
  telephone: ['telephone', 'tel', 'phone', 'mobile'],
  email: ['email', 'mail', 'courriel', 'emailadresse'],
  site: ['site', 'siteweb', 'web', 'website', 'url'],
};

/** Lit un CSV (virgule, point-virgule ou tabulation) et renvoie { rows, errors }. */
export function readCsv(buffer, template, maxRows) {
  if (buffer.includes(0)) return { rows: [], errors: ["Ce fichier n'est pas un CSV (texte) : exportez votre tableur au format CSV."] };
  let text = buffer.toString('utf8').replace(/^﻿/, '');
  if (text.includes('�')) text = buffer.toString('latin1'); // export Excel ANSI
  const first = text.split(/\r?\n/, 1)[0];
  const delimiter = [';', '\t', ','].sort((a, b) => count(first, b) - count(first, a))[0];
  let records;
  try {
    records = parse(text, { delimiter, skip_empty_lines: true, trim: true, relax_column_count: true });
  } catch (e) {
    return { rows: [], errors: [`CSV illisible (ligne ${e.lines ?? '?'}) : vérifiez les guillemets et les séparateurs.`] };
  }
  if (records.length < 2) return { rows: [], errors: ['Le CSV doit contenir une ligne d\'en-têtes et au moins une carte.'] };

  const headers = records[0].map(norm);
  const colOf = {};
  const errors = [];
  for (const f of template.fields) {
    const names = new Set([norm(f.name), norm(f.label), ...(ALIASES[f.name] || [])]);
    const idx = headers.findIndex((h) => names.has(h));
    if (idx < 0 && !f.optional) errors.push(`Colonne manquante : « ${f.label} »`);
    colOf[f.name] = idx;
  }
  if (errors.length) return { rows: [], errors };

  const data = records.slice(1);
  if (data.length > maxRows) return { rows: [], errors: [`Trop de lignes (${data.length}) : maximum ${maxRows} par envoi.`] };
  const rows = data.map((r, i) => ({
    line: i + 2,
    values: Object.fromEntries(template.fields.map((f) => [f.name, colOf[f.name] >= 0 ? (r[colOf[f.name]] ?? '').trim() : ''])),
  }));
  return { rows, errors: [] };
}

function count(s, ch) {
  return s.split(ch).length - 1;
}

/** CSV d'exemple (séparateur ; pour Excel FR, BOM UTF-8). */
export function sampleCsv(template) {
  const head = template.fields.map((f) => f.label).join(';');
  const ex = {
    nom: 'Jeanne Martin', titre: 'Directrice commerciale', telephone: '01 23 45 67 89',
    email: 'jeanne.martin@exemple.fr', site: 'www.exemple.fr',
  };
  return '﻿' + head + '\r\n' + template.fields.map((f) => ex[f.name] ?? '').join(';') + '\r\n';
}
