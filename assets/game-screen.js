/* One Page Toys — just the game on the screen.
 * Drop-in, like fullscreen.js: <script src="../../assets/game-screen.js" defer></script>
 *
 * On a phone, the browser's own gestures get in the way of play. This turns
 * them off for a full-bleed toy (owner, 2026-09-24: "is there any way to turn
 * off the zooming and native phone options and just have the game on the
 * screen?"):
 *   - no pinch or double-tap zoom. CSS touch-action covers Android; iPhone Safari
 *     ignores user-scalable=no and has to have its pinch GESTURE events cancelled.
 *   - no pull-to-refresh or rubber-band scrolling,
 *   - no text selection, magnifier or long-press menu, except inside text fields,
 *   - on Android, pressing the toy's start button goes truly full screen and hides
 *     the browser bars. Once per visit, so leaving full screen on purpose sticks.
 *   - on iPhone, where no web page can hide Safari's bars, a one-line tip under the
 *     start button says how: Add to Home Screen (each page carries the
 *     apple-mobile-web-app meta that makes that launch full screen). Once a session.
 *
 * touch-action is pan-x pan-y, not none: it removes zoom but keeps panning, so a
 * start panel that has to scroll on a short screen still scrolls. A toy's own
 * canvas can still say none.
 *
 * Opt out per page with <body data-opt-native="keep">.
 */
(function () {
  "use strict";

  if (document.body && document.body.getAttribute("data-opt-native") === "keep") return;

  var START = "button#ovBtn, button.play-btn, [data-opt-start]";
  var coarse = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);

  if (!document.getElementById("opt-gs-style")) {
    var st = document.createElement("style");
    st.id = "opt-gs-style";
    st.textContent =
      "html,body{touch-action:pan-x pan-y;overscroll-behavior:none;" +
      "-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;" +
      "-webkit-text-size-adjust:100%;text-size-adjust:100%;}" +
      "input,textarea,select,[contenteditable]{-webkit-user-select:text;user-select:text;-webkit-touch-callout:default;}" +
      ".opt-ios-tip{display:block;max-width:340px;margin:12px auto 0;text-align:center;" +
      "font:500 12px/1.55 system-ui,-apple-system,'Segoe UI',sans-serif;color:inherit;opacity:.72;}" +
      ".opt-ios-tip b{font-weight:700;opacity:1;}";
    (document.head || document.documentElement).appendChild(st);
  }

  // iPhone pinch: Safari fires these even with user-scalable=no
  ["gesturestart", "gesturechange", "gestureend"].forEach(function (t) {
    document.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false });
  });
  // a two-finger move is a zoom everywhere else; one finger is left alone
  document.addEventListener("touchmove", function (e) {
    if (e.touches && e.touches.length > 1) e.preventDefault();
  }, { passive: false });

  // Android: full screen on the first press of the toy's start button
  var docEl = document.documentElement;
  var req = docEl.requestFullscreen || docEl.webkitRequestFullscreen;
  var fsTried = false;
  document.addEventListener("click", function (e) {
    if (fsTried || !coarse || !req) return;
    var t = e.target && e.target.closest ? e.target.closest(START) : null;
    if (!t) return;
    fsTried = true;
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    try { var r = req.call(docEl, { navigationUI: "hide" }); if (r && r.catch) r.catch(function () {}); } catch (err) {}
  }, true);

  // iPhone: say how to get the game alone on the screen
  var iPhone = /iPhone|iPod/.test(navigator.userAgent) && !navigator.standalone;
  if (!iPhone) return;
  try { if (sessionStorage.getItem("opt-ios-tip")) return; } catch (e) {}
  var btn = document.querySelector("#overlay .panel " + START.split(", ").join(", #overlay .panel "));
  if (!btn || !btn.parentNode) return;
  var tip = document.createElement("p");
  tip.className = "opt-ios-tip";
  tip.innerHTML = "For the game alone on your screen, tap <b>Share</b> then <b>Add to Home Screen</b> and play it from there.";
  btn.parentNode.insertBefore(tip, btn.nextSibling);
  try { sessionStorage.setItem("opt-ios-tip", "1"); } catch (e) {}
  // gone once you start; it has done its job
  btn.addEventListener("click", function () { if (tip.parentNode) tip.parentNode.removeChild(tip); });
})();
