/* Meeting Cost Meter — "The Burn".
 * Live money counter with an odometer readout, a heat-reactive background, and a
 * rising ember field whose intensity tracks the burn rate. Settings persist locally.
 */
(function () {
  "use strict";

  var titleEl = document.getElementById("title");
  var rateEl = document.getElementById("rate");
  var peopleEl = document.getElementById("people");
  var toggleBtn = document.getElementById("toggle");
  var resetBtn = document.getElementById("reset");
  var elapsedEl = document.getElementById("elapsed");
  var perMinEl = document.getElementById("perMin");
  var perSecEl = document.getElementById("perSec");
  var compareEl = document.getElementById("compare");
  var statusEl = document.getElementById("status");
  var odoRoot = document.getElementById("odo");
  var heatEl = document.getElementById("heat");
  var canvas = document.getElementById("embers");
  var presets = Array.prototype.slice.call(document.querySelectorAll(".preset"));
  var rootStyle = document.documentElement.style;

  var reduceMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var STORAGE_KEY = "meeting-cost-meter:v1";

  var running = false;
  var elapsedMs = 0;
  var startPerf = 0;
  var lastFrame = 0;

  // ---- helpers ----------------------------------------------------------
  function num(v) {
    var x = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(x) ? x : 0;
  }
  function getInputs() {
    return { rate: Math.max(0, num(rateEl.value)), people: Math.max(1, Math.floor(num(peopleEl.value))) };
  }
  function money(amount) {
    var v = Number(amount);
    if (!Number.isFinite(v)) v = 0;
    return "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function whole(n) { return Math.round(n).toLocaleString(); }
  function formatElapsed(ms) {
    var s = Math.floor(ms / 1000);
    return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
      .map(function (n) { return String(n).padStart(2, "0"); })
      .join(":");
  }
  function rates() {
    var i = getInputs();
    var perSec = (i.rate * i.people) / 3600;
    return { perSec: perSec, perMin: perSec * 60, perMs: perSec / 1000 };
  }
  function compareLine(total) {
    if (total <= 0) return "Set the room, then light the fuse.";
    if (total < 60) return "That's ≈ <strong>" + whole(total / 5) + "</strong> coffees ☕";
    if (total < 600) return "That's ≈ <strong>" + whole(total / 18) + "</strong> pizzas 🍕";
    if (total < 6000) return "That's ≈ <strong>" + whole(total / 120) + "</strong> nice dinners 🍽️";
    return "That's ≈ <strong>" + whole(total / 1200) + "</strong> weekend getaways ✈️";
  }

  // ---- odometer ---------------------------------------------------------
  var odoTpl = null;
  var odoCells = [];
  function odoRender(str) {
    var tpl = str.replace(/[0-9]/g, "#");
    if (tpl !== odoTpl) {
      odoTpl = tpl;
      odoRoot.textContent = "";
      odoCells = [];
      for (var i = 0; i < str.length; i++) {
        var ch = str[i];
        if (ch >= "0" && ch <= "9") {
          var reel = document.createElement("span");
          reel.className = "odo__reel";
          var strip = document.createElement("span");
          strip.className = "odo__strip";
          for (var d = 0; d < 10; d++) {
            var dg = document.createElement("span");
            dg.className = "odo__digit";
            dg.textContent = String(d);
            strip.appendChild(dg);
          }
          reel.appendChild(strip);
          odoRoot.appendChild(reel);
          odoCells.push(strip);
        } else {
          var sym = document.createElement("span");
          sym.className = "odo__sym";
          sym.textContent = ch;
          odoRoot.appendChild(sym);
          odoCells.push(null);
        }
      }
    }
    for (var j = 0; j < str.length; j++) {
      var s = odoCells[j];
      if (s) s.style.transform = "translateY(-" + (str.charCodeAt(j) - 48) + "em)";
    }
    odoRoot.setAttribute("aria-label", str);
  }

  // ---- embers (canvas) --------------------------------------------------
  var ctx = canvas.getContext("2d");
  var DPR = Math.min(2, window.devicePixelRatio || 1);
  var VW = 0, VH = 0;
  function resize() {
    VW = window.innerWidth; VH = window.innerHeight;
    canvas.width = VW * DPR; canvas.height = VH * DPR;
    canvas.style.width = VW + "px"; canvas.style.height = VH + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  resize();
  window.addEventListener("resize", resize);

  var embers = [];
  var EMBER_CAP = 240;
  var spawnAcc = 0;

  function spawnEmber() {
    if (embers.length >= EMBER_CAP) return;
    embers.push({
      x: Math.random() * VW,
      y: VH + 12,
      vx: (Math.random() - 0.5) * 0.5,
      vy: -(0.6 + Math.random() * 1.8),
      r: 1.2 + Math.random() * 2.6,
      life: 1,
      decay: 0.004 + Math.random() * 0.006,
      hot: Math.random() < 0.35
    });
  }

  // ---- state display ----------------------------------------------------
  function setHeat(total) {
    var h = Math.max(0, Math.min(1, Math.log10(total + 1) / 3.2));
    rootStyle.setProperty("--heat", h.toFixed(3));
    return h;
  }

  function updateReadout() {
    var r = rates();
    var total = r.perMs * elapsedMs;
    odoRender(money(total));
    elapsedEl.textContent = formatElapsed(elapsedMs);
    perMinEl.textContent = money(r.perMin);
    perSecEl.textContent = money(r.perSec);
    compareEl.innerHTML = compareLine(total);
    setHeat(total);
  }

  // ---- run / pause / reset ---------------------------------------------
  function setRunning(next) {
    running = next;
    if (running) {
      toggleBtn.textContent = "Pause";
      toggleBtn.classList.add("btn--running");
      statusEl.textContent = "Burning — the money is moving.";
    } else {
      toggleBtn.textContent = elapsedMs > 0 ? "Resume" : "Light the fuse";
      toggleBtn.classList.remove("btn--running");
      statusEl.textContent = elapsedMs > 0 ? "Paused." : "Ready when you are.";
    }
  }
  function start() { setRunning(true); startPerf = performance.now() - elapsedMs; }
  function pause() { elapsedMs = performance.now() - startPerf; setRunning(false); updateReadout(); }
  function reset() {
    elapsedMs = 0; setRunning(false); updateReadout();
    statusEl.textContent = "Reset — back to zero.";
  }

  toggleBtn.addEventListener("click", function () { running ? pause() : start(); });
  resetBtn.addEventListener("click", reset);

  // ---- main loop --------------------------------------------------------
  function loop(ts) {
    var dt = lastFrame ? Math.min(50, ts - lastFrame) : 16;
    lastFrame = ts;

    if (running) {
      elapsedMs = performance.now() - startPerf;
      updateReadout();
    }

    // embers
    if (!reduceMotion) {
      var perSec = rates().perSec;
      if (running) {
        var intensity = 0.5 + Math.min(7, perSec * 0.9); // embers/frame target
        spawnAcc += intensity * (dt / 16);
        while (spawnAcc >= 1) { spawnEmber(); spawnAcc -= 1; }
      }
      ctx.clearRect(0, 0, VW, VH);
      ctx.globalCompositeOperation = "lighter";
      for (var i = embers.length - 1; i >= 0; i--) {
        var e = embers[i];
        e.x += e.vx; e.y += e.vy; e.vy *= 0.992; e.vx += (Math.random() - 0.5) * 0.06;
        e.life -= e.decay;
        if (e.life <= 0 || e.y < -20) { embers.splice(i, 1); continue; }
        var a = e.life * 0.85;
        var rad = e.r * (0.6 + e.life * 0.8);
        var g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, rad * 3);
        if (e.hot) {
          g.addColorStop(0, "rgba(255,225,200," + a + ")");
          g.addColorStop(0.4, "rgba(255,120,70," + a * 0.7 + ")");
        } else {
          g.addColorStop(0, "rgba(255,160,120," + a + ")");
          g.addColorStop(0.4, "rgba(214,50,50," + a * 0.7 + ")");
        }
        g.addColorStop(1, "rgba(150,20,20,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(e.x, e.y, rad * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    }

    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // ---- inputs -----------------------------------------------------------
  function syncPresets() {
    var rate = getInputs().rate;
    presets.forEach(function (p) {
      p.setAttribute("aria-pressed", Number(p.dataset.rate) === rate ? "true" : "false");
    });
  }
  function onInputChange() { if (!running) updateReadout(); syncPresets(); persist(); }

  [rateEl, peopleEl].forEach(function (el) {
    el.addEventListener("input", onInputChange);
    el.addEventListener("blur", function () {
      var i = getInputs();
      rateEl.value = String(i.rate); peopleEl.value = String(i.people);
      onInputChange();
    });
  });
  document.querySelectorAll(".step").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var dir = Number(btn.dataset.dir), i = getInputs();
      if (btn.dataset.step === "rate") rateEl.value = String(Math.max(0, i.rate + dir * 5));
      else peopleEl.value = String(Math.max(1, i.people + dir));
      onInputChange();
    });
  });
  presets.forEach(function (p) {
    p.addEventListener("click", function () { rateEl.value = String(Number(p.dataset.rate)); onInputChange(); });
  });
  titleEl.addEventListener("input", persist);

  // ---- persistence ------------------------------------------------------
  function persist() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        title: (titleEl.value || "").trim(), rate: getInputs().rate, people: getInputs().people
      }));
    } catch (e) {}
  }
  function load() {
    try {
      var d = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
      if (!d || typeof d !== "object") return;
      if (typeof d.title === "string" && d.title.trim()) titleEl.value = d.title;
      if (Number.isFinite(d.rate)) rateEl.value = String(Math.max(0, d.rate));
      if (Number.isFinite(d.people)) peopleEl.value = String(Math.max(1, Math.floor(d.people)));
    } catch (e) {}
  }

  // ---- init -------------------------------------------------------------
  load();
  syncPresets();
  updateReadout();
  setRunning(false);
})();
