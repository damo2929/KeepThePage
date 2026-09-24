# AGENTS.md

Working notes for agents on this project. Read this before changing anything —
most of it was learned the hard way, by shipping a fix that made things worse.

## What this project is

A Chrome MV3 extension ("Keep The Page") that stops publisher anti-adblock
walls from hiding article pages, and removes pop-out video ads and
third-party widget clutter.

    walls.js     signature-armed defences, ALL sites (MAIN, document_start)
    guard.js     what cannot be signature-armed      (MAIN, document_start)
    bridge.js    settings -> MAIN world bridge       (ISOLATED, document_start)
    options.html/.js   settings UI (tracing toggles)
    popout.js    floating PiP video removal   (isolated world)
    clutter.js   third-party widget removal   (isolated world)
    rules.json   one declarativeNetRequest rule
    widgets-rules.json   Disqus block (own ruleset, switchable)
    comments.js  comment-section hiding by signature (all sites)
    newsletter.js   newsletter popups and sign-up boxes, by signature
    bump.sh      version stamper - run after any change on disk
    test.sh / tests/run.js   unit tests (gjs; there is no node here)
    newsquest-domains.txt   269 domains, generated from TLS cert SANs

## Hard-won rules

**1. Find the gate. Do not fight the wall.**

The Newsquest fix works because the entire wall sits behind one flag in the
page: `var adLight = false` at line 1647, gating `if (adLight !== true)` at
line 2020. Pinning `window.adLight = true` at `document_start` means the wall
never builds. Nothing to block, nothing to dismiss, no anti-tamper tripped.

Every attempt to fight a wall that is already running has made things worse.
See the failure log below.

**2. These SDKs verify their own writes, and treat interference as detection.**

Sourcepoint's loader does:

    z.call(O,'src',G), O[x]('src')!==G && throw E
    ... catch(W){ try{ await l(W) } catch(x){ o(W) } }   // o() raises the dialog

Guarding `setAttribute` makes that check fail, and the failure path *is* the
dialog. An early revision of this extension guarded `setAttribute` and was
the direct cause of the popup it was meant to remove.

**3. Blocking the vendor's domain is a detection signal, not a fix.**

The SDK's decoded error strings are literally `Vital API blocked` and
`Vital API blocked (eval)`. When Pi-hole NXDOMAINs `html-load.com`, the SDK
concludes "ad blocker" and walls the page. Network blocking and the page-level
fix solve different halves; do not assume blocking helps.

**4. `Location` is [Unforgeable]. You cannot intercept navigation.**

`location.href`, `location.assign`, `location.replace` and `location.reload`
are non-configurable and non-writable. Verified in-page:

    Object.getOwnPropertyDescriptor(location,'reload')
    -> { writable: false, configurable: false }
    Object.defineProperty(location,'reload',...)
    -> TypeError: Cannot redefine property: reload

So any SDK whose failure path is "navigate away" or "reload" cannot be stopped
from the DOM. Only preventing it from reaching that line works.

**5. Measure at the right moment, and watch continuously.**

The notebookcheck wall blanks at ~5-8s. Sampling at 1s and 4s showed a healthy
page; sampling at 16s showed a recovered page. Both readings said "fixed" while
the user was staring at an 8-second blank. Symptom timing is not incidental —
find it before claiming anything works.

Better: use `read_console_messages` on the tab. The guards log every action, so
the console shows the wall's escalation sequence directly.

**6. A screenshot and a DOM probe can disagree.**

`bodyChildren: 6, textLen: 20448` with a blank grey screenshot happened more
than once, sometimes a genuine visual hide, sometimes a capture artifact. Check
both, and check `elementFromPoint` before concluding the page is hidden.

**7. Every page is checked for a consent banner, and the answer is always no.**

This is a standing instruction from the user, not a per-site decision. On
every page the extension runs on, look for a consent/cookie banner and answer
it with **no consent**: press the vendor's own refusal, or, where there is no
refusal button, open its preference centre, switch every purpose, vendor and
legitimate-interest switch off, and save. If that cannot be done safely, remove
the banner. Never leave consent as the default, and never press accept.

Coverage grows **by signature, never by site list**: a new CMP is added as its
vendor class names / container ids (`CMP_SELECTOR`, `PREFS_REJECT`) and its
cookie names (`CONSENT_NAME`), so every site using that vendor is covered with
no hostname anywhere. When a site shows a banner we miss, identify the vendor
and add the vendor.

## Failure log — approaches that did not work

| Approach | Outcome |
|---|---|
| DNR block of the loader host | Host is a randomised first-party CNAME, differs per title. Block by *path* instead. |
| `setAttribute` guard on injected scripts | Tripped the SDK's anti-tamper self-check, which *raised* the dialog. |
| `confirm`/`alert` shim answering Cancel | In this SDK, Cancel means `S.reload()`. Caused an infinite reload loop. |
| Snapshot body children at `DOMContentLoaded` | Wall blanks during parsing, so the snapshot captured an already-empty body. |
| Guard `remove()`/`removeChild()` only | Wall clears in one assignment (`innerHTML = ''`), not node by node. |
| Guard everything, on notebookcheck | Wall escalated to dialog, then reload loop. Strictly worse than leaving it alone. |
| DNR redirect of `html-load.com` to a local stub | Never applied; requests still failed. Also, adding a `redirect` action with only the `declarativeNetRequest` permission **invalidated the whole ruleset**, silently killing rule 1 on all 269 Newsquest sites. `redirect` needs `declarativeNetRequestWithHostAccess`. |

## Current site status

| Site | Mechanism | Status |
|---|---|---|
| Newsquest (269 titles) | Inline wall gated on `adLight` | **Fixed** — pin the flag, wall never builds |
| euronews.com | Dailymotion PiP + Vuukle block | **Fixed** — removed |
| notebookcheck.net | Same SDK (`l/1.2.10`), **no gate** | **Fixed** — redirect + decoy + eval-timer filter |
| pagesix.com | `<dialog>` forced visible by CSS | **Fixed** — text-signature overlay sweep |
| Reach plc (8 titles verified) | Consent-or-pay CMP | **Fixed** — CMP sweep + consent record refused |
| scotsman, yorkshirepost | AdShield `l/1.1.21` | **Fixed** — covered by signature, no list entry |
| listentotaxman.com | AdShield `l/1.1.10` recovery script -> native `confirm()` | **Fixed** — `loader-check` gate pinned by signature |
| lesoleil.com, lenouvelliste.ca | CookieYes, no reject button | Refused via preference centre, by class signature — see CookieYes section |
| theverge.com | PMC "duet" privacy notice, no refusal in page | **Removed** by class (`.duet--navigation--pmc-privacy-banner`), never closed. The Zephr subscription gate (`isAccessibleForFree: false`) is **deliberately not touched** — a paywall, like thetimes.com |

