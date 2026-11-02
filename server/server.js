// open-flashcards-server: stores each user's records as encrypted envelopes and hands
// them back in order. It never sees the data: the app encrypts every record
// with a key only the user's devices hold, and names records with opaque ids.
//
// No dependencies: node:http, node:crypto and node:sqlite (Node 22.5+).
//
// Environment:
//   PORT              default 8797 (Caddy in front does HTTPS)
//   HOST              default 127.0.0.1
//   DATA_DIR          default ./data  (flashcards.db lives here)
//   ALLOWED_ORIGINS   comma list, e.g. https://hazymat.github.io,http://localhost:5173
//   REGISTRATION      first (default: only while there are no users) | open | closed
//   QUOTA_MB          default 1024 per user (records and files together); accounts in ADMIN_EMAILS have no limit but the disk
//   MAX_SIGNUPS_PER_DAY  default 0 (no limit): new accounts per UTC day
//   ADMIN_EMAILS      comma list of accounts that can use /admin
//   EMAIL_CODES       on | off (default): new accounts confirm their address with a code sent by email
//   MAIL_FROM         the address codes come from, e.g. noreply@example.com
//   SMTP_HOST, SMTP_PORT  the mail server that sends them; default 127.0.0.1 and 25, with no sign-in
//   SHARING           on | off (default): the sharing routes, which let any account look others up by email

import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const PORT = Number(process.env.PORT || 8797);
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://hazymat.github.io,http://localhost:5173').split(',').map(s => s.trim()).filter(Boolean);
const ENV_REGISTRATION = process.env.REGISTRATION || 'first';
const ENV_SIGNUP_LIMIT = Number(process.env.MAX_SIGNUPS_PER_DAY) || 0;
const ADMINS = new Set((process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
const SHARING = process.env.SHARING === 'on';
const EMAIL_CODES = process.env.EMAIL_CODES === 'on';
const MAIL_FROM = process.env.MAIL_FROM || '';
const SMTP_HOST = process.env.SMTP_HOST || '127.0.0.1';
const SMTP_PORT = Number(process.env.SMTP_PORT || 25);
if (EMAIL_CODES && !MAIL_FROM) throw new Error('EMAIL_CODES=on needs MAIL_FROM');
const NO_LIMIT_QUOTA = 100 * 1024 * 1024 * 1024;
const QUOTA = Number(process.env.QUOTA_MB || 1024) * 1024 * 1024;
const MAX_BODY = 20 * 1024 * 1024;
const MAX_PUBLIC_BODY = 64 * 1024; // sign-in and account requests, before a device is known
const MAX_BLOB = 30 * 1024 * 1024; // an encrypted attachment (the app allows 25 MB files)

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'flashcards.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    auth_hash TEXT NOT NULL,          -- scrypt(auth_hash sent by the app)
    auth_salt TEXT NOT NULL,
    kdf TEXT NOT NULL,                -- JSON: the app's key-derivation parameters
    wrapped_data_key TEXT NOT NULL,   -- the data key, encrypted by the app
    last_seq INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL,
    last_seen TEXT
  );
  CREATE TABLE IF NOT EXISTS records (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    record_id TEXT NOT NULL,          -- opaque (keyed hash made by the app)
    seq INTEGER NOT NULL,
    ciphertext TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    PRIMARY KEY (user_id, record_id)
  );
  CREATE INDEX IF NOT EXISTS records_by_seq ON records (user_id, seq);
  CREATE TABLE IF NOT EXISTS blobs (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blob_id TEXT NOT NULL,            -- opaque (keyed hash made by the app)
    size_bytes INTEGER NOT NULL,
    data BLOB NOT NULL,               -- encrypted by the app
    PRIMARY KEY (user_id, blob_id)
  );
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS shares (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_seq INTEGER NOT NULL DEFAULT 0,
    info TEXT NOT NULL,               -- what is shared (kind and name), encrypted with the share's key
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS share_members (
    share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wrapped_key TEXT NOT NULL,        -- the share's key, encrypted by the app for this member
    added_at TEXT NOT NULL,
    accepted_at TEXT,                 -- null while it is only an invitation
    PRIMARY KEY (share_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS share_records (
    share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
    record_id TEXT NOT NULL,          -- opaque (keyed hash made by the app)
    seq INTEGER NOT NULL,
    ciphertext TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    PRIMARY KEY (share_id, record_id)
  );
  CREATE INDEX IF NOT EXISTS share_records_by_seq ON share_records (share_id, seq);
  CREATE TABLE IF NOT EXISTS share_blobs (
    share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
    blob_id TEXT NOT NULL,            -- opaque (keyed hash made by the app with the share's key)
    size_bytes INTEGER NOT NULL,
    data BLOB NOT NULL,               -- encrypted by the app with the share's key
    PRIMARY KEY (share_id, blob_id)
  );
`);
// Sharing: each account's public key, and its private key encrypted by the app.
// Names: how others see you on shared things (all optional; username unique on this server).
for (const col of ['recovery_hash', 'recovery_salt', 'public_key', 'wrapped_private_key', 'username', 'first_name', 'last_name']) {
  if (!db.prepare('PRAGMA table_info(users)').all().some(c => c.name === col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} TEXT`);
}

// Every sign-up, kept after its account is deleted, so deleting doesn't free up the day's limit.
db.exec('CREATE TABLE IF NOT EXISTS signups (at TEXT NOT NULL)');
// quota_mb: this account's own limit; empty means the server's default.
if (!db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'quota_mb')) db.exec('ALTER TABLE users ADD COLUMN quota_mb REAL');
// The admin's whitelist: addresses to keep, whether or not they have an account yet.
db.exec('CREATE TABLE IF NOT EXISTS whitelist (email TEXT PRIMARY KEY, added_at TEXT NOT NULL)');
if (!db.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'email_confirmed_at')) db.exec('ALTER TABLE users ADD COLUMN email_confirmed_at TEXT');
// Codes waiting to be typed in, and every email sent, so the limits can be checked.
db.exec('CREATE TABLE IF NOT EXISTS signup_codes (email TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at TEXT NOT NULL, tries INTEGER NOT NULL DEFAULT 0)');
db.exec('CREATE TABLE IF NOT EXISTS mail_log (at TEXT NOT NULL, email TEXT NOT NULL, ip TEXT NOT NULL)');
// How much each account does each day (UTC), for spotting abuse.
db.exec(`CREATE TABLE IF NOT EXISTS activity (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  bytes_in INTEGER NOT NULL DEFAULT 0,
  refused INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
)`);
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_username ON users (username COLLATE NOCASE) WHERE username IS NOT NULL');
const NAMES = 'username, first_name, last_name';

// A per-install secret so unknown emails get stable made-up KDF salts
// (the answer doesn't reveal whether an account exists).
let secret = db.prepare('SELECT value FROM meta WHERE key = ?').get('secret')?.value;
if (!secret) {
  secret = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('secret', secret);
}

const now = () => new Date().toISOString();
const metaGet = key => db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value;
const metaSet = (key, value) => db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, String(value));
// The admin page's choices win over the settings file.
const registrationSetting = () => metaGet('registration') || ENV_REGISTRATION;
const signupLimit = () => { const saved = metaGet('signup_limit'); return saved === undefined ? ENV_SIGNUP_LIMIT : Number(saved); };
const signupsToday = () => db.prepare('SELECT COUNT(*) n FROM signups WHERE at >= ?').get(now().slice(0, 10)).n;
const dayIsFull = () => signupLimit() > 0 && signupsToday() >= signupLimit();
const allOff = () => metaGet('all_off') === '1';
const registrationNow = () => {
  const setting = registrationSetting();
  if (allOff()) return 'closed';
  if (setting === 'closed' || (setting === 'first' && db.prepare('SELECT COUNT(*) n FROM users').get().n)) return 'closed';
  return dayIsFull() ? 'closed' : 'open';
};
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const id = () => crypto.randomUUID();
const b64url = buf => buf.toString('base64url');

