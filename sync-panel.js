// The pill at the top right and the Sync section of Settings: sign in (or create the account on a fresh server), then it runs by itself.
const SYNC_FORM_KEY = 'open-flashcards:sync-form';
function sync_pill() {
  const pill_el = document.getElementById('sync-status');
  sync_engine.on_status(sync_status => {
    const pill_text = {off: 'Local only', idle: 'Sync on', syncing: 'Syncing…', ok: 'In sync', offline: 'Offline', error: 'Sync problem'}[sync_status.state] || 'Local only';
    pill_el.textContent = sync_status.state === 'ok' && sync_status.pending ? sync_status.pending + ' to sync' : pill_text;
    pill_el.dataset.state = sync_status.state;
    pill_el.title = sync_status.state === 'off' ? 'Stored on this device only' : sync_status.error || pill_text;
  });
}
function typed_sync_form() { try { return JSON.parse(localStorage.getItem(SYNC_FORM_KEY)) || {}; } catch (storage_err) { return {}; } }
function remember_sync_form(form_changes) { try { localStorage.setItem(SYNC_FORM_KEY, JSON.stringify(Object.assign(typed_sync_form(), form_changes))); } catch (storage_err) {} }
function time_ago(iso_time) {
  if (!iso_time) return 'not yet';
  const seconds_ago = Math.round((Date.now() - Date.parse(iso_time)) / 1000);
  return seconds_ago < 5 ? 'just now' : seconds_ago < 60 ? seconds_ago + ' seconds ago' : seconds_ago < 3600 ? Math.round(seconds_ago / 60) + ' min ago' : new Date(iso_time).toLocaleString();
}
const SYNC_LINK_WORDS = {good: 'Connected', slow: 'Connected, slow', weak: 'Weak connection: some requests failing, retrying', down: "Can't reach the server: retrying", unknown: 'Checking…'};
function sync_state_text(sync_status) {
  return {syncing: 'Syncing…', ok: sync_status.pending ? 'Waiting to send ' + sync_status.pending + ' change' + (sync_status.pending === 1 ? '' : 's') : 'In step, as far as this device knows', offline: "Can't reach the server (no signal, or it's down). Changes wait here and go when it can be reached.", error: "Couldn't sync: " + sync_status.error, idle: 'Waiting to sync…'}[sync_status.state] || '';
}
function sync_section() {
  const body_el = el('div', {id: 'sync-body'}), section_el = el('section', {class: 'sync-section', id: 'sync-section'}, el('h2', {class: 'list-heading'}, 'Sync'), body_el);
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
      ...row('Data code', el('span', {id: 'sync-code'}, data_code_now ? el('b', {}, data_code_now.words) : '…', data_code_now ? el('span', {class: 'muted'}, ' (' + data_code_now.records + ' records)') : null))
    ];
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
    const facts_el = el('dl', {class: 'sync-facts', id: 'sync-line'}, ...facts_nodes(sync_engine.status));
    const devices_button = el('button', {type: 'button', onclick: async () => {
      devices_el.hidden = !devices_el.hidden;
      if (devices_el.hidden) return;
      try { devices_el.replaceChildren(...(await sync_engine.devices()).map(device_item => el('li', {}, device_item.name, device_item.this ? el('span', {class: 'muted'}, ' (this one)') : null, el('span', {class: 'muted'}, ' · last seen ' + time_ago(device_item.last_seen))))); } catch (devices_err) { devices_el.replaceChildren(el('li', {class: 'muted'}, "Can't list them just now.")); }
    }}, 'Devices');
    body_el.replaceChildren(
      el('p', {}, el('b', {}, 'Signed in'), ' as ' + account_now.email + ' on ', el('code', {}, account_now.server.replace(/^https?:\/\//, ''))),
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
    const server_el = text_input('server', {value: typed_form.server || '', placeholder: 'https://your-server', inputmode: 'url', autocomplete: 'off', oninput: () => { remember_sync_form({server: server_el.value.trim()}); clearTimeout(server_el.check_timer); server_el.check_timer = setTimeout(() => check_server(), 600); }, onblur: () => check_server(server_el.value.trim() === checked_server)});
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
      if (!server_el.value.trim() || !email_el.value.trim() || !code_el.value.trim() || !recover_password_el.value) return show_message('Enter the server, your email, the recovery code and a new password');
      if (recover_password_el.value.length < 10) return show_message('Use at least 10 characters');
      recover_button.disabled = true; show_message('Setting your new password…');
      await sync_engine.recover(server_el.value.trim(), email_el.value.trim(), code_el.value.trim(), recover_password_el.value);
      offer_to_save_login(email_el.value.trim(), recover_password_el.value);
      await sync_engine.start(); toast('New password set'); draw();
    })(); }},
      el('p', {class: 'muted'}, 'Enter your email above, the recovery code you saved when you made the account, and a new password. Your other devices are signed out.'),
      field('Recovery code', code_el, 'wide'), field('New password', recover_password_el), el('div', {class: 'button-row'}, recover_button, recover_message_el));
    [reach_el, create_button, cert_el, help_el, recover_form].forEach(hidden_el => { hidden_el.hidden = true; });
    // Whether the server answers, and if so whether it takes new accounts (that's when Create account shows). Checked again on leaving the field, with Check again, and every 12 seconds while it can't be reached or isn't taking accounts: that may change on the server meanwhile.
    let check_number = 0, last_result = '', checked_server = null;
    function check_server(is_quiet) {
      const server_url = server_el.value.trim(), this_check = ++check_number;
      clearTimeout(server_el.check_timer); clearTimeout(reach_timer);
      checked_server = server_url;
      if (!is_quiet) { last_result = ''; [create_button, help_el, cert_el, reach_el].forEach(hidden_el => { hidden_el.hidden = true; }); help_el.open = false; }
      if (!/^https?:\/\/.+/i.test(server_url)) return;
      if (!is_quiet) { reach_text_el.textContent = 'Looking for the server…'; reach_el.hidden = false; }
      const check_again = () => { if (section_el.isConnected && !sync_engine.signed_in()) reach_timer = setTimeout(() => check_server(true), 12000); };
      sync_engine.server_info(server_url).then(server_reply => {
        if (this_check !== check_number || !section_el.isConnected) return;
        const is_open = server_reply.registration === 'open';
        last_result = is_open ? 'open' : 'closed';
        create_button.hidden = !is_open; help_el.hidden = true; cert_el.hidden = true;
        reach_text_el.textContent = is_open ? '✓ Server found. It is taking new accounts: sign in, or create an account.' : "✓ Server found. It isn't taking new accounts, so there's no Create account: sign in with an account that already exists. To add a person, the server has to allow new accounts first (flashcards-admin registration open, see the server guide). This updates by itself once it does.";
        if (!is_open) check_again();
      }).catch(() => {
        if (this_check !== check_number || !section_el.isConnected) return;
        const is_https = /^https:/i.test(server_url);
        create_button.hidden = true;
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
    create_button.addEventListener('click', button_work(create_button, message_el, async show_message => {
      if (!email_el.value.trim() || !password_el.value) return show_message('Enter your email and password');
      if (password_el.value.length < 10) return show_message('Use at least 10 characters');
      create_button.disabled = true; show_message('Creating your account and keys…');
      const code_text = await sync_engine.register(server_el.value.trim(), email_el.value.trim(), password_el.value);
      offer_to_save_login(email_el.value.trim(), password_el.value);
      show_recovery_code(code_text);
    }));
    const sign_in_form = el('form', {class: 'sync-form', onsubmit: submit_event => { submit_event.preventDefault(); button_work(sign_in_button, message_el, async show_message => {
      if (!email_el.value.trim() || !password_el.value) return show_message('Enter your email and password');
      sign_in_button.disabled = true; show_message('Signing in…');
      await sync_engine.sign_in(server_el.value.trim(), email_el.value.trim(), password_el.value);
      offer_to_save_login(email_el.value.trim(), password_el.value);
      await sync_engine.start(); draw();
    })(); }}, field('Server', server_el, 'wide'), field('Email', email_el), field('Password', password_el), reach_el, el('div', {class: 'button-row'}, sign_in_button, create_button, el('button', {type: 'button', onclick: () => { recover_form.hidden = !recover_form.hidden; }}, 'Forgot password?'), message_el));
    const reason_el = sync_status.error ? el('p', {class: 'sync-out-reason'}, sync_status.error) : null;
    body_el.replaceChildren(...[reason_el, el('p', {class: 'muted'}, 'Sync keeps your phone and laptop in step through your own server. Everything is encrypted here first; the server only stores scrambled copies.'), sign_in_form, cert_el, help_el, recover_form].filter(Boolean));
    check_server();
  }
  function draw() { was_signed_in = !!sync_engine.signed_in(); if (was_signed_in) draw_signed_in(); else draw_signed_out(); }
  function paint_facts(sync_status) {
    if (!section_el.isConnected) return;
    const is_signed_in = !!sync_engine.signed_in(), facts_el = section_el.querySelector('#sync-line');
    if (was_signed_in !== is_signed_in) { if (body_el.querySelector('.recovery-code')) return; draw(); return; }
    if (facts_el) { facts_el.replaceChildren(...facts_nodes(sync_status)); paint_code(); }
  }
  sync_engine.ready.then(() => {
    draw();
    unwatch_status = sync_engine.on_status(paint_facts);
    // Keep "… seconds ago" current, and check the connection every 10 seconds, while Settings is open.
    const facts_timer = setInterval(() => { if (!section_el.isConnected) { clearInterval(facts_timer); unwatch_status(); clearTimeout(reach_timer); return; } if (sync_engine.signed_in()) paint_facts(sync_engine.status); }, 5000);
    const link_timer = setInterval(() => { if (!section_el.isConnected) { clearInterval(link_timer); return; } sync_engine.check_link(); }, 10000);
    sync_engine.check_link();
  });
  return section_el;
}
