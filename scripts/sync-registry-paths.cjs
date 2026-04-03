/* One-off: set tools-registry path prefix from category; add previously unlisted tool pages. */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const regPath = path.join(ROOT, "tools-registry.json");
const reg = JSON.parse(fs.readFileSync(regPath, "utf8"));

const orphans = [
  {
    slug: "image-converter",
    name: "Quick image converter",
    shortDescription:
      "Drag and drop an image and convert to PNG, JPEG, or WebP in the browser.",
    category: "utility",
    tags: ["image-tool"],
    status: "beta",
    path: "tools/image-converter/index.html",
    related: ["image-compressor", "palette-from-image", "favicon-generator"],
  },
  {
    slug: "json-pretty-print-validate-minify",
    name: "JSON format & validate",
    shortDescription:
      "Pretty-print, minify, and validate JSON in your browser. Errors show line and column.",
    category: "utility",
    tags: ["json-tool"],
    status: "beta",
    path: "tools/json-pretty-print-validate-minify/index.html",
    related: ["json-schema-quickcheck", "csv-json-converter", "jwt-inspector"],
  },
  {
    slug: "meeting-cost-timer",
    name: "Meeting cost timer",
    shortDescription:
      "See a live dollar counter for how much this meeting costs as time passes.",
    category: "utility",
    tags: ["notes-tool"],
    status: "beta",
    path: "tools/meeting-cost-timer/index.html",
    related: ["meeting-notes-timer", "timestamp-converter", "unit-converter"],
  },
  {
    slug: "passphrase-generator",
    name: "Passphrase & password generator",
    shortDescription:
      "Generate strong random passwords or memorable multi-word passphrases with Web Crypto.",
    category: "utility",
    tags: ["id-generator"],
    status: "beta",
    path: "tools/passphrase-generator/index.html",
    related: ["uuid-nanoid-generator", "base64-url-encoder", "regex-tester"],
  },
  {
    slug: "percentage-calculator",
    name: "Percentage calculator",
    shortDescription:
      "Find a percentage of a number, or what percent one number is of another.",
    category: "utility",
    tags: ["math-tool"],
    status: "live",
    path: "tools/percentage-calculator/index.html",
    related: ["unit-converter", "timestamp-converter", "csv-json-converter"],
  },
  {
    slug: "qr-code-generator",
    name: "QR code generator",
    shortDescription:
      "Turn any text or URL into a QR code in your browser. Download a PNG when you are done.",
    category: "utility",
    tags: ["qr-tool"],
    status: "beta",
    path: "tools/qr-code-generator/index.html",
    related: ["og-meta-builder", "favicon-generator", "markdown-previewer"],
  },
  {
    slug: "wcag-contrast-checker",
    name: "WCAG contrast checker",
    shortDescription:
      "Check two colors for WCAG 2.1 contrast ratio and AA / AAA pass for text sizes.",
    category: "utility",
    tags: ["a11y-tool"],
    status: "beta",
    path: "tools/wcag-contrast-checker/index.html",
    related: ["a11y-quick-checklist", "palette-from-image", "gradient-generator"],
  },
  {
    slug: "word-character-counter",
    name: "Word & character counter",
    shortDescription:
      "Count words, characters, sentences, and paragraphs from pasted text—runs locally.",
    category: "utility",
    tags: ["word-count-tool"],
    status: "beta",
    path: "tools/word-character-counter/index.html",
    related: ["diff-two-texts", "markdown-previewer", "ux-copy-generator"],
  },
];

const bySlug = {};
reg.forEach((t) => {
  bySlug[t.slug] = t;
});

reg.forEach((t) => {
  const cat = String(t.category || "").toLowerCase();
  const base = cat === "utility" ? "tools" : "toys";
  t.path = `${base}/${t.slug}/index.html`;
});

for (const o of orphans) {
  if (!bySlug[o.slug]) {
    reg.push(o);
    bySlug[o.slug] = o;
  }
}

reg.sort((a, b) => String(a.slug).localeCompare(String(b.slug)));

fs.writeFileSync(regPath, JSON.stringify(reg, null, 2) + "\n");
console.log("Updated", regPath, "entries:", reg.length);
