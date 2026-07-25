/* Air Hockey — No. 094
 * Drag your mallet around your half of a neon table and put seven past the
 * machine. Substepped circle physics so a fast flick can never tunnel through
 * the puck. Vanilla Canvas 2D + Web Audio. Self-contained.
 * localStorage best key: "airhockey_best" (longest run of match wins). */
(function () {
  "use strict";

  var TAU = Math.PI * 2;

  // ---------------------------------------------------------------- elements
  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var hud = document.getElementById("hud");
  var youEl = document.getElementById("you");
  var themEl = document.getElementById("them");
  var streakEl = document.getElementById("streak");
  var overlay = document.getElementById("overlay");
  var ovEyebrow = document.getElementById("ovEyebrow");
  var ovTitle = document.getElementById("ovTitle");
  var ovText = document.getElementById("ovText");
  var ovBtn = document.getElementById("ovBtn");
  var ovKeys = document.getElementById("ovKeys");
  var hint = document.getElementById("hint");
  var soundBtn = document.getElementById("soundBtn");

  var REDMO = false;
  try { REDMO = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

  // ------------------------------------------------------------------ tuning
  var TARGET = 7;         // goals to win
  var SUB = 8;            // physics substeps per frame
  var REST = 0.92;        // rail restitution
  var DRAG = 0.11;        // per second — an air table has almost none, but a
                          // rally that never bleeds speed is unreadable
  // Tuned down from 1.95 / 0.085. At those numbers the machine parked on its
  // own line and could shut out a determined attack; it now stands further off
  // its goal, reacts a beat slower and only shades part of the angle, so
  // cutting the corners genuinely works.
  var AI_BASE = 1.34;     // mallet speed in table-widths / second
  var AI_LAG = 0.125;     // reaction time constant

  // ------------------------------------------------------------------- state
  var state = "menu";     // menu | serve | play | goal | over
  var you = 0, them = 0, streak = 0, best = 0;
  var serveT = 0, goalT = 0, goalSide = 0, stallT = 0;
  var anchorX = 0, anchorY = 0, anchorT = 0;   // positional stall watchdog
  var shake = 0, flash = 0, flashCol = "#4fe6ff";
  var trail = [];
  var sparks = [];
  var banner = null;

  var puck = { x: 0, y: 0, vx: 0, vy: 0 };
  var mine = { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, tx: 0, ty: 0 };
  var foe = { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, lagX: 0, lagY: 0, err: 0, chaseT: 0, resetT: 0 };

  var dpr = 1, W = 0, H = 0;
  var tx = 0, ty = 0, tw = 0, th = 0, cxT = 0, cty = 0;  // table box + centre
  var pr = 0, mr = 0, goalW = 0, goalDepth = 0;
  var holesCv = null;
  var last = 0;
  var dragging = false;

  // ------------------------------------------------------------ persistence
  var soundOn = true;
  try { best = parseInt(localStorage.getItem("airhockey_best") || "0", 10) || 0; } catch (e) {}
  try { if (localStorage.getItem("airhockey_sound") === "0") soundOn = false; } catch (e) {}
  streakEl.textContent = best;

  // -------------------------------------------------------------------- util
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function hyp(x, y) { return Math.sqrt(x * x + y * y); }

  // ================================================================== AUDIO
  var AC = null, outGain = null, noiseBuf = null, airSrc = null, airGain = null;

  function initAudio() {
    if (AC) return;
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { AC = null; return; }

    outGain = AC.createGain();
    outGain.gain.value = soundOn ? 1 : 0;

    var lp = AC.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 13500; lp.Q.value = 0.6;

    var comp = AC.createDynamicsCompressor();
    comp.threshold.value = -15; comp.knee.value = 26; comp.ratio.value = 3;
    comp.attack.value = 0.003; comp.release.value = 0.2;

    var verb = AC.createConvolver();
    verb.buffer = makeImpulse(1.5, 3);
    var vg = AC.createGain(); vg.gain.value = 0.26;

    var master = AC.createGain(); master.gain.value = 0.92;

    outGain.connect(lp); lp.connect(comp);
    outGain.connect(verb); verb.connect(vg); vg.connect(comp);
    comp.connect(master); master.connect(AC.destination);

    var len = Math.floor(AC.sampleRate * 2);
    noiseBuf = AC.createBuffer(1, len, AC.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  function makeImpulse(dur, decay) {
    var rate = AC.sampleRate, len = Math.max(1, Math.floor(rate * dur));
    var buf = AC.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), prev = 0;
      for (var i = 0; i < len; i++) {
        var t = i / len, env = Math.pow(1 - t, decay);
        prev = prev + 0.3 * ((Math.random() * 2 - 1) - prev);
        d[i] = prev * env;
      }
    }
    return buf;
  }

  // the table's air blowers — a quiet bed that makes the room feel switched on
  function startAir() {
    if (!AC || airSrc || !noiseBuf) return;
    airSrc = AC.createBufferSource();
    airSrc.buffer = noiseBuf;
    airSrc.loop = true;
    var f = AC.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = 620; f.Q.value = 0.7;
    var f2 = AC.createBiquadFilter();
    f2.type = "highpass"; f2.frequency.value = 110;
    airGain = AC.createGain();
    airGain.gain.value = 0.0001;
    airSrc.connect(f); f.connect(f2); f2.connect(airGain); airGain.connect(outGain);
    airSrc.start(0);
    airGain.gain.setTargetAtTime(0.045, AC.currentTime, 0.6);
  }

  function unlockAudio() {
    initAudio();
    if (!AC) return;
    if (AC.state === "suspended") AC.resume();
    try {
      var b = AC.createBuffer(1, 1, 22050), s = AC.createBufferSource();
      s.buffer = b; s.connect(AC.destination); s.start(0);
    } catch (e) {}
    startAir();
  }
  function now() { return AC ? AC.currentTime : 0; }

  function tone(o) {
    if (!AC) return;
    var t = now() + (o.at || 0);
    var osc = AC.createOscillator();
    osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + (o.dur || 0.3));
    if (o.detune) osc.detune.value = o.detune;
    var g = AC.createGain();
    var a = o.a != null ? o.a : 0.004, d = o.dur || 0.3, peak = o.g != null ? o.g : 0.22;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    var node = osc;
    if (o.filt) {
      var f = AC.createBiquadFilter();
      f.type = o.filt; f.frequency.setValueAtTime(o.filtF || 2000, t);
      if (o.filtF2) f.frequency.exponentialRampToValueAtTime(o.filtF2, t + a + d);
      if (o.filtQ) f.Q.value = o.filtQ;
      node.connect(f); node = f;
    }
    node.connect(g);
    if (o.pan != null && AC.createStereoPanner) {
      var p = AC.createStereoPanner(); p.pan.value = clamp(o.pan, -1, 1);
      g.connect(p); p.connect(outGain);
    } else g.connect(outGain);
    osc.start(t); osc.stop(t + a + d + 0.06);
  }

  function noise(o) {
    if (!AC || !noiseBuf) return;
    var t = now() + (o.at || 0), dur = o.dur || 0.1;
    var s = AC.createBufferSource();
    s.buffer = noiseBuf;
    var f = AC.createBiquadFilter();
    f.type = o.filt || "bandpass";
    f.frequency.setValueAtTime(o.f || 1800, t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.f2), t + dur);
    if (o.Q) f.Q.value = o.Q;
    var g = AC.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.g != null ? o.g : 0.18, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g);
    if (o.pan != null && AC.createStereoPanner) {
      var p = AC.createStereoPanner(); p.pan.value = clamp(o.pan, -1, 1);
      g.connect(p); p.connect(outGain);
    } else g.connect(outGain);
    s.start(t, rnd(0, 1)); s.stop(t + dur + 0.05);
  }

  // hollow polycarbonate mallet on a hollow puck: sharp tick + a short ringing
  // body of a few partials. Everything scales with how hard the hit was.
  function sndClack(v, pan) {
    if (!soundOn) return;
    v = clamp(v, 0.15, 1);
    var f0 = 470 * rnd(0.94, 1.07) * (1 + v * 0.12);
    noise({ filt: "bandpass", f: 3400, Q: 1.4, dur: 0.018, g: 0.2 * v, pan: pan });
    var parts = [1, 2.42, 4.1];
    for (var i = 0; i < parts.length; i++) {
      tone({
        type: "sine", f: f0 * parts[i], dur: 0.085 / (1 + i * 0.5),
        a: 0.001, g: (0.24 / (i + 1)) * v, pan: pan
      });
    }
  }

  function sndRail(v, pan) {
    if (!soundOn) return;
    v = clamp(v, 0.12, 1);
    noise({ filt: "bandpass", f: 900, f2: 380, Q: 1.1, dur: 0.05, g: 0.16 * v, pan: pan });
    tone({ type: "sine", f: 236, f2: 168, dur: 0.06, a: 0.001, g: 0.2 * v, pan: pan });
  }

  function sndGoal(forYou) {
    if (!soundOn) return;
    var base = forYou ? 174.6 : 138.6;
    for (var i = 0; i < 2; i++) {
      tone({
        type: "sawtooth", f: base, dur: 0.55, a: 0.012, g: 0.09, detune: i ? 9 : -9,
        filt: "lowpass", filtF: 340, filtF2: 1500, filtQ: 3
      });
    }
    tone({ type: "sine", f: base / 2, dur: 0.5, a: 0.01, g: 0.16 });
    noise({ filt: "highpass", f: 3800, dur: 0.3, g: 0.05 });
  }

  function sndMatch(won) {
    if (!soundOn) return;
    var steps = won ? [0, 4, 7, 12, 16, 19] : [0, -3, -5, -8];
    for (var i = 0; i < steps.length; i++) {
      var f = 392 * Math.pow(2, steps[i] / 12);
      tone({ type: "triangle", f: f, dur: 0.8, a: 0.008, g: 0.1, at: i * 0.09, pan: (i / steps.length - 0.5) * 0.6 });
      tone({ type: "sine", f: f * 2, dur: 0.45, a: 0.005, g: 0.032, at: i * 0.09 });
    }
  }

  soundBtn.addEventListener("click", function () {
    soundOn = !soundOn;
    soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
    try { localStorage.setItem("airhockey_sound", soundOn ? "1" : "0"); } catch (e) {}
    if (outGain && AC) {
      try { outGain.gain.setTargetAtTime(soundOn ? 1 : 0, now(), 0.02); }
      catch (e) { outGain.gain.value = soundOn ? 1 : 0; }
    }
    unlockAudio();
  });
  soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");

  // ================================================================= SIZING
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var ratio = 1.85;                       // height : width
    var maxW = W * 0.9, maxH = H * 0.84;
    tw = Math.min(maxW, maxH / ratio);
    th = tw * ratio;
    tx = (W - tw) / 2;
    ty = (H - th) / 2 + Math.min(14, H * 0.015);
    cxT = tx + tw / 2;
    cty = ty + th / 2;

    pr = tw * 0.052;
    mr = tw * 0.082;
    goalW = tw * 0.36;
    goalDepth = pr * 2.6;

    buildHoles();
    // keep everything on the table after a rotation
    puck.x = clamp(puck.x || cxT, tx + pr, tx + tw - pr);
    puck.y = clamp(puck.y || cty, ty + pr, ty + th - pr);
    mine.x = clamp(mine.x || cxT, tx + mr, tx + tw - mr);
    mine.y = clamp(mine.y || ty + th * 0.82, cty + mr * 0.1, ty + th - mr);
    mine.tx = mine.x; mine.ty = mine.y;
    foe.x = clamp(foe.x || cxT, tx + mr, tx + tw - mr);
    foe.y = clamp(foe.y || ty + th * 0.18, ty + mr, cty - mr * 0.1);
  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", function () {
    resize(); setTimeout(resize, 180); setTimeout(resize, 520);
  });

  function buildHoles() {
    var cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(tw)); cv.height = Math.max(1, Math.round(th));
    var c = cv.getContext("2d");
    var step = Math.max(9, tw * 0.038);
    c.fillStyle = "rgba(255,255,255,0.075)";
    for (var y = step * 0.6; y < th; y += step) {
      for (var x = step * 0.6; x < tw; x += step) {
        c.beginPath();
        c.arc(x, y, Math.max(0.7, step * 0.055), 0, TAU);
        c.fill();
      }
    }
    holesCv = cv;
  }

  // ================================================================== INPUT
  function pointAt(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function aimTo(p) {
    mine.tx = clamp(p.x, tx + mr, tx + tw - mr);
    mine.ty = clamp(p.y, cty + mr * 0.06, ty + th - mr);
  }

  canvas.addEventListener("pointerdown", function (e) {
    unlockAudio();
    if (state === "menu" || state === "over") return;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    dragging = true;
    hint.classList.add("is-gone");
    aimTo(pointAt(e));
  });
  canvas.addEventListener("pointermove", function (e) {
    if (state === "menu" || state === "over") return;
    // a mouse steers without needing a button held; a finger has to be down
    if (e.pointerType === "mouse" || dragging) aimTo(pointAt(e));
  });
  canvas.addEventListener("pointerup", function () { dragging = false; });
  canvas.addEventListener("pointercancel", function () { dragging = false; });

  window.addEventListener("keydown", function (e) {
    if (e.code === "Space" || e.key === " ") {
      e.preventDefault();
      unlockAudio();
      if (state === "menu" || state === "over") ovBtn.click();
    }
  });

  // ================================================================ PHYSICS
  function inGoalMouth(x) { return Math.abs(x - cxT) < goalW / 2 - pr * 0.15; }

  function stepPuck(h) {
    puck.x += puck.vx * h;
    puck.y += puck.vy * h;
    var damp = Math.pow(1 - DRAG, h);
    puck.vx *= damp; puck.vy *= damp;

    // side rails
    if (puck.x - pr < tx) {
      puck.x = tx + pr; puck.vx = Math.abs(puck.vx) * REST;
      railHit();
    } else if (puck.x + pr > tx + tw) {
      puck.x = tx + tw - pr; puck.vx = -Math.abs(puck.vx) * REST;
      railHit();
    }

    // ends — open in the goal mouths
    if (puck.y - pr < ty && !inGoalMouth(puck.x)) {
      puck.y = ty + pr; puck.vy = Math.abs(puck.vy) * REST;
      railHit();
    } else if (puck.y + pr > ty + th && !inGoalMouth(puck.x)) {
      puck.y = ty + th - pr; puck.vy = -Math.abs(puck.vy) * REST;
      railHit();
    }

    // in the mouth, the goal frame still contains the puck sideways
    if (puck.y < ty || puck.y > ty + th) {
      var half = goalW / 2 - pr;
      if (puck.x < cxT - half) { puck.x = cxT - half; puck.vx = Math.abs(puck.vx) * 0.7; }
      if (puck.x > cxT + half) { puck.x = cxT + half; puck.vx = -Math.abs(puck.vx) * 0.7; }
    }

    // fully across the line = goal
    if (state === "play") {
      if (puck.y + pr < ty) scoreGoal(1);
      else if (puck.y - pr > ty + th) scoreGoal(-1);
    }
  }

  function railHit() {
    var v = hyp(puck.vx, puck.vy) / (tw * 3);
    if (v > 0.045) {
      sndRail(v, clamp((puck.x - cxT) / (tw * 0.6), -0.8, 0.8));
      burst(puck.x, puck.y, 4, "#8fd8ff", v);
    }
  }

  function hitMallet(m) {
    var dx = puck.x - m.x, dy = puck.y - m.y;
    var d = hyp(dx, dy);
    var min = pr + mr;
    if (d >= min || d === 0) return;
    var nx = dx / d, ny = dy / d;
    puck.x = m.x + nx * min;
    puck.y = m.y + ny * min;

    // reflect the puck's velocity relative to the mallet, then carry the
    // mallet's own motion into it — that's what makes a flick feel powerful
    var rvx = puck.vx - m.vx, rvy = puck.vy - m.vy;
    var vn = rvx * nx + rvy * ny;
    if (vn < 0) {
      rvx -= 1.72 * vn * nx;
      rvy -= 1.72 * vn * ny;
    }
    puck.vx = rvx + m.vx;
    puck.vy = rvy + m.vy;

    // always leave the face with a little pace so it can't get pinned
    var sp = hyp(puck.vx, puck.vy);
    var minSp = tw * 0.55;
    if (sp < minSp) {
      puck.vx = nx * minSp; puck.vy = ny * minSp; sp = minSp;
    }
    var maxSp = tw * 2.9;
    if (sp > maxSp) { puck.vx *= maxSp / sp; puck.vy *= maxSp / sp; sp = maxSp; }

    sndClack(sp / (tw * 3.4), clamp((puck.x - cxT) / (tw * 0.6), -0.8, 0.8));
    burst(puck.x, puck.y, 7, m === mine ? "#4fe6ff" : "#ff5fa8", sp / (tw * 3.4));
    shake = Math.min(7, shake + sp / (tw * 0.9));
  }

  function burst(x, y, n, col, v) {
    if (REDMO) return;
    for (var i = 0; i < n; i++) {
      var a = rnd(0, TAU), s = rnd(20, 60) * (0.5 + v);
      sparks.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: rnd(0.18, 0.4), col: col });
    }
  }

  // ===================================================================== AI
  function aiTarget() {
    var homeY = ty + th * 0.205;
    var puckMine = puck.y > cty || foe.resetT > 0;

    if (puckMine) {
      // hold the middle, shade toward the puck to cut the angle
      return { x: cxT + (foe.lagX - cxT) * 0.34 + foe.err * goalW * 0.18, y: homeY };
    }
    // stand between the puck and its own goal, facing my net, and drive through
    var gx = cxT + foe.err * goalW * 0.42;
    var gy = ty + th + goalDepth;
    var dx = gx - foe.lagX, dy = gy - foe.lagY;
    var L = hyp(dx, dy) || 1;
    return {
      x: foe.lagX - (dx / L) * (pr + mr) * 0.94,
      y: foe.lagY - (dy / L) * (pr + mr) * 0.94
    };
  }

  function stepAi(h) {
    // Chase timer. Left to itself the machine would stand on the puck and
    // grind it into a corner forever — its target sits behind the puck, and in
    // a corner that target is off-table, so it just leans on it. After a few
    // seconds of getting nowhere it backs off to its own half and lets go.
    if (puck.y <= cty && foe.resetT <= 0) {
      foe.chaseT += h;
      if (foe.chaseT > 2.4) { foe.resetT = 0.85; foe.chaseT = 0; }
    } else {
      foe.chaseT = 0;
    }
    if (foe.resetT > 0) foe.resetT -= h;

    // reaction lag: the AI chases where it last saw the puck
    var k = 1 - Math.pow(0.001, h / AI_LAG);
    foe.lagX += (puck.x - foe.lagX) * k;
    foe.lagY += (puck.y - foe.lagY) * k;

    var t = aiTarget();
    var spd = tw * AI_BASE * (1 + (you - them) * 0.06 - (them - you) * 0.075);
    spd = clamp(spd, tw * 0.85, tw * 2.2);

    var dx = t.x - foe.x, dy = t.y - foe.y;
    var d = hyp(dx, dy);
    var step = Math.min(d, spd * h);
    if (d > 0.0001) { foe.x += dx / d * step; foe.y += dy / d * step; }
    foe.x = clamp(foe.x, tx + mr, tx + tw - mr);
    foe.y = clamp(foe.y, ty + mr * 1.5, cty - mr * 0.06);
  }

  // ============================================================== GAME FLOW
  function serve(toward) {
    puck.x = cxT;
    puck.y = cty + toward * th * 0.06;
    puck.vx = 0; puck.vy = 0;
    trail.length = 0;
    serveT = 0.85;
    state = "serve";
  }

  function scoreGoal(side) {   // +1 = you scored (top net), -1 = they scored
    if (side > 0) { you++; flashCol = "#4fe6ff"; }
    else { them++; flashCol = "#ff5fa8"; }
    youEl.textContent = you;
    themEl.textContent = them;
    goalSide = side;
    sndGoal(side > 0);
    shake = 12;
    flash = 0.5;
    // "CONCEDED" read as odd arcade wording — name who scored instead
    banner = { txt: side > 0 ? "GOAL!" : "CPU SCORES", t: 0, col: side > 0 ? "#8ff0ff" : "#ffa3cd" };
    burst(puck.x, puck.y, 26, side > 0 ? "#4fe6ff" : "#ff5fa8", 1.4);
    puck.vx = 0; puck.vy = 0;
    state = "goal";
    goalT = 1.0;
  }

  function startMatch() {
    you = 0; them = 0;
    youEl.textContent = "0"; themEl.textContent = "0";
    streakEl.textContent = Math.max(best, streak);
    sparks.length = 0; banner = null; shake = 0; flash = 0;
    foe.err = rnd(-0.6, 0.6);
    hud.hidden = false;
    overlay.hidden = true;
    document.body.classList.add("is-playing");
    hint.classList.remove("is-gone");
    mine.x = cxT; mine.y = ty + th * 0.82; mine.tx = mine.x; mine.ty = mine.y;
    foe.x = cxT; foe.y = ty + th * 0.205; foe.lagX = cxT; foe.lagY = cty;
    foe.chaseT = 0; foe.resetT = 0;
    anchorX = cxT; anchorY = cty; anchorT = 0;
    serve(Math.random() < 0.5 ? 1 : -1);
  }

  function endMatch() {
    state = "over";
    var won = you > them;
    if (won) {
      streak++;
      if (streak > best) {
        best = streak;
        try { localStorage.setItem("airhockey_best", String(best)); } catch (e) {}
      }
    } else streak = 0;
    streakEl.textContent = Math.max(best, streak);
    sndMatch(won);

    ovEyebrow.textContent = won ? (streak > 1 ? streak + " in a row" : "Match won") : "Match lost";
    ovTitle.textContent = you + " – " + them;
    ovText.innerHTML = won
      ? "You took it " + you + "–" + them + ". <b>" + (streak > 1 ? streak + " straight wins" : "One down") + "</b> — best run " + best + ". Rack them up again?"
      : "The machine got there first, " + them + "–" + you + ". <b>Cut the angles</b> and let the rails do the work. Best run " + best + ".";
    ovBtn.textContent = won ? "Next match" : "Rematch";
    ovKeys.textContent = "drag to move your mallet";
    overlay.hidden = false;
    document.body.classList.remove("is-playing");

    window.OPT_SHARE_TEXT = won
      ? "I beat the air hockey machine " + you + "–" + them + " on One Page Toys."
      : "The air hockey machine beat me " + them + "–" + you + " on One Page Toys.";
    if (window.OPT_SHARE && window.OPT_SHARE.refresh) window.OPT_SHARE.refresh();
  }

  ovBtn.addEventListener("click", function () {
    unlockAudio();
    startMatch();
  });

  // ================================================================= UPDATE
  function update(dt) {
    if (state === "menu") return;

    if (state === "goal") {
      goalT -= dt;
      if (goalT <= 0) {
        if (you >= TARGET || them >= TARGET) { endMatch(); return; }
        serve(goalSide > 0 ? -1 : 1);
      }
    } else if (state === "serve") {
      serveT -= dt;
      if (serveT <= 0) state = "play";
    }

    // A dead puck deadlocks the table: neither mallet may cross the centre
    // line, so if it stops in a half nobody is reaching, nothing ever happens
    // again. Found by leaving a match idle for 90s — 0-0 forever. Re-face-off
    // toward the machine: refuse to play and it takes the puck.
    if (state === "play") {
      if (hyp(puck.vx, puck.vy) < tw * 0.2) stallT += dt; else stallT = 0;
      // A pinned puck can jitter fast on the spot, so speed alone is not
      // enough — also watch whether it has actually GONE anywhere.
      anchorT += dt;
      if (hyp(puck.x - anchorX, puck.y - anchorY) > tw * 0.22) {
        anchorX = puck.x; anchorY = puck.y; anchorT = 0;
      }
      if (stallT > 2.2 || anchorT > 3) {
        stallT = 0; anchorT = 0;
        anchorX = cxT; anchorY = cty;
        serve(-1);
      }
    } else {
      stallT = 0; anchorT = 0; anchorX = puck.x; anchorY = puck.y;
    }

    var h = dt / SUB;
    for (var s = 0; s < SUB; s++) {
      // player mallet moves toward the pointer inside the substep so a fast
      // flick still resolves against the puck at every position along the way
      mine.px = mine.x; mine.py = mine.y;
      mine.x += (mine.tx - mine.x) * Math.min(1, h * 34);
      mine.y += (mine.ty - mine.y) * Math.min(1, h * 34);
      mine.vx = (mine.x - mine.px) / h;
      mine.vy = (mine.y - mine.py) / h;

      foe.px = foe.x; foe.py = foe.y;
      if (state === "play" || state === "serve") stepAi(h);
      foe.vx = (foe.x - foe.px) / h;
      foe.vy = (foe.y - foe.py) / h;

      if (state === "play" || state === "serve") {
        hitMallet(mine);
        hitMallet(foe);
        stepPuck(h);
      }
    }

    // trail
    if (state === "play" || state === "serve") {
      trail.push({ x: puck.x, y: puck.y });
      if (trail.length > 14) trail.shift();
    }

    for (var i = sparks.length - 1; i >= 0; i--) {
      var p = sparks[i];
      p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.94; p.vy *= 0.94;
      if (p.t > p.life) sparks.splice(i, 1);
    }
    if (banner) { banner.t += dt; if (banner.t > 1.1) banner = null; }
    if (shake > 0) shake = Math.max(0, shake - dt * 40);
    if (flash > 0) flash = Math.max(0, flash - dt * 1.6);
  }

  // =================================================================== DRAW
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // room
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0a0f1e");
    g.addColorStop(0.5, "#060911");
    g.addColorStop(1, "#04060c");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // neon bloom under the table
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    var b = ctx.createRadialGradient(cxT, cty, tw * 0.2, cxT, cty, tw * 1.9);
    b.addColorStop(0, "rgba(50,150,220,0.12)");
    b.addColorStop(1, "rgba(40,120,200,0)");
    ctx.fillStyle = b;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    var sx = 0, sy = 0;
    if (shake > 0 && !REDMO) { sx = rnd(-shake, shake); sy = rnd(-shake, shake); }
    ctx.save();
    ctx.translate(sx, sy);

    drawTable();
    drawGoals();
    drawTrail();
    drawMallet(foe, "#ff5fa8", "#7a1745");
    drawMallet(mine, "#4fe6ff", "#0b4c66");
    drawPuck();
    drawSparks();

    ctx.restore();

    if (banner) drawBanner();
    if (flash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = flash * 0.2;
      ctx.fillStyle = flashCol;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    if (state === "serve") drawServe();
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function drawTable() {
    var rad = tw * 0.05;

    // cabinet shadow
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = tw * 0.16;
    ctx.shadowOffsetY = tw * 0.05;
    ctx.fillStyle = "#0c1424";
    roundRect(ctx, tx - tw * 0.035, ty - tw * 0.035, tw + tw * 0.07, th + tw * 0.07, rad * 1.3);
    ctx.fill();
    ctx.restore();

    // rails
    var railG = ctx.createLinearGradient(tx, ty, tx + tw, ty + th);
    railG.addColorStop(0, "#22304c");
    railG.addColorStop(0.5, "#16203a");
    railG.addColorStop(1, "#0e1628");
    ctx.fillStyle = railG;
    roundRect(ctx, tx - tw * 0.035, ty - tw * 0.035, tw + tw * 0.07, th + tw * 0.07, rad * 1.3);
    ctx.fill();

    // playing surface
    var surf = ctx.createRadialGradient(cxT, cty - th * 0.1, tw * 0.1, cxT, cty, th * 0.7);
    surf.addColorStop(0, "#1a3157");
    surf.addColorStop(0.6, "#0f1e3a");
    surf.addColorStop(1, "#091226");
    ctx.fillStyle = surf;
    roundRect(ctx, tx, ty, tw, th, rad);
    ctx.fill();

    ctx.save();
    roundRect(ctx, tx, ty, tw, th, rad);
    ctx.clip();

    if (holesCv) {
      ctx.globalAlpha = 0.55;
      ctx.drawImage(holesCv, tx, ty);
      ctx.globalAlpha = 1;
    }

    // markings
    ctx.strokeStyle = "rgba(120,200,255,0.3)";
    ctx.lineWidth = Math.max(1.2, tw * 0.006);
    ctx.beginPath();
    ctx.moveTo(tx, cty); ctx.lineTo(tx + tw, cty);
    ctx.stroke();

    ctx.beginPath(); ctx.arc(cxT, cty, tw * 0.19, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(cxT, cty, tw * 0.035, 0, TAU); ctx.stroke();

    // goal creases
    ctx.strokeStyle = "rgba(255,95,168,0.34)";
    ctx.beginPath(); ctx.arc(cxT, ty, goalW * 0.86, 0, Math.PI); ctx.stroke();
    ctx.strokeStyle = "rgba(79,230,255,0.34)";
    ctx.beginPath(); ctx.arc(cxT, ty + th, goalW * 0.86, Math.PI, TAU); ctx.stroke();

    // a soft sheen across the surface
    ctx.globalCompositeOperation = "lighter";
    var sh = ctx.createLinearGradient(tx, ty, tx + tw * 0.7, ty + th * 0.5);
    sh.addColorStop(0, "rgba(150,210,255,0.07)");
    sh.addColorStop(1, "rgba(150,210,255,0)");
    ctx.fillStyle = sh;
    ctx.fillRect(tx, ty, tw, th);
    ctx.globalCompositeOperation = "source-over";
    ctx.restore();

    // neon edge
    ctx.save();
    ctx.strokeStyle = "rgba(90,200,255,0.55)";
    ctx.lineWidth = Math.max(1.4, tw * 0.007);
    ctx.shadowColor = "rgba(80,190,255,0.75)";
    ctx.shadowBlur = tw * 0.05;
    roundRect(ctx, tx, ty, tw, th, rad);
    ctx.stroke();
    ctx.restore();
  }

  function drawGoals() {
    var half = goalW / 2;
    var rad = tw * 0.05;
    // The puck travels goalDepth past the line before a goal registers, but the
    // recess must NOT be painted out there or it reads as a black tab stuck to
    // the outside of the cabinet — so the drawing is clipped to the cabinet.
    ctx.save();
    roundRect(ctx, tx - tw * 0.035, ty - tw * 0.035, tw + tw * 0.07, th + tw * 0.07, rad * 1.3);
    ctx.clip();
    [[ty, -1, "#ff5fa8"], [ty + th, 1, "#4fe6ff"]].forEach(function (gdef) {
      var yy = gdef[0], dir = gdef[1], col = gdef[2];
      var depth = tw * 0.05;
      ctx.save();
      var gg = ctx.createLinearGradient(0, yy, 0, yy + dir * depth);
      gg.addColorStop(0, "rgba(0,0,0,0.92)");
      gg.addColorStop(1, "rgba(0,0,0,0.35)");
      ctx.fillStyle = gg;
      ctx.fillRect(cxT - half, Math.min(yy, yy + dir * depth), goalW, depth);
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(2, tw * 0.011);
      ctx.shadowColor = col;
      ctx.shadowBlur = tw * 0.07;
      ctx.beginPath();
      ctx.moveTo(cxT - half, yy); ctx.lineTo(cxT + half, yy);
      ctx.stroke();
      ctx.restore();
    });
    ctx.restore();
  }

  function drawTrail() {
    if (trail.length < 2 || REDMO) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < trail.length; i++) {
      var a = i / trail.length;
      ctx.globalAlpha = a * a * 0.32;
      ctx.fillStyle = "#79d4ff";
      ctx.beginPath();
      ctx.arc(trail[i].x, trail[i].y, pr * (0.35 + a * 0.6), 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPuck() {
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = "#000";
    ctx.beginPath(); ctx.ellipse(puck.x + pr * 0.16, puck.y + pr * 0.2, pr * 0.98, pr * 0.9, 0, 0, TAU); ctx.fill();
    ctx.restore();

    var pg = ctx.createRadialGradient(puck.x - pr * 0.36, puck.y - pr * 0.4, pr * 0.1, puck.x, puck.y, pr);
    pg.addColorStop(0, "#4b5468");
    pg.addColorStop(0.55, "#20263a");
    pg.addColorStop(1, "#0d1120");
    ctx.fillStyle = pg;
    ctx.beginPath(); ctx.arc(puck.x, puck.y, pr, 0, TAU); ctx.fill();

    ctx.strokeStyle = "rgba(150,215,255,0.8)";
    ctx.lineWidth = Math.max(1.2, pr * 0.13);
    ctx.beginPath(); ctx.arc(puck.x, puck.y, pr * 0.9, 0, TAU); ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.42)";
    ctx.lineWidth = Math.max(1, pr * 0.09);
    ctx.beginPath(); ctx.arc(puck.x, puck.y, pr * 0.62, Math.PI * 1.1, Math.PI * 1.85); ctx.stroke();
  }

  function drawMallet(m, col, deep) {
    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.fillStyle = "#000";
    ctx.beginPath(); ctx.ellipse(m.x + mr * 0.13, m.y + mr * 0.18, mr * 0.97, mr * 0.9, 0, 0, TAU); ctx.fill();
    ctx.restore();

    var g = ctx.createRadialGradient(m.x - mr * 0.34, m.y - mr * 0.4, mr * 0.08, m.x, m.y, mr);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.22, col);
    g.addColorStop(0.78, deep);
    g.addColorStop(1, "#050a14");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(m.x, m.y, mr, 0, TAU); ctx.fill();

    // rim
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(1.4, mr * 0.09);
    ctx.shadowColor = col;
    ctx.shadowBlur = mr * 0.7;
    ctx.beginPath(); ctx.arc(m.x, m.y, mr * 0.93, 0, TAU); ctx.stroke();
    ctx.shadowBlur = 0;

    // handle knob
    var kg = ctx.createRadialGradient(m.x - mr * 0.16, m.y - mr * 0.2, mr * 0.03, m.x, m.y, mr * 0.44);
    kg.addColorStop(0, "rgba(255,255,255,0.95)");
    kg.addColorStop(0.5, deep);
    kg.addColorStop(1, "rgba(4,8,18,0.9)");
    ctx.fillStyle = kg;
    ctx.beginPath(); ctx.arc(m.x, m.y, mr * 0.44, 0, TAU); ctx.fill();
  }

  function drawSparks() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < sparks.length; i++) {
      var p = sparks[i];
      var a = 1 - p.t / p.life;
      ctx.globalAlpha = a * 0.8;
      ctx.fillStyle = p.col;
      ctx.beginPath(); ctx.arc(p.x, p.y, 1.2 + a * 2.6, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  function drawBanner() {
    var t = banner.t / 1.1;
    var a = t < 0.1 ? t / 0.1 : 1 - Math.pow((t - 0.1) / 0.9, 2);
    var pop = banner.t < 0.16 ? 1 + (0.16 - banner.t) * 2.2 : 1;
    ctx.save();
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.translate(cxT, cty);
    ctx.scale(pop, pop);
    var fs = tw * 0.16;
    ctx.font = "800 " + Math.round(fs) + "px 'Geist', system-ui, sans-serif";
    // shrink to fit rather than bleed off the rails on a narrow table
    var wNeeded = ctx.measureText(banner.txt).width;
    if (wNeeded > tw * 0.92) {
      fs *= (tw * 0.92) / wNeeded;
      ctx.font = "800 " + Math.round(fs) + "px 'Geist', system-ui, sans-serif";
    }
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.shadowColor = banner.col; ctx.shadowBlur = 26;
    ctx.fillStyle = banner.col;
    ctx.fillText(banner.txt, 0, 0);
    ctx.restore();
  }

  function drawServe() {
    var n = Math.ceil(serveT / 0.29);
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.font = "800 " + Math.round(tw * 0.1) + "px 'Geist Mono', ui-monospace, monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(180,225,255,0.9)";
    ctx.fillText(n > 0 ? String(n) : "GO", cxT, cty - th * 0.13);
    ctx.restore();
  }

  // ==================================================================== LOOP
  function frame(ts) {
    if (!last) last = ts;
    var dt = Math.min(0.04, (ts - last) / 1000);
    last = ts;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  resize();
  requestAnimationFrame(frame);
})();
