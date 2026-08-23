/* Jenga — pull a block, then put it back on top.
 *
 * Physics is cannon-es (vendored in lib/, MIT), which is the repo's ONE runtime
 * dependency and exists only because a stack this deep needs a real solver. See
 * .ai/memory/DECISIONS.md, 2026-08-22.
 *
 * ⚠ The single hardest-won lesson here is SCALE. Everything is in SI units:
 * metres and g = -9.82. An earlier build used 3-unit blocks with gravity -250,
 * which is roughly 25x off, and NO solver survives that — a hand-written one and
 * cannon-es both collapsed identically until the units were fixed.
 *
 * Rendering is raw WebGL, hand-written, like every other toy here.
 */
import * as CANNON from "./lib/cannon-es.js";

// ---------------------------------------------------------------- constants

const BL = 0.75, BW = 0.25, BH = 0.15;      // block: 3 : 1 : 0.6, real Jenga proportions
const LEVELS = 12;                           // shortened from 18 so the tower is genuinely solid
const JITTER = 0.004;                        // a hand-built tower is never perfect
const PULL_CLEAR = BL * 0.92;                // slid this far along its axis = extracted

// ---------------------------------------------------------------- maths

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

function mIdent() { return [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; }
function mMul(a, b) {
  const o = new Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    o[i * 4 + j] = a[j] * b[i * 4] + a[4 + j] * b[i * 4 + 1] + a[8 + j] * b[i * 4 + 2] + a[12 + j] * b[i * 4 + 3];
  }
  return o;
}
function mTranslate(x, y, z) { const m = mIdent(); m[12] = x; m[13] = y; m[14] = z; return m; }
function mScale(x, y, z) { const m = mIdent(); m[0] = x; m[5] = y; m[10] = z; return m; }
function mFromQuat(q) {
  const { x, y, z, w } = q;
  const m = mIdent();
  m[0] = 1 - 2 * (y * y + z * z); m[1] = 2 * (x * y + z * w);     m[2] = 2 * (x * z - y * w);
  m[4] = 2 * (x * y - z * w);     m[5] = 1 - 2 * (x * x + z * z); m[6] = 2 * (y * z + x * w);
  m[8] = 2 * (x * z + y * w);     m[9] = 2 * (y * z - x * w);     m[10] = 1 - 2 * (x * x + y * y);
  return m;
}
function mPerspective(fovy, asp, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return [f / asp,0,0,0, 0,f,0,0, 0,0,(far + near) * nf,-1, 0,0,2 * far * near * nf,0];
}
function sub3(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function cross3(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function dot3(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
function norm3(a) { const l = Math.hypot(a[0],a[1],a[2]) || 1; return [a[0]/l, a[1]/l, a[2]/l]; }
function mLookAt(eye, at, up) {
  const z = norm3(sub3(eye, at)), x = norm3(cross3(up, z)), y = cross3(z, x);
  return [x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0,
          -dot3(x,eye), -dot3(y,eye), -dot3(z,eye), 1];
}
function mShadow(d) {
  const m = mIdent();
  m[4] = -d[0] / d[1]; m[5] = 0; m[6] = -d[2] / d[1];
  return m;
}

// ---------------------------------------------------------------- world

let world, ground, woodMat, slickMat;
let blocks = [];          // { body, lv, slot, hue, placed }
let held = null;          // the extracted block waiting to be placed
let pulling = null;       // block currently being slid out

const G = {
  mode: "intro",          // intro | play | placing | over
  moved: 0,
  best: 0,
  level: LEVELS,          // current top level index (0-based count of full levels)
  topCount: 0,            // blocks on the current top level (0..3)
  msg: "", msgT: 0,
  shake: 0
};
try { G.best = parseInt(localStorage.getItem("jenga_best") || "0", 10) || 0; } catch (e) {}

function rndSeeded(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff - 0.5; };
}

function buildWorld() {
  world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;
  /* 40 iterations and a sleep limit of 0.12 is what makes all 36 blocks settle
   * and SLEEP; at 20 they creep forever and the tower never truly rests. */
  world.solver.iterations = 40;
  world.solver.tolerance = 0.0005;

  woodMat = new CANNON.Material("wood");
  world.addContactMaterial(new CANNON.ContactMaterial(woodMat, woodMat, {
    friction: 0.6, restitution: 0,
    contactEquationStiffness: 1e7, contactEquationRelaxation: 3,
    frictionEquationStiffness: 1e7, frictionEquationRelaxation: 3
  }));
  /* The block being eased out gets a near-frictionless material for as long as
   * it is moving. Lowering friction GLOBALLY does nothing — the friction that
   * drags the level above and the friction that resists it scale together and
   * cancel, which is why the whole upper stack rode along at every value from
   * 0.15 to 0.6. Making only the puller slippery breaks that symmetry: the
   * stationary blocks keep their grip while the one in your fingers slides. */
  slickMat = new CANNON.Material("slick");
  world.addContactMaterial(new CANNON.ContactMaterial(slickMat, woodMat, {
    friction: 0.02, restitution: 0,
    contactEquationStiffness: 1e7, contactEquationRelaxation: 3,
    frictionEquationStiffness: 1e7, frictionEquationRelaxation: 3
  }));

  ground = new CANNON.Body({
    mass: 0, shape: new CANNON.Plane(), material: woodMat,
    quaternion: new CANNON.Quaternion().setFromEuler(-Math.PI / 2, 0, 0)
  });
  world.addBody(ground);

  blocks = [];
  const rnd = rndSeeded(Date.now() & 0xffff);
  for (let lv = 0; lv < LEVELS; lv++) {
    const y = BH / 2 + lv * BH;
    const rot = lv % 2 === 1;
    for (let k = -1; k <= 1; k++) {
      const jx = rnd() * JITTER, jz = rnd() * JITTER, jr = rnd() * JITTER * 0.5;
      const pos = rot
        ? new CANNON.Vec3(k * BW + jx, y, jz)
        : new CANNON.Vec3(jx, y, k * BW + jz);
      addBlock(pos, (rot ? Math.PI / 2 : 0) + jr, lv, k);
    }
  }
  G.level = LEVELS;
  G.topCount = 3;
  G.moved = 0;
}

function addBlock(pos, yaw, lv, slot) {
  const body = new CANNON.Body({
    mass: 0.25, material: woodMat,
    shape: new CANNON.Box(new CANNON.Vec3(BL / 2, BH / 2, BW / 2)),
    position: pos,
    quaternion: new CANNON.Quaternion().setFromEuler(0, yaw, 0),
    sleepSpeedLimit: 0.12, sleepTimeLimit: 0.3
  });
  world.addBody(body);
  const b = { body, lv, slot, hue: 28 + ((lv * 7 + (slot + 1) * 3) % 14), placed: false };
  blocks.push(b);
  return b;
}

// the highest level that still has all three blocks; you may only pull below it
function highestCompleteLevel() {
  const counts = {};
  blocks.forEach(b => { if (b.body !== held?.body) counts[b.lv] = (counts[b.lv] || 0) + 1; });
  let top = -1;
  for (const k in counts) if (counts[k] === 3 && +k > top) top = +k;
  return top;
}

function canPull(b) {
  if (held) return false;
  return b.lv < highestCompleteLevel();
}

// ---------------------------------------------------------------- rendering

const cv = document.getElementById("canvas");
const gl = cv.getContext("webgl", { antialias: true, alpha: false });
if (!gl) {
  document.getElementById("overlay").innerHTML =
    '<div class="panel"><h1 class="panel__title">Jenga</h1>' +
    '<p class="panel__text">This toy needs WebGL, which your browser has turned off.</p></div>';
  throw new Error("no webgl");
}

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function program(vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

const BLOCK_VS = `
attribute vec3 aPos; attribute vec3 aNor;
uniform mat4 uMVP, uModel; uniform mat3 uNrm;
varying vec3 vN; varying vec3 vW; varying vec3 vL;
void main(){
  vec4 w = uModel * vec4(aPos,1.0);
  vW = w.xyz; vN = normalize(uNrm * aNor); vL = aPos;
  gl_Position = uMVP * vec4(aPos,1.0);
}`;

const BLOCK_FS = `
precision mediump float;
varying vec3 vN; varying vec3 vW; varying vec3 vL;
uniform vec3 uCol; uniform vec3 uEye; uniform float uHi; uniform float uGhost;
void main(){
  vec3 N = normalize(vN);
  vec3 L = normalize(vec3(-0.45, 0.82, 0.36));
  float d = max(dot(N,L), 0.0);
  vec3 V = normalize(uEye - vW);
  vec3 H = normalize(L + V);
  float sp = pow(max(dot(N,H),0.0), 30.0) * 0.25;
  // grain: fine stripes along the block's long axis, plus a little end-grain
  float grain = sin(vL.z * 210.0 + sin(vL.x * 31.0) * 2.2) * 0.5 + 0.5;
  float g2 = sin(vL.z * 47.0) * 0.5 + 0.5;
  vec3 base = uCol * (0.86 + grain * 0.14) * (0.93 + g2 * 0.07);
  float fill = 0.34 + 0.2 * max(dot(N, vec3(0.0,1.0,0.0)), 0.0);
  vec3 c = base * (0.30 + d * 0.78 + fill);
  c += vec3(1.0, 0.95, 0.86) * sp;
  c = mix(c, vec3(1.0, 0.86, 0.45), uHi * 0.45);
  if (uGhost > 0.5) {
    gl_FragColor = vec4(mix(c, vec3(1.0, 0.85, 0.4), 0.6), 0.32);
  } else {
    gl_FragColor = vec4(c, 1.0);
  }
}`;

const FLAT_VS = `
attribute vec3 aPos; uniform mat4 uMVP; varying vec3 vP;
void main(){ vP = aPos; gl_Position = uMVP * vec4(aPos,1.0); }`;
const SHADOW_FS = `
precision mediump float; uniform float uA;
void main(){ gl_FragColor = vec4(0.02,0.015,0.01,uA); }`;
const TABLE_FS = `
precision mediump float; varying vec3 vP;
void main(){
  float r = length(vP.xz);
  float pool = 1.0 - smoothstep(0.4, 4.0, r);
  vec3 felt = mix(vec3(0.055,0.045,0.038), vec3(0.16,0.12,0.09), pool);
  float rings = sin(r * 26.0) * 0.5 + 0.5;
  felt += vec3(0.02,0.014,0.008) * rings * pool;
  float vig = 1.0 - smoothstep(1.5, 6.5, r);
  gl_FragColor = vec4(felt * (0.25 + 0.75 * vig), 1.0);
}`;

const progBlock = program(BLOCK_VS, BLOCK_FS);
const progFlat = program(FLAT_VS, SHADOW_FS);
const progTable = program(FLAT_VS, TABLE_FS);

const uB = {
  mvp: gl.getUniformLocation(progBlock, "uMVP"),
  model: gl.getUniformLocation(progBlock, "uModel"),
  nrm: gl.getUniformLocation(progBlock, "uNrm"),
  col: gl.getUniformLocation(progBlock, "uCol"),
  eye: gl.getUniformLocation(progBlock, "uEye"),
  hi: gl.getUniformLocation(progBlock, "uHi"),
  ghost: gl.getUniformLocation(progBlock, "uGhost"),
  aPos: gl.getAttribLocation(progBlock, "aPos"),
  aNor: gl.getAttribLocation(progBlock, "aNor")
};
const uF = {
  mvp: gl.getUniformLocation(progFlat, "uMVP"),
  a: gl.getUniformLocation(progFlat, "uA"),
  aPos: gl.getAttribLocation(progFlat, "aPos")
};
const uT = {
  mvp: gl.getUniformLocation(progTable, "uMVP"),
  aPos: gl.getAttribLocation(progTable, "aPos")
};

function cubeData() {
  const p = [], n = [];
  const faces = [
    [[ 1,0,0], [[ .5,-.5,-.5],[ .5, .5,-.5],[ .5, .5, .5],[ .5,-.5, .5]]],
    [[-1,0,0], [[-.5,-.5, .5],[-.5, .5, .5],[-.5, .5,-.5],[-.5,-.5,-.5]]],
    [[0, 1,0], [[-.5, .5,-.5],[-.5, .5, .5],[ .5, .5, .5],[ .5, .5,-.5]]],
    [[0,-1,0], [[-.5,-.5, .5],[-.5,-.5,-.5],[ .5,-.5,-.5],[ .5,-.5, .5]]],
    [[0,0, 1], [[-.5,-.5, .5],[ .5,-.5, .5],[ .5, .5, .5],[-.5, .5, .5]]],
    [[0,0,-1], [[ .5,-.5,-.5],[-.5,-.5,-.5],[-.5, .5,-.5],[ .5, .5,-.5]]]
  ];
  faces.forEach(f => {
    const nn = f[0], q = f[1], tri = [0,1,2, 0,2,3];
    tri.forEach(i => { p.push(q[i][0], q[i][1], q[i][2]); n.push(nn[0], nn[1], nn[2]); });
  });
  return { pos: new Float32Array(p), nor: new Float32Array(n), count: p.length / 3 };
}
const cube = cubeData();
const bufP = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, bufP); gl.bufferData(gl.ARRAY_BUFFER, cube.pos, gl.STATIC_DRAW);
const bufN = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, bufN); gl.bufferData(gl.ARRAY_BUFFER, cube.nor, gl.STATIC_DRAW);

// table plane, wound so its normal points UP (a -y normal gets culled away)
const T = 9;
const tableQuad = new Float32Array([
  -T,0,-T,  T,0,T,  T,0,-T,
  -T,0,-T, -T,0,T,  T,0,T
]);
const bufTable = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, bufTable); gl.bufferData(gl.ARRAY_BUFFER, tableQuad, gl.STATIC_DRAW);

