// End-to-end encryption for sync. Everything here runs on the device; the server only ever sees the login hash, the wrapped data key and encrypted records.
//
//   password ──PBKDF2 (600k)──▶ master key ──PBKDF2 (1, salt=password)──▶ login hash (sent)
//                                    └──HKDF "wrap"──▶ wraps the data key
//   data key (random, 32 bytes) ──HKDF──▶ record key (AES-GCM) + id key (HMAC)
//
// The data key never changes; a new password just re-wraps it. The recovery code is the data key itself, shown once when the account is made; the server keeps only a one-way hash of it to check a code.
const sync_crypto = (() => {
  const text_encoder = new TextEncoder(), text_decoder = new TextDecoder(), subtle = crypto.subtle;
  const to_base64 = byte_array => { let binary_text = ''; new Uint8Array(byte_array).forEach(byte_value => { binary_text += String.fromCharCode(byte_value); }); return btoa(binary_text); };
  const from_base64 = base64_text => Uint8Array.from(atob(base64_text), base64_char => base64_char.charCodeAt(0));

  function new_kdf() { return {name: 'PBKDF2-SHA256', iterations: 600000, salt: to_base64(crypto.getRandomValues(new Uint8Array(16)))}; }
  async function derive_master(password_text, kdf) {
    const base_key = await subtle.importKey('raw', text_encoder.encode(password_text), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt: from_base64(kdf.salt), iterations: kdf.iterations}, base_key, 256));
  }
  async function login_hash(master_key, password_text) {
    const base_key = await subtle.importKey('raw', master_key, 'PBKDF2', false, ['deriveBits']);
    return to_base64(await subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt: text_encoder.encode(password_text), iterations: 1}, base_key, 256));
  }
  async function hkdf(raw_key, info_text, algorithm, usages) {
    const base_key = await subtle.importKey('raw', raw_key, 'HKDF', false, ['deriveKey']);
    return subtle.deriveKey({name: 'HKDF', hash: 'SHA-256', salt: text_encoder.encode('open-flashcards'), info: text_encoder.encode(info_text)}, base_key, algorithm, false, usages);
  }
  // iv + ciphertext as raw bytes, so a 10 MB photo stays about 10 MB. Records add base64 on top.
  async function seal_blob(keys, byte_array) {
    const iv_bytes = crypto.getRandomValues(new Uint8Array(12)), cipher_bytes = new Uint8Array(await subtle.encrypt({name: 'AES-GCM', iv: iv_bytes}, keys.records, byte_array)), sealed_bytes = new Uint8Array(iv_bytes.length + cipher_bytes.length);
    sealed_bytes.set(iv_bytes); sealed_bytes.set(cipher_bytes, iv_bytes.length);
    return sealed_bytes;
  }
  async function open_blob(keys, sealed_bytes) { return new Uint8Array(await subtle.decrypt({name: 'AES-GCM', iv: sealed_bytes.slice(0, 12)}, keys.records, sealed_bytes.slice(12))); }
  async function wrap_data_key(master_key, data_key) { return to_base64(await seal_blob({records: await hkdf(master_key, 'wrap', {name: 'AES-GCM', length: 256}, ['encrypt'])}, data_key)); }
  async function unwrap_data_key(master_key, wrapped_key) { return open_blob({records: await hkdf(master_key, 'wrap', {name: 'AES-GCM', length: 256}, ['decrypt'])}, from_base64(wrapped_key)); }
  // What the server keeps to check a recovery code: one-way, so it can't be used to read anything.
  async function recovery_hash(data_key) {
    const base_key = await subtle.importKey('raw', data_key, 'HKDF', false, ['deriveBits']);
    return to_base64(await subtle.deriveBits({name: 'HKDF', hash: 'SHA-256', salt: text_encoder.encode('open-flashcards'), info: text_encoder.encode('recovery')}, base_key, 256));
  }
  function new_data_key() { return crypto.getRandomValues(new Uint8Array(32)); }
  // The keys sync works with. Not extractable, so they can live in IndexedDB.
  async function working_keys(data_key) {
    return {records: await hkdf(data_key, 'records', {name: 'AES-GCM', length: 256}, ['encrypt', 'decrypt']), ids: await hkdf(data_key, 'ids', {name: 'HMAC', hash: 'SHA-256', length: 256}, ['sign'])};
  }
  async function seal_json(keys, json_value) { return to_base64(await seal_blob(keys, text_encoder.encode(JSON.stringify(json_value)))); }
  async function open_json(keys, sealed_text) { return JSON.parse(text_decoder.decode(await open_blob(keys, from_base64(sealed_text)))); }
  // Ids on the server: a keyed hash of collection + id, so the server can't tell what anything is or group records by kind.
  async function opaque_id(keys, collection_name, record_id) {
    const signature = new Uint8Array(await subtle.sign('HMAC', keys.ids, text_encoder.encode(collection_name + '/' + record_id)));
    return Array.from(signature.slice(0, 20), byte_value => byte_value.toString(16).padStart(2, '0')).join('');
  }
  // Recovery code: the data key as 64 hex characters in groups of 4.
  function recovery_code(data_key) { return Array.from(data_key, byte_value => byte_value.toString(16).padStart(2, '0')).join('').toUpperCase().match(/.{4}/g).join('-'); }
  function from_recovery_code(code_text) {
    const hex_text = code_text.replace(/[^0-9a-f]/gi, '');
    if (hex_text.length !== 64) throw new Error('A recovery code has 64 letters and numbers');
    return Uint8Array.from(hex_text.match(/../g), hex_pair => parseInt(hex_pair, 16));
  }
  return {new_kdf, derive_master, login_hash, wrap_data_key, unwrap_data_key, recovery_hash, new_data_key, working_keys, seal_json, open_json, seal_blob, open_blob, opaque_id, recovery_code, from_recovery_code};
})();
