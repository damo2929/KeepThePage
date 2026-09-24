# Keep The Page

A Chrome extension that stops anti-adblock **malware** and consent-or-pay walls
hiding news articles.

More and more publishers send you the article, then take it away again with
their own JavaScript. They blank the `<body>`, delete every stylesheet, or
throw a modal over the page that only offers "accept tracking" or "pay". This
extension keeps what the publisher already sent you.

It is not a paywall bypass. If the server never sent the article, nothing here
conjures it up. What it keeps is content that arrived in your browser and was
then destroyed in your browser.

## Install

Unpacked, from this folder:

1. `chrome://extensions` → turn on **Developer mode**
2. **Load unpacked** → pick this folder
3. Optional: Details → **Allow in Incognito**. Chrome makes you tick this per
   extension; the manifest can't do it for you.

Run `./bump.sh` after any edit, so the version in `chrome://extensions` tells
you exactly what's on disk.

## Settings

Click the toolbar icon, or Details → Extension options. There's no Save
button. Changes save as you make them and a "Saved" marker flashes up.
Settings live in `chrome.storage.local`, so they stay in this browser profile
and don't sync.

The page, top to bottom:

| Section | What it controls | Default |
|---|---|---|
| **Protections** | Ad walls, consent-or-pay walls, consent records, DOM protection. Timers and the Newsquest flag show ticked and greyed out: they can't be switched off | All on |
| **Tracing** | Console logging, per channel. Logging only, it switches nothing on or off | Off |
| **Social furniture** | Links to Facebook, Instagram, X, TikTok, LinkedIn and Snapchat: per-platform switches, *Hide and remove* or *Mark only*, two exceptions, and your URL exceptions | On, remove, sign-in links kept, article text not kept, no URL exceptions |
| **Comments** | Comment removal on all sites, the Disqus block, and your URL exceptions | On, no exceptions |
| **Newsletter sign-ups** | Email sign-up popups and in-article boxes, and your URL exceptions | On, no exceptions |
| **MSN and Bing feeds** | Comments, information cards, section tabs and the feed, on msn.com and bing.com only | All on |
| **Errors** | Failures the guards swallowed, newest first, repeats counted, with Clear | Empty |

The footer shows the running version, read from the manifest. After a reload,
check it against `version_name` and you know Chrome is running what's on disk.

### Where your settings are kept, and how to clear them

Everything the settings page saves goes into `chrome.storage.local`, Chrome's
own storage for this extension. Nowt is sent anywhere, nothing syncs to your
Google account, and nothing is written into the sites you visit.

| Key | What it holds |
|---|---|
| `protect` | Protections you've switched off |
| `trace` | Tracing on/off and the channels picked |
| `social` | Social furniture switches, mode and exceptions |
| `socialExceptions` | Your Social furniture URL exceptions |
| `widgets` | The Comments and Newsletter switches |
| `commentExceptions` | Your Comments URL exceptions |
| `newsletterExceptions` | Your Newsletter URL exceptions |
| `portal` | The MSN and Bing switches |
| `errors` | The error log, last 50 |

A key only exists once you've changed that setting. A fresh install has none
and runs on the defaults.

On disk it's a small LevelDB folder in your Chrome profile, named after the
extension's id (shown on `chrome://extensions` with Developer mode on):

```
Linux     ~/.config/google-chrome/<Profile>/Local Extension Settings/<id>/
macOS     ~/Library/Application Support/Google/Chrome/<Profile>/Local Extension Settings/<id>/
Windows   %LOCALAPPDATA%\Google\Chrome\User Data\<Profile>\Local Extension Settings\<id>\
```

`<Profile>` is `Default` for the first profile, `Profile 1` and so on after
that. Chromium uses `~/.config/chromium/` in place of `google-chrome`.

To clean up, pick the one that fits:

- **Clear one thing.** Empty an exceptions box, untick back to default, or
  press Clear under Errors.
- **Reset everything, keep the extension.** Open the settings page,
  right-click → Inspect → Console, and run `chrome.storage.local.clear()`.
  Close and reopen the settings page and you're back on the defaults. To
  drop a single key: `chrome.storage.local.remove('socialExceptions')`.
- **Remove the extension.** Chrome deletes its storage folder with it. Nothing
  is left behind.
- **By hand.** With Chrome closed, delete the `<id>` folder above.

