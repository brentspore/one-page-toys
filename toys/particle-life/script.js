/* Particle Life — emergent life from simple rules (vanilla Canvas 2D, no libraries, no build).
 *
 * Thousands of glowing particles, each belonging to one of K species (colors). A K x K
 * ATTRACTION MATRIX (values ~ -1..1) says how strongly species i is pulled toward / pushed
 * from species j. Every step each particle sums forces from neighbors within a cutoff radius
 * rMax: the matrix-scaled long-range term PLUS a universal short-range repulsion (so clusters
 * never collapse). A uniform spatial grid (cell = rMax) keeps neighbor queries O(n) so a few
 * thousand particles hold 60fps. The world is toroidal (wraps at the edges) so structures —
 * cells, chasers, membranes, drifting "creatures" — form and drift forever.
 *
 * Interaction: tap spawns a colored burst, drag stirs the swarm, and "New rules" morphs in a
 * fresh attraction matrix (a whole new ecosystem) without a hard cut. Curated dark palettes,
 * additive glow with soft comet trails, and a calm generative pad that shifts chord when the
 * rules reroll round out the presentation. */
(function () {
  "use strict";

  /* ============================ DOM ============================ */
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const rulesBtn = document.getElementById("rulesBtn");
  const paletteBtn = document.getElementById("paletteBtn");
  const soundBtn = document.getElementById("soundBtn");
  const dotsEl = document.getElementById("dots");
  const overlay = document.getElementById("overlay");
  const ovBtn = document.getElementById("ovBtn");
  const hint = document.getElementById("hint");

  const REDMO = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ============================ palettes ============================ */
  // Each palette is up to 6 glowing species colors curated to sit well on near-black.
  const PALETTES = [
    { name: "Aurora", cols: [[53,240,192],[36,182,255],[123,108,255],[70,255,143],[0,224,208],[185,140,255]] },
    { name: "Ember",  cols: [[255,176,58],[255,94,58],[255,45,111],[255,210,63],[255,120,71],[255,86,150]] },
    { name: "Neon",   cols: [[255,61,240],[22,240,255],[157,255,46],[255,226,61],[255,94,168],[77,123,255]] },
    { name: "Bloom",  cols: [[255,105,180],[255,138,96],[173,120,255],[92,235,178],[104,178,255],[255,196,92]] }
  ];
  let paletteIdx = 0;

  /* ============================ tunables ============================ */
  const BETA = 0.30;          // inner fraction of rMax that is universally repulsive
  const FORCE = 5.2;          // global force scaling
  const FRICTION = 0.80;      // velocity retained per step (damping)
  const MAX_SPEED = 2200;     // px/sec clamp (guards rare blowups)
  const SIM_DT = REDMO ? 0.009 : 0.015;   // fixed sim seconds/step (calmer when reduced-motion)
  const TRAIL_FADE = REDMO ? 0.24 : 0.17; // per-frame background wash (smaller = longer trails)
  const STIR_R = 130;         // stir radius (px)
  const STIR_PUSH = 260;      // outward shove near the cursor
  const STIR_CARRY = 0.85;    // how much of the drag velocity the swarm inherits
  const AUTO_REROLL = REDMO ? 132 : 58;   // seconds of idle before the ecosystem evolves itself

  const MAX_SPECIES = 6;

  /* ============================ world / particle state ============================ */
  let W = 1, H = 1, halfW = 0.5, halfH = 0.5, dpr = 1;
  let cap = 3400, base = 2800, n = 0;
  let rMax = 80, r2max = 6400;

  // typed-array particle store (indices 0..n-1 active; capacity `cap`)
  let px, py, vx, vy, sp, spPrev, cf;
  // spatial grid
  let cols = 1, rows = 1, cellW = 1, cellH = 1, head, next;

  // attraction matrix (MAX_SPECIES^2); morph from cur -> tgt over morphT
  const matCur = new Float32Array(MAX_SPECIES * MAX_SPECIES);
  const matTgt = new Float32Array(MAX_SPECIES * MAX_SPECIES);
  const matEff = new Float32Array(MAX_SPECIES * MAX_SPECIES);
  let morphT = 1;             // 1 = settled
  let K = 5;                  // active species count

  // per-species glow sprites (regenerated on palette change / dpr change)
  let sprites = [];
  let GLOW = 8;               // glow radius (css px)

  let running = false, overlayUp = true, lastT = 0;
  let idleT = 0;              // seconds since last user interaction (drives auto-reroll)

  /* ============================ sizing / allocation ============================ */
  function isMobile() {
    return (window.matchMedia && window.matchMedia("(max-width: 820px)").matches) ||
           (("ontouchstart" in window) && Math.min(window.innerWidth, window.innerHeight) < 760);
  }

  function allocate() {
    if (isMobile()) { base = 1000; cap = 1200; GLOW = 6.3; }
    else { base = 2800; cap = 3400; GLOW = 7.5; }
    px = new Float32Array(cap); py = new Float32Array(cap);
    vx = new Float32Array(cap); vy = new Float32Array(cap);
    sp = new Uint8Array(cap); spPrev = new Uint8Array(cap); cf = new Float32Array(cap);
    next = new Int32Array(cap);
    n = base;
    for (let i = 0; i < n; i++) {
      px[i] = Math.random() * W; py[i] = Math.random() * H;
      vx[i] = (Math.random() - 0.5) * 20; vy[i] = (Math.random() - 0.5) * 20;
      sp[i] = (Math.random() * K) | 0; spPrev[i] = sp[i]; cf[i] = 0;
    }
  }

  function computeRMax() {
    const spacing = Math.sqrt((W * H) / Math.max(1, base));
    rMax = Math.max(52, Math.min(120, spacing * 3.3));
    r2max = rMax * rMax;
  }

  function buildGrid() {
    cols = Math.max(1, Math.floor(W / rMax));
    rows = Math.max(1, Math.floor(H / rMax));
    cellW = W / cols; cellH = H / rows;
    head = new Int32Array(cols * rows);
  }

  /* ============================ sprites ============================ */
  function makeSprites() {
    sprites = [];
    const cols4 = PALETTES[paletteIdx].cols;
    for (let s = 0; s < MAX_SPECIES; s++) {
      const c = cols4[s % cols4.length];
      const cv = document.createElement("canvas");
      const size = Math.ceil(GLOW * 2 * dpr);
      cv.width = cv.height = size;
      const g = cv.getContext("2d");
      const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grad.addColorStop(0.0, "rgba(" + c[0] + "," + c[1] + "," + c[2] + ",0.82)");
      grad.addColorStop(0.24, "rgba(" + c[0] + "," + c[1] + "," + c[2] + ",0.46)");
      grad.addColorStop(0.55, "rgba(" + c[0] + "," + c[1] + "," + c[2] + ",0.13)");
      grad.addColorStop(1.0, "rgba(" + c[0] + "," + c[1] + "," + c[2] + ",0)");
      g.fillStyle = grad; g.fillRect(0, 0, size, size);
      // a tiny hot core for definition (kept subtle so dense clusters keep their species color
      // instead of stacking to pure white under additive blending)
      const core = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.12);
      core.addColorStop(0, "rgba(255,255,255,0.22)");
      core.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = core; g.fillRect(0, 0, size, size);
      sprites.push(cv);
    }
  }

  /* ============================ species / rules ============================ */
  // Random attraction matrix in [-1, 1]. Self-interaction is nudged toward mild self-attraction
  // some of the time so clumps + membranes form readily.
  function randomMatrix(out) {
    for (let a = 0; a < MAX_SPECIES; a++) {
      for (let b = 0; b < MAX_SPECIES; b++) {
        let v = Math.random() * 2 - 1;
        if (a === b && Math.random() < 0.55) v = 0.25 + Math.random() * 0.55; // cohesive cores
        out[a * MAX_SPECIES + b] = v;
      }
    }
  }

  function setDots() {
    const cols4 = PALETTES[paletteIdx].cols;
    let html = "";
    for (let s = 0; s < K; s++) {
      const c = cols4[s % cols4.length];
      const rgb = "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
      const glow = "rgba(" + c[0] + "," + c[1] + "," + c[2] + ",0.6)";
      html += '<span class="dot" style="background:' + rgb + ';box-shadow:0 0 9px ' + glow + '"></span>';
    }
    dotsEl.innerHTML = html;
  }

  // Reroll the rules. changeCount=true may also change the species count (a bigger shift,
  // used by the manual button); auto-rerolls keep K fixed for a perfectly smooth morph.
  function reroll(changeCount) {
    // snapshot current effective matrix as the "from"
    for (let i = 0; i < MAX_SPECIES * MAX_SPECIES; i++) matCur[i] = matEff[i];

    let newK = K;
    if (changeCount && Math.random() < 0.55) {
      do { newK = 4 + ((Math.random() * 3) | 0); } while (newK === K); // 4..6, different
    }
    randomMatrix(matTgt);

    if (newK !== K) {
      // reassign species; crossfade each particle's color from its old species to the new one
      for (let i = 0; i < n; i++) {
        const old = sp[i];
        let ns = (Math.random() * newK) | 0;
        if (ns === old && Math.random() < 0.5) ns = (Math.random() * newK) | 0;
        spPrev[i] = old; sp[i] = ns; cf[i] = 1;
      }
      K = newK;
      setDots();
    }
    morphT = 0;
    idleT = 0;
    audioReroll();
  }

  /* ============================ simulation ============================ */
  function force(rr, a) {
    if (rr < BETA) return rr / BETA - 1;                 // universal short-range repulsion
    if (rr < 1) return a * (1 - Math.abs(2 * rr - 1 - BETA) / (1 - BETA));
    return 0;
  }

  function step(dt) {
    // advance the rules morph
    if (morphT < 1) {
      morphT = Math.min(1, morphT + dt / (REDMO ? 3.0 : 1.9));
      const e = morphT * morphT * (3 - 2 * morphT);       // smoothstep
      for (let i = 0; i < MAX_SPECIES * MAX_SPECIES; i++) matEff[i] = matCur[i] + (matTgt[i] - matCur[i]) * e;
      if (morphT >= 1) matCur.set(matTgt);
    }

    // rebuild spatial grid
    head.fill(-1);
    for (let i = 0; i < n; i++) {
      let cxi = (px[i] / cellW) | 0, cyi = (py[i] / cellH) | 0;
      if (cxi < 0) cxi = 0; else if (cxi >= cols) cxi = cols - 1;
      if (cyi < 0) cyi = 0; else if (cyi >= rows) cyi = rows - 1;
      const c = cyi * cols + cxi;
      next[i] = head[c]; head[c] = i;
    }

    const useStir = stirActive;
    // force + velocity pass (reads positions, writes velocities)
    for (let i = 0; i < n; i++) {
      const xi = px[i], yi = py[i], si = sp[i] * MAX_SPECIES;
      let fx = 0, fy = 0;
      let cxi = (xi / cellW) | 0, cyi = (yi / cellH) | 0;
      if (cxi < 0) cxi = 0; else if (cxi >= cols) cxi = cols - 1;
      if (cyi < 0) cyi = 0; else if (cyi >= rows) cyi = rows - 1;

      for (let gy = -1; gy <= 1; gy++) {
        let ny = cyi + gy; if (ny < 0) ny += rows; else if (ny >= rows) ny -= rows;
        const rowBase = ny * cols;
        for (let gx = -1; gx <= 1; gx++) {
          let nx = cxi + gx; if (nx < 0) nx += cols; else if (nx >= cols) nx -= cols;
          let j = head[rowBase + nx];
          while (j !== -1) {
            if (j !== i) {
              let dx = px[j] - xi, dy = py[j] - yi;
              if (dx > halfW) dx -= W; else if (dx < -halfW) dx += W;
              if (dy > halfH) dy -= H; else if (dy < -halfH) dy += H;
              const d2 = dx * dx + dy * dy;
              if (d2 > 0 && d2 < r2max) {
                const d = Math.sqrt(d2);
                const f = force(d / rMax, matEff[si + sp[j]]);
                const inv = f / d;
                fx += dx * inv; fy += dy * inv;
              }
            }
            j = next[j];
          }
        }
      }

      const ax = fx * rMax * FORCE, ay = fy * rMax * FORCE;
      let nvx = vx[i] * FRICTION + ax * dt;
      let nvy = vy[i] * FRICTION + ay * dt;

      if (useStir) {
        let dx = xi - stirX, dy = yi - stirY;
        if (dx > halfW) dx -= W; else if (dx < -halfW) dx += W;
        if (dy > halfH) dy -= H; else if (dy < -halfH) dy += H;
        const d2 = dx * dx + dy * dy;
        if (d2 < STIR_R * STIR_R) {
          const d = Math.sqrt(d2) || 0.001;
          const fall = 1 - d / STIR_R;
          nvx += ((dx / d) * STIR_PUSH + stirVX * STIR_CARRY) * fall;
          nvy += ((dy / d) * STIR_PUSH + stirVY * STIR_CARRY) * fall;
        }
      }

      // clamp speed
      const s2 = nvx * nvx + nvy * nvy;
      if (s2 > MAX_SPEED * MAX_SPEED) { const k = MAX_SPEED / Math.sqrt(s2); nvx *= k; nvy *= k; }
      vx[i] = nvx; vy[i] = nvy;
    }

    // integrate positions + wrap + decay color crossfades
    const cfDecay = dt * 2.8;
    for (let i = 0; i < n; i++) {
      let x = px[i] + vx[i] * dt, y = py[i] + vy[i] * dt;
      if (x < 0) x += W; else if (x >= W) x -= W;
      if (y < 0) y += H; else if (y >= H) y -= H;
      px[i] = x; py[i] = y;
      if (cf[i] > 0) { cf[i] -= cfDecay; if (cf[i] < 0) cf[i] = 0; }
    }

    // the drag-carry impulse is a one-frame kick; decay it so the swarm settles when you pause
    stirVX *= 0.55; stirVY *= 0.55;
  }

  /* ============================ render ============================ */
  function render() {
    // fade the previous frame toward the background (comet trails), then add glow
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(6,7,15," + TRAIL_FADE + ")";
    ctx.fillRect(0, 0, W, H);

    ctx.globalCompositeOperation = "lighter";
    const g2 = GLOW * 2;
    for (let i = 0; i < n; i++) {
      const x = px[i] - GLOW, y = py[i] - GLOW;
      const c = cf[i];
      if (c > 0.02) {
        ctx.globalAlpha = 1 - c;
        ctx.drawImage(sprites[sp[i]], x, y, g2, g2);
        ctx.globalAlpha = c;
        ctx.drawImage(sprites[spPrev[i]], x, y, g2, g2);
      } else {
        ctx.globalAlpha = 1;
        ctx.drawImage(sprites[sp[i]], x, y, g2, g2);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  /* ============================ frame loop ============================ */
  function frame(ts) {
    if (!running) return;
    const dt = lastT ? Math.min(0.05, (ts - lastT) / 1000) : 0.016;
    lastT = ts;

    if (!overlayUp) {
      if (stirActive) idleT = 0; else idleT += dt;
      if (!REDMO && idleT > AUTO_REROLL && morphT >= 1) { reroll(false); }
    }

    step(SIM_DT);
    render();
    updateAudio(dt);

    requestAnimationFrame(frame);
  }
  function startLoop() { if (running) return; running = true; lastT = 0; requestAnimationFrame(frame); }
  function stopLoop() { running = false; }

  /* ============================ interaction ============================ */
  let stirActive = false, stirX = 0, stirY = 0, stirVX = 0, stirVY = 0;
  let downX = 0, downY = 0, downT = 0, moved = 0, activePointer = null;

  function canvasXY(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function spawnBurst(x, y) {
    const cnt = Math.min(28, Math.max(14, (base * 0.012) | 0));
    const species = (Math.random() * K) | 0;    // one colored colony
    for (let k = 0; k < cnt; k++) {
      let i;
      if (n < cap) { i = n++; } else { i = (Math.random() * base) | 0; } // recycle when full
      const ang = Math.random() * Math.PI * 2, rad = Math.random() * 18;
      let nx = x + Math.cos(ang) * rad, ny = y + Math.sin(ang) * rad;
      if (nx < 0) nx += W; else if (nx >= W) nx -= W;
      if (ny < 0) ny += H; else if (ny >= H) ny -= H;
      px[i] = nx; py[i] = ny;
      const sp2 = 220 + Math.random() * 180;
      vx[i] = Math.cos(ang) * sp2; vy[i] = Math.sin(ang) * sp2;
      spPrev[i] = sp[i]; sp[i] = species; cf[i] = 1;
    }
    audioBlip(species);
  }

  function onDown(e) {
    if (overlayUp || activePointer !== null) return;
    activePointer = e.pointerId;
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    const p = canvasXY(e);
    downX = p.x; downY = p.y; downT = performance.now(); moved = 0;
    stirX = p.x; stirY = p.y; stirVX = 0; stirVY = 0;
    hideHint();
    idleT = 0;
  }
  function onMove(e) {
    if (e.pointerId !== activePointer) return;
    const p = canvasXY(e);
    const ddx = p.x - stirX, ddy = p.y - stirY;
    moved += Math.hypot(p.x - stirX, p.y - stirY);
    stirVX = ddx / SIM_DT * 0.045;   // convert screen delta into a carry velocity
    stirVY = ddy / SIM_DT * 0.045;
    stirX = p.x; stirY = p.y;
    if (moved > 9 && !stirActive) { stirActive = true; canvas.classList.add("is-stirring"); }
    idleT = 0;
  }
  function onUp(e) {
    if (e.pointerId !== activePointer) return;
    const dt = performance.now() - downT;
    if (moved < 9 && dt < 320) spawnBurst(downX, downY);   // a tap -> spawn a burst
    activePointer = null;
    stirActive = false; stirVX = 0; stirVY = 0;
    canvas.classList.remove("is-stirring");
  }
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });

  /* ============================ controls ============================ */
  function cyclePalette() {
    paletteIdx = (paletteIdx + 1) % PALETTES.length;
    paletteBtn.textContent = PALETTES[paletteIdx].name;
    makeSprites();
    setDots();
  }
  function flashRules() {
    rulesBtn.classList.add("is-flash");
    setTimeout(function () { rulesBtn.classList.remove("is-flash"); }, 260);
  }

  rulesBtn.addEventListener("click", function () { reroll(true); flashRules(); if (window.gtag) try { gtag("event", "particle_reroll"); } catch (e) {} });
  paletteBtn.addEventListener("click", cyclePalette);
  soundBtn.addEventListener("click", function () { setSound(!audioOn); });

  window.addEventListener("keydown", function (e) {
    if (overlayUp) return;
    if (e.key === "n" || e.key === "N" || e.key === " ") { e.preventDefault(); reroll(true); flashRules(); }
    else if (e.key === "p" || e.key === "P") cyclePalette();
    else if (e.key === "s" || e.key === "S") setSound(!audioOn);
  });

  /* ============================ hint ============================ */
  let hintTimer = null;
  function hideHint() { hint.classList.add("is-gone"); }
  function showHint(t) {
    hint.textContent = t; hint.classList.remove("is-gone");
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(hideHint, 4600);
  }

  /* ============================ audio (calm generative pad) ============================ */
  // A soft evolving pad through a convolver reverb + compressor + master lowpass. On reroll the
  // chord glides to a new voicing (the "sound" of a new ecosystem); taps drop a gentle bell blip.
  let AC = null, master = null, padLP = null, padGain = null, chimeBus = null;
  let voices = [];            // { osc, gain, detOsc, detGain, pan }
  let audioOn = true, audioStarted = false, lastBlip = 0;
  const MASTER_VOL = 0.36;

  // chord voicings (frequencies), each a consonant, spacious cluster
  const CHORDS = [
    [98.00, 146.83, 220.00, 293.66, 440.00],   // D-ish open fifths/ninths
    [110.00, 164.81, 246.94, 329.63, 493.88],  // A add9
    [130.81, 196.00, 261.63, 392.00, 523.25],  // C open fifths
    [123.47, 185.00, 246.94, 369.99, 493.88],  // B min-ish airy
    [146.83, 220.00, 293.66, 440.00, 587.33]   // D higher, brighter
  ];
  let chordIdx = 0;

  function makeImpulse(dur, decay) {
    const rate = AC.sampleRate, len = Math.floor(rate * dur);
    const buf = AC.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) { const t = i / len; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay); }
    }
    return buf;
  }
  function startAudio() {
    if (audioStarted) { if (AC && AC.state === "suspended") AC.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    AC = new Ctx();
    audioStarted = true;
    // iOS unlock: 1-sample silent buffer inside the gesture
    try { const b = AC.createBuffer(1, 1, 22050); const s = AC.createBufferSource(); s.buffer = b; s.connect(AC.destination); s.start(0); } catch (e) {}

    master = AC.createGain(); master.gain.value = 0; master.connect(AC.destination);
    const comp = AC.createDynamicsCompressor();
    comp.threshold.value = -15; comp.ratio.value = 3; comp.attack.value = 0.02; comp.release.value = 0.3;
    comp.connect(master);

    const conv = AC.createConvolver(); conv.buffer = makeImpulse(3.6, 2.4);
    const wet = AC.createGain(); wet.gain.value = 0.6; conv.connect(wet); wet.connect(comp);
    const dry = AC.createGain(); dry.gain.value = 0.7; dry.connect(comp);

    padLP = AC.createBiquadFilter(); padLP.type = "lowpass"; padLP.frequency.value = 900; padLP.Q.value = 0.6;
    padLP.connect(dry); padLP.connect(conv);
    padGain = AC.createGain(); padGain.gain.value = 0.9; padGain.connect(padLP);
    chimeBus = AC.createGain(); chimeBus.gain.value = 0.5; chimeBus.connect(dry); chimeBus.connect(conv);

    // one detuned-pair voice per chord tone, panned across the field for width
    const chord = CHORDS[chordIdx];
    voices = [];
    for (let i = 0; i < chord.length; i++) {
      const pan = AC.createStereoPanner ? AC.createStereoPanner() : null;
      const dest = pan || padGain;
      if (pan) { pan.pan.value = (i / (chord.length - 1) - 0.5) * 0.72; pan.connect(padGain); }
      const g = AC.createGain(); g.gain.value = (i === 0 ? 0.16 : 0.11) * (1 - i * 0.06); g.connect(dest);
      const o = AC.createOscillator(); o.type = i === 0 ? "sine" : "triangle"; o.frequency.value = chord[i];
      o.connect(g); o.start();
      const dg = AC.createGain(); dg.gain.value = g.gain.value * 0.5; dg.connect(dest);
      const dO = AC.createOscillator(); dO.type = "triangle"; dO.frequency.value = chord[i]; dO.detune.value = 6.5;
      dO.connect(dg); dO.start();
      voices.push({ osc: o, gain: g, detOsc: dO, detGain: dg });
    }
    // slow filter breathing + amplitude drift (keeps the pad alive)
    const lfo = AC.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 0.05;
    const lfoG = AC.createGain(); lfoG.gain.value = 220; lfo.connect(lfoG); lfoG.connect(padLP.frequency); lfo.start();
    const alfo = AC.createOscillator(); alfo.type = "sine"; alfo.frequency.value = 0.07;
    const alfoG = AC.createGain(); alfoG.gain.value = 0.12; alfo.connect(alfoG); alfoG.connect(padGain.gain); alfo.start();

    master.gain.setValueAtTime(0.0001, AC.currentTime);
    master.gain.linearRampToValueAtTime(audioOn ? MASTER_VOL : 0.0001, AC.currentTime + 2.4);
  }
  function updateAudio() { /* pad evolves via its own LFOs; nothing per-frame required */ }

  function audioReroll() {
    if (!AC || !audioOn || !voices.length) return;
    chordIdx = (chordIdx + 1 + ((Math.random() * (CHORDS.length - 1)) | 0)) % CHORDS.length;
    const chord = CHORDS[chordIdx], now = AC.currentTime;
    for (let i = 0; i < voices.length; i++) {
      const f = chord[i % chord.length];
      voices[i].osc.frequency.setTargetAtTime(f, now, 0.8);
      voices[i].detOsc.frequency.setTargetAtTime(f, now, 0.8);
    }
    // a soft swell to mark the shift
    if (chimeBus) chimeBus.gain.setTargetAtTime(0.8, now, 0.1), chimeBus.gain.setTargetAtTime(0.5, now + 0.6, 0.6);
  }
  function audioBlip(species) {
    if (!AC || !audioOn || !chimeBus) return;
    const now = AC.currentTime;
    if (now - lastBlip < 0.09) return;   // throttle
    lastBlip = now;
    const scale = [0, 3, 5, 7, 10, 12];  // gentle minor-pentatonic-ish
    const deg = scale[species % scale.length];
    const base2 = 392 * Math.pow(2, (deg + (Math.random() < 0.5 ? 0 : 12)) / 12);
    [1, 2.01].forEach(function (mult, i) {
      const o = AC.createOscillator(); o.type = "sine"; o.frequency.value = base2 * mult;
      const g = AC.createGain(); g.gain.value = 0;
      o.connect(g); g.connect(chimeBus);
      const amp = 0.12 / (i + 1);
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(amp, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0006, now + 1.1 - i * 0.2);
      o.start(now); o.stop(now + 1.2);
    });
  }
  function setSound(on) {
    audioOn = on;
    soundBtn.setAttribute("aria-pressed", on ? "true" : "false");
    if (on) { startAudio(); if (AC) { AC.resume(); master.gain.setTargetAtTime(MASTER_VOL, AC.currentTime, 0.3); } }
    else if (AC) { master.gain.setTargetAtTime(0.0001, AC.currentTime, 0.2); }
  }

  /* ============================ resize ============================ */
  function applyCanvasSize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#06070f"; ctx.fillRect(0, 0, W, H);
  }
  function resize() {
    const oldW = W, oldH = H;
    W = window.innerWidth; H = window.innerHeight; halfW = W / 2; halfH = H / 2;
    applyCanvasSize();
    if (px && n > 0 && oldW > 1) {
      const sx = W / oldW, sy = H / oldH;
      for (let i = 0; i < n; i++) { px[i] *= sx; py[i] *= sy; }
    }
    computeRMax();
    buildGrid();
  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", function () { setTimeout(resize, 120); });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stopLoop();
    else startLoop();
  });

  /* ============================ boot ============================ */
  W = window.innerWidth; H = window.innerHeight; halfW = W / 2; halfH = H / 2;
  applyCanvasSize();
  computeRMax();
  allocate();
  buildGrid();
  randomMatrix(matTgt); matEff.set(matTgt); matCur.set(matTgt); morphT = 1;
  makeSprites();
  paletteBtn.textContent = PALETTES[paletteIdx].name;
  soundBtn.setAttribute("aria-pressed", "true");
  setDots();
  startLoop();   // sim runs behind the intro overlay so structures are already forming

  function dismissOverlay() {
    if (!overlayUp) return;
    overlayUp = false;
    overlay.classList.add("is-hidden");
    setTimeout(function () { overlay.hidden = true; }, 360);
    if (audioOn) startAudio();
    showHint("tap to spawn · drag to stir · New rules for a fresh world");
    idleT = 0;
  }
  ovBtn.addEventListener("click", dismissOverlay);
})();
