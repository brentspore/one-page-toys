/* Recipe Scaler: the page. The parsing and the arithmetic live in scaler.js;
 * this file turns them into an index card whose amounts roll like an
 * odometer, a stamp that thunks down when the batch changes, and a sticky
 * note for "I only have 2 eggs". */
(function () {
  "use strict";

  var RS = window.RecipeScaler;
  var SAMPLES = window.RS_SAMPLES || [];
  if (!RS) return;

  function $(id) { return document.getElementById(id); }
  var reduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var KEY = { text: "recipescaler_text", sample: "recipescaler_sample", units: "recipescaler_units", scale: "recipescaler_scale", sound: "recipescaler_sound", hinted: "recipescaler_hinted" };
  function load(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function save(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, String(v)); } catch (e) {} }
  function ga(name, params) { try { if (typeof window.gtag === "function") window.gtag("event", name, params || {}); } catch (e) {} }
  var gaLast = {};
  function gaThrottled(name, params, key) {
    var now = Date.now(), k = name + (key || "");
    if (gaLast[k] && now - gaLast[k] < 2000) return;
    gaLast[k] = now; ga(name, params);
  }

  var el = {
    pasteK: $("pasteK"), pasteName: $("pasteName"), pasteBox: $("pasteBox"), pasteFine: $("pasteFine"), src: $("src"),
    newBtn: $("newBtn"), editBtn: $("editBtn"), sampleBtn: $("sampleBtn"),
    dash: $("dash"), servings: $("servings"), noun: $("nounLbl"), minus: $("minusBtn"), plus: $("plusBtn"), orig: $("origIn"),
    chips: $("chips"), units: $("units"), tip: $("tip"),
    desk: $("desk"), card: $("card"), title: $("cardTitle"), yield: $("cardYield"), unitsLbl: $("cardUnits"), lines: $("lines"),
    stamp: $("stamp"), stampTop: $("stampTop"), stampBig: $("stampBig"), stampBot: $("stampBot"),
    have: $("have"), haveQ: $("haveQ"), haveOf: $("haveOf"), haveAmt: $("haveAmt"), haveUnit: $("haveUnit"), haveNoun: $("haveNoun"),
    haveMinus: $("haveMinus"), havePlus: $("havePlus"), haveGo: $("haveGo"), haveX: $("haveX"), haveErr: $("haveErr"),
    copy: $("copyBtn"), copyLbl: $("copyLbl"), print: $("printBtn"), sound: $("soundBtn"), live: $("live"),
    mini: $("mini"), miniV: $("miniV"), miniMinus: $("miniMinus"), miniPlus: $("miniPlus")
  };

  var S = {
    text: "", R: null, out: null, factor: 1, mode: "asis", anchor: null,
    origN: 1, hasYield: false, nounWord: "batches",
    isSample: false, sampleIdx: 0,
    figs: {}, open: -1, hinted: load(KEY.hinted, "0") === "1", painted: false
  };
  var MIN_F = 1 / 32, MAX_F = 64;

  /* ------------------------------------------------------------- audio */

  /* Paper and wood, in a small kitchen. A figure rolling over is a detent
   * clicking on a little counter wheel (modal, high and dry). Pressing a line
   * is a fingertip on a card on a table. The stamp is a rubber face slapping
   * paper with a wooden table under it: a broadband slap, a low thump and the
   * table's own knock. */
  var audio = (function () {
    var A = null, bus = null, room = null, out = null;
    var on = load(KEY.sound, "1") !== "0";
    var pool = {};
    function build() {
      if (A) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { A = new AC(); } catch (e) { A = null; return; }
      bus = A.createGain();
      var comp = A.createDynamicsCompressor();
      comp.threshold.value = -16; comp.ratio.value = 3; comp.knee.value = 6; comp.attack.value = 0.003; comp.release.value = 0.16;
      var lp = A.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 12500;
      var lim = A.createDynamicsCompressor();
      lim.threshold.value = -1.5; lim.ratio.value = 20; lim.knee.value = 0; lim.attack.value = 0.002; lim.release.value = 0.08;
      out = A.createGain(); out.gain.value = on ? 1 : 0;
      bus.connect(comp); comp.connect(lp); lp.connect(lim); lim.connect(out); out.connect(A.destination);
      var len = Math.floor(A.sampleRate * 0.6), ir = A.createBuffer(2, len, A.sampleRate);
      for (var c = 0; c < 2; c++) {
        var d = ir.getChannelData(c), f = 0;
        for (var i = 0; i < len; i++) {
          f += ((Math.random() * 2 - 1) - f) * 0.32;
          d[i] = f * Math.pow(1 - i / len, 3.8) * (i < 90 ? i / 90 : 1);
        }
      }
      scrub(ir);
      var conv = A.createConvolver(); conv.buffer = ir;
      var rhp = A.createBiquadFilter(); rhp.type = "highpass"; rhp.frequency.value = 260;
      room = A.createGain(); room.gain.value = 0.2;
      room.connect(rhp); rhp.connect(conv); conv.connect(bus);
      var s0 = A.createBufferSource(); s0.buffer = A.createBuffer(1, 1, A.sampleRate); s0.connect(A.destination); s0.start(0);
    }
    function scrub(b) {
      for (var c = 0; c < b.numberOfChannels; c++) {
        var d = b.getChannelData(c);
        for (var i = 0; i < d.length; i++) if (!isFinite(d[i])) d[i] = 0;
      }
      return b;
    }
    function noise(sec) {
      var key = Math.round(sec * 1000), list = pool[key] || (pool[key] = []);
      if (list.length < 6) {
        var n = Math.max(2, Math.floor(A.sampleRate * sec)), b = A.createBuffer(1, n, A.sampleRate), d = b.getChannelData(0);
        for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
        list.push(b);
        return b;
      }
      return list[Math.floor(Math.random() * list.length)];
    }
    function voice(amp, pan, wet) {
      var g = A.createGain(); g.gain.value = amp;
      var p = A.createStereoPanner ? A.createStereoPanner() : null;
      var dry = p || g;
      if (p) { p.pan.value = Math.max(-1, Math.min(1, pan || 0)); g.connect(p); }
      dry.connect(bus);
      if (wet !== 0) { var w = A.createGain(); w.gain.value = wet == null ? 1 : wet; dry.connect(w); w.connect(room); }
      setTimeout(function () { try { g.disconnect(); if (p) p.disconnect(); } catch (e) {} }, 3000);
      return g;
    }
    // a short burst through the object's own modes, with a lowpassed tack in front
    function modal(t, dest, f0, ratios, qs, gains, burst, tack, tackLP) {
      var src = A.createBufferSource(); src.buffer = noise(burst);
      var eg = A.createGain();
      eg.gain.setValueAtTime(1, t); eg.gain.exponentialRampToValueAtTime(0.001, t + burst);
      src.connect(eg);
      for (var m = 0; m < ratios.length; m++) {
        var bp = A.createBiquadFilter(); bp.type = "bandpass";
        bp.frequency.value = Math.min(16000, f0 * ratios[m]); bp.Q.value = qs[m];
        var g = A.createGain(); g.gain.value = gains[m] * Math.sqrt(qs[m]);
        eg.connect(bp); bp.connect(g); g.connect(dest);
      }
      if (tack) {
        var tk = A.createBufferSource(); tk.buffer = noise(0.006);
        var tl = A.createBiquadFilter(); tl.type = "lowpass"; tl.frequency.value = tackLP || 8000;
        var tg = A.createGain(); tg.gain.setValueAtTime(tack, t); tg.gain.exponentialRampToValueAtTime(0.001, t + 0.006);
        tk.connect(tl); tl.connect(tg); tg.connect(dest);
        tk.start(t);
      }
      src.start(t);
    }
    function thump(t, dest, amp, f1, f2, dur) {
      var o = A.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(f1, t); o.frequency.exponentialRampToValueAtTime(f2, t + dur);
      var g = A.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(amp, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.02);
    }
    function hiss(t, dest, amp, dur, type, freq, q, attack) {
      var s = A.createBufferSource(); s.buffer = noise(dur);
      var f = A.createBiquadFilter(); f.type = type; f.frequency.value = freq; if (q) f.Q.value = q;
      var g = A.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(amp, t + (attack || 0.002)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(dest); s.start(t);
      return f;
    }
    function now(d) { return A.currentTime + (d || 0); }
    return {
      unlock: function () { build(); if (A && A.state === "suspended") { try { A.resume(); } catch (e) {} } },
      on: function () { return on; },
      set: function (v) { on = v; save(KEY.sound, v ? "1" : "0"); if (out) out.gain.value = v ? 1 : 0; },
      // one counter-wheel detent; pitch drifts a little so a wave of them is not a machine gun
      tick: function (delay, pan, vel) {
        if (!A || !on) return;
        var t = now(delay), v = vel == null ? 1 : vel;
        var dest = voice(0.22 * v, pan, 0.25);
        modal(t, dest, 2300 * (0.92 + Math.random() * 0.16), [1, 2.31, 3.86], [24, 18, 12], [0.5, 0.24, 0.1], 0.0018, 0.28, 9000);
      },
      // a fingertip on a card on a wooden table
      press: function () {
        if (!A || !on) return;
        var t = now(0.005), dest = voice(0.75, 0, 0.35);
        modal(t, dest, 182 + Math.random() * 18, [1, 2.47, 4.1], [9, 7, 5], [0.62, 0.3, 0.12], 0.014, 0.25, 2500);
        hiss(t, dest, 0.16, 0.035, "lowpass", 900, 0.7);
      },
      // a sticky note peeled and pressed down
      slip: function () {
        if (!A || !on) return;
        var t = now(0.005), dest = voice(0.5, -0.1, 0.4);
        var f = hiss(t, dest, 0.24, 0.16, "bandpass", 2600, 0.9, 0.03);
        f.frequency.setValueAtTime(2600, t); f.frequency.exponentialRampToValueAtTime(1500, t + 0.16);
        modal(t + 0.14, dest, 210, [1, 2.4], [8, 6], [0.4, 0.15], 0.004, 0.12, 3000);
      },
      // rubber on paper on wood
      stamp: function (delay) {
        if (!A || !on) return;
        var t = now(delay), dest = voice(0.37, 0.18, 0.55);
        hiss(t, dest, 0.42, 0.024, "bandpass", 1500, 0.7, 0.0015);        // the slap
        hiss(t, dest, 0.3, 0.14, "lowpass", 340, 0.9, 0.003);              // air pushed out under the stamp
        thump(t, dest, 0.42, 108, 50, 0.16);                               // the weight landing
        modal(t + 0.002, dest, 148, [1, 2.71, 4.63], [10, 7, 5], [0.7, 0.32, 0.14], 0.008, 0.32, 4000); // the table
        hiss(t + 0.05, dest, 0.05, 0.09, "highpass", 3800, 0.7, 0.01);     // paper settling
      }
    };
  })();

  function paintSound() {
    var on = audio.on();
    el.sound.setAttribute("aria-pressed", on ? "true" : "false");
    el.sound.setAttribute("aria-label", on ? "Sound on" : "Sound off");
    el.sound.title = on ? "Sound on" : "Sound off";
  }

  /* ------------------------------------------------------------ helpers */

  var UNI_OUT = { "1/2": "½", "1/3": "⅓", "2/3": "⅔", "1/4": "¼", "3/4": "¾", "1/8": "⅛" };
  function prettyFrac(t) {
    return String(t).replace(/(\d+) (\d)\/(\d)\b/g, function (m, w, n, d) { var u = UNI_OUT[n + "/" + d]; return u ? w + u : m; })
      .replace(/(^|[^\d\/])(\d)\/(\d)(?![\d\/])/g, function (m, pre, n, d) { var u = UNI_OUT[n + "/" + d]; return u ? pre + u : m; });
  }
  function nounAgree(n) {
    if (!S.hasYield) return n > 1 ? "batches" : "batch";
    var w = S.nounWord;
    if (/^dozen\b/i.test(w)) return w;
    var parts = w.split(" "), last = parts.pop();
    if (/^people$/i.test(last)) last = n > 1 ? "people" : "person";
    else if (/^person$/i.test(last)) last = n > 1 ? "people" : "person";
    else last = n > 1 ? RS.pluralWord(last) : RS.singularWord(last);
    parts.push(last);
    return parts.join(" ");
  }
  function servingsNow() { return RS.formatYieldNum(S.origN * S.factor, null, !!(S.R && S.R.yield && RS.yieldIsFine(S.R.yield))); }
  function yieldShort() {
    var y = servingsNow();
    return prettyFrac(y.text) + " " + nounAgree(y.val);
  }
  function announce(msg) {
    el.live.textContent = "";
    setTimeout(function () { el.live.textContent = msg; }, 30);
  }

  /* ------------------------------------------------------------ loading */

  function setupYield() {
    var y = S.R && S.R.yield;
    if (y) {
      S.hasYield = true; S.origN = y.n;
      var noun = y.noun || "";
      if (/^(serves|servings?|feeds|portions?)$/i.test(y.verb) || !noun) noun = /^feeds$/i.test(y.verb) && /people|person/i.test(noun) ? "people" : "servings";
      if (/^portions?$/i.test(y.verb)) noun = "portions";
      S.nounWord = noun.toLowerCase();
    } else {
      S.hasYield = false; S.origN = 1; S.nounWord = "batches";
    }
  }

  function loadText(text, opts) {
    opts = opts || {};
    closeHave(false);
    S.text = text;
    S.R = RS.parseRecipe(text);
    setupYield();
    if (opts.fresh) { S.factor = 1; S.anchor = null; S.figs = {}; }
    S.isSample = !!opts.sample;
    if (S.isSample) { save(KEY.text, null); save(KEY.sample, S.sampleIdx); }
    else save(KEY.text, text);
    paintPasteBar();
    paint(false);
  }

  function paintPasteBar() {
    var R = S.R, t = S.text.trim();
    var name = R && R.title ? R.title.text : (t ? t.split("\n")[0].trim().slice(0, 60) : "");
    if (!t) { el.pasteK.textContent = "No recipe yet"; el.pasteName.textContent = "Paste one to begin"; }
    else {
      el.pasteK.textContent = (S.isSample ? "Sample recipe" : "Your recipe") + " · " + R.count + (R.count === 1 ? " ingredient" : " ingredients");
      el.pasteName.textContent = name || "Untitled recipe";
    }
    var warn = t && R && R.count === 0;
    el.pasteFine.textContent = warn
      ? "I couldn't find any amounts in this. Each ingredient line should start with its amount, like “2 cups flour”."
      : "It stays in this browser. Nothing you paste is sent anywhere.";
    el.pasteFine.classList.toggle("is-warn", !!warn);
  }

  /* ----------------------------------------------------- odometer roll */

  var RE_NUMLEAD = /^[\d\s\/.,½⅓⅔¼¾⅛⅜⅝⅞\-]*[\d½⅓⅔¼¾⅛⅜⅝⅞]/;
  function splitFig(t) {
    var m = t.match(RE_NUMLEAD);
    return m ? { num: m[0], rest: t.slice(m[0].length) } : { num: "", rest: t };
  }
  function leadValue(t) {
    var m = t.match(RE_NUMLEAD);
    if (!m) return NaN;
    var v = RS.numValue(m[0].split(/\s*(?:-|to)\s*/)[0]);
    return isFinite(v) ? v : NaN;
  }

  // Roll one figure from its old text to its new text. Digits wind through
  // the numbers in between, the rest flips over as a word; the columns are
  // only there while it moves, then the plain text comes back.
  function roll(fig, from, to, delay) {
    var lh = parseFloat(getComputedStyle(fig).lineHeight) || 30;
    var up = !(leadValue(to) < leadValue(from));
    var a = splitFig(from), b = splitFig(to);
    var n = Math.max(a.num.length, b.num.length);
    var an = a.num.padStart ? a.num.padStart(n, " ") : a.num, bn = b.num.padStart ? b.num.padStart(n, " ") : b.num;
    fig.textContent = "";
    fig.style.setProperty("--rl", lh + "px");
    var longest = 0, k = 0;
    function column(x, y, steps, isWord) {
      var col = document.createElement("span"); col.className = "col";
      var ph = document.createElement("span"); ph.className = "col__ph"; ph.textContent = (y || x).replace(/ /g, " ") || " ";
      var strip = document.createElement("span"); strip.className = "col__strip";
      var seq = steps;
      if (!up) seq = seq.slice().reverse();
      seq.forEach(function (ch) { var g = document.createElement("span"); g.textContent = ch === "" ? " " : ch; strip.appendChild(g); });
      col.appendChild(ph); col.appendChild(strip);
      fig.appendChild(col);
      var travel = (steps.length - 1) * lh;
      var dur = Math.min(1100, 380 + (steps.length - 1) * 60) + (isWord ? 60 : 0);
      var d = delay + k * 26; k++;
      var from0 = up ? 0 : -travel, to0 = up ? -travel : 0;
      try {
        strip.animate([{ transform: "translateY(" + from0 + "px)" }, { transform: "translateY(" + to0 + "px)" }],
          { duration: dur, delay: d, easing: "cubic-bezier(.25, 1.28, .42, 1)", fill: "both" });
        if (!x.trim() || !y.trim()) {
          var wa = x.trim() ? x.length + "ch" : "0ch", wb = y.trim() ? y.length + "ch" : "0ch";
          col.style.width = wb;
          col.animate([{ width: wa }, { width: wb }], { duration: dur * 0.8, delay: d, easing: "cubic-bezier(.3, 1, .4, 1)", fill: "both" });
        } else if (isWord && x.length !== y.length) {
          col.style.width = y.length + "ch";
          col.animate([{ width: x.length + "ch" }, { width: y.length + "ch" }], { duration: dur * 0.8, delay: d, easing: "cubic-bezier(.3, 1, .4, 1)", fill: "both" });
        }
      } catch (e) { /* no Web Animations: the cleanup below still lands the text */ }
      longest = Math.max(longest, d + dur);
    }
    for (var i = 0; i < n; i++) {
      var x = an.charAt(i), y = bn.charAt(i);
      if (x === y) { fig.appendChild(document.createTextNode(y)); continue; }
      var steps;
      if (/\d/.test(x) && /\d/.test(y)) {
        steps = [];
        var p = +x, q = +y, guard = 0;
        if (up) { while (p !== q && guard++ < 10) { steps.push(String(p)); p = (p + 1) % 10; } }
        else { while (p !== q && guard++ < 10) { steps.push(String(p)); p = (p + 9) % 10; } }
        steps.push(String(q));
      } else steps = [x === " " ? "" : x, y === " " ? "" : y];
      column(x, y, steps, false);
    }
    if (a.rest !== b.rest) column(a.rest, b.rest, [a.rest, b.rest], true);
    else if (b.rest) fig.appendChild(document.createTextNode(b.rest));
    var token = {};
    fig._roll = token;
    setTimeout(function () { if (fig._roll === token) { fig.textContent = to; fig._roll = null; } }, longest + 40);
    return longest;
  }

  /* -------------------------------------------------------------- paint */

  function figClass(sg, r) {
    var c = "fig";
    if (sg.temp) c += " fig--temp";
    if (sg.size) c += " fig--size";
    if (sg.flag || (sg.id === "m" && r.flag)) c += " fig--flag";
    return c;
  }

  function buildSegs(container, segs, r, li, animate, rolls) {
    segs.forEach(function (sg) {
      if (sg.t !== "fig") { container.appendChild(document.createTextNode(sg.v)); return; }
      var f = document.createElement("span");
      f.className = figClass(sg, r);
      f.textContent = sg.v;
      var key = li + ":" + sg.id;
      var prev = S.figs[key];
      S.nextFigs[key] = sg.v;
      if (animate && prev != null && prev !== sg.v) rolls.push({ fig: f, from: prev, to: sg.v });
      container.appendChild(f);
      if (sg.vol || (sg.id === "m" && r.vol)) {
        var v = document.createElement("span"); v.className = "vol";
        v.textContent = "by vol";
        v.title = r.kosher ? "Kosher salt brands weigh very differently, so this stays a volume." : "Not in our weight table, so this stays a volume.";
        container.appendChild(v);
      }
    });
  }

  function paint(animate) {
    closeHave(false);
    var R = S.R;
    S.nextFigs = {};
    var rolls = [];
    var out = R ? RS.render(R, S.factor, S.mode) : [];
    S.out = out;

    // header
    var hasText = !!(S.text && S.text.trim());
    el.title.textContent = R && R.title ? R.title.text : (hasText ? "Untitled recipe" : "Your recipe");
    el.title.classList.toggle("is-empty", !(R && R.title));
    el.yield.textContent = "";
    if (R && R.yieldLine >= 0) {
      var yr = out[R.yieldLine];
      var segsY = yr.segs.slice();
      // trim the yield line's own bullet and spaces
      if (segsY[0] && segsY[0].t === "txt") segsY[0] = { t: "txt", v: segsY[0].v.replace(/^\s*(?:[-*•]\s*)?/, "") };
      buildSegs(el.yield, segsY, yr, "y", animate, rolls);
    } else if (hasText) {
      var b = RS.formatYieldNum(S.factor);
      var yf = { t: "fig", v: prettyFrac(b.text), id: "b" };
      buildSegs(el.yield, [{ t: "txt", v: S.factor === 1 ? "One batch" : "" }].concat(S.factor === 1 ? [] : [yf, { t: "txt", v: " " + nounAgree(b.val) }]), {}, "y", animate, rolls);
    }
    el.unitsLbl.textContent = S.mode === "metric" ? "Metric" : S.mode === "us" ? "US measures" : "";

    // body
    var ol = el.lines;
    ol.textContent = "";
    var blankRun = 0, started = false, firstHave = null, lineNo = 0;
    if (!hasText) {
      var e1 = document.createElement("li"); e1.className = "ln ln--empty"; e1.textContent = "Paste a recipe above and it lands here.";
      ol.appendChild(e1);
    }
    (R ? R.lines : []).forEach(function (L, i) {
      var r = out[i];
      if (L.kind === "title" || L.kind === "yield") return;
      if (L.kind === "blank") { if (started) blankRun++; return; }
      if (blankRun && started) { var bl = document.createElement("li"); bl.className = "ln ln--blank"; bl.setAttribute("aria-hidden", "true"); ol.appendChild(bl); }
      blankRun = 0; started = true;
      var li = document.createElement("li");
      li.className = "ln ln--" + (L.kind === "ing" ? "ing" : L.kind === "header" ? "head" : L.kind === "method" ? "method" : "text");
      li.dataset.i = i;
      var t = document.createElement("span"); t.className = "ln__t";
      // drop list bullets: the card is the list now
      var segs = r.segs.slice();
      if (segs[0] && segs[0].t === "txt" && L.kind !== "method") segs[0] = { t: "txt", v: segs[0].v.replace(/^\s*(?:[-*•·▢☐□▪◦‣⁃–]\s*)?/, "") };
      else if (segs[0] && segs[0].t === "txt") segs[0] = { t: "txt", v: segs[0].v.replace(/^\s+/, "") };
      buildSegs(t, segs, r, i, animate, rolls);
      li.appendChild(t);
      if (L.kind === "ing" && r.have) {
        li.classList.add("is-have");
        li.tabIndex = 0;
        li.setAttribute("role", "button");
        li.setAttribute("aria-label", r.text.trim() + ". Set how much you have.");
        var tag = document.createElement("span"); tag.className = "ln__have"; tag.textContent = "I have…"; tag.setAttribute("aria-hidden", "true");
        li.appendChild(tag);
        if (!firstHave) firstHave = li;
        if (S.anchor && S.anchor.i === i) li.classList.add("is-anchor");
      }
      ol.appendChild(li);
      lineNo++;
      if (r.note) {
        var nl = document.createElement("li"); nl.className = "ln ln--note";
        nl.textContent = r.note;
        ol.appendChild(nl);
      }
    });
    if (hasText && R && R.count === 0) {
      var w = document.createElement("li"); w.className = "ln ln--warn";
      w.textContent = "No amounts found, so there's nothing to scale yet.";
      ol.insertBefore(w, ol.firstChild);
    }
    if (firstHave && !S.hinted) firstHave.classList.add("is-hint");
    paintTip();

    // roll what changed, top to bottom, and tint it
    var lastEnd = 0;
    if (rolls.length) {
      var ticks = 0, lastTick = -1;
      rolls.forEach(function (rl, k) {
        var delay = Math.min(900, k * 38);
        if (reduce) {
          rl.fig.classList.add("is-fresh");
          return;
        }
        var end = roll(rl.fig, rl.from, rl.to, delay);
        lastEnd = Math.max(lastEnd, end);
        rl.fig.classList.add("is-fresh");
        if (ticks < 16 && delay - lastTick >= 30) {
          var rect = rl.fig.getBoundingClientRect();
          var pan = ((rect.left + rect.width / 2) / (window.innerWidth || 1) - 0.5) * 0.9;
          audio.tick(delay / 1000 + 0.03, pan, 0.75 + Math.random() * 0.3);
          ticks++; lastTick = delay;
        }
      });
    }
    S.figs = S.nextFigs;

    paintStamp(animate, rolls.length ? (reduce ? 0 : Math.min(lastEnd * 0.55, 700)) : 0);
    paintControls();
    updateShare();
    save(KEY.scale, S.factor === 1 ? null : S.factor);
    save(KEY.units, S.mode);
    S.painted = true;
  }

  // "Only have 2 eggs?" names something this recipe actually uses
  function paintTip() {
    var R = S.R, q = "Short on something?";
    if (R) {
      var best = null;
      R.lines.forEach(function (L) {
        if (L.kind !== "ing" || L.unit || !L.head || L.q.hi || !(L.q.lo >= 2) || L.q.lo !== Math.round(L.q.lo)) return;
        if (!best || (L.egg && !best.egg)) best = L;
      });
      if (best) {
        var n = Math.round(best.q.lo * S.factor) - 1;
        if (n >= 1) q = "Only have " + n + " " + (n > 1 ? RS.pluralWord(best.head.word) : RS.singularWord(best.head.word)) + "?";
      }
    }
    var b = el.tip.querySelector("b");
    if (b) b.textContent = q;
  }

  var lastStamp = "";
  function paintStamp(animate, delay) {
    var f = S.factor, on = Math.abs(f - 1) > 0.001 && S.R && S.R.count > 0;
    var lab = RS.factorLabel(f);
    var top, big, bot;
    if (S.anchor) { top = "Scaled to fit"; big = lab.mult; bot = "your " + S.anchor.label; }
    else { top = lab.word ? lab.mult : "Scaled"; big = lab.word || lab.mult; bot = yieldShort(); }
    el.stampTop.textContent = prettyFrac(top); el.stampBig.textContent = prettyFrac(big); el.stampBot.textContent = bot;
    var sig = on ? top + big + bot : "";
    el.stamp.classList.toggle("is-on", !!on);
    if (on && animate && sig !== lastStamp) {
      el.stamp.classList.remove("is-thunk");
      el.stamp.style.animationDelay = delay + "ms";
      void el.stamp.offsetWidth;
      el.stamp.classList.add("is-thunk");
      audio.stamp(delay / 1000 + 0.05);
    }
    lastStamp = sig;
  }

  function paintControls() {
    var y = servingsNow();
    var txt = prettyFrac(y.text);
    if (document.activeElement !== el.servings) el.servings.value = txt;
    el.servings.style.width = Math.max(2, txt.length + 0.6) + "ch";
    el.noun.textContent = nounAgree(y.val);
    if (document.activeElement !== el.orig) el.orig.value = prettyFrac(RS.formatYieldNum(S.origN).text);
    var cur = S.origN * S.factor;
    el.minus.disabled = cur <= minServings() + 1e-6;
    el.plus.disabled = S.factor >= MAX_F - 1e-6;
    [].forEach.call(el.chips.querySelectorAll("button"), function (b) {
      b.setAttribute("aria-pressed", Math.abs(+b.dataset.f - S.factor) < 0.001 ? "true" : "false");
    });
    [].forEach.call(el.units.querySelectorAll("button"), function (b) {
      b.setAttribute("aria-pressed", b.dataset.u === S.mode ? "true" : "false");
    });
    if (el.miniV) el.miniV.textContent = txt + " " + nounAgree(y.val);
    if (el.miniMinus) el.miniMinus.disabled = el.minus.disabled;
  }

  /* -------------------------------------------------------------- scale */

  function stepSize() {
    if (!S.hasYield) return 0.5;
    var n = S.origN;
    if (/^dozen/i.test(S.nounWord)) return 0.5;
    return n >= 8 ? Math.max(1, Math.round(n / 4)) : 1;
  }
  function minServings() { return Math.min(stepSize(), S.origN * MIN_F * 4); }

  function setFactor(f, method, opts) {
    opts = opts || {};
    if (!S.R) return;
    f = Math.max(MIN_F, Math.min(MAX_F, f));
    if (Math.abs(f - S.factor) < 1e-9 && !opts.force) { paintControls(); return; }
    audio.unlock();
    S.factor = f;
    S.anchor = opts.anchor || null;
    paint(true);
    gaThrottled("scale_recipe", { method: method, factor: Math.round(f * 100) / 100 }, method);
    var y = yieldShort(), lab = RS.factorLabel(f);
    announce((S.anchor ? "Scaled to your " + S.anchor.label + ". " : (lab.word ? lab.word + ". " : "Scaled " + lab.mult.replace("×", "times ") + ". ")) + (S.hasYield ? "Now " + y + "." : ""));
  }

  function bump(dir) {
    var st = stepSize(), cur = S.origN * S.factor;
    var next = dir > 0 ? (Math.floor(cur / st + 1e-6) + 1) * st : (Math.ceil(cur / st - 1e-6) - 1) * st;
    if (next < minServings()) next = minServings();
    setFactor(next / S.origN, "servings");
  }

  function setMode(m) {
    if (m === S.mode) return;
    audio.unlock();
    S.mode = m;
    paint(true);
    ga("recipe_units", { units: m });
    announce(m === "metric" ? "Metric measures, weights for dry goods." : m === "us" ? "US measures." : "Measures as written.");
  }

  /* --------------------------------------------------------- "I have" */

  var UNIT_LABEL = { tsp: "tsp", tbsp: "tbsp", cup: "cups", ml: "ml", g: "g", kg: "kg", oz: "oz", lb: "lb", stick: "sticks" };
  var HAVE_STEP = { tsp: 0.25, tbsp: 0.5, cup: 0.25, ml: 10, g: 5, kg: 0.1, oz: 1, lb: 0.25, stick: 0.5 };
  var haveState = null;

  function fmtHave(v, unit) {
    if (unit === "g" || unit === "ml") return String(Math.round(v));
    if (unit === "kg") return String(Math.round(v * 100) / 100);
    var f = RS.nearest(v, RS.FR_COUNT);
    if (Math.abs(f.val - v) > 0.02) return String(Math.round(v * 100) / 100);
    return RS.fracText(f, {});
  }

  function openHave(li) {
    var i = +li.dataset.i, r = S.out && S.out[i];
    if (!r || !r.have) return;
    closeHave(false);
    audio.unlock(); audio.slip();
    var have = r.have, units = RS.haveUnits(have);
    var P2 = RS.parseIngredient(r.text);
    var unit = null, value = null, noun = "";
    var P0 = S.R.lines[i];
    if (have.dim === "count") {
      value = P2 ? P2.q.lo : P0.q.lo * S.factor;
      noun = P0.unit ? RS.inflectTok(P0.unit.tok, true) : (P0.head ? RS.pluralWord(P0.head.word) : "");
    } else {
      var k = P2 && P2.unit ? (P2.unit.key === "floz" ? "ml" : P2.unit.key) : null;
      if (k && units.indexOf(k) >= 0) {
        unit = k;
        var U = RS.UNITS[P2.unit.key];
        var base = U.dim === "vol" ? P2.q.lo * U.ml : U.dim === "wt" ? P2.q.lo * U.g : P2.q.lo;
        base += P2.compound || 0;
        value = U.dim === "vol" ? base / RS.UNITS[k].ml : U.dim === "wt" ? base / RS.UNITS[k].g : base;
      } else {
        unit = units[0] || null;
        value = 1;
      }
    }
    haveState = { i: i, have: have, unit: unit, noun: noun, li: li };
    el.haveQ.textContent = have.egg ? "How many eggs do you have?" : have.dim === "count" ? "How many do you have?" : "How much do you have?";
    el.haveOf.textContent = "The card calls for " + r.text.replace(/^\s*(?:[-*•·▢☐□]\s*)?/, "").trim();
    el.haveAmt.value = fmtHave(value, unit);
    el.haveUnit.textContent = "";
    if (unit && units.length) {
      units.forEach(function (u) { var o = document.createElement("option"); o.value = u; o.textContent = UNIT_LABEL[u] || u; el.haveUnit.appendChild(o); });
      el.haveUnit.value = unit;
      el.haveUnit.hidden = false; el.haveNoun.textContent = "";
    } else {
      el.haveUnit.hidden = true; el.haveNoun.textContent = noun;
    }
    el.haveErr.textContent = "";
    li.classList.add("is-open");
    li.setAttribute("aria-expanded", "true");
    var dr = el.desk.getBoundingClientRect(), lr = li.getBoundingClientRect();
    el.have.style.top = Math.round(lr.bottom - dr.top + 6) + "px";
    el.have.hidden = false;
    S.open = i;
    if (!S.hinted) { S.hinted = true; save(KEY.hinted, "1"); var h = el.lines.querySelector(".is-hint"); if (h) h.classList.remove("is-hint"); }
    el.tip.classList.add("is-used");
    setTimeout(function () {
      try { el.haveAmt.focus({ preventScroll: true }); el.haveAmt.select(); } catch (e) {}
      var hr = el.have.getBoundingClientRect();
      if (hr.bottom > window.innerHeight - 10) window.scrollBy({ top: hr.bottom - window.innerHeight + 24, behavior: reduce ? "auto" : "smooth" });
    }, 20);
  }

  function closeHave(refocus) {
    if (S.open < 0 && el.have.hidden) return;
    var li = haveState && haveState.li;
    el.have.hidden = true;
    if (li) { li.classList.remove("is-open"); li.removeAttribute("aria-expanded"); if (refocus && li.isConnected) { try { li.focus({ preventScroll: true }); } catch (e) {} } }
    S.open = -1;
    haveState = null;
  }

  function stepHave(dir) {
    if (!haveState) return;
    var v = RS.numValue(el.haveAmt.value);
    if (!isFinite(v)) v = 0;
    var st = haveState.unit ? HAVE_STEP[haveState.unit] || 1 : 1;
    if (haveState.unit === "g" && v >= 100) st = 25;
    if (haveState.unit === "ml" && v >= 250) st = 25;
    if (haveState.unit === "oz" && v < 4) st = 0.5;
    var next = dir > 0 ? (Math.floor(v / st + 1e-6) + 1) * st : (Math.ceil(v / st - 1e-6) - 1) * st;
    if (next <= 0) next = st;
    el.haveAmt.value = fmtHave(next, haveState.unit);
    el.haveErr.textContent = "";
    audio.tick(0, 0, 0.7);
  }

  function goHave() {
    if (!haveState) return;
    var raw = el.haveAmt.value.trim().replace(/^about\s+/i, "");
    var v = RS.numValue(raw);
    if (!(v > 0)) { el.haveErr.textContent = "Type an amount, like 2 or 1 1/2."; el.haveAmt.focus(); return; }
    var unit = haveState.unit ? el.haveUnit.value : null;
    var f = RS.haveFactor(haveState.have, v, unit);
    if (!isFinite(f) || f <= 0) { el.haveErr.textContent = "Those units don't work for this one. Try another unit."; return; }
    if (f > MAX_F) { el.haveErr.textContent = "That's more than 64 batches. Try a smaller amount."; return; }
    if (f < MIN_F) { el.haveErr.textContent = "That's less than a thirty-second of the recipe. Try a bigger amount."; return; }
    var label = fmtHave(v, unit) + " " + (unit ? (UNIT_LABEL[unit] === "cups" && v <= 1 ? "cup" : UNIT_LABEL[unit] === "sticks" && v <= 1 ? "stick" : UNIT_LABEL[unit]) : (v <= 1 ? RS.singularWord(haveState.noun || "") : haveState.noun));
    var i = haveState.i, dim = haveState.have.dim;
    closeHave(false);
    setFactor(f, "have", { anchor: { i: i, label: label.trim() }, force: true });
    ga("recipe_have", { dim: dim, factor: Math.round(f * 100) / 100 });
    var li = el.lines.querySelector('[data-i="' + i + '"]');
    if (li) { try { li.focus({ preventScroll: true }); } catch (e) {} }
  }

  /* ------------------------------------------------------------- share */

  function updateShare() {
    var changed = S.R && S.R.count > 0 && Math.abs(S.factor - 1) > 0.001;
    if (!changed) {
      window.OPT_SHARE_IMAGE = null;
      window.OPT_SHARE_LINE = null;
      window.OPT_SHARE_TEXT = "Paste any recipe, pick the servings, and every amount gets rewritten the way a cook would write it.";
      return;
    }
    var name = S.R.title ? S.R.title.text : "my recipe";
    var lab = RS.factorLabel(S.factor);
    var y = yieldShort();
    if (S.anchor) {
      window.OPT_SHARE_TEXT = "I only had " + S.anchor.label + ", so I scaled " + name + " to fit. Every amount came out in real measures.";
      window.OPT_SHARE_LINE = "Scaled to fit " + S.anchor.label;
    } else {
      window.OPT_SHARE_TEXT = "I " + (lab.word ? lab.word.toLowerCase() : "scaled") + " " + name + (S.hasYield ? " to " + y : (lab.word ? "" : " " + lab.mult)) + ", and every amount came out in real measures.";
      window.OPT_SHARE_LINE = (lab.word || "Scaled " + lab.mult) + (S.hasYield ? ": " + y : "");
    }
    window.OPT_SHARE_IMAGE = drawShare;
  }

  // The card, drawn again for a share image. Called synchronously on tap.
  function drawShare() {
    var W = 1080, H = 1350, c = document.createElement("canvas");
    c.width = W; c.height = H;
    var x = c.getContext("2d");
    if (!x) return null;
    var bg = x.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#3a2a1e"); bg.addColorStop(1, "#1d140d");
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    var glow = x.createRadialGradient(W * 0.5, H * 0.38, 40, W * 0.5, H * 0.38, W * 0.75);
    glow.addColorStop(0, "rgba(255,190,120,0.28)"); glow.addColorStop(1, "rgba(255,190,120,0)");
    x.fillStyle = glow; x.fillRect(0, 0, W, H);

    // what goes on it: the ingredient side of the card, no trailing headers
    var items = [].slice.call(el.lines.querySelectorAll(".ln--ing, .ln--note, .ln--head"));
    var lastIng = -1;
    items.forEach(function (it, k) { if (!it.classList.contains("ln--head")) lastIng = k; });
    items = items.slice(0, lastIng + 1);

    var cx = 84, cw = W - 168, pad = 56, tx = cx + pad, maxW = cw - pad * 2;
    var title = el.title.textContent || "Recipe", tsize = 56, tl;
    x.font = "600 56px Fraunces, Georgia, serif";
    tl = wrap(x, title, maxW - 230, 2);
    if (/\u2026$/.test(tl[tl.length - 1])) { tsize = 44; x.font = "600 44px Fraunces, Georgia, serif"; tl = wrap(x, title, maxW - 230, 3); }
    var tlh = Math.round(tsize * 1.14);
    var LH = 54;
    var headH = 70 + tl.length * tlh + 60 + 34;
    var maxRows = Math.floor((1100 - 70 - headH - 60) / LH);
    var rows = Math.min(items.length, maxRows);
    var ch = Math.max(640, headH + rows * LH + 70);
    var cy = Math.max(56, Math.round((1110 - ch) / 2));

    x.save();
    x.translate(W / 2, cy + ch / 2); x.rotate(-0.012); x.translate(-W / 2, -(cy + ch / 2));
    x.save(); x.translate(W / 2, cy + ch / 2); x.rotate(0.03); x.translate(-W / 2, -(cy + ch / 2));
    x.fillStyle = "#d9caa9"; roundRect(x, cx + 10, cy + 14, cw, ch, 12); x.fill(); x.restore();
    x.shadowColor = "rgba(0,0,0,0.5)"; x.shadowBlur = 50; x.shadowOffsetY = 24;
    x.fillStyle = "#fffdf4"; roundRect(x, cx, cy, cw, ch, 12); x.fill();
    x.shadowColor = "transparent";

    x.fillStyle = "#d4473a";
    x.font = "800 22px Inter, sans-serif";
    try { x.letterSpacing = "6px"; } catch (e) {}
    x.fillText("RECIPE FOR", tx, cy + 70);
    try { x.letterSpacing = "0px"; } catch (e) {}
    x.fillStyle = "#2b2731";
    x.font = "600 " + tsize + "px Fraunces, Georgia, serif";
    tl.forEach(function (t, k) { x.fillText(t, tx, cy + 70 + tlh * (k + 1)); });
    var yy = cy + 70 + tl.length * tlh + 52;
    drawFigLine(x, el.yield, tx, yy, maxW, 32);
    var ruleY = yy + 30;
    x.fillStyle = "#d4473a"; x.fillRect(cx, ruleY, cw, 4); x.fillRect(cx, ruleY + 9, cw, 2);

    var ly = ruleY + 34 + 22;
    x.strokeStyle = "rgba(110,160,205,0.45)"; x.lineWidth = 2;
    for (var r = 0; r < rows; r++) { x.beginPath(); x.moveTo(cx, ly + r * LH + 14); x.lineTo(cx + cw, ly + r * LH + 14); x.stroke(); }
    for (var k = 0; k < rows; k++) {
      var it = items[k], base = ly + k * LH;
      if (k === rows - 1 && items.length > rows) {
        x.font = "600 40px Caveat, cursive"; x.fillStyle = "#c0392b";
        x.fillText("+ " + (items.length - k) + " more on the card", tx, base);
        break;
      }
      if (it.classList.contains("ln--note")) {
        x.font = "600 38px Caveat, cursive"; x.fillStyle = "#c0392b";
        x.fillText("\u21b3 " + it.textContent, tx + 20, base);
      } else if (it.classList.contains("ln--head")) {
        x.font = "700 28px 'Courier Prime', monospace"; x.fillStyle = "#2b2731";
        x.fillText(it.textContent.toUpperCase(), tx, base);
      } else {
        drawFigLine(x, it.querySelector(".ln__t"), tx, base, maxW, 31);
      }
    }

    // the stamp
    if (el.stamp.classList.contains("is-on")) {
      x.save();
      x.translate(cx + cw - 150, cy + 112); x.rotate(-0.16);
      x.strokeStyle = "rgba(196,52,43,0.9)"; x.fillStyle = "rgba(196,52,43,0.9)";
      x.lineWidth = 5; roundRect(x, -118, -62, 236, 124, 10); x.stroke();
      x.lineWidth = 2; roundRect(x, -108, -52, 216, 104, 7); x.stroke();
      x.textAlign = "center";
      x.font = "800 17px Inter, sans-serif";
      try { x.letterSpacing = "4px"; } catch (e) {}
      x.fillText(el.stampTop.textContent.toUpperCase(), 0, -24);
      if (el.stampBot.textContent) x.fillText(el.stampBot.textContent.toUpperCase().slice(0, 18), 0, 40);
      try { x.letterSpacing = "1px"; } catch (e) {}
      x.font = "800 " + (el.stampBig.textContent.length > 8 ? 30 : 38) + "px Inter, sans-serif";
      x.fillText(el.stampBig.textContent.toUpperCase(), 0, 14);
      x.restore();
    }
    x.restore();
    return c;
  }
  function roundRect(x, a, b, w, h, r) {
    x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r);
    x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath();
  }
  function wrap(x, text, maxW, maxLines) {
    var words = text.split(/\s+/), lines = [], cur = "";
    words.forEach(function (w) {
      var t = cur ? cur + " " + w : w;
      if (x.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
    });
    if (cur) lines.push(cur);
    if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, "") + "…"; }
    return lines;
  }
  // Draw a line of text with its figures under a highlighter, clipped to width.
  // (canvas normalizes x.font, so weights are rebuilt from the size, never parsed back)
  function drawFigLine(x, node, left, base, maxW, size) {
    if (!node) return;
    var px = left, fam = "px 'Courier Prime', 'Courier New', monospace";
    [].forEach.call(node.childNodes, function (n) {
      var t = n.textContent;
      if (!t) return;
      var isFig = n.nodeType === 1 && n.classList.contains("fig");
      if (n.nodeType === 1 && n.classList.contains("vol")) return;
      x.font = (isFig ? "700 " : "400 ") + size + fam;
      var w = x.measureText(t).width;
      if (px - left + w > maxW) {
        while (t.length > 1 && px - left + x.measureText(t + "…").width > maxW) t = t.slice(0, -1);
        t += "…"; w = x.measureText(t).width;
      }
      if (isFig && !n.classList.contains("fig--size")) {
        x.fillStyle = n.classList.contains("fig--temp") ? "rgba(140,200,255,0.55)" : "rgba(255,214,64,0.75)";
        x.fillRect(px - 5, base - size * 0.72, w + 10, size * 0.95);
      }
      x.fillStyle = "#2b2731";
      x.fillText(t, px, base);
      px += w;
    });
  }

  /* ---------------------------------------------------------- wiring */

  el.minus.addEventListener("click", function () { bump(-1); });
  el.plus.addEventListener("click", function () { bump(1); });
  if (el.miniMinus) el.miniMinus.addEventListener("click", function () { bump(-1); });
  if (el.miniPlus) el.miniPlus.addEventListener("click", function () { bump(1); });

  function applyServings() {
    var v = RS.numValue(el.servings.value.replace(/[^\d\s\/.,½⅓⅔¼¾⅛]/g, ""));
    if (v > 0) setFactor(v / S.origN, "servings");
    else paintControls();
  }
  var servT = null;
  el.servings.addEventListener("input", function () {
    el.servings.style.width = Math.max(2, el.servings.value.length + 0.6) + "ch";
    clearTimeout(servT);
    servT = setTimeout(function () { var v = RS.numValue(el.servings.value); if (v > 0) setFactor(v / S.origN, "servings"); }, 650);
  });
  el.servings.addEventListener("change", function () { clearTimeout(servT); applyServings(); });
  el.servings.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); clearTimeout(servT); applyServings(); el.servings.blur(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); bump(1); }
    else if (e.key === "ArrowDown") { e.preventDefault(); bump(-1); }
  });
  el.servings.addEventListener("focus", function () { setTimeout(function () { try { el.servings.select(); } catch (e) {} }, 0); });
  el.servings.addEventListener("blur", function () { paintControls(); });

  el.orig.addEventListener("change", function () {
    var v = RS.numValue(el.orig.value);
    if (v > 0 && v <= 10000) {
      if (!S.hasYield) { S.hasYield = true; S.nounWord = "servings"; }
      S.origN = v; S.factor = 1; S.anchor = null;
      paint(false);
    } else paintControls();
  });
  el.orig.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); el.orig.blur(); } });

  el.chips.addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (b) setFactor(+b.dataset.f, "multiplier", { force: Math.abs(+b.dataset.f - S.factor) < 1e-9 && !!S.anchor });
  });
  el.units.addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (b) setMode(b.dataset.u);
  });

  // lines: press, then the sticky note
  var pressed = null;
  el.lines.addEventListener("pointerdown", function (e) {
    var li = e.target.closest(".ln.is-have");
    if (!li || e.button > 0) return;
    pressed = li; li.classList.add("is-pressed");
    audio.unlock(); audio.press();
  });
  function unpress() { if (pressed) { pressed.classList.remove("is-pressed"); pressed = null; } }
  ["pointerup", "pointercancel", "pointerleave"].forEach(function (n) { el.lines.addEventListener(n, unpress); });
  el.lines.addEventListener("click", function (e) {
    var li = e.target.closest(".ln.is-have");
    if (!li) return;
    if (S.open === +li.dataset.i) { closeHave(true); return; }
    openHave(li);
  });
  el.lines.addEventListener("keydown", function (e) {
    var li = e.target.closest(".ln.is-have");
    if (!li || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    li.classList.add("is-pressed"); audio.unlock(); audio.press();
    setTimeout(function () { li.classList.remove("is-pressed"); openHave(li); }, 90);
  });
  el.haveMinus.addEventListener("click", function () { stepHave(-1); });
  el.havePlus.addEventListener("click", function () { stepHave(1); });
  el.haveGo.addEventListener("click", goHave);
  el.haveX.addEventListener("click", function () { closeHave(true); });
  el.haveAmt.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); goHave(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); stepHave(1); }
    else if (e.key === "ArrowDown") { e.preventDefault(); stepHave(-1); }
  });
  el.haveAmt.addEventListener("input", function () { el.haveErr.textContent = ""; });
  el.have.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); closeHave(true); } });
  document.addEventListener("pointerdown", function (e) {
    if (S.open < 0) return;
    if (el.have.contains(e.target) || e.target.closest(".ln.is-have")) return;
    closeHave(false);
  });
  window.addEventListener("resize", function () {
    if (S.open < 0 || !haveState) return;
    var dr = el.desk.getBoundingClientRect(), lr = haveState.li.getBoundingClientRect();
    el.have.style.top = Math.round(lr.bottom - dr.top + 6) + "px";
  });

  // the recipe itself
  function showBox(show) {
    el.pasteBox.hidden = !show;
    el.editBtn.setAttribute("aria-expanded", show ? "true" : "false");
    el.editBtn.textContent = show ? "Hide" : "Edit";
  }
  el.editBtn.addEventListener("click", function () {
    var show = el.pasteBox.hidden;
    if (show) el.src.value = S.text;
    showBox(show);
    if (show) el.src.focus();
  });
  el.newBtn.addEventListener("click", function () {
    el.src.value = "";
    showBox(true);
    el.src.focus();
    loadText("", { fresh: true });
  });
  el.sampleBtn.addEventListener("click", function () {
    if (!SAMPLES.length) return;
    S.sampleIdx = (S.sampleIdx + 1) % SAMPLES.length;
    el.src.value = SAMPLES[S.sampleIdx];
    loadText(SAMPLES[S.sampleIdx], { fresh: true, sample: true });
    ga("recipe_sample", { sample: S.sampleIdx });
    audio.unlock(); audio.slip();
  });
  var srcT = null, pastedIn = false;
  el.src.addEventListener("paste", function () { pastedIn = true; });
  el.src.addEventListener("input", function () {
    clearTimeout(srcT);
    var fresh = pastedIn; pastedIn = false;
    srcT = setTimeout(function () {
      loadText(el.src.value, { fresh: fresh });
      if (fresh) {
        ga("recipe_paste", { lines: S.R.lines.length, ingredients: S.R.count });
        var r = el.dash.getBoundingClientRect();
        if (r.top > window.innerHeight * 0.7) el.dash.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      }
    }, fresh ? 60 : 320);
  });
  // paste a recipe anywhere on the page
  document.addEventListener("paste", function (e) {
    var t = e.target;
    if (t && t.closest && t.closest("input, textarea, select, [contenteditable]")) return;
    var text = e.clipboardData && e.clipboardData.getData("text");
    if (!text || text.trim().split(/\n/).filter(function (s) { return s.trim(); }).length < 2) return;
    e.preventDefault();
    el.src.value = text;
    loadText(text, { fresh: true });
    ga("recipe_paste", { lines: S.R.lines.length, ingredients: S.R.count, anywhere: 1 });
    audio.unlock(); audio.slip();
  });

  function plainCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) {}
    ta.remove();
    return ok;
  }
  var copyT = null;
  el.copy.addEventListener("click", function () {
    if (!S.out || !S.text.trim()) return;
    var text = RS.toText(S.out).replace(/\n{3,}/g, "\n\n").trim();
    function done(ok) {
      el.copyLbl.textContent = ok ? "Copied" : "Couldn't copy";
      clearTimeout(copyT); copyT = setTimeout(function () { el.copyLbl.textContent = "Copy recipe"; }, 1600);
      if (ok) { audio.unlock(); audio.press(); announce("Recipe copied."); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(plainCopy(text)); });
    else done(plainCopy(text));
    ga("recipe_copy", { factor: Math.round(S.factor * 100) / 100, units: S.mode });
  });
  el.print.addEventListener("click", function () {
    ga("recipe_print", { factor: Math.round(S.factor * 100) / 100, units: S.mode });
    window.print();
  });
  el.sound.addEventListener("click", function () {
    audio.set(!audio.on());
    paintSound();
    if (audio.on()) { audio.unlock(); audio.tick(0, 0, 1); }
  });

  // the compact stepper that follows a long card down the page
  if (el.mini && "IntersectionObserver" in window) {
    el.mini.hidden = false;
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (en) {
        var above = en.boundingClientRect.bottom < 0;
        el.mini.classList.toggle("is-on", !en.isIntersecting && above);
      });
    }, { threshold: 0 });
    io.observe(el.dash);
  }

  /* -------------------------------------------------------------- boot */

  S.mode = /^(asis|us|metric)$/.test(load(KEY.units, "asis")) ? load(KEY.units, "asis") : "asis";
  paintSound();
  var savedText = load(KEY.text, null);
  var savedScale = parseFloat(load(KEY.scale, "1"));
  if (savedText && savedText.trim()) {
    el.src.value = savedText;
    loadText(savedText, {});
  } else {
    var si = parseInt(load(KEY.sample, "0"), 10);
    S.sampleIdx = si >= 0 && si < SAMPLES.length ? si : 0;
    el.src.value = SAMPLES[S.sampleIdx] || "";
    loadText(el.src.value, { sample: true });
  }
  if (savedScale > 0 && Math.abs(savedScale - 1) > 0.001) { S.factor = Math.max(MIN_F, Math.min(MAX_F, savedScale)); paint(false); }
  if (S.hinted) el.tip.classList.add("is-used");
  // fonts the share image draws with, even when nothing on screen uses them yet
  try { ["600 30px Caveat", "700 30px 'Courier Prime'", "400 30px 'Courier Prime'", "600 50px Fraunces", "800 20px Inter"].forEach(function (f) { document.fonts.load(f); }); } catch (e) {}

  if (navigator.webdriver) {
    window.__recipeScaler = {
      state: function () { return { factor: S.factor, mode: S.mode, anchor: S.anchor, origN: S.origN, count: S.R ? S.R.count : 0, text: S.out ? RS.toText(S.out) : "" }; },
      share: function () { return { text: window.OPT_SHARE_TEXT, line: window.OPT_SHARE_LINE, image: !!window.OPT_SHARE_IMAGE }; },
      drawShare: drawShare
    };
  }
})();
