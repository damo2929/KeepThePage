/*
 * Keep The Page — Microsoft portal feed cleanup (msn.com, bing.com).
 * Content script, ISOLATED world, document_end.
 *
 * One script for both because they are the same product underneath: the Bing
 * homepage embeds the same Peregrine widget stack, with the same ~160 shadow
 * roots and the same component names — Comments, WeatherCardWC, MoneyCard,
 * SportsCard, TeamVsTeam, WaterfallViewFeed, ContentCard. Measured on both.
 *
 * Four switchable removals, all on by default:
 *
 *   comments  the comment count and link on every card
 *   cards     weather, finance, sports, the games tile, and the
 *             Booking / Temu / eBay lead-gen tiles
 *   tabs      the section tabs beside Discover
 *   feed      the whole feed: MSN's Discover river, Bing's below-the-fold feed
 *             and its carousel/quiz strip. What is left is the search box and
 *             the page's own furniture
 *
 * Why this is done in the DOM rather than by writing MSN's own preference:
 *
 *   MSN does have a Content settings panel (Personalise -> Content settings)
 *   with switches for Comments, Weather, Casual Games, Finance, Sports,
 *   Shopping, Recipes, Autos Marketplace, Today's Moment and Community. None
 *   of them is stored in a cookie. Flipping one POSTs to
 *
 *       assets.msn.com/service/msn/user?...&user=m-01C1...&scn=ANON
 *
 *   so the preference lives on Microsoft's servers, keyed to the anonymous
 *   MUID. There is no cookie to generate, and replicating the call would need
 *   host permissions this extension deliberately does not have. Worse, it does
 *   not even work: with Comments switched off in that panel, the feed still
 *   rendered 20 comment links. Measured, not assumed.
 *
 * Targeting is by MSN's own component names in `data-t`, which is a JSON blob
 * whose `n` field names the component — `WeatherCardWC`, `MoneyInfo`,
 * `SportsCard`, `LeadGen.eBay`. Those names are stable across loads; the class
 * names are hashed per build and are not.
 *
 * Everything here lives in shadow DOM: the msn.com front page has ~160 open
 * shadow roots and one anchor in the light DOM, so every query walks the tree.
 */
