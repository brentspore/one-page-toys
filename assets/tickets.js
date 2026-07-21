/* One Page Toys — Tickets (Phase 1: silent earning engine)
 * Drop-in arcade-ticket economy. Include on any page, BEFORE the page's own script:
 *   <script src="/assets/tickets.js" defer></script>
 *
 * Earns tickets two ways, with zero per-toy code:
 *   1. Active time  — accrues only while the tab is visible AND the visitor has
 *      interacted recently. Per-toy daily cap stops idle-tab farming.
 *   2. Achievements — wraps localStorage.setItem and watches the score keys the
 *      toys already write (pool_best, nova_best, mines_best_*, sb_solves, ...).
 *      Awards scale with how much a personal best improved, log-shaped so a
 *      100,000-point arcade toy and a 3-stroke golf hole stay comparable.
 *
 * DARK LAUNCH: this always earns, but renders NO UI unless enabled. Turn the UI
 * on by visiting any page with ?tickets=1 (off again with ?tickets=0). Going
 * public later = flip UI_DEFAULT to true.
 *
 * The ledger is plain localStorage under `opt_tickets_v1`. It is trivially
 * editable by the visitor. That is fine and intended — this is for fun.
 *
 * Public API (also the hook for Phase 2's store):
 *   window.OPT_TICKETS.balance() / .lifetime() / .ledger()
 *   window.OPT_TICKETS.award(n, reason)      -> grant tickets from a toy
 *   window.OPT_TICKETS.spend(n, itemId)      -> returns false if too poor
 *   window.OPT_TICKETS.owned() / .own(id)
 *   window.OPT_TICKETS.on(fn)                -> fn(ledger, lastAward) on change
 *   window.OPT_TICKETS.showUI(bool) / .reset()
 */
