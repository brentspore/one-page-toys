/* One Page Toys — shared "Share this toy" button.
 * Drop-in (like tip-jar.js): include the script and it injects a quiet share pill
 * into the toy's overlay panel (`#overlay .panel`) under the main CTA — visible on
 * both the intro and end-game screens, where the urge to share peaks.
 * - Mobile: native Web Share sheet (navigator.share).
 * - Desktop/fallback: copies "<text> <url>" to the clipboard → "Link copied!".
 *
 * A toy can opt into a richer share by setting these any time before the tap:
 *   window.OPT_SHARE_TEXT  = "I scored 84,200 on Pinball. Beat that."  // the message
 *   window.OPT_SHARE_LINE  = "84,200 points"                          // short caption burnt into the image
 *   window.OPT_SHARE_IMAGE = function () { return canvas; }           // the picture to share
 *
 * When an image is offered we share the PICTURE, not the link — a link preview is
 * the same generic OG card for every player, so the result is invisible in it. The
 * caption strip is what carries onepagetoys.com through an image share, where there
 * is no link at all.
 *
 * ⚠ OPT_SHARE_IMAGE is called and copied SYNCHRONOUSLY on tap, so a WebGL toy can
 *   just redraw and return its canvas: the drawing buffer is still intact inside the
 *   same task, and no preserveDrawingBuffer (and its per-frame cost) is needed.
 */