Full evidence for all of these is in `sweep-results.md` (52 articles, 26
domains). Update it when the site list changes; it is the record of what was
actually observed rather than assumed.

## Consent-or-pay walls

A different animal from anti-adblock, added at the user's explicit direction
after the trade-off was put to them: these offer "accept tracking" or "pay
£2.99/mo" with no free reject, so removing the overlay means reading content the
publisher gates behind the pay branch. The user chose removal.

**The vendor's container id is the signature.** No site list, and no text match
— the copy is "Take control of your privacy", nothing about ads, so `WALL_TEXT`
never fires on it. Confirmed live on walesonline:

    cmp.inmobi.com/choice/JYWDqeLS64fbt/walesonline.co.uk/choice.js
     425ms   #qc-cmp2-container present
    1129ms   gone (swept on the 1s tick)

**It sat at body depth 3** — `body > #qc-cmp2-container > #qc-cmp2-main >
div.qc-cmp-cleanslate(position:fixed)`. The old `body > *, body > * > *` scan
could not reach it, and the two outer wrappers are `position: static`, so a
"fixed overlay" test applied to body children alone sees nothing. The sweep now
goes one level deeper and `cmpShowing()` walks the subtree for the fixed box.

**Removal alone is not enough — the record must not be stored.** Otherwise a
consent state that was never given is persisted and replayed to the vendor list
on every later page. `document.cookie` and `Storage.setItem` drop the known
names. Intended consequence: the wall rebuilds every load and is swept every
load.

**Silence is not refusal.** Removing the overlay and refusing the cookie leaves
the page's question unanswered. `denyConsent()` therefore answers `__tcfapi`
with everything denied, `eventStatus: 'tcloaded'` and an empty `tcString`. Two
reasons, both real: publishers exist that block rendering until the API replies,
and an unanswered CMP is free to treat the question as never asked.

It installs only where `window.__tcfapi` is already a function or a CMP
container exists, so a site with no consent framework never sees the global
appear. It is installed from `tick()`, not at document_start, because the CMP
defines its API later than we run.

**Never blocklist a bare `sp_` cookie prefix.** Sourcepoint uses `_sp_`, but
bare `sp_` is Spotify's `sp_dc`/`sp_t` session pair — blocking it breaks login.
Every name in `CONSENT_NAME` is anchored `^...$` for this reason.

**Microsoft has its own CMP, and msn.com uses it.** `div#cmp-banner-sdk`
(`position: fixed`, 189px) inside `#mscmp-banner-container` — it matches none of
the vendor ids above. Found by walking the element stack at the bottom of the
viewport with `elementFromPoint`, which is the quickest way to identify a banner
whose ids are unfamiliar.

Only remove a CMP container that is **actually on screen**. Several of these ids
(`#onetrust-consent-sdk`) are permanent wrappers the page keeps regardless, and
tearing out a dormant one breaks the page for no gain.

### How notebookcheck was solved

No `adLight`-style gate exists there, so the wall always runs. The fix is a
single mechanism: **drop timers scheduled from eval'd code**.

The wall is timer-driven, and one timer does the damage:

    dropped setTimeout(7005ms) scheduled from eval    <- the body.remove()
    dropped setTimeout(1251ms) / 105ms / 0ms x8
    dropped setInterval(15000ms)

Kill that and everything downstream disappears — no blanking, so no exception,
so no dialog, so no reload.

    before: 4 page loads, 3 confirms, reload loop
    after:  1 page load,  0 confirms, alive 40378ms, content intact

**Two earlier mechanisms were removed after testing this one alone.** A DNR
redirect of the loader to a local stub, and a decoy that diverted the wall's
DOM writes to a detached element. Both worked, both were treating downstream
symptoms of that single timer. Dropping them also dropped
`declarativeNetRequestWithHostAccess` back to `declarativeNetRequest` and
removed all host permissions. Always test whether the last change alone is
sufficient before keeping the scaffolding around it.

**Gating is by signature, not hostname.** Dropping timers is blunt, so it arms
only when the page carries this SDK:

    Newsquest      <script id="jzHHpiNZCtsy" data-sdk="wp-l/1.1.11"
                           data-cfasync="false" nowprocket src="html-load.com/...">
    notebookcheck  <script id="iGFngld"      data-sdk="l/1.2.10"
                           data-cfasync="false" nowprocket src="html-load.com/...">

    scotsman /    <script data-sdk="l/1.1.21" ...>   (National World)
    yorkshirepost

The element id is randomised per site; `data-sdk` and the loader host are not.
The *version* does move — three have been seen — so match the `l/<n>.<n>` shape,
never a literal version string.

**To test whether the defences armed on a site, probe it, do not read the
regex.** Appending a div to `<body>` and calling `remove()` on it is refused
once armed and succeeds when not:

    scotsman.com (l/1.1.21) -> blockedRemove: true
    bbc.co.uk    (no sdk)   -> blockedRemove: false


Three conditions must hold to drop a timer: scheduled from `eval`, the SDK
signature is present, and the handler is a function.

The signature latches true but **never caches a negative** — the loader tag may
not be parsed when the first timers are scheduled, so a cached "absent" would
permanently disarm the filter on a page that does have the wall.

This generalises: any site carrying this SDK is covered with no per-site entry.
Verified not to arm on Newsquest, where the loader is created inside the
`adLight` block that never runs.

## The recovery gate (`loader-check`)

A **blocked** loader is not the end of it. The served HTML carries the SDK's
own recovery script -- inline `<script nowprocket>` after the loader tag on
listentotaxman.com (`l/1.1.10`), the loader tag's `onerror` on scotsman /
yorkshirepost (`l/1.1.21`). With html-load.com NXDOMAIN at the Pi-hole it
walks the fallback hosts, then:

    confirm('There was a problem loading the page. Please click OK to learn more.')
        OK -> report.error-report.com/modal      Cancel -> location.reload()

