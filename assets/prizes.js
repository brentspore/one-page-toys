/* One Page Toys — Prize Effects.
 * Site-wide "equippable" gag prizes bought at the Prize Counter (/store/). A
 * player owns prizes via the ticket ledger (assets/tickets.js); this script
 * layers on an EQUIP state and, for prizes that carry a visual/audio effect,
 * runs that effect on every page while equipped.
 *
 * Design rules (this loads on every page, including full-bleed canvas toys):
 *  - Every overlay is position:fixed and pointer-events:none, so an effect can
 *    NEVER block a toy's input (the Nova Coil / Dot Loop trap).
 *  - Nothing runs unless the player has equipped something, so the 99% who own
 *    nothing pay zero cost.
 *  - prefers-reduced-motion trims or stills motion; hidden tabs pause the loop.
 *  - Effects are deliberately subtle and capped so they decorate rather than
 *    fight the page underneath.
 *
 * Public API (used by the store to drive equip toggles):
 *   window.OPT_PRIZES.hasEffect(id) / .describe(id) / .effectIds()
 *   window.OPT_PRIZES.isEquipped(id) / .equipped()
 *   window.OPT_PRIZES.equip(id) / .unequip(id) / .toggle(id)
 *   window.OPT_PRIZES.on(fn)          -> fn(equippedList) on any change
 */
