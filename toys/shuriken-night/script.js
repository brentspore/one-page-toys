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

  /* ------------------------------------------------------------- constants */

  var EYE = 1.62; // camera height, metres
  var R_WALL = 18; // courtyard wall radius (also the spawn distance)
  var WALL_H = 4.7;
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
  var strike = null; // the incoming attack currently being animated
  var LOOM = { t: 0, phase: 0, state: "attack", type: "runner", w: 1.15, throwAnim: 0, y: 0, h: 1.8 };
  var dying = false; // fatal blow playing out; gameplay is frozen behind it
  var timeScale = 1, focusT = 0, focusMeter = 0, magic = MAGIC_START;
  var waveBanner = 0, waveBannerText = "";
  var enemies = [], stars = [], kunais = [], fx = [], petals = [], shards = [];
  var bays = [], skyStars = [], lanterns = [], stoneLanterns = [], hillProfile = [];
  var spawnQueue = 0, spawnTimer = 0, betweenWaves = 0;

  var aim = { x: 0, y: 0, has: false };
  var charging = false, chargeT = 0, cooldown = 0;
  var soundOn = true;

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
    // Narrower screens get a slightly wider lens so the courtyard still reads.
    var aspect = W / H;
    fov = clamp(1.3 + (1.35 - clamp(aspect, 0.5, 1.9)) * 0.28, 1.25, 1.55);
    focal = W * 0.5 / Math.tan(fov * 0.5);
    horizon = H * 0.47;
    if (!aim.has) { aim.x = W * 0.5; aim.y = H * 0.5; }
  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", function () { setTimeout(resize, 60); });

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
  var ambGain = null, ambNodes = [];

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

  // Night bed: wind, crickets, and an occasional distant temple bell.
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

    scheduleCricket();
    scheduleBell();
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

  function waveMix(n) {
    var t = [];
    for (var i = 0; i < 6; i++) t.push("runner");
    if (n >= 2) for (var j = 0; j < Math.min(5, n); j++) t.push("thrower");
    if (n >= 4) for (var k = 0; k < Math.min(3, n - 3); k++) t.push("brute");
    if (n >= 6) for (var m = 0; m < Math.min(3, n - 5); m++) t.push("dropper");
    return t;
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
    var type = pick(waveMix(wave));
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
      // Comes off the rooftops instead of through a screen.
      e.state = "drop";
      var da = staticArc();
      e.ang = mode === "turn" ? rand(0, Math.PI * 2) : rand(-da, da);
      e.dist = rand(9, 15);
      e.y = 7.5;
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

  function throwStar(dir, spreadAng) {
    var d = dir;
    if (spreadAng) {
      var c = Math.cos(spreadAng), s = Math.sin(spreadAng);
      d = { x: d.x * c + d.z * s, y: d.y, z: -d.x * s + d.z * c };
    }
    stars.push({
      x: d.x * 0.5, y: EYE - 0.12 + d.y * 0.5, z: d.z * 0.5,
      vx: d.x * THROW_SPEED, vy: d.y * THROW_SPEED, vz: d.z * THROW_SPEED,
      spin: rand(0, 6.283), life: 1.6, alive: true,
      px: 0, py: 0, pz: 0
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
      vx: (dx / d) * KUNAI_SPEED,
      vy: (targetY - startY) / T + 0.5 * KUNAI_G * T,
      vz: (dz / d) * KUNAI_SPEED,
      spin: rand(0, 6.283), alive: true, life: 4
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

  function pointerPos(ev) {
    return { x: ev.clientX, y: ev.clientY };
  }

  canvas.addEventListener("pointerdown", function (ev) {
    if (!running) return;
    ev.preventDefault();
    initAudio();
    canvas.setPointerCapture && canvas.setPointerCapture(ev.pointerId);
    var p = pointerPos(ev);
    pointerDown = true; dragging = false;
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
    if (!dragging && Math.abs(p.x - downX) > DRAG_PX && ev.pointerType !== "mouse") {
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
    charging = false;
    if (dragging) { dragging = false; return; }
    if (!running || over) return;
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

  function fire() {
    if (cooldown > 0 || !running || over) return;
    cooldown = THROW_COOLDOWN;
    throwStar(unproject(aim.x, aim.y));
    sndThrow(panOf(aim.x));
    hideHint();
  }

  function fireFan() {
    if (!running || over) return;
    cooldown = THROW_COOLDOWN * 1.7;
    var d = unproject(aim.x, aim.y);
    throwStar(d, -FAN_SPREAD);
    throwStar(d, 0);
    throwStar(d, FAN_SPREAD);
    sndThrow(panOf(aim.x));
    setTimeout(function () { sndThrow(panOf(aim.x)); }, 45);
    hideHint();
  }

  function useFocus() {
    if (!running || over || focusT > 0 || focusMeter < 1) return;
    focusMeter = 0;
    focusT = FOCUS_TIME;
    sndFocus(true);
  }

  function useMagic() {
    if (!running || over || magic <= 0 || enemies.length === 0) return;
    magic--;
    flashMagic = 1;
    shake = Math.max(shake, REDMO ? 3 : 16);
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
    // Hold the line cannot turn, so listing the turn keys there is a lie.
    ovKeys.innerHTML = (m === "turn"
      ? "Drag or A / D to turn &nbsp;·&nbsp; hold to charge a fan of three<br />"
      : "Tap to throw &nbsp;·&nbsp; hold to charge a fan of three<br />")
      + "Shift or right-click for focus &nbsp;·&nbsp; space for ninja magic";
    try { localStorage.setItem(MODE_KEY, m); } catch (e) {}
  }
  modeTurn.addEventListener("click", function () { setMode("turn"); });
  modeStatic.addEventListener("click", function () { setMode("static"); });

  function startGame() {
    initAudio();
    buildWorld();
    score = 0; wave = 0; life = 3; combo = 0; comboT = 0;
    magic = MAGIC_START; focusMeter = 0; focusT = 0; timeScale = 1;
    enemies = []; stars = []; kunais = []; fx = []; shards = [];
    yaw = 0; yawVel = 0;
    spawnQueue = 0; spawnTimer = 0; betweenWaves = 0.9;
    running = true; over = false; started = true;
    shake = 0; flashHurt = 0; flashMagic = 0;
    strike = null; dying = false;
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
      if (wave % 3 === 0) { magic++; }
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

  function killEnemy(e, headshot, byMagic) {
    if (e.state === "dead") return;
    e.state = "dead";
    e.dead = 0;
    // How this one goes down. A head-shot overrides type: it drops instantly
    // wherever it was, which is the whole point of hitting the head.
    e.deathKind = headshot ? "snap"
      : e.type === "brute" ? "topple"
        : e.type === "thrower" ? "stagger"
          : "tumble";
    e.deathDur = e.deathKind === "topple" ? 1.5 : e.deathKind === "stagger" ? 1.25 : 1.1;
    e.deathDir = Math.random() < 0.5 ? -1 : 1;
    e.dustDone = false;
    var def = TYPES[e.type];
    combo++;
    comboT = 2.2;
    var mult = Math.min(1 + (combo - 1) * 0.25, 4);
    var pts = Math.round(def.points * (headshot ? 1.6 : 1) * mult);
    score += pts;
    focusMeter = clamp(focusMeter + (byMagic ? 0.02 : 0.13), 0, 1);
    var sp = project(e.x, e.y + e.h * 0.55, e.z);
    burst(e.x, e.y + e.h * 0.55, e.z, headshot ? 16 : 11, "#101a30", 2.6, headshot);
    ring(e.x, e.y + e.h * 0.5, e.z, headshot ? "rgba(255,183,101,0.85)" : "rgba(190,210,255,0.6)", headshot);
    floater(e.x, e.y + e.h * 0.95, e.z, (headshot ? "HEAD " : "") + "+" + pts, headshot ? COL.amber : COL.paper);
    if (sp) sndHit(panOf(sp.x), headshot);
    updateHud();
  }

  // kind: "melee" (a ninja's blade) or "blade" (a thrown kunai). The third and
  // final hit plays a longer, weapon-specific finish before the end screen.
  function hurtPlayer(kind, srcX) {
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

    if (cooldown > 0) cooldown -= dt;
    if (charging) chargeT += dt;
    if (comboT > 0) { comboT -= dt; if (comboT <= 0) { combo = 0; updateHud(); } }
    if (shake > 0) shake = Math.max(0, shake - dt * 42);
    if (flashHurt > 0) flashHurt = Math.max(0, flashHurt - dt * 3.4);
    if (flashMagic > 0) flashMagic = Math.max(0, flashMagic - dt * 1.8);
    if (waveBanner > 0) waveBanner -= dt;

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
          hurtPlayer("melee", sp ? sp.x : W * 0.5);
        }
        continue;
      }

      if (e.state === "drop") {
        e.y -= dt * 7.5;
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

  function updateStars(dt) {
    for (var i = stars.length - 1; i >= 0; i--) {
      var s = stars[i];
      s.px = s.x; s.py = s.y; s.pz = s.z;
      // Substep so a fast star can't tunnel through a ninja.
      var steps = 3;
      var hit = false;
      for (var k = 0; k < steps && !hit; k++) {
        var sdt = dt / steps;
        s.x += s.vx * sdt;
        s.y += s.vy * sdt;
        s.z += s.vz * sdt;
        s.vy -= 2.6 * sdt; // gentle drop, keeps aim honest at range

        // vs enemies
        for (var j = 0; j < enemies.length; j++) {
          var e = enemies[j];
          if (e.state === "dead" || e.state === "shoji") continue;
          var dx = s.x - e.x, dz = s.z - e.z;
          var r = ENEMY_R * e.w + 0.1;
          if (dx * dx + dz * dz < r * r && s.y > e.y - 0.05 && s.y < e.y + e.h) {
            hit = true;
            var headshot = s.y > e.y + e.h * 0.76;
            e.hp -= headshot ? 2 : 1;
            e.hurtT = 0.18;
            if (e.hp <= 0) killEnemy(e, headshot);
            else {
              burst(s.x, s.y, s.z, 5, "#1a2440", 1.6);
              var pp = project(s.x, s.y, s.z);
              if (pp) sndHit(panOf(pp.x), false);
            }
            break;
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
      k.x += k.vx * dt;
      k.y += k.vy * dt;
      k.z += k.vz * dt;
      k.vy -= KUNAI_G * dt;
      k.spin += dt * 14;
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
    drawLanterns();

    // Everything in the round, depth sorted far to near.
    var items = [];
    var i, p;
    for (i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (e.state === "shoji") continue; // drawn on its paper screen
      p = project(e.x, e.y, e.z);
      if (p) items.push({ z: p.z, draw: drawEnemy, a: e, p: p });
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
      if (p) items.push({ z: p.z, draw: f.kind === "txt" ? drawFloater : f.kind === "ring" ? drawRing : drawParticle, a: f, p: p });
    }
    items.sort(function (a, b) { return b.z - a.z; });
    for (i = 0; i < items.length; i++) items[i].draw(items[i].a, items[i].p);

    drawFog();
    ctx.restore();

    drawEdgeThreats();
    if (!dying) drawReticle();
    drawOverlayFx();
    drawStrike();
    drawWaveBanner();
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

  function drawWall() {
    var topY = cylY(WALL_H, R_WALL);
    var baseY = cylY(0, R_WALL);
    var plinthY = cylY(1.5, R_WALL); // top of the stone base course

    // plaster upper wall
    var g = ctx.createLinearGradient(0, topY, 0, plinthY);
    g.addColorStop(0, "#0b1124");
    g.addColorStop(0.55, "#090e1f");
    g.addColorStop(1, "#070b18");
    ctx.fillStyle = g;
    ctx.fillRect(0, topY, W, plinthY - topY + 2);

    // stone plinth, darker and heavier
    var pg = ctx.createLinearGradient(0, plinthY, 0, baseY);
    pg.addColorStop(0, "#0e1428");
    pg.addColorStop(1, "#080c1a");
    ctx.fillStyle = pg;
    ctx.fillRect(0, plinthY, W, baseY - plinthY + 2);

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
    var rg = ctx.createLinearGradient(0, ridgeY, 0, eaveY + 8);
    rg.addColorStop(0, "#070c1a");
    rg.addColorStop(1, "#03050c");
    ctx.fillStyle = rg;
    ctx.fill();

    // moonlit rim along the ridge
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = "rgba(160,190,250,0.16)";
    ctx.lineWidth = 1;
    // tile ribs running down the roof slope
    var ribStep = bayW / 9;
    for (var ra = Math.floor((yaw - 1.45) / ribStep) * ribStep; ra <= yaw + 1.45; ra += ribStep) {
      var rx = bearingX(ra);
      if (rx === null) continue;
      ctx.beginPath(); ctx.moveTo(rx, ridgeY); ctx.lineTo(rx, eaveY + 8); ctx.stroke();
    }
    ctx.restore();

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

    // recessed frame
    ctx.fillStyle = "#05080f";
    ctx.fillRect(x - halfW - 3, topY - 4, halfW * 2 + 6, h + 8);

    // paper, lit from behind
    var warm = 0.2 + lit * 0.8;
    var pg = ctx.createLinearGradient(x, topY, x, botY);
    pg.addColorStop(0, "rgba(255,206,140," + (0.14 + warm * 0.5) + ")");
    pg.addColorStop(0.55, "rgba(255,183,101," + (0.1 + warm * 0.42) + ")");
    pg.addColorStop(1, "rgba(190,120,60," + (0.06 + warm * 0.26) + ")");
    ctx.fillStyle = pg;
    ctx.fillRect(x - halfW, topY, halfW * 2, h);

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

    // lattice
    ctx.strokeStyle = "rgba(20,14,10," + (0.35 + lit * 0.4) + ")";
    ctx.lineWidth = Math.max(1, halfW * 0.045);
    ctx.beginPath();
    for (var c = 1; c < 4; c++) {
      var cx = x - halfW + (halfW * 2 * c) / 4;
      ctx.moveTo(cx, topY); ctx.lineTo(cx, botY);
    }
    for (var r = 1; r < 5; r++) {
      var ry = topY + (h * r) / 5;
      ctx.moveTo(x - halfW, ry); ctx.lineTo(x + halfW, ry);
    }
    ctx.stroke();

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

    // warm spill onto the ground
    if (lit > 0.05) {
      ctx.save();
      var spill = ctx.createRadialGradient(x, botY, 2, x, botY, halfW * 2.6);
      spill.addColorStop(0, "rgba(255,175,90," + (0.16 * lit) + ")");
      spill.addColorStop(1, "rgba(255,175,90,0)");
      ctx.fillStyle = spill;
      ctx.fillRect(x - halfW * 2.6, botY - halfW * 0.4, halfW * 5.2, halfW * 2.4);
      ctx.restore();
    }
  }

  function drawGround() {
    var baseY = cylY(0, R_WALL);
    // Lighter than the wall so the courtyard floor reads as swept stone under a
    // full moon, not as a void. Near ground is brightest (closest to the eye).
    var g = ctx.createLinearGradient(0, baseY, 0, H);
    g.addColorStop(0, "#131a35");
    g.addColorStop(0.3, "#1a2242");
    g.addColorStop(0.7, "#212b50");
    g.addColorStop(1, "#28345e");
    ctx.fillStyle = g;
    ctx.fillRect(0, baseY - 1, W, H - baseY + 2);

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

    // Concentric flagstone courses. Spacing is in world units, so the
    // perspective compression toward the wall is real rather than faked.
    ctx.strokeStyle = "rgba(196,216,255,0.1)";
    ctx.lineWidth = 1;
    for (var d = 2.2; d < R_WALL; d *= 1.28) {
      var y = cylY(0, d);
      if (y < baseY - 1 || y > H) continue;
      ctx.globalAlpha = clamp((y - baseY) / (H - baseY) * 1.6, 0.15, 1);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Radial joints. A radial line has a constant bearing, so it projects to a
    // vertical line — no convergence maths needed.
    var spokes = 36;
    for (var i = 0; i < spokes; i++) {
      var ang = (i / spokes) * Math.PI * 2;
      var xNear = bearingX(ang);
      if (xNear === null) continue;
      ctx.strokeStyle = "rgba(196,216,255,0.075)";
      ctx.beginPath();
      ctx.moveTo(xNear, H);
      ctx.lineTo(xNear, cylY(0, R_WALL));
      ctx.stroke();
    }

    // Gravel speckle, densest close to the eye where stones would be legible.
    ctx.fillStyle = "rgba(210,226,255,0.055)";
    for (var s2 = 0; s2 < 260; s2++) {
      var sx2 = (s2 * 7919) % 1000 / 1000 * W;
      var f = ((s2 * 104729) % 1000) / 1000;
      var sy2 = baseY + Math.pow(f, 0.55) * (H - baseY);
      var rr = 0.5 + (sy2 - baseY) / (H - baseY) * 1.8;
      ctx.fillRect(sx2, sy2, rr, rr);
    }

    // dark contact band right at the wall so the floor doesn't float
    var cg = ctx.createLinearGradient(0, baseY, 0, baseY + (H - baseY) * 0.14);
    cg.addColorStop(0, "rgba(5,8,18,0.75)");
    cg.addColorStop(1, "rgba(5,8,18,0)");
    ctx.fillStyle = cg;
    ctx.fillRect(0, baseY, W, (H - baseY) * 0.14);
  }

  function drawLanterns() {
    // Stone lanterns out in the yard first — they sit behind the hanging row.
    for (var q = 0; q < stoneLanterns.length; q++) {
      var S = stoneLanterns[q];
      var sp = project(Math.sin(S.ang) * S.r, 0, Math.cos(S.ang) * S.r);
      if (!sp || sp.x < -120 || sp.x > W + 120) continue;
      var u = sp.s * 0.18; // one unit ~ 18cm
      ctx.fillStyle = "#070b16";
      // base, post, light box, cap
      ctx.fillRect(sp.x - u * 1.5, sp.y - u * 0.9, u * 3, u * 0.9);
      ctx.fillRect(sp.x - u * 0.55, sp.y - u * 4.4, u * 1.1, u * 3.6);
      ctx.fillRect(sp.x - u * 1.7, sp.y - u * 6.6, u * 3.4, u * 2.3);
      ctx.beginPath();
      ctx.moveTo(sp.x - u * 2.4, sp.y - u * 6.6);
      ctx.lineTo(sp.x, sp.y - u * 8.1);
      ctx.lineTo(sp.x + u * 2.4, sp.y - u * 6.6);
      ctx.closePath();
      ctx.fill();
      // the flame inside
      var fg = ctx.createRadialGradient(sp.x, sp.y - u * 5.5, u * 0.2, sp.x, sp.y - u * 5.5, u * 7);
      fg.addColorStop(0, "rgba(255,186,104,0.5)");
      fg.addColorStop(0.3, "rgba(255,150,70,0.14)");
      fg.addColorStop(1, "rgba(255,140,60,0)");
      ctx.fillStyle = fg;
      ctx.beginPath(); ctx.arc(sp.x, sp.y - u * 5.5, u * 7, 0, 6.283); ctx.fill();
      ctx.fillStyle = "rgba(255,214,150,0.9)";
      ctx.fillRect(sp.x - u * 1.1, sp.y - u * 6.2, u * 2.2, u * 1.5);
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
      var gl = ctx.createRadialGradient(p.x, p.y, s * 0.2, p.x, p.y, s * 6);
      gl.addColorStop(0, "rgba(255,180,95,0.3)");
      gl.addColorStop(0.4, "rgba(255,150,70,0.09)");
      gl.addColorStop(1, "rgba(255,140,60,0)");
      ctx.fillStyle = gl;
      ctx.beginPath(); ctx.arc(p.x, p.y, s * 6, 0, 6.283); ctx.fill();

      // cord up to the eave
      ctx.strokeStyle = "rgba(10,14,28,0.9)";
      ctx.lineWidth = Math.max(0.6, s * 0.08);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - s * 1.05);
      ctx.lineTo(p.x, p.y - s * 2.4);
      ctx.stroke();

      // paper body
      ctx.fillStyle = "rgba(255,198,124,0.95)";
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, s * 0.7, s, 0, 0, 6.283);
      ctx.fill();
      ctx.strokeStyle = "rgba(150,72,34,0.4)";
      ctx.lineWidth = Math.max(0.5, s * 0.055);
      ctx.beginPath();
      for (var r = -2; r <= 2; r++) {
        var yy = p.y + (s * r) / 2.7;
        var wgt = Math.sqrt(Math.max(0, 1 - Math.pow(r / 3.2, 2)));
        ctx.moveTo(p.x - s * 0.7 * wgt, yy);
        ctx.lineTo(p.x + s * 0.7 * wgt, yy);
      }
      ctx.stroke();
      ctx.fillStyle = "rgba(30,16,9,0.92)";
      ctx.fillRect(p.x - s * 0.2, p.y - s * 1.1, s * 0.4, s * 0.15);
      ctx.fillRect(p.x - s * 0.16, p.y + s * 0.95, s * 0.32, s * 0.13);
    }
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
    var moving = !e || e.state === "walk" || e.state === "flank" || falling;
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
      if (dk === "stagger") fold = clamp((dp - 0.3) / 0.7, 0, 1);
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
      var sink = fold * h * 0.36;
      hipY += sink; shoulderY += sink * 1.12; headY += sink * 1.2;
      leanX += (e && e.deathDir ? e.deathDir : 1) * fold * h * 0.05;
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
      for (var A = 0; A < 2; A++) {
        var side = A === 0 ? -1 : 1;
        var shx = sx0 + shoulderHalf * 0.86 * side;
        var ax1 = shx + side * armLen * (0.3 + flA * 0.5);
        var ay1 = shoulderY + armLen * (0.88 - flA * 0.6);
        var ax2 = ax1 + side * armLen * (0.12 + flA * 0.28) + fdir * armLen * 0.12;
        var ay2 = ay1 + armLen * (1.02 - flA * 0.35);
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

    // Moon rim light: draw the whole silhouette once in a pale blue, offset
    // toward the moon, then the dark body on top. The sliver left over is a
    // rim that always follows the pose — far more robust than hand-placed arcs.
    var moonX = bearingX(2.35);
    var dir = moonX === null || moonX < p.x ? -1 : 1;
    // Keep the offset a thin sliver at ALL sizes. Scaling it with height made
    // a close ninja look like plate armour, because the offset copy showed
    // through every gap between limbs.
    var off = clamp(h * 0.009, 1, 3.2);
    ctx.fillStyle = "rgba(150,182,248,0.42)";
    drawNinjaShape(ctx, p.x + off * dir, footY - off * 0.5, h, e, false, 1);

    // Always a dark silhouette; a hit reads as a brief additive flash on top
    // rather than repainting the whole body a flat maroon.
    ctx.fillStyle = "#05070f";
    drawNinjaShape(ctx, p.x, footY, h, e, false, 1);
    if (e.hurtT > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = clamp(e.hurtT / 0.18, 0, 1) * 0.5;
      ctx.fillStyle = "#b8394a";
      drawNinjaShape(ctx, p.x, footY, h, e, false, 1);
      ctx.restore();
    }

    // brutes wear a faint red sash so the two-hit enemy is legible
    if (e.type === "brute" && !dying) {
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
  function drawStar(s, p) {
    var r = Math.max(2.4, p.s * 0.16);
    var spin = s.spin + performance.now() * 0.03;
    // Squash of the depth axis = how far off eye level the blade sits. Floored,
    // because a star at exactly eye height is geometrically a hairline and would
    // strobe out of existence every throw.
    var dist = Math.sqrt(s.x * s.x + s.z * s.z) || 0.001;
    var tilt = Math.min(0.6, Math.max(0.22, Math.abs(EYE - s.y) / dist + 0.2));
    var i, a, rr;
    ctx.save();
    ctx.translate(p.x, p.y);
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
      var px = Math.cos(a) * rr, py = Math.sin(a) * rr * tilt;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(10,14,30,0.85)";
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.17, r * 0.17 * tilt, 0, 0, 6.283);
    ctx.fill();
    ctx.restore();
    // glint
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "rgba(200,220,255,0.16)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 2.1, 0, 6.283);
    ctx.fill();
    ctx.restore();
  }

  function drawKunai(k, p) {
    var r = Math.max(2.2, p.s * 0.15);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(k.spin);
    ctx.fillStyle = "#cdd8ee";
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.5);
    ctx.lineTo(r * 0.45, 0);
    ctx.lineTo(0, r * 1.1);
    ctx.lineTo(-r * 0.45, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#2b3350";
    ctx.fillRect(-r * 0.16, r * 0.9, r * 0.32, r * 0.9);
    ctx.restore();
    // threat glow so an incoming blade always reads
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 4);
    g.addColorStop(0, "rgba(255,110,110,0.4)");
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
      if (fatal) {
        // The attacker looms up out of the dark first, then cuts.
        var loom = clamp(k / 0.45, 0, 1);
        var lh = H * (0.55 + loom * 0.5);
        ctx.save();
        ctx.globalAlpha = clamp(1 - (k - 0.55) / 0.35, 0, 1) * 0.95;
        LOOM.t = 0.1 + loom * 0.42;
        // Rim first, then the dark body — without it the looming figure is just
        // a black mass against a dark sky.
        ctx.fillStyle = "rgba(150,182,248,0.34)";
        drawNinjaShape(ctx, strike.sx - 3, H * 1.02 - 2, lh, LOOM, false, 1);
        ctx.fillStyle = "#03050c";
        drawNinjaShape(ctx, strike.sx, H * 1.02, lh, LOOM, false, 1);
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
      ctx.fillStyle = "#dbe5f7";
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.lineTo(size * 0.26, 0);
      ctx.lineTo(0, size * 0.72);
      ctx.lineTo(-size * 0.26, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#232a42";
      ctx.fillRect(-size * 0.1, size * 0.6, size * 0.2, size * 0.7);
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -size * 0.9); ctx.lineTo(0, size * 0.6); ctx.stroke();
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
    if (flashMagic > 0) {
      ctx.fillStyle = "rgba(210,230,255," + (flashMagic * 0.55) + ")";
      ctx.fillRect(0, 0, W, H);
      // forked lightning
      if (flashMagic > 0.55) {
        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255," + flashMagic + ")";
        ctx.lineWidth = 2.4;
        for (var b = 0; b < 4; b++) {
          ctx.beginPath();
          var x = W * (0.2 + b * 0.2), y = 0;
          ctx.moveTo(x, y);
          while (y < H * 0.75) {
            y += H * 0.09;
            x += rand(-W * 0.05, W * 0.05);
            ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
        ctx.restore();
      }
    }
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
    ctx.fillStyle = COL.amber;
    ctx.font = "600 11px 'Geist Mono', ui-monospace, monospace";
    ctx.letterSpacing = "4px";
    ctx.fillText("THE SHADOWS RISE", W / 2, H * 0.36);
    ctx.fillStyle = COL.paper;
    ctx.font = "700 " + Math.min(46, W * 0.09) + "px 'Geist', system-ui, sans-serif";
    ctx.fillText(waveBannerText, W / 2, H * 0.44);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /* ------------------------------------------------------------------ HUD */

  function updateHud() {
    scoreEl.textContent = score.toLocaleString();
    bestEl.textContent = "Best " + best.toLocaleString();
    waveEl.textContent = "Wave " + Math.max(1, wave);
    var pips = "";
    for (var i = 0; i < 3; i++) pips += '<i class="' + (i < life ? "" : "is-out") + '"></i>';
    lifeEl.innerHTML = pips;
    if (combo > 1) {
      comboEl.hidden = false;
      comboEl.textContent = "×" + (1 + (combo - 1) * 0.25).toFixed(2).replace(/0+$/, "").replace(/\.$/, "") + " chain";
    } else comboEl.hidden = true;
    magicCountEl.textContent = magic;
    magicBtn.disabled = magic <= 0;
    focusFill.style.width = (focusMeter * 100).toFixed(0) + "%";
    focusBtn.classList.toggle("is-ready", focusMeter >= 1 && focusT <= 0);
    focusBtn.disabled = focusMeter < 1 || focusT > 0;
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
