/*!
 * more-games.js — shared "More Games" cross-promo widget for One Page Toys.
 * Self-contained, no deps. Auto-mounts into the overlay panel of a toy end screen,
 * shows 2 random games from the portfolio list (excluding the host toy), styled with
 * translucent chrome that inherits the host panel's palette.
 * Master list mirrors the five-second-game MoreGames component (design-matched icons).
 */
(function () {
  "use strict";

  var GAMES = [
    {
      "name": "Global War",
      "tagline": "Strategy conquest",
      "url": "https://globalwar.app",
      "favicon": "https://globalwar.app/favicon.svg",
      "initial": "G",
      "slug": null
    },
    {
      "name": "Symmetry Genius",
      "tagline": "Visual puzzles",
      "url": "https://symmetrygenius.com",
      "favicon": "https://symmetrygenius.com/favicon.ico",
      "initial": "S",
      "slug": null
    },
    {
      "name": "The Trail Game",
      "tagline": "One-line path puzzle",
      "url": "https://onepagetoys.com/toys/trail-game/",
      "favicon": "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='%2314171f'/><path d='M8 24V13h8v6h8V9' fill='none' stroke='%23c91d2b' stroke-width='3.4' stroke-linecap='round' stroke-linejoin='round'/><circle cx='8' cy='24' r='2.6' fill='%23f2efe9'/><circle cx='24' cy='9' r='2.6' fill='%23f2efe9'/></svg>",
      "initial": "T",
      "slug": "trail-game"
    },
    {
      "name": "Spelling Blocks",
      "tagline": "Anagram word puzzle",
      "url": "https://onepagetoys.com/toys/spelling-blocks/",
      "favicon": "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='%23ece0c2'/><rect x='5' y='5' width='10' height='10' rx='2.5' fill='%232b59c3'/><rect x='17' y='5' width='10' height='10' rx='2.5' fill='%23c7402d'/><rect x='5' y='17' width='10' height='10' rx='2.5' fill='%233e8a4e'/><rect x='17' y='17' width='10' height='10' rx='2.5' fill='%23f2b63c'/><g font-family='sans-serif' font-size='7' font-weight='800' text-anchor='middle'><text x='10' y='12.6' fill='%23f1e7d0'>W</text><text x='22' y='12.6' fill='%23f1e7d0'>O</text><text x='10' y='24.6' fill='%23f1e7d0'>R</text><text x='22' y='24.6' fill='%2326221b'>D</text></g></svg>",
      "initial": "S",
      "slug": "spelling-blocks"
    },
    {
      "name": "Alpenglow",
      "tagline": "Mountain glow",
      "url": "https://onepagetoys.com/toys/alpenglow/",
      "favicon": "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='%23262040'/><circle cx='16' cy='12' r='6' fill='%23ff9bb3'/><path d='M0 32L11 15l6 9 5-8 10 16z' fill='%231b1533'/></svg>",
      "initial": "A",
      "slug": "alpenglow"
    },
    {
      "name": "Dot Loop",
      "tagline": "Looping dots",
      "url": "https://onepagetoys.com/toys/dot-loop/",
      "favicon": "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='%2314161b'/><g fill='%2300e6c8'><circle cx='25' cy='16' r='2'/><circle cx='22.4' cy='9.6' r='2'/><circle cx='16' cy='7' r='2'/><circle cx='9.6' cy='9.6' r='2'/><circle cx='7' cy='16' r='2'/><circle cx='9.6' cy='22.4' r='2'/><circle cx='16' cy='25' r='2'/><circle cx='22.4' cy='22.4' r='2'/></g></svg>",
      "initial": "D",
      "slug": "dot-loop"
    },
    {
      "name": "Deep Descent",
      "tagline": "Endless dive",
      "url": "https://onepagetoys.com/toys/deep-descent/",
      "favicon": "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='%2308060a'/><g fill='none' stroke='%2340e0ff' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><path d='M9 9l7 5 7-5'/><path d='M9 17l7 5 7-5'/></g></svg>",
      "initial": "D",
      "slug": "deep-descent"
    },
    {
      "name": "Nova Coil",
      "tagline": "Cosmic swirl",
      "url": "https://onepagetoys.com/toys/nova-coil/",
      "favicon": "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='%2305060f'/><g fill='none' stroke='%236aa8ff' stroke-width='1.6'><circle cx='16' cy='16' r='6'/><circle cx='16' cy='16' r='10'/></g><circle cx='16' cy='16' r='3' fill='%23cfe4ff'/></svg>",
      "initial": "N",
      "slug": "nova-coil"
    },
    {
      "name": "Puffling",
      "tagline": "Puffin chick",
      "url": "https://onepagetoys.com/toys/puffling/",
      "favicon": "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='%237ec8e3'/><ellipse cx='16' cy='19' rx='9' ry='9' fill='%23ffffff'/><path d='M7 15a9 9 0 0 1 18 0z' fill='%231a1a1a'/><path d='M13 16h6l-3 4z' fill='%23ff8a1e'/><circle cx='12' cy='13' r='1.3' fill='%23ffffff'/><circle cx='20' cy='13' r='1.3' fill='%23ffffff'/></svg>",
      "initial": "P",
      "slug": "puffling"
    },
    {
      "name": "Paper Plane",
      "tagline": "Fold & fly",
      "url": "https://onepagetoys.com/toys/paper-plane/",
      "favicon": "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='%23241f47'/><path d='M5 7l22 9-22 9 5-9z' fill='%23ffffff'/><path d='M5 25l5-9 17 0' fill='none' stroke='%237a72b8' stroke-width='1.4'/></svg>",
      "initial": "P",
      "slug": "paper-plane"
    },
    {
      "name": "Mini Golf",
      "tagline": "Putt putt",
      "url": "https://onepagetoys.com/toys/mini-golf/",
      "favicon": "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='%2314663a'/><ellipse cx='18' cy='26' rx='6' ry='2' fill='%230d4a29'/><rect x='15' y='7' width='2' height='18' fill='%23e8e8e8'/><path d='M17 7l9 3-9 3z' fill='%23ff3b3b'/><circle cx='11' cy='24' r='3' fill='%23ffffff'/></svg>",
      "initial": "M",
      "slug": "mini-golf"
    },
    {
      "name": "Pool",
      "tagline": "Rack 'em up",
      "url": "https://onepagetoys.com/toys/pool/",
      "favicon": "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='%230d5b34'/><circle cx='21' cy='20' r='5.5' fill='%23fbfaf5'/><circle cx='12' cy='12' r='6.5' fill='%23161616'/><circle cx='12' cy='12' r='3' fill='%23f7f4ec'/><text x='12' y='13.7' font-family='sans-serif' font-size='4.6' font-weight='800' text-anchor='middle' fill='%23161616'>8</text></svg>",
      "initial": "P",
      "slug": "pool"
    },
    {
      "name": "Minesweeper",
      "tagline": "Clear the mines",
      "url": "https://onepagetoys.com/toys/minesweeper/",
      "favicon": "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='%230b0d10'/><rect x='4' y='4' width='24' height='24' rx='6' fill='%2320242c'/><circle cx='16' cy='16' r='10' fill='%23ff8a4d' opacity='0.14'/><g stroke='%23d9743f' stroke-width='2.2' stroke-linecap='round'><path d='M16 7.5v17'/><path d='M7.5 16h17'/><path d='M10.3 10.3l11.4 11.4'/><path d='M21.7 10.3L10.3 21.7'/></g><circle cx='16' cy='16' r='5.4' fill='%23e07b45'/><circle cx='13.9' cy='13.9' r='1.9' fill='%23ffdcbd'/></svg>",
      "initial": "M",
      "slug": "minesweeper"
    },
    {
      "name": "Random Maze",
      "tagline": "Maze runner",
      "url": "https://onepagetoys.com/toys/random-maze/",
      "favicon": "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='%2305070d'/><g fill='none' stroke='%2333dd88' stroke-width='2' stroke-linecap='square'><path d='M6 6h20v20'/><path d='M6 6v14h8v-8h8'/><path d='M14 26h12v-8'/><path d='M6 26h4'/></g></svg>",
      "initial": "R",
      "slug": "random-maze"
    },
    {
      "name": "Sky Fortress",
      "tagline": "Sky castle",
      "url": "https://onepagetoys.com/toys/sky-fortress/",
      "favicon": "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='%2304050d'/><circle cx='25' cy='7' r='1' fill='%23ffffff'/><path d='M6 13h2v-2h2v2h2v-2h2v2h2v-2h2v2h2v12H6z' fill='%237c8cc4'/><rect x='14' y='19' width='4' height='6' fill='%2304050d'/></svg>",
      "initial": "S",
      "slug": "sky-fortress"
    },
    {
      "name": "Slice It",
      "tagline": "Blade slicer",
      "url": "https://onepagetoys.com/toys/slice-it/",
      "favicon": "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='%230b0713'/><path d='M20 5h7v7z' fill='%23ffd166'/><path d='M5 27L27 5' stroke='%23ff5470' stroke-width='3' stroke-linecap='round'/></svg>",
      "initial": "S",
      "slug": "slice-it"
    },
    {
      "name": "Stack Tower",
      "tagline": "Block stacker",
      "url": "https://onepagetoys.com/toys/stack-tower/",
      "favicon": "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='%230e1430'/><rect x='8' y='20' width='16' height='5' rx='1' fill='%235bd1ff'/><rect x='9' y='14' width='14' height='5' rx='1' fill='%234ab6f0'/><rect x='11' y='8' width='11' height='5' rx='1' fill='%2380e0ff'/></svg>",
      "initial": "S",
      "slug": "stack-tower"
    },
    {
      "name": "Trio",
      "tagline": "Match three",
      "url": "https://onepagetoys.com/toys/trio/",
      "favicon": "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='%2317131f'/><circle cx='16' cy='10' r='4' fill='%23ff6b9d'/><circle cx='10' cy='21' r='4' fill='%235bd1ff'/><circle cx='22' cy='21' r='4' fill='%23ffd166'/></svg>",
      "initial": "T",
      "slug": "trio"
    },
    {
      "name": "Solitaire",
      "tagline": "Classic cards",
      "url": "https://onepagetoys.com/toys/solitaire/",
      "favicon": "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='%230d5b3b'/><rect x='8' y='6' width='16' height='20' rx='2' fill='%23ffffff'/><path d='M16 10c-3 3-5 4.2-5 6.6a2.4 2.4 0 0 0 4 1.1c-.3 1.4-1 2.1-2 2.9h6c-1-.8-1.7-1.5-2-2.9a2.4 2.4 0 0 0 4-1.1c0-2.4-2-3.6-5-6.6z' fill='%23111111'/></svg>",
      "initial": "S",
      "slug": "solitaire"
    },
    {
      "name": "Blackjack",
      "tagline": "Hit or stand",
      "url": "https://onepagetoys.com/toys/blackjack/",
      "favicon": "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='%230b5238'/><rect x='8' y='6' width='16' height='20' rx='2' fill='%23ffffff'/><text x='16' y='20' font-family='sans-serif' font-size='11' font-weight='700' text-anchor='middle' fill='%230b5238'>21</text></svg>",
      "initial": "B",
      "slug": "blackjack"
    },
    {
      "name": "Perfect Circle",
      "tagline": "Draw it round",
      "url": "https://onepagetoys.com/toys/perfect-circle/",
      "favicon": "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='%2307091a'/><circle cx='16' cy='16' r='9' fill='none' stroke='%23ff7a5c' stroke-width='3'/><circle cx='16' cy='7' r='2.4' fill='%23ffd9cc'/></svg>",
      "initial": "P",
      "slug": "perfect-circle"
    },
    {
      "name": "5 Second Game",
      "tagline": "Stop at 5.00",
      "url": "https://5secondgame.com/",
      "favicon": "https://5secondgame.com/favicon.png",
      "initial": "5",
      "slug": null
    }
  ];

  // Self-contained theme — never inherits color from the host panel (most toys
  // leave .panel at the default black, which would make inherited text invisible).
  // Dark-panel scheme by default; mount() adds .mg--light when the panel is light.
  var CSS =
    ".mg{--mg-fg:#f3f3f4;--mg-muted:rgba(255,255,255,.62);--mg-faint:rgba(255,255,255,.44);--mg-lbl:rgba(255,255,255,.58);" +
      "--mg-card:rgba(255,255,255,.06);--mg-bd:rgba(255,255,255,.14);--mg-cardh:rgba(255,255,255,.11);--mg-bdh:rgba(255,255,255,.26);" +
      "--mg-fb:rgba(255,255,255,.16);--mg-ring:rgba(255,255,255,.6);" +
      "width:100%;display:flex;flex-direction:column;gap:8px;margin-top:16px}" +
    ".mg--light{--mg-fg:#1a1a1e;--mg-muted:rgba(0,0,0,.56);--mg-faint:rgba(0,0,0,.52);--mg-lbl:rgba(0,0,0,.64);" +
      "--mg-card:rgba(0,0,0,.05);--mg-bd:rgba(0,0,0,.14);--mg-cardh:rgba(0,0,0,.09);--mg-bdh:rgba(0,0,0,.24);" +
      "--mg-fb:rgba(0,0,0,.12);--mg-ring:rgba(0,0,0,.55)}" +
    ".mg-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.15em;color:var(--mg-lbl);text-align:center}" +
    ".mg-row{display:flex;gap:8px;align-items:stretch}" +
    ".mg-card{flex:1 1 0;min-width:0;display:flex;align-items:center;gap:9px;padding:9px 11px;border-radius:12px;" +
      "border:1px solid var(--mg-bd);background:var(--mg-card);color:var(--mg-fg);text-decoration:none;" +
      "-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);" +
      "transition:background .16s ease,border-color .16s ease,transform .1s ease}" +
    ".mg-card:hover{background:var(--mg-cardh);border-color:var(--mg-bdh)}" +
    ".mg-card:active{transform:scale(.97)}" +
    ".mg-card:focus-visible{outline:2px solid var(--mg-ring);outline-offset:2px}" +
    ".mg-icon{width:20px;height:20px;border-radius:5px;flex:0 0 auto;object-fit:cover}" +
    ".mg-icon--fb{color:var(--mg-fg);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;background:var(--mg-fb)}" +
    // text-align is set explicitly: most host panels are centred, and inheriting
    // that centred the short title inside a box sized by the longer subtitle,
    // so the two lines never lined up.
    ".mg-body{display:flex;flex-direction:column;align-items:flex-start;min-width:0;line-height:1.18;text-align:left}" +
    ".mg-name{font-size:12px;font-weight:600;color:var(--mg-fg);overflow:hidden;" +
      "display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2}" +
    ".mg-tag{font-size:10px;color:var(--mg-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    ".mg-ext{margin-left:auto;color:var(--mg-faint);flex:0 0 auto;display:flex}" +
    "@media (max-width:340px){.mg-tag{display:none}}";

  var EXT = '<svg class="mg-ext" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6"/></svg>';

  function injectStyle() {
    if (document.getElementById("mg-style")) return;
    var s = document.createElement("style");
    s.id = "mg-style";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function selfSlug() {
    var host = document.querySelector("[data-more-games][data-self]");
    if (host && host.getAttribute("data-self")) return host.getAttribute("data-self");
    var path = location.pathname;
    var can = document.querySelector('link[rel="canonical"]');
    if (can && can.href) { try { path = new URL(can.href).pathname; } catch (e) {} }
    var m = path.match(/\/toys\/([^\/]+)/);
    return m ? m[1] : null;
  }

  // Walk up from the mount point to the first element with an opaque-ish
  // background; treat a light background as needing the light color scheme.
  function isLightContext(el) {
    var e = el;
    while (e && e !== document.documentElement) {
      var c = getComputedStyle(e).backgroundColor;
      var m = c && c.match(/rgba?\(([^)]+)\)/);
      if (m) {
        var p = m[1].split(",").map(function (x) { return parseFloat(x); });
        var a = p[3] === undefined ? 1 : p[3];
        if (a >= 0.5) {
          var lum = (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255;
          return lum > 0.6;
        }
      }
      e = e.parentElement;
    }
    return false;
  }

  function shuffle(arr) {
    arr = arr.slice();
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function card(g, self) {
    var a = document.createElement("a");
    a.className = "mg-card";
    a.href = g.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";

    var img = document.createElement("img");
    img.className = "mg-icon";
    img.src = g.favicon;
    img.alt = "";
    img.loading = "lazy";
    img.onerror = function () {
      var fb = document.createElement("span");
      fb.className = "mg-icon mg-icon--fb";
      fb.textContent = g.initial;
      if (img.parentNode) img.parentNode.replaceChild(fb, img);
    };

    var bodyEl = document.createElement("div");
    bodyEl.className = "mg-body";
    var nm = document.createElement("span");
    nm.className = "mg-name";
    nm.textContent = g.name;
    var tg = document.createElement("span");
    tg.className = "mg-tag";
    tg.textContent = g.tagline;
    bodyEl.appendChild(nm);
    bodyEl.appendChild(tg);

    var ext = document.createElement("span");
    ext.innerHTML = EXT;

    a.appendChild(img);
    a.appendChild(bodyEl);
    a.appendChild(ext.firstChild);

    a.addEventListener("click", function () {
      try {
        if (window.gtag) window.gtag("event", "more_games_click", { game_name: g.name, from_toy: self || "" });
      } catch (e) {}
    });
    return a;
  }

  function mount() {
    var self = selfSlug();
    var host = document.querySelector("[data-more-games]");
    if (!host) {
      var panel = document.querySelector("#overlay .panel") ||
        document.querySelector(".panel") ||
        document.querySelector("#overlay");
      if (!panel) return;
      host = document.createElement("div");
      panel.appendChild(host);
    }
    if (host.dataset.mgMounted) return;
    host.dataset.mgMounted = "1";
    host.classList.add("mg");
    if (isLightContext(host)) host.classList.add("mg--light");
    host.innerHTML = "";

    var pool = GAMES.filter(function (g) { return !self || g.slug !== self; });
    var pick = shuffle(pool).slice(0, 2);
    if (!pick.length) return;

    injectStyle();
    var label = document.createElement("span");
    label.className = "mg-label";
    label.textContent = "More Games";
    host.appendChild(label);
    var row = document.createElement("div");
    row.className = "mg-row";
    pick.forEach(function (g) { row.appendChild(card(g, self)); });
    host.appendChild(row);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
