/* Timber — No. 128. Pull a block, then put it back on top.
 *
 * Physics is cannon-es (vendored in lib/, MIT), which is the repo's ONE runtime
 * dependency and exists only because a stack this deep needs a real solver. See
 * .ai/memory/DECISIONS.md, 2026-08-22.
 *
 * ⚠ The single hardest-won lesson here is SCALE. Everything is in SI units:
 * meters and g = -9.82. An earlier build used 3-unit blocks with gravity -250,
 * which is roughly 25x off, and NO solver survives that — a hand-written one and
 * cannon-es both collapsed identically until the units were fixed.
 *
 * Rendering is raw WebGL, hand-written, like every other toy here.
 */
import * as CANNON from "./lib/cannon-es.js";

// ---------------------------------------------------------------- constants

const BL = 0.75, BW = 0.25, BH = 0.15;      // block: 3 : 1 : 0.6, the classic stacking-block proportions
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
try { G.best = parseInt(localStorage.getItem("timber_best") || "0", 10) || 0; } catch (e) {}

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
  world.addEventListener("beginContact", onContact);

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
  /* every block is its own piece of wood: a tone, a seed for its grain, and where
     its pith sat in the log, which decides whether it shows arcs or straight stripes */
  const tone = 0.92 + Math.random() * 0.14, warm = Math.random() * 0.05;
  const b = { body, lv, slot, placed: false,
    col: [0.88 * tone, (0.69 - warm) * tone, (0.48 - warm * 1.4) * tone],
    seed: Math.random() * 97, f0: 1500 + Math.random() * 750,
    pith: [(Math.random() - 0.5) * 0.3, (Math.random() < 0.5 ? -1 : 1) * (0.32 + Math.random() * 0.6)] };
  body.blk = b;
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
const gl = cv.getContext("webgl", { antialias: true, alpha: false, stencil: true, preserveDrawingBuffer: false });
if (!gl) {
  document.getElementById("overlay").innerHTML =
    '<div class="panel"><h1 class="panel__title">Timber</h1>' +
    '<p class="panel__text">This toy needs WebGL, which your browser has turned off.</p></div>';
  throw new Error("no webgl");
}
/* Screen-space derivatives let the grain fade out instead of shimmering once a
   ring is thinner than a pixel. Nearly every device has them; without, the grain
   just keeps its contrast. */
const DERIV = !!gl.getExtension("OES_standard_derivatives");
const HEAD = (DERIV ? "#extension GL_OES_standard_derivatives : enable\n#define HAS_DERIV 1\n" : "") +
  "#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n";

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

/* One warm lamp above and to the left, a little in front: it is what lights the
   pool on the table, the faces of the blocks and the direction of the shadows. */
const LAMP = [-1.35, 3.7, 1.55];

const BLOCK_VS = `
attribute vec3 aPos; attribute vec3 aNor;
uniform mat4 uMVP, uModel; uniform mat3 uNrm; uniform vec3 uDim;
varying vec3 vN; varying vec3 vW; varying vec3 vL; varying vec3 vLN;
void main(){
  vec4 w = uModel * vec4(aPos,1.0);
  vW = w.xyz; vN = normalize(uNrm * aNor); vL = aPos * uDim; vLN = aNor;
  gl_Position = uMVP * vec4(aPos,1.0);
}`;

/* Hardwood. The grain is annual rings around a pith that runs along the block's
   length but sits OUTSIDE it, so a side face shows long arcs, a top face shows
   stripes and an end shows the rings themselves, all from one formula, and each
   block gets its own figure from where its pith sits. */
const BLOCK_FS = HEAD + `
varying vec3 vN; varying vec3 vW; varying vec3 vL; varying vec3 vLN;
uniform vec3 uDim; uniform vec3 uCol; uniform vec3 uEye; uniform vec3 uLamp;
uniform vec2 uPith; uniform float uSeed; uniform float uHi; uniform float uGhost;
float h1(float n){ return fract(sin(n) * 43758.5453); }
float vn(float x){ float i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f); return mix(h1(i + uSeed), h1(i + 1.0 + uSeed), f); }
void main(){
  vec3 N = normalize(vN);
  vec2 q = vL.yz - uPith;
  float wob = (vn(vL.x * 9.0) - 0.5) * 0.007 + (vn(vL.x * 33.0 + 7.0) - 0.5) * 0.0022;
  float r = length(q) + wob;
  float rings = r * 70.0;
  float fr = fract(rings);
  float late = smoothstep(0.5, 0.82, fr) * (1.0 - smoothstep(0.88, 1.0, fr));
  float aa = 1.0;
#ifdef HAS_DERIV
  aa = clamp(1.25 - fwidth(rings) * 1.6, 0.0, 1.0);
#endif
  vec3 wood = uCol;
  wood *= 1.0 - late * 0.13 * aa;
  wood *= 0.96 + 0.07 * vn(r * 30.0 + vL.x * 1.7);
  float endGrain = step(0.5, abs(vLN.x));
  wood *= mix(1.0, 0.84, endGrain);

  /* distance to the nearest edge WITHIN this face, in meters: rounded edges catch
     light and the very seam goes dark, which is what tells one block from the next */
  vec3 dd = uDim * 0.5 - abs(vL);
  vec3 inPlane = step(abs(vLN), vec3(0.5));
  float d = min(mix(1.0, dd.x, inPlane.x), min(mix(1.0, dd.y, inPlane.y), mix(1.0, dd.z, inPlane.z)));
  float bevel = 1.0 - smoothstep(0.0, 0.005, d);
  float seam = 1.0 - smoothstep(0.0, 0.0014, d);

  vec3 Lv = uLamp - vW; float dist = length(Lv); vec3 Lk = Lv / dist;
  float att = 2.2 / (1.0 + 0.075 * dist * dist);
  float dk = max(dot(N, Lk), 0.0);
  vec3 V = normalize(uEye - vW);
  vec3 Hh = normalize(Lk + V);
  float spec = pow(max(dot(N, Hh), 0.0), 34.0) * 0.14;
  vec3 fillDir = normalize(vec3(0.75, 0.3, -0.6));
  float df = max(dot(N, fillDir), 0.0);
  vec3 amb = mix(vec3(0.15, 0.11, 0.08), vec3(0.3, 0.28, 0.3), N.y * 0.5 + 0.5);
  float ao = mix(0.62, 1.0, smoothstep(0.0, 0.3, vW.y));
  vec3 c = wood * (amb * ao + vec3(1.0, 0.85, 0.64) * dk * att + vec3(0.46, 0.42, 0.4) * df * 0.5);
  c += vec3(1.0, 0.9, 0.74) * spec * att * (1.0 - endGrain * 0.6);
  c += wood * bevel * (1.0 - seam) * 0.22 * (0.4 + dk * att);
  c *= mix(1.0, 0.5, seam);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  c += vec3(1.0, 0.82, 0.58) * rim * 0.04;
  c = mix(c, c * 1.12 + vec3(0.32, 0.17, 0.03), uHi * 0.6);
  c = c / (1.0 + c * 0.42) * 1.3;               /* roll off the hot top faces */
  c = pow(c, vec3(0.92));
  if (uGhost > 0.5) gl_FragColor = vec4(mix(c, vec3(1.0, 0.8, 0.42), 0.55), 0.3 + 0.14 * uHi);
  else gl_FragColor = vec4(c, 1.0);
}`;

