/* One Page Toys — Suggest a Toy
 * Drop-in suggestion form. Include on any page:
 *   <script src="/assets/suggest.js?v=1" defer></script>
 * and add a trigger anywhere:
 *   <a href="#suggest" data-suggest-open hidden>Suggest a toy</a>
 *
 * Posts a short suggestion to a Cloudflare Worker that emails it via Resend.
 * Spam defense is layered: a honeypot field, a time-trap (rejects sub-3s
 * submits), a Cloudflare Turnstile token, and server-side rate limiting.
 *
 * CONFIG — set these two public values once the Worker + Turnstile exist.
 * Until both are real (no "REPLACE"), the feature stays dormant and any
 * [data-suggest-open] trigger stays hidden, so a premature deploy shows nothing.
 */
(function () {
  "use strict";

  var CFG = window.OPT_SUGGEST || {};
  // The deployed Worker URL (opt-suggest on Cloudflare).
  var ENDPOINT = CFG.endpoint || "https://opt-suggest.brent-816.workers.dev";
  // The Cloudflare Turnstile *site* key (public — safe to ship).
  var TURNSTILE_SITE_KEY = CFG.turnstileKey || "0x4AAAAAADuPzS6LQDMvnAoX";

  var CONFIGURED = ENDPOINT.indexOf("REPLACE") === -1 && TURNSTILE_SITE_KEY.indexOf("REPLACE") === -1;

  var dlg = null, openedAt = 0, widgetId = null, turnstileLoading = false, sending = false;

  function injectStyles() {
    if (document.getElementById("opt-suggest-style")) return;
    var css =
      ".opt-suggest{width:min(460px,calc(100vw - 32px));max-width:460px;padding:0;border:1px solid var(--line-strong,#d4d4d4);" +
      "border-radius:var(--radius,12px);background:var(--surface,#fff);color:var(--text,#171717);" +
      "box-shadow:0 24px 60px -12px rgba(0,0,0,.4),0 4px 12px rgba(0,0,0,.12);font-family:var(--font-sans,'Geist',system-ui,sans-serif);}" +
      ".opt-suggest::backdrop{background:rgba(10,10,10,.55);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);}" +
      ".opt-suggest[open]{animation:optSugIn .2s cubic-bezier(.2,.9,.25,1);}" +
      "@keyframes optSugIn{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}" +
      ".opt-suggest__form,.opt-suggest__done{padding:26px 26px 22px;}" +
      ".opt-suggest__x{position:absolute;top:12px;right:12px;width:32px;height:32px;border:0;border-radius:8px;" +
      "background:transparent;color:var(--muted,#666);font-size:22px;line-height:1;cursor:pointer;}" +
      ".opt-suggest__x:hover{background:var(--surface-2,#fafafa);color:var(--ink,#000);}" +
      ".opt-suggest__title{margin:0 0 6px;font-size:1.32rem;font-weight:800;letter-spacing:-.02em;color:var(--ink,#000);}" +
      ".opt-suggest__sub{margin:0 0 18px;font-size:.92rem;line-height:1.5;color:var(--muted,#666);}" +
      ".opt-suggest__label{display:block;margin:0 0 6px;font-size:.74rem;font-weight:700;letter-spacing:.06em;" +
      "text-transform:uppercase;color:var(--muted,#666);}" +
      ".opt-suggest__label span{text-transform:none;letter-spacing:0;font-weight:500;}" +
      ".opt-suggest__ta,.opt-suggest__in{width:100%;box-sizing:border-box;font:inherit;font-size:.95rem;color:var(--text,#171717);" +
      "background:var(--bg,#fff);border:1px solid var(--line-strong,#d4d4d4);border-radius:var(--radius-sm,8px);padding:11px 13px;}" +
      ".opt-suggest__ta{resize:vertical;min-height:96px;margin-bottom:14px;}" +
      ".opt-suggest__in{margin-bottom:14px;}" +
      ".opt-suggest__ta:focus,.opt-suggest__in:focus{outline:none;border-color:var(--accent,#941e1e);" +
      "box-shadow:0 0 0 3px var(--accent-soft,rgba(148,30,30,.12));}" +
      ".opt-suggest__hp{position:absolute!important;left:-9999px!important;top:auto;width:1px;height:1px;overflow:hidden;}" +
      ".opt-suggest__cf{min-height:0;margin:2px 0 12px;}" +
      ".opt-suggest__err{margin:0 0 12px;font-size:.86rem;color:var(--accent,#941e1e);font-weight:600;}" +
      ".opt-suggest__actions{display:flex;gap:10px;justify-content:flex-end;align-items:center;}" +
      ".opt-suggest__cancel,.opt-suggest__send,.opt-suggest__close2{font:inherit;font-size:.9rem;font-weight:700;" +
      "padding:11px 20px;border-radius:var(--radius-pill,999px);cursor:pointer;transition:background .14s,border-color .14s,opacity .14s;}" +
      ".opt-suggest__cancel{background:transparent;border:1px solid var(--line-strong,#d4d4d4);color:var(--text,#171717);}" +
      ".opt-suggest__cancel:hover{border-color:var(--ink,#000);background:var(--surface-2,#fafafa);}" +
      ".opt-suggest__send,.opt-suggest__close2{border:0;background:var(--accent,#941e1e);color:#fff;}" +
      ".opt-suggest__send:hover,.opt-suggest__close2:hover{background:var(--accent-hover,#7a1818);}" +
      ".opt-suggest__send:disabled{opacity:.55;cursor:default;}" +
      ".opt-suggest__done{text-align:center;}" +
      ".opt-suggest__done h2{margin:6px 0 8px;font-size:1.5rem;font-weight:800;color:var(--ink,#000);}" +
      ".opt-suggest__done p{margin:0 0 20px;color:var(--muted,#666);font-size:.95rem;}" +
      "@media (prefers-reduced-motion:reduce){.opt-suggest[open]{animation:none;}}";
    var st = document.createElement("style");
    st.id = "opt-suggest-style";
    st.textContent = css;
    document.head.appendChild(st);
  }

  function build() {
    if (dlg) return dlg;
    injectStyles();
    dlg = document.createElement("dialog");
    dlg.className = "opt-suggest";
    dlg.setAttribute("aria-labelledby", "optSugTitle");
    dlg.innerHTML =
      '<form class="opt-suggest__form" novalidate>' +
        '<button type="button" class="opt-suggest__x" aria-label="Close">×</button>' +
        '<h2 class="opt-suggest__title" id="optSugTitle">Suggest a toy</h2>' +
        '<p class="opt-suggest__sub">Got an idea for a toy or tool? Send it over — every suggestion is read.</p>' +
        '<label class="opt-suggest__label" for="optSugMsg">Your idea</label>' +
        '<textarea class="opt-suggest__ta" id="optSugMsg" maxlength="2000" placeholder="I’d love a toy that…"></textarea>' +
        '<label class="opt-suggest__label" for="optSugEmail">Email <span>(optional, for a reply)</span></label>' +
        '<input class="opt-suggest__in" id="optSugEmail" type="email" maxlength="200" placeholder="you@example.com" autocomplete="email">' +
        '<div class="opt-suggest__hp" aria-hidden="true"><label>Company<input type="text" name="company" tabindex="-1" autocomplete="off"></label></div>' +
        '<div class="opt-suggest__cf" id="optSugTurnstile"></div>' +
        '<p class="opt-suggest__err" id="optSugErr" hidden></p>' +
        '<div class="opt-suggest__actions">' +
          '<button type="button" class="opt-suggest__cancel">Cancel</button>' +
          '<button type="submit" class="opt-suggest__send">Send suggestion</button>' +
        '</div>' +
      '</form>' +
      '<div class="opt-suggest__done" hidden>' +
        '<h2>Thanks! ✦</h2><p>Your suggestion is on its way.</p>' +
        '<button type="button" class="opt-suggest__close2">Close</button>' +
      '</div>';
    document.body.appendChild(dlg);

    var form = dlg.querySelector(".opt-suggest__form");
    dlg.querySelector(".opt-suggest__x").addEventListener("click", close);
    dlg.querySelector(".opt-suggest__cancel").addEventListener("click", close);
    dlg.querySelector(".opt-suggest__close2").addEventListener("click", close);
    dlg.addEventListener("click", function (e) { if (e.target === dlg) close(); });   // backdrop click
    dlg.addEventListener("close", resetForm);
    form.addEventListener("submit", function (e) { e.preventDefault(); submit(); });
    return dlg;
  }

  function loadTurnstile() {
    if (window.turnstile) { renderWidget(); return; }
    if (turnstileLoading) return;
    turnstileLoading = true;
    window.__optSugTsReady = function () { renderWidget(); };
    var s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__optSugTsReady&render=explicit";
    s.async = true; s.defer = true;
    document.head.appendChild(s);
  }
  function renderWidget() {
    if (!window.turnstile || widgetId !== null) return;
    var el = dlg.querySelector("#optSugTurnstile");
    var dark = document.documentElement.getAttribute("data-theme") === "dark";
    widgetId = window.turnstile.render(el, { sitekey: TURNSTILE_SITE_KEY, theme: dark ? "dark" : "light", size: "flexible" });
  }

  function showErr(msg) { var e = dlg.querySelector("#optSugErr"); e.textContent = msg; e.hidden = false; }
  function clearErr() { var e = dlg.querySelector("#optSugErr"); e.hidden = true; }

  function open(e) {
    if (e) e.preventDefault();
    if (!CONFIGURED) return;
    build();
    dlg.querySelector(".opt-suggest__form").hidden = false;
    dlg.querySelector(".opt-suggest__done").hidden = true;
    clearErr();
    openedAt = Date.now();
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
    loadTurnstile();
    setTimeout(function () { var t = dlg.querySelector("#optSugMsg"); if (t) t.focus(); }, 60);
    try { if (typeof window.gtag === "function") window.gtag("event", "suggest_open", { page: location.pathname }); } catch (x) {}
  }
  function close() { if (dlg && dlg.open) { if (typeof dlg.close === "function") dlg.close(); else dlg.removeAttribute("open"); } }
  function resetForm() {
    if (!dlg) return;
    sending = false;
    var send = dlg.querySelector(".opt-suggest__send");
    send.disabled = false; send.textContent = "Send suggestion";
    dlg.querySelector("#optSugMsg").value = "";
    dlg.querySelector("#optSugEmail").value = "";
    var hp = dlg.querySelector('input[name="company"]'); if (hp) hp.value = "";
    if (window.turnstile && widgetId !== null) { try { window.turnstile.reset(widgetId); } catch (x) {} }
    clearErr();
  }

  function submit() {
    if (sending) return;
    var msg = dlg.querySelector("#optSugMsg").value.trim();
    var email = dlg.querySelector("#optSugEmail").value.trim();
    var company = (dlg.querySelector('input[name="company"]') || {}).value || "";
    if (msg.length < 4) { showErr("Please add a little more detail."); return; }
    var token = "";
    if (window.turnstile && widgetId !== null) { try { token = window.turnstile.getResponse(widgetId) || ""; } catch (x) {} }
    if (!token) { showErr("Just a moment — finishing the spam check…"); loadTurnstile(); return; }
    clearErr();
    sending = true;
    var send = dlg.querySelector(".opt-suggest__send");
    send.disabled = true; send.textContent = "Sending…";

    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: msg, email: email, company: company, elapsed: Date.now() - openedAt, token: token })
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (res.ok && res.j && res.j.ok) {
          dlg.querySelector(".opt-suggest__form").hidden = true;
          dlg.querySelector(".opt-suggest__done").hidden = false;
          try { if (typeof window.gtag === "function") window.gtag("event", "suggest_sent", { page: location.pathname }); } catch (x) {}
        } else {
          sending = false; send.disabled = false; send.textContent = "Send suggestion";
          if (window.turnstile && widgetId !== null) { try { window.turnstile.reset(widgetId); } catch (x) {} }
          showErr(res.j && res.j.error === "rate" ? "You’ve sent a few already — try again in a bit." : "Something went wrong sending that. Please try again.");
        }
      }).catch(function () {
        sending = false; send.disabled = false; send.textContent = "Send suggestion";
        showErr("Network error — please try again.");
      });
  }

  function wireTriggers() {
    var trigs = document.querySelectorAll("[data-suggest-open]");
    for (var i = 0; i < trigs.length; i++) {
      var t = trigs[i];
      if (CONFIGURED) { t.hidden = false; t.addEventListener("click", open); }
      else { t.hidden = true; }
    }
    if (!CONFIGURED) console.info("[suggest] dormant — set OPT_SUGGEST.endpoint and .turnstileKey (or the constants in suggest.js) to enable.");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wireTriggers);
  else wireTriggers();
})();
