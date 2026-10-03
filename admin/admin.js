/* One Page Toys admin: sign in with Google, then what people do on the site.
 * Data comes from /api/admin (Google Analytics behind it); toy names come from
 * the site's own tools-registry.json. Every label from Analytics is untrusted,
 * so it only ever goes into the page as textContent. */
(function () {
  "use strict";

  // the day the shared toy_play tracker (assets/track.js) went live: plays
  // before it simply were not recorded
  var TRACK_SINCE = "2026-10-03";

  var $ = function (id) { return document.getElementById(id); };
  var state = { days: 28, data: null, registry: null, sort: { key: "opens", dir: -1 }, q: "", all: false };
  var TOP = 25;
  var fmt = function (n) { return Math.round(n || 0).toLocaleString("en-US"); };

  function api(op, opts) {
    opts = opts || {};
    return fetch("/api/admin/?op=" + op + (opts.query || ""), {
      method: opts.body ? "POST" : (opts.method || "GET"),
      credentials: "same-origin",
      headers: opts.body ? { "content-type": "application/json" } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; });
    });
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  /* ------------------------------------------------------------ sign in */

  function showGate(msg, err) {
    $("dash").hidden = true; $("who").hidden = true; $("gate").hidden = false;
    if (msg) $("gateText").textContent = msg;
    $("gateError").hidden = !err; $("gateError").textContent = err || "";
  }

  function renderSignIn(session) {
    var box = $("gsiButton");
    box.textContent = "";
    if (session.missing && session.missing.length) {
      showGate("The admin page is not set up yet. These settings are missing in Vercel: " + session.missing.join(", ") + ".");
      return;
    }
    showGate("Sign in with the Google account on the admin list.");
    if (session.demo) {
      var b = el("button", "btn", "Sign in (local demo)");
      b.type = "button";
      b.addEventListener("click", function () { login("demo"); });
      box.appendChild(b);
      return;
    }
    var s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = function () {
      window.google.accounts.id.initialize({
        client_id: session.clientId, ux_mode: "popup", auto_select: false, cancel_on_tap_outside: true,
        callback: function (r) { login(r.credential); }
      });
      window.google.accounts.id.renderButton(box, {
        theme: document.documentElement.getAttribute("data-theme") === "dark" ? "filled_black" : "outline",
        size: "large", shape: "pill", text: "signin_with"
      });
    };
    s.onerror = function () { showGate(null, "Google sign-in did not load. Check your connection or any content blocker, then reload."); };
    document.head.appendChild(s);
  }

  function login(credential) {
    $("gateError").hidden = true;
    api("login", { body: { credential: credential } }).then(function (j) {
      if (j._status === 200) start(j.email);
      else showGate(null, j.error || "Sign-in failed.");
    });
  }

  $("signOut").addEventListener("click", function () {
    api("logout", { body: {} }).then(function () { location.reload(); });
  });

  /* ---------------------------------------------------------- dashboard */

  function start(email) {
    $("gate").hidden = true; $("dash").hidden = false; $("who").hidden = false;
    $("whoEmail").textContent = email || "";
    setRange(state.days);
  }

  function setRange(days) {
    state.days = days;
    Array.prototype.forEach.call(document.querySelectorAll(".seg button"), function (b) {
      b.setAttribute("aria-checked", String(+b.getAttribute("data-days") === days));
    });
    load();
  }
  Array.prototype.forEach.call(document.querySelectorAll(".seg button"), function (b) {
    b.addEventListener("click", function () { setRange(+b.getAttribute("data-days")); });
  });
  $("refresh").addEventListener("click", function () { load(); });
  $("adviceRedo").addEventListener("click", function () { loadAdvice(true); });
  $("toysMore").addEventListener("click", function () { state.all = !state.all; renderToys(); });
  $("toySearch").addEventListener("input", function (e) { state.q = e.target.value.trim().toLowerCase(); renderToys(); });

  function load() {
    $("dash").classList.add("is-loading");          // keep the old frame while it reloads
    var reg = state.registry ? Promise.resolve(state.registry)
      : fetch("/tools-registry.json", { cache: "no-store" }).then(function (r) { return r.json(); });
    Promise.all([api("stats", { query: "&days=" + state.days }), reg]).then(function (out) {
      var d = out[0];
      state.registry = out[1];
      $("dash").classList.remove("is-loading");
      if (d._status === 401) return init();
      if (d._status !== 200) {
        $("banner").hidden = false;
        $("banner").textContent = d.missing ? "Not set up yet. Missing in Vercel: " + d.missing.join(", ") + "." : "Could not load the numbers: " + (d.error || "error " + d._status);
        return;
      }
      $("banner").hidden = !d.demo;
      if (d.demo) $("banner").textContent = "Demo data (local development). The live page shows real numbers from Google Analytics.";
      state.data = d;
      $("updated").textContent = "Updated " + new Date(d.generated).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      render();
      loadAdvice(false);
    }).catch(function (e) {
      $("dash").classList.remove("is-loading");
      $("banner").hidden = false; $("banner").textContent = "Could not load the numbers: " + e.message;
    });
  }

  /* ------------------------------------------- what to do next (Claude) */

  // Written server side from the same numbers and cached there for six hours
  // per range, so loading it again is cheap; "Rewrite" asks for a fresh one.
  var adviceSeq = 0, adviceFor = 0;
  function loadAdvice(fresh) {
    var seq = ++adviceSeq, days = state.days, box = $("advice"), list = $("adviceList"), note = $("adviceNote"), redo = $("adviceRedo");
    box.hidden = false; redo.hidden = true;
    if (fresh || adviceFor !== days || !list.children.length) {
      list.textContent = "";
      for (var k = 0; k < 3; k++) {
        var s = el("li", "skel");
        s.appendChild(el("span", "skel__bar")); s.appendChild(el("span", "skel__bar")); s.appendChild(el("span", "skel__bar"));
        list.appendChild(s);
      }
      note.textContent = "Claude is reading the last " + days + " days…";
    }
    api("advice", { query: "&days=" + days + (fresh ? "&fresh=1" : "") }).then(function (j) {
      if (seq !== adviceSeq) return;                  // a newer range or rewrite took over
      if (j._status === 401) { box.hidden = true; return; }
      if (j._status === 200 && j.configured === false) {
        list.textContent = "";
        note.textContent = "Add an ANTHROPIC_API_KEY in Vercel and Claude will suggest what to do with these numbers.";
        return;
      }
      if (j._status !== 200) return adviceFailed(j.error || "error " + j._status);
      adviceFor = days;
      list.textContent = "";
      (j.items || []).forEach(function (it) {
        var li = el("li");
        li.appendChild(el("span", "advice__head-line", it.headline));
        if (it.detail) li.appendChild(el("span", "advice__detail", it.detail));
        list.appendChild(li);
      });
      note.textContent = (j.demo ? "Demo: " : "") + "Claude's read of the last " + days + " days · " +
        new Date(j.generated).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      redo.textContent = "Rewrite"; redo.hidden = false;
    }).catch(function (e) { if (seq === adviceSeq) adviceFailed(e.message); });
  }
  function adviceFailed(msg) {
    $("adviceList").textContent = "";
    adviceFor = 0;
    $("adviceNote").textContent = "Couldn't write recommendations: " + msg;
    $("adviceRedo").textContent = "Try again"; $("adviceRedo").hidden = false;
  }

  /* --------------------------------------------------------- the numbers */

  function toyRows() {
    var pages = state.data.pages || {};
    return state.registry.filter(function (t) { return t && t.path; }).map(function (t) {
      var p = pages["/" + t.path.replace(/^\//, "")] || {};
      return {
        slug: t.slug, name: t.name, path: "/" + t.path.replace(/^\//, ""), kind: t.category === "utility" ? "tool" : "toy",
        opens: p.opens || 0, prevOpens: p.prevOpens || 0, users: p.users || 0, time: p.time || 0,
        plays: p.plays || 0, shares: p.shares || 0
      };
    });
  }

  function delta(cur, prev) {
    var s = el("span", "delta");
    if (!prev) { s.classList.add(cur ? "delta--up" : "delta--flat"); s.textContent = cur ? "new" : "–"; return s; }
    var pct = Math.round((cur - prev) / prev * 100);
    if (pct > 0) { s.classList.add("delta--up"); s.textContent = "▲ " + pct + "%"; }
    else if (pct < 0) { s.classList.add("delta--down"); s.textContent = "▼ " + Math.abs(pct) + "%"; }
    else { s.classList.add("delta--flat"); s.textContent = "0%"; }
    return s;
  }

  function mmss(sec) {
    if (!sec || !isFinite(sec)) return "–";
    sec = Math.round(sec);
    return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
  }

  function sinceTracking() {
    var start = new Date(Date.now() - state.days * 864e5).toISOString().slice(0, 10);
    return start < TRACK_SINCE;
  }

  function trackDate() {
    return new Date(TRACK_SINCE + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function render() {
    renderKpis();
    renderTrend();
    renderToys();
    renderBars("sources", state.data.sources, function (n) { return n === "(direct)" ? "Direct" : n === "(not set)" ? "Unknown" : n; });
    renderBars("devices", state.data.devices, function (n) { return n.charAt(0).toUpperCase() + n.slice(1); });
    renderBars("countries", state.data.countries);
    renderSitePages();
  }

  function kpi(label, value, sub) {
    var k = el("div", "kpi");
    k.appendChild(el("div", "kpi__label", label));
    k.appendChild(el("div", "kpi__value", value));
    if (sub) { var s = el("div", "kpi__sub"); (Array.isArray(sub) ? sub : [sub]).forEach(function (x) { s.appendChild(typeof x === "string" ? document.createTextNode(x) : x); }); k.appendChild(s); }
    return k;
  }

  function renderKpis() {
    var d = state.data, toys = toyRows(), box = $("kpis");
    var sum = function (k) { return toys.reduce(function (s, t) { return s + t[k]; }, 0); };
    var opens = sum("opens"), prev = sum("prevOpens"), plays = sum("plays"), time = sum("time"), users = sum("users");
    box.textContent = "";
    box.appendChild(kpi("Visitors", fmt(d.totals.visitors), [delta(d.totals.visitors, d.totals.prevVisitors), " vs before"]));
    box.appendChild(kpi("Toy opens", fmt(opens), [delta(opens, prev), " vs before"]));
    box.appendChild(kpi("Plays", fmt(plays), opens ? Math.round(Math.min(1, plays / opens) * 100) + "% of opens" + (sinceTracking() ? ", since " + trackDate() : "") : "since " + trackDate()));
    box.appendChild(kpi("Time on a toy", mmss(users ? time / users : 0), "average per visitor"));
    box.appendChild(kpi("Shares", fmt(sum("shares")), "share links tapped"));
    var now = el("div", "kpi kpi--now");
    now.appendChild(el("div", "kpi__label", "Right now"));
    var v = el("div", "kpi__value");
    v.appendChild(el("span", "livedot")); v.appendChild(document.createTextNode(d.now ? fmt(d.now.active) : "–"));
    now.appendChild(v);
    if (d.now && d.now.top.length) {
      var ul = el("ul", "kpi__list");
      d.now.top.slice(0, 3).forEach(function (t) {
        var li = el("li");
        var nm = String(t.name).replace(/\s+[—-]\s+One Page Toys$/, "");
        li.appendChild(el("span", null, !nm || /^One Page Toys/.test(nm) ? "Home" : nm));
        li.appendChild(el("span", null, fmt(t.value)));
        ul.appendChild(li);
      });
      now.appendChild(ul);
    } else now.appendChild(el("div", "kpi__sub", "active in the last 30 minutes"));
    box.appendChild(now);
  }

  /* ---------------------------------------------------- the trend chart */

  function gaDate(s) { return new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)); }
  function niceMax(v) {
    if (v <= 0) return 10;
    var p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }
  var SVG = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs, cls) { var e = document.createElementNS(SVG, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); if (cls) e.setAttribute("class", cls); return e; }

  function renderTrend() {
    var pts = state.data.daily || [], box = $("trend");
    box.textContent = "";
    $("trendNote").textContent = "unique visitors per day";
    renderTrendTable(pts);
    if (!pts.length) { box.appendChild(el("p", "empty", "No visits in this range yet.")); return; }
    var W = box.clientWidth || 600, H = box.clientHeight || 220, L = 40, R = 10, T = 8, B = 24;
    var max = niceMax(Math.max.apply(null, pts.map(function (p) { return p.visitors; })));
    var x = function (i) { return L + (pts.length < 2 ? (W - L - R) / 2 : i * (W - L - R) / (pts.length - 1)); };
    var y = function (v) { return T + (H - T - B) * (1 - v / max); };
    var svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Daily visitors over the last " + state.days + " days", tabindex: "0" });
    for (var g = 0; g <= 4; g++) {
      var gv = max * g / 4, gy = y(gv);
      svg.appendChild(svgEl("line", { x1: L, x2: W - R, y1: gy, y2: gy }, "grid"));
      var t = svgEl("text", { x: L - 8, y: gy + 4, "text-anchor": "end" }, "axis"); t.textContent = fmt(gv); svg.appendChild(t);
    }
    var step = Math.max(1, Math.ceil(pts.length / 7));
    pts.forEach(function (p, i) {
      if (i % step && i !== pts.length - 1) return;
      if (i !== pts.length - 1 && pts.length - 1 - i < step * 0.6) return;   // keep the last label clear of its neighbor
      var t = svgEl("text", { x: x(i), y: H - 6, "text-anchor": i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle" }, "axis");
      t.textContent = gaDate(p.date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      svg.appendChild(t);
    });
    var line = pts.map(function (p, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + y(p.visitors).toFixed(1); }).join(" ");
    svg.appendChild(svgEl("path", { d: line + " L" + x(pts.length - 1).toFixed(1) + " " + y(0) + " L" + x(0).toFixed(1) + " " + y(0) + " Z" }, "area"));
    svg.appendChild(svgEl("path", { d: line }, "line"));
    var cross = svgEl("line", { y1: T, y2: H - B, visibility: "hidden" }, "cross");
    var dot = svgEl("circle", { r: 4.5, visibility: "hidden" }, "dot");
    svg.appendChild(cross); svg.appendChild(dot);
    box.appendChild(svg);

    var tip = $("tip"), cur = -1;
    function show(i) {
      cur = Math.max(0, Math.min(pts.length - 1, i));
      var p = pts[cur], px = x(cur), py = y(p.visitors);
      cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.setAttribute("visibility", "visible");
      dot.setAttribute("cx", px); dot.setAttribute("cy", py); dot.setAttribute("visibility", "visible");
      tip.textContent = "";
      tip.appendChild(el("div", "tip__date", gaDate(p.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })));
      var r1 = el("div", "tip__row"), k1 = el("span"); k1.appendChild(el("i", "tip__key")); k1.appendChild(document.createTextNode("Visitors"));
      r1.appendChild(k1); r1.appendChild(el("b", null, fmt(p.visitors))); tip.appendChild(r1);
      var r2 = el("div", "tip__row"), k2 = el("span"); k2.appendChild(el("i", "tip__key tip__key--muted")); k2.appendChild(document.createTextNode("Page views"));
      r2.appendChild(k2); r2.appendChild(el("b", null, fmt(p.views))); tip.appendChild(r2);
      tip.hidden = false;
      var rect = svg.getBoundingClientRect(), sx = rect.left + px * rect.width / W, sy = rect.top + py * rect.height / H;
      var tw = tip.offsetWidth, th = tip.offsetHeight;
      var left = sx + 14 + tw > window.innerWidth - 8 ? sx - 14 - tw : sx + 14;
      tip.style.left = Math.max(8, left) + "px";
      tip.style.top = Math.max(8, Math.min(window.innerHeight - th - 8, sy - th / 2)) + "px";
    }
    function hide() { cur = -1; tip.hidden = true; cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); }
    function nearest(clientX) {
      var rect = svg.getBoundingClientRect(), vx = (clientX - rect.left) * W / rect.width;
      return pts.length < 2 ? 0 : Math.round((vx - L) / ((W - L - R) / (pts.length - 1)));
    }
    svg.addEventListener("pointermove", function (e) { show(nearest(e.clientX)); });
    svg.addEventListener("pointerleave", hide);
    svg.addEventListener("focus", function () { show(pts.length - 1); });
    svg.addEventListener("blur", hide);
    svg.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") { show(cur - 1); e.preventDefault(); }
      if (e.key === "ArrowRight") { show(cur + 1); e.preventDefault(); }
    });
  }

  function renderTrendTable(pts) {
    var box = $("trendTable"), t = el("table");
    box.textContent = "";
    var hr = el("tr"); ["Day", "Visitors", "Page views"].forEach(function (h) { hr.appendChild(el("th", null, h)); }); t.appendChild(hr);
    pts.slice().reverse().forEach(function (p) {
      var tr = el("tr");
      tr.appendChild(el("td", null, gaDate(p.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })));
      tr.appendChild(el("td", null, fmt(p.visitors)));
      tr.appendChild(el("td", null, fmt(p.views)));
      t.appendChild(tr);
    });
    box.appendChild(t);
  }

  /* ------------------------------------------------------ the toy table */

  var COLS = [
    { key: "name", label: "Toy" },
    { key: "opens", label: "Opens" },
    { key: "change", label: "vs before" },
    { key: "plays", label: "Plays" },
    { key: "rate", label: "Play rate" },
    { key: "avg", label: "Avg time" },
    { key: "shares", label: "Shares" }
  ];

  function renderToys() {
    var rows = toyRows().map(function (t) {
      t.change = t.prevOpens ? (t.opens - t.prevOpens) / t.prevOpens : (t.opens ? Infinity : 0);
      t.rate = t.opens ? Math.min(1, t.plays / t.opens) : 0;
      t.avg = t.users ? t.time / t.users : 0;
      return t;
    });
    var q = state.q;
    if (q) rows = rows.filter(function (t) { return t.name.toLowerCase().indexOf(q) >= 0 || t.slug.indexOf(q) >= 0; });
    var s = state.sort;
    rows.sort(function (a, b) {
      var av = a[s.key], bv = b[s.key];
      if (s.key === "name") return av.localeCompare(bv) * s.dir;
      return (av - bv) * s.dir || a.name.localeCompare(b.name);
    });
    var max = Math.max(1, Math.max.apply(null, rows.map(function (t) { return t.opens; })));
    var total = rows.length, shown = q || state.all ? rows : rows.slice(0, TOP);
    var table = $("toys");
    table.textContent = "";
    var head = el("tr");
    COLS.forEach(function (c) {
      var th = el("th");
      th.setAttribute("scope", "col");
      if (s.key === c.key) th.setAttribute("aria-sort", s.dir > 0 ? "ascending" : "descending");
      var b = el("button", null, c.label + (s.key === c.key ? (s.dir > 0 ? " ↑" : " ↓") : ""));
      b.type = "button";
      b.addEventListener("click", function () {
        state.sort = { key: c.key, dir: s.key === c.key ? -s.dir : (c.key === "name" ? 1 : -1) };
        renderToys();
      });
      th.appendChild(b);
      head.appendChild(th);
    });
    var thead = el("thead"); thead.appendChild(head); table.appendChild(thead);
    var tbody = el("tbody");
    shown.forEach(function (t) {
      var tr = el("tr", t.opens ? "" : "zero");
      var name = el("td", "name"), a = el("a", null, t.name);
      a.href = t.path; a.target = "_blank"; a.rel = "noopener";
      name.appendChild(a); name.appendChild(el("span", "kind", t.kind));
      tr.appendChild(name);
      var op = el("td"), wrap = el("div", "opens"), track = el("span", "track"), bar = el("i");
      bar.style.width = Math.round(t.opens / max * 90) + "px";
      track.appendChild(bar); wrap.appendChild(track); wrap.appendChild(el("span", null, fmt(t.opens))); op.appendChild(wrap);
      tr.appendChild(op);
      var ch = el("td"); ch.appendChild(delta(t.opens, t.prevOpens)); tr.appendChild(ch);
      tr.appendChild(el("td", null, fmt(t.plays)));
      tr.appendChild(el("td", t.opens ? "" : "muted", t.opens ? Math.round(t.rate * 100) + "%" : "–"));
      tr.appendChild(el("td", null, mmss(t.avg)));
      tr.appendChild(el("td", null, t.shares ? fmt(t.shares) : "–"));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    var more = $("toysMore");
    more.hidden = !!q || total <= TOP;
    more.textContent = state.all ? "Show the top " + TOP : "Show all " + total + " toys";
    var unopened = toyRows().filter(function (t) { return !t.opens; }).length;
    $("toysNote").textContent = (shown.length < total ? "Top " + shown.length + " of " + total : total + " shown") + (unopened ? ", " + unopened + " not opened in this range" : "") +
      ". Plays count a visitor who touched, clicked or typed on the toy" + (sinceTracking() ? ", recorded from " + trackDate() + " on" : "") + ".";
  }

  /* ------------------------------------------------------- the bar lists */

  function renderBars(id, list, label) {
    var box = $(id);
    box.textContent = "";
    list = list || [];
    if (!list.length) { box.appendChild(el("p", "empty", "Nothing in this range yet.")); return; }
    var max = Math.max.apply(null, list.map(function (r) { return r.value; })) || 1;
    var total = list.reduce(function (s, r) { return s + r.value; }, 0) || 1;
    list.forEach(function (r) {
      var row = el("div", "bar");
      row.appendChild(el("span", "bar__name", label ? label(r.name) : r.name));
      row.appendChild(el("span", "bar__val", fmt(r.value) + " · " + Math.round(r.value / total * 100) + "%"));
      var tr = el("div", "bar__track"), f = el("div", "bar__fill");
      f.style.width = Math.max(1, r.value / max * 100) + "%";
      tr.appendChild(f); row.appendChild(tr);
      box.appendChild(row);
    });
  }

  var SITE = { "/": "Home", "/all-toys/": "All toys", "/store/": "Prize counter" };
  var CATS = { game: "Games", visual: "Visual", audio: "Audio", wellness: "Wellness", utility: "Tools", simulation: "Physics" };
  function renderSitePages() {
    var pages = state.data.pages || {}, toyPaths = {};
    state.registry.forEach(function (t) { toyPaths["/" + String(t.path).replace(/^\//, "")] = 1; });
    var list = Object.keys(pages).filter(function (p) { return !toyPaths[p] && !/^\/(admin|api)\//.test(p) && pages[p].opens > 0; }).map(function (p) {
      var m = /^\/all-toys\/([a-z]+)\/$/.exec(p);
      return { name: SITE[p] || (m ? "All toys: " + (CATS[m[1]] || m[1]) : p), value: pages[p].opens };
    }).sort(function (a, b) { return b.value - a.value; }).slice(0, 10);
    renderBars("sitePages", list);
  }

  var resizeT;
  window.addEventListener("resize", function () { clearTimeout(resizeT); resizeT = setTimeout(function () { if (state.data) renderTrend(); }, 120); });

  /* ------------------------------------------------------------ start */

  function init() {
    api("session").then(function (s) {
      if (s.signedIn) start(s.email);
      else renderSignIn(s);
    }).catch(function () { showGate(null, "Could not reach the server."); });
  }
  init();
})();
