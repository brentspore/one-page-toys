/* Goo Cursor — a trailing chain of metaballs fused by the SVG goo filter into one
 * living iridescent body. Move to flow, tap to splat (droplets + shockwave ripple).
 */
(function () {
  "use strict";

  var layer = document.getElementById("gooLayer");
  var stage = document.getElementById("stage");
  var ripples = document.getElementById("ripples");
  var hint = document.getElementById("hint");
  if (!layer || !stage) return;

  var reduceMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var W = window.innerWidth;
  var H = window.innerHeight;

  // ---- Trailing chain ---------------------------------------------------
  var CHAIN = 22;
  var HEAD_R = Math.max(36, Math.min(62, Math.round(Math.min(W, H) * 0.075)));
  var TAIL_R = 9;

  var target = { x: W * 0.5, y: H * 0.5 };
  var chain = [];
  for (var i = 0; i < CHAIN; i++) {
    var t = i / (CHAIN - 1);
    var r = HEAD_R + (TAIL_R - HEAD_R) * t;
    var el = document.createElement("div");
    el.className = "blob";
    el.style.width = r * 2 + "px";
    el.style.height = r * 2 + "px";
    layer.appendChild(el);
    chain.push({ x: target.x, y: target.y, r: r, el: el });
  }

  // ---- Splat particles --------------------------------------------------
  var splats = [];
  var SPLAT_CAP = 110;

  function splat(x, y) {
    var count = reduceMotion ? 8 : 14 + Math.floor(Math.random() * 6);
    for (var i = 0; i < count; i++) {
      if (splats.length >= SPLAT_CAP) break;
      var ang = Math.random() * Math.PI * 2;
      var spd = 6 + Math.random() * 15;
      var r = 11 + Math.random() * 18;
      var el = document.createElement("div");
      el.className = Math.random() < 0.5 ? "blob blob--hot" : "blob";
      el.style.width = r * 2 + "px";
      el.style.height = r * 2 + "px";
      layer.appendChild(el);
      splats.push({
        x: x, y: y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 2,
        r: r, life: 1,
        decay: 0.012 + Math.random() * 0.01,
        el: el
      });
    }
  }

  function ripple(x, y) {
    if (reduceMotion || !ripples) return;
    var el = document.createElement("span");
    el.className = "ripple";
    el.style.left = x + "px";
    el.style.top = y + "px";
    el.addEventListener("animationend", function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    ripples.appendChild(el);
  }

  // ---- Pointer ----------------------------------------------------------
  var lastMove = -9999;
  var interacted = false;
  var now = 0;

  function noteInteract() {
    if (interacted) return;
    interacted = true;
    if (hint) {
      hint.classList.add("is-hidden");
      setTimeout(function () {
        if (hint && hint.parentNode) hint.parentNode.removeChild(hint);
      }, 700);
    }
  }

  stage.addEventListener(
    "pointermove",
    function (e) {
      target.x = e.clientX;
      target.y = e.clientY;
      lastMove = now;
      noteInteract();
    },
    { passive: true }
  );

  stage.addEventListener("pointerdown", function (e) {
    target.x = e.clientX;
    target.y = e.clientY;
    lastMove = now;
    noteInteract();
    splat(e.clientX, e.clientY);
    ripple(e.clientX, e.clientY);
  });

  window.addEventListener("resize", function () {
    W = window.innerWidth;
    H = window.innerHeight;
  });

  // ---- Loop -------------------------------------------------------------
  function place(b) {
    b.el.style.transform =
      "translate3d(" + (b.x - b.r) + "px," + (b.y - b.r) + "px,0)";
  }

  function frame(ts) {
    now = ts || 0;

    if (!reduceMotion && now - lastMove > 1500) {
      var s = now * 0.0009;
      target.x = W * 0.5 + Math.cos(s) * W * 0.26 + Math.cos(s * 2.3) * 40;
      target.y = H * 0.5 + Math.sin(s * 1.3) * H * 0.22 + Math.sin(s * 1.9) * 36;
    }

    var head = chain[0];
    head.x += (target.x - head.x) * 0.24;
    head.y += (target.y - head.y) * 0.24;
    place(head);
    for (var i = 1; i < chain.length; i++) {
      var b = chain[i];
      var a = chain[i - 1];
      b.x += (a.x - b.x) * 0.32;
      b.y += (a.y - b.y) * 0.32;
      place(b);
    }

    for (var j = splats.length - 1; j >= 0; j--) {
      var p = splats[j];
      p.vx *= 0.95;
      p.vy = p.vy * 0.95 + 0.55;
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;
      if (p.life <= 0) {
        if (p.el.parentNode) p.el.parentNode.removeChild(p.el);
        splats.splice(j, 1);
        continue;
      }
      var sc = Math.max(0.001, p.life);
      p.el.style.transform =
        "translate3d(" + (p.x - p.r) + "px," + (p.y - p.r) + "px,0) scale(" + sc + ")";
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
