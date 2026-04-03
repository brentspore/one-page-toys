/* eslint-disable no-var */
/* Generates implementations for the 25 newly added pages only. */

const fs = require("fs");
const path = require("path");

const SITE = "https://onepagetoys.com";
const OG = SITE + "/assets/og-image.png";

const NEW_SLUGS = [
  "clipboard-stack",
  "diff-two-texts",
  "regex-tester",
  "uuid-nanoid-generator",
  "timestamp-converter",
  "csv-json-converter",
  "base64-url-encoder",
  "jwt-inspector",
  "palette-from-image",
  "gradient-generator",
  "favicon-generator",
  "image-compressor",
  "markdown-previewer",
  "og-meta-builder",
  "a11y-quick-checklist",
  "unit-converter",
  "meeting-notes-timer",
  "ux-copy-generator",
  "file-hash-tool",
  "json-schema-quickcheck",
  "daily-doodle-prompt",
  "reaction-ladder",
  "tiny-idle-garden",
  "mood-meteor",
  "micro-rhythm-tapper"
];

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function write(p, s) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s);
}

function baseHead(t) {
  const title = `${t.name} — One Page Toys`;
  return `    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="../../assets/favicon-32.png" type="image/png" sizes="32x32" />
    <link rel="icon" href="../../assets/favicon-16.png" type="image/png" sizes="16x16" />
    <link rel="apple-touch-icon" href="../../assets/apple-touch-icon.png" sizes="180x180" />
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-VBVJ93GL8L"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-VBVJ93GL8L');
    </script>
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(t.desc)}" />
    <link rel="canonical" href="${SITE}/toys/${t.slug}/index.html" />
    <meta name="robots" content="index, follow" />
    <meta name="theme-color" content="${esc(t.color)}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="One Page Toys" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(t.desc)}" />
    <meta property="og:url" content="${SITE}/toys/${t.slug}/index.html" />
    <meta property="og:image" content="${OG}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:locale" content="en_US" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(title)}" />
    <meta name="twitter:description" content="${esc(t.desc)}" />
    <meta name="twitter:image" content="${OG}" />
    <link rel="stylesheet" href="../../assets/styles.css" />
    <link rel="stylesheet" href="../../assets/tool-shell.css" />
    <link rel="stylesheet" href="styles.css" />`;
}

function shell(t, inner, script) {
  return `<!doctype html>
<html lang="en">
  <head>
${baseHead(t)}
  </head>
  <body data-tool-slug="${esc(t.slug)}">
    <header class="topbar">
      <div class="topbar__inner">
        <a class="brand" href="../../index.html">One Page Toys</a>
      </div>
    </header>
    <main class="container">
      <section class="tool">
        <h1>${esc(t.name)}</h1>
        <p class="lead">${esc(t.desc)}</p>
        <div class="panel">
${inner}
          <p class="tool-directions" style="margin-bottom: 0; margin-top: 12px;">
            <strong>Notes.</strong> Runs locally. Uses your browser storage when it needs to remember things.
          </p>
        </div>
      </section>
      <div id="toolCrossRoot" class="tool-cross-mount"></div>
    </main>
    <footer class="site-footer" role="contentinfo">
      <div class="site-footer__inner">
        <div class="site-footer__top">
          <div class="site-footer__intro">
            <strong class="site-footer__name">One Page Toys</strong>
            <p class="site-footer__tagline">Small web toys—tools, games, and experiments—each built to stay focused, simple, and easy to open.</p>
          </div>
          <nav class="site-footer__nav" aria-label="Site">
            <a href="../../index.html">Home</a>
            <a href="../../all-tools.html">All toys</a>
          </nav>
        </div>
        <div class="site-footer__bottom">
          <p class="site-footer__copyright muted">© 2026 One Page Toys</p>
          <div class="site-footer__bottom-right">
            <a class="site-footer__madeby" href="https://synergyprod.com/" target="_blank" rel="noopener noreferrer">
              <span class="site-footer__madeby-label muted">Made by</span>
              <img class="site-footer__synergy-logo" src="../../assets/synergy-logo.svg" alt="Synergy" width="51" height="13" />
            </a>
          </div>
        </div>
      </div>
    </footer>
    <script>
${script}
    </script>
    <script src="../../assets/site-chrome.js" defer></script>
    <script src="../../assets/tool-cross.js" defer></script>
  </body>
</html>
`;
}

