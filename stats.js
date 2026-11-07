// Stats: day streak, the last 12 weeks as a calendar, weekly trends, and accuracy by set. Daily counts come from each set's daily_stats (kept since 1.5.00); accuracy by set also counts older answers, from each card's progress.
const STATS_WEEKS = 12, STATS_DAY_MS = 86400000, MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function el_with(tag_name, attributes, child_list) { return el.apply(null, [tag_name, attributes].concat(child_list)); }
function local_day(day_text) { const day_parts = day_text.split('-').map(Number); return new Date(day_parts[0], day_parts[1] - 1, day_parts[2]); }
function day_number(day_date) { return Math.round(Date.UTC(day_date.getFullYear(), day_date.getMonth(), day_date.getDate()) / STATS_DAY_MS); }
function add_days(day_date, day_count) { return new Date(day_date.getFullYear(), day_date.getMonth(), day_date.getDate() + day_count); }
function short_date(day_date) { return day_date.getDate() + ' ' + MONTH_NAMES[day_date.getMonth()]; }
function plural(count_value, word_text) { return count_value + ' ' + word_text + (count_value === 1 ? '' : 's'); }
function seconds_text(total_ms, timed_count) { return timed_count ? (total_ms / timed_count / 1000).toFixed(1) + ' s' : '–'; }
function percent_text(right_count, total_count) { return total_count ? Math.round(100 * right_count / total_count) + '%' : '–'; }
function escape_svg(raw_text) { return String(raw_text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

// Every set's days added together: day text -> [right, wrong, timed ms, timed answers].
function all_days() {
  const day_totals = new Map();
  app_state.sets.forEach(card_set => Object.keys(card_set.daily_stats || {}).forEach(day_text => { const set_row = card_set.daily_stats[day_text], total_row = day_totals.get(day_text) || [0, 0, 0, 0]; total_row.forEach((total_value, value_index) => { total_row[value_index] = total_value + (Number(set_row[value_index]) || 0); }); day_totals.set(day_text, total_row); }));
  return day_totals;
}
function answered_on(day_totals, day_date) { const day_row = day_totals.get(day_key(day_date.getTime())); return day_row ? day_row[0] + day_row[1] : 0; }
// A day counts once it has one answer. Today with none yet doesn't break the streak, so it runs from yesterday.
function streaks(day_totals) {
  const today_date = local_day(day_key(Date.now()));
  let cursor_date = answered_on(day_totals, today_date) ? today_date : add_days(today_date, -1), current_streak = 0;
  while (answered_on(day_totals, cursor_date)) { current_streak++; cursor_date = add_days(cursor_date, -1); }
  const studied_numbers = Array.from(day_totals.keys()).filter(day_text => answered_on(day_totals, local_day(day_text))).map(day_text => day_number(local_day(day_text))).sort((number_a, number_b) => number_a - number_b);
  let best_streak = 0, run_length = 0;
  studied_numbers.forEach((day_value, day_index) => { run_length = day_index && day_value === studied_numbers[day_index - 1] + 1 ? run_length + 1 : 1; best_streak = Math.max(best_streak, run_length); });
  return {current_streak, best_streak};
}
function sum_rows(day_totals, from_date, to_date) { const sum_row = [0, 0, 0, 0]; for (let cursor_date = from_date; cursor_date <= to_date; cursor_date = add_days(cursor_date, 1)) { const day_row = day_totals.get(day_key(cursor_date.getTime())); if (day_row) day_row.forEach((day_value, value_index) => { sum_row[value_index] += day_value; }); } return sum_row; }
function week_start(day_date) { return add_days(day_date, -((day_date.getDay() + 6) % 7)); }

// One tooltip for the whole page: anything with data-tip shows it on hover or tap.
function attach_chart_tips(root_el) {
  const tip_el = el('div', {class: 'chart-tip', role: 'tooltip', hidden: 'hidden'});
  root_el.appendChild(tip_el);
  root_el.addEventListener('pointerover', pointer_event => { const tip_target = pointer_event.target.closest('[data-tip]'); if (!tip_target) { tip_el.hidden = true; return; } tip_el.textContent = tip_target.dataset.tip; tip_el.hidden = false; root_el.querySelectorAll('.is-hovered').forEach(hovered_el => hovered_el.classList.remove('is-hovered')); tip_target.classList.add('is-hovered'); });
  root_el.addEventListener('pointermove', pointer_event => { if (tip_el.hidden) return; const tip_width = tip_el.offsetWidth; tip_el.style.left = Math.max(8, Math.min(innerWidth - tip_width - 8, pointer_event.clientX - tip_width / 2)) + 'px'; tip_el.style.top = (pointer_event.clientY - tip_el.offsetHeight - 14) + 'px'; });
  root_el.addEventListener('pointerleave', () => { tip_el.hidden = true; root_el.querySelectorAll('.is-hovered').forEach(hovered_el => hovered_el.classList.remove('is-hovered')); });
}

// The last 12 weeks and this one, a column a week from Monday, darker for more answers.
function streak_calendar(day_totals) {
  const today_date = local_day(day_key(Date.now())), first_monday = add_days(week_start(today_date), -7 * STATS_WEEKS), most_answers = Math.max(1, Math.max.apply(null, Array.from(day_totals.values()).map(day_row => day_row[0] + day_row[1]))), grid_el = el('div', {class: 'calendar-grid', role: 'img'});
  grid_el.appendChild(el('span', {}));
  for (let week_index = 0; week_index <= STATS_WEEKS; week_index++) { const monday_date = add_days(first_monday, 7 * week_index), shows_month = week_index === 0 || monday_date.getDate() <= 7; grid_el.appendChild(el('span', {class: 'calendar-month'}, shows_month ? MONTH_NAMES[monday_date.getMonth()] : '')); }
  ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'].forEach((weekday_text, weekday_index) => {
    grid_el.appendChild(el('span', {class: 'calendar-weekday'}, weekday_text));
    for (let week_index = 0; week_index <= STATS_WEEKS; week_index++) {
      const cell_date = add_days(first_monday, 7 * week_index + weekday_index), day_row = day_totals.get(day_key(cell_date.getTime())), answer_count = day_row ? day_row[0] + day_row[1] : 0;
      if (cell_date > today_date) { grid_el.appendChild(el('span', {class: 'calendar-cell is-future'})); continue; }
      const level_number = answer_count ? Math.max(1, Math.ceil(4 * answer_count / most_answers)) : 0, tip_text = cell_date.toLocaleDateString(undefined, {weekday: 'short', day: 'numeric', month: 'short'}) + ': ' + (answer_count ? plural(answer_count, 'answer') + ', ' + percent_text(day_row[0], answer_count) + ' right' : 'nothing studied');
      grid_el.appendChild(el('span', {class: 'calendar-cell level-' + level_number + (cell_date.getTime() === today_date.getTime() ? ' is-today' : ''), 'data-tip': tip_text}));
    }
  });
  const studied_count = Array.from({length: 7 * (STATS_WEEKS + 1)}, (unused_item, day_index) => add_days(first_monday, day_index)).filter(cell_date => answered_on(day_totals, cell_date)).length;
  grid_el.setAttribute('aria-label', 'Calendar of the last ' + STATS_WEEKS + ' weeks: you studied on ' + plural(studied_count, 'day'));
  return el('div', {class: 'chart-card stats-calendar'}, el('h2', {}, 'Days studied'), grid_el,
    el('div', {class: 'calendar-key', 'aria-hidden': 'true'}, 'Less', el('span', {class: 'calendar-cell level-0'}), el('span', {class: 'calendar-cell level-1'}), el('span', {class: 'calendar-cell level-2'}), el('span', {class: 'calendar-cell level-3'}), el('span', {class: 'calendar-cell level-4'}), 'More'));
}

