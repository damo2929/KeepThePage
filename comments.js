/*
 * Keep The Page — comment section removal.
 * Content script, ISOLATED world, document_start, all sites, top frame.
 *
 * Asked for by the user ("kill comments"), by signature, never by hostname.
 *
 * The signature is the element's own naming. id and class strings are split
 * into words -- on punctuation and on camelCase, as social.js does for share
 * rows -- and matched word by word:
 *
 *   comments | disqus               on its own     comments-section, post-comments,
 *                                                  commentsContainer, disqus_thread
 *   comment  + a structural word    section, area, list, thread, form, count, ...
 *                                                  comment-count, commentList
 *
 * Seen on real pages: ign.com (section#comments.comments-section,
 * .comment-count on every related card, a "271 comments" link to #comments),
 * petapixel.com (div#comments.post-comments, the Disqus mount).
 *
 * The guards matter more than the words. WordPress puts `comments-open` on
 * <body>, so a word match alone would hide every WordPress site. Never
 * html/body/main/article, and never anything that contains the page's <h1>,
 * <main> or <article> -- a comment section sits beside the article, not
 * around it.
 *
 * IGN's comments are first-party (mollusk.apis.ign.com/graphql, the same
 * endpoint as the rest of the site), so unlike Disqus they cannot be blocked
 * at the network. This hides; the comment data is still fetched.
 */
