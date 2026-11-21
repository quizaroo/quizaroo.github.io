// Paste from Quizlet: you copy a Quizlet set page (select all, copy) and paste it here. Quizaroo never contacts Quizlet; it only reads what you pasted, then adds the set through the same path as importing a file.
const QUIZLET_MODE_LINK = /(?:quizlet\.com)?\/(?:[a-z]{2}(?:-[a-z]{2,4})?\/)?(\d{4,})\/(?:learn|test|flashcards|match|spell|write|gravity|live|blast)\b/g;
const QUIZLET_SET_LINK = /quizlet\.com\/(?:[a-z]{2}(?:-[a-z]{2,4})?\/)?(\d{4,})\//g;

// The set's own number: links to its study modes first, else the number most of its links share (a page also links to other people's sets).
function quizlet_set_number(pasted_text) {
  const mode_match = QUIZLET_MODE_LINK.exec(pasted_text); QUIZLET_MODE_LINK.lastIndex = 0;
  if (mode_match) return mode_match[1];
  const number_counts = new Map(); for (const link_match of pasted_text.matchAll(QUIZLET_SET_LINK)) number_counts.set(link_match[1], (number_counts.get(link_match[1]) || 0) + 1);
  return number_counts.size ? Array.from(number_counts).sort((count_a, count_b) => count_b[1] - count_a[1])[0][0] : '';
}
function quizlet_term_count(page_text) { const count_match = /Terms in this set\s*\((\d+)\)/i.exec(page_text); return count_match ? Number(count_match[1]) : 0; }
// A side's text with its line breaks kept: a parsed page has no layout, so <br> and block ends become new lines here.
function side_text(side_el) {
  side_el.querySelectorAll('br').forEach(break_el => break_el.replaceWith('\n'));
  side_el.querySelectorAll('div, p, li').forEach(block_el => block_el.append('\n'));
  return side_el.textContent.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();
}
// Returns {title, cards, expected} or null. The page's HTML is read first; plain text is the fallback.
function parse_quizlet(html_text, plain_text) {
  if (html_text) {
    const page_doc = new DOMParser().parseFromString(html_text, 'text/html');
    const html_cards = Array.from(page_doc.querySelectorAll('.SetPageTermsList-term')).map(row_el => { const side_els = row_el.querySelectorAll('.TermText'); return side_els.length >= 2 ? {term: side_text(side_els[0]), definition: side_text(side_els[1])} : null; }).filter(card_item => card_item && (card_item.term || card_item.definition));
    if (html_cards.length) { const heading_el = page_doc.querySelector('h1'); return {title: heading_el ? clean_text(heading_el.textContent) : '', cards: html_cards, expected: quizlet_term_count(page_doc.body.textContent), number: quizlet_set_number(html_text + '\n' + (plain_text || ''))}; }
  }
  if (!plain_text) return null;
  const text_lines = plain_text.split(/\r?\n/).map(text_line => text_line.trim()), heading_index = text_lines.findIndex(text_line => /^Terms in this set\s*\(\d+\)/i.test(text_line));
  if (heading_index < 0) return null;
  const expected_count = quizlet_term_count(text_lines[heading_index]), card_lines = text_lines.slice(heading_index + 1).filter(Boolean), text_cards = [];
  for (let line_index = 0; line_index + 1 < card_lines.length && text_cards.length < expected_count; line_index += 2) text_cards.push({term: card_lines[line_index], definition: card_lines[line_index + 1]});
  return text_cards.length ? {title: text_lines.find(Boolean) || '', cards: text_cards, expected: expected_count, number: quizlet_set_number(plain_text)} : null;
}

