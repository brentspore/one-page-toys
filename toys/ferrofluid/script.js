/* Ferrofluid — a blob of magnetic fluid. Vanilla Canvas 2D.
 * A glossy black blob bristles into spikes; the cursor acts as a magnet,
 * pulling taller spikes toward it and stretching the body its way.
 * Tap to send a pulse of spikes rippling outward. Subtle magnetic hum. */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var tintBtn = document.getElementById("tintBtn");
  var soundBtn = document.getElementById("soundBtn");
  var hintEl = document.getElementById("hint");

  var W = 0, H = 0, DPR = 1;
  var N = 150;                        // boundary points
  var baseR = 120;                    // blob radius (set in resize)
  var cx = 0, cy = 0;                 // blob centre (eases toward the magnet a touch)
  var px = 0, py = 0, hasPointer = false;
  var pull = 0;                       // smoothed field strength 0..1
  var pulse = 0;                      // tap burst envelope
  var t = 0;
  var phases = [];                    // per-point random phase for irregular bristle
  var soundOn = true;
  var TINTS = [
    { name: "Cyan", a: [120, 210, 255], b: [90, 130, 255] },
    { name: "Magenta", a: [255, 130, 220], b: [150, 90, 255] },
    { name: "Gold", a: [255, 216, 130], b: [255, 150, 70] },
    { name: "Mono", a: [210, 220, 235], b: [150, 165, 190] }
  ];
  var tintIdx = 0;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    baseR = Math.min(W, H) * 0.15;
    cx = W / 2; cy = H / 2;
    if (!hasPointer) { px = W / 2; py = H / 2; }
  }
  window.addEventListener("resize", resize);

  for (var i = 0; i < N; i++) phases.push(Math.random() * Math.PI * 2);

  function tint() { return TINTS[tintIdx]; }
  function rgba(c, a) { return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }

  // ---------- input ----------
  function evt(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  canvas.addEventListener("pointermove", function (e) { var p = evt(e); px = p.x; py = p.y; hasPointer = true; });
  canvas.addEventListener("pointerdown", function (e) { unlock(); var p = evt(e); px = p.x; py = p.y; hasPointer = true; pulse = 1; sndPulse(); hintEl.classList.add("is-gone"); });
  canvas.addEventListener("pointerleave", function () { hasPointer = false; });
  tintBtn.addEventListener("click", function () { tintIdx = (tintIdx + 1) % TINTS.length; tintBtn.textContent = "Sheen: " + tint().name; });
  soundBtn.addEventListener("click", function () { soundOn = !soundOn; soundBtn.textContent = "Sound: " + (soundOn ? "on" : "off"); soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false"); if (outGain) outGain.gain.value = soundOn ? 1 : 0; unlock(); });

  // ---------- shape ----------
  function noise(a, k, s) { return Math.sin(a * k + t * s) + 0.6 * Math.sin(a * k * 2.3 - t * s * 1.4); }

  function radii() {
    var dx = px - cx, dy = py - cy, d = Math.hypot(dx, dy);
    var maxD = Math.min(W, H) * 0.55;
    var targetPull = hasPointer ? Math.max(0.12, 1 - d / maxD) : 0.16;
    pull += (targetPull - pull) * 0.12;
    var dirA = Math.atan2(dy, dx);
    var arr = [], spikeMax = baseR * (0.55 + pull * 1.15) + pulse * baseR * 0.9;
    for (var i = 0; i < N; i++) {
      var a = i / N * Math.PI * 2;
      var align = 0.5 + 0.5 * Math.cos(a - dirA);         // 1 toward magnet
      var bristle = 0.5 + 0.5 * noise(a + phases[i], 9, 2.1);       // always-present fine spikes
      var field = pull * (0.25 + 0.75 * Math.pow(align, 2));
      var spike = baseR * 0.12 * bristle                            // idle bristle
        + spikeMax * field * (0.55 + 0.45 * bristle)               // magnet-driven spikes
        + pulse * baseR * 0.5 * bristle;                            // tap pulse burst
      // gentle low-freq body wobble
      var wob = baseR * 0.06 * Math.sin(a * 3 + t * 0.9 + phases[i] * 0.2);
      arr.push(baseR + wob + spike);
    }
    return { arr: arr, dirA: dirA };
  }

  function render() {
    t += 0.016;
    if (pulse > 0) pulse *= 0.9;
    // ease centre toward the magnet a little (reaching)
    if (hasPointer) { cx += (px - cx) * 0.02 * pull; cy += (py - cy) * 0.02 * pull; }
    else { cx += (W / 2 - cx) * 0.03; cy += (H / 2 - cy) * 0.03; }

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    // backdrop with a soft spotlight
    var bg = ctx.createRadialGradient(cx, cy, 30, cx, cy, Math.max(W, H) * 0.75);
    bg.addColorStop(0, "#14161c"); bg.addColorStop(0.5, "#0a0b10"); bg.addColorStop(1, "#040406");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    // faint tinted glow pooled under the blob
    var tc = tint();
    var glow = ctx.createRadialGradient(cx, cy, baseR * 0.3, cx, cy, baseR * 2.4);
    glow.addColorStop(0, rgba(tc.a, 0.10 + pull * 0.10)); glow.addColorStop(1, rgba(tc.a, 0));
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, baseR * 2.4, 0, Math.PI * 2); ctx.fill();

    var R = radii(), arr = R.arr;

    // build the spiky path
    ctx.beginPath();
    for (var i = 0; i <= N; i++) {
      var idx = i % N, a = idx / N * Math.PI * 2, r = arr[idx];
      var x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();

    // fill — glossy black body
    var body = ctx.createRadialGradient(cx - baseR * 0.3, cy - baseR * 0.35, baseR * 0.1, cx, cy, baseR * 1.5);
    body.addColorStop(0, "#3a3d47"); body.addColorStop(0.35, "#1b1d24"); body.addColorStop(0.7, "#0a0b0f"); body.addColorStop(1, "#050506");
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 26; ctx.shadowOffsetY = 10;
    ctx.fillStyle = body; ctx.fill();
    ctx.restore();

    // rim light along the spikes (tinted)
    ctx.save(); ctx.clip();
    // top-left specular sheen — tight + glossy
    var sheen = ctx.createRadialGradient(cx - baseR * 0.4, cy - baseR * 0.46, 1, cx - baseR * 0.34, cy - baseR * 0.38, baseR * 0.7);
    sheen.addColorStop(0, "rgba(255,255,255,0.62)"); sheen.addColorStop(0.28, "rgba(210,232,255,0.14)"); sheen.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sheen; ctx.fillRect(0, 0, W, H);
    // small crisp hotspot
    var hot = ctx.createRadialGradient(cx - baseR * 0.42, cy - baseR * 0.48, 0, cx - baseR * 0.42, cy - baseR * 0.48, baseR * 0.16);
    hot.addColorStop(0, "rgba(255,255,255,0.8)"); hot.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = hot; ctx.fillRect(0, 0, W, H);
    ctx.restore();

    // tinted rim stroke (edge glow)
    ctx.save();
    ctx.lineWidth = 2.2; ctx.lineJoin = "round";
    var rimGrad = ctx.createLinearGradient(cx - baseR, cy - baseR, cx + baseR, cy + baseR);
    rimGrad.addColorStop(0, rgba(tc.a, 0.85)); rimGrad.addColorStop(1, rgba(tc.b, 0.4));
    ctx.strokeStyle = rimGrad; ctx.shadowColor = rgba(tc.a, 0.7); ctx.shadowBlur = 10 + pull * 14;
    ctx.stroke();
    ctx.restore();

    // little specular dots on the tallest spike tips near the magnet
    ctx.save();
    for (var j = 0; j < N; j += 2) {
      var a2 = j / N * Math.PI * 2, r2 = arr[j];
      var align = 0.5 + 0.5 * Math.cos(a2 - R.dirA);
      if (r2 > baseR * 1.25 && align > 0.6) {
        var tx = cx + Math.cos(a2) * r2, ty = cy + Math.sin(a2) * r2;
        ctx.fillStyle = rgba(tc.a, 0.5 * align);
        ctx.beginPath(); ctx.arc(tx, ty, 1.8, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();

    // update hum
    updateHum();
  }

  function frame() { render(); requestAnimationFrame(frame); }

  // ============================ AUDIO ============================
  var actx = null, outGain = null, master = null, hum = null, humGain = null, hum2 = null, lp = null, convo = null, wet = null;
  function initAudio() {
    if (actx) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      outGain = actx.createGain(); outGain.gain.value = soundOn ? 1 : 0;
      master = actx.createGain(); master.gain.value = 0.8;
      lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 360; lp.Q.value = 3;
      hum = actx.createOscillator(); hum.type = "sawtooth"; hum.frequency.value = 58;
      hum2 = actx.createOscillator(); hum2.type = "sawtooth"; hum2.frequency.value = 58 * 1.005;
      humGain = actx.createGain(); humGain.gain.value = 0;
      hum.connect(humGain); hum2.connect(humGain); humGain.connect(lp);
      lp.connect(master);
      wet = actx.createGain(); wet.gain.value = 0.3; convo = actx.createConvolver(); convo.buffer = makeImpulse(2.4, 2.6);
      lp.connect(wet); wet.connect(convo); convo.connect(master);
      master.connect(outGain); outGain.connect(actx.destination);
      hum.start(); hum2.start();
    } catch (e) { actx = null; }
  }
  function makeImpulse(dur, decay) {
    var n = Math.floor(actx.sampleRate * dur), buf = actx.createBuffer(2, n, actx.sampleRate);
    for (var ch = 0; ch < 2; ch++) { var d = buf.getChannelData(ch); for (var i = 0; i < n; i++) { var tt = i / n; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - tt, decay); } }
    return buf;
  }
  function unlock() { initAudio(); if (actx && actx.state === "suspended") actx.resume(); if (actx) { var b = actx.createBuffer(1, 1, 22050), s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0); } }
  function updateHum() {
    if (!actx || !humGain) return; var now = actx.currentTime;
    humGain.gain.setTargetAtTime((hasPointer ? pull : 0.05) * 0.06, now, 0.1);
    lp.frequency.setTargetAtTime(280 + pull * 500, now, 0.1);
  }
  function sndPulse() {
    if (!actx || !soundOn) return; var t0 = actx.currentTime;
    // metallic shimmer + a soft magnetic thump
    var o = actx.createOscillator(); o.type = "triangle"; o.frequency.setValueAtTime(320, t0); o.frequency.exponentialRampToValueAtTime(90, t0 + 0.25);
    var g = actx.createGain(); g.gain.setValueAtTime(0.14, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
    o.connect(g); g.connect(master); g.connect(wet); o.start(t0); o.stop(t0 + 0.32);
    var n = actx.createBufferSource(); var buf = actx.createBuffer(1, actx.sampleRate * 0.2, actx.sampleRate); var dd = buf.getChannelData(0);
    for (var i = 0; i < dd.length; i++) dd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / dd.length, 2);
    n.buffer = buf; var bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 2600; bp.Q.value = 4;
    var g2 = actx.createGain(); g2.gain.setValueAtTime(0.12, t0); g2.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
    n.connect(bp); bp.connect(g2); g2.connect(master); g2.connect(wet); n.start(t0); n.stop(t0 + 0.22);
  }

  // ---------- boot ----------
  resize();
  setTimeout(function () { hintEl.classList.add("is-gone"); }, 6000);
  requestAnimationFrame(frame);
})();
