/*
 * Keep The Page — settings bridge.
 * Content script, document_start, ISOLATED world, all frames.
 *
 * walls.js and guard.js run in the MAIN world, where chrome.* does not exist,
 * so they cannot read the extension's settings themselves. This script runs in
 * the isolated world, reads the settings, and publishes two attributes on
 * <html> that the MAIN-world scripts can see: the enabled trace channels, and
 * the defences that have been switched off.
 *
 * Two deliberate properties:
 *
 *   1. When tracing is off — the default — this writes nothing at all. The
 *      page sees no attribute, no global, no injected node. That matters:
 *      these anti-adblock SDKs look for tampering, and a permanent marker on
 *      <html> is exactly the kind of thing worth not handing them. The cost of
 *      the setting is zero until someone turns it on.
 *
 *   2. chrome.storage is async, so the attribute lands a few milliseconds
 *      after document_start. Anything logged in that window is missed. The
 *      guards log continuously rather than once, so this is a small gap, but
 *      it is real — a trace is not proof that nothing happened before it
 *      appeared.
 */
(() => {
  'use strict';

  const ATTR = 'data-ktp-trace';
  const KEY = 'trace';

  /* Defences are all on by default, so what crosses to the MAIN world is the
   * list of ones TURNED OFF. A default install writes no attribute at all,
   * which keeps the "nothing on the page unless you asked for it" property
   * that tracing has. */
  const OFF_ATTR = 'data-ktp-off';
  const PROTECT = 'protect';
  /* `timers` and `newsquest` are not here: both act before this script's
   * storage read can land, so a switch for them would not be honoured in the
   * window that matters. They are always on, and the options page says so. */
  const DEFENCES = ['walls', 'consent', 'cookies', 'dom'];

  const apply = (trace) => {
    const root = document.documentElement;
    if (!root) return;
    try {
      if (!trace || !trace.enabled) {
        root.removeAttribute(ATTR);
        return;
      }
      const channels = Array.isArray(trace.channels) ? trace.channels : [];
      if (channels.length === 0) {
        root.removeAttribute(ATTR);
        return;
      }
      root.setAttribute(ATTR, channels.join(','));
    } catch (e) { /* document not ready, or attribute rejected */ }
  };

  const applyProtect = (p) => {
    const root = document.documentElement;
    if (!root) return;
    try {
      const off = DEFENCES.filter((d) => p && p[d] === false);
      if (off.length === 0) root.removeAttribute(OFF_ATTR);
      else root.setAttribute(OFF_ATTR, off.join(','));
    } catch (e) { /* document not ready, or attribute rejected */ }
  };

  /* ---------- errors reported out of the MAIN world ----------------------
   * walls.js and guard.js swallow their own exceptions so they can never break
   * a page. That silence is the problem this collects: without it, a guard that
   * stops working looks exactly like a guard with nothing to do.
   *
   * Kept to the last MAX entries, newest first, in chrome.storage.local under
   * `errors`. The settings page reads and clears it. */
  const ERRORS = 'errors';
  const MAX = 50;

  document.addEventListener('ktp-report', (ev) => {
    let entry;
    try {
      entry = JSON.parse(ev.detail);          /* detail crosses worlds as a string */
    } catch (e) { return; }
    if (!entry || typeof entry !== 'object') return;
    try {
      chrome.storage.local.get(ERRORS, (got) => {
        if (chrome.runtime.lastError) return;
        const list = Array.isArray(got && got[ERRORS]) ? got[ERRORS] : [];
        /* Same failure on the same site repeats on every tick; count it rather
         * than filling the buffer with one message. */
        const head = list[0];
        if (head && head.where === entry.where && head.host === entry.host &&
            head.message === entry.message) {
          head.count = (head.count || 1) + 1;
          head.at = entry.at;
        } else {
          entry.count = 1;
          list.unshift(entry);
        }
        chrome.storage.local.set({ [ERRORS]: list.slice(0, MAX) });
      });
    } catch (e) { /* storage gone; nothing useful left to do */ }
  });

  try {
    chrome.storage.local.get([KEY, PROTECT], (got) => {
      if (chrome.runtime.lastError) return;
      apply(got && got[KEY]);
      applyProtect(got && got[PROTECT]);
    });

    /* Live updates: toggling a channel in the options page takes effect on
     * pages that are already open, without a reload. */
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[KEY]) apply(changes[KEY].newValue);
      if (changes[PROTECT]) applyProtect(changes[PROTECT].newValue);
    });
  } catch (e) { /* storage unavailable — stay silent, which is the default */ }
})();
