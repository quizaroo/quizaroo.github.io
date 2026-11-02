// The admin page at /admin. It signs in the way the app does (the password never leaves this page), and everything it shows comes from /api/admin.
const TOKEN_KEY = 'open-flashcards-admin-token', page_el = document.getElementById('page');
let token = sessionStorage.getItem(TOKEN_KEY), list_state = null;

// Everything from the server goes in as text, never as HTML: emails are whatever people typed.
function el(tag_name, attributes, ...children) {
  const node_el = document.createElement(tag_name);
  Object.entries(attributes || {}).forEach(([attr_name, attr_value]) => { if (attr_name.startsWith('on')) node_el.addEventListener(attr_name.slice(2), attr_value); else if (attr_name === 'checked' || attr_name === 'disabled') node_el[attr_name] = !!attr_value; else if (attr_name === 'value') node_el.value = attr_value; else if (attr_value !== null) node_el.setAttribute(attr_name, attr_value); });
  children.flat().forEach(child_item => { if (child_item !== null && child_item !== undefined && child_item !== false) node_el.append(child_item); });
  return node_el;
}
async function api(method_name, path_text, body_value) {
  const response = await fetch(path_text, {method: method_name, headers: {'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {})}, body: body_value ? JSON.stringify(body_value) : undefined});
  const reply = await response.json().catch(() => ({}));
  if (!response.ok) { const api_err = new Error(reply.error || 'Server said ' + response.status); api_err.status = response.status; throw api_err; }
  return reply;
}
const to_base64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const from_base64 = text => Uint8Array.from(atob(text), one_char => one_char.charCodeAt(0));
async function make_login_hash(password_text, kdf) {
  const encoder = new TextEncoder(), password_key = await crypto.subtle.importKey('raw', encoder.encode(password_text), 'PBKDF2', false, ['deriveBits']);
  const master_key = new Uint8Array(await crypto.subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt: from_base64(kdf.salt), iterations: kdf.iterations}, password_key, 256));
  const master_base = await crypto.subtle.importKey('raw', master_key, 'PBKDF2', false, ['deriveBits']);
  return to_base64(await crypto.subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(password_text), iterations: 1}, master_base, 256));
}
function forget_token() { token = null; sessionStorage.removeItem(TOKEN_KEY); }

function draw_sign_in(message_text) {
  const email_el = el('input', {type: 'email', autocomplete: 'username', required: 'required'}), password_el = el('input', {type: 'password', autocomplete: 'current-password', required: 'required'}), message_el = el('p', {class: 'error'}, message_text || ''), button_el = el('button', {class: 'primary'}, 'Sign in');
  page_el.replaceChildren(el('h1', {}, 'Open Flashcards admin'), el('p', {class: 'muted'}, 'Sign in with your Open Flashcards account.'),
    el('div', {class: 'stack'}, el('label', {}, 'Email', email_el), el('label', {}, 'Password', password_el), el('div', {class: 'row'}, button_el), message_el));
  const sign_in = async () => {
    message_el.textContent = ''; button_el.disabled = true; button_el.textContent = 'Signing in…';
    try {
      const email_text = email_el.value.trim(), prelogin_reply = await api('POST', '/api/prelogin', {email: email_text});
      const login_reply = await api('POST', '/api/login', {email: email_text, auth_hash: await make_login_hash(password_el.value, prelogin_reply.kdf), device_name: 'Admin page'});
      token = login_reply.token; sessionStorage.setItem(TOKEN_KEY, token);
      await load_list();
    } catch (sign_in_err) {
      if (sign_in_err.status === 403) { await api('POST', '/api/logout').catch(() => {}); forget_token(); }
      button_el.disabled = false; button_el.textContent = 'Sign in'; message_el.textContent = sign_in_err.message;
    }
  };
  button_el.addEventListener('click', sign_in);
  [email_el, password_el].forEach(input_el => input_el.addEventListener('keydown', key_event => { if (key_event.key === 'Enter') sign_in(); }));
  email_el.focus();
}

