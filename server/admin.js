#!/usr/bin/env node
// flashcards-admin: look after a Open Flashcards server from its own shell.
//
//   flashcards-admin users                    list accounts (email, devices, stored size)
//   flashcards-admin devices [email]          list devices and when each was last seen
//   flashcards-admin revoke <device id>       sign one device out
//   flashcards-admin rename-user <old email> <new email>
//   flashcards-admin delete-user <email>      remove an account and everything stored for it
//   flashcards-admin registration [first|open|closed]
//                                       show or change who can create accounts
//
// Reads the same DATA_DIR as the server. `registration` edits the env file
// (FLASHCARDS_ENV, default /etc/open-flashcards/open-flashcards.env) and restarts the service.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = process.env.DATA_DIR || '/var/lib/open-flashcards';
const ENV_FILE = process.env.FLASHCARDS_ENV || '/etc/open-flashcards/open-flashcards.env';
const [cmd, arg, arg2] = process.argv.slice(2);

const dbFile = path.join(DATA_DIR, 'flashcards.db');
const open = () => {
  if (!fs.existsSync(dbFile)) { console.error(`No database at ${dbFile} (set DATA_DIR?)`); process.exit(1); }
  return new DatabaseSync(dbFile);
};
const table = rows => rows.length ? console.table(rows) : console.log('(none)');
const mb = n => `${(n / 1048576).toFixed(1)} MB`;

if (cmd === 'users') {
  table(open().prepare(`
    SELECT u.email, u.created_at AS created,
           (SELECT COUNT(*) FROM devices d WHERE d.user_id = u.id) AS devices,
           (SELECT COUNT(*) FROM records r WHERE r.user_id = u.id) AS records,
           (SELECT COALESCE(SUM(size_bytes), 0) FROM records r WHERE r.user_id = u.id) + (SELECT COALESCE(SUM(size_bytes), 0) FROM blobs b WHERE b.user_id = u.id) AS bytes
    FROM users u ORDER BY u.created_at`).all().map(({ bytes, ...u }) => ({ ...u, stored: mb(bytes) })));
} else if (cmd === 'devices') {
  const sql = `SELECT d.id, u.email, d.name, d.created_at AS created, d.last_seen
               FROM devices d JOIN users u ON u.id = d.user_id ${arg ? 'WHERE u.email = ?' : ''} ORDER BY u.email, d.created_at`;
  table(arg ? open().prepare(sql).all(arg) : open().prepare(sql).all());
} else if (cmd === 'revoke') {
  if (!arg) { console.error('Usage: flashcards-admin revoke <device id>'); process.exit(1); }
  const r = open().prepare('DELETE FROM devices WHERE id = ?').run(arg);
  console.log(r.changes ? 'Device signed out. It must sign in again to sync.' : 'No device with that id.');
} else if (cmd === 'rename-user') {
  if (!arg || !arg2) { console.error('Usage: flashcards-admin rename-user <old email> <new email>'); process.exit(1); }
  const r = open().prepare('UPDATE users SET email = ? WHERE email = ?').run(arg2.trim().toLowerCase(), arg.trim().toLowerCase());
  console.log(r.changes ? 'Email changed. Sign out and back in on each device (the recovery code still works).' : 'No account with that email.');
} else if (cmd === 'delete-user') {
  if (!arg) { console.error('Usage: flashcards-admin delete-user <email>'); process.exit(1); }
  const r = open().prepare('DELETE FROM users WHERE email = ?').run(arg);   // devices and records cascade
  console.log(r.changes ? 'Account and all its stored data deleted.' : 'No account with that email.');
} else if (cmd === 'registration') {
  const text = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  const current = (fs.existsSync(dbFile) && open().prepare("SELECT value FROM meta WHERE key = 'registration'").get()?.value) || /^REGISTRATION=(.*)$/m.exec(text)?.[1] || 'first';
  if (!arg) { console.log(`Registration is "${current}" (first = only until the first account exists, open = anyone, closed = nobody).`); process.exit(0); }
  if (!['first', 'open', 'closed'].includes(arg)) { console.error('Use first, open or closed.'); process.exit(1); }
  const next = /^REGISTRATION=/m.test(text) ? text.replace(/^REGISTRATION=.*$/m, `REGISTRATION=${arg}`) : `${text.replace(/\n?$/, '\n')}REGISTRATION=${arg}\n`;
  fs.writeFileSync(ENV_FILE, next);
  open().prepare("DELETE FROM meta WHERE key = 'registration'").run(); // the admin page's choice gives way to this one
  try { execFileSync('systemctl', ['restart', 'open-flashcards-server'], { stdio: 'inherit' }); console.log(`Registration is now "${arg}".`); }
  catch { console.log(`Saved "${arg}" in ${ENV_FILE}. Restart the server to apply it.`); }
} else {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 13).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
}
