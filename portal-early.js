/*
 * Keep The Page — msn.com / bing.com, hidden before first paint.
 * Content script, MAIN world, document_start.
 *
 * portal.js removes these components, but it runs at document_end and MSN's
 * feed is server-rendered: the cards are in the served HTML and are painted
 * long before any script of ours looks at them. You see the feed, then you see
 * it vanish. This file is the half that stops it ever appearing.
 *
 * Two things make that harder than one stylesheet:
 *
 *   1. **A document stylesheet does not cross a shadow boundary.** Almost
 *      everything on these pages lives in one of ~160 open shadow roots, so a
 *      rule in <head> reaches almost none of it.
 *
 *   2. **The roots do not exist yet at document_start.** So `attachShadow` is
 *      patched, and every root gets the sheets as it is created — before the
 *      component inside it has rendered anything. Patching it also catches
 *      *closed* roots, which no query can reach afterwards.
 *
 * Constructable stylesheets are used rather than a <style> per root: four
 * shared objects adopted by every root, instead of 640 elements. Emptying one
 * unhides that feature everywhere at once, which is how the settings are
 * applied — see the config event at the bottom.
 *
 * This runs in the MAIN world because Element.prototype belongs to the page.
 * It therefore cannot read chrome.storage, so it starts from the documented
 * defaults (everything hidden) and portal.js corrects it a few milliseconds
 * later. The default path is the flash-free one; a feature you have switched
 * OFF may show a brief hidden flicker before it is restored. That trade is
 * deliberate: the common case is the one that must not flash.
 */
