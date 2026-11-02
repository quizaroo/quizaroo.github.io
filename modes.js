// Learning modes. Loaded before app.js, which supplies el, render, save_state and the set helpers.
const MODES = [
  {key: 'vocab', label: 'View all vocab', blurb: 'See every term beside its meaning, to read through or look something up.', art: '<rect x="9" y="10" width="46" height="44" rx="4"/><path d="M9 21h46M9 32h46M9 43h46M28 10v44"/><path d="M14 15.500h9M33 15.500h16M14 26.500h8M33 26.500h12M14 37.500h9M33 37.500h17M14 48.500h7M33 48.500h11"/>', group: 'Learn', tint: '#8fd3ff', min_cards: 1},
  {key: 'cards', label: 'Flashcards', blurb: 'Flip through every card and say whether you know it.', art: '<rect x="19" y="9" width="34" height="24" rx="3" transform="rotate(8 36 21)"/><rect x="11" y="24" width="38" height="28" rx="3" transform="rotate(-5 30 38)"/><path d="M19 34l20-2M20 41l21-2M20 47l12-1"/>', group: 'Learn', tint: '#a8b8ff', min_cards: 1},
  {key: 'learn', label: 'Learn from scratch', blurb: 'Start new words from nothing, in small batches: see, pick, then type.', art: '<path d="M18 40h28l-3 15a2 2 0 0 1-2 1.500H23a2 2 0 0 1-2-1.500z"/><path d="M15 40h34"/><path d="M32 40V21"/><path d="M32 28c-1-8-7-12-15-12 0 8 6 13 15 12z"/><path d="M32 22c0-7 5-12 14-13 1 8-5 14-14 13z"/>', group: 'Learn', tint: '#9be7a8', min_cards: 1},
  {key: 'revise', label: 'Revise', blurb: 'Only the cards due today, so words stick for the long term.', art: '<path d="M52 27a21 21 0 0 0-37-8l-5 5"/><path d="M10 13v11h11"/><path d="M12 37a21 21 0 0 0 37 8l5-5"/><path d="M54 51V40H43"/><rect x="24" y="25" width="16" height="14" rx="2"/><path d="M28 30h8M28 34h5"/>', group: 'Learn', tint: '#ffc285', min_cards: 1},
  {key: 'type', label: 'Type the answer', blurb: 'Spell each answer yourself, the toughest test of what you remember.', art: '<rect x="6" y="28" width="52" height="27" rx="4"/><path d="M13 35h2M21 35h2M29 35h2M37 35h2M45 35h6M13 41h6M25 41h2M33 41h2M41 41h2M49 41h2M13 48h4M23 48h20M49 48h2"/><path d="M22 9h20M32 9v13M27 22h10"/>', group: 'Practise', tint: '#86e3d0', min_cards: 1, how: 'Type the answer, then press Enter.'},
  {key: 'choice', label: 'Multiple choice', blurb: 'Pick the right answer from four, a gentle way to get to know new words.', art: '<circle cx="14" cy="13" r="6"/><path d="M26 13h27"/><circle cx="14" cy="32" r="6"/><circle cx="14" cy="32" r="2" fill="currentColor"/><path d="M26 32h27"/><circle cx="14" cy="51" r="6"/><path d="M26 51h27"/><path d="M47 26l4 5 7-9"/>', group: 'Practise', tint: '#c3a6ff', min_cards: 2, how: 'Pick the right answer, or press 1 to 4.'},
  {key: 'truefalse', label: 'True or false', blurb: 'Decide quickly whether two things belong together.', art: '<path d="M32 8v44M20 56h24M32 52c-3 0-6 2-7 4M32 52c3 0 6 2 7 4"/><path d="M12 15h40"/><path d="M12 15L5 34M12 15l7 19M3 34a9 6 0 0 0 18 0zM52 15l-7 19M52 15l7 19M43 34a9 6 0 0 0 18 0z"/><circle cx="32" cy="11" r="3"/>', group: 'Practise', tint: '#ffe27a', min_cards: 2, how: 'Do these two go together? Press ← for false, → for true.'},
  {key: 'scramble', label: 'Unscramble', blurb: 'Rebuild the word from its letters to practise spelling.', art: '<rect x="7" y="10" width="20" height="20" rx="3" transform="rotate(-9 17 20)"/><path d="M12.5 26l4-11 5 9.500M14.5 22h6"/><rect x="36" y="7" width="20" height="20" rx="3" transform="rotate(10 46 17)"/><path d="M42 11v12M42 11h5c4 0 4 5 0 5h-5M42 16h6c4 0 4 6 0 6h-6"/><rect x="20" y="37" width="20" height="20" rx="3" transform="rotate(5 30 47)"/><path d="M35 43a5.5 5.5 0 1 0 0 8"/>', group: 'Practise', tint: '#f4a6e0', min_cards: 1, how: 'Tap the letters in the right order.'},
  {key: 'listen', label: 'Listen and type', blurb: 'Hear the word and type its meaning, to train your ear.', art: '<path d="M11 39V31a21 21 0 0 1 42 0v8"/><rect x="6" y="37" width="10" height="17" rx="4"/><rect x="48" y="37" width="10" height="17" rx="4"/><path d="M24 40v6M29 36v14M34 33v20M39 38v10"/>', group: 'Practise', tint: '#d4ef8a', min_cards: 1, how: 'Listen to the word, then type what it means.', fixed_direction: true},
  {key: 'test', label: 'Test', blurb: 'Ten mixed questions and a score, to see where you stand.', art: '<rect x="12" y="11" width="40" height="46" rx="4"/><rect x="24" y="6" width="16" height="9" rx="2"/><path d="M19 26l3 3 5-6M33 26h12M19 37l3 3 5-6M33 37h12M20 47l6 6M26 47l-6 6M33 50h12"/>', group: 'Practise', tint: '#ff9aa2', min_cards: 1, how: 'Ten mixed questions. You see your score at the end.'},
  {key: 'wheel', label: 'Spin the wheel', blurb: 'Spin to land on a random word, then answer it.', art: '<circle cx="32" cy="36" r="23"/><circle cx="32" cy="36" r="3"/><path d="M32 13v20M32 39v20M9 36h20M35 36h20M15.7 19.700l14 14M34.3 38.300l14 14M48.3 19.700l-14 14M29.7 38.300l-14 14"/><path d="M26 4h12l-6 11z"/>', group: 'Games', tint: '#ffab91', min_cards: 1, how: 'Spin, then answer the word it lands on.'},
  {key: 'match', label: 'Match pairs', blurb: 'Pair terms with their meanings against the clock.', art: '<path d="M9 19h11a4.5 4.5 0 1 1 9 0h4v9a4.5 4.5 0 1 1 0 9v8H9z"/><path d="M40 26h15v28H31V43a4.5 4.5 0 1 0 0-9"/><path d="M40 13l4 4 8-9"/>', group: 'Games', tint: '#8fd3ff', min_cards: 2, how: 'Tap a word, then its partner. Beat the clock.', fixed_direction: true},
  {key: 'memory', label: 'Memory', blurb: 'Find pairs among hidden cards, building recall as you play.', art: '<rect x="8" y="8" width="21" height="21" rx="3"/><rect x="35" y="8" width="21" height="21" rx="3"/><rect x="8" y="35" width="21" height="21" rx="3"/><rect x="35" y="35" width="21" height="21" rx="3"/><path d="M41 15c1-3 8-3 9 1 1 3-4 4-4 7M46 25.500v.100"/><path d="M18.5 13l1.8 3.7 4 .600-3 2.8.800 4-3.6-1.9-3.6 1.9.700-4-3-2.8 4.1-.600zM45.5 40l1.8 3.7 4 .600-3 2.8.800 4-3.6-1.9-3.6 1.9.700-4-3-2.8 4.1-.600z"/><path d="M14 41l9 9M23 41l-9 9"/>', group: 'Games', tint: '#c3a6ff', min_cards: 2, how: 'Turn over two cards at a time to find the pairs.', fixed_direction: true},
  {key: 'speed', label: 'Speed round', blurb: 'As many right answers as you can in 60 seconds, to build speed.', art: '<circle cx="32" cy="36" r="22"/><path d="M26 6h12M32 6v8M49 17l4 4"/><path d="M35 21l-9 16h7l-3 13 10-17h-7z"/>', group: 'Games', tint: '#ffe27a', min_cards: 2, how: 'As many right answers as you can in 60 seconds.'}
];
// Tiles can be moved, within a group or to another: app_state.mode_layout keeps where each one went. A mode that has not been moved stays in its usual group.
function modes_in_group(group_name) {
  const saved_layout = app_state.mode_layout || {}, moved_keys = Object.values(saved_layout).flat(), saved_modes = (saved_layout[group_name] || []).map(find_mode).filter(Boolean);
  return saved_modes.concat(MODES.filter(mode_item => mode_item.group === group_name && !moved_keys.includes(mode_item.key)));
}
function find_mode(mode_key) { return MODES.find(mode_item => mode_item.key === mode_key); }

