/* One Page Toys — "did they actually play?" tracking, on every toy and tool.
 *
 * Google Analytics already counts page views (a toy being OPENED) and
 * engagement time (how long it stayed in front of someone). What it cannot
 * infer is whether the visitor PLAYED: touched, clicked or typed on the toy
 * itself. This sends one `toy_play` event per page view, the first time they
 * do, so the admin page can show opens, plays and the rate between them for
 * every toy the same way. Toy-specific events (scores, shares, levels) carry on
 * as before.
 *
 * Not a play: the page chrome (the back link, the tip jar, full screen, the
 * tickets pill, the share link, the More Toys cards), Tab and modifier keys.
 * Automated browsers (navigator.webdriver: our own headless checks) send nothing.
 */
(function () {
  var m = /^\/(toys|tools)\/([a-z0-9-]+)\//.exec(location.pathname);
  if (!m || navigator.webdriver) return;
  var slug = m[2], kind = m[1] === "tools" ? "tool" : "toy";
  var CHROME = "a[href], .opt-tipjar, .opt-fs, .opt-tickets, .opt-share, .mg-card, .theme-toggle, .opt-ios-tip";
  var IGNORE_KEYS = { Tab: 1, Shift: 1, Control: 1, Alt: 1, Meta: 1, CapsLock: 1, Escape: 1 };
  var EVENTS = ["pointerdown", "keydown"];

  function play(e) {
    if (e.type === "keydown" && IGNORE_KEYS[e.key]) return;
    var t = e.target;
    if (e.type === "pointerdown" && t && t.closest && t.closest(CHROME)) return;
    EVENTS.forEach(function (n) { window.removeEventListener(n, play, true); });
    try { if (typeof window.gtag === "function") window.gtag("event", "toy_play", { toy: slug, toy_kind: kind }); } catch (err) {}
  }
  EVENTS.forEach(function (n) { window.addEventListener(n, play, true); });
})();
