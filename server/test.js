// End-to-end check of open-flashcards-server against a throwaway database.
//   node test.js      (starts its own server on a spare port)

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flashcards-test-'));
const PORT = 18000 + Math.floor(Math.random() * 1000);
const child = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT, DATA_DIR: dir, REGISTRATION: 'first' }, stdio: ['ignore', 'pipe', 'inherit'] });
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

  console.log('all server checks passed');
} finally {
  child.kill();
  fs.rmSync(dir, { recursive: true, force: true });
}
