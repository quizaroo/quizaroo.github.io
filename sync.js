// Sync with open-flashcards-server. localStorage (app_state) stays what the app works from; sync exchanges encrypted records in the background.
//
//   capture  compare what is saved with the records here; a field that differs gets a new clock and goes in the outbox
//   pull     everything since the last seq; merged field by field, later clock wins, then written back into app_state
//   push     the outbox; on a conflict merge the server's copy and push again
//
// Runs on start, on regaining network, a few seconds after a change, every 30 seconds on screen (5 minutes off screen), and on Sync now.
// Records: sets, cards, progress, trophies, settings and attachments. Files (photos) travel separately in their own queue, so a big file never holds up the text.
const sync_engine = (() => {
  const DEFAULT_SERVER = 'https://flashcards.hazymat.co.uk', ADMIN_NOTICE_KEY = 'open-flashcards:admin-notice';
  let is_admin = null;
  const DB_NAME = 'open-flashcards-sync', COLLECTIONS = ['sets', 'cards', 'progress', 'trophies', 'settings', 'attachments'], RESERVED_FIELDS = new Set(['id', 'deleted_at', '_field_clocks', '_server_seq']);
  const SYNCED_SETTINGS = ['shuffle', 'keep_score', 'library_order', 'mode_layout', 'learn_choice', 'learn_type', 'library_custom_order', 'smart_learn', 'resume_point'], MAX_FILE = 25 * 1024 * 1024, MAX_AUTO_DOWNLOAD = 5 * 1024 * 1024;
  let changed_while_running = false, keys = null, account = null, records = new Map(), database = null, device_id = '', last_clock = {wall: 0, counter: 0}, running = null, timer = null, failures = 0, wired = false, files_running = null, mark_ready;
  const listeners = new Set(), ready = new Promise(resolve_ready => { mark_ready = resolve_ready; });
  // state: off | idle | syncing | ok | offline | error. last = when the records last finished syncing; tried = when a sync last started; reached = when the server last answered; received = records that came in last time; files = the file queue (idle | syncing | error).
  let status = {state: 'off', pending: 0, last: null, tried: null, reached: null, received: 0, files: 'idle', files_waiting: 0, files_waiting_up: 0, error: null};
  function set_status(next_status) { status = Object.assign({}, status, next_status); listeners.forEach(listener => listener(status)); }
  function on_status(listener) { listeners.add(listener); listener(status); return () => listeners.delete(listener); }

  // ---- How the connection is doing ----
  // Every request is timed; the last few from the past minute say whether the connection is good, slow or failing. A request over its limit is given up and tried again soon, so a poor signal can't leave sync stuck on Syncing.
  const samples = [];
  function add_sample(took_ms, was_ok) {
    samples.push({at: Date.now(), ms: took_ms, ok: was_ok});
    while (samples.length > 20 || (samples.length && Date.now() - samples[0].at > 60000)) samples.shift();
    set_status(Object.assign({link: link_quality(), checked: new Date().toISOString()}, was_ok ? {reached: new Date().toISOString()} : {}));
  }
  // good | slow | weak | down | unknown
  function link_quality() {
    const recent = samples.filter(sample_item => Date.now() - sample_item.at < 60000);
    if (!recent.length) return 'unknown';
    if (!recent[recent.length - 1].ok && recent.slice(-3).every(sample_item => !sample_item.ok)) return 'down';
    if (recent.some(sample_item => !sample_item.ok)) return 'weak';
    return recent.reduce((total_ms, sample_item) => total_ms + sample_item.ms, 0) / recent.length > 1500 ? 'slow' : 'good';
  }
  async function timed_fetch(url_text, fetch_options, limit_ms) {
    const abort_control = new AbortController(), started_at = performance.now(), abort_timer = setTimeout(() => abort_control.abort(), limit_ms || 20000);
    try {
      const response = await fetch(url_text, Object.assign({}, fetch_options, {signal: abort_control.signal}));
      add_sample(performance.now() - started_at, true);
      return response;
    } catch (fetch_err) {
      add_sample(performance.now() - started_at, false);
      throw fetch_err.name === 'AbortError' ? new TypeError('The server took too long to answer') : fetch_err;
    } finally { clearTimeout(abort_timer); }
  }
  // A quick "are you there?" (Settings asks every 10 seconds while it is open).
  async function check_link() { if (!account) return; try { await timed_fetch(account.server + '/api/health', {}, 8000); } catch (fetch_err) {} }
  async function api(method_name, path_text, body_value, server_url) {
    const response = await timed_fetch((server_url || account.server) + path_text, {method: method_name, headers: Object.assign({'Content-Type': 'application/json'}, account && account.token ? {Authorization: 'Bearer ' + account.token} : {}), body: body_value ? JSON.stringify(body_value) : undefined});
    const reply = await response.json().catch(() => ({}));
    if (!response.ok) { const api_err = new Error(reply.error || 'Server said ' + response.status); api_err.status = response.status; throw api_err; }
    return reply;
  }
  function device_name() {
    const agent_text = navigator.userAgent, device_kind = /iPhone/.test(agent_text) ? 'iPhone' : /iPad/.test(agent_text) ? 'iPad' : /Android/.test(agent_text) ? 'Android' : /Mac/.test(agent_text) ? 'Mac' : /Windows/.test(agent_text) ? 'Windows PC' : 'Device';
    return device_kind + ' (' + (matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 'app' : 'browser') + ')';
  }

  // ---- Local store (IndexedDB): records, outbox, meta, blobs ----
  function as_promise(request_item) { return new Promise((resolve_it, reject_it) => { request_item.onsuccess = () => resolve_it(request_item.result); request_item.onerror = () => reject_it(request_item.error); }); }
  function tx_done(transaction) { return new Promise((resolve_it, reject_it) => { transaction.oncomplete = () => resolve_it(); transaction.onerror = () => reject_it(transaction.error); transaction.onabort = () => reject_it(transaction.error || new Error('transaction aborted')); }); }
  function open_database() {
    if (database) return Promise.resolve(database);
    const open_request = indexedDB.open(DB_NAME, 1);
    open_request.onupgradeneeded = () => { ['records', 'outbox', 'meta'].forEach(store_name => open_request.result.createObjectStore(store_name)); open_request.result.createObjectStore('blobs', {keyPath: 'blob_id'}); };
    return as_promise(open_request).then(opened_db => { database = opened_db; opened_db.onversionchange = () => { opened_db.close(); database = null; }; return opened_db; });
  }
  async function meta_get(meta_key) { return as_promise((await open_database()).transaction('meta').objectStore('meta').get(meta_key)); }
  async function meta_set(meta_key, meta_value) { const transaction = (await open_database()).transaction('meta', 'readwrite'); if (meta_value === undefined) transaction.objectStore('meta').delete(meta_key); else transaction.objectStore('meta').put(meta_value, meta_key); return tx_done(transaction); }
  async function load_records() {
    const transaction = (await open_database()).transaction('records'), store_item = transaction.objectStore('records'), stored_keys = await as_promise(store_item.getAllKeys()), stored_values = await as_promise(store_item.getAll());
    records = new Map(stored_keys.map((stored_key, key_index) => [stored_key, stored_values[key_index]]));
  }
  // Records changed in memory are written together with their outbox entries and the clock.
  async function persist_records(changed_keys, queue_them) {
    const transaction = (await open_database()).transaction(['records', 'outbox', 'meta'], 'readwrite');
    changed_keys.forEach(record_key => { transaction.objectStore('records').put(records.get(record_key), record_key); if (queue_them) transaction.objectStore('outbox').put(Date.now(), record_key); });
    transaction.objectStore('meta').put(last_clock, 'clock');
    return tx_done(transaction);
  }
  async function outbox_keys() { return as_promise((await open_database()).transaction('outbox').objectStore('outbox').getAllKeys()); }
  async function outbox_size() { return as_promise((await open_database()).transaction('outbox').objectStore('outbox').count()); }
  async function remove_from_outbox(record_keys) { const transaction = (await open_database()).transaction('outbox', 'readwrite'); record_keys.forEach(record_key => transaction.objectStore('outbox').delete(record_key)); return tx_done(transaction); }
  const record_key_of = (collection_name, record_id) => collection_name + '/' + record_id;
  const collection_of = record_key => record_key.slice(0, record_key.indexOf('/'));

  // ---- Clocks: wall_ms-counter-device_id, zero padded so plain string comparison orders them ----
  function format_clock(clock_value) { return String(clock_value.wall).padStart(15, '0') + '-' + String(clock_value.counter).padStart(5, '0') + '-' + device_id; }
  function next_clock() {
    const now_ms = Date.now();
    last_clock = now_ms > last_clock.wall ? {wall: now_ms, counter: 0} : {wall: last_clock.wall, counter: last_clock.counter + 1};
    return format_clock(last_clock);
  }
  // Advance past a clock seen from another device, ignoring any from the future (a device with a wrong date): adopting one would make every later edit here carry that time.
  function observe_clock(clock_text) {
    const clock_parts = clock_text.split('-'), seen_wall = Number(clock_parts[0]), seen_counter = Number(clock_parts[1]);
    if (!(seen_wall <= Date.now() + 86400000)) return;
    if (seen_wall > last_clock.wall || (seen_wall === last_clock.wall && seen_counter > last_clock.counter)) last_clock = {wall: seen_wall, counter: seen_counter};
  }
  // What a device held before it first joined is older than anything stamped since, so on the same field the server's copy wins. Times the app recorded itself are used where they exist, so the newest progress wins between two devices joining for the first time.
  function baseline_clock(collection_name, field_name, field_value, all_fields) {
    const recorded_ms = collection_name === 'progress' ? all_fields.last : field_name === 'last_studied' || field_name === 'last_opened' ? field_value : 0;
    return format_clock({wall: Number(recorded_ms) || 0, counter: 0});
  }

  // ---- app_state as records ----
  // A short stable hash, so two devices give the same card the same id.
  function short_hash(hash_text) {
    let hash_a = 0xdeadbeef, hash_b = 0x41c6ce57;
    for (let char_index = 0; char_index < hash_text.length; char_index++) { const char_code = hash_text.charCodeAt(char_index); hash_a = Math.imul(hash_a ^ char_code, 2654435761); hash_b = Math.imul(hash_b ^ char_code, 1597334677); }
    hash_a = Math.imul(hash_a ^ (hash_a >>> 16), 2246822507) ^ Math.imul(hash_b ^ (hash_b >>> 13), 3266489909);
    hash_b = Math.imul(hash_b ^ (hash_b >>> 16), 2246822507) ^ Math.imul(hash_a ^ (hash_a >>> 13), 3266489909);
    return (4294967296 * (2097151 & hash_b) + (hash_a >>> 0)).toString(36);
  }
  function live_children(collection_name) {
    const by_set = new Map();
    records.forEach((record_item, record_key) => { if (collection_of(record_key) !== collection_name || record_item.deleted_at) return; if (!by_set.has(record_item.set_id)) by_set.set(record_item.set_id, []); by_set.get(record_item.set_id).push(record_item); });
    return by_set;
  }
  // A set's cards in order: the order it records, then any cards it doesn't know yet (added on another device), sorted so every device agrees.
  function ordered_cards(set_record, cards_of_set) {
    const by_id = new Map((cards_of_set || []).map(card_record => [card_record.id, card_record])), in_order = [];
    (set_record.card_order || []).forEach(card_id => { if (by_id.has(card_id)) { in_order.push(by_id.get(card_id)); by_id.delete(card_id); } });
    return in_order.concat(Array.from(by_id.values()).sort((card_a, card_b) => (card_a.id < card_b.id ? -1 : 1)));
  }
  // Cards have no ids in the app, so each is matched to its record: same term and definition, then same term, then same definition. Anything left is a new card, with an id from its term.
  function card_ids_for(saved_set, old_cards) {
    const set_cards = saved_set.cards || [], unmatched = (old_cards || []).slice(), card_ids = set_cards.map(() => null);
    const passes = [(card_item, card_record) => card_key(card_item) === card_key(card_record) && clean_text(card_item.definition) === clean_text(card_record.definition), (card_item, card_record) => card_key(card_item) === card_key(card_record), (card_item, card_record) => clean_text(card_item.definition) === clean_text(card_record.definition)];
    passes.forEach(same_card => set_cards.forEach((card_item, card_index) => {
      if (card_ids[card_index]) return;
      const found_index = unmatched.findIndex(card_record => same_card(card_item, card_record));
      if (found_index >= 0) card_ids[card_index] = unmatched.splice(found_index, 1)[0].id;
    }));
    const taken_ids = new Set(card_ids.filter(Boolean).concat(unmatched.map(card_record => card_record.id)));
    set_cards.forEach((card_item, card_index) => {
      if (card_ids[card_index]) return;
      const base_id = saved_set.id + '~' + short_hash(card_key(card_item));
      let new_card_id = base_id;
      for (let copy_number = 2; taken_ids.has(new_card_id); copy_number++) new_card_id = base_id + '~' + copy_number;
      taken_ids.add(new_card_id); card_ids[card_index] = new_card_id;
    });
    return card_ids;
  }
  // Every record app_state should have, as key → fields.
  function flatten_state(saved_state) {
    const wanted = new Map(), cards_by_set = live_children('cards');
    const settings_fields = {};
    SYNCED_SETTINGS.forEach(setting_name => { if (saved_state[setting_name] !== undefined && saved_state[setting_name] !== null) settings_fields[setting_name] = saved_state[setting_name]; });
    wanted.set(record_key_of('settings', 'main'), settings_fields);
    saved_state.sets.filter(saved_set => saved_set && saved_set.id).forEach(saved_set => {
      const set_fields = {};
      Object.keys(saved_set).forEach(field_name => { if (!['id', 'cards', 'progress', 'trophies'].includes(field_name) && saved_set[field_name] !== null) set_fields[field_name] = saved_set[field_name]; });
      const card_ids = card_ids_for(saved_set, cards_by_set.get(saved_set.id));
      set_fields.card_order = card_ids;
      wanted.set(record_key_of('sets', saved_set.id), set_fields);
      (saved_set.cards || []).forEach((card_item, card_index) => wanted.set(record_key_of('cards', card_ids[card_index]), Object.assign({}, card_item, {set_id: saved_set.id})));
      Object.keys(saved_set.progress || {}).forEach(progress_key => wanted.set(record_key_of('progress', saved_set.id + '~' + short_hash(progress_key)), Object.assign({}, saved_set.progress[progress_key], {set_id: saved_set.id, key: progress_key})));
      (saved_set.trophies || []).forEach(trophy_item => wanted.set(record_key_of('trophies', saved_set.id + '~' + trophy_item.at + '~' + trophy_item.image), Object.assign({}, trophy_item, {set_id: saved_set.id})));
    });
    return wanted;
  }
  function saved_state_now() { try { const saved_state = JSON.parse(localStorage.getItem(STORAGE_KEY)); return saved_state && Array.isArray(saved_state.sets) ? saved_state : null; } catch (storage_err) { return null; } }
  const same_value = (value_a, value_b) => JSON.stringify(value_a === undefined ? null : value_a) === JSON.stringify(value_b === undefined ? null : value_b);

  // What was saved since last time, as new clocks on the fields that differ. Runs without awaiting, so nothing can change under it.
  function capture_local(use_baseline) {
    const saved_state = saved_state_now();
    if (!saved_state) return [];
    const wanted = flatten_state(saved_state), changed_keys = [], cards_by_set = live_children('cards'), live_set_ids = new Set();
    records.forEach((record_item, record_key) => { if (collection_of(record_key) === 'sets' && !record_item.deleted_at) live_set_ids.add(record_item.id); });
    wanted.forEach((wanted_fields, record_key) => {
      const collection_name = collection_of(record_key), existing = records.get(record_key), record_item = existing || {id: record_key.slice(collection_name.length + 1), _field_clocks: {}, _server_seq: 0};
      let is_changed = !existing;
      const stamp = (field_name, field_value) => { record_item[field_name] = field_value; record_item._field_clocks[field_name] = use_baseline ? baseline_clock(collection_name, field_name, field_value, wanted_fields) : next_clock(); is_changed = true; };
      if (record_item.deleted_at) stamp('deleted_at', null);
      new Set(Object.keys(wanted_fields).concat(Object.keys(record_item))).forEach(field_name => {
        if (RESERVED_FIELDS.has(field_name) || same_value(record_item[field_name], wanted_fields[field_name])) return;
        // A card this device hasn't received yet isn't in the set's list here; only a real difference in what is shown counts as a new order.
        if (field_name === 'card_order' && existing && same_value(ordered_cards(existing, cards_by_set.get(existing.id)).map(card_record => card_record.id), wanted_fields.card_order)) return;
        stamp(field_name, wanted_fields[field_name] === undefined ? null : wanted_fields[field_name]);
      });
      if (is_changed) { records.set(record_key, record_item); changed_keys.push(record_key); }
    });
    records.forEach((record_item, record_key) => {
      const collection_name = collection_of(record_key);
      if (wanted.has(record_key) || record_item.deleted_at || collection_name === 'attachments' || collection_name === 'settings') return;
      // A card whose set hasn't arrived yet (still being sent by another device, or just deleted) isn't something this device removed.
      if (collection_name !== 'sets' && !live_set_ids.has(record_item.set_id)) return;
      record_item.deleted_at = Date.now(); record_item._field_clocks.deleted_at = next_clock(); changed_keys.push(record_key);
    });
    return changed_keys;
  }

  // Write the records back into app_state, keeping the same objects: a page on screen may hold on to a set.
  function materialise_state() {
    const cards_by_set = live_children('cards'), progress_by_set = live_children('progress'), trophies_by_set = live_children('trophies'), next_sets = [];
    records.forEach((record_item, record_key) => {
      if (collection_of(record_key) !== 'sets' || record_item.deleted_at) return;
      const next_set = {id: record_item.id};
      Object.keys(record_item).forEach(field_name => { if (!RESERVED_FIELDS.has(field_name) && field_name !== 'card_order' && record_item[field_name] !== null) next_set[field_name] = record_item[field_name]; });
      const plain_fields = child_record => { const fields_out = {}; Object.keys(child_record).forEach(field_name => { if (!RESERVED_FIELDS.has(field_name) && field_name !== 'set_id' && child_record[field_name] !== null) fields_out[field_name] = child_record[field_name]; }); return fields_out; };
      next_set.cards = ordered_cards(record_item, cards_by_set.get(record_item.id)).map(plain_fields);
      const progress_records = progress_by_set.get(record_item.id), trophy_records = trophies_by_set.get(record_item.id);
      if (progress_records) { next_set.progress = {}; progress_records.forEach(progress_record => { const progress_item = plain_fields(progress_record); delete progress_item.key; next_set.progress[progress_record.key] = progress_item; }); }
      if (trophy_records) next_set.trophies = trophy_records.map(plain_fields).sort((trophy_a, trophy_b) => trophy_a.at - trophy_b.at);
      next_sets.push(next_set);
    });
    adopt_sets(next_sets);
    const settings_record = records.get(record_key_of('settings', 'main'));
    if (settings_record) SYNCED_SETTINGS.forEach(setting_name => { if (settings_record[setting_name] === null || settings_record[setting_name] === undefined) delete app_state[setting_name]; else app_state[setting_name] = settings_record[setting_name]; });
    write_state_quietly();
  }
  // Sets keep their place in the list; new ones go at the end.
  function adopt_sets(next_sets) {
    const next_by_id = new Map(next_sets.map(next_set => [next_set.id, next_set])), kept_sets = [];
    app_state.sets.forEach(old_set => {
      const next_set = next_by_id.get(old_set.id);
      if (!next_set) return;
      // Given the same object (keeping some of the sets already here), there is nothing to copy: emptying it first would wipe the set.
      if (next_set !== old_set) { Object.keys(old_set).forEach(field_name => { delete old_set[field_name]; }); Object.assign(old_set, next_set); }
      next_by_id.delete(next_set.id); kept_sets.push(old_set);
    });
    app_state.sets.splice(0, app_state.sets.length, ...kept_sets, ...next_by_id.values());
  }
  function write_state_quietly() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(app_state)); } catch (storage_err) { console.warn('Could not save what arrived:', storage_err.message); } }

  // Merged field by field, later clock wins, so unpushed local edits survive. Returns whether anything changed.
  function apply_remote(collection_name, incoming_record, server_seq) {
    const record_key = record_key_of(collection_name, incoming_record.id), local_record = records.get(record_key), incoming_clocks = incoming_record._field_clocks || {};
    Object.values(incoming_clocks).forEach(observe_clock);
    if (!local_record) { records.set(record_key, Object.assign({}, incoming_record, {_server_seq: server_seq})); return true; }
    let is_changed = false;
    local_record._server_seq = server_seq;
    Object.keys(incoming_clocks).forEach(field_name => {
      if (local_record._field_clocks[field_name] && incoming_clocks[field_name] <= local_record._field_clocks[field_name]) return;
      local_record[field_name] = incoming_record[field_name]; local_record._field_clocks[field_name] = incoming_clocks[field_name]; is_changed = true;
    });
    return is_changed;
  }
  const without_seq = record_item => { const sendable = Object.assign({}, record_item); delete sendable._server_seq; return sendable; };

  // ---- Account ----
  async function server_info(server_url) {
    const response = await fetch(server_url.trim().replace(/\/+$/, '') + '/api/health', {cache: 'no-store'});
    if (!response.ok) throw new Error('Server said ' + response.status);
    return response.json();
  }
  // Joining a server: everything on this device is queued for upload straight away, so it goes up even if the page is left before Start syncing. Sequence numbers from an earlier server mean nothing to this one.
  async function keep_login(server_url, email_text, login_reply, data_key) {
    const joining_keys = await sync_crypto.working_keys(data_key);
    await load_records();
    if (!records.size) await drop_untouched_demo_sets(server_url, login_reply.token);
    capture_local(!records.size);
    records.forEach(record_item => { record_item._server_seq = 0; });
    await persist_records(Array.from(records.keys()), true);
    keys = joining_keys;
    is_admin = null;
    account = {server: server_url, email: email_text, user_id: login_reply.user_id, token: login_reply.token, device_id: login_reply.device_id};
    await meta_set('sync_last_seq', 0); await meta_set('sync_keys', keys); await meta_set('sync_account', account);
  }
  // A device joining an account that already has data: demo sets nobody has touched here aren't data, so they don't go up. Otherwise each new device would bring back the ones deleted on another.
  async function drop_untouched_demo_sets(server_url, login_token) {
    const first_page = await timed_fetch(server_url + '/api/sync/pull?since=0&limit=1', {headers: {Authorization: 'Bearer ' + login_token}}).then(response => response.json());
    if (!(first_page.records || []).length) return;
    const demo_sets = await fetch_demo_sets().catch(() => []), demo_by_id = new Map(demo_sets.map(demo_set => [demo_set.id, demo_set]));
    const is_untouched = saved_set => { const demo_set = demo_by_id.get(saved_set.id); return !!demo_set && !saved_set.active_ms && !saved_set.progress && !Object.keys(saved_set.learn_stages || {}).length && !Object.keys(saved_set.card_ratings || {}).length && !(saved_set.trophies || []).length && !saved_set.last_studied && !saved_set.best_speed && ['title', 'description', 'created', 'colour', 'front', 'cards'].every(field_name => same_value(saved_set[field_name], demo_set[field_name])); };
    adopt_sets(app_state.sets.filter(saved_set => !is_untouched(saved_set)));
    write_state_quietly();
  }
  // A server that confirms addresses sends a code first, which goes in with register.
  function request_signup_code(server_url, email_text) { return api('POST', '/api/signup/code', {email: email_text}, server_url.replace(/\/+$/, '')); }
  // New account: returns the recovery code to show once.
  async function register(server_url, email_text, password_text, email_code) {
    server_url = server_url.replace(/\/+$/, '');
    const kdf = sync_crypto.new_kdf(), master_key = await sync_crypto.derive_master(password_text, kdf), data_key = sync_crypto.new_data_key();
    const login_reply = await api('POST', '/api/register', {email: email_text, kdf, auth_hash: await sync_crypto.login_hash(master_key, password_text), wrapped_data_key: await sync_crypto.wrap_data_key(master_key, data_key), recovery_hash: await sync_crypto.recovery_hash(data_key), device_name: device_name(), code: email_code}, server_url);
    await keep_login(server_url, email_text, login_reply, data_key);
    return sync_crypto.recovery_code(data_key);
  }
  async function new_password_fields(password_text, data_key) {
    const kdf = sync_crypto.new_kdf(), master_key = await sync_crypto.derive_master(password_text, kdf);
    return {kdf, auth_hash: await sync_crypto.login_hash(master_key, password_text), wrapped_data_key: await sync_crypto.wrap_data_key(master_key, data_key)};
  }
  // Forgot the password: the recovery code opens the data; every other device is signed out and this one signs in with the new password.
  async function recover(server_url, email_text, code_text, password_text) {
    server_url = server_url.replace(/\/+$/, '');
    const data_key = sync_crypto.from_recovery_code(code_text);
    const login_reply = await api('POST', '/api/recover', Object.assign({email: email_text, recovery_hash: await sync_crypto.recovery_hash(data_key), device_name: device_name()}, await new_password_fields(password_text, data_key)), server_url);
    await keep_login(server_url, email_text, login_reply, data_key);
  }
  // While signed in: the old password must be right; other devices are signed out.
  async function change_password(old_password, new_password) {
    const account_info = await api('GET', '/api/me'), old_master = await sync_crypto.derive_master(old_password, account_info.kdf);
    let data_key;
    try { data_key = await sync_crypto.unwrap_data_key(old_master, account_info.wrapped_data_key); } catch (unwrap_err) { throw new Error('The current password is wrong'); }
    await api('POST', '/api/password', Object.assign({old_auth_hash: await sync_crypto.login_hash(old_master, old_password)}, await new_password_fields(new_password, data_key)));
  }
  async function sign_in(server_url, email_text, password_text) {
    server_url = server_url.replace(/\/+$/, '');
    const prelogin_reply = await api('POST', '/api/prelogin', {email: email_text}, server_url), master_key = await sync_crypto.derive_master(password_text, prelogin_reply.kdf);
    const login_reply = await api('POST', '/api/login', {email: email_text, auth_hash: await sync_crypto.login_hash(master_key, password_text), device_name: device_name()}, server_url);
    await keep_login(server_url, email_text, login_reply, await sync_crypto.unwrap_data_key(master_key, login_reply.wrapped_data_key));
  }
  async function start() { wire_triggers(); set_status({state: 'idle', pending: await outbox_size(), error: null}); schedule_sync(0); }
  async function sign_out() {
    try { await api('POST', '/api/logout'); } catch (logout_err) {}
    keys = null; account = null; is_admin = null;
    set_status({usage: null, admin: null});
    await meta_set('sync_keys', undefined); await meta_set('sync_account', undefined); await meta_set('sync_last_seq', undefined);
    clearTimeout(timer); set_status({state: 'off', error: null});
  }
  function signed_in() { return account ? {server: account.server, email: account.email, is_own_server: account.server !== DEFAULT_SERVER} : null; }
  async function devices() { return (await api('GET', '/api/devices')).devices; }

  // ---- The sync itself ----
  // All of it is read before any of it is used: a pull cut off halfway could otherwise show cards without their set. If the connection fails, the next try starts from the same place.
  async function pull_all() {
    const collections_text = COLLECTIONS.join(',');
    let since_seq = (await meta_get('sync_collections')) === collections_text ? (await meta_get('sync_last_seq')) || 0 : 0;
    const pulled = [];
    for (;;) {
      const page = await api('GET', '/api/sync/pull?since=' + since_seq + '&limit=500');
      for (const row of page.records) { const opened = await sync_crypto.open_json(keys, row.ciphertext); if (COLLECTIONS.includes(opened.c) && opened.r && opened.r.id) pulled.push({collection: opened.c, record: opened.r, seq: row.seq}); }
      since_seq = page.last_seq;
      if (!page.more) break;
    }
    return {pulled, since_seq};
  }
  // What was saved while waiting goes in first, so writing the merged records back can't lose it. No awaiting until the saved state and the records agree again.
  function merge_in(pulled_rows) {
    const captured_keys = capture_local(false), merged_keys = [];
    let changed_count = 0;
    pulled_rows.forEach(pulled_row => { if (apply_remote(pulled_row.collection, pulled_row.record, pulled_row.seq)) changed_count++; merged_keys.push(record_key_of(pulled_row.collection, pulled_row.record.id)); });
    if (changed_count) materialise_state();
    return {captured_keys, merged_keys, changed_count};
  }
  async function pull_and_merge() {
    const pull_result = await pull_all();
    if (view_is_busy()) return 0; // nothing changes under a page being worked on: fetched again once it's left
    const merge_result = merge_in(pull_result.pulled);
    await persist_records(merge_result.captured_keys, true);
    await persist_records(merge_result.merged_keys, false);
    await meta_set('sync_last_seq', pull_result.since_seq); await meta_set('sync_collections', COLLECTIONS.join(','));
    if (merge_result.changed_count) { if (typeof refresh_view === 'function') refresh_view(); }
    return merge_result.changed_count;
  }
  // Sets go first, so nothing arrives on another device before the set it belongs to.
  async function push_all() {
    let total_changed = 0;
    for (let round_number = 0; round_number < 5; round_number++) {
      const queued_keys = (await outbox_keys()).sort((key_a, key_b) => COLLECTIONS.indexOf(collection_of(key_a)) - COLLECTIONS.indexOf(collection_of(key_b)));
      let conflict_rows = [];
      for (let batch_start = 0; batch_start < queued_keys.length; batch_start += 200) {
        const batch_keys = queued_keys.slice(batch_start, batch_start + 200), ids_sent = new Map(), batch_rows = [], finished_keys = [];
        for (const record_key of batch_keys) {
          const record_item = records.get(record_key);
          if (!record_item) { finished_keys.push(record_key); continue; }
          const collection_name = collection_of(record_key), record_id = await sync_crypto.opaque_id(keys, collection_name, record_item.id);
          ids_sent.set(record_id, record_key);
          batch_rows.push({record_id, base_seq: record_item._server_seq || 0, ciphertext: await sync_crypto.seal_json(keys, {c: collection_name, r: without_seq(record_item)})});
        }
        const push_reply = batch_rows.length ? await api('POST', '/api/sync/push', {records: batch_rows}) : {accepted: [], conflicts: []};
        push_reply.accepted.forEach(accepted_row => { const record_key = ids_sent.get(accepted_row.record_id); records.get(record_key)._server_seq = accepted_row.seq; finished_keys.push(record_key); });
        for (const conflict_row of push_reply.conflicts) { const opened = await sync_crypto.open_json(keys, conflict_row.ciphertext); conflict_rows.push({collection: opened.c, record: opened.r, seq: conflict_row.seq}); }
        await persist_records(push_reply.accepted.map(accepted_row => ids_sent.get(accepted_row.record_id)), false);
        await remove_from_outbox(finished_keys);
      }
      if (!conflict_rows.length) break;
      if (view_is_busy()) break; // left queued; merged once the page is left
      const merge_result = merge_in(conflict_rows);
      await persist_records(merge_result.captured_keys, true);
      await persist_records(merge_result.merged_keys, false);
      total_changed += merge_result.changed_count;
      if (merge_result.changed_count && typeof refresh_view === 'function') refresh_view();
    }
    return total_changed;
  }
  // One tab at a time: two would each hold their own copy of the records.
  function one_tab_at_a_time(run_it) { return navigator.locks ? navigator.locks.request(DB_NAME, run_it) : run_it(); }
  function sync_now() {
    if (!account || !keys) return Promise.resolve();
    if (running) return running;
    running = (async () => {
      changed_while_running = false;
      set_status({state: 'syncing', error: null, tried: new Date().toISOString()});
      try {
        const changed_count = await one_tab_at_a_time(async () => {
          await load_records();
          if (!account) return 0; // signed out while waiting for the other tab
          const captured_keys = capture_local(false);
          await persist_records(captured_keys, true);
          const pulled_count = await pull_and_merge();
          return pulled_count + await push_all();
        });
        set_status({state: 'ok', last: new Date().toISOString(), pending: await outbox_size(), error: null, received: changed_count});
        failures = 0;
        sync_files();
        check_extras();
      } catch (sync_err) {
        const is_offline = !navigator.onLine || sync_err instanceof TypeError; // fetch failed: no network, or the server can't be reached
        set_status({state: is_offline ? 'offline' : 'error', error: is_offline ? null : sync_err.message, pending: await outbox_size()});
        failures++;
        if (sync_err.status === 401) { await meta_set('sync_account', undefined); account = null; set_status({state: 'off', error: 'The server signed this device out (' + sync_err.message + '). Sign in again.'}); }
      } finally {
        running = null;
        // Next try: every 30 seconds while on screen (5 minutes when not); after a failure sooner: 10, 20, 40, then every 60 seconds.
        if (account) schedule_sync(changed_while_running && !failures ? 4000 : failures ? Math.min(60000, 10000 * 2 ** (failures - 1)) : document.visibilityState === 'visible' ? 30000 : 300000);
      }
    })();
    return running;
  }
  // How much of this account's storage is used and, for the server's admin, who has signed up. Neither holds up the sync.
  async function check_extras() {
    try {
      set_status({usage: await api('GET', '/api/usage')});
      if (is_admin === false) return;
      const admin_summary = await api('GET', '/api/admin/summary');
      is_admin = true;
      set_status({admin: admin_summary});
      notify_new_signups(admin_summary.new_accounts);
    } catch (extras_err) { if (extras_err.status === 403 || extras_err.status === 404) is_admin = false; }
  }
  // Told once for each new number; opening the admin page clears it.
  function notify_new_signups(new_count) {
    let told_count = 0;
    try { told_count = Number(localStorage.getItem(ADMIN_NOTICE_KEY)) || 0; localStorage.setItem(ADMIN_NOTICE_KEY, String(new_count)); } catch (storage_err) {}
    if (new_count > told_count) toast(new_count + ' new sign-up' + (new_count === 1 ? '' : 's') + ' on your sync server', {action: 'Open admin', on_action: () => window.open(admin_url(), '_blank', 'noopener'), ms: 10000});
  }
  function admin_url() { return account ? account.server + '/admin' : ''; }
  function schedule_sync(delay_ms) { clearTimeout(timer); timer = setTimeout(sync_now, delay_ms); }
  function note_change() { if (!account) return; changed_while_running = !!running; set_status({pending: status.pending + 1}); schedule_sync(4000); }
  function wire_triggers() {
    if (wired) return;
    wired = true;
    addEventListener('online', () => schedule_sync(500));
    addEventListener('hashchange', () => { if (account) schedule_sync(500); }); // leaving a page that was holding things back
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && account) schedule_sync(500); });
  }

  // ---- Files (photos) ----
  // The records (name, type, what they're on) sync like everything else; the files themselves go separately, encrypted with the same key, under opaque ids.
  async function file_request(method_name, blob_id, body_bytes) {
    const response = await timed_fetch(account.server + '/api/blobs/' + await sync_crypto.opaque_id(keys, 'blobs', blob_id), {method: method_name, headers: {Authorization: 'Bearer ' + account.token}, body: body_bytes}, 5 * 60 * 1000);
    if (!response.ok && response.status !== 404) { const file_err = new Error(response.status === 507 ? 'Storage quota reached on the server' : 'Server said ' + response.status); file_err.status = response.status; throw file_err; }
    return response;
  }
  async function blob_row(blob_id) { return as_promise((await open_database()).transaction('blobs').objectStore('blobs').get(blob_id)); }
  async function all_blob_rows() { return as_promise((await open_database()).transaction('blobs').objectStore('blobs').getAll()); }
  async function put_blob_row(row_value) { const transaction = (await open_database()).transaction('blobs', 'readwrite'); transaction.objectStore('blobs').put(row_value); return tx_done(transaction); }
  async function drop_blob_row(blob_id) { const transaction = (await open_database()).transaction('blobs', 'readwrite'); transaction.objectStore('blobs').delete(blob_id); return tx_done(transaction); }
  function attachment_records() { const found = []; records.forEach((record_item, record_key) => { if (collection_of(record_key) === 'attachments') found.push(record_item); }); return found; }
  // Keep a file against a record, e.g. add_file('cards', card_id, photo_blob). Works signed out too, and goes up once signed in.
  async function add_file(parent_collection, parent_id, file_blob, file_name) {
    if (file_blob.size > MAX_FILE) throw new Error('A file can be up to 25 MB');
    return one_tab_at_a_time(async () => {
    await load_records();
    const file_id = crypto.randomUUID(), record_key = record_key_of('attachments', file_id), field_values = {parent_collection, parent_id, blob_id: file_id, mime: file_blob.type, size: file_blob.size, name: file_name || file_blob.name || ''}, record_item = Object.assign({id: file_id, _field_clocks: {}, _server_seq: 0}, field_values);
    Object.keys(field_values).forEach(field_name => { record_item._field_clocks[field_name] = next_clock(); });
    records.set(record_key, record_item);
    await put_blob_row({blob_id: file_id, data: file_blob, uploaded: false});
    await persist_records([record_key], true);
    note_change();
    return without_seq(record_item);
    });
  }
  function remove_file(file_id) { return one_tab_at_a_time(async () => {
    await load_records();
    const record_key = record_key_of('attachments', file_id), record_item = records.get(record_key);
    if (!record_item) return;
    record_item.deleted_at = Date.now(); record_item._field_clocks.deleted_at = next_clock();
    await persist_records([record_key], true);
    note_change();
  }); }
  function files_on(parent_collection, parent_id) { return attachment_records().filter(record_item => !record_item.deleted_at && record_item.parent_collection === parent_collection && record_item.parent_id === parent_id).map(without_seq); }
  // The file itself: from this device, or fetched from the server (null if it isn't there yet).
  async function get_file(file_id) {
    const stored_row = await blob_row(file_id);
    if (stored_row) return stored_row.data;
    if (!account || !keys) return null;
    const record_item = records.get(record_key_of('attachments', file_id)), response = await file_request('GET', file_id);
    if (response.status === 404) return null;
    const file_blob = new Blob([await sync_crypto.open_blob(keys, new Uint8Array(await response.arrayBuffer()))], {type: record_item ? record_item.mime : ''});
    await put_blob_row({blob_id: file_id, data: file_blob, uploaded: true});
    return file_blob;
  }
  async function files_waiting() {
    const stored_rows = await all_blob_rows(), held_ids = new Set(stored_rows.map(stored_row => stored_row.blob_id)), live_ids = new Set(attachment_records().filter(record_item => !record_item.deleted_at).map(record_item => record_item.id));
    const waiting_up = stored_rows.filter(stored_row => !stored_row.uploaded && live_ids.has(stored_row.blob_id)).length;
    const waiting_down = attachment_records().filter(record_item => !record_item.deleted_at && record_item.size <= MAX_AUTO_DOWNLOAD && !held_ids.has(record_item.id)).length;
    return {files_waiting: waiting_up + waiting_down, files_waiting_up: waiting_up};
  }
  // Up first, then anything removed, then down. Bigger files are fetched when they're opened.
  function sync_files() {
    if (files_running) return files_running;
    files_running = (async () => {
      try {
        set_status(Object.assign({files: 'syncing'}, await files_waiting()));
        const attachments_by_id = new Map(attachment_records().map(record_item => [record_item.id, record_item]));
        for (const stored_row of await all_blob_rows()) {
          const record_item = attachments_by_id.get(stored_row.blob_id);
          if (!record_item) continue;
          if (record_item.deleted_at) { await file_request('DELETE', stored_row.blob_id); await drop_blob_row(stored_row.blob_id); continue; }
          if (stored_row.uploaded) continue;
          await file_request('PUT', stored_row.blob_id, await sync_crypto.seal_blob(keys, new Uint8Array(await stored_row.data.arrayBuffer())));
          await put_blob_row(Object.assign({}, stored_row, {uploaded: true}));
        }
        for (const record_item of attachments_by_id.values()) {
          if (record_item.deleted_at || record_item.size > MAX_AUTO_DOWNLOAD || await blob_row(record_item.id)) continue;
          await get_file(record_item.id);
          set_status({files_waiting: Math.max(0, status.files_waiting - 1)});
        }
        set_status(Object.assign({files: 'idle', file_error: null}, await files_waiting()));
      } catch (file_err) {
        console.warn('Files not synced:', file_err.message);
        set_status({files: 'error', file_error: file_err.message});
      } finally { files_running = null; }
    })();
    return files_running;
  }

  // ---- Is this device in step? ----
  // A short code for all the records on this device (every record's id and the time each of its fields last changed), shown as three words. Two devices with the same words hold the same data.
  const CODE_WORDS = [
    'apple', 'arrow', 'badge', 'baker', 'bamboo', 'banjo', 'beach', 'beacon', 'berry', 'bison', 'blaze', 'bloom',
    'bottle', 'bramble', 'breeze', 'brick', 'bridge', 'brook', 'bucket', 'butter', 'cabin', 'cactus', 'camel', 'candle',
    'canyon', 'carpet', 'castle', 'cedar', 'chalk', 'cherry', 'chimney', 'cinder', 'circus', 'citrus', 'clover', 'cobalt',
    'comet', 'copper', 'coral', 'cotton', 'cradle', 'crane', 'crater', 'cricket', 'crystal', 'cupboard', 'dagger', 'daisy',
    'dancer', 'delta', 'desert', 'diamond', 'dolphin', 'dragon', 'drum', 'eagle', 'ember', 'engine', 'falcon', 'feather',
    'fern', 'fiddle', 'flame', 'flute', 'forest', 'fossil', 'fountain', 'fox', 'galaxy', 'garden', 'garnet', 'ginger',
    'glacier', 'globe', 'goose', 'granite', 'grape', 'gravel', 'harbour', 'harvest', 'hazel', 'hedge', 'helmet', 'heron',
    'hollow', 'honey', 'horizon', 'island', 'ivory', 'jacket', 'jasmine', 'jelly', 'jungle', 'kettle', 'kite', 'ladder',
    'lagoon', 'lantern', 'lemon', 'lily', 'linen', 'lizard', 'lobster', 'magnet', 'mango', 'maple', 'marble', 'meadow',
    'melon', 'meteor', 'mint', 'mirror', 'monkey', 'moss', 'mountain', 'mushroom', 'needle', 'nest', 'nickel', 'oasis',
    'ocean', 'olive', 'onion', 'orchard', 'otter', 'oyster', 'paddle', 'palace', 'panda', 'paper', 'parrot', 'pebble',
    'pepper', 'pickle', 'pigeon', 'pillow', 'pine', 'planet', 'plum', 'pocket', 'pony', 'poppy', 'puddle', 'pumpkin',
    'quartz', 'quill', 'rabbit', 'radar', 'raven', 'reef', 'ribbon', 'river', 'robin', 'rocket', 'rose', 'ruby',
    'saddle', 'salmon', 'sandal', 'satin', 'scarf', 'shadow', 'shell', 'shovel', 'silver', 'sketch', 'sledge', 'slipper',
    'spark', 'sparrow', 'spider', 'spoon', 'spruce', 'squirrel', 'stable', 'star', 'stone', 'storm', 'sugar', 'summit',
    'sunset', 'swan', 'table', 'tangle', 'temple', 'thistle', 'thunder', 'tiger', 'timber', 'toast', 'topaz', 'torch',
    'tower', 'trumpet', 'tulip', 'tunnel', 'turtle', 'umbrella', 'valley', 'velvet', 'violet', 'volcano', 'wagon', 'walnut',
    'walrus', 'wand', 'whale', 'wheat', 'whistle', 'willow', 'window', 'winter', 'wizard', 'wolf', 'yacht', 'zebra',
    'acorn', 'anchor', 'atlas', 'basket', 'beetle', 'blossom', 'button', 'canoe', 'carrot', 'cello', 'cobweb', 'compass',
    'cookie', 'dune', 'easel', 'falafel', 'ferry', 'fig', 'goblet', 'hammock', 'igloo', 'jigsaw', 'kayak', 'koala',
    'lemur', 'locket', 'marsh', 'mitten', 'muffin', 'nutmeg', 'orbit', 'paprika', 'pelican', 'pixel', 'prism', 'quiver',
    'raisin', 'rhubarb', 'sapphire', 'scooter'
  ];
  async function data_code() {
    const code_parts = [];
    records.forEach((record_item, record_key) => { const clocks = record_item._field_clocks || {}; code_parts.push(record_key + '/' + Object.keys(clocks).sort().map(field_name => field_name + '=' + clocks[field_name]).join(',')); });
    code_parts.sort();
    const hash_bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code_parts.join('\n'))));
    return {words: [hash_bytes[0], hash_bytes[1], hash_bytes[2]].map(byte_value => CODE_WORDS[byte_value]).join(' '), records: code_parts.length};
  }

  // ---- Starting up ----
  // `ready` settles once the saved sign-in has been read, so Settings doesn't show Sign in to a device that is signed in.
  async function init() {
    try {
      device_id = await meta_get('device_id');
      if (!device_id) { device_id = crypto.randomUUID().replace(/-/g, '').slice(0, 12); await meta_set('device_id', device_id); }
      last_clock = (await meta_get('clock')) || last_clock;
      account = (await meta_get('sync_account')) || null;
      keys = (await meta_get('sync_keys')) || null;
      await load_records();
      if (!account || !keys) { account = null; keys = null; set_status({state: 'off'}); return; }
      // Saved sets lost but still signed in: they come back from the records rather than counting as all deleted.
      if (!saved_state_now() && records.size) { materialise_state(); refresh_view(); }
      set_status({state: 'idle', pending: await outbox_size()});
      wire_triggers();
      schedule_sync(300);
    } catch (init_err) {
      console.warn('Sync not started:', init_err.message);
    } finally { mark_ready(); }
  }
  // Another tab saved: this one catches up, unless a page here is being worked on.
  function watch_other_tabs() {
    addEventListener('storage', storage_event => {
      if (storage_event.key !== STORAGE_KEY) return;
      const catch_up = () => {
        if (view_is_busy()) { setTimeout(catch_up, 2000); return; }
        const saved_state = saved_state_now();
        if (!saved_state) return;
        adopt_sets(saved_state.sets);
        Object.keys(saved_state).forEach(state_key => { if (state_key !== 'sets') app_state[state_key] = saved_state[state_key]; });
        refresh_view();
      };
      catch_up();
    });
  }
  return {DEFAULT_SERVER, admin_url, ready, init, watch_other_tabs, on_status, get status() { return status; }, sync_now, note_change, check_link, server_info, request_signup_code, register, recover, change_password, sign_in, sign_out, start, signed_in, devices, data_code, add_file, remove_file, files_on, get_file};
})();
