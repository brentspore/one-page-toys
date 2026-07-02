/* Blackjack — casino table. Vanilla Canvas 2D, self-contained.
 * Chip betting + bankroll (localStorage), hit / stand / double / split /
 * insurance, 6-deck shoe, dealer stands on 17, blackjack pays 3:2.
 * Card rendering + audio bus adapted from the Solitaire toy. */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var bankChip = document.getElementById("bankChip");
  var shoeBtn = document.getElementById("shoeBtn");
  var soundBtn = document.getElementById("soundBtn");
  var hintEl = document.getElementById("hint");
  var overlay = document.getElementById("overlay");
  var ovTitle = document.getElementById("ovTitle");
  var ovText = document.getElementById("ovText");
  var ovBtn = document.getElementById("ovBtn");
  var actions = document.getElementById("actions");
  var dealBtn = document.getElementById("dealBtn");
  var clearBtn = document.getElementById("clearBtn");
  var hitBtn = document.getElementById("hitBtn");
  var standBtn = document.getElementById("standBtn");
  var dblBtn = document.getElementById("dblBtn");
  var splitBtn = document.getElementById("splitBtn");
  var insYesBtn = document.getElementById("insYesBtn");
  var insNoBtn = document.getElementById("insNoBtn");

  var W = 0, H = 0, DPR = 1;
  var SUITS = ["♠", "♥", "♦", "♣"];
  function isRed(s) { return s === 1 || s === 2; }
  function rankLabel(r) { return r === 1 ? "A" : r === 11 ? "J" : r === 12 ? "Q" : r === 13 ? "K" : String(r); }
  var PIPS = {
    2: [[.5, .16], [.5, .84]],
    3: [[.5, .16], [.5, .5], [.5, .84]],
    4: [[.3, .18], [.7, .18], [.3, .82], [.7, .82]],
    5: [[.3, .18], [.7, .18], [.5, .5], [.3, .82], [.7, .82]],
    6: [[.3, .18], [.7, .18], [.3, .5], [.7, .5], [.3, .82], [.7, .82]],
    7: [[.3, .18], [.7, .18], [.5, .32], [.3, .5], [.7, .5], [.3, .82], [.7, .82]],
    8: [[.3, .18], [.7, .18], [.5, .32], [.3, .5], [.7, .5], [.5, .68], [.3, .82], [.7, .82]],
    9: [[.3, .16], [.7, .16], [.3, .38], [.7, .38], [.5, .5], [.3, .62], [.7, .62], [.3, .84], [.7, .84]],
    10: [[.3, .16], [.7, .16], [.5, .27], [.3, .38], [.7, .38], [.3, .62], [.7, .62], [.5, .73], [.3, .84], [.7, .84]]
  };

  // chip denominations (value → ring/face colors)
  var CHIPS = [
    { v: 5, face: "#c9403a", edge: "#f2f2f2", ink: "#fff" },
    { v: 25, face: "#2f8f4e", edge: "#f2f2f2", ink: "#fff" },
    { v: 100, face: "#232830", edge: "#c9a24a", ink: "#ffe7a8" },
    { v: 500, face: "#6b3fa0", edge: "#f2f2f2", ink: "#fff" }
  ];

  // ---- state ----
  var bankroll = loadBank();
  var shoe = [];
  var dealer = { cards: [] };
  var hands = [];          // player hands: {cards, bet, done, result, doubled, fromSplit}
  var active = 0;
  var phase = "betting";   // betting | dealing | insurance | player | dealer | payout
  var chipStack = [];      // denominations placed for the pending bet
  var lastBet = [];        // remembered bet for auto-rebet
  var insuranceBet = 0;
  var roundId = 0;
  var soundOn = true;
  var geom = null, chipHit = [], msg = "";
  var CW = 90, CH = 126;   // card size (set in layout)

  function loadBank() { try { var v = parseInt(localStorage.getItem("bj_bank"), 10); return (v > 0 || v === 0) ? v : 1000; } catch (e) { return 1000; } }
  function saveBank() { try { localStorage.setItem("bj_bank", String(bankroll)); } catch (e) {} }
  function money(n) { return "$" + n.toLocaleString("en-US"); }

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    layout();
  }
  window.addEventListener("resize", resize);

  function layout() {
    CW = Math.max(44, Math.min(W * 0.11, H * 0.15, 98));
    CH = CW * 1.4;
    geom = {
      shoeX: W - CW * 0.7 - 18, shoeY: Math.max(60, H * 0.11),
      dealerY: H * 0.2,
      playerY: H * 0.46,
      betX: W * 0.5, betY: H * 0.77, betR: Math.max(32, CW * 0.48),
      chipY: H * 0.88,
      spread: CW * 0.36
    };
    positionCards();
  }

  // ---- deck / shoe ----
  function buildShoe() {
    shoe = [];
    for (var d = 0; d < 6; d++) for (var s = 0; s < 4; s++) for (var r = 1; r <= 13; r++) shoe.push({ rank: r, suit: s });
    for (var i = shoe.length - 1; i > 0; i--) { var j = (Math.random() * (i + 1)) | 0; var t = shoe[i]; shoe[i] = shoe[j]; shoe[j] = t; }
  }
  function draw() {
    if (shoe.length < 26) buildShoe();     // reshuffle when the shoe gets low
    var c = shoe.pop();
    c.faceUp = true; c._x = geom.shoeX; c._y = geom.shoeY; c._tx = c._x; c._ty = c._y; c._w = CW; c._h = CH; c._born = performance.now(); c._delay = 0;
    return c;
  }

  // ---- hand math ----
  function totalOf(cards) {
    var s = 0, a = 0;
    for (var i = 0; i < cards.length; i++) { var r = cards[i].rank; s += r === 1 ? 11 : (r >= 10 ? 10 : r); if (r === 1) a++; }
    while (s > 21 && a > 0) { s -= 10; a--; }
    return s;
  }
  function isSoft(cards) { var s = 0, a = 0; for (var i = 0; i < cards.length; i++) { var r = cards[i].rank; s += r === 1 ? 11 : (r >= 10 ? 10 : r); if (r === 1) a++; } while (s > 21 && a > 0) { s -= 10; a--; } return a > 0; }
  function isBJ(hand) { return hand.cards.length === 2 && !hand.fromSplit && totalOf(hand.cards) === 21; }
  function shownDealer() { return dealer.cards.filter(function (c) { return c.faceUp; }); }

  // ---- positioning ----
  function fanPositions(n, cx, cy) {
    var sp = geom.spread, total = CW + (n - 1) * sp, sx = cx - total / 2, out = [];
    for (var i = 0; i < n; i++) out.push({ x: sx + i * sp, y: cy });
    return out;
  }
  function positionCards() {
    if (!geom) return;
    var dp = fanPositions(dealer.cards.length, W * 0.5, geom.dealerY);
    dealer.cards.forEach(function (c, i) { c._tx = dp[i].x; c._ty = dp[i].y; c._w = CW; c._h = CH; });
    var n = hands.length || 1;
    var slotW = Math.min(W / n, CW * 3.4);
    for (var hIdx = 0; hIdx < hands.length; hIdx++) {
      var cx = W * 0.5 + (hIdx - (n - 1) / 2) * slotW;
      var pp = fanPositions(hands[hIdx].cards.length, cx, geom.playerY);
      hands[hIdx]._cx = cx;
      hands[hIdx].cards.forEach(function (c, i) { c._tx = pp[i].x; c._ty = pp[i].y; c._w = CW; c._h = CH; });
    }
  }

  // ---- betting ----
  function betTotal() { return chipStack.reduce(function (a, b) { return a + b; }, 0); }
  function addChip(v) {
    if (phase !== "betting") return;
    if (betTotal() + v > bankroll) { sndBad(); return; }
    chipStack.push(v); sndChip(); refreshUI();
  }
  function clearBet() { if (phase !== "betting") return; chipStack = []; sndChip(); refreshUI(); }

  // ---- deal ----
  function startRound() {
    var bet = betTotal();
    if (phase !== "betting" || bet <= 0 || bet > bankroll) { sndBad(); return; }
    unlock();
    lastBet = chipStack.slice();
    bankroll -= bet; saveBank();
    phase = "dealing"; roundId++; var rid = roundId;
    dealer = { cards: [] };
    hands = [{ cards: [], bet: bet, done: false, result: null, doubled: false, fromSplit: false }];
    active = 0; insuranceBet = 0; msg = "";
    hintEl.classList.add("is-gone");

    // deal order: player, dealer(up), player, dealer(hole) — staggered fly-in
    var seq = [
      function () { dealTo(hands[0]); },
      function () { dealTo(dealer); },
      function () { dealTo(hands[0]); },
      function () { var c = draw(); c.faceUp = false; dealer.cards.push(c); positionCards(); sndDeal(); }
    ];
    seq.forEach(function (fn, i) { setTimeout(function () { if (rid === roundId) fn(); }, 120 + i * 300); });
    setTimeout(function () { if (rid === roundId) afterDeal(); }, 120 + seq.length * 300 + 260);
    refreshUI();
  }
  function dealTo(hand) { var c = draw(); hand.cards.push(c); positionCards(); sndDeal(); }

  function afterDeal() {
    // dealer Ace up → offer insurance before naturals resolve
    if (dealer.cards[0].rank === 1 && bankroll >= Math.floor(hands[0].bet / 2)) {
      phase = "insurance"; refreshUI(); return;
    }
    resolveNaturals();
  }

  function resolveNaturals() {
    var dealerBJ = totalOf(dealer.cards) === 21;
    var playerBJ = isBJ(hands[0]);
    if (dealerBJ || playerBJ) {
      revealHole();
      phase = "payout";
      setTimeout(function () { settle(); }, 700);
      return;
    }
    phase = "player"; active = 0; refreshUI();
  }

  // ---- player actions ----
  function curHand() { return hands[active]; }
  function hit() {
    if (phase !== "player") return;
    var h = curHand(); dealTo(h);
    if (totalOf(h.cards) >= 21) { h.done = true; setTimeout(advance, 420); }
    refreshUI();
  }
  function stand() { if (phase !== "player") return; curHand().done = true; advance(); }
  function doubleDown() {
    if (phase !== "player") return;
    var h = curHand();
    if (h.cards.length !== 2 || bankroll < h.bet) { sndBad(); return; }
    bankroll -= h.bet; saveBank(); h.bet *= 2; h.doubled = true;
    dealTo(h); h.done = true; sndChip();
    setTimeout(advance, 520); refreshUI();
  }
  function canSplit(h) {
    return h && h.cards.length === 2 && hands.length < 4 && bankroll >= h.bet &&
      (h.cards[0].rank === h.cards[1].rank ||
        (h.cards[0].rank >= 10 && h.cards[1].rank >= 10));
  }
  function split() {
    if (phase !== "player") return;
    var h = curHand();
    if (!canSplit(h)) { sndBad(); return; }
    bankroll -= h.bet; saveBank();
    var moved = h.cards.pop();
    var nh = { cards: [moved], bet: h.bet, done: false, result: null, doubled: false, fromSplit: true };
    h.fromSplit = true;
    hands.splice(active + 1, 0, nh);
    sndChip();
    // one fresh card to the current hand, then position; splitting aces = one card only
    dealTo(h);
    positionCards();
    if (h.cards[0].rank === 1) { h.done = true; setTimeout(advance, 420); }
    refreshUI();
  }
  function advance() {
    // deal the second card to a freshly split hand that has only one
    for (var i = 0; i < hands.length; i++) {
      if (hands[i].cards.length === 1) { active = i; dealTo(hands[i]); if (hands[i].cards[0].rank === 1) { hands[i].done = true; } refreshUI(); }
    }
    // find next not-done hand
    var next = -1;
    for (var j = 0; j < hands.length; j++) { if (!hands[j].done && totalOf(hands[j].cards) < 21) { next = j; break; } }
    if (next >= 0) { active = next; phase = "player"; refreshUI(); return; }
    // all hands settled → dealer plays if any hand is still live (not busted)
    var live = hands.some(function (h) { return totalOf(h.cards) <= 21; });
    if (live) dealerPlay();
    else { phase = "payout"; revealHole(); setTimeout(settle, 600); }
  }

  // ---- dealer ----
  function revealHole() { dealer.cards.forEach(function (c) { if (!c.faceUp) { c.faceUp = true; sndFlip(); } }); positionCards(); }
  function dealerPlay() {
    phase = "dealer"; refreshUI();
    var rid = roundId;
    revealHole();
    function step() {
      if (rid !== roundId) return;
      var v = totalOf(dealer.cards);
      if (v < 17) { var c = draw(); dealer.cards.push(c); positionCards(); sndDeal(); setTimeout(step, 650); }
      else { phase = "payout"; setTimeout(settle, 500); }
    }
    setTimeout(step, 700);
  }

  // ---- settle ----
  function settle() {
    var dTotal = totalOf(dealer.cards), dBJ = totalOf(dealer.cards) === 21 && dealer.cards.length === 2;
    var dBust = dTotal > 21;
    var net = 0, wins = 0, losses = 0, pushes = 0, blackjacks = 0;
    // insurance settles first
    if (insuranceBet > 0) { if (dBJ) { bankroll += insuranceBet * 3; net += insuranceBet * 2; } }
    hands.forEach(function (h) {
      var pt = totalOf(h.cards), pBJ = isBJ(h);
      if (pt > 21) { h.result = "bust"; losses++; return; }
      if (pBJ && !dBJ) { var w = Math.floor(h.bet * 2.5); bankroll += w; net += w - h.bet; h.result = "blackjack"; blackjacks++; return; }
      if (pBJ && dBJ) { bankroll += h.bet; h.result = "push"; pushes++; return; }
      if (dBJ) { h.result = "lose"; losses++; return; }
      if (dBust || pt > dTotal) { bankroll += h.bet * 2; net += h.bet; h.result = "win"; wins++; return; }
      if (pt === dTotal) { bankroll += h.bet; h.result = "push"; pushes++; return; }
      h.result = "lose"; losses++;
    });
    saveBank();
    phase = "payout";
    // headline message
    if (blackjacks && !wins && !losses && !pushes) msg = "Blackjack! " + money(net) + (net > 0 ? " ✦" : "");
    else if (net > 0) msg = "You win " + money(net);
    else if (net < 0) msg = "Dealer wins";
    else msg = "Push";
    if (net > 0) sndWin(); else if (net < 0) sndLose();
    refreshUI();
    var rid = roundId;
    setTimeout(function () { if (rid === roundId) endRound(); }, 1900);
  }

  function endRound() {
    if (bankroll < 5) { showBust(); return; }
    phase = "betting"; msg = "";
    dealer = { cards: [] }; hands = []; active = 0; insuranceBet = 0;
    // auto-rebet if affordable, else clear
    var want = lastBet.reduce(function (a, b) { return a + b; }, 0);
    chipStack = (want > 0 && want <= bankroll) ? lastBet.slice() : [];
    positionCards(); refreshUI();
  }

  function takeInsurance(yes) {
    if (phase !== "insurance") return;
    if (yes) { var ib = Math.floor(hands[0].bet / 2); if (ib > 0 && bankroll >= ib) { bankroll -= ib; insuranceBet = ib; saveBank(); sndChip(); } }
    resolveNaturals();
  }

  // ---- UI wiring ----
  function show(el, on) { el.hidden = !on; }
  function refreshUI() {
    bankChip.textContent = "BANK " + money(bankroll);
    var betting = phase === "betting", player = phase === "player", ins = phase === "insurance";
    show(dealBtn, betting); show(clearBtn, betting && betTotal() > 0);
    dealBtn.disabled = betTotal() <= 0;
    dealBtn.style.opacity = betTotal() > 0 ? "1" : "0.5";
    dealBtn.textContent = betTotal() > 0 ? "Deal — " + money(betTotal()) : "Place a bet";
    show(hitBtn, player); show(standBtn, player);
    show(dblBtn, player && curHand() && curHand().cards.length === 2 && bankroll >= curHand().bet);
    show(splitBtn, player && canSplit(curHand()));
    show(insYesBtn, ins); show(insNoBtn, ins);
  }

  shoeBtn.addEventListener("click", function () { if (phase !== "betting" && phase !== "payout") return; buildShoe(); msg = "Fresh 6-deck shoe"; refreshUI(); setTimeout(function () { if (phase === "betting") { msg = ""; } }, 1400); });
  soundBtn.addEventListener("click", function () { soundOn = !soundOn; soundBtn.textContent = "Sound: " + (soundOn ? "on" : "off"); soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false"); if (outGain) outGain.gain.value = soundOn ? 1 : 0; unlock(); });
  dealBtn.addEventListener("click", startRound);
  clearBtn.addEventListener("click", clearBet);
  hitBtn.addEventListener("click", hit);
  standBtn.addEventListener("click", stand);
  dblBtn.addEventListener("click", doubleDown);
  splitBtn.addEventListener("click", split);
  insYesBtn.addEventListener("click", function () { takeInsurance(true); });
  insNoBtn.addEventListener("click", function () { takeInsurance(false); });
  ovBtn.addEventListener("click", function () { bankroll = 1000; saveBank(); overlay.classList.add("is-hidden"); overlay.hidden = true; endRoundToBetting(); });
  function endRoundToBetting() { phase = "betting"; msg = ""; dealer = { cards: [] }; hands = []; chipStack = []; positionCards(); refreshUI(); }
  function showBust() { ovTitle.textContent = "Out of chips"; ovText.textContent = "The house cleaned you out. Grab a fresh stack and try your luck again."; overlay.hidden = false; overlay.classList.remove("is-hidden"); }

  // chip tray + bet-circle clicks
  canvas.addEventListener("pointerdown", function (e) {
    unlock();
    var x = e.clientX, y = e.clientY;
    if (phase === "betting") {
      for (var i = 0; i < chipHit.length; i++) { var c = chipHit[i]; if (Math.hypot(x - c.x, y - c.y) <= c.r) { addChip(c.v); return; } }
      // click the bet circle to clear
      if (Math.hypot(x - geom.betX, y - geom.betY) <= geom.betR && betTotal() > 0) clearBet();
    }
  });

  // ============================ RENDER ============================
  function drawRoundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function drawBack(x, y, w) {
    var h = w * 1.4, r = w * 0.1;
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.28)"; ctx.shadowBlur = w * 0.08; ctx.shadowOffsetY = w * 0.03;
    drawRoundRect(x, y, w, h, r); ctx.fillStyle = "#fbfaf7"; ctx.fill(); ctx.restore();
    var m = w * 0.07;
    drawRoundRect(x + m, y + m, w - 2 * m, h - 2 * m, r * 0.7);
    var bg = ctx.createLinearGradient(x, y, x + w, y + h); bg.addColorStop(0, "#b21f2e"); bg.addColorStop(1, "#7c1420");
    ctx.fillStyle = bg; ctx.fill();
    ctx.save(); drawRoundRect(x + m, y + m, w - 2 * m, h - 2 * m, r * 0.7); ctx.clip();
    ctx.strokeStyle = "rgba(255,255,255,0.16)"; ctx.lineWidth = 1; var step = w * 0.22;
    for (var i = -h; i < w + h; i += step) { ctx.beginPath(); ctx.moveTo(x + i, y); ctx.lineTo(x + i + h, y + h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x + i, y + h); ctx.lineTo(x + i + h, y); ctx.stroke(); }
    ctx.restore();
    drawRoundRect(x, y, w, h, r); ctx.lineWidth = 1; ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.stroke();
  }
  function drawFace(card, x, y, w) {
    var h = w * 1.4, r = w * 0.1;
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.28)"; ctx.shadowBlur = w * 0.08; ctx.shadowOffsetY = w * 0.03;
    drawRoundRect(x, y, w, h, r); ctx.fillStyle = "#fcfbf8"; ctx.fill(); ctx.restore();
    ctx.lineWidth = 1; ctx.strokeStyle = "rgba(0,0,0,0.16)"; drawRoundRect(x, y, w, h, r); ctx.stroke();
    var col = isRed(card.suit) ? "#d21f3c" : "#1b1b22";
    var lab = rankLabel(card.rank), suit = SUITS[card.suit];
    ctx.fillStyle = col; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    var rf = w * 0.22, sf = w * 0.16, pad = w * 0.12;
    ctx.font = "800 " + rf + "px Archivo, system-ui, sans-serif"; ctx.fillText(lab, x + pad, y + pad + rf * 0.82);
    ctx.font = sf + "px system-ui, sans-serif"; ctx.fillText(suit, x + pad, y + pad + rf * 0.82 + sf * 0.98);
    ctx.save(); ctx.translate(x + w - pad, y + h - pad); ctx.rotate(Math.PI);
    ctx.font = "800 " + rf + "px Archivo, system-ui, sans-serif"; ctx.fillText(lab, 0, rf * 0.82);
    ctx.font = sf + "px system-ui, sans-serif"; ctx.fillText(suit, 0, rf * 0.82 + sf * 0.98); ctx.restore();
    if (card.rank === 1) { ctx.font = (w * 0.4) + "px system-ui, sans-serif"; ctx.textBaseline = "middle"; ctx.fillText(suit, x + w / 2, y + h / 2); }
    else if (card.rank >= 11) {
      var ix = x + w * 0.2, iy = y + h * 0.14, iw = w * 0.6, ih = h * 0.72;
      drawRoundRect(ix, iy, iw, ih, w * 0.05); ctx.fillStyle = isRed(card.suit) ? "rgba(210,31,60,0.07)" : "rgba(27,27,34,0.06)"; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = col; drawRoundRect(ix, iy, iw, ih, w * 0.05); ctx.stroke();
      ctx.fillStyle = col; ctx.textBaseline = "middle";
      ctx.font = "800 " + (w * 0.4) + "px Archivo, system-ui, sans-serif"; ctx.fillText(lab, x + w / 2, y + h * 0.44);
      ctx.font = (w * 0.2) + "px system-ui, sans-serif"; ctx.fillText(suit, x + w / 2, y + h * 0.66);
    } else {
      var pips = PIPS[card.rank]; if (pips) {
        ctx.textBaseline = "middle"; ctx.font = (w * 0.19) + "px system-ui, sans-serif"; ctx.fillStyle = col;
        pips.forEach(function (pp) { var px = x + pp[0] * w, py = y + pp[1] * h; if (pp[1] > 0.5) { ctx.save(); ctx.translate(px, py); ctx.rotate(Math.PI); ctx.fillText(suit, 0, 0); ctx.restore(); } else ctx.fillText(suit, px, py); });
      }
    }
  }
  function drawCard(c) { if (c.faceUp) drawFace(c, c._x, c._y, c._w); else drawBack(c._x, c._y, c._w); }

  function drawChip(x, y, rad, spec, label) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.3)"; ctx.shadowBlur = rad * 0.35; ctx.shadowOffsetY = rad * 0.14;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fillStyle = spec.edge; ctx.fill(); ctx.restore();
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fillStyle = spec.face; ctx.fill();
    // dashed edge ring
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, rad * 0.82, 0, Math.PI * 2); ctx.lineWidth = rad * 0.16; ctx.strokeStyle = spec.edge;
    ctx.setLineDash([rad * 0.5, rad * 0.42]); ctx.stroke(); ctx.restore();
    // inner disc
    ctx.beginPath(); ctx.arc(x, y, rad * 0.6, 0, Math.PI * 2); ctx.fillStyle = spec.face; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, rad * 0.6, 0, Math.PI * 2); ctx.lineWidth = 1.2; ctx.strokeStyle = "rgba(255,255,255,0.22)"; ctx.stroke();
    // top sheen
    var sh = ctx.createLinearGradient(x, y - rad, x, y + rad); sh.addColorStop(0, "rgba(255,255,255,0.28)"); sh.addColorStop(0.5, "rgba(255,255,255,0)");
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fillStyle = sh; ctx.fill();
    if (label != null) { ctx.fillStyle = spec.ink; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = "800 " + (rad * 0.52) + "px Archivo, system-ui, sans-serif"; ctx.fillText(label, x, y + rad * 0.02); }
  }

  function valueBadge(cx, y, val, label, live) {
    var txt = label != null ? label : String(val);
    ctx.font = "800 " + (Math.max(13, CW * 0.2)) + "px Archivo, system-ui, sans-serif";
    var w = ctx.measureText(txt).width + 22, h = Math.max(24, CW * 0.32);
    drawRoundRect(cx - w / 2, y - h / 2, w, h, h / 2);
    ctx.fillStyle = live ? "rgba(255,231,168,0.95)" : "rgba(4,30,18,0.62)"; ctx.fill();
    if (!live) { ctx.lineWidth = 1; ctx.strokeStyle = "rgba(255,231,168,0.35)"; ctx.stroke(); }
    ctx.fillStyle = live ? "#0a3421" : "#ffe7a8"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(txt, cx, y + 1);
  }

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    var g = geom; if (!g) return;
    // felt
    var bg = ctx.createRadialGradient(W * 0.5, H * 0.4, 60, W * 0.5, H * 0.52, Math.max(W, H) * 0.85);
    bg.addColorStop(0, "#17724c"); bg.addColorStop(0.6, "#0d5637"); bg.addColorStop(1, "#073624");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // table arc markings
    ctx.save();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    var arcY = (g.dealerY + g.playerY) / 2 + CH * 0.42, arcR = Math.min(W * 0.42, 340);
    ctx.strokeStyle = "rgba(255,231,168,0.20)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(W * 0.5, arcY + arcR * 0.5, arcR, Math.PI * 1.18, Math.PI * 1.82); ctx.stroke();
    ctx.fillStyle = "rgba(255,231,168,0.34)";
    ctx.font = "800 " + Math.max(15, Math.min(W * 0.032, 26)) + "px Archivo, system-ui, sans-serif";
    ctx.fillText("BLACKJACK  PAYS  3  TO  2", W * 0.5, arcY - CH * 0.02);
    ctx.font = "700 " + Math.max(10, Math.min(W * 0.017, 14)) + "px Archivo, system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,231,168,0.26)";
    ctx.fillText("DEALER MUST STAND ON 17   ·   INSURANCE PAYS 2 TO 1", W * 0.5, arcY + CH * 0.24);
    ctx.restore();

    // shoe (stack of backs)
    for (var s = 0; s < 4; s++) { ctx.globalAlpha = 0.5 + s * 0.12; drawBack(g.shoeX - s * 1.5, g.shoeY - s * 1.5, CW * 0.7); }
    ctx.globalAlpha = 1;

    // bet circle
    ctx.beginPath(); ctx.arc(g.betX, g.betY, g.betR, 0, Math.PI * 2);
    ctx.lineWidth = 2.5; ctx.strokeStyle = "rgba(255,231,168,0.5)"; ctx.stroke();
    ctx.fillStyle = "rgba(4,30,18,0.28)"; ctx.fill();
    ctx.fillStyle = "rgba(255,231,168,0.5)"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "800 " + (g.betR * 0.34) + "px Archivo, system-ui, sans-serif";
    if (betTotal() === 0 && phase === "betting") ctx.fillText("BET", g.betX, g.betY);

    // stacked chips in bet circle
    var stackTop = drawBetStack();

    // dealer + player cards
    dealer.cards.forEach(drawCard);
    hands.forEach(function (h, i) {
      h.cards.forEach(drawCard);
    });

    // value badges
    if (dealer.cards.length) {
      var dv = (phase === "player" || phase === "insurance" || phase === "dealing") ? totalOf(shownDealer()) : totalOf(dealer.cards);
      var dLabel = (phase === "player" || phase === "insurance" || phase === "dealing") ? String(dv) : (totalOf(dealer.cards) > 21 ? "BUST " + totalOf(dealer.cards) : String(dv));
      valueBadge(W * 0.5, g.dealerY - CH * 0.34, dv, dLabel, false);
    }
    hands.forEach(function (h) {
      if (!h.cards.length) return;
      var pv = totalOf(h.cards), lbl = pv > 21 ? "BUST" : (isBJ(h) ? "BLACKJACK" : String(pv));
      if (h.result) lbl = resultLabel(h.result, pv);
      var liveHand = phase === "player" && hands[active] === h;
      valueBadge(h._cx, g.playerY + CH + CW * 0.28, pv, lbl, liveHand);
      // active-hand marker
      if (liveHand) { ctx.beginPath(); ctx.arc(h._cx, g.playerY + CH + CW * 0.62, 4, 0, Math.PI * 2); ctx.fillStyle = "#ffe7a8"; ctx.fill(); }
    });

    // chip tray (betting only)
    chipHit = [];
    if (phase === "betting") {
      var rad = Math.max(24, Math.min(CW * 0.42, 40));
      var gap = rad * 2.5, totalW = gap * (CHIPS.length - 1), sx = W * 0.5 - totalW / 2;
      for (var ci = 0; ci < CHIPS.length; ci++) {
        var cxp = sx + ci * gap;
        drawChip(cxp, g.chipY, rad, CHIPS[ci], CHIPS[ci].v);
        chipHit.push({ x: cxp, y: g.chipY, r: rad, v: CHIPS[ci].v });
      }
    }

    // headline message
    if (msg) {
      ctx.fillStyle = "#fff6cf"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = "900 " + Math.max(22, Math.min(W * 0.05, 44)) + "px Archivo, system-ui, sans-serif";
      ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 18;
      ctx.fillText(msg, W * 0.5, H * 0.5 - CH * 0.1); ctx.restore();
    }
  }

  function resultLabel(res, pv) {
    if (res === "blackjack") return "BLACKJACK";
    if (res === "win") return "WIN " + pv;
    if (res === "lose") return "LOSE";
    if (res === "push") return "PUSH";
    if (res === "bust") return "BUST";
    return String(pv);
  }

  function drawBetStack() {
    // draw the pending bet chips (betting) or the locked hand bet (in play) as a small stack
    var g = geom;
    var stack = [];
    if (phase === "betting") stack = chipStack;
    else if (hands.length && hands[0]) { // show each hand's bet as chips near its circle base — but keep the central stack simple
      stack = amountToChips(hands.reduce(function (a, h) { return a + h.bet; }, 0));
    }
    if (!stack.length) return;
    var counts = {};
    stack.forEach(function (v) { counts[v] = (counts[v] || 0) + 1; });
    var rad = g.betR * 0.44, order = [500, 100, 25, 5], baseX = g.betX, y = g.betY + g.betR * 0.15, colGap = rad * 1.9;
    var cols = order.filter(function (v) { return counts[v]; });
    var startX = baseX - (cols.length - 1) * colGap / 2;
    cols.forEach(function (v, ci) {
      var spec = chipSpec(v), n = Math.min(counts[v], 6), cx = startX + ci * colGap;
      for (var k = 0; k < n; k++) drawChip(cx, y - k * rad * 0.34, rad, spec, k === n - 1 ? v : null);
    });
    // total amount
    ctx.fillStyle = "#fff6cf"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "800 " + (g.betR * 0.4) + "px Archivo, system-ui, sans-serif";
    var amt = stack.reduce(function (a, b) { return a + b; }, 0);
    ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.45)"; ctx.shadowBlur = 8;
    ctx.fillText(money(amt), g.betX, g.betY - g.betR - 12); ctx.restore();
  }
  function chipSpec(v) { for (var i = 0; i < CHIPS.length; i++) if (CHIPS[i].v === v) return CHIPS[i]; return CHIPS[0]; }
  function amountToChips(amt) { var out = [], order = [500, 100, 25, 5]; order.forEach(function (v) { while (amt >= v) { out.push(v); amt -= v; } }); return out; }

  // ---- lerp / loop ----
  function allCards() { var a = dealer.cards.slice(); hands.forEach(function (h) { a = a.concat(h.cards); }); return a; }
  var lastTs = 0;
  function frame(ts) {
    var now = ts || performance.now();
    allCards().forEach(function (c) {
      if (now - (c._born || 0) < (c._delay || 0)) { c._x = geom.shoeX; c._y = geom.shoeY; return; }
      c._x += (c._tx - c._x) * 0.26; c._y += (c._ty - c._y) * 0.26;
      if (Math.abs(c._tx - c._x) < 0.4) c._x = c._tx;
      if (Math.abs(c._ty - c._y) < 0.4) c._y = c._ty;
    });
    render();
    requestAnimationFrame(frame);
  }

  // ============================ AUDIO ============================
  var actx = null, master = null, outGain = null, convo = null, wet = null;
  function initAudio() {
    if (actx) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      outGain = actx.createGain(); outGain.gain.value = soundOn ? 1 : 0;
      master = actx.createGain(); master.gain.value = 0.85;
      convo = actx.createConvolver(); convo.buffer = makeImpulse(1.4, 3.2);
      wet = actx.createGain(); wet.gain.value = 0.14;
      master.connect(outGain); wet.connect(convo); convo.connect(outGain); outGain.connect(actx.destination);
    } catch (e) { actx = null; }
  }
  function makeImpulse(dur, decay) {
    var n = Math.floor(actx.sampleRate * dur), buf = actx.createBuffer(2, n, actx.sampleRate);
    for (var ch = 0; ch < 2; ch++) { var d = buf.getChannelData(ch); for (var i = 0; i < n; i++) { var t = i / n; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay); } }
    return buf;
  }
  function unlock() { initAudio(); if (actx && actx.state === "suspended") actx.resume(); if (actx) { var b = actx.createBuffer(1, 1, 22050), s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0); } }
  function bus(gn) { gn.connect(master); gn.connect(wet); }
  function noise(dur) { var n = Math.floor(actx.sampleRate * dur), b = actx.createBuffer(1, n, actx.sampleRate), d = b.getChannelData(0); for (var i = 0; i < n; i++)d[i] = Math.random() * 2 - 1; var s = actx.createBufferSource(); s.buffer = b; return s; }
  function click(freq, dur, amp, type) {
    if (!actx || !soundOn) return;
    var t = actx.currentTime, s = noise(dur), bp = actx.createBiquadFilter(); bp.type = type || "bandpass"; bp.frequency.value = freq; bp.Q.value = 0.9;
    var gg = actx.createGain(); gg.gain.setValueAtTime(amp, t); gg.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(bp); bp.connect(gg); bus(gg); s.start(t); s.stop(t + dur + 0.02);
  }
  function tone(freq, dur, amp, type) {
    if (!actx || !soundOn) return;
    var t = actx.currentTime, o = actx.createOscillator(); o.type = type || "triangle"; o.frequency.value = freq;
    var gg = actx.createGain(); gg.gain.setValueAtTime(0, t); gg.gain.linearRampToValueAtTime(amp, t + 0.02); gg.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(gg); bus(gg); o.start(t); o.stop(t + dur + 0.02);
  }
  function sndDeal() { click(1700, 0.06, 0.2); }
  function sndFlip() { click(2200, 0.05, 0.24); }
  function sndBad() { if (!actx || !soundOn) return; var t = actx.currentTime, o = actx.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(80, t + 0.12); var gg = actx.createGain(); gg.gain.setValueAtTime(0.13, t); gg.gain.exponentialRampToValueAtTime(0.001, t + 0.14); o.connect(gg); bus(gg); o.start(t); o.stop(t + 0.16); }
  function sndChip() { // clay chip clack: two quick filtered clicks + a soft body tone
    click(2600, 0.03, 0.22, "bandpass"); setTimeout(function () { click(1800, 0.04, 0.16, "bandpass"); }, 22);
    tone(220, 0.06, 0.05, "sine");
  }
  function sndWin() { if (!actx || !soundOn) return; var t = actx.currentTime, notes = [0, 4, 7, 12, 16]; notes.forEach(function (st, i) { var o = actx.createOscillator(); o.type = "triangle"; o.frequency.value = 440 * Math.pow(2, st / 12); var gg = actx.createGain(); var tt = t + i * 0.09; gg.gain.setValueAtTime(0, tt); gg.gain.linearRampToValueAtTime(0.15, tt + 0.02); gg.gain.exponentialRampToValueAtTime(0.001, tt + 0.5); o.connect(gg); bus(gg); o.start(tt); o.stop(tt + 0.52); }); }
  function sndLose() { if (!actx || !soundOn) return; var t = actx.currentTime; [330, 262].forEach(function (f, i) { var o = actx.createOscillator(); o.type = "triangle"; o.frequency.value = f; var gg = actx.createGain(); var tt = t + i * 0.16; gg.gain.setValueAtTime(0, tt); gg.gain.linearRampToValueAtTime(0.12, tt + 0.02); gg.gain.exponentialRampToValueAtTime(0.001, tt + 0.4); o.connect(gg); bus(gg); o.start(tt); o.stop(tt + 0.42); }); }

  // ---- boot ----
  buildShoe();
  resize();
  refreshUI();
  setTimeout(function () { if (phase === "betting") hintEl.classList.remove("is-gone"); }, 200);
  setTimeout(function () { hintEl.classList.add("is-gone"); }, 6000);
  requestAnimationFrame(frame);
})();
