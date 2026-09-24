/* Barkeep — No. 122. Tick what is on your shelf; see what you can pour.
 *
 * The payoff is the count, not the search box: "you can make 23 tonight, and
 * a bottle of Campari would make it 29". Everything here serves that — the
 * shelf you tick, the "best next bottle" strip, and the sort that puts what
 * you can make right now first.
 *
 * Every drink's art is drawn, not loaded: a line-art glass in brass on the
 * night panel, filled with the drink's own colours, ice, bubbles, foam and
 * garnish. 154 of them, all from one function.
 */
(function () {
  "use strict";

  var B = window.BARKEEP;
  if (!B) return;

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    headline: $("headline"), lede: $("lede"),
    tabs: $("tabs"), shelf: $("shelf"), barCount: $("barCount"),
    starter: $("starterBtn"), clear: $("clearBtn"),
    nextBuy: $("nextBuy"), nextBuyList: $("nextBuyList"),
    q: $("q"), surprise: $("surpriseBtn"), seg: $("seg"),
    nMake: $("nMake"), nOne: $("nOne"), nAll: $("nAll"),
    baseChips: $("baseChips"), count: $("resultCount"), grid: $("grid"),
    empty: $("empty"), emptyAll: $("emptyAll"),
    dlg: $("recipe"), rArt: $("rArt"), rMeta: $("rMeta"), rName: $("rName"), rAka: $("rAka"),
    rStatus: $("rStatus"), rIng: $("rIng"), rMethod: $("rMethod"), rGar: $("rGar"),
    rBought: $("rBought"), rCopy: $("rCopy"), rClose: $("rClose"), rZero: $("rZero"),
    sound: $("soundBtn"),
    listBtn: $("listBtn"), listN: $("listN"), rList: $("rList"),
    fab: $("listFab"), fabN: $("listFabN"),
    sl: $("slist"), slSum: $("slSum"), slItems: $("slItems"), slEmpty: $("slEmpty"), slActions: $("slActions"),
    slShare: $("slShare"), slGot: $("slGot"), slClear: $("slClear"), slClose: $("slClose")
  };

  var KEY_BAR = "barkeep_bar", KEY_UNITS = "barkeep_units", KEY_SOUND = "barkeep_sound", KEY_LIST = "barkeep_list";
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function load(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  /* ------------------------------------------------------------- the data */

  var ITEM = {};                 // key -> {key, label, shelf, col, shape}
  B.SHELF.forEach(function (s) { ITEM[s[0]] = { key: s[0], label: s[1], shelf: s[2], col: s[3], shape: s[4] }; });
  var PANTRY = {};
  B.PANTRY.forEach(function (k) { PANTRY[k] = true; });

  var SHELVES = [
    ["spirits", "Spirits"], ["liqueurs", "Liqueurs"], ["aperitifs", "Aperitifs & wine"],
    ["mixers", "Mixers"], ["fresh", "Fresh"], ["bitters", "Syrups & bitters"], ["zero", "Zero-proof"]
  ];
  /* What contains alcohol, for the zero-proof swap line. Bitters count: a
   * couple of dashes is a trace, but a drink that needs them is not strictly
   * alcohol-free, and the line should never claim otherwise. */
  var BOOZY_SHELF = { spirits: 1, liqueurs: 1, aperitifs: 1 };
  var BOOZY_EXTRA = { angostura: 1, "orange bitters": 1, peychauds: 1 };
  function isBoozy(k) { return ITEM[k] && (BOOZY_SHELF[ITEM[k].shelf] || BOOZY_EXTRA[k]); }
  var BASES = [
    ["any", "Any"], ["gin", "Gin"], ["vodka", "Vodka"], ["rum", "Rum & cachaça"], ["tequila", "Tequila & mezcal"],
    ["whiskey", "Whiskey"], ["brandy", "Brandy"], ["wine", "Wine & aperitifs"], ["other", "Other"], ["none", "Zero-proof"]
  ];
  var BASE_LABEL = {};
  BASES.forEach(function (b) { BASE_LABEL[b[0]] = b[1]; });
  var STYLE_LABEL = {
    stirred: "Stirred", sour: "Shaken", highball: "Highball", fizz: "Fizz", tiki: "Tiki", creamy: "Creamy",
    hot: "Hot", shot: "Shot", spritz: "Spritz", sparkling: "Sparkling", savory: "Savory", zero: "Zero-proof"
  };
  var GLASS_LABEL = {
    coupe: "Coupe", martini: "Martini glass", rocks: "Rocks glass", highball: "Highball", collins: "Collins glass",
    flute: "Flute", wine: "Wine glass", mug: "Copper mug", hurricane: "Hurricane glass", tiki: "Tiki mug",
    shot: "Shot glass", toddy: "Toddy glass", julep: "Julep cup", margarita: "Margarita glass", pint: "Pint glass"
  };

  function slug(n) {
    return n.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }
  function fold(s) { return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }

  // The name an ingredient goes by IN A RECIPE, which is not always its shelf name
  function ingLabel(key, amt) {
    var num = typeof amt === "number";
    if (key === "lime") return num ? "Fresh lime juice" : "Lime";
    if (key === "lemon") return num ? "Fresh lemon juice" : "Lemon";
    if (key === "egg") return amt === "1 yolk" ? "Egg yolk" : "Egg white";
    if (key === "olives") return "Olive brine";
    if (key === "peaches") return "White peach purée";
    if (key === "honey") return num ? "Honey syrup" : "Honey";
    if (key === "cream") return "Heavy cream";
    if (key === "simple syrup") return "Simple syrup";
    if (ITEM[key]) return ITEM[key].label;
    return B.PANTRY_LABEL[key] || key;
  }

  var DRINKS = B.DRINKS.map(function (d, idx) {
    var req = [], opt = [];
    d.i.forEach(function (x) {
      if (PANTRY[x[1]]) return;
      if (x[2]) opt.push(x[1]); else if (req.indexOf(x[1]) < 0) req.push(x[1]);
    });
    var hay = [d.n, d.aka, BASE_LABEL[d.b], STYLE_LABEL[d.st], GLASS_LABEL[d.g], d.gar]
      .concat(d.i.map(function (x) { return ingLabel(x[1], x[0]) + " " + x[1]; }));
    return {
      idx: idx, d: d, id: slug(d.n), req: req, opt: opt,
      hay: fold(hay.join(" | ")), nameF: fold(d.n + " " + d.aka),
      missing: [], summary: d.i.filter(function (x) { return !PANTRY[x[1]]; })
        .map(function (x) { return ingLabel(x[1], x[0]); }).join(" · ")
    };
  });
  var BY_ID = {};
  DRINKS.forEach(function (x) { BY_ID[x.id] = x; });

  /* ---------------------------------------------------------------- state */

  var bar = {};
  (function () {
    var raw = load(KEY_BAR, "");
    if (raw) raw.split("|").forEach(function (k) { if (ITEM[k]) bar[k] = true; });
  })();
  var units = load(KEY_UNITS, "oz") === "ml" ? "ml" : "oz";
  /* The shopping list: bottles you mean to buy, in the order you added them.
   * Anything that lands on the shelf comes off it — you bought it. */
  var list = load(KEY_LIST, "").split("|").filter(function (k) { return ITEM[k]; });
  var shelfTab = "spirits";
  var base = "any";
  var view = null;               // make | one | all — chosen on first render
  var nMake = 0, nOne = 0;

  function barSize() { return Object.keys(bar).length; }
  function saveBar() { save(KEY_BAR, Object.keys(bar).join("|")); }
  function saveList() { save(KEY_LIST, list.join("|")); }
  function onList(k) { return list.indexOf(k) >= 0; }

  function analyse() {
    nMake = 0; nOne = 0;
    DRINKS.forEach(function (x) {
      x.missing = x.req.filter(function (k) { return !bar[k]; });
      if (x.missing.length === 0) nMake++;
      else if (x.missing.length === 1) nOne++;
    });
  }

  /* The shopping advice, and the most useful thing on the page: for each
   * bottle you do NOT own, how many drinks would it finish? Only drinks that
   * are missing exactly that one thing count — a bottle that gets you closer
   * to something is not a bottle that lets you pour it. */
  function bestBuys() {
    var gain = {};
    DRINKS.forEach(function (x) {
      if (x.missing.length === 1) gain[x.missing[0]] = (gain[x.missing[0]] || 0) + 1;
    });
    return Object.keys(gain).map(function (k) { return [k, gain[k]]; })
      .sort(function (a, b) { return b[1] - a[1] || ITEM[a[0]].label.localeCompare(ITEM[b[0]].label); })
      .slice(0, 4);
  }

  /* ----------------------------------------------------------------- audio */

  /* A bottle set down on a glass shelf is a CONTACT, so it is modal: a short
   * burst through the inharmonic modes of a glass bottle, a lowpassed tack in
   * front of it, and a small room behind. Taking one off is the lower, drier
   * knock of glass leaving wood. Surprise me rattles ice in a tin. */
  var audio = (function () {
    var A = null, out = null, room = null, on = load(KEY_SOUND, "1") !== "0";
    function build() {
      if (A) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      A = new AC();
      out = A.createGain(); out.gain.value = on ? 1 : 0;
      var comp = A.createDynamicsCompressor();
      comp.threshold.value = -12; comp.ratio.value = 3; comp.attack.value = 0.003; comp.release.value = 0.15;
      var lim = A.createDynamicsCompressor();
      lim.threshold.value = -1.5; lim.ratio.value = 20; lim.knee.value = 0; lim.attack.value = 0.002; lim.release.value = 0.08;
      var lp = A.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 11000;
      out.connect(comp); comp.connect(lp); lp.connect(lim); lim.connect(A.destination);
      // a small, warm room: a bar, not a hall
      var len = Math.floor(A.sampleRate * 0.9), ir = A.createBuffer(2, len, A.sampleRate);
      for (var c = 0; c < 2; c++) {
        var d = ir.getChannelData(c), f = 0;
        for (var i = 0; i < len; i++) { f += ((Math.random() * 2 - 1) - f) * 0.4; d[i] = f * Math.pow(1 - i / len, 3.2); }
      }
      var conv = A.createConvolver(); conv.buffer = ir;
      var rhp = A.createBiquadFilter(); rhp.type = "highpass"; rhp.frequency.value = 350;
      room = A.createGain(); room.gain.value = 0.28;
      room.connect(rhp); rhp.connect(conv); conv.connect(out);
      var s0 = A.createBufferSource(); s0.buffer = A.createBuffer(1, 1, A.sampleRate); s0.connect(A.destination); s0.start(0);
    }
    function noise(sec) {
      var n = Math.max(1, Math.floor(A.sampleRate * sec)), b = A.createBuffer(1, n, A.sampleRate), d = b.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      return b;
    }
    function modal(t, f0, ratios, qs, gains, amp, pan, burst) {
      var p = A.createStereoPanner ? A.createStereoPanner() : null;
      var bus = A.createGain(); bus.gain.value = amp;
      if (p) { p.pan.value = pan; bus.connect(p); p.connect(out); p.connect(room); }
      else { bus.connect(out); bus.connect(room); }
      var src = A.createBufferSource(); src.buffer = noise(burst);
      var eg = A.createGain();
      eg.gain.setValueAtTime(1, t); eg.gain.exponentialRampToValueAtTime(0.001, t + burst);
      src.connect(eg);
      ratios.forEach(function (r, m) {
        var bp = A.createBiquadFilter(); bp.type = "bandpass";
        bp.frequency.value = Math.min(15000, f0 * r); bp.Q.value = qs[m];
        var g = A.createGain(); g.gain.value = gains[m] * Math.sqrt(qs[m]);
        eg.connect(bp); bp.connect(g); g.connect(bus);
      });
      // the tack: broadband contact, lowpassed so it is a tap and not a hiss
      var tk = A.createBufferSource(); tk.buffer = noise(0.008);
      var tlp = A.createBiquadFilter(); tlp.type = "lowpass"; tlp.frequency.value = 7000;
      var tg = A.createGain(); tg.gain.setValueAtTime(0.5, t); tg.gain.exponentialRampToValueAtTime(0.001, t + 0.008);
      tk.connect(tlp); tlp.connect(tg); tg.connect(bus);
      src.start(t); tk.start(t);
      setTimeout(function () { try { bus.disconnect(); } catch (e) {} }, 2500);
    }
    return {
      unlock: function () { build(); if (A && A.state === "suspended") A.resume(); },
      set: function (v) { on = v; save(KEY_SOUND, v ? "1" : "0"); if (out) out.gain.value = v ? 1 : 0; },
      on: function () { return on; },
      clink: function (pan) {
        if (!A || !on) return;
        var f0 = 1500 + Math.random() * 700;
        modal(A.currentTime, f0, [1, 2.43, 4.18, 6.4], [90, 70, 55, 40], [0.55, 0.3, 0.16, 0.08], 0.9, pan, 0.004);
      },
      knock: function (pan) {
        if (!A || !on) return;
        modal(A.currentTime, 520 + Math.random() * 120, [1, 2.1, 3.9], [14, 10, 8], [0.6, 0.3, 0.12], 0.52, pan, 0.006);
      },
      rattle: function () {
        if (!A || !on) return;
        var t = A.currentTime;
        for (var k = 0; k < 14; k++) {
          var at = t + k * 0.055 + Math.random() * 0.02;
          modal(at, 2600 + Math.random() * 2400, [1, 2.7], [22, 18], [0.5, 0.25], 0.3 + Math.random() * 0.14, (Math.random() - 0.5) * 0.8, 0.003);
        }
      }
    };
  })();

  function paintSound() {
    var on = audio.on();
    el.sound.setAttribute("aria-pressed", on ? "true" : "false");
    el.sound.setAttribute("aria-label", on ? "Sound on" : "Sound off");
    el.sound.title = on ? "Sound on" : "Sound off";
  }

  /* --------------------------------------------------------------- bottles */

  // Silhouettes, drawn in a 60x90 box, liquid clipped inside the glass.
  var SHAPES = {
    tall:     { body: "M22 8h16v10c0 6 10 10 10 20v44a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4V38c0-10 10-14 10-20z", fill: 30, cap: [22, 2, 16, 8] },
    square:   { body: "M24 10h12v8l10 6v58a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4V24l10-6z", fill: 30, cap: [23, 3, 14, 8] },
    squat:    { body: "M24 18h12v8c10 2 14 8 14 16v40a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4V42c0-8 4-14 14-16z", fill: 40, cap: [23, 10, 14, 9] },
    flask:    { body: "M25 12h10v10l12 8v52a4 4 0 0 1-4 4H17a4 4 0 0 1-4-4V30l12-8z", fill: 36, cap: [24, 5, 12, 8] },
    decanter: { body: "M25 16h10v8c12 4 16 14 16 28c0 20-8 34-21 34S9 72 9 52c0-14 4-24 16-28z", fill: 44, cap: [22, 2, 16, 12] },
    round:    { body: "M25 14h10v10c10 4 16 14 16 28c0 18-8 34-21 34S9 70 9 52c0-14 6-24 16-28z", fill: 46, cap: [24, 7, 12, 8] },
    wine:     { body: "M25 4h10v24c8 4 12 10 12 18v36a4 4 0 0 1-4 4H17a4 4 0 0 1-4-4V46c0-8 4-14 12-18z", fill: 44, cap: [24, 0, 12, 12] },
    can:      { body: "M16 30h28a2 2 0 0 1 2 2v52a2 2 0 0 1-2 2H16a2 2 0 0 1-2-2V32a2 2 0 0 1 2-2z", fill: 0, cap: [18, 27, 24, 3] },
    carton:   { body: "M16 34l6-10h16l6 10v50a2 2 0 0 1-2 2H18a2 2 0 0 1-2-2z", fill: 0, cap: [26, 18, 8, 6] },
    dasher:   { body: "M26 40h8v6c6 2 8 6 8 12v26a2 2 0 0 1-2 2H20a2 2 0 0 1-2-2V58c0-6 2-10 8-12z", fill: 58, cap: [25, 32, 10, 8] },
    jar:      { body: "M18 44h24v4c3 2 4 4 4 8v28a2 2 0 0 1-2 2H16a2 2 0 0 1-2-2V56c0-4 1-6 4-8z", fill: 56, cap: [17, 38, 26, 6] },
    cup:      { body: "M14 56h32l-3 28a2 2 0 0 1-2 2H19a2 2 0 0 1-2-2z", fill: 60, cap: null },
    fruit:    null, herb: null, egg: null
  };

  function bottleSVG(it) {
    var c = it.col;
    if (it.shape === "fruit") {
      return '<svg viewBox="0 0 60 90" aria-hidden="true"><ellipse cx="30" cy="84" rx="22" ry="3" fill="rgba(0,0,0,.35)"/>' +
        '<circle cx="22" cy="70" r="13" fill="' + c + '" stroke="rgba(255,240,210,.5)" stroke-width="1"/>' +
        '<circle cx="39" cy="72" r="11" fill="' + c + '" stroke="rgba(255,240,210,.5)" stroke-width="1" opacity=".85"/>' +
        '<path d="M17 64a8 8 0 0 1 7-4" stroke="rgba(255,255,255,.55)" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>';
    }
    if (it.shape === "herb") {
      var leaves = "";
      [[30, 46, -20], [22, 58, -40], [38, 56, 30], [26, 70, -30], [36, 70, 25]].forEach(function (l) {
        leaves += '<ellipse cx="' + l[0] + '" cy="' + l[1] + '" rx="6" ry="11" transform="rotate(' + l[2] + ' ' + l[0] + ' ' + l[1] + ')" fill="' + c + '" stroke="rgba(220,255,200,.45)" stroke-width="1"/>';
      });
      return '<svg viewBox="0 0 60 90" aria-hidden="true"><path d="M30 84V44" stroke="#3a6a2a" stroke-width="2"/>' + leaves + '</svg>';
    }
    if (it.shape === "egg") {
      return '<svg viewBox="0 0 60 90" aria-hidden="true"><ellipse cx="30" cy="85" rx="18" ry="3" fill="rgba(0,0,0,.35)"/>' +
        '<path d="M30 48c9 0 15 14 15 23s-7 14-15 14-15-5-15-14 6-23 15-23z" fill="' + c + '" stroke="rgba(255,240,210,.6)" stroke-width="1"/>' +
        '<path d="M22 60a9 9 0 0 1 5-7" stroke="#fff" stroke-width="1.6" fill="none" opacity=".7" stroke-linecap="round"/></svg>';
    }
    var s = SHAPES[it.shape] || SHAPES.tall;
    var id = "b" + it.key.replace(/[^a-z]/g, "");
    var opaque = it.shape === "can" || it.shape === "carton" || it.shape === "cup";
    var svg = '<svg viewBox="0 0 60 90" aria-hidden="true"><defs><clipPath id="' + id + '"><path d="' + s.body + '"/></clipPath>' +
      '<linearGradient id="' + id + 'g" x1="0" x2="1"><stop offset="0" stop-color="' + c + '" stop-opacity=".95"/><stop offset=".45" stop-color="' + c + '" stop-opacity=".7"/><stop offset="1" stop-color="' + c + '" stop-opacity=".95"/></linearGradient></defs>' +
      '<ellipse cx="30" cy="86" rx="18" ry="2.6" fill="rgba(0,0,0,.4)"/>';
    if (opaque) {
      svg += '<path d="' + s.body + '" fill="url(#' + id + 'g)" stroke="rgba(255,236,200,.55)" stroke-width="1"/>' +
        '<rect x="14" y="52" width="32" height="14" fill="rgba(255,250,240,.82)" clip-path="url(#' + id + ')"/>' +
        '<rect x="14" y="58" width="32" height="2" fill="' + c + '" opacity=".6" clip-path="url(#' + id + ')"/>';
    } else {
      svg += '<path d="' + s.body + '" fill="rgba(255,255,255,.05)"/>' +
        '<rect x="0" y="' + s.fill + '" width="60" height="90" fill="url(#' + id + 'g)" clip-path="url(#' + id + ')"/>' +
        '<rect x="15" y="58" width="30" height="16" rx="1.5" fill="rgba(250,240,220,.85)" clip-path="url(#' + id + ')"/>' +
        '<rect x="19" y="63" width="22" height="1.6" fill="rgba(60,40,20,.55)"/><rect x="22" y="67" width="16" height="1.2" fill="rgba(60,40,20,.35)"/>' +
        '<path d="' + s.body + '" fill="none" stroke="rgba(255,236,200,.7)" stroke-width="1.1"/>' +
        '<path d="M17 44v26" stroke="rgba(255,255,255,.4)" stroke-width="2" stroke-linecap="round" clip-path="url(#' + id + ')"/>';
    }
    if (s.cap) svg += '<rect x="' + s.cap[0] + '" y="' + s.cap[1] + '" width="' + s.cap[2] + '" height="' + s.cap[3] + '" rx="1.5" fill="#caa05a"/>';
    return svg + "</svg>";
  }

  /* ---------------------------------------------------------------- glasses */

  /* Every glass in a 100x130 box: the bowl the liquid lives in, where its
   * surface sits, the rim a garnish perches on, and the stem and foot. */
  var GL = {
    coupe:     { bowl: "M18 40 Q20 70 50 72 Q80 70 82 40 Z", top: 45, bot: 72, rim: [18, 82, 40], stem: [72, 116], foot: 17 },
    martini:   { bowl: "M15 32 L50 76 L85 32 Z", top: 39, bot: 76, rim: [15, 85, 32], stem: [76, 116], foot: 17 },
    margarita: { bowl: "M13 30 Q20 50 40 52 Q44 53 44 58 Q44 67 50 68 Q56 67 56 58 Q56 53 60 52 Q80 50 87 30 Z", top: 35, bot: 68, rim: [13, 87, 30], stem: [68, 116], foot: 17 },
    rocks:     { bowl: "M24 60 L27 117 L73 117 L76 60 Z", top: 70, bot: 110, rim: [24, 76, 60], base: 110 },
    highball:  { bowl: "M30 22 L32 117 L68 117 L70 22 Z", top: 32, bot: 111, rim: [30, 70, 22], base: 111 },
    collins:   { bowl: "M33 12 L34 117 L66 117 L67 12 Z", top: 22, bot: 111, rim: [33, 67, 12], base: 111 },
    pint:      { bowl: "M27 18 L34 117 L66 117 L73 18 Z", top: 30, bot: 111, rim: [27, 73, 18], base: 111 },
    flute:     { bowl: "M40 12 Q37 62 50 70 Q63 62 60 12 Z", top: 22, bot: 70, rim: [40, 60, 12], stem: [70, 116], foot: 14 },
    wine:      { bowl: "M25 22 Q21 70 50 74 Q79 70 75 22 Z", top: 38, bot: 74, rim: [25, 75, 22], stem: [74, 116], foot: 17 },
    hurricane: { bowl: "M35 12 C27 36 42 50 38 70 C34 88 38 100 50 100 C62 100 66 88 62 70 C58 50 73 36 65 12 Z", top: 22, bot: 100, rim: [35, 65, 12], stem: [100, 116], foot: 16 },
    shot:      { bowl: "M36 82 L39 117 L61 117 L64 82 Z", top: 88, bot: 111, rim: [36, 64, 82], base: 111 },
    toddy:     { bowl: "M30 28 L34 88 L66 88 L70 28 Z", top: 36, bot: 88, rim: [30, 70, 28], stem: [88, 112], foot: 15, handle: true },
    mug:       { bowl: "M25 38 L27 117 L73 117 L75 38 Z", top: 44, bot: 117, rim: [25, 75, 38], opaque: "copper", handle: true },
    tiki:      { bowl: "M28 30 L30 117 L70 117 L72 30 Z", top: 36, bot: 117, rim: [28, 72, 30], opaque: "tiki" },
    julep:     { bowl: "M30 42 L32 117 L68 117 L70 42 Z", top: 44, bot: 117, rim: [30, 70, 42], opaque: "silver" }
  };

  var uid = 0;
  function shade(hex, k) {
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    function f(v) { return Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k)))); }
    return "rgb(" + f(r) + "," + f(g) + "," + f(b) + ")";
  }

  function glassSVG(d) {
    var G = GL[d.g] || GL.rocks, id = "g" + (uid++), fx = d.fx;
    var has = function (f) { return fx.indexOf(f) >= 0; };
    var cols = d.c, top = G.top, bot = G.bot;
    var s = '<svg viewBox="0 0 100 130" aria-hidden="true"><defs><clipPath id="' + id + '"><path d="' + G.bowl + '"/></clipPath>';
    cols.forEach(function (c, k) {
      s += '<linearGradient id="' + id + "c" + k + '" x1="0" x2="1"><stop offset="0" stop-color="' + shade(c, -0.22) + '"/>' +
        '<stop offset=".42" stop-color="' + shade(c, 0.12) + '"/><stop offset="1" stop-color="' + shade(c, -0.3) + '"/></linearGradient>';
    });
    s += "</defs>";
    // a pool of light under the glass
    s += '<ellipse cx="50" cy="121" rx="30" ry="3.2" fill="rgba(255,190,110,.12)"/>';

    // stem and foot first, so the bowl sits on them
    if (G.stem) {
      s += '<path d="M50 ' + G.stem[0] + ' L50 ' + G.stem[1] + '" stroke="rgba(255,244,225,.62)" stroke-width="2.2" stroke-linecap="round"/>' +
        '<ellipse cx="50" cy="' + (G.stem[1] + 2) + '" rx="' + G.foot + '" ry="3" fill="rgba(255,244,225,.08)" stroke="rgba(255,244,225,.62)" stroke-width="1.4"/>';
    }

    if (G.opaque) {
      var body = G.opaque === "copper" ? ["#7a3a18", "#e39a5c", "#8a4420"] : G.opaque === "silver" ? ["#8a8f96", "#eef1f4", "#9aa0a8"] : ["#3a5a4a", "#6aa08a", "#2a4a3a"];
      s += '<linearGradient id="' + id + 'v" x1="0" x2="1"><stop offset="0" stop-color="' + body[0] + '"/><stop offset=".4" stop-color="' + body[1] + '"/><stop offset="1" stop-color="' + body[2] + '"/></linearGradient>';
      s += '<path d="' + G.bowl + '" fill="url(#' + id + 'v)" stroke="rgba(255,240,220,.55)" stroke-width="1.2"/>';
      if (G.opaque === "tiki") {
        // a carved face: brow, eyes, a grin
        s += '<path d="M36 58h28M38 66h8M54 66h8M40 86q10 8 20 0M44 96h12" stroke="rgba(10,30,20,.65)" stroke-width="2.4" fill="none" stroke-linecap="round"/>';
      }
      if (G.opaque === "silver" && !reduceMotion) {
        s += '<path d="M34 60v50M40 56v56" stroke="rgba(255,255,255,.35)" stroke-width="1.2"/>';
      }
      if (G.handle) s += '<path d="M73 56 C88 58 88 92 73 96" fill="none" stroke="' + body[1] + '" stroke-width="4" stroke-linecap="round"/>';
      // what shows is the surface, then the ice riding above it
      s += '<ellipse cx="50" cy="' + (G.rim[2] + 3) + '" rx="' + ((G.rim[1] - G.rim[0]) / 2 - 2) + '" ry="3.4" fill="' + cols[0] + '" opacity=".92"/>';
      if (has("crushed") || G.opaque === "silver") s += crushedMound(G);
      else if (has("ice")) s += '<rect x="36" y="' + (G.rim[2] - 5) + '" width="12" height="11" rx="2" fill="rgba(235,245,255,.28)" stroke="rgba(240,248,255,.7)" stroke-width="1" transform="rotate(-8 42 ' + G.rim[2] + ')"/><rect x="52" y="' + (G.rim[2] - 3) + '" width="11" height="10" rx="2" fill="rgba(235,245,255,.24)" stroke="rgba(240,248,255,.6)" stroke-width="1" transform="rotate(10 57 ' + G.rim[2] + ')"/>';
      s += garnish(d, G);
      return s + "</svg>";
    }

    // the glass's own faint body
    s += '<path d="' + G.bowl + '" fill="rgba(255,250,240,.05)"/>';

    // liquid, in bands
    var g = '<g clip-path="url(#' + id + ')">';
    var span = bot - top, layers = cols.length;
    var floatTop = has("float") && layers > 1;
    if (layers === 1) {
      g += '<rect x="0" y="' + top + '" width="100" height="' + (span + 20) + '" fill="url(#' + id + 'c0)" opacity=".9"/>';
    } else if (floatTop) {
      var fh = Math.max(7, span * 0.2);
      g += '<rect x="0" y="' + (top + fh) + '" width="100" height="' + (span + 20) + '" fill="url(#' + id + 'c0)" opacity=".9"/>';
      g += '<rect x="0" y="' + top + '" width="100" height="' + (fh + 1) + '" fill="url(#' + id + 'c' + (layers - 1) + ')" opacity=".95"/>';
    } else {
      // layered: the first colour is at the BOTTOM, like the glass fills
      for (var k = 0; k < layers; k++) {
        var y0 = bot - span * (k + 1) / layers;
        g += '<rect x="0" y="' + y0 + '" width="100" height="' + (span / layers + (k === 0 ? 20 : 1)) + '" fill="url(#' + id + 'c' + k + ')" opacity=".92"/>';
      }
    }
    // ice
    if (has("crushed")) {
      for (var c = 0; c < 26; c++) {
        var cx = G.rim[0] + 4 + ((c * 37) % 100) / 100 * (G.rim[1] - G.rim[0] - 8);
        var cy = top + 2 + ((c * 53) % 100) / 100 * (span - 6);
        g += '<path d="M' + cx + ' ' + cy + 'l3 -2 l3 2 l-1 3 l-4 1z" fill="rgba(240,248,255,.28)" stroke="rgba(245,250,255,.5)" stroke-width=".6"/>';
      }
    } else if (has("ice")) {
      var w = G.rim[1] - G.rim[0], n = w > 44 ? 3 : 2, size = Math.min(15, w / 3.2);
      for (var i = 0; i < n * 2; i++) {
        var ix = G.rim[0] + 5 + (i % n) * (w - 10 - size) / Math.max(1, n - 1);
        var iy = top - 3 + Math.floor(i / n) * size * 1.05 + (i % 2) * 3;
        if (iy > bot - size) continue;
        g += '<rect x="' + ix + '" y="' + iy + '" width="' + size + '" height="' + size + '" rx="2.4" fill="rgba(235,245,255,.14)" stroke="rgba(240,248,255,.55)" stroke-width=".9" transform="rotate(' + ((i * 17) % 20 - 10) + ' ' + (ix + size / 2) + ' ' + (iy + size / 2) + ')"/>';
      }
    }
    // bubbles
    if (has("bubbles")) {
      for (var b = 0; b < 14; b++) {
        var bx = G.rim[0] + 6 + ((b * 29) % 100) / 100 * (G.rim[1] - G.rim[0] - 12);
        var by = top + 4 + ((b * 61) % 100) / 100 * (span - 8);
        g += '<circle cx="' + bx + '" cy="' + by + '" r="' + (0.7 + (b % 3) * 0.4) + '" fill="rgba(255,255,255,.6)"/>';
      }
    }
    // foam
    if (has("foam")) g += '<rect x="0" y="' + (top - 1) + '" width="100" height="6" fill="rgba(252,246,232,.86)"/>';
    // the meniscus
    g += '<path d="M0 ' + top + 'H100" stroke="rgba(255,255,255,.35)" stroke-width="1"/>';
    // steam
    g += "</g>";
    s += g;

    if (has("hot")) {
      s += '<path d="M42 ' + (G.rim[2] - 6) + 'q-4 -6 0 -12 t0 -12M54 ' + (G.rim[2] - 4) + 'q-4 -6 0 -12 t0 -12" stroke="rgba(255,240,220,.35)" stroke-width="1.6" fill="none" stroke-linecap="round"/>';
    }

    // the glass itself
    s += '<path d="' + G.bowl + '" fill="none" stroke="rgba(255,244,225,.72)" stroke-width="1.5" stroke-linejoin="round"/>';
    if (G.base) s += '<path d="M' + (G.rim[0] + 3.5) + ' ' + G.base + 'H' + (G.rim[1] - 3.5) + '" stroke="rgba(255,244,225,.35)" stroke-width="5"/>';
    // a highlight down the left
    s += '<path d="M' + (G.rim[0] + 5) + ' ' + (G.rim[2] + 6) + 'L' + (G.rim[0] + 7) + ' ' + (G.rim[2] + (bot - G.rim[2]) * 0.6) + '" stroke="rgba(255,255,255,.3)" stroke-width="2" stroke-linecap="round" clip-path="url(#' + id + ')"/>';
    if (G.handle) s += '<path d="M' + (G.rim[1] - 2) + ' 40 C84 42 84 70 ' + (G.rim[1] - 5) + ' 72" fill="none" stroke="rgba(255,244,225,.62)" stroke-width="1.6"/>';
    // rims
    if (has("salt") || has("sugar")) {
      var rimDots = "";
      for (var r = 0; r <= 16; r++) {
        var rx = G.rim[0] + (G.rim[1] - G.rim[0]) * r / 16;
        rimDots += '<circle cx="' + rx.toFixed(1) + '" cy="' + (G.rim[2] + (r % 2) * 0.8) + '" r="1.1" fill="rgba(255,255,255,.9)"/>';
      }
      s += rimDots;
    }
    s += garnish(d, G);
    return s + "</svg>";
  }

  function crushedMound(G) {
    var m = "", w = G.rim[1] - G.rim[0];
    for (var k = 0; k < 14; k++) {
      var x = G.rim[0] + 3 + ((k * 41) % 100) / 100 * (w - 8), y = G.rim[2] - 4 - ((k * 23) % 7);
      m += '<path d="M' + x + ' ' + y + 'l3 -2 l3 2 l-1 3 l-4 1z" fill="rgba(240,248,255,.55)" stroke="rgba(255,255,255,.7)" stroke-width=".5"/>';
    }
    return m;
  }

  /* Garnish from the words in the recipe: whatever it asks for, perched on
   * the right-hand rim. Two at most, or the glass becomes a fruit bowl. */
  function garnish(d, G) {
    var t = (d.gar || "").toLowerCase(), out = "", placed = 0;
    var rx = G.rim[1] - 4, ry = G.rim[2];
    function wheel(col, rim) {
      return '<g transform="translate(' + rx + ' ' + (ry - 2) + ')"><circle r="9" fill="' + col + '" stroke="' + rim + '" stroke-width="1.6"/>' +
        '<path d="M0 -8V8M-8 0H8M-5.6 -5.6L5.6 5.6M5.6 -5.6L-5.6 5.6" stroke="rgba(255,255,255,.55)" stroke-width=".7"/></g>';
    }
    function add(s) { if (placed < 2) { out += s; placed++; rx -= 16; } }
    if (/mint|basil/.test(t)) add('<g transform="translate(' + (rx - 2) + ' ' + (ry - 10) + ')"><path d="M0 10V-6" stroke="#3a7a3a" stroke-width="1.2"/>' +
      '<ellipse cx="-4" cy="-4" rx="4" ry="7" transform="rotate(-30 -4 -4)" fill="#4ab85a"/><ellipse cx="4" cy="-2" rx="4" ry="7" transform="rotate(30 4 -2)" fill="#3aa84a"/><ellipse cx="0" cy="-9" rx="3.5" ry="6" fill="#5ac86a"/></g>');
    if (/cherr/.test(t)) add('<g transform="translate(' + rx + ' ' + (ry - 4) + ')"><path d="M0 -4 Q4 -14 10 -16" stroke="#6a3a1a" stroke-width="1.2" fill="none"/><circle r="5" fill="#b0102a"/><circle cx="-1.6" cy="-1.6" r="1.4" fill="rgba(255,255,255,.6)"/></g>');
    if (/olive/.test(t)) add('<g><path d="M' + (rx - 14) + ' ' + (ry - 16) + 'L' + (rx - 30) + ' ' + (ry + 22) + '" stroke="#caa05a" stroke-width="1.2"/><ellipse cx="' + (rx - 20) + '" cy="' + (ry + 6) + '" rx="3.6" ry="4.6" fill="#7a8a2a"/><ellipse cx="' + (rx - 24) + '" cy="' + (ry + 14) + '" rx="3.6" ry="4.6" fill="#6a7a22"/></g>');
    if (/onion/.test(t)) add('<g><path d="M' + (rx - 14) + ' ' + (ry - 16) + 'L' + (rx - 30) + ' ' + (ry + 22) + '" stroke="#caa05a" stroke-width="1.2"/><circle cx="' + (rx - 21) + '" cy="' + (ry + 8) + '" r="4" fill="#f2eee0"/></g>');
    if (/pineapple/.test(t)) add('<g transform="translate(' + rx + ' ' + ry + ')"><path d="M-8 0 L0 -12 L8 0 Z" fill="#f2d050" stroke="#c8a030" stroke-width="1"/><path d="M-2 -12 L-5 -22 M0 -12 L0 -24 M2 -12 L5 -22" stroke="#4a9a3a" stroke-width="1.6"/></g>');
    if (/celery/.test(t)) add('<path d="M' + (rx - 6) + ' ' + (ry + 30) + 'L' + (rx + 4) + ' ' + (ry - 26) + '" stroke="#8ac85a" stroke-width="4" stroke-linecap="round"/>');
    if (/coffee bean/.test(t)) {
      var cx = (G.rim[0] + G.rim[1]) / 2;
      out += [-7, 0, 7].map(function (o) { return '<ellipse cx="' + (cx + o) + '" cy="' + (G.top - 1) + '" rx="2.6" ry="1.7" fill="#3a1c0a"/>'; }).join("");
    }
    if (/nutmeg|bitters dotted/.test(t)) {
      var nx = (G.rim[0] + G.rim[1]) / 2;
      for (var k = 0; k < 7; k++) out += '<circle cx="' + (nx - 10 + k * 3.3) + '" cy="' + (G.top + (k % 2)) + '" r=".9" fill="' + (/nutmeg/.test(t) ? "#8a5a2a" : "#8a1a0a") + '"/>';
    }
    if (/lime/.test(t) && !/spent/.test(t)) add(wheel("#b8e070", "#6aa82a"));
    else if (/lemon/.test(t)) add(/twist|peel/.test(t) ? peel("#f2d83a", rx, ry) : wheel("#f6e67a", "#d8b82a"));
    else if (/grapefruit/.test(t)) add(wheel("#f6a8a0", "#e0806a"));
    else if (/orange/.test(t)) add(/twist|peel/.test(t) ? peel("#f5a030", rx, ry) : wheel("#f8b860", "#e8841a"));
    if (/berr|blackberr/.test(t)) add('<g transform="translate(' + rx + ' ' + (ry - 4) + ')"><circle r="4" fill="#5a0a3a"/><circle cx="5" cy="2" r="4" fill="#7a1040"/><circle cx="-1" cy="1" r="1.2" fill="rgba(255,255,255,.4)"/></g>');
    if (/apple/.test(t)) add('<g transform="translate(' + rx + ' ' + (ry - 4) + ')"><path d="M-9 0 A9 9 0 0 1 9 0 Z" fill="#f2f0c8" stroke="#8ac83a" stroke-width="1.6"/></g>');
    if (/passion/.test(t)) add('<g transform="translate(' + ((G.rim[0] + G.rim[1]) / 2) + ' ' + (G.top - 2) + ')"><ellipse rx="9" ry="4" fill="#5a2a4a"/><ellipse rx="7" ry="2.6" fill="#f0b030"/></g>');
    if (/cucumber|strawberr/.test(t)) add('<g transform="translate(' + rx + ' ' + (ry - 3) + ')"><circle r="7" fill="#d8f0b0" stroke="#3a8a3a" stroke-width="1.6"/><circle cx="-12" cy="4" r="5" fill="#e0304a"/></g>');
    return out;
  }
  function peel(col, rx, ry) {
    return '<path d="M' + (rx - 8) + ' ' + (ry - 2) + 'c4 -8 10 -2 6 4 s6 10 10 2" stroke="' + col + '" stroke-width="3" fill="none" stroke-linecap="round"/>';
  }

  /* ----------------------------------------------------------------- units */

  /* Quarter ounces only: that is how a bar writes a spec and how a jigger is
   * marked. Thirds turned 50 ml into "1⅔ oz", which nobody pours. */
  var FR = [[0, ""], [0.25, "¼"], [0.5, "½"], [0.75, "¾"], [1, ""]];
  function fmt(amt) {
    if (typeof amt !== "number") return amt.charAt(0).toUpperCase() + amt.slice(1);
    if (units === "ml") return (Math.round(amt * 2) / 2) + " ml";
    if (amt <= 5) return "1 tsp";
    var oz = amt / 30, whole = Math.floor(oz), rest = oz - whole, best = FR[0];
    FR.forEach(function (f) { if (Math.abs(rest - f[0]) < Math.abs(rest - best[0])) best = f; });
    if (best[0] === 1) { whole++; best = FR[0]; }
    return (whole ? whole : "") + best[1] + " oz";
  }

  /* ------------------------------------------------------------- rendering */

  function renderTabs() {
    el.tabs.innerHTML = SHELVES.map(function (s) {
      var n = B.SHELF.filter(function (x) { return x[2] === s[0] && bar[x[0]]; }).length;
      return '<button type="button" class="tab" role="tab" data-s="' + s[0] + '" aria-selected="' + (s[0] === shelfTab) + '">' +
        s[1] + (n ? '<span class="tab__n">' + n + "</span>" : "") + "</button>";
    }).join("");
  }

  function renderShelf() {
    el.shelf.innerHTML = B.SHELF.filter(function (x) { return x[2] === shelfTab; }).map(function (x) {
      var it = ITEM[x[0]], on = !!bar[x[0]];
      return '<button type="button" class="bottle' + (on ? " is-on" : "") + '" data-k="' + it.key + '" aria-pressed="' + on + '">' +
        bottleSVG(it) + '<span class="bottle__label">' + it.label + "</span></button>";
    }).join("");
  }

  function renderHeadline() {
    var n = barSize();
    if (!n) {
      el.headline.innerHTML = "What's on your shelf?";
      el.lede.textContent = "Tick the bottles you own. Barkeep shows every drink you can pour tonight, and the one bottle that would open up the most new ones.";
      window.OPT_SHARE_TEXT = undefined;
      return;
    }
    el.headline.innerHTML = nMake ? 'You can make <em class="n">' + nMake + "</em> " + (nMake === 1 ? "drink" : "drinks") + " tonight"
      : "Nothing to pour yet";
    el.lede.textContent = nOne ? (nOne + (nOne === 1 ? " more is" : " more are") + " one ingredient away. The best bottle to add is just below your shelf.")
      : (nMake ? "Every drink below with a green tick is ready to pour." : "Add a few more bottles. A base spirit, a citrus and a sweetener go a long way.");
    window.OPT_SHARE_TEXT = nMake ? "My bar can make " + nMake + " cocktails tonight. What can yours make?" : undefined;
  }

  function renderNextBuy() {
    var buys = barSize() ? bestBuys() : [];
    el.nextBuy.hidden = !buys.length;
    el.nextBuyList.innerHTML = buys.map(function (b) {
      var l = onList(b[0]);
      return '<span class="buy' + (l ? " is-listed" : "") + '"><button type="button" class="buy__main" data-k="' + b[0] + '" aria-pressed="' + l + '" title="' +
        (l ? "On your shopping list" : "Add to your shopping list") + '">' + ITEM[b[0]].label + " <b>+" + b[1] + '</b><span class="buy__add">' + (l ? "✓ listed" : "+ list") + "</span></button>" +
        '<button type="button" class="buy__have" data-k="' + b[0] + '" title="I already have this">have it</button></span>';
    }).join("");
    el.barCount.textContent = barSize() + " on the shelf";
  }

  function renderChips() {
    el.baseChips.innerHTML = BASES.map(function (b) {
      return '<button type="button" class="chip" data-b="' + b[0] + '" aria-pressed="' + (b[0] === base) + '">' + b[1] + "</button>";
    }).join("");
  }

  function matches(x, toks) {
    for (var i = 0; i < toks.length; i++) if (x.hay.indexOf(toks[i]) < 0) return false;
    return true;
  }

  function renderGrid() {
    var q = fold(el.q.value.trim()), toks = q ? q.split(/\s+/) : [];
    var list = DRINKS.filter(function (x) {
      if (base !== "any" && x.d.b !== base) return false;
      if (view === "make" && x.missing.length) return false;
      if (view === "one" && x.missing.length !== 1) return false;
      return !toks.length || matches(x, toks);
    });
    var hasBar = barSize() > 0;
    list.sort(function (a, b) {
      if (toks.length) {
        var an = a.nameF.indexOf(q) === 0 ? 0 : a.nameF.indexOf(toks[0]) >= 0 ? 1 : 2;
        var bn = b.nameF.indexOf(q) === 0 ? 0 : b.nameF.indexOf(toks[0]) >= 0 ? 1 : 2;
        if (an !== bn) return an - bn;
      }
      if (hasBar && a.missing.length !== b.missing.length) return a.missing.length - b.missing.length;
      return a.d.n.localeCompare(b.d.n);
    });
    uid = 0;
    el.grid.innerHTML = list.map(card).join("");
    el.empty.hidden = list.length > 0;
    el.count.textContent = list.length + (list.length === 1 ? " drink" : " drinks") +
      (q ? " matching “" + el.q.value.trim() + "”" : "");
    el.nMake.textContent = nMake; el.nOne.textContent = nOne; el.nAll.textContent = DRINKS.length;
    [].forEach.call(el.seg.querySelectorAll("button"), function (b) { b.setAttribute("aria-pressed", b.dataset.f === view ? "true" : "false"); });
  }

  function statusOf(x) {
    if (!barSize()) return ["", ""];
    if (!x.missing.length) return ["is-ready", "✓ Ready to pour"];
    var names = x.missing.map(function (k) { return ITEM[k].label; });
    if (names.length === 1) return ["is-one", "Need " + names[0]];
    return ["", "Need " + names.length + ": " + names.slice(0, 2).join(", ") + (names.length > 2 ? "…" : "")];
  }

  function card(x) {
    var st = statusOf(x);
    return '<button type="button" class="card" data-id="' + x.id + '">' +
      '<span class="card__art">' + glassSVG(x.d) + "</span>" +
      '<span class="card__body"><span class="card__name">' + x.d.n + "</span>" +
      '<span class="card__ing">' + x.summary + "</span>" +
      (st[1] ? '<span class="card__status ' + st[0] + '">' + st[1] + "</span>" : "") +
      "</span></button>";
  }

  function renderAll() {
    analyse();
    if (view === null) view = barSize() && nMake ? "make" : "all";
    renderTabs(); renderShelf(); renderHeadline(); renderNextBuy(); renderChips(); renderGrid();
  }

  /* ----------------------------------------------------------------- recipe */

  var current = null;
  function openRecipe(id, push) {
    var x = BY_ID[id];
    if (!x) return;
    current = x;
    var d = x.d;
    uid = 900;
    el.rArt.innerHTML = glassSVG(d);
    // a highball served in a highball says so once
    var meta = [BASE_LABEL[d.b], STYLE_LABEL[d.st]];
    if (GLASS_LABEL[d.g] !== STYLE_LABEL[d.st]) meta.push(GLASS_LABEL[d.g]);
    el.rMeta.textContent = meta.join(" · ");
    el.rName.textContent = d.n;
    el.rAka.textContent = d.aka ? "Also known as the " + d.aka : "";
    paintRecipe();
    el.rMethod.textContent = d.m;
    el.rGar.innerHTML = "<b>Garnish</b> " + d.gar;
    el.rZero.innerHTML = zeroLine(d);
    el.rZero.hidden = !el.rZero.innerHTML;
    if (!el.dlg.open) {
      if (el.dlg.showModal) el.dlg.showModal(); else el.dlg.setAttribute("open", "");
    }
    if (push !== false) { try { history.replaceState(null, "", "#" + x.id); } catch (e) {} }
    if (window.gtag) gtag("event", "select_content", { content_type: "drink", item_id: x.id });
  }

  function paintRecipe() {
    var x = current, d = x.d, hasBar = barSize() > 0;
    el.rIng.innerHTML = d.i.map(function (it) {
      var k = it[1], pantry = PANTRY[k], have = pantry || bar[k], opt = !!it[2];
      var tag = !hasBar ? "" : opt ? '<span class="opt">optional</span>' : pantry ? "" :
        have ? '<span class="have">✓ have</span>' : '<span class="miss">need</span>';
      return '<li class="' + (hasBar && !have && !opt ? "is-missing" : "") + '"><span class="amt">' + fmt(it[0]) +
        '</span><span class="name">' + ingLabel(k, it[0]) + "</span>" + tag + "</li>";
    }).join("");
    var st = statusOf(x);
    el.rStatus.className = "recipe__status " + (st[0] === "is-ready" ? "is-ready" : "");
    el.rStatus.textContent = !hasBar ? "Tick your bottles on the shelf to see what you're missing." :
      !x.missing.length ? "✓ You have everything for this one." :
      "Missing " + x.missing.map(function (k) { return ITEM[k].label; }).join(", ") + ".";
    el.rBought.hidden = !hasBar || !x.missing.length;
    var need = x.missing.filter(function (k) { return !onList(k); });
    el.rList.hidden = !x.missing.length;
    el.rList.disabled = !need.length;
    el.rList.textContent = !need.length ? "✓ On your list" : hasBar ? "Add missing to list" : "Add to shopping list";
  }

  /* "Make it zero-proof" — only when every alcoholic ingredient has a
   * stand-in. Optional ones are simply left out of the zero-proof version. */
  var PROPER = { campari: 1, aperol: 1 };
  function lc(k) { return PROPER[k] ? ITEM[k].label : ITEM[k].label.charAt(0).toLowerCase() + ITEM[k].label.slice(1); }
  /* A classic with its own zero-proof recipe points at it ("Zero-Proof
   * French 75", "Americano Zero", or aka "Zero-Proof Negroni"): a recipe built
   * for no alcohol beats a swap every time. */
  var ZERO_OF = {}, BY_NAME = {};
  DRINKS.forEach(function (x) {
    if (x.d.b === "none") return;
    BY_NAME[slug(x.d.n)] = x;
    if (x.d.aka) BY_NAME[slug(x.d.aka)] = x;          // "G&T", "Spritz"
  });
  DRINKS.forEach(function (x) {
    if (x.d.b !== "none") return;
    [x.d.n, x.d.aka].forEach(function (nm) {
      var m = /^Zero-Proof (.+)$/.exec(nm) || /^(.+) Zero$/.exec(nm);
      var classic = m && BY_NAME[slug(m[1])];
      if (classic) ZERO_OF[classic.id] = x;
    });
  });
  function zeroLine(d) {
    if (d.b === "none") return "";
    var own = ZERO_OF[slug(d.n)];
    if (own) return "<b>Make it zero-proof</b> There's a proper zero-proof version: " +
      '<button type="button" class="linkbtn" data-open="' + own.id + '">' + own.d.n + "</button>.";
    var swaps = [], ok = true, any = false;
    d.i.forEach(function (x) {
      if (!isBoozy(x[1])) return;
      any = true;
      if (x[2]) return;
      var to = B.SWAPS[x[1]];
      if (!to) { ok = false; return; }
      var line = lc(x[1]) + " for " + lc(to);
      if (swaps.indexOf(line) < 0) swaps.push(line);
    });
    if (!any || !ok || !swaps.length) return "";
    return "<b>Make it zero-proof</b> Swap the " + swaps.join(", and the ") + ". Expect a lighter body; a touch more syrup or citrus usually balances it.";
  }

  function closeRecipe() {
    if (el.dlg.open) { if (el.dlg.close) el.dlg.close(); else el.dlg.removeAttribute("open"); }
  }
  el.dlg.addEventListener("close", function () {
    current = null;
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
  });
  // a click on the backdrop lands on the dialog element itself
  el.dlg.addEventListener("click", function (e) { if (e.target === el.dlg) closeRecipe(); });
  el.rClose.addEventListener("click", closeRecipe);
  el.rZero.addEventListener("click", function (e) {
    var b = e.target.closest("[data-open]");
    if (b) openRecipe(b.dataset.open);
  });
  el.rBought.addEventListener("click", function () {
    if (!current) return;
    audio.unlock();
    current.missing.slice().forEach(function (k, i) {
      bar[k] = true;
      dropFromList(k);
      setTimeout(function () { audio.clink((Math.random() - 0.5) * 0.6); }, i * 90);
    });
    saveBar(); renderAll(); paintRecipe();
  });
  el.rList.addEventListener("click", function () {
    if (!current) return;
    addToList(current.missing);
    paintRecipe();
  });
  el.rCopy.addEventListener("click", function () {
    if (!current) return;
    var url = location.origin + location.pathname + "#" + current.id;
    var done = function () { el.rCopy.textContent = "Link copied"; setTimeout(function () { el.rCopy.textContent = "Copy link"; }, 1600); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, done);
    else done();
  });

  /* ---------------------------------------------------------- the list */

  function paintListBtn(bump) {
    var label = "Shopping list, " + list.length + (list.length === 1 ? " item" : " items");
    el.listN.textContent = list.length;
    el.fabN.textContent = list.length;
    el.listBtn.setAttribute("aria-label", label);
    el.fab.setAttribute("aria-label", label);
    paintFab();
    if (bump && !reduceMotion) {
      [el.listBtn, el.fab].forEach(function (b) { b.classList.remove("bump"); void b.offsetWidth; b.classList.add("bump"); });
    }
  }

  /* The floating copy exists for the recipe grid, where you decide you need
   * something. It only shows when the list has items AND the shelf's own
   * button is off screen, so the two are never on view together. */
  var shelfBtnVisible = true;
  function paintFab() {
    el.fab.hidden = !list.length;
    el.fab.classList.toggle("is-away", shelfBtnVisible || !list.length);
  }
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (es) {
      shelfBtnVisible = es[es.length - 1].isIntersecting;
      paintFab();
    }).observe(el.listBtn);
  }
  function addToList(keys) {
    var added = 0;
    keys.forEach(function (k) { if (ITEM[k] && !bar[k] && !onList(k)) { list.push(k); added++; } });
    if (!added) return;
    saveList();
    audio.unlock(); audio.clink(0.3);
    paintListBtn(true);
    if (window.gtag) gtag("event", "barkeep_list_add", { value: list.length });
  }
  function dropFromList(k) {
    var i = list.indexOf(k);
    if (i < 0) return;
    list.splice(i, 1);
    saveList();
    paintListBtn(false);
    if (el.sl.open) renderList();
  }

  /* What the list is FOR. A drink counts as unlocked when everything it is
   * missing is on the list, so the summary is the honest answer to "if I buy
   * all of this, what can I make?" Each line then says which of those drinks
   * that bottle is part of, or, if none yet, the nearest drink it helps. */
  function listPlan() {
    var inList = {};
    list.forEach(function (k) { inList[k] = true; });
    var unlocked = DRINKS.filter(function (x) {
      return x.missing.length && x.missing.every(function (k) { return inList[k]; });
    });
    var per = {};
    list.forEach(function (k) {
      var mine = unlocked.filter(function (x) { return x.missing.indexOf(k) >= 0; }).map(function (x) { return x.d.n; });
      var near = null;
      if (!mine.length) {
        var c = DRINKS.filter(function (x) { return x.missing.indexOf(k) >= 0; })
          .sort(function (a, b) { return a.missing.length - b.missing.length || a.d.n.localeCompare(b.d.n); })[0];
        if (c) near = [c.d.n, c.missing.filter(function (m) { return !inList[m]; }).length];
      }
      per[k] = { drinks: mine, near: near };
    });
    return { unlocked: unlocked, per: per };
  }

  function forLine(p) {
    if (p.drinks.length) return "For " + p.drinks.slice(0, 3).join(", ") + (p.drinks.length > 3 ? " +" + (p.drinks.length - 3) + " more" : "");
    if (p.near) return "Toward " + p.near[0] + (p.near[1] ? " (still needs " + p.near[1] + " more)" : "");
    return "";
  }

  function renderList() {
    var plan = listPlan(), n = plan.unlocked.length;
    el.slEmpty.hidden = list.length > 0;
    el.slActions.hidden = list.length === 0;
    el.slSum.innerHTML = !list.length ? "" : n
      ? "Buy these " + list.length + " and you can make <b>" + n + " more " + (n === 1 ? "drink" : "drinks") + "</b>."
      : "These get you closer, but nothing is finished yet.";
    el.slItems.innerHTML = list.map(function (k) {
      return '<li><span class="slist__name">' + ITEM[k].label + '</span><span class="slist__for">' + forLine(plan.per[k]) + "</span>" +
        '<button type="button" class="slist__x" data-k="' + k + '" aria-label="Remove ' + ITEM[k].label + '">×</button></li>';
    }).join("");
  }

  function listText() {
    var plan = listPlan();
    var lines = ["Shopping list"].concat(list.map(function (k) {
      var f = forLine(plan.per[k]);
      return "- " + ITEM[k].label + (f ? " (" + f.charAt(0).toLowerCase() + f.slice(1) + ")" : "");
    }));
    return lines.join("\n") + "\n\nFrom Barkeep: " + location.origin + location.pathname;
  }

  function openList() {
    renderList();
    if (el.sl.showModal) el.sl.showModal(); else el.sl.setAttribute("open", "");
    if (window.gtag) gtag("event", "barkeep_list_open", { value: list.length });
  }
  el.listBtn.addEventListener("click", openList);
  el.fab.addEventListener("click", openList);
  function closeList() { if (el.sl.open) { if (el.sl.close) el.sl.close(); else el.sl.removeAttribute("open"); } }
  el.slClose.addEventListener("click", closeList);
  el.sl.addEventListener("click", function (e) { if (e.target === el.sl) closeList(); });
  el.slItems.addEventListener("click", function (e) {
    var x = e.target.closest(".slist__x");
    if (!x) return;
    dropFromList(x.dataset.k);
    renderNextBuy();
    if (current) paintRecipe();
  });
  el.slClear.addEventListener("click", function () {
    list = []; saveList(); paintListBtn(false); renderList(); renderNextBuy();
  });
  el.slGot.addEventListener("click", function () {
    audio.unlock();
    list.slice().forEach(function (k, i) {
      bar[k] = true;
      setTimeout(function () { audio.clink((Math.random() - 0.5) * 0.6); }, i * 90);
    });
    list = []; saveList(); saveBar();
    paintListBtn(false);
    closeList();
    renderAll();
  });
  /* On a phone the share sheet puts it straight into Notes or a message; on a
   * desktop the clipboard is the useful place. Plain text either way. */
  el.slShare.addEventListener("click", function () {
    var text = listText();
    var done = function (msg) { el.slShare.textContent = msg; setTimeout(function () { el.slShare.textContent = "Share list"; }, 1600); };
    var coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    if (coarse && navigator.share) {
      navigator.share({ title: "Shopping list", text: text }).catch(function () {});
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done("Copied"); }, function () { done("Couldn't copy"); });
    } else done("Couldn't copy");
    if (window.gtag) gtag("event", "barkeep_list_share", { value: list.length });
  });

  /* ----------------------------------------------------------------- input */

  function toggle(k, btn) {
    audio.unlock();
    var pan = 0;
    if (btn) {
      var r = btn.getBoundingClientRect();
      pan = Math.max(-0.8, Math.min(0.8, ((r.left + r.width / 2) / window.innerWidth - 0.5) * 1.6));
    }
    if (bar[k]) { delete bar[k]; audio.knock(pan); }
    else { bar[k] = true; audio.clink(pan); dropFromList(k); }
    saveBar();
    var before = nMake;
    analyse();
    renderTabs(); renderHeadline(); renderNextBuy(); renderGrid();
    // update this one bottle in place, so its lift animation is not lost to a re-render
    var b = el.shelf.querySelector('[data-k="' + k + '"]');
    if (b) {
      b.classList.toggle("is-on", !!bar[k]);
      b.setAttribute("aria-pressed", bar[k] ? "true" : "false");
      if (bar[k] && !reduceMotion) { b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop"); }
    }
    if (nMake > before && window.gtag) gtag("event", "barkeep_unlock", { value: nMake });
  }

  el.shelf.addEventListener("click", function (e) {
    var b = e.target.closest(".bottle");
    if (b) toggle(b.dataset.k, b);
  });
  el.tabs.addEventListener("click", function (e) {
    var t = e.target.closest(".tab");
    if (!t) return;
    shelfTab = t.dataset.s;
    renderTabs(); renderShelf();
  });
  el.tabs.addEventListener("keydown", function (e) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    var i = SHELVES.findIndex(function (s) { return s[0] === shelfTab; });
    i = (i + (e.key === "ArrowRight" ? 1 : SHELVES.length - 1)) % SHELVES.length;
    shelfTab = SHELVES[i][0];
    renderTabs(); renderShelf();
    var t = el.tabs.querySelector('[data-s="' + shelfTab + '"]');
    if (t) t.focus();
  });
  el.nextBuyList.addEventListener("click", function (e) {
    var have = e.target.closest(".buy__have"), main = e.target.closest(".buy__main");
    if (have) {
      var k = have.dataset.k;
      if (ITEM[k].shelf !== shelfTab) { shelfTab = ITEM[k].shelf; renderShelf(); }
      toggle(k, have);
    } else if (main) {
      if (onList(main.dataset.k)) dropFromList(main.dataset.k); else addToList([main.dataset.k]);
      renderNextBuy();
    }
  });
  el.starter.addEventListener("click", function () {
    audio.unlock();
    B.STARTER.forEach(function (k, i) {
      if (!bar[k]) setTimeout(function () { audio.clink((i / B.STARTER.length - 0.5) * 1.2); }, i * 55);
      bar[k] = true;
      dropFromList(k);
    });
    saveBar();
    analyse();
    view = "make";
    renderAll();
  });
  el.clear.addEventListener("click", function () {
    if (!barSize()) return;
    audio.unlock(); audio.knock(0);
    bar = {};
    saveBar();
    view = "all";
    renderAll();
  });

  el.q.addEventListener("input", renderGrid);
  el.seg.addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    view = b.dataset.f;
    renderGrid();
  });
  el.emptyAll.addEventListener("click", function () { view = "all"; base = "any"; renderChips(); renderGrid(); });
  el.baseChips.addEventListener("click", function (e) {
    var c = e.target.closest(".chip");
    if (!c) return;
    base = c.dataset.b;
    renderChips(); renderGrid();
  });
  document.querySelector(".units").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    units = b.dataset.u;
    save(KEY_UNITS, units);
    [].forEach.call(document.querySelectorAll(".units button"), function (x) { x.setAttribute("aria-pressed", x.dataset.u === units ? "true" : "false"); });
    if (current) paintRecipe();
  });
  el.grid.addEventListener("click", function (e) {
    var c = e.target.closest(".card");
    if (c) openRecipe(c.dataset.id);
  });
  el.surprise.addEventListener("click", function () {
    audio.unlock(); audio.rattle();
    // from what you can make if you can make anything; otherwise from the lot
    var pool = DRINKS.filter(function (x) { return barSize() && !x.missing.length; });
    if (!pool.length) pool = DRINKS;
    var pick = pool[Math.floor(Math.random() * pool.length)];
    if (window.gtag) gtag("event", "barkeep_surprise", { item_id: pick.id });
    setTimeout(function () { openRecipe(pick.id); }, reduceMotion ? 0 : 520);
  });
  el.sound.addEventListener("click", function () {
    audio.set(!audio.on());
    paintSound();
    if (audio.on()) { audio.unlock(); audio.clink(0); }
  });
  window.addEventListener("hashchange", function () {
    var id = location.hash.slice(1);
    if (BY_ID[id]) openRecipe(id, false); else closeRecipe();
  });

  [].forEach.call(document.querySelectorAll(".units button"), function (x) { x.setAttribute("aria-pressed", x.dataset.u === units ? "true" : "false"); });
  paintSound();
  // a bottle that reached the shelf some other way is no longer something to buy
  list = list.filter(function (k) { return !bar[k]; });
  saveList();
  paintListBtn(false);
  renderAll();
  // a shared link opens straight onto its drink
  var start = location.hash.slice(1);
  if (BY_ID[start]) openRecipe(start, false);

  try {
    if (typeof window.gtag === "function") window.gtag("event", "toy_start", { toy: "barkeep" });
  } catch (e) {}
})();
