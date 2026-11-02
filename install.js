// Is the app on the Home Screen? On an iPhone or iPad that matters: Safari deletes a website's saved data after 7 days without use, but an app added to the Home Screen is exempt. iOS says whether the page is running from the Home Screen (navigator.standalone), so we can warn when it isn't.
const INSTALL_DISMISS_KEY = 'open-flashcards:install-banner-dismissed', INSTALL_QUIET_DAYS = 3;
function is_ios() { return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
function is_standalone() { return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches; }
function install_warning() { return is_ios() && !is_standalone(); }
// The real install prompt, where the browser has one (Chrome, Edge, Android): one tap, from a bar at the top, the pill's message or Settings.
const INSTALL_OFFER_DISMISS_KEY = 'open-flashcards:install-offer-dismissed', INSTALL_OFFER_QUIET_DAYS = 14;
let deferred_install = null;
function can_prompt_install() { return !!deferred_install && !is_standalone(); }
async function prompt_install() {
  const prompt_event = deferred_install;
  if (!prompt_event) return;
  deferred_install = null;
  prompt_event.prompt();
  await prompt_event.userChoice.catch(() => null);
  paint_install_offers();
}
function install_button(button_class) { return el('button', {type: 'button', class: (button_class || '') + ' install-now', onclick: prompt_install}, 'Install the app'); }
function show_install_offer() {
  if (!can_prompt_install() || document.querySelector('.install-offer')) return;
  try { const dismissed_at = Number(localStorage.getItem(INSTALL_OFFER_DISMISS_KEY)); if (dismissed_at && Date.now() - dismissed_at < INSTALL_OFFER_QUIET_DAYS * 86400000) return; } catch (storage_err) {}
  const offer_el = el('div', {class: 'install-banner install-offer', role: 'status'}, el('span', {}, 'Install Quizaroo as an app. It opens on its own and works offline.'), install_button('primary'),
    el('button', {type: 'button', class: 'install-hide', 'aria-label': 'Hide for now', onclick: () => { try { localStorage.setItem(INSTALL_OFFER_DISMISS_KEY, String(Date.now())); } catch (storage_err) {} offer_el.remove(); }}, '✕'));
  document.getElementById('topbar').after(offer_el);
}
// The browser's offer can arrive after a page is drawn, and goes once it's used.
function paint_install_offers() {
  if (!can_prompt_install()) { document.querySelectorAll('.install-offer, .install-now').forEach(offer_el => offer_el.remove()); }
  else show_install_offer();
  const body_el = document.querySelector('#install-section .settings-panel-body');
  if (body_el && !install_warning()) body_el.replaceChildren(...install_body_nodes());
}
addEventListener('beforeinstallprompt', install_event => { install_event.preventDefault(); deferred_install = install_event; if (document.getElementById('topbar')) paint_install_offers(); });
addEventListener('appinstalled', () => { deferred_install = null; paint_install_offers(); });
// Ask once for storage the browser won't clear by itself.
if (navigator.storage && navigator.storage.persist) navigator.storage.persisted().then(is_kept => { if (!is_kept) navigator.storage.persist(); }).catch(() => {});
// A slim red reminder at the top of every page. Dismissing it means quiet for 3 days.
function show_install_banner() {
  if (!install_warning() || document.querySelector('.install-banner')) return;
  try { const dismissed_at = Number(localStorage.getItem(INSTALL_DISMISS_KEY)); if (dismissed_at && Date.now() - dismissed_at < INSTALL_QUIET_DAYS * 86400000) return; } catch (storage_err) {}
  const banner_el = el('div', {class: 'install-banner', role: 'alert'},
    el('span', {}, "⚠️ Quizaroo isn't on your Home Screen. Safari may delete your data after 7 days. ", el('a', {href: '#/settings', onclick: click_event => { click_event.preventDefault(); go_to_settings_panel('install', '#install-section'); }}, 'What to do')),
    el('button', {type: 'button', 'aria-label': 'Hide for now', onclick: () => { try { localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now())); } catch (storage_err) {} banner_el.remove(); }}, '✕'));
  document.getElementById('topbar').after(banner_el);
}
// The steps on an iPhone or iPad: Safari's buttons as icons, with as few words as possible.
const INSTALL_ICONS = {
  more: '<circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/>',
  share: '<path d="M12 15V3M8 7l4-4 4 4"/><path d="M7 11H5v10h14V11h-2"/>',
  add: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/>',
  tick: '<path d="M5 13l4 4 10-10"/>',
  app: '<rect x="6" y="2" width="12" height="20" rx="3"/><rect x="9" y="6" width="6" height="6" rx="1.5"/>'
};
function install_step(step_number, icon_svg, step_text, small_text) {
  const icon_el = el('span', {class: 'install-icon', 'aria-hidden': 'true'});
  icon_el.innerHTML = '<svg viewBox="0 0 24 24">' + icon_svg + '</svg>';
  return el('li', {}, el('span', {class: 'install-number'}, step_number), icon_el, el('span', {class: 'install-step-text'}, step_text, small_text ? el('small', {}, small_text) : null));
}
function install_body_nodes() {
  if (is_standalone()) return [el('p', {class: 'install-ok'}, '✓ Quizaroo is on your Home Screen, so ' + (is_ios() ? "iOS won't delete its data after 7 days." : 'the browser treats it as an app.'))];
  return [el('p', {class: 'muted'}, 'Quizaroo can be installed as an app. It works offline and keeps its data safer.'), can_prompt_install() ? install_button('primary') : el('p', {class: 'muted'}, "In your browser's menu, choose ", el('b', {}, 'Install app'), ' (or ', el('b', {}, 'Add to Home Screen'), ' on Android).')];
}
// The Settings panel.
function install_section() {
  const on_warning = install_warning(), standalone_now = is_standalone(), body_nodes = [];
  if (on_warning) {
    const steps_el = el('ol', {class: 'install-steps'},
      install_step(1, INSTALL_ICONS.more, 'Tap the ⋯ or ☰ button', 'Beside the address bar, not the address itself. If you can already see Share, go to step 2.'),
      install_step(2, INSTALL_ICONS.share, 'Tap Share'),
      install_step(3, INSTALL_ICONS.add, 'Tap Add to Home Screen', 'Not there? Scroll down, or tap More.'),
      install_step(4, INSTALL_ICONS.tick, 'Tap Add', 'Leave Open as Web App on, if you see it.'),
      install_step(5, INSTALL_ICONS.app, 'Open it from your Home Screen', 'It starts with its own copy. Sign in to Sync, or Export all here and Import there.'));
    body_nodes.push(el('div', {class: 'install-alert', role: 'alert'},
      el('p', {}, el('b', {}, '⚠️ Add to your Home Screen, or Safari may delete your data after 7 days.')), steps_el,
      el('p', {class: 'muted'}, 'In another browser? Open this page in Safari first. If you use Sync, signing in brings back what has synced.')));
  } else {
    body_nodes.push(...install_body_nodes());
  }
  const panel_el = settings_panel('install', 'Home Screen and your data', el('span', {class: 'settings-panel-status'}, on_warning ? '⚠️ Not on your Home Screen' : standalone_now ? '✓ On your Home Screen' : 'Optional'), {class: 'settings-panel', id: 'install-section'}, ...body_nodes);
  if (on_warning) panel_el.open = true;
  return panel_el;
}
