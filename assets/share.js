/* One Page Toys — shared "Share this toy" button.
 * Drop-in (like tip-jar.js): include the script and it injects a quiet share pill
 * into the toy's overlay panel (`#overlay .panel`) under the main CTA — visible on
 * both the intro and end-game screens, where the urge to share peaks.
 * - Mobile: native Web Share sheet (navigator.share).
 * - Desktop/fallback: copies "<text> <url>" to the clipboard → "Link copied!".
 * - A toy can personalize the message (e.g. include the score) by setting
 *   `window.OPT_SHARE_TEXT` any time before the user taps share.
 */
(function () {
  "use strict";

  function init() {
    var panel = document.querySelector("#overlay .panel");
    if (!panel || document.getElementById("opt-share-style")) return;

    var style = document.createElement("style");
    style.id = "opt-share-style";
    style.textContent =
      ".opt-share{display:inline-flex;align-items:center;gap:7px;margin-top:14px;padding:9px 16px;" +
      "border:1px solid rgba(128,128,128,0.35);border-radius:999px;background:transparent;color:inherit;" +
      "font:inherit;font-size:0.85em;font-weight:700;opacity:0.72;cursor:pointer;" +
      "-webkit-tap-highlight-color:transparent;transition:opacity 140ms ease;}" +
      ".opt-share:hover{opacity:1;}" +
      ".opt-share:focus-visible{outline:2px solid currentColor;outline-offset:2px;opacity:1;}" +
      ".opt-share svg{width:14px;height:14px;display:block;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}";
    document.head.appendChild(style);

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "opt-share";
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13"/></svg>' +
      "<span>Share this toy</span>";
    panel.appendChild(btn);
    var label = btn.querySelector("span");

    function payload() {
      var canonical = document.querySelector('link[rel="canonical"]');
      var url = (canonical && canonical.href) || location.href;
      var name = (document.title || "One Page Toys").split("—")[0].trim();
      var text = window.OPT_SHARE_TEXT || ("Come play " + name + " — a tiny free browser toy.");
      return { title: name + " — One Page Toys", text: text, url: url };
    }

    var resetT = null;
    function copied() {
      label.textContent = "Link copied!";
      clearTimeout(resetT);
      resetT = setTimeout(function () { label.textContent = "Share this toy"; }, 1800);
    }

    btn.addEventListener("click", function () {
      var pl = payload();
      try { if (window.gtag) window.gtag("event", "share", { method: navigator.share ? "web_share" : "clipboard", content_type: "toy", item_id: location.pathname }); } catch (e) {}
      if (navigator.share) { navigator.share(pl).catch(function () {}); return; }
      var full = pl.text + " " + pl.url;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(full).then(copied, function () { window.prompt("Copy this link:", pl.url); });
      } else {
        window.prompt("Copy this link:", pl.url);
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
