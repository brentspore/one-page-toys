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
blocks.push(`  <url>
    <loc>${SITE}/all-tools.html</loc>
    <changefreq>weekly</changefreq>
    <priority>0.95</priority>
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
console.log("sitemap.xml urls:", 2 + reg.length);
