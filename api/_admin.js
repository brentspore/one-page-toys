/* The admin page's server side: Google sign-in, the session cookie, and the
 * Google Analytics Data API. Built-in Node only (crypto + fetch): this site has
 * no build step and package.json is not deployed, so there are no packages.
 *
 * Environment (Vercel project settings, never the repo):
 *   GA_PROPERTY_ID     the GA4 property's numeric ID (Admin > Property details)
 *   GA_SERVICE_ACCOUNT the service account's JSON key, pasted whole. Its email
 *                      must be a Viewer on the GA4 property.
 *   GOOGLE_CLIENT_ID   the OAuth web client used by "Sign in with Google"
 *   ADMIN_EMAILS       who may sign in, comma separated
 *   ANTHROPIC_API_KEY  optional: turns on the "What to do next" banner, which
 *                      Claude writes from the same numbers
 * The session cookie is signed with a key derived from the service account's
 * private key, so there is no separate session secret to manage; rotating
 * that key signs everyone out.
 *
 * Files in api/ starting with "_" are libraries, not routes.
 */
"use strict";

const crypto = require("crypto");

const COOKIE = "opt_admin";
const SESSION_DAYS = 7;

// Demo data for local development only. It can never switch on in a Vercel
// deployment (VERCEL is set in every one of them).
const DEMO = process.env.ADMIN_DEMO === "1" && !process.env.VERCEL;

function env() {
  let sa = null;
  try { sa = JSON.parse(process.env.GA_SERVICE_ACCOUNT || "null"); } catch (e) { sa = null; }
  return {
    propertyId: (process.env.GA_PROPERTY_ID || "").trim(),
    sa,
    clientId: (process.env.GOOGLE_CLIENT_ID || "").trim(),
    admins: (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
  };
}

function missing() {
  const e = env(), out = [];
  if (!e.propertyId) out.push("GA_PROPERTY_ID");
  if (!e.sa || !e.sa.client_email || !e.sa.private_key) out.push("GA_SERVICE_ACCOUNT");
  if (!e.clientId) out.push("GOOGLE_CLIENT_ID");
  if (!e.admins.length) out.push("ADMIN_EMAILS");
  return DEMO ? [] : out;
}

/* ------------------------------------------------------------ helpers */

function b64url(buf) { return Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_"); }
function unb64url(s) { return Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64"); }

/* ------------------------------------------------------------ session */

function sessionKey() {
  const e = env();
  const seed = DEMO ? "demo-only-session-key" : (e.sa && e.sa.private_key) || "";
  return crypto.createHash("sha256").update("opt-admin-session:" + seed).digest();
}

function makeSession(email) {
  const payload = b64url(JSON.stringify({ e: email, x: Date.now() + SESSION_DAYS * 864e5 }));
  const sig = b64url(crypto.createHmac("sha256", sessionKey()).update(payload).digest());
  return payload + "." + sig;
}

function readSession(req) {
  const raw = String(req.headers.cookie || "").split(/;\s*/).find((c) => c.startsWith(COOKIE + "="));
  if (!raw) return null;
  const [payload, sig] = raw.slice(COOKIE.length + 1).split(".");
  if (!payload || !sig) return null;
  const want = crypto.createHmac("sha256", sessionKey()).update(payload).digest();
  const got = unb64url(sig);
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  let data;
  try { data = JSON.parse(unb64url(payload).toString("utf8")); } catch (e) { return null; }
  if (!data || typeof data.x !== "number" || data.x < Date.now()) return null;
  // still on the list? removing someone from ADMIN_EMAILS locks them out at once
  if (!DEMO && !env().admins.includes(String(data.e).toLowerCase())) return null;
  return { email: data.e };
}

function sessionCookie(value, maxAge) {
  return `${COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${DEMO ? "" : "; Secure"}`;
}

/* ------------------------------------------- Google ID token (sign-in) */

let jwks = null, jwksAt = 0;
async function googleKeys() {
  if (jwks && Date.now() - jwksAt < 3600e3) return jwks;
  const r = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  if (!r.ok) throw new Error("could not fetch Google's signing keys");
  jwks = (await r.json()).keys || [];
  jwksAt = Date.now();
  return jwks;
}

// verify a "Sign in with Google" credential and return its email, or throw
async function verifyGoogleToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const header = JSON.parse(unb64url(parts[0]).toString("utf8"));
  const claims = JSON.parse(unb64url(parts[1]).toString("utf8"));
  if (header.alg !== "RS256") throw new Error("unexpected algorithm");
  let jwk = (await googleKeys()).find((k) => k.kid === header.kid);
  if (!jwk) { jwks = null; jwk = (await googleKeys()).find((k) => k.kid === header.kid); }
  if (!jwk) throw new Error("unknown signing key");
  const key = crypto.createPublicKey({ key: jwk, format: "jwk" });
  const ok = crypto.verify("RSA-SHA256", Buffer.from(parts[0] + "." + parts[1]), key, unb64url(parts[2]));
  if (!ok) throw new Error("bad signature");
  const e = env(), now = Date.now() / 1000;
  if (claims.iss !== "accounts.google.com" && claims.iss !== "https://accounts.google.com") throw new Error("wrong issuer");
  if (claims.aud !== e.clientId) throw new Error("token is for another app");
  if (!(claims.exp > now - 30)) throw new Error("token expired");
  if (claims.email_verified !== true && claims.email_verified !== "true") throw new Error("email not verified");
  return String(claims.email).toLowerCase();
}

/* -------------------------------------------- Google Analytics Data API */

let token = null, tokenExp = 0;
async function gaToken() {
  if (token && Date.now() < tokenExp - 60e3) return token;
  const { sa } = env(), now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600
  }));
  const sig = b64url(crypto.createSign("RSA-SHA256").update(head + "." + body).sign(sa.private_key));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + head + "." + body + "." + sig
  });
  const j = await r.json();
  if (!r.ok) throw new Error("Google refused the service account: " + (j.error_description || j.error || r.status));
  token = j.access_token;
  tokenExp = Date.now() + (j.expires_in || 3600) * 1000;
  return token;
}