The native modal froze the tab outright (screenshot and `Runtime.evaluate`
both timed out). The shim cannot help -- the text is not ad copy, and both
answers leave the page -- and the eval-timer filter never sees an inline script.

The gate, same shape on both versions:

    b = () => !!(window['as_' + javaHash('loader-check_' + utcMidnight)] || ...-1 day || ...+1 day)
    if (b()) return;          // before any fallback, iframe or confirm

It is the flag a loader that ran sets for itself. walls.js pins all three keys
when a MutationObserver sees a `<script>` matching `SDK_ATTR`/`SDK_HOST` being
parsed -- the parser's microtask checkpoint before a parser-inserted script runs
delivers the record before the loader is fetched. By signature, no hostname.
The test runs the SDK's `b()` verbatim against the sandbox window.

## The CSS stripper (National World titles)

Worse than rule 3, and a distinct mechanism. The served HTML carries the site's
real CSS in two `<style>` blocks (~68KB), and also carries this inline:

    setInterval(() => i.querySelectorAll('link,style')
                       .forEach(e => e.remove()), 100);
    const n = await fetch(<html-load.com>)       // the restore half

Strip every 100ms, restore from the loader host. `html-load.com` is NXDOMAIN at
the user's Pi-hole, so the restore never lands and the page stays unstyled
forever. Nothing to do with the consent or anti-adblock walls.

Three things this teaches:

1. **A blocked vendor host can break the publisher's own CSS**, not just the
   ads. The page degrades with no anti-adblock logic running at all.
2. **The eval-timer filter does not cover it.** This is a plain inline script,
   so `fromEval()` is false. The *handler's source* is the signature instead.
3. **Do not gate this one on `wallPresent()`.** The interval can be scheduled
   before the loader tag is parsed, when the signature probe still returns
   false. An interval that removes every `<link>` and `<style>` is unambiguous
   on its own.

Fixed by dropping the timer at schedule time, so nothing is ever stripped and
no restore is needed. Verified on yorkshirepost: `styleSheets` 0 -> 2,
532 rules, page renders.

Diagnosing this needs a stack trace, not a guess. Patch `Element.prototype.remove`
to log `new Error().stack` when the removed node is a STYLE or LINK; it named the
inline script and the `NodeList.forEach` immediately.

## Site coverage is evidence-based, never assumed

`nypost.com` and `decider.com` were added on the assumption that News Corp
siblings share pagesix.com's "Ads help keep ..." wall. They do not:

    nypost article  ->  1 <dialog>, an image gallery, display:none, z=-1
                        "ads help keep" absent from the page HTML entirely
    decider.com     ->  0 dialogs, no wall

Both were removed again. Scope costs something — `guard.js` patches global
prototypes in the MAIN world — so a domain goes in `matches` only after the
wall is observed on it, never because a related site has one.

## Things that look like findings but are not

**`thesun.co.uk` failing to load is intentional.** It is blocked at the user's
Pi-hole by choice, as a racist outlet. Chrome shows `chromewebdata` and ~109
characters. This is not a wall, not a bug, and not to be "fixed" or reported as
a problem.

**A `503` in `read_network_requests` means the request failed, not that a server
answered.** Pi-hole-blocked hosts (`cdn.parsely.com`, `sb.scorecardresearch.com`,
`js-agent.newrelic.com`) all report `503`. Do not infer an HTTP-level
interceptor from it.

**`innerText.length` does not tell you the page renders.** scotsman.com and
yorkshirepost.co.uk were reported "intact" off `tx: 8808` / `kids: 22`, stable
across 2s/8s/16s. They were in fact unstyled markup — every stylesheet stripped,
raw link lists, a full-width SVG logo, horizontal scrollbar. All the *text* was
present, which is all that probe measured. The user had to point at the screen.

Measure rendering with `document.styleSheets.length` and a screenshot, not with
text length. A page with `styleSheets: 0` is broken no matter how much text it
has.

**An end-state DOM probe cannot see a wall that lives for 600ms.** The Reach
CMP is built around 500-1300ms and removed by the sweep ~400ms later. A probe
that samples once after load sees `cmpNodes: 0` and reports the site clean —
which is exactly how eight Reach titles were wrongly cleared the first time.
Poll at 100ms from the moment the page loads, and treat the CMP *vendor script*
as evidence the wall exists even when the transition is missed.

**`read_console_messages` returning nothing does not mean nothing was logged.**
Load-time messages do not survive the navigation that produced them, so a read
issued after `navigate` can come back empty on a page whose guards fired. This
cost a wrong conclusion: "the CMP isn't being removed, it isn't building at
all" — when a 100ms DOM poll showed it built at 425ms and was gone by 1129ms.

Before trusting an empty console, inject a line yourself and read it back. If
the sanity line returns and `console.debug.toString()` contains `native code`,
capture works and the page has not overridden the console — so prove the guard
another way, with a DOM-transition poll rather than the log.

**On an armed page, a probe that awaits `setTimeout` never returns.** The
eval-timer filter drops timers scheduled from eval'd code once the AdShield
signature is seen, and a `javascript_tool` / CDP `Runtime.evaluate` script
counts as eval. So `await new Promise(r => setTimeout(r, 500))` in a probe hangs
until the 45s CDP timeout, which reads exactly like a frozen renderer. Hit
repeatedly on whathifi.com (`l/1.2.10`, Future plc) before the cause was
found. On such pages: wait with the tool's own `wait` action between separate
probes, never inside one; or await `requestAnimationFrame` instead.

**A CDP `Runtime.evaluate` timeout is not necessarily a frozen renderer.**
notebookcheck timed out at 45s on a long-running probe script; the screenshot
showed a fully rendered page with no dialog, and the next probe returned
normally. Screenshot before concluding a native modal is up.

**`chrome-extension://` is as off-limits to browser automation as `chrome://`.**
Both return "Can't interact with browser-internal or unparseable URLs". So an
agent cannot open the options page, and the ISOLATED-world half of anything
(bridge.js reading chrome.storage, the error list rendering) can only be
confirmed by asking the user to look. Test the MAIN-world half yourself and say
plainly which half you did not test.

The extension id does leak usefully: with tracing on, `read_console_messages`
attributes the line to `chrome-extension://<id>/walls.js`. That gives the id,
but not the ability to navigate there.

