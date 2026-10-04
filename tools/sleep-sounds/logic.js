/* Sleep Sounds: the pure parts (no DOM, no audio), shared by the page and the
 * node tests. Layers, presets, the shareable mix link, slider-to-gain curves,
 * the play fade-in, and the sleep timer's fade-out curve. */
(function (root) {
  "use strict";

  // The order here is the order of the sliders and of the engine's levels.
  var LAYERS = [
    { id: "brown",   key: "b", name: "Brown noise",   group: "noise" },
    { id: "pink",    key: "p", name: "Pink noise",    group: "noise" },
    { id: "white",   key: "w", name: "White noise",   group: "noise" },
    { id: "rain",    key: "r", name: "Rain",          group: "place" },
    { id: "fan",     key: "f", name: "Box fan",       group: "place" },
    { id: "waves",   key: "o", name: "Ocean waves",   group: "place" },
    { id: "fire",    key: "c", name: "Crackling fire", group: "place" },
    { id: "thunder", key: "t", name: "Far thunder",   group: "place" }
  ];

  function blank() {
    var m = {};
    for (var i = 0; i < LAYERS.length; i++) m[LAYERS[i].id] = 0;
    return m;
  }
  function mk(o) { var m = blank(); for (var k in o) m[k] = o[k]; return m; }

  var PRESETS = [
    { id: "deep-brown", name: "Deep brown",     mix: mk({ brown: 78 }) },
    { id: "rainy-cabin", name: "Rainy cabin",   mix: mk({ rain: 46, fire: 52, thunder: 50 }) },
    { id: "airplane",   name: "Airplane cabin", mix: mk({ brown: 74, pink: 40, white: 10, fan: 18 }) },
    { id: "ocean-house", name: "Ocean house",   mix: mk({ waves: 78, brown: 14 }) },
    { id: "box-fan",    name: "Box fan",        mix: mk({ fan: 80 }) },
    { id: "downpour",   name: "Downpour",       mix: mk({ rain: 84, thunder: 64, brown: 12 }) }
  ];

  var DEFAULT_MIX = PRESETS[1].mix;     // Rainy cabin: the scene has the most to show
  var DEFAULT_VOLUME = 40;              // quiet by default; this plays at night

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function clean(v) { v = Math.round(Number(v)); return isFinite(v) ? clamp(v, 0, 100) : 0; }

  function normalize(m) {
    var out = blank();
    if (m && typeof m === "object") for (var i = 0; i < LAYERS.length; i++) {
      var id = LAYERS[i].id;
      if (m[id] != null) out[id] = clean(m[id]);
    }
    return out;
  }

  function isSilent(m) {
    for (var i = 0; i < LAYERS.length; i++) if (m[LAYERS[i].id] > 0) return false;
    return true;
  }

  // The preset this mix matches (every layer within 1), or null.
  function matchPreset(m) {
    for (var p = 0; p < PRESETS.length; p++) {
      var ok = true;
      for (var i = 0; i < LAYERS.length; i++) {
        var id = LAYERS[i].id;
        if (Math.abs((m[id] || 0) - PRESETS[p].mix[id]) > 1) { ok = false; break; }
      }
      if (ok) return PRESETS[p];
    }
    return null;
  }

  // ---- shareable link: #mix=r46-c52-t40 (only the layers that are on) ----
  function encodeMix(m) {
    var parts = [];
    for (var i = 0; i < LAYERS.length; i++) {
      var v = clean(m[LAYERS[i].id]);
      if (v > 0) parts.push(LAYERS[i].key + v);
    }
    return parts.join("-");
  }
  function decodeMix(s) {
    if (typeof s !== "string") return null;
    s = s.replace(/^#/, "");
    var mm = /(?:^|&)mix=([a-z0-9-]*)/i.exec(s);
    if (!mm) return null;
    var out = blank(), any = false;
    var parts = mm[1].toLowerCase().split("-");
    for (var j = 0; j < parts.length; j++) {
      var p = /^([a-z])(\d{1,3})$/.exec(parts[j]);
      if (!p) continue;
      for (var i = 0; i < LAYERS.length; i++) {
        if (LAYERS[i].key === p[1]) { out[LAYERS[i].id] = clean(p[2]); any = true; }
      }
    }
    return any ? out : null;
  }

  // A plain-words name for a mix, for the headline and the share line.
  // In a natural order: the places first ("rain, crackling fire and far
  // thunder"), then the noise colors folded into one phrase ("over brown and
  // pink noise"), so "Box fan over brown, pink and white noise" reads right.
  var PLACE_ORDER = ["rain", "waves", "fire", "fan", "thunder"];
  function list(words) {
    if (words.length <= 1) return words.join("");
    if (words.length === 2) return words[0] + " and " + words[1];
    return words.slice(0, -1).join(", ") + " and " + words[words.length - 1];
  }
  function describe(m) {
    var places = [], noise = [];
    for (var i = 0; i < PLACE_ORDER.length; i++) {
      var id = PLACE_ORDER[i], v = m[id] || 0;
      if (v <= 0) continue;
      var word = id === "rain" ? (v < 30 ? "light rain" : v > 72 ? "heavy rain" : "rain")
        : id === "waves" ? "ocean waves" : id === "fire" ? "crackling fire" : id === "fan" ? "a box fan" : "far thunder";
      places.push(word);
    }
    ["brown", "pink", "white"].forEach(function (id) { if ((m[id] || 0) > 0) noise.push(id); });
    var np = noise.length ? list(noise) + " noise" : "";
    var out;
    if (places.length && np) out = list(places) + " over " + np;
    else out = places.length ? list(places) : np;
    return out ? cap(out.replace(/^a box fan/, "box fan")) : "";
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ---- slider to gain ----
  // Sliders are 0..100. Loudness follows a power curve so the bottom of the
  // slider is fine control over quiet levels, which is where night listening lives.
  function layerGain(v) { v = clamp(v, 0, 100) / 100; return v * v; }
  // Master: 0..100 -> 0..2. Default 40 -> 0.32.
  function volumeGain(v) { v = clamp(v, 0, 100) / 100; return 2 * v * v; }

  // ---- play fade-in (8 s) and pause fade-out ----
  // Amplitude ramps as x^2: -24 dB a quarter of the way in, -12 dB at half, so
  // the sound arrives from nothing instead of switching on.
  function fadeInCurve(n) {
    var c = new Float32Array(n);
    for (var i = 0; i < n; i++) { var x = i / (n - 1); c[i] = Math.max(0.0001, x * x); }
    return c;
  }
  function fadeOutCurve(n, from) {
    var c = new Float32Array(n);
    for (var i = 0; i < n; i++) { var x = 1 - i / (n - 1); c[i] = from * x * x; }
    return c;
  }

  // ---- sleep timer ----
  var TIMERS = [
    { id: "off", label: "Off" },
    { id: "15", label: "15 min", min: 15 },
    { id: "30", label: "30 min", min: 30 },
    { id: "60", label: "1 hr", min: 60 },
    { id: "90", label: "90 min", min: 90 },
    { id: "morning", label: "Until morning" }
  ];

  // How long the fade lasts: a quarter of the timer, between 3 and 20 minutes.
  function fadeLength(totalSec) { return clamp(totalSec * 0.25, 180, 1200); }

  // Gain across the fade, x = 0 (fade starts) .. 1 (silence). Falls 50 dB in a
  // straight line on the loudness scale, which the ear hears as an even fade
  // (about a quarter of a dB a second for a 3-minute fade, less for longer
  // ones). Only once it is already 47 dB down does a short cosine taper take it
  // the rest of the way to true zero. Monotonic, no step anywhere: the end is a
  // whisper going to nothing, never a cut.
  function timerGain(x) {
    if (x <= 0) return 1;
    if (x >= 1) return 0;
    var g = Math.pow(10, -50 * x / 20);
    if (x > 0.94) g *= 0.5 * (1 + Math.cos(Math.PI * (x - 0.94) / 0.06));
    return g;
  }
  function timerCurve(n) {
    var c = new Float32Array(n);
    for (var i = 0; i < n; i++) c[i] = timerGain(i / (n - 1));
    return c;
  }
  // Gain at a wall-clock moment, for a timer that ends at `end` with a fade of
  // `fade` seconds (all in ms / s as named).
  function timerGainAt(nowMs, endMs, fadeSec) {
    var left = (endMs - nowMs) / 1000;
    if (left <= 0) return 0;
    if (left >= fadeSec) return 1;
    return timerGain(1 - left / fadeSec);
  }

  // "HH:MM" -> next time that clock reads it, strictly after now.
  function nextMorning(now, hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || "");
    var h = m ? clamp(+m[1], 0, 23) : 7, mi = m ? clamp(+m[2], 0, 59) : 0;
    var d = new Date(now.getTime());
    d.setHours(h, mi, 0, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return d;
  }

  // When a timer started at `startMs` ends. Returns ms epoch, or null for "off".
  function timerEnd(id, startMs, morning) {
    if (id === "morning") return nextMorning(new Date(startMs), morning).getTime();
    for (var i = 0; i < TIMERS.length; i++) if (TIMERS[i].id === id && TIMERS[i].min) return startMs + TIMERS[i].min * 60000;
    return null;
  }

  function fmtLeft(sec) {
    sec = Math.max(0, Math.round(sec));
    var h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    if (m === 60) { h++; m = 0; }
    if (h > 0) return h + " hr" + (m ? " " + m + " min" : "");
    if (sec < 60) return "under a minute";
    return m + " min";
  }

  var api = {
    LAYERS: LAYERS, PRESETS: PRESETS, TIMERS: TIMERS, DEFAULT_MIX: DEFAULT_MIX, DEFAULT_VOLUME: DEFAULT_VOLUME,
    blank: blank, normalize: normalize, isSilent: isSilent, matchPreset: matchPreset,
    encodeMix: encodeMix, decodeMix: decodeMix, describe: describe,
    layerGain: layerGain, volumeGain: volumeGain, fadeInCurve: fadeInCurve, fadeOutCurve: fadeOutCurve,
    fadeLength: fadeLength, timerGain: timerGain, timerCurve: timerCurve, timerGainAt: timerGainAt,
    nextMorning: nextMorning, timerEnd: timerEnd, fmtLeft: fmtLeft, clamp: clamp
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SleepLogic = api;
})(this);
