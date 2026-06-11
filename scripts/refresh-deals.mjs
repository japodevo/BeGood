#!/usr/bin/env node
// RainCheck refresh pipeline.
//
// Runs daily via GitHub Actions:
//   1. Pull upcoming events (with or without price ranges) from the
//      Ticketmaster Discovery API for the configured city, with retries.
//   2. Merge into deals/data.json — deduping against seeded/marketplace
//      events by date + venue/name similarity — and append today's floor
//      price to each event's history.
//   3. Score every event (price vs. genre median, recent drop, urgency).
//   4. Push price-drop and new-event alerts to the public ntfy topic.
//   5. Regenerate per-event SEO pages, the static event list baked into
//      index.html (so crawlers see content without JS), sitemap.xml, and
//      an RSS feed of drops/new events.
//
// Runs fine with no API key (scores + pages only), so the site never breaks.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "deals");
const config = readJson(path.join(ROOT, "config.json"));
const dataPath = path.join(ROOT, "data.json");
const data = readJson(dataPath);

const TM_KEY = process.env.TM_API_KEY || "";
const NTFY_ENABLE = process.env.NTFY_ENABLE === "1" || process.env.GITHUB_ACTIONS === "true";
const today = isoDate(new Date());

function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }
function isoDate(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function slugify(s) {
  return s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function curMin(e) { return e.history.at(-1)?.min ?? null; }
function pageUrl(e) { return `${config.siteBase}/e/${slugify(e.name)}-${e.id}.html`; }

// ── 1. FETCH (with retry) ────────────────────────────────────────────────
async function fetchTicketmaster() {
  if (!TM_KEY) {
    console.log("TM_API_KEY not set — skipping fetch, rescoring existing data only.");
    return [];
  }
  const end = new Date();
  end.setDate(end.getDate() + (config.lookAheadDays || 150));
  const params = new URLSearchParams({
    apikey: TM_KEY,
    city: config.tmCityQuery,
    stateCode: config.tmStateCode,
    countryCode: config.countryCode,
    classificationName: "music,sports,arts & theatre",
    startDateTime: new Date().toISOString().replace(/\.\d+Z/, "Z"),
    endDateTime: end.toISOString().replace(/\.\d+Z/, "Z"),
    size: "200",
    sort: "date,asc",
  });
  let body = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch("https://app.ticketmaster.com/discovery/v2/events.json?" + params);
      if (res.ok) { body = await res.json(); break; }
      console.error(`Ticketmaster API HTTP ${res.status} (attempt ${attempt}/3)`);
    } catch (err) {
      console.error(`Ticketmaster fetch failed (attempt ${attempt}/3):`, err.message);
    }
    if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 2000));
  }
  if (!body) throw new Error("Ticketmaster API unreachable after 3 attempts");
  const events = body?._embedded?.events || [];
  return events.map(e => {
    const price = (e.priceRanges || []).find(p => p.type === "standard") || (e.priceRanges || [])[0];
    const venue = e._embedded?.venues?.[0];
    const cls = e.classifications?.[0];
    return {
      id: "tm-" + e.id,
      src: "ticketmaster",
      name: e.name,
      date: e.dates?.start?.dateTime || (e.dates?.start?.localDate + "T19:00:00"),
      venue: venue?.name || "",
      city: venue?.city?.name || config.city,
      genre: cls?.genre?.name || cls?.segment?.name || "Event",
      urls: { ticketmaster: e.url || "" },
      min: price?.min ?? null, // events without published prices are kept:
    };                         // their pages still earn SEO + commissions
  }).filter(e => e.name && e.date);
}

