// Press and hold to pick something up and drag it, the same as in Sift. A shading spreads from the finger while it is held; then the item lifts with a wobble, follows the finger, the others slide aside, and a blue dashed outline shows where it will land. A tap, or moving first (scrolling), is left alone. Esc puts it back.
//   press_and_drag(root_el, {item_selector, fixed_selector, skip_selector, same_parent, one_axis, on_drop(item_el), on_lift(item_el) (may set item_el.stack_above and stack_below, the room a clump needs around it), on_still(item_el), on_cancel(item_el)})
//   fixed_selector: items that can't be lifted or dropped on. skip_selector: where a press never lifts. same_parent: stays among the items in its own box. one_axis: moves up and down only. on_lift: it has lifted. on_still: held and let go without moving (instead of on_drop). on_cancel: put back.
const HOLD_MS = 300, CARRY_TILT = -0.8;
let carrying_count = 0;
document.addEventListener('touchmove', touch_event => { if (carrying_count && touch_event.cancelable) touch_event.preventDefault(); }, {passive: false, capture: true});
// A springy wobble, as a real thing picked up or put down.
function wobble_frames(from_angle, to_angle, kick_angle) { return Array.from({length: 41}, (unused_item, frame_index) => { const time_value = frame_index / 40 * 0.7, fade_value = Math.exp(-time_value / 0.16), turn_value = 2 * Math.PI * 3.2 * time_value; return {rotate: (to_angle + (from_angle - to_angle) * fade_value * Math.cos(turn_value) + kick_angle * fade_value * Math.sin(turn_value)).toFixed(3) + 'deg'}; }); }
// What a held press shows: a shading that fills the item just as it lifts, and rings spreading from the finger as on water.
function press_marks(item_el, pointer_x, pointer_y) {
  const item_rect = item_el.getBoundingClientRect(), spot_x = pointer_x - item_rect.left, spot_y = pointer_y - item_rect.top, far_corner = Math.max(Math.hypot(spot_x, spot_y), Math.hypot(item_rect.width - spot_x, spot_y), Math.hypot(spot_x, item_rect.height - spot_y), Math.hypot(item_rect.width - spot_x, item_rect.height - spot_y)), ring_size = Math.min(far_corner * 2.1, 560), place_style = 'left:' + spot_x + 'px;top:' + spot_y + 'px;';
  return el('span', {class: 'hold-marks', 'aria-hidden': 'true'}, el('span', {class: 'hold-fill', style: place_style + 'animation-duration:' + HOLD_MS + 'ms;--reach:' + (far_corner / 8 * 1.05)}), ...[0, 1, 2].map(ring_index => el('span', {class: 'hold-ring', style: place_style + 'width:' + ring_size + 'px;height:' + ring_size + 'px;margin:' + (-ring_size / 2) + 'px 0 0 ' + (-ring_size / 2) + 'px;animation-delay:' + ring_index * 240 + 'ms'})));
}
function press_and_drag(root_el, drag_options) {
  let has_moved = false, lift_x = 0, lift_y = 0, pressed = null, dragging_el = null, slot_el = null, origin = null, offset_x = 0, offset_y = 0, last_x = 0, last_y = 0, quiet_until = 0, scroll_timer = null;
  const fixed_selector = drag_options.fixed_selector || null;
  const other_items = () => Array.from(root_el.querySelectorAll(drag_options.item_selector)).filter(item_el => !(dragging_el && dragging_el.contains(item_el)) && !(fixed_selector && item_el.matches(fixed_selector)) && !(drag_options.same_parent && dragging_el && item_el.parentNode !== dragging_el.parentNode) && item_el.getClientRects().length);
  // An item's place once it has finished sliding.
  function settled_rect(item_el) { const rect_now = item_el.getBoundingClientRect(), transform_text = getComputedStyle(item_el).transform, slide_matrix = transform_text !== 'none' && item_el.getAnimations().some(animation_item => animation_item.id === 'make-room') ? new DOMMatrixReadOnly(transform_text) : null, shift_x = slide_matrix ? slide_matrix.m41 : 0, shift_y = slide_matrix ? slide_matrix.m42 : 0; return {left: rect_now.left - shift_x, right: rect_now.right - shift_x, top: rect_now.top - shift_y, bottom: rect_now.bottom - shift_y, width: rect_now.width, height: rect_now.height}; }
  // The others slide to their new places rather than jump.
  function slide_others(move_it) {
    const others = other_items(), old_places = new Map(others.map(item_el => { const rect_now = item_el.getBoundingClientRect(); return [item_el, rect_now]; }));
    others.forEach(item_el => item_el.getAnimations().forEach(animation_item => { if (animation_item.id === 'make-room') animation_item.cancel(); }));
    move_it();
    others.forEach(item_el => { const rect_now = item_el.getBoundingClientRect(), move_x = old_places.get(item_el).left - rect_now.left, move_y = old_places.get(item_el).top - rect_now.top; if (Math.abs(move_x) > 1 || Math.abs(move_y) > 1) item_el.animate([{transform: 'translate(' + move_x + 'px, ' + move_y + 'px)'}, {transform: 'none'}], {duration: 150, easing: 'cubic-bezier(.2, .8, .2, 1)', id: 'make-room'}); });
  }
  function place_item() {
    const middle_x = drag_options.one_axis ? dragging_el.getBoundingClientRect().left + dragging_el.offsetWidth / 2 : last_x - offset_x + dragging_el.offsetWidth / 2, stack_above = dragging_el.stack_above || 0, stack_below = dragging_el.stack_below || 0, middle_y = last_y - offset_y + (dragging_el.offsetHeight + stack_below - stack_above) / 2;
    const under_el = other_items().find(item_el => { const rect_now = settled_rect(item_el); return middle_x > rect_now.left + rect_now.width * 0.2 && middle_x < rect_now.right - rect_now.width * 0.2 && middle_y > rect_now.top + rect_now.height * 0.2 && middle_y < rect_now.bottom - rect_now.height * 0.2; });
    if (under_el) slide_others(() => { if (dragging_el.compareDocumentPosition(under_el) & Node.DOCUMENT_POSITION_PRECEDING) under_el.parentNode.insertBefore(dragging_el, under_el); else under_el.after(dragging_el); });
  }
  function follow_pointer() {
    dragging_el.style.transform = '';
    const turned_rect = dragging_el.getBoundingClientRect(), item_width = dragging_el.offsetWidth, item_height = dragging_el.offsetHeight, box_left = turned_rect.left + turned_rect.width / 2 - item_width / 2, box_top = turned_rect.top + turned_rect.height / 2 - item_height / 2;
    const stack_above = dragging_el.stack_above || 0, stack_below = dragging_el.stack_below || 0;
    Object.assign(slot_el.style, {left: box_left + 'px', top: box_top - stack_above + 'px', width: item_width + 'px', height: item_height + stack_above + stack_below + 'px'});
    dragging_el.style.transform = 'translate(' + (drag_options.one_axis ? 0 : last_x - offset_x - box_left) + 'px, ' + (last_y - offset_y - box_top) + 'px)';
  }
  function cancel_press() { if (!pressed) return; clearTimeout(pressed.timer); pressed.item_el.classList.remove('holding'); pressed.wave_el.remove(); pressed = null; }
  function lift_item() {
    const item_el = pressed.item_el, item_rect = item_el.getBoundingClientRect(), wave_el = pressed.wave_el;
    try { root_el.setPointerCapture(pressed.pointer_id); } catch (capture_err) {}
    clearTimeout(pressed.timer); pressed = null;
    if (document.activeElement && item_el.contains(document.activeElement)) document.activeElement.blur();
    dragging_el = item_el; item_el.hold_wave = wave_el; origin = {parent_el: item_el.parentNode, next_el: item_el.nextSibling}; offset_x = last_x - item_rect.left; offset_y = last_y - item_rect.top; quiet_until = Infinity; carrying_count++; has_moved = false; lift_x = last_x; lift_y = last_y; if (drag_options.on_lift) slide_others(() => drag_options.on_lift(item_el));
    item_el.classList.add('dragging'); document.body.classList.add('is-carrying'); item_el.style.transition = 'none'; item_el.style.rotate = CARRY_TILT + 'deg'; item_el.animate(wobble_frames(0, CARRY_TILT, -2.2), {duration: 700});
    slot_el = el('div', {class: 'drop-slot', 'aria-hidden': 'true'}); slot_el.style.borderRadius = getComputedStyle(item_el).borderRadius; document.body.appendChild(slot_el);
    follow_pointer(); if (navigator.vibrate) navigator.vibrate(10);
    addEventListener('keydown', escape_key, true);
    // Near the top or bottom of the screen, the page scrolls along.
    scroll_timer = setInterval(() => { const scroll_by = last_y < 80 ? -9 : last_y > innerHeight - 80 ? 9 : 0; if (!scroll_by) return; scrollBy(0, scroll_by); place_item(); follow_pointer(); }, 16);
  }
  function finish_drag(is_cancelled) {
    if (!dragging_el) return;
    const item_el = dragging_el, carried_from = getComputedStyle(item_el).transform;
    clearInterval(scroll_timer); removeEventListener('keydown', escape_key, true); carrying_count--; quiet_until = Date.now() + 400;
    if (is_cancelled && origin.parent_el.isConnected) origin.parent_el.insertBefore(item_el, origin.next_el && origin.next_el.parentNode === origin.parent_el ? origin.next_el : null);
    slot_el.remove(); slot_el = null; dragging_el = null; item_el.hold_wave.remove();
    item_el.classList.remove('dragging', 'holding'); document.body.classList.remove('is-carrying'); item_el.style.transform = ''; item_el.style.transition = ''; item_el.style.rotate = '';
    if (!is_cancelled) item_el.animate([{transform: carried_from === 'none' ? 'none' : carried_from}, {transform: 'none'}], {duration: 160, easing: 'cubic-bezier(.2, .8, .2, 1)'});
    item_el.animate(wobble_frames(CARRY_TILT, 0, 1.2), {duration: 700});
    if (is_cancelled) { if (drag_options.on_cancel) drag_options.on_cancel(item_el); } else if (!has_moved && drag_options.on_still) drag_options.on_still(item_el); else drag_options.on_drop(item_el);
  }
  function escape_key(key_event) { if (key_event.key === 'Escape' && dragging_el) { key_event.preventDefault(); key_event.stopImmediatePropagation(); finish_drag(true); stop_watching(); } }
  function pointer_moved(pointer_event) {
    last_x = pointer_event.clientX; last_y = pointer_event.clientY;
    if (pressed) { if (Math.hypot(last_x - pressed.x, last_y - pressed.y) >= 6) { cancel_press(); stop_watching(); } return; }
    if (!dragging_el) return;
    if (pointer_event.pointerType === 'mouse' && !pointer_event.buttons) { finish_drag(true); stop_watching(); return; }
    if (Math.hypot(last_x - lift_x, last_y - lift_y) >= 6) has_moved = true;
    place_item(); follow_pointer();
  }
  function pointer_released() { cancel_press(); finish_drag(false); stop_watching(); }
  function pointer_cancelled() { cancel_press(); finish_drag(true); stop_watching(); }
  function stop_watching() { removeEventListener('pointermove', pointer_moved); removeEventListener('pointerup', pointer_released); removeEventListener('pointercancel', pointer_cancelled); }
  root_el.addEventListener('pointerdown', pointer_event => {
    if (dragging_el) { finish_drag(true); stop_watching(); }
    if (pointer_event.button > 0) return;
    const item_el = pointer_event.target.closest(drag_options.item_selector);
    if (!item_el || !root_el.contains(item_el) || (fixed_selector && item_el.matches(fixed_selector)) || (drag_options.skip_selector && pointer_event.target.closest(drag_options.skip_selector))) return;
    if (pointer_event.pointerType !== 'mouse' && pointer_event.target === document.activeElement) return; // a finger in text being written in
    last_x = pointer_event.clientX; last_y = pointer_event.clientY;
    const wave_el = press_marks(item_el, last_x, last_y);
    item_el.classList.add('holding'); item_el.appendChild(wave_el);
    pressed = {item_el, wave_el, x: last_x, y: last_y, pointer_id: pointer_event.pointerId, timer: setTimeout(lift_item, HOLD_MS)};
    addEventListener('pointermove', pointer_moved); addEventListener('pointerup', pointer_released); addEventListener('pointercancel', pointer_cancelled);
  });
  root_el.addEventListener('click', click_event => { if (Date.now() < quiet_until) { quiet_until = 0; click_event.preventDefault(); click_event.stopImmediatePropagation(); } }, true);
  root_el.addEventListener('contextmenu', menu_event => { if (pressed || dragging_el) menu_event.preventDefault(); });
  root_el.addEventListener('dragstart', drag_event => drag_event.preventDefault());
}

