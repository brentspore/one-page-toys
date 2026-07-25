/* Glow Pegs — No. 096
 * A black peg board you paint light into. Hex-offset hole grid, eight glowing
 * peg colours plus an eraser, faint templates rasterised onto the grid, and a
 * PNG export. Peg + board layers are pre-rendered sprites, so a full board is
 * still one drawImage per peg.
 * Vanilla Canvas 2D + Web Audio. Self-contained. */
(function () {
  "use strict";

  var TAU = Math.PI * 2;

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var swatchWrap = document.getElementById("swatches");
  var tplBtn = document.getElementById("tplBtn");
  var clearBtn = document.getElementById("clearBtn");
  var saveBtn = document.getElementById("saveBtn");
  var soundBtn = document.getElementById("soundBtn");
  var tray = document.getElementById("tray");
  var hint = document.getElementById("hint");

  var REDMO = false;
  try { REDMO = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

  // ----------------------------------------------------------------- palette
  var COLORS = [
    { n: "Red", c: "#ff3b5c" },
    { n: "Orange", c: "#ff8f2b" },
    { n: "Yellow", c: "#ffe14d" },
    { n: "Green", c: "#4dff9e" },
    { n: "Blue", c: "#3cb4ff" },
    { n: "Violet", c: "#a678ff" },
    { n: "Pink", c: "#ff6bd6" },
    { n: "White", c: "#ffffff" }
  ];
  var ERASER = -1;
  var pick = 2;   // yellow reads best on first contact

  var TEMPLATES = ["Free", "Star", "Heart", "Rocket", "Flower"];
  var tpl = 0;

  // ------------------------------------------------------------------- state
  var cols = 0, rows = 0, pitch = 0, pegR = 0;
  var bx = 0, by = 0, bw = 0, bh = 0;        // board rect
  var cells = null;                           // Int8Array of colour indices, -1 empty
  var guide = null;                           // Uint8Array, 1 = template hole
  var filled = 0;
  var pops = [];                              // per-peg placement pop
  var boardCv = null, pegSprites = [], guideCv = null;
  var dpr = 1, W = 0, H = 0;
  var drawing = false, lastCell = -1;
  var pulse = 0;

  // ------------------------------------------------------------ persistence
  var soundOn = true;
  try { if (localStorage.getItem("pegs_sound") === "0") soundOn = false; } catch (e) {}
  soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // ================================================================== AUDIO
  var AC = null, outGain = null, noiseBuf = null, hum = null, humGain = null;

  function initAudio() {
    if (AC) return;
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { AC = null; return; }

    outGain = AC.createGain();
    outGain.gain.value = soundOn ? 1 : 0;

    var lp = AC.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 12000; lp.Q.value = 0.6;

    var comp = AC.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 26; comp.ratio.value = 3.5;
    comp.attack.value = 0.003; comp.release.value = 0.2;

    var verb = AC.createConvolver();
    verb.buffer = makeImpulse(1.8, 3);
    var vg = AC.createGain(); vg.gain.value = 0.32;

    var master = AC.createGain(); master.gain.value = 0.9;

    outGain.connect(lp); lp.connect(comp);
    outGain.connect(verb); verb.connect(vg); vg.connect(comp);
    comp.connect(master); master.connect(AC.destination);

    var len = Math.floor(AC.sampleRate);
    noiseBuf = AC.createBuffer(1, len, AC.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    startHum();
  }

  function makeImpulse(dur, decay) {
    var rate = AC.sampleRate, len = Math.max(1, Math.floor(rate * dur));
    var buf = AC.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), prev = 0;
      for (var i = 0; i < len; i++) {
        var t = i / len, env = Math.pow(1 - t, decay);
        prev = prev + 0.28 * ((Math.random() * 2 - 1) - prev);
        d[i] = prev * env;
      }
    }
    return buf;
  }

  // the board's own light hum — a quiet open fifth that thickens as it fills
  function startHum() {
    if (!AC || hum) return;
    humGain = AC.createGain();
    humGain.gain.value = 0.0001;
    var f = AC.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = 900; f.Q.value = 0.7;
    humGain.connect(f); f.connect(outGain);
    hum = [];
    [110, 164.81, 220].forEach(function (fr, i) {
      var o = AC.createOscillator();
      o.type = i === 2 ? "triangle" : "sine";
      o.frequency.value = fr;
      o.detune.value = i === 1 ? 4 : -3;
      var g = AC.createGain();
      g.gain.value = i === 2 ? 0.28 : 0.6;
      o.connect(g); g.connect(humGain);
      o.start();
      hum.push(o);
    });
  }

  function setHum() {
    if (!humGain || !AC) return;
    var frac = cells ? filled / cells.length : 0;
    var v = soundOn ? 0.006 + Math.min(0.045, frac * 0.32) : 0.0001;
    try { humGain.gain.setTargetAtTime(v, AC.currentTime, 0.5); } catch (e) {}
  }

  function unlockAudio() {
    initAudio();
    if (!AC) return;
    if (AC.state === "suspended") AC.resume();
    try {
      var b = AC.createBuffer(1, 1, 22050), s = AC.createBufferSource();
      s.buffer = b; s.connect(AC.destination); s.start(0);
    } catch (e) {}
    setHum();
  }
  function now() { return AC ? AC.currentTime : 0; }

  function tone(o) {
    if (!AC) return;
    var t = now();
    var osc = AC.createOscillator();
    osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + (o.dur || 0.1));
    var g = AC.createGain();
    var a = o.a != null ? o.a : 0.002, d = o.dur || 0.1;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.g != null ? o.g : 0.1, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    osc.connect(g);
    if (o.pan != null && AC.createStereoPanner) {
      var p = AC.createStereoPanner(); p.pan.value = clamp(o.pan, -1, 1);
      g.connect(p); p.connect(outGain);
    } else g.connect(outGain);
    osc.start(t); osc.stop(t + a + d + 0.05);
  }

  function noise(o) {
    if (!AC || !noiseBuf) return;
    var t = now(), dur = o.dur || 0.03;
    var s = AC.createBufferSource();
    s.buffer = noiseBuf;
    var f = AC.createBiquadFilter();
    f.type = o.filt || "bandpass";
    f.frequency.value = o.f || 3000;
    if (o.Q) f.Q.value = o.Q;
    var g = AC.createGain();
    g.gain.setValueAtTime(o.g != null ? o.g : 0.1, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g);
    if (o.pan != null && AC.createStereoPanner) {
      var p = AC.createStereoPanner(); p.pan.value = clamp(o.pan, -1, 1);
      g.connect(p); p.connect(outGain);
    } else g.connect(outGain);
    s.start(t, rnd(0, 0.5)); s.stop(t + dur + 0.03);
  }

  // a peg seating into its hole: plastic tick + a tiny hollow body.
  // pitch rides the row so a drag up the board sounds like a run.
  function sndPeg(r, pan) {
    if (!soundOn) return;
    var k = rows ? 1 - r / rows : 0.5;
    noise({ filt: "bandpass", f: 2700 + k * 1400, Q: 2.4, dur: 0.024, g: 0.13, pan: pan });
    tone({ type: "triangle", f: 620 + k * 520, f2: 380 + k * 320, dur: 0.05, a: 0.001, g: 0.075, pan: pan });
  }
  function sndPull(pan) {
    if (!soundOn) return;
    noise({ filt: "bandpass", f: 1200, Q: 1.6, dur: 0.03, g: 0.1, pan: pan });
    tone({ type: "sine", f: 260, f2: 170, dur: 0.05, a: 0.001, g: 0.06, pan: pan });
  }
  function sndUi(up) {
    if (!soundOn) return;
    tone({ type: "triangle", f: up ? 740 : 520, f2: up ? 990 : 400, dur: 0.09, a: 0.003, g: 0.07 });
  }

  soundBtn.addEventListener("click", function () {
    soundOn = !soundOn;
    soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
    try { localStorage.setItem("pegs_sound", soundOn ? "1" : "0"); } catch (e) {}
    if (outGain && AC) {
      try { outGain.gain.setTargetAtTime(soundOn ? 1 : 0, now(), 0.02); }
      catch (e) { outGain.gain.value = soundOn ? 1 : 0; }
    }
    unlockAudio();
  });

  // ================================================================ PALETTE
  COLORS.forEach(function (col, i) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "sw";
    b.style.color = col.c;
    b.setAttribute("role", "radio");
    b.setAttribute("aria-label", col.n + " peg");
    b.setAttribute("aria-checked", i === pick ? "true" : "false");
    b.addEventListener("click", function () { setPick(i); });
    swatchWrap.appendChild(b);
  });
  var eraseBtn = document.createElement("button");
  eraseBtn.type = "button";
  eraseBtn.className = "sw sw--eraser";
  eraseBtn.setAttribute("role", "radio");
  eraseBtn.setAttribute("aria-label", "Eraser");
  eraseBtn.setAttribute("aria-checked", "false");
  eraseBtn.addEventListener("click", function () { setPick(ERASER); });
  swatchWrap.appendChild(eraseBtn);

  function setPick(i) {
    pick = i;
    unlockAudio();
    sndUi(i !== ERASER);
    var kids = swatchWrap.children;
    for (var k = 0; k < kids.length; k++) {
      var isThis = (k < COLORS.length) ? (k === i) : (i === ERASER);
      kids[k].setAttribute("aria-checked", isThis ? "true" : "false");
    }
  }

  // ============================================================== TEMPLATES
  // Each template is a dense point sampling of an outline in a -1..1 box; the
  // points are then snapped onto whatever grid the current viewport produced.
  function templatePoints(name) {
    var p = [], t, i, n = 900;
    if (name === "Star") {
      var pts = [];
      for (i = 0; i < 10; i++) {
        var a = -Math.PI / 2 + i * Math.PI / 5;
        var rr = i % 2 ? 0.4 : 0.95;
        pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
      }
      p = walk(pts, true);
    } else if (name === "Heart") {
      for (i = 0; i < n; i++) {
        t = i / n * TAU;
        var hx = 16 * Math.pow(Math.sin(t), 3);
        var hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
        p.push([hx / 17, hy / 17]);
      }
    } else if (name === "Rocket") {
      p = walk([
        [0, -0.95], [0.3, -0.3], [0.3, 0.34], [0.62, 0.62], [0.62, 0.82],
        [0.24, 0.66], [0.24, 0.86], [-0.24, 0.86], [-0.24, 0.66],
        [-0.62, 0.82], [-0.62, 0.62], [-0.3, 0.34], [-0.3, -0.3]
      ], true);
      // porthole
      for (i = 0; i < 90; i++) {
        t = i / 90 * TAU;
        p.push([Math.cos(t) * 0.15, -0.2 + Math.sin(t) * 0.15]);
      }
    } else if (name === "Flower") {
      for (var k = 0; k < 6; k++) {
        var ca = k * TAU / 6;
        var ox = Math.cos(ca) * 0.44, oy = Math.sin(ca) * 0.44;
        for (i = 0; i < 130; i++) {
          t = i / 130 * TAU;
          p.push([ox + Math.cos(t) * 0.4, oy + Math.sin(t) * 0.4]);
        }
      }
      for (i = 0; i < 90; i++) {
        t = i / 90 * TAU;
        p.push([Math.cos(t) * 0.17, Math.sin(t) * 0.17]);
      }
    }
    return p;
  }

  function walk(pts, close) {
    var out = [], i, j;
    var m = close ? pts.length : pts.length - 1;
    for (i = 0; i < m; i++) {
      var a = pts[i], b = pts[(i + 1) % pts.length];
      var d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      var steps = Math.max(2, Math.ceil(d * 200));
      for (j = 0; j < steps; j++) {
        var u = j / steps;
        out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
      }
    }
    return out;
  }

  function buildGuide() {
    guide = new Uint8Array(cols * rows);
    if (tpl === 0) { guideCv = null; return; }
    var pts = templatePoints(TEMPLATES[tpl]);
    var half = Math.min(cols, rows) * 0.44;
    var mcx = (cols - 1) / 2, mcy = (rows - 1) / 2;
    for (var i = 0; i < pts.length; i++) {
      var gx = mcx + pts[i][0] * half;
      var gy = mcy + pts[i][1] * half;
      var r = Math.round(gy);
      if (r < 0 || r >= rows) continue;
      // odd rows are offset half a pitch, so undo that before snapping
      var c = Math.round(gx - (r % 2 ? 0.5 : 0));
      if (c < 0 || c >= cols) continue;
      guide[r * cols + c] = 1;
    }
    renderGuide();
  }

  function renderGuide() {
    var cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(bw)); cv.height = Math.max(1, Math.round(bh));
    var c = cv.getContext("2d");
    c.fillStyle = "rgba(190,200,220,0.3)";
    for (var r = 0; r < rows; r++) {
      for (var col = 0; col < cols; col++) {
        if (!guide[r * cols + col]) continue;
        var p = cellPos(col, r);
        c.beginPath();
        c.arc(p.x - bx, p.y - by, Math.max(1, pegR * 0.42), 0, TAU);
        c.fill();
      }
    }
    guideCv = cv;
  }

  // ================================================================= LAYOUT
  function cellPos(c, r) {
    return {
      x: bx + pitch * (c + 0.5 + (r % 2 ? 0.5 : 0)),
      y: by + pitch * 0.878 * (r + 0.5)
    };
  }

  function resize() {
    var prev = null;
    if (cells) prev = { cells: cells, cols: cols, rows: rows };

    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // measure the real tray — it wraps to two rows of swatches on narrow phones
    var trayH = Math.max(96, (tray ? tray.getBoundingClientRect().height : 96) + 26);
    var top = 56, bottom = H - trayH;
    var availW = W - 24, availH = Math.max(140, bottom - top);

    // aim for ~30 holes across, but keep the pitch tappable
    pitch = clamp(availW / 30, 9, 26);
    cols = Math.max(10, Math.floor(availW / pitch));
    rows = Math.max(8, Math.floor(availH / (pitch * 0.878)));

    bw = cols * pitch + pitch * 0.5;
    bh = rows * pitch * 0.878;
    bx = (W - bw) / 2;
    by = top + (availH - bh) / 2;
    pegR = pitch * 0.36;

    cells = new Int8Array(cols * rows).fill(-1);
    filled = 0;
    // carry a previous drawing across a rotation as best the new grid allows
    if (prev) {
      for (var r = 0; r < Math.min(rows, prev.rows); r++) {
        for (var c = 0; c < Math.min(cols, prev.cols); c++) {
          var v = prev.cells[r * prev.cols + c];
          if (v >= 0) { cells[r * cols + c] = v; filled++; }
        }
      }
    }

    buildBoard();
    buildSprites();
    buildGuide();
    setHum();
  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", function () {
    resize(); setTimeout(resize, 180); setTimeout(resize, 520);
  });

  function buildBoard() {
    var cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(bw)); cv.height = Math.max(1, Math.round(bh));
    var c = cv.getContext("2d");

    // moulded black plastic
    var g = c.createLinearGradient(0, 0, bw * 0.4, bh);
    g.addColorStop(0, "#171720");
    g.addColorStop(0.5, "#0e0e15");
    g.addColorStop(1, "#08080d");
    c.fillStyle = g;
    c.fillRect(0, 0, bw, bh);

    // holes: a dark well with a lit upper lip
    for (var r = 0; r < rows; r++) {
      for (var col = 0; col < cols; col++) {
        var p = cellPos(col, r);
        var x = p.x - bx, y = p.y - by;
        c.fillStyle = "#040406";
        c.beginPath(); c.arc(x, y, pegR * 0.66, 0, TAU); c.fill();
        c.strokeStyle = "rgba(255,255,255,0.055)";
        c.lineWidth = Math.max(0.6, pegR * 0.13);
        c.beginPath(); c.arc(x, y - pegR * 0.06, pegR * 0.6, Math.PI * 1.1, Math.PI * 1.95); c.stroke();
      }
    }
    boardCv = cv;
  }

  // one pre-rendered sprite per colour: bright core + soft bloom
  function buildSprites() {
    pegSprites = COLORS.map(function (col) {
      var pad = Math.ceil(pegR * 4.2);
      var cv = document.createElement("canvas");
      cv.width = cv.height = pad * 2;
      var c = cv.getContext("2d");
      c.translate(pad, pad);

      var bloom = c.createRadialGradient(0, 0, pegR * 0.3, 0, 0, pegR * 4);
      bloom.addColorStop(0, hexA(col.c, 0.55));
      bloom.addColorStop(0.35, hexA(col.c, 0.18));
      bloom.addColorStop(1, hexA(col.c, 0));
      c.fillStyle = bloom;
      c.beginPath(); c.arc(0, 0, pegR * 4, 0, TAU); c.fill();

      var body = c.createRadialGradient(-pegR * 0.3, -pegR * 0.35, pegR * 0.1, 0, 0, pegR);
      body.addColorStop(0, "#ffffff");
      body.addColorStop(0.4, col.c);
      body.addColorStop(1, hexA(col.c, 0.85));
      c.fillStyle = body;
      c.beginPath(); c.arc(0, 0, pegR, 0, TAU); c.fill();

      c.fillStyle = "rgba(255,255,255,0.8)";
      c.beginPath(); c.arc(-pegR * 0.3, -pegR * 0.34, pegR * 0.24, 0, TAU); c.fill();

      return { cv: cv, pad: pad };
    });
  }

  function hexA(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }

  // ================================================================== INPUT
  function cellAt(x, y) {
    var r = Math.round((y - by) / (pitch * 0.878) - 0.5);
    if (r < 0 || r >= rows) return -1;
    var c = Math.round((x - bx) / pitch - 0.5 - (r % 2 ? 0.5 : 0));
    if (c < 0 || c >= cols) return -1;
    var p = cellPos(c, r);
    if (Math.hypot(x - p.x, y - p.y) > pitch * 0.62) return -1;
    return r * cols + c;
  }

  function apply(idx) {
    if (idx < 0 || idx === lastCell) return;
    lastCell = idx;
    var r = Math.floor(idx / cols), c = idx % cols;
    var p = cellPos(c, r);
    var pan = clamp((p.x - W / 2) / (W * 0.5), -0.85, 0.85);
    if (pick === ERASER) {
      if (cells[idx] < 0) return;
      cells[idx] = -1; filled--;
      sndPull(pan);
    } else {
      if (cells[idx] === pick) return;
      if (cells[idx] < 0) filled++;
      cells[idx] = pick;
      if (!REDMO) pops.push({ i: idx, t: 0 });
      sndPeg(r, pan);
    }
    setHum();
    hint.classList.add("is-gone");
  }

  function pointAt(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvas.addEventListener("pointerdown", function (e) {
    unlockAudio();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    drawing = true; lastCell = -1;
    var p = pointAt(e);
    apply(cellAt(p.x, p.y));
  });
  canvas.addEventListener("pointermove", function (e) {
    if (!drawing) return;
    var p = pointAt(e);
    apply(cellAt(p.x, p.y));
  });
  canvas.addEventListener("pointerup", function () { drawing = false; lastCell = -1; });
  canvas.addEventListener("pointercancel", function () { drawing = false; lastCell = -1; });

  // ================================================================== TOOLS
  tplBtn.addEventListener("click", function () {
    tpl = (tpl + 1) % TEMPLATES.length;
    tplBtn.textContent = TEMPLATES[tpl];
    buildGuide();
    unlockAudio();
    sndUi(true);
  });

  clearBtn.addEventListener("click", function () {
    unlockAudio();
    if (!cells) return;
    cells.fill(-1);
    filled = 0;
    pops.length = 0;
    setHum();
    sndUi(false);
  });

  saveBtn.addEventListener("click", function () {
    unlockAudio();
    sndUi(true);
    var scale = 2;
    var cv = document.createElement("canvas");
    cv.width = Math.round(bw * scale);
    cv.height = Math.round(bh * scale);
    var c = cv.getContext("2d");
    c.fillStyle = "#08080d";
    c.fillRect(0, 0, cv.width, cv.height);
    c.scale(scale, scale);
    if (boardCv) c.drawImage(boardCv, 0, 0);
    c.globalCompositeOperation = "lighter";
    for (var i = 0; i < cells.length; i++) {
      var v = cells[i];
      if (v < 0) continue;
      var sp = pegSprites[v];
      var p = cellPos(i % cols, Math.floor(i / cols));
      c.drawImage(sp.cv, p.x - bx - sp.pad, p.y - by - sp.pad);
    }
    try {
      var a = document.createElement("a");
      a.download = "glow-pegs.png";
      a.href = cv.toDataURL("image/png");
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {}
  });

  // =================================================================== DRAW
  function draw(dt) {
    pulse += dt;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // room
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0b0b12");
    g.addColorStop(1, "#050508");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // board casing
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.85)";
    ctx.shadowBlur = 34;
    ctx.shadowOffsetY = 12;
    ctx.fillStyle = "#101018";
    roundRect(ctx, bx - 10, by - 10, bw + 20, bh + 20, 14);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,0.09)";
    ctx.lineWidth = 1;
    roundRect(ctx, bx - 10, by - 10, bw + 20, bh + 20, 14);
    ctx.stroke();

    if (boardCv) ctx.drawImage(boardCv, bx, by);
    if (guideCv) ctx.drawImage(guideCv, bx, by);

    // pegs
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    // a barely-there breath so a finished board still feels alive
    var breathe = REDMO ? 1 : 0.97 + Math.sin(pulse * 1.1) * 0.03;
    for (var i = 0; i < cells.length; i++) {
      var v = cells[i];
      if (v < 0) continue;
      var sp = pegSprites[v];
      if (!sp) continue;
      var p = cellPos(i % cols, Math.floor(i / cols));
      ctx.globalAlpha = breathe;
      ctx.drawImage(sp.cv, p.x - sp.pad, p.y - sp.pad);
    }
    ctx.globalAlpha = 1;

    // placement pop
    for (var k = pops.length - 1; k >= 0; k--) {
      var po = pops[k];
      po.t += dt;
      if (po.t > 0.34 || cells[po.i] < 0) { pops.splice(k, 1); continue; }
      var a = 1 - po.t / 0.34;
      var pp = cellPos(po.i % cols, Math.floor(po.i / cols));
      ctx.globalAlpha = a * 0.55;
      ctx.strokeStyle = COLORS[cells[po.i]].c;
      ctx.lineWidth = Math.max(1, pegR * 0.4) * a;
      ctx.beginPath();
      ctx.arc(pp.x, pp.y, pegR * (1 + (1 - a) * 2.6), 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // glass reflection over the whole board
    ctx.save();
    roundRect(ctx, bx - 10, by - 10, bw + 20, bh + 20, 14);
    ctx.clip();
    var sheen = ctx.createLinearGradient(bx, by, bx + bw * 0.55, by + bh * 0.7);
    sheen.addColorStop(0, "rgba(255,255,255,0.045)");
    sheen.addColorStop(0.5, "rgba(255,255,255,0)");
    ctx.fillStyle = sheen;
    ctx.fillRect(bx - 10, by - 10, bw + 20, bh + 20);
    ctx.restore();
  }

  function roundRect(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  var last = 0;
  function frame(ts) {
    if (!last) last = ts;
    var dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;
    draw(dt);
    requestAnimationFrame(frame);
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { drawing = false; lastCell = -1; }
  });

  resize();
  requestAnimationFrame(frame);
})();