// ---- Card progress: boxes 1 to 5, each with a longer wait. Right moves a card up a box; wrong sends it back to box 1, due again now. ----
const BOX_DAYS = [0, 1, 3, 7, 16, 35], DAY_MS = 86400000;
function card_record(card_set, card_index) { return (card_set.progress || {})[card_key(card_set.cards[card_index])]; }
function record_answer(card_set, card_index, is_right) {
  const now_ms = Date.now(), old_record = card_record(card_set, card_index) || {box: 0, right: 0, wrong: 0}, new_box = is_right ? Math.min(5, old_record.box + 1) : 1;
  card_set.progress = card_set.progress || {};
  card_set.progress[card_key(card_set.cards[card_index])] = {box: new_box, due: is_right ? now_ms + BOX_DAYS[new_box] * DAY_MS : now_ms, right: old_record.right + (is_right ? 1 : 0), wrong: old_record.wrong + (is_right ? 0 : 1), last: now_ms};
  card_set.last_studied = now_ms; save_state();
}
function card_status(card_set, card_index) { const record_item = card_record(card_set, card_index); return !record_item ? 'new' : record_item.box >= 5 ? 'mastered' : record_item.box >= 3 ? 'familiar' : 'learning'; }
function is_due(card_set, card_index) { const record_item = card_record(card_set, card_index); return !!record_item && record_item.due <= Date.now(); }
function due_indexes(card_set) { return studyable_indexes(card_set).filter(card_index => is_due(card_set, card_index)); }
function progress_counts(card_set) { const counts = {new: 0, learning: 0, familiar: 0, mastered: 0}; studyable_indexes(card_set).forEach(card_index => counts[card_status(card_set, card_index)]++); return counts; }
// Cards you find hardest come first: most overdue and lowest box, in random order within each box.
function weakest_first(card_set, card_indexes) { const rank_of = card_index => { const record_item = card_record(card_set, card_index); return !record_item ? 0.5 : record_item.box - (is_due(card_set, card_index) ? 3 : 0); }; return shuffled(card_indexes).sort((index_a, index_b) => rank_of(index_a) - rank_of(index_b)); }
function progress_meter(card_set) { const counts = progress_counts(card_set), total_count = studyable_indexes(card_set).length || 1; return el('div', {class: 'meter', title: counts.mastered + ' mastered, ' + counts.familiar + ' familiar, ' + counts.learning + ' learning, ' + counts.new + ' new'}, ...['mastered', 'familiar', 'learning'].map(status_name => el('div', {class: 'meter-' + status_name, style: 'width:' + (100 * counts[status_name] / total_count) + '%'}))); }
// The most useful thing to do next with a set.
function next_step(card_set) { const due_count = due_indexes(card_set).length; if (due_count) return {mode: 'revise', label: 'Revise ' + due_count}; if (progress_counts(card_set).new) return {mode: 'learn', label: 'Learn'}; return {mode: 'cards', label: 'Flashcards'}; }
function play_hash(card_set, mode_key) { return '#/play/' + card_set.id + '/' + mode_key; }

// ---- Direction: term first, definition first, or mixed ----
const DIRECTION_NAMES = {term: 'Term first', definition: 'Definition first', mixed: 'Mixed'};
function direction_of(card_set) { return card_set.front === 'definition' || card_set.front === 'mixed' ? card_set.front : 'term'; }
function front_side(card_set, card_index) {
  study_session.shown_index = card_index;
  const direction_name = direction_of(card_set); if (direction_name !== 'mixed') return direction_name;
  study_session.mixed_sides = study_session.mixed_sides || {};
  if (!study_session.mixed_sides[card_index]) study_session.mixed_sides[card_index] = Math.random() < 0.5 ? 'term' : 'definition';
  return study_session.mixed_sides[card_index];
}
function card_sides(card_set, card_index) { const front_key = front_side(card_set, card_index), back_key = front_key === 'term' ? 'definition' : 'term'; return {prompt: card_set.cards[card_index][front_key], answer: card_set.cards[card_index][back_key], front_key, back_key}; }
// Takes effect on the card on screen. Choosing Mixed turns that card over, so the change always shows.
function set_direction(card_set, new_direction) {
  if (direction_of(card_set) === new_direction) return;
  const shown_index = study_session.shown_index, is_shown = shown_index !== undefined, shown_side = is_shown ? front_side(card_set, shown_index) : null;
  card_set.front = new_direction; save_state();
  study_session.mixed_sides = new_direction === 'mixed' && is_shown ? {[shown_index]: shown_side === 'term' ? 'definition' : 'term'} : null;
  view_mode(card_set, study_session.mode);
}
function switch_buttons(option_names, current_name, on_pick) { return el('div', {class: 'direction-switch', role: 'group', 'aria-label': 'Which side shows first'}, ...option_names.map(option_name => el('button', {'aria-pressed': String(option_name === current_name), onclick: () => on_pick(option_name)}, DIRECTION_NAMES[option_name]))); }
function direction_switch(card_set) { return switch_buttons(['term', 'definition', 'mixed'], direction_of(card_set), new_direction => set_direction(card_set, new_direction)); }