// ---------------------------------------------------------------- camera

const cam = { az: 0.7, el: 0.42, dist: 3.4, tgt: LEVELS * BH * 0.45,
              caz: 0.7, cel: 0.42, cdist: 3.4, ctgt: LEVELS * BH * 0.45 };
let W = 0, H = 0, DPR = 1;

function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = Math.floor(W * DPR); cv.height = Math.floor(H * DPR);
  cv.style.width = W + "px"; cv.style.height = H + "px";
  gl.viewport(0, 0, cv.width, cv.height);
}

function eyePos() {
  const ce = Math.cos(cam.cel), se = Math.sin(cam.cel);
  return [Math.sin(cam.caz) * ce * cam.cdist, cam.ctgt + se * cam.cdist, Math.cos(cam.caz) * ce * cam.cdist];
}
function viewProj() {
  const asp = cv.width / cv.height;
  const eye = eyePos();
  const at = [0, cam.ctgt, 0];
  return { vp: mMul(mPerspective(46 * Math.PI / 180, asp, 0.05, 60), mLookAt(eye, at, [0,1,0])), eye, at };
}

// screen -> world ray
function screenRay(sx, sy) {
  const asp = cv.width / cv.height;
  const fov = 46 * Math.PI / 180;
  const ndcX = (sx / W) * 2 - 1, ndcY = 1 - (sy / H) * 2;
  const tanF = Math.tan(fov / 2);
  const eye = eyePos();
  const at = [0, cam.ctgt, 0];
  const f = norm3(sub3(at, eye));
  const r = norm3(cross3(f, [0,1,0]));
  const u = cross3(r, f);
  const dir = norm3([
    f[0] + r[0]*ndcX*tanF*asp + u[0]*ndcY*tanF,
    f[1] + r[1]*ndcX*tanF*asp + u[1]*ndcY*tanF,
    f[2] + r[2]*ndcX*tanF*asp + u[2]*ndcY*tanF
  ]);
  return { o: eye, d: dir };
}

