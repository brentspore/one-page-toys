/* Music Box — a pinned drum that plucks a metal comb. Vanilla Canvas 2D + Web Audio.
 * The drum turns and scrolls pins toward a strike line; each pin crossing it
 * plucks its comb tine (a bell-like note). Tap the drum to add/remove pins.
 * Pentatonic tuning so any pattern sounds sweet. */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var playBtn = document.getElementById("playBtn");
  var tempoBtn = document.getElementById("tempoBtn");
  var clearBtn = document.getElementById("clearBtn");
  var soundBtn = document.getElementById("soundBtn");
  var hintEl = document.getElementById("hint");

  var W = 0, H = 0, DPR = 1;

  var ROWS = 8, COLS = 16;
  // major pentatonic across ~1.5 octaves, MIDI (row 0 = lowest, drawn at bottom)
  var MIDIS = [60, 62, 64, 67, 69, 72, 74, 76];   // C D E G A C5 D5 E5
  var NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  var pins = [];                     // pins[row][col] boolean
  var TEMPOS = [{ n: "Slow", sps: 2.2 }, { n: "Med", sps: 3.6 }, { n: "Fast", sps: 5.4 }];
  var tempoIdx = 1;
  var playing = true, soundOn = true;
  var phase = 0, lastStep = -1;
  var glow = [];                     // per-tine pluck glow 0..1
  var vibr = [];                     // per-tine vibration phase

  var box = null;                    // layout rect + derived positions

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    layout();
  }
  window.addEventListener("resize", resize);

  function layout() {
    var pad = Math.max(24, Math.min(W, H) * 0.06);
    var top = Math.max(70, H * 0.16);
    var bw = Math.min(W - pad * 2, 900), bh = Math.min(H - top - pad, 480);
    var bx = (W - bw) / 2, by = top + (H - top - pad - bh) / 2;
    var combW = bw * 0.30;                 // left comb area
    var strikeX = bx + combW;
    var drumX = strikeX, drumW = bw - combW;
    var rowH = (bh - 40) / ROWS;
    box = { x: bx, y: by, w: bw, h: bh, combW: combW, strikeX: strikeX, drumX: drumX, drumW: drumW, rowH: rowH, innerY: by + 20 };
  }

  function reset(withDemo) {
    pins = []; glow = []; vibr = [];
    for (var r = 0; r < ROWS; r++) { pins.push(new Array(COLS).fill(false)); glow.push(0); vibr.push(0); }
    if (withDemo) {
      // a gentle default motif
      var demo = [[0, 0], [2, 2], [4, 4], [2, 6], [5, 8], [4, 10], [2, 12], [7, 14], [0, 8], [4, 0]];
      demo.forEach(function (p) { if (p[0] < ROWS) pins[p[0]][p[1]] = true; });
    }
  }

  function rowY(r) { return box.innerY + (ROWS - 1 - r) * box.rowH + box.rowH / 2; }  // row 0 at bottom
  function colScreenX(c) {
    var rel = ((c - phase) % COLS + COLS) % COLS;      // 0 at strike, increasing to the right
    return box.strikeX + rel * (box.drumW / COLS);
  }

  // ---------- input ----------
  function evt(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  canvas.addEventListener("pointerdown", function (e) {
    unlock(); var p = evt(e);
    if (p.x < box.strikeX - 4 || p.x > box.x + box.w || p.y < box.innerY - box.rowH * 0.5 || p.y > box.innerY + ROWS * box.rowH) return;
    // nearest row
    var row = Math.round((box.innerY + (ROWS - 1) * box.rowH + box.rowH / 2 - p.y) / box.rowH);
    row = Math.max(0, Math.min(ROWS - 1, row));
    // column under the pointer given current rotation
    var rel = (p.x - box.strikeX) / (box.drumW / COLS);
    var col = Math.round(phase + rel);
    col = ((col % COLS) + COLS) % COLS;
    pins[row][col] = !pins[row][col];
    if (pins[row][col]) { pluck(row, 0.5); }         // preview note softly
    hintEl.classList.add("is-gone");
  });
  playBtn.addEventListener("click", function () { playing = !playing; playBtn.textContent = playing ? "Pause" : "Play"; playBtn.setAttribute("aria-pressed", playing ? "true" : "false"); unlock(); });
  tempoBtn.addEventListener("click", function () { tempoIdx = (tempoIdx + 1) % TEMPOS.length; tempoBtn.textContent = "Tempo: " + TEMPOS[tempoIdx].n; });
  clearBtn.addEventListener("click", function () { reset(false); });
  soundBtn.addEventListener("click", function () { soundOn = !soundOn; soundBtn.textContent = "Sound: " + (soundOn ? "on" : "off"); soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false"); if (outGain) outGain.gain.value = soundOn ? 1 : 0; unlock(); });

  // ---------- update ----------
  function update(dt) {
    if (playing) {
      var prev = phase;
      phase = (phase + TEMPOS[tempoIdx].sps * dt) % COLS;
      // detect step crossings (handle wrap)
      var steps = TEMPOS[tempoIdx].sps * dt;
      var startStep = Math.floor(prev), endStep = Math.floor(prev + steps);
      for (var s = startStep + 1; s <= endStep; s++) {
        var col = ((s % COLS) + COLS) % COLS;
        triggerCol(col);
      }
    }
    for (var r = 0; r < ROWS; r++) { if (glow[r] > 0) glow[r] *= Math.pow(0.02, dt); if (vibr[r] > 0.001) vibr[r] *= Math.pow(0.015, dt); }
  }
  function triggerCol(col) {
    for (var r = 0; r < ROWS; r++) if (pins[r][col]) pluck(r, 1);
  }
  function pluck(row, vel) { glow[row] = 1; vibr[row] = 1; sndTine(MIDIS[row], vel, row / (ROWS - 1)); }

  // ---------- render ----------
  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    var bg = ctx.createRadialGradient(W * 0.5, H * 0.4, 40, W * 0.5, H * 0.6, Math.max(W, H) * 0.8);
    bg.addColorStop(0, "#3a271a"); bg.addColorStop(0.6, "#241812"); bg.addColorStop(1, "#160d09");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    if (!box) return;
    var b = box;

    // wooden box body
    roundRect(b.x - 14, b.y - 14, b.w + 28, b.h + 28, 18);
    var wood = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
    wood.addColorStop(0, "#6b4626"); wood.addColorStop(1, "#4a2f18");
    ctx.fillStyle = wood; ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.4)"; ctx.lineWidth = 3; roundRect(b.x - 14, b.y - 14, b.w + 28, b.h + 28, 18); ctx.stroke();
    // wood grain
    ctx.save(); roundRect(b.x - 14, b.y - 14, b.w + 28, b.h + 28, 18); ctx.clip();
    ctx.globalAlpha = 0.06; ctx.strokeStyle = "#2a1a0e"; ctx.lineWidth = 2;
    for (var gg = 0; gg < b.h + 28; gg += 9) { ctx.beginPath(); ctx.moveTo(b.x - 14, b.y - 14 + gg + Math.sin(gg) * 2); ctx.lineTo(b.x + b.w + 14, b.y - 14 + gg + Math.cos(gg * 0.7) * 2); ctx.stroke(); }
    ctx.restore();

    // inner well (metal plate under the drum)
    roundRect(b.x, b.y, b.w, b.h, 10);
    var plate = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
    plate.addColorStop(0, "#241812"); plate.addColorStop(1, "#1a1009");
    ctx.fillStyle = plate; ctx.fill();

    drawDrum(b);
    drawComb(b);

    // strike line
    ctx.save(); ctx.strokeStyle = "rgba(255,220,150,0.5)"; ctx.lineWidth = 2; ctx.setLineDash([5, 6]);
    ctx.beginPath(); ctx.moveTo(b.strikeX, b.innerY - 6); ctx.lineTo(b.strikeX, b.innerY + ROWS * b.rowH - b.rowH * 0.3); ctx.stroke(); ctx.restore();
  }

  function drawDrum(b) {
    ctx.save();
    roundRect(b.drumX, b.y, b.drumW, b.h, 10); ctx.clip();
    // cylinder shading (top + bottom darker → rounded barrel look)
    var cyl = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
    cyl.addColorStop(0, "#3a2413"); cyl.addColorStop(0.12, "#7a5230"); cyl.addColorStop(0.5, "#9c6c3f"); cyl.addColorStop(0.88, "#6b4526"); cyl.addColorStop(1, "#331f0f");
    ctx.fillStyle = cyl; ctx.fillRect(b.drumX, b.y, b.drumW, b.h);
    // vertical ring lines per column
    for (var c = 0; c < COLS; c++) {
      var x = colScreenX(c);
      ctx.strokeStyle = "rgba(0,0,0,0.14)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, b.y); ctx.lineTo(x, b.y + b.h); ctx.stroke();
    }
    // pins
    for (var r = 0; r < ROWS; r++) {
      for (var cc = 0; cc < COLS; cc++) {
        if (!pins[r][cc]) continue;
        var px = colScreenX(cc), py = rowY(r);
        if (px < b.drumX - 8 || px > b.drumX + b.drumW + 8) continue;
        var near = 1 - Math.min(1, Math.abs(px - b.strikeX) / (b.drumW * 0.5));
        // brass stud
        var rad = 5 + near * 2.5;
        var pg = ctx.createRadialGradient(px - rad * 0.3, py - rad * 0.4, 1, px, py, rad);
        pg.addColorStop(0, "#ffe6a8"); pg.addColorStop(0.6, "#d59b3f"); pg.addColorStop(1, "#7c5416");
        ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(px, py, rad, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.lineWidth = 1; ctx.stroke();
      }
    }
    ctx.restore();
    // barrel end caps
    ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(b.drumX, b.y, 3, b.h);
    ctx.fillStyle = "rgba(255,255,255,0.06)"; ctx.fillRect(b.drumX + b.drumW - 3, b.y, 3, b.h);
  }

  function drawComb(b) {
    // comb tines: brass bars from the left edge to the strike line; longer = lower note
    for (var r = 0; r < ROWS; r++) {
      var y = rowY(r);
      var lenFrac = 0.55 + (1 - r / (ROWS - 1)) * 0.45;          // low notes (r small) longer
      var x0 = b.x + 8, x1 = b.strikeX;
      var tineLen = (x1 - x0) * lenFrac;
      var vib = Math.sin(performance.now() * 0.06) * vibr[r] * 4;
      var th = Math.max(4, b.rowH * 0.4);
      ctx.save();
      // base bar (fixed root near comb block)
      var grad = ctx.createLinearGradient(x0, y - th / 2, x0, y + th / 2);
      grad.addColorStop(0, "#f4d488"); grad.addColorStop(0.5, "#caa14f"); grad.addColorStop(1, "#8a6626");
      ctx.fillStyle = grad;
      roundRect(x1 - tineLen, y - th / 2 + vib, tineLen, th, th / 2); ctx.fill();
      // glow when plucked
      if (glow[r] > 0.02) {
        ctx.save(); ctx.globalAlpha = glow[r]; ctx.shadowColor = "rgba(255,225,150,0.9)"; ctx.shadowBlur = 16;
        ctx.fillStyle = "rgba(255,236,180,0.85)"; roundRect(x1 - tineLen, y - th / 2 + vib, tineLen, th, th / 2); ctx.fill(); ctx.restore();
      }
      ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.lineWidth = 1; roundRect(x1 - tineLen, y - th / 2 + vib, tineLen, th, th / 2); ctx.stroke();
      ctx.restore();
    }
    // comb mounting block
    var bx = b.x + 4;
    ctx.fillStyle = "#3a2a16"; roundRect(bx, b.innerY - b.rowH * 0.4, 10, ROWS * b.rowH, 4); ctx.fill();
  }

  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  var last = 0;
  function frame(ts) {
    var dt = last ? Math.min((ts - last) / 1000, 0.05) : 0; last = ts;
    update(dt); render();
    requestAnimationFrame(frame);
  }

  // ============================ AUDIO ============================
  var actx = null, outGain = null, master = null, convo = null, wet = null;
  function initAudio() {
    if (actx) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      outGain = actx.createGain(); outGain.gain.value = soundOn ? 1 : 0;
      master = actx.createGain(); master.gain.value = 0.8;
      convo = actx.createConvolver(); convo.buffer = makeImpulse(2.6, 2.4);
      wet = actx.createGain(); wet.gain.value = 0.28;
      master.connect(outGain); wet.connect(convo); convo.connect(outGain); outGain.connect(actx.destination);
    } catch (e) { actx = null; }
  }
  function makeImpulse(dur, decay) {
    var n = Math.floor(actx.sampleRate * dur), buf = actx.createBuffer(2, n, actx.sampleRate);
    for (var ch = 0; ch < 2; ch++) { var d = buf.getChannelData(ch); for (var i = 0; i < n; i++) { var tt = i / n; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - tt, decay); } }
    return buf;
  }
  function unlock() { initAudio(); if (actx && actx.state === "suspended") actx.resume(); if (actx) { var b = actx.createBuffer(1, 1, 22050), s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0); } }
  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function sndTine(midi, vel, panPos) {
    if (!actx || !soundOn) return;
    var t = actx.currentTime, f = midiToFreq(midi + 12);   // music-box tines ring an octave up, bright
    var pan = actx.createStereoPanner ? actx.createStereoPanner() : null;
    if (pan) pan.pan.value = (panPos - 0.5) * 0.7;
    var out = actx.createGain(); out.gain.value = vel * 0.5;
    if (pan) { out.connect(pan); pan.connect(master); pan.connect(wet); } else { out.connect(master); out.connect(wet); }
    var partials = [[1, 1, 1.0], [2.0, 0.42, 0.7], [3.0, 0.22, 0.5], [5.4, 0.12, 0.32]];
    partials.forEach(function (p) {
      var o = actx.createOscillator(); o.type = "sine"; o.frequency.value = f * p[0];
      var g = actx.createGain(); var dur = 1.6 * p[2] * (330 / f);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(p[1], t + 0.004); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
    });
    // pin-release tick
    var s = noise(0.02), bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 3400; bp.Q.value = 3;
    var g2 = actx.createGain(); g2.gain.setValueAtTime(0.06 * vel, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
    s.connect(bp); bp.connect(out); s.start(t); s.stop(t + 0.03);
  }
  function noise(dur) { var n = Math.floor(actx.sampleRate * dur), b = actx.createBuffer(1, n, actx.sampleRate), d = b.getChannelData(0); for (var i = 0; i < n; i++)d[i] = Math.random() * 2 - 1; var s = actx.createBufferSource(); s.buffer = b; return s; }

  // ---------- boot ----------
  resize();
  reset(true);
  setTimeout(function () { hintEl.classList.add("is-gone"); }, 7000);
  requestAnimationFrame(frame);
})();
