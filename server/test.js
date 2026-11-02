// End-to-end check of open-flashcards-server against a throwaway database.
//   node test.js      (starts its own server on a spare port)

import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flashcards-test-'));
const PORT = 18000 + Math.floor(Math.random() * 1000);
const child = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT, DATA_DIR: dir, REGISTRATION: 'first', SHARING: 'on' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise(r => child.stdout.once('data', r));
const base = `http://127.0.0.1:${PORT}`;

async function call(method, url, body, token) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, cors: res.headers.get('access-control-allow-origin'), json: await res.json().catch(() => null) };
}

try {
  let r = await call('GET', '/api/health');
  assert.equal(r.json.registration, 'open');

  r = await call('POST', '/api/register', { email: 'User@Example.com', auth_hash: 'a'.repeat(44), kdf: { name: 'PBKDF2-SHA256', iterations: 600000, salt: 's' }, wrapped_data_key: 'wrapped', recovery_hash: 'r'.repeat(44), device_name: 'Laptop' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.cors, 'http://localhost:5173');
  const laptop = r.json.token;

  r = await call('POST', '/api/register', { email: 'other@example.com', auth_hash: 'b'.repeat(44), kdf: {}, wrapped_data_key: 'x' });
  assert.equal(r.status, 403, 'second registration refused');

  r = await call('POST', '/api/prelogin', { email: 'user@example.com' });
  assert.equal(r.json.kdf.salt, 's');

  r = await call('POST', '/api/login', { email: 'user@example.com', auth_hash: 'wrong'.repeat(9), device_name: 'Phone' });
  assert.equal(r.status, 401);
  r = await call('POST', '/api/login', { email: 'user@example.com', auth_hash: 'a'.repeat(44), device_name: 'Phone' });
  assert.equal(r.status, 200);
  assert.equal(r.json.wrapped_data_key, 'wrapped');
  const phone = r.json.token;

  // push two new records from the laptop
  r = await call('POST', '/api/sync/push', { records: [{ record_id: 'r1', base_seq: 0, ciphertext: 'c1' }, { record_id: 'r2', base_seq: 0, ciphertext: 'c2' }] }, laptop);
  assert.deepEqual(r.json.accepted.map(a => a.seq), [1, 2]);

  // the phone pulls them
  r = await call('GET', '/api/sync/pull?since=0', null, phone);
  assert.equal(r.json.records.length, 2);
  assert.equal(r.json.last_seq, 2);

  // the phone edits r1 (knows seq 1): accepted
  r = await call('POST', '/api/sync/push', { records: [{ record_id: 'r1', base_seq: 1, ciphertext: 'c1-phone' }] }, phone);
  assert.equal(r.json.accepted[0].seq, 3);

  // the laptop still thinks r1 is at seq 1: conflict, gets the phone's copy back
  r = await call('POST', '/api/sync/push', { records: [{ record_id: 'r1', base_seq: 1, ciphertext: 'c1-laptop' }] }, laptop);
  assert.equal(r.json.accepted.length, 0);
  assert.equal(r.json.conflicts[0].ciphertext, 'c1-phone');
  assert.equal(r.json.conflicts[0].seq, 3);

  // after merging, the laptop pushes on top of seq 3
  r = await call('POST', '/api/sync/push', { records: [{ record_id: 'r1', base_seq: 3, ciphertext: 'c1-merged' }] }, laptop);
  assert.equal(r.json.accepted[0].seq, 4);

  r = await call('GET', '/api/sync/pull?since=2', null, phone);
  assert.deepEqual(r.json.records.map(x => [x.record_id, x.seq, x.ciphertext]), [['r1', 4, 'c1-merged']]);

  r = await call('GET', '/api/devices', null, laptop);
  assert.equal(r.json.devices.length, 2);

  r = await call('GET', '/api/sync/pull?since=0', null, 'nonsense');
  assert.equal(r.status, 401);

  r = await call('GET', '/api/me', null, laptop);
  assert.equal(r.json.wrapped_data_key, 'wrapped');

  // change the password: needs the old one; other devices are signed out
  r = await call('POST', '/api/password', { old_auth_hash: 'nope'.repeat(11), auth_hash: 'c'.repeat(44), kdf: { salt: 's2' }, wrapped_data_key: 'wrapped2' }, laptop);
  assert.equal(r.status, 401);
  r = await call('POST', '/api/password', { old_auth_hash: 'a'.repeat(44), auth_hash: 'c'.repeat(44), kdf: { salt: 's2' }, wrapped_data_key: 'wrapped2' }, laptop);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  r = await call('GET', '/api/sync/pull?since=0', null, phone);
  assert.equal(r.status, 401, 'other devices signed out');
  r = await call('GET', '/api/sync/pull?since=0', null, laptop);
  assert.equal(r.status, 200, 'this device stays signed in');
  r = await call('POST', '/api/login', { email: 'user@example.com', auth_hash: 'a'.repeat(44) });
  assert.equal(r.status, 401, 'old password no longer works');
  r = await call('POST', '/api/login', { email: 'user@example.com', auth_hash: 'c'.repeat(44) });
  assert.equal(r.json.wrapped_data_key, 'wrapped2');

  // forgot the password: the recovery code sets a new one and signs everything else out
  r = await call('POST', '/api/recover', { email: 'user@example.com', recovery_hash: 'x'.repeat(44), auth_hash: 'd'.repeat(44), kdf: {}, wrapped_data_key: 'w3' });
  assert.equal(r.status, 401);
  r = await call('POST', '/api/recover', { email: 'user@example.com', recovery_hash: 'r'.repeat(44), auth_hash: 'd'.repeat(44), kdf: { salt: 's3' }, wrapped_data_key: 'w3', device_name: 'Recovered' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const recovered = r.json.token;
  r = await call('GET', '/api/sync/pull?since=0', null, laptop);
  assert.equal(r.status, 401, 'recovery signs out every other device');
  r = await call('GET', '/api/sync/pull?since=0', null, recovered);
  assert.equal(r.json.records.length, 2, 'data is still there');
  r = await call('POST', '/api/login', { email: 'user@example.com', auth_hash: 'd'.repeat(44) });
  assert.equal(r.json.wrapped_data_key, 'w3');

  // attachment files: raw encrypted bytes under an opaque id
  const fid = 'ab'.repeat(20);
  const raw = (method, path, body, token) => fetch(base + path, { method, headers: { Origin: 'http://localhost:5173', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body });
  let f = await raw('PUT', `/api/blobs/${fid}`, Buffer.from([1, 2, 3, 4, 5]), 'nonsense');
  assert.equal(f.status, 401, 'files need a signed-in device');
  f = await raw('PUT', `/api/blobs/${fid}`, Buffer.from([1, 2, 3, 4, 5]), recovered);
  assert.equal(f.status, 200);
  f = await raw('PUT', '/api/blobs/not-an-id', Buffer.from([1]), recovered);
  assert.equal(f.status, 400, 'ids are 40 hex characters');
  f = await raw('GET', `/api/blobs/${fid}`, undefined, recovered);
  assert.deepEqual([...new Uint8Array(await f.arrayBuffer())], [1, 2, 3, 4, 5]);
  assert.equal(f.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  f = await raw('GET', '/api/blobs', undefined, recovered);
  assert.deepEqual((await f.json()).blobs, [{ id: fid, size: 5 }]);
  r = await call('GET', '/api/usage', null, recovered);
  assert.ok(r.json.bytes >= 5 + 'c2'.length, 'files count towards the quota');
  f = await raw('GET', `/api/blobs/${'cd'.repeat(20)}`, undefined, recovered);
  assert.equal(f.status, 404);
  f = await raw('DELETE', `/api/blobs/${fid}`, undefined, recovered);
  assert.equal(f.status, 200);
  f = await raw('GET', `/api/blobs/${fid}`, undefined, recovered);
  assert.equal(f.status, 404, 'deleted');

  // a device moving over from another server still has that server's seq numbers
  r = await call('POST', '/api/sync/push', { records: [{ record_id: 'moved-in', base_seq: 500, ciphertext: 'm' }] }, recovered);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.accepted.length, 1, 'a record the server has never seen is accepted');

  // sharing: a second account, added straight to the database (registration is "first")
  const { DatabaseSync } = await import('node:sqlite');
  const { createHash } = await import('node:crypto');
  const side = new DatabaseSync(path.join(dir, 'flashcards.db'));
  side.prepare("INSERT INTO users (id, email, auth_hash, auth_salt, kdf, wrapped_data_key, created_at) VALUES ('u2', 'fam@example.com', 'x', 'x', '{}', 'w', 'now')").run();
  side.prepare("INSERT INTO devices (id, user_id, name, token_hash, created_at) VALUES ('d2', 'u2', 'Fam', ?, 'now')").run(createHash('sha256').update('famtoken').digest('hex'));
  side.close();
  const fam = 'famtoken';
  const sid = '0190aaaa-bbbb-7ccc-8ddd-eeeeeeeeeeee';

  r = await call('POST', '/api/people/find', { email: 'fam@example.com' }, recovered);
  assert.equal(r.status, 409, 'no key pair yet');
  r = await call('POST', '/api/keypair', { public_key: 'pub2', wrapped_private_key: 'priv2' }, fam);
  assert.equal(r.json.public_key, 'pub2');
  r = await call('POST', '/api/keypair', { public_key: 'other', wrapped_private_key: 'other' }, fam);
  assert.equal(r.json.public_key, 'pub2', 'a key pair is set once');
  r = await call('GET', '/api/me', null, fam);
  assert.equal(r.json.wrapped_private_key, 'priv2');
  r = await call('POST', '/api/people/find', { email: 'Fam@Example.com' }, recovered);
  assert.deepEqual(r.json, { user_id: 'u2', email: 'fam@example.com', public_key: 'pub2', username: null, first_name: null, last_name: null });
  r = await call('POST', '/api/people/find', { email: 'nobody@example.com' }, recovered);
  assert.equal(r.status, 404);

  r = await call('POST', '/api/shares', { id: sid, wrapped_key: 'k-owner', info: 'sealed' }, recovered);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  r = await call('GET', `/api/shares/${sid}/pull?since=0`, null, fam);
  assert.equal(r.status, 404, 'not shared with them yet');
  r = await call('POST', `/api/shares/${sid}/members`, { user_id: 'u2', wrapped_key: 'k-fam' }, fam);
  assert.equal(r.status, 404, 'only members, and only the owner, can add people');
  r = await call('POST', `/api/shares/${sid}/members`, { user_id: 'u2', wrapped_key: 'k-fam' }, recovered);
  assert.equal(r.status, 200);
  r = await call('GET', '/api/shares', null, fam);
  assert.equal(r.json.shares.length, 1);
  assert.equal(r.json.shares[0].wrapped_key, 'k-fam');
  assert.equal(r.json.shares[0].owner_email, 'user@example.com');
  assert.equal(r.json.shares[0].mine, false);
  assert.equal(r.json.shares[0].info, 'sealed');
  assert.equal(r.json.shares[0].accepted_at, null, 'only invited so far');
  assert.deepEqual(r.json.shares[0].members.map(m => m.email), ['user@example.com', 'fam@example.com']);
  assert.equal(r.json.shares[0].members[0].first_name, null, 'no name set yet');
  // names: optional, shown to people sharing with you; usernames unique on the server
  r = await call('POST', '/api/profile', { username: 'mat', first_name: '  Mat ', last_name: 'S<b>' }, recovered);
  assert.deepEqual(r.json, { username: 'mat', first_name: 'Mat', last_name: 'Sb' });
  r = await call('POST', '/api/profile', { username: 'MAT', first_name: 'Anna' }, fam);
  assert.equal(r.status, 409, 'username taken, whatever the case');
  r = await call('POST', '/api/profile', { username: 'a b' }, fam);
  assert.equal(r.status, 400, 'no spaces in a username');
  r = await call('POST', '/api/profile', { first_name: 'Anna' }, fam);
  assert.deepEqual(r.json, { username: null, first_name: 'Anna', last_name: null });
  r = await call('POST', '/api/profile', { username: 'Mat', first_name: 'Mat', last_name: '' }, recovered);
  assert.equal(r.json.username, 'Mat', 'keeping your own username in another case is fine');
  r = await call('GET', '/api/me', null, recovered);
  assert.equal(r.json.first_name, 'Mat');
  r = await call('GET', '/api/shares', null, fam);
  assert.deepEqual(r.json.shares[0].members.map(m => m.first_name), ['Mat', 'Anna']);
  r = await call('POST', '/api/people/find', { email: 'fam@example.com' }, recovered);
  assert.equal(r.json.first_name, 'Anna');
  r = await call('GET', `/api/shares/${sid}/pull?since=0`, null, fam);
  assert.equal(r.status, 404, 'not usable until accepted');
  r = await call('POST', `/api/shares/${sid}/members`, { user_id: 'u2', wrapped_key: 'k-fam' }, recovered);
  assert.equal(r.status, 409, 'invited once');
  r = await call('POST', `/api/shares/${sid}/accept`, null, fam);
  assert.equal(r.status, 200);

  // both push and pull in the share, with the same conflict check as an account's own records
  r = await call('POST', `/api/shares/${sid}/push`, { records: [{ record_id: 's1', base_seq: 0, ciphertext: 'list' }] }, recovered);
  assert.equal(r.json.accepted[0].seq, 1);
  r = await call('POST', `/api/shares/${sid}/push`, { records: [{ record_id: 's1', base_seq: 1, ciphertext: 'list-fam' }] }, fam);
  assert.equal(r.json.accepted[0].seq, 2);
  r = await call('POST', `/api/shares/${sid}/push`, { records: [{ record_id: 's1', base_seq: 1, ciphertext: 'list-owner' }] }, recovered);
  assert.equal(r.json.conflicts[0].ciphertext, 'list-fam');
  r = await call('GET', `/api/shares/${sid}/pull?since=0`, null, recovered);
  assert.deepEqual(r.json.records.map(x => [x.record_id, x.seq]), [['s1', 2]]);
  r = await call('GET', '/api/sync/pull?since=0', null, fam);
  assert.equal(r.json.records.length, 0, 'shared records stay out of their own records');
  r = await call('POST', '/api/sync/forget', { record_ids: ['r2'] }, recovered);
  assert.equal(r.status, 200);
  r = await call('GET', '/api/sync/pull?since=0', null, recovered);
  assert.ok(!r.json.records.some(x => x.record_id === 'r2'), 'a record moved into a share leaves the account\'s own records');
  const before = (await call('GET', '/api/usage', null, recovered)).json.bytes;
  assert.ok(before >= 'list-fam'.length, 'shared records count towards the owner');

  // a share's files: any member puts and gets them, the owner's quota pays, others can't reach them
  const sfid = 'ef'.repeat(20);
  f = await raw('PUT', `/api/shares/${sid}/blobs/${sfid}`, Buffer.from([9, 8, 7]), fam);
  assert.equal(f.status, 200, 'a member puts a file in the share');
  f = await raw('GET', `/api/shares/${sid}/blobs/${sfid}`, undefined, recovered);
  assert.deepEqual([...Buffer.from(await f.arrayBuffer())], [9, 8, 7], 'the owner gets it');
  f = await raw('GET', `/api/shares/${sid}/blobs`, undefined, fam);
  assert.deepEqual((await f.json()).blobs, [{ id: sfid, size: 3 }]);
  f = await raw('GET', `/api/blobs/${sfid}`, undefined, fam);
  assert.equal(f.status, 404, 'a share\'s files stay out of your own');
  assert.equal((await call('GET', '/api/usage', null, recovered)).json.bytes, before + 3, 'share files count towards the owner');
  f = await raw('GET', `/api/shares/${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}/blobs/${sfid}`, undefined, fam);
  assert.equal(f.status, 404, 'not a share of yours');

  // a member can leave but can't take the owner out; the owner can take someone out
  r = await call('DELETE', `/api/shares/${sid}/members/${'x'}`, null, fam);
  assert.equal(r.status, 403);
  r = await call('DELETE', `/api/shares/${sid}/members/u2`, null, fam);
  assert.equal(r.status, 200);
  r = await call('GET', `/api/shares/${sid}/pull?since=0`, null, fam);
  assert.equal(r.status, 404, 'gone once they left');
  r = await call('POST', `/api/shares/${sid}/members`, { user_id: 'u2', wrapped_key: 'k-fam' }, recovered);
  r = await call('GET', '/api/shares', null, fam);
  assert.equal(r.json.shares.length, 1, 'an invitation can be seen');
  r = await call('DELETE', `/api/shares/${sid}`, null, fam);
  assert.equal(r.status, 404, 'only the owner stops sharing');
  r = await call('DELETE', `/api/shares/${sid}`, null, recovered);
  assert.equal(r.status, 200);
  r = await call('GET', '/api/shares', null, fam);
  assert.equal(r.json.shares.length, 0, 'stopped: gone for everyone');
  r = await call('GET', `/api/shares/${sid}/pull?since=0`, null, recovered);
  assert.equal(r.status, 404);

  // nothing a caller sends can stop the server
  r = await call('DELETE', '/api/devices/%E0', null, recovered);
  assert.equal(r.status, 400, 'a bad percent code is refused');
  r = await call('GET', '/api/health');
  assert.equal(r.status, 200, 'still running after a bad address');
  r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'x@example.com', auth_hash: 'a'.repeat(100 * 1024) }) }).catch(() => ({ status: 413 }));
  assert.equal(r.status, 413, 'sign-in requests are kept small');

  // a made-up X-Forwarded-For doesn't get round the per-address limit
  const guess = n => fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.0.0.${n}, 203.0.113.9` }, body: JSON.stringify({ email: `nobody${n}@example.com`, auth_hash: 'z'.repeat(44) }) });
  for (let n = 0; n < 10; n++) await guess(n);
  assert.equal((await guess(99)).status, 429, 'limited by the address the proxy added');

  // ---------- an open server: daily limit, quota, admin ----------
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'flashcards-test-'));
  const PORT2 = PORT + 1000;
  const open = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: PORT2, DATA_DIR: dir2, REGISTRATION: 'open', QUOTA_MB: '1', MAX_SIGNUPS_PER_DAY: '3', ADMIN_EMAILS: 'boss@example.com' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise(done => open.stdout.once('data', done));
  const call2 = async (method, url, body, token) => {
    const res = await fetch(`http://127.0.0.1:${PORT2}${url}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, headers: res.headers, text: await res.clone().text(), json: await res.json().catch(() => null) };
  };
  const join = email => call2('POST', '/api/register', { email, auth_hash: 'a'.repeat(44), kdf: { salt: 's' }, wrapped_data_key: 'w', recovery_hash: 'r'.repeat(44), device_name: 'x' });
  try {
    const boss = (await join('boss@example.com')).json.token;
    const anna = (await join('anna@example.com')).json.token;
    r = await call2('GET', '/api/health');
    assert.equal(r.json.registration, 'open');
    // requests arriving together can't get past the limit
    const rush = await Promise.all(['c@example.com', 'd@example.com', 'e@example.com'].map(join));
    assert.equal(rush.filter(x => x.status === 200).length, 1, 'only the third sign-up of the day gets in');
    assert.equal(rush.filter(x => x.status === 403).length, 2);
    r = await call2('GET', '/api/health');
    assert.equal(r.json.registration, 'closed');
    assert.equal(r.json.day_is_full, true);

    // shares are off unless asked for
    r = await call2('POST', '/api/people/find', { email: 'boss@example.com' }, anna);
    assert.equal(r.status, 404);

    // quota: a normal account stops at 1 MB, the admin doesn't
    const big = 'x'.repeat(1100 * 1024);
    r = await call2('POST', '/api/sync/push', { records: [{ record_id: 'big', base_seq: 0, ciphertext: big }] }, anna);
    assert.equal(r.status, 507);
    assert.match(r.json.error, /limit of 1 MB/);
    r = await call2('POST', '/api/sync/push', { records: [{ record_id: 'small', base_seq: 0, ciphertext: 'c' }] }, anna);
    assert.equal(r.status, 200, 'room is still there after a refused push');
    r = await call2('POST', '/api/sync/push', { records: [{ record_id: 'big', base_seq: 0, ciphertext: big }] }, boss);
    assert.equal(r.status, 200, 'no limit for the admin');
    r = await call2('GET', '/api/usage', null, anna);
    assert.equal(r.json.limited, true);

    // admin only
    for (const [m, u] of [['GET', '/api/admin/summary'], ['GET', '/api/admin/accounts'], ['POST', '/api/admin/whitelist'], ['POST', '/api/admin/quota'], ['POST', '/api/admin/quota-defaults'], ['POST', '/api/admin/all-off'], ['POST', '/api/admin/delete'], ['POST', '/api/admin/delete-unlisted'], ['POST', '/api/admin/registration']]) {
      assert.equal((await call2(m, u, m === 'POST' ? { email: 'boss@example.com', confirm: 'DELETE', state: 'closed' } : null, anna)).status, 403, `${u} refused for others`);
      assert.equal((await call2(m, u, m === 'POST' ? { confirm: 'DELETE' } : null)).status, 401, `${u} refused without sign-in`);
    }
    r = await call2('GET', '/api/admin/summary', null, boss);
    assert.equal(r.json.accounts, 3);
    assert.equal(r.json.new_accounts, 3);
    r = await call2('GET', '/api/admin/accounts', null, boss);
    assert.equal(r.json.list.length, 3);
    assert.ok(r.json.list.find(x => x.email === 'anna@example.com').is_new);
    assert.equal(r.json.list.find(x => x.email === 'boss@example.com').is_admin, true);
    assert.ok(!('auth_hash' in r.json.list[0]), 'no secrets in the list');
    r = await call2('GET', '/api/admin/summary', null, boss);
    assert.equal(r.json.new_accounts, 0, 'seen once the list has been read');

    // closing and opening, and the limit
    r = await call2('POST', '/api/admin/registration', { limit: 0 }, boss);
    assert.equal(r.json.registration_now, 'open');
    r = await call2('POST', '/api/admin/registration', { state: 'closed' }, boss);
    assert.equal((await join('f@example.com')).status, 403);
    r = await call2('POST', '/api/admin/registration', { state: 'open', limit: 3 }, boss);
    assert.equal((await join('f@example.com')).status, 403, 'deleting or reopening does not free up the day');
    r = await call2('POST', '/api/admin/registration', { limit: -1 }, boss);
    assert.equal(r.status, 400);
    r = await call2('POST', '/api/admin/registration', { limit: 0 }, boss);
    assert.equal((await join('new@example.com')).status, 200);

    // the whitelist: add, remove, replace; an address needn't have an account yet
    r = await call2('POST', '/api/admin/whitelist', { op: 'add', emails: ['Anna@Example.com', 'nobody-yet@example.com', 'not an email'] }, boss);
    assert.deepEqual(r.json.whitelist, ['anna@example.com', 'nobody-yet@example.com']);
    r = await call2('POST', '/api/admin/whitelist', { op: 'remove', emails: ['nobody-yet@example.com'] }, boss);
    assert.deepEqual(r.json.whitelist, ['anna@example.com']);
    r = await call2('POST', '/api/admin/whitelist', { op: 'replace', emails: ['zed@example.com'] }, boss);
    assert.deepEqual(r.json.whitelist, ['zed@example.com']);
    r = await call2('POST', '/api/admin/whitelist', { op: 'replace', emails: ['anna@example.com'] }, boss);
    assert.deepEqual(r.json.whitelist, ['anna@example.com']);

    // quotas: one account, several, everyone, the default, templates
    const quotaOf = async email => (await call2('GET', '/api/admin/accounts', null, boss)).json.list.find(x => x.email === email);
    r = await call2('POST', '/api/admin/quota', { op: 'set', value: 3, emails: ['anna@example.com'] }, boss);
    assert.equal(r.json.changed, 1);
    assert.equal((await quotaOf('anna@example.com')).quota_mb, 3);
    assert.equal((await quotaOf('anna@example.com')).quota_bytes, 3 * 1048576);
    r = await call2('POST', '/api/sync/push', { records: [{ record_id: 'big2', base_seq: 0, ciphertext: big }] }, anna);
    assert.equal(r.status, 200, 'a raised limit lets it through');
    await call2('POST', '/api/admin/quota', { op: 'add', value: 2, emails: ['anna@example.com'] }, boss);
    assert.equal((await quotaOf('anna@example.com')).quota_mb, 5);
    await call2('POST', '/api/admin/quota', { op: 'percent', value: -50, emails: ['anna@example.com'] }, boss);
    assert.equal((await quotaOf('anna@example.com')).quota_mb, 2.5);
    await call2('POST', '/api/admin/quota', { op: 'add', value: -100, emails: ['anna@example.com'] }, boss);
    assert.equal((await quotaOf('anna@example.com')).quota_mb, 0, 'never below nothing');
    r = await call2('POST', '/api/admin/quota', { op: 'add', value: 10, all: true }, boss);
    assert.equal(r.json.changed, 3, 'everyone but the admin');
    assert.equal((await quotaOf('new@example.com')).quota_mb, 11, 'from the default, for an account with no limit of its own');
    assert.equal((await quotaOf('boss@example.com')).quota_mb, null);
    await call2('POST', '/api/admin/quota', { op: 'reset', all: true }, boss);
    assert.equal((await quotaOf('anna@example.com')).quota_mb, null);
    r = await call2('POST', '/api/admin/quota-defaults', { default_mb: 7, templates: [{ name: 'Big', mb: 50 }, { name: '', mb: 1 }] }, boss);
    assert.equal(r.json.quota_mb, 7);
    assert.deepEqual(r.json.templates, [{ name: 'Big', mb: 50 }]);
    assert.equal((await quotaOf('anna@example.com')).quota_bytes, 7 * 1048576, 'the default reaches accounts with no limit of their own');
    assert.equal((await call2('POST', '/api/admin/quota', { op: 'set', value: -1, all: true }, boss)).status, 400);
    assert.equal((await call2('POST', '/api/admin/quota', { op: 'nope', value: 1, all: true }, boss)).status, 400);
    assert.equal((await call2('POST', '/api/admin/quota-defaults', { default_mb: 'x' }, boss)).status, 400);

    // watching for abuse
    const watched = await quotaOf('anna@example.com');
    assert.ok(watched.requests_today > 0 && watched.bytes_in_today >= big.length, 'activity is counted');
    assert.ok(watched.refused_today >= 1, 'refusals at the limit are counted');
    assert.equal((await call2('GET', '/api/admin/accounts', null, boss)).json.signups_week.at(-1).n >= 3, true);

    // all off: nobody but the admin, and nothing is lost
    r = await call2('POST', '/api/admin/all-off', { off: true }, boss);
    assert.equal(r.json.all_off, true);
    r = await call2('GET', '/api/sync/pull?since=0', null, anna);
    assert.equal(r.status, 503);
    assert.match(r.json.error, /switched off/);
    assert.equal((await call2('POST', '/api/login', { email: 'anna@example.com', auth_hash: 'a'.repeat(44), device_name: 'x' })).status, 503);
    assert.equal((await join('later@example.com')).status, 403, 'no sign-ups');
    r = await call2('GET', '/api/health');
    assert.equal(r.json.all_off, true);
    assert.equal(r.json.registration, 'closed');
    assert.equal((await call2('GET', '/api/sync/pull?since=0', null, boss)).status, 200, 'the admin still gets in');
    assert.equal((await call2('POST', '/api/login', { email: 'boss@example.com', auth_hash: 'a'.repeat(44), device_name: 'x' })).status, 200);
    r = await call2('POST', '/api/admin/all-off', { off: false }, boss);
    assert.equal(r.json.all_off, false);
    r = await call2('GET', '/api/sync/pull?since=0', null, anna);
    assert.equal(r.status, 200, 'back on, still signed in');
    assert.ok(r.json.records.length >= 1, 'nothing was lost');

    r = await call2('POST', '/api/admin/delete-unlisted', { confirm: 'nope' }, boss);
    assert.equal(r.status, 400);
    r = await call2('POST', '/api/admin/delete-unlisted', { confirm: 'DELETE' }, boss);
    assert.deepEqual(r.json.deleted, [], 'accounts under a day old stay');
    const side2 = new DatabaseSync(path.join(dir2, 'flashcards.db'));
    side2.prepare("UPDATE users SET created_at = '2020-01-01T00:00:00.000Z' WHERE email != 'new@example.com'").run();
    side2.close();
    r = await call2('POST', '/api/admin/delete-unlisted', { confirm: 'DELETE' }, boss);
    const third = rush.findIndex(x => x.status === 200);
    assert.deepEqual(r.json.deleted, [['c@example.com', 'd@example.com', 'e@example.com'][third]], 'old and not on the list: deleted');
    r = await call2('POST', '/api/admin/delete-unlisted', { confirm: 'DELETE', include_new: true }, boss);
    assert.deepEqual(r.json.deleted, ['new@example.com'], 'new ones only when asked');
    r = await call2('POST', '/api/admin/delete', { email: 'boss@example.com' }, boss);
    assert.equal(r.status, 400, "the admin can't delete itself here");
    r = await call2('GET', '/api/admin/accounts', null, boss);
    assert.deepEqual(r.json.list.map(x => x.email).sort(), ['anna@example.com', 'boss@example.com']);
    r = await call2('POST', '/api/admin/delete', { email: 'anna@example.com' }, boss);
    assert.equal(r.status, 200);
    r = await call2('GET', '/api/usage', null, anna);
    assert.equal(r.status, 401, 'a deleted account is signed out');

    // admin rights go with the account, not just the address
    const side3 = new DatabaseSync(path.join(dir2, 'flashcards.db'));
    const boss2 = (await call2('POST', '/api/login', { email: 'boss@example.com', auth_hash: 'a'.repeat(44), device_name: 'x' })).json.token;
    assert.equal((await call2('GET', '/api/admin/summary', null, boss2)).status, 200);
    side3.prepare("DELETE FROM users WHERE email = 'boss@example.com'").run();
    r = await join('boss@example.com');
    assert.equal(r.status, 409, "a deleted admin's address can't be signed up for");
    const other = (await join('other@example.com')).json.token;
    side3.prepare("UPDATE users SET email = 'boss@example.com' WHERE email = 'other@example.com'").run();
    assert.equal((await call2('GET', '/api/admin/summary', null, other)).status, 403, 'the address alone is not enough');
    r = await call2('GET', '/api/usage', null, other);
    assert.equal(r.json.limited, true, 'and gets no admin limit');
    side3.prepare("DELETE FROM users WHERE email = 'boss@example.com'").run();
    side3.close();
    const { execFileSync } = await import('node:child_process');
    assert.match(execFileSync(process.execPath, ['admin.js', 'reset-admin', 'boss@example.com'], { env: { ...process.env, DATA_DIR: dir2 } }).toString(), /Done/);
    const newBoss = await join('boss@example.com');
    assert.equal(newBoss.status, 200, 'free again after reset-admin');
    assert.equal((await call2('GET', '/api/admin/summary', null, newBoss.json.token)).status, 200, 'and the new account is the admin');

    // the page
    r = await call2('GET', '/admin');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
    assert.equal((await call2('GET', '/admin/admin-page.js')).status, 200);
    assert.equal((await call2('GET', '/admin/admin-page.css')).status, 200);
    assert.equal((await call2('GET', '/admin/../server.js')).status, 404, 'nothing else is served');
    assert.equal((await call2('GET', '/admin/server.js')).status, 404);
  } finally {
    open.kill();
    fs.rmSync(dir2, { recursive: true, force: true });
  }

  // ---------- email codes, against a pretend mail server ----------
  const net = await import('node:net');
  const mails = [];
  const smtp = net.createServer(sock => {
    let inData = false, text = '', to = '';
    sock.write('220 test\r\n');
    sock.on('data', chunk => {
      for (const line of chunk.toString().split('\r\n').filter((l, i, all) => l || i < all.length - 1)) {
        if (inData) {
          if (line === '.') { inData = false; mails.push({ to, text }); text = ''; sock.write('250 ok\r\n'); } else text += `${line}\n`;
        } else if (/^EHLO/.test(line)) sock.write('250-test\r\n250 SIZE 1000\r\n');
        else if (/^RCPT TO:/.test(line)) { to = line.slice(9, -1); sock.write('250 ok\r\n'); }
        else if (line === 'DATA') { inData = true; sock.write('354 go\r\n'); }
        else if (line === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('250 ok\r\n');
      }
    });
  });
  await new Promise(done => smtp.listen(0, '127.0.0.1', done));
  const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'flashcards-test-'));
  const PORT3 = PORT + 2000;
  const coded = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: PORT3, DATA_DIR: dir3, REGISTRATION: 'open', EMAIL_CODES: 'on', MAIL_FROM: 'noreply@example.com', SMTP_PORT: String(smtp.address().port), ADMIN_EMAILS: 'boss@example.com' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise(done => coded.stdout.once('data', done));
  const call3 = async (url, body, ipTail = 1) => {
    const res = await fetch(`http://127.0.0.1:${PORT3}${url}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `203.0.113.${ipTail}` }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const keys3 = { auth_hash: 'a'.repeat(44), kdf: { salt: 's' }, wrapped_data_key: 'w', recovery_hash: 'r'.repeat(44), device_name: 'x' };
  const codeIn = mail => /Your code is (\d{6})/.exec(mail.text)?.[1];
  try {
    assert.equal((await call3('/api/health')).json.email_codes, true);
    assert.equal((await call3('/api/register', { email: 'a@example.com', ...keys3 })).status, 400, 'no account without a code');
    r = await call3('/api/signup/code', { email: 'A@Example.com' });
    assert.equal(r.status, 200);
    assert.equal(mails.at(-1).to, 'a@example.com');
    assert.match(mails.at(-1).text, /Subject: Your Open Flashcards code/);
    const codeA = codeIn(mails.at(-1));
    assert.ok(codeA);
    assert.equal((await call3('/api/signup/code', { email: 'a@example.com' })).status, 429, 'wait a minute between codes');
    assert.equal(mails.length, 1);
    r = await call3('/api/register', { email: 'b@example.com', code: codeA, ...keys3 });
    assert.equal(r.status, 400, "one address's code is no use for another");
    const wrong = codeA === '000000' ? '000001' : '000000';
    r = await call3('/api/register', { email: 'a@example.com', code: wrong, ...keys3 });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /isn't right/);
    r = await call3('/api/register', { email: 'a@example.com', code: ` ${codeA.slice(0, 3)} ${codeA.slice(3)}`, ...keys3 });
    assert.equal(r.status, 200, 'the right code makes the account, spaces or not');
    r = await call3('/api/register', { email: 'a@example.com', code: codeA, ...keys3 });
    assert.equal(r.status, 400, 'a code only works once');

    // an address with an account gets a note, not a code, and the caller can't tell
    const before = mails.length;
    const side4 = new DatabaseSync(path.join(dir3, 'flashcards.db'));
    side4.prepare('DELETE FROM mail_log').run();
    r = await call3('/api/signup/code', { email: 'a@example.com' });
    assert.equal(r.status, 200);
    assert.equal(mails.length, before + 1);
    assert.match(mails.at(-1).text, /already has one/);
    assert.equal(codeIn(mails.at(-1)), undefined);

    // too many wrong tries and the code is gone
    r = await call3('/api/signup/code', { email: 'c@example.com' });
    const codeC = codeIn(mails.at(-1));
    for (let n = 0; n < 5; n++) r = await call3('/api/register', { email: 'c@example.com', code: 'nope', ...keys3 }, 50 + n);
    assert.match(r.json.error, /Too many wrong tries/);
    assert.equal((await call3('/api/register', { email: 'c@example.com', code: codeC, ...keys3 }, 60)).status, 400);

    // a code past its time is no use
    side4.prepare('DELETE FROM mail_log').run();
    await call3('/api/signup/code', { email: 'd@example.com' }, 61);
    const codeD = codeIn(mails.at(-1));
    side4.prepare("UPDATE signup_codes SET expires_at = '2020-01-01T00:00:00.000Z' WHERE email = 'd@example.com'").run();
    r = await call3('/api/register', { email: 'd@example.com', code: codeD, ...keys3 }, 62);
    assert.match(r.json.error, /run out/);

    // nothing odd can get into a mail command or header
    for (const bad of ['-f@example.com', 'a b@example.com', 'a@example.com\r\nBcc: x@example.com', 'a>@example.com', '<a@example.com', 'a@b']) assert.equal((await call3('/api/signup/code', { email: bad }, 63)).status, 400, bad);

    // limits on how much mail can be asked for
    side4.prepare('DELETE FROM mail_log').run();
    const hourAgo = new Date(Date.now() - 30 * 60000).toISOString();
    for (let n = 0; n < 3; n++) side4.prepare("INSERT INTO mail_log (at, email, ip) VALUES (?, 'e@example.com', '203.0.113.70')").run(hourAgo);
    assert.equal((await call3('/api/signup/code', { email: 'e@example.com' }, 71)).status, 429, 'three an hour per address');
    side4.prepare('DELETE FROM mail_log').run();
    for (let n = 0; n < 6; n++) side4.prepare("INSERT INTO mail_log (at, email, ip) VALUES (?, ?, '203.0.113.72')").run(hourAgo, `x${n}@example.com`);
    assert.equal((await call3('/api/signup/code', { email: 'f@example.com' }, 72)).status, 429, 'six an hour per address sending');
    side4.prepare('DELETE FROM mail_log').run();
    for (let n = 0; n < 30; n++) side4.prepare("INSERT INTO mail_log (at, email, ip) VALUES (?, ?, ?)").run(hourAgo, `y${n}@example.com`, `10.0.0.${n}`);
    assert.equal((await call3('/api/signup/code', { email: 'g@example.com' }, 73)).status, 429, 'thirty a day in all');
    side4.close();
  } finally {
    coded.kill();
    smtp.close();
    fs.rmSync(dir3, { recursive: true, force: true });
  }

  // ---------- email through Microsoft 365, against a pretend Microsoft ----------
  const microsoft = [];
  const crypto = await import('node:crypto');
  const fake = (await import('node:http')).createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      microsoft.push({ url: req.url, auth: req.headers.authorization, raw });
      res.writeHead(req.url.includes('/sendMail') && fake.refuse ? 403 : 202, { 'Content-Type': 'application/json' });
      res.end(req.url.includes('/token') ? JSON.stringify({ access_token: 'tok', expires_in: 3600 }) : fake.refuse ? JSON.stringify({ error: { message: 'Access denied' } }) : '');
    });
  });
  await new Promise(done => fake.listen(0, '127.0.0.1', done));
  const fakeUrl = `http://127.0.0.1:${fake.address().port}`;
  const dir4 = fs.mkdtempSync(path.join(os.tmpdir(), 'flashcards-test-'));
  fs.mkdirSync(path.join(dir4, 'mail'));
  execSync(`openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 2 -subj /CN=test -keyout ${path.join(dir4, 'mail/key.pem')} -out ${path.join(dir4, 'mail/cert.pem')}`, { stdio: 'ignore' });
  fs.writeFileSync(path.join(dir4, 'mail/config.json'), JSON.stringify({ tenantId: 'tenant1', clientId: 'client1', mailbox: 'noreply@example.com' }));
  const PORT4 = PORT + 3000;
  const viaMs = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: PORT4, DATA_DIR: dir4, REGISTRATION: 'open', EMAIL_CODES: 'on', MAIL_FROM: '', SMTP_PORT: '1', GRAPH_LOGIN_URL: fakeUrl, GRAPH_URL: fakeUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise(done => viaMs.stdout.once('data', done));
  const ask = async (email, ipTail) => fetch(`http://127.0.0.1:${PORT4}/api/signup/code`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `203.0.113.${ipTail}` }, body: JSON.stringify({ email }) });
  try {
    assert.equal((await ask('h@example.com', 1)).status, 200);
    const tokenCall = microsoft.find(m => m.url === '/tenant1/oauth2/v2.0/token');
    const form = new URLSearchParams(tokenCall.raw);
    assert.equal(form.get('grant_type'), 'client_credentials');
    assert.equal(form.get('client_id'), 'client1');
    const [head, body, signature] = form.get('client_assertion').split('.');
    assert.ok(crypto.createVerify('RSA-SHA256').update(`${head}.${body}`).verify(new crypto.X509Certificate(fs.readFileSync(path.join(dir4, 'mail/cert.pem'))).publicKey, Buffer.from(signature, 'base64url')), 'signed with the certificate');
    assert.equal(JSON.parse(Buffer.from(body, 'base64url')).iss, 'client1');
    const sendCall = microsoft.find(m => m.url.includes('/sendMail'));
    assert.equal(sendCall.url, '/v1.0/users/noreply%40example.com/sendMail');
    assert.equal(sendCall.auth, 'Bearer tok');
    const sent = JSON.parse(sendCall.raw).message;
    assert.equal(sent.toRecipients[0].emailAddress.address, 'h@example.com');
    assert.match(sent.body.content, /Your code is \d{6}/);
    const codeH = /Your code is (\d{6})/.exec(sent.body.content)[1];
    r = await fetch(`http://127.0.0.1:${PORT4}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.1' }, body: JSON.stringify({ email: 'h@example.com', code: codeH, auth_hash: 'a'.repeat(44), kdf: { salt: 's' }, wrapped_data_key: 'w', recovery_hash: 'r'.repeat(44) }) });
    assert.equal(r.status, 200, 'the code from a Microsoft 365 email makes the account');
    assert.equal(microsoft.filter(m => m.url.includes('/token')).length, 1, 'the sign-in is kept');
    await ask('i@example.com', 2);
    assert.equal(microsoft.filter(m => m.url.includes('/token')).length, 1, 'and used again');
    fake.refuse = true;
    assert.equal((await ask('j@example.com', 3)).status, 502, "if Microsoft refuses, it says so");
  } finally {
    viaMs.kill();
    fake.close();
    fs.rmSync(dir4, { recursive: true, force: true });
  }

  console.log('all server checks passed');
} finally {
  child.kill();
  fs.rmSync(dir, { recursive: true, force: true });
}
