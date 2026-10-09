import { addUser } from './auth.js';

const [cmd, email, password] = process.argv.slice(2);
if (cmd !== 'add-user' || !email || !password) {
  console.error('Usage : node server/cli.js add-user <email> <mot-de-passe>');
  process.exit(1);
}
try {
  addUser(email, password);
  console.log(`Compte créé ou mis à jour : ${email}`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
