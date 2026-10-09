// Usage :
//   FIGMA_TOKEN=... node tools/figma-import.mjs --client acme --id carte-v1 --name "Carte" --file <fileKey> --node <nodeId>
//   node tools/figma-import.mjs --client acme --id carte-v1 --name "Carte" --json export.json      (hors ligne)
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../server/config.js';
import { SLUG, validateTemplate } from '../server/template.js';
import { figmaToTemplate } from '../server/figma.js';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const die = (m) => { console.error(m); process.exit(1); };

const client = arg('client'), id = arg('id'), name = arg('name') || id;
if (!SLUG.test(client || '') || !/^[a-z0-9-]+$/.test(id || '')) die('Usage : --client <slug> --id <modele-id> [--name "Nom"] (--file <cle> --node <id> | --json <fichier>)');
const cdir = path.join(config.clientsDir, client);
if (!fs.existsSync(cdir)) die(`Client inconnu : ${client} (node server/cli.js new-client ${client} "Nom")`);

let root;
if (arg('json')) {
  const j = JSON.parse(fs.readFileSync(arg('json'), 'utf8'));
  root = j.nodes ? Object.values(j.nodes)[0].document : j.document || j;
} else {
  // FIGMA_TOKEN facultatif : derrière un proxy qui injecte lui-même l'en-tête X-Figma-Token (secret d'environnement), il n'est pas nécessaire.
  const token = process.env.FIGMA_TOKEN, file = arg('file'), node = arg('node');
  if (!file || !node) die('Il faut --file et --node (ou --json), et FIGMA_TOKEN sauf si un proxy fournit le jeton.');
  const r = await fetch(`https://api.figma.com/v1/files/${file}/nodes?ids=${encodeURIComponent(node)}`, { headers: token ? { 'X-Figma-Token': token } : {} });
  if (!r.ok) die(`Figma a répondu ${r.status}. Vérifiez le jeton, la clé de fichier et l'identifiant du nœud.`);
  root = Object.values((await r.json()).nodes)[0]?.document;
  if (!root) die('Nœud introuvable dans le fichier Figma.');
}

const { template, errors, warnings } = figmaToTemplate(root, { id, name });
for (const w of warnings) console.warn(`⚠ ${w}`);
if (!template) { for (const e of errors) console.error(`✗ ${e}`); die(`\n${errors.length} erreur(s) : corrigez le fichier Figma et relancez.`); }

try {
  validateTemplate(structuredClone(template), [path.join(cdir, 'fonts'), config.fontsDir]);
} catch (e) { die(`✗ ${e.message}`); }

const out = path.join(cdir, 'templates', `${id}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(template, null, 2) + '\n');
console.log(`✓ Modèle écrit : ${out}\n  Vérifiez-le : npm run template:check -- ${client} ${id}`);