async function load_list() {
  try { list_state = await api('GET', '/api/admin/accounts'); draw_list(); } catch (load_err) {
    if (load_err.status === 401) { forget_token(); return draw_sign_in('Signed out. Sign in again.'); }
    throw load_err;
  }
}
const size_text = byte_count => (byte_count < 1048576 ? Math.ceil(byte_count / 1024) + ' KB' : (byte_count / 1048576).toFixed(1) + ' MB');
function when_text(iso_time) {
  if (!iso_time) return 'never';
  const minutes_ago = Math.round((Date.now() - Date.parse(iso_time)) / 60000);
  return minutes_ago < 2 ? 'just now' : minutes_ago < 60 ? minutes_ago + ' min ago' : minutes_ago < 2880 ? Math.round(minutes_ago / 60) + ' hours ago' : new Date(iso_time).toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric'});
}
// Runs a change, then draws what the server now says. Trouble shows at the top.
async function act(run_change) {
  try { await run_change(); await load_list(); } catch (act_err) { const message_el = document.getElementById('message'); if (message_el) { message_el.textContent = act_err.message; message_el.scrollIntoView({block: 'center'}); } }
}
function stat(number_text, label_text) { return el('div', {class: 'stat'}, el('strong', {}, number_text), label_text); }
const BUSY_REQUESTS = 20000, BUSY_BYTES = 50 * 1048576, NEAR_LIMIT = 0.8;
let sort_by = 'newest', filter_text = '';
const selected = new Set();
const SORTS = {newest: (a, b) => (a.created_at < b.created_at ? 1 : -1), stored: (a, b) => b.stored_bytes - a.stored_bytes, full: (a, b) => fullness(b) - fullness(a), active: (a, b) => b.requests_today - a.requests_today || b.bytes_in_today - a.bytes_in_today, sent: (a, b) => b.bytes_in_week - a.bytes_in_week, email: (a, b) => a.email.localeCompare(b.email)};
const fullness = account => (account.is_admin || !account.quota_bytes ? 0 : account.stored_bytes / account.quota_bytes);
// Things worth a look.
function warnings(account) {
  if (account.is_admin) return [];
  const found = [];
  if (account.refused_today) found.push(['Hit its limit today (' + account.refused_today + ')', 'bad']);
  else if (fullness(account) >= NEAR_LIMIT) found.push(['Near its limit', 'warn']);
  if (account.requests_today > BUSY_REQUESTS) found.push(['Very busy today', 'bad']);
  if (account.bytes_in_today > BUSY_BYTES) found.push(['Sent a lot today', 'bad']);
  return found;
}
function draw_list() {
  const state = list_state, is_open = state.registration !== 'closed', limit_el = el('input', {type: 'number', min: '0', max: '1000', value: state.signup_limit, 'aria-label': 'New accounts a day'});
  state.list.forEach(account => { if (account.is_admin) selected.delete(account.email); });
  const known_emails = new Set(state.list.map(account => account.email));
  selected.forEach(email_text => { if (!known_emails.has(email_text)) selected.delete(email_text); });
  // The page stays put when it's drawn again after a change.
  const scroll_top = window.scrollY;

  const all_off_panel = el('div', {class: 'all-off' + (state.all_off ? ' is-off' : '')},
    el('div', {}, el('strong', {}, state.all_off ? 'Everything is OFF' : 'All off'), el('p', {class: 'muted'}, state.all_off ? 'Nobody but you can sync, sign in or sign up. Nothing has been deleted.' : "Stops everyone's sync, sign-in and sign-up straight away, except yours. Nothing is deleted, and their devices keep their copies.")),
    el('button', {class: state.all_off ? 'primary big' : 'danger-solid big', onclick: () => { if (state.all_off ? confirm('Turn sync back on for everyone?') : confirm('Turn everything off for everyone?')) act(() => api('POST', '/api/admin/all-off', {off: !state.all_off})); }}, state.all_off ? 'Turn back on' : 'ALL OFF'));

  const sign_ups = [
    el('h2', {}, 'Sign-ups'),
    el('p', {}, state.all_off ? 'Closed while everything is off.' : is_open ? (state.registration_now === 'open' ? 'Open: new people can create an account.' : "Open, but today's sign-ups have all gone. They start again at midnight UTC.") : 'Closed: nobody new can create an account.'),
    el('div', {class: 'row'}, el('button', {class: is_open ? 'danger' : 'primary', onclick: () => act(() => api('POST', '/api/admin/registration', {state: is_open ? 'closed' : 'open'}))}, is_open ? 'Close sign-ups' : 'Open sign-ups'),
      el('label', {}, 'New accounts a day', limit_el), el('button', {onclick: () => act(() => api('POST', '/api/admin/registration', {limit: Number(limit_el.value)}))}, 'Save'), el('span', {class: 'muted'}, '0 means no limit.')),
    el('p', {class: 'muted'}, 'Last 7 days: ' + (state.signups_week.map(day_item => day_item.day.slice(5) + ': ' + day_item.n).join(', ') || 'none'))];

  // Accounts
  const filter_el = el('input', {type: 'text', placeholder: 'Find an email', value: filter_text, 'aria-label': 'Find an email', oninput: input_event => { filter_text = input_event.target.value.trim().toLowerCase(); draw_rows(); }});
  const sort_el = el('select', {'aria-label': 'Sort by', onchange: change_event => { sort_by = change_event.target.value; draw_rows(); }}, ...[['newest', 'Newest'], ['stored', 'Most stored'], ['full', 'Closest to limit'], ['active', 'Busiest today'], ['sent', 'Most sent this week'], ['email', 'Email']].map(([sort_key, sort_name]) => el('option', {value: sort_key}, sort_name)));
  sort_el.value = sort_by;
  const select_all_el = el('input', {type: 'checkbox', 'aria-label': 'Select everyone shown', onchange: change_event => { shown_accounts().forEach(account => { if (!account.is_admin) { if (change_event.target.checked) selected.add(account.email); else selected.delete(account.email); } }); draw_rows(); }});
  const body_el = el('tbody'), count_el = el('span', {class: 'muted'});
  const shown_accounts = () => state.list.filter(account => !filter_text || account.email.includes(filter_text)).sort(SORTS[sort_by]);
  function account_row(account) {
    const quota_text = account.is_admin ? 'no limit' : size_text(account.quota_bytes) + (account.quota_mb === null ? '' : ' (own)');
    return el('tr', {},
      el('td', {}, account.is_admin ? null : el('input', {type: 'checkbox', checked: selected.has(account.email), 'aria-label': 'Select ' + account.email, onchange: change_event => { if (change_event.target.checked) selected.add(account.email); else selected.delete(account.email); paint_count(); }})),
      el('td', {class: 'email'}, account.email, account.is_new ? el('span', {class: 'tag'}, 'new') : null, account.email_confirmed_at ? el('span', {class: 'tag plain'}, 'confirmed') : null, account.is_admin ? el('span', {class: 'tag plain'}, 'you') : null, warnings(account).map(([warning_text, warning_kind]) => el('span', {class: 'tag ' + warning_kind}, warning_text))),
      el('td', {}, el('input', {type: 'checkbox', checked: account.is_admin || account.whitelisted, disabled: account.is_admin, 'aria-label': 'Whitelist ' + account.email, onchange: change_event => act(() => api('POST', '/api/admin/whitelist', {op: change_event.target.checked ? 'add' : 'remove', emails: [account.email]}))})),
      el('td', {}, when_text(account.created_at), account.under_a_day ? el('span', {class: 'tag plain'}, 'under 24 h') : null),
      el('td', {}, when_text(account.last_seen)), el('td', {}, account.devices),
      el('td', {}, size_text(account.stored_bytes) + (account.is_admin ? '' : ' of ' + quota_text), account.is_admin ? null : el('div', {class: 'meter'}, el('div', {style: null, class: 'meter-fill', 'data-width': Math.min(100, Math.round(fullness(account) * 100))}))),
      el('td', {}, account.records + (account.files ? ' + ' + account.files + ' files' : '')),
      el('td', {}, account.requests_today), el('td', {}, size_text(account.bytes_in_today)), el('td', {}, size_text(account.bytes_in_week)),
      el('td', {}, account.is_admin ? null : el('button', {class: 'danger', onclick: () => { if (confirm('Delete ' + account.email + ' and everything stored for it? This cannot be undone.' + (account.under_a_day ? '\n\nThis account is under 24 hours old.' : ''))) act(() => api('POST', '/api/admin/delete', {email: account.email})); }}, 'Delete')));
  }
  function paint_count() { count_el.textContent = selected.size + ' selected'; }
  function draw_rows() {
    body_el.replaceChildren(...shown_accounts().map(account_row));
    // A style attribute is refused by this page's security policy, so widths are set from script.
    body_el.querySelectorAll('.meter-fill').forEach(fill_el => { fill_el.style.width = fill_el.dataset.width + '%'; fill_el.classList.toggle('is-full', Number(fill_el.dataset.width) >= 80); });
    paint_count();
  }

  // Quotas
  const target_el = el('select', {'aria-label': 'Who to change'}, el('option', {value: 'selected'}, 'Selected accounts'), el('option', {value: 'all'}, 'Everyone'));
  const op_el = el('select', {'aria-label': 'What to do'}, el('option', {value: 'set'}, 'Set to (MB)'), el('option', {value: 'add'}, 'Raise or lower by (MB)'), el('option', {value: 'percent'}, 'Raise or lower by (%)'), el('option', {value: 'reset'}, 'Back to the default'));
  const amount_el = el('input', {type: 'number', step: 'any', value: '5', 'aria-label': 'Amount'});
  const apply_quota = (op_name, value_number) => {
    const for_everyone = target_el.value === 'all', who_text = for_everyone ? 'everyone' : selected.size + ' selected account(s)';
    if (!for_everyone && !selected.size) { document.getElementById('message').textContent = 'Select some accounts first.'; return; }
    const what_text = {set: 'Set to ' + value_number + ' MB', add: (value_number < 0 ? 'Lower' : 'Raise') + ' by ' + Math.abs(value_number) + ' MB', percent: (value_number < 0 ? 'Lower' : 'Raise') + ' by ' + Math.abs(value_number) + '%', reset: 'Put back to the default'}[op_name];
    if (confirm(what_text + ' for ' + who_text + '?')) act(() => api('POST', '/api/admin/quota', {op: op_name, value: value_number, ...(for_everyone ? {all: true} : {emails: Array.from(selected)})}));
  };
  const default_el = el('input', {type: 'number', step: 'any', min: '0', value: state.quota_mb, 'aria-label': 'Default limit in MB'});
  const templates_el = el('textarea', {rows: '3', 'aria-label': 'Templates, one per line: name, then MB', spellcheck: 'false'});
  templates_el.value = state.templates.map(item => item.name + ', ' + item.mb).join('\n');
  const quotas = [
    el('h2', {}, 'Quotas'),
    el('p', {class: 'muted'}, 'Applies to the accounts ticked in the first column, or to everyone. Your own account has no limit. Lowering a limit never deletes anything: an account over it just stops syncing new data.'),
    el('div', {class: 'row'}, target_el, op_el, amount_el, el('button', {class: 'primary', onclick: () => apply_quota(op_el.value, Number(amount_el.value))}, 'Apply')),
    el('div', {class: 'row'}, el('span', {class: 'muted'}, 'Templates:'), state.templates.map(item => el('button', {onclick: () => apply_quota('set', item.mb)}, item.name + ' (' + item.mb + ' MB)'))),
    el('div', {class: 'row'}, el('label', {}, 'Default limit (MB), for every account without its own', default_el), el('button', {onclick: () => act(() => api('POST', '/api/admin/quota-defaults', {default_mb: Number(default_el.value)}))}, 'Save')),
    el('details', {}, el('summary', {}, 'Edit templates'), el('p', {class: 'muted'}, 'One per line: name, then MB.'), templates_el, el('div', {class: 'row'}, el('button', {onclick: () => act(() => api('POST', '/api/admin/quota-defaults', {templates: templates_el.value.split('\n').map(line_text => { const line_parts = line_text.split(','); return {name: line_parts[0], mb: Number(line_parts[1])}; }).filter(item => item.name.trim())}))}, 'Save templates')))];

  // Whitelist
  const emails_in = text_value => text_value.split(/[\s,;]+/).filter(Boolean);
  const whitelist_el = el('textarea', {rows: '5', spellcheck: 'false', 'aria-label': 'Whitelist', placeholder: 'Email addresses, one per line'});
  whitelist_el.value = state.whitelist.join('\n');
  const new_emails_el = el('textarea', {rows: '2', spellcheck: 'false', 'aria-label': 'Addresses to add or remove', placeholder: 'Addresses to add or remove'});
  const unlisted = state.list.filter(account => !account.is_admin && !account.whitelisted), old_unlisted = unlisted.filter(account => !account.under_a_day), include_new_el = el('input', {type: 'checkbox'}), confirm_el = el('input', {type: 'text', placeholder: 'Type DELETE', 'aria-label': 'Type DELETE to confirm'}), doomed_el = el('p', {class: 'muted'});
  const delete_button = el('button', {class: 'danger-solid', onclick: () => act(async () => {
    const delete_reply = await api('POST', '/api/admin/delete-unlisted', {confirm: confirm_el.value, include_new: include_new_el.checked});
    alert('Deleted ' + delete_reply.deleted.length + ' account(s).');
  })}, 'Delete all accounts except the whitelist');
  const show_doomed = () => { const doomed_list = include_new_el.checked ? unlisted : old_unlisted; doomed_el.textContent = doomed_list.length + ' account(s) would be deleted' + (doomed_list.length ? ': ' + doomed_list.slice(0, 20).map(account => account.email).join(', ') + (doomed_list.length > 20 ? ' and more' : '') : '') + '.' + (include_new_el.checked || unlisted.length === old_unlisted.length ? '' : ' ' + (unlisted.length - old_unlisted.length) + ' under 24 hours old would stay.'); delete_button.disabled = !doomed_list.length || confirm_el.value !== 'DELETE'; };
  include_new_el.addEventListener('change', show_doomed); confirm_el.addEventListener('input', show_doomed);
  const whitelist_section = [
    el('h2', {}, 'Whitelist'),
    el('p', {class: 'muted'}, "Addresses to keep, whether or not they have an account yet. Your own account is always kept."),
    el('div', {class: 'two-up'},
      el('div', {}, el('p', {class: 'muted'}, 'The whole list (' + state.whitelist.length + ')'), whitelist_el, el('div', {class: 'row'}, el('button', {onclick: () => { const replacing = emails_in(whitelist_el.value); if (confirm('Replace the whole whitelist with these ' + replacing.length + ' address(es)?')) act(() => api('POST', '/api/admin/whitelist', {op: 'replace', emails: replacing})); }}, 'Replace the whole list'))),
      el('div', {}, el('p', {class: 'muted'}, 'Add or remove some'), new_emails_el, el('div', {class: 'row'}, el('button', {class: 'primary', onclick: () => act(() => api('POST', '/api/admin/whitelist', {op: 'add', emails: emails_in(new_emails_el.value)}))}, 'Add'), el('button', {onclick: () => act(() => api('POST', '/api/admin/whitelist', {op: 'remove', emails: emails_in(new_emails_el.value)}))}, 'Remove')))),
    el('div', {class: 'panel danger-panel'}, el('strong', {}, 'Delete all accounts except the whitelist'), el('p', {class: 'muted'}, "Deletes each account that isn't whitelisted, and all its data on the server. People's own devices keep their copies. This cannot be undone."),
      el('div', {class: 'row'}, el('label', {}, include_new_el, 'Include accounts under 24 hours old'), confirm_el, delete_button), doomed_el)];

  page_el.replaceChildren(
    el('div', {class: 'row spread'}, el('h1', {}, 'Open Flashcards admin'), el('div', {class: 'row'}, el('button', {onclick: () => act(() => Promise.resolve())}, 'Refresh'), el('button', {onclick: async () => { await api('POST', '/api/logout').catch(() => {}); forget_token(); draw_sign_in(); }}, 'Sign out'))),
    el('p', {class: 'error', id: 'message'}),
    all_off_panel,
    el('div', {class: 'stats'}, stat(state.accounts, 'accounts'), stat(size_text(state.stored_bytes), 'stored'), stat(state.signups_today + (state.signup_limit ? ' of ' + state.signup_limit : ''), 'sign-ups today'), stat(state.requests_today, 'requests today'), stat(size_text(state.bytes_in_today), 'sent today'), stat(state.refused_today, 'refused at limit today'), stat(state.quota_mb + ' MB', 'default limit'), stat((state.disk_free_bytes / 1073741824).toFixed(1) + ' GB', 'disk free')),
    ...sign_ups,
    el('h2', {}, 'Accounts'),
    el('p', {class: 'muted'}, "Everyone's data is encrypted, so only its size and activity show here."),
    el('div', {class: 'row'}, filter_el, el('label', {}, 'Sort by', sort_el), count_el),
    el('div', {class: 'table-wrap'}, el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, select_all_el), ['Email', 'Whitelist', 'Created', 'Last used', 'Devices', 'Stored', 'Records', 'Requests today', 'Sent today', 'Sent this week', ''].map(heading_text => el('th', {}, heading_text)))), body_el)),
    ...quotas, ...whitelist_section);
  draw_rows(); show_doomed();
  window.scrollTo(0, scroll_top);
}
if (token) load_list().catch(() => { forget_token(); draw_sign_in("Couldn't load the accounts."); }); else draw_sign_in();
