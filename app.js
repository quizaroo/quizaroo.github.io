// Open Flashcards: browser-only. Data lives in localStorage; import/export uses the open JSON format described in README.md.
const STORAGE_KEY = 'open-flashcards:v1', view_el = document.getElementById('view'), topbar_actions_el = document.getElementById('topbar-actions'), import_input_el = document.getElementById('import-file');
let app_state = load_state(), study_session = null;

function load_state() {
  try { const stored_state = JSON.parse(localStorage.getItem(STORAGE_KEY)); if (stored_state && Array.isArray(stored_state.sets)) return stored_state; } catch (storage_err) {}
  return {sets: [], default_front: 'term', shuffle: true};
}
function save_state() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(app_state)); } catch (storage_err) { alert('Could not save: browser storage is full or blocked.'); } }
function new_id() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function find_set(set_id) { return app_state.sets.find(card_set => card_set.id === set_id); }
function set_front(card_set) { return card_set.front || app_state.default_front; }

// Tiny DOM builder: el('div', {class: 'x', onclick: fn}, child, 'text', ...)
function el(tag_name, attributes) {
  const node_el = document.createElement(tag_name);
  Object.keys(attributes || {}).forEach(attr_name => { const attr_value = attributes[attr_name]; if (attr_name.startsWith('on')) node_el.addEventListener(attr_name.slice(2), attr_value); else if (attr_name === 'value') node_el.value = attr_value; else if (attr_name === 'checked') node_el.checked = attr_value; else node_el.setAttribute(attr_name, attr_value); });
  for (let child_index = 2; child_index < arguments.length; child_index++) { const child_item = arguments[child_index]; if (child_item === null || child_item === undefined || child_item === false) continue; node_el.appendChild(typeof child_item === 'string' || typeof child_item === 'number' ? document.createTextNode(String(child_item)) : child_item); }
  return node_el;
}
function render(topbar_buttons, content_nodes) { topbar_actions_el.replaceChildren(); topbar_buttons.forEach(button_el => topbar_actions_el.appendChild(button_el)); view_el.replaceChildren(); content_nodes.forEach(content_node => view_el.appendChild(content_node)); window.scrollTo(0, 0); }

