const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SITE = "https://onepagetoys.com";
const reg = JSON.parse(fs.readFileSync(path.join(ROOT, "tools-registry.json"), "utf8"));

const blocks = [];
blocks.push(`  <url>
    <loc>${SITE}/</loc>
    <changefreq>weekly</changefreq>
    <priority>1</priority>
  </url>`);
// /all-toys/ is the hub that links every toy — the single most valuable page
// for discovery. It used to be emitted as `all-tools.html`, which 404s (the
// 2026-08-04 search audit caught it); regenerating reintroduced the dead URL
// every time. Keep this pointing at the directory that actually serves.
blocks.push(`  <url>
    <loc>${SITE}/all-toys/</loc>
    <changefreq>weekly</changefreq>
    <priority>0.95</priority>
  </url>`);
blocks.push(`  <url>
    <loc>${SITE}/store/</loc>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>`);

for (const t of reg) {
  if (!t.path) continue;
  blocks.push(`  <url>
    <loc>${SITE}/${t.path}</loc>
    <changefreq>monthly</changefreq>
    <priority>0.85</priority>
  </url>`);
}

const out = `<?xml version="1.0" encoding="UTF-8"?>
<!-- ${SITE} -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${blocks.join("\n")}
</urlset>
`;

fs.writeFileSync(path.join(ROOT, "sitemap.xml"), out);
// count the blocks actually emitted — a hardcoded offset here under-reported by
// one and made audits chase a phantom missing URL
console.log("sitemap.xml urls:", blocks.length);