// A small weekly chart: columns for a count, a line for a rate. Weeks with nothing to show leave a gap. Each week is one hover band.
function nice_top(max_value) { if (max_value <= 0) return 1; const step_size = Math.pow(10, Math.floor(Math.log10(max_value))), nice_steps = [1, 2, 2.5, 5, 10]; return nice_steps.map(step_item => step_item * step_size).find(top_value => top_value >= max_value); }
function week_chart(chart_title, week_list, chart_options) {
  const chart_width = 320, chart_height = 150, pad_left = 30, pad_right = 40, pad_top = 12, pad_bottom = 24, plot_width = chart_width - pad_left - pad_right, plot_height = chart_height - pad_top - pad_bottom, band_width = plot_width / week_list.length;
  const values = week_list.map(week_item => chart_options.value_of(week_item)), top_value = chart_options.top || nice_top(Math.max.apply(null, values.filter(value_item => value_item !== null).concat([0]))), y_of = value_item => pad_top + plot_height - plot_height * value_item / top_value, x_of = week_index => pad_left + band_width * (week_index + 0.5);
  let svg_text = '';
  [0, top_value / 2, top_value].forEach(tick_value => { svg_text += '<line class="chart-grid" x1="' + pad_left + '" x2="' + (chart_width - pad_right) + '" y1="' + y_of(tick_value) + '" y2="' + y_of(tick_value) + '"/><text class="chart-tick" x="' + (pad_left - 6) + '" y="' + (y_of(tick_value) + 4) + '" text-anchor="end">' + chart_options.tick_text(tick_value) + '</text>'; });
  [0, Math.floor(week_list.length / 2), week_list.length - 1].forEach(week_index => { svg_text += '<text class="chart-tick" x="' + x_of(week_index) + '" y="' + (chart_height - 6) + '" text-anchor="middle">' + escape_svg(week_index === week_list.length - 1 ? 'This week' : short_date(week_list[week_index].monday_date)) + '</text>'; });
  if (chart_options.form === 'columns') values.forEach((value_item, week_index) => { if (!value_item) return; const column_width = Math.min(24, band_width * 0.6), column_left = x_of(week_index) - column_width / 2, column_top = y_of(value_item), column_bottom = y_of(0), corner_radius = Math.min(4, column_bottom - column_top); svg_text += '<path class="chart-mark" d="M' + column_left + ' ' + column_bottom + 'V' + (column_top + corner_radius) + 'q0 -' + corner_radius + ' ' + corner_radius + ' -' + corner_radius + 'h' + (column_width - 2 * corner_radius) + 'q' + corner_radius + ' 0 ' + corner_radius + ' ' + corner_radius + 'V' + column_bottom + 'z"/>'; });
  else {
    let path_text = '', is_drawing = false;
    values.forEach((value_item, week_index) => { if (value_item === null) { is_drawing = false; return; } path_text += (is_drawing ? 'L' : 'M') + x_of(week_index) + ' ' + y_of(value_item); is_drawing = true; });
    svg_text += '<path class="chart-line" d="' + path_text + '"/>';
    values.forEach((value_item, week_index) => { if (value_item !== null) svg_text += '<circle class="chart-dot" cx="' + x_of(week_index) + '" cy="' + y_of(value_item) + '" r="4"/>'; });
  }
  const last_index = values.map(value_item => value_item !== null && value_item !== 0).lastIndexOf(true);
  if (last_index >= 0) svg_text += '<text class="chart-end" x="' + (x_of(last_index) + (chart_options.form === 'columns' ? 0 : 8)) + '" y="' + (chart_options.form === 'columns' ? y_of(values[last_index]) - 6 : y_of(values[last_index]) + 4) + '" text-anchor="' + (chart_options.form === 'columns' ? 'middle' : 'start') + '">' + escape_svg(chart_options.label_text(values[last_index])) + '</text>';
  week_list.forEach((week_item, week_index) => { svg_text += '<rect class="chart-band" x="' + (pad_left + band_width * week_index) + '" y="' + pad_top + '" width="' + band_width + '" height="' + plot_height + '" data-tip="' + escape_svg('Week of ' + short_date(week_item.monday_date) + ': ' + (values[week_index] === null ? 'nothing studied' : chart_options.label_text(values[week_index]))) + '"/>'; });
  const chart_el = el('div', {class: 'chart-card'}, el('h2', {}, chart_title));
  chart_el.insertAdjacentHTML('beforeend', '<svg class="week-chart" viewBox="0 0 ' + chart_width + ' ' + chart_height + '" role="img" aria-label="' + escape_svg(chart_title + ', last ' + (STATS_WEEKS + 1) + ' weeks' + (last_index >= 0 ? '. Latest: ' + chart_options.label_text(values[last_index]) : '')) + '">' + svg_text + '</svg>');
  return chart_el;
}

