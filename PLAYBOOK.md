# RainCheck — Commission Revenue Playbook

**The asset:** an automated ticket-deal site for Vancouver (`deals/`) that tracks the
cheapest ticket for every major local event daily, publishes a programmatic SEO page
per event, pushes free price-drop alerts, and routes every purchase through
affiliate-tracked links. Once activated, it runs itself on a daily GitHub Action.

---

## 1. Why this market (the research)

Commission verticals compared, for a solo operator who wants *automation*, not a
content job:

| Vertical | Commission | Can a bot run it? | Verdict |
|---|---|---|---|
| SaaS / AI tools | 20–50%, often recurring | No — needs credible hands-on reviews; saturated with AI spam Google now demotes | Pass |
| Amazon products | 1–4.5%, 24h cookie | Partly — but lowest rates + brutal competition | Pass |
| Travel (hotels) | ~3–4% effective | No — no free price APIs; OTAs own the SERPs | Pass |
| Credit cards (CA) | $50–150/funded card | No — YMYL niche, new sites can't rank | Pass |
| **Event tickets** | **1–5% on $100–400+ orders** | **Yes — free price API, daily volatility = fresh data forever** | **Build** |

What makes tickets uniquely automatable:

- **Free data feed.** Ticketmaster's Discovery API gives events, venues, and price
  ranges for Canada at 5,000 calls/day on a free key — enough to track every city
  in the country hourly, let alone one city daily.
- **The content writes itself.** Prices move every day, so every page is fresh,
  unique, and genuinely useful — exactly what survives Google's thin-affiliate
  purges. We're publishing *data nobody else shows* (floor-price history per
  event), not rewritten reviews.
- **Four marketplaces pay commissions** and all have open enrollment:

| Program | Rate | Cookie | Network |
|---|---|---|---|
| StubHub (NORAM) | ~4% (0.8% MLB) | 30 days | Partnerize / FlexOffers |
| TickPick | 4% | 45 days | affiliate networks (slow payout ~7 mo) |
| Ticketmaster | up to 5% resale, ~1.5% primary | session-based | Impact |
| Vivid Seats | ~1–2% | 30 days | Impact / FlexOffers |

- **The local wedge.** National aggregators chase "Taylor Swift tickets". Nobody
  owns "cheapest Canucks tickets tonight" or "AC/DC BC Place under $150" for
  *Vancouver specifically*. Local long-tail queries are low-competition, high
  intent, and recur every week of every season.
- **The timing is absurd.** The FIFA World Cup is at BC Place **right now**
  (June–July 2026) with floor prices of $323+. A single World Cup order at ~4%
  is **$13–40 commission**. Then AC/DC (Aug), Stapleton (Jul), Weezer (Sep),
  then Canucks season starts in October. Vancouver demand never sleeps.

## 2. Unit economics

Blended assumptions: average order $220 (Vancouver resale skews high), blended
commission 3.5% → **~$7.70/order**. Alert-driven clicks convert far better than
SEO clicks (a price-drop ping is a buying signal, not a browse).

| Stage | Monthly visits | Orders | Commission/mo |
|---|---|---|---|
| Month 1–2 (launch, World Cup spike) | 300–1,000 | 2–8 | $15–60 |
| Month 3–6 (pages indexed, alert base grows) | 2,000–5,000 | 15–40 | $100–300 |
| Scaled (5–10 cities, same pipeline) | 20,000+ | 150+ | $1,000+ |

These are estimates, not promises — but the cost side is the point: **$0/month to
run** (GitHub Pages + Actions + ntfy are all free), so every dollar is margin and
there's no burn while it compounds.

## 3. The machine (what's already built)

```
GitHub Action (daily, 7am Pacific)
  └─ scripts/refresh-deals.mjs
       ├─ Ticketmaster Discovery API → events + floor prices (Vancouver)
       ├─ appends to per-event price history (deals/data.json)
       ├─ scores every event (vs genre peers, vs own 14-day high, urgency)
       ├─ price drop ≥10%? → push to public ntfy topic (raincheck-yvr)
       ├─ regenerates per-event SEO pages (deals/e/*.html, JSON-LD Event schema)
       └─ regenerates sitemap.xml → commits → GitHub Pages redeploys
```

- `deals/index.html` — the deal radar: scored/filtered event list, affiliate-wrapped
  outbound links, alert signup, FTC-compliant disclosure, `rel="sponsored"`.
- Already seeded with six real Vancouver events at real prices (World Cup, AC/DC,
  Stapleton, Bargatze, Don Toliver, Weezer).
- Affiliate links are config-driven (`deals/config.json` → `merchants.*.template`),
  so plain links work today and switch to tracked links the minute you're approved.

## 3b. Hardening pass (gaps found and closed)

