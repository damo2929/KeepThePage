/*
 * Keep The Page — social icon and link removal.
 * Content script, ISOLATED world, all sites except the platforms themselves.
 *
 * Two things happen to every link pointing at Facebook, Instagram, X/Twitter,
 * TikTok, LinkedIn or Snapchat:
 *
 *   1. its href is rewritten to http://localhost/removeme, so a click can never
 *      reach the platform and every target is visible in one selector — the
 *      original is parked in data-ktp-was, nothing is lost;
 *   2. everything carrying that marker is then disposed of: *furniture* — a
 *      bare icon, a "Share on X", a "Follow us", anything inside a
 *      share/social container — is removed outright, along with Facebook's
 *      like/share button iframes.
 *
 * A link inside a sentence is hidden like any other, so "follow us on
 * Facebook, X and Instagram" reads "follow us on , and ." That consequence was
 * put to the user and accepted. The "keep article text" setting turns it into
 * an unwrap instead — anchor gone, words kept — and is off by default.
 *
 * Three things this gets deliberately careful about, because a careless version
 * breaks real pages:
 *
 * 1. **Host matching, never substring matching.** `href*="x.com"` also matches
 *    netflix.com, linux.com, phoenix.com and any other host ending in "x.com".
 *    Links are parsed to a hostname and compared as whole labels.
 *
 * 2. **Sign-in links are kept.** "Continue with Facebook" points at
 *    facebook.com too, and removing it locks people out of sites. Anything
 *    that looks like an OAuth or login endpoint is left alone.
 *
 * 3. **The platforms' own sites are excluded in the manifest.** Without that,
 *    visiting facebook.com would strip facebook.com.
 *
 * Embedded posts — a quoted tweet or TikTok inside an article — are content,
 * not furniture, and are left in place; their links are rewritten like any
 * other. Only the share/follow widgets are removed.
 *
 * The exception is an embed the site holds back behind its own consent box
 * ("Allow X (formerly Twitter) content", "Allow external content") -- that
 * box is removed, and its accept button is never pressed. See
 * markConsentEmbeds().
 */