function scrypt(value, salt) {
  return new Promise((resolve, reject) => crypto.scrypt(value, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? reject(e) : resolve(k.toString('hex')))));
}
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// ---------- email ----------
// Plain SMTP to a mail server this machine can already use. Nothing from the caller goes into a message but
// the address, which has been checked, so nobody can use this to send words of their own.

const STRICT_EMAIL = /^[a-z0-9_%+'][a-z0-9._%+'-]*@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const CODE_MINUTES = 15;
const MAX_CODE_TRIES = 5;
const MAIL_LIMITS = { gapSeconds: 60, perEmailHour: 3, perIpHour: 6, perDay: 30 };

function sendMail(to, subject, lines) {
  const domain = MAIL_FROM.split('@')[1];
  const message = [`From: Open Flashcards <${MAIL_FROM}>`, `To: ${to}`, `Subject: ${subject}`, `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`, `Message-ID: <${crypto.randomUUID()}@${domain}>`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', 'Auto-Submitted: auto-generated', '', ...lines].join('\r\n');
  const steps = [['', 220], [`EHLO ${domain}`, 250], [`MAIL FROM:<${MAIL_FROM}>`, 250], [`RCPT TO:<${to}>`, 250], ['DATA', 354], [`${message}\r\n.`, 250], ['QUIT', 221]];
  return new Promise((resolve, reject) => {
    const socket = net.connect(SMTP_PORT, SMTP_HOST);
    let buffer = '';
    let step = 0;
    const finish = err => { socket.destroy(); if (err) reject(err); else resolve(); };
    socket.setTimeout(15000, () => finish(new Error('Mail server took too long')));
    socket.on('error', finish);
    socket.on('close', () => finish(step >= steps.length ? null : new Error('Mail server hung up')));
    socket.on('data', chunk => {
      buffer += chunk;
      // A reply is finished by a line with a space after its code.
      const last = buffer.split('\r\n').filter(Boolean).at(-1) || '';
      if (!buffer.endsWith('\r\n') || !/^\d{3} /.test(last)) return;
      const code = Number(last.slice(0, 3));
      buffer = '';
      if (code !== steps[step][1]) return finish(new Error(`Mail server said ${last}`));
      step++;
      if (step === steps.length) return finish();
      socket.write(`${steps[step][0]}\r\n`);
    });
  });
}

// Each limit answers the same way, so it can't be used to learn about an address.
function checkMailLimits(email, ip) {
  const since = ms => new Date(Date.now() - ms).toISOString();
  const count = (sql, ...args) => db.prepare(`SELECT COUNT(*) n FROM mail_log WHERE ${sql}`).get(...args).n;
  if (count('email = ? AND at > ?', email, since(MAIL_LIMITS.gapSeconds * 1000))) throw new HttpError(429, 'A code was only just sent. Wait a minute, then try again.');
  if (count('email = ? AND at > ?', email, since(3600000)) >= MAIL_LIMITS.perEmailHour || count('ip = ? AND at > ?', ip, since(3600000)) >= MAIL_LIMITS.perIpHour) throw new HttpError(429, 'Too many codes asked for. Try again in an hour.');
  if (count('at > ?', since(24 * 3600000)) >= MAIL_LIMITS.perDay) throw new HttpError(429, "No more codes can be sent today. Try again tomorrow.");
}
const codeHash = (email, code) => crypto.createHmac('sha256', secret).update(`${email}/${code}`).digest('hex');

// Used up if right; a few wrong tries and a new code is needed.
function useCode(email, code, ip) {
  const row = db.prepare('SELECT * FROM signup_codes WHERE email = ?').get(email);
  const expired = row && row.expires_at < now();
  if (!row || expired) {
    if (expired) db.prepare('DELETE FROM signup_codes WHERE email = ?').run(email);
    throw new HttpError(400, 'That code has run out. Ask for a new one.');
  }
  if (typeof code !== 'string' || !same(codeHash(email, code.replace(/\s/g, '')), row.code_hash)) {
    fail(`i:${ip}`);
    if (row.tries + 1 >= MAX_CODE_TRIES) { db.prepare('DELETE FROM signup_codes WHERE email = ?').run(email); throw new HttpError(400, 'Too many wrong tries. Ask for a new code.'); }
    db.prepare('UPDATE signup_codes SET tries = tries + 1 WHERE email = ?').run(email);
    throw new HttpError(400, "That code isn't right. Check the email and try again.");
  }
}

// ---------- tiny router ----------

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const ALL_OFF_MESSAGE = 'Sync is switched off on this server for now. Everything on this device is safe.';
// Admin rights belong to the account, not just the address: the first account with an address in ADMIN_EMAILS
// is pinned, and that address can't be signed up for again if the account ever goes. Sign-up addresses aren't verified.
const adminPins = () => JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'admin_ids'").get()?.value || '{}');
function pinAdmins() {
  const pins = adminPins();
  let changed = false;
  for (const email of ADMINS) {
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (user && !pins[email]) { pins[email] = user.id; changed = true; }
  }
  if (changed) db.prepare("INSERT INTO meta (key, value) VALUES ('admin_ids', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(JSON.stringify(pins));
}
pinAdmins();
const isAdminId = userId => {
  const email = db.prepare('SELECT email FROM users WHERE id = ?').get(userId)?.email;
  return ADMINS.has(email) && adminPins()[email] === userId;
};
function noteActivity(userId, { requests = 0, bytes = 0, refused = 0 }) {
  db.prepare(`INSERT INTO activity (user_id, day, requests, bytes_in, refused) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (user_id, day) DO UPDATE SET requests = requests + excluded.requests, bytes_in = bytes_in + excluded.bytes_in, refused = refused + excluded.refused`).run(userId, now().slice(0, 10), requests, bytes, refused);
}

function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'Bad JSON')); }
    });
    req.on('error', reject);
  });
}

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, status, body, origin) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (origin && ORIGINS.includes(origin)) Object.assign(headers, { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' });
  res.writeHead(status, headers);
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function authed(req) {
  const m = /^Bearer\s+(.+)$/.exec(req.headers.authorization || '');
  if (!m) throw new HttpError(401, 'Sign in first');
  const dev = db.prepare('SELECT d.id, d.user_id FROM devices d WHERE d.token_hash = ?').get(sha256(m[1]));
  if (!dev) throw new HttpError(401, 'This device has been signed out');
  // All off: everyone but the admin, who needs to be able to turn it back on.
  if (allOff() && !isAdminId(dev.user_id)) throw new HttpError(503, ALL_OFF_MESSAGE);
  db.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').run(now(), dev.id);
  noteActivity(dev.user_id, { requests: 1 });
  return dev;
}

// Login attempts: after 10 failures for an email or address, wait 15 minutes.
const failures = new Map();
setInterval(() => { for (const [key, f] of failures) if (Date.now() - f.first > 15 * 60 * 1000) failures.delete(key); }, 60 * 1000).unref();
function checkLimit(key) {
  const f = failures.get(key);
  if (f && f.count >= 10 && Date.now() - f.first < 15 * 60 * 1000) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
}
function fail(key) {
  const f = failures.get(key);
  if (!f || Date.now() - f.first > 15 * 60 * 1000) failures.set(key, { count: 1, first: Date.now() });
  else f.count++;
}

function newDevice(userId, name) {
  const token = b64url(crypto.randomBytes(32));
  const deviceId = id();
  db.prepare('INSERT INTO devices (id, user_id, name, token_hash, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)')
    .run(deviceId, userId, String(name || 'Device').slice(0, 80), sha256(token), now(), now());
  return { token, device_id: deviceId };
}

// Swap in a new password: the app's new login hash, key settings and the data
// key wrapped by the new password. Uses the synchronous scrypt: it is one
// short call and keeps the swap in a single step.
function replacePassword(userId, body) {
  if (typeof body.auth_hash !== 'string' || body.auth_hash.length < 32) throw new HttpError(400, 'Missing auth_hash');
  if (typeof body.wrapped_data_key !== 'string' || !body.kdf) throw new HttpError(400, 'Missing keys');
  const salt = b64url(crypto.randomBytes(16));
  const hash = crypto.scryptSync(body.auth_hash, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  db.prepare('UPDATE users SET auth_hash = ?, auth_salt = ?, kdf = ?, wrapped_data_key = ? WHERE id = ?')
    .run(hash, salt, JSON.stringify(body.kdf), body.wrapped_data_key, userId);
}

// Shared records count towards the account that shared them.
const usage = userId => db.prepare('SELECT COALESCE(SUM(size_bytes), 0) AS bytes FROM records WHERE user_id = ?').get(userId).bytes
  + db.prepare('SELECT COALESCE(SUM(size_bytes), 0) AS bytes FROM blobs WHERE user_id = ?').get(userId).bytes
  + db.prepare('SELECT COALESCE(SUM(r.size_bytes), 0) AS bytes FROM share_records r JOIN shares s ON s.id = r.share_id WHERE s.owner_id = ?').get(userId).bytes
  + db.prepare('SELECT COALESCE(SUM(b.size_bytes), 0) AS bytes FROM share_blobs b JOIN shares s ON s.id = b.share_id WHERE s.owner_id = ?').get(userId).bytes;

const defaultQuotaMb = () => { const saved = metaGet('default_quota_mb'); return saved === undefined ? QUOTA / 1048576 : Number(saved); };
const quotaOf = userId => {
  if (isAdminId(userId)) return NO_LIMIT_QUOTA;
  const own = db.prepare('SELECT quota_mb FROM users WHERE id = ?').get(userId)?.quota_mb;
  return (own ?? defaultQuotaMb()) * 1048576;
};
const quotaMessage = userId => `This account has reached its limit of ${Math.round(quotaOf(userId) / 1048576)} MB`;
function adminOf(req) {
  const dev = authed(req);
  if (!isAdminId(dev.user_id)) throw new HttpError(403, 'Only the server admin can do that');
  return dev;
}
const DEFAULT_TEMPLATES = [{ name: 'Trial', mb: 5 }, { name: 'Kept', mb: 25 }, { name: 'Large', mb: 100 }];
const quotaTemplates = () => JSON.parse(metaGet('quota_templates') || 'null') || DEFAULT_TEMPLATES;
const cleanEmails = list => [...new Set((Array.isArray(list) ? list : []).map(e => String(e).trim().toLowerCase()).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];
const quotaNumber = value => {
  const mb = Number(value);
  if (!Number.isFinite(mb) || mb < 0 || mb > 100000) throw new HttpError(400, 'Use a number of MB from 0 to 100000');
  return mb;
};
const summary = () => {
  const seen = metaGet('admin_seen') || '';
  const disk = fs.statfsSync(DATA_DIR);
  const today = now().slice(0, 10);
  const activity = db.prepare('SELECT COALESCE(SUM(requests), 0) requests, COALESCE(SUM(bytes_in), 0) bytes_in, COALESCE(SUM(refused), 0) refused FROM activity WHERE day = ?').get(today);
  return {
    all_off: allOff(), disk_free_bytes: disk.bavail * disk.bsize, requests_today: activity.requests, bytes_in_today: activity.bytes_in, refused_today: activity.refused,
    accounts: db.prepare('SELECT COUNT(*) n FROM users').get().n,
    stored_bytes: db.prepare('SELECT COALESCE(SUM(size_bytes), 0) n FROM records').get().n + db.prepare('SELECT COALESCE(SUM(size_bytes), 0) n FROM blobs').get().n,
    new_accounts: db.prepare('SELECT COUNT(*) n FROM users WHERE created_at > ?').get(seen).n,
    signups_today: signupsToday(), signup_limit: signupLimit(), registration: registrationSetting(), registration_now: registrationNow(), quota_mb: defaultQuotaMb(), templates: quotaTemplates(),
  };
};
const DAY_MS = 24 * 60 * 60 * 1000;
const isUnderADay = user => Date.now() - Date.parse(user.created_at) < DAY_MS;

// A place records are kept: one account's own (records) or a share (share_records).
const PERSONAL = { table: 'records', key: 'user_id', counter: 'UPDATE users SET last_seq = last_seq + 1 WHERE id = ? RETURNING last_seq' };
const SHARED = { table: 'share_records', key: 'share_id', counter: 'UPDATE shares SET last_seq = last_seq + 1 WHERE id = ? RETURNING last_seq' };

// Push: each record is accepted only if the server's copy is the one the
// app last saw (base_seq). Otherwise the current copy comes back as a
// conflict for the app to merge field by field and push again.
function pushInto(place, owner, quotaUser, body) {
  const list = Array.isArray(body.records) ? body.records : [];
  if (list.length > 2000) throw new HttpError(413, 'Push at most 2000 records at a time');
  const accepted = [];
  const conflicts = [];
  const current = db.prepare(`SELECT seq, ciphertext FROM ${place.table} WHERE ${place.key} = ? AND record_id = ?`);
  const bump = db.prepare(place.counter);
  const put = db.prepare(`INSERT INTO ${place.table} (${place.key}, record_id, seq, ciphertext, size_bytes) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (${place.key}, record_id) DO UPDATE SET seq = excluded.seq, ciphertext = excluded.ciphertext, size_bytes = excluded.size_bytes`);
  let bytes = usage(quotaUser);
  let sent = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const r of list) {
      if (typeof r.record_id !== 'string' || typeof r.ciphertext !== 'string') continue;
      const have = current.get(owner, r.record_id);
      // Not held here yet (e.g. a device moving over from another server): nothing to conflict with.
      if (have && have.seq !== (Number(r.base_seq) || 0)) { conflicts.push({ record_id: r.record_id, seq: have.seq, ciphertext: have.ciphertext }); continue; }
      const size = Buffer.byteLength(r.ciphertext);
      bytes += size - (have ? Buffer.byteLength(have.ciphertext) : 0);
      if (bytes > quotaOf(quotaUser)) throw new HttpError(507, quotaMessage(quotaUser));
      const seq = bump.get(owner).last_seq;
      put.run(owner, r.record_id, seq, r.ciphertext, size);
      accepted.push({ record_id: r.record_id, seq });
      sent += size;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    if (e.status === 507) noteActivity(quotaUser, { refused: 1 });
    throw e;
  }
  noteActivity(quotaUser, { bytes: sent });
  return { accepted, conflicts };
}

// Pull: everything changed since `since`, in order, a page at a time.
function pullFrom(place, owner, query) {
  const since = Number(query.get('since')) || 0;
  const limit = Math.min(1000, Number(query.get('limit')) || 500);
  const rows = db.prepare(`SELECT record_id, seq, ciphertext FROM ${place.table} WHERE ${place.key} = ? AND seq > ? ORDER BY seq LIMIT ?`).all(owner, since, limit + 1);
  const more = rows.length > limit;
  const records = rows.slice(0, limit);
  return { records, last_seq: records.at(-1)?.seq ?? since, more };
}

// The share, if this account is in it (owner or member). Only invited, not
// yet accepted: it can be seen (to accept or decline) but not used.
function shareFor(userId, shareId, { invited = false } = {}) {
  const share = db.prepare('SELECT s.*, m.accepted_at FROM shares s JOIN share_members m ON m.share_id = s.id WHERE s.id = ? AND m.user_id = ?').get(shareId, userId);
  if (!share || (!share.accepted_at && !invited)) throw new HttpError(404, 'That share has ended or was never shared with you');
  return share;
}
const ownShare = (userId, shareId) => {
  const share = shareFor(userId, shareId);
  if (share.owner_id !== userId) throw new HttpError(403, 'Only the person who shared it can do that');
  return share;
};

// ---------- endpoints ----------

const routes = {
  'GET /api/health': () => ({ ok: true, registration: registrationNow(), day_is_full: dayIsFull(), all_off: allOff(), quota_mb: defaultQuotaMb(), email_codes: EMAIL_CODES }),

  // The app needs its key-derivation settings before it can make the login hash.
  'POST /api/prelogin': async ({ body }) => {
    const email = String(body.email || '').trim().toLowerCase();
    const user = db.prepare('SELECT kdf FROM users WHERE email = ?').get(email);
    if (user) return { kdf: JSON.parse(user.kdf) };
    return { kdf: { name: 'PBKDF2-SHA256', iterations: 600000, salt: crypto.createHmac('sha256', secret).update(email).digest('base64') } };
  },

  // The first step of a new account: a code to this address. If it already has an account it gets a note
  // saying so instead of a code, and the caller gets the same answer either way.
  'POST /api/signup/code': async ({ body, ip }) => {
    if (!EMAIL_CODES) throw new HttpError(404, 'This server does not use email codes');
    if (registrationNow() !== 'open') throw new HttpError(403, dayIsFull() ? "Today's new accounts have all gone. Try again tomorrow." : 'Registration is closed on this server');
    const email = String(body.email || '').trim().toLowerCase();
    if (!STRICT_EMAIL.test(email) || email.length > 200) throw new HttpError(400, 'Enter a valid email address');
    checkLimit(`i:${ip}`);
    checkMailLimits(email, ip);
    db.prepare('INSERT INTO mail_log (at, email, ip) VALUES (?, ?, ?)').run(now(), email, ip);
    const known = db.prepare('SELECT 1 FROM users WHERE email = ?').get(email) || adminPins()[email];
    try {
      if (known) {
        await sendMail(email, 'You already have an Open Flashcards account', ['Someone, probably you, tried to create an Open Flashcards account with this address, but it already has one.', '', 'To use it, sign in under Settings, Sync. If you have forgotten your password, Forgot password? is there too, and needs your recovery code.', '', 'If this was not you, you can ignore this email.']);
      } else {
        const code = String(crypto.randomInt(1000000)).padStart(6, '0');
        db.prepare('INSERT INTO signup_codes (email, code_hash, expires_at) VALUES (?, ?, ?) ON CONFLICT (email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, tries = 0').run(email, codeHash(email, code), new Date(Date.now() + CODE_MINUTES * 60000).toISOString());
        await sendMail(email, 'Your Open Flashcards code', [`Your code is ${code}`, '', `Type it into Open Flashcards to finish creating your account. It lasts ${CODE_MINUTES} minutes.`, '', 'If you did not ask for this, you can ignore this email.']);
      }
    } catch (e) {
      console.error('Mail not sent:', e.message);
      throw new HttpError(502, "The email couldn't be sent. Try again later.");
    }
    return { ok: true };
  },

  'POST /api/register': async ({ body, ip }) => {
    const refuseIfClosed = () => { if (registrationNow() !== 'open') throw new HttpError(403, dayIsFull() ? "Today's new accounts have all gone. Try again tomorrow." : 'Registration is closed on this server'); };
    refuseIfClosed();
    const email = String(body.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address');
    if (typeof body.auth_hash !== 'string' || body.auth_hash.length < 32) throw new HttpError(400, 'Missing auth_hash');
    if (typeof body.wrapped_data_key !== 'string' || !body.kdf) throw new HttpError(400, 'Missing keys');
    if (typeof body.recovery_hash !== 'string' || body.recovery_hash.length < 32) throw new HttpError(400, 'Missing recovery_hash');
    if (EMAIL_CODES && body.code === undefined) throw new HttpError(400, 'This server needs a code sent by email. Update the app, then try again.');
    if (EMAIL_CODES) { checkLimit(`i:${ip}`); useCode(email, body.code, ip); }
    const taken = () => db.prepare('SELECT 1 FROM users WHERE email = ?').get(email) || adminPins()[email];
    if (taken()) throw new HttpError(409, 'That email already has an account');
    const salt = b64url(crypto.randomBytes(16));
    const rsalt = b64url(crypto.randomBytes(16));
    const userId = id();
    const authHash = await scrypt(body.auth_hash, salt);
    const recoveryHash = await scrypt(body.recovery_hash, rsalt);
    // Checked again now the slow part is done, so requests arriving together can't all get in.
    refuseIfClosed();
    if (taken()) throw new HttpError(409, 'That email already has an account');
    db.prepare('INSERT INTO signups (at) VALUES (?)').run(now());
    if (EMAIL_CODES) db.prepare('DELETE FROM signup_codes WHERE email = ?').run(email);
    db.prepare('INSERT INTO users (id, email, auth_hash, auth_salt, kdf, wrapped_data_key, recovery_hash, recovery_salt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(userId, email, authHash, salt, JSON.stringify(body.kdf), body.wrapped_data_key, recoveryHash, rsalt, now());
    if (EMAIL_CODES) db.prepare('UPDATE users SET email_confirmed_at = ? WHERE id = ?').run(now(), userId);
    pinAdmins();
    return { user_id: userId, ...newDevice(userId, body.device_name) };
  },

  'POST /api/login': async ({ body, ip }) => {
    const email = String(body.email || '').trim().toLowerCase();
    checkLimit(`e:${email}`);
    checkLimit(`i:${ip}`);
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    // Unknown emails still pay for one scrypt, so the answer takes as long either way.
    const hash = await scrypt(String(body.auth_hash ?? ''), user?.auth_salt || secret);
    const ok = user && typeof body.auth_hash === 'string' && same(hash, user.auth_hash);
    if (!ok) { fail(`e:${email}`); fail(`i:${ip}`); throw new HttpError(401, 'Email or password is wrong'); }
    failures.delete(`e:${email}`);
    if (allOff() && !isAdminId(user.id)) throw new HttpError(503, ALL_OFF_MESSAGE);
    return { user_id: user.id, wrapped_data_key: user.wrapped_data_key, kdf: JSON.parse(user.kdf), ...newDevice(user.id, body.device_name) };
  },

  // Forgot the password: the recovery code (which the app turns into
  // recovery_hash) proves it's you. The app sends a new password's hash and
  // the data key wrapped by it; every other device is signed out.
  'POST /api/recover': async ({ body, ip }) => {
    const email = String(body.email || '').trim().toLowerCase();
    checkLimit(`e:${email}`);
    checkLimit(`i:${ip}`);
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const ok = user?.recovery_hash && typeof body.recovery_hash === 'string' && same(await scrypt(body.recovery_hash, user.recovery_salt), user.recovery_hash);
    if (!ok) { fail(`e:${email}`); fail(`i:${ip}`); throw new HttpError(401, 'Email or recovery code is wrong'); }
    if (allOff() && !isAdminId(user.id)) throw new HttpError(503, ALL_OFF_MESSAGE);
    failures.delete(`e:${email}`);
    replacePassword(user.id, body);
    db.prepare('DELETE FROM devices WHERE user_id = ?').run(user.id);
    return { user_id: user.id, ...newDevice(user.id, body.device_name) };
  },

  // What a signed-in device needs to change the password.
  'GET /api/me': ({ req }) => {
    const dev = authed(req);
    const u = db.prepare(`SELECT email, kdf, wrapped_data_key, public_key, wrapped_private_key, ${NAMES} FROM users WHERE id = ?`).get(dev.user_id);
    return { email: u.email, kdf: JSON.parse(u.kdf), wrapped_data_key: u.wrapped_data_key, public_key: u.public_key, wrapped_private_key: u.wrapped_private_key, username: u.username, first_name: u.first_name, last_name: u.last_name };
  },

  // Your name as others see it. Blank clears; a username someone else has is refused.
  'POST /api/profile': ({ req, body }) => {
    const dev = authed(req);
    const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) || null;
    const username = clean(body.username, 30);
    if (username && !/^[A-Za-z0-9][A-Za-z0-9._-]{2,29}$/.test(username)) throw new HttpError(400, 'A username is 3 to 30 letters, numbers, dots, dashes or underscores');
    if (username && db.prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE AND id != ?').get(username, dev.user_id)) throw new HttpError(409, 'Someone on this server already has that username');
    db.prepare('UPDATE users SET username = ?, first_name = ?, last_name = ? WHERE id = ?').run(username, clean(body.first_name, 40), clean(body.last_name, 40), dev.user_id);
    return db.prepare(`SELECT ${NAMES} FROM users WHERE id = ?`).get(dev.user_id);
  },

  // ---------- sharing ----------
  // Each account has a key pair made by the app: the public key is stored as
  // it is, the private key encrypted with the account's data key. A share has
  // its own key, which the app encrypts for each member with their public key.

  // Set once: replacing it would lock the account out of what it was given.
  'POST /api/keypair': ({ req, body }) => {
    const dev = authed(req);
    if (typeof body.public_key !== 'string' || typeof body.wrapped_private_key !== 'string' || body.public_key.length > 4000 || body.wrapped_private_key.length > 8000) throw new HttpError(400, 'Missing keys');
    db.prepare('UPDATE users SET public_key = ?, wrapped_private_key = ? WHERE id = ? AND public_key IS NULL').run(body.public_key, body.wrapped_private_key, dev.user_id);
    const u = db.prepare('SELECT public_key, wrapped_private_key FROM users WHERE id = ?').get(dev.user_id);
    return u;
  },

  // Someone on this server to share with, by their sign-in email.
  'POST /api/people/find': ({ req, body }) => {
    authed(req);
    const email = String(body.email || '').trim().toLowerCase();
    const u = db.prepare(`SELECT id, email, public_key, ${NAMES} FROM users WHERE email = ?`).get(email);
    if (!u) throw new HttpError(404, 'Nobody on this server signs in with that email');
    if (!u.public_key) throw new HttpError(409, 'They need to open Open Flashcards and sync once before things can be shared with them');
    return { user_id: u.id, email: u.email, public_key: u.public_key, username: u.username, first_name: u.first_name, last_name: u.last_name };
  },

  // Every share this account is in, with its key (encrypted for this account) and who else is in it.
  'GET /api/shares': ({ req }) => {
    const dev = authed(req);
    const shares = db.prepare(`SELECT s.id, s.owner_id, s.last_seq, s.info, s.created_at, m.wrapped_key, m.accepted_at, o.email AS owner_email
      FROM shares s JOIN share_members m ON m.share_id = s.id AND m.user_id = ? JOIN users o ON o.id = s.owner_id ORDER BY s.created_at`).all(dev.user_id);
    const members = db.prepare('SELECT u.id AS user_id, u.email, u.username, u.first_name, u.last_name, m.added_at, m.accepted_at FROM share_members m JOIN users u ON u.id = m.user_id WHERE m.share_id = ? ORDER BY m.added_at');
    return { user_id: dev.user_id, shares: shares.map(s => ({ ...s, mine: s.owner_id === dev.user_id, members: members.all(s.id) })) };
  },

  'POST /api/shares': ({ req, body }) => {
    const dev = authed(req);
    const shareId = String(body.id || '');
    if (!/^[0-9a-f-]{36}$/.test(shareId)) throw new HttpError(400, 'Bad share id');
    if (typeof body.wrapped_key !== 'string' || body.wrapped_key.length > 4000) throw new HttpError(400, 'Missing key');
    if (typeof body.info !== 'string' || body.info.length > 4000) throw new HttpError(400, 'Missing info');
    if (db.prepare('SELECT 1 FROM shares WHERE id = ?').get(shareId)) throw new HttpError(409, 'That share already exists');
    db.prepare('INSERT INTO shares (id, owner_id, info, created_at) VALUES (?, ?, ?, ?)').run(shareId, dev.user_id, body.info, now());
    db.prepare('INSERT INTO share_members (share_id, user_id, wrapped_key, added_at, accepted_at) VALUES (?, ?, ?, ?, ?)').run(shareId, dev.user_id, body.wrapped_key, now(), now());
    return { ok: true };
  },

  'POST /api/shares/:id/members': ({ req, params, body }) => {
    const dev = authed(req);
    ownShare(dev.user_id, params.id);
    if (typeof body.user_id !== 'string' || typeof body.wrapped_key !== 'string' || body.wrapped_key.length > 4000) throw new HttpError(400, 'Missing key');
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(body.user_id)) throw new HttpError(404, 'No such account');
    if (db.prepare('SELECT 1 FROM share_members WHERE share_id = ? AND user_id = ?').get(params.id, body.user_id)) throw new HttpError(409, 'Already shared with them');
    db.prepare('INSERT INTO share_members (share_id, user_id, wrapped_key, added_at) VALUES (?, ?, ?, ?)').run(params.id, body.user_id, body.wrapped_key, now());
    return { ok: true };
  },

  // An invitation is only used once its person accepts it (declining is leaving).
  'POST /api/shares/:id/accept': ({ req, params }) => {
    const dev = authed(req);
    shareFor(dev.user_id, params.id, { invited: true });
    db.prepare('UPDATE share_members SET accepted_at = COALESCE(accepted_at, ?) WHERE share_id = ? AND user_id = ?').run(now(), params.id, dev.user_id);
    return { ok: true };
  },

  // The owner takes someone out, or a member leaves (or declines).
  'DELETE /api/shares/:id/members/:user': ({ req, params }) => {
    const dev = authed(req);
    const share = shareFor(dev.user_id, params.id, { invited: true });
    if (params.user !== dev.user_id && share.owner_id !== dev.user_id) throw new HttpError(403, 'Only the person who shared it can do that');
    if (params.user === share.owner_id) throw new HttpError(400, 'The person who shared it stops sharing instead');
    db.prepare('DELETE FROM share_members WHERE share_id = ? AND user_id = ?').run(params.id, params.user);
    return { ok: true };
  },

  // Stop sharing: the share and its records go (the owner's app has put them back in the owner's own records first).
  'DELETE /api/shares/:id': ({ req, params }) => {
    const dev = authed(req);
    ownShare(dev.user_id, params.id);
    db.prepare('DELETE FROM shares WHERE id = ?').run(params.id);
    return { ok: true };
  },

  'POST /api/shares/:id/push': ({ req, params, body }) => {
    const dev = authed(req);
    const share = shareFor(dev.user_id, params.id);
    return pushInto(SHARED, share.id, share.owner_id, body);
  },

  'GET /api/shares/:id/pull': ({ req, params, query }) => {
    const dev = authed(req);
    return pullFrom(SHARED, shareFor(dev.user_id, params.id).id, query);
  },

  // Change the password while signed in (the old one must be right).
  'POST /api/password': async ({ req, body, ip }) => {
    const dev = authed(req);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(dev.user_id);
    checkLimit(`e:${user.email}`);
    checkLimit(`i:${ip}`);
    if (typeof body.old_auth_hash !== 'string' || !same(await scrypt(body.old_auth_hash, user.auth_salt), user.auth_hash)) {
      fail(`e:${user.email}`); fail(`i:${ip}`);
      throw new HttpError(401, 'The current password is wrong');
    }
    replacePassword(user.id, body);
    db.prepare('DELETE FROM devices WHERE user_id = ? AND id != ?').run(user.id, dev.id);
    return { ok: true };
  },

  'POST /api/logout': ({ req }) => {
    const dev = authed(req);
    db.prepare('DELETE FROM devices WHERE id = ?').run(dev.id);
    return { ok: true };
  },

  'GET /api/devices': ({ req }) => {
    const dev = authed(req);
    return { devices: db.prepare('SELECT id, name, created_at, last_seen FROM devices WHERE user_id = ? ORDER BY last_seen DESC').all(dev.user_id).map(d => ({ ...d, this: d.id === dev.id })) };
  },

  'DELETE /api/devices/:id': ({ req, params }) => {
    const dev = authed(req);
    db.prepare('DELETE FROM devices WHERE id = ? AND user_id = ?').run(params.id, dev.user_id);
    return { ok: true };
  },

  'POST /api/sync/push': ({ req, body }) => {
    const dev = authed(req);
    return pushInto(PERSONAL, dev.user_id, dev.user_id, body);
  },

  'GET /api/sync/pull': ({ req, query }) => pullFrom(PERSONAL, authed(req).user_id, query),

  // Records that now live in a share: their old copy in the account's own records goes.
  'POST /api/sync/forget': ({ req, body }) => {
    const dev = authed(req);
    const ids = Array.isArray(body.record_ids) ? body.record_ids.filter(x => typeof x === 'string').slice(0, 2000) : [];
    const del = db.prepare('DELETE FROM records WHERE user_id = ? AND record_id = ?');
    for (const rid of ids) del.run(dev.user_id, rid);
    return { ok: true, forgotten: ids.length };
  },

  'GET /api/usage': ({ req }) => {
    const dev = authed(req);
    return { bytes: usage(dev.user_id), quota: quotaOf(dev.user_id), limited: !isAdminId(dev.user_id) };
  },

  // ---------- admin (ADMIN_EMAILS; the page is /admin) ----------
  // Nothing here can read anyone's data: only how much there is and when it was last used.

  'GET /api/admin/summary': ({ req }) => { adminOf(req); return summary(); },

  // Reading the list counts as having seen who is new.
  'GET /api/admin/accounts': ({ req }) => {
    adminOf(req);
    const today = now().slice(0, 10);
    const week = new Date(Date.now() - 6 * DAY_MS).toISOString().slice(0, 10);
    const seen = metaGet('admin_seen') || '';
    const accounts = db.prepare(`SELECT u.id, u.email, u.created_at, u.quota_mb, u.email_confirmed_at,
        (u.email IN (SELECT email FROM whitelist)) AS whitelisted,
        (SELECT COUNT(*) FROM devices d WHERE d.user_id = u.id) AS devices,
        (SELECT MAX(last_seen) FROM devices d WHERE d.user_id = u.id) AS last_seen,
        (SELECT COUNT(*) FROM records r WHERE r.user_id = u.id) AS records,
        (SELECT COUNT(*) FROM blobs b WHERE b.user_id = u.id) AS files,
        (SELECT COALESCE(SUM(size_bytes), 0) FROM records r WHERE r.user_id = u.id) + (SELECT COALESCE(SUM(size_bytes), 0) FROM blobs b WHERE b.user_id = u.id) AS stored_bytes,
        (SELECT COALESCE(SUM(requests), 0) FROM activity a WHERE a.user_id = u.id AND a.day = ?) AS requests_today,
        (SELECT COALESCE(SUM(bytes_in), 0) FROM activity a WHERE a.user_id = u.id AND a.day = ?) AS bytes_in_today,
        (SELECT COALESCE(SUM(refused), 0) FROM activity a WHERE a.user_id = u.id AND a.day = ?) AS refused_today,
        (SELECT COALESCE(SUM(bytes_in), 0) FROM activity a WHERE a.user_id = u.id AND a.day >= ?) AS bytes_in_week
      FROM users u ORDER BY u.created_at DESC`).all(today, today, today, week).map(({ id: userId, ...row }) => ({ ...row, whitelisted: !!row.whitelisted, is_admin: isAdminId(userId), under_a_day: isUnderADay(row), is_new: row.created_at > seen, quota_bytes: quotaOf(userId) }));
    const out = {
      ...summary(), list: accounts, whitelist: db.prepare('SELECT email FROM whitelist ORDER BY email').all().map(w => w.email),
      signups_week: db.prepare('SELECT substr(at, 1, 10) AS day, COUNT(*) AS n FROM signups WHERE at >= ? GROUP BY day ORDER BY day').all(week),
    };
    metaSet('admin_seen', now());
    return out;
  },

  // Add to, remove from, or replace the whole whitelist. An address needn't have an account yet.
  'POST /api/admin/whitelist': ({ req, body }) => {
    adminOf(req);
    if (!['add', 'remove', 'replace'].includes(body.op)) throw new HttpError(400, 'Use add, remove or replace');
    const emails = cleanEmails(body.emails);
    const add = db.prepare('INSERT OR IGNORE INTO whitelist (email, added_at) VALUES (?, ?)');
    const remove = db.prepare('DELETE FROM whitelist WHERE email = ?');
    db.exec('BEGIN IMMEDIATE');
    try {
      if (body.op === 'replace') db.exec('DELETE FROM whitelist');
      for (const email of emails) { if (body.op === 'remove') remove.run(email); else add.run(email, now()); }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return { whitelist: db.prepare('SELECT email FROM whitelist ORDER BY email').all().map(w => w.email) };
  },

  'POST /api/admin/delete': ({ req, body }) => {
    adminOf(req);
    const email = String(body.email || '').trim().toLowerCase();
    const target = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (target && isAdminId(target.id)) throw new HttpError(400, "The admin's own account can't be deleted here");
    const hit = db.prepare('DELETE FROM users WHERE email = ?').run(email);
    if (!hit.changes) throw new HttpError(404, 'No account with that email');
    return { ok: true };
  },

  // Every account not on the whitelist. Accounts under a day old stay unless asked for: they were promised 24 hours.
  'POST /api/admin/delete-unlisted': ({ req, body }) => {
    adminOf(req);
    if (body.confirm !== 'DELETE') throw new HttpError(400, 'Type DELETE to confirm');
    const doomed = db.prepare('SELECT id, email, created_at FROM users WHERE email NOT IN (SELECT email FROM whitelist)').all().filter(user => !isAdminId(user.id) && (body.include_new === true || !isUnderADay(user)));
    const del = db.prepare('DELETE FROM users WHERE email = ?');
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const user of doomed) del.run(user.email);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return { deleted: doomed.map(user => user.email) };
  },

  // Quotas for the chosen accounts, or everyone (`all`). set: a number of MB. add: raise or lower by MB. percent: raise or lower by a percentage. reset: back to the default. Never below 0; the admin's account isn't affected.
  'POST /api/admin/quota': ({ req, body }) => {
    adminOf(req);
    const everyone = db.prepare('SELECT id, email, quota_mb FROM users').all().filter(user => !isAdminId(user.id));
    const chosen = new Set(cleanEmails(body.emails));
    const users = body.all === true ? everyone : everyone.filter(user => chosen.has(user.email));
    const value = Number(body.value);
    if (body.op !== 'reset' && (!Number.isFinite(value) || Math.abs(value) > 100000)) throw new HttpError(400, 'Use a number');
    if (body.op === 'set') quotaNumber(value);
    const next = {
      set: () => value,
      add: mb => mb + value,
      percent: mb => mb * (1 + value / 100),
      reset: () => null,
    }[body.op];
    if (!next) throw new HttpError(400, 'Use set, add, percent or reset');
    const put = db.prepare('UPDATE users SET quota_mb = ? WHERE id = ?');
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const user of users) {
        const mb = next(user.quota_mb ?? defaultQuotaMb());
        put.run(mb === null ? null : Math.min(100000, Math.max(0, Math.round(mb * 100) / 100)), user.id);
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return { changed: users.length };
  },

  // The limit for every account without one of its own, and the quick choices on the page.
  'POST /api/admin/quota-defaults': ({ req, body }) => {
    adminOf(req);
    if (body.default_mb !== undefined) metaSet('default_quota_mb', quotaNumber(body.default_mb));
    if (body.templates !== undefined) {
      if (!Array.isArray(body.templates) || body.templates.length > 20) throw new HttpError(400, 'Up to 20 templates');
      metaSet('quota_templates', JSON.stringify(body.templates.map(item => ({ name: String(item.name || '').trim().slice(0, 40), mb: quotaNumber(item.mb) })).filter(item => item.name)));
    }
    return summary();
  },

  // The big switch: nobody but the admin can sync, sign in or sign up until it's turned back on. Nothing is deleted.
  'POST /api/admin/all-off': ({ req, body }) => {
    adminOf(req);
    metaSet('all_off', body.off === true ? '1' : '0');
    return summary();
  },

  'POST /api/admin/registration': ({ req, body }) => {
    adminOf(req);
    if (body.state !== undefined) {
      if (!['open', 'closed'].includes(body.state)) throw new HttpError(400, 'Use open or closed');
      metaSet('registration', body.state);
    }
    if (body.limit !== undefined) {
      const limit = Number(body.limit);
      if (!Number.isInteger(limit) || limit < 0 || limit > 1000) throw new HttpError(400, 'The daily limit is a whole number from 0 (no limit) to 1000');
      metaSet('signup_limit', limit);
    }
    return summary();
  },
};

function match(method, pathname) {
  for (const [key, fn] of Object.entries(routes)) {
    const [m, pattern] = key.split(' ');
    if (m !== method) continue;
    const names = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, n) => { names.push(n); return '([^/]+)'; })}$`);
    const hit = re.exec(pathname);
    if (!hit) continue;
    try { return { fn, params: Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(hit[i + 1])])) }; } catch { throw new HttpError(400, 'Bad address'); }
  }
  return null;
}

// Attachment files: encrypted bytes under an opaque id. PUT stores (or replaces),
// GET returns them, GET lists what is held, DELETE removes one. Your own are at
// /api/blobs; a share's (photos on shared things, for everyone in it, counted
// against the owner's quota) at /api/shares/<id>/blobs.
async function blobs(req, res, url, origin) {
  const dev = authed(req);
  const m = /^\/api\/(?:shares\/([0-9a-f-]{36})\/)?blobs(?:\/([0-9a-f]{40}))?$/.exec(url.pathname);
  if (!m) throw new HttpError(400, 'Bad file id');
  const share = m[1] ? shareFor(dev.user_id, m[1]) : null;
  const [table, key, owner, quotaUser] = share ? ['share_blobs', 'share_id', share.id, share.owner_id] : ['blobs', 'user_id', dev.user_id, dev.user_id];
  const id = m[2];
  const cors = origin && ORIGINS.includes(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
  if (!id) {
    if (req.method !== 'GET') throw new HttpError(405, 'Not allowed');
    return send(res, 200, { blobs: db.prepare(`SELECT blob_id AS id, size_bytes AS size FROM ${table} WHERE ${key} = ?`).all(owner) }, origin);
  }
  if (req.method === 'PUT') {
    const data = await readRaw(req, MAX_BLOB);
    if (!data.length) throw new HttpError(400, 'Empty file');
    const had = db.prepare(`SELECT size_bytes FROM ${table} WHERE ${key} = ? AND blob_id = ?`).get(owner, id)?.size_bytes || 0;
    if (usage(quotaUser) - had + data.length > quotaOf(quotaUser)) { noteActivity(quotaUser, { refused: 1 }); throw new HttpError(507, quotaMessage(quotaUser)); }
    noteActivity(quotaUser, { bytes: data.length });
    db.prepare(`INSERT OR REPLACE INTO ${table} (${key}, blob_id, size_bytes, data) VALUES (?, ?, ?, ?)`).run(owner, id, data.length, data);
    return send(res, 200, { ok: true, size: data.length }, origin);
  }
  if (req.method === 'GET') {
    const row = db.prepare(`SELECT data FROM ${table} WHERE ${key} = ? AND blob_id = ?`).get(owner, id);
    if (!row) throw new HttpError(404, 'No such file');
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': row.data.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...cors });
    return res.end(Buffer.from(row.data));
  }
  if (req.method === 'DELETE') {
    db.prepare(`DELETE FROM ${table} WHERE ${key} = ? AND blob_id = ?`).run(owner, id);
    return send(res, 200, { ok: true }, origin);
  }
  throw new HttpError(405, 'Not allowed');
}

// The admin page: one fixed page and its script, allowed to load nothing else.
const ADMIN_FILES = { '/admin': ['admin-page.html', 'text/html; charset=utf-8'], '/admin/admin-page.js': ['admin-page.js', 'text/javascript; charset=utf-8'], '/admin/admin-page.css': ['admin-page.css', 'text/css; charset=utf-8'] };
function adminFile(req, res, url) {
  const file = ADMIN_FILES[url.pathname.replace(/\/$/, '')];
  if (!file || req.method !== 'GET') throw new HttpError(404, 'Not found');
  res.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
  res.end(fs.readFileSync(new URL(file[0], import.meta.url)));
}

// Sign-in and account requests are the only ones allowed before a device is known.
const PUBLIC = new Set(['/api/signup/code', '/api/prelogin', '/api/register', '/api/login', '/api/recover']);

// The caller's address: behind Caddy or Apache (the server only listens on
// 127.0.0.1) it is the last X-Forwarded-For entry, the one the proxy added.
// Earlier entries come from the caller and can be made up.
function clientIp(req) {
  const direct = req.socket.remoteAddress;
  const forwarded = req.headers['x-forwarded-for'];
  if (!forwarded || !/^(127\.|::1$|::ffff:127\.)/.test(direct || '')) return direct;
  return forwarded.split(',').at(-1).trim() || direct;
}

async function handle(req, res) {
  const origin = req.headers.origin;
  if (req.method === 'OPTIONS') {
    // Chrome asks before a public site (the app on github.io) talks to a
    // server on a private network; this says it may.
    const headers = { 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600', 'Access-Control-Allow-Private-Network': 'true' };
    if (origin && ORIGINS.includes(origin)) Object.assign(headers, { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' });
    res.writeHead(204, headers);
    return res.end();
  }
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) return adminFile(req, res, url);
  if (!SHARING && /^\/api\/(shares|people|keypair)(\/|$)/.test(url.pathname)) return send(res, 404, { error: 'Sharing is off on this server' }, origin);
  if (/^\/api\/(shares\/[^/]+\/)?blobs(\/|$)/.test(url.pathname)) return blobs(req, res, url, origin);
  const route = match(req.method, url.pathname);
  if (!route) return send(res, 404, { error: 'Not found' }, origin);
  const body = req.method === 'POST' ? await readJson(req, PUBLIC.has(url.pathname) ? MAX_PUBLIC_BODY : MAX_BODY) : {};
  const out = await route.fn({ req, body, params: route.params, query: url.searchParams, ip: clientIp(req) });
  send(res, 200, out, origin);
}

// Any error, from any request, becomes an answer: nothing a caller sends can stop the server.
const server = http.createServer(async (req, res) => {
  try { await handle(req, res); } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    if (res.headersSent) return res.destroy();
    try { send(res, status, { error: status === 500 ? 'Server error' : e.message }, req.headers.origin); } catch { res.destroy(); }
  }
});

server.listen(PORT, HOST, () => console.log(`open-flashcards-server listening on ${HOST}:${PORT} (registration: ${registrationSetting()}, origins: ${ORIGINS.join(' ')})`));
