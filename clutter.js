/*
 * Keep The Page — third-party widget remover.
 * Content script, document_start, isolated world.
 *
 * Removes in-page engagement/ad furniture that is not part of the article.
 * Unlike popout.js these are not floating, so there is no position:fixed gate —
 * removal is driven purely by the explicit selector list below.
 *
 * Euronews ships one Vuukle block 1699px tall:
 *
 *     div.tp-vuukle
 *       div#vuukle-comments-<id>.js-vuukle-container
 *         div#vuukle-quiz-container-<id>        the "Quizzly" quiz
 *           div#vuukle-quiz-<id> > iframe#quiz-iframe-<id>   (cdn.vuukle.com)
 *         div.vuukle-ads  x2                    360px of ads inside the widget
 *
 * Script and quiz iframe both come from cdn.vuukle.com. Blocking that domain
 * is left to Pi-hole; this removes the block from the DOM either way, which
 * also clears the skeleton container that a blocked script leaves behind.
 *
 * To keep comments and drop only the quiz and the in-widget ads, replace
 * '.tp-vuukle' below with '[id^="vuukle-quiz-container"]'.
 */
(() => {
  'use strict';

  const TAG = '[keep-the-page/clutter]';

  const SELECTORS = [
    '.tp-vuukle',                      // whole Vuukle block: comments + quiz + ads
    '.js-vuukle-container',
    '.vuukle-ads',
    '[id^="vuukle-quiz-container"]'
  ];

  const sweep = () => {
    for (const sel of SELECTORS) {
      let nodes;
      try { nodes = document.querySelectorAll(sel); } catch (e) { continue; }
      for (const el of nodes) {
        if (!el.isConnected) continue;
        console.debug(TAG, 'removed', sel, el.id || String(el.className).slice(0, 40));
        el.remove();
      }
    }
  };

  const observer = new MutationObserver(sweep);

  const start = () => {
    sweep();
    observer.observe(document.documentElement, { childList: true, subtree: true });
  };

  if (document.documentElement) start();
  else document.addEventListener('readystatechange', start, { once: true });

  document.addEventListener('DOMContentLoaded', sweep);
  window.addEventListener('load', sweep);
})();
