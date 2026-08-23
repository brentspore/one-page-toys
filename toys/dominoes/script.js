/* Dominoes — draw a path, tiles lay themselves along it, then topple.
 *
 * Raw WebGL, no dependencies. The physics is deliberately NOT a general rigid
 * body solver: a domino only ever rotates about its bottom leading edge, which
 * is exactly how a real one falls. That reduction is what makes a 400-tile
 * cascade both stable and cheap, and it still gives real tipping behaviour —
 * a tile has to be pushed past its balance point before gravity takes over.
 *
 * Toppling spreads by proximity rather than by a chain list, so branches,
 * merges and crossings all work without any bookkeeping.
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------- maths

  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function len3(a) { return Math.sqrt(dot(a, a)); }
  function norm3(a) { var l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function mIdent() { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }
  function mMul(a, b) {
    var o = new Array(16);
    for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) {
      o[i * 4 + j] = a[j] * b[i * 4] + a[4 + j] * b[i * 4 + 1] + a[8 + j] * b[i * 4 + 2] + a[12 + j] * b[i * 4 + 3];
    }
    return o;
  }
  function mTranslate(x, y, z) { var m = mIdent(); m[12] = x; m[13] = y; m[14] = z; return m; }
  function mScale(x, y, z) { var m = mIdent(); m[0] = x; m[5] = y; m[10] = z; return m; }
  function mRotY(a) {
    var c = Math.cos(a), s = Math.sin(a), m = mIdent();
    m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m;
  }
  function mRotX(a) {
    var c = Math.cos(a), s = Math.sin(a), m = mIdent();
    m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m;
  }
  function mPerspective(fovy, asp, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return [f / asp,0,0,0, 0,f,0,0, 0,0,(far + near) * nf,-1, 0,0,2 * far * near * nf,0];
  }
  function mLookAt(eye, center, up) {
    var z = norm3(sub(eye, center)), x = norm3(cross(up, z)), y = cross(z, x);
    return [x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0,
            -dot(x,eye), -dot(y,eye), -dot(z,eye), 1];
  }
  // flatten geometry onto the table plane along the light direction
  function mShadow(d) {
    var m = mIdent();
    m[0] = 1; m[1] = 0; m[2] = 0;
    m[4] = -d[0] / d[1]; m[5] = 0; m[6] = -d[2] / d[1];
    m[8] = 0; m[9] = 0; m[10] = 1;
    return m;
  }

  // ---------------------------------------------------------------- the tile

  /* Proportions of a real domino (about 50 x 25 x 9mm), and the spacing a real
   * run uses: much closer than people guess. Too far and the chain dies; too
   * close and it barely gains speed. */
  var H = 1.0, WD = 0.52, TH = 0.19;
  var GAP = 0.60;                      // face-to-face
  var STEP = GAP + TH;                 // centre to centre
  var GRAV = 250;                      // table units/s^2
  var TIP = Math.atan(TH / H);         // past this angle gravity does the rest
  var HYP = Math.sqrt(H * H + TH * TH);
  /* Where a fallen tile comes to rest leaning on the next one. Parallel tiles
   * GAP apart touch when cos(angle from vertical) = TH / GAP, which is why a
   * finished run lies as a shallow ribbon rather than flat. */
  var REST = GAP > TH ? Math.acos(clamp(TH / GAP, 0, 1)) : Math.PI / 2;
  var FLAT = Math.PI / 2;
  var MAX_TILES = 460;
  var TABLE = 15;

  var tiles = [];
  var strokes = [];      // in-progress path being drawn
  var running = false, settleT = 0, toppledCount = 0, runT = 0;

  function makeTile(x, z, yaw, hue) {
    return {
      x: x, z: z, yaw: yaw, hue: hue,
      th: 0, w: 0,           // angle from upright, angular velocity
      state: 0,              // 0 standing, 1 falling, 2 rested
      rest: FLAT,
      lit: 0,
      pop: 0
    };
  }

  // ---------------------------------------------------------------- placement

  function pathPoints(pts) {
    // resample the drawn polyline at exact tile spacing so the run is even
    var out = [], i, acc = 0;
    if (pts.length < 2) return out;
    var prev = pts[0];
    out.push({ x: prev.x, z: prev.z, dx: 0, dz: 0 });
    for (i = 1; i < pts.length; i++) {
      var p = pts[i];
      var dx = p.x - prev.x, dz = p.z - prev.z;
      var d = Math.sqrt(dx * dx + dz * dz);
      if (d < 1e-5) continue;
      var ux = dx / d, uz = dz / d;
      var travelled = 0;
      while (acc + (d - travelled) >= STEP) {
        var need = STEP - acc;
        travelled += need;
        var nx = prev.x + ux * travelled, nz = prev.z + uz * travelled;
        out.push({ x: nx, z: nz, dx: ux, dz: uz });
        acc = 0;
      }
      acc += d - travelled;
      prev = p;
    }
    // give the first point a direction now that we know where the path went
    if (out.length > 1) { out[0].dx = out[1].dx; out[0].dz = out[1].dz; }
    return out;
  }

  function tooClose(x, z) {
    for (var i = 0; i < tiles.length; i++) {
      var dx = tiles[i].x - x, dz = tiles[i].z - z;
      if (dx * dx + dz * dz < (STEP * 0.72) * (STEP * 0.72)) return true;
    }
    return false;
  }

  var hueCursor = 0;

  /* Place one tile, if there is room for it. The live drag calls this as your
   * finger passes each spacing mark, so the run appears under your hand rather
   * than all at once when you let go. */
  function placeTile(x, z, ux, uz) {
    if (tiles.length >= MAX_TILES) return false;
    if (Math.abs(x) > TABLE || Math.abs(z) > TABLE) return false;
    if (tooClose(x, z)) return false;
    var t = makeTile(x, z, Math.atan2(ux, uz), hueCursor);
    t.pop = 1;                       // it rises into place rather than blinking on
    tiles.push(t);
    hueCursor = (hueCursor + 7) % 360;
    Audio2.place(x);
    return true;
  }

  function layPath(pts) {
    var placed = pathPoints(pts), added = 0;
    for (var i = 0; i < placed.length; i++) {
      if (tiles.length >= MAX_TILES) break;
      var p = placed[i];
      if (Math.abs(p.x) > TABLE || Math.abs(p.z) > TABLE) continue;
      if (tooClose(p.x, p.z)) continue;
      // face the direction of travel: the tile topples the way you drew
      if (placeTile(p.x, p.z, p.dx, p.dz)) added++;
    }
    return added;
  }

  // ---------------------------------------------------------------- physics

  function forwardOf(t) { return [Math.sin(t.yaw), 0, Math.cos(t.yaw)]; }

  function topple(t, w0, dirX, dirZ) {
    if (t.state !== 0) return;
    // fall the way it was pushed: flip the tile if hit from the front
    if (dirX !== undefined) {
      var f = forwardOf(t);
      if (f[0] * dirX + f[2] * dirZ < 0) t.yaw += Math.PI;
    }
    t.state = 1;
    t.th = TIP + 0.02;
    t.w = Math.max(w0 || 0, 2.4);
    t.lit = 1;
    toppledCount++;
  }

  function stepPhysics(dt) {
    var i, j, moving = 0;

    for (i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      t.lit = Math.max(0, t.lit - dt * 2.2);
      if (t.state !== 1) continue;
      moving++;

      // gravity torque about the bottom leading edge
      var a = 1.5 * GRAV * Math.sin(t.th - TIP) / HYP;
      t.w += a * dt;
      t.th += t.w * dt;

      if (t.th >= t.rest) {
        t.th = t.rest;
        t.state = 2;
        t.w = 0;
        onLand(t);
      }
    }

    if (!moving) return false;

    // propagation: a falling tile knocks whatever its face reaches
    for (i = 0; i < tiles.length; i++) {
      var f2 = tiles[i];
      if (f2.state !== 1) continue;
      var fwd = forwardOf(f2);
      var reach = H * Math.sin(f2.th) + TH * 0.5;
      var rightX = fwd[2], rightZ = -fwd[0];
      for (j = 0; j < tiles.length; j++) {
        if (j === i) continue;
        var s = tiles[j];
        if (s.state !== 0) continue;
        var vx = s.x - f2.x, vz = s.z - f2.z;
        var fwdD = vx * fwd[0] + vz * fwd[2];
        if (fwdD <= 0.02 || fwdD > reach) continue;
        var latD = Math.abs(vx * rightX + vz * rightZ);
        if (latD > WD * 0.98) continue;
        // hand on most of the swing, so the wave keeps its speed
        s.rest = REST;
        topple(s, f2.w * 0.78, fwd[0], fwd[2]);
      }
    }
    return true;
  }

  function onLand(t) {
    Audio2.clack(t.x, t.z, Math.min(1, t.w / 9 + 0.35));
    landings.push({ x: t.x, z: t.z, t: 0 });
    if (landings.length > 40) landings.shift();
  }

  var landings = [];

  // the leading edge of the cascade, for the camera to chase
  function frontOfWave() {
    var sx = 0, sz = 0, n = 0;
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      if (t.state === 1) { sx += t.x; sz += t.z; n++; }
    }
    return n ? { x: sx / n, z: sz / n, n: n } : null;
  }

  // ---------------------------------------------------------------- audio

  var Audio2 = (function () {
    var ctx = null, out = null, comp = null, wet = null, verb = null, body = null;
    var on = true, ready = false, lastClack = 0, perFrame = 0;

    function impulse(sec, decay) {
      var rate = ctx.sampleRate, len = Math.floor(rate * sec);
      var buf = ctx.createBuffer(2, len, rate), c, i, last = [0, 0];
      for (c = 0; c < 2; c++) {
        var d = buf.getChannelData(c);
        for (i = 0; i < len; i++) {
          var n = Math.random() * 2 - 1;
          last[c] = last[c] * 0.7 + n * 0.3;
          d[i] = last[c] * Math.pow(1 - i / len, decay);
        }
      }
      return buf;
    }

    function noiseBuf(ms) {
      var len = Math.max(1, Math.floor(ctx.sampleRate * ms / 1000));
      var b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0), i;
      for (i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return b;
    }

    function init() {
      if (ready) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      var b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource();
      s.buffer = b; s.connect(ctx.destination); s.start(0);

      out = ctx.createGain(); out.gain.value = on ? 1 : 0;
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.ratio.value = 4;
      comp.attack.value = 0.002; comp.release.value = 0.12;

      /* The tiles are sitting on a table, and a real run is heard through it —
       * a low-mid resonance that turns a pile of separate clicks into one
       * cascade happening in a room. */
      body = ctx.createBiquadFilter();
      body.type = "peaking"; body.frequency.value = 240; body.Q.value = 1.0; body.gain.value = 4;
      var tilt = ctx.createBiquadFilter();
      tilt.type = "highshelf"; tilt.frequency.value = 7000; tilt.gain.value = 1;

      verb = ctx.createConvolver(); verb.buffer = impulse(0.9, 3.6);
      wet = ctx.createGain(); wet.gain.value = 0.13;
      var hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 350;

      body.connect(tilt); tilt.connect(out);
      out.connect(comp); comp.connect(ctx.destination);
      comp.connect(hp); hp.connect(verb); verb.connect(wet); wet.connect(ctx.destination);
      ready = true;
    }

    function panFor(x) {
      var p = clamp(x / (TABLE * 0.7), -1, 1) * 0.75;
      if (ctx.createStereoPanner) { var n = ctx.createStereoPanner(); n.pan.value = p; return n; }
      return ctx.createGain();
    }

    return {
      init: init,
      isReady: function () { return ready; },
      setOn: function (v) { on = v; if (out) out.gain.setTargetAtTime(v ? 1 : 0, ctx.currentTime, 0.01); },
      frame: function () { perFrame = 0; },
      /* Plastic on plastic: a short noise burst through the tile's own
       * inharmonic modes. A cascade fires a LOT of these, so they are capped
       * per frame and spaced in time — without that, forty simultaneous clacks
       * both clip the bus and stutter the frame. */
      /* A domino is a small, stiff, heavily damped plate, and the numbers matter:
       * its bending fundamental works out near 4kHz and it rings for about
       * 3-6ms. The first version used 880Hz and a 50ms decay, which is why it
       * read as a soft "tonk" rather than plastic hitting plastic.
       *
       * Three layers, in order of how much they carry the character:
       *   1. the CONTACT TACK  - a 2ms broadband click, mostly above 2kHz. This
       *      is the sound of two hard faces meeting and it is the bulk of it.
       *   2. the PLATE RING    - inharmonic bending modes, gone in ~6ms.
       *   3. the TABLE KNOCK   - the far end landing on the table, short and woody.
       */
      clack: function (x, z, vel) {
        init();
        if (!ready) return;
        var t = ctx.currentTime;
        if (perFrame >= 3) return;
        if (t - lastClack < 0.012) return;
        perFrame++; lastClack = t;

        var v = clamp(vel, 0.2, 1);
        var mix = ctx.createGain(); mix.gain.value = 0.68 * v;
        var pn = panFor(x);

        // --- 1. contact tack
        var tk = ctx.createBufferSource(); tk.buffer = noiseBuf(4);
        var hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 1700 + Math.random() * 900;
        /* Cap the top. Highpassed noise runs all the way to Nyquist, which put
         * the spectral centroid at 11kHz and turned the clack into a hiss;
         * real plastic-on-plastic rolls off above about 8k. */
        var lpTk = ctx.createBiquadFilter();
        lpTk.type = "lowpass"; lpTk.frequency.value = 9000; lpTk.Q.value = 0.7;
        var tilt2 = ctx.createBiquadFilter();
        tilt2.type = "peaking";
        tilt2.frequency.value = 3800; tilt2.Q.value = 0.8;
        tilt2.gain.value = 6;
        var tg = ctx.createGain();
        tg.gain.setValueAtTime(0, t);
        tg.gain.linearRampToValueAtTime(0.9, t + 0.0004);
        tg.gain.exponentialRampToValueAtTime(0.0006, t + 0.0035);
        tk.connect(hp); hp.connect(lpTk); lpTk.connect(tilt2); tilt2.connect(tg); tg.connect(mix);
        tk.start(t); tk.stop(t + 0.02);

        // --- 2. plate ring: free-plate modes are inharmonic and close together
        var f0 = 3900 * (0.82 + Math.random() * 0.36);
        var ratios = [1, 1.59, 2.30, 2.94, 4.14];
        var src = ctx.createBufferSource(); src.buffer = noiseBuf(3);
        var env = ctx.createGain();
        env.gain.setValueAtTime(0, t);
        env.gain.linearRampToValueAtTime(1, t + 0.0004);
        env.gain.exponentialRampToValueAtTime(0.0008, t + 0.003);
        src.connect(env);
        for (var i = 0; i < ratios.length; i++) {
          var f = f0 * ratios[i];
          if (f > 16000) continue;
          var bp = ctx.createBiquadFilter();
          bp.type = "bandpass"; bp.frequency.value = f;
          var dec = 0.006 / (1 + i * 0.55);
          var Q = Math.max(2, Math.PI * f * dec);
          bp.Q.value = Q;
          var g = ctx.createGain();
          g.gain.value = 0.55 * Math.sqrt(Q) / (1 + i * 0.8);
          var e = ctx.createGain();
          e.gain.setValueAtTime(1, t);
          e.gain.exponentialRampToValueAtTime(0.0006, t + dec);
          env.connect(bp); bp.connect(g); g.connect(e); e.connect(mix);
        }

        // --- 3. the table taking the weight
        var o = ctx.createOscillator(); o.type = "sine";
        o.frequency.setValueAtTime(420 * (0.85 + Math.random() * 0.3), t);
        o.frequency.exponentialRampToValueAtTime(215, t + 0.03);
        var og = ctx.createGain();
        og.gain.setValueAtTime(0.0001, t);
        og.gain.linearRampToValueAtTime(0.3, t + 0.0015);
        og.gain.exponentialRampToValueAtTime(0.0005, t + 0.035);
        o.connect(og); og.connect(mix);
        o.start(t); o.stop(t + 0.05);

        mix.connect(pn); pn.connect(body);

        // a tile does not always settle in one go — an occasional second tick
        // a few ms later is what gives a real run its rattle
        if (Math.random() < 0.3) {
          var t2 = t + 0.012 + Math.random() * 0.02;
          var r2 = ctx.createBufferSource(); r2.buffer = noiseBuf(3);
          var h2 = ctx.createBiquadFilter();
          h2.type = "highpass"; h2.frequency.value = 2400;
          var l2 = ctx.createBiquadFilter();
          l2.type = "lowpass"; l2.frequency.value = 9000;
          var g2 = ctx.createGain();
          g2.gain.setValueAtTime(0, t2);
          g2.gain.linearRampToValueAtTime(0.3 * v, t2 + 0.0004);
          g2.gain.exponentialRampToValueAtTime(0.0005, t2 + 0.004);
          r2.connect(h2); h2.connect(l2); l2.connect(g2); g2.connect(pn);
          r2.start(t2); r2.stop(t2 + 0.02);
        }
      },
      place: function (x) {
        init(); if (!ready) return;
        var t = ctx.currentTime;
        var src = ctx.createBufferSource(); src.buffer = noiseBuf(9);
        var bp = ctx.createBiquadFilter();
        bp.type = "bandpass"; bp.frequency.value = 1500; bp.Q.value = 1.6;
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.1, t + 0.001);
        g.gain.exponentialRampToValueAtTime(0.0004, t + 0.03);
        var pn = panFor(x);
        src.connect(bp); bp.connect(g); g.connect(pn); pn.connect(body);
        src.start(t); src.stop(t + 0.05);
      },
      done: function (n) {
        init(); if (!ready) return;
        var notes = [523.25, 659.25, 783.99, 1046.5];
        for (var i = 0; i < notes.length; i++) {
          (function (f, k) {
            setTimeout(function () {
              if (!ready) return;
              var t = ctx.currentTime;
              var o = ctx.createOscillator(); o.type = "triangle";
              o.frequency.value = f;
              var g = ctx.createGain();
              g.gain.setValueAtTime(0, t);
              g.gain.linearRampToValueAtTime(0.12, t + 0.01);
              g.gain.exponentialRampToValueAtTime(0.0005, t + 0.7);
              o.connect(g); g.connect(out);
              o.start(t); o.stop(t + 0.75);
            }, k * 95);
          })(notes[i], i);
        }
      }
    };
  })();

  // ---------------------------------------------------------------- WebGL

  var cv = document.getElementById("canvas");
  var gl = cv.getContext("webgl", { antialias: true, alpha: false });
  if (!gl) {
    document.getElementById("overlay").innerHTML =
      '<div class="panel"><h1 class="panel__title">Dominoes</h1>' +
      '<p class="panel__text">This toy needs WebGL, which your browser has turned off.</p></div>';
    return;
  }

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function program(vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  var TILE_VS = [
    "attribute vec3 aPos; attribute vec3 aNor;",
    "uniform mat4 uMVP, uModel; uniform mat3 uNrm;",
    "varying vec3 vN; varying vec3 vW; varying vec3 vL;",
    "void main(){",
    "  vec4 w = uModel * vec4(aPos,1.0);",
    "  vW = w.xyz; vN = normalize(uNrm * aNor); vL = aPos;",
    "  gl_Position = uMVP * vec4(aPos,1.0);",
    "}"
  ].join("\n");

  var TILE_FS = [
    "precision mediump float;",
    "varying vec3 vN; varying vec3 vW; varying vec3 vL;",
    "uniform vec3 uCol; uniform float uLit; uniform vec3 uEye;",
    "void main(){",
    "  vec3 N = normalize(vN);",
    "  vec3 L = normalize(vec3(-0.42, 0.86, 0.30));",
    "  float d = max(dot(N,L), 0.0);",
    "  vec3 V = normalize(uEye - vW);",
    "  vec3 Hf = normalize(L + V);",
    "  float sp = pow(max(dot(N,Hf),0.0), 46.0);",
    // a cheap fill from the table bounce plus a cool rim
    "  float fill = 0.30 + 0.22 * max(dot(N, vec3(0.0,-1.0,0.0)), 0.0);",
    "  float rim = pow(1.0 - max(dot(N,V),0.0), 3.0) * 0.35;",
    "  vec3 c = uCol * (0.34 + d * 0.86 + fill);",
    "  c += vec3(0.85,0.93,1.0) * sp * 0.62;",
    "  c += vec3(0.35,0.55,0.95) * rim;",
    "  c += uCol * uLit * 0.85;",             // flash as it is struck
    "  gl_FragColor = vec4(c, 1.0);",
    "}"
  ].join("\n");

  var FLAT_VS = [
    "attribute vec3 aPos;",
    "uniform mat4 uMVP;",
    "varying vec3 vP;",
    "void main(){ vP = aPos; gl_Position = uMVP * vec4(aPos,1.0); }"
  ].join("\n");

  var SHADOW_FS = [
    "precision mediump float;",
    "uniform float uA;",
    "void main(){ gl_FragColor = vec4(0.0,0.0,0.02,uA); }"
  ].join("\n");

  var TABLE_FS = [
    "precision mediump float;",
    "varying vec3 vP;",
    "uniform float uT;",
    "void main(){",
    "  float r = length(vP.xz);",
    // faint concentric rings + a soft pool of light in the middle
    "  float ring = smoothstep(0.96,1.0,fract(r*0.5)) * 0.05;",
    "  float grid = 0.0;",
    "  vec2 g = abs(fract(vP.xz*0.5)-0.5);",
    "  grid += smoothstep(0.48,0.5,max(g.x,g.y)) * 0.045;",
    // GLSL smoothstep needs edge0 < edge1; reversed edges are undefined, and
    // that is what made the whole table render black and swallow the shadows
    "  float pool = 1.0 - smoothstep(1.0, 20.0, r);",
    "  vec3 base = mix(vec3(0.030,0.033,0.055), vec3(0.115,0.125,0.195), pool);",
    "  base += vec3(0.10,0.13,0.22) * (ring + grid);",
    "  float vig = 1.0 - smoothstep(6.0, 26.0, r);",
    "  gl_FragColor = vec4(base * (0.35 + 0.65*vig), 1.0);",
    "}"
  ].join("\n");

  var progTile = program(TILE_VS, TILE_FS);
  var progFlat = program(FLAT_VS, SHADOW_FS);
  var progTable = program(FLAT_VS, TABLE_FS);

  var uT = {
    mvp: gl.getUniformLocation(progTile, "uMVP"),
    model: gl.getUniformLocation(progTile, "uModel"),
    nrm: gl.getUniformLocation(progTile, "uNrm"),
    col: gl.getUniformLocation(progTile, "uCol"),
    lit: gl.getUniformLocation(progTile, "uLit"),
    eye: gl.getUniformLocation(progTile, "uEye"),
    aPos: gl.getAttribLocation(progTile, "aPos"),
    aNor: gl.getAttribLocation(progTile, "aNor")
  };
  var uF = {
    mvp: gl.getUniformLocation(progFlat, "uMVP"),
    a: gl.getUniformLocation(progFlat, "uA"),
    aPos: gl.getAttribLocation(progFlat, "aPos")
  };
  var uTab = {
    mvp: gl.getUniformLocation(progTable, "uMVP"),
    t: gl.getUniformLocation(progTable, "uT"),
    aPos: gl.getAttribLocation(progTable, "aPos")
  };

  // unit cube centred on the origin
  function cubeData() {
    var p = [], n = [];
    var faces = [
      [[ 1,0,0], [[ .5,-.5,-.5],[ .5, .5,-.5],[ .5, .5, .5],[ .5,-.5, .5]]],
      [[-1,0,0], [[-.5,-.5, .5],[-.5, .5, .5],[-.5, .5,-.5],[-.5,-.5,-.5]]],
      [[0, 1,0], [[-.5, .5,-.5],[-.5, .5, .5],[ .5, .5, .5],[ .5, .5,-.5]]],
      [[0,-1,0], [[-.5,-.5, .5],[-.5,-.5,-.5],[ .5,-.5,-.5],[ .5,-.5, .5]]],
      [[0,0, 1], [[-.5,-.5, .5],[ .5,-.5, .5],[ .5, .5, .5],[-.5, .5, .5]]],
      [[0,0,-1], [[ .5,-.5,-.5],[-.5,-.5,-.5],[-.5, .5,-.5],[ .5, .5,-.5]]]
    ];
    faces.forEach(function (f) {
      var nn = f[0], q = f[1], tri = [0,1,2, 0,2,3], i;
      for (i = 0; i < tri.length; i++) {
        p.push(q[tri[i]][0], q[tri[i]][1], q[tri[i]][2]);
        n.push(nn[0], nn[1], nn[2]);
      }
    });
    return { pos: new Float32Array(p), nor: new Float32Array(n), count: p.length / 3 };
  }

  var cube = cubeData();
  var bufCubeP = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bufCubeP); gl.bufferData(gl.ARRAY_BUFFER, cube.pos, gl.STATIC_DRAW);
  var bufCubeN = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bufCubeN); gl.bufferData(gl.ARRAY_BUFFER, cube.nor, gl.STATIC_DRAW);

  /* Wound so the normal points UP. The first version had it the other way and
   * back-face culling ate the entire table, which reads as "the shader is
   * broken" when the geometry simply is not facing you. */
  var tableQuad = new Float32Array([
    -TABLE*2.2, 0, -TABLE*2.2,  TABLE*2.2, 0,  TABLE*2.2,  TABLE*2.2, 0, -TABLE*2.2,
    -TABLE*2.2, 0, -TABLE*2.2, -TABLE*2.2, 0,  TABLE*2.2,  TABLE*2.2, 0,  TABLE*2.2
  ]);
  var bufTable = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bufTable); gl.bufferData(gl.ARRAY_BUFFER, tableQuad, gl.STATIC_DRAW);

  // a marker ring drawn where the path is being dragged
  var bufMark = gl.createBuffer();

  function hsl(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    function f(n) {
      var k = (n + h * 12) % 12;
      var a = s * Math.min(l, 1 - l);
      return l - a * Math.max(-1, Math.min(Math.min(k - 3, 9 - k), 1));
    }
    return [f(0), f(8), f(4)];
  }

  // ---------------------------------------------------------------- camera

  var cam = { tx: 0, tz: 0, dist: 26, height: 17, yaw: 0, curTx: 0, curTz: 0, curD: 26, curH: 17, curYaw: 0 };
  var W = 0, Hh = 0, DPR = 1;

  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; Hh = window.innerHeight;
    cv.width = Math.floor(W * DPR); cv.height = Math.floor(Hh * DPR);
    cv.style.width = W + "px"; cv.style.height = Hh + "px";
    gl.viewport(0, 0, cv.width, cv.height);
  }

  function viewProj() {
    var asp = cv.width / cv.height;
    var fov = 50 * Math.PI / 180;
    var eye = [
      cam.curTx + Math.sin(cam.curYaw) * cam.curD,
      cam.curH,
      cam.curTz + Math.cos(cam.curYaw) * cam.curD
    ];
    var look = [cam.curTx, 0.6, cam.curTz];
    return { vp: mMul(mPerspective(fov, asp, 0.5, 240), mLookAt(eye, look, [0, 1, 0])), eye: eye };
  }

  // screen point -> table plane (y = 0)
  function pick(sx, sy) {
    var asp = cv.width / cv.height;
    var fov = 50 * Math.PI / 180;
    var ndcX = (sx / W) * 2 - 1;
    var ndcY = 1 - (sy / Hh) * 2;
    var tanF = Math.tan(fov / 2);
    var eye = [
      cam.curTx + Math.sin(cam.curYaw) * cam.curD,
      cam.curH,
      cam.curTz + Math.cos(cam.curYaw) * cam.curD
    ];
    var look = [cam.curTx, 0.6, cam.curTz];
    var f = norm3(sub(look, eye));
    var r = norm3(cross(f, [0, 1, 0]));
    var u = cross(r, f);
    var dir = norm3([
      f[0] + r[0] * ndcX * tanF * asp + u[0] * ndcY * tanF,
      f[1] + r[1] * ndcX * tanF * asp + u[1] * ndcY * tanF,
      f[2] + r[2] * ndcX * tanF * asp + u[2] * ndcY * tanF
    ]);
    if (Math.abs(dir[1]) < 1e-5) return null;
    var t = -eye[1] / dir[1];
    if (t <= 0) return null;
    return { x: eye[0] + dir[0] * t, z: eye[2] + dir[2] * t };
  }

  // ---------------------------------------------------------------- drawing

  function drawTiles(vp, eye) {
    gl.useProgram(progTile);
    gl.uniform3fv(uT.eye, eye);
    gl.enableVertexAttribArray(uT.aPos);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufCubeP);
    gl.vertexAttribPointer(uT.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(uT.aNor);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufCubeN);
    gl.vertexAttribPointer(uT.aNor, 3, gl.FLOAT, false, 0, 0);

    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      var model = tileModel(t);
      gl.uniformMatrix4fv(uT.mvp, false, new Float32Array(mMul(vp, model)));
      gl.uniformMatrix4fv(uT.model, false, new Float32Array(model));
      gl.uniformMatrix3fv(uT.nrm, false, new Float32Array([
        model[0], model[1], model[2], model[4], model[5], model[6], model[8], model[9], model[10]
      ]));
      var c = hsl(t.hue, 0.72, 0.56);
      gl.uniform3fv(uT.col, new Float32Array(c));
      gl.uniform1f(uT.lit, t.lit);
      gl.drawArrays(gl.TRIANGLES, 0, cube.count);
    }
  }

  function tileModel(t) {
    // grows from the table on placement: the base stays put, the height eases in
    var g = t.pop ? 1 - t.pop * t.pop * 0.55 : 1;
    var m = mMul(mTranslate(t.x, 0, t.z), mRotY(t.yaw));
    m = mMul(m, mTranslate(0, 0, TH / 2));
    m = mMul(m, mRotX(t.th));
    m = mMul(m, mTranslate(0, 0, -TH / 2));
    m = mMul(m, mTranslate(0, H * g / 2, 0));
    m = mMul(m, mScale(WD, H * g, TH));
    return m;
  }

  function drawShadows(vp) {
    var L = norm3([-0.42, 0.86, 0.30]);
    var S = mShadow([-L[0], -L[1], -L[2]]);
    gl.useProgram(progFlat);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.enableVertexAttribArray(uF.aPos);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufCubeP);
    gl.vertexAttribPointer(uF.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.uniform1f(uF.a, 0.42);
    for (var i = 0; i < tiles.length; i++) {
      var model = tileModel(tiles[i]);
      var m = mMul(mMul(mTranslate(0, 0.012, 0), S), model);
      gl.uniformMatrix4fv(uF.mvp, false, new Float32Array(mMul(vp, m)));
      gl.drawArrays(gl.TRIANGLES, 0, cube.count);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  function drawTable(vp) {
    gl.useProgram(progTable);
    gl.uniform1f(uTab.t, perf / 1000);
    gl.enableVertexAttribArray(uTab.aPos);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufTable);
    gl.vertexAttribPointer(uTab.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(uTab.mvp, false, new Float32Array(vp));
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // ---------------------------------------------------------------- loop

  var perf = 0, lastT = 0, acc = 0, hudCount = -1;
  var PHYS = 1 / 240;

  function frame(ms) {
    if (!lastT) lastT = ms;
    var dt = Math.min(0.05, (ms - lastT) / 1000);
    lastT = ms; perf = ms;
    Audio2.frame();

    if (running) {
      acc += dt;
      var n = 0, any = false;
      while (acc >= PHYS && n < 12) { any = stepPhysics(PHYS) || any; acc -= PHYS; n++; }
      if (acc > PHYS * 12) acc = 0;
      runT += dt;

      var front = frontOfWave();
      if (front) {
        settleT = 0;
        cam.tx = front.x; cam.tz = front.z;
        cam.dist = 13; cam.height = 7.5;
      } else {
        settleT += dt;
        if (settleT > 1.1) endRun();
      }
    } else {
      for (var i = 0; i < tiles.length; i++) tiles[i].lit = Math.max(0, tiles[i].lit - dt * 2.2);
    }
    for (var q2 = 0; q2 < tiles.length; q2++) {
      if (tiles[q2].pop > 0) tiles[q2].pop = Math.max(0, tiles[q2].pop - dt * 7);
    }

    for (var k = landings.length - 1; k >= 0; k--) {
      landings[k].t += dt;
      if (landings[k].t > 0.5) landings.splice(k, 1);
    }

    // ease the camera rather than snapping it
    var e = 1 - Math.pow(0.0016, dt);
    cam.curTx = lerp(cam.curTx, cam.tx, e);
    cam.curTz = lerp(cam.curTz, cam.tz, e);
    cam.curD = lerp(cam.curD, cam.dist, e);
    cam.curH = lerp(cam.curH, cam.height, e);
    cam.curYaw = lerp(cam.curYaw, cam.yaw, e);

    // the count changes mid-drag now, so the HUD has to follow it live rather
    // than only when a stroke ends
    if (tiles.length !== hudCount) { hudCount = tiles.length; updateHud(); }

    render();
    requestAnimationFrame(frame);
  }

  function render() {
    var c = viewProj();
    gl.clearColor(0.016, 0.017, 0.03, 1);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    drawTable(c.vp);
    gl.disable(gl.CULL_FACE);
    drawShadows(c.vp);
    gl.enable(gl.CULL_FACE);
    drawTiles(c.vp, c.eye);
  }

  // ---------------------------------------------------------------- flow

  var elCount = document.getElementById("count");
  var elHud = document.getElementById("hud");
  var elBest = document.getElementById("best");
  var overlay = document.getElementById("overlay");
  var btnGo = document.getElementById("btnGo");
  var btnClear = document.getElementById("btnClear");
  var btnUndo = document.getElementById("btnUndo");
  var elMsg = document.getElementById("callout");
  var best = 0;
  try { best = parseInt(localStorage.getItem("dominoes_best") || "0", 10) || 0; } catch (e) {}

  var history = [];   // tile counts, so undo removes one stroke at a time

  function updateHud() {
    if (elCount) elCount.textContent = tiles.length;
    if (elBest) elBest.textContent = best ? best : "—";
    if (btnGo) btnGo.disabled = running || tiles.length < 2;
    if (btnUndo) btnUndo.disabled = running || !history.length;
    if (btnClear) btnClear.disabled = running || !tiles.length;
  }

  function say(txt, ms) {
    if (!elMsg) return;
    elMsg.textContent = txt;
    elMsg.hidden = false;
    clearTimeout(say._t);
    say._t = setTimeout(function () { elMsg.hidden = true; }, ms || 1600);
  }

  function startRun(fromX, fromZ) {
    if (running || tiles.length < 2) return;
    running = true; toppledCount = 0; settleT = 0; runT = 0;
    // topple the tile nearest where you tapped, else the first one placed
    var best_i = 0, bd = 1e9;
    for (var i = 0; i < tiles.length; i++) {
      var d = fromX === undefined ? i :
        (tiles[i].x - fromX) * (tiles[i].x - fromX) + (tiles[i].z - fromZ) * (tiles[i].z - fromZ);
      if (d < bd) { bd = d; best_i = i; }
    }
    tiles[best_i].rest = REST;
    topple(tiles[best_i], 3.2);
    Audio2.init();
    updateHud();
    if (window.gtag) window.gtag("event", "toy_start", { toy_slug: "dominoes" });
  }

  function endRun() {
    running = false;
    var pct = tiles.length ? Math.round(toppledCount / tiles.length * 100) : 0;
    if (toppledCount > best) {
      best = toppledCount;
      try { localStorage.setItem("dominoes_best", String(best)); } catch (e) {}
    }
    cam.tx = 0; cam.tz = 0; cam.dist = 26; cam.height = 17;
    say(toppledCount + " of " + tiles.length + " fell — " + pct + "%", 2600);
    if (toppledCount > 1) {
      window.OPT_SHARE_TEXT = "I toppled " + toppledCount + " of " + tiles.length + " dominoes \u2014 " + pct + "%. Your turn.";
      window.OPT_SHARE_LINE = toppledCount + " of " + tiles.length + " fell";
      window.OPT_SHARE_IMAGE = function () { render(); return cv; };
    } else { window.OPT_SHARE_TEXT = window.OPT_SHARE_LINE = window.OPT_SHARE_IMAGE = null; }
    if (pct >= 100 && tiles.length >= 12) Audio2.done(toppledCount);
    if (window.gtag) {
      window.gtag("event", "toy_score", { toy_slug: "dominoes", value: toppledCount });
    }
    updateHud();
  }

  function resetStanding() {
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i];
      t.th = 0; t.w = 0; t.state = 0; t.rest = FLAT; t.lit = 0;
    }
    running = false; toppledCount = 0;
    cam.tx = 0; cam.tz = 0; cam.dist = 26; cam.height = 17;
    updateHud();
  }

  // ---------------------------------------------------------------- input

  var drawing = false, ptrId = null, movedFar = false, downAt = null;
  var strokeAcc = 0, lastPt = null, placing = false, strokeStart = 0;

  function localXY(e) {
    var r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  cv.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    Audio2.init();
    if (overlay && !overlay.hidden) return;
    if (running) return;
    var xy = localXY(e);
    var p = pick(xy.x, xy.y);
    if (!p) return;
    ptrId = e.pointerId;
    drawing = true; movedFar = false; placing = false;
    downAt = p; lastPt = { x: p.x, z: p.z };
    strokeAcc = 0; strokeStart = tiles.length;
    strokes = [{ x: p.x, z: p.z }];
    cv.setPointerCapture(e.pointerId);
  }, { passive: false });

  cv.addEventListener("pointermove", function (e) {
    if (!drawing || e.pointerId !== ptrId) return;
    var xy = localXY(e);
    var p = pick(xy.x, xy.y);
    if (!p) return;

    /* Lay the tiles AS the finger moves rather than all at once on release.
     * Nothing is placed until the drag clears half a spacing, so a tap still
     * reads as "start the run" instead of dropping a stray tile. */
    if (!placing) {
      var d0x = p.x - downAt.x, d0z = p.z - downAt.z;
      var d0 = Math.sqrt(d0x * d0x + d0z * d0z);
      if (d0 < STEP * 0.5) { lastPt = { x: p.x, z: p.z }; return; }
      placing = true; movedFar = true;
      placeTile(downAt.x, downAt.z, d0x / d0, d0z / d0);
      lastPt = { x: downAt.x, z: downAt.z };
      strokeAcc = 0;
    }

    var dx = p.x - lastPt.x, dz = p.z - lastPt.z;
    var d = Math.sqrt(dx * dx + dz * dz);
    if (d < 1e-5) return;
    var ux = dx / d, uz = dz / d;
    var travelled = 0;
    while (strokeAcc + (d - travelled) >= STEP) {
      var need = STEP - strokeAcc;
      travelled += need;
      placeTile(lastPt.x + ux * travelled, lastPt.z + uz * travelled, ux, uz);
      strokeAcc = 0;
    }
    strokeAcc += d - travelled;
    lastPt = { x: p.x, z: p.z };
  });

  function finishStroke(e) {
    if (!drawing || (e && e.pointerId !== ptrId)) return;
    drawing = false; ptrId = null;
    if (movedFar) {
      // the tiles are already down; just record where this stroke began so
      // undo can peel exactly one stroke back off
      if (tiles.length > strokeStart) {
        history.push(strokeStart);
        if (tiles.length >= MAX_TILES) say("that is all the tiles there are", 1800);
      }
    } else if (downAt && tiles.length >= 2) {
      // a tap rather than a drag: start the run from the nearest tile
      startRun(downAt.x, downAt.z);
    }
    strokes = []; placing = false;
    updateHud();
  }
  cv.addEventListener("pointerup", finishStroke);
  cv.addEventListener("pointercancel", finishStroke);

  if (btnGo) btnGo.addEventListener("click", function () { Audio2.init(); startRun(); });
  if (btnClear) btnClear.addEventListener("click", function () {
    tiles.length = 0; history.length = 0; hueCursor = 0; resetStanding();
  });
  if (btnUndo) btnUndo.addEventListener("click", function () {
    if (!history.length) return;
    tiles.length = history.pop();
    resetStanding();
  });

  window.addEventListener("keydown", function (e) {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (overlay && !overlay.hidden) { begin(); return; }
      if (running) return;
      var anyDown = tiles.some(function (t) { return t.state !== 0; });
      if (anyDown) resetStanding(); else startRun();
    } else if (e.key === "Backspace") {
      e.preventDefault();
      if (!running && history.length) { tiles.length = history.pop(); resetStanding(); }
    } else if (e.key === "Escape") {
      if (!running) { tiles.length = 0; history.length = 0; hueCursor = 0; resetStanding(); }
    }
  });

  // ---------------------------------------------------------------- presets

  function preset(kind) {
    tiles.length = 0; history.length = 0; hueCursor = 0;
    var pts = [], i, a, r;
    if (kind === "spiral") {
      for (i = 0; i < 700; i++) {
        a = i * 0.055;
        r = 1.4 + a * 0.72;
        if (r > 12.5) break;
        pts.push({ x: Math.cos(a) * r, z: Math.sin(a) * r });
      }
    } else if (kind === "wave") {
      for (i = 0; i <= 460; i++) {
        var x = -12.5 + (25 * i / 460);
        pts.push({ x: x, z: Math.sin(x * 0.52) * 4.6 });
      }
    } else {                                  // branching fork
      for (i = 0; i <= 150; i++) pts.push({ x: -12 + i * 0.08, z: 0 });
      layPath(pts);
      /* The branches have to SPLIT at the junction, not run parallel and peel
       * away later: while they overlap, the second one's tiles are rejected as
       * duplicates of the first, so it starts too far along to be reached and
       * simply never falls. The linear term is what makes them diverge at once. */
      var up = [], dn = [];
      for (i = 0; i <= 190; i++) {
        var t2 = i / 190;
        var off = t2 * 6 + t2 * t2 * 4;
        up.push({ x: t2 * 12, z: -off });
        dn.push({ x: t2 * 12, z: off });
      }
      layPath(up); layPath(dn);
      history.push(0);
      resetStanding();
      return;
    }
    layPath(pts);
    history.push(0);
    resetStanding();
  }

  var presetBtns = document.querySelectorAll("[data-preset]");
  for (var pi = 0; pi < presetBtns.length; pi++) {
    (function (b) {
      b.addEventListener("click", function () {
        Audio2.init();
        if (running) return;
        preset(b.getAttribute("data-preset"));
        say(tiles.length + " tiles laid — tap one to start it", 1900);
      });
    })(presetBtns[pi]);
  }

  // ---------------------------------------------------------------- sound btn

  var soundBtn = document.getElementById("soundBtn");
  var soundOn = true;
  try { if (localStorage.getItem("dominoes_sound") === "off") soundOn = false; } catch (e) {}
  function syncSound() {
    Audio2.setOn(soundOn);
    if (soundBtn) {
      soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
      soundBtn.textContent = soundOn ? "♪" : "♪̸";
    }
  }
  if (soundBtn) soundBtn.addEventListener("click", function () {
    soundOn = !soundOn;
    try { localStorage.setItem("dominoes_sound", soundOn ? "on" : "off"); } catch (e) {}
    Audio2.init(); syncSound();
  });

  // ---------------------------------------------------------------- start

  function begin() {
    if (overlay) {
      overlay.classList.add("is-out");
      setTimeout(function () { overlay.hidden = true; }, 260);
    }
    if (elHud) elHud.hidden = false;
    var bar = document.getElementById("bar");
    if (bar) bar.hidden = false;
    var hintEl = document.getElementById("hint");
    if (hintEl) setTimeout(function () { hintEl.classList.add("is-gone"); }, 7000);
    Audio2.init();
    if (!tiles.length) preset("spiral");
    updateHud();
  }
  var ovBtn = document.getElementById("ovBtn");
  if (ovBtn) ovBtn.addEventListener("click", begin);

  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", function () { setTimeout(resize, 120); });

  resize();
  syncSound();
  updateHud();
  requestAnimationFrame(frame);

  // headless verification handle
  window.__dom = {
    tiles: tiles, begin: begin, preset: preset, startRun: startRun,
    resetStanding: resetStanding, layPath: layPath, pathPoints: pathPoints,
    isRunning: function () { return running; },
    toppled: function () { return toppledCount; },
    step: function (n) { for (var i = 0; i < (n || 1); i++) stepPhysics(PHYS); },
    consts: { H: H, WD: WD, TH: TH, GAP: GAP, STEP: STEP, TIP: TIP, REST: REST, GRAV: GRAV },
    cam: cam
  };
})();