(() => {
  'use strict';

  const TAG = '[keep-the-page] portal';

  /* Same trace gate as walls.js and portal-early.js; channel 'portal'. */
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
  const log = (...a) => {
    if (traced()) console.debug(TAG, Math.round(performance.now()) + 'ms', ...a);
  };

  const KEY = 'portal';
  const DEFAULTS = {
    comments: true,      /* the comment count and link on every card */
    cards: true,         /* weather, finance, sports, games, advertiser tiles */
    tabs: true,          /* the section tabs beside Discover */
    feed: true           /* Discover itself and the river of cards it shows */
  };
  let cfg = DEFAULTS;

  /* Card components that are not news. Every name here was observed in the
   * live feed; nothing is guessed. Exact names, not prefixes, because a prefix
   * match on "Sports" would also catch the sports *articles* in the feed.
   *
   * These are the backstop, not the primary route. Turning the switches off in
   * MSN's own Content settings does remove them — verified by scrolling 11,700px
   * through the feed afterwards, with WeatherCard, MoneyCard, MoneyInfo,
   * SportsCard, SportsInfo and TeamVsTeam all absent. But that preference is
   * held server-side against the anonymous MUID, so it is lost whenever cookies
   * are cleared, in a fresh profile, and in incognito. This list covers those. */
  const CARDS = [
    'WeatherCard', 'WeatherCardWC',
    'MoneyCard', 'MoneyInfo',
    'SportsCard', 'SportsInfo', 'TeamVsTeam'
  ];

  /* What MSN's own switches do NOT remove, measured with all nine card
   * switches off: the Games tile in the quick-links strip survives "Casual
   * Games", and the advertiser tiles survive "Shopping". Prefix matches,
   * because the lead-gen tiles are one per advertiser (LeadGen.eBay,
   * LeadGen.Temu, LeadGen.booking) and that list cannot be exhaustive. */
  const CARD_PREFIX = ['LeadGen.', 'meStripe.Games'];

  /* The section tabs beside Discover: News, Sports, Play, Money, Weather,
   * Watch, Shopping. They are `a.navItem` links in one <ul>, each carrying its
   * own data-t name — `finance` is the one labelled "Money". Discover is
   * `myFeed` and is kept: it is the feed you are looking at, and removing it
   * would leave the bar with nothing selected.
   *
   * Verified free of collisions before shipping: across the whole page,
   * including every shadow root, these eight names match exactly eight
   * elements, all `a.navItem` inside a single list. */
  const PIVOTS = ['news', 'sports', 'play', 'finance', 'weather', 'watch', 'shopping'];

  /* The feed itself: the tab bar including Discover, and the river of cards it
   * shows. With both gone the homepage is the logo, the search box, the quick
   * links and the header — which is the point of the setting, not a mistake.
   *
   * Homepage only. An article page carries a river too (related stories below
   * the piece), and this must not be what removes the thing you came to read. */
  const FEED = ['PivotsNav', 'WaterfallViewFeed', 'BingHomepageFeed'];

  /* Bing keeps a card carousel and its homepage quiz in a strip above the fold,
   * outside the widget stack and with no data-t of its own. Removing the feed
   * without this leaves a 203px band of cards over the hero image. */
  const FEED_SELECTOR = '#scroll_cont';

  /* Bing rebuilds the strip on its periodic page refresh — measured: removed
   * once, still gone after 12s of 250ms re-checks, then back after a refresh.
   * The sweep catches it within 2s, but a rule costs nothing and means it never
   * appears at all. Only Bing's, because MSN's feed components live in shadow
   * roots that a document stylesheet cannot reach; the sweep handles those. */
  const FEED_CSS = FEED_SELECTOR + '{display:none!important}';

  const styleFeed = () => {
    try {
      const had = document.getElementById('ktp-portal-css');
      if (!(cfg.feed && isHomepage())) { if (had) had.remove(); return; }
      if (had) return;
      const s = document.createElement('style');
      s.id = 'ktp-portal-css';
      s.textContent = FEED_CSS;
      (document.head || document.documentElement).appendChild(s);
    } catch (e) { /* ignore */ }
  };

  const isHomepage = () => {
    try {
      const path = location.pathname;
      if (/(^|\.)bing\.com$/i.test(location.hostname)) return path === '/';
      return /^\/(?:[a-z]{2}-[a-z]{2}\/?)?$/i.test(path);
    } catch (e) { return false; }
  };

  /* Same walk as social.js. Not shared: content scripts have no module
   * boundary between them, and a copy of twelve lines beats a global. */
  const roots = () => {
    const out = [document];
    const seen = new Set();
    const visit = (root) => {
      let els;
      try { els = root.querySelectorAll('*'); } catch (e) { return; }
      for (const el of els) {
        const sr = el.shadowRoot;
        if (sr && !seen.has(sr)) { seen.add(sr); out.push(sr); visit(sr); }
      }
    };
    visit(document);
    return out;
  };

  const queryAll = (sel) => {
    const out = [];
    for (const r of roots()) {
      try { out.push(...r.querySelectorAll(sel)); } catch (e) { /* skip */ }
    }
    return out;
  };

  /* data-t is usually {"n":"WeatherCardWC","t":8} but is sometimes a bare
   * string, so both shapes are read. */
  const nameOf = (el) => {
    let a;
    try { a = el.getAttribute('data-t') || ''; } catch (e) { return ''; }
    if (a.charAt(0) !== '{') return a;
    try { return (JSON.parse(a) || {}).n || ''; } catch (e) { return ''; }
  };

  const isCard = (n) =>
    CARDS.indexOf(n) !== -1 || CARD_PREFIX.some((p) => n.indexOf(p) === 0);

  let removed = 0;

  /* A card component sits inside a <cs-responsive-card> that owns the tile's
   * spacing. Removing the inner component alone leaves an empty tile, so the
   * wrapper goes when there is one. */
  const drop = (el) => {
    let target = el;
    try {
      const host = el.closest && el.closest('cs-responsive-card');
      if (host) target = host;
    } catch (e) { /* closest not available across a shadow boundary */ }
    try { target.remove(); removed++; } catch (e) { /* already gone */ }
  };

  /* A pivot's <li> goes with it, or the list keeps its spacing. Only an
   * anchor inside a list item is touched, so a future component that happens
   * to be named "play" is not caught by this. */
  const dropPivot = (el) => {
    if (el.localName !== 'a') return;
    let li = null;
    try { li = el.closest && el.closest('li'); } catch (e) { /* ignore */ }
    try { (li || el).remove(); removed++; } catch (e) { /* already gone */ }
  };

  let sweeps = 0;

  const sweep = () => {
    if (!cfg.comments && !cfg.cards && !cfg.tabs && !cfg.feed) return;
    const killFeed = cfg.feed && isHomepage();
    const was = removed;
    sweeps++;
    try {
      for (const el of queryAll('[data-t]')) {
        const n = nameOf(el);
        if (!n) continue;
        if (killFeed && FEED.indexOf(n) !== -1) { drop(el); continue; }
        if (cfg.comments && n === 'Comments') { drop(el); continue; }
        /* Redundant once the whole bar has gone, but it still applies when the
         * feed is kept and only the extra sections are not wanted. */
        if (cfg.tabs && PIVOTS.indexOf(n) !== -1) { dropPivot(el); continue; }
        if (cfg.cards && isCard(n)) drop(el);
      }
      if (killFeed) {
        for (const el of queryAll(FEED_SELECTOR)) drop(el);
      }
      if (removed !== was) {
        log('sweep', sweeps, 'removed', removed - was, 'node(s),', removed, 'total;',
            'readyState =', document.readyState);
      }
      /* The hero carousel labels its comment link rather than naming the
       * component, so it needs the second signature. */
      if (cfg.comments) {
        for (const el of queryAll('[aria-label^="View comments"]')) drop(el);
      }
    } catch (e) { /* ignore */ }
  };

  /* MSN mutates continuously and a sweep walks every shadow root, so the
   * observer coalesces rather than sweeping per mutation batch. */
  let queued = false;
  const queueSweep = () => {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; sweep(); }, 200);
  };

  const start = () => {
    styleFeed();
    sweep();
    try {
      new MutationObserver(queueSweep).observe(document.documentElement, {
        childList: true, subtree: true
      });
    } catch (e) { /* no observer; the interval below still runs */ }
    setInterval(sweep, 2000);
  };

  /* portal-early.js hides all four groups from document_start, before first
   * paint, working from the same defaults. It cannot read storage from the
   * MAIN world, so it is told here which ones the user has switched off. */
  const publish = () => {
    try {
      document.dispatchEvent(new CustomEvent('ktp-portal-config', {
        detail: JSON.stringify(cfg)          /* a string, or it may not cross */
      }));
    } catch (e) { /* ignore */ }
  };

  try {
    chrome.storage.local.get(KEY, (got) => {
      cfg = Object.assign({}, DEFAULTS, (got && got[KEY]) || {});
      publish();
      log('settings loaded:', JSON.stringify(cfg));
      start();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[KEY]) return;
      cfg = Object.assign({}, DEFAULTS, changes[KEY].newValue || {});
      publish();
      styleFeed();
      sweep();
    });
  } catch (e) {
    /* No storage (should not happen): fall back to the documented defaults. */
    start();
  }
})();
