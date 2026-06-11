#!/usr/bin/env node
// RainCheck refresh pipeline.
//
// Runs daily via GitHub Actions:
//   1. Pull upcoming events + price ranges from the Ticketmaster Discovery API
//      (free key, 5k calls/day) for the configured city.
//   2. Merge into deals/data.json, appending today's floor price to each
//      event's price history.
//   3. Score every event (price vs. genre median, recent drop, urgency).
//   4. Push price-drop alerts to the public ntfy topic.
//   5. Regenerate per-event SEO pages (deals/e/*.html) and sitemap.xml.
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

// ── 1. FETCH ─────────────────────────────────────────────────────────────
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
  const res = await fetch("https://app.ticketmaster.com/discovery/v2/events.json?" + params);
  if (!res.ok) {
    console.error("Ticketmaster API error:", res.status, await res.text().catch(() => ""));
    return [];
  }
  const body = await res.json();
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
      min: price?.min ?? null,
    };
  }).filter(e => e.min != null && e.min > 0 && e.name && e.date);
}

// ── 2. MERGE ─────────────────────────────────────────────────────────────
function merge(fetched) {
  const byId = new Map(data.events.map(e => [e.id, e]));
  for (const f of fetched) {
    let ev = byId.get(f.id);
    if (!ev) {
      ev = { ...f, history: [] };
      delete ev.min;
      data.events.push(ev);
      byId.set(ev.id, ev);
    } else {
      ev.name = f.name; ev.date = f.date; ev.venue = f.venue; ev.genre = f.genre;
      ev.urls = { ...ev.urls, ...f.urls };
    }
    const h = ev.history;
    if (h.length && h[h.length - 1].d === today) h[h.length - 1].min = f.min;
    else h.push({ d: today, min: f.min });
    if (h.length > 90) ev.history = h.slice(-90);
  }
  // prune events that have passed
  const cutoff = new Date(); cutoff.setHours(0, 0, 0, 0);
  data.events = data.events.filter(e => new Date(e.date) >= cutoff);
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
    const min = e.history.at(-1)?.min;
    if (min == null) continue;
    (byGenre[e.genre] ||= []).push(min);
  }
  for (const e of data.events) {
    const min = e.history.at(-1)?.min;
    if (min == null) { e.score = 0; continue; }
    const med = median(byGenre[e.genre] || []);
    // cheaper than genre peers → up to +25
    const rel = med ? Math.max(-1, Math.min(1, (med - min) / med)) : 0;
    // dropped vs. 14-day high → up to +30
    const recent = e.history.slice(-14).map(h => h.min);
    const high = Math.max(...recent);
    const dropPct = high > 0 ? ((high - min) / high) * 100 : 0;
    e.dropPct = Math.round(dropPct);
    // happening soon → up to +10
    const days = Math.max(0, (new Date(e.date) - new Date()) / 86400000);
    const urgency = days < 14 ? (14 - days) / 14 * 10 : 0;
    e.score = Math.max(5, Math.min(99, Math.round(50 + rel * 25 + Math.min(dropPct, 30) + urgency)));
  }
}

// ── 4. ALERTS ────────────────────────────────────────────────────────────
async function pushDrops() {
  const topic = config.ntfy?.topic;
  const threshold = config.ntfy?.dropThresholdPct ?? 10;
  if (!topic) return;
  const drops = data.events.filter(e => {
    const h = e.history;
    if (h.length < 2) return false;
    const prev = h[h.length - 2].min, cur = h[h.length - 1].min;
    return prev > 0 && ((prev - cur) / prev) * 100 >= threshold;
  });
  for (const e of drops.slice(0, 5)) {
    const prev = e.history.at(-2).min, cur = e.history.at(-1).min;
    const pct = Math.round(((prev - cur) / prev) * 100);
    const msg = `${e.name} @ ${e.venue} dropped ${pct}% — now ${config.currency}${cur} (was ${config.currency}${prev}). ${config.siteBase}/e/${slugify(e.name)}-${e.id}.html`;
    if (!NTFY_ENABLE) { console.log("[dry-run ntfy]", msg); continue; }
    try {
      await fetch("https://ntfy.sh/" + topic, {
        method: "POST", body: msg,
        headers: { Title: "🎟 RainCheck price drop", Priority: "default", Tags: "chart_with_downwards_trend" },
      });
    } catch (err) { console.error("ntfy error", err.message); }
  }
  if (drops.length) console.log(`Alerted ${Math.min(drops.length, 5)} price drop(s).`);
}