// Accuracy by set, weakest first, from every answer each card has had. Time per answer only counts timed answers, since 1.5.00.
function set_accuracy_rows() {
  return app_state.sets.map(card_set => {
    const progress_records = Object.values(card_set.progress || {}), right_count = progress_records.reduce((count_total, record_item) => count_total + (record_item.right || 0), 0), wrong_count = progress_records.reduce((count_total, record_item) => count_total + (record_item.wrong || 0), 0), timed_row = Object.values(card_set.daily_stats || {}).reduce((sum_row, day_row) => [sum_row[0] + (day_row[2] || 0), sum_row[1] + (day_row[3] || 0)], [0, 0]);
    return {card_set, right_count, total_count: right_count + wrong_count, timed_ms: timed_row[0], timed_count: timed_row[1]};
  }).filter(row_item => row_item.total_count).sort((row_a, row_b) => row_a.right_count / row_a.total_count - row_b.right_count / row_b.total_count);
}
function accuracy_by_set() {
  const accuracy_rows = set_accuracy_rows();
  if (!accuracy_rows.length) return null;
  return el('div', {class: 'chart-card stats-sets'}, el('h2', {}, 'Accuracy by set'), el('p', {class: 'muted chart-note'}, 'Weakest first, so you can see where to practise.'),
    el_with('div', {class: 'accuracy-list'}, accuracy_rows.map(row_item => {
      const accuracy_percent = Math.round(100 * row_item.right_count / row_item.total_count);
      return el('div', {class: 'accuracy-row', 'data-tip': row_item.card_set.title + ': ' + row_item.right_count + ' of ' + plural(row_item.total_count, 'answer') + ' right' + (row_item.timed_count ? ', ' + seconds_text(row_item.timed_ms, row_item.timed_count) + ' per question' : '')},
        el('a', {class: 'accuracy-title', href: '#/set/' + row_item.card_set.id}, row_item.card_set.title),
        el('span', {class: 'accuracy-track'}, el('span', {class: 'accuracy-fill', style: 'width:' + accuracy_percent + '%;background:' + tint_of(row_item.card_set)})),
        el('span', {class: 'accuracy-value'}, el('b', {}, accuracy_percent + '%'), el('span', {class: 'muted'}, ' ' + plural(row_item.total_count, 'answer') + (row_item.timed_count ? ' · ' + seconds_text(row_item.timed_ms, row_item.timed_count) : ''))));
    })));
}