**Incognito cannot be enabled by the extension.** `"incognito": "spanning"` in
the manifest chooses the *mode*; Chrome still requires the user to tick "Allow
in Incognito" per extension. Only an enterprise `ExtensionSettings` policy can
preset it. Do not report this as a bug to fix in code.

**Two resolvers in `resolvectl status` is not a bypass.** The IPv4 and IPv6
entries here are the same Pi-hole box — compare the IPv6 EUI-64 against the MAC
in `ip -6 neigh`. Verified: both block identically, Chrome DoH is `off`, the
system is `-DNSOverTLS`, and public DoH endpoints are themselves blocked.

## Tracing and settings

Tracing is **off by default**, and off means silent: no console output, and —
this is the point — no marker written to the page at all. Turning a channel on
makes bridge.js set `data-ktp-trace` on `<html>`, which a hostile SDK could in
principle read. That is an acceptable trade while debugging and not otherwise,
which is why the default is off rather than "quiet".

    chrome.storage.local -> { trace: { enabled: bool, channels: [...] } }
                         -> bridge.js (ISOLATED)
                         -> <html data-ktp-trace="walls,timers">
                         -> walls.js / guard.js traced(channel)

Channels: `walls`, `timers`, `consent`, `cookies`, `dom`, `newsquest`.

Two constraints worth remembering before changing this:

- **The MAIN world has no `chrome.*`.** walls.js and guard.js cannot read
  settings themselves. That is the entire reason bridge.js exists; do not try
  to `import` or call `chrome.storage` from them.
- **The attribute arrives late.** `chrome.storage` is async, so it lands a few
  milliseconds after `document_start`. Anything logged before that is missed.
  An empty trace is therefore not evidence that nothing happened — the same
  trap as the console buffer not surviving a navigation.

`traced()` caches the attribute for 250ms because the timer wrapper sits on
`setTimeout` for every page on the web; a `getAttribute` there would be on the
hot path.

## Protections are settings, and default to on

Every defence can be switched off from the options page. The plumbing mirrors
tracing, with one deliberate inversion:

    chrome.storage.local -> { protect: { walls, timers, consent, cookies, dom } }
                         -> bridge.js publishes only the ones set FALSE
                         -> <html data-ktp-off="cookies,dom">
                         -> walls.js active(name)

**The attribute lists what is OFF, not what is on.** A default install therefore
writes nothing to the page, which is the same property tracing has and matters
for the same reason: a permanent marker on `<html>` is what these SDKs look for.
`active()` returns true when the attribute is absent, so a storage failure, a
missing bridge or an early call all fail towards defending the page.

Consent records default to **writes refused**; that is the protective default and
a unit test pins it.

**Two defences are not switchable, and the UI says so.** Both act earlier than
any async setting can arrive, so a checkbox would be ignored in exactly the
window that matters:

    adLight pin   document_start, and configurable:false -- cannot be undone
    timer filter  the stripper interval can be scheduled before bridge.js has
                  read storage; an interval deleting every stylesheet is
                  unambiguous anyway

Both appear in the options page as checked, disabled boxes with the reason.
Tests assert `guard.js` never calls `active()` and that `active('timers')`
never appears in `walls.js`, so nobody adds a setting that cannot work.

**Naming is the whole point here.** The user read the trace-channel list as
feature switches -- reasonably, since it named every defence next to a checkbox
-- and asked for consent records, the Newsquest flag and DOM protection to be
"enabled". They already were. The fix was real switches under **Protections**,
with the same names, and a line on the tracing list saying it is logging only.

## Refuse by pressing their button, not by deleting theirs

`sweepConsent()` now tries the vendor's own refusal control before removing the
container, once per banner, and falls back to removal on the next tick if the
banner is still standing.

**Why the click is better than the removal.** Removing leaves the question
unanswered, so the banner is rebuilt every load. Measured on msn.com: clicking
"Reject All" dismissed Microsoft's banner and it did not come back after a
reload — and no consent cookie was written, because Microsoft holds the refusal
server-side against the MUID.

`REJECT_TEXT` is anchored and lists refusals only, and a label over 40
characters is ignored. A unit test feeds it "I Accept", "Accept All", "Agree and
close", "Allow all", "Got it", "Subscribe" and "Pay £2.99/mo" and fails if any
of them match. Adding `accept` to the list turns it red. Clicking the wrong
button here would consent on the user's behalf, which is the one outcome this
project must never produce.

## CookieYes — no reject button, and "save" is not a refusal

Seen on lesoleil.com (`cdn-cookieyes.com`). The first layer offers only
"Personnaliser" and "Accepter tout", so `REJECT_TEXT` finds nothing. The
preference centre has 148 switches: every *consent* switch ships off, but all
45 *legitimate-interest* switches ship **on** (6 purposes, 39 vendors). Pressing
"Enregistrer mes préférences" as shipped would therefore grant legitimate
interest to 39 vendors — consent by another name.

`rejectViaPrefs()` does it properly, driven by class names, never label text,
so language does not matter, and **staged across ticks**:

    tick 1   .cky-btn-customize                       open the panel
    tick 2+  wait: switch count unchanged since last tick AND a vendor row
             ([id^="ckyIABVendorSection"][id*="Item"]) exists   (max 10 ticks)
    then     uncheck every checked, unlocked box -> re-read them all ->
             only if none is left on, .cky-btn-preferences

**The vendor rows are built after the panel opens.** The first version opened,
switched off and saved in one go. On lenouvelliste.ca it saved with 25 switches
present, and reopening the panel showed all **39 vendor legitimate-interest
switches still on** — a refusal that was really a grant. The DOM probe of the
banner said "hidden, 0 switches on" and looked like success; only reopening the
panel showed it. Check what was *saved*, not what the banner looks like.

CookieYes hides its first layer while the panel is open, so a refusal in
progress is carried on even when `cmpShowing()` says the banner is gone. If the
panel never settles or a switch will not turn off, it saves nothing, clicks
`.cky-btn-close`, and the banner is removed instead. A save button whose class
looks like accept is refused outright. Six unit tests, mutation-checked.

Verified by hand in the page before coding it: banner and panel closed, record
`functional:no, analytics:no, performance:no, advertisement:no`, no
`euconsent-v2` stored. `cookieyes-consent` is in `CONSENT_NAME`, so under the
usual rule the refusal is not persisted and is repeated on every load.

The inline "Vous avez activé un bloqueur de publicités" bar in lesoleil's
leaderboard slot is a separate, non-blocking notice and is **not** handled.