(() => {
  'use strict';

  const KEY = 'social';

  /* Grouped by platform because the settings page toggles platforms, not
   * hostnames. A platform owns several: t.co is X's shortener, fb.me is
   * Facebook's, and a link through either lands on the platform. */
  const GROUPS = {
    facebook: ['facebook.com', 'fb.com', 'fb.me', 'messenger.com'],
    instagram: ['instagram.com', 'instagr.am'],
    x: ['twitter.com', 'x.com', 't.co'],
    tiktok: ['tiktok.com'],
    linkedin: ['linkedin.com', 'lnkd.in'],
    snapchat: ['snapchat.com']
  };

  const hostsFor = (on) => Object.keys(GROUPS)
    .filter((k) => !on || on[k] !== false)
    .reduce((acc, k) => acc.concat(GROUPS[k]), []);

  /* Defaults live here, not in the options page: an install that has never
   * opened settings must behave exactly like one that has. */
  const DEFAULTS = {
    enabled: true,
    mode: 'remove',          /* 'remove' acts; 'mark' only defuses, so the
                              * targets stay visible and can be inspected */
    platforms: { facebook: true, instagram: true, x: true, tiktok: true,
                 linkedin: true, snapchat: true },
    keepLogins: true,        /* leave OAuth and login links working */
    keepText: false          /* off by the user's explicit decision: a link
                              * inside a sentence is hidden like any other, so
                              * "follow us on Facebook, X and Instagram" reads
                              * "follow us on , and ." Turning it on unwraps
                              * those links instead and keeps the words. */
  };

  let cfg = DEFAULTS;
  let hosts = hostsFor(DEFAULTS.platforms);

  /* The user's URL exceptions (Settings -> Social furniture), matched by
   * except.js, which the manifest loads first. `active()` is the one test of
   * whether this page is acted on; cfg.enabled alone ignores the list. */
  const urlExcepted = self.ktpUrlExcepted || (() => false);
  const EXCEPT = 'socialExceptions';
  let except = [];
  const active = () => cfg.enabled &&
    !urlExcepted(location.hostname, location.pathname, except);

  const applySettings = (s) => {
    cfg = Object.assign({}, DEFAULTS, s || {});
    cfg.platforms = Object.assign({}, DEFAULTS.platforms, (s && s.platforms) || {});
    hosts = hostsFor(cfg.platforms);
  };

  /* Pure string parsing, no URL(), so this is unit-testable off-browser. A
   * relative href returns '' and is never social. */
  const hostOf = (href) => {
    const m = /^(?:[a-z][a-z0-9+.\-]*:)?\/\/([^/?#]+)/i.exec(String(href || ''));
    if (!m) return '';
    return m[1].replace(/^[^@]*@/, '').replace(/:\d+$/, '').toLowerCase()
               .replace(/^www\./, '');
  };

  const isSocialHost = (host, list) =>
    !!host && list.some((s) => host === s || host.endsWith('.' + s));

  /* Login and OAuth endpoints, and Facebook's developer/business surfaces,
   * which people do legitimately need to reach. */
  const KEEP = /(oauth|\/login|signin|sign_in|\/dialog\/|\/v\d+\.\d+\/|developers\.|business\.|\/legal|\/policy|\/privacy|\/terms)/i;

  /* Where a neutralised link now points, and where the original is parked.
   * The path is a deliberate marker rather than a bare host: it makes every
   * targeted element visible in one selector -- a[href$="/removeme"] -- while
   * still going nowhere, so what the extension is about to act on can be seen
   * before it acts. */
  const DEAD = 'http://localhost/removeme';
  const WAS = 'data-ktp-was';

  /* Anything still carrying the marker is hidden on sight, which covers the
   * instant between marking and disposal and any link the page re-adds. */
  const BUTTON_MARK = 'share-button:';
  const CSS = 'a[href="' + DEAD + '"],[' + WAS + '^="' + BUTTON_MARK + '"],' +
              '[' + WAS + '^="consent-embed:"]{display:none!important}';

  /* Furniture, by its own text: an icon-only link has none at all. Anchored,
   * so a sentence merely containing the word "share" is not furniture. */
  const FURNITURE_TEXT = /^(share|tweet|post|like|pin it|follow|follow us|share this|share (on|to|via) [a-z\/ ]+|follow us on [a-z\/ ]+|follow [\w .&'-]{1,40} on [a-z]+|facebook|instagram|twitter|x|tiktok|snapchat|@[\w.]{1,30})$/i;

  /* Furniture, by the label the site gives a wordless icon. Looser than
   * FURNITURE_TEXT because it is never applied to visible text: notebookcheck
   * titles its icon "Click to share this post on Facebook", which no anchored
   * pattern will ever match. */
  const FURNITURE_LABEL = /(share|sharing|follow us|tweet|pin it|like us|partag|suivez-nous|suivre)/i;

  /* Furniture, by the container it sits in. Class and id strings are split into
   * words -- on punctuation and on camelCase -- and each word is matched as a
   * prefix. A boundary rule cannot work here: notebookcheck's wrapper is
   * `socialarea`, with no separator at all, and a `[^a-z]` boundary also misses
   * `socialLinks`. Prefix matching then needs the false friends spelled out,
   * because `socialist` and `shareholder` start the same way. */
  const FURNITURE_WORD = /^(share|shares|shared|sharing|social|socials|follow|followus|sociable|addtoany)/;
  const NOT_FURNITURE = /^(shareholder|shareprice|sharepoint|socialist|socialism|socialcare|following|followup|follower)/;

  const words = (s) => String(s || '').replace(/([a-z])([A-Z])/g, '$1 $2')
                         .toLowerCase().split(/[^a-z]+/).filter(Boolean);

  const isFurnitureCtx = (s) =>
    words(s).some((w) => FURNITURE_WORD.test(w) && !NOT_FURNITURE.test(w));

  /* An icon-only link is furniture whatever its title says -- reading the title
   * instead of the empty text is how notebookcheck's share icons survived. */
  const isFurnitureText = (text) => text === '' || FURNITURE_TEXT.test(text);

  const isSocialLink = (a) => {
    let href;
    try { href = a.getAttribute('href'); } catch (e) { return false; }
    if (!href) return false;
    if (!isSocialHost(hostOf(href), hosts)) return false;
    if (cfg.keepLogins !== false && KEEP.test(href)) return false;
    return true;
  };

  /* ---------- share BUTTONS -----------------------------------------------
   * Not every share control is a link. lesoleil.com's article bar is six
   * <button>s with no href at all -- the platform URL is built in a click
   * handler -- so nothing above ever sees them:
   *
   *     <button id="article-share-facebook" data-testid="article-share-facebook"
   *             aria-label="Partager l'article en cours via Facebook">
   *     ... -twitter, -linkedIn, -email, -link, -share
   *
   * The signature is two things at once: the button NAMES a platform (a whole
   * word in its id, test id, class, label, or its wrapper's class), and it is a
   * SHARE control (a share/social word in those names or its container, or a
   * share label -- "partager" included). Both are required: a platform name
   * alone is "Continue with Facebook", which must survive, and BUTTON_KEEP
   * exempts those labels outright. Email, copy-link and the native share sheet
   * name no platform and are left alone. */
  /* The five configurable platforms map to their settings key. The rest have
   * no switch of their own and map to 'other': they are only ever acted on as
   * signature furniture -- an icon in a social/follow container -- never by
   * host, so a YouTube link inside an article is not touched. */
  const BUTTON_PLATFORM = { facebook: 'facebook', messenger: 'facebook',
                            instagram: 'instagram', twitter: 'x', tiktok: 'tiktok',
                            linkedin: 'linkedin', snapchat: 'snapchat',
                            youtube: 'other', bluesky: 'other', bsky: 'other',
                            threads: 'other', whatsapp: 'other', pinterest: 'other',
                            reddit: 'other', flipboard: 'other', telegram: 'other',
                            mastodon: 'other' };
  const BUTTON_X = /\b(on|via|sur|to|en|à) x\b/i;
  const BUTTON_KEEP = /(log ?in|sign ?in|sign ?up|connexion|connecter|continue with|continuer avec|inscri)/i;

  /* Split without the camelCase step `words()` does: "linkedIn" must stay one
   * word here, where camelCase splitting would make it "linked in". */
  const buttonPlatform = (b) => {
    if (BUTTON_KEEP.test(b.label || '')) return '';
    const text = [b.id, b.testid, b.cls, b.label, b.parentCls].join(' ').toLowerCase();
    for (const w of text.split(/[^a-z]+/)) {
      if (Object.prototype.hasOwnProperty.call(BUTTON_PLATFORM, w)) return BUTTON_PLATFORM[w];
    }
    return BUTTON_X.test(b.label || '') ? 'x' : '';
  };

  /* Returns the platform group key when the button is share furniture, '' when
   * it is not. `b.ctx` is the container verdict from the DOM walk. */
  const shareButtonVerdict = (b) => {
    const p = buttonPlatform(b);
    if (!p) return '';
    const share = !!b.ctx || isFurnitureCtx(b.id) || isFurnitureCtx(b.testid) ||
                  isFurnitureCtx(b.cls) || isFurnitureCtx(b.parentCls) ||
                  FURNITURE_LABEL.test(b.label || '');
    return share ? p : '';
  };

  /* Sign-in buttons, acted on ONLY when "Keep sign-in links working" is off.
   * The KEEP exemption covers links; a login button has no href, so before
   * this the switch did nothing to them. Disqus's comment box is the case:
   *
   *     <ul class="services login-buttons">
   *       <li class="auth-facebook"><button class="connect__button"
   *           data-action="auth:facebook" title="Facebook">
   *
   * Platform as for share buttons, plus the data-action; the login signal is a
   * login word in the button's names, its data-action or its container. Only
   * the configured platforms: Google, Microsoft, Apple and Disqus sign-ins
   * name none, and stay. */
  const LOGIN_WORD = /^(auth|oauth|login|logins|signin|sso|connect)$/;
  const hasLoginWord = (s) => words(s).some((w) => LOGIN_WORD.test(w));

  const loginButtonVerdict = (b) => {
    /* The label goes in with the names, not as `label`: buttonPlatform()
     * returns '' for any login label (BUTTON_KEEP), and a sign-in button's
     * label is exactly that -- Disqus's is aria-label="Login with Facebook". */
    const p = buttonPlatform({ id: b.id, testid: b.testid, label: '', parentCls: b.parentCls,
                               cls: [b.cls, b.action, b.label].join(' ') });
    if (!p || p === 'other') return '';
    const login = !!b.ctx || hasLoginWord(b.id) || hasLoginWord(b.testid) ||
                  hasLoginWord(b.cls) || hasLoginWord(b.parentCls) ||
                  hasLoginWord(b.action) || BUTTON_KEEP.test(b.label || '');
    return login ? p : '';
  };

  /* ---------- shadow DOM --------------------------------------------------
   * msn.com renders almost everything inside web components: 1 anchor in the
   * light DOM, 73 across 161 open shadow roots. A document-level
   * querySelectorAll sees none of them, and a document-level stylesheet does
   * not cross the boundary either, so both passes have to walk the tree and
   * the hide rule has to be installed per root.
   *
   * Measured on the msn.com front page: 161 roots, 1640 elements, 0.4-2ms per
   * walk. Closed shadow roots are invisible to any script and are simply out
   * of reach. */
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

  /* Facebook's like/share button iframes. Embedded posts are not matched. */
  const WIDGET = 'iframe[src*="facebook.com/plugins/like"],' +
                 'iframe[src*="facebook.com/plugins/share"],' +
                 'iframe[src*="facebook.net/plugins"],' +
                 'iframe[src*="platform.linkedin.com"]';

  let removed = 0;
  let rewritten = 0;
  let unwrapped = 0;

  /* A bare icon, a share/follow label, or anything sitting inside a container
   * that names itself share/social/follow. Three levels is enough for
   * <div class="share"><ul><li><a>; more starts catching whole articles. */
  /* A link with sentence text beside it is inside prose. "Posted by @someone
   * earlier today." matched the handle pattern and was deleted, leaving
   * "Posted by  earlier today." -- observed on a real page, not hypothetical.
   * Container context still wins: a share row may caption itself "Follow us:"
   * and is furniture regardless. */
  const inProse = (a) => {
    const p = a.parentElement;
    if (!p) return false;
    for (const n of p.childNodes) {
      if (n !== a && (n.textContent || '').trim() !== '') return true;
    }
    return false;
  };

  /* The precedence, which is the part that keeps biting. Kept pure and
   * separate so a test can pin the order rather than the symptoms:
   *
   *   ctx    a share/social container wins outright
   *   icon   a link with no text contributes no words, so deleting it can
   *          never damage a sentence -- checked BEFORE prose, or the follow
   *          icons in a header sit next to text and survive (observed live)
   *   prose  sentence text beside the link: rewrite, never remove
   *   text   otherwise judge the link's own words, then its label
   */
  const furnitureVerdict = (v) => {
    if (v.ctx) return true;
    if (v.text === '') return true;
    if (v.prose) return false;
    return FURNITURE_TEXT.test(v.text) || (!!v.label && FURNITURE_LABEL.test(v.label));
  };

  const ctxFurniture = (a) => {
    try {
      if (isFurnitureCtx(a.className) || isFurnitureCtx(a.id)) return true;
    } catch (e) { /* ignore */ }
    let node = a.parentElement;
    for (let i = 0; i < 3 && node && node !== document.body; i++) {
      try {
        if (isFurnitureCtx(node.className) || isFurnitureCtx(node.id) ||
            isFurnitureCtx(node.getAttribute('aria-label') || '')) return true;
      } catch (e) { /* ignore */ }
      node = node.parentElement;
    }
    return false;
  };

  const isFurniture = (a) => {
    try {
      return furnitureVerdict({
        ctx: ctxFurniture(a),
        text: (a.textContent || '').trim(),
        label: a.getAttribute('aria-label') || a.getAttribute('title') || '',
        prose: inProse(a)
      });
    } catch (e) { return false; }
  };

  /* Point the link at localhost and park the original. Idempotent, but only
   * against itself: a framework that re-renders the anchor and puts the real
   * href back gets rewritten again, marker or no marker. */
  const neutralise = (a) => {
    try {
      if (a.getAttribute('href') === DEAD) return;
      if (!a.hasAttribute(WAS)) a.setAttribute(WAS, a.getAttribute('href') || '');
      a.setAttribute('href', DEAD);
      a.setAttribute('rel', 'noreferrer noopener');
      a.removeAttribute('target');
      rewritten++;
    } catch (e) { /* ignore */ }
  };

  /* A share row is usually <li><a>…</a></li>. Once the link goes the wrapper
   * is an empty bullet, so climb at most two levels while the wrapper holds
   * nothing but the link. The link's own text has to be discounted, or a
   * "Follow us on Instagram" item never climbs and leaves an empty bullet
   * behind. Bounded on purpose: an unbounded climb eventually eats the header. */
  const onlyContent = (parent, node) => {
    if (parent.children.length !== 1 || parent.firstElementChild !== node) return false;
    for (const n of parent.childNodes) {
      if (n !== node && (n.textContent || '').trim() !== '') return false;
    }
    return true;
  };

  const prune = (el) => {
    let node = el;
    for (let i = 0; i < 2; i++) {
      const parent = node.parentElement;
      if (!parent || parent === document.body) break;
      if (!onlyContent(parent, node)) break;
      node = parent;
    }
    try { node.remove(); removed++; } catch (e) { /* already gone */ }
  };

  /* A link inside a sentence cannot be hidden -- display:none takes the words
   * with it, and "follow BBC Manchester on Facebook, X and Instagram" becomes
   * "follow BBC Manchester on , and ." The anchor is replaced by its own text
   * instead: the link is gone, the sentence reads, and the marker attribute
   * moves to the span so what was there is still visible. */
  const unwrap = (a) => {
    try {
      const span = document.createElement('span');
      span.setAttribute(WAS, a.getAttribute(WAS) || '');
      while (a.firstChild) span.appendChild(a.firstChild);
      a.replaceWith(span);
      unwrapped++;
    } catch (e) { /* already gone */ }
  };

  /* Pass 1 by signature, for what the host check cannot see: share <button>s
   * with no href, and follow icons whose href is not the platform at all.
   * lapresse.ca's header and footer "Suivez-nous" rows point Facebook and
   * Instagram at its own explainer page (Meta blocks news in Canada), and
   * carry YouTube, Bluesky and Threads, which are not configured platforms:
   *
   *     <a class="mainNav__social_icon socials__icon socials-facebook"
   *        title="Suivre La Presse sur Facebook"
   *        href="https://www.lapresse.ca/renseignements/2023-08-02/...">
   *
   * A link is neutralised exactly like a platform link, so pass 2 handles it.
   * A button is marked and disabled -- the button equivalent of pointing a
   * link at localhost -- so Mark-only mode still leaves nothing live. */
  /* The row a follow icon sits in may name itself nothing useful:
   * journaldemontreal.com's footer is `li.footer-rs > a[title=Bluesky]` ("rs"
   * = réseaux sociaux). What it does have is neighbours -- Facebook,
   * Instagram, X and TikTok, already marked by host in this same sweep, before
   * pass 2 prunes them. An icon naming a platform beside marked links is in a
   * social row. Three levels, like ctxFurniture. */
  const besideMarked = (b) => {
    let n = b.parentElement;
    for (let i = 0; i < 3 && n && n !== document.body; i++, n = n.parentElement) {
      try {
        for (const m of n.querySelectorAll('[' + WAS + ']')) if (m !== b) return true;
      } catch (e) { return false; }
    }
    return false;
  };

  const loginCtx = (b) => {
    let n = b.parentElement;
    for (let i = 0; i < 3 && n && n !== document.body; i++, n = n.parentElement) {
      try { if (hasLoginWord(n.className) || hasLoginWord(n.id)) return true; } catch (e) { return false; }
    }
    return false;
  };

  const markButtons = () => {
    let buttons;
    try { buttons = queryAll('a[href],button,[role="button"]'); } catch (e) { return; }
    for (const b of buttons) {
      try {
        if (b.hasAttribute(WAS)) continue;
        const isLink = b.localName === 'a';
        if (isLink && cfg.keepLogins !== false && KEEP.test(b.getAttribute('href') || '')) continue;
        /* A link with its own words -- a headline about Facebook in a
         * "social" section -- is content, not an icon. Only wordless or
         * furniture-worded links are judged by signature. */
        if (isLink && !isFurnitureText((b.textContent || '').trim())) continue;
        const p = shareButtonVerdict({
          id: b.id, testid: b.getAttribute('data-testid') || '',
          cls: String(b.className || ''),
          label: b.getAttribute('aria-label') || b.getAttribute('title') || '',
          parentCls: b.parentElement ? String(b.parentElement.className || '') : '',
          ctx: ctxFurniture(b) || besideMarked(b)
        });
        let q = p;
        if (!q && !isLink && cfg.keepLogins === false) {
          q = loginButtonVerdict({
            id: b.id, testid: b.getAttribute('data-testid') || '',
            cls: String(b.className || ''), action: b.getAttribute('data-action') || '',
            label: b.getAttribute('aria-label') || b.getAttribute('title') || '',
            parentCls: b.parentElement ? String(b.parentElement.className || '') : '',
            ctx: loginCtx(b)
          });
        }
        if (!q || cfg.platforms[q] === false) continue;
        if (isLink) { neutralise(b); continue; }
        b.setAttribute(WAS, BUTTON_MARK + q);
        if ('disabled' in b) b.disabled = true;
        b.setAttribute('aria-disabled', 'true');
        rewritten++;
      } catch (e) { /* ignore */ }
    }
  };

  /* ---------- consent-gated embeds ----------------------------------------
   * standard.co.uk holds an embedded post back behind its own consent box,
   * server-rendered as a hydration island:
   *
   *     <div data-island-hydrate-component="SocialEmbedGate"
   *          data-island-hydrate-props='{"service":"X (formerly Twitter)",
   *              "embedProps":{"data":{"url":"https://twitter.com/..."}}}'>
   *   hydrates to
   *     <div><h4>Allow X (formerly Twitter) content</h4>
   *          <p>This content is provided by X (formerly Twitter) ...</p>
   *          <button data-social-consent-accept="true">Allow and Continue</button>
   *
   * Until "Allow" is pressed there is no twitter.com URL in the DOM -- no link,
   * no iframe, no blockquote -- so the host passes have nothing to see. The
   * same page's sidebar carries a second one, "Allow external content"
   * (service "external", an Html embed whose markup is null): a box that
   * exists only to ask.
   *
   * Two signatures, no hostnames:
   *   attr     the accept button's data attribute, which survives the
   *            per-build class hashes
   *   wording  anywhere else: a short box saying its content is provided by
   *            someone else, holding an allow/accept-to-load button
   *
   * A box naming a configured platform obeys that platform's switch; any other
   * gate is 'external' and always goes -- asked for by the user, and a gate
   * left standing is a consent question left open.
   *
   * The button is never pressed: that would load the embed and consent to it,
   * the one thing this project must never do. */
  const EMBED_ACCEPT = 'data-social-consent-accept';
  const EMBED_MARK = 'consent-embed:';
  const EMBED_PLATFORM = [
    ['x', /\bX \(formerly Twitter\)|\bTwitter\b/i],
    ['facebook', /\bFacebook\b/i],
    ['instagram', /\bInstagram\b/i],
    ['tiktok', /\bTikTok\b/i],
    ['linkedin', /\bLinkedIn\b/i],
    ['snapchat', /\bSnapchat\b/i]
  ];
  const EMBED_TEXT = /\b(content|this) (is )?provided by\b|\b(allow|accept|load|show) [\w ().-]{0,40}\bcontent\b/i;
  const EMBED_BUTTON = /^((allow|accept|agree)( and| &) (continue|load|view|show)|(load|show|view) (the )?content)$/i;
  const EMBED_MAX = 600;

  /* The platform named first wins: "Instagram, part of Meta and Facebook"
   * is an Instagram box. */
  const embedPlatform = (text) => {
    let best = '';
    let at = Infinity;
    for (const [p, re] of EMBED_PLATFORM) {
      const m = re.exec(String(text || ''));
      if (m && m.index < at) { at = m.index; best = p; }
    }
    return best;
  };

  /* Pure, so the decision is pinned by a test rather than by a page.
   * { attr, button, text } -> platform key, 'external', or '' for not a gate.
   * 600 characters is a placeholder; more is a CMP banner or the article. */
  const gateVerdict = (g) => {
    const text = String(g.text || '').trim();
    if (!text || text.length > EMBED_MAX) return '';
    const named = embedPlatform(text);
    if (g.attr) return (EMBED_TEXT.test(text) || named) ? (named || 'external') : '';
    if (!EMBED_BUTTON.test(String(g.button || '').trim())) return '';
    return EMBED_TEXT.test(text) ? (named || 'external') : '';
  };

  /* From the button up to the first ancestor that reads as a gate -- the box
   * -- then through wrappers holding nothing but the box, so no empty frame
   * is left behind. */
  const embedBox = (btn, attr) => {
    let n = btn.parentElement;
    for (let i = 0; i < 4 && n && n !== document.body; i++, n = n.parentElement) {
      const text = n.textContent || '';
      if (text.trim().length > EMBED_MAX) return null;
      const p = gateVerdict({ attr, button: btn.textContent, text });
      if (!p) continue;
      let box = n;
      const t = text.trim();
      for (let k = 0; k < 4; k++) {
        const up = box.parentElement;
        if (!up || up === document.body || (up.textContent || '').trim() !== t) break;
        box = up;
      }
      return { box, p };
    }
    return null;
  };

  const markConsentEmbeds = () => {
    let buttons;
    try { buttons = queryAll('button,[role="button"],[' + EMBED_ACCEPT + ']'); } catch (e) { return; }
    for (const b of buttons) {
      try {
        const attr = b.hasAttribute(EMBED_ACCEPT);
        if (!attr && !EMBED_BUTTON.test((b.textContent || '').trim())) continue;
        const hit = embedBox(b, attr);
        if (!hit || hit.box.hasAttribute(WAS)) continue;
        if (hit.p !== 'external' && cfg.platforms[hit.p] === false) continue;
        hit.box.setAttribute(WAS, EMBED_MARK + hit.p);
        if ('disabled' in b) b.disabled = true;
        b.setAttribute('aria-disabled', 'true');
        rewritten++;
      } catch (e) { /* ignore */ }
    }
  };

  /* Two passes on purpose, which is the point of the marker: the first says
   * what is targeted, the second acts on what is marked. */
  const sweep = () => {
    if (!active()) return;
    let links;
    try { links = queryAll('a[href]'); } catch (e) { return; }
    for (const a of links) {
      if (isSocialLink(a)) neutralise(a);
    }
    markButtons();
    markConsentEmbeds();
    /* Mark-only mode stops here: everything targeted is now pointing at the
     * marker and still on screen, which is the whole point of it. */
    if (cfg.mode === 'mark') return;
    try {
      for (const a of queryAll('a[href="' + DEAD + '"]')) {
        if (isFurniture(a)) prune(a);
        else if (cfg.keepText === true) unwrap(a);
        else styleRoot(a.getRootNode());   /* hidden by CSS, which needs to be
                                            * inside this root to reach it */
      }
      for (const b of queryAll('[' + WAS + '^="' + BUTTON_MARK + '"]')) prune(b);
      for (const e of queryAll('[' + WAS + '^="' + EMBED_MARK + '"]')) prune(e);
      for (const f of queryAll(WIDGET)) { f.remove(); removed++; }
    } catch (e) { /* ignore */ }
  };

  /* The page may never load our stylesheet if a wall strips style elements,
   * so this is a convenience, not the mechanism. */
  /* One stylesheet per root that needs it. A shadow root gets its own copy,
   * because a rule in the document does not apply inside one. */
  const styleRoot = (root) => {
    try {
      if (!root || cfg.mode === 'mark' || !active()) return;
      if (root.getElementById ? root.getElementById('ktp-social-css')
                              : root.querySelector('#ktp-social-css')) return;
      const s = document.createElement('style');
      s.id = 'ktp-social-css';
      s.textContent = CSS;
      const host = (root === document ? (document.head || document.documentElement) : root);
      host.appendChild(s);
    } catch (e) { /* ignore */ }
  };

  const addStyle = () => {
    try {
      const had = document.getElementById('ktp-social-css');
      if (cfg.mode === 'mark' || !active()) { if (had) had.remove(); return; }
      styleRoot(document);
    } catch (e) { /* ignore */ }
  };

  /* MSN mutates continuously, and a sweep now walks every shadow root, so the
   * observer coalesces instead of sweeping per mutation batch. */
  /* A path exception must follow SPA navigation: re-check the stylesheet when
   * the URL changes without a reload. */
  let href = location.href;
  let queued = false;
  const queueSweep = () => {
    if (location.href !== href) { href = location.href; addStyle(); }
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; sweep(); }, 200);
  };

  const start = () => {
    addStyle();
    sweep();
    try {
      new MutationObserver(queueSweep).observe(document.documentElement, {
        childList: true, subtree: true
      });
    } catch (e) { /* no observer; the interval below still runs */ }
    setInterval(sweep, 2000);
  };

  try {
    chrome.storage.local.get([KEY, EXCEPT], (got) => {
      applySettings(got && got[KEY]);
      except = (got && got[EXCEPT]) || [];
      if (cfg.enabled) start();
    });
    /* Settings changes apply to the next sweep. What has already been removed
     * stays removed until the page is reloaded -- the options page says so. */
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !(changes[KEY] || changes[EXCEPT])) return;
      if (changes[KEY]) applySettings(changes[KEY].newValue);
      if (changes[EXCEPT]) except = changes[EXCEPT].newValue || [];
      addStyle();
      if (active()) sweep();
    });
  } catch (e) {
    /* No storage (should not happen): fall back to the documented defaults. */
    start();
  }
})();
