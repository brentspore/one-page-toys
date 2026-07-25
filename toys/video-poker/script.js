/* Video Poker — No. 095
 * Jacks or Better, 9/6 paytable. Cards, felt and paytable are drawn on the
 * canvas; the three machine buttons are real DOM so they focus properly.
 * Vanilla Canvas 2D + Web Audio. Self-contained. Play credits only.
 * localStorage: "vp_bank" (current credits), "vp_best" (highest bank reached). */
(function () {
  "use strict";

  var TAU = Math.PI * 2;

  // ---------------------------------------------------------------- elements
  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var controls = document.getElementById("controls");
  var betBtn = document.getElementById("betBtn");
  var maxBtn = document.getElementById("maxBtn");
  var dealBtn = document.getElementById("dealBtn");
  var overlay = document.getElementById("overlay");
  var ovEyebrow = document.getElementById("ovEyebrow");
  var ovTitle = document.getElementById("ovTitle");
  var ovText = document.getElementById("ovText");
  var ovBtn = document.getElementById("ovBtn");
  var ovKeys = document.getElementById("ovKeys");
  var soundBtn = document.getElementById("soundBtn");

  var REDMO = false;
  try { REDMO = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

  // ------------------------------------------------------------------- cards
  var SUITS = ["♠", "♥", "♦", "♣"];   // spade heart diamond club
  var RED = [false, true, true, false];
  var RANKS = { 2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9", 10: "10", 11: "J", 12: "Q", 13: "K", 14: "A" };

  var PAY = [
    { k: "royal", n: "Royal flush", p: 250 },
    { k: "sf", n: "Straight flush", p: 50 },
    { k: "quads", n: "Four of a kind", p: 25 },
    { k: "fh", n: "Full house", p: 9 },
    { k: "flush", n: "Flush", p: 6 },
    { k: "straight", n: "Straight", p: 4 },
    { k: "trips", n: "Three of a kind", p: 3 },
    { k: "twopair", n: "Two pair", p: 2 },
    { k: "jacks", n: "Jacks or better", p: 1 }
  ];

  // ------------------------------------------------------------------- state
  var state = "menu";     // menu | bet | dealing | hold | drawing | result
  var deck = [], hand = [], held = [false, false, false, false, false];
  var winCards = [];
  var bank = 200, bet = 5, best = 0, lastWin = 0;
  var result = null;
  var msg = "";
  var anim = 0;           // deal/draw animation clock
  var payAnim = 0, payLeft = 0, payTick = 0;
  var glow = 0, coins = [];

  var dpr = 1, W = 0, H = 0;
  var cardW = 0, cardH = 0, cardY = 0, cardX0 = 0, gap = 0;
  var ptTop = 0, ptRow = 0, ptW = 0, ptX = 0;
  var msgY = 0, stripY = 0;
  var last = 0;

  // ------------------------------------------------------------ persistence
  var soundOn = true;
  try { bank = parseInt(localStorage.getItem("vp_bank") || "200", 10); if (!isFinite(bank) || bank < 0) bank = 200; } catch (e) {}
  try { best = parseInt(localStorage.getItem("vp_best") || "0", 10) || 0; } catch (e) {}
  try { if (localStorage.getItem("vp_sound") === "0") soundOn = false; } catch (e) {}
  // The bankroll legitimately falls, so the earn rule watches vp_best. Seed it
  // on first load or the key never exists until someone gets ahead of the
  // starting stack, and the ticket engine has nothing to compare against.
  if (best < bank) {
    best = bank;
    try { localStorage.setItem("vp_best", String(best)); } catch (e) {}
  }
  soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");

  function saveBank() {
    try { localStorage.setItem("vp_bank", String(bank)); } catch (e) {}
    if (bank > best) {
      best = bank;
      try { localStorage.setItem("vp_best", String(best)); } catch (e) {}
    }
  }

  // -------------------------------------------------------------------- util
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // crypto-backed where available — it costs nothing and the shuffle is the
  // one thing a card game has to get right
  function randInt(n) {
    if (window.crypto && window.crypto.getRandomValues) {
      var lim = Math.floor(4294967296 / n) * n, a = new Uint32Array(1);
      do { window.crypto.getRandomValues(a); } while (a[0] >= lim);
      return a[0] % n;
    }
    return Math.floor(Math.random() * n);
  }

  function newDeck() {
    deck = [];
    for (var s = 0; s < 4; s++) for (var r = 2; r <= 14; r++) deck.push({ r: r, s: s });
    for (var i = deck.length - 1; i > 0; i--) {
      var j = randInt(i + 1), t = deck[i];
      deck[i] = deck[j]; deck[j] = t;
    }
  }

  // ================================================================== AUDIO
  var AC = null, outGain = null, noiseBuf = null;

  function initAudio() {
    if (AC) return;
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { AC = null; return; }

    outGain = AC.createGain();
    outGain.gain.value = soundOn ? 1 : 0;

    var lp = AC.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 13000; lp.Q.value = 0.6;

    var comp = AC.createDynamicsCompressor();
    comp.threshold.value = -15; comp.knee.value = 26; comp.ratio.value = 3;
    comp.attack.value = 0.004; comp.release.value = 0.22;

    var verb = AC.createConvolver();
    verb.buffer = makeImpulse(1.4, 3.2);
    var vg = AC.createGain(); vg.gain.value = 0.26;

    var master = AC.createGain(); master.gain.value = 0.9;

    outGain.connect(lp); lp.connect(comp);
    outGain.connect(verb); verb.connect(vg); vg.connect(comp);
    comp.connect(master); master.connect(AC.destination);

    var len = Math.floor(AC.sampleRate * 1.5);
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
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + (o.dur || 0.3));
    if (o.detune) osc.detune.value = o.detune;
    var g = AC.createGain();
    var a = o.a != null ? o.a : 0.004, d = o.dur || 0.3, peak = o.g != null ? o.g : 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    osc.connect(g);
    if (o.pan != null && AC.createStereoPanner) {
      var p = AC.createStereoPanner(); p.pan.value = clamp(o.pan, -1, 1);
      g.connect(p); p.connect(outGain);
    } else g.connect(outGain);
    osc.start(t); osc.stop(t + a + d + 0.06);
  }

  function noise(o) {
    if (!AC || !noiseBuf) return;
    var t = now() + (o.at || 0), dur = o.dur || 0.1;
    var s = AC.createBufferSource();
    s.buffer = noiseBuf;
    var f = AC.createBiquadFilter();
    f.type = o.filt || "bandpass";
    f.frequency.setValueAtTime(o.f || 2200, t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(Math.max(60, o.f2), t + dur);
    if (o.Q) f.Q.value = o.Q;
    var g = AC.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.g != null ? o.g : 0.14, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g);
    if (o.pan != null && AC.createStereoPanner) {
      var p = AC.createStereoPanner(); p.pan.value = clamp(o.pan, -1, 1);
      g.connect(p); p.connect(outGain);
    } else g.connect(outGain);
    s.start(t, rnd(0, 0.6)); s.stop(t + dur + 0.04);
  }

  // a card sliding off the deck: paper on paper, no pitch
  function sndDeal(i) {
    if (!soundOn) return;
    noise({ filt: "bandpass", f: 2600, f2: 1100, Q: 0.9, dur: 0.07, g: 0.11, at: i * 0.01, pan: clamp((i - 2) * 0.28, -0.7, 0.7) });
  }
  // the snap of a card landing face-up
  function sndFlip(pan) {
    if (!soundOn) return;
    noise({ filt: "bandpass", f: 3400, f2: 1500, Q: 1.3, dur: 0.045, g: 0.13, pan: pan });
    tone({ type: "sine", f: 340, f2: 190, dur: 0.035, a: 0.001, g: 0.08, pan: pan });
  }
  function sndHold(on, pan) {
    if (!soundOn) return;
    noise({ filt: "bandpass", f: on ? 2400 : 1500, Q: 2.2, dur: 0.035, g: 0.13, pan: pan });
    tone({ type: "sine", f: on ? 720 : 480, dur: 0.06, a: 0.002, g: 0.09, pan: pan });
  }
  function sndBet() {
    if (!soundOn) return;
    tone({ type: "square", f: 880, f2: 1180, dur: 0.05, a: 0.002, g: 0.05 });
  }
  // credits dropping into the tray
  function sndCoin(i) {
    if (!soundOn) return;
    tone({ type: "triangle", f: 1400 * rnd(0.94, 1.08), f2: 900, dur: 0.06, a: 0.001, g: 0.075, pan: rnd(-0.4, 0.4) });
    noise({ filt: "highpass", f: 4200, dur: 0.03, g: 0.05 });
  }
  function sndWin(rank) {
    if (!soundOn) return;
    var ladders = {
      jacks: [0, 4], twopair: [0, 4, 7], trips: [0, 4, 7, 12],
      straight: [0, 5, 9, 12], flush: [0, 4, 9, 12, 16],
      fh: [0, 4, 7, 12, 16], quads: [0, 7, 12, 16, 19, 24],
      sf: [0, 5, 9, 14, 17, 21, 26], royal: [0, 4, 7, 12, 16, 19, 24, 28, 31]
    };
    var steps = ladders[rank] || [0, 4];
    for (var i = 0; i < steps.length; i++) {
      var f = 392 * Math.pow(2, steps[i] / 12);
      tone({ type: "triangle", f: f, dur: 0.7, a: 0.006, g: 0.095, at: i * 0.075, pan: (i / steps.length - 0.5) * 0.7 });
      tone({ type: "sine", f: f * 2, dur: 0.4, a: 0.004, g: 0.03, at: i * 0.075 });
    }
  }
  function sndNothing() {
    if (!soundOn) return;
    tone({ type: "sine", f: 176, f2: 128, dur: 0.22, a: 0.006, g: 0.09 });
  }

  soundBtn.addEventListener("click", function () {
    soundOn = !soundOn;
    soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
    try { localStorage.setItem("vp_sound", soundOn ? "1" : "0"); } catch (e) {}
    if (outGain && AC) {
      try { outGain.gain.setTargetAtTime(soundOn ? 1 : 0, now(), 0.02); }
      catch (e) { outGain.gain.value = soundOn ? 1 : 0; }
    }
    unlockAudio();
  });

  // ============================================================== EVALUATION
  function evalHand(cs) {
    var counts = {}, i;
    for (i = 0; i < cs.length; i++) counts[cs[i].r] = (counts[cs[i].r] || 0) + 1;
    var rs = cs.map(function (c) { return c.r; }).sort(function (a, b) { return a - b; });
    var sizes = [], k;
    for (k in counts) sizes.push(counts[k]);
    sizes.sort(function (a, b) { return b - a; });

    var flush = true;
    for (i = 1; i < cs.length; i++) if (cs[i].s !== cs[0].s) { flush = false; break; }

    var uniq = Object.keys(counts).length === 5;
    var straight = false, high = 0;
    if (uniq) {
      if (rs[4] - rs[0] === 4) { straight = true; high = rs[4]; }
      else if (rs[0] === 2 && rs[1] === 3 && rs[2] === 4 && rs[3] === 5 && rs[4] === 14) { straight = true; high = 5; }
    }

    var key = "none";
    if (straight && flush && high === 14) key = "royal";
    else if (straight && flush) key = "sf";
    else if (sizes[0] === 4) key = "quads";
    else if (sizes[0] === 3 && sizes[1] === 2) key = "fh";
    else if (flush) key = "flush";
    else if (straight) key = "straight";
    else if (sizes[0] === 3) key = "trips";
    else if (sizes[0] === 2 && sizes[1] === 2) key = "twopair";
    else if (sizes[0] === 2) {
      for (k in counts) if (counts[k] === 2 && +k >= 11) { key = "jacks"; break; }
    }

    // which cards to light up
    var win = [];
    if (key === "royal" || key === "sf" || key === "flush" || key === "straight") win = [0, 1, 2, 3, 4];
    else if (key !== "none") {
      var need = {};
      for (k in counts) {
        if (key === "jacks") { if (counts[k] === 2 && +k >= 11) need[k] = 1; }
        else if (key === "twopair") { if (counts[k] === 2) need[k] = 1; }
        else if (counts[k] >= 2) need[k] = 1;
      }
      for (i = 0; i < cs.length; i++) if (need[cs[i].r]) win.push(i);
    }

    var row = null;
    for (i = 0; i < PAY.length; i++) if (PAY[i].k === key) row = PAY[i];
    var pay = 0;
    if (row) pay = (key === "royal" && bet === 5) ? 4000 : row.p * bet;
    return { key: key, name: row ? row.n : "No pair", pay: pay, win: win };
  }

  // ================================================================= SIZING
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var top = 46;
    var bottom = H - (H <= 520 ? 68 : 104);
    var avail = Math.max(180, bottom - top);

    ptRow = clamp(avail * 0.048, 12.5, 30);
    var ptH = ptRow * 9 + ptRow * 1.5;
    // narrow enough that the top-right tip-jar / fullscreen badges never sit
    // on top of the payout column (see the docking block in styles.css)
    ptW = Math.min(560, Math.max(210, W - 116));
    ptX = (W - ptW) / 2;
    ptTop = top;

    var padX = Math.max(10, W * 0.03);
    gap = Math.max(5, W * 0.015);
    var byW = (W - padX * 2 - gap * 4) / 5;
    var byH = (avail - ptH - ptRow * 3.6) / 1.45;
    cardW = Math.min(180, byW, Math.max(38, byH));
    cardH = cardW * 1.45;

    // Centre the whole stack in the band. Without this the layout hugs the top
    // and leaves a lake of empty felt on a tall screen.
    var stripH = Math.max(26, ptRow * 1.5);
    var tabH = Math.max(15, cardW * 0.22) + 5;      // the HELD tab sits above a card
    var block = ptH + ptRow * 1.5 + tabH + cardH + ptRow * 1.3 + stripH;
    var offset = Math.max(0, (avail - block) / 2);
    ptTop = top + offset;

    msgY = ptTop + ptH + ptRow * 0.9;
    cardY = msgY + ptRow * 0.9 + tabH;
    cardX0 = (W - (cardW * 5 + gap * 4)) / 2;
    stripY = cardY + cardH + ptRow * 1.3;
  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", function () {
    resize(); setTimeout(resize, 180); setTimeout(resize, 520);
  });

  // ================================================================== INPUT
  function cardAt(x, y) {
    if (y < cardY - 12 || y > cardY + cardH + 12) return -1;
    for (var i = 0; i < 5; i++) {
      var cx = cardX0 + i * (cardW + gap);
      if (x >= cx - gap * 0.4 && x <= cx + cardW + gap * 0.4) return i;
    }
    return -1;
  }

  canvas.addEventListener("pointerdown", function (e) {
    unlockAudio();
    if (state !== "hold") return;
    var r = canvas.getBoundingClientRect();
    var i = cardAt(e.clientX - r.left, e.clientY - r.top);
    if (i >= 0) toggleHold(i);
  });

  function toggleHold(i) {
    held[i] = !held[i];
    sndHold(held[i], clamp((i - 2) * 0.3, -0.7, 0.7));
  }

  window.addEventListener("keydown", function (e) {
    if (state === "hold" && e.key >= "1" && e.key <= "5") {
      e.preventDefault(); unlockAudio(); toggleHold(+e.key - 1); return;
    }
    if (e.key === "Enter" || e.code === "Space" || e.key === " ") {
      e.preventDefault(); unlockAudio();
      if (state === "menu") ovBtn.click();
      else if (!dealBtn.disabled) dealBtn.click();
    }
  });

  // ================================================================== BUTTONS
  function syncButtons() {
    var canBet = state === "bet" || state === "result";
    betBtn.disabled = !canBet;
    maxBtn.disabled = !canBet;
    if (state === "hold") {
      dealBtn.textContent = "Draw";
      dealBtn.disabled = false;
    } else if (canBet) {
      if (bank < bet) { dealBtn.textContent = "Add 200 credits"; dealBtn.disabled = false; }
      else { dealBtn.textContent = "Deal"; dealBtn.disabled = false; }
    } else {
      dealBtn.textContent = state === "drawing" ? "Draw" : "Deal";
      dealBtn.disabled = true;
    }
  }

  betBtn.addEventListener("click", function () {
    unlockAudio();
    if (betBtn.disabled) return;
    bet = bet >= 5 ? 1 : bet + 1;
    sndBet();
    syncButtons();
  });

  maxBtn.addEventListener("click", function () {
    unlockAudio();
    if (maxBtn.disabled) return;
    bet = 5;
    sndBet();
    syncButtons();
    if (bank >= bet) doDeal();
  });

  dealBtn.addEventListener("click", function () {
    unlockAudio();
    if (dealBtn.disabled) return;
    if (state === "hold") { doDraw(); return; }
    if (bank < bet) {
      bank += 200;
      saveBank();
      msg = "200 play credits added";
      sndCoin(0);
      syncButtons();
      return;
    }
    doDeal();
  });

  ovBtn.addEventListener("click", function () {
    unlockAudio();
    overlay.hidden = true;
    controls.hidden = false;
    document.body.classList.add("is-playing");
    state = "bet";
    msg = "Set your bet, then deal";
    syncButtons();
  });

  // ================================================================== ROUNDS
  function doDeal() {
    // if the payout is still ticking into the bank, pay the rest at once
    if (payLeft > 0) { bank += payLeft; payLeft = 0; saveBank(); }
    bank -= bet;
    saveBank();
    newDeck();
    hand = [];
    for (var i = 0; i < 5; i++) hand.push(deck.pop());
    held = [false, false, false, false, false];
    winCards = [];
    result = null;
    lastWin = 0; glow = 0;
    payLeft = 0; payAnim = 0;
    msg = "Hold the cards you want";
    anim = 0;
    state = "dealing";
    syncButtons();
  }

  function doDraw() {
    var replaced = 0;
    for (var i = 0; i < 5; i++) {
      if (!held[i]) { hand[i] = deck.pop(); replaced++; }
    }
    anim = 0;
    state = "drawing";
    if (replaced === 0) { /* stand pat still plays the animation beat */ }
    syncButtons();
  }

  function settle() {
    result = evalHand(hand);
    winCards = result.win;
    if (result.pay > 0) {
      payLeft = result.pay;
      lastWin = result.pay;
      glow = 1;
      msg = result.name.toUpperCase() + "  ·  " + result.pay;
      sndWin(result.key);
      if (result.key === "royal" || result.key === "sf" || result.key === "quads") spawnCoins(28);
      else spawnCoins(12);
    } else {
      msg = bank < bet ? "Out of credits — add more to keep playing" : "No pair. Deal again";
      sndNothing();
    }
    state = "result";
    syncButtons();
  }

  function spawnCoins(n) {
    if (REDMO) return;
    for (var i = 0; i < n; i++) {
      coins.push({
        x: W / 2 + rnd(-cardW * 2, cardW * 2),
        y: cardY + cardH * 0.5,
        vx: rnd(-90, 90), vy: rnd(-320, -140),
        r: rnd(4, 8), t: 0, life: rnd(1, 1.7), rot: rnd(0, TAU), vr: rnd(-7, 7)
      });
    }
  }

  // ================================================================= UPDATE
  function update(dt) {
    if (state === "dealing") {
      var was = anim;
      anim += dt;
      // one slide + snap per card as it arrives
      for (var c = 0; c < 5; c++) {
        var at = c * 0.1;
        if (was < at && anim >= at) sndDeal(c);
        if (was < at + 0.3 && anim >= at + 0.3) sndFlip(clamp((c - 2) * 0.3, -0.7, 0.7));
      }
      if (anim > 0.10 * 5 + 0.34) { state = "hold"; syncButtons(); }
    } else if (state === "drawing") {
      var w2 = anim;
      anim += dt;
      if (w2 < 0.02 && anim >= 0.02) {
        for (var k = 0; k < 5; k++) if (!held[k]) sndDeal(k);
      }
      if (w2 < 0.3 && anim >= 0.3) {
        for (var j = 0; j < 5; j++) if (!held[j]) sndFlip(clamp((j - 2) * 0.3, -0.7, 0.7));
      }
      if (anim > 0.46) settle();
    }

    if (payLeft > 0) {
      payTick += dt;
      var step = Math.max(1, Math.round(lastWin / 26));
      while (payTick > 0.045 && payLeft > 0) {
        payTick -= 0.045;
        var add = Math.min(step, payLeft);
        bank += add; payLeft -= add;
        sndCoin(0);
      }
      if (payLeft <= 0) { saveBank(); syncButtons(); }
    }

    if (glow > 0) glow = Math.max(0, glow - dt * 0.5);

    for (var i = coins.length - 1; i >= 0; i--) {
      var c = coins[i];
      c.t += dt; c.x += c.vx * dt; c.y += c.vy * dt; c.vy += 900 * dt; c.rot += c.vr * dt;
      if (c.t > c.life) coins.splice(i, 1);
    }
  }

  // =================================================================== DRAW
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawCabinet();
    if (state === "menu") return;
    drawPaytable();
    drawMessage();
    drawCards();
    drawStrip();
    drawCoins();
  }

  function roundRect(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function drawCabinet() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0d2a20");
    g.addColorStop(0.45, "#0a1f18");
    g.addColorStop(1, "#050d0a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // felt weave
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.strokeStyle = "#8fd6b4";
    ctx.lineWidth = 1;
    for (var y = 0; y < H; y += 7) {
      ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke();
    }
    ctx.restore();

    // overhead glow
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    var pool = ctx.createRadialGradient(W / 2, H * 0.28, 10, W / 2, H * 0.4, Math.max(W, H) * 0.7);
    pool.addColorStop(0, "rgba(120,220,170,0.09)");
    pool.addColorStop(1, "rgba(80,180,140,0)");
    ctx.fillStyle = pool;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    var v = ctx.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.3, W / 2, H * 0.5, Math.max(W, H) * 0.78);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.6)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }

  function drawPaytable() {
    var h = ptRow * 9 + ptRow * 1.5;
    ctx.save();
    // glass panel
    roundRect(ctx, ptX, ptTop, ptW, h, 10);
    ctx.fillStyle = "rgba(4, 22, 16, 0.72)";
    ctx.fill();
    ctx.strokeStyle = "rgba(232,192,106,0.4)";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    ctx.font = "700 " + Math.round(ptRow * 0.52) + "px 'Geist Mono', ui-monospace, monospace";
    ctx.fillStyle = "rgba(232,192,106,0.72)";
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText("JACKS OR BETTER", ptX + 12, ptTop + ptRow * 0.72);
    ctx.textAlign = "right";
    ctx.fillText("BET " + bet, ptX + ptW - 12, ptTop + ptRow * 0.72);

    ctx.font = "600 " + Math.round(ptRow * 0.62) + "px 'Geist', system-ui, sans-serif";
    for (var i = 0; i < PAY.length; i++) {
      var y = ptTop + ptRow * 1.5 + ptRow * (i + 0.5);
      var hot = result && result.key === PAY[i].k;
      if (hot) {
        var a = 0.28 + Math.abs(Math.sin(performance.now() / 260)) * 0.3;
        ctx.fillStyle = "rgba(232,192,106," + a + ")";
        roundRect(ctx, ptX + 5, y - ptRow * 0.44, ptW - 10, ptRow * 0.88, 5);
        ctx.fill();
      }
      ctx.fillStyle = hot ? "#12200f" : "rgba(226,240,224,0.82)";
      ctx.textAlign = "left";
      ctx.fillText(PAY[i].n, ptX + 12, y);
      ctx.textAlign = "right";
      var amount = (PAY[i].k === "royal" && bet === 5) ? 4000 : PAY[i].p * bet;
      ctx.fillStyle = hot ? "#12200f" : "#e8c06a";
      ctx.fillText(String(amount), ptX + ptW - 12, y);
    }
    ctx.restore();
  }

  function drawMessage() {
    ctx.save();
    ctx.font = "800 " + Math.round(ptRow * 0.78) + "px 'Geist', system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    var win = result && result.pay > 0;
    if (win) {
      var pulse = 0.75 + Math.abs(Math.sin(performance.now() / 220)) * 0.25;
      ctx.shadowColor = "rgba(232,192,106,0.8)";
      ctx.shadowBlur = 18 * pulse;
      ctx.fillStyle = "#ffdf9a";
    } else {
      ctx.fillStyle = "rgba(214,232,214,0.66)";
    }
    ctx.fillText(msg, W / 2, msgY);
    ctx.restore();
  }

  function drawCards() {
    for (var i = 0; i < 5; i++) {
      var x = cardX0 + i * (cardW + gap);
      var faceUp = true, flip = 0, lift = 0;

      if (state === "dealing") {
        var t = (anim - i * 0.1) / 0.34;
        if (t <= 0) continue;
        if (t < 1) { flip = 1 - t; lift = (1 - t) * cardH * 0.35; }
      } else if (state === "drawing" && !held[i]) {
        var d = anim / 0.46;
        if (d < 0.5) { faceUp = false; flip = d * 2 * 0.5; lift = d * cardH * 0.2; }
        else { flip = (1 - d) * 1.0; lift = (1 - d) * cardH * 0.2; }
      } else if (state === "menu") {
        faceUp = false;
      }

      drawCard(x, cardY - lift, hand[i], faceUp, flip, i);
    }
  }

  function drawCard(x, y, card, faceUp, flip, idx) {
    var sc = Math.max(0.04, Math.abs(Math.cos(flip * Math.PI * 0.5)));
    var w = cardW * sc;
    var cxp = x + cardW / 2;
    var isWin = result && winCards.indexOf(idx) >= 0;

    ctx.save();
    // drop shadow
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = "#000";
    roundRect(ctx, cxp - w / 2 + 3, y + 5, w, cardH, cardW * 0.09);
    ctx.fill();
    ctx.globalAlpha = 1;

    if (isWin && glow > 0.001) {
      ctx.shadowColor = "rgba(255,214,120," + (0.5 + Math.abs(Math.sin(performance.now() / 230)) * 0.5) + ")";
      ctx.shadowBlur = cardW * 0.5;
    }

    if (!card || !faceUp) {
      // back
      var bg = ctx.createLinearGradient(cxp - w / 2, y, cxp + w / 2, y + cardH);
      bg.addColorStop(0, "#1d4a38");
      bg.addColorStop(0.5, "#123326");
      bg.addColorStop(1, "#0b2419");
      ctx.fillStyle = bg;
      roundRect(ctx, cxp - w / 2, y, w, cardH, cardW * 0.09);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "rgba(232,192,106,0.55)";
      ctx.lineWidth = Math.max(1, cardW * 0.018);
      roundRect(ctx, cxp - w / 2 + cardW * 0.06 * sc, y + cardW * 0.06, w - cardW * 0.12 * sc, cardH - cardW * 0.12, cardW * 0.05);
      ctx.stroke();
      if (sc > 0.4) {
        ctx.save();
        roundRect(ctx, cxp - w / 2, y, w, cardH, cardW * 0.09);
        ctx.clip();
        ctx.strokeStyle = "rgba(232,192,106,0.16)";
        ctx.lineWidth = 1;
        for (var k = -cardH; k < cardH * 2; k += cardW * 0.13) {
          ctx.beginPath(); ctx.moveTo(cxp - w / 2 + k, y); ctx.lineTo(cxp - w / 2 + k + cardH, y + cardH); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(cxp - w / 2 + k, y + cardH); ctx.lineTo(cxp - w / 2 + k + cardH, y); ctx.stroke();
        }
        ctx.restore();
      }
      ctx.restore();
      return;
    }

    // face
    var fg = ctx.createLinearGradient(cxp, y, cxp, y + cardH);
    fg.addColorStop(0, "#fffdf8");
    fg.addColorStop(0.6, "#f6f2e8");
    fg.addColorStop(1, "#e9e3d5");
    ctx.fillStyle = fg;
    roundRect(ctx, cxp - w / 2, y, w, cardH, cardW * 0.09);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = isWin ? "rgba(214,164,54,0.95)" : "rgba(0,0,0,0.22)";
    ctx.lineWidth = isWin ? Math.max(1.6, cardW * 0.03) : 1;
    roundRect(ctx, cxp - w / 2, y, w, cardH, cardW * 0.09);
    ctx.stroke();

    if (sc > 0.25) {
      ctx.save();
      roundRect(ctx, cxp - w / 2, y, w, cardH, cardW * 0.09);
      ctx.clip();
      ctx.translate(cxp, y + cardH / 2);
      ctx.scale(sc, 1);
      ctx.translate(-cardW / 2, -cardH / 2);
      drawFace(card);
      ctx.restore();
    }
    ctx.restore();

    // HELD tab
    if (held[idx] && (state === "hold" || state === "drawing")) {
      var tw = cardW * 0.74, thh = Math.max(15, cardW * 0.22);
      ctx.save();
      roundRect(ctx, cxp - tw / 2, y - thh - 5, tw, thh, thh * 0.34);
      var tg = ctx.createLinearGradient(0, y - thh - 5, 0, y - 5);
      tg.addColorStop(0, "#ffe6a8");
      tg.addColorStop(1, "#d3a441");
      ctx.fillStyle = tg;
      ctx.fill();
      ctx.fillStyle = "#2a1c05";
      ctx.font = "800 " + Math.round(thh * 0.55) + "px 'Geist Mono', ui-monospace, monospace";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("HELD", cxp, y - thh / 2 - 5);
      ctx.restore();
    }
  }

  // draws into a cardW x cardH local box
  function drawFace(card) {
    var red = RED[card.s];
    var col = red ? "#c1272d" : "#181d26";
    var glyph = SUITS[card.s];
    var rank = RANKS[card.r];
    var wide = rank.length > 1;                 // only the 10

    ctx.fillStyle = col;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Corner indices, top-left and mirrored bottom-right. They live in a tight
    // block hard in the corner: the earlier version sat too far in and the
    // MIRRORED one collided with the centre motif, which is what made the
    // cards look crowded.
    var idx = cardW * (wide ? 0.19 : 0.215);
    var ix = cardW * (wide ? 0.185 : 0.165);
    for (var m = 0; m < 2; m++) {
      ctx.save();
      if (m === 1) { ctx.translate(cardW, cardH); ctx.rotate(Math.PI); }
      ctx.font = "800 " + Math.round(idx) + "px 'Geist', system-ui, sans-serif";
      ctx.fillText(rank, ix, cardH * 0.098);
      ctx.font = Math.round(idx * 0.74) + "px 'Geist', system-ui, sans-serif";
      ctx.fillText(glyph, ix, cardH * 0.208);
      ctx.restore();
    }

    // the motif is genuinely centred now, not nudged toward one corner
    var cxp = cardW * 0.5, cyp = cardH * 0.52;

    if (card.r >= 11 && card.r <= 13) {
      // court: a monogram panel rather than a cramped illustration
      var pw = cardW * 0.46, ph = cardH * 0.34;
      ctx.save();
      ctx.translate(cxp, cyp);
      roundRect(ctx, -pw / 2, -ph / 2, pw, ph, pw * 0.14);
      var pg = ctx.createLinearGradient(0, -ph / 2, 0, ph / 2);
      pg.addColorStop(0, red ? "#f6d9d6" : "#dde2ea");
      pg.addColorStop(1, red ? "#e8bab5" : "#c3cbd8");
      ctx.fillStyle = pg;
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1, cardW * 0.014);
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.font = "800 " + Math.round(cardW * 0.26) + "px 'Geist', system-ui, sans-serif";
      ctx.fillText(rank, 0, -ph * 0.1);
      ctx.font = Math.round(cardW * 0.14) + "px 'Geist', system-ui, sans-serif";
      ctx.fillText(glyph, 0, ph * 0.27);
      ctx.restore();
    } else if (card.r === 14) {
      ctx.save();
      ctx.translate(cxp, cyp);
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = Math.max(1, cardW * 0.013);
      ctx.beginPath(); ctx.arc(0, 0, cardW * 0.235, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = col;
      ctx.font = Math.round(cardW * 0.36) + "px 'Geist', system-ui, sans-serif";
      ctx.fillText(glyph, 0, 0);
      ctx.restore();
    } else {
      // number cards: one clean suit glyph. Detailed pip layouts turn to mush
      // at the ~40px card width a phone gives us, and the corner index already
      // carries the rank.
      ctx.fillStyle = col;
      ctx.font = Math.round(cardW * 0.36) + "px 'Geist', system-ui, sans-serif";
      ctx.fillText(glyph, cxp, cyp);
    }
  }

  function drawStrip() {
    var h = Math.max(26, ptRow * 1.5);
    var w = Math.min(560, W - 24);
    var x = (W - w) / 2;
    ctx.save();
    roundRect(ctx, x, stripY, w, h, 8);
    ctx.fillStyle = "rgba(4,22,16,0.72)";
    ctx.fill();
    ctx.strokeStyle = "rgba(232,192,106,0.28)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textBaseline = "middle";
    ctx.font = "700 " + Math.round(h * 0.3) + "px 'Geist Mono', ui-monospace, monospace";
    ctx.fillStyle = "rgba(226,240,224,0.5)";
    ctx.textAlign = "left";
    ctx.fillText("CREDITS", x + 12, stripY + h * 0.32);
    ctx.textAlign = "center";
    ctx.fillText("BET", x + w / 2, stripY + h * 0.32);
    ctx.textAlign = "right";
    ctx.fillText("WIN", x + w - 12, stripY + h * 0.32);

    ctx.font = "800 " + Math.round(h * 0.46) + "px 'Geist Mono', ui-monospace, monospace";
    ctx.fillStyle = "#e8f4e6";
    ctx.textAlign = "left";
    ctx.fillText(String(bank), x + 12, stripY + h * 0.72);
    ctx.textAlign = "center";
    ctx.fillStyle = "#e8c06a";
    ctx.fillText(String(bet), x + w / 2, stripY + h * 0.72);
    ctx.textAlign = "right";
    ctx.fillStyle = lastWin > 0 ? "#ffdf9a" : "rgba(226,240,224,0.4)";
    ctx.fillText(lastWin > 0 ? String(lastWin) : "–", x + w - 12, stripY + h * 0.72);
    ctx.restore();
  }

  function drawCoins() {
    for (var i = 0; i < coins.length; i++) {
      var c = coins[i];
      var a = 1 - c.t / c.life;
      ctx.save();
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.scale(Math.max(0.15, Math.abs(Math.cos(c.rot))), 1);
      var g = ctx.createLinearGradient(-c.r, -c.r, c.r, c.r);
      g.addColorStop(0, "#fff0c4");
      g.addColorStop(0.5, "#e8c06a");
      g.addColorStop(1, "#a8781f");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, c.r, 0, TAU); ctx.fill();
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

  window.OPT_SHARE_TEXT = "I'm chasing the royal flush on One Page Toys video poker.";
  resize();
  syncButtons();
  requestAnimationFrame(frame);
})();