## Microsoft portals (`portal.js`) — msn.com and bing.com

Comments, the non-news cards, the section tabs and the feed itself, removed in
the page. Scoped to msn.com and bing.com, nowhere else.

**One script, because they are one product.** bing.com embeds the same
Peregrine widget stack as msn.com: ~160 shadow roots and the identical
component names (`Comments` x305, `WeatherCardWC`, `MoneyCard`, `SportsCard`,
`TeamVsTeam`, `WaterfallViewFeed`, `ContentCard`). Verified on both before the
files were merged.

**MSN's server-side content settings do not reach bing.com at all.** With
Weather, Finance and Sports switched off in MSN's Personalise panel, all three
card types were still rendering on the Bing homepage. Another reason the DOM
route is the one that works.

**Bing needs one selector on top of the component names.** Its card carousel
and homepage quiz sit in `#scroll_cont`, above the fold and outside the widget
stack, with no `data-t`. Remove `WaterfallViewFeed` alone and a 203px band of
cards stays over the hero image.

**The flash on MSN was not solved. Do not claim it is, and think hard before
spending another session on it.** Four attempts: a document stylesheet, an
`attachShadow` patch, declarative-shadow-DOM coverage with a full-tree rescan,
and a plain `<style>` backup. With tracing on, the early half then reported

    v=2245 ticks=12 adopted=19 vis=0 peakVis=0 state=complete

`peakVis=0` means no element it targets was visible at any sample across the
whole load — the hiding works — while the feed was still visibly flashing. So
what paints is not what we hide, and the rules were being sharpened against the
wrong thing for three rounds. MSN sends its cards inside the document and paints
them early; the user's own Personalise → Content settings is server-side and is
the only thing that beats it. The settings page now says so plainly rather than
implying a clean load.

**Removal at document_end is too late to look right.** MSN's feed is
server-rendered, so the cards paint before any content script of ours runs: you
see the feed, then you see it vanish. `portal-early.js` is the other half —
MAIN world, `document_start`, hiding all four groups with CSS before first
paint.

Three things it has to do that a single stylesheet cannot:

    a document sheet does not cross a shadow boundary   -> adopt into each root
    the roots do not exist yet at document_start        -> patch attachShadow
    a <style> per root would be ~640 elements           -> constructable sheets

Patching `attachShadow` also catches **closed** roots, which no query can ever
reach. Four constructable sheets, one per setting, adopted by every root as it
is created; emptying one lifts that feature everywhere at once.

**It cannot read chrome.storage** — MAIN world — so it starts from the
documented defaults and `portal.js` sends the real settings over a
`ktp-portal-config` event, detail as a JSON **string** (an object does not cross
reliably; same rule as `ktp-report`). Consequence, stated plainly: the default
path never flashes, but a feature you have switched OFF may flicker hidden for a
few milliseconds before it is restored. The common case is the one kept clean.

**Removing a node does NOT stop its data loading.** Measured in-page, and it
is the thing to know before designing any of this:

    <img> inside a display:none container   -> still requested
    <img> built via innerHTML, NEVER in DOM -> still requested
    <img> inserted, removed 10ms later      -> still requested

Chrome fetches on `src` assignment. By the time a content script sees a card,
its thumbnail is already on the wire, so DOM removal is cosmetic with respect to
traffic. Only not-building the thing, or blocking the request, prevents a load.
(A CSS `background-image` on a hidden element is the one exception — those are
not fetched — but these cards use `<img>`.)

**So the data is stopped at the two endpoints that serve it**, in
`portal-rules.json`, a ruleset of its own:

    ||msn.com/pcs/api/widget/                  Bing's whole homepage feed
    ||assets.msn.com/service/segments/recoitems/   MSN's card data

Both are `block`, both name `initiatorDomains: [bing.com, msn.com]`, and both
live in a separate file from `rules.json` on purpose: a bad edit to the shared
ruleset once invalidated all of it and silently killed rule 1 on 269 Newsquest
sites.

**Never block the image hosts.** `th.bing.com` also serves Bing image search and
`img-s-msn-com` serves article photos; blocking either would break pages the
user wants. Blocking Bing's feed endpoint is enough — with no feed data, no
cards are built and no thumbnails are ever requested. A test fails the build if
those hosts appear in the rules.

**MSN's homepage feed text arrives with the document**, server-rendered, so it
cannot be avoided without blocking the page itself. The DOM removal is what
handles it, and that is a display fix, not a traffic one. Say so rather than
implying the traffic is saved.

**`isHomepage()` is per-site**: `/` for bing.com, `/` or `/xx-xx` for msn.com.
`bing.com/search` and `/images/search` must never count, or the feed removal
would start eating search results.

**MSN's own Content settings cannot do this, and there is no cookie to write.**
Personalise -> Content settings has switches for Comments, Weather, Casual
Games, Finance, Sports, Shopping, Recipes, Autos Marketplace, Today's Moment and
Community. Flipping one POSTs to

    assets.msn.com/service/msn/user?...&user=m-01C1...&scn=ANON

so the preference lives on Microsoft's servers keyed to the anonymous MUID.
Nothing is stored in a cookie — a before/after cookie diff across the toggle
showed only `ai_session` (telemetry) and `cbypass` (cache buster). And it does
not even work: with Comments switched off there, the feed still rendered 20
comment links.

**MSN's own switches DO work for the feed cards — the extension covers what
they miss.** With all nine card switches off and 11,700px of scrolling,
`WeatherCard`, `WeatherCardWC`, `MoneyCard`, `MoneyInfo`, `SportsCard`,
`SportsInfo` and `TeamVsTeam` were all absent. Three things survived them:

    meStripe.Games     survives "Casual Games"
    LeadGen.booking    survives "Shopping"
    LeadGen.Temu       "
    LeadGen.eBay       "
    Comments x501      survives "Comments" being switched off entirely

So `msn.js` is the primary route for comments, the Games tile and the
advertiser tiles, and a backstop for the feed cards — that server-side
preference is keyed to the MUID and is lost on a cookie clear, in a fresh
profile and in incognito.

**Every name in `CARDS` was observed in the live feed.** Four guessed names
(`RecipeCard`, `AutosCard`, `TodaysMoment`, `CommunityCard`) were written first
and removed once enumeration showed they do not exist; a test now fails if any
of them comes back. Same rule as the site list: evidence, never assumption.

