/* Level & Ruler — One Page Toys No. 131
 *
 * The phone becomes the tool. Two instruments:
 *   LEVEL  reads gravity from the motion sensor. Lying flat it is a bull's-eye
 *          (both axes); standing on an edge it is a machinist's tube vial. The
 *          angle math lives in math.js (tested in node); this file feeds it,
 *          filters it, gives the bubble a spring so it lags like a real one,
 *          and draws brass and glass.
 *   RULER  a steel rule along the screen, true once it is set against a bank
 *          card or a quarter, with a two-jaw caliper.
 * Nothing leaves the device.
 */
(function () {
  "use strict";

  var M = window.LRMath, AU = window.LRAudio;
  if (!M) return;
  var SLUG = "level-and-ruler";
  var K = { bias: SLUG + "_bias", scale: SLUG + "_scale", units: SLUG + "_units", span: SLUG + "_span" };
  var RAD = Math.PI / 180;

  function $(id) { return document.getElementById(id); }
  function load(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function loadJSON(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function ga(name, params) { try { if (typeof window.gtag === "function") window.gtag("event", name, params || {}); } catch (e) {} }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function nowS() { return performance.now() / 1000; }

  var mqReduce = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  var reduced = !!(mqReduce && mqReduce.matches);
  if (mqReduce && mqReduce.addEventListener) mqReduce.addEventListener("change", function (e) { reduced = e.matches; });

  var UA = navigator.userAgent || "";
  var IS_APPLE_TOUCH = /iPad|iPhone|iPod/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
  var IS_TOUCH = (navigator.maxTouchPoints || 0) > 0 || (window.matchMedia && window.matchMedia("(pointer: coarse)").matches);

  var el = {
    tabs: document.querySelector(".tabs"), tabLevel: $("tabLevel"), tabRuler: $("tabRuler"),
    viewLevel: $("viewLevel"), viewRuler: $("viewRuler"),
    bench: $("bench"), lcv: $("levelCanvas"), gate: $("gate"), gateText: $("gateText"), gateBtn: $("gateBtn"),
    note: $("benchNote"), calib: $("calib"), calibRing: $("calibRing"), calibText: $("calibText"),
    calibGo: $("calibGo"), calibCancel: $("calibCancel"),
    segBtns: document.querySelectorAll(".seg__btn[data-mode]"), sound: $("soundBtn"),
    live: $("levelLive"), spanBtn: $("spanBtn"), actions: $("levelActions"),
    zero: $("zeroBtn"), cal: $("calBtn"), reset: $("resetBtn"), calState: $("calState"),
    measureBig: $("measureBig"), measureSmall: $("measureSmall"), scaleState: $("scaleState"), rulerLive: $("rulerLive"),
    rulerCal: $("rulerCalBtn"), unitBtns: document.querySelectorAll(".seg__btn[data-unit]"),
    cardCal: $("cardCal"), cardText: $("cardText"), calLess: $("calLess"), calMore: $("calMore"),
    calSwap: $("calSwap"), calSave: $("calSave"), calCancel: $("calCancel"),
    rule: $("rule"), rcv: $("rulerCanvas"), jawA: $("jawA"), jawB: $("jawB"), measure: $("measure"),
    shareRow: $("shareRow")
  };

  /* ------------------------------------------------------------------ units */

  var units = load(K.units, "");
  if (units !== "in" && units !== "mm") units = /^en-US|^en$|-US$/i.test(navigator.language || "en-US") ? "in" : "mm";
  var SPANS = { "in": [12, 16, 18, 24, 30, 36, 48, 72], mm: [300, 400, 500, 600, 800, 1000, 1200, 1800] };
  var span = parseFloat(load(K.span, "")) || (units === "in" ? 24 : 600);
  function spanLabel() {
    return units === "in" ? span + " in" : (span >= 1000 ? (span / 1000) + " m" : (span / 10) + " cm");
  }
  function fixSpanForUnits() {
    var list = SPANS[units];
    if (list.indexOf(span) < 0) span = units === "in" ? 24 : 600;
  }
  fixSpanForUnits();

  /* ============================================================ SENSORS ==== */

  var G = M.G;
  var S = {
    sensor: "probing",          // probing | live | none | ask | denied
    via: "",                    // motion | orientation
    sign: IS_APPLE_TOUCH ? -1 : 1,
    votes: { "1": 0, "-1": 0 }, signLocked: false,
    orient: null,               // latest {beta, gamma, alpha, t}
    lastMotionT: 0, lastDataT: 0,
    raw: null,                  // latest sign-corrected up, g units, device frame, NOT bias-corrected
    up: null,                   // filtered, bias-corrected unit up, device frame
    mag: 1, shakeT: 0,
    filt: [new M.OneEuro(0.45, 0.9, 1), new M.OneEuro(0.45, 0.9, 1), new M.OneEuro(0.45, 0.9, 1)],
    bias: null, biasInfo: null,
    screenAngle: 0,
    modePref: "auto", sensedMode: null, mode: "edge", q: 0,
    read: 0, readAbs: 0, tx: 0, ty: 0, total: 0, shown: null, rate: 0, prevRead: null,
    bubble: { x: { p: 0, v: 0 }, y: { p: 0, v: 0 } },
    locked: false, lockSince: 0, lockAmt: 0, lockedOnce: false,
    demo: false, demoTilt: { e: 1.2, x: 0.9, y: -0.6 },
    hasReading: false
  };

  (function loadBias() {
    var b = loadJSON(K.bias);
    if (b && isFinite(b.x) && isFinite(b.y) && Math.abs(b.x) < 0.1 && Math.abs(b.y) < 0.1) {
      S.bias = { x: b.x, y: b.y }; S.biasInfo = b;
    }
  })();

  /* How far the page is turned from the phone's own upright. window.orientation
   * first: it only exists on phones and tablets, where it is measured from the
   * same upright the motion axes use. screen.orientation.angle is measured from
   * the screen's NATURAL orientation, which on a desktop browser is landscape. */
  function readScreenAngle() {
    var a = 0;
    if (typeof window.orientation === "number") a = window.orientation;
    else if (screen.orientation && typeof screen.orientation.angle === "number") a = screen.orientation.angle;
    S.screenAngle = ((a % 360) + 360) % 360;
  }
  readScreenAngle();
  if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener("change", readScreenAngle);
  window.addEventListener("orientationchange", readScreenAngle);

  function resetFilters() { S.filt.forEach(function (f) { f.reset(); }); S.shown = null; }

  function ingest(raw, t) {
    S.raw = raw;
    S.lastDataT = t;
    if (CAL && CAL.sampling) CAL.samples.push({ x: raw.x, y: raw.y, z: raw.z });
    var c = M.norm3(M.applyBias(raw, S.bias));
    var f = M.norm3({ x: S.filt[0].filter(c.x, t), y: S.filt[1].filter(c.y, t), z: S.filt[2].filter(c.z, t) });
    S.up = f;
    S.hasReading = true;
  }

  function goLive(via) {
    if (S.sensor === "live") return;
    var wasNone = S.sensor === "none";
    S.sensor = "live"; S.via = via; S.demo = false;
    el.bench.classList.remove("is-demo");
    el.lcv.removeAttribute("tabindex");
    el.gate.hidden = true;
    setNote("");
    paintControls();
    ga("level_live", { sensor: via });
    if (wasNone && !userPickedTab) setTab("level");
    keepAwake();
  }

  function onMotion(e) {
    var a = e.accelerationIncludingGravity;
    if (!a || a.x === null || a.y === null || a.z === null || a.x === undefined) return;
    var m = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
    if (!(m > 2 && m < 40)) return;                  // nulls, zeros, a phone being thrown
    var t = nowS();
    S.lastMotionT = t;
    // Let deviceorientation referee the sign: it agrees across platforms.
    if (!S.signLocked && S.orient && t - S.orient.t < 0.25) {
      var v = M.signVote(a, S.orient.beta, S.orient.gamma);
      if (v) {
        S.votes[v]++;
        var other = S.votes[-v];
        if (S.votes[v] >= 6 && S.votes[v] - other >= 4) {
          S.signLocked = true;
          if (S.sign !== v) { S.sign = v; resetFilters(); }
        }
      }
    }
    S.mag = m / G;
    goLive("motion");
    ingest(M.upFromAccel(a, S.sign), t);
  }

  function onOrient(e) {
    if (e.beta === null || e.gamma === null || e.beta === undefined || e.gamma === undefined) return;
    var t = nowS();
    S.orient = { beta: e.beta, gamma: e.gamma, alpha: e.alpha, t: t };
    // Fallback only: when motion is missing or has gone quiet.
    if (t - S.lastMotionT > 0.4) {
      goLive("orientation");
      S.mag = 1;
      ingest(M.upFromOrientation(e.beta, e.gamma), t);
    }
  }

  var listening = false;
  function listen() {
    if (listening) return;
    listening = true;
    window.addEventListener("devicemotion", onMotion);
    window.addEventListener("deviceorientation", onOrient);
  }

  function probe(ms) {
    setTimeout(function () {
      if (S.sensor === "live") return;
      S.sensor = "none";
      startDemo();
      setNote(S.asked
        ? "Motion access is allowed, but no readings came through. Check that your browser may use motion, then reload. Meanwhile, drag the bubble to try it."
        : "No motion sensor here, so this is a demo: drag the bubble. Open this page on your phone to level for real.");
      ga("level_no_sensor", {});
      if (!userPickedTab) setTab("ruler");
    }, ms);
  }

  function needsPermission() {
    var DM = window.DeviceMotionEvent;
    return !!(DM && typeof DM.requestPermission === "function" && IS_TOUCH);
  }

  function askPermission() {
    AU.unlock();
    S.asked = true; userPickedTab = true;   // they asked for the level: stay on it
    var DM = window.DeviceMotionEvent, DO = window.DeviceOrientationEvent;
    // both calls inside the same tap, neither awaited first: iOS ties each to the gesture
    var asks = [];
    try { asks.push(DM.requestPermission()); } catch (e) { asks.push(Promise.reject(e)); }
    if (DO && typeof DO.requestPermission === "function") {
      try { asks.push(DO.requestPermission()); } catch (e) {}
    }
    el.gateBtn.disabled = true;
    Promise.all(asks.map(function (p) { return Promise.resolve(p).catch(function () { return "denied"; }); })).then(function (res) {
      el.gateBtn.disabled = false;
      var ok = res[0] === "granted" || res[1] === "granted";
      ga("motion_permission", { result: ok ? "granted" : "denied" });
      if (ok) {
        el.gate.hidden = true;
        S.sensor = "probing";
        listen();
        probe(1500);
      } else {
        S.sensor = "denied";
        el.gateText.textContent = "Motion access is off for this page. Close the tab, open the page again and tap Allow when it asks. Meanwhile, drag the bubble to try it.";
        el.gateBtn.hidden = true;
        startDemo();
      }
    });
  }

  /* ================================================================ LEVEL == */

  var CAL = null;          // the calibration flow while it is open

  function startDemo() {
    S.demo = true;
    el.bench.classList.add("is-demo");
    el.lcv.setAttribute("tabindex", "0");
    paintControls();
  }

  // The up vector in SCREEN coordinates, from the sensor or the demo.
  function screenUp() {
    if (S.demo) {
      var mode = S.modePref === "auto" ? "edge" : S.modePref;
      if (mode === "edge") {
        var e = S.demoTilt.e * RAD;
        return { x: Math.sin(e), y: Math.cos(e), z: 0 };
      }
      var sx = Math.sin(S.demoTilt.x * RAD), sy = Math.sin(S.demoTilt.y * RAD);
      return { x: sx, y: sy, z: Math.sqrt(Math.max(0, 1 - sx * sx - sy * sy)) };
    }
    if (!S.up) return null;
    return M.toScreen(S.up, S.screenAngle);
  }

  var lastFrame = 0;
  function stepLevel(t) {
    var dt = lastFrame ? Math.min(0.05, t - lastFrame) : 1 / 60;
    lastFrame = t;
    var us = screenUp();
    if (!us) return;

    var sensed = M.classifyMode(us, S.sensedMode);
    S.sensedMode = sensed;
    var mode = S.modePref === "auto" ? sensed : S.modePref;
    if (mode !== S.mode) { S.mode = mode; S.shown = null; S.locked = false; AU.tick(0); paintSeg(); }
    paintSensed();

    var tx = 0, ty = 0;
    if (S.mode === "edge") {
      var q = M.pickQuadrant(us, S.q);
      if (q !== S.q) S.q = q;
      var th = M.edgeAngle(us, S.q);
      S.read = th; S.readAbs = Math.abs(th);
      tx = M.bubbleMap(th, 4);
    } else {
      var st = M.surfaceTilt(us);
      S.tx = st.x; S.ty = st.y; S.total = st.total;
      var mag = st.total > 90 ? 90 : Math.sqrt(st.x * st.x + st.y * st.y);
      var r = M.bubbleMap(mag, 4), ang = Math.atan2(st.y, st.x);
      tx = r * Math.cos(ang); ty = r * Math.sin(ang);
      S.read = st.total; S.readAbs = st.total;
    }

    // how fast the reading is moving, deg/s (smoothed): the lock waits for calm
    if (S.prevRead !== null) {
      var rate = Math.abs(S.read - S.prevRead) / Math.max(dt, 1 / 240);
      S.rate += (rate - S.rate) * Math.min(1, dt * 8);
    }
    S.prevRead = S.read;

    // the bubble: a damped spring chasing where the vial says it should be
    var omega = reduced ? 16 : 8.5, zeta = reduced ? 1 : 0.62;
    var n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
    for (var i = 0; i < n; i++) {
      S.bubble.x = M.springStep(S.bubble.x, tx, h, omega, zeta);
      S.bubble.y = M.springStep(S.bubble.y, ty, h, omega, zeta);
    }
    var bl = Math.hypot(S.bubble.x.p, S.bubble.y.p);
    if (bl > 1) {                                    // the glass stops it
      S.bubble.x.p /= bl; S.bubble.y.p /= bl;
      S.bubble.x.v *= 0.3; S.bubble.y.v *= 0.3;
    }

    // the lock: in at 0.2, out past 0.3, and only once the reading has settled
    var fresh = S.demo || (t - S.lastDataT < 1);
    if (!S.locked) {
      if (fresh && S.readAbs <= 0.2 && S.rate < 3) {
        if (!S.lockSince) S.lockSince = t;
        if (t - S.lockSince > 0.14) lockOn();
      } else S.lockSince = 0;
    } else if (S.readAbs > 0.3 || !fresh) {
      S.locked = false; S.lockSince = 0;
      paintReadout(true);
    }
    var goal = S.locked ? 1 : 0;
    S.lockAmt += (goal - S.lockAmt) * (reduced ? 1 : Math.min(1, dt * 9));

    var signed = S.mode === "edge" ? S.read : S.readAbs;
    var shown = M.steadyTenth(signed, S.shown);
    if (shown !== S.shown) { S.shown = shown; paintReadout(); }
  }

  function lockOn() {
    S.locked = true;
    var vigor = clamp(1 - S.rate / 3, 0.4, 1);
    AU.detent(vigor, 0);
    if (!S.demo && navigator.vibrate) { try { navigator.vibrate(12); } catch (e) {} }
    if (!S.lockedOnce && !S.demo) { S.lockedOnce = true; ga("level_lock", { mode: S.mode }); }
    paintReadout(true);
  }

  /* ----------------------------------------------------------- words */

  var SIDES = ["right", "top right", "top", "top left", "left", "bottom left", "bottom", "bottom right"];
  function highSide(x, y) {
    var a = Math.atan2(y, x) / RAD;
    return SIDES[((Math.round(a / 45) % 8) + 8) % 8];
  }
  function riseText(deg) {
    var r = M.riseOver(span, deg);
    if (units === "in") {
      var f = M.fracInches(r, 16);
      return f === "0" ? "under 1/16 in" : f + " in";
    }
    return r < 0.5 ? "under 1 mm" : (r < 10 ? r.toFixed(1).replace(/\.0$/, "") : Math.round(r)) + " mm";
  }
  function slopeText(deg) {
    var tan = Math.tan(Math.abs(deg) * RAD);
    var pct = (tan * 100);
    var pctS = pct < 10 ? pct.toFixed(1) : Math.round(pct);
    if (units === "in") {
      var perFt = tan * 12, f = M.fracInches(perFt, 16);
      return (f === "0" ? "under 1/16 in" : f + " in") + " per foot · " + pctS + "%";
    }
    return Math.round(tan * 1000) + " mm per meter · " + pctS + "%";
  }

  var TX = { l1: "", l2: "", a1: "", a2: "" };
  var lastLiveSay = "";
  function paintReadout(force) {
    var d = S.shown === null ? 0 : S.shown;
    var say = "";
    if (!S.hasReading && !S.demo) {
      TX = { l1: "", l2: "", a1: "", a2: "" };
      return;
    }
    if (S.mode === "edge") {
      if (S.locked) {
        TX = { l1: "Level", l2: "Within 0.2° of true", a1: "Dead level", a2: "over " + spanLabel() };
        say = "Level.";
      } else if (S.readAbs > 30) {
        TX = { l1: "Way off", l2: Math.abs(d).toFixed(1) + "°", a1: "Stand the phone on an edge", a2: "or switch to Flat" };
        say = "";
      } else {
        var right = S.read > 0;
        TX = { l1: (right ? "Right" : "Left") + " end high", l2: slopeText(S.read),
          a1: "Raise the " + (right ? "left" : "right") + " end " + riseText(S.read), a2: "over " + spanLabel() };
        say = Math.abs(d).toFixed(1) + " degrees, " + (right ? "right" : "left") + " end high. Raise the " + (right ? "left" : "right") + " end " + riseText(S.read) + ".";
      }
    } else {
      if (S.locked) {
        TX = { l1: "Flat and level", l2: "Within 0.2° of true", a1: "", a2: "" };
        say = "Level.";
      } else if (S.total > 80) {
        TX = { l1: "Lay it flat", l2: "Screen up, on the surface", a1: "", a2: "" };
      } else {
        var side = highSide(S.tx, S.ty);
        TX = { l1: "High side: " + side, l2: "Side to side " + Math.abs(S.tx).toFixed(1) + "° · top to bottom " + Math.abs(S.ty).toFixed(1) + "°", a1: "", a2: "" };
        say = d.toFixed(1) + " degrees, high on the " + side + ".";
      }
    }
    // screen readers: on lock changes, and otherwise no more than every 2.5s
    var t = nowS();
    if (say && (force || t - (paintReadout.t || 0) > 2.5) && say !== lastLiveSay) {
      el.live.textContent = say; lastLiveSay = say; paintReadout.t = t;
    }
    updateShare();
  }

  /* ============================================================ DRAWING ==== */

  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function layer(w, h, dpr) {
    var c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(w * dpr)); c.height = Math.max(1, Math.ceil(h * dpr));
    var x = c.getContext("2d");
    x.scale(dpr, dpr);
    return { c: c, x: x, w: w, h: h };
  }
  function rrect(c, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y); c.arcTo(x + w, y, x + w, y + r, r);
    c.lineTo(x + w, y + h - r); c.arcTo(x + w, y + h, x + w - r, y + h, r);
    c.lineTo(x + r, y + h); c.arcTo(x, y + h, x, y + h - r, r);
    c.lineTo(x, y + r); c.arcTo(x, y, x + r, y, r);
    c.closePath();
  }
  function grad(c, x0, y0, x1, y1, stops) {
    var g = c.createLinearGradient(x0, y0, x1, y1);
    stops.forEach(function (s) { g.addColorStop(s[0], s[1]); });
    return g;
  }
  var ENGRAVE_DARK = "rgba(46, 30, 8, 0.86)", ENGRAVE_LIGHT = "rgba(255, 240, 200, 0.55)";
  function engraveText(c, txt, x, y, font, align, dark, light) {
    c.font = font; c.textAlign = align || "center"; c.textBaseline = "alphabetic";
    c.fillStyle = light || ENGRAVE_LIGHT; c.fillText(txt, x, y + 1);
    c.fillStyle = dark || ENGRAVE_DARK; c.fillText(txt, x, y);
  }
  function engraveLine(c, x0, y0, x1, y1, w) {
    c.lineCap = "butt";
    c.lineWidth = w; c.strokeStyle = ENGRAVE_LIGHT;
    c.beginPath(); c.moveTo(x0, y0 + 1); c.lineTo(x1, y1 + 1); c.stroke();
    c.strokeStyle = ENGRAVE_DARK;
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
  }
  function screw(c, x, y, r, ang) {
    var g = c.createRadialGradient(x, y, r * 0.6, x, y, r * 1.35);
    g.addColorStop(0, "rgba(40,25,5,0.55)"); g.addColorStop(1, "rgba(40,25,5,0)");
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r * 1.35, 0, 7); c.fill();
    var h = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    h.addColorStop(0, "#fff1c4"); h.addColorStop(0.35, "#e0b866"); h.addColorStop(0.8, "#9b6f25"); h.addColorStop(1, "#5c3d10");
    c.fillStyle = h; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
    c.save(); c.translate(x, y); c.rotate(ang);
    c.fillStyle = "rgba(255,236,190,0.5)"; c.fillRect(-r * 0.92, -r * 0.13 + 0.8, r * 1.84, r * 0.26);
    c.fillStyle = "#2c1c05"; c.fillRect(-r * 0.92, -r * 0.13, r * 1.84, r * 0.26);
    c.restore();
  }
  function brushed(c, x, y, w, h, along, seed, strength) {
    var R = rng(seed), n = Math.round((along === "x" ? h : w) * 1.6);
    c.lineWidth = 1;
    for (var i = 0; i < n; i++) {
      var p = R() * (along === "x" ? h : w), a = (R() * 0.07 + 0.015) * (strength || 1);
      c.strokeStyle = R() < 0.5 ? "rgba(255,248,225," + a + ")" : "rgba(60,38,8," + a + ")";
      var s0 = R() * 0.4, s1 = 0.6 + R() * 0.4;
      c.beginPath();
      if (along === "x") { c.moveTo(x + w * s0, y + p); c.lineTo(x + w * s1, y + p); }
      else { c.moveTo(x + p, y + h * s0); c.lineTo(x + p, y + h * s1); }
      c.stroke();
    }
  }

  var BAR_STOPS = [[0, "#fff3c9"], [0.035, "#efd08a"], [0.08, "#c4954a"], [0.3, "#a3762d"], [0.44, "#d9b261"], [0.5, "#f3d897"],
    [0.57, "#cfa452"], [0.8, "#966a24"], [0.94, "#6b4a15"], [0.975, "#4a3109"], [1, "#2c1d05"]];
  var LIQ = { top: "#7d9a14", hi: "#e6f37c", mid: "#c9de48", lo: "#9cba1f", bot: "#56730a" };
  var LIQ_LOCK = { top: "#14864a", hi: "#9cf7bf", mid: "#44d684", lo: "#22a95e", bot: "#0b5a30" };

  /* ---------------------------------------------- edge (machinist level) */

  function edgeGeom(Wf, Hf) {
    var f1 = clamp(Hf * 0.031, 11, 14), f3 = clamp(Hf * 0.05, 15, 22);
    var topH = f1 * 2.9, botH = f3 * 1.25 + f1 * 1.6, gap = 22;
    var Lb = Math.min(Wf * 0.92, 720);
    var hb = Math.max(70, Math.min(Lb * (Wf < 480 ? 0.5 : 0.44), Hf - topH - botH - 70, 230));
    var total = topH + gap + hb + gap + botH, top = -total / 2;
    var x0 = -Lb / 2, y0 = top + topH + gap, cy = y0 + hb / 2;
    var ww = Lb * 0.7, wh = Math.max(24, hb * 0.3);
    var win = { x: -ww / 2, y: y0 + hb * 0.11, w: ww, h: wh };
    var tube = { x: win.x + wh * 0.5, y: win.y + wh * 0.15, w: ww - wh, h: wh * 0.7 };
    var bubLen = tube.w * 0.3, bubH = tube.h * 0.64;
    return {
      Lb: Lb, hb: hb, x0: x0, y0: y0, cy: cy, win: win, tube: tube, bubLen: bubLen, bubH: bubH,
      travel: (tube.w - bubLen) / 2 - 3,
      scaleY: win.y + wh + hb * 0.035,
      digitsY: y0 + hb * 0.885, digitsSize: hb * 0.3,
      f1: f1, f3: f3, l1: top + f1, l2: top + f1 * 2.45,
      a1: y0 + hb + gap + f3 * 0.85, a2: y0 + hb + gap + f3 * 0.85 + f1 * 1.65
    };
  }

  function buildEdgeLayers(Wf, Hf, dpr) {
    var g = edgeGeom(Wf, Hf);
    var base = layer(Wf, Hf, dpr), c = base.x;
    c.translate(Wf / 2, Hf / 2);
    // shadow on the bench, falling toward the edge it stands on
    c.save();
    c.shadowColor = "rgba(0,0,0,0.42)"; c.shadowBlur = g.hb * 0.28; c.shadowOffsetY = g.hb * 0.1;
    rrect(c, g.x0, g.y0, g.Lb, g.hb, g.hb * 0.07); c.fillStyle = "#8a6020"; c.fill();
    c.restore();
    // the bar
    c.save();
    rrect(c, g.x0, g.y0, g.Lb, g.hb, g.hb * 0.07); c.clip();
    c.fillStyle = grad(c, 0, g.y0, 0, g.y0 + g.hb, BAR_STOPS); c.fillRect(g.x0, g.y0, g.Lb, g.hb);
    brushed(c, g.x0, g.y0, g.Lb, g.hb, "x", 131, 1);
    // cut end faces, a touch darker and warmer
    var endW = g.hb * 0.06;
    c.fillStyle = grad(c, g.x0, 0, g.x0 + endW, 0, [[0, "rgba(60,36,6,0.45)"], [1, "rgba(60,36,6,0)"]]);
    c.fillRect(g.x0, g.y0, endW, g.hb);
    c.fillStyle = grad(c, g.x0 + g.Lb, 0, g.x0 + g.Lb - endW, 0, [[0, "rgba(60,36,6,0.45)"], [1, "rgba(60,36,6,0)"]]);
    c.fillRect(g.x0 + g.Lb - endW, g.y0, endW, g.hb);
    // a chamfer catching the light along the top, a dark one underneath
    c.fillStyle = "rgba(255,250,225,0.65)"; c.fillRect(g.x0, g.y0, g.Lb, 1.2);
    c.fillStyle = "rgba(30,18,2,0.55)"; c.fillRect(g.x0, g.y0 + g.hb - 1.5, g.Lb, 1.5);
    c.restore();

    // the window cut for the vial: a recess, shadowed on its top wall
    var w = g.win, wr = w.h * 0.5;
    c.save();
    rrect(c, w.x - 2, w.y - 2, w.w + 4, w.h + 4, wr + 2);
    c.fillStyle = grad(c, 0, w.y - 2, 0, w.y + w.h + 2, [[0, "rgba(40,24,4,0.85)"], [0.55, "rgba(90,60,15,0.4)"], [1, "rgba(255,240,190,0.85)"]]);
    c.fill();
    rrect(c, w.x, w.y, w.w, w.h, wr);
    c.fillStyle = grad(c, 0, w.y, 0, w.y + w.h, [[0, "#120c03"], [0.4, "#2a1d08"], [1, "#3b2a0e"]]);
    c.fill();
    c.restore();

    // engraved scale under the window: where the bubble's center sits for each angle
    var ty = g.scaleY, mid = 0;
    var marks = [0.5, 1, 2, 3, 5];
    engraveLine(c, mid, ty, mid, ty + g.hb * 0.075, 1.6);
    c.fillStyle = ENGRAVE_DARK;
    c.beginPath(); c.moveTo(mid - 4, ty + g.hb * 0.105); c.lineTo(mid + 4, ty + g.hb * 0.105); c.lineTo(mid, ty + g.hb * 0.08); c.closePath(); c.fill();
    var fs = Math.max(9, g.hb * 0.085);
    for (var i = 0; i < marks.length; i++) {
      var dx = M.bubbleMap(marks[i], 4) * g.travel;
      var labeled = marks[i] === 1 || marks[i] === 2 || marks[i] === 5;
      var len = labeled ? g.hb * 0.07 : g.hb * 0.04;
      [-1, 1].forEach(function (sgn) {
        engraveLine(c, sgn * dx, ty, sgn * dx, ty + len, 1.2);
        if (labeled) engraveText(c, marks[i] + (marks[i] === 5 ? "°" : ""), sgn * dx + (marks[i] === 5 ? fs * 0.12 : 0), ty + len + fs * 0.95, "600 " + fs + "px 'Barlow Condensed', sans-serif");
      });
    }

    // screws at the ends, and the maker's mark
    var sr = Math.max(5, g.hb * 0.07), sx = g.Lb / 2 - g.hb * 0.17;
    screw(c, -sx, w.y + w.h / 2, sr, 0.5);
    screw(c, sx, w.y + w.h / 2, sr, -0.9);
    var mf = Math.max(8, g.hb * 0.07);
    engraveText(c, "No. 131", -sx, g.y0 + g.hb * 0.83, "600 " + mf + "px 'Barlow Condensed', sans-serif");
    engraveText(c, "0.1°", sx, g.y0 + g.hb * 0.83, "600 " + mf + "px 'Barlow Condensed', sans-serif");

    // the liquid, twice: everyday spirit and the locked glow
    function liquid(L) {
      var lay = layer(Wf, Hf, dpr), x = lay.x, t = g.tube;
      x.translate(Wf / 2, Hf / 2);
      rrect(x, t.x, t.y, t.w, t.h, t.h / 2); x.save(); x.clip();
      x.fillStyle = grad(x, 0, t.y, 0, t.y + t.h, [[0, L.top], [0.2, L.hi], [0.45, L.mid], [0.8, L.lo], [1, L.bot]]);
      x.fillRect(t.x, t.y, t.w, t.h);
      // the spirit glows from inside: brighter in the middle of the tube
      var rg = x.createRadialGradient(0, t.y + t.h * 0.55, 1, 0, t.y + t.h * 0.55, t.w * 0.55);
      rg.addColorStop(0, "rgba(255,255,220,0.28)"); rg.addColorStop(1, "rgba(255,255,220,0)");
      x.fillStyle = rg; x.fillRect(t.x, t.y, t.w, t.h);
      x.restore();
      return lay;
    }
    var liqA = liquid(LIQ), liqB = liquid(LIQ_LOCK);

    // the glass over everything inside: etched lines, a streak of window light, the ferrules
    var glass = layer(Wf, Hf, dpr), gx = glass.x, t = g.tube;
    gx.translate(Wf / 2, Hf / 2);
    gx.save(); rrect(gx, t.x, t.y, t.w, t.h, t.h / 2); gx.clip();
    var lines = [g.bubLen / 2 + 2, g.bubLen / 2 + 2 + M.bubbleMap(1, 4) * g.travel];
    lines.forEach(function (lx, k) {
      [-1, 1].forEach(function (sgn) {
        gx.strokeStyle = "rgba(255,255,240,0.35)"; gx.lineWidth = 1;
        gx.beginPath(); gx.moveTo(sgn * lx + 1, t.y); gx.lineTo(sgn * lx + 1, t.y + t.h); gx.stroke();
        gx.strokeStyle = k ? "rgba(30,40,5,0.45)" : "rgba(25,32,4,0.8)"; gx.lineWidth = k ? 1 : 1.5;
        gx.beginPath(); gx.moveTo(sgn * lx, t.y); gx.lineTo(sgn * lx, t.y + t.h); gx.stroke();
      });
    });
    // the curved glass: dark at its top and bottom walls, a bright streak near the top
    gx.fillStyle = grad(gx, 0, t.y, 0, t.y + t.h, [[0, "rgba(10,14,2,0.55)"], [0.12, "rgba(10,14,2,0)"], [0.85, "rgba(10,14,2,0)"], [1, "rgba(10,14,2,0.6)"]]);
    gx.fillRect(t.x, t.y, t.w, t.h);
    gx.fillStyle = grad(gx, t.x, 0, t.x + t.w, 0, [[0, "rgba(255,255,255,0)"], [0.12, "rgba(255,255,255,0.62)"], [0.88, "rgba(255,255,255,0.62)"], [1, "rgba(255,255,255,0)"]]);
    rrect(gx, t.x + t.h * 0.4, t.y + t.h * 0.12, t.w - t.h * 0.8, Math.max(1.5, t.h * 0.1), t.h * 0.05); gx.fill();
    gx.fillStyle = "rgba(255,255,255,0.18)";
    rrect(gx, t.x + t.h * 0.5, t.y + t.h * 0.8, t.w - t.h, Math.max(1, t.h * 0.05), 1); gx.fill();
    gx.restore();
    // brass ferrules holding each end of the vial
    [-1, 1].forEach(function (sgn) {
      var fw = g.win.h * 0.55, fx = sgn < 0 ? g.win.x + g.win.h * 0.22 : g.win.x + g.win.w - g.win.h * 0.22 - fw;
      rrect(gx, fx, t.y - t.h * 0.12, fw, t.h * 1.24, fw * 0.3);
      gx.fillStyle = grad(gx, 0, t.y - t.h * 0.12, 0, t.y + t.h * 1.12, [[0, "#f6dc98"], [0.35, "#b98a3c"], [0.6, "#e8c578"], [1, "#6a4813"]]);
      gx.fill();
      gx.strokeStyle = "rgba(40,24,4,0.6)"; gx.lineWidth = 1; gx.stroke();
    });

    return { g: g, base: base, liqA: liqA, liqB: liqB, glass: glass };
  }

  function drawBubbleCapsule(c, cx, cy, len, h, lockAmt) {
    var r = h / 2;
    rrect(c, cx - len / 2, cy - h / 2, len, h, r);
    var fill = c.createLinearGradient(0, cy - h / 2, 0, cy + h / 2);
    fill.addColorStop(0, "rgba(255,255,248,0.95)");
    fill.addColorStop(0.45, "rgba(250,255,225,0.72)");
    fill.addColorStop(1, lockAmt > 0.5 ? "rgba(200,255,220,0.55)" : "rgba(235,248,170,0.55)");
    c.fillStyle = fill; c.fill();
    // refraction makes the rim of a bubble read dark
    c.lineWidth = Math.max(1.2, h * 0.07);
    c.strokeStyle = lockAmt > 0.5 ? "rgba(10,70,35,0.6)" : "rgba(60,78,4,0.62)";
    c.stroke();
    // the meniscus: a bright crescent just inside each curved end
    c.lineWidth = Math.max(1, h * 0.06); c.strokeStyle = "rgba(255,255,255,0.85)";
    c.beginPath(); c.arc(cx - len / 2 + r, cy, r * 0.62, Math.PI * 0.62, Math.PI * 1.38); c.stroke();
    c.beginPath(); c.arc(cx + len / 2 - r, cy, r * 0.62, -Math.PI * 0.38, Math.PI * 0.38); c.stroke();
    // window light along the top of the bubble
    c.fillStyle = "rgba(255,255,255,0.9)";
    rrect(c, cx - len / 2 + r * 0.9, cy - h * 0.32, Math.max(2, len - r * 1.8), Math.max(1.5, h * 0.12), h * 0.06); c.fill();
  }

  /* ----------------------------------------------- surface (bull's-eye) */

  function surfGeom(W, H) {
    var f1 = clamp(H * 0.03, 11, 14), topH = f1 * 2.9;
    var R = Math.min(W * 0.43, (H - topH - 40) / 2.6);
    var Rg = R * 0.68, rb = Rg * 0.21;
    var pw = Math.min(W * 0.62, R * 1.3), ph = Math.max(44, R * 0.42);
    var total = topH + 14 + 2 * R + 12 + ph, top = -total / 2, cy = top + topH + 14 + R;
    return { R: R, cy: cy, Rg: Rg, rb: rb, travel: Rg - rb - 3, f1: f1, l1: top + f1, l2: top + f1 * 2.45,
      plate: { x: -pw / 2, y: cy + R + 12, w: pw, h: ph } };
  }

  function arcText(c, txt, cx, cy, r, mid, size, inward) {
    c.save();
    c.font = "600 " + size + "px 'Barlow Condensed', sans-serif";
    c.textAlign = "center"; c.textBaseline = "middle";
    var total = 0, ws = [];
    for (var i = 0; i < txt.length; i++) { var w = c.measureText(txt[i]).width + size * 0.12; ws.push(w); total += w; }
    // along the top the letters run clockwise; along the bottom they run the
    // other way round, so both read left to right with their feet to the rim
    var dir = inward ? -1 : 1, a = mid - dir * total / r / 2;
    for (i = 0; i < txt.length; i++) {
      var ca = a + dir * ws[i] / r / 2;
      c.save();
      c.translate(cx + Math.cos(ca) * r, cy + Math.sin(ca) * r);
      c.rotate(ca + (inward ? -Math.PI / 2 : Math.PI / 2));
      c.fillStyle = ENGRAVE_LIGHT; c.fillText(txt[i], 0, 1);
      c.fillStyle = ENGRAVE_DARK; c.fillText(txt[i], 0, 0);
      c.restore();
      a += dir * ws[i] / r;
    }
    c.restore();
  }

  function buildSurfLayers(W, H, dpr) {
    var g = surfGeom(W, H), R = g.R, cy = g.cy;
    var base = layer(W, H, dpr), c = base.x;
    c.translate(W / 2, H / 2);
    // shadow
    c.save(); c.shadowColor = "rgba(0,0,0,0.45)"; c.shadowBlur = R * 0.22; c.shadowOffsetY = R * 0.07;
    c.beginPath(); c.arc(0, cy, R, 0, 7); c.fillStyle = "#8a6020"; c.fill(); c.restore();
    // knurled rim
    c.beginPath(); c.arc(0, cy, R, 0, 7);
    c.fillStyle = grad(c, -R, cy - R, R, cy + R, [[0, "#f3d690"], [0.5, "#a0742a"], [1, "#4f350c"]]); c.fill();
    var R2 = R * 0.925, nK = Math.round(R * 1.6);
    for (var k = 0; k < nK; k++) {
      var a = k / nK * Math.PI * 2;
      c.strokeStyle = k % 2 ? "rgba(40,24,4,0.5)" : "rgba(255,240,195,0.32)"; c.lineWidth = 1;
      c.beginPath(); c.moveTo(Math.cos(a) * R2, cy + Math.sin(a) * R2); c.lineTo(Math.cos(a) * (R - 0.5), cy + Math.sin(a) * (R - 0.5)); c.stroke();
    }
    // the turned face: lathe rings and anisotropic highlights
    c.beginPath(); c.arc(0, cy, R2, 0, 7);
    if (c.createConicGradient) {
      var cg = c.createConicGradient(-Math.PI / 4, 0, cy);
      [[0, "#f7e1a2"], [0.1, "#c99a49"], [0.22, "#8f6421"], [0.35, "#c79a4c"], [0.5, "#f4dc9b"], [0.6, "#c3964a"], [0.73, "#7f5719"], [0.86, "#b88b3f"], [1, "#f7e1a2"]]
        .forEach(function (s) { cg.addColorStop(s[0], s[1]); });
      c.fillStyle = cg;
    } else c.fillStyle = grad(c, -R2, cy - R2, R2, cy + R2, [[0, "#f3d690"], [0.5, "#b88b3f"], [1, "#6b4a15"]]);
    c.fill();
    var Rr = R2, R3 = R * 0.745, rr = rng(7);
    for (var r = R3; r < Rr; r += 1.15) {
      c.strokeStyle = rr() < 0.5 ? "rgba(255,248,220," + (0.04 + rr() * 0.07) + ")" : "rgba(50,30,5," + (0.04 + rr() * 0.07) + ")";
      c.lineWidth = 0.8; c.beginPath(); c.arc(0, cy, r, 0, 7); c.stroke();
    }
    c.strokeStyle = "rgba(40,24,4,0.55)"; c.lineWidth = 1.2; c.beginPath(); c.arc(0, cy, R2, 0, 7); c.stroke();
    // engraved ticks around the face
    for (k = 0; k < 72; k++) {
      var ta = k / 72 * Math.PI * 2, major = k % 6 === 0;
      var r0 = R3 + (Rr - R3) * 0.1, r1 = r0 + (Rr - R3) * (major ? 0.3 : 0.16);
      if (k % 18 === 9 || k % 18 === 0) { /* leave room for the lettering */ }
      if ((ta > Math.PI * 1.15 && ta < Math.PI * 1.85) || (ta > Math.PI * 0.2 && ta < Math.PI * 0.8)) continue;
      engraveLine(c, Math.cos(ta) * r0, cy + Math.sin(ta) * r0, Math.cos(ta) * r1, cy + Math.sin(ta) * r1, major ? 1.4 : 1);
    }
    var fsz = Math.max(9, (Rr - R3) * 0.42);
    arcText(c, "ONE PAGE TOYS", 0, cy, (R3 + Rr) / 2 + fsz * 0.05, -Math.PI / 2, fsz);
    arcText(c, "No. 131 · 0.1°", 0, cy, (R3 + Rr) / 2 - fsz * 0.05, Math.PI / 2, fsz, true);
    // the recess the glass sits in
    c.beginPath(); c.arc(0, cy, R3, 0, 7);
    c.fillStyle = grad(c, 0, cy - R3, 0, cy + R3, [[0, "#2a1a04"], [0.5, "#5a3d10"], [1, "#f0d38c"]]); c.fill();

    // the brass plate the reading is engraved on
    var p = g.plate;
    c.save(); c.shadowColor = "rgba(0,0,0,0.35)"; c.shadowBlur = 10; c.shadowOffsetY = 4;
    rrect(c, p.x, p.y, p.w, p.h, p.h * 0.22); c.fillStyle = "#8a6020"; c.fill(); c.restore();
    c.save(); rrect(c, p.x, p.y, p.w, p.h, p.h * 0.22); c.clip();
    c.fillStyle = grad(c, 0, p.y, 0, p.y + p.h, BAR_STOPS); c.fillRect(p.x, p.y, p.w, p.h);
    brushed(c, p.x, p.y, p.w, p.h, "x", 77, 1);
    c.restore();
    screw(c, p.x + p.h * 0.32, p.y + p.h / 2, Math.max(4, p.h * 0.12), 0.4);
    screw(c, p.x + p.w - p.h * 0.32, p.y + p.h / 2, Math.max(4, p.h * 0.12), 1.9);

    function liquid(L) {
      var lay = layer(W, H, dpr), x = lay.x, Rg = g.Rg;
      x.translate(W / 2, H / 2);
      var rgd = x.createRadialGradient(-Rg * 0.2, cy - Rg * 0.25, Rg * 0.05, 0, cy, Rg);
      rgd.addColorStop(0, L.hi); rgd.addColorStop(0.55, L.mid); rgd.addColorStop(0.88, L.lo); rgd.addColorStop(1, L.bot);
      x.beginPath(); x.arc(0, cy, Rg, 0, 7); x.fillStyle = rgd; x.fill();
      return lay;
    }
    var liqA = liquid(LIQ), liqB = liquid(LIQ_LOCK);

    // glass: etched rings for the lock zone and 1, 2, 5 degrees, a crosshair, the dome's light
    var glass = layer(W, H, dpr), gx = glass.x, Rg = g.Rg;
    gx.translate(W / 2, H / 2);
    gx.save(); gx.beginPath(); gx.arc(0, cy, Rg, 0, 7); gx.clip();
    var lockR = g.rb + M.bubbleMap(0.2, 4) * g.travel + 1.5;
    var rings = [[lockR, 1.6, 0.85, ""], [g.rb + M.bubbleMap(1, 4) * g.travel, 1, 0.5, "1°"], [g.rb + M.bubbleMap(2, 4) * g.travel, 1, 0.45, "2°"], [g.rb + M.bubbleMap(5, 4) * g.travel, 1, 0.4, "5°"]];
    rings.forEach(function (ri) {
      gx.strokeStyle = "rgba(255,255,240,0.3)"; gx.lineWidth = ri[1];
      gx.beginPath(); gx.arc(0.6, cy + 0.8, ri[0], 0, 7); gx.stroke();
      gx.strokeStyle = "rgba(25,32,4," + ri[2] + ")";
      gx.beginPath(); gx.arc(0, cy, ri[0], 0, 7); gx.stroke();
      if (ri[3]) {
        var fl = Math.max(8, Rg * 0.075);
        gx.font = "600 " + fl + "px 'Barlow Condensed', sans-serif"; gx.textAlign = "center"; gx.textBaseline = "middle";
        gx.fillStyle = "rgba(25,32,4,0.55)";
        gx.fillText(ri[3], Math.cos(-Math.PI / 4) * ri[0] + fl * 0.55, cy + Math.sin(-Math.PI / 4) * ri[0] - fl * 0.2);
      }
    });
    gx.strokeStyle = "rgba(25,32,4,0.28)"; gx.lineWidth = 1;
    [[1, 0], [0, 1]].forEach(function (d) {
      gx.beginPath(); gx.moveTo(-d[0] * Rg, cy - d[1] * Rg); gx.lineTo(-d[0] * lockR, cy - d[1] * lockR);
      gx.moveTo(d[0] * lockR, cy + d[1] * lockR); gx.lineTo(d[0] * Rg, cy + d[1] * Rg); gx.stroke();
    });
    // the meniscus where the spirit climbs the wall
    gx.strokeStyle = "rgba(20,28,2,0.55)"; gx.lineWidth = Math.max(2, Rg * 0.035);
    gx.beginPath(); gx.arc(0, cy, Rg - gx.lineWidth / 2, 0, 7); gx.stroke();
    // a domed cover glass: soft window reflection top-left, a rim of light
    var hl = gx.createRadialGradient(-Rg * 0.38, cy - Rg * 0.45, 2, -Rg * 0.3, cy - Rg * 0.38, Rg * 0.7);
    hl.addColorStop(0, "rgba(255,255,255,0.5)"); hl.addColorStop(0.5, "rgba(255,255,255,0.12)"); hl.addColorStop(1, "rgba(255,255,255,0)");
    gx.fillStyle = hl; gx.fillRect(-Rg, cy - Rg, Rg * 2, Rg * 2);
    gx.restore();
    gx.lineWidth = 1.5; gx.strokeStyle = "rgba(255,255,255,0.55)";
    gx.beginPath(); gx.arc(0, cy, Rg - 1, Math.PI * 1.05, Math.PI * 1.6); gx.stroke();
    gx.strokeStyle = "rgba(0,0,0,0.35)";
    gx.beginPath(); gx.arc(0, cy, Rg - 0.5, Math.PI * 0.05, Math.PI * 0.6); gx.stroke();

    return { g: g, base: base, liqA: liqA, liqB: liqB, glass: glass };
  }

  function drawBubbleRound(c, cx, cy, rb, vx, vy, lockAmt) {
    var sp = Math.min(0.22, Math.hypot(vx, vy) * 0.08);
    var ang = Math.atan2(vy, vx);
    c.save();
    c.translate(cx, cy); c.rotate(ang); c.scale(1 + sp, 1 / Math.sqrt(1 + sp)); c.rotate(-ang);
    c.beginPath(); c.arc(0, 0, rb, 0, 7);
    var f = c.createRadialGradient(-rb * 0.25, -rb * 0.3, rb * 0.1, 0, 0, rb);
    f.addColorStop(0, "rgba(255,255,250,0.97)"); f.addColorStop(0.6, "rgba(248,255,228,0.75)");
    f.addColorStop(1, lockAmt > 0.5 ? "rgba(190,250,210,0.6)" : "rgba(226,242,160,0.6)");
    c.fillStyle = f; c.fill();
    c.lineWidth = Math.max(1.3, rb * 0.09);
    c.strokeStyle = lockAmt > 0.5 ? "rgba(10,70,35,0.6)" : "rgba(60,78,4,0.62)"; c.stroke();
    c.lineWidth = Math.max(1, rb * 0.08); c.strokeStyle = "rgba(255,255,255,0.9)";
    c.beginPath(); c.arc(0, 0, rb * 0.7, Math.PI * 1.05, Math.PI * 1.55); c.stroke();
    c.strokeStyle = "rgba(255,255,230,0.45)";
    c.beginPath(); c.arc(0, 0, rb * 0.72, Math.PI * 0.1, Math.PI * 0.45); c.stroke();
    c.fillStyle = "rgba(255,255,255,0.95)";
    c.beginPath(); c.arc(-rb * 0.32, -rb * 0.36, Math.max(1.2, rb * 0.09), 0, 7); c.fill();
    c.restore();
  }

  /* ---------------------------------------------------- the frame loop */

  var LV = { w: 0, h: 0, dpr: 1, key: "", layers: null };
  var benchInk = "#2b251d", benchMuted = "rgba(43,37,29,0.62)";
  function readTheme() {
    var cs = getComputedStyle(document.documentElement);
    benchInk = (cs.getPropertyValue("--bench-ink") || benchInk).trim() || benchInk;
    benchMuted = (cs.getPropertyValue("--bench-muted") || benchMuted).trim() || benchMuted;
  }
  readTheme();

  function sizeCanvas(cv) {
    var r = cv.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    var w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    var pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
    return { w: w, h: h, dpr: dpr };
  }

  function levelLayers() {
    var s = sizeCanvas(el.lcv);
    LV.w = s.w; LV.h = s.h; LV.dpr = s.dpr;
    var odd = S.mode === "edge" && (S.q === 1 || S.q === 3);
    var Wf = odd ? s.h : s.w, Hf = odd ? s.w : s.h;
    var key = S.mode + "|" + Wf + "x" + Hf + "@" + s.dpr + "|" + fontsReady;
    if (key !== LV.key) {
      LV.key = key;
      LV.layers = S.mode === "edge" ? buildEdgeLayers(Wf, Hf, s.dpr) : buildSurfLayers(Wf, Hf, s.dpr);
      LV.Wf = Wf; LV.Hf = Hf;
    }
    return LV.layers;
  }

  function drawLevel() {
    var L = levelLayers(), c = el.lcv.getContext("2d");
    var W = LV.w, H = LV.h, dpr = LV.dpr, Wf = LV.Wf, Hf = LV.Hf;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, el.lcv.width, el.lcv.height);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.translate(W / 2, H / 2);
    // while the permission card sits on the bottom of the bench, lift the
    // instrument clear of it
    if (!el.gate.hidden) c.translate(0, -Math.min(H * 0.22, (el.gate.offsetHeight + 16) / 2));
    if (S.mode === "edge") c.rotate([0, -Math.PI / 2, Math.PI, Math.PI / 2][S.q]);
    c.translate(-Wf / 2, -Hf / 2);
    c.drawImage(L.base.c, 0, 0, Wf, Hf);
    var la = S.lockAmt, g = L.g;

    // locked: the spirit glows, and so does the brass around it
    if (la > 0.01) {
      c.save(); c.globalCompositeOperation = "lighter"; c.globalAlpha = la * 0.5;
      var gx = Wf / 2, gy = S.mode === "edge" ? Hf / 2 + g.win.y + g.win.h / 2 : Hf / 2 + g.cy;
      var gr = S.mode === "edge" ? g.win.w * 0.6 : g.R * 1.05;
      var rg = c.createRadialGradient(gx, gy, 1, gx, gy, gr);
      rg.addColorStop(0, "rgba(80,230,140,0.55)"); rg.addColorStop(1, "rgba(80,230,140,0)");
      c.fillStyle = rg; c.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
      c.restore();
    }
    c.drawImage(L.liqA.c, 0, 0, Wf, Hf);
    if (la > 0.01) { c.globalAlpha = la; c.drawImage(L.liqB.c, 0, 0, Wf, Hf); c.globalAlpha = 1; }

    c.save();
    c.translate(Wf / 2, Hf / 2);
    if (S.mode === "edge") {
      var t = g.tube, v = S.bubble.x.v;
      var stretch = 1 + Math.min(0.24, Math.abs(v) * 0.16);
      var len = g.bubLen * stretch, hh = g.bubH / Math.sqrt(stretch);
      var cx = S.bubble.x.p * g.travel;
      // the ends of the vial stop it, squashing it a little
      var lo = t.x + 3, hi = t.x + t.w - 3;
      var left = Math.max(lo, cx - len / 2), right = Math.min(hi, cx + len / 2);
      if (right - left < len) { var sq = (right - left) / len; hh = Math.min(t.h * 0.86, hh / Math.sqrt(sq)); }
      c.save(); rrect(c, t.x, t.y, t.w, t.h, t.h / 2); c.clip();
      drawBubbleCapsule(c, (left + right) / 2, t.y + t.h * 0.44, right - left, hh, la);
      c.restore();
    } else {
      var bx = S.bubble.x.p * g.travel, by = -S.bubble.y.p * g.travel;
      c.save(); c.beginPath(); c.arc(0, g.cy, g.Rg, 0, 7); c.clip();
      drawBubbleRound(c, bx, g.cy + by, g.rb, S.bubble.x.v, -S.bubble.y.v, la);
      c.restore();
    }
    c.restore();
    c.drawImage(L.glass.c, 0, 0, Wf, Hf);

    // the reading, engraved, with an enamel fill
    c.save(); c.translate(Wf / 2, Hf / 2);
    var hasRead = S.hasReading || S.demo;
    var txt = (S.locked ? "0.0" : Math.abs(S.shown || 0).toFixed(1)) + "°";
    var enamel = la > 0.5 ? "rgba(18,120,62,0.95)" : ENGRAVE_DARK;
    if (S.mode === "edge" && hasRead) {
      var ds = g.digitsSize;
      engraveText(c, txt, 0, g.digitsY, "700 " + ds + "px 'Barlow Condensed', sans-serif", "center", enamel);
      // which end is high: a small arrow at that end of the reading, filled red
      var ax = g.Lb * 0.27, ay = g.digitsY - ds * 0.36, as = ds * 0.2;
      [-1, 1].forEach(function (sgn) {
        var high = hasRead && !S.locked && (S.read > 0 ? sgn > 0 : sgn < 0) && Math.abs(S.read) >= 0.05;
        c.beginPath();
        c.moveTo(sgn * ax - as, ay + as * 0.6); c.lineTo(sgn * ax + as, ay + as * 0.6); c.lineTo(sgn * ax, ay - as * 0.8); c.closePath();
        c.fillStyle = ENGRAVE_LIGHT; c.save(); c.translate(0, 1); c.fill(); c.restore();
        c.fillStyle = S.locked ? "rgba(18,120,62,0.9)" : high ? "rgba(178,40,24,0.95)" : "rgba(46,30,8,0.35)";
        c.fill();
        var lab = S.locked ? "LEVEL" : "HIGH";
        engraveText(c, lab, sgn * ax, ay + as * 0.6 + ds * 0.36, "700 " + (ds * 0.26) + "px 'Barlow Condensed', sans-serif", "center",
          S.locked ? "rgba(18,120,62,0.95)" : high ? "rgba(140,32,18,0.95)" : "rgba(46,30,8,0.4)");
      });
      // the words above and below the level, on the bench, readable in this frame
      {
        benchText(c, TX.l1, g.l1, g.f1, true);
        benchText(c, TX.l2, g.l2, g.f1, false);
        c.font = "800 " + g.f3 + "px Archivo, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
        c.fillStyle = S.locked ? okInk() : benchInk; c.fillText(TX.a1, 0, g.a1);
        benchText(c, TX.a2, g.a2, g.f1, false);
      }
    } else if (S.mode === "surface" && hasRead) {
      var p = g.plate, fsz = p.h * 0.62;
      engraveText(c, txt, 0, p.y + p.h * 0.74, "700 " + fsz + "px 'Barlow Condensed', sans-serif", "center", enamel);
      {
        benchText(c, TX.l1, g.l1, g.f1, true);
        benchText(c, TX.l2, g.l2, g.f1, false);
      }
    }
    c.restore();
  }

  function okInk() { return document.documentElement.getAttribute("data-theme") === "dark" ? "#5fd68d" : "#1f8a4c"; }
  function benchText(c, txt, y, f, caps) {
    if (!txt) return;
    c.textAlign = "center"; c.textBaseline = "middle";
    if (caps) {
      c.font = "800 " + f + "px Archivo, sans-serif";
      try { c.letterSpacing = (f * 0.16).toFixed(1) + "px"; } catch (e) {}
      c.fillStyle = S.locked ? okInk() : benchInk;
      c.fillText(txt.toUpperCase(), 0, y);
      try { c.letterSpacing = "0px"; } catch (e) {}
    } else {
      c.font = "600 " + f + "px Inter, sans-serif";
      c.fillStyle = benchMuted;
      c.fillText(txt, 0, y);
    }
  }

  var raf = 0, running = false;
  function frame() {
    raf = 0;
    if (!running) return;
    var t = nowS();
    stepLevel(t);
    if (CAL && CAL.sampling) calTick(t);
    drawLevel();
    raf = requestAnimationFrame(frame);
  }
  function startLoop() {
    if (running) return;
    running = true; lastFrame = 0;
    raf = requestAnimationFrame(frame);
  }
  function stopLoop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  /* --------------------------------------------------------- demo input */

  var demoDrag = null;
  function benchPoint(e) {
    var r = el.lcv.getBoundingClientRect();
    var x = e.clientX - r.left - r.width / 2, y = e.clientY - r.top - r.height / 2;
    var L = LV.layers;
    if (!L) return null;
    if (S.mode === "edge") {
      // undo the frame rotation so "along the vial" is x
      var q = S.q, fx = x, fy = y;
      if (q === 1) { fx = -y; fy = x; } else if (q === 2) { fx = -x; fy = -y; } else if (q === 3) { fx = y; fy = -x; }
      return { x: fx / L.g.travel, y: 0 };
    }
    return { x: x / L.g.travel, y: -(y - L.g.cy) / L.g.travel };
  }
  el.lcv.addEventListener("pointerdown", function (e) {
    if (!S.demo) return;
    AU.unlock();
    demoDrag = { id: e.pointerId };
    try { el.lcv.setPointerCapture(e.pointerId); } catch (err) {}
    el.bench.classList.add("is-dragging");
    demoMove(e);
  });
  function demoMove(e) {
    if (!demoDrag || e.pointerId !== demoDrag.id) return;
    var p = benchPoint(e);
    if (!p) return;
    if (S.mode === "edge") S.demoTilt.e = M.bubbleUnmap(clamp(p.x, -0.995, 0.995), 4);
    else {
      var r = Math.min(0.995, Math.hypot(p.x, p.y)), a = Math.atan2(p.y, p.x);
      var deg = M.bubbleUnmap(r, 4);
      S.demoTilt.x = deg * Math.cos(a); S.demoTilt.y = deg * Math.sin(a);
    }
  }
  el.lcv.addEventListener("pointermove", demoMove);
  function demoUp(e) {
    if (!demoDrag || e.pointerId !== demoDrag.id) return;
    demoDrag = null; el.bench.classList.remove("is-dragging");
  }
  el.lcv.addEventListener("pointerup", demoUp);
  el.lcv.addEventListener("pointercancel", demoUp);
  el.lcv.addEventListener("keydown", function (e) {
    if (!S.demo) return;
    var step = e.shiftKey ? 1 : 0.1, k = e.key, used = true;
    if (S.mode === "edge") {
      var sgn = k === "ArrowRight" || k === "ArrowUp" ? 1 : -1;
      if (k === "ArrowLeft" || k === "ArrowRight" || k === "ArrowUp" || k === "ArrowDown") S.demoTilt.e = clamp(S.demoTilt.e + sgn * step, -30, 30);
      else if (k === "Home" || k === "0") S.demoTilt.e = 0;
      else used = false;
    } else {
      if (k === "ArrowLeft") S.demoTilt.x -= step; else if (k === "ArrowRight") S.demoTilt.x += step;
      else if (k === "ArrowUp") S.demoTilt.y += step; else if (k === "ArrowDown") S.demoTilt.y -= step;
      else if (k === "Home" || k === "0") { S.demoTilt.x = 0; S.demoTilt.y = 0; }
      else used = false;
    }
    if (used) { e.preventDefault(); AU.unlock(); }
  });

  /* ------------------------------------------------------- calibration */

  function avg(list) {
    var s = { x: 0, y: 0, z: 0 };
    list.forEach(function (v) { s.x += v.x; s.y += v.y; s.z += v.z; });
    var n = list.length || 1;
    return { x: s.x / n, y: s.y / n, z: s.z / n };
  }
  function spread(list, m) {
    var worst = 0;
    list.forEach(function (v) { worst = Math.max(worst, Math.hypot(v.x - m.x, v.y - m.y, v.z - m.z)); });
    return worst;
  }

  var CAL_SECONDS = 1.2;
  var CAL_TEXT = {
    surface1: "Lay your phone on a flat surface, screen up, and let go of it.",
    surface2: "Now spin it half a turn on the same spot, so the top points where the bottom was. Let go, then tap.",
    edge1: "Stand your phone on one edge on a flat surface and let go of it.",
    edge2: "Now turn it upside down onto its opposite edge, on the same spot. Let go, then tap.",
    zero: "Set the phone where it should read level and let go."
  };

  function openCal(kind) {
    if (S.sensor !== "live") return;
    AU.unlock();
    CAL = { kind: kind, mode: S.mode, step: 1, samples: [], sampling: false, tries: 0 };
    el.calib.hidden = false; el.calib.classList.remove("is-done");
    el.calibRing.style.setProperty("--p", "0");
    el.calibRing.firstElementChild.textContent = kind === "flip" ? "1" : "";
    el.calibText.textContent = kind === "zero" ? CAL_TEXT.zero : CAL_TEXT[CAL.mode + "1"];
    el.calibGo.textContent = kind === "zero" ? "Zero it" : "Read it";
    el.calibGo.disabled = false; el.calibCancel.hidden = false;
    el.calibGo.focus({ preventScroll: true });
  }
  function closeCal() {
    CAL = null; el.calib.hidden = true;
  }
  function calGo() {
    if (!CAL) return;
    if (CAL.step === "done") { closeCal(); return; }
    if (CAL.sampling) return;
    AU.unlock();
    CAL.sampling = true; CAL.samples = []; CAL.t0 = nowS();
    el.calibGo.disabled = true;
    el.calibText.textContent = "Hold still…";
  }
  function calTick(t) {
    var p = clamp((t - CAL.t0) / CAL_SECONDS, 0, 1);
    el.calibRing.style.setProperty("--p", p.toFixed(3));
    if (p < 1) return;
    CAL.sampling = false;
    var list = CAL.samples;
    if (list.length < 8) { calFail("The sensor went quiet. Try again."); return; }
    var m = avg(list), sp = spread(list, m);
    if (sp > 0.012 && CAL.tries < 4) {       // it moved: start the window over
      CAL.tries++;
      CAL.sampling = true; CAL.samples = []; CAL.t0 = t;
      el.calibText.textContent = "It moved. Let go of it and hold still…";
      return;
    }
    CAL.tries = 0;
    if (CAL.kind === "zero") {
      S.bias = M.quickZero(m, CAL.mode, S.bias);
      S.biasInfo = { x: S.bias.x, y: S.bias.y, method: "zero", t: Date.now() };
      save(K.bias, JSON.stringify(S.biasInfo));
      resetFilters();
      calDone("Zeroed. This spot now reads 0.0°. Calibrate is the better check, since it doesn't assume the surface is level.");
      ga("level_calibrate", { method: "zero" });
      return;
    }
    var alpha = S.orient && nowS() - S.orient.t < 0.5 && typeof S.orient.alpha === "number" ? S.orient.alpha : null;
    if (CAL.step === 1) {
      CAL.m1 = m; CAL.a1 = alpha; CAL.step = 2;
      el.calibRing.firstElementChild.textContent = "2";
      el.calibRing.style.setProperty("--p", "0");
      el.calibText.textContent = CAL_TEXT[CAL.mode + "2"];
      el.calibGo.textContent = "Read it again"; el.calibGo.disabled = false;
      AU.tick(0);
      return;
    }
    var r = M.twoPosition(CAL.m1, m, CAL.mode);
    // Flat, the compass can tell a half turn from a quarter turn; gravity alone cannot.
    if (r && CAL.mode === "surface" && CAL.a1 !== null && alpha !== null) {
      var turned = ((alpha - CAL.a1) % 360 + 360) % 360;
      if (Math.abs(turned - 180) > 50) r = null;
    }
    if (!r) {
      CAL.step = 1;
      el.calibRing.firstElementChild.textContent = "1";
      el.calibRing.style.setProperty("--p", "0");
      el.calibText.textContent = "That didn't look like a half turn on the same spot. Let's start over. " + CAL_TEXT[CAL.mode + "1"];
      el.calibGo.textContent = "Read it"; el.calibGo.disabled = false;
      return;
    }
    S.bias = r.bias;
    S.biasInfo = { x: r.bias.x, y: r.bias.y, method: "flip", t: Date.now() };
    save(K.bias, JSON.stringify(S.biasInfo));
    resetFilters();
    var err = r.error, surf = r.surface.total;
    var msg = err < 0.05 ? "Calibrated. Your phone reads true on its own." :
      "Calibrated. Your phone was reading " + err.toFixed(1) + "° off on its own, and that's corrected now.";
    msg += surf < 0.1 ? " The surface itself is level." : " The surface itself is " + surf.toFixed(1) + "° off level.";
    calDone(msg);
    ga("level_calibrate", { method: "flip" });
  }
  function calDone(msg) {
    CAL.step = "done";
    el.calib.classList.add("is-done");
    el.calibRing.firstElementChild.textContent = "";
    el.calibText.textContent = msg;
    el.calibGo.textContent = "Done"; el.calibGo.disabled = false;
    el.calibCancel.hidden = true;
    AU.chime();
    paintCalState();
  }
  function calFail(msg) {
    el.calibText.textContent = msg;
    el.calibGo.disabled = false;
  }

  function paintCalState() {
    var b = S.biasInfo;
    el.reset.hidden = !b;
    if (!b) { el.calState.innerHTML = "Not calibrated yet."; return; }
    var d = new Date(b.t || Date.now());
    var when = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    el.calState.innerHTML = b.method === "flip" ? "<b>Calibrated</b> " + when + ", two-position check." : "<b>Zeroed</b> " + when + ".";
  }

  /* ------------------------------------------------------------ controls */

  function paintSeg() {
    Array.prototype.forEach.call(el.segBtns, function (b) {
      b.setAttribute("aria-checked", b.getAttribute("data-mode") === S.modePref ? "true" : "false");
    });
  }
  var lastSensed = "";
  function paintSensed() {
    var s = S.modePref === "auto" ? S.mode : "";
    if (s === lastSensed) return;
    lastSensed = s;
    Array.prototype.forEach.call(el.segBtns, function (b) {
      b.classList.toggle("is-sensed", b.getAttribute("data-mode") === s);
    });
    el.lcv.setAttribute("aria-label", S.mode === "edge" ? "A brass machinist's level with a tube vial" : "A round brass bull's-eye level");
  }
  Array.prototype.forEach.call(el.segBtns, function (b) {
    b.addEventListener("click", function () {
      AU.unlock();
      S.modePref = b.getAttribute("data-mode");
      paintSeg(); lastSensed = "*"; paintSensed();
    });
  });

  function paintControls() {
    var live = S.sensor === "live";
    el.actions.hidden = !live;
    paintCalState();
    if (!live) el.calState.textContent = S.sensor === "probing" ? "" : "Calibration uses the phone's motion sensor.";
  }

  function paintSound() {
    var on = AU.on();
    el.sound.setAttribute("aria-pressed", on ? "true" : "false");
    el.sound.setAttribute("aria-label", on ? "Sound on" : "Sound off");
    el.sound.title = on ? "Sound on" : "Sound off";
  }
  el.sound.addEventListener("click", function () {
    AU.unlock(); AU.set(!AU.on()); paintSound();
    if (AU.on()) AU.detent(0.7, 0);
  });

  el.spanBtn.addEventListener("click", function () {
    var list = SPANS[units], i = list.indexOf(span);
    span = list[(i + 1) % list.length];
    save(K.span, String(span));
    paintSpan(); AU.unlock(); AU.tick(0);
  });
  function paintSpan() {
    el.spanBtn.textContent = spanLabel();
    el.spanBtn.setAttribute("aria-label", "Width of what you are leveling: " + spanLabel() + ". Tap to change.");
    S.shown = null;
    paintReadout();
  }

  el.zero.addEventListener("click", function () { openCal("zero"); });
  el.cal.addEventListener("click", function () { openCal("flip"); });
  el.calibGo.addEventListener("click", calGo);
  el.calibCancel.addEventListener("click", closeCal);
  el.reset.addEventListener("click", function () {
    S.bias = null; S.biasInfo = null;
    try { localStorage.removeItem(K.bias); } catch (e) {}
    resetFilters(); paintCalState();
  });
  el.gateBtn.addEventListener("click", askPermission);

  function setNote(t) { el.note.textContent = t; el.note.hidden = !t; }

  /* ================================================================ RULER == */

  var RU = { scale: 0, how: "", ref: "", t: 0, a: 0, b: 25.4, vertical: false, W: 0, H: 0, zero: 12, cal: null, drag: null, lastMm: null };

  function screenKey() {
    return M.deviceKey(screen.width || window.innerWidth, screen.height || window.innerHeight, window.devicePixelRatio || 1);
  }
  function loadScale() {
    var map = loadJSON(K.scale) || {}, hit = map[screenKey()];
    if (hit && hit.s > 1 && hit.s < 20) { RU.scale = hit.s; RU.how = "calibrated"; RU.ref = hit.ref; RU.t = hit.t; return; }
    var d = M.defaultScale(screen.width || innerWidth, screen.height || innerHeight, window.devicePixelRatio || 1, IS_TOUCH, IS_APPLE_TOUCH);
    RU.scale = d.pxPerMm; RU.how = d.how; RU.ref = ""; RU.t = 0;
  }
  loadScale();

  function paintScaleState() {
    var s = el.scaleState;
    s.classList.toggle("is-true", RU.how === "calibrated");
    if (RU.cal) { s.textContent = ""; return; }
    if (RU.how === "calibrated") {
      s.innerHTML = "<b>True to this screen.</b> Set with a " + (RU.ref === "coin" ? "quarter" : "card") + ".";
    } else if (RU.how === "known") {
      s.innerHTML = "<b>Close</b> for this phone. Calibrate once with a card to make it exact.";
    } else {
      s.innerHTML = "<b>Approximate.</b> Calibrate once with a bank card or a quarter.";
    }
    if (window.visualViewport && Math.abs(window.visualViewport.scale - 1) > 0.01) {
      s.innerHTML = "<b>Zoomed in.</b> Pinch back out for a true ruler.";
    }
  }

  function ruleAxis() {
    return RU.vertical ? RU.H : RU.W;
  }
  function ruleAcross() {
    return RU.vertical ? RU.W : RU.H;
  }
  function maxMm() { return (ruleAxis() - RU.zero - 4) / RU.scale; }
  function P(u, v) { return RU.vertical ? { x: v, y: u } : { x: u, y: v }; }

  function layoutRule() {
    var vert = window.innerHeight > window.innerWidth * 1.1 && window.innerWidth < 700;
    el.rule.classList.toggle("is-vertical", vert);
    // Upright on a phone the rule runs to the bottom of the screen and no
    // further: it takes every touch for the jaws, so it cannot be scrolled past.
    var want = "";
    if (vert) {
      var top = el.rule.getBoundingClientRect().top + (window.scrollY || 0);
      want = Math.max(300, Math.round(window.innerHeight - top - 14)) + "px";
    }
    if (el.rule.style.height !== want) el.rule.style.height = want;
    var s = sizeCanvas(el.rcv);
    RU.W = s.w; RU.H = s.h; RU.dpr = s.dpr; RU.vertical = vert;
    RU.a = clamp(RU.a, 0, maxMm()); RU.b = clamp(RU.b, 0, maxMm());
  }

  var steelTex = null;
  function steelLayer() {
    var key = RU.W + "x" + RU.H + "@" + RU.dpr + RU.vertical;
    if (steelTex && steelTex.key === key) return steelTex;
    var L = layer(RU.W, RU.H, RU.dpr), c = L.x, A = ruleAcross(), U = ruleAxis();
    // satin stainless: a soft band of light across, grain along the length
    var g0 = P(0, 0), g1 = P(0, A);
    c.fillStyle = grad(c, g0.x, g0.y, g1.x, g1.y, [[0, "#a9b0b8"], [0.05, "#d3d8de"], [0.32, "#e6e9ed"], [0.5, "#cfd4da"], [0.72, "#dde1e6"], [0.95, "#c3c9d0"], [1, "#9aa2ab"]]);
    c.fillRect(0, 0, RU.W, RU.H);
    var R = rng(31), n = Math.round(A * 2.2);
    for (var i = 0; i < n; i++) {
      var v = R() * A, a = 0.03 + R() * 0.07, s0 = R() * 0.3 * U, s1 = s0 + (0.3 + R() * 0.7) * U;
      c.strokeStyle = R() < 0.5 ? "rgba(255,255,255," + a + ")" : "rgba(40,48,58," + a * 0.8 + ")";
      c.lineWidth = 0.8;
      var p0 = P(s0, v), p1 = P(s1, v);
      c.beginPath(); c.moveTo(p0.x, p0.y); c.lineTo(p1.x, p1.y); c.stroke();
    }
    // the ground edges of the rule
    [[0, "rgba(30,36,44,0.7)"], [1.5, "rgba(255,255,255,0.7)"], [A - 1.5, "rgba(255,255,255,0.45)"], [A - 0.5, "rgba(30,36,44,0.7)"]].forEach(function (e) {
      var a0 = P(0, e[0]), a1 = P(U, e[0]);
      c.strokeStyle = e[1]; c.lineWidth = 1;
      c.beginPath(); c.moveTo(a0.x, a0.y); c.lineTo(a1.x, a1.y); c.stroke();
    });
    // before zero is the end of the rule: it's the bench showing
    var z0 = P(0, 0), z1 = P(RU.zero, A);
    c.fillStyle = "#2a2622";
    c.fillRect(Math.min(z0.x, z1.x), Math.min(z0.y, z1.y), Math.abs(z1.x - z0.x), Math.abs(z1.y - z0.y));
    steelTex = { key: key, L: L };
    return steelTex;
  }

  var INK = "#16191d", INK_LIGHT = "rgba(255,255,255,0.7)";
  function drawRuler() {
    if (el.viewRuler.hidden) return;
    var c = el.rcv.getContext("2d"), dpr = RU.dpr, A = ruleAcross(), U = ruleAxis(), z = RU.zero, s = RU.scale;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, el.rcv.width, el.rcv.height);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.drawImage(steelLayer().L.c, 0, 0, RU.W, RU.H);
    var k = clamp(A / 300, 0.8, 1.25);
    var snap = function (u) { return Math.round(u * dpr) / dpr + 0.5 / dpr; };

    function tickSet(list, lens, widths, edge) {
      list.forEach(function (t) {
        var u = snap(z + t.at);
        if (u > U - 2) return;
        var L = lens[t.rank] * k, w = widths[t.rank];
        var v0 = edge === 0 ? 0 : A, v1 = edge === 0 ? L : A - L;
        var a = P(u, v0), b = P(u, v1);
        c.lineWidth = w;
        c.strokeStyle = INK_LIGHT;
        c.beginPath(); c.moveTo(a.x + (RU.vertical ? 0 : 0.8), a.y + (RU.vertical ? 0.8 : 0)); c.lineTo(b.x + (RU.vertical ? 0 : 0.8), b.y + (RU.vertical ? 0.8 : 0)); c.stroke();
        c.strokeStyle = INK;
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
        if (t.label) {
          var fs = Math.round(15 * k);
          c.font = "700 " + fs + "px 'Barlow Condensed', sans-serif";
          c.fillStyle = INK;
          if (RU.vertical) {
            c.textBaseline = "middle"; c.textAlign = edge === 0 ? "left" : "right";
            c.fillText(t.label, edge === 0 ? L + 5 : A - L - 5, u);
          } else {
            c.textAlign = "center"; c.textBaseline = edge === 0 ? "top" : "bottom";
            c.fillText(t.label, u, edge === 0 ? L + 3 : A - L - 3);
          }
        }
      });
    }
    var len = U - z;
    tickSet(M.ticks(len, s, "in"), [34, 26, 19, 13, 8], [1.6, 1.4, 1.2, 1, 1], 0);
    tickSet(M.ticks(len, s, "mm"), [30, 20, 11], [1.6, 1.3, 1], 1);
    // unit marks by the zero end, and the zero line itself
    c.font = "700 " + Math.round(11 * k) + "px 'Barlow Condensed', sans-serif"; c.fillStyle = "rgba(22,25,29,0.75)";
    if (RU.vertical) {
      c.textBaseline = "top"; c.textAlign = "left"; c.fillText("INCHES", 44 * k, z + 6);
      c.textAlign = "right"; c.fillText("CM", A - 40 * k, z + 6);
    } else {
      c.textBaseline = "top"; c.textAlign = "left"; c.fillText("INCHES", z + 8, 40 * k);
      c.textBaseline = "bottom"; c.fillText("CM", z + 8, A - 36 * k);
    }
    var zl0 = P(z, 0), zl1 = P(z, A);
    c.strokeStyle = "#b3261e"; c.lineWidth = 2;
    c.beginPath(); c.moveTo(zl0.x, zl0.y); c.lineTo(zl1.x, zl1.y); c.stroke();
    // maker's etching down the middle
    c.save();
    var mid = P(z + Math.min(len * 0.62, 25.4 * s * 2.5), A / 2);
    c.translate(mid.x, mid.y); if (RU.vertical) c.rotate(-Math.PI / 2);
    c.font = "600 " + Math.round(10 * k) + "px 'Barlow Condensed', sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillStyle = "rgba(22,25,29,0.32)";
    c.fillText(RU.how === "calibrated" ? "TRUE TO THIS SCREEN · No. 131" : "APPROXIMATE · No. 131", 0, 0);
    c.restore();

    if (RU.cal) drawCardCal(c, A, U, z);
    else drawJaws(c, A, U, z);
  }

  function drawJaws(c, A, U, z) {
    var s = RU.scale, ua = z + RU.a * s, ub = z + RU.b * s;
    var lo = Math.min(ua, ub), hi = Math.max(ua, ub);
    // the measured span, washed warm
    var p0 = P(lo, 0), p1 = P(hi, A);
    c.fillStyle = "rgba(255,190,90,0.09)";
    c.fillRect(Math.min(p0.x, p1.x), Math.min(p0.y, p1.y), Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y));
    // dimension line with arrowheads, out of the way at the middle
    var vm = A * 0.5, m0 = P(lo + 1, vm), m1 = P(hi - 1, vm);
    if (hi - lo > 18) {
      c.strokeStyle = "rgba(150,90,10,0.7)"; c.lineWidth = 1; c.setLineDash([4, 4]);
      c.beginPath(); c.moveTo(m0.x, m0.y); c.lineTo(m1.x, m1.y); c.stroke(); c.setLineDash([]);
    }
    [[ua, ua <= ub ? -1 : 1, RU.drag && RU.drag.jaw === "a"], [ub, ub < ua ? -1 : 1, RU.drag && RU.drag.jaw === "b"]].forEach(function (j) {
      var u = j[0], out = j[1], held = j[2], T = 13;
      // the jaw body sits outside the span; its inner face is the measuring edge
      var b0 = P(u, 0), b1 = P(u + out * T, A);
      var x = Math.min(b0.x, b1.x), y = Math.min(b0.y, b1.y), w = Math.abs(b1.x - b0.x), h = Math.abs(b1.y - b0.y);
      c.save();
      c.shadowColor = "rgba(0,0,0,0.35)"; c.shadowBlur = held ? 10 : 6; c.shadowOffsetX = RU.vertical ? 0 : out * 2; c.shadowOffsetY = RU.vertical ? out * 2 : 0;
      var gA = P(u, 0), gB = P(u + out * T, 0);
      c.fillStyle = grad(c, gA.x, gA.y, gB.x === gA.x ? gA.x : gB.x, gB.y === gA.y ? gA.y : gB.y,
        [[0, "#fff0c0"], [0.25, "#e2bb6a"], [0.6, "#b0843a"], [1, "#6a4813"]]);
      c.fillRect(x, y, w, h);
      c.restore();
      // grip ridges in the middle of the jaw
      for (var r = -3; r <= 3; r++) {
        var gp0 = P(u + out * 3, A / 2 + r * 5), gp1 = P(u + out * (T - 3), A / 2 + r * 5);
        c.strokeStyle = "rgba(60,38,8,0.55)"; c.lineWidth = 1.2;
        c.beginPath(); c.moveTo(gp0.x, gp0.y); c.lineTo(gp1.x, gp1.y); c.stroke();
      }
      // the measuring edge: a crisp scribe line
      var e0 = P(u, 0), e1 = P(u, A);
      c.strokeStyle = held ? "#7a1a10" : "#3a2508"; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(e0.x, e0.y); c.lineTo(e1.x, e1.y); c.stroke();
    });
    // keep the DOM handles over the jaws for focus and keyboard
    [["a", el.jawA, ua], ["b", el.jawB, ub]].forEach(function (j) {
      var off = j[2] - 22;
      j[1].style.transform = RU.vertical ? "translateY(" + off + "px)" : "translateX(" + off + "px)";
      var mm = j[0] === "a" ? RU.a : RU.b;
      j[1].setAttribute("aria-valuemax", String(Math.floor(maxMm())));
      j[1].setAttribute("aria-valuenow", mm.toFixed(1));
      j[1].setAttribute("aria-valuetext", mm.toFixed(1) + " millimeters from zero");
    });
  }

  function drawCardCal(c, A, U, z) {
    var C = RU.cal, s = C.scale;
    // dim the rule so the outline is what you look at
    c.fillStyle = "rgba(20,22,26,0.28)"; c.fillRect(0, 0, RU.W, RU.H);
    c.save();
    c.lineWidth = 2.5; c.strokeStyle = "#e2552b"; c.fillStyle = "rgba(226,85,43,0.12)";
    var far;
    if (C.ref === "card") {
      var L = M.CARD_MM.w * s, Wd = M.CARD_MM.h * s, rad = M.CARD_MM.r * s;
      var a = P(z, 0), b = P(z + L, Wd);
      var x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
      rrect(c, x + 1, y + 1, Math.abs(b.x - a.x) - 2, Math.abs(b.y - a.y) - 2, rad); c.fill(); c.stroke();
      // a chip, so the outline reads as a card
      var ch = P(z + 12.5 * s, 18 * s), cw = 11 * s, chh = 8.5 * s;
      c.fillStyle = "rgba(214,170,70,0.75)";
      if (RU.vertical) rrect(c, ch.x - chh / 2, ch.y - cw / 2, chh, cw, 2 * s); else rrect(c, ch.x - cw / 2, ch.y - chh / 2, cw, chh, 2 * s);
      c.fill();
      far = { u: z + L, v: Wd / 2 };
    } else {
      var d = M.QUARTER_MM * s, ctr = P(z + d / 2, d / 2);
      c.beginPath(); c.arc(ctr.x, ctr.y, d / 2 - 1, 0, 7); c.fill(); c.stroke();
      far = { u: z + d, v: d / 2 };
    }
    // the far edge you are matching, and its grip
    var f0 = P(far.u, 0), f1 = P(far.u, RU.cal.ref === "card" ? M.CARD_MM.h * s : M.QUARTER_MM * s);
    c.lineWidth = 4; c.strokeStyle = "rgba(226,85,43,0.95)";
    c.beginPath(); c.moveTo(f0.x, f0.y); c.lineTo(f1.x, f1.y); c.stroke();
    var hp = P(far.u, far.v);
    c.beginPath(); c.arc(hp.x, hp.y, 9, 0, 7); c.fillStyle = "#fff"; c.fill(); c.lineWidth = 2.5; c.stroke();
    c.restore();
  }

  function paintMeasure() {
    var m = M.measure(RU.a * RU.scale, RU.b * RU.scale, RU.scale);
    var inT = m.inText === "0" && m.mm > 0.05 ? "under 1/16" : m.inText;
    var big = units === "in" ? inT + " in" : m.mmText + " mm";
    var small = units === "in" ? m.mmText + " mm · " + m.inDec + " in" : inT + " in · " + (m.mm / 10).toFixed(2) + " cm";
    el.measureBig.textContent = big;
    el.measureSmall.textContent = small;
    RU.lastText = big + " (" + (units === "in" ? m.mmText + " mm" : inT + " in") + ")";
    updateShare();
  }

  function setJaw(which, mm, silent) {
    mm = clamp(mm, 0, maxMm());
    var prev = RU[which];
    RU[which] = mm;
    if (!silent && Math.floor(prev) !== Math.floor(mm)) {
      var mid = RU.vertical ? 0 : clamp((RU.zero + mm * RU.scale) / RU.W * 2 - 1, -0.8, 0.8);
      AU.tick(mid);
    }
    paintMeasure(); drawRuler();
  }

  function rulePoint(e) {
    var r = el.rcv.getBoundingClientRect();
    return RU.vertical ? e.clientY - r.top : e.clientX - r.left;
  }
  el.rcv.addEventListener("pointerdown", function (e) {
    AU.unlock();
    var u = rulePoint(e);
    try { el.rcv.setPointerCapture(e.pointerId); } catch (err) {}
    el.rule.classList.add("is-dragging");
    if (RU.cal) {
      RU.drag = { id: e.pointerId, u0: u, s0: RU.cal.scale, cal: true };
      return;
    }
    var ua = RU.zero + RU.a * RU.scale, ub = RU.zero + RU.b * RU.scale;
    var jaw = Math.abs(u - ua) <= Math.abs(u - ub) ? "a" : "b";
    var uj = jaw === "a" ? ua : ub;
    var grab = Math.abs(u - uj) < 30 ? u - uj : 0;  // grabbed the jaw itself: keep the offset
    RU.drag = { id: e.pointerId, jaw: jaw, off: grab };
    (jaw === "a" ? el.jawA : el.jawB).focus({ preventScroll: true });
    setJaw(jaw, (u - grab - RU.zero) / RU.scale);
    if (!RU.measured) { RU.measured = true; ga("ruler_measure", {}); }
  });
  el.rcv.addEventListener("pointermove", function (e) {
    var d = RU.drag;
    if (!d || d.id !== e.pointerId) return;
    var u = rulePoint(e);
    if (d.cal) {
      // relative: the card covers the outline, and a finger on plastic does not
      // register, so the drag happens wherever there is bare glass
      var base = RU.cal.ref === "card" ? M.CARD_MM.w : M.QUARTER_MM;
      RU.cal.scale = clamp(d.s0 + (u - d.u0) / base, 2, 14);
      drawRuler();
      return;
    }
    setJaw(d.jaw, (u - d.off - RU.zero) / RU.scale);
  });
  function ruleUp(e) {
    var d = RU.drag;
    if (!d || d.id !== e.pointerId) return;
    RU.drag = null; el.rule.classList.remove("is-dragging");
    drawRuler();
    if (!d.cal) el.rulerLive.textContent = el.measureBig.textContent + ", " + el.measureSmall.textContent.split(" · ")[0];
  }
  el.rcv.addEventListener("pointerup", ruleUp);
  el.rcv.addEventListener("pointercancel", ruleUp);

  [["a", el.jawA], ["b", el.jawB]].forEach(function (j) {
    j[1].addEventListener("keydown", function (e) {
      var fine = units === "in" ? 25.4 / 32 : 0.5, coarse = units === "in" ? 25.4 / 4 : 5;
      var step = e.shiftKey ? coarse : fine, k = e.key, mm = RU[j[0]];
      var fwd = RU.vertical ? (k === "ArrowDown" || k === "ArrowRight") : (k === "ArrowRight" || k === "ArrowUp");
      var back = RU.vertical ? (k === "ArrowUp" || k === "ArrowLeft") : (k === "ArrowLeft" || k === "ArrowDown");
      if (fwd) mm += step; else if (back) mm -= step;
      else if (k === "Home") mm = 0; else if (k === "End") mm = maxMm();
      else return;
      e.preventDefault(); AU.unlock();
      setJaw(j[0], Math.round(mm / step) * step);
      el.rulerLive.textContent = el.measureBig.textContent;
    });
  });

  /* card calibration */
  function openCardCal() {
    AU.unlock();
    RU.cal = { ref: "card", scale: RU.scale, before: RU.scale };
    el.cardCal.hidden = false; el.measure.hidden = true;
    el.rule.classList.add("is-calibrating");
    paintCardText(); paintScaleState(); drawRuler(); updateShare();
    el.calSave.focus({ preventScroll: true });
  }
  function closeCardCal(saveIt) {
    if (!RU.cal) return;
    if (saveIt) {
      RU.scale = RU.cal.scale; RU.how = "calibrated"; RU.ref = RU.cal.ref; RU.t = Date.now();
      var map = loadJSON(K.scale) || {};
      map[screenKey()] = { s: Math.round(RU.scale * 10000) / 10000, ref: RU.ref, t: RU.t };
      save(K.scale, JSON.stringify(map));
      ga("ruler_calibrate", { ref: RU.ref });
      AU.chime();
      steelTex = null;
    }
    RU.cal = null;
    el.cardCal.hidden = true; el.measure.hidden = false;
    el.rule.classList.remove("is-calibrating");
    RU.a = clamp(RU.a, 0, maxMm()); RU.b = clamp(RU.b, 0, maxMm());
    paintScaleState(); paintMeasure(); drawRuler();
    el.rulerCal.focus({ preventScroll: true });
  }
  function paintCardText() {
    var C = RU.cal;
    el.cardText.textContent = C.ref === "card"
      ? "Hold any bank card flat on the screen, its corner tucked against the red zero line and the edge. Drag on bare glass until the outline's far end meets the card's."
      : "Hold a quarter flat on the screen, touching the red zero line and the edge. Drag on bare glass until the circle's far side meets the coin's.";
    el.calSwap.textContent = C.ref === "card" ? "Use a quarter" : "Use a card";
  }
  el.rulerCal.addEventListener("click", openCardCal);
  el.calSave.addEventListener("click", function () { closeCardCal(true); });
  el.calCancel.addEventListener("click", function () { closeCardCal(false); });
  el.calSwap.addEventListener("click", function () { RU.cal.ref = RU.cal.ref === "card" ? "coin" : "card"; paintCardText(); drawRuler(); AU.tick(0); });
  el.calLess.addEventListener("click", function () { RU.cal.scale = clamp(RU.cal.scale * 0.997, 2, 14); drawRuler(); AU.tick(-0.3); });
  el.calMore.addEventListener("click", function () { RU.cal.scale = clamp(RU.cal.scale * 1.003, 2, 14); drawRuler(); AU.tick(0.3); });

  Array.prototype.forEach.call(el.unitBtns, function (b) {
    b.addEventListener("click", function () {
      units = b.getAttribute("data-unit"); save(K.units, units);
      fixSpanForUnits(); save(K.span, String(span));
      paintUnits(); paintMeasure(); paintSpan();
    });
  });
  function paintUnits() {
    Array.prototype.forEach.call(el.unitBtns, function (b) { b.setAttribute("aria-checked", b.getAttribute("data-unit") === units ? "true" : "false"); });
  }

  /* ================================================================= TABS == */

  var tab = "level", userPickedTab = false;
  function setTab(t, byUser) {
    if (byUser) userPickedTab = true;
    tab = t;
    var lv = t === "level";
    el.tabs.setAttribute("data-tab", t);
    el.tabLevel.setAttribute("aria-selected", lv ? "true" : "false");
    el.tabRuler.setAttribute("aria-selected", lv ? "false" : "true");
    el.tabLevel.tabIndex = lv ? 0 : -1; el.tabRuler.tabIndex = lv ? -1 : 0;
    el.viewLevel.hidden = !lv; el.viewRuler.hidden = lv;
    document.body.classList.toggle("is-ruler", !lv);
    if (lv) { startLoop(); }
    else {
      stopLoop();
      layoutRule(); paintScaleState(); paintMeasure(); drawRuler();
    }
    updateShare();
  }
  [el.tabLevel, el.tabRuler].forEach(function (b) {
    b.addEventListener("click", function () { AU.unlock(); setTab(b === el.tabLevel ? "level" : "ruler", true); });
    b.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        var next = tab === "level" ? "ruler" : "level";
        setTab(next, true);
        (next === "level" ? el.tabLevel : el.tabRuler).focus();
      }
    });
  });

  /* ================================================================ SHARE == */

  function benchSnapshot() {
    var src = el.lcv, out = document.createElement("canvas");
    out.width = src.width; out.height = src.height;
    var c = out.getContext("2d");
    var cs = getComputedStyle(document.documentElement);
    c.fillStyle = grad(c, 0, 0, out.width * 0.3, out.height, [[0, cs.getPropertyValue("--bench-1").trim() || "#ebe5da"], [1, cs.getPropertyValue("--bench-2").trim() || "#ddd5c6"]]);
    c.fillRect(0, 0, out.width, out.height);
    c.drawImage(src, 0, 0);
    return out;
  }
  function updateShare() {
    var show = false;
    if (tab === "level" && S.sensor === "live" && S.hasReading) {
      var d = Math.abs(S.shown || 0).toFixed(1);
      if (S.locked) {
        window.OPT_SHARE_TEXT = "Dead level, 0.0°. I checked it with the bubble level on my phone.";
        window.OPT_SHARE_LINE = "Dead level · 0.0°";
      } else {
        window.OPT_SHARE_TEXT = d + "° off level. I checked it with the bubble level on my phone.";
        window.OPT_SHARE_LINE = d + "° off level";
      }
      window.OPT_SHARE_IMAGE = benchSnapshot;
      show = true;
    } else if (tab === "ruler" && RU.measured && Math.abs(RU.b - RU.a) > 1 && !RU.cal) {
      window.OPT_SHARE_TEXT = "I measured " + RU.lastText + " with the ruler on my phone.";
      window.OPT_SHARE_LINE = el.measureBig.textContent + " · " + el.measureSmall.textContent.split(" · ")[0];
      window.OPT_SHARE_IMAGE = function () { return el.rcv; };
      show = true;
    }
    if (!show && el.shareRow.hidden === false) {
      window.OPT_SHARE_TEXT = undefined; window.OPT_SHARE_LINE = undefined; window.OPT_SHARE_IMAGE = undefined;
    }
    el.shareRow.hidden = !show;
  }

  /* ============================================================== LIFECYCLE */

  var wake = null;
  function keepAwake() {
    if (!("wakeLock" in navigator) || wake || document.visibilityState !== "visible") return;
    try {
      navigator.wakeLock.request("screen").then(function (w) {
        wake = w; w.addEventListener("release", function () { wake = null; });
      }).catch(function () {});
    } catch (e) {}
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") { if (tab === "level") startLoop(); if (S.sensor === "live") keepAwake(); }
    else stopLoop();
  });
  // first touch anywhere opens the audio gate (Android never needs a permission tap)
  window.addEventListener("pointerdown", function once() { AU.unlock(); window.removeEventListener("pointerdown", once, true); }, true);

  var fontsReady = 0;
  if (document.fonts && document.fonts.load) {
    Promise.all([document.fonts.load("700 40px 'Barlow Condensed'"), document.fonts.load("600 14px 'Barlow Condensed'"), document.fonts.load("700 16px Archivo")])
      .then(function () { fontsReady = 1; LV.key = ""; steelTex = null; if (tab === "ruler") drawRuler(); }, function () {});
  }

  // Resizes land on the next frame, never inside the observer's own callback
  // (setting the rule's height there would trip the observer again).
  var relayoutQueued = false;
  function relayout() {
    if (relayoutQueued) return;
    relayoutQueued = true;
    requestAnimationFrame(function () {
      relayoutQueued = false;
      LV.key = "";
      if (tab === "ruler") { layoutRule(); paintScaleState(); paintMeasure(); drawRuler(); }
    });
  }
  var ro = window.ResizeObserver ? new ResizeObserver(relayout) : null;
  if (ro) { ro.observe(el.bench); ro.observe(el.rule); }
  window.addEventListener("resize", relayout);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", function () { if (tab === "ruler") paintScaleState(); });
  new MutationObserver(function () { readTheme(); LV.key = ""; }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  // ---- boot
  paintSeg(); paintSound(); paintUnits(); paintSpan(); paintControls();
  if (needsPermission()) {
    // the instrument at rest under the gate: no made-up reading before we have a real one
    S.sensor = "ask";
    el.gate.hidden = false;
  } else if (window.DeviceMotionEvent || window.DeviceOrientationEvent) {
    listen();
    probe(1200);
  } else {
    S.sensor = "none"; startDemo();
    setNote("No motion sensor here, so this is a demo: drag the bubble. Open this page on your phone to level for real.");
    setTab("ruler");
  }
  if (tab === "level") startLoop();
  paintReadout();

  if (navigator.webdriver) {
    window.__levelAndRuler = {
      state: function () {
        return {
          sensor: S.sensor, via: S.via, sign: S.sign, signLocked: S.signLocked, mode: S.mode, q: S.q, read: S.read,
          readAbs: S.readAbs, shown: S.shown, locked: S.locked, lockAmt: S.lockAmt, bias: S.bias, biasInfo: S.biasInfo,
          bubble: { x: S.bubble.x.p, y: S.bubble.y.p }, tab: tab, demo: S.demo, screenAngle: S.screenAngle,
          tx: S.tx, ty: S.ty, cal: CAL ? { step: CAL.step, sampling: CAL.sampling } : null,
          text: TX
        };
      },
      ruler: function () {
        var r = el.rcv.getBoundingClientRect();
        return { scale: RU.scale, how: RU.how, a: RU.a, b: RU.b, zero: RU.zero, vertical: RU.vertical, rect: { x: r.left, y: r.top, w: r.width, h: r.height }, cal: RU.cal ? { ref: RU.cal.ref, scale: RU.cal.scale } : null };
      },
      geom: function () { return LV.layers ? { travel: LV.layers.g.travel, mode: S.mode } : null; }
    };
  }
})();