// ── 2. MERGE + DEDUPE ────────────────────────────────────────────────────
const STOP = new Set(["national", "football", "team", "stadium", "arena", "tickets", "2026", "with", "tour", "live", "match", "fifa"]);
function tokens(name) {
  return new Set(name.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 4 && !STOP.has(t)));
}
function normVenue(v) {
  return (v || "").toLowerCase().replace(/\b(stadium|arena|theatre|theater|centre|center|place)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
function sameEvent(a, b) {
  if (a.date.slice(0, 10) !== b.date.slice(0, 10)) return false;
  const venueMatch = normVenue(a.venue) && normVenue(a.venue) === normVenue(b.venue);
  const ta = tokens(a.name), tb = tokens(b.name);
  const tokenMatch = [...ta].some(t => tb.has(t));
  return venueMatch ? tokenMatch || ta.size === 0 || tb.size === 0 : tokenMatch;
}
function merge(fetched) {
  const byId = new Map(data.events.map(e => [e.id, e]));
  const added = [];
  for (const f of fetched) {
    let ev = byId.get(f.id) || data.events.find(x => x.id !== f.id && sameEvent(x, f));
    if (!ev) {
      ev = { ...f, history: [] };
      delete ev.min;
      data.events.push(ev);
      byId.set(ev.id, ev);
      added.push(ev);
    } else if (ev.id === f.id) {
      // same TM event: refresh metadata
      ev.name = f.name; ev.date = f.date; ev.venue = f.venue; ev.genre = f.genre;
      ev.urls = { ...ev.urls, ...f.urls };
    } else {
      // matched a seeded/marketplace event: keep its identity, gain TM deep link
      ev.urls = { ...ev.urls, ...f.urls };
    }
    if (f.min != null && f.min > 0) {
      const h = ev.history;
      if (h.length && h[h.length - 1].d === today) h[h.length - 1].min = Math.min(h[h.length - 1].min ?? Infinity, f.min);
      else h.push({ d: today, min: f.min });
      if (h.length > 90) ev.history = h.slice(-90);
    }
  }
  // prune events that have passed
  const cutoff = new Date(); cutoff.setHours(0, 0, 0, 0);
  data.events = data.events.filter(e => new Date(e.date) >= cutoff);
  return added.filter(e => data.events.includes(e));
}

// ── 3. SCORE ─────────────────────────────────────────────────────────────
function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function score() {
  const byGenre = {};
  for (const e of data.events) {
    const min = curMin(e);
    if (min == null) continue;
    (byGenre[e.genre] ||= []).push(min);
  }
  for (const e of data.events) {
    const min = curMin(e);
    if (min == null) { e.score = 30; e.dropPct = 0; continue; }
    const med = median(byGenre[e.genre] || []);
    // cheaper than genre peers → up to +25
    const rel = med ? Math.max(-1, Math.min(1, (med - min) / med)) : 0;
    // dropped vs. 14-day high → up to +30
    const recent = e.history.slice(-14).map(h => h.min).filter(m => m != null);
    const high = recent.length ? Math.max(...recent) : min;
    const dropPct = high > 0 ? ((high - min) / high) * 100 : 0;
    e.dropPct = Math.round(dropPct);
    // happening soon → up to +10
    const days = Math.max(0, (new Date(e.date) - new Date()) / 86400000);
    const urgency = days < 14 ? (14 - days) / 14 * 10 : 0;
    e.score = Math.max(5, Math.min(99, Math.round(50 + rel * 25 + Math.min(dropPct, 30) + urgency)));
  }
}

// ── 4. ALERTS + FEED ─────────────────────────────────────────────────────
async function ntfy(topic, msg, click) {
  if (!topic) return;
  if (!NTFY_ENABLE) { console.log("[dry-run ntfy]", msg); return; }
  try {
    const headers = { Title: "🎟 RainCheck", Priority: "default" };
    if (click) headers.Click = click;
    await fetch("https://ntfy.sh/" + topic, { method: "POST", body: msg, headers });
  } catch (err) { console.error("ntfy error", err.message); }
}
function feedItem(title, link, desc) {
  data.feedItems ||= [];
  data.feedItems.push({ d: today, title, link, desc });
  if (data.feedItems.length > 60) data.feedItems = data.feedItems.slice(-60);
}
async function alerts(added, hadTmDataBefore) {
  const topic = config.ntfy?.topic;
  const threshold = config.ntfy?.dropThresholdPct ?? 10;
  // price drops
  const drops = data.events.filter(e => {
    const h = e.history;
    if (h.length < 2) return false;
    const prev = h[h.length - 2].min, cur = h[h.length - 1].min;
    return prev > 0 && cur != null && ((prev - cur) / prev) * 100 >= threshold;
  });
  for (const e of drops.slice(0, 5)) {
    const prev = e.history.at(-2).min, cur = e.history.at(-1).min;
    const pct = Math.round(((prev - cur) / prev) * 100);
    const msg = `${e.name} @ ${e.venue} dropped ${pct}% — now ${config.currency}${cur} (was ${config.currency}${prev})`;
    await ntfy(topic, msg, pageUrl(e));
    feedItem(`↓ ${pct}%: ${e.name} now ${config.currency}${cur}`, pageUrl(e), `${e.venue}, ${e.date.slice(0, 10)} — floor price dropped from ${config.currency}${prev} to ${config.currency}${cur}.`);
  }
  if (drops.length) console.log(`Alerted ${Math.min(drops.length, 5)} price drop(s).`);
  // new events — skip on first activation run so 200 events don't spam the topic
  if (config.ntfy?.newEventAlerts && hadTmDataBefore && added.length) {
    if (added.length > 5) {
      await ntfy(topic, `${added.length} new ${config.city} events just went on sale — see what's worth grabbing early.`, config.siteBase + "/index.html");
    } else {
      for (const e of added.slice(0, 3)) {
        const min = curMin(e);
        await ntfy(topic, `New on sale: ${e.name} @ ${e.venue}${min != null ? ` from ${config.currency}${min}` : ""}`, pageUrl(e));
      }
    }
    for (const e of added.slice(0, 10)) {
      feedItem(`New: ${e.name} @ ${e.venue}`, pageUrl(e), `On sale now — ${e.date.slice(0, 10)}${curMin(e) != null ? `, from ${config.currency}${curMin(e)}` : ""}.`);
    }
  }
}
function renderFeed() {
  const items = (data.feedItems || []).slice().reverse().map(i =>
    `  <item><title>${esc(i.title)}</title><link>${esc(i.link)}</link><guid isPermaLink="false">${esc(i.d + "|" + i.title)}</guid><pubDate>${new Date(i.d + "T16:00:00Z").toUTCString()}</pubDate><description>${esc(i.desc)}</description></item>`
  ).join("\n");
  fs.writeFileSync(path.join(ROOT, "feed.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${esc(config.siteName)} — ${esc(config.city)} ticket deals</title>
  <link>${esc(config.siteBase)}/index.html</link>
  <atom:link href="${esc(config.siteBase)}/feed.xml" rel="self" type="application/rss+xml"/>
  <description>Price drops and new on-sales for ${esc(config.city)} events, tracked daily.</description>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
</channel>
</rss>
`);
}

// ── 5. RENDER ────────────────────────────────────────────────────────────
function wrap(merchant, url) {
  const t = config.merchants?.[merchant]?.template;
  return t ? t.replace("{url}", encodeURIComponent(url)) : url;
}
function merchantLinks(e) {
  // every merchant gets a button: explicit deep link if known, search link
  // otherwise — ordered by commission priority so the best payer is on top
  return Object.entries(config.merchants || {})
    .sort((a, b) => (a[1].priority ?? 9) - (b[1].priority ?? 9))
    .map(([m, cfg]) => {
      const direct = e.urls?.[m];
      const url = direct || (cfg.search ? cfg.search.replace("{q}", encodeURIComponent(`${e.name} ${e.city}`)) : null);
      return url ? { m, label: cfg.label || m, url: wrap(m, url) } : null;
    })
    .filter(Boolean);
}
function fmtDate(d) {
  return new Date(d).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "America/Vancouver" });
}
function goatTag() {
  const gc = config.analytics?.goatcounter;
  return gc ? `<script data-goatcounter="${esc(gc)}" async src="https://gc.zgo.at/count.js"></script>` : "";
}
function eventPage(e) {
  const min = curMin(e);
  const url = pageUrl(e);
  const buttons = merchantLinks(e).map(l =>
    `<a class="buy" href="${esc(l.url)}" rel="sponsored noopener" target="_blank" data-goatcounter-click="out-${esc(l.m)}">Check ${esc(l.label)} →</a>`).join("");
  const rows = e.history.slice(-30).map(h => `<tr><td>${h.d}</td><td>${config.currency}${h.min}</td></tr>`).join("");
  const ld = {
    "@context": "https://schema.org", "@type": "Event",
    name: e.name, startDate: e.date, eventStatus: "https://schema.org/EventScheduled",
    location: { "@type": "Place", name: e.venue, address: { "@type": "PostalAddress", addressLocality: e.city, addressRegion: "BC", addressCountry: "CA" } },
    ...(min != null ? { offers: { "@type": "AggregateOffer", lowPrice: min, priceCurrency: "CAD", availability: "https://schema.org/InStock", url } } : {}),
  };
  const priceBlock = min != null
    ? `<div class="lbl">Cheapest ticket today</div>
<div class="price">${config.currency}${min}<span style="font-size:15px;color:#9aa0a6"> CAD</span></div>
${e.dropPct > 0 ? `<div style="color:#34d399;font-size:13px;font-weight:600">↓ ${e.dropPct}% below its 14-day high</div>` : ""}`
    : `<div class="lbl">Floor price</div><div class="price" style="font-size:22px;color:#e8eaed">Compare live prices below</div>`;
  const desc = min != null
    ? `Live floor price for ${e.name} at ${e.venue} on ${fmtDate(e.date)}: ${config.currency}${min}. Daily-updated price history and the cheapest place to buy.`
    : `${e.name} at ${e.venue} on ${fmtDate(e.date)} — compare ticket prices across marketplaces.`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cheapest ${esc(e.name)} tickets — ${esc(e.venue)}, ${fmtDate(e.date)} | ${esc(config.siteName)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<link rel="alternate" type="application/rss+xml" title="${esc(config.siteName)} deals feed" href="../feed.xml">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
${goatTag()}
<style>body{font-family:-apple-system,system-ui,sans-serif;background:#0e1116;color:#e8eaed;max-width:680px;margin:0 auto;padding:28px 20px;line-height:1.55}
a{color:#5cc8ff}h1{font-size:24px;letter-spacing:-0.5px;margin-bottom:4px}.sub{color:#9aa0a6;font-size:14px;margin-bottom:18px}
.price{font-size:40px;font-weight:700;color:#34d399;margin:14px 0 2px}.lbl{color:#9aa0a6;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;margin-top:14px}
.buy{display:block;background:#1a73e8;color:#fff;text-decoration:none;text-align:center;padding:13px;border-radius:10px;font-weight:600;margin:10px 0}
.buy:first-of-type{background:#1a9e72}
table{width:100%;border-collapse:collapse;margin-top:8px;font-size:14px}td{padding:7px 4px;border-bottom:1px solid #2a2f36;color:#bdc1c6}
.note{font-size:12px;color:#9aa0a6;margin-top:24px}.back{font-size:13px}</style></head><body>
<a class="back" href="../index.html">← All ${esc(e.city)} deals</a>
<h1>${esc(e.name)}</h1>
<div class="sub">${esc(e.venue)} · ${fmtDate(e.date)} · ${esc(e.genre)}</div>
${priceBlock}
${buttons}
${rows ? `<div class="lbl" style="margin-top:26px">Price history (floor)</div>\n<table>${rows}</table>` : ""}
<p class="note">Prices refresh daily and can change at any time. Some outbound links are affiliate links — purchases may earn this site a commission at no cost to you. Updated ${data.updated}.</p>
</body></html>`;
}
function staticCard(e) {
  const min = curMin(e);
  const slug = `${slugify(e.name)}-${e.id}`;
  const hot = e.score >= 75, good = e.score >= 60 && !hot;
  return `<a class="card" href="e/${slug}.html">
  <div class="row">
    <div><div class="ev-name">${esc(e.name)}</div><div class="ev-meta">${esc(e.venue)} · ${fmtDate(e.date)}</div></div>
    <div class="price-box"><div class="from">from</div><div class="price">${min != null ? config.currency + min : "—"}</div></div>
  </div>
  <div class="badges">${hot ? '<span class="badge hot">🔥 Hot deal</span>' : ""}${good ? '<span class="badge good">Good value</span>' : ""}${e.dropPct > 0 ? `<span class="badge drop">↓ ${e.dropPct}% vs 14-day high</span>` : ""}<span class="badge genre">${esc(e.genre)}</span></div>
</a>`;
}
function bakeIndex() {
  const idx = path.join(ROOT, "index.html");
  let html = fs.readFileSync(idx, "utf8");
  const upcoming = data.events
    .filter(e => new Date(e.date) >= new Date(new Date().toDateString()))
    .sort((a, b) => (b.score || 0) - (a.score || 0));
  const list = upcoming.map(staticCard).join("\n");
  // replacer callbacks: card HTML contains "$" prices that would otherwise be
  // parsed as capture-group references in a replacement string
  html = html.replace(/(<!-- RAINCHECK:LIST -->)[\s\S]*?(<!-- \/RAINCHECK:LIST -->)/, (_, a, b) => `${a}\n${list}\n${b}`);
  html = html.replace(/(<!-- RAINCHECK:UPDATED -->)[\s\S]*?(<!-- \/RAINCHECK:UPDATED -->)/,
    (_, a, b) => `${a}Prices last refreshed ${data.updated} · ${upcoming.length} events tracked${b}`);
  fs.writeFileSync(idx, html);
}
function render() {
  const dir = path.join(ROOT, "e");
  fs.mkdirSync(dir, { recursive: true });
  const slugs = new Set();
  for (const e of data.events) {
    const slug = `${slugify(e.name)}-${e.id}`;
    slugs.add(slug + ".html");
    fs.writeFileSync(path.join(dir, slug + ".html"), eventPage(e));
  }
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith(".html") && !slugs.has(f)) fs.unlinkSync(path.join(dir, f));
  }
  const urls = [`${config.siteBase}/index.html`, ...[...slugs].map(s => `${config.siteBase}/e/${s}`)];
  fs.writeFileSync(path.join(ROOT, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(u => `  <url><loc>${esc(u)}</loc><lastmod>${today}</lastmod></url>`).join("\n") + "\n</urlset>\n");
  bakeIndex();
  renderFeed();
  console.log(`Rendered ${slugs.size} event pages, baked index, sitemap + RSS.`);
}

// ── MAIN ─────────────────────────────────────────────────────────────────
const hadTmDataBefore = data.events.some(e => e.src === "ticketmaster");
const fetched = await fetchTicketmaster();
console.log(`Fetched ${fetched.length} events from Ticketmaster.`);
const added = merge(fetched);
score();
data.updated = today;
data.events.sort((a, b) => new Date(a.date) - new Date(b.date));
await alerts(added, hadTmDataBefore);
fs.writeFileSync(dataPath, JSON.stringify(data, null, 2) + "\n");
render();
console.log(`Done. ${data.events.length} live events in dataset (${added.length} new).`);