**Target `data-t`, never the class names.** MSN's classes are per-build hashes
(`css-p30qmo`); `data-t` carries `{"n":"WeatherCardWC","t":8}` and the component
names are stable. Exact names for cards, prefixes for the lead-gen tiles
(`LeadGen.eBay`, `LeadGen.Temu`, `LeadGen.booking`) since those are one per
advertiser. `Sports` as a prefix would catch sports *articles*, so the card
names are matched exactly.

**Remove the `<cs-responsive-card>` wrapper, not just the component**, or the
tile's spacing stays behind as a gap.

**The section tabs and the feed are separate switches.** The tabs beside
Discover are `a.navItem` links in one `<ul>`, each with its own `data-t` name --
`finance` is the one labelled "Money". Checked for collisions before shipping:
across the page and every shadow root those eight names match exactly eight
elements. The `<li>` goes with the link, or the list keeps its spacing.

`feed` removes `PivotsNav` and `WaterfallViewFeed` together, which leaves the
homepage as the logo, the search box and the quick links. That is the intended
result, not damage.

**`feed` is gated on `isHomepage()`, and must stay that way.** An article page
carries a river of related stories under the piece, and an ungated removal would
take the article's own page apart. A test pins the path pattern and feeds it
`/en-gb/news/uknews/story-abc`.

**Everything is in shadow DOM** — see the social.js note; the same walk applies.

## Error reporting

The guards swallow every exception so they can never break a page. That silence
was the problem: a guard that stopped working looked identical to a guard with
nothing to do, and with tracing off it did not even log.

    walls.js / guard.js   report(where, err)
      -> CustomEvent 'ktp-report'   detail is a JSON **string**
      -> bridge.js (ISOLATED)       -> chrome.storage.local.errors  (50, newest first)
      -> options.html               Errors (n), with Clear

**`detail` must stay a string.** Objects do not cross the MAIN/ISOLATED world
boundary reliably. Tidying it into an object would silently stop collection, so
a unit test pins it.

Repeats of the same `where` + `host` + `message` increment a counter on the head
entry rather than filling the buffer. The event fires only when something has
actually failed, so the page sees nothing from us in the normal case.

Verified end to end in the browser: errors appear in the menu and Clear works.

## Social links (`social.js`)

Two passes, and the marker between them is the design:

    pass 1   every Facebook / Instagram / X / TikTok / LinkedIn / Snapchat link  ->  href
             "http://localhost/removeme", original parked in data-ktp-was
    pass 2   a[href="http://localhost/removeme"]  ->  furniture removed,
             everything else hidden by a stylesheet rule on that href

The path `/removeme` is not decoration. It makes every target visible in one
selector, and **Mark only** mode stops after pass 1 so a site can be inspected
before anything is touched.

**Hiding a prose link takes its words.** Two measured examples, both put to the
user:

    BBC article sign-off   "follow BBC Manchester on , , and ."
    Wikipedia (Elon Musk)  12 citations; a reference reads
                           "@elonmusk (December 28, 2019). (Tweet) - via Twitter."
                           with the cited title hidden

The user was shown both and chose hiding, twice. `keepText` turns it into an
unwrap (anchor replaced by a span holding its own text) and stays **off** by
default. Do not flip it on as a "fix" -- it is a decision, not an oversight.
The hidden anchor keeps its text and `data-ktp-was` in the DOM, so nothing is
destroyed either way.

**The furniture verdict is a pure function, and the order is the whole bug
surface.** Three orderings shipped wrong in one session:

    ctx    a share/social container wins outright
    icon   no text at all -> furniture, checked BEFORE prose, or the follow
           icons in a header sit beside text and survive (observed on
           notebookcheck: rewritten, still on screen)
    prose  sentence text beside the link -> never removed
    text   otherwise the link's own words, then its aria-label/title

`furnitureVerdict()` takes `{ctx, text, label, prose}` and nothing else, so a
test pins the order rather than the symptoms. Swapping prose ahead of icon
turns the suite red.

**Defaults exist twice** — `DEFAULTS` in `social.js` and `SOCIAL_DEFAULTS` in
`options.js` — because the content script cannot import from the options page.
An install that never opened settings must behave like one that did, so a test
parses both and compares them. Add a setting to one, add it to the other.

The three rules that keep it from breaking pages, all covered by unit tests:

- **Whole-label host matching.** `href*="x.com"` matches netflix.com and
  linux.com. Parse to a hostname, compare labels.
- **Login links stay.** `KEEP` exempts OAuth/login/legal/developer URLs;
  removing "Continue with Facebook" locks people out of sites.
- **Container words are prefix-matched, not boundary-matched.** A `[^a-z]`
  boundary missed notebookcheck's `socialarea` and `socialarea_facebook` and
  left the icons on screen; it also misses camelCase `articleShareTools`. Class
  and id strings are split on punctuation *and* camelCase, each word
  prefix-matched, with the false friends named explicitly (`shareholder`,
  `socialist`, `sharepoint`, `follower`, `following`). A bare `share` or
  `social` word counts as furniture on purpose.

`neutralise()` is idempotent against itself but re-fires if the page puts the
real href back, so an SPA re-render cannot restore a live link.

**Share controls are not always links.** lesoleil.com's article bar is six
`<button>`s with no href (`#article-share-facebook`, `-twitter`, `-linkedIn`,
`-email`, `-link`, `-share`, labels "Partager l'article en cours via …"); the
URL is built in a click handler, so the link passes never saw them. Buttons are
caught by a two-part signature, `shareButtonVerdict()`: the button **names a
platform** as a whole word (id, `data-testid`, class, label, wrapper class --
split *without* camelCase, or `linkedIn` becomes "linked in") **and** is a
**share control** (share/social word in those names or its container, or a
share label, French `partag` included). Platform alone is "Continue with
Facebook"; `BUTTON_KEEP` exempts login labels outright. Email, copy-link and
native share name no platform and stay. Pass 1 marks
`data-ktp-was="share-button:<platform>"` and disables the button (Mark only
leaves it visible but inert); pass 2 prunes it. Four tests, mutation-checked.

**Follow icons are judged by signature too, wherever they point.**
lapresse.ca's "Suivez-nous" rows (header top-right and footer) point Facebook
and Instagram at its own explainer page -- Meta blocks news in Canada -- and
add YouTube, Bluesky and Threads. The same `shareButtonVerdict()` now runs over
wordless links as well as buttons; a match is neutralised like a platform link.
Platforms outside the six settings switches (Snapchat became the sixth; it was `other` before) map to `'other'`, which is acted
on **only** as signature furniture, never by host -- deliberately, because
host-rewriting YouTube would hide every YouTube link inside article text. A
link with headline words of its own is never judged by signature.

