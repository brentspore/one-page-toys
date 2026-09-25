/* Maw — No. 123. Hold the rim of a living well.
 *
 * You sit on the lip of a well, looking down it. Things climb up the walls out
 * of the dark, lane by lane, and you slide around the rim spitting light down
 * your lane. Anything that reaches the top turns and crawls around the rim at
 * you. Clear the well and you dive down its throat into the next one.
 *
 * The genre is forty years old and the rules are free to use; the name, the
 * creatures, the wells and the colours are this toy's own. It is deliberately
 * ORGANIC rather than vector — wet flesh, ribs like comb-jelly rows, light
 * made by living things — so it reads as nothing like the neon original, and
 * nothing like Trench Runner next door.
 *
 * well.js  — shapes, camera, projection, and the WebGL membrane
 * audio.js — every sound
 * this     — the game, the creatures, input, and everything drawn in 2D
 */
(function () {
  "use strict";

  var WELL = window.MAW_WELL, AU = window.MAW_AUDIO;
  var TAU = Math.PI * 2;
  var glCanvas = document.getElementById("gl");
  var canvas = document.getElementById("fx");
  var ctx = canvas.getContext("2d");
  var GL = WELL.makeGL(glCanvas);
  var W = 0, H = 0, DPR = 1, GLS = 1;

  var el = {
    hud: document.getElementById("hud"),
    score: document.getElementById("score"),
    depth: document.getElementById("depth"),
    mult: document.getElementById("mult"),
    pips: document.getElementById("pips"),
    lives: document.getElementById("lives"),
    best: document.getElementById("best"),
    bestK: document.getElementById("bestK"),
    flare: document.getElementById("flareBtn"),
    flareLabel: document.getElementById("flareLabel"),
    callout: document.getElementById("callout"),
    calloutBig: document.getElementById("calloutBig"),
    calloutSub: document.getElementById("calloutSub"),
    overlay: document.getElementById("overlay"),
    ovEyebrow: document.getElementById("ovEyebrow"),
    ovTitle: document.getElementById("ovTitle"),
    ovText: document.getElementById("ovText"),
    ovBtn: document.getElementById("ovBtn"),
    ovDemo: document.getElementById("ovDemo"),
    ovKeys: document.getElementById("ovKeys"),
    chBtn: document.getElementById("chBtn"),
    soundBtn: document.getElementById("soundBtn"),
    hint: document.getElementById("hint")
  };

  var KEY_BEST = "maw_best";     // best score — the one ticket key, dir up
  var KEY_DEEP = "maw_depth";    // deepest depth reached, shown only
  var KEY_SOUND = "maw_sound";

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;

  /* ------------------------------------------------------------ palettes */

  // One per well. The walls are cool and dark; the creatures are warm and
  // bright, so they read on every palette without an outline.
  var PALS = [
    { deep: [0.055, 0.006, 0.03], flesh: [0.5, 0.085, 0.2], glow: [0.4, 1.0, 0.9], bg: ["#2a0715", "#060104"] },
    { deep: [0.012, 0.045, 0.06], flesh: [0.08, 0.27, 0.32], glow: [0.4, 1.0, 0.86], bg: ["#07232b", "#010406"] },
    { deep: [0.01, 0.025, 0.1], flesh: [0.07, 0.17, 0.46], glow: [0.55, 0.8, 1.0], bg: ["#08143c", "#01020a"] },
    { deep: [0.07, 0.008, 0.035], flesh: [0.46, 0.05, 0.13], glow: [1.0, 0.82, 0.46], bg: ["#2c0610", "#060103"] },
    { deep: [0.008, 0.06, 0.045], flesh: [0.05, 0.25, 0.2], glow: [0.55, 1.0, 0.7], bg: ["#06261e", "#010604"] },
    { deep: [0.025, 0.018, 0.09], flesh: [0.15, 0.1, 0.36], glow: [1.0, 0.78, 0.38], bg: ["#150e36", "#030208"] },
    { deep: [0.035, 0.01, 0.11], flesh: [0.2, 0.06, 0.46], glow: [0.75, 0.58, 1.0], bg: ["#190a3a", "#03010a"] },
    { deep: [0.02, 0.035, 0.06], flesh: [0.15, 0.21, 0.29], glow: [0.82, 0.95, 1.0], bg: ["#0f1c2c", "#020306"] },
    { deep: [0.06, 0.008, 0.07], flesh: [0.36, 0.05, 0.32], glow: [1.0, 0.6, 0.45], bg: ["#2c0828", "#060106"] },
    { deep: [0.004, 0.05, 0.045], flesh: [0.03, 0.22, 0.19], glow: [0.9, 1.0, 0.5], bg: ["#042622", "#010504"] }
  ];
  PALS.forEach(function (p) {
    p.hot = [1.0, 0.28, 0.3];
    p.mine = [1.0, 0.95, 0.85];
    p.glowCss = css(p.glow, 1);
    p.rib = mixc(p.flesh, p.glow, 0.35);
  });

  var COL = {
    mite: [1.0, 0.92, 0.76],
    skitter: [1.0, 0.36, 0.42],
    brood: [1.0, 0.7, 0.26],
    spitter: [0.78, 1.0, 0.3],
    weaver: [0.88, 0.76, 1.0],
    glob: [0.74, 1.0, 0.32],
    pearl: [1.0, 0.95, 0.84],
    me: [0.82, 0.97, 1.0]
  };

  function css(c, a) {
    return "rgba(" + Math.round(c[0] * 255) + "," + Math.round(c[1] * 255) + "," + Math.round(c[2] * 255) + "," + a + ")";
  }
  function mixc(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function ease(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

  /* ------------------------------------------------------------- tuning */

  var SHOT_SPD = 2.5;         // depth units per second — the whole well in 0.4s
  var MAX_SHOTS = 6;
  var FIRE_CD = 0.1;          // anti-spam floor; one shot per tap, not a stream
  var HOLD_DELAY = 0.26, HOLD_RATE = 0.15;
  var LANE_STEP = 0.028;      // how fast the rim can be crossed with a mouse
  var HIT_R = 0.045;
  var BITE = 0.46;            // grace between a crawler landing in your lane and it biting
  var PTS = { mite: 50, skitter: 150, brood: 100, spitter: 200, weaver: 250, glob: 25, silk: 10 };
  var INTRO_T = 1.5, DIVE_T = 2.35, DIE_T = 1.7;

  function params(n) {
    var tier = Math.floor((n - 1) / 10);
    return {
      count: Math.min(46, 11 + n * 3),
      interval: Math.max(0.4, (n === 1 ? 1.75 : n === 2 ? 1.6 : 1.5) * Math.pow(0.9, n - 1)),
      speed: Math.min(2.1, (n === 1 ? 0.86 : n === 2 ? 0.93 : 1 + (n - 1) * 0.07) * (1 + tier * 0.12))
    };
  }
  function weights(n) {
    if (n <= 1) return { mite: 0.68, skitter: 0.32 };
    if (n === 2) return { mite: 0.5, skitter: 0.34, brood: 0.16 };
    if (n === 3) return { mite: 0.4, skitter: 0.3, brood: 0.14, spitter: 0.16 };
    if (n < 7) return { mite: 0.3, skitter: 0.3, brood: 0.14, spitter: 0.12, weaver: 0.14 };
    return { mite: 0.2, skitter: 0.36, brood: 0.16, spitter: 0.14, weaver: 0.14 };
  }
  // the depth each creature first shows up, and what it does
  var INTRO = { brood: [2, "Brood sac", "bursts in two"], spitter: [3, "Spitter", "spits up the lane"], weaver: [4, "Weaver", "leaves silk · don't dive into it"] };

  /* -------------------------------------------------------------- state */

  var G = {
    phase: "attract",         // attract | intro | play | dying | dive | over
    paused: false,
    depth: 1, sh: null, pal: PALS[0],
    lane: 0, vis: 0, clawD: 0, snap: 0,
    score: 0, best: 0, deepest: 0, lives: 3, streak: 0, maxMult: 1,
    kills: 0, fired: 0, hits: 0,
    enemies: [], shots: [], globs: [], pearls: [],
    silk: new Float32Array(16),
    queue: [], spawnIn: 0, prm: null, lastSpawn: -1, seen: {},
    flareUses: 0, flareFx: 0, pierceT: 0, inv: 0,
    phaseT: 0, clock: 0,
    beatPh: 0, beat: 0, bpm: 60, pressure: 0,
    heat: new Float32Array(16), laneFlash: new Float32Array(16), ripples: [],
    parts: [], pops: [],
    shake: 0, hurt: 0, whiteout: 0, fade: 1,
    nextLife: 20000, fireCd: 0, chitterPh: 0,
    grabber: null, cause: "",
    challenge: null, beaten: false,
    demo: { t: 0, spawn: 0 }
  };

  var inp = {
    moveId: null, lx: 0, ly: 0, lt: 0, acc: 0, recent: 0, map: null, lastMx: 0, lastMove: 0,
    fireHeld: false, holdT: 0, holdType: "",
    mouseTarget: null, stepT: 0,
    keyDir: 0, keyLaneDir: 0, keyT: 0, keyFire: false
  };

  /* ---------------------------------------------------------- geometry */

  var P0 = { x: 0, y: 0, s: 0 }, P1 = { x: 0, y: 0, s: 0 }, P2 = { x: 0, y: 0, s: 0 }, P3 = { x: 0, y: 0, s: 0 };

  function wrapLane(l) {
    var N = G.sh.N;
    return G.sh.closed ? ((l % N) + N) % N : clamp(l, 0, N - 1);
  }
  function laneValid(l) { return G.sh.closed || (l >= 0 && l <= G.sh.N - 1); }
  // shortest signed lane distance a -> b
  function laneDelta(a, b) {
    var d = b - a, N = G.sh.N;
    if (G.sh.closed) { d = ((d % N) + N) % N; if (d > N / 2) d -= N; }
    return d;
  }
  function laneMid(l, d, out) { return WELL.laneAt(G.sh, l, 0.5, d, out); }
  function panOf(l) {
    laneMid(l, 0, P3);
    return clamp((P3.x - W / 2) / (W / 2), -1, 1);
  }
  // the rim's direction at lane l (edge l -> edge l+1), in screen space
  function rimTangent(l) {
    WELL.edgeAt(G.sh, l, 0, P0); WELL.edgeAt(G.sh, l + 1, 0, P1);
    var dx = P1.x - P0.x, dy = P1.y - P0.y, len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len, w: len };
  }

  /* ------------------------------------------------------------ layout */

  function layout() {
    W = window.innerWidth; H = window.innerHeight;
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    sizeGL();
    fitWell();
  }
  function sizeGL() {
    GLS = Math.min(DPR, GLS_CAP);
    glCanvas.width = Math.round(W * GLS); glCanvas.height = Math.round(H * GLS);
  }
  var GLS_CAP = 1.5;
  function fitWell() {
    if (!G.sh) return;
    var portrait = H > W;
    var top = portrait ? 74 : 62, bottom = coarse ? (portrait ? 150 : 70) : 54, side = portrait ? 10 : 24;
    if (H < 520) { top = 14; bottom = 14; side = 120; }
    WELL.fit(G.sh, W, H, { x: side, y: top, w: W - side * 2, h: H - top - bottom });
  }

  function setWell(depth) {
    var idx = (depth - 1) % WELL.count;
    G.sh = WELL.shape(idx);
    G.pal = PALS[idx % PALS.length];
    if (GL) GL.setShape(G.sh);
    for (var i = 0; i < 16; i++) { G.silk[i] = 1; G.heat[i] = 0; G.laneFlash[i] = 0; }
    G.lane = G.sh.start; G.vis = G.lane;
    inp.mouseTarget = null; inp.acc = 0;
    fitWell();
    var root = document.documentElement.style;
    root.setProperty("--glow", G.pal.glowCss);
    root.setProperty("--bg1", G.pal.bg[0]);
    root.setProperty("--bg2", G.pal.bg[1]);
  }

  /* ----------------------------------------------------------- effects */

  var glowCache = {};
  function glowImg(rgb) {
    var key = rgb.join(",");
    if (glowCache[key]) return glowCache[key];
    var c = document.createElement("canvas"); c.width = c.height = 64;
    var x = c.getContext("2d"), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.16, css(rgb, 0.85));
    g.addColorStop(0.45, css(rgb, 0.22));
    g.addColorStop(1, css(rgb, 0));
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    glowCache[key] = c;
    return c;
  }
  function glowAt(rgb, x, y, r, a) {
    if (r <= 0.5 || a <= 0.01) return;
    ctx.globalAlpha = Math.min(1, a);
    ctx.drawImage(glowImg(rgb), x - r, y - r, r * 2, r * 2);
  }

  function burst(x, y, rgb, n, spd, size) {
    if (reduceMotion) n = Math.ceil(n / 2);
    for (var i = 0; i < n && G.parts.length < 420; i++) {
      var a = Math.random() * TAU, v = spd * (0.25 + Math.random());
      G.parts.push({
        x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: 0, max: rnd(0.35, 0.8), r: size * rnd(0.5, 1.2), col: rgb,
        kind: Math.random() < 0.35 ? "shard" : "glow", rot: Math.random() * TAU, vr: rnd(-12, 12)
      });
    }
  }
  function popup(x, y, text, rgb) {
    G.pops.push({ x: x, y: y, text: text, col: rgb, life: 0 });
    if (G.pops.length > 14) G.pops.shift();
  }
  function ripple(l, d, w) {
    G.ripples.push({ s: l + 0.5, d: d, t0: G.clock, w: w });
    if (G.ripples.length > 6) G.ripples.shift();
  }
  function shake(a) { if (!reduceMotion) G.shake = Math.max(G.shake, a); }

  var calloutT = null;
  function callout(big, sub, bad, ms) {
    el.calloutBig.textContent = big;
    el.calloutSub.textContent = sub || "";
    el.callout.classList.toggle("is-bad", !!bad);
    el.callout.classList.remove("is-out", "is-pop");
    void el.callout.offsetWidth;
    el.callout.classList.add("is-pop");
    el.callout.hidden = false;
    clearTimeout(calloutT);
    calloutT = setTimeout(function () {
      el.callout.classList.add("is-out");
      calloutT = setTimeout(function () { el.callout.hidden = true; }, 420);
    }, ms || 1300);
  }

  /* ----------------------------------------------------------- scoring */

  function mult() { return Math.min(8, 1 + Math.floor(G.streak / 5)); }
  function onHit() {
    var m0 = mult();
    G.streak = Math.min(35, G.streak + 1);
    G.hits++;
    if (mult() > m0) {
      G.maxMult = Math.max(G.maxMult, mult());
      bumpClass(el.mult, "is-up");
    }
  }
  function onMiss() {
    var m = mult();
    if (G.streak === 0) return;
    G.streak = m > 1 ? (m - 2) * 5 : 0;
    if (m > 1) bumpClass(el.mult, "is-down");
  }
  function bumpClass(node, c) {
    node.classList.remove("is-up", "is-down", "is-struck");
    void node.offsetWidth;
    node.classList.add(c);
  }
  function addScore(n) {
    G.score += n;
    if (G.score >= G.nextLife) {
      G.nextLife += G.nextLife < 60000 ? 30000 : 50000;
      if (G.lives < 6) {
        G.lives++;
        AU.extraLife();
        callout("+1 life", "", false, 1100);
      }
    }
    if (G.challenge && !G.beaten && G.score > G.challenge.score) {
      G.beaten = true;
      AU.challenge();
      callout("Challenge beaten", "you passed " + G.challenge.score.toLocaleString(), false, 1800);
      gtagSafe("challenge_beaten", { toy: "maw", value: G.score });
    }
  }

  /* ----------------------------------------------------------- spawning */

  function buildQueue(n) {
    var P = params(n), w = weights(n), q = [], keys = Object.keys(w);
    for (var i = 0; i < P.count; i++) {
      var r = Math.random(), acc = 0, pick = keys[0];
      for (var k = 0; k < keys.length; k++) { acc += w[keys[k]]; if (r <= acc) { pick = keys[k]; break; } }
      q.push(pick);
    }
    if (n === 1) { q[0] = "mite"; q[1] = "mite"; q[2] = "mite"; q[3] = "skitter"; }
    // a creature's first depth: put one early so it arrives while the well is quiet
    Object.keys(INTRO).forEach(function (kind) {
      if (INTRO[kind][0] !== n) return;
      var at = q.indexOf(kind);
      if (at >= 0 && at <= 3) return;
      if (at > 3) q.splice(at, 1);
      q.splice(2, 0, kind);
    });
    return q;
  }

  function spawn(kind, lane, d) {
    var sp = G.prm ? G.prm.speed : 1;
    var e = {
      kind: kind, lane: lane, d: d === undefined ? 1 : d, t: 0, grow: d === undefined ? 0 : 1,
      v: 0, hop: null, tele: 0, hopIn: rnd(1.1, 2.4) / Math.sqrt(sp), rim: false, stepIn: 0, bite: 0,
      stopD: 0, spitIn: 0, charge: 0, ws: "up", wTarget: 0, waitT: 0, doom: -1, dead: false, flee: false,
      seed: Math.random() * 100, label: 0
    };
    if (kind === "mite") e.v = 0.14 * sp * rnd(0.9, 1.1);
    else if (kind === "skitter") e.v = 0.12 * sp * rnd(0.9, 1.1);
    else if (kind === "brood") e.v = 0.075 * sp * rnd(0.9, 1.1);
    else if (kind === "spitter") { e.v = 0.17 * sp; e.stopD = rnd(0.42, 0.7); e.spitIn = rnd(1.4, 2.2); }
    else if (kind === "weaver") { e.v = 0.32 * sp; e.wTarget = rnd(Math.max(0.2, 0.46 - G.depth * 0.02), 0.6); }
    if (INTRO[kind] && !G.seen[kind] && G.phase === "play") { G.seen[kind] = true; e.label = 2.6; }
    G.enemies.push(e);
    return e;
  }

  function pickSpawnLane() {
    var N = G.sh.N, l, tries = 0;
    do { l = Math.floor(Math.random() * N); tries++; } while ((l === G.lastSpawn) && tries < 6);
    G.lastSpawn = l;
    return l;
  }

  function alive(kind) {
    var n = 0;
    for (var i = 0; i < G.enemies.length; i++) if (!G.enemies[i].dead && G.enemies[i].kind === kind) n++;
    return n;
  }

  function trySpawn(dt) {
    if (!G.queue.length) return;
    G.spawnIn -= dt;
    if (G.spawnIn > 0) return;
    var kind = G.queue[0];
    // cap the ones that stack pressure without moving
    if ((kind === "spitter" && alive("spitter") >= 3) || (kind === "weaver" && alive("weaver") >= 2)) {
      G.queue.push(G.queue.shift());
      G.spawnIn = 0.3;
      return;
    }
    G.queue.shift();
    spawn(kind, pickSpawnLane());
    // now and then two at once, for rhythm
    if (G.queue.length && G.depth > 1 && Math.random() < 0.22 && G.queue[0] !== "weaver") {
      spawn(G.queue.shift(), pickSpawnLane());
    }
    G.spawnIn = G.prm.interval * rnd(0.7, 1.3);
  }

  /* --------------------------------------------------------- creatures */

  function collideLane(e) {
    if (e.hop) return wrapLane(e.lane + (e.hop.t > e.hop.dur * 0.5 ? e.hop.dir : 0));
    return e.lane;
  }
  function visLane(e) {
    if (!e.hop) return e.lane;
    return e.lane + e.hop.dir * ease(e.hop.t / e.hop.dur);
  }

  function startHop(e, dir, dur) {
    if (!laneValid(e.lane + dir)) dir = -dir;
    if (!laneValid(e.lane + dir)) return;
    e.hop = { dir: dir, t: 0, dur: dur };
  }

  function updateEnemy(e, dt) {
    var sp = G.prm.speed;
    e.t += dt;
    if (e.grow < 1) e.grow = Math.min(1, e.grow + dt * 2.5);
    if (e.label > 0) e.label -= dt;
    if (e.doom >= 0) {
      e.doom -= dt;
      if (e.doom < 0) kill(e, "flare");
      return;
    }
    if (e.hop) {
      e.hop.t += dt;
      if (e.hop.t >= e.hop.dur) { e.lane = wrapLane(e.lane + e.hop.dir); e.hop = null; }
    }

    if (e.rim) { updateCrawler(e, dt); return; }

    if (e.kind === "weaver") {
      if (e.flee) { e.d += dt * 0.9; if (e.d >= 1) e.dead = true; return; }
      if (e.ws === "up") {
        e.d -= e.v * dt;
        G.silk[e.lane] = Math.min(G.silk[e.lane], e.d + 0.012);
        if (e.d <= e.wTarget) e.ws = "down";
      } else if (e.ws === "down") {
        e.d += e.v * 0.62 * dt;
        if (e.d >= 0.98) { e.d = 0.98; e.ws = "wait"; e.waitT = rnd(0.8, 1.8) / sp; }
      } else {
        e.waitT -= dt;
        if (e.waitT <= 0) {
          e.lane = pickSpawnLane(); e.ws = "up"; e.grow = 0.3;
          e.wTarget = rnd(Math.max(0.18, 0.46 - G.depth * 0.02), 0.6);
        }
      }
      return;
    }

    if (e.kind === "spitter") {
      if (e.d > e.stopD) { e.d = Math.max(e.stopD, e.d - e.v * dt); return; }
      e.spitIn -= dt;
      e.charge = clamp(1 - e.spitIn / 0.6, 0, 1);
      if (e.spitIn <= 0) {
        G.globs.push({ lane: e.lane, d: e.d - 0.02, v: 0.5 * sp, t: 0 });
        AU.spit(panOf(e.lane));
        e.spitIn = rnd(2.3, 3.3) / Math.sqrt(sp);
        e.charge = 0;
      }
      return;
    }

    // climbers: mite, skitter, brood
    e.d -= e.v * dt;
    if (e.kind === "skitter" && !e.hop) {
      e.hopIn -= dt;
      if (e.hopIn < 0.4 && !e.tele) {
        // decide now, so the telegraph can show where it is going
        var toward = G.depth >= 3 && Math.random() < 0.5 ? Math.sign(laneDelta(e.lane, G.lane)) || 1 : (Math.random() < 0.5 ? -1 : 1);
        if (!laneValid(e.lane + toward)) toward = -toward;
        e.tele = toward;
      }
      if (e.hopIn <= 0) {
        startHop(e, e.tele || 1, 0.3);
        e.tele = 0;
        e.hopIn = rnd(1.1, 2.4) / Math.sqrt(sp);
      }
    }
    if (e.d <= 0) {
      e.d = 0;
      if (e.kind === "brood") { breakBrood(e, true); return; }
      e.rim = true; e.hop = null; e.tele = 0;
      e.stepIn = 0.35;
      AU.rimHop(panOf(e.lane));
      shake(0.25);
    }
  }

  /* On the rim everything crawls toward you, one lane at a time, and a short
   * telegraph shows which way before each step. In your lane it rears up for
   * BITE seconds: fire in that window and it dies point-blank, otherwise it
   * takes you. */
  function updateCrawler(e, dt) {
    var sp = G.prm.speed;
    if (G.phase !== "play") return;
    if (!e.hop && e.lane === G.lane && G.inv <= 0) {
      if (e.bite === 0) AU.bite(panOf(e.lane));
      e.bite += dt;
      if (e.bite >= BITE) grabbed(e);
      return;
    }
    e.bite = 0;
    if (e.hop) return;
    e.stepIn -= dt;
    var dir = Math.sign(laneDelta(e.lane, G.lane)) || 1;
    e.tele = e.stepIn < 0.2 ? dir : 0;
    if (e.stepIn <= 0) {
      startHop(e, dir, 0.16);
      e.tele = 0;
      e.stepIn = Math.max(0.34, (e.kind === "mite" ? 0.85 : 0.62) / sp);
      AU.rimHop(panOf(e.lane));
    }
  }

  function breakBrood(e, atRim) {
    e.dead = true;
    var l = e.lane, a = laneValid(l - 1) ? wrapLane(l - 1) : l, b = laneValid(l + 1) ? wrapLane(l + 1) : l;
    [[a, -1], [b, 1]].forEach(function (p) {
      var s = spawn("skitter", l, e.d);
      s.grow = 1;
      if (p[0] !== l) { s.hop = { dir: p[1], t: 0, dur: 0.24 }; }
      if (atRim) { s.rim = true; s.stepIn = 0.5; }
      s.hopIn = rnd(0.9, 1.6);
    });
    laneMid(l, e.d, P3);
    burst(P3.x, P3.y, COL.brood, 22, 240, 7);
    ripple(l, e.d, 1);
  }

  function kill(e, how) {
    if (e.dead) return;
    laneMid(visLane(e), e.d, P3);
    var x = P3.x, y = P3.y, w = rimW(e.d);
    var pan = clamp((x - W / 2) / (W / 2), -1, 1);
    if (e.kind === "brood" && how !== "flare") {
      breakBrood(e, false);
    } else {
      e.dead = true;
      burst(x, y, COL[e.kind], e.kind === "brood" ? 26 : 16, 120 + w * 3, Math.max(2.5, w * 0.1));
      ripple(e.lane, e.d, e.kind === "mite" ? 0.7 : 1);
    }
    if (how === "shot") onHit();
    var pts = PTS[e.kind] * (e.rim ? 2 : 1) * (how === "shot" ? mult() : 1);
    addScore(pts);
    popup(x, y - w * 0.4, (e.rim ? "point blank " : "") + "+" + pts, how === "shot" && mult() > 1 ? G.pal.glow : [1, 1, 1]);
    G.laneFlash[e.lane] = 1;
    G.kills++;
    AU.kill(e.kind, pan, Math.min(15, G.streak), e.kind === "brood");
    if (G.kills % 15 === 0 && G.phase === "play") {
      G.pearls.push({ lane: e.lane, d: Math.max(0.35, e.d), t: 0, gone: 0 });
    }
    if (e.rim) shake(0.35);
  }

  // a lane's width in px at depth d, near enough for sizing sprites
  function rimW(d) {
    return WELL.view.F / (WELL.CAMD + d * WELL.LEN - WELL.cam.z) * G.sh.laneW * WELL.k(d);
  }

  /* ------------------------------------------------------------- shots */

  function fire() {
    if (G.phase !== "play" && G.phase !== "dive" && G.phase !== "intro") return false;
    if (G.fireCd > 0) return false;
    var pierce = G.pierceT > 0;
    if (G.shots.length >= (pierce ? 9 : MAX_SHOTS)) return false;
    G.shots.push({ lane: G.lane, d: G.clawD, prev: G.clawD, pierce: pierce, hit: false, counted: G.phase === "play" });
    G.fireCd = pierce ? FIRE_CD * 0.7 : FIRE_CD;
    G.fired++;
    G.snap = 1;
    AU.shot(panOf(G.lane), pierce);
    // point-blank: a crawler already in your lane dies on the same frame
    updateShots(0);
    return true;
  }

  function updateShots(dt) {
    for (var i = G.shots.length - 1; i >= 0; i--) {
      var s = G.shots[i];
      s.prev = s.d;
      s.d += SHOT_SPD * dt;
      var lo = s.prev - HIT_R, hi = s.d + HIT_R, consumed = false;
      // gather everything in reach along the lane, nearest first
      var cands = [];
      for (var j = 0; j < G.enemies.length; j++) {
        var e = G.enemies[j];
        if (e.dead || e.doom >= 0 || collideLane(e) !== s.lane) continue;
        var reach = e.rim ? HIT_R * 1.4 : HIT_R + e.v * 0.02;
        if (e.d >= lo - reach && e.d <= hi) cands.push({ d: e.d, e: e });
      }
      for (j = 0; j < G.globs.length; j++) {
        var g = G.globs[j];
        if (g.lane === s.lane && !g.dead && g.d >= lo - 0.02 && g.d <= hi) cands.push({ d: g.d, g: g });
      }
      var tip = G.silk[s.lane];
      if (tip < 1 && tip <= hi && tip >= lo - 0.05) cands.push({ d: tip, silk: true });
      cands.sort(function (a, b) { return a.d - b.d; });
      for (j = 0; j < cands.length && !consumed; j++) {
        var c = cands[j];
        s.hit = true;
        if (c.e) {
          kill(c.e, "shot");
          if (!s.pierce) consumed = true;
        } else if (c.g) {
          c.g.dead = true;
          onHit();
          var pts = PTS.glob * mult();
          addScore(pts);
          laneMid(s.lane, c.g.d, P3);
          burst(P3.x, P3.y, COL.glob, 10, 140, 3);
          popup(P3.x, P3.y, "+" + pts, [1, 1, 1]);
          AU.pop(panOf(s.lane));
          if (!s.pierce) consumed = true;
        } else if (c.silk) {
          chipSilk(s.lane, s.pierce ? 0.2 : 0.075);
          if (!s.pierce || G.silk[s.lane] < 1) consumed = true;
        }
      }
      if (consumed) { G.shots.splice(i, 1); continue; }
      if (s.d >= 1) {
        if (!s.hit && s.counted && G.phase === "play") onMiss();
        G.shots.splice(i, 1);
      }
    }
  }

  function chipSilk(l, amt) {
    var tip = G.silk[l];
    laneMid(l, tip, P3);
    G.silk[l] = tip + amt >= 0.97 ? 1 : tip + amt;
    onHit();
    var pts = PTS.silk * mult();
    addScore(pts);
    burst(P3.x, P3.y, COL.weaver, 6, 90, 2);
    AU.chip(panOf(l));
  }

  /* ------------------------------------------------------------- flare */

  function flare() {
    if (G.phase !== "play" || G.flareUses >= 2) return;
    G.flareUses++;
    var weak = G.flareUses === 2;
    AU.flare(weak);
    G.flareFx = weak ? 0.45 : 1;
    shake(weak ? 0.3 : 0.7);
    var live = G.enemies.filter(function (e) { return !e.dead && e.doom < 0; });
    live.sort(function (a, b) { return a.d - b.d; });
    if (weak) {
      // a second flare only reaches the nearest one
      if (live.length) live[0].doom = 0.12;
      G.globs.forEach(function (g) { if (g.d < 0.35) g.dead = true; });
    } else {
      live.forEach(function (e, i) { e.doom = 0.08 + i * Math.min(0.06, 0.5 / live.length); });
      G.globs.forEach(function (g) { g.dead = true; });
    }
    updateFlareBtn();
    gtagSafe("flare", { toy: "maw", depth: G.depth, weak: weak });
  }

  function updateFlareBtn() {
    var b = el.flare;
    b.classList.toggle("is-weak", G.flareUses === 1);
    b.classList.toggle("is-spent", G.flareUses >= 2);
    el.flareLabel.textContent = G.flareUses === 0 ? "Flare" : G.flareUses === 1 ? "Weak" : "Spent";
  }

  /* ----------------------------------------------------- life and death */

  function grabbed(e) {
    if (G.phase !== "play") return;
    G.grabber = e;
    die("Taken at the rim");
  }

  function die(cause) {
    G.phase = "dying"; G.phaseT = 0; G.cause = cause;
    G.lives--;
    G.streak = 0;
    bumpClass(el.lives, "is-struck");
    AU.grab(panOf(G.lane));
    shake(1);
    G.hurt = 1;
    laneMid(G.lane, G.clawD, P3);
    burst(P3.x, P3.y, COL.me, 30, 260, 5);
    ripple(G.lane, G.clawD, 1.4);
    callout(cause, G.lives > 0 ? G.lives + (G.lives === 1 ? " life" : " lives") + " left" : "", true, 1500);
    gtagSafe("life_lost", { toy: "maw", depth: G.depth, cause: cause });
  }

  function afterDeath() {
    if (G.lives <= 0) { gameOver(); return; }
    var wasDive = G.diving;
    G.diving = false;
    if (wasDive) { nextLevel(); return; }
    // everything in the well retreats into the dark and comes again
    G.enemies.forEach(function (e) {
      if (!e.dead && e.kind !== "weaver") G.queue.unshift(e.kind);
    });
    G.enemies = G.enemies.filter(function (e) { return !e.dead && e.kind === "weaver"; });
    G.globs = []; G.shots = []; G.pearls = [];
    G.grabber = null;
    G.phase = "play"; G.phaseT = 0;
    G.inv = 1.4;
    G.spawnIn = 1.1;
    G.clawD = 0;
  }

  /* -------------------------------------------------------------- flow */

  function startRun() {
    G.depth = 1; G.score = 0; G.lives = 3; G.streak = 0; G.maxMult = 1;
    G.kills = 0; G.fired = 0; G.hits = 0; G.nextLife = 20000; G.beaten = false;
    G.seen = {};
    G.parts = []; G.pops = [];
    beginLevel(1);
    G.whiteout = 0.55;
    el.hud.hidden = false;
    el.flare.hidden = false;
    AU.startBed();
    gtagSafe("run_start", { toy: "maw" });
  }

  function beginLevel(n) {
    G.depth = n;
    setWell(n);
    G.prm = params(n);
    G.queue = buildQueue(n);
    G.enemies = []; G.shots = []; G.globs = []; G.pearls = [];
    G.spawnIn = 0.9;
    G.flareUses = 0; updateFlareBtn();
    G.clawD = 0; G.diving = false;
    G.phase = "intro"; G.phaseT = 0;
    G.deepest = Math.max(G.deepest, n);
    callout("Depth " + n, G.sh.name, false, 1500);
    var pans = [];
    for (var i = 0; i < Math.min(G.sh.N, 12); i++) pans.push(panOf(Math.round(i * G.sh.N / 12)));
    AU.levelIn(pans);
  }

  function startDive() {
    G.phase = "dive"; G.phaseT = 0; G.diving = true;
    G.enemies.forEach(function (e) { if (!e.dead) e.flee = true; });
    G.enemies = G.enemies.filter(function (e) { return !e.dead && e.kind === "weaver"; });
    G.pearls = [];
    var bonus = 300 * G.depth + (G.flareUses === 0 ? 1000 : 0);
    addScore(bonus);
    AU.cleared();
    AU.dive(DIVE_T);
    var silky = G.silk[G.lane] < 1;
    callout("Depth " + G.depth + " cleared",
      "+" + bonus.toLocaleString() + (G.flareUses === 0 ? " · flare kept" : "") + (silky ? " · silk below you" : ""),
      false, 1500);
    gtagSafe("level_clear", { toy: "maw", depth: G.depth, value: G.score });
  }

  function nextLevel() {
    AU.plunge();
    G.whiteout = 1;
    beginLevel(G.depth + 1);
  }

  function gameOver() {
    G.phase = "over"; G.phaseT = 0;
    G.grabber = null;
    AU.gameOver();
    AU.stopBed();
    el.flare.hidden = true;
    var pb = G.score > G.best;
    if (pb) { G.best = G.score; store(KEY_BEST, String(G.best)); }
    var deep = parseInt(store(KEY_DEEP) || "0", 10) || 0;
    if (G.depth > deep) store(KEY_DEEP, String(G.depth));

    var acc = G.fired ? Math.round(G.hits / G.fired * 100) : 0;
    var name = G.sh.name;
    window.OPT_SHARE_IMAGE = function () { return shareCanvas(); };
    window.OPT_SHARE_LINE = "Depth " + G.depth + " · " + G.score.toLocaleString() + " pts";
    window.OPT_SHARE_TEXT = "Swallowed at depth " + G.depth + " in Maw with " + G.score.toLocaleString() +
      " points. Beat it: " + challengeUrl();

    var chLine = "";
    if (G.challenge) {
      chLine = G.score > G.challenge.score
        ? "<br /><span class=\"win\">You beat the challenge by " + (G.score - G.challenge.score).toLocaleString() + ".</span>"
        : "<br /><span class=\"short\">" + (G.challenge.score - G.score).toLocaleString() + " short of the challenge.</span>";
    }
    showPanel(pb && G.score > 0 ? "New best" : "Swallowed",
      "Depth " + G.depth,
      "<span class=\"big\">" + G.score.toLocaleString() + "</span>" +
      "Taken in " + name + ".<br />" +
      "<span class=\"stat\">" + G.kills + "</span> kills · <span class=\"stat\">" + acc + "%</span> accuracy · best streak <span class=\"stat\">×" + G.maxMult + "</span>" +
      "<br />Best " + G.best.toLocaleString() + chLine,
      "Dive again", true);
    gtagSafe("run_end", { toy: "maw", value: G.score, depth: G.depth });
  }

  function challengeUrl() {
    return "https://onepagetoys.com/toys/maw/#beat=" + G.score + "-" + G.depth;
  }

  function showPanel(eyebrow, title, html, btn, withChallenge) {
    setTimeout(function () {
      el.ovEyebrow.textContent = eyebrow;
      el.ovTitle.textContent = title;
      el.ovText.innerHTML = html;
      el.ovBtn.textContent = btn;
      el.ovDemo.setAttribute("hidden", "");   // <svg> has no `hidden` IDL property
      el.chBtn.hidden = !withChallenge || G.score <= 0;
      el.chBtn.textContent = "Challenge a friend";
      el.overlay.hidden = false;
      el.overlay.classList.remove("is-out");
      el.hud.hidden = true;
    }, reduceMotion ? 300 : 1300);
  }

  /* ------------------------------------------------------------ update */

  function update(dt) {
    G.clock += dt;
    G.phaseT += dt;
    G.fireCd = Math.max(0, G.fireCd - dt);
    G.snap = Math.max(0, G.snap - dt * 7);
    G.hurt = Math.max(0, G.hurt - dt * 1.4);
    G.whiteout = Math.max(0, G.whiteout - dt * 1.6);
    G.flareFx = Math.max(0, G.flareFx - dt * 1.1);
    if (G.inv > 0) G.inv -= dt;
    if (G.pierceT > 0) G.pierceT -= dt;
    for (var l = 0; l < 16; l++) G.laneFlash[l] = Math.max(0, G.laneFlash[l] - dt * 3.5);

    var active = G.phase === "play" || G.phase === "intro" || G.phase === "dive";
    if (active) updateInput(dt);
    if (G.phase === "attract") updateDemo(dt);

    if (G.phase === "intro") {
      G.fade = ease(G.phaseT / 0.7);
      if (G.phaseT >= 1.0) { G.phase = "play"; G.phaseT = 0; }
    } else if (G.phase === "over") {
      G.fade = Math.max(0.45, G.fade - dt * 0.5);
    } else G.fade = 1;

    if (G.phase === "play") {
      trySpawn(dt);
      for (var i = 0; i < G.enemies.length; i++) updateEnemy(G.enemies[i], dt);
    } else if (G.phase === "dive") {
      for (i = 0; i < G.enemies.length; i++) updateEnemy(G.enemies[i], dt);
    }

    if (G.phase === "play" || G.phase === "dive" || G.phase === "intro") updateShots(dt);

    if (G.phase === "play") {
      updateGlobs(dt);
      updatePearls(dt);
    }
    G.enemies = G.enemies.filter(function (e) { return !e.dead; });
    G.globs = G.globs.filter(function (g) { return !g.dead; });

    if (G.phase === "play" && !G.queue.length && !G.globs.length &&
        !G.enemies.some(function (e) { return e.kind !== "weaver"; })) {
      startDive();
    }

    if (G.phase === "dive") {
      var p = clamp(G.phaseT / DIVE_T, 0, 1);
      G.clawD = Math.min(0.985, Math.pow(p, 2.1) * 1.02);
      if (G.silk[G.lane] < 1 && G.clawD >= G.silk[G.lane] - 0.01) {
        G.enemies = [];
        die("Snared in silk");
      } else if (p >= 1) {
        G.diving = false;
        nextLevel();
      }
    }

    if (G.phase === "dying") {
      if (G.grabber) {
        // it drags you down the lane
        G.clawD = Math.min(0.5, G.clawD + dt * 0.28);
        G.grabber.d = G.clawD;
        G.grabber.lane = G.lane; G.grabber.hop = null;
      }
      if (G.phaseT >= DIE_T) afterDeath();
    }

    updateHeat(dt);
    updateBeat(dt);
    updateFx(dt);
    AU.tickBed(G.pressure);
    updateHud();
  }

  function updateGlobs(dt) {
    for (var i = 0; i < G.globs.length; i++) {
      var g = G.globs[i];
      g.t += dt;
      g.d -= g.v * dt;
      if (g.d <= 0) {
        g.dead = true;
        laneMid(g.lane, 0, P3);
        burst(P3.x, P3.y, COL.glob, 14, 160, 4);
        if (g.lane === G.lane && G.inv <= 0) { die("Spat on"); return; }
      }
    }
  }

  function updatePearls(dt) {
    for (var i = G.pearls.length - 1; i >= 0; i--) {
      var p = G.pearls[i];
      p.t += dt;
      if (p.gone > 0) { p.gone -= dt; if (p.gone <= 0) G.pearls.splice(i, 1); continue; }
      p.d -= 0.33 * dt;
      if (p.d <= 0) {
        p.d = 0;
        if (p.lane === G.lane) {
          G.pierceT = 9;
          AU.pearl(panOf(p.lane));
          laneMid(p.lane, 0, P3);
          burst(P3.x, P3.y, COL.pearl, 26, 220, 4);
          callout("Piercing light", "shots go through everything · 9s", false, 1300);
          G.pearls.splice(i, 1);
        } else p.gone = 0.5;
      }
    }
  }

  // how close is danger, lane by lane — drives the rim glow, the wall tint,
  // the chitter and the heartbeat
  function updateHeat(dt) {
    var target = [], i, near = 1, nearLane = -1;
    for (i = 0; i < 16; i++) target[i] = 0;
    if (G.phase === "play") {
      G.enemies.forEach(function (e) {
        if (e.dead || e.kind === "weaver") return;
        var l = collideLane(e), h = e.rim ? 1 : Math.pow(1 - e.d, 2.2);
        if (e.kind === "spitter") h = Math.max(h * 0.5, e.charge * 0.7);
        if (h > target[l]) target[l] = h;
        if (!e.rim && e.kind !== "spitter" && e.d < near) { near = e.d; nearLane = l; }
      });
      G.globs.forEach(function (g) {
        var h = Math.pow(1 - g.d, 2);
        if (h > target[g.lane]) target[g.lane] = h;
        if (g.d < near) { near = g.d; nearLane = g.lane; }
      });
    }
    var mx = 0;
    for (i = 0; i < 16; i++) {
      G.heat[i] += (target[i] - G.heat[i]) * Math.min(1, dt * 8);
      if (G.heat[i] > mx) mx = G.heat[i];
    }
    G.pressure += (mx - G.pressure) * Math.min(1, dt * 2);
    // the chitter: faster and higher the nearer the nearest climber is
    if (nearLane >= 0 && near < 0.55) {
      var close = 1 - near / 0.55;
      G.chitterPh += dt * (3 + close * 22);
      if (G.chitterPh >= 1) { G.chitterPh = 0; AU.chitter(panOf(nearLane), close); }
    }
  }

  function updateBeat(dt) {
    var alive = G.phase !== "over";
    G.bpm = alive ? Math.min(150, 58 + G.depth * 3 + G.pressure * 46) : 0;
    if (!alive) { G.beat = Math.max(0, G.beat - dt * 2); return; }
    var ph0 = G.beatPh;
    G.beatPh += dt * G.bpm / 60;
    var f0 = ph0 % 1, f1 = G.beatPh % 1;
    var sounding = G.phase === "play" || G.phase === "intro" || G.phase === "dive" || G.phase === "dying";
    if (Math.floor(G.beatPh) > Math.floor(ph0) && sounding) AU.heart(false, 0.2 + G.pressure * 0.12);
    if (f0 < 0.3 && f1 >= 0.3 && sounding) AU.heart(true, 0.14 + G.pressure * 0.08);
    var lub = Math.exp(-f1 * 9), dub = f1 >= 0.3 ? 0.6 * Math.exp(-(f1 - 0.3) * 9) : 0;
    G.beat = Math.max(lub, dub);
  }

  function updateFx(dt) {
    var damp = Math.pow(0.08, dt);
    for (var i = G.parts.length - 1; i >= 0; i--) {
      var p = G.parts[i];
      p.life += dt;
      if (p.life >= p.max) { G.parts.splice(i, 1); continue; }
      p.vx *= damp; p.vy *= damp;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
    for (i = G.pops.length - 1; i >= 0; i--) {
      G.pops[i].life += dt;
      G.pops[i].y -= dt * 26;
      if (G.pops[i].life > 0.9) G.pops.splice(i, 1);
    }
    G.shake *= Math.pow(0.015, dt);
    if (G.shake < 0.01) G.shake = 0;
    G.ripples = G.ripples.filter(function (r) { return G.clock - r.t0 < 2.2; });
  }

  /* ------------------------------------------------------------- demo */

  // behind the intro panel the well is alive: larvae climb, and something on
  // the rim picks them off
  function updateDemo(dt) {
    var D = G.demo;
    if (!G.prm) G.prm = params(1);
    D.spawn -= dt;
    if (D.spawn <= 0 && G.enemies.length < 5) { D.spawn = rnd(0.9, 1.8); spawn(Math.random() < 0.7 ? "mite" : "skitter", pickSpawnLane()); }
    G.enemies.forEach(function (e) {
      e.t += dt;
      if (e.grow < 1) e.grow = Math.min(1, e.grow + dt * 2.5);
      e.d -= e.v * dt;
      if (e.d < 0.05) { e.dead = true; laneMid(e.lane, 0.05, P3); burst(P3.x, P3.y, COL[e.kind], 8, 80, 3); }
    });
    // the demo claw tracks the nearest climber and fires when lined up
    var tgt = null;
    G.enemies.forEach(function (e) { if (!e.dead && e.d < 0.8 && (!tgt || e.d < tgt.d)) tgt = e; });
    D.t -= dt;
    if (tgt && D.t <= 0) {
      var dl = laneDelta(G.lane, tgt.lane);
      if (dl !== 0) { G.lane = wrapLane(G.lane + Math.sign(dl)); D.t = 0.12; }
      else if (!G.shots.length) {
        G.shots.push({ lane: G.lane, d: 0, prev: 0, pierce: false, hit: false, counted: false });
        G.snap = 1; D.t = 0.5;
      }
    }
    for (var i = G.shots.length - 1; i >= 0; i--) {
      var s = G.shots[i];
      s.d += SHOT_SPD * dt;
      for (var j = 0; j < G.enemies.length; j++) {
        var e = G.enemies[j];
        if (!e.dead && e.lane === s.lane && Math.abs(e.d - s.d) < 0.06) {
          e.dead = true; s.d = 2;
          laneMid(e.lane, e.d, P3);
          burst(P3.x, P3.y, COL[e.kind], 14, 150, 4);
          ripple(e.lane, e.d, 0.8);
          G.laneFlash[e.lane] = 1;
        }
      }
      if (s.d >= 1) G.shots.splice(i, 1);
    }
    visTrack(dt);
  }

  /* ------------------------------------------------------------- input */

  function stepLane(dir) {
    var n = G.lane + dir;
    if (!laneValid(n)) return false;
    G.lane = wrapLane(n);
    return true;
  }

  function visTrack(dt) {
    var d = laneDelta(G.vis, G.lane);
    if (!G.sh.closed) d = G.lane - G.vis;
    G.vis += d * (1 - Math.exp(-dt * 34));
    if (G.sh.closed) G.vis = ((G.vis % G.sh.N) + G.sh.N) % G.sh.N;
  }

  function updateInput(dt) {
    var canMove = G.phase !== "dying";
    // mouse: travel toward the lane under the pointer, one lane at a time
    if (canMove && inp.mouseTarget !== null && inp.mouseTarget !== G.lane) {
      inp.stepT -= dt;
      while (inp.stepT <= 0 && inp.mouseTarget !== G.lane) {
        var dl = G.sh.closed ? laneDelta(G.lane, inp.mouseTarget) : inp.mouseTarget - G.lane;
        if (!stepLane(Math.sign(dl))) break;
        inp.stepT += LANE_STEP;
      }
    } else inp.stepT = 0;
    // keys: first step at once, then repeat
    if (canMove && inp.keyDir) {
      inp.keyT -= dt;
      if (inp.keyT <= 0) { stepLane(inp.keyLaneDir); inp.keyT += 0.075; }
    }
    /* Hold to repeat. On touch the finger is also what steers, so a held finger
     * fires only when something is actually in your lane: you can slide and
     * shoot in one gesture, and it never sprays misses into empty lanes (misses
     * cost streak). Mouse and keys repeat unconditionally. */
    inp.recent *= Math.pow(0.001, dt);
    if (inp.fireHeld || inp.keyFire) {
      inp.holdT += dt;
      if (inp.holdType === "touch") {
        if (inp.holdT >= 0.12 && laneHasTarget() && fire()) inp.holdT = 0.12 - HOLD_RATE;
      } else if (inp.holdT >= HOLD_DELAY) {
        if (fire()) inp.holdT = HOLD_DELAY - HOLD_RATE;
      }
    }
    // a resting thumb should not leave half a lane banked for the next twitch
    if (inp.moveId !== null && performance.now() - inp.lastMove > 140) inp.acc *= Math.pow(0.02, dt);
    visTrack(dt);
  }

  function laneHasTarget() {
    var l = G.lane, from = G.clawD - 0.02, i;
    for (i = 0; i < G.enemies.length; i++) {
      var e = G.enemies[i];
      if (!e.dead && e.doom < 0 && !e.flee && collideLane(e) === l && e.d >= from) return true;
    }
    for (i = 0; i < G.globs.length; i++) if (!G.globs[i].dead && G.globs[i].lane === l) return true;
    return G.silk[l] < 1 && G.silk[l] >= from;
  }

  function pickLane(x, y) {
    var sh = G.sh, best = -1, bd = 1e9, i;
    if (sh.closed) {
      // by angle around the well's centre, so the pointer does not have to be ON the rim
      var cx = 0, cy = 0;
      for (i = 0; i < sh.N; i++) { laneMid(i, 0, P3); cx += P3.x; cy += P3.y; }
      cx /= sh.N; cy /= sh.N;
      var a = Math.atan2(y - cy, x - cx);
      for (i = 0; i < sh.N; i++) {
        laneMid(i, 0, P3);
        var da = Math.abs(Math.atan2(P3.y - cy, P3.x - cx) - a);
        if (da > Math.PI) da = TAU - da;
        if (i === inp.mouseTarget) da -= 0.03;       // a little hysteresis at the boundaries
        if (da < bd) { bd = da; best = i; }
      }
    } else {
      for (i = 0; i < sh.N; i++) {
        laneMid(i, 0, P3);
        var dd = Math.hypot(P3.x - x, P3.y - y) - (i === inp.mouseTarget ? 6 : 0);
        if (dd < bd) { bd = dd; best = i; }
      }
    }
    return best;
  }

  /* Touch: drag ANYWHERE and the creature follows your thumb along the rim.
   *
   * ⚠ The mapping is LOCKED for the whole stroke, from the rim's direction where
   * the stroke began. The first version re-read the tangent every move, so at
   * three and nine o'clock (where the rim runs vertically) a sideways thumb did
   * nothing at all and you stalled at the sides — owner, on a phone: "pretty
   * hard". Locked, a long leftward drag keeps pushing you round like a wheel,
   * over the top if you keep going, and each new stroke re-anchors to where you
   * are, so short corrections always move the way your thumb does. A stroke that
   * starts at a side keeps the last sideways habit and also answers up/down.
   * Measured in lane widths, with some acceleration for flicks. */
  function strokeMap() {
    var t = rimTangent(G.lane);
    var mx = Math.abs(t.x) >= 0.4 ? (t.x > 0 ? 1 : -1) : (inp.lastMx || (t.x >= 0 ? 1 : -1));
    if (Math.abs(t.x) >= 0.4) inp.lastMx = mx;
    var my = Math.abs(t.y) >= 0.4 ? (t.y > 0 ? 1 : -1) : 0;
    inp.map = { x: mx, y: my };
  }
  function dragBy(dx, dy, dtMs) {
    if (!inp.map) strokeMap();
    var w = rimTangent(G.lane).w;
    var along = dx * inp.map.x + dy * inp.map.y;
    var speed = Math.hypot(dx, dy) / Math.max(1, dtMs) * 1000;
    var gain = 1.5 + Math.min(0.9, speed / 1400);
    inp.acc += along / Math.max(24, w) * gain;
    var guard = 0;
    while (Math.abs(inp.acc) >= 1 && guard++ < 16) {
      var dir = inp.acc > 0 ? 1 : -1;
      if (!stepLane(dir)) { inp.acc = 0; break; }
      inp.acc -= dir;
    }
  }

  function playing() { return (G.phase === "play" || G.phase === "intro" || G.phase === "dive" || G.phase === "dying") && !G.paused; }

  canvas.addEventListener("pointerdown", function (ev) {
    AU.unlock();
    if (!playing()) return;
    ev.preventDefault();
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
    if (ev.pointerType === "mouse") {
      if (ev.button === 2) { flare(); return; }
      inp.mouseTarget = pickLane(ev.clientX, ev.clientY);
      inp.fireHeld = true; inp.holdT = 0; inp.holdType = "mouse";
      fire();
      return;
    }
    if (inp.moveId === null) {
      inp.moveId = ev.pointerId;
      inp.lx = ev.clientX; inp.ly = ev.clientY; inp.lt = ev.timeStamp; inp.acc = 0; inp.recent = 0;
      inp.fireHeld = true; inp.holdT = 0; inp.holdType = "touch";
      inp.map = null; inp.lastMove = performance.now();
    }
    fire();
    hideHint();
  });
  canvas.addEventListener("pointermove", function (ev) {
    if (!playing()) return;
    if (ev.pointerType === "mouse") {
      if (G.phase !== "dying") inp.mouseTarget = pickLane(ev.clientX, ev.clientY);
      return;
    }
    if (ev.pointerId !== inp.moveId) return;
    var dx = ev.clientX - inp.lx, dy = ev.clientY - inp.ly;
    inp.recent += Math.hypot(dx, dy);
    if (G.phase !== "dying") dragBy(dx, dy, ev.timeStamp - inp.lt);
    if (dx || dy) inp.lastMove = performance.now();
    inp.lx = ev.clientX; inp.ly = ev.clientY; inp.lt = ev.timeStamp;
  });
  function endPointer(ev) {
    if (ev.pointerType === "mouse") { inp.fireHeld = false; return; }
    if (ev.pointerId === inp.moveId) { inp.moveId = null; inp.fireHeld = false; }
  }
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("contextmenu", function (ev) { ev.preventDefault(); });

  el.flare.addEventListener("pointerdown", function (ev) {
    ev.preventDefault(); ev.stopPropagation();
    AU.unlock();
    flare();
  });
  el.flare.addEventListener("click", function (ev) {
    // keyboard activation (pointer already handled on pointerdown)
    if (ev.detail === 0) flare();
  });

  // which way along the lanes is "left" on screen right now
  function laneDirFor(vdir) {
    var a = laneValid(G.lane - 1), b = laneValid(G.lane + 1);
    if (!a) return 1; if (!b) return -1;
    laneMid(wrapLane(G.lane - 1), 0, P0); laneMid(wrapLane(G.lane + 1), 0, P1);
    var dx = P1.x - P0.x;
    if (Math.abs(dx) < 4) {
      // at the side of a ring: up/down is what the eye sees, so follow it
      return (P1.y - P0.y) * vdir < 0 ? 1 : -1;
    }
    return dx * vdir > 0 ? 1 : -1;
  }

  window.addEventListener("keydown", function (ev) {
    var k = ev.code;
    if (k === "KeyP" || k === "Escape") { if (G.paused) resume(); else if (playing()) pause(); return; }
    if (!playing()) return;
    if (k === "ArrowLeft" || k === "KeyA" || k === "ArrowRight" || k === "KeyD") {
      ev.preventDefault();
      var vd = (k === "ArrowLeft" || k === "KeyA") ? -1 : 1;
      if (inp.keyDir !== vd) {
        inp.keyDir = vd;
        inp.keyLaneDir = laneDirFor(vd);
        inp.mouseTarget = null;
        if (G.phase !== "dying") stepLane(inp.keyLaneDir);
        inp.keyT = 0.17;
      }
      hideHint();
    } else if (k === "Space") {
      ev.preventDefault();
      if (!ev.repeat) { AU.unlock(); inp.keyFire = true; inp.holdT = 0; inp.holdType = "key"; fire(); }
    } else if (k === "KeyF" || k === "ShiftLeft" || k === "ShiftRight" || k === "KeyE") {
      if (!ev.repeat) flare();
    }
  });
  window.addEventListener("keyup", function (ev) {
    var k = ev.code;
    if (k === "ArrowLeft" || k === "KeyA" || k === "ArrowRight" || k === "KeyD") {
      var vd = (k === "ArrowLeft" || k === "KeyA") ? -1 : 1;
      if (inp.keyDir === vd) inp.keyDir = 0;
    } else if (k === "Space") inp.keyFire = false;
  });

  function hideHint() { if (el.hint) el.hint.classList.add("is-gone"); }

  function pause() {
    if (G.paused) return;
    G.paused = true;
    AU.suspend();
    inp.fireHeld = false; inp.keyFire = false; inp.keyDir = 0;
    el.ovEyebrow.textContent = "Paused";
    el.ovTitle.textContent = "Depth " + G.depth;
    el.ovText.innerHTML = "The well waits.<br /><span class=\"stat\">" + G.score.toLocaleString() + "</span> points so far.";
    el.ovBtn.textContent = "Back to the rim";
    el.ovDemo.setAttribute("hidden", "");
    el.chBtn.hidden = true;
    el.overlay.hidden = false;
    el.overlay.classList.remove("is-out");
  }
  function resume() {
    G.paused = false;
    AU.resume();
    el.overlay.classList.add("is-out");
    setTimeout(function () { el.overlay.hidden = true; }, 260);
  }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && playing() && G.phase !== "dying") pause();
  });

  /* ------------------------------------------------------------ render */

  var snow = [];
  function seedSnow() {
    snow = [];
    for (var i = 0; i < 70; i++) snow.push({ x: Math.random(), y: Math.random(), z: Math.random(), ph: Math.random() * TAU });
  }

  function glState() {
    return {
      heat: G.heat, flash: G.laneFlash, player: (G.phase === "over" || G.phase === "attract") ? -10 : G.lane,
      t: G.clock, beat: G.beat, flare: G.flareFx, hurt: G.hurt, fade: G.fade,
      pal: G.pal, ripples: G.ripples
    };
  }

  function placeCamera(now) {
    var cam = WELL.cam, v = WELL.view, sh = G.sh;
    var lean = WELL.laneWorld(sh, G.vis, 0.5, 0);
    var sway = reduceMotion ? 0 : 1;
    var tx = lean.x * 0.07 + Math.sin(G.clock * 0.31) * 0.02 * sway;
    var ty = sh.camY + lean.y * 0.07 + Math.sin(G.clock * 0.23 + 1) * 0.015 * sway;
    cam.x += (tx - cam.x) * 0.08;
    cam.y += (ty - cam.y) * 0.08;
    if (G.phase === "dive" || (G.phase === "dying" && G.diving)) cam.z = G.clawD * WELL.LEN;
    else if (G.phase === "intro") cam.z = -1.3 * Math.pow(1 - ease(G.phaseT / INTRO_T * 1.5), 2);
    else cam.z = 0;
    var sk = G.shake * 9;
    v.F = v.baseF * (1 + G.beat * 0.005);
    v.ox = v.baseOx + (sk ? (Math.random() - 0.5) * sk : 0);
    v.oy = v.baseOy + (sk ? (Math.random() - 0.5) * sk : 0);
  }

  function render(now) {
    if (!G.sh) return;
    placeCamera(now);
    if (GL) GL.render(glState(), GLS);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!GL) drawMembrane2D();
    drawThroat();
    drawSilk();
    drawRibs();
    drawRim();
    drawEnemies();
    drawGlobs();
    drawPearls();
    drawShots();
    drawParts();
    if (G.phase !== "over") drawClaw();
    drawPops();
    drawSnow();
    drawFlashes();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  // the no-WebGL wall: banded quads, darker with depth
  function drawMembrane2D() {
    var sh = G.sh, pal = G.pal, bands = 10;
    for (var l = 0; l < sh.N; l++) {
      for (var b = 0; b < bands; b++) {
        var d0 = b / bands, d1 = (b + 1) / bands;
        if (!WELL.edgeAt(sh, l, d0, P0) || !WELL.edgeAt(sh, l + 1, d0, P1)) continue;
        WELL.edgeAt(sh, l + 1, d1, P2); WELL.edgeAt(sh, l, d1, P3);
        var f = Math.pow(1 - d0, 1.4) * (0.6 + 0.4 * Math.sin(l * 1.7 + b)) * G.fade;
        var c = mixc(pal.deep, pal.flesh, f);
        if (G.heat[l] > 0.05) c = mixc(c, pal.hot, G.heat[l] * (1 - d0) * 0.5);
        ctx.fillStyle = css(c, 1);
        ctx.beginPath(); ctx.moveTo(P0.x, P0.y); ctx.lineTo(P1.x, P1.y); ctx.lineTo(P2.x, P2.y); ctx.lineTo(P3.x, P3.y); ctx.closePath(); ctx.fill();
      }
    }
  }

  function dMin() {
    // the shallowest depth still in front of the camera (the dive passes the rim)
    return Math.max(0, (WELL.cam.z - WELL.CAMD + 0.12) / WELL.LEN);
  }

  function drawThroat() {
    var sh = G.sh, pal = G.pal, n = sh.closed ? sh.N : sh.N + 1, cx = 0, cy = 0, i, pts = [];
    for (i = 0; i < n; i++) { WELL.edgeAt(sh, i, 1, P0); pts.push(P0.x, P0.y); cx += P0.x; cy += P0.y; }
    cx /= n; cy /= n;
    var r = 0;
    for (i = 0; i < n; i++) r = Math.max(r, Math.hypot(pts[i * 2] - cx, pts[i * 2 + 1] - cy));
    var b = G.beat, f = G.fade;
    ctx.globalCompositeOperation = "source-over";
    if (sh.closed) {
      ctx.beginPath();
      for (i = 0; i < n; i++) i ? ctx.lineTo(pts[i * 2], pts[i * 2 + 1]) : ctx.moveTo(pts[0], pts[1]);
      ctx.closePath();
      var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, css(mixc(pal.glow, [1, 1, 1], 0.4), (0.55 + 0.35 * b) * f));
      g.addColorStop(0.18, css(pal.glow, (0.28 + 0.2 * b) * f));
      g.addColorStop(0.5, css(pal.deep, 0.96));
      g.addColorStop(1, css(mixc(pal.deep, pal.flesh, 0.5), 1));
      ctx.fillStyle = g; ctx.fill();
      // the sphincter folds, turning very slowly
      ctx.save(); ctx.clip();
      ctx.strokeStyle = css([0, 0, 0], 0.35); ctx.lineWidth = Math.max(1, r * 0.03);
      var folds = sh.N * 2;
      for (i = 0; i < folds; i++) {
        var a = i / folds * TAU + G.clock * 0.05, a2 = a + 0.22;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * r * 0.2, cy + Math.sin(a) * r * 0.2);
        ctx.quadraticCurveTo(cx + Math.cos(a + 0.12) * r * 0.62, cy + Math.sin(a + 0.12) * r * 0.62, cx + Math.cos(a2) * r * 1.05, cy + Math.sin(a2) * r * 1.05);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.globalCompositeOperation = "lighter";
    glowAt(pal.glow, cx, cy, r * (sh.closed ? 0.9 : 1.6) * (1 + b * 0.12), (0.35 + 0.25 * b) * f);
    ctx.strokeStyle = css(pal.glow, 0.45 * f); ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (i = 0; i < n; i++) i ? ctx.lineTo(pts[i * 2], pts[i * 2 + 1]) : ctx.moveTo(pts[0], pts[1]);
    if (sh.closed) ctx.closePath();
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  // intro: the ribs light one after another around the well
  function ribAlpha(e) {
    if (G.phase !== "intro") return 1;
    var n = G.sh.closed ? G.sh.N : G.sh.N + 1;
    return clamp((G.phaseT * 1.6 - e / n * 0.8) * 3, 0, 1);
  }

  var RIB_W = 0.017;
  function drawRibs() {
    var sh = G.sh, pal = G.pal, n = sh.closed ? sh.N : sh.N + 1, d0 = dMin(), t = G.clock, f = G.fade;
    for (var e = 0; e < n; e++) {
      var ra = ribAlpha(e) * f;
      if (ra <= 0) continue;
      if (!WELL.edgeAt(sh, e, d0, P0)) continue;
      WELL.edgeAt(sh, e, 1, P1);
      var dx = P1.x - P0.x, dy = P1.y - P0.y, len = Math.hypot(dx, dy) || 1;
      var nx = -dy / len, ny = dx / len;
      var w0 = Math.max(1.2, RIB_W * P0.s * WELL.k(d0)), w1 = Math.max(0.6, RIB_W * P1.s * WELL.k(1));
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = ra;
      // a ridge of sinew: dark body, a lit edge where the headlamp catches it
      var g = ctx.createLinearGradient(P0.x, P0.y, P1.x, P1.y);
      g.addColorStop(0, css(mixc(pal.flesh, pal.glow, 0.25), 1));
      g.addColorStop(0.3, css(mixc(pal.deep, pal.flesh, 0.7), 0.95));
      g.addColorStop(1, css(pal.deep, 0.5));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(P0.x + nx * w0, P0.y + ny * w0);
      ctx.lineTo(P1.x + nx * w1, P1.y + ny * w1);
      ctx.lineTo(P1.x - nx * w1, P1.y - ny * w1);
      ctx.lineTo(P0.x - nx * w0, P0.y - ny * w0);
      ctx.closePath(); ctx.fill();
      var hl = ctx.createLinearGradient(P0.x, P0.y, P1.x, P1.y);
      hl.addColorStop(0, css(mixc(pal.glow, [1, 1, 1], 0.4), 0.7));
      hl.addColorStop(0.5, css(pal.glow, 0.15));
      hl.addColorStop(1, css(pal.glow, 0));
      ctx.strokeStyle = hl;
      ctx.lineWidth = Math.max(0.7, w0 * 0.4);
      ctx.beginPath(); ctx.moveTo(P0.x + nx * w0 * 0.45, P0.y + ny * w0 * 0.45); ctx.lineTo(P1.x, P1.y); ctx.stroke();
      // comb-jelly shimmer: waves of iridescent light running down each rib
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      for (var k = 0; k < 7; k++) {
        var dk = ((k + t * 0.55 + e * 0.29) % 7) / 7;
        if (dk < d0) continue;
        if (!WELL.edgeAt(sh, e, dk, P2)) continue;
        WELL.edgeAt(sh, e, Math.min(1, dk + 0.045), P3);
        var hue = (dk * 220 + t * 40 + e * 22) % 360;
        var wave = Math.pow(0.5 + 0.5 * Math.sin(t * 3.2 - dk * 9 + e * 0.8), 2);
        ctx.strokeStyle = "hsla(" + hue.toFixed(0) + ",100%,72%," + (wave * Math.pow(1 - dk, 1.3) * 0.75 * ra).toFixed(3) + ")";
        ctx.lineWidth = Math.max(1, RIB_W * P2.s * 0.8);
        ctx.beginPath(); ctx.moveTo(P2.x, P2.y); ctx.lineTo(P3.x, P3.y); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  function drawRim() {
    var sh = G.sh, pal = G.pal, d = dMin();
    if (d > 0.02) return;
    var n = sh.closed ? sh.N : sh.N + 1, i, f = G.fade;
    var lip = mixc(pal.flesh, [1, 0.8, 0.85], 0.12);
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.beginPath();
    for (i = 0; i < n; i++) { WELL.edgeAt(sh, i, 0, P0); i ? ctx.lineTo(P0.x, P0.y) : ctx.moveTo(P0.x, P0.y); }
    if (sh.closed) ctx.closePath();
    var s0 = P0.s;
    // a thick wet lip: shadow, flesh, then a highlight riding its crown
    ctx.strokeStyle = css([0, 0, 0], 0.5 * f); ctx.lineWidth = Math.max(7, s0 * 0.12); ctx.stroke();
    ctx.strokeStyle = css(mixc(lip, pal.deep, 0.3), f); ctx.lineWidth = Math.max(4, s0 * 0.07); ctx.stroke();
    ctx.strokeStyle = css(mixc(lip, [1, 0.9, 0.92], 0.18), 0.55 * f); ctx.lineWidth = Math.max(1.5, s0 * 0.028); ctx.stroke();
    drawFangs();
    ctx.globalCompositeOperation = "lighter";
    // pressure, lane by lane, right on the lip where your eye already is
    ctx.lineWidth = Math.max(3, s0 * 0.03);
    for (i = 0; i < sh.N; i++) {
      var h = G.heat[i];
      if (h < 0.04) continue;
      WELL.edgeAt(sh, i, 0, P0); WELL.edgeAt(sh, i + 1, 0, P1);
      ctx.strokeStyle = css(pal.hot, Math.min(1, h * 1.1));
      ctx.beginPath(); ctx.moveTo(P0.x, P0.y); ctx.lineTo(P1.x, P1.y); ctx.stroke();
      if (h > 0.5) glowAt(pal.hot, (P0.x + P1.x) / 2, (P0.y + P1.y) / 2, P0.s * 0.14 * h, (h - 0.4) * 0.8);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  /* A ring of fangs where each rib meets the lip, curving in toward the dark,
   * like the mouth of a lamprey. They sit ON the ribs, so they never cover a
   * lane. They flex a little with every heartbeat. */
  function drawFangs() {
    var sh = G.sh, n = sh.closed ? sh.N : sh.N + 1, f = G.fade, flex = G.beat * 0.012;
    for (var e = 0; e < n; e++) {
      var ra = ribAlpha(e) * f;
      if (ra <= 0) continue;
      if (!WELL.edgeAt(sh, e, 0, P0)) continue;
      WELL.edgeAt(sh, e, 0.032 + flex, P1);
      var dx = P1.x - P0.x, dy = P1.y - P0.y, len = Math.hypot(dx, dy) || 1;
      var nx = -dy / len, ny = dx / len, w = Math.max(1.8, P0.s * 0.021);
      var rx = P0.x - dx * 0.25, ry = P0.y - dy * 0.25;
      var hook = (e % 2 ? 1 : -1) * len * 0.16;
      var tx = P1.x + nx * hook, ty = P1.y + ny * hook;
      // shaded across its width, so it reads as a curved tooth and not a paper flag
      var g = ctx.createLinearGradient(rx + nx * w, ry + ny * w, rx - nx * w, ry - ny * w);
      g.addColorStop(0, "rgba(255,250,240," + ra + ")");
      g.addColorStop(0.55, "rgba(226,208,196," + ra + ")");
      g.addColorStop(1, "rgba(150,110,112," + ra + ")");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(rx + nx * w, ry + ny * w);
      ctx.quadraticCurveTo(P0.x + dx * 0.5 + nx * w * 0.8, P0.y + dy * 0.5 + ny * w * 0.8, tx, ty);
      ctx.quadraticCurveTo(P0.x + dx * 0.5 - nx * w * 0.4, P0.y + dy * 0.5 - ny * w * 0.4, rx - nx * w, ry - ny * w);
      ctx.closePath(); ctx.fill();
    }
  }

  function drawSilk() {
    var sh = G.sh, t = G.clock, d0 = dMin();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (var l = 0; l < sh.N; l++) {
      var tip = G.silk[l];
      if (tip >= 1) continue;
      var danger = (G.phase === "dive" && l === G.lane) ? 0.5 + 0.5 * Math.sin(t * 20) : 0;
      var col = danger ? mixc(COL.weaver, G.pal.hot, danger) : COL.weaver;
      var steps = 18, first = true;
      ctx.beginPath();
      for (var i = 0; i <= steps; i++) {
        var d = 1 - (1 - tip) * i / steps;
        if (d < d0) break;
        var u = 0.5 + Math.sin(d * 14 + t * 1.2 + l * 2) * 0.05;
        if (!WELL.laneAt(sh, l, u, d, P0)) continue;
        if (first) { ctx.moveTo(P0.x, P0.y); first = false; } else ctx.lineTo(P0.x, P0.y);
      }
      // sized from its nearest point, so a strand reaching up toward you reads as
      // a real obstacle and not a hairline — during a dive it is the thing that kills
      laneMid(l, Math.max(tip, d0), P1);
      var sw = Math.max(1.6, P1.s * 0.012) * (1 + danger * 0.8);
      ctx.strokeStyle = css(col, 0.2 + danger * 0.3); ctx.lineWidth = sw * 5; ctx.stroke();
      ctx.strokeStyle = css(col, 0.5 + danger * 0.3); ctx.lineWidth = sw * 2.2; ctx.stroke();
      ctx.strokeStyle = css(mixc(col, [1, 1, 1], 0.6), 0.95); ctx.lineWidth = sw; ctx.stroke();
      // dew beads on the thread
      for (var b = 0; b < 1; b += 0.09) {
        var bd = tip + b * (1 - tip);
        if (bd < d0) continue;
        WELL.laneAt(sh, l, 0.5 + Math.sin(bd * 14 + t * 1.2 + l * 2) * 0.05, bd, P0);
        glowAt(col, P0.x, P0.y, Math.max(2, P0.s * 0.018), 0.8);
      }
      if (tip >= d0 && laneMid(l, tip, P0)) glowAt(col, P0.x, P0.y, Math.max(4, P0.s * 0.05), 0.9);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  /* Every creature is drawn in its lane's own frame: x across the lane (one
   * unit = the lane's width there) and y up the wall toward the rim. The
   * projection skews that frame with depth, which is what makes them sit ON
   * the wall rather than float in front of it. */
  var FR = { x: 0, y: 0, w: 0, ax: 0, ay: 0, ux: 0, uy: 0 };
  function frameAt(l, d, lift) {
    var sh = G.sh;
    if (!WELL.laneAt(sh, l, 0, d, P0)) return false;
    WELL.laneAt(sh, l, 1, d, P1);
    var cx = (P0.x + P1.x) / 2, cy = (P0.y + P1.y) / 2;
    var ax = P1.x - P0.x, ay = P1.y - P0.y, w = Math.hypot(ax, ay) || 1;
    var dd = d > 0.03 ? d - 0.03 : d + 0.03;
    WELL.laneAt(sh, l, 0.5, dd, P2);
    var ux = P2.x - cx, uy = P2.y - cy, ul = Math.hypot(ux, uy) || 1;
    ux /= ul; uy /= ul;
    if (d <= 0.03) { ux = -ux; uy = -uy; }
    if (lift) {
      // lifting off the wall reads as moving toward the well's axis
      WELL.project(0, 0, d * WELL.LEN, P3);
      var ix = P3.x - cx, iy = P3.y - cy, il = Math.hypot(ix, iy) || 1;
      cx += ix / il * lift * w; cy += iy / il * lift * w;
    }
    FR.x = cx; FR.y = cy; FR.w = w; FR.ax = ax / w; FR.ay = ay / w; FR.ux = ux; FR.uy = uy;
    ctx.setTransform(DPR * ax, DPR * ay, DPR * ux * w, DPR * uy * w, DPR * cx, DPR * cy);
    return true;
  }
  function resetT() { ctx.setTransform(DPR, 0, 0, DPR, 0, 0); }

  function drawEnemies() {
    var list = G.enemies.slice().sort(function (a, b) { return b.d - a.d; });
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.dead) continue;
      var vl = visLane(e), hopLift = e.hop ? Math.sin(Math.PI * e.hop.t / e.hop.dur) * (e.rim ? 0.25 : 0.4) : 0;
      if (!frameAt(vl, e.d, hopLift)) continue;
      var sc = e.grow < 1 ? ease(e.grow) : 1;
      var fade = (e.flee ? Math.max(0, 1 - (e.d - 0.6) * 2.5) : 1) * G.fade;
      if (e.doom >= 0) fade *= 0.6 + 0.4 * Math.sin(G.clock * 60);
      // halo first, in screen space
      resetT();
      ctx.globalCompositeOperation = "lighter";
      var glowR = FR.w * (e.kind === "brood" ? 0.95 : 0.7) * sc;
      glowAt(COL[e.kind], FR.x, FR.y, glowR, 0.45 * fade * (0.8 + 0.2 * G.beat));
      if (e.rim && e.bite > 0) glowAt(G.pal.hot, FR.x, FR.y, FR.w * (1.2 + e.bite * 2), 0.8);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = fade;
      frameAt(vl, e.d, hopLift);
      sc *= 1.22;
      ctx.transform(sc, 0, 0, sc, 0, 0);
      var tilt = e.tele ? e.tele * 0.2 : 0;
      if (tilt) ctx.transform(1, 0, tilt, 1, 0, 0);
      if (e.kind === "mite") drawMite(e);
      else if (e.kind === "skitter") drawSkitter(e);
      else if (e.kind === "brood") drawBrood(e);
      else if (e.kind === "spitter") drawSpitter(e);
      else drawWeaver(e);
      resetT();
      ctx.globalAlpha = 1;
      if (e.tele && !e.hop) drawTelegraph(e);
      if (e.label > 0) drawLabel(e);
    }
    resetT();
  }

  // where a skitter is about to jump: a glowing arc into the next lane
  function drawTelegraph(e) {
    var to = wrapLane(e.lane + e.tele);
    if (!laneMid(e.lane, e.d, P0) || !laneMid(to, e.d, P1)) return;
    WELL.project(0, 0, e.d * WELL.LEN, P2);
    var mx = (P0.x + P1.x) / 2, my = (P0.y + P1.y) / 2;
    var ix = P2.x - mx, iy = P2.y - my, il = Math.hypot(ix, iy) || 1;
    var w = Math.hypot(P1.x - P0.x, P1.y - P0.y);
    var k = 0.5 + 0.5 * Math.sin(G.clock * 30);
    ctx.globalCompositeOperation = "lighter";
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = css(COL.skitter, 0.35 + 0.4 * k);
    ctx.lineWidth = Math.max(1.2, w * 0.05);
    ctx.beginPath();
    ctx.moveTo(P0.x, P0.y);
    ctx.quadraticCurveTo(mx + ix / il * w * 0.45, my + iy / il * w * 0.45, P1.x, P1.y);
    ctx.stroke();
    ctx.setLineDash([]);
    glowAt(COL.skitter, P1.x, P1.y, w * 0.35, 0.3 + 0.3 * k);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  function drawLabel(e) {
    var info = INTRO[e.kind];
    if (!info || !laneMid(visLane(e), e.d, P0)) return;
    var a = Math.min(1, e.label * 1.5, (2.6 - e.label) * 4);
    ctx.globalAlpha = a;
    ctx.font = "800 12px Archivo, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = css(COL[e.kind], 1);
    var y = P0.y - Math.max(18, rimW(e.d) * 0.6);
    ctx.fillText(info[1].toUpperCase(), P0.x, y - 12);
    ctx.font = "500 10px 'Geist Mono', ui-monospace, monospace";
    ctx.fillStyle = "rgba(234,252,255,0.85)";
    ctx.fillText(info[2], P0.x, y);
    ctx.globalAlpha = 1;
  }

  function blob(x, y, rx, ry, fill) {
    ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.001, rx), Math.max(0.001, ry), 0, 0, TAU);
    ctx.fillStyle = fill; ctx.fill();
  }
  function radial(x, y, r, stops) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(0.001, r));
    for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    return g;
  }

  // a glowing grub: soft segments that ripple as it climbs
  function drawMite(e) {
    var t = e.t * 7 + e.seed, c = COL.mite;
    for (var i = 3; i >= 0; i--) {
      var y = -0.2 + i * 0.12, x = Math.sin(t - i * 0.9) * 0.035, r = 0.13 - Math.abs(i - 1.5) * 0.018;
      blob(x, y, r * 1.15, r * 0.82, radial(x, y + 0.03, r * 1.2, [[0, "#fffdf6"], [0.55, css(c, 1)], [1, css(mixc(c, [0.9, 0.4, 0.3], 0.5), 1)]]));
    }
    ctx.fillStyle = "#2a0d10";
    ctx.beginPath(); ctx.arc(-0.045, 0.2, 0.018, 0, TAU); ctx.arc(0.045, 0.2, 0.018, 0, TAU); ctx.fill();
  }

  // the core threat: a hard coral carapace on six quick legs
  function drawSkitter(e) {
    var t = e.t * (e.rim ? 20 : 13) + e.seed, c = COL.skitter, tele = e.tele || 0;
    ctx.strokeStyle = css(mixc(c, [1, 1, 1], 0.2), 1);
    ctx.lineWidth = 0.035; ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (var s = -1; s <= 1; s += 2) {
      var reach = 1 + (tele === s ? 0.25 : 0);
      for (var k = 0; k < 3; k++) {
        var y = -0.1 + k * 0.1, ph = Math.sin(t + k * 2.1 + (s > 0 ? Math.PI : 0)) * 0.05;
        ctx.beginPath();
        ctx.moveTo(s * 0.14, y);
        ctx.lineTo(s * 0.3 * reach, y + 0.08 + ph);
        ctx.lineTo(s * 0.42 * reach, y - 0.02 + ph * 1.6);
        ctx.stroke();
      }
    }
    var open = e.rim && e.bite > 0 ? 0.08 + Math.sin(e.bite * 60) * 0.02 : 0.02;
    ctx.beginPath();
    ctx.moveTo(-0.05, 0.16); ctx.lineTo(-0.08 - open, 0.27); ctx.moveTo(0.05, 0.16); ctx.lineTo(0.08 + open, 0.27);
    ctx.stroke();
    blob(0, 0, 0.21, 0.19, radial(0, 0.05, 0.24, [[0, "#ffe2e4"], [0.35, css(c, 1)], [1, css(mixc(c, [0.25, 0, 0.1], 0.6), 1)]]));
    ctx.strokeStyle = css(mixc(c, [0.2, 0, 0.05], 0.6), 0.8); ctx.lineWidth = 0.02;
    ctx.beginPath(); ctx.moveTo(0, -0.17); ctx.lineTo(0, 0.12); ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(-0.065, 0.12, 0.03, 0, TAU); ctx.arc(0.065, 0.12, 0.03, 0, TAU); ctx.fill();
  }

  // a translucent egg sac; something moves inside
  function drawBrood(e) {
    var t = e.t + e.seed, c = COL.brood, p = 1 + Math.sin(t * 3.2) * 0.05;
    blob(0, 0, 0.32 * p, 0.28 * p, radial(0, 0.06, 0.34, [[0, "rgba(255,240,200,0.95)"], [0.5, css(c, 0.85)], [1, css(mixc(c, [0.5, 0.1, 0], 0.5), 0.9)]]));
    ctx.fillStyle = css([0.35, 0.12, 0.05], 0.55);
    for (var i = 0; i < 2; i++) {
      var a = t * 0.9 + i * Math.PI;
      blob(Math.cos(a) * 0.1, Math.sin(a) * 0.08, 0.075, 0.05, ctx.fillStyle);
    }
    ctx.strokeStyle = css([1, 0.85, 0.6], 0.5); ctx.lineWidth = 0.018;
    ctx.beginPath(); ctx.ellipse(0, 0, 0.32 * p, 0.28 * p, 0, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-0.2, -0.12); ctx.quadraticCurveTo(-0.05, 0, -0.12, 0.18); ctx.stroke();
  }

  // an urchin that roots halfway up and spits
  function drawSpitter(e) {
    var c = COL.spitter, ch = e.charge || 0, t = e.t + e.seed;
    ctx.strokeStyle = css(mixc(c, [1, 1, 1], 0.2), 0.95); ctx.lineWidth = 0.028; ctx.lineCap = "round";
    for (var i = 0; i < 14; i++) {
      var a = i / 14 * TAU + Math.sin(t * 2 + i) * 0.08, r1 = i % 2 ? 0.34 : 0.28;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * 0.17, Math.sin(a) * 0.17); ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); ctx.stroke();
    }
    blob(0, 0, 0.19, 0.19, radial(0, 0.03, 0.21, [[0, "#f8ffd8"], [0.45, css(c, 1)], [1, css(mixc(c, [0, 0.2, 0.05], 0.6), 1)]]));
    var m = 0.05 + ch * 0.06;
    blob(0, 0.07, m * 1.2, m, ch > 0.05 ? css(mixc([0.1, 0.2, 0], [1, 1, 0.8], ch), 1) : "#10200a");
  }

  // long-legged and pale; it spins the silk
  function drawWeaver(e) {
    var t = e.t * 9 + e.seed, c = COL.weaver;
    ctx.strokeStyle = css(c, 0.9); ctx.lineWidth = 0.02; ctx.lineCap = "round";
    for (var s = -1; s <= 1; s += 2) {
      for (var k = 0; k < 4; k++) {
        var y = -0.08 + k * 0.07, ph = Math.sin(t + k * 1.7 + (s > 0 ? 1.6 : 0)) * 0.06;
        ctx.beginPath();
        ctx.moveTo(s * 0.06, y);
        ctx.quadraticCurveTo(s * 0.3, y + 0.18 + ph, s * 0.5, y - 0.12 + ph);
        ctx.stroke();
      }
    }
    blob(0, -0.08, 0.12, 0.16, radial(0, -0.05, 0.18, [[0, "#fbf6ff"], [0.6, css(c, 1)], [1, css(mixc(c, [0.2, 0.05, 0.4], 0.6), 1)]]));
    blob(0, 0.1, 0.075, 0.07, css(mixc(c, [1, 1, 1], 0.3), 1));
    ctx.fillStyle = "#2a1044";
    ctx.beginPath(); ctx.arc(-0.03, 0.13, 0.015, 0, TAU); ctx.arc(0.03, 0.13, 0.015, 0, TAU); ctx.fill();
  }

  function drawGlobs() {
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < G.globs.length; i++) {
      var g = G.globs[i];
      if (!laneMid(g.lane, g.d, P0)) continue;
      var w = rimW(g.d), wob = 1 + Math.sin(g.t * 18) * 0.12;
      glowAt(COL.glob, P0.x, P0.y, w * 0.55, 0.7);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(240,255,200,0.95)";
      ctx.beginPath(); ctx.ellipse(P0.x, P0.y, w * 0.11 * wob, w * 0.11 / wob, 0, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  function drawPearls() {
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < G.pearls.length; i++) {
      var p = G.pearls[i];
      if (!laneMid(p.lane, p.d, P0)) continue;
      var w = rimW(p.d), a = p.gone > 0 ? p.gone * 2 : 1, tw = 0.7 + 0.3 * Math.sin(p.t * 9);
      glowAt(COL.pearl, P0.x, P0.y, w * 0.8 * tw, 0.8 * a);
      ctx.globalAlpha = a;
      ctx.strokeStyle = "rgba(255,250,235,0.8)"; ctx.lineWidth = 1;
      var r = w * 0.35 * tw;
      ctx.beginPath(); ctx.moveTo(P0.x - r, P0.y); ctx.lineTo(P0.x + r, P0.y); ctx.moveTo(P0.x, P0.y - r); ctx.lineTo(P0.x, P0.y + r); ctx.stroke();
      ctx.fillStyle = "#fffaf0";
      ctx.beginPath(); ctx.arc(P0.x, P0.y, Math.max(2, w * 0.08), 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  function drawShots() {
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (var i = 0; i < G.shots.length; i++) {
      var s = G.shots[i];
      var tail = Math.max(G.clawD, s.d - (s.pierce ? 0.16 : 0.07));
      if (!laneMid(s.lane, s.d, P0) || !laneMid(s.lane, tail, P1)) continue;
      var w = rimW(s.d), col = s.pierce ? [1, 0.92, 0.7] : COL.me;
      ctx.strokeStyle = css(col, 0.5);
      ctx.lineWidth = Math.max(1.5, w * (s.pierce ? 0.14 : 0.08));
      ctx.beginPath(); ctx.moveTo(P1.x, P1.y); ctx.lineTo(P0.x, P0.y); ctx.stroke();
      glowAt(s.pierce ? [1, 0.85, 0.5] : G.pal.glow, P0.x, P0.y, Math.max(6, w * 0.42), 0.9);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(P0.x, P0.y, Math.max(1.6, w * 0.06), 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  function drawParts() {
    ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < G.parts.length; i++) {
      var p = G.parts[i], k = 1 - p.life / p.max;
      if (p.kind === "glow") {
        glowAt(p.col, p.x, p.y, p.r * 2.4 * (0.5 + k * 0.5), k);
      } else {
        ctx.globalAlpha = k;
        ctx.fillStyle = css(mixc(p.col, [1, 1, 1], 0.3), 1);
        var s = p.r * 0.8, c = Math.cos(p.rot), sn = Math.sin(p.rot);
        ctx.beginPath();
        ctx.moveTo(p.x + c * s, p.y + sn * s);
        ctx.lineTo(p.x - sn * s * 0.5, p.y + c * s * 0.5);
        ctx.lineTo(p.x - c * s * 0.7, p.y - sn * s * 0.7);
        ctx.closePath(); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  /* You: a small luminous comb-jelly clinging to the lip, two soft mandibles
   * straddling the lane, rows of rainbow cilia shimmering along its body. */
  function drawClaw() {
    if (G.phase === "dying" && !G.grabber && G.phaseT > 0.2) return;
    var d = G.clawD, blink = G.inv > 0 ? (Math.sin(G.clock * 30) > 0 ? 1 : 0.35) : 1;
    if (G.phase === "dying") blink = 0.5 + 0.5 * Math.sin(G.clock * 40);
    var laneV = G.vis;
    if (!G.sh.closed) laneV = clamp(laneV, 0, G.sh.N - 1);
    if (!frameAt(laneV, d, 0)) return;
    var cx = FR.x, cy = FR.y, w = FR.w, t = G.clock, sn = G.snap, pierce = G.pierceT > 0;
    resetT();
    ctx.globalCompositeOperation = "lighter";
    // the body sits just outside the lip, in the frame's +y
    var bx = cx + FR.ux * w * 0.14, by = cy + FR.uy * w * 0.14;
    glowAt(pierce ? [1, 0.85, 0.55] : G.pal.glow, bx, by, w * (1.1 + sn * 0.35), (0.6 + sn * 0.4) * blink);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = blink;
    frameAt(laneV, d, 0);
    // mandibles: from the ribs, curling in over the lane; they snap on each shot.
    // Translucent light, not bone, so you never read as one of the fangs.
    var close = sn * 0.08, lit = pierce ? [1, 0.88, 0.6] : G.pal.glow;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (var s = -1; s <= 1; s += 2) {
      ctx.beginPath();
      ctx.moveTo(s * 0.5, 0.02);
      ctx.bezierCurveTo(s * 0.56, 0.2, s * 0.44, 0.36, s * 0.3, 0.3);
      ctx.bezierCurveTo(s * (0.22 - close), 0.25, s * (0.2 - close), 0.12, s * (0.26 - close), -0.04);
      ctx.bezierCurveTo(s * 0.34, 0.08, s * 0.4, 0.1, s * 0.5, 0.02);
      var g = ctx.createLinearGradient(s * 0.5, 0, s * 0.25, 0.3);
      g.addColorStop(0, css(lit, 0.35)); g.addColorStop(1, css(mixc(lit, [1, 1, 1], 0.6), 0.9));
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = css(mixc(lit, [1, 1, 1], 0.5), 0.95); ctx.lineWidth = 0.022; ctx.stroke();
    }
    // the body: a pearly lens
    blob(0, 0.2, 0.3, 0.12, radial(0, 0.2, 0.3, [[0, "#ffffff"], [0.4, css(mixc(lit, [1, 1, 1], 0.55), 0.95)], [1, css(lit, 0.35)]]));
    // cilia: tiny rainbow flickers running along the body
    for (var i = 0; i < 9; i++) {
      var u = -0.26 + i * 0.065, hue = (i * 38 + t * 220) % 360, a = 0.5 + 0.5 * Math.sin(t * 14 - i * 0.9);
      ctx.strokeStyle = "hsla(" + hue.toFixed(0) + ",100%,70%," + (a * 0.9).toFixed(2) + ")";
      ctx.lineWidth = 0.02;
      ctx.beginPath(); ctx.moveTo(u, 0.28 - Math.abs(u) * 0.25); ctx.lineTo(u, 0.33 - Math.abs(u) * 0.25); ctx.stroke();
    }
    // the core
    var core = 0.05 + sn * 0.03 + G.beat * 0.01;
    blob(0, 0.2, core, core, pierce ? "#fff2c8" : "#ffffff");
    resetT();
    ctx.globalAlpha = 1;
  }

  function drawPops() {
    ctx.textAlign = "center";
    for (var i = 0; i < G.pops.length; i++) {
      var p = G.pops[i], a = 1 - p.life / 0.9;
      ctx.globalAlpha = a;
      ctx.font = "800 " + (p.text.length > 8 ? 11 : 13) + "px Archivo, system-ui, sans-serif";
      ctx.fillStyle = css(p.col, 1);
      ctx.shadowColor = "rgba(0,0,0,0.8)"; ctx.shadowBlur = 6;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  // marine snow: dust in the water between you and the wall
  function drawSnow() {
    if (!snow.length) return;
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = css(G.pal.glow, 1);
    var t = G.clock;
    for (var i = 0; i < snow.length; i++) {
      var s = snow[i];
      var x = ((s.x + Math.sin(t * 0.1 + s.ph) * 0.02) % 1) * W;
      var y = (((s.y - t * (0.004 + s.z * 0.01)) % 1) + 1) % 1 * H;
      ctx.globalAlpha = (0.05 + s.z * 0.16) * (0.6 + 0.4 * Math.sin(t + s.ph));
      ctx.beginPath(); ctx.arc(x, y, 0.5 + s.z * 1.4, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  function drawFlashes() {
    var k = reduceMotion ? 0.35 : 1;
    if (G.flareFx > 0) {
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = G.flareFx * 0.35 * k;
      ctx.fillStyle = css(G.pal.glow, 1); ctx.fillRect(0, 0, W, H);
    }
    if (G.whiteout > 0) {
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = G.whiteout * 0.85 * k;
      ctx.fillStyle = css(mixc(G.pal.glow, [1, 1, 1], 0.6), 1); ctx.fillRect(0, 0, W, H);
    }
    if (G.hurt > 0) {
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = G.hurt * 0.3 * k;
      ctx.fillStyle = "#ff1830"; ctx.fillRect(0, 0, W, H);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  /* -------------------------------------------------------------- HUD */

  var hudCache = {};
  function setText(key, node, v) { if (hudCache[key] !== v) { hudCache[key] = v; node.textContent = v; } }
  function updateHud() {
    if (el.hud.hidden) return;
    setText("score", el.score, G.score.toLocaleString());
    setText("depth", el.depth, String(G.depth));
    setText("mult", el.mult, "×" + mult());
    var pip = mult() >= 8 ? 5 : G.streak % 5;
    if (hudCache.pip !== pip) {
      hudCache.pip = pip;
      for (var i = 0; i < 5; i++) el.pips.children[i].classList.toggle("on", i < pip);
    }
    if (hudCache.lives !== G.lives) {
      hudCache.lives = G.lives;
      var html = "";
      for (i = 0; i < Math.max(3, G.lives); i++) html += "<i" + (i < G.lives ? "" : " class=\"lost\"") + "></i>";
      el.lives.innerHTML = html;
    }
    var target = G.challenge && !G.beaten;
    setText("bestK", el.bestK, target ? "Target" : "Best");
    setText("best", el.best, target ? G.challenge.score.toLocaleString() : (Math.max(G.best, G.score) ? Math.max(G.best, G.score).toLocaleString() : "—"));
    el.best.classList.toggle("is-target", !!target);
  }

  /* ------------------------------------------------------------ share */

  // a square card of the well as it was when you went down, with the numbers
  function shareCanvas() {
    var keepFade = G.fade;
    G.fade = 1;
    render(performance.now());
    G.fade = keepFade;
    var S = 1080, c = document.createElement("canvas");
    c.width = S; c.height = S;
    var x = c.getContext("2d");
    x.fillStyle = G.pal.bg[1]; x.fillRect(0, 0, S, S);
    var bg = x.createRadialGradient(S / 2, S * 0.45, 0, S / 2, S * 0.45, S * 0.75);
    bg.addColorStop(0, G.pal.bg[0]); bg.addColorStop(1, G.pal.bg[1]);
    x.fillStyle = bg; x.fillRect(0, 0, S, S);
    var side = Math.min(W, H) * 1.02, sx = W / 2 - side / 2, sy = WELL.view.oy - side * 0.5;
    sy = clamp(sy, 0, Math.max(0, H - side));
    if (GL) x.drawImage(glCanvas, sx * GLS, sy * GLS, side * GLS, side * GLS, 0, 0, S, S);
    x.drawImage(canvas, sx * DPR, sy * DPR, side * DPR, side * DPR, 0, 0, S, S);
    var sh = x.createLinearGradient(0, S * 0.55, 0, S);
    sh.addColorStop(0, "rgba(0,0,0,0)"); sh.addColorStop(1, "rgba(0,0,0,0.78)");
    x.fillStyle = sh; x.fillRect(0, S * 0.55, S, S * 0.45);
    x.textAlign = "left";
    x.fillStyle = "#ffffff";
    x.shadowColor = css(G.pal.glow, 0.9); x.shadowBlur = 30;
    x.font = "900 64px Archivo, system-ui, sans-serif";
    x.fillText("MAW", 56, 110);
    x.shadowBlur = 0;
    x.font = "600 26px 'Geist Mono', ui-monospace, monospace";
    x.fillStyle = css(G.pal.glow, 1);
    x.fillText("DEPTH " + G.depth + " · " + G.sh.name.toUpperCase(), 58, S - 190);
    x.fillStyle = "#ffffff";
    x.shadowColor = "rgba(0,0,0,0.6)"; x.shadowBlur = 18;
    x.font = "900 128px Archivo, system-ui, sans-serif";
    x.fillText(G.score.toLocaleString(), 52, S - 60);
    x.shadowBlur = 0;
    return c;
  }

  el.chBtn.addEventListener("click", function () {
    var url = challengeUrl();
    var text = "I reached depth " + G.depth + " in Maw with " + G.score.toLocaleString() + " points. Your turn:";
    gtagSafe("share", { method: "challenge_link", content_type: "toy", item_id: "/toys/maw/" });
    if (navigator.share && coarse) {
      navigator.share({ title: "Maw", text: text, url: url }).catch(function () {});
      return;
    }
    var done = function () { el.chBtn.textContent = "Challenge link copied"; setTimeout(function () { el.chBtn.textContent = "Challenge a friend"; }, 1800); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text + " " + url).then(done, function () { window.prompt("Copy this link:", url); });
    } else window.prompt("Copy this link:", url);
  });

  /* ------------------------------------------------------------ panel */

  el.ovBtn.addEventListener("click", function () {
    AU.unlock();
    el.overlay.classList.add("is-out");
    setTimeout(function () { el.overlay.hidden = true; }, 260);
    if (G.paused) { resume(); return; }
    window.OPT_SHARE_IMAGE = null;
    window.OPT_SHARE_LINE = null;
    window.OPT_SHARE_TEXT = null;
    if (G.phase === "attract") { G.enemies = []; G.shots = []; }
    startRun();
  });

  el.soundBtn.addEventListener("click", function () {
    AU.unlock();
    var v = AU.toggle();
    el.soundBtn.setAttribute("aria-pressed", v ? "true" : "false");
    store(KEY_SOUND, v ? "1" : "0");
  });

  function store(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); }
    catch (e) { return null; }
  }
  function gtagSafe(n, p) { try { if (typeof gtag === "function") gtag("event", n, p); } catch (e) {} }

  /* -------------------------------------------------------------- loop */

  var last = 0, loopWarned = false, slow = 0, slowN = 0;
  function frame(now) {
    var raw = (now - last) / 1000 || 0;
    var dt = Math.min(0.05, raw);
    last = now;
    // one throw must never freeze the toy mid-run
    if (!G.paused) {
      try { update(dt); } catch (e) {
        if (!loopWarned) { loopWarned = true; try { console.error("update failed:", e); } catch (e2) {} }
      }
    }
    try { render(now); } catch (e) {
      if (!loopWarned) { loopWarned = true; try { console.error("render failed:", e); } catch (e2) {} }
    }
    // if the wall shader is too heavy for this device, draw it at a lower resolution
    if (GL && raw > 0 && raw < 0.2 && !G.paused) {
      slow += raw; slowN++;
      if (slowN >= 90) {
        if (slow / slowN > 0.026 && GLS_CAP > 0.6) { GLS_CAP = Math.max(0.6, GLS_CAP - 0.3); sizeGL(); }
        slow = 0; slowN = 0;
      }
    }
    requestAnimationFrame(frame);
  }



  function init() {
    var sv = store(KEY_SOUND);
    var on = sv !== "0";
    AU.init(on);
    el.soundBtn.setAttribute("aria-pressed", on ? "true" : "false");
    G.best = parseInt(store(KEY_BEST) || "0", 10) || 0;

    var m = /beat=(\d+)(?:-(\d+))?/.exec(location.hash || "");
    if (m && +m[1] > 0) {
      G.challenge = { score: +m[1], depth: +(m[2] || 0) };
      el.ovEyebrow.textContent = "You've been challenged";
      el.ovText.innerHTML = "<b>A friend reached " + (G.challenge.depth ? "depth " + G.challenge.depth + " with " : "") +
        G.challenge.score.toLocaleString() + " points.</b> Beat it.<br /><br />" + el.ovText.innerHTML;
      gtagSafe("challenge_open", { toy: "maw", value: G.challenge.score });
    }
    if (coarse) {
      el.ovKeys.textContent = "drag anywhere to slide around the rim · tap to fire · keep your finger down and you fire at whatever is in your lane";
      el.hint.textContent = "drag to slide around the rim · tap to fire";
    }

    G.phase = "attract";
    setWell(1);
    G.prm = params(1);
    seedSnow();
    layout();
    requestAnimationFrame(frame);
    gtagSafe("toy_open", { toy: "maw" });
  }

  window.addEventListener("resize", layout);
  window.addEventListener("orientationchange", function () { setTimeout(layout, 120); });

  init();
})();