// ---- Import / export ----
function normalise_set(raw_set) {
  if (!raw_set || !Array.isArray(raw_set.cards)) return null;
  return {id: String(raw_set.id || new_id()), title: String(raw_set.title || 'Untitled set'), cards: raw_set.cards.filter(raw_card => raw_card && (raw_card.term || raw_card.definition)).map(raw_card => ({term: String(raw_card.term || ''), definition: String(raw_card.definition || '')})), front: raw_set.front === 'definition' ? 'definition' : undefined};
}
// Accepts {format, sets:[...]}, a bare array of sets, or a single set object. Sets with an existing id go through compare_sets; nothing is saved until any conflicts are resolved.
function import_json(json_text) {
  let parsed_json; try { parsed_json = JSON.parse(json_text); } catch (parse_err) { alert('That file is not valid JSON.'); return; }
  const raw_sets = Array.isArray(parsed_json) ? parsed_json : Array.isArray(parsed_json.sets) ? parsed_json.sets : [parsed_json];
  const imported_sets = Array.from(new Map(raw_sets.map(normalise_set).filter(Boolean).map(imported_set => [imported_set.id, imported_set])).values());
  if (!imported_sets.length) { alert('No flashcard sets found in that file.'); return; }
  const new_sets = [], conflicts = []; let identical_count = 0;
  imported_sets.forEach(imported_set => {
    const your_set = find_set(imported_set.id);
    if (!your_set) { new_sets.push(imported_set); return; }
    const comparison = compare_sets(your_set, imported_set);
    if (comparison.new_cards.length || comparison.changed_cards.length || comparison.only_yours_count) conflicts.push({your_set, imported_set, comparison, choice: 'merge'}); else identical_count++;
  });
  if (conflicts.length) view_import_conflicts(new_sets, conflicts, identical_count); else apply_import(new_sets, conflicts, identical_count);
}
function clean_text(raw_text) { return raw_text.trim().replace(/\s+/g, ' '); }
function card_key(card_item) { return clean_text(card_item.term).toLowerCase() || '\0' + clean_text(card_item.definition); }
// Cards match by term, ignoring capitals and extra spaces. A set with duplicate terms counts as unchanged if any of its copies has the imported definition.
function compare_sets(your_set, imported_set) {
  const your_cards_by_key = new Map(), imported_keys = new Set(imported_set.cards.map(card_key)), seen_cards = new Set(), new_cards = [], changed_cards = [];
  your_set.cards.forEach(card_item => { const key_text = card_key(card_item); if (!your_cards_by_key.has(key_text)) your_cards_by_key.set(key_text, []); your_cards_by_key.get(key_text).push(card_item); });
  imported_set.cards.forEach(imported_card => {
    const key_text = card_key(imported_card), definition_text = clean_text(imported_card.definition), matching_cards = your_cards_by_key.get(key_text), seen_text = key_text + '\n' + definition_text;
    if (seen_cards.has(seen_text)) return; seen_cards.add(seen_text);
    if (!matching_cards) new_cards.push(imported_card);
    else if (!matching_cards.some(card_item => clean_text(card_item.definition) === definition_text)) changed_cards.push({your_card: matching_cards[0], imported_card, use_imported: false});
  });
  return {new_cards, changed_cards, only_yours_count: your_set.cards.filter(card_item => !imported_keys.has(card_key(card_item))).length};
}
function apply_import(new_sets, conflicts, identical_count) {
  const choice_counts = {merge: 0, replace: 0, both: 0, skip: 0};
  conflicts.forEach(conflict => {
    choice_counts[conflict.choice]++;
    if (conflict.choice === 'merge') { conflict.comparison.changed_cards.forEach(changed_card => { if (changed_card.use_imported) changed_card.your_card.definition = changed_card.imported_card.definition; }); conflict.your_set.cards.push(...conflict.comparison.new_cards); }
    else if (conflict.choice === 'replace') app_state.sets[app_state.sets.indexOf(conflict.your_set)] = conflict.imported_set;
    else if (conflict.choice === 'both') app_state.sets.push(Object.assign({}, conflict.imported_set, {id: new_id(), title: conflict.imported_set.title + ' (imported)'}));
  });
  app_state.sets.push(...new_sets); save_state();
  const summary_parts = [[new_sets.length, 'added'], [choice_counts.merge, 'merged'], [choice_counts.replace, 'replaced'], [choice_counts.both, 'kept as a copy'], [choice_counts.skip, 'skipped'], [identical_count, 'already up to date']].filter(summary_part => summary_part[0]).map(summary_part => summary_part[0] + ' ' + summary_part[1]);
  alert('Import finished: ' + summary_parts.join(', ') + '.'); route();
}
function download_json(file_name, sets_to_export) {
  const export_blob = new Blob([JSON.stringify({format: 'open-flashcards', version: 1, sets: sets_to_export}, null, 1)], {type: 'application/json'});
  const link_el = el('a', {href: URL.createObjectURL(export_blob), download: file_name}); document.body.appendChild(link_el); link_el.click(); link_el.remove();
}
function safe_file_name(title_text) { return (title_text.replace(/[\\/:*?"<>|]+/g, '').trim() || 'set') + '.json'; }
import_input_el.addEventListener('change', () => { const chosen_file = import_input_el.files[0]; if (!chosen_file) return; chosen_file.text().then(import_json); import_input_el.value = ''; });

// ---- Demo sets ----
function is_first_run() { try { return localStorage.getItem(STORAGE_KEY) === null; } catch (storage_err) { return false; } }
function fetch_demo_sets() { return fetch('demo-sets.json').then(demo_response => demo_response.json()).then(demo_json => demo_json.sets.map(normalise_set).filter(Boolean)); }
// Seeds only a browser with nothing saved; saved data, even an empty library, is never touched.
function seed_demo_sets() { if (is_first_run()) fetch_demo_sets().then(demo_sets => { if (!is_first_run()) return; app_state.sets = demo_sets; save_state(); route(); }).catch(() => {}); }
// Adds only the demo sets that are missing, so an edited copy is never replaced.
function add_missing_demo_sets() { fetch_demo_sets().then(demo_sets => { const missing_sets = demo_sets.filter(demo_set => !find_set(demo_set.id)); app_state.sets.push(...missing_sets); save_state(); alert('Added ' + missing_sets.length + ' demo set(s).'); route(); }).catch(() => alert('Could not load the demo sets.')); }

// ---- Views ----
function view_library() {
  const sorted_sets = app_state.sets.slice().sort((set_a, set_b) => set_a.title.localeCompare(set_b.title));
  render([el('button', {onclick: () => import_input_el.click()}, 'Import'), el('button', {onclick: () => download_json('open-flashcards-all.json', app_state.sets)}, 'Export all')], [
    el('div', {class: 'button-row'}, el('button', {class: 'primary', onclick: () => { const created_set = {id: new_id(), title: 'New set', cards: [{term: '', definition: ''}]}; app_state.sets.push(created_set); save_state(); location.hash = '#/edit/' + created_set.id; }}, '+ New set'), el('button', {onclick: add_missing_demo_sets}, 'Load demo sets'),
      el('label', {class: 'toggle-line'}, 'Show first:', el('select', {onchange: change_event => { app_state.default_front = change_event.target.value; save_state(); }}, el('option', {value: 'term'}, 'Term'), el('option', {value: 'definition'}, 'Definition')))),
    sorted_sets.length ? el('div', {class: 'set-list'}) : el('p', {class: 'empty muted'}, 'No sets yet. Create one, or import a .json file.')
  ]);
  view_el.querySelector('select').value = app_state.default_front;
  const set_list_el = view_el.querySelector('.set-list');
  if (set_list_el) sorted_sets.forEach(card_set => set_list_el.appendChild(el('a', {class: 'set-tile', href: '#/set/' + card_set.id}, el('strong', {}, card_set.title), el('span', {class: 'muted'}, card_set.cards.length + ' cards'))));
}

function view_import_conflicts(new_sets, conflicts, identical_count) {
  const choice_options = [['merge', 'Merge'], ['replace', 'Replace with imported'], ['both', 'Keep both'], ['skip', 'Skip']];
  const conflict_panels = conflicts.map((conflict, conflict_index) => {
    const changed_cards = conflict.comparison.changed_cards, changed_list_el = changed_cards.length ? el('div', {class: 'card-table'}) : null;
    changed_cards.forEach((changed_card, changed_index) => {
      const radio_name = 'changed-' + conflict_index + '-' + changed_index;
      changed_list_el.appendChild(el('div', {class: 'conflict-card'}, el('strong', {}, changed_card.your_card.term),
        el('label', {class: 'toggle-line'}, el('input', {type: 'radio', name: radio_name, checked: true, onchange: () => { changed_card.use_imported = false; }}), 'Yours: ' + changed_card.your_card.definition),
        el('label', {class: 'toggle-line'}, el('input', {type: 'radio', name: radio_name, onchange: () => { changed_card.use_imported = true; }}), 'Imported: ' + changed_card.imported_card.definition)));
    });
    function show_changed() { if (changed_list_el) changed_list_el.hidden = conflict.choice !== 'merge'; }
    conflict.select_el = el('select', {onchange: change_event => { conflict.choice = change_event.target.value; show_changed(); }}, ...choice_options.map(choice_option => el('option', {value: choice_option[0]}, choice_option[1])));
    conflict.show_changed = show_changed;
    return el('div', {class: 'conflict-panel'}, el('strong', {}, conflict.your_set.title),
      conflict.imported_set.title !== conflict.your_set.title ? el('div', {class: 'muted'}, 'Imported title: ' + conflict.imported_set.title) : null,
      el('div', {class: 'muted'}, conflict.comparison.new_cards.length + ' new · ' + changed_cards.length + ' changed · ' + conflict.comparison.only_yours_count + ' only in yours'),
      el('label', {class: 'toggle-line'}, 'Action:', conflict.select_el), changed_list_el);
  });
  const apply_all_el = conflicts.length > 1 ? el('label', {class: 'toggle-line'}, 'Apply to all:', el('select', {onchange: change_event => { if (!change_event.target.value) return; conflicts.forEach(conflict => { conflict.choice = change_event.target.value; conflict.select_el.value = conflict.choice; conflict.show_changed(); }); }}, el('option', {value: ''}, 'Choose…'), ...choice_options.map(choice_option => el('option', {value: choice_option[0]}, choice_option[1])))) : null;
  render([el('button', {onclick: route}, 'Cancel'), el('button', {class: 'primary', onclick: () => apply_import(new_sets, conflicts, identical_count)}, 'Finish import')], [
    el('h1', {}, 'Resolve import'),
    el('div', {class: 'muted'}, conflicts.length + ' set(s) already exist with different cards. Merge keeps your cards and adds the new ones. Nothing is saved until you finish.'),
    new_sets.length || identical_count ? el('div', {class: 'muted'}, new_sets.length + ' new set(s) will be added, ' + identical_count + ' already up to date.') : null,
    apply_all_el, el('div', {class: 'set-list'}, ...conflict_panels)
  ]);
}

function view_set(card_set) {
  const front_select_el = el('select', {onchange: change_event => { card_set.front = change_event.target.value; save_state(); }}, el('option', {value: 'term'}, 'Term'), el('option', {value: 'definition'}, 'Definition'));
  front_select_el.value = set_front(card_set);
  const card_table_el = el('div', {class: 'card-table'});
  card_set.cards.forEach(card_item => card_table_el.appendChild(el('div', {class: 'card-row'}, el('div', {}, card_item.term), el('div', {class: 'muted'}, card_item.definition))));
  render([el('a', {class: 'button', href: '#/edit/' + card_set.id}, 'Edit')], [
    el('h1', {}, card_set.title), el('div', {class: 'muted'}, card_set.cards.length + ' cards'),
    el('div', {class: 'button-row'}, el('a', {class: 'button primary', href: '#/study/' + card_set.id}, 'Study'),
      el('label', {class: 'toggle-line'}, 'Show first:', front_select_el),
      el('label', {class: 'toggle-line'}, el('input', {type: 'checkbox', checked: app_state.shuffle, onchange: change_event => { app_state.shuffle = change_event.target.checked; save_state(); }}), 'Shuffle')),
    card_table_el,
    el('div', {class: 'button-row'}, el('button', {onclick: () => download_json(safe_file_name(card_set.title), [card_set])}, 'Export set'),
      el('button', {onclick: () => { const copied_set = JSON.parse(JSON.stringify(card_set)); copied_set.id = new_id(); copied_set.title = card_set.title + ' (copy)'; app_state.sets.push(copied_set); save_state(); location.hash = '#/set/' + copied_set.id; }}, 'Duplicate'),
      el('button', {class: 'danger', onclick: () => { if (!confirm('Delete "' + card_set.title + '"? This cannot be undone.')) return; app_state.sets = app_state.sets.filter(other_set => other_set.id !== card_set.id); save_state(); location.hash = '#/'; }}, 'Delete set'))
  ]);
}

function view_edit(card_set) {
  const draft_cards = card_set.cards.map(card_item => ({term: card_item.term, definition: card_item.definition}));
  const title_input_el = el('input', {type: 'text', class: 'title-input', value: card_set.title, placeholder: 'Set title'});
  const rows_el = el('div', {class: 'card-table'});
  function draw_rows() {
    rows_el.replaceChildren();
    draft_cards.forEach((draft_card, card_index) => rows_el.appendChild(el('div', {class: 'edit-row'},
      el('textarea', {rows: 1, placeholder: 'Term', oninput: input_event => { draft_card.term = input_event.target.value; }}, draft_card.term),
      el('textarea', {rows: 1, placeholder: 'Definition', oninput: input_event => { draft_card.definition = input_event.target.value; }}, draft_card.definition),
      el('button', {title: 'Remove card', onclick: () => { draft_cards.splice(card_index, 1); draw_rows(); }}, '✕'))));
  }
  function add_card() { draft_cards.push({term: '', definition: ''}); draw_rows(); const textarea_els = rows_el.querySelectorAll('textarea'); textarea_els[textarea_els.length - 2].focus(); }
  function bulk_add() {
    const pasted_text = prompt('Paste one card per line: term, then a Tab (or " - "), then definition.'); if (!pasted_text) return;
    pasted_text.split(/\r?\n/).forEach(pasted_line => { const split_parts = pasted_line.includes('\t') ? pasted_line.split('\t') : pasted_line.split(' - '); if (split_parts[0].trim()) draft_cards.push({term: split_parts[0].trim(), definition: split_parts.slice(1).join(' - ').trim()}); });
    draw_rows();
  }
  function save_edits() { card_set.title = title_input_el.value.trim() || 'Untitled set'; card_set.cards = draft_cards.filter(draft_card => draft_card.term.trim() || draft_card.definition.trim()); save_state(); location.hash = '#/set/' + card_set.id; }
  draw_rows();
  render([el('a', {class: 'button', href: '#/set/' + card_set.id}, 'Cancel'), el('button', {class: 'primary', onclick: save_edits}, 'Save')], [
    title_input_el, rows_el,
    el('div', {class: 'button-row'}, el('button', {onclick: add_card}, '+ Add card'), el('button', {onclick: bulk_add}, 'Paste list'),
      el('button', {onclick: () => { draft_cards.forEach(draft_card => { const swapped_term = draft_card.term; draft_card.term = draft_card.definition; draft_card.definition = swapped_term; }); draw_rows(); }}, 'Swap all sides'))
  ]);
}

// ---- Study ----
function shuffled(source_items) { const result_items = source_items.slice(); for (let swap_index = result_items.length - 1; swap_index > 0; swap_index--) { const random_index = Math.floor(Math.random() * (swap_index + 1)), held_item = result_items[swap_index]; result_items[swap_index] = result_items[random_index]; result_items[random_index] = held_item; } return result_items; }
function start_session(card_set, card_indexes) { study_session = {set_id: card_set.id, queue: app_state.shuffle ? shuffled(card_indexes) : card_indexes.slice(), position: 0, known: [], learning: []}; }

function view_study(card_set) {
  if (!card_set.cards.length) { location.hash = '#/edit/' + card_set.id; return; }
  if (!study_session || study_session.set_id !== card_set.id) start_session(card_set, card_set.cards.map((card_item, card_index) => card_index));
  if (study_session.position >= study_session.queue.length) return view_study_summary(card_set);
  const front_key = set_front(card_set), back_key = front_key === 'term' ? 'definition' : 'term', current_card = card_set.cards[study_session.queue[study_session.position]];
  const learn_hint_el = el('div', {class: 'swipe-hint learn'}, 'STILL LEARNING'), know_hint_el = el('div', {class: 'swipe-hint know'}, 'KNOW');
  const inner_el = el('div', {class: 'flashcard-inner'}, el('div', {class: 'face front'}, current_card[front_key]), el('div', {class: 'face back'}, current_card[back_key]));
  const card_el = el('div', {class: 'flashcard'}, learn_hint_el, know_hint_el, inner_el);
  function answer(is_known) { (is_known ? study_session.known : study_session.learning).push(study_session.queue[study_session.position]); study_session.position++; view_study(card_set); }
  // Tap flips; horizontal swipe answers (right = know, left = still learning).
  let drag_start = null;
  card_el.addEventListener('pointerdown', pointer_event => { drag_start = {x: pointer_event.clientX, y: pointer_event.clientY}; card_el.setPointerCapture(pointer_event.pointerId); inner_el.style.transition = 'none'; });
  card_el.addEventListener('pointermove', pointer_event => { if (!drag_start) return; const drag_x = pointer_event.clientX - drag_start.x; inner_el.style.transform = 'translateX(' + drag_x + 'px) rotate(' + drag_x / 25 + 'deg)' + (card_el.classList.contains('flipped') ? ' rotateY(180deg)' : ''); know_hint_el.style.opacity = Math.max(0, Math.min(1, drag_x / 100)); learn_hint_el.style.opacity = Math.max(0, Math.min(1, -drag_x / 100)); });
  card_el.addEventListener('pointerup', pointer_event => {
    if (!drag_start) return; const drag_x = pointer_event.clientX - drag_start.x, drag_y = pointer_event.clientY - drag_start.y; drag_start = null;
    inner_el.style.transition = ''; inner_el.style.transform = ''; know_hint_el.style.opacity = 0; learn_hint_el.style.opacity = 0;
    if (Math.abs(drag_x) > 90) answer(drag_x > 0); else if (Math.hypot(drag_x, drag_y) < 10) card_el.classList.toggle('flipped');
  });
  card_el.addEventListener('pointercancel', () => { drag_start = null; inner_el.style.transition = ''; inner_el.style.transform = ''; });
  const done_count = study_session.position, total_count = study_session.queue.length;
  render([el('a', {class: 'button', href: '#/set/' + card_set.id}, 'Done')], [el('div', {class: 'study-wrap'},
    el('div', {class: 'muted'}, card_set.title + ' · ' + (done_count + 1) + ' / ' + total_count),
    el('div', {class: 'progress'}, el('div', {style: 'width:' + (100 * done_count / total_count) + '%'})),
    el('div', {class: 'counts'}, el('span', {class: 'learn'}, study_session.learning.length + ' learning'), el('span', {class: 'know'}, study_session.known.length + ' known')),
    card_el,
    el('div', {class: 'study-buttons'}, el('button', {onclick: () => answer(false)}, '← Still learning'), el('button', {onclick: () => card_el.classList.toggle('flipped')}, 'Flip'), el('button', {onclick: () => answer(true)}, 'Know →')),
    el('div', {class: 'muted'}, 'Tap to flip · swipe right if you know it, left if not · keys: space, ← →'))]);
}

function view_study_summary(card_set) {
  const learning_indexes = study_session.learning.slice();
  render([el('a', {class: 'button', href: '#/set/' + card_set.id}, 'Done')], [el('div', {class: 'study-wrap empty'},
    el('h1', {}, learning_indexes.length ? 'Round complete' : 'All known!'),
    el('div', {class: 'counts'}, el('span', {class: 'learn'}, learning_indexes.length + ' still learning'), el('span', {class: 'know'}, study_session.known.length + ' known')),
    el('div', {class: 'button-row'},
      learning_indexes.length ? el('button', {class: 'primary', onclick: () => { start_session(card_set, learning_indexes); view_study(card_set); }}, 'Study the ' + learning_indexes.length + ' again') : null,
      el('button', {onclick: () => { start_session(card_set, card_set.cards.map((card_item, card_index) => card_index)); view_study(card_set); }}, 'Restart all')))]);
}

document.addEventListener('keydown', key_event => {
  if (!location.hash.startsWith('#/study/') || key_event.target.tagName === 'INPUT' || key_event.target.tagName === 'TEXTAREA') return;
  const card_el = view_el.querySelector('.flashcard'); if (!card_el) return;
  const study_buttons = view_el.querySelectorAll('.study-buttons button');
  if (key_event.key === ' ' || key_event.key === 'ArrowUp' || key_event.key === 'ArrowDown') { key_event.preventDefault(); card_el.classList.toggle('flipped'); }
  else if (key_event.key === 'ArrowLeft') study_buttons[0].click(); else if (key_event.key === 'ArrowRight') study_buttons[2].click();
});

// ---- Routing: #/ , #/set/<id>, #/edit/<id>, #/study/<id> ----
function route() {
  const route_parts = location.hash.replace(/^#\/?/, '').split('/'), route_name = route_parts[0], route_set = find_set(decodeURIComponent(route_parts[1] || ''));
  if (route_name !== 'study') study_session = null;
  if (route_name === 'set' && route_set) view_set(route_set);
  else if (route_name === 'edit' && route_set) view_edit(route_set);
  else if (route_name === 'study' && route_set) view_study(route_set);
  else view_library();
}
window.addEventListener('hashchange', route);
route();
seed_demo_sets();