A row may name itself nothing useful -- journaldemontreal's footer is
`li.footer-rs > a[title=Bluesky]`. `besideMarked()` supplies the signal: an
icon naming a platform whose container (3 levels) already holds marked links
is in a social row. It works because pass 1 marks by host before pass 2
prunes, so the neighbours are still present when the icon is judged.

**"Mark only" looks like a bug and is not.** The footer follow icons on
lesoleil.com were rewritten to `/removeme` but still on screen, with no
`#ktp-social-css` in the page -- because the user had Mark only selected. Check
the mode before debugging pass 2.

**A consent-gated embed has no platform URL at all.** standard.co.uk holds
embeds behind its own box -- server-rendered as a `SocialEmbedGate` island,
hydrated to "Allow X (formerly Twitter) content" + `<button
data-social-consent-accept>Allow and Continue</button>`. Until it is pressed
there is no link, iframe or blockquote for the host passes to find. The same
page's sidebar has a second, "Allow external content" (`service: "external"`,
an Html embed with `markup: null` -- it exists only to ask).

Two signatures, `gateVerdict()`: the data attribute, or -- on any other site --
the wording: a box of at most 600 characters saying its content "is provided
by" someone / asking to "allow ... content", holding an anchored
allow/accept-to-load button ("Allow and Continue", "Accept and continue"; never
"Accept all" or "I Accept"). A named platform obeys its switch; anything else
is `external` and always goes, at the user's direction. The box is marked
`consent-embed:<platform>` and pruned; the button is disabled and **never
clicked** -- pressing it loads the embed and consents. Tests fail if either
function gains a `.click(`, and on CMP-banner, newsletter and 700-char cases.
Loaded embeds (a real `blockquote.twitter-tweet`) are still treated as content.

**Comment widgets live in iframes; social.js runs in all frames.** It was
registered `all_frames: false` from its first commit, with no recorded reason,
so Disqus's comment box (a cross-origin `disqus.com/embed/comments/` frame) was
never reached. Now `true`; a test pins it. The sweep on an empty ad frame is a
couple of querySelectorAll calls every 2s.

**"Keep sign-in links working" OFF now covers sign-in buttons.** The KEEP
exemption only ever applied to links; Disqus's row is buttons with no href:

    ul.login-buttons > li.auth-facebook >
      button.connect__button[data-action="auth:facebook"][title="Facebook"]

`loginButtonVerdict()` -- configured platform (never `other`) named in the
button's names, title or `data-action`, plus a login word (`auth`, `login`,
`signin`, `oauth`, `sso`, `connect`) there or in 3 levels of container. Google,
Microsoft, Apple and Disqus sign-ins name no configured platform and stay. A
test fails if the call is not behind `cfg.keepLogins === false`.

**Disqus is blocked at the network, by user decision ("it's spam").** Its own
ruleset, `widgets-rules.json`: `||disqus.com^` and `||disquscdn.com^`, block
only, every sub-resource type but never `main_frame`, with
`excludedInitiatorDomains: ["disqus.com"]` so disqus.com itself still works.
Driven by the single **Comments** switch (below); the options page calls
`updateEnabledRulesets`. Chrome resets that on an extension update, so after a
bump + reload it is back to the manifest default -- blocked -- until the options
page is opened, which re-applies the stored choice. A service worker to
re-apply it at startup was tried and not added; the fall-back is towards
blocking. Found while debugging the login-row fix above, whose first version
missed Disqus's real `aria-label="Login with Facebook"`: `buttonPlatform()`
refuses any login label, so the label is now fed in with the names instead.

**Comment sections are hidden by signature (`comments.js`), at the user's
direction.** All sites, top frame, document_start. The signature is the
element's own naming: id + class split into words (punctuation and camelCase),
`comments`/`disqus` on its own, or `comment` + a structural word (section,
list, thread, form, count, link, ...). `commentVerdict()` is pure and pinned.
The guards are the important half: WordPress puts `comments-open` on
`<body>`, so html/body/main/article are never candidates, and nothing that
contains the page's h1, a `<main>`, or the article holding the h1 is ever
hidden. **Not "any article"**: the HTML spec recommends `<article>` per
comment, and techpowerup.com's `section.comments > article.forumpost x25` was
left on screen by that first version of the guard. Caveat seen there too: the
first `<h1>` on techpowerup is the sidebar's "Latest GPU Drivers", not the
headline, so the guard protects the wrong heading on such pages -- harmless
there, weaker than it reads. Bare `comment`, `commentary`, `commented` do not
count. A wrapper left holding only hidden comments is collapsed too (ign.com's
empty 636px `div.bottom-content`), at most two levels, same guards. An early
stylesheet covers the observed mounts (`#comments`, `.comments-section`,
`#disqus_thread`, `.comment-count`, `a[href$="#comments"]`) before first paint;
it matches by selector alone, without the guards -- it hid techpowerup's
`div#comments.social-share` share bar. The sweep marks the rest
`data-ktp-comments`. IGN's comments are first-party
(`mollusk.apis.ign.com/graphql`, shared with the whole site), so this is a
display fix there: the data is still fetched.

**Newsletter sign-ups are removed by signature (`newsletter.js`).** Seen on
whathifi.com: a popup, `div.hidden.fixed.inset-0.z-[max] > ... >
div#newsletter-capture-modal > form > input[type=email]`, shipped hidden and
shown on a trigger, plus an in-article `newsletter-inbodyContent-slice`. Anchor
is always an email field: an ancestor named `newsletter` (word-split), or a
`position:fixed` ancestor whose short text asks you to subscribe. A fixed
overlay goes whole, backdrop included. A form with a password field is never
touched. Hidden by marker + stylesheet, so when the site un-hides its popup it
stays hidden. The scroll unlock runs only while a marked **overlay** exists --
an inline box must never undo some unrelated menu's scroll lock. Own switch,
`widgets.newsletter`, saved together with `widgets.comments`.

