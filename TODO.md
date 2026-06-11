# RainCheck — Weekend Launch Checklist

Everything the machine can't do itself, in priority order, with time estimates.
Total: ~3.5 hours across the weekend. After this, the system runs hands-off
except a 30-minute weekly loop.

---

## Saturday morning — Activation (~90 min)

### 1. Merge & go live (10 min)
- [ ] Merge branch `claude/automated-commission-sales-cdfi84` → `main`
- [ ] Repo **Settings → Pages** → deploy from `main` branch (root)
- [ ] ✅ Check: `https://japodevo.github.io/BeGood/deals/` loads with the event list visible

### 2. Buy the domain (20 min, ~$15/yr) — do this before affiliate applications
Affiliate networks routinely reject `github.io` URLs; a real domain is the gate.
- [ ] Try **raincheck.ca** at a Canadian registrar (Porkbun, Namecheap, or rebel.ca).
      Fallbacks if taken: `raincheckyvr.com`, `raincheckdeals.com`, `getraincheck.ca`
- [ ] DNS: `CNAME` record `www` → `japodevo.github.io`; apex `A` records → GitHub Pages IPs
      (185.199.108.153 / .109 / .110 / .111)
- [ ] Repo **Settings → Pages → Custom domain** → enter domain, enforce HTTPS
- [ ] Edit `deals/config.json`: set `siteBase` to `https://www.yourdomain.ca/deals` and commit
- [ ] ✅ Check: site loads on the new domain with a padlock
- 💡 Long-term: move RainCheck to its own repo so the URL is clean (I can do the
      migration in a session — just ask).

### 3. Ticketmaster API key (5 min)
- [ ] Sign up at **developer.ticketmaster.com** → My Apps → create app → copy *Consumer Key*
- [ ] Repo **Settings → Secrets and variables → Actions** → new secret `TM_API_KEY`
- [ ] **Actions tab → "Refresh RainCheck deals" → Run workflow**
- [ ] ✅ Check: a commit "data: daily price refresh" appears and the event count jumps
      from 12 to 100+

### 4. Affiliate applications (45 min) — the money step
Apply to all four; approval takes days→weeks, so fire them all now.

| Program | Where | Notes |
|---|---|---|
| StubHub (NORAM) | flexoffers.com (or Partnerize) | ~4%/sale, 30-day cookie — best blend of rate + payout speed |
| TickPick | tickpick.com/affiliate-program | 4%, 45-day cookie (payout is slow, ~7 mo) |
| Ticketmaster | impact.com → marketplace → Ticketmaster | up to 5% resale / ~1.5% primary |
| Vivid Seats | impact.com → marketplace → Vivid Seats | 1–2% |

Property description to paste into applications:

> RainCheck (yourdomain.ca) is a Vancouver-focused ticket price tracker. We
> record the cheapest available seat for major local events daily and publish
> per-event price-history pages, deal scores, and free price-drop alerts via
> push, RSS and Telegram. Content is data-driven and updated automatically
> every day. Audience: Vancouver/BC event-goers researching ticket prices
> (search + alert subscribers). Promotion methods: organic SEO, price-drop
> alerts, local community participation. We disclose affiliate relationships
> on every page.

- [ ] When each approval lands: copy the tracking template into
      `deals/config.json → merchants.<name>.template` (`{url}` = encoded deep link;
      examples are in the file) and commit. Every page is instantly monetized.

### 5. Wire up your own monitoring (10 min)
- [ ] Install **ntfy** app → subscribe to `raincheck-yvr` (public alerts) and
      `raincheck-ops-japodevo` (pings you if the daily refresh ever fails)
- [ ] **GoatCounter** (free analytics): sign up at goatcounter.com → paste your
      `https://CODE.goatcounter.com/count` URL into `config.json → analytics.goatcounter`,
      commit. You'll see pageviews + outbound clicks per merchant.

---

## Saturday afternoon — Brand & channels (~45 min)

### 6. OG / social image (10 min)
- [ ] Open the live site, take a clean screenshot of the hero + top cards at
      roughly 1200×630, save as `deals/og.png`, commit
- [ ] ✅ Check: paste the site URL into a Slack/iMessage draft — a rich card shows

### 7. Telegram channel (20 min) — the normie alert channel
- [ ] Create a public Telegram **channel**: "Vancouver Ticket Drops" (@VanTicketDrops or similar)
- [ ] Create a bot via **@BotFather** → copy the bot token
- [ ] Add the bot to the channel as an **admin** (post permission)
- [ ] Repo secrets: `TELEGRAM_BOT_TOKEN` = token, `TELEGRAM_CHAT_ID` = `@yourchannelname`
- [ ] `config.json → telegram.channelUrl` = your t.me invite link, commit
- [ ] ✅ Check: run the workflow manually; drops/new on-sales post to the channel

### 8. Google Search Console (10 min)
- [ ] search.google.com/search-console → add domain property (DNS verification)
- [ ] Submit sitemap: `https://yourdomain.ca/deals/sitemap.xml`

---

## Sunday — Distribution (~60 min)

### 9. Reddit groundwork (20 min)
- [ ] Read r/vancouver self-promotion rules (typically: be a participant, links only
      where relevant; some subs have weekly self-promo threads)
- [ ] Find this week's World Cup match threads. When people ask about prices, answer
      with data. Template (adapt, don't paste):

> Floor price for the Switzerland match was $740 earlier this week, $634 today —
> resale usually dips 24–48h before kickoff for group-stage games. I track the
> floors daily here if it helps: [link only if rules allow / if asked]

- [ ] Bookmark `deals/report.md` — the pipeline regenerates a paste-ready weekly
      deal report every morning. Sunday ritual: post it (or pieces of it) where it's
      welcome — weekly threads, r/whitecapsfc on match weeks, etc.

### 10. Media pitch (20 min) — highest-leverage email of the month
Send to: tips@dailyhive.com, news@vancouverisawesome.com (and any CityNews/Global
reporter covering the World Cup). Template:

> Subject: Data: World Cup ticket floor prices in Vancouver, tracked daily
>
> Hi — I run RainCheck (yourdomain.ca), a small tool that records the cheapest
> resale ticket for Vancouver events every day.
>
> For the World Cup at BC Place it's showing [X]: the floor for the June 24
> Switzerland match is $[634] (was $[XXX] last week), Belgium June 26 is $[421].
> Happy to share the full daily price history for every Vancouver match if
> useful for a story — no strings, it's all public on the tracker page:
> [worldcup.html link]
>
> James

(Fill the bracketed numbers from the live tracker the morning you send it —
the angle "prices are falling/spiking before the match" writes itself.)

### 11. Optional, when you have 15 min
- [ ] Buttondown.email free account → future weekly email digest (ask Claude to wire it)
- [ ] Drop the Telegram channel + tracker link in your own group chats — warm-start
      the subscriber base with people who actually go to games

---

## The ongoing loop (30 min/week, Sunday)
1. Glance at GoatCounter: which merchants get clicks? Reorder `merchants.*.priority`
   so the best earner-per-click is the top green button.
2. Post the auto-generated `deals/report.md` where it's welcome.
3. Check affiliate dashboards once approvals land; first conversions usually show
   within 30 days of real traffic.
4. When one channel works, double down; when Canucks single-game tickets go on
   sale (~September), that's the moment to add a Canucks page and clone the city
   config for Toronto/Seattle.

## Already automated — do not do these by hand
Daily price refresh, deal scoring, price-drop + new-on-sale alerts (ntfy/Telegram/RSS),
per-event SEO pages, World Cup tracker page, weekly report generation, sitemap,
failure alerts to your ops topic.