const FLAT_VS = `
attribute vec3 aPos; uniform mat4 uMVP; varying vec3 vP;
void main(){ vP = aPos; gl_Position = uMVP * vec4(aPos,1.0); }`;
const SHADOW_FS = HEAD + `
uniform float uA;
void main(){ gl_FragColor = vec4(0.03, 0.016, 0.008, uA); }`;
/* A polished walnut tabletop in the lamp's pool, falling away into the room. */
const TABLE_FS = HEAD + `
varying vec3 vP; uniform vec3 uLamp; uniform vec3 uEye;
float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y); }
void main(){
  vec2 p = vP.xz;
  float W = 0.23, plank = floor(p.y / W), py = p.y - plank * W;
  float seam = smoothstep(0.0, 0.0035, py) * smoothstep(0.0, 0.0035, W - py);
  float g = vn2(vec2(p.x * 1.6 + plank * 13.0, py * 70.0 + vn2(vec2(p.x * 0.7, plank)) * 4.0));
  float g2 = vn2(vec2(p.x * 0.5 + plank * 5.0, py * 16.0));
  vec3 wal = mix(vec3(0.15, 0.085, 0.048), vec3(0.29, 0.17, 0.095), g * 0.55 + g2 * 0.45);
  wal *= 0.86 + 0.16 * h2(vec2(plank, 3.0));
  wal *= mix(0.42, 1.0, seam);
  vec3 Lv = uLamp - vP; float dist = length(Lv); vec3 L = Lv / dist;
  float att = 1.55 / (1.0 + 0.075 * dist * dist);
  float r = length(p);
  vec3 c = wal * (0.08 + L.y * att * 0.95);
  vec3 V = normalize(uEye - vP);
  float sp = pow(max(normalize(L + V).y, 0.0), 70.0);
  c += vec3(1.0, 0.82, 0.56) * sp * 0.22 * att * seam;
  vec2 a = abs(p) - vec2(0.37);
  float box = length(max(a, 0.0)) + min(max(a.x, a.y), 0.0);
  c *= mix(0.5, 1.0, smoothstep(-0.04, 0.24, box));
  c = mix(c, vec3(0.032, 0.024, 0.018), smoothstep(2.2, 7.5, r));
  gl_FragColor = vec4(pow(c, vec3(0.92)), 1.0);
}`;

const progBlock = program(BLOCK_VS, BLOCK_FS);
const progFlat = program(FLAT_VS, SHADOW_FS);
const progTable = program(FLAT_VS, TABLE_FS);

const uB = {};
["uMVP", "uModel", "uNrm", "uDim", "uCol", "uEye", "uLamp", "uPith", "uSeed", "uHi", "uGhost"].forEach(n => { uB[n] = gl.getUniformLocation(progBlock, n); });
uB.aPos = gl.getAttribLocation(progBlock, "aPos");
uB.aNor = gl.getAttribLocation(progBlock, "aNor");
const uF = { mvp: gl.getUniformLocation(progFlat, "uMVP"), a: gl.getUniformLocation(progFlat, "uA"), aPos: gl.getAttribLocation(progFlat, "aPos") };
const uT = { mvp: gl.getUniformLocation(progTable, "uMVP"), lamp: gl.getUniformLocation(progTable, "uLamp"),
  eye: gl.getUniformLocation(progTable, "uEye"), aPos: gl.getAttribLocation(progTable, "aPos") };

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
const T = 12;
const tableQuad = new Float32Array([
  -T,0,-T,  T,0,T,  T,0,-T,
  -T,0,-T, -T,0,T,  T,0,T
]);
const bufTable = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, bufTable); gl.bufferData(gl.ARRAY_BUFFER, tableQuad, gl.STATIC_DRAW);

// ---------------------------------------------------------------- camera

/* The camera frames the tower and FOLLOWS it as it grows: the target rises with
   the top, and the distance is fitted so the whole tower stays in view. Pinch or
   scroll scales that fitted distance rather than replacing it. */
const FOV = 40 * Math.PI / 180;
const cam = { az: 0.72, el: 0.34, zoom: 1, tgt: LEVELS * BH * 0.48, dist: 4,
              caz: 0.72, cel: 0.34, cdist: 4, ctgt: LEVELS * BH * 0.48 };
let W = 0, H = 0, DPR = 1;

function fitDist(top) {
  const h = top + 0.4;
  const asp = W / Math.max(1, H);
  const v = h / (2 * Math.tan(FOV / 2)) / 0.64;
  /* a narrow phone fits the tower's width, not its height */
  const hw = Math.tan(FOV / 2) * asp;
  const w = 1.0 / (2 * hw) / 0.8;
  return clamp(Math.max(v, w), 2.2, 10);
}

function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = Math.floor(W * DPR); cv.height = Math.floor(H * DPR);
  cv.style.width = W + "px"; cv.style.height = H + "px";
  gl.viewport(0, 0, cv.width, cv.height);
}

function eyePos() {
  const ce = Math.cos(cam.cel), se = Math.sin(cam.cel);
  const s = G.shake * G.shake * 0.05;
  return [Math.sin(cam.caz) * ce * cam.cdist + (Math.random() - 0.5) * s,
          cam.ctgt + se * cam.cdist + (Math.random() - 0.5) * s,
          Math.cos(cam.caz) * ce * cam.cdist];
}
function viewProj() {
  const asp = cv.width / cv.height;
  const eye = eyePos();
  const at = [0, cam.ctgt, 0];
  return { vp: mMul(mPerspective(FOV, asp, 0.05, 60), mLookAt(eye, at, [0,1,0])), eye, at };
}