(function () {
  "use strict";

  var MAXW = 1400;   // cap the shared PNG; a 4K canvas makes a blob nobody wants to send
  var SANS = '"Geist Sans", "Inter", system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';

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

  function toyName() {
    return (document.title || "One Page Toys").split("—")[0].trim();
  }

  function slug() {
    var p = location.pathname.replace(/\/(index\.html)?$/, "").split("/");
    return p[p.length - 1] || "one-page-toys";
  }

  // The canvas a toy is offering, resolved right now. Never cached: the whole
  // point is to catch the run as it stands at the moment of the tap.
  function sourceCanvas() {
    var src = window.OPT_SHARE_IMAGE;
    if (typeof src === "function") { try { src = src(); } catch (e) { return null; } }
    if (!src || !src.width || !src.height) return null;
    return src;
  }

  // Draw the toy's canvas into a fresh one and burn a caption strip along the
  // bottom. MUST run synchronously after sourceCanvas() so a WebGL readback is
  // still valid.
  function compose(src, line) {
    var sw = src.width, sh = src.height;
    var k = Math.min(1, MAXW / sw);
    var w = Math.max(1, Math.round(sw * k));
    var h = Math.max(1, Math.round(sh * k));
    var out = document.createElement("canvas");
    out.width = w; out.height = h;
    var c = out.getContext("2d");
    if (!c) return null;
    c.drawImage(src, 0, 0, sw, sh, 0, 0, w, h);

    var pad = Math.round(Math.min(w, h) * 0.045);
    var big = Math.max(16, Math.round(Math.min(w, h) * 0.052));
    var sub = Math.max(11, Math.round(big * 0.62));
    var scrim = Math.round(big * 4.2);

    var g = c.createLinearGradient(0, h - scrim, 0, h);
    g.addColorStop(0, "rgba(6,6,9,0)");
    g.addColorStop(0.55, "rgba(6,6,9,0.5)");
    g.addColorStop(1, "rgba(6,6,9,0.88)");
    c.fillStyle = g;
    c.fillRect(0, h - scrim, w, scrim);

    var name = toyName();
    var base = h - pad;
    c.textBaseline = "alphabetic";
    c.textAlign = "left";

    if (line) {
      try { c.letterSpacing = Math.max(1, Math.round(sub * 0.12)) + "px"; } catch (e) {}
      c.font = "700 " + sub + "px " + SANS;
      c.fillStyle = "rgba(255,255,255,0.66)";
      c.fillText(name.toUpperCase(), pad, base);
      try { c.letterSpacing = "0px"; } catch (e) {}
      c.font = "800 " + big + "px " + SANS;
      c.fillStyle = "#fff";
      c.fillText(line, pad, base - sub * 1.55);
    } else {
      c.font = "800 " + big + "px " + SANS;
      c.fillStyle = "#fff";
      c.fillText(name, pad, base);
    }

    c.font = "600 " + sub + "px " + SANS;
    c.textAlign = "right";
    var url = "onepagetoys.com";
    var uw = c.measureText(url).width;
    c.fillStyle = "rgba(255,255,255,0.78)";
    c.fillText(url, w - pad, base);
    var dot = Math.max(2, Math.round(sub * 0.24));
    c.beginPath();
    c.arc(w - pad - uw - dot * 3.2, base - sub * 0.3, dot, 0, 6.2832);
    c.fillStyle = "#e5484d";
    c.fill();

    return out;
  }

  function init() {
    // Mount into an explicit [data-opt-share] host if a toy provides one
    // (e.g. an on-canvas result strip), else the standard overlay panel.
    var host = document.querySelector("[data-opt-share]");
    var panel = host || document.querySelector("#overlay .panel");
    if (!panel || document.getElementById("opt-share-style")) return;

    var style = document.createElement("style");
    style.id = "opt-share-style";
    style.textContent =
      ".opt-share{display:inline-flex;align-items:center;gap:6px;margin-top:14px;padding:6px 8px;" +
      "border:0;background:transparent;color:var(--ops-fg,rgba(255,255,255,.9));" +
      "font:inherit;font-size:0.82em;font-weight:700;opacity:0.72;cursor:pointer;" +
      "-webkit-tap-highlight-color:transparent;transition:opacity 140ms ease;}" +
      ".opt-share--light{--ops-fg:rgba(0,0,0,.82);}" +
      ".opt-share--inline{margin-top:0;}" +
      ".opt-share:hover{opacity:1;text-decoration:underline;text-underline-offset:3px;}" +
      ".opt-share:focus-visible{outline:2px solid currentColor;outline-offset:2px;opacity:1;}" +
      ".opt-share svg{width:13px;height:13px;display:block;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}";
    document.head.appendChild(style);

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "opt-share" + (host ? " opt-share--inline" : "") + (isLightPanel(panel) ? " opt-share--light" : "");
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13"/></svg>' +
      "<span>Share this toy</span>";
    panel.appendChild(btn);
    var label = btn.querySelector("span");

    // The invitation has to match what the tap will do, and that changes the
    // moment a run ends. Watching the overlay is not enough — a toy with a
    // persistent toolbar (Dominoes) never toggles anything when its run ends —
    // so the globals themselves are the trigger: assigning any of them
    // refreshes the label, and no toy has to know this button exists.
    function idle() { return window.OPT_SHARE_IMAGE ? "Share your run" : "Share this toy"; }
    function refresh() { if (!resetT) label.textContent = idle(); }
    ["OPT_SHARE_IMAGE", "OPT_SHARE_LINE", "OPT_SHARE_TEXT"].forEach(function (k) {
      var held = window[k];                       // keep anything set before we loaded
      try {
        Object.defineProperty(window, k, {
          configurable: true,
          get: function () { return held; },
          set: function (v) { held = v; refresh(); }
        });
      } catch (e) {}
    });

    function payload() {
      var canonical = document.querySelector('link[rel="canonical"]');
      var url = (canonical && canonical.href) || location.href;
      var name = toyName();
      var text = window.OPT_SHARE_TEXT || ("Come play " + name + ", a tiny free browser toy.");
      return { title: name + " — One Page Toys", text: text, url: url };
    }

    var resetT = null;
    function flash(msg) {
      label.textContent = msg;
      clearTimeout(resetT);
      resetT = setTimeout(function () { resetT = null; label.textContent = idle(); }, 1800);
    }

    function ga(method) {
      try {
        if (window.gtag) window.gtag("event", "share", { method: method, content_type: "toy", item_id: location.pathname });
      } catch (e) {}
    }

    function linkPath(pl) {
      if (navigator.share) { ga("web_share"); navigator.share(pl).catch(function () {}); return; }
      ga("clipboard");
      var full = pl.text + " " + pl.url;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(full).then(function () { flash("Link copied!"); },
          function () { window.prompt("Copy this link:", pl.url); });
      } else {
        window.prompt("Copy this link:", pl.url);
      }
    }

    function download(blob, pl) {
      try {
        var a = document.createElement("a");
        var href = URL.createObjectURL(blob);
        a.href = href; a.download = slug() + ".png";
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(href); }, 4000);
        ga("download_image");
        flash("Image saved!");
      } catch (e) { linkPath(pl); }
    }

    function imagePath(out, pl) {
      out.toBlob(function (blob) {
        if (!blob) { linkPath(pl); return; }
        var f = null;
        try { f = new File([blob], slug() + ".png", { type: "image/png" }); } catch (e) {}
        // Most targets drop `url` when a file rides along, so fold it into the
        // text — otherwise the share travels with no way back here but the strip.
        var text = pl.text.indexOf("http") === -1 ? pl.text + " " + pl.url : pl.text;
        if (f && navigator.share && navigator.canShare && navigator.canShare({ files: [f] })) {
          ga("web_share_image");
          navigator.share({ files: [f], text: text, title: pl.title }).catch(function () {});
          return;
        }
        if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
          try {
            navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).then(
              function () { ga("clipboard_image"); flash("Image copied!"); },
              function () { download(blob, pl); });
            return;
          } catch (e) {}
        }
        download(blob, pl);
      }, "image/png");
    }

    btn.addEventListener("click", function () {
      var pl = payload();
      var src = sourceCanvas();
      if (src) {
        var out = null;
        try { out = compose(src, window.OPT_SHARE_LINE || ""); } catch (e) { out = null; }
        if (out) { imagePath(out, pl); return; }
      }
      linkPath(pl);
    });

    refresh();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