Two things that aren't stored as settings. The Disqus block's on/off state is
held by Chrome itself; it goes back to on after an extension update until the
settings page is opened again, and goes with the extension when it's removed.
And the `data-ktp-*` markers the extension puts on a page only exist while
that page is open. Close the tab and they're gone.

The consent cookies the extension refuses are the sites' own, and it stops
them being written. It never creates cookies of its own. Clearing a site's
cookies is a normal Chrome job and nowt to do with this.

### Protections

Every defence, each on by default. Switching one off writes `data-ktp-off` to
the page so the in-page guards can see it. With everything on, nothing is
written at all. Consent records default to writes refused.

Two can't be switched off, and the page says why. The Newsquest `adLight` pin
runs at `document_start`, before `chrome.storage` can answer, because it has
to beat the page's own `var adLight = false`. It's non-configurable for the
same reason, so it can't be undone afterwards. The timer filter has the same
problem: the stylesheet-stripping interval can be scheduled before settings
have been read. A checkbox would be ignored in exactly the window that
matters. It would be decoration.

### Tracing

Off by default, and off means silent: no console output and no marker on the
page. Turn a channel on and the in-page guards log what they do. Channels: ad
walls, timers, consent-or-pay walls, consent records, DOM protection, MSN and
Bing feeds, and the Newsquest flag. They carry the same names as the
protections, but tracing is logging only.

Why off rather than on-but-quiet? Tracing works by setting `data-ktp-trace` on
`<html>`, and a hostile script could read that. Fine while debugging. Pointless
the rest of the time.

### Social furniture

Every link to Facebook, Instagram, X, TikTok, LinkedIn or Snapchat is
rewritten to `http://localhost/removeme`, then anything carrying that marker is
removed or hidden. Each platform has its own switch. **Mark only** defuses the
links without removing or hiding anything, so you can see what the other mode
would take before you trust it on a site. Sign-in links are kept by default;
article text isn't (see [Social furniture](#5-social-furniture) below).

It has its own URL exceptions box, same format as the one under Comments. Put
a site there and its social links are left alone. Handy for work tools, where
a contact record's LinkedIn link is data, not clutter.

### Comments

One switch removes comments on every site: comment sections, comment counts
and "N comments" links. They're found by how they name themselves
(`comments-section`, `post-comments`, `#disqus_thread`, ...), never by a list
of sites. Disqus is blocked at the network as well.

Each class name is judged on its own. Jira draws every comment and the ticket
description as `ak-renderer-wrapper is-comment`, and an earlier version lumped
those two names together into "comment + wrapper" and blanked every ticket.

Your URL exceptions go in the box underneath, one per line:

```
yourcompany.atlassian.net  a site, subdomains included
example.com/forum          only pages under /forum
```

Pasted URLs and Chrome-style patterns (`*://*.example.com/*`) work too. Hosts
match by whole label, so `example.com` never matches `notexample.com`. Paths
match by whole segment, so `/forum` never matches `/forumx`. Changes reach open
tabs straight away and follow in-app navigation.

There are no built-in exceptions for comments. Put the work tools you use in
the list. The same format works in the Social furniture and Newsletter boxes;
each list is separate, so a site in one isn't excepted from the others. Two
limits: an excepted page can still flash for a moment on load,
before the list is read, and the Disqus block isn't per-site.

### Newsletter sign-ups

Popups and in-article boxes asking for your email, removed by signature, with
their own switch and their own URL exceptions box. Anything with a password
field is never touched.

The newsletter and social-link passes skip Jira (`*.atlassian.net`) out of the
box. Anything else you work in goes in their exceptions boxes.

### MSN and Bing feeds

Four switches, all on: comment links on feed cards; information cards
(weather, finance, sports, the games tile and advertiser tiles, news cards
stay); MSN's section tabs; and the whole feed, homepage only.