(() => {
  'use strict';

  const TAG = '[keep-the-page] early';

  /* ---------- tracing ------------------------------------------------------
   * Same gate as walls.js: bridge.js writes data-ktp-trace on <html> when a
   * channel is on, and nothing at all when tracing is off. Cached, because
   * this is called from a per-frame scan. */
  let traceSpec = '';
  let traceAt = 0;

  const traced = () => {
    const now = Date.now();
    if (now - traceAt > 250) {
      traceAt = now;
      try {
        const root = document.documentElement;
        traceSpec = (root && root.getAttribute('data-ktp-trace')) || '';
      } catch (e) { traceSpec = ''; }
    }
    if (!traceSpec) return false;
    return traceSpec === 'all' || traceSpec.split(',').indexOf('portal') !== -1;
  };

  const at = () => Math.round(performance.now()) + 'ms';
  const log = (...a) => { if (traced()) console.debug(TAG, at(), ...a); };

  /* A console line only exists if something is listening at the moment it is
   * written, and load-time output does not survive the navigation that
   * produced it — which is exactly the trap this project has hit before. So
   * the same counters are also left on <html>, readable long afterwards:
   *
   *     data-ktp-early="v=<version> roots=44 adopted=44 vis=0 last=3180ms"
   *
   * Written only while the portal trace channel is on, so a normal install
   * still writes nothing to the page. */
  const VERSION = '1030';
  const mark = (extra) => {
    if (!traced()) return;
    try {
      document.documentElement.setAttribute('data-ktp-early',
        'v=' + VERSION + ' ' + extra + ' at=' + at());
    } catch (e) { /* ignore */ }
  };

  /* Selector fragments, by setting. Matching is on MSN's own component names
   * inside data-t, which is JSON: {"n":"WeatherCardWC","t":8}. A substring
   * match on '"n":"Name"' is exact because of the closing quote; the LeadGen
   * fragment deliberately has none, so it matches every advertiser tile. */
  const GROUPS = {
    comments: ['"n":"Comments"'],
    cards: [
      '"n":"WeatherCard"', '"n":"WeatherCardWC"',
      '"n":"MoneyCard"', '"n":"MoneyInfo"',
      '"n":"SportsCard"', '"n":"SportsInfo"', '"n":"TeamVsTeam"',
      '"n":"LeadGen.', '"n":"meStripe.Games"'
    ],
    tabs: [
      '"n":"news"', '"n":"sports"', '"n":"play"', '"n":"finance"',
      '"n":"weather"', '"n":"watch"', '"n":"shopping"'
    ],
    feed: ['"n":"PivotsNav"', '"n":"WaterfallViewFeed"', '"n":"BingHomepageFeed"']
  };

  /* Structural selectors that match at parse time, before any attribute is
   * read or any script runs: the feed's own custom element, the widget host,
   * and Bing's carousel/quiz strip. Homepage only, with the rest of `feed`. */
  const FEED_EXTRA = ['#scroll_cont', '#widget_container', '.peregrine-widgets',
                      'cs-responsive-feed-layout'].join(',');

  const isHomepage = () => {
    try {
      const path = location.pathname;
      if (/(^|\.)bing\.com$/i.test(location.hostname)) return path === '/';
      return /^\/(?:[a-z]{2}-[a-z]{2}\/?)?$/i.test(path);
    } catch (e) { return false; }
  };

  const cssFor = (name) => {
    let parts = GROUPS[name].map((f) => '[data-t*=\'' + f + '\']');
    if (name === 'feed' && isHomepage()) parts = parts.concat(FEED_EXTRA.split(','));
    if (name === 'feed' && !isHomepage()) return '';   /* never on an article */
    return parts.join(',') + '{display:none!important}';
  };

  /* One sheet per setting, so one setting can be lifted without touching the
   * others. Falls back to nothing if the browser lacks constructable sheets —
   * portal.js still removes the nodes, just later. */
  const sheets = {};
  let ok = true;
  try {
    for (const name of Object.keys(GROUPS)) {
      const s = new CSSStyleSheet();
      s.replaceSync(cssFor(name));
      sheets[name] = s;
    }
  } catch (e) { ok = false; }

  log('sheets built, constructable =', ok, 'homepage =', isHomepage());
  mark('start constructable=' + ok + ' homepage=' + isHomepage());

  const all = () => Object.keys(sheets).map((k) => sheets[k]);

  let adopted = 0;

  const adopt = (root) => {
    if (!ok || !root) return;
    try {
      const have = root.adoptedStyleSheets || [];
      const add = all().filter((s) => have.indexOf(s) === -1);
      if (add.length) { root.adoptedStyleSheets = have.concat(add); adopted++; }
    } catch (e) { /* some roots refuse; the JS sweep still covers them */ }
  };

  adopt(document);

  /* A plain <style> as well as the adopted sheet, for two reasons. The page can
   * assign document.adoptedStyleSheets and drop ours — assignment replaces the
   * array — and a style element is the only thing that applies while the
   * document is still being parsed if that happens. It is cheap: one element. */
  const injectStyle = () => {
    try {
      if (document.getElementById('ktp-portal-early')) return;
      const s = document.createElement('style');
      s.id = 'ktp-portal-early';
      s.textContent = Object.keys(GROUPS).map(cssFor).filter(Boolean).join('\n');
      (document.head || document.documentElement).appendChild(s);
    } catch (e) { /* ignore */ }
  };
  injectStyle();
  log('style element injected, rules =',
      Object.keys(GROUPS).map(cssFor).filter(Boolean).length);

  /* Declarative shadow DOM is the case the attachShadow patch cannot see: the
   * server sends <template shadowrootmode="open"> and the parser builds the
   * root itself, without any script being called. Those roots exist before our
   * patch can fire, so new nodes are watched and their roots adopted as they
   * are parsed. The observer runs at microtask end, still ahead of paint. */
  /* Walking only the added nodes is not enough, and this is the subtlety that
   * kept the flash alive: with declarative shadow DOM the host element is
   * appended BEFORE the parser has read its <template shadowrootmode>, so at
   * the moment the mutation fires `host.shadowRoot` is still null. The whole
   * tree therefore has to be re-scanned, not just what was added.
   *
   * Measured on msn.com: ~1600 elements, well under a millisecond a pass,
   * against a first paint at ~3000ms. Cheap enough to run every frame until
   * the page has settled. */
  /* Counts what is on screen right now that we meant to hide. If this is ever
   * above zero the rules are not reaching those nodes, which is the whole
   * question when something flashes. */
  const stillVisible = () => {
    let n = 0;
    const sel = Object.keys(GROUPS).map(cssFor).filter(Boolean)
      .map((r) => r.split('{')[0]).join(',');
    const roots = [document];
    try {
      for (const el of document.querySelectorAll('*')) {
        if (el.shadowRoot) roots.push(el.shadowRoot);
      }
      for (const r of roots) {
        for (const el of r.querySelectorAll(sel)) {
          const b = el.getBoundingClientRect();
          if (b.height > 0 && b.width > 0) n++;
        }
      }
    } catch (e) { /* ignore */ }
    return n;
  };

  let peakVis = 0;
  let lastError = '';

  /* peakVis stayed at 0 through a whole load while the feed was still visibly
   * flashing, which means the thing that paints is NOT one of our targets.
   * This records what actually occupies the screen early on: the biggest
   * visible block, by name, at the first tick where anything large is painted.
   * Without it the next step is another guess. */
  let firstBig = '';

  const biggest = () => {
    let best = null, bestArea = 0;
    const consider = (el) => {
      let b;
      try { b = el.getBoundingClientRect(); } catch (e) { return; }
      const area = b.width * b.height;
      if (b.top > innerHeight || b.height < 80 || area < bestArea) return;
      bestArea = area; best = el;
    };
    try {
      for (const el of document.querySelectorAll('*')) {
        consider(el);
        if (el.shadowRoot) for (const s of el.shadowRoot.querySelectorAll('*')) consider(s);
      }
    } catch (e) { /* ignore */ }
    if (!best) return '';
    let name = '';
    try {
      const a = best.getAttribute('data-t') || '';
      name = a.charAt(0) === '{' ? (JSON.parse(a) || {}).n || '' : a;
    } catch (e) { /* ignore */ }
    return best.localName + (name ? '[' + name + ']' : '') +
           (best.id ? '#' + best.id : '') +
           '.' + String(best.className || '').split(' ')[0].slice(0, 18) +
           ':' + Math.round(bestArea / 1000) + 'k';
  };

  const scanInner = () => {
    let els;
    try { els = document.querySelectorAll('*'); } catch (e) { return; }
    const was = adopted;
    for (const el of els) {
      const sr = el.shadowRoot;
      if (!sr) continue;
      let have;
      try { have = sr.adoptedStyleSheets || []; } catch (e) { continue; }
      if (have.indexOf(sheets.feed) === -1) adopt(sr);
    }
    /* Only measured while tracing: it walks the tree a second time. */
    const seen = traced() ? stillVisible() : 0;
    if (seen > peakVis) peakVis = seen;
    if (traced() && !firstBig) {
      const b = biggest();
      if (b) firstBig = b + '@' + at();
    }
    if (adopted !== was) {
      const vis = seen;
      log('adopted into', adopted - was, 'new root(s),', adopted, 'total;',
          'readyState =', document.readyState, '; visible targets =', vis);
      mark('adopted=' + adopted + ' vis=' + vis + ' state=' + document.readyState);
    }
  };

  /* A throw in here used to kill the loop outright, taking every later scan
   * with it — the counters simply stopped at 889ms and nothing said why. Now
   * it survives and the reason is carried in the marker. */
  const scan = () => {
    try { scanInner(); } catch (e) {
      lastError = String((e && e.message) || e).slice(0, 80);
      mark('ERROR ' + lastError + ' adopted=' + adopted);
    }
  };

  let queued = false;
  const queueScan = () => {
    if (queued) return;
    queued = true;
    const run = () => { queued = false; scan(); };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 0);
  };

  try {
    new MutationObserver(queueScan).observe(document.documentElement || document, {
      childList: true, subtree: true
    });
  } catch (e) { /* no observer; the attachShadow patch still covers JS roots */ }

  scan();

  /* Parsing can outlast the last mutation we see, and a root adopted a frame
   * late is a root whose contents painted. Keep scanning until the page is
   * done, then stop: portal.js removes the nodes from there on. */
  const until = Date.now() + 10000;
  let ticks = 0;
  const tick = () => {
    scan();
    if (++ticks % 4 === 0) {
      const vis = stillVisible();
      log('tick', ticks, 'readyState =', document.readyState,
          '; roots adopted =', adopted, '; visible targets =', vis);
      mark('ticks=' + ticks + ' adopted=' + adopted + ' vis=' + vis +
           ' peakVis=' + peakVis + ' state=' + document.readyState +
           ' firstBig=' + (firstBig || 'none') + ' nowBig=' + biggest() +
           (lastError ? ' lastError=' + lastError : ''));
    }
    if (Date.now() < until && document.readyState !== 'complete') {
      setTimeout(tick, 16);
    } else if (Date.now() < until) {
      setTimeout(tick, 250);
    }
  };
  tick();

  /* Every shadow root gets the sheets at the moment it is created, which is
   * before anything inside it has rendered. */
  if (ok && typeof Element !== 'undefined' && Element.prototype.attachShadow) {
    const native = Element.prototype.attachShadow;
    try {
      Element.prototype.attachShadow = function (init) {
        const root = native.call(this, init);
        adopt(root);
        return root;
      };
    } catch (e) { /* leave the native one alone */ }
  }

  /* portal.js reads the settings and tells us which of these the user has
   * switched off. detail crosses the world boundary as a string — an object
   * does not survive it reliably. */
  document.addEventListener('ktp-portal-config', (ev) => {
    let cfg;
    try { cfg = JSON.parse(ev.detail); } catch (e) { return; }
    if (!cfg || typeof cfg !== 'object') return;
    log('settings arrived:', ev.detail);
    for (const name of Object.keys(sheets)) {
      try {
        sheets[name].replaceSync(cfg[name] === false ? '' : cssFor(name));
      } catch (e) { /* ignore */ }
    }
    /* Keep the plain <style> in step with the sheets. */
    try {
      const el = document.getElementById('ktp-portal-early');
      if (el) {
        el.textContent = Object.keys(GROUPS)
          .filter((n) => cfg[n] !== false).map(cssFor).filter(Boolean).join('\n');
      }
    } catch (e) { /* ignore */ }
  });
})();
