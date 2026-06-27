(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");

  var W, H, cx, ceilY, pivotY, hangerW, tubeW, clapLen, clapDepth, rigLen, tiltLen, maxLen;
  var G = 4200;                          // gravity (px/s²) — sets pendulum pace

  // A-major pentatonic, bright upper octave; longer tube = lower note.
  var FREQS = [440.0, 493.88, 554.37, 659.25, 739.99, 880.0];
  var N = FREQS.length;
  var tubes = [];
  var clap = { theta: 0, omega: 0, px: 0, py: 0, ppx: 0, ppy: 0, pvx: 0, pvy: 0, init: false };
  // the support bar: swings (phi) about the ceiling point AND tilts (psi) about its own attach point
  var rig = { phi: 0, phiW: 0, psi: 0, psiW: 0, grabOX: 0 };
  var rigAx, rigAy;                      // current world position of the bar's attach point

  function layout() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
    cx = W / 2;
    ceilY = 0;
    pivotY = H * 0.16;
    hangerW = Math.min(W * 0.46, 360);
    tubeW = Math.max(13, Math.min(22, hangerW / 16));
    clapDepth = H * 0.40;
    clapLen = clapDepth;
    rigLen = pivotY;                     // ceiling → bar
    maxLen = Math.min(H * 0.5, 360);
    tiltLen = maxLen * 0.55;             // rocking restoring length for the bar tilt

    var spacing = hangerW / (N - 1);
    for (var i = 0; i < N; i++) {
      var mid = (N - 1) / 2;
      var t = 1 - Math.abs(i - mid) / mid;
      var len = maxLen * (0.6 + 0.4 * t);
      var ox = -hangerW / 2 + i * spacing;     // offset along the bar from its centre
      if (tubes[i]) { tubes[i].ox = ox; tubes[i].len = len; }
      else tubes.push({
        ox: ox, len: len, theta: 0, omega: 0, freq: FREQS[i], glow: 0,
        px: 0, py: 0, ppx: 0, ppy: 0, pvx: 0, pvy: 0, init: false
      });
    }
  }
  layout();
  window.addEventListener("resize", layout);

  // ---- audio --------------------------------------------------------------
  var actx = null;
  function unlock() {
    if (actx) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      var b = actx.createBuffer(1, 1, 22050);
      var s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0);
    } catch (e) { actx = null; }
  }
  function ring(freq, vol) {
    if (!actx) return;
    if (actx.state === "suspended") actx.resume();
    var t = actx.currentTime;
    var master = actx.createGain(); master.gain.value = 1; master.connect(actx.destination);
    var lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 8500; lp.connect(master);
    // tubular-chime spectrum: inharmonic partials; higher ones ring brighter but die faster
    var parts = [[1, 1, 3.6], [2.76, 0.5, 2.3], [5.40, 0.26, 1.4], [8.93, 0.12, 0.85]];
    for (var k = 0; k < parts.length; k++) {
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = "sine"; o.frequency.value = freq * parts[k][0];
      var v = vol * parts[k][1], dur = parts[k][2];
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(lp);
      o.start(t); o.stop(t + dur + 0.05);
    }
    // metallic strike transient (the mallet contact "tink")
    var nb = actx.createBuffer(1, (actx.sampleRate * 0.03) | 0, actx.sampleRate);
    var nd = nb.getChannelData(0);
    for (var n = 0; n < nd.length; n++) nd[n] = (Math.random() * 2 - 1) * (1 - n / nd.length);
    var ns = actx.createBufferSource(); ns.buffer = nb;
    var bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = freq * 4; bp.Q.value = 1.8;
    var ng = actx.createGain();
    ng.gain.setValueAtTime(vol * 0.45, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    ns.connect(bp); bp.connect(ng); ng.connect(master);
    ns.start(t); ns.stop(t + 0.06);
  }
  function strikeTube(i, vol) { tubes[i].glow = 1; ring(tubes[i].freq, Math.max(0.04, Math.min(0.17, vol))); }

  // ---- wind ---------------------------------------------------------------
  var gust = 0;
  var hitCooldown = [];
  for (var c = 0; c < N; c++) hitCooldown.push(0);

  // ---- interaction --------------------------------------------------------
  var lastX = 0, lastY = 0, down = false, movedDist = 0;
  var grabbed = null, grabbedIdx = -1;   // grabbed = rig | clap | a tube | null

  function tubeHit(px, py) {
    for (var i = 0; i < N; i++) {
      var tb = tubes[i];
      var dx = px - tb.px, dy = py - tb.py;
      var along = dx * Math.sin(tb.theta) + dy * Math.cos(tb.theta);   // projection down the tube
      if (along < -tubeW || along > tb.len + tubeW) continue;
      var perp = Math.abs(dx * Math.cos(tb.theta) - dy * Math.sin(tb.theta));
      if (perp < tubeW * 1.6) return i;
    }
    return -1;
  }
  function clapperHit(px, py) {
    var bx = rigAx + Math.sin(clap.theta) * clapLen;
    var by = rigAy + Math.cos(clap.theta) * clapLen;
    if (Math.hypot(px - bx, py - by) < tubeW * 2.3) return true;
    var sLen = H * 0.12, sa = clap.theta;
    var ex = bx + Math.sin(sa) * sLen, ey = by + Math.cos(sa) * sLen;
    return Math.hypot(px - ex, py - ey) < tubeW * 2.6;
  }
  function barHit(px, py) {
    // the (possibly tilted) bar: test perpendicular distance to the bar line through A at angle psi
    var dx = px - rigAx, dy = py - rigAy;
    var along = dx * Math.cos(rig.psi) + dy * Math.sin(rig.psi);
    var perp = dx * -Math.sin(rig.psi) + dy * Math.cos(rig.psi);
    return Math.abs(along) < hangerW / 2 + tubeW + 8 && Math.abs(perp) < 16;
  }

  function onDown(px, py) {
    unlock();
    down = true; movedDist = 0; lastX = px; lastY = py;
    grabbed = null; grabbedIdx = -1;
    var i = tubeHit(px, py);
    if (i >= 0) { grabbed = tubes[i]; grabbedIdx = i; return; }
    if (clapperHit(px, py)) { grabbed = clap; return; }
    if (barHit(px, py)) {
      grabbed = rig;
      var dx = px - rigAx, dy = py - rigAy;
      rig.grabOX = dx * Math.cos(rig.psi) + dy * Math.sin(rig.psi);  // where along the bar
    }
  }
  function onMove(px, py) {
    var dx = px - lastX, dy = py - lastY;
    lastX = px; lastY = py;
    if (!down) return;
    movedDist += Math.hypot(dx, dy);
    if (grabbed === rig) {
      var gox = rig.grabOX;
      var ayApprox = Math.cos(rig.phi) * rigLen;
      var newPsi;
      if (Math.abs(gox) > 10) newPsi = Math.asin(Math.max(-0.85, Math.min(0.85, (py - ayApprox) / gox)));
      else newPsi = rig.psi * 0.85;
      var newAx = px - gox * Math.cos(newPsi);
      var newPhi = Math.asin(Math.max(-0.85, Math.min(0.85, (newAx - cx) / rigLen)));
      rig.phiW = (newPhi - rig.phi) * 16; rig.psiW = (newPsi - rig.psi) * 16;
      rig.phi = newPhi; rig.psi = newPsi;
    } else if (grabbed === clap) {
      var nt = Math.max(-1.2, Math.min(1.2, Math.atan2(px - rigAx, Math.max(20, py - rigAy))));
      clap.omega = (nt - clap.theta) * 18; clap.theta = nt;
    } else if (grabbed) {
      var nt2 = Math.max(-1.2, Math.min(1.2, Math.atan2(px - grabbed.px, Math.max(20, py - grabbed.py))));
      grabbed.omega = (nt2 - grabbed.theta) * 18; grabbed.theta = nt2;
    } else {
      gust += dx * 0.0016;
      gust = Math.max(-0.5, Math.min(0.5, gust));
    }
  }
  function onUp() {
    if (down && movedDist < 9 && grabbed && grabbedIdx >= 0) {
      strikeTube(grabbedIdx, 0.14);
      grabbed.omega += (Math.random() < 0.5 ? -1 : 1) * 2.0;
    }
    down = false; grabbed = null; grabbedIdx = -1;
  }

  canvas.addEventListener("mousedown", function (e) { onDown(e.clientX, e.clientY); });
  window.addEventListener("mousemove", function (e) { onMove(e.clientX, e.clientY); });
  window.addEventListener("mouseup", onUp);
  canvas.addEventListener("touchstart", function (e) { e.preventDefault(); var t = e.touches[0]; onDown(t.clientX, t.clientY); }, { passive: false });
  canvas.addEventListener("touchmove", function (e) { e.preventDefault(); var t = e.touches[0]; onMove(t.clientX, t.clientY); }, { passive: false });
  canvas.addEventListener("touchend", function (e) { e.preventDefault(); onUp(); }, { passive: false });

  // ---- physics ------------------------------------------------------------
  function clampAcc(a) { return a < -16000 ? -16000 : a > 16000 ? 16000 : a; }

  function pivotAccel(obj, px, py, dt) {
    if (!obj.init) { obj.ppx = px; obj.ppy = py; obj.pvx = 0; obj.pvy = 0; obj.init = true; }
    var vx = (px - obj.ppx) / dt, vy = (py - obj.ppy) / dt;
    var ax = clampAcc((vx - obj.pvx) / dt), ay = clampAcc((vy - obj.pvy) / dt);
    obj.ppx = px; obj.ppy = py; obj.pvx = vx; obj.pvy = vy;
    obj.px = px; obj.py = py;
    return [ax, ay];
  }

  function pendulum(obj, L, apx, apy, lean, damp, dt) {
    // pendulum hanging from a pivot that is itself accelerating (apx, apy)
    var th = obj.theta;
    var acc = -(G / L) * Math.sin(th)
            - (apx / L) * Math.cos(th) + (apy / L) * Math.sin(th)
            + (G / L) * lean * Math.cos(th)
            - damp * obj.omega;
    obj.omega += acc * dt; obj.theta += obj.omega * dt;
  }

  function physics(dt, t) {
    var ambient = 0.03 * (Math.sin(t * 0.55) + 0.6 * Math.sin(t * 1.27 + 1.1) + 0.4 * Math.sin(t * 0.31 + 2.3))
                + 0.025 * Math.sin(t * 0.12);
    gust *= Math.pow(0.05, dt);
    var lean = Math.max(-0.7, Math.min(0.7, gust + ambient));

    // --- the support bar: swing (phi) + tilt (psi) ---
    if (rig !== grabbed) {
      var aswing = -(G / rigLen) * Math.sin(rig.phi) + (G / rigLen) * lean * 0.7 - 0.7 * rig.phiW;
      rig.phiW += aswing * dt; rig.phi += rig.phiW * dt;
      var atilt = -(G / tiltLen) * Math.sin(rig.psi) - 1.0 * rig.psiW + ambient * 0.4;
      rig.psiW += atilt * dt; rig.psi += rig.psiW * dt;
    }
    rigAx = cx + Math.sin(rig.phi) * rigLen;
    rigAy = Math.cos(rig.phi) * rigLen;
    var cps = Math.cos(rig.psi), sps = Math.sin(rig.psi);

    // --- tubes: each hangs from a pivot fixed on the (moving, tilting) bar ---
    for (var i = 0; i < N; i++) {
      var tb = tubes[i];
      var px = rigAx + tb.ox * cps, py = rigAy + tb.ox * sps;
      var a = pivotAccel(tb, px, py, dt);
      if (tb !== grabbed) pendulum(tb, tb.len, a[0], a[1], lean, 0.9, dt);
      if (tb.glow > 0) tb.glow = Math.max(0, tb.glow - dt * 1.6);
      if (hitCooldown[i] > 0) hitCooldown[i] -= dt;
    }

    // --- clapper: hangs from the bar centre, leans more so it overtakes & strikes ---
    var ca = pivotAccel(clap, rigAx, rigAy, dt);
    if (clap !== grabbed) pendulum(clap, clapLen, ca[0], ca[1], lean * 1.6, 0.6, dt);

    // --- strike detection (world coords) ---
    var cbx = rigAx + Math.sin(clap.theta) * clapLen;
    var cby = rigAy + Math.cos(clap.theta) * clapLen;
    for (var j = 0; j < N; j++) {
      var tj = tubes[j];
      var down1 = cby - tj.py;
      if (down1 < tubeW || down1 > tj.len) continue;            // clapper height must cross the tube
      var tubeXatY = tj.px + down1 * Math.tan(tj.theta);
      var gap = cbx - tubeXatY;
      var toward = (gap > 0 && clap.omega < 0) || (gap < 0 && clap.omega > 0);
      if (Math.abs(gap) < tubeW * 1.3 && toward && hitCooldown[j] <= 0) {
        strikeTube(j, Math.min(0.17, 0.05 + Math.abs(clap.omega) * 0.05));
        var s = gap > 0 ? 1 : -1;
        tj.omega += s * Math.min(2.4, Math.abs(clap.omega) * 0.7 + 0.5);
        clap.omega *= -0.45;
        hitCooldown[j] = 0.12;
      }
    }
  }

  // ---- drawing ------------------------------------------------------------
  function drawBackground(t) {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#191430"); g.addColorStop(0.45, "#1c1730");
    g.addColorStop(0.78, "#2a1d2e"); g.addColorStop(1, "#3a2422");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    var gg = ctx.createRadialGradient(cx, H * 1.08, H * 0.1, cx, H * 1.08, H * 0.9);
    gg.addColorStop(0, "rgba(255,150,80,0.22)"); gg.addColorStop(0.5, "rgba(220,110,70,0.08)"); gg.addColorStop(1, "rgba(180,90,70,0)");
    ctx.fillStyle = gg; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";
    var motes = [[0.16, 0.7, 60], [0.82, 0.6, 80], [0.3, 0.85, 50], [0.7, 0.8, 46], [0.5, 0.92, 70]];
    for (var m = 0; m < motes.length; m++) {
      var mx = motes[m][0] * W, my = motes[m][1] * H, mr = motes[m][2];
      var fl = 0.5 + 0.5 * Math.sin(t * 0.5 + m);
      var bg = ctx.createRadialGradient(mx, my, 0, mx, my, mr);
      bg.addColorStop(0, "rgba(255,190,120," + (0.05 + fl * 0.04) + ")"); bg.addColorStop(1, "rgba(255,170,110,0)");
      ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawTube(tb) {
    var topX = tb.px + Math.sin(tb.theta) * 16, topY = tb.py + Math.cos(tb.theta) * 16;
    ctx.strokeStyle = "rgba(220,200,170,0.32)"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(tb.px, tb.py); ctx.lineTo(topX, topY); ctx.stroke();

    ctx.save();
    ctx.translate(topX, topY);
    ctx.rotate(-tb.theta);                       // tube points down its swing angle
    var hw = tubeW / 2, len = tb.len;
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    roundRect(-hw + 3, 4, tubeW, len, hw); ctx.fill();
    var grad = ctx.createLinearGradient(-hw, 0, hw, 0);
    grad.addColorStop(0.00, "#5a3f25"); grad.addColorStop(0.18, "#caa15f"); grad.addColorStop(0.34, "#f4dca0");
    grad.addColorStop(0.5, "#9c7038"); grad.addColorStop(0.66, "#caa15f"); grad.addColorStop(0.85, "#6e4d2c"); grad.addColorStop(1.0, "#3f2c1a");
    ctx.fillStyle = grad;
    roundRect(-hw, 0, tubeW, len, hw); ctx.fill();
    ctx.fillStyle = "rgba(255,248,225,0.5)";
    roundRect(-hw + tubeW * 0.26, hw, tubeW * 0.1, len - tubeW, tubeW * 0.05); ctx.fill();
    if (tb.glow > 0) {
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "rgba(255,210,140," + (tb.glow * 0.5) + ")";
      roundRect(-hw - 3, -3, tubeW + 6, len + 6, hw + 3); ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.restore();
  }

  function drawBar() {
    ctx.save();
    ctx.translate(rigAx, rigAy);
    ctx.rotate(rig.psi);
    var w = hangerW + tubeW * 2, h = 16, x = -w / 2, y = -8;
    var g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, "#7a4f30"); g.addColorStop(0.5, "#5e3a22"); g.addColorStop(1, "#43291a");
    ctx.fillStyle = g; roundRect(x, y, w, h, 7); ctx.fill();
    ctx.strokeStyle = "rgba(255,220,170,0.18)"; ctx.lineWidth = 1; roundRect(x, y, w, h, 7); ctx.stroke();
    ctx.restore();
  }

  function drawClapper() {
    var bx = rigAx + Math.sin(clap.theta) * clapLen;
    var by = rigAy + Math.cos(clap.theta) * clapLen;
    ctx.strokeStyle = "rgba(220,200,170,0.3)"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(rigAx, rigAy); ctx.lineTo(bx, by); ctx.stroke();
    var r = tubeW * 1.05;
    var g = ctx.createRadialGradient(bx - r * 0.3, by - r * 0.3, 1, bx, by, r);
    g.addColorStop(0, "#8a5a36"); g.addColorStop(1, "#4a2e1b");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(255,220,170,0.2)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.stroke();
    // sail
    var sLen = H * 0.12, sa = clap.theta;
    var ex = bx + Math.sin(sa) * sLen, ey = by + Math.cos(sa) * sLen;
    ctx.strokeStyle = "rgba(220,200,170,0.28)"; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(bx, by + r); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.save(); ctx.translate(ex, ey); ctx.rotate(-sa);
    var sg = ctx.createLinearGradient(-tubeW, 0, tubeW * 1.4, 0);
    sg.addColorStop(0, "#6b4427"); sg.addColorStop(0.5, "#a06b3d"); sg.addColorStop(1, "#5a371f");
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.ellipse(0, tubeW * 1.3, tubeW * 1.25, tubeW * 1.9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ---- loop ---------------------------------------------------------------
  var lastTs = null, nowish = 0;
  function render(ts) {
    var dt = lastTs !== null ? Math.min((ts - lastTs) / 1000, 0.033) : 0.016;
    lastTs = ts; nowish += dt;
    physics(dt, nowish);
    drawBackground(nowish);
    ctx.strokeStyle = "rgba(220,200,170,0.35)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx, ceilY); ctx.lineTo(rigAx, rigAy); ctx.stroke();
    drawBar();
    for (var i = 0; i < N; i++) drawTube(tubes[i]);
    drawClapper();
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
})();
