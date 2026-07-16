(function () {
  "use strict";

  var sheet = document.getElementById("sheet");
  var countEl = document.getElementById("count");
  var totalEl = document.getElementById("total");
  var resetBtn = document.getElementById("resetBtn");
  var hintEl = document.getElementById("hint");

  var BUBBLE_SIZE = 52; /* px — cell size incl. gap */
  var bubbles = [];
  var popped = 0;
  var actx = null;
  var bus = null;
  var dragging = false;
  var lastPopped = null;

  /* audio */
  function ensureAudio() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    /* master bus: a gentle compressor so rapid drag-pops stay punchy and never clip */
    var comp = actx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.002; comp.release.value = 0.12;
    bus = actx.createGain(); bus.gain.value = 0.85;
    bus.connect(comp); comp.connect(actx.destination);
    /* iOS silent buffer unlock */
    try {
      var b = actx.createBuffer(1, 1, 22050);
      var s = actx.createBufferSource();
      s.buffer = b;
      s.connect(actx.destination);
      s.start(0);
    } catch (e) {}
    if (actx.state === "suspended") actx.resume();
  }

  /* A real bubble-wrap pop, layered: a crisp plastic SNAP (short high-passed noise
     click) + a resonant pitch-dropping BODY (the membrane releasing) + a low air
     THUNK for weight. Slight per-pop jitter so a fast drag never sounds machine-gun. */
  function popSound(pitch) {
    if (!actx || !bus) return;
    var now = actx.currentTime;
    var v = pitch || 0;
    var jit = 0.9 + Math.random() * 0.22;

    /* 1) crisp snap — a ~6ms high-passed noise click */
    var clkLen = Math.floor(actx.sampleRate * 0.006);
    var cbuf = actx.createBuffer(1, clkLen, actx.sampleRate);
    var cd = cbuf.getChannelData(0);
    for (var i = 0; i < clkLen; i++) cd[i] = (Math.random() * 2 - 1) * (1 - i / clkLen);
    var csrc = actx.createBufferSource(); csrc.buffer = cbuf;
    var chp = actx.createBiquadFilter(); chp.type = "highpass"; chp.frequency.value = 2400;
    var cg = actx.createGain(); cg.gain.value = 0.34;
    csrc.connect(chp); chp.connect(cg); cg.connect(bus);
    csrc.start(now); csrc.stop(now + 0.02);

    /* 2) resonant body — a triangle that snaps down in pitch */
    var bf = (600 + v * 85) * jit;
    var bo = actx.createOscillator(); bo.type = "triangle";
    bo.frequency.setValueAtTime(bf, now);
    bo.frequency.exponentialRampToValueAtTime(bf * 0.42, now + 0.045);
    var bg = actx.createGain();
    bg.gain.setValueAtTime(0.0001, now);
    bg.gain.exponentialRampToValueAtTime(0.5, now + 0.003);
    bg.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);
    bo.connect(bg); bg.connect(bus);
    bo.start(now); bo.stop(now + 0.09);

    /* 3) low air-release thunk for body/weight */
    var lf = 150 * jit;
    var lo = actx.createOscillator(); lo.type = "sine";
    lo.frequency.setValueAtTime(lf * 1.9, now);
    lo.frequency.exponentialRampToValueAtTime(lf, now + 0.04);
    var lg = actx.createGain();
    lg.gain.setValueAtTime(0.0001, now);
    lg.gain.exponentialRampToValueAtTime(0.26, now + 0.004);
    lg.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    lo.connect(lg); lg.connect(bus);
    lo.start(now); lo.stop(now + 0.075);
  }

  /* grid */
  function buildGrid() {
    sheet.innerHTML = "";
    bubbles = [];
    popped = 0;

    var sw = sheet.clientWidth || window.innerWidth;
    var sh = sheet.clientHeight || window.innerHeight;
    var cols = Math.max(3, Math.floor(sw / BUBBLE_SIZE));
    var rows = Math.max(3, Math.floor(sh / BUBBLE_SIZE));
    var total = cols * rows;

    totalEl.textContent = total;
    countEl.textContent = 0;

    for (var i = 0; i < total; i++) {
      var cell = document.createElement("div");
      cell.className = "bubble";
      cell.style.width = BUBBLE_SIZE + "px";
      cell.style.height = BUBBLE_SIZE + "px";
      cell.dataset.idx = i;

      var inner = document.createElement("div");
      inner.className = "bubble__inner";
      cell.appendChild(inner);

      sheet.appendChild(cell);
      bubbles.push(cell);
    }
  }

  function popBubble(el, pitchIdx) {
    if (!el || el.classList.contains("is-popped")) return;
    el.classList.add("is-popped");
    popped++;
    countEl.textContent = popped;
    popSound(pitchIdx !== undefined ? pitchIdx : Math.random() * 6 | 0);
    if (hintEl && !hintEl.classList.contains("is-hidden")) hintEl.classList.add("is-hidden");
    if (popped === bubbles.length) countEl.style.color = "rgba(100,255,160,0.9)";
  }

  /* pointer events — supports tap and drag */
  sheet.addEventListener("pointerdown", function (e) {
    ensureAudio();
    dragging = true;
    lastPopped = null;
    var t = e.target.closest(".bubble");
    if (t) popBubble(t);
    sheet.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  sheet.addEventListener("pointermove", function (e) {
    if (!dragging) return;
    var t = document.elementFromPoint(e.clientX, e.clientY);
    if (t) t = t.closest(".bubble");
    if (t && t !== lastPopped) {
      lastPopped = t;
      popBubble(t);
    }
  });

  sheet.addEventListener("pointerup", function () { dragging = false; });
  sheet.addEventListener("pointercancel", function () { dragging = false; });

  resetBtn.addEventListener("click", function () {
    ensureAudio();
    buildGrid();
    countEl.style.color = "";
    if (hintEl) hintEl.classList.remove("is-hidden");
  });

  window.addEventListener("resize", buildGrid);

  buildGrid();
})();
