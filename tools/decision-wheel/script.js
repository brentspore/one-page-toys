/* Decision Wheel — No. 097
 * Type options, flick the wheel, let it decide. Real angular physics with a
 * flapper that ticks on every peg and takes a little energy each time, so the
 * spin-down is the honest slow tease rather than a scripted animation.
 * Wheels round-trip through the URL hash so a group can share one.
 * Vanilla Canvas 2D + Web Audio. Self-contained.
 * localStorage: "wheel_opts" (last wheel), "wheel_sound". */
(function () {
  "use strict";

  var TAU = Math.PI * 2;

  var canvas = document.getElementById("wheel");
  var ctx = canvas.getContext("2d");
  var verdict = document.getElementById("verdict");
  var spinBtn = document.getElementById("spinBtn");
  var shareBtn = document.getElementById("shareBtn");
  var addBtn = document.getElementById("addBtn");
  var optsWrap = document.getElementById("opts");
  var presetsWrap = document.getElementById("presets");
  var countEl = document.getElementById("count");
  var soundBtn = document.getElementById("soundBtn");

  var REDMO = false;
  try { REDMO = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

  var MAX = 12, MIN = 2;

  var WEDGES = [
    "#e5533d", "#f0883c", "#e0af2e", "#8bbf46", "#35ab84", "#2f9fbe",
    "#4a7fd4", "#7566d6", "#a95ad0", "#d84f9a", "#c2543f", "#5f9b3f"
  ];

  var PRESETS = [
    { n: "Dinner", o: ["Pizza", "Tacos", "Sushi", "Burgers", "Thai", "Ramen"] },
    { n: "Yes / No", o: ["Yes", "No", "Ask again later"] },
    { n: "Chores", o: ["Dishes", "Laundry", "Vacuum", "Bins", "Bathroom", "Nothing!"] }
  ];

  // ------------------------------------------------------------------- state
  var options = PRESETS[0].o.slice();
  var ang = 0, vel = 0;
  var spinning = false, dragging = false;
  var lastTickIdx = null;
  var flap = 0, flapV = 0;          // flapper deflection + its velocity
  var winner = -1, winT = 0;
  var confetti = [];
  var dragSamples = [];
  var last = 0, size = 0, dpr = 1;

  // ------------------------------------------------------------ persistence
  var soundOn = true;
  try { if (localStorage.getItem("wheel_sound") === "0") soundOn = false; } catch (e) {}
  soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
  soundBtn.setAttribute("aria-label", soundOn ? "Sound on" : "Sound off");

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // ================================================================== AUDIO
  var AC = null, outGain = null, noiseBuf = null;

  function initAudio() {
    if (AC) return;
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { AC = null; return; }

    outGain = AC.createGain();
    outGain.gain.value = soundOn ? 1 : 0;

    var comp = AC.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 26; comp.ratio.value = 3.5;
    comp.attack.value = 0.003; comp.release.value = 0.2;

    var verb = AC.createConvolver();
    verb.buffer = makeImpulse(1.3, 3.2);
    var vg = AC.createGain(); vg.gain.value = 0.24;

    var master = AC.createGain(); master.gain.value = 0.9;

    outGain.connect(comp);
    outGain.connect(verb); verb.connect(vg); vg.connect(comp);
    comp.connect(master); master.connect(AC.destination);

    var len = Math.floor(AC.sampleRate);
    noiseBuf = AC.createBuffer(1, len, AC.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  function makeImpulse(dur, decay) {
    var rate = AC.sampleRate, len = Math.max(1, Math.floor(rate * dur));
    var buf = AC.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), prev = 0;
      for (var i = 0; i < len; i++) {
        var t = i / len, env = Math.pow(1 - t, decay);
        prev = prev + 0.3 * ((Math.random() * 2 - 1) - prev);
        d[i] = prev * env;
      }
    }
    return buf;
  }

  function unlockAudio() {
    initAudio();
    if (!AC) return;
    if (AC.state === "suspended") AC.resume();
    try {
      var b = AC.createBuffer(1, 1, 22050), s = AC.createBufferSource();
      s.buffer = b; s.connect(AC.destination); s.start(0);
    } catch (e) {}
  }
  function now() { return AC ? AC.currentTime : 0; }

  function tone(o) {
    if (!AC) return;
    var t = now() + (o.at || 0);
    var osc = AC.createOscillator();
    osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + (o.dur || 0.2));
    var g = AC.createGain();
    var a = o.a != null ? o.a : 0.003, d = o.dur || 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.g != null ? o.g : 0.14, t + a);
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
    var t = now() + (o.at || 0), dur = o.dur || 0.04;
    var s = AC.createBufferSource();
    s.buffer = noiseBuf;
    var f = AC.createBiquadFilter();
    f.type = o.filt || "bandpass";
    f.frequency.setValueAtTime(o.f || 2600, t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(Math.max(60, o.f2), t + dur);
    if (o.Q) f.Q.value = o.Q;
    var g = AC.createGain();
    g.gain.setValueAtTime(o.g != null ? o.g : 0.1, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(outGain);
    s.start(t, rnd(0, 0.5)); s.stop(t + dur + 0.03);
  }

  // the flapper snapping off a peg: a dry plastic tick that brightens with speed
  function sndTick(speed) {
    if (!soundOn) return;
    var v = clamp(speed / 12, 0.12, 1);
    noise({ filt: "bandpass", f: 1900 + v * 1500, Q: 3.2, dur: 0.02 + (1 - v) * 0.02, g: 0.055 + v * 0.09 });
    tone({ type: "triangle", f: 760 + v * 260, f2: 420, dur: 0.028, a: 0.001, g: 0.03 + v * 0.045 });
  }

  function sndWhoosh() {
    if (!soundOn) return;
    noise({ filt: "bandpass", f: 400, f2: 1800, Q: 0.9, dur: 0.3, g: 0.07 });
  }

  function sndWin() {
    if (!soundOn) return;
    var steps = [0, 4, 7, 12, 16];
    for (var i = 0; i < steps.length; i++) {
      var f = 392 * Math.pow(2, steps[i] / 12);
      tone({ type: "triangle", f: f, dur: 0.8, a: 0.006, g: 0.1, at: i * 0.08, pan: (i / steps.length - 0.5) * 0.6 });
      tone({ type: "sine", f: f * 2, dur: 0.4, a: 0.004, g: 0.03, at: i * 0.08 });
    }
  }

  soundBtn.addEventListener("click", function () {
    soundOn = !soundOn;
    soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
    soundBtn.setAttribute("aria-label", soundOn ? "Sound on" : "Sound off");
    soundBtn.title = soundOn ? "Sound on" : "Sound off";
    try { localStorage.setItem("wheel_sound", soundOn ? "1" : "0"); } catch (e) {}
    if (outGain && AC) {
      try { outGain.gain.setTargetAtTime(soundOn ? 1 : 0, now(), 0.02); }
      catch (e) { outGain.gain.value = soundOn ? 1 : 0; }
    }
    unlockAudio();
  });

  // =============================================================== SHARE/LOAD
  function encode(list) {
    try { return btoa(unescape(encodeURIComponent(JSON.stringify(list)))).replace(/=+$/, ""); }
    catch (e) { return ""; }
  }
  function decode(str) {
    try {
      var json = decodeURIComponent(escape(atob(str)));
      var arr = JSON.parse(json);
      if (!Array.isArray(arr)) return null;
      arr = arr.map(function (s) { return String(s).slice(0, 40); }).filter(function (s) { return s.trim(); });
      return arr.length >= MIN ? arr.slice(0, MAX) : null;
    } catch (e) { return null; }
  }

  function loadInitial() {
    var h = (location.hash || "").replace(/^#w=/, "");
    if (h && h !== location.hash) {
      var got = decode(h);
      if (got) { options = got; return; }
    }
    try {
      var saved = localStorage.getItem("wheel_opts");
      if (saved) {
        var arr = JSON.parse(saved);
        if (Array.isArray(arr) && arr.length >= MIN) options = arr.slice(0, MAX);
      }
    } catch (e) {}
  }

  function persist() {
    try { localStorage.setItem("wheel_opts", JSON.stringify(options)); } catch (e) {}
    try { history.replaceState(null, "", "#w=" + encode(options)); } catch (e) {}
  }

  shareBtn.addEventListener("click", function () {
    unlockAudio();
    persist();
    var url = location.origin + location.pathname + "#w=" + encode(options);
    var done = function () {
      shareBtn.textContent = "Copied";
      setTimeout(function () { shareBtn.textContent = "Copy link"; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { fallbackCopy(url, done); });
    } else fallbackCopy(url, done);
  });

  function fallbackCopy(text, done) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      done();
    } catch (e) {
      shareBtn.textContent = "Copy failed";
      setTimeout(function () { shareBtn.textContent = "Copy link"; }, 1600);
    }
  }

  // ================================================================= EDITOR
  PRESETS.forEach(function (p) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "preset";
    b.textContent = p.n;
    b.addEventListener("click", function () {
      unlockAudio();
      options = p.o.slice();
      renderOpts();
      resetVerdict();
      persist();
    });
    presetsWrap.appendChild(b);
  });

  function renderOpts() {
    optsWrap.textContent = "";
    options.forEach(function (val, i) {
      var li = document.createElement("li");
      li.className = "opt";

      var dot = document.createElement("span");
      dot.className = "opt__dot";
      dot.style.background = WEDGES[i % WEDGES.length];
      dot.setAttribute("aria-hidden", "true");

      var input = document.createElement("input");
      input.className = "opt__in";
      input.type = "text";
      input.value = val;
      input.maxLength = 40;
      input.setAttribute("aria-label", "Option " + (i + 1));
      input.addEventListener("input", function () {
        options[i] = input.value;
        resetVerdict();
      });
      input.addEventListener("change", persist);
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); input.blur(); addOption(); }
      });

      var del = document.createElement("button");
      del.type = "button";
      del.className = "opt__del";
      del.innerHTML = "&times;";
      del.setAttribute("aria-label", "Remove option " + (i + 1));
      del.disabled = options.length <= MIN;
      del.addEventListener("click", function () {
        if (options.length <= MIN) return;
        unlockAudio();
        options.splice(i, 1);
        renderOpts();
        resetVerdict();
        persist();
      });

      li.appendChild(dot); li.appendChild(input); li.appendChild(del);
      optsWrap.appendChild(li);
    });
    countEl.textContent = options.length + " of " + MAX;
    addBtn.disabled = options.length >= MAX;
  }

  function addOption() {
    if (options.length >= MAX) return;
    options.push("Option " + (options.length + 1));
    renderOpts();
    resetVerdict();
    persist();
    var inputs = optsWrap.querySelectorAll(".opt__in");
    var lastIn = inputs[inputs.length - 1];
    if (lastIn) { lastIn.focus(); lastIn.select(); }
  }
  addBtn.addEventListener("click", function () { unlockAudio(); addOption(); });

  function resetVerdict() {
    winner = -1; winT = 0;
    verdict.textContent = "Flick the wheel";
    verdict.classList.add("is-idle");
    verdict.classList.remove("is-pop");
  }

  // ================================================================= SIZING
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var r = canvas.getBoundingClientRect();
    size = Math.max(120, Math.min(r.width, r.height) || r.width);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", function () {
    resize(); setTimeout(resize, 200);
  });

  // ================================================================== INPUT
  function angleAt(e) {
    var r = canvas.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
  }

  var grabAng = 0;
  canvas.addEventListener("pointerdown", function (e) {
    unlockAudio();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    dragging = true;
    spinning = false;
    vel = 0;
    grabAng = angleAt(e) - ang;
    dragSamples = [{ a: angleAt(e), t: performance.now() }];
    resetVerdict();
  });

  canvas.addEventListener("pointermove", function (e) {
    if (!dragging) return;
    var a = angleAt(e);
    ang = a - grabAng;
    dragSamples.push({ a: a, t: performance.now() });
    if (dragSamples.length > 6) dragSamples.shift();
  });

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    // velocity from the last ~120ms of the drag, unwrapped across the ±pi seam
    var v = 0;
    if (dragSamples.length > 1) {
      var a = dragSamples[0], b = dragSamples[dragSamples.length - 1];
      var dt = (b.t - a.t) / 1000;
      if (dt > 0.008) {
        var d = b.a - a.a;
        while (d > Math.PI) d -= TAU;
        while (d < -Math.PI) d += TAU;
        v = d / dt;
      }
    }
    if (Math.abs(v) > 1.2) { vel = clamp(v, -26, 26); spinning = true; sndWhoosh(); }
  }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  spinBtn.addEventListener("click", function () {
    unlockAudio();
    if (spinning) return;
    resetVerdict();
    vel = rnd(11, 17) * (Math.random() < 0.5 ? -1 : 1);
    spinning = true;
    sndWhoosh();
  });

  window.addEventListener("keydown", function (e) {
    if ((e.code === "Space" || e.key === " ") && document.activeElement === document.body) {
      e.preventDefault();
      spinBtn.click();
    }
  });

  // ================================================================= UPDATE
  function update(dt) {
    var seg = TAU / options.length;

    if (spinning) {
      // exponential drag plus a constant brake, so it actually comes to rest
      vel *= Math.exp(-0.42 * dt);
      var brake = 0.55 * dt * (vel > 0 ? 1 : -1);
      if (Math.abs(vel) <= Math.abs(brake)) vel = 0; else vel -= brake;
      ang += vel * dt;
      if (Math.abs(vel) < 0.05) { vel = 0; spinning = false; settle(); }
    }

    // flapper: tick every time a peg passes under the pointer at the top
    var pos = (-Math.PI / 2 - ang) / seg;
    var idx = Math.floor(pos);
    if (lastTickIdx === null) lastTickIdx = idx;
    if (idx !== lastTickIdx) {
      var steps = Math.min(6, Math.abs(idx - lastTickIdx));
      for (var s = 0; s < steps; s++) sndTick(Math.abs(vel));
      lastTickIdx = idx;
      flapV += clamp(Math.abs(vel) * 0.22, 0.35, 3.4) * (vel > 0 ? 1 : -1);
      if (spinning) vel *= 0.994;   // each peg takes a sliver of energy
    }

    // spring the flapper back to rest
    flapV += (-flap * 90 - flapV * 11) * dt;
    flap += flapV * dt;
    flap = clamp(flap, -0.5, 0.5);

    if (winT > 0) winT = Math.max(0, winT - dt);

    for (var i = confetti.length - 1; i >= 0; i--) {
      var c = confetti[i];
      c.t += dt; c.x += c.vx * dt; c.y += c.vy * dt; c.vy += 520 * dt; c.rot += c.vr * dt;
      if (c.t > c.life) confetti.splice(i, 1);
    }
  }

  function settle() {
    var seg = TAU / options.length;
    var local = ((-Math.PI / 2 - ang) % TAU + TAU) % TAU;
    winner = Math.floor(local / seg) % options.length;
    winT = 1;
    var label = (options[winner] || "").trim() || "Option " + (winner + 1);
    verdict.textContent = label;
    verdict.classList.remove("is-idle");
    verdict.classList.remove("is-pop");
    // restart the pop animation
    void verdict.offsetWidth;
    if (!REDMO) verdict.classList.add("is-pop");
    sndWin();
    spawnConfetti();
    try {
      if (window.gtag) window.gtag("event", "wheel_spin", { value: options.length });
    } catch (e) {}
  }

  function spawnConfetti() {
    if (REDMO) return;
    for (var i = 0; i < 46; i++) {
      confetti.push({
        x: size / 2 + rnd(-size * 0.1, size * 0.1),
        y: size * 0.1,
        vx: rnd(-260, 260), vy: rnd(-260, -40),
        w: rnd(4, 9), h: rnd(6, 13),
        col: WEDGES[Math.floor(Math.random() * WEDGES.length)],
        rot: rnd(0, TAU), vr: rnd(-9, 9),
        t: 0, life: rnd(1.1, 2)
      });
    }
  }

  // =================================================================== DRAW
  function draw() {
    var n = options.length, seg = TAU / n;
    var cx = size / 2;
    // The flapper hangs above the rim, so the wheel sits a little low and a
    // little small — at R = size*0.44 the pointer was clipped off the canvas.
    var cy = size * 0.545;
    var R = size * 0.415;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    // shadow under the wheel
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = "#000";
    ctx.beginPath(); ctx.ellipse(cx, cy + R * 0.06, R * 1.02, R * 1.02, 0, 0, TAU); ctx.filter = "blur(1px)"; ctx.fill();
    ctx.filter = "none";
    ctx.restore();

    // wedges
    ctx.save();
    ctx.translate(cx, cy);
    for (var i = 0; i < n; i++) {
      var a0 = ang + i * seg, a1 = a0 + seg;
      var col = WEDGES[i % WEDGES.length];
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R, a0, a1);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();
      // dim the wedge slightly toward the rim so it reads as a disc
      var sg = ctx.createRadialGradient(0, 0, R * 0.2, 0, 0, R);
      sg.addColorStop(0, "rgba(255,255,255,0.14)");
      sg.addColorStop(0.65, "rgba(255,255,255,0)");
      sg.addColorStop(1, "rgba(0,0,0,0.22)");
      ctx.fillStyle = sg;
      ctx.fill();

      // winner keeps its brightness, everything else steps back
      if (winner >= 0 && winner !== i) {
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.fill();
      }
      // divider
      ctx.strokeStyle = "rgba(255,255,255,0.34)";
      ctx.lineWidth = Math.max(1, R * 0.006);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a0) * R, Math.sin(a0) * R);
      ctx.stroke();
    }

    // labels
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    var fs = clamp(R * 0.115, 10, 34);
    if (n > 8) fs *= 0.88;
    ctx.font = "700 " + fs.toFixed(1) + "px 'Archivo', system-ui, sans-serif";
    for (var k = 0; k < n; k++) {
      var mid = ang + (k + 0.5) * seg;
      var text = (options[k] || "").trim() || "—";
      var maxChars = n > 9 ? 12 : 16;
      if (text.length > maxChars) text = text.slice(0, maxChars - 1) + "…";
      ctx.save();
      ctx.rotate(mid);
      // keep text upright-ish on the left half
      var flipped = Math.cos(mid) < -0.0001;
      if (flipped) { ctx.rotate(Math.PI); ctx.textAlign = "left"; } else ctx.textAlign = "right";
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillText(text, (flipped ? -1 : 1) * R * 0.86, 1.4);
      ctx.fillStyle = "#fff";
      ctx.fillText(text, (flipped ? -1 : 1) * R * 0.86, 0);
      ctx.restore();
    }

    // rim + pegs
    ctx.strokeStyle = "rgba(20,16,40,0.55)";
    ctx.lineWidth = Math.max(3, R * 0.045);
    ctx.beginPath(); ctx.arc(0, 0, R + ctx.lineWidth / 2 - 1, 0, TAU); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = Math.max(1, R * 0.012);
    ctx.beginPath(); ctx.arc(0, 0, R + R * 0.012, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();

    for (var p = 0; p < n; p++) {
      var pa = ang + p * seg;
      var px = Math.cos(pa) * (R + R * 0.012), py = Math.sin(pa) * (R + R * 0.012);
      var pg = ctx.createRadialGradient(px - R * 0.006, py - R * 0.008, 0, px, py, R * 0.026);
      pg.addColorStop(0, "#ffffff");
      pg.addColorStop(0.5, "#c9c4dc");
      pg.addColorStop(1, "#6d6785");
      ctx.fillStyle = pg;
      ctx.beginPath(); ctx.arc(px, py, R * 0.026, 0, TAU); ctx.fill();
    }

    // hub
    var hg = ctx.createRadialGradient(-R * 0.04, -R * 0.05, R * 0.01, 0, 0, R * 0.135);
    hg.addColorStop(0, "#ffffff");
    hg.addColorStop(0.45, "#e6e2f2");
    hg.addColorStop(1, "#8d86a8");
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.135, 0, TAU); ctx.fill();
    ctx.strokeStyle = "rgba(20,16,40,0.35)";
    ctx.lineWidth = Math.max(1, R * 0.01);
    ctx.stroke();
    ctx.restore();

    // flapper at 12 o'clock
    ctx.save();
    ctx.translate(cx, cy - R - R * 0.035);
    ctx.rotate(flap * 0.9);
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = R * 0.06;
    var fl = R * 0.17;
    ctx.beginPath();
    ctx.moveTo(0, fl);
    ctx.lineTo(-fl * 0.5, -fl * 0.62);
    ctx.quadraticCurveTo(0, -fl * 0.95, fl * 0.5, -fl * 0.62);
    ctx.closePath();
    var fg = ctx.createLinearGradient(0, -fl, 0, fl);
    fg.addColorStop(0, "#fff6d8");
    fg.addColorStop(0.5, "#efe4c0");
    fg.addColorStop(1, "#b9a870");
    ctx.fillStyle = fg;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(40,30,10,0.4)";
    ctx.lineWidth = Math.max(1, R * 0.008);
    ctx.stroke();
    ctx.fillStyle = "#6b6280";
    ctx.beginPath(); ctx.arc(0, -fl * 0.5, R * 0.022, 0, TAU); ctx.fill();
    ctx.restore();

    // confetti
    for (var c2 = 0; c2 < confetti.length; c2++) {
      var c = confetti[c2];
      var a = 1 - c.t / c.life;
      ctx.save();
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.fillStyle = c.col;
      ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h * Math.abs(Math.cos(c.rot * 1.4)));
      ctx.restore();
    }
  }

  // ==================================================================== LOOP
  function frame(ts) {
    if (!last) last = ts;
    var dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  window.addEventListener("hashchange", function () {
    var h = (location.hash || "").replace(/^#w=/, "");
    var got = h ? decode(h) : null;
    if (got) { options = got; renderOpts(); resetVerdict(); }
  });

  loadInitial();
  renderOpts();
  resetVerdict();
  resize();
  requestAnimationFrame(frame);
})();
