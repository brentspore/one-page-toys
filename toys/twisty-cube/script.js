/* Twisty Cube — a 2x2 / 3x3 / 4x4 twisty puzzle in raw WebGL (no libraries).
 *
 * Cubie orientation is stored as an INTEGER 3x3 matrix, not a quaternion.
 * Every turn on this puzzle is exactly 90 degrees, so the state is exact and
 * stays exact forever — a float quaternion accumulates drift and eventually a
 * "solved" check starts failing on a cube that is visibly solved. The smooth
 * rotation you see during a turn is a render-only angle; the state itself only
 * ever changes in whole quarter turns.
 *
 * Picking is analytic: the pointer ray is intersected with the cube's six face
 * planes, which gives the face and the cubie under the finger. Dragging then
 * picks whichever of the face's two tangent directions the drag ran along, and
 * turns the slice about the other one. No depth-buffer readback, no colour
 * picking pass.
 */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var gl = canvas.getContext("webgl", { antialias: true, alpha: false })
        || canvas.getContext("experimental-webgl", { antialias: true });
  if (!gl) {
    var fb = document.createElement("p");
    fb.textContent = "This toy needs WebGL. Try a different browser.";
    fb.style.cssText = "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;font-family:monospace;color:#f2efe8;padding:24px;text-align:center";
    document.body.appendChild(fb);
    return;
  }

  // ------------------------------------------------------------------ math

  function sub(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
  function add(a, b) { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
  function scale3(a, s) { return [a[0]*s, a[1]*s, a[2]*s]; }
  function dot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
  function cross(a, b) {
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  }
  function len3(a) { return Math.sqrt(dot(a, a)); }
  function norm3(a) { var l = len3(a) || 1; return [a[0]/l, a[1]/l, a[2]/l]; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function mIdent() { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }
  function mMul(a, b) {
    var o = new Array(16);
    for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) {
      o[i*4+j] = a[j]*b[i*4] + a[4+j]*b[i*4+1] + a[8+j]*b[i*4+2] + a[12+j]*b[i*4+3];
    }
    return o;
  }
  function mTranslate(x, y, z) { var m = mIdent(); m[12]=x; m[13]=y; m[14]=z; return m; }
  function mPerspective(fovy, asp, near, far) {
    var f = 1/Math.tan(fovy/2), nf = 1/(near-far);
    return [f/asp,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0];
  }
  function mLookAt(eye, center, up) {
    var z = norm3(sub(eye, center)), x = norm3(cross(up, z)), y = cross(z, x);
    return [x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0,
            -dot(x,eye), -dot(y,eye), -dot(z,eye), 1];
  }
  function mNormal(m) { return [m[0],m[1],m[2], m[4],m[5],m[6], m[8],m[9],m[10]]; }
  // rotation about an arbitrary axis, as a 4x4
  function mAxisAngle(ax, ang) {
    var a = norm3(ax), c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
    var x = a[0], y = a[1], z = a[2];
    return [t*x*x+c, t*x*y+s*z, t*x*z-s*y, 0,
            t*x*y-s*z, t*y*y+c, t*y*z+s*x, 0,
            t*x*z+s*y, t*y*z-s*x, t*z*z+c, 0,
            0,0,0,1];
  }
  // 3x3 integer orientation stored row-major as [r0, r1, r2]; v' = M v
  function m3Ident() { return [[1,0,0],[0,1,0],[0,0,1]]; }
  function m3Apply(M, v) {
    return [M[0][0]*v[0]+M[0][1]*v[1]+M[0][2]*v[2],
            M[1][0]*v[0]+M[1][1]*v[1]+M[1][2]*v[2],
            M[2][0]*v[0]+M[2][1]*v[1]+M[2][2]*v[2]];
  }
  function m3ApplyT(M, v) {   // transpose = inverse, for a rotation
    return [M[0][0]*v[0]+M[1][0]*v[1]+M[2][0]*v[2],
            M[0][1]*v[0]+M[1][1]*v[1]+M[2][1]*v[2],
            M[0][2]*v[0]+M[1][2]*v[1]+M[2][2]*v[2]];
  }
  function m3Mul(A, B) {
    var o = [[0,0,0],[0,0,0],[0,0,0]];
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) {
      o[i][j] = A[i][0]*B[0][j] + A[i][1]*B[1][j] + A[i][2]*B[2][j];
    }
    return o;
  }
  function m3To4(M) {
    return [M[0][0], M[1][0], M[2][0], 0,
            M[0][1], M[1][1], M[2][1], 0,
            M[0][2], M[1][2], M[2][2], 0,
            0, 0, 0, 1];
  }
  /* Exact quarter-turn matrix about axis 0/1/2, dir +1 or -1. Built from a
   * table rather than rounding cos/sin so the entries are literally integers. */
  function quarter(axis, dir) {
    var M = m3Ident();
    var a = (axis + 1) % 3, b = (axis + 2) % 3;
    M[a][a] = 0; M[b][b] = 0;
    M[a][b] = -dir; M[b][a] = dir;
    return M;
  }

  // ------------------------------------------------------------- constants

  var FACES = [[1,0,0], [-1,0,0], [0,1,0], [0,-1,0], [0,0,1], [0,0,-1]];
  function faceIndexOf(d) {
    for (var i = 0; i < 6; i++) {
      if (FACES[i][0] === d[0] && FACES[i][1] === d[1] && FACES[i][2] === d[2]) return i;
    }
    return -1;
  }

  /* A designed palette rather than the familiar one: warm white, coral, amber,
   * jade, azure, violet. It reads better on a dark stage and keeps the toy
   * clearly its own thing. */
  var STICKER = [
    [0.93, 0.31, 0.29],   // +x coral
    [1.00, 0.66, 0.16],   // -x amber
    [0.96, 0.95, 0.92],   // +y warm white
    [0.98, 0.86, 0.30],   // -y butter
    [0.24, 0.74, 0.58],   // +z jade
    [0.32, 0.55, 0.92]    // -z azure
  ];

  var CUBIE = 1.0;                     // world size of one cubie
  var GAP = 0.045;
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ------------------------------------------------------------ mesh build

  function MB() { return { pos: [], nor: [], col: [] }; }
  function mbVert(b, p, n, c) {
    b.pos.push(p[0], p[1], p[2]); b.nor.push(n[0], n[1], n[2]); b.col.push(c[0], c[1], c[2]);
  }
  function mbUpload(b) {
    var m = { pos: gl.createBuffer(), nor: gl.createBuffer(), col: gl.createBuffer(), n: b.pos.length/3 };
    gl.bindBuffer(gl.ARRAY_BUFFER, m.pos); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(b.pos), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.nor); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(b.nor), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.col); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(b.col), gl.STATIC_DRAW);
    return m;
  }

  /* A rounded cubie body. The bevel is the whole reason a real cube looks like
   * a cube and not a stack of blocks: it catches a highlight along every edge,
   * which is what separates neighbouring pieces visually. */
  function roundedBox(half, r, seg, col) {
    var b = MB();
    // A rounded box is a sphere whose octants are pushed out to the corners.
    function surf(u, v) {
      var th = u * Math.PI * 2, ph = v * Math.PI;
      var n = [Math.sin(ph)*Math.cos(th), Math.cos(ph), Math.sin(ph)*Math.sin(th)];
      var k = half - r;
      var p = [Math.sign(n[0]) * k + n[0]*r, Math.sign(n[1]) * k + n[1]*r, Math.sign(n[2]) * k + n[2]*r];
      // pull the flats truly flat so faces are planar, not bulged
      p[0] = clamp(p[0], -half, half); p[1] = clamp(p[1], -half, half); p[2] = clamp(p[2], -half, half);
      return { p: p, n: n };
    }
    for (var i = 0; i < seg; i++) for (var j = 0; j < seg; j++) {
      var u0 = i/seg, u1 = (i+1)/seg, v0 = j/seg, v1 = (j+1)/seg;
      var a = surf(u0, v0), c = surf(u1, v0), d = surf(u1, v1), e = surf(u0, v1);
      mbVert(b, a.p, a.n, col); mbVert(b, c.p, c.n, col); mbVert(b, d.p, d.n, col);
      mbVert(b, a.p, a.n, col); mbVert(b, d.p, d.n, col); mbVert(b, e.p, e.n, col);
    }
    return mbUpload(b);
  }

  // one sticker tile, lying just proud of the +z face of a cubie
  function stickerMesh(size, bodyHalf) {
    var b = MB();
    var n = [0, 0, 1], z = bodyHalf + 0.004;
    var s = size / 2;
    // rounded-square outline, fanned from the centre
    var pts = [];
    var N = 28;
    for (var i = 0; i < N; i++) {
      var t = (i / N) * Math.PI * 2;
      // squircle: gives soft corners without a corner-arc special case
      var cx = Math.cos(t), cy = Math.sin(t);
      var k = 1 / Math.pow(Math.pow(Math.abs(cx), 4.2) + Math.pow(Math.abs(cy), 4.2), 1/4.2);
      pts.push([cx * k * s, cy * k * s]);
    }
    for (var j = 0; j < N; j++) {
      var p0 = pts[j], p1 = pts[(j+1) % N];
      mbVert(b, [0, 0, z], n, [1,1,1]);
      mbVert(b, [p0[0], p0[1], z], n, [1,1,1]);
      mbVert(b, [p1[0], p1[1], z], n, [1,1,1]);
    }
    return mbUpload(b);
  }

  // ---------------------------------------------------------------- shaders

  var VS = [
    "attribute vec3 aPos; attribute vec3 aNor; attribute vec3 aCol;",
    "uniform mat4 uProj, uView, uModel; uniform mat3 uNorm;",
    "varying vec3 vN, vW, vC;",
    "void main(){",
    "  vec4 w = uModel * vec4(aPos, 1.0);",
    "  vW = w.xyz; vN = normalize(uNorm * aNor); vC = aCol;",
    "  gl_Position = uProj * uView * w;",
    "}"
  ].join("\n");

  var FS = [
    "precision highp float;",
    "varying vec3 vN, vW, vC;",
    "uniform vec3 uEye, uTint;",
    "uniform int uMode;",       // 0 body, 1 sticker, 2 emissive
    "uniform float uAlpha;",
    "void main(){",
    "  if (uMode == 2) { gl_FragColor = vec4(uTint, uAlpha); return; }",
    "  vec3 N = normalize(vN);",
    "  vec3 V = normalize(uEye - vW);",
    "  vec3 L1 = normalize(vec3(-0.35, 0.80, 0.62));",
    "  vec3 L2 = normalize(vec3(0.72, 0.28, -0.42));",
    "  vec3 base = uMode == 1 ? uTint : vec3(0.055, 0.055, 0.070);",
    "  float shine = uMode == 1 ? 42.0 : 90.0;",
    "  float spec  = uMode == 1 ? 0.34 : 0.55;",
    "  float d1 = max(dot(N, L1), 0.0);",
    "  float d2 = max(dot(N, L2), 0.0);",
    "  vec3 diff = base * (0.30 + 0.78 * d1 + 0.34 * d2);",
    "  vec3 H1 = normalize(L1 + V);",
    "  float s1 = pow(max(dot(N, H1), 0.0), shine) * spec;",
    "  vec3 H2 = normalize(L2 + V);",
    "  float s2 = pow(max(dot(N, H2), 0.0), shine * 0.5) * spec * 0.42;",
    /* A rim term. Against a dark stage the cube's silhouette otherwise
     * dissolves into the background at the edges. */
    "  float rim = pow(1.0 - max(dot(N, V), 0.0), 2.6) * 0.30;",
    "  vec3 c = diff + vec3(1.0, 0.97, 0.92) * s1 + vec3(0.72, 0.82, 1.0) * s2 + vec3(0.42,0.46,0.62) * rim;",
    "  gl_FragColor = vec4(c, uAlpha);",
    "}"
  ].join("\n");

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
    return s;
  }
  var prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  var A = {
    pos: gl.getAttribLocation(prog, "aPos"),
    nor: gl.getAttribLocation(prog, "aNor"),
    col: gl.getAttribLocation(prog, "aCol")
  };
  var U = {};
  ["uProj","uView","uModel","uNorm","uEye","uMode","uAlpha","uTint"].forEach(function (n) {
    U[n] = gl.getUniformLocation(prog, n);
  });

  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.clearColor(0.043, 0.043, 0.062, 1);

  function drawMesh(m, model, mode, tint, alpha) {
    gl.bindBuffer(gl.ARRAY_BUFFER, m.pos);
    gl.enableVertexAttribArray(A.pos); gl.vertexAttribPointer(A.pos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.nor);
    gl.enableVertexAttribArray(A.nor); gl.vertexAttribPointer(A.nor, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.col);
    gl.enableVertexAttribArray(A.col); gl.vertexAttribPointer(A.col, 3, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(U.uModel, false, new Float32Array(model));
    gl.uniformMatrix3fv(U.uNorm, false, new Float32Array(mNormal(model)));
    gl.uniform1i(U.uMode, mode || 0);
    gl.uniform3fv(U.uTint, new Float32Array(tint || [1,1,1]));
    gl.uniform1f(U.uAlpha, alpha === undefined ? 1 : alpha);
    gl.drawArrays(gl.TRIANGLES, 0, m.n);
  }

  var BODY_HALF = CUBIE/2 - GAP/2;
  var meshBody = roundedBox(BODY_HALF, 0.13, 22, [0.06, 0.06, 0.075]);
  var meshSticker = stickerMesh(CUBIE - GAP * 2 - 0.16, BODY_HALF);

  // ----------------------------------------------------------------- state

  var N = 3;
  try { N = clamp(parseInt(localStorage.getItem("cube_size") || "3", 10) || 3, 2, 4); } catch (e) {}

  var cubies = [];
  var half;              // (N-1)/2, so coordinates are -half..half in steps of 1

  function buildCube() {
    cubies = [];
    half = (N - 1) / 2;
    for (var x = 0; x < N; x++) for (var y = 0; y < N; y++) for (var z = 0; z < N; z++) {
      var cx = x - half, cy = y - half, cz = z - half;
      var onSurface = x === 0 || x === N-1 || y === 0 || y === N-1 || z === 0 || z === N-1;
      if (!onSurface) continue;          // the core is never visible
      cubies.push({ p: [cx, cy, cz], m: m3Ident() });
    }
  }

  // which sticker colour currently faces world direction d
  function colourFacing(c, d) {
    var local = m3ApplyT(c.m, d);
    var i = faceIndexOf([Math.round(local[0]), Math.round(local[1]), Math.round(local[2])]);
    return i < 0 ? null : STICKER[i];
  }
  // is this cubie on the outer layer along direction d
  function onFace(c, d) {
    return Math.abs(dot(c.p, d) - half) < 1e-6;
  }

  function isSolved() {
    for (var f = 0; f < 6; f++) {
      var d = FACES[f], ref = null;
      for (var i = 0; i < cubies.length; i++) {
        var c = cubies[i];
        if (!onFace(c, d)) continue;
        var col = colourFacing(c, d);
        if (!ref) ref = col;
        else if (col !== ref) return false;
      }
    }
    return true;
  }

  /* Apply a quarter turn to every cubie in one slice. `axis` is 0/1/2, `layer`
   * is the coordinate of the slice, `dir` is +1 or -1. */
  function applyTurn(axis, layer, dir) {
    var R = quarter(axis, dir);
    for (var i = 0; i < cubies.length; i++) {
      var c = cubies[i];
      if (Math.abs(c.p[axis] - layer) > 1e-6) continue;
      /* No rounding here. On an even cube the coordinates are half-integers
       * (±0.5, ±1.5), and Math.round(0.5) is 1 — rounding "to clean up float
       * error" silently destroys every 2x2 and 4x4. There is no error to clean
       * up: the rotation entries are 0 and ±1, so the products are exact. */
      c.p = m3Apply(R, c.p);
      c.m = m3Mul(R, c.m);
    }
  }

  // ------------------------------------------------------------- animation

  var anim = null;       // { axis, layer, dir, t, dur }
  var queue = [];
  var TURN_MS = 155;

  function pushTurn(axis, layer, dir, quick) {
    queue.push({ axis: axis, layer: layer, dir: dir, quick: !!quick });
  }
  function stepAnim(dt) {
    if (!anim && queue.length) {
      anim = queue.shift();
      anim.t = 0;
      anim.dur = (anim.quick ? 0.055 : TURN_MS / 1000);
      if (reduceMotion) anim.dur = 0.02;
      sndClick(anim.quick ? 0.5 : 1);
    }
    if (!anim) return;
    anim.t += dt;
    if (anim.t >= anim.dur) {
      applyTurn(anim.axis, anim.layer, anim.dir);
      anim = null;
      if (!queue.length) afterTurns();
    }
  }

  function afterTurns() {
    if (scrambling) { scrambling = false; setStatus(); return; }
    if (!running) return;
    if (isSolved()) {
      running = false;
      var secs = (performance.now() - startedAt) / 1000;
      finish(secs);
    }
  }

  // ---------------------------------------------------------------- camera

  var az = 0.66, el = 0.52;         // orbit angles
  var camDist = 0;                  // 0 = snap on the first frame, then ease
  var curEye = [0, 0, 6];
  var center = [0, 0, 0], upv = [0, 1, 0];
  var FOV = 42 * Math.PI / 180;

  /* Exact framing for the CURRENT orientation, not a worst-case bound.
   *
   * Fitting the bounding sphere (or even the widest possible silhouette, the
   * hexagon down a body diagonal) is safe but leaves the cube filling about
   * two thirds of a phone's width, because most viewing angles are nowhere
   * near the worst case. The requirement per corner is closed-form: with the
   * camera at distance d along u, a corner c sits at depth (d - c·u) and
   * offset c·right, so it stays inside the frustum when
   *     d >= c·u + |c·right| / tan(halfH)     (and likewise for up/halfV).
   * Taking the max over the eight corners is exact. The result is eased rather
   * than applied instantly so orbiting reads as a camera move, not a zoom. */
  function fitDistance(asp) {
    var S = (N * CUBIE) / 2;
    var halfV = FOV / 2;
    var tH = Math.tan(Math.atan(Math.tan(halfV) * asp));
    var tV = Math.tan(halfV);
    var u = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
    var fwd = scale3(u, -1);
    var rgt = norm3(cross(fwd, upv));
    var ups = cross(rgt, fwd);
    var need = 0;
    for (var sx = -1; sx <= 1; sx += 2)
      for (var sy = -1; sy <= 1; sy += 2)
        for (var sz = -1; sz <= 1; sz += 2) {
          var c = [sx * S, sy * S, sz * S];
          var along = dot(c, u);
          need = Math.max(need,
            along + Math.abs(dot(c, rgt)) / tH,
            along + Math.abs(dot(c, ups)) / tV);
        }
    return need * 1.07;
  }
  function updateCamera(asp, dt) {
    var target = fitDistance(asp);
    if (!camDist || camDist < 0.01) camDist = target;
    else camDist += (target - camDist) * Math.min(1, (dt || 0.016) * 7);
    curEye = [
      Math.cos(el) * Math.sin(az) * camDist,
      Math.sin(el) * camDist,
      Math.cos(el) * Math.cos(az) * camDist
    ];
  }

  function pointerRay(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    var ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    var ndcY = 1 - ((clientY - rect.top) / rect.height) * 2;
    var f = norm3(sub(center, curEye));
    var r = norm3(cross(f, upv));
    var u = cross(r, f);
    var th = Math.tan(FOV / 2);
    var asp = rect.width / rect.height;
    var dir = norm3(add(add(scale3(r, ndcX * th * asp), scale3(u, ndcY * th)), f));
    return { o: curEye, d: dir };
  }

  /* Ray vs the cube's six face planes. Returns the face normal, the hit point,
   * and the two in-face tangent axes — everything the drag mapping needs. */
  function pickFace(ray) {
    var S = (N * CUBIE) / 2;
    var best = null;
    for (var f = 0; f < 6; f++) {
      var nrm = FACES[f];
      var denom = dot(ray.d, nrm);
      if (denom > -1e-6) continue;                 // back-facing or parallel
      var t = (dot(nrm, scale3(nrm, S)) - dot(nrm, ray.o)) / denom;
      if (t < 0) continue;
      var p = add(ray.o, scale3(ray.d, t));
      // inside the face square?
      var ok = true;
      for (var k = 0; k < 3; k++) {
        if (nrm[k] !== 0) continue;
        if (Math.abs(p[k]) > S + 1e-4) { ok = false; break; }
      }
      if (!ok) continue;
      if (!best || t < best.t) best = { t: t, f: f, p: p, n: nrm };
    }
    if (!best) return null;
    // tangents: the two axes that are not the face normal
    var axes = [];
    for (var a = 0; a < 3; a++) if (best.n[a] === 0) axes.push(a);
    best.axes = axes;
    return best;
  }

  // ------------------------------------------------------------------ game

  var running = false, scrambling = false, startedAt = 0, elapsed = 0;
  var moves = 0;
  var bestKey = function () { return "cube_best_" + N; };
  var best = {};
  function loadBest() {
    try {
      var v = parseFloat(localStorage.getItem(bestKey()) || "0");
      best[N] = isNaN(v) ? 0 : v;
    } catch (e) { best[N] = 0; }
  }

  function fmt(s) {
    s = s || 0;
    var m = Math.floor(s / 60), r = s - m * 60;
    return (m > 0 ? m + ":" + (r < 10 ? "0" : "") : "") + r.toFixed(2);
  }

  var elTime = document.getElementById("time");
  var elMoves = document.getElementById("moves");
  var elBest = document.getElementById("best");
  var elStatus = document.getElementById("status");
  var overlay = document.getElementById("overlay");
  var ovTitle = document.getElementById("ovTitle");
  var ovEyebrow = document.getElementById("ovEyebrow");
  var ovText = document.getElementById("ovText");
  var ovBtn = document.getElementById("ovBtn");
  var scrambleBtn = document.getElementById("scrambleBtn");
  var soundBtn = document.getElementById("soundBtn");
  var sizeBtns = Array.prototype.slice.call(document.querySelectorAll(".size__btn"));

  function setHud() {
    elTime.textContent = fmt(elapsed);
    elMoves.textContent = String(moves);
    elBest.textContent = best[N] ? fmt(best[N]) : "--";
  }
  function setStatus() {
    if (scrambling) { elStatus.textContent = "scrambling"; return; }
    if (running) { elStatus.textContent = ""; return; }
    elStatus.textContent = isSolved() ? "solved" : "ready · first turn starts the clock";
  }

  function finish(secs) {
    elapsed = secs;
    var isBest = !best[N] || secs < best[N];
    if (isBest) {
      best[N] = secs;
      try { localStorage.setItem(bestKey(), String(secs)); } catch (e) {}
    }
    setHud();
    sndSolved();
    ovEyebrow.textContent = isBest ? "New best" : "Solved";
    ovTitle.textContent = fmt(secs);
    ovText.textContent = moves + " moves on the " + N + "×" + N + ". " +
      (isBest ? "That is your fastest yet." : "Best is " + fmt(best[N]) + ".");
    ovBtn.textContent = "Scramble again";
    overlay.hidden = false;
    if (typeof gtag === "function") gtag("event", "cube_solved", { size: N, value: Math.round(secs), moves: moves });
  }

  /* Scramble by applying random quarter turns to random layers. Generating the
   * state this way means it is always solvable by construction — no need to
   * check parity, and no chance of dealing an impossible cube. */
  function scramble() {
    var count = N === 2 ? 14 : N === 3 ? 25 : 40;
    var lastAxis = -1;
    queue.length = 0;
    for (var i = 0; i < count; i++) {
      var axis;
      do { axis = Math.floor(Math.random() * 3); } while (axis === lastAxis);
      lastAxis = axis;
      var layer = Math.floor(Math.random() * N) - half;
      var dir = Math.random() < 0.5 ? 1 : -1;
      pushTurn(axis, layer, dir, true);
    }
    scrambling = true;
    running = false;
    elapsed = 0; moves = 0;
    setHud(); setStatus();
    overlay.hidden = true;
  }

  function setSize(n) {
    N = n;
    try { localStorage.setItem("cube_size", String(n)); } catch (e) {}
    loadBest();
    buildCube();
    queue.length = 0; anim = null;
    running = false; elapsed = 0; moves = 0;
    sizeBtns.forEach(function (b) {
      var on = parseInt(b.dataset.size, 10) === n;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", String(on));
    });
    scramble();
  }

  // ----------------------------------------------------------------- input

  var drag = null;
  var DRAG_MIN = 12;     // px before a drag commits to orbiting or turning

  canvas.addEventListener("pointerdown", function (e) {
    initAudio();
    if (actx && actx.state === "suspended") actx.resume();
    if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (er) {} }
    var ray = pointerRay(e.clientX, e.clientY);
    var hit = pickFace(ray);
    drag = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, hit: hit, mode: null, az0: az, el0: el };
  });

  canvas.addEventListener("pointermove", function (e) {
    if (!drag) return;
    drag.x = e.clientX; drag.y = e.clientY;
    var dx = drag.x - drag.x0, dy = drag.y - drag.y0;
    if (!drag.mode) {
      if (Math.abs(dx) + Math.abs(dy) < DRAG_MIN) return;
      drag.mode = drag.hit ? "turn" : "orbit";
      if (drag.mode === "turn") commitTurn(dx, dy);
    } else if (drag.mode === "orbit") {
      az = drag.az0 - dx * 0.0085;
      el = clamp(drag.el0 + dy * 0.0085, -1.35, 1.35);
    }
  });

  function endDrag() { drag = null; }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  /* Map a screen-space drag on a face to a slice turn.
   *
   * Project each of the face's two tangent axes into screen space, see which
   * one the drag ran along, and turn about the OTHER one. The sign comes from
   * whether the drag agreed or disagreed with that axis on screen, which is
   * what makes the cube turn the way your finger went regardless of how the
   * camera happens to be orbited. */
  function commitTurn(dx, dy) {
    var hit = drag.hit;
    // no turning mid-scramble, and never let the queue run away under a fast drag
    if (!hit || scrambling || queue.length > 2) return;
    var f = norm3(sub(center, curEye));
    var rgt = norm3(cross(f, upv));
    var upS = cross(rgt, f);

    function toScreen(v) { return [dot(v, rgt), dot(v, upS)]; }

    var a0 = hit.axes[0], a1 = hit.axes[1];
    var v0 = [0,0,0]; v0[a0] = 1;
    var v1 = [0,0,0]; v1[a1] = 1;
    var s0 = toScreen(v0), s1 = toScreen(v1);
    var dragV = [dx, -dy];                 // screen y grows downward
    var p0 = s0[0]*dragV[0] + s0[1]*dragV[1];
    var p1 = s1[0]*dragV[0] + s1[1]*dragV[1];

    var alongAxis, aboutAxis, sign;
    if (Math.abs(p0) >= Math.abs(p1)) { alongAxis = a0; aboutAxis = a1; sign = p0 > 0 ? 1 : -1; }
    else { alongAxis = a1; aboutAxis = a0; sign = p1 > 0 ? 1 : -1; }

    // which layer along the rotation axis did the finger land on
    var S = (N * CUBIE) / 2;
    var coord = hit.p[aboutAxis];
    var layer = clamp(Math.round(coord / CUBIE - (N % 2 === 0 ? 0.5 : 0)) + (N % 2 === 0 ? 0.5 : 0), -half, half);

    /* Right-hand rule bookkeeping: dragging along +alongAxis on a face whose
     * normal is +normalAxis turns the slice one way, and every sign flip in
     * (face direction, axis handedness) reverses it. Working it out from the
     * cross product keeps it correct for all six faces instead of needing a
     * six-case table. */
    var alongV = [0,0,0]; alongV[alongAxis] = sign;
    var turnAxisV = cross(hit.n, alongV);          // points along +/- aboutAxis
    var dir = turnAxisV[aboutAxis] > 0 ? 1 : -1;

    beginIfNeeded();
    moves++;
    pushTurn(aboutAxis, layer, dir, false);
    setHud();
  }

  function beginIfNeeded() {
    if (running || scrambling) return;
    running = true;
    startedAt = performance.now();
    elapsed = 0;
    setStatus();
  }

  window.addEventListener("keydown", function (e) {
    if (!overlay.hidden && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); ovBtn.click(); return; }
    var step = 0.12;
    if (e.key === "ArrowLeft") { az += step; e.preventDefault(); }
    else if (e.key === "ArrowRight") { az -= step; e.preventDefault(); }
    else if (e.key === "ArrowUp") { el = clamp(el + step, -1.35, 1.35); e.preventDefault(); }
    else if (e.key === "ArrowDown") { el = clamp(el - step, -1.35, 1.35); e.preventDefault(); }
    else if (e.key.toLowerCase() === "s") { scramble(); }
  });

  ovBtn.addEventListener("click", function () {
    initAudio();
    if (actx && actx.state === "suspended") actx.resume();
    overlay.hidden = true;
    scramble();
  });
  scrambleBtn.addEventListener("click", function () {
    initAudio();
    if (actx && actx.state === "suspended") actx.resume();
    scramble();
  });
  sizeBtns.forEach(function (b) {
    b.addEventListener("click", function () {
      initAudio();
      if (actx && actx.state === "suspended") actx.resume();
      setSize(parseInt(b.dataset.size, 10));
    });
  });

  // ----------------------------------------------------------------- audio

  var actx = null, master = null, comp = null, verb = null, muted = false;
  try { muted = localStorage.getItem("cube_sound") === "off"; } catch (e) {}

  function initAudio() {
    if (actx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    var b = actx.createBuffer(1, 1, 22050);
    var s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0);

    master = actx.createGain(); master.gain.value = muted ? 0 : 0.85;
    var lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 13000;
    comp = actx.createDynamicsCompressor();
    comp.threshold.value = -15; comp.ratio.value = 3; comp.attack.value = 0.003; comp.release.value = 0.2;
    comp.connect(lp); lp.connect(master); master.connect(actx.destination);

    // a small dry room: this is a hand-held object on a desk, not a hall
    var len = Math.floor(actx.sampleRate * 0.55);
    var ir = actx.createBuffer(2, len, actx.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = ir.getChannelData(ch), lastv = 0;
      for (var i = 0; i < len; i++) {
        var t = i / len;
        var nz = (Math.random() * 2 - 1) * Math.pow(1 - t, 4.0);
        lastv = lastv * 0.5 + nz * 0.5;
        d[i] = lastv;
      }
    }
    verb = actx.createConvolver(); verb.buffer = ir;
    var vg = actx.createGain(); vg.gain.value = 0.16;
    verb.connect(vg); vg.connect(comp);
  }

  function noiseBuf(sec) {
    var len = Math.floor(actx.sampleRate * sec);
    var b = actx.createBuffer(1, len, actx.sampleRate);
    var d = b.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  /* The speedcube click. Moulded ABS clicking against ABS is a dry, bright,
   * very short event: a filtered noise transient plus two high inharmonic
   * partials gone inside 60ms. Any sustain at all and it stops sounding like
   * plastic and starts sounding like a woodblock. */
  var lastClick = 0;
  function sndClick(gain) {
    if (!actx || muted) return;
    var t = actx.currentTime;
    if (t - lastClick < 0.012) return;
    lastClick = t;
    var amp = 0.16 * (gain === undefined ? 1 : gain);
    var n = actx.createBufferSource(); n.buffer = noiseBuf(0.05);
    var nf = actx.createBiquadFilter(); nf.type = "bandpass";
    nf.frequency.value = 2400 + Math.random() * 900; nf.Q.value = 1.1;
    var ng = actx.createGain();
    ng.gain.setValueAtTime(amp, t);
    ng.gain.exponentialRampToValueAtTime(0.0006, t + 0.038);
    n.connect(nf); nf.connect(ng); ng.connect(comp); ng.connect(verb);
    n.start(t); n.stop(t + 0.06);
    var f0 = 1500 + Math.random() * 420;
    [1, 2.31].forEach(function (r, i) {
      var o = actx.createOscillator(); o.type = "triangle"; o.frequency.value = f0 * r;
      var g = actx.createGain();
      g.gain.setValueAtTime(amp * 0.42 / (i + 1), t);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.05);
      o.connect(g); g.connect(comp);
      o.start(t); o.stop(t + 0.07);
    });
  }

  function sndSolved() {
    if (!actx || muted) return;
    var t = actx.currentTime;
    // a bright open fifth stack, arriving quickly so it feels like a stopwatch
    [0, 7, 12, 16, 19].forEach(function (semi, i) {
      var f = 440 * Math.pow(2, semi / 12);
      var st = t + i * 0.055;
      [1, 2, 3].forEach(function (h, hi) {
        var o = actx.createOscillator();
        o.type = hi === 0 ? "triangle" : "sine";
        o.frequency.value = f * h;
        var g = actx.createGain();
        g.gain.setValueAtTime(0.0001, st);
        g.gain.exponentialRampToValueAtTime(0.10 / (hi + 1) / (i * 0.35 + 1), st + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0004, st + 1.1);
        o.connect(g); g.connect(comp); g.connect(verb);
        o.start(st); o.stop(st + 1.2);
      });
    });
  }

  soundBtn.addEventListener("click", function () {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.85;
    soundBtn.setAttribute("aria-pressed", String(!muted));
    soundBtn.textContent = muted ? "♪̸" : "♪";
    try { localStorage.setItem("cube_sound", muted ? "off" : "on"); } catch (e) {}
  });
  soundBtn.setAttribute("aria-pressed", String(!muted));
  soundBtn.textContent = muted ? "♪̸" : "♪";

  // ---------------------------------------------------------------- render

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var vw = window.innerWidth, vh = window.innerHeight;
    canvas.width = Math.floor(vw * dpr);
    canvas.height = Math.floor(vh * dpr);
    canvas.style.width = vw + "px";
    canvas.style.height = vh + "px";
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  window.addEventListener("resize", resize);
  resize();

  function draw(dt) {
    var asp = canvas.width / Math.max(1, canvas.height);
    updateCamera(asp, dt);
    gl.uniformMatrix4fv(U.uProj, false, new Float32Array(mPerspective(FOV, asp, 0.1, 60)));
    gl.uniformMatrix4fv(U.uView, false, new Float32Array(mLookAt(curEye, center, upv)));
    gl.uniform3fv(U.uEye, new Float32Array(curEye));

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    var spin = null;
    if (anim) {
      var t = Math.min(1, anim.t / anim.dur);
      // ease so the turn snaps into place rather than arriving at constant speed
      var e = t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2) / 2;
      var axisV = [0,0,0]; axisV[anim.axis] = 1;
      spin = mAxisAngle(axisV, e * anim.dir * Math.PI / 2);
    }

    for (var i = 0; i < cubies.length; i++) {
      var c = cubies[i];
      var base = mMul(mTranslate(c.p[0]*CUBIE, c.p[1]*CUBIE, c.p[2]*CUBIE), m3To4(c.m));
      var model = base;
      if (spin && Math.abs(c.p[anim.axis] - anim.layer) < 1e-6) model = mMul(spin, base);
      drawMesh(meshBody, model, 0);

      // stickers: only the faces this cubie actually presents to the outside
      for (var f = 0; f < 6; f++) {
        var d = FACES[f];
        if (!onFace(c, d)) continue;
        var col = colourFacing(c, d);
        if (!col) continue;
        /* The sticker mesh lies on local +z, so rotate it onto the local face
         * that currently points at world direction d. */
        var local = m3ApplyT(c.m, d).map(Math.round);
        var rot = faceAlign(local);
        drawMesh(meshSticker, mMul(model, rot), 1, col);
      }
    }
  }

  // rotation taking local +z onto the given local axis direction
  var ALIGN = {};
  (function () {
    var z = [0,0,1];
    for (var f = 0; f < 6; f++) {
      var d = FACES[f];
      var axis = cross(z, d);
      var m;
      if (len3(axis) < 1e-6) {
        m = dot(z, d) > 0 ? mIdent() : mAxisAngle([0,1,0], Math.PI);
      } else {
        m = mAxisAngle(axis, Math.acos(clamp(dot(z, d), -1, 1)));
      }
      ALIGN[d.join(",")] = m;
    }
  })();
  function faceAlign(d) { return ALIGN[d.join(",")] || mIdent(); }

  // ------------------------------------------------------------------ loop

  var last = 0;
  function frame(ts) {
    var t = ts / 1000;
    var dt = last ? Math.min(0.05, t - last) : 0.016;
    last = t;
    stepAnim(dt);
    if (running) { elapsed = (performance.now() - startedAt) / 1000; setHud(); }
    // idle turntable behind the intro panel, so the cube is never a still life
    if (!overlay.hidden && !drag && !reduceMotion) az += dt * 0.24;
    draw(dt);
    requestAnimationFrame(frame);
  }

  loadBest();
  buildCube();
  sizeBtns.forEach(function (b) {
    var on = parseInt(b.dataset.size, 10) === N;
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-pressed", String(on));
  });
  setHud();
  setStatus();
  requestAnimationFrame(frame);
})();
