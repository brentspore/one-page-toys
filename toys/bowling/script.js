/* Bowling — real 3D in raw WebGL (no libraries, no build).
 *
 * Everything is modelled at true scale in metres, because bowling's feel comes
 * out of its real proportions: a 60ft lane, an 8.5in ball, 15in pins on 12in
 * centres. Get those wrong and no amount of tuning makes it read right.
 *
 * The hook is not faked. The ball is a rigid body with its own angular
 * velocity, and friction is computed from the velocity of the CONTACT POINT
 * (v + w x r), not the centre. Release it with a spin axis that is not aligned
 * with travel and the contact point is sliding sideways, so friction pushes it
 * sideways. The front 40ft of the lane is oiled (mu ~0.045) so it barely bites
 * and the ball skids nearly straight; the back 20ft is dry (mu ~0.20) so it
 * grips and turns. That is exactly how a real hook works.
 *
 * Pins are rigid bodies too. Each is a stack of collision spheres for
 * pin-vs-pin and ball-vs-pin, plus a ring of base-rim points tested against
 * the lane plane — the same vertex-vs-plane trick the dice roller uses. The
 * rim ring is what lets a pin stand flat and then tip over an edge; a capsule
 * would sit on a rounded cap and wobble. It matters because the ball only ever
 * touches about four pins: everything else is pins hitting each other.
 */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var gl = canvas.getContext("webgl", { antialias: true, alpha: false, premultipliedAlpha: false })
        || canvas.getContext("experimental-webgl", { antialias: true });
  if (!gl) {
    var f = document.createElement("p");
    f.textContent = "This toy needs WebGL. Try a different browser.";
    f.style.cssText = "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;font-family:monospace;color:#f2efe8;padding:24px;text-align:center";
    document.body.appendChild(f);
    return;
  }

  // ------------------------------------------------------------------ math

  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function scale3(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function len3(a) { return Math.sqrt(dot(a, a)); }
  function norm3(a) { var l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerp3(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }

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
  function mPerspective(fovy, asp, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return [f / asp,0,0,0, 0,f,0,0, 0,0,(far + near) * nf,-1, 0,0,2 * far * near * nf,0];
  }
  function mLookAt(eye, center, up) {
    var z = norm3(sub(eye, center)), x = norm3(cross(up, z)), y = cross(z, x);
    return [x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0,
            -dot(x,eye), -dot(y,eye), -dot(z,eye), 1];
  }
  // normal matrix — uniform scales only here, so the rotation block is enough
  function mNormal(m) { return [m[0],m[1],m[2], m[4],m[5],m[6], m[8],m[9],m[10]]; }

  function qIdent() { return [0, 0, 0, 1]; }
  function qMul(a, b) {
    return [
      a[3]*b[0] + a[0]*b[3] + a[1]*b[2] - a[2]*b[1],
      a[3]*b[1] - a[0]*b[2] + a[1]*b[3] + a[2]*b[0],
      a[3]*b[2] + a[0]*b[1] - a[1]*b[0] + a[2]*b[3],
      a[3]*b[3] - a[0]*b[0] - a[1]*b[1] - a[2]*b[2]
    ];
  }
  function qNorm(q) {
    var l = Math.sqrt(q[0]*q[0] + q[1]*q[1] + q[2]*q[2] + q[3]*q[3]) || 1;
    return [q[0]/l, q[1]/l, q[2]/l, q[3]/l];
  }
  function qRot(q, v) {
    var t = scale3(cross([q[0],q[1],q[2]], v), 2);
    return add(add(v, scale3(t, q[3])), cross([q[0],q[1],q[2]], t));
  }
  function qConj(q) { return [-q[0], -q[1], -q[2], q[3]]; }
  function qToMat(q) {
    var x=q[0],y=q[1],z=q[2],w=q[3];
    return [1-2*(y*y+z*z), 2*(x*y+z*w), 2*(x*z-y*w), 0,
            2*(x*y-z*w), 1-2*(x*x+z*z), 2*(y*z+x*w), 0,
            2*(x*z+y*w), 2*(y*z-x*w), 1-2*(x*x+y*y), 0,
            0,0,0,1];
  }
  function qIntegrate(q, w, dt) {
    var d = qMul([w[0]*dt*0.5, w[1]*dt*0.5, w[2]*dt*0.5, 0], q);
    return qNorm([q[0]+d[0], q[1]+d[1], q[2]+d[2], q[3]+d[3]]);
  }

  // ------------------------------------------------------------- constants

  var G = 9.81;
  var LANE_LEN = 18.29;         // foul line to head pin (60 ft)
  var LANE_HALF = 0.527;        // half of 41.5 in
  var GUTTER_W = 0.24;
  var DECK_END = LANE_LEN + 1.5;
  var OIL_END = 12.2;           // 40 ft of oil, then dry back end — this is the hook
  var MU_OIL = 0.045, MU_DRY = 0.205;

  var BALL_R = 0.1085, BALL_M = 6.8;
  var BALL_I = 0.4 * BALL_M * BALL_R * BALL_R;

  var PIN_H = 0.381, PIN_M = 1.53, PIN_COM = 0.145;
  var PIN_IXZ = PIN_M * (3 * 0.05 * 0.05 + PIN_H * PIN_H) / 12;
  var PIN_IY = PIN_M * 0.05 * 0.05 / 2;
  // collision spheres, local y measured from the centre of mass
  var PIN_SPHERES = [
    { y: -0.095, r: 0.049 }, { y: -0.030, r: 0.0605 }, { y: 0.040, r: 0.045 },
    { y: 0.110, r: 0.032 }, { y: 0.180, r: 0.038 }
  ];
  var PIN_RIM = [];
  for (var ri = 0; ri < 8; ri++) {
    var ra = (ri / 8) * Math.PI * 2;
    PIN_RIM.push([Math.cos(ra) * 0.0465, -PIN_COM, Math.sin(ra) * 0.0465]);
  }

  var SPACING = 0.3048, ROW_DZ = 0.264;
  var PIN_SPOTS = [
    [0, 0], [-SPACING / 2, ROW_DZ], [SPACING / 2, ROW_DZ],
    [-SPACING, 2 * ROW_DZ], [0, 2 * ROW_DZ], [SPACING, 2 * ROW_DZ],
    [-1.5 * SPACING, 3 * ROW_DZ], [-SPACING / 2, 3 * ROW_DZ],
    [SPACING / 2, 3 * ROW_DZ], [1.5 * SPACING, 3 * ROW_DZ]
  ];

  // ------------------------------------------------------------------ mesh

  function buildMesh(pos, nor, col) {
    var m = {
      pos: gl.createBuffer(), nor: gl.createBuffer(), col: gl.createBuffer(),
      n: pos.length / 3
    };
    gl.bindBuffer(gl.ARRAY_BUFFER, m.pos); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.nor); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(nor), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.col); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(col), gl.STATIC_DRAW);
    return m;
  }

  function sphereMesh(R, seg, ring, colFn) {
    var pos = [], nor = [], col = [];
    function vert(u, v) {
      var th = u * Math.PI * 2, ph = v * Math.PI;
      var n = [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)];
      pos.push(n[0] * R, n[1] * R, n[2] * R);
      nor.push(n[0], n[1], n[2]);
      var c = colFn ? colFn(u, v) : [1, 1, 1];
      col.push(c[0], c[1], c[2]);
    }
    for (var i = 0; i < seg; i++) for (var j = 0; j < ring; j++) {
      var u0 = i / seg, u1 = (i + 1) / seg, v0 = j / ring, v1 = (j + 1) / ring;
      vert(u0, v0); vert(u1, v0); vert(u1, v1);
      vert(u0, v0); vert(u1, v1); vert(u0, v1);
    }
    return buildMesh(pos, nor, col);
  }

  /* Pin silhouette as a surface of revolution. The belly/neck/head profile is
   * what makes a pin read as a pin from any angle. */
  var PIN_PROFILE = [
    [0.000, 0.0465], [0.018, 0.0482], [0.045, 0.0528], [0.080, 0.0588],
    [0.118, 0.0605], [0.155, 0.0566], [0.196, 0.0462], [0.234, 0.0356],
    [0.268, 0.0299], [0.298, 0.0332], [0.328, 0.0379], [0.352, 0.0349],
    [0.372, 0.0231], [0.381, 0.0000]
  ];
  function pinGeo(sub, seg) {
    var pos = [], nor = [], col = [];
    function shade(h) {
      // two red bands near the neck, like a real pin
      var band = (h > 0.276 && h < 0.298) || (h > 0.308 && h < 0.330);
      return band ? [0.80, 0.20, 0.17] : [0.95, 0.93, 0.89];
    }

    /* Smooth the profile before lathing, then give every ring a normal
     * averaged from the segments either side of it.
     *
     * The first pass used a flat normal per band, so each of the 14 profile
     * segments shaded as its own ring and the pin looked like a stack of
     * washers. Catmull-Rom resampling fixes the silhouette; per-vertex normals
     * fix the shading. Both are needed — either alone still reads as faceted. */
    function catmull(pts, sub) {
      var out = [];
      for (var i = 0; i < pts.length - 1; i++) {
        var p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1];
        var p3 = pts[Math.min(pts.length - 1, i + 2)];
        for (var j = 0; j < sub; j++) {
          var t = j / sub, t2 = t * t, t3 = t2 * t;
          out.push([
            0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2*p0[0] - 5*p1[0] + 4*p2[0] - p3[0]) * t2 + (-p0[0] + 3*p1[0] - 3*p2[0] + p3[0]) * t3),
            0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2*p0[1] - 5*p1[1] + 4*p2[1] - p3[1]) * t2 + (-p0[1] + 3*p1[1] - 3*p2[1] + p3[1]) * t3)
          ]);
        }
      }
      out.push(pts[pts.length - 1].slice());
      // the lathe cannot take a negative radius
      for (var k = 0; k < out.length; k++) if (out[k][1] < 0) out[k][1] = 0;
      return out;
    }

    var prof = catmull(PIN_PROFILE, sub);

    // per-profile-point normal in the (radius, height) plane
    var pn = [];
    for (var i2 = 0; i2 < prof.length; i2++) {
      var a2 = prof[Math.max(0, i2 - 1)], b2 = prof[Math.min(prof.length - 1, i2 + 1)];
      var dh = b2[0] - a2[0], dr = b2[1] - a2[1];
      var l = Math.sqrt(dh * dh + dr * dr) || 1;
      pn.push([dh / l, -dr / l]);            // [radial, vertical], outward
    }

    for (var i = 0; i < prof.length - 1; i++) {
      var a = prof[i], b = prof[i + 1], na = pn[i], nb = pn[i + 1];
      for (var s = 0; s < seg; s++) {
        var t0 = (s / seg) * Math.PI * 2, t1 = ((s + 1) / seg) * Math.PI * 2;
        var A0 = [a[1]*Math.cos(t0), a[0]-PIN_COM, a[1]*Math.sin(t0), t0, a[0], na];
        var B0 = [b[1]*Math.cos(t0), b[0]-PIN_COM, b[1]*Math.sin(t0), t0, b[0], nb];
        var B1 = [b[1]*Math.cos(t1), b[0]-PIN_COM, b[1]*Math.sin(t1), t1, b[0], nb];
        var A1 = [a[1]*Math.cos(t1), a[0]-PIN_COM, a[1]*Math.sin(t1), t1, a[0], na];
        var tri = [A0, B0, B1, A0, B1, A1];
        for (var k2 = 0; k2 < tri.length; k2++) {
          var q = tri[k2], nn = q[5];
          pos.push(q[0], q[1], q[2]);
          nor.push(nn[0] * Math.cos(q[3]), nn[1], nn[0] * Math.sin(q[3]));
          var c = shade(q[4]);
          col.push(c[0], c[1], c[2]);
        }
      }
    }

    /* Base disc, wound BOTH ways. A toppled pin gets looked at from every
     * angle, and a single-sided cap disappears the moment you see it from the
     * wrong side — the pin then reads as a hollow shell with no bottom. */
    for (var s2 = 0; s2 < seg; s2++) {
      var u0 = (s2 / seg) * Math.PI * 2, u1 = ((s2 + 1) / seg) * Math.PI * 2, rb = PIN_PROFILE[0][1];
      var out = [[0,0],[Math.cos(u1)*rb, Math.sin(u1)*rb],[Math.cos(u0)*rb, Math.sin(u0)*rb]];
      var back = [[0,0],[Math.cos(u0)*rb, Math.sin(u0)*rb],[Math.cos(u1)*rb, Math.sin(u1)*rb]];
      for (var t = 0; t < 3; t++) {
        pos.push(out[t][0], -PIN_COM, out[t][1]);
        nor.push(0, -1, 0);
        col.push(0.80, 0.78, 0.74);
      }
      for (var t2 = 0; t2 < 3; t2++) {
        pos.push(back[t2][0], -PIN_COM + 0.0008, back[t2][1]);
        nor.push(0, 1, 0);
        col.push(0.74, 0.72, 0.68);
      }
    }
    return { pos: pos, nor: nor, col: col };
  }
  function pinMesh(sub, seg) {
    var g = pinGeo(sub, seg);
    return buildMesh(g.pos, g.nor, g.col);
  }

  /* The lane is a single upward face, not a box. A box has a bottom, and the
   * mirrored reflection geometry lives below y=0 — the box floor would occlude
   * every reflection before it was ever drawn. */
  function planeMesh(sx, sz, c) {
    var hx = sx / 2, hz = sz / 2;
    // wound so the face normal is +y — the obvious ordering points it DOWN and
    // back-face culling then deletes the whole lane
    var pos = [-hx,0,-hz,  hx,0,hz,  hx,0,-hz,  -hx,0,-hz,  -hx,0,hz,  hx,0,hz];
    var nor = [], col = [];
    for (var i = 0; i < 6; i++) { nor.push(0,1,0); col.push(c[0], c[1], c[2]); }
    return buildMesh(pos, nor, col);
  }

  function boxGeo(sx, sy, sz, c) {
    var pos = [], nor = [], col = [];
    var faces = [
      [[ 1,0,0], [[1,-1,-1],[1,1,-1],[1,1,1],[1,-1,1]]],
      [[-1,0,0], [[-1,-1,1],[-1,1,1],[-1,1,-1],[-1,-1,-1]]],
      [[0, 1,0], [[-1,1,-1],[-1,1,1],[1,1,1],[1,1,-1]]],
      [[0,-1,0], [[-1,-1,1],[-1,-1,-1],[1,-1,-1],[1,-1,1]]],
      [[0,0, 1], [[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]],
      [[0,0,-1], [[-1,1,-1],[1,1,-1],[1,-1,-1],[-1,-1,-1]]]
    ];
    faces.forEach(function (fc) {
      var n = fc[0], v = fc[1], idx = [0, 1, 2, 0, 2, 3];
      for (var i = 0; i < 6; i++) {
        var p = v[idx[i]];
        pos.push(p[0] * sx / 2, p[1] * sy / 2, p[2] * sz / 2);
        nor.push(n[0], n[1], n[2]);
        col.push(c[0], c[1], c[2]);
      }
    });
    return { pos: pos, nor: nor, col: col };
  }
  function boxMesh(sx, sy, sz, c) {
    var g = boxGeo(sx, sy, sz, c);
    return buildMesh(g.pos, g.nor, g.col);
  }

  /* Bake several transformed copies into ONE buffer.
   *
   * Scenery is cheap in vertices and expensive in DRAW CALLS: forty background
   * pins and thirty light fixtures as individual draws cost ~100 buffer rebinds
   * a frame and took this from 66fps to 19. Baked, each rack or light row is a
   * single draw. */
  function bake(parts) {
    var pos = [], nor = [], col = [];
    parts.forEach(function (q) {
      var g = q.geo, t = q.at;
      for (var i = 0; i < g.pos.length; i += 3) {
        pos.push(g.pos[i] + t[0], g.pos[i + 1] + t[1], g.pos[i + 2] + t[2]);
        nor.push(g.nor[i], g.nor[i + 1], g.nor[i + 2]);
        col.push(g.col[i], g.col[i + 1], g.col[i + 2]);
      }
    });
    return buildMesh(pos, nor, col);
  }

  // --------------------------------------------------------------- shaders

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
    "uniform vec3 uEye;",
    "uniform int uMode;",       // 0 plain, 1 lane, 2 ball, 3 emissive
    "uniform float uAlpha;",
    "uniform float uOilEnd;",
    "uniform float uDim;",      // scales the result — background copies fade back
    "",
    "float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }",
    "",
    "void main(){",
    "  if (uMode == 3) { gl_FragColor = vec4(vC * uDim, uAlpha); return; }",
    "  vec3 N = normalize(vN);",
    "  vec3 V = normalize(uEye - vW);",
    // one raking key light down the lane, plus a cool fill so nothing goes flat black
    "  vec3 L1 = normalize(vec3(-0.35, 0.86, -0.38));",
    "  vec3 L2 = normalize(vec3(0.5, 0.35, 0.8));",
    "  vec3 base = vC;",
    "  float shine = 24.0; float spec = 0.35;",
    "",
    "  if (uMode == 1) {",
    /* Maple boards. The tone varies per BOARD and only drifts slowly down its
     * length — hashing per board per short z-slice instead makes a barcode. */
    "    float board = floor(vW.x / 0.0265);",
    "    float tone = hash(vec2(board, 3.0));",
    "    float drift = hash(vec2(board, floor(vW.z * 0.22)));",
    "    float seam = smoothstep(0.0, 0.10, abs(fract(vW.x / 0.0265) - 0.5));",
    "    base = mix(vec3(0.34, 0.215, 0.118), vec3(0.46, 0.305, 0.175), tone * 0.65 + drift * 0.35);",
    "    base *= 0.80 + 0.20 * seam;",
    "  } else if (uMode == 2) {",
    // ball: dark polished resin, wide highlight, rim light
    "    float f = pow(1.0 - max(dot(N, V), 0.0), 3.0);",
    "    base = mix(base, vec3(0.55, 0.62, 0.78), f * 0.55);",
    "    shine = 90.0; spec = 0.9;",
    "  }",
    "",
    "  float d1 = max(dot(N, L1), 0.0);",
    "  float d2 = max(dot(N, L2), 0.0);",
    "  vec3 diff = base * (0.24 + 0.90 * d1 + 0.26 * d2);",
    "  vec3 H1 = normalize(L1 + V);",
    "  float s1 = pow(max(dot(N, H1), 0.0), shine) * spec;",
    "  vec3 H2 = normalize(L2 + V);",
    "  float s2 = pow(max(dot(N, H2), 0.0), shine * 0.6) * spec * 0.35;",
    "  vec3 c = diff + vec3(1.0, 0.93, 0.82) * s1 + vec3(0.7, 0.8, 1.0) * s2;",
    "",
    /* Oil sheen. A point light over a flat plane gives one blown-out hotspot,
     * not a streak — what you actually see on a dressed lane is the long
     * reflection of the ceiling lights running down the boards. So draw that
     * directly: narrow across the lane, very soft along it, fading out where
     * the oil pattern ends. Static, because the ceiling lights are. */
    "  if (uMode == 1) {",
    "    float oil = 1.0 - smoothstep(uOilEnd - 5.0, uOilEnd + 2.0, vW.z);",
    "    float across = exp(-pow(vW.x / 0.20, 2.0));",
    "    float along = exp(-pow((vW.z - 6.5) / 7.5, 2.0));",
    "    c += vec3(1.0, 0.90, 0.76) * across * along * (0.06 + 0.20 * oil);",
    "    float across2 = exp(-pow((abs(vW.x) - 0.30) / 0.12, 2.0));",
    "    c += vec3(0.95, 0.86, 0.72) * across2 * along * 0.05 * oil;",
    "  }",
    // distance haze so the far end of the room falls away
    "  float fog = 1.0 - exp(-max(vW.z - 8.0, 0.0) * 0.020);",
    "  c = mix(c, vec3(0.045, 0.043, 0.062), clamp(fog, 0.0, 0.62));",
    "  gl_FragColor = vec4(c * uDim, uAlpha);",
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
  ["uProj","uView","uModel","uNorm","uEye","uMode","uAlpha","uOilEnd","uDim"].forEach(function (n) {
    U[n] = gl.getUniformLocation(prog, n);
  });

  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.clearColor(0.027, 0.027, 0.043, 1);

  // ---------------------------------------------------------------- meshes

  var meshBall = sphereMesh(BALL_R, 30, 18, function (u, v) {
    // a swirl in the resin so the ball's spin is legible as it rolls
    var s = Math.sin(u * Math.PI * 4 + v * 5.0) * 0.5 + 0.5;
    return [0.06 + 0.10 * s, 0.07 + 0.05 * s, 0.16 + 0.16 * s];
  });
  var meshPin = pinMesh(3, 22);
  // one draw per background rack instead of ten
  var pinLowGeo = pinGeo(1, 12);
  var meshPinRack = bake(PIN_SPOTS.map(function (sp) {
    return { geo: pinLowGeo, at: [sp[0], PIN_COM, LANE_LEN + sp[1]] };
  }));
  var meshLane = planeMesh(LANE_HALF * 2, DECK_END + 1.3, [0.36, 0.23, 0.13]);
  var meshLaneFlat = planeMesh(LANE_HALF * 2, DECK_END + 1.3, [0.30, 0.195, 0.115]);
  var LEN = DECK_END + 2.6;
  var meshGutterFloor = boxMesh(GUTTER_W, 0.02, LEN, [0.135, 0.140, 0.170]);
  var meshGutterWall  = boxMesh(0.030, 0.150, LEN, [0.095, 0.100, 0.125]);
  var meshLaneCap     = boxMesh(0.038, 0.030, LEN, [0.30, 0.215, 0.135]);
  var meshWall = boxMesh(13.0, 3.9, 0.3, [0.052, 0.050, 0.066]);
  var meshSide = boxMesh(0.3, 1.2, DECK_END + 2.6, [0.05, 0.05, 0.068]);
  var meshDeck = boxMesh(LANE_HALF * 2 + GUTTER_W * 2, 0.1, 1.2, [0.10, 0.10, 0.13]);
  var meshMarker = boxMesh(0.045, 0.006, 0.30, [0.55, 0.40, 0.20]);

  /* Aim guide — a ribbon rebuilt every frame while you are holding the ball.
   *
   * It is produced by running the SAME friction model the throw uses, not an
   * approximation, so the line you are shown cannot disagree with the ball you
   * get. Without it the hook is invisible until after you have committed. */
  var guide = { pos: gl.createBuffer(), nor: gl.createBuffer(), col: gl.createBuffer(), n: 0 };

  function predictPath(x0, power, spin) {
    var p = [x0, BALL_R, 0], v = [0, 0, power];
    var roll = power / BALL_R;
    var w = [-roll * 0.94, spin * 0.18, -spin];
    var dt = 1 / 120, pts = [[x0, 0]];
    for (var i = 0; i < 1200; i++) {
      var r = [0, -BALL_R, 0];
      var vc = add(v, cross(w, r));
      var vch = [vc[0], 0, vc[2]];
      var sp = len3(vch);
      if (sp > 1e-4) {
        var mu = laneMu(p[2]);
        var fdir = scale3(vch, -1 / sp);
        var maxJ = sp / (1 / BALL_M + (BALL_R * BALL_R) / BALL_I);
        var imp = scale3(fdir, Math.min(mu * BALL_M * G * dt, maxJ));
        v = add(v, scale3(imp, 1 / BALL_M));
        w = add(w, scale3(cross(r, imp), 1 / BALL_I));
      }
      v = scale3(v, 1 - 0.02 * dt);
      w = scale3(w, 1 - 0.05 * dt);
      p = add(p, scale3(v, dt));
      if (i % 5 === 0) pts.push([p[0], p[2]]);
      if (p[2] >= LANE_LEN || Math.abs(p[0]) > GUTTER_EDGE) break;
    }
    return pts;
  }

  function buildGuide(pts) {
    var pos = [], nor = [], col = [];
    var HW = 0.020;
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1];
      var dx = b[0] - a[0], dz = b[1] - a[1];
      var l = Math.sqrt(dx * dx + dz * dz) || 1;
      var nx = (-dz / l) * HW, nz = (dx / l) * HW;
      var t = i / (pts.length - 1);
      // fade down the lane so it guides without becoming the brightest thing
      var f = (1 - t * 0.72) * (0.55 + 0.45 * Math.max(0, Math.sin(t * 22)));
      var c = [0.95 * f, 0.72 * f, 0.34 * f];
      // wound for a +y normal — the same trap that deleted the lane plane
      // earlier: get this backwards and back-face culling silently eats it
      var q = [
        [a[0] - nx, a[1] - nz], [b[0] + nx, b[1] + nz], [b[0] - nx, b[1] - nz],
        [a[0] - nx, a[1] - nz], [a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz]
      ];
      for (var k = 0; k < 6; k++) {
        pos.push(q[k][0], 0.006, q[k][1]);
        nor.push(0, 1, 0);
        col.push(c[0], c[1], c[2]);
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, guide.pos); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, guide.nor); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(nor), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, guide.col); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(col), gl.DYNAMIC_DRAW);
    guide.n = pos.length / 3;
  }
  /* Scenery. The room was a black void with one lane in it — these are what
   * make it read as an alley: lanes either side receding into haze, the lit
   * masking unit that sits above every pin deck, and a row of ceiling fixtures
   * that finally give the lane's oil sheen something to be a reflection OF. */
  var meshDivider   = boxMesh(0.10, 0.26, LEN, [0.085, 0.085, 0.105]);
  var meshMask      = boxMesh(LANE_HALF * 2 + GUTTER_W * 2, 1.85, 0.12, [0.145, 0.118, 0.105]);
  var meshMaskGlow  = boxMesh(LANE_HALF * 2 + GUTTER_W * 2 - 0.08, 0.10, 0.05, [0.78, 0.52, 0.28]);
  var meshCeiling   = boxMesh(15.0, 0.20, LEN + 3.0, [0.030, 0.030, 0.042]);
  var meshFixture   = boxMesh(1.35, 0.05, 0.16, [0.95, 0.82, 0.62]);
  var meshFixHous   = boxMesh(1.50, 0.14, 0.26, [0.055, 0.055, 0.070]);
  var meshBackGlow  = boxMesh(11.0, 0.75, 0.05, [0.19, 0.12, 0.085]);
  // the whole receding row of ceiling fixtures, baked: housings and lamps
  var fixHousGeo = boxGeo(1.50, 0.14, 0.26, [0.055, 0.055, 0.070]);
  var fixLampGeo = boxGeo(1.35, 0.05, 0.16, [0.95, 0.82, 0.62]);
  var lightZ = [];
  for (var lzi = 1.5; lzi < DECK_END; lzi += 3.6) lightZ.push(lzi);
  var meshLightHous = bake(lightZ.map(function (z) { return { geo: fixHousGeo, at: [0, 3.42, z] }; }));
  var meshLightLamp = bake(lightZ.map(function (z) { return { geo: fixLampGeo, at: [0, 3.36, z] }; }));

  function drawMesh(m, model, mode, alpha, dim) {
    gl.bindBuffer(gl.ARRAY_BUFFER, m.pos);
    gl.enableVertexAttribArray(A.pos); gl.vertexAttribPointer(A.pos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.nor);
    gl.enableVertexAttribArray(A.nor); gl.vertexAttribPointer(A.nor, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.col);
    gl.enableVertexAttribArray(A.col); gl.vertexAttribPointer(A.col, 3, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(U.uModel, false, new Float32Array(model));
    gl.uniformMatrix3fv(U.uNorm, false, new Float32Array(mNormal(model)));
    gl.uniform1i(U.uMode, mode || 0);
    gl.uniform1f(U.uAlpha, alpha === undefined ? 1 : alpha);
    gl.uniform1f(U.uDim, dim === undefined ? 1 : dim);
    gl.drawArrays(gl.TRIANGLES, 0, m.n);
  }

  // ---------------------------------------------------------------- bodies

  function makePin(i) {
    return {
      idx: i,
      p: [PIN_SPOTS[i][0], PIN_COM, LANE_LEN + PIN_SPOTS[i][1]],
      q: qIdent(), v: [0, 0, 0], w: [0, 0, 0],
      down: false, gone: false, sleep: 0, downT: 0, fade: 1, inPit: false
    };
  }
  var pins = [];
  var ball = {
    p: [0, BALL_R, 0], v: [0, 0, 0], q: qIdent(), w: [0, 0, 0],
    rolling: false, gutter: false, done: false
  };

  function pinWorld(pin, local) { return add(pin.p, qRot(pin.q, local)); }

  /* Inverse inertia in world space for a pin: R * I^-1 * R^T applied to a
   * vector. Pins are near-symmetric so a diagonal body-space tensor is fine. */
  function pinInvInertiaApply(pin, v) {
    var lv = qRot(qConj(pin.q), v);
    var out = [lv[0] / PIN_IXZ, lv[1] / PIN_IY, lv[2] / PIN_IXZ];
    return qRot(pin.q, out);
  }
  function pinVelAt(pin, r) { return add(pin.v, cross(pin.w, r)); }
  function pinApply(pin, imp, r) {
    pin.v = add(pin.v, scale3(imp, 1 / PIN_M));
    pin.w = add(pin.w, pinInvInertiaApply(pin, cross(r, imp)));
  }

  function ballVelAt(r) { return add(ball.v, cross(ball.w, r)); }
  function ballApply(imp, r) {
    ball.v = add(ball.v, scale3(imp, 1 / BALL_M));
    ball.w = add(ball.w, scale3(cross(r, imp), 1 / BALL_I));
  }

  // --------------------------------------------------------------- physics

  var pendingHits = [];   // {kind, speed} drained by the audio layer each frame

  function laneMu(z) {
    var t = clamp((z - (OIL_END - 2.5)) / 4.0, 0, 1);
    return lerp(MU_OIL, MU_DRY, t * t);
  }

  function stepBall(dt) {
    if (ball.done) return;
    ball.v[1] -= G * dt;

    if (ball.gutter) {
      // in the channel: no more steering, just run it out
      ball.p = add(ball.p, scale3(ball.v, dt));
      var gx = (ball.p[0] < 0 ? -1 : 1) * (LANE_HALF + GUTTER_W * 0.5);
      ball.p[0] += (gx - ball.p[0]) * Math.min(1, dt * 8);
      if (ball.p[1] < -0.02) { ball.p[1] = -0.02; ball.v[1] = 0; }
      ball.q = qIntegrate(ball.q, ball.w, dt);
      if (ball.p[2] > DECK_END) ball.done = true;
      return;
    }

    // leaving the lane edge drops it in the gutter
    if (Math.abs(ball.p[0]) > GUTTER_EDGE && !ball.gutter) {
      ball.gutter = true;
      ball.v[1] = -0.7;
      ball.w = scale3(ball.w, 0.4);
      pendingHits.push({ kind: "gutter", speed: len3(ball.v) });
    }

    if (ball.p[1] <= BALL_R + 1e-4) {
      ball.p[1] = BALL_R;
      if (ball.v[1] < 0) ball.v[1] = 0;

      // Friction from the CONTACT POINT's velocity — this is the hook.
      var r = [0, -BALL_R, 0];
      var vc = ballVelAt(r);
      var vch = [vc[0], 0, vc[2]];
      var sp = len3(vch);
      var mu = laneMu(ball.p[2]);
      if (sp > 1e-4) {
        var fdir = scale3(vch, -1 / sp);
        var jmag = mu * BALL_M * G * dt;
        // never reverse the slide within one step
        var maxJ = sp / (1 / BALL_M + (BALL_R * BALL_R) / BALL_I);
        var imp = scale3(fdir, Math.min(jmag, maxJ));
        ballApply(imp, r);
      }
      // rolling resistance so a ball that reaches the pit does settle
      ball.v = scale3(ball.v, 1 - 0.02 * dt);
      ball.w = scale3(ball.w, 1 - 0.05 * dt);
    }

    ball.p = add(ball.p, scale3(ball.v, dt));
    ball.q = qIntegrate(ball.q, ball.w, dt);
    if (ball.p[2] > DECK_END + 0.6) ball.done = true;
  }

  function resolveContact(bodyA, bodyB, rA, rB, n, pen, e, mu) {
    // bodyA/bodyB: null means the immovable lane
    var vA = bodyA ? (bodyA === ball ? ballVelAt(rA) : pinVelAt(bodyA, rA)) : [0,0,0];
    var vB = bodyB ? (bodyB === ball ? ballVelAt(rB) : pinVelAt(bodyB, rB)) : [0,0,0];
    var vrel = sub(vB, vA);
    var vn = dot(vrel, n);
    if (vn > 0) return 0;

    function invMassTerm(body, r) {
      if (!body) return 0;
      if (body === ball) {
        var c = cross(r, n);
        return 1 / BALL_M + dot(cross(scale3(c, 1 / BALL_I), r), n);
      }
      var cc = cross(r, n);
      return 1 / PIN_M + dot(cross(pinInvInertiaApply(body, cc), r), n);
    }
    var k = invMassTerm(bodyA, rA) + invMassTerm(bodyB, rB);
    if (k <= 0) return 0;

    var j = -(1 + e) * vn / k;
    var imp = scale3(n, j);
    if (bodyA) { if (bodyA === ball) ballApply(scale3(imp, -1), rA); else pinApply(bodyA, scale3(imp, -1), rA); }
    if (bodyB) { if (bodyB === ball) ballApply(imp, rB); else pinApply(bodyB, imp, rB); }

    // Coulomb friction along the tangent
    var vt = sub(vrel, scale3(n, vn));
    var vtl = len3(vt);
    if (vtl > 1e-5) {
      var t = scale3(vt, 1 / vtl);
      function invMassT(body, r) {
        if (!body) return 0;
        if (body === ball) {
          var c = cross(r, t);
          return 1 / BALL_M + dot(cross(scale3(c, 1 / BALL_I), r), t);
        }
        var cc = cross(r, t);
        return 1 / PIN_M + dot(cross(pinInvInertiaApply(body, cc), r), t);
      }
      var kt = invMassT(bodyA, rA) + invMassT(bodyB, rB);
      if (kt > 0) {
        var jt = clamp(-vtl / kt, -mu * j, mu * j);
        var impT = scale3(t, jt);
        if (bodyA) { if (bodyA === ball) ballApply(scale3(impT, -1), rA); else pinApply(bodyA, scale3(impT, -1), rA); }
        if (bodyB) { if (bodyB === ball) ballApply(impT, rB); else pinApply(bodyB, impT, rB); }
      }
    }

    // positional correction, so stacks do not sink into each other
    if (pen > 0.0008) {
      var corr = scale3(n, (pen - 0.0008) * 0.42);
      if (bodyA && bodyB) {
        if (bodyA !== ball) bodyA.p = sub(bodyA.p, scale3(corr, 0.5));
        if (bodyB !== ball) bodyB.p = add(bodyB.p, scale3(corr, 0.5));
      } else if (bodyB) {
        if (bodyB !== ball) bodyB.p = add(bodyB.p, corr);
      }
    }
    return Math.abs(j);
  }

  function stepPins(dt) {
    var i, k;
    for (i = 0; i < pins.length; i++) {
      var pn = pins[i];
      if (pn.gone) continue;
      pn.v[1] -= G * dt;
      pn.p = add(pn.p, scale3(pn.v, dt));
      pn.q = qIntegrate(pn.q, pn.w, dt);
      pn.v = scale3(pn.v, 1 - 0.05 * dt);
      pn.w = scale3(pn.w, 1 - 0.14 * dt);
    }

    for (var iter = 0; iter < 4; iter++) {
      // pin base rim vs lane
      for (i = 0; i < pins.length; i++) {
        var p1 = pins[i];
        if (p1.gone) continue;
        var onDeck = Math.abs(p1.p[0]) < LANE_HALF + GUTTER_W && p1.p[2] < DECK_END;
        if (!onDeck) continue;
        for (k = 0; k < PIN_RIM.length; k++) {
          var wp = pinWorld(p1, PIN_RIM[k]);
          if (wp[1] < 0) {
            var r = sub(wp, p1.p);
            var jj = resolveContact(null, p1, [0,0,0], r, [0,1,0], -wp[1], 0.10, 0.34);
            if (jj > 0.9 && iter === 0) pendingHits.push({ kind: "wood", speed: jj * 0.25 });
          }
        }
        // also catch the body if a pin lies flat
        for (k = 0; k < PIN_SPHERES.length; k++) {
          var sc = pinWorld(p1, [0, PIN_SPHERES[k].y, 0]);
          var pen = PIN_SPHERES[k].r - sc[1];
          if (pen > 0) {
            var rr = sub([sc[0], 0, sc[2]], p1.p);
            resolveContact(null, p1, [0,0,0], rr, [0,1,0], pen, 0.08, 0.26);
          }
        }
      }

      // pin vs pin
      for (i = 0; i < pins.length; i++) {
        var a = pins[i];
        if (a.gone) continue;
        for (var jdx = i + 1; jdx < pins.length; jdx++) {
          var b = pins[jdx];
          if (b.gone) continue;
          if (len3(sub(a.p, b.p)) > 0.45) continue;    // cheap broad phase
          for (var sa = 0; sa < PIN_SPHERES.length; sa++) {
            for (var sb = 0; sb < PIN_SPHERES.length; sb++) {
              var ca = pinWorld(a, [0, PIN_SPHERES[sa].y, 0]);
              var cb = pinWorld(b, [0, PIN_SPHERES[sb].y, 0]);
              var d = sub(cb, ca), dl = len3(d);
              var rsum = PIN_SPHERES[sa].r + PIN_SPHERES[sb].r;
              if (dl < rsum && dl > 1e-6) {
                var n = scale3(d, 1 / dl);
                var j2 = resolveContact(a, b, sub(ca, a.p), sub(cb, b.p), n, rsum - dl, 0.44, 0.14);
                if (j2 > 0.6 && iter === 0) pendingHits.push({ kind: "clack", speed: j2 * 0.4 });
              }
            }
          }
        }
      }

      // ball vs pins
      if (!ball.done) {
        for (i = 0; i < pins.length; i++) {
          var pb = pins[i];
          if (pb.gone) continue;
          if (len3(sub(ball.p, pb.p)) > 0.55) continue;
          for (var sc2 = 0; sc2 < PIN_SPHERES.length; sc2++) {
            var cp = pinWorld(pb, [0, PIN_SPHERES[sc2].y, 0]);
            var dd = sub(cp, ball.p), ddl = len3(dd);
            var rs = BALL_R + PIN_SPHERES[sc2].r;
            if (ddl < rs && ddl > 1e-6) {
              var nn = scale3(dd, 1 / ddl);
              var j3 = resolveContact(ball, pb, scale3(nn, BALL_R), sub(cp, pb.p), nn, rs - ddl, 0.46, 0.12);
              if (j3 > 1.2 && iter === 0) pendingHits.push({ kind: "crash", speed: j3 * 0.22 });
            }
          }
        }
      }
    }

    /* Hard floor clamp.
     *
     * The impulse solver alone was not enough: measured across an impact, pins
     * took well over a thousand ground contacts and STILL sank through the
     * lane and out of the world, because once a fast pin penetrates deeply a
     * sequential-impulse pass cannot recover it inside one step. Pins fell
     * through instead of carrying into the 7 and 10, which is exactly why a
     * strike was impossible.
     *
     * So the floor is enforced positionally as well: find the lowest point on
     * the pin, and if it is under the deck, lift the pin out and kill the
     * downward velocity. Projection like this cannot be out-run by any impact
     * speed, which makes fall-through structurally impossible rather than
     * merely unlikely. The solver still does the interesting work — toppling,
     * friction, pin-to-pin transfer. */
    for (i = 0; i < pins.length; i++) {
      var pc = pins[i];
      if (pc.gone) continue;
      /* Once a pin has left the deck it is in the pit for good.
       *
       * Latching this matters: without it a pin that fell into the pit could be
       * nudged back inside the boundary by a later contact, and the clamp would
       * then find it half a metre under the floor and haul it out at 0.035m per
       * STEP — 8 m/s of pure position. That is the pin that flew up when it got
       * knocked to the back. A pit pin is out of play, so retire it instead. */
      if (pc.inPit) continue;
      if (Math.abs(pc.p[0]) > LANE_HALF + GUTTER_W || pc.p[2] > DECK_END || pc.p[1] < -0.28) {
        pc.inPit = true;
        pc.down = true;
        pc.downT = 1;          // no lingering: fade it out from here
        continue;
      }
      var lowest = Infinity;
      for (k = 0; k < PIN_RIM.length; k++) {
        var rp = pinWorld(pc, PIN_RIM[k]);
        if (rp[1] < lowest) lowest = rp[1];
      }
      for (k = 0; k < PIN_SPHERES.length; k++) {
        var sp2 = pinWorld(pc, [0, PIN_SPHERES[k].y, 0]);
        var bot = sp2[1] - PIN_SPHERES[k].r;
        if (bot < lowest) lowest = bot;
      }
      if (lowest < 0) {
        /* Lift out of the deck, but NEVER add energy doing it. Reversing the
         * downward velocity here (even at 12%) stacked on top of the impulse
         * solver's own bounce, and a deep penetration teleported the pin
         * upward — which is how a fallen pin ended up launching into the sky.
         * Zero the descent instead, and recover deep overlap over a few steps
         * rather than in one jump. */
        pc.p[1] -= Math.max(lowest, -0.035);
        if (pc.v[1] < 0) pc.v[1] = 0;
      }
    }

    // Safety net: nothing on a pin deck moves at 18 m/s. If the solver ever
    // does blow up, clamp it rather than let a pin exit the building.
    for (i = 0; i < pins.length; i++) {
      var pv = pins[i];
      if (pv.gone) continue;
      var sp3 = len3(pv.v);
      if (sp3 > 18) pv.v = scale3(pv.v, 18 / sp3);
      /* Cap UPWARD velocity only. Pins genuinely get air off a hard pocket hit,
       * but a solver spike sending one two feet up reads as a bug rather than
       * as bowling. 3.1 m/s tops out around half a metre of rise. Horizontal
       * speed is deliberately untouched — that is the carry into the 7 and 10. */
      if (pv.v[1] > 3.1) pv.v[1] = 3.1;
      var sw = len3(pv.w);
      if (sw > 42) pv.w = scale3(pv.w, 42 / sw);
    }

    // bookkeeping: a pin counts as down once it has tipped or left the spot
    for (i = 0; i < pins.length; i++) {
      var pp = pins[i];
      if (pp.gone) continue;
      var up = qRot(pp.q, [0, 1, 0]);
      var tipped = up[1] < 0.72;
      var moved = Math.abs(pp.p[0] - PIN_SPOTS[pp.idx][0]) > 0.075 ||
                  Math.abs(pp.p[2] - (LANE_LEN + PIN_SPOTS[pp.idx][1])) > 0.075;
      if (tipped || moved) pp.down = true;
      /* Sweep settled pins. A pin that has already fallen adds nothing once it
       * stops, and getting punted around by later contacts is what looked bad
       * — so fade it out and retire it, the way a real sweeper clears the deck.
       * Scoring is unaffected: down and gone both count as knocked. */
      if (pp.down) {
        if (len3(pp.v) < 0.45 && len3(pp.w) < 2.2) pp.downT += dt; else pp.downT = 0;
        if (pp.downT > 0.45) {
          pp.fade -= dt / 0.4;
          if (pp.fade <= 0) { pp.fade = 0; pp.gone = true; }
        }
      }
      if (pp.p[1] < -1.5 || pp.p[2] > DECK_END + 1.2) pp.gone = true;
      if (Math.abs(pp.p[0]) > LANE_HALF + GUTTER_W + 0.1 && pp.p[1] < 0.05) {
        pp.v[1] -= G * dt * 2;   // slides off into the channel
      }
    }
  }

  function settled() {
    if (!ball.done && ball.p[2] < DECK_END - 0.2) {
      if (len3(ball.v) > 0.35) return false;
    }
    for (var i = 0; i < pins.length; i++) {
      var p = pins[i];
      if (p.gone) continue;
      if (len3(p.v) > 0.14 || len3(p.w) > 0.7) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ game

  var BEST_KEY = "bowling_best";
  var SOUND_KEY = "bowling_sound";

  var frames = [];        // each: {rolls: [n,...], score: null}
  var frameIdx = 0, rollIdx = 0;
  var phase = "idle";     // idle | aim | rolling | resolving | over
  var standingAtFrameStart = 10;
  var settleT = 0;

  var sheetEl = document.getElementById("sheet");
  var sheetFrames = document.getElementById("sheetFrames");
  var sheetTotal = document.getElementById("sheetTotal");
  var hudEl = document.getElementById("hud");
  var frameNoEl = document.getElementById("frameNo");
  var bestEl = document.getElementById("best");
  var calloutEl = document.getElementById("callout");
  var overlay = document.getElementById("overlay");
  var ovTitle = document.getElementById("ovTitle");
  var ovText = document.getElementById("ovText");
  var ovBtn = document.getElementById("ovBtn");
  var ovEyebrow = document.getElementById("ovEyebrow");
  var ovKeys = document.getElementById("ovKeys");
  var hintEl = document.getElementById("hint");
  var soundBtn = document.getElementById("soundBtn");

  function best() { var v = parseInt(localStorage.getItem(BEST_KEY) || "0", 10); return isFinite(v) ? v : 0; }
  function setBest(v) { try { localStorage.setItem(BEST_KEY, String(v)); } catch (e) {} }

  function newGame() {
    frames = [];
    for (var i = 0; i < 10; i++) frames.push({ rolls: [], score: null });
    frameIdx = 0; rollIdx = 0;
    keyAim = 0; keySpin = 0;      // a new game starts from the middle
    rackPins(true);
    resetBall();
    phase = "aim";
    overlay.hidden = true;
    sheetEl.hidden = false;
    hudEl.hidden = false;
    bestEl.textContent = best() || "—";
    renderSheet();
  }

  function rackPins(full) {
    pins = [];
    for (var i = 0; i < 10; i++) pins.push(makePin(i));
    standingAtFrameStart = 10;
  }

  function reRackStanding() {
    // second ball of a frame: clear the deck, leave the standing pins
    var keep = [];
    for (var i = 0; i < pins.length; i++) if (!pins[i].down && !pins[i].gone) keep.push(pins[i].idx);
    pins = [];
    for (var k = 0; k < keep.length; k++) pins.push(makePin(keep[k]));
    standingAtFrameStart = keep.length;
  }

  function resetBall() {
    ball.p = [aim.x, BALL_R, 0];
    ball.v = [0, 0, 0]; ball.w = [0, 0, 0]; ball.q = qIdent();
    ball.rolling = false; ball.gutter = false; ball.done = false;
  }

  function knockedThisRoll() {
    var n = 0;
    for (var i = 0; i < pins.length; i++) if (pins[i].down || pins[i].gone) n++;
    return n;
  }

  /* Standard scoring. A strike takes the next two rolls, a spare the next one,
   * and the tenth frame gets its bonus rolls appended in place. */
  function computeScores() {
    var flat = [];
    for (var i = 0; i < 10; i++) for (var j = 0; j < frames[i].rolls.length; j++) flat.push({ f: i, v: frames[i].rolls[j] });
    var total = 0, ptr = 0;
    for (var f = 0; f < 10; f++) {
      var fr = frames[f];
      if (!fr.rolls.length) { fr.score = null; continue; }
      var start = ptr;
      var isStrike = fr.rolls[0] === 10 && f < 9;
      var isSpare = !isStrike && fr.rolls.length >= 2 && fr.rolls[0] + fr.rolls[1] === 10 && f < 9;
      var need, sum;
      if (f === 9) {
        sum = fr.rolls.reduce(function (a, c) { return a + c; }, 0);
        var complete = fr.rolls.length === 3 ||
          (fr.rolls.length === 2 && fr.rolls[0] + fr.rolls[1] < 10);
        if (!complete) { fr.score = null; ptr = start + fr.rolls.length; continue; }
        total += sum; fr.score = total; ptr = start + fr.rolls.length; continue;
      }
      if (isStrike) { need = 2; sum = 10; ptr = start + 1; }
      else if (isSpare) { need = 1; sum = 10; ptr = start + 2; }
      else {
        if (fr.rolls.length < 2) { fr.score = null; ptr = start + fr.rolls.length; continue; }
        need = 0; sum = fr.rolls[0] + fr.rolls[1]; ptr = start + 2;
      }
      var have = 0, bonus = 0;
      for (var q = ptr; q < flat.length && have < need; q++) { bonus += flat[q].v; have++; }
      if (have < need) { fr.score = null; continue; }
      total += sum + bonus;
      fr.score = total;
    }
    return total;
  }

  function rollMark(f, idx, v) {
    if (v === null || v === undefined) return "";
    var fr = frames[f];
    if (f < 9) {
      if (idx === 0) return v === 10 ? "X" : (v === 0 ? "-" : String(v));
      return (fr.rolls[0] + v === 10) ? "/" : (v === 0 ? "-" : String(v));
    }
    // tenth frame: each roll can be a strike, and a spare is relative to the pair
    if (idx === 0) return v === 10 ? "X" : (v === 0 ? "-" : String(v));
    if (idx === 1) {
      if (fr.rolls[0] === 10) return v === 10 ? "X" : (v === 0 ? "-" : String(v));
      return (fr.rolls[0] + v === 10) ? "/" : (v === 0 ? "-" : String(v));
    }
    if (fr.rolls[1] === 10 || fr.rolls[0] + fr.rolls[1] === 10) {
      return v === 10 ? "X" : (v === 0 ? "-" : String(v));
    }
    return v === 10 ? "X" : (v === 0 ? "-" : String(v));
  }

  function renderSheet() {
    var total = computeScores();
    sheetFrames.textContent = "";
    for (var f = 0; f < 10; f++) {
      var d = document.createElement("div");
      d.className = "fr" + (f === frameIdx && phase !== "over" ? " is-on" : "");
      var rolls = document.createElement("div");
      rolls.className = "fr__rolls";
      var slots = f === 9 ? 3 : 2;
      for (var s = 0; s < slots; s++) {
        var sp = document.createElement("span");
        var val = frames[f].rolls[s];
        var mark = rollMark(f, s, val);
        sp.className = "fr__r" + (mark === "" ? " is-empty" : "");
        sp.textContent = mark || "·";
        rolls.appendChild(sp);
      }
      var sum = document.createElement("div");
      sum.className = "fr__sum" + (frames[f].score !== null ? " is-set" : "");
      sum.textContent = frames[f].score !== null ? frames[f].score : "";
      d.appendChild(rolls); d.appendChild(sum);
      sheetFrames.appendChild(d);
    }
    sheetTotal.textContent = total;
    frameNoEl.textContent = Math.min(frameIdx + 1, 10);
    return total;
  }

  function showCallout(txt) {
    calloutEl.hidden = false;
    calloutEl.textContent = txt;
    calloutEl.classList.remove("is-in");
    void calloutEl.offsetWidth;
    calloutEl.classList.add("is-in");
  }

  function finishRoll() {
    var down = knockedThisRoll();
    var fr = frames[frameIdx];
    var pinsBefore = standingAtFrameStart;
    var scored = Math.min(down, pinsBefore);
    fr.rolls.push(scored);

    var isTenth = frameIdx === 9;
    var strike = scored === 10 && fr.rolls.length === 1 && pinsBefore === 10;
    var spare = !strike && pinsBefore - scored === 0 && fr.rolls.length >= 2;

    if (strike) { showCallout("STRIKE"); audio.fanfare(true); }
    else if (spare) { showCallout("SPARE"); audio.fanfare(false); }
    else if (ball.gutter && scored === 0) showCallout("GUTTER");

    var advance = false;
    if (isTenth) {
      var r = fr.rolls;
      if (r.length === 3) advance = true;
      else if (r.length === 2 && r[0] + r[1] < 10 && r[0] !== 10) advance = true;
      else {
        // another ball in the tenth; re-rack when the deck is cleared
        if (r[0] === 10 || (r.length === 2 && (r[0] + r[1] >= 10))) rackPins(true);
        else reRackStanding();
      }
    } else if (strike || fr.rolls.length === 2) {
      advance = true;
    } else {
      reRackStanding();
    }

    if (advance) {
      frameIdx++;
      if (frameIdx >= 10) { endGame(); return; }
      rackPins(true);
    }
    resetBall();
    phase = "aim";
    renderSheet();
  }

  function endGame() {
    phase = "over";
    var total = renderSheet();
    var isPb = total > best();
    if (isPb) setBest(total);
    bestEl.textContent = best();

    ovEyebrow.textContent = isPb ? "New personal best" : "Game over";
    ovTitle.textContent = total;
    ovText.innerHTML = summaryFor(total) +
      (isPb ? "" : " Your best is <b>" + best() + "</b>.");
    ovBtn.textContent = "Bowl again";
    ovKeys.textContent = "space or tap to start a new game";
    overlay.hidden = false;

    // No direct OPT_TICKETS.award() here on purpose: `bowling_best` carries a
    // rule in tickets.js, and paying both would double-count (see the Skee Ball
    // note in that file).
    try {
      if (typeof window.gtag === "function") window.gtag("event", "toy_complete", { toy: "bowling", value: total });
    } catch (e) {}
  }

  function summaryFor(t) {
    if (t === 300) return "A perfect game. Twelve strikes.";
    if (t >= 200) return "Two hundred. That is a serious game.";
    if (t >= 150) return "Well above a league average.";
    if (t >= 120) return "A solid game — the pocket is working.";
    if (t >= 80) return "Getting there. Watch where the ball starts to grip.";
    return "Try starting wider and letting the hook bring it back.";
  }

  // ----------------------------------------------------------------- audio

  var audio = (function () {
    var ctx = null, bus = null, comp = null, verb = null, out = null;
    var on = localStorage.getItem(SOUND_KEY) !== "0";
    var rollSrc = null, rollGain = null, rollFilt = null;

    function impulse(sec, decay) {
      var rate = ctx.sampleRate, n = Math.floor(rate * sec);
      var buf = ctx.createBuffer(2, n, rate);
      for (var c = 0; c < 2; c++) {
        var d = buf.getChannelData(c), last = 0;
        for (var i = 0; i < n; i++) {
          var t = i / n;
          // low-passed noise: a raw-noise tail sounds grainy, not like a room
          var white = Math.random() * 2 - 1;
          last = last * 0.62 + white * 0.38;
          d[i] = last * Math.pow(1 - t, decay);
        }
      }
      return buf;
    }

    function init() {
      if (ctx) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      out = ctx.createGain(); out.gain.value = on ? 1 : 0;
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -15; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.22;
      bus = ctx.createGain(); bus.gain.value = 0.9;
      verb = ctx.createConvolver();
      verb.buffer = impulse(2.6, 2.4);           // a big room, because an alley is one
      var wet = ctx.createGain(); wet.gain.value = 0.32;
      var hi = ctx.createBiquadFilter(); hi.type = "highpass"; hi.frequency.value = 160;
      bus.connect(comp); comp.connect(out);
      bus.connect(hi); hi.connect(verb); verb.connect(wet); wet.connect(out);
      out.connect(ctx.destination);
      // iOS unlock
      var b = ctx.createBuffer(1, 1, 22050);
      var s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0);
    }

    function noiseBuf(sec) {
      var n = Math.floor(ctx.sampleRate * sec);
      var buf = ctx.createBuffer(1, n, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      return buf;
    }

    function pan(x) {
      var p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (p) p.pan.value = clamp(x, -1, 1);
      return p;
    }

    /* Rolling ball on maple. A hard 7kg sphere on wood is a deep broadband
     * RUMBLE with a resonant low peak, not a hiss — so: brown noise (white
     * integrated, which tilts the spectrum down 6dB/oct) through a lowpass,
     * plus a narrow resonant peak that rises with speed, plus a slow tremolo
     * standing in for the ball's own rotation. */
    function brownBuf(sec) {
      var n = Math.floor(ctx.sampleRate * sec);
      var buf = ctx.createBuffer(1, n, ctx.sampleRate);
      var d = buf.getChannelData(0), last = 0;
      for (var i = 0; i < n; i++) {
        var w = Math.random() * 2 - 1;
        last = (last + 0.022 * w) / 1.022;
        d[i] = last * 8.5;
      }
      return buf;
    }

    var rollRes = null, rollLfo = null, rollLfoGain = null;

    function startRoll() {
      if (!ctx) return;
      stopRoll();
      var src = ctx.createBufferSource();
      src.buffer = brownBuf(3); src.loop = true;

      var f = ctx.createBiquadFilter(); f.type = "lowpass";
      f.frequency.value = 260; f.Q.value = 0.7;
      var res = ctx.createBiquadFilter(); res.type = "peaking";
      res.frequency.value = 78; res.Q.value = 2.2; res.gain.value = 11;
      var g = ctx.createGain(); g.gain.value = 0;

      // gentle tremolo — a rolling ball is not a steady tone
      var lfo = ctx.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 7.5;
      var lg = ctx.createGain(); lg.gain.value = 0;
      lfo.connect(lg); lg.connect(g.gain); lfo.start();

      src.connect(res); res.connect(f); f.connect(g); g.connect(bus);
      src.start();
      rollSrc = src; rollGain = g; rollFilt = f; rollRes = res; rollLfo = lfo; rollLfoGain = lg;
    }
    function updateRoll(speed, x) {
      if (!rollGain) return;
      var s = clamp(speed / 11, 0, 1);
      var t = ctx.currentTime;
      rollGain.gain.setTargetAtTime(0.32 * (0.25 + 0.75 * s), t, 0.08);
      rollFilt.frequency.setTargetAtTime(170 + 420 * s, t, 0.1);
      if (rollRes) rollRes.frequency.setTargetAtTime(62 + 46 * s, t, 0.12);
      if (rollLfoGain) rollLfoGain.gain.setTargetAtTime(0.045 * s, t, 0.1);
      if (rollLfo) rollLfo.frequency.setTargetAtTime(4.5 + 9 * s, t, 0.15);
    }
    function stopRoll() {
      if (!rollSrc) return;
      try { rollGain.gain.setTargetAtTime(0, ctx.currentTime, 0.06); } catch (e) {}
      var s = rollSrc, l = rollLfo;
      setTimeout(function () {
        try { s.stop(); } catch (e) {}
        try { if (l) l.stop(); } catch (e) {}
      }, 400);
      rollSrc = null; rollGain = null; rollFilt = null; rollRes = null; rollLfo = null; rollLfoGain = null;
    }

    /* Pin-on-pin: dry hard maple. The previous voice sat at 240Hz with long
     * 300ms tails, which is a MARIMBA — boomy and musical, exactly wrong. A
     * pin knock is bright, woody and over almost immediately: a sharp filtered
     * noise transient carrying most of the energy, plus two short inharmonic
     * wood modes up at 700-1900Hz, all gone inside ~120ms. */
    function clack(vel, px, bright) {
      if (!ctx) return;
      var t = ctx.currentTime;
      var v = clamp(vel, 0.05, 1);
      var p = pan(px);
      var dest = p || bus; if (p) p.connect(bus);

      var nb = ctx.createBufferSource(); nb.buffer = noiseBuf(0.06);
      var nf = ctx.createBiquadFilter(); nf.type = "bandpass";
      nf.frequency.value = 1500 + 2600 * bright + Math.random() * 500;
      nf.Q.value = 0.9;
      var ng = ctx.createGain();
      ng.gain.setValueAtTime(0.62 * v, t);
      ng.gain.exponentialRampToValueAtTime(0.0006, t + 0.045 + 0.03 * v);
      nb.connect(nf); nf.connect(ng); ng.connect(dest);
      nb.start(t); nb.stop(t + 0.08);

      var modes = [1, 1.94], base = 700 + 700 * bright + Math.random() * 220;
      for (var i = 0; i < modes.length; i++) {
        var o = ctx.createOscillator();
        o.type = "triangle";
        o.frequency.setValueAtTime(base * modes[i], t);
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.16 * v / (1 + i), t);
        g.gain.exponentialRampToValueAtTime(0.0005, t + 0.075 / (i + 1));
        o.connect(g); g.connect(dest);
        o.start(t); o.stop(t + 0.14);
      }
    }

    /* Pin hitting the deck: a low woody thump, short. */
    function thud(vel, px) {
      if (!ctx) return;
      var t = ctx.currentTime, v = clamp(vel, 0.05, 1);
      var p = pan(px); var dest = p || bus; if (p) p.connect(bus);
      var o = ctx.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(168, t);
      o.frequency.exponentialRampToValueAtTime(74, t + 0.09);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.30 * v, t);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.15);
      o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.18);

      var nb = ctx.createBufferSource(); nb.buffer = noiseBuf(0.05);
      var nf = ctx.createBiquadFilter(); nf.type = "bandpass"; nf.frequency.value = 420; nf.Q.value = 1.4;
      var ng = ctx.createGain();
      ng.gain.setValueAtTime(0.22 * v, t);
      ng.gain.exponentialRampToValueAtTime(0.0005, t + 0.05);
      nb.connect(nf); nf.connect(ng); ng.connect(dest); nb.start(t); nb.stop(t + 0.07);
    }

    /* The ball arriving: the big one. A deep body hit under a burst of wood. */
    function crash(vel, px) {
      if (!ctx) return;
      var t = ctx.currentTime, v = clamp(vel, 0.2, 1);
      var p = pan(px * 0.5); var dest = p || bus; if (p) p.connect(bus);
      var o = ctx.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(140, t);
      o.frequency.exponentialRampToValueAtTime(52, t + 0.2);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.5 * v, t);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.34);
      o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.38);
      clack(v, px, 0.9);
    }

    function gutter() {
      if (!ctx) return;
      var t = ctx.currentTime;
      var nb = ctx.createBufferSource(); nb.buffer = brownBuf(0.8);
      var f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 190; f.Q.value = 2.2;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.30, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      nb.connect(f); f.connect(g); g.connect(bus); nb.start(t); nb.stop(t + 0.8);
    }

    /* No melody on a strike — an arpeggio over a pin crash reads as a mobile
     * game. A low swell plus a little air is enough of a reward. */
    function fanfare(isStrike) {
      if (!ctx) return;
      var t = ctx.currentTime + 0.10;
      var o = ctx.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(isStrike ? 73.4 : 98.0, t);
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(isStrike ? 0.30 : 0.18, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0005, t + (isStrike ? 1.0 : 0.7));
      o.connect(g); g.connect(bus); o.start(t); o.stop(t + 1.1);

      var nb = ctx.createBufferSource(); nb.buffer = noiseBuf(0.9);
      var hf = ctx.createBiquadFilter(); hf.type = "highpass"; hf.frequency.value = 5200;
      var ng = ctx.createGain();
      ng.gain.setValueAtTime(isStrike ? 0.075 : 0.04, t);
      ng.gain.exponentialRampToValueAtTime(0.0004, t + (isStrike ? 0.8 : 0.5));
      nb.connect(hf); hf.connect(ng); ng.connect(bus); nb.start(t); nb.stop(t + 0.95);
    }

    return {
      init: init, startRoll: startRoll, updateRoll: updateRoll, stopRoll: stopRoll,
      clack: clack, thud: thud, crash: crash, gutter: gutter, fanfare: fanfare,
      toggle: function () {
        on = !on;
        try { localStorage.setItem(SOUND_KEY, on ? "1" : "0"); } catch (e) {}
        if (out) out.gain.setTargetAtTime(on ? 1 : 0, ctx.currentTime, 0.02);
        return on;
      },
      isOn: function () { return on; },
      ready: function () { return !!ctx; }
    };
  })();

  soundBtn.setAttribute("aria-pressed", String(audio.isOn()));
  soundBtn.addEventListener("click", function () {
    audio.init();
    soundBtn.setAttribute("aria-pressed", String(audio.toggle()));
  });

  /* A ten-pin scatter generates dozens of contacts per frame across four solver
   * iterations. Firing a voice for every one buries the mix in mush and is most
   * of why it sounded bad — so keep only the hardest few hits each frame, and
   * rate-limit so a rattling pile cannot machine-gun. */
  var lastVoiceAt = 0, VOICE_GAP = 0.022, MAX_VOICES = 3;
  function drainHits() {
    if (!pendingHits.length) return;
    var px = clamp(ball.p[0] / LANE_HALF, -1, 1) * 0.6;
    var now = performance.now() / 1000;

    var gut = null, loud = [];
    for (var i = 0; i < pendingHits.length; i++) {
      var h = pendingHits[i];
      if (h.kind === "gutter") { gut = h; continue; }
      loud.push(h);
    }
    if (gut) audio.gutter();

    loud.sort(function (a, b) { return b.speed - a.speed; });
    var fired = 0;
    for (var k = 0; k < loud.length && fired < MAX_VOICES; k++) {
      var e = loud[k];
      if (now - lastVoiceAt < VOICE_GAP && fired > 0) break;
      if (e.kind === "crash") audio.crash(clamp(e.speed, 0.25, 1), px);
      else if (e.kind === "clack") audio.clack(clamp(e.speed * 0.8, 0.10, 0.85), px + (Math.random() - 0.5) * 0.4, 0.5);
      else if (e.kind === "wood") audio.thud(clamp(e.speed * 0.5, 0.06, 0.7), px + (Math.random() - 0.5) * 0.4);
      lastVoiceAt = now;
      fired++;
    }
    pendingHits.length = 0;
  }

  // ----------------------------------------------------------------- input

  var aim = { x: 0, power: 0, spin: 0 };
  var drag = null;
  var MAX_POWER = 11.4, MIN_POWER = 5.2;
  /* The lip of the gutter, and how far out you are allowed to aim.
   *
   * These were two separate expressions and they disagreed: aim topped out at
   * 0.399 while the channel started at 0.467, so the widest line you could
   * pick still sat 7cm inside the lane and a gutter ball was essentially
   * unrollable. Being able to throw a bad one is part of bowling, so the aim
   * limit now reaches just PAST the lip, so the outermost sliver of the aim
   * range drops straight into the channel. Stopping short of it is not enough:
   * a dead-straight ball riding the edge never drifts, so it could still never
   * gutter. You have to be able to throw a genuinely bad one. */
  /* Screen-x to world-x sign.
   *
   * The camera looks along +z, so mLookAt's right vector is cross(up, z) = -x:
   * world +x renders on the LEFT. Every aim input was therefore mirrored —
   * press right, ball goes left; ArrowRight moves it left. That is almost
   * certainly why steering never felt learnable. Confirmed by pressing at 82%
   * of screen width and reading back where the ball actually rendered. */
  var SX = -1;
  var GUTTER_EDGE = LANE_HALF - BALL_R * 0.55;      // 0.467
  var AIM_LIMIT = GUTTER_EDGE + 0.018;              // 0.485 — past the lip on purpose

  function pointer(e) {
    var r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }

  /* Input model.
   *
   * Spin used to come from drag.vx — the lateral velocity at the INSTANT of
   * release. That is invisible, unrepeatable and unlearnable: drag straight
   * down, let go, and you get spin 0 every single time, which puts the ball
   * dead centre, which is precisely the shot that splits the rack. There was
   * no way to discover the hook at all.
   *
   * Now all three inputs are explicit and previewed:
   *   press      -> where you stand (the ball snaps to your finger's line)
   *   pull back  -> power
   *   slide across during the pull -> how much hook
   * and the predicted path is drawn on the lane while you hold, so you can see
   * the curve before you commit. Re-press to move your line.
   */
  canvas.addEventListener("pointerdown", function (e) {
    audio.init();
    if (phase === "over" || phase === "idle") return;
    if (phase !== "aim") return;
    var pt = pointer(e);
    aim.x = clamp(SX * (pt.x - 0.5) * 2 * AIM_LIMIT, -AIM_LIMIT, AIM_LIMIT);
    aim.power = MIN_POWER;
    aim.spin = 0;
    ball.p[0] = aim.x;
    drag = { sx: pt.x, sy: pt.y };
    canvas.setPointerCapture(e.pointerId);
    hideHint();
  });

  canvas.addEventListener("pointermove", function (e) {
    if (!drag || phase !== "aim") return;
    var pt = pointer(e);
    var pull = clamp(pt.y - drag.sy, 0, 0.42) / 0.42;
    aim.power = lerp(MIN_POWER, MAX_POWER, pull);
    // sideways travel during the pull is the hook, and it is previewed live
    aim.spin = clamp(SX * (pt.x - drag.sx) * 46, -15, 15);
  });

  function releaseDrag() {
    if (!drag || phase !== "aim") { drag = null; return; }
    var wasPull = aim.power > MIN_POWER + 0.35;
    drag = null;
    if (!wasPull) return;               // a tap just re-places your line
    throwBall();
  }
  canvas.addEventListener("pointerup", releaseDrag);
  canvas.addEventListener("pointercancel", function () { drag = null; });

  function throwBall() {
    phase = "rolling";
    ball.p = [aim.x, BALL_R, 0];
    ball.v = [0, 0, aim.power];
    /* Spin axis. Mostly end-over-end roll about x, PLUS a component along the
     * direction of travel (z) — that z part is the entire hook.
     *
     * The contact point sits at r = (0, -R, 0). A vertical (y) spin axis is
     * parallel to r, so w x r = 0: the ball spins like a top, the contact patch
     * slides nowhere, friction has nothing to bite, and the ball runs dead
     * straight. A z axis gives w x r = (wz*R, 0, 0) — a real sideways slide at
     * the patch, which friction converts into curve once the ball leaves the
     * oil. Sign is flipped so a leftward flick hooks left.
     */
    var roll = aim.power / BALL_R;
    ball.w = [-roll * 0.94, aim.spin * 0.18, -aim.spin];
    ball.rolling = true;
    settleT = 0;
    audio.init();
    audio.startRoll();
    hideHint();
    try {
      if (typeof window.gtag === "function" && frameIdx === 0 && frames[0].rolls.length === 0) {
        window.gtag("event", "toy_start", { toy: "bowling" });
      }
    } catch (e) {}
  }

  var keyAim = 0, keySpin = 0;
  window.addEventListener("keydown", function (e) {
    if (e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      if (phase === "idle" || phase === "over") { ovBtn.click(); return; }
      if (phase === "aim") { aim.power = 9.8; aim.spin = keySpin; throwBall(); }
      return;
    }
    if (phase !== "aim") return;
    if (e.key === "ArrowLeft") { e.preventDefault(); keyAim = clamp(keyAim - 0.09, -1, 1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); keyAim = clamp(keyAim + 0.09, -1, 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); keySpin = clamp(keySpin + 1.5, -15, 15); }
    else if (e.key === "ArrowDown") { e.preventDefault(); keySpin = clamp(keySpin - 1.5, -15, 15); }
    else if (e.key === "Home" || e.key === "0") {
      // a way back to the middle: arrowing yourself into the gutter and having
      // to count presses back out is a nasty little trap
      e.preventDefault(); keyAim = 0; keySpin = 0;
    }
    else return;
    aim.x = SX * keyAim * AIM_LIMIT;
    aim.spin = SX * keySpin;
    ball.p[0] = aim.x;
    hideHint();
  });

  var hintGone = false;
  function hideHint() {
    if (hintGone) return;
    hintGone = true;
    hintEl.classList.add("is-gone");
  }

  ovBtn.addEventListener("click", function () {
    audio.init();
    newGame();
  });

  // ---------------------------------------------------------------- camera

  var camEye = [0, 2.15, -5.8], camAt = [0, 0.05, 7.0];

  function updateCamera(dt) {
    var wantEye, wantAt, k = 2.6;
    /* With a long lens the ball at your feet and pins 60ft away cannot both sit
     * inside a ~29 degree frame from a low camera — the ball ends up below the
     * bottom edge. Hence the high, drawn-back viewpoint. */
    if (phase === "rolling" && ball.p[2] > LANE_LEN - 4.6) {
      // pin-deck cut: low and slightly off-axis so the scatter reads
      wantEye = [ball.p[0] * 0.3 + 0.52, 1.18, LANE_LEN - 4.0];
      wantAt = [0, 0.28, LANE_LEN + 0.66];
      k = 1.5;
    } else if (phase === "rolling" || phase === "resolving") {
      wantEye = [ball.p[0] * 0.5, 1.55, ball.p[2] - 4.3];
      wantAt = [ball.p[0] * 0.4, 0.26, ball.p[2] + 7.0];
    } else {
      wantEye = [aim.x * 0.45, 2.15, -5.8];
      wantAt = [aim.x * 0.2, 0.05, 7.0];
    }
    if (phase === "resolving") {
      wantEye = [0.52, 1.18, LANE_LEN - 4.0];
      wantAt = [0, 0.28, LANE_LEN + 0.66];
      k = 1.5;
    }
    var t = 1 - Math.exp(-k * dt);
    camEye = lerp3(camEye, wantEye, t);
    camAt = lerp3(camAt, wantAt, t);
  }

  // ------------------------------------------------------------------ draw

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function render() {
    resize();
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    var asp = canvas.width / Math.max(1, canvas.height);
    var proj = mPerspective(Math.PI / 6.2, asp, 0.05, 90);   // long lens: 60ft of lane needs it or the pins are a smudge
    var view = mLookAt(camEye, camAt, [0, 1, 0]);
    gl.useProgram(prog);
    gl.uniformMatrix4fv(U.uProj, false, new Float32Array(proj));
    gl.uniformMatrix4fv(U.uView, false, new Float32Array(view));
    gl.uniform3fv(U.uEye, new Float32Array(camEye));
    gl.uniform1f(U.uOilEnd, OIL_END);

    /* Order matters. Mirrored geometry goes FIRST, into the space below y=0,
     * then the lane is drawn over it blended so the reflection shows through
     * the boards. Drawing the lane first would occlude every reflection. */
    var flip = mScale(1, -1, 1);
    gl.cullFace(gl.FRONT);          // mirroring reverses winding
    for (var i = 0; i < pins.length; i++) {
      var p = pins[i];
      if (p.gone) continue;
      /* Only STANDING pins on the lane reflect.
       *
       * A toppled pin sits with its centre ~6cm up, so its mirror image lands
       * ABOVE the gutter floor and pokes out of the channel — it reads as a
       * second pin lying in the gutter rather than as a reflection. Standing
       * pins mirror well below the floor and are the ones worth seeing anyway. */
      if (p.down || (p.fade === undefined ? 1 : p.fade) < 1) continue;
      if (Math.abs(p.p[0]) > LANE_HALF - 0.03) continue;
      var m = mMul(mTranslate(p.p[0], p.p[1], p.p[2]), qToMat(p.q));
      drawMesh(meshPin, mMul(flip, m), 0, 1);
    }
    if (!ball.done && !ball.gutter) {
      var bm = mMul(mTranslate(ball.p[0], ball.p[1], ball.p[2]), qToMat(ball.q));
      drawMesh(meshBall, mMul(flip, bm), 2, 1);
    }
    gl.cullFace(gl.BACK);

    // lane, translucent so the reflection beneath reads as a wet sheen
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    drawMesh(meshLane, mTranslate(0, 0, (DECK_END - 1.3) / 2), 1, 0.84);
    gl.disable(gl.BLEND);

    // room
    var zc = LEN / 2 - 1.3;

    /* Neighbouring lanes. Two either side, dimmed with distance so the eye
     * stays on the one you are bowling — this is what turns a lit strip in a
     * void into somewhere. Their pins use the low-poly mesh: scenery is not
     * worth twenty full-detail lathes a frame. */
    var LANE_PITCH = 1.72;
    for (var nb = -1; nb <= 1; nb++) {
      if (nb === 0) continue;
      var nx = nb * LANE_PITCH;
      var dim = 0.5;
      drawMesh(meshLaneFlat, mTranslate(nx, 0, (DECK_END - 1.3) / 2), 0, 1, dim);
      for (var ng = -1; ng <= 1; ng += 2) {
        drawMesh(meshLaneCap, mTranslate(nx + ng * (LANE_HALF + 0.019), -0.014, zc), 0, 1, dim);
      }
      drawMesh(meshDeck, mTranslate(nx, -0.062, DECK_END + 0.6), 0, 1, dim);
      drawMesh(meshPinRack, mTranslate(nx, 0, 0), 0, 1, dim);
      // each lane gets its own lit masking unit over the deck
      drawMesh(meshMask, mTranslate(nx, 1.36, DECK_END + 0.32), 0, 1, dim);
      drawMesh(meshMaskGlow, mTranslate(nx, 0.50, DECK_END + 0.24), 3, 1, dim * 0.9);
    }

    // this lane's gutters and dividers
    for (var g = -1; g <= 1; g += 2) {
      drawMesh(meshGutterFloor, mTranslate(g * (LANE_HALF + GUTTER_W / 2), -0.085, zc), 0);
      drawMesh(meshGutterWall, mTranslate(g * (LANE_HALF + GUTTER_W + 0.015), -0.010, zc), 0);
      drawMesh(meshLaneCap, mTranslate(g * (LANE_HALF + 0.019), -0.014, zc), 0);
      drawMesh(meshDivider, mTranslate(g * (LANE_PITCH / 2), 0.07, zc), 0, 1, 0.8);
    }

    drawMesh(meshDeck, mTranslate(0, -0.062, DECK_END + 0.6), 0);
    drawMesh(meshMask, mTranslate(0, 1.36, DECK_END + 0.32), 0);
    drawMesh(meshMaskGlow, mTranslate(0, 0.50, DECK_END + 0.24), 3);
    drawMesh(meshWall, mTranslate(0, 1.95, DECK_END + 0.62), 0);
    drawMesh(meshBackGlow, mTranslate(0, 2.58, DECK_END + 0.45), 3, 1, 0.7);
    drawMesh(meshCeiling, mTranslate(0, 3.62, zc), 0);

    /* Ceiling fixtures receding down the room. They are the reason the lane
     * has a long wet highlight, and they give the empty upper half of the
     * frame something to read. */
    for (var lr = -1; lr <= 1; lr++) {
      var lx = lr * LANE_PITCH * 2, ld = lr === 0 ? 1 : 0.26;
      drawMesh(meshLightHous, mTranslate(lx, 0, 0), 0, 1, ld);
      drawMesh(meshLightLamp, mTranslate(lx, 0, 0), 3, 1, ld * 0.95);
    }

    for (var a = -3; a <= 3; a++) {
      if (a === 0) continue;
      drawMesh(meshMarker, mTranslate(a * 0.135, 0.0015, 4.57), 0);
    }

    // aim guide, on top of the lane while you are lining up
    if (phase === "aim") {
      buildGuide(predictPath(aim.x, aim.power, aim.spin));
      if (guide.n) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.depthMask(false);
        drawMesh(guide, mIdent(), 3, 1);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }
    }

    // real geometry
    for (var k = 0; k < pins.length; k++) {
      var pn = pins[k];
      if (pn.gone) continue;
      var fa = pn.fade === undefined ? 1 : pn.fade;
      if (fa >= 1) {
        drawMesh(meshPin, mMul(mTranslate(pn.p[0], pn.p[1], pn.p[2]), qToMat(pn.q)), 0, 1);
      } else {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        drawMesh(meshPin, mMul(mTranslate(pn.p[0], pn.p[1], pn.p[2]), qToMat(pn.q)), 0, fa);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }
    }
    if (!ball.done) {
      drawMesh(meshBall, mMul(mTranslate(ball.p[0], ball.p[1], ball.p[2]), qToMat(ball.q)), 2, 1);
    }
  }

  // ------------------------------------------------------------------ loop

  var last = 0, acc = 0;
  var STEP = 1 / 240;   // small fixed step: 10 tumbling bodies need it

  function frame(ts) {
    if (!last) last = ts;
    var dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;

    if (phase === "rolling" || phase === "resolving") {
      acc += dt;
      var guard = 0;
      while (acc >= STEP && guard++ < 40) {
        stepBall(STEP);
        stepPins(STEP);
        acc -= STEP;
      }
      drainHits();
      if (audio.ready()) audio.updateRoll(len3(ball.v), ball.p[0]);

      if (phase === "rolling") {
        var past = ball.p[2] > LANE_LEN + 0.4 || ball.done || ball.gutter;
        if (past) { phase = "resolving"; settleT = 0; audio.stopRoll(); }
      }
      if (phase === "resolving") {
        settleT += dt;
        if ((settled() && settleT > 1.1) || settleT > 6.5) finishRoll();
      }
    } else {
      acc = 0;
    }

    updateCamera(dt);
    render();
    requestAnimationFrame(frame);
  }

  // boot: rack a display frame behind the intro panel so the first thing you
  // see is a lane, not an empty void
  rackPins(true);
  resetBall();
  bestEl.textContent = best() || "—";
  requestAnimationFrame(frame);
})();
