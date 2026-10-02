/* Trench Runner — CINEMATIC mode: the same canal, rendered for real.
 *
 * The neon mode draws the trench as glowing strokes, and it stays exactly as it
 * is. This file is the second look, chosen by the player (owner, 2026-09-24:
 * "keep the neon look, offer it as a second mode but really take it up"). It is
 * a WebGL renderer for everything SOLID — walls, floor, the deck beyond the rim,
 * piers, hatches, towers, trusses, the barriers, the girders, the guns and your
 * ship — while script.js keeps drawing everything that is LIGHT on top (shots,
 * bolts, explosions, brackets, the crosshair, the HUD), so the game reads the
 * same in both looks.
 *
 * ⚠ ONE PROJECTION. The vertex shader is script.js's project()/px() written in
 * GLSL — canal wander, camera, focal length, roll, shake — so a gun's bracket
 * drawn in 2D sits exactly on the gun drawn here. Change one, change both.
 * ⚠ The trench furniture is a pure function of the slab index through the SAME
 * hash() the neon mode uses, so a stretch of canal has the same piers, towers
 * and trusses in both looks; flip mid-run and nothing moves.
 *
 * What makes it cinematic, in order of what the eye notices:
 *   - STARLIGHT WITH THE TRENCH'S OWN SHADOW: a hard light from above, and the
 *     rim casting a crisp shadow line down the far wall and across the floor.
 *   - EVERYTHING THAT GLOWS ALSO LIGHTS: wall lamps throw cyan pools, your shots
 *     sweep green light along the plating, enemy bolts red, kills flash orange,
 *     the core lights the last stretch gold.
 *   - Gunmetal plating: panel seams, raised plates, vents and bolts in a height
 *     field that bends the lighting, with per-panel wear.
 *   - Light strips in the floor streaming past, bloom, a filmic curve, haze.
 */
