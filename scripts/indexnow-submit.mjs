#!/usr/bin/env node
// Push URLs to IndexNow so Bing (plus Yandex/Seznam/Naver) is told about changes
// instead of waiting to re-crawl. Google does NOT participate — this complements
// Search Console, it does not replace it.
//
// Usage:
//   node scripts/indexnow-submit.mjs                  # every URL in the live sitemap
//   node scripts/indexnow-submit.mjs /toys/darts/     # just these paths
//   node scripts/indexnow-submit.mjs --dry-run
//
// The key is NOT a secret: IndexNow works by hosting it publicly at keyLocation so the
// engine can confirm you control the domain.

const HOST = "onepagetoys.com";
const KEY = "968d91aa1ae69835ed25661037ad6557";
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const SITEMAP = `https://${HOST}/sitemap.xml`;
const ENDPOINT = "https://api.indexnow.org/indexnow";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const paths = args.filter((a) => !a.startsWith("--"));

async function main() {
  // A missing or mismatched key file silently rejects every submission, so check first.
  const res0 = await fetch(KEY_LOCATION);
  const body = res0.ok ? (await res0.text()).trim() : null;
  if (!res0.ok || body !== KEY) {
    console.error(`ERROR: ${KEY_LOCATION} must return exactly the key (status=${res0.status}).`);
    console.error("Deploy the key file first, then re-run.");
    process.exit(1);
  }
  console.log(`key file OK at ${KEY_LOCATION}`);

  let urlList;
  if (paths.length) {
    urlList = paths.map((p) => (p.startsWith("http") ? p : `https://${HOST}${p.startsWith("/") ? p : "/" + p}`));
  } else {
    const sm = await fetch(SITEMAP);
    if (!sm.ok) throw new Error(`sitemap fetch failed: ${sm.status}`);
    urlList = [...(await sm.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  }

  console.log(`${urlList.length} URL(s) to submit`);
  if (dryRun) return urlList.slice(0, 10).forEach((u) => console.log("  " + u));

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList }),
  });
  const ok = res.status === 200 || res.status === 202; // 202 = accepted, key still validating
  console.log(`-> HTTP ${res.status} ${ok ? "accepted" : "REJECTED"}`);
  if (!ok) { console.error(await res.text().catch(() => "")); process.exit(1); }
}

main().catch((e) => { console.error("fatal:", e.message); process.exit(1); });
