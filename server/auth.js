import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, sessionSecret } from './config.js';

const usersFile = () => path.join(config.dataDir, 'users.json');
const SESSION_MS = 12 * 3600 * 1000;
const COOKIE = 'ubc_session';

function load() {
  try { return JSON.parse(fs.readFileSync(usersFile(), 'utf8')); } catch { return {}; }
}
function save(users) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const tmp = usersFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(users, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, usersFile());
}

const normEmail = (e) => String(e || '').trim().toLowerCase();

function hash(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}

export function addUser(email, password, client) {
  email = normEmail(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Adresse e-mail invalide.');
  if (String(password).length < 10) throw new Error('Mot de passe : 10 caractères minimum.');
  const users = load();
  if (!client) throw new Error('Client obligatoire (--client <slug>).');
  users[email] = { ...hash(password), client };
  save(users);
}

export const clientOf = (email) => load()[normEmail(email)]?.client;

export function checkLogin(email, password) {
  const u = load()[normEmail(email)];
  // Même coût de calcul que l'utilisateur existe ou non.
  const h = hash(String(password), u?.salt);
  if (!u) return false;
  return crypto.timingSafeEqual(Buffer.from(h.hash, 'hex'), Buffer.from(u.hash, 'hex'));
}

const sign = (payload) => crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');

export function makeSession(email) {
  const payload = Buffer.from(JSON.stringify({ e: normEmail(email), x: Date.now() + SESSION_MS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function readSession(req) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|; )${COOKIE}=([^;]+)`));
  if (!m) return null;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig) return null;
  const good = sign(payload);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return s.x > Date.now() ? s.e : null;
  } catch { return null; }
}

export function setCookie(res, value, maxAgeSec) {
  res.setHeader('Set-Cookie',
    `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${config.cookieSecure ? '; Secure' : ''}`);
}
export const sessionMaxAge = SESSION_MS / 1000;

export function requireAuth(req, res, next) {
  const email = readSession(req);
  if (!email) return res.status(401).json({ error: 'Veuillez vous connecter.' });
  req.user = email;
  req.client = clientOf(email);
  if (!req.client) return res.status(403).json({ error: 'Compte non rattaché à un client : contactez l\'administrateur.' });
  next();
}
export const currentUser = readSession;

/** Limitation simple des tentatives de connexion (par IP) : 10 par 15 min. */
const attempts = new Map();
export function loginLimiter(req, res, next) {
  const now = Date.now(), key = req.ip;
  const list = (attempts.get(key) || []).filter((t) => now - t < 15 * 60_000);
  if (list.length >= 10) return res.status(429).json({ error: 'Trop de tentatives, réessayez dans quelques minutes.' });
  list.push(now);
  attempts.set(key, list);
  next();
}
