// Scan photo: reads a photo of a vocab list on the device (Tesseract.js, loaded from jsDelivr the first time it is used; the photo never leaves the device), finds term and definition pairs, and shows them on the photo for a check before they become cards.
const SCAN_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const SCAN_LANGUAGES = [['ukr+eng', 'Ukrainian + English'], ['eng', 'English'], ['fra+eng', 'French + English'], ['deu+eng', 'German + English'], ['spa+eng', 'Spanish + English'], ['ita+eng', 'Italian + English'], ['pol+eng', 'Polish + English'], ['por+eng', 'Portuguese + English']];
let scan_script_promise = null;
function load_scan_script() {
  if (window.Tesseract) return Promise.resolve();
  if (!scan_script_promise) scan_script_promise = new Promise((resolve, reject) => { const script_el = el('script', {src: SCAN_SCRIPT_URL}); script_el.onload = resolve; script_el.onerror = () => { scan_script_promise = null; script_el.remove(); reject(new Error('script')); }; document.head.appendChild(script_el); });
  return scan_script_promise;
}
// Big photos are slow and small ones read badly: the long side ends up 1400-2400 px.
async function photo_canvas(photo_file) {
  const photo_bitmap = await createImageBitmap(photo_file, {imageOrientation: 'from-image'}), long_side = Math.max(photo_bitmap.width, photo_bitmap.height), scale_by = long_side > 2400 ? 2400 / long_side : long_side < 1400 ? 1400 / long_side : 1;
  const canvas_el = el('canvas'); canvas_el.width = Math.round(photo_bitmap.width * scale_by); canvas_el.height = Math.round(photo_bitmap.height * scale_by);
  const draw_context = canvas_el.getContext('2d'); draw_context.filter = 'grayscale(1) contrast(1.25)'; draw_context.drawImage(photo_bitmap, 0, 0, canvas_el.width, canvas_el.height); photo_bitmap.close();
  return canvas_el;
}

