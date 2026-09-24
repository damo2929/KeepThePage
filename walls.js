/*
 * Keep The Page — universal, signature-armed anti-adblock defences.
 * Content script, document_start, MAIN world, ALL sites.
 *
 * What this removes or stops: anti-adblock code that deletes an article, or
 * its stylesheets, from the reader's own computer after delivery, and freezes
 * or reloads the tab when interfered with. The author's position is that this
 * is an unauthorised act under s.3 of the UK Computer Misuse Act 1990
 * (impairing a computer's operation, hindering access to data held on it;
 * https://www.legislation.gov.uk/ukpga/1990/18/section/3).
 * Gating done server side -- withholding the article before it is sent --
 * acts only on the publisher's own system and is left alone. That is an
 * argument, not a legal finding -- untested in court; see the README, "The
 * Computer Misuse Act 1990".
 *
 * Running on every site is only acceptable because nothing here acts until a
 * wall signature is found. Until then the hooks are pass-through wrappers:
 * they observe their own arguments and hand straight off to the native
 * implementation. Clean sites keep every timer, every node and every dialog.
 *
 * Site-specific work that cannot be signature-driven lives in guard.js, which
 * stays scoped to the domains that need it. The `adLight` pin is the example:
 * it must run before the page's own `var adLight = false` at document_start,
 * which is earlier than any signature can be observed, so it cannot be armed
 * this way and must not be defined on sites that have nothing to do with it.
 *
 * Signatures, all observed in the wild:
 *
 *   data-sdk="l/1.2.10" / "wp-l/1.1.11" / "l/1.1.21" / "l/1.1.10"   AdShield loader
 *     The version moves; the `l/<n>.<n>` shape does not. `l/1.1.21` was found
 *     on scotsman.com and yorkshirepost.co.uk during the 52-article sweep and
 *     needed no change here — verified by probe, not by reading the regex:
 *     appending a div to <body> and calling remove() is refused when armed.
 *   html-load.com | content-loader.com | error-report.com   loader hosts
 *   "Ads help keep <site> content free"    News Corp wall copy
 *   "please disable the ad blocker"        generic wall instruction
 *
 * Consent-or-pay walls are handled separately, in section 4. They are not
 * anti-adblock and share none of the above; their signature is the CMP
 * vendor's own container id (#qc-cmp2-container, #onetrust-consent-sdk,
 * [id^="sp_message_container"], ...), which is why they need no site list.
 */
