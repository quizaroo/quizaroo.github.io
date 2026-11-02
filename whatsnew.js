// What's new: after an update a sheet lists what changed, each with Show me. One update (everything published at once) at a time, headed with when it went live; ‹ Older and Newer › (or ← / →) step through every update there has been.
// Every release adds its entry to WHATS_NEW and bumps VERSION in sw.js:
//   text  one plain line: what changed and where
//   go    the address to go to, e.g. '#/library'
//   open  selectors clicked in turn to get there (e.g. open the first set)
//   at    the element that changed: it is scrolled to and pulses
//   more  other places the same change reached, in words
// No `at`: no Show me. PUBLISHED holds when each version went live (UTC), filled in by tools/publish.py.
const FIRST_SET = ['.set-row .row-title'];
const WHATS_NEW = {
  '1.1.02': [
    {text: 'The eye button at the top replaces day and night. It holds Day or Night, and a choice of two styles: Lined, or Plain with rounded cards.', go: '#/', at: '#view-button'},
    {text: 'Each set: press and hold a tile, then drag it anywhere to rearrange. The others move aside, and a blue dashed outline shows where it will land.', go: '#/library', open: FIRST_SET, at: '.mode-tiles', more: 'The order you choose applies to every set.'},
    {text: 'Flashcards is now the second tile by default.', go: '#/library', open: FIRST_SET, at: '[data-mode="cards"]'},
    {text: 'Edit a set: press and hold a card to move it up or down the list.', go: '#/new', at: '.edit-row'},
    {text: 'Learn from scratch: Back and Forward. Back returns to the last step and undoes it. Forward moves on without marking the card.'},
    {text: 'Cards: words now sit a few pixels above the line.'}
  ],
  '1.1.01': [
    {text: 'Settings: check for updates by hand, read every past update here, and choose whether this list appears after an update.', go: '#/settings', at: '.updates-section'},
    {text: 'Each set now has a trophy shelf. Finish a round in any mode to win a reward, and tap one to see what it was for.', go: '#/library', open: FIRST_SET, at: '.trophy-shelf', more: 'The better the round, the better the reward, with special ones for knowing a whole set.'},
    {text: 'Each set: its learning modes are now tiles, each with its own drawing and a line saying what it is for.', go: '#/library', open: FIRST_SET, at: '.mode-tiles'},
    {text: 'Edit a set: created date and colour are now near the top, above the cards. Tab still goes straight from About to the first term.', go: '#/new', at: '.detail-row input[type=date]'},
    {text: 'Cards in every mode: words now sit on the lines of the paper. Learn from scratch names each side in the margin instead of using an equals sign.'},
    {text: 'Term first, Definition first and Mixed: now three buttons in every mode, and they change the card on screen straight away.'},
    {text: 'Your Library now sorts by newest first. Sort by changes it, and your choice is kept.', go: '#/library', at: '.toggle-line select'},
    {text: 'Dark mode: the options in drop-down lists can be read again. Fixed.', go: '#/library', at: '.toggle-line select'},
    {text: 'A bar now tells you when a new version is ready. Press Reload to get it, and this list shows what changed.', more: 'The app also keeps working with no connection once it has loaded.'}
  ],
  '1.1.00': [
    {text: 'New look based on Sift\'s Lined paper, with ruled lines, a red margin and colour on every set.', go: '#/library', at: '.ruled'},
    {text: 'Sidebar: Home and Your Library.', go: '#/', at: '#sidebar', more: 'On a phone it sits along the bottom.'},
    {text: 'Home: sets ready to revise, recently studied, recently opened and newest.', go: '#/', at: '.home-section'},
    {text: 'The + button at the top right starts a new set.', go: '#/', at: '#topbar-actions .icon-button'},
    {text: 'New set: Tab moves from term to definition to the next term, and new rows appear as you type.', go: '#/new', at: '.edit-row'},
    {text: 'Each set now has 14 ways to learn it.', go: '#/library', open: FIRST_SET, at: '.mode-tiles', more: 'View all vocab, Learn from scratch, Revise, Flashcards, Type the answer, Multiple choice, True or false, Unscramble, Listen and type, Test, Spin the wheel, Match pairs, Memory and Speed round.'},
    {text: 'The app tracks how well you know each card and brings hard ones back sooner. Your Library shows the progress on each set.', go: '#/library', at: '.meter'},
    {text: 'Reset progress puts every card in a set back to new.', go: '#/library', open: FIRST_SET, at: '.set-actions'},
    {text: 'Sets can have a description, a created date and a colour. The demo sets have tidier titles to match.', go: '#/library', at: '.row-description'},
    {text: 'Light and dark colours to choose from.', go: '#/', at: '#view-button'},
    {text: 'Show first has moved from the top of the page into the modes, with a new Mixed option.'},
    {text: 'A set with no cards can no longer be saved or studied.'}
  ],
  '1.0.02': [{text: 'Import: if a set already exists with different cards, you choose to merge, replace, keep both or skip.'}],
  '1.0.01': [{text: 'A new browser starts with demo sets, and Load demo sets adds any that are missing.', go: '#/library', at: '.set-row'}],
  '1.0.00': [{text: 'Open Flashcards goes live: make sets, flip and swipe through them, and import or export them as JSON.'}]
};
const PUBLISHED = {
  '1.1.02': '2026-11-02T14:29:30Z',
  '1.1.01': '2026-11-02T14:06:17Z',
  '1.1.00': '2026-11-02T13:36:09Z',
  '1.0.02': '2026-11-02T12:27:01Z',
  '1.0.01': '2026-11-02T12:25:01Z',
  '1.0.00': '2026-11-01T22:22:27Z',
};
function version_number(version_text) { return version_text.split('.').map(Number).reduce((number_total, version_part) => number_total * 1000 + version_part, 0); }
const APP_VERSION = Object.keys(WHATS_NEW).sort((version_a, version_b) => version_number(version_b) - version_number(version_a))[0];

