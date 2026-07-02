# Suggestion Worker

A tiny Cloudflare Worker that backs the site's **"Suggest a toy"** dialog. It
validates the submission (origin allow-list, honeypot, time-trap, Turnstile,
per-IP rate limit) and emails it to you via **Resend**.

The API key never touches the browser or the repo — it lives as a Worker secret.

## One-time setup

**1. Cloudflare Turnstile** (the captcha). In the Cloudflare dashboard →
Turnstile → *Add widget*. Add `onepagetoys.com` (and `localhost` for testing).
You get two keys:
- **Site key** (public) → goes in the frontend (see step 5).
- **Secret key** → set as a Worker secret (step 4).

**2. KV namespace** (rate-limit store):
```bash
cd suggest-worker
npx wrangler kv namespace create SUGGEST_KV
```
Copy the printed `id` into `wrangler.toml` (replace `REPLACE_WITH_KV_NAMESPACE_ID`).

**3. Resend** — your domain is already verified. Make sure `FROM_EMAIL` in
`wrangler.toml` uses an address on that domain (default
`suggestions@onepagetoys.com`). `TO_EMAIL` is where suggestions land.

**4. Secrets** (never committed):
```bash
npx wrangler secret put RESEND_API_KEY      # paste your Resend API key
npx wrangler secret put TURNSTILE_SECRET    # paste the Turnstile secret key
```

**5. Deploy:**
```bash
npx wrangler deploy
```
Note the deployed URL (e.g. `https://opt-suggest.<you>.workers.dev`), or map a
custom route like `https://api.onepagetoys.com/suggest` in the dashboard.

**6. Wire the frontend.** In the site, set the two public values — either edit
the constants at the top of `assets/suggest.js`, or set a global before it loads:
```html
<script>
  window.OPT_SUGGEST = {
    endpoint: "https://opt-suggest.<you>.workers.dev",
    turnstileKey: "0x4AAAAAAA...."   // Turnstile SITE key
  };
</script>
```
Until both are real (no `REPLACE`), the form stays dormant and the
`[data-suggest-open]` trigger stays hidden — so nothing breaks if it ships early.

## Local test
```bash
npx wrangler dev
```
Then POST to it, or temporarily point `OPT_SUGGEST.endpoint` at the dev URL.

## Spam defense (layers)
| Layer | Where | Blocks |
|---|---|---|
| Origin allow-list | Worker | cross-site / scripted POSTs |
| Honeypot (`company`) | form + Worker | dumb bots that fill every field |
| Time-trap (≥3s, <1h) | form + Worker | instant auto-submits, stale replays |
| Turnstile | form + Worker | headless/scripted clients |
| Rate limit (5 / IP / 10 min) | Worker (KV) | floods from one source |
| Length + email sanity | Worker | junk payloads |
