/*
 * Keep The Page — newsletter sign-up removal.
 * Content script, ISOLATED world, document_start, all sites, top frame.
 *
 * Asked for by the user, by signature, never by hostname. Seen on
 * whathifi.com (Future plc), two at once:
 *
 *   popup    div.hidden.fixed.inset-0.z-[999999999999999999]   <- the overlay
 *              > div.absolute > div#newsletter-capture-modal > form
 *                > input[type=email][name=MAIL] "Your Email Address"
 *   inline   div.slice-container.newsletter-inbodyContent-slice   (in the article)
 *              > div.newsletter-form__wrapper > ... > input[type=email]
 *
 * Two signatures, both anchored on an email field -- a real sign-up form, not
 * an article that mentions a newsletter:
 *
 *   named    an ancestor whose id/class words include `newsletter`
 *            (split on punctuation and camelCase: newsletterForm counts)
 *   overlay  a position:fixed ancestor whose words say newsletter / inbox /
 *            subscribe / sign up -- popups that name themselves nothing
 *
 * When the form sits in a fixed overlay, the overlay goes, backdrop and all.
 * A form holding a password field is a login or registration and is never
 * touched. Nothing that holds the page's h1, a <main>, or the article holding
 * the h1 is ever hidden -- the same guard as comments.js.
 *
 * Hidden by a marker attribute and one stylesheet rule, so when the site later
 * un-hides its popup (the overlay ships with class `hidden` and is shown on a
 * trigger), it stays hidden.
 */
(() => {
  'use strict';

  const KEY = 'widgets';
  const MARK = 'data-ktp-newsletter';
  const STYLE = 'ktp-newsletter-css';
  const CSS = '[' + MARK + ']{display:none!important}';

  const NEWS_WORD = /^(newsletter|newsletters)$/;
  const NEWS_TEXT = /\b(newsletters?|inbox|subscribe|sign me up|sign up|mailing list)\b/i;
  const NEVER_TAG = /^(HTML|BODY|HEAD|MAIN|ARTICLE|H1)$/;
  const OVERLAY_MAX_TEXT = 1500;
  const CLIMB = 8;

  const words = (s) => String(s || '').replace(/([a-z])([A-Z])/g, '$1 $2')
                         .toLowerCase().split(/[^a-z]+/).filter(Boolean);

  /* Pure, so tests pin the rules. */
  const namedNewsletter = (e) => words(e.id).concat(words(e.cls)).some((w) => NEWS_WORD.test(w));

  const overlayVerdict = (o) =>
    !!o.fixed && !!o.hasEmail && !o.hasPassword &&
    String(o.text || '').length <= OVERLAY_MAX_TEXT && NEWS_TEXT.test(String(o.text || ''));

  let on = true;

  const clsOf = (el) => {
    const c = el.className;
    return c && typeof c !== 'string' ? (c.baseVal || '') : (c || '');
  };

  const wrapsContent = (el) => {
    try {
      const h1 = document.querySelector('h1');
      if (h1 && el.contains(h1)) return true;
      if (el.querySelector('main')) return true;
      const own = h1 && h1.closest('article');
      return !!(own && el.contains(own));
    } catch (e) { return true; }
  };

  const isFixed = (el) => {
    try { return getComputedStyle(el).position === 'fixed'; } catch (e) { return false; }
  };

  const target = (input) => {
    const form = input.closest('form');
    if (form && form.querySelector('input[type="password"]')) return null;
    let named = null;
    let overlay = null;
    let n = input.parentElement;
    for (let i = 0; i < CLIMB && n && n !== document.body; i++, n = n.parentElement) {
      if (NEVER_TAG.test(n.tagName) || wrapsContent(n)) break;
      if (namedNewsletter({ id: n.id, cls: clsOf(n) })) named = n;
      if (!overlay && isFixed(n)) overlay = n;
    }
    if (overlay) {
      let text = '';
      try { text = (overlay.textContent || '').trim(); } catch (e) { /* ignore */ }
      if (named || overlayVerdict({ fixed: true, hasEmail: true, hasPassword: false, text })) {
        return { el: overlay, kind: 'overlay' };
      }
    }
    return named ? { el: named, kind: 'inline' } : null;
  };

  /* A site shows its popup by locking scroll as well; with the popup hidden
   * that lock would strand the page. Only undone while a popup OVERLAY of
   * ours is marked -- never for an inline box, or an unrelated menu's lock
   * would be undone -- and no other modal is on screen. */
  const unlock = () => {
    try {
      if (!document.querySelector('[' + MARK + '="overlay"]')) return;
      if (document.querySelector('dialog[open]')) return;
      for (const el of [document.documentElement, document.body]) {
        if (el && getComputedStyle(el).overflow === 'hidden') el.style.setProperty('overflow', 'auto', 'important');
      }
    } catch (e) { /* ignore */ }
  };

  const sweep = () => {
    if (!on || !document.body) return;
    let inputs;
    try { inputs = document.body.querySelectorAll('input[type="email"],input[autocomplete="email"],input[name*="email" i]'); }
    catch (e) { return; }
    for (const input of inputs) {
      if (input.closest('[' + MARK + ']')) continue;
      const t = target(input);
      if (!t) continue;
      t.el.setAttribute(MARK, t.kind);
    }
    unlock();
  };

  const install = () => {
    try {
      if (document.getElementById(STYLE)) return;
      const s = document.createElement('style');
      s.id = STYLE;
      s.textContent = CSS;
      (document.head || document.documentElement).appendChild(s);
    } catch (e) { /* ignore */ }
  };

  const uninstall = () => {
    try { const s = document.getElementById(STYLE); if (s) s.remove(); } catch (e) { /* ignore */ }
    try { for (const el of document.querySelectorAll('[' + MARK + ']')) el.removeAttribute(MARK); } catch (e) { /* ignore */ }
  };

  /* The user's URL exceptions (Settings -> Newsletter sign-ups), matched by
   * except.js, which the manifest loads first. */
  const urlExcepted = self.ktpUrlExcepted || (() => false);
  const EXCEPT = 'newsletterExceptions';
  let widgets = {};
  let except = [];

  const apply = () => {
    on = widgets.newsletter !== false &&
         !urlExcepted(location.hostname, location.pathname, except);
    if (on) { install(); sweep(); } else uninstall();
  };

  /* A path exception must follow SPA navigation, including off an excepted
   * path while `on` is false. */
  let href = location.href;
  let queued = false;
  const queue = () => {
    if (location.href !== href) { href = location.href; apply(); }
    if (queued || !on) return;
    queued = true;
    setTimeout(() => { queued = false; sweep(); }, 250);
  };

  /* On by default, before storage answers. */
  install();
  try {
    chrome.storage.local.get([KEY, EXCEPT], (got) => {
      widgets = (got && got[KEY]) || {};
      except = (got && got[EXCEPT]) || [];
      apply();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !(changes[KEY] || changes[EXCEPT])) return;
      if (changes[KEY]) widgets = changes[KEY].newValue || {};
      if (changes[EXCEPT]) except = changes[EXCEPT].newValue || [];
      apply();
    });
  } catch (e) { /* no storage: keep the default */ }

  try {
    new MutationObserver(queue).observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style']
    });
  } catch (e) { /* no observer */ }
  document.addEventListener('DOMContentLoaded', sweep);
})();