(() => {
  'use strict';

  const TAG = '[keep-the-page]';

  /* Tracing is off unless the options page turns it on. bridge.js (isolated
   * world) publishes the enabled channels as an attribute on <html>; this
   * reads it, because the MAIN world has no access to chrome.storage.
   *
   * The attribute is re-read at most every 250ms rather than on every call:
   * the timer wrapper below sits on setTimeout, and a getAttribute there would
   * be on the hot path of every page on the web. */
  let traceSpec = '';
  let traceAt = 0;

  const traced = (channel) => {
    const now = Date.now();
    if (now - traceAt > 250) {
      traceAt = now;
      try {
        const root = document.documentElement;
        traceSpec = (root && root.getAttribute('data-ktp-trace')) || '';
      } catch (e) { traceSpec = ''; }
    }
    if (!traceSpec) return false;
    return traceSpec === 'all' || traceSpec.split(',').indexOf(channel) !== -1;
  };

  const log = (channel, ...a) => { if (traced(channel)) console.debug(TAG, ...a); };

  /* ---------- which defences are switched on ------------------------------
   * The settings page lists every defence, all on by default, so bridge.js
   * writes `data-ktp-off` ONLY when one has been turned off. A default install
   * therefore still writes nothing to the page -- the same property tracing
   * has, and for the same reason: a permanent marker on <html> is the kind of
   * thing these SDKs look for.
   *
   * Names match the trace channels one for one, so what you switch off is what
   * stops being logged. */
  let offSpec = '';
  let offAt = 0;

  const active = (name) => {
    const now = Date.now();
    if (now - offAt > 250) {
      offAt = now;
      try {
        const root = document.documentElement;
        offSpec = (root && root.getAttribute('data-ktp-off')) || '';
      } catch (e) { offSpec = ''; }
    }
    if (!offSpec) return true;                   /* nothing disabled */
    return offSpec.split(',').indexOf(name) === -1;
  };

  /* ---------- error reporting --------------------------------------------
   * Every guard below swallows its own exceptions, so a failure here can never
   * break the page. The cost of that is silence: before this, a guard that
   * stopped working left no trace at all, and with tracing off not even a
   * console line. So failures are reported out to bridge.js, which persists
   * them for the settings page to show.
   *
   * The MAIN world cannot reach chrome.storage, hence the event. detail is a
   * JSON *string* on purpose: objects do not cross the world boundary
   * reliably, strings do. The event fires only when something has actually
   * gone wrong, so the page's view of us stays empty in the normal case. */
  const report = (where, err) => {
    try {
      const detail = JSON.stringify({
        where: String(where),
        message: String(err && err.message ? err.message : err).slice(0, 300),
        host: location.hostname,
        at: Date.now()
      });
      document.dispatchEvent(new CustomEvent('ktp-report', { detail }));
    } catch (e) { /* reporting must never throw */ }
  };

  /* Captured before anything is patched, so internal removals cannot be caught
   * by our own guards. This bug cost an hour: the overlay sweep called
   * el.remove(), the body-child guard refused it, and the two fought once a
   * second forever. */
  const nativeRemove = Element.prototype.remove;
  const dropNode = (el) => { try { nativeRemove.call(el); } catch (e) { /* ignore */ } };

  /* ---------- signatures --------------------------------------------------- */

  const SDK_ATTR = /(^|-)l\/\d+\.\d+/;
  const SDK_HOST = /(html-load|content-loader|error-report)\.com/i;

  const WALL_TEXT = new RegExp([
    'ads?\\s+help\\s+keep',                    // "Ads help keep Page Six content free"
    'allow ads on',                            // "ALLOW ADS ON PAGE SIX"
    'disable (your |the )?ad ?block',          // "please disable the ad blocker"
    'turn off (your |the )?ad ?block',
    'whitelist (us|this site|our site)'
  ].join('|'), 'i');

  /* ---------- 0. the loader's recovery gate --------------------------------
   * Found on listentotaxman.com (l/1.1.10), and present on scotsman /
   * yorkshirepost (l/1.1.21) as the loader tag's onerror handler. When the
   * loader host is blocked, the page's OWN inline recovery script tries the
   * fallback hosts, then raises
   *
   *     confirm('There was a problem loading the page. Please click OK ...')
   *         OK     -> location.href = report.error-report.com/modal
   *         Cancel -> location.reload()
   *
   * Neither answer is safe (rule 4: Location cannot be intercepted), and the
   * native modal froze the tab. It is a plain inline script, so the eval-timer
   * filter never sees it.
   *
   * But the whole recovery path sits behind one gate, the adLight lesson again:
   *
   *     b = () => { h = javaHash; r = utcMidnight;
   *                 return !!(window['as_'+h('loader-check_'+r)] ||
   *                           window['as_'+h('loader-check_'+(r-864e5))] || ...+864e5) }
   *     if (b()) return;
   *
   * It is the flag a loader that ran sets for itself. Pinning it when a loader
   * tag carrying the signature is parsed means the recovery stands down before
   * its first fallback: no retries, no error iframe, no confirm, no reload.
   * All three days are set, as the check reads them, so midnight UTC cannot
   * fall between the pin and the check. */
  const GATE_NAME = 'loader-check';
  const gateKey = (day) => {
    const s = GATE_NAME + '_' + day;
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
    return 'as_' + h;
  };

  let gatePinned = false;
  const pinLoaderGate = () => {
    if (gatePinned || !active('walls')) return;
    gatePinned = true;
    const now = Date.now();
    const today = now - now % 864e5;
    for (const day of [today - 864e5, today, today + 864e5]) {
      try { window[gateKey(day)] = true; } catch (e) { report('loader gate', e); }
    }
    log('walls', 'pinned the loader-check gate — recovery script will stand down');
  };

  let armed = false;
  let lastProbe = 0;

  /* Latches true and never caches a negative: the loader tag may not be parsed
   * when the first timers are scheduled, so a cached "absent" would disarm us
   * permanently on a page that does carry the wall. */
  const wallPresent = () => {
    if (armed) return true;
    const now = Date.now();
    if (now - lastProbe < 250) return false;
    lastProbe = now;
    try {
      for (const el of document.querySelectorAll('script[data-sdk], script[src]')) {
        const sdk = el.getAttribute('data-sdk');
        if (sdk && SDK_ATTR.test(sdk)) { armed = true; break; }
        if (el.src && SDK_HOST.test(el.src)) { armed = true; break; }
      }
    } catch (e) { /* document not ready */ }
    if (armed) {
      log('walls', 'wall signature detected — defences armed on ' + location.hostname);
      pinLoaderGate();
    }
    return armed;
  };

  /* The gate has to be pinned before the loader's error fires, and the probe
   * above only runs when a timer is scheduled. So watch the parse itself: the
   * parser performs a microtask checkpoint before it runs a parser-inserted
   * script, which delivers this observer's records before the loader tag is
   * even fetched. Filters on SCRIPT elements only, and stops at `load`. */
  const isLoaderTag = (n) => {
    if (!n || n.nodeType !== 1 || n.tagName !== 'SCRIPT') return false;
    const sdk = n.getAttribute('data-sdk');
    return !!((sdk && SDK_ATTR.test(sdk)) || (n.src && SDK_HOST.test(n.src)));
  };

  const loaderWatch = new MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (!isLoaderTag(n)) continue;
        armed = true;
        log('walls', 'loader tag parsed (' + (n.getAttribute('data-sdk') || n.src) + ') — defences armed');
        pinLoaderGate();
        loaderWatch.disconnect();
        return;
      }
    }
  });
  try { loaderWatch.observe(document.documentElement || document, { childList: true, subtree: true }); }
  catch (e) { report('loader watch', e); }
  window.addEventListener('load', () => loaderWatch.disconnect());

  /* ---------- 1. timers scheduled from eval'd code ------------------------- */

  let droppedTimers = 0;

  const fromEval = () => {
    try { return /eval at |eval \(eval/.test((new Error()).stack || ''); }
    catch (e) { return false; }
  };

  /* The CSS stripper, found on National World titles (scotsman.co.uk,
   * yorkshirepost.co.uk) as a plain inline script in the served HTML:
   *
   *     setInterval(() => i.querySelectorAll('link,style')
   *                        .forEach(e => e.remove()), 100)
   *     const n = await fetch(<loader host>)      // the restore half
   *
   * Every 100ms it deletes every stylesheet in the document, then fetches
   * replacements from html-load.com. With that host blocked at the user's
   * Pi-hole the strip runs forever and the restore never arrives, so the page
   * is left as unstyled markup — all the text present, none of the layout.
   *
   * The eval-timer filter below does not catch it: this is a normal inline
   * script, so `fromEval()` is false. The handler's own source is the
   * signature instead. Nothing legitimate schedules a repeating job that
   * removes every <link> and <style> on the page, so this needs no further
   * gate — and must not have one, because the interval may be scheduled
   * before the loader tag is parsed, which is exactly when `wallPresent()`
   * would still be returning false.
   *
   * Killing it at schedule time means nothing is ever stripped, so nothing
   * needs restoring. Verified on yorkshirepost: 0 sheets -> 2 sheets,
   * 532 rules, page renders. */
  const CSS_STRIPPER =
    /querySelectorAll\(\s*(['"`])\s*(link\s*,\s*style|style\s*,\s*link)\s*\1\s*\)[\s\S]{0,80}remove\s*\(/;

  const stripsStylesheets = (handler) => {
    try { return CSS_STRIPPER.test(Function.prototype.toString.call(handler)); }
    catch (e) { return false; }
  };

  const wrapScheduler = (name) => {
    const native = window[name];
    if (typeof native !== 'function') return;
    window[name] = function (handler, delay) {
      /* Not gated on a setting, deliberately. The stripper interval can be
       * scheduled before bridge.js has read storage, so a switch would be
       * ignored in precisely the window where it would matter -- and an
       * interval that deletes every stylesheet is unambiguous anyway. */
      if (typeof handler === 'function' && stripsStylesheets(handler)) {
        droppedTimers++;
        log('timers', 'dropped ' + name + '(' + delay + 'ms) — it strips every stylesheet');
        armed = true;
        return 0;
      }
      if (typeof handler === 'function' && fromEval() && wallPresent()) {
        droppedTimers++;
        log('timers', 'dropped ' + name + '(' + delay + 'ms) scheduled from eval [' + droppedTimers + ']');
        return 0;
      }
      return native.apply(this, arguments);
    };
  };

  wrapScheduler('setTimeout');
  wrapScheduler('setInterval');

  /* ---------- 2. overlay walls -------------------------------------------- */

  const looksLikeWall = (el) => {
    let cs;
    try { cs = getComputedStyle(el); } catch (e) { return false; }
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return false;
    if (cs.position !== 'fixed' && el.tagName !== 'DIALOG') return false;

    const r = el.getBoundingClientRect();
    if (r.width < 120 || r.height < 80) return false;
    if ((r.width * r.height) < 0.3 * innerWidth * innerHeight &&
        (parseInt(cs.zIndex, 10) || 0) < 100000) return false;

    let text;
    try { text = el.innerText || el.textContent || ''; } catch (e) { return false; }
    if (text.length > 1200) return false;        // a page, not a wall
    return WALL_TEXT.test(text);
  };

  /* CMPs lock scrolling three different ways: overflow:hidden, position:fixed
   * on <body>, and a marker class that a stylesheet keys off. Undo all three —
   * removing the overlay alone leaves the page unscrollable. */
  const LOCK_CLASSES = [
    'sp-message-open', 'sp-message-open-scroll',       // Sourcepoint
    'didomi-popup-open', 'didomi-popup-open-no-scroll', // Didomi
    'qc-cmp2-scroll-lock',                             // Quantcast Choice
    'onetrust-scroll-lock',                            // OneTrust
    'cookiebot-overlay',                               // Cookiebot
    'fc-consent-root-open'                             // Google Funding Choices
  ];

  const unlockScroll = () => {
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      try {
        const cs = getComputedStyle(el);
        if (cs.overflow === 'hidden' || cs.overflowY === 'hidden') {
          el.style.setProperty('overflow', 'auto', 'important');
        }
        if (cs.position === 'fixed') {
          el.style.setProperty('position', 'static', 'important');
        }
        for (const c of LOCK_CLASSES) {
          if (el.classList.contains(c)) el.classList.remove(c);
        }
      } catch (e) { /* ignore */ }
    }
  };

  const sweepWalls = () => {
    let found = false;
    let nodes;
    /* Three levels down, not two: walesonline's CMP sat at body > container >
     * main > fixed div, and a two-level scan could not see it. */
    if (!active('walls')) return false;
    try { nodes = document.querySelectorAll('dialog, body > *, body > * > *, body > * > * > *'); }
    catch (e) { return; }
    for (const el of nodes) {
      if (el === document.body || el === document.documentElement) continue;
      if (!looksLikeWall(el)) continue;
      log('walls', 'removed ad wall <' + el.localName + '> z=' + getComputedStyle(el).zIndex);
      try { if (el.tagName === 'DIALOG') el.close(); } catch (e) {}
      dropNode(el);
      armed = true;                              // a wall on screen is a signature
      found = true;
    }
    if (found) unlockScroll();
  };

  /* A <dialog> opened through the API, rather than forced visible with CSS. */
  if (window.HTMLDialogElement) {
    ['showModal', 'show'].forEach((name) => {
      const native = HTMLDialogElement.prototype[name];
      if (typeof native !== 'function') return;
      HTMLDialogElement.prototype[name] = function () {
        try {
          if (WALL_TEXT.test(this.innerText || this.textContent || '')) {
            log('walls', 'blocked <dialog>.' + name + '() ad wall');
            dropNode(this);
            armed = true;
            return;
          }
        } catch (e) { /* fall through */ }
        return native.apply(this, arguments);
      };
    });
  }

  /* ---------- 3. native dialogs ------------------------------------------- */

  const shim = (name, answer) => {
    const native = window[name];
    if (typeof native !== 'function') return;
    const replacement = function (message) {
      const text = String(message == null ? '' : message);
      if (active('walls') && WALL_TEXT.test(text)) {
        log('walls', 'suppressed ' + name + '(): ' + text.slice(0, 90));
        armed = true;
        return answer;
      }
      return native.apply(window, arguments);
    };
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: true,
        get() { return replacement; },
        set() { /* ignore reassignment */ }
      });
    } catch (e) { log('walls', 'could not shim ' + name, e); report('shim ' + name, e); }
  };

  shim('confirm', false);
  shim('alert', undefined);
  shim('prompt', null);

  /* ---------- 4. consent-or-pay walls ------------------------------------- */

  /* A different animal from the anti-adblock walls above. These offer "accept
   * tracking" or "pay", with no free reject, and they are served by a handful
   * of named vendors. The vendor's own container id *is* the signature, so this
   * needs no site list and no text matching — which matters, because the copy
   * is "Take control of your privacy", not anything about ads.
   *
   * Nothing is removed unless it is actually on screen: several of these ids
   * are wrapper elements the page keeps around permanently, and ripping out a
   * dormant one would break the page for no gain. */
  const CMP_SELECTOR = [
    '#qc-cmp2-container', '.qc-cmp-cleanslate',            // Quantcast Choice
    '#onetrust-consent-sdk', '.onetrust-pc-dark-filter',   // OneTrust
    '[id^="sp_message_container"]', '.sp_veil',            // Sourcepoint
    '#didomi-host', '.didomi-popup-backdrop',              // Didomi
    '#CybotCookiebotDialog',                               // Cookiebot
    '#CybotCookiebotDialogBodyUnderlay',
    '#truste-consent-track',                               // TrustArc
    '.fc-consent-root',                                    // Google Funding Choices
    '#usercentrics-root',                                  // Usercentrics
    '.cmp-root-container',                                 // InMobi
    '#mscmp-banner-container', '#cmp-banner-sdk',          // Microsoft (msn.com)
    '.cky-consent-container', '.cky-overlay',              // CookieYes (lesoleil.com)
    /* PMC / Vox "duet" (theverge.com). A notice, not a choice: "by continuing
     * to use our services, you agree", with Close and a link to the policy
     * page -- no refusal exists in the page, so it is removed, never closed. */
    '.duet--navigation--pmc-privacy-banner'
  ].join(',');

  /* Walks the subtree looking for a visible fixed/sticky box big enough to be a
   * modal. Budgeted, because a preference centre can hold hundreds of vendor
   * rows and this runs once a second. */
  const cmpShowing = (el) => {
    const stack = [el];
    let budget = 400;
    while (stack.length && budget-- > 0) {
      const n = stack.pop();
      let cs;
      try { cs = getComputedStyle(n); } catch (e) { continue; }
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (cs.position === 'fixed' || cs.position === 'sticky') {
        const r = n.getBoundingClientRect();
        if (r.width > 200 && r.height > 100) return true;
      }
      for (const c of n.children) stack.push(c);
    }
    return false;
  };

  const sweptConsent = new WeakSet();
  const askedToReject = new WeakSet();

  /* Refuse by pressing the vendor's own refusal button, in preference to
   * tearing the banner out. Removal leaves the question unanswered, so the
   * banner is rebuilt on every load; a recorded refusal stops it. Verified on
   * msn.com: clicking "Reject All" dismissed Microsoft's banner and it did not
   * return after a reload — the refusal is held server-side against the MUID,
   * with no cookie involved.
   *
   * The pattern is anchored and lists refusals only. It can never match
   * "I Accept", "Accept All" or "Manage Preferences", and a label longer than
   * 40 characters is ignored — a prose paragraph is not a button. */
  const REJECT_TEXT = new RegExp('^(' + [
    'reject all', 'reject', 'reject non[- ]essential', 'reject cookies',
    'decline all', 'decline', 'deny all', 'refuse all',
    'only essential', 'essential only', 'necessary only', 'only necessary',
    'continue without accepting'
  ].join('|') + ')$', 'i');

  const clickReject = (el) => {
    let buttons;
    try {
      buttons = el.querySelectorAll('button,[role="button"],a,input[type="button"],input[type="submit"]');
    } catch (e) { return null; }
    for (const b of buttons) {
      let text = '';
      try { text = String(b.textContent || b.value || '').trim(); } catch (e) { continue; }
      if (!text || text.length > 40 || !REJECT_TEXT.test(text)) continue;
      try { b.click(); } catch (e) { continue; }
      return text;
    }
    return null;
  };

  /* Some CMPs have no refusal button at all, only "Accept all" and a way into
   * the preference centre. CookieYes on lesoleil.com is the observed case:
   *
   *     first layer    "Personnaliser" | "Accepter tout"
   *     panel          148 switches; every *consent* switch off, but all 45
   *                    *legitimate interest* switches ON by default
   *                    (6 purposes, 39 vendors)
   *     footer         "Enregistrer mes préférences" | "Accepter tout"
   *
   * So "save my preferences" as shipped is not a refusal: it grants
   * legitimate interest to 39 vendors. The refusal is: open the panel, switch
   * off every switch that is on and not locked, confirm none is left on, and
   * only then save. Verified by hand on lesoleil.com: banner and panel closed,
   * record written as functional/analytics/performance/advertisement all "no".
   *
   * The vendor rows are built AFTER the panel opens. The first version of
   * this opened, switched off and saved in one go; on lenouvelliste.ca that
   * saved with 25 switches present and the 123 vendor rows not yet built, and
   * reopening the panel showed all 39 vendor legitimate-interest switches
   * still on. So it is staged across ticks: open, then wait until the switch
   * count has stopped changing AND the vendor's `ready` rows exist, and only
   * then switch off and save. If the panel never settles, save nothing.
   *
   * Driven by the vendor's class names, never by label text, so it works in
   * any language. If any switch will not turn off, nothing is saved: the panel
   * is closed and the banner falls through to removal on the next tick.
   * `save` is additionally refused if it looks like an accept button — the
   * one outcome this must never produce is consent. */
  const PREFS_REJECT = [
    { banner: '.cky-consent-container', open: '.cky-btn-customize',   // CookieYes
      panel: '.cky-modal', save: '.cky-btn-preferences', close: '.cky-btn-close',
      ready: '[id^="ckyIABVendorSection"][id*="Item"]' }
  ];
  const LOOKS_LIKE_ACCEPT = /accept|agree|allow|consent/i;
  const PREFS_MAX_WAIT = 10;             // ticks, ~1s each
  const PREFS_PENDING = {};
  const prefsState = new WeakMap();      // banner -> { ticks, count } | 'done'

  const rejectViaPrefs = (el) => {
    const state = prefsState.get(el);
    if (state === 'done') return null;
    for (const v of PREFS_REJECT) {
      let panel = null;
      const give_up = (why) => {
        prefsState.set(el, 'done');
        try { const c = panel && panel.querySelector(v.close); if (c) c.click(); } catch (e) { /* ignore */ }
        log('consent', why + '; saved nothing');
        return null;
      };
      try {
        if (!el.matches(v.banner)) continue;
        panel = document.querySelector(v.panel);
        const save = panel && panel.querySelector(v.save);
        if (!save || LOOKS_LIKE_ACCEPT.test(String(save.className))) return give_up('no safe save button');

        const boxes = () => panel.querySelectorAll('input[type="checkbox"]');

        if (!state) {
          const open = el.querySelector(v.open);
          if (open) open.click();
          prefsState.set(el, { ticks: 0, count: boxes().length });
          return PREFS_PENDING;
        }

        /* Settled = same number of switches as last tick, and the rows that
         * are built late are present. */
        const count = boxes().length;
        const settled = count === state.count && (!v.ready || panel.querySelector(v.ready));
        if (!settled) {
          state.count = count;
          if (++state.ticks >= PREFS_MAX_WAIT) return give_up('preference panel never settled');
          return PREFS_PENDING;
        }

        let off = 0;
        for (const box of boxes()) {
          if (box.checked && !box.disabled) { box.click(); off++; }
        }
        for (const box of boxes()) {
          if (box.checked && !box.disabled) return give_up('a switch would not turn off');
        }
        prefsState.set(el, 'done');
        save.click();
        return 'preferences saved with ' + off + ' of ' + count + ' switches turned off';
      } catch (e) { report('prefs reject', e); return give_up('error'); }
    }
    return null;
  };

  const sweepConsent = () => {
    if (!active('consent')) return;
    let nodes;
    try { nodes = document.querySelectorAll(CMP_SELECTOR); } catch (e) { return; }
    let found = false;
    for (const el of nodes) {
      if (sweptConsent.has(el)) continue;
      /* A preference-centre refusal in progress is carried on even if the
       * vendor has hidden its first layer behind the panel. */
      const st = prefsState.get(el);
      if (!(st && st !== 'done') && !cmpShowing(el)) continue;

      /* One attempt at the honest answer first, then the blunt one on the
       * next tick if the banner is still standing. */
      if (!askedToReject.has(el)) {
        askedToReject.add(el);
        const label = clickReject(el);
        if (label) {
          log('consent', 'clicked "' + label + '" on <' + el.localName + '> ' +
              (el.id || String(el.className).slice(0, 40)));
          /* Deliberately does NOT arm. `armed` switches on the body
           * protection, which exists for anti-adblock walls that empty the
           * page; a cookie banner is not that. Arming here turned msn.com into
           * a site where the extension blocked the page's own removals —
           * caught in the trace as "blocked remove() of body child". */
          continue;
        }
      }

      /* No refusal button: try the preference centre. It spans several ticks,
       * and the banner is left alone while it is in progress. */
      const prefs = rejectViaPrefs(el);
      if (prefs === PREFS_PENDING) continue;
      if (prefs) {
        log('consent', prefs + ' on <' + el.localName + '> ' + String(el.className).slice(0, 40));
        continue;
      }

      sweptConsent.add(el);
      log('consent', 'removed consent-or-pay wall <' + el.localName + '> ' +
          (el.id || String(el.className).slice(0, 40)));
      dropNode(el);
      found = true;
    }
    if (found) unlockScroll();
  };

  /* ---------- 4b. answer the consent API with "no" ------------------------
   * Removing the overlay and refusing the record leaves the answer *undefined*:
   * the page asks its CMP what the user chose and nothing ever replies. Two
   * bad outcomes follow. Some publishers block rendering until the TCF API
   * answers, so the article never appears. And a vendor that gets no answer is
   * free to treat the question as unasked and ask again later.
   *
   * So the API is answered, once, with every purpose, special feature and
   * vendor denied. That is the same answer the user would give by hand, and
   * it is given immediately instead of after a modal.
   *
   * Installed only where a TCF CMP actually exists — `window.__tcfapi` being a
   * function is that signal — so a site with no consent framework never sees
   * this global appear. */
  let denialInstalled = false;

  const TC_DATA = {
    tcString: '', tcfPolicyVersion: 2, cmpId: 0, cmpVersion: 0,
    gdprApplies: true, eventStatus: 'tcloaded', cmpStatus: 'loaded',
    listenerId: 0, isServiceSpecific: true, useNonStandardTexts: false,
    publisherCC: 'GB', purposeOneTreatment: false,
    purpose: { consents: {}, legitimateInterests: {} },
    vendor: { consents: {}, legitimateInterests: {} },
    specialFeatureOptins: {},
    publisher: {
      consents: {}, legitimateInterests: {},
      customPurpose: { consents: {}, legitimateInterests: {} },
      restrictions: {}
    }
  };

  const denyConsent = () => {
    if (denialInstalled || !active('consent')) return;
    let hasCmp = false;
    try {
      hasCmp = typeof window.__tcfapi === 'function' ||
               !!document.querySelector(CMP_SELECTOR);
    } catch (e) { return; }
    if (!hasCmp) return;
    denialInstalled = true;

    const respond = function (command, version, callback) {
      if (typeof callback !== 'function') return;
      try {
        if (command === 'ping') {
          callback({
            gdprApplies: true, cmpLoaded: true, cmpStatus: 'loaded',
            displayStatus: 'disabled', apiVersion: '2.2', cmpId: 0, cmpVersion: 0
          }, true);
        } else if (command === 'removeEventListener') {
          callback(true, true);
        } else {
          /* getTCData, addEventListener and anything else all get the same
           * all-denied payload. */
          callback(TC_DATA, true);
        }
      } catch (e) { /* the page's callback threw; not our problem to fix */ }
    };

    try {
      Object.defineProperty(window, '__tcfapi', {
        configurable: true, enumerable: false,
        get() { return respond; },
        set() { /* the CMP does not get to replace this */ }
      });
      log('consent', 'answering __tcfapi with every purpose denied');
    } catch (e) { report('tcfapi denial', e); }
  };

  /* ---------- 5. refuse to store the consent record ----------------------- */

  /* Removing the overlay is only half of it. If the CMP still writes its
   * record, a consent state we never gave is persisted and handed to the
   * vendor list on every later page. So the write is dropped instead.
   *
   * The names are the vendors' own, matched exactly — no prefix wildcards that
   * could catch an unrelated site's cookie. `sp_` is deliberately NOT here:
   * Sourcepoint uses `_sp_`, while bare `sp_` is Spotify's session and auth
   * pair, and blocking that would break logging in.
   *
   * Consequence, and it is the intended one: with nothing stored the wall
   * reappears on every load, and the sweep above removes it every time. */
  const CONSENT_NAME = new RegExp('^(' + [
    'euconsent(-v2)?', 'eupubconsent(-v2)?', 'addtl_consent',   // IAB TCF / Google AC
    'consentUUID', 'consentDate', '_sp_[\\w.-]*',               // Sourcepoint
    'OptanonConsent', 'OptanonAlertBoxClosed',                  // OneTrust
    'didomi_token', 'didomi_[\\w.-]*',                          // Didomi
    'CookieConsent',                                            // Cookiebot
    'notice_gdpr_prefs', 'notice_preferences',                  // TrustArc
    'cmapi_cookie_privacy', 'FCCDCF', 'usercentrics[\\w.-]*',
    'cookieyes-consent'                                         // CookieYes
  ].join('|') + ')$', 'i');

  const cookieDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  if (cookieDesc && cookieDesc.set && cookieDesc.get) {
    try {
      Object.defineProperty(Document.prototype, 'cookie', {
        configurable: true,
        enumerable: cookieDesc.enumerable,
        get() { return cookieDesc.get.call(this); },
        set(v) {
          const name = String(v).split('=')[0].trim();
          if (active('cookies') && CONSENT_NAME.test(name)) {
            log('cookies', 'refused to store consent cookie ' + name);
            return;
          }
          return cookieDesc.set.call(this, v);
        }
      });
    } catch (e) { log('cookies', 'could not guard document.cookie', e); report('cookie guard', e); }
  }

  /* Didomi and Sourcepoint mirror the record into localStorage, so the cookie
   * guard alone would not stop it persisting. */
  if (window.Storage) {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key) {
      if (active('cookies') && CONSENT_NAME.test(String(key))) {
        log('cookies', 'refused to store consent key ' + key);
        return;
      }
      return setItem.apply(this, arguments);
    };
  }

  /* ---------- 6. keep <body> and its contents, once armed ----------------- */

  let savedBody = null;
  let original = null;
  let restores = 0;
  const MAX_RESTORES = 5;

  const isRoot = (n) => n === document.documentElement || n === document.body ||
                        (savedBody && n === savedBody);

  /* Only defends when a wall signature has been seen, and only while the
   * setting is on. On a clean site these are pass-through. */
  const domOn = () => armed && active('dom');

  const isDefendedChild = (n) =>
    domOn() && n && n.parentNode && n.parentNode === document.body;

  const elRemove = Element.prototype.remove;
  Element.prototype.remove = function () {
    if (domOn() && isRoot(this)) { log('dom', 'blocked remove() on <' + this.localName + '>'); return; }
    if (isDefendedChild(this)) { log('dom', 'blocked remove() of body child <' + this.localName + '>'); return; }
    return elRemove.apply(this, arguments);
  };

  const removeChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function (child) {
    if (domOn() && isRoot(child)) { log('dom', 'blocked removeChild of <' + child.localName + '>'); return child; }
    if (isDefendedChild(child)) { log('dom', 'blocked removeChild of body child'); return child; }
    return removeChild.apply(this, arguments);
  };

  const remember = () => {
    const b = document.body;
    if (!b || b.childNodes.length === 0) return;
    original = [].slice.call(b.childNodes);
  };

  const restore = () => {
    const b = document.body;
    if (!domOn() || !b || !original || original.length === 0) return;
    if (b.childNodes.length > 0 || restores >= MAX_RESTORES) return;
    restores++;
    log('dom', 'body was emptied — restoring ' + original.length + ' nodes (attempt ' + restores + ')');
    for (const node of original) {
      try { b.appendChild(node); } catch (e) { /* skip */ }
    }
  };

  let bodyObserver = null;
  const observeBody = () => {
    if (bodyObserver || !document.body) return;
    bodyObserver = new MutationObserver(tick);
    bodyObserver.observe(document.body, { childList: true });
  };

  function tick() {
    if (document.body) savedBody = document.body;
    observeBody();
    if (savedBody && !savedBody.isConnected && armed) {
      log('dom', 'body was detached — reattaching');
      try { document.documentElement.appendChild(savedBody); }
      catch (e) { log('dom', e); report('reattach body', e); }
    }
    remember();
    restore();
    sweepWalls();
    sweepConsent();
    denyConsent();
  }

  new MutationObserver(tick).observe(document.documentElement, { childList: true });
  document.addEventListener('DOMContentLoaded', tick);
  window.addEventListener('load', tick);
  setInterval(tick, 1000);
  observeBody();
})();
