/* Dice Roller — real 3D tumbling dice in raw WebGL (no libraries, no build).
 * Glossy polycarbonate dice on green felt: real rigid-body physics (quaternion
 * tumbling, vertex-vs-plane contacts with restitution + Coulomb friction,
 * settle detection, top-face read). Flick to throw or press Roll.
 *
 * Fair by construction — the "Teal" trick: each die's value is drawn with
 * crypto.getRandomValues (rejection-sampled, unbiased); the throw is simulated
 * invisibly to completion to see which face lands up; that die's numbers are
 * then swapped so the chosen value sits on the landing face BEFORE the visible
 * roll replays the identical (deterministic) physics. The motion you watch is
 * 100% real — only the paint moved. So "cryptographically fair" stays honest. */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var elTotal = document.getElementById("total");
  var elLabel = document.getElementById("rollLabel");
  var elDetail = document.getElementById("detail");
  var elBest = document.getElementById("best");
  var elHistory = document.getElementById("history");
  var elHint = document.getElementById("hint");
  var elFlash = document.getElementById("flash");
  var elConfetti = document.getElementById("confetti");
  var rollBtn = document.getElementById("rollBtn");
  var clearBtn = document.getElementById("clearBtn");
  var soundBtn = document.getElementById("soundBtn");
  var countVal = document.getElementById("countVal");
  var countUp = document.getElementById("countUp");
  var countDown = document.getElementById("countDown");
  var chips = [].slice.call(document.querySelectorAll(".die-chip"));

  var gl = canvas.getContext("webgl", { antialias: true, alpha: false, premultipliedAlpha: false })
        || canvas.getContext("experimental-webgl", { antialias: true });
  if (!gl) {
    var f = document.createElement("p");
    f.textContent = "This toy needs WebGL — try a different browser.";
    f.style.cssText = "position:fixed;inset:0;display:grid;place-items:center;color:#9aa;font:500 16px system-ui;text-align:center;padding:24px";
    document.body.appendChild(f);
    return;
  }

  /* =========================== tunables =========================== */
  var DIE_R = 0.62;            // circumradius (world units)
  var GY = -34;               // gravity (units/s²) — dice fall fast so they don't look floaty
  var RESTIT = 0.34;          // restitution (thuddy: low, forced to 0 as impacts slow)
  var MU = 0.42;              // Coulomb friction
  var LIN_DAMP = 0.006, ANG_DAMP = 0.03;   // per-step damping (settles fast)
  var DT = 1 / 120;           // fixed physics step
  var MAX_DICE = 8;
  var SETTLE_V = 0.2, SETTLE_W = 0.7, SETTLE_HOLD = 10; // settle thresholds
  var MAX_SIM_STEPS = 900;    // hard cap (~7.5s)
  var MAX_ROLL_SECS = 5;      // wall-clock safety: force-resolve the visible roll after this
  var MIRROR = 1;             // atlas U orientation (flip if digits read mirrored)
  var FILL = 0.44;            // how much of each atlas cell a face's circumradius fills

  // die instance colors (glossy plastic) — base + number ink, chosen per die
  var PALETTE = [
    { base: [0.66, 0.08, 0.11], ink: "#fdf1de" }, // casino red
    { base: [0.82, 0.77, 0.66], ink: "#241d16" }, // ivory
    { base: [0.07, 0.26, 0.46], ink: "#eaf2ff" }, // deep blue
    { base: [0.78, 0.52, 0.08], ink: "#241a04" }, // amber
    { base: [0.10, 0.38, 0.30], ink: "#eafff4" }, // jade
    { base: [0.34, 0.15, 0.46], ink: "#f7ecff" }, // plum
    { base: [0.11, 0.13, 0.17], ink: "#eef1f6" }, // slate
    { base: [0.60, 0.16, 0.34], ink: "#fff0f6" }  // rose
  ];

  /* =========================== tiny math =========================== */
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function scale3(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function len3(a) { return Math.sqrt(dot(a, a)); }
  function norm3(a) { var l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

  function mIdent() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
  function mMul(a, b) {
    var o = new Array(16);
    for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return o;
  }
  function mTranslate(x, y, z) { var m = mIdent(); m[12] = x; m[13] = y; m[14] = z; return m; }
  function mScale(x, y, z) { var m = mIdent(); m[0] = x; m[5] = y; m[10] = z; return m; }
  function mPerspective(fovy, asp, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return [f / asp, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }
  function mLookAt(eye, center, up) {
    var z = norm3(sub(eye, center)), x = norm3(cross(up, z)), y = cross(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
  }
  function mInvert(m) {
    var inv = new Array(16), i;
    inv[0]=m[5]*m[10]*m[15]-m[5]*m[11]*m[14]-m[9]*m[6]*m[15]+m[9]*m[7]*m[14]+m[13]*m[6]*m[11]-m[13]*m[7]*m[10];
    inv[4]=-m[4]*m[10]*m[15]+m[4]*m[11]*m[14]+m[8]*m[6]*m[15]-m[8]*m[7]*m[14]-m[12]*m[6]*m[11]+m[12]*m[7]*m[10];
    inv[8]=m[4]*m[9]*m[15]-m[4]*m[11]*m[13]-m[8]*m[5]*m[15]+m[8]*m[7]*m[13]+m[12]*m[5]*m[11]-m[12]*m[7]*m[9];
    inv[12]=-m[4]*m[9]*m[14]+m[4]*m[10]*m[13]+m[8]*m[5]*m[14]-m[8]*m[6]*m[13]-m[12]*m[5]*m[10]+m[12]*m[6]*m[9];
    inv[1]=-m[1]*m[10]*m[15]+m[1]*m[11]*m[14]+m[9]*m[2]*m[15]-m[9]*m[3]*m[14]-m[13]*m[2]*m[11]+m[13]*m[3]*m[10];
    inv[5]=m[0]*m[10]*m[15]-m[0]*m[11]*m[14]-m[8]*m[2]*m[15]+m[8]*m[3]*m[14]+m[12]*m[2]*m[11]-m[12]*m[3]*m[10];
    inv[9]=-m[0]*m[9]*m[15]+m[0]*m[11]*m[13]+m[8]*m[1]*m[15]-m[8]*m[3]*m[13]-m[12]*m[1]*m[11]+m[12]*m[3]*m[9];
    inv[13]=m[0]*m[9]*m[14]-m[0]*m[10]*m[13]-m[8]*m[1]*m[14]+m[8]*m[2]*m[13]+m[12]*m[1]*m[10]-m[12]*m[2]*m[9];
    inv[2]=m[1]*m[6]*m[15]-m[1]*m[7]*m[14]-m[5]*m[2]*m[15]+m[5]*m[3]*m[14]+m[13]*m[2]*m[7]-m[13]*m[3]*m[6];
    inv[6]=-m[0]*m[6]*m[15]+m[0]*m[7]*m[14]+m[4]*m[2]*m[15]-m[4]*m[3]*m[14]-m[12]*m[2]*m[7]+m[12]*m[3]*m[6];
    inv[10]=m[0]*m[5]*m[15]-m[0]*m[7]*m[13]-m[4]*m[1]*m[15]+m[4]*m[3]*m[13]+m[12]*m[1]*m[7]-m[12]*m[3]*m[5];
    inv[14]=-m[0]*m[5]*m[14]+m[0]*m[6]*m[13]+m[4]*m[1]*m[14]-m[4]*m[2]*m[13]-m[12]*m[1]*m[6]+m[12]*m[2]*m[5];
    inv[3]=-m[1]*m[6]*m[11]+m[1]*m[7]*m[10]+m[5]*m[2]*m[11]-m[5]*m[3]*m[10]-m[9]*m[2]*m[7]+m[9]*m[3]*m[6];
    inv[7]=m[0]*m[6]*m[11]-m[0]*m[7]*m[10]-m[4]*m[2]*m[11]+m[4]*m[3]*m[10]+m[8]*m[2]*m[7]-m[8]*m[3]*m[6];
    inv[11]=-m[0]*m[5]*m[11]+m[0]*m[7]*m[9]+m[4]*m[1]*m[11]-m[4]*m[3]*m[9]-m[8]*m[1]*m[7]+m[8]*m[3]*m[5];
    inv[15]=m[0]*m[5]*m[10]-m[0]*m[6]*m[9]-m[4]*m[1]*m[10]+m[4]*m[2]*m[9]+m[8]*m[1]*m[6]-m[8]*m[2]*m[5];
    var det = m[0]*inv[0]+m[1]*inv[4]+m[2]*inv[8]+m[3]*inv[12];
    if (!det) return mIdent(); det = 1 / det; for (i = 0; i < 16; i++) inv[i] *= det; return inv;
  }
  function mNormal(m) {
    var a00=m[0],a01=m[1],a02=m[2],a10=m[4],a11=m[5],a12=m[6],a20=m[8],a21=m[9],a22=m[10];
    var b01=a22*a11-a12*a21,b11=-a22*a10+a12*a20,b21=a21*a10-a11*a20;
    var det=a00*b01+a01*b11+a02*b21; if(!det) return [1,0,0,0,1,0,0,0,1]; det=1/det;
    return [b01*det,(-a22*a01+a02*a21)*det,(a12*a01-a02*a11)*det,
            b11*det,(a22*a00-a02*a20)*det,(-a12*a00+a02*a10)*det,
            b21*det,(-a21*a00+a01*a20)*det,(a11*a00-a01*a10)*det];
  }

  /* quaternions [x,y,z,w] */
  function qIdent() { return [0, 0, 0, 1]; }
  function qMul(a, b) {
    return [
      a[3]*b[0] + a[0]*b[3] + a[1]*b[2] - a[2]*b[1],
      a[3]*b[1] - a[0]*b[2] + a[1]*b[3] + a[2]*b[0],
      a[3]*b[2] + a[0]*b[1] - a[1]*b[0] + a[2]*b[3],
      a[3]*b[3] - a[0]*b[0] - a[1]*b[1] - a[2]*b[2]
    ];
  }
  function qNorm(q) { var l = Math.sqrt(q[0]*q[0]+q[1]*q[1]+q[2]*q[2]+q[3]*q[3]) || 1; return [q[0]/l, q[1]/l, q[2]/l, q[3]/l]; }
  function qFromAxis(ax, ang) { var h = ang / 2, s = Math.sin(h), n = norm3(ax); return [n[0]*s, n[1]*s, n[2]*s, Math.cos(h)]; }
  function qRot(q, v) { var t = scale3(cross([q[0],q[1],q[2]], v), 2); return add(add(v, scale3(t, q[3])), cross([q[0],q[1],q[2]], t)); }
  function qToMat(q) {
    var x=q[0],y=q[1],z=q[2],w=q[3];
    var xx=x*x,yy=y*y,zz=z*z,xy=x*y,xz=x*z,yz=y*z,wx=w*x,wy=w*y,wz=w*z;
    return [1-2*(yy+zz), 2*(xy+wz), 2*(xz-wy), 0,
            2*(xy-wz), 1-2*(xx+zz), 2*(yz+wx), 0,
            2*(xz+wy), 2*(yz-wx), 1-2*(xx+yy), 0, 0,0,0,1];
  }
  function qIntegrate(q, w, dt) {
    var dq = qMul([w[0], w[1], w[2], 0], q);
    return qNorm([q[0] + 0.5*dq[0]*dt, q[1] + 0.5*dq[1]*dt, q[2] + 0.5*dq[2]*dt, q[3] + 0.5*dq[3]*dt]);
  }
  function qBetween(a, b) {
    var d = dot(a, b);
    if (d > 0.99999) return qIdent();
    if (d < -0.99999) { var ax = norm3(cross([1,0,0], a)); if (len3(ax) < 1e-4) ax = norm3(cross([0,1,0], a)); return qFromAxis(ax, Math.PI); }
    var c = cross(a, b); return qNorm([c[0], c[1], c[2], 1 + d]);
  }
  function qSlerp(a, b, t) {
    var d = a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3];
    if (d < 0) { b = [-b[0],-b[1],-b[2],-b[3]]; d = -d; }
    if (d > 0.9995) return qNorm([a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t, a[3]+(b[3]-a[3])*t]);
    var th = Math.acos(d), s = Math.sin(th), w1 = Math.sin((1-t)*th)/s, w2 = Math.sin(t*th)/s;
    return [a[0]*w1+b[0]*w2, a[1]*w1+b[1]*w2, a[2]*w1+b[2]*w2, a[3]*w1+b[3]*w2];
  }

  /* deterministic RNG + crypto fair int */
  function mulberry32(seed) {
    var s = seed >>> 0;
    return function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var cbuf = new Uint8Array(1);
  function cryptoInt(n) { // unbiased 1..n, for n <= 256 (die faces)
    try { var max = 256 - (256 % n), x; do { crypto.getRandomValues(cbuf); x = cbuf[0]; } while (x >= max); return (x % n) + 1; }
    catch (e) { return Math.floor(Math.random() * n) + 1; }
  }
  function cryptoSeed() { try { var a = new Uint32Array(1); crypto.getRandomValues(a); return a[0]; } catch (e) { return (Math.random() * 4294967296) >>> 0; } }

  /* =========================== die geometry =========================== */
  var PHI = (1 + Math.sqrt(5)) / 2;
  function newellNormal(pts) {
    var n = [0, 0, 0];
    for (var i = 0; i < pts.length; i++) {
      var c = pts[i], d = pts[(i + 1) % pts.length];
      n[0] += (c[1] - d[1]) * (c[2] + d[2]); n[1] += (c[2] - d[2]) * (c[0] + d[0]); n[2] += (c[0] - d[0]) * (c[1] + d[1]);
    }
    return norm3(n);
  }
  function centroid(pts) { var c = [0,0,0]; for (var i=0;i<pts.length;i++){c[0]+=pts[i][0];c[1]+=pts[i][1];c[2]+=pts[i][2];} return scale3(c, 1/pts.length); }
  function orderFace(verts, vi) {
    var pts = vi.map(function (i) { return verts[i]; });
    var c = centroid(pts), n = newellNormal(pts);
    if (dot(n, c) < 0) n = scale3(n, -1);
    var u = norm3(sub(pts[0], c)), w = cross(n, u);
    var order = vi.slice().sort(function (a, b) {
      var pa = sub(verts[a], c), pb = sub(verts[b], c);
      return Math.atan2(dot(pa, w), dot(pa, u)) - Math.atan2(dot(pb, w), dot(pb, u));
    });
    return { order: order, n: n, c: c };
  }
  // robust convex-hull face finder: every supporting plane through a vertex triple
  // whose outward normal has all vertices on/behind it → that plane's coplanar
  // vertices form a face. Correct for any convex polyhedron (used for the d12).
  function hullFaces(verts) {
    var n = verts.length, faces = [], seen = {}, i, j, k, m, s;
    for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) for (k = j + 1; k < n; k++) {
      var raw = cross(sub(verts[j], verts[i]), sub(verts[k], verts[i])), L = len3(raw);
      if (L < 1e-6) continue; raw = scale3(raw, 1 / L);
      for (s = 0; s < 2; s++) {
        var nrm = s ? [-raw[0], -raw[1], -raw[2]] : raw;
        var o = dot(verts[i], nrm), maxd = -1e9;
        for (m = 0; m < n; m++) { var d = dot(verts[m], nrm); if (d > maxd) maxd = d; }
        if (maxd - o > 1e-3) continue; // not the outer supporting plane on this side
        var key = Math.round(nrm[0] * 1e3) + "," + Math.round(nrm[1] * 1e3) + "," + Math.round(nrm[2] * 1e3);
        if (seen[key]) continue; seen[key] = 1;
        var f = []; for (m = 0; m < n; m++) if (Math.abs(dot(verts[m], nrm) - o) < 1e-3) f.push(m);
        if (f.length >= 3) faces.push(f);
      }
    }
    return faces;
  }
  function assignOpposite(norms, total, start) {
    var val = new Array(norms.length); for (var i = 0; i < val.length; i++) val[i] = -1;
    var v = start;
    for (i = 0; i < norms.length; i++) {
      if (val[i] >= 0) continue;
      var best = -1, bd = 2;
      for (var j = 0; j < norms.length; j++) { if (j === i || val[j] >= 0) continue; var d = dot(norms[i], norms[j]); if (d < bd) { bd = d; best = j; } }
      val[i] = v; if (best >= 0) val[best] = total - v; v++;
    }
    return val;
  }

  function buildDieType(sides) {
    var verts = [], faceVi = [], isD4 = (sides === 4), a1, b1, d1, k;
    var pm = [-1, 1];
    if (sides === 4) {
      verts = [[1,1,1],[1,-1,-1],[-1,1,-1],[-1,-1,1]];
      faceVi = [[1,2,3],[0,2,3],[0,1,3],[0,1,2]];
    } else if (sides === 6) {
      verts = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
      faceVi = [[4,5,6,7],[0,1,2,3],[1,5,6,2],[0,4,7,3],[3,2,6,7],[0,1,5,4]];
    } else if (sides === 8) {
      verts = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
      faceVi = [[0,2,4],[0,2,5],[0,3,4],[0,3,5],[1,2,4],[1,2,5],[1,3,4],[1,3,5]];
    } else if (sides === 10) {
      var cc = Math.tan(18 * Math.PI / 180); cc = cc * cc;
      for (k = 0; k < 10; k++) { var a = k * 36 * Math.PI / 180; verts.push([Math.cos(a), (k % 2 ? -cc : cc), Math.sin(a)]); }
      verts.push([0, 1, 0]); verts.push([0, -1, 0]);
      for (k = 0; k < 10; k++) faceVi.push([(k % 2 === 0) ? 10 : 11, k, (k + 1) % 10, (k + 2) % 10]);
    } else if (sides === 12) {
      for (a1 = 0; a1 < 2; a1++) for (b1 = 0; b1 < 2; b1++) for (d1 = 0; d1 < 2; d1++) verts.push([pm[a1], pm[b1], pm[d1]]);
      for (a1 = 0; a1 < 2; a1++) for (b1 = 0; b1 < 2; b1++) {
        verts.push([0, pm[a1] / PHI, pm[b1] * PHI]); verts.push([pm[a1] / PHI, pm[b1] * PHI, 0]); verts.push([pm[a1] * PHI, 0, pm[b1] / PHI]);
      }
      faceVi = hullFaces(verts); // 12 pentagons, correctly (dual-icosa directions don't match this vertex set)
    } else if (sides === 20) {
      for (a1 = 0; a1 < 2; a1++) for (b1 = 0; b1 < 2; b1++) { verts.push([0, pm[a1], pm[b1] * PHI]); verts.push([pm[a1], pm[b1] * PHI, 0]); verts.push([pm[a1] * PHI, 0, pm[b1]]); }
      var E2 = 4.0;
      for (var i2 = 0; i2 < verts.length; i2++) for (var j2 = i2 + 1; j2 < verts.length; j2++) for (var k2 = j2 + 1; k2 < verts.length; k2++) {
        var d12 = len3(sub(verts[i2], verts[j2])); d12 *= d12;
        var d13 = len3(sub(verts[i2], verts[k2])); d13 *= d13;
        var d23 = len3(sub(verts[j2], verts[k2])); d23 *= d23;
        if (Math.abs(d12 - E2) < 0.1 && Math.abs(d13 - E2) < 0.1 && Math.abs(d23 - E2) < 0.1) faceVi.push([i2, j2, k2]);
      }
    }

    var maxr = 0, i; for (i = 0; i < verts.length; i++) maxr = Math.max(maxr, len3(verts[i]));
    for (i = 0; i < verts.length; i++) verts[i] = scale3(verts[i], 1 / maxr);

    var faces = [], norms = [];
    for (i = 0; i < faceVi.length; i++) { var of = orderFace(verts, faceVi[i]); faces.push(of.order); norms.push(of.n); }

    var faceValue, vertexValue = null;
    if (isD4) { vertexValue = [1, 2, 3, 4]; faceValue = null; }
    else if (sides === 6) faceValue = [1, 6, 2, 5, 3, 4];
    else if (sides === 10) faceValue = assignOpposite(norms, 9, 0);
    else faceValue = assignOpposite(norms, sides + 1, 1);

    var faceLocal = [], faceInFrac = [];
    for (i = 0; i < faces.length; i++) {
      var vidx = faces[i], pts = vidx.map(function (q) { return verts[q]; });
      var ccn = centroid(pts), nn = norms[i], uu = norm3(sub(pts[0], ccn)), ww = cross(nn, uu);
      var locp = [], mr = 1e-4;
      for (var p = 0; p < pts.length; p++) { var rel = sub(pts[p], ccn), lx = dot(rel, uu) * MIRROR, ly = dot(rel, ww); locp.push([lx, ly]); mr = Math.max(mr, Math.sqrt(lx*lx+ly*ly)); }
      // inradius = min distance from centroid (origin) to an edge — how big a centered digit can be
      var rin = 1e9;
      for (p = 0; p < locp.length; p++) {
        var pa = locp[p], pb = locp[(p + 1) % locp.length];
        var ex = pb[0] - pa[0], ey = pb[1] - pa[1], el = Math.sqrt(ex*ex + ey*ey) || 1e-6;
        var dline = Math.abs(pa[0]*pb[1] - pa[1]*pb[0]) / el;
        if (dline < rin) rin = dline;
      }
      faceInFrac.push(rin / mr);
      for (p = 0; p < locp.length; p++) { locp[p][0] /= mr; locp[p][1] /= mr; }
      faceLocal.push(locp);
    }

    var GRID = 5, cs = 1 / GRID;
    var pos = [], nor = [], uv = [];
    for (i = 0; i < faces.length; i++) {
      var order = faces[i], nrm = norms[i], col = i % GRID, row = Math.floor(i / GRID);
      var cx = (col + 0.5) * cs, cy = (row + 0.5) * cs;
      for (var t = 1; t < order.length - 1; t++) {
        var tri = [0, t, t + 1];
        for (var s2 = 0; s2 < 3; s2++) {
          var vI = order[tri[s2]], lp = faceLocal[i][tri[s2]];
          pos.push(verts[vI][0] * DIE_R, verts[vI][1] * DIE_R, verts[vI][2] * DIE_R);
          nor.push(nrm[0], nrm[1], nrm[2]);
          uv.push(cx + lp[0] * cs * FILL, cy + lp[1] * cs * FILL);
        }
      }
    }
    var mesh = buildMesh(pos, nor, uv);
    var cverts = verts.map(function (v) { return scale3(v, DIE_R); });
    var vdir = verts.map(function (v) { return norm3(v); });

    return { sides: sides, isD4: isD4, mesh: mesh, norms: norms, faces: faces, faceLocal: faceLocal, faceInFrac: faceInFrac,
             verts: verts, cverts: cverts, vdir: vdir, faceValue: faceValue, vertexValue: vertexValue, GRID: GRID };
  }
  function buildMesh(pos, nor, uv) {
    var pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);
    var nb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(nor), gl.STATIC_DRAW);
    var ub = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ub); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uv), gl.STATIC_DRAW);
    return { pb: pb, nb: nb, ub: ub, n: pos.length / 3 };
  }
  var SIDES = [4, 6, 8, 10, 12, 20], TYPES = {};
  for (var ti = 0; ti < SIDES.length; ti++) TYPES[SIDES[ti]] = buildDieType(SIDES[ti]);

  /* =========================== per-die atlas =========================== */
  var ATLAS = 1024;
  function shade(rgb, k) { return "rgb(" + Math.round(Math.min(255,rgb[0]*255*k)) + "," + Math.round(Math.min(255,rgb[1]*255*k)) + "," + Math.round(Math.min(255,rgb[2]*255*k)) + ")"; }
  function drawDigit(ctx, val, cx, cy, size, ink) {
    ctx.save(); ctx.translate(cx, cy);
    ctx.font = "900 " + Math.round(size) + "px 'Arial Black', Arial, system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    var s = String(val);
    ctx.fillStyle = "rgba(0,0,0,0.38)"; ctx.fillText(s, 1.5, 2.0);
    ctx.fillStyle = "rgba(255,255,255,0.28)"; ctx.fillText(s, -1.2, -1.6);
    ctx.fillStyle = ink; ctx.fillText(s, 0, 0);
    if (val === 6 || val === 9) { var w = size * 0.42; ctx.fillStyle = ink; ctx.fillRect(-w/2, size*0.54, w, Math.max(2, size*0.07)); }
    ctx.restore();
  }
  function paintAtlas(die) {
    var T = die.type, ctx = die.ctx, GRID = T.GRID, cell = ATLAS / GRID, base = die.pal.base, ink = die.pal.ink, faces = T.faces;
    ctx.clearRect(0, 0, ATLAS, ATLAS);
    for (var i = 0; i < faces.length; i++) {
      var col = i % GRID, row = Math.floor(i / GRID), x0 = col * cell, y0 = row * cell, cx = x0 + cell/2, cy = y0 + cell/2;
      var g = ctx.createRadialGradient(cx, cy - cell*0.12, cell*0.1, cx, cy, cell*0.72);
      g.addColorStop(0, shade(base, 1.10)); g.addColorStop(1, shade(base, 0.80));
      ctx.fillStyle = g; ctx.fillRect(x0, y0, cell, cell);
      var inR = cell * FILL * T.faceInFrac[i]; // inscribed-circle radius in px — digits fit inside this
      if (T.isD4) {
        var order = faces[i], loc = T.faceLocal[i];
        for (var cI = 0; cI < order.length; cI++) {
          var vval = die.vertexValue[order[cI]];
          drawDigit(ctx, vval, cx + loc[cI][0] * cell * FILL * 0.64, cy + loc[cI][1] * cell * FILL * 0.64, inR * 0.92, ink);
        }
      } else {
        var val = die.faceValue[i];
        drawDigit(ctx, val, cx, cy, inR * (val >= 10 ? 1.32 : 1.95), ink);
      }
    }
    gl.bindTexture(gl.TEXTURE_2D, die.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, die.canvas);
  }

  /* =========================== dice instances =========================== */
  var dice = [];
  function makeDie(sides, palIndex) {
    var cvs = document.createElement("canvas"); cvs.width = ATLAS; cvs.height = ATLAS;
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    var T = TYPES[sides];
    var d = {
      type: T, sides: sides, pal: PALETTE[palIndex % PALETTE.length], canvas: cvs, ctx: cvs.getContext("2d"), tex: tex,
      p: [0, DIE_R, 0], v: [0, 0, 0], q: qIdent(), w: [0, 0, 0],
      faceValue: T.faceValue ? T.faceValue.slice() : null, vertexValue: T.vertexValue ? T.vertexValue.slice() : null,
      settled: false, stillCount: 0, snapT: 1, restY: DIE_R, value: 1
    };
    paintAtlas(d);
    return d;
  }
  function ensurePool(sides, count) {
    if (dice.length === count && dice.length && dice[0].sides === sides) return;
    dice = [];
    for (var i = 0; i < count; i++) dice.push(makeDie(sides, i));
  }

  /* =========================== physics =========================== */
  var TRAY_X = 4.2, TRAY_ZF = -3.0, TRAY_ZN = 2.6, audible = false, replaying = false;
  var INV_I = 1 / (0.4 * DIE_R * DIE_R);
  function applyImpulse(d, r, j) { d.v[0]+=j[0]; d.v[1]+=j[1]; d.v[2]+=j[2]; var tq = cross(r, j); d.w[0]+=tq[0]*INV_I; d.w[1]+=tq[1]*INV_I; d.w[2]+=tq[2]*INV_I; }
  function contact(d, cW, n, pen) {
    var r = sub(cW, d.p), u = add(d.v, cross(d.w, r)), vn = dot(u, n);
    if (vn < 0) {
      var rn = cross(r, n), denom = 1 + INV_I * dot(rn, rn);
      var e = (Math.abs(vn) < 0.7) ? 0 : RESTIT, jn = -(1 + e) * vn / denom;
      applyImpulse(d, r, scale3(n, jn));
      if (audible && vn < -1.4) playClack(Math.min(1, -vn / 9), d.p[0] / (TRAY_X + 0.001));
      u = add(d.v, cross(d.w, r));
      var ut = sub(u, scale3(n, dot(u, n))), utl = len3(ut);
      if (utl > 1e-5) {
        var td = scale3(ut, 1 / utl), rt = cross(r, td), jt = -dot(u, td) / (1 + INV_I * dot(rt, rt)), lim = MU * jn;
        if (jt > lim) jt = lim; if (jt < -lim) jt = -lim; applyImpulse(d, r, scale3(td, jt));
      }
    }
    if (pen > 0) d.p = add(d.p, scale3(n, pen * 0.8));
  }
  function stepDie(d, dt) {
    if (d.settled) return;
    d.v[1] += GY * dt;
    d.v[0] *= (1 - LIN_DAMP); d.v[1] *= (1 - LIN_DAMP); d.v[2] *= (1 - LIN_DAMP);
    d.w[0] *= (1 - ANG_DAMP); d.w[1] *= (1 - ANG_DAMP); d.w[2] *= (1 - ANG_DAMP);
    d.p[0] += d.v[0]*dt; d.p[1] += d.v[1]*dt; d.p[2] += d.v[2]*dt;
    d.q = qIntegrate(d.q, d.w, dt);
    var cv = d.type.cverts, i;
    var deepest = -1, deepIdx = -1, second = -1, secIdx = -1;
    for (i = 0; i < cv.length; i++) {
      var wy = d.p[1] + qRot(d.q, cv[i])[1];
      if (wy < 0) { var pen = -wy; if (pen > deepest) { second = deepest; secIdx = deepIdx; deepest = pen; deepIdx = i; } else if (pen > second) { second = pen; secIdx = i; } }
    }
    if (deepIdx >= 0) contact(d, add(d.p, qRot(d.q, cv[deepIdx])), [0,1,0], deepest);
    if (secIdx >= 0) contact(d, add(d.p, qRot(d.q, cv[secIdx])), [0,1,0], second);
    for (i = 0; i < cv.length; i++) {
      var wp = add(d.p, qRot(d.q, cv[i]));
      if (wp[0] >  TRAY_X) contact(d, wp, [-1,0,0], wp[0] - TRAY_X);
      if (wp[0] < -TRAY_X) contact(d, wp, [1,0,0], -TRAY_X - wp[0]);
      if (wp[2] >  TRAY_ZN) contact(d, wp, [0,0,-1], wp[2] - TRAY_ZN);
      if (wp[2] <  TRAY_ZF) contact(d, wp, [0,0,1], TRAY_ZF - wp[2]);
    }
  }
  function dieDie(a, b) {
    var rr = DIE_R * 1.7, del = sub(b.p, a.p), dl = len3(del);
    if (dl > 1e-4 && dl < rr) {
      var n = scale3(del, 1 / dl), mid = scale3(add(a.p, b.p), 0.5), pen = (rr - dl) * 0.5;
      a.p = add(a.p, scale3(n, -pen)); b.p = add(b.p, scale3(n, pen));
      var rA = sub(mid, a.p), rB = sub(mid, b.p);
      var uRel = sub(add(b.v, cross(b.w, rB)), add(a.v, cross(a.w, rA))), vn = dot(uRel, n);
      if (vn < 0) {
        var raN = cross(rA, n), rbN = cross(rB, n), denom = 2 + INV_I * (dot(raN, raN) + dot(rbN, rbN));
        var jn = -(1 + 0.2) * vn / denom, J = scale3(n, jn);
        applyImpulse(a, rA, scale3(J, -1)); applyImpulse(b, rB, J);
        if (audible && vn < -1.6) playClack(Math.min(1, -vn / 8), mid[0] / (TRAY_X + 0.001));
      }
    }
  }
  function stepWorld(dt) {
    for (var i = 0; i < dice.length; i++) stepDie(dice[i], dt);
    for (i = 0; i < dice.length; i++) for (var j = i + 1; j < dice.length; j++) dieDie(dice[i], dice[j]);
    for (i = 0; i < dice.length; i++) {
      var d = dice[i]; if (d.settled) continue;
      if (len3(d.v) < SETTLE_V && len3(d.w) < SETTLE_W) { d.stillCount++; if (d.stillCount > SETTLE_HOLD) (replaying ? finalizeDie : settleDie)(d); }
      else d.stillCount = 0;
    }
  }
  function readTopFace(d) {
    var i;
    if (d.type.isD4) {
      var best = -2, bi = -1;
      for (i = 0; i < d.type.vdir.length; i++) { var wy = qRot(d.q, d.type.vdir[i])[1]; if (wy > best) { best = wy; bi = i; } }
      return { value: d.vertexValue[bi], index: bi, isVertex: true };
    }
    var b = -2, idx = -1;
    for (i = 0; i < d.type.norms.length; i++) { var wn = qRot(d.q, d.type.norms[i])[1]; if (wn > b) { b = wn; idx = i; } }
    return { value: d.faceValue[idx], index: idx, isVertex: false };
  }
  // emulate mode (invisible sim): read the natural landing face + store the exact
  // rest orientation so the visible replay always snaps to the authoritative pose.
  function settleDie(d) {
    d.settled = true; d.v = [0, 0, 0]; d.w = [0, 0, 0];
    var top = readTopFace(d);
    var faceN = top.isVertex ? d.type.vdir[top.index] : d.type.norms[top.index];
    var worldN = qRot(d.q, faceN), snap = qBetween(worldN, [0, 1, 0]);
    d.qFrom = d.q.slice(); d.qTo = qNorm(qMul(snap, d.q)); d.snapT = 0; d.value = top.value;
    var minY = 1e9;
    for (var i = 0; i < d.type.cverts.length; i++) { var y = qRot(d.qTo, d.type.cverts[i])[1]; if (y < minY) minY = y; }
    d.restY = -minY;
    d.natQ = d.qTo.slice(); d.natRestY = d.restY; d.natValue = top.value; // authoritative rest
  }
  // replay mode (visible roll): snap to the stored natural rest — guarantees the
  // shown face matches the chosen value even if the die is force-settled early.
  function finalizeDie(d) {
    d.settled = true; d.v = [0, 0, 0]; d.w = [0, 0, 0];
    d.qFrom = d.q.slice(); d.qTo = d.natQ; d.restY = d.natRestY; d.value = d.natValue; d.snapT = 0;
    if (audible) playClack(0.5, d.p[0] / (TRAY_X + 0.001));
  }

  /* =========================== the roll (fairness trick) =========================== */
  var phase = "idle", settleTimer = 0, rollElapsed = 0, revealDone = false, pendingChosen = null, curSides = 6, curCount = 1;
  function setupThrow(d, i, count, rng, flick) {
    var lane = (count === 1) ? (rng() - 0.5) * 0.5 : (i / (count - 1) - 0.5) * 0.9;
    d.p = [lane * TRAY_X, 1.8 + rng() * 1.6, TRAY_ZF * 0.66 - rng() * 0.4];
    var toFront = 6.2 + rng() * 2.4;   // travel forward to settle around table centre
    d.v = [(rng() - 0.5) * 2.6 + flick[0], -1 - rng() * 2, toFront + flick[1]];
    d.w = [(rng() - 0.5) * 26, (rng() - 0.5) * 26, (rng() - 0.5) * 26];
    d.q = qNorm([rng() - 0.5, rng() - 0.5, rng() - 0.5, rng() - 0.5]);
    d.settled = false; d.stillCount = 0; d.snapT = 1;
  }
  function snapshot(d) { return { p: d.p.slice(), v: d.v.slice(), q: d.q.slice(), w: d.w.slice() }; }
  function restore(d, s) { d.p = s.p.slice(); d.v = s.v.slice(); d.q = s.q.slice(); d.w = s.w.slice(); d.settled = false; d.stillCount = 0; d.snapT = 1; }

  function doRoll(flick) {
    if (phase === "rolling") return;
    ensureAudio();
    var sides = curSides, i;
    ensurePool(sides, curCount);
    var rng = mulberry32(cryptoSeed());
    flick = flick || [0, 0];

    var chosen = [];
    for (i = 0; i < dice.length; i++) chosen.push(cryptoInt(sides === 10 ? 10 : sides));

    var init = [];
    for (i = 0; i < dice.length; i++) { setupThrow(dice[i], i, dice.length, rng, flick); init.push(snapshot(dice[i])); }

    audible = false; replaying = false;
    var steps = 0;
    while (steps < MAX_SIM_STEPS) {
      var allSet = true;
      for (i = 0; i < dice.length; i++) if (!dice[i].settled) { allSet = false; break; }
      if (allSet) break; stepWorld(DT); steps++;
    }
    for (i = 0; i < dice.length; i++) if (!dice[i].settled) settleDie(dice[i]);

    for (i = 0; i < dice.length; i++) relabel(dice[i], chosen[i], sides);
    for (i = 0; i < dice.length; i++) restore(dice[i], init[i]);

    phase = "rolling"; revealDone = false; settleTimer = 0; simAccum = 0; rollElapsed = 0; audible = true; replaying = true; pendingChosen = chosen;
    if (elHint) elHint.classList.add("is-hidden");
    playThrowSound();
  }
  function relabel(d, chosenVal, sides) {
    var top = readTopFace(d), tmp, oi;
    if (d.type.isD4) {
      if (d.vertexValue[top.index] !== chosenVal) { oi = d.vertexValue.indexOf(chosenVal); tmp = d.vertexValue[top.index]; d.vertexValue[top.index] = chosenVal; if (oi >= 0) d.vertexValue[oi] = tmp; }
    } else {
      var want = (sides === 10 && chosenVal === 10) ? 0 : chosenVal;
      if (d.faceValue[top.index] !== want) { oi = d.faceValue.indexOf(want); tmp = d.faceValue[top.index]; d.faceValue[top.index] = want; if (oi >= 0) d.faceValue[oi] = tmp; }
    }
    paintAtlas(d); d.finalValue = chosenVal;
  }

  /* =========================== reveal / juice =========================== */
  var displayTotal = 0, targetTotal = -1, countUpT = 1, best = 0, bestStreak = 0, streak = 0, glowPulse = 0;
  function reveal() {
    revealDone = true;
    var vals = pendingChosen.slice(), sum = 0, i; for (i = 0; i < vals.length; i++) sum += vals[i];
    targetTotal = sum; countUpT = 0;
    var sides = curSides;
    elLabel.textContent = vals.length > 1 ? "Total" : "Roll";
    elDetail.textContent = vals.length > 1 ? (vals.length + "d" + sides + " · " + vals.join(" + ") + " = " + sum) : ("d" + sides + " · you rolled " + vals[0]);
    var li = document.createElement("li"); li.textContent = vals.length + "d" + sides + " · " + sum;
    elHistory.insertBefore(li, elHistory.firstChild);
    while (elHistory.children.length > 12) elHistory.removeChild(elHistory.lastChild);
    if (sum > best) { best = sum; try { localStorage.setItem("dice_best", String(best)); } catch (e) {} }
    var maxFace = sides, hasCrit = false, hasFumble = false;
    for (i = 0; i < vals.length; i++) { if (vals[i] === maxFace) hasCrit = true; if (vals[i] === 1) hasFumble = true; }
    if (hasCrit) { streak++; if (streak > bestStreak) { bestStreak = streak; try { localStorage.setItem("dice_streak", String(bestStreak)); } catch (e) {} } }
    else streak = 0;
    renderBest();
    if (hasCrit) critCeremony(); else if (hasFumble && vals.length === 1) fumbleCeremony();
    playSettleChime(hasCrit);
  }
  function renderBest() { if (elBest) elBest.textContent = "Best " + (best || "—") + (bestStreak ? "  ·  Streak " + bestStreak : ""); }
  function critCeremony() { if (elFlash) { elFlash.className = "flash flash--gold on"; setTimeout(function () { elFlash.className = "flash flash--gold"; }, 460); } burstConfetti(); }
  function fumbleCeremony() { if (elFlash) { elFlash.className = "flash flash--red on"; setTimeout(function () { elFlash.className = "flash flash--red"; }, 420); } }
  function burstConfetti() {
    if (!elConfetti) return;
    var cols = ["#ffd54a", "#ffb020", "#fff1b0", "#ffcf5a", "#ff9d3c"];
    for (var i = 0; i < 46; i++) {
      var s = document.createElement("i");
      var x = 50 + (Math.random() - 0.5) * 44, dx = (Math.random() - 0.5) * 240, dy = 240 + Math.random() * 260, rot = (Math.random() - 0.5) * 900;
      s.style.cssText = "left:" + x + "%;top:32%;background:" + cols[i % cols.length] + ";--dx:" + dx + "px;--dy:" + dy + "px;--rot:" + rot + "deg;--d:" + (620 + Math.random() * 520) + "ms";
      elConfetti.appendChild(s);
      (function (el) { setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1250); })(s);
    }
  }

  /* =========================== shaders =========================== */
  function compile(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s), src); return s; }
  function program(vs, fs) { var p = gl.createProgram(); gl.attachShader(p, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(p)); return p; }
  function loc(p, n) { return gl.getUniformLocation(p, n); }

  var dieProg = program(
    "attribute vec3 aPos; attribute vec3 aNorm; attribute vec2 aUV;" +
    "uniform mat4 uProj,uView,uModel; uniform mat3 uNorm; varying vec3 vW; varying vec3 vN; varying vec2 vUV;" +
    "void main(){ vec4 w=uModel*vec4(aPos,1.0); vW=w.xyz; vN=uNorm*aNorm; vUV=aUV; gl_Position=uProj*uView*w; }",
    "precision highp float; varying vec3 vW; varying vec3 vN; varying vec2 vUV;" +
    "uniform vec3 uCam,uLight; uniform sampler2D uAtlas; uniform float uGlow;" +
    "void main(){" +
    "  vec3 N=normalize(vN), V=normalize(uCam-vW), L=normalize(uLight), H=normalize(L+V);" +
    "  vec3 alb=texture2D(uAtlas,vUV).rgb;" +
    "  float diff=max(dot(N,L),0.0);" +
    "  vec3 amb=alb*(0.30+0.16*N.y);" +
    "  vec3 col=amb + alb*diff*0.80;" +
    "  float sp=pow(max(dot(N,H),0.0),64.0); col+=vec3(1.0,0.98,0.94)*sp*0.33;" +
    "  float fres=pow(1.0-max(dot(N,V),0.0),4.0); col+=vec3(0.5,0.56,0.62)*fres*0.10;" +
    "  col+=alb*uGlow;" +
    "  col=clamp((col*(2.51*col+0.03))/(col*(2.43*col+0.59)+0.14),0.0,1.0); col=pow(col,vec3(1.0/2.2));" +
    "  gl_FragColor=vec4(col,1.0);" +
    "}"
  );
  var uD = { proj: loc(dieProg, "uProj"), view: loc(dieProg, "uView"), model: loc(dieProg, "uModel"), norm: loc(dieProg, "uNorm"), cam: loc(dieProg, "uCam"), light: loc(dieProg, "uLight"), atlas: loc(dieProg, "uAtlas"), glow: loc(dieProg, "uGlow") };
  var aD_pos = gl.getAttribLocation(dieProg, "aPos"), aD_nor = gl.getAttribLocation(dieProg, "aNorm"), aD_uv = gl.getAttribLocation(dieProg, "aUV");

  var feltProg = program(
    "attribute vec3 aPos; uniform mat4 uProj,uView,uModel; varying vec3 vW;" +
    "void main(){ vec4 w=uModel*vec4(aPos,1.0); vW=w.xyz; gl_Position=uProj*uView*w; }",
    "precision highp float; varying vec3 vW; uniform vec3 uDie[8]; uniform int uCount;" +
    "float h2(vec2 p){ return fract(sin(dot(p,vec2(41.3,289.1)))*43758.5453); }" +
    "void main(){" +
    "  vec2 p=vW.xz;" +
    "  vec3 felt=vec3(0.050,0.19,0.115);" +
    "  float weave=(sin(p.x*120.0)+sin(p.y*120.0))*0.012 + (h2(floor(p*90.0))-0.5)*0.05;" +
    "  vec3 col=felt*(1.0+weave);" +
    "  float vig=smoothstep(8.5,1.2,length(p)); col*=0.40+0.60*vig;" +
    "  float sh=0.0;" +
    "  for(int i=0;i<8;i++){ if(i>=uCount) break; float d=length(p-uDie[i].xy); float hgt=uDie[i].z;" +
    "    sh=max(sh, 0.85*exp(-hgt*1.5)*smoothstep(0.98+hgt*1.1,0.0,d)); }" +
    "  col*=(1.0-clamp(sh,0.0,0.82));" +
    "  col=pow(max(col,0.0),vec3(1.0/2.2)); gl_FragColor=vec4(col,1.0);" +
    "}"
  );
  var uFe = { proj: loc(feltProg, "uProj"), view: loc(feltProg, "uView"), model: loc(feltProg, "uModel"), die: loc(feltProg, "uDie"), count: loc(feltProg, "uCount") };
  var aFe_pos = gl.getAttribLocation(feltProg, "aPos");

  var quadPos = new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1]), quadIdx = new Uint16Array([0, 1, 2, 0, 2, 3]);
  var qpb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, qpb); gl.bufferData(gl.ARRAY_BUFFER, quadPos, gl.STATIC_DRAW);
  var qib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, qib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, quadIdx, gl.STATIC_DRAW);

  /* =========================== camera =========================== */
  var EYE = [0, 10.8, 4.4], TARGET = [0, 0, 0.2], LIGHT = norm3([-0.5, 0.66, 0.6]);
  var curProj, curView, curInv, camPos = EYE.slice();
  function mulPoint(m, p) { var x=p[0],y=p[1],z=p[2],w=m[3]*x+m[7]*y+m[11]*z+m[15]; return [(m[0]*x+m[4]*y+m[8]*z+m[12])/w,(m[1]*x+m[5]*y+m[9]*z+m[13])/w,(m[2]*x+m[6]*y+m[10]*z+m[14])/w]; }
  function castFloor(nx, ny) { var near = mulPoint(curInv, [nx, ny, -1]), far = mulPoint(curInv, [nx, ny, 1]), d = sub(far, near); if (Math.abs(d[1]) < 1e-5) return null; var t = -near[1] / d[1]; return add(near, scale3(d, t)); }
  function computeTray() {
    var mid = castFloor(1, 0), bot = castFloor(0, -1), top = castFloor(0, 1);
    if (mid) TRAY_X = Math.max(2.2, Math.abs(mid[0]) * 0.86);
    if (bot) TRAY_ZN = Math.max(1.6, bot[2] * 0.9);
    if (top) TRAY_ZF = Math.min(-1.8, top[2] * 0.9);
  }
  function setupCamera() {
    var asp = canvas.width / canvas.height, fov = 34 * Math.PI / 180, eye = EYE.slice(), dist = 1;
    if (asp < 1.2) { dist = 1 + (1.2 - asp) * 0.85; eye = [EYE[0], EYE[1] * dist, EYE[2] * dist]; }
    curProj = mPerspective(fov, asp, 0.1, 100); curView = mLookAt(eye, TARGET, [0, 1, 0]); curInv = mInvert(mMul(curProj, curView)); camPos = eye;
    computeTray();
  }

  /* =========================== render =========================== */
  var DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * DPR); canvas.height = Math.floor(window.innerHeight * DPR);
    canvas.style.width = window.innerWidth + "px"; canvas.style.height = window.innerHeight + "px";
    setupCamera();
  }
  resize(); window.addEventListener("resize", resize);

  var dieBuf = new Float32Array(MAX_DICE * 3), lastTs = null, simAccum = 0;
  gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
  gl.clearColor(0.03, 0.07, 0.05, 1);

  function render(ts) {
    var dt = lastTs !== null ? Math.min((ts - lastTs) / 1000, 1 / 30) : 0; lastTs = ts;
    var i;
    if (phase === "rolling") {
      rollElapsed += dt;
      simAccum += dt; var guard = 0;
      while (simAccum >= DT && guard < 8) { stepWorld(DT); simAccum -= DT; guard++; }
      var allSettled = true;
      for (i = 0; i < dice.length; i++) {
        var d = dice[i];
        if (!d.settled) { if (rollElapsed > MAX_ROLL_SECS) finalizeDie(d); else allSettled = false; }
        if (d.settled && d.snapT < 1) { d.snapT = Math.min(1, d.snapT + dt * 9); var e = d.snapT * d.snapT * (3 - 2 * d.snapT); d.q = qSlerp(d.qFrom, d.qTo, e); d.p[1] += (d.restY - d.p[1]) * Math.min(1, dt * 10); }
      }
      if (allSettled) { settleTimer += dt; if (settleTimer > 0.12 && !revealDone) reveal(); if (settleTimer > 0.5) { phase = "idle"; audible = false; } }
    }
    if (countUpT < 1 && targetTotal >= 0) { countUpT = Math.min(1, countUpT + dt * 2.4); displayTotal = Math.round(targetTotal * (1 - Math.pow(1 - countUpT, 3))); if (elTotal) elTotal.textContent = String(displayTotal); }
    if (glowPulse > 0) glowPulse = Math.max(0, glowPulse - dt * 2.2);

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    for (i = 0; i < dice.length; i++) { dieBuf[i*3] = dice[i].p[0]; dieBuf[i*3+1] = dice[i].p[2]; dieBuf[i*3+2] = Math.max(0, dice[i].p[1] / 3.0); }
    gl.useProgram(feltProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, qpb); gl.enableVertexAttribArray(aFe_pos); gl.vertexAttribPointer(aFe_pos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, qib);
    gl.uniformMatrix4fv(uFe.proj, false, curProj); gl.uniformMatrix4fv(uFe.view, false, curView); gl.uniformMatrix4fv(uFe.model, false, mScale(30, 1, 30));
    gl.uniform3fv(uFe.die, dieBuf); gl.uniform1i(uFe.count, dice.length);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

    gl.useProgram(dieProg);
    gl.uniformMatrix4fv(uD.proj, false, curProj); gl.uniformMatrix4fv(uD.view, false, curView);
    gl.uniform3fv(uD.cam, camPos); gl.uniform3fv(uD.light, LIGHT); gl.uniform1i(uD.atlas, 0);
    gl.activeTexture(gl.TEXTURE0);
    for (i = 0; i < dice.length; i++) {
      var dd = dice[i], m = dd.type.mesh;
      gl.bindBuffer(gl.ARRAY_BUFFER, m.pb); gl.enableVertexAttribArray(aD_pos); gl.vertexAttribPointer(aD_pos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.nb); gl.enableVertexAttribArray(aD_nor); gl.vertexAttribPointer(aD_nor, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.ub); gl.enableVertexAttribArray(aD_uv); gl.vertexAttribPointer(aD_uv, 2, gl.FLOAT, false, 0, 0);
      var model = mMul(mTranslate(dd.p[0], dd.p[1], dd.p[2]), qToMat(dd.q));
      gl.uniformMatrix4fv(uD.model, false, model); gl.uniformMatrix3fv(uD.norm, false, mNormal(model));
      gl.bindTexture(gl.TEXTURE_2D, dd.tex);
      gl.uniform1f(uD.glow, (dd.settled && revealDone) ? glowPulse * 0.6 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, m.n);
    }
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);

  /* =========================== throw interaction =========================== */
  var pressT = 0, pressX = 0, pressY = 0;
  canvas.addEventListener("pointerdown", function (e) {
    ensureAudio(); pressT = perfNow(); pressX = e.clientX; pressY = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch (er) {} e.preventDefault();
  });
  canvas.addEventListener("pointerup", function (e) {
    if (!pressT) return;
    var dtt = Math.max(0.03, (perfNow() - pressT) / 1000), dx = e.clientX - pressX, dy = e.clientY - pressY, dist = Math.sqrt(dx*dx + dy*dy);
    pressT = 0;
    if (dist > 24) { var sp = Math.min(9, dist / dtt / 90); doRoll([dx / (dist || 1) * sp, -dy / (dist || 1) * sp]); }
    else doRoll([0, 0]);
    e.preventDefault();
  });
  function perfNow() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  /* =========================== UI =========================== */
  try { best = parseInt(localStorage.getItem("dice_best") || "0", 10) || 0; bestStreak = parseInt(localStorage.getItem("dice_streak") || "0", 10) || 0; } catch (e) {}
  ensurePool(curSides, curCount); renderBest();

  chips.forEach(function (ch) {
    ch.addEventListener("click", function () {
      if (phase === "rolling") return;
      curSides = parseInt(ch.getAttribute("data-sides"), 10);
      chips.forEach(function (c) { c.classList.toggle("is-on", c === ch); });
      ensurePool(curSides, curCount); resetReadout();
    });
  });
  function setCount(n) { curCount = Math.max(1, Math.min(MAX_DICE, n)); countVal.textContent = String(curCount); ensurePool(curSides, curCount); resetReadout(); }
  countUp.addEventListener("click", function () { if (phase !== "rolling") setCount(curCount + 1); });
  countDown.addEventListener("click", function () { if (phase !== "rolling") setCount(curCount - 1); });
  rollBtn.addEventListener("click", function () { doRoll([0, 0]); });
  clearBtn.addEventListener("click", function () { elHistory.innerHTML = ""; streak = 0; resetReadout(); renderBest(); });
  function resetReadout() {
    targetTotal = -1; countUpT = 1; displayTotal = 0;
    if (elTotal) elTotal.textContent = "—";
    if (elLabel) elLabel.textContent = curCount > 1 ? "Total" : "Roll";
    if (elDetail) elDetail.textContent = curCount > 1 ? ("roll " + curCount + "d" + curSides) : ("roll a d" + curSides);
  }
  resetReadout();
  window.addEventListener("keydown", function (e) {
    var tag = (e.target && e.target.tagName) || "";
    if ((e.key === "r" || e.key === "R") && tag !== "INPUT" && tag !== "TEXTAREA") doRoll([0, 0]);
  });

  /* =========================== audio =========================== */
  var actx = null, master = null, wet = null, soundOn = true, lastClackT = 0;
  function makeImpulse(dur, decay) {
    var n = Math.floor(actx.sampleRate * dur), b = actx.createBuffer(2, n, actx.sampleRate);
    for (var ch = 0; ch < 2; ch++) { var d = b.getChannelData(ch); for (var i = 0; i < n; i++) { var x = i / n; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - x, decay); } }
    return b;
  }
  function ensureAudio() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    actx = new AC();
    var comp = actx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5; comp.attack.value = 0.002; comp.release.value = 0.14; comp.connect(actx.destination);
    master = actx.createGain(); master.gain.value = 0.9; master.connect(comp);
    var rev = actx.createConvolver(); rev.buffer = makeImpulse(0.5, 3.2);
    wet = actx.createGain(); wet.gain.value = 0.12; wet.connect(rev); rev.connect(comp);
    try { var s = actx.createBufferSource(); s.buffer = actx.createBuffer(1, 1, 22050); s.connect(actx.destination); s.start(0); } catch (e) {}
    if (actx.state === "suspended") actx.resume();
  }
  function playClack(vel, pan) {
    if (!actx || !soundOn || !master) return;
    var now = actx.currentTime; if (now - lastClackT < 0.035) return; lastClackT = now;
    var v = Math.min(1, vel); if (v < 0.05) return;
    now += Math.random() * 0.003;
    var bus = actx.createGain(); bus.gain.value = 1;
    var pn = actx.createStereoPanner ? actx.createStereoPanner() : null;
    if (pn) { pn.pan.value = Math.max(-1, Math.min(1, pan)); bus.connect(pn); pn.connect(master); } else bus.connect(master);
    bus.connect(wet);
    var nlen = Math.floor(actx.sampleRate * 0.03), nb = actx.createBuffer(1, nlen, actx.sampleRate), nd = nb.getChannelData(0);
    for (var i = 0; i < nlen; i++) nd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / nlen, 2.0);
    var ns = actx.createBufferSource(); ns.buffer = nb;
    var bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 2100 + Math.random() * 1600; bp.Q.value = 1.1;
    var ng = actx.createGain(); ng.gain.value = v * 0.5; ns.connect(bp); bp.connect(ng); ng.connect(bus); ns.start(now); ns.stop(now + 0.05);
    var to = actx.createOscillator(); to.type = "sine"; to.frequency.setValueAtTime(230 + Math.random() * 40, now); to.frequency.exponentialRampToValueAtTime(90, now + 0.09);
    var tg = actx.createGain(); tg.gain.setValueAtTime(0.0001, now); tg.gain.exponentialRampToValueAtTime(v * 0.4, now + 0.005); tg.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    to.connect(tg); tg.connect(bus); to.start(now); to.stop(now + 0.14);
  }
  function playThrowSound() {
    if (!actx || !soundOn || !master) return;
    var now = actx.currentTime, nlen = Math.floor(actx.sampleRate * 0.26), nb = actx.createBuffer(1, nlen, actx.sampleRate), nd = nb.getChannelData(0);
    for (var i = 0; i < nlen; i++) nd[i] = (Math.random() * 2 - 1);
    var ns = actx.createBufferSource(); ns.buffer = nb;
    var bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.setValueAtTime(480, now); bp.frequency.exponentialRampToValueAtTime(1500, now + 0.22); bp.Q.value = 0.8;
    var g = actx.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.linearRampToValueAtTime(0.11, now + 0.06); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
    ns.connect(bp); bp.connect(g); g.connect(master); ns.start(now); ns.stop(now + 0.28);
  }
  function playSettleChime(crit) {
    glowPulse = crit ? 1.0 : 0.5;
    if (!actx || !soundOn || !master || !crit) return;
    var scale = [0, 3, 5, 7, 10], now = actx.currentTime;
    for (var i = 0; i < 5; i++) {
      var o = actx.createOscillator(); o.type = "triangle"; o.frequency.value = 523.25 * Math.pow(2, scale[i] / 12);
      var g = actx.createGain(), t = now + i * 0.06; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(g); g.connect(master); g.connect(wet); o.start(t); o.stop(t + 0.55);
    }
  }
  if (soundBtn) soundBtn.addEventListener("click", function () {
    soundOn = !soundOn; soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false"); soundBtn.textContent = soundOn ? "Sound: on" : "Sound: off"; ensureAudio();
  });
})();