function open_quizlet_paste() {
  let parsed_set = null;
  const dialog_el = el('dialog', {class: 'whatsnew-sheet quizlet-sheet'}), status_el = el('div', {class: 'scan-status', role: 'status'}), preview_el = el('div', {class: 'quizlet-preview', hidden: 'hidden'});
  const paste_box_el = el('textarea', {class: 'quizlet-paste-box', rows: 2, placeholder: 'Or paste here', 'aria-label': 'Paste the Quizlet page here'});
  const title_input_el = el('input', {type: 'text', class: 'line-field quizlet-title', 'aria-label': 'Set name'}), count_el = el('div', {class: 'muted'}), sample_el = el('div', {class: 'ruled quizlet-sample'});
  const add_button_el = el('button', {class: 'primary', onclick: add_set}, 'Add set'), paste_button_el = el('button', {class: 'primary quizlet-paste-button', onclick: read_clipboard}, 'Paste');
  preview_el.append(title_input_el, count_el, sample_el, el('div', {class: 'button-row'}, add_button_el));
  dialog_el.append(el('div', {class: 'whatsnew-head'}, el('h2', {}, 'Paste from Quizlet'), el('button', {onclick: () => dialog_el.close()}, 'Cancel')),
    el('ol', {class: 'quizlet-steps'}, el('li', {}, 'Open the set on Quizlet'), el('li', {}, 'Select all and copy (Ctrl+A, Ctrl+C)'), el('li', {}, 'Paste it here')),
    el('div', {class: 'button-row'}, paste_button_el), paste_box_el, status_el, preview_el);
  dialog_el.addEventListener('close', () => dialog_el.remove());
  // Ctrl+V anywhere in the sheet (or a long-press Paste in the box) works too, for browsers that won't let the button read the clipboard.
  dialog_el.addEventListener('paste', paste_event => { if (paste_event.target === title_input_el) return; paste_event.preventDefault(); show_paste(paste_event.clipboardData.getData('text/html'), paste_event.clipboardData.getData('text/plain')); });
  document.body.appendChild(dialog_el); dialog_el.showModal();
  async function read_clipboard() {
    try {
      let html_text = '', plain_text = '';
      if (navigator.clipboard.read) { for (const clip_item of await navigator.clipboard.read()) { if (clip_item.types.includes('text/html')) html_text = await (await clip_item.getType('text/html')).text(); if (clip_item.types.includes('text/plain')) plain_text = await (await clip_item.getType('text/plain')).text(); } }
      else plain_text = await navigator.clipboard.readText();
      show_paste(html_text, plain_text);
    } catch (clip_err) { status_el.textContent = 'Your browser won\'t let the button paste. Press Ctrl+V, or tap the box and choose Paste.'; paste_box_el.focus(); }
  }
  function show_paste(html_text, plain_text) {
    paste_box_el.value = ''; parsed_set = parse_quizlet(html_text, plain_text); preview_el.hidden = !parsed_set; paste_button_el.classList.toggle('primary', !parsed_set);
    if (!parsed_set) { status_el.textContent = 'No cards found. Copy the set\'s own page, the one that lists "Terms in this set". On a long set, click See more before copying.'; return; }
    const card_count = parsed_set.cards.length, missing_count = parsed_set.expected - card_count;
    status_el.textContent = missing_count > 0 ? 'Only ' + card_count + ' of ' + parsed_set.expected + ' cards were on the page. On Quizlet, click See more, then copy again.' : '';
    title_input_el.value = parsed_set.title; count_el.textContent = card_count + (card_count === 1 ? ' card' : ' cards');
    sample_el.replaceChildren(...parsed_set.cards.slice(0, 4).map(card_item => el('div', {class: 'quizlet-card'}, el('span', {}, card_item.term), el('span', {}, card_item.definition))), card_count > 4 ? el('div', {class: 'muted quizlet-more'}, '+ ' + (card_count - 4) + ' more') : '');
    add_button_el.textContent = 'Add ' + card_count + (card_count === 1 ? ' card' : ' cards');
  }
  // A set already pasted from the same Quizlet set has the same id, so the import asks whether to merge, replace or keep both.
  function add_set() {
    const new_set = {id: parsed_set.number ? 'quizlet-' + parsed_set.number : new_id(), title: title_input_el.value.trim() || 'Quizlet set', created: today_text(), cards: parsed_set.cards};
    dialog_el.close(); import_json(JSON.stringify({format: 'open-flashcards', version: 1, sets: [new_set]}));
  }
}
