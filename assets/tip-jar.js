/* One Page Toys — Tip Jar
 * Drop-in support component. Include on any page:
 *   <script src="/assets/tip-jar.js" defer></script>
 *
 * Renders a small fixed "Tip Jar" button that opens a PayPal donation in a new
 * tab. Toys are free; tips are optional. Self-contained — injects its own styles.
 *
 * Optional overrides via a global before this script loads:
 *   window.OPT_TIPJAR = { business: "you@example.com", label: "Tip Jar",
 *                         tooltip: "Buy us a coffee ☕", item: "One Page Toys" };
 */
(function () {
  "use strict";

  var CFG = window.OPT_TIPJAR || {};
  var BUSINESS = CFG.business || "brent@mightyarmy.com";
  var LABEL = CFG.label || "Tip Jar";
  var TOOLTIP = CFG.tooltip || "Support One Page Toys";
  var ITEM = CFG.item || "One Page Toys";

  function donateUrl() {
    return (
      "https://www.paypal.com/donate?business=" +
      encodeURIComponent(BUSINESS) +
      "&item_name=" +
      encodeURIComponent(ITEM + " — tip jar") +
      "&currency_code=USD"
    );
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
      "@media (max-width:560px){.opt-tipjar{right:max(8px, env(safe-area-inset-right));height:40px;}.opt-tipjar__jar{width:38px;height:38px;}.opt-tipjar__logo{height:22px;}.opt-tipjar:hover .opt-tipjar__label,.opt-tipjar:focus-visible .opt-tipjar__label{max-width:110px;padding-left:12px;}}" +
      "@media (prefers-reduced-motion:reduce){.opt-tipjar,.opt-tipjar__label{transition:none;}.opt-tipjar.tj-nudge{animation:none;}}";
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
    a.addEventListener("click", function () {
      try {
        if (typeof window.gtag === "function") {
          window.gtag("event", "tip_jar_click", { page: location.pathname });
        }
      } catch (e) {
        /* best-effort */
      }
    });
    document.body.appendChild(a);
    scheduleNudge(a);
  }

  // Gently draw attention every so often until the visitor engages with it.
  function scheduleNudge(a) {
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    var count = 0, timer = null, done = false;
    function stop() {
      done = true;
      if (timer) clearTimeout(timer);
      a.classList.remove("tj-nudge");
    }
    function nudge() {
      if (done) return;
      a.classList.remove("tj-nudge");
      void a.offsetWidth;
      a.classList.add("tj-nudge");
      count++;
      if (count < 5) timer = setTimeout(nudge, 24000 + Math.random() * 9000);
    }
    a.addEventListener("animationend", function () { a.classList.remove("tj-nudge"); });
    ["pointerenter", "click", "focus"].forEach(function (ev) {
      a.addEventListener(ev, stop);
    });
    timer = setTimeout(nudge, 9000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