// Selecting in a list, the same as Sift: hold an item and let go, then tap others. A bar at the bottom moves or deletes them together, and they drag as one. Keys: Esc, Delete, Shift+arrows to extend, Shift+Alt+arrows to move, Ctrl+A for all. Each row's item is row_el.list_item.
//   selectable_list(rows_el, {item_selector, fixed_selector, skip_selector, noun, on_reorder(), on_delete(chosen_items) returning an undo, on_paint(is_selecting), extra_buttons(chosen_items)})
let selection_keys = null;
function end_selection_bar() { selection_keys = null; document.querySelectorAll('.select-bar').forEach(bar_el => bar_el.remove()); document.body.classList.remove('has-select-bar'); }
function selectable_list(rows_el, list_options) {
  const selected_items = new Set(); let select_anchor = null, select_cursor = null, carried_rows = [];
  const fixed_selector = list_options.fixed_selector || null;
  const item_rows = () => Array.from(rows_el.children).filter(row_el => !(fixed_selector && row_el.matches(fixed_selector)));
  function clear_selection() { selected_items.clear(); select_anchor = select_cursor = null; paint_selection(); }
  function select_range(to_item) { const row_items = item_rows().map(row_el => row_el.list_item), from_index = row_items.indexOf(select_anchor), to_index = row_items.indexOf(to_item); selected_items.clear(); row_items.slice(Math.min(from_index, to_index), Math.max(from_index, to_index) + 1).forEach(row_item => selected_items.add(row_item)); select_cursor = to_item; paint_selection(); }
  function pick_item(list_item, is_range) { if (is_range && select_anchor && item_rows().some(row_el => row_el.list_item === select_anchor)) return select_range(list_item); if (selected_items.has(list_item)) selected_items.delete(list_item); else selected_items.add(list_item); select_anchor = select_cursor = list_item; paint_selection(); }
  function select_all() { item_rows().forEach(row_el => selected_items.add(row_el.list_item)); paint_selection(); }
  function move_selected(step_by) {
    const selected_rows = item_rows().filter(row_el => selected_items.has(row_el.list_item));
    (step_by < 0 ? selected_rows : selected_rows.slice().reverse()).forEach(row_el => { const next_row = step_by < 0 ? row_el.previousElementSibling : row_el.nextElementSibling; if (!next_row || (fixed_selector && next_row.matches(fixed_selector)) || selected_items.has(next_row.list_item)) return; if (step_by < 0) next_row.before(row_el); else next_row.after(row_el); });
    list_options.on_reorder(); if (selected_rows[0]) selected_rows[0].scrollIntoView({block: 'nearest'});
  }
  function delete_selected() {
    const chosen_items = Array.from(selected_items);
    if (!chosen_items.length) return;
    selected_items.clear(); select_anchor = select_cursor = null;
    const undo_delete = list_options.on_delete(chosen_items); paint_selection();
    toast(chosen_items.length + ' ' + list_options.noun + (chosen_items.length === 1 ? '' : 's') + ' deleted', {action: 'Undo', on_action: undo_delete, ms: 8000});
  }
  function paint_selection() {
    if (!rows_el.isConnected && selected_items.size) { selected_items.clear(); }
    const is_selecting = selected_items.size > 0;
    Array.from(rows_el.children).forEach(row_el => row_el.classList.toggle('selected', selected_items.has(row_el.list_item)));
    rows_el.classList.toggle('is-selecting', is_selecting);
    if (list_options.on_paint) list_options.on_paint(is_selecting);
    end_selection_bar();
    if (!is_selecting) return;
    const key_hint = key_text => el('kbd', {}, key_text), chosen_items = item_rows().map(row_el => row_el.list_item).filter(row_item => selected_items.has(row_item));
    const extra_buttons = list_options.extra_buttons ? list_options.extra_buttons(chosen_items) : [];
    document.body.classList.add('has-select-bar');
    document.body.appendChild(el('div', {class: 'select-bar', role: 'toolbar', 'aria-label': 'Selected ' + list_options.noun + 's'}, el('span', {class: 'select-count'}, selected_items.size + ' selected'),
      el('button', {'aria-label': 'Clear selection', title: 'Clear selection (Esc)', onclick: clear_selection}, '✕', key_hint('Esc')), el('button', {title: 'Select all (Ctrl+A)', onclick: select_all}, 'All'),
      el('button', {'aria-label': 'Move up', title: 'Move up (Shift+Alt+↑)', onclick: () => move_selected(-1)}, '↑'), el('button', {'aria-label': 'Move down', title: 'Move down (Shift+Alt+↓)', onclick: () => move_selected(1)}, '↓'),
      ...extra_buttons, el('button', {class: 'danger', title: 'Delete (Delete)', onclick: delete_selected}, 'Delete', key_hint('Del'))));
    selection_keys = key_event => {
      if (key_event.target.matches('input, textarea, select') && !key_event.target.readOnly) return false;
      const is_up_or_down = key_event.key === 'ArrowUp' || key_event.key === 'ArrowDown', step_by = key_event.key === 'ArrowUp' ? -1 : 1;
      if (key_event.key === 'Escape') clear_selection();
      else if (key_event.key === 'Delete' || key_event.key === 'Backspace') delete_selected();
      else if ((key_event.ctrlKey || key_event.metaKey) && key_event.key.toLowerCase() === 'a') select_all();
      else if (is_up_or_down && key_event.shiftKey && key_event.altKey) move_selected(step_by);
      else if (is_up_or_down && key_event.shiftKey) { const row_items = item_rows().map(row_el => row_el.list_item), next_item = row_items[row_items.indexOf(select_cursor) + step_by]; if (next_item) select_range(next_item); }
      else return false;
      return true;
    };
  }
  // Everything selected is picked up together: copies of the others gather around the held row in their order, flying in from where they were, and the row keeps room for them all, so the gap is as big as the clump.
  function clump_around(row_el) {
    const held_index = carried_rows.indexOf(row_el), row_gap = parseFloat(getComputedStyle(rows_el).rowGap) || 0, old_tops = carried_rows.map(other_row => other_row.getBoundingClientRect().top), held_rect = row_el.getBoundingClientRect();
    let stack_above = 0, stack_below = 0;
    const copies = carried_rows.map((other_row, row_index) => {
      if (other_row === row_el) return null;
      const copy_el = other_row.cloneNode(true), row_height = other_row.offsetHeight;
      other_row.querySelectorAll('textarea').forEach((textarea_el, field_index) => { copy_el.querySelectorAll('textarea')[field_index].value = textarea_el.value; });
      copy_el.classList.add('clump-copy'); copy_el.setAttribute('aria-hidden', 'true'); copy_el.querySelectorAll('.hold-marks').forEach(mark_el => mark_el.remove());
      return {copy_el, row_height, row_index};
    });
    copies.slice(0, held_index).reverse().forEach(copy_item => { if (!copy_item) return; stack_above += copy_item.row_height + row_gap; copy_item.copy_el.style.top = -stack_above + 'px'; });
    copies.slice(held_index + 1).forEach(copy_item => { if (!copy_item) return; copy_item.copy_el.style.top = row_el.offsetHeight + row_gap + stack_below + 'px'; stack_below += copy_item.row_height + row_gap; });
    carried_rows.forEach(other_row => { if (other_row !== row_el) other_row.classList.add('carried-along'); });
    row_el.stack_above = stack_above; row_el.stack_below = stack_below; row_el.style.marginTop = stack_above + 'px'; row_el.style.marginBottom = stack_below + 'px'; row_el.dataset.carrying = carried_rows.length + ' ' + list_options.noun + 's';
    copies.forEach(copy_item => { if (!copy_item) return; row_el.appendChild(copy_item.copy_el); const copy_top = held_rect.top + parseFloat(copy_item.copy_el.style.top); copy_item.copy_el.animate([{transform: 'translateY(' + (old_tops[copy_item.row_index] - copy_top) + 'px)', opacity: 0.6}, {transform: 'none', opacity: 1}], {duration: 220, easing: 'cubic-bezier(.2, .8, .2, 1)'}); });
  }
  function end_carrying(row_el) { carried_rows.forEach(other_row => other_row.classList.remove('carried-along')); carried_rows = []; row_el.querySelectorAll('.clump-copy').forEach(copy_el => copy_el.remove()); delete row_el.dataset.carrying; row_el.stack_above = row_el.stack_below = 0; row_el.style.marginTop = ''; row_el.style.marginBottom = ''; }
  rows_el.addEventListener('mousedown', mouse_event => { if (selected_items.size && !(list_options.skip_selector && mouse_event.target.closest(list_options.skip_selector))) mouse_event.preventDefault(); });
  press_and_drag(rows_el, {item_selector: list_options.item_selector, fixed_selector, skip_selector: list_options.skip_selector, one_axis: true,
    on_lift: row_el => { carried_rows = selected_items.has(row_el.list_item) && selected_items.size > 1 ? item_rows().filter(other_row => selected_items.has(other_row.list_item)) : []; if (carried_rows.length) clump_around(row_el); },
    on_still: row_el => { end_carrying(row_el); if (document.activeElement) document.activeElement.blur(); if (!selected_items.has(row_el.list_item)) pick_item(row_el.list_item, false); },
    on_cancel: row_el => end_carrying(row_el),
    on_drop: row_el => { const held_index = carried_rows.indexOf(row_el); carried_rows.slice(0, held_index).forEach(other_row => row_el.before(other_row)); carried_rows.slice(held_index + 1).reverse().forEach(other_row => row_el.after(other_row)); end_carrying(row_el); list_options.on_reorder(); }});
  // After press_and_drag's own click listener, which swallows the click that ends a hold.
  rows_el.addEventListener('click', click_event => { const row_el = click_event.target.closest(list_options.item_selector); if (!selected_items.size || !row_el || (fixed_selector && row_el.matches(fixed_selector)) || (list_options.skip_selector && click_event.target.closest(list_options.skip_selector))) return; click_event.preventDefault(); click_event.stopPropagation(); pick_item(row_el.list_item, click_event.shiftKey); }, true);
  return {clear: clear_selection, paint: paint_selection, forget: list_item => { selected_items.delete(list_item); paint_selection(); }};
}