(function () {
  "use strict";

  var EQUIP_KEY = "opt_prizes_equipped";
  var Z = 2147481000; // below the tickets pill (2147482000), above page content
  var REDMO = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------------------------------------- utilities */

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function loadEquipped() {
    try { var a = JSON.parse(lsGet(EQUIP_KEY) || "[]"); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function saveEquipped(a) { lsSet(EQUIP_KEY, JSON.stringify(a)); }

  function owns(id) {
    // Defensive: only run an effect the player actually owns.
    try { return !window.OPT_TICKETS || window.OPT_TICKETS.own(id); } catch (e) { return true; }
  }

  var styled = false;
  function ensureStyle() {
    if (styled) return; styled = true;
    var css =
      ".opt-fx{position:fixed;pointer-events:none;}" +
      ".opt-fx-full{inset:0;overflow:hidden;}" +
      ".opt-fx-dot{position:absolute;will-change:transform,opacity;}" +
      "@media (prefers-reduced-motion:reduce){.opt-fx-anim{animation:none!important;}}";
    var s = document.createElement("style");
    s.id = "opt-fx-style"; s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  function fullLayer(id, z) {
    ensureStyle();
    var d = document.createElement("div");
    d.className = "opt-fx opt-fx-full opt-fx--" + id;
    d.style.zIndex = (z || Z);
    d.setAttribute("aria-hidden", "true");
    document.body.appendChild(d);
    return d;
  }

  /* one shared ticker so N effects don't each spin their own rAF */
  var tickers = [], rafId = null, last = 0;
  function frame(now) {
    var dt = Math.min((now - last) / 1000, 0.05); last = now;
    if (document.visibilityState === "visible") {
      for (var i = 0; i < tickers.length; i++) { try { tickers[i](dt, now); } catch (e) {} }
    }
    rafId = tickers.length ? requestAnimationFrame(frame) : null;
  }
  function addTicker(fn) {
    tickers.push(fn);
    if (rafId == null) { last = performance.now(); rafId = requestAnimationFrame(frame); }
    return function () { var i = tickers.indexOf(fn); if (i >= 0) tickers.splice(i, 1); };
  }

  // Track the pointer once, shared by all cursor-relative effects.
  var pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2, active: false, moved: 0 };
  var pointerHooked = false;
  function hookPointer() {
    if (pointerHooked) return; pointerHooked = true;
    window.addEventListener("pointermove", function (e) {
      pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true; pointer.moved = performance.now();
    }, { passive: true });
  }

  /* ------------------------------------------------------------- effects */
  /* Each effect: { desc, mount() -> cleanup() }. desc feeds the store copy. */

  var EFFECTS = {};

  // 🦆 a rubber duck that eases after your cursor
  EFFECTS["rubber-duck"] = {
    desc: "A rubber duck that paddles after your cursor on every page.",
    mount: function () {
      hookPointer();
      var d = document.createElement("div");
      d.className = "opt-fx"; d.style.zIndex = Z + 500; d.style.fontSize = "30px";
      d.style.left = "0"; d.style.top = "0"; d.style.filter = "drop-shadow(0 3px 4px rgba(0,0,0,.3))";
      d.textContent = "🦆"; d.setAttribute("aria-hidden", "true");
      document.body.appendChild(d);
      var x = pointer.x, y = pointer.y, px = x;
      var stop = addTicker(function (dt, now) {
        var tx = pointer.x + 22, ty = pointer.y + 22;
        // idle bob if the pointer has been still for a while
        if (now - pointer.moved > 900) { tx = x; ty = pointer.y + 22 + Math.sin(now * 0.004) * 8; }
        x += (tx - x) * 0.12; y += (ty - y) * 0.12;
        var vx = x - px; px = x;
        d.style.transform = "translate(" + (x - 15) + "px," + (y - 15) + "px) rotate(" + clamp(vx * 2.2, -22, 22) + "deg)";
      });
      return function () { stop(); d.remove(); };
    }
  };

  // 👀 googly eyes in the top-left that follow the cursor
  EFFECTS["googly-eyes"] = {
    desc: "A pair of googly eyes that watch your cursor wherever it goes.",
    mount: function () {
      hookPointer();
      var wrap = document.createElement("div");
      wrap.className = "opt-fx"; wrap.style.zIndex = Z + 400;
      wrap.style.left = "max(14px, env(safe-area-inset-left))";
      wrap.style.top = "calc(env(safe-area-inset-top) + 58px)";
      wrap.style.display = "flex"; wrap.style.gap = "3px"; wrap.setAttribute("aria-hidden", "true");
      function eye() {
        var e = document.createElement("div");
        e.style.cssText = "width:26px;height:26px;border-radius:50%;background:#fff;border:2px solid #111;position:relative;box-shadow:0 2px 5px rgba(0,0,0,.35)";
        var p = document.createElement("div");
        p.style.cssText = "width:11px;height:11px;border-radius:50%;background:#111;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)";
        e.appendChild(p); e._p = p; return e;
      }
      var a = eye(), b = eye();
      wrap.appendChild(a); wrap.appendChild(b); document.body.appendChild(wrap);
      var stop = addTicker(function () {
        [a, b].forEach(function (e) {
          var r = e.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          var dx = pointer.x - cx, dy = pointer.y - cy, ang = Math.atan2(dy, dx), d = Math.min(6, Math.hypot(dx, dy) / 40);
          e._p.style.transform = "translate(calc(-50% + " + Math.cos(ang) * d + "px), calc(-50% + " + Math.sin(ang) * d + "px))";
        });
      });
      return function () { stop(); wrap.remove(); };
    }
  };

  // ✨ a sparkle trail behind the cursor
  EFFECTS["fairy-dust"] = {
    desc: "A trail of glittering fairy dust follows your cursor.",
    mount: function () { return cursorEmitter("✨", 16, 0.62, [10, 16], function (p) { p.vy -= 8 * p.dt; }); }
  };
  // 🫧 bubbles rising from the cursor
  EFFECTS["bubble-trail"] = {
    desc: "Soft bubbles drift up from your cursor as you move.",
    mount: function () { return cursorEmitter("🫧", 14, 0.9, [12, 20], function (p) { p.vy -= 22 * p.dt; p.vx += Math.sin(p.life * 6) * 6 * p.dt; }); }
  };

  // shared cursor-emitter for trail effects
  function cursorEmitter(glyph, cap, life, sizeRange, physics) {
    hookPointer();
    var layer = fullLayer("emit", Z + 300);
    var pool = [], lastSpawn = 0;
    var stop = addTicker(function (dt, now) {
      if (pointer.active && now - pointer.moved < 120 && now - lastSpawn > 40 && pool.length < cap && !REDMO) {
        lastSpawn = now;
        var el = document.createElement("div");
        el.className = "opt-fx-dot";
        el.style.fontSize = rand(sizeRange[0], sizeRange[1]) + "px";
        el.textContent = glyph;
        layer.appendChild(el);
        pool.push({ el: el, x: pointer.x + rand(-6, 6), y: pointer.y + rand(-6, 6), vx: rand(-14, 14), vy: rand(-14, 6), t: 0, life: life * rand(0.7, 1.2), rot: rand(-40, 40), dt: 0 });
      }
      for (var i = pool.length - 1; i >= 0; i--) {
        var p = pool[i]; p.dt = dt; p.t += dt; p.life = p.life;
        if (physics) physics(p);
        p.x += p.vx * dt; p.y += p.vy * dt;
        var k = p.t / p.life;
        if (k >= 1) { p.el.remove(); pool.splice(i, 1); continue; }
        p.el.style.transform = "translate(" + p.x + "px," + p.y + "px) scale(" + (1 - k * 0.4) + ") rotate(" + p.rot * p.t + "deg)";
        p.el.style.opacity = String(1 - k * k);
      }
    });
    return function () { stop(); layer.remove(); };
  }

  // shared faller for ambient top-down effects (snow, petals)
  function fallEmitter(id, glyphs, count, opts) {
    opts = opts || {};
    var layer = fullLayer(id, Z);
    var N = REDMO ? Math.ceil(count * 0.35) : count;
    var flakes = [];
    for (var i = 0; i < N; i++) {
      var el = document.createElement("div");
      el.className = "opt-fx-dot";
      el.style.fontSize = rand(opts.size ? opts.size[0] : 10, opts.size ? opts.size[1] : 20) + "px";
      el.style.opacity = String(opts.opacity || 0.85);
      el.textContent = glyphs[(Math.random() * glyphs.length) | 0];
      layer.appendChild(el);
      flakes.push(resetFlake({ el: el }, true));
    }
    function resetFlake(f, anywhere) {
      f.x = rand(0, window.innerWidth);
      f.y = anywhere ? rand(0, window.innerHeight) : -30;
      f.vy = rand(opts.speed ? opts.speed[0] : 20, opts.speed ? opts.speed[1] : 55);
      f.vx = rand(-14, 14); f.sway = rand(0, 6.28); f.swaySp = rand(0.4, 1.4);
      f.rot = rand(0, 360); f.rotSp = opts.spin ? rand(-60, 60) : 0;
      return f;
    }
    var stop = addTicker(function (dt, now) {
      for (var i = 0; i < flakes.length; i++) {
        var f = flakes[i];
        f.sway += f.swaySp * dt;
        f.y += f.vy * dt; f.x += f.vx * dt + Math.sin(f.sway) * 12 * dt;
        if (f.y > window.innerHeight + 30) resetFlake(f, false);
        f.el.style.transform = "translate(" + f.x + "px," + f.y + "px) rotate(" + (f.rot + f.rotSp * now * 0.001) + "deg)";
      }
    });
    if (REDMO) stop(); // reduced motion: render a still scatter, no falling
    return function () { stop(); layer.remove(); };
  }

  EFFECTS["snow-flurry"] = { desc: "A gentle snow flurry drifts down across the whole site.", mount: function () { return fallEmitter("snow", ["❄️", "❅", "•"], 42, { size: [8, 18], speed: [22, 52], opacity: 0.9 }); } };
  EFFECTS["blossom-drift"] = { desc: "Cherry blossom petals drift softly across every page.", mount: function () { return fallEmitter("petal", ["🌸", "🌸", "🏵️"], 30, { size: [12, 22], speed: [26, 60], spin: true, opacity: 0.85 }); } };

  // 🌟 fireflies drifting and blinking
  EFFECTS["fireflies"] = {
    desc: "A few fireflies drift and blink around your screen at night.",
    mount: function () {
      var layer = fullLayer("fireflies", Z);
      var N = REDMO ? 6 : 14, bugs = [];
      for (var i = 0; i < N; i++) {
        var el = document.createElement("div");
        el.className = "opt-fx-dot";
        el.style.cssText = "width:7px;height:7px;border-radius:50%;background:#f5e9a0;box-shadow:0 0 10px 3px rgba(240,224,120,.8)";
        layer.appendChild(el);
        bugs.push({ el: el, x: rand(0, innerWidth), y: rand(0, innerHeight), a: rand(0, 6.28), sp: rand(8, 26), ph: rand(0, 6.28), bl: rand(0.5, 1.4), turn: rand(-1, 1) });
      }
      var stop = addTicker(function (dt, now) {
        for (var i = 0; i < bugs.length; i++) {
          var b = bugs[i]; b.a += b.turn * dt + Math.sin(now * 0.0007 + b.ph) * dt;
          b.x += Math.cos(b.a) * b.sp * dt; b.y += Math.sin(b.a) * b.sp * dt;
          if (b.x < -10) b.x = innerWidth + 10; if (b.x > innerWidth + 10) b.x = -10;
          if (b.y < -10) b.y = innerHeight + 10; if (b.y > innerHeight + 10) b.y = -10;
          b.el.style.transform = "translate(" + b.x + "px," + b.y + "px)";
          b.el.style.opacity = String(0.35 + 0.65 * (0.5 + 0.5 * Math.sin(now * 0.003 * b.bl + b.ph)));
        }
      });
      return function () { stop(); layer.remove(); };
    }
  };

  // 🪩 a disco ball hanging up top, casting slow colored light
  EFFECTS["disco-ball"] = {
    desc: "A pocket disco ball sways up top and throws colored light around.",
    mount: function () {
      var layer = fullLayer("disco", Z);
      var ball = document.createElement("div");
      ball.className = "opt-fx-anim";
      ball.style.cssText = "position:absolute;left:50%;top:-6px;font-size:34px;transform-origin:50% -14px;filter:drop-shadow(0 3px 6px rgba(0,0,0,.4))";
      ball.textContent = "🪩";
      if (!REDMO) ball.animate([{ transform: "translateX(-50%) rotate(-8deg)" }, { transform: "translateX(-50%) rotate(8deg)" }], { duration: 3200, direction: "alternate", iterations: Infinity, easing: "ease-in-out" });
      else ball.style.transform = "translateX(-50%)";
      layer.appendChild(ball);
      var spots = [];
      var cols = ["rgba(229,72,77,.16)", "rgba(58,123,213,.16)", "rgba(47,158,99,.16)", "rgba(224,135,58,.16)", "rgba(154,84,214,.16)"];
      for (var i = 0; i < 6; i++) {
        var s = document.createElement("div");
        s.className = "opt-fx-dot";
        s.style.cssText = "width:120px;height:120px;border-radius:50%;filter:blur(24px);background:" + cols[i % cols.length];
        layer.appendChild(s); spots.push({ el: s, a: rand(0, 6.28), sp: rand(0.2, 0.6), r: rand(0.2, 0.5) });
      }
      var stop = addTicker(function (dt, now) {
        for (var i = 0; i < spots.length; i++) {
          var p = spots[i]; p.a += p.sp * dt;
          var x = innerWidth * (0.5 + Math.cos(p.a) * p.r) - 60;
          var y = innerHeight * (0.4 + Math.sin(p.a * 1.3) * 0.35) - 60;
          p.el.style.transform = "translate(" + x + "px," + y + "px)";
        }
      });
      if (REDMO) stop();
      return function () { stop(); layer.remove(); };
    }
  };

  // ⭐ a faint drifting starfield behind everything
  EFFECTS["stardust"] = {
    desc: "A faint field of drifting stars behind the page.",
    mount: function () {
      var layer = fullLayer("stars", Z - 500);
      var N = REDMO ? 20 : 60, stars = [];
      for (var i = 0; i < N; i++) {
        var el = document.createElement("div");
        el.className = "opt-fx-dot";
        var r = rand(1, 2.6);
        el.style.cssText = "width:" + r + "px;height:" + r + "px;border-radius:50%;background:#cfe0ff;opacity:" + rand(0.25, 0.7);
        layer.appendChild(el);
        stars.push({ el: el, x: rand(0, innerWidth), y: rand(0, innerHeight), vx: rand(-6, 6), vy: rand(-6, 6) });
      }
      var stop = addTicker(function (dt) {
        for (var i = 0; i < stars.length; i++) {
          var s = stars[i]; s.x += s.vx * dt; s.y += s.vy * dt;
          if (s.x < 0) s.x = innerWidth; if (s.x > innerWidth) s.x = 0;
          if (s.y < 0) s.y = innerHeight; if (s.y > innerHeight) s.y = 0;
          s.el.style.transform = "translate(" + s.x + "px," + s.y + "px)";
        }
      });
      if (REDMO) stop();
      return function () { stop(); layer.remove(); };
    }
  };

  // 📺 retro CRT scanlines + vignette
  EFFECTS["retro-crt"] = {
    desc: "A subtle retro CRT overlay — scanlines and a soft vignette.",
    mount: function () {
      var layer = fullLayer("crt", Z + 800);
      layer.style.background =
        "repeating-linear-gradient(0deg, rgba(0,0,0,0.10) 0px, rgba(0,0,0,0.10) 1px, transparent 2px, transparent 3px)";
      layer.style.boxShadow = "inset 0 0 140px rgba(0,0,0,0.45)";
      layer.style.mixBlendMode = "multiply";
      if (!REDMO) layer.animate([{ opacity: 0.85 }, { opacity: 1 }, { opacity: 0.9 }], { duration: 120, iterations: Infinity, direction: "alternate" });
      return function () { layer.remove(); };
    }
  };

  // 💡 slow color-cycling mood lighting at the screen edges
  EFFECTS["mood-ring"] = {
    desc: "Mood lighting: the screen edges glow through slowly shifting colors.",
    mount: function () {
      var layer = fullLayer("mood", Z - 400);
      layer.style.transition = "box-shadow 2s linear";
      var hue = rand(0, 360);
      var stop = addTicker(function (dt) {
        hue = (hue + dt * 10) % 360;
        layer.style.boxShadow = "inset 0 0 120px hsla(" + hue + ",70%,55%,0.16)";
      });
      if (REDMO) { layer.style.boxShadow = "inset 0 0 120px hsla(" + hue + ",70%,55%,0.16)"; stop(); }
      return function () { stop(); layer.remove(); };
    }
  };

  /* ---- click-triggered gags ------------------------------------------- */

  function clickGag(id, handler, guardMs) {
    var layer = fullLayer(id, Z + 900); // holds spawned bits
    var lastT = 0;
    function onClick(e) {
      var now = performance.now();
      if (guardMs && now - lastT < guardMs) return;
      lastT = now;
      handler(e.clientX, e.clientY, layer);
    }
    window.addEventListener("pointerdown", onClick, { passive: true, capture: true });
    return function () { window.removeEventListener("pointerdown", onClick, true); layer.remove(); };
  }

  // 🎊 confetti burst on every click
  EFFECTS["confetti-fingers"] = {
    desc: "Every click bursts a little shower of confetti.",
    mount: function () {
      if (REDMO) return clickGag("confetti", function () {}, 0); // no motion under reduce
      var cols = ["#e5484d", "#3a7bd5", "#2f9e63", "#e0873a", "#9a54d6", "#ffd36a"];
      return clickGag("confetti", function (x, y, layer) {
        for (var i = 0; i < 16; i++) {
          (function () {
            var b = document.createElement("div");
            b.className = "opt-fx-dot";
            b.style.cssText = "width:8px;height:12px;border-radius:2px;background:" + cols[(Math.random() * cols.length) | 0];
            layer.appendChild(b);
            var ang = rand(0, 6.28), sp = rand(120, 340), vx = Math.cos(ang) * sp, vy = Math.sin(ang) * sp - 120;
            var px = x, py = y, t = 0, rot = rand(0, 360), rs = rand(-600, 600);
            var stop = addTicker(function (dt) {
              t += dt; vy += 640 * dt; px += vx * dt; py += vy * dt;
              b.style.transform = "translate(" + px + "px," + py + "px) rotate(" + (rot + rs * t) + "deg)";
              b.style.opacity = String(clamp(1 - t / 1.1, 0, 1));
              if (t > 1.1) { stop(); b.remove(); }
            });
          })();
        }
      }, 120);
    }
  };

  // 🃏 fling a random sticker on click
  EFFECTS["sticker-pack"] = {
    desc: "Click anywhere to fling a random sticker that tumbles away.",
    mount: function () {
      if (REDMO) return clickGag("sticker", function () {}, 0);
      var stickers = ["⭐", "❤️", "🔥", "😎", "👍", "🌈", "💥", "🎈", "🍕", "👾", "💫", "🦖"];
      return clickGag("sticker", function (x, y, layer) {
        var el = document.createElement("div");
        el.className = "opt-fx-dot"; el.style.fontSize = "30px";
        el.textContent = stickers[(Math.random() * stickers.length) | 0];
        layer.appendChild(el);
        var vx = rand(-160, 160), vy = rand(-380, -220), px = x - 15, py = y - 15, t = 0, rot = rand(-40, 40), rs = rand(-300, 300);
        var stop = addTicker(function (dt) {
          t += dt; vy += 900 * dt; px += vx * dt; py += vy * dt;
          el.style.transform = "translate(" + px + "px," + py + "px) rotate(" + (rot + rs * t) + "deg)";
          el.style.opacity = String(clamp(1.4 - t, 0, 1));
          if (t > 1.4) { stop(); el.remove(); }
        });
      }, 90);
    }
  };

  // 💨 whoopee cushion — a squeak on click
  EFFECTS["whoopee"] = {
    desc: "A whoopee cushion squeaks every time you click. Yes, everywhere.",
    mount: function () {
      var AC = null;
      function squeak() {
        try {
          if (!AC) { var C = window.AudioContext || window.webkitAudioContext; if (!C) return; AC = new C(); }
          if (AC.state === "suspended") AC.resume();
          var t = AC.currentTime;
          var o = AC.createOscillator(), g = AC.createGain(), f = AC.createBiquadFilter();
          o.type = "sawtooth";
          o.frequency.setValueAtTime(rand(160, 240), t);
          o.frequency.exponentialRampToValueAtTime(rand(70, 110), t + 0.32);
          // wobble for the classic sputter
          var lfo = AC.createOscillator(), lg = AC.createGain();
          lfo.frequency.value = 22; lg.gain.value = 30; lfo.connect(lg); lg.connect(o.frequency);
          f.type = "lowpass"; f.frequency.value = 900;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
          o.connect(f); f.connect(g); g.connect(AC.destination);
          o.start(t); lfo.start(t); o.stop(t + 0.4); lfo.stop(t + 0.4);
        } catch (e) {}
      }
      return clickGag("whoopee", function () { squeak(); }, 150);
    }
  };

  /* --------------------------------------------------------------- engine */

  var active = {};    // id -> cleanup fn
  var listeners = [];

  function emit() {
    var eq = loadEquipped();
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](eq.slice()); } catch (e) {} }
  }

  function mountEffect(id) {
    if (active[id] || !EFFECTS[id] || !owns(id)) return;
    try { active[id] = EFFECTS[id].mount() || function () {}; } catch (e) { active[id] = function () {}; }
  }
  function unmountEffect(id) {
    if (active[id]) { try { active[id](); } catch (e) {} delete active[id]; }
  }

  function equip(id) {
    if (!EFFECTS[id]) return false;
    var eq = loadEquipped();
    if (eq.indexOf(id) === -1) { eq.push(id); saveEquipped(eq); }
    mountEffect(id);
    emit();
    return true;
  }
  function unequip(id) {
    var eq = loadEquipped(), i = eq.indexOf(id);
    if (i >= 0) { eq.splice(i, 1); saveEquipped(eq); }
    unmountEffect(id);
    emit();
    return true;
  }
  function toggle(id) { return isEquipped(id) ? (unequip(id), false) : (equip(id), true); }
  function isEquipped(id) { return loadEquipped().indexOf(id) >= 0; }

  window.OPT_PRIZES = {
    effectIds: function () { return Object.keys(EFFECTS); },
    hasEffect: function (id) { return !!EFFECTS[id]; },
    describe: function (id) { return EFFECTS[id] ? EFFECTS[id].desc : ""; },
    equipped: function () { return loadEquipped().slice(); },
    isEquipped: isEquipped,
    equip: equip,
    unequip: unequip,
    toggle: toggle,
    on: function (fn) { if (typeof fn === "function") listeners.push(fn); }
  };

  function boot() {
    var eq = loadEquipped();
    for (var i = 0; i < eq.length; i++) mountEffect(eq[i]);
    // If effects were equipped but the ledger later reset (no longer owned),
    // they simply won't mount — leaving the equip list is harmless.
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