(() => {
  'use strict';

  const KEY = 'widgets';
  const EARLY = 'ktp-comments-css';
  const MARK = 'data-ktp-comments';

  /* Installed at document_start, before any sweep can run, so the commonest
   * mounts never paint. The sweep below finds the rest. */
  const SELECTORS = [
    '#comments',
    '.comments-section',
    '#disqus_thread',
    '.comment-count',
    'a[href$="#comments"]'
  ];
  const CSS = SELECTORS.join(',') + ',[' + MARK + ']{display:none!important}';

  const COMMENT_WORD = /^(comments|disqus)$/;
  const COMMENT_PART = /^(section|sections|area|list|thread|threads|form|container|wrapper|widget|block|box|count|counter|link|links|respond|reply|replies|feed|stream|module)$/;
  const NEVER_TAG = /^(HTML|BODY|HEAD|MAIN|ARTICLE|H1|SCRIPT|STYLE|TEMPLATE)$/;

  const words = (s) => String(s || '').replace(/([a-z])([A-Z])/g, '$1 $2')
                         .toLowerCase().split(/[^a-z]+/).filter(Boolean);

  /* Pure, so a test pins the rules rather than a page.
   * { tag, id, cls, wraps } -> true when this is comment furniture.
   * `wraps` is true when the element contains the page's h1/main/article. */
  /* Each class name is judged on its own. Jira renders every comment and the
   * description as `ak-renderer-wrapper is-comment`: pooled, "wrapper" from
   * one class and "comment" from the other made a match, and every ticket
   * lost its text. The pair must come from one name (comment-count,
   * commentList), never from two names that happen to sit together. */
  const commentVerdict = (e) => {
    if (NEVER_TAG.test(String(e.tag || '').toUpperCase()) || e.wraps) return false;
    const names = [String(e.id || '')].concat(String(e.cls || '').split(/\s+/));
    return names.some((n) => {
      const w = words(n);
      if (w.some((x) => COMMENT_WORD.test(x))) return true;
      return w.indexOf('comment') !== -1 && w.some((x) => COMMENT_PART.test(x));
    });
  };

  let on = true;

  /* The page's own content, not every <article>: the HTML spec recommends
   * <article> for each comment, and techpowerup.com does exactly that --
   * section.comments > article.forumpost x25 -- so "contains an article" kept
   * its comment section on screen. What must never be hidden is the h1, a
   * <main>, or the article that holds the h1. */
  const wrapsContent = (el) => {
    try {
      const h1 = document.querySelector('h1');
      if (h1 && el.contains(h1)) return true;
      if (el.querySelector('main')) return true;
      const own = h1 && h1.closest('article');
      return !!(own && el.contains(own));
    } catch (e) { return true; }
  };

  /* A wrapper left holding nothing but a hidden comment section keeps its own
   * height: ign.com's div.bottom-content stayed 636px tall and empty above the
   * footer. So the frame goes too -- at most two levels, only while every
   * child is already hidden and it has no text of its own, and never past the
   * same guards as the section itself. */
  const hidden = (n) => {
    if (n.hasAttribute && n.hasAttribute(MARK)) return true;
    try { return getComputedStyle(n).display === 'none'; } catch (e) { return false; }
  };

  const collapse = (el) => {
    let n = el;
    for (let i = 0; i < 2; i++) {
      const p = n.parentElement;
      if (!p || p === document.body || NEVER_TAG.test(p.tagName) || wrapsContent(p)) return;
      for (const c of p.childNodes) {
        if (c.nodeType === 3 && c.textContent.trim() !== '') return;
        if (c.nodeType === 1 && !hidden(c)) return;
      }
      p.setAttribute(MARK, '');
      n = p;
    }
  };

  const sweep = () => {
    if (!on || !document.body) return;
    let nodes;
    try { nodes = document.body.querySelectorAll('[id*="omment" i],[class*="omment" i],[id*="disqus" i],[class*="disqus" i]'); }
    catch (e) { return; }
    for (const el of nodes) {
      if (el.hasAttribute(MARK)) continue;
      let cls = el.className;
      if (cls && typeof cls !== 'string') cls = cls.baseVal || '';
      if (!commentVerdict({ tag: el.tagName, id: el.id, cls, wraps: false })) continue;
      if (wrapsContent(el)) continue;
      el.setAttribute(MARK, '');
    }
    /* After marking, so a sibling marked later in the same pass counts. The
     * early stylesheet's targets are included -- #comments is hidden before it
     * is ever marked. */
    try {
      for (const el of document.querySelectorAll('[' + MARK + '],' + SELECTORS.join(','))) {
        if (el.tagName !== 'A' && !el.closest('[' + MARK + '] [' + MARK + ']')) collapse(el);
      }
    } catch (e) { /* ignore */ }
  };

  const install = () => {
    try {
      if (document.getElementById(EARLY)) return;
      const s = document.createElement('style');
      s.id = EARLY;
      s.textContent = CSS;
      (document.head || document.documentElement).appendChild(s);
    } catch (e) { /* ignore */ }
  };

  const uninstall = () => {
    try { const s = document.getElementById(EARLY); if (s) s.remove(); } catch (e) { /* ignore */ }
    try { for (const el of document.querySelectorAll('[' + MARK + ']')) el.removeAttribute(MARK); } catch (e) { /* ignore */ }
  };

  /* The user's URL exceptions (Settings -> Comments), matched by except.js,
   * which the manifest loads first. Missing matcher = no exceptions. */
  const urlExcepted = self.ktpUrlExcepted || (() => false);

  const EXCEPT = 'commentExceptions';
  let widgets = {};
  let except = [];

  const apply = () => {
    on = widgets.comments !== false &&
         !urlExcepted(location.hostname, location.pathname, except);
    if (on) { install(); sweep(); } else uninstall();
  };

  /* A path exception must follow SPA navigation, which changes the URL with no
   * reload -- including off an excepted path, when `on` is still false. */
  let href = location.href;
  let queued = false;
  const queue = () => {
    if (location.href !== href) { href = location.href; apply(); }
    if (queued || !on) return;
    queued = true;
    setTimeout(() => { queued = false; sweep(); }, 250);
  };

  /* On by default, and installed before storage answers: an install that
   * never opened settings must behave like one where the box is ticked, and
   * waiting for storage would let the section paint first. */
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
    new MutationObserver(queue).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) { /* no observer */ }
  document.addEventListener('DOMContentLoaded', sweep);
})();