(function () {
  "use strict";

  var gl = null, gl2 = false, cv = null, K = null;
  var W = 0, H = 0, SC = 1, RW = 0, RH = 0;
  var progScene = null, progBright = null, progBlur = null, progComp = null;
  var staticBuf = null, staticCount = 0, slabFirst = [], slabBase = 0;
  var dynBuf = null, dyn = null;
  var quadBuf = null;
  var fb = {};
  var ok = false;

  var M = {
    WALL: 0, FLOOR: 1, DECK: 2, STEEL: 3, HATCH: 4, GRATE: 5, TOWER: 6, LAMP: 7, RED: 8, GOLD: 9,
    SLAB: 10, STRIPE: 11, SAFE: 12, BAD: 13, SPENT: 14, PROP: 15, PROPHOT: 16, TURRET: 17, EYE: 18,
    HULL: 19, ENGINE: 20, GLASS: 21
  };

  /* ------------------------------------------------------------ shaders */

  var VS = [
    "attribute vec3 aP;",
    "attribute vec3 aN;",
    "attribute vec2 aM;",
    "uniform vec3 uCam;",
    "uniform vec4 uView;",     // focal, cx, cy, roll   (render pixels)
    "uniform vec2 uRes;",
    "uniform vec2 uShake;",
    "uniform vec3 uTear;",     // shockZ, on, MIDY
    "varying vec3 vP;",
    "varying vec3 vN;",
    "varying vec2 vM;",
    "varying float vDz;",
    "float canalX(float z){ return sin(z * 0.00152) * 15.0 + sin(z * 0.00061 + 1.7) * 23.0; }",
    "float canalY(float z){ return sin(z * 0.00104 + 0.6) * 6.5; }",
    "void main(){",
    "  vec3 p = aP;",
    // the finale: behind the blast front the canal is blown open
    "  if (uTear.y > 0.5 && p.z < uTear.x + 40.0) {",
    "    float g = 1.0 + clamp((uTear.x - p.z) / 260.0, 0.0, 2.2);",
    "    p.x *= g; p.y = uTear.z + (p.y - uTear.z) * g;",
    "  }",
    "  vec3 w = vec3(canalX(p.z) + p.x, canalY(p.z) + p.y, p.z);",
    "  float dz = w.z - uCam.z;",
    "  vec2 d = (w.xy - uCam.xy) * uView.x;",
    "  float c = cos(uView.w), s = sin(uView.w);",
    "  d = vec2(d.x * c - d.y * s, d.x * s + d.y * c);",
    "  vec2 sc = (uView.yz + uShake) * dz + d;",
    "  float n = 1.2; float f = 1400.0;",
    "  float b = -2.0 / (1.0 / n - 1.0 / f); float a = 1.0 - b / f;",
    "  gl_Position = vec4(sc.x / uRes.x * 2.0 - dz, dz - sc.y / uRes.y * 2.0, a * dz + b, dz);",
    "  vP = p; vN = aN; vM = aM; vDz = dz;",
    "}"
  ].join("\n");

  var FS = [
    "#ifdef GL_FRAGMENT_PRECISION_HIGH",
    "precision highp float;",
    "#else",
    "precision mediump float;",
    "#endif",
    "varying vec3 vP;",
    "varying vec3 vN;",
    "varying vec2 vM;",
    "varying float vDz;",
    "uniform vec3 uCam;",
    "uniform float uT;",
    "uniform float uFar;",
    "uniform vec4 uLP[8];",
    "uniform vec4 uLC[8];",
    "uniform vec2 uShock;",    // front z, strength
    "uniform float uMotion;",
    "const float HALF = 9.6; const float FLOOR = 6.4; const float TOP = -6.6; const float MIDY = -0.1;",
    "float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }",
    "float n2(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);",
    "  return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y); }",
    "float canalX(float z){ return sin(z * 0.00152) * 15.0 + sin(z * 0.00061 + 1.7) * 23.0; }",
    "float canalY(float z){ return sin(z * 0.00104 + 0.6) * 6.5; }",
    // plating as a height field: seams, raised plates, vents, bolts
    "float plate(vec2 uv, vec2 size, float salt){",
    "  vec2 q = uv / size; vec2 cell = floor(q); vec2 f = fract(q);",
    "  vec2 e = min(f, 1.0 - f) * size;",
    "  float edge = min(e.x, e.y);",
    "  float h = smoothstep(0.03, 0.13, edge);",
    "  float r = h2(cell + salt);",
    "  if (r > 0.55) {",
    "    float inset = 0.35 + 0.3 * h2(cell + salt + 3.3);",
    "    h += smoothstep(inset, inset + 0.07, edge) * 0.4;",
    "  } else if (r < 0.16) {",
    "    float inside = smoothstep(0.45, 0.5, edge);",
    "    h -= inside * (0.2 + 0.25 * step(0.5, fract(uv.y * 2.6 + uv.x * 0.0)));",
    "  }",
    "  float bolt = (1.0 - smoothstep(0.06, 0.1, length(e - vec2(0.28)))) * step(0.3, h2(cell + salt + 1.7));",
    "  return h + bolt * 0.3;",
    "}",
    "float panelTint(vec2 uv, vec2 size, float salt){ return 0.72 + 0.56 * h2(floor(uv / size) + salt + 7.1); }",
    "vec3 lightAll(vec3 P, vec3 N, vec3 V, vec3 alb, float metal, float rough, bool inTrench){",
    "  vec3 F0 = mix(vec3(0.04), alb, metal);",
    "  vec3 dc = alb * (1.0 - metal * 0.8);",
    "  float shin = mix(110.0, 10.0, rough);",
    "  float sn = (shin + 8.0) / 30.0;",
    // sky and bounce
    "  vec3 col = alb * mix(vec3(0.012, 0.014, 0.03), vec3(0.05, 0.06, 0.1), clamp(-N.y * 0.5 + 0.5, 0.0, 1.0));",
    // starlight, and the rim's shadow across the trench
    "  vec3 Ls = normalize(vec3(0.85, -1.0, 0.35));",
    "  float lit = 1.0;",
    "  if (inTrench) {",
    "    float t = (HALF - P.x) / Ls.x;",
    "    float yh = P.y + Ls.y * t;",
    "    lit = smoothstep(TOP + 0.5, TOP - 0.5, yh);",
    "  }",
    "  float dS = max(dot(N, Ls), 0.0) * lit;",
    "  vec3 Hs = normalize(Ls + V);",
    "  float fr = pow(1.0 - max(dot(Hs, V), 0.0), 5.0) * 0.45;",
    "  vec3 Fs = F0 + (1.0 - F0) * fr;",
    "  col += vec3(0.62, 0.68, 0.9) * 2.6 * (dc * dS + Fs * pow(max(dot(N, Hs), 0.0), shin) * sn * dS);",
    // the wall lamps: every fourth rib, both walls
    "  float k0 = floor(P.z / 32.0);",
    "  for (int i = 0; i < 3; i++) {",
    "    float kz = (k0 + float(i)) * 32.0;",
    "    for (int j = 0; j < 2; j++) {",
    "      float sd = j == 0 ? -1.0 : 1.0;",
    "      vec3 L = vec3(sd * (HALF - 0.25), MIDY, kz) - P;",
    "      float d2 = dot(L, L); L *= inversesqrt(d2);",
    "      float att = 1.6 / (1.0 + d2 * 0.028);",
    "      float df = max(dot(N, L), 0.0);",
    "      vec3 Hh = normalize(L + V);",
    "      col += vec3(0.42, 1.0, 0.92) * att * (dc * df + F0 * pow(max(dot(N, Hh), 0.0), shin) * sn * df);",
    "    }",
    "  }",
    // shots, bolts, blasts, the engine, the core
    "  for (int i = 0; i < 8; i++) {",
    "    vec4 lp = uLP[i]; vec4 lc = uLC[i];",
    "    if (lc.w <= 0.0) continue;",
    "    vec3 L = lp.xyz - P;",
    "    float d2 = dot(L, L); L *= inversesqrt(d2 + 1e-4);",
    "    float att = lc.w / (1.0 + d2 / (lp.w * lp.w));",
    "    float df = max(dot(N, L), 0.0) * 0.85 + 0.15;",
    "    vec3 Hh = normalize(L + V);",
    "    col += lc.rgb * att * (dc * df + F0 * pow(max(dot(N, Hh), 0.0), shin) * sn * df);",
    "  }",
    "  return col;",
    "}",
    "void main(){",
    "  vec3 P = vP; vec3 N = normalize(vN); float m = vM.x; float seed = vM.y;",
    "  vec3 camL = vec3(uCam.x - canalX(P.z), uCam.y - canalY(P.z), uCam.z);",
    "  vec3 V = normalize(camL - P);",
    "  bool inT = abs(P.x) < HALF + 0.02 && P.y > TOP - 0.02;",
    "  vec3 alb = vec3(0.3, 0.32, 0.38); float metal = 0.8; float rough = 0.5; vec3 emis = vec3(0.0);",
    // the surface's own axes, for the plating pattern
    "  vec2 uv; vec2 size; vec3 T; vec3 B; float salt = 0.0;",
    "  if (abs(N.x) > 0.5) { uv = vec2(P.z, P.y); size = vec2(8.0, 3.25); T = vec3(0.0, 0.0, 1.0); B = vec3(0.0, 1.0, 0.0); salt = N.x; }",
    "  else if (abs(N.y) > 0.5) { uv = vec2(P.x, P.z); size = vec2(3.2, 8.0); T = vec3(1.0, 0.0, 0.0); B = vec3(0.0, 0.0, 1.0); salt = 11.0; }",
    "  else { uv = vec2(P.x, P.y); size = vec2(2.1, 2.1); T = vec3(1.0, 0.0, 0.0); B = vec3(0.0, 1.0, 0.0); salt = 23.0; }",
    "  bool plated = m < 6.5 || (m > 9.5 && m < 10.5) || (m > 14.5 && m < 17.5);",
    "  if (m > 2.5 && m < 6.5 || m > 14.5) size *= 0.45;",
    "  float tint = 1.0;",
    "  if (plated) {",
    "    float e = 0.045;",
    "    float h0 = plate(uv, size, salt);",
    "    float hx = plate(uv + vec2(e, 0.0), size, salt);",
    "    float hy = plate(uv + vec2(0.0, e), size, salt);",
    "    N = normalize(N - (T * (hx - h0) + B * (hy - h0)) / e * 0.06);",
    "    tint = panelTint(uv, size, salt) * (0.72 + 0.28 * h0);",
    "  }",
    "  float grime = n2(vec2(uv.x * 0.35, uv.y * 0.06)) * 0.5 + n2(uv * 1.7) * 0.5;",
    "  if (m < 0.5) {",                                                          // wall
    "    alb = vec3(0.15, 0.17, 0.22) * tint * (0.7 + 0.4 * grime); rough = 0.4 + 0.45 * grime; metal = 0.55;",
    // conduit strip along the base, and the seam under the coping
    "    float cd = abs(P.y - (FLOOR - 1.5));",
    "    emis += vec3(0.35, 0.95, 1.0) * (1.0 - smoothstep(0.05, 0.1, cd)) * 1.4;",
    "    float sm = abs(P.y - (TOP + 1.3));",
    "    emis += vec3(0.35, 0.9, 1.0) * (1.0 - smoothstep(0.03, 0.07, sm)) * 0.6;",
    "  } else if (m < 1.5) {",                                                   // floor
    "    alb = vec3(0.1, 0.11, 0.14) * tint * (0.7 + 0.4 * grime); rough = 0.5 + 0.4 * grime; metal = 0.5;",
    // light strips in the floor, pulses streaming toward you
    "    float lanes = min(min(abs(P.x - HALF * 0.5), abs(P.x + HALF * 0.5)), abs(P.x));",
    "    float strip = 1.0 - smoothstep(0.05, 0.11, lanes);",
    "    float pulse = pow(fract((P.z + uT * 90.0 * uMotion) / 48.0), 6.0);",
    "    emis += vec3(0.3, 0.85, 1.0) * strip * (0.35 + 2.2 * pulse);",
    "  } else if (m < 2.5) {",                                                   // deck beyond the rim
    "    alb = vec3(0.2, 0.21, 0.26) * tint * (0.8 + 0.3 * grime); rough = 0.5;",
    "  } else if (m < 3.5) {",                                                   // structure
    "    alb = vec3(0.16, 0.17, 0.22) * tint; rough = 0.4;",
    "  } else if (m < 4.5) {",                                                   // hatch
    "    alb = vec3(0.1, 0.11, 0.14) * tint; rough = 0.6;",
    "  } else if (m < 5.5) {",                                                   // grate: slats over a glow
    "    float sl = step(0.5, fract(P.z * 1.6));",
    "    alb = vec3(0.05, 0.06, 0.08) + vec3(0.1) * sl; rough = 0.7;",
    "    emis += vec3(0.15, 0.55, 0.7) * (1.0 - sl) * 0.5;",
    "  } else if (m < 6.5) {",                                                   // tower, with lit windows
    "    alb = vec3(0.13, 0.14, 0.18) * tint; rough = 0.45;",
    "    vec2 wq = vec2(P.z * 1.4 + P.x * 1.4, P.y * 0.8);",
    "    vec2 wc = floor(wq); vec2 wf = fract(wq);",
    "    float win = step(0.25, wf.x) * step(wf.x, 0.75) * step(0.3, wf.y) * step(wf.y, 0.7);",
    "    float on = step(0.55, h2(wc + seed * 13.0));",
    "    emis += mix(vec3(0.45, 1.0, 0.92), vec3(1.0, 0.8, 0.4), step(0.8, h2(wc + 5.0))) * win * on * 1.3;",
    "  } else if (m < 7.5) {",                                                   // lamp
    "    alb = vec3(0.1); emis = vec3(0.32, 1.0, 0.9) * (seed > 0.5 ? 0.9 : 1.6);",
    "  } else if (m < 8.5) {",                                                   // warning light, slow blink
    "    alb = vec3(0.1); emis = vec3(1.0, 0.2, 0.25) * 3.0 * step(0.0, sin(uT * 3.0 + seed * 20.0) + 0.2);",
    "  } else if (m < 9.5) {",                                                   // gold lamp
    "    alb = vec3(0.1); emis = vec3(1.0, 0.8, 0.4) * 2.6 * (0.6 + 0.4 * sin(uT * 4.0 + seed * 9.0));",
    "  } else if (m < 10.5) {",                                                  // a barrier: blast-door steel, painted
    "    alb = vec3(0.42, 0.07, 0.14) * tint * (0.7 + 0.4 * grime); metal = 0.55; rough = 0.35 + 0.4 * grime;",
    "  } else if (m < 11.5) {",                                                  // hazard stripes round the opening
    "    float st = step(0.5, fract((P.x + P.y) * 0.85));",
    "    alb = mix(vec3(0.95, 0.7, 0.1), vec3(0.03), st); metal = 0.3; rough = 0.5;",
    "  } else if (m < 12.5) {",                                                  // the opening's edge: you fit
    "    alb = vec3(0.1); emis = vec3(0.55, 1.0, 0.72) * 3.4;",
    "  } else if (m < 13.5) {",                                                  // the opening's edge: you do not
    "    alb = vec3(0.1); emis = vec3(1.0, 0.22, 0.48) * (3.0 + 1.2 * sin(uT * 18.0));",
    "  } else if (m < 14.5) {",                                                  // a barrier you already hit
    "    alb = vec3(0.16, 0.16, 0.19); metal = 0.6;",
    "  } else if (m < 15.5) {",                                                  // a girder
    "    alb = vec3(0.3, 0.26, 0.42) * tint; rough = 0.35;",
    "  } else if (m < 16.5) {",                                                  // a girder in your path
    "    alb = vec3(0.4, 0.1, 0.2) * tint; emis = vec3(1.0, 0.2, 0.45) * 0.5;",
    "  } else if (m < 17.5) {",                                                  // a gun housing
    "    alb = vec3(0.2, 0.2, 0.24) * tint; rough = 0.3;",
    "  } else if (m < 18.5) {",                                                  // a gun's eye: gold, red as it charges
    "    alb = vec3(0.1); emis = mix(vec3(1.0, 0.8, 0.35), vec3(1.0, 0.18, 0.45), seed) * (2.6 + seed * 2.4);",
    "  } else if (m < 19.5) {",                                                  // your hull
    "    alb = vec3(0.72, 0.76, 0.84); metal = 0.7; rough = 0.25;",
    "  } else if (m < 20.5) {",                                                  // your engines
    "    alb = vec3(0.1); emis = mix(vec3(0.45, 0.9, 1.0), vec3(1.0, 0.3, 0.5), seed) * 4.0;",
    "  } else {",                                                                // canopy
    "    alb = vec3(0.04, 0.08, 0.12); metal = 0.9; rough = 0.08;",
    "  }",
    "  vec3 col = lightAll(P, N, V, alb, metal, rough, inT);",
    // everything behind the blast front blazes
    "  if (uShock.y > 0.0) {",
    "    float bz = uShock.x - P.z;",
    "    if (bz > -40.0) col += vec3(1.0, 0.72, 0.4) * uShock.y * exp(-max(bz, 0.0) / 500.0) * (bz < 60.0 ? 2.5 : 1.0);",
    "  }",
    "  float fog = 1.0 - exp(-vDz * 0.0055);",
    "  col = mix(col, vec3(0.012, 0.018, 0.045), fog);",
    "  col += emis * (1.0 - fog * 0.6);",
    "  col *= 0.95;",
    "  col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);",
    "  col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));",
    "  float a = 1.0 - smoothstep(uFar * 0.82, uFar, vDz);",
    "  gl_FragColor = vec4(col * a, a);",
    "}"
  ].join("\n");

  var QVS = [
    "attribute vec2 aQ;",
    "varying vec2 vUv;",
    "void main(){ vUv = aQ * 0.5 + 0.5; gl_Position = vec4(aQ, 0.0, 1.0); }"
  ].join("\n");

  var BRIGHT = [
    "precision mediump float;",
    "varying vec2 vUv;",
    "uniform sampler2D uTex;",
    "uniform vec2 uPx;",
    "void main(){",
    // a 4-tap box on the way down, so thin bright lines are not lost
    "  vec3 c = texture2D(uTex, vUv + uPx * vec2(-0.5, -0.5)).rgb + texture2D(uTex, vUv + uPx * vec2(0.5, -0.5)).rgb",
    "         + texture2D(uTex, vUv + uPx * vec2(-0.5, 0.5)).rgb + texture2D(uTex, vUv + uPx * vec2(0.5, 0.5)).rgb;",
    "  c *= 0.25;",
    "  float b = max(c.r, max(c.g, c.b));",
    "  gl_FragColor = vec4(c * smoothstep(0.52, 0.92, b), 1.0);",
    "}"
  ].join("\n");

  var BLUR = [
    "precision mediump float;",
    "varying vec2 vUv;",
    "uniform sampler2D uTex;",
    "uniform vec2 uDir;",
    "void main(){",
    "  vec3 c = texture2D(uTex, vUv).rgb * 0.227;",
    "  c += (texture2D(uTex, vUv + uDir * 1.385).rgb + texture2D(uTex, vUv - uDir * 1.385).rgb) * 0.316;",
    "  c += (texture2D(uTex, vUv + uDir * 3.231).rgb + texture2D(uTex, vUv - uDir * 3.231).rgb) * 0.07;",
    "  gl_FragColor = vec4(c, 1.0);",
    "}"
  ].join("\n");

  var COMP = [
    "precision mediump float;",
    "varying vec2 vUv;",
    "uniform sampler2D uScene;",
    "uniform sampler2D uB1;",
    "uniform sampler2D uB2;",
    "uniform vec2 uAspect;",
    "uniform float uT;",
    "uniform float uGrain;",
    "float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }",
    "void main(){",
    "  vec2 c = vUv - 0.5;",
    "  float r = length(c * uAspect);",
    // a whisper of lens fringing toward the edges
    "  vec2 ca = c * 0.0028 * r;",
    "  vec4 s = texture2D(uScene, vUv);",
    "  float sr = texture2D(uScene, vUv + ca).r, sb = texture2D(uScene, vUv - ca).b;",
    "  vec3 col = vec3(sr, s.g, sb);",
    "  vec3 bl = texture2D(uB1, vUv).rgb * 0.95 + texture2D(uB2, vUv).rgb * 0.75;",
    "  col += bl;",
    "  col *= mix(1.0, 0.7, smoothstep(0.45, 1.05, r));",
    "  col += (h(vUv * 911.0 + uT) - 0.5) * uGrain * s.a;",
    "  float a = clamp(s.a + dot(bl, vec3(0.3)) * 0.85, 0.0, 1.0);",
    "  gl_FragColor = vec4(col, a);",
    "}"
  ].join("\n");

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      try { console.error("trench cinematic shader:", gl.getShaderInfoLog(s)); } catch (e) {}
      return null;
    }
    return s;
  }
  function program(vs, fs, attrs) {
    var v = compile(gl.VERTEX_SHADER, vs), f = compile(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    var p = gl.createProgram();
    gl.attachShader(p, v); gl.attachShader(p, f);
    attrs.forEach(function (a, i) { gl.bindAttribLocation(p, i, a); });
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      try { console.error("trench cinematic link:", gl.getProgramInfoLog(p)); } catch (e) {}
      return null;
    }
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) {
      var info = gl.getActiveUniform(p, i), name = info.name.replace(/\[0\]$/, "");
      u[name] = gl.getUniformLocation(p, info.name);
    }
    return { p: p, u: u };
  }

  /* ----------------------------------------------------------- geometry */

  // 8 floats a vertex: position, normal, material, seed
  function Builder(cap) { this.a = new Float32Array(cap * 8); this.n = 0; }
  Builder.prototype.grow = function (need) {
    if ((this.n + need) * 8 <= this.a.length) return;
    var b = new Float32Array(Math.max(this.a.length * 2, (this.n + need) * 8));
    b.set(this.a.subarray(0, this.n * 8)); this.a = b;
  };
  Builder.prototype.v = function (x, y, z, nx, ny, nz, m, s) {
    var a = this.a, o = this.n * 8;
    a[o] = x; a[o + 1] = y; a[o + 2] = z; a[o + 3] = nx; a[o + 4] = ny; a[o + 5] = nz; a[o + 6] = m; a[o + 7] = s;
    this.n++;
  };
  // a quad from four corners, one flat normal
  Builder.prototype.quad = function (p, nx, ny, nz, m, s) {
    this.grow(6);
    var o = [0, 1, 2, 0, 2, 3];
    for (var i = 0; i < 6; i++) { var q = p[o[i]]; this.v(q[0], q[1], q[2], nx, ny, nz, m, s); }
  };
  Builder.prototype.box = function (x0, x1, y0, y1, z0, z1, m, s) {
    if (x1 < x0) { var t = x0; x0 = x1; x1 = t; }
    if (y1 < y0) { t = y0; y0 = y1; y1 = t; }
    if (z1 < z0) { t = z0; z0 = z1; z1 = t; }
    this.quad([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], 0, 0, -1, m, s);   // front
    this.quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], 0, 0, 1, m, s);    // back
    this.quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], -1, 0, 0, m, s);   // left
    this.quad([[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], 1, 0, 0, m, s);    // right
    this.quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], 0, -1, 0, m, s);   // top (y is down)
    this.quad([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], 0, 1, 0, m, s);    // underside
  };
  Builder.prototype.tri = function (a, b, c, m, s) {
    var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    this.grow(3);
    this.v(a[0], a[1], a[2], nx / l, ny / l, nz / l, m, s);
    this.v(b[0], b[1], b[2], nx / l, ny / l, nz / l, m, s);
    this.v(c[0], c[1], c[2], nx / l, ny / l, nz / l, m, s);
  };

  /* The canal itself: a slab every RIB_GAP, and everything that stands in or
   * on it, all from hash(n) exactly as the neon drawTrench() places it. */
  function buildStatic() {
    var HALF = K.HALF, FLOOR = K.FLOOR, TOP = K.TOP, MIDY = K.MIDY, G8 = K.RIB_GAP, hash = K.hash;
    var DECK = 14;
    var b = new Builder(90000);
    var n0 = -8, n1 = Math.ceil((K.RUN_LEN + K.FAR + 120) / G8);
    slabBase = n0; slabFirst = [];
    for (var n = n0; n <= n1; n++) {
      slabFirst.push(b.n);
      var z0 = n * G8, z1 = z0 + G8, zs = z0 + G8 * 0.5, s = hash(n, 1);
      b.quad([[-HALF, FLOOR, z0], [HALF, FLOOR, z0], [HALF, FLOOR, z1], [-HALF, FLOOR, z1]], 0, -1, 0, 1, s);
      b.quad([[-HALF, TOP, z0], [-HALF, TOP, z1], [-HALF, FLOOR, z1], [-HALF, FLOOR, z0]], 1, 0, 0, 0, s);
      b.quad([[HALF, TOP, z0], [HALF, TOP, z1], [HALF, FLOOR, z1], [HALF, FLOOR, z0]], -1, 0, 0, 0, s);
      b.quad([[-HALF - DECK, TOP, z0], [-HALF, TOP, z0], [-HALF, TOP, z1], [-HALF - DECK, TOP, z1]], 0, -1, 0, 2, s);
      b.quad([[HALF, TOP, z0], [HALF + DECK, TOP, z0], [HALF + DECK, TOP, z1], [HALF, TOP, z1]], 0, -1, 0, 2, s);

      // wall lamps every fourth rib
      if (((n % 4) + 4) % 4 === 0) {
        for (var sl = -1; sl <= 1; sl += 2) {
          b.box(sl * HALF, sl * (HALF - 0.14), MIDY - 0.9, MIDY + 0.9, z0 - 0.22, z0 + 0.22, M.LAMP, 0);
        }
      }
      // piers down both walls every third slab, with a raked foot
      if (((n % 3) + 3) % 3 === 0) {
        for (var sd = -1; sd <= 1; sd += 2) {
          b.box(sd * HALF, sd * (HALF - 0.45), TOP, FLOOR, zs - 0.8, zs + 0.8, M.STEEL, s);
          b.box(sd * HALF, sd * (HALF - 1.25), FLOOR - 1.6, FLOOR, zs - 0.8, zs + 0.8, M.STEEL, s);
        }
      }
      // a service hatch between piers, its lamp lit
      var hh = hash(n, 2);
      if (((n % 3) + 3) % 3 !== 0 && hh < 0.3) {
        var hs = hh < 0.15 ? -1 : 1, hy0 = TOP + 2.2 + hash(n, 3) * 2.5, hy1 = hy0 + 1.8 + hash(n, 4) * 1.6;
        b.box(hs * HALF, hs * (HALF - 0.1), hy0, hy1, zs - 2.2, zs + 2.2, M.HATCH, s);
        b.box(hs * HALF, hs * (HALF - 0.16), hy0 - 0.55, hy0 - 0.25, zs - 0.18, zs + 0.18, hash(n, 5) < 0.5 ? M.GOLD : M.LAMP, n % 7);
      }
      // floor grating in one of the lanes
      var gh = hash(n, 6);
      if (gh < 0.4) {
        var gx0 = -HALF + 1 + Math.floor(gh * 10) % 4 * (HALF * 0.45), gx1 = gx0 + HALF * 0.38;
        b.quad([[gx0, FLOOR - 0.01, zs - 3], [gx1, FLOOR - 0.01, zs - 3], [gx1, FLOOR - 0.01, zs + 3], [gx0, FLOOR - 0.01, zs + 3]], 0, -1, 0, M.GRATE, s);
      }
      // on the rim: housings, and now and then a tower
      for (var side = -1; side <= 1; side += 2) {
        var rh = hash(n, 10 + side);
        if (rh < 0.34) {
          var bx0 = side * (HALF + 0.2), bx1 = side * (HALF + 1.4 + hash(n, 12 + side) * 1.6);
          var bh = 0.7 + hash(n, 14 + side) * 1.6;
          b.box(bx0, bx1, TOP - bh, TOP, zs - 1.5, zs + 1.5 + rh * 4, M.STEEL, s);
        } else if (rh > 0.93) {
          var xin = side * (HALF + 2.4 + hash(n, 20) * 3), xout = xin + side * (2.2 + hash(n, 21) * 3.5);
          var th = 4 + Math.pow(hash(n, 22), 1.6) * 15, tz0 = zs - 2, tz1 = zs + 3 + hash(n, 23) * 6;
          b.box(xin, xout, TOP - th, TOP + 0.6, tz0, tz1, M.TOWER, n % 11);
          var xm = (xin + xout) / 2, mh = 2.5 + hash(n, 24) * 3;
          b.box(xm - 0.08, xm + 0.08, TOP - th - mh, TOP - th, tz0 + 0.4, tz0 + 0.56, M.STEEL, s);
          b.box(xm - 0.22, xm + 0.22, TOP - th - mh - 0.4, TOP - th - mh, tz0 + 0.3, tz0 + 0.7, M.RED, n % 13);
        }
      }
      // a truss spanning the canal, landing on pier blocks on the coping
      if (((n % 17) + 17) % 17 === 5) {
        var y1 = TOP - 0.5, y0 = TOP - 2.3, xl = -HALF - 0.3, xr = HALF + 0.3;
        b.box(xl, xr, y1 - 0.22, y1, zs - 0.7, zs + 0.7, M.STEEL, s);
        b.box(xl, xr, y0, y0 + 0.22, zs - 0.7, zs + 0.7, M.STEEL, s);
        for (var k = 0; k < 8; k++) {
          var xa = xl + (xr - xl) * k / 8, xb = xl + (xr - xl) * (k + 1) / 8;
          var ya = k % 2 ? y0 : y1, yb = k % 2 ? y1 : y0;
          // a diagonal as a thin skewed plate, front and back
          for (var zz = -1; zz <= 1; zz += 2) {
            var zf = zs + zz * 0.62;
            b.quad([[xa, ya, zf], [xa + 0.25, ya, zf], [xb + 0.25, yb, zf], [xb, yb, zf]], 0, 0, zz, M.STEEL, s);
          }
        }
        b.box(xl + 1.5, xr - 1.5, y1 + 0.0, y1 + 0.04, zs - 0.12, zs + 0.12, M.LAMP, 1);
        for (var sp = -1; sp <= 1; sp += 2) {
          b.box(sp * (HALF + 0.3), sp * (HALF + 2.8), y0 - 1.1, TOP, zs - 1.4, zs + 1.4, M.STEEL, s);
          b.box(sp * (HALF + 0.3), sp * (HALF + 0.45), y0 - 0.75, y0 - 0.45, zs - 0.2, zs + 0.2, M.LAMP, 0);
        }
      }
    }
    slabFirst.push(b.n);
    staticCount = b.n;
    staticBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, staticBuf);
    gl.bufferData(gl.ARRAY_BUFFER, b.a.subarray(0, b.n * 8), gl.STATIC_DRAW);
  }

  /* Your ship: a low, swept fighter seen from behind and a little above. Built
   * once in model space; placed and banked per frame on the CPU (it is tiny). */
  var SHIP = null;
  function buildShip() {
    var b = new Builder(400), T = function (a, c, d, m) { b.tri(a, c, d, m === undefined ? M.HULL : m, 0); };
    var nose = [0, 0.02, 1.55], top = [0, -0.3, -0.1], bot = [0, 0.2, -0.1], l = [-0.34, 0, -0.1], r = [0.34, 0, -0.1];
    var tt = [0, -0.22, -1.05], tb = [0, 0.14, -1.05], tl = [-0.26, 0, -1.05], tr = [0.26, 0, -1.05];
    // nose cone
    T(nose, top, l); T(nose, r, top); T(nose, l, bot); T(nose, bot, r);
    // body
    T(top, tt, tl); T(top, tl, l); T(top, r, tr); T(top, tr, tt);
    T(bot, tl, tb); T(bot, l, tl); T(bot, tb, tr); T(bot, tr, r);
    // tail cap: the engine face
    T(tt, tr, tb, M.ENGINE); T(tt, tb, tl, M.ENGINE);
    // wings: swept, thin, a little dihedral
    [-1, 1].forEach(function (s) {
      var root0 = [s * 0.32, -0.02, 0.35], root1 = [s * 0.3, -0.02, -0.95], tip0 = [s * 1.32, -0.14, -0.62], tip1 = [s * 1.32, -0.12, -1.02];
      var rootU0 = [s * 0.32, 0.05, 0.35], rootU1 = [s * 0.3, 0.05, -0.95], tipU0 = [s * 1.32, -0.08, -0.62], tipU1 = [s * 1.32, -0.07, -1.02];
      T(root0, tip0, tip1); T(root0, tip1, root1);
      T(rootU0, tipU1, tipU0); T(rootU0, rootU1, tipU1);
      T(root0, rootU0, tipU0); T(root0, tipU0, tip0);
      // wingtip fins
      T([s * 1.32, -0.12, -0.62], [s * 1.32, -0.12, -1.02], [s * 1.34, -0.46, -1.0]);
      // engine pods under the wing roots
      var px0 = s * 0.62, px1 = s * 0.86;
      T([px0, 0.02, -0.4], [px1, 0.02, -0.4], [px1, 0.02, -1.12]); T([px0, 0.02, -0.4], [px1, 0.02, -1.12], [px0, 0.02, -1.12]);
      T([px0, 0.24, -0.4], [px1, 0.24, -1.12], [px1, 0.24, -0.4]); T([px0, 0.24, -0.4], [px0, 0.24, -1.12], [px1, 0.24, -1.12]);
      T([px0, 0.02, -1.12], [px1, 0.02, -1.12], [px1, 0.24, -1.12], M.ENGINE); T([px0, 0.02, -1.12], [px1, 0.24, -1.12], [px0, 0.24, -1.12], M.ENGINE);
    });
    // canopy
    T([0, -0.27, 0.45], [-0.14, -0.2, -0.1], [0, -0.36, -0.2], M.GLASS);
    T([0, -0.27, 0.45], [0, -0.36, -0.2], [0.14, -0.2, -0.1], M.GLASS);
    SHIP = b.a.slice(0, b.n * 8);
  }

  /* ----------------------------------------------------------- targets */

  function makeTex(w, h) {
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function makeTarget(w, h, depth) {
    var t = { w: w, h: h, tex: makeTex(w, h), fb: gl.createFramebuffer() };
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
    if (depth) {
      t.rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, t.rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, t.rb);
    }
    return t;
  }
  function freeTarget(t) {
    if (!t) return;
    if (t.tex) gl.deleteTexture(t.tex);
    if (t.fb) gl.deleteFramebuffer(t.fb);
    if (t.rb) gl.deleteRenderbuffer(t.rb);
    if (t.crb) gl.deleteRenderbuffer(t.crb);
  }
  function buildTargets() {
    ["scene", "ms", "a", "b", "c", "d"].forEach(function (k) { freeTarget(fb[k]); fb[k] = null; });
    fb.scene = makeTarget(RW, RH, !gl2);
    if (gl2) {
      // multisampled scene, resolved into the scene texture: clean edges on metal
      var samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) || 0);
      if (samples > 1) {
        var m = { fb: gl.createFramebuffer(), crb: gl.createRenderbuffer(), rb: gl.createRenderbuffer() };
        gl.bindFramebuffer(gl.FRAMEBUFFER, m.fb);
        gl.bindRenderbuffer(gl.RENDERBUFFER, m.crb);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, RW, RH);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, m.crb);
        gl.bindRenderbuffer(gl.RENDERBUFFER, m.rb);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, RW, RH);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, m.rb);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) fb.ms = m;
      }
      if (!fb.ms) {
        freeTarget(fb.scene);
        fb.scene = makeTarget(RW, RH, true);
      }
    }
    var qw = Math.max(1, Math.round(RW / 4)), qh = Math.max(1, Math.round(RH / 4));
    fb.a = makeTarget(qw, qh, false); fb.b = makeTarget(qw, qh, false);
    var ew = Math.max(1, Math.round(RW / 8)), eh = Math.max(1, Math.round(RH / 8));
    fb.c = makeTarget(ew, eh, false); fb.d = makeTarget(ew, eh, false);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /* ------------------------------------------------------------- public */

  function init(canvas, consts) {
    cv = canvas; K = consts;
    var opts = { alpha: true, premultipliedAlpha: true, antialias: false, depth: true, stencil: false, powerPreference: "high-performance" };
    try { gl = cv.getContext("webgl2", opts); gl2 = !!gl; } catch (e) { gl = null; }
    if (!gl) { try { gl = cv.getContext("webgl", opts) || cv.getContext("experimental-webgl", opts); } catch (e) { gl = null; } }
    if (!gl) return false;
    progScene = program(VS, FS, ["aP", "aN", "aM"]);
    progBright = program(QVS, BRIGHT, ["aQ"]);
    progBlur = program(QVS, BLUR, ["aQ"]);
    progComp = program(QVS, COMP, ["aQ"]);
    if (!progScene || !progBright || !progBlur || !progComp) return false;
    buildStatic();
    buildShip();
    dyn = new Builder(6000);
    dynBuf = gl.createBuffer();
    quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    ok = true;
    return true;
  }

  function resize(w, h, scale) {
    if (!ok) return;
    W = w; H = h; SC = scale;
    RW = Math.max(2, Math.round(w * scale)); RH = Math.max(2, Math.round(h * scale));
    cv.width = RW; cv.height = RH;
    buildTargets();
  }

  function bindGeom(buf) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
  }
  function bindQuad() {
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2);
  }
  function pass(prog, target, setup) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
    gl.viewport(0, 0, target ? target.w : RW, target ? target.h : RH);
    gl.useProgram(prog.p);
    setup(prog.u);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  function tex(unit, t, loc) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(loc, unit);
  }

  /* Everything that moves, rebuilt each frame: the barriers, girders and guns
   * in view, and your ship. */
  function buildDynamic(S) {
    var b = dyn, HALF = K.HALF, FLOOR = K.FLOOR, TOP = K.TOP, i;
    b.n = 0;
    var zMin = S.cam.z + 1.5, zMax = S.cam.z + K.FAR + 10, BT = 0.7;
    for (i = 0; i < S.bars.length; i++) {
      var r = S.bars[i];
      if (r.z < zMin || r.z > zMax) continue;
      var slab = r.hit ? M.SPENT : M.SLAB;
      var edge = r.hit ? M.SPENT : (r.clear ? M.SAFE : M.BAD);
      var gaps;
      if (r.pillar) {
        b.box(r.gapA[1], r.gapB[0], r.y0, r.y1, r.z - BT, r.z + BT, slab, 0);
        if (r.y0 > TOP) b.box(-HALF, HALF, TOP, r.y0, r.z - BT, r.z + BT, slab, 0);
        if (r.y1 < FLOOR) b.box(-HALF, HALF, r.y1, FLOOR, r.z - BT, r.z + BT, slab, 0);
        gaps = [[r.gapA[0], r.gapA[1], r.y0, r.y1], [r.gapB[0], r.gapB[1], r.y0, r.y1]];
      } else {
        if (r.x0 > -HALF) b.box(-HALF, r.x0, TOP, FLOOR, r.z - BT, r.z + BT, slab, 0);
        if (r.x1 < HALF) b.box(r.x1, HALF, TOP, FLOOR, r.z - BT, r.z + BT, slab, 0);
        if (r.y0 > TOP) b.box(Math.max(-HALF, r.x0), Math.min(HALF, r.x1), TOP, r.y0, r.z - BT, r.z + BT, slab, 0);
        if (r.y1 < FLOOR) b.box(Math.max(-HALF, r.x0), Math.min(HALF, r.x1), r.y1, FLOOR, r.z - BT, r.z + BT, slab, 0);
        gaps = [[r.x0, r.x1, r.y0, r.y1]];
      }
      // round every opening: hazard stripes, and a lit edge that says whether you fit
      for (var g = 0; g < gaps.length; g++) {
        var q = gaps[g], sw = 0.42, ew = 0.1, zf = r.z - BT - 0.02;
        var fx0 = q[0], fx1 = q[1], fy0 = q[2], fy1 = q[3];
        b.box(fx0 - sw, fx1 + sw, fy0 - sw, fy0, zf - 0.08, zf, r.hit ? M.SPENT : M.STRIPE, 0);
        b.box(fx0 - sw, fx1 + sw, fy1, fy1 + sw, zf - 0.08, zf, r.hit ? M.SPENT : M.STRIPE, 0);
        b.box(fx0 - sw, fx0, fy0, fy1, zf - 0.08, zf, r.hit ? M.SPENT : M.STRIPE, 0);
        b.box(fx1, fx1 + sw, fy0, fy1, zf - 0.08, zf, r.hit ? M.SPENT : M.STRIPE, 0);
        b.box(fx0 - ew, fx1 + ew, fy0 - ew, fy0, zf - 0.14, zf - 0.08, edge, 0);
        b.box(fx0 - ew, fx1 + ew, fy1, fy1 + ew, zf - 0.14, zf - 0.08, edge, 0);
        b.box(fx0 - ew, fx0, fy0, fy1, zf - 0.14, zf - 0.08, edge, 0);
        b.box(fx1, fx1 + ew, fy0, fy1, zf - 0.14, zf - 0.08, edge, 0);
      }
    }
    for (i = 0; i < S.props.length; i++) {
      var p = S.props[i];
      if (p.dead || p.z < zMin || p.z > zMax) continue;
      b.box(p.x0, p.x1, p.y0, p.y1, p.z - 0.45, p.z + 0.45, M.PROP, 0);
    }
    for (i = 0; i < S.turrets.length; i++) {
      var t = S.turrets[i];
      if (t.dead || t.z < zMin || t.z > zMax) continue;
      var ch = Math.max(0, Math.min(1, t.charge || 0));
      if (t.face) {
        var wx = -t.face * HALF, ix = t.x + t.face * 0.45;
        b.box(wx, ix, t.y - 0.75, t.y + 0.75, t.z - 0.75, t.z + 0.75, M.TURRET, 0);
        b.box(ix, ix + t.face * 1.25, t.y - 0.12, t.y + 0.12, t.z - 0.12, t.z + 0.12, M.STEEL, 0);
        b.box(ix, ix + t.face * 0.08, t.y - 0.34, t.y + 0.34, t.z - 0.34, t.z + 0.34, M.EYE, ch);
      } else {
        b.box(t.x - 0.75, t.x + 0.75, t.y - 0.45, FLOOR, t.z - 0.75, t.z + 0.75, M.TURRET, 0);
        b.box(t.x - 0.34, t.x + 0.34, t.y - 0.53, t.y - 0.45, t.z - 0.34, t.z + 0.34, M.EYE, ch);
      }
    }
    if (S.ship && S.ship.show) {
      var sp = S.ship, c = Math.cos(sp.bank), s = Math.sin(sp.bank), k = 0.42;
      var pc = Math.cos(-0.2), ps = Math.sin(-0.2);      // nose a touch down, so you see its back
      var hot = sp.hot ? 1 : 0;
      b.grow(SHIP.length / 8);
      for (i = 0; i < SHIP.length; i += 8) {
        var mx = SHIP[i] * k, my = SHIP[i + 1] * k, mz = SHIP[i + 2] * k;
        var ny0 = my * pc - mz * ps, nz0 = my * ps + mz * pc;
        var rx = mx * c - ny0 * s, ry = mx * s + ny0 * c;
        var nx = SHIP[i + 3], ny = SHIP[i + 4], nz = SHIP[i + 5];
        var nny = ny * pc - nz * ps, nnz = ny * ps + nz * pc;
        var rnx = nx * c - nny * s, rny = nx * s + nny * c;
        b.v(sp.x + rx, sp.y + ry, sp.z + nz0, rnx, rny, nnz, SHIP[i + 6], SHIP[i + 6] === M.ENGINE ? hot : 0);
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, dynBuf);
    gl.bufferData(gl.ARRAY_BUFFER, b.a.subarray(0, b.n * 8), gl.DYNAMIC_DRAW);
    return b.n;
  }

  var lp = new Float32Array(32), lc = new Float32Array(32);
  function render(S) {
    if (!ok || !RW) return;
    var dcount = buildDynamic(S);
    var target = fb.ms || fb.scene;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
    gl.viewport(0, 0, RW, RH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    var u = progScene.u;
    gl.useProgram(progScene.p);
    gl.uniform3f(u.uCam, S.cam.x, S.cam.y, S.cam.z);
    gl.uniform4f(u.uView, S.focal * SC, S.cx * SC, S.cy * SC, S.roll);
    gl.uniform2f(u.uRes, RW, RH);
    gl.uniform2f(u.uShake, S.shakeX * SC, S.shakeY * SC);
    gl.uniform3f(u.uTear, S.shockZ || 0, S.tear ? 1 : 0, K.MIDY);
    gl.uniform1f(u.uT, S.t);
    gl.uniform1f(u.uFar, K.FAR + 20);
    gl.uniform2f(u.uShock, S.shockZ || 0, S.shockGlow || 0);
    gl.uniform1f(u.uMotion, S.motion);
    for (var i = 0; i < 8; i++) {
      var L = S.lights[i];
      if (L) { lp[i * 4] = L.x; lp[i * 4 + 1] = L.y; lp[i * 4 + 2] = L.z; lp[i * 4 + 3] = L.r; lc[i * 4] = L.c[0]; lc[i * 4 + 1] = L.c[1]; lc[i * 4 + 2] = L.c[2]; lc[i * 4 + 3] = L.i; }
      else { lc[i * 4 + 3] = 0; }
    }
    gl.uniform4fv(u.uLP, lp);
    gl.uniform4fv(u.uLC, lc);

    // the canal: only the slabs in view
    var a = Math.max(0, Math.floor((S.cam.z - 2) / K.RIB_GAP) - slabBase - 1);
    var z = Math.min(slabFirst.length - 1, Math.ceil((S.cam.z + K.FAR + 30) / K.RIB_GAP) - slabBase + 1);
    if (z > a) {
      bindGeom(staticBuf);
      gl.drawArrays(gl.TRIANGLES, slabFirst[a], slabFirst[z] - slabFirst[a]);
    }
    if (dcount) { bindGeom(dynBuf); gl.drawArrays(gl.TRIANGLES, 0, dcount); }

    if (fb.ms) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb.ms.fb);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fb.scene.fb);
      gl.blitFramebuffer(0, 0, RW, RH, 0, 0, RW, RH, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }
    gl.disable(gl.DEPTH_TEST);
    bindQuad();
    // bloom: bright parts, blurred at a quarter and an eighth of the resolution
    pass(progBright, fb.a, function (u2) { tex(0, fb.scene.tex, u2.uTex); gl.uniform2f(u2.uPx, 1 / RW, 1 / RH); });
    pass(progBlur, fb.b, function (u2) { tex(0, fb.a.tex, u2.uTex); gl.uniform2f(u2.uDir, 1 / fb.a.w, 0); });
    pass(progBlur, fb.a, function (u2) { tex(0, fb.b.tex, u2.uTex); gl.uniform2f(u2.uDir, 0, 1 / fb.a.h); });
    pass(progBlur, fb.c, function (u2) { tex(0, fb.a.tex, u2.uTex); gl.uniform2f(u2.uDir, 1 / fb.a.w, 0); });
    pass(progBlur, fb.d, function (u2) { tex(0, fb.c.tex, u2.uTex); gl.uniform2f(u2.uDir, 1 / fb.c.w, 0); });
    pass(progBlur, fb.c, function (u2) { tex(0, fb.d.tex, u2.uTex); gl.uniform2f(u2.uDir, 0, 1 / fb.c.h); });
    pass(progComp, null, function (u2) {
      tex(0, fb.scene.tex, u2.uScene); tex(1, fb.a.tex, u2.uB1); tex(2, fb.c.tex, u2.uB2);
      gl.uniform2f(u2.uAspect, RW / RH, 1);
      gl.uniform1f(u2.uT, S.t % 100);
      gl.uniform1f(u2.uGrain, S.motion ? 0.03 : 0);
    });
  }

  window.TR_HIFI = {
    init: init,
    resize: resize,
    render: render,
    ready: function () { return ok; },
    canvas: function () { return cv; }
  };
})();