// ---- Checking typed answers ----
function plain_answer(answer_text) { return answer_text.normalize('NFC').toLowerCase().replace(/́/g, '').replace(/[’ʼ`´]/g, "'").replace(/\([^)]*\)/g, ' ').replace(/[.!?*]/g, ' ').replace(/\s+/g, ' ').trim(); }
function without_lead_words(answer_text) { return answer_text.replace(/^(a|an|the|to) /, ''); }
function without_accents(answer_text) { return answer_text.normalize('NFD').replace(/\p{M}/gu, ''); }
function accepted_answers(answer_text) { const whole_answer = plain_answer(answer_text); return Array.from(new Set([whole_answer].concat(answer_text.split(/[\/,;]/).map(plain_answer)).filter(Boolean).flatMap(accepted_text => [accepted_text, without_lead_words(accepted_text)]))); }
function edit_distance(text_a, text_b) { let previous_row = Array.from({length: text_b.length + 1}, (unused_item, row_index) => row_index); for (let a_index = 1; a_index <= text_a.length; a_index++) { const current_row = [a_index]; for (let b_index = 1; b_index <= text_b.length; b_index++) current_row[b_index] = Math.min(previous_row[b_index] + 1, current_row[b_index - 1] + 1, previous_row[b_index - 1] + (text_a[a_index - 1] === text_b[b_index - 1] ? 0 : 1)); previous_row = current_row; } return previous_row[text_b.length]; }
// Returns 'right', 'close' (one slip, or only accents differ) or 'wrong'.
function check_answer(typed_text, answer_text) {
  const typed_answer = without_lead_words(plain_answer(typed_text)), accepted_list = accepted_answers(answer_text);
  if (accepted_list.includes(typed_answer)) return 'right';
  if (typed_answer && accepted_list.some(accepted_text => without_accents(accepted_text) === without_accents(typed_answer) || (accepted_text.length > 3 && edit_distance(accepted_text, typed_answer) === 1))) return 'close';
  return 'wrong';
}
function other_answers(card_set, card_index, back_key, wanted_count) { const seen_answers = new Set([plain_answer(card_set.cards[card_index][back_key])]), found_answers = []; shuffled(studyable_indexes(card_set)).forEach(other_index => { const other_answer = card_set.cards[other_index][back_key], plain_other = plain_answer(other_answer); if (found_answers.length < wanted_count && !seen_answers.has(plain_other)) { seen_answers.add(plain_other); found_answers.push(other_answer); } }); return found_answers; }

// ---- Shared screen pieces ----
let mode_timers = [];
function clear_mode_timers() { mode_timers.forEach(clearTimeout); mode_timers = []; if (window.speechSynthesis) speechSynthesis.cancel(); }
function later(run_later, delay_ms) { mode_timers.push(setTimeout(run_later, delay_ms)); }
function mode_frame(card_set, mode_item, top_nodes, body_nodes) {
  clear_mode_timers();
  render(mode_item.label, [el('a', {class: 'button', href: '#/set/' + card_set.id}, 'Done')], [el('div', {class: 'study-wrap mode-wrap', style: tint_style(card_set)},
    el('div', {class: 'counts'}, el('span', {class: 'muted mode-status'}, ...top_nodes), mode_item.fixed_direction ? null : direction_switch(card_set)),
    ...body_nodes,
    mode_item.how ? el('div', {class: 'muted'}, mode_item.how) : null)]);
}
function session_progress() { return el('div', {class: 'progress'}, el('div', {style: 'width:' + (100 * study_session.position / Math.max(1, study_session.queue.length)) + '%'})); }
function prompt_card(prompt_text) { return el('div', {class: 'prompt-card'}, prompt_text); }
const SIDE_NAMES = {term: 'Term', definition: 'Definition'};
// Both sides written on the paper's lines, each named in the margin.
function pair_card(front_key, front_text, back_text) { const back_key = front_key === 'term' ? 'definition' : 'term'; return el('div', {class: 'prompt-card pair-card'}, el('div', {class: 'pair-row'}, el('span', {class: 'pair-label'}, SIDE_NAMES[front_key]), el('div', {class: 'pair-text'}, front_text)), el('div', {class: 'pair-row'}, el('span', {class: 'pair-label'}, SIDE_NAMES[back_key]), el('div', {class: 'pair-text'}, back_text))); }
function answer_panel(is_right, panel_text, extra_nodes) { return el('div', {class: 'answer-panel ' + (is_right ? 'is-right' : 'is-wrong'), role: 'status'}, el('strong', {}, is_right ? 'Right' : 'Not quite'), panel_text ? el('div', {}, panel_text) : null, ...(extra_nodes || [])); }
function next_button(run_next) { return el('button', {class: 'primary', 'data-key': 'Enter', onclick: run_next}, 'Next'); }
function start_mode_session(card_set, mode_key, card_indexes) { study_session = {set_id: card_set.id, mode: mode_key, queue: card_indexes, position: 0, known: [], learning: [], right: 0, wrong: 0, missed: []}; }

// One question at a time, shared by every question mode. The ask function calls back with whether the answer was right.
function run_questions(card_set, mode_item, ask_question) {
  if (study_session.position >= study_session.queue.length) return view_mode_summary(card_set, mode_item);
  const card_index = study_session.queue[study_session.position];
  ask_question(card_set, mode_item, card_index, is_right => {
    record_answer(card_set, card_index, is_right);
    if (is_right) study_session.right++; else { study_session.wrong++; study_session.missed.push(card_index); }
    study_session.position++; run_questions(card_set, mode_item, ask_question);
  });
}
function position_label() { return 'Question ' + (study_session.position + 1) + ' of ' + study_session.queue.length; }

function ask_type(card_set, mode_item, card_index, finish, ask_options) {
  const sides = (ask_options && ask_options.sides) || card_sides(card_set, card_index), input_el = el('input', {type: 'text', class: 'answer-input', placeholder: 'Type the answer', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Your answer'}), result_el = el('div', {class: 'answer-slot'});
  let tried_close = false, is_answered = false;
  function show_result(is_right, extra_nodes) { is_answered = true; input_el.disabled = true; form_button.hidden = true; if (is_right) { result_el.replaceChildren(answer_panel(true, sides.answer)); later(() => finish(true), 900); return; } const next_el = next_button(() => finish(false)); result_el.replaceChildren(answer_panel(false, 'The answer is: ' + sides.answer, [el('div', {class: 'button-row'}, next_el, el('button', {onclick: () => finish(true)}, 'I was right'))])); next_el.focus(); }
  const form_button = el('button', {class: 'primary', type: 'submit'}, 'Check');
  const form_el = el('form', {class: 'answer-form', onsubmit: submit_event => { submit_event.preventDefault(); if (is_answered) return; const verdict = check_answer(input_el.value, sides.answer); if (verdict === 'close' && !tried_close) { tried_close = true; result_el.replaceChildren(el('div', {class: 'answer-panel is-close', role: 'status'}, 'So close. Check the spelling and try again.')); input_el.focus(); return; } show_result(verdict !== 'wrong'); }}, input_el, form_button);
  mode_frame(card_set, mode_item, [(ask_options && ask_options.status) || position_label()], [session_progress(), (ask_options && ask_options.prompt_node) || prompt_card(sides.prompt), form_el, result_el, ask_options && ask_options.footer]);
  input_el.focus();
}
function ask_choice(card_set, mode_item, card_index, finish, ask_options) {
  const sides = card_sides(card_set, card_index), option_texts = shuffled([sides.answer].concat(other_answers(card_set, card_index, sides.back_key, 3))), result_el = el('div', {class: 'answer-slot'}), is_quick = ask_options && ask_options.quick;
  const option_buttons = option_texts.map((option_text, option_index) => el('button', {class: 'choice-button', 'data-key': String(option_index + 1), onclick: () => {
    option_buttons.forEach(button_el => { button_el.disabled = true; if (button_el.textContent.slice(2) === option_text && option_text !== sides.answer) button_el.classList.add('is-wrong'); if (button_el.dataset.answer === 'yes') button_el.classList.add('is-right'); });
    const is_right = option_text === sides.answer;
    if (is_quick) { later(() => finish(is_right), is_right ? 150 : 700); return; }
    if (is_right) { result_el.replaceChildren(answer_panel(true)); later(() => finish(true), 700); return; }
    const next_el = next_button(() => finish(false)); result_el.replaceChildren(answer_panel(false, null, [next_el])); next_el.focus();
  }}, el('span', {class: 'choice-number'}, option_index + 1), option_text));
  option_buttons.forEach((button_el, option_index) => { if (option_texts[option_index] === sides.answer) button_el.dataset.answer = 'yes'; });
  mode_frame(card_set, mode_item, [(ask_options && ask_options.status) || position_label()], [is_quick && ask_options.top_node ? ask_options.top_node : session_progress(), prompt_card(sides.prompt), el('div', {class: 'choice-grid'}, ...option_buttons), result_el, ask_options && ask_options.footer]);
}
function ask_true_false(card_set, mode_item, card_index, finish) {
  const sides = card_sides(card_set, card_index), wrong_options = other_answers(card_set, card_index, sides.back_key, 1), is_true_pair = !wrong_options.length || Math.random() < 0.5, shown_answer = is_true_pair ? sides.answer : wrong_options[0], result_el = el('div', {class: 'answer-slot'});
  function pick(said_true) { buttons_el.querySelectorAll('button').forEach(button_el => { button_el.disabled = true; }); const is_right = said_true === is_true_pair; if (is_right) { result_el.replaceChildren(answer_panel(true)); later(() => finish(true), 600); return; } const next_el = next_button(() => finish(false)); result_el.replaceChildren(answer_panel(false, sides.prompt + ' = ' + sides.answer, [next_el])); next_el.focus(); }
  const buttons_el = el('div', {class: 'study-buttons'}, el('button', {class: 'learn-button', 'data-key': 'ArrowLeft', onclick: () => pick(false)}, '← False'), el('button', {class: 'know-button', 'data-key': 'ArrowRight', onclick: () => pick(true)}, 'True →'));
  mode_frame(card_set, mode_item, [position_label()], [session_progress(), pair_card(sides.front_key, sides.prompt, shown_answer), buttons_el, result_el]);
}
function ask_scramble(card_set, mode_item, card_index, finish) {
  const sides = card_sides(card_set, card_index), target_text = sides.answer.split(/[\/,;]/)[0].replace(/\([^)]*\)/g, '').trim(), target_letters = Array.from(target_text.replace(/\s+/g, '')), built_el = el('div', {class: 'built-word'}), tiles_el = el('div', {class: 'letter-tiles'}), result_el = el('div', {class: 'answer-slot'}), built_tiles = [];
  function draw_built() { built_el.textContent = built_tiles.map(tile_el => tile_el.textContent).join('') || ' '; }
  function complete_word() { const is_right = built_tiles.map(tile_el => tile_el.textContent).join('').toLowerCase() === target_letters.join('').toLowerCase(); tiles_el.querySelectorAll('button').forEach(tile_el => { tile_el.disabled = true; }); if (is_right) { result_el.replaceChildren(answer_panel(true, target_text)); later(() => finish(true), 900); return; } const next_el = next_button(() => finish(false)); result_el.replaceChildren(answer_panel(false, 'The answer is: ' + target_text, [next_el])); next_el.focus(); }
  shuffled(target_letters).forEach(letter_text => tiles_el.appendChild(el('button', {class: 'letter-tile', onclick: click_event => { click_event.target.disabled = true; built_tiles.push(click_event.target); draw_built(); if (built_tiles.length === target_letters.length) complete_word(); }}, letter_text)));
  draw_built();
  mode_frame(card_set, mode_item, [position_label()], [session_progress(), prompt_card(sides.prompt), built_el, tiles_el, el('div', {class: 'button-row'}, el('button', {onclick: () => { const last_tile = built_tiles.pop(); if (last_tile && !result_el.hasChildNodes()) { last_tile.disabled = false; draw_built(); } }}, '⌫ Undo'), el('button', {onclick: () => { if (!result_el.hasChildNodes()) finish(false); }}, 'Skip')), result_el]);
}
function speech_language(card_set) { const all_terms = card_set.cards.map(card_item => card_item.term).join(' '); return /[Ѐ-ӿ]/.test(all_terms) ? 'uk-UA' : /[éèêàçùôî]|\b(le|la|les|l')\s?/i.test(all_terms) ? 'fr-FR' : ''; }
function speak_text(card_set, spoken_text) { if (!window.speechSynthesis) return; speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(spoken_text), language_code = speech_language(card_set), matching_voice = speechSynthesis.getVoices().find(voice_item => voice_item.lang.replace('_', '-').toLowerCase().startsWith(language_code.slice(0, 2).toLowerCase())); if (language_code) utterance.lang = language_code; if (matching_voice) utterance.voice = matching_voice; speechSynthesis.speak(utterance); }
function ask_listen(card_set, mode_item, card_index, finish) {
  const card_item = card_set.cards[card_index], language_code = speech_language(card_set), voices_list = window.speechSynthesis ? speechSynthesis.getVoices() : [], has_voice = voices_list.some(voice_item => voice_item.lang.replace('_', '-').toLowerCase().startsWith(language_code.slice(0, 2).toLowerCase()));
  const speak_button = el('button', {class: 'speak-button', 'aria-label': 'Play the word', onclick: () => speak_text(card_set, card_item.term)}, '🔊 Play again');
  ask_type(card_set, mode_item, card_index, finish, {sides: {prompt: card_item.term, answer: card_item.definition}, prompt_node: el('div', {class: 'prompt-card'}, speak_button, !window.speechSynthesis || (voices_list.length && !has_voice) ? el('div', {class: 'muted'}, 'This device has no voice for this language, so here is the word: ' + card_item.term) : null)});
  later(() => speak_text(card_set, card_item.term), 150);
}

// ---- Modes ----
function view_vocab(card_set) {
  const hide_key = 'vocab-hide', hide_answers = !!view_vocab[hide_key], direction_name = direction_of(card_set) === 'definition' ? 'definition' : 'term', other_name = direction_name === 'term' ? 'definition' : 'term', mode_item = find_mode('vocab');
  const status_names = {new: 'New', learning: 'Learning', familiar: 'Familiar', mastered: 'Mastered'};
  const rows = card_set.cards.map((card_item, card_index) => { const status_name = card_item.term.trim() && card_item.definition.trim() ? card_status(card_set, card_index) : 'new', answer_el = el('div', {class: 'card-definition' + (hide_answers ? ' hidden-answer' : ''), onclick: click_event => click_event.currentTarget.classList.remove('hidden-answer')}, card_item[other_name]); return el('div', {class: 'card-row'}, el('div', {class: 'line-margin line-number'}), el('div', {}, el('span', {class: 'status-dot status-' + status_name, title: status_names[status_name]}), card_item[direction_name]), answer_el); });
  clear_mode_timers();
  render(mode_item.label, [el('a', {class: 'button', href: '#/set/' + card_set.id}, 'Done')], [
    el('div', {class: 'button-row'}, switch_buttons(['term', 'definition'], direction_name, new_direction => { card_set.front = new_direction; save_state(); view_vocab(card_set); }), el('button', {onclick: () => { view_vocab[hide_key] = !hide_answers; view_vocab(card_set); }}, hide_answers ? 'Show answers' : 'Hide answers'),
      el('span', {class: 'status-key muted'}, ...Object.keys(status_names).map(status_name => el('span', {}, el('span', {class: 'status-dot status-' + status_name}), status_names[status_name])))),
    el('div', {class: 'ruled'}, ...rows)]);
}
// Five cards at a time. Each goes from seeing it, to picking it, to typing it. A wrong answer repeats that step two cards later.
function view_learn(card_set, mode_item) {
  if (!study_session.steps) {
    const unmastered_cards = weakest_first(card_set, studyable_indexes(card_set).filter(card_index => card_status(card_set, card_index) !== 'mastered')), batch_cards = unmastered_cards.slice(0, 5);
    if (!batch_cards.length) { mode_frame(card_set, mode_item, ['All learned'], [el('div', {class: 'empty'}, el('h2', {class: 'summary-title'}, 'You have learned everything here'), el('div', {class: 'button-row center-row'}, el('a', {class: 'button primary', href: play_hash(card_set, 'revise')}, 'Revise')))]); return; }
    study_session.steps = batch_cards.map(card_index => ({card_index, stage: 0})); study_session.history = []; study_session.total_steps = study_session.steps.length * 3; study_session.done_steps = 0; study_session.batch_size = batch_cards.length;
  }
  if (!study_session.steps.length) { const left_count = studyable_indexes(card_set).filter(card_index => card_status(card_set, card_index) !== 'mastered').length; const reward_el = award_round(card_set, mode_item, study_session.right - study_session.batch_size * 3 + study_session.batch_size * 2, study_session.batch_size * 2 + study_session.wrong); mode_frame(card_set, mode_item, [study_session.batch_size + ' cards practised'], [el('div', {class: 'empty'}, el('h2', {class: 'summary-title'}, 'Batch finished'), reward_el, el('div', {class: 'button-row center-row'}, left_count ? el('button', {class: 'primary', onclick: () => { start_mode_session(card_set, 'learn', []); view_learn(card_set, mode_item); }}, 'Next cards') : null, el('a', {class: 'button', href: '#/set/' + card_set.id}, 'Back to set')))]); return; }
  const current_step = study_session.steps[0];
  // Back undoes the last step, including what it did to the card's progress. Forward moves on without marking the card either way.
  function remember_step() { const card_key_text = card_key(card_set.cards[current_step.card_index]); study_session.history.push({steps: study_session.steps.map(step_item => Object.assign({}, step_item)), right: study_session.right, wrong: study_session.wrong, done_steps: study_session.done_steps, card_key_text, record: (card_set.progress || {})[card_key_text]}); }
  function go_back() { const last_step = study_session.history.pop(); if (!last_step) return; Object.assign(study_session, {steps: last_step.steps, right: last_step.right, wrong: last_step.wrong, done_steps: last_step.done_steps}); if (card_set.progress) { if (last_step.record) card_set.progress[last_step.card_key_text] = last_step.record; else delete card_set.progress[last_step.card_key_text]; } save_state(); view_learn(card_set, mode_item); }
  function finish_step(is_right) {
    remember_step(); study_session.steps.shift();
    if (is_right) { study_session.right++; study_session.done_steps++; current_step.stage++; if (current_step.stage < 3) study_session.steps.splice(Math.min(2, study_session.steps.length), 0, current_step); else record_answer(card_set, current_step.card_index, true); }
    else { study_session.wrong++; record_answer(card_set, current_step.card_index, false); study_session.steps.splice(Math.min(2, study_session.steps.length), 0, current_step); }
    view_learn(card_set, mode_item);
  }
  function go_forward() { remember_step(); study_session.steps.shift(); study_session.steps.splice(Math.min(2, study_session.steps.length), 0, current_step); view_learn(card_set, mode_item); }
  function nav_row(forward_button) { return el('div', {class: 'learn-nav'}, el('button', Object.assign({'data-key': 'ArrowLeft', onclick: go_back}, study_session.history.length ? {} : {disabled: 'disabled'}), '← Back'), forward_button); }
  study_session.position = study_session.done_steps; study_session.queue = {length: study_session.total_steps};
  const status_text = 'Step ' + (study_session.done_steps + 1) + ' of ' + study_session.total_steps;
  if (current_step.stage === 0) { const pair_sides = card_sides(card_set, current_step.card_index), got_it_el = el('button', {class: 'primary', 'data-key': 'ArrowRight', onclick: () => finish_step(true)}, 'Got it →'); mode_frame(card_set, Object.assign({}, mode_item, {how: 'Have a good look, then press Got it.'}), [status_text], [session_progress(), pair_card(pair_sides.front_key, pair_sides.prompt, pair_sides.answer), nav_row(got_it_el)]); return; }
  const question_nav = nav_row(el('button', Object.assign({'data-key': 'ArrowRight', title: 'Come back to this one later', onclick: go_forward}, study_session.steps.length > 1 ? {} : {disabled: 'disabled'}), 'Forward →'));
  if (current_step.stage === 1 && studyable_indexes(card_set).length > 1) ask_choice(card_set, mode_item, current_step.card_index, finish_step, {status: status_text, footer: question_nav}); else if (current_step.stage === 1) finish_step(true); else ask_type(card_set, mode_item, current_step.card_index, finish_step, {status: status_text, footer: question_nav});
}
function view_revise_start(card_set) {
  const due_list = weakest_first(card_set, due_indexes(card_set)), mode_item = find_mode('revise');
  if (!due_list.length) {
    const upcoming_dates = studyable_indexes(card_set).map(card_index => card_record(card_set, card_index)).filter(Boolean).map(record_item => record_item.due);
    mode_frame(card_set, mode_item, ['Nothing due'], [el('div', {class: 'empty'}, el('h2', {class: 'summary-title'}, 'Nothing to revise yet'), el('div', {class: 'muted'}, upcoming_dates.length ? 'The next card comes due ' + relative_future(Math.min(...upcoming_dates)) + '.' : 'Cards appear here once you have practised them.'), el('div', {class: 'button-row center-row'}, upcoming_dates.length ? el('button', {class: 'primary', onclick: () => { start_session(card_set, weakest_first(card_set, studyable_indexes(card_set).filter(card_index => card_record(card_set, card_index))), 'revise'); view_study(card_set); }}, 'Revise everything anyway') : el('a', {class: 'button primary', href: play_hash(card_set, 'learn')}, 'Learn from scratch')))]);
    return;
  }
  start_session(card_set, due_list, 'revise'); view_study(card_set);
}
function relative_future(time_ms) { const days_ahead = Math.ceil((time_ms - Date.now()) / DAY_MS); return days_ahead <= 1 ? 'tomorrow' : 'in ' + days_ahead + ' days'; }
function svg_el(tag_name, attributes) { const node_el = document.createElementNS('http://www.w3.org/2000/svg', tag_name); Object.keys(attributes).forEach(attr_name => node_el.setAttribute(attr_name, attributes[attr_name])); return node_el; }
function view_wheel(card_set, mode_item) {
  if (!study_session.wheel_cards) { study_session.wheel_cards = weakest_first(card_set, studyable_indexes(card_set)).slice(0, 10); study_session.turn = 0; study_session.spin_angle = 0; }
  const wheel_cards = study_session.wheel_cards, slice_angle = 360 / wheel_cards.length, wheel_svg = svg_el('svg', {viewBox: '-110 -110 220 220', class: 'wheel-disc', role: 'img', 'aria-label': 'Word wheel'});
  wheel_cards.forEach((card_index, slice_index) => {
    const start_radians = (slice_index * slice_angle - 90) * Math.PI / 180, end_radians = ((slice_index + 1) * slice_angle - 90) * Math.PI / 180, large_arc = slice_angle > 180 ? 1 : 0, label_angle = slice_index * slice_angle + slice_angle / 2 - 90, sides = card_sides(card_set, card_index), label_text = sides.prompt.length > 13 ? sides.prompt.slice(0, 12) + '…' : sides.prompt;
    wheel_svg.appendChild(wheel_cards.length === 1 ? svg_el('circle', {r: 100, fill: TINTS[0][1]}) : svg_el('path', {d: 'M0 0L' + 100 * Math.cos(start_radians) + ' ' + 100 * Math.sin(start_radians) + 'A100 100 0 ' + large_arc + ' 1 ' + 100 * Math.cos(end_radians) + ' ' + 100 * Math.sin(end_radians) + 'Z', fill: TINTS[slice_index % TINTS.length][1], stroke: '#fff', 'stroke-width': 1}));
    const reads_backwards = Math.cos(label_angle * Math.PI / 180) < 0, label_el = svg_el('text', {transform: 'rotate(' + label_angle + ') translate(94 0)' + (reads_backwards ? ' rotate(180)' : ''), 'text-anchor': reads_backwards ? 'start' : 'end', 'dominant-baseline': 'middle', 'font-size': 10, fill: '#1f2937'}); label_el.textContent = label_text; wheel_svg.appendChild(label_el);
  });
  wheel_svg.style.transform = 'rotate(' + study_session.spin_angle + 'deg)';
  study_session.queue = {length: 1}; study_session.position = 0;
  // Kept on the session, so changing direction redraws this word rather than going back to the wheel.
  if (study_session.landed) {
    const landed_card = study_session.landed.card_index, landed_slice = study_session.landed.picked_slice;
    return ask_type(card_set, mode_item, landed_card, is_right => {
      record_answer(card_set, landed_card, is_right); if (is_right) { study_session.right++; study_session.spin_right = (study_session.spin_right || 0) + 1; } else study_session.wrong++; study_session.turn++; study_session.landed = null; study_session.round_reward = null;
      if (study_session.turn % 5 === 0) { study_session.spin_reward = award_round(card_set, mode_item, study_session.spin_right || 0, 5); study_session.spin_right = 0; } else study_session.spin_reward = '';
      const replacement_cards = weakest_first(card_set, studyable_indexes(card_set).filter(other_index => !wheel_cards.includes(other_index))); if (is_right && replacement_cards.length) wheel_cards[landed_slice] = replacement_cards[0];
      view_wheel(card_set, mode_item);
    }, {status: 'Landed on this word'});
  }
  const spin_button = el('button', {class: 'primary spin-button', 'data-key': 'Enter', onclick: () => {
    spin_button.disabled = true;
    const picked_slice = Math.floor(Math.random() * wheel_cards.length), slice_offset = (Math.random() * 0.7 + 0.15) * slice_angle, landing_angle = 360 - (picked_slice * slice_angle + slice_offset);
    study_session.spin_angle = study_session.spin_angle - (study_session.spin_angle % 360) + 360 * 5 + landing_angle;
    wheel_svg.style.transform = 'rotate(' + study_session.spin_angle + 'deg)';
    later(() => { study_session.landed = {card_index: wheel_cards[picked_slice], picked_slice}; view_wheel(card_set, mode_item); }, 3300);
  }}, 'Spin');
  mode_frame(card_set, mode_item, [study_session.right + ' right · ' + study_session.wrong + ' wrong'], [study_session.spin_reward || '', el('div', {class: 'wheel-holder'}, el('div', {class: 'wheel-pointer'}), wheel_svg), spin_button]);
}
function view_match(card_set, mode_item) {
  study_session.round_reward = null;
  const round_cards = weakest_first(card_set, studyable_indexes(card_set)).slice(0, 6), started_ms = Date.now(); let picked_tile = null, left_count = round_cards.length, wrong_tries = 0;
  const clock_el = el('span', {}, '0s'); function tick() { clock_el.textContent = Math.round((Date.now() - started_ms) / 1000) + 's'; later(tick, 500); }
  function make_tile(card_index, side_key) { return el('button', {class: 'match-tile', onclick: click_event => {
    const tile_el = click_event.currentTarget;
    if (!picked_tile) { picked_tile = tile_el; tile_el.classList.add('is-picked'); tile_el.dataset.card = card_index; return; }
    if (picked_tile === tile_el) { tile_el.classList.remove('is-picked'); picked_tile = null; return; }
    const is_pair = Number(picked_tile.dataset.card) === card_index && picked_tile.dataset.side !== tile_el.dataset.side, first_tile = picked_tile; picked_tile = null; first_tile.classList.remove('is-picked');
    if (is_pair) { first_tile.classList.add('is-matched'); tile_el.classList.add('is-matched'); first_tile.disabled = true; tile_el.disabled = true; left_count--; if (!left_count) { const seconds_taken = Math.round((Date.now() - started_ms) / 1000); card_set.last_studied = Date.now(); save_state(); clear_mode_timers(); const reward_el = award_round(card_set, mode_item, round_cards.length, round_cards.length + wrong_tries); grid_el.after(reward_el, el('div', {class: 'answer-panel is-right', role: 'status'}, el('strong', {}, 'All matched in ' + seconds_taken + ' seconds'), el('div', {}, wrong_tries + ' wrong tries'), el('button', {class: 'primary', onclick: () => view_match(card_set, mode_item)}, 'Play again'))); } }
    else { wrong_tries++; first_tile.classList.add('is-miss'); tile_el.classList.add('is-miss'); setTimeout(() => { first_tile.classList.remove('is-miss'); tile_el.classList.remove('is-miss'); }, 450); }
  }}, card_set.cards[card_index][side_key]); }
  const all_tiles = shuffled(round_cards.flatMap(card_index => { const term_tile = make_tile(card_index, 'term'), definition_tile = make_tile(card_index, 'definition'); term_tile.dataset.side = 'term'; term_tile.dataset.card = card_index; definition_tile.dataset.side = 'definition'; definition_tile.dataset.card = card_index; return [term_tile, definition_tile]; }));
  const grid_el = el('div', {class: 'match-grid'}, ...all_tiles);
  mode_frame(card_set, mode_item, ['Time: ', clock_el], [grid_el]);
  tick();
}
function view_memory(card_set, mode_item) {
  study_session.round_reward = null;
  const round_cards = weakest_first(card_set, studyable_indexes(card_set)).slice(0, 6); let turned_tiles = [], left_count = round_cards.length, turn_count = 0, is_waiting = false;
  const turns_el = el('span', {}, '0 turns');
  const all_tiles = shuffled(round_cards.flatMap(card_index => ['term', 'definition'].map(side_key => { const tile_el = el('button', {class: 'memory-tile', 'aria-label': 'Hidden card', onclick: () => {
    if (is_waiting || tile_el.classList.contains('is-up')) return;
    tile_el.classList.add('is-up'); tile_el.textContent = card_set.cards[card_index][side_key]; turned_tiles.push({tile_el, card_index});
    if (turned_tiles.length < 2) return;
    turn_count++; turns_el.textContent = turn_count + ' turns';
    const first_turned = turned_tiles[0], second_turned = turned_tiles[1]; turned_tiles = [];
    if (first_turned.card_index === second_turned.card_index) { first_turned.tile_el.classList.add('is-matched'); second_turned.tile_el.classList.add('is-matched'); left_count--; if (!left_count) { card_set.last_studied = Date.now(); save_state(); const reward_el = award_round(card_set, mode_item, round_cards.length, Math.max(turn_count, round_cards.length)); grid_el.after(reward_el, el('div', {class: 'answer-panel is-right', role: 'status'}, el('strong', {}, 'All found in ' + turn_count + ' turns'), el('button', {class: 'primary', onclick: () => view_memory(card_set, mode_item)}, 'Play again'))); } return; }
    is_waiting = true; later(() => { [first_turned, second_turned].forEach(turned_item => { turned_item.tile_el.classList.remove('is-up'); turned_item.tile_el.textContent = ''; }); is_waiting = false; }, 1100);
  }}); return tile_el; })));
  const grid_el = el('div', {class: 'memory-grid'}, ...all_tiles);
  mode_frame(card_set, mode_item, [turns_el], [grid_el]);
}
function view_speed(card_set, mode_item) {
  if (!study_session.ends_at) { study_session.ends_at = Date.now() + 60000; study_session.queue = weakest_first(card_set, studyable_indexes(card_set)); }
  function next_speed_question() {
    if (Date.now() >= study_session.ends_at) return finish_speed();
    if (study_session.position >= study_session.queue.length) { study_session.queue = weakest_first(card_set, studyable_indexes(card_set)); study_session.position = 0; }
    const card_index = study_session.queue[study_session.position], timer_fill = el('div', {style: 'width:' + 100 * (study_session.ends_at - Date.now()) / 60000 + '%'}), timer_el = el('div', {class: 'progress speed-timer'}, timer_fill), seconds_el = el('span', {});
    function show_time() { const left_ms = study_session.ends_at - Date.now(); if (left_ms <= 0) return finish_speed(); seconds_el.textContent = Math.ceil(left_ms / 1000) + 's left · ' + study_session.right + ' right'; timer_fill.style.width = 100 * left_ms / 60000 + '%'; later(show_time, 250); }
    ask_choice(card_set, mode_item, card_index, is_right => { record_answer(card_set, card_index, is_right); if (is_right) study_session.right++; else study_session.wrong++; study_session.position++; next_speed_question(); }, {quick: true, status: seconds_el, top_node: timer_el});
    show_time();
  }
  function finish_speed() { clear_mode_timers(); const reward_el = award_round(card_set, mode_item, study_session.right, Math.max(1, study_session.right + study_session.wrong)), is_record = study_session.right > (card_set.best_speed || 0); if (is_record) { card_set.best_speed = study_session.right; save_state(); } mode_frame(card_set, Object.assign({}, mode_item, {how: null}), ['Time up'], [el('div', {class: 'empty'}, el('h2', {class: 'summary-title'}, study_session.right + ' right in 60 seconds'), reward_el, el('div', {class: 'muted'}, is_record ? 'Your new best.' : 'Your best is ' + card_set.best_speed + '.'), el('div', {class: 'button-row center-row'}, el('button', {class: 'primary', onclick: () => { start_mode_session(card_set, 'speed', []); view_speed(card_set, mode_item); }}, 'Play again')))]); }
  next_speed_question();
}
function view_test(card_set, mode_item) {
  if (!study_session.test_ready) { study_session.test_ready = true; study_session.queue = weakest_first(card_set, studyable_indexes(card_set)).slice(0, 10); }
  if (study_session.position >= study_session.queue.length) return view_mode_summary(card_set, mode_item);
  const card_index = study_session.queue[study_session.position], can_choose = studyable_indexes(card_set).length > 1 && study_session.position % 2 === 0, status_text = position_label();
  function finish(is_right) { record_answer(card_set, card_index, is_right); if (is_right) study_session.right++; else { study_session.wrong++; study_session.missed.push(card_index); } study_session.position++; view_test(card_set, mode_item); }
  if (can_choose) ask_choice(card_set, mode_item, card_index, finish, {quick: true, status: status_text}); else ask_type(card_set, mode_item, card_index, finish, {status: status_text});
}
function view_mode_summary(card_set, mode_item) {
  const missed_cards = Array.from(new Set(study_session.missed)), total_count = study_session.right + study_session.wrong, score_percent = total_count ? Math.round(100 * study_session.right / total_count) : 0;
  const reward_el = award_round(card_set, mode_item, study_session.right, total_count);
  mode_frame(card_set, Object.assign({}, mode_item, {how: null}), ['Finished'], [el('div', {class: 'empty summary'}, el('h2', {class: 'summary-title'}, score_percent + '%'), reward_el, el('div', {class: 'counts summary-counts'}, el('span', {class: 'know'}, study_session.right + ' right'), el('span', {class: 'learn'}, study_session.wrong + ' wrong')),
    missed_cards.length ? el('div', {class: 'ruled missed-list'}, ...missed_cards.map(card_index => el('div', {class: 'card-row'}, el('div', {class: 'line-margin line-number'}), el('div', {}, card_set.cards[card_index].term), el('div', {class: 'card-definition'}, card_set.cards[card_index].definition)))) : null,
    el('div', {class: 'button-row center-row'}, missed_cards.length ? el('button', {class: 'primary', onclick: () => { start_mode_session(card_set, mode_item.key, missed_cards); if (mode_item.key === 'test') study_session.test_ready = true; view_mode(card_set, mode_item.key); }}, 'Try the ' + missed_cards.length + ' you missed') : null, el('button', {onclick: () => { study_session = null; view_mode(card_set, mode_item.key); }}, 'Play again')))]);
}
const QUESTION_ASKERS = {type: ask_type, choice: ask_choice, truefalse: ask_true_false, scramble: ask_scramble, listen: ask_listen};
function view_mode(card_set, mode_key) {
  const mode_item = find_mode(mode_key) || find_mode('cards');
  if (studyable_indexes(card_set).length < mode_item.min_cards) { location.hash = '#/set/' + card_set.id; return; }
  if (mode_item.key === 'vocab') return view_vocab(card_set);
  if (mode_item.key === 'cards' || mode_item.key === 'revise') { if (study_session && study_session.set_id === card_set.id && study_session.mode === mode_item.key) return view_study(card_set); if (mode_item.key === 'revise') return view_revise_start(card_set); start_session(card_set, app_state.shuffle ? weakest_first(card_set, studyable_indexes(card_set)) : studyable_indexes(card_set), 'cards'); return view_study(card_set); }
  const is_new_session = !study_session || study_session.set_id !== card_set.id || study_session.mode !== mode_item.key;
  if (is_new_session) start_mode_session(card_set, mode_item.key, QUESTION_ASKERS[mode_item.key] ? weakest_first(card_set, studyable_indexes(card_set)) : []);
  if (QUESTION_ASKERS[mode_item.key]) return run_questions(card_set, mode_item, QUESTION_ASKERS[mode_item.key]);
  ({learn: view_learn, wheel: view_wheel, match: view_match, memory: view_memory, speed: view_speed, test: view_test})[mode_item.key](card_set, mode_item);
}

// ---- Rewards: every finished round earns one for that set's trophy shelf. The better the round, the better the reward. Wording stays general, so it suits any subject. ----
const REWARD_TIERS = [
  {from_percent: 100, lead: 'Perfect round!', rewards: [['trophy', 'You have won a trophy.'], ['gold', 'You have won a gold medal.'], ['gem', 'You have won a gem.'], ['glowing-star', 'You have won a shining star.']]},
  {from_percent: 90, lead: 'Excellent work!', rewards: [['silver', 'You have won a silver medal.'], ['star', 'You have won a star.'], ['rocket', 'You have won a rocket.'], ['rainbow', 'You have won a rainbow.'], ['gift', 'You have won a present.']]},
  {from_percent: 70, lead: 'Great progress!', rewards: [['bronze', 'You have won a bronze medal.'], ['cake', 'Here is a slice of cake.'], ['icecream', 'Here is an ice cream.'], ['sunflower', 'Here is a sunflower.'], ['balloon', 'Here is a balloon.'], ['ribbon', 'Here is a ribbon.']]},
  {from_percent: 50, lead: 'Good progress!', rewards: [['cherries', 'Here are some cherries.'], ['strawberry', 'Here is a strawberry.'], ['doughnut', 'Here is a doughnut.'], ['honey', 'Here is a pot of honey.']]},
  {from_percent: 0, lead: 'Good effort!', rewards: [['cookie', 'Here is a cookie.'], ['apple', 'Here is an apple.'], ['pear', 'Here is a pear.'], ['clover', 'Here is a lucky clover.']]}
];
const SET_GOALS = [
  {key: 'learned', image: 'crown', line: 'Great progress! You know every card in this set well, so you have won a crown.', is_met: counts => !counts.new && !counts.learning},
  {key: 'mastered', image: 'gem', line: 'Amazing! You have mastered every card in this set, so you have won a gem.', is_met: counts => !counts.new && !counts.learning && !counts.familiar}
];
function reward_image(image_name, image_class) { return el('img', {class: image_class, src: 'assets/rewards/' + image_name + '.svg', alt: '', width: 48, height: 48}); }
function pick_reward(reward_tier) { const recent_images = (app_state.recent_rewards || []).slice(-3), fresh_rewards = reward_tier.rewards.filter(reward_item => !recent_images.includes(reward_item[0])), usable_rewards = fresh_rewards.length ? fresh_rewards : reward_tier.rewards, picked_reward = usable_rewards[Math.floor(Math.random() * usable_rewards.length)]; app_state.recent_rewards = recent_images.concat(picked_reward[0]); return picked_reward; }
// Adds the round's reward to the shelf and returns the card to show. A round only earns one, however many times its screen is drawn.
function award_round(card_set, mode_item, right_count, total_count) {
  if (study_session.round_reward !== undefined && study_session.round_reward !== null) return study_session.round_reward;
  if (total_count < Math.min(3, studyable_indexes(card_set).length)) return '';
  const score_percent = Math.round(100 * right_count / total_count), reward_tier = REWARD_TIERS.find(tier_item => score_percent >= tier_item.from_percent), picked_reward = pick_reward(reward_tier), line_text = reward_tier.lead + ' ' + picked_reward[1], now_ms = Date.now();
  card_set.trophies = card_set.trophies || [];
  card_set.trophies.push({image: picked_reward[0], line: line_text, mode: mode_item.label, right: right_count, total: total_count, at: now_ms});
  const reached_goals = SET_GOALS.filter(goal_item => goal_item.is_met(progress_counts(card_set)) && !card_set.trophies.some(trophy_item => trophy_item.goal === goal_item.key));
  reached_goals.forEach(goal_item => card_set.trophies.push({image: goal_item.image, line: goal_item.line, goal: goal_item.key, mode: mode_item.label, at: now_ms}));
  save_state();
  const reward_el = el('div', {class: 'reward-card', role: 'status'}, reward_image(picked_reward[0], 'reward-image'), el('div', {}, el('strong', {}, line_text), el('div', {class: 'muted'}, right_count + ' of ' + total_count + ' right. Added to your trophy shelf.')), ...reached_goals.map(goal_item => el('div', {class: 'reward-goal'}, reward_image(goal_item.image, 'reward-image'), el('strong', {}, goal_item.line))));
  study_session.round_reward = reward_el; later(() => spawn_confetti(reward_el), 60);
  return reward_el;
}
function spawn_confetti(anchor_el) {
  if (!anchor_el.isConnected || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const burst_el = el('div', {class: 'confetti-burst', 'aria-hidden': 'true'});
  for (let piece_index = 0; piece_index < 26; piece_index++) burst_el.appendChild(el('i', {style: 'background:' + TINTS[piece_index % TINTS.length][1] + ';--fly-x:' + Math.round(Math.random() * 320 - 160) + 'px;--fly-y:' + Math.round(-60 - Math.random() * 140) + 'px;--spin:' + Math.round(Math.random() * 720 - 360) + 'deg;animation-delay:' + Math.round(Math.random() * 120) + 'ms'}));
  anchor_el.appendChild(burst_el); setTimeout(() => burst_el.remove(), 1500);
}
function trophy_shelf(card_set) {
  const trophy_list = (card_set.trophies || []).slice().reverse(), detail_el = el('div', {class: 'shelf-detail', role: 'status'}); detail_el.hidden = true;
  function trophy_button(trophy_item) { const button_el = el('button', {class: 'shelf-item', title: trophy_item.line, 'aria-label': trophy_item.line, onclick: () => { const is_same = button_el.classList.contains('is-active'); shelf_el.querySelectorAll('.is-active').forEach(active_el => active_el.classList.remove('is-active')); detail_el.hidden = is_same; if (is_same) return; button_el.classList.add('is-active'); detail_el.replaceChildren(el('strong', {}, trophy_item.line), el('div', {class: 'muted'}, trophy_item.mode + (trophy_item.total ? ' · ' + trophy_item.right + ' of ' + trophy_item.total + ' right' : '') + ' · ' + relative_day(trophy_item.at))); }}, reward_image(trophy_item.image, 'shelf-image')); return button_el; }
  const shelf_el = el('div', {class: 'shelf-row'}, ...(trophy_list.length ? trophy_list.map(trophy_button) : [el('span', {class: 'shelf-item is-empty'}, reward_image('hourglass', 'shelf-image')), el('span', {class: 'muted shelf-empty'}, 'Finish a round in any mode to win your first reward.')]));
  return el('section', {class: 'trophy-shelf'}, el('h2', {class: 'list-heading'}, 'Trophy shelf', trophy_list.length ? el('span', {class: 'muted shelf-count'}, ' ' + trophy_list.length) : ''), shelf_el, detail_el);
}
