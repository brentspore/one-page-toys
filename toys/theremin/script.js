/* Theremin — a gesture instrument. Vanilla Canvas 2D + Web Audio.
 * Press and glide: left↔right sets pitch (optionally snapped to a scale),
 * up↕down sets volume. A vibrato LFO + reverb/delay give the eerie voice.
 * A pitch antenna (right) and volume loop (left) glow as you approach them. */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var scaleBtn = document.getElementById("scaleBtn");
  var waveBtn = document.getElementById("waveBtn");
  var soundBtn = document.getElementById("soundBtn");
  var hintEl = document.getElementById("hint");

  var W = 0, H = 0, DPR = 1;

  var MIDI_LO = 45, MIDI_HI = 84;   // A2 .. C6 (~3.25 octaves)
  var SCALES = [
    { name: "Free", steps: null },
    { name: "Penta", steps: [0, 3, 5, 7, 10] },   // minor pentatonic
    { name: "Minor", steps: [0, 2, 3, 5, 7, 8, 10] },
    { name: "Major", steps: [0, 2, 4, 5, 7, 9, 11] }
  ];
  var WAVES = ["sine", "triangle", "sawtooth"];
  var WAVE_LABEL = { sine: "Sine", triangle: "Tri", sawtooth: "Saw" };
  var NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

  var scaleIdx = 0, waveIdx = 0, soundOn = true;
  var active = false, px = 0, py = 0;         // pointer (screen)
  var curMidi = 60, curFreq = 261.63, curVol = 0, curNote = "C4";
  var scopeBuf = new Float32Array(0);
  var phase = 0;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener("resize", resize);

  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function noteName(m) { var r = Math.round(m); return NOTE_NAMES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1); }

  function snapMidi(m) {
    var steps = SCALES[scaleIdx].steps;
    if (!steps) return m;
    var oct = Math.floor(m / 12), pc = m - oct * 12, best = steps[0], bd = 99;
    for (var i = 0; i < steps.length; i++) { var d = Math.abs(steps[i] - pc); if (d < bd) { bd = d; best = steps[i]; } }
    // also check wrap to next octave root
    if (Math.abs(12 - pc) < bd) return (oct + 1) * 12;
    return oct * 12 + best;
  }

  function fieldRect() { var top = Math.max(70, H * 0.14), bot = H - Math.max(40, H * 0.08); return { x: W * 0.14, y: top, w: W * 0.72, h: bot - top }; }

  function updateFromPointer() {
    var f = fieldRect();
    var xn = Math.max(0, Math.min(1, (px - f.x) / f.w));
    var yn = Math.max(0, Math.min(1, (py - f.y) / f.h));
    var rawMidi = MIDI_LO + xn * (MIDI_HI - MIDI_LO);
    curMidi = snapMidi(rawMidi);
    curFreq = midiToFreq(curMidi);
    curNote = noteName(curMidi);
    curVol = Math.pow(1 - yn, 1.35);            // top = loud
  }

  // ---------- input ----------
  function evt(e) { var r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function onDown(e) { unlock(); var p = evt(e); px = p.x; py = p.y; active = true; updateFromPointer(); voiceOn(); hintEl.classList.add("is-gone"); }
  function onMove(e) { if (!active) return; var p = evt(e); px = p.x; py = p.y; updateFromPointer(); voiceUpdate(); }
  function onUp() { active = false; voiceOff(); }
  canvas.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);

  scaleBtn.addEventListener("click", function () { scaleIdx = (scaleIdx + 1) % SCALES.length; scaleBtn.textContent = "Scale: " + SCALES[scaleIdx].name; });
  waveBtn.addEventListener("click", function () { waveIdx = (waveIdx + 1) % WAVES.length; waveBtn.textContent = "Wave: " + WAVE_LABEL[WAVES[waveIdx]]; if (osc1) { osc1.type = WAVES[waveIdx]; osc2.type = WAVES[waveIdx]; } });
  soundBtn.addEventListener("click", function () { soundOn = !soundOn; soundBtn.textContent = "Sound: " + (soundOn ? "on" : "off"); soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false"); if (outGain) outGain.gain.value = soundOn ? 1 : 0; unlock(); });

  // ============================ AUDIO ============================
  var actx = null, outGain = null, master = null, voiceGain = null, osc1 = null, osc2 = null,
    lp = null, vib = null, vibGain = null, convo = null, wet = null, delay = null, analyser = null;
  function initAudio() {
    if (actx) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      outGain = actx.createGain(); outGain.gain.value = soundOn ? 1 : 0;
      master = actx.createGain(); master.gain.value = 0.6;
      voiceGain = actx.createGain(); voiceGain.gain.value = 0;
      lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3200; lp.Q.value = 0.7;
      osc1 = actx.createOscillator(); osc1.type = WAVES[waveIdx]; osc1.frequency.value = curFreq;
      osc2 = actx.createOscillator(); osc2.type = WAVES[waveIdx]; osc2.frequency.value = curFreq; osc2.detune.value = 4;
      vib = actx.createOscillator(); vib.type = "sine"; vib.frequency.value = 5.6;
      vibGain = actx.createGain(); vibGain.gain.value = curFreq * 0.006;
      vib.connect(vibGain); vibGain.connect(osc1.frequency); vibGain.connect(osc2.frequency);
      osc1.connect(voiceGain); osc2.connect(voiceGain); voiceGain.connect(lp);
      // dry + reverb + delay
      lp.connect(master);
      wet = actx.createGain(); wet.gain.value = 0.32;
      convo = actx.createConvolver(); convo.buffer = makeImpulse(3.2, 2.6);
      delay = actx.createDelay(0.6); delay.delayTime.value = 0.28;
      var fb = actx.createGain(); fb.gain.value = 0.34; var dlp = actx.createBiquadFilter(); dlp.type = "lowpass"; dlp.frequency.value = 2200;
      lp.connect(delay); delay.connect(dlp); dlp.connect(fb); fb.connect(delay); dlp.connect(wet);
      lp.connect(wet); wet.connect(convo); convo.connect(master);
      analyser = actx.createAnalyser(); analyser.fftSize = 1024; master.connect(analyser);
      scopeBuf = new Float32Array(analyser.fftSize);
      master.connect(outGain); outGain.connect(actx.destination);
      osc1.start(); osc2.start(); vib.start();
    } catch (e) { actx = null; }
  }
  function makeImpulse(dur, decay) {
    var n = Math.floor(actx.sampleRate * dur), buf = actx.createBuffer(2, n, actx.sampleRate);
    for (var ch = 0; ch < 2; ch++) { var d = buf.getChannelData(ch); for (var i = 0; i < n; i++) { var t = i / n; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay); } }
    return buf;
  }
  function unlock() { initAudio(); if (actx && actx.state === "suspended") actx.resume(); }
  function voiceOn() { if (!actx) return; var t = actx.currentTime; setPitch(true); voiceGain.gain.cancelScheduledValues(t); voiceGain.gain.setTargetAtTime(curVol * 0.5, t, 0.04); }
  function voiceUpdate() { if (!actx) return; setPitch(false); var t = actx.currentTime; voiceGain.gain.setTargetAtTime(curVol * 0.5, t, 0.03); }
  function voiceOff() { if (!actx) return; var t = actx.currentTime; voiceGain.gain.setTargetAtTime(0, t, 0.12); }
  function setPitch(jump) {
    if (!actx) return; var t = actx.currentTime;
    osc1.frequency.setTargetAtTime(curFreq, t, jump ? 0.01 : 0.055);
    osc2.frequency.setTargetAtTime(curFreq, t, jump ? 0.01 : 0.055);
    vibGain.gain.setTargetAtTime(curFreq * 0.006, t, 0.05);
    lp.frequency.setTargetAtTime(1400 + curVol * 3200, t, 0.05);
  }

  // ---------- render ----------
  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    var bg = ctx.createRadialGradient(W * 0.5, H * 0.5, 40, W * 0.5, H * 0.6, Math.max(W, H) * 0.8);
    bg.addColorStop(0, "#171436"); bg.addColorStop(0.6, "#0d0b24"); bg.addColorStop(1, "#050414");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    var f = fieldRect();
    // pitch guide lines (note columns)
    ctx.save();
    for (var m = Math.ceil(MIDI_LO); m <= MIDI_HI; m++) {
      var xn = (m - MIDI_LO) / (MIDI_HI - MIDI_LO), x = f.x + xn * f.w;
      var isC = ((m % 12) + 12) % 12 === 0;
      ctx.strokeStyle = isC ? "rgba(142,203,255,0.22)" : "rgba(142,203,255,0.07)";
      ctx.lineWidth = isC ? 1.6 : 1;
      ctx.beginPath(); ctx.moveTo(x, f.y); ctx.lineTo(x, f.y + f.h); ctx.stroke();
      if (isC) { ctx.fillStyle = "rgba(142,203,255,0.4)"; ctx.font = "600 11px Archivo, system-ui"; ctx.textAlign = "center"; ctx.fillText(noteName(m), x, f.y + f.h + 16); }
    }
    // volume gradient hint (left edge)
    var vg = ctx.createLinearGradient(0, f.y, 0, f.y + f.h);
    vg.addColorStop(0, "rgba(255,120,200,0.10)"); vg.addColorStop(1, "rgba(255,120,200,0)");
    ctx.fillStyle = vg; ctx.fillRect(f.x, f.y, f.w, f.h);
    ctx.restore();

    // antennas
    var glowP = active ? Math.min(1, (px - f.x) / f.w) : 0.2;
    var glowV = active ? curVol : 0.2;
    // pitch antenna (right vertical rod)
    var ax = f.x + f.w + Math.min(46, W * 0.05);
    drawGlowLine(ax, f.y - 10, ax, f.y + f.h + 10, 6, "rgba(142,203,255,", 0.3 + glowP * 0.7);
    // volume loop (left)
    var lx = f.x - Math.min(46, W * 0.05);
    ctx.save();
    ctx.strokeStyle = "rgba(255,120,200," + (0.3 + glowV * 0.7) + ")";
    ctx.lineWidth = 5; ctx.shadowColor = "rgba(255,120,200,0.8)"; ctx.shadowBlur = 12 + glowV * 20;
    ctx.beginPath(); ctx.ellipse(lx, f.y + f.h * 0.5, 14, f.h * 0.28, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();

    // oscilloscope ring / trace across the field when playing
    if (active && analyser && curVol > 0.02) {
      analyser.getFloatTimeDomainData(scopeBuf);
      ctx.save();
      ctx.strokeStyle = "rgba(142,220,255,0.5)"; ctx.lineWidth = 2;
      ctx.beginPath();
      var step = Math.floor(scopeBuf.length / f.w) || 1, i2 = 0;
      for (var sx = 0; sx < f.w; sx += 2) {
        var v = scopeBuf[Math.min(scopeBuf.length - 1, (i2 += step * 2))] || 0;
        var yy = py + v * 46;
        if (sx === 0) ctx.moveTo(f.x + sx, yy); else ctx.lineTo(f.x + sx, yy);
      }
      ctx.stroke(); ctx.restore();
    }

    // the hand orb
    if (active) {
      phase += 0.15;
      var pulse = 1 + Math.sin(phase) * 0.06;
      var rr = (26 + curVol * 26) * pulse;
      var og = ctx.createRadialGradient(px, py, 2, px, py, rr * 2.2);
      og.addColorStop(0, "rgba(180,235,255,0.9)"); og.addColorStop(0.4, "rgba(120,180,255,0.4)"); og.addColorStop(1, "rgba(120,180,255,0)");
      ctx.fillStyle = og; ctx.beginPath(); ctx.arc(px, py, rr * 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#eaf6ff"; ctx.beginPath(); ctx.arc(px, py, rr * 0.42, 0, Math.PI * 2); ctx.fill();
      // rings
      for (var k = 1; k <= 3; k++) {
        ctx.strokeStyle = "rgba(160,215,255," + (0.4 / k) + ")"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(px, py, rr * (0.7 + k * 0.5), 0, Math.PI * 2); ctx.stroke();
      }
      // note + Hz readout
      ctx.fillStyle = "#eaf6ff"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      ctx.font = "900 " + Math.max(22, W * 0.03) + "px Archivo, system-ui, sans-serif";
      ctx.fillText(curNote, px, py - rr * 2.4);
      ctx.font = "600 12px Archivo, system-ui, sans-serif"; ctx.fillStyle = "rgba(214,230,255,0.7)";
      ctx.fillText(Math.round(curFreq) + " Hz", px, py - rr * 2.4 + 16);
    } else {
      ctx.fillStyle = "rgba(214,230,255,0.35)"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = "700 " + Math.max(14, W * 0.02) + "px Archivo, system-ui, sans-serif";
      ctx.fillText("press & glide to play", W / 2, f.y + f.h / 2);
    }
  }
  function drawGlowLine(x1, y1, x2, y2, w, rgb, a) {
    ctx.save(); ctx.strokeStyle = rgb + a + ")"; ctx.lineWidth = w; ctx.lineCap = "round";
    ctx.shadowColor = rgb + "0.8)"; ctx.shadowBlur = 14 + a * 18;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
  }

  function frame() { render(); requestAnimationFrame(frame); }

  // ---------- boot ----------
  resize();
  setTimeout(function () { hintEl.classList.add("is-gone"); }, 7000);
  requestAnimationFrame(frame);
})();
