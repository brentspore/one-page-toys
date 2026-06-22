/* One Page Toys — full-screen toggle
 * Drop-in: <script src="/assets/fullscreen.js" defer></script>
 * Injects a small button (bottom-right) that toggles document full screen.
 * Self-hides where the Fullscreen API is unavailable (e.g. iPhone Safari).
 */
(function () {
  "use strict";

  var docEl = document.documentElement;
  var req = docEl.requestFullscreen || docEl.webkitRequestFullscreen || docEl.msRequestFullscreen;
  if (!req) return; // unsupported — don't show a dead button

  function fsEl() { return document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement || null; }
  function enter() { try { req.call(docEl); } catch (e) {} }
  function exit() {
    var fn = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    if (fn) try { fn.call(document); } catch (e) {}
  }

  function injectStyles() {
    if (document.getElementById("opt-fs-style")) return;
    var css =
      ".opt-fs{position:fixed;right:16px;bottom:16px;z-index:2147482000;width:40px;height:40px;" +
      "display:grid;place-items:center;padding:0;cursor:pointer;border:1px solid rgba(255,255,255,.18);" +
      "border-radius:10px;background:rgba(18,18,22,.45);color:rgba(255,255,255,.72);" +
      "backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);" +
      "transition:background .15s ease,color .15s ease,border-color .15s ease;}" +
      ".opt-fs:hover{background:rgba(42,42,50,.72);color:#fff;border-color:rgba(255,255,255,.45);}" +
      ".opt-fs:focus-visible{outline:none;box-shadow:0 0 0 2px rgba(0,0,0,.5),0 0 0 4px rgba(255,255,255,.55);}" +
      ".opt-fs svg{width:18px;height:18px;display:block;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}" +
      "@media(max-width:560px){.opt-fs{width:36px;height:36px;right:10px;bottom:10px;}}";
    var st = document.createElement("style");
    st.id = "opt-fs-style";
    st.textContent = css;
    document.head.appendChild(st);
  }

  var EXPAND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
  var COMPRESS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';

  function mount() {
    if (document.querySelector(".opt-fs")) return;
    injectStyles();
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "opt-fs";
    btn.title = "Full screen";
    btn.setAttribute("aria-label", "Toggle full screen");
    btn.innerHTML = EXPAND;
    btn.addEventListener("click", function () { if (fsEl()) exit(); else enter(); });
    function sync() { btn.innerHTML = fsEl() ? COMPRESS : EXPAND; btn.title = fsEl() ? "Exit full screen" : "Full screen"; }
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    document.body.appendChild(btn);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
