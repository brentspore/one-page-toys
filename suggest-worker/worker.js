/* One Page Toys — suggestion Worker
 * Receives a POST from the site's "Suggest a toy" form, validates it against
 * a layered spam defense, and emails the suggestion via Resend.
 *
 * Layers:  origin allow-list · honeypot · time-trap · length/email sanity
 *          · Cloudflare Turnstile verify · per-IP rate limit (KV, 10-min window)
 *
 * Secrets (wrangler secret put ...):  RESEND_API_KEY, TURNSTILE_SECRET
 * Vars (wrangler.toml [vars]):        FROM_EMAIL, TO_EMAIL
 * Binding:                            SUGGEST_KV (KV namespace)
 */

const ALLOWED_ORIGINS = [
  "https://onepagetoys.com",
  "https://www.onepagetoys.com",
];

const RATE_MAX = 5;          // max submissions...
const RATE_WINDOW = 600;     // ...per IP per 600s (10 min)
const MIN_ELAPSED = 3000;    // form must be open >= 3s
const MAX_ELAPSED = 3600000; // ...and < 1h (stale/replayed token guard)

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

    const reply = (status, body) =>
      new Response(body ? JSON.stringify(body) : null, {
        status,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": allowOrigin,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Vary": "Origin",
        },
      });

    if (request.method === "OPTIONS") return reply(204);
    if (request.method !== "POST") return reply(405, { error: "method" });
    if (!ALLOWED_ORIGINS.includes(origin)) return reply(403, { error: "origin" });

    let data;
    try { data = await request.json(); } catch { return reply(400, { error: "json" }); }

    const message = String(data.message || "").trim();
    const email = String(data.email || "").trim();
    const company = String(data.company || "");        // honeypot — must be empty
    const elapsed = Number(data.elapsed || 0);
    const token = String(data.token || "");

    // honeypot: a bot filled the hidden field → pretend success, drop silently
    if (company) return reply(200, { ok: true });

    // time-trap
    if (!(elapsed >= MIN_ELAPSED && elapsed < MAX_ELAPSED)) return reply(400, { error: "timing" });

    // content sanity
    if (message.length < 4 || message.length > 2000) return reply(400, { error: "length" });
    if (email && (email.length > 200 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) return reply(400, { error: "email" });

    const ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";

    // rate limit (best-effort; KV is eventually consistent but fine here)
    const rlKey = "rl:" + ip;
    let count = 0;
    if (env.SUGGEST_KV) { count = parseInt((await env.SUGGEST_KV.get(rlKey)) || "0", 10) || 0; }
    if (count >= RATE_MAX) return reply(429, { error: "rate" });

    // Turnstile verification
    if (!token) return reply(403, { error: "captcha" });
    const verify = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
    });
    const vjson = await verify.json().catch(() => ({ success: false }));
    if (!vjson.success) return reply(403, { error: "captcha" });

    // send via Resend
    const from = env.FROM_EMAIL || "One Page Toys <suggestions@onepagetoys.com>";
    const to = env.TO_EMAIL || "brent@mightyarmy.com";
    const body = {
      from,
      to: [to],
      subject: "💡 New toy suggestion",
      text:
        message +
        "\n\n———\n" +
        "From: " + (email || "anonymous") + "\n" +
        "IP: " + ip + "\n" +
        "Sent: " + new Date().toISOString(),
    };
    if (email) body.reply_to = email;

    const send = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!send.ok) {
      const detail = (await send.text().catch(() => "")).slice(0, 300);
      return reply(502, { error: "send", detail });
    }

    // record the submission against the rate window
    if (env.SUGGEST_KV) {
      await env.SUGGEST_KV.put(rlKey, String(count + 1), { expirationTtl: RATE_WINDOW });
    }

    return reply(200, { ok: true });
  },
};
