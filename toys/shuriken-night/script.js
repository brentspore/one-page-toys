/* Shuriken Night — No. 088
 * First-person shuriken throwing in a moonlit castle courtyard.
 *
 * Rendering is vanilla Canvas 2D pseudo-3D: the camera sits at the world origin
 * and only ever yaws, so the courtyard wall, roofline, hills and sky are all
 * cylinders centred on the camera. A cylinder at a fixed radius projects to a
 * horizontal band of constant height, which is why the backdrop can be drawn as
 * bands and profiles rather than meshes. Everything that moves (ninjas, blades,
 * stars, petals) is a real 3D point projected per frame and depth-sorted.
 */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d", { alpha: false });

  var hudEl = document.getElementById("hud");
  var waveEl = document.getElementById("wave");
  var scoreEl = document.getElementById("score");
  var bestEl = document.getElementById("best");
  var lifeEl = document.getElementById("life");
  var comboEl = document.getElementById("combo");
  var markEl = document.querySelector(".hud__mark");
  var abilitiesEl = document.getElementById("abilities");
  var focusBtn = document.getElementById("focusBtn");
  var focusFill = document.getElementById("focusFill");
  var magicBtn = document.getElementById("magicBtn");
  var magicCountEl = document.getElementById("magicCount");
  var soundBtn = document.getElementById("soundBtn");
  var overlay = document.getElementById("overlay");
  var ovEyebrow = document.getElementById("ovEyebrow");
  var ovTitle = document.getElementById("ovTitle");
  var ovText = document.getElementById("ovText");
  var ovBtn = document.getElementById("ovBtn");
  var ovKeys = document.getElementById("ovKeys");
  var modesEl = document.getElementById("modes");
  var modeTurn = document.getElementById("modeTurn");
  var modeStatic = document.getElementById("modeStatic");
  var hintEl = document.getElementById("hint");

  var REDMO = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Touch-primary device: there is no Shift / right-click / space, so the key
  // hints must point at the on-screen Focus/Magic buttons instead.
  var COARSE = (window.matchMedia && window.matchMedia("(pointer: coarse)").matches)
    || ("ontouchstart" in window) || (navigator.maxTouchPoints > 0);

  /* ------------------------------------------------------------- constants */

  var EYE = 1.62; // camera height, metres
  var R_WALL = 18; // courtyard wall radius (also the spawn distance)
  var WALL_H = 4.7;
  // The roof is drawn at radius R_WALL, so a figure entering over it has to
  // stand at that radius too — placing it nearer floated it in mid-courtyard.
  var ROOF_Y = WALL_H + 1.95;

  // World height of the roofline at a given bearing. drawWall sweeps the roof
  // per bay between the ridge and a point 42% back toward the eave, so an
  // attacker running the roof has to follow the SAME curve or it floats over
  // the dips between bays.
  function roofHeight(ang) {
    var bayW = (Math.PI * 2) / N_BAYS;
    var local = ((ang % bayW) + bayW) % bayW;
    var curve = Math.pow(Math.abs(local / bayW - 0.5) * 2, 2.8);
    var ridge = WALL_H + 2.3;
    var eave = WALL_H + 0.15;
    return lerp(ridge, eave + (ridge - eave) * 0.42, curve) - 0.35; // feet sit just into the tiles
  }
  var R_HILL = 220;
  var R_SKY = 900;
  var N_BAYS = 24; // wall sections, each with a paper screen
  var ENEMY_R = 0.44;

  var THROW_SPEED = 42;
  var THROW_COOLDOWN = 0.2;
  var CHARGE_TIME = 0.42; // hold this long for the fan of three
  var FAN_SPREAD = 0.075; // radians between fan stars
  var KUNAI_SPEED = 11;
  var KUNAI_G = 3.4; // must match the integrator in updateKunais
  var THROW_TELL = 0.42; // arm-cocked warning before a blade is released
  var ATTACK_RANGE = 2.9;   // a ninja stops here and winds up
  var ATTACK_WINDUP = 0.44; // seconds of tell before the blade lands

  var FOCUS_SCALE = 0.34;
  var FOCUS_TIME = 3.6;
  var MAGIC_START = 2;
  var MAGIC_FX_TIME = 1.2;
  var MAGIC_READY_TIME = 2.35;

  var BEST_KEY = "shuriken_best";
  var SOUND_KEY = "shuriken_sound";
  // v2 key: the default moved from "turn" to "static", and anyone who had
  // already played carried a saved "turn" that silently beat the new default.
  // Bumping the key retires those once, then choices persist as before.
  var MODE_KEY = "shuriken_mode2";

  var COL = {
    ink: "#05070f",
    inkSoft: "#0a0f22",
    indigo: "#101a3a",
    moon: "#dfe7ff",
    amber: "#ffb765",
    amberDeep: "#e0873a",
    blood: "#e0454b",
    paper: "#f4ecd8",
    jade: "#6fd7c0",
    rim: "rgba(186,206,255,0.55)"
  };

  /* ----------------------------------------------------------------- state */

  var W = 0, H = 0, DPR = 1, focal = 0, horizon = 0, fov = 1.25;
  var yaw = 0, yawVel = 0;
  var mode = "static"; // "turn" | "static" — first-timers start on Hold the line

  var running = false, over = false, started = false;
  var score = 0, best = 0, wave = 0, life = 3;
  var combo = 0, comboT = 0;
  var shake = 0, flashHurt = 0, flashMagic = 0;
  var magicFx = null;
  var strike = null; // the incoming attack currently being animated
  var LOOM = { t: 0, phase: 0, state: "attack", type: "runner", w: 1.15, throwAnim: 0, y: 0, h: 1.8 };
  var dying = false; // fatal blow playing out; gameplay is frozen behind it
  var timeScale = 1, focusT = 0, focusMeter = 0, magic = MAGIC_START;
  var focusWasReady = false; // rising-edge latch for the "focus is ready" flourish
  var hudScore = -1, hudLife = -1; // last values the HUD painted, so animations fire on change only
  var waveBanner = 0, waveBannerText = "";
  var magicReadyT = 0;
  var enemies = [], stars = [], kunais = [], fx = [], petals = [], shards = [];
  var bays = [], skyStars = [], lanterns = [], stoneLanterns = [], hillProfile = [], embers = [], garden = [];
  var spawnQueue = 0, spawnTimer = 0, betweenWaves = 0;

  var aim = { x: 0, y: 0, has: false };
  var charging = false, chargeT = 0, cooldown = 0;
  var soundOn = true;
  var handAnim = 0, handX = 0;

  // Illustrated atlases are decoded once and then drawn as ordinary Canvas
  // images. They replace hundreds of per-frame path operations with one blit,
  // so the visual upgrade is cheaper than the procedural figure it succeeds.
  // The old vector renderer remains as a load/failure fallback.
  function artImage(src) {
    var img = new Image();
    img.decoding = "async";
    img.src = src;
    return img;
  }
  function artFrames(name, count) {
    var out = [];
    for (var i = 0; i < count; i++) out.push(artImage("assets/" + name + "-" + i + ".webp"));
    return out;
  }
  // Individual padded frames prevent wide sprint/weapon poses from sampling a
  // neighbour when Canvas scales the artwork near the edge of the viewport.
  var NINJA_RUNNER_ART = artFrames("ninja-runner", 6);
  var NINJA_BRUTE_ART = artFrames("ninja-brute", 6);
  var NINJA_RUNNER_APPROACH = artFrames("ninja-runner-approach", 4);
  var NINJA_BRUTE_APPROACH = artFrames("ninja-brute-approach", 4);
  var NINJA_RUNNER_ATTACK = artFrames("ninja-runner-attack", 4);
  var NINJA_BRUTE_ATTACK = artFrames("ninja-brute-attack", 4);
  var NINJA_THROWER_ART = artFrames("ninja-thrower", 6);
  var NINJA_THROWER_APPROACH = artFrames("ninja-thrower-approach", 4);
  var NINJA_THROWER_THROW = artFrames("ninja-thrower-throw", 4);
  var NINJA_DROPPER_ART = artFrames("ninja-dropper", 6);
  var NINJA_DROPPER_APPROACH = artFrames("ninja-dropper-approach", 4);
  var NINJA_DROPPER_ATTACK = artFrames("ninja-dropper-attack", 4);
  var PLAYER_HAND_ART = artFrames("player-hand", 3);
  var PROP_V2 = {
    stoneLantern: artImage("assets/prop-v2-stone-lantern.webp"),
    hangingLantern: artImage("assets/prop-v2-hanging-lantern.webp"),
    pine: artImage("assets/prop-v2-pine.webp"),
    shrub: artImage("assets/prop-v2-shrub.webp"),
    rock: artImage("assets/prop-v2-rock.webp"),
    basin: artImage("assets/prop-v2-basin.webp"),
    step: artImage("assets/prop-v2-steps.webp")
  };

  try {
    best = parseInt(localStorage.getItem(BEST_KEY), 10) || 0;
    var sv = localStorage.getItem(SOUND_KEY);
    if (sv === "0") soundOn = false;
    var mv = localStorage.getItem(MODE_KEY);
    if (mv === "static" || mv === "turn") mode = mv;
  } catch (e) {}

  /* ------------------------------------------------------------ math utils */

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
  function angDiff(a, b) {
    var d = (a - b) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  // World -> screen. Camera at origin looking along +z when yaw = 0.
  function project(x, y, z) {
    var c = Math.cos(yaw), s = Math.sin(yaw);
    var rz = x * s + z * c;
    var rx = x * c - z * s;
    if (rz <= 0.08) return null;
    return {
      x: W * 0.5 + (focal * rx) / rz,
      y: horizon - (focal * (y - EYE)) / rz,
      s: focal / rz,
      z: rz
    };
  }

  // Screen point -> unit direction in world space (for aiming).
  function unproject(sx, sy) {
    var cx = (sx - W * 0.5) / focal;
    var cy = (horizon - sy) / focal;
    var len = Math.sqrt(cx * cx + cy * cy + 1);
    cx /= len; cy /= len;
    var cz = 1 / len;
    var c = Math.cos(yaw), s = Math.sin(yaw);
    return { x: cx * c + cz * s, y: cy, z: -cx * s + cz * c };
  }

  // Horizontal screen x for a world bearing, used for the cylindrical backdrop.
  function bearingX(ang) {
    var d = angDiff(ang, yaw);
    if (Math.abs(d) > 1.45) return null;
    return W * 0.5 + focal * Math.tan(d);
  }

  function cylY(height, radius) {
    return horizon - (focal * (height - EYE)) / radius;
  }

  /* ---------------------------------------------------------------- resize */

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    // World scale is keyed to the LONG edge, not the width. Keying it to width
    // shrank the whole courtyard to a thin strip in portrait (small W = small
    // focal = tiny wall) while still cramming five windows across. Keying to
    // the long edge keeps `focal` — and therefore enemy size, spawn distance
    // and difficulty — constant when the phone rotates; portrait simply shows
    // a NARROWER horizontal slice (about 2-3 windows) of the same world.
    var aspect = W / H;
    var longEdge = Math.max(W, H);
    var FOV_LONG = 1.34; // ~77 degrees across the long edge
    focal = longEdge * 0.5 / Math.tan(FOV_LONG * 0.5);
    // The true horizontal field of view for THIS orientation — what staticArc,
    // the drag sensitivity and the edge-threat test all read.
    fov = 2 * Math.atan(W / (2 * focal));
    // Portrait has height to spare, so drop the horizon a touch to sit the wall
    // and the action lower and cut the dead sky above it.
    horizon = H * (aspect < 0.85 ? 0.52 : 0.47);
    GROUND_TEX = null; WALL_TEX = null; // geometry moved: baked layers must be rebuilt
    if (!aim.has) { aim.x = W * 0.5; aim.y = H * 0.5; }
    else { aim.x = clamp(aim.x, 0, W); aim.y = clamp(aim.y, 0, H); } // keep the reticle in frame after a rotate

    // Rotating into portrait narrows the horizontal FOV. In Hold-the-line you
    // cannot turn, so any enemy that spawned at a wide angle under the old lens
    // would now be stuck off-screen and unkillable while it walks in to hit
    // you. Pull the active ones back inside the new visible arc so the fight
    // stays fair through a rotation.
    if (mode !== "turn" && typeof enemies !== "undefined") {
      var lim = staticArc();
      for (var ri = 0; ri < enemies.length; ri++) {
        var re = enemies[ri];
        if (re.state === "shoji" || re.state === "dead") continue;
        var sa = angDiff(re.ang, 0);
        if (sa > lim) re.ang = lim;
        else if (sa < -lim) re.ang = -lim;
        if (re.x !== undefined) syncPos(re);
      }
    }
  }
  window.addEventListener("resize", resize);
  // iOS Safari often reports the OLD innerWidth/innerHeight for a beat after
  // an orientationchange fires, so a single immediate resize() locks in stale
  // dimensions and the canvas ends up letterboxed until the next touch. Re-run
  // it a few times across the rotation settle, and again when the visual
  // viewport itself changes (address bar, split view).
  window.addEventListener("orientationchange", function () {
    resize();
    setTimeout(resize, 120);
    setTimeout(resize, 320);
    setTimeout(resize, 600);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", resize);
  }

  /* ------------------------------------------------------------ world seed */

  function buildWorld() {
    bays = [];
    for (var i = 0; i < N_BAYS; i++) {
      var a = (i / N_BAYS) * Math.PI * 2;
      var on = Math.random() < 0.78;
      var bl = on ? rand(0.55, 0.92) : 0.1;
      bays.push({ ang: a, baseLit: bl, glow: bl, broken: 0, sil: null });
    }
    skyStars = [];
    for (var j = 0; j < 190; j++) {
      skyStars.push({
        ang: rand(0, Math.PI * 2),
        h: rand(EYE + 12, EYE + 340),
        r: rand(0.5, 1.7),
        tw: rand(0, 6.283),
        sp: rand(0.6, 2.2)
      });
    }
    // A lantern hangs under the eaves between every pair of paper screens, so
    // the wall reads as a rhythmic row of warm points rather than scattered blobs.
    lanterns = [];
    for (var k = 0; k < N_BAYS; k += 2) {
      lanterns.push({
        ang: ((k + 0.5) / N_BAYS) * Math.PI * 2,
        r: R_WALL - 0.7,
        h: 4.0,
        sw: rand(0, 6.283),
        sz: 0.34,
        hang: true
      });
    }
    // A few freestanding stone lanterns out in the yard for midground depth.
    stoneLanterns = [];
    for (var sl = 0; sl < 5; sl++) {
      stoneLanterns.push({
        ang: rand(0, Math.PI * 2),
        r: rand(10, 16),
        h: 1.5,
        sw: rand(0, 6.283)
      });
    }
    hillProfile = [];
    for (var m = 0; m < 96; m++) {
      hillProfile.push(
        16 + Math.sin(m * 0.7) * 5 + Math.sin(m * 0.23 + 1.4) * 9 + Math.sin(m * 1.9) * 2.2
      );
    }
    petals = [];
    var nP = REDMO ? 24 : 70;
    for (var p = 0; p < nP; p++) petals.push(newPetal(true));

    // Garden furniture along the foot of the veranda: set rocks, clipped shrubs,
    // stepping stones and a pine. The courtyard was a bare floor meeting a wall;
    // this is the register that makes it read as an estate garden.
    garden = [];
    for (var gi = 0; gi < 26; gi++) {
      var ga = (gi / 26) * Math.PI * 2 + rand(-0.06, 0.06);
      var roll = Math.random();
      var kind = roll < 0.28 ? "rock" : roll < 0.52 ? "shrub" : roll < 0.74 ? "step" : roll < 0.9 ? "pine" : "basin";
      garden.push({
        ang: ga,
        r: kind === "step" ? rand(11.5, 14.5) : rand(15.2, 16.6),
        kind: kind,
        sz: kind === "pine" ? rand(0.85, 1.25) : kind === "shrub" ? rand(0.45, 0.75) : kind === "basin" ? rand(0.48, 0.68) : rand(0.3, 0.58),
        sk: rand(0.75, 1.3),
        ph: rand(0, 6.283)
      });
    }

    // Embers hang near the lanterns rather than drifting the whole yard, so a
    // handful reads as heat off the flames instead of generic floating dust.
    embers = [];
    if (!REDMO) {
      var nE = 26;
      for (var em = 0; em < nE; em++) {
        var host = stoneLanterns.length
          ? stoneLanterns[(Math.random() * stoneLanterns.length) | 0]
          : { ang: rand(0, Math.PI * 2), r: 12 };
        embers.push({
          ang: host.ang + rand(-0.09, 0.09),
          r: host.r + rand(-1.1, 1.1),
          y: rand(0.4, 3.2),
          vy: rand(0.16, 0.5),
          drift: rand(-0.05, 0.05),
          a: rand(0.25, 0.75),
          life: rand(1.5, 5),
          host: host
        });
      }
    }
  }

  function newPetal(anywhere) {
    var a = rand(0, Math.PI * 2), r = rand(3, 26);
    return {
      x: Math.sin(a) * r,
      y: anywhere ? rand(0.2, 7) : rand(5.5, 8),
      z: Math.cos(a) * r,
      vy: rand(-0.42, -0.16),
      vx: rand(-0.3, 0.3),
      vz: rand(-0.3, 0.3),
      sp: rand(0, 6.283),
      spd: rand(1.4, 3.4),
      sz: rand(0.016, 0.04)
    };
  }

  /* ----------------------------------------------------------------- audio */

  var AC = null, master = null, busComp = null, busLP = null, reverb = null, outGain = null;
  var ambGain = null, musicGain = null, ambNodes = [];
  var ambientPhrase = 0;

  function initAudio() {
    if (AC) return;
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    AC = new Ctx();

    outGain = AC.createGain();
    outGain.gain.value = soundOn ? 1 : 0;

    busLP = AC.createBiquadFilter();
    busLP.type = "lowpass";
    busLP.frequency.value = 12000;
    busLP.Q.value = 0.4;

    busComp = AC.createDynamicsCompressor();
    busComp.threshold.value = -15;
    busComp.ratio.value = 3;
    busComp.attack.value = 0.004;
    busComp.release.value = 0.22;

    master = AC.createGain();
    master.gain.value = 0.92;

    reverb = AC.createConvolver();
    reverb.buffer = courtyardImpulse(2.1);
    var revGain = AC.createGain();
    revGain.gain.value = 0.85;
    var revHS = AC.createBiquadFilter();
    revHS.type = "highshelf";
    revHS.frequency.value = 3200;
    revHS.gain.value = 3.5;
    var revHP = AC.createBiquadFilter();
    revHP.type = "highpass";
    revHP.frequency.value = 190;

    reverb.connect(revHP); revHP.connect(revHS); revHS.connect(revGain); revGain.connect(master);
    master.connect(busComp); busComp.connect(busLP); busLP.connect(outGain); outGain.connect(AC.destination);

    // iOS unlock: a single silent sample inside the first gesture.
    try {
      var b = AC.createBuffer(1, 1, 22050);
      var s = AC.createBufferSource();
      s.buffer = b; s.connect(AC.destination); s.start(0);
    } catch (e) {}
    if (AC.state === "suspended") AC.resume();

    startAmbience();
  }

  function courtyardImpulse(sec) {
    var len = Math.floor(AC.sampleRate * sec);
    var buf = AC.createBuffer(2, len, AC.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      var lp = 0;
      for (var i = 0; i < len; i++) {
        var t = i / len;
        // Low-pass the noise so the tail is smooth rather than grainy.
        lp += (Math.random() * 2 - 1 - lp) * 0.34;
        d[i] = lp * Math.pow(1 - t, 2.5) * (1 - t * 0.25);
      }
    }
    return buf;
  }

  // One shared noise bed, reused by every voice. Allocating a fresh buffer per
  // throw churned the heap badly during a heavy wave.
  var NOISE = null;
  function noiseBuf() {
    if (!NOISE) {
      var len = Math.floor(AC.sampleRate * 1.2);
      NOISE = AC.createBuffer(1, len, AC.sampleRate);
      var d = NOISE.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return NOISE;
  }

  function voice(dest, panVal, wet) {
    var g = AC.createGain();
    var p = AC.createStereoPanner ? AC.createStereoPanner() : null;
    if (p) { p.pan.value = clamp(panVal || 0, -1, 1); g.connect(p); p.connect(master); }
    else g.connect(master);
    if (wet && reverb) {
      var s = AC.createGain();
      s.gain.value = wet;
      g.connect(s); s.connect(reverb);
    }
    return g;
  }

  function panOf(x) { return clamp((x / W - 0.5) * 1.7, -1, 1); }

  // Struck metal WITHOUT the ding. A pure sine at 2kHz reads as a doorbell; a
  // very high-Q bandpass ringing on noise reads as metal, because the noise
  // keeps the partial slightly unstable the way real bronze and steel are.
  function metalRes(freq, q, amp, dur, t, pan, wet) {
    var n = AC.createBufferSource();
    n.buffer = noiseBuf();
    n.playbackRate.value = rand(0.85, 1.15);
    var bp = AC.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = freq;
    bp.Q.value = q;
    var g = voice(null, pan, wet == null ? 0.5 : wet);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(amp, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(bp); bp.connect(g);
    n.start(t); n.stop(t + dur + 0.02);
  }

  // THROW — a spinning steel star leaving your hand.
  // The signature isn't the whoosh, it's the FLUTTER: four blades chopping air
  // amplitude-modulate the rush at a few dozen Hz, and that chop is what the
  // ear hears as "shuriken" rather than "someone waved a stick".
  function sndThrow(pan) {
    if (!AC || !soundOn) return;
    var t = AC.currentTime;
    var out = voice(null, pan, 0.16);

    var n = AC.createBufferSource();
    n.buffer = noiseBuf();
    n.playbackRate.value = rand(0.92, 1.14);
    var hp = AC.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 480;
    var bp = AC.createBiquadFilter();
    bp.type = "bandpass"; bp.Q.value = 2.3;
    // rises as it leaves the hand, falls away as it travels off (doppler)
    bp.frequency.setValueAtTime(950, t);
    bp.frequency.exponentialRampToValueAtTime(3600, t + 0.055);
    bp.frequency.exponentialRampToValueAtTime(1000, t + 0.3);

    // blade chop — a sawtooth LFO on gain, slowing as the star spins down
    var chop = AC.createGain();
    chop.gain.value = 1;
    var lfo = AC.createOscillator();
    lfo.type = "sawtooth";
    lfo.frequency.setValueAtTime(rand(52, 66), t);
    lfo.frequency.exponentialRampToValueAtTime(30, t + 0.32);
    var lfoG = AC.createGain();
    lfoG.gain.value = 0.52;
    lfo.connect(lfoG); lfoG.connect(chop.gain);

    var env = AC.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.62, t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);

    n.connect(hp); hp.connect(bp); bp.connect(chop); chop.connect(env); env.connect(out);
    n.start(t); n.stop(t + 0.34);
    lfo.start(t); lfo.stop(t + 0.34);
  }

  // SLASH — a blade cutting air, then the edge ringing.
  // Much faster and more focused than a throw: a tight high-Q sweep that peaks
  // in ~70ms (the swing passing you), followed by the steel singing.
  function sndSlash(pan, big) {
    if (!AC || !soundOn) return;
    var t = AC.currentTime;
    var out = voice(null, pan, big ? 0.42 : 0.24);

    var n = AC.createBufferSource();
    n.buffer = noiseBuf();
    n.playbackRate.value = rand(1.0, 1.3);
    var bp = AC.createBiquadFilter();
    bp.type = "bandpass"; bp.Q.value = 3.6;
    bp.frequency.setValueAtTime(480, t);
    bp.frequency.exponentialRampToValueAtTime(big ? 7200 : 5400, t + 0.07);
    bp.frequency.exponentialRampToValueAtTime(820, t + 0.22);
    var env = AC.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(big ? 0.62 : 0.6, t + 0.028);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    n.connect(bp); bp.connect(env); env.connect(out);
    n.start(t); n.stop(t + 0.28);

    // The cut itself: a fast downward resonant tear right behind the whoosh.
    // This is the layer that makes it read as something being CUT rather than
    // just air moving.
    var tc = t + 0.045;
    var tear = AC.createBufferSource();
    tear.buffer = noiseBuf();
    tear.playbackRate.value = rand(0.9, 1.1);
    var tbp = AC.createBiquadFilter();
    tbp.type = "bandpass"; tbp.Q.value = 6.5;
    tbp.frequency.setValueAtTime(big ? 3200 : 2600, tc);
    tbp.frequency.exponentialRampToValueAtTime(big ? 320 : 520, tc + (big ? 0.3 : 0.18));
    var tgn = voice(null, pan, 0.35);
    tgn.gain.setValueAtTime(0.0001, tc);
    tgn.gain.exponentialRampToValueAtTime(big ? 0.44 : 0.38, tc + 0.012);
    tgn.gain.exponentialRampToValueAtTime(0.0001, tc + (big ? 0.34 : 0.2));
    tear.connect(tbp); tbp.connect(tgn);
    tear.start(tc); tear.stop(tc + (big ? 0.36 : 0.22));

    // edge shimmer — resonant noise, not sine partials, so no doorbell
    metalRes(big ? 1500 : 2050, big ? 13 : 15, big ? 0.13 : 0.12, big ? 0.9 : 0.45, tc, pan, 0.5);
    metalRes(big ? 3620 : 4900, 12, big ? 0.06 : 0.045, big ? 0.5 : 0.24, tc, pan, 0.5);

    // a heavy cleave under the big one
    if (big) {
      var lo = AC.createOscillator(), lg = voice(null, pan, 0.3);
      lo.type = "sine";
      lo.frequency.setValueAtTime(150, tc);
      lo.frequency.exponentialRampToValueAtTime(46, tc + 0.16);
      lg.gain.setValueAtTime(0.0001, tc);
      lg.gain.exponentialRampToValueAtTime(0.3, tc + 0.008);
      lg.gain.exponentialRampToValueAtTime(0.0001, tc + 0.17);
      lo.connect(lg); lo.start(tc); lo.stop(tc + 0.26);
    }
  }

  // HIT — steel landing in a body. A slap transient plus a very SHORT low
  // thump. The low body has to stay under ~80ms: stretch it out and the ear
  // stops hearing an impact and starts hearing a bass note.
  function sndHit(pan, head) {
    if (!AC || !soundOn) return;
    var t = AC.currentTime;

    // contact slap — this is the layer that actually reads as "impact"
    var n = AC.createBufferSource();
    n.buffer = noiseBuf();
    n.playbackRate.value = rand(0.8, 1.1);
    var bpn = AC.createBiquadFilter();
    bpn.type = "bandpass"; bpn.Q.value = 0.85;
    bpn.frequency.setValueAtTime(head ? 1500 : 760, t);
    bpn.frequency.exponentialRampToValueAtTime(head ? 420 : 210, t + 0.05);
    var ng = voice(null, pan, 0.12);
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(head ? 0.62 : 0.52, t + 0.004);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);
    n.connect(bpn); bpn.connect(ng);
    n.start(t); n.stop(t + 0.09);

    // short low body
    var o = AC.createOscillator(), g = voice(null, pan, 0.1);
    o.type = "sine";
    o.frequency.setValueAtTime(head ? 140 : 108, t);
    o.frequency.exponentialRampToValueAtTime(head ? 56 : 44, t + 0.055);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.085);
    o.connect(g); o.start(t); o.stop(t + 0.095);

    // STEEL BITE — the edge going in. A very short bright click is what turns
    // a generic thud into "something sharp just landed".
    var c = AC.createBufferSource();
    c.buffer = noiseBuf();
    c.playbackRate.value = rand(1.1, 1.4);
    var chp = AC.createBiquadFilter();
    chp.type = "highpass"; chp.frequency.value = head ? 3000 : 2200;
    var cg = voice(null, pan, 0.26);
    cg.gain.setValueAtTime(head ? 0.46 : 0.36, t);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + (head ? 0.045 : 0.03));
    c.connect(chp); chp.connect(cg);
    c.start(t); c.stop(t + 0.06);

    // the star still shivering where it stuck
    metalRes(head ? 2700 : 2100, 14, head ? 0.085 : 0.065, head ? 0.34 : 0.24, t + 0.012, pan, 0.4);
    metalRes(head ? 5100 : 4200, 11, 0.04, 0.16, t + 0.012, pan, 0.4);
  }

  // Deflect: struck steel. Inharmonic partials, bright, lots of room.
  function sndDeflect(pan) {
    if (!AC || !soundOn) return;
    var t = AC.currentTime;
    // Steel on steel. Resonant noise rather than sine partials, so it rings
    // like two blades colliding instead of a chime.
    var base = rand(1500, 2000);
    metalRes(base, 16, 0.17, 0.5, t, pan, 0.6);
    metalRes(base * 2.76, 13, 0.1, 0.3, t, pan, 0.6);
    metalRes(base * 5.4, 10, 0.055, 0.18, t, pan, 0.6);
    // the contact spark
    var n = AC.createBufferSource(), ng = voice(null, pan, 0.3);
    n.buffer = noiseBuf();
    var hp = AC.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 3600;
    ng.gain.setValueAtTime(0.22, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    n.connect(hp); hp.connect(ng); n.start(t); n.stop(t + 0.06);
  }

  // A star glancing off scenery: much shorter and drier than the rewarded
  // steel-on-steel kunai deflect, with a softer rustle for foliage.
  function sndPropDeflect(kind, pan) {
    if (!AC || !soundOn) return;
    var t = AC.currentTime;
    var foliage = kind === "pine" || kind === "shrub";
    var lantern = kind === "stoneLantern" || kind === "hangingLantern";
    var n = AC.createBufferSource(), g = voice(null, pan, foliage ? 0.08 : 0.18);
    n.buffer = noiseBuf();
    n.playbackRate.value = foliage ? rand(0.75, 0.95) : rand(1.1, 1.4);
    var bp = AC.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = foliage ? 0.8 : 2.6;
    bp.frequency.setValueAtTime(foliage ? 1150 : 2600, t);
    bp.frequency.exponentialRampToValueAtTime(foliage ? 430 : 720, t + 0.08);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(foliage ? 0.2 : 0.28, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (foliage ? 0.13 : 0.09));
    n.connect(bp); bp.connect(g); n.start(t); n.stop(t + 0.15);
    if (!foliage) {
      metalRes(lantern ? 1850 : 1450, lantern ? 12 : 7, lantern ? 0.055 : 0.035,
        lantern ? 0.16 : 0.1, t + 0.006, pan, lantern ? 0.28 : 0.12);
    }
  }


  // Paper screen bursting: a tear plus the wooden lattice cracking.
  function sndShoji(pan) {
    if (!AC || !soundOn) return;
    var t = AC.currentTime;
    var n = AC.createBufferSource(), ng = voice(null, pan, 0.34);
    n.buffer = noiseBuf(0.26);
    var bp = AC.createBiquadFilter();
    bp.type = "bandpass"; bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(3800, t);
    bp.frequency.exponentialRampToValueAtTime(760, t + 0.22);
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.26, t + 0.01);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    n.connect(bp); bp.connect(ng); n.start(t); n.stop(t + 0.28);
    var o = AC.createOscillator(), g = voice(null, pan, 0.3);
    o.type = "triangle";
    o.frequency.setValueAtTime(210, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.07);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(g); o.start(t); o.stop(t + 0.12);
  }

  // TAKING A HIT — a blow landing on YOU. Heavy, close, and it briefly knocks
  // the wind out of the mix: the whole bus muffles and swims back.
  function sndHurt(fatal) {
    if (!AC || !soundOn) return;
    var t = AC.currentTime;

    // body blow: thick mid thud
    var n = AC.createBufferSource();
    n.buffer = noiseBuf();
    n.playbackRate.value = rand(0.7, 0.9);
    var bp = AC.createBiquadFilter();
    bp.type = "lowpass"; bp.frequency.setValueAtTime(2200, t);
    bp.frequency.exponentialRampToValueAtTime(420, t + 0.14);
    var ng = voice(null, 0, 0.2);
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(fatal ? 0.78 : 0.66, t + 0.005);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    n.connect(bp); bp.connect(ng); n.start(t); n.stop(t + 0.22);

    // mid thwack — the body of the blow, and what keeps it from reading as a tone
    var mw = AC.createBufferSource();
    mw.buffer = noiseBuf();
    mw.playbackRate.value = rand(0.75, 0.95);
    var mbp = AC.createBiquadFilter();
    mbp.type = "bandpass"; mbp.Q.value = 1.1;
    mbp.frequency.setValueAtTime(620, t);
    mbp.frequency.exponentialRampToValueAtTime(180, t + 0.1);
    var mwg = voice(null, 0, 0.24);
    mwg.gain.setValueAtTime(0.0001, t);
    mwg.gain.exponentialRampToValueAtTime(fatal ? 0.6 : 0.5, t + 0.005);
    mwg.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    mw.connect(mbp); mbp.connect(mwg); mw.start(t); mw.stop(t + 0.15);

    // sub punch
    var o = AC.createOscillator(), g = voice(null, 0, 0.28);
    o.type = "sine";
    o.frequency.setValueAtTime(fatal ? 120 : 96, t);
    o.frequency.exponentialRampToValueAtTime(fatal ? 34 : 42, t + (fatal ? 0.26 : 0.08));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(fatal ? 0.52 : 0.4, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (fatal ? 0.36 : 0.11));
    o.connect(g); o.start(t); o.stop(t + (fatal ? 0.45 : 0.2));

    // the world goes muffled for a moment
    if (busLP) {
      busLP.frequency.cancelScheduledValues(t);
      busLP.frequency.setValueAtTime(700, t);
      busLP.frequency.exponentialRampToValueAtTime(12000, t + (fatal ? 2.2 : 0.8));
    }
  }

  // DEATH — the killing blow, then a temple gong tolling out over the
  // courtyard. The gong is the part that says "this is the end" rather than
  // "that hurt": a big inharmonic bronze cluster with a very long decay,
  // pitch-bending down as it rings, under a sub that falls away to nothing.
  function sndFatal(kind) {
    if (!AC || !soundOn) return;
    var t = AC.currentTime + 0.04;

    // the weapon itself
    if (kind === "melee") sndSlash(0, true);
    else {
      // a thrown blade burying itself: sharp crack, then metal shivering
      var n = AC.createBufferSource(), ng = voice(null, 0, 0.4);
      n.buffer = noiseBuf();
      var hp = AC.createBiquadFilter();
      hp.type = "highpass"; hp.frequency.value = 1800;
      ng.gain.setValueAtTime(0.45, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      n.connect(hp); hp.connect(ng); n.start(t); n.stop(t + 0.1);
      var shiv = AC.createOscillator(), sg = voice(null, 0, 0.6);
      shiv.type = "triangle";
      shiv.frequency.setValueAtTime(2400, t);
      shiv.frequency.exponentialRampToValueAtTime(900, t + 0.5);
      var trem = AC.createGain(); trem.gain.value = 1;
      var tl = AC.createOscillator(); tl.type = "sine"; tl.frequency.value = 34;
      var tlg = AC.createGain(); tlg.gain.value = 0.6;
      tl.connect(tlg); tlg.connect(trem.gain);
      sg.gain.setValueAtTime(0.0001, t);
      sg.gain.exponentialRampToValueAtTime(0.14, t + 0.01);
      sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      shiv.connect(trem); trem.connect(sg);
      shiv.start(t); shiv.stop(t + 0.58); tl.start(t); tl.stop(t + 0.58);
    }

    // TEMPLE GONG DEATH KNELL.
    // A gong is not a bell. A bell is a few clean partials (that's a ding); a
    // gong is a low bronze body under a dense, unstable cluster of inharmonic
    // metal, plus a SHIMMER THAT BLOOMS IN AFTER the strike as energy spills
    // upward through the plate. The bloom is the part that makes it sound huge.
    var tg = t + 0.24;
    var base = 58;

    // low bronze body — sines here give weight without ringing like a bell
    var body = [1, 1.47, 2.09];
    for (var i = 0; i < body.length; i++) {
      var o = AC.createOscillator(), g = voice(null, rand(-0.2, 0.2), 0.85);
      o.type = "sine";
      var f = base * body[i];
      o.frequency.setValueAtTime(f * 1.02, tg);
      o.frequency.exponentialRampToValueAtTime(f, tg + 2.2); // pitch settles as it rings
      var amp = 0.17 / (1 + i * 0.7);
      var dur = 7 / (1 + i * 0.45);
      g.gain.setValueAtTime(0.0001, tg);
      g.gain.exponentialRampToValueAtTime(amp, tg + 0.014);
      g.gain.exponentialRampToValueAtTime(0.0001, tg + dur);
      o.connect(g); o.start(tg); o.stop(tg + dur + 0.05);
    }

    // dense inharmonic metal, detuned so the partials beat against each other
    var mets = [2.74, 3.61, 4.55, 5.83, 7.12, 8.94, 11.3, 14.1];
    for (var m2 = 0; m2 < mets.length; m2++) {
      var mf = base * mets[m2] * rand(0.994, 1.006);
      metalRes(mf, 11 + m2 * 1.6, 0.125 / (1 + m2 * 0.42), 5.5 / (1 + m2 * 0.4),
        tg + m2 * 0.006, rand(-0.5, 0.5), 0.9);
    }

    // the bloom: a wash that swells IN over ~0.7s, opening upward
    var wash = AC.createBufferSource();
    wash.buffer = noiseBuf();
    wash.loop = true;
    var wbp = AC.createBiquadFilter();
    wbp.type = "bandpass"; wbp.Q.value = 1.4;
    wbp.frequency.setValueAtTime(400, tg);
    wbp.frequency.exponentialRampToValueAtTime(2600, tg + 1.1);
    wbp.frequency.exponentialRampToValueAtTime(700, tg + 4.5);
    var wg = voice(null, 0, 0.95);
    wg.gain.setValueAtTime(0.0001, tg);
    wg.gain.exponentialRampToValueAtTime(0.17, tg + 0.7); // blooms after the strike
    wg.gain.exponentialRampToValueAtTime(0.0001, tg + 4.8);
    wash.connect(wbp); wbp.connect(wg);
    wash.start(tg); wash.stop(tg + 5);

    // the mallet landing on bronze
    var mm = AC.createBufferSource(), mg = voice(null, 0, 0.7);
    mm.buffer = noiseBuf();
    var mlp = AC.createBiquadFilter();
    mlp.type = "lowpass"; mlp.frequency.value = 900;
    mg.gain.setValueAtTime(0.42, tg);
    mg.gain.exponentialRampToValueAtTime(0.0001, tg + 0.17);
    mm.connect(mlp); mlp.connect(mg); mm.start(tg); mm.stop(tg + 0.19);

    // sub falling away under everything
    var lo = AC.createOscillator(), lg = voice(null, 0, 0.7);
    lo.type = "sine";
    lo.frequency.setValueAtTime(64, tg);
    lo.frequency.exponentialRampToValueAtTime(24, tg + 2.4);
    lg.gain.setValueAtTime(0.0001, tg);
    lg.gain.exponentialRampToValueAtTime(0.42, tg + 0.03);
    lg.gain.exponentialRampToValueAtTime(0.0001, tg + 2.6);
    lo.connect(lg); lo.start(tg); lo.stop(tg + 2.65);
  }


  function sndMagic() {
    if (!AC || !soundOn) return;
    var t = AC.currentTime;
    var o = AC.createOscillator(), g = voice(null, 0, 0.6);
    o.type = "sine";
    o.frequency.setValueAtTime(88, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.7);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
    o.connect(g); o.start(t); o.stop(t + 0.9);
    var n = AC.createBufferSource(), ng = voice(null, 0, 0.7);
    n.buffer = noiseBuf(0.8);
    var bp = AC.createBiquadFilter();
    bp.type = "bandpass"; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.exponentialRampToValueAtTime(7000, t + 0.42);
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.3, t + 0.05);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    n.connect(bp); bp.connect(ng); n.start(t); n.stop(t + 0.82);
  }

  function sndMagicReady() {
    if (!AC || !soundOn) return;
    var t = AC.currentTime + 0.08;
    var notes = [523.25, 659.25, 987.77];
    for (var i = 0; i < notes.length; i++) {
      var o = AC.createOscillator(), g = voice(null, 0, 0.22);
      o.type = i === 2 ? "sine" : "triangle";
      o.frequency.setValueAtTime(notes[i], t + i * 0.09);
      g.gain.setValueAtTime(0.0001, t + i * 0.09);
      g.gain.exponentialRampToValueAtTime(i === 2 ? 0.17 : 0.11, t + i * 0.09 + 0.018);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.48);
      o.connect(g); o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.5);
    }
  }

  function sndFocus(on) {
    if (!AC || !soundOn) return;
    var t = AC.currentTime;
    var o = AC.createOscillator(), g = voice(null, 0, 0.45);
    o.type = "sine";
    o.frequency.setValueAtTime(on ? 620 : 260, t);
    o.frequency.exponentialRampToValueAtTime(on ? 240 : 640, t + 0.4);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(g); o.start(t); o.stop(t + 0.5);
  }

  // Wave cleared: a short koto-flavoured pentatonic run.
  function sndWave() {
    if (!AC || !soundOn) return;
    var t0 = AC.currentTime;
    var notes = [523.25, 587.33, 698.46, 783.99, 1046.5];
    for (var i = 0; i < notes.length; i++) {
      (function (i) {
        var t = t0 + i * 0.085;
        var o = AC.createOscillator(), o2 = AC.createOscillator();
        var g = voice(null, (i - 2) * 0.16, 0.55);
        o.type = "triangle"; o2.type = "sine";
        o.frequency.value = notes[i];
        o2.frequency.value = notes[i] * 2.001;
        var g2 = AC.createGain(); g2.gain.value = 0.3;
        var lp = AC.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.setValueAtTime(5200, t);
        lp.frequency.exponentialRampToValueAtTime(1400, t + 0.6);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.2, t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
        o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g);
        o.start(t); o2.start(t); o.stop(t + 0.8); o2.stop(t + 0.8);
      })(i);
    }
  }

  function sndBell() {
    if (!AC || !soundOn) return;
    var t = AC.currentTime, base = 138;
    var ratios = [1, 2.76, 5.4, 8.93];
    for (var i = 0; i < ratios.length; i++) {
      var o = AC.createOscillator(), g = voice(null, rand(-0.4, 0.4), 0.85);
      o.type = "sine";
      o.frequency.value = base * ratios[i];
      var amp = 0.085 / (1 + i * 1.5);
      var dur = 5.5 / (1 + i * 0.85);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(amp, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); o.start(t); o.stop(t + dur + 0.05);
    }
  }

  // Night bed: wind, crickets, a restrained musical layer, and an occasional
  // distant temple bell. Everything is synthesized once the player has made a
  // gesture, so the ambience adds no downloaded audio and very little CPU.
  function startAmbience() {
    if (!AC || ambGain) return;
    ambGain = AC.createGain();
    ambGain.gain.value = 0.5;
    ambGain.connect(master);

    var wind = AC.createBufferSource();
    wind.buffer = noiseBuf(4);
    wind.loop = true;
    var wlp = AC.createBiquadFilter();
    wlp.type = "lowpass"; wlp.frequency.value = 420; wlp.Q.value = 0.7;
    var wg = AC.createGain(); wg.gain.value = 0.1;
    var lfo = AC.createOscillator(), lfoG = AC.createGain();
    lfo.frequency.value = 0.06; lfoG.gain.value = 200;
    lfo.connect(lfoG); lfoG.connect(wlp.frequency);
    wind.connect(wlp); wlp.connect(wg); wg.connect(ambGain);
    wind.start(); lfo.start();
    ambNodes.push(wind, lfo);

    startAmbientMusic();
    scheduleCricket();
    scheduleBell();
  }

  // A nearly subliminal D/A drone under sparse minor-pentatonic phrases. The
  // long envelopes keep it atmospheric instead of turning combat into a song.
  function startAmbientMusic() {
    musicGain = AC.createGain();
    musicGain.gain.value = 0.34;
    musicGain.connect(ambGain);

    var droneFilter = AC.createBiquadFilter();
    droneFilter.type = "lowpass";
    droneFilter.frequency.value = 310;
    droneFilter.Q.value = 0.45;
    droneFilter.connect(musicGain);

    var droneGain = AC.createGain();
    droneGain.gain.setValueAtTime(0.0001, AC.currentTime);
    droneGain.gain.exponentialRampToValueAtTime(0.026, AC.currentTime + 5);
    droneGain.connect(droneFilter);

    var roots = [73.42, 110]; // D2 and A2
    for (var i = 0; i < roots.length; i++) {
      var o = AC.createOscillator();
      o.type = i ? "sine" : "triangle";
      o.frequency.value = roots[i];
      o.detune.value = i ? 3 : -3;
      var og = AC.createGain();
      og.gain.value = i ? 0.34 : 0.52;
      o.connect(og); og.connect(droneGain); o.start();
      ambNodes.push(o);
    }

    playAmbientPhrase(AC.currentTime + 1.4);
    scheduleAmbientPhrase();
  }

  function ambientTone(freq, t, dur, pan, amp) {
    var o = AC.createOscillator(), overtone = AC.createOscillator();
    var og = AC.createGain(), g = AC.createGain();
    var lp = AC.createBiquadFilter();
    var p = AC.createStereoPanner ? AC.createStereoPanner() : null;
    var wet = AC.createGain();

    o.type = "sine"; o.frequency.value = freq;
    overtone.type = "triangle"; overtone.frequency.value = freq * 2;
    og.gain.value = 0.075;
    lp.type = "lowpass"; lp.frequency.value = 1050; lp.Q.value = 0.5;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(amp, t + 0.42);
    g.gain.setValueAtTime(amp, t + Math.max(0.5, dur - 1.4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    o.connect(lp); overtone.connect(og); og.connect(lp); lp.connect(g);
    if (p) { p.pan.value = pan; g.connect(p); p.connect(musicGain); }
    else g.connect(musicGain);
    wet.gain.value = 0.72;
    g.connect(wet); wet.connect(reverb);
    o.start(t); overtone.start(t);
    o.stop(t + dur + 0.05); overtone.stop(t + dur + 0.05);
  }

  function playAmbientPhrase(t) {
    if (!AC || !soundOn || !musicGain) return;
    var scale = [146.83, 174.61, 196, 220, 261.63]; // D minor pentatonic
    var phrases = [
      [0, 2, 1],
      [3, 2, 0],
      [1, 4, 3],
      [2, 1, 0]
    ];
    var notes = phrases[ambientPhrase++ % phrases.length];
    for (var i = 0; i < notes.length; i++) {
      ambientTone(scale[notes[i]], t + i * 1.55, 3.8, -0.32 + i * 0.32, 0.026 - i * 0.003);
    }
  }

  function scheduleAmbientPhrase() {
    setTimeout(function () {
      if (AC && soundOn && musicGain && document.visibilityState === "visible") {
        playAmbientPhrase(AC.currentTime + 0.15);
      }
      scheduleAmbientPhrase();
    }, rand(9000, 14000));
  }

  function scheduleCricket() {
    if (!AC) return;
    setTimeout(function () {
      if (AC && soundOn && ambGain) {
        var t = AC.currentTime;
        var pan = rand(-0.85, 0.85);
        for (var r = 0; r < 3; r++) {
          var tt = t + r * 0.075;
          var n = AC.createBufferSource();
          n.buffer = noiseBuf(0.04);
          var bp = AC.createBiquadFilter();
          bp.type = "bandpass"; bp.frequency.value = rand(4200, 5400); bp.Q.value = 14;
          var g = AC.createGain();
          var p = AC.createStereoPanner ? AC.createStereoPanner() : null;
          g.gain.setValueAtTime(0.0001, tt);
          g.gain.exponentialRampToValueAtTime(0.05, tt + 0.005);
          g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.04);
          n.connect(bp); bp.connect(g);
          if (p) { p.pan.value = pan; g.connect(p); p.connect(ambGain); } else g.connect(ambGain);
          n.start(tt); n.stop(tt + 0.05);
        }
      }
      scheduleCricket();
    }, rand(1800, 5200));
  }

  function scheduleBell() {
    setTimeout(function () {
      if (running && !over) sndBell();
      scheduleBell();
    }, rand(38000, 62000));
  }

  function setSound(on) {
    soundOn = on;
    soundBtn.setAttribute("aria-pressed", on ? "true" : "false");
    soundBtn.textContent = on ? "♪" : "♪̸";
    if (outGain && AC) {
      outGain.gain.cancelScheduledValues(AC.currentTime);
      outGain.gain.setTargetAtTime(on ? 1 : 0, AC.currentTime, 0.02);
    }
    try { localStorage.setItem(SOUND_KEY, on ? "1" : "0"); } catch (e) {}
  }

  /* --------------------------------------------------------------- enemies */

  // `gear` drives the silhouette in drawNinjaShape. These are flat black bodies
  // against a night sky, so the ONLY way one type reads as different from
  // another is its outline — hence a sheathed sword, a bandolier, pauldrons and
  // a horned brow, or a trailing cloak, rather than colour or detail.
  var TYPES = {
    runner: { speed: 3.4, hp: 1, h: 1.78, points: 100, w: 1, gear: "sword" },
    thrower: { speed: 2.8, hp: 1, h: 1.74, points: 150, w: 1, stop: [9, 14], fire: 3.1, gear: "pouch" },
    brute: { speed: 2.15, hp: 2, h: 2.08, points: 250, w: 1.32, gear: "odachi" },
    dropper: { speed: 4.3, hp: 1, h: 1.72, points: 200, w: 1, gear: "cloak" }
  };

  // Stable tier mixes: once a new enemy joins the cast, later waves keep the
  // same readable proportions instead of silently drifting as arrays grow.
  function pickWaveType(n) {
    var roll = Math.random();
    if (n >= 6) {
      if (roll < 0.40) return "runner";
      if (roll < 0.73) return "thrower";
      if (roll < 0.93) return "brute";
      return "dropper";
    }
    if (n >= 4) {
      if (roll < 0.55) return "runner";
      if (roll < 0.91) return "thrower";
      return "brute";
    }
    if (n >= 2) return roll < 0.75 ? "runner" : "thrower";
    return "runner";
  }

  // In the static stance you cannot turn, so anything that spawns outside the
  // lens is unfair — it walks up and hits you with no counterplay. Keep spawns
  // comfortably inside the half-FOV rather than at a fixed arc.
  function staticArc() { return fov * 0.45; }

  function frontBays() {
    var out = [];
    var lim = staticArc();
    for (var i = 0; i < bays.length; i++) {
      if (mode === "turn" || Math.abs(angDiff(bays[i].ang, 0)) < lim) out.push(bays[i]);
    }
    if (out.length) return out;
    // Very narrow lens: fall back to the single most head-on bay.
    var bestBay = bays[0], bestD = 1e9;
    for (var j = 0; j < bays.length; j++) {
      var d = Math.abs(angDiff(bays[j].ang, 0));
      if (d < bestD) { bestD = d; bestBay = bays[j]; }
    }
    return [bestBay];
  }

  function spawnEnemy() {
    var type = pickWaveType(wave);
    var def = TYPES[type];
    var e = {
      type: type,
      hp: def.hp,
      h: def.h,
      w: def.w,
      speed: def.speed + Math.min(wave * 0.07, 1.4),
      state: "shoji",
      t: 0,
      x: 0, y: 0, z: 0,
      ang: 0,
      dist: R_WALL,
      phase: rand(0, 6.283),
      fireT: rand(0.8, 2.2),
      releaseT: 0,
      stopAt: def.stop ? rand(def.stop[0], def.stop[1]) : 0,
      hurtT: 0,
      throwAnim: 0,
      dead: 0,
      bay: null
    };

    if (type === "dropper") {
      // Over the top of the house. It appears ON the roofline and RUNS along
      // it first, so the entry is something you watch happen rather than a
      // body that materialises in mid-air already falling.
      e.state = "roof";
      var da = staticArc();
      e.ang = mode === "turn" ? rand(0, Math.PI * 2) : rand(-da * 0.85, da * 0.85);
      e.dist = R_WALL;
      e.y = ROOF_Y;
      e.roofDir = Math.random() < 0.5 ? -1 : 1;
      e.roofT = rand(0.9, 1.7);
      e.t = 0;
    } else {
      var bay = pick(frontBays());
      e.bay = bay;
      e.ang = bay.ang + rand(-0.06, 0.06);
      e.dist = R_WALL - 0.6;
      bay.sil = e;
      e.t = 0;
    }
    syncPos(e);
    enemies.push(e);
  }

  function syncPos(e) {
    e.x = Math.sin(e.ang) * e.dist;
    e.z = Math.cos(e.ang) * e.dist;
  }

  // Break sideways for a beat before turning in. Rate is derived from a real
  // lateral speed over the current radius, so a dropper landing at 9m and a
  // runner entering at 18m both cross the ground at a believable pace instead
  // of the near one whipping around.
  function beginFlank(e, dur) {
    e.state = "flank";
    e.t = 0;
    // Bay angles arrive in [0, 2pi), so a ninja standing on your LEFT carries
    // ang 5.7, not -0.58. Fold to signed here or the static-stance clamp below
    // reads 5.7 as "past the right edge" and teleports it across the courtyard.
    e.ang = angDiff(e.ang, 0);
    e.flankDir = Math.random() < 0.5 ? -1 : 1;
    e.flankT = dur;
    e.flankRate = rand(1.9, 3.2) / Math.max(4, e.dist);
  }

  /* ------------------------------------------------------------ projectiles */

  // launchX: screen x the star should appear to leave from, at the bottom edge.
  // The physics still start on the camera ray, so aiming stays exact; only the
  // first moments of rendering ease up from the bottom of the screen.
  function throwStar(dir, spreadAng, launchX) {
    var d = dir;
    if (spreadAng) {
      var c = Math.cos(spreadAng), s = Math.sin(spreadAng);
      d = { x: d.x * c + d.z * s, y: d.y, z: -d.x * s + d.z * c };
    }
    stars.push({
      x: d.x * 0.5, y: EYE - 0.12 + d.y * 0.5, z: d.z * 0.5,
      vx: d.x * THROW_SPEED, vy: d.y * THROW_SPEED, vz: d.z * THROW_SPEED,
      spin: rand(0, 6.283), life: 1.6, alive: true,
      px: 0, py: 0, pz: 0,
      lx: launchX == null ? null : launchX,
      ly: H + 26,
      age: 0
    });
  }

  // Solve the actual ballistic arc instead of firing along the straight line to
  // the target. The old version aimed at chest height and added a token bit of
  // lift, but never accounted for the drop over the flight: past ~11m gravity
  // took more than the lift gave, so every blade sailed under the player's feet
  // — and throwers stop at 9-14m, so they were harmless by design.
  function throwKunai(e) {
    var dx = -e.x, dz = -e.z;
    var d = Math.sqrt(dx * dx + dz * dz) || 1;
    var startY = e.y + e.h * 0.62;
    var targetY = EYE - 0.25;
    var T = d / KUNAI_SPEED; // horizontal flight time
    kunais.push({
      x: e.x, y: startY, z: e.z,
      px: e.x, py: startY, pz: e.z,
      vx: (dx / d) * KUNAI_SPEED,
      vy: (targetY - startY) / T + 0.5 * KUNAI_G * T,
      vz: (dz / d) * KUNAI_SPEED,
      spin: rand(0, 6.283), age: 0, alive: true, life: 4
    });
  }

  /* ------------------------------------------------------------------- FX */

  function burst(x, y, z, n, col, spd, headshot) {
    var lim = REDMO ? Math.ceil(n * 0.4) : n;
    for (var i = 0; i < lim; i++) {
      var a = rand(0, 6.283), p = rand(-1, 1);
      fx.push({
        kind: "p", x: x, y: y, z: z,
        vx: Math.cos(a) * rand(0.4, spd), vy: rand(0.5, spd) + (headshot ? 1.2 : 0),
        vz: Math.sin(a) * rand(0.4, spd) * (0.5 + Math.abs(p) * 0.5),
        life: rand(0.35, 0.85), t: 0, col: col, sz: rand(0.03, 0.085)
      });
    }
  }

  function ring(x, y, z, col, big) {
    fx.push({ kind: "ring", x: x, y: y, z: z, t: 0, life: big ? 0.5 : 0.3, col: col, big: big ? 2.4 : 1 });
  }

  function paperShards(bay) {
    var lim = REDMO ? 6 : 16;
    for (var i = 0; i < lim; i++) {
      var a = bay.ang + rand(-0.055, 0.055);
      shards.push({
        ang: a, dist: R_WALL - rand(0.3, 1.4),
        y: rand(0.4, 2.9), vy: rand(0.4, 2.1),
        vd: rand(-2.6, -0.6),
        rot: rand(0, 6.283), vr: rand(-7, 7),
        t: 0, life: rand(0.8, 1.5), sz: rand(0.1, 0.28)
      });
    }
  }

  function floater(x, y, z, text, col) {
    fx.push({ kind: "txt", x: x, y: y, z: z, t: 0, life: 0.9, text: text, col: col });
  }

  /* ---------------------------------------------------------------- input */

  var pointerDown = false, dragging = false, downX = 0, downY = 0, downT = 0, lastX = 0;
  var keyTurn = 0;
  var DRAG_PX = 12;
  var SWIPE_MIN = 24;
  var gestKind = null; // "turn" | "throw", decided by the dominant axis
  var isTouch = COARSE; // seeded from the device, corrected by real pointers

  function pointerPos(ev) {
    return { x: ev.clientX, y: ev.clientY };
  }

  canvas.addEventListener("pointerdown", function (ev) {
    if (!running) return;
    ev.preventDefault();
    initAudio();
    try { canvas.setPointerCapture && canvas.setPointerCapture(ev.pointerId); } catch (e) {}
    var p = pointerPos(ev);
    pointerDown = true; dragging = false; gestKind = null;
    isTouch = ev.pointerType !== "mouse";
    downX = p.x; downY = p.y; lastX = p.x; downT = performance.now();
    aim.x = p.x; aim.y = p.y; aim.has = true;
    if (ev.button === 2) return;
    charging = true; chargeT = 0;
  });

  canvas.addEventListener("pointermove", function (ev) {
    var p = pointerPos(ev);
    if (!pointerDown) {
      // Desktop hover aims directly.
      if (ev.pointerType === "mouse") { aim.x = p.x; aim.y = p.y; aim.has = true; }
      return;
    }
    var dx = p.x - lastX;

    if (isTouch) {
      var tx = p.x - downX, ty = p.y - downY;
      if (!gestKind && (Math.abs(tx) > SWIPE_MIN || Math.abs(ty) > SWIPE_MIN)) {
        gestKind = mode === "turn" && Math.abs(tx) > Math.abs(ty) * 1.25 ? "turn" : "throw";
        charging = false;
        if (gestKind === "turn") dragging = true;
      }
      if (gestKind === "turn") {
        yaw += (dx / W) * fov * 2.1;
        yawVel = (dx / W) * 6;
      } else {
        aim.x = p.x; aim.y = p.y;
      }
      lastX = p.x;
      return;
    }

    if (!dragging && Math.abs(p.x - downX) > DRAG_PX && ev.buttons === 2) {
      dragging = true;
      charging = false;
    }
    if (dragging && mode === "turn") {
      yaw += (dx / W) * fov * 2.1;
      yawVel = (dx / W) * 6;
    } else {
      aim.x = p.x; aim.y = p.y;
    }
    lastX = p.x;
  });

  function releasePointer(ev) {
    if (!pointerDown) return;
    pointerDown = false;
    var wasCharging = charging;
    var kind = gestKind;
    charging = false;
    gestKind = null;
    if (dragging) { dragging = false; return; }
    if (!running || over) return;

    if (isTouch) {
      if (kind === "throw") swipeThrow(downX, downY, aim.x, aim.y);
      else if (wasCharging && chargeT >= CHARGE_TIME) fireFan(downX);
      else fire(aim.x);
      chargeT = 0;
      return;
    }

    if (wasCharging && chargeT >= CHARGE_TIME) fireFan();
    else fire();
    chargeT = 0;
  }
  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", function () { pointerDown = false; charging = false; dragging = false; chargeT = 0; });
  canvas.addEventListener("contextmenu", function (ev) { ev.preventDefault(); useFocus(); });

  window.addEventListener("keydown", function (ev) {
    if (ev.repeat) return;
    var k = ev.key.toLowerCase();
    if (k === "arrowleft" || k === "a") keyTurn = -1;
    else if (k === "arrowright" || k === "d") keyTurn = 1;
    else if (k === " ") { ev.preventDefault(); useMagic(); }
    else if (k === "shift") useFocus();
    else if (k === "enter" && !running) ovBtn.click();
  });
  window.addEventListener("keyup", function (ev) {
    var k = ev.key.toLowerCase();
    if ((k === "arrowleft" || k === "a") && keyTurn === -1) keyTurn = 0;
    if ((k === "arrowright" || k === "d") && keyTurn === 1) keyTurn = 0;
  });

  function showThrowHand(x) {
    handAnim = 0.24;
    handX = clamp(typeof x === "number" ? x : aim.x, W * 0.18, W * 0.82);
  }

  function fire(launchX) {
    if (cooldown > 0 || !running || over) return;
    cooldown = THROW_COOLDOWN;
    throwStar(unproject(aim.x, aim.y), 0, launchX);
    showThrowHand(launchX);
    sndThrow(panOf(aim.x));
    hideHint();
  }

  function fireFan(launchX) {
    if (!running || over) return;
    cooldown = THROW_COOLDOWN * 1.7;
    var d = unproject(aim.x, aim.y);
    throwStar(d, -FAN_SPREAD, launchX);
    throwStar(d, 0, launchX);
    throwStar(d, FAN_SPREAD, launchX);
    showThrowHand(launchX);
    sndThrow(panOf(aim.x));
    setTimeout(function () { sndThrow(panOf(aim.x)); }, 45);
    hideHint();
  }

  function swipeThrow(x0, y0, x1, y1) {
    if (cooldown > 0 || !running || over) return;
    var dx = x1 - x0, dy = y1 - y0;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return;
    aim.x = x1; aim.y = y1; aim.has = true;
    cooldown = THROW_COOLDOWN;
    throwStar(unproject(x1, y1), 0, x0);
    showThrowHand(x0);
    sndThrow(panOf(x1));
    hideHint();
  }

  function useFocus() {
    if (!running || over || focusT > 0 || focusMeter < 1) return;
    focusMeter = 0;
    focusT = FOCUS_TIME;
    sndFocus(true);
  }

  function beginMagicFx() {
    var marks = [];
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (e.state === "dead") continue;
      var p = project(e.x, e.y + e.h * 0.56, e.z);
      if (!p || p.x < -W * 0.12 || p.x > W * 1.12) continue;
      var points = [];
      var sx = W * 0.5, sy = H * 0.47;
      var segments = REDMO ? 3 : 6;
      for (var j = 0; j <= segments; j++) {
        var u = j / segments;
        var edge = Math.sin(u * Math.PI);
        points.push({
          x: lerp(sx, p.x, u) + rand(-W * 0.022, W * 0.022) * edge,
          y: lerp(sy, p.y, u) + rand(-H * 0.025, H * 0.025) * edge
        });
      }
      marks.push({
        x: p.x, y: p.y,
        r: clamp(p.s * e.h * 0.34, 20, H * 0.13),
        delay: Math.min(0.18, marks.length * 0.018),
        rot: rand(0, 6.283),
        points: points
      });
      // The spell still clears every enemy; this cap only bounds the brief
      // full-screen lightning overlay during extremely crowded late waves.
      if (marks.length >= (REDMO ? 6 : 14)) break;
    }
    magicFx = { age: 0, rot: rand(0, 6.283), marks: marks };
  }

  function useMagic() {
    if (!running || over || magic <= 0 || enemies.length === 0) return;
    magic--;
    flashMagic = 1;
    beginMagicFx();
    shake = Math.max(shake, REDMO ? 3 : 18);
    sndMagic();
    for (var i = enemies.length - 1; i >= 0; i--) {
      var e = enemies[i];
      if (e.state === "dead") continue;
      killEnemy(e, false, true);
    }
    for (var j = 0; j < kunais.length; j++) kunais[j].alive = false;
    updateHud();
  }

  focusBtn.addEventListener("click", function (ev) { ev.stopPropagation(); useFocus(); });
  magicBtn.addEventListener("click", function (ev) { ev.stopPropagation(); useMagic(); });
  soundBtn.addEventListener("click", function (ev) {
    ev.stopPropagation();
    initAudio();
    setSound(!soundOn);
  });

  function hideHint() {
    if (hintEl && !hintEl.classList.contains("is-gone")) hintEl.classList.add("is-gone");
  }

  /* ------------------------------------------------------------ game flow */

  function setMode(m) {
    mode = m;
    modeTurn.classList.toggle("is-on", m === "turn");
    modeStatic.classList.toggle("is-on", m === "static");
    // Two lies to avoid: Hold-the-line cannot turn, and a phone has no
    // Shift / right-click / space — on touch the abilities live on the
    // on-screen ◎ Focus and 卍 Magic buttons, so point at those instead.
    var line1 = m === "turn"
      ? (COARSE
          ? "Swipe to throw &nbsp;·&nbsp; swipe sideways to turn<br />"
          : "Drag or A / D to turn &nbsp;·&nbsp; hold to charge a fan of three<br />")
      : (COARSE
          ? "Swipe to throw &nbsp;·&nbsp; hold still to charge a fan of three<br />"
          : "Aim and click to throw &nbsp;·&nbsp; hold to charge a fan of three<br />");
    var line2 = COARSE
      ? "Tap ◎ to focus &nbsp;·&nbsp; tap 卍 for ninja magic"
      : "Shift or right-click for focus &nbsp;·&nbsp; space for ninja magic";
    ovKeys.innerHTML = line1 + line2;
    try { localStorage.setItem(MODE_KEY, m); } catch (e) {}
  }
  modeTurn.addEventListener("click", function () { setMode("turn"); });
  modeStatic.addEventListener("click", function () { setMode("static"); });

  function startGame() {
    initAudio();
    buildWorld();
    score = 0; wave = 0; life = 3; combo = 0; comboT = 0;
    magic = MAGIC_START; focusMeter = 0; focusT = 0; timeScale = 1;
    focusWasReady = false; // so a new run gets the flourish again
    hudScore = -1; hudLife = -1; // repaint the HUD clean, without firing the change animations
    focusBtn.classList.remove("just-ready", "is-ready");
    enemies = []; stars = []; kunais = []; fx = []; shards = [];
    yaw = 0; yawVel = 0;
    spawnQueue = 0; spawnTimer = 0; betweenWaves = 0.9;
    running = true; over = false; started = true;
    shake = 0; flashHurt = 0; flashMagic = 0; magicFx = null; magicReadyT = 0;
    magicBtn.classList.remove("magic-earned");
    strike = null; dying = false; handAnim = 0;
    overlay.hidden = true;
    hudEl.hidden = false;
    abilitiesEl.hidden = false;
    document.body.classList.remove("is-menu");
    if (hintEl) hintEl.classList.remove("is-gone");
    aim.x = W * 0.5; aim.y = H * 0.5;
    updateHud();
    try {
      if (typeof window.gtag === "function") window.gtag("event", "toy_start", { toy: "shuriken-night", mode: mode });
    } catch (e) {}
  }

  function nextWave() {
    wave++;
    var total = Math.round(4 + wave * 1.7);
    spawnQueue = total;
    spawnTimer = 0;
    waveBanner = 2.2;
    waveBannerText = "Wave " + wave;
    if (wave > 1) {
      sndWave();
      if (wave % 3 === 0) {
        magic++;
        magicReadyT = MAGIC_READY_TIME;
        magicBtn.classList.remove("magic-earned");
        void magicBtn.offsetWidth;
        magicBtn.classList.add("magic-earned");
        sndMagicReady();
      }
    }
    updateHud();
  }

  function endGame() {
    if (over) return;
    running = false;
    over = true;
    dying = false;
    timeScale = 1;
    document.body.classList.add("is-menu");
    var isBest = score > best;
    if (isBest) {
      best = score;
      try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) {}
    }
    ovEyebrow.textContent = isBest ? "A new record" : "The night ends";
    ovTitle.textContent = isBest ? "New best" : "Overrun";
    ovText.innerHTML =
      "You held the courtyard through <b>" + wave + "</b> wave" + (wave === 1 ? "" : "s") +
      " and scored <b>" + score.toLocaleString() + "</b>." +
      (!isBest && best > 0 ? " Your best is " + best.toLocaleString() + "." : "");
    ovBtn.textContent = "Again";
    modesEl.hidden = false;
    overlay.hidden = false;
    hudEl.hidden = true;
    abilitiesEl.hidden = true;
    window.OPT_SHARE_TEXT =
      "I survived " + wave + " wave" + (wave === 1 ? "" : "s") + " and scored " +
      score.toLocaleString() + " in Shuriken Night";
    try {
      if (typeof window.gtag === "function") {
        window.gtag("event", "toy_end", { toy: "shuriken-night", score: score, wave: wave });
      }
    } catch (e) {}
  }

  ovBtn.addEventListener("click", function () { startGame(); });

  /* ---------------------------------------------------------------- damage */

  function killEnemy(e, headshot, byMagic, hitY) {
    if (e.state === "dead") return;
    e.state = "dead";
    e.dead = 0;
    // How this one goes down. A head-shot overrides type: it drops instantly
    // wherever it was, which is the whole point of hitting the head.
    // A body hit doubles them over onto hands and knees; a head hit drops them
    // where they stood. The heavy keeps its own topple and the thrower its
    // stagger, so the four types still die differently from each other.
    e.deathKind = headshot ? "snap"
      : e.type === "brute" ? "topple"
        : e.type === "thrower" ? "stagger"
          : "kneel";
    e.deathDur = e.deathKind === "topple" ? 1.5 : e.deathKind === "stagger" ? 1.25 : e.deathKind === "kneel" ? 1.35 : 1.1;
    e.deathDir = Math.random() < 0.5 ? -1 : 1;
    e.dustDone = false;
    var def = TYPES[e.type];
    combo++;
    comboT = 2.2;
    var mult = Math.min(1 + (combo - 1) * 0.25, 4);
    var pts = Math.round(def.points * (headshot ? 1.6 : 1) * mult);
    score += pts;
    focusMeter = clamp(focusMeter + (byMagic ? 0.02 : 0.13), 0, 1);
    // Where the blade actually went in. Everything below keys off this, so a
    // chest hit and a head hit spray and stick in different places.
    var hy = hitY === undefined ? e.y + e.h * 0.55 : hitY;
    e.stuckF = clamp((hy - e.y) / e.h, 0.12, 0.97); // height up the body, 0..1
    e.stuckX = rand(-0.22, 0.22);
    e.stuckSpin = rand(0, 6.283);
    var sp = project(e.x, hy, e.z);
    if (byMagic) {
      // Magic pulls the figure apart into cold moonlit ink rather than reusing
      // an ordinary weapon hit. It is cleaner, more graphic, and makes the
      // screen-clear read as one supernatural event.
      burst(e.x, hy, e.z, REDMO ? 7 : 16, "#bfeaff", 3.5, false);
      burst(e.x, hy, e.z, REDMO ? 5 : 12, "#746ee8", 2.8, false);
      burst(e.x, hy, e.z, REDMO ? 4 : 9, "#071124", 2.2, false);
      ring(e.x, e.y + e.h * 0.5, e.z, "rgba(155,220,255,0.92)", true);
    } else {
      // blood: a heavy arterial spray plus a finer, faster mist over the top
      burst(e.x, hy, e.z, headshot ? 20 : 13, "#a81e28", 2.9, headshot);
      burst(e.x, hy, e.z, headshot ? 11 : 6, "#e2515a", 3.7, headshot);
      burst(e.x, hy, e.z, headshot ? 7 : 5, "#101a30", 2.4, headshot); // torn cloth
      ring(e.x, e.y + e.h * 0.5, e.z, headshot ? "rgba(255,183,101,0.85)" : "rgba(190,210,255,0.6)", headshot);
    }
    floater(e.x, e.y + e.h * 0.95, e.z, (headshot ? "HEAD " : "") + "+" + pts, headshot ? COL.amber : COL.paper);
    if (sp && !byMagic) sndHit(panOf(sp.x), headshot);
    updateHud();
  }

  // kind: "melee" (a ninja's blade) or "blade" (a thrown kunai). The third and
  // final hit plays a longer, weapon-specific finish before the end screen.
  function hurtPlayer(kind, srcX, attackerType) {
    if (over || dying) return;
    life--;
    combo = 0; comboT = 0;
    var fatal = life <= 0;
    flashHurt = fatal ? 1 : 0.75;
    shake = Math.max(shake, REDMO ? 4 : fatal ? 26 : 16);
    strike = {
      kind: kind === "blade" ? "blade" : "melee",
      fatal: fatal,
      t: 0,
      dur: fatal ? (REDMO ? 1.1 : 2.0) : 0.55,
      sx: typeof srcX === "number" ? srcX : W * 0.5,
      enemyType: attackerType || "runner",
      ended: false
    };
    // The weapon that hit you sounds first, then the blow itself.
    if (!fatal && strike.kind === "melee") sndSlash(panOf(strike.sx), false);
    sndHurt(fatal);
    if (fatal) {
      dying = true;
      timeScale = 0.2;
      sndFatal(strike.kind);
    }
    updateHud();
  }

  /* ---------------------------------------------------------------- update */

  function update(dt) {
    var wdt = dt * timeScale;
    if (handAnim > 0) handAnim = Math.max(0, handAnim - dt);

    if (cooldown > 0) cooldown -= dt;
    if (charging) chargeT += dt;
    if (comboT > 0) { comboT -= dt; if (comboT <= 0) { combo = 0; updateHud(); } }
    if (shake > 0) shake = Math.max(0, shake - dt * 42);
    if (flashHurt > 0) flashHurt = Math.max(0, flashHurt - dt * 3.4);
    if (magicFx) {
      magicFx.age += dt;
      flashMagic = clamp(1 - magicFx.age / MAGIC_FX_TIME, 0, 1);
      if (magicFx.age >= MAGIC_FX_TIME) { magicFx = null; flashMagic = 0; }
    } else if (flashMagic > 0) {
      flashMagic = Math.max(0, flashMagic - dt / MAGIC_FX_TIME);
    }
    if (waveBanner > 0) waveBanner -= dt;
    if (magicReadyT > 0) {
      magicReadyT = Math.max(0, magicReadyT - dt);
      if (magicReadyT === 0) magicBtn.classList.remove("magic-earned");
    }

    if (focusT > 0 && !dying) {
      focusT -= dt;
      timeScale = FOCUS_SCALE;
      if (focusT <= 0) { timeScale = 1; sndFocus(false); }
    }

    // Strike animations run on real time so slow-mo cannot stretch them.
    if (strike) {
      strike.t += dt;
      if (strike.fatal) {
        if (!strike.ended && strike.t >= strike.dur) {
          strike.ended = true;
          endGame();
        }
      } else if (strike.t >= strike.dur) {
        strike = null;
      }
    }

    // Behind a fatal blow the world holds still — nothing else may land, and
    // the finish gets the screen to itself.
    if (dying) {
      updateFx(dt * timeScale);
      updateShards(dt * timeScale);
      updatePetals(dt * timeScale);
      return;
    }

    // Turning
    if (mode === "turn") {
      if (keyTurn) yaw += keyTurn * dt * 2.3;
      // Desktop edge-steer: pushing the reticle toward a screen edge swings the view.
      if (!pointerDown && aim.has && W > 720) {
        var edge = W * 0.14;
        if (aim.x < edge) yaw -= ((edge - aim.x) / edge) * dt * 2.2;
        else if (aim.x > W - edge) yaw += ((aim.x - (W - edge)) / edge) * dt * 2.2;
      }
      if (!pointerDown && Math.abs(yawVel) > 0.0001) {
        yaw += yawVel * dt;
        yawVel *= Math.pow(0.0015, dt);
        if (Math.abs(yawVel) < 0.01) yawVel = 0;
      }
    } else {
      yaw = 0;
    }
    if (yaw > Math.PI) yaw -= Math.PI * 2;
    if (yaw < -Math.PI) yaw += Math.PI * 2;

    if (!running) { updatePetals(wdt); return; }

    // Wave pacing
    if (betweenWaves > 0) {
      betweenWaves -= dt;
      if (betweenWaves <= 0) nextWave();
    } else if (spawnQueue > 0) {
      spawnTimer -= dt;
      var maxAlive = Math.min(3 + Math.floor(wave * 0.75), 9);
      var alive = 0;
      for (var q = 0; q < enemies.length; q++) if (enemies[q].state !== "dead") alive++;
      if (spawnTimer <= 0 && alive < maxAlive) {
        spawnEnemy();
        spawnQueue--;
        spawnTimer = Math.max(0.45, 1.7 - wave * 0.085) * rand(0.75, 1.25);
      }
    } else if (enemies.length === 0) {
      betweenWaves = 2.4;
    }

    updateEnemies(wdt);
    updateStars(wdt);
    updateKunais(wdt);
    updateFx(wdt);
    updateShards(wdt);
    updatePetals(wdt);

    // Bay glow settles back after a burst
    for (var b = 0; b < bays.length; b++) {
      var bay = bays[b];
      if (bay.broken > 0) bay.broken = Math.max(0, bay.broken - wdt * 0.28);
      bay.glow = lerp(bay.glow, bay.sil ? 1 : bay.baseLit, 1 - Math.pow(0.001, wdt));
    }
  }

  function updateEnemies(dt) {
    for (var i = enemies.length - 1; i >= 0; i--) {
      var e = enemies[i];
      e.t += dt;
      if (e.hurtT > 0) e.hurtT -= dt;

      if (e.state === "dead") {
        e.dead += dt;
        var ddur = e.deathDur || 1.1;
        // dust where the body actually lands, not at the moment of the hit
        if (!e.dustDone && e.dead > ddur * 0.66) {
          e.dustDone = true;
          if (e.deathKind === "topple" || e.deathKind === "tumble") {
            ring(e.x, 0.05, e.z, "rgba(158,168,190,0.3)", false);
          }
        }
        if (e.dead > ddur) enemies.splice(i, 1);
        continue;
      }

      if (e.state === "flank") {
        // Crossing the courtyard before committing. Without this every ninja
        // walks the exact radius it entered on, so the whole wave reads as
        // spokes converging on you.
        e.ang += e.flankDir * e.flankRate * dt;
        e.dist -= e.speed * 0.3 * dt; // drift in slightly: a curve, not a sidestep
        if (mode !== "turn") {
          // Locked-forward stance can't chase them, so they must stay in frame.
          var lim = staticArc();
          if (e.ang > lim) { e.ang = lim; e.flankDir = -1; }
          else if (e.ang < -lim) { e.ang = -lim; e.flankDir = 1; }
        }
        if (e.t >= e.flankT) { e.state = "walk"; e.t = 0; }
        syncPos(e);
        continue;
      }

      if (e.state === "shoji") {
        // Backlit silhouette behind the paper, then it tears through.
        if (e.t > 1.15) {
          beginFlank(e, rand(0.85, 1.5));
          if (e.bay) {
            e.bay.sil = null;
            e.bay.broken = 1;
            paperShards(e.bay);
            var sp = project(e.x, 1.4, e.z);
            sndShoji(sp ? panOf(sp.x) : 0);
          }
        }
        syncPos(e);
        continue;
      }

      if (e.state === "attack") {
        // Lunge in over the wind-up, then the blade lands.
        if (e.t < ATTACK_WINDUP * 0.62) e.dist = Math.max(1.25, e.dist - dt * 1.6);
        syncPos(e);
        if (e.t >= ATTACK_WINDUP) {
          var sp = project(e.x, e.y + e.h * 0.6, e.z);
          enemies.splice(i, 1);
          hurtPlayer("melee", sp ? sp.x : W * 0.5, e.type);
        }
        continue;
      }

      if (e.state === "roof") {
        // running the ridge, silhouetted against the sky
        e.ang += e.roofDir * (2.4 / Math.max(6, e.dist)) * dt;
        e.y = roofHeight(e.ang); // ride the roofline rather than a flat height
        if (mode !== "turn") {
          var rlim = staticArc() * 0.92;
          if (e.ang > rlim) { e.ang = rlim; e.roofDir = -1; }
          else if (e.ang < -rlim) { e.ang = -rlim; e.roofDir = 1; }
        }
        if (e.t >= e.roofT) {
          e.state = "drop";
          e.t = 0;
          e.vy = 1.9;            // kicks off the ridge before gravity takes over
          e.leap = rand(3.2, 5.0); // and carries forward into the courtyard
          ring(e.x, e.y, e.z, "rgba(190,210,255,0.28)", false);
        }
        syncPos(e);
        continue;
      }

      if (e.state === "drop") {
        // a real leap: up off the ridge, forward into the yard, then down
        e.vy = (e.vy === undefined ? 0 : e.vy) - 13 * dt;
        e.y += e.vy * dt;
        if (e.leap) e.dist = Math.max(6, e.dist - e.leap * dt);
        if (e.y <= 0) {
          e.y = 0;
          ring(e.x, 0.05, e.z, "rgba(190,210,255,0.4)", false);
          // lands, breaks sideways out of the landing, then comes for you
          beginFlank(e, rand(0.4, 0.8));
        }
        syncPos(e);
        continue;
      }

      // walking / attacking
      var def = TYPES[e.type];
      if (e.type === "thrower" && e.dist <= e.stopAt) {
        // Creep forward slowly rather than standing still forever.
        if (e.dist > 6.5) e.dist -= dt * 0.55;
        e.fireT -= dt;
        if (e.fireT <= 0 && e.releaseT <= 0) {
          // Cock the arm first; the blade leaves on release, so there is a
          // visible tell rather than a blade simply appearing.
          e.fireT = def.fire * rand(0.8, 1.2);
          e.throwAnim = THROW_TELL;
          e.releaseT = THROW_TELL;
        }
        if (e.releaseT > 0) {
          e.releaseT -= dt;
          if (e.releaseT <= 0) throwKunai(e);
        }
      } else {
        e.dist -= e.speed * dt;
      }
      if (e.throwAnim > 0) e.throwAnim -= dt;

      if (e.dist <= ATTACK_RANGE) {
        // Close enough to swing. Wind up visibly instead of vanishing — this
        // is the tell that lets you kill it before the blow lands.
        e.state = "attack";
        e.t = 0;
        syncPos(e);
        continue;
      }
      syncPos(e);
    }
  }

  function segmentCylinderT(ax, ay, az, bx, by, bz, cx, cz, radius, y0, y1) {
    var dx = bx - ax, dy = by - ay, dz = bz - az;
    var ox = ax - cx, oz = az - cz;
    var qa = dx * dx + dz * dz;
    var qb = 2 * (ox * dx + oz * dz);
    var qc = ox * ox + oz * oz - radius * radius;
    var ht0 = 0, ht1 = 1;
    if (qa < 0.0000001) {
      if (qc > 0) return null;
    } else {
      var disc = qb * qb - 4 * qa * qc;
      if (disc < 0) return null;
      var root = Math.sqrt(disc);
      ht0 = (-qb - root) / (2 * qa);
      ht1 = (-qb + root) / (2 * qa);
      if (ht0 > ht1) { var swap = ht0; ht0 = ht1; ht1 = swap; }
    }
    var vt0 = 0, vt1 = 1;
    if (Math.abs(dy) < 0.0000001) {
      if (ay < y0 || ay > y1) return null;
    } else {
      vt0 = (y0 - ay) / dy;
      vt1 = (y1 - ay) / dy;
      if (vt0 > vt1) { var vswap = vt0; vt0 = vt1; vt1 = vswap; }
    }
    var enter = Math.max(0, ht0, vt0);
    var leave = Math.min(1, ht1, vt1);
    return enter <= leave ? enter : null;
  }

  function nearerPropHit(best, ax, ay, az, bx, by, bz, cx, cz, radius, y0, y1, kind) {
    var t = segmentCylinderT(ax, ay, az, bx, by, bz, cx, cz, radius, y0, y1);
    if (t !== null && (!best || t < best.t)) return { t: t, kind: kind };
    return best;
  }

  function firstPropHit(ax, ay, az, bx, by, bz) {
    var best = null;
    for (var i = 0; i < garden.length; i++) {
      var G = garden[i];
      if (G.kind === "step") continue; // flat enough to throw over
      var gx = Math.sin(G.ang) * G.r, gz = Math.cos(G.ang) * G.r;
      if (G.kind === "pine") {
        // Narrow trunk below, broad layered foliage above.
        best = nearerPropHit(best, ax, ay, az, bx, by, bz, gx, gz,
          0.24 * G.sz, 0, 3.25 * G.sz, "pine");
        best = nearerPropHit(best, ax, ay, az, bx, by, bz, gx, gz,
          1.28 * G.sz * G.sk, 1.35 * G.sz, 3.85 * G.sz, "pine");
      } else if (G.kind === "rock") {
        best = nearerPropHit(best, ax, ay, az, bx, by, bz, gx, gz,
          1.35 * G.sz * G.sk, 0, 1.75 * G.sz, "rock");
      } else if (G.kind === "shrub") {
        best = nearerPropHit(best, ax, ay, az, bx, by, bz, gx, gz,
          1.42 * G.sz * G.sk, 0, 1.95 * G.sz, "shrub");
      } else if (G.kind === "basin") {
        best = nearerPropHit(best, ax, ay, az, bx, by, bz, gx, gz,
          1.28 * G.sz * G.sk, 0, 2.45 * G.sz, "basin");
      }
    }
    for (var s = 0; s < stoneLanterns.length; s++) {
      var S = stoneLanterns[s];
      best = nearerPropHit(best, ax, ay, az, bx, by, bz,
        Math.sin(S.ang) * S.r, Math.cos(S.ang) * S.r, 0.46, 0, 1.55, "stoneLantern");
    }
    var now = performance.now();
    for (var h = 0; h < lanterns.length; h++) {
      var L = lanterns[h];
      var sway = Math.sin(now * 0.0007 + L.sw) * 0.035;
      best = nearerPropHit(best, ax, ay, az, bx, by, bz,
        Math.sin(L.ang + sway) * L.r, Math.cos(L.ang + sway) * L.r,
        0.3, L.h - 0.44, L.h + 0.44, "hangingLantern");
    }
    return best;
  }

  function firstEnemyHit(ax, ay, az, bx, by, bz) {
    var best = null;
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (e.state === "dead" || e.state === "shoji") continue;
      var t = segmentCylinderT(ax, ay, az, bx, by, bz, e.x, e.z,
        ENEMY_R * e.w + 0.1, e.y - 0.05, e.y + e.h);
      if (t !== null && (!best || t < best.t)) best = { t: t, enemy: e };
    }
    return best;
  }

  function propImpact(s, kind) {
    var foliage = kind === "pine" || kind === "shrub";
    var warm = kind === "hangingLantern";
    var at = project(s.x, s.y, s.z);
    var before = project(s.x - s.vx * 0.025, s.y - s.vy * 0.025, s.z - s.vz * 0.025);
    var rot = at && before ? Math.atan2(at.y - before.y, at.x - before.x) : rand(0, 6.283);
    fx.push({
      kind: "ricochet", x: s.x, y: s.y, z: s.z,
      t: 0, life: foliage ? 0.2 : 0.24, rot: rot,
      col: warm ? "#ffbd72" : foliage ? "#8ba6c4" : "#d9e7f7",
      foliage: foliage
    });
    burst(s.x, s.y, s.z, REDMO ? 4 : 8,
      warm ? "#ffbd72" : foliage ? "#354d70" : "#7f91ae", foliage ? 1.3 : 1.8);
    burst(s.x, s.y, s.z, REDMO ? 2 : 4,
      foliage ? "#111b31" : "#202a40", 1.05);
    ring(s.x, s.y, s.z,
      warm ? "rgba(255,183,101,0.72)" : "rgba(165,190,225,0.55)", false);
    if (at) sndPropDeflect(kind, panOf(at.x));
  }

  function updateStars(dt) {
    for (var i = stars.length - 1; i >= 0; i--) {
      var s = stars[i];
      s.age += dt;
      s.px = s.x; s.py = s.y; s.pz = s.z;
      // Substep so a fast star can't tunnel through a ninja.
      var steps = 3;
      var hit = false;
      for (var k = 0; k < steps && !hit; k++) {
        var sdt = dt / steps;
        var ax = s.x, ay = s.y, az = s.z;
        s.x += s.vx * sdt;
        s.y += s.vy * sdt;
        s.z += s.vz * sdt;
        s.vy -= 2.6 * sdt; // gentle drop, keeps aim honest at range

        var propHit = firstPropHit(ax, ay, az, s.x, s.y, s.z);
        var enemyHit = firstEnemyHit(ax, ay, az, s.x, s.y, s.z);
        var firstT = propHit && (!enemyHit || propHit.t <= enemyHit.t) ? propHit.t : enemyHit ? enemyHit.t : null;
        if (firstT !== null) {
          s.x = lerp(ax, s.x, firstT);
          s.y = lerp(ay, s.y, firstT);
          s.z = lerp(az, s.z, firstT);
          hit = true;
          if (propHit && (!enemyHit || propHit.t <= enemyHit.t)) {
            propImpact(s, propHit.kind);
          } else {
            var e = enemyHit.enemy;
            var headshot = s.y > e.y + e.h * 0.76;
            e.hp -= headshot ? 2 : 1;
            e.hurtT = 0.18;
            if (e.hp <= 0) killEnemy(e, headshot, false, s.y);
            else {
              burst(s.x, s.y, s.z, 5, "#1a2440", 1.6);
              var pp = project(s.x, s.y, s.z);
              if (pp) sndHit(panOf(pp.x), false);
            }
          }
        }
        if (hit) break;

        // vs incoming blades
        for (var m = 0; m < kunais.length; m++) {
          var ku = kunais[m];
          if (!ku.alive) continue;
          var kdx = s.x - ku.x, kdy = s.y - ku.y, kdz = s.z - ku.z;
          if (kdx * kdx + kdy * kdy + kdz * kdz < 0.42 * 0.42) {
            ku.alive = false;
            hit = true;
            score += 75;
            focusMeter = clamp(focusMeter + 0.14, 0, 1);
            burst(s.x, s.y, s.z, 10, "#ffd9a0", 2.2);
            ring(s.x, s.y, s.z, "rgba(255,214,160,0.9)", false);
            floater(s.x, s.y + 0.3, s.z, "DEFLECT +75", COL.jade);
            var dp = project(s.x, s.y, s.z);
            sndDeflect(dp ? panOf(dp.x) : 0);
            updateHud();
            break;
          }
        }
      }

      s.life -= dt;
      var dd = Math.sqrt(s.x * s.x + s.z * s.z);
      if (hit || s.life <= 0 || s.y < -0.4 || dd > R_WALL + 2) {
        if (!hit && dd >= R_WALL - 2.5 && s.y > 0.2) {
          // Thuds into the far wall.
          burst(s.x, s.y, s.z, 4, "#2a2436", 1.1);
        }
        stars.splice(i, 1);
      }
    }
  }

  function updateKunais(dt) {
    for (var i = kunais.length - 1; i >= 0; i--) {
      var k = kunais[i];
      var px = k.x, py = k.y, pz = k.z;
      k.px = px; k.py = py; k.pz = pz;
      k.x += k.vx * dt;
      k.y += k.vy * dt;
      k.z += k.vz * dt;
      k.vy -= KUNAI_G * dt;
      // Visual roll around the kunai's own long axis. Its point-first screen
      // orientation is derived from the projected trajectory in drawKunai.
      k.spin += dt * 9;
      k.age += dt;
      k.life -= dt;

      // Swept test against the player's cylinder. A per-frame point check let a
      // fast blade step straight over the hit radius on a slow frame.
      var hit = false;
      var STEPS = 4;
      for (var s = 1; s <= STEPS && !hit; s++) {
        var f = s / STEPS;
        var sxp = px + (k.x - px) * f;
        var syp = py + (k.y - py) * f;
        var szp = pz + (k.z - pz) * f;
        if (sxp * sxp + szp * szp < 0.7 * 0.7 && Math.abs(syp - (EYE - 0.35)) < 1.35) hit = true;
      }
      if (hit) {
        var sp = project(px, py, pz);
        kunais.splice(i, 1);
        hurtPlayer("blade", sp ? sp.x : W * 0.5);
        continue;
      }
      if (!k.alive || k.life <= 0 || k.y < -0.5) { kunais.splice(i, 1); continue; }
    }
  }

  function updateFx(dt) {
    for (var i = fx.length - 1; i >= 0; i--) {
      var f = fx[i];
      f.t += dt;
      if (f.kind === "p") {
        f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
        f.vy -= 6.5 * dt;
      } else if (f.kind === "txt") {
        f.y += dt * 0.75;
      }
      if (f.t >= f.life) fx.splice(i, 1);
    }
  }

  function updateShards(dt) {
    for (var i = shards.length - 1; i >= 0; i--) {
      var s = shards[i];
      s.t += dt;
      s.y += s.vy * dt;
      s.vy -= 5.5 * dt;
      s.dist += s.vd * dt;
      s.rot += s.vr * dt;
      if (s.t >= s.life || s.y < 0) shards.splice(i, 1);
    }
  }

  function updatePetals(dt) {
    for (var i = 0; i < petals.length; i++) {
      var p = petals[i];
      p.y += p.vy * dt;
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.sp += p.spd * dt;
      if (p.y < 0) { petals[i] = newPetal(false); }
    }
    // Embers ride the same tick: rise, fade, then respawn at their own lantern.
    for (var j = 0; j < embers.length; j++) {
      var em = embers[j];
      em.y += em.vy * dt;
      em.ang += em.drift * dt * 0.1;
      em.life -= dt;
      if (em.life <= 0 || em.y > 4.6) {
        em.y = rand(0.35, 0.8);
        em.ang = em.host.ang + rand(-0.09, 0.09);
        em.r = em.host.r + rand(-1.1, 1.1);
        em.life = rand(1.5, 5);
        em.a = rand(0.25, 0.75);
      }
    }
  }

  /* ---------------------------------------------------------------- render */

  function render() {
    var sx = 0, sy = 0;
    if (shake > 0.2) {
      sx = rand(-shake, shake) * 0.5;
      sy = rand(-shake, shake) * 0.5;
    }
    ctx.save();
    ctx.translate(sx, sy);

    drawSky();
    drawHills();
    drawWall();
    drawGround();
    drawEngawa();    // the raised veranda the screens actually sit behind
    drawLightPass(); // light landing on the floor, under the depth-sorted fixtures
    drawGroundSteps(); // flat floor decals always remain beneath moving actors

    // Everything in the round, depth sorted far to near.
    var items = [];
    var i, p;
    for (i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (e.state === "shoji") continue; // drawn on its paper screen
      p = project(e.x, e.y, e.z);
      if (p) items.push({ z: p.z, draw: drawEnemy, a: e, p: p });
    }
    // Props share the same painter's queue as attackers. This is the crucial
    // difference between decoration and scenery: a nearer pine or stone lantern
    // now correctly occludes an enemy crossing behind it.
    for (i = 0; i < garden.length; i++) {
      var gd = garden[i];
      if (gd.kind === "step") continue;
      p = project(Math.sin(gd.ang) * gd.r, 0, Math.cos(gd.ang) * gd.r);
      if (p && p.x >= -160 && p.x <= W + 160) items.push({ z: p.z, draw: drawGardenDepth, a: gd, p: p });
    }
    for (i = 0; i < stoneLanterns.length; i++) {
      var sl = stoneLanterns[i];
      p = project(Math.sin(sl.ang) * sl.r, 0, Math.cos(sl.ang) * sl.r);
      if (p && p.x >= -160 && p.x <= W + 160) items.push({ z: p.z, draw: drawStoneLanternDepth, a: sl, p: p });
    }
    for (i = 0; i < lanterns.length; i++) {
      var hl = lanterns[i];
      var hsway = Math.sin(performance.now() * 0.0007 + hl.sw) * 0.035;
      p = project(Math.sin(hl.ang + hsway) * hl.r, hl.h, Math.cos(hl.ang + hsway) * hl.r);
      if (p && p.x >= -100 && p.x <= W + 100) items.push({ z: p.z, draw: drawHangingLanternDepth, a: hl, p: p });
    }
    for (i = 0; i < petals.length; i++) {
      p = project(petals[i].x, petals[i].y, petals[i].z);
      if (p) items.push({ z: p.z, draw: drawPetal, a: petals[i], p: p });
    }
    for (i = 0; i < shards.length; i++) {
      var sh = shards[i];
      p = project(Math.sin(sh.ang) * sh.dist, sh.y, Math.cos(sh.ang) * sh.dist);
      if (p) items.push({ z: p.z, draw: drawShard, a: sh, p: p });
    }
    for (i = 0; i < kunais.length; i++) {
      p = project(kunais[i].x, kunais[i].y, kunais[i].z);
      if (p) items.push({ z: p.z, draw: drawKunai, a: kunais[i], p: p });
    }
    for (i = 0; i < stars.length; i++) {
      p = project(stars[i].x, stars[i].y, stars[i].z);
      if (p) items.push({ z: p.z, draw: drawStar, a: stars[i], p: p });
    }
    for (i = 0; i < fx.length; i++) {
      var f = fx[i];
      p = project(f.x, f.y, f.z);
      if (p) items.push({
        z: p.z,
        draw: f.kind === "txt" ? drawFloater : f.kind === "ring" ? drawRing : f.kind === "ricochet" ? drawRicochet : drawParticle,
        a: f, p: p
      });
    }
    items.sort(function (a, b) { return b.z - a.z; });
    for (i = 0; i < items.length; i++) items[i].draw(items[i].a, items[i].p);

    drawFog();
    ctx.restore();

    drawPlayerHand();
    drawEdgeThreats();
    if (!dying && !isTouch) drawReticle();
    drawOverlayFx();
    drawStrike();
    drawWaveBanner();
    drawMagicReady();
  }

  function drawSky() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#040610");
    g.addColorStop(0.4, "#0b1330");
    g.addColorStop(0.74, "#1d2c5e");
    g.addColorStop(1, "#31447e");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // stars
    var now = performance.now() * 0.001;
    for (var i = 0; i < skyStars.length; i++) {
      var s = skyStars[i];
      var x = bearingX(s.ang);
      if (x === null || x < -30 || x > W + 30) continue;
      var y = cylY(s.h, R_SKY);
      if (y > horizon - 8) continue;
      var tw = 0.55 + 0.45 * Math.sin(now * s.sp + s.tw);
      ctx.globalAlpha = tw * 0.85;
      ctx.fillStyle = "#e9eeff";
      ctx.beginPath();
      ctx.arc(x, y, s.r, 0, 6.283);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // moon
    var mx = bearingX(2.35);
    if (mx !== null) {
      var my = cylY(EYE + 118, R_SKY);
      var mr = W * 0.055;
      var gg = ctx.createRadialGradient(mx, my, mr * 0.2, mx, my, mr * 6);
      gg.addColorStop(0, "rgba(214,228,255,0.34)");
      gg.addColorStop(0.35, "rgba(160,185,240,0.11)");
      gg.addColorStop(1, "rgba(120,150,220,0)");
      ctx.fillStyle = gg;
      ctx.beginPath(); ctx.arc(mx, my, mr * 6, 0, 6.283); ctx.fill();

      var mg = ctx.createRadialGradient(mx - mr * 0.3, my - mr * 0.3, mr * 0.1, mx, my, mr);
      mg.addColorStop(0, "#ffffff");
      mg.addColorStop(0.6, "#e6ecff");
      mg.addColorStop(1, "#c3cfee");
      ctx.fillStyle = mg;
      ctx.beginPath(); ctx.arc(mx, my, mr, 0, 6.283); ctx.fill();
      ctx.fillStyle = "rgba(150,165,200,0.22)";
      ctx.beginPath(); ctx.arc(mx + mr * 0.28, my - mr * 0.2, mr * 0.19, 0, 6.283); ctx.fill();
      ctx.beginPath(); ctx.arc(mx - mr * 0.3, my + mr * 0.26, mr * 0.13, 0, 6.283); ctx.fill();
      ctx.beginPath(); ctx.arc(mx + mr * 0.05, my + mr * 0.42, mr * 0.09, 0, 6.283); ctx.fill();
    }
  }

  function drawHills() {
    var baseY = cylY(0, R_HILL);
    ctx.beginPath();
    ctx.moveTo(-40, H);
    var begun = false;
    for (var i = -50; i <= 50; i++) {
      var ang = yaw + (i / 50) * 1.4;
      var x = bearingX(ang);
      if (x === null) continue;
      var idx = ((Math.round((ang / (Math.PI * 2)) * hillProfile.length * 2) % hillProfile.length) + hillProfile.length) % hillProfile.length;
      var hgt = hillProfile[idx];
      var y = cylY(hgt, R_HILL);
      if (!begun) { ctx.lineTo(x, y); begun = true; }
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(W + 40, H);
    ctx.closePath();
    var g = ctx.createLinearGradient(0, baseY - 60, 0, baseY + 20);
    g.addColorStop(0, "#131d40");
    g.addColorStop(1, "#0b1230");
    ctx.fillStyle = g;
    ctx.fill();
  }


  // The wall face never moves in screen space (only the joints that track yaw
  // do), so its gradient, plaster grain and raking moonlight are baked once.
  function buildWallTex(topY, plinthY, baseY) {
    var hgt = Math.max(1, Math.ceil(baseY - topY) + 2);
    var c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(W));
    c.height = hgt;
    var x = c.getContext("2d");
    var pl = plinthY - topY;

    var g = x.createLinearGradient(0, 0, 0, pl);
    g.addColorStop(0, "#0b1124");
    g.addColorStop(0.55, "#090e1f");
    g.addColorStop(1, "#070b18");
    x.fillStyle = g;
    x.fillRect(0, 0, c.width, pl + 2);

    if (PLASTER) {
      x.save();
      x.globalAlpha = 0.5;
      x.fillStyle = x.createPattern(PLASTER, "repeat");
      x.fillRect(0, 0, c.width, pl + 2);
      x.restore();
      var rake = x.createLinearGradient(c.width, 0, c.width * 0.25, 0);
      rake.addColorStop(0, "rgba(150,178,240,0.07)");
      rake.addColorStop(1, "rgba(150,178,240,0)");
      x.fillStyle = rake;
      x.fillRect(0, 0, c.width, pl + 2);
    }

    var pg = x.createLinearGradient(0, pl, 0, baseY - topY);
    pg.addColorStop(0, "#0e1428");
    pg.addColorStop(1, "#080c1a");
    x.fillStyle = pg;
    x.fillRect(0, pl, c.width, hgt - pl);
    WALL_TEX = c;
  }

  function drawWall() {
    var topY = cylY(WALL_H, R_WALL);
    var baseY = cylY(0, R_WALL);
    var plinthY = cylY(1.5, R_WALL); // top of the stone base course

    // Plaster face and stone plinth are screen-static, so they are baked with
    // the grain and blitted — same reason as the floor.
    if (!WALL_TEX) buildWallTex(topY, plinthY, baseY);
    ctx.drawImage(WALL_TEX, 0, topY);

    // stone block courses — a few horizontals plus staggered joints
    ctx.strokeStyle = "rgba(150,175,235,0.07)";
    ctx.lineWidth = 1;
    var courses = 3;
    for (var c = 1; c < courses; c++) {
      var cy = plinthY + ((baseY - plinthY) * c) / courses;
      ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.stroke();
    }
    var jointStep = (Math.PI * 2) / (N_BAYS * 4);
    for (var ja = Math.floor((yaw - 1.4) / jointStep) * jointStep; ja <= yaw + 1.4; ja += jointStep) {
      var jx = bearingX(ja);
      if (jx === null) continue;
      ctx.beginPath(); ctx.moveTo(jx, plinthY); ctx.lineTo(jx, baseY); ctx.stroke();
    }

    // horizontal timber band where plaster meets stone
    ctx.fillStyle = "#070b18";
    ctx.fillRect(0, plinthY - Math.max(2, (baseY - plinthY) * 0.08), W, Math.max(3, (baseY - plinthY) * 0.11));

    // ---- curved tile roof, one sweep per bay
    var eaveY = cylY(WALL_H + 0.15, R_WALL);
    var ridgeY = cylY(WALL_H + 2.3, R_WALL);
    var bayW = (Math.PI * 2) / N_BAYS;
    ctx.beginPath();
    ctx.moveTo(-20, eaveY);
    var step = 0.014;
    for (var a = yaw - 1.45; a <= yaw + 1.45; a += step) {
      var x = bearingX(a);
      if (x === null) continue;
      var local = ((a % bayW) + bayW) % bayW;
      var t = local / bayW; // 0..1 across a bay
      // Japanese eaves: a flat ridge that sweeps up sharply at each end.
      var curve = Math.pow(Math.abs(t - 0.5) * 2, 2.8);
      var y = lerp(ridgeY, eaveY - (eaveY - ridgeY) * 0.42, curve);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W + 20, eaveY);
    ctx.lineTo(W + 20, eaveY + 8);
    ctx.lineTo(-20, eaveY + 8);
    ctx.closePath();
    // The roof used to sit at #070c1a — so close to the night sky that it read
    // as empty air, and the only thing you could see was a row of thin light
    // ribs, which looked like fence wire. It is now a real tiled mass: lifted
    // in value so it separates from the sky, with rounded pantiles that carry a
    // lit side and a shadowed side, and horizontal courses across the slope.
    var rg = ctx.createLinearGradient(0, ridgeY, 0, eaveY + 8);
    rg.addColorStop(0, "#1a2340");
    rg.addColorStop(0.55, "#111834");
    rg.addColorStop(1, "#080d1e");
    ctx.fillStyle = rg;
    ctx.fill();

    ctx.save();
    ctx.clip();
    // pantiles: each rib is a rounded tile, lit on the moon side and shadowed
    // on the other, which is what makes the slope read as ceramic
    var ribStep = bayW / 9;
    var ribW = Math.max(1, (focal * 0.06) / R_WALL);
    for (var ra = Math.floor((yaw - 1.45) / ribStep) * ribStep; ra <= yaw + 1.45; ra += ribStep) {
      var rx = bearingX(ra);
      if (rx === null || rx < -40 || rx > W + 40) continue;
      ctx.fillStyle = "rgba(170,198,255,0.13)";
      ctx.fillRect(rx - ribW * 0.5, ridgeY, ribW, eaveY + 8 - ridgeY);
      ctx.fillStyle = "rgba(2,4,12,0.5)";
      ctx.fillRect(rx + ribW * 0.5, ridgeY, ribW * 1.1, eaveY + 8 - ridgeY);
    }
    // courses running across the slope
    ctx.strokeStyle = "rgba(3,5,14,0.5)";
    ctx.lineWidth = 1;
    for (var cc = 1; cc < 4; cc++) {
      var cy2 = ridgeY + ((eaveY + 8 - ridgeY) * cc) / 4;
      ctx.beginPath(); ctx.moveTo(0, cy2); ctx.lineTo(W, cy2); ctx.stroke();
    }
    ctx.restore();

    // deep shadow the eave throws down onto the wall face
    var esh = ctx.createLinearGradient(0, eaveY + 4, 0, eaveY + 4 + (plinthY - topY) * 0.3);
    esh.addColorStop(0, "rgba(2,4,10,0.75)");
    esh.addColorStop(1, "rgba(2,4,10,0)");
    ctx.fillStyle = esh;
    ctx.fillRect(0, eaveY + 4, W, (plinthY - topY) * 0.3);

    // bright ridge highlight
    ctx.beginPath();
    var firstPt = true;
    for (var a2 = yaw - 1.45; a2 <= yaw + 1.45; a2 += step) {
      var x2 = bearingX(a2);
      if (x2 === null) continue;
      var local2 = ((a2 % bayW) + bayW) % bayW;
      var t2 = local2 / bayW;
      var curve2 = Math.pow(Math.abs(t2 - 0.5) * 2, 2.8);
      var y2 = lerp(ridgeY, eaveY - (eaveY - ridgeY) * 0.42, curve2);
      if (firstPt) { ctx.moveTo(x2, y2); firstPt = false; } else ctx.lineTo(x2, y2);
    }
    ctx.strokeStyle = "rgba(178,205,255,0.4)";
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // eave shadow onto the plaster
    var eg = ctx.createLinearGradient(0, eaveY, 0, eaveY + (plinthY - eaveY) * 0.3);
    eg.addColorStop(0, "rgba(3,5,14,0.7)");
    eg.addColorStop(1, "rgba(3,5,14,0)");
    ctx.fillStyle = eg;
    ctx.fillRect(0, eaveY, W, Math.max(6, (plinthY - eaveY) * 0.3));

    // paper screens
    for (var i = 0; i < bays.length; i++) drawBay(bays[i]);

    // base shadow where wall meets ground
    var sg = ctx.createLinearGradient(0, baseY - 22, 0, baseY + 4);
    sg.addColorStop(0, "rgba(3,5,14,0)");
    sg.addColorStop(1, "rgba(3,5,14,0.8)");
    ctx.fillStyle = sg;
    ctx.fillRect(0, baseY - 22, W, 28);
  }

  function drawBay(bay) {
    var x = bearingX(bay.ang);
    if (x === null) return;
    var halfW = (focal * 1.5) / R_WALL;
    if (x < -halfW * 2 || x > W + halfW * 2) return;
    var topY = cylY(3.05, R_WALL);
    var botY = cylY(0.25, R_WALL);
    var h = botY - topY;
    var lit = bay.glow;
    var broken = bay.broken;

    // recessed frame — a dark reveal, with the timber post catching moonlight
    ctx.fillStyle = "#05080f";
    ctx.fillRect(x - halfW - 3, topY - 4, halfW * 2 + 6, h + 8);
    ctx.fillStyle = "rgba(150,175,235,0.07)";
    ctx.fillRect(x - halfW - 3, topY - 4, 1.2, h + 8);

    // the paper itself — a real washi sheet, dimmed to how lit this bay is
    var warm = 0.2 + lit * 0.8;
    if (SHOJI) {
      ctx.save();
      ctx.globalAlpha = clamp(0.3 + warm * 0.7, 0, 1);
      ctx.drawImage(SHOJI, x - halfW, topY, halfW * 2, h);
      // a lamp-lit sheet spills a little light past its own edges
      if (lit > 0.25 && GLOW_WARM) {
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.1 * lit;
        ctx.drawImage(GLOW_WARM, x - halfW * 1.7, topY - h * 0.35, halfW * 3.4, h * 1.7);
      }
      ctx.restore();
    }

    // the silhouette waiting behind the paper
    if (bay.sil && bay.sil.state === "shoji") {
      var e = bay.sil;
      var t = clamp(e.t / 1.15, 0, 1);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - halfW, topY, halfW * 2, h);
      ctx.clip();
      ctx.globalAlpha = 0.34 + t * 0.5;
      // grows as it steps toward the paper
      var sh = h * (0.52 + t * 0.34);
      drawNinjaShape(ctx, x, botY - h * 0.03, sh, e, true, t);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // kumiko lattice, drawn OVER the silhouette because it sits on our side
    if (KUMIKO) {
      ctx.save();
      ctx.globalAlpha = clamp(0.55 + lit * 0.45, 0, 1);
      ctx.drawImage(KUMIKO, x - halfW, topY, halfW * 2, h);
      ctx.restore();
    }

    // Ranma: the transom band of short lit panels between the screen heads and
    // the eave. A real estate has this register, and without it the wall was a
    // row of screens floating in a blank dark field.
    var ranTop = cylY(4.15, R_WALL);
    var ranBot = cylY(3.28, R_WALL);
    if (ranBot > ranTop + 1.5) {
      ctx.fillStyle = "#04060d";
      ctx.fillRect(x - halfW - 3, ranTop - 2, halfW * 2 + 6, ranBot - ranTop + 4);
      if (SHOJI) {
        ctx.save();
        ctx.globalAlpha = clamp(0.22 + warm * 0.5, 0, 1);
        ctx.drawImage(SHOJI, x - halfW * 0.94, ranTop, halfW * 1.88, ranBot - ranTop);
        ctx.restore();
      }
      // a few slats, and the timber head rail under the whole band
      ctx.fillStyle = "rgba(20,14,10,0.72)";
      for (var rn = 1; rn < 4; rn++) {
        ctx.fillRect(x - halfW * 0.94 + (halfW * 1.88 * rn) / 4 - 1, ranTop, 2, ranBot - ranTop);
      }
      ctx.fillStyle = "#0a1020";
      ctx.fillRect(x - halfW - 3, ranBot, halfW * 2 + 6, Math.max(2, halfW * 0.07));
    }

    // torn hole after the burst
    if (broken > 0) {
      ctx.save();
      ctx.globalAlpha = clamp(broken, 0, 1);
      ctx.fillStyle = "#04060e";
      ctx.beginPath();
      var cx2 = x, cy2 = topY + h * 0.52, rw = halfW * 0.72, rh = h * 0.42;
      for (var k = 0; k <= 14; k++) {
        var aa = (k / 14) * 6.283;
        var jag = 0.72 + ((k % 3) * 0.16);
        var px = cx2 + Math.cos(aa) * rw * jag;
        var py = cy2 + Math.sin(aa) * rh * jag;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // NOTE: a warm ground-spill gradient used to live here. It could never be
    // seen — drawBay runs inside drawWall, and drawGround then paints an opaque
    // floor straight over it — so it cost a gradient per lit bay per frame and
    // drew nothing. The real spill is in drawLightPass(), after the floor.
  }

  // Everything about the floor that does NOT move with the camera — the value
  // gradient, the stone grain, the concentric courses, the gravel and the
  // contact shadow — is baked once per resize and blitted as a single image.
  // Painting them live cost ~4ms a frame in large fills for pixels that were
  // identical every time. Only the moon pool and the radial joints, which do
  // track yaw, are still drawn per frame.
  function buildGroundTex() {
    var baseY = cylY(0, R_WALL);
    var fh = Math.max(1, Math.ceil(H - baseY) + 2);
    var c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(W));
    c.height = fh;
    var x = c.getContext("2d");

    var g = x.createLinearGradient(0, 0, 0, fh);
    g.addColorStop(0, "#10162d");
    g.addColorStop(0.24, "#171f3b");
    g.addColorStop(0.58, "#202a49");
    g.addColorStop(1, "#293655");
    x.fillStyle = g;
    x.fillRect(0, 0, c.width, fh);

    if (PLASTER) {
      x.save();
      x.globalAlpha = 0.42;
      x.fillStyle = x.createPattern(PLASTER, "repeat");
      x.fillRect(0, 0, c.width, fh);
      x.restore();
    }

    // Broad mineral blooms under the grain keep the surface from reading as a
    // single flat fill. They are baked once, so their gradients cost nothing
    // during play.
    for (var stain = 0; stain < 34; stain++) {
      var stx = rand(-c.width * 0.1, c.width * 1.1);
      var sty = rand(0, fh);
      var strx = rand(c.width * 0.035, c.width * 0.16);
      var stry = rand(8, 38) * (0.35 + sty / fh);
      var mineral = x.createRadialGradient(stx, sty, 0, stx, sty, strx);
      mineral.addColorStop(0, stain % 3 === 0 ? "rgba(115,142,194,0.055)" : "rgba(4,8,20,0.075)");
      mineral.addColorStop(1, "rgba(20,28,52,0)");
      x.fillStyle = mineral;
      x.save(); x.scale(1, stry / strx); x.beginPath(); x.arc(stx, sty * strx / stry, strx, 0, 6.283); x.fill(); x.restore();
    }

    // Concentric flagstone courses, in world units so their compression toward
    // the wall is real. Alternating face values and a dark/light bevel give each
    // course actual thickness instead of a collection of faint grid lines.
    GROUND_ROWS = [0];
    for (var d = 2.2; d < R_WALL; d *= 1.28) {
      var yy = cylY(0, d) - baseY;
      if (yy < -1 || yy > fh) continue;
      GROUND_ROWS.push(yy);
    }
    GROUND_ROWS.push(fh + 1);
    GROUND_ROWS.sort(function (a, b) { return a - b; });
    for (var row = 0; row < GROUND_ROWS.length - 1; row++) {
      var y0 = GROUND_ROWS[row], y1 = GROUND_ROWS[row + 1];
      x.fillStyle = row % 2
        ? "rgba(100,126,177," + (0.018 + row * 0.003) + ")"
        : "rgba(3,7,18," + (0.026 + row * 0.003) + ")";
      x.fillRect(0, y0, c.width, y1 - y0);
      if (row > 0) {
        var edgeA = clamp(y0 / fh, 0.15, 1);
        x.fillStyle = "rgba(3,6,16," + (0.3 * edgeA) + ")";
        x.fillRect(0, y0, c.width, Math.max(1, 1.6 * edgeA));
        x.fillStyle = "rgba(184,207,246," + (0.14 * edgeA) + ")";
        x.fillRect(0, y0 + Math.max(1, 1.6 * edgeA), c.width, 1);
      }
    }

    // Sparse fracture lines: short, irregular, and weighted toward the near
    // foreground where they can be resolved. They stop well before becoming
    // noisy enough to compete with attackers.
    x.lineCap = "round";
    for (var crack = 0; crack < 28; crack++) {
      var cy = Math.pow(rand(0.08, 1), 0.62) * fh;
      var cx = rand(0, c.width);
      var clen = rand(12, 44) * (0.35 + cy / fh);
      x.strokeStyle = "rgba(3,7,18," + (0.08 + cy / fh * 0.1) + ")";
      x.lineWidth = 0.7 + cy / fh * 0.7;
      x.beginPath(); x.moveTo(cx, cy);
      for (var seg = 1; seg <= 3; seg++) {
        cx += clen / 3;
        cy += rand(-4, 4) * (0.35 + cy / fh);
        x.lineTo(cx, cy);
      }
      x.stroke();
    }

    // Low, broken wet highlights catch the shoji reflections without coating
    // the entire yard in a uniform mirror finish.
    x.lineCap = "round";
    for (var wet = 0; wet < 58; wet++) {
      var wy = Math.pow(rand(0.06, 1), 0.72) * fh;
      var wx = rand(0, c.width);
      var ww = rand(4, 28) * (0.3 + wy / fh);
      x.strokeStyle = "rgba(188,215,255," + rand(0.025, 0.085) + ")";
      x.lineWidth = rand(0.6, 1.4);
      x.beginPath(); x.moveTo(wx, wy); x.lineTo(wx + ww, wy + rand(-0.6, 0.6)); x.stroke();
    }

    // gravel, densest near the eye where stones would be legible
    x.fillStyle = "rgba(210,226,255,0.055)";
    for (var s2 = 0; s2 < 180; s2++) {
      var sx2 = ((s2 * 7919) % 1000) / 1000 * c.width;
      var f = ((s2 * 104729) % 1000) / 1000;
      var sy2 = Math.pow(f, 0.55) * fh;
      var rr = 0.5 + (sy2 / fh) * 1.8;
      x.fillRect(sx2, sy2, rr, rr);
    }

    // dark contact band at the wall so the floor does not float
    var cg = x.createLinearGradient(0, 0, 0, fh * 0.14);
    cg.addColorStop(0, "rgba(5,8,18,0.75)");
    cg.addColorStop(1, "rgba(5,8,18,0)");
    x.fillStyle = cg;
    x.fillRect(0, 0, c.width, fh * 0.14);

    GROUND_TEX = c;
  }

  // The engawa: the raised timber veranda that runs along the front of the
  // screens, with its edge board and the step down to the garden. It is what
  // stops the screens meeting the ground in a hard line, and it gives the wall
  // base the depth a real estate has.
  function drawEngawa() {
    var deckTop = cylY(0.55, R_WALL);
    var deckLip = cylY(0.5, R_WALL - 0.9);
    var deckBot = cylY(0, R_WALL - 1.05);
    if (deckBot <= deckTop) return;

    // deck boards, catching a little moon along the run
    var g = ctx.createLinearGradient(0, deckTop, 0, deckLip);
    g.addColorStop(0, "#141a2e");
    g.addColorStop(1, "#1b2338");
    ctx.fillStyle = g;
    ctx.fillRect(0, deckTop, W, deckLip - deckTop + 1);

    // the nosing board along the front edge — the brightest line on the wall base
    ctx.fillStyle = "rgba(176,198,246,0.16)";
    ctx.fillRect(0, deckLip - 1, W, Math.max(1, (deckBot - deckLip) * 0.14));

    // the shadowed riser under it, down to the gravel
    var rg = ctx.createLinearGradient(0, deckLip, 0, deckBot);
    rg.addColorStop(0, "#070b16");
    rg.addColorStop(1, "#04070f");
    ctx.fillStyle = rg;
    ctx.fillRect(0, deckLip, W, deckBot - deckLip + 1);

    // board joints, running back into the wall at constant bearing
    ctx.strokeStyle = "rgba(6,9,18,0.55)";
    ctx.lineWidth = 1;
    var step = (Math.PI * 2) / (N_BAYS * 3);
    for (var a = Math.floor((yaw - 1.4) / step) * step; a <= yaw + 1.4; a += step) {
      var bx = bearingX(a);
      if (bx === null || bx < -20 || bx > W + 20) continue;
      ctx.beginPath(); ctx.moveTo(bx, deckTop); ctx.lineTo(bx, deckLip); ctx.stroke();
    }
  }

  function drawGround() {
    var baseY = cylY(0, R_WALL);
    if (!GROUND_TEX) buildGroundTex();
    ctx.drawImage(GROUND_TEX, 0, baseY - 1);

    // moonlight pooling across the yard
    var mx = bearingX(2.35);
    if (mx !== null) {
      var py = baseY + (H - baseY) * 0.35;
      var sg = ctx.createRadialGradient(mx, py, 10, mx, py, W * 0.7);
      sg.addColorStop(0, "rgba(190,214,255,0.16)");
      sg.addColorStop(0.5, "rgba(180,205,255,0.06)");
      sg.addColorStop(1, "rgba(180,205,255,0)");
      ctx.fillStyle = sg;
      ctx.fillRect(0, baseY, W, H - baseY);
    }

    // Staggered radial joints. Breaking them at every course removes the old
    // graph-paper grid while keeping the seams locked to world bearing as the
    // player turns.
    if (GROUND_ROWS.length > 1) {
      var jointStep = (Math.PI * 2) / 42;
      ctx.lineWidth = 1;
      for (var row = 0; row < GROUND_ROWS.length - 1; row++) {
        var y0 = baseY + GROUND_ROWS[row];
        var y1 = Math.min(H, baseY + GROUND_ROWS[row + 1]);
        var offset = row % 2 ? jointStep * 0.5 : 0;
        ctx.strokeStyle = "rgba(4,8,19," + (0.16 + row * 0.018) + ")";
        ctx.beginPath();
        for (var a = Math.floor((yaw - fov) / jointStep) * jointStep + offset; a <= yaw + fov; a += jointStep) {
          var jx = bearingX(a);
          if (jx === null || jx < -8 || jx > W + 8) continue;
          ctx.moveTo(jx, y0 + 1);
          ctx.lineTo(jx, y1 - 1);
        }
        ctx.stroke();
      }
    }

  }

  function drawPropV2Ground(img, x, y, dh, scaleX) {
    if (!img.complete || !img.naturalWidth) return false;
    var dw = dh * (img.naturalWidth / img.naturalHeight) * (scaleX || 1);
    // Every production prop's lowest opaque pixel is y=565 on a 724px canvas.
    // Sink that exact baseline slightly into the stone so antialiased grass,
    // roots, and feet cannot leave a bright sub-pixel gap that reads as hover.
    var groundAnchor = 565 / 724;
    var sink = clamp(dh * 0.018, 0.7, 3);
    ctx.drawImage(img, x - dw * 0.5, y + sink - dh * groundAnchor, dw, dh);
    return true;
  }

  function drawPropV2Centered(img, x, y, dh) {
    if (!img.complete || !img.naturalWidth) return false;
    var dw = dh * (img.naturalWidth / img.naturalHeight);
    // Production frames share a 512x724 canvas; their visible art is centred
    // at roughly 43.5% of its height rather than at the transparent-cell centre.
    ctx.drawImage(img, x - dw * 0.5, y - dh * 0.435, dw, dh);
    return true;
  }

  function drawGardenArt(G, p, u) {
    var img = PROP_V2[G.kind];
    // Plant the pine's illustrated grass fringe and root flare into the yard.
    var groundY = p.y + (G.kind === "pine" ? u * 0.65 : 0);
    if (img) drawPropV2Ground(img, p.x, groundY, u * 10);
    // Every garden kind has a v2 asset. Return true even during initial decode
    // so the old procedural placeholder cannot flash for a frame underneath it.
    return !!img;
  }

  function drawGardenDepth(G, p) {
    if (G.kind === "step") return;
    var u = p.s * G.sz * 0.5;
    if (u < 0.7) return;
    var groundY = p.y + (G.kind === "pine" ? u * 0.65 : 0);
    if (G.kind === "pine") {
      // Three tight overlapping lobes follow the actual root flare. A single
      // large oval underneath read as a floating display stand.
      ctx.fillStyle = "rgba(1,3,10,0.34)";
      var rootShadow = [[-0.62, 0.72], [0.02, 0.88], [0.68, 0.64]];
      for (var rs = 0; rs < rootShadow.length; rs++) {
        ctx.beginPath();
        ctx.ellipse(p.x + rootShadow[rs][0] * u * G.sk, groundY + u * 0.07,
          rootShadow[rs][1] * u * G.sk, u * 0.12, 0, 0, 6.283);
        ctx.fill();
      }
      drawGardenArt(G, p, u);
      // A few foreground blades and chips cross the cutout/floor seam, making
      // the root mass feel embedded in the same gravel as the rest of the yard.
      ctx.strokeStyle = "rgba(18,31,52,0.88)";
      ctx.lineWidth = Math.max(0.7, u * 0.08);
      ctx.beginPath();
      for (var tuft = -2; tuft <= 2; tuft++) {
        var tx = p.x + tuft * u * 0.42 * G.sk;
        ctx.moveTo(tx, groundY + u * 0.13);
        ctx.lineTo(tx + Math.sin(G.ph + tuft * 1.7) * u * 0.18, groundY - u * (0.12 + (tuft & 1) * 0.1));
      }
      ctx.stroke();
      ctx.fillStyle = "rgba(36,50,75,0.72)";
      ctx.beginPath();
      ctx.ellipse(p.x - u * 1.02 * G.sk, groundY + u * 0.11, u * 0.18, u * 0.08, -0.2, 0, 6.283);
      ctx.ellipse(p.x + u * 0.94 * G.sk, groundY + u * 0.1, u * 0.14, u * 0.07, 0.18, 0, 6.283);
      ctx.fill();
      return;
    }

    ctx.fillStyle = "rgba(2,5,14,0.34)";
    ctx.beginPath();
    ctx.ellipse(p.x, groundY + u * 0.08, u * 2.15 * G.sk, u * 0.5, 0, 0, 6.283);
    ctx.fill();
    ctx.fillStyle = "rgba(0,2,8,0.3)";
    ctx.beginPath();
    ctx.ellipse(p.x, groundY + u * 0.05, u * 1.38 * G.sk, u * 0.23, 0, 0, 6.283);
    ctx.fill();
    drawGardenArt(G, p, u);
  }

  function drawGroundSteps() {
    for (var i = 0; i < garden.length; i++) {
      var G = garden[i];
      if (G.kind !== "step") continue;
      var p = project(Math.sin(G.ang) * G.r, 0, Math.cos(G.ang) * G.r);
      if (!p || p.x < -160 || p.x > W + 160) continue;
      var u = p.s * G.sz * 0.5;
      if (u < 0.7) continue;
      ctx.fillStyle = "rgba(0,2,8,0.2)";
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + u * 0.08, u * 2.35 * G.sk, u * 0.28, 0, 0, 6.283);
      ctx.fill();
      // Keep the footprint, but compress the apparent stone thickness so this
      // reads as a path set into the yard rather than a raised platform.
      drawPropV2Ground(PROP_V2.step, p.x, p.y, u * 7.8, G.sk * 1.28);
    }
  }

  // Set rocks, clipped shrubs, stepping stones, pines and water basins. Drawn after the floor
  // and before the fixtures, so the light pass has already laid warmth on the
  // gravel and these sit in it rather than on top of it.
  function drawGarden() {
    for (var i = 0; i < garden.length; i++) {
      var G = garden[i];
      var p = project(Math.sin(G.ang) * G.r, 0, Math.cos(G.ang) * G.r);
      if (!p || p.x < -140 || p.x > W + 140) continue;
      // 0.16 put these at 2-3px across — smudges, not garden. Stone lanterns
      // use ~0.18 with much larger multipliers; these need the scale in u.
      var u = p.s * G.sz * 0.5;
      if (u < 0.7) continue;

      // A soft footprint under every illustrated object binds its transparent
      // cutout to the stone. Steps are already the floor, so they get only a
      // hairline occlusion rather than a floating-object shadow.
      ctx.fillStyle = G.kind === "step" ? "rgba(2,5,14,0.16)" : "rgba(2,5,14,0.34)";
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + u * 0.08, u * (G.kind === "pine" ? 2.5 : 2.15) * G.sk,
        u * (G.kind === "step" ? 0.34 : 0.5), 0, 0, 6.283);
      ctx.fill();
      ctx.fillStyle = G.kind === "step" ? "rgba(0,2,8,0.12)" : "rgba(0,2,8,0.3)";
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + u * 0.05, u * (G.kind === "pine" ? 1.65 : 1.38) * G.sk,
        u * (G.kind === "step" ? 0.16 : 0.23), 0, 0, 6.283);
      ctx.fill();

      if (drawGardenArt(G, p, u)) continue;

      if (G.kind === "step") {
        // a flat stepping stone laid into the gravel
        ctx.fillStyle = "rgba(8,12,24,0.55)";
        ctx.beginPath();
        ctx.ellipse(p.x, p.y + u * 0.16, u * 2.5 * G.sk, u * 0.78, 0, 0, 6.283);
        ctx.fill();
        ctx.fillStyle = "#232b45";
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, u * 2.3 * G.sk, u * 0.66, 0, 0, 6.283);
        ctx.fill();
        ctx.fillStyle = "rgba(178,202,248,0.11)";
        ctx.beginPath();
        ctx.ellipse(p.x, p.y - u * 0.14, u * 1.9 * G.sk, u * 0.34, 0, 0, 6.283);
        ctx.fill();
      } else if (G.kind === "rock") {
        // a set stone: dark mass with a moonlit crown
        ctx.fillStyle = "rgba(4,7,15,0.5)";
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, u * 2.4 * G.sk, u * 0.6, 0, 0, 6.283);
        ctx.fill();
        ctx.fillStyle = "#141b30";
        ctx.beginPath();
        ctx.moveTo(p.x - u * 1.9 * G.sk, p.y);
        ctx.quadraticCurveTo(p.x - u * 1.5 * G.sk, p.y - u * 2.1, p.x - u * 0.15, p.y - u * 2.3);
        ctx.quadraticCurveTo(p.x + u * 1.4 * G.sk, p.y - u * 1.9, p.x + u * 1.9 * G.sk, p.y);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "rgba(168,194,246,0.2)";
        ctx.beginPath();
        ctx.ellipse(p.x - u * 0.3, p.y - u * 1.9, u * 0.95 * G.sk, u * 0.3, -0.2, 0, 6.283);
        ctx.fill();
      } else if (G.kind === "shrub") {
        // clipped azalea mound
        ctx.fillStyle = "#0d1526";
        ctx.beginPath();
        ctx.ellipse(p.x, p.y - u * 0.9, u * 2.1 * G.sk, u * 1.35, 0, 0, 6.283);
        ctx.fill();
        ctx.fillStyle = "rgba(120,158,214,0.1)";
        ctx.beginPath();
        ctx.ellipse(p.x - u * 0.35, p.y - u * 1.5, u * 1.15 * G.sk, u * 0.5, -0.25, 0, 6.283);
        ctx.fill();
      } else {
        // a trained pine: bare trunk with stacked cloud-pruned pads
        var sway = Math.sin(performance.now() * 0.0006 + G.ph) * u * 0.16;
        ctx.strokeStyle = "#0a1120";
        ctx.lineWidth = Math.max(1, u * 0.42);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.quadraticCurveTo(p.x + u * 0.75, p.y - u * 2.4, p.x + sway * 0.6, p.y - u * 5.4);
        ctx.stroke();
        // Cloud-pruned pads: several small ones staggered off the trunk. Three
        // wide flat discs read as an umbrella, not a pine.
        for (var pd = 0; pd < 5; pd++) {
          var py2 = p.y - u * (2.2 + pd * 0.85);
          var px2 = p.x + sway * (0.3 + pd * 0.2) + (pd % 2 ? u * 0.95 : -u * 0.75) * (1 - pd * 0.12);
          var prx = u * (1.15 - pd * 0.14) * G.sk;
          ctx.fillStyle = "#0c1424";
          ctx.beginPath();
          ctx.ellipse(px2, py2, prx, u * (0.46 - pd * 0.045), 0, 0, 6.283);
          ctx.fill();
          ctx.fillStyle = "rgba(126,164,222,0.1)";
          ctx.beginPath();
          ctx.ellipse(px2 - prx * 0.15, py2 - u * 0.16, prx * 0.62, u * 0.13, 0, 0, 6.283);
          ctx.fill();
        }
      }
    }
  }

  function drawLanterns() {
    // Stone lanterns out in the yard first — they sit behind the hanging row.
    for (var q = 0; q < stoneLanterns.length; q++) {
      var S = stoneLanterns[q];
      var sp = project(Math.sin(S.ang) * S.r, 0, Math.cos(S.ang) * S.r);
      if (!sp || sp.x < -120 || sp.x > W + 120) continue;
      var u = sp.s * 0.18; // one unit ~ 18cm
      ctx.fillStyle = "rgba(2,5,14,0.42)";
      ctx.beginPath();
      ctx.ellipse(sp.x, sp.y + u * 0.08, u * 2.15, u * 0.52, 0, 0, 6.283);
      ctx.fill();
      ctx.fillStyle = "rgba(0,2,8,0.32)";
      ctx.beginPath();
      ctx.ellipse(sp.x, sp.y + u * 0.04, u * 1.5, u * 0.24, 0, 0, 6.283);
      ctx.fill();
      // the flame inside — stamped, not a fresh gradient every frame
      var flick = 0.86 + Math.sin(performance.now() * 0.006 + S.ang * 9) * 0.14;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      blot(GLOW_WARM, sp.x, sp.y - u * 5.5, u * 7, u * 7, 0.5 * flick);
      ctx.restore();
      drawPropV2Ground(PROP_V2.stoneLantern, sp.x, sp.y, u * 11.7);
    }

    // Paper lanterns hanging under the eaves.
    for (var i = 0; i < lanterns.length; i++) {
      var L = lanterns[i];
      var sway = Math.sin(performance.now() * 0.0007 + L.sw) * 0.035;
      var x = Math.sin(L.ang + sway) * L.r;
      var z = Math.cos(L.ang + sway) * L.r;
      var p = project(x, L.h, z);
      if (!p || p.x < -90 || p.x > W + 90) continue;
      // Cap the size: a distant lantern must stay a point of light, not a blob.
      var s = Math.min(p.s * L.sz, 26);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      blot(GLOW_WARM, p.x, p.y, s * 6, s * 6, 0.32);
      ctx.restore();
      drawPropV2Centered(PROP_V2.hangingLantern, p.x, p.y, s * 3.05);
    }
  }

  function drawStoneLanternDepth(S, sp) {
    var u = sp.s * 0.18;
    ctx.fillStyle = "rgba(2,5,14,0.42)";
    ctx.beginPath();
    ctx.ellipse(sp.x, sp.y + u * 0.08, u * 2.15, u * 0.52, 0, 0, 6.283);
    ctx.fill();
    ctx.fillStyle = "rgba(0,2,8,0.32)";
    ctx.beginPath();
    ctx.ellipse(sp.x, sp.y + u * 0.04, u * 1.5, u * 0.24, 0, 0, 6.283);
    ctx.fill();
    var flick = 0.86 + Math.sin(performance.now() * 0.006 + S.ang * 9) * 0.14;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    blot(GLOW_WARM, sp.x, sp.y - u * 5.5, u * 7, u * 7, 0.5 * flick);
    ctx.restore();
    drawPropV2Ground(PROP_V2.stoneLantern, sp.x, sp.y, u * 11.7);
  }

  function drawHangingLanternDepth(L, p) {
    var s = Math.min(p.s * L.sz, 26);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    blot(GLOW_WARM, p.x, p.y, s * 6, s * 6, 0.32);
    ctx.restore();
    drawPropV2Centered(PROP_V2.hangingLantern, p.x, p.y, s * 3.05);
  }

  /* --------------------------------------------------------- ninja drawing */

  function taper(c, x1, y1, x2, y2, w1, w2) {
    var dx = x2 - x1, dy = y2 - y1;
    var L = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = -dy / L, ny = dx / L;
    c.beginPath();
    c.moveTo(x1 + nx * w1, y1 + ny * w1);
    c.lineTo(x2 + nx * w2, y2 + ny * w2);
    c.lineTo(x2 - nx * w2, y2 - ny * w2);
    c.lineTo(x1 - nx * w1, y1 - ny * w1);
    c.closePath();
    c.fill();
  }

  // One silhouette routine, shared by the on-screen ninjas and the shoji
  // shadows. Proportions are human: head ~1/7.5 of height, shoulders ~0.25h.
  // Shared skeleton proportions. drawNinjaShape paints the silhouette and
  // drawNinjaKit paints the coloured kit on top of it; both read these so the
  // sash, sode and mask band can never drift off the body they belong to.
  function ninjaMetrics(h, footY, bulk) {
    return {
      headR: h * 0.067,
      hipY: footY - h * 0.47,
      shoulderY: footY - h * 0.8,
      headY: footY - h * 0.905,
      shoulderHalf: h * 0.116 * bulk,
      hipHalf: h * 0.072 * bulk
    };
  }

  function drawNinjaShape(c, x, footY, h, e, flat, growth) {
    var t = e ? e.t : 0;
    var bulk = e && e.w ? e.w : 1;
    // Wider shoulders over a narrower waist and hips: the taper is what stops
    // the body reading as a slab, which is most of what made these look like
    // skittles rather than people.
    var headR = h * 0.067;
    var hipY = footY - h * 0.47;
    var shoulderY = footY - h * 0.8;
    var headY = footY - h * 0.905;
    var shoulderHalf = h * 0.116 * bulk;
    var hipHalf = h * 0.072 * bulk;

    var type = e && e.type ? e.type : "runner";
    var gear = TYPES[type] ? TYPES[type].gear : "sword";
    var attacking = e && e.state === "attack";
    var falling = e && e.state === "drop";
    var moving = !e || e.state === "walk" || e.state === "flank" || e.state === "roof" || falling;
    var ph = e ? e.phase : 0;

    // A body that keeps its running pose and just rotates stiffly is the
    // "tipping dummy" look. So death folds the figure instead: the legs give
    // out, the hips sink, the arms fling, the head lolls. `fold` is the amount
    // of collapse, curved differently per death so a brute's knees go slowly
    // and a head-shot drops instantly.
    var dp = e && e.state === "dead" ? clamp(e.dead / (e.deathDur || 1.1), 0, 1) : 0;
    var dk = e && e.deathKind ? e.deathKind : "tumble";
    var fold = 0, armFling = 0;
    if (dp > 0) {
      if (dk === "kneel") fold = clamp(dp * 1.5, 0, 1);
      else if (dk === "stagger") fold = clamp((dp - 0.3) / 0.7, 0, 1);
      else if (dk === "topple") fold = dp * dp;
      else if (dk === "snap") fold = clamp(dp * 1.7, 0, 1);
      else fold = clamp(dp * 1.3, 0, 1);
      // Peaks early and RETURNS to zero: the arms are thrown out by the blow,
      // then hang as dead weight. Holding the fling open left them locked
      // horizontal, which reads as a scarecrow rather than a corpse.
      armFling = Math.sin(clamp(dp * 3, 0, 1) * Math.PI);
    }

    // Cadence follows how fast this one actually runs, so a brute lumbers and
    // a dropper sprints instead of every type sharing one gait.
    var cadence = 7.4 + (e && e.speed ? e.speed : 3.2) * 0.75;
    var gait = moving ? Math.sin(t * cadence + ph) : attacking ? 0.85 : 0.35;
    var gait2 = moving ? Math.sin(t * cadence + ph + Math.PI) : attacking ? -0.5 : -0.35;
    var bob = moving ? Math.abs(Math.sin(t * cadence + ph)) * h * 0.02 : 0;
    hipY += bob; shoulderY += bob; headY += bob;

    // Runners lean into the charge; the lean deepens through an attack wind-up.
    var lunge = attacking ? clamp(t / ATTACK_WINDUP, 0, 1) : 0;
    var lean = (moving ? h * 0.035 : 0) + lunge * h * 0.075;
    shoulderY -= lunge * h * 0.02;
    headY -= lunge * h * 0.03;
    // Crossing the courtyard sideways shears the body into the slide, so a
    // flanking ninja reads as moving across rather than marching on the spot.
    var strafe = e && e.state === "flank" ? (e.flankDir || 0) : 0;
    var leanX = lean + strafe * h * 0.05;

    // the collapse: hips drop toward the feet, everything above follows
    if (fold > 0) {
      var kneeling = dk === "kneel";
      // A kneel folds DEEPER at the hip and pitches the whole torso forward
      // over the planted hand, which is what separates "went down on hands and
      // knees" from "sank straight through the floor".
      var sink = fold * h * (kneeling ? 0.42 : 0.36);
      hipY += sink; shoulderY += sink * (kneeling ? 1.3 : 1.12); headY += sink * (kneeling ? 1.42 : 1.2);
      leanX += (e && e.deathDir ? e.deathDir : 1) * fold * h * (kneeling ? 0.15 : 0.05);
    }

    var stride = h * 0.13 * (1 - fold * 0.75);
    var legW = h * 0.042 * bulk;
    var kneeDrop = h * (0.24 - fold * 0.13);
    // brutes plant wider and sit lower — a heavy stance, not just a bigger one
    // A brute plants wider and sits lower, but takes SHORTER steps — full
    // stride on that stance splayed it into a starfish.
    if (gear === "odachi") { hipHalf *= 1.1; kneeDrop *= 1.08; stride *= 0.78; }

    // legs, with a knee so they bend rather than scissor
    // As the body folds the knees have to break OUTWARD. Just shortening the
    // legs made a corpse look like it was sinking into the floor in a lift.
    var kneeOut = fold * h * 0.11;
    for (var L = 0; L < 2; L++) {
      var g = L === 0 ? gait : gait2;
      var hx = x + (L === 0 ? -hipHalf * 0.72 : hipHalf * 0.72);
      var kx = hx + g * stride * 0.5 + (L === 0 ? -kneeOut : kneeOut);
      var fx = hx + g * stride;
      var ky = hipY + kneeDrop;
      var lift = Math.max(0, g) * h * 0.03;
      taper(c, hx, hipY, kx, ky, legW, legW * 0.82);
      taper(c, kx, ky, fx, footY - lift, legW * 0.82, legW * 0.6);
      // foot
      c.beginPath();
      c.ellipse(fx + (g > 0 ? h * 0.012 : -h * 0.012), footY - lift, h * 0.032, h * 0.014, 0, 0, 6.283);
      c.fill();
    }

    // Torso: shoulders out, waist pinched IN, hips narrow. The old control
    // points sat OUTSIDE the shoulder line, which bulged the ribs wider than
    // the shoulders and produced the slab.
    var sx0 = x + leanX;
    var waistY = hipY - h * 0.11;
    var waistHalf = shoulderHalf * 0.6;
    c.beginPath();
    c.moveTo(sx0 - shoulderHalf, shoulderY);
    c.quadraticCurveTo(x - waistHalf * 1.05, waistY, x - hipHalf, hipY + h * 0.02);
    c.lineTo(x + hipHalf, hipY + h * 0.02);
    c.quadraticCurveTo(x + waistHalf * 1.05, waistY, sx0 + shoulderHalf, shoulderY);
    // sloped shoulder line rather than a flat plank across the top
    c.quadraticCurveTo(sx0 + shoulderHalf * 0.45, shoulderY - h * 0.026,
      sx0, shoulderY - h * 0.03);
    c.quadraticCurveTo(sx0 - shoulderHalf * 0.45, shoulderY - h * 0.026,
      sx0 - shoulderHalf, shoulderY);
    c.closePath();
    c.fill();
    // sash at the waist
    c.save();
    c.globalAlpha = 0.55;
    taper(c, x - hipHalf * 0.95, hipY - h * 0.03, x + hipHalf * 0.95, hipY - h * 0.045, h * 0.017, h * 0.017);
    c.restore();

    // arms
    var throwing = e && e.throwAnim > 0;
    var armW = h * 0.04 * bulk;
    var armLen = h * 0.17;
    if (dp > 0) {
      // dying: the arms go where the blow threw them, then hang dead
      var fdir = e && e.deathDir ? e.deathDir : 1;
      var flA = armFling * (dk === "snap" ? 1.15 : 0.85);
      var plant = dk === "kneel" ? clamp((fold - 0.25) / 0.75, 0, 1) : 0;
      for (var A = 0; A < 2; A++) {
        var side = A === 0 ? -1 : 1;
        var shx = sx0 + shoulderHalf * 0.86 * side;
        var ax1 = shx + side * armLen * (0.3 + flA * 0.5);
        var ay1 = shoulderY + armLen * (0.88 - flA * 0.6);
        var ax2 = ax1 + side * armLen * (0.12 + flA * 0.28) + fdir * armLen * 0.12;
        var ay2 = ay1 + armLen * (1.02 - flA * 0.35);
        // the leading arm reaches down and takes the weight on the ground
        if (plant > 0 && side === fdir) {
          var px2 = x + fdir * h * 0.14;
          ax1 = lerp(ax1, shx + fdir * armLen * 0.4, plant);
          ay1 = lerp(ay1, shoulderY + armLen * 0.9, plant);
          ax2 = lerp(ax2, px2, plant);
          ay2 = lerp(ay2, footY - h * 0.012, plant);
        }
        taper(c, shx, shoulderY + h * 0.015, ax1, ay1, armW, armW * 0.82);
        taper(c, ax1, ay1, ax2, ay2, armW * 0.82, armW * 0.6);
      }
    } else if (attacking) {
      // Blade cocked high, both arms up — the readable "about to swing" tell.
      var rise = Math.sin(lunge * Math.PI * 0.75);
      var bx = sx0 + shoulderHalf * (1.05 + rise * 0.5);
      var by = shoulderY - h * (0.06 + rise * 0.2);
      taper(c, sx0 + shoulderHalf * 0.85, shoulderY + h * 0.01, bx, by, armW, armW * 0.8);
      taper(c, sx0 - shoulderHalf * 0.85, shoulderY + h * 0.02, sx0 - shoulderHalf * 1.15, shoulderY + h * 0.14, armW, armW * 0.72);
      // the blade itself, swept back over the shoulder
      taper(c, bx, by, bx + h * 0.1, by - h * 0.34 - rise * h * 0.06, h * 0.016, h * 0.008);
      taper(c, bx - h * 0.03, by + h * 0.015, bx + h * 0.035, by - h * 0.02, h * 0.017, h * 0.017);
    } else {
      // far arm, swinging in opposition to the legs
      var farSwing = gait2 * 0.5;
      taper(c, x - shoulderHalf * 0.86, shoulderY + h * 0.015,
        x - shoulderHalf * 0.88 - armLen * 0.1 + farSwing * h * 0.05, shoulderY + armLen, armW, armW * 0.82);
      taper(c, x - shoulderHalf * 0.88 - armLen * 0.1 + farSwing * h * 0.05, shoulderY + armLen,
        x - shoulderHalf * 0.8 + farSwing * h * 0.12, shoulderY + armLen * 2, armW * 0.82, armW * 0.62);
      // near arm — cocked back over the shoulder mid-throw
      if (throwing) {
        taper(c, x + shoulderHalf * 0.86, shoulderY + h * 0.015,
          x + shoulderHalf * 1.5, shoulderY - h * 0.03, armW, armW * 0.85);
        taper(c, x + shoulderHalf * 1.5, shoulderY - h * 0.03,
          x + shoulderHalf * 1.35, shoulderY - h * 0.13, armW * 0.85, armW * 0.6);
      } else {
        var nearSwing = gait * 0.5;
        taper(c, x + shoulderHalf * 0.86, shoulderY + h * 0.015,
          x + shoulderHalf * 0.88 + armLen * 0.1 + nearSwing * h * 0.05, shoulderY + armLen, armW, armW * 0.82);
        taper(c, x + shoulderHalf * 0.88 + armLen * 0.1 + nearSwing * h * 0.05, shoulderY + armLen,
          x + shoulderHalf * 0.8 + nearSwing * h * 0.12, shoulderY + armLen * 2, armW * 0.82, armW * 0.62);
      }
    }

    // short blade in the near hand — the light melee types only; a brute
    // carries the odachi below instead
    if (e && type !== "thrower" && type !== "brute" && !throwing && !attacking && fold < 0.4) {
      var nSwing = gait * 0.5;
      var handX = x + shoulderHalf * 0.8 + nSwing * h * 0.12;
      var handY = shoulderY + armLen * 2;
      taper(c, handX, handY, handX + h * 0.055, handY - h * 0.2, h * 0.012, h * 0.007);
      taper(c, handX - h * 0.018, handY + h * 0.012, handX + h * 0.022, handY - h * 0.012, h * 0.014, h * 0.014);
    }

    /* ---- per-type gear: at night this outline IS the character design ---- */
    var geared = fold < 0.45; // kit is lost as the body folds
    if (gear === "sword" && geared) {
      // katana sheathed across the back, handle standing over the shoulder
      taper(c, x - hipHalf * 0.3, hipY - h * 0.05, sx0 + shoulderHalf * 0.9, shoulderY - h * 0.07, h * 0.015, h * 0.012);
      taper(c, sx0 + shoulderHalf * 0.9, shoulderY - h * 0.07, sx0 + shoulderHalf * 1.35, shoulderY - h * 0.17, h * 0.012, h * 0.01);
    } else if (gear === "pouch" && geared) {
      // bandolier across the chest and a star pouch riding the hip
      taper(c, sx0 - shoulderHalf * 0.8, shoulderY + h * 0.03, x + hipHalf, hipY - h * 0.04, h * 0.012, h * 0.012);
      c.beginPath();
      c.ellipse(x - hipHalf * 1.25, hipY + h * 0.005, h * 0.038, h * 0.03, 0.2, 0, 6.283);
      c.fill();
    } else if (gear === "odachi") {
      // pauldrons — the wide, armoured read that says "this one takes two"
      for (var pd = 0; pd < 2; pd++) {
        c.beginPath();
        c.ellipse(sx0 + shoulderHalf * (pd ? 1.02 : -1.02), shoulderY + h * 0.022,
          h * 0.055 * bulk, h * 0.038 * bulk, 0, 0, 6.283);
        c.fill();
      }
      if (geared && !attacking) {
        // A blade crossing the torso is invisible — same black on black — so
        // only the ends read. Carry it low-left and sweep it well past the
        // right shoulder so what shows is a long blade, not a plank.
        var obY = shoulderY + h * 0.16;
        taper(c, x - hipHalf * 0.9, obY + h * 0.06, x + shoulderHalf * 1.95, obY - h * 0.34, h * 0.019, h * 0.005);
        taper(c, x - hipHalf * 0.9, obY + h * 0.06, x - hipHalf * 1.8, obY + h * 0.16, h * 0.013, h * 0.011);
      }
    } else if (gear === "cloak") {
      // Cloak trails BEHIND rather than wrapping all the way round — a full
      // skirt just swallowed the body and read as a robe, not a ninja.
      var flare = falling ? 1 : 0.3 + Math.abs(Math.sin(t * 4.2 + ph)) * 0.22;
      var clw = shoulderHalf * (0.9 + flare * 1.05);
      var clh = h * (0.2 + flare * 0.26) * (1 - fold * 0.5);
      var clx = x - shoulderHalf * 0.35; // hangs off the trailing shoulder
      c.beginPath();
      c.moveTo(sx0 - shoulderHalf * 0.9, shoulderY - h * 0.005);
      c.quadraticCurveTo(clx - clw, shoulderY + clh * 0.5, clx - clw * 0.8, shoulderY + clh);
      c.quadraticCurveTo(clx - clw * 0.2, shoulderY + clh * 0.72, clx + shoulderHalf * 0.5, shoulderY + clh * 0.5);
      c.quadraticCurveTo(sx0 - shoulderHalf * 0.1, shoulderY + clh * 0.2, sx0 - shoulderHalf * 0.9, shoulderY - h * 0.005);
      c.closePath();
      c.fill();
    }

    // hooded head, carried forward by the lean
    var hx0 = x + leanX * 1.35;

    // neck (this ran BEFORE hx0 existed, so it drew to undefined and silently
    // vanished — every ninja was a floating head above shoulders)
    taper(c, x, shoulderY + h * 0.005, hx0, headY + headR * 0.6, h * 0.028, h * 0.03);
    c.beginPath();
    c.arc(hx0, headY, headR, 0, 6.283);
    c.fill();
    // Hood hugs the skull and gathers to a knot at the BACK, instead of the old
    // symmetrical dome that ballooned wider than the head and read as a bell.
    c.beginPath();
    c.moveTo(hx0 - headR * 1.02, headY + headR * 0.66);
    c.quadraticCurveTo(hx0 - headR * 1.12, headY - headR * 0.95, hx0 - headR * 0.1, headY - headR * 1.12);
    c.quadraticCurveTo(hx0 + headR * 0.95, headY - headR * 1.0, hx0 + headR * 1.0, headY - headR * 0.1);
    c.quadraticCurveTo(hx0 + headR * 1.02, headY + headR * 0.5, hx0 + headR * 0.7, headY + headR * 0.78);
    c.quadraticCurveTo(hx0, headY + headR * 1.05, hx0 - headR * 1.02, headY + headR * 0.66);
    c.closePath();
    c.fill();

    // a brute wears a horned menpo brow, so the two-hit enemy is readable from
    // its head alone even when the body is edge-on or half off-screen
    if (gear === "odachi") {
      for (var hn = 0; hn < 2; hn++) {
        var hs = hn ? 1 : -1;
        taper(c, hx0 + hs * headR * 0.72, headY - headR * 0.72,
          hx0 + hs * headR * 1.7, headY - headR * 1.85, headR * 0.2, headR * 0.06);
      }
    }

    // two thin trailing ribbons off the hood knot — the motion tell. They stop
    // flying and hang the moment the body goes down.
    var swing = Math.sin(t * 5.5 + ph) * (1 - fold * 0.85);
    // The lean carries the body toward +x, so cloth trails -x. These used to
    // stream FORWARD across the face as broad filled wedges, which at any real
    // size read as a fin bolted to the head.
    for (var rb = 0; rb < 2; rb++) {
      var len = h * (rb === 0 ? 0.115 : 0.082);
      var ry0 = headY + headR * (0.1 + rb * 0.5);
      var rx0 = hx0 - headR * 0.85;
      var rmx = rx0 - len * 0.55, rmy = ry0 + swing * h * 0.022 + h * 0.012;
      var rex = rx0 - len, rey = ry0 + swing * h * 0.04 + h * 0.03;
      taper(c, rx0, ry0, rmx, rmy, h * 0.011, h * 0.008);
      taper(c, rmx, rmy, rex, rey, h * 0.008, h * 0.003);
    }
  }

  /* ------------------------------------------------------------ ninja kit */

  // The coloured shinobi kit, painted over the silhouette: steel sode at the
  // shoulders, a crimson obi with hanging tails, wrapped forearms and shins,
  // and the red mask band with two lit eye slits. Flat black bodies were the
  // right call for a night scene but they read as vector shapes; this is what
  // turns them into characters.
  //
  // Everything fades out with distance (KIT_FADE) so a far ninja is still a
  // clean silhouette against the wall and only close ones show their gear —
  // which is both how the night actually reads and much cheaper.
  var KIT_STEEL = "#68728a", KIT_STEEL_HI = "#96a1b6";
  var KIT_RED = "#a32f33", KIT_RED_HI = "#c9414a";

  function drawNinjaKit(c, x, footY, h, e) {
    if (h < 26) return; // too small for any of this to land
    var kit = clamp((h - 26) / 44, 0, 1);
    var bulk = e && e.w ? e.w : 1;
    var m = ninjaMetrics(h, footY, bulk);
    var dead = e && e.state === "dead" ? clamp(e.dead / (e.deathDur || 1.1), 0, 1) : 0;
    if (dead > 0.55) return; // the body is folding and fading; drop the detail
    var t = e ? e.t : 0;
    var ph = e ? e.phase : 0;
    var attacking = e && e.state === "attack";
    // The two-hit heavy is the sergeant: brass-trimmed armour and a red
    // headband instead of the rank-and-file steel, so "this one takes two"
    // is legible from its kit and not only from its bulk.
    var elite = e && e.type === "brute";
    var steel = elite ? "#a8823a" : KIT_STEEL;
    var steelHi = elite ? "#dcb463" : KIT_STEEL_HI;
    var moving = e && (e.state === "walk" || e.state === "flank" || e.state === "drop" || e.state === "roof");
    var cadence = 7.4 + (e && e.speed ? e.speed : 3.2) * 0.75;
    var gait = moving ? Math.sin(t * cadence + ph) : attacking ? 0.85 : 0.35;
    var gait2 = moving ? Math.sin(t * cadence + ph + Math.PI) : attacking ? -0.5 : -0.35;
    var bob = moving ? Math.abs(Math.sin(t * cadence + ph)) * h * 0.02 : 0;
    var lunge = attacking ? clamp(t / ATTACK_WINDUP, 0, 1) : 0;
    var strafe = e && e.state === "flank" ? (e.flankDir || 0) : 0;
    var leanX = (moving ? h * 0.035 : 0) + lunge * h * 0.075 + strafe * h * 0.05;

    var hipY = m.hipY + bob, shoulderY = m.shoulderY + bob - lunge * h * 0.02;
    var headY = m.headY + bob - lunge * h * 0.03;
    var sx0 = x + leanX;
    var hx0 = x + leanX * 1.35;
    var stride = h * 0.13, kneeDrop = h * 0.24;

    c.save();
    c.globalAlpha = kit * (1 - dead * 1.4);

    // shins: crimson wrapping above the tabi
    for (var L = 0; L < 2; L++) {
      var g = L === 0 ? gait : gait2;
      var hxp = x + (L === 0 ? -m.hipHalf * 0.72 : m.hipHalf * 0.72);
      var kx = hxp + g * stride * 0.5, ky = hipY + kneeDrop;
      var fx = hxp + g * stride, fy = footY - Math.max(0, g) * h * 0.03;
      c.fillStyle = KIT_RED;
      taper(c, kx + (fx - kx) * 0.42, ky + (fy - ky) * 0.42,
        kx + (fx - kx) * 0.86, ky + (fy - ky) * 0.86, h * 0.026 * bulk, h * 0.022 * bulk);
    }

    // obi: a crimson sash with two tails hanging off the knot
    c.fillStyle = KIT_RED;
    taper(c, x - m.hipHalf * 1.02, hipY - h * 0.035, x + m.hipHalf * 1.02, hipY - h * 0.05, h * 0.021, h * 0.021);
    c.fillStyle = KIT_RED_HI;
    taper(c, x + m.hipHalf * 0.35, hipY - h * 0.03, x + m.hipHalf * 0.2, hipY + h * 0.085, h * 0.012, h * 0.007);
    taper(c, x + m.hipHalf * 0.6, hipY - h * 0.03, x + m.hipHalf * 0.72, hipY + h * 0.065, h * 0.01, h * 0.006);

    // forearm wraps, on whichever arm is hanging
    c.fillStyle = KIT_RED;
    var armLen = h * 0.17, aw = h * 0.017 * bulk;
    if (!attacking) {
      var nearSwing = gait * 0.5;
      var e1x = x + m.shoulderHalf * 0.88 + armLen * 0.1 + nearSwing * h * 0.05;
      var e2x = x + m.shoulderHalf * 0.8 + nearSwing * h * 0.12;
      taper(c, e1x, shoulderY + armLen * 1.34, e2x, shoulderY + armLen * 1.86, aw, aw * 0.72);
      var f1x = x - m.shoulderHalf * 0.88 - armLen * 0.1 + gait2 * 0.5 * h * 0.05;
      var f2x = x - m.shoulderHalf * 0.8 + gait2 * 0.5 * h * 0.12;
      taper(c, f1x, shoulderY + armLen * 1.34, f2x, shoulderY + armLen * 1.86, aw, aw * 0.72);
    }

    // sode: steel shoulder plates catching the moon
    for (var s = 0; s < 2; s++) {
      var sxp = sx0 + m.shoulderHalf * (s ? 0.98 : -0.98);
      c.fillStyle = steel;
      c.beginPath();
      c.ellipse(sxp, shoulderY + h * 0.014, h * 0.034 * bulk, h * 0.023 * bulk, s ? 0.25 : -0.25, 0, 6.283);
      c.fill();
      c.fillStyle = steelHi;
      c.beginPath();
      c.ellipse(sxp, shoulderY + h * 0.006, h * 0.024 * bulk, h * 0.008 * bulk, s ? 0.25 : -0.25, 0, 6.283);
      c.fill();
    }

    // The mask band and its two lit eye slits — the single most identifiable
    // thing on the character, and the only part that still reads at range.
    // Thin band, and the slits are NARROW and canted inward. Drawn as round
    // eyes they read as a cartoon mask the moment a ninja gets close.
    c.fillStyle = KIT_RED;
    c.beginPath();
    c.ellipse(hx0, headY - m.headR * 0.16, m.headR * 1.02, m.headR * 0.26, 0, 0, 6.283);
    c.fill();

    // The elite carries a headband whose tail streams off the back of the
    // hood — the readable "this one is the sergeant" tell at any distance.
    if (elite) {
      var tail = Math.sin(t * 5.2 + ph) * h * 0.02;
      c.fillStyle = KIT_RED_HI;
      taper(c, hx0 - m.headR * 0.9, headY - m.headR * 0.3,
        hx0 - m.headR * 2.5, headY - m.headR * 0.7 + tail, h * 0.012, h * 0.009);
      taper(c, hx0 - m.headR * 2.5, headY - m.headR * 0.7 + tail,
        hx0 - m.headR * 3.9, headY - m.headR * 0.2 + tail * 1.7, h * 0.009, h * 0.003);
    }

    c.fillStyle = elite ? "#ff5347" : "#fff4de";
    for (var ee = 0; ee < 2; ee++) {
      var sgn = ee ? 1 : -1;
      c.beginPath();
      c.ellipse(hx0 + sgn * m.headR * 0.44, headY - m.headR * 0.16,
        Math.max(0.7, m.headR * 0.19), Math.max(0.4, m.headR * 0.062), sgn * 0.22, 0, 6.283);
      c.fill();
    }
    if (h > 60) { // close up, the eyes actually throw light
      c.save();
      c.globalCompositeOperation = "lighter";
      c.globalAlpha = kit * (elite ? 0.75 : 0.5);
      if (GLOW_WARM) blot(GLOW_WARM, hx0, headY - m.headR * 0.16, m.headR * 2.2, m.headR * 1.4, 0.55);
      c.restore();
    }
    c.restore();
  }

  function ninjaArtImage(e) {
    var base = NINJA_RUNNER_ART;
    var approach = NINJA_RUNNER_APPROACH;
    var attack = NINJA_RUNNER_ATTACK;
    if (e.type === "brute") {
      base = NINJA_BRUTE_ART;
      approach = NINJA_BRUTE_APPROACH;
      attack = NINJA_BRUTE_ATTACK;
    } else if (e.type === "thrower") {
      base = NINJA_THROWER_ART;
      approach = NINJA_THROWER_APPROACH;
    } else if (e.type === "dropper") {
      base = NINJA_DROPPER_ART;
      approach = NINJA_DROPPER_APPROACH;
      attack = NINJA_DROPPER_ATTACK;
    }
    if (e.state === "dead") return base[5];
    if (e.hurtT > 0) return base[4];
    if (e.state === "attack") {
      var ak = clamp(e.t / ATTACK_WINDUP, 0, 0.999);
      return attack[Math.min(3, (ak * 4) | 0)];
    }
    if (e.throwAnim > 0 && e.type === "thrower") {
      var throwK = clamp(1 - e.throwAnim / THROW_TELL, 0, 0.999);
      return NINJA_THROWER_THROW[Math.min(3, (throwK * 4) | 0)];
    }
    if (e.throwAnim > 0) return base[3];
    var cadence = 7.4 + (e.speed || 3.2) * 0.75;
    if (e.state === "walk") {
      // Four front-facing phases replace the old two-pose lateral shuffle.
      return approach[(((e.t * cadence + e.phase) / (Math.PI * 0.5)) | 0) & 3];
    }
    if (e.type === "dropper" && e.state === "drop") return base[3];
    if (e.state === "flank" || e.state === "roof" || e.state === "drop") {
      // Sideways motion deliberately keeps the punchier old pair.
      return base[1 + ((((e.t * cadence + e.phase) / Math.PI) | 0) & 1)];
    }
    return base[0];
  }

  function drawNinjaArt(e, x, footY, h, alpha) {
    var img = ninjaArtImage(e);
    if (!img.complete || !img.naturalWidth) return false;

    // The generated figures occupy roughly 62% of their source height. Draw
    // the full transparent cell larger so the visible character still matches
    // the gameplay height and the hit geometry inherited from the old figure.
    var dh = h * 1.62;
    var dw = dh * (img.naturalWidth / img.naturalHeight);
    var flip = e.state === "flank" ? (e.flankDir || 1) < 0 : Math.sin(e.phase || 0) < 0;

    ctx.save();
    ctx.globalAlpha *= alpha === undefined ? 1 : alpha;
    ctx.translate(x, 0);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(img, -dw * 0.5, footY - dh * 0.78, dw, dh);
    ctx.restore();
    return true;
  }

  function drawEnemy(e, p) {
    var h = p.s * e.h;
    if (h < 3) return;
    var footY = p.y;
    var dying = e.state === "dead";

    ctx.save();
    if (dying) {
      // Each type goes down its own way. The pose folding happens inside
      // drawNinjaShape; this is the whole-body travel on top of it.
      var k = clamp(e.dead / (e.deathDur || 1.1), 0, 1);
      var ddir = e.deathDir || 1;
      var rot = 0, slideX = 0, slideY = 0, squash = 1;
      // Rotation stays well under horizontal on purpose. The body pivots at the
      // FEET, so a full 90 degrees leaves it floating sideways off the ankles
      // like a felled mannequin; going part-way and sinking reads as a man
      // going down, and the fade covers the rest.
      if (e.deathKind === "topple") {
        // heavy: hangs a beat on dead legs, then goes over all at once
        var tk = k * k;
        rot = ddir * tk * 1.25;
        slideY = tk * h * 0.12;
      } else if (e.deathKind === "stagger") {
        // driven back a step, then the knees go
        var st = clamp((k - 0.3) / 0.7, 0, 1);
        slideX = -ddir * h * 0.1 * Math.min(1, k / 0.3);
        rot = -ddir * st * st * 1.1;
        slideY = st * h * 0.1;
      } else if (e.deathKind === "snap") {
        // head-shot: dropped where it stood, a whip back and straight down
        rot = -ddir * Math.sin(Math.min(1, k * 3) * Math.PI) * 0.2;
        slideY = k * h * 0.09;
        squash = 1 - k * 0.14;
      } else if (e.deathKind === "kneel") {
        // doubles over and goes down onto hands and knees — barely any roll,
        // because the body folds rather than falling over sideways
        rot = ddir * k * 0.3;
        slideX = ddir * h * 0.05 * k;
        slideY = k * h * 0.06;
      } else {
        // tumble: its own momentum carries it over its feet
        rot = ddir * k * 1.2;
        slideX = ddir * h * 0.14 * k;
        slideY = k * k * h * 0.1;
      }
      // Hold the body, THEN fade — but be fully gone by the end, so the last
      // and least convincing frames of the fall are never actually seen.
      ctx.globalAlpha = 1 - clamp((k - 0.62) / 0.38, 0, 1);
      ctx.translate(p.x + slideX, footY + slideY);
      ctx.rotate(rot);
      if (squash !== 1) ctx.scale(1, squash);
      ctx.translate(-p.x, -footY);
    }

    // contact shadow
    ctx.fillStyle = "rgba(0,0,0,0.42)";
    ctx.beginPath();
    ctx.ellipse(p.x, footY, h * 0.2, h * 0.052, 0, 0, 6.283);
    ctx.fill();

    var usedArt = h >= 9 && drawNinjaArt(e, p.x, footY, h, 1);
    if (!usedArt) {
      // Load/failure fallback: preserve the original procedural figure so art
      // delivery can never block the game from starting.
      var moonX = bearingX(2.35);
      var dir = moonX === null || moonX < p.x ? -1 : 1;
      var off = clamp(h * 0.009, 1, 3.2);
      ctx.fillStyle = "rgba(150,182,248,0.42)";
      drawNinjaShape(ctx, p.x + off * dir, footY - off * 0.5, h, e, false, 1);
      ctx.fillStyle = "#05070f";
      drawNinjaShape(ctx, p.x, footY, h, e, false, 1);
      drawNinjaKit(ctx, p.x, footY, h, e);
    }

    // The blade that killed it stays buried where it went in, and rides the
    // body down through the whole fall — the star used to simply vanish on
    // impact, which read as the enemy despawning rather than being hit.
    if (dying && e.stuckF !== undefined && h > 22) {
      var kd = clamp(e.dead / (e.deathDur || 1.1), 0, 1);
      var sr = Math.max(2, h * 0.032);
      var sxp = p.x + e.stuckX * h * 0.3;
      var syp = footY - e.stuckF * h;
      ctx.save();
      ctx.globalAlpha = 1 - clamp((kd - 0.55) / 0.45, 0, 1);
      // wound: a dark wet patch under the blade
      ctx.fillStyle = "rgba(96,14,20,0.85)";
      ctx.beginPath();
      ctx.ellipse(sxp, syp, sr * 1.15, sr * 0.85, 0, 0, 6.283);
      ctx.fill();
      // the star itself, half sunk and canted
      ctx.translate(sxp, syp);
      ctx.rotate(e.stuckSpin * 0.15);
      var sg = ctx.createLinearGradient(-sr, -sr, sr, sr);
      sg.addColorStop(0, "#f2f6ff");
      sg.addColorStop(0.5, "#b9c6e2");
      sg.addColorStop(1, "#6a778f");
      ctx.fillStyle = sg;
      ctx.beginPath();
      for (var q = 0; q < 8; q++) {
        var qa = (q / 8) * 6.283;
        var qr = q % 2 === 0 ? sr : sr * 0.34;
        var qx = Math.cos(qa) * qr, qy = Math.sin(qa) * qr * 0.62; // foreshortened, it is edge-on in the body
        if (q === 0) ctx.moveTo(qx, qy); else ctx.lineTo(qx, qy);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    if (e.hurtT > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = clamp(e.hurtT / 0.18, 0, 1) * 0.42;
      if (usedArt) drawNinjaArt(e, p.x, footY, h, 1);
      else {
        ctx.fillStyle = "#b8394a";
        drawNinjaShape(ctx, p.x, footY, h, e, false, 1);
      }
      ctx.restore();
    }

    // brutes wear a faint red sash so the two-hit enemy is legible
    if (e.type === "brute" && !dying && !usedArt) {
      // a sash tied shoulder-to-hip, not a bar laid across the chest
      ctx.strokeStyle = "rgba(224,69,75,0.5)";
      ctx.lineWidth = Math.max(1, h * 0.013);
      ctx.beginPath();
      ctx.moveTo(p.x - h * 0.085, footY - h * 0.76);
      ctx.lineTo(p.x + h * 0.06, footY - h * 0.49);
      ctx.stroke();
      if (e.hp === 1) {
        ctx.strokeStyle = "rgba(255,183,101,0.5)";
        ctx.beginPath();
        ctx.arc(p.x, footY - h * 0.55, h * 0.3, 0, 6.283);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // The star flies FLAT — a horizontal plate spinning about the VERTICAL axis,
  // the way a shuriken is actually thrown. So it is not a screen-plane rotation:
  // the eight points are spun in the ground plane and the depth axis is
  // foreshortened, which is what makes it read as a plate seen near edge-on
  // rather than a wheel facing the camera.
  var LAUNCH_EASE = 0.15;

  function drawStar(s, p) {
    // Swipe throws visually rise from the player's hand while their physics
    // remain on the exact camera ray, preserving all existing hit behavior.
    var dx = p.x, dy = p.y, dscale = p.s;
    if (s.lx != null && s.age < LAUNCH_EASE) {
      var k = s.age / LAUNCH_EASE;
      var e = k * k * (3 - 2 * k);
      dx = lerp(s.lx, p.x, e);
      dy = lerp(s.ly, p.y, e);
      dscale = lerp(p.s * 3.2, p.s, e);
    }
    var r = Math.max(2.4, dscale * 0.16);
    var spin = s.spin + performance.now() * 0.03;
    // Squash of the depth axis = how far off eye level the blade sits. Floored,
    // because a star at exactly eye height is geometrically a hairline and would
    // strobe out of existence every throw.
    var dist = Math.sqrt(s.x * s.x + s.z * s.z) || 0.001;
    var tilt = Math.min(0.6, Math.max(0.22, Math.abs(EYE - s.y) / dist + 0.2));
    var i, a, rr;
    ctx.save();
    ctx.translate(dx, dy);
    // plate thickness — a dark copy a hair below gives the blade an edge, so it
    // still reads as steel when the points sweep through side-on
    var th = Math.max(0.7, r * 0.1);
    ctx.fillStyle = "rgba(24,31,52,0.9)";
    ctx.beginPath();
    for (i = 0; i < 8; i++) {
      a = (i / 8) * 6.283 + spin;
      rr = i % 2 === 0 ? r : r * 0.34;
      var ex = Math.cos(a) * rr, ey = Math.sin(a) * rr * tilt + th;
      if (i === 0) ctx.moveTo(ex, ey); else ctx.lineTo(ex, ey);
    }
    ctx.closePath();
    ctx.fill();
    // Gradient stays fixed in SCREEN space (the canvas is never rotated now), so
    // the moon sits still and the blades glint as they sweep under it.
    var g = ctx.createLinearGradient(-r, -r * tilt, r, r * tilt);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.45, "#c8d6f0");
    g.addColorStop(1, "#6d7c9c");
    ctx.fillStyle = g;
    ctx.beginPath();
    for (i = 0; i < 8; i++) {
      a = (i / 8) * 6.283 + spin;
      rr = i % 2 === 0 ? r : r * 0.34;
      var vx = Math.cos(a) * rr, vy = Math.sin(a) * rr * tilt;
      if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(10,14,30,0.85)";
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.17, r * 0.17 * tilt, 0, 0, 6.283);
    ctx.fill();
    ctx.restore();
    // Glint, plus a short motion trail back along the flight — a blade moving
    // this fast should smear, and it also makes the star readable at range.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    if (s.lx != null && s.age < LAUNCH_EASE * 1.6) {
      var fade = clamp(1 - s.age / (LAUNCH_EASE * 1.6), 0, 1);
      var gr = ctx.createLinearGradient(dx, dy, s.lx, s.ly);
      gr.addColorStop(0, "rgba(198,218,255," + (0.34 * fade) + ")");
      gr.addColorStop(1, "rgba(198,218,255,0)");
      ctx.strokeStyle = gr;
      ctx.lineWidth = Math.max(1.5, r * 0.7);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(dx, dy);
      ctx.lineTo(lerp(dx, s.lx, 0.55), lerp(dy, s.ly, 0.55));
      ctx.stroke();
    }
    if (GLOW_MOON) {
      var back = project(s.px, s.py, s.pz);
      if (back) {
        for (var tr = 1; tr <= 3; tr++) {
          var f = tr / 4;
          blot(GLOW_MOON, dx + (back.x - dx) * f, dy + (back.y - dy) * f,
            r * (1.7 - f * 0.7), r * (1.7 - f * 0.7), 0.13 * (1 - f));
        }
      }
      blot(GLOW_MOON, dx, dy, r * 2.4, r * 2.4, 0.3);
    }
    ctx.restore();
  }

  function drawKunai(k, p) {
    // A proper kunai silhouette instead of the old diamond-and-rectangle icon.
    // It still follows the exact same point and collision path; all of this is
    // presentation. The blade flies point-first along its projected trajectory
    // and only rolls around its own long axis; it never cartwheels on screen.
    var r = Math.min(H * 0.2, Math.max(3.2, p.s * 0.18));
    var back = project(k.px, k.py, k.pz);
    var travelX = back ? p.x - back.x : W * 0.5 - p.x;
    var travelY = back ? p.y - back.y : H * 0.47 - p.y;
    if (Math.abs(travelX) + Math.abs(travelY) < 0.2) {
      travelX = W * 0.5 - p.x;
      travelY = H * 0.47 - p.y;
    }
    // Local blade tip points up (-Y), hence the quarter-turn after atan2.
    var flightAngle = Math.atan2(travelY, travelX) + Math.PI * 0.5;
    // Axial roll changes the apparent blade width and the light across its
    // facets. A generous floor keeps it readable and therefore deflectable.
    var bank = 0.58 + Math.abs(Math.cos(k.spin)) * 0.42;

    // Short directional smear. Keeping it tied to the previous world position
    // makes the trail follow the ballistic arc rather than the blade's spin.
    if (back) {
      var trailLen = Math.sqrt((back.x - p.x) * (back.x - p.x) + (back.y - p.y) * (back.y - p.y));
      var trailScale = clamp(trailLen / Math.max(8, r), 0.25, 1);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      var tg = ctx.createLinearGradient(p.x, p.y, back.x, back.y);
      tg.addColorStop(0, "rgba(236,243,255,0.5)");
      tg.addColorStop(0.3, "rgba(184,205,241,0.2)");
      tg.addColorStop(1, "rgba(112,137,190,0)");
      ctx.strokeStyle = tg;
      ctx.lineWidth = Math.max(1.2, r * 0.13) * trailScale;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(back.x, back.y);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(flightAngle);
    ctx.scale(bank, 1);

    // Soft black depth copy gives the blade thickness against bright shoji.
    ctx.save();
    ctx.translate(r * 0.06, r * 0.09);
    ctx.fillStyle = "rgba(4,7,15,0.88)";
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.65);
    ctx.lineTo(r * 0.48, -r * 0.2);
    ctx.lineTo(r * 0.22, r * 0.18);
    ctx.lineTo(r * 0.12, r * 1.03);
    ctx.lineTo(-r * 0.12, r * 1.03);
    ctx.lineTo(-r * 0.22, r * 0.18);
    ctx.lineTo(-r * 0.48, -r * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Broad leaf blade with two moonlit facets and a dark forged shoulder.
    var steel = ctx.createLinearGradient(-r * 0.48, -r, r * 0.48, r * 0.25);
    steel.addColorStop(0, "#f7f2df");
    steel.addColorStop(0.36, "#cbd7e9");
    steel.addColorStop(0.62, "#7e8dab");
    steel.addColorStop(1, "#303a55");
    ctx.fillStyle = steel;
    ctx.strokeStyle = "rgba(8,12,25,0.95)";
    ctx.lineWidth = Math.max(0.8, r * 0.055);
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.65);
    ctx.lineTo(r * 0.48, -r * 0.2);
    ctx.lineTo(r * 0.22, r * 0.18);
    ctx.lineTo(0, r * 0.28);
    ctx.lineTo(-r * 0.22, r * 0.18);
    ctx.lineTo(-r * 0.48, -r * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Central forged ridge and a bright cutting edge.
    ctx.strokeStyle = "rgba(247,250,255,0.75)";
    ctx.lineWidth = Math.max(0.65, r * 0.035);
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.5);
    ctx.lineTo(-r * 0.04, r * 0.2);
    ctx.lineTo(-r * 0.4, -r * 0.18);
    ctx.stroke();
    ctx.strokeStyle = "rgba(31,39,61,0.72)";
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.5);
    ctx.lineTo(r * 0.04, r * 0.2);
    ctx.lineTo(r * 0.4, -r * 0.18);
    ctx.stroke();

    // Collar, cord-wrapped grip, and the characteristic ring pommel.
    ctx.fillStyle = "#171c2b";
    ctx.fillRect(-r * 0.25, r * 0.17, r * 0.5, r * 0.16);
    ctx.fillStyle = "#252a3a";
    ctx.fillRect(-r * 0.14, r * 0.29, r * 0.28, r * 0.78);
    ctx.strokeStyle = "rgba(147,56,53,0.95)";
    ctx.lineWidth = Math.max(1, r * 0.075);
    for (var wrap = 0; wrap < 5; wrap++) {
      var wy = r * (0.38 + wrap * 0.14);
      ctx.beginPath();
      ctx.moveTo(-r * 0.13, wy - r * 0.07);
      ctx.lineTo(r * 0.13, wy + r * 0.07);
      ctx.stroke();
    }
    ctx.fillStyle = "#111624";
    ctx.strokeStyle = "#65718d";
    ctx.lineWidth = Math.max(1, r * 0.09);
    ctx.beginPath();
    ctx.arc(0, r * 1.28, r * 0.25, 0, 6.283);
    ctx.fill();
    ctx.stroke();

    // A restrained specular tick once per revolution, bright enough to call
    // attention to the threat without turning it into a glowing projectile.
    var glint = Math.max(0, Math.cos(k.spin));
    if (glint > 0.72) {
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = (glint - 0.72) / 0.28;
      ctx.fillStyle = "rgba(255,247,218,0.9)";
      ctx.beginPath();
      ctx.arc(-r * 0.18, -r * 0.55, Math.max(1, r * 0.07), 0, 6.283);
      ctx.fill();
    }
    ctx.restore();

    // Low red threat halo stays outside the rotating silhouette so incoming
    // enemy steel remains distinguishable from the player's blue-white stars.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 4);
    g.addColorStop(0, "rgba(255,132,105,0.28)");
    g.addColorStop(0.35, "rgba(222,69,75,0.13)");
    g.addColorStop(1, "rgba(255,80,80,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, r * 4, 0, 6.283); ctx.fill();
    ctx.restore();
  }

  function drawPetal(pt, p) {
    var r = Math.max(0.7, p.s * pt.sz);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(pt.sp);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = "#f7d6e4";
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * 0.5, 0, 0, 6.283);
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawShard(s, p) {
    var r = Math.max(1, p.s * s.sz);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(s.rot);
    ctx.globalAlpha = clamp(1 - s.t / s.life, 0, 1) * 0.85;
    ctx.fillStyle = "#f3e2c4";
    ctx.beginPath();
    ctx.moveTo(-r, -r * 0.6);
    ctx.lineTo(r * 0.9, -r * 0.3);
    ctx.lineTo(r * 0.4, r * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawParticle(f, p) {
    var k = 1 - f.t / f.life;
    var r = Math.max(0.6, p.s * f.sz * k);
    ctx.globalAlpha = k * 0.9;
    ctx.fillStyle = f.col;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, 6.283);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawRing(f, p) {
    var k = f.t / f.life;
    var r = p.s * 0.18 * (0.3 + k * 2.4) * f.big;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = (1 - k) * 0.8;
    ctx.strokeStyle = f.col;
    ctx.lineWidth = Math.max(1, p.s * 0.02 * (1 - k) * 3);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, 6.283);
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawRicochet(f, p) {
    var k = clamp(f.t / f.life, 0, 1);
    var fade = 1 - k;
    var r = Math.max(6, p.s * 0.16) * (0.75 + k * 0.75);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(f.rot);
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";

    // Incoming edge stops at the contact point; the brighter angled line is
    // the star glancing away. Both vanish in under a quarter-second.
    ctx.strokeStyle = "rgba(178,207,244," + (fade * 0.42) + ")";
    ctx.lineWidth = Math.max(1, r * 0.1);
    ctx.beginPath(); ctx.moveTo(-r * (1.25 - k * 0.5), 0); ctx.lineTo(0, 0); ctx.stroke();
    ctx.rotate(f.foliage ? -0.62 : -1.05);
    ctx.strokeStyle = f.col;
    ctx.globalAlpha = fade;
    ctx.lineWidth = Math.max(1.2, r * 0.12 * fade);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(r * (1.1 + k * 0.9), 0); ctx.stroke();

    // Four-frame-feeling contact glyph: a hot diamond and two crossing chips.
    ctx.rotate(0.52);
    ctx.fillStyle = f.col;
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.34 * fade);
    ctx.lineTo(r * 0.15 * fade, 0);
    ctx.lineTo(0, r * 0.34 * fade);
    ctx.lineTo(-r * 0.15 * fade, 0);
    ctx.closePath(); ctx.fill();
    for (var i = 0; i < 2; i++) {
      ctx.rotate(i ? 1.7 : -1.15);
      ctx.strokeStyle = f.foliage ? "rgba(117,151,185," + (fade * 0.75) + ")" : "rgba(255,240,205," + (fade * 0.9) + ")";
      ctx.lineWidth = Math.max(0.8, r * 0.055);
      ctx.beginPath(); ctx.moveTo(r * 0.25, 0); ctx.lineTo(r * (0.7 + k * 0.65), 0); ctx.stroke();
    }
    ctx.restore();
  }

  function drawFloater(f, p) {
    var k = f.t / f.life;
    ctx.save();
    ctx.globalAlpha = (1 - k) * 0.95;
    ctx.fillStyle = f.col;
    ctx.font = "600 " + Math.max(10, Math.min(22, p.s * 0.1)) + "px 'Geist Mono', ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(f.text, p.x, p.y - k * 16);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /* ------------------------------------------------------------- lighting */

  // ONE radial-glow sprite per tint, built once, then stamped with drawImage.
  // Every glow in this scene used to build a fresh createRadialGradient every
  // frame, which is the single most expensive thing you can do per-light in
  // Canvas 2D. Stamping a cached sprite costs a blit, so the light pass below
  // adds a dozen new lights and still comes out cheaper than what it replaced.
  function makeGlow(r, g, b) {
    var c = document.createElement("canvas");
    var S = 128;
    c.width = c.height = S;
    var x = c.getContext("2d");
    var gr = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, "rgba(" + r + "," + g + "," + b + ",1)");
    gr.addColorStop(0.32, "rgba(" + r + "," + g + "," + b + ",0.3)");
    gr.addColorStop(0.65, "rgba(" + r + "," + g + "," + b + ",0.07)");
    gr.addColorStop(1, "rgba(" + r + "," + g + "," + b + ",0)");
    x.fillStyle = gr;
    x.fillRect(0, 0, S, S);
    return c;
  }
  var GLOW_WARM = null, GLOW_MOON = null;
  var SHOJI = null, SHOJI_REF = null, KUMIKO = null, PLASTER = null, GROUND_TEX = null, WALL_TEX = null;
  var GROUND_ROWS = [];
  // createPattern allocates; building it every frame for the wall AND the floor
  // cost ~6ms. Built once, reused.
  var PLASTER_PAT = null;

  /* The wall materials are built ONCE into offscreen canvases and then blitted.
   * Drawing washi fibre, kumiko relief and plaster mottling with primitives
   * every frame would be far too expensive, which is exactly why the original
   * screens were a flat gradient plus a five-line grid — and why they read as
   * brown boxes rather than lamplit paper. */

  // Backlit rice paper: warm falloff from the lamp behind, washi fibre, blotchy
  // mottling where the sheet is thicker, and a darker edge into the frame.
  function makeShoji() {
    var c = document.createElement("canvas");
    var w = 200, h = 190;
    c.width = w; c.height = h;
    var x = c.getContext("2d");

    // the lamp sits low and behind, so the glow blooms from below centre
    var g = x.createRadialGradient(w * 0.5, h * 0.66, w * 0.05, w * 0.5, h * 0.62, w * 0.78);
    g.addColorStop(0, "#ffe0b0");
    g.addColorStop(0.42, "#f6bd7c");
    g.addColorStop(0.78, "#c88a4e");
    g.addColorStop(1, "#8d5c33");
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);

    // blotchy thickness variation in the sheet
    for (var b = 0; b < 26; b++) {
      var bx = Math.random() * w, by = Math.random() * h, br = 14 + Math.random() * 40;
      var bg = x.createRadialGradient(bx, by, 0, bx, by, br);
      var warmUp = Math.random() < 0.5;
      bg.addColorStop(0, warmUp ? "rgba(255,225,175,0.09)" : "rgba(120,74,40,0.09)");
      bg.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = bg;
      x.fillRect(bx - br, by - br, br * 2, br * 2);
    }

    // washi fibre — long fine strands, mostly horizontal
    for (var f = 0; f < 240; f++) {
      var horiz = Math.random() < 0.72;
      var fx = Math.random() * w, fy = Math.random() * h;
      var len = (horiz ? 12 + Math.random() * 46 : 8 + Math.random() * 26);
      x.strokeStyle = "rgba(255,236,205," + (0.03 + Math.random() * 0.07) + ")";
      x.lineWidth = Math.random() < 0.25 ? 1.4 : 0.7;
      x.beginPath();
      x.moveTo(fx, fy);
      x.lineTo(fx + (horiz ? len : (Math.random() - 0.5) * 5), fy + (horiz ? (Math.random() - 0.5) * 3 : len));
      x.stroke();
    }

    // the sheet darkens where it meets the frame
    var eg = x.createLinearGradient(0, 0, 0, h);
    eg.addColorStop(0, "rgba(40,22,10,0.5)");
    eg.addColorStop(0.16, "rgba(40,22,10,0)");
    eg.addColorStop(0.84, "rgba(40,22,10,0)");
    eg.addColorStop(1, "rgba(40,22,10,0.55)");
    x.fillStyle = eg;
    x.fillRect(0, 0, w, h);
    var eg2 = x.createLinearGradient(0, 0, w, 0);
    eg2.addColorStop(0, "rgba(40,22,10,0.45)");
    eg2.addColorStop(0.14, "rgba(40,22,10,0)");
    eg2.addColorStop(0.86, "rgba(40,22,10,0)");
    eg2.addColorStop(1, "rgba(40,22,10,0.45)");
    x.fillStyle = eg2;
    x.fillRect(0, 0, w, h);
    return c;
  }

  // The kumiko lattice on OUR side of the paper: each bar catches moonlight on
  // its top edge and drops a soft shadow onto the sheet behind it.
  function makeKumiko() {
    var c = document.createElement("canvas");
    var w = 200, h = 190;
    c.width = w; c.height = h;
    var x = c.getContext("2d");
    var cols = 5, rows = 6;
    var bar = 3.4;

    function slat(bx, by, bw, bh) {
      x.fillStyle = "rgba(6,8,15,0.34)";           // shadow cast on the paper
      x.fillRect(bx + 1.6, by + 1.8, bw, bh);
      x.fillStyle = "#221a12";                      // the timber
      x.fillRect(bx, by, bw, bh);
      x.fillStyle = "rgba(214,190,152,0.20)";       // lit top-left arris
      x.fillRect(bx, by, bw, Math.min(1, bh * 0.5));
      if (bw > bh) x.fillRect(bx, by, Math.min(1, bw), bh);
    }
    for (var i = 1; i < cols; i++) slat(Math.round((w * i) / cols - bar / 2), 0, bar, h);
    for (var j = 1; j < rows; j++) slat(0, Math.round((h * j) / rows - bar / 2), w, bar);
    // outer stile and rail, heavier than the inner lattice
    var ob = 6;
    slat(0, 0, w, ob); slat(0, h - ob, w, ob);
    slat(0, 0, ob, h); slat(w - ob, 0, ob, h);
    return c;
  }

  // The screen as it appears reflected in the flagstones: mirrored top-to-bottom
  // and pre-faded toward the far end, so it can be stamped straight down with no
  // canvas-wide masking (which would erase the floor along with it).
  function makeShojiReflection(src) {
    var c = document.createElement("canvas");
    c.width = src.width; c.height = src.height;
    var x = c.getContext("2d");
    x.translate(0, src.height);
    x.scale(1, -1);
    x.drawImage(src, 0, 0);
    x.setTransform(1, 0, 0, 1, 0, 0);
    // wet stone smears the image as it recedes
    var g = x.createLinearGradient(0, 0, 0, c.height);
    g.addColorStop(0, "rgba(0,0,0,0.25)");
    g.addColorStop(0.35, "rgba(0,0,0,0.72)");
    g.addColorStop(1, "rgba(0,0,0,1)");
    x.globalCompositeOperation = "destination-out";
    x.fillStyle = g;
    x.fillRect(0, 0, c.width, c.height);
    return c;
  }

  // Tiling plaster noise for the wall face.
  function makePlaster() {
    var c = document.createElement("canvas");
    var s = 128;
    c.width = c.height = s;
    var x = c.getContext("2d");
    for (var i = 0; i < 900; i++) {
      var px = Math.random() * s, py = Math.random() * s;
      var v = Math.random();
      x.fillStyle = v < 0.5
        ? "rgba(150,175,235," + (0.012 + Math.random() * 0.03) + ")"
        : "rgba(0,0,0," + (0.02 + Math.random() * 0.05) + ")";
      var r = 0.6 + Math.random() * 2.4;
      x.fillRect(px, py, r, r);
    }
    return c;
  }

  // Caller is responsible for setting "lighter" once around a run of these.
  function blot(img, x, y, rx, ry, a) {
    if (a <= 0.004 || rx <= 0 || ry <= 0) return;
    ctx.globalAlpha = a;
    ctx.drawImage(img, x - rx, y - ry, rx * 2, ry * 2);
  }

  // Light actually landing on the world: warm spill from each lit paper screen
  // onto the flagstones, pools under every lantern, and a few embers drifting
  // in the warm air. Before this, the screens and lanterns glowed but never
  // touched the courtyard, which is what kept the floor reading as flat paint.
  function drawLightPass() {
    if (!GLOW_WARM) return;
    var baseY = cylY(0, R_WALL);
    var floor = H - baseY;
    if (floor <= 0) return;
    var i, x, p;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // Reflections of the lit screens in the flagstones. A mirrored, squashed,
    // faded copy of the paper itself — far more convincing than a soft blob,
    // and it is what makes the courtyard read as polished stone rather than a
    // flat painted floor.
    var halfW = (focal * 1.5) / R_WALL;
    if (SHOJI_REF) {
      for (i = 0; i < bays.length; i++) {
        var rb = bays[i];
        var rlit = rb.glow * (1 - rb.broken * 0.6);
        if (rlit <= 0.06) continue;
        var rx = bearingX(rb.ang);
        if (rx === null || rx < -W * 0.4 || rx > W * 1.4) continue;
        var rh = Math.min(floor * 0.5, (cylY(0, R_WALL) - cylY(3.05, R_WALL)) * 1.15);
        ctx.globalAlpha = 0.17 * rlit;
        // SHOJI_REF is already mirrored and faded, so no canvas-wide mask is
        // needed. Masking the frame with destination-out ate the FLOOR too.
        ctx.drawImage(SHOJI_REF, rx - halfW * 0.96, baseY, halfW * 1.92, rh);
      }
    }

    // spill from the lit screens
    for (i = 0; i < bays.length; i++) {
      var bay = bays[i];
      var lit = bay.glow * (1 - bay.broken * 0.55);
      if (lit <= 0.02) continue;
      x = bearingX(bay.ang);
      if (x === null || x < -W * 0.4 || x > W * 1.4) continue;
      // Two stamps, not three: these are big additive fills and the cost here
      // is pure fill-rate, so the wide throw and a hotter core at the foot of
      // the screen carry it — a third overlapping smear cost real milliseconds
      // and was doing almost nothing the core wasn't already doing.
      blot(GLOW_WARM, x, baseY + floor * 0.12, halfW * 2.6, floor * 0.4, 0.3 * lit);
      blot(GLOW_WARM, x, baseY + floor * 0.04, halfW * 1.15, floor * 0.12, 0.42 * lit);
    }

    // pools under the stone lanterns
    for (i = 0; i < stoneLanterns.length; i++) {
      var S = stoneLanterns[i];
      p = project(Math.sin(S.ang) * S.r, 0, Math.cos(S.ang) * S.r);
      if (!p || p.x < -140 || p.x > W + 140) continue;
      blot(GLOW_WARM, p.x, p.y, p.s * 1.15, p.s * 0.4, 0.46);
    }

    // pools under the hanging lanterns
    for (i = 0; i < lanterns.length; i++) {
      var L = lanterns[i];
      var sway = Math.sin(performance.now() * 0.0007 + L.sw) * 0.035;
      p = project(Math.sin(L.ang + sway) * L.r, 0, Math.cos(L.ang + sway) * L.r);
      if (!p || p.x < -140 || p.x > W + 140) continue;
      blot(GLOW_WARM, p.x, p.y, p.s * 0.8, p.s * 0.27, 0.32);
    }

    // embers loafing in the warm air near the lanterns
    for (i = 0; i < embers.length; i++) {
      var em = embers[i];
      p = project(Math.sin(em.ang) * em.r, em.y, Math.cos(em.ang) * em.r);
      if (!p || p.x < -30 || p.x > W + 30) continue;
      var er = Math.max(1.1, p.s * 0.021);
      blot(GLOW_WARM, p.x, p.y, er * 3.2, er * 3.2, 0.5 * em.a);
    }

    ctx.restore();
  }

  function drawFog() {
    var baseY = cylY(0, R_WALL);
    var g = ctx.createLinearGradient(0, baseY - H * 0.1, 0, baseY + H * 0.1);
    g.addColorStop(0, "rgba(30,44,88,0)");
    g.addColorStop(0.5, "rgba(30,44,88,0.3)");
    g.addColorStop(1, "rgba(30,44,88,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, baseY - H * 0.1, W, H * 0.2);
  }

  /* -------------------------------------------------------------- HUD draw */

  function drawPlayerHand() {
    var held = charging && chargeT > 0.04;
    if ((!held && handAnim <= 0) || dying) return;
    var frame = 0, alpha = 1;
    if (!held) {
      var k = clamp(1 - handAnim / 0.24, 0, 1);
      frame = Math.min(2, (k * 3) | 0);
      alpha = 1 - clamp((k - 0.72) / 0.28, 0, 1);
    }
    var img = PLAYER_HAND_ART[frame];
    if (!img.complete || !img.naturalWidth) return;
    // In portrait, H is the LONG edge, so keying the hand to H made it fill
    // ~two thirds of a phone screen and cover the enemies you're aiming at.
    // On a tall screen key it to WIDTH and sit it lower, so it reads as coming
    // up from below the frame rather than blocking the courtyard. Desktop and
    // landscape (H <= W) are unchanged.
    var portrait = H > W;
    var dh = portrait ? clamp(W * 0.92, 300, 470) : clamp(H * 0.66, 330, 540);
    var sink = portrait ? dh * 0.14 : dh * 0.02; // push more of it below the fold on mobile
    var dw = dh * (img.naturalWidth / img.naturalHeight);
    var hx = held ? clamp(downX, W * 0.18, W * 0.82) : handX;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(hx, H + sink);
    ctx.rotate(((hx - W * 0.5) / W) * 0.12);
    ctx.drawImage(img, -dw * 0.5, -dh, dw, dh);
    ctx.restore();
  }

  function drawEdgeThreats() {
    if (mode !== "turn" || !running) return;
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (e.state === "dead") continue;
      var d = angDiff(Math.atan2(e.x, e.z), yaw);
      if (Math.abs(d) < fov * 0.5) continue;
      var right = d > 0;
      var urgency = clamp(1 - (e.dist - 2) / 26, 0, 1);
      var y = H * 0.5 + Math.sin(performance.now() * 0.004 + i) * 6;
      var x = right ? W - 26 : 26;
      ctx.save();
      ctx.globalAlpha = 0.35 + urgency * 0.6;
      ctx.fillStyle = urgency > 0.6 ? COL.blood : "rgba(200,220,255,0.85)";
      ctx.beginPath();
      if (right) { ctx.moveTo(x + 9, y); ctx.lineTo(x - 6, y - 9); ctx.lineTo(x - 6, y + 9); }
      else { ctx.moveTo(x - 9, y); ctx.lineTo(x + 6, y - 9); ctx.lineTo(x + 6, y + 9); }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawReticle() {
    if (!running || !aim.has) return;
    var x = aim.x, y = aim.y;
    var ch = charging ? clamp(chargeT / CHARGE_TIME, 0, 1) : 0;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = ch >= 1 ? COL.amber : "rgba(226,236,255,0.8)";
    ctx.lineWidth = 1.4;
    var gap = 5 + ch * 5;
    var len = 7;
    ctx.beginPath();
    ctx.moveTo(x - gap - len, y); ctx.lineTo(x - gap, y);
    ctx.moveTo(x + gap, y); ctx.lineTo(x + gap + len, y);
    ctx.moveTo(x, y - gap - len); ctx.lineTo(x, y - gap);
    ctx.moveTo(x, y + gap); ctx.lineTo(x, y + gap + len);
    ctx.stroke();
    ctx.fillStyle = ch >= 1 ? COL.amber : "rgba(226,236,255,0.9)";
    ctx.beginPath();
    ctx.arc(x, y, 1.5, 0, 6.283);
    ctx.fill();
    if (ch > 0) {
      ctx.strokeStyle = ch >= 1 ? COL.amber : "rgba(255,183,101,0.7)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 17, -Math.PI / 2, -Math.PI / 2 + ch * 6.283);
      ctx.stroke();
      if (ch >= 1) {
        ctx.globalAlpha = 0.35 + Math.sin(performance.now() * 0.012) * 0.2;
        ctx.beginPath();
        ctx.arc(x, y, 22, 0, 6.283);
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /* ------------------------------------------------------ strike animation */

  // A lens-shaped slash along a bowed curve, revealed from one end.
  function slashShape(x1, y1, x2, y2, bow, reveal, maxW) {
    var dx = x2 - x1, dy = y2 - y1;
    var Ln = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = -dy / Ln, ny = dx / Ln;
    var qx = (x1 + x2) / 2 + nx * bow, qy = (y1 + y2) / 2 + ny * bow;
    var N = 26, top = [], bot = [];
    for (var i = 0; i <= N; i++) {
      var t = (i / N) * reveal;
      var it = 1 - t;
      var px = it * it * x1 + 2 * it * t * qx + t * t * x2;
      var py = it * it * y1 + 2 * it * t * qy + t * t * y2;
      var tx = 2 * it * (qx - x1) + 2 * t * (x2 - qx);
      var ty = 2 * it * (qy - y1) + 2 * t * (y2 - qy);
      var tl = Math.sqrt(tx * tx + ty * ty) || 1;
      var w = maxW * Math.pow(Math.sin(Math.PI * Math.min(1, t)), 1.5);
      top.push([px + (-ty / tl) * w, py + (tx / tl) * w]);
      bot.push([px - (-ty / tl) * w, py - (tx / tl) * w]);
    }
    ctx.beginPath();
    for (var a = 0; a < top.length; a++) a === 0 ? ctx.moveTo(top[a][0], top[a][1]) : ctx.lineTo(top[a][0], top[a][1]);
    for (var b2 = bot.length - 1; b2 >= 0; b2--) ctx.lineTo(bot[b2][0], bot[b2][1]);
    ctx.closePath();
  }

  function drawCracks(cx, cy, k, count, len, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "rgba(226,238,255,0.8)";
    ctx.lineWidth = 1.4;
    for (var i = 0; i < count; i++) {
      var a = (i / count) * 6.283 + (i % 2) * 0.24;
      var r = len * k * (0.55 + ((i * 37) % 10) / 14);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      var px = cx, py = cy;
      var segs = 3;
      for (var s = 1; s <= segs; s++) {
        var rr = (r * s) / segs;
        var jit = ((i * 13 + s * 7) % 9 - 4) * 0.045;
        px = cx + Math.cos(a + jit) * rr;
        py = cy + Math.sin(a + jit) * rr;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawStrike() {
    if (!strike) return;
    var k = clamp(strike.t / strike.dur, 0, 1);
    var fatal = strike.fatal;

    if (strike.kind === "melee") {
      // Blade cut across the view, from the side the attacker came from.
      var fromLeft = strike.sx < W * 0.5;
      var reveal = clamp(k / (fatal ? 0.28 : 0.42), 0, 1);
      var fade = fatal ? clamp(1 - (k - 0.35) / 0.5, 0, 1) : clamp(1 - (k - 0.4) / 0.6, 0, 1);
      {
        // Shinobi's bonus stage sells a miss by having the attacker rush the
        // camera. Keep this entirely in the strike presentation: damage timing,
        // enemy range and recovery are unchanged.
        var loom = clamp(k / (fatal ? 0.45 : 0.34), 0, 1);
        var lh = H * (fatal ? 0.55 + loom * 0.5 : 0.38 + loom * 0.38);
        ctx.save();
        ctx.globalAlpha = clamp(1 - (k - (fatal ? 0.55 : 0.42)) / (fatal ? 0.35 : 0.34), 0, 1) * (fatal ? 0.95 : 0.82);
        LOOM.type = strike.enemyType || "runner";
        LOOM.w = LOOM.type === "brute" ? 1.32 : 1.05;
        LOOM.t = loom * ATTACK_WINDUP * 0.999;
        // Use the same illustrated attacker as ordinary play. The old close-up
        // path still called the procedural silhouette, which made a vector
        // character flash on screen immediately before the loss overlay.
        if (!drawNinjaArt(LOOM, strike.sx, H * 1.02, lh, 1)) {
          ctx.fillStyle = "rgba(150,182,248,0.34)";
          drawNinjaShape(ctx, strike.sx - 3, H * 1.02 - 2, lh, LOOM, false, 1);
          ctx.fillStyle = "#03050c";
          drawNinjaShape(ctx, strike.sx, H * 1.02, lh, LOOM, false, 1);
        }
        ctx.restore();
      }
      // Flash at the instant of contact.
      if (k < 0.14) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = "rgba(220,234,255," + (1 - k / 0.14) * (fatal ? 0.5 : 0.28) + ")";
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }
      var cuts = fatal ? 2 : 1;
      for (var c = 0; c < cuts; c++) {
        var flip = c === 0 ? 1 : -1;
        var x1 = fromLeft ? -W * 0.12 : W * 1.12;
        var x2 = fromLeft ? W * 1.12 : -W * 0.12;
        var y1 = H * (c === 0 ? 0.04 : 0.94);
        var y2 = H * (c === 0 ? 0.96 : 0.06);
        var rv = clamp(reveal - c * 0.24, 0, 1);
        if (rv <= 0) continue;
        var bow = H * 0.24 * flip;
        var core = (fatal ? 13 : 7) * (0.55 + fade * 0.75);
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        // soft outer glow
        ctx.globalAlpha = fade * 0.4;
        slashShape(x1, y1, x2, y2, bow, rv, core * 3.4);
        var gg = ctx.createLinearGradient(x1, y1, x2, y2);
        gg.addColorStop(0, "rgba(120,160,240,0)");
        gg.addColorStop(0.5, "rgba(150,190,255,0.55)");
        gg.addColorStop(1, "rgba(120,160,240,0)");
        ctx.fillStyle = gg;
        ctx.fill();
        // hot core
        ctx.globalAlpha = fade;
        slashShape(x1, y1, x2, y2, bow, rv, core);
        var gr = ctx.createLinearGradient(x1, y1, x2, y2);
        gr.addColorStop(0, "rgba(255,255,255,0)");
        gr.addColorStop(0.5, "rgba(255,255,255,1)");
        gr.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = gr;
        ctx.fill();
        ctx.restore();
      }
    } else {
      // A thrown blade buried in the view.
      var cx = strike.sx, cy = H * 0.47;
      var land = clamp(k / 0.14, 0, 1);
      var trem = fatal ? Math.sin(k * 60) * (1 - k) * 3 : Math.sin(k * 50) * (1 - k) * 1.6;
      var size = (fatal ? 74 : 42) * (0.35 + land * 0.65);
      ctx.save();
      ctx.globalAlpha = fatal ? 1 : clamp(1 - (k - 0.45) / 0.55, 0, 1);
      ctx.translate(cx + trem, cy);
      ctx.rotate(fromAngle(strike.sx));
      var hitSteel = ctx.createLinearGradient(-size * 0.35, -size, size * 0.35, size * 0.4);
      hitSteel.addColorStop(0, "#fff6d9");
      hitSteel.addColorStop(0.35, "#d4dfef");
      hitSteel.addColorStop(0.7, "#8291ad");
      hitSteel.addColorStop(1, "#333c55");
      ctx.fillStyle = hitSteel;
      ctx.strokeStyle = "#111626";
      ctx.lineWidth = Math.max(1.5, size * 0.045);
      ctx.beginPath();
      ctx.moveTo(0, -size * 1.12);
      ctx.lineTo(size * 0.34, -size * 0.08);
      ctx.lineTo(size * 0.18, size * 0.2);
      ctx.lineTo(0, size * 0.28);
      ctx.lineTo(-size * 0.18, size * 0.2);
      ctx.lineTo(-size * 0.34, -size * 0.08);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.72)";
      ctx.lineWidth = Math.max(1, size * 0.025);
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.lineTo(-size * 0.025, size * 0.19);
      ctx.lineTo(-size * 0.29, -size * 0.07);
      ctx.stroke();
      ctx.fillStyle = "#171c2b";
      ctx.fillRect(-size * 0.19, size * 0.18, size * 0.38, size * 0.13);
      ctx.fillStyle = "#252a3a";
      ctx.fillRect(-size * 0.105, size * 0.29, size * 0.21, size * 0.68);
      ctx.strokeStyle = "#9a3b3b";
      ctx.lineWidth = Math.max(1.5, size * 0.055);
      for (var hw = 0; hw < 4; hw++) {
        var hy = size * (0.38 + hw * 0.14);
        ctx.beginPath();
        ctx.moveTo(-size * 0.1, hy - size * 0.05);
        ctx.lineTo(size * 0.1, hy + size * 0.05);
        ctx.stroke();
      }
      ctx.fillStyle = "#111624";
      ctx.strokeStyle = "#71809c";
      ctx.lineWidth = Math.max(2, size * 0.07);
      ctx.beginPath();
      ctx.arc(0, size * 1.13, size * 0.19, 0, 6.283);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      drawCracks(cx, cy, land * (fatal ? 1 : 0.55), fatal ? 14 : 7, fatal ? H * 0.55 : H * 0.16,
        (fatal ? 0.75 : 0.5) * clamp(1 - (k - 0.5) / 0.5, 0, 1));
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = clamp(1 - k / 0.25, 0, 1) * 0.9;
      var rg2 = ctx.createRadialGradient(cx, cy, 2, cx, cy, size * 3);
      rg2.addColorStop(0, "rgba(255,244,220,0.9)");
      rg2.addColorStop(1, "rgba(255,200,140,0)");
      ctx.fillStyle = rg2;
      ctx.beginPath(); ctx.arc(cx, cy, size * 3, 0, 6.283); ctx.fill();
      ctx.restore();
    }

    // The world closes in on a fatal blow.
    if (fatal) {
      var close = clamp((k - 0.35) / 0.65, 0, 1);
      var vg2 = ctx.createRadialGradient(W / 2, H / 2, Math.max(0, (1 - close) * H * 0.62), W / 2, H / 2, H * 0.95);
      vg2.addColorStop(0, "rgba(2,3,9,0)");
      vg2.addColorStop(1, "rgba(2,3,9," + (0.55 + close * 0.45) + ")");
      ctx.fillStyle = vg2;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.globalAlpha = 1;
  }

  function fromAngle(sx) {
    // Tilt the buried blade toward wherever it came from.
    return ((sx - W * 0.5) / W) * 0.9 + 0.18;
  }

  function traceMagicBolt(points, reveal) {
    if (!points.length || reveal <= 0) return;
    var reach = reveal * (points.length - 1);
    var whole = Math.floor(reach);
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (var i = 1; i <= whole && i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    if (whole < points.length - 1) {
      var f = reach - whole;
      ctx.lineTo(lerp(points[whole].x, points[whole + 1].x, f), lerp(points[whole].y, points[whole + 1].y, f));
    }
    ctx.stroke();
  }

  function drawMagicFx() {
    if (!magicFx) return;
    var t = clamp(magicFx.age / MAGIC_FX_TIME, 0, 1);
    var enter = clamp(t / 0.18, 0, 1);
    var ease = 1 - Math.pow(1 - enter, 3);
    var fade = clamp((1 - t) / 0.32, 0, 1);
    var cx = W * 0.5, cy = H * 0.47;

    ctx.save();
    // A cold moonlight wash establishes a separate visual world for the spell.
    ctx.fillStyle = "rgba(33,45,110," + (0.22 * Math.sin(Math.min(1, t * 1.8) * Math.PI) * fade) + ")";
    ctx.fillRect(0, 0, W, H);

    // The opening exposure is brief; detail becomes visible immediately after.
    if (t < 0.09) {
      var flash = 1 - t / 0.09;
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "rgba(225,244,255," + (flash * flash * 0.78) + ")";
      ctx.fillRect(0, 0, W, H);
    }

    ctx.globalCompositeOperation = "lighter";

    // One expanding pressure ring carries the cast across the entire arena.
    var shock = clamp((t - 0.05) / 0.72, 0, 1);
    if (shock > 0 && shock < 1) {
      ctx.strokeStyle = "rgba(157,222,255," + ((1 - shock) * 0.52 * fade) + ")";
      ctx.lineWidth = Math.max(1.5, H * 0.009 * (1 - shock));
      ctx.beginPath();
      ctx.arc(cx, cy, shock * Math.max(W, H) * 0.72, 0, 6.283);
      ctx.stroke();
    }

    // Stable lightning paths connect the central seal to the enemies that were
    // visible when the button was pressed. Unlike the former random-per-frame
    // bolts, these read as intentional strikes instead of visual noise.
    for (var m = 0; m < magicFx.marks.length; m++) {
      var mark = magicFx.marks[m];
      var reveal = clamp((t - 0.08 - mark.delay) / 0.2, 0, 1);
      var boltFade = clamp((0.7 - t) / 0.3, 0, 1) * fade;
      if (reveal > 0 && boltFade > 0) {
        ctx.strokeStyle = "rgba(91,126,255," + (boltFade * 0.34) + ")";
        ctx.lineWidth = Math.max(5, H * 0.015);
        ctx.lineJoin = "round";
        traceMagicBolt(mark.points, reveal);
        ctx.strokeStyle = "rgba(224,248,255," + (boltFade * 0.95) + ")";
        ctx.lineWidth = Math.max(1.2, H * 0.0026);
        traceMagicBolt(mark.points, reveal);
      }

      var lock = clamp((t - 0.12 - mark.delay) / 0.23, 0, 1);
      var lockFade = clamp((0.82 - t) / 0.35, 0, 1) * fade;
      if (lock > 0 && lockFade > 0) {
        var mr = mark.r * lerp(1.9, 0.78, 1 - Math.pow(1 - lock, 3));
        ctx.save();
        ctx.translate(mark.x, mark.y);
        ctx.rotate(mark.rot + (REDMO ? 0 : t * 1.8));
        ctx.strokeStyle = "rgba(174,231,255," + (lockFade * 0.85) + ")";
        ctx.lineWidth = Math.max(1.2, mr * 0.045);
        ctx.setLineDash([mr * 0.34, mr * 0.16]);
        ctx.beginPath(); ctx.arc(0, 0, mr, 0, 6.283); ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = "rgba(255,255,255," + (lockFade * lock) + ")";
        ctx.lineWidth = Math.max(1, mr * 0.06);
        ctx.beginPath();
        ctx.moveTo(-mr * lock, -mr * lock); ctx.lineTo(mr * lock, mr * lock);
        ctx.moveTo(mr * lock, -mr * lock); ctx.lineTo(-mr * lock, mr * lock);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Central moon seal: concentric broken circles and eight shuriken blades.
    var sealR = H * lerp(0.035, 0.19, ease);
    var sealAlpha = fade * clamp(t / 0.08, 0, 1);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(magicFx.rot + (REDMO ? 0 : t * 0.85));
    ctx.strokeStyle = "rgba(188,226,255," + (sealAlpha * 0.78) + ")";
    ctx.lineWidth = Math.max(1.2, H * 0.0024);
    ctx.beginPath(); ctx.arc(0, 0, sealR, 0, 6.283); ctx.stroke();
    ctx.setLineDash([sealR * 0.2, sealR * 0.1]);
    ctx.lineWidth = Math.max(1, H * 0.0015);
    ctx.beginPath(); ctx.arc(0, 0, sealR * 0.72, 0, 6.283); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(180,225,255," + (sealAlpha * 0.72) + ")";
    for (var b = 0; b < 8; b++) {
      ctx.save();
      ctx.rotate((b / 8) * 6.283 - t * (REDMO ? 0 : 1.4));
      ctx.translate(0, -sealR * 0.84);
      ctx.beginPath();
      ctx.moveTo(0, -sealR * 0.2);
      ctx.lineTo(sealR * 0.075, 0);
      ctx.lineTo(0, sealR * 0.12);
      ctx.lineTo(-sealR * 0.075, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.rotate(-magicFx.rot * 1.7);
    ctx.fillStyle = "rgba(240,251,255," + sealAlpha + ")";
    ctx.beginPath();
    for (var s = 0; s < 16; s++) {
      var a = (s / 16) * 6.283;
      var sr = s % 2 === 0 ? sealR * 0.32 : sealR * 0.1;
      if (s === 0) ctx.moveTo(Math.cos(a) * sr, Math.sin(a) * sr);
      else ctx.lineTo(Math.cos(a) * sr, Math.sin(a) * sr);
    }
    ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.restore();
  }

  function drawOverlayFx() {
    if (focusT > 0) {
      var fk = clamp(focusT / FOCUS_TIME, 0, 1);
      var g = ctx.createRadialGradient(W / 2, H / 2, H * 0.15, W / 2, H / 2, H * 0.8);
      g.addColorStop(0, "rgba(111,215,192,0)");
      g.addColorStop(1, "rgba(50,150,190," + (0.28 * Math.min(1, fk * 3)) + ")");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    if (flashHurt > 0) {
      ctx.fillStyle = "rgba(190,30,40," + (flashHurt * 0.18) + ")";
      ctx.fillRect(0, 0, W, H);
      var vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.75);
      vg.addColorStop(0, "rgba(160,20,30,0)");
      vg.addColorStop(1, "rgba(160,20,30," + flashHurt * 0.5 + ")");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    }
    drawMagicFx();
    // permanent vignette keeps the eye centred
    var vv = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.72);
    vv.addColorStop(0, "rgba(2,4,12,0)");
    vv.addColorStop(1, "rgba(2,4,12,0.44)");
    ctx.fillStyle = vv;
    ctx.fillRect(0, 0, W, H);
  }

  function drawWaveBanner() {
    if (waveBanner <= 0) return;
    var k = clamp(waveBanner / 2.2, 0, 1);
    var a = k > 0.75 ? (1 - k) / 0.25 : Math.min(1, k / 0.35);
    ctx.save();
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.textAlign = "center";
    var cy = H * 0.42;
    // The banner used to be two loose lines of text floating in the middle of
    // the courtyard. It now carries the same ink-and-seal furniture as the HUD:
    // a vermillion seal stroke, hairline rules running out to either side, and
    // the whole thing sliding up as it lands.
    var slide = (1 - Math.min(1, k / 0.35)) * 14;
    ctx.translate(0, slide);

    var big = Math.min(46, W * 0.085);

    // A scrim behind the whole banner. The subtitle is amber and the wall it
    // lands on is a row of amber-lit paper screens, so it was amber on amber
    // and effectively unreadable. Darkening the plate first fixes it for any
    // background, and gives the number something to sit on.
    var scH = big * 2.2;
    var sc = ctx.createRadialGradient(W / 2, cy + big * 0.25, 0, W / 2, cy + big * 0.25, Math.max(W * 0.4, big * 7));
    sc.addColorStop(0, "rgba(3,5,14,0.82)");
    sc.addColorStop(0.5, "rgba(3,5,14,0.5)");
    sc.addColorStop(1, "rgba(3,5,14,0)");
    ctx.fillStyle = sc;
    ctx.fillRect(0, cy - scH, W, scH * 2.1);

    ctx.shadowColor = "rgba(2,4,10,0.95)";
    ctx.shadowBlur = Math.max(6, big * 0.35);
    ctx.fillStyle = COL.paper;
    ctx.font = "700 " + big + "px 'Geist', system-ui, sans-serif";
    ctx.fillText(waveBannerText, W / 2, cy);
    ctx.shadowBlur = 0;

    // seal stroke under the number
    var sw = Math.max(34, big * 1.1);
    ctx.fillStyle = COL.blood;
    ctx.globalAlpha = clamp(a, 0, 1) * 0.95;
    ctx.fillRect(W / 2 - sw / 2, cy + big * 0.28, sw, 2);

    // hairline rules reaching out to the edges of the frame
    var rw = Math.min(W * 0.3, 260);
    var ry = cy + big * 0.29;
    var grL = ctx.createLinearGradient(W / 2 - sw / 2 - rw, 0, W / 2 - sw / 2, 0);
    grL.addColorStop(0, "rgba(244,236,216,0)");
    grL.addColorStop(1, "rgba(244,236,216,0.34)");
    ctx.fillStyle = grL;
    ctx.fillRect(W / 2 - sw / 2 - rw, ry, rw - 10, 1);
    var grR = ctx.createLinearGradient(W / 2 + sw / 2, 0, W / 2 + sw / 2 + rw, 0);
    grR.addColorStop(0, "rgba(244,236,216,0.34)");
    grR.addColorStop(1, "rgba(244,236,216,0)");
    ctx.fillStyle = grR;
    ctx.fillRect(W / 2 + sw / 2 + 10, ry, rw - 10, 1);

    // Subtitle: scales with the viewport (it was pinned at 11px, so on a big
    // screen it was a whisper), heavier weight, and its own dark halo so it
    // survives landing on a lit screen.
    ctx.globalAlpha = clamp(a, 0, 1);
    var sub = clamp(W * 0.0115, 11, 16);
    ctx.font = "700 " + sub.toFixed(1) + "px 'Geist Mono', ui-monospace, monospace";
    ctx.letterSpacing = (sub * 0.32).toFixed(1) + "px";
    ctx.shadowColor = "rgba(2,4,10,0.95)";
    ctx.shadowBlur = 7;
    ctx.fillStyle = COL.amber;
    ctx.fillText("THE SHADOWS RISE", W / 2, cy + big * 0.95);
    ctx.shadowBlur = 0;
    ctx.letterSpacing = "0px";
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawMagicReady() {
    if (magicReadyT <= 0) return;
    var age = MAGIC_READY_TIME - magicReadyT;
    var enter = clamp(age / 0.24, 0, 1);
    var exit = clamp(magicReadyT / 0.42, 0, 1);
    var alpha = (1 - Math.pow(1 - enter, 3)) * exit;
    var pulse = clamp(age / 0.72, 0, 1);
    var panelW = Math.min(380, W * 0.78);
    var panelH = Math.min(66, H * 0.12);
    var cx = W * 0.5;
    var cy = Math.min(H * 0.62, H - 112);
    var sealX = cx - panelW * 0.36;
    var sealR = Math.max(18, panelH * 0.36);
    var slide = (1 - enter) * 22;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(0, slide);

    // Compact ink plate: readable over lanterns and shoji without becoming a
    // modal or hiding the central aiming lane.
    var plate = ctx.createLinearGradient(cx - panelW / 2, 0, cx + panelW / 2, 0);
    plate.addColorStop(0, "rgba(4,7,18,0)");
    plate.addColorStop(0.16, "rgba(5,9,24,0.9)");
    plate.addColorStop(0.84, "rgba(5,9,24,0.9)");
    plate.addColorStop(1, "rgba(4,7,18,0)");
    ctx.fillStyle = plate;
    ctx.fillRect(cx - panelW / 2, cy - panelH / 2, panelW, panelH);

    ctx.globalCompositeOperation = "lighter";
    // One outward echo visually links this notification to the spell itself.
    var echoR = sealR * lerp(0.8, 1.75, pulse);
    ctx.strokeStyle = "rgba(157,222,255," + ((1 - pulse) * 0.6) + ")";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(sealX, cy, echoR, 0, 6.283); ctx.stroke();

    ctx.save();
    ctx.translate(sealX, cy);
    ctx.rotate((REDMO ? 0 : age * 0.8) - 0.2);
    ctx.strokeStyle = "rgba(181,228,255,0.92)";
    ctx.lineWidth = Math.max(1.2, sealR * 0.06);
    ctx.beginPath(); ctx.arc(0, 0, sealR, 0, 6.283); ctx.stroke();
    ctx.setLineDash([sealR * 0.32, sealR * 0.16]);
    ctx.strokeStyle = "rgba(255,183,101,0.8)";
    ctx.beginPath(); ctx.arc(0, 0, sealR * 0.72, 0, 6.283); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(235,249,255,0.95)";
    ctx.beginPath();
    for (var p = 0; p < 8; p++) {
      var a = (p / 8) * 6.283;
      var r = p % 2 === 0 ? sealR * 0.48 : sealR * 0.14;
      if (p === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath(); ctx.fill();
    ctx.restore();

    ctx.globalCompositeOperation = "source-over";
    var textX = sealX + sealR * 1.65;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(3,6,18,0.95)";
    ctx.shadowBlur = 8;
    ctx.fillStyle = COL.paper;
    ctx.font = "700 " + Math.min(17, W * 0.038) + "px 'Geist', system-ui, sans-serif";
    ctx.letterSpacing = "1.7px";
    ctx.fillText("NINJA MAGIC READY", textX, cy - panelH * 0.12);
    ctx.shadowBlur = 0;
    ctx.fillStyle = COL.amber;
    ctx.font = "600 " + Math.min(10, W * 0.025) + "px 'Geist Mono', ui-monospace, monospace";
    ctx.letterSpacing = "1.2px";
    ctx.fillText("+1 CHARGE", textX, cy + panelH * 0.23);
    ctx.letterSpacing = "0px";

    // Hairlines complete the small notification without adding more copy.
    var lineY = cy + panelH * 0.43;
    var lineG = ctx.createLinearGradient(textX, 0, cx + panelW * 0.43, 0);
    lineG.addColorStop(0, "rgba(255,183,101,0.7)");
    lineG.addColorStop(1, "rgba(255,183,101,0)");
    ctx.fillStyle = lineG;
    ctx.fillRect(textX, lineY, Math.max(20, cx + panelW * 0.43 - textX), 1);
    ctx.restore();
  }

  /* ------------------------------------------------------------------ HUD */

  function updateHud() {
    scoreEl.textContent = score.toLocaleString();
    bestEl.textContent = "Best " + best.toLocaleString();
    waveEl.textContent = "Wave " + Math.max(1, wave);

    // Stamp the score on the rising edge only — updateHud runs ~10x a second,
    // so replaying the animation every tick would read as a permanent judder.
    if (score !== hudScore) {
      if (score > hudScore && hudScore >= 0 && markEl) {
        markEl.classList.remove("is-hit");
        void markEl.offsetWidth; // reflow so the animation actually replays
        markEl.classList.add("is-hit");
      }
      hudScore = score;
    }

    // Rebuild the shuriken row only when the count actually changes; blowing
    // away innerHTML 10x a second would restart every CSS transition on it.
    if (life !== hudLife) {
      var pips = "";
      for (var i = 0; i < 3; i++) pips += '<i class="' + (i < life ? "" : "is-out") + '"></i>';
      lifeEl.innerHTML = pips;
      if (life < hudLife) {
        lifeEl.classList.remove("is-struck");
        void lifeEl.offsetWidth;
        lifeEl.classList.add("is-struck");
      }
      hudLife = life;
    }
    if (combo > 1) {
      comboEl.hidden = false;
      comboEl.textContent = "×" + (1 + (combo - 1) * 0.25).toFixed(2).replace(/0+$/, "").replace(/\.$/, "") + " chain";
    } else comboEl.hidden = true;
    magicCountEl.textContent = magic;
    magicBtn.disabled = magic <= 0;
    focusFill.style.width = (focusMeter * 100).toFixed(0) + "%";
    var focusReady = focusMeter >= 1 && focusT <= 0;
    focusBtn.classList.toggle("is-ready", focusReady);
    focusBtn.disabled = !focusReady;
    // Fire the one-shot flourish only on the RISING edge. updateHud runs ~10x a
    // second, so re-adding the class every tick would restart the animation
    // forever and it would read as a permanent judder rather than a moment.
    if (focusReady && !focusWasReady) {
      focusBtn.classList.remove("just-ready");
      void focusBtn.offsetWidth; // reflow, so the animation actually replays
      focusBtn.classList.add("just-ready");
    }
    focusWasReady = focusReady;
  }

  /* ----------------------------------------------------------------- loop */

  var last = performance.now();
  var hudTick = 0;
  function frame(now) {
    var dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (document.visibilityState === "visible") {
      update(dt);
      render();
      hudTick += dt;
      if (hudTick > 0.1) { hudTick = 0; if (running) updateHud(); }
    }
    requestAnimationFrame(frame);
  }

  document.addEventListener("visibilitychange", function () {
    last = performance.now();
  });

  /* ----------------------------------------------------------------- boot */

  GLOW_WARM = makeGlow(255, 176, 96);
  GLOW_MOON = makeGlow(186, 210, 255);
  SHOJI = makeShoji();
  SHOJI_REF = makeShojiReflection(SHOJI);
  KUMIKO = makeKumiko();
  PLASTER = makePlaster();
  PLASTER_PAT = ctx.createPattern(PLASTER, "repeat");
  resize();
  buildWorld();
  setSound(soundOn);
  setMode(mode); // also writes the key hints, which depend on the stance
  document.body.classList.add("is-menu");
  updateHud();
  requestAnimationFrame(frame);




  // Slow idle drift on the menu so the courtyard feels alive before you start.
  (function idle() {
    if (!started && !REDMO) yaw += 0.0009;
    setTimeout(idle, 16);
  })();

})();
