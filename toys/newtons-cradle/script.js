/* Newton's Cradle — real 3D in raw WebGL (no libraries, no build).
 * Chrome balls use a procedural studio-environment reflection (mirror chrome
 * that shifts as they swing); a lit dark-metal frame, V-strings, and soft
 * contact shadows ground the scene. The physics is the proven "group" model
 * for perfect momentum transfer; clacks are synthesized. Drag a ball to pull
 * it back and release; drag empty space to orbit the view. */
(function () {
  "use strict";

  var canvas = document.getElementById("canvas");
  var hintEl = document.getElementById("hint");
  var loopBtn = document.getElementById("loopBtn");
  var soundBtn = document.getElementById("soundBtn");

  var gl = canvas.getContext("webgl", { antialias: true, alpha: false, premultipliedAlpha: false })
        || canvas.getContext("experimental-webgl", { antialias: true });
  if (!gl) {
    var f = document.createElement("p");
    f.textContent = "This toy needs WebGL. Try a different browser.";
    f.style.cssText = "position:fixed;inset:0;display:grid;place-items:center;color:#9aa;font:500 16px system-ui;text-align:center;padding:24px";
    document.body.appendChild(f);
    return;
  }

  /* ---- tunables ---- */
  var N = 5;
  var G = 9.81, L_METERS = 0.32;
  var LAUNCH_ANGLE = Math.PI * 0.40;
  var DAMP = 0.10, REST = 0.96;   // REST = coefficient of restitution (closer to 1 = crisper transfer, only a whisper of residual motion)

  /* world layout (units) */
  var ballR = 0.42, spacing = ballR * 2.0;
  var pivotY = 1.15, ballRestY = -1.15, L = pivotY - ballRestY; // 2.30
  var postX = 2.45, zBar = 0.85, baseY = -2.0;
  function ballX(i) { return (i - (N - 1) / 2) * spacing; }

  /* ---- physics state (per-ball pendulums + elastic collisions) ----
     Each ball is its own pendulum; adjacent balls collide and exchange
     momentum (equal mass, elastic). This makes it natural: every contact
     clicks (loud strikes AND the soft settling taps), the impulse can
     propagate through several balls in one strike, you can grab one ball
     while the rest keep swinging, and it settles on its own. */
  var theta = new Float32Array(N), omega = new Float32Array(N);
  var loop = false, dragging = false, pinned = -1, lastTs = null;
  var soundOn = true;
  var dragTheta = 0, dragOmega = 0, dragPrevTheta = 0, dragPrevT = 0;

  function perfNow() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  function ballTheta(i) { return theta[i]; }
  function launch(n) {
    ensureAudio();
    for (var i = 0; i < N; i++) { omega[i] = 0; theta[i] = i < n ? -LAUNCH_ANGLE : 0; }
    if (hintEl) hintEl.classList.add("is-hidden");
  }

  var CLICK_MIN = 0.02;   // closing speed below this a contact is silent
  function resolve() {
    for (var pass = 0; pass < N + 2; pass++) {
      var any = false;
      for (var i = 0; i < N - 1; i++) {
        var pi = (i === pinned), pj = (i + 1 === pinned);
        // (1) POSITION — balls may never overlap (prevents pass-through, even a held ball)
        var overlap = theta[i] - theta[i + 1];
        if (overlap > 1e-5) {
          if (pi) theta[i + 1] = theta[i];              // a held ball is fixed → move the free neighbor
          else if (pj) theta[i] = theta[i + 1];
          else { var m = 0.5 * overlap; theta[i] -= m; theta[i + 1] += m; }
          any = true;
        }
        // (2) VELOCITY — balls in contact + closing exchange momentum (equal mass, elastic)
        if (theta[i] >= theta[i + 1] - 0.002) {
          var closing = omega[i] - omega[i + 1];
          if (closing > 1e-4) {
            if (pi) { if (omega[i + 1] < 0) omega[i + 1] = 0; }        // free neighbor can't push into the held ball
            else if (pj) { if (omega[i] > 0) omega[i] = 0; }
            else {
              if (closing > CLICK_MIN && pinned < 0) click(closing, i); // silent while ANY ball is held (no jostle static)
              // equal-mass collision with restitution REST (<1 leaves a little motion in each ball → not frozen)
              var v1 = omega[i], v2 = omega[i + 1];
              omega[i] = ((1 - REST) * v1 + (1 + REST) * v2) * 0.5;
              omega[i + 1] = ((1 + REST) * v1 + (1 - REST) * v2) * 0.5;
            }
            any = true;
          }
        }
      }
      if (!any) break;
    }
  }
  function step(dt) {
    dt = Math.min(dt, 0.032);
    var sub = 3, h = dt / sub, GL = G / L_METERS;
    var damp = Math.pow(1 - DAMP, h);   // always lose energy naturally — Auto-swing re-launches instead of running frictionless
    for (var s = 0; s < sub; s++) {
      for (var i = 0; i < N; i++) {
        if (i === pinned) { theta[i] = dragTheta; omega[i] = 0; continue; } // held ball is kinematic + imparts nothing until released
        omega[i] += -GL * Math.sin(theta[i]) * h;
        omega[i] *= damp;
        theta[i] += omega[i] * h;
        if (Math.abs(omega[i]) < 0.008 && Math.abs(theta[i]) < 0.004) { omega[i] = 0; theta[i] = 0; } // only snap when truly still (let subtle wobble linger)
      }
      resolve();
    }
  }

  /* ================= tiny math ================= */
  function v3(x, y, z) { return [x, y, z]; }
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
    for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) {
      o[c * 4 + r] = a[0 * 4 + r] * b[c * 4 + 0] + a[1 * 4 + r] * b[c * 4 + 1] + a[2 * 4 + r] * b[c * 4 + 2] + a[3 * 4 + r] * b[c * 4 + 3];
    }
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
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
      -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
  }
  function mInvert(m) {
    var inv = new Array(16), i;
    inv[0] = m[5]*m[10]*m[15]-m[5]*m[11]*m[14]-m[9]*m[6]*m[15]+m[9]*m[7]*m[14]+m[13]*m[6]*m[11]-m[13]*m[7]*m[10];
    inv[4] = -m[4]*m[10]*m[15]+m[4]*m[11]*m[14]+m[8]*m[6]*m[15]-m[8]*m[7]*m[14]-m[12]*m[6]*m[11]+m[12]*m[7]*m[10];
    inv[8] = m[4]*m[9]*m[15]-m[4]*m[11]*m[13]-m[8]*m[5]*m[15]+m[8]*m[7]*m[13]+m[12]*m[5]*m[11]-m[12]*m[7]*m[9];
    inv[12] = -m[4]*m[9]*m[14]+m[4]*m[10]*m[13]+m[8]*m[5]*m[14]-m[8]*m[6]*m[13]-m[12]*m[5]*m[10]+m[12]*m[6]*m[9];
    inv[1] = -m[1]*m[10]*m[15]+m[1]*m[11]*m[14]+m[9]*m[2]*m[15]-m[9]*m[3]*m[14]-m[13]*m[2]*m[11]+m[13]*m[3]*m[10];
    inv[5] = m[0]*m[10]*m[15]-m[0]*m[11]*m[14]-m[8]*m[2]*m[15]+m[8]*m[3]*m[14]+m[12]*m[2]*m[11]-m[12]*m[3]*m[10];
    inv[9] = -m[0]*m[9]*m[15]+m[0]*m[11]*m[13]+m[8]*m[1]*m[15]-m[8]*m[3]*m[13]-m[12]*m[1]*m[11]+m[12]*m[3]*m[9];
    inv[13] = m[0]*m[9]*m[14]-m[0]*m[10]*m[13]-m[8]*m[1]*m[14]+m[8]*m[2]*m[13]+m[12]*m[1]*m[10]-m[12]*m[2]*m[9];
    inv[2] = m[1]*m[6]*m[15]-m[1]*m[7]*m[14]-m[5]*m[2]*m[15]+m[5]*m[3]*m[14]+m[13]*m[2]*m[7]-m[13]*m[3]*m[6];
    inv[6] = -m[0]*m[6]*m[15]+m[0]*m[7]*m[14]+m[4]*m[2]*m[15]-m[4]*m[3]*m[14]-m[12]*m[2]*m[7]+m[12]*m[3]*m[6];
    inv[10] = m[0]*m[5]*m[15]-m[0]*m[7]*m[13]-m[4]*m[1]*m[15]+m[4]*m[3]*m[13]+m[12]*m[1]*m[7]-m[12]*m[3]*m[5];
    inv[14] = -m[0]*m[5]*m[14]+m[0]*m[6]*m[13]+m[4]*m[1]*m[14]-m[4]*m[2]*m[13]-m[12]*m[1]*m[6]+m[12]*m[2]*m[5];
    inv[3] = -m[1]*m[6]*m[11]+m[1]*m[7]*m[10]+m[5]*m[2]*m[11]-m[5]*m[3]*m[10]-m[9]*m[2]*m[7]+m[9]*m[3]*m[6];
    inv[7] = m[0]*m[6]*m[11]-m[0]*m[7]*m[10]-m[4]*m[2]*m[11]+m[4]*m[3]*m[10]+m[8]*m[2]*m[7]-m[8]*m[3]*m[6];
    inv[11] = -m[0]*m[5]*m[11]+m[0]*m[7]*m[9]+m[4]*m[1]*m[11]-m[4]*m[3]*m[9]-m[8]*m[1]*m[7]+m[8]*m[3]*m[5];
    inv[15] = m[0]*m[5]*m[10]-m[0]*m[6]*m[9]-m[4]*m[1]*m[10]+m[4]*m[2]*m[9]+m[8]*m[1]*m[6]-m[8]*m[2]*m[5];
    var det = m[0]*inv[0]+m[1]*inv[4]+m[2]*inv[8]+m[3]*inv[12];
    if (!det) return mIdent();
    det = 1 / det; for (i = 0; i < 16; i++) inv[i] *= det;
    return inv;
  }
  /* normal matrix (mat3, inverse-transpose of model upper-left), returned as 9 floats */
  function mNormal(m) {
    var a00 = m[0], a01 = m[1], a02 = m[2], a10 = m[4], a11 = m[5], a12 = m[6], a20 = m[8], a21 = m[9], a22 = m[10];
    var b01 = a22 * a11 - a12 * a21, b11 = -a22 * a10 + a12 * a20, b21 = a21 * a10 - a11 * a20;
    var det = a00 * b01 + a01 * b11 + a02 * b21; if (!det) return [1, 0, 0, 0, 1, 0, 0, 0, 1]; det = 1 / det;
    return [
      b01 * det, (-a22 * a01 + a02 * a21) * det, (a12 * a01 - a02 * a11) * det,
      b11 * det, (a22 * a00 - a02 * a20) * det, (-a12 * a00 + a02 * a10) * det,
      b21 * det, (-a21 * a00 + a01 * a20) * det, (a11 * a00 - a01 * a10) * det
    ];
  }
  /* rotation aligning +Y to a unit direction d */
  function rotAlignY(d) {
    var y = [0, 1, 0];
    var c = dot(y, d);
    if (c > 0.99999) return mIdent();
    if (c < -0.99999) return mScale(1, -1, 1); // flip
    var ax = norm3(cross(y, d)), s = Math.sqrt(1 - c * c), t = 1 - c;
    var x = ax[0], yy = ax[1], z = ax[2];
    return [
      t * x * x + c, t * x * yy + s * z, t * x * z - s * yy, 0,
      t * x * yy - s * z, t * yy * yy + c, t * yy * z + s * x, 0,
      t * x * z + s * yy, t * yy * z - s * x, t * z * z + c, 0,
      0, 0, 0, 1
    ];
  }
  /* model matrix for a cylinder spanning a->b with given radius */
  function cylBetween(a, b, radius) {
    var d = sub(b, a), l = len3(d) || 1e-4, dir = scale3(d, 1 / l), mid = scale3(add(a, b), 0.5);
    return mMul(mMul(mTranslate(mid[0], mid[1], mid[2]), rotAlignY(dir)), mScale(radius, l, radius));
  }

  /* ================= geometry ================= */
  function makeSphere(stacks, slices) {
    var pos = [], nor = [], idx = [], i, j;
    for (i = 0; i <= stacks; i++) {
      var phi = i / stacks * Math.PI, sp = Math.sin(phi), cp = Math.cos(phi);
      for (j = 0; j <= slices; j++) {
        var th = j / slices * Math.PI * 2, st = Math.sin(th), ct = Math.cos(th);
        var x = sp * ct, y = cp, z = sp * st;
        pos.push(x, y, z); nor.push(x, y, z);
      }
    }
    for (i = 0; i < stacks; i++) for (j = 0; j < slices; j++) {
      var a = i * (slices + 1) + j, b = a + slices + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    return buildMesh(pos, nor, idx);
  }
  function makeCylinder(seg) {
    var pos = [], nor = [], idx = [], j;
    for (j = 0; j <= seg; j++) {
      var th = j / seg * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
      pos.push(c, -0.5, s); nor.push(c, 0, s);
      pos.push(c, 0.5, s); nor.push(c, 0, s);
    }
    for (j = 0; j < seg; j++) { var a = j * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    // caps
    var base = pos.length / 3;
    pos.push(0, 0.5, 0); nor.push(0, 1, 0); var topC = base;
    for (j = 0; j <= seg; j++) { var t2 = j / seg * Math.PI * 2; pos.push(Math.cos(t2), 0.5, Math.sin(t2)); nor.push(0, 1, 0); }
    for (j = 0; j < seg; j++) idx.push(topC, topC + 1 + j, topC + 2 + j);
    base = pos.length / 3; pos.push(0, -0.5, 0); nor.push(0, -1, 0); var botC = base;
    for (j = 0; j <= seg; j++) { var t3 = j / seg * Math.PI * 2; pos.push(Math.cos(t3), -0.5, Math.sin(t3)); nor.push(0, -1, 0); }
    for (j = 0; j < seg; j++) idx.push(botC, botC + 2 + j, botC + 1 + j);
    return buildMesh(pos, nor, idx);
  }
  function makeQuad() { // unit XZ plane, y=0, spans -1..1
    var pos = [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], nor = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], idx = [0, 1, 2, 0, 2, 3];
    return buildMesh(pos, nor, idx);
  }
  function buildMesh(pos, nor, idx) {
    var pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);
    var nb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, nb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(nor), gl.STATIC_DRAW);
    var ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    return { pb: pb, nb: nb, ib: ib, n: idx.length };
  }

  /* ================= shaders ================= */
  // A single key light (upper-right, behind the camera — direction supplied as
  // uLight each frame) on a near-black room: the chrome reflects one source.
  var ENV_GLSL = [
    "uniform vec3 uLight;",
    "vec3 envColor(vec3 d){",
    "  d=normalize(d); vec3 L=normalize(uLight);",
    "  float m=dot(d,L);",
    "  float lit=clamp(m*0.5+0.5,0.0,1.0);",
    "  float grad=pow(lit,4.5)*0.14;",          // barely any fill — keep the body dark & reflective
    "  float broad=pow(max(m,0.0),24.0)*1.4;",  // tighter soft key (no gray wash across the ball)
    "  float hot=pow(max(m,0.0),90.0)*7.0;",    // bright defined highlight
    "  float core=pow(max(m,0.0),1100.0)*18.0;",// blown-white source
    "  vec3 base=vec3(0.0025,0.003,0.005);",    // near-black reflective body",
    "  return base + vec3(1.0,0.97,0.92)*(grad+broad+hot+core);",
    "}"
  ].join("\n");

  function compile(type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(s), src); }
    return s;
  }
  function program(vs, fs) {
    var p = gl.createProgram(); gl.attachShader(p, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(p));
    return p;
  }

  var surfProg = program(
    "attribute vec3 aPos; attribute vec3 aNorm;" +
    "uniform mat4 uProj,uView,uModel; uniform mat3 uNorm;" +
    "varying vec3 vW; varying vec3 vN;" +
    "void main(){ vec4 w=uModel*vec4(aPos,1.0); vW=w.xyz; vN=uNorm*aNorm; gl_Position=uProj*uView*w; }",
    "precision highp float;" + ENV_GLSL +
    "varying vec3 vW; varying vec3 vN; uniform vec3 uCam,uTint; uniform float uMetal,uRough,uFres,uSpec,uRim,uBrush,uTonemap,uUseCube; uniform samplerCube uCube;" +
    "void main(){" +
    "  vec3 N=normalize(vN), V=normalize(uCam-vW), R=reflect(-V,N);" +
    "  vec3 env;" +
    "  if(uUseCube>0.5){ env=mix(textureCube(uCube,R).rgb, envColor(R), 0.30); env+=max(envColor(R)-vec3(1.0),0.0)*0.7; }" + // scene reflection + studio sheen + crisp glints
    "  else { env=envColor(R); }" +
    "  vec3 broad=envColor(N); env=mix(env,broad,uRough);" +
    "  float fres=pow(1.0-max(dot(N,V),0.0),4.0);" +
    "  vec3 Ld=normalize(uLight); float diff=max(dot(N,Ld),0.0);" +
    "  vec3 diffuse=uTint*(0.12+0.9*diff);" +
    "  vec3 metalC=env*mix(vec3(1.0),uTint,0.15);" +
    "  vec3 c=mix(diffuse,metalC,uMetal);" +
    "  c=mix(c,broad+vec3(0.2),fres*uFres);" +
    "  float sp=pow(max(dot(R,Ld),0.0),220.0); c+=vec3(1.0)*sp*uSpec;" +
    "  if(uBrush>0.5){ c*=1.0+0.022*(sin(vW.x*63.0)+sin(vW.x*37.0+1.7)+sin(vW.x*101.0+0.6)); }" + // subtle brushed-metal grain along the bar
    "  c+=vec3(0.38,0.48,0.66)*pow(1.0-max(dot(N,V),0.0),3.5)*uRim;" +               // cool rim so dark edges separate from the black
    "  if(uTonemap>0.5){ c=clamp((c*(2.51*c+0.03))/(c*(2.43*c+0.59)+0.14),0.0,1.0); c=pow(c,vec3(1.0/2.2)); }" + // ACES filmic — punchier highlights, richer contrast
    "  gl_FragColor=vec4(c,1.0);" +
    "}"
  );
  var cubeEnvProg = program(   // fills each cubemap face with the (linear) studio env
    "attribute vec3 aPos; void main(){ gl_Position=vec4(aPos.xy,0.999,1.0); }",
    "precision highp float;" + ENV_GLSL +
    "uniform mat4 uInv; uniform vec3 uCam; uniform vec2 uRes;" +
    "void main(){ vec2 ndc=(gl_FragCoord.xy/uRes)*2.0-1.0; vec4 wp=uInv*vec4(ndc,1.0,1.0); wp/=wp.w; gl_FragColor=vec4(envColor(normalize(wp.xyz-uCam)),1.0); }"
  );
  var bgProg = program(
    "attribute vec3 aPos; void main(){ gl_Position=vec4(aPos.xy,0.999,1.0); }",
    "precision highp float;" + ENV_GLSL +
    "uniform mat4 uInv; uniform vec3 uCam; uniform vec2 uRes;" +
    "void main(){" +
    "  vec2 ndc=(gl_FragCoord.xy/uRes)*2.0-1.0;" +
    "  vec4 wp=uInv*vec4(ndc,1.0,1.0); wp/=wp.w; vec3 dir=normalize(wp.xyz-uCam);" +
    "  vec3 c=envColor(dir)*0.02;" +                                    // deep near-black reflected world
    "  vec2 q=(ndc-vec2(0.0,-0.1))*vec2(0.92,1.28);" +                 // tight, subtle glow right behind the cradle
    "  float pool=smoothstep(0.9,0.05,length(q));" +
    "  c+=vec3(0.028,0.033,0.046)*pool;" +                            // dim glow for a little depth only
    "  c*=smoothstep(1.5,0.18,length(ndc));" +                         // deep vignette to black at the edges
    "  c=clamp((c*(2.51*c+0.03))/(c*(2.43*c+0.59)+0.14),0.0,1.0); c=pow(c,vec3(1.0/2.2));" + // same ACES as the surfaces

    "  gl_FragColor=vec4(c,1.0);" +
    "}"
  );
  var floorProg = program(
    "attribute vec3 aPos; uniform mat4 uProj,uView,uModel; varying vec3 vW;" +
    "void main(){ vec4 w=uModel*vec4(aPos,1.0); vW=w.xyz; gl_Position=uProj*uView*w; }",
    "precision highp float; varying vec3 vW; uniform vec3 uBall[5]; uniform float uFade; uniform samplerCube uCube; uniform vec3 uCam;" +
    "void main(){" +
    "  vec2 p=vW.xz;" +
    "  float sh=0.0;" +
    "  for(int i=0;i<5;i++){ float d=length(p-uBall[i].xy); float h=uBall[i].z;" +   // h = ball height above rest
    "    sh=max(sh, 0.46*exp(-h*1.1)*smoothstep(0.9+h*0.55,0.0,d)); }" +             // higher ball -> wider, fainter shadow (penumbra)
    "  float fao=smoothstep(3.6,1.2,length(p))*0.30; sh=max(sh,fao);" +
    "  float rad=smoothstep(4.5,0.0,length(p));" +
    "  vec3 base=mix(vec3(0.007,0.009,0.014),vec3(0.028,0.032,0.042),rad);" +  // darker, moodier floor
    "  vec3 c=base*(1.0-clamp(sh,0.0,0.78));" +
    "  vec3 vd=normalize(vW-uCam); vec3 rr=reflect(vd,vec3(0.0,1.0,0.0));" +   // subtle mirror of the scene on the floor
    "  vec3 refl=textureCube(uCube,rr).rgb;" +
    "  float rf=smoothstep(3.0,0.4,length(p))*0.07*(1.0-clamp(sh,0.0,0.55));" +
    "  c+=refl*refl*rf;" +   // refl² keeps only the brighter mirror bits, very subtle
    "  float edge=smoothstep(5.4,2.3,length(p));" +
    "  c=pow(max(c,0.0),vec3(1.0/2.2));" +
    "  gl_FragColor=vec4(c, edge);" +
    "}"
  );

  function loc(p, n) { return gl.getUniformLocation(p, n); }
  var uS = { proj: loc(surfProg, "uProj"), view: loc(surfProg, "uView"), model: loc(surfProg, "uModel"), norm: loc(surfProg, "uNorm"), cam: loc(surfProg, "uCam"), tint: loc(surfProg, "uTint"), metal: loc(surfProg, "uMetal"), rough: loc(surfProg, "uRough"), fres: loc(surfProg, "uFres"), spec: loc(surfProg, "uSpec"), rim: loc(surfProg, "uRim"), brush: loc(surfProg, "uBrush"), tonemap: loc(surfProg, "uTonemap"), useCube: loc(surfProg, "uUseCube"), cube: loc(surfProg, "uCube"), light: loc(surfProg, "uLight") };
  var aS_pos = gl.getAttribLocation(surfProg, "aPos"), aS_norm = gl.getAttribLocation(surfProg, "aNorm");
  var uB = { inv: loc(bgProg, "uInv"), cam: loc(bgProg, "uCam"), res: loc(bgProg, "uRes"), light: loc(bgProg, "uLight") };
  var aB_pos = gl.getAttribLocation(bgProg, "aPos");
  var uCE = { inv: loc(cubeEnvProg, "uInv"), cam: loc(cubeEnvProg, "uCam"), res: loc(cubeEnvProg, "uRes"), light: loc(cubeEnvProg, "uLight") };
  var aCE_pos = gl.getAttribLocation(cubeEnvProg, "aPos");
  var uF = { proj: loc(floorProg, "uProj"), view: loc(floorProg, "uView"), model: loc(floorProg, "uModel"), ball: loc(floorProg, "uBall"), fade: loc(floorProg, "uFade"), cube: loc(floorProg, "uCube"), cam: loc(floorProg, "uCam") };
  var aF_pos = gl.getAttribLocation(floorProg, "aPos");

  var sphere = makeSphere(48, 64), cyl = makeCylinder(28), quad = makeQuad();
  var bgBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bgBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), gl.STATIC_DRAW);

  function bindSurf(mesh) {
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.pb); gl.enableVertexAttribArray(aS_pos); gl.vertexAttribPointer(aS_pos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.nb); gl.enableVertexAttribArray(aS_norm); gl.vertexAttribPointer(aS_norm, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ib);
  }
  function drawSurf(mesh, model, mat) {
    gl.uniformMatrix4fv(uS.model, false, model);
    gl.uniformMatrix3fv(uS.norm, false, mNormal(model));
    gl.uniform3fv(uS.tint, mat.tint); gl.uniform1f(uS.metal, mat.metal); gl.uniform1f(uS.rough, mat.rough); gl.uniform1f(uS.fres, mat.fres); gl.uniform1f(uS.spec, mat.spec); gl.uniform1f(uS.rim, mat.rim || 0); gl.uniform1f(uS.brush, mat.brush || 0);
    gl.drawElements(gl.TRIANGLES, mesh.n, gl.UNSIGNED_SHORT, 0);
  }

  var MAT_CHROME = { tint: [0.95, 0.96, 1.0], metal: 1.0, rough: 0.012, fres: 0.6, spec: 2.8, rim: 0.20 };
  var MAT_FRAME = { tint: [0.19, 0.21, 0.26], metal: 0.5, rough: 0.5, fres: 0.45, spec: 0.6, rim: 0.10, brush: 1 };  // diffuse brushed metal so the single light shapes it
  var MAT_STRING = { tint: [0.09, 0.10, 0.13], metal: 0.0, rough: 1.0, fres: 0.1, spec: 0.0, rim: 0.0 };

  /* frame segments (static) — just the top rails the strings hang from */
  var frameSegs = [];
  (function buildFrame() {
    var pY = pivotY, bR = 0.06;
    frameSegs.push([[-postX, pY, zBar], [postX, pY, zBar], bR]);    // front rail (strings attach)
    frameSegs.push([[-postX, pY, -zBar], [postX, pY, -zBar], bR]);  // back rail
    frameSegs.push([[-postX, pY, -zBar], [-postX, pY, zBar], bR]);  // left connector
    frameSegs.push([[postX, pY, -zBar], [postX, pY, zBar], bR]);    // right connector
  })();

  /* ---- draw the scene surfaces (reused by the main pass and the cube pass) ---- */
  function drawSceneSurfaces(proj, view, cam, tonemap, ballsUseCube, includeStrings) {
    gl.useProgram(surfProg);
    gl.uniformMatrix4fv(uS.proj, false, proj); gl.uniformMatrix4fv(uS.view, false, view); gl.uniform3fv(uS.cam, cam);
    gl.uniform1f(uS.tonemap, tonemap); gl.uniform1i(uS.cube, 0); gl.uniform3fv(uS.light, curLight);
    var i;
    gl.uniform1f(uS.useCube, 0);
    bindSurf(cyl);
    for (i = 0; i < frameSegs.length; i++) drawSurf(cyl, cylBetween(frameSegs[i][0], frameSegs[i][1], frameSegs[i][2]), MAT_FRAME);
    if (includeStrings) {
      for (i = 0; i < N; i++) {
        var t2 = theta[i], cx = ballX(i), bc = [cx + L * Math.sin(t2), pivotY - L * Math.cos(t2), 0];
        drawSurf(cyl, cylBetween([cx, pivotY, zBar], bc, 0.012), MAT_STRING);
        drawSurf(cyl, cylBetween([cx, pivotY, -zBar], bc, 0.012), MAT_STRING);
      }
    }
    gl.uniform1f(uS.useCube, ballsUseCube);
    bindSurf(sphere);
    for (i = 0; i < N; i++) {
      var t3 = theta[i], mx = ballX(i) + L * Math.sin(t3), my = pivotY - L * Math.cos(t3);
      drawSurf(sphere, mMul(mTranslate(mx, my, 0), mScale(ballR, ballR, ballR)), MAT_CHROME);
    }
    if (includeStrings) {
      // attachment hardware: a small cap where the strings meet each ball + tiny lugs on the bar
      gl.uniform1f(uS.useCube, 0);
      for (i = 0; i < N; i++) {
        var t5 = theta[i], cx5 = ballX(i), bx5 = cx5 + L * Math.sin(t5), by5 = pivotY - L * Math.cos(t5);
        var dx = cx5 - bx5, dy = pivotY - by5, dl = Math.sqrt(dx * dx + dy * dy) || 1;
        drawSurf(sphere, mMul(mTranslate(bx5 + dx / dl * ballR, by5 + dy / dl * ballR, 0), mScale(0.05, 0.05, 0.05)), MAT_FRAME);
        drawSurf(sphere, mMul(mTranslate(cx5, pivotY, zBar), mScale(0.034, 0.034, 0.034)), MAT_FRAME);
        drawSurf(sphere, mMul(mTranslate(cx5, pivotY, -zBar), mScale(0.034, 0.034, 0.034)), MAT_FRAME);
      }
    }
  }

  /* ---- dynamic reflection cube-map (lightweight: 128², env + frame + balls) ---- */
  var CUBE_SZ = 128, probe = [0, ballRestY, 0];
  var cubeTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, cubeTex);
  for (var _f = 0; _f < 6; _f++) gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + _f, 0, gl.RGBA, CUBE_SZ, CUBE_SZ, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  var cubeFBO = gl.createFramebuffer(), cubeRB = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, cubeRB); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, CUBE_SZ, CUBE_SZ);
  gl.bindFramebuffer(gl.FRAMEBUFFER, cubeFBO); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, cubeRB);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  var CUBE_FACES = [
    { d: [1, 0, 0], u: [0, -1, 0] }, { d: [-1, 0, 0], u: [0, -1, 0] },
    { d: [0, 1, 0], u: [0, 0, 1] }, { d: [0, -1, 0], u: [0, 0, -1] },
    { d: [0, 0, 1], u: [0, -1, 0] }, { d: [0, 0, -1], u: [0, -1, 0] }
  ];
  var cubeProj = mPerspective(Math.PI / 2, 1, 0.1, 100);
  function updateCube() {
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_CUBE_MAP, null); // avoid target==sampler
    gl.bindFramebuffer(gl.FRAMEBUFFER, cubeFBO);
    gl.viewport(0, 0, CUBE_SZ, CUBE_SZ);
    for (var f = 0; f < 6; f++) {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, cubeTex, 0);
      var view = mLookAt(probe, add(probe, CUBE_FACES[f].d), CUBE_FACES[f].u);
      var invVP = mInvert(mMul(cubeProj, view));
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.DEPTH_TEST); gl.depthMask(false);   // env fill (covers the whole face)
      gl.useProgram(cubeEnvProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, bgBuf); gl.enableVertexAttribArray(aCE_pos); gl.vertexAttribPointer(aCE_pos, 3, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(uCE.inv, false, invVP); gl.uniform3fv(uCE.cam, probe); gl.uniform2f(uCE.res, CUBE_SZ, CUBE_SZ); gl.uniform3fv(uCE.light, curLight);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.depthMask(true); gl.enable(gl.DEPTH_TEST);
      drawSceneSurfaces(cubeProj, view, probe, 0.0, 0.0, false);   // linear, balls env-chrome, no strings
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /* ---- bloom: the hot highlights glow. The metal is re-rendered small,
     thresholded + blurred, then ADDED over the main image — the main pass
     stays on the default (MSAA) framebuffer so edges keep their AA. ---- */
  var postVS = "attribute vec3 aPos; varying vec2 vUv; void main(){ vUv=aPos.xy*0.5+0.5; gl_Position=vec4(aPos.xy,0.0,1.0); }";
  var blurProg = program(postVS,
    "precision mediump float; varying vec2 vUv; uniform sampler2D uTex; uniform vec2 uDir; uniform float uThresh;" +
    "vec3 tap(vec2 o){ vec3 c=texture2D(uTex,vUv+o).rgb; return max(c-vec3(uThresh),0.0); }" +
    "void main(){ vec3 s=tap(vec2(0.0))*0.227027;" +
    " s+=(tap(uDir*1.3846)+tap(-uDir*1.3846))*0.3162162;" +
    " s+=(tap(uDir*3.2308)+tap(-uDir*3.2308))*0.0702703;" +
    " gl_FragColor=vec4(s,1.0); }");
  var addProg = program(postVS,
    "precision mediump float; varying vec2 vUv; uniform sampler2D uTex; uniform float uAmt;" +
    "void main(){ gl_FragColor=vec4(texture2D(uTex,vUv).rgb*uAmt,1.0); }");
  var uBL = { tex: loc(blurProg, "uTex"), dir: loc(blurProg, "uDir"), thresh: loc(blurProg, "uThresh") };
  var aBL_pos = gl.getAttribLocation(blurProg, "aPos");
  var uAD = { tex: loc(addProg, "uTex"), amt: loc(addProg, "uAmt") };
  var aAD_pos = gl.getAttribLocation(addProg, "aPos");
  var BLOOM_THRESH = 0.62, BLOOM_AMT = 0.9;
  var rtA = null, rtB = null, rtW = 0, rtH = 0;
  function makeRT(w, h, depth) {
    var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    var rb = null;
    if (depth) { rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb: fb, tex: t, rb: rb };
  }
  function dropRT(rt) { if (!rt) return; gl.deleteFramebuffer(rt.fb); gl.deleteTexture(rt.tex); if (rt.rb) gl.deleteRenderbuffer(rt.rb); }
  function ensureRTs() {
    var w = Math.max(1, canvas.width >> 2), h = Math.max(1, canvas.height >> 2); // quarter res
    if (w === rtW && h === rtH) return;
    rtW = w; rtH = h; dropRT(rtA); dropRT(rtB);
    rtA = makeRT(w, h, true); rtB = makeRT(w, h, false);
  }

  /* ================= camera ================= */
  var baseYaw = -0.34, basePitch = 0.09, userYaw = 0, userPitch = 0, dist = 10.2;
  var target = [0, -0.1, 0];
  var curProj, curView, curInv, camPos, curLight = [0.5, 0.6, 0.5];
  function camAngles() {
    var yaw = baseYaw + userYaw, pitch = Math.max(0.05, Math.min(0.62, basePitch + userPitch));
    return { yaw: yaw, pitch: pitch };
  }
  function updateCamera() {
    var a = camAngles(), cp = Math.cos(a.pitch);
    camPos = [target[0] + dist * Math.sin(a.yaw) * cp, target[1] + dist * Math.sin(a.pitch), target[2] + dist * Math.cos(a.yaw) * cp];
    var asp = canvas.width / canvas.height;
    curProj = mPerspective(32 * Math.PI / 180, asp, 0.1, 100);
    curView = mLookAt(camPos, target, [0, 1, 0]);
    curInv = mInvert(mMul(curProj, curView));
    // single key light: raking from upper-right (mostly to the side, only a little
    // toward the camera) so the balls get a bright-highlight/dark-reflection contrast
    var toCam = norm3(sub(camPos, target)), right = norm3(cross([0, 1, 0], toCam)), up = cross(toCam, right);
    curLight = norm3(add(add(scale3(toCam, 0.22), scale3(up, 0.85)), scale3(right, 0.72)));
  }

  /* ================= render ================= */
  var DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * DPR);
    canvas.height = Math.floor(window.innerHeight * DPR);
    canvas.style.width = window.innerWidth + "px"; canvas.style.height = window.innerHeight + "px";
  }
  resize(); window.addEventListener("resize", resize);

  var ballFloorBuf = new Float32Array(15), loopWaitT = 0;
  function render(ts) {
    var dt = lastTs !== null ? (ts - lastTs) / 1000 : 0;
    if (lastTs !== null) step(dt); // always step — the rest keep swinging while you hold one
    lastTs = ts;
    // Auto-swing: let it wind down naturally, then re-launch (1–3 balls) so it keeps going
    if (loop) {
      if (pinned < 0 && atRest()) { loopWaitT -= dt; if (loopWaitT <= 0) { launch(1 + Math.floor(Math.random() * 3)); loopWaitT = 0.7 + Math.random() * 0.9; } }
      else loopWaitT = 0.7 + Math.random() * 0.9;
    }
    updateCamera();

    /* 1) refresh the reflection cube-map from the probe (every frame so reflections don't flicker) */
    updateCube();

    /* 2) main pass */
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_CUBE_MAP, cubeTex); // reflection cube for floor + balls
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.01, 0.012, 0.018, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // background env (darkened)
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
    gl.useProgram(bgProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, bgBuf); gl.enableVertexAttribArray(aB_pos); gl.vertexAttribPointer(aB_pos, 3, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(uB.inv, false, curInv); gl.uniform3fv(uB.cam, camPos); gl.uniform2f(uB.res, canvas.width, canvas.height); gl.uniform3fv(uB.light, curLight);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true); gl.enable(gl.DEPTH_TEST);

    // floor + soft contact shadows (blended)
    var i;
    for (i = 0; i < N; i++) { ballFloorBuf[i * 3] = ballX(i) + L * Math.sin(theta[i]); ballFloorBuf[i * 3 + 1] = 0; ballFloorBuf[i * 3 + 2] = L * (1 - Math.cos(theta[i])); } // z = height above rest
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(floorProg);
    var floorModel = mMul(mTranslate(0, baseY - 0.12, 0), mScale(9, 1, 6));
    gl.bindBuffer(gl.ARRAY_BUFFER, quad.pb); gl.enableVertexAttribArray(aF_pos); gl.vertexAttribPointer(aF_pos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, quad.ib);
    gl.uniformMatrix4fv(uF.proj, false, curProj); gl.uniformMatrix4fv(uF.view, false, curView); gl.uniformMatrix4fv(uF.model, false, floorModel);
    gl.uniform3fv(uF.ball, ballFloorBuf); gl.uniform1f(uF.fade, 1); gl.uniform1i(uF.cube, 0); gl.uniform3fv(uF.cam, camPos);
    gl.drawElements(gl.TRIANGLES, quad.n, gl.UNSIGNED_SHORT, 0);
    gl.disable(gl.BLEND);

    // surfaces — balls sample the reflection cube-map (already bound to unit 0)
    drawSceneSurfaces(curProj, curView, camPos, 1.0, 1.0, true);

    /* 3) bloom: re-render the metal small -> threshold+blur -> add over the image */
    ensureRTs();
    gl.bindFramebuffer(gl.FRAMEBUFFER, rtA.fb);
    gl.viewport(0, 0, rtW, rtH);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_CUBE_MAP, cubeTex);
    drawSceneSurfaces(curProj, curView, camPos, 1.0, 1.0, false);      // no strings (they'd sparkle at quarter res)
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
    gl.useProgram(blurProg);                                           // threshold + horizontal blur A->B
    gl.bindBuffer(gl.ARRAY_BUFFER, bgBuf); gl.enableVertexAttribArray(aBL_pos); gl.vertexAttribPointer(aBL_pos, 3, gl.FLOAT, false, 0, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, rtB.fb);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, rtA.tex);
    gl.uniform1i(uBL.tex, 0); gl.uniform2f(uBL.dir, 1 / rtW, 0); gl.uniform1f(uBL.thresh, BLOOM_THRESH);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, rtA.fb);                        // vertical blur B->A
    gl.bindTexture(gl.TEXTURE_2D, rtB.tex);
    gl.uniform2f(uBL.dir, 0, 1 / rtH); gl.uniform1f(uBL.thresh, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);                          // additive composite onto the screen
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(addProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, bgBuf); gl.enableVertexAttribArray(aAD_pos); gl.vertexAttribPointer(aAD_pos, 3, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, rtA.tex);
    gl.uniform1i(uAD.tex, 0); gl.uniform1f(uAD.amt, BLOOM_AMT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND); gl.depthMask(true); gl.enable(gl.DEPTH_TEST);

    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);

  /* ================= interaction ================= */
  function pointerRay(e) {
    var r = canvas.getBoundingClientRect();
    var nx = ((e.clientX - r.left) / r.width) * 2 - 1, ny = -(((e.clientY - r.top) / r.height) * 2 - 1);
    var pNear = mulPoint(curInv, [nx, ny, -1]), pFar = mulPoint(curInv, [nx, ny, 1]);
    return { o: camPos, d: norm3(sub(pFar, pNear)) };
  }
  function mulPoint(m, p) {
    var x = p[0], y = p[1], z = p[2];
    var w = m[3] * x + m[7] * y + m[11] * z + m[15];
    return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w];
  }
  function raySphere(o, d, c, rad) {
    var oc = sub(o, c), b = dot(oc, d), cc = dot(oc, oc) - rad * rad, h = b * b - cc;
    if (h < 0) return -1; h = Math.sqrt(h); var t = -b - h; return t > 0 ? t : (-b + h > 0 ? -b + h : -1);
  }
  /* intersect ray with the z=0 swing plane */
  function planeHit(ray) {
    if (Math.abs(ray.d[2]) < 1e-5) return null;
    var t = -ray.o[2] / ray.d[2]; if (t < 0) return null;
    return add(ray.o, scale3(ray.d, t));
  }
  function updateDragFromRay(ray) {
    if (pinned < 0) return;
    var P = planeHit(ray); if (!P) return;
    var th = Math.max(-1.5, Math.min(1.5, Math.atan2(P[0] - ballX(pinned), pivotY - P[1])));
    var now = perfNow(), dt = Math.max(0.004, (now - dragPrevT) / 1000);
    dragOmega = Math.max(-7, Math.min(7, (th - dragPrevTheta) / dt)); // track velocity so a flick throws it
    dragPrevTheta = th; dragPrevT = now; dragTheta = th; theta[pinned] = th;
  }

  var orbiting = false, lastPx = 0, lastPy = 0;
  canvas.addEventListener("pointerdown", function (e) {
    ensureAudio();
    var ray = pointerRay(e), best = -1, bt = 1e9;
    for (var i = 0; i < N; i++) {
      var th = theta[i], c = [ballX(i) + L * Math.sin(th), pivotY - L * Math.cos(th), 0];
      var t = raySphere(ray.o, ray.d, c, ballR * 1.25);
      if (t > 0 && t < bt) { bt = t; best = i; }
    }
    if (best >= 0) {
      dragging = true; pinned = best;                 // grab ONE ball — the rest keep their motion
      dragTheta = theta[best]; dragPrevTheta = theta[best]; dragPrevT = perfNow(); dragOmega = 0; omega[best] = 0;
      if (hintEl) hintEl.classList.add("is-hidden");
      updateDragFromRay(ray);
    } else {
      orbiting = true; lastPx = e.clientX; lastPy = e.clientY;
    }
    try { canvas.setPointerCapture(e.pointerId); } catch (er) {}
    e.preventDefault();
  });
  canvas.addEventListener("pointermove", function (e) {
    if (dragging) { updateDragFromRay(pointerRay(e)); e.preventDefault(); }
    else if (orbiting) {
      userYaw += (e.clientX - lastPx) * 0.006; userPitch += (e.clientY - lastPy) * 0.005;
      userYaw = Math.max(-0.85, Math.min(0.85, userYaw)); userPitch = Math.max(-0.16, Math.min(0.42, userPitch));
      lastPx = e.clientX; lastPy = e.clientY; e.preventDefault();
    }
  });
  function release() {
    if (pinned >= 0) { omega[pinned] = Math.max(-3, Math.min(3, dragOmega)); pinned = -1; } // hand the swing back to physics
    dragging = false; orbiting = false;
  }
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);

  /* ================= audio ================= */
  var actx = null, master = null, wet = null;
  function makeImpulse(dur, decay) {
    var n = Math.floor(actx.sampleRate * dur), b = actx.createBuffer(2, n, actx.sampleRate);
    for (var ch = 0; ch < 2; ch++) { var d = b.getChannelData(ch); for (var i = 0; i < n; i++) { var x = i / n; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - x, decay); } }
    return b;
  }
  function ensureAudio() {
    if (actx) { if (actx.state === "suspended") actx.resume(); return; }
    var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    actx = new AC();
    var comp = actx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5; comp.attack.value = 0.002; comp.release.value = 0.12;
    comp.connect(actx.destination);
    master = actx.createGain(); master.gain.value = 0.9; master.connect(comp);
    var rev = actx.createConvolver(); rev.buffer = makeImpulse(0.32, 3.4);   // small, tight room so clicks sit in a space
    wet = actx.createGain(); wet.gain.value = 0.14; wet.connect(rev); rev.connect(comp);
    try { var s = actx.createBufferSource(); s.buffer = actx.createBuffer(1, 1, 22050); s.connect(actx.destination); s.start(0); } catch (e) {}
    if (actx.state === "suspended") actx.resume();
  }
  /* A steel-ball click: a broadband impact tick + a short inharmonic metallic
     ring + a little body, panned by position, into the reverb — one per contact,
     scaled by impact strength (so tiny settling taps are just quieter). */
  function click(rel, idx) {
    if (!actx || !soundOn || !master) return;
    var v = Math.min(1.0, (Math.abs(rel) - 0.012) * 0.55); if (v <= 0.004) return;
    var now = actx.currentTime + Math.random() * 0.003;
    var bus = actx.createGain(); bus.gain.value = 1;
    var pan = actx.createStereoPanner ? actx.createStereoPanner() : null;
    if (pan) { pan.pan.value = Math.max(-1, Math.min(1, (idx / (N - 1) - 0.5) * 1.15)); bus.connect(pan); pan.connect(master); }
    else bus.connect(master);
    bus.connect(wet);
    // impact tick — short filtered noise burst
    var nlen = Math.floor(actx.sampleRate * 0.012), nb = actx.createBuffer(1, nlen, actx.sampleRate), nd = nb.getChannelData(0);
    for (var i = 0; i < nlen; i++) nd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / nlen, 2.4);
    var ns = actx.createBufferSource(); ns.buffer = nb;
    var bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 2500 + Math.random() * 1400; bp.Q.value = 0.8;
    var ng = actx.createGain(); ng.gain.value = v * 0.95;
    ns.connect(bp); bp.connect(ng); ng.connect(bus); ns.start(now); ns.stop(now + 0.02);
    // inharmonic metallic ring (steel is not harmonic)
    var base = 2900 + Math.random() * 1000, ratios = [1.0, 2.76, 5.4], rg = [0.5, 0.26, 0.12];
    for (var k = 0; k < 3; k++) {
      var o = actx.createOscillator(); o.type = "sine"; o.frequency.value = base * ratios[k] * (0.99 + Math.random() * 0.02);
      var g = actx.createGain(), dur = 0.028 + Math.random() * 0.03;
      g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(v * rg[k], now + 0.001); g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      o.connect(g); g.connect(bus); o.start(now); o.stop(now + dur + 0.01);
    }
    // subtle body weight
    var bo = actx.createOscillator(); bo.type = "sine"; bo.frequency.value = 150 + Math.random() * 40;
    var bg = actx.createGain(); bg.gain.setValueAtTime(0.0001, now); bg.gain.exponentialRampToValueAtTime(v * 0.16, now + 0.002); bg.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
    bo.connect(bg); bg.connect(bus); bo.start(now); bo.stop(now + 0.05);
  }

  /* ================= controls ================= */
  loopBtn.addEventListener("click", function () {
    loop = !loop;
    loopBtn.classList.toggle("is-active", loop);
    loopBtn.setAttribute("aria-pressed", loop ? "true" : "false");
    loopBtn.textContent = loop ? "Stop" : "Auto-swing";
    if (loop) { ensureAudio(); if (atRest()) launch(2); }
  });
  function atRest() { for (var i = 0; i < N; i++) if (Math.abs(omega[i]) > 0.05 || Math.abs(theta[i]) > 0.02) return false; return true; }
  if (soundBtn) soundBtn.addEventListener("click", function () {
    soundOn = !soundOn; soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false"); soundBtn.textContent = soundOn ? "Sound: on" : "Sound: off";
    ensureAudio();
  });
})();
