// Is the app on the Home Screen? On an iPhone or iPad that matters: Safari deletes a website's saved data after 7 days without use, but an app added to the Home Screen is exempt. iOS says whether the page is running from the Home Screen (navigator.standalone), so we can warn when it isn't.
const INSTALL_DISMISS_KEY = 'open-flashcards:install-banner-dismissed', INSTALL_QUIET_DAYS = 3;
function is_ios() { return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
function is_standalone() { return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches; }
function install_warning() { return is_ios() && !is_standalone(); }
// The real install prompt, where the browser has one (Chrome, Edge, Android).
let deferred_install = null;
addEventListener('beforeinstallprompt', install_event => { install_event.preventDefault(); deferred_install = install_event; });
// Ask once for storage the browser won't clear by itself.
if (navigator.storage && navigator.storage.persist) navigator.storage.persisted().then(is_kept => { if (!is_kept) navigator.storage.persist(); }).catch(() => {});
// A slim red reminder at the top of every page. Dismissing it means quiet for 3 days.
function show_install_banner() {
  if (!install_warning() || document.querySelector('.install-banner')) return;
  try { const dismissed_at = Number(localStorage.getItem(INSTALL_DISMISS_KEY)); if (dismissed_at && Date.now() - dismissed_at < INSTALL_QUIET_DAYS * 86400000) return; } catch (storage_err) {}
  const banner_el = el('div', {class: 'install-banner', role: 'alert'},
    el('span', {}, "⚠️ Open Flashcards isn't on your Home Screen. Safari may delete your data after 7 days. ", el('a', {href: '#/settings', onclick: click_event => { click_event.preventDefault(); go_to_settings_panel('install', '#install-section'); }}, 'What to do')),
    el('button', {type: 'button', 'aria-label': 'Hide for now', onclick: () => { try { localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now())); } catch (storage_err) {} banner_el.remove(); }}, '✕'));
  document.getElementById('topbar').after(banner_el);
}
// The Settings panel.
function install_section() {
  const on_warning = install_warning(), standalone_now = is_standalone(), body_nodes = [];
  if (on_warning) {
    const steps_el = el('ol', {class: 'install-steps'},
      el('li', {}, 'Open this page in ', el('b', {}, 'Safari'), ' (the blue compass), not inside another app.'),
      el('li', {}, 'Tap the ', el('b', {}, 'Share'), ' button (a square with an arrow, at the bottom or top).'),
      el('li', {}, 'Scroll down and tap ', el('b', {}, 'Add to Home Screen'), ', then ', el('b', {}, 'Add'), '.'),
      el('li', {}, 'Open Open Flashcards from the new icon on your Home Screen. It keeps its own copy of your data, so sign in to Sync there, or use Export all here and Import there, to bring your sets across.'));
    steps_el.hidden = true;
    body_nodes.push(el('div', {class: 'install-alert', role: 'alert'},
      el('p', {}, el('b', {}, '⚠️ Open Flashcards is not on your Home Screen.')),
      el('p', {}, "An iPhone deletes what a website has saved after about 7 days without opening it. If that happens, everything in Open Flashcards on this phone that hasn't been synced is lost for good. Only an app on the Home Screen is safe."),
      el('button', {type: 'button', class: 'primary', onclick: () => { steps_el.hidden = !steps_el.hidden; }}, 'Click here to add to Home Screen'), steps_el,
      el('p', {class: 'muted'}, 'If you use Sync, your data is also on the server: if the phone ever loses it, sign in again and it comes back (anything not yet synced would be lost).')));
  } else if (standalone_now) {
    body_nodes.push(el('p', {class: 'install-ok'}, '✓ Open Flashcards is on your Home Screen, so ' + (is_ios() ? "iOS won't delete its data after 7 days." : 'the browser treats it as an app.')));
  } else {
    const install_button = deferred_install ? el('button', {type: 'button', class: 'primary', onclick: async () => { const prompt_event = deferred_install; deferred_install = null; prompt_event.prompt(); await prompt_event.userChoice.catch(() => null); install_button.remove(); }}, 'Install Open Flashcards') : null;
    body_nodes.push(el('p', {class: 'muted'}, 'Open Flashcards can be installed as an app. It works offline and keeps its data safer.'), install_button || el('p', {class: 'muted'}, "In your browser's menu, choose ", el('b', {}, 'Install app'), ' (or ', el('b', {}, 'Add to Home Screen'), ' on Android).'));
  }
  const panel_el = settings_panel('install', 'Home Screen and your data', el('span', {class: 'settings-panel-status'}, on_warning ? '⚠️ Not on your Home Screen' : standalone_now ? '✓ On your Home Screen' : 'Optional'), {class: 'settings-panel', id: 'install-section'}, ...body_nodes);
  if (on_warning) panel_el.open = true;
  return panel_el;
}