You'll often see MSN's feed paint before it goes. It arrives inside the page
itself, so what the switches guarantee is the end state, not a clean load.
More in [MSN and Bing](#msn-and-bing).

### Errors

Every guard swallows its own exceptions so it can never break a page. The
downside is silence: a guard that's stopped working looks the same as one with
nowt to do. So failures are reported here, newest first, repeats counted, with
a Clear button.

## How it works

Five mechanisms, each armed by a signature, not a list of domains. `walls.js`
runs on every site, but nothing acts until a signature turns up. On a clean
site every hook passes straight through and no timer, node or dialog is
touched.

### 1. Find the gate, don't fight the wall

Newsquest's 269 titles gate their whole wall behind one page global:

```js
var adLight = false;        // line 1647
if (adLight !== true) { …}  // line 2020: loader, eval payload, confirm()
```

`adLight` is the subscriber "light ads" flag. Pin it to `true` at
`document_start` and the wall never builds. Nothing to block, nothing to
dismiss, no anti-tamper tripped. A `var` declaration doesn't redefine an
existing property on the global object, so a non-configurable accessor put
there first survives the page's own `adLight = false`.

### 2. Drop the timers that do the damage

Some sites carry the same SDK with no gate, and the wall runs on timers. One
timer does the damage, a `setTimeout` that calls `body.remove()`, and it's
scheduled from `eval`'d code. Drop timers scheduled from `eval` and it goes.
Everything after it goes too: no blanking, so no exception, so no dialog, so no
reload loop.

```
before: 4 page loads, 3 confirms, reload loop
after:  1 page load,  0 confirms, alive 40s, content intact
```

### 3. Keep the stylesheets

National World titles ship the real CSS in the page, then delete it:

```js
setInterval(() => i.querySelectorAll('link,style').forEach(e => e.remove()), 100);
const n = await fetch(<loader host>);     // the restore half
```

Strip every 100ms, restore from the vendor's host. Block that host, with a
Pi-hole say, and the restore never arrives. You're left with raw markup: all
the text, none of the layout. The handler's own source is the signature, so
the timer is dropped when it's scheduled and nothing is ever stripped.

### 4. Remove the walls already on screen

Overlay and `<dialog>` walls are matched on their wording ("Ads help keep …",
"please disable the ad blocker") plus their shape: fixed position, big enough,
and short enough to be a wall rather than a page.

Consent-or-pay walls are handled separately. Their signature is the consent
vendor's own container id (`#qc-cmp2-container`, `#onetrust-consent-sdk`,
`[id^="sp_message_container"]`, Didomi, Cookiebot, TrustArc, Usercentrics,
Funding Choices, InMobi, and Microsoft's `#mscmp-banner-container` on
msn.com). No site list needed.

Removing the overlay is only a third of the job.

- **The consent record is refused.** `document.cookie` and `localStorage` drop
  `euconsent-v2`, `addtl_consent`, `OptanonConsent`, `didomi_token` and the
  rest. A consent you never gave is never stored and never replayed.
- **The consent API is answered "no".** Where a TCF consent framework exists,
  `__tcfapi` gets every purpose, special feature and vendor denied, and an
  empty consent string. Silence isn't refusal. Some publishers block rendering
  until the API replies, and a vendor that gets no answer can treat the
  question as never asked. This gives the answer you'd give by hand, straight
  away, with no modal.
- **The vendor's own refusal button is pressed first.** Remove the banner and
  the question is still unanswered, so it's back on the next load. A recorded
  refusal stops it. The pattern only matches refusals: "Reject All",
  "Decline", "Only essential", "Continue without accepting". A test fails the
  build if it ever matches "I Accept", "Accept All" or "Agree and close".
  Removal is the fallback when there's no refusal button.
- **Only what's on screen is removed.** A dormant container is left alone.
  euronews keeps a `#didomi-host` at zero height that isn't a wall, and tearing
  it out would break the page for no gain.

### 5. Social furniture

`social.js` handles the share and follow clutter for Facebook, Instagram, X,
TikTok, LinkedIn and Snapchat. It isn't a wall, but it's the other thing on
the page that's there for someone other than the reader.

It works in two passes:

- **Mark.** Any link to one of those platforms gets
  `href="http://localhost/removeme"`, plus `rel="noreferrer noopener"` and no
  `target`. The path is the point: one selector shows everything the extension
  is about to act on, and the link already goes nowhere. The original URL is
  kept in `data-ktp-was`, so nothing is destroyed. If a framework re-renders
  the link with the real address, it gets marked again on the next sweep.
- **Dispose.** The second pass only touches what carries the marker. Links
  that are furniture (an icon with no text, "Share on X", "Follow us",
  anything in a container whose class, id or `aria-label` says
  share/social/follow) are deleted, with up to two levels of now-empty
  wrapper. Everything else that's marked is hidden by a stylesheet rule on
  that exact address.

