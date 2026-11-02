// The pill at the top right and the Sync section of Settings: sign in (or create the account on a fresh server), then it runs by itself.
const SYNC_FORM_KEY = 'open-flashcards:sync-form', PANELS_KEY = 'open-flashcards:settings-open', CONTACT_EMAIL = 'hazymat@gmail.com';
// An expandable panel in Settings: a title and a basic status while closed. Whether it's open is remembered on this device.
function settings_panel(panel_key, title_text, status_el, panel_attributes, ...body_nodes) {
  let open_panels = {};
  try { open_panels = JSON.parse(localStorage.getItem(PANELS_KEY)) || {}; } catch (storage_err) {}
  const panel_el = el('details', Object.assign({class: 'settings-panel'}, panel_attributes), el('summary', {}, el('span', {class: 'settings-panel-title'}, title_text), status_el), el('div', {class: 'settings-panel-body'}, ...body_nodes));
  panel_el.open = !!open_panels[panel_key];
  panel_el.addEventListener('toggle', () => { open_panels[panel_key] = panel_el.open; try { localStorage.setItem(PANELS_KEY, JSON.stringify(open_panels)); } catch (storage_err) {} });
  return panel_el;
}
function sync_pill() {
  const pill_el = document.getElementById('sync-status');
  const settings_nav_el = document.querySelector('.nav-item[data-nav="settings"]');
  sync_engine.on_status(sync_status => {
    settings_nav_el.classList.toggle('has-alert', !!(sync_status.admin && sync_status.admin.new_accounts));
    const pill_text = {off: 'Local only', idle: 'Sync on', syncing: 'Syncing…', ok: 'In sync', offline: 'Offline', error: 'Sync problem'}[sync_status.state] || 'Local only';
    pill_el.textContent = sync_status.state === 'ok' && sync_status.pending ? sync_status.pending + ' to sync' : pill_text;
    pill_el.dataset.state = sync_status.state;
    pill_el.title = sync_status.state === 'off' ? 'Stored on this device only' : sync_status.error || pill_text;
  });
}
// Safari can clear a website's saved data after about a week away from it. Added to the Home Screen, the app is kept. Shown once per device until dismissed, only in Safari on an iPhone or iPad.
const HOME_SCREEN_TIP_KEY = 'open-flashcards:home-screen-tip';
function home_screen_tip() {
  const is_ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let was_dismissed = false;
  try { was_dismissed = !!localStorage.getItem(HOME_SCREEN_TIP_KEY); } catch (storage_err) {}
  if (!is_ios || navigator.standalone || was_dismissed) return null;
  const tip_el = el('p', {class: 'sync-note home-screen-tip'}, el('b', {}, 'Keep your sets safe on this device.'), ' Safari can clear saved data after about a week away, so tap Share, then Add to Home Screen, and open the app from there. ', el('button', {class: 'link-button', onclick: () => { try { localStorage.setItem(HOME_SCREEN_TIP_KEY, '1'); } catch (storage_err) {} tip_el.remove(); }}, 'Got it'));
  return tip_el;
}
function typed_sync_form() { try { return JSON.parse(localStorage.getItem(SYNC_FORM_KEY)) || {}; } catch (storage_err) { return {}; } }
function remember_sync_form(form_changes) { try { localStorage.setItem(SYNC_FORM_KEY, JSON.stringify(Object.assign(typed_sync_form(), form_changes))); } catch (storage_err) {} }
function time_ago(iso_time) {
  if (!iso_time) return 'not yet';
  const seconds_ago = Math.round((Date.now() - Date.parse(iso_time)) / 1000);
  return seconds_ago < 5 ? 'just now' : seconds_ago < 60 ? seconds_ago + ' seconds ago' : seconds_ago < 3600 ? Math.round(seconds_ago / 60) + ' min ago' : new Date(iso_time).toLocaleString();
}
const SYNC_LINK_WORDS = {good: 'Connected', slow: 'Connected, slow', weak: 'Weak connection: some requests failing, retrying', down: "Can't reach the server: retrying", unknown: 'Checking…'};
const mb_text = byte_count => (byte_count / 1048576 < 0.1 ? '0.1 MB or less' : (byte_count / 1048576).toFixed(1) + ' MB');
function sync_state_text(sync_status) {
  return {syncing: 'Syncing…', ok: sync_status.pending ? 'Waiting to send ' + sync_status.pending + ' change' + (sync_status.pending === 1 ? '' : 's') : 'In step, as far as this device knows', offline: "Can't reach the server (no signal, or it's down). Changes wait here and go when it can be reached.", error: "Couldn't sync: " + sync_status.error, idle: 'Waiting to sync…'}[sync_status.state] || '';
}
function sync_section() {
  const body_el = el('div', {id: 'sync-body'}), panel_status_el = el('span', {class: 'settings-panel-status', id: 'sync-panel-status'}), section_el = settings_panel('sync', 'Sync', panel_status_el, {class: 'settings-panel sync-section', id: 'sync-section'}, body_el);
  function paint_panel_status(sync_status) {
    const account_now = sync_engine.signed_in();
    panel_status_el.textContent = !account_now ? 'Not signed in: on this device only' : (sync_status.state === 'ok' && !sync_status.pending ? 'In sync' : sync_state_text(sync_status).split('.')[0] || 'Sync on') + ' · ' + account_now.email;
  }
  let was_signed_in = null, data_code_now = null, code_made_at = 0, reach_timer = null, unwatch_status = null;
  // Keep a saved login in the browser (Chrome and Edge ask straight away; Safari and Firefox go by the form being submitted and going away).
  function offer_to_save_login(email_text, password_text) { if (window.PasswordCredential && email_text && password_text && navigator.credentials) navigator.credentials.store(new PasswordCredential({id: email_text, password: password_text, name: email_text})).catch(() => {}); }
  function field(label_text, input_el, label_class) { return el('label', {class: 'sync-field' + (label_class ? ' ' + label_class : '')}, label_text, input_el); }
  function text_input(input_name, extra_attributes) { return el('input', Object.assign({name: input_name, class: 'sync-input', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false'}, extra_attributes)); }
  // Runs a button's work; what goes wrong shows beside it.
  function button_work(button_el, message_el, run_work) {
    return async () => {
      try { await run_work(text => { message_el.textContent = text; }); } catch (work_err) { button_el.disabled = false; message_el.textContent = work_err instanceof TypeError ? "Can't reach the server from here (see above)" : work_err.message; }
    };
  }
  function facts_nodes(sync_status) {
    const all_up = sync_status.state === 'ok' && !sync_status.pending && !sync_status.files_waiting_up, row = (label_text, ...value_nodes) => [el('dt', {}, label_text), el('dd', {}, ...value_nodes)];
    const files_text = sync_status.files === 'error' ? "couldn't sync files: " + sync_status.file_error : sync_status.files_waiting ? sync_status.files_waiting + ' still to arrive or send' + (sync_status.files === 'syncing' ? ' (sending now)' : '') : 'all here';
    return [
      ...row('Now', sync_state_text(sync_status)),
      ...row('Waiting to send', sync_status.pending ? sync_status.pending + ' change' + (sync_status.pending === 1 ? '' : 's') : all_up ? el('span', {}, el('span', {class: 'sync-tick'}, '✓'), ' nothing: everything on this device is on the server') : 'nothing'),
      ...row('Last tried', time_ago(sync_status.tried)),
      ...row('Last finished', time_ago(sync_status.last) + (sync_status.last ? ' (' + (sync_status.received || 0) + ' change' + (sync_status.received === 1 ? '' : 's') + ' came in)' : '')),
      ...row('Server', el('span', {class: 'sync-pulse'}), SYNC_LINK_WORDS[sync_status.link || 'unknown'] + (sync_status.reached ? ' · last answered ' + time_ago(sync_status.reached) : '')),
      ...row('Files', files_text),
      ...(sync_status.usage ? row('Storage', sync_status.usage.limited ? mb_text(sync_status.usage.bytes) + ' of ' + mb_text(sync_status.usage.quota) + ' used' : mb_text(sync_status.usage.bytes) + ' used') : []),
      ...row('Data code', el('span', {id: 'sync-code'}, data_code_now ? el('b', {}, data_code_now.words) : '…', data_code_now ? el('span', {class: 'muted'}, ' (' + data_code_now.records + ' records)') : null))
    ];
  }
  // Only for the server's admin.
  function paint_admin_line(admin_line_el, sync_status) {
    const admin_now = sync_status.admin;
    admin_line_el.hidden = !admin_now;
    if (!admin_now) return;
    admin_line_el.replaceChildren(el('b', {}, 'Your server: '), admin_now.accounts + ' account' + (admin_now.accounts === 1 ? '' : 's') + ', ' + admin_now.signups_today + ' sign-up' + (admin_now.signups_today === 1 ? '' : 's') + ' today' + (admin_now.new_accounts ? ', ' + admin_now.new_accounts + ' new' : '') + (admin_now.all_off ? ', ALL OFF' : '') + ' ', el('a', {href: sync_engine.admin_url(), target: '_blank', rel: 'noopener'}, 'Open admin'));
  }
  function paint_code() {
    if (data_code_now && Date.now() - code_made_at <= 4000) return;
    code_made_at = Date.now();
    sync_engine.data_code().then(made_code => { data_code_now = made_code; const code_el = section_el.querySelector('#sync-code'); if (code_el) code_el.replaceChildren(el('b', {}, made_code.words), el('span', {class: 'muted'}, ' (' + made_code.records + ' records)')); });
  }
  function draw_signed_in() {
    const account_now = sync_engine.signed_in(), message_el = el('span', {class: 'muted', id: 'sync-msg'}), devices_el = el('ul', {class: 'sync-devices'}), old_password_el = text_input('oldpw', {type: 'password', autocomplete: 'current-password'}), new_password_el = text_input('newpw', {type: 'password', autocomplete: 'new-password'});
    devices_el.hidden = true;
    const change_button = el('button', {type: 'submit', class: 'primary'}, 'Change password');
    const password_form = el('form', {class: 'sync-form', onsubmit: submit_event => { submit_event.preventDefault(); button_work(change_button, message_el, async show_message => {
      if (!old_password_el.value || !new_password_el.value) return show_message('Enter your current and new password');
      if (new_password_el.value.length < 10) return show_message('Use at least 10 characters');
      change_button.disabled = true; show_message('Changing…');
      await sync_engine.change_password(old_password_el.value, new_password_el.value);
      offer_to_save_login(account_now.email, new_password_el.value);
      toast('Password changed'); draw();
    })(); }},
      el('input', {type: 'text', name: 'username', autocomplete: 'username', value: account_now.email, hidden: 'hidden'}),
      field('Current password', old_password_el), field('New password', new_password_el),
      el('div', {class: 'button-row'}, change_button, message_el),
      el('p', {class: 'muted'}, "Your other devices are signed out and sign in again with the new password. Your data doesn't change."));
    password_form.hidden = true;
    const facts_el = el('dl', {class: 'sync-facts', id: 'sync-line'}, ...facts_nodes(sync_engine.status)), admin_line_el = el('p', {class: 'sync-admin', id: 'sync-admin'});
    paint_admin_line(admin_line_el, sync_engine.status);
    const devices_button = el('button', {type: 'button', onclick: async () => {
      devices_el.hidden = !devices_el.hidden;
      if (devices_el.hidden) return;
      try { devices_el.replaceChildren(...(await sync_engine.devices()).map(device_item => el('li', {}, device_item.name, device_item.this ? el('span', {class: 'muted'}, ' (this one)') : null, el('span', {class: 'muted'}, ' · last seen ' + time_ago(device_item.last_seen))))); } catch (devices_err) { devices_el.replaceChildren(el('li', {class: 'muted'}, "Can't list them just now.")); }
    }}, 'Devices');
    body_el.replaceChildren(
      el('p', {}, el('b', {}, 'Signed in'), ' as ' + account_now.email, account_now.is_own_server ? el('span', {}, ' on ', el('code', {}, account_now.server.replace(/^https?:\/\//, ''))) : null),
      admin_line_el,
      facts_el,
      el('p', {class: 'muted sync-hint'}, "Two devices showing the same three words hold the same data. Different words: one of them is still catching up (or can't reach the server)."),
      el('div', {class: 'button-row'},
        el('button', {type: 'button', class: 'primary', onclick: () => sync_engine.sync_now()}, 'Sync now'),
        devices_button,
        el('button', {type: 'button', onclick: () => { password_form.hidden = !password_form.hidden; }}, 'Change password'),
        el('button', {type: 'button', onclick: async () => { if (!confirm('Sign out of sync on this device?\n\nEverything stays on this device; it just stops syncing.')) return; await sync_engine.sign_out(); draw(); }}, 'Sign out on this device')),
      devices_el, password_form,
      el('p', {class: 'muted sync-hint'}, "Your data is encrypted on this device before it's sent; the server can't read it. Signing out keeps everything on this device."));
    paint_code();
  }
  function show_recovery_code(code_text) {
    const done_button = el('button', {type: 'button', class: 'primary', disabled: 'disabled', onclick: async () => { await sync_engine.start(); draw(); }}, 'Start syncing');
    body_el.replaceChildren(
      el('p', {}, el('b', {}, 'Account created.'), ' This is your ', el('b', {}, 'recovery code'), '. If you ever forget your password, it is the only way to get your data back. Nobody (not even the server) can reset it for you.'),
      el('pre', {class: 'recovery-code'}, code_text),
      el('div', {class: 'button-row'}, el('button', {type: 'button', onclick: () => navigator.clipboard.writeText(code_text).then(() => toast('Copied'))}, 'Copy'),
        el('label', {class: 'toggle-line'}, el('input', {type: 'checkbox', id: 'code-saved', onchange: change_event => { done_button.disabled = !change_event.target.checked; }}), "I've saved it somewhere safe"), done_button));
  }
  function draw_signed_out() {
    const typed_form = typed_sync_form(), sync_status = sync_engine.status, message_el = el('span', {class: 'muted', id: 'sync-msg'}), recover_message_el = el('span', {class: 'muted'});
    let uses_own_server = !!typed_form.server && typed_form.server !== sync_engine.DEFAULT_SERVER;
    const chosen_server = () => (uses_own_server ? server_el.value.trim() : sync_engine.DEFAULT_SERVER);
    const server_el = text_input('server', {value: uses_own_server ? typed_form.server : '', placeholder: 'https://your-server', inputmode: 'url', autocomplete: 'off', oninput: () => { remember_sync_form({server: server_el.value.trim()}); clearTimeout(server_el.check_timer); server_el.check_timer = setTimeout(() => check_server(), 600); }, onblur: () => check_server(chosen_server() === checked_server)});
    const server_field_el = field('Your own server', server_el, 'wide'), own_server_button = el('button', {type: 'button', onclick: () => { uses_own_server = !uses_own_server; server_field_el.hidden = !uses_own_server; own_server_button.textContent = uses_own_server ? "Use the app's server" : 'Use your own server'; if (!uses_own_server) remember_sync_form({server: ''}); check_server(); }}, uses_own_server ? "Use the app's server" : 'Use your own server');
    server_field_el.hidden = !uses_own_server;
    const email_el = text_input('email', {type: 'email', value: typed_form.email || '', autocomplete: 'username', oninput: () => remember_sync_form({email: email_el.value.trim()})}), password_el = text_input('password', {type: 'password', autocomplete: 'current-password'});
    const reach_text_el = el('span', {}), reach_el = el('p', {class: 'sync-reach'}, reach_text_el, el('button', {type: 'button', class: 'link-button', onclick: () => check_server()}, 'Check again'));
    const sign_in_button = el('button', {type: 'submit', class: 'primary'}, 'Sign in'), create_button = el('button', {type: 'button'}, 'Create account');
    const is_ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const cert_url_el = el('code', {}), cert_link_el = el('a', Object.assign({class: 'button'}, is_ios ? {} : {target: '_blank', rel: 'noopener'}), 'Get the certificate');
    const cert_el = el('div', {class: 'trust-cert'}, el('p', {class: 'muted'}, "A server at home makes its own security certificate, and each device has to trust it once. (A server with a proper web address doesn't need this.)"), el('div', {class: 'button-row'}, cert_link_el, cert_url_el));
    const help_el = el('details', {class: 'trust-help'}, el('summary', {}, 'Trust this server: the steps for each device'), el('ul', {class: 'trust-steps'},
      el('li', {}, el('b', {}, 'iPhone / iPad:'), ' get the certificate (above) in Safari and tap Allow. Then Settings → Profile Downloaded → Install. Then Settings → General → About → Certificate Trust Settings → switch it on. Installing the profile isn\'t enough without this switch. After an iOS update, check it again.'),
      el('li', {}, el('b', {}, 'Android:'), ' download it, then Settings → Security → Encryption & credentials → Install a certificate → CA certificate.'),
      el('li', {}, el('b', {}, 'Windows:'), ' download it, double-click → Install Certificate → Local Machine → "Trusted Root Certification Authorities". Restart the browser.'),
      el('li', {}, el('b', {}, 'Mac:'), ' download it, double-click → Keychain Access; open it, choose Trust → "Always Trust".')), el('p', {class: 'muted'}, 'Then reload this page and check the address again.'));
    const code_el = text_input('code', {autocomplete: 'one-time-code', autocapitalize: 'characters'}), recover_password_el = text_input('newpw', {type: 'password', autocomplete: 'new-password'}), recover_button = el('button', {type: 'submit', class: 'primary'}, 'Set new password');
    const recover_form = el('form', {class: 'sync-form', onsubmit: submit_event => { submit_event.preventDefault(); button_work(recover_button, recover_message_el, async show_message => {
      if (!chosen_server() || !email_el.value.trim() || !code_el.value.trim() || !recover_password_el.value) return show_message('Enter the server, your email, the recovery code and a new password');
      if (recover_password_el.value.length < 10) return show_message('Use at least 10 characters');
      recover_button.disabled = true; show_message('Setting your new password…');
      await sync_engine.recover(chosen_server(), email_el.value.trim(), code_el.value.trim(), recover_password_el.value);
      offer_to_save_login(email_el.value.trim(), recover_password_el.value);
      await sync_engine.start(); toast('New password set'); draw();
    })(); }},
      el('p', {class: 'muted'}, 'Enter your email above, the recovery code you saved when you made the account, and a new password. Your other devices are signed out.'),
      field('Recovery code', code_el, 'wide'), field('New password', recover_password_el), el('div', {class: 'button-row'}, recover_button, recover_message_el));
    [reach_el, create_button, cert_el, help_el, recover_form].forEach(hidden_el => { hidden_el.hidden = true; });
    // Whether the server answers, and if so whether it takes new accounts (that's when Create account shows). Checked again on leaving the field, with Check again, and every 12 seconds while it can't be reached or isn't taking accounts: that may change on the server meanwhile.
    let check_number = 0, last_result = '', checked_server = null, server_wants_code = false;
    function check_server(is_quiet) {
      const server_url = chosen_server(), this_check = ++check_number;
      clearTimeout(server_el.check_timer); clearTimeout(reach_timer);
      checked_server = server_url;
      if (!is_quiet) { last_result = ''; [create_button, help_el, cert_el, reach_el].forEach(hidden_el => { hidden_el.hidden = true; }); help_el.open = false; }
      if (!/^https?:\/\/.+/i.test(server_url)) return;
      if (!is_quiet) { reach_text_el.textContent = 'Looking for the server…'; reach_el.hidden = false; }
      const check_again = () => { if (section_el.isConnected && !sync_engine.signed_in()) reach_timer = setTimeout(() => check_server(true), 12000); };
      sync_engine.server_info(server_url).then(server_reply => {
        if (this_check !== check_number || !section_el.isConnected) return;
        const is_open = server_reply.registration === 'open';
        server_wants_code = !!server_reply.email_codes;
        last_result = is_open ? 'open' : 'closed';
        create_button.hidden = !is_open; help_el.hidden = true; cert_el.hidden = true;
        if (uses_own_server) reach_text_el.textContent = is_open ? '✓ Server found. It is taking new accounts: sign in, or create an account.' : "✓ Server found. It isn't taking new accounts, so there's no Create account: sign in with an account that already exists. To add a person, the server has to allow new accounts first (flashcards-admin registration open, see the server guide). This updates by itself once it does.";
        else { reach_el.hidden = is_open; reach_text_el.textContent = server_reply.all_off ? 'Sync is switched off for now. The app works as usual and everything stays on this device.' : server_reply.day_is_full ? "Today's new accounts have all gone. Try again tomorrow. If you already have an account, you can sign in." : "New accounts aren't being taken just now. If you already have an account, you can sign in."; }
        if (!is_open) check_again();
      }).catch(() => {
        if (this_check !== check_number || !section_el.isConnected) return;
        const is_https = /^https:/i.test(server_url);
        create_button.hidden = true;
        reach_el.hidden = false;
        if (!uses_own_server) { reach_text_el.textContent = "Can't reach the sync server just now. Check your connection, or try again later."; check_again(); return; }
        reach_text_el.textContent = "Can't reach the server. Create account only shows once it can. Check this device is on the same network as the server" + (is_https ? (is_ios ? ", and that the certificate is switched on: Settings → General → About → Certificate Trust Settings (installing the profile isn't enough)" : ', and that it trusts the certificate (below)') : '') + '.';
        check_again();
        if (!is_https || (is_quiet && last_result === 'down')) return;
        last_result = 'down';
        try {
          const cert_url = 'http://' + new URL(server_url).hostname + '/flashcards-ca.crt';
          cert_url_el.textContent = cert_url; cert_link_el.href = cert_url; cert_el.hidden = false; help_el.hidden = false; help_el.open = true;
        } catch (url_err) {}
      });
    }
    // On a server that confirms addresses, Create account sends a code first, and the same button then finishes with it.
    const email_code_el = text_input('email_code', {inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: '8'}), email_code_field = field('Code from your email', email_code_el), resend_button = el('button', {type: 'button'});
    email_code_field.hidden = true; resend_button.hidden = true; resend_button.textContent = 'Send a new code';
    let code_sent_to = '';
    const send_code = async show_message => {
      show_message('Sending a code…');
      await sync_engine.request_signup_code(chosen_server(), email_el.value.trim());
      code_sent_to = email_el.value.trim().toLowerCase();
      email_code_field.hidden = false; resend_button.hidden = false;
      create_button.disabled = false; create_button.textContent = 'Finish creating account';
      email_code_el.value = ''; email_code_el.focus();
      show_message('Check your email (and its spam folder) for a code from Open Flashcards. It lasts 15 minutes.');
    };
    resend_button.onclick = button_work(resend_button, message_el, send_code);
    email_el.addEventListener('input', () => { if (email_el.value.trim().toLowerCase() === code_sent_to || !code_sent_to) return; code_sent_to = ''; email_code_field.hidden = true; resend_button.hidden = true; create_button.textContent = 'Create account'; });
    create_button.addEventListener('click', button_work(create_button, message_el, async show_message => {
      if (!email_el.value.trim() || !password_el.value) return show_message('Enter your email and password');
      if (password_el.value.length < 10) return show_message('Use at least 10 characters');
      create_button.disabled = true;
      if (server_wants_code && !code_sent_to) return send_code(show_message);
      if (server_wants_code && !email_code_el.value.trim()) { create_button.disabled = false; return show_message('Enter the code from your email'); }
      show_message('Creating your account and keys…');
      const code_text = await sync_engine.register(chosen_server(), email_el.value.trim(), password_el.value, server_wants_code ? email_code_el.value.trim() : undefined);
      offer_to_save_login(email_el.value.trim(), password_el.value);
      show_recovery_code(code_text);
    }));
    const sign_in_form = el('form', {class: 'sync-form', onsubmit: submit_event => { submit_event.preventDefault(); button_work(sign_in_button, message_el, async show_message => {
      if (!email_el.value.trim() || !password_el.value) return show_message('Enter your email and password');
      sign_in_button.disabled = true; show_message('Signing in…');
      await sync_engine.sign_in(chosen_server(), email_el.value.trim(), password_el.value);
      offer_to_save_login(email_el.value.trim(), password_el.value);
      await sync_engine.start(); draw();
    })(); }}, server_field_el, field('Email', email_el), field('Password', password_el), email_code_field, reach_el, el('div', {class: 'button-row'}, sign_in_button, create_button, resend_button, el('button', {type: 'button', onclick: () => { recover_form.hidden = !recover_form.hidden; }}, 'Forgot password?'), message_el));
    const reason_el = sync_status.error ? el('p', {class: 'sync-out-reason'}, sync_status.error) : null;
    body_el.replaceChildren(...[reason_el, el('p', {class: 'muted'}, 'Sync keeps your phone and laptop in step. Everything is encrypted here first; the server only stores scrambled copies.'), sync_note(), sign_in_form, cert_el, help_el, recover_form, el('div', {class: 'button-row'}, own_server_button)].filter(Boolean));
    check_server();
  }
  function sync_note() {
    return el('p', {class: 'sync-note'}, el('b', {}, 'This app is free.'), ' Sync is open to you too, but please email ', el('a', {href: 'mailto:' + CONTACT_EMAIL + '?subject=Open%20Flashcards%20sync'}, CONTACT_EMAIL), " to keep using it after 24 hours. Otherwise your account may be deleted. You won't lose anything if it is: your data stays on your device, and it just stops syncing.");
  }
  function draw() { was_signed_in = !!sync_engine.signed_in(); if (was_signed_in) draw_signed_in(); else draw_signed_out(); }
  function paint_facts(sync_status) {
    if (!section_el.isConnected) return;
    paint_panel_status(sync_status);
    const is_signed_in = !!sync_engine.signed_in(), facts_el = section_el.querySelector('#sync-line');
    if (was_signed_in !== is_signed_in) { if (body_el.querySelector('.recovery-code')) return; draw(); return; }
    const admin_line_el = section_el.querySelector('#sync-admin');
    if (admin_line_el) paint_admin_line(admin_line_el, sync_status);
    if (facts_el) { facts_el.replaceChildren(...facts_nodes(sync_status)); paint_code(); }
  }
  sync_engine.ready.then(() => {
    draw();
    paint_panel_status(sync_engine.status);
    unwatch_status = sync_engine.on_status(paint_facts);
    // Keep "… seconds ago" current, and check the connection every 10 seconds, while Settings is open.
    const facts_timer = setInterval(() => { if (!section_el.isConnected) { clearInterval(facts_timer); unwatch_status(); clearTimeout(reach_timer); return; } if (sync_engine.signed_in()) paint_facts(sync_engine.status); }, 5000);
    const link_timer = setInterval(() => { if (!section_el.isConnected) { clearInterval(link_timer); return; } sync_engine.check_link(); }, 10000);
    sync_engine.check_link();
  });
  return section_el;
}