// screen -> world ray
function screenRay(sx, sy) {
  const asp = cv.width / cv.height;
  const ndcX = (sx / W) * 2 - 1, ndcY = 1 - (sy / H) * 2;
  const tanF = Math.tan(FOV / 2);
  const ce = Math.cos(cam.cel), se = Math.sin(cam.cel);
  const eye = [Math.sin(cam.caz) * ce * cam.cdist, cam.ctgt + se * cam.cdist, Math.cos(cam.caz) * ce * cam.cdist];
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
function rayBlock(ray, b, pad) {
  const q = b.body.quaternion;
  const inv = new CANNON.Quaternion(-q.x, -q.y, -q.z, q.w);
  const rel = new CANNON.Vec3(ray.o[0] - b.body.position.x, ray.o[1] - b.body.position.y, ray.o[2] - b.body.position.z);
  const lo = inv.vmult(rel);
  const ld = inv.vmult(new CANNON.Vec3(ray.d[0], ray.d[1], ray.d[2]));
  const he = pad ? [BL/2 + pad[0], BH/2 + pad[1], BW/2 + pad[2]] : [BL/2, BH/2, BW/2];
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

function blockModel(b) {
  const p = b.body.position, q = b.body.quaternion;
  return mMul(mMul(mTranslate(p.x, p.y, p.z), mFromQuat(q)), mScale(BL, BH, BW));
}

function bindCube(posLoc, norLoc) {
  gl.enableVertexAttribArray(posLoc);
  gl.bindBuffer(gl.ARRAY_BUFFER, bufP);
  gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
  if (norLoc >= 0) {
    gl.enableVertexAttribArray(norLoc);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufN);
    gl.vertexAttribPointer(norLoc, 3, gl.FLOAT, false, 0, 0);
  }
}

function setBlockUniforms(vp, model, b, hot, ghost) {
  gl.uniformMatrix4fv(uB.uMVP, false, new Float32Array(mMul(vp, model)));
  gl.uniformMatrix4fv(uB.uModel, false, new Float32Array(model));
  gl.uniformMatrix3fv(uB.uNrm, false, new Float32Array([model[0], model[1], model[2], model[4], model[5], model[6], model[8], model[9], model[10]]));
  gl.uniform3fv(uB.uCol, new Float32Array(b ? b.col : [0.9, 0.7, 0.45]));
  gl.uniform2fv(uB.uPith, new Float32Array(b ? b.pith : [0.0, 0.3]));
  gl.uniform1f(uB.uSeed, b ? b.seed : 3.0);
  gl.uniform1f(uB.uHi, hot);
  gl.uniform1f(uB.uGhost, ghost);
}

function drawBlocks(vp, eye) {
  gl.useProgram(progBlock);
  gl.uniform3fv(uB.uEye, new Float32Array(eye));
  gl.uniform3fv(uB.uLamp, new Float32Array(LAMP));
  gl.uniform3fv(uB.uDim, new Float32Array([BL, BH, BW]));
  bindCube(uB.aPos, uB.aNor);
  for (const b of blocks) setBlockUniforms(vp, blockModel(b), b, b === hover || b === pulling ? 1 : 0, 0), gl.drawArrays(gl.TRIANGLES, 0, cube.count);
}

/* Shadows are the blocks flattened onto the table along the lamp's direction.
   The stencil lets each pixel darken once per pass, so overlapping blocks do not
   stack into darker stripes, and four passes from slightly different lamp
   positions give the edge a soft penumbra instead of a cut-paper outline. */
const SHADOW_JIT = [[0, 0], [0.09, 0.05], [-0.07, 0.08], [0.04, -0.09]];
function drawShadows(vp) {
  gl.useProgram(progFlat);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  gl.enable(gl.STENCIL_TEST);
  bindCube(uF.aPos, -1);
  const top = cam.ctgt;
  for (const j of SHADOW_JIT) {
    gl.clear(gl.STENCIL_BUFFER_BIT);
    gl.stencilFunc(gl.EQUAL, 0, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
    const L = norm3([LAMP[0] + j[0] * 3, LAMP[1] - top, LAMP[2] + j[1] * 3]);
    const S = mShadow([-L[0], -L[1], -L[2]]);
    gl.uniform1f(uF.a, 0.13);
    for (const b of blocks) {
      const m = mMul(mMul(mTranslate(0, 0.0015, 0), S), blockModel(b));
      gl.uniformMatrix4fv(uF.mvp, false, new Float32Array(mMul(vp, m)));
      gl.drawArrays(gl.TRIANGLES, 0, cube.count);
    }
  }
  gl.disable(gl.STENCIL_TEST);
  gl.depthMask(true);
  gl.disable(gl.BLEND);
}

function drawTable(vp, eye) {
  gl.useProgram(progTable);
  gl.enableVertexAttribArray(uT.aPos);
  gl.bindBuffer(gl.ARRAY_BUFFER, bufTable);
  gl.vertexAttribPointer(uT.aPos, 3, gl.FLOAT, false, 0, 0);
  gl.uniformMatrix4fv(uT.mvp, false, new Float32Array(vp));
  gl.uniform3fv(uT.lamp, new Float32Array(LAMP));
  gl.uniform3fv(uT.eye, new Float32Array(eye));
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function drawGhosts(vp, eye, now) {
  if (!held) return;
  const slots = freeTopSlots();
  if (!slots.length) return;
  gl.useProgram(progBlock);
  gl.uniform3fv(uB.uEye, new Float32Array(eye));
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  bindCube(uB.aPos, uB.aNor);
  const pulse = 0.5 + 0.5 * Math.sin(now / 260);
  const lit = G.target || G.hoverSlot;
  for (const s of slots) {
    const on = lit && lit.slot === s.slot;
    if (lit && !on && G.carrying) continue;          /* while carrying, show only where it will land */
    let m = mMul(mTranslate(s.x, restHeightAt(s), s.z), mFromQuat(new CANNON.Quaternion().setFromEuler(0, s.yaw, 0)));
    m = mMul(m, mScale(BL, BH, BW));
    setBlockUniforms(vp, m, held, on ? 1 : pulse * 0.6, 1);
    gl.drawArrays(gl.TRIANGLES, 0, cube.count);
  }
  gl.depthMask(true);
  gl.disable(gl.BLEND);
}

/* Where the held block may go. Strict rules: the top level must be filled to
 * three before a new one is started, so the free slots are always on the
 * current top level unless it is already complete.
 *
 * The slots follow the REAL tower, not an ideal one centered on the table. They
 * used to be computed for a perfect tower, so once it had drifted or twisted a
 * little a block went down a few centimeters off the real top: the "weird
 * placement" (owner, 2026-10-04). A partly built level takes its position and
 * angle from its own blocks; a new level takes the level below's, turned 90. */
function frameFrom(cx, cz, yaw, lv) {
  let lx = Math.cos(yaw), lz = -Math.sin(yaw);
  const ex = lv % 2 ? 0 : 1, ez = lv % 2 ? -1 : 0;          /* the parity's natural direction */
  if (lx * ex + lz * ez < 0) { lx = -lx; lz = -lz; }
  return { cx, cz, yaw: Math.atan2(-lz, lx), ax: -lz, az: lx };   /* (ax, az) = across the level */
}
function levelFrame(lv) {
  const bl = blocks.filter(b => b !== held && b.lv === lv);
  if (!bl.length) return null;
  let sx = 0, sz = 0;
  const ref = bl[0].body.quaternion.vmult(new CANNON.Vec3(1, 0, 0));
  for (const b of bl) {
    const a = b.body.quaternion.vmult(new CANNON.Vec3(1, 0, 0));
    const f = a.x * ref.x + a.z * ref.z < 0 ? -1 : 1;
    sx += a.x * f; sz += a.z * f;
  }
  const f0 = frameFrom(0, 0, Math.atan2(-sz, sx), lv);
  let cx = 0, cz = 0;
  for (const b of bl) { cx += b.body.position.x - b.slot * BW * f0.ax; cz += b.body.position.z - b.slot * BW * f0.az; }
  return frameFrom(cx / bl.length, cz / bl.length, f0.yaw, lv);
}
function freeTopSlots() {
  const counts = {};
  blocks.forEach(b => { if (b !== held) counts[b.lv] = (counts[b.lv] || 0) + 1; });
  let lv = G.level;
  if ((counts[lv] || 0) >= 3) lv = lv + 1;
  const taken = new Set(blocks.filter(b => b !== held && b.lv === lv).map(b => b.slot));
  let f = levelFrame(lv);
  if (!f) {
    const below = levelFrame(lv - 1);
    f = below ? frameFrom(below.cx, below.cz, below.yaw + Math.PI / 2, lv)
              : frameFrom(0, 0, lv % 2 ? Math.PI / 2 : 0, lv);
  }
  const out = [];
  for (let k = -1; k <= 1; k++) {
    if (taken.has(k)) continue;
    out.push({ x: f.cx + k * BW * f.ax, y: BH / 2 + lv * BH, z: f.cz + k * BW * f.az, yaw: f.yaw, lv, slot: k });
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
  try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or already-ended pointer */ }

  if (pointers.size === 2) { drag = { mode: "pinch", d0: pinchDist(), z0: cam.zoom }; return; }

  if (held) {
    if (G.anim) return;
    /* press the floating block or a glowing slot to carry it; anywhere else orbits */
    const ray = screenRay(xy.x, xy.y);
    const s = slotUnderRay(ray);
    if (s || rayBlock(ray, held, [0.05, 0.06, 0.05]) >= 0) {
      drag = { mode: "carry", x0: xy.x, y0: xy.y, moved: false, tapSlot: s };
      return;
    }
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
    if (held && !G.anim) {
      const ray = screenRay(xy.x, xy.y);
      G.hoverSlot = slotUnderRay(ray);
      cv.style.cursor = G.hoverSlot || rayBlock(ray, held, [0.05, 0.06, 0.05]) >= 0 ? "grab" : "";
    } else { G.hoverSlot = null; cv.style.cursor = ""; }
    return;
  }
  if (drag.mode === "carry") {
    if (!drag.moved && Math.hypot(xy.x - drag.x0, xy.y - drag.y0) < 7) return;
    drag.moved = true; G.carrying = true; cv.style.cursor = "grabbing";
    /* the block rides just above the top, under the finger */
    /* on a touch screen it rides a little above the fingertip, or the thumb hides it */
    const lift = e.pointerType === "touch" ? 46 : 0;
    const h = towerTop() + BH / 2 + 0.1, ray = screenRay(xy.x, xy.y - lift);
    if (Math.abs(ray.d[1]) < 1e-4) return;
    const t = (h - ray.o[1]) / ray.d[1];
    if (t <= 0) return;
    let px = ray.o[0] + ray.d[0] * t, pz = ray.o[2] + ray.d[2] * t;
    const r = Math.hypot(px, pz);
    if (r > 1.3) { px *= 1.3 / r; pz *= 1.3 / r; }
    G.carryPos = [px, h, pz];
    let best = null, bd = 0.32;
    for (const sl of freeTopSlots()) { const d = Math.hypot(sl.x - px, sl.z - pz); if (d < bd) { bd = d; best = sl; } }
    G.target = best;
    return;
  }
  if (drag.mode === "pinch" && pointers.size === 2) {
    const d = pinchDist();
    cam.zoom = clamp(drag.z0 * (drag.d0 / Math.max(1, d)), 0.45, 1.9);
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
    /* the block follows the finger one to one along its own length, in either
       direction (push it through from one end or draw it out of the other) */
    const b = drag.block;
    const axis = longAxisScreen(b);
    const dx = xy.x - drag.x, dy = xy.y - drag.y;
    const along = (dx * axis.x + dy * axis.y) / Math.max(1, axis.len);
    const was = drag.out, tNow = performance.now();
    drag.out = clamp(drag.out + along / Math.max(20, axis.ppm), -BL * 1.4, BL * 1.4);
    const dtp = Math.max(8, tNow - (drag.t || tNow - 16)) / 1000; drag.t = tNow;
    Audio2.scrape(Math.min(Math.abs(drag.out - was), 0.32 * dtp) / dtp, b.f0);
    if (Math.abs(drag.out) > 0.02) hintGone();
    drag.x = xy.x; drag.y = xy.y;
    slidePull(b, drag.out);
  }
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (!drag) return;
  if (drag.mode === "carry") {
    const target = drag.moved ? G.target : drag.tapSlot;
    G.carrying = false; G.carryPos = null; G.target = null; cv.style.cursor = "";
    if (target) startPlace(target);
    else if (drag.moved) say("set it over a glowing slot", 1200);
    else say("drag it onto the top", 1200);
    drag = null;
    return;
  }
  if (drag.mode === "pull") {
    const b = drag.block;
    if (Math.abs(drag.out) >= PULL_CLEAR) extract(b);
    else releasePull(b);
  }
  if (pointers.size < 2) drag = null;
}
cv.addEventListener("pointerup", endPointer);
cv.addEventListener("pointercancel", endPointer);

cv.addEventListener("wheel", e => {
  e.preventDefault();
  cam.zoom = clamp(cam.zoom * (1 + Math.sign(e.deltaY) * 0.09), 0.45, 1.9);
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
  return { x: dx / len, y: dy / len, len: 1, ppm: len / 0.1 };
}

function project(p) {
  const { vp } = viewProj();
  const x = vp[0]*p[0] + vp[4]*p[1] + vp[8]*p[2] + vp[12];
  const y = vp[1]*p[0] + vp[5]*p[1] + vp[9]*p[2] + vp[13];
  const w = vp[3]*p[0] + vp[7]*p[1] + vp[11]*p[2] + vp[15];
  return [(x / w * 0.5 + 0.5) * W, (1 - (y / w * 0.5 + 0.5)) * H];
}

/* Which glowing slot is under this ray, if any. A tap used to take whichever slot
   center was within 90px, and the three slots are only 25-35px apart, so it often
   took the wrong one, and a tap meant to orbit could place the block. The box is
   padded in height and length (not across, where the slots touch) for fingers. */
function slotUnderRay(ray) {
  let best = null, bt = Infinity;
  for (const sl of freeTopSlots()) {
    const pseudo = { body: { position: new CANNON.Vec3(sl.x, restHeightAt(sl), sl.z), quaternion: new CANNON.Quaternion().setFromEuler(0, sl.yaw, 0) } };
    const t = rayBlock(ray, pseudo, [0.05, 0.07, 0]);
    if (t >= 0 && t < bt) { bt = t; best = sl; }
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
  const sRot = Math.abs(Math.sin(slot.yaw)) > 0.7;
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

/* Hold the block up beside the top of the tower, turned the way it will go,
   where you are about to put it. It used to park IN FRONT of the tower at mid
   height, which hid the tower while you chose a slot. It never collides while
   held (collisionResponse is off), so it can float anywhere. */
function parkHeld(b) {
  const top = towerTop() + BH / 2;
  const rx = Math.cos(cam.caz), rz = -Math.sin(cam.caz);      /* the camera's right */
  const bob = Math.sin(performance.now() / 420) * 0.012;
  const s = freeTopSlots()[0];
  const yaw = s ? s.yaw : 0;
  /* As far right as fits on screen. A fixed 0.68 put it half off the edge of a
     portrait phone; the narrower the screen, the closer in and higher it floats. */
  const { vp } = viewProj();
  const lx = Math.cos(yaw) * BL / 2, lz = -Math.sin(yaw) * BL / 2;
  let off = 0.68;
  for (; off > 0.05; off -= 0.07) {
    const y = top + 0.22 + (0.68 - off) * 0.5;
    let fits = true;
    for (const sg of [1, -1]) {
      const px = rx * off + lx * sg, pz = rz * off + lz * sg;
      const cx = vp[0]*px + vp[4]*y + vp[8]*pz + vp[12], cw = vp[3]*px + vp[7]*y + vp[11]*pz + vp[15];
      if (cw <= 0 || Math.abs(cx / cw) > 0.86) { fits = false; break; }
    }
    if (fits) break;
  }
  b.body.position.set(rx * off, top + 0.22 + (0.68 - off) * 0.5 + bob, rz * off);
  b.body.quaternion.setFromEuler(0, yaw, 0);
  b.body.velocity.setZero();
  b.body.angularVelocity.setZero();
}

/* ⚠⚠ THE DRAG BUG (fixed 2026-10-03): while a block is being slid out it must
 * not touch its own level or the levels directly above and below it (it is
 * driven by the hand, an infinite mass, so any contact it makes is a shove).
 * Measured with the sim
 * stepped by hand: a steady pull dragged the level above 1.0 to 1.3m and threw
 * the top of the tower 1.2 to 1.6m. Cutting contact with the level above only
 * left 0.04 to 0.3m (the level below dragged too); cutting above and below
 * still left up to 10cm, from the neighbors rubbing its sides; cutting all
 * three leaves about 1cm. Friction was never the lever: cannon caps a contact's friction at
 * friction x gravity x the PAIR'S mass, not the real load on it, so a
 * "slippery puller" material changed almost nothing. The real risk survives:
 * the level above now rests on the other two blocks only, so pulling the last
 * support of a level still brings the tower down. */
const PULL_GROUP = 2;
let pullCut = [];
function cutContacts(b) {
  b.body.collisionFilterGroup = PULL_GROUP;
  pullCut = [];
  for (const o of blocks) {
    if (o === b) continue;
    const dy = Math.abs(o.body.position.y - b.body.position.y);
    if (dy < BH * 1.5) { o.body.collisionFilterMask = ~PULL_GROUP; pullCut.push(o); }
  }
}
function restoreContacts(b) {
  b.body.collisionFilterGroup = 1;
  for (const o of pullCut) o.body.collisionFilterMask = -1;
  pullCut = [];
}

function startPull(b) {
  pulling = b;
  cutContacts(b);
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
  Audio2.scrapeStart();
}

/* Drive the sliding block by VELOCITY, never by teleporting it.
 * A kinematic body whose position is set directly has zero velocity as far as
 * the solver is concerned, so each step it appears to have materialised inside
 * its neighbors and the penetration is resolved as a shove — which walked the
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
  Audio2.scrapeStop();
  restoreContacts(b);
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
  Audio2.scrapeStop();
  restoreContacts(b);
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
  say("now drag it onto the top", 1600);
  Audio2.lift(b.f0, 0);
  updateHud();
}

function yawOf(q) { const a = q.vmult(new CANNON.Vec3(1, 0, 0)); return Math.atan2(-a.z, a.x); }
function startPlace(slot) {
  const b = held, p = b.body.position;
  let dy = slot.yaw - yawOf(b.body.quaternion);
  while (dy > Math.PI / 2) dy -= Math.PI; while (dy < -Math.PI / 2) dy += Math.PI;   /* a block is symmetric end to end */
  G.anim = { slot, from: [p.x, p.y, p.z], fromYaw: slot.yaw - dy, t: 0, dur: reducedMotion() ? 1 : 320 };
  G.hoverSlot = null;
}
function stepPlace(dt) {
  const a = G.anim, b = held;
  a.t = Math.min(1, a.t + dt * 1000 / a.dur);
  const e = a.t < 0.5 ? 2 * a.t * a.t : 1 - Math.pow(-2 * a.t + 2, 2) / 2;
  const restY = restHeightAt(a.slot) + 0.002;
  b.body.position.set(lerp(a.from[0], a.slot.x, e), lerp(a.from[1], restY, e) + Math.sin(Math.PI * e) * 0.04, lerp(a.from[2], a.slot.z, e));
  b.body.quaternion.setFromEuler(0, lerp(a.fromYaw, a.slot.yaw, e), 0);
  if (a.t >= 1) { G.anim = null; placeHeld(a.slot); }
}
function reducedMotion() { return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; }

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
   * PLACE a block on the tower, you do not drop it. */
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
    try { localStorage.setItem("timber_best", String(G.best)); } catch (e) {}
  }
  G.mode = "play";
  quietUntil = performance.now() + 180;          /* the place sound IS this contact */
  Audio2.place(b.f0, 0);
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
/* A block is OFF the tower once it has dropped more than half a level below where
   it was built, or left the footprint entirely. The game used to end only when
   three blocks reached the table, so a single block sliding off the top lay on the
   table while the game still counted it as part of the top level (owner,
   2026-10-04). The rule is the real one: any block that falls, other than the one
   in your hand, ends it. */
function offTower(b) {
  const p = b.body.position;
  return (BH / 2 + b.lv * BH) - p.y > BH * 0.6 || Math.hypot(p.x, p.z) > 1.0;
}
function checkCollapse() {
  if (G.mode === "over") return;
  for (const b of blocks) {
    if (b === held || b === pulling) continue;
    if (offTower(b)) { gameOver(); return; }
  }
}
function gameOver() {
  G.mode = "over";
  G.anim = null; G.carrying = false; G.carryPos = null; G.target = null; G.hoverSlot = null;
  if (held) { const b = held; held = null; b.body.collisionResponse = true; b.body.type = CANNON.Body.DYNAMIC; b.body.mass = 0.25; b.body.updateMassProperties(); }
  if (pulling) { releasePull(pulling); }
  drag = null; hover = null;
  /* a whole collapse begins with one block dropping too, so give it half a second
     to show whether this is one block off the top or the tower coming down */
  setTimeout(() => {
    /* count what is on its way down, not just what has landed: blocks off the
       tower, moving fast, or tipped well over. A single drop disturbs one or two. */
    let n = 0;
    for (const b of blocks) {
      const q = b.body.quaternion, upY = Math.abs(1 - 2 * (q.x * q.x + q.z * q.z));
      if (offTower(b) || b.body.velocity.length() > 0.25 || upY < 0.94) n++;
    }
    G.fall = n >= 4 ? "tower" : "block";
    if (G.fall === "tower") {
      G.shake = 1;
      Audio2.crash();
      if (elMsg) {
        elMsg.textContent = "TIMBER!";
        elMsg.classList.add("is-timber");
        elMsg.hidden = false;
        clearTimeout(say._t);
        say._t = setTimeout(() => { elMsg.hidden = true; elMsg.classList.remove("is-timber"); }, 1400);
      }
    } else {
      say("dropped one", 1300);
    }
    setupShare();
    /* let it finish falling before the panel covers it */
    setTimeout(showOver, G.fall === "tower" ? 1300 : 1000);
  }, 450);
}

// ---------------------------------------------------------------- audio

/* Hard maple blocks on a walnut table. House rules: contacts are MODAL (a short
 * noise burst through resonators at the object's own modes, each with a sqrt(Q)
 * makeup, opened by a lowpassed tack), every hit is heard through one shared body
 * (the table), bursts come from a pool so no two hits are identical, the
 * compressor is glue and the brickwall after it is the ceiling.
 *
 * The collapse is NOT scripted: every knock comes from a real contact in the
 * physics, scaled by how hard the bodies met. ⚠ A contact persists across many
 * physics substeps, so each block is throttled to one knock per moment, or one
 * fall measures several times into clipping (the Pinball trap). */
const Audio2 = (() => {
  let ctx = null, busIn = null, out = null, ready = false, on = true;
  let scr = null;
  const pools = {};
  function init() {
    if (ready) { if (ctx.state === "suspended" && ctx.resume) ctx.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource();
    s.buffer = b; s.connect(ctx.destination); s.start(0);
    busIn = ctx.createGain();
    const b1 = ctx.createBiquadFilter(); b1.type = "peaking"; b1.frequency.value = 205; b1.Q.value = 1.1; b1.gain.value = 3.5;
    const b2 = ctx.createBiquadFilter(); b2.type = "peaking"; b2.frequency.value = 470; b2.Q.value = 1.4; b2.gain.value = 2;
    const sh = ctx.createBiquadFilter(); sh.type = "highshelf"; sh.frequency.value = 7200; sh.gain.value = -3;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.ratio.value = 3; comp.knee.value = 6; comp.attack.value = 0.003; comp.release.value = 0.15;
    const wall = ctx.createDynamicsCompressor();
    wall.threshold.value = -1.5; wall.ratio.value = 20; wall.knee.value = 0; wall.attack.value = 0.001; wall.release.value = 0.05;
    out = ctx.createGain(); out.gain.value = on ? 0.9 : 0;
    busIn.connect(b1); b1.connect(b2); b2.connect(sh); sh.connect(comp); comp.connect(wall); wall.connect(out); out.connect(ctx.destination);
    const conv = ctx.createConvolver(); conv.buffer = roomIR(0.95);
    const wet = ctx.createGain(); wet.gain.value = 0.2;
    sh.connect(conv); conv.connect(wet); wet.connect(comp);
    ready = true;
  }
  function roomIR(sec) {
    const n = Math.floor(ctx.sampleRate * sec), buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch); let lo = 0, lo2 = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n; lo = lo * 0.6 + (Math.random() * 2 - 1) * 0.4;
        lo2 = lo2 * (0.6 + 0.35 * t) + lo * (0.4 - 0.35 * t);
        d[i] = lo2 * Math.pow(1 - t, 2.8);
      }
    }
    return buf;
  }
  function burst(ms) {
    const k = Math.round(ms);
    if (!pools[k]) {
      pools[k] = [];
      for (let j = 0; j < 8; j++) {
        const n = Math.max(1, Math.floor(ctx.sampleRate * ms / 1000));
        const b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
        pools[k].push(b);
      }
    }
    return pools[k][(Math.random() * 8) | 0];
  }
  function panTo(pan) {
    if (!ctx.createStereoPanner) return busIn;
    const p = ctx.createStereoPanner(); p.pan.value = clamp(pan || 0, -0.85, 0.85); p.connect(busIn); return p;
  }
  function modal(modes, amp, pan, ms, when) {
    if (!ready || !on || amp <= 0) return;
    const t0 = ctx.currentTime + (when || 0), dest = panTo(pan);
    const src = ctx.createBufferSource(); src.buffer = burst(ms || 9);
    const det = 0.985 + Math.random() * 0.03;
    for (const m of modes) {
      const f = ctx.createBiquadFilter(), g = ctx.createGain();
      f.type = "bandpass"; f.frequency.value = m[0] * det; f.Q.value = m[1];
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(amp * m[2] * Math.sqrt(m[1]), t0 + 0.001);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + m[3] * (0.85 + Math.random() * 0.3));
      src.connect(f); f.connect(g); g.connect(dest);
    }
    const tk = ctx.createBufferSource(); tk.buffer = burst(3);
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 8800;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 2800; bp.Q.value = 0.6;
    const tg = ctx.createGain(); tg.gain.setValueAtTime(amp * 0.4, t0); tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.025);
    tk.connect(lp); lp.connect(bp); bp.connect(tg); tg.connect(dest);
    src.start(t0); tk.start(t0); src.stop(t0 + 0.5); tk.stop(t0 + 0.08);
  }
  /* A maple block is a short free-free bar: its clack sits on bending modes at
     1 : 2.76 : 5.40, high and quick. Under it, whatever it hit: the table thumps
     low, the tower answers a little higher. */
  function clack(v, f0, pan, onTable, when) {
    const m = [[f0, 9, 1.0, 0.045], [f0 * 2.756, 13, 0.5, 0.03], [f0 * 5.404, 16, 0.22, 0.018]];
    if (onTable) m.push([188, 4, 0.95, 0.1], [410, 6, 0.42, 0.06]);
    else m.push([330, 5, 0.5, 0.06]);
    modal(m, 0.5 * v, pan, 9, when);
  }
  /* wood drawn across wood: grain in the buffer itself, so it never sounds like a sweep */
  let scrapeBuf = null;
  function scrapeStart() {
    if (!ready || scr) return;
    if (!scrapeBuf) {
      const n = Math.floor(ctx.sampleRate * 1.6);
      scrapeBuf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = scrapeBuf.getChannelData(0); let gr = 0;
      for (let i = 0; i < n; i++) { if (Math.random() < 0.003) gr = 0.4 + Math.random() * 0.7; gr *= 0.9993; d[i] = (Math.random() * 2 - 1) * (0.3 + gr); }
    }
    const src = ctx.createBufferSource(); src.buffer = scrapeBuf; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1500; bp.Q.value = 0.75;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3900;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(bp); bp.connect(lp); lp.connect(g); g.connect(busIn);
    src.start(0, Math.random());
    scr = { src, g, bp, last: 0 };
  }
  function scrape(speed, f0) {
    if (!scr) return;
    const v = clamp(speed / 0.22, 0, 1);
    scr.g.gain.setTargetAtTime(on ? v * 0.45 : 0, ctx.currentTime, 0.03);
    scr.bp.frequency.setTargetAtTime(1200 + v * 900, ctx.currentTime, 0.05);
    /* stick-slip: a dry block does not slide smoothly, it catches and lets go */
    if (v > 0.15 && Math.random() < v * 0.35 && performance.now() - scr.last > 40) {
      scr.last = performance.now();
      modal([[f0 * 1.3, 8, 1, 0.02], [f0 * 3.1, 12, 0.4, 0.012]], 0.05 + v * 0.05, 0, 4);
    }
  }
  function scrapeStop() {
    if (!scr) return;
    const s = scr; scr = null;
    s.g.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
    setTimeout(() => { try { s.src.stop(); } catch (e) {} }, 250);
  }
  return {
    init, clack, scrapeStart, scrape, scrapeStop,
    isReady: () => ready,
    setOn(v) { on = v; if (out) out.gain.setTargetAtTime(v ? 0.9 : 0, ctx.currentTime, 0.01); },
    lift(f0, pan) { init(); clack(0.55, f0 * 1.08, pan, false); },
    place(f0, pan) { init(); clack(1.0, f0, pan, false); },
    crash() {
      init(); if (!ready || !on) return;
      /* the bulk of the fall arriving on the table: a deep, lumpy thump under the
         clatter the physics is already making */
      const t0 = ctx.currentTime, n = Math.floor(ctx.sampleRate * 0.7);
      const b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) { const t = i / n; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 3) * (0.6 + 0.4 * Math.sin(t * 40) ** 2); }
      const src = ctx.createBufferSource(); src.buffer = b;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.setValueAtTime(420, t0); lp.frequency.exponentialRampToValueAtTime(90, t0 + 0.6);
      const g = ctx.createGain(); g.gain.value = 0.9;
      src.connect(lp); lp.connect(g); g.connect(busIn); src.start(t0);
    }
  };
})();

