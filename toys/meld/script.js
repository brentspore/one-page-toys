/* Meld — drop glass orbs into a jar; two of a kind melt into a bigger one.
 *
 * physics.js owns the orbs, glass.js draws them, audio.js voices them. This
 * file is the game: the drop, the rules, the chain multiplier, the jar, the
 * heat and every effect, the HUD, and the share and challenge links.
 *
 * The world is in JAR UNITS: the jar is 100 wide and 125 deep, y grows down,
 * y = 0 is the fill line (cross it and stay there and the jar overflows),
 * the rim stands 8 above it. Everything on screen is jar units times `s`.
 *
 * A run's drops come from a seed, so a challenge link hands a friend the
 * exact same orbs in the same order. Physics is not deterministic and does
 * not need to be: same drops, your skill.
 */
(function () {
  "use strict";

  var PH = window.MeldPhysics, GLASS = window.MeldGlass, AU = window.MeldAudio;
  var TIERS = GLASS.TIERS;

  var RADII = [3.6, 4.8, 6.1, 8.0, 9.6, 11.5, 13.4, 15.6, 19.6, 23.8, 28.5];
  var TOP = RADII.length - 1;
  var JW = 100, JH = 125, RIM = -8, ZONE = -34, BASE = 6;
  var WALL = 2.6;
  var DROP_CD = 0.42;          // seconds between drops
  var OVER_T = 2.2;            // seconds above the line before the jar overflows
  var EXEMPT = 1.0;            // a fresh orb gets this long before it counts
  var CHAIN_T = 0.62;          // a meld inside this window extends the chain
  var WEIGHTS = [0.24, 0.24, 0.22, 0.16, 0.14];   // the five that can be dropped
  var ROLL_FULL = 160;         // pile motion that plays the rustle at full (p97 of real play is ~110)

  var KEY_BEST = "meld_best", KEY_FOUND = "meld_found", KEY_SOUND = "meld_sound", KEY_MUSIC = "meld_music",
      KEY_CHAIN = "meld_chain", KEY_RUNS = "meld_runs";

  var el = {
    canvas: document.getElementById("c"),
    hud: document.getElementById("hud"),
    score: document.getElementById("score"),
    best: document.getElementById("best"),
    bestK: document.getElementById("bestK"),
    next: document.getElementById("nextC"),
    callout: document.getElementById("callout"),
    calloutBig: document.getElementById("calloutBig"),
    calloutSub: document.getElementById("calloutSub"),
    overlay: document.getElementById("overlay"),
    ovEyebrow: document.getElementById("ovEyebrow"),
    ovTitle: document.getElementById("ovTitle"),
    ovText: document.getElementById("ovText"),
    ovDemo: document.getElementById("ovDemo"),
    ovBtn: document.getElementById("ovBtn"),
    chBtn: document.getElementById("chBtn"),
    freshBtn: document.getElementById("freshBtn"),
    ovKeys: document.getElementById("ovKeys"),
    soundBtn: document.getElementById("soundBtn"),
    musicBtn: document.getElementById("musicBtn"),
    hint: document.getElementById("hint")
  };
  var ctx = el.canvas.getContext("2d");
  var nctx = el.next.getContext("2d");

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;

  /* ------------------------------------------------------------- state */

  var world = new PH.World({ W: JW, H: JH, radii: RADII, g: 900 });
  world.onMerge = onMerge;
  world.onHit = onHit;

  var G = {
    phase: "attract",
    clock: 0,
    score: 0, shown: 0, best: 0,
    chainN: 0, chainT: -9, chainBest: 0,
    maxTier: 0, merges: 0, drops: 0,
    seed: 0, rng: null, seq: [], idx: 0,
    cd: 0, aim: 50, queued: -1,
    over: 0, overAt: null,
    challenge: null, beaten: false,
    found: 0,
    silent: false,
    attractT: 0,
    flash: 0, flashCol: "255,170,80", shake: 0,
    cracks: null, crackT: 0, dim: 0,
    sunsThisRun: 0
  };
  var FX = { sparks: [], ghosts: [], rings: [], pops: [], embers: [] };

  /* ------------------------------------------------------------ layout */

  var W = 0, H = 0, DPR = 1, s = 4, ox = 0, oy = 0, land = false;
  var bg = null, ladder = [], ladderImg = [];

  function layout() {
    W = window.innerWidth; H = window.innerHeight;
    DPR = Math.min(2, window.devicePixelRatio || 1);
    el.canvas.width = Math.round(W * DPR); el.canvas.height = Math.round(H * DPR);
    land = W > H * 1.1;
    // portrait keeps a strip at the bottom for the badges and the tickets pill
    var topRes = 58 + safe("top"), botRes = (land ? 40 : 58) + safe("bottom");
    var availH = Math.max(200, H - topRes - botRes);
    if (land) {
      // the ladder stands up beside the jar, smallest at the bottom
      s = Math.min(availH / (JH + BASE - ZONE + 2), (W - 32) / 150, 5.4);
      ox = W / 2 - (JW / 2) * s;
      oy = topRes + (availH - (JH + BASE - ZONE) * s) / 2 - ZONE * s;
    } else {
      var spanH = JH + BASE + 20 - ZONE;     // ladder strip under the base
      s = Math.min(availH / spanH, (W - 24) / (JW + WALL * 2 + 2), 5.4);
      ox = W / 2 - (JW / 2) * s;
      oy = topRes + Math.max(0, (availH - spanH * s) / 2) - ZONE * s;
    }
    ladder = [];
    for (var t = 0; t <= TOP; t++) {
      var rr = (2.2 + t * 0.24) * s;
      if (land) {
        var lx = JW + WALL + 12, ly = JH - 5 - t * ((JH - 2) / TOP);
        ladder.push({ x: ox + lx * s, y: oy + ly * s, r: Math.min(rr, 4.6 * s) });
      } else {
        var cw = JW / (TOP + 1);
        ladder.push({ x: ox + (cw * (t + 0.5)) * s, y: oy + (JH + BASE + 9) * s, r: Math.min(rr, cw * 0.44 * s) });
      }
    }
    GLASS.clear();
    ladderImg = [];
    buildBg();
    drawNext();
  }

  // env() inside a custom property reads back as the literal text, so measure
  // the inset off a probe element instead
  var probe = null;
  function safe(side) {
    if (!probe) {
      probe = document.createElement("div");
      probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;" +
        "padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)";
      document.body.appendChild(probe);
    }
    return parseFloat(getComputedStyle(probe)[side === "top" ? "paddingTop" : "paddingBottom"]) || 0;
  }

  function sx(x) { return ox + x * s; }
  function sy(y) { return oy + y * s; }

  /* --------------------------------------------------------- the studio */

  function buildBg() {
    bg = document.createElement("canvas");
    bg.width = Math.round(W * DPR); bg.height = Math.round(H * DPR);
    var x = bg.getContext("2d");
    x.scale(DPR, DPR);
    x.fillStyle = "#0a0706";
    x.fillRect(0, 0, W, H);
    // cool studio air from above
    var top = x.createRadialGradient(W / 2, -H * 0.25, 0, W / 2, -H * 0.25, H * 1.0);
    top.addColorStop(0, "rgba(120,130,160,0.10)");
    top.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = top; x.fillRect(0, 0, W, H);
    // the furnace: the jar stands over its glow
    var fx = sx(JW / 2), fy = sy(JH + BASE);
    var big = Math.max(W, H);
    var fur = x.createRadialGradient(fx, fy + 20 * s, 0, fx, fy + 20 * s, big * 0.8);
    fur.addColorStop(0, "rgba(255,120,36,0.34)");
    fur.addColorStop(0.18, "rgba(200,70,18,0.2)");
    fur.addColorStop(0.5, "rgba(70,22,8,0.08)");
    fur.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = fur; x.fillRect(0, 0, W, H);
    // the bench the jar stands on: a dark top with the glow lying across it
    var bench = fy;
    var bg2 = x.createLinearGradient(0, bench, 0, H);
    bg2.addColorStop(0, "rgba(40,18,10,0.9)");
    bg2.addColorStop(0.06, "rgba(18,10,8,0.95)");
    bg2.addColorStop(1, "rgba(6,4,4,1)");
    x.fillStyle = bg2; x.fillRect(0, bench, W, H - bench);
    var edge = x.createLinearGradient(0, 0, W, 0);
    edge.addColorStop(0, "rgba(255,140,60,0)");
    edge.addColorStop(0.5, "rgba(255,150,70,0.35)");
    edge.addColorStop(1, "rgba(255,140,60,0)");
    x.fillStyle = edge; x.fillRect(0, bench, W, 1.2);
    // out-of-focus lights in the dark of the studio
    var r = mulberry(91);
    x.globalCompositeOperation = "lighter";
    for (var i = 0; i < 14; i++) {
      var bx = r() * W, by = r() * H * 0.55, br = (10 + r() * 34) * Math.max(0.6, s / 4);
      var warm = r() > 0.35;
      var g = x.createRadialGradient(bx, by, 0, bx, by, br);
      g.addColorStop(0, warm ? "rgba(255,150,70,0.07)" : "rgba(140,170,255,0.05)");
      g.addColorStop(0.7, warm ? "rgba(255,150,70,0.04)" : "rgba(140,170,255,0.03)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = g;
      x.beginPath(); x.arc(bx, by, br, 0, 6.283); x.fill();
    }
    x.globalCompositeOperation = "source-over";
    // the jar's shadow and the light through its base, on the bench
    var sh = x.createRadialGradient(fx, bench + 3 * s, 0, fx, bench + 3 * s, 70 * s);
    sh.addColorStop(0, "rgba(255,150,60,0.22)");
    sh.addColorStop(1, "rgba(255,150,60,0)");
    x.save(); x.scale(1, 0.18); x.fillStyle = sh;
    x.beginPath(); x.arc(fx, (bench + 3 * s) / 0.18, 70 * s, 0, 6.283); x.fill(); x.restore();
  }

  // a few motes of heat rising through the studio
  function seedEmbers() {
    FX.embers = [];
    var n = reduceMotion ? 8 : 26;
    for (var i = 0; i < n; i++) FX.embers.push(newEmber(true));
  }
  function newEmber(anywhere) {
    return {
      x: Math.random() * W, y: anywhere ? Math.random() * H : H + 10,
      v: 6 + Math.random() * 16, ph: Math.random() * 6.28, r: 0.6 + Math.random() * 1.4,
      a: 0.25 + Math.random() * 0.5
    };
  }

  /* -------------------------------------------------------------- drops */

  function mulberry(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pickTier(u) {
    var k = 0;
    while (k < WEIGHTS.length - 1 && u > WEIGHTS[k]) { u -= WEIGHTS[k]; k++; }
    return k;
  }

  function ensureSeq(n) {
    while (G.seq.length <= n) G.seq.push(pickTier(G.rng()));
  }

  function held() { return G.seq[G.idx]; }

  function newSeed() { return (Math.random() * 4294967296) >>> 0; }

  /* ------------------------------------------------------------- events */

  function onMerge(a, b, born) {
    var x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
    var t = a.tier;
    FX.ghosts.push({ tier: t, v: a.v, w: b.v, ax: a.x, ay: a.y, bx: b.x, by: b.y, x: x, y: y, aa: a.a, ba: b.a, t: 0 });
    if (born) {
      born.hot = 1;
      born.v = born.id % 3;
      born.wob = 1;
    }
    if (G.silent) return;
    var hot = born ? born.tier : TOP;
    burst(x, y, t, born ? 1 : 2.4);
    FX.rings.push({ x: x, y: y, r0: RADII[t] * 0.6, r1: RADII[Math.min(TOP, t + 1)] * (born ? 1.9 : 4), t: 0, max: born ? 0.45 : 0.9, col: TIERS[hot].glow });

    if (G.phase !== "play") return;

    // The chain: a meld that lands while the last one is still ringing counts
    // up. Every drop starts a fresh chain, or spam-dropping would string
    // unrelated melds together (a random tapper reached x9 before this).
    var now = world.time;
    G.chainN = now - G.chainT < CHAIN_T ? G.chainN + 1 : 1;
    G.chainT = now;
    if (G.chainN > G.chainBest) G.chainBest = G.chainN;
    var base = (t + 1) * (t + 2) / 2;
    var pts = base * G.chainN;
    G.score += pts;
    G.merges++;
    FX.pops.push({ x: x, y: y - RADII[Math.min(TOP, t + 1)] * 0.4, text: "+" + pts, sub: G.chainN > 1 ? "×" + G.chainN : "", t: 0, max: 1.1, col: TIERS[hot].glow, big: Math.min(1.8, 0.85 + t * 0.07 + (G.chainN - 1) * 0.12) });
    var pan = clamp((x / JW) * 2 - 1, -0.9, 0.9);
    AU.merge(t, G.chainN, pan);

    if (G.chainN >= 3) callout("Chain ×" + G.chainN, G.chainN >= 5 ? "the jar is cooking" : "", false, 900);

    if (born) {
      if (born.tier > G.maxTier) G.maxTier = born.tier;
      var bit = 1 << born.tier;
      if (!(G.found & bit)) {
        G.found |= bit;
        store(KEY_FOUND, String(G.found));
        if (born.tier > 4 && born.tier < TOP) {
          callout("New: " + TIERS[born.tier].name, (born.tier + 1) + " of " + (TOP + 1) + " melted", false, 1700);
          AU.discover(born.tier);
          gtagSafe("new_orb", { toy: "meld", tier: born.tier, name: TIERS[born.tier].name });
        }
      }
      if (born.tier === TOP) {
        G.sunsThisRun++;
        G.flash = Math.max(G.flash, reduceMotion ? 0 : 0.55); G.flashCol = "255,190,90";
        shake(reduceMotion ? 0 : 1.2);
        AU.sun(pan);
        callout("A sun", G.sunsThisRun === 1 ? "make another and the two burn out together" : "", false, 2200);
        gtagSafe("sun_made", { toy: "meld", value: G.score });
      }
    } else {
      // two suns: they flare white and are gone, and the jar breathes out
      G.flash = Math.max(G.flash, reduceMotion ? 0 : 0.9); G.flashCol = "255,240,210";
      shake(reduceMotion ? 0 : 2);
      AU.nova(pan);
      callout("Supernova", "two suns burned out", false, 2200);
      gtagSafe("nova", { toy: "meld", value: G.score });
    }
    checkChallenge();
  }

  var hitClock = [];
  function onHit(a, b, speed) {
    if (G.silent || G.phase === "attract") return;
    // a pile of orbs clatters; cap it at what an ear can actually separate
    var now = world.time;
    while (hitClock.length && now - hitClock[0] > 1) hitClock.shift();
    if (hitClock.length > 16) return;
    hitClock.push(now);
    var pan = clamp((b.x / JW) * 2 - 1, -0.9, 0.9);
    AU.hit(a ? a.tier : -1, b.tier, Math.min(1, speed / 260), pan);
  }

  function burst(x, y, tier, k) {
    var n = Math.round((8 + tier * 2.2) * k * (reduceMotion ? 0.35 : 1));
    var col = TIERS[Math.min(TOP, tier + 1)].glow;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * 6.283, v = (40 + Math.random() * 90) * (0.7 + tier * 0.06) * Math.sqrt(k);
      FX.sparks.push({
        x: x, y: y, px: x, py: y,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30,
        t: 0, max: 0.45 + Math.random() * 0.5,
        col: Math.random() < 0.55 ? "255,200,120" : hexRgb(col)
      });
    }
  }

  function shake(a) { G.shake = Math.max(G.shake, a); }

  /* ------------------------------------------------------------- the run */

  function startRun() {
    world.clear();
    FX.sparks = []; FX.ghosts = []; FX.rings = []; FX.pops = [];
    G.phase = "play";
    G.score = 0; G.shown = 0;
    G.chainN = 0; G.chainT = -9; G.chainBest = 0;
    G.maxTier = 0; G.merges = 0; G.drops = 0; G.sunsThisRun = 0;
    G.over = 0; G.overAt = null; G.cracks = null; G.dim = 0;
    G.beaten = false;
    G.seed = G.challenge ? G.challenge.seed : newSeed();
    G.rng = mulberry(G.seed);
    G.seq = []; G.idx = 0;
    ensureSeq(2);
    G.cd = 0.2; G.queued = -1;
    G.silent = false;
    el.hud.hidden = false;
    hudCache = {};
    drawNext();
    AU.start();
    // a new piece of music for every run, from the run's own seed, so a
    // challenge replays the same drops to the same music
    AU.musicNew((G.seed ^ 0x5bd1e995) >>> 0);
    var runs = (parseInt(store(KEY_RUNS) || "0", 10) || 0) + 1;
    store(KEY_RUNS, String(runs));
    gtagSafe("run_start", { toy: "meld", challenge: !!G.challenge });
  }

  function drop() {
    if (G.phase !== "play") return false;
    if (G.cd > 0) { G.queued = G.clock; return false; }
    var tier = held(), R = RADII[tier];
    var x = clamp(G.aim, R, JW - R);
    var b = world.add(tier, x, RIM - 3 - R, 0, 40);
    b.v = b.id % 3; b.hot = 0; b.wob = 0;
    G.idx++;
    ensureSeq(G.idx + 1);
    G.cd = DROP_CD;
    G.drops++;
    G.chainN = 0; G.chainT = -9;
    G.queued = -1;
    AU.drop(tier, clamp((x / JW) * 2 - 1, -0.9, 0.9));
    drawNext();
    if (G.drops === 3) el.hint.classList.add("is-gone");
    return true;
  }

  function gameOver() {
    G.phase = "over";
    G.overAt = G.clock;
    AU.overflow();
    AU.stop();
    // the glass gives where the overflow was
    var hx = JW / 2, hy = 0;
    for (var i = 0; i < world.bodies.length; i++) {
      var b = world.bodies[i];
      if (b.y - b.r < 0 && world.time - b.born > EXEMPT) { hx = b.x; hy = b.y; break; }
    }
    G.cracks = makeCracks(hx, Math.max(-4, hy));
    G.crackT = 0;
    shake(reduceMotion ? 0 : 1.4);
    callout("Overflow", "", true, 1300);

    var pb = G.score > G.best;
    if (pb) { G.best = G.score; store(KEY_BEST, String(G.best)); }
    var cb = parseInt(store(KEY_CHAIN) || "0", 10) || 0;
    if (G.chainBest > cb) store(KEY_CHAIN, String(G.chainBest));

    var top = TIERS[G.maxTier].name;
    window.OPT_SHARE_IMAGE = function () { return shareCanvas(); };
    window.OPT_SHARE_LINE = G.score.toLocaleString() + " · melted a " + top;
    window.OPT_SHARE_TEXT = "I melted a " + top + " orb and scored " + G.score.toLocaleString() +
      " in Meld. Same drops, your turn: " + challengeUrl();

    var chLine = "";
    if (G.challenge) {
      chLine = G.score > G.challenge.score
        ? "<br /><span class=\"win\">You beat your friend by " + (G.score - G.challenge.score).toLocaleString() + ".</span>"
        : "<br /><span class=\"short\">" + (G.challenge.score - G.score).toLocaleString() + " short of your friend's " + G.challenge.score.toLocaleString() + ".</span>";
    }
    var img = orbImg(G.maxTier);
    showPanel(pb && G.score > 0 ? "New best" : "The jar overflowed",
      G.score.toLocaleString(),
      "<span class=\"result\">" + (img ? "<img class=\"result__orb\" src=\"" + img + "\" alt=\"\" />" : "") +
      "<span>Biggest orb <b>" + top + "</b><br />" +
      "Longest chain <b>×" + Math.max(1, G.chainBest) + "</b> · " + G.merges + " melds</span></span>" +
      "Best " + G.best.toLocaleString() + chLine,
      G.challenge ? "Same drops again" : "Play again", true);
    gtagSafe("run_end", { toy: "meld", value: G.score, tier: G.maxTier, chain: G.chainBest, challenge: !!G.challenge });
  }

  function checkChallenge() {
    if (G.challenge && !G.beaten && G.score > G.challenge.score) {
      G.beaten = true;
      callout("Challenge beaten", "you passed " + G.challenge.score.toLocaleString(), false, 1800);
      AU.discover(8);
      gtagSafe("challenge_beaten", { toy: "meld", value: G.score });
    }
  }

  function challengeUrl() {
    return "https://onepagetoys.com/toys/meld/#c=" + G.seed.toString(36) + "-" + G.score + "-" + G.maxTier;
  }

  function makeCracks(x, y) {
    var r = Math.random, lines = [];
    function branch(px, py, ang, len, depth) {
      var pts = [[px, py]], k = 0, seg = 3 + r() * 3;
      while (k < len) {
        ang += (r() - 0.5) * 0.9;
        px += Math.cos(ang) * seg; py += Math.sin(ang) * seg;
        if (px < -WALL || px > JW + WALL || py < RIM - 2 || py > JH + BASE) break;
        pts.push([px, py]);
        k += seg;
        if (depth < 2 && r() < 0.18) branch(px, py, ang + (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.6), len * 0.5, depth + 1);
      }
      lines.push(pts);
    }
    var n = 6 + Math.floor(r() * 3);
    for (var i = 0; i < n; i++) branch(x, y, (i / n) * 6.283 + r() * 0.5, 30 + r() * 50, 0);
    return lines;
  }

  /* ------------------------------------------------------------ attract */

  // behind the intro panel the jar is already half full and still filling,
  // so the first thing a visitor sees is the game, not a menu
  function attractFill() {
    world.clear();
    G.silent = true;
    var r = mulberry(newSeed());
    for (var k = 0; k < 20; k++) {
      var tier = Math.min(7, Math.floor(Math.pow(r(), 1.6) * 8));
      var R = RADII[tier];
      var b = world.add(tier, R + r() * (JW - 2 * R), RIM - 3 - R, 0, 40);
      b.v = b.id % 3; b.hot = 0; b.wob = 0;
      for (var f = 0; f < 22; f++) world.step(1 / 60);
    }
    for (var f2 = 0; f2 < 120; f2++) world.step(1 / 60);
    for (var i = 0; i < world.bodies.length; i++) world.bodies[i].hot = 0;
    FX.ghosts = []; FX.sparks = []; FX.rings = [];
    G.silent = false;
    G.attractT = 0.8;
  }

  function attractTick(dt) {
    G.attractT -= dt;
    if (G.attractT > 0) return;
    G.attractT = 1.3 + Math.random() * 0.9;
    var top = 1e9;
    for (var i = 0; i < world.bodies.length; i++) top = Math.min(top, world.bodies[i].y - world.bodies[i].r);
    if (top < 22) { attractFill(); return; }
    var tier = pickTier(Math.random()), R = RADII[tier];
    var b = world.add(tier, R + Math.random() * (JW - 2 * R), RIM - 3 - R, 0, 40);
    b.v = b.id % 3; b.hot = 0; b.wob = 0;
  }

  /* ------------------------------------------------------------- update */

  var keys = { left: false, right: false, held: 0 };

  function update(dt) {
    G.clock += dt;
    if (G.phase === "attract") attractTick(dt);

    if (G.phase !== "over") world.step(dt);

    var B = world.bodies, i, b;
    for (i = 0; i < B.length; i++) {
      b = B[i];
      if (b.hot) b.hot = Math.max(0, b.hot - dt / 1.15);
      if (b.wob) b.wob = Math.max(0, b.wob - dt / 0.5);
    }

    if (G.phase === "play") {
      G.cd = Math.max(0, G.cd - dt);
      if (G.queued >= 0 && G.cd === 0) {
        if (G.clock - G.queued < 0.4) drop(); else G.queued = -1;
      }
      // keyboard aim, faster the longer it is held
      var dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      if (dir) {
        keys.held += dt;
        G.aim += dir * (55 + Math.min(1, keys.held * 2.2) * 75) * dt;
      } else keys.held = 0;
      var R = RADII[held()];
      G.aim = clamp(G.aim, R, JW - R);

      // overflow: anything settled above the line, for long enough
      var above = false;
      for (i = 0; i < B.length; i++) {
        b = B[i];
        if (b.y - b.r < 0 && world.time - b.born > EXEMPT) { above = true; b.danger = true; }
        else b.danger = false;
      }
      G.over = above ? G.over + dt : Math.max(0, G.over - dt * 3);
      AU.danger(G.over / OVER_T);

      // the pile on the move: weight of what is sliding and rolling while in
      // contact, which drives one looping rustle in audio.js
      var en = 0, px = 0;
      for (i = 0; i < B.length; i++) {
        b = B[i];
        if (b.zz || !b.touch) continue;
        var sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
        if (sp < 3) continue;
        var wgt = Math.min(sp, 70) * b.R / 10;
        en += wgt; px += b.x * wgt;
      }
      G.rollE = en;
      AU.roll(Math.min(1, en / ROLL_FULL), en ? (px / en / JW) * 2 - 1 : 0);
      if (G.over >= OVER_T) gameOver();

      // the score rolls up rather than jumping
      if (G.shown < G.score) G.shown = Math.min(G.score, G.shown + Math.max(1, (G.score - G.shown) * dt * 9));
    } else if (G.phase === "over") {
      AU.roll(0, 0);
      G.crackT += dt;
      G.dim = Math.min(1, G.dim + dt * 1.4);
      AU.danger(0);
    }

    // effects
    var k;
    for (k = FX.sparks.length - 1; k >= 0; k--) {
      var p = FX.sparks[k];
      p.t += dt;
      if (p.t > p.max) { FX.sparks.splice(k, 1); continue; }
      p.px = p.x; p.py = p.y;
      p.vy += 260 * dt; p.vx *= 1 - 1.6 * dt; p.vy *= 1 - 1.6 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    for (k = FX.ghosts.length - 1; k >= 0; k--) { FX.ghosts[k].t += dt; if (FX.ghosts[k].t > 0.12) FX.ghosts.splice(k, 1); }
    for (k = FX.rings.length - 1; k >= 0; k--) { FX.rings[k].t += dt; if (FX.rings[k].t > FX.rings[k].max) FX.rings.splice(k, 1); }
    for (k = FX.pops.length - 1; k >= 0; k--) { FX.pops[k].t += dt; if (FX.pops[k].t > FX.pops[k].max) FX.pops.splice(k, 1); }
    for (k = 0; k < FX.embers.length; k++) {
      var e = FX.embers[k];
      e.y -= e.v * dt; e.ph += dt * 1.3;
      e.x += Math.sin(e.ph) * 6 * dt;
      if (e.y < -10) FX.embers[k] = newEmber(false);
    }
    G.flash = Math.max(0, G.flash - dt * 1.8);
    G.shake = Math.max(0, G.shake - dt * 4);

    updateHud();
  }

  /* ------------------------------------------------------------- render */

  var glowCore = null, glowHalo = null;
  function glowSprites() {
    if (glowCore) return;
    glowCore = radial(128, [[0, "rgba(255,252,230,1)"], [0.45, "rgba(255,220,140,0.6)"], [1, "rgba(255,160,60,0)"]]);
    glowHalo = radial(128, [[0, "rgba(255,150,50,0.9)"], [0.5, "rgba(255,90,20,0.35)"], [1, "rgba(255,60,10,0)"]]);
  }
  function radial(n, stops) {
    var c = document.createElement("canvas"); c.width = c.height = n;
    var x = c.getContext("2d"), g = x.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    x.fillStyle = g; x.fillRect(0, 0, n, n);
    return c;
  }

  function render() {
    glowSprites();
    var x = ctx;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.drawImage(bg, 0, 0);
    x.setTransform(DPR, 0, 0, DPR, 0, 0);

    // embers drift behind everything
    x.globalCompositeOperation = "lighter";
    for (var e = 0; e < FX.embers.length; e++) {
      var m = FX.embers[e];
      x.fillStyle = "rgba(255,150,60," + (m.a * (0.6 + 0.4 * Math.sin(m.ph * 3))).toFixed(3) + ")";
      x.beginPath(); x.arc(m.x, m.y, m.r, 0, 6.283); x.fill();
    }
    x.globalCompositeOperation = "source-over";

    var shx = 0, shy = 0;
    if (G.shake > 0) { shx = (Math.random() - 0.5) * G.shake * s; shy = (Math.random() - 0.5) * G.shake * s; }
    x.save();
    x.translate(shx, shy);

    jarBack(x);

    // ghosts of melding pairs slide together underneath the newborn
    for (var gi = 0; gi < FX.ghosts.length; gi++) drawGhost(x, FX.ghosts[gi]);

    var B = world.bodies, i;
    for (i = 0; i < B.length; i++) drawOrb(x, B[i]);
    // light that orbs give off goes on after all of them, so it falls on neighbours
    x.globalCompositeOperation = "lighter";
    for (i = 0; i < B.length; i++) orbLight(x, B[i]);
    x.globalCompositeOperation = "source-over";

    drawFx(x);
    jarFront(x);
    if (G.phase === "play") drawHeld(x);
    if (G.cracks) drawCracks(x);
    x.restore();

    drawLadder(x);
    drawPops(x);

    if (G.flash > 0) {
      x.globalCompositeOperation = "lighter";
      x.fillStyle = "rgba(" + G.flashCol + "," + (G.flash * 0.35).toFixed(3) + ")";
      x.fillRect(0, 0, W, H);
      x.globalCompositeOperation = "source-over";
    }
  }

  function jarBack(x) {
    var L = sx(0), R = sx(JW), T = sy(RIM), Bt = sy(JH);
    // the back of the jar: faintly lit glass, warmer toward the furnace
    var g = x.createLinearGradient(0, T, 0, Bt);
    g.addColorStop(0, "rgba(255,240,225,0.025)");
    g.addColorStop(1, "rgba(255,150,80,0.07)");
    x.fillStyle = g;
    x.fillRect(L, T, R - L, Bt - T);
    // furnace light coming up through the base
    x.globalCompositeOperation = "lighter";
    var f = x.createRadialGradient(sx(JW / 2), Bt + 4 * s, 0, sx(JW / 2), Bt + 4 * s, 70 * s);
    f.addColorStop(0, "rgba(255,120,40,0.16)");
    f.addColorStop(1, "rgba(255,120,40,0)");
    x.fillStyle = f;
    x.fillRect(L, T, R - L, Bt - T + BASE * s);
    x.globalCompositeOperation = "source-over";
    // the heat in the jar rises with the danger
    var heat = G.phase === "play" ? Math.min(1, G.over / OVER_T) : 0;
    if (heat > 0) {
      var hg = x.createLinearGradient(0, T, 0, sy(30));
      hg.addColorStop(0, "rgba(255,60,30," + (0.22 * heat).toFixed(3) + ")");
      hg.addColorStop(1, "rgba(255,60,30,0)");
      x.fillStyle = hg;
      x.fillRect(L, T, R - L, sy(30) - T);
    }
  }

  function jarFront(x) {
    var L = sx(0), R = sx(JW), T = sy(RIM), Bt = sy(JH), w = WALL * s, base = BASE * s;
    // thick glass walls and base
    x.fillStyle = "rgba(190,225,255,0.06)";
    x.fillRect(L - w, T, w, Bt - T + base);
    x.fillRect(R, T, w, Bt - T + base);
    x.fillRect(L, Bt, R - L, base);
    // the base glows where the furnace shines through it
    var bgl = x.createLinearGradient(0, Bt, 0, Bt + base);
    bgl.addColorStop(0, "rgba(255,170,90,0.25)");
    bgl.addColorStop(1, "rgba(255,120,50,0.08)");
    x.fillStyle = bgl;
    x.fillRect(L, Bt, R - L, base);

    x.lineWidth = 1;
    x.strokeStyle = "rgba(255,255,255,0.28)";
    roundRect(x, L - w, T - 0.5, R - L + w * 2, Bt - T + base + 0.5, Math.min(10, 2.5 * s));
    x.stroke();
    x.strokeStyle = "rgba(255,255,255,0.1)";
    x.beginPath();
    x.moveTo(L, T); x.lineTo(L, Bt); x.lineTo(R, Bt); x.lineTo(R, T);
    x.stroke();

    // vertical sheens on the front of the glass, over the orbs
    x.globalCompositeOperation = "lighter";
    sheen(x, L + 3 * s, 5 * s, 0.07);
    sheen(x, L + 10 * s, 1.6 * s, 0.05);
    sheen(x, R - 9 * s, 3 * s, 0.035);
    x.globalCompositeOperation = "source-over";

    // the rim: a rolled lip catching the light
    x.strokeStyle = "rgba(255,255,255,0.5)";
    x.lineWidth = 1.4;
    x.beginPath(); x.moveTo(L - w - 1, T); x.lineTo(L, T); x.stroke();
    x.beginPath(); x.moveTo(R, T); x.lineTo(R + w + 1, T); x.stroke();

    // graduations, like a measuring jar
    x.strokeStyle = "rgba(255,255,255,0.16)";
    x.lineWidth = 1;
    for (var gy = 0; gy <= JH; gy += 12.5) {
      var major = Math.round(gy) % 25 === 0;
      x.beginPath();
      x.moveTo(L + 1, sy(JH - gy)); x.lineTo(L + (major ? 5 : 3) * s * 0.6, sy(JH - gy));
      x.stroke();
    }

    // the fill line
    var heat = G.phase === "play" ? Math.min(1, G.over / OVER_T) : G.phase === "over" ? 1 : 0;
    var pulse = heat > 0 ? 0.5 + 0.5 * Math.sin(G.clock * (8 + heat * 14)) : 0;
    var ly = sy(0);
    x.save();
    x.setLineDash([4, 4]);
    x.lineWidth = heat > 0 ? 1.6 : 1;
    x.strokeStyle = heat > 0
      ? "rgba(255," + Math.round(90 - 40 * pulse) + ",60," + (0.55 + 0.45 * pulse).toFixed(3) + ")"
      : "rgba(255,210,170,0.3)";
    if (heat > 0) { x.shadowColor = "rgba(255,60,40,0.9)"; x.shadowBlur = 10 * heat; }
    x.beginPath(); x.moveTo(L + 2, ly); x.lineTo(R - 2, ly); x.stroke();
    x.restore();
    x.fillStyle = heat > 0 ? "rgba(255,120,90,0.9)" : "rgba(255,210,170,0.45)";
    x.font = "600 " + Math.max(8, Math.round(2.4 * s)) + "px 'Geist Mono', ui-monospace, monospace";
    x.textAlign = "right";
    x.fillText("MAX", R - 3, ly - 3);
  }

  function sheen(x, cx, w, a) {
    var g = x.createLinearGradient(cx - w, 0, cx + w, 0);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.5, "rgba(255,255,255," + a + ")");
    g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g;
    x.fillRect(cx - w, sy(RIM), w * 2, (JH - RIM) * s);
  }

  function roundRect(x, l, t, w, h, r) {
    x.beginPath();
    x.moveTo(l, t);
    x.lineTo(l, t + h - r); x.quadraticCurveTo(l, t + h, l + r, t + h);
    x.lineTo(l + w - r, t + h); x.quadraticCurveTo(l + w, t + h, l + w, t + h - r);
    x.lineTo(l + w, t);
  }

  function drawOrb(x, b, alpha) {
    var R = b.R * s, k = b.r / b.R;
    var spr = GLASS.sprite(b.tier, R * DPR, b.v);
    var hw = spr.half / DPR;
    var px = sx(b.x), py = sy(b.y);
    x.save();
    x.translate(px, py);
    if (alpha !== undefined) x.globalAlpha = alpha;
    // a freshly melded orb is still soft: it wobbles as it sets
    var wob = b.wob ? 1 + Math.sin((1 - b.wob) * 22) * 0.06 * b.wob : 1;
    if (k !== 1 || wob !== 1) x.scale(k * wob, k / wob);
    x.save(); x.rotate(b.a); x.drawImage(spr.body, -hw, -hw, hw * 2, hw * 2); x.restore();
    x.drawImage(spr.dark, -hw, -hw, hw * 2, hw * 2);
    x.globalCompositeOperation = "lighter";
    x.drawImage(spr.light, -hw, -hw, hw * 2, hw * 2);
    // still hot from the meld: white, then yellow, then orange as it cools
    if (b.hot > 0) {
      var h = b.hot;
      x.globalAlpha = (alpha === undefined ? 1 : alpha) * h * h;
      x.drawImage(glowCore, -R * 1.05, -R * 1.05, R * 2.1, R * 2.1);
      x.globalAlpha = (alpha === undefined ? 1 : alpha) * h * 0.8;
      x.drawImage(glowHalo, -R * 1.25, -R * 1.25, R * 2.5, R * 2.5);
    }
    x.restore();
    if (b.danger) {
      var p = 0.5 + 0.5 * Math.sin(G.clock * 12);
      x.strokeStyle = "rgba(255,70,50," + (0.35 + 0.5 * p).toFixed(3) + ")";
      x.lineWidth = 2;
      x.beginPath(); x.arc(px, py, b.r * s + 1.5, 0, 6.283); x.stroke();
    }
  }

  function orbLight(x, b) {
    if (b.tier === TOP) {
      var R = b.r * s, fl = 0.85 + 0.15 * Math.sin(G.clock * 3.1 + b.id) * Math.sin(G.clock * 1.7);
      x.globalAlpha = 0.32 * fl;
      x.drawImage(glowHalo, sx(b.x) - R * 1.7, sy(b.y) - R * 1.7, R * 3.4, R * 3.4);
      x.globalAlpha = 0.14 * fl;
      x.drawImage(glowHalo, sx(b.x) - R * 3.4, sy(b.y) - R * 3.4, R * 6.8, R * 6.8);
      x.globalAlpha = 1;
    } else if (b.hot > 0.05) {
      var r2 = b.r * s * 2.6;
      x.globalAlpha = b.hot * 0.35;
      x.drawImage(glowHalo, sx(b.x) - r2, sy(b.y) - r2, r2 * 2, r2 * 2);
      x.globalAlpha = 1;
    }
  }

  function drawGhost(x, g) {
    var u = Math.min(1, g.t / 0.12), e = u * u * (3 - 2 * u);
    var ax = g.ax + (g.x - g.ax) * e, ay = g.ay + (g.y - g.ay) * e;
    var bx = g.bx + (g.x - g.bx) * e, by = g.by + (g.y - g.by) * e;
    var R = RADII[g.tier];
    // the molten neck between them, drawn first so the halves sit in it
    x.save();
    x.globalCompositeOperation = "lighter";
    x.lineCap = "round";
    x.strokeStyle = "rgba(255,170,70," + (0.55 * (1 - u)).toFixed(3) + ")";
    x.lineWidth = R * s * 1.3 * (1 - u * 0.5);
    x.beginPath(); x.moveTo(sx(ax), sy(ay)); x.lineTo(sx(bx), sy(by)); x.stroke();
    x.restore();
    var sc = 1 - e * 0.35;
    // scaled by transform, never by sprite size, or every frame caches a new sprite
    drawOrb(x, { tier: g.tier, R: R, r: R * sc, x: ax, y: ay, a: g.aa, v: g.v, hot: u, wob: 0 }, 1 - u);
    drawOrb(x, { tier: g.tier, R: R, r: R * sc, x: bx, y: by, a: g.ba, v: g.w, hot: u, wob: 0 }, 1 - u);
  }

  function drawFx(x) {
    var i;
    x.save();
    x.globalCompositeOperation = "lighter";
    for (i = 0; i < FX.rings.length; i++) {
      var r = FX.rings[i], u = r.t / r.max, e = 1 - Math.pow(1 - u, 3);
      x.strokeStyle = hexA(r.col, 0.6 * (1 - u));
      x.lineWidth = Math.max(1, (1 - u) * 3);
      x.beginPath(); x.arc(sx(r.x), sy(r.y), (r.r0 + (r.r1 - r.r0) * e) * s, 0, 6.283); x.stroke();
    }
    x.lineCap = "round";
    for (i = 0; i < FX.sparks.length; i++) {
      var p = FX.sparks[i], a = 1 - p.t / p.max;
      x.strokeStyle = "rgba(" + p.col + "," + a.toFixed(3) + ")";
      x.lineWidth = Math.max(1, 0.5 * s * a);
      x.beginPath(); x.moveTo(sx(p.px), sy(p.py)); x.lineTo(sx(p.x) + 0.01, sy(p.y)); x.stroke();
    }
    x.restore();
  }

  function drawHeld(x) {
    var tier = held(), R = RADII[tier];
    var ready = 1 - Math.min(1, G.cd / 0.14);
    var ax = clamp(G.aim, R, JW - R), ay = RIM - 3 - R;
    // the guide: where it will land
    var landY = world.landing(ax, R);
    if (ready > 0.9) {
      x.save();
      x.setLineDash([3, 5]);
      x.strokeStyle = hexA(TIERS[tier].glow, 0.35);
      x.lineWidth = 1.2;
      x.beginPath(); x.moveTo(sx(ax), sy(ay + R)); x.lineTo(sx(ax), sy(landY - R)); x.stroke();
      x.setLineDash([2, 4]);
      x.strokeStyle = hexA(TIERS[tier].glow, 0.3);
      x.beginPath(); x.arc(sx(ax), sy(landY), R * s, 0, 6.283); x.stroke();
      x.restore();
    }
    // the punty: a steel rod with the gather on its hot end
    var rodTop = sy(ZONE) - 4, rodBot = sy(ay - R * 0.8);
    var rg = x.createLinearGradient(0, rodTop, 0, rodBot);
    rg.addColorStop(0, "rgba(120,120,130,0)");
    rg.addColorStop(0.5, "rgba(150,150,160,0.55)");
    rg.addColorStop(1, "rgba(255,140,60,0.9)");
    x.strokeStyle = rg;
    x.lineWidth = Math.max(1.5, 0.9 * s);
    x.beginPath(); x.moveTo(sx(ax), rodTop); x.lineTo(sx(ax), rodBot); x.stroke();
    if (ready > 0) {
      var k = 0.6 + 0.4 * ready;
      drawOrb(x, { tier: tier, R: R, r: R * k, x: ax, y: ay, a: G.clock * 0.6, v: (G.idx) % 3, hot: 0, wob: 0 }, ready);
    }
  }

  function drawCracks(x) {
    var u = Math.min(1, G.crackT / 0.35);
    x.save();
    x.fillStyle = "rgba(6,3,2," + (0.38 * G.dim).toFixed(3) + ")";
    x.fillRect(sx(-WALL), sy(RIM), (JW + WALL * 2) * s, (JH - RIM + BASE) * s);
    x.lineJoin = "round";
    for (var pass = 0; pass < 2; pass++) {
      x.strokeStyle = pass ? "rgba(255,255,255,0.85)" : "rgba(200,230,255,0.25)";
      x.lineWidth = pass ? 1 : 3.5;
      for (var i = 0; i < G.cracks.length; i++) {
        var pts = G.cracks[i], n = Math.max(2, Math.ceil(pts.length * u));
        x.beginPath();
        x.moveTo(sx(pts[0][0]), sy(pts[0][1]));
        for (var k = 1; k < n && k < pts.length; k++) x.lineTo(sx(pts[k][0]), sy(pts[k][1]));
        x.stroke();
      }
    }
    x.restore();
  }

  function drawLadder(x) {
    var runMax = G.phase === "attract" ? -1 : G.maxTier;
    for (var t = 0; t <= TOP; t++) {
      var c = ladder[t];
      if (!c) continue;
      var known = t <= 4 || (G.found & (1 << t));
      if (known) {
        if (!ladderImg[t]) ladderImg[t] = GLASS.flat(t, c.r * DPR, -0.3, 0);
        var img = ladderImg[t], hw = img.width / DPR / 2;
        x.globalAlpha = runMax < 0 || t <= runMax ? 1 : 0.42;
        x.drawImage(img, c.x - hw, c.y - hw, hw * 2, hw * 2);
        x.globalAlpha = 1;
        if (t === runMax && runMax > 0) {
          x.strokeStyle = hexA(TIERS[t].glow, 0.8);
          x.lineWidth = 1.5;
          x.beginPath(); x.arc(c.x, c.y, c.r + 3, 0, 6.283); x.stroke();
        }
      } else {
        // not melted yet, ever: a dark blank, the next one breathing a little
        var nextUp = t === nextUnknown();
        var br = nextUp ? 0.5 + 0.5 * Math.sin(G.clock * 2.4) : 0;
        x.fillStyle = "rgba(255,255,255," + (0.035 + br * 0.03).toFixed(3) + ")";
        x.beginPath(); x.arc(c.x, c.y, c.r, 0, 6.283); x.fill();
        x.strokeStyle = "rgba(255,255,255," + (0.16 + br * 0.14).toFixed(3) + ")";
        x.lineWidth = 1;
        x.setLineDash([2, 3]);
        x.beginPath(); x.arc(c.x, c.y, c.r, 0, 6.283); x.stroke();
        x.setLineDash([]);
        x.fillStyle = "rgba(255,255,255," + (0.3 + br * 0.2).toFixed(3) + ")";
        x.font = "600 " + Math.max(8, Math.round(c.r * 0.9)) + "px 'Geist Mono', ui-monospace, monospace";
        x.textAlign = "center"; x.textBaseline = "middle";
        x.fillText("?", c.x, c.y + 0.5);
        x.textBaseline = "alphabetic";
      }
    }
  }

  function nextUnknown() {
    for (var t = 5; t <= TOP; t++) if (!(G.found & (1 << t))) return t;
    return -1;
  }

  function drawPops(x) {
    x.textAlign = "center";
    for (var i = 0; i < FX.pops.length; i++) {
      var p = FX.pops[i], u = p.t / p.max;
      var a = u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3;
      var rise = (1 - Math.pow(1 - u, 2)) * 9;
      var size = Math.round((12 + 3 * s * 0.6) * p.big * (u < 0.12 ? 0.7 + u / 0.12 * 0.3 : 1));
      x.font = "800 " + size + "px Archivo, system-ui, sans-serif";
      x.lineWidth = 3;
      x.strokeStyle = "rgba(10,5,2," + (0.7 * a).toFixed(3) + ")";
      x.strokeText(p.text, sx(p.x), sy(p.y - rise));
      x.fillStyle = "rgba(255,248,236," + a.toFixed(3) + ")";
      x.fillText(p.text, sx(p.x), sy(p.y - rise));
      if (p.sub) {
        x.font = "800 " + Math.round(size * 0.72) + "px Archivo, system-ui, sans-serif";
        x.fillStyle = hexA(p.col, a);
        x.strokeText(p.sub, sx(p.x), sy(p.y - rise) - size * 0.95);
        x.fillText(p.sub, sx(p.x), sy(p.y - rise) - size * 0.95);
      }
    }
  }

  /* ---------------------------------------------------------------- HUD */

  var hudCache = {};
  function setText(k, node, v) { if (hudCache[k] !== v) { hudCache[k] = v; node.textContent = v; } }

  function updateHud() {
    if (G.phase === "attract") return;
    setText("score", el.score, Math.floor(G.shown).toLocaleString());
    var target = G.challenge && !G.beaten;
    setText("bestK", el.bestK, target ? "Target" : "Best");
    var bv = target ? G.challenge.score : Math.max(G.best, G.score);
    setText("best", el.best, bv ? bv.toLocaleString() : "—");
    el.best.classList.toggle("is-target", !!target);
  }

  var nextDrawn = -2;
  function drawNext() {
    var c = el.next, n = Math.round(30 * DPR);
    if (c.width !== n) { c.width = c.height = n; nextDrawn = -2; }
    var t = G.seq.length > G.idx + 1 ? G.seq[G.idx + 1] : -1;
    if (t === nextDrawn) return;
    nextDrawn = t;
    nctx.clearRect(0, 0, n, n);
    if (t < 0) return;
    var r = n * (0.22 + t * 0.06);
    var img = GLASS.flat(t, r, -0.3, 1);
    nctx.drawImage(img, (n - img.width) / 2, (n - img.height) / 2);
  }

  var calloutTimer = null;
  function callout(big, sub, bad, ms) {
    el.calloutBig.textContent = big;
    el.calloutSub.textContent = sub || "";
    el.callout.classList.toggle("is-bad", !!bad);
    el.callout.hidden = false;
    el.callout.classList.remove("is-out");
    el.callout.classList.remove("is-pop");
    void el.callout.offsetWidth;
    el.callout.classList.add("is-pop");
    clearTimeout(calloutTimer);
    calloutTimer = setTimeout(function () {
      el.callout.classList.add("is-out");
      calloutTimer = setTimeout(function () { el.callout.hidden = true; }, 400);
    }, ms || 1200);
  }

  function orbImg(t) {
    try { return GLASS.flat(t, 44 * Math.min(2, DPR), -0.3, 0).toDataURL("image/png"); }
    catch (e) { return ""; }
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
      el.freshBtn.hidden = !G.challenge;
      el.overlay.hidden = false;
      el.overlay.classList.remove("is-out");
      el.hud.hidden = true;
    }, reduceMotion ? 300 : 1400);
  }

  /* -------------------------------------------------------------- share */

  // a square card of the jar as it stood when it overflowed, with the numbers
  function shareCanvas() {
    render();
    var S = 1080, c = document.createElement("canvas");
    c.width = S; c.height = S;
    var x = c.getContext("2d");
    x.fillStyle = "#0a0706"; x.fillRect(0, 0, S, S);
    // crop: the jar from the rim down to the bench, centred
    var top = sy(RIM - 4), bot = sy(JH + BASE + 2);
    var side = Math.max(bot - top, (JW + WALL * 2 + 8) * s);
    var cx = sx(JW / 2), l = cx - side / 2, t = top - (side - (bot - top)) / 2;
    var pad = 60, inner = S - pad * 2;
    x.drawImage(el.canvas, l * DPR, t * DPR, side * DPR, side * DPR, pad + inner * 0.18, pad, inner * 0.82, inner * 0.82);
    var sh = x.createLinearGradient(0, 0, S * 0.5, 0);
    sh.addColorStop(0, "rgba(10,7,6,0.95)"); sh.addColorStop(1, "rgba(10,7,6,0)");
    x.fillStyle = sh; x.fillRect(0, 0, S * 0.55, S);
    x.textAlign = "left";
    x.fillStyle = "#fff6ea";
    x.shadowColor = "rgba(255,150,60,0.8)"; x.shadowBlur = 30;
    x.font = "900 76px Archivo, system-ui, sans-serif";
    x.fillText("MELD", 60, 130);
    x.shadowBlur = 0;
    var orb = GLASS.flat(G.maxTier, 64, -0.3, 0);
    x.drawImage(orb, 60, S - 420, 128, 128);
    x.font = "600 26px 'Geist Mono', ui-monospace, monospace";
    x.fillStyle = hexA(TIERS[G.maxTier].glow, 1);
    x.fillText(TIERS[G.maxTier].name.toUpperCase() + " · CHAIN ×" + Math.max(1, G.chainBest), 62, S - 236);
    x.fillStyle = "#ffffff";
    x.shadowColor = "rgba(0,0,0,0.6)"; x.shadowBlur = 18;
    x.font = "900 132px Archivo, system-ui, sans-serif";
    x.fillText(G.score.toLocaleString(), 54, S - 100);
    x.shadowBlur = 0;
    return c;
  }

  /* -------------------------------------------------------------- input */

  /* A mouse aims by hovering and drops on click: the pointer is tiny, so it
   * never hides the pile. A finger is not tiny, and on a phone the jar fills
   * the screen, so a thumb sat on the target hides it. So a finger works like
   * a trackpad: a DRAG slides the orb by however far the finger moves, from
   * wherever it touched (the orb never jumps to it, and the thumb can stay low,
   * clear of the pile), and lifting drops it. A quick TAP with no drag still
   * drops right where it lands, the way the original plays on a phone.
   * (Owner, 10-01: the phone was "harder to use than the desktop".) */
  var TAP_SLOP = 8;                     // px a finger may wander and still count as a tap
  var pointer = { id: null, down: false, mouse: false, x0: 0, lastX: 0, moved: false };

  function aimAt(clientX) {
    var r = el.canvas.getBoundingClientRect();
    G.aim = (clientX - r.left - ox) / s;
  }
  function aimFrom(e) { aimAt(e.clientX); }

  el.canvas.addEventListener("pointerdown", function (e) {
    if (G.phase !== "play") return;
    AU.unlock();
    pointer.id = e.pointerId; pointer.down = true;
    pointer.mouse = e.pointerType === "mouse";
    pointer.x0 = pointer.lastX = e.clientX; pointer.moved = false;
    try { el.canvas.setPointerCapture(e.pointerId); } catch (err) {}
    if (pointer.mouse) aimFrom(e);
    e.preventDefault();
  });
  el.canvas.addEventListener("pointermove", function (e) {
    if (G.phase !== "play") return;
    if (e.pointerType === "mouse") { aimFrom(e); return; }
    if (!pointer.down || e.pointerId !== pointer.id) return;
    if (!pointer.moved && Math.abs(e.clientX - pointer.x0) > TAP_SLOP) {
      pointer.moved = true;
      pointer.lastX = e.clientX;           // start sliding from here: no jump across the slop
    }
    if (pointer.moved) {
      // incremental and clamped every step, so reversing at a wall moves at once
      var R = RADII[held()];
      G.aim = clamp(G.aim + (e.clientX - pointer.lastX) / s, R, JW - R);
      pointer.lastX = e.clientX;
    }
  });
  function release(e) {
    if (!pointer.down || e.pointerId !== pointer.id) return;
    pointer.down = false;
    if (e.type !== "pointerup" || G.phase !== "play") return;
    // a tap places where the finger came DOWN; a drag has already aimed. Either
    // way the lift itself never moves it: fingertips roll a few px as they leave
    if (pointer.mouse) aimFrom(e);
    else if (!pointer.moved) aimAt(pointer.x0);
    drop();
  }
  el.canvas.addEventListener("pointerup", release);
  el.canvas.addEventListener("pointercancel", release);

  window.addEventListener("keydown", function (e) {
    var k = e.key;
    if (k === "ArrowLeft" || k === "a" || k === "A") { keys.left = true; e.preventDefault(); }
    else if (k === "ArrowRight" || k === "d" || k === "D") { keys.right = true; e.preventDefault(); }
    else if ((k === " " || k === "Enter" || k === "ArrowDown" || k === "s" || k === "S") && G.phase === "play") {
      if (document.activeElement && document.activeElement.tagName === "BUTTON" && k !== "ArrowDown" && k !== "s" && k !== "S") return;
      AU.unlock();
      if (!e.repeat) drop();
      e.preventDefault();
    }
  });
  window.addEventListener("keyup", function (e) {
    var k = e.key;
    if (k === "ArrowLeft" || k === "a" || k === "A") keys.left = false;
    else if (k === "ArrowRight" || k === "d" || k === "D") keys.right = false;
  });
  window.addEventListener("blur", function () { keys.left = keys.right = false; });

  el.ovBtn.addEventListener("click", function () {
    AU.unlock();
    el.overlay.classList.add("is-out");
    setTimeout(function () { el.overlay.hidden = true; }, 260);
    window.OPT_SHARE_IMAGE = null;
    window.OPT_SHARE_LINE = null;
    window.OPT_SHARE_TEXT = null;
    startRun();
    el.ovBtn.blur();
  });

  el.freshBtn.addEventListener("click", function () {
    G.challenge = null;
    history.replaceState(null, "", location.pathname + location.search);
    el.ovBtn.click();
  });

  el.chBtn.addEventListener("click", function () {
    var url = challengeUrl();
    var text = "I scored " + G.score.toLocaleString() + " in Meld. Same drops, same order. Beat it:";
    gtagSafe("share", { method: "challenge_link", content_type: "toy", item_id: "/toys/meld/" });
    if (navigator.share && coarse) {
      navigator.share({ title: "Meld", text: text, url: url }).catch(function () {});
      return;
    }
    var done = function () { el.chBtn.textContent = "Challenge link copied"; setTimeout(function () { el.chBtn.textContent = "Challenge a friend"; }, 1800); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text + " " + url).then(done, function () { window.prompt("Copy this link:", url); });
    } else window.prompt("Copy this link:", url);
  });

  el.musicBtn.addEventListener("click", function () {
    AU.unlock();
    var v = AU.musicToggle();
    el.musicBtn.setAttribute("aria-pressed", v ? "true" : "false");
    store(KEY_MUSIC, v ? "1" : "0");
    gtagSafe("music_toggle", { toy: "meld", on: v });
  });

  el.soundBtn.addEventListener("click", function () {
    AU.unlock();
    var v = AU.toggle();
    el.soundBtn.setAttribute("aria-pressed", v ? "true" : "false");
    store(KEY_SOUND, v ? "1" : "0");
  });

  /* ------------------------------------------------------------ helpers */

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function hexRgb(h) { var n = parseInt(h.slice(1), 16); return (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255); }
  function hexA(h, a) { return "rgba(" + hexRgb(h) + "," + (+a).toFixed(3) + ")"; }
  function store(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); }
    catch (e) { return null; }
  }
  function gtagSafe(n, p) { try { if (typeof gtag === "function") gtag("event", n, p); } catch (e) {} }

  /* --------------------------------------------------------------- loop */

  var last = 0, warned = false;
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    // one throw must never freeze the toy mid-run
    try { update(dt); } catch (e) { if (!warned) { warned = true; try { console.error("update failed:", e); } catch (e2) {} } }
    try { render(); } catch (e) { if (!warned) { warned = true; try { console.error("render failed:", e); } catch (e2) {} } }
    requestAnimationFrame(frame);
  }

  function init() {
    var sv = store(KEY_SOUND);
    var on = sv !== "0";
    AU.init(on);
    el.soundBtn.setAttribute("aria-pressed", on ? "true" : "false");
    var mOn = store(KEY_MUSIC) !== "0";
    AU.musicInit(mOn);
    el.musicBtn.setAttribute("aria-pressed", mOn ? "true" : "false");
    G.best = parseInt(store(KEY_BEST) || "0", 10) || 0;
    G.found = (parseInt(store(KEY_FOUND) || "0", 10) || 0) | 31;

    var m = /c=([0-9a-z]+)-(\d+)(?:-(\d+))?/.exec(location.hash || "");
    if (m) {
      var seed = parseInt(m[1], 36) >>> 0;
      G.challenge = { seed: seed, score: +m[2], tier: Math.min(TOP, +(m[3] || 0)) };
      el.ovEyebrow.textContent = "You've been challenged";
      el.ovText.innerHTML = "<b>A friend scored " + G.challenge.score.toLocaleString() +
        (G.challenge.tier > 4 ? " and melted a " + TIERS[G.challenge.tier].name : "") +
        "</b> with these exact drops, in this order. Beat it.<br /><br />" + el.ovText.innerHTML;
      el.ovBtn.textContent = "Take the challenge";
      gtagSafe("challenge_open", { toy: "meld", value: G.challenge.score });
    }
    if (coarse) {
      el.ovKeys.textContent = "drag anywhere to slide the orb · let go to drop · or tap right where you want it";
      el.hint.textContent = "drag to slide · let go to drop · or tap to place";
    }
    layout();
    seedEmbers();
    attractFill();
    requestAnimationFrame(frame);
    gtagSafe("toy_open", { toy: "meld" });
  }

  var resizeT = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(function () { layout(); seedEmbers(); }, 80);
  });
  window.addEventListener("orientationchange", function () { setTimeout(layout, 150); });

  init();
})();
