# Sweep results — 52 articles, 26 domains

Re-run against version `0.1.922.1925`, 2026-09-22, with a **render check**
added. Two articles per domain.

## Why this run exists

The previous sweep measured `innerText.length` and `children.length` and passed
everything. It was wrong: scotsman.com and yorkshirepost.co.uk were unstyled
markup — all the text present, every stylesheet stripped — and the probe could
not tell the difference. The user saw it on screen and said so.

This run records `document.styleSheets.length` and total CSS rule count on every
article. **A page with `styleSheets: 0` is broken no matter how much text it
has.**

## Result

**52 of 52 articles have `styleSheets > 0` and rendered.** No consent wall left
on screen, no scroll left locked, no reload loops (`nav: navigate` throughout).

## Consent-or-pay walls — Reach plc, Quantcast Choice via `cmp.inmobi.com`

`appeared -> removed`, then sheets/rules at end state.

| Domain | Article 1 | Article 2 | sheets / rules |
|---|---|---|---|
| dailyrecord.co.uk | 1454 -> 2451ms | 522 -> 1128ms | 76-81 / ~3000 |
| mirror.co.uk | outside window | 1094 -> 1230ms | 74-75 / ~3000 |
| liverpoolecho.co.uk | 729 -> 1135ms | 710 -> 1315ms | 76-77 / ~3050 |
| manchestereveningnews.co.uk | 818 -> 1119ms | 505 -> 1108ms | 77-81 / ~3000 |
| birminghammail.co.uk | 845 -> 1146ms | 563 -> 1166ms | 77 / ~3070 |
| chroniclelive.co.uk | 794 -> 1095ms | 523 -> 1126ms | 76-77 / ~3070 |
| dailystar.co.uk | outside window | outside window | 71-82 / 808-3089 |
| walesonline.co.uk | removed | removed | 24-25 / ~2320 |

"Outside window" means the CMP was built and removed before the probe's first
sample — the vendor script is present and the end state is clean. The wall
exists on all eight; catching the transition is a timing matter, not evidence of
absence.

## AdShield anti-adblock SDK

| Domain | `data-sdk` | sheets / rules | Notes |
|---|---|---|---|
| scotsman.com | `l/1.1.21` | 2 / 541, 2 / 550 | **fixed this run** |
| yorkshirepost.co.uk | `l/1.1.21` | 2 / 532, 2 / 554 | **fixed this run** |
| notebookcheck.net | `l/1.2.10` | 13 / 517, 5 / 465 | single load, no reload loop |
| listentotaxman.com | `l/1.1.10` | 11 / — | **fixed 2026-09-23**: recovery `confirm()` froze the tab; `loader-check` gate pinned, one navigation, no dialog or iframe, alive 33s |
| scotsman.com, yorkshirepost.co.uk | `l/1.1.21` | 3-4 / 992-995, 3-4 / 849-852 | **re-checked 2026-09-23 after the gate fix**: gate pinned, loader tag id unchanged (no fallback retry), no error iframe, one navigation to 21-22s, styled |
| whathifi.com | `l/1.2.10` | — | **seen 2026-09-23** while fixing its newsletter popup: armed, page intact. Probes awaiting `setTimeout` hang here (timer filter) |

Scotsman and Yorkshire Post were `styleSheets: 0` before `0.1.922.1925`. Their
CSS is now intact and held steady across 2s / 8s / 16s on Yorkshire Post. See
AGENTS.md, "The CSS stripper", for the mechanism.

## Sourcepoint present, message container never built

DNR rule blocking `/unified/wrapperMessagingWithoutDetection.js` stops it first.

theguardian.com (10-12 sheets), independent.co.uk (21-22), standard.co.uk (7),
techradar.com (55-58) — 2 articles each.

standard.co.uk has the lowest rule count in the sweep (479). Spot-checked by
screenshot: masthead, nav, headline, standfirst and image all render correctly.
Low sheet counts are a CSS-in-JS build, not damage.

## Newsquest — `adLight` pin holds

`window.adLight === true`, 11 sheets, ~3270-3310 rules on every load:
heraldscotland.com, thenorthernecho.co.uk, glasgowtimes.co.uk, theargus.co.uk,
oxfordmail.co.uk (2 articles each).

