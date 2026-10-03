// node scripts/test-admin.cjs
// Offline tests of the admin endpoint's production paths: Google token checks, the session
// cookie, the service-account JWT, report parsing and the Claude recommendations call. Google is faked with a
// locally generated key; fetch is mocked.
const crypto = require("crypto"), path = require("path");
const ROOT = path.join(__dirname, "..");
const google = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const sa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...google.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
Object.assign(process.env, {
  VERCEL: "1", GA_PROPERTY_ID: "123456", GOOGLE_CLIENT_ID: "client-abc.apps.googleusercontent.com", ADMIN_EMAILS: "Owner@Example.com, second@example.com",
  GA_SERVICE_ACCOUNT: JSON.stringify({ client_email: "reader@proj.iam.gserviceaccount.com", private_key: sa.privateKey.export({ type: "pkcs8", format: "pem" }) })
});
const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
function idToken(claims, key = google.privateKey, kid = "k1") {
  const h = b64({ alg: "RS256", kid, typ: "JWT" }), p = b64(claims);
  return h + "." + p + "." + crypto.sign("RSA-SHA256", Buffer.from(h + "." + p), key).toString("base64url");
}
const now = Math.floor(Date.now() / 1000);
const good = { iss: "https://accounts.google.com", aud: process.env.GOOGLE_CLIENT_ID, exp: now + 600, email: "owner@example.com", email_verified: true };
let gaCalls = [], tokenAssertion = null, claudeCalls = [], claudeFail = false, rtEmpty = false;
global.fetch = async (url, opts) => {
  if (url.includes("api.anthropic.com")) {
    claudeCalls.push({ headers: opts.headers, body: JSON.parse(opts.body) });
    if (claudeFail) return { ok: false, status: 529, json: async () => ({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }) };
    return { ok: true, json: async () => ({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify({ items: [{ headline: "Feature Meld", detail: "It held people." }, { headline: "Second", detail: "x" }] }) }] }) };
  }
  if (url.includes("oauth2/v3/certs")) return { ok: true, json: async () => ({ keys: [jwk] }) };
  if (url.includes("oauth2.googleapis.com/token")) {
    tokenAssertion = new URLSearchParams(opts.body).get("assertion");
    return { ok: true, json: async () => ({ access_token: "tok", expires_in: 3600 }) };
  }
  gaCalls.push({ url, auth: opts.headers.authorization, body: JSON.parse(opts.body) });
  if (url.endsWith(":runRealtimeReport") && rtEmpty) return { ok: true, json: async () => ({ dimensionHeaders: [{ name: "unifiedScreenName" }], metricHeaders: [{ name: "activeUsers" }], totals: [{}], rowCount: 0 }) };
  if (url.endsWith(":runRealtimeReport")) return { ok: true, json: async () => ({ dimensionHeaders: [{ name: "unifiedScreenName" }], metricHeaders: [{ name: "activeUsers" }], rows: [{ dimensionValues: [{ value: "Meld — One Page Toys" }], metricValues: [{ value: "3" }] }], totals: [{ metricValues: [{ value: "5" }] }] }) };
  const body = JSON.parse(opts.body);
  return { ok: true, json: async () => ({ reports: body.requests.map((r) => {
    const dims = (r.dimensions || []).map((d) => d.name); if (r.dateRanges.length > 1) dims.push("dateRange");
    const mets = r.metrics.map((m) => m.name);
    const row = (vals, dr) => ({ dimensionValues: dims.map((d) => ({ value: d === "dateRange" ? dr : vals[d] })), metricValues: mets.map(() => ({ value: "10" })) });
    let rows = [];
    if (dims[0] === "pagePath" && dims[1] === "eventName") rows = [row({ pagePath: "/toys/meld/", eventName: "toy_play" }), row({ pagePath: "/toys/meld/index.html", eventName: "share" })];
    else if (dims[0] === "pagePath") rows = [row({ pagePath: "/toys/meld" }, "cur"), row({ pagePath: "/toys/meld/" }, "prev")];
    else if (!dims.length || dims[0] === "dateRange") rows = [row({}, "cur"), row({}, "prev")];
    else rows = [row({ [dims[0]]: "x" })];
    return { dimensionHeaders: dims.map((n) => ({ name: n })), metricHeaders: mets.map((n) => ({ name: n })), rows };
  }) }) };
};
const A = require(path.join(ROOT, "api", "_admin.js"));
const handler = require(path.join(ROOT, "api", "admin.js"));
function call(op, { method = "GET", body, cookie, ct = "application/json", query = {} } = {}) {
  return new Promise((resolve) => {
    const req = { method, query: { op, ...query }, body, headers: { cookie: cookie || "", "content-type": ct } };
    const res = { h: {}, setHeader(k, v) { this.h[k] = v; }, status(s) { this.s = s; return this; }, json(o) { resolve({ status: this.s, body: o, cookie: this.h["set-cookie"] }); } };
    handler(req, res);
  });
}
let pass = 0, fail = 0;
const t = (name, ok) => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + name); };
(async () => {
  t("demo is off under VERCEL", A.DEMO === false);
  t("config complete", A.missing().length === 0);
  let r = await call("login", { method: "POST", body: { credential: idToken(good) } });
  t("valid admin token signs in", r.status === 200 && /opt_admin=.+HttpOnly; SameSite=Strict; Secure/.test(r.cookie));
  const cookie = r.cookie.split(";")[0];
  r = await call("session", { cookie }); t("session reads back", r.body.signedIn && r.body.email === "owner@example.com");
  r = await call("login", { method: "POST", body: { credential: idToken({ ...good, email: "stranger@example.com" }) } }); t("non-admin refused (403)", r.status === 403);
  r = await call("login", { method: "POST", body: { credential: idToken({ ...good, aud: "other-app" }) } }); t("token for another app refused", r.status === 401);
  r = await call("login", { method: "POST", body: { credential: idToken({ ...good, exp: now - 120 }) } }); t("expired token refused", r.status === 401);
  r = await call("login", { method: "POST", body: { credential: idToken({ ...good, email_verified: false }) } }); t("unverified email refused", r.status === 401);
  const forger = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  r = await call("login", { method: "POST", body: { credential: idToken(good, forger.privateKey) } }); t("forged signature refused", r.status === 401);
  r = await call("login", { method: "POST", body: { credential: idToken(good, google.privateKey, "nope") } }); t("unknown key id refused", r.status === 401);
  r = await call("login", { method: "GET", body: { credential: idToken(good) } }); t("GET login refused", r.status === 405);
  r = await call("login", { method: "POST", body: "x", ct: "text/plain" }); t("non-JSON login refused", r.status === 415);
  const [pl, sig] = cookie.split("=")[1].split(".");
  const tampered = "opt_admin=" + b64({ e: "owner@example.com", x: Date.now() + 9e9 }) + "." + sig;
  r = await call("stats", { cookie: tampered }); t("tampered cookie refused", r.status === 401);
  r = await call("stats", {}); t("no cookie refused", r.status === 401);
  process.env.ADMIN_EMAILS = "second@example.com";
  r = await call("session", { cookie }); t("removed admin loses session at once", r.body.signedIn === false);
  process.env.ADMIN_EMAILS = "owner@example.com";
  r = await call("stats", { cookie, query: { days: "28" } });
  t("stats ok", r.status === 200);
  const m = r.body.pages && r.body.pages["/toys/meld/"];
  t("paths normalized and merged (opens, prev, plays, shares)", m && m.opens === 10 && m.prevOpens === 10 && m.plays === 10 && m.shares === 10);
  t("totals split by range", r.body.totals.visitors === 10 && r.body.totals.prevVisitors === 10);
  t("realtime parsed", r.body.now && r.body.now.active === 5 && r.body.now.top[0].value === 3);
  t("GA called with bearer token", gaCalls.every((c) => c.auth === "Bearer tok") && gaCalls.some((c) => c.url.includes("properties/123456:batchRunReports")));
  const [h, p, s] = tokenAssertion.split(".");
  t("service-account JWT signed with its key", crypto.verify("RSA-SHA256", Buffer.from(h + "." + p), sa.publicKey, Buffer.from(s, "base64url")));
  const claims = JSON.parse(Buffer.from(p, "base64url"));
  t("JWT asks for read-only analytics", claims.scope === "https://www.googleapis.com/auth/analytics.readonly" && claims.iss === "reader@proj.iam.gserviceaccount.com");
  rtEmpty = true;
  r = await call("stats", { cookie, query: { days: "90" } });
  t("nobody on the site: stats still load, right now = 0", r.status === 200 && r.body.now && r.body.now.active === 0 && r.body.now.top.length === 0);
  rtEmpty = false;
  r = await call("advice", { query: { days: "28" } }); t("advice needs a sign-in", r.status === 401);
  r = await call("advice", { cookie, query: { days: "28" } }); t("advice is off without a key", r.status === 200 && r.body.configured === false && !claudeCalls.length);
  process.env.ANTHROPIC_API_KEY = "sk-test";
  r = await call("advice", { cookie, query: { days: "28" } });
  const c = claudeCalls[0];
  t("advice calls Claude with the key, API version and a JSON schema (no forced tool)", c && c.headers["x-api-key"] === "sk-test" && c.headers["anthropic-version"] === "2023-06-01" && c.body.output_config.format.type === "json_schema" && !c.body.tool_choice && !c.body.tools && /^claude-/.test(c.body.model) && c.body.max_tokens >= 4000);
  t("advice sends real toy names with their numbers", c && /"name":"Meld"[^}]*"opens":10/.test(c.body.messages[0].content));
  t("the brief rules out monetizing", c && /never suggest ads/.test(c.body.system));
  t("advice returns Claude's items", r.status === 200 && r.body.items.length === 2 && r.body.items[0].headline === "Feature Meld");
  r = await call("advice", { cookie, query: { days: "28", fresh: "1" } }); t("a rewrite within a minute comes from the cache", r.status === 200 && claudeCalls.length === 1);
  claudeFail = true;
  r = await call("advice", { cookie, query: { days: "7" } }); t("Claude's error reaches the page", r.status === 500 && /Overloaded/.test(r.body.error));
  r = await call("logout", { method: "POST", body: {} }); t("logout clears cookie", /Max-Age=0/.test(r.cookie));
  console.log(`\n${pass} passed, ${fail} failed`);
})();