async function ga(method, body) {
  const { propertyId } = env();
  const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:${method}`, {
    method: "POST",
    headers: { authorization: "Bearer " + (await gaToken()), "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const j = await r.json();
  if (!r.ok) throw new Error("Analytics: " + ((j.error && j.error.message) || r.status));
  return j;
}

// rows as plain objects keyed by dimension and metric name
function rows(report) {
  const dims = (report.dimensionHeaders || []).map((h) => h.name);
  const mets = (report.metricHeaders || []).map((h) => h.name);
  return (report.rows || []).map((r) => {
    const o = {};
    (r.dimensionValues || []).forEach((v, k) => { o[dims[k]] = v.value; });
    (r.metricValues || []).forEach((v, k) => { o[mets[k]] = Number(v.value); });
    return o;
  });
}

// "/toys/jettison/index.html" and "/toys/jettison" are the same page
function normPath(p) {
  p = String(p || "/").replace(/index\.html$/, "");
  if (!p.endsWith("/")) p += "/";
  return p;
}

// "Right now" from the realtime report. With nobody on the site Google sends
// a total with no values in it, which once took the whole dashboard down; the
// live count is a nicety, so it can only ever come back empty, never throw.
function liveNow(rt) {
  if (!rt) return null;
  try {
    const top = rows(rt).map((r) => ({ name: r.unifiedScreenName, value: r.activeUsers || 0 }));
    const t = rt.totals && rt.totals[0] && rt.totals[0].metricValues && rt.totals[0].metricValues[0];
    return { active: t ? Number(t.value) || 0 : top.reduce((s, r) => s + r.value, 0), top };
  } catch (e) { return null; }
}

const cache = new Map();

async function stats(days) {
  const hit = cache.get(days);
  if (hit && Date.now() - hit.t < 5 * 60e3) return hit.data;
  const cur = { startDate: days + "daysAgo", endDate: "today", name: "cur" };
  const prev = { startDate: (2 * days) + "daysAgo", endDate: (days + 1) + "daysAgo", name: "prev" };
  const [a, b, rt] = await Promise.all([
    ga("batchRunReports", { requests: [
      { dateRanges: [cur, prev], dimensions: [{ name: "pagePath" }], metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }, { name: "userEngagementDuration" }], limit: 2000 },
      { dateRanges: [cur], dimensions: [{ name: "pagePath" }, { name: "eventName" }], metrics: [{ name: "eventCount" }], limit: 5000,
        dimensionFilter: { filter: { fieldName: "eventName", inListFilter: { values: ["toy_play", "share"] } } } },
      { dateRanges: [cur], dimensions: [{ name: "date" }], metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }], orderBys: [{ dimension: { dimensionName: "date" } }], limit: 400 },
      { dateRanges: [cur, prev], metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }] },
      { dateRanges: [cur], dimensions: [{ name: "sessionSource" }], metrics: [{ name: "sessions" }], orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: 8 }
    ] }),
    ga("batchRunReports", { requests: [
      { dateRanges: [cur], dimensions: [{ name: "deviceCategory" }], metrics: [{ name: "activeUsers" }], orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }] },
      { dateRanges: [cur], dimensions: [{ name: "country" }], metrics: [{ name: "activeUsers" }], orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }], limit: 8 }
    ] }),
    ga("runRealtimeReport", { dimensions: [{ name: "unifiedScreenName" }], metrics: [{ name: "activeUsers" }], limit: 6, metricAggregations: ["TOTAL"] })
      .catch(() => null)
  ]);
  const [pages, events, daily, totals, sources] = a.reports;
  const [devices, countries] = b.reports;

  const byPath = {};
  const at = (p) => (byPath[p] = byPath[p] || { opens: 0, prevOpens: 0, users: 0, time: 0, plays: 0, shares: 0 });
  rows(pages).forEach((r) => {
    const o = at(normPath(r.pagePath));
    if (r.dateRange === "prev") o.prevOpens += r.screenPageViews;
    else { o.opens += r.screenPageViews; o.users += r.activeUsers; o.time += r.userEngagementDuration; }
  });
  rows(events).forEach((r) => {
    const o = at(normPath(r.pagePath));
    if (r.eventName === "toy_play") o.plays += r.eventCount; else o.shares += r.eventCount;
  });
  const tot = rows(totals);
  const T = (name) => tot.find((r) => r.dateRange === name) || {};
  const data = {
    days, generated: new Date().toISOString(),
    totals: { visitors: T("cur").activeUsers || 0, prevVisitors: T("prev").activeUsers || 0, views: T("cur").screenPageViews || 0, prevViews: T("prev").screenPageViews || 0 },
    daily: rows(daily).map((r) => ({ date: r.date, visitors: r.activeUsers, views: r.screenPageViews })),
    pages: byPath,
    sources: rows(sources).map((r) => ({ name: r.sessionSource, value: r.sessions })),
    devices: rows(devices).map((r) => ({ name: r.deviceCategory, value: r.activeUsers })),
    countries: rows(countries).map((r) => ({ name: r.country, value: r.activeUsers })),
    now: liveNow(rt)
  };
  cache.set(days, { t: Date.now(), data });
  return data;
}

/* --------------------------------------- "What to do next" (Claude writes it) */

// One call per range, cached six hours, made only when the signed-in owner
// looks: the cost follows admin visits, never the site's traffic. A requested
// rewrite still waits a minute between calls.
const ADVICE_MODEL = "claude-opus-5-5";
const ADVICE_TTL = 6 * 3600e3, ADVICE_GAP = 60e3;
// the day the shared play tracker went live and the hub's click event stopped
// posing as a traffic source (admin/admin.js carries the same date)
const FIXED_ON = "2026-10-03";
const HUB_LABELS = ["gallery", "home_featured", "all_toys_newest", "surprise_me"];

function adviceReady() { return !!(process.env.ANTHROPIC_API_KEY || "").trim(); }

let registry = null;
async function loadRegistry() {
  if (registry) return registry;
  const fs = require("fs"), path = require("path");
  for (const p of [path.join(__dirname, "..", "tools-registry.json"), path.join(process.cwd(), "tools-registry.json")]) {
    try { registry = JSON.parse(fs.readFileSync(p, "utf8")); return registry; } catch (e) { /* try the next place */ }
  }
  const r = await fetch("https://onepagetoys.com/tools-registry.json");
  if (!r.ok) throw new Error("could not read the toy list");
  registry = await r.json();
  return registry;
}

// the dashboard's numbers, trimmed to what a reader needs
function adviceInput(d, reg) {
  const pages = d.pages || {}, list = (reg || []).filter((t) => t && t.path), n = list.length;
  const toys = list.map((t, i) => {
    const p = pages["/" + String(t.path).replace(/^\//, "")] || {};
    return {
      no: n - i, name: t.name, kind: t.category === "utility" ? "tool" : "toy", category: t.category,
      about: String(t.shortDescription || "").slice(0, 140),
      opens: p.opens || 0, opensBefore: p.prevOpens || 0, visitors: p.users || 0,
      avgSeconds: p.users ? Math.round(p.time / p.users) : 0, plays: p.plays || 0, shares: p.shares || 0
    };
  });
  const end = new Date(d.generated), start = new Date(end - d.days * 864e5);
  const opened = toys.filter((t) => t.opens).sort((a, b) => b.opens - a.opens);
  return {
    range: { days: d.days, from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) },
    totals: d.totals,
    dailyVisitors: (d.daily || []).map((r) => [r.date.slice(0, 4) + "-" + r.date.slice(4, 6) + "-" + r.date.slice(6, 8), r.visitors]),
    toysOpened: opened.slice(0, 60),
    moreToysOpenedButNotListed: Math.max(0, opened.length - 60),
    toysNotOpened: toys.filter((t) => !t.opens).map((t) => t.name),
    newestToys: toys.slice(0, 8).map((t) => "No. " + t.no + " " + t.name),
    sources: (d.sources || []).map((s) => ({ name: String(s.name).slice(0, 60), sessions: s.value })),
    devices: d.devices || [], countries: d.countries || [],
    hubPages: { home: (pages["/"] || {}).opens || 0, allToys: (pages["/all-toys/"] || {}).opens || 0 }
  };
}

function advicePrompt(input) {
  const before = input.range.from < FIXED_ON;
  return `You advise the owner of One Page Toys (onepagetoys.com) on what to do next, from the site's Google Analytics numbers.

About the site:
- ${input.toysOpened.length + input.moreToysOpenedButNotListed + input.toysNotOpened.length} free toys and games, each a single self-contained page that opens in a new tab, numbered in launch order ("no": higher is newer). The owner is a designer who ships a new one every day or two.
- The point is delight. A secondary goal is passive traffic to the owner's sister sites (daily games on their own domains, reached through practice editions here). It is deliberately not monetized: never suggest ads, affiliate links, sales prompts, paywalls, sign-ups or email capture.
- People mostly find toys through shares and word of mouth, not search (each page carries little text).
- The owner's real levers: what to build next (more of what works), which toy to feature on the home page (it rotates featured key art), polishing or fixing a toy people leave quickly, phone play, share features, posting a toy where its audience gathers, and cross-promotion between the sites.

How to read the numbers:
- opens = page views of a toy; visitors = unique visitors; avgSeconds = engaged time per visitor; plays = visitors who actually touched, clicked or typed on the toy; shares = share links tapped.
- Plays were only recorded from ${FIXED_ON}.${before ? " This range starts earlier, so plays and play rates are near zero for reasons that have nothing to do with the toys. Ignore them." : ""}
- opensBefore covers the same length of time just before this range. 0 usually means the toy did not exist yet, not that it grew from nothing.
- The owner play-tests the newest toys and those visits are counted, so the newest toys' numbers are inflated by that testing. Weigh it.
- Sources named ${HUB_LABELS.join(", ")} are clicks inside the site's own hub that were mislabeled as traffic sources before ${FIXED_ON}. They are internal navigation, not outside traffic. "(direct)" means no referrer and "(not set)" is unknown.
- Counts under about 10 are noise. A long average time on a toy with a handful of visitors is one person, not a trend.

What to write:
- 3 recommendations (2 if the data is thin), most useful first. Each is a specific action the owner can take this week, tied to the numbers that justify it. Name the toys.
- headline: the action, under 9 words. detail: one or two plain sentences that cite the numbers.
- Write like a sharp friend, not a consultant: plain words, no jargon ("engagement", "funnel", "leverage", "optimize"), no hype, no em dashes, American spelling.
- Do not suggest fixing the data problems above; the owner knows about them. Do not recommend anything the numbers cannot support.`;
}

async function askClaude(input) {
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 50e3);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ctrl.signal,
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY.trim(), "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: ADVICE_MODEL, max_tokens: 1200, system: advicePrompt(input),
        messages: [{ role: "user", content: "The numbers for the last " + input.range.days + " days:\n" + JSON.stringify(input) }],
        tools: [{
          name: "recommendations", description: "The recommendations to show at the top of the admin page.",
          input_schema: { type: "object", required: ["items"], properties: { items: { type: "array", minItems: 1, maxItems: 4, items: {
            type: "object", required: ["headline", "detail"],
            properties: { headline: { type: "string" }, detail: { type: "string" } } } } } }
        }],
        tool_choice: { type: "tool", name: "recommendations" }
      })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error("Claude: " + ((j.error && j.error.message) || "error " + r.status));
    const use = (j.content || []).find((c) => c.type === "tool_use");
    const items = (use && use.input && Array.isArray(use.input.items) ? use.input.items : [])
      .map((x) => ({ headline: String(x.headline || "").trim().slice(0, 120), detail: String(x.detail || "").trim().slice(0, 600) }))
      .filter((x) => x.headline);
    if (!items.length) throw new Error("Claude returned no recommendations");
    return items.slice(0, 4);
  } catch (e) {
    if (e.name === "AbortError") throw new Error("Claude took too long. Try again.");
    throw e;
  } finally { clearTimeout(timer); }
}

const adviceCache = new Map(), adviceBusy = new Map();
async function advice(days, fresh) {
  const hit = adviceCache.get(days);
  if (hit && Date.now() - hit.t < (fresh ? ADVICE_GAP : ADVICE_TTL)) return hit.data;
  if (adviceBusy.has(days)) return adviceBusy.get(days);
  const job = (async () => {
    const reg = await loadRegistry();
    const d = DEMO ? demoStats(days, reg) : await stats(days);
    const data = { configured: true, days, generated: new Date().toISOString(), items: await askClaude(adviceInput(d, reg)), demo: DEMO || undefined };
    adviceCache.set(days, { t: Date.now(), data });
    return data;
  })();
  adviceBusy.set(days, job);
  try { return await job; } finally { adviceBusy.delete(days); }
}

// local demo without a key: shows the banner's shape, says so plainly
function demoAdvice(days) {
  return { configured: true, demo: true, days, generated: new Date().toISOString(), items: [
    { headline: "Sample: build more like your top toy", detail: "Sample text for local development. With ANTHROPIC_API_KEY set, Claude reads these numbers and writes real recommendations here." },
    { headline: "Sample: feature the toy people stay with", detail: "Each one names the toys and cites the numbers behind it." },
    { headline: "Sample: fix the one people leave fastest", detail: "They refresh every six hours, or when you press Rewrite." }
  ] };
}

/* ------------------------------------------------------------ demo data */

function demoStats(days, registry) {
  let seed = 42 + days;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const pages = {};
  (registry || []).forEach((t, k) => {
    const pop = Math.pow(rnd(), 2.2) * (k < 6 ? 3 : 1);
    const opens = Math.round(pop * 90 * days / 7 + (rnd() < 0.08 ? 0 : 1));
    pages["/" + t.path] = {
      opens, prevOpens: Math.round(opens * (0.6 + rnd() * 0.8)), users: Math.round(opens * 0.8),
      time: Math.round(opens * (25 + rnd() * 160)), plays: Math.round(opens * (0.35 + rnd() * 0.55)), shares: Math.round(opens * rnd() * 0.04)
    };
  });
  pages["/"] = { opens: 400 * days / 7, prevOpens: 350 * days / 7, users: 300 * days / 7, time: 9000 * days / 7, plays: 0, shares: 0 };
  pages["/all-toys/"] = { opens: 160 * days / 7, prevOpens: 170 * days / 7, users: 120 * days / 7, time: 5000 * days / 7, plays: 0, shares: 0 };
  const daily = [];
  for (let d = days; d >= 0; d--) {
    const dt = new Date(Date.now() - d * 864e5), v = Math.round(180 + 60 * Math.sin(d / 3) + rnd() * 70 + (days - d) * 1.5);
    daily.push({ date: dt.toISOString().slice(0, 10).replace(/-/g, ""), visitors: v, views: Math.round(v * 2.6) });
  }
  const visitors = daily.reduce((s, r) => s + r.visitors, 0) * 0.7;
  return {
    days, generated: new Date().toISOString(), demo: true,
    totals: { visitors: Math.round(visitors), prevVisitors: Math.round(visitors * 0.86), views: daily.reduce((s, r) => s + r.views, 0), prevViews: Math.round(daily.reduce((s, r) => s + r.views, 0) * 0.9) },
    daily, pages,
    sources: [["google", 0.41], ["(direct)", 0.27], ["bing", 0.08], ["5secondgame.com", 0.07], ["t.co", 0.05], ["thetrailgame.com", 0.04], ["duckduckgo", 0.03], ["reddit.com", 0.02]].map(([n, f]) => ({ name: n, value: Math.round(visitors * f) })),
    devices: [["mobile", 0.63], ["desktop", 0.33], ["tablet", 0.04]].map(([n, f]) => ({ name: n, value: Math.round(visitors * f) })),
    countries: [["United States", 0.52], ["United Kingdom", 0.09], ["Canada", 0.07], ["India", 0.05], ["Germany", 0.04], ["Australia", 0.04], ["Brazil", 0.03], ["Philippines", 0.02]].map(([n, f]) => ({ name: n, value: Math.round(visitors * f) })),
    now: { active: 7, top: [["Jettison — One Page Toys", 2], ["Meld — One Page Toys", 2], ["One Page Toys", 1], ["Chess — One Page Toys", 1], ["Word Kraven — One Page Toys", 1]].map(([n, v]) => ({ name: n, value: v })) }
  };
}

module.exports = { DEMO, COOKIE, env, missing, makeSession, readSession, sessionCookie, verifyGoogleToken, stats, demoStats, SESSION_DAYS,
  adviceReady, advice, demoAdvice, loadRegistry };
