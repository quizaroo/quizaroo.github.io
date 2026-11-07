// Quizaroo: browser-only. Data lives in localStorage; import/export uses the open JSON format described in README.md.
const STORAGE_KEY = 'open-flashcards:v1', THEME_KEY = 'open-flashcards:theme', STYLE_KEY = 'open-flashcards:style', view_button_el = document.getElementById('view-button'), DEMO_VERSION = 2, view_el = document.getElementById('view'), topbar_actions_el = document.getElementById('topbar-actions'), page_title_el = document.getElementById('page-title'), import_input_el = document.getElementById('import-file');
// The same twelve soft hues as Sift. A set keeps the colour it was given (`colour`); until then its colour comes from its id, so it never changes.
const TINTS = [['rose', '#ff9aa2'], ['coral', '#ffab91'], ['peach', '#ffc285'], ['butter', '#ffe27a'], ['lime', '#d4ef8a'], ['mint', '#9be7a8'], ['teal', '#86e3d0'], ['sky', '#8fd3ff'], ['periwinkle', '#a8b8ff'], ['lavender', '#c3a6ff'], ['orchid', '#f4a6e0'], ['sand', '#e3c9a8']];
let app_state = load_state(), study_session = null, editor_has_changes = null, skip_next_route = false, last_list_hash = '#/';

function load_state() {
  try { const stored_state = JSON.parse(localStorage.getItem(STORAGE_KEY)); if (stored_state && Array.isArray(stored_state.sets)) { stored_state.sets = stored_state.sets.filter(card_set => card_set && card_set.id && Array.isArray(card_set.cards)); return stored_state; } } catch (storage_err) {}
  return {sets: [], shuffle: true, demo_version: DEMO_VERSION, seen_version: APP_VERSION};
}
function save_state() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(app_state)); } catch (storage_err) { alert('Could not save: browser storage is full or blocked.'); } sync_engine.note_change(); }
function new_id() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function find_set(set_id) { return app_state.sets.find(card_set => card_set.id === set_id); }

