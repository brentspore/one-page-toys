/* Marble Machine — a marble music machine you program and watch play itself.
 * Place pegs on the looping barrel; on each step, active lanes drop a glass
 * marble that free-falls onto a tuned vibraphone bar (the marble hitting IS the
 * note), then a conveyor on the left lifts the marbles back to the top reservoir
 * to fall again. Pentatonic-tuned so anything you program sounds good.
 * The whole cabinet is a pseudo-3D shadowbox: a shallow perspective camera sways
 * it side to side like a display piece (drag the wood to swivel it yourself).
 * Vanilla Canvas 2D + Web Audio (fully synthesized — no samples).
 */
(function () {
  "use strict";

  // ---- TUNABLES -----------------------------------------------------------
  var COLS = 8;                 // note lanes / tuned bars (left = low, right = high)
  var STEPS = 16;               // steps in the loop (16th notes → one bar)
  var BASE_MIDI = 60;           // C4 root
  var SCALES = [
    { name: "Major",   deg: [0, 2, 4, 7, 9] },
    { name: "Minor",   deg: [0, 3, 5, 7, 10] },
    { name: "Akebono", deg: [0, 2, 3, 7, 8] }
  ];
  var BPM_MIN = 54, BPM_MAX = 150, BPM_STEP = 6;
  var G = 4200;                 // gravity (machine units / s²) — sets the fall time
  // 3D presentation: shallow perspective camera, cabinet yaws side to side
  var F = 900;                  // focal length (machine units)
  var SWAY_A = 0.17;            // idle sway amplitude (rad ≈ 9.7°)
  var SWAY_T = 16;              // seconds per full side-to-side cycle
  var SWAY_FIXED = 0.09;        // static yaw for prefers-reduced-motion
  var SWIVEL_MAX = 0.30;        // manual drag-to-swivel clamp (rad)
  // -------------------------------------------------------------------------

  var TAU = Math.PI * 2;
  var KEY = "opt-marble-v1";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var hintEl = document.querySelector(".hint");

  // ---- machine geometry (design-space, projected to fit) ------------------
  var MW = 460, MH = 666;
  var FW = 16, LW = 54;                            // frame post + left lift channel
  var railY = 46, hopY = 78, gridTop = 96, rowH = 22;
  var gridBot = gridTop + STEPS * rowH;            // 448
  var barY = 500, resTop = 528, resBot = 596, troughTop = 612, troughBot = 646;
  var PL = FW + LW + 16, PR = MW - FW - 12;        // playfield x-range
  var colW = (PR - PL) / COLS;
  var MR = colW * 0.29;                            // marble radius
  var liftX0 = FW, liftX1 = FW + LW, liftCX = (liftX0 + liftX1) / 2;
  var liftTopY = railY, liftBotY = troughBot - 8;
  var resvX0 = liftX1 + 18, resvX1 = MW - FW - 20, resvY = 40;

  // the shadowbox opening (front-face cut) + depth planes (z: + toward viewer)
  var OPEN_X0 = PL - 16, OPEN_X1 = PR + 16, OPEN_Y0 = gridTop - 34, OPEN_Y1 = troughBot + 6;
  var DB = -55, DPEG = -48, DMID = -30, DTR = -30, DTUBE = -8, DBAR = 0, DFACE = 25;
  var ZBS = DB - 10;                               // cabinet back silhouette
  var CX3 = MW / 2, CY3 = MH * 0.52;

  var W, H, DPR, scale, ox, oy, K;
  var texBack = null, texFace = null, bgc = null;

  // ---- state --------------------------------------------------------------
  var bars = [];                // per lane {midi, freq, hue, glow, wob, wobP}
  var cells = [];               // cells[col][step] bool
  var marbles = [];
  var particles = [];
  var reservoir = 11;           // marbles waiting up top (visual supply)
  var resvSlots = [];
  var scaleIdx = 0, bpm = 96;
  var playing = false, curStep = -1, acc = 0;
  var beltPhase = 0;
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var dust = [];

  // sway / swivel
  var swayPhase = 0, swayMul = 1, lastEdit = -9;
  var yawManual = null, swiveling = false, swStartX = 0, swBase = 0;
  var yawCur = reduce ? SWAY_FIXED : 0, cosY = Math.cos(yawCur), sinY = Math.sin(yawCur);

  var MAX_MARBLES = 150;

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function stepDur() { return 60 / bpm / 4; }
  function laneHue(c) { return 172 + c * (286 - 172) / (COLS - 1); }
  function laneX(c) { return PL + (c + 0.5) * colW; }
  function nowS() { return performance.now() / 1000; }

  function buildBars() {
    var deg = SCALES[scaleIdx].deg;
    bars = [];
    for (var c = 0; c < COLS; c++) {
      var midi = BASE_MIDI + deg[c % 5] + 12 * Math.floor(c / 5);
      bars.push({
        midi: midi,
        freq: 440 * Math.pow(2, (midi - 69) / 12),
        hue: laneHue(c),
        glow: 0, wob: 0, wobP: 0
      });
    }
  }

  // ---- projection ----------------------------------------------------------
  function setYaw(a) { yawCur = a; cosY = Math.cos(a); sinY = Math.sin(a); }
  function proj(x, y, z) {
    var X = x - CX3;
    var xr = X * cosY + z * sinY;
    var zr = -X * sinY + z * cosY;
    var s = F / (F - zr);
    return { x: CX3 + xr * s, y: CY3 + (y - CY3) * s, s: s };
  }
  // inverse: screen point (client px) → machine coords on the plane at depth z
  function toPlane(clientX, clientY, z) {
    var px = (clientX - ox) / scale, py = (clientY - oy) / scale;
    var u = px - CX3;
    var den = u * sinY - F * cosY;
    if (!den) den = -F;
    var X = (z * (F * sinY + u * cosY) - u * F) / den;
    var zr = -X * sinY + z * cosY, s = F / (F - zr);
    return { x: X + CX3, y: CY3 + (py - CY3) / s };
  }
  // draw a projected element with the flat-art function fn (anchored at x,y)
  function pmap(x, y, z, fn) {
    var p = proj(x, y, z);
    ctx.save(); ctx.translate(p.x, p.y); ctx.scale(p.s, p.s); ctx.translate(-x, -y);
    fn();
    ctx.restore();
  }

  // ---- persistence --------------------------------------------------------
  function newCells() { var g = []; for (var c = 0; c < COLS; c++) g.push(new Array(STEPS).fill(false)); return g; }
  function load() {
    cells = newCells();
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return seedDemo();
      var s = JSON.parse(raw);
      if (s && Array.isArray(s.cells) && s.cells.length === COLS) {
        for (var c = 0; c < COLS; c++) for (var t = 0; t < STEPS; t++) cells[c][t] = !!(s.cells[c] && s.cells[c][t]);
      } else seedDemo();
      bpm = clamp(+s.bpm || 96, BPM_MIN, BPM_MAX);
      scaleIdx = clamp(+s.scale || 0, 0, SCALES.length - 1) | 0;
    } catch (e) { seedDemo(); }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ cells: cells, bpm: bpm, scale: scaleIdx })); } catch (e) {}
  }
  function seedDemo() {
    // a gentle rolling pentatonic phrase so it sounds lovely the moment you press play
    var seed = [[0, 0], [2, 2], [4, 4], [7, 6], [4, 8], [2, 10], [5, 12], [1, 14], [0, 8], [7, 0]];
    for (var i = 0; i < seed.length; i++) { var col = seed[i][0], st = seed[i][1]; if (col < COLS) cells[col][st] = true; }
  }

  // ---- layout / resize ----------------------------------------------------
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    scale = Math.min(W / (MW + 70), H / (MH + 120));
    ox = (W - MW * scale) / 2; oy = (H - MH * scale) / 2;
    K = Math.min(DPR, 2) * scale;

    // reservoir heap slots (stable pseudo-random pile)
    resvSlots = [];
    var seed = 1337;
    function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
    var rows = 2, per = 9;
    for (var r = 0; r < rows; r++) for (var i = 0; i < per; i++) {
      var jx = (rnd() - 0.5) * (colW * 0.4);
      resvSlots.push({ x: resvX0 + (resvX1 - resvX0) * (i + 0.5) / per + jx, y: resvY + 4 + r * (MR * 1.25) + (rnd() - 0.5) * 3 });
    }

    if (!dust.length && !reduce) seedDust();
    buildBg();
    buildTextures();
  }
  function seedDust() {
    dust = [];
    for (var i = 0; i < 26; i++) dust.push({ x: Math.random() * MW, y: Math.random() * MH, r: 0.5 + Math.random() * 1.5, sp: 3 + Math.random() * 8, ph: Math.random() * 6.28, tw: 0.3 + Math.random() * 0.5 });
  }

  function setScreen(c) { c.setTransform(DPR, 0, 0, DPR, 0, 0); }
  function setMachine(c) { c.setTransform(DPR * scale, 0, 0, DPR * scale, DPR * ox, DPR * oy); }

  function rrect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  // ---- stage backdrop (screen space, static) -------------------------------
  function buildBg() {
    bgc = document.createElement("canvas");
    bgc.width = W * DPR; bgc.height = H * DPR;
    var c = bgc.getContext("2d");
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    var bg = c.createRadialGradient(W * 0.5, H * 0.34, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.8);
    bg.addColorStop(0, "#241a17"); bg.addColorStop(0.5, "#130f10"); bg.addColorStop(1, "#080608");
    c.fillStyle = bg; c.fillRect(0, 0, W, H);
    // faint warm pool of light behind the machine base
    var fl = c.createRadialGradient(W * 0.5, oy + MH * scale, 0, W * 0.5, oy + MH * scale, W * 0.42);
    fl.addColorStop(0, "rgba(120,84,50,0.12)"); fl.addColorStop(1, "rgba(120,84,50,0)");
    c.fillStyle = fl; c.fillRect(0, 0, W, H);
  }

  // ---- machine textures (machine-unit space, warped per frame) -------------
  function makeTex() {
    var t = document.createElement("canvas");
    t.width = Math.ceil(MW * K); t.height = Math.ceil(MH * K);
    var c = t.getContext("2d");
    c.setTransform(K, 0, 0, K, 0, 0);
    return { cv: t, c: c };
  }
  function buildTextures() {
    // ---- BACK PANEL (z = DB): recessed dark face, lanes, holes, hoppers ----
    var tb = makeTex(), c = tb.c;
    rrect(c, OPEN_X0 - 6, OPEN_Y0 - 6, (OPEN_X1 - OPEN_X0) + 12, (OPEN_Y1 - OPEN_Y0) + 12, 12);
    var face = c.createLinearGradient(0, OPEN_Y0, 0, OPEN_Y1);
    face.addColorStop(0, "#171114"); face.addColorStop(1, "#0c0809");
    c.fillStyle = face; c.fill();

    for (var col = 0; col < COLS; col++) {
      var lx = laneX(col);
      // subtle recessed lane
      var lg = c.createLinearGradient(lx - colW * 0.42, 0, lx + colW * 0.42, 0);
      lg.addColorStop(0, "rgba(0,0,0,0.28)"); lg.addColorStop(0.5, "rgba(255,240,220,0.03)"); lg.addColorStop(1, "rgba(0,0,0,0.28)");
      c.fillStyle = lg; c.fillRect(lx - colW * 0.42, gridBot + 4, colW * 0.84, barY - gridBot - 6);
      // brass chute rails
      c.strokeStyle = "rgba(210,164,96,0.20)"; c.lineWidth = 1;
      c.beginPath(); c.moveTo(lx - colW * 0.4, gridBot + 4); c.lineTo(lx - colW * 0.4, barY - 8); c.stroke();
      c.beginPath(); c.moveTo(lx + colW * 0.4, gridBot + 4); c.lineTo(lx + colW * 0.4, barY - 8); c.stroke();
      // hopper funnel
      drawHopper(c, lx, hopY);
      // grid holes (barrel pins)
      for (var st = 0; st < STEPS; st++) {
        var hx = lx, hy = gridTop + (st + 0.5) * rowH, hr = Math.min(colW, rowH) * 0.3;
        var hole = c.createRadialGradient(hx - hr * 0.3, hy - hr * 0.3, 0, hx, hy, hr);
        hole.addColorStop(0, "#050405"); hole.addColorStop(0.7, "#0b0709"); hole.addColorStop(1, "#1a1216");
        c.fillStyle = hole; c.beginPath(); c.arc(hx, hy, hr, 0, TAU); c.fill();
        c.strokeStyle = "rgba(210,164,96,0.16)"; c.lineWidth = 0.8; c.beginPath(); c.arc(hx, hy, hr + 0.6, 0, TAU); c.stroke();
      }
    }
    texBack = tb.cv;

    // ---- FRONT FACE (z = DFACE): wood cabinet w/ shadowbox opening ---------
    var tf = makeTex(); c = tf.c;
    rrect(c, 4, 8, MW - 8, MH - 12, 22);
    var wood = c.createLinearGradient(0, 0, MW, MH);
    wood.addColorStop(0, "#3a2a20"); wood.addColorStop(0.5, "#2a1d16"); wood.addColorStop(1, "#1c130d");
    c.fillStyle = wood; c.fill();
    rrect(c, 4, 8, MW - 8, MH - 12, 22);
    c.lineWidth = 3; c.strokeStyle = "rgba(214,164,92,0.55)"; c.stroke();
    rrect(c, 10, 14, MW - 20, MH - 24, 18);
    c.lineWidth = 1.5; c.strokeStyle = "rgba(0,0,0,0.4)"; c.stroke();

    // cut the shadowbox opening
    c.save(); c.globalCompositeOperation = "destination-out";
    rrect(c, OPEN_X0, OPEN_Y0, OPEN_X1 - OPEN_X0, OPEN_Y1 - OPEN_Y0, 14);
    c.fill(); c.restore();
    // opening rim (routed edge)
    rrect(c, OPEN_X0, OPEN_Y0, OPEN_X1 - OPEN_X0, OPEN_Y1 - OPEN_Y0, 14);
    c.lineWidth = 2.4; c.strokeStyle = "rgba(0,0,0,0.6)"; c.stroke();
    rrect(c, OPEN_X0 - 2.2, OPEN_Y0 - 2.2, (OPEN_X1 - OPEN_X0) + 4.4, (OPEN_Y1 - OPEN_Y0) + 4.4, 15);
    c.lineWidth = 1; c.strokeStyle = "rgba(210,164,96,0.28)"; c.stroke();

    // left lift housing (channel + brass rails; buckets/sprockets are dynamic)
    c.fillStyle = "rgba(0,0,0,0.38)"; c.fillRect(liftX0 + 2, liftTopY - 6, LW - 4, liftBotY - liftTopY + 20);
    for (var s = 0; s < 2; s++) {
      var railx = s === 0 ? liftX0 + 8 : liftX1 - 8;
      var rg = c.createLinearGradient(railx - 3, 0, railx + 3, 0);
      rg.addColorStop(0, "#3a2913"); rg.addColorStop(0.5, "#c99e56"); rg.addColorStop(1, "#3a2913");
      c.fillStyle = rg; c.fillRect(railx - 2.5, liftTopY - 4, 5, liftBotY - liftTopY + 14);
    }

    // reservoir bin (top) — holds the waiting marbles
    rrect(c, resvX0 - 8, resvY - 6, (resvX1 - resvX0) + 16, MR * 3.4, 10);
    var rb = c.createLinearGradient(0, resvY - 6, 0, resvY + MR * 3);
    rb.addColorStop(0, "#20171e"); rb.addColorStop(1, "#0d090c");
    c.fillStyle = rb; c.fill();
    c.strokeStyle = "rgba(210,164,96,0.22)"; c.lineWidth = 1.2; c.stroke();
    // delivery rail from lift-top across to the reservoir
    c.strokeStyle = "rgba(210,164,96,0.3)"; c.lineWidth = 2;
    c.beginPath(); c.moveTo(liftCX, liftTopY - 2); c.lineTo(resvX0 - 6, resvY + MR * 2); c.stroke();

    // title plate
    c.textAlign = "center"; c.textBaseline = "middle";
    c.font = "600 12px Geist, system-ui, sans-serif";
    c.fillStyle = "rgba(230,196,150,0.4)";
    c.fillText("MARBLE  MACHINE", MW / 2, MH - 20);
    texFace = tf.cv;
  }

  function drawHopper(c, x, y) {
    var w = colW * 0.62;
    c.beginPath();
    c.moveTo(x - w / 2, y - 14);
    c.lineTo(x + w / 2, y - 14);
    c.lineTo(x + w * 0.2, y + 4);
    c.lineTo(x - w * 0.2, y + 4);
    c.closePath();
    var hg = c.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
    hg.addColorStop(0, "#4a3316"); hg.addColorStop(0.5, "#d3a75a"); hg.addColorStop(1, "#4a3316");
    c.fillStyle = hg; c.fill();
    c.strokeStyle = "rgba(0,0,0,0.3)"; c.lineWidth = 1; c.stroke();
  }

  // warp-draw a machine-space texture living on the plane at depth z
  // (yaw-only rotation keeps vertical lines vertical → per-column strips are exact)
  function drawPlane(tex, z) {
    var N = 40, xs = [], ss = [];
    for (var i = 0; i <= N; i++) {
      var p = proj(MW * i / N, CY3, z);
      xs.push(p.x); ss.push(p.s);
    }
    for (i = 0; i < N; i++) {
      var s = (ss[i] + ss[i + 1]) * 0.5;
      ctx.drawImage(tex, (MW * i / N) * K, 0, (MW / N) * K, MH * K,
        xs[i], CY3 * (1 - s), xs[i + 1] - xs[i] + 0.4, MH * s);
    }
  }

  function quadFill(pts, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath(); ctx.fill();
  }

  // ---- marbles ------------------------------------------------------------
  var MHUES = [38, 8, 44, 20, 350];   // warm jewel glass (amber/ruby/honey/coral)
  function spawnFall(col) {
    if (marbles.length > MAX_MARBLES) return;
    if (reservoir > 0) reservoir -= 1;
    marbles.push({
      state: "fall", col: col, x: laneX(col), y: hopY, vx: 0, vy: 0,
      r: MR * (0.9 + Math.random() * 0.16), hue: MHUES[(Math.random() * MHUES.length) | 0], spin: Math.random() * TAU,
      seg: 0, frac: 0, segLen: 0
    });
  }
  function startReturn(m) {
    m.state = "return"; m.seg = 0; m.frac = 0;
    // waypoint path: into trough → slide to lift base → ride up → into reservoir
    var basinX = clamp(m.x, liftX1, PR);
    var frac = (basinX - liftX1) / (PR - liftX1);
    var basinY = troughBot - 6 - frac * 8;
    m.path = [
      { x: basinX, y: basinY, sp: 260 },
      { x: liftCX, y: liftBotY, sp: 320 },
      { x: liftCX, y: liftTopY, sp: 500 },              // the lift ride
      { x: resvX0 - 4, y: resvY + MR * 2, sp: 300 }     // roll into reservoir
    ];
    m.segLen = Math.hypot(m.path[0].x - m.x, m.path[0].y - m.y);
  }
  // depth of a marble: falls happen mid-box; the return slides out to the
  // face-mounted lift (lerped per segment so it never pops)
  function zFor(m) {
    if (m.state === "fall") return DMID;
    if (m.seg === 0) return DMID + (DTR - DMID) * m.frac;
    // stay inside the box for most of the slide; pop out to the face-mounted
    // lift only in the final stretch (so marbles never ride over the wood)
    if (m.seg === 1) return DTR + (DFACE - DTR) * Math.max(0, (m.frac - 0.62) / 0.38);
    return DFACE;
  }

  // ---- audio (vibraphone) -------------------------------------------------
  var actx = null, outGain = null, comp = null, dryBus = null, wetBus = null, echoBus = null, tremGain = null, echoDelay = null, muted = false, lastTick = 0;
  function makeImpulse(sec, decay) {
    var rate = actx.sampleRate, len = (rate * sec) | 0, buf = actx.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), lp = 0;
      for (var i = 0; i < len; i++) {
        var env = Math.pow(1 - i / len, decay), n = Math.random() * 2 - 1;
        lp += (n - lp) * 0.42; d[i] = (n * 0.5 + lp * 0.5) * env;
      }
    }
    return buf;
  }
  function unlock() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      var b = actx.createBuffer(1, 1, 22050), s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0);
      outGain = actx.createGain(); outGain.gain.value = muted ? 0 : 0.85;
      var mlp = actx.createBiquadFilter(); mlp.type = "lowpass"; mlp.frequency.value = 11000; mlp.Q.value = 0.4;
      comp = actx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 26; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.25;
      comp.connect(mlp); mlp.connect(outGain); outGain.connect(actx.destination);
      // shared vibraphone tremolo (the motor)
      tremGain = actx.createGain(); tremGain.gain.value = 1.0;
      var lfo = actx.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 5.0;
      var lfg = actx.createGain(); lfg.gain.value = 0.12;
      lfo.connect(lfg); lfg.connect(tremGain.gain); lfo.start();
      // dry
      dryBus = actx.createGain(); dryBus.gain.value = 0.8; dryBus.connect(comp);
      tremGain.connect(dryBus);
      // reverb (lush hall)
      var conv = actx.createConvolver(); conv.buffer = makeImpulse(3.6, 1.8);
      var pre = actx.createDelay(0.2); pre.delayTime.value = 0.02;
      var hp = actx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 180;
      var shelf = actx.createBiquadFilter(); shelf.type = "highshelf"; shelf.frequency.value = 3200; shelf.gain.value = 3;
      wetBus = actx.createGain(); wetBus.gain.value = 0.42;
      tremGain.connect(wetBus);
      wetBus.connect(pre); pre.connect(hp); hp.connect(conv); conv.connect(shelf); shelf.connect(comp);
      // tempo-synced feedback echo → also feeds reverb so repeats bloom
      echoDelay = actx.createDelay(1.0); echoDelay.delayTime.value = 60 / bpm * 0.75;
      var fb = actx.createGain(); fb.gain.value = 0.3;
      var elp = actx.createBiquadFilter(); elp.type = "lowpass"; elp.frequency.value = 2600;
      echoBus = actx.createGain(); echoBus.gain.value = 0.16; tremGain.connect(echoBus);
      echoBus.connect(echoDelay); echoDelay.connect(elp); elp.connect(fb); fb.connect(echoDelay);
      var eout = actx.createGain(); eout.gain.value = 0.7; elp.connect(eout); eout.connect(comp); eout.connect(pre);
    } catch (e) { actx = null; }
  }
  function vibe(freq, vel, pan) {
    if (!actx) return; vel = vel || 1;
    var t = actx.currentTime, nyq = actx.sampleRate / 2;
    var dur = clamp(3.6 * Math.pow(330 / freq, 0.4), 1.5, 4.4);
    var pn; try { pn = actx.createStereoPanner(); pn.pan.value = clamp(pan || 0, -1, 1); } catch (e) { pn = actx.createGain(); }
    pn.connect(tremGain);
    function part(f, peak, dec, atk) {
      if (f > nyq * 0.92) return;
      var o = actx.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(f, t);
      var g = actx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak * vel, t + (atk || 0.004));
      g.gain.exponentialRampToValueAtTime(0.0002, t + dec);
      o.connect(g); g.connect(pn); o.start(t); o.stop(t + dec + 0.05);
    }
    // vibraphone: fundamental + tuned 4f (two octaves) + faint bar mode + shimmer
    part(freq, 0.5, dur, 0.003);
    part(freq * 2, 0.07, dur * 0.72, 0.003);
    part(freq * 3.98, 0.22, dur * 0.55, 0.003);
    part(freq * 2.76, 0.05, dur * 0.3, 0.003);
    part(freq * 9.2, 0.045, dur * 0.2, 0.002);
    // glass-on-metal contact tick
    var ln = (0.016 * actx.sampleRate) | 0, nb = actx.createBufferSource(), buf = actx.createBuffer(1, ln, actx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < ln; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ln, 2.4);
    nb.buffer = buf;
    var bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = clamp(freq * 6, 1600, 5400); bp.Q.value = 0.8;
    var ng = actx.createGain(); ng.gain.value = 0.08 * vel; nb.connect(bp); bp.connect(ng); ng.connect(pn); nb.start(t);
  }
  function troughTick() {
    if (!actx) return;
    var t = actx.currentTime; if (t - lastTick < 0.03) return; lastTick = t;
    var o = actx.createOscillator(), g = actx.createGain(), bp = actx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 340 + Math.random() * 200; bp.Q.value = 3;
    o.type = "triangle"; o.frequency.value = 180 + Math.random() * 120;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.03, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(bp); bp.connect(g); g.connect(dryBus || actx.destination); o.start(t); o.stop(t + 0.06);
  }

  // ---- strike -------------------------------------------------------------
  function strikeBar(col, vel) {
    var b = bars[col]; if (!b) return;
    b.glow = 1; b.wob = 1; b.wobP = 0;
    var pan = clamp((laneX(col) - MW / 2) / (MW / 2) * 0.75, -1, 1);
    vibe(b.freq, vel, pan);
    var bx = laneX(col);
    for (var i = 0; i < 7; i++) {
      var a = -Math.PI / 2 + (Math.random() - 0.5) * 1.5;
      particles.push({ x: bx + (Math.random() - 0.5) * colW * 0.4, y: barY - 4, vx: Math.cos(a) * (40 + Math.random() * 90), vy: Math.sin(a) * (60 + Math.random() * 120), life: 1, hue: b.hue });
    }
  }

  // ---- transport ----------------------------------------------------------
  function advance() {
    curStep = (curStep + 1) % STEPS;
    for (var c = 0; c < COLS; c++) if (cells[c][curStep]) spawnFall(c);
  }
  function play() {
    unlock(); playing = true; acc = 0; curStep = -1;
    playBtn.classList.add("is-playing"); playBtn.setAttribute("aria-pressed", "true");
    playBtn.querySelector(".lbl").textContent = "Pause";
    hide(); track("marble_play");
  }
  function stop() {
    playing = false;
    playBtn.classList.remove("is-playing"); playBtn.setAttribute("aria-pressed", "false");
    playBtn.querySelector(".lbl").textContent = "Play";
  }

  // ---- update -------------------------------------------------------------
  function update(dt) {
    // sway: pause while editing (never aim at a moving target), honor manual swivel
    var tgt = (swiveling || nowS() - lastEdit < 1.1) ? 0 : 1;
    swayMul += (tgt - swayMul) * Math.min(1, dt * 4);
    if (yawManual !== null) {
      setYaw(yawCur + (yawManual - yawCur) * Math.min(1, dt * 8));
    } else if (reduce) {
      setYaw(yawCur + (SWAY_FIXED - yawCur) * Math.min(1, dt * 6));
    } else {
      swayPhase += dt * swayMul;
      var yT = SWAY_A * Math.sin(TAU * swayPhase / SWAY_T);
      setYaw(yawCur + (yT - yawCur) * Math.min(1, dt * 6));
    }

    if (playing) {
      acc += dt;
      var sd = stepDur();
      while (acc >= sd) { acc -= sd; advance(); }
    }
    // belt turns while carrying / playing
    var carrying = playing;
    for (var i = 0; i < marbles.length; i++) if (marbles[i].state === "return" && marbles[i].seg >= 1) { carrying = true; break; }
    if (carrying) beltPhase += dt * 2.2;

    for (i = marbles.length - 1; i >= 0; i--) {
      var m = marbles[i];
      if (m.state === "fall") {
        m.vy += G * dt; m.y += m.vy * dt; m.spin += m.vy * dt * 0.02;
        if (m.y >= barY - m.r) {
          m.y = barY - m.r;
          strikeBar(m.col, clamp(m.vy / 1600, 0.4, 1));
          startReturn(m);
        }
      } else if (m.state === "return") {
        var wp = m.path[m.seg];
        var dx = wp.x - m.x, dy = wp.y - m.y, d = Math.hypot(dx, dy), stepd = wp.sp * dt;
        if (d <= stepd || d < 0.5) {
          m.x = wp.x; m.y = wp.y;
          if (m.seg === 0) troughTick();
          m.seg++;
          if (m.seg >= m.path.length) { reservoir = Math.min(reservoir + 1, 18); marbles.splice(i, 1); continue; }
          var nwp = m.path[m.seg];
          m.segLen = Math.hypot(nwp.x - m.x, nwp.y - m.y); m.frac = 0;
        } else {
          m.x += dx / d * stepd; m.y += dy / d * stepd;
          m.frac = m.segLen > 0 ? Math.min(1, 1 - d / m.segLen) : 1;
        }
        m.spin += stepd * 0.05;
      }
    }

    for (i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.vy += 260 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt * 1.7;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (i = 0; i < bars.length; i++) {
      var bb = bars[i];
      if (bb.glow > 0) bb.glow = Math.max(0, bb.glow - dt * 2.6);
      if (bb.wob > 0) { bb.wob = Math.max(0, bb.wob - dt * 3.2); bb.wobP += dt * 46; }
    }
    if (!reduce) for (i = 0; i < dust.length; i++) { var du = dust[i]; du.y -= du.sp * dt; du.x += Math.sin(du.ph) * 4 * dt; du.ph += dt * 0.5; if (du.y < -4) { du.y = MH + 4; du.x = Math.random() * MW; } }
  }

  // ---- draw ---------------------------------------------------------------
  function drawMarbleBead(c, x, y, r, hue) {
    c.fillStyle = "rgba(0,0,0,0.32)";
    c.beginPath(); c.ellipse(x + 1.5, y + r * 0.5, r * 0.92, r * 0.46, 0, 0, TAU); c.fill();
    var g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, "hsl(" + hue + ",92%,84%)");
    g.addColorStop(0.42, "hsl(" + hue + ",88%,62%)");
    g.addColorStop(0.82, "hsl(" + hue + ",82%,40%)");
    g.addColorStop(1, "hsl(" + hue + ",78%,26%)");
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    var cg = c.createRadialGradient(x + r * 0.2, y + r * 0.25, 0, x + r * 0.2, y + r * 0.25, r * 0.7);
    cg.addColorStop(0, "hsla(" + hue + ",95%,72%,0.45)"); cg.addColorStop(1, "hsla(" + hue + ",90%,60%,0)");
    c.fillStyle = cg; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    c.fillStyle = "rgba(255,255,255,0.9)";
    c.beginPath(); c.ellipse(x - r * 0.34, y - r * 0.38, r * 0.22, r * 0.15, -0.6, 0, TAU); c.fill();
  }

  function drawBarFlat(col) {
    var c = ctx, b = bars[col], lx = laneX(col), pitchN = col / (COLS - 1);
    var bw = colW * (0.94 - pitchN * 0.26), bh = 15 + (1 - pitchN) * 7;
    var wob = b.wob > 0 ? Math.sin(b.wobP) * b.wob * 3 : 0;
    var by = barY + wob;
    // shadow
    c.fillStyle = "rgba(0,0,0,0.4)";
    rrect(c, lx - bw / 2 + 2, by + bh - 2, bw, 5, 3); c.fill();
    // bar body — anodized metal in lane hue
    rrect(c, lx - bw / 2, by, bw, bh, bh * 0.4);
    var g = c.createLinearGradient(0, by, 0, by + bh);
    g.addColorStop(0, "hsl(" + b.hue + ",42%,72%)");
    g.addColorStop(0.45, "hsl(" + b.hue + ",48%,52%)");
    g.addColorStop(0.55, "hsl(" + b.hue + ",52%,42%)");
    g.addColorStop(1, "hsl(" + b.hue + ",44%,26%)");
    c.fillStyle = g; c.fill();
    // top sheen
    c.fillStyle = "rgba(255,255,255,0.28)";
    rrect(c, lx - bw / 2 + 3, by + 1.5, bw - 6, bh * 0.3, bh * 0.15); c.fill();
    c.strokeStyle = "rgba(0,0,0,0.25)"; c.lineWidth = 0.8; rrect(c, lx - bw / 2, by, bw, bh, bh * 0.4); c.stroke();
    // glow when struck
    if (b.glow > 0.01) {
      c.save(); c.globalCompositeOperation = "lighter";
      var gg = c.createRadialGradient(lx, by + bh / 2, 0, lx, by + bh / 2, bw * 0.9);
      gg.addColorStop(0, "hsla(" + b.hue + ",95%,72%," + b.glow * 0.7 + ")");
      gg.addColorStop(1, "hsla(" + b.hue + ",90%,60%,0)");
      c.fillStyle = gg; c.beginPath(); c.arc(lx, by + bh / 2, bw * 0.9, 0, TAU); c.fill();
      c.restore();
    }
  }

  function drawTubeFlat(col) {
    var c = ctx, rx = laneX(col), pitchN = col / (COLS - 1);
    var tubeLen = (resBot - resTop) * (1 - pitchN * 0.42);
    var tw = colW * 0.5;
    var tg = c.createLinearGradient(rx - tw / 2, 0, rx + tw / 2, 0);
    tg.addColorStop(0, "#4a3316"); tg.addColorStop(0.4, "#c79a52"); tg.addColorStop(0.5, "#e7c079"); tg.addColorStop(0.6, "#b98a44"); tg.addColorStop(1, "#402c13");
    c.fillStyle = tg;
    rrect(c, rx - tw / 2, resTop, tw, tubeLen, tw * 0.28); c.fill();
    c.fillStyle = "rgba(0,0,0,0.28)";
    rrect(c, rx - tw / 2, resTop + tubeLen - 5, tw, 5, 2); c.fill();
  }

  function drawSprocket(yy) {
    pmap(liftCX, yy, DFACE, function () {
      var c = ctx;
      var g = c.createRadialGradient(liftCX - 4, yy - 4, 1, liftCX, yy, 15);
      g.addColorStop(0, "#e7c079"); g.addColorStop(0.6, "#a97f3f"); g.addColorStop(1, "#3a2913");
      c.fillStyle = g; c.beginPath(); c.arc(liftCX, yy, 15, 0, TAU); c.fill();
      c.fillStyle = "#241a12"; c.beginPath(); c.arc(liftCX, yy, 6, 0, TAU); c.fill();
      c.save(); c.translate(liftCX, yy); c.rotate(yy === liftBotY ? beltPhase : -beltPhase);
      c.strokeStyle = "rgba(40,28,14,0.7)"; c.lineWidth = 1.4;
      for (var s = 0; s < 6; s++) { var an = s / 6 * TAU; c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(an) * 12, Math.sin(an) * 12); c.stroke(); }
      c.restore();
    });
  }

  function draw(t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bgc, 0, 0);
    setMachine(ctx);
    var c = ctx;

    // floor shadow (skews slightly as the cabinet turns)
    var shx = CX3 - sinY * 26;
    c.save(); c.translate(shx, MH + 8); c.scale(1, 0.1);
    var sg = c.createRadialGradient(0, 0, 0, 0, 0, MW * 0.56);
    sg.addColorStop(0, "rgba(0,0,0,0.55)"); sg.addColorStop(0.7, "rgba(0,0,0,0.26)"); sg.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = sg; c.beginPath(); c.arc(0, 0, MW * 0.56, 0, TAU); c.fill();
    c.restore();

    // cabinet back silhouette (its mass beyond the panel)
    quadFill([proj(4, 8, ZBS), proj(MW - 4, 8, ZBS), proj(MW - 4, MH - 4, ZBS), proj(4, MH - 4, ZBS)], "#0a0708");

    // exterior side wall of the box (the one turned toward the viewer)
    function sideWall(x, leftSide) {
      var f1 = proj(x, 8, DFACE), b1 = proj(x, 8, ZBS), b2 = proj(x, MH - 4, ZBS), f2 = proj(x, MH - 4, DFACE);
      var visible = leftSide ? (b1.x < f1.x) : (b1.x > f1.x);
      if (!visible) return;
      var g = c.createLinearGradient(f1.x, 0, b1.x, 0);
      g.addColorStop(0, "#2b1d14"); g.addColorStop(1, "#100a07");
      quadFill([f1, b1, b2, f2], g);
    }
    sideWall(4, true); sideWall(MW - 4, false);

    // back panel + everything mounted on it
    drawPlane(texBack, DB);

    // pegs (color-coded to lanes) + playhead pulse — on the peg plane
    var phPos = playing ? ((curStep + Math.min(acc / stepDur(), 1))) : -1;
    for (var col = 0; col < COLS; col++) {
      var lx = laneX(col), hue = bars[col].hue;
      for (var st = 0; st < STEPS; st++) {
        if (!cells[col][st]) continue;
        var hy = gridTop + (st + 0.5) * rowH, r = Math.min(colW, rowH) * 0.34;
        var near = playing && Math.abs(((phPos % STEPS) - st)) < 0.6;
        var lift = near ? 1 : 0.55;
        var pp = proj(lx, hy, DPEG), pr = r * pp.s;
        c.save(); c.globalCompositeOperation = "lighter";
        var gg = c.createRadialGradient(pp.x, pp.y, 0, pp.x, pp.y, pr * 2.4);
        gg.addColorStop(0, "hsla(" + hue + ",95%,68%," + (0.4 * lift) + ")"); gg.addColorStop(1, "hsla(" + hue + ",90%,60%,0)");
        c.fillStyle = gg; c.beginPath(); c.arc(pp.x, pp.y, pr * 2.4, 0, TAU); c.fill();
        c.restore();
        var pg = c.createRadialGradient(pp.x - pr * 0.3, pp.y - pr * 0.3, 0, pp.x, pp.y, pr);
        pg.addColorStop(0, "hsl(" + hue + ",90%," + (72 + lift * 12) + "%)");
        pg.addColorStop(0.7, "hsl(" + hue + ",82%,52%)");
        pg.addColorStop(1, "hsl(" + hue + ",72%,34%)");
        c.fillStyle = pg; c.beginPath(); c.arc(pp.x, pp.y, pr, 0, TAU); c.fill();
        c.fillStyle = "rgba(255,255,255,0.7)"; c.beginPath(); c.arc(pp.x - pr * 0.3, pp.y - pr * 0.3, pr * 0.24, 0, TAU); c.fill();
      }
    }
    if (playing) {
      var py = gridTop + (phPos % STEPS) * rowH + rowH * 0.5;
      c.save(); c.globalCompositeOperation = "lighter";
      c.strokeStyle = "rgba(255,228,178,0.42)"; c.lineWidth = 2;
      c.beginPath();
      for (var k = 0; k <= 4; k++) {
        var xx = (PL - 12) + (PR - PL + 24) * k / 4;
        var pl = proj(xx, py, DPEG);
        if (k === 0) c.moveTo(pl.x, pl.y); else c.lineTo(pl.x, pl.y);
      }
      c.stroke(); c.restore();
    }

    // collection trough (inside the box, sloping into the lift)
    var pT1 = proj(PR + 6, troughTop, DTR), pT2 = proj(liftX1 - 2, troughBot, DTR),
        pT3 = proj(liftX1 - 2, troughBot + 12, DTR), pT4 = proj(PR + 6, troughTop + 16, DTR);
    var trg = c.createLinearGradient(0, pT1.y, 0, pT3.y);
    trg.addColorStop(0, "#241922"); trg.addColorStop(1, "#0e0a0d");
    quadFill([pT1, pT2, pT3, pT4], trg);
    c.strokeStyle = "rgba(210,164,96,0.18)"; c.lineWidth = 1;
    c.beginPath(); c.moveTo(pT1.x, pT1.y); c.lineTo(pT2.x, pT2.y); c.stroke();

    // mid-depth marbles (falling + rolling in the trough) and strike sparks
    for (var i = 0; i < marbles.length; i++) {
      var m = marbles[i], mz = zFor(m);
      if (mz >= 12) continue;
      var mp = proj(m.x, m.y, mz);
      drawMarbleBead(c, mp.x, mp.y, m.r * mp.s, m.hue);
    }
    c.save(); c.globalCompositeOperation = "lighter";
    for (i = 0; i < particles.length; i++) {
      var p = particles[i], sp = proj(p.x, p.y, DMID);
      c.fillStyle = "hsla(" + p.hue + ",95%,72%," + Math.max(0, p.life) * 0.8 + ")";
      c.beginPath(); c.arc(sp.x, sp.y, (1.6 + p.life * 1.6) * sp.s, 0, TAU); c.fill();
    }
    c.restore();

    // resonator tubes, then the tuned bars in front of them
    for (col = 0; col < COLS; col++) pmap(laneX(col), resTop, DTUBE, drawTubeFlat.bind(null, col));
    for (col = 0; col < COLS; col++) pmap(laneX(col), barY, DBAR, drawBarFlat.bind(null, col));

    // shadowbox interior reveals (ceiling / sill / side walls of the opening)
    quadFill([proj(OPEN_X0, OPEN_Y0, DFACE), proj(OPEN_X1, OPEN_Y0, DFACE), proj(OPEN_X1, OPEN_Y0, DB), proj(OPEN_X0, OPEN_Y0, DB)], "#070505");
    quadFill([proj(OPEN_X0, OPEN_Y1, DFACE), proj(OPEN_X1, OPEN_Y1, DFACE), proj(OPEN_X1, OPEN_Y1, DB), proj(OPEN_X0, OPEN_Y1, DB)], "#231710");
    function revealWall(x) {
      var a = proj(x, OPEN_Y0, DFACE), b = proj(x, OPEN_Y0, DB), b2 = proj(x, OPEN_Y1, DB), a2 = proj(x, OPEN_Y1, DFACE);
      if (Math.abs(b.x - a.x) < 0.4) return;
      var g = c.createLinearGradient(a.x, 0, b.x, 0);
      g.addColorStop(0, "#261a12"); g.addColorStop(1, "#0c0807");
      quadFill([a, b, b2, a2], g);
    }
    revealWall(OPEN_X0); revealWall(OPEN_X1);

    // front face (wood cabinet), then everything mounted on it
    drawPlane(texFace, DFACE);
    // moving sheen — the light slides across the wood as the cabinet sways
    c.save(); c.globalCompositeOperation = "lighter";
    var shX = (0.5 - sinY * 1.9) * MW;
    var sheen = c.createLinearGradient(shX - 170, 0, shX + 170, 0);
    sheen.addColorStop(0, "rgba(255,226,180,0)"); sheen.addColorStop(0.5, "rgba(255,226,180,0.05)"); sheen.addColorStop(1, "rgba(255,226,180,0)");
    c.fillStyle = sheen; c.fillRect(-40, 0, MW + 80, MH);
    c.restore();

    // lift buckets riding the belt
    var span = liftBotY - liftTopY, n = 7, gap = span / n, off = ((beltPhase * 40) % gap);
    for (k = -1; k < n + 1; k++) {
      var by = liftBotY - (k * gap + off);
      if (by < liftTopY - 8 || by > liftBotY + 8) continue;
      (function (byy) {
        pmap(liftCX, byy, DFACE, function () {
          ctx.fillStyle = "rgba(180,140,80,0.5)";
          rrect(ctx, liftCX - 9, byy - 4, 18, 8, 3); ctx.fill();
          ctx.strokeStyle = "rgba(60,42,20,0.6)"; ctx.lineWidth = 1; ctx.stroke();
        });
      })(by);
    }
    drawSprocket(liftTopY); drawSprocket(liftBotY);

    // face-plane marbles: riding the lift / rolling into the reservoir
    for (i = 0; i < marbles.length; i++) {
      m = marbles[i]; mz = zFor(m);
      if (mz < 12) continue;
      mp = proj(m.x, m.y, DFACE);
      drawMarbleBead(c, mp.x, mp.y, m.r * mp.s, m.hue);
    }
    // reservoir heap
    var showN = Math.min(reservoir, resvSlots.length);
    for (i = 0; i < showN; i++) {
      var sl = resvSlots[i], rp = proj(sl.x, sl.y, DFACE);
      drawMarbleBead(c, rp.x, rp.y, MR * 0.92 * rp.s, MHUES[i % MHUES.length]);
    }

    // dust + vignette (screen space)
    setScreen(c);
    if (!reduce) {
      c.save(); c.globalCompositeOperation = "lighter";
      for (i = 0; i < dust.length; i++) {
        var du = dust[i], dsx = ox + du.x * scale, dsy = oy + du.y * scale;
        c.fillStyle = "rgba(240,210,170," + (0.05 + 0.1 * (0.5 + 0.5 * Math.sin(t * du.tw + du.ph))) + ")";
        c.beginPath(); c.arc(dsx, dsy, du.r, 0, TAU); c.fill();
      }
      c.restore();
    }
    var vg = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.34, W / 2, H / 2, Math.max(W, H) * 0.72);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.5)");
    c.fillStyle = vg; c.fillRect(0, 0, W, H);
  }

  // ---- loop ---------------------------------------------------------------
  var lastTs = null;
  function frame(ts) {
    var t = ts / 1000, dt = lastTs !== null ? Math.min((ts - lastTs) / 1000, 0.033) : 0.016; lastTs = ts;
    update(dt); draw(t);
    requestAnimationFrame(frame);
  }

  // ---- input --------------------------------------------------------------
  var painting = false, paintVal = false, paintKey = "";
  function cellAt(mx, my) {
    if (mx < PL || mx > PR || my < gridTop || my > gridBot) return null;
    var col = clamp(Math.floor((mx - PL) / colW), 0, COLS - 1);
    var st = clamp(Math.floor((my - gridTop) / rowH), 0, STEPS - 1);
    return { col: col, st: st };
  }
  function barAt(mx, my) {
    if (mx < PL || mx > PR || my < barY - 16 || my > resBot) return -1;
    return clamp(Math.floor((mx - PL) / colW), 0, COLS - 1);
  }
  function down(clientX, clientY) {
    unlock(); hide();
    var g = toPlane(clientX, clientY, DB);
    var cell = cellAt(g.x, g.y);
    if (cell) {
      paintVal = !cells[cell.col][cell.st];
      cells[cell.col][cell.st] = paintVal;
      painting = true; paintKey = cell.col + ":" + cell.st;
      lastEdit = nowS();
      if (paintVal) { strikeBar(cell.col, 0.7); }   // audition the note you just placed
      save();
      return;
    }
    var bpt = toPlane(clientX, clientY, DBAR);
    var bc = barAt(bpt.x, bpt.y);
    if (bc >= 0) { strikeBar(bc, 0.85); return; }
    // anywhere else: grab the cabinet and swivel it
    swiveling = true; swStartX = clientX; swBase = yawCur; yawManual = yawCur;
  }
  function move(clientX, clientY) {
    if (painting) {
      var g = toPlane(clientX, clientY, DB);
      var cell = cellAt(g.x, g.y);
      if (!cell) return;
      var key = cell.col + ":" + cell.st;
      if (key === paintKey) return;
      paintKey = key;
      if (cells[cell.col][cell.st] !== paintVal) {
        cells[cell.col][cell.st] = paintVal;
        lastEdit = nowS();
        if (paintVal) strikeBar(cell.col, 0.6);
        save();
      }
      return;
    }
    if (swiveling) {
      yawManual = clamp(swBase + (clientX - swStartX) * 0.004, -SWIVEL_MAX, SWIVEL_MAX);
    }
  }
  function up() {
    if (swiveling && !reduce) {
      // resume the idle sway from wherever the user left the cabinet
      var s0 = clamp(yawCur / SWAY_A, -0.999, 0.999);
      swayPhase = Math.asin(s0) * SWAY_T / TAU;
    }
    painting = false; swiveling = false; yawManual = null;
  }

  canvas.addEventListener("mousedown", function (e) { down(e.clientX, e.clientY); });
  window.addEventListener("mousemove", function (e) { move(e.clientX, e.clientY); });
  window.addEventListener("mouseup", up);
  canvas.addEventListener("touchstart", function (e) { e.preventDefault(); var tt = e.changedTouches[0]; down(tt.clientX, tt.clientY); }, { passive: false });
  canvas.addEventListener("touchmove", function (e) { e.preventDefault(); var tt = e.touches[0]; move(tt.clientX, tt.clientY); }, { passive: false });
  window.addEventListener("touchend", up);

  // ---- controls -----------------------------------------------------------
  var playBtn = document.getElementById("playBtn");
  var scaleBtn = document.getElementById("scaleBtn");
  var randBtn = document.getElementById("randBtn");
  var clearBtn = document.getElementById("clearBtn");
  var soundBtn = document.getElementById("soundBtn");
  var bpmEl = document.getElementById("bpm");

  playBtn.addEventListener("click", function () { if (playing) stop(); else play(); });
  scaleBtn.addEventListener("click", function () { scaleIdx = (scaleIdx + 1) % SCALES.length; scaleBtn.textContent = SCALES[scaleIdx].name; buildBars(); save(); });
  clearBtn.addEventListener("click", function () { cells = newCells(); save(); });
  randBtn.addEventListener("click", function () {
    unlock(); cells = newCells();
    for (var t = 0; t < STEPS; t++) {
      if (Math.random() < 0.5) { var col = (Math.random() * COLS) | 0; cells[col][t] = true; }
    }
    // ensure a downbeat so it grooves
    cells[0][0] = true;
    save();
    track("marble_shuffle");
  });
  soundBtn.addEventListener("click", function () {
    muted = !muted; unlock();
    if (outGain) outGain.gain.setTargetAtTime(muted ? 0 : 0.85, actx.currentTime, 0.02);
    soundBtn.textContent = muted ? "Sound: off" : "Sound: on";
    soundBtn.setAttribute("aria-pressed", muted ? "true" : "false");
  });
  function setBpm(v) {
    bpm = clamp(v, BPM_MIN, BPM_MAX); bpmEl.textContent = bpm;
    if (echoDelay) echoDelay.delayTime.setTargetAtTime(60 / bpm * 0.75, actx.currentTime, 0.05);
    save();
  }
  document.getElementById("tempoDown").addEventListener("click", function () { setBpm(bpm - BPM_STEP); });
  document.getElementById("tempoUp").addEventListener("click", function () { setBpm(bpm + BPM_STEP); });

  function hide() { if (hintEl) hintEl.classList.add("is-hidden"); }
  function track(name) { try { if (typeof window.gtag === "function") window.gtag("event", name, {}); } catch (e) {} }

  // ---- boot ---------------------------------------------------------------
  load();
  buildBars();
  scaleBtn.textContent = SCALES[scaleIdx].name;
  bpmEl.textContent = bpm;
  resize(); window.addEventListener("resize", resize);
  setTimeout(hide, 9000);
  requestAnimationFrame(frame);
})();