**Business tools are excluded from the cleanup scripts, by host -- the one
deliberate exception to signature-only scope.** On Jira, comments.js hid the
text of every comment and the description: Atlassian renders both as
`div.ak-renderer-wrapper.is-comment`, and the verdict pooled words across class
names, so `wrapper` + `comment` matched. The verdict now judges each class
name alone (pinned by a test). `newsletter.js` and `social.js` carry
`exclude_matches` for `*.atlassian.net` only. `comments.js` has **no**
hard-coded exclusions, at the user's direction, and a test fails if one comes
back. Every other work tool goes in the user's URL exceptions lists (below):
**never write the user's employer or internal hostnames into this repo** --
it is public and not a work project. walls.js and bridge.js still run
everywhere, so consent is still refused.

**The user's own URL exceptions** exist for three features, each its own
list under its own storage key and its own box in Settings:
`commentExceptions` (Comments), `socialExceptions` (Social furniture) and
`newsletterExceptions` (Newsletter sign-ups), deliberately not inside
`widgets` or `social`. The matcher is `except.js`, loaded first in each of the
three manifest entries and read as `self.ktpUrlExcepted` -- content scripts
of one extension share an isolated world per frame. social.js gates on
`active()`, never `cfg.enabled` alone, or the list is ignored. An entry is a site (`example.com`, whole
labels, subdomains included) or a URL prefix (`example.com/forum`, whole path
segments). `urlExcepted()` is pure and pinned; options.js stores lines as
typed and except.js does the forgiving parse. Path exceptions are re-checked
on SPA navigation. The early stylesheet is still installed before storage
answers, so an excepted page can flash hidden for a moment -- the same
trade-off as the portal settings. The Disqus DNR block is not per-site.

**One switch for all comment removal**, at the user's direction: **Comments ->
Remove comments on all sites** drives both comments.js (via
`widgets.comments`) and the Disqus ruleset. A test fails if a second switch
appears.

**petapixel.com.** Flipboard maps to `other` (signature only). Footer follow
icons carry screen-reader text "Follow PetaPixel on Threads", which the anchored
furniture pattern did not know; `follow <name> on <one word>` now counts. The
one-word tail is what keeps "Follow the money on election night" out.

**A document-level query is not enough — walk the shadow roots.** msn.com
renders nearly everything in web components:

    document.querySelectorAll('a[href]')   ->  1 anchor
    across 161 open shadow roots           ->  73 anchors, incl. Facebook and X

Both passes go through `queryAll()`, which walks `document` plus every open
shadow root. Measured on the msn.com front page: 161 roots, 1640 elements,
0.4-2ms per walk, so this is cheap — but it is per sweep, and the
MutationObserver now coalesces through `queueSweep()` (200ms) instead of
sweeping per mutation batch. Closed shadow roots are out of reach for any
script; nothing to be done there.

**A stylesheet in the document does not apply inside a shadow root.** The hide
rule is installed per root by `styleRoot()`, called for each link left marked,
or a marked link inside a component stays visible.

## Conventions

- **Version**: run `./bump.sh` after **any** change to a file on disk, not only
  before a reload, and not only for changes that alter behaviour. A comment-only
  edit gets a bump too. The point is that the version string identifies the disk
  state exactly, so "is what Chrome is running the same as what is on disk?" is
  answerable by looking, rather than by remembering which edits were cosmetic.
  Chrome requires 1-4 integers
  each 0-65535, so the scheme is `0.1.MMDD.HHMM` with the readable datetime in
  `version_name`.
- **Scope**: `walls.js` runs everywhere, which is only acceptable because every
  section of it is inert until its own signature is observed — verified on BBC:
  hooks installed, zero log lines, timers and nodes untouched. `guard.js` stays
  scoped to the domains that need it. Never widen `guard.js` to
  `http://*/*` — this extension patches global prototypes, and an earlier build
  did that on every site the user visited, including their bank.
- **Locks**: only `adLight` is `configurable: false` (it must survive the page's
  own `var adLight = false`). Everything else uses `configurable: true` so no
  page API is permanently seized.
- **Permissions**: `declarativeNetRequest` only, no `host_permissions` (a
  `block` action does not need them). Keep it that way.
- **Author**: `manifest.json` carries `author`. Chrome accepts the plain string
  form (uBlock Origin ships the same shape), so it is a string, not an object.
- **Settings**: extension pages (`options.html`) may use `chrome.*` freely;
  content scripts in the MAIN world may not. Keep that line clear.
- **Syntax check**: there is no node on this box. Use
  `gjs -c '... new Function(src) ...'` to parse-check before asking for a reload.

## Unit tests

    ./test.sh        116 tests, ~1s

They run on **gjs**, not node, and they load the real `walls.js` / `guard.js`
through a `new Function(...)` whose parameters shadow the browser globals — so a
shim stands in for the DOM and the *production* patterns are the ones under
test. A suite that re-declared the regexes would pass forever while production
broke.

Covered, because each one is a bug this project actually shipped or nearly did:
the CSS-stripper filter and its quoting variants, benign handlers surviving,
consent cookies refused while `sp_dc`/`sp_t` are not (the Spotify trap),
localStorage consent keys, tracing silent by default, the `adLight` pin
surviving `adLight = false`, version format, minimal permissions, DNR
block-only actions, and manifest file references.

**Not covered, deliberately:** `looksLikeWall()` and `cmpShowing()` need real
layout, and a shim would only test the shim. Those stay covered by the browser
sweep in `sweep-results.md`. Passing the suite means the decision logic is
right; it does not mean a page renders — which is exactly the mistake that let
scotsman and yorkshirepost ship broken.

The suite has been mutation-checked: broadening `_sp_` to `sp_`, dropping the
`storage` permission, and making `log()` unconditional each turn it red. If you
add a test, break the thing it guards and watch it fail before trusting it.

## Verification recipe

1. `./bump.sh`
2. User reloads at `chrome://extensions` (agents cannot — `chrome://` is off
   limits to browser automation). Confirm `version_name` matches.
3. Navigate, then sample the DOM at **2s, 8s, 16s and 25s** — not just once.
4. `read_console_messages` with no pattern; the guards log every action.
5. **Verify visually, not by DOM probe alone.** Screenshot at each stage of
   the load and look at it; a probe is supporting evidence, never the verdict.
   Every wrong "fixed" in this file (scotsman's unstyled page, the Reach CMPs,
   the lenouvelliste vendor switches) was a DOM reading that looked right.
   For consent, reopen the vendor's panel afterwards and look at what was
   actually saved.
