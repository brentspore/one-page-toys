/* Sky Fortress — a real-3D isometric scroll-shooter in raw WebGL (no libraries, no build).
 * The classic diagonal-fortress formula: you fly up-and-to-the-right over a floating
 * fortress; ALTITUDE is the mechanic. Climb over walls, thread doorway gaps, duck under
 * force fields — your hard shadow on the deck is the true height read (plus a side
 * altimeter). Shoot fuel silos to keep the tanks full; fuel is the soft timer.
 * Rendering: low-FOV perspective camera down the diagonal (axonometric feel), streamed
 * ring-buffer fortress, per-face-lit meshes with ACES tonemap, additive glow sprites for
 * beams/lasers/exhaust/explosions, parallax starfield. All positions are rendered
 * ship-relative in z to dodge float32 precision drift on long runs. */
(function () {
  "use strict";

  /* ============================ DOM + GL ============================ */
  const canvas = document.getElementById("canvas");
  const elScore = document.getElementById("score");
  const elBest = document.getElementById("best");
  const elFuelWrap = document.getElementById("fuelWrap");
  const elFuelBar = document.getElementById("fuelBar");
  const elAltMarker = document.getElementById("altMarker");
  const elOverlay = document.getElementById("overlay");
  const elOvTitle = document.getElementById("ovTitle");
  const elOvText = document.getElementById("ovText");
  const elOvBtn = document.getElementById("ovBtn");
  const elHint = document.getElementById("hint");
  const elFlash = document.getElementById("flash");
  const elConfetti = document.getElementById("confetti");
  const soundBtn = document.getElementById("soundBtn");

  const gl = canvas.getContext("webgl", { antialias: true, alpha: false, depth: true, powerPreference: "high-performance" })
        || canvas.getContext("experimental-webgl", { antialias: true });
  if (!gl) {
    const f = document.createElement("p");
    f.textContent = "This toy needs WebGL. Try a different browser.";
    f.style.cssText = "position:fixed;inset:0;display:grid;place-items:center;color:#9ab;font:500 16px system-ui;text-align:center;padding:24px;z-index:9";
    document.body.appendChild(f);
    return;
  }

  const REDMO = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ============================ tunables ============================ */
  const CORR = 8.5;          // corridor half-width the ship can use
  const FLOOR_W = 12.5;      // floor half-width (deck extends past the corridor)
  const SHIP_CLAMP = CORR - 0.7;
  const MINY = 0.85, MAXY = 8.4;      // altitude band
  const SEG = 16;            // world-content segment length
  const VIEW_AHEAD = 105;    // spawn horizon
  const BASE_SPEED = 14;
  const SHIP_R = 0.45;       // ship hit sphere
  const WALL_TH = 1.2;
  const FUEL_MAX = 100;
  const SPACE = [0.010, 0.013, 0.034];  // fog/space color
  const LIGHT = norm3([-0.42, 0.85, -0.30]);

  /* ============================ tiny math ============================ */
  function norm3(a) { const l = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function mIdent() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
  function mMul(a, b) {
    const o = new Array(16);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return o;
  }
  function mTranslate(x, y, z) { const m = mIdent(); m[12] = x; m[13] = y; m[14] = z; return m; }
  function mScale(x, y, z) { const m = mIdent(); m[0] = x; m[5] = y; m[10] = z; return m; }
  function mRotX(a) { const c = Math.cos(a), s = Math.sin(a), m = mIdent(); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; }
  function mRotY(a) { const c = Math.cos(a), s = Math.sin(a), m = mIdent(); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; }
  function mRotZ(a) { const c = Math.cos(a), s = Math.sin(a), m = mIdent(); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; }
  function mPerspective(fovy, asp, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return [f / asp, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }
  function mLookAt(eye, c, up) {
    const zx = eye[0] - c[0], zy = eye[1] - c[1], zz = eye[2] - c[2];
    const z = norm3([zx, zy, zz]);
    const x = norm3([up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]]);
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
            -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]),
            -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]),
            -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]), 1];
  }
  function rot3Of(m) { return [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]; }
  const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  /* ============================ shaders ============================ */
  function compile(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s), src);
    return s;
  }
  function program(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(p));
    return p;
  }
  function loc(p, n) { return gl.getUniformLocation(p, n); }

  const ACES =
    "vec3 aces(vec3 c){ return clamp((c*(2.51*c+0.03))/(c*(2.43*c+0.59)+0.14),0.0,1.0); }";

  // opaque lit surfaces (walls, ship, turrets, silos, pylons, drones, skirts)
  const surfProg = program(
    "attribute vec3 aPos; attribute vec3 aNorm;" +
    "uniform mat4 uProj,uView,uModel; uniform mat3 uRot;" +
    "varying vec3 vW; varying vec3 vN;" +
    "void main(){ vec4 w=uModel*vec4(aPos,1.0); vW=w.xyz; vN=uRot*aNorm; gl_Position=uProj*uView*w; }",
    "precision highp float; varying vec3 vW; varying vec3 vN;" +
    "uniform vec3 uCam,uLight,uColor,uEmissive,uSpace; uniform float uGloss;" +
    ACES +
    "void main(){" +
    "  vec3 N=normalize(vN), V=normalize(uCam-vW), H=normalize(uLight+V);" +
    "  float diff=max(dot(N,uLight),0.0);" +
    "  vec3 col=uColor*(0.22+0.12*N.y) + uColor*diff*0.66;" +
    "  float sp=pow(max(dot(N,H),0.0),48.0); col+=vec3(0.85,0.92,1.0)*sp*uGloss;" +
    "  float fres=pow(1.0-max(dot(N,V),0.0),4.0); col+=vec3(0.35,0.5,0.7)*fres*0.08;" +
    "  col+=uEmissive;" +
    "  float d=length(uCam-vW); col=mix(col,uSpace,smoothstep(70.0,150.0,d));" +
    "  col=aces(col); col=pow(col,vec3(1.0/2.2));" +
    "  gl_FragColor=vec4(col,1.0);" +
    "}"
  );
  const uS = {
    proj: loc(surfProg, "uProj"), view: loc(surfProg, "uView"), model: loc(surfProg, "uModel"),
    rot: loc(surfProg, "uRot"), cam: loc(surfProg, "uCam"), light: loc(surfProg, "uLight"),
    color: loc(surfProg, "uColor"), emis: loc(surfProg, "uEmissive"), gloss: loc(surfProg, "uGloss"),
    space: loc(surfProg, "uSpace")
  };
  const aS_pos = gl.getAttribLocation(surfProg, "aPos"), aS_nor = gl.getAttribLocation(surfProg, "aNorm");

  // fortress deck: procedural paneling + edge light strips + soft cast-shadow spots
  const groundProg = program(
    "attribute vec3 aPos;" +
    "uniform mat4 uProj,uView;" +
    "varying vec3 vW;" +
    "void main(){ vW=aPos; gl_Position=uProj*uView*vec4(aPos,1.0); }",
    "precision highp float; varying vec3 vW;" +
    "uniform vec3 uCam,uSpace; uniform float uZOff,uTime;" +
    "uniform vec4 uShadows[8]; uniform int uShadowCnt;" +
    "float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }" +
    ACES +
    "void main(){" +
    "  float wz=vW.z+uZOff;" +
    "  vec2 pz=vec2(vW.x,wz);" +
    "  float ax=abs(vW.x);" +
    "  vec2 cell=floor(pz/3.2);" +
    "  vec2 f=fract(pz/3.2);" +
    "  float sx=min(f.x,1.0-f.x), sz2=min(f.y,1.0-f.y);" +
    "  float seam=smoothstep(0.0,0.045,sx)*smoothstep(0.0,0.045,sz2);" +
    "  float h=hash(vec2(cell.x,mod(cell.y,30.0)));" +
    "  vec3 base=mix(vec3(0.030,0.038,0.062),vec3(0.048,0.058,0.088),h);" +
    "  base*=0.96+hash(vec2(floor(pz.x*1.25),mod(floor(pz.y*1.25),120.0))+7.31)*0.08;" +
    "  base*=0.55+0.45*seam;" +
    "  base*=1.16-0.40*smoothstep(7.5,10.4,ax);" +
    "  vec3 col=base;" +
    "  float sh=0.0;" +
    "  for(int i=0;i<8;i++){ if(i>=uShadowCnt) break; vec4 s=uShadows[i];" +
    "    float d=length(vec2(vW.x-s.x,vW.z-s.y)); sh=max(sh,s.w*smoothstep(s.z,s.z*0.5,d)); }" +
    "  col*=1.0-clamp(sh,0.0,0.9);" +
    "  float strip=step(11.7,ax)*step(ax,12.28);" +
    "  float dash=step(fract(wz/8.0),0.78);" +
    "  col+=vec3(0.16,0.85,1.15)*strip*(0.14+dash*(0.5+0.22*sin(uTime*2.2+wz*0.35)));" +
    "  col+=vec3(0.012,0.06,0.085)*smoothstep(9.5,11.9,ax)*(1.0-strip);" +
    "  float cd=abs(fract(wz/24.0)-0.5)*24.0;" +
    "  col+=vec3(0.02,0.09,0.12)*smoothstep(0.35,0.08,cd)*(1.0-step(11.7,ax));" +
    "  float d2=length(uCam-vW); col=mix(col,uSpace,smoothstep(70.0,150.0,d2));" +
    "  col=aces(col); col=pow(col,vec3(1.0/2.2));" +
    "  gl_FragColor=vec4(col,1.0);" +
    "}"
  );
  const uG = {
    proj: loc(groundProg, "uProj"), view: loc(groundProg, "uView"), cam: loc(groundProg, "uCam"),
    space: loc(groundProg, "uSpace"), zoff: loc(groundProg, "uZOff"), time: loc(groundProg, "uTime"),
    shadows: loc(groundProg, "uShadows"), shadowCnt: loc(groundProg, "uShadowCnt")
  };
  const aG_pos = gl.getAttribLocation(groundProg, "aPos");

  // additive glow sprites: pos + rgba + corner(x,y) + shape (0=disc, 1=soft rect)
  const spriteProg = program(
    "attribute vec3 aPos; attribute vec4 aCol; attribute vec3 aCorner;" +
    "uniform mat4 uProj,uView;" +
    "varying vec4 vCol; varying vec3 vCorner;" +
    "void main(){ vCol=aCol; vCorner=aCorner; gl_Position=uProj*uView*vec4(aPos,1.0); }",
    "precision mediump float; varying vec4 vCol; varying vec3 vCorner;" +
    "void main(){" +
    "  float d=length(vCorner.xy);" +
    "  float disc=smoothstep(1.0,0.05,d);" +
    "  disc*=disc;" +
    "  float rx=1.0-abs(vCorner.x), ry=1.0-abs(vCorner.y);" +
    "  float rect=clamp(rx*3.0,0.0,1.0)*clamp(ry*1.6,0.0,1.0);" +
    "  float a=mix(disc,rect,vCorner.z)*vCol.a;" +
    "  gl_FragColor=vec4(vCol.rgb*a,a);" +
    "}"
  );
  const uP = { proj: loc(spriteProg, "uProj"), view: loc(spriteProg, "uView") };
  const aP_pos = gl.getAttribLocation(spriteProg, "aPos"), aP_col = gl.getAttribLocation(spriteProg, "aCol"), aP_cor = gl.getAttribLocation(spriteProg, "aCorner");

  /* ============================ meshes ============================ */
  function buildMesh(pos, nor) {
    const n = pos.length / 3, data = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      data[i * 6] = pos[i * 3]; data[i * 6 + 1] = pos[i * 3 + 1]; data[i * 6 + 2] = pos[i * 3 + 2];
      data[i * 6 + 3] = nor[i * 3]; data[i * 6 + 4] = nor[i * 3 + 1]; data[i * 6 + 5] = nor[i * 3 + 2];
    }
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return { vbo: vbo, n: n };
  }
  function boxMesh() { // unit cube, per-face normals
    const P = [], N = [];
    const faces = [
      [[0, 0, 1], [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]],
      [[0, 0, -1], [0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]],
      [[1, 0, 0], [0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]],
      [[-1, 0, 0], [-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]],
      [[0, 1, 0], [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]],
      [[0, -1, 0], [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]]
    ];
    for (const f of faces) {
      const nrm = f[0], q = [f[1], f[2], f[3], f[4]];
      for (const t of [[0, 1, 2], [0, 2, 3]]) for (const idx of t) {
        P.push(q[idx][0], q[idx][1], q[idx][2]); N.push(nrm[0], nrm[1], nrm[2]);
      }
    }
    return buildMesh(P, N);
  }
  function cylMesh(seg) { // unit: r 0.5, h 1, y axis, smooth sides + caps
    const P = [], N = [];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const v = [[c0 * 0.5, -0.5, s0 * 0.5], [c1 * 0.5, -0.5, s1 * 0.5], [c1 * 0.5, 0.5, s1 * 0.5], [c0 * 0.5, 0.5, s0 * 0.5]];
      const n = [[c0, 0, s0], [c1, 0, s1], [c1, 0, s1], [c0, 0, s0]];
      for (const t of [[0, 1, 2], [0, 2, 3]]) for (const idx of t) { P.push(v[idx][0], v[idx][1], v[idx][2]); N.push(n[idx][0], n[idx][1], n[idx][2]); }
      P.push(0, 0.5, 0, c0 * 0.5, 0.5, s0 * 0.5, c1 * 0.5, 0.5, s1 * 0.5); for (let k = 0; k < 3; k++) N.push(0, 1, 0);
      P.push(0, -0.5, 0, c1 * 0.5, -0.5, s1 * 0.5, c0 * 0.5, -0.5, s0 * 0.5); for (let k = 0; k < 3; k++) N.push(0, -1, 0);
    }
    return buildMesh(P, N);
  }
  function coneMesh(seg) { // unit: base r 0.5 at y -0.5, apex at y +0.5
    const P = [], N = [];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const n0 = norm3([c0, 0.5, s0]), n1 = norm3([c1, 0.5, s1]);
      P.push(0, 0.5, 0, c0 * 0.5, -0.5, s0 * 0.5, c1 * 0.5, -0.5, s1 * 0.5);
      N.push(n0[0], n0[1], n0[2], n0[0], n0[1], n0[2], n1[0], n1[1], n1[2]);
      P.push(0, -0.5, 0, c1 * 0.5, -0.5, s1 * 0.5, c0 * 0.5, -0.5, s0 * 0.5); for (let k = 0; k < 3; k++) N.push(0, -1, 0);
    }
    return buildMesh(P, N);
  }
  function octaMesh() { // unit octahedron (r 0.5), faceted
    const V = [[0.5, 0, 0], [-0.5, 0, 0], [0, 0.5, 0], [0, -0.5, 0], [0, 0, 0.5], [0, 0, -0.5]];
    const F = [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]];
    const P = [], N = [];
    for (const f of F) {
      const a = V[f[0]], b = V[f[1]], c = V[f[2]];
      const n = norm3([(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
                       (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
                       (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])]);
      for (const i of f) { P.push(V[i][0], V[i][1], V[i][2]); }
      for (let k = 0; k < 3; k++) N.push(n[0], n[1], n[2]);
    }
    return buildMesh(P, N);
  }
  const MESH = { box: boxMesh(), cyl: cylMesh(14), cone: coneMesh(4), coneR: coneMesh(12), octa: octaMesh() };

  // deck: one long strip in render space (ship z = 0), redrawn each frame
  const groundVbo = gl.createBuffer();
  (function () {
    const x = FLOOR_W, z0 = -26, z1 = 112;
    const v = new Float32Array([-x, 0, z0, x, 0, z0, x, 0, z1, -x, 0, z0, x, 0, z1, -x, 0, z1]);
    gl.bindBuffer(gl.ARRAY_BUFFER, groundVbo); gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
  })();

  /* ============================ sprite batch ============================ */
  const SPR_MAX = 6500; // vertices
  const sprData = new Float32Array(SPR_MAX * 10);
  let sprCount = 0;
  const sprVbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, sprVbo);
  gl.bufferData(gl.ARRAY_BUFFER, sprData.byteLength, gl.DYNAMIC_DRAW);
  let camRight = [1, 0, 0], camUp = [0, 1, 0], camPos = [0, 10, -20];

  function sprVert(x, y, z, r, g, b, a, cx, cy, shape) {
    if (sprCount >= SPR_MAX) return;
    const o = sprCount * 10;
    sprData[o] = x; sprData[o + 1] = y; sprData[o + 2] = z;
    sprData[o + 3] = r; sprData[o + 4] = g; sprData[o + 5] = b; sprData[o + 6] = a;
    sprData[o + 7] = cx; sprData[o + 8] = cy; sprData[o + 9] = shape;
    sprCount++;
  }
  function pushSprite(p, size, r, g, b, a) { // camera-facing disc glow
    const rx = camRight[0] * size, ry = camRight[1] * size, rz = camRight[2] * size;
    const ux = camUp[0] * size, uy = camUp[1] * size, uz = camUp[2] * size;
    sprVert(p[0] - rx - ux, p[1] - ry - uy, p[2] - rz - uz, r, g, b, a, -1, -1, 0);
    sprVert(p[0] + rx - ux, p[1] + ry - uy, p[2] + rz - uz, r, g, b, a, 1, -1, 0);
    sprVert(p[0] + rx + ux, p[1] + ry + uy, p[2] + rz + uz, r, g, b, a, 1, 1, 0);
    sprVert(p[0] - rx - ux, p[1] - ry - uy, p[2] - rz - uz, r, g, b, a, -1, -1, 0);
    sprVert(p[0] + rx + ux, p[1] + ry + uy, p[2] + rz + uz, r, g, b, a, 1, 1, 0);
    sprVert(p[0] - rx + ux, p[1] - ry + uy, p[2] - rz + uz, r, g, b, a, -1, 1, 0);
  }
  function pushBeamQuad(p, ax, halfLen, halfW, r, g, b, a) { // quad along axis ax, width faces camera
    const vdx = p[0] - camPos[0], vdy = p[1] - camPos[1], vdz = p[2] - camPos[2];
    let wx = ax[1] * vdz - ax[2] * vdy, wy = ax[2] * vdx - ax[0] * vdz, wz = ax[0] * vdy - ax[1] * vdx;
    const wl = Math.sqrt(wx * wx + wy * wy + wz * wz) || 1;
    wx = wx / wl * halfW; wy = wy / wl * halfW; wz = wz / wl * halfW;
    const lx = ax[0] * halfLen, ly = ax[1] * halfLen, lz = ax[2] * halfLen;
    sprVert(p[0] - lx - wx, p[1] - ly - wy, p[2] - lz - wz, r, g, b, a, -1, -1, 1);
    sprVert(p[0] + lx - wx, p[1] + ly - wy, p[2] + lz - wz, r, g, b, a, 1, -1, 1);
    sprVert(p[0] + lx + wx, p[1] + ly + wy, p[2] + lz + wz, r, g, b, a, 1, 1, 1);
    sprVert(p[0] - lx - wx, p[1] - ly - wy, p[2] - lz - wz, r, g, b, a, -1, -1, 1);
    sprVert(p[0] + lx + wx, p[1] + ly + wy, p[2] + lz + wz, r, g, b, a, 1, 1, 1);
    sprVert(p[0] - lx + wx, p[1] - ly + wy, p[2] - lz + wz, r, g, b, a, -1, 1, 1);
  }

  /* ============================ starfield ============================ */
  const STAR_WRAP = 240;
  const stars = [];
  for (let i = 0; i < 430; i++) {
    let x = rnd(-150, 150), y = rnd(-55, 75);
    if (Math.abs(x) < 22 && y > -4) y = rnd(-55, -8); // keep stars off the deck plane
    stars.push({ x: x, y: y, z: Math.random() * STAR_WRAP, s: rnd(0.18, 0.62), tw: rnd(0.6, 2.4), ph: rnd(0, 6.28) });
  }
  const nebulas = [];
  for (let i = 0; i < 4; i++) {
    nebulas.push({
      x: (i % 2 ? 1 : -1) * rnd(45, 90), y: rnd(-10, 45), z: rnd(0, STAR_WRAP), s: rnd(34, 60),
      col: i % 2 ? [0.16, 0.10, 0.34] : [0.05, 0.20, 0.30]
    });
  }

  /* ============================ game state ============================ */
  let state = "menu";           // menu | playing | flameout | dying | dead
  let sx = 0, sy = 2.8, sz = 0; // ship position (world)
  let tx = 0, ty = 2.8;         // control target
  let vxs = 0, vys = 0;         // smoothed velocities (for banking)
  let speed = BASE_SPEED;
  let dist = 0, startZ = 0;
  let fuel = FUEL_MAX;
  let score = 0, bonus = 0, shownScore = -1;
  let best = 0;
  try { best = parseInt(localStorage.getItem("skyfortress_best") || "0", 10) || 0; } catch (e) {}
  let spawnZ = 40, lastTankZ = 0, droneTimer = 6;
  let fireT = 0, muzzleSide = 1, lowFuelT = 0, dieT = 0, deathCause = "";
  let shake = 0, tGlobal = 0, hintShown = true;

  const walls = [];    // { z, blocks:[{x0,x1,y0,y1}], glows:[{x,y,z,w,h}] , kind }
  const barriers = []; // { z, y, on }
  const turrets = [];  // { x, z, cd, yaw, dead }
  const tanks = [];    // { x, z, dead }
  const drones = [];   // { bx, by, z, ph, dead }
  const decors = [];   // { x, z, w, h, d, c }
  const shots = [];    // { x, y, z, side }
  const orbs = [];     // { x, y, z, vx, vy, vz }
  const sparks = [];   // { x,y,z, vx,vy,vz, life, life0, r,g,b, size, grav }

  /* ============================ world spawning ============================ */
  function diffAt() { return clamp(dist / 1400, 0, 1); }

  function spawnWall(z, d) {
    const kind = Math.random();
    const blocks = [], glows = [];
    if (kind < 0.45) { // doorway wall: slot gap + lintel; fly through low or over the top
      const h = 5.3, g = rnd(4.6, 6.2) - d * 1.2, gx = rnd(-CORR + 3, CORR - 3);
      const lintelY = h - 1.4;
      blocks.push({ x0: -FLOOR_W, x1: gx - g / 2, y0: 0, y1: h });
      blocks.push({ x0: gx + g / 2, x1: FLOOR_W, y0: 0, y1: h });
      blocks.push({ x0: gx - g / 2, x1: gx + g / 2, y0: lintelY, y1: h });
      glows.push({ x: gx - g / 2 + 0.1, y: lintelY / 2, w: 0.12, h: lintelY });
      glows.push({ x: gx + g / 2 - 0.1, y: lintelY / 2, w: 0.12, h: lintelY });
      walls.push({ z: z, blocks: blocks, glows: glows, kind: "door" });
    } else if (kind < 0.75) { // low wall — fly over
      const h = rnd(2.2, 3.0) + d * 0.7;
      blocks.push({ x0: -FLOOR_W, x1: FLOOR_W, y0: 0, y1: h });
      glows.push({ x: 0, y: h - 0.06, w: FLOOR_W * 2, h: 0.1, top: true });
      walls.push({ z: z, blocks: blocks, glows: glows, kind: "low" });
    } else { // floating band — duck under (or squeeze over)
      const y0 = rnd(2.8, 3.6), y1 = y0 + rnd(2.6, 3.4);
      blocks.push({ x0: -FLOOR_W, x1: -FLOOR_W + 1.1, y0: 0, y1: y1 });
      blocks.push({ x0: FLOOR_W - 1.1, x1: FLOOR_W, y0: 0, y1: y1 });
      blocks.push({ x0: -FLOOR_W + 1.1, x1: FLOOR_W - 1.1, y0: y0, y1: y1 });
      glows.push({ x: 0, y: y0 + 0.06, w: (FLOOR_W - 1.1) * 2, h: 0.1, top: false });
      walls.push({ z: z, blocks: blocks, glows: glows, kind: "band" });
    }
  }
  function spawnBarrier(z, d) {
    const ys = [1.7, 3.3, 5.1];
    barriers.push({ z: z, y: ys[(Math.random() * ys.length) | 0] });
    if (d > 0.5 && Math.random() < 0.35) {
      let y2 = ys[(Math.random() * ys.length) | 0];
      barriers.push({ z: z + 7, y: y2 });
    }
  }
  function spawnTurrets(z, n) {
    for (let i = 0; i < n; i++) turrets.push({ x: rnd(-7, 7), z: z + rnd(-5, 5), cd: rnd(1.2, 2.8), yaw: 0, dead: false });
  }
  function spawnTanks(z, n) {
    for (let i = 0; i < n; i++) tanks.push({ x: rnd(-6.5, 6.5), z: z + rnd(-4, 4), dead: false });
    lastTankZ = z;
  }
  function spawnDecor(z) {
    for (let i = 0; i < 3; i++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      decors.push({
        x: side * rnd(9.6, 11.6), z: z + rnd(-7, 7),
        w: rnd(0.7, 1.8), h: rnd(0.35, 1.5), d: rnd(0.7, 2.2),
        c: rnd(0.7, 1.15)
      });
    }
  }
  function spawnSegment(z) {
    const d = state === "menu" ? 0.25 : diffAt();
    if (z - lastTankZ > 260) { spawnTanks(z, 2); spawnDecor(z); return; }
    const r = Math.random();
    if (r < 0.14) spawnDecor(z);
    else if (r < 0.40) { spawnWall(z, d); if (d > 0.55 && Math.random() < 0.5) spawnTurrets(z - 9, 1); }
    else if (r < 0.60) { spawnBarrier(z, d); spawnDecor(z); }
    else if (r < 0.77) { spawnTurrets(z, 1 + ((Math.random() + d) > 1 ? 1 : 0) + (d > 0.7 && Math.random() < 0.5 ? 1 : 0)); spawnDecor(z); }
    else if (r < 0.90) { spawnTanks(z, 1 + (Math.random() < 0.4 ? 1 : 0)); if (d > 0.45 && Math.random() < 0.5) spawnTurrets(z + 6, 1); }
    else { spawnWall(z, d); spawnBarrier(z - 8, d); }
  }
  function pump() {
    while (spawnZ < sz + VIEW_AHEAD) { spawnSegment(spawnZ); spawnZ += SEG; }
    // cull behind
    const back = sz - 30;
    for (const arr of [walls, barriers, turrets, tanks, decors]) {
      for (let i = arr.length - 1; i >= 0; i--) if (arr[i].z < back) arr.splice(i, 1);
    }
    for (let i = drones.length - 1; i >= 0; i--) if (drones[i].z < back || drones[i].dead) drones.splice(i, 1);
  }

  /* ============================ particles ============================ */
  function spawnExplosion(x, y, z, col, scale) {
    const n = REDMO ? 10 : 26;
    for (let i = 0; i < n; i++) {
      const th = rnd(0, Math.PI * 2), ph = rnd(-1.2, 1.2), sp = rnd(3, 13) * scale;
      sparks.push({
        x: x, y: y, z: z,
        vx: Math.cos(th) * Math.cos(ph) * sp, vy: Math.sin(ph) * sp + 2.5, vz: Math.sin(th) * Math.cos(ph) * sp,
        life: rnd(0.35, 0.85), life0: 1, r: col[0], g: col[1], b: col[2], size: rnd(0.12, 0.3) * scale, grav: -9
      });
    }
    sparks.push({ x: x, y: y, z: z, vx: 0, vy: 0, vz: 0, life: 0.22, life0: 0.22, r: col[0] * 1.2, g: col[1] * 1.2, b: col[2] * 1.1, size: 2.6 * scale, grav: 0, flash: true });
  }
  function updSparks(dt) {
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.life -= dt;
      if (s.life <= 0) { sparks.splice(i, 1); continue; }
      const dr = Math.pow(0.08, dt);
      s.vx *= dr; s.vz *= dr; s.vy = s.vy * dr + s.grav * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      if (s.y < 0.05 && !s.flash) { s.y = 0.05; s.vy = Math.abs(s.vy) * 0.4; }
    }
  }

  /* ============================ audio ============================ */
  let AC = null, outGain = null, verb = null, verbSend = null, engineNodes = null, whooshNodes = null;
  let soundOn = true;
  try { soundOn = localStorage.getItem("skyfortress_sound") !== "off"; } catch (e) {}

  function makeImpulse(ctx, secs, decay) {
    const rate = ctx.sampleRate, len = Math.floor(secs * rate), imp = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = imp.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const w = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
        lp += (w - lp) * 0.24; // low-pass so the tail isn't grainy
        d[i] = lp;
      }
    }
    return imp;
  }
  function ensureAudio() {
    if (AC) { if (AC.state === "suspended") AC.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    AC = new Ctx();
    // iOS unlock: 1-sample silent buffer inside the gesture
    try {
      const b = AC.createBuffer(1, 1, 22050), s = AC.createBufferSource();
      s.buffer = b; s.connect(AC.destination); s.start(0);
    } catch (e) {}
    outGain = AC.createGain(); outGain.gain.value = soundOn ? 0.9 : 0;
    const comp = AC.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.24;
    const master = AC.createBiquadFilter(); master.type = "lowpass"; master.frequency.value = 11000;
    outGain.connect(comp); comp.connect(master); master.connect(AC.destination);
    verb = AC.createConvolver(); verb.buffer = makeImpulse(AC, 2.3, 2.6);
    const verbGain = AC.createGain(); verbGain.gain.value = 0.34;
    verbSend = AC.createGain(); verbSend.gain.value = 1;
    verbSend.connect(verb); verb.connect(verbGain); verbGain.connect(outGain);

    // engine: two detuned saws + sub sine through a tracking lowpass
    const o1 = AC.createOscillator(), o2 = AC.createOscillator(), o3 = AC.createOscillator();
    o1.type = "sawtooth"; o2.type = "sawtooth"; o3.type = "sine";
    o1.frequency.value = 55; o2.frequency.value = 55; o3.frequency.value = 27.5;
    o2.detune.value = 9;
    const ef = AC.createBiquadFilter(); ef.type = "lowpass"; ef.frequency.value = 420; ef.Q.value = 1.2;
    const eg = AC.createGain(); eg.gain.value = 0;
    o1.connect(ef); o2.connect(ef); o3.connect(ef); ef.connect(eg); eg.connect(outGain);
    o1.start(); o2.start(); o3.start();
    engineNodes = { o1: o1, o2: o2, o3: o3, f: ef, g: eg };

    // altitude-change whoosh: filtered noise, gain follows |climb rate|
    const nb = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const ns = AC.createBufferSource(); ns.buffer = nb; ns.loop = true;
    const nf = AC.createBiquadFilter(); nf.type = "bandpass"; nf.frequency.value = 600; nf.Q.value = 0.8;
    const ng = AC.createGain(); ng.gain.value = 0;
    ns.connect(nf); nf.connect(ng); ng.connect(outGain); ns.start();
    whooshNodes = { f: nf, g: ng };
  }
  function panNode(x) {
    if (!AC.createStereoPanner) return null;
    const p = AC.createStereoPanner(); p.pan.value = clamp(x / (CORR + 2), -1, 1); return p;
  }
  function routeOut(node, x, verbAmt) {
    const p = panNode(x);
    if (p) { node.connect(p); p.connect(outGain); if (verbAmt) { const g = AC.createGain(); g.gain.value = verbAmt; p.connect(g); g.connect(verbSend); } }
    else { node.connect(outGain); if (verbAmt) { const g = AC.createGain(); g.gain.value = verbAmt; node.connect(g); g.connect(verbSend); } }
  }
  function playLaser(x) {
    if (!AC || !soundOn) return;
    const t = AC.currentTime;
    const o = AC.createOscillator(); o.type = "square";
    const f0 = 1300 * rnd(0.92, 1.1);
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(340, t + 0.08);
    const g = AC.createGain();
    g.gain.setValueAtTime(0.045, t); g.gain.exponentialRampToValueAtTime(0.0006, t + 0.1);
    o.connect(g); routeOut(g, x, 0.12);
    o.start(t); o.stop(t + 0.12);
  }
  function playExplosion(x, scale) {
    if (!AC || !soundOn) return;
    const t = AC.currentTime;
    const nb = AC.createBuffer(1, AC.sampleRate * 0.5, AC.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / nd.length, 1.6);
    const ns = AC.createBufferSource(); ns.buffer = nb;
    const nf = AC.createBiquadFilter(); nf.type = "lowpass";
    nf.frequency.setValueAtTime(2400, t); nf.frequency.exponentialRampToValueAtTime(240, t + 0.4);
    const ng = AC.createGain(); ng.gain.setValueAtTime(0.34 * scale, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    ns.connect(nf); nf.connect(ng); routeOut(ng, x, 0.5);
    ns.start(t);
    const o = AC.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(36, t + 0.4);
    const og = AC.createGain(); og.gain.setValueAtTime(0.3 * scale, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    o.connect(og); routeOut(og, x, 0.3);
    o.start(t); o.stop(t + 0.5);
  }
  function playPickup(x) {
    if (!AC || !soundOn) return;
    const t = AC.currentTime;
    [[660, 0], [990, 0.09]].forEach(function (nn) {
      const o = AC.createOscillator(); o.type = "triangle"; o.frequency.value = nn[0];
      const g = AC.createGain();
      g.gain.setValueAtTime(0.0001, t + nn[1]); g.gain.exponentialRampToValueAtTime(0.09, t + nn[1] + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0006, t + nn[1] + 0.35);
      o.connect(g); routeOut(g, x, 0.4);
      o.start(t + nn[1]); o.stop(t + nn[1] + 0.4);
    });
  }
  function playWarning() {
    if (!AC || !soundOn) return;
    const t = AC.currentTime;
    [0, 0.16].forEach(function (d) {
      const o = AC.createOscillator(); o.type = "square"; o.frequency.value = 520;
      const g = AC.createGain();
      g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.035, t + d + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0006, t + d + 0.09);
      o.connect(g); g.connect(outGain);
      o.start(t + d); o.stop(t + d + 0.1);
    });
  }
  function playFanfare() {
    if (!AC || !soundOn) return;
    const t = AC.currentTime;
    [523.25, 659.25, 784, 1046.5].forEach(function (f, i) {
      const o = AC.createOscillator(); o.type = "triangle"; o.frequency.value = f;
      const g = AC.createGain();
      g.gain.setValueAtTime(0.0001, t + i * 0.09); g.gain.exponentialRampToValueAtTime(0.1, t + i * 0.09 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0008, t + i * 0.09 + 0.5);
      o.connect(g); routeOut(g, 0, 0.55);
      o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.55);
    });
  }
  function updateEngineAudio(dt) {
    if (!AC || !engineNodes) return;
    const playing = state === "playing" || state === "flameout";
    const f = 40 + speed * 1.9 + sy * 2.2 - (state === "flameout" ? 18 : 0);
    engineNodes.o1.frequency.setTargetAtTime(f, AC.currentTime, 0.08);
    engineNodes.o2.frequency.setTargetAtTime(f, AC.currentTime, 0.08);
    engineNodes.o3.frequency.setTargetAtTime(f / 2, AC.currentTime, 0.08);
    engineNodes.f.frequency.setTargetAtTime(280 + speed * 26 + (playing ? 120 : 0), AC.currentTime, 0.1);
    engineNodes.g.gain.setTargetAtTime(playing && soundOn ? 0.085 : (state === "menu" && soundOn ? 0.03 : 0), AC.currentTime, 0.14);
    if (whooshNodes) {
      const w = clamp(Math.abs(vys) * 0.035, 0, 0.12);
      whooshNodes.g.gain.setTargetAtTime(playing && soundOn ? w : 0, AC.currentTime, 0.08);
      whooshNodes.f.frequency.setTargetAtTime(420 + sy * 95, AC.currentTime, 0.1);
    }
  }

  /* ============================ HUD / overlay ============================ */
  function track(name) { try { if (typeof window.gtag === "function") window.gtag("event", name, {}); } catch (e) {} }
  function renderBest() { elBest.textContent = best > 0 ? "Best " + best : "Best –"; }
  renderBest();

  function setFuelHud() {
    elFuelBar.style.width = clamp(fuel, 0, 100) + "%";
    elFuelWrap.classList.toggle("is-low", fuel < 25 && (state === "playing" || state === "flameout"));
  }
  function setAltHud() {
    const t = clamp((sy - MINY) / (MAXY - MINY), 0, 1);
    elAltMarker.style.bottom = (t * 100) + "%";
  }
  function setScoreHud() {
    const s = Math.floor(dist * 2) + bonus;
    score = s;
    if (s !== shownScore) { shownScore = s; elScore.textContent = String(s); }
  }
  function burstConfetti() {
    const cols = ["#8fd8ff", "#3d9bf5", "#d7ecff", "#57ffca", "#ffd257"];
    for (let i = 0; i < 44; i++) {
      const el = document.createElement("i");
      const x = 50 + (Math.random() - 0.5) * 44, dx = (Math.random() - 0.5) * 240, dy = 240 + Math.random() * 260, rot = (Math.random() - 0.5) * 900;
      el.style.cssText = "left:" + x + "%;top:30%;background:" + cols[i % cols.length] + ";--dx:" + dx + "px;--dy:" + dy + "px;--rot:" + rot + "deg;--d:" + (620 + Math.random() * 520) + "ms";
      elConfetti.appendChild(el);
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1250);
    }
  }
  function showOverlay() { elOverlay.hidden = false; requestAnimationFrame(function () { elOverlay.classList.remove("is-hidden"); }); }
  function hideOverlay() {
    elOverlay.classList.add("is-hidden");
    setTimeout(function () { if (elOverlay.classList.contains("is-hidden")) elOverlay.hidden = true; }, 300);
  }

  const CAUSE_TEXT = {
    wall: "Straight into fortress plating.",
    field: "The force field bit.",
    drone: "Rammed by a patrol drone.",
    shot: "Turret flak found its mark.",
    fuel: "The tanks ran dry."
  };
  function gameOver() {
    state = "dead";
    const isBest = score > best;
    if (isBest && dist > 10) {
      best = score;
      try { localStorage.setItem("skyfortress_best", String(best)); } catch (e) {}
      renderBest();
      track("new_best");
    }
    elOvTitle.textContent = "Ship down";
    elOvText.innerHTML = (CAUSE_TEXT[deathCause] || "") + " You flew <span class=\"stat\">" + Math.floor(dist) +
      "m</span> and scored <span class=\"stat\">" + score + "</span>." +
      (isBest && dist > 10 ? " <span class=\"stat\">New best!</span>" : (best > 0 ? " Best: " + best + "." : ""));
    elOvBtn.textContent = "Fly again";
    window.OPT_SHARE_TEXT = "Sky Fortress: I flew " + Math.floor(dist) + "m and scored " + score + ". Can you beat it?";
    showOverlay();
    if (isBest && dist > 10) { burstConfetti(); playFanfare(); }
    track("game_over");
  }
  function startGame() {
    ensureAudio();
    walls.length = 0; barriers.length = 0; turrets.length = 0; tanks.length = 0;
    drones.length = 0; decors.length = 0; shots.length = 0; orbs.length = 0; sparks.length = 0;
    sx = 0; sy = 2.8; tx = 0; ty = 2.8; vxs = 0; vys = 0;
    startZ = sz; dist = 0; bonus = 0; fuel = FUEL_MAX; shownScore = -1;
    spawnZ = sz + 34; lastTankZ = sz; droneTimer = 7; fireT = 0; dieT = 0; shake = 0;
    state = "playing";
    hideOverlay();
    setFuelHud(); setScoreHud();
    if (hintShown) { setTimeout(function () { elHint.classList.add("is-gone"); hintShown = false; }, 3200); }
    track("game_start");
  }
  function die(cause) {
    if (state !== "playing" && state !== "flameout") return;
    deathCause = cause;
    state = "dying"; dieT = 0;
    spawnExplosion(sx, sy, sz, [1, 0.55, 0.2], 1.7);
    spawnExplosion(sx, sy, sz, [1, 0.85, 0.4], 1.0);
    playExplosion(sx, 1.5);
    shake = REDMO ? 0 : 1;
    elFlash.classList.add("is-on");
    setTimeout(function () { elFlash.classList.remove("is-on"); }, 160);
  }

  elOvBtn.addEventListener("click", function () { if (state === "menu" || state === "dead") startGame(); });
  window.addEventListener("keydown", function (e) {
    if ((e.key === "r" || e.key === "R" || e.key === "Enter") && state === "dead") { startGame(); return; }
    if (e.key === " " && (state === "menu" || state === "dead")) { e.preventDefault(); startGame(); return; }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].indexOf(e.key) >= 0) e.preventDefault();
    keys[e.key] = true;
  });
  window.addEventListener("keyup", function (e) { keys[e.key] = false; });
  const keys = {};

  soundBtn.addEventListener("click", function () {
    soundOn = !soundOn;
    soundBtn.setAttribute("aria-pressed", String(soundOn));
    soundBtn.textContent = soundOn ? "♪" : "∅";
    try { localStorage.setItem("skyfortress_sound", soundOn ? "on" : "off"); } catch (e) {}
    if (soundOn) ensureAudio();
    if (AC && outGain) outGain.gain.setTargetAtTime(soundOn ? 0.9 : 0, AC.currentTime, 0.03);
  });
  soundBtn.setAttribute("aria-pressed", String(soundOn));
  soundBtn.textContent = soundOn ? "♪" : "∅";

  document.addEventListener("visibilitychange", function () {
    if (!AC) return;
    if (document.hidden) { try { AC.suspend(); } catch (e) {} }
    else if (soundOn) { try { AC.resume(); } catch (e) {} }
  });

  /* ============================ input ============================ */
  let dragging = false, lastPX = 0, lastPY = 0;
  canvas.addEventListener("pointerdown", function (e) {
    ensureAudio();
    dragging = true; lastPX = e.clientX; lastPY = e.clientY;
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", function (e) {
    if (!dragging) return;
    const dx = e.clientX - lastPX, dy = e.clientY - lastPY;
    lastPX = e.clientX; lastPY = e.clientY;
    if (state !== "playing") return;
    // screen-right = world -x at this camera angle, so the drag mapping is flipped
    const k = 19 / Math.min(window.innerWidth, window.innerHeight);
    tx = clamp(tx - dx * k, -SHIP_CLAMP, SHIP_CLAMP);
    ty = clamp(ty - dy * k * 0.95, MINY, MAXY);
    if (hintShown) { elHint.classList.add("is-gone"); hintShown = false; }
  });
  window.addEventListener("pointerup", function () { dragging = false; });
  window.addEventListener("pointercancel", function () { dragging = false; });

  /* ============================ collisions ============================ */
  function sphereAabb(px, py, pz, r, x0, x1, y0, y1, z0, z1) {
    const cx = clamp(px, x0, x1), cy = clamp(py, y0, y1), cz = clamp(pz, z0, z1);
    const dx = px - cx, dy = py - cy, dz = pz - cz;
    return dx * dx + dy * dy + dz * dz < r * r;
  }

  /* ============================ update ============================ */
  function update(dt) {
    tGlobal += dt;
    const playing = state === "playing";

    // forward speed
    if (playing) speed = BASE_SPEED + Math.min(13, dist / 160);
    else if (state === "menu") speed = 10;
    else if (state === "flameout") speed = Math.max(6, speed - 8 * dt);
    else speed = Math.max(0, speed - speed * 3 * dt); // dying: halt
    sz += speed * dt;
    dist = sz - startZ;

    // steering
    if (state === "menu") {
      tx = Math.sin(tGlobal * 0.42) * 4.2;
      ty = 3.0 + Math.sin(tGlobal * 0.63) * 1.7;
    } else if (playing) {
      const kx = 15 * dt, ky = 10 * dt;
      if (keys.ArrowLeft || keys.a || keys.A) tx = clamp(tx + kx, -SHIP_CLAMP, SHIP_CLAMP);
      if (keys.ArrowRight || keys.d || keys.D) tx = clamp(tx - kx, -SHIP_CLAMP, SHIP_CLAMP);
      if (keys.ArrowUp || keys.w || keys.W) ty = clamp(ty + ky, MINY, MAXY);
      if (keys.ArrowDown || keys.s || keys.S) ty = clamp(ty - ky, MINY, MAXY);
    } else if (state === "flameout") {
      ty = Math.max(MINY - 0.2, ty - 1.9 * dt); // sinking
    }
    if (state !== "dying" && state !== "dead") {
      const f = Math.min(1, dt * 9);
      const nx = sx + (tx - sx) * f, ny = sy + (ty - sy) * f;
      vxs = lerp(vxs, (nx - sx) / Math.max(dt, 1e-4), Math.min(1, dt * 8));
      vys = lerp(vys, (ny - sy) / Math.max(dt, 1e-4), Math.min(1, dt * 8));
      sx = nx; sy = ny;
    } else { vxs *= 0.9; vys *= 0.9; }

    // fuel
    if (playing) {
      fuel -= (2.0 + diffAt() * 0.9) * dt;
      if (fuel < 25) {
        lowFuelT -= dt;
        if (lowFuelT <= 0) { playWarning(); lowFuelT = 1.4; }
      }
      if (fuel <= 0) { fuel = 0; state = "flameout"; }
      setFuelHud();
    }
    if (state === "flameout" && sy <= MINY - 0.15) die("fuel");

    // spawn/cull world
    pump();

    // auto-fire
    if (playing) {
      fireT -= dt;
      if (fireT <= 0) {
        fireT = 0.16;
        muzzleSide = -muzzleSide;
        shots.push({ x: sx + muzzleSide * 0.95, y: sy - 0.05, z: sz + 1.6, side: muzzleSide });
        playLaser(sx);
      }
    }

    // shots
    const shotSpeed = speed + 48;
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i];
      s.z += shotSpeed * dt;
      if (s.z > sz + 60) { shots.splice(i, 1); continue; }
      let hit = false;
      for (const w of walls) {
        if (Math.abs(s.z - w.z) > WALL_TH / 2 + 0.4) continue;
        for (const b of w.blocks) {
          if (s.x > b.x0 - 0.1 && s.x < b.x1 + 0.1 && s.y > b.y0 - 0.1 && s.y < b.y1 + 0.1) { hit = true; break; }
        }
        if (hit) break;
      }
      if (!hit) for (const t of turrets) {
        if (t.dead) continue;
        const dx = s.x - t.x, dy = s.y - 0.75, dz = s.z - t.z;
        if (dx * dx + dy * dy + dz * dz < 1.1) {
          t.dead = true; hit = true; bonus += 100;
          spawnExplosion(t.x, 0.8, t.z, [1, 0.5, 0.18], 1);
          playExplosion(t.x, 0.8);
          break;
        }
      }
      if (!hit) for (const t of tanks) {
        if (t.dead) continue;
        const dx = s.x - t.x, dy = s.y - 1.0, dz = s.z - t.z;
        if (dx * dx + dy * dy + dz * dz < 1.5) {
          t.dead = true; hit = true; bonus += 150;
          fuel = clamp(fuel + 32, 0, FUEL_MAX); setFuelHud();
          spawnExplosion(t.x, 1.1, t.z, [0.35, 1, 0.55], 1.15);
          playExplosion(t.x, 0.9); playPickup(t.x);
          break;
        }
      }
      if (!hit) for (const d of drones) {
        if (d.dead) continue;
        const dx = s.x - d.x, dy = s.y - d.y, dz = s.z - d.z;
        if (dx * dx + dy * dy + dz * dz < 0.85) {
          d.dead = true; hit = true; bonus += 80;
          spawnExplosion(d.x, d.y, d.z, [1, 0.35, 0.75], 0.9);
          playExplosion(d.x, 0.7);
          break;
        }
      }
      if (hit) shots.splice(i, 1);
    }

    // turrets aim + fire
    for (const t of turrets) {
      if (t.dead) continue;
      const dz = t.z - sz;
      if (dz > 6 && dz < 48) {
        t.yaw = Math.atan2(sx - t.x, sz - t.z);
        if (playing) {
          t.cd -= dt;
          if (t.cd <= 0) {
            t.cd = rnd(2.1, 3.4) - diffAt() * 0.9;
            const tt = Math.max(0.4, dz / 26);
            const ax = sx - t.x, ay = sy - 1.0, az = (sz + speed * tt * 0.8) - t.z;
            const al = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
            const os = 24;
            orbs.push({ x: t.x, y: 1.0, z: t.z, vx: ax / al * os, vy: ay / al * os, vz: az / al * os });
          }
        }
      }
    }

    // orbs
    for (let i = orbs.length - 1; i >= 0; i--) {
      const o = orbs[i];
      o.x += o.vx * dt; o.y += o.vy * dt; o.z += o.vz * dt;
      if (o.z < sz - 12 || o.z > sz + 90 || o.y < 0 || o.y > 14) { orbs.splice(i, 1); continue; }
      if (playing) {
        const dx = o.x - sx, dy = o.y - sy, dz = o.z - sz;
        if (dx * dx + dy * dy + dz * dz < 0.62) { orbs.splice(i, 1); die("shot"); }
      }
    }

    // drones
    if ((playing || state === "menu") && dist > 120) {
      droneTimer -= dt;
      if (droneTimer <= 0) {
        droneTimer = rnd(8, 13) - diffAt() * 3;
        const bx = rnd(-5, 5), by = rnd(2.4, 6), n = 3 + (diffAt() > 0.6 ? 1 : 0);
        for (let i = 0; i < n; i++) drones.push({ bx: bx, by: by, z: sz + 95 + i * 7, ph: i * 1.9, x: bx, y: by, dead: false });
      }
    }
    for (const d of drones) {
      if (d.dead) continue;
      d.z -= 6.5 * dt; // world-space drift toward the player
      d.x = clamp(d.bx + Math.sin(tGlobal * 1.35 + d.ph) * 2.9, -CORR, CORR);
      d.y = clamp(d.by + Math.sin(tGlobal * 1.8 + d.ph * 1.4) * 1.5, 1.2, 8);
      if (playing) {
        const dx = d.x - sx, dy = d.y - sy, dz = d.z - sz;
        if (dx * dx + dy * dy + dz * dz < 1.0) { d.dead = true; spawnExplosion(d.x, d.y, d.z, [1, 0.35, 0.75], 0.9); die("drone"); }
      }
    }

    // ship vs world
    if (playing || state === "flameout") {
      for (const w of walls) {
        if (Math.abs(w.z - sz) > WALL_TH / 2 + SHIP_R) continue;
        for (const b of w.blocks) {
          if (sphereAabb(sx, sy, sz, SHIP_R, b.x0, b.x1, b.y0, b.y1, w.z - WALL_TH / 2, w.z + WALL_TH / 2)) { die("wall"); break; }
        }
      }
      for (const bar of barriers) {
        if (Math.abs(bar.z - sz) > 0.55 + SHIP_R) continue;
        if (Math.abs(sy - bar.y) < 0.42 + SHIP_R * 0.7 && Math.abs(sx) < CORR + 0.9) die("field");
      }
      for (const t of turrets) {
        if (t.dead) continue;
        const dx = sx - t.x, dy = sy - 0.7, dz = sz - t.z;
        if (dx * dx + dy * dy + dz * dz < 1.2) die("wall");
      }
      for (const t of tanks) {
        if (t.dead) continue;
        const dx = sx - t.x, dy = sy - 1.0, dz = sz - t.z;
        if (dx * dx + dy * dy + dz * dz < 1.6) die("wall");
      }
    }

    // dying timer
    if (state === "dying") {
      dieT += dt;
      if (dieT > 1.4) gameOver();
    }

    updSparks(dt);
    if (playing) setScoreHud();
    setAltHud();
    if (shake > 0) shake = Math.max(0, shake - dt * 1.8);
    updateEngineAudio(dt);
  }

  /* ============================ camera + render ============================ */
  let proj = mIdent(), view = mIdent();
  function setupCamera() {
    const asp = canvas.width / canvas.height;
    const fit = asp < 1.15 ? 1 + (1.15 - asp) * 0.95 : 1;
    const D = 47 * fit;
    const od = norm3([-0.62, 0.56, -0.62]);
    const shx = shake > 0 ? (Math.random() - 0.5) * shake * 1.1 : 0;
    const shy = shake > 0 ? (Math.random() - 0.5) * shake * 1.1 : 0;
    const sway = REDMO ? 0 : Math.sin(tGlobal * 0.3) * 0.35;
    const target = [sx * 0.22 + sway * 0.4 + shx, 3.15 + shy, 7];
    const eye = [target[0] + od[0] * D, target[1] + od[1] * D, target[2] + od[2] * D];
    proj = mPerspective(22.5 * Math.PI / 180, asp, 2, 300);
    view = mLookAt(eye, target, [0, 1, 0]);
    camPos = eye;
    camRight = [view[0], view[4], view[8]];
    camUp = [view[1], view[5], view[9]];
  }

  // bank/pitch, limited by ground clearance so the wings never dip through the deck
  function shipAttitude() {
    const clear = Math.max(0, sy - 0.34);
    const rollLim = Math.asin(Math.min(1, clear / 2.2));
    const pitchLim = Math.asin(Math.min(1, clear / 2.6));
    const roll = clamp(clamp(-vxs * 0.055, -0.55, 0.55), -rollLim, rollLim);
    const pitch = clamp(clamp(-vys * 0.045, -0.38, 0.38) + (state === "flameout" ? 0.3 : 0), -pitchLim, pitchLim);
    return { roll: roll, pitch: pitch };
  }

  function drawMesh(mesh, model, rot3, color, emis, gloss) {
    gl.uniformMatrix4fv(uS.model, false, model);
    gl.uniformMatrix3fv(uS.rot, false, rot3 || I3);
    gl.uniform3fv(uS.color, color);
    gl.uniform3fv(uS.emis, emis || [0, 0, 0]);
    gl.uniform1f(uS.gloss, gloss !== undefined ? gloss : 0.2);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
    gl.vertexAttribPointer(aS_pos, 3, gl.FLOAT, false, 24, 0);
    gl.vertexAttribPointer(aS_nor, 3, gl.FLOAT, false, 24, 12);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.n);
  }
  function boxAt(x, y, z, w, h, d, color, emis, gloss, rot) {
    const m = rot
      ? mMul(mTranslate(x, y, z), mMul(rot.m, mScale(w, h, d)))
      : mMul(mTranslate(x, y, z), mScale(w, h, d));
    drawMesh(MESH.box, m, rot ? rot.r3 : I3, color, emis, gloss);
  }

  const COL = {
    wall: [0.115, 0.135, 0.19],
    wallCap: [0.048, 0.055, 0.082],
    wallDark: [0.085, 0.10, 0.145],
    steel: [0.11, 0.125, 0.17],
    silver: [0.72, 0.76, 0.84],
    silverDk: [0.42, 0.46, 0.54],
    red: [0.72, 0.13, 0.17],
    glassEm: [0.15, 0.5, 0.6],
    turret: [0.17, 0.18, 0.235],
    tank: [0.055, 0.105, 0.085],
    drone: [0.16, 0.085, 0.17],
    pylon: [0.115, 0.13, 0.185]
  };

  function render() {
    setupCamera();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(SPACE[0], SPACE[1], SPACE[2], 1);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    /* ---- deck ---- */
    gl.useProgram(groundProg);
    gl.uniformMatrix4fv(uG.proj, false, proj);
    gl.uniformMatrix4fv(uG.view, false, view);
    gl.uniform3fv(uG.cam, camPos);
    gl.uniform3fv(uG.space, SPACE);
    gl.uniform1f(uG.zoff, sz % 96);
    gl.uniform1f(uG.time, tGlobal);
    // cast-shadow spots: ship + drones (the altitude read)
    const shadows = [];
    if (state !== "dead" && state !== "dying") {
      shadows.push([sx, 0, 0.7 + sy * 0.15, clamp(0.88 - sy * 0.045, 0.45, 0.88)]);
    }
    for (const d of drones) {
      if (d.dead || shadows.length >= 8) continue;
      const rz = d.z - sz;
      if (rz > -10 && rz < 80) shadows.push([d.x, rz, 0.45 + d.y * 0.11, 0.42]);
    }
    const shFlat = new Float32Array(32);
    for (let i = 0; i < shadows.length; i++) { shFlat[i * 4] = shadows[i][0]; shFlat[i * 4 + 1] = shadows[i][1]; shFlat[i * 4 + 2] = shadows[i][2]; shFlat[i * 4 + 3] = shadows[i][3]; }
    gl.uniform4fv(uG.shadows, shFlat);
    gl.uniform1i(uG.shadowCnt, shadows.length);
    gl.bindBuffer(gl.ARRAY_BUFFER, groundVbo);
    gl.enableVertexAttribArray(aG_pos);
    gl.vertexAttribPointer(aG_pos, 3, gl.FLOAT, false, 12, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disableVertexAttribArray(aG_pos);

    /* ---- opaque surfaces ---- */
    gl.useProgram(surfProg);
    gl.uniformMatrix4fv(uS.proj, false, proj);
    gl.uniformMatrix4fv(uS.view, false, view);
    gl.uniform3fv(uS.cam, camPos);
    gl.uniform3fv(uS.light, LIGHT);
    gl.uniform3fv(uS.space, SPACE);
    gl.enableVertexAttribArray(aS_pos);
    gl.enableVertexAttribArray(aS_nor);

    // fortress side skirts (the floating-slab edge)
    boxAt(-(FLOOR_W + 0.55), -4.5, 43, 1.1, 9, 138, COL.wallDark, null, 0.08);
    boxAt(FLOOR_W + 0.55, -4.5, 43, 1.1, 9, 138, COL.wallDark, null, 0.08);

    // walls
    for (const w of walls) {
      const rz = w.z - sz;
      if (rz < -26 || rz > 112) continue;
      for (const b of w.blocks) {
        boxAt((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, rz, b.x1 - b.x0, b.y1 - b.y0, WALL_TH, COL.wall, null, 0.28);
        boxAt((b.x0 + b.x1) / 2, b.y1 + 0.09, rz, (b.x1 - b.x0) + 0.14, 0.18, WALL_TH + 0.16, COL.wallCap, null, 0.35);
      }
      for (const g of w.glows) {
        const em = w.kind === "low" ? [1.1, 0.62, 0.1] : (w.kind === "band" ? [1.1, 0.62, 0.1] : [0.2, 0.9, 1.15]);
        boxAt(g.x, g.y, rz + (WALL_TH / 2 + 0.03) * 0, g.w, g.h, WALL_TH + 0.08, [0.1, 0.1, 0.12], em, 0);
      }
    }

    // decor greebles on the aprons
    for (const dc of decors) {
      const rz = dc.z - sz;
      if (rz < -26 || rz > 112) continue;
      boxAt(dc.x, dc.h / 2, rz, dc.w, dc.h, dc.d, [COL.steel[0] * dc.c, COL.steel[1] * dc.c, COL.steel[2] * dc.c], null, 0.15);
    }

    // barrier pylons
    for (const bar of barriers) {
      const rz = bar.z - sz;
      if (rz < -26 || rz > 112) continue;
      const h = bar.y + 0.8;
      boxAt(-(CORR + 1.0), h / 2, rz, 0.62, h, 0.62, COL.pylon, null, 0.3);
      boxAt(CORR + 1.0, h / 2, rz, 0.62, h, 0.62, COL.pylon, null, 0.3);
      boxAt(-(CORR + 1.0), bar.y, rz, 0.78, 0.34, 0.78, COL.pylon, [0.3, 1.1, 1.3], 0.3);
      boxAt(CORR + 1.0, bar.y, rz, 0.78, 0.34, 0.78, COL.pylon, [0.3, 1.1, 1.3], 0.3);
    }

    // turrets
    for (const t of turrets) {
      if (t.dead) continue;
      const rz = t.z - sz;
      if (rz < -26 || rz > 112) continue;
      const m1 = mMul(mTranslate(t.x, 0.26, rz), mScale(1.5, 0.52, 1.5));
      drawMesh(MESH.cyl, m1, I3, COL.turret, null, 0.25);
      const m2 = mMul(mTranslate(t.x, 0.72, rz), mScale(0.95, 0.5, 0.95));
      drawMesh(MESH.cyl, m2, I3, COL.wallDark, null, 0.3);
      const rotM = mRotY(t.yaw), r3 = rot3Of(rotM);
      const bm = mMul(mTranslate(t.x, 0.88, rz), mMul(rotM, mMul(mTranslate(0, 0, 0.62), mScale(0.21, 0.21, 1.35))));
      drawMesh(MESH.box, bm, r3, COL.silverDk, [0.05, 0.01, 0.01], 0.4);
    }

    // fuel silos
    for (const t of tanks) {
      if (t.dead) continue;
      const rz = t.z - sz;
      if (rz < -26 || rz > 112) continue;
      const m1 = mMul(mTranslate(t.x, 0.85, rz), mScale(1.7, 1.7, 1.7));
      drawMesh(MESH.cyl, m1, I3, COL.tank, null, 0.35);
      const m2 = mMul(mTranslate(t.x, 0.9, rz), mScale(1.78, 0.3, 1.78));
      drawMesh(MESH.cyl, m2, I3, [0.04, 0.1, 0.06], [0.45, 2.1, 0.85], 0.2);
      const m3 = mMul(mTranslate(t.x, 1.78, rz), mScale(1.1, 0.24, 1.1));
      drawMesh(MESH.cyl, m3, I3, COL.steel, null, 0.3);
    }

    // drones
    for (const d of drones) {
      if (d.dead) continue;
      const rz = d.z - sz;
      if (rz < -26 || rz > 112) continue;
      const rotM = mRotY(tGlobal * 2.4 + d.ph), r3 = rot3Of(rotM);
      const m = mMul(mTranslate(d.x, d.y, rz), mMul(rotM, mScale(1.15, 0.8, 1.15)));
      drawMesh(MESH.octa, m, r3, COL.drone, [0.5, 0.09, 0.44], 0.35);
      const mw = mMul(mTranslate(d.x, d.y, rz), mMul(rotM, mScale(2.1, 0.09, 0.32)));
      drawMesh(MESH.box, mw, r3, COL.wallDark, null, 0.3);
    }

    /* ---- ship ---- */
    if (state !== "dead" && !(state === "dying" && dieT > 0.08)) {
      const att = shipAttitude();
      const roll = att.roll, pitch = att.pitch;
      const shipRot = mMul(mRotZ(roll), mRotX(pitch));
      const shipM = mMul(mTranslate(sx, sy, 0), shipRot);
      const r3 = rot3Of(shipRot);
      function part(mesh, ox, oy, oz, sxx, syy, szz, color, emis, gloss, extraRot) {
        const local = extraRot ? mMul(extraRot, mScale(sxx, syy, szz)) : mScale(sxx, syy, szz);
        const m = mMul(shipM, mMul(mTranslate(ox, oy, oz), local));
        drawMesh(mesh, m, extraRot ? rot3Of(mMul(shipRot, extraRot)) : r3, color, emis, gloss);
      }
      part(MESH.box, 0, 0, -0.1, 0.9, 0.5, 2.6, COL.silver, null, 0.55);
      part(MESH.cone, 0, -0.02, 1.62, 0.74, 0.42, 1.15, COL.silverDk, null, 0.5, mRotX(Math.PI / 2));
      part(MESH.box, 0, 0.33, 0.42, 0.44, 0.3, 0.85, [0.1, 0.16, 0.22], COL.glassEm, 0.8);
      part(MESH.box, 0, -0.1, -0.52, 3.7, 0.1, 1.15, COL.silver, null, 0.45);
      part(MESH.box, -1.98, -0.06, -0.52, 0.5, 0.17, 0.95, COL.red, null, 0.4);
      part(MESH.box, 1.98, -0.06, -0.52, 0.5, 0.17, 0.95, COL.red, null, 0.4);
      part(MESH.box, 0, 0.56, -1.02, 0.09, 0.78, 0.72, COL.red, null, 0.35);
      part(MESH.cyl, -0.56, -0.06, -1.34, 0.36, 0.72, 0.36, COL.wallDark, null, 0.4, mRotX(Math.PI / 2));
      part(MESH.cyl, 0.56, -0.06, -1.34, 0.36, 0.72, 0.36, COL.wallDark, null, 0.4, mRotX(Math.PI / 2));
    }

    gl.disableVertexAttribArray(aS_pos);
    gl.disableVertexAttribArray(aS_nor);

    /* ---- additive sprites ---- */
    sprCount = 0;
    // stars + nebulas
    for (const nb of nebulas) {
      let zr = ((nb.z - sz) % STAR_WRAP + STAR_WRAP) % STAR_WRAP - 60;
      pushSprite([nb.x, nb.y, zr + 60], nb.s, nb.col[0], nb.col[1], nb.col[2], 0.17);
    }
    for (const st of stars) {
      let zr = ((st.z - sz) % STAR_WRAP + STAR_WRAP) % STAR_WRAP - 60;
      const tw = REDMO ? 0.8 : 0.55 + 0.45 * Math.sin(tGlobal * st.tw + st.ph);
      pushSprite([st.x, st.y, zr + 40], st.s, 0.8, 0.87, 1, 0.78 * tw);
    }
    // barrier beams: layered core + halo + crackle
    for (const bar of barriers) {
      const rz = bar.z - sz;
      if (rz < -26 || rz > 112) continue;
      const p = [0, bar.y, rz], L = CORR + 1.0;
      const flick = 0.82 + (REDMO ? 0.1 : Math.random() * 0.35);
      pushBeamQuad(p, [1, 0, 0], L, 0.09, 0.85, 1.5, 1.7, 0.9 * flick);
      pushBeamQuad(p, [1, 0, 0], L, 0.42, 0.2, 0.75, 1.0, 0.30 * flick);
      pushBeamQuad(p, [1, 0, 0], L, 1.1, 0.1, 0.4, 0.6, 0.12 * flick);
      const nCr = REDMO ? 2 : 5;
      for (let i = 0; i < nCr; i++) {
        const cx = rnd(-L, L), cy = rnd(-0.3, 0.3);
        pushSprite([cx, bar.y + cy, rz], rnd(0.15, 0.45), 0.7, 1.3, 1.6, rnd(0.2, 0.7));
      }
      pushSprite([-L, bar.y, rz], 0.7, 0.4, 1.2, 1.5, 0.5);
      pushSprite([L, bar.y, rz], 0.7, 0.4, 1.2, 1.5, 0.5);
    }
    // wall glow accents already emissive; add faint halos on door frames
    // player shots
    for (const s of shots) {
      const rz = s.z - sz;
      pushBeamQuad([s.x, s.y, rz], [0, 0, 1], 1.1, 0.075, 1.6, 1.15, 0.45, 0.95);
      pushBeamQuad([s.x, s.y, rz], [0, 0, 1], 1.4, 0.3, 1.2, 0.8, 0.25, 0.3);
    }
    // enemy orbs
    for (const o of orbs) {
      const rz = o.z - sz;
      const pulse = 0.8 + 0.2 * Math.sin(tGlobal * 9 + o.x);
      pushSprite([o.x, o.y, rz], 0.28, 1.7, 0.5, 1.3, 0.95 * pulse);
      pushSprite([o.x, o.y, rz], 0.75, 1.0, 0.2, 0.9, 0.3 * pulse);
    }
    // turret eye glows
    for (const t of turrets) {
      if (t.dead) continue;
      const rz = t.z - sz;
      if (rz < -26 || rz > 100) continue;
      const pulse = 0.6 + 0.4 * Math.sin(tGlobal * 3.2 + t.x * 2.1);
      pushSprite([t.x + Math.sin(t.yaw) * 1.1, 0.87, rz + Math.cos(t.yaw) * 1.1], 0.22, 1.5, 0.25, 0.2, 0.8 * pulse);
    }
    // silo halos
    for (const t of tanks) {
      if (t.dead) continue;
      const rz = t.z - sz;
      if (rz < -26 || rz > 100) continue;
      const pulse = 0.7 + 0.3 * Math.sin(tGlobal * 2.4 + t.z * 0.3);
      pushSprite([t.x, 0.95, rz], 1.5, 0.2, 0.9, 0.4, 0.5 * pulse);
    }
    // drone cores
    for (const d of drones) {
      if (d.dead) continue;
      const rz = d.z - sz;
      pushSprite([d.x, d.y, rz], 0.5, 1.4, 0.35, 1.1, 0.55);
    }
    // ship engine exhaust
    if ((state === "playing" || state === "menu" || state === "flameout") && !(state === "dying")) {
      const flick = REDMO ? 1 : rnd(0.75, 1.25);
      const eLen = (0.55 + speed * 0.022) * flick;
      const roll = shipAttitude().roll;
      for (const side of [-0.56, 0.56]) {
        const ex = sx + side * Math.cos(roll), ey = sy - 0.06 + side * Math.sin(roll);
        pushBeamQuad([ex, ey, -1.75 - eLen / 2], [0, 0, 1], eLen, 0.13, 0.5, 1.1, 1.7, 0.75);
        pushSprite([ex, ey, -1.7], 0.3, 0.45, 0.95, 1.5, 0.6);
      }
    }
    // muzzle flashes ride on recent shots implicitly; sparks:
    for (const s of sparks) {
      const rz = s.z - sz;
      const a = clamp(s.life / (s.flash ? s.life0 : 0.85), 0, 1);
      pushSprite([s.x, s.y, rz], s.size * (s.flash ? (1.6 - a * 0.6) : 1), s.r * 1.4, s.g * 1.4, s.b * 1.2, a * (s.flash ? 0.85 : 0.9));
    }

    if (sprCount > 0) {
      gl.useProgram(spriteProg);
      gl.uniformMatrix4fv(uP.proj, false, proj);
      gl.uniformMatrix4fv(uP.view, false, view);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE); // sprite shader outputs premultiplied color
      gl.depthMask(false);
      gl.bindBuffer(gl.ARRAY_BUFFER, sprVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, sprData.subarray(0, sprCount * 10));
      gl.enableVertexAttribArray(aP_pos);
      gl.enableVertexAttribArray(aP_col);
      gl.enableVertexAttribArray(aP_cor);
      gl.vertexAttribPointer(aP_pos, 3, gl.FLOAT, false, 40, 0);
      gl.vertexAttribPointer(aP_col, 4, gl.FLOAT, false, 40, 12);
      gl.vertexAttribPointer(aP_cor, 3, gl.FLOAT, false, 40, 28);
      gl.drawArrays(gl.TRIANGLES, 0, sprCount);
      gl.disableVertexAttribArray(aP_pos);
      gl.disableVertexAttribArray(aP_col);
      gl.disableVertexAttribArray(aP_cor);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
  }

  /* ============================ resize + loop ============================ */
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(window.innerWidth * dpr), h = Math.floor(window.innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }
  window.addEventListener("resize", resize);
  resize();

  let last = performance.now();
  function frame(now) {
    const dt = clamp((now - last) / 1000, 0, 0.05);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }
  pump();
  requestAnimationFrame(frame);
})();