/* Physical contacts become knocks. beginContact fires once when two bodies START
   touching, which is the moment that makes a sound; the throttle covers a block
   that chatters on and off a surface across substeps. */
const lastKnock = new Map();
let knocksThisSecond = 0, knockWindow = 0, quietUntil = 0;
function onContact(e) {
  if (!Audio2.isReady() || performance.now() < quietUntil) return;
  const A = e.bodyA, B = e.bodyB;
  if (!A || !B) return;
  const va = A.velocity, vb = B.velocity;
  const v = Math.hypot(va.x - vb.x, va.y - vb.y, va.z - vb.z);
  if (v < 0.09) return;
  const now = performance.now();
  if (now - knockWindow > 1000) { knockWindow = now; knocksThisSecond = 0; }
  if (knocksThisSecond > 46) return;
  const blk = A.blk || B.blk;
  if (!blk) return;
  const key = blk.body.id;
  if (now - (lastKnock.get(key) || 0) < 55) return;
  lastKnock.set(key, now);
  knocksThisSecond++;
  const onTable = A === ground || B === ground;
  const p = blk.body.position, sx = project([p.x, p.y, p.z])[0];
  Audio2.clack(Math.pow(clamp((v - 0.09) / 1.1, 0.05, 1), 0.75), blk.f0, (sx / Math.max(1, W)) * 1.6 - 0.8, onTable);
}

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
  if (elLevel) {
    let top = -1;
    for (const b of blocks) if (b !== held && b.lv > top) top = b.lv;
    elLevel.textContent = top + 1;
  }
}
function say(t, ms) {
  if (!elMsg || elMsg.classList.contains("is-timber")) return;
  elMsg.textContent = t;
  elMsg.hidden = false;
  clearTimeout(say._t);
  say._t = setTimeout(() => { elMsg.hidden = true; }, ms || 1400);
}
function showOver() {
  if (!overlay) return;
  overlay.hidden = false;
  overlay.classList.remove("is-out");
  ovEyebrow.textContent = G.fall === "block" ? "A block came off" : "It came down";
  ovTitle.textContent = G.moved + (G.moved === 1 ? " block" : " blocks");
  ovText.innerHTML = G.moved === 0
    ? "Not one moved. Take from below the top complete level, slide it all the way out, then put it back on top."
    : "You moved <b>" + G.moved + "</b> before it fell. Best so far <b>" + G.best + "</b>.";
  ovBtn.textContent = "Build it again";
}
function setupShare() {
  const n = G.moved;
  if (!n) { window.OPT_SHARE_TEXT = window.OPT_SHARE_LINE = window.OPT_SHARE_IMAGE = undefined; return; }
  window.OPT_SHARE_TEXT = "I moved " + n + (n === 1 ? " block" : " blocks") + " before the tower came down in Timber on One Page Toys.";
  window.OPT_SHARE_LINE = n + (n === 1 ? " block" : " blocks") + " before it fell";
  /* called synchronously on the tap, so redrawing into the same task means the
     WebGL canvas still holds the frame and preserveDrawingBuffer is not needed */
  window.OPT_SHARE_IMAGE = function () {
    render(performance.now());
    const w = 1200, h = 900, out = document.createElement("canvas");
    out.width = w; out.height = h;
    const g = out.getContext("2d");
    g.fillStyle = "#0a0806"; g.fillRect(0, 0, w, h);
    const k = Math.max(w / cv.width, (h - 118) / cv.height);
    g.drawImage(cv, (w - cv.width * k) / 2, ((h - 118) - cv.height * k) / 2, cv.width * k, cv.height * k);
    g.fillStyle = "rgba(10,8,6,0.95)"; g.fillRect(0, h - 118, w, 118);
    g.fillStyle = "#ffd596"; g.font = "900 46px Archivo, sans-serif"; g.textBaseline = "middle";
    g.fillText(window.OPT_SHARE_LINE, 46, h - 74);
    g.fillStyle = "rgba(246,234,216,0.55)"; g.font = "500 25px 'Geist Mono', monospace";
    g.fillText("onepagetoys.com/toys/timber", 46, h - 30);
    return out;
  };
}
function hintGone() { const h = document.getElementById("hint"); if (h) h.classList.add("is-gone"); }
function hideOverlay() {
  if (overlay) overlay.classList.add("is-out");
  if (elHud) elHud.hidden = false;
  setTimeout(() => { if (overlay) overlay.hidden = true; }, 240);
}