const CSS_BASE = `/* Local only */
.local{display:grid;gap:1rem}
.local-row{display:grid;gap:0.6rem}
.local-row--2{grid-template-columns:1fr}
@media (min-width:860px){.local-row--2{grid-template-columns:1fr 1fr}}
.local-input, .local-text, select.local-input{width:100%;padding:0.65rem 0.75rem;border-radius:var(--radius-sm);border:1px solid var(--border);background:rgba(255,255,255,0.9);font:inherit}
.local-text{min-height:10rem;resize:vertical}
.local-actions{display:flex;flex-wrap:wrap;gap:0.5rem;justify-content:center;align-items:center}
.local-out{white-space:pre-wrap;word-break:break-word}
.local-grid{display:grid;gap:0.75rem}
`;

const JS_COMMON = `      (function(){
        function $(id){return document.getElementById(id);}
        function on(el, ev, fn){ if(el) el.addEventListener(ev, fn); }
        function save(key, val){ try{ localStorage.setItem(key, JSON.stringify(val)); }catch(e){} }
        function load(key, fallback){ try{ const v=localStorage.getItem(key); return v? JSON.parse(v): fallback; }catch(e){ return fallback; } }
        function copyText(s){
          if(navigator.clipboard && navigator.clipboard.writeText){ return navigator.clipboard.writeText(s); }
          return new Promise(function(res){
            try{ var ta=document.createElement('textarea'); ta.value=s; ta.setAttribute('readonly','true'); ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); res(); }
            catch(e){ res(); }
          });
        }
        function setStatus(id, msg){ var el=$(id); if(el) el.textContent=msg; }
        function eHTML(str){ return String(str).replace(/[&<>\"']/g,function(ch){ switch(ch){ case '&':return '&amp;'; case '<':return '&lt;'; case '>':return '&gt;'; case '\"':return '&quot;'; case \"'\":return '&#39;'; default:return ch; } }); }
`;
const JS_END = `      })();`;

function impl_scaffold(slug) {
  return {
    css: CSS_BASE,
    inner: `          <div class="local">
            <p class="ui-live" id="sStatus" aria-live="polite">This tool is in-progress. More coming soon.</p>
            <div class="local-row">
              <label class="muted" for="sNotes" style="font-weight:800">Notes (saved locally)</label>
              <textarea class="local-text" id="sNotes"></textarea>
            </div>
            <div class="local-actions">
              <button class="btn btn--secondary" type="button" id="sCopy">Copy notes</button>
              <button class="btn" type="button" id="sClear">Clear</button>
            </div>
          </div>`,
    script: `${JS_COMMON}
        var KEY='ops_notes_'+${JSON.stringify(slug)}+'_v1';
        var notes=$('sNotes');
        notes.value=(load(KEY,{n:''}).n)||'';
        on(notes,'input',function(){ save(KEY,{n:notes.value}); setStatus('sStatus','Saved.'); });
        on($('sCopy'),'click',function(){ copyText(notes.value||'').then(()=>setStatus('sStatus','Copied.')); });
        on($('sClear'),'click',function(){ notes.value=''; save(KEY,{n:''}); setStatus('sStatus','Cleared.'); });
${JS_END}`
  };
}

const implA = require("./new25-impls-a.cjs");
const implB = require("./new25-impls-b.cjs");
const IMPLEMENTATIONS = Object.assign(
  {},
  implA(CSS_BASE, JS_COMMON, JS_END),
  implB(CSS_BASE, JS_COMMON, JS_END)
);

function main() {
  const reg = JSON.parse(fs.readFileSync("tools-registry.json", "utf8"));
  const bySlug = {};
  reg.forEach((t) => (bySlug[t.slug] = t));

  const colorMap = {
    utility: "#0ea5e9",
    game: "#16a34a",
    visual: "#e11d48",
    audio: "#f97316",
    wellness: "#0f766e"
  };

  let wrote = 0;
  NEW_SLUGS.forEach((slug) => {
    const meta = bySlug[slug];
    if (!meta) return;
    const dir = path.join("toys", slug);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const cat = String(meta.category || "utility").toLowerCase();
    const t = {
      slug,
      name: meta.name,
      desc: meta.shortDescription,
      color: colorMap[cat] || "#e85d44"
    };
    const builder = IMPLEMENTATIONS[slug];
    const page = builder ? builder() : impl_scaffold(slug);
    write(path.join(dir, "styles.css"), page.css);
    write(path.join(dir, "index.html"), shell(t, page.inner, page.script));
    wrote++;
  });

  console.log("Wrote pages:", wrote);
}

main();

