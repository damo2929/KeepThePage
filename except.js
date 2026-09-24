/*
 * Keep The Page — the user's URL exceptions, shared by comments.js, social.js
 * and newsletter.js. Loaded first in each of their manifest entries; content
 * scripts of one extension share an isolated world per frame, so the others
 * read it as self.ktpUrlExcepted.
 *
 * Each feature keeps its own list under its own storage key, written from its
 * own box in Settings:
 *   commentExceptions     Settings -> Comments
 *   socialExceptions      Settings -> Social furniture
 *   newsletterExceptions  Settings -> Newsletter sign-ups
 *
 * An entry is a site or a URL prefix:
 *   example.com          example.com and every subdomain, any path
 *   example.com/forum    only paths under /forum on those hosts
 * Hosts match by whole label (never notexample.com), paths by segment
 * (/forum never matches /forumx). Scheme, port, query, "*." and "www." are
 * forgiven, since people paste URLs -- and so is Chrome's match-pattern
 * form, `*://*.atlassian.net/*`, which failed silently on first use.
 */
(() => {
  'use strict';

  const urlExcepted = (host, path, list) => {
    const h = String(host || '').toLowerCase().replace(/\.$/, '');
    const p = String(path || '/');
    if (!h || !Array.isArray(list)) return false;
    return list.some((raw) => {
      const s = String(raw || '').trim().replace(/^[(<"']+|[)>"',;]+$/g, '')
        .replace(/^([a-z][a-z0-9+.-]*|\*):\/\//i, '').replace(/[?#].*$/, '');
      const slash = s.indexOf('/');
      const eh = (slash === -1 ? s : s.slice(0, slash)).toLowerCase()
        .replace(/:\d+$/, '').replace(/^\*\./, '').replace(/^www\./, '').replace(/\.$/, '');
      const ep = slash === -1 ? '' : s.slice(slash).replace(/\*+$/, '').replace(/\/+$/, '');
      if (!eh || !(h === eh || h.endsWith('.' + eh))) return false;
      return !ep || p === ep || p.startsWith(ep + '/');
    });
  };

  self.ktpUrlExcepted = urlExcepted;
})();