| Gap | Risk | Fix shipped |
|---|---|---|
| Index rendered client-side only | Crawlers saw an empty page — fatal for the SEO channel | Event list is now **baked into index.html at build time** (static HTML for bots + no-JS fallback); client JS upgrades it to the interactive version |
| Events without published price ranges were dropped | Lost long-tail pages (many TM events ship no priceRanges) | Kept with "compare live prices" pages — they still earn SEO + commissions, just no history chart |
| One merchant button per fetched event | Single cookie shot per visitor, no commission routing | Every event page now shows **all four marketplaces**, ordered by `priority` in config (highest effective commission first); unknown deep links fall back to auto-generated search links |
| Seed events would duplicate once the TM feed activates | Duplicate pages, split price history | Merge now **dedupes by date + venue/name-token similarity** (unit-tested against World Cup and tour-name variants) |
| Zero analytics | Can't reorder merchants by EPC, can't see what converts | Optional **GoatCounter** (free) — one config line adds pageviews + per-merchant outbound click counts (`data-goatcounter-click`) |
| ntfy-only audience capture | Most people won't install a push app | **RSS feed** (`feed.xml`) of price drops + new on-sales, auto-generated; linked from every page |
| Silent pipeline failure → quietly stale site | Dead site = dead revenue, discovered weeks later | API retries with backoff, workflow concurrency guard + timeout, and a **failure ping to a private ops ntfy topic** |
| New on-sales were invisible | On-sale day is the highest-intent moment in tickets | **New-event alerts** to the public topic (digest if >5, suppressed on first activation run so it doesn't spam 200 events) |
| 6 events seeded | Thin launch surface | **12 real events** incl. three World Cup matches ($323–634 floors) and four Whitecaps games |

> **Start here for launch:** the step-by-step weekend checklist with templates
> lives in [TODO.md](TODO.md). The list below is the condensed version.

## 4. Activation checklist (the only manual hour this needs)

Things that legally require a human (identity, tax, banking):

1. **Enable GitHub Pages** on this repo (Settings → Pages → deploy from main).
   The site goes live at `https://japodevo.github.io/BeGood/deals/`.
2. **Ticketmaster API key** (~2 min, free): developer.ticketmaster.com → create
   app → copy Consumer Key → add as repo secret `TM_API_KEY`. The daily Action
   takes over from there.
3. **Affiliate enrollments** (each ~10 min; approval usually wants a live site —
   which step 1 gives you):
   - Impact (impact.com) → apply to **Ticketmaster** and **Vivid Seats**
   - FlexOffers or Partnerize → apply to **StubHub NORAM**
   - **TickPick** affiliate program (via its site / network listing)
4. **Paste tracking templates** into `deals/config.json` (`{url}` = encoded deep
   link — examples in the file). Commit. Done — every link on every page is now
   monetized.
5. **Google Search Console**: verify the site, submit `deals/sitemap.xml`.
6. **Custom domain — treat as near-required** (e.g. raincheck.ca, ~$15/yr):
   affiliate networks routinely reject `github.io` subpaths and approve real
   domains. Update `siteBase` in config after pointing it at Pages.
7. **GoatCounter** (free, ~3 min): sign up at goatcounter.com, paste your
   count URL into `analytics.goatcounter` in config — you get pageviews and
   per-merchant outbound click counts with no cookie banner needed.
8. **Subscribe to the ops topic** (`ntfy.opsTopic` in config) in your ntfy
   app — you'll be pinged if a daily refresh ever fails.

## 5. Growth levers (in order of ROI)

1. **Ride the World Cup wave now** — three matches are already tracked (June 13,
   Switzerland June 24 at a $634 floor, Belgium June 26 at $421). At ~4%, one
   referred order from these pages is **$13–25+**. One helpful comment with the
   live floor-price page where people are already asking (r/vancouver match
   threads) is distribution; do it as a fan, not a spammer.
1b. **Optimize merchant order with data** — once GoatCounter shows real clicks
   per merchant and Impact/Partnerize show conversions, reorder `priority` in
   config so the best earner-per-click gets the top (green) button. This is the
   single cheapest profit lever in the whole system.
2. **Grow the alert topic** — every ntfy subscriber is a recurring, zero-cost,
   high-intent channel you own. Put the topic name everywhere the site is shared.
3. **Clone cities** — the pipeline is config-driven. Toronto, Calgary, Seattle are
   each one `config.json` away. Ten cities ≈ ten times the long-tail surface with
   zero extra maintenance.
4. **Canucks season (October)** — add a "tonight's game floor price" page; "cheap
   Canucks tickets" is the single best recurring query in this market.

## 6. Honest risks

- **Affiliate approval lag** — some networks take days–weeks; links earn nothing
  until then (they still work as plain links).
- **Payout timing** — TickPick pays ~7 months after the sale; StubHub/Impact are
  faster (30–60 days). First cash lands slower than first commissions accrue.
- **API ToS** — Ticketmaster's free tier requires fair use and proper attribution;
  the refresh script stays well inside the 5k/day quota.
- **No guarantees** — traffic estimates are scenarios. What's certain is the cost
  to find out: $0/month and an hour of signups.

## Research sources

- Ticket affiliate rates: [Commission Academy — event ticket programs](https://commission.academy/blog/best-event-ticket-affiliate-programs/), [Partnerize — StubHub program](https://partnerize.com/resources/blog/stubhub-affiliate-program-spotlight-and-sign-up-information), [FlexOffers — StubHub NORAM](https://www.flexoffers.com/affiliate-programs/stubhub-noram-affiliate-program/), [Lasso — StubHub](https://getlasso.co/affiliate/stubhub/), [Lasso — Vivid Seats](https://getlasso.co/affiliate/vivid-seats/), [LinkClicky — Ticketmaster](https://linkclicky.com/affiliate-program/ticketmaster/), [UpPromote — event ticket programs](https://uppromote.com/affiliate-programs/event-ticket/)
- Data feed: [Ticketmaster Discovery API docs](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/), [getting started / quotas](https://developer.ticketmaster.com/products-and-docs/apis/getting-started/)
- Vertical comparison: [Shopify — 50 best affiliate programs](https://www.shopify.com/blog/best-affiliate-programs), [ReferralCandy — commission rates by industry](https://www.referralcandy.com/blog/affiliate-commission-rates), [Publift — highest paying niches](https://www.publift.com/blog/highest-paying-affiliate-niches)
