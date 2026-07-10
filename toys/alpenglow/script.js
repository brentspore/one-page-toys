/* Alpenglow — an endless trick sandboarder in a living mountain dusk. Canvas 2D, no libs.
 *
 * One input is the whole game: press on snow = jump, press-and-hold in air = backflip
 * (release stops the spin — mastery lives in the release), tap on a rail = hop off.
 * The flywheel: a landed trick banks points AND grants a decaying speed boost (with
 * smash-through invincibility), so score and momentum are one system. Combo rule:
 * everything done while the board never touches plain snow is summed, multiplied by
 * the number of tricks in the chain, and banked only on a clean landing.
 *
 * Terrain = cosine-interpolated random keypoints (zero slope at every crest/trough,
 * analytic slope), forever downhill, streamed as a ring buffer with chasms and
 * bunting-line rails. Art = flat silhouettes under a master sky gradient: full
 * day/night cycle (~8 min) with weather (snowfall, blizzard, thunderstorm, fog,
 * a rare rainbow) as an independent axis. The scarf is a verlet ribbon that grows
 * with your combo — the diegetic speedometer. All audio synthesized. */
(function () {
  "use strict";

  /* ============================ DOM ============================ */
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d");
  const elScore = document.getElementById("score");
  const elDist = document.getElementById("dist");
  const elBest = document.getElementById("best");
  const elChain = document.getElementById("chain");
  const elOverlay = document.getElementById("overlay");
  const elOvTitle = document.getElementById("ovTitle");
  const elOvText = document.getElementById("ovText");
  const elOvBtn = document.getElementById("ovBtn");
  const elHint = document.getElementById("hint");
  const elConfetti = document.getElementById("confetti");
  const soundBtn = document.getElementById("soundBtn");

  const REDMO = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ============================ constants ============================ */
  const G = 1700;                 // px/s²
  const JUMP_VY = 800, JUMP_K = 0.14;
  const ROT_SPEED = 430 * Math.PI / 180;  // backflip rate — a full flip fits a normal jump with margin
  const DRAG_K = 0.42, ROLL_F = 80, MIN_SPEED = 150, SOFT_MAX = 1100;
  const BASE_SLOPE = 12 * Math.PI / 180;
  const MAX_SEG_SLOPE = Math.tan(55 * Math.PI / 180);
  const COYOTE = 0.08, INPUT_BUF = 0.1;
  const CLEAN_BAND = 25 * Math.PI / 180, STUMBLE_BAND = 60 * Math.PI / 180, PERFECT_BAND = 8 * Math.PI / 180;
  const AUTO_LEVEL = 200 * Math.PI / 180;
  const PUMP_SLOPE = 1.35; // (air-dive was cut: hold in air must belong to the flip alone)
  const PX_PER_M = 30;
  const DAY_LEN = 480;            // seconds per full cycle
  const FLIP_PTS = [0, 10, 60, 200, 600, 600];
  const SCARF = "#e5484d";

  /* ============================ helpers ============================ */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function normAng(a) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }

  // hex -> {h,s,l} and palette lerp in HSL (naive RGB lerp passes through dead gray)
  function hexRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    let h;
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (mx === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    return [h, s, l];
  }
  function hslCss(h, s, l) { return "hsl(" + (h * 360).toFixed(1) + "," + (s * 100).toFixed(1) + "%," + (l * 100).toFixed(1) + "%)"; }
  function withAlpha(hslStr, a) { return hslStr.replace("hsl(", "hsla(").replace(")", "," + a + ")"); }
  const hslCache = {};
  function hexHsl(hex) {
    if (!hslCache[hex]) { const c = hexRgb(hex); hslCache[hex] = rgbHsl(c[0], c[1], c[2]); }
    return hslCache[hex];
  }
  function lerpHue(a, b, t) {
    let d = b - a;
    if (d > 0.5) d -= 1; else if (d < -0.5) d += 1;
    let h = a + d * t;
    if (h < 0) h += 1; else if (h > 1) h -= 1;
    return h;
  }
  function mixHex(hexA, hexB, t) {
    const a = hexHsl(hexA), b = hexHsl(hexB);
    return hslCss(lerpHue(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t));
  }
  function mixHsl(a, b, t) { return [lerpHue(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }

  /* ============================ palettes ============================ */
  // Each keyframe: sky stops (top->horizon), parallax ranges far->near, playfield, rim, celestial
  const PAL = {
    dawn: {
      sky: ["#2e3466", "#7a5a8e", "#c96a80", "#f7b16c"],
      far: "#8a6a92", mid: "#5c4a78", near: "#3a2d55",
      playTop: "#262040", playDeep: "#141024", rim: "#f0c8d8", under: "#1a1530",
      sun: "#ffd9a8", glow: "#f7b16c", stars: 0.25, fires: 0.55
    },
    day: {
      sky: ["#91b7a4", "#a8c9ba", "#cfe3d6", "#e6f1e8"],
      far: "#689689", mid: "#55877b", near: "#3f6d5e",
      playTop: "#343f23", playDeep: "#15231a", rim: "#eef6ee", under: "#232d18",
      sun: "#fdf6e3", glow: "#f4ecc8", stars: 0, fires: 0.15
    },
    dusk: {
      sky: ["#3b2d5e", "#8e4a6e", "#d96a5a", "#f2a65a"],
      far: "#7a5378", mid: "#54406b", near: "#352a52",
      playTop: "#241d3d", playDeep: "#120e24", rim: "#ffd9c0", under: "#181230",
      sun: "#ffe0b0", glow: "#f2a65a", stars: 0.3, fires: 0.8
    },
    night: {
      sky: ["#0b1026", "#111834", "#17203e", "#2e4a6b"],
      far: "#1a2742", mid: "#131c33", near: "#0d1526",
      playTop: "#080d1c", playDeep: "#04070f", rim: "#9fb4d8", under: "#060a15",
      sun: "#e8f0ff", glow: "#aebfe0", stars: 1, fires: 1
    },
    storm: {
      sky: ["#37404f", "#485363", "#5a6674", "#6b7684"],
      far: "#4a5462", mid: "#3a434f", near: "#2b323c",
      playTop: "#1a2026", playDeep: "#0d1116", rim: "#b8c4d0", under: "#141a20",
      sun: "#c8d2dc", glow: "#9aa6b2", stars: 0, fires: 0.9
    }
  };
  // day cycle keyframes: [phasePos, palette] — dawn 15% / day 30% / dusk 15% / night 40%
  const DAY_KEYS = [
    [0.000, PAL.night], [0.075, PAL.dawn], [0.30, PAL.day], [0.525, PAL.dusk], [0.78, PAL.night], [1.0, PAL.night]
  ];
  function palLerp(a, b, t, stormK) {
    const out = { sky: [], stars: lerp(a.stars, b.stars, t), fires: lerp(a.fires, b.fires, t) };
    for (let i = 0; i < 4; i++) out.sky.push(blend3(a.sky[i], b.sky[i], t, PAL.storm.sky[i], stormK));
    for (const k of ["far", "mid", "near", "playTop", "playDeep", "rim", "under", "sun", "glow"]) {
      out[k] = blend3(a[k], b[k], t, PAL.storm[k], stormK);
    }
    if (stormK > 0) out.stars *= (1 - stormK);
    return out;
  }
  function blend3(hexA, hexB, t, hexStorm, sk) {
    let h = mixHsl(hexHsl(hexA), hexHsl(hexB), t);
    if (sk > 0) h = mixHsl(h, hexHsl(hexStorm), sk);
    return hslCss(h[0], h[1], h[2]);
  }
  function currentPal(dayT, stormK) {
    let i = 0;
    while (i < DAY_KEYS.length - 2 && dayT > DAY_KEYS[i + 1][0]) i++;
    const t = (dayT - DAY_KEYS[i][0]) / (DAY_KEYS[i + 1][0] - DAY_KEYS[i][0]);
    return palLerp(DAY_KEYS[i][1], DAY_KEYS[i + 1][1], clamp(t, 0, 1), stormK);
  }

  /* ============================ terrain ============================ */
  let segs = [];        // {x0,x1,y0,y1,gap}
  let rails = [];       // {x0,y0,x1,y1,ang,len}
  let decos = [];       // {x,type:'tree'|'rock'|'fire'|'sign',s,smashed,seed}
  let popups = [];      // {x,y,txt,t,big}
  let genX = 0, genY = 0, featIn = 10, totalGen = 0, sExpAvg = 500;

  function segAt(x) {
    let lo = 0, hi = segs.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (segs[m].x1 < x) lo = m + 1; else hi = m; }
    return segs[lo];
  }
  function terrainY(x) {
    const s = segAt(x);
    if (!s) return 1e9;
    const t = clamp((x - s.x0) / (s.x1 - s.x0), 0, 1);
    return (s.y0 + s.y1) / 2 - (s.y1 - s.y0) / 2 * Math.cos(Math.PI * t);
  }
  function terrainAng(x) {
    const s = segAt(x);
    if (!s) return 0;
    const L = s.x1 - s.x0, t = clamp((x - s.x0) / L, 0, 1);
    return Math.atan((s.y1 - s.y0) / 2 * Math.PI * Math.sin(Math.PI * t) / L);
  }
  function inGap(x) { const s = segAt(x); return !!(s && s.gap); }
  const GAP_DEPTH = 620; // how far below the lips the chasm floor sits
  // the ONE physical surface: snow outside gaps; inside a gap, the exact rendered
  // profile — near wall ramp, pit floor, far wall ramp. Nothing passes through it.
  function groundY(x) {
    const s = segAt(x);
    if (!s || !s.gap) return terrainY(x);
    const fy = Math.max(s.y0, s.y1) + GAP_DEPTH;
    const tIn = (x - s.x0) / 60, tOut = (s.x1 - x) / 60;
    if (tIn < 1) return lerp(s.y0, fy, Math.max(0, tIn));
    if (tOut < 1) return lerp(s.y1, fy, Math.max(0, tOut));
    return fy;
  }

  function pushSeg(L, dy, gap) {
    // cosine easing peaks at pi/2 x the mean slope mid-segment, so clamp the MEAN
    // tighter for snow (gaps keep their steep walls); uphills stay shallow kickers,
    // never long stalls
    if (!gap) {
      if (dy > 0.78 * L) dy = 0.78 * L;
      if (dy < -0.42 * L) dy = -0.42 * L;
    } else if (dy > MAX_SEG_SLOPE * L) dy = MAX_SEG_SLOPE * L;
    segs.push({ x0: genX, x1: genX + L, y0: genY, y1: genY + dy, gap: !!gap });
    genX += L; genY += dy; totalGen += L;
  }
  function ampAt() {
    const grow = clamp(totalGen / 30000, 0, 1);
    const base = lerp(lerp(40, 120, Math.random()), lerp(70, 220, Math.random()), grow);
    return base * (1 + 0.4 * Math.sin(totalGen * 0.00009)); // slow breathing: mellow <-> steep
  }
  function plainSeg(bias) {
    const L = rnd(280, 520);
    const dy = L * Math.tan(BASE_SLOPE) + rnd(-1, 1) * ampAt() + (bias || 0);
    pushSeg(L, dy, false);
    decorate(segs[segs.length - 1]);
  }
  function spawnChasm() {
    plainSeg(-30); // gentle approach to the lip
    const sE = clamp(sExpAvg, 450, 1150);
    const gapW = rnd(220, 420) * clamp(sE / 700, 0.8, 1.3);
    const drop = clamp(Math.max(60, G * Math.pow(gapW / (0.8 * sE), 2) / 2), 60, 560);
    decos.push({ x: genX - rnd(260, 340), type: "sign", s: 1, seed: Math.random() });
    pushSeg(gapW, drop, true);
    plainSeg(40); plainSeg(0); // landing runway
  }
  function spawnRail() {
    // 3 descending segments; the rail is a straight chord above the snow.
    // The cosine easing bulges ABOVE the chord mid-segment, so clearance must be
    // checked by dense terrain sampling, not just at the keypoints.
    const xA = genX, yA = genY;
    plainSeg(30); plainSeg(50); plainSeg(30);
    const xB = genX, yB = genY;
    let y0 = yA - 28, y1 = yB - 28;
    if (y1 > y0 + 30) { // must descend (free speed)
      let lift = 0; // y-down: wire must sit at least 24px ABOVE (below in y) the snow
      for (let sx = xA; sx <= xB; sx += 18) {
        const cy = y0 + (sx - xA) / (xB - xA) * (y1 - y0);
        lift = Math.max(lift, cy + 24 - terrainY(sx));
      }
      y0 -= lift; y1 -= lift;
      rails.push({ x0: xA, y0: y0, x1: xB, y1: y1, ang: Math.atan2(y1 - y0, xB - xA), len: Math.hypot(xB - xA, y1 - y0) });
      // keep the landing zone under the wire honest — no rocks or campfires
      for (let i = decos.length - 1; i >= 0; i--) {
        const d = decos[i];
        if ((d.type === "rock" || d.type === "fire") && d.x > xA - 40 && d.x < xB + 120) decos.splice(i, 1);
      }
    }
  }
  function decorate(seg) {
    if (seg.gap || totalGen < 1600) return;
    const r = Math.random();
    if (r < 0.34) { // spruce cluster (pure silhouette decor)
      const n = 1 + (Math.random() * 3 | 0), bx = rnd(seg.x0 + 30, seg.x1 - 30);
      for (let i = 0; i < n; i++) decos.push({ x: bx + i * rnd(24, 44), type: "tree", s: rnd(0.75, 1.5), seed: Math.random() });
      return;
    }
    if (totalGen < 6000) return; // obstacle grace zone: the first ~150m are safe snow
    if (r < 0.45) {
      decos.push({ x: rnd(seg.x0 + 60, seg.x1 - 60), type: "rock", s: rnd(0.8, 1.25), smashed: false, seed: Math.random() });
    } else if (r < 0.52) {
      decos.push({ x: rnd(seg.x0 + 60, seg.x1 - 60), type: "fire", s: 1, smashed: false, seed: Math.random() });
    }
  }
  let forcedFeat = null;
  function pump(needX) {
    while (genX < needX) {
      featIn--;
      if (featIn <= 0) {
        featIn = 8 + (Math.random() * 7 | 0);
        const kind = forcedFeat || (Math.random() < 0.55 ? "chasm" : "rail");
        forcedFeat = null;
        if (kind === "chasm") spawnChasm(); else spawnRail();
      } else plainSeg(0);
    }
    const back = camX - 900;
    while (segs.length > 2 && segs[1].x1 < back) segs.shift();
    while (rails.length && rails[0].x1 < back) rails.shift();
    while (decos.length && decos[0].x < back) decos.shift();
  }

  /* ============================ rider ============================ */
  const R = {
    x: 0, y: 0, s: 320, vx: 0, vy: 0, air: false, ang: 0, spin: 0,
    airRot: 0, prox: false, gapX: false, coyote: 0, buf: -1,
    grind: null, grindD: 0, grindKiss: false, grind60: false,
    squash: 0, imm: 0, crashT: 0, crashCause: ""
  };
  const chain = { sum: 0, n: 0 };
  const boost = { t: 0, dur: 1 };
  let boardFree = null; // the torn-away board while crashing
  let holding = false, mode = "menu", startX = 0, score = 0, banked = 0, shownScore = -1, shownChain = "";
  let best = 0;
  try { best = parseInt(localStorage.getItem("alpenglow_best") || "0", 10) || 0; } catch (e) {}

  let camX = 0, camY = 0, zoom = 1, shake = 0, tGlobal = 0;
  let dayT = 0.36; // late day: the first run rides into the dusk
  let hintShown = true;

  function resetWorld() {
    segs = []; rails = []; decos = []; popups = [];
    chunkCache.clear(); // the render cache belongs to the OLD world
    genX = -1200; genY = 0; featIn = 12; totalGen = 0;
    pushSeg(600, 150, false); // a proper opening slope — no crawling off the line
    pump(2400);
    R.x = 0; R.y = terrainY(0) ; R.s = 480; R.air = false; R.ang = terrainAng(0);
    R.spin = 0; R.grind = null; R.imm = 0; R.crashT = 0; boardFree = null;
    chain.sum = 0; chain.n = 0; boost.t = 0;
    startX = R.x; banked = 0; score = 0; shownScore = -1;
    camX = R.x - 300; camY = R.y - 200; zoom = 1;
  }

  // popups anchor to the SCREEN at spawn — world-anchored text scrolls away
  // faster than anyone can read at riding speed
  function addPopup(wx, wy, txt, big, gold) {
    popups.push({
      sx: clamp((wx - camX) * zoom, 70, W - 70),
      sy: clamp((wy - camY) * zoom, 60, H - 90),
      txt: txt, t: 0, big: !!big, gold: !!gold,
      life: big ? 2.2 : 1.7
    });
  }
  function chainAdd(pts, label, wx, wy, big) {
    chain.sum += pts; chain.n++;
    if (label) addPopup(wx, wy, label + " +" + pts, big, false);
  }
  function airStart() {
    R.airRot = 0; R.prox = false; R.gapX = false; R.air = true; R.airT = 0;
    sndCarve(false); sndWhoosh(300, 1400, 0.08);
  }
  // pending flips (and prox/chasm flags) become chain entries — on rail mount or snow landing
  function commitAirTricks() {
    const flips = Math.floor(R.airRot / (Math.PI * 2));
    if (flips >= 1) {
      const f = Math.min(flips, 5);
      chainAdd(FLIP_PTS[f], flips === 1 ? "Backflip" : "Backflip ×" + flips, R.x, R.y - 70, flips >= 2);
      sndFlipChime(Math.min(chain.n, 8));
    }
    if (R.prox) { chainAdd(300, "Proximity", R.x, R.y - 100, true); }
    if (R.gapX) { chainAdd(50, "Chasm", R.x, R.y - 46, false); }
    R.airRot = 0; R.prox = false; R.gapX = false;
  }
  function bank(perfect) {
    if (chain.n === 0) { if (perfect) {} return; }
    const hot = boost.t > 0; // banking while STILL boosted pays double — keep the streak alive
    const sum = chain.sum + (perfect ? 50 : 0);
    const total = Math.round(sum * chain.n * (hot ? 2 : 1));
    banked += total;
    addPopup(R.x, R.y - 120, (hot ? "HOT ×2  " : "") + (chain.n > 1 ? "×" + chain.n + "  " : "") + total + (perfect ? "  PERFECT" : ""), true, true);
    // the flywheel: banked tricks are speed + smash-through invincibility
    boost.dur = clamp(3 + 0.5 * chain.n, 3, 5);
    boost.t = boost.dur;
    R.s = Math.min(SOFT_MAX * 1.15, R.s * (1 + 0.05 * Math.min(chain.n, 4)));
    sndBank(chain.n);
    chain.sum = 0; chain.n = 0;
  }
  function loseChain() { chain.sum = 0; chain.n = 0; }

  function doJump() {
    if (R.grind) { // hop off the rail
      R.vx = R.s * Math.cos(R.grind.ang); R.vy = R.s * Math.sin(R.grind.ang) - JUMP_VY * 0.8;
      R.grind = null; airStart();
      return;
    }
    if (!R.air || R.coyote > 0) {
      const a = R.air ? terrainAng(R.x) : R.ang;
      R.vx = R.s * Math.cos(a);
      R.vy = R.s * Math.sin(a) - (JUMP_VY + JUMP_K * R.s);
      airStart();
      R.coyote = 0;
      sprayBurst(8, 1);
    }
  }

  function land() {
    const slope = terrainAng(R.x);
    const d = normAng(R.ang - slope);
    const ad = Math.abs(d);
    R.y = terrainY(R.x);
    if (ad <= CLEAN_BAND) {
      commitAirTricks();
      const perfect = ad <= PERFECT_BAND && chain.n > 0;
      // the swoop: project air velocity onto the slope tangent — diving becomes speed
      R.s = clamp(R.vx * Math.cos(slope) + R.vy * Math.sin(slope), MIN_SPEED, SOFT_MAX * 1.15);
      R.air = false; R.ang = slope; R.spin = 0; R.squash = 1;
      bank(perfect);
      sndLand(Math.min(1, Math.abs(R.vy) / 900));
      sndCarve(true);
      sprayBurst(16, 1.4);
    } else if (ad <= STUMBLE_BAND) {
      commitAirTricks(); loseChain();
      R.s = Math.max(MIN_SPEED, (R.vx * Math.cos(slope) + R.vy * Math.sin(slope)) * 0.55);
      R.air = false; R.ang = slope; R.spin = 0; R.squash = 1; R.imm = 0.5;
      shake = REDMO ? 0 : 0.45;
      addPopup(R.x, R.y - 60, "stumble", false, false);
      sndLand(1); sndCarve(true);
      sprayBurst(22, 1.8);
    } else if (mode === "menu") {
      // the attract rider never dies — just scrub the landing
      R.s = Math.max(MIN_SPEED, R.s * 0.6);
      R.air = false; R.ang = slope; R.spin = 0; loseChain();
    } else {
      crash("landing");
    }
  }

  function crash(cause) {
    if (R.imm > 0 || boost.t > 0 && (cause === "rock" || cause === "fire")) return;
    if (mode !== "riding") return;
    mode = "crashed"; R.crashT = 0; R.crashCause = cause;
    loseChain();
    R.air = true;
    R.vx = R.s * 0.4; R.vy = -240;
    R.spin = rnd(6, 10) * (Math.random() < 0.5 ? -1 : 1);
    // the board tears away and tumbles on its own
    boardFree = { x: R.x, y: R.y - 4, vx: R.s * rnd(0.55, 0.8), vy: rnd(-420, -260), ang: R.ang, spin: rnd(7, 14) * (Math.random() < 0.5 ? -1 : 1) };
    shake = REDMO ? 0 : 1;
    sprayBurst(30, 2.2);
    sndCrash();
  }

  function stepRider(dt) {
    if (R.imm > 0) R.imm -= dt;
    if (R.coyote > 0) R.coyote -= dt;
    if (R.buf >= 0) { R.buf -= dt; }
    if (boost.t > 0) boost.t -= dt;

    if (R.grind) {
      const g = R.grind;
      R.s += G * Math.sin(g.ang) * dt;
      R.x += R.s * Math.cos(g.ang) * dt;
      R.y = g.y0 + (R.x - g.x0) * Math.tan(g.ang);
      R.ang = g.ang;
      const dM = R.s * dt / PX_PER_M;
      R.grindD += dM;
      chain.sum += 10 * dM; // 10/m ticks
      if (!R.grind60 && R.grindD >= 60) { R.grind60 = true; chainAdd(300, "60m grind", R.x, R.y - 60, true); }
      if (Math.random() < dt * 30) sparkAt(R.x, R.y + 3);
      if (R.x >= g.x1) { // ride off the end
        R.vx = R.s * Math.cos(g.ang); R.vy = R.s * Math.sin(g.ang);
        R.grind = null; airStart();
      }
      return;
    }

    if (!R.air) {
      const a = terrainAng(R.x);
      R.ang = a;
      const pumpK = holding && a > 0 ? PUMP_SLOPE : 1;
      let acc = G * Math.sin(a) * pumpK - DRAG_K * R.s - ROLL_F;
      if (boost.t > 0) acc += 300 * (boost.t / boost.dur);
      const ceil = SOFT_MAX * (boost.t > 0 ? 1.25 : 1); // flips buy the top gears
      if (R.s > ceil) acc -= (R.s - ceil) * 1.6;
      R.s = Math.max(MIN_SPEED, R.s + acc * dt);
      const nx = R.x + R.s * Math.cos(a) * dt;
      // derived pop-off: does the terrain fall away from the ballistic path?
      const ballY = R.y + R.s * Math.sin(a) * dt;
      const ty = terrainY(nx);
      R.x = nx;
      if (inGap(nx) || ty - ballY > 1.5) {
        R.vx = R.s * Math.cos(a); R.vy = R.s * Math.sin(a);
        airStart(); R.coyote = COYOTE;
        R.y = ballY;
      } else {
        R.y = ty;
        // ground obstacles: smash through when boosted, otherwise it's a crash;
        // trees splinter at speed or boost, and only rustle when clipped slowly
        for (const o of decos) {
          if (o.smashed) continue;
          if (o.type === "tree") {
            if (Math.abs(o.x - R.x) < 15) {
              if (boost.t > 0 || R.imm > 0 || R.s > 700) {
                o.smashed = true;
                banked += 15;
                addPopup(o.x, R.y - 56, "+15", false, false);
                treeBurst(o.x, R.y, o.s);
                shake = Math.max(shake, REDMO ? 0 : 0.18);
                R.s = Math.max(MIN_SPEED, R.s * 0.97);
                sndTree(true);
              } else if (!o.brushed) {
                o.brushed = true; o.wob = 1;
                treeShed(o.x, R.y, o.s);
                R.s = Math.max(MIN_SPEED, R.s * 0.93);
                sndTree(false);
              }
            }
            continue;
          }
          if (o.type !== "rock" && o.type !== "fire") continue;
          if (Math.abs(o.x - R.x) < 20) {
            if (boost.t > 0 || R.imm > 0) {
              o.smashed = true;
              const pts = o.type === "rock" ? 50 : 100;
              banked += pts;
              addPopup(o.x, R.y - 50, "smash +" + pts, false, false);
              smashBurst(o.x, R.y, o.type);
              sndSmash(o.type);
            } else crash(o.type);
          }
        }
      }
      if (R.squash > 0) R.squash = Math.max(0, R.squash - dt * 6.6);
      if (R.s > 250 && !R.air) spray(dt);
    } else {
      // airborne
      R.airT += dt;
      R.vy += G * dt;
      R.x += R.vx * dt;
      R.y += R.vy * dt;
      if (mode === "riding") {
        if (holding) { R.ang -= ROT_SPEED * dt; R.airRot += ROT_SPEED * dt; R.spin = -ROT_SPEED; }
        else if (R.spin !== 0) { R.spin *= Math.pow(0.001, dt / 0.08); if (Math.abs(R.spin) < 0.2) R.spin = 0; R.ang += R.spin * dt; }
        // proximity flip: inverted with your head skimming the snow
        const inv = Math.abs(normAng(R.ang)) > Math.PI * 0.66;
        if (inv && terrainY(R.x) - R.y < 54 && !inGap(R.x)) R.prox = true;
        if (inGap(R.x)) R.gapX = true;
        // auto-level assist: only while released and about to land
        if (!holding && R.spin === 0) {
          const tl = predictLanding();
          if (tl >= 0 && tl < 0.45) {
            const target = terrainAng(R.x + R.vx * tl);
            const d = normAng(target - R.ang);
            const step = AUTO_LEVEL * dt;
            R.ang += clamp(d, -step, step);
          }
        }
        // rail mount: from the air, descending, close — deliberately no angle requirement
        if (R.vy >= -40) {
          for (const rl of rails) {
            if (R.x < rl.x0 || R.x > rl.x1) continue;
            const ry = rl.y0 + (R.x - rl.x0) * Math.tan(rl.ang);
            if (Math.abs(R.y - ry) < 16) {
              commitAirTricks();
              R.grind = rl; R.grindD = 0; R.grind60 = false;
              R.s = Math.max(MIN_SPEED, R.vx * Math.cos(rl.ang) + R.vy * Math.sin(rl.ang));
              R.y = ry; R.ang = rl.ang; R.spin = 0;
              chain.n++; // the grind itself is a trick in the chain
              if (rl.x1 - R.x < 90) chainAdd(250, "Kiss the rail", R.x, R.y - 60, true);
              break;
            }
          }
        }
      }
      // touch down — the rendered surface IS the physical one, chasm walls and
      // floor included; a short grace window covers the frames right after takeoff
      const s0 = segAt(R.x);
      const gy = groundY(R.x);
      if (R.y >= gy - 0.5) {
        if (s0 && s0.gap) {
          const nearW = R.x - s0.x0 < 62, farW = s0.x1 - R.x < 62;
          if (farW || nearW) {
            // smack the chasm wall: knock back off the face, shake, keep falling
            if (farW) { R.x = s0.x1 - 70; R.vx = -clamp(Math.abs(R.vx) * 0.22, 60, 160); }
            else { R.x = s0.x0 + 70; R.vx = 40; }
            R.y = Math.max(R.y, s0.y0 + 40); // never re-emerge above the lip
            if (R.vy < 0) R.vy = 0;
            R.spin = rnd(-4, 4);
            shake = Math.max(shake, REDMO ? 0 : 0.55);
            sprayBurst(16, 1.6);
            sndLand(1);
          } else if (mode === "riding") { // the pit floor ends the run
            R.y = gy - 2;
            sprayBurst(24, 2);
            crash("chasm");
          } else { R.y = gy - 2; R.vy = 0; }
        } else if (R.y - gy > 30) { // safety net: crossed a lip underground
          R.x = s0.x0 - 66; R.vx = -60;
          if (R.vy < 0) R.vy = 0;
        } else if (R.airT < 0.06 && R.vy < 0) R.y = Math.min(R.y, gy - 0.5);
        else if (mode === "riding") land();
        else { R.y = gy; R.vy = -Math.abs(R.vy) * 0.3; R.vx *= 0.6; sprayBurst(10, 1.5); } // crashed tumble bounces
      }
    }
  }
  function predictLanding() {
    // ~10 analytic 50ms steps against the real surface
    let x = R.x, y = R.y, vy = R.vy;
    for (let i = 1; i <= 10; i++) {
      vy += G * 0.05; x += R.vx * 0.05; y += vy * 0.05;
      if (y >= groundY(x)) return i * 0.05;
    }
    return -1;
  }

  /* ============================ scarf (verlet ribbon) ============================ */
  const SCARF_N = 24;
  const scarf = [];
  for (let i = 0; i < SCARF_N; i++) scarf.push({ x: 0, y: 0, px: 0, py: 0 });
  let scarfLen = 8;
  function stepScarf(dt, nx, ny) {
    const target = 8 + Math.min(14, chain.n * 3 + (R.s / SOFT_MAX) * 6 + (boost.t > 0 ? 3 : 0));
    scarfLen = lerp(scarfLen, target, Math.min(1, dt * 2));
    const seg = 4.2;
    scarf[0].x = nx; scarf[0].y = ny;
    const windX = -R.s * 0.24 * Math.cos(R.air ? 0 : R.ang) + wind.gust * 40;
    for (let i = 1; i < SCARF_N; i++) {
      const p = scarf[i];
      const vx = (p.x - p.px) * 0.94 + windX * dt * 0.4;
      const vy = (p.y - p.py) * 0.94 + (54 - Math.abs(windX) * 0.12) * dt;
      p.px = p.x; p.py = p.y;
      p.x += vx; p.y += vy;
    }
    for (let it = 0; it < 3; it++) {
      for (let i = 1; i < SCARF_N; i++) {
        const a = scarf[i - 1], b = scarf[i];
        let dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        const diff = (d - seg) / d;
        if (i === 1) { b.x -= dx * diff; b.y -= dy * diff; }
        else { b.x -= dx * diff * 0.85; b.y -= dy * diff * 0.85; a.x += dx * diff * 0.15; a.y += dy * diff * 0.15; }
      }
    }
  }

  /* ============================ particles ============================ */
  const sprays = [];   // snow spray at the board
  const bursts = [];   // smash debris / landing puffs
  const sparks = [];   // grind sparks
  const flakes = [];   // weather: snow (3 depths)
  const drops = [];    // weather: rain
  function spray(dt) {
    if (REDMO) return;
    const n = Math.min(3, Math.floor(R.s * dt * 0.02) + 1);
    for (let i = 0; i < n && sprays.length < 120; i++) {
      sprays.push({ x: R.x - 14, y: R.y + 2, vx: -R.s * rnd(0.15, 0.4), vy: -rnd(30, 140), life: rnd(0.3, 0.6), r: rnd(1.4, 3.2) });
    }
  }
  function sprayBurst(n, sp) {
    if (REDMO) n = Math.min(6, n);
    for (let i = 0; i < n && sprays.length < 160; i++) {
      sprays.push({ x: R.x + rnd(-16, 16), y: R.y + rnd(-4, 4), vx: rnd(-160, 60) * sp, vy: -rnd(60, 260) * sp, life: rnd(0.35, 0.8), r: rnd(1.6, 3.6) });
    }
  }
  function treeBurst(x, y, s) {
    const n = REDMO ? 10 : 22;
    for (let i = 0; i < n; i++) {
      const dark = Math.random() < 0.6;
      bursts.push({
        x: x + rnd(-8, 8) * s, y: y - rnd(6, 44) * s,
        vx: rnd(-160, 340), vy: rnd(-420, -80),
        life: rnd(0.45, 1), r: rnd(2, 4.5),
        col: dark ? "#1d2b22" : "#eef6ee", glow: false
      });
    }
  }
  function treeShed(x, y, s) {
    for (let i = 0; i < (REDMO ? 4 : 9); i++) {
      bursts.push({
        x: x + rnd(-10, 10) * s, y: y - rnd(12, 46) * s,
        vx: rnd(-40, 120), vy: rnd(-120, 20),
        life: rnd(0.4, 0.8), r: rnd(1.5, 3),
        col: Math.random() < 0.5 ? "#22322a" : "#eef6ee", glow: false
      });
    }
  }
  function smashBurst(x, y, type) {
    const col = type === "rock" ? "#6a7280" : "#ff9a4a";
    for (let i = 0; i < (REDMO ? 8 : 18); i++) {
      bursts.push({ x: x, y: y - 10, vx: rnd(-220, 320), vy: rnd(-380, -60), life: rnd(0.4, 0.9), r: rnd(2, 4.5), col: col, glow: type === "fire" });
    }
  }
  function sparkAt(x, y) {
    if (sparks.length > 60) return;
    sparks.push({ x: x, y: y, vx: rnd(-140, -40), vy: rnd(-120, -20), life: rnd(0.2, 0.45), r: rnd(1, 2) });
  }
  function stepParticles(arr, dt, grav) {
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      p.life -= dt;
      if (p.life <= 0) { arr.splice(i, 1); continue; }
      p.vy += grav * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    }
  }

  /* ============================ weather ============================ */
  const weather = { kind: "clear", k: 0, target: 0, next: rnd(20, 40), flash: 0, thunderIn: -1, rainbow: 0 };
  const wind = { gust: 0, t: 0 };
  // aurora borealis: a rare, slow gift on clear nights
  const aurora = { on: false, k: 0, dur: 0 };
  const AUR_CURTAINS = [
    { tint: [110, 255, 170], off: 0.06, f: 0.0042, f2: 0.0013, spd: 0.055, ph: 0.8, amp: 1 },
    { tint: [70, 230, 210], off: 0.13, f: 0.0031, f2: 0.0017, spd: 0.04, ph: 3.1, amp: 0.8 },
    { tint: [150, 120, 255], off: 0.02, f: 0.0052, f2: 0.001, spd: 0.07, ph: 5.4, amp: 0.55 }
  ];
  function stepAurora(dt) {
    const nightClear = currentStars > 0.7 && weather.k < 0.3;
    if (aurora.on) {
      aurora.dur -= dt;
      if (aurora.dur <= 0 || !nightClear) aurora.on = false;
    } else if (nightClear && Math.random() < dt / 240) { // ~every other night
      aurora.on = true;
      aurora.dur = rnd(55, 110);
    }
    aurora.k += clamp((aurora.on ? 1 : 0) - aurora.k, -dt / 14, dt / 14); // slow breaths in and out
  }
  function stepWeather(dt) {
    weather.next -= dt;
    if (weather.next <= 0) {
      const r = Math.random();
      const prev = weather.kind;
      weather.kind = r < 0.34 ? "clear" : r < 0.58 ? "snow" : r < 0.72 ? "fog" : r < 0.85 ? "blizzard" : "storm";
      weather.next = rnd(45, 100);
      weather.target = weather.kind === "clear" ? 0 : rnd(0.6, 1);
      if (prev === "storm" && weather.kind === "clear" && Math.random() < 0.35) weather.rainbow = 22; // rare, after rain
    }
    const goal = weather.kind === "clear" ? 0 : weather.target;
    weather.k += clamp(goal - weather.k, -dt / 8, dt / 8);
    if (weather.rainbow > 0) weather.rainbow -= dt;

    wind.t += dt;
    const gustGoal = (weather.kind === "blizzard" ? 1.6 : weather.kind === "storm" ? 1.1 : 0.25) * weather.k * (0.6 + 0.4 * Math.sin(wind.t * 0.7) * Math.sin(wind.t * 0.23));
    wind.gust = lerp(wind.gust, gustGoal, Math.min(1, dt * 1.5));

    // storm flash + delayed thunder (never over the quiet end screen)
    if (weather.kind === "storm" && weather.k > 0.4 && !REDMO && mode !== "dead" && Math.random() < dt * 0.09) {
      weather.flash = 0.3;
      weather.thunderIn = rnd(0.08, 0.2) + rnd(0, 1.2);
    }
    if (weather.flash > 0) weather.flash -= dt;
    if (weather.thunderIn > 0) { weather.thunderIn -= dt; if (weather.thunderIn <= 0) sndThunder(); }

    // spawn precipitation (pre-seed across the sky so a fresh snowfall fills the frame fast)
    const snowy = weather.kind === "snow" || weather.kind === "blizzard";
    if (snowy && weather.k > 0.05) {
      const cap = REDMO ? 150 : 420;
      const rate = (weather.kind === "blizzard" ? 200 : 90) * weather.k * (REDMO ? 0.35 : 1);
      const seeding = flakes.length < cap * 0.4 * weather.k;
      for (let i = 0; i < (seeding ? 14 : rate * dt); i++) {
        if (flakes.length > cap) break;
        const depth = [0.35, 0.65, 1.05][(Math.random() * 3) | 0];
        flakes.push({
          sx: Math.random() * W * 1.4 - W * 0.2, sy: seeding ? Math.random() * H : -12,
          d: depth, vy: rnd(95, 175) * depth, wob: rnd(0, 6.28), r: depth * rnd(1.2, 2.6)
        });
      }
    }
    if (weather.kind === "storm" && weather.k > 0.05) {
      const rate = 230 * weather.k * (REDMO ? 0.3 : 1);
      for (let i = 0; i < rate * dt; i++) {
        if (drops.length > 340) break;
        const depth = rnd(0.5, 1.1);
        drops.push({ sx: Math.random() * W * 1.5 - W * 0.25, sy: -14, d: depth, vy: rnd(680, 920) * depth });
      }
    }
    for (let i = flakes.length - 1; i >= 0; i--) {
      const f = flakes[i];
      f.wob += dt * 2;
      f.sx += (Math.sin(f.wob) * 14 - R.s * 0.14 * f.d - wind.gust * 240 * f.d) * dt;
      f.sy += f.vy * dt;
      if (f.sy > H + 14 || f.sx < -W * 0.3) flakes.splice(i, 1);
    }
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.sx -= (R.s * 0.16 + 260) * d.d * dt;
      d.sy += d.vy * dt;
      if (d.sy > H + 14) drops.splice(i, 1);
    }
  }

  /* ============================ parallax ridges ============================ */
  function makeRidge(seed, amp, n) {
    const pts = [];
    let y = 0;
    let s = seed;
    const rand = function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
    for (let i = 0; i < n; i++) pts.push(rand());
    return { pts: pts, amp: amp, period: 7600, n: n };
  }
  const ridges = [
    { r: makeRidge(133, 120, 22), f: 0.10, base: 0.50 },
    { r: makeRidge(547, 170, 18), f: 0.25, base: 0.58 },
    { r: makeRidge(919, 230, 14), f: 0.5, base: 0.70 }
  ];
  function ridgeY(r, wx) {
    const p = ((wx % r.period) + r.period) % r.period;
    const fi = p / r.period * r.n;
    const i0 = Math.floor(fi) % r.n, i1 = (i0 + 1) % r.n, t = fi - Math.floor(fi);
    const c = (1 - Math.cos(Math.PI * t)) / 2;
    return (lerp(r.pts[i0], r.pts[i1], c) - 0.5) * 2 * r.amp;
  }

  /* ============================ stars ============================ */
  const stars = [];
  for (let i = 0; i < 130; i++) stars.push({ fx: Math.random(), fy: Math.random() * 0.62, r: rnd(0.5, 1.6), tw: rnd(0.5, 2), ph: rnd(0, 6.28) });
  let shootT = rnd(6, 18), shoot = null;

  /* ambient life: boost speed-trail, snow glints, a distant bird flock */
  const trail = [];
  const glints = [];
  let glintT = 0, birds = null, birdT = rnd(25, 50);
  function stepAmbient(dt) {
    if (boost.t > 0 && mode === "riding") {
      trail.push({ x: R.x, y: R.y - 8 });
      while (trail.length > 26) trail.shift();
    } else if (trail.length) trail.splice(0, 2);
    glintT -= dt;
    if (glintT <= 0 && weather.k < 0.5 && !REDMO) {
      glintT = 0.12;
      if (glints.length < 14) {
        const gx = camX + rnd(0.05, 0.95) * (W / zoom);
        const s = segAt(gx);
        if (s && !s.gap) glints.push({ x: gx, y: terrainY(gx) - 1, t: 0, life: rnd(0.4, 0.75) });
      }
    }
    for (let i = glints.length - 1; i >= 0; i--) { glints[i].t += dt; if (glints[i].t > glints[i].life) glints.splice(i, 1); }
    birdT -= dt;
    if (!birds && birdT <= 0 && currentStars < 0.25 && weather.k < 0.4) {
      birds = { sx: W + 50, sy: H * rnd(0.14, 0.34), n: 3 + (Math.random() * 3 | 0), spd: rnd(24, 40), ph: rnd(0, 6) };
    }
    if (birds) {
      birds.sx -= (birds.spd + R.s * 0.035) * dt;
      if (birds.sx < -birds.n * 16 - 60) { birds = null; birdT = rnd(45, 90); }
    }
  }

  /* ============================ terrain chunks (Path2D cache) ============================ */
  const CHUNK = 1024;
  const chunkCache = new Map();
  function chunkFor(ci) {
    let c = chunkCache.get(ci);
    if (c) return c;
    const x0 = ci * CHUNK, x1 = x0 + CHUNK;
    const path = new Path2D();
    const tops = []; // [x, y, gap] polyline for the rim
    let minY = 1e9;
    path.moveTo(x0, terrainY(x0));
    for (let x = x0; x <= x1 + 8; x += 16) {
      const s = segAt(x);
      const gap = !!(s && s.gap);
      const y = groundY(x); // render exactly what the physics collides with
      path.lineTo(x, y);
      tops.push([x, y, gap]);
      if (y < minY) minY = y;
    }
    path.lineTo(x1 + 8, minY + 4000);
    path.lineTo(x0, minY + 4000);
    path.closePath();
    c = { path: path, tops: tops, minY: minY };
    chunkCache.set(ci, c);
    if (chunkCache.size > 24) { // drop the oldest
      const first = chunkCache.keys().next().value;
      chunkCache.delete(first);
    }
    return c;
  }

  /* ============================ audio ============================ */
  let AC = null, outGain = null, comp = null, masterLP = null;
  let busMusic = null, busWorld = null, busSfx = null, verbSend = null, dlySend = null;
  let padNodes = null, carveNodes = null, windNodes = null, grindNodes = null, rainNodes = null;
  const mel = { next: 2, idx: 5 };
  let soundOn = true;
  try { soundOn = localStorage.getItem("alpenglow_sound") !== "off"; } catch (e) {}

  function makeImpulse(ctx2, secs, decay) {
    const rate = ctx2.sampleRate, len = Math.floor(secs * rate), imp = ctx2.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = imp.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const w = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
        lp += (w - lp) * 0.2;
        d[i] = lp;
      }
    }
    return imp;
  }
  function noiseBuf(secs, pinkish) {
    const len = Math.floor(AC.sampleRate * secs), b = AC.createBuffer(1, len, AC.sampleRate), d = b.getChannelData(0);
    let l = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (pinkish) { l += (w - l) * 0.08; d[i] = l * 4; } else d[i] = w;
    }
    return b;
  }
  function midiF(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function ensureAudio() {
    if (AC) { if (AC.state === "suspended") AC.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    AC = new Ctx();
    try {
      const b = AC.createBuffer(1, 1, 22050), s = AC.createBufferSource();
      s.buffer = b; s.connect(AC.destination); s.start(0); // iOS unlock
    } catch (e) {}
    outGain = AC.createGain(); outGain.gain.value = soundOn ? 0.9 : 0;
    comp = AC.createDynamicsCompressor();
    comp.threshold.value = -15; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.26;
    masterLP = AC.createBiquadFilter(); masterLP.type = "lowpass"; masterLP.frequency.value = 11000;
    comp.connect(masterLP); masterLP.connect(outGain); outGain.connect(AC.destination);

    const verb = AC.createConvolver(); verb.buffer = makeImpulse(AC, 4, 2.8);
    const verbGain = AC.createGain(); verbGain.gain.value = 0.4;
    verbSend = AC.createGain(); verbSend.gain.value = 1;
    verbSend.connect(verb); verb.connect(verbGain); verbGain.connect(comp);
    const dly = AC.createDelay(1); dly.delayTime.value = 0.35;
    const fb = AC.createGain(); fb.gain.value = 0.3;
    dly.connect(fb); fb.connect(dly);
    dlySend = AC.createGain(); dlySend.gain.value = 1;
    dlySend.connect(dly); dly.connect(comp); dly.connect(verbSend); // repeats bloom into the hall
    busMusic = AC.createGain(); busMusic.gain.value = 0.9;
    busWorld = AC.createGain(); busWorld.gain.value = 1;
    busSfx = AC.createGain(); busSfx.gain.value = 1;
    busMusic.connect(comp); busWorld.connect(comp); busSfx.connect(comp);

    // ------- pad: root + fifth + detuned octave + a ninth gated by daylight -------
    const padG = AC.createGain(); padG.gain.value = 0;
    const padLP = AC.createBiquadFilter(); padLP.type = "lowpass"; padLP.frequency.value = 1400; padLP.Q.value = 0.4;
    padLP.connect(padG); padG.connect(busMusic);
    const pv = AC.createGain(); pv.gain.value = 0.5; padG.connect(pv); pv.connect(verbSend);
    const mk = function (f, type, g, det) {
      const o = AC.createOscillator(); o.type = type; o.frequency.value = f;
      if (det) o.detune.value = det;
      const og = AC.createGain(); og.gain.value = g;
      o.connect(og); og.connect(padLP); o.start();
      return og;
    };
    mk(110, "sine", 0.5); mk(164.81, "sine", 0.3); mk(220, "triangle", 0.2, 4);
    const ninth = mk(246.94, "sine", 0);
    const lfo = AC.createOscillator(); lfo.frequency.value = 0.06;
    const lfoG = AC.createGain(); lfoG.gain.value = 0.02;
    lfo.connect(lfoG); lfoG.connect(padG.gain); lfo.start();
    padNodes = { g: padG, lp: padLP, ninth: ninth, lfoG: lfoG };

    // ------- carve bed: pink noise, cutoff follows speed -------
    const cn = AC.createBufferSource(); cn.buffer = noiseBuf(2, true); cn.loop = true;
    const cbp = AC.createBiquadFilter(); cbp.type = "bandpass"; cbp.frequency.value = 500; cbp.Q.value = 0.9;
    const cg = AC.createGain(); cg.gain.value = 0;
    cn.connect(cbp); cbp.connect(cg); cg.connect(busWorld); cn.start();
    carveNodes = { g: cg, f: cbp };

    // ------- wind: body + whistle, random-walked, gusts -------
    const wn = AC.createBufferSource(); wn.buffer = noiseBuf(3, true); wn.loop = true;
    const wlp = AC.createBiquadFilter(); wlp.type = "lowpass"; wlp.frequency.value = 250;
    const wg = AC.createGain(); wg.gain.value = 0.015;
    wn.connect(wlp); wlp.connect(wg); wg.connect(busWorld); wn.start();
    const wn2 = AC.createBufferSource(); wn2.buffer = noiseBuf(3, false); wn2.loop = true;
    const wbp = AC.createBiquadFilter(); wbp.type = "bandpass"; wbp.frequency.value = 900; wbp.Q.value = 2.4;
    const wg2 = AC.createGain(); wg2.gain.value = 0.004;
    wn2.connect(wbp); wbp.connect(wg2); wg2.connect(busWorld); wn2.start();
    windNodes = { body: wg, whistle: wg2, bp: wbp };

    // ------- grind hum: comb filter (level follows R.grind in updateAudio) -------
    const gn = AC.createBufferSource(); gn.buffer = noiseBuf(1.4, false); gn.loop = true;
    const gbp = AC.createBiquadFilter(); gbp.type = "bandpass"; gbp.frequency.value = 1400; gbp.Q.value = 1;
    const gdl = AC.createDelay(0.05); gdl.delayTime.value = 0.0045;
    const gfb = AC.createGain(); gfb.gain.value = 0.85;
    const gg = AC.createGain(); gg.gain.value = 0;
    gn.connect(gbp); gbp.connect(gdl); gdl.connect(gfb); gfb.connect(gdl); gdl.connect(gg);
    gg.connect(busWorld); gn.start();
    grindNodes = { g: gg };

    // ------- rain bed -------
    const rn = AC.createBufferSource(); rn.buffer = noiseBuf(2.4, false); rn.loop = true;
    const rlp = AC.createBiquadFilter(); rlp.type = "lowpass"; rlp.frequency.value = 3200;
    const rhp = AC.createBiquadFilter(); rhp.type = "highpass"; rhp.frequency.value = 700;
    const rg = AC.createGain(); rg.gain.value = 0;
    rn.connect(rhp); rhp.connect(rlp); rlp.connect(rg); rg.connect(busWorld); rn.start();
    rainNodes = { g: rg };
  }

  // struck piano-ish voice (Vapor's recipe: fundamental + detuned + soft partials, long decay)
  function voiceNote(midi, vel, pan2) {
    if (!AC || !soundOn) return;
    const f = midiF(midi), t = AC.currentTime;
    const g = AC.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16 * vel, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.4);
    let outNode = g;
    if (AC.createStereoPanner) { const p = AC.createStereoPanner(); p.pan.value = clamp(pan2, -1, 1); g.connect(p); outNode = p; }
    outNode.connect(busMusic);
    const vs = AC.createGain(); vs.gain.value = 0.7; outNode.connect(vs); vs.connect(verbSend);
    const ds = AC.createGain(); ds.gain.value = 0.25; outNode.connect(ds); ds.connect(dlySend);
    const parts = [[1, 0.6, "sine"], [1.004, 0.42, "triangle"], [2, 0.12, "sine"], [3, 0.04, "sine"]];
    for (const pr of parts) {
      const o = AC.createOscillator(); o.type = pr[2]; o.frequency.value = f * pr[0];
      const og = AC.createGain(); og.gain.value = pr[1];
      o.connect(og); og.connect(g); o.start(t); o.stop(t + 3.6);
    }
  }
  // generative melody — sparse pentatonic random walk pulled toward a drifting contour
  function melodyTick(dt) {
    if (!AC || !soundOn || mode === "dead") return;
    mel.next -= dt;
    if (mel.next > 0) return;
    const spd = clamp(R.s / SOFT_MAX, 0, 1);
    mel.next = lerp(6, 2.8, spd) + (Math.random() - 0.3) * 1.6;
    if (Math.random() < 0.3) return; // breathe
    const pent = [0, 2, 4, 7, 9];
    const ladder = pent.concat(pent.map(function (d) { return d + 12; })).concat([24]);
    const night = dayNight() > 0.5;
    const rootM = night ? 45 : 57; // darker register after dark
    const center = Math.round((0.5 + 0.32 * Math.sin(tGlobal * 0.05)) * (ladder.length - 1));
    const stepPool = [-2, -1, -1, 0, 1, 1, 2];
    mel.idx += stepPool[(Math.random() * stepPool.length) | 0];
    if (mel.idx < center && Math.random() < 0.4) mel.idx += 1;
    else if (mel.idx > center && Math.random() < 0.4) mel.idx -= 1;
    if (Math.random() < 0.08) mel.idx += Math.random() < 0.5 ? -3 : 3;
    mel.idx = clamp(mel.idx, 0, ladder.length - 1);
    voiceNote(rootM + 12 + ladder[mel.idx], 0.4 + Math.random() * 0.2, Math.sin(tGlobal * 0.7) * 0.4);
    if (Math.random() < 0.2) voiceNote(rootM + 12 + ladder[Math.max(0, mel.idx - 2)], 0.22, -0.2);
  }
  function dayNight() { // 0 = day, 1 = deep night
    return clamp((currentStars || 0), 0, 1);
  }
  let currentStars = 0;

  function sndCarve(on) {
    if (!carveNodes) return;
    const t = AC.currentTime;
    if (!on) carveNodes.g.gain.setTargetAtTime(0, t, 0.04); // killed on takeoff...
    // ...restored each frame in updateAudio when grounded (that restore IS the landing reward)
  }
  function sndWhoosh(f0, f1, g0) {
    if (!AC || !soundOn) return;
    const t = AC.currentTime;
    const s = AC.createBufferSource(); s.buffer = noiseBuf(0.4, true);
    const bp = AC.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + 0.28);
    const g = AC.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(g0, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0006, t + 0.34);
    s.connect(bp); bp.connect(g); g.connect(busSfx); s.start(t); s.stop(t + 0.4);
  }
  let flipN = 0, flipResetT = 0;
  function sndFlipChime() {
    // rotation whoosh, pitched up per consecutive flip
    if (!AC || !soundOn) return;
    flipN = tGlobal - flipResetT < 3 ? flipN + 1 : 1;
    flipResetT = tGlobal;
    sndWhoosh(480 * Math.pow(1.15, flipN), 900 * Math.pow(1.15, flipN), 0.05);
  }
  function sndLand(k) {
    if (!AC || !soundOn) return;
    const t = AC.currentTime;
    const o = AC.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(rnd(95, 120), t); o.frequency.exponentialRampToValueAtTime(46, t + 0.11);
    const og = AC.createGain(); og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.14 * (0.4 + k * 0.6), t + 0.006);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    o.connect(og); og.connect(busSfx);
    const ov = AC.createGain(); ov.gain.value = 0.4; og.connect(ov); ov.connect(verbSend);
    o.start(t); o.stop(t + 0.2);
    // powder puff: two decorrelated lowpassed bursts
    for (const pn of [-0.4, 0.4]) {
      const s = AC.createBufferSource(); s.buffer = noiseBuf(0.3, true);
      const lp = AC.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900;
      const g = AC.createGain(); g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.07 * (0.4 + k * 0.6), t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.34);
      let node = g;
      if (AC.createStereoPanner) { const p = AC.createStereoPanner(); p.pan.value = pn; g.connect(p); node = p; }
      s.connect(lp); lp.connect(g); node.connect(busSfx); s.start(t); s.stop(t + 0.34);
    }
  }
  function sndBank(n) {
    if (!AC || !soundOn) return;
    const t = AC.currentTime;
    const pent = [0, 2, 4, 7, 9, 12, 14, 16];
    const deg = Math.min(n - 1, pent.length - 1);
    [0, 0.07].forEach(function (d, i) {
      const o = AC.createOscillator(); o.type = i ? "sine" : "triangle";
      o.frequency.value = midiF(69 + pent[Math.max(0, deg - i)]);
      const g = AC.createGain();
      g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.12, t + d + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0006, t + d + 0.7);
      o.connect(g); g.connect(busSfx);
      const dl = AC.createGain(); dl.gain.value = 0.5; g.connect(dl); dl.connect(dlySend);
      o.start(t + d); o.stop(t + d + 0.75);
    });
  }
  function sndSmash(type) {
    if (!AC || !soundOn) return;
    const t = AC.currentTime;
    const s = AC.createBufferSource(); s.buffer = noiseBuf(0.25, false);
    const f = AC.createBiquadFilter(); f.type = type === "rock" ? "lowpass" : "bandpass";
    f.frequency.value = type === "rock" ? 700 : 1600;
    const g = AC.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0006, t + 0.22);
    s.connect(f); f.connect(g); g.connect(busSfx);
    const v = AC.createGain(); v.gain.value = 0.3; g.connect(v); v.connect(verbSend);
    s.start(t); s.stop(t + 0.26);
  }
  function sndTree(smashed) {
    if (!AC || !soundOn) return;
    const t = AC.currentTime;
    if (smashed) { // woody crack + needle burst
      const o = AC.createOscillator(); o.type = "triangle";
      o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.09);
      const og = AC.createGain(); og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(0.12, t + 0.005); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      o.connect(og); og.connect(busSfx); o.start(t); o.stop(t + 0.16);
    }
    const s = AC.createBufferSource(); s.buffer = noiseBuf(0.3, false);
    const f = AC.createBiquadFilter(); f.type = "highpass"; f.frequency.value = smashed ? 1800 : 2600;
    const g = AC.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(smashed ? 0.07 : 0.03, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0005, t + (smashed ? 0.24 : 0.16));
    s.connect(f); f.connect(g); g.connect(busSfx);
    const v = AC.createGain(); v.gain.value = 0.25; g.connect(v); v.connect(verbSend);
    s.start(t); s.stop(t + 0.3);
  }
  function sndThunder() {
    if (!AC || !soundOn) return;
    const t = AC.currentTime;
    const s = AC.createBufferSource(); s.buffer = noiseBuf(1.4, true);
    const lp = AC.createBiquadFilter(); lp.type = "lowpass";
    lp.frequency.setValueAtTime(300, t); lp.frequency.exponentialRampToValueAtTime(50, t + 1.1);
    const g = AC.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.26, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0008, t + 1.35);
    s.connect(lp); lp.connect(g); g.connect(busSfx);
    const v = AC.createGain(); v.gain.value = 0.7; g.connect(v); v.connect(verbSend);
    s.start(t); s.stop(t + 1.4);
  }
  function sndCrash() {
    if (!AC || !soundOn) return;
    const t = AC.currentTime;
    [0, 0.12, 0.26].forEach(function (d, i) {
      const o = AC.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(rnd(90, 120) / (1 + i * 0.3), t + d);
      o.frequency.exponentialRampToValueAtTime(38, t + d + 0.14);
      const g = AC.createGain(); g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.16 / (1 + i * 0.5), t + d + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.2);
      o.connect(g); g.connect(busSfx);
      const v = AC.createGain(); v.gain.value = 0.4; g.connect(v); v.connect(verbSend);
      o.start(t + d); o.stop(t + d + 0.24);
    });
    // a musical wince: dip the master lowpass, no buzzer
    if (masterLP) {
      masterLP.frequency.setTargetAtTime(1200, t, 0.05);
      masterLP.frequency.setTargetAtTime(11000, t + 0.6, 0.3);
    }
  }
  function sndFanfare() {
    if (!AC || !soundOn) return;
    [69, 73, 76, 81].forEach(function (m, i) { setTimeout(function () { voiceNote(m, 0.55, (i - 1.5) * 0.2); }, i * 95); });
  }
  function updateAudio(dt) {
    if (!AC) return;
    const t = AC.currentTime;
    const spd = clamp(R.s / SOFT_MAX, 0, 1);
    if (padNodes) {
      const dn = currentStars; // 0 day .. 1 night
      padNodes.g.gain.setTargetAtTime(soundOn && mode !== "dead" ? 0.09 : 0, t, mode === "dead" ? 0.9 : 0.5);
      padNodes.lfoG.gain.setTargetAtTime(mode === "dead" ? 0 : 0.02, t, 0.6); // the breath LFO rides ON TOP of the base gain — silence it too
      padNodes.lp.frequency.setTargetAtTime(lerp(2400, 900, dn), t, 0.8);
      padNodes.ninth.gain.setTargetAtTime(lerp(0.12, 0, dn), t, 0.8);
    }
    if (carveNodes) {
      const on = !R.air && !R.grind && (mode === "riding");
      carveNodes.g.gain.setTargetAtTime(on && soundOn ? 0.14 * spd : 0, t, on ? 0.12 : 0.04);
      carveNodes.f.frequency.setTargetAtTime(400 + spd * 1800, t, 0.1);
    }
    if (windNodes) {
      const wk = (0.4 + weather.k * (weather.kind === "blizzard" ? 2.2 : 0.8) + spd * 0.5) * (mode === "dead" ? 0.06 : 1);
      windNodes.body.gain.setTargetAtTime(soundOn ? 0.02 * wk : 0, t, 0.4);
      windNodes.whistle.gain.setTargetAtTime(soundOn ? 0.005 * wk * (0.5 + wind.gust) : 0, t, 0.3);
      windNodes.bp.frequency.setTargetAtTime(700 + wind.gust * 500 + spd * 300, t, 0.5);
    }
    if (rainNodes) rainNodes.g.gain.setTargetAtTime(soundOn && weather.kind === "storm" && mode !== "dead" ? 0.05 * weather.k : 0, t, 0.8);
    if (grindNodes) grindNodes.g.gain.setTargetAtTime(R.grind && soundOn ? 0.05 : 0, t, R.grind ? 0.05 : 0.08);
    if (busMusic) busMusic.gain.setTargetAtTime(weather.kind === "storm" ? 0.42 : 0.9, t, 1.2);
    if (R.grind && Math.random() < dt * 18) { // Poisson spark ticks
      const o = AC.createOscillator(); o.type = "square"; o.frequency.value = rnd(2400, 4200);
      const g = AC.createGain(); g.gain.setValueAtTime(0.008, t); g.gain.exponentialRampToValueAtTime(0.0004, t + 0.03);
      o.connect(g); g.connect(busSfx); o.start(t); o.stop(t + 0.04);
    }
    melodyTick(dt);
  }

  /* ============================ HUD / flow ============================ */
  function track(name) { try { if (typeof window.gtag === "function") window.gtag("event", name, {}); } catch (e) {} }
  function renderBest() { elBest.textContent = best > 0 ? "Best " + best : "Best —"; }
  renderBest();
  function hud() {
    score = banked + Math.floor((R.x - startX) / PX_PER_M);
    if (score !== shownScore) { shownScore = score; elScore.textContent = String(score); }
    elDist.textContent = Math.floor((R.x - startX) / PX_PER_M) + "m";
    const c = chain.n > 0 ? (chain.n > 1 ? "×" + chain.n + " · " : "") + Math.round(chain.sum) : "";
    if (c !== shownChain) {
      shownChain = c;
      if (c) { elChain.textContent = c; elChain.hidden = false; }
      else elChain.hidden = true;
    }
    elChain.classList.toggle("is-hot", boost.t > 0 && chain.n > 0);
  }
  function burstConfetti() {
    const cols = ["#f2a65a", "#e5484d", "#ffd9c0", "#8e4a6e", "#ffe9c9"];
    for (let i = 0; i < 44; i++) {
      const el = document.createElement("i");
      el.style.cssText = "left:" + (50 + (Math.random() - 0.5) * 44) + "%;top:30%;background:" + cols[i % cols.length] +
        ";--dx:" + ((Math.random() - 0.5) * 240) + "px;--dy:" + (240 + Math.random() * 260) + "px;--rot:" + ((Math.random() - 0.5) * 900) + "deg;--d:" + (620 + Math.random() * 520) + "ms";
      elConfetti.appendChild(el);
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1250);
    }
  }
  function showOverlay() { elOverlay.hidden = false; requestAnimationFrame(function () { elOverlay.classList.remove("is-hidden"); }); }
  function hideOverlay() {
    elOverlay.classList.add("is-hidden");
    setTimeout(function () { if (elOverlay.classList.contains("is-hidden")) elOverlay.hidden = true; }, 300);
  }
  const CAUSE = {
    landing: "Over-rotated — the mountain keeps the points.",
    rock: "A rock at full speed.",
    fire: "Straight through a campfire.",
    chasm: "The chasm swallowed the run."
  };
  function gameOver() {
    mode = "dead";
    const isBest = score > best && score > 5;
    if (isBest) {
      best = score;
      try { localStorage.setItem("alpenglow_best", String(best)); } catch (e) {}
      renderBest(); track("new_best");
    }
    elOvTitle.textContent = "The run ends";
    elOvText.innerHTML = (CAUSE[R.crashCause] || "") + " You rode <span class=\"stat\">" +
      Math.floor((R.x - startX) / PX_PER_M) + "m</span> and scored <span class=\"stat\">" + score + "</span>." +
      (isBest ? " <span class=\"stat\">New best!</span>" : (best > 0 ? " Best: " + best + "." : ""));
    elOvBtn.textContent = "Ride again";
    window.OPT_SHARE_TEXT = "Alpenglow — I rode " + Math.floor((R.x - startX) / PX_PER_M) + "m and scored " + score + ". Can you beat it?";
    showOverlay();
    if (isBest) { burstConfetti(); sndFanfare(); }
    track("game_over");
  }
  function startGame() {
    ensureAudio();
    resetWorld();
    mode = "riding";
    hideOverlay();
    hud();
    if (hintShown) setTimeout(function () { elHint.classList.add("is-gone"); hintShown = false; }, 3600);
    track("game_start");
  }

  elOvBtn.addEventListener("click", function () { if (mode === "menu" || mode === "dead") startGame(); });
  soundBtn.addEventListener("click", function () {
    soundOn = !soundOn;
    soundBtn.setAttribute("aria-pressed", String(soundOn));
    soundBtn.textContent = soundOn ? "♪" : "∅";
    try { localStorage.setItem("alpenglow_sound", soundOn ? "on" : "off"); } catch (e) {}
    if (soundOn) ensureAudio();
    if (AC && outGain) outGain.gain.setTargetAtTime(soundOn ? 0.9 : 0, AC.currentTime, 0.03);
  });
  soundBtn.setAttribute("aria-pressed", String(soundOn));
  soundBtn.textContent = soundOn ? "♪" : "∅";

  document.addEventListener("visibilitychange", function () {
    if (!AC) return;
    if (document.hidden) { try { AC.suspend(); } catch (e) {} }
    else if (soundOn) { try { AC.resume(); } catch (e) {} }
  });

  /* ============================ input ============================ */
  function press() {
    ensureAudio();
    if (mode === "riding") {
      holding = true;
      R.buf = INPUT_BUF;
      if (!R.air || R.coyote > 0 || R.grind) { doJump(); R.buf = -1; }
    }
  }
  function release() { holding = false; }
  canvas.addEventListener("pointerdown", function (e) { e.preventDefault(); press(); });
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);
  window.addEventListener("keydown", function (e) {
    if (e.repeat) return;
    if (e.key === " " || e.key === "ArrowUp" || e.key === "w") {
      e.preventDefault();
      if (mode === "menu" || mode === "dead") { startGame(); return; }
      press();
    }
    if ((e.key === "r" || e.key === "R" || e.key === "Enter") && mode === "dead") startGame();
  });
  window.addEventListener("keyup", function (e) {
    if (e.key === " " || e.key === "ArrowUp" || e.key === "w") release();
  });

  /* ============================ update ============================ */
  function update(dt) {
    tGlobal += dt;
    dayT = (dayT + dt / DAY_LEN) % 1;
    stepWeather(dt);
    stepAurora(dt);
    stepAmbient(dt);

    if (mode === "menu") {
      // attract: the rider carves on autopilot behind the overlay
      autoPilot(dt);
    }
    if (mode === "riding" || mode === "menu") {
      const vMax = R.air ? Math.max(R.s, Math.abs(R.vx) + Math.abs(R.vy)) : R.s;
      const steps = Math.max(1, Math.ceil(vMax * dt / 12));
      const sub = dt / steps;
      for (let i = 0; i < steps; i++) {
        stepRider(sub);
        if (mode === "crashed") break;
      }
      // buffered input: land then immediately jump
      if (mode === "riding" && R.buf > 0 && !R.air && !R.grind) { doJump(); R.buf = -1; }
      sExpAvg = lerp(sExpAvg, R.s, Math.min(1, dt * 0.3));
    } else if (mode === "crashed") {
      R.vy += G * dt; R.x += R.vx * dt; R.y += R.vy * dt;
      R.ang += R.spin * dt; R.spin *= Math.pow(0.2, dt);
      R.vx *= Math.pow(0.3, dt);
      const grY = groundY(R.x); // walls and floor included — the tumble slides down them
      if (R.y > grY) { R.y = grY; R.vy = -Math.abs(R.vy) * 0.35; R.vx *= 0.75; sprayBurst(8, 1.2); }
      if (boardFree) {
        boardFree.vy += G * dt;
        boardFree.x += boardFree.vx * dt; boardFree.y += boardFree.vy * dt;
        boardFree.ang += boardFree.spin * dt;
        const bGr = groundY(boardFree.x) - 3;
        if (boardFree.y > bGr) {
          boardFree.y = bGr;
          boardFree.vy = -Math.abs(boardFree.vy) * 0.4;
          boardFree.vx *= 0.7; boardFree.spin *= 0.7;
        }
      }
      R.crashT += dt;
      if (R.crashT > 1.25) gameOver();
    }
    poseTargets(dt);

    pump(camX + (W / zoom) * 1.6 + 800);

    // world-origin rebase so float precision never drifts on a long run
    if (R.x > 200000) {
      const off = 150000;
      for (const s of segs) { s.x0 -= off; s.x1 -= off; }
      for (const rl of rails) { rl.x0 -= off; rl.x1 -= off; }
      for (const d of decos) d.x -= off;
      for (const p of sprays) p.x -= off;
      for (const p of bursts) p.x -= off;
      for (const p of sparks) p.x -= off;
      for (const p of trail) p.x -= off;
      for (const p of glints) p.x -= off;
      R.x -= off; genX -= off; camX -= off; startX -= off;
      chunkCache.clear(); // chunk indices no longer align with the shifted world
    }

    // menu attract: if the autopilot fumbles into a chasm, quietly rescue it
    if (mode === "menu" && inGap(R.x)) {
      const s = segAt(R.x);
      if (R.y > s.y0 + 150) {
        R.x = s.x1 + 60; R.y = terrainY(R.x) - 90;
        R.vx = Math.max(R.vx, 260); R.vy = 0; R.ang = 0;
      }
    }

    // camera
    const spd = clamp(R.s / SOFT_MAX, 0, 1);
    const bigAir = R.air && (terrainY(R.x) - R.y) > 260;
    const zTarget = bigAir ? 0.8 : lerp(1.0, 0.86, spd);
    zoom = lerp(zoom, zTarget, Math.min(1, dt * 2));
    const anchor = lerp(0.34, 0.26, spd);
    camX = R.x - anchor * (W / zoom);
    const lookY = lerp(R.y, terrainY(R.x + 250), 0.3);
    const ky = R.air ? 2.2 : 3.2;
    camY = lerp(camY, lookY - 0.55 * (H / zoom), Math.min(1, dt * ky));
    if (shake > 0) shake = Math.max(0, shake - dt * 2);

    // scarf pinned at the animated shoulder (updated each render)
    stepScarf(dt, lastSho.x, lastSho.y);

    stepParticles(sprays, dt, 620);
    stepParticles(bursts, dt, 900);
    stepParticles(sparks, dt, 500);
    for (let i = popups.length - 1; i >= 0; i--) {
      popups[i].t += dt;
      if (popups[i].t > popups[i].life) popups.splice(i, 1);
    }
    shootT -= dt;
    if (shootT <= 0) { shootT = rnd(9, 26); if (currentStars > 0.5 && !REDMO) shoot = { fx: Math.random() * 0.8 + 0.1, fy: Math.random() * 0.3 + 0.05, t: 0 }; }
    if (shoot) { shoot.t += dt; if (shoot.t > 0.9) shoot = null; }

    updateAudio(dt);
    if (mode === "riding") hud();
  }
  // menu attract: simple self-rider — jump off crests, mostly cruise
  let apT = 0;
  function autoPilot(dt) {
    apT -= dt;
    if (!R.air && !R.grind && apT <= 0 && terrainAng(R.x) < -0.05) {
      holding = false;
      doJump(); apT = rnd(1.4, 3);
      setTimeout(function () { holding = true; }, 120);
      setTimeout(function () { holding = false; }, 120 + rnd(500, 900));
    }
    if (mode === "menu" && R.air && terrainY(R.x) - R.y < 120 && R.vy > 0) {
      // ease to slope so the attract rider mostly survives
      const target = terrainAng(R.x + R.vx * 0.2);
      const d = normAng(target - R.ang);
      R.ang += clamp(d, -AUTO_LEVEL * 2 * dt, AUTO_LEVEL * 2 * dt);
      holding = false;
    }
  }

  /* ============================ render ============================ */
  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
  }
  window.addEventListener("resize", resize);
  resize();

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const stormK = weather.kind === "storm" || weather.kind === "blizzard" ? weather.k * (weather.kind === "blizzard" ? 0.55 : 0.9) : 0;
    const pal = currentPal(dayT, stormK);
    currentStars = pal.stars;

    /* ---- sky ---- */
    const sky = ctx.createLinearGradient(0, 0, 0, H * 0.9);
    sky.addColorStop(0, pal.sky[0]); sky.addColorStop(0.45, pal.sky[1]);
    sky.addColorStop(0.75, pal.sky[2]); sky.addColorStop(1, pal.sky[3]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    /* ---- stars ---- */
    if (pal.stars > 0.02) {
      ctx.save();
      for (const st of stars) {
        const tw = REDMO ? 0.8 : 0.55 + 0.45 * Math.sin(tGlobal * st.tw + st.ph);
        ctx.globalAlpha = pal.stars * tw * 0.9;
        ctx.fillStyle = "#dfe8ff";
        ctx.fillRect(st.fx * W, st.fy * H, st.r, st.r);
      }
      if (shoot) {
        const p = shoot.t / 0.9;
        ctx.globalAlpha = pal.stars * (1 - p) * 0.9;
        ctx.strokeStyle = "#eef4ff"; ctx.lineWidth = 1.4;
        const sx = shoot.fx * W + p * 190, sy = shoot.fy * H + p * 80;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - 46, sy - 19); ctx.stroke();
      }
      ctx.restore();
    }

    /* ---- aurora: slow curtains over the night sky ---- */
    if (aurora.k > 0.01 && pal.stars > 0.3) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const ak = aurora.k * clamp((pal.stars - 0.3) / 0.5, 0, 1);
      for (const c of AUR_CURTAINS) {
        const phase = REDMO ? c.ph : tGlobal * c.spd + c.ph;
        const bandTop = H * (0.04 + c.off), bandH = H * 0.30;
        const g = ctx.createLinearGradient(0, bandTop, 0, bandTop + bandH * 1.4);
        g.addColorStop(0, "rgba(" + c.tint.join(",") + ",0)");
        g.addColorStop(0.45, "rgba(" + c.tint.join(",") + "," + (0.13 * ak * c.amp) + ")");
        g.addColorStop(1, "rgba(" + c.tint.join(",") + ",0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        for (let sx = -10; sx <= W + 10; sx += 22) {
          const wob = Math.sin(sx * c.f + phase) * H * 0.045 + Math.sin(sx * c.f2 + phase * 0.6) * H * 0.075;
          const yTop = bandTop + wob;
          if (sx === -10) ctx.moveTo(sx, yTop); else ctx.lineTo(sx, yTop);
        }
        for (let sx = W + 10; sx >= -10; sx -= 22) {
          const wob = Math.sin(sx * c.f + phase) * H * 0.045 + Math.sin(sx * c.f2 + phase * 0.6) * H * 0.075;
          const hh = bandH * (0.7 + 0.3 * Math.sin(sx * 0.0021 + phase * 1.3));
          ctx.lineTo(sx, bandTop + wob + hh);
        }
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    /* ---- celestial: sun (dawn->dusk) or moon (night) ---- */
    const dphase = dayT;
    let sunT = -1;
    if (dphase < 0.6) sunT = dphase / 0.6; // rises at dawn start, sets at dusk end
    const isMoon = sunT < 0.02 || sunT > 0.98;
    const cT = isMoon ? ((dphase - 0.6 + 1) % 1) / 0.4 : sunT;
    const cx = W * (0.14 + 0.72 * cT);
    const cy = H * (0.62 - Math.sin(cT * Math.PI) * 0.44);
    ctx.save();
    const occl = 1 - clamp(stormK * 1.15, 0, 0.92); // overcast swallows the sun
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, isMoon ? 90 : 210);
    grad.addColorStop(0, pal.glow); grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = (isMoon ? 0.35 : 0.5) * occl;
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = grad;
    ctx.fillRect(cx - 220, cy - 220, 440, 440);
    ctx.globalAlpha = occl;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = pal.sun;
    ctx.beginPath(); ctx.arc(cx, cy, isMoon ? 17 : 26, 0, 7); ctx.fill();
    if (isMoon && occl > 0.1) { // crescent bite
      ctx.globalAlpha = 1;
      ctx.fillStyle = pal.sky[1];
      ctx.beginPath(); ctx.arc(cx + 7, cy - 4, 14, 0, 7); ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    /* ---- god rays when the sun rides low ---- */
    if (!isMoon && occl > 0.3) {
      const lowness = Math.pow(Math.abs(cT - 0.5) * 2, 2);
      if (lowness > 0.25) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = withAlpha(pal.glow, 0.045 * lowness * occl);
        const drift = REDMO ? 0 : tGlobal * 0.006;
        for (let i = 0; i < 4; i++) {
          const a = -0.5 + i * 0.42 + Math.sin(drift + i * 1.7) * 0.06;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(a) * H * 1.5 - Math.sin(a) * 26, cy + Math.sin(a) * H * 1.5 + Math.cos(a) * 26);
          ctx.lineTo(cx + Math.cos(a) * H * 1.5 + Math.sin(a) * 26, cy + Math.sin(a) * H * 1.5 - Math.cos(a) * 26);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }
    }

    /* ---- parallax silhouette ranges ---- */
    const layerCols = [pal.far, pal.mid, pal.near];
    for (let li = 0; li < 3; li++) {
      const rg = ridges[li];
      ctx.fillStyle = layerCols[li];
      ctx.beginPath();
      const baseY = H * rg.base;
      ctx.moveTo(0, H + 2);
      for (let sx = 0; sx <= W; sx += 10) {
        const wx = camX * rg.f + sx;
        ctx.lineTo(sx, baseY + ridgeY(rg.r, wx) * (H / 800));
      }
      ctx.lineTo(W, H + 2);
      ctx.closePath();
      ctx.fill();
      // always-on depth haze at each ridge base — atmospheric distance for free
      if (li < 2) {
        const hz = ctx.createLinearGradient(0, baseY - 20, 0, baseY + 74);
        hz.addColorStop(0, withAlpha(pal.sky[3], 0));
        hz.addColorStop(0.55, withAlpha(pal.sky[3], 0.085 - li * 0.025));
        hz.addColorStop(1, withAlpha(pal.sky[3], 0));
        ctx.fillStyle = hz;
        ctx.fillRect(0, baseY - 20, W, 94);
      }
      // fog bands park between layers
      if (weather.kind === "fog" && weather.k > 0.03 && li < 2) {
        const fy = baseY + 30 + li * 40;
        const fg = ctx.createLinearGradient(0, fy - 60, 0, fy + 90);
        fg.addColorStop(0, "rgba(0,0,0,0)");
        fg.addColorStop(0.5, "rgba(214, 222, 234," + (0.16 * weather.k) + ")");
        fg.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = fg;
        ctx.fillRect(0, fy - 60, W, 160);
      }
    }

    /* ---- a distant flock, some days ---- */
    if (birds) {
      ctx.strokeStyle = withAlpha(pal.near, 0.85);
      ctx.lineWidth = 1.7; ctx.lineCap = "round";
      ctx.beginPath();
      for (let i = 0; i < birds.n; i++) {
        const bx = birds.sx + i * 15 + (i % 2) * 7;
        const by = birds.sy + (i % 2) * 8 + i * 2.4;
        const flap = REDMO ? 1.6 : Math.sin(tGlobal * 6.5 + birds.ph + i * 1.2) * 3;
        ctx.moveTo(bx - 4.5, by + Math.abs(flap) * 0.5);
        ctx.quadraticCurveTo(bx, by - 1.5, bx, by);
        ctx.quadraticCurveTo(bx, by - 1.5, bx + 4.5, by + Math.abs(flap) * 0.5);
      }
      ctx.stroke();
    }

    /* ---- rainbow (rare, after rain) ---- */
    if (weather.rainbow > 0) {
      const a = clamp(Math.min(weather.rainbow / 4, (22 - weather.rainbow) / 3), 0, 1) * 0.22;
      ctx.save();
      ctx.globalAlpha = a;
      const bands = ["#e5484d", "#f2a65a", "#f7e06c", "#7bc47f", "#5aa9e6", "#8e6ac9"];
      for (let i = 0; i < bands.length; i++) {
        ctx.strokeStyle = bands[i];
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.arc(W * 0.6, H * 1.05, H * 0.72 - i * 7, Math.PI * 1.05, Math.PI * 1.95);
        ctx.stroke();
      }
      ctx.restore();
    }

    /* ---- world space ---- */
    ctx.save();
    const shx = shake > 0 && !REDMO ? (Math.random() - 0.5) * shake * 14 : 0;
    const shy = shake > 0 && !REDMO ? (Math.random() - 0.5) * shake * 12 : 0;
    ctx.translate(shx, shy);
    ctx.scale(zoom, zoom);
    ctx.translate(-camX, -camY);
    const vx0 = camX - 40, vx1 = camX + W / zoom + 40;

    /* playfield terrain from Path2D chunks — ONE camera-anchored gradient so chunk edges never seam */
    const ci0 = Math.floor(vx0 / CHUNK), ci1 = Math.floor(vx1 / CHUNK);
    const gTop = camY + (H / zoom) * 0.25;
    const g = ctx.createLinearGradient(0, gTop, 0, gTop + (H / zoom) * 1.3);
    g.addColorStop(0, pal.playTop); g.addColorStop(1, pal.playDeep);
    ctx.fillStyle = g;
    for (let ci = ci0; ci <= ci1; ci++) ctx.fill(chunkFor(ci).path);
    // snow rim + under-band (skipped over chasm spans)
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (let ci = ci0; ci <= ci1; ci++) {
      const c = chunkFor(ci);
      for (const pass of [[pal.under, 7, 5], [pal.rim, 3, 0]]) {
        ctx.strokeStyle = pass[0]; ctx.lineWidth = pass[1];
        ctx.beginPath();
        let pen = false;
        for (const p of c.tops) {
          if (p[2]) { pen = false; continue; }
          if (!pen) { ctx.moveTo(p[0], p[1] + pass[2]); pen = true; }
          else ctx.lineTo(p[0], p[1] + pass[2]);
        }
        ctx.stroke();
      }
    }

    /* decorations + obstacles */
    for (const d of decos) {
      if (d.x < vx0 - 60 || d.x > vx1 + 60) continue;
      const ty = terrainY(d.x);
      if (d.type === "tree") drawTree(d, ty, pal);
      else if (d.type === "rock") { if (!d.smashed) drawRock(d, ty, pal); }
      else if (d.type === "fire") { if (!d.smashed) drawFire(d, ty, pal); }
      else if (d.type === "sign") drawSign(d, ty, pal);
    }

    /* rails: posts + sagging wire + pennant flags; physics is the straight chord */
    for (const rl of rails) {
      if (rl.x1 < vx0 || rl.x0 > vx1) continue;
      ctx.strokeStyle = pal.under; ctx.lineWidth = 3;
      for (const ex of [[rl.x0, rl.y0], [rl.x1, rl.y1]]) {
        ctx.beginPath(); ctx.moveTo(ex[0], ex[1]); ctx.lineTo(ex[0], terrainY(ex[0])); ctx.stroke();
      }
      const mx = (rl.x0 + rl.x1) / 2, my = (rl.y0 + rl.y1) / 2 + 10;
      ctx.strokeStyle = "rgba(10, 8, 20, 0.55)"; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(rl.x0, rl.y0 + 1.5); ctx.quadraticCurveTo(mx, my + 1.5, rl.x1, rl.y1 + 1.5); ctx.stroke();
      ctx.strokeStyle = pal.rim; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(rl.x0, rl.y0); ctx.quadraticCurveTo(mx, my, rl.x1, rl.y1); ctx.stroke();
      // pennant flags
      ctx.fillStyle = SCARF;
      for (let ft = 0.14; ft < 1; ft += 0.17) {
        const fx = lerp(rl.x0, rl.x1, ft), fy = lerp(rl.y0, rl.y1, ft) + 20 * ft * (1 - ft) + 1.5;
        ctx.beginPath();
        ctx.moveTo(fx, fy); ctx.lineTo(fx + 10 + wind.gust * 5, fy + 5.5); ctx.lineTo(fx, fy + 11);
        ctx.closePath(); ctx.fill();
      }
    }

    /* snow glints — tiny surface sparkles */
    if (glints.length) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = pal.rim;
      ctx.lineWidth = 1.1;
      for (const gl of glints) {
        const a = Math.sin(gl.t / gl.life * Math.PI);
        const r = 1.6 + a * 1.8;
        ctx.globalAlpha = a * 0.8;
        ctx.beginPath();
        ctx.moveTo(gl.x - r, gl.y); ctx.lineTo(gl.x + r, gl.y);
        ctx.moveTo(gl.x, gl.y - r); ctx.lineTo(gl.x, gl.y + r);
        ctx.stroke();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    /* boost speed-trail behind the rider */
    if (trail.length > 2) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      ctx.strokeStyle = "#ff9a6a";
      for (let i = 1; i < trail.length; i++) {
        const f = i / trail.length;
        ctx.globalAlpha = f * 0.3 * clamp(boost.t > 0 ? 1 : 0.5, 0, 1);
        ctx.lineWidth = 1 + f * 6;
        ctx.beginPath();
        ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
        ctx.lineTo(trail[i].x, trail[i].y);
        ctx.stroke();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    /* particles behind the rider */
    ctx.fillStyle = pal.rim;
    for (const p of sprays) {
      ctx.globalAlpha = clamp(p.life * 1.8, 0, 0.85);
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const p of bursts) {
      ctx.globalAlpha = clamp(p.life * 1.6, 0, 1);
      ctx.fillStyle = p.col;
      if (p.glow) { ctx.globalCompositeOperation = "lighter"; }
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "lighter";
    for (const p of sparks) {
      ctx.globalAlpha = clamp(p.life * 2.4, 0, 1);
      ctx.fillStyle = "#ffd9a0";
      ctx.fillRect(p.x, p.y, p.r + 1, p.r);
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;

    /* the rider (and the torn-away board mid-crash) */
    if (mode === "crashed" && boardFree) {
      ctx.save();
      ctx.translate(boardFree.x, boardFree.y);
      ctx.rotate(boardFree.ang);
      drawBoardShape();
      ctx.strokeStyle = pal.rim; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-21, -7); ctx.lineTo(21, -7); ctx.stroke();
      ctx.restore();
    }
    if (mode !== "dead") drawRider(pal);

    ctx.restore();

    /* score popups — screen-anchored so they stay readable at speed */
    for (const p of popups) {
      const fadeIn = clamp(p.t / 0.12, 0, 1);
      const a = p.t < p.life - 0.5 ? fadeIn : (p.life - p.t) / 0.5;
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.font = "800 " + (p.big ? 21 : 14) + "px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(16, 12, 30, 0.45)";
      ctx.fillText(p.txt, p.sx + 1, p.sy - p.t * 22 + 1.5);
      ctx.fillStyle = p.gold ? "#ffd9a0" : "#f2ede8";
      ctx.fillText(p.txt, p.sx, p.sy - p.t * 22);
      ctx.globalAlpha = 1;
    }

    /* ---- screen-space weather ---- */
    if (flakes.length) {
      ctx.fillStyle = "rgba(240, 246, 255, 0.85)";
      for (const f of flakes) {
        ctx.globalAlpha = clamp(0.3 + f.d * 0.5, 0, 0.9) * clamp(weather.k * 2, 0, 1);
        ctx.beginPath(); ctx.arc(f.sx, f.sy, f.r, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (drops.length) {
      ctx.strokeStyle = "rgba(200, 216, 240, 0.5)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (const d of drops) {
        ctx.moveTo(d.sx, d.sy);
        ctx.lineTo(d.sx - 7 * d.d, d.sy - 16 * d.d);
      }
      ctx.stroke();
    }
    if (weather.kind === "blizzard" && weather.k > 0.05) {
      ctx.fillStyle = "rgba(226, 234, 246," + 0.12 * weather.k + ")";
      ctx.fillRect(0, 0, W, H);
    }
    if (weather.flash > 0 && !REDMO) {
      ctx.fillStyle = "rgba(255, 247, 232," + clamp(weather.flash * 1.6, 0, 0.5) + ")";
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawTree(d, ty, pal) {
    const s = d.s, h = 52 * s;
    if (d.smashed) { // just the splintered stump remains
      ctx.fillStyle = pal.playTop;
      ctx.beginPath();
      ctx.moveTo(d.x - 4 * s, ty);
      ctx.lineTo(d.x - 3 * s, ty - 8 * s);
      ctx.lineTo(d.x - 1 * s, ty - 4 * s);
      ctx.lineTo(d.x + 1.5 * s, ty - 9 * s);
      ctx.lineTo(d.x + 3.5 * s, ty - 5 * s);
      ctx.lineTo(d.x + 4 * s, ty);
      ctx.closePath(); ctx.fill();
      return;
    }
    if (d.wob > 0) {
      d.wob *= 0.93;
      ctx.save();
      ctx.translate(d.x, ty);
      ctx.rotate(Math.sin(tGlobal * 21) * d.wob * 0.055);
      ctx.translate(-d.x, -ty);
    }
    ctx.fillStyle = pal.playTop;
    ctx.strokeStyle = pal.playTop;
    ctx.beginPath();
    ctx.moveTo(d.x, ty - h);
    ctx.lineTo(d.x - 12 * s, ty - h * 0.42);
    ctx.lineTo(d.x - 5 * s, ty - h * 0.46);
    ctx.lineTo(d.x - 16 * s, ty - 4);
    ctx.lineTo(d.x + 16 * s, ty - 4);
    ctx.lineTo(d.x + 5 * s, ty - h * 0.46);
    ctx.lineTo(d.x + 12 * s, ty - h * 0.42);
    ctx.closePath(); ctx.fill();
    // snow rim on the crown
    ctx.strokeStyle = pal.rim; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(d.x, ty - h); ctx.lineTo(d.x - 9 * s, ty - h * 0.5); ctx.stroke();
    if (d.wob > 0) ctx.restore();
  }
  function drawRock(d, ty, pal) {
    const s = d.s;
    ctx.fillStyle = pal.playTop;
    ctx.beginPath();
    ctx.moveTo(d.x - 15 * s, ty + 2);
    ctx.lineTo(d.x - 10 * s, ty - 13 * s);
    ctx.lineTo(d.x + 2 * s, ty - 17 * s);
    ctx.lineTo(d.x + 14 * s, ty - 7 * s);
    ctx.lineTo(d.x + 16 * s, ty + 2);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = pal.rim; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(d.x - 10 * s, ty - 13 * s); ctx.lineTo(d.x + 2 * s, ty - 17 * s); ctx.stroke();
  }
  function drawFire(d, ty, pal) {
    const flick = REDMO ? 1 : 0.85 + 0.3 * Math.sin(tGlobal * 11 + d.seed * 9);
    ctx.fillStyle = pal.playDeep;
    ctx.fillRect(d.x - 9, ty - 4, 18, 4);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(d.x, ty - 12, 0, d.x, ty - 12, 34 * flick);
    g.addColorStop(0, "rgba(255, 170, 80," + 0.55 * PAL_FIRE(pal) + ")");
    g.addColorStop(1, "rgba(255, 120, 40, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(d.x - 36, ty - 48, 72, 52);
    ctx.restore();
    ctx.fillStyle = "#ff9a4a";
    ctx.beginPath();
    ctx.moveTo(d.x - 6, ty - 4);
    ctx.quadraticCurveTo(d.x - 7, ty - 14 * flick, d.x, ty - 20 * flick);
    ctx.quadraticCurveTo(d.x + 7, ty - 12 * flick, d.x + 6, ty - 4);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#ffe0a0";
    ctx.beginPath();
    ctx.moveTo(d.x - 3, ty - 4);
    ctx.quadraticCurveTo(d.x - 3, ty - 9 * flick, d.x, ty - 12 * flick);
    ctx.quadraticCurveTo(d.x + 3, ty - 8 * flick, d.x + 3, ty - 4);
    ctx.closePath(); ctx.fill();
  }
  function PAL_FIRE(pal) { return pal.fires; }
  function drawSign(d, ty, pal) {
    ctx.strokeStyle = pal.under; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(d.x, ty); ctx.lineTo(d.x, ty - 26); ctx.stroke();
    ctx.fillStyle = "#e8a13c";
    ctx.save();
    ctx.translate(d.x, ty - 33); ctx.rotate(Math.PI / 4);
    ctx.fillRect(-9, -9, 18, 18);
    ctx.restore();
    ctx.fillStyle = pal.playDeep;
    ctx.font = "900 13px system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.fillText("!", d.x, ty - 28);
  }
  /* -------- rider pose system: keypose blending by condition -------- */
  // points: [kneeB, kneeF, hip, shoulder, head, hand] in board-local space (y up = negative)
  const POSE_BASE = [[-6.5, -15], [7, -15.5], [-2, -21], [0.5, -28], [2.5, -33.5], [-8.5, -23]];
  const POSE_CROUCH = [[-7, -12.5], [7.5, -13], [-3, -16], [1.5, -23], [4, -28], [-6, -17]];
  const POSE_TUCK = [[-2, -18], [5, -19], [-4.5, -14.5], [-1, -22], [3.5, -26.5], [3, -17.5]];
  const POSE_AIR = [[-6, -14], [7, -15], [-2, -20], [0, -27], [2, -32.5], [-11, -30]];
  const pose = { crouch: 0.25, tuck: 0, airOpen: 0, grindArm: 0 };
  let lastSho = { x: 0, y: -28 };

  function poseTargets(dt) {
    let tCrouch, tTuck = 0, tAir = 0, tGrind = 0;
    if (R.grind) { tCrouch = 0.55; tGrind = 1; }
    else if (R.air) {
      if (holding || Math.abs(R.spin) > 1.6) tTuck = 1;
      else { tAir = 0.85; tCrouch = 0.15; }
      tCrouch = tCrouch || 0.15;
    } else {
      const spd = clamp(R.s / SOFT_MAX, 0, 1);
      tCrouch = 0.22 + 0.4 * spd + R.squash * 0.55 + (holding ? 0.15 : 0);
      if (R.imm > 0.15) tCrouch = 0.9; // post-stumble scrape
    }
    const k = Math.min(1, dt * 12), kt = Math.min(1, dt * 16);
    pose.crouch = lerp(pose.crouch, clamp(tCrouch, 0, 1), k);
    pose.tuck = lerp(pose.tuck, tTuck, kt);
    pose.airOpen = lerp(pose.airOpen, tAir, k);
    pose.grindArm = lerp(pose.grindArm, tGrind, k);
  }
  function blendedPose() {
    const wT = pose.tuck, rem = 1 - wT;
    const wC = clamp(pose.crouch, 0, 1) * rem;
    const wA = clamp(pose.airOpen, 0, 1) * Math.max(0, rem - wC);
    const wB = Math.max(0, rem - wC - wA);
    const stretch = (!R.grind && R.air && R.airT < 0.12 && pose.tuck < 0.5) ? (1 - R.airT / 0.12) * 2.6 : 0;
    const pts = [];
    for (let i = 0; i < 6; i++) {
      let x = POSE_BASE[i][0] * wB + POSE_CROUCH[i][0] * wC + POSE_TUCK[i][0] * wT + POSE_AIR[i][0] * wA;
      let y = POSE_BASE[i][1] * wB + POSE_CROUCH[i][1] * wC + POSE_TUCK[i][1] * wT + POSE_AIR[i][1] * wA;
      if (i >= 2) y -= stretch; // launch: body extends off the board
      pts.push([x, y]);
    }
    if (pose.grindArm > 0.05) { // balance arm out front on the rail
      pts[5][0] = lerp(pts[5][0], 11, pose.grindArm);
      pts[5][1] = lerp(pts[5][1], -21, pose.grindArm);
    }
    return pts;
  }
  function drawBoardShape() {
    ctx.fillStyle = "#10101e";
    ctx.beginPath();
    ctx.moveTo(-24, -2); ctx.quadraticCurveTo(-27, -7, -21, -7);
    ctx.lineTo(21, -7); ctx.quadraticCurveTo(27, -7, 24, -2);
    ctx.closePath(); ctx.fill();
  }
  function drawRider(pal) {
    const bob = !R.air && !R.grind ? Math.sin(tGlobal * 14) * clamp(R.s / 900, 0, 1) * 1.2 : 0;
    const sq = 1 - R.squash * 0.22;
    const crashed = mode === "crashed";
    const P = blendedPose();
    // ragdoll flail: loose per-limb jitter while tumbling
    if (crashed && !REDMO) {
      const f = Math.min(1, R.crashT * 3);
      for (let i = 0; i < 6; i++) {
        P[i][0] += Math.sin(R.crashT * 17 + i * 2.1) * 4.5 * f;
        P[i][1] += Math.cos(R.crashT * 14 + i * 1.7) * 3.5 * f;
      }
    }
    ctx.save();
    ctx.translate(R.x, R.y + bob);
    ctx.rotate(R.ang);
    ctx.scale(1, sq);
    // boost aura
    if (boost.t > 0 && !REDMO && !crashed) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.24 * (boost.t / boost.dur) * (0.8 + 0.2 * Math.sin(tGlobal * 12));
      const g = ctx.createRadialGradient(0, -14, 2, 0, -14, 42);
      g.addColorStop(0, "#ff9a6a"); g.addColorStop(1, "rgba(255,120,80,0)");
      ctx.fillStyle = g;
      ctx.fillRect(-44, -58, 88, 88);
      ctx.restore();
    }
    if (!crashed) { // (in a crash the board has already torn away)
      drawBoardShape();
      ctx.strokeStyle = pal.rim; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-21, -7); ctx.lineTo(21, -7); ctx.stroke();
    }
    // jointed silhouette: feet -> knees -> hip, torso, head, arm
    ctx.strokeStyle = "#141022"; ctx.fillStyle = "#141022";
    ctx.lineWidth = 5; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(-8, -7); ctx.lineTo(P[0][0], P[0][1]); ctx.lineTo(P[2][0], P[2][1]);
    ctx.moveTo(8, -7); ctx.lineTo(P[1][0], P[1][1]); ctx.lineTo(P[2][0], P[2][1]);
    ctx.stroke();
    ctx.beginPath(); ctx.moveTo(P[2][0], P[2][1]); ctx.quadraticCurveTo(P[2][0] + 3, (P[2][1] + P[3][1]) / 2, P[3][0], P[3][1]); ctx.stroke();
    ctx.beginPath(); ctx.arc(P[4][0], P[4][1], 5.2, 0, 7); ctx.fill();
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(P[3][0], P[3][1] + 2); ctx.lineTo(P[5][0], P[5][1]); ctx.stroke();
    ctx.restore();
    // remember the shoulder in world space — the scarf pins there next frame
    const ca = Math.cos(R.ang), sa = Math.sin(R.ang);
    lastSho = { x: R.x + P[3][0] * ca - P[3][1] * sq * sa, y: R.y + bob + P[3][0] * sa + P[3][1] * sq * ca };
    // scarf (world space, after rider so it lays over the shoulder)
    const n = Math.floor(scarfLen);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (let i = 1; i < n; i++) {
      const t = i / n;
      ctx.strokeStyle = SCARF;
      ctx.globalAlpha = 1 - t * 0.25;
      ctx.lineWidth = lerp(5, 1.2, t);
      ctx.beginPath();
      ctx.moveTo(scarf[i - 1].x, scarf[i - 1].y);
      ctx.lineTo(scarf[i].x, scarf[i].y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* ============================ boot ============================ */
  resetWorld();
  mode = "menu";
  let last = performance.now(), timeScale = 1;
  function frame(now) {
    const dt = clamp((now - last) / 1000, 0, 0.05);
    last = now;
    // gentle slow-motion on real air — flips read, landings still snap back
    const bigAir = mode === "riding" && R.air &&
      (terrainY(R.x) - R.y > 140 || Math.abs(R.spin) > 1 || holding);
    timeScale = lerp(timeScale, bigAir ? 0.82 : 1, Math.min(1, dt * (bigAir ? 4 : 11)));
    update(dt * timeScale);
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
