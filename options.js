/*
 * Keep The Page — options page.
 *
 * Settings live in chrome.storage.local under one key:
 *
 *     trace: { enabled: <bool>, channels: [<string>, ...] }
 *
 * bridge.js reads it and publishes the enabled channels to the MAIN world.
 * Saving is immediate — there is no Save button, and no state that only exists
 * in this page.
 */
(() => {
  'use strict';

  const KEY = 'trace';
  const DEFAULTS = { enabled: false, channels: ['walls', 'timers', 'consent'] };

  const enabled = document.getElementById('enabled');
  const group = document.getElementById('channels');
  const boxes = [].slice.call(document.querySelectorAll('.ch'));
  const saved = document.getElementById('saved');
  const about = document.getElementById('about');

  let savedTimer = null;
  const flashSaved = () => {
    saved.classList.add('on');
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => saved.classList.remove('on'), 900);
  };

  const paintDisabled = () => {
    const off = !enabled.checked;
    group.setAttribute('aria-disabled', String(off));
    boxes.forEach((b) => { b.disabled = off; });
  };

  const read = () => ({
    enabled: enabled.checked,
    channels: boxes.filter((b) => b.checked).map((b) => b.value)
  });

  const save = () => {
    paintDisabled();
    chrome.storage.local.set({ [KEY]: read() }, () => {
      if (chrome.runtime.lastError) {
        saved.textContent = 'Could not save: ' + chrome.runtime.lastError.message;
        saved.classList.add('on');
        return;
      }
      saved.textContent = 'Saved';
      flashSaved();
    });
  };

  chrome.storage.local.get(KEY, (got) => {
    const t = (got && got[KEY]) || DEFAULTS;
    enabled.checked = !!t.enabled;
    const on = Array.isArray(t.channels) ? t.channels : [];
    boxes.forEach((b) => { b.checked = on.indexOf(b.value) !== -1; });
    paintDisabled();
  });

  enabled.addEventListener('change', save);
  boxes.forEach((b) => b.addEventListener('change', save));

  /* ---------- protections ------------------------------------------------
   * Every defence is on unless stored false, so an install that has never
   * opened this page behaves exactly like one where everything is ticked. The
   * Newsquest pin is not here: it runs before any setting can be read. */

  const PROTECT = 'protect';
  const defs = [...document.querySelectorAll('.def')];

  chrome.storage.local.get(PROTECT, (got) => {
    const p = (got && got[PROTECT]) || {};
    defs.forEach((d) => { d.checked = p[d.value] !== false; });
  });

  defs.forEach((d) => d.addEventListener('change', () => {
    const p = {};
    defs.forEach((x) => { p[x.value] = x.checked; });
    chrome.storage.local.set({ [PROTECT]: p }, flashSaved);
  }));

  /* ---------- social furniture ------------------------------------------ */

  /* These defaults repeat social.js's, deliberately. The content script must
   * behave identically whether or not this page has ever been opened, so
   * neither side may be the sole owner of them; a unit test pins the two
   * copies together. */
  const SOCIAL = 'social';
  const SOCIAL_DEFAULTS = {
    enabled: true,
    mode: 'remove',
    platforms: { facebook: true, instagram: true, x: true, tiktok: true,
                 linkedin: true, snapchat: true },
    keepLogins: true,
    keepText: false
  };

  const social = document.getElementById('social');
  const socialOpts = document.getElementById('socialopts');
  const plats = [...document.querySelectorAll('.plat')];
  const modes = [...document.querySelectorAll('input[name="mode"]')];
  const keepLogins = document.getElementById('keepLogins');
  const keepText = document.getElementById('keepText');

  const paintSocial = () => {
    socialOpts.setAttribute('aria-disabled', String(!social.checked));
    [...plats, ...modes, keepLogins, keepText].forEach((el) => {
      el.disabled = !social.checked;
    });
  };

  const saveSocial = () => {
    const platforms = {};
    plats.forEach((p) => { platforms[p.value] = p.checked; });
    const mode = (modes.find((m) => m.checked) || {}).value || 'remove';
    chrome.storage.local.set({
      [SOCIAL]: {
        enabled: social.checked,
        mode,
        platforms,
        keepLogins: keepLogins.checked,
        keepText: keepText.checked
      }
    }, flashSaved);
    paintSocial();
  };

  chrome.storage.local.get(SOCIAL, (got) => {
    const v = Object.assign({}, SOCIAL_DEFAULTS, (got && got[SOCIAL]) || {});
    const on = Object.assign({}, SOCIAL_DEFAULTS.platforms, v.platforms || {});
    social.checked = v.enabled !== false;
    plats.forEach((p) => { p.checked = on[p.value] !== false; });
    modes.forEach((m) => { m.checked = m.value === (v.mode || 'remove'); });
    keepLogins.checked = v.keepLogins !== false;
    keepText.checked = v.keepText === true;
    paintSocial();
  });

  [social, keepLogins, keepText, ...plats, ...modes]
    .forEach((el) => el.addEventListener('change', saveSocial));

  /* ---------- msn.com and bing.com feeds ---------------------------------- */

  /* Mirrors DEFAULTS in portal.js; a test pins the two together. */
  const MSN = 'portal';
  const MSN_DEFAULTS = { comments: true, cards: true, tabs: true, feed: true };
  const portalComments = document.getElementById('portalComments');
  const portalCards = document.getElementById('portalCards');
  const portalTabs = document.getElementById('portalTabs');
  const portalFeed = document.getElementById('portalFeed');

  chrome.storage.local.get(MSN, (got) => {
    const v = Object.assign({}, MSN_DEFAULTS, (got && got[MSN]) || {});
    portalComments.checked = v.comments !== false;
    portalCards.checked = v.cards !== false;
    portalTabs.checked = v.tabs !== false;
    portalFeed.checked = v.feed !== false;
  });

  [portalComments, portalCards, portalTabs, portalFeed].forEach((el) => el.addEventListener('change', () => {
    chrome.storage.local.set({
      [MSN]: {
        comments: portalComments.checked,
        cards: portalCards.checked,
        tabs: portalTabs.checked,
        feed: portalFeed.checked
      }
    }, flashSaved);
  }));

  /* ---------- reported errors ------------------------------------------- */

  const ERRORS = 'errors';
  const list = document.getElementById('errlist');
  const none = document.getElementById('errnone');
  const count = document.getElementById('errcount');
  const clear = document.getElementById('clear');

  const when = (ms) => {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  };

  const renderErrors = (rows) => {
    const items = Array.isArray(rows) ? rows : [];
    count.textContent = items.length ? '(' + items.length + ')' : '';
    none.hidden = items.length > 0;
    clear.hidden = items.length === 0;
    list.textContent = '';
    for (const e of items) {
      const li = document.createElement('li');
      const head = document.createElement('span');
      head.className = 'where';
      head.textContent = e.where || 'unknown';
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = '  ' + (e.host || '') + ' · ' + when(e.at) +
                         (e.count > 1 ? ' · ' + e.count + '\u00d7' : '');
      const msg = document.createElement('span');
      msg.className = 'msg';
      msg.textContent = e.message || '';
      li.appendChild(head); li.appendChild(meta); li.appendChild(msg);
      list.appendChild(li);
    }
  };

  chrome.storage.local.get(ERRORS, (got) => renderErrors(got && got[ERRORS]));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[ERRORS]) renderErrors(changes[ERRORS].newValue);
  });

  clear.addEventListener('click', () => {
    chrome.storage.local.set({ [ERRORS]: [] }, () => renderErrors([]));
  });

  /* ---------- comments ---------------------------------------------------
   * ONE switch, at the user's direction: it drives comments.js (hiding, via
   * storage) and the Disqus block, the static DNR ruleset `widgets`, which is
   * on in the manifest. Chrome keeps updateEnabledRulesets across restarts but
   * resets it on an extension update, so the stored choice is re-applied
   * every time this page opens. Between an update and the next visit here
   * Disqus is blocked -- the failure falls towards blocking. */
  const WIDGETS = 'widgets';
  const RULESET = 'widgets';

  const applyWidgets = (on) => {
    try {
      chrome.declarativeNetRequest.updateEnabledRulesets(
        on ? { enableRulesetIds: [RULESET] } : { disableRulesetIds: [RULESET] }
      ).catch((e) => console.error('widgets ruleset', e));
    } catch (e) { console.error('widgets ruleset', e); }
  };

  const hideComments = document.getElementById('hideComments');

  const hideNewsletter = document.getElementById('hideNewsletter');

  chrome.storage.local.get(WIDGETS, (got) => {
    const w = (got && got[WIDGETS]) || {};
    const on = w.comments !== false;
    hideComments.checked = on;
    hideNewsletter.checked = w.newsletter !== false;
    applyWidgets(on);
  });

  /* Both keys written together: storing one alone would drop the other, and
   * the content scripts read a missing key as on. */
  const saveWidgets = () => chrome.storage.local.set({
    [WIDGETS]: { comments: hideComments.checked, newsletter: hideNewsletter.checked }
  }, flashSaved);

  hideComments.addEventListener('change', () => { applyWidgets(hideComments.checked); saveWidgets(); });
  hideNewsletter.addEventListener('change', saveWidgets);

  /* URL exceptions, one box per feature, each list under its own storage key
   * (comments, social furniture, newsletter sign-ups). One entry per line,
   * stored as typed (trimmed, blanks dropped); except.js in the content
   * scripts does the forgiving parse, so the matching rules live in one
   * place. */
  const bindExceptions = (id, key) => {
    const box = document.getElementById(id);
    if (!box) return;
    const list = () => box.value.split('\n').map((s) => s.trim()).filter(Boolean);
    chrome.storage.local.get(key, (got) => {
      const l = got && got[key];
      box.value = (Array.isArray(l) ? l : []).join('\n');
    });
    const save = () => chrome.storage.local.set({ [key]: list() }, flashSaved);
    let timer = 0;
    box.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(save, 500); });
    box.addEventListener('change', () => { clearTimeout(timer); save(); });
  };
  bindExceptions('commentsExcept', 'commentExceptions');
  bindExceptions('socialExcept', 'socialExceptions');
  bindExceptions('newsletterExcept', 'newsletterExceptions');

  /* Authorship and build identity, read from the manifest so this page and the
   * manifest can never disagree. */
  try {
    const m = chrome.runtime.getManifest();
    about.textContent = (m.author ? m.author + ' — ' : '') +
                        'version ' + (m.version_name || m.version);
  } catch (e) {
    about.textContent = '';
  }
})();