// ── 5. RENDER ────────────────────────────────────────────────────────────
function wrap(merchant, url) {
  const t = config.merchants?.[merchant]?.template;
  return t ? t.replace("{url}", encodeURIComponent(url)) : url;
}
function fmtDate(d) {
  return new Date(d).toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "America/Vancouver" });
}
function eventPage(e) {
  const min = e.history.at(-1)?.min;
  const slug = `${slugify(e.name)}-${e.id}`;
  const url = `${config.siteBase}/e/${slug}.html`;
  const buttons = Object.entries(e.urls || {})
    .filter(([, u]) => u)
    .map(([m, u]) => `<a class="buy" href="${esc(wrap(m, u))}" rel="sponsored noopener" target="_blank">Check ${esc(config.merchants?.[m]?.label || m)} →</a>`)
    .join("");
  const rows = e.history.slice(-30).map(h => `<tr><td>${h.d}</td><td>${config.currency}${h.min}</td></tr>`).join("");
  const ld = {
    "@context": "https://schema.org", "@type": "Event",
    name: e.name, startDate: e.date,
    location: { "@type": "Place", name: e.venue, address: { "@type": "PostalAddress", addressLocality: e.city, addressRegion: "BC", addressCountry: "CA" } },
    offers: { "@type": "AggregateOffer", lowPrice: min, priceCurrency: "CAD", url },
  };
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cheapest ${esc(e.name)} tickets — ${esc(e.venue)}, ${fmtDate(e.date)} | ${esc(config.siteName)}</title>
<meta name="description" content="Live floor price for ${esc(e.name)} at ${esc(e.venue)} on ${fmtDate(e.date)}: ${config.currency}${min}. Daily-updated price history and the cheapest place to buy.">
<link rel="canonical" href="${esc(url)}">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<style>body{font-family:-apple-system,system-ui,sans-serif;background:#0e1116;color:#e8eaed;max-width:680px;margin:0 auto;padding:28px 20px;line-height:1.55}
a{color:#5cc8ff}h1{font-size:24px;letter-spacing:-0.5px;margin-bottom:4px}.sub{color:#9aa0a6;font-size:14px;margin-bottom:18px}
.price{font-size:40px;font-weight:700;color:#34d399;margin:14px 0 2px}.lbl{color:#9aa0a6;font-size:12px;text-transform:uppercase;letter-spacing:0.08em}
.buy{display:block;background:#1a73e8;color:#fff;text-decoration:none;text-align:center;padding:13px;border-radius:10px;font-weight:600;margin:10px 0}
table{width:100%;border-collapse:collapse;margin-top:8px;font-size:14px}td{padding:7px 4px;border-bottom:1px solid #2a2f36;color:#bdc1c6}
.note{font-size:12px;color:#9aa0a6;margin-top:24px}.back{font-size:13px}</style></head><body>
<a class="back" href="../index.html">← All Vancouver deals</a>
<h1>${esc(e.name)}</h1>
<div class="sub">${esc(e.venue)} · ${fmtDate(e.date)} · ${esc(e.genre)}</div>
<div class="lbl">Cheapest ticket today</div>
<div class="price">${config.currency}${min}<span style="font-size:15px;color:#9aa0a6"> CAD</span></div>
${e.dropPct > 0 ? `<div style="color:#34d399;font-size:13px;font-weight:600">↓ ${e.dropPct}% below its 14-day high</div>` : ""}
${buttons}
<div class="lbl" style="margin-top:26px">Price history (floor)</div>
<table>${rows}</table>
<p class="note">Prices refresh daily and can change at any time. Some outbound links are affiliate links — purchases may earn this site a commission at no cost to you. Updated ${data.updated}.</p>
</body></html>`;
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
  // remove pages for pruned events
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith(".html") && !slugs.has(f)) fs.unlinkSync(path.join(dir, f));
  }
  const urls = [`${config.siteBase}/index.html`, ...[...slugs].map(s => `${config.siteBase}/e/${s}`)];
  fs.writeFileSync(path.join(ROOT, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(u => `  <url><loc>${esc(u)}</loc><lastmod>${today}</lastmod></url>`).join("\n") + "\n</urlset>\n");
  console.log(`Rendered ${slugs.size} event pages + sitemap.`);
}

// ── MAIN ─────────────────────────────────────────────────────────────────
const fetched = await fetchTicketmaster();
console.log(`Fetched ${fetched.length} events from Ticketmaster.`);
merge(fetched);
score();
data.updated = today;
data.events.sort((a, b) => new Date(a.date) - new Date(b.date));
await pushDrops();
fs.writeFileSync(dataPath, JSON.stringify(data, null, 2) + "\n");
render();
console.log(`Done. ${data.events.length} live events in dataset.`);
