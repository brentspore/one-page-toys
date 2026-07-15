/* Magic 8-Ball — shake the glossy sphere; the window clouds over, then the blue
 * triangle surfaces with a (fair) answer. Optional soft thunk.
 */
(function () {
  "use strict";

  var ANSWERS = [
    "It is certain", "Without a doubt", "Yes, definitely", "You may rely on it",
    "As I see it, yes", "Most likely", "Outlook good", "Signs point to yes", "Yes",
    "Reply hazy, try again", "Ask again later", "Better not tell you now",
    "Cannot predict now", "Concentrate and ask again",
    "Don't count on it", "My reply is no", "My sources say no",
    "Outlook not so good", "Very doubtful", "Absolutely not",
    "Ship it", "Sleep on it", "Trust your gut", "The Wi-Fi knows", "Try snacks first"
  ];

  var ball = document.getElementById("ball");
  var answerEl = document.getElementById("answer");
  var statusEl = document.getElementById("status");
  var questionEl = document.getElementById("question");
  var hint = document.getElementById("hint");
  if (!ball) return;

  var reduceMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var busy = false;
  var last = -1;
  var actx = null;

  function pick() {
    var a = new Uint32Array(1);
    var idx;
    do {
      try { crypto.getRandomValues(a); } catch (e) { a[0] = Math.floor(Math.random() * 0xffffffff); }
      idx = a[0] % ANSWERS.length;
    } while (idx === last && ANSWERS.length > 1);
    last = idx;
    return ANSWERS[idx];
  }

  function thunk() {
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === "suspended") actx.resume();
      var now = actx.currentTime;
      // low body — the dull knock of the die surfacing through the liquid
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(150, now);
      o.frequency.exponentialRampToValueAtTime(68, now + 0.22);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.18, now + 0.018);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
      o.connect(g).connect(actx.destination);
      o.start(now); o.stop(now + 0.34);
      // soft contact transient — a muffled lowpassed noise thud
      var n = Math.floor(actx.sampleRate * 0.05), buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      var src = actx.createBufferSource(); src.buffer = buf;
      var lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 420;
      var ng = actx.createGain();
      ng.gain.setValueAtTime(0.16, now);
      ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
      src.connect(lp); lp.connect(ng); ng.connect(actx.destination);
      src.start(now); src.stop(now + 0.1);
    } catch (e) { /* ignore */ }
  }

  function ask() {
    if (busy) return;
    busy = true;
    if (hint && !hint.classList.contains("is-hidden")) hint.classList.add("is-hidden");

    document.body.classList.remove("is-revealing");
    document.body.classList.add("is-clouding");
    statusEl.textContent = "Shaking…";
    if (!reduceMotion) {
      ball.classList.remove("shake");
      void ball.offsetWidth;
      ball.classList.add("shake");
    }
    thunk();

    var wait = reduceMotion ? 220 : 640;
    setTimeout(function () {
      answerEl.textContent = pick();
      fitAnswer();
      // Float up at a slightly different angle each time (kept small so text stays readable).
      var tilt = (Math.random() * 26 - 13).toFixed(1);
      if (Math.abs(tilt) < 3) tilt = tilt < 0 ? -3 : 3;
      answerEl.parentNode.style.setProperty("--rot", tilt + "deg");
      document.body.classList.remove("is-clouding");
      document.body.classList.add("is-revealing");
      var q = (questionEl.value || "").trim();
      statusEl.textContent = q ? "“" + q + "”" : "Ask again anytime.";
      ball.classList.remove("shake");
      busy = false;
    }, wait);
  }

  // Shrink the answer until it fits inside the triangle's lower wide area.
  function fitAnswer() {
    var tri = answerEl.parentNode;
    var maxH = tri.clientHeight * 0.42;
    var size = Math.max(11, Math.min(22, tri.clientWidth * 0.13));
    answerEl.style.fontSize = size + "px";
    var guard = 0;
    while ((answerEl.scrollHeight > maxH || answerEl.scrollWidth > answerEl.clientWidth + 1) && size > 8 && guard < 60) {
      size -= 0.5;
      answerEl.style.fontSize = size + "px";
      guard++;
    }
  }
  window.addEventListener("resize", fitAnswer);

  ball.addEventListener("click", ask);
  window.addEventListener("keydown", function (e) {
    if (e.code === "Space" || e.code === "Enter") {
      if (document.activeElement === questionEl) {
        if (e.code !== "Enter") return;
      }
      e.preventDefault();
      ask();
    }
  });
})();