That's why the marker exists. **Mark only** stops after the first pass, so the
page is unchanged and you can inspect every target.

Three traps, each a real bug in the naive version:

| Trap | What it would break | What's done instead |
|---|---|---|
| `a[href*="x.com"]` | matches netflix.com, linux.com, phoenix.com | addresses are parsed to a hostname and compared as whole labels |
| deleting every social link | "Continue with Facebook" disappears and people are locked out | login, OAuth, legal and developer URLs are left alone |
| deleting a link inside a sentence | the words go with it | hiding is the default; "Keep article text" unwraps instead |

Hiding a link inside a sentence takes its words too: "follow us on Facebook, X
and Instagram" reads "follow us on , and .". I saw that and chose hiding
anyway. **Keep article text** unwraps those links instead: link gone, words
kept.

Both passes walk open shadow roots as well as the document. On msn.com that's
the difference between finding 1 link and finding 74, because its Facebook and
X tiles live inside web components that a document-level query never sees. The
hide rule goes into each shadow root for the same reason: a stylesheet in the
document doesn't cross into one.

Embedded posts, a quoted tweet or TikTok in an article, are content, not
furniture, and stay put. The platforms' own sites are excluded in the
manifest, so visiting facebook.com doesn't strip facebook.com.

## The anti-adblock malware, and who makes it

None of this is anonymous code. Each mechanism above belongs to a named
commercial vendor, and the publisher chose to deploy it. Every signature,
hostname and code fragment below was read off a live page, not taken from
documentation, because none of these products document how they work.

### Why I call it malware

It's a description of what the code does, not a legal finding (my view on the
Computer Misuse Act is below). The anti-adblock payloads meet the ordinary
definition on four counts, each seen directly and each documented below:

1. **It runs without consent and against your interest.** Nobody asked for it,
   and its job is to take away content you already have.
2. **It destroys your copy of data already delivered to you.** The article and
   its stylesheets arrive intact, then code in the page deletes them.
3. **It's obfuscated to resist analysis.** Scrambled string tables and `eval`,
   not just minification.
4. **It dodges blocking and hits back at interference.** CNAME cloaking to get
   past DNS blocklists, and anti-tamper checks that escalate to a modal dialog
   or a reload loop when its writes are guarded.

The consent-or-pay walls in the table are a separate category. Intrusive, and
arguably coercive, but they don't destroy delivered content or hide from
blocklists. The word doesn't cover them.

| Vendor | Signature | What its code does to the page |
|---|---|---|
| **AdShield** — *malware* | `data-sdk="l/1.2.10"`, `wp-l/1.1.11`, `l/1.1.21`; loaders on `html-load.com`, `content-loader.com`, `error-report.com` | Deletes `<body>`, or every `<link>` and `<style>`, after the article has been delivered |
| **Sourcepoint** — *malware behaviours* | `/unified/wrapperMessagingWithoutDetection.js`; `cdn-52-x.privacy-mgmt.com` | Message wall; CNAME-cloaked, checks its own DOM writes and raises a dialog when they fail |
| **Quantcast Choice** (served by **InMobi**) | `cmp.inmobi.com/choice/…/choice.js`; `#qc-cmp2-container` | "Accept tracking or pay" modal over the article, no free reject |
| **OneTrust** | `#onetrust-consent-sdk`, `cookielaw.org` | Consent overlay (no wall seen on the sites tested) |
| Didomi, Cookiebot, TrustArc, Usercentrics, Google Funding Choices | vendor container ids | Consent overlays, removed only when actually on screen |

Publishers seen deploying these: Newsquest (269 titles), Reach plc, National
World, News Corp, notebookcheck.net.

### The Computer Misuse Act 1990

My view is that this code breaks the Computer Misuse Act 1990.

