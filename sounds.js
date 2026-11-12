// Sounds, all made in the browser with Web Audio, so there are no files to load. Settings › Sound (and the eye button) picks Off, Right and wrong (the usual), or Everything, plus a sound set and volume.
// Every sound has a name: right, wrong, flip (a card turns over), turn (next card), back (previous card), tap (a button), type (a key in an answer), tile (a tile turns up), tick (the wheel), finish (a reward).
const SOUND_LEVELS = [{value: 'off', label: 'Off'}, {value: 'on', label: 'Answers'}, {value: 'all', label: 'All'}], SOUND_KEY = 'open-flashcards:sound', SOUND_SET_KEY = 'open-flashcards:sound-set', SOUND_VOLUME_KEY = 'open-flashcards:sound-volume', ANSWER_SOUNDS = ['right', 'wrong'];
let sound_context = null, sound_out = null, noise_buffer = null;
function stored_sound(storage_key, fallback_value) { try { return localStorage.getItem(storage_key) || fallback_value; } catch (storage_err) { return fallback_value; } }
// 'off', 'on' (right and wrong only, as before sound sets) or 'all'.
function sound_level() { return stored_sound(SOUND_KEY, 'on'); }
function sound_is_on() { return sound_level() !== 'off'; }
function sound_set_name() { const set_name = stored_sound(SOUND_SET_KEY, 'chimes'); return SOUND_SETS[set_name] ? set_name : 'chimes'; }
function sound_volume() { const volume_value = Number(stored_sound(SOUND_VOLUME_KEY, '80')); return isNaN(volume_value) ? 0.8 : Math.max(0, Math.min(100, volume_value)) / 100; }
// ---- Building blocks. Times are seconds after now. ----
function tone(start_after, frequency, wave_type, peak_gain, last_for, end_frequency, attack_for) {
  const oscillator = sound_context.createOscillator(), gain_node = sound_context.createGain(), start_at = sound_context.currentTime + start_after;
  oscillator.type = wave_type; oscillator.frequency.setValueAtTime(frequency, start_at);
  if (end_frequency) oscillator.frequency.exponentialRampToValueAtTime(end_frequency, start_at + last_for);
  gain_node.gain.setValueAtTime(0.0001, start_at); gain_node.gain.exponentialRampToValueAtTime(peak_gain, start_at + (attack_for || 0.008)); gain_node.gain.exponentialRampToValueAtTime(0.0001, start_at + last_for);
  oscillator.connect(gain_node); gain_node.connect(sound_out); oscillator.start(start_at); oscillator.stop(start_at + last_for + 0.02);
}
// Filtered white noise: the rustle, scrape and tap of paper and wood. The filter can sweep from filter_from to filter_to.
function noise(start_after, last_for, peak_gain, filter_type, filter_from, filter_to, attack_for, filter_q) {
  if (!noise_buffer) { noise_buffer = sound_context.createBuffer(1, sound_context.sampleRate, sound_context.sampleRate); const samples = noise_buffer.getChannelData(0); for (let sample_index = 0; sample_index < samples.length; sample_index++) samples[sample_index] = Math.random() * 2 - 1; }
  const source_node = sound_context.createBufferSource(), filter_node = sound_context.createBiquadFilter(), gain_node = sound_context.createGain(), start_at = sound_context.currentTime + start_after;
  source_node.buffer = noise_buffer; source_node.loop = true; filter_node.type = filter_type; filter_node.Q.value = filter_q || 1;
  filter_node.frequency.setValueAtTime(filter_from, start_at); if (filter_to) filter_node.frequency.exponentialRampToValueAtTime(filter_to, start_at + last_for);
  gain_node.gain.setValueAtTime(0.0001, start_at); gain_node.gain.exponentialRampToValueAtTime(peak_gain, start_at + (attack_for || 0.004)); gain_node.gain.exponentialRampToValueAtTime(0.0001, start_at + last_for);
  source_node.connect(filter_node); filter_node.connect(gain_node); gain_node.connect(sound_out); source_node.start(start_at, Math.random() * 0.5); source_node.stop(start_at + last_for + 0.02);
}
// A struck bar: a fundamental with a fast-fading overtone.
function marimba(start_after, frequency, peak_gain) { tone(start_after, frequency, 'sine', peak_gain, 0.45); tone(start_after, frequency * 4, 'sine', peak_gain * 0.25, 0.06); }
function woodblock(start_after, frequency, peak_gain) { tone(start_after, frequency, 'sine', peak_gain, 0.07, frequency * 0.8); noise(start_after, 0.02, peak_gain * 0.5, 'bandpass', frequency * 3, 0, 0.001, 3); }
// A little bell: overtones that don't line up, as a real bell's don't.
function bell(start_after, frequency, peak_gain) { [[1, 1, 1.1], [2.76, 0.4, 0.5], [5.4, 0.15, 0.25]].forEach(([ratio, gain_part, last_for]) => tone(start_after, frequency * ratio, 'sine', peak_gain * gain_part, last_for, 0, 0.003)); }
// ---- The sets ----
const SOUND_SETS = {
  chimes: {label: 'Chimes', sounds: {
    right: () => { tone(0, 1318.5, 'sine', 0.16, 0.5); tone(0, 2637, 'sine', 0.04, 0.25); },
    wrong: () => tone(0, 196, 'sine', 0.14, 0.13),
    flip: () => tone(0, 880, 'sine', 0.06, 0.1, 1320),
    turn: () => { tone(0, 784, 'sine', 0.05, 0.12); tone(0.05, 1046.5, 'sine', 0.05, 0.16); },
    back: () => { tone(0, 1046.5, 'sine', 0.05, 0.12); tone(0.05, 784, 'sine', 0.05, 0.16); },
    tap: () => tone(0, 1760, 'sine', 0.035, 0.05),
    type: () => tone(0, 2200 + Math.random() * 300, 'sine', 0.018, 0.03),
    tile: () => tone(0, 1174.7, 'sine', 0.06, 0.14),
    tick: () => tone(0, 2400, 'sine', 0.03, 0.025),
    finish: () => [1046.5, 1318.5, 1568, 2093].forEach((frequency, note_index) => tone(note_index * 0.09, frequency, 'sine', 0.1, 0.5))}},
  paper: {label: 'Paper', sounds: {
    right: () => { noise(0, 0.05, 0.12, 'bandpass', 2500, 4000, 0.003, 2); noise(0.06, 0.09, 0.14, 'bandpass', 3000, 5500, 0.004, 2); bell(0.12, 1975, 0.07); },
    wrong: () => { noise(0, 0.12, 0.16, 'bandpass', 900, 600, 0.03, 1.5); noise(0.13, 0.12, 0.13, 'bandpass', 800, 550, 0.03, 1.5); },
    flip: () => { noise(0, 0.1, 0.22, 'bandpass', 1800, 3800, 0.01, 1.2); tone(0.08, 130, 'sine', 0.06, 0.05); },
    turn: () => { noise(0, 0.3, 0.2, 'bandpass', 700, 4200, 0.12, 0.9); noise(0.16, 0.14, 0.12, 'highpass', 3000, 6000, 0.02); noise(0.27, 0.05, 0.1, 'lowpass', 1200, 0, 0.004); },
    back: () => { noise(0, 0.28, 0.2, 'bandpass', 4200, 800, 0.1, 0.9); noise(0.25, 0.05, 0.1, 'lowpass', 1200, 0, 0.004); },
    tap: () => { noise(0, 0.018, 0.14, 'highpass', 3500, 0, 0.001); tone(0, 1900, 'triangle', 0.02, 0.02); },
    type: () => { noise(0, 0.03, 0.16, 'bandpass', 2600 + Math.random() * 800, 0, 0.001, 2); tone(0, 150, 'sine', 0.05, 0.04); },
    tile: () => { noise(0, 0.07, 0.18, 'lowpass', 1600, 500, 0.003); tone(0, 110, 'sine', 0.08, 0.06); },
    tick: () => noise(0, 0.015, 0.12, 'bandpass', 3500, 0, 0.001, 3),
    finish: () => { for (let grain_index = 0; grain_index < 9; grain_index++) noise(grain_index * 0.035, 0.05, 0.12, 'bandpass', 2000 + grain_index * 250, 0, 0.003, 1.5); bell(0.36, 1568, 0.08); bell(0.5, 2093, 0.07); }}},
  wood: {label: 'Wood', sounds: {
    right: () => { marimba(0, 784, 0.16); marimba(0.09, 1174.7, 0.16); },
    wrong: () => { woodblock(0, 220, 0.18); woodblock(0.1, 180, 0.14); },
    flip: () => woodblock(0, 880, 0.1),
    turn: () => { woodblock(0, 700, 0.09); woodblock(0.07, 950, 0.09); },
    back: () => { woodblock(0, 950, 0.09); woodblock(0.07, 700, 0.09); },
    tap: () => woodblock(0, 1250, 0.06),
    type: () => woodblock(0, 1500 + Math.random() * 200, 0.035),
    tile: () => marimba(0, 587.3, 0.1),
    tick: () => woodblock(0, 1600, 0.05),
    finish: () => [523.3, 659.3, 784, 1046.5, 1318.5].forEach((frequency, note_index) => marimba(note_index * 0.08, frequency, 0.14))}},
  arcade: {label: 'Arcade', sounds: {
    right: () => { tone(0, 784, 'square', 0.05, 0.07); tone(0.07, 1174.7, 'square', 0.05, 0.22); },
    wrong: () => tone(0, 220, 'square', 0.05, 0.22, 110),
    flip: () => tone(0, 400, 'square', 0.035, 0.07, 800),
    turn: () => tone(0, 300, 'triangle', 0.09, 0.1, 900),
    back: () => tone(0, 900, 'triangle', 0.09, 0.1, 300),
    tap: () => tone(0, 1000, 'square', 0.025, 0.025),
    type: () => tone(0, 1400 + Math.random() * 400, 'square', 0.014, 0.015),
    tile: () => tone(0, 660, 'square', 0.035, 0.06, 990),
    tick: () => tone(0, 1800, 'square', 0.02, 0.012),
    finish: () => [523.3, 659.3, 784, 1046.5, 1318.5, 1568].forEach((frequency, note_index) => tone(note_index * 0.07, frequency, 'square', 0.045, note_index === 5 ? 0.35 : 0.08))}}
};
function sound_ready() {
  if (!(window.AudioContext || window.webkitAudioContext)) return false;
  sound_context = sound_context || new (window.AudioContext || window.webkitAudioContext)();
  if (sound_context.state === 'suspended') sound_context.resume();
  if (!sound_out) { sound_out = sound_context.createGain(); sound_out.connect(sound_context.destination); }
  sound_out.gain.value = sound_volume() * 1.25;
  return true;
}
// Right and wrong play unless sound is off; everything else only with Everything. preview_set plays a set whatever the level, to try it out.
function play_sound(sound_name, start_after, preview_set) {
  const level_now = sound_level();
  if (!preview_set && (level_now === 'off' || (level_now !== 'all' && !ANSWER_SOUNDS.includes(sound_name)))) return;
  try {
    if (!sound_ready()) return;
    const run_sound = SOUND_SETS[preview_set || sound_set_name()].sounds[sound_name];
    if (!start_after) return run_sound();
    setTimeout(() => { try { run_sound(); } catch (sound_err) {} }, start_after * 1000);
  } catch (sound_err) {}
}
function preview_sound_set(set_name) { ['flip', 'turn', 'tap', 'right'].forEach((sound_name, sound_index) => play_sound(sound_name, sound_index * 0.38, set_name)); }
// The wheel ticks as each slice passes the pointer, slowing as the wheel does. Follows .wheel-disc's transition: 3.2s cubic-bezier(.12, .7, .15, 1).
function wheel_ticks(turn_degrees, slice_degrees) {
  if (sound_level() !== 'all') return;
  const bezier_at = (part_time, first_point, second_point) => 3 * (1 - part_time) * (1 - part_time) * part_time * first_point + 3 * (1 - part_time) * part_time * part_time * second_point + part_time * part_time * part_time, tick_count = Math.min(80, Math.floor(turn_degrees / slice_degrees));
  let curve_time = 0;
  for (let tick_index = 1; tick_index <= tick_count; tick_index++) {
    const wanted_progress = tick_index * slice_degrees / turn_degrees;
    while (curve_time < 1 && bezier_at(curve_time, 0.7, 1) < wanted_progress) curve_time += 0.002;
    play_sound('tick', 3.2 * bezier_at(curve_time, 0.12, 0.15));
  }
}
// A tap for any button, link or tick box. Places with sounds of their own are left out.
document.addEventListener('click', click_event => {
  const pressed_el = click_event.target.closest && click_event.target.closest('button, a[href], input[type=checkbox], input[type=radio], summary, select');
  if (!pressed_el || pressed_el.closest('.flashcard, .study-buttons, .study-nav, .memory-tile, .spin-button, .sound-sets') || pressed_el.disabled || pressed_el.type === 'submit') return;
  play_sound('tap');
}, true);
// A key while typing an answer.
document.addEventListener('keydown', key_event => {
  if (!location.hash.startsWith('#/play/') || !key_event.target.matches || !key_event.target.matches('input[type=text], input:not([type]), textarea') || key_event.ctrlKey || key_event.metaKey) return;
  if (key_event.key.length === 1 || key_event.key === 'Backspace') play_sound('type');
}, true);
// Settings › Sound: when, which set, how loud. Picking a set plays a few of its sounds.
function sound_section() {
  const save_sound = (storage_key, chosen_value) => { try { localStorage.setItem(storage_key, chosen_value); } catch (storage_err) {} status_el.textContent = sound_status(); };
  const sound_status = () => sound_level() === 'off' ? 'Off' : SOUND_SETS[sound_set_name()].label + (sound_level() === 'all' ? ', everything' : ', right and wrong');
  const status_el = el('span', {class: 'settings-panel-status'}, sound_status());
  function pick_row(storage_key, current_value, choices, after_pick) { const buttons = choices.map(choice_item => el('button', {'aria-pressed': String(choice_item.value === current_value), onclick: () => { save_sound(storage_key, choice_item.value); buttons.forEach((button_el, button_index) => button_el.setAttribute('aria-pressed', String(choices[button_index].value === choice_item.value))); if (after_pick) after_pick(choice_item.value); }}, choice_item.label)); return el('div', {class: 'direction-switch sound-sets', role: 'group'}, ...buttons); }
  return settings_panel('sound', 'Sound', status_el, {class: 'settings-panel sound-section'},
    el('div', {class: 'detail-row'}, el('div', {class: 'line-margin'}, 'Play'), el('div', {class: 'settings-line'}, pick_row(SOUND_KEY, sound_level(), [{value: 'off', label: 'Off'}, {value: 'on', label: 'Right and wrong'}, {value: 'all', label: 'Everything'}], level_now => { if (level_now === 'all') play_sound('turn'); else if (level_now === 'on') play_sound('right'); }))),
    el('div', {class: 'detail-row'}, el('div', {class: 'line-margin'}, 'Set'), el('div', {class: 'settings-line'}, pick_row(SOUND_SET_KEY, sound_set_name(), Object.keys(SOUND_SETS).map(set_name => ({value: set_name, label: SOUND_SETS[set_name].label})), preview_sound_set))),
    el('div', {class: 'detail-row'}, el('div', {class: 'line-margin'}, 'Volume'), el('label', {class: 'settings-line'}, el('input', {type: 'range', min: 0, max: 100, step: 5, value: Math.round(sound_volume() * 100), 'aria-label': 'Volume', class: 'sound-volume', onchange: change_event => { save_sound(SOUND_VOLUME_KEY, change_event.target.value); play_sound('right', 0, sound_set_name()); }}))));
}
