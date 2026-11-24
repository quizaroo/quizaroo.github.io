// Set languages and the on-screen keyboard for typed answers.
// Each language: its name, its own name, a speech voice, a whole keyboard (rows), the letters an English keyboard lacks (extras), letters only it uses (marks) and common words, both used to spot it.
const LANGUAGES = {
  cs: {name: 'Czech', native: 'Čeština', speech: 'cs-CZ', rows: ['qwertzuiop', 'asdfghjkl', 'yxcvbnm'], extras: 'áčďéěíňóřšťúůýž', marks: 'čďěňřťů', words: 'a je se na to že v ne jsem jak co ale'},
  da: {name: 'Danish', native: 'Dansk', speech: 'da-DK', rows: ['qwertyuiopå', 'asdfghjklæø', 'zxcvbnm'], extras: 'æøå', marks: 'æø', words: 'og jeg det er en at til af hvad ikke hvor du'},
  nl: {name: 'Dutch', native: 'Nederlands', speech: 'nl-NL', rows: ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'], extras: 'éëïóöü', marks: '', words: 'de het een en van ik je niet dat is zijn wat'},
  en: {name: 'English', native: 'English', speech: 'en-GB', rows: ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'], extras: '', marks: '', words: 'the a an to of and is you it in what how my this that be with for'},
  fr: {name: 'French', native: 'Français', speech: 'fr-FR', rows: ['azertyuiop', 'qsdfghjklm', 'wxcvbn'], extras: 'éèêëàâçîïôûùüÿœæ', marks: 'œêëîïûÿè', words: "le la les l' un une des du de et je tu il elle est sont avec pour"},
  de: {name: 'German', native: 'Deutsch', speech: 'de-DE', rows: ['qwertzuiopü', 'asdfghjklöä', 'yxcvbnmß'], extras: 'äöüß', marks: 'ß', words: 'der die das ein eine und ich du ist nicht mit zu auf sie'},
  it: {name: 'Italian', native: 'Italiano', speech: 'it-IT', rows: ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'], extras: 'àèéìòù', marks: 'ìò', words: "il lo la gli le un una di che è non per sono io"},
  nb: {name: 'Norwegian', native: 'Norsk', speech: 'nb-NO', rows: ['qwertyuiopå', 'asdfghjkløæ', 'zxcvbnm'], extras: 'æøå', marks: 'æø', words: 'og jeg det er en et å av hva ikke hvor du'},
  pl: {name: 'Polish', native: 'Polski', speech: 'pl-PL', rows: ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'], extras: 'ąćęłńóśźż', marks: 'ąćęłńśźż', words: 'i w nie się na to jest że z do jak co'},
  pt: {name: 'Portuguese', native: 'Português', speech: 'pt-PT', rows: ['qwertyuiop', 'asdfghjklç', 'zxcvbnm'], extras: 'áâãàçéêíóôõú', marks: 'ãõ', words: 'o a os as um uma de do da que não eu você é'},
  es: {name: 'Spanish', native: 'Español', speech: 'es-ES', rows: ['qwertyuiop', 'asdfghjklñ', 'zxcvbnm'], extras: 'áéíóúñü¿¡', marks: 'ñ¿¡', words: 'el la los las un una de del y que no yo es por con'},
  sv: {name: 'Swedish', native: 'Svenska', speech: 'sv-SE', rows: ['qwertyuiopå', 'asdfghjklöä', 'zxcvbnm'], extras: 'åäö', marks: 'å', words: 'och jag det är en ett att inte vad hur du på'},
  tr: {name: 'Turkish', native: 'Türkçe', speech: 'tr-TR', rows: ['qwertyuıopğü', 'asdfghjklşi', 'zxcvbnmöç'], extras: 'çğıöşü', marks: 'ğış', words: 'bir ve bu da de ne ben sen değil çok var'},
  uk: {name: 'Ukrainian', native: 'Українська', speech: 'uk-UA', rows: ['йцукенгшщзхї', 'фівапролджє', 'ґячсмитьбю\''], extras: '', marks: 'іїєґ', words: 'і в на не що я ти це як та з до', cyrillic: true}
};
// Where each Ukrainian key sits on a computer keyboard, so typing on an English keyboard gives the Ukrainian letter in that place.
const UK_KEY_CODES = [['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight'], ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote'], ['Backslash', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Backquote']];
const UK_BY_CODE = {}; UK_KEY_CODES.forEach((code_row, row_index) => code_row.forEach((key_code, key_index) => { UK_BY_CODE[key_code] = Array.from(LANGUAGES.uk.rows[row_index])[key_index]; }));
UK_BY_CODE.IntlBackslash = 'ґ';
const US_KEY_LABELS = {BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Backslash: '\\', Comma: ',', Period: '.', Backquote: '`'};
let layout_map = null;
if (navigator.keyboard && navigator.keyboard.getLayoutMap) navigator.keyboard.getLayoutMap().then(found_map => { layout_map = found_map; }).catch(() => {});
function physical_label(key_code) { const mapped_label = layout_map && layout_map.get(key_code); return mapped_label || US_KEY_LABELS[key_code] || key_code.replace('Key', '').toLowerCase(); }

// Spots a language from one side of a set, on this device: the alphabet first, then letters only one language uses, then everyday words like "le" or "der".
function guess_language(side_text) {
  const letter_list = side_text.normalize('NFC').toLowerCase().match(/\p{L}/gu) || [];
  if (letter_list.length < 3) return null;
  const cyrillic_count = letter_list.filter(letter_text => /\p{Script=Cyrillic}/u.test(letter_text)).length, latin_count = letter_list.filter(letter_text => /\p{Script=Latin}/u.test(letter_text)).length;
  if (cyrillic_count > letter_list.length / 2) return 'uk';
  if (latin_count < letter_list.length / 2) return null;
  const word_counts = new Map(); side_text.toLowerCase().split(/[^\p{L}']+/u).forEach(word_text => { if (word_text) word_counts.set(word_text, (word_counts.get(word_text) || 0) + 1); if (/^l'/.test(word_text)) word_counts.set("l'", (word_counts.get("l'") || 0) + 1); });
  const letter_counts = new Map(); letter_list.forEach(letter_text => letter_counts.set(letter_text, (letter_counts.get(letter_text) || 0) + 1));
  const accented_count = letter_list.filter(letter_text => !/[a-z]/.test(letter_text)).length;
  let best_code = null, best_score = 1.5;
  Object.keys(LANGUAGES).forEach(language_code => {
    const language_item = LANGUAGES[language_code]; if (language_item.cyrillic) return;
    let language_score = 0;
    Array.from(language_item.marks).forEach(mark_text => { language_score += 3 * (letter_counts.get(mark_text) || 0); });
    Array.from(language_item.extras).forEach(extra_text => { language_score += letter_counts.get(extra_text) || 0; });
    language_item.words.split(' ').forEach(word_text => { language_score += 2 * (word_counts.get(word_text) || 0); });
    if (language_code === 'en' && !accented_count) language_score += 1;
    if (language_score > best_score) { best_score = language_score; best_code = language_code; }
  });
  return best_code;
}
// The language of each side. A language picked for the set goes on the side that isn't English; the other side keeps its guess.
function set_languages(card_set) {
  const guessed = {term: guess_language(card_set.cards.map(card_item => card_item.term).join('\n')), definition: guess_language(card_set.cards.map(card_item => card_item.definition).join('\n'))};
  if (!LANGUAGES[card_set.language]) return guessed;
  const picked_side = guessed.term === card_set.language ? 'term' : guessed.definition === card_set.language ? 'definition' : guessed.term === 'en' && guessed.definition !== 'en' ? 'definition' : 'term';
  guessed[picked_side] = card_set.language;
  return guessed;
}
// The language being learnt: the side that isn't English, else the term side.
function studied_language(card_set) { const side_languages = set_languages(card_set); return side_languages.term && side_languages.term !== 'en' ? side_languages.term : side_languages.definition && side_languages.definition !== 'en' ? side_languages.definition : side_languages.term; }

// Language sheet: Auto (shows what it found) or a language, for one set or several. Each line shows a few of its letters.
function open_language_sheet(chosen_sets, on_done) {
  const dialog_el = el('dialog', {class: 'whatsnew-sheet language-sheet'}), all_picked = chosen_sets.map(card_set => card_set.language || ''), same_pick = all_picked.every(picked_code => picked_code === all_picked[0]) ? all_picked[0] : null;
  const auto_found = chosen_sets.length === 1 ? (() => { const found_code = studied_language(Object.assign({}, chosen_sets[0], {language: undefined})); return found_code ? LANGUAGES[found_code].name : 'Nothing found'; })() : 'Each set\'s own';
  function language_line(language_code, line_label, line_note, sample_text) { return el('label', {class: 'merge-line language-line'}, el('input', {type: 'radio', name: 'set-language', value: language_code, checked: same_pick === language_code, onchange: () => pick(language_code)}), el('span', {class: 'merge-name'}, line_label), line_note ? el('span', {class: 'muted'}, line_note) : null, sample_text ? el('span', {class: 'language-sample', lang: language_code}, sample_text) : null); }
  const sample_of = language_code => { const language_item = LANGUAGES[language_code]; return language_item.cyrillic ? language_item.rows[0].slice(0, 6) : language_item.extras.slice(0, 6); };
  const keyboard_list = [['extra', 'Extra letters'], ['whole', 'Whole keyboard'], ['off', 'Off']];
  const keyboard_buttons = keyboard_list.map(([mode_value, mode_label]) => el('button', {'aria-pressed': String((app_state.keyboard_mode || 'extra') === mode_value), onclick: () => { app_state.keyboard_mode = mode_value; save_state(); keyboard_buttons.forEach((button_el, button_index) => button_el.setAttribute('aria-pressed', String(keyboard_list[button_index][0] === mode_value))); }}, mode_label));
  dialog_el.append(el('div', {class: 'whatsnew-head'}, el('h2', {}, 'Language'), el('button', {onclick: () => dialog_el.close()}, 'Cancel')),
    el('div', {class: 'muted merge-label'}, 'On-screen keyboard'), el('div', {class: 'sound-levels language-keyboard', role: 'group', 'aria-label': 'On-screen keyboard'}, ...keyboard_buttons),
    el('div', {class: 'merge-lines'}, language_line('', 'Auto', auto_found), ...Object.keys(LANGUAGES).map(language_code => language_line(language_code, LANGUAGES[language_code].name, LANGUAGES[language_code].native !== LANGUAGES[language_code].name ? LANGUAGES[language_code].native : '', sample_of(language_code)))));
  dialog_el.addEventListener('close', () => dialog_el.remove());
  document.body.appendChild(dialog_el); dialog_el.showModal();
  function pick(language_code) {
    const before_list = chosen_sets.map(card_set => card_set.language);
    chosen_sets.forEach(card_set => { if (language_code) card_set.language = language_code; else delete card_set.language; });
    save_state(); dialog_el.close(); if (on_done) on_done(); route();
    toast((language_code ? LANGUAGES[language_code].name : 'Auto') + (chosen_sets.length > 1 ? ' for ' + chosen_sets.length + ' sets' : ''), {action: 'Undo', ms: 6000, on_action: () => { chosen_sets.forEach((card_set, set_index) => { if (before_list[set_index]) card_set.language = before_list[set_index]; else delete card_set.language; }); save_state(); route(); }});
  }
}

// On-screen keyboard under a typed answer. Extra letters: just the letters an English keyboard lacks. Whole keyboard: the country's layout. Ukrainian is always the whole keyboard.
// It can be folded away to a small button; that is remembered on this device for each language. On a phone a whole keyboard stands in for the phone's own, which ⌨ brings back.
const KEYBOARD_FOLD_KEY = 'open-flashcards:keyboard-folded';
function folded_languages() { try { return JSON.parse(localStorage.getItem(KEYBOARD_FOLD_KEY)) || {}; } catch (storage_err) { return {}; } }
function save_folded(language_code, is_folded) { const folded_map = folded_languages(); if (is_folded) folded_map[language_code] = 1; else delete folded_map[language_code]; try { localStorage.setItem(KEYBOARD_FOLD_KEY, JSON.stringify(folded_map)); } catch (storage_err) {} }
function answer_keyboard(card_set, answer_side, input_el) {
  const keyboard_mode = app_state.keyboard_mode || 'extra', language_code = set_languages(card_set)[answer_side], language_item = LANGUAGES[language_code];
  if (keyboard_mode === 'off' || !language_item) return null;
  const is_whole = language_item.cyrillic || keyboard_mode === 'whole', is_phone = matchMedia('(pointer: coarse)').matches;
  const letter_rows = is_whole ? language_item.rows : [], accent_text = is_whole ? Array.from(language_item.extras).filter(extra_text => !language_item.rows.join('').includes(extra_text)).join('') : language_item.extras;
  if (!letter_rows.length && !accent_text) return null;
  let shift_on = false;
  const holder_el = el('div', {class: 'answer-keyboard' + (is_whole ? ' is-whole' : ' is-extra'), lang: language_code}), key_els = new Map();
  function upper(char_text) { return char_text.toLocaleUpperCase(language_code); }
  function type_text(char_text, from_keyboard) {
    const start_at = input_el.selectionStart == null ? input_el.value.length : input_el.selectionStart, end_at = input_el.selectionEnd == null ? start_at : input_el.selectionEnd;
    if (char_text === '\b') { if (start_at === end_at && start_at > 0) input_el.setRangeText('', start_at - 1, start_at, 'end'); else input_el.setRangeText('', start_at, end_at, 'end'); }
    else input_el.setRangeText((from_keyboard ? from_keyboard.shiftKey : shift_on) ? upper(char_text) : char_text, start_at, end_at, 'end');
    if (shift_on && !from_keyboard && char_text !== '\b') set_shift(false);
    if (!from_keyboard) play_sound('type');
    input_el.dispatchEvent(new Event('input', {bubbles: true}));
  }
  function set_shift(is_on) { shift_on = is_on; holder_el.classList.toggle('is-shifted', is_on); key_els.forEach((key_el, char_text) => { key_el.firstChild.textContent = is_on ? upper(char_text) : char_text; }); }
  function key_button(char_text, key_code, is_home) { const key_el = el('button', {type: 'button', class: 'kb-key' + (is_home ? ' kb-home' : ''), onclick: () => type_text(char_text)}, char_text); if (key_code && !is_phone) key_el.appendChild(el('span', {class: 'kb-hint', 'aria-hidden': 'true'}, physical_label(key_code))); key_els.set(char_text, key_el); return key_el; }
  const shift_el = el('button', {type: 'button', class: 'kb-key kb-wide kb-shift', 'aria-label': 'Capital letter', onclick: () => set_shift(!shift_on)}, '⇧'), delete_el = el('button', {type: 'button', class: 'kb-key kb-wide', 'aria-label': 'Delete', onclick: () => type_text('\b')}, '⌫');
  // Phones have no arrow keys while this keyboard stands in for theirs: ← and →, in a row of their own under the space bar, move the cursor one letter.
  function arrow_key(step_by) { return el('button', {type: 'button', class: 'kb-key kb-arrow', 'aria-label': step_by < 0 ? 'Cursor left' : 'Cursor right', onclick: () => { const caret_at = Math.max(0, Math.min(input_el.value.length, (step_by < 0 ? input_el.selectionStart : input_el.selectionEnd) + (input_el.selectionStart === input_el.selectionEnd ? step_by : 0))); input_el.setSelectionRange(caret_at, caret_at); }}, step_by < 0 ? '←' : '→'); }
  const open_el = el('button', {type: 'button', class: 'kb-open', onclick: () => fold(false)}, '⌨ ' + (language_item.cyrillic ? language_item.rows[0].slice(0, 6).toUpperCase() : language_item.extras.slice(0, 4)));
  // Above the keys: the switch between extra letters and the country's keyboard (named by its first six letters, e.g. AZERTY), and ⌨ to hide it.
  const layout_name = language_item.rows[0].slice(0, 6).toUpperCase();
  const head_el = el('div', {class: 'kb-head'}, language_item.cyrillic ? null : el('div', {class: 'kb-switch', role: 'group', 'aria-label': 'Keyboard'}, ...[['extra', language_item.extras.slice(0, 3)], ['whole', layout_name]].map(([mode_value, mode_label]) => el('button', {type: 'button', 'aria-pressed': String((mode_value === 'whole') === is_whole), title: mode_value === 'whole' ? 'Whole keyboard' : 'Extra letters', onclick: () => switch_mode(mode_value)}, mode_label))),
    el('button', {type: 'button', class: 'kb-hide', title: 'Hide the keyboard', 'aria-label': 'Hide the keyboard', onclick: () => fold(true)}, '⌨ ✕'));
  // Whole keyboard: the accents its layout lacks in a row above, then the letter rows staggered like real keys, with bumps on the two home keys (F and J on an English keyboard). On a computer ⌫ ends the top row and ⇧ starts the bottom one; on a phone both sit beside the space bar.
  const code_rows = language_code === 'uk' ? UK_KEY_CODES : [];
  const letter_els = letter_rows.map((row_text, row_index) => el('div', {class: 'kb-row kb-row-' + row_index}, ...(row_index === 2 && !is_phone ? [shift_el] : []), ...Array.from(row_text).map((char_text, key_index) => key_button(char_text, (code_rows[row_index] || [])[key_index], row_index === 1 && (key_index === 3 || key_index === 6))), ...(row_index === 0 && !is_phone ? [delete_el] : [])));
  const accent_el = accent_text ? el('div', {class: 'kb-row kb-accents'}, ...(is_whole ? [] : [shift_el]), ...Array.from(accent_text).map(char_text => key_button(char_text))) : null;
  const longest_row = Math.max(0, ...letter_rows.map((row_text, row_index) => Array.from(row_text).length + (is_phone ? [0, 0.5, 1][row_index] : [1.6, 0.4, 1.6][row_index])));
  const keys_el = el('div', {class: 'kb-keys', style: is_whole ? '--cols:' + longest_row : ''}, accent_el, ...letter_els, is_whole ? el('div', {class: 'kb-row kb-bottom'}, ...(is_phone ? [shift_el] : []), el('button', {type: 'button', class: 'kb-key kb-space', 'aria-label': 'Space', onclick: () => type_text(' ')}, ''), ...(is_phone ? [delete_el] : [])) : null, is_whole && is_phone ? el('div', {class: 'kb-row kb-arrows'}, arrow_key(-1), arrow_key(1)) : null);
  holder_el.append(head_el, keys_el, open_el);
  function switch_mode(mode_value) { app_state.keyboard_mode = mode_value; save_state(); const fresh_el = answer_keyboard(card_set, answer_side, input_el); if (fresh_el) holder_el.replaceWith(fresh_el); keep_question_in_view(); refocus(); }
  function refocus() { if (document.activeElement === input_el) { input_el.blur(); } input_el.focus({preventScroll: true}); }
  // On a phone, a whole keyboard replaces the phone's own; folded, the phone's comes back.
  function fold(is_folded) { holder_el.classList.toggle('is-folded', is_folded); save_folded(language_code, is_folded); keep_question_in_view(); if (is_phone && is_whole) { input_el.inputMode = is_folded ? 'text' : 'none'; refocus(); } else input_el.focus({preventScroll: true}); }
  const start_folded = !!folded_languages()[language_code]; holder_el.classList.toggle('is-folded', start_folded);
  input_el.inputMode = is_phone && is_whole && !start_folded ? 'none' : 'text';
  // Typing on an English computer keyboard gives the Ukrainian letter in that key's place, and the key lights up.
  input_el.addEventListener('keydown', key_event => {
    if (language_code !== 'uk' || holder_el.classList.contains('is-folded') || key_event.ctrlKey || key_event.metaKey || key_event.altKey || key_event.isComposing) return;
    const mapped_text = UK_BY_CODE[key_event.code]; if (!mapped_text || !/^[\x21-\x7e]$/.test(key_event.key)) return;
    key_event.preventDefault(); type_text(mapped_text, key_event);
    const key_el = key_els.get(mapped_text); if (key_el) { key_el.classList.add('is-pressed'); setTimeout(() => key_el.classList.remove('is-pressed'), 140); }
  });
  return holder_el;
}
