/*
 * Keep The Page — DEBUG TRACER. Not part of the fix; remove when done.
 *
 * Runs at document_start in the MAIN world and records how the wall fires.
 *
 * The problem with tracing this SDK is that its failure path reloads the page,
 * which destroys console history and any in-page state. So every event is
 * appended to sessionStorage, which survives reloads within the tab. Read the
 * whole sequence afterwards with:
 *
 *     JSON.parse(sessionStorage.getItem('__ktp_trace'))
 *
 * confirm() is answered false only to keep the tab alive — a native modal
 * freezes the renderer and nothing can be read at all. Be aware that false is
 * Cancel, and Cancel is what triggers the SDK's reload.
 */
(() => {
  'use strict';

  const KEY = '__ktp_trace';
  const MAX = 400;
  const t0 = performance.now();

  /* A per-load id, so reloads are distinguishable in one trace. */
  const loadId = Math.random().toString(36).slice(2, 7);
  const navType = (performance.getEntriesByType('navigation')[0] || {}).type || '?';

  const read = () => {
    try { return JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch (e) { return []; }
  };

  const write = (rows) => {
    try { sessionStorage.setItem(KEY, JSON.stringify(rows.slice(-MAX))); } catch (e) { /* full */ }
  };

  const where = (skip) => {
    try {
      return (new Error()).stack.split('\n').slice(skip, skip + 2)
        .map(s => s.trim().replace(/^at\s+/, '').replace(/https?:\/\//, '').split('?')[0].slice(0, 70))
        .join(' <- ');
    } catch (e) { return '?'; }
  };

  const rec = (event, detail, stack) => {
    const rows = read();
    rows.push({
      load: loadId,
      nav: navType,
      ms: Math.round(performance.now() - t0),
      event: event,
      detail: String(detail === undefined ? '' : detail).slice(0, 120),
      from: stack || ''
    });
    write(rows);
    console.debug('[ktp-trace]', loadId, Math.round(performance.now() - t0) + 'ms', event, detail || '');
  };

  rec('page-start', 'navType=' + navType + ' url=' + location.pathname);

  /* ---- dialogs ---- */
  ['confirm', 'alert', 'prompt'].forEach((name) => {
    const native = window[name];
    const answer = name === 'confirm' ? false : (name === 'prompt' ? null : undefined);
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        get() {
          return function (msg) {
            rec(name + '()', msg, where(2));
            return answer;
          };
        },
        set() {}
      });
    } catch (e) { rec('shim-failed', name, ''); }
  });

  /* ---- DOM clearing (observe only, never block) ---- */
  const isRoot = (n) => n === document.body || n === document.documentElement;

  const elRemove = Element.prototype.remove;
  Element.prototype.remove = function () {
    if (isRoot(this)) rec('body.remove()', this.localName, where(2));
    return elRemove.apply(this, arguments);
  };

  const removeChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function (child) {
    if (isRoot(child)) rec('removeChild(body)', '', where(2));
    return removeChild.apply(this, arguments);
  };

  const watchSetter = (proto, prop) => {
    const d = Object.getOwnPropertyDescriptor(proto, prop);
    if (!d || !d.set) return;
    Object.defineProperty(proto, prop, {
      configurable: true,
      enumerable: d.enumerable,
      get() { return d.get ? d.get.call(this) : undefined; },
      set(v) {
        const empty = String(v === null || v === undefined ? '' : v).trim() === '';
        if (empty && isRoot(this)) rec(prop + '=""', this.localName, where(2));
        return d.set.call(this, v);
      }
    });
  };
  watchSetter(Element.prototype, 'innerHTML');
  watchSetter(Node.prototype, 'textContent');

  /* ---- navigation attempts we can see ---- */
  const nativeOpen = window.open;
  window.open = function (url) { rec('window.open()', url, where(2)); return nativeOpen.apply(window, arguments); };
  window.addEventListener('beforeunload', () => rec('unload', 'leaving/reloading'));

  /* ---- what the page looks like over time ---- */
  const snap = (label) => {
    const b = document.body;
    rec('state:' + label, b ? ('kids=' + b.children.length + ' text=' + b.innerText.length) : 'no body');
  };
  document.addEventListener('DOMContentLoaded', () => snap('domcontentloaded'));
  window.addEventListener('load', () => snap('load'));
  [1000, 3000, 5000, 8000, 12000].forEach(ms => setTimeout(() => snap(ms + 'ms'), ms));
})();