// ray vs an oriented block
function rayBlock(ray, b) {
  const q = b.body.quaternion;
  const inv = new CANNON.Quaternion(-q.x, -q.y, -q.z, q.w);
  const rel = new CANNON.Vec3(ray.o[0] - b.body.position.x, ray.o[1] - b.body.position.y, ray.o[2] - b.body.position.z);
  const lo = inv.vmult(rel);
  const ld = inv.vmult(new CANNON.Vec3(ray.d[0], ray.d[1], ray.d[2]));
  const he = [BL/2, BH/2, BW/2];
  const o = [lo.x, lo.y, lo.z], d = [ld.x, ld.y, ld.z];
  let tmin = -Infinity, tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-8) { if (Math.abs(o[i]) > he[i]) return -1; }
    else {
      let t1 = (-he[i] - o[i]) / d[i], t2 = (he[i] - o[i]) / d[i];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  return tmin >= 0 ? tmin : (tmax >= 0 ? tmax : -1);
}

function pickBlock(sx, sy) {
  const ray = screenRay(sx, sy);
  let best = null, bt = Infinity;
  for (const b of blocks) {
    if (held && b === held) continue;
    const t = rayBlock(ray, b);
    if (t >= 0 && t < bt) { bt = t; best = b; }
  }
  return best;
}

