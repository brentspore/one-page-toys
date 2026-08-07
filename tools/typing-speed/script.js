/* Typing Speed — One Page Toys
 *
 * Input handling note: keys are read from a real <input> via the `input`
 * event rather than from keydown. keydown looks simpler but reports
 * "Unidentified" on most mobile keyboards and fights autocorrect and IME
 * composition, so a phone would silently type nothing. Holding the current
 * word in a real field and diffing its value works the same everywhere.
 *
 * Scoring is the standard convention: a "word" is five correct characters,
 * spaces included, so WPM = correct chars / 5 / minutes. Accuracy is
 * keystroke-level — every insertion counts, including the ones you fixed —
 * which is why it can drop below 100% on a run you finished clean.
 */
(function () {
  "use strict";

  var WORDS = ("the be to of and a in that have I it for not on with he as you do at this but his by from " +
    "they we say her she or an will my one all would there their what so up out if about who get which go me " +
    "when make can like time no just him know take people into year your good some could them see other than " +
    "then now look only come its over think also back after use two how our work first well way even new want " +
    "because any these give day most us water long find here thing great little world own last right move " +
    "still learn change never light house never open close before under between always night morning field " +
    "story music paper river summer winter forest window silver morning garden letter travel simple future " +
    "market reason season school ground bridge friend family island memory number object orange picture " +
    "planet pocket public purple record shadow silent single spring square stream strong sudden sugar table " +
    "theory thread ticket tomato tunnel valley village weather yellow anchor basket branch bright candle " +
    "castle circle cotton desert dinner doctor dragon engine flower forest guitar hammer harbor helmet " +
    "island jungle kitten ladder lantern marble meadow mirror monkey needle orchid pepper pillow rabbit " +
    "ribbon rocket saddle salmon sample sunset temple thunder tiger turtle violet walnut willow wonder").split(/\s+/);

  var STREAM_LEN = 240;

  var wordsEl = document.getElementById("words");
  var typebox = document.getElementById("typebox");
  var sink = document.getElementById("sink");
  var caretHint = document.getElementById("caretHint");
  var wpmEl = document.getElementById("wpm");
  var accEl = document.getElementById("acc");
  var clockEl = document.getElementById("clock");
  var clockK = document.getElementById("clockK");
  var bestEl = document.getElementById("best");
  var restartBtn = document.getElementById("restart");
  var resultEl = document.getElementById("result");
  var rWpm = document.getElementById("rWpm");
  var resultLine = document.getElementById("resultLine");
  var resultGrid = document.getElementById("resultGrid");
  var resultEyebrow = document.getElementById("resultEyebrow");
  var againBtn = document.getElementById("againBtn");
  var shareBtn = document.getElementById("shareBtn");
  var trail = document.getElementById("trail");
  var tctx = trail.getContext("2d");

  var BEST_KEY = "typing_best";
  var SECS_KEY = "typing_secs";

  var stream = [], wi = 0, typed = "";
  var running = false, done = false;
  var startAt = 0, limitMs = 60000, raf = 0;
  var correctChars = 0, insertions = 0, badInsertions = 0;
  var wordEls = [];
  var wordState = [];             // per stream index: true = typed clean, false = had errors
  var samples = [];               // {t, wpm} for the trail
  var lastKeyAt = 0;
  var keyTimes = {};              // char -> {n, ms} for "slowest keys"
  var wrongWords = 0;

  function best() {
    var v = parseFloat(localStorage.getItem(BEST_KEY) || "0");
    return isFinite(v) ? v : 0;
  }
  function setBest(v) {
    try { localStorage.setItem(BEST_KEY, String(v)); } catch (e) {}
  }

  function pick() { return WORDS[Math.floor(Math.random() * WORDS.length)]; }

  function buildStream() {
    stream = [];
    for (var i = 0; i < STREAM_LEN; i++) stream.push(pick());
  }

  function renderWords() {
    wordsEl.textContent = "";
    wordEls = [];
    // Only the visible run matters; rendering 240 words of spans is wasted DOM.
    var from = Math.max(0, wi - 6), to = Math.min(stream.length, from + 60);
    for (var i = from; i < to; i++) {
      var w = document.createElement("span");
      w.className = "w";
      var text = stream[i] + (i < stream.length - 1 ? " " : "");
      for (var c = 0; c < text.length; c++) {
        var ch = document.createElement("span");
        ch.className = "ch" + (text[c] === " " ? " sp" : "");
        ch.textContent = text[c];
        w.appendChild(ch);
      }
      wordsEl.appendChild(w);
      wordEls[i] = w;
      // Re-render throws away the DOM, so already-typed words must be restored
      // from state or the whole run behind the caret goes blank grey again.
      if (i < wi && wordState[i] !== undefined) markCommitted(i, wordState[i]);
    }
    paint();
  }

  /* Repaint only the active word — the committed ones never change again, and
   * repainting the whole block on every keystroke is what makes naive versions
   * of this feel laggy. */
  function paint() {
    var w = wordEls[wi];
    if (!w) return;
    var target = stream[wi] + (wi < stream.length - 1 ? " " : "");
    var chars = w.children;
    for (var i = 0; i < chars.length; i++) {
      var el = chars[i];
      el.className = "ch" + (target[i] === " " ? " sp" : "");
      if (i < typed.length) el.className += typed[i] === target[i] ? " ok" : " bad";
      else if (i === typed.length) el.className += " cur";
    }
    // typed past the end of the word: mark the tail as wrong without adding DOM
    if (typed.length > target.length && chars.length) {
      chars[chars.length - 1].className = "ch bad";
    }
  }

  function markCommitted(idx, ok) {
    var w = wordEls[idx];
    if (!w) return;
    var target = stream[idx] + " ";
    for (var i = 0; i < w.children.length; i++) {
      var el = w.children[i];
      el.className = "ch" + (target[i] === " " ? " sp" : "") + (ok ? " ok" : " bad");
    }
  }

  function elapsed() { return running ? Date.now() - startAt : 0; }

  function liveWpm() {
    var mins = elapsed() / 60000;
    if (mins <= 0) return 0;
    return Math.max(0, Math.round((correctChars / 5) / mins));
  }

  function accuracy() {
    if (!insertions) return 100;
    return Math.max(0, Math.round(((insertions - badInsertions) / insertions) * 100));
  }

  function start() {
    if (running || done) return;
    running = true;
    startAt = Date.now();
    lastKeyAt = startAt;
    caretHint.hidden = true;
    clockK.textContent = "Time left";
    tick();
    try { if (typeof window.gtag === "function") window.gtag("event", "toy_start", { toy: "typing-speed" }); } catch (e) {}
  }

  function tick() {
    if (!running) return;
    var left = Math.max(0, limitMs - elapsed());
    clockEl.textContent = Math.ceil(left / 1000);
    var w = liveWpm();
    wpmEl.textContent = w;
    wpmEl.className = "hud__v" + (w >= best() && best() > 0 ? " is-hot" : "");
    var a = accuracy();
    accEl.textContent = a + "%";
    accEl.className = "hud__v" + (a < 90 ? " is-low" : "");

    var t = elapsed();
    if (!samples.length || t - samples[samples.length - 1].t > 400) {
      samples.push({ t: t, wpm: w });
      drawTrail();
    }

    if (left <= 0) { finish(); return; }
    raf = requestAnimationFrame(tick);
  }

  function finish() {
    running = false; done = true;
    cancelAnimationFrame(raf);
    sink.blur();

    var mins = limitMs / 60000;
    var wpm = Math.max(0, Math.round((correctChars / 5) / mins));
    var acc = accuracy();
    wpmEl.textContent = wpm;
    clockEl.textContent = "0";

    var prev = best(), isPb = wpm > prev;
    if (isPb) { setBest(wpm); }
    bestEl.textContent = best() ? best() : "—";

    rWpm.textContent = wpm;
    resultEyebrow.textContent = isPb ? "New personal best" : "Time";
    resultLine.textContent = phraseFor(wpm) +
      (isPb && prev > 0 ? " That beats your old best of " + prev + "." : "");

    resultGrid.textContent = "";
    addStat(acc + "%", "Accuracy");
    addStat(String(correctChars), "Correct chars");
    addStat(String(badInsertions), "Mistakes");
    addStat(String(wrongWords), "Bad words");

    var slow = slowestKeys();
    if (slow) addStat(slow.keys, "Slowest keys");

    resultEl.hidden = false;
    drawTrail();

    try {
      if (typeof window.gtag === "function") {
        window.gtag("event", "toy_complete", { toy: "typing-speed", value: wpm });
      }
    } catch (e) {}
  }

  function addStat(v, k) {
    var d = document.createElement("div");
    d.className = "rstat";
    var b = document.createElement("b"); b.textContent = v;
    var s = document.createElement("span"); s.textContent = k;
    d.appendChild(b); d.appendChild(s);
    resultGrid.appendChild(d);
  }

  /* The characters that cost the most time. Only letters with a few samples
   * qualify — one unlucky pause on a rare letter would otherwise top the list
   * every run and mean nothing. */
  function slowestKeys() {
    var out = [];
    Object.keys(keyTimes).forEach(function (c) {
      var r = keyTimes[c];
      if (r.n >= 4 && /[a-z]/.test(c)) out.push({ c: c, avg: r.ms / r.n });
    });
    if (out.length < 3) return null;
    out.sort(function (a, b) { return b.avg - a.avg; });
    return { keys: out.slice(0, 3).map(function (o) { return o.c; }).join(" ") };
  }

  function phraseFor(w) {
    if (w >= 100) return "That is professional-transcriptionist territory.";
    if (w >= 80) return "Well above average — you touch-type properly.";
    if (w >= 60) return "Comfortably above the ~40 wpm average.";
    if (w >= 40) return "Right around the average for an adult typist.";
    if (w >= 20) return "Steady. Accuracy first, speed follows.";
    return "Everyone starts here. Try a shorter run and build up.";
  }

  // ------------------------------------------------------------------ trail

  function drawTrail() {
    var r = trail.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    trail.width = Math.max(2, Math.round(r.width * dpr));
    trail.height = Math.max(2, Math.round(r.height * dpr));
    var W = trail.width, H = trail.height;
    tctx.clearRect(0, 0, W, H);

    var cs = getComputedStyle(document.documentElement);
    var accent = cs.getPropertyValue("--accent").trim() || "#3aa76d";
    var line = cs.getPropertyValue("--line").trim() || "#e3e9f1";

    // baseline
    tctx.strokeStyle = line;
    tctx.lineWidth = Math.max(1, dpr);
    tctx.beginPath(); tctx.moveTo(0, H - dpr); tctx.lineTo(W, H - dpr); tctx.stroke();

    if (samples.length < 2) return;

    var peak = 0;
    samples.forEach(function (s) { if (s.wpm > peak) peak = s.wpm; });
    peak = Math.max(40, peak * 1.15);

    function px(s) { return (s.t / limitMs) * W; }
    function py(s) { return H - (s.wpm / peak) * (H * 0.86) - H * 0.07; }

    // filled area under the curve
    tctx.beginPath();
    tctx.moveTo(px(samples[0]), H);
    samples.forEach(function (s) { tctx.lineTo(px(s), py(s)); });
    tctx.lineTo(px(samples[samples.length - 1]), H);
    tctx.closePath();
    var g = tctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, hexA(accent, 0.30));
    g.addColorStop(1, hexA(accent, 0.02));
    tctx.fillStyle = g;
    tctx.fill();

    tctx.beginPath();
    samples.forEach(function (s, i) { i ? tctx.lineTo(px(s), py(s)) : tctx.moveTo(px(s), py(s)); });
    tctx.strokeStyle = accent;
    tctx.lineWidth = Math.max(1.5, dpr * 1.4);
    tctx.lineJoin = "round";
    tctx.stroke();
  }

  // accent comes from CSS as hex; alpha-blend without pulling in a colour lib
  function hexA(hex, a) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
    if (!m) return "rgba(58,167,109," + a + ")";
    return "rgba(" + parseInt(m[1], 16) + "," + parseInt(m[2], 16) + "," + parseInt(m[3], 16) + "," + a + ")";
  }

  // ------------------------------------------------------------------ input

  sink.addEventListener("input", function () {
    if (done) { sink.value = ""; return; }
    var v = sink.value;

    // a space commits the word
    if (v.indexOf(" ") >= 0) {
      var beforeSpace = v.slice(0, v.indexOf(" "));
      typed = beforeSpace;
      commitWord();
      sink.value = "";
      return;
    }

    if (v.length > typed.length) {
      start();
      var target = stream[wi] || "";
      var now = Date.now();
      for (var i = typed.length; i < v.length; i++) {
        insertions++;
        var expected = target[i];
        var got = v[i];
        if (got !== expected) badInsertions++;
        if (expected && got === expected && /[a-z]/i.test(expected)) {
          var k = expected.toLowerCase();
          var dt = now - lastKeyAt;
          if (dt < 3000) {                      // ignore think-pauses
            if (!keyTimes[k]) keyTimes[k] = { n: 0, ms: 0 };
            keyTimes[k].n++; keyTimes[k].ms += dt;
          }
        }
        lastKeyAt = now;
      }
    }
    typed = v;
    paint();
  });

  // Space and Backspace need intercepting: space must commit even when the
  // field is empty, and backspace must not escape the current word.
  sink.addEventListener("keydown", function (e) {
    if (done) return;
    if (e.key === " ") {
      e.preventDefault();
      if (!running) start();
      if (typed.length === 0) return;           // leading space does nothing
      commitWord();
      sink.value = "";
      return;
    }
    if (e.key === "Backspace" && typed.length === 0) e.preventDefault();
    if (e.key === "Enter") e.preventDefault();
  });

  function commitWord() {
    var target = stream[wi];
    var ok = typed === target;
    if (ok) {
      correctChars += target.length + 1;        // the space counts, per the standard
    } else {
      wrongWords++;
      // partial credit: characters that were right still happened
      for (var i = 0; i < Math.min(typed.length, target.length); i++) {
        if (typed[i] === target[i]) correctChars++;
      }
    }
    insertions++;                                // the space itself is a keystroke
    wordState[wi] = ok;
    markCommitted(wi, ok);

    wi++; typed = "";
    if (wi >= stream.length - 1) { buildStream(); wi = 0; }
    if (!wordEls[wi] || wi > 40) renderWords(); else paint();
    scrollToWord();
  }

  function scrollToWord() {
    var w = wordEls[wi];
    if (!w) return;
    var boxTop = wordsEl.getBoundingClientRect().top;
    var wTop = w.getBoundingClientRect().top;
    // keep the active line near the top of the box by dropping earlier lines
    if (wTop - boxTop > wordsEl.clientHeight * 0.55) renderWords();
  }

  function focusSink() { if (!done) sink.focus({ preventScroll: true }); }
  typebox.addEventListener("pointerdown", function (e) { e.preventDefault(); focusSink(); });
  typebox.addEventListener("focus", focusSink);
  sink.addEventListener("focus", function () { typebox.classList.add("is-focus"); if (!running && !done) caretHint.hidden = true; });
  sink.addEventListener("blur", function () {
    typebox.classList.remove("is-focus");
    if (!running && !done) caretHint.hidden = false;
  });

  // ---------------------------------------------------------------- controls

  function reset(secs) {
    cancelAnimationFrame(raf);
    running = false; done = false;
    wi = 0; typed = ""; correctChars = 0; insertions = 0; badInsertions = 0;
    wrongWords = 0; samples = []; keyTimes = {}; wordState = [];
    limitMs = secs * 1000;
    sink.value = "";
    resultEl.hidden = true;
    caretHint.hidden = false;
    clockK.textContent = "Time";
    clockEl.textContent = String(secs);
    wpmEl.textContent = "0"; wpmEl.className = "hud__v";
    accEl.textContent = "100%"; accEl.className = "hud__v";
    bestEl.textContent = best() ? best() : "—";
    buildStream();
    renderWords();
    drawTrail();
  }

  var savedSecs = parseInt(localStorage.getItem(SECS_KEY) || "60", 10);
  if (![30, 60, 120].includes(savedSecs)) savedSecs = 60;

  Array.prototype.forEach.call(document.querySelectorAll(".seg__b"), function (b) {
    if (+b.dataset.secs === savedSecs) {
      document.querySelectorAll(".seg__b").forEach(function (x) { x.classList.remove("is-on"); });
      b.classList.add("is-on");
    }
    b.addEventListener("click", function () {
      document.querySelectorAll(".seg__b").forEach(function (x) { x.classList.remove("is-on"); });
      b.classList.add("is-on");
      try { localStorage.setItem(SECS_KEY, b.dataset.secs); } catch (e) {}
      reset(+b.dataset.secs);
      focusSink();
    });
  });

  restartBtn.addEventListener("click", function () { reset(limitMs / 1000); focusSink(); });
  againBtn.addEventListener("click", function () { reset(limitMs / 1000); focusSink(); });

  shareBtn.addEventListener("click", function () {
    var txt = "I typed " + rWpm.textContent + " wpm at " + accuracy() + "% accuracy on One Page Toys.";
    var url = "https://onepagetoys.com/tools/typing-speed/";
    if (navigator.share) {
      navigator.share({ text: txt, url: url }).catch(function () {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(txt + " " + url).then(function () {
        shareBtn.textContent = "Copied";
        setTimeout(function () { shareBtn.textContent = "Share result"; }, 1600);
      }).catch(function () {});
    }
    try {
      if (typeof window.gtag === "function") {
        window.gtag("event", "share", { method: "typing_speed", value: parseInt(rWpm.textContent, 10) || 0 });
      }
    } catch (e) {}
  });

  window.addEventListener("resize", drawTrail);

  reset(savedSecs);
})();
