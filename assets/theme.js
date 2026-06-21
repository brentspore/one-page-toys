/* One Page Toys — theme control.
 * Three modes: System (follows OS prefers-color-scheme, live) / Light / Dark.
 * The no-flash init in each page's <head> sets <html data-theme> + data-theme-mode
 * before paint; this script wires the toggle (cycles the three modes) and keeps
 * System mode in sync when the OS preference changes.
 */
(function () {
  "use strict";

  var KEY = "opt-theme";
  var ORDER = ["system", "light", "dark"];
  var LABELS = { system: "System", light: "Light", dark: "Dark" };
  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function mode() {
    var m = null;
    try { m = localStorage.getItem(KEY); } catch (e) {}
    return m === "light" || m === "dark" || m === "system" ? m : "system";
  }
  function resolved(m) {
    if (m === "dark") return "dark";
    if (m === "light") return "light";
    return mq && mq.matches ? "dark" : "light";
  }
  function syncButtons(m) {
    var btns = document.querySelectorAll("[data-theme-toggle]");
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute("aria-label", "Theme: " + LABELS[m] + " (click to change)");
      btns[i].title = "Theme: " + LABELS[m];
    }
  }
  function apply(m) {
    try { localStorage.setItem(KEY, m); } catch (e) {}
    var de = document.documentElement;
    de.setAttribute("data-theme-mode", m);
    de.setAttribute("data-theme", resolved(m));
    syncButtons(m);
  }

  document.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("[data-theme-toggle]") : null;
    if (!b) return;
    apply(ORDER[(ORDER.indexOf(mode()) + 1) % ORDER.length]);
  });

  // Follow the OS live while in System mode.
  if (mq) {
    var onChange = function () {
      if (mode() === "system") document.documentElement.setAttribute("data-theme", resolved("system"));
    };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  document.documentElement.setAttribute("data-theme-mode", mode());
  syncButtons(mode());
})();
