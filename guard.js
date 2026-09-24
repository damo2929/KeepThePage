/*
 * Keep The Page — content script, document_start, MAIN world.
 * Runs before any script in the page.
 *
 * The whole Newsquest anti-adblock wall is gated behind one global:
 *
 *     line 1647:  var adLight = false;
 *     line 2020:  if (adLight !== true) {   <-- loader, eval payload, confirm()
 *
 * adLight is the subscriber "light ads" flag. When true, the page sets a DFP
 * category exclusion and skips one ad slot — and never builds the wall at all.
 * Pinning it true is therefore the whole fix: nothing to block, nothing to
 * dismiss, no anti-tamper tripped.
 *
 * Do NOT interfere with the wall once it is running. Its loader verifies its
 * own writes took effect:
 *
 *     z.call(O,'src',G), O[x]('src')!==G && throw E
 *     ... catch(W){ try{ await l(W) } catch(x){ o(W) } }   // o() raises confirm()
 *
 * Guarding setAttribute makes that check fail, which routes straight into the
 * dialog. Blocking is worse than never triggering.
 */
(() => {
  'use strict';

  const TAG = '[keep-the-page]';

  /* Same trace gate as walls.js — see bridge.js for why the channel list
   * arrives as an attribute on <html> rather than from chrome.storage. */
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

  /* ---------- 1. Pin adLight = true (the actual fix) ---------------------
   * `var adLight = false` at top level does not redefine an existing own
   * property of the global object — it only assigns. So a non-configurable
   * accessor installed here survives the declaration, and the assignment is
   * swallowed by a setter that ignores it. This is the ONLY property here that
   * must be non-configurable: everything else below uses configurable: true so
   * nothing is permanently locked out of a page's own APIs. The setter must not throw: the
   * page's script is sloppy-mode, but a throw would break unrelated code.
   */
  const pinTrue = (name) => {
    try {
      Object.defineProperty(window, name, {
        configurable: false,
        enumerable: true,
        get() { return true; },
        set() { /* ignore the page's "false" */ }
      });
      log('newsquest', 'pinned window.' + name + ' = true');
    } catch (e) {
      log('newsquest', 'could not pin ' + name + ':', e);
      report('pin ' + name, e);
    }
  };

  pinTrue('adLight');

  /* ---------- 2. Pin __adblocker=false -----------------------------------
   * Belt and braces for the older bait-file detector:
   *   script.src = "//www.npttech.com/advertising.js"
   *   script.onerror = setNptTechAdblockerCookie(true)
   */
  const PINNED = ['__adblocker', '__adblock'];
  const YEAR = 400 * 24 * 60 * 60 * 1000;
  const nameOf = (s) => String(s).split('=')[0].trim().toLowerCase();

  const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  if (desc && desc.get && desc.set) {
    const nativeGet = desc.get;
    const nativeSet = desc.set;

    const writeFalse = (name) => {
      const expires = new Date(Date.now() + YEAR).toUTCString();
      try {
        nativeSet.call(document, name + '=false; expires=' + expires + '; path=/; SameSite=Lax');
      } catch (e) { log('newsquest', 'cookie write failed:', e); report('__adblocker write', e); }
    };

    Object.defineProperty(Document.prototype, 'cookie', {
      configurable: true,
      enumerable: desc.enumerable,
      get() { return nativeGet.call(this); },
      set(value) {
        const raw = String(value);
        if (PINNED.includes(nameOf(raw))) {
          /* Covers "=true", the expires-in-1970 delete, and an empty value. */
          log('newsquest', 'intercepted cookie write: ' + raw.slice(0, 70));
          const expires = new Date(Date.now() + YEAR).toUTCString();
          return nativeSet.call(this, nameOf(raw) + '=false; expires=' + expires + '; path=/; SameSite=Lax');
        }
        return nativeSet.call(this, raw);
      }
    });

    const enforce = () => {
      const current = /(?:^|;\s*)__adblocker\s*=\s*([^;]*)/.exec(nativeGet.call(document));
      if (!current || current[1].trim() !== 'false') writeFalse('__adblocker');
    };

    enforce();
    document.addEventListener('DOMContentLoaded', enforce);
    window.addEventListener('load', enforce);
    /* Poll while the page settles, then back off — the onerror write lands at
     * an arbitrary time, but it does not need a 1s poll for the tab's life. */
    let fast = setInterval(enforce, 1000);
    setTimeout(() => { clearInterval(fast); setInterval(enforce, 15000); }, 60000);
  }

  /* Everything else — dialogs, overlay walls, eval-scheduled timers, body
   * protection — moved to walls.js, where it is armed by signature and can
   * therefore run on every site instead of a hand-maintained domain list.
   *
   * The adLight pin cannot move: it must beat the page's own
   * `var adLight = false` at document_start, which is earlier than any
   * signature can be observed. So it stays here, scoped to the titles that
   * actually use that flag.
   */
})();
