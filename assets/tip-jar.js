/* One Page Toys — Tip Jar
 * Drop-in support component. Include on any page:
 *   <script src="/assets/tip-jar.js" defer></script>
 *
 * Renders a small fixed "Tip Jar" button that opens the Ko-fi tip page in a new
 * tab. Toys are free; tips are optional. Self-contained — injects its own styles.
 *
 * The ask (owner, 2026-10-12): the badge no longer wiggles on a timer, which
 * nudged first-time visitors in the middle of play. Instead, once a visitor has
 * finished ASK_AFTER games anywhere on the site, the end-of-game panel gets one
 * quiet line asking for a tip and the badge nudges once. A game has finished
 * when the toy's start / play-again button (the selector game-screen.js uses)
 * comes back on screen after at least MIN_GAME_MS of play with real input in
 * between. The ask then rests for ASK_COOLDOWN_DAYS, and never returns after a
 * tip-jar click. Pages without such a button just show the badge.
 * State: localStorage `opt_tipjar_v1` = { games, asked, clicked }.
 *
 * Optional overrides via a global before this script loads:
 *   window.OPT_TIPJAR = { url: "https://ko-fi.com/…", label: "Tip Jar", tooltip: "Buy us a coffee ☕" };
 */
(function () {
  "use strict";

  var CFG = window.OPT_TIPJAR || {};
  // Where a tip goes: the Ko-fi page (owner, 2026-10-12; its username is synergyprod
  // since 2026-10-16). It takes PayPal and Stripe, so cards, Apple Pay and Google Pay
  // too. It is the only destination: the old PayPal donate fallback carried a personal
  // address, and nothing public names a person (owner, 2026-10-14).
  var TIP_URL = CFG.url || "https://ko-fi.com/synergyprod";
  var LABEL = CFG.label || "Tip Jar";
  var TOOLTIP = CFG.tooltip || "Support One Page Toys";

  // The ask, see the header
  var START = ["button#ovBtn", "button.play-btn", "[data-opt-start]"]; // preference order
  var ASK_AFTER = 3; // finished games, site-wide, before the first ask
  var ASK_COOLDOWN_DAYS = 21;
  var MIN_GAME_MS = 1000; // shorter than this, or no input, is a panel flicker, not a game
  var POLL_MS = 400;
  var STATE_KEY = "opt_tipjar_v1";
  var ASK_TEXT = "Having fun? Every toy here is free and made by one person.";
  var ASK_LINK = "Leave a tip";

  function donateUrl() {
    return TIP_URL;
  }

  function injectStyles() {
    if (document.getElementById("opt-tipjar-style")) return;
    var css =
      // A round Mighty Army badge docked at right-center; expands to a pill on hover/focus.
      ".opt-tipjar{position:fixed;right:max(16px, env(safe-area-inset-right));top:50%;transform:translateY(-50%);z-index:2147483000;" +
      "display:inline-flex;align-items:center;height:46px;overflow:hidden;--tj-bg:#fff;" +
      "background:#fff;color:#211f1d;border:1.5px solid #211f1d;border-radius:999px;" +
      "box-shadow:0 6px 20px rgba(33,31,29,.22);cursor:pointer;text-decoration:none;" +
      "transition:background .16s ease,color .16s ease,box-shadow .16s ease;}" +
      ".opt-tipjar__jar{flex:0 0 auto;width:44px;height:44px;display:grid;place-items:center;}" +
      ".opt-tipjar__logo{height:26px;width:auto;display:block;}" +
      ".opt-tipjar__label{max-width:0;opacity:0;overflow:hidden;white-space:nowrap;" +
      "font-family:'Archivo',system-ui,-apple-system,'Segoe UI',sans-serif;" +
      "font-size:.72rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase;" +
      "transition:max-width .26s cubic-bezier(.2,.85,.25,1),opacity .2s ease,padding .26s ease;}" +
      ".opt-tipjar:hover,.opt-tipjar:focus-visible{background:#941e1e;color:#fff;border-color:#941e1e;--tj-bg:#941e1e;outline:none;}" +
      ".opt-tipjar:hover .opt-tipjar__label,.opt-tipjar:focus-visible .opt-tipjar__label{max-width:140px;opacity:1;padding-left:16px;}" +
      ".opt-tipjar:focus-visible{box-shadow:0 0 0 2px #fff,0 0 0 5px rgba(148,30,30,.55),0 6px 20px rgba(33,31,29,.22);}" +
      "@keyframes tjNudge{0%,100%{transform:translateY(-50%) scale(1) rotate(0)}14%{transform:translateY(-50%) scale(1.14) rotate(-8deg)}32%{transform:translateY(-50%) scale(1.08) rotate(7deg)}50%{transform:translateY(-50%) scale(1.1) rotate(-4deg)}70%{transform:translateY(-50%) scale(1.04) rotate(2deg)}}" +
      "@keyframes tjRing{0%{box-shadow:0 6px 20px rgba(33,31,29,.22),0 0 0 0 rgba(148,30,30,.45)}100%{box-shadow:0 6px 20px rgba(33,31,29,.22),0 0 0 18px rgba(148,30,30,0)}}" +
      ".opt-tipjar.tj-nudge{animation:tjNudge 950ms cubic-bezier(.36,.07,.19,.97),tjRing 950ms ease-out;}" +
      // tj-open = the hover state, held open for a moment by the ask (phones never hover)
      ".opt-tipjar.tj-open{background:#941e1e;color:#fff;border-color:#941e1e;--tj-bg:#941e1e;}" +
      ".opt-tipjar.tj-open .opt-tipjar__label{max-width:140px;opacity:1;padding-left:16px;}" +
      // the ask line, under the end-of-game panel's play-again button (cf. game-screen.js .opt-ios-tip)
      ".opt-tipask{display:block;max-width:340px;margin:14px auto 2px;text-align:center;text-wrap:balance;" +
      "font-size:12px;font-weight:500;line-height:1.55;letter-spacing:0;text-transform:none;" +
      "color:inherit;opacity:.78;animation:tjAskIn .5s ease .2s backwards;}" +
      ".opt-tipask .opt-tipask__go{color:inherit;font-weight:700;text-decoration:underline;text-underline-offset:2px;" +
      "display:inline-block;padding:8px 3px;margin:-8px -3px;cursor:pointer;pointer-events:auto;white-space:nowrap;}" +
      ".opt-tipask .opt-tipask__go:focus-visible{outline:2px solid currentColor;outline-offset:1px;border-radius:4px;}" +
      "@keyframes tjAskIn{from{opacity:0;transform:translateY(4px)}}" +
      "@media (max-width:560px){.opt-tipjar{right:max(8px, env(safe-area-inset-right));height:40px;}.opt-tipjar__jar{width:38px;height:38px;}.opt-tipjar__logo{height:22px;}.opt-tipjar:hover .opt-tipjar__label,.opt-tipjar:focus-visible .opt-tipjar__label,.opt-tipjar.tj-open .opt-tipjar__label{max-width:110px;padding-left:12px;}}" +
      "@media (prefers-reduced-motion:reduce){.opt-tipjar,.opt-tipjar__label{transition:none;}.opt-tipjar.tj-nudge{animation:none;}.opt-tipask{animation:none;}}";
    var style = document.createElement("style");
    style.id = "opt-tipjar-style";
    style.textContent = css;
    document.head.appendChild(style);
  }

  function mount() {
    if (document.querySelector(".opt-tipjar")) return;
    injectStyles();
    var a = document.createElement("a");
    a.className = "opt-tipjar";
    a.href = donateUrl();
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.title = TOOLTIP;
    a.setAttribute("aria-label", LABEL + " — " + TOOLTIP);
    a.innerHTML =
      '<span class="opt-tipjar__label">' + LABEL + "</span>" +
      '<span class="opt-tipjar__jar" aria-hidden="true">' +
        '<svg class="opt-tipjar__logo" viewBox="0 0 38.5 64.5" xmlns="http://www.w3.org/2000/svg">' +
          '<polygon fill="currentColor" points="38.5,53.7 19.3,45 0,53.7 0,0 38.5,0"/>' +
          '<polygon fill="currentColor" points="19.3,50.3 0,59.1 0,64.5 19.3,55.7 38.5,64.5 38.5,59.1"/>' +
          '<polygon style="fill:var(--tj-bg,#fff)" points="19.3,19.3 21.5,26.1 28.7,26.1 22.9,30.3 25.1,37.2 19.3,32.9 13.5,37.2 15.7,30.3 9.9,26.1 17,26.1"/>' +
        "</svg>" +
      "</span>";
    a.addEventListener("click", function () { tipped("badge"); });
    a.addEventListener("animationend", function () { a.classList.remove("tj-nudge"); });
    document.body.appendChild(a);
    watchGames(a);
  }

  /* ------------------------------------------------------------- the ask */

  function readState() {
    try { return JSON.parse(window.localStorage.getItem(STATE_KEY)) || {}; } catch (e) { return {}; }
  }
  function writeState(s) {
    try { window.localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (e) {}
  }
  function track(name, params) {
    try { if (typeof window.gtag === "function") window.gtag("event", name, params); } catch (e) {}
  }
  function tipped(source) {
    track("tip_jar_click", { page: location.pathname, source: source });
    var s = readState();
    s.clicked = Date.now();
    writeState(s);
  }

  function onScreen(el) {
    if (!el.isConnected || !el.getClientRects().length) return false;
    if (el.checkVisibility) return el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      var cs = getComputedStyle(n);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0) return false;
    }
    return true;
  }
  function startButton() {
    for (var i = 0; i < START.length; i++) {
      var list = document.querySelectorAll(START[i]);
      for (var j = 0; j < list.length; j++) if (onScreen(list[j])) return list[j];
    }
    return null;
  }

  // The line goes after the button, or after the row or grid of buttons it sits
  // in (Chess's result buttons), never inside one. A TALL grid (Checkers'
  // opponent picker) gets it above instead, or it would land below the fold.
  function anchorFor(btn) {
    var a = btn;
    for (var i = 0; i < 3 && a.parentElement && a.parentElement !== document.body; i++) {
      var cs = getComputedStyle(a.parentElement);
      var row = cs.display.indexOf("grid") !== -1 ||
        (cs.display.indexOf("flex") !== -1 && cs.flexDirection.indexOf("column") !== 0);
      if (!row || cs.position === "fixed") break;
      a = a.parentElement;
    }
    return a;
  }

  function watchGames(badge) {
    if (!document.querySelector(START.join(","))) return; // not a game page
    var was = null, hiddenAt = 0, hits = 0, quietUntil = 0, line = null, askedHere = false;

    // real input while the panel is away is what makes it a game
    function hit(e) { if (was === false && !(e && badge.contains(e.target))) hits++; }
    window.addEventListener("pointerdown", hit, true);
    window.addEventListener("keydown", hit, true);
    // a pause panel that shows because the tab went away is not a game over
    document.addEventListener("visibilitychange", function () { quietUntil = Date.now() + 1500; });

    function removeLine() {
      if (line && line.parentNode) line.parentNode.removeChild(line);
      line = null;
    }
    function placeLine(btn) {
      var at = anchorFor(btn);
      var tall = at !== btn && at.getBoundingClientRect().height > window.innerHeight * 0.4;
      at.parentNode.insertBefore(line, tall ? at : at.nextSibling);
      return at;
    }

    function ask(btn, games) {
      line = document.createElement("div");
      line.className = "opt-tipask";
      line.appendChild(document.createTextNode(ASK_TEXT + " "));
      var go = document.createElement("a");
      go.className = "opt-tipask__go";
      go.href = donateUrl();
      go.target = "_blank";
      go.rel = "noopener noreferrer";
      go.textContent = ASK_LINK;
      // some panels start the next game on any press; this one is ours
      ["pointerdown", "mousedown", "touchstart"].forEach(function (t) {
        go.addEventListener(t, function (e) { e.stopPropagation(); }, { passive: true });
      });
      go.addEventListener("click", function (e) { e.stopPropagation(); tipped("ask"); });
      line.appendChild(go);
      var at = placeLine(btn);
      // Panels often color each text element rather than the panel itself, so
      // inheriting can land on the page default (black on a dark panel). Borrow
      // the color of the panel's own body text instead.
      var panel = at.closest("#overlay .panel, .panel, [role=dialog]") || at.parentElement;
      // (the longest paragraph: the first is often a colored kicker)
      var ref = panel, most = 0, ps = panel.querySelectorAll("p");
      for (var i = 0; i < ps.length; i++) {
        var len = ps[i].textContent.length;
        if (len > most && onScreen(ps[i])) { most = len; ref = ps[i]; }
      }
      // Body text is often already translucent; take it solid and dim the line
      // ourselves, so the two never stack into something unreadable.
      var c = getComputedStyle(ref).color.match(/[\d.]+/g) || [];
      if (c.length >= 3) {
        line.style.color = "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
        if (c.length > 3 && +c[3] < 1) line.style.opacity = Math.max(+c[3], 0.62);
      }
      track("tip_ask_shown", { page: location.pathname, games: games });

      if (!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) {
        badge.classList.remove("tj-nudge");
        void badge.offsetWidth;
        badge.classList.add("tj-nudge");
      }
      // Open the badge to show its label, unless the open pill would cover the panel
      var b = badge.getBoundingClientRect(), p = panel.getBoundingClientRect();
      if (b.left - 110 > p.right || b.top > p.bottom || b.bottom < p.top) {
        badge.classList.add("tj-open");
        setTimeout(function () { badge.classList.remove("tj-open"); }, 6000);
      }
      // a toy that refills its panel just after showing it would wipe the line
      setTimeout(function () {
        if (!line || line.isConnected) return;
        var again = startButton();
        if (again) placeLine(again);
      }, 900);
    }

    function gameOver(btn) {
      var s = readState(), now = Date.now();
      s.games = (s.games || 0) + 1;
      var due = !askedHere && s.games >= ASK_AFTER && !s.clicked &&
        (!s.asked || now - s.asked > ASK_COOLDOWN_DAYS * 864e5);
      if (due) s.asked = now;
      writeState(s);
      if (due) { askedHere = true; ask(btn, s.games); }
    }

    function tick() {
      var btn = startButton(), vis = !!btn, now = Date.now();
      var quiet = was === null || document.hidden || now < quietUntil;
      if (!vis && was !== false) {
        hiddenAt = now;
        hits = 0;
        removeLine();
      } else if (vis && was === false && !quiet && now - hiddenAt >= MIN_GAME_MS && hits > 0) {
        gameOver(btn);
      }
      was = vis;
    }
    tick();
    setInterval(tick, POLL_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
