/* Steel Tongue Drum — a warm, meditative tank drum you play top-down.
 * Strike the tongues (tap or drag across them) for round, blooming, hang-drum
 * tones; the struck tongue glows and sends a ripple across the steel. Tuned to
 * pentatonic / Akebono scales so anything you play sounds calm and consonant.
 * Vanilla Canvas 2D + Web Audio (fully synthesized — no samples).
 */
(function () {
  "use strict";

  // ---- TUNABLES -----------------------------------------------------------
  var RING = 8;                 // tongues around the ring (+1 central = 9 notes)
  var BASE_MIDI = 57;           // A3 root
  var SCALES = [
    { name: "Minor", deg: [0, 3, 5, 7, 10] },
    { name: "Major", deg: [0, 2, 4, 7, 9] },
    { name: "Akebono", deg: [0, 2, 3, 7, 8] }   // Japanese pentatonic — very "zen"
  ];
  // -------------------------------------------------------------------------

  var NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  var TAU = Math.PI * 2, A0 = -Math.PI / 2;   // ring starts at the top

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var hintEl = document.querySelector(".hint");

  var W, H, DPR, cx, cy, R, centralR, ringInner, ringOuter, midR, tongueW;
  var tongues = [];             // [0] = central, [1..RING] = ring (ascending)
  var scaleIdx = 0, labels = false;
  var ripples = [], dust = [];
  var pointerDown = false, lastTongue = -2;

  // ---- tuning / layout ----------------------------------------------------
  function buildTongues() {
    var deg = SCALES[scaleIdx].deg;
    tongues = [];
    for (var k = 0; k <= RING; k++) {
      var midi = BASE_MIDI + deg[k % 5] + 12 * Math.floor(k / 5);
      tongues.push({
        k: k, isCenter: k === 0, midi: midi,
        freq: 440 * Math.pow(2, (midi - 69) / 12),
        name: NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1),
        angle: k === 0 ? 0 : A0 + (k - 1) * (TAU / RING),
        glow: 0
      });
    }
  }
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    cx = W / 2; cy = H * 0.54;
    R = Math.min(Math.min(W, H) * 0.36, 330);
    centralR = R * 0.19;
    ringInner = R * 0.32; ringOuter = R * 0.92;
    midR = (ringInner + ringOuter) / 2;
    tongueW = (TAU * midR / RING) * 0.66;
    if (!dust.length) seedDust();
  }
  function tongueCenter(tn) {
    if (tn.isCenter) return [cx, cy];
    return [cx + midR * Math.cos(tn.angle), cy + midR * Math.sin(tn.angle)];
  }
  function seedDust() {
    dust = [];
    for (var i = 0; i < 22; i++) dust.push({ x: Math.random() * W, y: Math.random() * H, r: 0.5 + Math.random() * 1.6, sp: 3 + Math.random() * 9, ph: Math.random() * 6.28, tw: 0.3 + Math.random() * 0.5 });
  }

  // ---- render -------------------------------------------------------------
  function render(t) {
    // calm dark scene
    var bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.75);
    bg.addColorStop(0, "#17262c"); bg.addColorStop(0.55, "#0c161a"); bg.addColorStop(1, "#05090b");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // floating dust
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    for (var i = 0; i < dust.length; i++) { var m = dust[i]; ctx.fillStyle = "rgba(190,220,230," + (0.06 + 0.14 * (0.5 + 0.5 * Math.sin(t * m.tw + m.ph))) + ")"; ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, TAU); ctx.fill(); }
    ctx.restore();

    // drum body — a convex gunmetal dome, lit from upper-left
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 50; ctx.shadowOffsetY = 20;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU);
    var body = ctx.createRadialGradient(cx - R * 0.34, cy - R * 0.42, R * 0.05, cx, cy, R * 1.08);
    body.addColorStop(0, "#7d8894"); body.addColorStop(0.35, "#525c66"); body.addColorStop(0.7, "#333b43"); body.addColorStop(1, "#171c22");
    ctx.fillStyle = body; ctx.fill();
    ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip();
    // faint concentric lathe marks
    ctx.globalAlpha = 0.06; ctx.strokeStyle = "#aab4c0"; ctx.lineWidth = 1;
    for (i = 1; i < 9; i++) { ctx.beginPath(); ctx.arc(cx, cy, R * (i / 9), 0, TAU); ctx.stroke(); }
    ctx.globalAlpha = 1;
    // broad soft sheen (upper-left)
    var sheen = ctx.createRadialGradient(cx - R * 0.36, cy - R * 0.44, 0, cx - R * 0.36, cy - R * 0.44, R * 1.1);
    sheen.addColorStop(0, "rgba(214,226,240,0.30)"); sheen.addColorStop(0.4, "rgba(214,226,240,0.05)"); sheen.addColorStop(1, "rgba(214,226,240,0)");
    ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = sheen; ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    // warm scene glint (lower-right)
    var warm = ctx.createRadialGradient(cx + R * 0.4, cy + R * 0.5, 0, cx + R * 0.4, cy + R * 0.5, R * 0.9);
    warm.addColorStop(0, "rgba(255,196,130,0.10)"); warm.addColorStop(1, "rgba(255,196,130,0)");
    ctx.fillStyle = warm; ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    ctx.restore();
    // raised bezel rim
    ctx.lineWidth = Math.max(5, R * 0.05); ctx.strokeStyle = "#12161b"; ctx.beginPath(); ctx.arc(cx, cy, R - ctx.lineWidth / 2, 0, TAU); ctx.stroke();
    ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(210,224,240,0.35)"; ctx.beginPath(); ctx.arc(cx, cy, R - Math.max(5, R * 0.05) - 1, -2.3, 0.5, false); ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,0.4)"; ctx.beginPath(); ctx.arc(cx, cy, R - Math.max(5, R * 0.05) - 1, 0.5, 2.3, false); ctx.stroke();

    // tongues
    for (i = 1; i <= RING; i++) drawRingTongue(tongues[i]);
    drawCenterTongue(tongues[0]);

    // ripples (clipped to the drum)
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R - 3, 0, TAU); ctx.clip(); ctx.globalCompositeOperation = "lighter";
    for (i = 0; i < ripples.length; i++) {
      var rp = ripples[i];
      ctx.strokeStyle = "rgba(255,206,140," + Math.max(0, rp.life * 0.3) + ")"; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.arc(rp.x, rp.y, rp.r, 0, TAU); ctx.stroke();
    }
    ctx.restore();
  }

  function capsule(x1, y1, x2, y2, w) {   // closed stadium — used for relief + glow fills
    var r = w / 2, ph = Math.atan2(y2 - y1, x2 - x1), h = Math.PI / 2;
    ctx.beginPath();
    ctx.arc(x1, y1, r, ph + h, ph - h, true);   // cap at inner tip (bulges away from root)
    ctx.arc(x2, y2, r, ph - h, ph + h, true);   // cap at outer root (bulges away from tip)
    ctx.closePath();                            // arcs auto-join into the two straight flanks
  }
  function slotPath(x1, y1, x2, y2, w) {   // open U — the cut around a tongue (root stays attached)
    var dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, nx = -uy, ny = ux, r = w / 2;
    ctx.beginPath();
    ctx.moveTo(x2 + nx * r, y2 + ny * r);
    ctx.lineTo(x1 + nx * r, y1 + ny * r);
    ctx.arc(x1, y1, r, Math.atan2(ny, nx), Math.atan2(-ny, -nx), true);
    ctx.lineTo(x2 - nx * r, y2 - ny * r);
  }
  var LX = -0.71, LY = -0.71;   // light direction (upper-left)
  function drawRingTongue(tn) {
    var a = tn.angle, cA = Math.cos(a), sA = Math.sin(a);
    var x1 = cx + cA * ringInner, y1 = cy + sA * ringInner;   // inner tip (free end, toward center)
    var x2 = cx + cA * ringOuter, y2 = cy + sA * ringOuter;   // outer root (attached, toward rim)
    // gentle CROSS-tongue emboss — a soft cylinder cross-section so each tongue reads
    // as a consistent raised rounded petal (NOT a plate-wide diagonal that paints bright
    // triangular wedges on some tongues + dark ones on others).
    var nx = -sA, ny = cA, r = tongueW / 2, mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    var litSign = (nx * LX + ny * LY) >= 0 ? 1 : -1;
    ctx.save(); capsule(x1, y1, x2, y2, tongueW); ctx.clip();
    var rel = ctx.createLinearGradient(mx - nx * r * litSign, my - ny * r * litSign, mx + nx * r * litSign, my + ny * r * litSign);
    rel.addColorStop(0, "rgba(0,0,0,0.12)"); rel.addColorStop(0.5, "rgba(255,255,255,0.015)"); rel.addColorStop(1, "rgba(236,244,252,0.13)");
    ctx.fillStyle = rel; ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    ctx.restore();
    glowOverlay(tn, x1, y1, x2, y2);
    // slot cut: soft shadow lip (down-right), dark core, bright highlight lip (up-left) = engraved bevel
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    slotPath(x1 - LX * 1.4, y1 - LY * 1.4, x2 - LX * 1.4, y2 - LY * 1.4, tongueW);
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.45)"; ctx.stroke();
    slotPath(x1, y1, x2, y2, tongueW);
    ctx.lineWidth = 3.2; ctx.strokeStyle = "rgba(9,12,15,0.95)"; ctx.stroke();
    slotPath(x1 + LX * 1.3, y1 + LY * 1.3, x2 + LX * 1.3, y2 + LY * 1.3, tongueW);
    ctx.lineWidth = 1.2; ctx.strokeStyle = "rgba(226,236,248,0.22)"; ctx.stroke();
    // small drilled tip hole
    ctx.fillStyle = "#0d1013"; ctx.beginPath(); ctx.arc(x1 + cA * tongueW * 0.42, y1 + sA * tongueW * 0.42, tongueW * 0.1, 0, TAU); ctx.fill();
    labelTongue(tn);
  }
  function drawCenterTongue(tn) {
    // raised central tongue — same gunmetal, lit upper-left
    var mg = ctx.createRadialGradient(cx - centralR * 0.42, cy - centralR * 0.45, centralR * 0.1, cx, cy, centralR * 1.15);
    mg.addColorStop(0, "rgba(230,240,250,0.16)"); mg.addColorStop(0.55, "rgba(255,255,255,0)"); mg.addColorStop(1, "rgba(0,0,0,0.22)");
    ctx.beginPath(); ctx.arc(cx, cy, centralR, 0, TAU); ctx.fillStyle = mg; ctx.fill();
    if (tn.glow > 0.01) { ctx.save(); ctx.globalCompositeOperation = "lighter"; var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, centralR); g.addColorStop(0, "rgba(255,206,140," + tn.glow * 0.6 + ")"); g.addColorStop(1, "rgba(255,200,130,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, centralR, 0, TAU); ctx.fill(); ctx.restore(); }
    // engraved ring cut (bevel), leaving a small bridge gap so it reads as attached
    ctx.lineCap = "round";
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath(); ctx.arc(cx, cy, centralR + 1.3, -Math.PI * 0.42, Math.PI * 1.42, false); ctx.stroke();
    ctx.lineWidth = 3.2; ctx.strokeStyle = "rgba(9,12,15,0.95)";
    ctx.beginPath(); ctx.arc(cx, cy, centralR, -Math.PI * 0.42, Math.PI * 1.42, false); ctx.stroke();
    ctx.lineWidth = 1.2; ctx.strokeStyle = "rgba(226,236,248,0.22)";
    ctx.beginPath(); ctx.arc(cx, cy, centralR - 1.3, -Math.PI * 0.42, Math.PI * 1.42, false); ctx.stroke();
    labelTongue(tn);
  }
  function glowOverlay(tn, x1, y1, x2, y2) {
    if (tn.glow <= 0.01) return;
    // soft warm bloom centered on the struck tongue (fades) — reads clearly as "this
    // petal rang", instead of a flat additive wedge that blows toward white.
    var mx = (x1 + x2) / 2, my = (y1 + y2) / 2, len = Math.hypot(x2 - x1, y2 - y1);
    ctx.save(); ctx.globalCompositeOperation = "lighter"; capsule(x1, y1, x2, y2, tongueW); ctx.clip();
    var gr = ctx.createRadialGradient(mx, my, 0, mx, my, len * 0.62);
    gr.addColorStop(0, "rgba(255,212,148," + tn.glow * 0.62 + ")"); gr.addColorStop(1, "rgba(255,196,120,0)");
    ctx.fillStyle = gr; ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    ctx.restore();
  }
  function labelTongue(tn) {
    if (!labels) return;
    var c = tongueCenter(tn);
    ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "600 " + Math.max(10, R * 0.06) + "px Geist, system-ui, sans-serif";
    ctx.fillStyle = "rgba(232,240,250,0.8)"; ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 4; ctx.fillText(tn.name, c[0], c[1]);
    ctx.restore();
  }

  // ---- strike -------------------------------------------------------------
  function strike(idx, vel) {
    var tn = tongues[idx]; if (!tn) return;
    tn.glow = 1;
    var c = tongueCenter(tn);
    ripples.push({ x: c[0], y: c[1], r: tn.isCenter ? centralR * 0.5 : tongueW * 0.5, life: 1 });
    var pan = Math.max(-1, Math.min(1, (c[0] - cx) / R * 0.7));
    tone(tn.freq, vel || 1, pan);
    if (hintEl) hintEl.classList.add("is-hidden");
  }

  // ---- loop ---------------------------------------------------------------
  var lastTs = null;
  function frame(ts) {
    var t = ts / 1000, dt = lastTs !== null ? Math.min((ts - lastTs) / 1000, 0.05) : 0.016; lastTs = ts;
    for (var i = 0; i <= RING; i++) if (tongues[i].glow > 0) tongues[i].glow = Math.max(0, tongues[i].glow - dt * 2.0);
    for (i = ripples.length - 1; i >= 0; i--) { var rp = ripples[i]; rp.r += dt * 130; rp.life -= dt * 1.5; if (rp.life <= 0 || rp.r > R) ripples.splice(i, 1); }
    for (i = 0; i < dust.length; i++) { var m = dust[i]; m.y -= m.sp * dt; m.x += Math.sin(t * 0.3 + m.ph) * 5 * dt; if (m.y < -4) { m.y = H + 4; m.x = Math.random() * W; } }
    render(t); requestAnimationFrame(frame);
  }

  // ---- input --------------------------------------------------------------
  function tongueAt(x, y) {
    var dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
    if (r > R) return -2;
    if (r < centralR * 1.25) return 0;
    if (r < ringInner * 0.85) return -2;      // dead zone between center and ring
    var a = Math.atan2(dy, dx);
    var k = Math.round((a - A0) / (TAU / RING));
    k = ((k % RING) + RING) % RING;
    return k + 1;
  }
  function down(x, y) {
    unlock(); pointerDown = true;
    var idx = tongueAt(x, y);
    if (idx >= 0) { strike(idx, 1); lastTongue = idx; }
  }
  function moveTo(x, y) {
    if (!pointerDown) return;
    var idx = tongueAt(x, y);
    if (idx >= 0 && idx !== lastTongue) { strike(idx, 0.78); lastTongue = idx; }
  }
  function up() { pointerDown = false; lastTongue = -2; }
  canvas.addEventListener("mousedown", function (e) { down(e.clientX, e.clientY); });
  window.addEventListener("mousemove", function (e) { moveTo(e.clientX, e.clientY); });
  window.addEventListener("mouseup", up);
  canvas.addEventListener("touchstart", function (e) { e.preventDefault(); for (var i = 0; i < e.changedTouches.length; i++) { var tt = e.changedTouches[i]; unlock(); pointerDown = true; var idx = tongueAt(tt.clientX, tt.clientY); if (idx >= 0) { strike(idx, 1); lastTongue = idx; } } }, { passive: false });
  canvas.addEventListener("touchmove", function (e) { e.preventDefault(); var tt = e.touches[0]; moveTo(tt.clientX, tt.clientY); }, { passive: false });
  window.addEventListener("touchend", up);

  var scaleBtn = document.getElementById("scaleBtn");
  scaleBtn.addEventListener("click", function () { scaleIdx = (scaleIdx + 1) % SCALES.length; scaleBtn.textContent = "Scale: " + SCALES[scaleIdx].name; buildTongues(); });
  var labelBtn = document.getElementById("labelBtn");
  labelBtn.addEventListener("click", function () { labels = !labels; labelBtn.setAttribute("aria-pressed", labels ? "true" : "false"); labelBtn.textContent = labels ? "Labels: on" : "Labels: off"; });

  // ---- audio (synth) ------------------------------------------------------
  // A steel tongue drum tongue is TUNED: a strong fundamental with a near-octave
  // overtone (harmonic, warm) plus a faint inharmonic metallic mode, struck by a
  // soft mallet (rounded attack), long blooming sustain, lots of reverb.
  var actx = null, dryBus = null, wetBus = null, echoBus = null, comp = null, outGain = null, muted = false;
  function makeImpulse(sec, decay) {
    // smooth stereo tail with a soft low-pass character (grain rolls off over time) — a lush hall
    var rate = actx.sampleRate, len = (rate * sec) | 0, buf = actx.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), lp = 0;
      for (var i = 0; i < len; i++) {
        var env = Math.pow(1 - i / len, decay);
        var n = (Math.random() * 2 - 1);
        lp += (n - lp) * 0.45;                       // gentle low-pass on the noise = smoother tail
        d[i] = (n * 0.5 + lp * 0.5) * env;
      }
    }
    return buf;
  }
  function unlock() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      var b = actx.createBuffer(1, 1, 22050), s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0);
      outGain = actx.createGain(); outGain.gain.value = muted ? 0 : 0.9;
      var mlp = actx.createBiquadFilter(); mlp.type = "lowpass"; mlp.frequency.value = 9500; mlp.Q.value = 0.5;
      comp = actx.createDynamicsCompressor();
      comp.threshold.value = -15; comp.knee.value = 28; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.28;
      comp.connect(mlp); mlp.connect(outGain); outGain.connect(actx.destination);
      dryBus = actx.createGain(); dryBus.gain.value = 0.82; dryBus.connect(comp);
      // big, lush hall reverb with a touch of shimmer
      var conv = actx.createConvolver(); conv.buffer = makeImpulse(4.2, 1.7);
      var pre = actx.createDelay(0.2); pre.delayTime.value = 0.03;
      var hp = actx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 170;
      var shelf = actx.createBiquadFilter(); shelf.type = "highshelf"; shelf.frequency.value = 3200; shelf.gain.value = 3.5;
      wetBus = actx.createGain(); wetBus.gain.value = 0.44;
      wetBus.connect(pre); pre.connect(hp); hp.connect(conv); conv.connect(shelf); shelf.connect(comp);
      // spacious feedback echo — feeds the output AND the reverb, so repeats bloom into the hall
      var dl = actx.createDelay(1.0); dl.delayTime.value = 0.33;
      var fb = actx.createGain(); fb.gain.value = 0.34;
      var elp = actx.createBiquadFilter(); elp.type = "lowpass"; elp.frequency.value = 2600;
      echoBus = actx.createGain(); echoBus.gain.value = 0.20;
      echoBus.connect(dl); dl.connect(elp); elp.connect(fb); fb.connect(dl);   // darkening feedback loop
      var eout = actx.createGain(); eout.gain.value = 0.7; elp.connect(eout); eout.connect(comp); eout.connect(pre);
    } catch (e) { actx = null; }
  }
  function tone(freq, vel, pan) {
    if (!actx) return; vel = vel || 1;
    var t = actx.currentTime, nyq = actx.sampleRate / 2;
    var dur = Math.max(2.4, Math.min(7.0, 6.0 * Math.pow(196 / freq, 0.42)));   // long, blooming sustain
    var voice = actx.createGain(); voice.gain.value = 0.72 * vel;
    try { var pn = actx.createStereoPanner(); pn.pan.value = Math.max(-1, Math.min(1, pan || 0)); voice.connect(pn); pn.connect(dryBus); pn.connect(wetBus); pn.connect(echoBus); }
    catch (e) { voice.connect(dryBus); voice.connect(wetBus); voice.connect(echoBus); }
    function part(type, f, peak, dec, atk, glide) {
      if (f > nyq * 0.9) return;
      var o = actx.createOscillator(); o.type = type;
      if (glide) { o.frequency.setValueAtTime(f * Math.pow(2, glide / 1200), t); o.frequency.exponentialRampToValueAtTime(f, t + 0.055); }   // attack "boing" — metal releasing tension
      else o.frequency.setValueAtTime(f, t);
      var g = actx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + (atk || 0.012));
      g.gain.exponentialRampToValueAtTime(0.0004, t + dec);
      o.connect(g); g.connect(voice); o.start(t); o.stop(t + dec + 0.05);
    }
    // NOT a clean harmonic stack (that reads as piano/marimba). A steel tongue drum /
    // handpan = a tuned fundamental+octave over an INHARMONIC metallic ring cluster, with
    // a beating shimmer (detuned octave) and a downward attack pitch-glide.
    part("sine", freq, 0.34, dur, 0.016, 11);                          // fundamental (+ boing)
    part("sine", freq * Math.pow(2, 4 / 1200), 0.10, dur, 0.016, 11);  // +4¢ detune shimmer
    part("sine", freq * 2, 0.17, dur * 0.88, 0.012, 9);                // octave — the tuned body
    part("sine", freq * 2 * Math.pow(2, 7 / 1200), 0.075, dur * 0.68, 0.012, 9); // detuned octave → beating shimmer
    part("sine", freq * 3, 0.03, dur * 0.5, 0.010);                    // twelfth (handpan-tuned, modest)
    // inharmonic metallic ring cluster — the "steel" voice (bell-like, not harmonic)
    part("sine", freq * 2.76, 0.055, dur * 0.34);
    part("sine", freq * 4.20, 0.034, dur * 0.26);
    part("sine", freq * 5.40, 0.022, dur * 0.20);
    part("sine", freq * 6.79, 0.013, dur * 0.15);
    // faint low body under the strike
    if (freq * 0.5 > 55) part("sine", freq * 0.5, 0.03, 0.5, 0.008);
    // soft, dark finger/mallet contact (rounder + duller than a piano hammer)
    var ln = (0.024 * actx.sampleRate) | 0, nb = actx.createBufferSource(), buf = actx.createBuffer(1, ln, actx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < ln; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ln, 1.8);
    nb.buffer = buf; var lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = Math.min(850, freq * 2); lp.Q.value = 0.5;
    var ng = actx.createGain(); ng.gain.value = 0.03 * vel; nb.connect(lp); lp.connect(voice); nb.start(t);
  }
  var soundBtn = document.getElementById("soundBtn");
  soundBtn.addEventListener("click", function () {
    muted = !muted; unlock();
    if (outGain) outGain.gain.setTargetAtTime(muted ? 0 : 0.9, actx.currentTime, 0.02);
    soundBtn.textContent = muted ? "Sound: off" : "Sound: on";
    soundBtn.setAttribute("aria-pressed", muted ? "true" : "false");
  });

  // ---- boot ---------------------------------------------------------------
  resize(); window.addEventListener("resize", resize);
  buildTongues();
  requestAnimationFrame(frame);
})();
