/* Blob Choir — a cluster of gooey blobs, each a warm synth voice tuned to a
 * shared scale. Tap or drag to play; Shimmer plays a slow generative wash.
 */
(function () {
  "use strict";

  var choir = document.getElementById("choir");
  var ripples = document.getElementById("ripples");
  var stage = document.getElementById("stage");
  var hint = document.getElementById("hint");
  var shimmerBtn = document.getElementById("shimmerBtn");
  var silenceBtn = document.getElementById("silenceBtn");
  if (!choir) return;

  var reduceMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // pentatonic-ish voices (everything sounds good together)
  // C major-6 (C E G A) across two low octaves — every combination is consonant, warm, and calm.
  var NOTES = [130.81, 164.81, 196.0, 220.0, 261.63, 329.63, 392.0, 440.0];
  var POS = [
    { x: 26, y: 40 }, { x: 50, y: 30 }, { x: 73, y: 40 }, { x: 38, y: 62 },
    { x: 62, y: 62 }, { x: 18, y: 64 }, { x: 82, y: 64 }, { x: 50, y: 50 }
  ];

  var blobs = [];
  for (var i = 0; i < NOTES.length; i++) {
    var hue = (262 - i * 26 + 360) % 360;
    var size = 120 - i * 7 + (i % 2 ? 8 : 0);
    var el = document.createElement("div");
    el.className = "blob";
    el.dataset.i = i;
    el.style.left = POS[i].x + "%";
    el.style.top = POS[i].y + "%";
    el.style.width = size + "px";
    el.style.height = size + "px";
    el.style.setProperty("--c1", "hsl(" + hue + ",92%,74%)");
    el.style.setProperty("--c2", "hsl(" + hue + ",82%,56%)");
    el.style.setProperty("--c3", "hsl(" + hue + ",70%,32%)");
    el.style.setProperty("--glow", 26 + (NOTES.length - i) * 2 + "px");
    choir.appendChild(el);
    blobs.push({
      el: el, i: i, freq: NOTES[i],
      bx: POS[i].x, by: POS[i].y,
      phase: Math.random() * Math.PI * 2,
      speed: 0.35 + Math.random() * 0.4,
      amp: reduceMotion ? 2 : 7 + Math.random() * 6,
      sungAt: -9999, base: size
    });
  }

  // ---- visuals loop -----------------------------------------------------
  function frame(ts) {
    var t = (ts || 0) / 1000;
    for (var i = 0; i < blobs.length; i++) {
      var b = blobs[i];
      var dx = Math.cos(t * b.speed + b.phase) * b.amp;
      var dy = Math.sin(t * b.speed * 1.2 + b.phase) * b.amp;
      var since = (ts - b.sungAt) / 1000;
      var swell = since >= 0 && since < 0.6 ? 0.26 * Math.exp(-since * 6) * Math.cos(since * 14) + 0.26 * Math.exp(-since * 5) : 0;
      var s = 1 + Math.max(0, swell);
      b.el.style.transform =
        "translate(calc(-50% + " + dx.toFixed(1) + "px), calc(-50% + " + dy.toFixed(1) + "px)) scale(" + s.toFixed(3) + ")";
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function ripple(b) {
    if (!ripples) return;
    var r = b.el.getBoundingClientRect();
    var el = document.createElement("span");
    el.className = "ripple";
    el.style.left = (r.left + r.width / 2) + "px";
    el.style.top = (r.top + r.height / 2) + "px";
    el.style.borderColor = getComputedStyle(b.el).getPropertyValue("--c1");
    el.addEventListener("animationend", function () { if (el.parentNode) el.parentNode.removeChild(el); });
    ripples.appendChild(el);
  }

  // ---- audio ------------------------------------------------------------
  var actx = null, master = null, delay = null, fb = null;
  function ensureAudio() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    master = actx.createGain();
    master.gain.value = 0.6;
    master.connect(actx.destination);
    // spatial echo for lushness
    delay = actx.createDelay(1.0);
    delay.delayTime.value = 0.3;
    fb = actx.createGain();
    fb.gain.value = 0.32;
    var wet = actx.createGain();
    wet.gain.value = 0.5;
    delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(master);
    actx._wet = delay; // send target
    // iOS unlock: resume + play a 1-sample silent buffer inside the gesture.
    if (actx.state === "suspended") actx.resume();
    try {
      var buf = actx.createBuffer(1, 1, 22050);
      var src = actx.createBufferSource();
      src.buffer = buf; src.connect(actx.destination); src.start(0);
    } catch (e) { /* ignore */ }
  }

  function play(b) {
    ensureAudio();
    if (!actx) return;
    var now = actx.currentTime;
    var voice = actx.createGain();
    var filt = actx.createBiquadFilter();
    filt.type = "lowpass";
    // darker, with a presence floor so low blobs aren't muffled — removes the harsh top end
    filt.frequency.setValueAtTime(Math.min(2800, Math.max(1100, b.freq * 4)), now);
    filt.Q.value = 0.4;
    var o1 = actx.createOscillator(), o2 = actx.createOscillator();
    o1.type = "sine"; o2.type = "sine";          // pure, soft voices
    o1.frequency.value = b.freq; o2.frequency.value = b.freq;
    o2.detune.value = 5;                           // gentle chorus shimmer
    var peak = 0.17;
    voice.gain.setValueAtTime(0.0001, now);
    voice.gain.exponentialRampToValueAtTime(peak, now + 0.06); // soft attack
    voice.gain.exponentialRampToValueAtTime(0.0001, now + 1.7); // long, mellow tail
    o1.connect(voice); o2.connect(voice);
    voice.connect(filt);
    filt.connect(master);
    filt.connect(actx._wet);
    o1.start(now); o2.start(now);
    o1.stop(now + 1.8); o2.stop(now + 1.8);

    b.sungAt = performance.now();
    b.el.classList.add("sing");
    setTimeout(function () { b.el.classList.remove("sing"); }, 380);
    ripple(b);
  }

  // ---- pointer ----------------------------------------------------------
  var lastPlayed = -1, lastTime = 0;
  function trigger(b) {
    if (!b) return;
    var nowMs = performance.now();
    if (b.i === lastPlayed && nowMs - lastTime < 110) return;
    lastPlayed = b.i; lastTime = nowMs;
    play(b);
    if (hint && !hint.classList.contains("is-hidden")) hint.classList.add("is-hidden");
  }
  // Geometric hit-test from stage coords — robust on touch / behind the goo filter.
  function blobAt(x, y) {
    for (var i = 0; i < blobs.length; i++) {
      var r = blobs[i].el.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (Math.hypot(x - cx, y - cy) <= r.width / 2) return blobs[i];
    }
    return null;
  }

  var down = false;
  stage.addEventListener("pointerdown", function (e) {
    down = true;
    lastPlayed = -1;
    ensureAudio();
    trigger(blobAt(e.clientX, e.clientY));
  });
  stage.addEventListener("pointermove", function (e) {
    if (!down) return;
    trigger(blobAt(e.clientX, e.clientY));
  }, { passive: true });
  window.addEventListener("pointerup", function () { down = false; lastPlayed = -1; });
  window.addEventListener("pointercancel", function () { down = false; });

  // ---- shimmer (generative) --------------------------------------------
  var shimmer = false, shimmerTO = null;
  function shimmerStep() {
    if (!shimmer) return;
    trigger(blobs[Math.floor(Math.random() * blobs.length)]);
    lastPlayed = -1;
    shimmerTO = setTimeout(shimmerStep, 500 + Math.random() * 1100);
  }
  shimmerBtn.addEventListener("click", function () {
    shimmer = !shimmer;
    shimmerBtn.setAttribute("aria-pressed", shimmer ? "true" : "false");
    if (shimmer) { ensureAudio(); shimmerStep(); }
    else if (shimmerTO) clearTimeout(shimmerTO);
  });

  // ---- silence ----------------------------------------------------------
  silenceBtn.addEventListener("click", function () {
    if (shimmer) { shimmer = false; shimmerBtn.setAttribute("aria-pressed", "false"); if (shimmerTO) clearTimeout(shimmerTO); }
    if (master) {
      var now = actx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(0.0001, now + 0.08);
      master.gain.linearRampToValueAtTime(0.6, now + 0.4);
    }
  });
})();