## No wall of any kind

inews.co.uk (40-55 sheets), metro.co.uk (21-22), engadget.com (3), pagesix.com
(81-82, OneTrust loaded but no banner), theverge.com (79-108), arstechnica.com
(10).

## Measurement notes

- The Chrome extension disconnected once mid-sweep and two batches timed out
  while reporting; the navigations had landed, so the affected pages were
  re-probed individually rather than skipped.
- notebookcheck produced three CDP `Runtime.evaluate` timeouts. Each time the
  follow-up probe returned normally (~50s, 13121 / 21184 chars). Transient
  load-time busyness, not a wall — screenshot before concluding otherwise.

# Google News run — 50 links, 2026-09-22

Opened from `news.google.com/home?hl=en-GB&gl=GB`, against `0.1.922.2046`.
Unlike the 52-article sweep above, these were **not** chosen — they are whatever
the UK front page served, so they are a fair sample of what the extension meets
in ordinary use.

## Result

**50 links opened. Zero pages with `styleSheets: 0`.** No consent wall left on
screen (`cmp: 0`) except the one flagged below, no reload loops, no blank pages.

| Outcome | Count | Notes |
|---|---|---|
| Rendered normally | 45 | 3–114 stylesheets depending on the site |
| `chromewebdata`, 110 chars | 2 | Pi-hole-blocked domains — deliberate, not a fault |
| Hard paywall | 1 | thetimes.com: CSS fine (23 sheets), content gated. Not ours to open. |
| Duplicate landings | 2 | see "indices are not stable" below |

Publishers seen: BBC (×9), Manchester Evening News, Page Six, The Times, ESPN,
Forbes, Al Jazeera, Belfast Telegraph, Kent Online, Isle of Man Today (×3),
Northumberland Gazette, West Leeds Dispatch (×2), Gazette News, Plant Based
News, and others whose hostnames the automation layer redacted.

## The AdShield fix holding on sites never tested before

Three National World titles turned up that were not in any earlier list, all
carrying `data-sdk="l/1.1.21"` — the variant whose CSS stripper broke Scotsman
and Yorkshire Post:

    northumberlandgazette.co.uk   3 sheets / 579 rules   intact
    (Black Country title)         3 sheets / 580 rules   intact

Both render. The signature covers them with no per-site entry, which is the
whole point of matching the `l/<n>.<n>` shape rather than a version string.

## One finding worth following up

One article carried a `data-sdk` shape not seen before:

    data-sdk="wp-ls/di-1787867664770"      24 sheets, 4543 chars, cmp: 1

`SDK_ATTR` (`/(^|-)l\/\d+\.\d+/`) does **not** match it — `ls/di-…` is not
`l/<n>.<n>` — so `walls.js` never armed on that page. It rendered fine anyway,
and the `cmp: 1` was a consent container still present at probe time rather
than a wall over the article.

So: not a failure, but a gap worth knowing about. It is a different AdShield
product line, and if a site ever shows the stripper symptom (`styleSheets: 0`
with text present) while carrying `wp-ls/…`, this is the reason the defences
stayed asleep. Not fixed speculatively — coverage here is evidence-based, and
no damage has been observed from it.

## Method notes, because this was harder than it looks

**Google News `/read/` URLs are redacted by the automation layer**, so they
cannot be passed to `navigate`. The workaround is to jump from inside the page:
`location.href = list[i]`, scheduled in a `setTimeout` so the call returns
before navigation starts.

**A probe cannot share a tool call with the jump that precedes it.** CDP kills
any evaluation that spans a navigation (`Inspected target navigated or closed`),
and a spacer action is not enough. One article per call is the floor.

**The link list is lazy-loaded and unstable.** A freshly loaded front page
exposes ~22 links; scrolling grows it to ~65. Worse, the order is rebuilt on
every load, so index 33 and 34 returned the *same* article. Fixed by capturing
the list once into `localStorage` on news.google.com and indexing that.

**`cssRules` undercounts.** Cross-origin stylesheets throw on access, so the
rule count reads low — ESPN showed 4 sheets but 5 rules. The *sheet count* is
the reliable render signal; rule count is a bonus. The probe now counts the
cross-origin sheets separately rather than silently swallowing them.