(function () {
  "use strict";

  /* ---------------------------------------------------------------- config */

  var STORE_KEY = "opt_tickets_v1";
  var UI_FLAG_KEY = "opt_tickets_ui";
  var UI_DEFAULT = false; // <- flip to true to open tickets to everyone

  // Earning rates. These are the tuning knobs; see the backlog item
  // "Ticket system Phase 1 — real-play testing + economy tuning pass".
  var SEC_PER_TICKET = 60; // 1 ticket per minute of *active* play
  var DAILY_CAP_PER_TOY = 25; // max time-tickets per toy per day
  var IDLE_MS = 25000; // no input for this long = not playing
  var TICK_MS = 5000; // heartbeat resolution
  var DISCOVERY_BONUS = 15; // first ever visit to a given toy
  var FIRST_BEST = 8; // first recorded score on a toy
  var BEST_BASE = 6; // floor for beating a personal best
  var BEST_SCALE = 5; // how fast the log bonus grows
  var BEST_MAX = 30; // ceiling for a single achievement
  var COUNTER_AWARD = 4; // per increment of a counter key (solves, aces)
  var COUNTER_MAX_STEP = 5; // ignore counter jumps bigger than this (edited data)
  var LOG_MAX = 60; // recent-award entries kept for the debug console

  /* Score keys the toys already write. `dir` is what counts as an improvement:
   *   up    - bigger number is better (arcade score, accuracy %)
   *   down  - smaller number is better (time, strokes)
   *   count - a tally that only ever goes up; each increment is an achievement
   * `test` may be an exact string or a RegExp (for per-difficulty keys).
   * Anything not listed here is ignored — settings, sound flags, themes, and
   * bankrolls that legitimately go down (bj_bank) must NOT earn. */
  var RULES = [
    // higher is better
    { test: "alpenglow_best", dir: "up", label: "Alpenglow score" },
    { test: "coinpush_best", dir: "up", label: "Coin Pusher score" },
    { test: "descent_best", dir: "up", label: "Deep Descent depth" },
    { test: "dice_best", dir: "up", label: "Dice roll total" },
    { test: "dotloop_best", dir: "up", label: "Dot Loop score" },
    { test: "nova_best", dir: "up", label: "Nova Coil score" },
    { test: "plane_best", dir: "up", label: "Paper Plane distance" },
    { test: "pc_best", dir: "up", label: "Perfect Circle accuracy" },
    { test: "skyfortress_best", dir: "up", label: "Sky Fortress score" },
    { test: "slice_best", dir: "up", label: "Slice It score" },
    { test: "stack_best", dir: "up", label: "Stack Tower height" },
    { test: "trio_best", dir: "up", label: "Trio score" },
    { test: "shuriken_best", dir: "up", label: "Shuriken Night score" },
    { test: "snake:best", dir: "up", label: "Snake score" },
    { test: "opt-echo-best", dir: "up", label: "Echo sequence" },
    // lower is better
    { test: /^mines_best_/, dir: "down", label: "Minesweeper time" },
    { test: /^maze_best_/, dir: "down", label: "Maze time" },
    { test: /^trailfeed_best_/, dir: "down", label: "Trail Game time" },
    { test: /^sb_best_/, dir: "down", label: "Spelling Blocks time" },
    { test: "pool_best", dir: "down", label: "Pool strokes" },
    { test: /^golf_day_/, dir: "down", label: "Mini Golf round" },
    // tallies
    { test: "golf_aces", dir: "count", label: "Hole in one" },
    { test: "dice_streak", dir: "count", label: "Dice streak" },
    { test: "sb_solves", dir: "count", label: "Spelling Blocks solve" },
    { test: "trailfeed_solves", dir: "count", label: "Trail Game solve" }
  ];

  /* ------------------------------------------------------------- utilities */

  var writing = false; // re-entrancy guard for our own ledger writes

  function lsGet(k) {
    try {
      return window.localStorage.getItem(k);
    } catch (e) {
      return null; // private mode / storage disabled
    }
  }

  function lsSet(k, v) {
    try {
      writing = true;
      window.localStorage.setItem(k, v);
    } catch (e) {
      /* quota or private mode — tickets are cosmetic, never break the page */
    } finally {
      writing = false;
    }
  }

  function todayStamp() {
    var d = new Date();
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0")
    );
  }

  function num(v) {
    var n = parseFloat(v);
    return isFinite(n) ? n : null;
  }

  function ruleFor(key) {
    for (var i = 0; i < RULES.length; i++) {
      var t = RULES[i].test;
      if (typeof t === "string" ? t === key : t.test(key)) return RULES[i];
    }
    return null;
  }

  // Which toy are we on? Mirrors more-games.js selfSlug(), plus tools/.
  function pageSlug() {
    var path = location.pathname;
    var can = document.querySelector('link[rel="canonical"]');
    if (can && can.href) {
      try {
        path = new URL(can.href).pathname;
      } catch (e) {}
    }
    var m = path.match(/\/(toys|tools)\/([^\/]+)/);
    return m ? m[2] : null;
  }

  function pageName() {
    var t = (document.title || "").split("—")[0].split("|")[0].trim();
    return t || SLUG || "this page";
  }

  var SLUG = pageSlug();

  /* ---------------------------------------------------------------- ledger */

  function blank() {
    return {
      v: 1,
      balance: 0,
      lifetime: 0,
      owned: [],
      toys: {}, // slug -> {sec, tickets, plays, first, last}
      scores: {}, // score key -> last seen numeric value
      day: todayStamp(),
      dayEarn: {}, // slug -> time-tickets earned today
      log: [], // recent awards, newest first
      created: Date.now()
    };
  }

  var L = load();

  function load() {
    var raw = lsGet(STORE_KEY);
    if (!raw) return blank();
    try {
      var o = JSON.parse(raw);
      if (!o || typeof o !== "object" || o.v !== 1) return blank();
      // Defend against hand-edited ledgers — this is an editable-by-design file.
      var b = blank();
      for (var k in b) if (!(k in o)) o[k] = b[k];
      o.balance = Math.max(0, num(o.balance) || 0);
      o.lifetime = Math.max(0, num(o.lifetime) || 0);
      if (!Array.isArray(o.owned)) o.owned = [];
      if (!Array.isArray(o.log)) o.log = [];
      if (!o.toys || typeof o.toys !== "object") o.toys = {};
      if (!o.scores || typeof o.scores !== "object") o.scores = {};
      if (!o.dayEarn || typeof o.dayEarn !== "object") o.dayEarn = {};
      return o;
    } catch (e) {
      return blank();
    }
  }

  var saveTimer = null;
  function save(now) {
    if (now) {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      lsSet(STORE_KEY, JSON.stringify(L));
      return;
    }
    if (saveTimer) return;
    saveTimer = setTimeout(function () {
      saveTimer = null;
      lsSet(STORE_KEY, JSON.stringify(L));
    }, 4000);
  }

  function rollDay() {
    var t = todayStamp();
    if (L.day !== t) {
      L.day = t;
      L.dayEarn = {};
    }
  }

  var listeners = [];
  function emit(entry) {
    for (var i = 0; i < listeners.length; i++) {
      try {
        listeners[i](L, entry || null);
      } catch (e) {}
    }
    if (UI.el) UI.render();
  }

  function grant(n, reason, slug) {
    n = Math.max(0, Math.round(n));
    if (!n) return 0;
    rollDay();
    L.balance += n;
    L.lifetime += n;
    var s = slug || SLUG;
    if (s) {
      var t = L.toys[s] || (L.toys[s] = { sec: 0, tickets: 0, plays: 0, first: Date.now(), last: Date.now() });
      t.tickets += n;
      t.last = Date.now();
    }
    var entry = { t: Date.now(), n: n, why: reason || "bonus", slug: s || null };
    L.log.unshift(entry);
    if (L.log.length > LOG_MAX) L.log.length = LOG_MAX;
    save();
    emit(entry);
    return n;
  }

  /* ------------------------------------------------- achievement detection */

  function awardForScore(rule, key, prev, next) {
    if (next == null) return;
    if (prev == null) {
      // First time we've ever seen this key. Seeding (below) means this only
      // fires for a genuinely new achievement, not for pre-existing history.
      grant(FIRST_BEST, rule.label);
      return;
    }
    if (rule.dir === "count") {
      var step = next - prev;
      if (step <= 0 || step > COUNTER_MAX_STEP) return;
      grant(COUNTER_AWARD * step, rule.label + (step > 1 ? " ×" + step : ""));
      return;
    }
    var rel;
    if (rule.dir === "down") {
      if (!(next < prev)) return;
      rel = (prev - next) / Math.max(Math.abs(prev), 1e-6);
    } else {
      if (!(next > prev)) return;
      rel = (next - prev) / Math.max(Math.abs(prev), 1e-6);
    }
    // Log-shaped: a nudge past your best is worth a little, a huge leap a lot,
    // but never proportionally — otherwise big-number toys would dominate.
    var n = BEST_BASE + Math.round((BEST_SCALE * Math.log(1 + rel * 4)) / Math.LN2);
    grant(Math.min(n, BEST_MAX), "New best · " + rule.label);
  }

  function observe(key, value) {
    if (writing || key === STORE_KEY) return;
    var rule = ruleFor(key);
    if (!rule) return;
    var next = num(value);
    if (next == null) return;
    var prev = key in L.scores ? num(L.scores[key]) : null;
    L.scores[key] = next;
    awardForScore(rule, key, prev, next);
    save();
  }

  // Record every tracked key already on this device WITHOUT awarding, so an
  // existing player's historical bests don't all pay out on first load.
  function seed() {
    var seeded = false;
    try {
      for (var i = 0; i < window.localStorage.length; i++) {
        var k = window.localStorage.key(i);
        if (!k || k === STORE_KEY || k in L.scores) continue;
        if (!ruleFor(k)) continue;
        var v = num(window.localStorage.getItem(k));
        if (v != null) {
          L.scores[k] = v;
          seeded = true;
        }
      }
    } catch (e) {}
    if (seeded) save();
  }

  // Wrap Storage.prototype.setItem. The original runs FIRST and unmodified, so
  // even a bug in here can never stop a toy from saving its own state.
  function hookStorage() {
    try {
      var proto = window.Storage && window.Storage.prototype;
      if (!proto || proto.__optTicketsHooked) return;
      var orig = proto.setItem;
      proto.setItem = function (k, v) {
        var r = orig.apply(this, arguments);
        try {
          if (this === window.localStorage) observe(String(k), String(v));
        } catch (e) {
          /* never surface our own failure to the caller */
        }
        return r;
      };
      proto.__optTicketsHooked = true;
    } catch (e) {}
  }

  /* -------------------------------------------------------- time accrual */

  var lastInput = 0;
  var everInteracted = false;
  var carrySec = 0; // fractional seconds not yet converted to a ticket
  var heartbeat = null;

  function markInput() {
    lastInput = Date.now();
    if (!everInteracted) {
      everInteracted = true;
      if (SLUG) {
        rollDay();
        var t = L.toys[SLUG];
        if (!t) {
          t = L.toys[SLUG] = { sec: 0, tickets: 0, plays: 0, first: Date.now(), last: Date.now() };
          grant(DISCOVERY_BONUS, "Discovered " + pageName());
        }
        t.plays++;
        t.last = Date.now();
        save();
      }
    }
  }

  function tick() {
    if (!SLUG || !everInteracted) return;
    if (document.visibilityState !== "visible") return;
    if (Date.now() - lastInput > IDLE_MS) return;
    rollDay();
    var t = L.toys[SLUG];
    if (!t) return;
    t.sec += TICK_MS / 1000;
    t.last = Date.now();
    carrySec += TICK_MS / 1000;
    if (carrySec >= SEC_PER_TICKET) {
      var earned = Math.floor(carrySec / SEC_PER_TICKET);
      carrySec -= earned * SEC_PER_TICKET;
      var already = L.dayEarn[SLUG] || 0;
      var room = Math.max(0, DAILY_CAP_PER_TOY - already);
      var pay = Math.min(earned, room);
      if (pay > 0) {
        L.dayEarn[SLUG] = already + pay;
        grant(pay, "Played " + pageName());
      } else {
        save();
      }
    } else {
      save();
    }
  }

  function startClock() {
    if (heartbeat) return;
    heartbeat = setInterval(tick, TICK_MS);
    var opts = { passive: true, capture: true };
    ["pointerdown", "pointermove", "keydown", "touchstart", "wheel"].forEach(function (ev) {
      window.addEventListener(ev, throttledInput, opts);
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible") save(true);
    });
    window.addEventListener("pagehide", function () {
      save(true);
    });
  }

  var inputThrottle = 0;
  function throttledInput() {
    var now = Date.now();
    if (now - inputThrottle < 400) {
      lastInput = now;
      return;
    }
    inputThrottle = now;
    markInput();
  }

  /* ------------------------------------------------------------------- UI */

  var UI = { el: null, panel: null, open: false };

  function uiEnabled() {
    var q = null;
    try {
      q = new URLSearchParams(location.search).get("tickets");
    } catch (e) {}
    if (q === "1") lsSet(UI_FLAG_KEY, "1");
    if (q === "0") lsSet(UI_FLAG_KEY, "0");
    var f = lsGet(UI_FLAG_KEY);
    if (f === "1") return true;
    if (f === "0") return false;
    return UI_DEFAULT;
  }

  function injectStyles() {
    if (document.getElementById("opt-tickets-style")) return;
    var css =
      // Bottom-LEFT: the tip jar and fullscreen badges own the right edge.
      // Self-contained colors (never inherit) so it reads on light tools pages
      // and dark full-bleed toys alike.
      ".opt-tickets{position:fixed;left:max(14px,env(safe-area-inset-left));bottom:max(14px,env(safe-area-inset-bottom));z-index:2147482000;" +
      "font-family:'Geist Mono',ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1;}" +
      ".opt-tickets__pill{display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 12px;border-radius:999px;" +
      "background:rgba(17,17,19,.92);color:#fff;border:1px solid rgba(255,255,255,.28);cursor:pointer;" +
      "box-shadow:0 4px 14px rgba(0,0,0,.34);letter-spacing:.06em;font-weight:600;" +
      "-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);transition:transform .16s ease,border-color .16s ease;}" +
      ".opt-tickets__pill:hover{transform:translateY(-1px);border-color:rgba(255,255,255,.5);}" +
      ".opt-tickets__pill:focus-visible{outline:2px solid #e5484d;outline-offset:2px;}" +
      ".opt-tickets__n{font-variant-numeric:tabular-nums;}" +
      ".opt-tickets__dot{width:6px;height:6px;border-radius:50%;background:#e5484d;opacity:0;transition:opacity .3s ease;}" +
      ".opt-tickets.is-fresh .opt-tickets__dot{opacity:1;}" +
      ".opt-tickets__panel{position:absolute;left:0;bottom:40px;width:min(84vw,290px);max-height:min(58vh,420px);overflow:auto;" +
      "background:rgba(17,17,19,.97);color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:12px;padding:12px 13px;" +
      "box-shadow:0 12px 34px rgba(0,0,0,.46);display:none;-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);}" +
      ".opt-tickets.is-open .opt-tickets__panel{display:block;}" +
      ".opt-tickets__h{font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.5);margin:0 0 8px;}" +
      ".opt-tickets__big{font-size:26px;font-weight:700;letter-spacing:-.01em;margin-bottom:2px;font-variant-numeric:tabular-nums;}" +
      ".opt-tickets__sub{font-size:10px;color:rgba(255,255,255,.55);margin-bottom:11px;line-height:1.5;}" +
      ".opt-tickets__row{display:flex;justify-content:space-between;gap:10px;padding:4px 0;font-size:10.5px;border-top:1px solid rgba(255,255,255,.09);}" +
      ".opt-tickets__row span:first-child{color:rgba(255,255,255,.72);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}" +
      ".opt-tickets__row span:last-child{color:#fff;font-variant-numeric:tabular-nums;flex:0 0 auto;}" +
      ".opt-tickets__foot{margin-top:11px;display:flex;gap:6px;}" +
      ".opt-tickets__btn{flex:1;background:rgba(255,255,255,.09);color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:7px;" +
      "padding:6px 8px;font:inherit;font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;}" +
      ".opt-tickets__btn:hover{background:rgba(255,255,255,.16);}" +
      "@media (prefers-reduced-motion:reduce){.opt-tickets__pill{transition:none;}}";
    var style = document.createElement("style");
    style.id = "opt-tickets-style";
    style.textContent = css;
    document.head.appendChild(style);
  }

  function fmtAgo(t) {
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return Math.floor(s / 86400) + "d ago";
  }

  UI.render = function () {
    if (!UI.el) return;
    UI.el.querySelector(".opt-tickets__n").textContent = L.balance;
    if (!UI.open) return;
    var here = SLUG ? L.toys[SLUG] : null;
    var rows = "";
    rows +=
      '<div class="opt-tickets__row"><span>Lifetime earned</span><span>' + L.lifetime + "</span></div>";
    if (here) {
      rows +=
        '<div class="opt-tickets__row"><span>From ' +
        esc(pageName()) +
        "</span><span>" +
        here.tickets +
        "</span></div>";
      rows +=
        '<div class="opt-tickets__row"><span>Active time here</span><span>' +
        Math.round(here.sec / 60) +
        "m</span></div>";
      rows +=
        '<div class="opt-tickets__row"><span>Today (cap ' +
        DAILY_CAP_PER_TOY +
        ")</span><span>" +
        (L.dayEarn[SLUG] || 0) +
        "</span></div>";
    }
    rows +=
      '<div class="opt-tickets__row"><span>Toys visited</span><span>' +
      Object.keys(L.toys).length +
      "</span></div>";
    var log = "";
    for (var i = 0; i < Math.min(L.log.length, 8); i++) {
      var e = L.log[i];
      log +=
        '<div class="opt-tickets__row"><span>' +
        esc(e.why) +
        "</span><span>+" +
        e.n +
        " · " +
        fmtAgo(e.t) +
        "</span></div>";
    }
    UI.panel.innerHTML =
      '<div class="opt-tickets__big">' +
      L.balance +
      '</div><div class="opt-tickets__sub">tickets · earning silently (test mode)</div>' +
      '<p class="opt-tickets__h">Breakdown</p>' +
      rows +
      (log ? '<p class="opt-tickets__h" style="margin-top:12px">Recent</p>' + log : "") +
      '<div class="opt-tickets__foot">' +
      '<button class="opt-tickets__btn" data-act="hide">Hide UI</button>' +
      '<button class="opt-tickets__btn" data-act="reset">Reset</button>' +
      "</div>";
  };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function mountUI() {
    if (UI.el || !document.body) return;
    injectStyles();
    var wrap = document.createElement("div");
    wrap.className = "opt-tickets";
    wrap.innerHTML =
      '<div class="opt-tickets__panel"></div>' +
      '<button class="opt-tickets__pill" type="button" aria-label="Tickets">' +
      '<span aria-hidden="true">🎟</span><span class="opt-tickets__n">0</span>' +
      '<span class="opt-tickets__dot" aria-hidden="true"></span></button>';
    document.body.appendChild(wrap);
    UI.el = wrap;
    UI.panel = wrap.querySelector(".opt-tickets__panel");
    wrap.querySelector(".opt-tickets__pill").addEventListener("click", function (ev) {
      ev.stopPropagation();
      UI.open = !UI.open;
      wrap.classList.toggle("is-open", UI.open);
      wrap.classList.remove("is-fresh");
      UI.render();
    });
    UI.panel.addEventListener("click", function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-act]");
      if (!b) return;
      if (b.getAttribute("data-act") === "hide") {
        lsSet(UI_FLAG_KEY, "0");
        wrap.remove();
        UI.el = null;
      } else if (b.getAttribute("data-act") === "reset") {
        L = blank();
        seed();
        save(true);
        UI.render();
      }
    });
    document.addEventListener("click", function () {
      if (!UI.open) return;
      UI.open = false;
      wrap.classList.remove("is-open");
    });
    UI.render();
    listeners.push(function () {
      wrap.classList.add("is-fresh");
    });
    dock();
    window.addEventListener("resize", dock);
    window.addEventListener("orientationchange", dock);
  }

  // 78 toy pages park their "onepagetoys.com" back-link in the bottom-left
  // corner — exactly where this pill sits — so it printed straight over the
  // URL. Measure whatever is down there and sit above it rather than hard-
  // coding a lift, because the corner text wraps to two lines on narrow
  // screens and safe-area insets move it again on a notched phone.
  function dock() {
    var el = UI.el;
    if (!el) return;
    el.style.bottom = "";
    var occupants = document.querySelectorAll(".frame__corner--bl, [data-tickets-avoid]");
    var pill = el.querySelector(".opt-tickets__pill");
    var pr = (pill || el).getBoundingClientRect();
    var vh = window.innerHeight || 0;
    var lift = 0;
    for (var i = 0; i < occupants.length; i++) {
      var r = occupants[i].getBoundingClientRect();
      if (!r.width || !r.height) continue;              // hidden
      if (r.top > vh - 4 || r.bottom < vh - 160) continue; // not in the bottom band
      if (r.left > pr.right + 10) continue;             // not in our column
      lift = Math.max(lift, vh - r.top + 10);
    }
    if (lift > 0) el.style.bottom = Math.round(lift) + "px";
  }

  /* ------------------------------------------------------------------ API */

  window.OPT_TICKETS = {
    balance: function () {
      return L.balance;
    },
    lifetime: function () {
      return L.lifetime;
    },
    ledger: function () {
      return JSON.parse(JSON.stringify(L));
    },
    award: function (n, reason) {
      return grant(n, reason || "bonus");
    },
    spend: function (n, itemId) {
      n = Math.max(0, Math.round(n || 0));
      if (L.balance < n) return false;
      L.balance -= n;
      if (itemId && L.owned.indexOf(itemId) === -1) L.owned.push(itemId);
      L.log.unshift({ t: Date.now(), n: -n, why: "Bought " + (itemId || "something"), slug: SLUG });
      if (L.log.length > LOG_MAX) L.log.length = LOG_MAX;
      save(true);
      emit(null);
      return true;
    },
    owned: function () {
      return L.owned.slice();
    },
    own: function (id) {
      return L.owned.indexOf(id) !== -1;
    },
    on: function (fn) {
      if (typeof fn === "function") listeners.push(fn);
    },
    showUI: function (v) {
      lsSet(UI_FLAG_KEY, v ? "1" : "0");
      if (v) mountUI();
      else if (UI.el) {
        UI.el.remove();
        UI.el = null;
      }
    },
    reset: function () {
      L = blank();
      seed();
      save(true);
      emit(null);
    },
    slug: SLUG,
    RULES: RULES
  };

  /* ----------------------------------------------------------------- boot */

  hookStorage(); // install before anything else can write
  seed();
  rollDay();

  function boot() {
    startClock();
    if (uiEnabled()) mountUI();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
