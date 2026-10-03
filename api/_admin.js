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
    now: rt ? { active: rt.totals && rt.totals[0] ? Number(rt.totals[0].metricValues[0].value) : 0, top: rows(rt).map((r) => ({ name: r.unifiedScreenName, value: r.activeUsers })) } : null
  };
  cache.set(days, { t: Date.now(), data });
  return data;
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

module.exports = { DEMO, COOKIE, env, missing, makeSession, readSession, sessionCookie, verifyGoogleToken, stats, demoStats, SESSION_DAYS };
