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
  var dragging = false;
  var lastPopped = null;

  /* audio */
  function ensureAudio() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
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

  function popSound(pitch) {
    if (!actx) return;
    /* Short bandpass-filtered noise burst — the classic bubble-wrap snap */
    var now = actx.currentTime;
    var bufLen = actx.sampleRate * 0.06;
    var buf = actx.createBuffer(1, bufLen, actx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

    var src = actx.createBufferSource();
    src.buffer = buf;

    var bp = actx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900 + (pitch || 0) * 120;
    bp.Q.value = 3.5;

    var hp = actx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 400;

    var gain = actx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.55, now + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);

    src.connect(bp);
    bp.connect(hp);
    hp.connect(gain);
    gain.connect(actx.destination);
    src.start(now);
    src.stop(now + 0.08);

    /* tonal "snap": a fast pitch-dropping pip = the membrane releasing — gives the pop its body */
    var po = actx.createOscillator(), pg = actx.createGain();
    po.type = "sine";
    var pf = 760 + (pitch || 0) * 110;
    po.frequency.setValueAtTime(pf, now);
    po.frequency.exponentialRampToValueAtTime(pf * 0.45, now + 0.04);
    pg.gain.setValueAtTime(0.0001, now);
    pg.gain.exponentialRampToValueAtTime(0.32, now + 0.004);
    pg.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    po.connect(pg); pg.connect(actx.destination);
    po.start(now); po.stop(now + 0.07);
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