// ---------------------------------------------------------------- draw

function blockModel(b, popScale) {
  const p = b.body.position, q = b.body.quaternion;
  let m = mMul(mTranslate(p.x, p.y, p.z), mFromQuat(q));
  m = mMul(m, mScale(BL, BH * (popScale || 1), BW));
  return m;
}

function drawBlocks(vp, eye) {
  gl.useProgram(progBlock);
  gl.uniform3fv(uB.eye, new Float32Array(eye));
  gl.enableVertexAttribArray(uB.aPos);
  gl.bindBuffer(gl.ARRAY_BUFFER, bufP);
  gl.vertexAttribPointer(uB.aPos, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(uB.aNor);
  gl.bindBuffer(gl.ARRAY_BUFFER, bufN);
  gl.vertexAttribPointer(uB.aNor, 3, gl.FLOAT, false, 0, 0);
  gl.uniform1f(uB.ghost, 0);

  for (const b of blocks) {
    const model = blockModel(b);
    gl.uniformMatrix4fv(uB.mvp, false, new Float32Array(mMul(vp, model)));
    gl.uniformMatrix4fv(uB.model, false, new Float32Array(model));
    gl.uniformMatrix3fv(uB.nrm, false, new Float32Array([
      model[0], model[1], model[2], model[4], model[5], model[6], model[8], model[9], model[10]
    ]));
    const hot = b === hover ? 1 : (b === pulling ? 1 : 0);
    const c = woodColour(b.hue, b.placed);
    gl.uniform3fv(uB.col, new Float32Array(c));
    gl.uniform1f(uB.hi, hot);
    gl.drawArrays(gl.TRIANGLES, 0, cube.count);
  }
}

function woodColour(hue, placed) {
  // warm timber, a touch cooler for blocks you have already re-placed
  const h = (hue + (placed ? 6 : 0)) / 360;
  const s = placed ? 0.42 : 0.5, l = placed ? 0.60 : 0.55;
  const f = n => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(Math.min(k - 3, 9 - k), 1));
  };
  return [f(0), f(8), f(4)];
}

function drawShadows(vp) {
  const L = norm3([-0.45, 0.82, 0.36]);
  const S = mShadow([-L[0], -L[1], -L[2]]);
  gl.useProgram(progFlat);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  gl.enableVertexAttribArray(uF.aPos);
  gl.bindBuffer(gl.ARRAY_BUFFER, bufP);
  gl.vertexAttribPointer(uF.aPos, 3, gl.FLOAT, false, 0, 0);
  gl.uniform1f(uF.a, 0.34);
  for (const b of blocks) {
    const m = mMul(mMul(mTranslate(0, 0.0015, 0), S), blockModel(b));
    gl.uniformMatrix4fv(uF.mvp, false, new Float32Array(mMul(vp, m)));
    gl.drawArrays(gl.TRIANGLES, 0, cube.count);
  }
  gl.depthMask(true);
  gl.disable(gl.BLEND);
}

