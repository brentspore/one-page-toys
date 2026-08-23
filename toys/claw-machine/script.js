/* Claw Machine — real 3D in raw WebGL (no libraries, no build).
 *
 * The pit is stocked with miniatures of this site's own toys: an 8-ball, a d20,
 * a bowling pin, a shooter marble, a gacha capsule, a star. Ten drops to a run.
 *
 * The grab is honest. Real claw machines cheat with a current-limited solenoid
 * that only grips full-strength on scheduled wins, and that is exactly why they
 * feel bad — nothing you do matters. Here the grip is a function of how well
 * you centred the claw over the prize and how heavy that prize is, with only a
 * small random factor on top. Centre it and you keep it. That means the toy is
 * learnable, which is the whole difference between tension and resentment.
 *
 * Prizes are rigid bodies (quaternion orientation, impulse contacts) built from
 * one or two collision spheres, so an elongated prize like the bowling pin
 * still stacks and leans the way it should instead of behaving like a ball.
 */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var gl = canvas.getContext("webgl", { antialias: true, alpha: false })
        || canvas.getContext("experimental-webgl", { antialias: true });
  if (!gl) {
    var fb = document.createElement("p");
    fb.textContent = "This toy needs WebGL. Try a different browser.";
    fb.style.cssText = "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;font-family:monospace;color:#f4efe6;padding:24px;text-align:center";
    document.body.appendChild(fb);
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
  function mRotZ(a) {
    var c = Math.cos(a), s = Math.sin(a), m = mIdent();
    m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m;
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
  function qFromAxis(ax, ang) {
    var a = norm3(ax), s = Math.sin(ang / 2);
    return [a[0]*s, a[1]*s, a[2]*s, Math.cos(ang / 2)];
  }
  function qRandom() {
    var u1 = Math.random(), u2 = Math.random(), u3 = Math.random();
    var s1 = Math.sqrt(1 - u1), s2 = Math.sqrt(u1);
    return [s1 * Math.sin(6.2831853 * u2), s1 * Math.cos(6.2831853 * u2),
            s2 * Math.sin(6.2831853 * u3), s2 * Math.cos(6.2831853 * u3)];
  }
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

  var PIT_X = 0.34, PIT_Z = 0.28;      // pit half-extents, metres
  /* The pit is a shallow tray, not a well. A tall wall is what a box wants to
   * be geometrically and it is exactly wrong here: from any camera that can
   * also see the claw, a tall near wall stands between you and every prize. */
  var PIT_WALL = 0.115;
  var FRONT_WALL = 0.042;               // the near edge is lower still, to see in
  var RAIL_Y = 0.44;                    // the gantry rail the claw hangs from
  var CAB_X = 0.44, CAB_Z = 0.36, CAB_Y = 0.62;

  /* The chute is a hole in the front-left corner of the pit floor with a raised
   * lip on its two inner edges. Without the lip prizes trickle in on their own
   * and the pit drains itself, which reads as a bug even though a real machine
   * does exactly that. */
  var CH = { x0: -PIT_X, x1: -0.15, z0: 0.09, z1: PIT_Z };
  var CH_LIP = 0.068;
  var DROP_X = (CH.x0 + CH.x1) / 2, DROP_Z = (CH.z0 + CH.z1) / 2;

  var GRAB_R = 0.078;                   // how far off-centre a grab can still catch
  var JAW_Y = 0.085;                    // jaw length below the claw hub
  var TOTAL_DROPS = 10;

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ------------------------------------------------------------ mesh build

  function MB() { return { pos: [], nor: [], col: [] }; }
  function mbVert(b, p, n, c) {
    b.pos.push(p[0], p[1], p[2]);
    b.nor.push(n[0], n[1], n[2]);
    b.col.push(c[0], c[1], c[2]);
  }
  function mbUpload(b) {
    var m = { pos: gl.createBuffer(), nor: gl.createBuffer(), col: gl.createBuffer(), n: b.pos.length / 3 };
    gl.bindBuffer(gl.ARRAY_BUFFER, m.pos); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(b.pos), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.nor); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(b.nor), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.col); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(b.col), gl.STATIC_DRAW);
    return m;
  }

  // colFn(u, v, normal) -> rgb
  function mbSphere(b, c, r, seg, ring, colFn) {
    function vert(u, v) {
      var th = u * Math.PI * 2, ph = v * Math.PI;
      var n = [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)];
      mbVert(b, [c[0] + n[0]*r, c[1] + n[1]*r, c[2] + n[2]*r], n, colFn(u, v, n));
    }
    for (var i = 0; i < seg; i++) for (var j = 0; j < ring; j++) {
      var u0 = i / seg, u1 = (i + 1) / seg, v0 = j / ring, v1 = (j + 1) / ring;
      vert(u0, v0); vert(u1, v0); vert(u1, v1);
      vert(u0, v0); vert(u1, v1); vert(u0, v1);
    }
  }

  function mbBox(b, c, h, col, colFn) {
    var f = [
      [[0,0,1],  [[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]],
      [[0,0,-1], [[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1]]],
      [[1,0,0],  [[1,-1,1],[1,-1,-1],[1,1,-1],[1,1,1]]],
      [[-1,0,0], [[-1,-1,-1],[-1,-1,1],[-1,1,1],[-1,1,-1]]],
      [[0,1,0],  [[-1,1,1],[1,1,1],[1,1,-1],[-1,1,-1]]],
      [[0,-1,0], [[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1]]]
    ];
    for (var i = 0; i < f.length; i++) {
      var n = f[i][0], q = f[i][1], p = [];
      for (var k = 0; k < 4; k++) {
        p.push([c[0] + q[k][0]*h[0], c[1] + q[k][1]*h[1], c[2] + q[k][2]*h[2]]);
      }
      var tri = [0,1,2, 0,2,3];
      for (var t = 0; t < 6; t++) {
        mbVert(b, p[tri[t]], n, colFn ? colFn(p[tri[t]], n) : col);
      }
    }
  }

  /* Surface of revolution. Profile is [[height, radius], ...] bottom to top;
   * normals come from the profile slope so it shades smooth rather than as a
   * stack of washers (the lesson the bowling pin taught). */
  function mbLathe(b, c, profile, seg, colFn) {
    var pn = [];
    for (var i = 0; i < profile.length; i++) {
      var a = profile[Math.max(0, i - 1)], d = profile[Math.min(profile.length - 1, i + 1)];
      var dh = d[0] - a[0], dr = d[1] - a[1];
      var l = Math.sqrt(dh * dh + dr * dr) || 1;
      pn.push([dh / l, -dr / l]);
    }
    for (var s = 0; s < profile.length - 1; s++) {
      var p0 = profile[s], p1 = profile[s + 1], n0 = pn[s], n1 = pn[s + 1];
      for (var k = 0; k < seg; k++) {
        var t0 = (k / seg) * Math.PI * 2, t1 = ((k + 1) / seg) * Math.PI * 2;
        var quad = [[p0,n0,t0],[p1,n1,t0],[p1,n1,t1],[p0,n0,t0],[p1,n1,t1],[p0,n0,t1]];
        for (var q = 0; q < 6; q++) {
          var P = quad[q][0], N = quad[q][1], T = quad[q][2];
          mbVert(b,
            [c[0] + P[1]*Math.cos(T), c[1] + P[0], c[2] + P[1]*Math.sin(T)],
            norm3([N[0]*Math.cos(T), N[1], N[0]*Math.sin(T)]),
            colFn(P[0]));
        }
      }
    }
  }

  function mbIco(b, c, r, colFn) {
    var t = (1 + Math.sqrt(5)) / 2;
    var V = [[-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],[0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],
             [t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]].map(norm3);
    var F = [[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],
             [10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],
             [2,4,11],[6,2,10],[8,6,7],[9,8,1]];
    for (var i = 0; i < F.length; i++) {
      var a = V[F[i][0]], bb = V[F[i][1]], cc = V[F[i][2]];
      var n = norm3(cross(sub(bb, a), sub(cc, a)));
      var col = colFn(i, n);
      var tri = [a, bb, cc];
      for (var k = 0; k < 3; k++) {
        mbVert(b, [c[0] + tri[k][0]*r, c[1] + tri[k][1]*r, c[2] + tri[k][2]*r], n, col);
      }
    }
  }

  /* A plush "pillow": a 2D polygon domed on both faces so it reads soft rather
   * than die-cut. Rings give it enough vertices for the dome to shade smoothly. */
  function mbPillow(b, c, poly, thick, rings, col) {
    var N = poly.length;
    function pt(i, ring, side) {
      var f = ring / rings;
      var px = poly[i][0] * f, pz = poly[i][1] * f;
      var rr = Math.sqrt(px*px + pz*pz), R = Math.sqrt(poly[i][0]*poly[i][0] + poly[i][1]*poly[i][1]) || 1;
      var dome = Math.sqrt(Math.max(0, 1 - f * f));
      return [c[0] + px, c[1] + pz, c[2] + side * thick * dome];
    }
    function nrm(i, ring, side) {
      var f = ring / rings;
      var g = f / Math.max(0.001, Math.sqrt(Math.max(1e-4, 1 - f*f)));
      var px = poly[i][0], pz = poly[i][1];
      var l = Math.sqrt(px*px + pz*pz) || 1;
      return norm3([px / l * g * thick * 8, pz / l * g * thick * 8, side]);
    }
    for (var side = -1; side <= 1; side += 2) {
      for (var r = 0; r < rings; r++) {
        for (var i = 0; i < N; i++) {
          var j = (i + 1) % N;
          var a = pt(i, r, side), bb = pt(j, r, side), cc = pt(j, r + 1, side), dd = pt(i, r + 1, side);
          var na = nrm(i, r, side), nb = nrm(j, r, side), nc = nrm(j, r + 1, side), nd = nrm(i, r + 1, side);
          var tri = side > 0 ? [[a,na],[bb,nb],[cc,nc], [a,na],[cc,nc],[dd,nd]]
                             : [[a,na],[cc,nc],[bb,nb], [a,na],[dd,nd],[cc,nc]];
          for (var k = 0; k < 6; k++) mbVert(b, tri[k][0], tri[k][1], col);
        }
      }
    }
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
    "uniform vec3 uEye;",
    "uniform int uMode;",      // 0 plain, 1 emissive, 2 glass, 3 metal, 4 plush, 5 cabinet
    "uniform float uAlpha;",
    "uniform float uDim;",
    "",
    "void main(){",
    "  if (uMode == 1) { gl_FragColor = vec4(vC * uDim, uAlpha); return; }",
    "  vec3 N = normalize(vN);",
    "  vec3 V = normalize(uEye - vW);",
    /* Two ceiling fluorescents inside the cabinet plus a cool spill through the
     * glass. Claw machines are lit from directly above, which is what gives the
     * pit its bright tops and dark crevices. */
    "  vec3 L1 = normalize(vec3(-0.22, 0.95, 0.30));",
    "  vec3 L2 = normalize(vec3(0.42, 0.72, 0.62));",
    "  vec3 base = vC;",
    "  float shine = 34.0; float spec = 0.30;",
    "",
    "  if (uMode == 2) {",              // glass marble / capsule shell
    "    float f = pow(1.0 - max(dot(N, V), 0.0), 2.4);",
    "    base = mix(base, vec3(0.86, 0.94, 1.0), f * 0.6);",
    "    shine = 140.0; spec = 1.05;",
    "  } else if (uMode == 3) {",       // brushed steel claw and rail
    "    float f = pow(1.0 - max(dot(N, V), 0.0), 3.0);",
    "    base = mix(base, vec3(0.78, 0.82, 0.92), f * 0.5);",
    "    shine = 70.0; spec = 0.85;",
    "  } else if (uMode == 4) {",       // plush: velvet falloff, almost no spec
    "    float w = pow(1.0 - max(dot(N, V), 0.0), 1.6);",
    "    base = mix(base, base * 1.35 + vec3(0.06), w * 0.55);",
    "    shine = 8.0; spec = 0.05;",
    "  } else if (uMode == 5) {",       // cabinet panels: matte, slight sheen
    "    shine = 12.0; spec = 0.08;",
    "  }",
    "",
    "  float d1 = max(dot(N, L1), 0.0);",
    "  float d2 = max(dot(N, L2), 0.0);",
    "  vec3 diff = base * (0.44 + 0.82 * d1 + 0.34 * d2);",
    "  vec3 H1 = normalize(L1 + V);",
    "  float s1 = pow(max(dot(N, H1), 0.0), shine) * spec;",
    "  vec3 H2 = normalize(L2 + V);",
    "  float s2 = pow(max(dot(N, H2), 0.0), shine * 0.55) * spec * 0.4;",
    "  vec3 c = diff + vec3(1.0, 0.96, 0.88) * s1 + vec3(0.72, 0.84, 1.0) * s2;",
    /* Depth falls off toward the back of the cabinet so the pit reads as a box
     * with air in it rather than a flat sticker. */
    "  float fog = clamp((0.30 - vW.z) * 0.55, 0.0, 0.42);",
    "  c = mix(c, vec3(0.055, 0.052, 0.085), fog);",
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
  ["uProj","uView","uModel","uNorm","uEye","uMode","uAlpha","uDim"].forEach(function (n) {
    U[n] = gl.getUniformLocation(prog, n);
  });

  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.clearColor(0.031, 0.029, 0.055, 1);

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

  // ----------------------------------------------------------- prize models
  /* Every prize is a miniature of something else on the site. The value is the
   * ticket-ish payout and tracks how hard it is to lift: heavier things need a
   * better-centred grab, so they are worth more. */

  var KINDS = [
    { id: "eight",  name: "8-Ball",      value: 3, m: 0.20, mode: 0,
      spheres: [{ o: [0, 0, 0], r: 0.043 }] },
    { id: "marble", name: "Shooter",     value: 4, m: 0.16, mode: 2,
      spheres: [{ o: [0, 0, 0], r: 0.038 }] },
    { id: "d20",    name: "d20",         value: 5, m: 0.17, mode: 0,
      spheres: [{ o: [0, 0, 0], r: 0.044 }] },
    { id: "capsule",name: "Capsule",     value: 3, m: 0.14, mode: 2,
      spheres: [{ o: [0, 0, 0], r: 0.046 }] },
    { id: "star",   name: "Star Plush",  value: 6, m: 0.13, mode: 4,
      spheres: [{ o: [0, 0, 0], r: 0.055 }] },
    { id: "pin",    name: "Bowling Pin", value: 8, m: 0.26, mode: 0,
      spheres: [{ o: [0, -0.035, 0], r: 0.036 }, { o: [0, 0.042, 0], r: 0.026 }] }
  ];

  function buildPrizeMeshes() {
    var out = {};

    // 8-ball: a pool ball, white circle facing local +z so its spin is legible
    var b = MB();
    mbSphere(b, [0,0,0], 0.043, 26, 16, function (u, v, n) {
      var face = n[2];
      if (face > 0.80) return [0.94, 0.93, 0.90];
      return [0.07, 0.07, 0.09];
    });
    out.eight = mbUpload(b);

    // shooter marble: clear glass with a coloured cat's-eye vane inside
    b = MB();
    mbSphere(b, [0,0,0], 0.038, 24, 15, function (u, v, n) {
      var vane = Math.exp(-Math.pow(n[1] / 0.34, 2)) * (0.5 + 0.5 * Math.sin(u * Math.PI * 4));
      return [0.42 + 0.5 * vane, 0.68 + 0.25 * vane, 0.86];
    });
    out.marble = mbUpload(b);

    // d20: each face its own slightly-varied resin tone so the facets read
    b = MB();
    mbIco(b, [0,0,0], 0.046, function (i) {
      var t = (i % 5) / 5;
      return [0.30 + 0.10 * t, 0.10 + 0.05 * t, 0.42 + 0.14 * t];
    });
    out.d20 = mbUpload(b);

    // gacha capsule: two tinted hemispheres with a seam ring
    b = MB();
    mbSphere(b, [0,0,0], 0.046, 26, 16, function (u, v, n) {
      if (Math.abs(n[1]) < 0.06) return [0.92, 0.90, 0.86];
      return n[1] > 0 ? [0.95, 0.42, 0.36] : [0.98, 0.82, 0.36];
    });
    out.capsule = mbUpload(b);

    // star plush: a five-point pillow
    b = MB();
    var poly = [];
    for (var i = 0; i < 10; i++) {
      var ang = -Math.PI / 2 + (i / 10) * Math.PI * 2;
      var rr = (i % 2 === 0) ? 0.058 : 0.026;
      poly.push([Math.cos(ang) * rr, Math.sin(ang) * rr]);
    }
    mbPillow(b, [0,0,0], poly, 0.024, 3, [0.99, 0.78, 0.28]);
    out.star = mbUpload(b);

    // bowling pin, shrunk to a keyring toy
    b = MB();
    var PROF = [
      [0.000, 0.0000], [0.002, 0.0175], [0.012, 0.0195], [0.030, 0.0222],
      [0.046, 0.0234], [0.062, 0.0222], [0.078, 0.0186], [0.092, 0.0140],
      [0.104, 0.0118], [0.115, 0.0131], [0.126, 0.0148], [0.135, 0.0136],
      [0.143, 0.0092], [0.147, 0.0000]
    ];
    mbLathe(b, [0, -0.073, 0], PROF, 18, function (h) {
      var band = (h > 0.106 && h < 0.115) || (h > 0.120 && h < 0.129);
      return band ? [0.82, 0.20, 0.18] : [0.96, 0.94, 0.90];
    });
    out.pin = mbUpload(b);

    return out;
  }
  var PRIZE_MESH = buildPrizeMeshes();

  // ------------------------------------------------------------- cabinet mesh

  function buildCabinet() {
    var b = MB();
    var wallCol = [0.27, 0.22, 0.40];
    var floorCol = [0.34, 0.29, 0.45];

    /* Pit floor drawn as four slabs around the chute hole, so the hole is a
     * real absence rather than a dark decal you can see prizes resting on. */
    function slab(x0, x1, z0, z1, y, col) {
      mbBox(b, [(x0+x1)/2, y - 0.012, (z0+z1)/2], [(x1-x0)/2, 0.012, (z1-z0)/2], col);
    }
    slab(-PIT_X, CH.x1, -PIT_Z, CH.z0, 0, floorCol);
    slab(CH.x1, PIT_X, -PIT_Z, PIT_Z, 0, floorCol);
    slab(-PIT_X, CH.x1, CH.z1, PIT_Z, 0, floorCol);

    // pit walls — the near one cut down so the camera can see into the tray
    mbBox(b, [0, PIT_WALL/2, -PIT_Z - 0.012], [PIT_X + 0.024, PIT_WALL/2, 0.012], wallCol);
    mbBox(b, [0, FRONT_WALL/2, PIT_Z + 0.012], [PIT_X + 0.024, FRONT_WALL/2, 0.012], [0.24, 0.20, 0.34]);
    mbBox(b, [-PIT_X - 0.012, PIT_WALL/2, 0], [0.012, PIT_WALL/2, PIT_Z + 0.024], wallCol);
    mbBox(b, [PIT_X + 0.012, PIT_WALL/2, 0], [0.012, PIT_WALL/2, PIT_Z + 0.024], wallCol);

    // chute lip — the two inner edges of the hole
    mbBox(b, [CH.x1, CH_LIP/2, (CH.z0+CH.z1)/2], [0.010, CH_LIP/2, (CH.z1-CH.z0)/2], [0.26, 0.22, 0.34]);
    mbBox(b, [(CH.x0+CH.x1)/2, CH_LIP/2, CH.z0], [(CH.x1-CH.x0)/2, CH_LIP/2, 0.010], [0.26, 0.22, 0.34]);

    // chute shaft walls, dropping away into the delivery bin
    mbBox(b, [CH.x1 - 0.004, -0.13, (CH.z0+CH.z1)/2], [0.008, 0.13, (CH.z1-CH.z0)/2], [0.09, 0.08, 0.13]);
    mbBox(b, [(CH.x0+CH.x1)/2, -0.13, CH.z0 + 0.004], [(CH.x1-CH.x0)/2, 0.13, 0.008], [0.09, 0.08, 0.13]);
    mbBox(b, [(CH.x0+CH.x1)/2, -0.27, (CH.z0+CH.z1)/2], [(CH.x1-CH.x0)/2, 0.012, (CH.z1-CH.z0)/2], [0.07, 0.06, 0.10]);

    // cabinet shell: back panel, sides, ceiling
    mbBox(b, [0, CAB_Y/2 - 0.1, -CAB_Z], [CAB_X, CAB_Y/2 + 0.1, 0.014], null, function (p) {
      var t = clamp((p[1] + 0.1) / CAB_Y, 0, 1);
      return [0.20 + 0.20*t, 0.13 + 0.10*t, 0.32 + 0.22*t];
    });
    mbBox(b, [-CAB_X, CAB_Y/2 - 0.1, 0], [0.014, CAB_Y/2 + 0.1, CAB_Z], [0.23, 0.17, 0.36]);
    mbBox(b, [CAB_X, CAB_Y/2 - 0.1, 0], [0.014, CAB_Y/2 + 0.1, CAB_Z], [0.23, 0.17, 0.36]);
    mbBox(b, [0, CAB_Y, 0], [CAB_X, 0.014, CAB_Z], [0.26, 0.21, 0.38]);

    /* Cabinet furniture above and below the glass. On a phone the frame is far
     * taller than the tray, and this is what fills it: header board up top,
     * pedestal and prize door underneath. It also makes the thing read as a
     * machine standing in an arcade rather than a floating box. */
    var shell = [0.19, 0.14, 0.30];
    // header board, front-facing
    mbBox(b, [0, 0.712, CAB_Z + 0.012], [CAB_X + 0.02, 0.076, 0.014], [0.24, 0.15, 0.38]);
    mbBox(b, [0, 0.800, 0], [CAB_X + 0.02, 0.014, CAB_Z + 0.02], shell);
    mbBox(b, [-CAB_X - 0.006, 0.712, 0], [0.016, 0.076, CAB_Z + 0.02], shell);
    mbBox(b, [CAB_X + 0.006, 0.712, 0], [0.016, 0.076, CAB_Z + 0.02], shell);
    // glass posts at the front corners
    mbBox(b, [-CAB_X - 0.006, 0.31, CAB_Z + 0.008], [0.016, 0.32, 0.016], shell);
    mbBox(b, [CAB_X + 0.006, 0.31, CAB_Z + 0.008], [0.016, 0.32, 0.016], shell);
    // pedestal
    mbBox(b, [0, -0.30, 0], [CAB_X + 0.02, 0.030, CAB_Z + 0.02], [0.22, 0.16, 0.33]);
    mbBox(b, [0, -0.60, CAB_Z + 0.012], [CAB_X + 0.02, 0.28, 0.014], shell);
    mbBox(b, [-CAB_X - 0.006, -0.60, 0], [0.016, 0.28, CAB_Z + 0.02], shell);
    mbBox(b, [CAB_X + 0.006, -0.60, 0], [0.016, 0.28, CAB_Z + 0.02], shell);
    // prize door: a dark recess in the pedestal front, under the chute
    mbBox(b, [(CH.x0+CH.x1)/2, -0.46, CAB_Z + 0.020],
          [(CH.x1-CH.x0)/2 + 0.02, 0.075, 0.008], [0.05, 0.04, 0.08]);

    return mbUpload(b);
  }

  /* Neon. A cabinet without lit trim reads as a cardboard box — the tube along
   * the pit rim is also what separates the tray edge from the floor behind it
   * at this camera angle. */
  var meshNeon = (function () {
    var b = MB();
    var pink = [1.0, 0.36, 0.56], amber = [1.0, 0.78, 0.34];
    mbBox(b, [0, PIT_WALL + 0.004, -PIT_Z - 0.012], [PIT_X + 0.026, 0.005, 0.013], pink);
    mbBox(b, [-PIT_X - 0.012, PIT_WALL + 0.004, 0], [0.013, 0.005, PIT_Z + 0.026], pink);
    mbBox(b, [PIT_X + 0.012, PIT_WALL + 0.004, 0], [0.013, 0.005, PIT_Z + 0.026], pink);
    mbBox(b, [0, FRONT_WALL + 0.004, PIT_Z + 0.012], [PIT_X + 0.026, 0.005, 0.013], amber);
    // chute mouth, so the target reads at a glance
    mbBox(b, [CH.x1, CH_LIP + 0.004, (CH.z0+CH.z1)/2], [0.011, 0.004, (CH.z1-CH.z0)/2], amber);
    mbBox(b, [(CH.x0+CH.x1)/2, CH_LIP + 0.004, CH.z0], [(CH.x1-CH.x0)/2, 0.004, 0.011], amber);
    // marquee bar across the back
    mbBox(b, [0, CAB_Y - 0.07, -CAB_Z + 0.02], [CAB_X - 0.05, 0.014, 0.008], pink);
    // the header board's lit face, and a tube under it
    mbBox(b, [0, 0.716, CAB_Z + 0.027], [CAB_X - 0.03, 0.048, 0.006], [0.90, 0.33, 0.49]);
    mbBox(b, [0, 0.628, CAB_Z + 0.024], [CAB_X + 0.012, 0.006, 0.006], amber);
    // a strip over the prize door so the delivery point reads from the outside
    mbBox(b, [(CH.x0+CH.x1)/2, -0.376, CAB_Z + 0.028],
          [(CH.x1-CH.x0)/2 + 0.02, 0.005, 0.006], amber);
    /* A lit floor at the bottom of the chute. Without light down there the hole
     * is a flat black shape and reads as a raised panel, not an opening. */
    mbBox(b, [(CH.x0+CH.x1)/2, -0.252, (CH.z0+CH.z1)/2],
          [(CH.x1-CH.x0)/2 - 0.012, 0.004, (CH.z1-CH.z0)/2 - 0.012], [0.62, 0.34, 0.20]);
    return mbUpload(b);
  })();
  var meshCabinet = buildCabinet();

  // ceiling light panels (emissive)
  var meshLights = (function () {
    var b = MB();
    for (var i = -1; i <= 1; i += 2) {
      mbBox(b, [i * 0.20, CAB_Y - 0.026, -0.02], [0.10, 0.010, CAB_Z - 0.06], [1.0, 0.96, 0.86]);
    }
    return mbUpload(b);
  })();

  /* Gantry. The x-rail sits at the BACK of the cabinet rather than across the
   * middle — a rail through the centre of frame cuts the pit in half from this
   * camera and reads as a girder rather than a mechanism. */
  var meshRail = (function () {
    var b = MB();
    /* One rail, at the back. A second rail across the FRONT looked right in a
     * plan drawing and cut a grey bar straight through the pile on screen. */
    mbBox(b, [0, RAIL_Y + 0.03, -CAB_Z + 0.04], [CAB_X - 0.03, 0.009, 0.012], [0.42, 0.44, 0.50]);
    return mbUpload(b);
  })();
  var meshCarriage = (function () {
    var b = MB();
    mbBox(b, [0, RAIL_Y + 0.03, 0], [0.018, 0.008, CAB_Z - 0.04], [0.40, 0.42, 0.49]);
    return mbUpload(b);
  })();
  var meshTrolley = (function () {
    var b = MB();
    mbBox(b, [0, RAIL_Y + 0.032, 0], [0.026, 0.016, 0.026], [0.54, 0.56, 0.63]);
    return mbUpload(b);
  })();

  /* Contact shadows. Without them every prize floats — this was the single
   * biggest realism gap in the first pass, and a blended dark disc on the pit
   * floor costs one quad each. */
  var meshShadow = (function () {
    var b = MB();
    var seg = 18;
    for (var i = 0; i < seg; i++) {
      var t0 = (i / seg) * Math.PI * 2, t1 = ((i + 1) / seg) * Math.PI * 2;
      mbVert(b, [0, 0, 0], [0, 1, 0], [0, 0, 0]);
      mbVert(b, [Math.cos(t1), 0, Math.sin(t1)], [0, 1, 0], [0, 0, 0]);
      mbVert(b, [Math.cos(t0), 0, Math.sin(t0)], [0, 1, 0], [0, 0, 0]);
    }
    return mbUpload(b);
  })();

  // claw hub + one jaw (drawn three times, rotated)
  var meshHub = (function () {
    var b = MB();
    mbLathe(b, [0, 0, 0], [[0, 0.0], [0.008, 0.030], [0.030, 0.034], [0.044, 0.020], [0.050, 0.0]], 18,
      function () { return [0.60, 0.62, 0.70]; });
    return mbUpload(b);
  })();
  var meshJaw = (function () {
    /* One jaw as a tapering blade that curves inward at the tip. Built along
     * +x from the hub so the open/close rotation is a single Z rotation. */
    var b = MB();
    var segs = [
      { y: 0.000, x: 0.028, w: 0.012, t: 0.010 },
      { y: -0.030, x: 0.034, w: 0.011, t: 0.009 },
      { y: -0.058, x: 0.032, w: 0.009, t: 0.008 },
      { y: -0.078, x: 0.022, w: 0.007, t: 0.007 },
      { y: -0.088, x: 0.010, w: 0.005, t: 0.005 }
    ];
    for (var i = 0; i < segs.length - 1; i++) {
      var a = segs[i], c = segs[i + 1];
      mbBox(b, [(a.x + c.x) / 2, (a.y + c.y) / 2, 0],
            [Math.max(0.006, Math.abs(c.x - a.x) / 2 + a.w * 0.5), Math.abs(c.y - a.y) / 2 + 0.004, a.t],
            [0.66, 0.68, 0.76]);
    }
    return mbUpload(b);
  })();

  // ----------------------------------------------------------------- world

  var bodies = [];
  var won = [];                 // prize kinds delivered this run
  var dropsUsed = 0, score = 0;
  var best = 0;
  try { best = parseInt(localStorage.getItem("claw_best") || "0", 10) || 0; } catch (e) {}

  function makeBody(kind, x, y, z) {
    var K = KINDS[kind];
    var rmax = 0;
    for (var i = 0; i < K.spheres.length; i++) rmax = Math.max(rmax, K.spheres[i].r + len3(K.spheres[i].o));
    var I = 0.4 * K.m * rmax * rmax;
    return {
      k: kind, K: K,
      p: [x, y, z], q: qRandom(),
      v: [0, 0, 0], w: [0, 0, 0],
      m: K.m, invM: 1 / K.m, invI: 1 / I, rmax: rmax,
      held: false, gone: false, rest: 0
    };
  }

  function stockPit() {
    bodies = [];
    var cols = 5, rows = 4, layers = 2, n = 0;
    for (var L = 0; L < layers; L++) {
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          if (n >= 24) break;
          var kind = n % KINDS.length;
          // jitter so the pit reads as dumped-in, not laid out
          var x = -PIT_X + 0.085 + c * ((PIT_X * 2 - 0.17) / (cols - 1)) + (Math.random() - 0.5) * 0.022;
          var z = -PIT_Z + 0.075 + r * ((PIT_Z * 2 - 0.15) / (rows - 1)) + (Math.random() - 0.5) * 0.022;
          var y = 0.06 + L * 0.10 + Math.random() * 0.02;
          if (x < CH.x1 + 0.05 && z > CH.z0 - 0.05) x += 0.10;   // keep the chute clear
          bodies.push(makeBody(kind, clamp(x, -PIT_X + 0.06, PIT_X - 0.06), y, clamp(z, -PIT_Z + 0.06, PIT_Z - 0.06)));
          n++;
        }
      }
    }
    // shuffle kinds so the grid seeding does not show through as stripes
    for (var i = bodies.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var ka = bodies[i].k, kb = bodies[j].k;
      bodies[i].k = kb; bodies[i].K = KINDS[kb]; bodies[i].m = KINDS[kb].m; bodies[i].invM = 1 / KINDS[kb].m;
      bodies[j].k = ka; bodies[j].K = KINDS[ka]; bodies[j].m = KINDS[ka].m; bodies[j].invM = 1 / KINDS[ka].m;
    }
  }

  // ------------------------------------------------------------------ claw

  var claw = {
    gx: 0, gz: 0,              // gantry position
    tx: 0, tz: 0,              // target the player is steering toward
    y: RAIL_Y - 0.06,          // hub height
    jaw: 1,                    // 1 open, 0 clamped
    sx: 0, sz: 0, svx: 0, svz: 0,   // pendulum swing angles + rates
    phase: "idle",
    t: 0,
    grip: 0, gripMax: 0,
    holding: null,
    lastVx: 0, lastVz: 0
  };
  var SPEED = 0.62;            // gantry metres/second

  function clawTip() {
    // the jaw centre, swung out by the pendulum
    var L = RAIL_Y - claw.y;
    return [claw.gx + Math.sin(claw.sx) * L, claw.y - JAW_Y * 0.55, claw.gz + Math.sin(claw.sz) * L];
  }

  // --------------------------------------------------------------- physics

  function bodySpheres(b) {
    var out = [];
    for (var i = 0; i < b.K.spheres.length; i++) {
      var s = b.K.spheres[i];
      out.push({ c: add(b.p, qRot(b.q, s.o)), r: s.r, o: qRot(b.q, s.o) });
    }
    return out;
  }

  function applyImpulse(b, P, imp) {
    if (b.held) return;
    b.v = add(b.v, scale3(imp, b.invM));
    var r = sub(P, b.p);
    b.w = add(b.w, scale3(cross(r, imp), b.invI));
  }
  function pointVel(b, P) {
    return add(b.v, cross(b.w, sub(P, b.p)));
  }

  function overChute(x, z) {
    return x > CH.x0 - 0.01 && x < CH.x1 && z > CH.z0 && z < CH.z1 + 0.01;
  }

  function resolveWorld(b, sph, e, mu) {
    // pit floor (absent over the chute)
    var inChute = overChute(sph.c[0], sph.c[2]);
    var floorY = inChute ? -0.26 : 0;
    var pen = floorY + sph.r - sph.c[1];
    if (pen > 0) {
      contact(b, [sph.c[0], floorY, sph.c[2]], [0, 1, 0], pen, e, mu);
    }
    // pit walls — only above the floor plane; inside the chute use its own box
    var xlo = inChute ? CH.x0 : -PIT_X, xhi = inChute ? CH.x1 : PIT_X;
    var zlo = inChute ? CH.z0 : -PIT_Z, zhi = inChute ? CH.z1 : PIT_Z;
    if (sph.c[0] - sph.r < xlo) contact(b, [xlo, sph.c[1], sph.c[2]], [1, 0, 0], xlo - (sph.c[0] - sph.r), e, mu);
    if (sph.c[0] + sph.r > xhi) contact(b, [xhi, sph.c[1], sph.c[2]], [-1, 0, 0], (sph.c[0] + sph.r) - xhi, e, mu);
    if (sph.c[2] - sph.r < zlo) contact(b, [sph.c[0], sph.c[1], zlo], [0, 0, 1], zlo - (sph.c[2] - sph.r), e, mu);
    if (sph.c[2] + sph.r > zhi) contact(b, [sph.c[0], sph.c[1], zhi], [0, 0, -1], (sph.c[2] + sph.r) - zhi, e, mu);

    // chute lip — a low ledge the prize has to be carried over
    if (!inChute && sph.c[1] - sph.r < CH_LIP) {
      if (sph.c[0] - sph.r < CH.x1 + 0.010 && sph.c[2] + sph.r > CH.z0 - 0.010 &&
          sph.c[0] > CH.x1 - 0.02 && sph.c[2] < CH.z0 + 0.02) {
        // corner post: push out along whichever axis is shallower
        var dx = (CH.x1 + 0.010 + sph.r) - sph.c[0];
        var dz = sph.c[2] - (CH.z0 - 0.010 - sph.r);
        if (dx < dz) contact(b, [CH.x1 + 0.010, sph.c[1], sph.c[2]], [1, 0, 0], dx, e, mu);
        else contact(b, [sph.c[0], sph.c[1], CH.z0 - 0.010], [0, 0, -1], dz, e, mu);
      } else if (sph.c[2] > CH.z0 && sph.c[0] > CH.x1 - 0.02 && sph.c[0] - sph.r < CH.x1 + 0.010) {
        contact(b, [CH.x1 + 0.010, sph.c[1], sph.c[2]], [1, 0, 0], (CH.x1 + 0.010 + sph.r) - sph.c[0], e, mu);
      } else if (sph.c[0] < CH.x1 && sph.c[2] < CH.z0 + 0.02 && sph.c[2] + sph.r > CH.z0 - 0.010) {
        contact(b, [sph.c[0], sph.c[1], CH.z0 - 0.010], [0, 0, -1], (sph.c[2] + sph.r) - (CH.z0 - 0.010), e, mu);
      }
    }
  }

  /* One contact: normal impulse with restitution, then Coulomb friction on the
   * tangent, then a positional push so deep overlaps actually recover.
   *
   * The positional term is capped and never touches velocity — the bowling pins
   * taught that lesson the hard way: a positional fix that also reverses v.y
   * stacks on the solver's own bounce and launches things. */
  /* Impacts are collected rather than played inline. A pile of two dozen prizes
   * can produce dozens of contacts in a single frame, and firing a voice for
   * each is what turns a physics toy's audio to mush — so only the hardest few
   * per frame get a voice, rate-limited on top. */
  var impacts = [];
  function noteImpact(b, vn) {
    if (vn > -0.30) return;
    impacts.push({ s: -vn, mode: b.K.mode });
  }

  function contact(b, P, N, pen, e, mu) {
    var rv = pointVel(b, P);
    var vn = dot(rv, N);
    noteImpact(b, vn);
    if (vn < 0) {
      var r = sub(P, b.p);
      var rn = cross(r, N);
      var denom = b.invM + b.invI * dot(rn, rn);
      var j = -(1 + e) * vn / denom;
      applyImpulse(b, P, scale3(N, j));

      rv = pointVel(b, P);
      var vt = sub(rv, scale3(N, dot(rv, N)));
      var vtl = len3(vt);
      if (vtl > 1e-5) {
        var T = scale3(vt, -1 / vtl);
        var rt = cross(r, T);
        var jt = vtl / (b.invM + b.invI * dot(rt, rt));
        jt = Math.min(jt, mu * j);
        applyImpulse(b, P, scale3(T, jt));
      }
    }
    if (pen > 0.0004) {
      var push = Math.min((pen - 0.0004) * 0.42, 0.004);
      b.p = add(b.p, scale3(N, push));
    }
  }

  function bodyContact(a, sa, bb, sb, e, mu) {
    var d = sub(sb.c, sa.c);
    var dist = len3(d);
    var pen = sa.r + sb.r - dist;
    if (pen <= 0 || dist < 1e-6) return;
    var N = scale3(d, 1 / dist);
    var P = add(sa.c, scale3(N, sa.r - pen / 2));

    var rvA = pointVel(a, P), rvB = pointVel(bb, P);
    var rv = sub(rvB, rvA);
    var vn = dot(rv, N);
    var ra = sub(P, a.p), rb = sub(P, bb.p);
    var invMA = a.held ? 0 : a.invM, invMB = bb.held ? 0 : bb.invM;
    var invIA = a.held ? 0 : a.invI, invIB = bb.held ? 0 : bb.invI;
    if (invMA + invMB === 0) return;
    noteImpact(a.held ? bb : a, vn);

    if (vn < 0) {
      var rna = cross(ra, N), rnb = cross(rb, N);
      var denom = invMA + invMB + invIA * dot(rna, rna) + invIB * dot(rnb, rnb);
      var j = -(1 + e) * vn / denom;
      applyImpulse(a, P, scale3(N, -j));
      applyImpulse(bb, P, scale3(N, j));

      rv = sub(pointVel(bb, P), pointVel(a, P));
      var vt = sub(rv, scale3(N, dot(rv, N)));
      var vtl = len3(vt);
      if (vtl > 1e-5) {
        var T = scale3(vt, -1 / vtl);
        var rta = cross(ra, T), rtb = cross(rb, T);
        var jt = vtl / (invMA + invMB + invIA * dot(rta, rta) + invIB * dot(rtb, rtb));
        jt = Math.min(jt, mu * j);
        applyImpulse(a, P, scale3(T, -jt));
        applyImpulse(bb, P, scale3(T, jt));
      }
    }
    if (pen > 0.0004) {
      var push = Math.min((pen - 0.0004) * 0.32, 0.004);
      var tot = invMA + invMB;
      if (!a.held) a.p = add(a.p, scale3(N, -push * invMA / tot));
      if (!bb.held) bb.p = add(bb.p, scale3(N, push * invMB / tot));
    }
  }

  var STEP = 1 / 240;
  function physics(dt) {
    var steps = Math.min(6, Math.max(1, Math.round(dt / STEP)));
    var h = dt / steps;
    for (var s = 0; s < steps; s++) {
      var i, b;
      for (i = 0; i < bodies.length; i++) {
        b = bodies[i];
        if (b.gone || b.held) continue;
        b.v[1] -= G * h;
        var dl = Math.exp(-0.45 * h), da = Math.exp(-1.5 * h);
        b.v = scale3(b.v, dl); b.w = scale3(b.w, da);
        b.p = add(b.p, scale3(b.v, h));
        b.q = qIntegrate(b.q, b.w, h);
      }
      for (var it = 0; it < 3; it++) {
        var sph = [];
        for (i = 0; i < bodies.length; i++) {
          b = bodies[i];
          if (b.gone) { sph.push(null); continue; }
          sph.push(bodySpheres(b));
        }
        for (i = 0; i < bodies.length; i++) {
          b = bodies[i];
          if (b.gone) continue;
          if (!b.held) for (var k = 0; k < sph[i].length; k++) resolveWorld(b, sph[i][k], 0.12, 0.5);
          for (var j = i + 1; j < bodies.length; j++) {
            var b2 = bodies[j];
            if (b2.gone) continue;
            if (Math.abs(b.p[0] - b2.p[0]) > 0.16 || Math.abs(b.p[1] - b2.p[1]) > 0.16 ||
                Math.abs(b.p[2] - b2.p[2]) > 0.16) continue;
            for (var ka = 0; ka < sph[i].length; ka++) for (var kb = 0; kb < sph[j].length; kb++) {
              bodyContact(b, sph[i][ka], b2, sph[j][kb], 0.10, 0.5);
            }
          }
        }
      }
    }

    // delivery: anything that reaches the bottom of the chute is won
    for (var i2 = 0; i2 < bodies.length; i2++) {
      var bd = bodies[i2];
      if (bd.gone || bd.held) continue;
      if (bd.p[1] < -0.20 && overChute(bd.p[0], bd.p[2])) {
        bd.gone = true;
        if (running || over) deliver(bd.K);
      }
      if (bd.p[1] < -0.9) bd.gone = true;   // safety net, should never fire
    }
    flushImpacts();
  }

  var lastKnock = 0, silent = false;
  function flushImpacts() {
    if (silent) { impacts.length = 0; return; }
    if (!impacts.length) return;
    var now = actx ? actx.currentTime : 0;
    if (actx && !muted && now - lastKnock > 0.028) {
      impacts.sort(function (a, b) { return b.s - a.s; });
      var n = Math.min(3, impacts.length);
      for (var i = 0; i < n; i++) sndKnock(impacts[i].s, impacts[i].mode);
      lastKnock = now;
    }
    impacts.length = 0;
  }

  // -------------------------------------------------------------- gameplay

  var running = false, over = false;
  var flash = 0, flashName = "", shake = 0;

  function deliver(K) {
    won.push(K);
    score += K.value;
    flash = 1; flashName = K.name;
    if (!reduceMotion) shake = 1;
    setHud();
    sndWin();
    if (typeof gtag === "function") gtag("event", "claw_prize", { prize: K.id, value: K.value });
  }

  function startDrop() {
    if (claw.phase !== "idle" || !running || over) return;
    claw.phase = "down";
    claw.t = 0;
    sndWinch(true);
  }

  function endRun() {
    over = true;
    running = false;
    if (score > best) {
      best = score;
      try { localStorage.setItem("claw_best", String(best)); } catch (e) {}
    }
    setHud();
    if (won.length > 0) {
      window.OPT_SHARE_TEXT = "I scored " + score + " on Claw Machine and grabbed " + won.length + " prize" + (won.length === 1 ? "" : "s") + " in ten drops. Beat that.";
      window.OPT_SHARE_LINE = score + " pts \u00b7 " + won.length + " prize" + (won.length === 1 ? "" : "s");
      window.OPT_SHARE_IMAGE = function () { draw(); return canvas; };
    } else { window.OPT_SHARE_TEXT = window.OPT_SHARE_LINE = window.OPT_SHARE_IMAGE = null; }
    showResults();
    if (typeof gtag === "function") gtag("event", "claw_run_end", { value: score, prizes: won.length });
  }

  /* Grip is mostly skill. centreErr is how far the jaw axis sat from the
   * prize's centre when the jaws closed; a dead-centre grab on a light prize
   * holds every time, an edge grab on the pin almost never does. The random
   * term is deliberately small — enough that a marginal grab is a real
   * gamble, not enough to make a good grab feel arbitrary. */
  function tryGrab() {
    var tip = clawTip();
    var bestB = null, bestErr = 1e9;
    for (var i = 0; i < bodies.length; i++) {
      var b = bodies[i];
      if (b.gone || b.held) continue;
      var dx = b.p[0] - tip[0], dz = b.p[2] - tip[2];
      var horiz = Math.sqrt(dx * dx + dz * dz);
      var dy = Math.abs(b.p[1] - tip[1]);
      if (horiz > GRAB_R || dy > 0.075) continue;
      if (horiz < bestErr) { bestErr = horiz; bestB = b; }
    }
    if (!bestB) { claw.grip = 0; claw.gripMax = 0; return; }

    var centre = 1 - clamp(bestErr / GRAB_R, 0, 1);        // 1 = perfect
    var weight = clamp(1 - (bestB.m - 0.13) / 0.22, 0.35, 1);
    var g = (0.22 + 0.78 * Math.pow(centre, 1.3)) * (0.60 + 0.40 * weight);
    g *= 0.88 + 0.24 * Math.random();
    claw.grip = clamp(g, 0, 1.35);
    claw.gripMax = claw.grip;
    bestB.held = true;
    bestB.v = [0, 0, 0]; bestB.w = [0, 0, 0];
    claw.holding = bestB;
  }

  function releaseHold(intoChute) {
    var b = claw.holding;
    if (!b) return;
    b.held = false;
    b.v = [claw.svx * 0.25, -0.05, claw.svz * 0.25];
    b.w = [(Math.random()-0.5) * 3, (Math.random()-0.5) * 3, (Math.random()-0.5) * 3];
    claw.holding = null;
    claw.grip = 0;
    if (!intoChute) sndSlip();
  }

  function updateClaw(dt) {
    var prevGx = claw.gx, prevGz = claw.gz;

    if (claw.phase === "idle") {
      var mx = clamp(claw.tx, -PIT_X + 0.04, PIT_X - 0.04);
      var mz = clamp(claw.tz, -PIT_Z + 0.04, PIT_Z - 0.04);
      claw.gx += clamp(mx - claw.gx, -SPEED * dt, SPEED * dt);
      claw.gz += clamp(mz - claw.gz, -SPEED * dt, SPEED * dt);
      claw.jaw = lerp(claw.jaw, 1, 1 - Math.exp(-9 * dt));
      claw.y = lerp(claw.y, RAIL_Y - 0.06, 1 - Math.exp(-7 * dt));
    } else if (claw.phase === "down") {
      claw.y -= 0.42 * dt;
      pushAside();
      /* Bleed the swing off as the cable pays out. A claw still swinging when
       * the jaws close lands up to 6cm from where you aimed — most of the grab
       * radius — which reads as the machine ignoring your input. */
      claw.svx *= Math.exp(-3.2 * dt); claw.svz *= Math.exp(-3.2 * dt);
      claw.sx *= Math.exp(-2.4 * dt); claw.sz *= Math.exp(-2.4 * dt);
      var floor = overChute(claw.gx, claw.gz) ? -0.10 : 0.030;
      if (claw.y - JAW_Y <= floor || claw.t > 3) { claw.phase = "close"; claw.t = 0; sndWinch(false); sndJaw(); }
    } else if (claw.phase === "close") {
      claw.jaw = lerp(claw.jaw, 0.08, 1 - Math.exp(-11 * dt));
      claw.svx *= Math.exp(-4 * dt); claw.svz *= Math.exp(-4 * dt);
      claw.sx *= Math.exp(-3 * dt); claw.sz *= Math.exp(-3 * dt);
      if (claw.t > 0.42) {
        tryGrab();
        claw.phase = "up"; claw.t = 0; sndWinch(true);
      }
    } else if (claw.phase === "up") {
      claw.y = Math.min(RAIL_Y - 0.06, claw.y + 0.34 * dt);
      slipCheck(dt, 0.75);
      if (claw.y >= RAIL_Y - 0.061) { claw.phase = "carry"; claw.t = 0; sndWinch(false); }
    } else if (claw.phase === "carry") {
      claw.gx += clamp(DROP_X - claw.gx, -SPEED * dt, SPEED * dt);
      claw.gz += clamp(DROP_Z - claw.gz, -SPEED * dt, SPEED * dt);
      slipCheck(dt, 1.4);
      if (Math.abs(claw.gx - DROP_X) < 0.004 && Math.abs(claw.gz - DROP_Z) < 0.004 && claw.t > 0.35) {
        claw.phase = "open"; claw.t = 0; sndJaw();
      }
    } else if (claw.phase === "open") {
      claw.jaw = lerp(claw.jaw, 1, 1 - Math.exp(-10 * dt));
      if (claw.t > 0.30) {
        if (claw.holding) releaseHold(true);
        claw.phase = "settle"; claw.t = 0;
      }
    } else if (claw.phase === "settle") {
      if (claw.t > 0.9) {
        claw.phase = "idle";
        claw.tx = claw.gx; claw.tz = claw.gz;
        if (dropsUsed >= TOTAL_DROPS) endRun();
      }
    }
    claw.t += dt;

    /* The claw hangs from the carriage on a cable, so it lags when the carriage
     * starts and overshoots when it stops: theta'' = -(g/L)theta - c*theta' - a/L,
     * driven by the carriage's own acceleration. That swing is where the tension
     * lives — a prize that survives the lift can still be shaken loose on the
     * way to the chute, and slowing down early is a real skill. */
    var vx = (claw.gx - prevGx) / Math.max(dt, 1e-4);
    var vz = (claw.gz - prevGz) / Math.max(dt, 1e-4);
    var accX = (vx - claw.lastVx) / Math.max(dt, 1e-4);
    var accZ = (vz - claw.lastVz) / Math.max(dt, 1e-4);
    var L = Math.max(0.08, RAIL_Y - claw.y);
    var k = G / L;
    claw.svx += (-k * claw.sx - 2.6 * claw.svx - (accX / L) * 0.010) * dt;
    claw.svz += (-k * claw.sz - 2.6 * claw.svz - (accZ / L) * 0.010) * dt;
    claw.sx = clamp(claw.sx + claw.svx * dt, -0.22, 0.22);
    claw.sz = clamp(claw.sz + claw.svz * dt, -0.22, 0.22);
    claw.lastVx = vx; claw.lastVz = vz;

    // whatever is held rides the jaws
    if (claw.holding) {
      var tip = clawTip();
      claw.holding.p = [tip[0], tip[1] - 0.012, tip[2]];
      claw.holding.v = [0, 0, 0];
      claw.holding.w = scale3(claw.holding.w, Math.exp(-4 * dt));
      claw.holding.q = qIntegrate(claw.holding.q, claw.holding.w, dt);
    }
    if (flash > 0) flash = Math.max(0, flash - dt * 0.7);
    if (shake > 0) shake = Math.max(0, shake - dt * 2.4);
  }

  /* The jaws shove prizes out of the way on the way down — without it the claw
   * visibly passes through the pile.
   *
   * ⚠ It must be an ANNULUS, not a disc. The first pass pushed everything
   * within reach, including the prize sitting directly under the claw, so the
   * descent shoved its own target clear and the jaws closed on nothing: a
   * dead-centre aim caught something only 4 times in 14. The prize under the
   * claw is the one being captured; only the ones the blades would actually
   * strike on the way past get moved. */
  var JAW_INNER = 0.030;
  function pushAside() {
    var tip = clawTip();
    for (var i = 0; i < bodies.length; i++) {
      var b = bodies[i];
      if (b.gone || b.held) continue;
      var dx = b.p[0] - tip[0], dz = b.p[2] - tip[2];
      var d = Math.sqrt(dx * dx + dz * dz);
      var reach = 0.052 + 0.040 * claw.jaw;
      if (d > JAW_INNER && d < reach && Math.abs(b.p[1] - tip[1]) < 0.075) {
        var f = (reach - d) * 2.4;
        b.v[0] += (dx / d) * f;
        b.v[2] += (dz / d) * f;
        b.v[1] += 0.015;
      }
    }
  }

  function slipCheck(dt, rate) {
    if (!claw.holding) return;
    var swing = Math.sqrt(claw.svx * claw.svx + claw.svz * claw.svz);
    var load = claw.holding.m / 0.20;
    claw.grip -= dt * rate * (0.16 + swing * 0.55) * load;
    if (claw.grip <= 0) releaseHold(false);
  }

  // ----------------------------------------------------------------- audio

  var actx = null, master = null, comp = null, verb = null, muted = false;
  try { muted = localStorage.getItem("claw_sound") === "off"; } catch (e) {}

  function initAudio() {
    if (actx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    // iOS: a one-sample silent buffer on the first gesture unlocks the context
    var b = actx.createBuffer(1, 1, 22050);
    var s = actx.createBufferSource(); s.buffer = b; s.connect(actx.destination); s.start(0);

    master = actx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    var lp = actx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 12000;
    comp = actx.createDynamicsCompressor();
    comp.threshold.value = -15; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.22;
    comp.connect(lp); lp.connect(master); master.connect(actx.destination);

    /* A small bright room. A claw machine is a glass and steel box — the tail
     * is short and hard, nothing like a hall. */
    var len = Math.floor(actx.sampleRate * 0.9);
    var ir = actx.createBuffer(2, len, actx.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = ir.getChannelData(ch), lastv = 0;
      for (var i = 0; i < len; i++) {
        var t = i / len;
        var n = (Math.random() * 2 - 1) * Math.pow(1 - t, 3.4);
        lastv = lastv * 0.42 + n * 0.58;         // lowpass so the tail is not grainy
        d[i] = lastv;
      }
    }
    verb = actx.createConvolver(); verb.buffer = ir;
    var vg = actx.createGain(); vg.gain.value = 0.30;
    verb.connect(vg); vg.connect(comp);

    startAmbience();
  }

  function noiseBuf(sec) {
    var len = Math.floor(actx.sampleRate * sec);
    var b = actx.createBuffer(1, len, actx.sampleRate);
    var d = b.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  /* ---- modal percussion -------------------------------------------------
   *
   * Everything struck in this cabinet is synthesized by exciting NOISE through
   * a bank of parallel resonant bandpasses tuned to the object's own modes,
   * rather than by summing oscillators at those frequencies.
   *
   * That distinction is the whole difference between "a real thing was hit"
   * and "a computer played a chord". A summed sine/triangle stack has perfectly
   * steady, perfectly tuned partials that all start and stop together — no
   * physical object does that. A filter bank rings the way the object does:
   * each mode decays at its OWN rate (fast for the high ones), the attack is
   * a dense noisy transient rather than instant tone, and every strike differs
   * because the excitation is noise.
   *
   * A high-Q bandpass rings for roughly Q/(pi*f) seconds, so Q is derived from
   * the decay each mode should have instead of being a magic number. */
  function modalHitAt(t, opts) { opts.at = t; modalHit(opts); }
  function modalHit(opts) {
    if (!actx || muted) return;
    var t = opts.at || actx.currentTime;
    var dest = opts.dest || comp;
    var base = opts.base;
    var amp = opts.amp;

    // excitation: a very short noise burst, shaped by how hard the contact was
    var ex = actx.createBufferSource();
    ex.buffer = noiseBuf(0.05);
    var exFilt = actx.createBiquadFilter();
    exFilt.type = "highpass";
    exFilt.frequency.value = opts.exHighpass || 200;
    var exGain = actx.createGain();
    var burst = opts.burst || 0.004;
    exGain.gain.setValueAtTime(1.0, t);   // shape only — amp is applied per mode
    exGain.gain.exponentialRampToValueAtTime(0.0001, t + burst);
    ex.connect(exFilt); exFilt.connect(exGain);

    var longest = 0;
    for (var i = 0; i < opts.modes.length; i++) {
      var m = opts.modes[i];                 // [ratio, gain, decay]
      var f = base * m[0];
      if (f > 16000) continue;
      // a touch of scatter per strike: real objects are never struck twice
      // in exactly the same place, and the mode gains shift when they are
      var jitter = 1 + (Math.random() - 0.5) * 0.05;
      var decay = m[2] * (0.85 + Math.random() * 0.3);
      longest = Math.max(longest, decay);
      var bp = actx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = f * jitter;
      var Q = Math.max(1.2, Math.PI * f * decay);
      bp.Q.value = Q;
      /* Compensate the gain for Q. A bandpass is unity-gain at its centre for a
       * SINE, but only passes a band of width f/Q out of broadband noise, so
       * the tighter the resonance the quieter it gets — deriving Q from a short
       * decay made the whole click inaudible (measured peak RMS 0.00001, with
       * the modes landing at exactly the right frequencies). Output RMS from
       * noise scales as 1/sqrt(Q), so put that back. */
      var g = actx.createGain();
      g.gain.setValueAtTime(m[1] * amp * Math.sqrt(Q) * 6, t);
      g.gain.exponentialRampToValueAtTime(0.0004, t + decay);
      exGain.connect(bp); bp.connect(g); g.connect(dest);
      if (opts.verb !== false && verb) g.connect(verb);
    }
    ex.start(t);
    ex.stop(t + Math.min(2.5, longest + 0.1));
  }

  /* ---- ambience ---------------------------------------------------------
   *
   * A cabinet hum written as 60Hz + 120Hz alone is inaudible on a phone, whose
   * speaker rolls off long before that — the same lesson Accretion's
   * gravitational hum paid for. The upper partials are what actually carries. */
  var amb = null;
  function startAmbience() {
    if (!actx || amb) return;
    var g = actx.createGain(); g.gain.value = 0.05;
    var og = actx.createGain(); og.gain.value = 0.5;
    [[60, 1.0], [120.6, 0.7], [181, 0.34], [241, 0.16], [302, 0.07]].forEach(function (pair) {
      var o = actx.createOscillator();
      o.type = "sine";
      o.frequency.value = pair[0];
      var pg = actx.createGain(); pg.gain.value = pair[1];
      o.connect(pg); pg.connect(og);
      o.start();
    });
    og.connect(g);
    // fan / room air
    var n = actx.createBufferSource(); n.buffer = noiseBuf(2); n.loop = true;
    var nf = actx.createBiquadFilter(); nf.type = "bandpass"; nf.frequency.value = 380; nf.Q.value = 0.7;
    var ng = actx.createGain(); ng.gain.value = 0.22;
    n.connect(nf); nf.connect(ng); ng.connect(g);
    g.connect(comp);
    n.start();
    amb = g;
  }

  /* ---- gantry motor -----------------------------------------------------
   *
   * The first version was a sawtooth through a bandpass, which is a synth
   * patch, not a motor: a sawtooth carries every harmonic at 1/n and buzzes.
   * A real gantry motor is a low rumble, a GEAR-MESH tone an order of
   * magnitude above the shaft rate with a couple of harmonics, and bearing
   * hiss on top — and every one of those tracks how fast it is actually
   * moving. The mesh frequency wobbles slightly because no motor is steady. */
  var motor = null, motorGain = null, motorFilt = null;
  var meshOsc = [], meshGain = null, rumbleFilt = null, hissGain = null;
  function ensureMotor() {
    if (!actx || motor) return;
    motorGain = actx.createGain(); motorGain.gain.value = 0;

    // rumble: the frame and the belt
    motor = actx.createBufferSource(); motor.buffer = noiseBuf(2); motor.loop = true;
    rumbleFilt = actx.createBiquadFilter();
    rumbleFilt.type = "lowpass"; rumbleFilt.frequency.value = 240; rumbleFilt.Q.value = 0.8;
    var rg = actx.createGain(); rg.gain.value = 0.9;
    motor.connect(rumbleFilt); rumbleFilt.connect(rg); rg.connect(motorGain);

    // gear mesh: a small harmonic stack, quiet and slightly detuned
    meshGain = actx.createGain(); meshGain.gain.value = 0.18;
    [[1, 1.0], [2, 0.42], [3, 0.18]].forEach(function (h) {
      var o = actx.createOscillator();
      o.type = "sine";
      o.frequency.value = 190 * h[0];
      o.detune.value = (Math.random() - 0.5) * 14;
      var g = actx.createGain(); g.gain.value = h[1];
      o.connect(g); g.connect(meshGain);
      o.start();
      meshOsc.push(o);
    });
    meshGain.connect(motorGain);

    // bearing hiss
    var hn = actx.createBufferSource(); hn.buffer = noiseBuf(2); hn.loop = true;
    var hf = actx.createBiquadFilter(); hf.type = "bandpass"; hf.frequency.value = 3200; hf.Q.value = 1.1;
    hissGain = actx.createGain(); hissGain.gain.value = 0.05;
    hn.connect(hf); hf.connect(hissGain); hissGain.connect(motorGain);

    motorFilt = actx.createBiquadFilter();
    motorFilt.type = "lowpass"; motorFilt.frequency.value = 5200;
    motorGain.connect(motorFilt); motorFilt.connect(comp);
    motor.start(); hn.start();
  }
  function motorLevel(speed) {
    if (!actx || !motorGain) return;
    var t = actx.currentTime;
    var sp = Math.min(1, speed);
    motorGain.gain.setTargetAtTime(sp * 0.15, t, 0.06);
    // everything tracks the speed, which is what reads as a motor under load
    rumbleFilt.frequency.setTargetAtTime(150 + sp * 220, t, 0.08);
    var mesh = 150 + sp * 210;
    for (var i = 0; i < meshOsc.length; i++) {
      meshOsc[i].frequency.setTargetAtTime(mesh * (i + 1) * (1 + (Math.random() - 0.5) * 0.01), t, 0.09);
    }
    // measured almost purely tonal at first (flatness 0.0006); a motor is mostly noise
    if (meshGain) meshGain.gain.setTargetAtTime(0.06 + sp * 0.14, t, 0.08);
    if (hissGain) hissGain.gain.setTargetAtTime(0.02 + sp * 0.16, t, 0.08);
  }

  /* The winch is a smaller, faster motor under load — same construction, higher
   * mesh rate, and it sags in pitch while lifting because it is working. */
  var winch = null, winchGain = null, winchOsc = [], winchNoise = null;
  function sndWinch(on) {
    if (!actx) return;
    if (!winch) {
      winchGain = actx.createGain(); winchGain.gain.value = 0;
      winch = actx.createGain();
      [[1, 1.0], [2, 0.30], [3.02, 0.14]].forEach(function (h) {
        var o = actx.createOscillator();
        o.type = "sine";
        o.frequency.value = 320 * h[0];
        o.detune.value = (Math.random() - 0.5) * 10;
        var g = actx.createGain(); g.gain.value = h[1];
        o.connect(g); g.connect(winch);
        o.start();
        winchOsc.push(o);
      });
      winchNoise = actx.createBufferSource(); winchNoise.buffer = noiseBuf(2); winchNoise.loop = true;
      var wf = actx.createBiquadFilter(); wf.type = "bandpass"; wf.frequency.value = 1800; wf.Q.value = 0.9;
      var wg = actx.createGain(); wg.gain.value = 0.22;
      winchNoise.connect(wf); wf.connect(wg); wg.connect(winch);
      winchNoise.start();
      var lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 4200;
      winch.connect(winchGain); winchGain.connect(lp); lp.connect(comp);
    }
    var t = actx.currentTime;
    winchGain.gain.setTargetAtTime(on ? 0.05 : 0, t, 0.05);
    if (on) {
      // spin up, then settle a little flat under load
      for (var i = 0; i < winchOsc.length; i++) {
        var base = 320 * (i === 2 ? 3.02 : i + 1);
        winchOsc[i].frequency.cancelScheduledValues(t);
        winchOsc[i].frequency.setValueAtTime(base * 0.86, t);
        winchOsc[i].frequency.linearRampToValueAtTime(base, t + 0.22);
        winchOsc[i].frequency.linearRampToValueAtTime(base * 0.965, t + 0.9);
      }
    }
  }

  /* Steel jaws closing. Struck steel is dense and INHARMONIC and gone fast —
   * the earlier pair of triangle oscillators at 1840/2790 read as a tuned
   * chime because two clean partials in a simple ratio is a chord. */
  function sndJaw() {
    modalHit({
      base: 1420 * (0.94 + Math.random() * 0.12),
      amp: 1.15,
      burst: 0.003,
      exHighpass: 700,
      modes: [[1, 0.9, 0.085], [2.31, 0.7, 0.055], [4.07, 0.45, 0.032], [6.62, 0.26, 0.020], [9.4, 0.14, 0.013]]
    });
  }

  /* Prizes landing. The material decides the modes: plush is a damped thud
   * with no ring at all, plastic is a short mid knock, glass is a bright
   * short ping. Same synth, three different objects. */
  function sndKnock(vel, mode) {
    if (!actx || muted) return;
    var amp = clamp(vel * 0.85, 0.05, 0.95);
    if (mode === 4) {                                  // plush
      var t = actx.currentTime;
      var n = actx.createBufferSource(); n.buffer = noiseBuf(0.12);
      var nf = actx.createBiquadFilter(); nf.type = "lowpass"; nf.frequency.value = 330; nf.Q.value = 0.6;
      var ng = actx.createGain();
      ng.gain.setValueAtTime(amp * 0.9, t);
      ng.gain.exponentialRampToValueAtTime(0.0005, t + 0.11);
      n.connect(nf); nf.connect(ng); ng.connect(comp);
      n.start(t); n.stop(t + 0.14);
      modalHit({ base: 150, amp: amp * 0.5, burst: 0.006, exHighpass: 60,
                 modes: [[1, 0.8, 0.055], [1.9, 0.3, 0.03]] });
      return;
    }
    if (mode === 2) {                                  // glass / hard shell
      modalHit({ base: 2150 * (0.9 + Math.random() * 0.2), amp: amp,
                 burst: 0.002, exHighpass: 900,
                 modes: [[1, 0.9, 0.10], [2.54, 0.55, 0.06], [4.62, 0.3, 0.035], [7.1, 0.15, 0.022]] });
      return;
    }
    modalHit({ base: 620 * (0.88 + Math.random() * 0.24), amp: amp,   // resin / plastic
               burst: 0.004, exHighpass: 300,
               modes: [[1, 0.9, 0.055], [2.18, 0.5, 0.035], [3.9, 0.24, 0.022]] });
  }

  // the jaws giving up: one small dry tick, then nothing
  function sndSlip() {
    modalHit({ base: 1180, amp: 0.45, burst: 0.003, exHighpass: 600,
               modes: [[1, 0.8, 0.11], [2.44, 0.45, 0.07], [4.2, 0.2, 0.04]] });
  }

  /* A win. The chute rumble is the prize physically arriving; the flourish is
   * struck BELLS rather than a synth arpeggio, so it belongs to the same
   * cabinet as everything else. Bell modes are famously inharmonic. */
  function sndWin() {
    if (!actx || muted) return;
    var t = actx.currentTime;
    var n = actx.createBufferSource(); n.buffer = noiseBuf(0.4);
    var nf = actx.createBiquadFilter(); nf.type = "lowpass"; nf.frequency.value = 300;
    var ng = actx.createGain();
    ng.gain.setValueAtTime(0.001, t);
    ng.gain.exponentialRampToValueAtTime(0.20, t + 0.05);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    n.connect(nf); nf.connect(ng); ng.connect(comp); if (verb) ng.connect(verb);
    n.start(t); n.stop(t + 0.45);

    [0, 4, 7].forEach(function (semi, i) {
      bellHit(659.25 * Math.pow(2, semi / 12), 0.16 / (i * 0.3 + 1), i * 95);
    });
  }

  /* Bells are ADDITIVE, deliberately, while contacts are modal.
   *
   * A noise burst through a bank of very narrow filters cannot drive a tail
   * that rings for a second — measured, it came out five times quieter than a
   * click. Long ringing tones are properly synthesized as partials with their
   * own decays, and for a bell those partials are INHARMONIC (roughly
   * 1 : 2 : 3.01 : 4.17 : 5.43, the stretch that makes a bell a bell). What
   * made the first version sound like a synth arpeggio was harmonic ratios and
   * no strike, so the strike transient below is the other half of the fix. */
  var BELL_MODES = [[0.5, 0.30, 1.6], [1, 1.0, 1.2], [2.0, 0.55, 0.9],
                    [3.01, 0.36, 0.62], [4.17, 0.2, 0.42], [5.43, 0.1, 0.28]];
  function bellHit(base, amp, delayMs) {
    if (!actx || muted) return;
    var t = actx.currentTime + (delayMs || 0) / 1000;
    // the clapper: a short filtered-noise contact, or it starts from nowhere
    modalHitAt(t, {
      base: base * 4.2, amp: amp * 0.5, burst: 0.002, exHighpass: 900,
      modes: [[1, 0.8, 0.020], [1.9, 0.4, 0.012]]
    });
    for (var i = 0; i < BELL_MODES.length; i++) {
      var m = BELL_MODES[i];
      var f = base * m[0];
      if (f > 14000) continue;
      var o = actx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 8;
      var g = actx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(m[1] * amp, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0004, t + m[2]);
      o.connect(g); g.connect(comp);
      if (verb) g.connect(verb);
      o.start(t); o.stop(t + m[2] + 0.05);
    }
  }

  // ------------------------------------------------------------------- HUD

  var elDrops = document.getElementById("drops");
  var elScore = document.getElementById("score");
  var elBest = document.getElementById("best");
  var elGrip = document.getElementById("gripFill");
  var elGripWrap = document.getElementById("grip");
  var elPrize = document.getElementById("prize");
  var hud = document.getElementById("hud");
  var overlay = document.getElementById("overlay");
  var ovTitle = document.getElementById("ovTitle");
  var ovEyebrow = document.getElementById("ovEyebrow");
  var ovText = document.getElementById("ovText");
  var ovBtn = document.getElementById("ovBtn");
  var ovHaul = document.getElementById("ovHaul");
  var dropBtn = document.getElementById("dropBtn");
  var soundBtn = document.getElementById("soundBtn");

  function setHud() {
    elDrops.textContent = Math.min(dropsUsed + (claw.phase === "idle" ? 1 : 0), TOTAL_DROPS) + " / " + TOTAL_DROPS;
    elScore.textContent = String(score);
    elBest.textContent = String(best);
  }

  function showResults() {
    var haul = {};
    for (var i = 0; i < won.length; i++) haul[won[i].name] = (haul[won[i].name] || 0) + 1;
    var names = Object.keys(haul);
    ovEyebrow.textContent = won.length ? "You cleaned up" : "The claw wins this time";
    ovTitle.textContent = score + " points";
    ovText.textContent = won.length
      ? "Ten drops, " + won.length + (won.length === 1 ? " prize" : " prizes") + " in the bin."
      : "Ten drops, nothing in the bin. Centre the claw right over one prize — the grip holds when the grab is clean.";
    ovHaul.innerHTML = "";
    for (var k = 0; k < names.length; k++) {
      var li = document.createElement("li");
      li.textContent = names[k] + (haul[names[k]] > 1 ? " ×" + haul[names[k]] : "");
      ovHaul.appendChild(li);
    }
    ovHaul.hidden = names.length === 0;
    ovBtn.textContent = "Play again";
    overlay.hidden = false;
  }

  /* Let the pile come to rest before anyone sees it. A freshly dumped pit is
   * still bouncing, and a prize that hops the chute lip on its own hands out
   * free points before the first drop — which is exactly what happened on the
   * first play-through. A stocked machine is a settled machine. */
  function settlePit() {
    silent = true;
    for (var i = 0; i < 260; i++) physics(1 / 120);
    for (var j = 0; j < bodies.length; j++) { bodies[j].v = [0,0,0]; bodies[j].w = [0,0,0]; }
    silent = false;
  }

  function newRun() {
    /* Clear both flags BEFORE restocking: settlePit runs real physics, and if
     * `over` were still true from the last run a prize tumbling into the chute
     * during the settle would score. */
    running = false; over = false;
    stockPit();
    settlePit();
    won = []; dropsUsed = 0; score = 0; running = true;
    claw.gx = 0; claw.gz = 0; claw.tx = 0; claw.tz = 0;
    claw.y = RAIL_Y - 0.06; claw.jaw = 1; claw.phase = "idle";
    claw.sx = claw.sz = claw.svx = claw.svz = 0;
    claw.holding = null; claw.grip = 0;
    overlay.hidden = true;
    hud.hidden = false;
    dropBtn.hidden = false;
    ovHaul.hidden = true;
    setHud();
  }

  ovBtn.addEventListener("click", function () {
    initAudio();
    if (actx && actx.state === "suspended") actx.resume();
    newRun();
  });

  soundBtn.addEventListener("click", function () {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.9;
    soundBtn.setAttribute("aria-pressed", String(!muted));
    soundBtn.textContent = muted ? "♪̸" : "♪";
    try { localStorage.setItem("claw_sound", muted ? "off" : "on"); } catch (e) {}
  });
  soundBtn.setAttribute("aria-pressed", String(!muted));
  soundBtn.textContent = muted ? "♪̸" : "♪";

  dropBtn.addEventListener("click", function () {
    if (claw.phase !== "idle" || !running) return;
    dropsUsed++;
    setHud();
    startDrop();
  });

  // ----------------------------------------------------------------- input
  /* Steering positions the gantry by projecting the pointer onto a horizontal
   * plane through the middle of the pit, so the claw goes where your finger is
   * rather than tracking a screen-space delta. */

  /* Looking down INTO the tray. A claw machine's whole readable moment is the
   * plan view of the pile with the claw hanging over it; a low eye-level shot
   * is how you would photograph the cabinet, and it is useless to play.
   *
   * The camera is DERIVED from the aspect ratio rather than nudged by it. A
   * hand-tuned "pull back a bit on narrow screens" fudge left the pit clipped
   * off both edges in portrait. Solving for the distance that fits the tray in
   * the horizontal field of view cannot be off, at any size. The elevation also
   * steepens as the frame narrows, because an overhead view maps a square
   * footprint onto a tall frame far better than a raking one. */
  var center = [0, 0.03, -0.02], upv = [0, 1, 0];
  var FOV = 46 * Math.PI / 180;
  var FIT_W = 0.415, FIT_H = 0.30;          // half-extents the frame must contain
  var curEye = [0, 0.74, 0.94];

  function cameraFor(asp) {
    /* Only a MILD steepening on narrow frames. Going properly overhead sounds
     * right and is wrong: a tall frame showing a 0.83m-wide tray must cover
     * ~1.8m of world vertically no matter what, and a steep camera spends all
     * of it on empty air above the back wall. A gentler angle spends it on the
     * cabinet itself, which is why the marquee and the base below exist. */
    var portrait = clamp((1.0 - asp) / 0.55, 0, 1);
    var el = lerp(37, 44, portrait) * Math.PI / 180;
    var th = Math.tan(FOV / 2);
    var needW = FIT_W / (th * asp);
    var needH = (FIT_H + 0.10 * portrait) / th;
    var d = Math.max(1.12, needW, needH);
    return [center[0], center[1] + Math.sin(el) * d, center[2] + Math.cos(el) * d];
  }

  function pointerToPit(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    var ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    var ndcY = 1 - ((clientY - rect.top) / rect.height) * 2;
    var e = curEye;
    var f = norm3(sub(center, e));
    var r = norm3(cross(f, upv));
    var u = cross(r, f);
    var th = Math.tan(FOV / 2);
    var asp = rect.width / rect.height;
    var dir = norm3(add(add(scale3(r, ndcX * th * asp), scale3(u, ndcY * th)), f));
    var planeY = 0.10;
    if (Math.abs(dir[1]) < 1e-5) return null;
    var t = (planeY - e[1]) / dir[1];
    if (t < 0) return null;
    return [e[0] + dir[0] * t, planeY, e[2] + dir[2] * t];
  }

  var dragging = false;
  function steer(e) {
    if (claw.phase !== "idle" || !running) return;
    var hit = pointerToPit(e.clientX, e.clientY);
    if (!hit) return;
    claw.tx = clamp(hit[0], -PIT_X + 0.04, PIT_X - 0.04);
    claw.tz = clamp(hit[2], -PIT_Z + 0.04, PIT_Z - 0.04);
  }
  canvas.addEventListener("pointerdown", function (e) {
    initAudio();
    if (actx && actx.state === "suspended") actx.resume();
    dragging = true;
    if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (er) {} }
    steer(e);
  });
  canvas.addEventListener("pointermove", function (e) { if (dragging) steer(e); });
  canvas.addEventListener("pointerup", function () { dragging = false; });
  canvas.addEventListener("pointercancel", function () { dragging = false; });

  window.addEventListener("keydown", function (e) {
    if (overlay.hidden === false && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault(); ovBtn.click(); return;
    }
    if (!running || claw.phase !== "idle") return;
    var d = 0.045;
    if (e.key === "ArrowLeft") { claw.tx = clamp(claw.tx - d, -PIT_X + 0.04, PIT_X - 0.04); e.preventDefault(); }
    else if (e.key === "ArrowRight") { claw.tx = clamp(claw.tx + d, -PIT_X + 0.04, PIT_X - 0.04); e.preventDefault(); }
    else if (e.key === "ArrowUp") { claw.tz = clamp(claw.tz - d, -PIT_Z + 0.04, PIT_Z - 0.04); e.preventDefault(); }
    else if (e.key === "ArrowDown") { claw.tz = clamp(claw.tz + d, -PIT_Z + 0.04, PIT_Z - 0.04); e.preventDefault(); }
    else if (e.key === " " || e.key === "Enter") { e.preventDefault(); dropBtn.click(); }
  });

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

  function draw() {
    var asp = canvas.width / Math.max(1, canvas.height);
    curEye = cameraFor(asp);
    var e2 = curEye;
    var sh = shake > 0 ? shake * 0.006 : 0;
    if (sh) { e2 = [e2[0] + (Math.random()-0.5)*sh, e2[1] + (Math.random()-0.5)*sh, e2[2]]; }

    gl.uniformMatrix4fv(U.uProj, false, new Float32Array(mPerspective(FOV, asp, 0.02, 12)));
    gl.uniformMatrix4fv(U.uView, false, new Float32Array(mLookAt(e2, center, upv)));
    gl.uniform3fv(U.uEye, new Float32Array(e2));

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND);

    drawMesh(meshCabinet, mIdent(), 5);
    drawMesh(meshLights, mIdent(), 1, 1, 0.92);
    drawMesh(meshNeon, mIdent(), 1, 1, 1);
    drawMesh(meshRail, mIdent(), 3);
    drawMesh(meshCarriage, mTranslate(claw.gx, 0, 0), 3);
    drawMesh(meshTrolley, mTranslate(claw.gx, 0, claw.gz), 3);

    // cable
    var L = RAIL_Y - claw.y;
    var tipx = claw.gx + Math.sin(claw.sx) * L, tipz = claw.gz + Math.sin(claw.sz) * L;
    drawMesh(meshCable, mMul(mTranslate((claw.gx + tipx) / 2, (RAIL_Y + claw.y) / 2 + 0.03, (claw.gz + tipz) / 2),
                             mScale(1, Math.max(0.02, L) / 0.10, 1)), 3);

    // claw hub + three jaws
    var hubM = mTranslate(tipx, claw.y, tipz);
    drawMesh(meshHub, hubM, 3);
    for (var j = 0; j < 3; j++) {
      var yaw = mRotY((j / 3) * Math.PI * 2);
      var openAng = -0.62 + claw.jaw * 0.72;
      var m = mMul(hubM, mMul(yaw, mRotZ(openAng)));
      drawMesh(meshJaw, m, 3);
    }

    /* Contact shadows first, on the floor plane, with depth writes off so they
     * blend into one soft pool under a pile instead of z-fighting each other. */
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    for (var si = 0; si < bodies.length; si++) {
      var sb = bodies[si];
      if (sb.gone || overChute(sb.p[0], sb.p[2])) continue;
      var h = clamp(sb.p[1] - sb.rmax, 0, 0.34);
      var alpha = 0.46 * Math.exp(-h * 7.5);
      if (alpha < 0.015) continue;
      var sc = sb.rmax * (0.94 + h * 1.6);
      drawMesh(meshShadow, mMul(mTranslate(sb.p[0], 0.0015, sb.p[2]), mScale(sc, 1, sc)), 1, alpha);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // prizes
    for (var i = 0; i < bodies.length; i++) {
      var b = bodies[i];
      if (b.gone) continue;
      var mm = mMul(mTranslate(b.p[0], b.p[1], b.p[2]), qToMat(b.q));
      drawMesh(PRIZE_MESH[b.K.id], mm, b.K.mode);
    }
  }

  var meshCable = (function () {
    var b = MB();
    mbBox(b, [0, 0, 0], [0.004, 0.05, 0.004], [0.30, 0.31, 0.36]);
    return mbUpload(b);
  })();

  // ------------------------------------------------------------------ loop

  var last = 0;
  function frame(ts) {
    var t = ts / 1000;
    var dt = last ? Math.min(0.05, t - last) : 0.016;
    last = t;

    if (running || over) {
      updateClaw(dt);
      physics(dt);
      motorLevel(Math.min(1, (Math.abs(claw.tx - claw.gx) + Math.abs(claw.tz - claw.gz)) * 3));
    } else {
      // attract: the claw drifts over the stocked pit behind the intro panel
      claw.tx = Math.sin(t * 0.42) * (PIT_X - 0.08);
      claw.tz = Math.sin(t * 0.29 + 1.1) * (PIT_Z - 0.08);
      claw.gx += clamp(claw.tx - claw.gx, -SPEED * dt * 0.6, SPEED * dt * 0.6);
      claw.gz += clamp(claw.tz - claw.gz, -SPEED * dt * 0.6, SPEED * dt * 0.6);
      physics(dt);
    }

    // grip meter appears once something is actually in the jaws
    var showGrip = !!claw.holding;
    elGripWrap.hidden = !showGrip;
    if (showGrip) elGrip.style.width = Math.round(clamp(claw.grip / Math.max(0.35, claw.gripMax), 0, 1) * 100) + "%";
    elPrize.textContent = flash > 0 ? flashName : "";
    elPrize.style.opacity = flash > 0 ? String(Math.min(1, flash * 2)) : "0";

    draw();
    requestAnimationFrame(frame);
  }

  stockPit();
  settlePit();
  setHud();
  requestAnimationFrame(frame);
})();