[Section 3](https://www.legislation.gov.uk/ukpga/1990/18/section/3) makes it
an offence to do something to a computer you know you have no authority to
do, where you mean to impair it, stop someone getting at data held on it, or
make that data unreliable. Being reckless about it counts too.

Look at what the code does. It runs on your computer, not theirs. Nobody asked
you. The article has already arrived intact, then it deletes the `<body>` or
every stylesheet. On some sites it freezes the tab with a `confirm()` popup,
or reloads the page on a loop.

Does it matter that a reload brings the article back? No. Section 3(5)(c) says
doing it temporarily still counts.

As such this extension stops that code running, or takes its elements out, and
the page you were sent stays on your screen.

If a publisher wants to gate content, fine. Do it on your own server and don't
send the article to people who haven't paid. That touches nowt on my computer
and I've no argument with it. The paywalls on thetimes.com and theverge.com
are left alone on purpose. What I object to is sending me the article, then
running code on my machine to delete it.

Worth knowing who writes this code. Every vendor whose code I'm calling out
here is based outside the United Kingdom: AdShield is reported to be South
Korean, Sourcepoint is in New York (see [Where these vendors are
based](#where-these-vendors-are-based)). The publishers who put it on their
pages are British, and so are the readers whose computers it runs on.

I'm not a lawyer and no court has ruled on this. The publishers would say that
visiting their site authorises whatever scripts they serve. It's my argument,
not legal advice.

### Where these vendors are based

| Vendor | Origin / HQ | Notes |
|---|---|---|
| **AdShield** | South Korea *(reported, the least certain entry here)* | Circumvention service behind `html-load.com` / `content-loader.com` / `error-report.com`. The attribution comes from ad-blocking community research, not from anything the product discloses. |
| **Sourcepoint** | United States, New York | Consent and ad-recovery vendor; `privacy-mgmt.com`. |
| **Quantcast** | United States, San Francisco | Wrote the Choice consent platform. |
| **InMobi** | India, Bengaluru | Now runs Quantcast Choice; the wall on Reach titles is served from `cmp.inmobi.com`. |
| **OneTrust** | United States, Atlanta | UK roots, US headquarters. |
| **Didomi** | France, Paris | |
| **Cookiebot** (Cybot A/S) | Denmark, Copenhagen | Bought by Usercentrics. |
| **Usercentrics** | Germany, Munich | |
| **TrustArc** | United States, San Francisco | Was TRUSTe. |
| **Google Funding Choices** | United States, Mountain View | |

Two caveats before you quote any of this.

The hostnames and behaviours here were seen directly; the countries weren't.
Signatures, CNAME chains and code fragments came off live pages. Company
locations are background knowledge, and ownership in this industry moves a
lot. Quantcast Choice went to InMobi and Cookiebot to Usercentrics, both after
the products shipped under their original names.

Where the servers are isn't where the vendor is. AdShield's fallback resolves
to `adshield-fallback-dev-wskxz.b-cdn.net`, which is BunnyCDN, a Slovenian CDN.
That tells you where a cache node sits, not who wrote the code. Same with the
CNAME-cloaked subdomains: they point into vendor infrastructure, which tells
you who's being contacted, not where they're registered.

### The evidence

Three behaviours put this in a different category from serving an advert.

**It destroys content already delivered to you.** The server sends the whole
article, 68KB of real CSS and the full text, then JavaScript in the page takes
it away. The National World stripper runs every 100ms, forever:

```js
setInterval(() => i.querySelectorAll('link,style').forEach(e => e.remove()), 100);
```

The restore half fetches from the vendor's own host. Block that host and the
strip still runs, so the page stays unstyled for good. The publisher's own CSS
was made to depend on the ad vendor being reachable.

**It's obfuscated to resist reading.** String tables are scrambled, not just
minified, so there's nothing to grep for:

```js
o[293 * (r + 450) % e]        // Newsquest
d += t[(o + e.e) * e.v % r]   // notebookcheck
```

The payloads then run through `eval`, which is why one of the defences here
looks at where a timer was scheduled from, not what's in it.

That's what malware does. Minifying code makes it smaller; scrambling it so
nobody can read what it does has one purpose, and it's hiding. Honest code
running on your computer has no reason to stop you reading it. Code that
deletes what you were sent, and goes out of its way to stop you seeing how,
is why I class this as malware.

**It hides from network blocklists with CNAME cloaking.** The loader comes
from what looks like the publisher's own subdomain, which resolves to the
vendor:

```
a02342.<publisher-domain>   ->  cdn-52-x.privacy-mgmt.com      (Sourcepoint)
fb.html-load.com            ->  adshield-fallback-dev-wskxz.b-cdn.net
```

The subdomain is randomised per title, which is why the network rule for it
matches a script path, not a host.

**And it treats interference as proof of an ad blocker.** AdShield's decoded
error strings are literally `Vital API blocked` and `Vital API blocked (eval)`.
Sourcepoint's loader re-reads its own write and throws if it doesn't match:

```js
z.call(O,'src',G), O[x]('src') !== G && throw E
… catch (W) { try { await l(W) } catch (x) { o(W) } }   // o() raises the dialog
```

That check is why this extension never fights a wall that's already running.
Guarding `setAttribute` was tried early on and *caused* the popup it was meant
to remove. Every fix that works here stops the wall starting instead.

### The consent walls

The Quantcast/InMobi wall on Reach titles gives you two choices: accept, or
pay £2.99 a month. There's no free reject. Accepting shares your data with
**1,467 listed partners** and stores a `euconsent-v2` cookie for 13 months.

This extension removes the overlay and refuses to store the consent record, so
a consent you never gave is never written and never replayed. That was my
choice, made deliberately, not a neutral default. AGENTS.md has how it was
decided.

### MSN and Bing

`portal.js` has four switches, all on by default: comment links; the non-news
cards (weather, finance, sports, games, and the Booking / Temu / eBay lead-gen
tiles); the section tabs beside Discover; and the whole feed, Discover and
every card in it. With that last one on, the homepage is the logo, the search
box and the quick links. It's homepage only, so an article page keeps its
content.

MSN's own Content settings do remove the weather, finance and sports cards.
But the setting is held on Microsoft's servers against your anonymous MUID,
not in a cookie, so it's lost when you clear cookies, in a fresh profile and in
incognito. Three things survive those switches entirely: the Games tile, the
Booking / Temu / eBay advertiser tiles, and comments, which still showed 501
links with MSN's Comments switch off.

Targeting uses MSN's `data-t` component names, which stay stable, not its
class names, which change every build.

## Hiding comments, and UK law

Hiding comments, newsletter boxes and social links only changes what shows on
your own screen. Nothing is taken from the site, nothing on their servers is
touched, nothing is republished. There's no UK law that says you have to look
at every bit of a page you're sent, any more than you have to read the letters
page in a newspaper. Ad blockers, reader modes and accessibility tools all
stand on the same ground.

The Online Safety Act 2023 goes the same way.
[Section 15](https://www.legislation.gov.uk/ukpga/2023/50/section/15), the
user empowerment duties, makes the biggest platforms (Category 1 services)
give adults tools to see less of certain content, and to filter out users who
haven't verified who they are. That's a duty on the platforms, not a new right
for readers. The direction is clear enough though: the law expects you to be
able to choose what you don't want to see. This extension lets you make that
choice on every site, whether the site gives you the tools or not.

Why remove all comments? Because too many comment sections are full of vile,
hateful and threatening posts that nobody moderates and nobody takes down. A
browser can't tell a well-run section from a neglected one, so I don't try.
The extension assumes every comment section falls short of what the Online
Safety Act expects, and removes the lot. That's a default for your screen, not
a claim about any particular site.

Social media links go for the same reason. A link to Facebook, Instagram, X,
TikTok, LinkedIn or Snapchat drops you straight into a feed full of the same
stuff. Those platforms are covered by the Act, but I can't tell from a browser
whether any of them is meeting its duties either, so the same assumption
applies.

The Act has a gap for comments anyway. Comments under a publisher's own
articles are exempt. A site whose only user content is comments on its own
articles is outside the Act altogether
([Schedule 1, paragraph 4](https://www.legislation.gov.uk/ukpga/2023/50/schedule/1/paragraph/4)),
and on any other site those comments aren't regulated content
([section 55](https://www.legislation.gov.uk/ukpga/2023/50/section/55)). So
no regulator is going to make those sections clean. It's you or nobody.

None of it is forced on you. Every part can be turned off or bypassed in
Settings:

| To do this | Go to |
|---|---|
| Turn comment removal off everywhere | Comments → *Remove comments on all sites* (also lifts the Disqus block) |
| Keep comments on one site, or one part of it | Comments → URL exceptions: `example.com` or `example.com/forum` |
| Turn social link removal off everywhere | Social furniture |
| Keep links to one platform | Social furniture → untick that platform |
| Keep social links on one site | Social furniture → URL exceptions |
| Keep newsletter boxes on one site | Newsletter sign-ups → URL exceptions |
| See what would go without removing anything | Social furniture → *Mark only* |
| Keep sign-in buttons, or links inside article text | Social furniture → Exceptions |

Changes save as you go; reload a page to get back links already taken off it.
Section 15 expects people to be able to change their default settings. Here
you hold the switch, not the platform.

What this doesn't cover: it's only about what your browser shows you, not
copying or redistributing anyone's content. A site's terms of use are a
contract matter between you and them, not criminal law. And same as above,
I'm not a lawyer and this isn't legal advice.

## Permissions

| Permission | Why |
|---|---|
| `declarativeNetRequest` | three small block-only rulesets, below |
| `storage` | settings and the error log |

No `host_permissions`, and no network access to anything. The rules only ever
block:

| Ruleset | Blocks |
|---|---|
| `rules.json` | one script *path*, `/unified/wrapperMessagingWithoutDetection.js`, because the host serving it is a randomised first-party CNAME that's different on every title |
| `widgets-rules.json` | Disqus (`disqus.com`, `disquscdn.com`) everywhere but disqus.com itself. Follows the Comments switch |
| `portal-rules.json` | the two endpoints that feed MSN's and Bing's homepage cards |

Blocking a vendor's *domain* isn't a fix and often makes things worse. These
SDKs treat a failed fetch as proof of an ad blocker, and on some sites the
publisher's own CSS rides on that host. The page-level fixes and network
blocking solve different halves.

## Coverage

Evidence only, never assumed: a mechanism goes on record once it's been seen
on the site. `sweep-results.md` has the measurements, 52 articles across 26
domains, with stylesheet counts and consent-banner timings for each.

| Publisher | Mechanism | Status |
|---|---|---|
| Newsquest (269 titles) | inline wall gated on `adLight` | fixed |
| Reach plc (8 titles checked) | Quantcast Choice consent-or-pay | fixed |
| National World (Scotsman, Yorkshire Post) | AdShield + CSS stripper | fixed |
| notebookcheck.net | AdShield, no gate | fixed |
| pagesix.com | `<dialog>` forced visible by CSS | fixed |
| euronews.com | floating video + widget clutter | fixed |

## Tests

```sh
./test.sh      # 116 tests, ~1s
```

There's no node on this box, so the suite runs on **gjs**. It loads the real
`walls.js` and `guard.js` against a stand-in DOM, so the production patterns
are what's under test. A suite that copied the regexes would pass forever
while production broke. It's mutation-checked: break the thing a test guards
and it goes red.

It covers decision logic only. `looksLikeWall()` and `cmpShowing()` need real
layout, so the browser sweep covers those. **Passing the suite doesn't mean a
page renders.** That's exactly how two sites shipped unstyled while a
text-length check called them healthy.

## Files

```
walls.js      signature-armed defences, all sites   (MAIN world, document_start)
guard.js      what cannot be signature-armed        (MAIN world, document_start)
bridge.js     settings in, errors out               (isolated world)
except.js     URL exceptions matcher, shared by the three below
options.html/.js   settings and error list
social.js     social link rewrite and furniture removal (isolated world)
comments.js   comment section removal, with URL exceptions (isolated world)
newsletter.js newsletter popups and sign-up boxes    (isolated world)
portal-early.js, portal.js   MSN / Bing feed cleanup
popout.js     floating pop-out video removal
clutter.js    third-party widget removal
rules.json    the script-path network rule
widgets-rules.json   Disqus block (switchable)
portal-rules.json    MSN / Bing feed endpoints
bump.sh       version stamper
test.sh, tests/run.js     unit tests
AGENTS.md     working notes, failure log, hard-won rules
sweep-results.md          measured coverage
```

## Credits

Built with Claude (Anthropic). None of these SDKs publish how they work, so
every fix here started from reading obfuscated inline scripts and watching
what the page did to itself.

`AGENTS.md` is the honest record of that: the hard-won rules, and a log of the
approaches that made things *worse* before the one that worked. Guarding
`setAttribute` raised the very dialog it was meant to remove. Answering
`confirm()` with Cancel caused an endless reload loop. Blocking the vendor's
domain was a detection signal, and on some sites it took the publisher's own
CSS with it.

## Licence

MIT, see [LICENSE](LICENSE).

Damien Dye &lt;damien@damiendye.uk&gt;
