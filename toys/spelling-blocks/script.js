/* Spelling Blocks — practice edition (a random-puzzle feeder for spellingblocks.com).
 *
 * Same game as the daily at spellingblocks.com: you get twelve lettered blocks and must sort
 * them ALL into real English words — no leftovers — and finish at or under par (the target
 * word count). This build serves an endless supply of RANDOM practice puzzles and points
 * players to the daily challenge (the same blocks for everyone, worldwide) on the real site.
 *
 * The puzzle sets come straight from the spelling-blocks repo's curated solutions (each one
 * partitions cleanly into real words, so every puzzle is guaranteed solvable). Word validation
 * uses a precomputed union dictionary in data.js: any word you can build from a tray is, by
 * construction, in that set — so checking a word is a single Set lookup. Difficulty maps to par:
 * Easy = 2 words, Medium = 3, Hard = 4. */
(function () {
  "use strict";

  var SITE = "https://spellingblocks.com";
  var DATA = window.SB_DATA || { words: [], puzzles: [] };
  var WORDSET = new Set(DATA.words);

  var COLORS = ["cobalt", "grass", "butter", "cherry"];
  var COLOR_HEX = { cobalt: "#2b59c3", grass: "#3e8a4e", butter: "#f2b63c", cherry: "#c7402d" };
  var COLOR_EMOJI = { cobalt: "🟦", grass: "🟩", butter: "🟨", cherry: "🟥" };
  var DIFFS = { easy: { par: 2, label: "Easy" }, medium: { par: 3, label: "Medium" }, hard: { par: 4, label: "Hard" } };

  // pools of puzzle indices by par
  var POOLS = { easy: [], medium: [], hard: [] };
  DATA.puzzles.forEach(function (p, i) {
    if (p.p === 2) POOLS.easy.push(i);
    else if (p.p === 3) POOLS.medium.push(i);
    else if (p.p === 4) POOLS.hard.push(i);
  });

  var REDMO = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ============================ DOM ============================ */
  var trayEl = document.getElementById("tray");
  var builderEl = document.getElementById("builder");
  var wallEl = document.getElementById("wall");
  var wallEmpty = document.getElementById("wallEmpty");
  var msgEl = document.getElementById("msg");
  var metaMode = document.getElementById("metaMode");
  var timeEl = document.getElementById("timeVal");
  var cleanBadge = document.getElementById("cleanBadge");
  var placeBtn = document.getElementById("placeBtn");
  var shuffleBtn = document.getElementById("shuffleBtn");
  var clearBtn = document.getElementById("clearBtn");
  var hintBtn = document.getElementById("hintBtn");
  var newBtn = document.getElementById("newBtn");
  var diffBtn = document.getElementById("diffBtn");
  var soundBtn = document.getElementById("soundBtn");
  var themeBtn = document.getElementById("themeBtn");
  var helpBtn = document.getElementById("helpBtn");
  var hintEl = document.getElementById("hint");
  var solved = document.getElementById("solved");
  var solvedTime = document.getElementById("solvedTime");
  var solvedSub = document.getElementById("solvedSub");
  var shareBtn = document.getElementById("shareBtn");
  var againBtn = document.getElementById("againBtn");
  var countdownEls = Array.prototype.slice.call(document.querySelectorAll(".js-countdown"));
  var toast = document.getElementById("toast");

  /* ============================ state ============================ */
  var diffKey = "medium";
  try { var d = localStorage.getItem("sb_diff"); if (d && DIFFS[d]) diffKey = d; } catch (e) {}

  var puzzle = null;       // { b, p, s }
  var letters = [];        // 12 chars
  var colors = [];         // 12 color names
  var rots = [];           // 12 resting tilts
  var stateOf = [];        // 'tray' | 'hand' | 'placed'
  var trayOrder = [];      // display order of the 12 block indices
  var hand = [];           // block indices, in build order
  var placed = [];         // [{ indices:[...], word, el }]
  var flatWave = 0;        // running index for the win wave
  var startedAt = null, won = false, lastResult = null;

  function mulberry32(seed) { var a = seed >>> 0; return function () { a = (a + 0x6d2b79f5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function assignColors(n, seed) {
    var out = []; for (var i = 0; i < n; i++) out.push(COLORS[i % COLORS.length]);
    var s = (seed * 2654435761 + 1) >>> 0;
    var rng = function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (var j = out.length - 1; j > 0; j--) { var k = Math.floor(rng() * (j + 1)); var t = out[j]; out[j] = out[k]; out[k] = t; }
    return out;
  }

  /* ============================ new puzzle ============================ */
  function newPuzzle() {
    var pool = POOLS[diffKey];
    if (!pool || !pool.length) pool = POOLS.medium;
    var idx = pool[Math.floor(Math.random() * pool.length)];
    puzzle = DATA.puzzles[idx];
    letters = puzzle.b.split("");
    var seed = Math.floor(Math.random() * 1e9);
    colors = assignColors(12, seed);
    rots = letters.map(function (_, i) { return ((i * 37 + (seed % 5)) % 5) - 2; });
    stateOf = letters.map(function () { return "tray"; });
    trayOrder = letters.map(function (_, i) { return i; });
    shuffleArr(trayOrder);
    hand = []; placed = []; flatWave = 0; startedAt = null; won = false; lastResult = null;

    metaMode.textContent = "Practice · par " + puzzle.p;
    diffBtn.textContent = DIFFS[diffKey].label;
    timeEl.textContent = "0:00";
    setBadge();
    msgEl.textContent = "";
    wallEl.querySelectorAll(".course").forEach(function (c) { c.remove(); });
    wallEl.classList.remove("won");
    wallEmpty.style.display = "";
    wallEl.appendChild(wallEmpty);
    solved.classList.add("is-hidden");
    paintTray(); paintBuilder();
    setHint("Tap blocks to spell a word · use every block · no leftovers");
  }

  function shuffleArr(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  /* ============================ block factory ============================ */
  function makeBlock(idx, cls) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "blk" + (colors[idx] === "butter" ? " is-butter" : "") + (cls ? " " + cls : "");
    b.style.setProperty("--c", COLOR_HEX[colors[idx]]);
    b.style.setProperty("--rot", rots[idx] + "deg");
    b.textContent = letters[idx];
    b.setAttribute("aria-label", "Letter " + letters[idx]);
    b.dataset.idx = idx;
    return b;
  }

  /* ============================ paint ============================ */
  function paintTray() {
    trayEl.textContent = "";
    for (var k = 0; k < trayOrder.length; k++) {
      var idx = trayOrder[k];
      if (stateOf[idx] !== "tray") continue;
      var b = makeBlock(idx, "tap");
      b.addEventListener("click", onTrayTap);
      trayEl.appendChild(b);
    }
  }
  function paintBuilder(popIdx) {
    builderEl.textContent = "";
    if (hand.length === 0) {
      var s = document.createElement("span");
      s.className = "builder__hint";
      s.textContent = "tap blocks to build a word";
      builderEl.appendChild(s);
    } else {
      for (var i = 0; i < hand.length; i++) {
        var idx = hand[i];
        var b = makeBlock(idx, idx === popIdx ? "pop" : null);
        b.dataset.pos = i;
        b.addEventListener("click", onHandTap);
        builderEl.appendChild(b);
      }
    }
    var word = handWord();
    placeBtn.disabled = won || word.length < 3;
  }
  function handWord() { return hand.map(function (i) { return letters[i]; }).join(""); }

  function wallBlockSize() {
    var maxLen = 1;
    for (var i = 0; i < placed.length; i++) maxLen = Math.max(maxLen, placed[i].indices.length);
    var avail = Math.min(wallEl.clientWidth - 28, 460);
    return Math.max(30, Math.min(52, Math.floor(avail / maxLen) - 4));
  }
  function refreshWallSize() { wallEl.style.setProperty("--wbs", wallBlockSize() + "px"); }

  function appendCourse(course) {
    wallEmpty.style.display = "none";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "course";
    var wi = course.indices.map(function () { return -1; });
    for (var i = 0; i < course.indices.length; i++) {
      var idx = course.indices[i];
      var b = makeBlock(idx, null);
      b.style.setProperty("--wi", flatWave++);
      wi[i] = idx;
      btn.appendChild(b);
    }
    btn.setAttribute("aria-label", "Break " + course.word);
    btn.addEventListener("click", function () { breakCourse(course); });
    course.el = btn;
    wallEl.appendChild(btn);
    refreshWallSize();
  }

  /* ============================ interaction ============================ */
  function onTrayTap(e) {
    if (won) return;
    var idx = +e.currentTarget.dataset.idx;
    if (stateOf[idx] !== "tray") return;
    startClock();
    stateOf[idx] = "hand";
    hand.push(idx);
    ensureAudio(); clack(1 + Math.min(hand.length, 8) * 0.05);
    paintTray(); paintBuilder(idx);
    msgEl.textContent = "";
  }
  function onHandTap(e) {
    if (won) return;
    var pos = +e.currentTarget.dataset.pos;
    var idx = hand[pos];
    hand.splice(pos, 1);
    stateOf[idx] = "tray";
    ensureAudio(); tick(1.25);
    paintTray(); paintBuilder();
    msgEl.textContent = "";
  }
  function doPlace() {
    if (won) return;
    var word = handWord();
    if (word.length < 3) return;
    if (!WORDSET.has(word)) {
      builderEl.classList.remove("shake"); void builderEl.offsetWidth; builderEl.classList.add("shake");
      msgEl.textContent = word.length < 3 ? "Three letters or more" : "Not a word we know";
      ensureAudio(); invalid();
      clearTimeout(msgTimer); msgTimer = setTimeout(function () { msgEl.textContent = ""; }, 1400);
      return;
    }
    var course = { indices: hand.slice(), word: word };
    for (var i = 0; i < course.indices.length; i++) stateOf[course.indices[i]] = "placed";
    placed.push(course);
    hand = [];
    ensureAudio(); placeSnd();
    appendCourse(course);
    paintTray(); paintBuilder();
    msgEl.textContent = "";
    checkWin();
  }
  var msgTimer = null;
  function breakCourse(course) {
    if (won) return;
    var i = placed.indexOf(course);
    if (i < 0) return;
    placed.splice(i, 1);
    for (var j = 0; j < course.indices.length; j++) stateOf[course.indices[j]] = "tray";
    if (course.el) course.el.remove();
    // rebuild flat wave counter so it stays contiguous
    flatWave = 0;
    wallEl.querySelectorAll(".course .blk").forEach(function (b) { b.style.setProperty("--wi", flatWave++); });
    if (placed.length === 0) { wallEmpty.style.display = ""; wallEl.appendChild(wallEmpty); }
    ensureAudio(); tick(0.9);
    refreshWallSize(); paintTray(); paintBuilder();
  }
  function doClear() {
    if (won || hand.length === 0) return;
    for (var i = 0; i < hand.length; i++) stateOf[hand[i]] = "tray";
    hand = [];
    ensureAudio(); tick(1.1);
    paintTray(); paintBuilder();
    msgEl.textContent = "";
  }
  function doShuffle() {
    shuffleArr(trayOrder);
    ensureAudio(); clack(0.85);
    paintTray();
  }
  function addByLetter(ch) {
    if (won) return;
    ch = ch.toUpperCase();
    for (var k = 0; k < trayOrder.length; k++) {
      var idx = trayOrder[k];
      if (stateOf[idx] === "tray" && letters[idx] === ch) {
        startClock();
        stateOf[idx] = "hand"; hand.push(idx);
        ensureAudio(); clack(1 + Math.min(hand.length, 8) * 0.05);
        paintTray(); paintBuilder(idx); msgEl.textContent = "";
        return;
      }
    }
  }

  shuffleBtn.addEventListener("click", doShuffle);
  clearBtn.addEventListener("click", doClear);
  placeBtn.addEventListener("click", doPlace);
  hintBtn.addEventListener("click", doHint);
  newBtn.addEventListener("click", newPuzzle);
  diffBtn.addEventListener("click", function () {
    var order = ["easy", "medium", "hard"];
    diffKey = order[(order.indexOf(diffKey) + 1) % order.length];
    try { localStorage.setItem("sb_diff", diffKey); } catch (e) {}
    newPuzzle();
  });

  // keyboard
  window.addEventListener("keydown", function (e) {
    if (!solved.classList.contains("is-hidden")) return;
    if (!document.getElementById("intro").hidden) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Enter") { e.preventDefault(); doPlace(); }
    else if (e.key === "Backspace") { e.preventDefault(); if (hand.length) { var idx = hand.pop(); stateOf[idx] = "tray"; ensureAudio(); tick(1.25); paintTray(); paintBuilder(); } }
    else if (/^[a-zA-Z]$/.test(e.key)) { addByLetter(e.key); }
  });

  /* ============================ hint (peek) ============================ */
  function availIndices() { var out = []; for (var i = 0; i < 12; i++) if (stateOf[i] === "tray") out.push(i); return out; }
  function canForm(word, availLetters) {
    var cnt = {};
    for (var i = 0; i < availLetters.length; i++) cnt[availLetters[i]] = (cnt[availLetters[i]] || 0) + 1;
    for (var j = 0; j < word.length; j++) { var c = word[j]; if (!cnt[c]) return false; cnt[c]--; }
    return true;
  }
  function findHintWord() {
    var avail = availIndices();
    if (avail.length < 3) return null;
    var availLetters = avail.map(function (i) { return letters[i]; });
    // 1) an intended solution word that's still fully available and not already placed
    var placedWords = placed.map(function (c) { return c.word; });
    for (var s = 0; s < puzzle.s.length; s++) {
      var w = puzzle.s[s];
      if (placedWords.indexOf(w) >= 0) continue;
      if (w.length <= availLetters.length && canForm(w, availLetters)) return w;
    }
    // 2) longest word makeable from the available letters (scan the union dictionary)
    var best = null;
    for (var d = 0; d < DATA.words.length; d++) {
      var word = DATA.words[d];
      if (word.length < 3 || word.length > availLetters.length) continue;
      if (best && word.length <= best.length) continue;
      if (canForm(word, availLetters)) best = word;
    }
    return best;
  }
  function doHint() {
    if (won) return;
    var w = findHintWord();
    if (!w) { showToast("No word left in the tray — break a word to free some blocks."); return; }
    // map the word onto specific available tray blocks and pulse them
    var avail = availIndices(), usedm = {}, targets = [];
    for (var i = 0; i < w.length; i++) {
      var ch = w[i], found = -1;
      for (var k = 0; k < avail.length; k++) { var idx = avail[k]; if (usedm[idx]) continue; if (letters[idx] === ch) { found = idx; break; } }
      if (found < 0) break; usedm[found] = true; targets.push(found);
    }
    ensureAudio(); hintSnd();
    var pulsed = 0;
    trayEl.querySelectorAll(".blk").forEach(function (b) {
      if (targets.indexOf(+b.dataset.idx) >= 0) { b.classList.remove("hintpulse"); void b.offsetWidth; b.classList.add("hintpulse"); pulsed++; }
    });
    setHint("Hint: you can spell a " + w.length + "-letter word");
  }

  /* ============================ clock ============================ */
  var clockId = null;
  function startClock() {
    if (startedAt === null) startedAt = Date.now();
    if (clockId) return;
    clockId = setInterval(function () { if (startedAt === null || won) return; timeEl.textContent = fmtTime(Math.floor((Date.now() - startedAt) / 1000)); }, 250);
  }
  function fmtTime(s) { var m = Math.floor(s / 60); return m + ":" + String(s % 60).padStart(2, "0"); }

  function setBadge() {
    var wc = placed.length;
    if (won && wc <= puzzle.p) { cleanBadge.textContent = wc < puzzle.p ? "Under par" : "Clean"; cleanBadge.className = "badge clean"; return; }
    cleanBadge.textContent = wc + "/" + puzzle.p + " words";
    cleanBadge.className = wc <= puzzle.p ? "badge clean" : "badge";
  }

  /* ============================ win ============================ */
  function checkWin() {
    setBadge();
    var placedCount = 0;
    for (var i = 0; i < 12; i++) if (stateOf[i] === "placed") placedCount++;
    if (placedCount !== 12) return;
    won = true;
    placeBtn.disabled = true;
    var secs = startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0;
    timeEl.textContent = fmtTime(secs);
    setBadge();
    wallEl.classList.add("won");
    winSnd();
    burstConfetti();
    var wc = placed.length, clean = wc <= puzzle.p;
    var best = 0, solves = 0;
    try { best = parseInt(localStorage.getItem("sb_best_" + diffKey) || "0", 10) || 0; } catch (e) {}
    try { solves = parseInt(localStorage.getItem("sb_solves") || "0", 10) || 0; } catch (e) {}
    solves += 1;
    var isBest = best === 0 || secs < best; if (isBest) best = secs;
    try { localStorage.setItem("sb_best_" + diffKey, String(best)); localStorage.setItem("sb_solves", String(solves)); } catch (e) {}
    lastResult = { secs: secs, words: wc, clean: clean, underPar: wc < puzzle.p, isBest: isBest };
    setTimeout(showSolved, REDMO ? 250 : 1400);
  }
  function showSolved() {
    if (!lastResult) return;
    updateNudge();
    solvedTime.textContent = fmtTime(lastResult.secs);
    var bits = [DIFFS[diffKey].label + " · " + lastResult.words + " word" + (lastResult.words === 1 ? "" : "s")];
    if (lastResult.underPar) bits.push("under par 🎯");
    else if (lastResult.clean) bits.push("clean solve ✨");
    if (lastResult.isBest) bits.push("new best!");
    solvedSub.textContent = bits.join(" · ");
    solved.classList.remove("is-hidden");
  }

  /* ============================ share ============================ */
  function shareText() {
    var rows = placed.map(function (c) {
      return c.indices.map(function (i) { return COLOR_EMOJI[colors[i]]; }).join("");
    }).join("\n");
    var t = lastResult ? fmtTime(lastResult.secs) : "";
    var wc = lastResult ? lastResult.words : placed.length;
    return "Spelling Blocks (practice)\n" + rows + "\n" + wc + " words in " + t +
      "\nPlay today's daily against everyone → " + SITE + "/?utm_source=onepagetoys&utm_medium=share";
  }
  shareBtn.addEventListener("click", function () {
    var txt = shareText();
    if (navigator.share) { navigator.share({ text: txt }).catch(function () {}); }
    else if (navigator.clipboard) { navigator.clipboard.writeText(txt).then(function () { showToast("Copied — paste it anywhere"); }, function () { showToast(txt); }); }
    else { showToast(txt); }
    if (window.gtag) try { gtag("event", "share", { method: "blocks_feeder" }); } catch (e) {}
  });
  againBtn.addEventListener("click", newPuzzle);

  var toastId = null;
  function showToast(msg) { toast.textContent = msg; toast.classList.add("show"); if (toastId) clearTimeout(toastId); toastId = setTimeout(function () { toast.classList.remove("show"); }, 2800); }

  /* ============================ countdown to next daily ============================ */
  function tickCountdown() {
    var now = new Date(); var next = new Date(now); next.setHours(24, 0, 0, 0);
    var total = Math.max(0, Math.floor((next.getTime() - now.getTime()) / 1000));
    var h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    var str = String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    countdownEls.forEach(function (e) { e.textContent = str; });
  }
  tickCountdown(); setInterval(tickCountdown, 1000);

  /* ============================ outbound tracking + nudge ============================ */
  ["dailyCta", "solvedCta"].forEach(function (id) {
    var a = document.getElementById(id);
    if (a) a.addEventListener("click", function () { if (window.gtag) try { gtag("event", "outbound_click", { destination: "spellingblocks.com", link_id: id }); } catch (e) {} });
  });
  var ctaMain = document.querySelector(".daily-cta__main");
  var ctaGo = document.querySelector(".daily-cta__go");
  var solvedCtaLabel = document.getElementById("solvedCtaLabel");
  var solvedCtaSub = document.getElementById("solvedCtaSub");
  function solveCount() { try { return parseInt(localStorage.getItem("sb_solves") || "0", 10) || 0; } catch (e) { return 0; } }
  function updateNudge() {
    if (solveCount() >= 3) {
      if (ctaMain) ctaMain.textContent = "You've got the hang of it — the daily builds a streak";
      if (ctaGo) ctaGo.innerHTML = "Start&nbsp;→";
      if (solvedCtaLabel) solvedCtaLabel.textContent = "Start your daily streak →";
      if (solvedCtaSub) solvedCtaSub.textContent = "practice doesn't count — the daily does";
    } else {
      if (ctaMain) ctaMain.textContent = "Today's daily — same blocks, everyone, worldwide";
      if (ctaGo) ctaGo.innerHTML = "Play&nbsp;→";
      if (solvedCtaLabel) solvedCtaLabel.textContent = "Play today's daily against everyone →";
      if (solvedCtaSub) solvedCtaSub.textContent = "same blocks worldwide";
    }
  }

  /* ============================ hint line ============================ */
  var hintTimer = null;
  function setHint(t) { hintEl.textContent = t; hintEl.classList.remove("is-gone"); if (hintTimer) clearTimeout(hintTimer); hintTimer = setTimeout(function () { hintEl.classList.add("is-gone"); }, 5200); }

  /* ============================ theme ============================ */
  function applyTheme(mode) {
    var dark = mode === "dark" || (mode === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    themeBtn.textContent = dark ? "☾" : "☀";
  }
  var themeMode = "system";
  try { var tm = localStorage.getItem("opt-theme"); if (tm === "light" || tm === "dark" || tm === "system") themeMode = tm; } catch (e) {}
  themeBtn.addEventListener("click", function () {
    themeMode = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    try { localStorage.setItem("opt-theme", themeMode); } catch (e) {}
    applyTheme(themeMode);
  });
  applyTheme(themeMode);

  /* ============================ audio ============================ */
  var AC = null, bus = null, reverb = null, revGain = null, audioOn = true;
  try { audioOn = localStorage.getItem("sb_sound") !== "off"; } catch (e) {}
  function makeIR(seconds, decay) {
    var rate = AC.sampleRate, len = Math.floor(rate * seconds);
    var buf = AC.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var data = buf.getChannelData(ch), last = 0;
      for (var i = 0; i < len; i++) {
        var white = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
        last = (last + 0.24 * white) / 1.24; // lowpass so the tail is smooth, not grainy
        data[i] = last * 3.2;
      }
    }
    return buf;
  }
  function ensureAudio() {
    if (AC) { if (AC.state === "suspended") AC.resume(); return; }
    var Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
    AC = new Ctx();
    try { var b = AC.createBuffer(1, 1, 22050), s = AC.createBufferSource(); s.buffer = b; s.connect(AC.destination); s.start(0); } catch (e) {}
    var comp = AC.createDynamicsCompressor(); comp.threshold.value = -15; comp.ratio.value = 3; comp.attack.value = 0.003; comp.release.value = 0.16;
    var master = AC.createBiquadFilter(); master.type = "lowpass"; master.frequency.value = 12000;
    bus = AC.createGain(); bus.gain.value = audioOn ? 0.9 : 0.0001;
    bus.connect(comp); comp.connect(master); master.connect(AC.destination);
    reverb = AC.createConvolver(); reverb.buffer = makeIR(1.1, 3.0);
    revGain = AC.createGain(); revGain.gain.value = 0.5;
    reverb.connect(revGain); revGain.connect(comp);
    if (AC.state === "suspended") AC.resume();
  }
  function noise(dur, freq, q, vol, sendRev) {
    if (!AC || !bus || !audioOn) return;
    var now = AC.currentTime, len = Math.max(1, Math.floor(AC.sampleRate * dur));
    var buf = AC.createBuffer(1, len, AC.sampleRate), dd = buf.getChannelData(0);
    for (var i = 0; i < len; i++) dd[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = AC.createBufferSource(); src.buffer = buf;
    var bp = AC.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = freq; bp.Q.value = q;
    var g = AC.createGain(); g.gain.value = vol;
    src.connect(bp); bp.connect(g); g.connect(bus); if (sendRev && reverb) g.connect(reverb);
    src.start(now); src.stop(now + dur + 0.02);
  }
  function tone(freq, dur, type, vol, glideTo, sendRev) {
    if (!AC || !bus || !audioOn) return;
    var now = AC.currentTime;
    var o = AC.createOscillator(); o.type = type || "sine"; o.frequency.setValueAtTime(freq, now);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, now + dur);
    var g = AC.createGain(); g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol, now + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g); g.connect(bus); if (sendRev && reverb) g.connect(reverb);
    o.start(now); o.stop(now + dur + 0.02);
  }
  // wooden toy-block knock: broadband contact tick + a short resonant woody body
  function clack(pitch) {
    pitch = pitch || 1;
    noise(0.014, 2100, 0.8, 0.12, false);
    tone(210 * pitch, 0.075, "triangle", 0.13, 90 * pitch, false);
    tone(150 * pitch, 0.05, "sine", 0.05, 110 * pitch, false);
  }
  function tick(pitch) { pitch = pitch || 1; noise(0.01, 2600 * pitch, 1.1, 0.07, false); tone(300 * pitch, 0.04, "triangle", 0.05); }
  // a word set into the wall: a firmer double-knock with a touch of room
  function placeSnd() {
    noise(0.02, 1500, 0.7, 0.14, true);
    tone(150, 0.12, "triangle", 0.16, 82, true);
    tone(96, 0.16, "sine", 0.08, 60, true);
    setTimeout(function () { noise(0.014, 1300, 0.7, 0.08, true); tone(130, 0.08, "triangle", 0.08, 78, true); }, 55);
  }
  function invalid() { tone(150, 0.16, "sawtooth", 0.09, 96, false); tone(120, 0.14, "sine", 0.07, 80, false); }
  function hintSnd() { tone(880, 0.5, "sine", 0.06, null, true); tone(1320, 0.45, "sine", 0.035, null, true); }
  function winSnd() {
    if (!AC || !bus || !audioOn) return;
    var arp = [0, 4, 7, 12, 16];
    arp.forEach(function (semi, i) {
      setTimeout(function () {
        var f = 392 * Math.pow(2, semi / 12);
        tone(f, 0.7, "triangle", 0.15, null, true);
        tone(f * 2, 0.5, "sine", 0.045, null, true);
      }, i * 95);
    });
  }
  function setSound(on) {
    audioOn = on;
    soundBtn.setAttribute("aria-pressed", on ? "true" : "false");
    soundBtn.textContent = on ? "♪" : "♪̸";
    try { localStorage.setItem("sb_sound", on ? "on" : "off"); } catch (e) {}
    if (on) { ensureAudio(); if (bus) bus.gain.setTargetAtTime(0.9, AC.currentTime, 0.05); }
    else if (bus) bus.gain.setTargetAtTime(0.0001, AC.currentTime, 0.05);
  }
  soundBtn.addEventListener("click", function () { setSound(!audioOn); });
  soundBtn.setAttribute("aria-pressed", audioOn ? "true" : "false");
  soundBtn.textContent = audioOn ? "♪" : "♪̸";

  /* ============================ confetti ============================ */
  var confCanvas = document.getElementById("confetti");
  var confCtx = confCanvas ? confCanvas.getContext("2d") : null;
  var confParts = [], confRAF = null, confLast = 0;
  function sizeConfetti() { if (!confCanvas) return; var d = Math.min(window.devicePixelRatio || 1, 2); confCanvas.width = window.innerWidth * d; confCanvas.height = window.innerHeight * d; confCtx.setTransform(d, 0, 0, d, 0, 0); }
  window.addEventListener("resize", function () { sizeConfetti(); if (placed.length) refreshWallSize(); }); sizeConfetti();
  function burstConfetti() {
    if (!confCtx || REDMO) return;
    var cxp = window.innerWidth / 2, cyp = window.innerHeight * 0.42;
    var cols = ["#2b59c3", "#3e8a4e", "#f2b63c", "#c7402d", "#eceef1"];
    for (var i = 0; i < 150; i++) {
      var a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 9.5;
      confParts.push({ x: cxp + (Math.random() - 0.5) * 90, y: cyp, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 7 - Math.random() * 4, w: 6 + Math.random() * 7, h: 8 + Math.random() * 9, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4, col: cols[i % cols.length], life: 1 });
    }
    if (!confRAF) { confLast = 0; confRAF = requestAnimationFrame(confFrame); }
  }
  function confFrame(ts) {
    var dt = confLast ? Math.min((ts - confLast) / 16.67, 2) : 1; confLast = ts;
    confCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (var i = confParts.length - 1; i >= 0; i--) {
      var p = confParts[i];
      p.vy += 0.28 * dt; p.vx *= 0.99; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.life -= 0.006 * dt;
      if (p.y > window.innerHeight + 30 || p.life <= 0) { confParts.splice(i, 1); continue; }
      confCtx.save(); confCtx.translate(p.x, p.y); confCtx.rotate(p.rot);
      confCtx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.4));
      confCtx.fillStyle = p.col; confCtx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); confCtx.restore();
    }
    if (confParts.length) confRAF = requestAnimationFrame(confFrame);
    else { confRAF = null; confLast = 0; confCtx.clearRect(0, 0, window.innerWidth, window.innerHeight); }
  }

  /* ============================ how-to intro ============================ */
  var introEl = document.getElementById("intro");
  var introBtn = document.getElementById("introBtn");
  function showIntro() { introEl.hidden = false; }
  function hideIntro() { introEl.hidden = true; try { localStorage.setItem("sb_seen", "1"); } catch (e) {} }
  introBtn.addEventListener("click", hideIntro);
  helpBtn.addEventListener("click", showIntro);

  /* ============================ boot ============================ */
  newPuzzle();
  updateNudge();
  var seen = false; try { seen = localStorage.getItem("sb_seen") === "1"; } catch (e) {}
  if (!seen) showIntro();
})();
