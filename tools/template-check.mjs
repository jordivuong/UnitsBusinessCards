// Génère un PDF/X-3 d'essai + aperçu PNG d'un modèle avec des valeurs d'exemple, dans ./out/<client>-<id>/.
import fs from 'node:fs';
import path from 'node:path';
import { getTemplate } from '../server/template.js';
import { renderCard } from '../server/render.js';

const [client, id] = process.argv.slice(2);
const t = getTemplate(client, id);
if (!t) { console.error('Usage : npm run template:check -- <client> <modele>'); process.exit(1); }
const EX = { nom: 'Jeanne Martin', titre: 'Directrice commerciale', telephone: '01 23 45 67 89', email: 'jeanne.martin@exemple.fr', site: 'www.exemple.fr' };
const dir = path.resolve('out', `${client}-${id}`);
fs.mkdirSync(dir, { recursive: true });
const values = Object.fromEntries(t.fields.map((f) => [f.name, EX[f.name] ?? f.label]));
for (const withMarks of [false, true]) {
  const r = await renderCard(t, values, { dir, withMarks, logo: null, name: withMarks ? 'avec-traits' : 'sans-traits' });
  console.log(`✓ ${r.pdf} (${withMarks ? 'avec' : 'sans'} traits de coupe)`, r.warnings.length ? r.warnings : '');
}
console.log(`Aperçus et PDF : ${dir}`);
