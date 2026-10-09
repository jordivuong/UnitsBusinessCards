import fs from 'node:fs';
import path from 'node:path';
import { addUser } from './auth.js';
import { config } from './config.js';
import { SLUG, getClient } from './template.js';

const [cmd, ...rest] = process.argv.slice(2);
const flag = (n) => { const i = rest.indexOf(`--${n}`); return i >= 0 ? rest[i + 1] : undefined; };
const pos = rest.filter((a, i) => !a.startsWith('--') && !rest[i - 1]?.startsWith('--'));
const usage = () => {
  console.error(`Usage :
  node server/cli.js new-client <slug> "<Nom affiché>"
  node server/cli.js add-user <email> <mot-de-passe> --client <slug>`);
  process.exit(1);
};

try {
  if (cmd === 'new-client') {
    const [slug, name] = pos;
    if (!SLUG.test(slug || '') || !name) usage();
    const dir = path.join(config.clientsDir, slug);
    if (fs.existsSync(dir)) throw new Error(`Le client ${slug} existe déjà.`);
    for (const d of ['templates', 'fonts', 'assets']) fs.mkdirSync(path.join(dir, d), { recursive: true });
    fs.writeFileSync(path.join(dir, 'client.json'), JSON.stringify({ name }, null, 2) + '\n');
    fs.writeFileSync(path.join(dir, 'fonts', '.gitkeep'), '');
    console.log(`Client créé : ${dir}\nAjoutez ses polices dans fonts/ et ses modèles avec : npm run figma:import`);
  } else if (cmd === 'add-user') {
    const [email, password] = pos, client = flag('client');
    if (!email || !password || !client) usage();
    if (!getClient(client)) throw new Error(`Client inconnu : ${client} (le créer avec new-client).`);
    addUser(email, password, client);
    console.log(`Compte créé ou mis à jour : ${email} (client ${client})`);
  } else usage();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