// Every update up to this version, newest first. Versions published together show as one update.
function all_updates() {
  const update_list = [];
  Object.keys(WHATS_NEW).sort((version_a, version_b) => version_number(version_b) - version_number(version_a)).forEach(version_text => {
    const published_at = PUBLISHED[version_text] || null, last_update = update_list[update_list.length - 1];
    if (last_update && last_update.published_at === published_at) last_update.versions.push(version_text); else update_list.push({published_at, versions: [version_text]});
  });
  update_list.forEach(update_item => { update_item.rows = update_item.versions.flatMap(version_text => WHATS_NEW[version_text].map(entry => ({version_text, entry}))); });
  return update_list;
}
function published_text(published_at) { return published_at ? new Date(published_at).toLocaleString(undefined, {weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'}) : 'Not published yet'; }

// `from_version`: the version this device had, which says how many updates it missed. `page_index`: which update, 0 the newest.
function show_whats_new(from_version, page_index) {
  const update_list = all_updates(); let current_page = page_index || 0, current_rows = [];
  const missed_count = update_list.filter(update_item => update_item.versions.some(version_text => version_number(version_text) > version_number(from_version))).length;
  const dialog_el = el('dialog', {class: 'whatsnew-sheet'});
  function draw_page() {
    const update_item = update_list[current_page], versions_label = update_item.versions.length > 1 ? update_item.versions[update_item.versions.length - 1] + ' to ' + update_item.versions[0] : update_item.versions[0];
    current_rows = update_item.rows;
    dialog_el.replaceChildren(
      el('div', {class: 'whatsnew-head'}, el('h2', {}, "What's new"), el('button', {onclick: () => dialog_el.close()}, '✓ Close')),
      el('div', {class: 'whatsnew-nav'},
        el('button', Object.assign({title: 'The update before this one', 'data-step': 1, onclick: () => step_page(1)}, current_page >= update_list.length - 1 ? {disabled: 'disabled'} : {}), '‹ Older'),
        el('span', {class: 'whatsnew-when'}, el('b', {}, published_text(update_item.published_at)), el('span', {class: 'muted'}, ' · ' + versions_label)),
        el('button', Object.assign({title: 'The update after this one', 'data-step': -1, onclick: () => step_page(-1)}, current_page <= 0 ? {disabled: 'disabled'} : {}), 'Newer ›')),
      current_page === 0 && missed_count > 1 ? el('p', {class: 'muted'}, missed_count + ' updates since you last looked: ‹ Older for the others.') : '',
      el('ul', {class: 'whatsnew-list'}, ...current_rows.map(row_item => el('li', {},
        el('div', {class: 'whatsnew-text'}, row_item.entry.text, row_item.entry.more ? el('span', {class: 'muted whatsnew-more'}, row_item.entry.more) : null),
        row_item.entry.at ? el('button', {class: 'show-me', onclick: () => { dialog_el.close(); show_me(row_item.entry, from_version, current_page); }}, 'Show me') : null))));
  }
  function step_page(step_by) { const next_page = current_page + step_by; if (next_page < 0 || next_page >= update_list.length) return; current_page = next_page; draw_page(); const step_el = dialog_el.querySelector('[data-step="' + step_by + '"]:not([disabled])'); if (step_el) step_el.focus(); }
  draw_page(); document.body.appendChild(dialog_el);
  dialog_el.addEventListener('close', () => dialog_el.remove());
  dialog_el.addEventListener('keydown', key_event => { if (key_event.key === 'ArrowLeft') { key_event.preventDefault(); step_page(1); } else if (key_event.key === 'ArrowRight') { key_event.preventDefault(); step_page(-1); } });
  dialog_el.showModal();
}
// Wait for something to be drawn (a set page draws after the address changes).
function wait_for_drawn(selector_text) {
  const give_up_at = Date.now() + 4000;
  return new Promise(found => { (function look_again() { const found_el = Array.from(document.querySelectorAll(selector_text)).find(node_el => node_el.getClientRects().length); if (found_el || Date.now() > give_up_at) return found(found_el || null); setTimeout(look_again, 100); })(); });
}
async function show_me(entry, from_version, page_index) {
  const back_to_list = {action: "‹ What's new", on_action: () => show_whats_new(from_version, page_index), ms: 9000};
  if (entry.go && location.hash !== entry.go && !(entry.go === '#/' && !location.hash)) location.hash = entry.go;
  await new Promise(done => setTimeout(done, 80));
  for (const selector_text of entry.open || []) { const open_el = await wait_for_drawn(selector_text); if (!open_el) return toast("Couldn't find it here (there may be nothing to open yet)", back_to_list); open_el.click(); await new Promise(done => setTimeout(done, 80)); }
  const target_el = await wait_for_drawn(entry.at);
  if (!target_el) return toast("Couldn't find it here (there may be nothing to show yet)", back_to_list);
  target_el.scrollIntoView({block: 'center', behavior: 'smooth'});
  target_el.classList.remove('flash'); void target_el.offsetWidth; target_el.classList.add('flash'); setTimeout(() => target_el.classList.remove('flash'), 2200);
  toast('Here it is', back_to_list);
}
function toast(toast_text, toast_options) {
  document.querySelectorAll('.toast').forEach(old_toast => old_toast.remove());
  const toast_el = el('div', {class: 'toast', role: 'status'}, toast_text, toast_options && toast_options.action ? el('button', {onclick: () => { toast_el.remove(); toast_options.on_action(); }}, toast_options.action) : null);
  document.body.appendChild(toast_el); setTimeout(() => toast_el.remove(), (toast_options && toast_options.ms) || 3000);
}

// ---- Service worker ----
// Look for a new version now: 'ready' when one is waiting, 'latest' when this is the newest, 'offline' when the server can't be reached.
async function check_for_update() {
  const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
  if (!registration) return 'latest';
  try { await registration.update(); } catch (update_err) { return 'offline'; }
  if (registration.installing) await new Promise(done => { const new_worker = registration.installing; new_worker.addEventListener('statechange', () => { if (new_worker.state !== 'installing') done(); }); });
  return registration.waiting ? 'ready' : 'latest';
}
async function apply_update() {
  const registration = await navigator.serviceWorker.getRegistration();
  if (registration && registration.waiting) registration.waiting.postMessage('skip-waiting'); else location.reload();
}
function register_service_worker() {
  if (!('serviceWorker' in navigator)) return;
  const banner_el = document.getElementById('update-banner'), banner_button = banner_el.querySelector('button');
  function offer_update() {
    banner_el.hidden = false;
    // A version that has waited since an earlier visit may be several behind: fetch the newest first so one press goes straight to it.
    banner_button.onclick = async () => { if (editor_has_changes && editor_has_changes() && !confirm('Discard your changes?')) return; editor_has_changes = null; banner_button.disabled = true; banner_button.textContent = 'Updating…'; await check_for_update(); apply_update(); };
  }
  // An app left open (on a phone's home screen, say) looks for a new version whenever it comes back to the front, at most once a minute.
  let last_check_ms = 0;
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible' || Date.now() - last_check_ms < 60000) return; last_check_ms = Date.now(); navigator.serviceWorker.getRegistration().then(registration => { if (registration) return registration.update(); }).catch(() => {}); });
  navigator.serviceWorker.register('sw.js').then(registration => {
    if (registration.waiting && navigator.serviceWorker.controller) offer_update();
    registration.addEventListener('updatefound', () => { const new_worker = registration.installing; new_worker.addEventListener('statechange', () => { if (new_worker.state === 'installed' && navigator.serviceWorker.controller) offer_update(); }); });
  }).catch(worker_err => console.warn('Offline support unavailable:', worker_err.message));
  // The first version to install takes over without a reload; only a later one has changed anything on screen.
  let had_controller = !!navigator.serviceWorker.controller, is_reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!had_controller) { had_controller = true; return; } if (is_reloading || (editor_has_changes && editor_has_changes())) return; is_reloading = true; location.reload(); });
}
// After an update: the sheet, once, if it is wanted.
function after_update() {
  const from_version = app_state.seen_version || '1.0.02';
  if (from_version === APP_VERSION) return;
  app_state.seen_version = APP_VERSION; app_state.whatsnew_last = from_version; save_state();
  if (app_state.show_update_info !== false && !is_first_run()) show_whats_new(from_version);
}