// ---- Words into pairs ----
function word_script(word_text) { const cyrillic_count = (word_text.match(/[Ѐ-ӿ]/g) || []).length, latin_count = (word_text.match(/[a-zÀ-ɏ]/gi) || []).length; return cyrillic_count > latin_count ? 'cyr' : latin_count ? 'lat' : ''; }
function union_box(word_list) { return word_list.length ? word_list.reduce((box_so_far, word_item) => ({x0: Math.min(box_so_far.x0, word_item.bbox.x0), y0: Math.min(box_so_far.y0, word_item.bbox.y0), x1: Math.max(box_so_far.x1, word_item.bbox.x1), y1: Math.max(box_so_far.y1, word_item.bbox.y1)}), {x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity}) : null; }
function tidy_side(side_text) { return side_text.replace(/[|_]/g, ' ').replace(/^\s*(\d{1,3}\s*[.)]|[•·*▪●○-])\s*/, '').replace(/^[\s,;:.–—=-]+|[\s,;–—=-]+$/g, '').replace(/\s+/g, ' ').trim(); }
const SEPARATOR_WORD = /^[-–—=:]+$/;
// Each row's words, left to right, split where the definition starts: a gap between two columns, a dash, colon or equals, a change of alphabet, or the widest gap.
function split_row(row_words, row_height) {
  const word_texts = row_words.map(word_item => word_item.text);
  const line_change = row_words.findIndex((word_item, word_index) => word_index && word_item.line_id !== row_words[word_index - 1].line_id);
  if (line_change > 0) return [row_words.slice(0, line_change), row_words.slice(line_change)];
  const separator_index = word_texts.findIndex((word_text, word_index) => word_index && word_index < word_texts.length - 1 && SEPARATOR_WORD.test(word_text));
  if (separator_index > 0) return [row_words.slice(0, separator_index), row_words.slice(separator_index + 1)];
  const ends_with_index = word_texts.findIndex((word_text, word_index) => word_index < word_texts.length - 1 && /[^-–—=:][–—=:]$/.test(word_text));
  if (ends_with_index >= 0) { const term_words = row_words.slice(0, ends_with_index + 1); term_words[ends_with_index] = Object.assign({}, term_words[ends_with_index], {text: term_words[ends_with_index].text.slice(0, -1)}); return [term_words, row_words.slice(ends_with_index + 1)]; }
  const inside_index = word_texts.findIndex(word_text => /\S[–—=]\S/.test(word_text));
  if (inside_index >= 0) { const word_parts = word_texts[inside_index].split(/[–—=]/), joined_word = row_words[inside_index]; return [row_words.slice(0, inside_index).concat([Object.assign({}, joined_word, {text: word_parts[0]})]), [Object.assign({}, joined_word, {text: word_parts.slice(1).join(' ')})].concat(row_words.slice(inside_index + 1))]; }
  const scripts = word_texts.map(word_script), first_script = scripts.find(Boolean), script_change = scripts.findIndex(word_scr => word_scr && word_scr !== first_script);
  if (script_change > 0) return [row_words.slice(0, script_change), row_words.slice(script_change)];
  let widest_gap = 0, gap_index = -1;
  row_words.forEach((word_item, word_index) => { if (!word_index) return; const gap_width = word_item.bbox.x0 - row_words[word_index - 1].bbox.x1; if (gap_width > widest_gap) { widest_gap = gap_width; gap_index = word_index; } });
  if (gap_index > 0 && widest_gap > row_height * 1.6) return [row_words.slice(0, gap_index), row_words.slice(gap_index)];
  return [row_words, []];
}
// Tesseract may read a two-column page one column at a time, so lines side by side at the same height are put back together as one row.
function scanned_pairs(scan_data) {
  const scan_lines = [];
  (scan_data.lines || []).forEach((scan_line, line_index) => {
    const line_words = (scan_line.words || []).filter(word_item => word_item.confidence > 25 && /[\p{L}\p{N}]/u.test(word_item.text)).map(word_item => ({text: word_item.text, bbox: word_item.bbox, line_id: line_index}));
    const baseline_item = scan_line.baseline, baseline_width = baseline_item ? baseline_item.x1 - baseline_item.x0 : 0;
    if (line_words.length) scan_lines.push({words: line_words, box: union_box(line_words), slope: baseline_width > 60 ? (baseline_item.y1 - baseline_item.y0) / baseline_width : null});
  });
  // A tilted photo: heights are compared as if the page were straight, using the lines' usual slope.
  const slope_list = scan_lines.map(scan_line => scan_line.slope).filter(slope_value => slope_value !== null).sort((slope_a, slope_b) => slope_a - slope_b), page_slope = slope_list.length ? slope_list[Math.floor(slope_list.length / 2)] : 0;
  scan_lines.forEach(scan_line => { scan_line.middle = (scan_line.box.y0 + scan_line.box.y1) / 2 - page_slope * (scan_line.box.x0 + scan_line.box.x1) / 2; });
  const row_list = [];
  scan_lines.sort((line_a, line_b) => line_a.middle - line_b.middle).forEach(scan_line => {
    const line_height = scan_line.box.y1 - scan_line.box.y0;
    const same_row = row_list.find(row_item => Math.abs(row_item.middle - scan_line.middle) < Math.min(line_height, row_item.height) * .75 && row_item.lines.every(row_line => scan_line.box.x1 < row_line.box.x0 || scan_line.box.x0 > row_line.box.x1));
    if (same_row) { same_row.lines.push(scan_line); same_row.box = union_box(same_row.lines.map(row_line => ({bbox: row_line.box}))); } else row_list.push({lines: [scan_line], box: scan_line.box, middle: scan_line.middle, height: line_height});
  });
  const pair_list = row_list.map(row_item => {
    const row_words = row_item.lines.sort((line_a, line_b) => line_a.box.x0 - line_b.box.x0).flatMap(row_line => row_line.words.slice().sort((word_a, word_b) => word_a.bbox.x0 - word_b.bbox.x0)), row_sides = split_row(row_words, row_item.box.y1 - row_item.box.y0);
    return {term: tidy_side(row_sides[0].map(word_item => word_item.text).join(' ')), definition: tidy_side(row_sides[1].map(word_item => word_item.text).join(' ')), term_box: union_box(row_sides[0]), definition_box: union_box(row_sides[1]), use: true};
  }).filter(pair_item => pair_item.term.length + pair_item.definition.length > 1);
  // A word on one line with its translation on the line below, in the other alphabet.
  for (let pair_index = 0; pair_index < pair_list.length - 1; pair_index++) {
    const this_pair = pair_list[pair_index], next_pair = pair_list[pair_index + 1];
    if (this_pair.definition || next_pair.definition || !word_script(this_pair.term) || word_script(this_pair.term) === word_script(next_pair.term)) continue;
    // Side by side but a little higher (a tilted photo): the left one is the term.
    const next_is_left = next_pair.term_box.x1 < this_pair.term_box.x0;
    this_pair.definition = next_is_left ? this_pair.term : next_pair.term; this_pair.definition_box = next_is_left ? this_pair.term_box : next_pair.term_box;
    if (next_is_left) { this_pair.term = next_pair.term; this_pair.term_box = next_pair.term_box; }
    pair_list.splice(pair_index + 1, 1);
  }
  pair_list.forEach(pair_item => { if (!pair_item.term || !pair_item.definition) pair_item.use = false; });
  return pair_list;
}
// The side that is mostly in the other alphabet from the set's own terms is swapped round, so a Ukrainian-first set stays Ukrainian first.
function match_set_sides(pair_list, set_cards) {
  const count_script = (text_list, script_name) => text_list.filter(text_item => word_script(text_item) === script_name).length, set_terms = set_cards.map(card_item => card_item.term).filter(Boolean), set_definitions = set_cards.map(card_item => card_item.definition).filter(Boolean);
  if (!set_terms.length) return false;
  const term_script = count_script(set_terms, 'cyr') > set_terms.length / 2 ? 'cyr' : count_script(set_terms, 'lat') > set_terms.length / 2 ? 'lat' : '', definition_script = count_script(set_definitions, 'cyr') > set_definitions.length / 2 ? 'cyr' : 'lat';
  if (!term_script || term_script === definition_script) return false;
  const used_pairs = pair_list.filter(pair_item => pair_item.use);
  return count_script(used_pairs.map(pair_item => pair_item.definition), term_script) > used_pairs.length / 2;
}