function view_stats() {
  const day_totals = all_days(), streak_counts = streaks(day_totals), today_date = local_day(day_key(Date.now())), month_row = sum_rows(day_totals, add_days(today_date, -29), today_date), month_answers = month_row[0] + month_row[1], this_monday = week_start(today_date);
  const week_list = Array.from({length: STATS_WEEKS + 1}, (unused_item, week_index) => { const monday_date = add_days(this_monday, -7 * (STATS_WEEKS - week_index)); return {monday_date, row: sum_rows(day_totals, monday_date, add_days(monday_date, 6))}; });
  const has_history = day_totals.size > 0, accuracy_el = accuracy_by_set();
  const stats_nodes = [
    el('div', {class: 'stat-strip stats-tiles'},
      el('div', {class: 'stat', style: 'background:#ffc285'}, el('strong', {}, (streak_counts.current_streak ? '🔥 ' : '') + streak_counts.current_streak), (streak_counts.current_streak === 1 ? 'day' : 'days') + ' in a row', el('span', {class: 'stat-sub'}, 'Best: ' + plural(streak_counts.best_streak, 'day'))),
      el('div', {class: 'stat', style: 'background:#8fd3ff'}, el('strong', {}, month_answers.toLocaleString()), 'answers', el('span', {class: 'stat-sub'}, 'Last 30 days')),
      el('div', {class: 'stat', style: 'background:#9be7a8'}, el('strong', {}, percent_text(month_row[0], month_answers)), 'right', el('span', {class: 'stat-sub'}, 'Last 30 days')),
      el('div', {class: 'stat', style: 'background:#c3a6ff'}, el('strong', {}, seconds_text(month_row[2], month_row[3])), 'per question', el('span', {class: 'stat-sub'}, 'Last 30 days')))
  ];
  if (has_history) {
    stats_nodes.push(el('div', {class: 'stats-top'}, streak_calendar(day_totals), accuracy_el));
    stats_nodes.push(el('div', {class: 'chart-row'},
      week_chart('Answers each week', week_list, {form: 'columns', value_of: week_item => week_item.row[0] + week_item.row[1], tick_text: tick_value => Math.round(tick_value).toLocaleString(), label_text: value_item => value_item.toLocaleString()}),
      week_chart('Right each week', week_list, {form: 'line', top: 100, value_of: week_item => week_item.row[0] + week_item.row[1] ? Math.round(100 * week_item.row[0] / (week_item.row[0] + week_item.row[1])) : null, tick_text: tick_value => tick_value + '%', label_text: value_item => value_item + '%'}),
      week_chart('Seconds per question', week_list, {form: 'line', value_of: week_item => week_item.row[3] ? week_item.row[2] / week_item.row[3] / 1000 : null, tick_text: tick_value => String(Math.round(tick_value * 10) / 10), label_text: value_item => value_item.toFixed(1) + ' s'})));
  } else stats_nodes.push(el('p', {class: 'empty-note'}, app_state.sets.length ? 'Answer a few questions in any set, and your streak, calendar and weekly trends start here.' : 'No sets yet. Make one with + on Home, then your stats start here.'), accuracy_el);
  const page_el = el_with('div', {class: 'stats-page'}, stats_nodes.filter(Boolean));
  render([menu_crumb('stats', '#/stats')], [], [page_el]);
  attach_chart_tips(page_el);
}
