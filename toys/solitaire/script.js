/* Solitaire — classic Klondike. Vanilla Canvas 2D, self-contained.
 * 7 tableau columns, 4 foundations, stock + waste. Drag valid descending
 * alternating-color runs; double-click sends a card home; Draw 1/3; undo;
 * bouncing win cascade. */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var controlsEl = document.getElementById("controls");
  var overlay = document.getElementById("overlay");
  var ovTitle = document.getElementById("ovTitle");
  var ovText = document.getElementById("ovText");
  var ovBtn = document.getElementById("ovBtn");
  var statChip = document.getElementById("statChip");
  var newBtn = document.getElementById("newBtn");
  var undoBtn = document.getElementById("undoBtn");
  var drawBtn = document.getElementById("drawBtn");
  var soundBtn = document.getElementById("soundBtn");
  var hintEl = document.getElementById("hint");

  var W = 0, H = 0, DPR = 1;
  var SUITS = ["♠", "♥", "♦", "♣"];   // spade heart diamond club
  var RED = { 1: true, 2: true };                          // suit index → red
  function isRed(s) { return s === 1 || s === 2; }
  function rankLabel(r) { return r === 1 ? "A" : r === 11 ? "J" : r === 12 ? "Q" : r === 13 ? "K" : String(r); }

  // pip layouts (normalized 0..1 within card face); y>0.5 drawn inverted
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

  // ---- state ----
  var stock = [], waste = [], foundations = [[], [], [], []], tableau = [[], [], [], [], [], [], []];
  var geom = null, drag = null, undoStack = [], snap = null;
  var draw3 = true, soundOn = true;
  var moves = 0, startTime = 0, elapsed = 0, won = false;
  var cascade = [], cascadeLayer = null, clayer = null;
  var lastTap = { t: 0, card: null };

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * DPR); canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    cascadeLayer = document.createElement("canvas");
    cascadeLayer.width = canvas.width; cascadeLayer.height = canvas.height;
    clayer = cascadeLayer.getContext("2d");
    clayer.setTransform(DPR, 0, 0, DPR, 0, 0);
    layout();
  }
  window.addEventListener("resize", resize);

  // ---- layout geometry ----
  function layout() {
    var cols = 7;
    // start the board below the (possibly wrapped) control bar so they never overlap
    var ctrlBottom = controlsEl ? controlsEl.getBoundingClientRect().bottom : 0;
    var topPad = Math.max(52, H * 0.085, ctrlBottom + 14);
    var side = Math.max(8, W * 0.02);
    var gap = Math.max(5, W * 0.012);
    var wFit = (W - side * 2 - gap * (cols - 1)) / cols;           // width constraint
    var bottomPad = Math.max(22, H * 0.03);
    var hCap = (H - topPad - bottomPad) * 0.44;                     // height constraint (top card + tableau baseline)
    var cardW = Math.max(28, Math.min(wFit, hCap / 1.4, 132));
    var cardH = cardW * 1.4;
    var rowGap = Math.max(12, cardH * 0.16);
    var totalW = cardW * cols + gap * (cols - 1);
    var ox = (W - totalW) / 2;
    var tabX = [], fx = [];
    for (var c = 0; c < cols; c++) tabX.push(ox + c * (cardW + gap));
    for (var i = 0; i < 4; i++) fx.push(tabX[3 + i]);              // foundations at right cols 3..6
    var topY = topPad, tableauY = topY + cardH + rowGap;
    geom = {
      cardW: cardW, cardH: cardH, gap: gap, tabX: tabX, fx: fx, stockX: tabX[0], wasteX: tabX[1],
      topY: topY, tableauY: tableauY, wasteFan: cardW * 0.26,
      vBudget: H - tableauY - bottomPad,                           // room for the tallest column
      prefFanDown: cardH * 0.28, prefFanUp: cardH * 0.12,
      fanDown: cardH * 0.28, fanUp: cardH * 0.12
    };
    positionAll();
  }

  function positionAll() {
    if (!geom) return;
    var g = geom;
    // adaptive fan: compress overlap so the longest current column stays on-screen
    var longest = 1;
    tableau.forEach(function (col) { if (col.length > longest) longest = col.length; });
    var fanDown = g.prefFanDown, fanUp = g.prefFanUp;
    if (longest > 1) {
      var maxFan = (g.vBudget - g.cardH) / (longest - 1);
      if (maxFan < fanDown) { fanDown = Math.max(g.cardH * 0.07, maxFan); fanUp = Math.min(fanUp, fanDown * 0.62); }
    }
    g.fanDown = fanDown; g.fanUp = fanUp;
    // stock
    stock.forEach(function (cd) { cd._x = g.stockX; cd._y = g.topY; cd._w = g.cardW; cd._h = g.cardH; });
    // waste — always fan the last up-to-3 cards so the previous two stay visible
    // (and the card left behind shows when you play the top one)
    var shown = Math.min(3, waste.length);
    waste.forEach(function (cd, i) {
      var back = waste.length - i;                 // 1 = top (rightmost, playable)
      var fanIdx = Math.max(0, shown - back);
      cd._x = g.wasteX + fanIdx * g.wasteFan; cd._y = g.topY; cd._w = g.cardW; cd._h = g.cardH;
    });
    foundations.forEach(function (p, fi) { p.forEach(function (cd) { cd._x = g.fx[fi]; cd._y = g.topY; cd._w = g.cardW; cd._h = g.cardH; }); });
    tableau.forEach(function (col, ci) {
      var y = g.tableauY;
      col.forEach(function (cd) {
        cd._x = g.tabX[ci]; cd._y = y; cd._w = g.cardW; cd._h = g.cardH;
        y += cd.faceUp ? g.fanDown : g.fanUp;
      });
    });
  }

  // ---- deck / deal ----
  function newGame() {
    var deck = [];
    for (var s = 0; s < 4; s++) for (var r = 1; r <= 13; r++) deck.push({ rank: r, suit: s, faceUp: false });
    for (var i = deck.length - 1; i > 0; i--) { var j = (Math.random() * (i + 1)) | 0; var t = deck[i]; deck[i] = deck[j]; deck[j] = t; }
    stock = []; waste = []; foundations = [[], [], [], []]; tableau = [[], [], [], [], [], [], []];
    for (var c = 0; c < 7; c++) {
      for (var k = 0; k <= c; k++) { var cd = deck.pop(); cd.faceUp = (k === c); tableau[c].push(cd); }
    }
    while (deck.length) { var d = deck.pop(); d.faceUp = false; stock.push(d); }
    undoStack = []; moves = 0; startTime = 0; elapsed = 0; won = false; drag = null; cascade = [];
    overlay.classList.add("is-hidden"); overlay.hidden = true;
    if (clayer) clayer.clearRect(0, 0, W, H);
    hintEl.classList.remove("is-gone");
    setTimeout(function () { hintEl.classList.add("is-gone"); }, 4500);
    layout(); updateChip(); updateUndo();
  }

  // ---- serialize for undo ----
  function snapshot() {
    var enc = function (p) { return p.map(function (c) { return c.rank + "," + c.suit + "," + (c.faceUp ? 1 : 0); }).join("|"); };
    return {
      s: enc(stock), w: enc(waste),
      f: foundations.map(enc), t: tableau.map(enc), moves: moves
    };
  }
  function pushUndo() { undoStack.push(snapshot()); updateUndo(); }
  function decode(str) { return str ? str.split("|").map(function (t) { var a = t.split(","); return { rank: +a[0], suit: +a[1], faceUp: a[2] === "1" }; }) : []; }
  function restore(snap) {
    stock = decode(snap.s); waste = decode(snap.w);
    foundations = snap.f.map(decode); tableau = snap.t.map(decode);
    moves = snap.moves; won = false;
    overlay.classList.add("is-hidden"); overlay.hidden = true;
    positionAll(); updateChip(); updateUndo();
  }
  function undo() {
    if (!undoStack.length) return;
    restore(undoStack.pop());
    sndFlip();
  }
  function updateUndo() { undoBtn.disabled = undoStack.length === 0; }

  // ---- rules ----
  function canStackTableau(moving, ontoCol) {
    if (ontoCol.length === 0) return moving.rank === 13;         // empty accepts King
    var top = ontoCol[ontoCol.length - 1];
    return top.faceUp && isRed(moving.suit) !== isRed(top.suit) && moving.rank === top.rank - 1;
  }
  function canFoundation(card, fpile) {
    if (fpile.length === 0) return card.rank === 1;
    var top = fpile[fpile.length - 1];
    return card.suit === top.suit && card.rank === top.rank + 1;
  }

  // ---- moves ----
  function afterMove() {
    if (startTime === 0) startTime = performance.now();
    moves++; updateChip(); positionAll();
    checkWin();
  }
  function flipIfNeeded(col) {
    if (col.length && !col[col.length - 1].faceUp) { col[col.length - 1].faceUp = true; sndFlip(); }
  }
  function drawStock() {
    pushUndo();
    if (stock.length === 0) {
      // recycle waste back to stock (reversed, face-down)
      if (waste.length === 0) { undoStack.pop(); updateUndo(); return; }
      while (waste.length) { var c = waste.pop(); c.faceUp = false; stock.push(c); }
      sndDeal();
    } else {
      var n = draw3 ? 3 : 1;
      for (var i = 0; i < n && stock.length; i++) { var d = stock.pop(); d.faceUp = true; waste.push(d); }
      sndDeal();
    }
    afterMove();
  }

  // move a run (1+ cards) from a source pile to a destination pile
  function performMove(run, src, dest) {
    pushUndo();
    if (src.type === "waste") waste.pop();
    else if (src.type === "found") foundations[src.col].pop();
    else if (src.type === "tableau") tableau[src.col].splice(tableau[src.col].length - run.length, run.length);
    if (dest.type === "found") { foundations[dest.col].push(run[0]); sndPlace(true); }
    else { for (var k = 0; k < run.length; k++) tableau[dest.col].push(run[k]); sndPlace(false); }
    if (src.type === "tableau") flipIfNeeded(tableau[src.col]);
    afterMove();
  }

  // double-click: auto-play a card (or the run sitting on it) to the best legal spot —
  // foundation first for a single card, otherwise a valid tableau column (non-empty preferred)
  function autoPlay(hit) {
    var run = hit.run, src = hit.source, card = run[0];
    if (run.length === 1) {
      for (var f = 0; f < 4; f++) if (canFoundation(card, foundations[f])) { performMove(run, src, { type: "found", col: f }); return true; }
    }
    var empty = -1;
    for (var c = 0; c < 7; c++) {
      if (src.type === "tableau" && src.col === c) continue;   // skip its own column
      var col = tableau[c];
      if (canStackTableau(card, col)) {
        if (col.length) { performMove(run, src, { type: "tableau", col: c }); return true; }   // prefer real stacks
        if (empty < 0) empty = c;
      }
    }
    if (empty >= 0) { performMove(run, src, { type: "tableau", col: empty }); return true; }
    sndBad(); return false;
  }

  function checkWin() {
    var total = foundations.reduce(function (a, p) { return a + p.length; }, 0);
    if (total === 52 && !won) { won = true; startCascade(); }
  }

  // ---- win cascade ----
  function startCascade() {
    var g = geom, all = [];
    foundations.forEach(function (p, fi) { p.forEach(function (c) { all.push({ card: c, x: g.fx[fi], y: g.topY }); }); });
    cascade = all.map(function (o, i) {
      return { card: o.card, x: o.x, y: o.y, vx: (Math.random() * 2 - 1) * 240, vy: -Math.random() * 120 - 40, w: g.cardW, h: g.cardH, delay: i * 55 };
    });
    cascadeStart = performance.now();
    sndWin();
    setTimeout(function () {
      ovTitle.textContent = "You win!";
      ovText.textContent = "Cleared the board in " + fmtTime(elapsed) + " and " + moves + " moves.";
      overlay.hidden = false; overlay.classList.remove("is-hidden");
    }, 3200);
  }
  var cascadeStart = 0;

  // ---- input ----
  function evtXY(e) { return { x: e.clientX, y: e.clientY }; }
  function hitCard(x, y) {
    // returns {card, source:{type,col}, run:[cards]} for the topmost pickable card
    // tableau (topmost columns first by z is same; check each col from last card up)
    for (var c = 0; c < 7; c++) {
      var col = tableau[c];
      for (var i = col.length - 1; i >= 0; i--) {
        var cd = col[i];
        var h = (i === col.length - 1) ? cd._h : (col[i + 1]._y - cd._y);
        if (x >= cd._x && x <= cd._x + cd._w && y >= cd._y && y <= cd._y + h) {
          if (!cd.faceUp) return null;
          return { card: cd, source: { type: "tableau", col: c }, run: col.slice(i) };
        }
      }
    }
    // waste top
    if (waste.length) {
      var wt = waste[waste.length - 1];
      if (x >= wt._x && x <= wt._x + wt._w && y >= wt._y && y <= wt._y + wt._h) return { card: wt, source: { type: "waste" }, run: [wt] };
    }
    // foundation tops
    for (var f = 0; f < 4; f++) {
      var fp = foundations[f]; if (!fp.length) continue;
      var ft = fp[fp.length - 1];
      if (x >= ft._x && x <= ft._x + ft._w && y >= ft._y && y <= ft._y + ft._h) return { card: ft, source: { type: "found", col: f }, run: [ft] };
    }
    return null;
  }
  function inStock(x, y) { var g = geom; return x >= g.stockX && x <= g.stockX + g.cardW && y >= g.topY && y <= g.topY + g.cardH; }

  var press = null;
  function onDown(e) {
    unlock();
    if (won) return;
    var p = evtXY(e);
    if (inStock(p.x, p.y)) { press = { stock: true, x: p.x, y: p.y, moved: false }; return; }
    var hit = hitCard(p.x, p.y);
    if (!hit) { press = null; return; }
    press = { hit: hit, x: p.x, y: p.y, ox: p.x - hit.card._x, oy: p.y - hit.card._y, moved: false };
  }
  function onMove(e) {
    if (!press) return;
    var p = evtXY(e);
    if (!press.moved && Math.hypot(p.x - press.x, p.y - press.y) > 6) {
      press.moved = true;
      if (press.hit) drag = { run: press.hit.run, source: press.hit.source, ox: press.ox, oy: press.oy, x: p.x, y: p.y };
    }
    if (drag) { drag.x = p.x; drag.y = p.y; }
  }
  function onUp(e) {
    if (!press) return;
    var p = evtXY(e);
    if (press.stock) { if (!press.moved) drawStock(); press = null; return; }
    if (!press.moved) {
      // tap — detect double-tap → auto to foundation
      var now = performance.now(), hit = press.hit;
      if (hit && lastTap.card === hit.card && now - lastTap.t < 420) {
        autoPlay(hit); lastTap = { t: 0, card: null };
      } else { lastTap = { t: now, card: hit ? hit.card : null }; }
      press = null; return;
    }
    // drop
    if (drag) dropRun(p);
    drag = null; press = null;
  }
  function dropRun(p) {
    var run = drag.run, src = drag.source, bottom = run[0];
    var bx = p.x - drag.ox, by = p.y - drag.oy;   // bottom card top-left after drag
    var best = null, bestOv = 0, g = geom;
    function ov(tx, ty) {
      var ix = Math.max(0, Math.min(bx + g.cardW, tx + g.cardW) - Math.max(bx, tx));
      var iy = Math.max(0, Math.min(by + g.cardH, ty + g.cardH) - Math.max(by, ty));
      return ix * iy;
    }
    // foundations (single card only)
    if (run.length === 1) {
      for (var f = 0; f < 4; f++) {
        var o = ov(g.fx[f], g.topY);
        if (o > bestOv && canFoundation(bottom, foundations[f])) { bestOv = o; best = { type: "found", col: f }; }
      }
    }
    // tableau columns
    for (var c = 0; c < 7; c++) {
      var col = tableau[c];
      var ty = col.length ? col[col.length - 1]._y : g.tableauY;
      var o2 = ov(g.tabX[c], ty);
      if (o2 > bestOv && canStackTableau(bottom, col)) { bestOv = o2; best = { type: "tableau", col: c }; }
    }
    if (!best) {
      positionAll();                                  // cards are still in their source pile → home positions set
      snap = { run: run, fromX: bx, fromY: by, toX: run[0]._x, toY: run[0]._y, t: 0, dur: 0.16 };
      sndBad(); return;
    }
    performMove(run, src, best);
  }

  canvas.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", function () { if (drag) positionAll(); drag = null; press = null; });

  newBtn.addEventListener("click", function () { newGame(); });
  undoBtn.addEventListener("click", function () { undo(); });
  ovBtn.addEventListener("click", function () { newGame(); });
  drawBtn.addEventListener("click", function () {
    draw3 = !draw3; drawBtn.textContent = draw3 ? "Draw 3" : "Draw 1"; drawBtn.setAttribute("aria-pressed", draw3 ? "true" : "false");
    positionAll();
  });
  soundBtn.addEventListener("click", function () {
    soundOn = !soundOn; soundBtn.textContent = "Sound: " + (soundOn ? "on" : "off"); soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
    if (outGain) outGain.gain.value = soundOn ? 1 : 0; unlock();
  });

  function fmtTime(ms) { var s = Math.floor(ms / 1000); return Math.floor(s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60); }
  function updateChip() { statChip.textContent = "MOVES " + moves + " · " + fmtTime(elapsed); }

  // ============================ RENDER ============================
  function drawRoundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function drawPlaceholder(x, y) {
    var g = geom, r = g.cardW * 0.1;
    drawRoundRect(x, y, g.cardW, g.cardH, r);
    ctx.fillStyle = "rgba(255,255,255,0.06)"; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.stroke();
  }
  function drawBack(x, y) {
    var g = geom, r = g.cardW * 0.1;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.22)"; ctx.shadowBlur = g.cardW * 0.05; ctx.shadowOffsetY = g.cardW * 0.02;
    drawRoundRect(x, y, g.cardW, g.cardH, r); ctx.fillStyle = "#fbfaf7"; ctx.fill();
    ctx.restore();
    var m = g.cardW * 0.07;
    drawRoundRect(x + m, y + m, g.cardW - 2 * m, g.cardH - 2 * m, r * 0.7);
    var bg = ctx.createLinearGradient(x, y, x + g.cardW, y + g.cardH);
    bg.addColorStop(0, "#b21f2e"); bg.addColorStop(1, "#7c1420");
    ctx.fillStyle = bg; ctx.fill();
    // lattice
    ctx.save(); drawRoundRect(x + m, y + m, g.cardW - 2 * m, g.cardH - 2 * m, r * 0.7); ctx.clip();
    ctx.strokeStyle = "rgba(255,255,255,0.16)"; ctx.lineWidth = 1;
    var step = g.cardW * 0.22;
    for (var i = -g.cardH; i < g.cardW + g.cardH; i += step) {
      ctx.beginPath(); ctx.moveTo(x + i, y); ctx.lineTo(x + i + g.cardH, y + g.cardH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + i, y + g.cardH); ctx.lineTo(x + i + g.cardH, y); ctx.stroke();
    }
    ctx.restore();
    drawRoundRect(x, y, g.cardW, g.cardH, r); ctx.lineWidth = 1; ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.stroke();
  }
  function drawFace(card, x, y) {
    var g = geom, w = g.cardW, h = g.cardH, r = w * 0.1;
    // body — soft shadow applied to the base only, then cleared so the pips/index stay crisp
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.22)"; ctx.shadowBlur = w * 0.05; ctx.shadowOffsetY = w * 0.02;
    drawRoundRect(x, y, w, h, r); ctx.fillStyle = "#fcfbf8"; ctx.fill();
    ctx.restore();
    ctx.lineWidth = 1; ctx.strokeStyle = "rgba(0,0,0,0.16)"; drawRoundRect(x, y, w, h, r); ctx.stroke();
    var col = isRed(card.suit) ? "#d21f3c" : "#1b1b22";
    var lab = rankLabel(card.rank), suit = SUITS[card.suit];
    // corner index (top-left + bottom-right rotated) — compact
    ctx.fillStyle = col; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    var rf = w * 0.22, sf = w * 0.16, pad = w * 0.12;
    ctx.font = "800 " + rf + "px Archivo, system-ui, sans-serif";
    ctx.fillText(lab, x + pad, y + pad + rf * 0.82);
    ctx.font = sf + "px system-ui, sans-serif";
    ctx.fillText(suit, x + pad, y + pad + rf * 0.82 + sf * 0.98);
    ctx.save(); ctx.translate(x + w - pad, y + h - pad); ctx.rotate(Math.PI);
    ctx.font = "800 " + rf + "px Archivo, system-ui, sans-serif"; ctx.fillText(lab, 0, rf * 0.82);
    ctx.font = sf + "px system-ui, sans-serif"; ctx.fillText(suit, 0, rf * 0.82 + sf * 0.98);
    ctx.restore();
    // center
    if (card.rank === 1) {
      ctx.font = (w * 0.4) + "px system-ui, sans-serif"; ctx.textBaseline = "middle";
      ctx.fillText(suit, x + w / 2, y + h / 2);
    } else if (card.rank >= 11) {
      // court: framed letter + suit
      var ix = x + w * 0.2, iy = y + h * 0.14, iw = w * 0.6, ih = h * 0.72;
      drawRoundRect(ix, iy, iw, ih, w * 0.05);
      ctx.fillStyle = isRed(card.suit) ? "rgba(210,31,60,0.07)" : "rgba(27,27,34,0.06)"; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = col; drawRoundRect(ix, iy, iw, ih, w * 0.05); ctx.stroke();
      ctx.fillStyle = col; ctx.textBaseline = "middle";
      ctx.font = "800 " + (w * 0.4) + "px Archivo, system-ui, sans-serif"; ctx.fillText(lab, x + w / 2, y + h * 0.44);
      ctx.font = (w * 0.2) + "px system-ui, sans-serif"; ctx.fillText(suit, x + w / 2, y + h * 0.66);
    } else {
      var pips = PIPS[card.rank]; if (pips) {
        ctx.textBaseline = "middle"; ctx.font = (w * 0.19) + "px system-ui, sans-serif"; ctx.fillStyle = col;
        pips.forEach(function (pp) {
          var px = x + pp[0] * w, py = y + pp[1] * h;
          if (pp[1] > 0.5) { ctx.save(); ctx.translate(px, py); ctx.rotate(Math.PI); ctx.fillText(suit, 0, 0); ctx.restore(); }
          else ctx.fillText(suit, px, py);
        });
      }
    }
  }
  function drawCard(card, x, y) { if (card.faceUp) drawFace(card, x, y); else drawBack(x, y); }

  function render() {
    if (startTime && !won) elapsed = performance.now() - startTime;
    if (moves >= 0) updateChip();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    // felt
    var bg = ctx.createRadialGradient(W * 0.5, H * 0.42, 60, W * 0.5, H * 0.5, Math.max(W, H) * 0.8);
    bg.addColorStop(0, "#1a7a52"); bg.addColorStop(0.6, "#0f6040"); bg.addColorStop(1, "#083b28");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    var g = geom; if (!g) return;

    // placeholders
    drawPlaceholder(g.stockX, g.topY);
    drawPlaceholder(g.wasteX, g.topY);
    for (var f = 0; f < 4; f++) {
      drawPlaceholder(g.fx[f], g.topY);
      // faint suit hint
      ctx.globalAlpha = 0.16; ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = (g.cardW * 0.36) + "px system-ui, sans-serif"; ctx.fillText(SUITS[f], g.fx[f] + g.cardW / 2, g.topY + g.cardH / 2); ctx.globalAlpha = 1;
    }
    for (var c = 0; c < 7; c++) drawPlaceholder(g.tabX[c], g.tableauY);

    // stock (show a back if any, else recycle glyph)
    if (stock.length) drawBack(g.stockX, g.topY);
    else { ctx.globalAlpha = 0.5; ctx.fillStyle = "#eafff2"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = (g.cardW * 0.4) + "px system-ui, sans-serif"; ctx.fillText("↻", g.stockX + g.cardW / 2, g.topY + g.cardH / 2); ctx.globalAlpha = 1; }

    var dragging = drag ? drag.run : [];
    function isDragged(cd) { return dragging.indexOf(cd) !== -1 || (snap && snap.run.indexOf(cd) !== -1); }

    // waste
    waste.forEach(function (cd) { if (!isDragged(cd)) drawCard(cd, cd._x, cd._y); });
    // foundations
    foundations.forEach(function (p) { p.forEach(function (cd) { if (!isDragged(cd)) drawCard(cd, cd._x, cd._y); }); });
    // tableau (each card bakes its own soft body shadow)
    tableau.forEach(function (col) {
      col.forEach(function (cd) { if (!isDragged(cd)) drawCard(cd, cd._x, cd._y); });
    });

    // dragged run — a stronger lift shadow under the whole run
    if (drag) {
      var bx = drag.x - drag.ox, by = drag.y - drag.oy;
      ctx.save(); ctx.shadowColor = "rgba(0,0,0,0.32)"; ctx.shadowBlur = 16; ctx.shadowOffsetY = 8;
      ctx.fillStyle = "#fcfbf8";
      drag.run.forEach(function (cd, i) { drawRoundRect(bx, by + i * g.fanDown, g.cardW, g.cardH, g.cardW * 0.1); ctx.fill(); });
      ctx.restore();
      drag.run.forEach(function (cd, i) { drawCard(cd, bx, by + i * g.fanDown); });
    }

    // snap-back animation (invalid drop eases the run home)
    if (snap) {
      var f = Math.min(1, snap.t / snap.dur); f = 1 - Math.pow(1 - f, 3);   // easeOutCubic
      var sx = snap.fromX + (snap.toX - snap.fromX) * f, sy = snap.fromY + (snap.toY - snap.fromY) * f;
      snap.run.forEach(function (cd, i) { drawCard(cd, sx, sy + i * g.fanDown); });
    }

    // win cascade
    if (won && cascade.length) {
      ctx.drawImage(cascadeLayer, 0, 0, W, H);
    }
  }

  function stepCascade(dt, ts) {
    if (!won || !cascade.length) return;
    var g = geom, GACC = 2200, alive = 0;
    for (var i = 0; i < cascade.length; i++) {
      var c = cascade[i];
      if (ts - cascadeStart < c.delay) { alive++; continue; }
      c.vy += GACC * dt; c.x += c.vx * dt; c.y += c.vy * dt;
      if (c.y + c.h > H) { c.y = H - c.h; c.vy = -c.vy * 0.78; c.vx *= 0.98; }
      // draw onto persistent layer
      clayer.save();
      var cd = c.card; cd._w = c.w; cd._h = c.h;
      // temporarily draw with main routines onto clayer
      var save = ctx; drawOnto(clayer, cd, c.x, c.y);
      clayer.restore();
      if (c.x > -g.cardW - 40 && c.x < W + 40) alive++;
    }
    if (alive === 0) cascade = [];
  }
  function drawOnto(context, card, x, y) {
    var prev = ctx; ctx = context; drawFace(card, x, y); ctx = prev;
  }

  var lastTs = 0;
  function frame(ts) {
    var dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.05) : 0; lastTs = ts;
    stepCascade(dt, ts);
    if (snap) { snap.t += dt; if (snap.t >= snap.dur) snap = null; }
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
      convo = actx.createConvolver(); convo.buffer = makeImpulse(1.1, 3);
      wet = actx.createGain(); wet.gain.value = 0.12;
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
  function sndFlip() { click(2200, 0.05, 0.25); }
  function sndDeal() { click(1700, 0.06, 0.22); }
  function sndBad() { if (!actx || !soundOn) return; var t = actx.currentTime, o = actx.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(80, t + 0.12); var gg = actx.createGain(); gg.gain.setValueAtTime(0.14, t); gg.gain.exponentialRampToValueAtTime(0.001, t + 0.14); o.connect(gg); bus(gg); o.start(t); o.stop(t + 0.16); }
  function sndPlace(toFoundation) {
    click(1300, 0.05, 0.28);
    if (!actx || !soundOn) return;
    var t = actx.currentTime, o = actx.createOscillator(); o.type = "triangle";
    o.frequency.value = toFoundation ? 560 : 300;
    var gg = actx.createGain(); gg.gain.setValueAtTime(toFoundation ? 0.12 : 0.07, t); gg.gain.exponentialRampToValueAtTime(0.001, t + (toFoundation ? 0.22 : 0.12));
    o.connect(gg); bus(gg); o.start(t); o.stop(t + 0.24);
  }
  function sndWin() {
    if (!actx || !soundOn) return;
    var t = actx.currentTime, notes = [0, 4, 7, 12, 16, 19];
    notes.forEach(function (st, i) { var o = actx.createOscillator(); o.type = "triangle"; o.frequency.value = 440 * Math.pow(2, st / 12); var gg = actx.createGain(); var tt = t + i * 0.11; gg.gain.setValueAtTime(0, tt); gg.gain.linearRampToValueAtTime(0.16, tt + 0.02); gg.gain.exponentialRampToValueAtTime(0.001, tt + 0.5); o.connect(gg); bus(gg); o.start(tt); o.stop(tt + 0.52); });
  }

  // ---- boot ----
  resize();
  newGame();
  requestAnimationFrame(frame);
})();
