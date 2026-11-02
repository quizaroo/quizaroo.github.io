// Press and hold to pick something up and drag it, the same as in Sift. A shading spreads from the finger while it is held; then the item lifts with a wobble, follows the finger, the others slide aside, and a blue dashed outline shows where it will land. A tap, or moving first (scrolling), is left alone. Esc puts it back.
//   press_and_drag(root_el, {item_selector, fixed_selector, skip_selector, same_parent, one_axis, on_drop(item_el), on_lift(item_el), on_still(item_el), on_cancel(item_el)})
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
  const other_items = () => Array.from(root_el.querySelectorAll(drag_options.item_selector)).filter(item_el => item_el !== dragging_el && !(fixed_selector && item_el.matches(fixed_selector)) && !(drag_options.same_parent && dragging_el && item_el.parentNode !== dragging_el.parentNode) && item_el.getClientRects().length);
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
    const middle_x = drag_options.one_axis ? dragging_el.getBoundingClientRect().left + dragging_el.offsetWidth / 2 : last_x - offset_x + dragging_el.offsetWidth / 2, middle_y = last_y - offset_y + dragging_el.offsetHeight / 2;
    const under_el = other_items().find(item_el => { const rect_now = settled_rect(item_el); return middle_x > rect_now.left + rect_now.width * 0.2 && middle_x < rect_now.right - rect_now.width * 0.2 && middle_y > rect_now.top + rect_now.height * 0.2 && middle_y < rect_now.bottom - rect_now.height * 0.2; });
    if (under_el) slide_others(() => { if (dragging_el.compareDocumentPosition(under_el) & Node.DOCUMENT_POSITION_PRECEDING) under_el.parentNode.insertBefore(dragging_el, under_el); else under_el.after(dragging_el); });
  }
  function follow_pointer() {
    dragging_el.style.transform = '';
    const turned_rect = dragging_el.getBoundingClientRect(), item_width = dragging_el.offsetWidth, item_height = dragging_el.offsetHeight, box_left = turned_rect.left + turned_rect.width / 2 - item_width / 2, box_top = turned_rect.top + turned_rect.height / 2 - item_height / 2;
    Object.assign(slot_el.style, {left: box_left + 'px', top: box_top + 'px', width: item_width + 'px', height: item_height + 'px'});
    dragging_el.style.transform = 'translate(' + (drag_options.one_axis ? 0 : last_x - offset_x - box_left) + 'px, ' + (last_y - offset_y - box_top) + 'px)';
  }
  function cancel_press() { if (!pressed) return; clearTimeout(pressed.timer); pressed.item_el.classList.remove('holding'); pressed.wave_el.remove(); pressed = null; }
  function lift_item() {
    const item_el = pressed.item_el, item_rect = item_el.getBoundingClientRect(), wave_el = pressed.wave_el;
    try { root_el.setPointerCapture(pressed.pointer_id); } catch (capture_err) {}
    clearTimeout(pressed.timer); pressed = null;
    if (document.activeElement && item_el.contains(document.activeElement)) document.activeElement.blur();
    dragging_el = item_el; item_el.hold_wave = wave_el; origin = {parent_el: item_el.parentNode, next_el: item_el.nextSibling}; offset_x = last_x - item_rect.left; offset_y = last_y - item_rect.top; quiet_until = Infinity; carrying_count++; has_moved = false; lift_x = last_x; lift_y = last_y; if (drag_options.on_lift) drag_options.on_lift(item_el);
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