function drawTable(vp) {
  gl.useProgram(progTable);
  gl.enableVertexAttribArray(uT.aPos);
  gl.bindBuffer(gl.ARRAY_BUFFER, bufTable);
  gl.vertexAttribPointer(uT.aPos, 3, gl.FLOAT, false, 0, 0);
  gl.uniformMatrix4fv(uT.mvp, false, new Float32Array(vp));
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function drawGhosts(vp, eye) {
  if (!held) return;
  const slots = freeTopSlots();
  if (!slots.length) return;
  gl.useProgram(progBlock);
  gl.uniform3fv(uB.eye, new Float32Array(eye));
  gl.uniform1f(uB.ghost, 1);
  gl.uniform1f(uB.hi, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  gl.enableVertexAttribArray(uB.aPos);
  gl.bindBuffer(gl.ARRAY_BUFFER, bufP);
  gl.vertexAttribPointer(uB.aPos, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(uB.aNor);
  gl.bindBuffer(gl.ARRAY_BUFFER, bufN);
  gl.vertexAttribPointer(uB.aNor, 3, gl.FLOAT, false, 0, 0);
  for (const s of slots) {
    let m = mMul(mTranslate(s.x, s.y, s.z), mFromQuat(new CANNON.Quaternion().setFromEuler(0, s.yaw, 0)));
    m = mMul(m, mScale(BL, BH, BW));
    gl.uniformMatrix4fv(uB.mvp, false, new Float32Array(mMul(vp, m)));
    gl.uniformMatrix4fv(uB.model, false, new Float32Array(m));
    gl.uniformMatrix3fv(uB.nrm, false, new Float32Array([m[0],m[1],m[2], m[4],m[5],m[6], m[8],m[9],m[10]]));
    gl.uniform3fv(uB.col, new Float32Array([1, 0.85, 0.45]));
    gl.drawArrays(gl.TRIANGLES, 0, cube.count);
  }
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.uniform1f(uB.ghost, 0);
}

/* Where the held block may go. Strict rules: the top level must be filled to
 * three before a new one is started, so the free slots are always on the
 * current top level unless it is already complete. */
function freeTopSlots() {
  const counts = {};
  blocks.forEach(b => { if (b !== held) counts[b.lv] = (counts[b.lv] || 0) + 1; });
  let lv = G.level;
  if ((counts[lv] || 0) >= 3) lv = lv + 1;
  const taken = new Set(blocks.filter(b => b !== held && b.lv === lv).map(b => b.slot));
  const rot = lv % 2 === 1;
  const y = BH / 2 + lv * BH;
  const out = [];
  for (let k = -1; k <= 1; k++) {
    if (taken.has(k)) continue;
    out.push({
      x: rot ? k * BW : 0, y, z: rot ? 0 : k * BW,
      yaw: rot ? Math.PI / 2 : 0, lv, slot: k
    });
  }
  return out;
}

// ---------------------------------------------------------------- input

let hover = null;
let drag = null;   // { mode: 'orbit'|'pull', ... }
const pointers = new Map();

function localXY(e) {
  const r = cv.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

cv.addEventListener("pointerdown", e => {
  e.preventDefault();
  Audio2.init();
  if (G.mode === "intro" || G.mode === "over") return;
  const xy = localXY(e);
  pointers.set(e.pointerId, xy);
  cv.setPointerCapture(e.pointerId);

  if (pointers.size === 2) { drag = { mode: "pinch", d0: pinchDist(), z0: cam.dist }; return; }

  if (held) {
    // placing: pick the nearest ghost slot to the tap
    const s = nearestSlot(xy.x, xy.y);
    if (s) { placeHeld(s); return; }
    drag = { mode: "orbit", x: xy.x, y: xy.y, az: cam.az, el: cam.el };
    return;
  }

  const b = pickBlock(xy.x, xy.y);
  if (b && canPull(b)) {
    drag = { mode: "pull", block: b, x: xy.x, y: xy.y, out: 0 };
    startPull(b);
  } else if (b) {
    say("that one is holding the top up", 1200);
    drag = { mode: "orbit", x: xy.x, y: xy.y, az: cam.az, el: cam.el };
  } else {
    drag = { mode: "orbit", x: xy.x, y: xy.y, az: cam.az, el: cam.el };
  }
}, { passive: false });

function pinchDist() {
  const p = [...pointers.values()];
  return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
}

cv.addEventListener("pointermove", e => {
  const xy = localXY(e);
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, xy);

  if (!drag) {
    hover = (G.mode === "play" && !held) ? pickBlock(xy.x, xy.y) : null;
    return;
  }
  if (drag.mode === "pinch" && pointers.size === 2) {
    const d = pinchDist();
    cam.dist = clamp(drag.z0 * (drag.d0 / Math.max(1, d)), 1.4, 7);
    return;
  }
  if (drag.mode === "orbit") {
    cam.az = drag.az - (xy.x - drag.x) * 0.008;
    cam.el = clamp(drag.el + (xy.y - drag.y) * 0.006, -0.15, 1.25);
    return;
  }
  if (drag.mode === "pull") {
    // slide along the block's own long axis, driven by how far the pointer
    // has moved projected onto that axis on screen
    const b = drag.block;
    const axis = longAxisScreen(b);
    const dx = xy.x - drag.x, dy = xy.y - drag.y;
    const along = (dx * axis.x + dy * axis.y) / Math.max(1, axis.len);
    drag.out = clamp(drag.out + along * 0.0016, 0, BL * 1.4);
    drag.x = xy.x; drag.y = xy.y;
    slidePull(b, drag.out);
  }
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (!drag) return;
  if (drag.mode === "pull") {
    const b = drag.block;
    if (drag.out >= PULL_CLEAR) extract(b);
    else releasePull(b);
  }
  if (pointers.size < 2) drag = null;
}
cv.addEventListener("pointerup", endPointer);
cv.addEventListener("pointercancel", endPointer);

cv.addEventListener("wheel", e => {
  e.preventDefault();
  cam.dist = clamp(cam.dist * (1 + Math.sign(e.deltaY) * 0.09), 1.4, 7);
}, { passive: false });

function longAxisScreen(b) {
  // the block's +x axis (its length) projected to screen space
  const q = b.body.quaternion;
  const ax = q.vmult(new CANNON.Vec3(1, 0, 0));
  const p = b.body.position;
  const a = project([p.x, p.y, p.z]);
  const c = project([p.x + ax.x * 0.1, p.y + ax.y * 0.1, p.z + ax.z * 0.1]);
  const dx = c[0] - a[0], dy = c[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len, len: 1 };
}

function project(p) {
  const { vp } = viewProj();
  const x = vp[0]*p[0] + vp[4]*p[1] + vp[8]*p[2] + vp[12];
  const y = vp[1]*p[0] + vp[5]*p[1] + vp[9]*p[2] + vp[13];
  const w = vp[3]*p[0] + vp[7]*p[1] + vp[11]*p[2] + vp[15];
  return [(x / w * 0.5 + 0.5) * W, (1 - (y / w * 0.5 + 0.5)) * H];
}

function nearestSlot(sx, sy) {
  const slots = freeTopSlots();
  let best = null, bd = 90;
  for (const s of slots) {
    const p = project([s.x, s.y, s.z]);
    const d = Math.hypot(p[0] - sx, p[1] - sy);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

// ---------------------------------------------------------------- actions

let pullRest = null;

/* The height to set a block down at, measured UNDER ITS OWN FOOTPRINT.
 * Using the global tower top put a block a full level too high whenever the
 * tallest block happened to be at a different slot — it then dropped, missed,
 * and fell to the table. Support is local, so the measurement has to be too. */
function restHeightAt(slot) {
  const halfL = BL / 2, halfW = BW / 2;
  const sRot = slot.yaw !== 0;
  const sx = sRot ? halfW : halfL;          // slot footprint half-extents
  const sz = sRot ? halfL : halfW;
  let top = 0;                               // the table
  for (const b of blocks) {
    if (b === held) continue;
    const q = b.body.quaternion;
    // blocks only ever sit at yaw 0 or 90, so a world-axis footprint is exact
    const ax = q.vmult(new CANNON.Vec3(1, 0, 0));
    const along = Math.abs(ax.x) > Math.abs(ax.z);
    const bx = along ? halfL : halfW;
    const bz = along ? halfW : halfL;
    const p = b.body.position;
    if (Math.abs(p.x - slot.x) >= sx + bx - 0.01) continue;
    if (Math.abs(p.z - slot.z) >= sz + bz - 0.01) continue;
    const surface = p.y + BH / 2;
    if (surface > top) top = surface;
  }
  return top + BH / 2;
}

// hold the block in front of the tower, clear of every block in it
function parkHeld(b) {
  const r = 1.05;                       // tower half-diagonal is about 0.4
  b.body.position.set(Math.sin(cam.caz) * r, cam.ctgt + 0.16, Math.cos(cam.caz) * r);
  b.body.velocity.setZero();
  b.body.angularVelocity.setZero();
}

function startPull(b) {
  pulling = b;
  pullRest = {
    p: b.body.position.clone(),
    q: b.body.quaternion.clone()
  };
  b.body.type = CANNON.Body.KINEMATIC;
  b.body.mass = 0;
  b.body.updateMassProperties();
  b.body.material = slickMat;
  b.body.velocity.setZero();
  b.body.angularVelocity.setZero();
  b.body.wakeUp();
  blocks.forEach(x => x.body.wakeUp());
  Audio2.slide();
}

/* Drive the sliding block by VELOCITY, never by teleporting it.
 * A kinematic body whose position is set directly has zero velocity as far as
 * the solver is concerned, so each step it appears to have materialised inside
 * its neighbours and the penetration is resolved as a shove — which walked the
 * whole tower sideways and dropped it 8cm during a single pull. */
function slidePull(b, out) {
  const ax = pullRest.q.vmult(new CANNON.Vec3(1, 0, 0));
  const tx = pullRest.p.x + ax.x * out;
  const ty = pullRest.p.y + ax.y * out;
  const tz = pullRest.p.z + ax.z * out;
  const inv = 1 / STEP;
  let vx = (tx - b.body.position.x) * inv;
  let vy = (ty - b.body.position.y) * inv;
  let vz = (tz - b.body.position.z) * inv;
  // a slow hand is the point of the game; cap it so a flung drag cannot punch
  const sp = Math.hypot(vx, vy, vz), MAXV = 0.32;
  if (sp > MAXV) { const f = MAXV / sp; vx *= f; vy *= f; vz *= f; }
  b.body.velocity.set(vx, vy, vz);
  b.body.angularVelocity.setZero();
  b.body.wakeUp();
  wakeNear(b);
}

// waking all 36 every frame keeps the tower permanently simulated; only the
// blocks that could actually be touched need to be awake
function wakeNear(b) {
  const p = b.body.position;
  for (const o of blocks) {
    if (o === b) continue;
    const q = o.body.position;
    if (Math.abs(q.y - p.y) < BH * 2.5 &&
        Math.abs(q.x - p.x) < BL && Math.abs(q.z - p.z) < BL) o.body.wakeUp();
  }
}

function releasePull(b) {
  // not far enough out: let it go back to being part of the tower
  b.body.velocity.setZero();
  b.body.angularVelocity.setZero();
  b.body.material = woodMat;
  b.body.type = CANNON.Body.DYNAMIC;
  b.body.mass = 0.25;
  b.body.updateMassProperties();
  b.body.wakeUp();
  pulling = null; pullRest = null;
}

function extract(b) {
  held = b;
  pulling = null; pullRest = null;
  b.body.type = CANNON.Body.KINEMATIC;
  b.body.mass = 0;
  b.body.updateMassProperties();
  /* ⚠ A held block was parked at (0, camTarget+0.55, 0) — which is INSIDE the
   * tower, around level 8 — as a kinematic, infinite-mass body. It shoved the
   * stack apart for as long as you took to choose a slot, which is what made
   * placement look random. It now sits in front of the tower and, belt and
   * braces, stops colliding entirely while in hand. */
  b.body.collisionResponse = false;
  b.body.velocity.setZero();
  parkHeld(b);
  G.mode = "placing";
  say("now put it on top", 1600);
  Audio2.lift();
  updateHud();
}

function placeHeld(slot) {
  const b = held;
  // measure the tower while `held` still excludes this block: clearing it first
  // let the block being placed pollute the height it was being measured against
  const restY = restHeightAt(slot);
  held = null;
  b.lv = slot.lv; b.slot = slot.slot; b.placed = true;
  b.body.collisionResponse = true;
  b.body.material = woodMat;
  b.body.type = CANNON.Body.DYNAMIC;
  b.body.mass = 0.25;
  b.body.updateMassProperties();
  /* Set it down at the real rest height rather than dropping it from the
   * idealised slot height. Dropping even 3cm let it build up enough speed to
   * push into the top level and settle a whole level low — and physically you
   * PLACE a Jenga block, you do not drop it. */
  b.body.position.set(slot.x, restY + 0.002, slot.z);
  b.body.quaternion.setFromEuler(0, slot.yaw, 0);
  b.body.velocity.setZero();
  b.body.angularVelocity.setZero();
  b.body.wakeUp();
  blocks.forEach(x => x.body.wakeUp());
  if (slot.lv >= G.level) G.level = slot.lv;
  G.moved++;
  if (G.moved > G.best) {
    G.best = G.moved;
    try { localStorage.setItem("jenga_best", String(G.best)); } catch (e) {}
  }
  G.mode = "play";
  Audio2.place();
  say(G.moved + (G.moved === 1 ? " block moved" : " blocks moved"), 1000);
  updateHud();
}

// ---------------------------------------------------------------- collapse

let baseTop = 0;
function towerTop() {
  let t = 0;
  for (const b of blocks) if (b !== held && b.body.position.y > t) t = b.body.position.y;
  return t;
}
function checkCollapse() {
  if (G.mode === "over") return;
  let fell = 0;
  for (const b of blocks) {
    if (b === held) continue;
    if (b.body.position.y < BH * 0.75 && b.lv > 1) fell++;
    if (Math.abs(b.body.position.x) > 1.2 || Math.abs(b.body.position.z) > 1.2) fell++;
  }
  if (fell >= 3) gameOver();
}
function gameOver() {
  G.mode = "over";
  G.shake = 1;
  Audio2.crash();
  showOver();
}

// ---------------------------------------------------------------- audio

const Audio2 = (() => {
  let ctx = null, out = null, comp = null, body = null, ready = false, on = true;
  function init() {
    if (ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource();
    s.buffer = b; s.connect(ctx.destination); s.start(0);
    out = ctx.createGain(); out.gain.value = on ? 1 : 0;
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3.5;
    // heard through a wooden table, like the dominoes
    body = ctx.createBiquadFilter();
    body.type = "peaking"; body.frequency.value = 230; body.Q.value = 1.0; body.gain.value = 4;
    body.connect(out); out.connect(comp); comp.connect(ctx.destination);
    ready = true;
  }
  function noise(ms) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * ms / 1000));
    const b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  /* Wood on wood, same modal recipe as Dominoes: a broadband contact tack plus
   * a short inharmonic plate ring. A block is bigger than a domino, so the
   * fundamental sits lower. */
  function knock(amp, f0, pan) {
    if (!ready) return;
    const t = ctx.currentTime;
    const mix = ctx.createGain(); mix.gain.value = amp;
    const tk = ctx.createBufferSource(); tk.buffer = noise(5);
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 900;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 7000;
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0, t);
    tg.gain.linearRampToValueAtTime(0.85, t + 0.0006);
    tg.gain.exponentialRampToValueAtTime(0.0006, t + 0.006);
    tk.connect(hp); hp.connect(lp); lp.connect(tg); tg.connect(mix);
    tk.start(t); tk.stop(t + 0.03);
    const ratios = [1, 1.59, 2.30, 2.94];
    const src = ctx.createBufferSource(); src.buffer = noise(4);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + 0.0006);
    env.gain.exponentialRampToValueAtTime(0.0008, t + 0.004);
    src.connect(env);
    ratios.forEach((r, i) => {
      const f = f0 * r;
      if (f > 14000) return;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass"; bp.frequency.value = f;
      const dec = 0.014 / (1 + i * 0.6);
      const Q = Math.max(2, Math.PI * f * dec);
      bp.Q.value = Q;
      const g = ctx.createGain(); g.gain.value = 0.5 * Math.sqrt(Q) / (1 + i * 0.8);
      const e = ctx.createGain();
      e.gain.setValueAtTime(1, t);
      e.gain.exponentialRampToValueAtTime(0.0006, t + dec);
      env.connect(bp); bp.connect(g); g.connect(e); e.connect(mix);
    });
    const o = ctx.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(240, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.05);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.linearRampToValueAtTime(0.3, t + 0.002);
    og.gain.exponentialRampToValueAtTime(0.0005, t + 0.06);
    o.connect(og); og.connect(mix);
    o.start(t); o.stop(t + 0.08);
    src.start(t); src.stop(t + 0.06);
    mix.connect(body);
  }
  let slideNode = null;
  return {
    init,
    isReady: () => ready,
    setOn(v) { on = v; if (out) out.gain.setTargetAtTime(v ? 1 : 0, ctx.currentTime, 0.01); },
    slide() {
      init(); if (!ready) return;
      const t = ctx.currentTime;
      const s = ctx.createBufferSource(); s.buffer = noise(320);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass"; bp.frequency.value = 1500; bp.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.055, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0004, t + 0.3);
      s.connect(bp); bp.connect(g); g.connect(body);
      s.start(t); s.stop(t + 0.35);
    },
    lift() { init(); knock(0.5, 900); },
    place() { init(); knock(0.85, 700); },
    tick() { init(); knock(0.35, 1100); },
    crash() {
      init(); if (!ready) return;
      for (let i = 0; i < 16; i++) {
        setTimeout(() => knock(0.5 + Math.random() * 0.4, 480 + Math.random() * 700),
                   i * (28 + Math.random() * 55));
      }
    }
  };
})();

// ---------------------------------------------------------------- hud

const elMoved = document.getElementById("moved");
const elBest = document.getElementById("best");
const elLevel = document.getElementById("levels");
const elHud = document.getElementById("hud");
const elMsg = document.getElementById("callout");
const overlay = document.getElementById("overlay");
const ovEyebrow = document.getElementById("ovEyebrow");
const ovTitle = document.getElementById("ovTitle");
const ovText = document.getElementById("ovText");
const ovBtn = document.getElementById("ovBtn");

function updateHud() {
  if (elMoved) elMoved.textContent = G.moved;
  if (elBest) elBest.textContent = G.best || "—";
  if (elLevel) elLevel.textContent = (G.level + 1);
}
function say(t, ms) {
  if (!elMsg) return;
  elMsg.textContent = t;
  elMsg.hidden = false;
  clearTimeout(say._t);
  say._t = setTimeout(() => { elMsg.hidden = true; }, ms || 1400);
}
function showOver() {
  if (!overlay) return;
  overlay.hidden = false;
  overlay.classList.remove("is-out");
  ovEyebrow.textContent = "It came down";
  ovTitle.textContent = G.moved + (G.moved === 1 ? " block" : " blocks");
  ovText.innerHTML = G.moved === 0
    ? "Not one moved. Take from below the top complete level, slide it all the way out, then put it back on top."
    : "You moved <b>" + G.moved + "</b> before it fell. Best so far <b>" + G.best + "</b>.";
  ovBtn.textContent = "Build it again";
}
function hideOverlay() {
  if (overlay) overlay.classList.add("is-out");
  if (elHud) elHud.hidden = false;
  setTimeout(() => { if (overlay) overlay.hidden = true; }, 240);
}

function startGame() {
  buildWorld();
  held = null; pulling = null; drag = null; hover = null;
  G.mode = "play";
  baseTop = LEVELS * BH;
  hideOverlay();
  updateHud();
  if (window.gtag) window.gtag("event", "toy_start", { toy_slug: "jenga" });
}

if (ovBtn) ovBtn.addEventListener("click", () => { Audio2.init(); startGame(); });
window.addEventListener("keydown", e => {
  if (e.key === " " || e.key === "Enter") {
    e.preventDefault();
    if (G.mode === "intro" || G.mode === "over") { Audio2.init(); startGame(); }
  }
});

const soundBtn = document.getElementById("soundBtn");
let soundOn = true;
try { if (localStorage.getItem("jenga_sound") === "off") soundOn = false; } catch (e) {}
function syncSound() {
  Audio2.setOn(soundOn);
  if (soundBtn) {
    soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
    soundBtn.textContent = soundOn ? "♪" : "♪̸";
  }
}
if (soundBtn) soundBtn.addEventListener("click", () => {
  soundOn = !soundOn;
  try { localStorage.setItem("jenga_sound", soundOn ? "on" : "off"); } catch (e) {}
  Audio2.init(); syncSound();
});

// ---------------------------------------------------------------- loop

let lastT = 0, acc = 0;
const STEP = 1 / 120;

function frame(ms) {
  if (!lastT) lastT = ms;
  const dt = Math.min(0.05, (ms - lastT) / 1000);
  lastT = ms;

  if (world && G.mode !== "intro" && !G.paused) {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 8) { world.step(STEP); acc -= STEP; n++; }
    if (acc > STEP * 8) acc = 0;
    if (G.mode === "play" || G.mode === "placing") checkCollapse();
  }

  if (held) { parkHeld(held); }

  G.shake = Math.max(0, G.shake - dt * 1.6);
  const e = 1 - Math.pow(0.002, dt);
  cam.caz = lerp(cam.caz, cam.az, e);
  cam.cel = lerp(cam.cel, cam.el, e);
  cam.cdist = lerp(cam.cdist, cam.dist, e);
  cam.ctgt = lerp(cam.ctgt, cam.tgt, e);

  render();
  requestAnimationFrame(frame);
}

function render() {
  const { vp, eye } = viewProj();
  gl.clearColor(0.035, 0.028, 0.024, 1);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  if (!world) return;
  drawTable(vp);
  gl.disable(gl.CULL_FACE);
  drawShadows(vp);
  gl.enable(gl.CULL_FACE);
  drawBlocks(vp, eye);
  drawGhosts(vp, eye);
}

window.addEventListener("resize", resize);
window.addEventListener("orientationchange", () => setTimeout(resize, 120));
resize();
syncSound();
updateHud();
requestAnimationFrame(frame);

// headless verification handle
window.__jenga = {
  G, get blocks() { return blocks; }, get world() { return world; },
  get held() { return held; },
  startGame, buildWorld, freeTopSlots, canPull, highestCompleteLevel,
  pickBlock, project, towerTop,
  startPull, slidePull, extract, placeHeld, releasePull, restHeightAt,
  /* Verification only. The page's own loop steps the world every frame, so a
   * harness that also steps it advances physics at two to three times the real
   * rate — which made a perfectly good pull look like it was destroying the
   * tower. Pause the loop before driving the sim by hand. */
  pause(v) { G.paused = v !== false; },
  step(n) { for (let i = 0; i < (n || 1); i++) world.step(STEP); },
  consts: { BL, BW, BH, LEVELS, PULL_CLEAR }
};