// Tiny DOM builder: el('div', {class: 'x', onclick: fn}, child, 'text', ...)
function el(tag_name, attributes) {
  const node_el = document.createElement(tag_name);
  Object.keys(attributes || {}).forEach(attr_name => { const attr_value = attributes[attr_name]; if (attr_name.startsWith('on')) node_el.addEventListener(attr_name.slice(2), attr_value); else if (attr_name === 'value') node_el.value = attr_value; else if (attr_name === 'checked') node_el.checked = attr_value; else node_el.setAttribute(attr_name, attr_value); });
  for (let child_index = 2; child_index < arguments.length; child_index++) { const child_item = arguments[child_index]; if (child_item === null || child_item === undefined || child_item === false) continue; node_el.appendChild(typeof child_item === 'string' || typeof child_item === 'number' ? document.createTextNode(String(child_item)) : child_item); }
  return node_el;
}
// Breadcrumbs: the top title always starts from the left menu's item, with its icon. Each step but the last links back.
function menu_crumb(nav_name, hash_text) { return {label: document.querySelector('.nav-item[data-nav="' + nav_name + '"]').textContent.trim(), hash: hash_text, nav_name}; }
function library_trail(...later_crumbs) { return [menu_crumb('library', '#/library')].concat(later_crumbs); }
function set_trail(card_set, ...page_labels) { return library_trail(page_labels.length ? {label: card_set.title, hash: '#/set/' + card_set.id} : {label: card_set.title}, ...page_labels.map(page_label => ({label: page_label}))); }
function draw_breadcrumbs(trail) {
  page_title_el.replaceChildren();
  trail.forEach((crumb_item, crumb_index) => {
    const is_last = crumb_index === trail.length - 1, crumb_el = is_last ? el('span', {class: 'crumb is-current', title: crumb_item.label}) : el('a', {class: 'crumb', href: crumb_item.hash, title: crumb_item.label});
    if (crumb_item.nav_name) crumb_el.appendChild(document.querySelector('.nav-item[data-nav="' + crumb_item.nav_name + '"] svg').cloneNode(true));
    crumb_el.appendChild(el('span', {class: 'crumb-label'}, crumb_item.label));
    page_title_el.appendChild(crumb_el);
    if (!is_last) page_title_el.appendChild(el('span', {class: 'crumb-arrow', 'aria-hidden': 'true'}, '›'));
  });
}
function render(page_trail, topbar_buttons, content_nodes) { draw_breadcrumbs(page_trail); topbar_actions_el.replaceChildren(); topbar_buttons.forEach(button_el => topbar_actions_el.appendChild(button_el)); view_el.replaceChildren(); content_nodes.filter(Boolean).forEach(content_node => view_el.appendChild(content_node)); window.scrollTo(0, 0); }
function plus_button() { const link_el = el('a', {class: 'button primary icon-button', href: '#/new', title: 'New set', 'aria-label': 'New set'}); link_el.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>'; return link_el; }
function tint_of(card_set) { const given_tint = TINTS.find(tint_item => tint_item[0] === card_set.colour); if (given_tint) return given_tint[1]; let hash_value = 5381; for (const id_char of String(card_set.id)) hash_value = ((hash_value << 5) + hash_value + id_char.charCodeAt(0)) >>> 0; return TINTS[hash_value % TINTS.length][1]; }
function tint_style(card_set) { return '--tint:' + tint_of(card_set); }
// A card needs both sides to be studied.
function studyable_indexes(card_set) { return card_set.cards.map((card_item, card_index) => card_index).filter(card_index => card_set.cards[card_index].term.trim() && card_set.cards[card_index].definition.trim()); }

// ---- Dates ----
function format_date(date_text) { const date_parts = date_text.split('-').map(Number); return new Date(date_parts[0], date_parts[1] - 1, date_parts[2]).toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric'}); }
function today_text() { const now_date = new Date(); return now_date.getFullYear() + '-' + String(now_date.getMonth() + 1).padStart(2, '0') + '-' + String(now_date.getDate()).padStart(2, '0'); }
function relative_day(time_ms) {
  const start_of_day = moment_ms => new Date(moment_ms).setHours(0, 0, 0, 0), days_ago = Math.round((start_of_day(Date.now()) - start_of_day(time_ms)) / 86400000);
  if (days_ago <= 0) return 'today'; if (days_ago === 1) return 'yesterday'; if (days_ago < 14) return days_ago + ' days ago';
  return new Date(time_ms).toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric'});
}
function date_chips(card_set) {
  return el('span', {class: 'date-chips'},
    card_set.created ? el('span', {class: 'date-chip'}, 'Created', el('b', {}, format_date(card_set.created))) : null,
    card_set.last_studied ? el('span', {class: 'date-chip'}, 'Last studied', el('b', {}, relative_day(card_set.last_studied))) : null,
    card_set.active_ms >= 1000 ? el('span', {class: 'date-chip'}, active_fire(card_set.active_ms), el('b', {}, active_time_text(card_set.active_ms))) : null,
    (card_set.trophies || []).length ? el('span', {class: 'date-chip'}, 'Trophies', el('b', {}, card_set.trophies.length)) : null);
}

// ---- Import / export ----
function normalise_set(raw_set) {
  if (!raw_set || !Array.isArray(raw_set.cards)) return null;
  return {id: String(raw_set.id || new_id()), title: String(raw_set.title || 'Untitled set'), cards: raw_set.cards.filter(raw_card => raw_card && (raw_card.term || raw_card.definition)).map(raw_card => ({term: String(raw_card.term || ''), definition: String(raw_card.definition || '')})), front: raw_set.front === 'definition' || raw_set.front === 'mixed' ? raw_set.front : undefined, description: raw_set.description ? String(raw_set.description) : undefined, created: /^\d{4}-\d{2}-\d{2}$/.test(raw_set.created) ? raw_set.created : undefined, colour: TINTS.some(tint_item => tint_item[0] === raw_set.colour) ? raw_set.colour : undefined, last_studied: Number(raw_set.last_studied) || undefined, last_opened: Number(raw_set.last_opened) || undefined, trophies: Array.isArray(raw_set.trophies) ? raw_set.trophies.filter(trophy_item => trophy_item && /^[a-z-]+$/.test(trophy_item.image) && typeof trophy_item.line === 'string').map(trophy_item => ({image: trophy_item.image, line: trophy_item.line, goal: trophy_item.goal ? String(trophy_item.goal) : undefined, mode: String(trophy_item.mode || ''), right: Number(trophy_item.right) || 0, total: Number(trophy_item.total) || 0, at: Number(trophy_item.at) || Date.now()})) : undefined, progress: raw_set.progress && typeof raw_set.progress === 'object' ? raw_set.progress : undefined, best_speed: Number(raw_set.best_speed) || undefined, learn_stages: raw_set.learn_stages && typeof raw_set.learn_stages === 'object' ? raw_set.learn_stages : undefined, active_ms: Number(raw_set.active_ms) || undefined, card_ratings: raw_set.card_ratings && typeof raw_set.card_ratings === 'object' ? raw_set.card_ratings : undefined, tricky: raw_set.tricky && typeof raw_set.tricky === 'object' ? raw_set.tricky : undefined, daily_stats: raw_set.daily_stats && typeof raw_set.daily_stats === 'object' ? raw_set.daily_stats : undefined};
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
    if (conflict.choice === 'merge') { conflict.comparison.changed_cards.forEach(changed_card => { if (changed_card.use_imported) changed_card.your_card.definition = changed_card.imported_card.definition; }); conflict.your_set.cards.push(...conflict.comparison.new_cards); conflict.your_set.description = conflict.your_set.description || conflict.imported_set.description; conflict.your_set.created = conflict.your_set.created || conflict.imported_set.created; }
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
function seed_demo_sets() { if (is_first_run()) sync_engine.ready.then(() => (is_first_run() && !sync_engine.signed_in() ? fetch_demo_sets() : null)).then(demo_sets => { if (!demo_sets || !is_first_run()) return; app_state.sets = demo_sets; save_state(); route(); }).catch(() => {}); }
// Adds only the demo sets that are missing, so an edited copy is never replaced.
function add_missing_demo_sets() { fetch_demo_sets().then(demo_sets => { const missing_sets = demo_sets.filter(demo_set => !find_set(demo_set.id)); app_state.sets.push(...missing_sets); save_state(); alert('Added ' + missing_sets.length + ' demo set(s).'); route(); }).catch(() => alert('Could not load the demo sets.')); }

// Browsers seeded before demo sets had descriptions and dates catch up once. A set whose title was changed is left alone.
function upgrade_demo_sets() {
  if (app_state.demo_version === DEMO_VERSION || is_first_run()) return;
  fetch('demo-sets.json').then(demo_response => demo_response.json()).then(demo_json => {
    demo_json.sets.forEach(demo_set => { const your_set = find_set(demo_set.id); if (!your_set || your_set.title !== demo_set.old_title) return; your_set.title = demo_set.title; your_set.description = your_set.description || demo_set.description; your_set.created = your_set.created || demo_set.created; });
    app_state.demo_version = DEMO_VERSION; save_state(); if (!editor_has_changes) route();
  }).catch(() => {});
}

// ---- Views ----
function study_pill(card_set) { if (!studyable_indexes(card_set).length) return null; const next_item = next_step(card_set); return el('a', {class: 'button study-pill', href: play_hash(card_set, next_item.mode)}, next_item.label); }
// Every mode's progress on a set: cards known, Learn from scratch, the speed record, last studied. Trophies stay, once won.
function reset_set_progress(card_set) { delete card_set.progress; card_set.learn_stages = {}; card_set.card_ratings = {}; card_set.tricky = {}; delete card_set.active_ms; delete card_set.best_speed; delete card_set.last_studied; }
function reset_with_undo(chosen_sets) {
  const saved_progress = chosen_sets.map(card_set => ({card_set, progress: card_set.progress, learn_stages: card_set.learn_stages, card_ratings: card_set.card_ratings, tricky: card_set.tricky, active_ms: card_set.active_ms, best_speed: card_set.best_speed, last_studied: card_set.last_studied}));
  chosen_sets.forEach(reset_set_progress); save_state(); route();
  toast('Progress reset on ' + chosen_sets.length + (chosen_sets.length === 1 ? ' set' : ' sets'), {action: 'Undo', ms: 8000, on_action: () => { saved_progress.forEach(saved_item => { ['progress', 'learn_stages', 'card_ratings', 'tricky', 'active_ms', 'best_speed', 'last_studied'].forEach(field_name => { if (saved_item[field_name] === undefined) delete saved_item.card_set[field_name]; else saved_item.card_set[field_name] = saved_item[field_name]; }); }); save_state(); route(); }});
}
function set_row(card_set) {
  return el('div', {class: 'set-row', style: tint_style(card_set)},
    el('div', {class: 'line-margin'}, el('span', {class: 'count-chip', title: card_set.cards.length + ' cards'}, card_set.cards.length)),
    el('div', {class: 'row-body'}, el('a', {class: 'row-title', href: '#/set/' + card_set.id}, card_set.title), card_set.description ? el('span', {class: 'row-description'}, card_set.description) : null, date_chips(card_set), progress_meter(card_set)),
    study_pill(card_set));
}
function set_tile(card_set) {
  return el('div', {class: 'tile', style: tint_style(card_set)},
    el('div', {class: 'tile-band'}, el('a', {class: 'row-title', href: '#/set/' + card_set.id}, card_set.title)),
    el('div', {class: 'tile-lines'}, card_set.description ? el('span', {class: 'row-description'}, card_set.description) : null, progress_meter(card_set),
      el('div', {class: 'tile-foot'}, el('span', {class: 'date-chips'}, el('span', {class: 'date-chip'}, el('b', {}, card_set.cards.length), 'cards'), ...date_chips(card_set).childNodes), study_pill(card_set))));
}
function view_home() {
  const WEEK_MS = 7 * 86400000, shown_ids = new Set(), cards_total = app_state.sets.reduce((card_total, card_set) => card_total + card_set.cards.length, 0), studied_this_week = app_state.sets.filter(card_set => card_set.last_studied > Date.now() - WEEK_MS).length;
  function top_sets(sort_value) { const top_list = app_state.sets.filter(card_set => sort_value(card_set) && !shown_ids.has(card_set.id)).sort((set_a, set_b) => String(sort_value(set_b)).localeCompare(String(sort_value(set_a)), undefined, {numeric: true})).slice(0, 4); top_list.forEach(card_set => shown_ids.add(card_set.id)); return top_list; }
  function home_section(heading_text, card_sets) { return card_sets.length ? el('section', {class: 'home-section'}, el('h2', {}, heading_text), el('div', {class: 'tile-grid'}, ...card_sets.map(set_tile))) : null; }
  const due_sets = top_sets(card_set => due_indexes(card_set).length), studied_sets = top_sets(card_set => card_set.last_studied), opened_sets = top_sets(card_set => card_set.last_opened), newest_sets = top_sets(card_set => card_set.created);
  render([menu_crumb('home', '#/')], [plus_button()], app_state.sets.length ? [
    el('div', {class: 'stat-strip'},
      el('div', {class: 'stat', style: 'background:#8fd3ff'}, el('strong', {}, app_state.sets.length), 'sets'),
      el('div', {class: 'stat', style: 'background:#ffe27a'}, el('strong', {}, cards_total), 'cards'),
      el('div', {class: 'stat', style: 'background:#9be7a8'}, el('strong', {}, studied_this_week), 'studied this week')),
    home_section('Ready to revise', due_sets), home_section('Recently studied', studied_sets), home_section('Recently opened', opened_sets), home_section('Newest sets', newest_sets),
    el('p', {class: 'empty-note'}, 'See everything in ', el('a', {href: '#/library'}, 'Your Library'), '.')
  ].filter(Boolean) : [el('p', {class: 'empty-note'}, 'No sets yet. Press + to make your first one, or import a file in ', el('a', {href: '#/library'}, 'Your Library'), '.')]);
}
function view_library() {
  const sort_rules = {name: (set_a, set_b) => set_a.title.localeCompare(set_b.title), newest: (set_a, set_b) => (set_b.created || '').localeCompare(set_a.created || '') || set_a.title.localeCompare(set_b.title), studied: (set_a, set_b) => (set_b.last_studied || 0) - (set_a.last_studied || 0) || set_a.title.localeCompare(set_b.title)};
  // Custom: the order you dragged them into, kept when you sort another way. A set made since goes at the top.
  const custom_places = new Map((app_state.library_custom_order || []).map((set_id, set_place) => [set_id, set_place]));
  sort_rules.custom = (set_a, set_b) => (custom_places.has(set_a.id) ? custom_places.get(set_a.id) : -1) - (custom_places.has(set_b.id) ? custom_places.get(set_b.id) : -1) || sort_rules.newest(set_a, set_b);
  const library_sort = sort_rules[app_state.library_order] ? app_state.library_order : 'newest', sorted_sets = app_state.sets.slice().sort(sort_rules[library_sort]);
  const sort_select_el = el('select', {onchange: change_event => { app_state.library_order = change_event.target.value; save_state(); view_library(); }}, el('option', {value: 'newest'}, 'Newest'), el('option', {value: 'name'}, 'Name'), el('option', {value: 'studied'}, 'Last studied'), el('option', {value: 'custom'}, 'Custom'));
  sort_select_el.value = library_sort;
  function menu_item(item_label, run_item) { return el('button', {class: 'menu-item', onclick: () => { close_view_menu(); run_item(); }}, item_label); }
  const more_button_el = el('button', {id: 'more-button', class: 'icon-button', title: 'More', 'aria-label': 'More', 'aria-expanded': 'false', onclick: () => toggle_top_menu(more_button_el, 'More', menu_item('Import', () => import_input_el.click()), menu_item('Export all', () => download_json('open-flashcards-all.json', app_state.sets)), menu_item('Load demo sets', add_missing_demo_sets))}, '⋯');
  render(library_trail(), [more_button_el, plus_button()], [
    el('div', {class: 'button-row'}, el('label', {class: 'toggle-line'}, 'Sort by', sort_select_el)),
    sorted_sets.length ? el('div', {class: 'muted library-hint'}, 'Press and hold a set to move it, or let go to select it.') : '',
    sorted_sets.length ? el('div', {class: 'ruled set-rows'}, ...sorted_sets.map(card_set => { const row_el = set_row(card_set); row_el.list_item = card_set; return row_el; })) : el('p', {class: 'empty muted'}, 'No sets yet. Press + to make one, or import a .json file.')
  ]);
  const rows_el = view_el.querySelector('.set-rows');
  if (!rows_el) return;
  const set_selection = selectable_list(rows_el, {item_selector: '.set-row', skip_selector: '.study-pill', noun: 'set',
    on_reorder: () => { app_state.library_custom_order = Array.from(rows_el.children).map(row_el => row_el.list_item.id); app_state.library_order = 'custom'; save_state(); sort_select_el.value = 'custom'; },
    on_delete: chosen_sets => { const kept_before = app_state.sets.slice(); app_state.sets = app_state.sets.filter(card_set => !chosen_sets.includes(card_set)); save_state(); view_library(); return () => { app_state.sets = kept_before; save_state(); view_library(); }; },
    extra_buttons: chosen_sets => [el('button', {title: 'Reset all progress', onclick: () => reset_with_undo(chosen_sets)}, '↺ Reset')]});
  set_selection.paint();
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
  render(library_trail({label: 'Resolve import'}), [el('button', {onclick: route}, 'Cancel'), el('button', {class: 'primary', onclick: () => apply_import(new_sets, conflicts, identical_count)}, 'Finish import')], [
    el('div', {class: 'muted'}, conflicts.length + ' set(s) already exist with different cards. Merge keeps your cards and adds the new ones. Nothing is saved until you finish.'),
    new_sets.length || identical_count ? el('div', {class: 'muted'}, new_sets.length + ' new set(s) will be added, ' + identical_count + ' already up to date.') : null,
    apply_all_el, el('div', {class: 'conflict-list'}, ...conflict_panels)
  ]);
}

function view_set(card_set) {
  const studyable_count = studyable_indexes(card_set).length, skipped_count = card_set.cards.length - studyable_count, counts = progress_counts(card_set), due_count = due_indexes(card_set).length;
  const learn_now = learn_counts(card_set);
  function mode_tile(mode_item) {
    const is_open = studyable_count >= mode_item.min_cards, art_el = el('span', {class: 'mode-art', 'aria-hidden': 'true'});
    art_el.innerHTML = '<svg viewBox="0 0 64 64">' + mode_item.art + '</svg>';
    const tile_nodes = [art_el, el('span', {class: 'mode-text'}, el('strong', {}, mode_item.label + (mode_item.key === 'revise' && due_count ? ' (' + due_count + ')' : '')), el('span', {class: 'mode-blurb'}, is_open ? mode_item.blurb : 'Add ' + (mode_item.min_cards > 1 ? 'at least ' + mode_item.min_cards + ' cards' : 'a card') + ' with both a term and a definition to use this.'), mode_item.key === 'learn' && learn_now.done_steps ? el('span', {class: 'mode-progress'}, el('span', {class: 'meter'}, el('span', {class: 'meter-mastered', style: 'display:block;height:100%;width:' + 100 * learn_now.done_steps / learn_now.total_steps + '%'})), learn_now.learned + ' of ' + learn_now.cards + ' cards learned') : null)];
    return is_open ? el('a', {class: 'mode-tile', style: '--tint:' + mode_item.tint, href: play_hash(card_set, mode_item.key), draggable: 'false', 'data-mode': mode_item.key}, ...tile_nodes) : el('span', {class: 'mode-tile is-off', style: '--tint:' + mode_item.tint, 'data-mode': mode_item.key}, ...tile_nodes);
  }
  function mode_group(group_name) { return el('div', {class: 'mode-group'}, el('h2', {class: 'list-heading'}, group_name), el('div', {class: 'mode-tiles', 'data-group': group_name}, ...modes_in_group(group_name).map(mode_tile))); }
  render(set_trail(card_set), [el('a', {class: 'button', href: '#/edit/' + card_set.id}, 'Edit')], [
    el('div', {class: 'set-hero', style: tint_style(card_set)},
      el('h2', {class: 'hero-tape'}, card_set.title),
      card_set.created || card_set.last_studied ? el('p', {class: 'hero-dates'}, [card_set.created ? 'Created ' + format_date(card_set.created) : '', card_set.last_studied ? 'Last studied ' + relative_day(card_set.last_studied) : ''].filter(Boolean).join(' · ')) : null,
      card_set.active_ms >= 1000 ? el('p', {class: 'hero-active'}, active_fire(card_set.active_ms) + ' ', el('b', {}, active_time_text(card_set.active_ms)), ' of active learning') : null,
      el('div', {class: 'hero-main'}, el('div', {class: 'hero-count'}, el('strong', {}, card_set.cards.length), card_set.cards.length === 1 ? 'card' : 'cards'), card_set.description ? el('p', {class: 'hero-description'}, card_set.description) : null),
      studyable_count ? el('div', {class: 'hero-progress'}, progress_meter(card_set), el('div', {class: 'form-note'}, counts.mastered + ' mastered · ' + counts.familiar + ' familiar · ' + counts.learning + ' learning · ' + counts.new + ' new', due_count ? el('b', {}, ' · ' + due_count + ' due now') : null)) : null,
      tricky_indexes(card_set).length ? el('a', {class: 'tricky-link', href: play_hash(card_set, 'tricky'), title: 'Words you said you always remember, then got wrong'}, 'Practise ' + tricky_indexes(card_set).length + ' tricky ' + (tricky_indexes(card_set).length === 1 ? 'word' : 'words') + ' →') : null,
      !studyable_count ? el('div', {class: 'form-note'}, 'Add at least one card with a term and a definition to start learning.') : skipped_count ? el('div', {class: 'form-note'}, skipped_count + ' card(s) are missing a side and are left out.') : null),
    trophy_shelf(card_set), el('div', {class: 'mode-areas'}, mode_group('Learn'), mode_group('Practise'), mode_group('Games')), el('div', {class: 'muted mode-hint'}, 'Press and hold a tile to move it. ', el('button', {class: 'link-button', onclick: () => { app_state.mode_layout = {}; save_state(); view_set(card_set); }}, 'Reset')),
    el('div', {class: 'button-row set-actions'}, el('button', {onclick: () => reset_with_undo([card_set])}, '↺ Reset progress'),
      el('button', {onclick: () => download_json(safe_file_name(card_set.title), [card_set])}, 'Export set'),
      el('button', {onclick: () => { const copied_set = JSON.parse(JSON.stringify(card_set)); copied_set.id = new_id(); copied_set.title = card_set.title + ' (copy)'; delete copied_set.last_studied; delete copied_set.last_opened; delete copied_set.progress; delete copied_set.learn_stages; delete copied_set.card_ratings; delete copied_set.tricky; delete copied_set.active_ms; delete copied_set.best_speed; delete copied_set.trophies; app_state.sets.push(copied_set); save_state(); location.hash = '#/set/' + copied_set.id; }}, 'Duplicate'),
      el('button', {class: 'danger', onclick: () => { const kept_before = app_state.sets.slice(); app_state.sets = app_state.sets.filter(other_set => other_set.id !== card_set.id); save_state(); location.hash = '#/library'; toast('"' + card_set.title + '" deleted', {action: 'Undo', ms: 8000, on_action: () => { app_state.sets = kept_before; save_state(); route(); }}); }}, 'Delete set'))
  ]);
  press_and_drag(view_el.querySelector('.mode-areas'), {item_selector: '.mode-tile', same_parent: true, on_drop: () => { const saved_layout = {}; view_el.querySelectorAll('.mode-tiles').forEach(group_el => { saved_layout[group_el.dataset.group] = Array.from(group_el.querySelectorAll('.mode-tile')).map(tile_el => tile_el.dataset.mode); }); app_state.mode_layout = saved_layout; save_state(); }});
}

// There is always a blank row at the end, so Tab moves term, definition, next term, next definition without stopping. Date and colour are skipped by Tab, so About goes straight to the first term.
function view_edit(card_set, is_new) {
  const draft_cards = card_set.cards.map(card_item => ({term: card_item.term, definition: card_item.definition}));
  const title_input_el = el('input', {type: 'text', class: 'line-field title-field', value: card_set.title, placeholder: 'Set name', 'aria-label': 'Set name'});
  const description_input_el = el('textarea', {rows: 1, class: 'line-field', placeholder: 'What is this set about? (optional)', 'aria-label': 'Description', oninput: input_event => fit_height(input_event.target)}, card_set.description || '');
  const created_input_el = el('input', {type: 'date', class: 'line-field detail-field', value: card_set.created || (is_new ? today_text() : ''), 'aria-label': 'Created date', tabindex: -1});
  let picked_colour = card_set.colour;
  const colour_pick_el = el('div', {class: 'swatches', role: 'radiogroup', 'aria-label': 'Colour'}, ...TINTS.map(tint_item => el('input', {type: 'radio', name: 'set-colour', style: '--tint:' + tint_item[1], title: tint_item[0], 'aria-label': tint_item[0], tabindex: -1, checked: tint_of(card_set) === tint_item[1], onchange: () => { picked_colour = tint_item[0]; }})));
  const rows_el = el('div', {class: 'ruled'}), error_el = el('div', {class: 'form-error', role: 'alert'}, 'Add at least one card before saving.');
  error_el.hidden = true;
  function is_blank(draft_card) { return !draft_card.term.trim() && !draft_card.definition.trim(); }
  function fit_height(textarea_el) { if (!textarea_el.isConnected) return; textarea_el.style.height = 'auto'; textarea_el.style.height = textarea_el.scrollHeight + 2 + 'px'; }
  function card_input(draft_card, side_key, side_label, row_el) { return el('textarea', {rows: 1, class: 'line-field', placeholder: side_label, 'aria-label': side_label, onfocus: focus_event => fit_height(focus_event.target), oninput: input_event => { draft_card[side_key] = input_event.target.value; fit_height(input_event.target); row_el.classList.toggle('blank-row', is_blank(draft_card)); add_blank_row(); error_el.hidden = true; }}, draft_card[side_key]); }
  function make_row(draft_card) {
    const row_el = el('div', {class: 'edit-row' + (is_blank(draft_card) ? ' blank-row' : '')}, el('div', {class: 'line-margin line-number'})); row_el.list_item = draft_card;
    row_el.append(card_input(draft_card, 'term', 'Term', row_el), card_input(draft_card, 'definition', 'Definition', row_el), el('button', {class: 'remove-card', title: 'Remove card', 'aria-label': 'Remove card', tabindex: -1, onclick: () => { draft_cards.splice(draft_cards.indexOf(draft_card), 1); row_el.remove(); add_blank_row(); card_selection.forget(draft_card); }}, '✕'));
    rows_el.appendChild(row_el); row_el.querySelectorAll('textarea').forEach(fit_height);
  }
  const card_selection = selectable_list(rows_el, {item_selector: '.edit-row', fixed_selector: '.blank-row', skip_selector: '.remove-card', noun: 'card',
    on_reorder: () => draft_cards.splice(0, draft_cards.length, ...Array.from(rows_el.children).map(row_el => row_el.list_item)),
    on_delete: chosen_cards => { const kept_before = draft_cards.slice(); draft_cards.splice(0, draft_cards.length, ...draft_cards.filter(draft_card => !chosen_cards.includes(draft_card))); draw_rows(); return () => { draft_cards.splice(0, draft_cards.length, ...kept_before); draw_rows(); }; },
    on_paint: is_selecting => rows_el.querySelectorAll('textarea').forEach(textarea_el => { textarea_el.readOnly = is_selecting; })});
  function add_blank_row() { if (draft_cards.length && is_blank(draft_cards[draft_cards.length - 1])) return; const blank_card = {term: '', definition: ''}; draft_cards.push(blank_card); make_row(blank_card); }
  function draw_rows() { rows_el.replaceChildren(); draft_cards.forEach(make_row); add_blank_row(); card_selection.paint(); }
  function bulk_add() {
    const pasted_text = prompt('Paste one card per line: term, then a Tab (or " - "), then definition.'); if (!pasted_text) return;
    while (draft_cards.length && is_blank(draft_cards[draft_cards.length - 1])) draft_cards.pop();
    pasted_text.split(/\r?\n/).forEach(pasted_line => { const split_parts = pasted_line.includes('\t') ? pasted_line.split('\t') : pasted_line.split(' - '); if (split_parts[0].trim()) draft_cards.push({term: split_parts[0].trim(), definition: split_parts.slice(1).join(' - ').trim()}); });
    draw_rows();
  }
  function current_edits() { return JSON.stringify([title_input_el.value.trim(), description_input_el.value.trim(), created_input_el.value, picked_colour, draft_cards.filter(draft_card => !is_blank(draft_card))]); }
  function save_edits() {
    const kept_cards = draft_cards.filter(draft_card => !is_blank(draft_card));
    if (!kept_cards.length) { error_el.hidden = false; rows_el.querySelector('textarea').focus(); return; }
    card_set.title = title_input_el.value.trim() || 'Untitled set'; card_set.description = description_input_el.value.trim() || undefined; card_set.created = created_input_el.value || undefined; card_set.colour = picked_colour; card_set.cards = kept_cards;
    if (is_new) app_state.sets.push(card_set);
    save_state(); editor_has_changes = null; location.hash = '#/set/' + card_set.id;
  }
  draw_rows();
  const cancel_hash = is_new ? last_list_hash : '#/set/' + card_set.id;
  render(is_new ? library_trail({label: 'New set'}) : set_trail(card_set, 'Edit'), [el('a', {class: 'button', href: cancel_hash}, 'Cancel'), el('button', {class: 'primary', onclick: save_edits}, 'Save')], [
    el('div', {class: 'ruled'}, el('div', {class: 'detail-row'}, el('div', {class: 'line-margin'}, 'Name'), title_input_el), el('div', {class: 'detail-row'}, el('div', {class: 'line-margin'}, 'About'), description_input_el), el('div', {class: 'detail-row'}, el('div', {class: 'line-margin'}, 'Created'), created_input_el), el('div', {class: 'detail-row'}, el('div', {class: 'line-margin'}, 'Colour'), colour_pick_el)),
    el('h2', {class: 'edit-heading'}, 'Cards'), el('div', {class: 'muted'}, 'Press Tab to move from term to definition to the next term. A new row appears as you type. Press and hold a card to move it, or let go to select it.'),
    rows_el, error_el,
    el('div', {class: 'button-row'}, el('button', {class: 'primary', onclick: save_edits}, 'Save'), el('button', {onclick: bulk_add}, 'Paste list'),
      el('button', {onclick: () => { draft_cards.forEach(draft_card => { const swapped_term = draft_card.term; draft_card.term = draft_card.definition; draft_card.definition = swapped_term; }); draw_rows(); }}, 'Swap all sides'))
  ]);
  view_el.querySelectorAll('textarea').forEach(fit_height);
  const starting_edits = current_edits(); editor_has_changes = () => current_edits() !== starting_edits;
  if (is_new) title_input_el.focus();
}

// ---- Study ----
function shuffled(source_items) { const result_items = source_items.slice(); for (let swap_index = result_items.length - 1; swap_index > 0; swap_index--) { const random_index = Math.floor(Math.random() * (swap_index + 1)), held_item = result_items[swap_index]; result_items[swap_index] = result_items[random_index]; result_items[random_index] = held_item; } return result_items; }
function start_session(card_set, card_indexes, mode_key) { study_session = {set_id: card_set.id, mode: mode_key, queue: card_indexes.slice(), position: 0, known: [], learning: [], answer_history: []}; }
// Takes back the last answer in Flashcards or Revise, with what it did to the card's progress.
function take_back_answer(card_set) {
  const last_answer = study_session.answer_history.pop(); if (!last_answer) return;
  (last_answer.was_known ? study_session.known : study_session.learning).pop(); study_session.position = last_answer.position;
  restore_card_memory(card_set, last_answer.key_text, last_answer.memory); if (study_session.flip_log) study_session.flip_log.pop();
  if (last_answer.last_studied) card_set.last_studied = last_answer.last_studied; else delete card_set.last_studied;
}
function previous_card_button(card_set) { return el('button', Object.assign({'data-key': 'Backspace', title: 'Go back and change your answer (Backspace)', onclick: () => { if (study_session.round_reward) { card_set.trophies.length -= study_session.round_trophy_count; study_session.round_reward = null; } take_back_answer(card_set); save_state(); view_study(card_set); }}, study_session.answer_history.length ? {} : {disabled: 'disabled'}), '← Previous card'); }

// Flashcards keeps score unless switched off, or opened on a word from View all vocab. Without score, nothing is recorded, Back and Next go round for ever, and there is no end of round.
function start_flashcards(card_set, start_card, return_hash) {
  const studyable_list = studyable_indexes(card_set), is_browsing = start_card !== undefined || app_state.keep_score === false, card_order = start_card !== undefined || !app_state.shuffle ? studyable_list : is_browsing ? shuffled(studyable_list) : weakest_first(card_set, studyable_list);
  start_session(card_set, card_order, 'cards');
  study_session.browsing = is_browsing; study_session.return_hash = return_hash; study_session.position = Math.max(0, card_order.indexOf(start_card));
}
function view_study(card_set) {
  clear_mode_timers(); start_answer_clock();
  if (study_session.position >= study_session.queue.length) return view_study_summary(card_set);
  const current_index = study_session.queue[study_session.position], front_key = front_side(card_set, current_index), back_key = front_key === 'term' ? 'definition' : 'term', current_card = card_set.cards[current_index];
  const learn_hint_el = el('div', {class: 'swipe-hint learn'}, 'STILL LEARNING'), know_hint_el = el('div', {class: 'swipe-hint know'}, 'KNOW');
  const inner_el = el('div', {class: 'flashcard-inner'}, el('div', {class: 'face front'}, current_card[front_key]), el('div', {class: 'face back'}, current_card[back_key]));
  const is_browsing = !!study_session.browsing, done_hash = study_session.return_hash || '#/set/' + card_set.id;
  const card_el = el('div', {class: 'flashcard'}, is_browsing ? null : learn_hint_el, is_browsing ? null : know_hint_el, inner_el);
  let has_flipped = false; new MutationObserver(() => { if (card_el.classList.contains('flipped')) has_flipped = true; }).observe(card_el, {attributes: true, attributeFilter: ['class']});
  function move_card(step_by) { study_session.position = (study_session.position + step_by + study_session.queue.length) % study_session.queue.length; view_study(card_set); }
  function toggle_shuffle() {
    app_state.shuffle = !app_state.shuffle; save_state();
    if (!is_browsing) { start_flashcards(card_set, undefined, study_session.return_hash); return view_study(card_set); }
    const other_cards = studyable_indexes(card_set).filter(card_index => card_index !== current_index);
    study_session.queue = app_state.shuffle ? [current_index].concat(shuffled(other_cards)) : studyable_indexes(card_set);
    study_session.position = study_session.queue.indexOf(current_index); view_study(card_set);
  }
  function toggle_keep_score(keep_score) {
    app_state.keep_score = keep_score; save_state();
    if (keep_score) start_flashcards(card_set, undefined, study_session.return_hash); else study_session.browsing = true;
    view_study(card_set);
  }
  function answer(is_known) { const key_text = card_key(current_card); study_session.answer_history.push({position: study_session.position, was_known: is_known, key_text, memory: card_memory(card_set, key_text), last_studied: card_set.last_studied}); record_answer(card_set, current_index, is_known); if (study_session.mode === 'cards' && smart_learning_on()) { set_rating(card_set, key_text, is_known ? (has_flipped ? 'sometimes' : 'always') : 'never'); study_session.flip_log = study_session.flip_log || []; study_session.flip_log.push({key_text, is_known, has_flipped}); save_state(); } (is_known ? study_session.known : study_session.learning).push(study_session.queue[study_session.position]); study_session.position++; view_study(card_set); }
  // Tap flips. A horizontal swipe answers (right = know, left = still learning), or without score turns to the next or last card.
  let drag_start = null;
  function drag_begin(start_x, start_y) { drag_start = {x: start_x, y: start_y}; inner_el.style.transition = 'none'; }
  function drag_move(now_x) { if (!drag_start) return; const drag_x = now_x - drag_start.x; inner_el.style.transform = 'translateX(' + drag_x + 'px) rotate(' + drag_x / 25 + 'deg)' + (card_el.classList.contains('flipped') ? ' rotateY(180deg)' : ''); know_hint_el.style.opacity = Math.max(0, Math.min(1, drag_x / 100)); learn_hint_el.style.opacity = Math.max(0, Math.min(1, -drag_x / 100)); }
  function drag_reset() { drag_start = null; inner_el.style.transition = ''; inner_el.style.transform = ''; know_hint_el.style.opacity = 0; learn_hint_el.style.opacity = 0; }
  function drag_end(end_x, end_y) {
    if (!drag_start) return; const drag_x = end_x - drag_start.x, drag_y = end_y - drag_start.y; drag_reset();
    if (Math.abs(drag_x) > 90) { if (is_browsing) move_card(drag_x > 0 ? -1 : 1); else answer(drag_x > 0); } else if (Math.hypot(drag_x, drag_y) < 10) card_el.classList.toggle('flipped');
  }
  // A finger has its own events: a touch browser can take a pointer's gesture over as a scroll and cancel it mid-swipe, and stopping the touch's move is what prevents that.
  card_el.addEventListener('pointerdown', pointer_event => { if (pointer_event.pointerType === 'touch') return; card_el.setPointerCapture(pointer_event.pointerId); drag_begin(pointer_event.clientX, pointer_event.clientY); });
  card_el.addEventListener('pointermove', pointer_event => { if (pointer_event.pointerType !== 'touch') drag_move(pointer_event.clientX); });
  card_el.addEventListener('pointerup', pointer_event => { if (pointer_event.pointerType !== 'touch') drag_end(pointer_event.clientX, pointer_event.clientY); });
  card_el.addEventListener('pointercancel', pointer_event => { if (pointer_event.pointerType !== 'touch') drag_reset(); });
  card_el.addEventListener('touchstart', touch_event => { if (touch_event.touches.length === 1) drag_begin(touch_event.touches[0].clientX, touch_event.touches[0].clientY); else drag_reset(); }, {passive: true});
  card_el.addEventListener('touchmove', touch_event => { if (touch_event.cancelable) touch_event.preventDefault(); if (touch_event.touches.length === 1) drag_move(touch_event.touches[0].clientX); }, {passive: false});
  card_el.addEventListener('touchend', touch_event => { if (touch_event.cancelable) touch_event.preventDefault(); const lifted_touch = touch_event.changedTouches[0]; drag_end(lifted_touch.clientX, lifted_touch.clientY); }, {passive: false});
  card_el.addEventListener('touchcancel', drag_reset);
  const done_count = study_session.position, total_count = study_session.queue.length;
  render(set_trail(card_set, find_mode(study_session.mode).label), [el('a', {class: 'button', href: done_hash}, 'Done')], [el('div', {class: 'study-wrap', style: tint_style(card_set)},
    el('div', {class: 'counts'}, el('span', {class: 'muted'}, 'Card ' + (done_count + 1) + ' of ' + total_count), el('span', {class: 'button-row tight-row'}, study_session.mode === 'cards' ? el('label', {class: 'toggle-line keep-score'}, el('input', {type: 'checkbox', checked: !is_browsing, onchange: change_event => toggle_keep_score(change_event.target.checked)}), 'Keep score') : null, study_session.mode === 'cards' ? el('button', {class: 'shuffle-button', onclick: toggle_shuffle}, app_state.shuffle ? 'Shuffle on' : 'Shuffle off') : null, direction_switch(card_set))),
    el('div', {class: 'progress'}, el('div', {style: 'width:' + (100 * (done_count + (is_browsing ? 1 : 0)) / total_count) + '%'})),
    is_browsing ? null : el('div', {class: 'counts'}, el('span', {class: 'learn'}, study_session.learning.length + ' learning'), el('span', {class: 'know'}, study_session.known.length + ' known')),
    card_el,
    is_browsing ? el('div', {class: 'study-buttons'}, el('button', {onclick: () => move_card(-1)}, '← Back'), el('button', {onclick: () => card_el.classList.toggle('flipped')}, 'Flip'), el('button', {onclick: () => move_card(1)}, 'Next →')) : el('div', {class: 'study-buttons'}, el('button', {class: 'learn-button', onclick: () => answer(false)}, '← Still learning'), el('button', {onclick: () => card_el.classList.toggle('flipped')}, 'Flip'), el('button', {class: 'know-button', onclick: () => answer(true)}, 'Know →')),
    is_browsing ? null : el('div', {class: 'study-nav'}, previous_card_button(card_set), el('button', Object.assign({title: 'Start this round again and take back its answers', onclick: () => { while (study_session.answer_history.length) take_back_answer(card_set); save_state(); view_study(card_set); }}, study_session.answer_history.length ? {} : {disabled: 'disabled'}), 'Start again')),
    el('div', {class: 'muted'}, is_browsing ? 'Tap to flip · swipe or press ← → to move · nothing is recorded' : 'Tap to flip · swipe right if you know it, left if not · keys: space, ← →, Backspace for the previous card'))]);
}

// Know without flipping counts as always, Know after flipping as sometimes. Someone who flips nearly every card is just in the habit, so for that round a flip says nothing.
function settle_flip_ratings(card_set) {
  const flip_log = study_session.flip_log || [], flip_count = flip_log.filter(log_item => log_item.has_flipped).length, is_habit = flip_log.length >= 5 && flip_count / flip_log.length >= 0.9;
  flip_log.forEach(log_item => { if (log_item.is_known && log_item.has_flipped) set_rating(card_set, log_item.key_text, is_habit ? 'always' : 'sometimes'); });
  if (flip_log.length) save_state();
}
function view_study_summary(card_set) {
  settle_flip_ratings(card_set);
  const learning_indexes = study_session.learning.slice(), reward_el = award_round(card_set, find_mode(study_session.mode), study_session.known.length, study_session.known.length + learning_indexes.length), next_tiles = round_next_tiles(card_set, learning_indexes, study_session.known.length, study_session.mode);
  render(set_trail(card_set, find_mode(study_session.mode).label), [el('a', {class: 'button', href: '#/set/' + card_set.id}, 'Done')], [el('div', {class: 'study-wrap empty', style: tint_style(card_set)},
    el('h2', {class: 'summary-title'}, learning_indexes.length ? 'Round complete' : 'All known!'), reward_el,
    el('div', {class: 'counts'}, el('span', {class: 'learn'}, learning_indexes.length + ' still learning'), el('span', {class: 'know'}, study_session.known.length + ' known')),
    el('div', {class: 'next-tiles'}, ...next_tiles), el('div', {class: 'button-row center-row'}, previous_card_button(card_set)))]);
}
// What to do after a round, with one tile recommended from how it went: mostly wrong needs Learn from scratch, some wrong needs those cards again, all right moves on.
function round_next_tiles(card_set, learning_indexes, known_count, session_mode) {
  const due_count = due_indexes(card_set).length, learn_now = learn_counts(card_set), total_count = studyable_indexes(card_set).length, is_learn_unfinished = learn_now.learned < learn_now.cards, can_revise = session_mode !== 'revise' && due_count > 0;
  const recommended_name = learning_indexes.length ? (known_count < learning_indexes.length ? 'learn' : 'more') : can_revise ? 'revise' : is_learn_unfinished ? 'learn' : 'all';
  function next_tile(tile_name, heading_text, note_text, tile_action) {
    const tile_nodes = [recommended_name === tile_name ? el('span', {class: 'recommended-tag'}, 'Recommended') : null, el('strong', {}, heading_text), el('span', {class: 'next-note'}, note_text)];
    const class_text = 'next-tile' + (recommended_name === tile_name ? ' is-recommended' : '');
    return typeof tile_action === 'string' ? el('a', {class: class_text, href: tile_action}, ...tile_nodes) : el('button', {class: class_text, onclick: tile_action}, ...tile_nodes);
  }
  return [
    learning_indexes.length ? next_tile('more', 'Study more', "Let's go through the " + (learning_indexes.length === 1 ? 'one' : learning_indexes.length) + " you're still learning.", () => { start_session(card_set, learning_indexes, session_mode); view_study(card_set); }) : null,
    next_tile('all', 'Go through all cards', 'Another round of all ' + total_count + ' cards.', () => { study_session = null; view_mode(card_set, 'cards'); }),
    session_mode === 'revise' ? null : next_tile('revise', 'Move on to Revise', due_count ? due_count + (due_count === 1 ? ' card is' : ' cards are') + ' ready to come back.' : 'Nothing is ready yet. It will tell you when the next card is.', play_hash(card_set, 'revise')),
    next_tile('learn', 'Move on to Learn from scratch', is_learn_unfinished ? (smart_learning_on() ? 'Words you know get one quick check, and the rest get the full route. ' : 'Showing cards, multiple choice and typing. ') + learn_now.learned + ' of ' + learn_now.cards + ' cards learned so far.' : 'You have finished it for this set. Start it again from there.', play_hash(card_set, 'learn'))
  ].filter(Boolean);
}

document.addEventListener('keydown', key_event => {
  if (selection_keys && selection_keys(key_event)) { key_event.preventDefault(); return; }
  if (!location.hash.startsWith('#/play/')) return;
  const is_typing = key_event.target.tagName === 'INPUT' || key_event.target.tagName === 'TEXTAREA', key_button = Array.from(view_el.querySelectorAll('[data-key]')).find(button_el => button_el.dataset.key === key_event.key && !button_el.disabled);
  if (key_button && !is_typing) { key_event.preventDefault(); key_button.click(); return; }
  const card_el = view_el.querySelector('.flashcard'); if (!card_el || is_typing) return;
  const study_buttons = view_el.querySelectorAll('.study-buttons button');
  if (key_event.key === ' ' || key_event.key === 'ArrowUp' || key_event.key === 'ArrowDown') { key_event.preventDefault(); card_el.classList.toggle('flipped'); }
  else if (key_event.key === 'ArrowLeft') study_buttons[0].click(); else if (key_event.key === 'ArrowRight') study_buttons[2].click();
});

// Copy diagnostics: a plain-text report to paste into a bug report. No email, password, token or set contents.
const recent_errors = [];
function note_error(error_text) { recent_errors.push(new Date().toISOString().slice(11, 19) + ' ' + String(error_text).slice(0, 300)); if (recent_errors.length > 5) recent_errors.shift(); }
addEventListener('error', error_event => note_error(error_event.message + (error_event.filename ? ' (' + error_event.filename.split('/').pop() + ':' + error_event.lineno + ')' : '')));
addEventListener('unhandledrejection', rejection_event => note_error(rejection_event.reason && rejection_event.reason.message || rejection_event.reason));
async function diagnostics_text() {
  const sync_status = sync_engine.status, account_now = sync_engine.signed_in(), card_total = app_state.sets.reduce((card_count, card_set) => card_count + card_set.cards.length, 0);
  const storage_estimate = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate().catch(() => null) : null, is_persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted().catch(() => null) : null;
  return ['Quizaroo v' + APP_VERSION + ' diagnostics, ' + new Date().toISOString(),
    'Browser: ' + navigator.userAgent,
    'Running as: ' + (matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 'installed app' : 'browser tab') + ', ' + (navigator.onLine ? 'online' : 'offline') + ', offline copy ' + ('serviceWorker' in navigator && navigator.serviceWorker.controller ? 'ready' : 'not ready'),
    'Screen: ' + innerWidth + 'x' + innerHeight + ' @' + devicePixelRatio + 'x, view ' + document.documentElement.dataset.theme + '/' + document.documentElement.dataset.style,
    'Storage: ' + app_state.sets.length + ' sets, ' + card_total + ' cards' + (storage_estimate ? ', ' + (storage_estimate.usage / 1048576).toFixed(1) + ' MB used' : '') + (is_persisted === null ? '' : is_persisted ? ', kept' : ', may be cleared by the browser'),
    'Sync: ' + (!account_now ? 'not signed in' : sync_status.state + (account_now.server === sync_engine.DEFAULT_SERVER ? ' (usual server)' : ' (own server)') + ', ' + sync_status.pending + ' waiting to send, connection ' + (sync_status.link || 'unknown') + ', last synced ' + (sync_status.last || 'never') + ', last reached ' + (sync_status.reached || 'never') + (sync_status.files === 'error' ? ', files: ' + sync_status.file_error : '')),
    'Sync error: ' + (sync_status.error || 'none'),
    'Recent errors: ' + (recent_errors.length ? '\n  ' + recent_errors.join('\n  ') : 'none')].join('\n');
}
// Clipboard can be refused (an old browser, or no permission): then the report shows in a box to copy by hand.
async function copy_diagnostics() {
  const report_text = await diagnostics_text();
  try { await navigator.clipboard.writeText(report_text); toast('Diagnostics copied. Paste them into your message.', {ms: 3000}); }
  catch (copy_err) {
    const box_el = el('textarea', {class: 'sync-input', rows: 10, readonly: 'readonly', style: 'width:100%;font:12px monospace'}), dialog_el = el('dialog', {class: 'whatsnew-sheet'}, el('p', {}, "Couldn't copy. Select all and copy this:"), box_el, el('div', {class: 'button-row'}, el('button', {onclick: () => dialog_el.close()}, 'Close')));
    box_el.value = report_text; dialog_el.addEventListener('close', () => dialog_el.remove()); document.body.appendChild(dialog_el); dialog_el.showModal(); box_el.select();
  }
}

function view_settings() {
  const check_button = el('button', {onclick: async () => {
    check_button.disabled = true; check_button.textContent = 'Checking…';
    const check_result = await check_for_update();
    if (check_result === 'ready') { toast('Updating…'); await apply_update(); return; }
    check_button.disabled = false; check_button.textContent = 'Check for updates';
    toast(check_result === 'offline' ? 'Could not reach the server. Try again when you are online.' : 'You have the latest version.', {ms: 3000});
  }}, 'Check for updates');
  render([menu_crumb('settings', '#/settings')], [], [install_section(), sync_section(), settings_panel('updates', 'Updates', el('span', {class: 'settings-panel-status'}, 'Version ' + APP_VERSION), {class: 'settings-panel updates-section'},
    el('div', {class: 'ruled'},
      el('div', {class: 'detail-row'}, el('div', {class: 'line-margin'}, 'Version'), el('div', {class: 'settings-line'}, el('span', {}, 'Quizaroo v' + APP_VERSION), check_button, el('button', {onclick: () => show_whats_new(app_state.whatsnew_last || APP_VERSION)}, "What's new"))),
      el('div', {class: 'detail-row'}, el('div', {class: 'line-margin'}, 'Help'), el('div', {class: 'settings-line'}, el('button', {id: 'copy-diagnostics', onclick: copy_diagnostics}, 'Copy diagnostics'), el('span', {class: 'muted'}, 'Version, browser and sync status, to paste into a bug report. No email, password or sets.'))),
      el('div', {class: 'detail-row'}, el('div', {class: 'line-margin'}, 'After'), el('label', {class: 'settings-line'}, el('input', {type: 'checkbox', checked: app_state.show_update_info !== false, onchange: change_event => { app_state.show_update_info = change_event.target.checked; save_state(); toast(change_event.target.checked ? "What's new shows after each update." : "What's new won't show after updates."); }}), 'Show update info', el('span', {class: 'muted'}, 'After an update, a list of what changed, each with Show me.')))))]);
}

// Pages holding on to a set while someone works on it: sync leaves what's on them alone until they're left.
function view_is_busy() { return /^#\/(new|edit|play)(\/|$)/.test(location.hash) || !!selection_keys || document.body.classList.contains('is-carrying') || !!view_el.querySelector('.conflict-list'); }
// Sync brought changes: draw the page again where it was, without counting as opening anything (route() would, and that would count as a change on every device in turn).
function refresh_view() {
  if (view_is_busy()) return;
  const route_parts = location.hash.replace(/^#\/?/, '').split('/'), scroll_top = window.scrollY;
  if (route_parts[0] === 'settings') return;
  if (route_parts[0] === 'set') { const route_set = find_set(decodeURIComponent(route_parts[1] || '')); if (!route_set) { location.hash = '#/library'; return; } view_set(route_set); }
  else if (route_parts[0] === 'library') view_library();
  else if (route_parts[0] === 'stats') view_stats();
  else view_home();
  window.scrollTo(0, scroll_top);
}

// ---- Routing: #/ , #/library, #/settings, #/new, #/set/<id>, #/edit/<id>, #/play/<id>/<mode> ----
function route() {
  const route_parts = location.hash.replace(/^#\/?/, '').split('/'), route_name = route_parts[0], route_set = find_set(decodeURIComponent(route_parts[1] || ''));
  const is_home = !['library', 'stats', 'settings', 'new', 'set', 'edit', 'play'].includes(route_name) || (['set', 'edit', 'play'].includes(route_name) && !route_set);
  editor_has_changes = null; close_view_menu(); end_selection_bar();
  study_session = null; clear_mode_timers();
  if (['set', 'edit', 'play'].includes(route_name) && route_set) { route_set.last_opened = Date.now(); save_state(); }
  if (is_home) last_list_hash = '#/'; else if (route_name === 'library') last_list_hash = '#/library';
  document.querySelectorAll('.nav-item').forEach(nav_el => nav_el.classList.toggle('active', nav_el.dataset.nav === (is_home ? 'home' : ['settings', 'stats'].includes(route_name) ? route_name : 'library')));
  if (['new', 'edit', 'play'].includes(route_name) && !is_home) document.body.dataset.focus = ''; else delete document.body.dataset.focus;
  if (route_name === 'set' && route_set) view_set(route_set);
  else if (route_name === 'edit' && route_set) view_edit(route_set, false);
  else if (route_name === 'play' && route_set) view_mode(route_set, route_parts[2], route_parts[3]);
  else if (route_name === 'new') view_edit({id: new_id(), title: '', cards: []}, true);
  else if (route_name === 'library') view_library();
  else if (route_name === 'settings') view_settings();
  else if (route_name === 'stats') view_stats();
  else view_home();
}
// Leaving the editor by any route (sidebar, back button) asks first if something would be lost.
window.addEventListener('hashchange', hash_event => {
  if (skip_next_route) { skip_next_route = false; return; }
  if (editor_has_changes && editor_has_changes() && !confirm('Discard your changes?')) { skip_next_route = true; location.hash = new URL(hash_event.oldURL).hash; return; }
  route();
});
window.addEventListener('beforeunload', unload_event => { if (editor_has_changes && editor_has_changes()) unload_event.preventDefault(); });
// ---- View menu ----
function save_view_choice(storage_key, chosen_value) { try { localStorage.setItem(storage_key, chosen_value); } catch (storage_err) {} apply_theme(); }
let menu_button_el = null;
function close_view_menu() { const menu_el = document.querySelector('.view-menu'); if (!menu_el) return; menu_el.remove(); menu_button_el.setAttribute('aria-expanded', 'false'); removeEventListener('pointerdown', close_if_outside, true); removeEventListener('keydown', close_on_escape, true); }
function close_if_outside(pointer_event) { if (!pointer_event.target.closest('.view-menu') && !menu_button_el.contains(pointer_event.target)) close_view_menu(); }
function close_on_escape(key_event) { if (key_event.key === 'Escape') { key_event.stopPropagation(); const button_el = menu_button_el; close_view_menu(); button_el.focus(); } }
// A menu that drops from a top bar button. A second press closes it.
function toggle_top_menu(button_el, menu_label, ...menu_nodes) {
  const was_open = button_el === menu_button_el && document.querySelector('.view-menu');
  close_view_menu(); if (was_open) return;
  const button_rect = button_el.getBoundingClientRect(); menu_button_el = button_el;
  document.body.appendChild(el('div', {class: 'view-menu', role: 'dialog', 'aria-label': menu_label, style: 'top:' + (button_rect.bottom + 8) + 'px;right:' + Math.max(12, innerWidth - button_rect.right) + 'px'}, ...menu_nodes));
  button_el.setAttribute('aria-expanded', 'true');
  addEventListener('pointerdown', close_if_outside, true); addEventListener('keydown', close_on_escape, true);
}
function open_view_menu() {
  function choice_row(storage_key, current_value, choices) { const buttons = choices.map(choice_item => el('button', {'aria-pressed': String(choice_item.value === current_value), onclick: () => { save_view_choice(storage_key, choice_item.value); buttons.forEach((button_el, button_index) => button_el.setAttribute('aria-pressed', String(choices[button_index].value === choice_item.value))); }}, choice_item.sample, choice_item.label)); return el('div', {class: 'view-choices'}, ...buttons); }
  const root_data = document.documentElement.dataset;
  toggle_top_menu(view_button_el, 'View settings',
    el('h3', {}, 'Style'), choice_row(STYLE_KEY, root_data.style, [{value: 'plain', label: 'Plain', sample: el('span', {class: 'view-sample plain'}, el('i'), el('i'))}, {value: 'lined', label: 'Lined', sample: el('span', {class: 'view-sample lined'})}]),
    el('h3', {}, 'View mode'), choice_row(THEME_KEY, root_data.theme, [{value: 'light', label: '☀ Dawn'}, {value: 'glass', label: '☾ Dusk'}]),
    el('h3', {}, 'Sound'), choice_row(SOUND_KEY, sound_is_on() ? 'on' : 'off', [{value: 'on', label: 'On'}, {value: 'off', label: 'Off'}]));
}
view_button_el.addEventListener('click', open_view_menu);
route();
sync_engine.init();
sync_engine.watch_other_tabs();
sync_pill();
show_install_banner();
start_active_timer();
seed_demo_sets();
upgrade_demo_sets();
after_update();
register_service_worker();