// ---- The sheet ----
function scan_photo(set_cards, on_add) {
  const file_input_el = el('input', {type: 'file', accept: 'image/*', hidden: 'hidden'});
  file_input_el.addEventListener('change', () => { const photo_file = file_input_el.files[0]; file_input_el.remove(); if (photo_file) open_scan_sheet(photo_file, set_cards, on_add); });
  document.body.appendChild(file_input_el); file_input_el.click();
}
async function open_scan_sheet(photo_file, set_cards, on_add) {
  let scan_worker = null, pair_list = [], picked_pair = null, is_closed = false, scan_language = app_state.scan_language || 'ukr+eng';
  const dialog_el = el('dialog', {class: 'whatsnew-sheet scan-sheet'}), photo_el = el('canvas', {class: 'scan-photo'}), status_el = el('div', {class: 'scan-status', role: 'status'}), meter_el = el('i'), rows_el = el('div', {class: 'ruled scan-rows'});
  const add_button_el = el('button', {class: 'primary', disabled: 'disabled', onclick: () => { on_add(pair_list.filter(pair_item => pair_item.use && (pair_item.term.trim() || pair_item.definition.trim())).map(pair_item => ({term: pair_item.term.trim(), definition: pair_item.definition.trim()}))); dialog_el.close(); }}, 'Add cards');
  const language_el = el('select', {class: 'scan-language', 'aria-label': 'Languages on the page', onchange: () => { scan_language = app_state.scan_language = language_el.value; save_state(); run_scan(); }});
  SCAN_LANGUAGES.forEach(language_item => language_el.appendChild(el('option', {value: language_item[0]}, language_item[1])));
  language_el.value = scan_language;
  const swap_button_el = el('button', {disabled: 'disabled', onclick: () => { pair_list.forEach(swap_pair); draw_rows(); }}, '⇄ Swap sides');
  dialog_el.append(el('div', {class: 'whatsnew-head'}, el('h2', {}, 'Scan photo'), language_el, el('button', {onclick: () => dialog_el.close()}, 'Cancel')),
    el('div', {class: 'scan-photo-box'}, photo_el, el('div', {class: 'scan-progress'}, meter_el), status_el), rows_el,
    el('div', {class: 'button-row'}, add_button_el, swap_button_el, el('button', {onclick: () => scan_photo(set_cards, on_add)}, 'Another photo')));
  dialog_el.addEventListener('close', () => { is_closed = true; dialog_el.remove(); if (scan_worker) scan_worker.terminate(); });
  document.body.appendChild(dialog_el); dialog_el.showModal();
  function swap_pair(pair_item) { [pair_item.term, pair_item.definition] = [pair_item.definition, pair_item.term]; [pair_item.term_box, pair_item.definition_box] = [pair_item.definition_box, pair_item.term_box]; }
  function set_status(status_text, progress_share) { status_el.textContent = status_text; dialog_el.classList.toggle('is-reading', progress_share !== undefined); meter_el.style.width = Math.round((progress_share || 0) * 100) + '%'; }
  // The photo with a box round each term (blue) and definition (yellow); the row being edited is filled in.
  function draw_photo() {
    const draw_context = photo_el.getContext('2d'), line_width = Math.max(2, photo_el.width / 400); draw_context.drawImage(page_canvas, 0, 0);
    pair_list.forEach(pair_item => [[pair_item.term_box, '47, 111, 224'], [pair_item.definition_box, '230, 170, 0']].forEach(box_item => {
      if (!box_item[0]) return; const box_pad = line_width * 2, box_left = box_item[0].x0 - box_pad, box_top = box_item[0].y0 - box_pad, box_width = box_item[0].x1 - box_item[0].x0 + box_pad * 2, box_height = box_item[0].y1 - box_item[0].y0 + box_pad * 2;
      draw_context.lineWidth = line_width; draw_context.strokeStyle = pair_item.use ? 'rgb(' + box_item[1] + ')' : 'rgba(120, 120, 120, .5)'; draw_context.strokeRect(box_left, box_top, box_width, box_height);
      if (pair_item === picked_pair) { draw_context.fillStyle = 'rgba(' + box_item[1] + ', .28)'; draw_context.fillRect(box_left, box_top, box_width, box_height); }
    }));
  }
  function pick_pair(pair_item, row_el) { picked_pair = pair_item; draw_photo(); rows_el.querySelectorAll('.is-picked').forEach(picked_el => picked_el.classList.remove('is-picked')); row_el.classList.add('is-picked'); }
  function draw_rows() {
    rows_el.replaceChildren(); pair_list.forEach(pair_item => {
      const row_el = el('label', {class: 'scan-row' + (pair_item.use ? '' : ' is-left-out')});
      const side_input = side_key => el('input', {type: 'text', class: 'line-field', value: pair_item[side_key], placeholder: side_key === 'term' ? 'Term' : 'Definition', onfocus: () => pick_pair(pair_item, row_el), oninput: input_event => { pair_item[side_key] = input_event.target.value; if (!pair_item.use && pair_item.term.trim() && pair_item.definition.trim()) { pair_item.use = true; row_el.querySelector('input[type=checkbox]').checked = true; row_el.classList.remove('is-left-out'); count_cards(); draw_photo(); } }});
      row_el.append(el('input', {type: 'checkbox', checked: pair_item.use, 'aria-label': 'Add this card', onchange: change_event => { pair_item.use = change_event.target.checked; row_el.classList.toggle('is-left-out', !pair_item.use); count_cards(); draw_photo(); }}), side_input('term'), side_input('definition'));
      row_el.addEventListener('pointerenter', () => pick_pair(pair_item, row_el));
      rows_el.appendChild(row_el);
    });
    count_cards(); draw_photo();
  }
  function count_cards() { const used_count = pair_list.filter(pair_item => pair_item.use).length; add_button_el.textContent = used_count ? 'Add ' + used_count + (used_count === 1 ? ' card' : ' cards') : 'Add cards'; add_button_el.disabled = !used_count; swap_button_el.disabled = !pair_list.length; }
  // Clicking a box on the photo goes to its row.
  photo_el.addEventListener('click', click_event => {
    const photo_rect = photo_el.getBoundingClientRect(), photo_x = (click_event.clientX - photo_rect.left) * photo_el.width / photo_rect.width, photo_y = (click_event.clientY - photo_rect.top) * photo_el.height / photo_rect.height;
    const pair_index = pair_list.findIndex(pair_item => [pair_item.term_box, pair_item.definition_box].some(box_item => box_item && photo_x >= box_item.x0 - 8 && photo_x <= box_item.x1 + 8 && photo_y >= box_item.y0 - 8 && photo_y <= box_item.y1 + 8));
    if (pair_index >= 0) { const row_el = rows_el.children[pair_index]; row_el.scrollIntoView({block: 'nearest', behavior: 'smooth'}); row_el.querySelector('.line-field').focus({preventScroll: true}); }
  });
  let page_canvas;
  try { page_canvas = await photo_canvas(photo_file); } catch (photo_err) { set_status("Couldn't open that picture. Try a JPEG or PNG."); return; }
  photo_el.width = page_canvas.width; photo_el.height = page_canvas.height; draw_photo();
  async function run_scan() {
    pair_list = []; rows_el.replaceChildren(); count_cards(); draw_photo(); language_el.disabled = true;
    set_status('Getting the reader ready…', 0);
    try {
      await load_scan_script();
      if (scan_worker) { await scan_worker.terminate(); scan_worker = null; }
      const worker_language = scan_language;
      scan_worker = await Tesseract.createWorker(worker_language.split('+'), 1, {logger: log_item => { if (is_closed) return; if (log_item.status === 'recognizing text') set_status('Reading the words…', .3 + log_item.progress * .7); else if (/load/.test(log_item.status)) set_status('Getting the reader ready…', log_item.progress * .3); }});
      if (is_closed) return;
      await scan_worker.setParameters({tessedit_pageseg_mode: '3', preserve_interword_spaces: '1'});
      const scan_result = await scan_worker.recognize(page_canvas);
      if (is_closed || worker_language !== scan_language) return;
      pair_list = scanned_pairs(scan_result.data);
      if (match_set_sides(pair_list, set_cards)) pair_list.forEach(swap_pair);
      set_status(pair_list.length ? '' : 'No words found. Try a closer, straighter photo in good light.');
      draw_rows();
    } catch (scan_err) { console.warn('Scan failed:', scan_err); if (!is_closed) set_status(navigator.onLine ? "Couldn't read the photo. Try again." : 'The reader needs a connection the first time. Try again when you are online.'); }
    language_el.disabled = false;
  }
  run_scan();
}