function startGame() {
  window.OPT_SHARE_TEXT = window.OPT_SHARE_LINE = window.OPT_SHARE_IMAGE = undefined;
  if (elMsg) { elMsg.hidden = true; elMsg.classList.remove("is-timber"); }
  G.fall = null;
  cam.zoom = 1;
  buildWorld();
  held = null; pulling = null; drag = null; hover = null;
  G.mode = "play";
  baseTop = LEVELS * BH;
  hideOverlay();
  updateHud();
  if (window.gtag) window.gtag("event", "toy_start", { toy_slug: "timber" });
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
try { if (localStorage.getItem("timber_sound") === "off") soundOn = false; } catch (e) {}
function syncSound() {
  Audio2.setOn(soundOn);
  if (soundBtn) {
    soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
    soundBtn.textContent = soundOn ? "♪" : "♪̸";
  }
}
if (soundBtn) soundBtn.addEventListener("click", () => {
  soundOn = !soundOn;
  try { localStorage.setItem("timber_sound", soundOn ? "on" : "off"); } catch (e) {}
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
    /* ⚠ A tower that starts to tip moves slowly at first, under the sleep speed
       limit, so the solver put it to SLEEP mid-fall and it hung there leaning off
       one block. Sleep is what keeps a standing tower dead still, so it stays;
       but a block tilted more than about 2 degrees is never allowed to doze. A
       block lying on its side (tilt near 90) is left alone. */
    if (G.mode === "play" || G.mode === "placing") {
      for (const b of blocks) {
        if (b === held || b === pulling) continue;
        const q = b.body.quaternion, upY = 1 - 2 * (q.x * q.x + q.z * q.z);
        if (upY < 0.9994 && upY > 0.5 && b.body.sleepState !== CANNON.Body.AWAKE) b.body.wakeUp();
      }
    }
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 8) { world.step(STEP); acc -= STEP; n++; }
    if (acc > STEP * 8) acc = 0;
    if (G.mode === "play" || G.mode === "placing") checkCollapse();
  }

  if (held) {
    if (G.anim) stepPlace(dt);
    else if (G.carrying && G.carryPos) {
      /* over a free slot it snaps into line with it, just above where it will land */
      const t = G.target, c = G.carryPos;
      if (t) held.body.position.set(t.x, restHeightAt(t) + 0.07, t.z);
      else held.body.position.set(c[0], c[1], c[2]);
      const s0 = t || freeTopSlots()[0];
      if (s0) held.body.quaternion.setFromEuler(0, s0.yaw, 0);
    } else parkHeld(held);
  }

  G.shake = Math.max(0, G.shake - dt * 1.6);
  if (world && (G.mode === "play" || G.mode === "placing")) {
    const top = towerTop() + BH / 2;
    cam.tgt = top * (G.mode === "placing" ? 0.58 : 0.47);
    cam.dist = fitDist(top) * cam.zoom;
  } else if (G.mode === "intro") {
    cam.az += dt * 0.12;                      /* a slow turn behind the start panel */
    cam.dist = fitDist(LEVELS * BH) * cam.zoom;
  }
  const e = 1 - Math.pow(0.002, dt);
  cam.caz = lerp(cam.caz, cam.az, e);
  cam.cel = lerp(cam.cel, cam.el, e);
  cam.cdist = lerp(cam.cdist, cam.dist, e);
  cam.ctgt = lerp(cam.ctgt, cam.tgt, e);

  render(ms);
  requestAnimationFrame(frame);
}

function render(now) {
  const { vp, eye } = viewProj();
  gl.clearColor(0.032, 0.024, 0.018, 1);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
  drawTable(vp, eye);
  if (!world) return;
  gl.disable(gl.CULL_FACE);
  drawShadows(vp);
  gl.enable(gl.CULL_FACE);
  drawBlocks(vp, eye);
  drawGhosts(vp, eye, now || 0);
}

window.addEventListener("resize", resize);
window.addEventListener("orientationchange", () => setTimeout(resize, 120));
resize();
buildWorld();                   /* the tower stands behind the start panel, turning slowly */
syncSound();
updateHud();
requestAnimationFrame(frame);

// headless verification handle: automated browsers only, never a visitor's
if (navigator.webdriver) window.__timber = {
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
