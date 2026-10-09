import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

/**
 * Cartes enregistrées : les valeurs des champs (pas les PDF, régénérés à la demande), un fichier JSON par carte,
 * dans <data>/cards/<client>/. Elles appartiennent au client : tous les comptes du client les voient.
 */
const ID = /^[a-f0-9]{16}$/;
const MAX_PER_CLIENT = 2000;
const dir = (client) => path.join(config.dataDir, 'cards', client);
const file = (client, id) => path.join(dir(client), `${id}.json`);

function write(client, card) {
  fs.mkdirSync(dir(client), { recursive: true });
  const f = file(client, card.id);
  fs.writeFileSync(f + '.tmp', JSON.stringify(card, null, 2), { mode: 0o600 });
  fs.renameSync(f + '.tmp', f);
}

export function listCards(client) {
  if (!fs.existsSync(dir(client))) return [];
  const out = [];
  for (const n of fs.readdirSync(dir(client))) {
    if (!n.endsWith('.json')) continue;
    try { out.push(JSON.parse(fs.readFileSync(path.join(dir(client), n), 'utf8'))); } catch { /* fichier illisible : ignoré */ }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getCard(client, id) {
  if (!ID.test(id || '')) return null;
  try { return JSON.parse(fs.readFileSync(file(client, id), 'utf8')); } catch { return null; }
}

export function createCard(client, user, { templateId, values, label }) {
  if (fs.existsSync(dir(client)) && fs.readdirSync(dir(client)).length >= MAX_PER_CLIENT)
    throw Object.assign(new Error(`Limite de ${MAX_PER_CLIENT} cartes enregistrées atteinte : supprimez-en avant d'en ajouter.`), { user: true });
  const now = new Date().toISOString();
  const card = { id: crypto.randomBytes(8).toString('hex'), templateId, label, values, createdBy: user, createdAt: now, updatedBy: user, updatedAt: now };
  write(client, card);
  return card;
}

export function updateCard(client, user, id, { values, label }) {
  const card = getCard(client, id);
  if (!card) return null;
  Object.assign(card, { values, label, updatedBy: user, updatedAt: new Date().toISOString() });
  write(client, card);
  return card;
}

export function deleteCard(client, id) {
  if (!ID.test(id || '') || !fs.existsSync(file(client, id))) return false;
  fs.rmSync(file(client, id));
  return true;
}

/** Ne garde que les champs du modèle, en texte court. */
export function cleanValues(template, input) {
  return Object.fromEntries(template.fields.map((f) => [f.name, String(input?.[f.name] ?? '').trim().slice(0, 500)]));
}
export const cardLabel = (template, values) => values.nom || values[template.fields[0].name] || 'Carte';
