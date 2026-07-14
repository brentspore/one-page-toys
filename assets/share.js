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

  // Walk up to the first element with an opaque-ish background; a light one
  // means the pill needs dark text. Avoids the old color:inherit bug, where a
  // panel that left its text color unset made the pill inherit near-black and
  // wash out on a dark panel.
  function isLightPanel(el) {
    var e = el;
    while (e && e !== document.documentElement) {
      var m = getComputedStyle(e).backgroundColor.match(/rgba?\(([^)]+)\)/);
      if (m) {
        var p = m[1].split(",").map(function (x) { return parseFloat(x); });
        if ((p[3] === undefined ? 1 : p[3]) >= 0.5) {
          return (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255 > 0.6;
        }
      }
      e = e.parentElement;
    }
    return false;
  }

  function init() {
    var panel = document.querySelector("#overlay .panel");
    if (!panel || document.getElementById("opt-share-style")) return;

    var style = document.createElement("style");
    style.id = "opt-share-style";
    style.textContent =
      ".opt-share{display:inline-flex;align-items:center;gap:6px;margin-top:14px;padding:6px 8px;" +
      "border:0;background:transparent;color:var(--ops-fg,rgba(255,255,255,.9));" +
      "font:inherit;font-size:0.82em;font-weight:700;opacity:0.72;cursor:pointer;" +
      "-webkit-tap-highlight-color:transparent;transition:opacity 140ms ease;}" +
      ".opt-share--light{--ops-fg:rgba(0,0,0,.82);}" +
      ".opt-share:hover{opacity:1;text-decoration:underline;text-underline-offset:3px;}" +
      ".opt-share:focus-visible{outline:2px solid currentColor;outline-offset:2px;opacity:1;}" +
      ".opt-share svg{width:13px;height:13px;display:block;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}";
    document.head.appendChild(style);

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "opt-share" + (isLightPanel(panel) ? " opt-share--light" : "");
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
