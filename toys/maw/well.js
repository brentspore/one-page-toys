/* Maw — the well: its shapes, the camera, and the living wall.
 *
 * The well is a prism of lanes seen from just above its rim. Every lane is a
 * flat quad running from the rim (d = 0) down to the throat (d = 1), and the
 * cross-section narrows a little as it goes, because a gullet does. A pinhole
 * camera draws that honestly: the rim is huge, the throat is a small far ring,
 * and anything climbing toward you accelerates on screen for free.
 *
 * The walls are WebGL — one small mesh and one fragment shader doing the flesh:
 * pillowed membrane between the ribs, veins, photophores, a peristaltic swallow
 * travelling down, and ripples wherever something dies. Everything else (ribs,
 * creatures, light) is Canvas 2D on top, projected with the same maths, so the
 * two layers can never disagree about where a lane is. If WebGL is missing the
 * 2D layer paints a flat banded membrane instead and the game still plays.
 */
(function () {
  "use strict";

  var TAU = Math.PI * 2;

  var CAMD = 1.55;   // camera distance behind the rim plane
  var LEN = 5.2;     // rim to throat, world units
  var TAPER = 0.32;  // the throat's cross-section is 1 - TAPER of the rim's
  var NEAR = 0.04;

  function k(d) { return 1 - TAPER * d; }

  /* ------------------------------------------------------------ shapes */

  // Resample a parametric curve at EQUAL ARC LENGTH, so lanes on a lumpy shape
  // come out the same width rather than bunching where the curve is slow.
  function resample(fn, closed, n) {
    var M = 2400, pts = [], len = [0], i;
    for (i = 0; i <= M; i++) pts.push(fn(i / M));
    for (i = 1; i <= M; i++) {
      var dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
      len.push(len[i - 1] + Math.sqrt(dx * dx + dy * dy));
    }
    var total = len[M], out = [], j = 0, count = closed ? n : n + 1;
    for (var q = 0; q < count; q++) {
      var target = total * q / n;
      while (j < M - 1 && len[j + 1] < target) j++;
      var seg = len[j + 1] - len[j] || 1, f = (target - len[j]) / seg;
      out.push({ x: pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f, y: pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f });
    }
    return out;
  }

  function polar(rf, phase) {
    return function (t) {
      var a = -Math.PI / 2 + TAU * (t + phase), r = rf(a);
      return [Math.cos(a) * r, Math.sin(a) * r];
    };
  }

  /* Ten wells, each a cross-section of something alive. Lane index always runs
   * clockwise on screen. Open wells have lanes + 1 edges and hard ends. */
  var SHAPES = [
    { name: "The Gullet", closed: true, n: 16, camY: -0.3,
      fn: polar(function () { return 1; }, 0.5 / 16) },
    { name: "The Jaw", closed: false, n: 14, camY: -0.5,
      fn: function (t) { var a = (200 - 220 * t) * Math.PI / 180; return [Math.cos(a) * 1.12, Math.sin(a)]; } },
    { name: "The Bloom", closed: true, n: 16, camY: -0.3,
      fn: polar(function (a) { return 1 + 0.2 * Math.cos(4 * a); }, 0) },
    { name: "The Heart", closed: true, n: 16, camY: -0.26,
      fn: function (t) {
        var a = TAU * t, s = Math.sin(a);
        return [16 * s * s * s, -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a))];
      } },
    { name: "The Mantle", closed: false, n: 14, camY: -0.62,
      fn: function (t) { var x = 1 - 2 * t; return [x * 1.2, -(0.55 * Math.sqrt(x * x + 0.05) - 0.18 * Math.cos(x * Math.PI * 1.5))]; } },
    { name: "The Eye", closed: true, n: 16, camY: -0.3,
      fn: function (t) {
        // two arcs meeting in points at left and right
        var c = 0.62, R = Math.sqrt(1 + c * c), a0 = Math.atan2(c, 1), span = Math.PI - 2 * a0;
        if (t < 0.5) { var a = Math.PI + a0 + span * (t * 2); return [Math.cos(a) * R, c + Math.sin(a) * R]; }
        var b = a0 + span * ((t - 0.5) * 2); return [Math.cos(b) * R, -c + Math.sin(b) * R];
      } },
    { name: "The Trefoil", closed: true, n: 15, camY: -0.28,
      fn: polar(function (a) { return 1 + 0.24 * Math.cos(3 * (a + Math.PI / 2)); }, 0) },
    { name: "The Cage", closed: true, n: 16, camY: -0.3,
      fn: polar(function (a) {
        var c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
        return 1 / Math.pow(Math.pow(c, 4) + Math.pow(s, 4), 0.25);
      }, 0.5 / 16) },
    { name: "The Hook", closed: false, n: 13, camY: -0.36,
      fn: function (t) { var a = (180 - 285 * t) * Math.PI / 180; var r = 1 - 0.18 * t; return [Math.cos(a) * r, Math.sin(a) * r]; } },
    { name: "The Star", closed: true, n: 15, camY: -0.28,
      fn: polar(function (a) { return 1 + 0.26 * Math.cos(5 * (a + Math.PI / 2)); }, 0) }
  ];

  var built = [];
  function shape(i) {
    i = ((i % SHAPES.length) + SHAPES.length) % SHAPES.length;
    if (built[i]) return built[i];
    var S = SHAPES[i];
    var pts = resample(S.fn, S.closed, S.n);
    // centre on the bounding box and scale so the larger half-extent is 1
    var x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    pts.forEach(function (p) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); });
    var mx = (x0 + x1) / 2, my = (y0 + y1) / 2, sc = 1 / Math.max((x1 - x0) / 2, (y1 - y0) / 2);
    // open wells sit a little lower so the lip reads as a floor
    if (!S.closed) my -= (y1 - y0) * 0.04;
    pts.forEach(function (p) { p.x = (p.x - mx) * sc; p.y = (p.y - my) * sc; });
    var edges = pts, N = S.n;
    var laneW = 0;
    for (var l = 0; l < N; l++) {
      var a = edges[l], b = edges[(l + 1) % edges.length];
      laneW += Math.hypot(b.x - a.x, b.y - a.y);
    }
    laneW /= N;
    // the lane nearest the bottom of the screen is where you start
    var start = 0, best = -1e9;
    for (l = 0; l < N; l++) {
      var m = mid(edges, l, N, S.closed);
      var sc2 = m.y - Math.abs(m.x) * 0.3;
      if (sc2 > best) { best = sc2; start = l; }
    }
    built[i] = { index: i, name: S.name, closed: S.closed, N: N, edges: edges, camY: S.camY, laneW: laneW, start: start };
    return built[i];
  }

  function mid(edges, l, N, closed) {
    var a = edges[l], b = edges[closed ? (l + 1) % N : l + 1];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  /* ------------------------------------------------------------ camera */

  var cam = { x: 0, y: 0, z: 0 };        // z is how far the camera has dived
  var view = { F: 300, ox: 0, oy: 0, W: 1, H: 1 };

  // world -> screen. Returns false behind the near plane.
  function project(x, y, z, out) {
    var zc = z - cam.z + CAMD;
    if (zc < NEAR) return false;
    var s = view.F / zc;
    out.x = view.ox + (x - cam.x) * s;
    out.y = view.oy + (y - cam.y) * s;
    out.s = s;
    return true;
  }

  // a point on EDGE e (0..edges-1) at depth d
  function edgeAt(sh, e, d, out) {
    var p = sh.edges[sh.closed ? ((e % sh.N) + sh.N) % sh.N : e], kk = k(d);
    return project(p.x * kk, p.y * kk, d * LEN, out);
  }

  /* A point inside lane l at across-fraction u (0..1) and depth d. l may be
   * fractional on a closed well (a creature mid-hop). */
  function laneAt(sh, l, u, d, out) {
    var li = Math.floor(l), fu = l - li + u;
    if (fu >= 1) { li += 1; fu -= 1; }
    var e0 = sh.closed ? ((li % sh.N) + sh.N) % sh.N : Math.max(0, Math.min(sh.N - 1, li));
    var a = sh.edges[e0], b = sh.edges[sh.closed ? (e0 + 1) % sh.N : e0 + 1], kk = k(d);
    var x = a.x + (b.x - a.x) * fu, y = a.y + (b.y - a.y) * fu;
    return project(x * kk, y * kk, d * LEN, out);
  }

  // the WORLD position of a lane point, for things that need to lean outward
  function laneWorld(sh, l, u, d) {
    var li = Math.floor(l), fu = l - li + u;
    if (fu >= 1) { li += 1; fu -= 1; }
    var e0 = sh.closed ? ((li % sh.N) + sh.N) % sh.N : Math.max(0, Math.min(sh.N - 1, li));
    var a = sh.edges[e0], b = sh.edges[sh.closed ? (e0 + 1) % sh.N : e0 + 1], kk = k(d);
    return { x: (a.x + (b.x - a.x) * fu) * kk, y: (a.y + (b.y - a.y) * fu) * kk, z: d * LEN };
  }

  /* Fit the well to the screen. The rim is the biggest thing, but on an open
   * well the throat can poke above it, so both go into the box, plus room for
   * the creature riding the lip. `box` is the free rectangle between the HUD
   * and the bottom controls. */
  function fit(sh, W, H, box) {
    var x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, pad = 0.16;
    sh.edges.forEach(function (p) {
      var rx = p.x / CAMD, ry = (p.y - sh.camY) / CAMD;
      var len = Math.hypot(p.x, p.y) || 1;
      var ox = p.x / len * pad / CAMD, oy = p.y / len * pad / CAMD;
      x0 = Math.min(x0, rx + ox, rx); x1 = Math.max(x1, rx + ox, rx);
      y0 = Math.min(y0, ry + oy, ry); y1 = Math.max(y1, ry + oy, ry);
      var kk = k(1), zc = LEN + CAMD;
      var tx = p.x * kk / zc, ty = (p.y * kk - sh.camY) / zc;
      x0 = Math.min(x0, tx); x1 = Math.max(x1, tx); y0 = Math.min(y0, ty); y1 = Math.max(y1, ty);
    });
    var bw = x1 - x0, bh = y1 - y0;
    var F = Math.min(box.w / bw, box.h / bh);
    view.F = F; view.W = W; view.H = H;
    view.ox = box.x + box.w / 2 - (x0 + bw / 2) * F;
    view.oy = box.y + box.h / 2 - (y0 + bh / 2) * F;
    view.baseF = F; view.baseOx = view.ox; view.baseOy = view.oy;
  }

  /* ------------------------------------------------------------ WebGL */

  var VS = [
    "attribute vec3 aPos;",
    "attribute vec3 aLane;",
    "uniform vec3 uCam;",
    "uniform vec3 uView;",
    "uniform vec2 uRes;",
    "uniform float uCamD;",
    "uniform float uHeat[16];",
    "uniform float uFlash[16];",
    "uniform float uPlayer;",
    "varying vec3 vL;",
    "varying float vHeat;",
    "varying float vFlash;",
    "varying float vPlayer;",
    "varying float vZc;",
    "void main(){",
    "  float zc = aPos.z - uCam.z + uCamD;",
    "  vZc = zc;",
    "  vec2 sc = vec2(uView.y, uView.z) * zc + (aPos.xy - uCam.xy) * uView.x;",
    "  vec2 ndc = vec2(sc.x / uRes.x * 2.0 - zc, zc - sc.y / uRes.y * 2.0);",
    "  float n = 0.03; float f = 80.0;",
    "  float b = -2.0 / (1.0 / n - 1.0 / f); float a = 1.0 - b / f;",
    "  gl_Position = vec4(ndc, a * zc + b, zc);",
    "  float h = 0.0; float fl = 0.0;",
    "  for (int i = 0; i < 16; i++) { if (float(i) == aLane.x) { h = uHeat[i]; fl = uFlash[i]; } }",
    "  vHeat = h; vFlash = fl;",
    "  vPlayer = 1.0 - clamp(abs(aLane.x - uPlayer), 0.0, 1.0);",
    "  vL = aLane;",
    "}"
  ].join("\n");

  var FS = [
    "#ifdef GL_FRAGMENT_PRECISION_HIGH",
    "precision highp float;",
    "#else",
    "precision mediump float;",
    "#endif",
    "varying vec3 vL;",
    "varying float vHeat;",
    "varying float vFlash;",
    "varying float vPlayer;",
    "varying float vZc;",
    "uniform float uT;",
    "uniform float uBeat;",
    "uniform float uFlare;",
    "uniform float uHurt;",
    "uniform float uN;",
    "uniform float uClosed;",
    "uniform float uLaneW;",
    "uniform float uFade;",
    "uniform vec3 uDeep;",
    "uniform vec3 uFlesh;",
    "uniform vec3 uGlow;",
    "uniform vec3 uHot;",
    "uniform vec3 uMine;",
    "uniform vec4 uRip[6];",
    "float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }",
    "float noise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);",
    "  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }",
    "float fbm(vec2 p){ float s = 0.0; float a = 0.5; for (int i = 0; i < 4; i++){ s += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }",
    "void main(){",
    "  float u = vL.y; float d = vL.z; float s = vL.x + u;",
    // texture space in world units: a lane is laneW wide, the well is 5.2 deep
    "  vec2 q = vec2(s * uLaneW, d * 5.2);",
    "  float n1 = fbm(q * 1.3 + vec2(0.0, -uT * 0.05));",
    "  float n2 = fbm(q * 3.4 + vec2(n1 * 1.4, uT * 0.03));",
    // each lane is a soft pillow of tissue bulging between two ribs, with
    // lengthwise folds in it (rugae) that wander with the noise
    "  float pil = sin(3.14159 * u);",
    "  float fold = 0.5 + 0.5 * sin(u * 3.14159 * 4.0 + (n1 - 0.5) * 5.0 + d * 3.0);",
    "  float shape = pow(pil, 0.8) * (0.72 + 0.28 * fold);",
    // a headlamp at the camera: light falls off with distance, which is what
    // makes a tube read as DEEP rather than as a painted disc
    "  float lamp = pow(1.55 / max(vZc, 0.3), 1.35);",
    "  vec3 base = mix(uDeep, uFlesh, clamp(shape * 1.05 + (n1 - 0.5) * 0.6, 0.0, 1.0));",
    "  vec3 col = base * (0.25 + 0.95 * lamp);",
    "  float crease = smoothstep(0.1, 0.0, abs(n2 - 0.5));",
    // fine tissue grain, only big enough to see near the rim
    "  col *= 0.88 + 0.24 * noise(q * vec2(16.0, 11.0));",
    "  col *= 1.0 - crease * 0.4;",
    // veins that light with the heartbeat
    "  float vn = abs(fbm(q * 1.9 + vec2(3.1, 7.3)) - 0.5);",
    "  float vein = smoothstep(0.028, 0.0, vn) * (0.4 + 0.6 * pil);",
    "  col += uGlow * vein * (0.1 + 0.32 * uBeat) * (0.4 + lamp);",
    // photophores
    "  vec2 g = q * 2.4; vec2 id = floor(g); vec2 f = fract(g) - 0.5;",
    "  float hs = hash(id);",
    "  vec2 off = (vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5) * 0.5;",
    "  float dist = length(f - off);",
    "  float on = step(0.72, hs) * smoothstep(0.1, 0.35, pil);",
    "  float tw = 0.45 + 0.55 * sin(uT * (0.8 + hs * 2.2) + hs * 40.0);",
    "  col += uGlow * on * (smoothstep(0.13, 0.0, dist) * 1.2 + smoothstep(0.45, 0.0, dist) * 0.2) * tw * (0.7 + 0.5 * uBeat);",
    // wet: a tight headlamp highlight on the crown of each pillow, broken by the folds
    "  float wet = pow(pil, 10.0) * smoothstep(0.3, 0.75, n2) * (0.55 + 0.45 * fold);",
    "  float glint = pow(pil, 40.0) * smoothstep(0.55, 0.8, n1);",
    "  col += vec3(0.85, 0.95, 1.0) * (wet * 0.55 + glint * 0.5) * lamp;",
    // peristalsis: a swallow travelling down, a raised band with a shadow behind it
    "  float w = fract(d * 1.4 - uT * 0.13);",
    "  float ring = exp(-pow((w - 0.5) * 7.0, 2.0));",
    "  float behind = exp(-pow((w - 0.62) * 7.0, 2.0));",
    "  col *= 0.88 + 0.5 * ring - 0.25 * behind;",
    // ripples where things died
    "  for (int i = 0; i < 6; i++) {",
    "    vec4 r = uRip[i];",
    "    if (r.w > 0.0) {",
    "      float ds = s - r.x;",
    "      if (uClosed > 0.5) ds -= uN * floor(ds / uN + 0.5);",
    "      vec2 dv = vec2(ds * uLaneW, (d - r.y) * 5.2);",
    "      float rr = length(dv); float age = uT - r.z; float front = age * 2.2;",
    "      float wv = sin((rr - front) * 14.0) * exp(-age * 2.4) * smoothstep(0.55, 0.0, abs(rr - front));",
    "      col += uGlow * max(wv, -0.3) * 0.45 * r.w * (0.4 + lamp);",
    "    }",
    "  }",
    "  col += uHot * vHeat * smoothstep(0.8, 0.0, d) * (0.18 + 0.3 * pil);",
    "  col += uMine * vPlayer * 0.07 * pil * (1.0 - d * 0.8);",
    "  col += uGlow * vFlash * 0.5 * (0.3 + lamp);",
    // the light at the very bottom of the well
    "  col += uGlow * smoothstep(0.7, 1.0, d) * (0.1 + 0.1 * uBeat);",
    // the ribs cast a soft shadow into each lane
    "  col *= 0.35 + 0.65 * smoothstep(0.0, 0.22, min(u, 1.0 - u));",
    "  col *= 1.0 + uBeat * 0.08;",
    "  col += uGlow * uFlare * (0.55 + 0.45 * sin(d * 22.0 - uT * 36.0));",
    "  col = mix(col, vec3(0.55, 0.04, 0.1) + col * 0.4, uHurt * 0.55);",
    "  gl_FragColor = vec4(col * uFade, 1.0);",
    "}"
  ].join("\n");

  function makeGL(canvas) {
    var opts = { alpha: true, premultipliedAlpha: true, antialias: true, depth: true, powerPreference: "high-performance" };
    var gl = null;
    try { gl = canvas.getContext("webgl", opts) || canvas.getContext("experimental-webgl", opts); } catch (e) { gl = null; }
    if (!gl) return null;

    function sh(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        try { console.error(gl.getShaderInfoLog(s)); } catch (e) {}
        return null;
      }
      return s;
    }
    var vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return null;
    var prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);

    var loc = {};
    ["uCam", "uView", "uRes", "uCamD", "uHeat", "uFlash", "uPlayer", "uT", "uBeat", "uFlare", "uHurt", "uN",
     "uClosed", "uLaneW", "uFade", "uDeep", "uFlesh", "uGlow", "uHot", "uMine", "uRip"].forEach(function (n) {
      loc[n] = gl.getUniformLocation(prog, n) || gl.getUniformLocation(prog, n + "[0]");
    });
    var aPos = gl.getAttribLocation(prog, "aPos"), aLane = gl.getAttribLocation(prog, "aLane");
    var vbo = gl.createBuffer(), lbo = gl.createBuffer(), ibo = gl.createBuffer(), count = 0, cur = null;

    function setShape(s) {
      if (cur === s) return;
      cur = s;
      var K = 6, S = 40, pos = [], lane = [], idx = [];
      for (var l = 0; l < s.N; l++) {
        var a = s.edges[l], b = s.edges[s.closed ? (l + 1) % s.N : l + 1], base = pos.length / 3;
        for (var j = 0; j <= S; j++) {
          var d = j / S, kk = k(d);
          for (var c = 0; c <= K; c++) {
            var u = c / K;
            pos.push((a.x + (b.x - a.x) * u) * kk, (a.y + (b.y - a.y) * u) * kk, d * LEN);
            lane.push(l, u, d);
          }
        }
        for (j = 0; j < S; j++) {
          for (c = 0; c < K; c++) {
            var i0 = base + j * (K + 1) + c, i1 = i0 + 1, i2 = i0 + K + 1, i3 = i2 + 1;
            idx.push(i0, i2, i1, i1, i2, i3);
          }
        }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, lbo); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lane), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
      count = idx.length;
    }

    var heat = new Float32Array(16), flash = new Float32Array(16), rip = new Float32Array(24);

    function render(st, scale) {
      var w = canvas.width, h = canvas.height;
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!cur) return;
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, lbo);
      gl.enableVertexAttribArray(aLane); gl.vertexAttribPointer(aLane, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);

      gl.uniform3f(loc.uCam, cam.x, cam.y, cam.z);
      gl.uniform3f(loc.uView, view.F * scale, view.ox * scale, view.oy * scale);
      gl.uniform2f(loc.uRes, w, h);
      gl.uniform1f(loc.uCamD, CAMD);
      for (var i = 0; i < 16; i++) { heat[i] = st.heat[i] || 0; flash[i] = st.flash[i] || 0; }
      gl.uniform1fv(loc.uHeat, heat);
      gl.uniform1fv(loc.uFlash, flash);
      gl.uniform1f(loc.uPlayer, st.player);
      gl.uniform1f(loc.uT, st.t);
      gl.uniform1f(loc.uBeat, st.beat);
      gl.uniform1f(loc.uFlare, st.flare);
      gl.uniform1f(loc.uHurt, st.hurt);
      gl.uniform1f(loc.uN, cur.N);
      gl.uniform1f(loc.uClosed, cur.closed ? 1 : 0);
      gl.uniform1f(loc.uLaneW, cur.laneW);
      gl.uniform1f(loc.uFade, st.fade);
      var p = st.pal;
      gl.uniform3fv(loc.uDeep, p.deep); gl.uniform3fv(loc.uFlesh, p.flesh);
      gl.uniform3fv(loc.uGlow, p.glow); gl.uniform3fv(loc.uHot, p.hot); gl.uniform3fv(loc.uMine, p.mine);
      for (i = 0; i < 24; i++) rip[i] = 0;
      for (i = 0; i < Math.min(6, st.ripples.length); i++) {
        var r = st.ripples[i];
        rip[i * 4] = r.s; rip[i * 4 + 1] = r.d; rip[i * 4 + 2] = r.t0; rip[i * 4 + 3] = r.w;
      }
      gl.uniform4fv(loc.uRip, rip);
      gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);
    }

    return { setShape: setShape, render: render, gl: gl };
  }

  window.MAW_WELL = {
    CAMD: CAMD, LEN: LEN, TAPER: TAPER, NEAR: NEAR,
    count: SHAPES.length,
    shape: shape, k: k,
    cam: cam, view: view,
    project: project, edgeAt: edgeAt, laneAt: laneAt, laneWorld: laneWorld,
    fit: fit, makeGL: makeGL
  };
})();
