/* Tossing Cards — No. 102, the FEEDER edition for tossingcards.com.
 *
 * Unlimited practice. The daily room, streaks and stats live on the game's own
 * site; there is deliberately no email capture here.
 *
 * The gameplay is PORTED VERBATIM from the real game's pure modules — rng,
 * deck, scoring, flick, projection, physics and the room builder. They were
 * already free of React, rAF and Math.random, so they transcribe directly, and
 * keeping them identical is the whole point: practice has to teach the throw
 * that works on the daily. If you change a constant here, change it there.
 *
 * What is NOT ported is the 2,300-line renderer. This draws the same sprites
 * (room, bowl, hand, props — carried over as WebP) with a leaner painter.
 *
 * localStorage: "tc_best" (best round), "tc_rounds", "tc_sound".
 */
(function () {
  "use strict";

  var TAU = Math.PI * 2;

  // ---------------------------------------------------------------- elements
  var canvas = document.getElementById("canvas");
  var ctx = canvas.getContext("2d");
  var hud = document.getElementById("hud");
  var scoreEl = document.getElementById("score");
  var roomNameEl = document.getElementById("roomName");
  var roomSubEl = document.getElementById("roomSub");
  var overlay = document.getElementById("overlay");
  var ovEyebrow = document.getElementById("ovEyebrow");
  var ovTitle = document.getElementById("ovTitle");
  var ovBody = document.getElementById("ovBody");
  var ovBtn = document.getElementById("ovBtn");
  var ovKeys = document.getElementById("ovKeys");
  var resultBox = document.getElementById("result");
  var resultGrid = document.getElementById("resultGrid");
  var resultLine = document.getElementById("resultLine");
  var hint = document.getElementById("hint");
  var soundBtn = document.getElementById("soundBtn");
  var dailyEl = document.getElementById("daily");
  var dailyTime = document.getElementById("dailyTime");
  var cta = document.getElementById("cta");
  var ctaLine = document.getElementById("ctaLine");
  var ctaBtn = document.getElementById("ctaBtn");

  var REDMO = false;
  try { REDMO = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

  // ===================================================== PORTED: rng.ts
  function hashString(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rngRange(rng, min, max) { return min + rng() * (max - min); }
  function rngInt(rng, min, maxInclusive) { return Math.floor(min + rng() * (maxInclusive - min + 1)); }
  function rngPick(rng, items) { return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]; }
  function shuffle(rng, items) {
    var out = items.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = out[i]; out[i] = out[j]; out[j] = tmp;
    }
    return out;
  }

  // ==================================================== PORTED: deck.ts
  var SUITS = ["spades", "hearts", "diamonds", "clubs"];
  var RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  var SUIT_GLYPH = { spades: "♠", hearts: "♥", diamonds: "♦", clubs: "♣" };
  function isRed(suit) { return suit === "hearts" || suit === "diamonds"; }
  function cardValue(card) {
    if (card.rank === "A") return 11;
    if (card.rank === "J" || card.rank === "Q" || card.rank === "K") return 10;
    return parseInt(card.rank, 10);
  }
  function fullDeck() {
    var deck = [];
    for (var s = 0; s < SUITS.length; s++) for (var r = 0; r < RANKS.length; r++) deck.push({ rank: RANKS[r], suit: SUITS[s] });
    return deck;
  }
  function dealRound(rng, count) { return shuffle(rng, fullDeck()).slice(0, count || 10); }

  // ================================================= PORTED: scoring.ts
  var ROUND_SIZE = 10;
  var PERFECT_BONUS = 25;
  function pointsFor(card, outcome) {
    var value = cardValue(card);
    if (outcome === "in") return value;
    if (outcome === "rim") return Math.floor(value / 2);
    return 0;
  }
  function totalScore(throws) {
    var base = 0;
    for (var i = 0; i < throws.length; i++) base += throws[i].points;
    var allIn = throws.length === ROUND_SIZE && throws.every(function (t) { return t.outcome === "in"; });
    return base + (allIn ? PERFECT_BONUS : 0);
  }
  function cardsIn(throws) {
    return throws.filter(function (t) { return t.outcome === "in"; }).length;
  }

  // =================================================== PORTED: flick.ts
  var VELOCITY_WINDOW = 80;
  var SHAPE_WINDOW = 260;
  function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }
  function clamp01(v) { return clamp(v, 0, 1); }

  function recentSamples(samples, now, window_) {
    var out = [];
    for (var i = samples.length - 1; i >= 0; i--) {
      out.unshift(samples[i]);
      if (now - samples[i].t > window_) break;
    }
    return out;
  }

  function analyzeFlick(samples, now) {
    if (samples.length < 2) return null;
    var vel = recentSamples(samples, now, VELOCITY_WINDOW);
    var first = vel[0], last = vel[vel.length - 1];
    var dt = Math.max(16, last.t - first.t) / 1000;
    var vx = (last.x - first.x) / dt;
    var vy = (last.y - first.y) / dt;
    var speed = Math.hypot(vx, vy);
    if (speed < 60) return null;

    var shape = recentSamples(samples, now, SHAPE_WINDOW);
    var netX = shape[shape.length - 1].x - shape[0].x;
    var netY = shape[shape.length - 1].y - shape[0].y;
    var netSpeed = Math.hypot(netX, netY) || 1;
    var pathLen = 0, signedTurn = 0;
    for (var i = 1; i < shape.length; i++) {
      var ax = shape[i].x - shape[i - 1].x;
      var ay = shape[i].y - shape[i - 1].y;
      pathLen += Math.hypot(ax, ay);
      if (i >= 2) {
        var bx = shape[i - 1].x - shape[i - 2].x;
        var by = shape[i - 1].y - shape[i - 2].y;
        var cross = bx * ay - by * ax;
        var mag = Math.hypot(ax, ay) * Math.hypot(bx, by);
        if (mag > 1) signedTurn += cross / mag;
      }
    }
    var netLen = Math.hypot(netX, netY);
    var straightness = pathLen > 1 ? clamp01(netLen / pathLen) : 0;
    var curve = clamp(signedTurn / Math.max(1, shape.length - 2), -1, 1);
    var releaseWeight = 0.66;
    var dirX = (vx / speed) * releaseWeight + (netX / netSpeed) * (1 - releaseWeight);
    var dirY = (vy / speed) * releaseWeight + (netY / netSpeed) * (1 - releaseWeight);
    var dirLen = Math.hypot(dirX, dirY) || 1;
    return { speed: speed, dx: dirX / dirLen, dy: dirY / dirLen, straightness: straightness, curve: curve };
  }

  function flickToThrow(flick, refPx) {
    var norm = flick.speed / Math.max(600, refPx * 3.2);
    var power = clamp(norm, 0.2, 1.05);
    var speed = 6.5 + power * 8.5;
    var lateral = clamp(flick.dx, -0.85, 0.85);
    var aimX = lateral * (1.55 + power * 1.18);
    var cleanliness = clamp01((flick.straightness - 0.62) / 0.35);
    var quick = clamp01((flick.speed - 500) / 2200);
    var spin = clamp01(cleanliness * 0.75 + quick * 0.45 * cleanliness + 0.05);
    var curve = clamp(flick.curve * 3.4, -1, 1) * (0.35 + spin * 0.65);
    return { speed: speed, aimX: aimX, spin: spin, curve: curve };
  }

  // ============================================== PORTED: projection.ts
  var ROOM_DEPTH = 13;
  var ROOM_HALF_WIDTH = 2.6;
  function makeCamera(width, height) {
    var focal = height * 1.02;
    var farScale = focal / ROOM_DEPTH;
    return {
      width: width, height: height, focal: focal,
      horizon: height * (width > 720 ? 0.32 : 0.3),
      eyeY: 1.35, cx: width / 2,
      roomHalfWidth: Math.max(ROOM_HALF_WIDTH, width / Math.max(1, farScale * 2))
    };
  }
  function project(cam, p) {
    var z = Math.max(p.z, 0.12);
    var scale = cam.focal / z;
    return { sx: cam.cx + p.x * scale, sy: cam.horizon + (cam.eyeY - p.y) * scale, scale: scale };
  }
  function projectXYZ(cam, x, y, z) { return project(cam, { x: x, y: y, z: z }); }

  // ================================================= PORTED: physics.ts
  var FIXED_DT = 1 / 120;
  var CARD_W = 0.064;
  var CARD_H = 0.089;
  var LAUNCH = { x: 0, y: 0.95, z: 0.9 };

  function createCard(input) {
    var spin = input.spin;
    var power = Math.max(0, Math.min(1, (input.speed - 6.5) / 8.5));
    var climb = 0.18 + power * 0.05 + spin * 0.07;
    return {
      pos: { x: LAUNCH.x, y: LAUNCH.y, z: LAUNCH.z },
      vel: { x: input.aimX, y: input.speed * climb, z: input.speed },
      spin: spin, spin0: spin, phi: 0,
      pitch: -0.12 - spin * 0.14 + (1 - spin) * 0.12,
      roll: input.curve * 0.5,
      curve: input.curve,
      swerve: (0.22 + power * 0.28) * (0.45 + spin * 0.55),
      swervePhase: input.speed * 0.47 + input.aimX * 0.9 + input.curve * 2.4,
      trail: [{ x: LAUNCH.x, y: LAUNCH.y, z: LAUNCH.z }],
      t: 0, grounded: false, settled: false, outcome: null, event: null
    };
  }

  function horizSpeed(c) { return Math.hypot(c.vel.x, c.vel.z); }

  function obstacleDepth(ob) {
    if (ob.kind === "couch") return 0.78;
    if (ob.kind === "books") return 0.58;
    if (ob.kind === "chair") return 0.5;
    if (ob.kind === "cat") return 0.42;
    if (ob.kind === "plant") return 0.48;
    if (ob.kind === "grate") return 0.5;
    if (ob.kind === "curtain") return 0.3;
    return 0.22;
  }

  function surfaceY(room, x, z) {
    var ob = room.obstacle;
    if (!ob || ob.kind === "lamp" || ob.kind === "glass" || ob.kind === "candle" ||
        ob.kind === "fan" || ob.kind === "curtain" || ob.kind === "plant" || ob.kind === "grate") {
      return 0.004;
    }
    var d = obstacleDepth(ob) / 2;
    if (Math.abs(x - ob.x) <= ob.halfWidth && z >= ob.z - d && z <= ob.z + d) return ob.top;
    return 0.004;
  }

  function collideBowlBody(c, room, wasGrounded) {
    if (c.outcome === "in") return false;
    if (c.pos.y > room.bowlHeight * 0.92) return false;
    var dx = c.pos.x - room.bowlX;
    var dz = c.pos.z - room.bowlZ;
    var rad = Math.hypot(dx, dz);
    var outer = room.bowlRadius * 1.22;
    if (rad >= outer) return false;
    var nx = rad > 0.0001 ? dx / rad : 0;
    var nz = rad > 0.0001 ? dz / rad : -1;
    var tangentX = -nz, tangentZ = nx;
    var tangentSpeed = c.vel.x * tangentX + c.vel.z * tangentZ;
    var inwardSpeed = -(c.vel.x * nx + c.vel.z * nz);
    var rebound = Math.max(0.55, inwardSpeed * (wasGrounded ? 0.46 : 0.62));
    c.pos.x = room.bowlX + nx * (outer + CARD_H * 0.28);
    c.pos.z = room.bowlZ + nz * (outer + CARD_H * 0.28);
    c.pos.y = Math.max(c.pos.y, room.bowlHeight * 0.16);
    c.vel.x = nx * rebound + tangentX * tangentSpeed * 0.42;
    c.vel.z = nz * rebound + tangentZ * tangentSpeed * 0.42;
    c.vel.y = Math.max(c.vel.y, wasGrounded ? 0.36 : 0.72);
    c.spin *= 0.24;
    c.grounded = false;
    c.outcome = "rim";
    c.event = "rim";
    return true;
  }

  function obstacleMaterial(ob) {
    if (ob.kind === "glass") return { restitution: 0.72, tangentDamp: 0.78, verticalKick: 1.22, spinDamp: 0.38 };
    if (ob.kind === "lamp" || ob.kind === "fan" || ob.kind === "grate") return { restitution: 0.58, tangentDamp: 0.66, verticalKick: 0.86, spinDamp: 0.34 };
    if (ob.kind === "chair" || ob.kind === "candle") return { restitution: 0.46, tangentDamp: 0.52, verticalKick: 0.72, spinDamp: 0.28 };
    if (ob.kind === "books") return { restitution: 0.2, tangentDamp: 0.3, verticalKick: 0.24, spinDamp: 0.12 };
    if (ob.kind === "couch" || ob.kind === "cat") return { restitution: 0.1, tangentDamp: 0.16, verticalKick: 0.12, spinDamp: 0.06 };
    if (ob.kind === "curtain" || ob.kind === "plant") return { restitution: 0.16, tangentDamp: 0.22, verticalKick: 0.2, spinDamp: 0.08 };
    return { restitution: 0.28, tangentDamp: 0.4, verticalKick: 0.42, spinDamp: 0.18 };
  }

  function collideObstacleBody(c, ob, wasGrounded) {
    if (c.outcome === "in") return false;
    if (c.pos.y > ob.top - 0.01) return false;
    var halfDepth = obstacleDepth(ob) / 2;
    var margin = CARD_H * (wasGrounded ? 0.36 : 0.22);
    var dx = c.pos.x - ob.x;
    var dz = c.pos.z - ob.z;
    var px = ob.halfWidth + margin - Math.abs(dx);
    var pz = halfDepth + margin - Math.abs(dz);
    if (px <= 0 || pz <= 0) return false;
    var nx = 0, nz = 0;
    if (px < pz) { nx = dx >= 0 ? 1 : -1; c.pos.x = ob.x + nx * (ob.halfWidth + margin); }
    else { nz = dz >= 0 ? 1 : -1; c.pos.z = ob.z + nz * (halfDepth + margin); }
    var material = obstacleMaterial(ob);
    var tangentX = -nz, tangentZ = nx;
    var normalSpeed = c.vel.x * nx + c.vel.z * nz;
    var tangentSpeed = c.vel.x * tangentX + c.vel.z * tangentZ;
    var impact = Math.max(0.42, Math.abs(normalSpeed));
    var groundedScale = wasGrounded ? 0.72 : 1;
    var rebound = impact * material.restitution * groundedScale;
    c.vel.x = nx * rebound + tangentX * tangentSpeed * material.tangentDamp;
    c.vel.z = nz * rebound + tangentZ * tangentSpeed * material.tangentDamp;
    c.vel.y = Math.max(c.vel.y * 0.25, material.verticalKick * groundedScale);
    c.spin *= material.spinDamp;
    c.grounded = false;
    c.event = "obstacle";
    if (!c.outcome) c.outcome = "miss";
    return true;
  }

  function stepCard(c, room, dt) {
    if (c.settled) return c;
    c.event = null;
    c.t += dt;

    if (!c.grounded) {
      var prevY = c.pos.y;
      var v = Math.hypot(c.vel.x, c.vel.y, c.vel.z);
      var hs = horizSpeed(c);
      var cd = 0.075 + (1 - c.spin) * 0.08;
      var ax = -cd * c.vel.x * v;
      var ay = -cd * 0.62 * c.vel.y * v;
      var az = -cd * c.vel.z * v;
      var lift = Math.min(5.8, 0.017 * c.spin * hs * hs) * Math.cos(c.pitch);
      var bend = c.curve * 2.9 * (0.35 + c.spin * 0.65) * (hs / 14);
      var sideSlip = Math.sin(c.t * (2.8 + c.spin0 * 1.4) + c.swervePhase) * c.swerve * (0.28 + c.spin * 0.72) * (hs / 12);
      var gust = Math.sin(c.t * 3.1 + c.spin0 * 8.7) * 0.28 + Math.sin(c.t * 6.4 + c.curve * 5.2) * 0.12;
      var windLift = Math.min(1.35, Math.max(0.25, c.pos.y + 0.18));
      var airfoil = (0.42 + c.spin * 0.58) * (0.55 + Math.min(1, hs / 12) * 0.45);
      var windAx = room.windX * (0.58 + gust) * airfoil * windLift;
      var windAz = room.windZ * (0.42 + gust * 0.5) * airfoil;
      var decay = 1 - c.spin;
      var flutter = Math.sin(c.t * 13.0 + c.spin0 * 9.0) * decay * decay * 3.4;

      var obstacleAx = 0, obstacleAy = 0, obstacleAz = 0;
      var ob = room.obstacle;
      if (ob) {
        var dzo = Math.abs(c.pos.z - ob.z);
        var dxo = Math.abs(c.pos.x - ob.x);
        if (ob.kind === "fan" && dzo < 2.15 && dxo < 1.85 && c.pos.y < ob.top + 0.55) {
          var side = ob.x > 0 ? -1 : 1;
          var depthFalloff = 1 - dzo / 2.15;
          var widthFalloff = 1 - dxo / 1.85;
          var heightFalloff = Math.max(0, 1 - Math.abs(c.pos.y - ob.top * 0.75) / 1.05);
          var fanGust = 0.86 + Math.sin(c.t * 9.4 + ob.x * 2.8) * 0.22 + Math.sin(c.t * 16.2 + c.spin0 * 5.1) * 0.1;
          var strength = depthFalloff * widthFalloff * heightFalloff * fanGust * (0.52 + c.spin * 0.58);
          obstacleAx += side * 5.2 * strength;
          obstacleAy += 1.1 * strength * (0.35 + c.spin);
          obstacleAz -= 0.55 * strength;
        }
        if (ob.kind === "candle" && dzo < 0.8 && dxo < 0.42 && c.pos.y < 0.75) {
          obstacleAy += 3.6 * (1 - dzo / 0.8);
        }
        if (ob.kind === "curtain" && dzo < 1.3 && c.pos.y > 0.3) {
          obstacleAx += Math.sin(c.t * 8.0 + ob.x * 3.0) * 1.6 * (1 - dzo / 1.3);
          obstacleAz -= 0.45 * (1 - dzo / 1.3);
        }
      }

      c.vel.x += (ax + bend + sideSlip + flutter + windAx + obstacleAx) * dt;
      c.vel.y += (ay + lift + obstacleAy - 9.81) * dt;
      c.vel.z += obstacleAz * dt;
      c.vel.z += (az + windAz) * dt;

      c.pos.x += c.vel.x * dt;
      c.pos.y += c.vel.y * dt;
      c.pos.z += c.vel.z * dt;
      if (Math.floor(c.t / (FIXED_DT * 4)) !== Math.floor((c.t - dt) / (FIXED_DT * 4))) {
        c.trail.push({ x: c.pos.x, y: c.pos.y, z: c.pos.z });
        if (c.trail.length > 28) c.trail.shift();
      }

      c.spin *= Math.exp(-dt * (0.55 + 0.25 * (1 - c.spin)));
      c.phi += (3.0 + c.spin * 42.0) * dt;
      var wobbleAmp = (1 - c.spin) * (1 - c.spin);
      c.pitch = c.pitch * 0.985 + Math.sin(c.t * 11.5) * wobbleAmp * 0.55 * dt * 12;
      c.roll = c.roll * 0.99 + Math.cos(c.t * 8.3) * wobbleAmp * 0.5 * dt * 12 +
        c.curve * dt * 0.6 + sideSlip * dt * 0.08 + windAx * dt * 0.05 + obstacleAx * dt * 0.04;

      if (ob && collideObstacleBody(c, ob, false)) return c;

      if (c.vel.y < 0 && prevY > room.bowlHeight && c.pos.y <= room.bowlHeight) {
        var fall = Math.max(dt, room.bowlHeight / Math.max(0.5, -c.vel.y));
        var minRad = Infinity, minT = 0, N = 10;
        for (var i2 = 0; i2 <= N; i2++) {
          var tt = (fall * i2) / N;
          var pxx = c.pos.x + c.vel.x * tt - room.bowlX;
          var pzz = c.pos.z + c.vel.z * tt - room.bowlZ;
          var rr = Math.hypot(pxx, pzz);
          if (rr < minRad) { minRad = rr; minT = tt; }
        }
        if (minRad < room.bowlRadius * 0.8) {
          c.outcome = "in"; c.settled = true; c.grounded = true;
          c.pos.x = room.bowlX; c.pos.z = room.bowlZ; c.pos.y = room.bowlHeight * 0.4;
          c.pitch = 0.25; c.event = "bowl";
          return c;
        }
        if (minRad < room.bowlRadius * 1.25) {
          c.pos.x += c.vel.x * minT;
          c.pos.z += c.vel.z * minT;
          var nx2 = (c.pos.x - room.bowlX) / (minRad || 1);
          var nz2 = (c.pos.z - room.bowlZ) / (minRad || 1);
          var controlledGlance = c.spin0 > 0.5 && Math.abs(c.curve) < 0.82 &&
            minRad > room.bowlRadius * 0.86 && minRad < room.bowlRadius * 1.14;
          if (controlledGlance) {
            c.outcome = "rim"; c.settled = true; c.grounded = true;
            c.pos.x = room.bowlX + nx2 * room.bowlRadius * 1.02;
            c.pos.z = room.bowlZ + nz2 * room.bowlRadius * 1.02;
            c.pos.y = room.bowlHeight + CARD_W * 0.28;
            c.vel.x = 0; c.vel.y = 0; c.vel.z = 0;
            c.spin *= 0.08; c.pitch = -0.45; c.roll = nx2 * 0.34;
            c.phi = Math.atan2(nz2, nx2) + Math.PI / 2;
            c.event = "rim";
            return c;
          }
          c.pos.y = room.bowlHeight + 0.01;
          c.vel.x = nx2 * 1.9 + c.vel.x * 0.15;
          c.vel.z = nz2 * 1.9 + c.vel.z * 0.15;
          c.vel.y = 1.5;
          c.spin *= 0.2;
          c.outcome = "rim"; c.event = "rim";
          return c;
        }
      }

      if (collideBowlBody(c, room, false)) return c;

      var surf = surfaceY(room, c.pos.x, c.pos.z);
      if (c.pos.y <= surf) {
        c.pos.y = surf;
        c.grounded = true;
        c.vel.y = 0;
        c.vel.x *= surf > 0.01 ? 0.3 : 0.55;
        c.vel.z *= surf > 0.01 ? 0.3 : 0.55;
        c.event = "floor";
        if (c.outcome !== "rim") c.outcome = "miss";
      }
    } else {
      var f = Math.exp(-dt * 4.2);
      c.vel.x *= f; c.vel.z *= f;
      c.pos.x += c.vel.x * dt;
      c.pos.z += c.vel.z * dt;
      if (collideBowlBody(c, room, true)) return c;
      if (room.obstacle && collideObstacleBody(c, room.obstacle, true)) return c;
      c.pitch *= Math.exp(-dt * 9);
      c.roll *= Math.exp(-dt * 9);
      c.spin *= Math.exp(-dt * 6);
      c.phi += c.spin * 12 * dt;
      var surf2 = surfaceY(room, c.pos.x, c.pos.z);
      if (c.outcome !== "in" && surf2 < c.pos.y - 0.02) {
        c.grounded = false;
        c.vel.y = -0.2;
      } else if (c.outcome !== "in") {
        c.pos.y = surf2;
      }
      if (c.grounded && Math.hypot(c.vel.x, c.vel.z) < 0.12) {
        c.settled = true; c.pitch = 0; c.roll = 0;
        if (!c.outcome) c.outcome = "miss";
      }
    }

    var ob2 = room.obstacle;
    if (ob2 && ob2.kind === "grate" && c.outcome !== "in") {
      var d2 = obstacleDepth(ob2) / 2;
      if (Math.abs(c.pos.x - ob2.x) < ob2.halfWidth && c.pos.z >= ob2.z - d2 && c.pos.z <= ob2.z + d2) {
        c.vel.x *= 0.88; c.vel.z *= 0.82;
        if (c.grounded) c.spin *= 0.7;
      }
    }

    if (c.pos.z > 13 || Math.abs(c.pos.x) > 3.2) {
      c.settled = true;
      if (!c.outcome) c.outcome = "miss";
    }
    return c;
  }

  function cardCorners(c) {
    var cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    var cr = Math.cos(c.roll), sr = Math.sin(c.roll);
    var cf = Math.cos(c.phi), sf = Math.sin(c.phi);
    var hw = CARD_W / 2, hh = CARD_H / 2;
    var local = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
    return local.map(function (uv) {
      var u = uv[0], vv = uv[1];
      var x = u * cf - vv * sf;
      var y = 0;
      var z = u * sf + vv * cf;
      var y1 = y * cp - z * sp, z1 = y * sp + z * cp;
      y = y1; z = z1;
      var x2 = x * cr - y * sr, y2 = x * sr + y * cr;
      x = x2; y = y2;
      return { x: c.pos.x + x, y: c.pos.y + y, z: c.pos.z + z };
    });
  }

  // cardNormal decides face vs back and the light catch — ported with the rest.
  function cardNormal(c) {
    var cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    var cr = Math.cos(c.roll), sr = Math.sin(c.roll);
    var x = 0, y = 1, z = 0;
    var y1 = y * cp - z * sp, z1 = y * sp + z * cp;
    y = y1; z = z1;
    var x2 = x * cr - y * sr, y2 = x * sr + y * cr;
    return { x: x2, y: y2, z: z };
  }

  function scaledCardCorners(bodyRef, visualScale) {
    var corners = cardCorners(bodyRef);
    if (!visualScale || visualScale === 1) return corners;
    return corners.map(function (c) {
      return {
        x: bodyRef.pos.x + (c.x - bodyRef.pos.x) * visualScale,
        y: bodyRef.pos.y + (c.y - bodyRef.pos.y) * visualScale,
        z: bodyRef.pos.z + (c.z - bodyRef.pos.z) * visualScale
      };
    });
  }

  // ============================================== PORTED: cardFace.ts
  var faceCache = {}, inkCache = {}, backCanvas = null;
  var PIP_LAYOUT = {
    "2": [[0,-0.62],[0,0.62]],
    "3": [[0,-0.62],[0,0],[0,0.62]],
    "4": [[-0.5,-0.62],[0.5,-0.62],[-0.5,0.62],[0.5,0.62]],
    "5": [[-0.5,-0.62],[0.5,-0.62],[0,0],[-0.5,0.62],[0.5,0.62]],
    "6": [[-0.5,-0.62],[0.5,-0.62],[-0.5,0],[0.5,0],[-0.5,0.62],[0.5,0.62]],
    "7": [[-0.5,-0.62],[0.5,-0.62],[0,-0.31],[-0.5,0],[0.5,0],[-0.5,0.62],[0.5,0.62]],
    "8": [[-0.5,-0.62],[0.5,-0.62],[0,-0.31],[-0.5,0],[0.5,0],[0,0.31],[-0.5,0.62],[0.5,0.62]],
    "9": [[-0.5,-0.62],[0.5,-0.62],[-0.5,-0.21],[0.5,-0.21],[0,0],[-0.5,0.21],[0.5,0.21],[-0.5,0.62],[0.5,0.62]],
    "10": [[-0.5,-0.62],[0.5,-0.62],[0,-0.41],[-0.5,-0.21],[0.5,-0.21],[-0.5,0.21],[0.5,0.21],[0,0.41],[-0.5,0.62],[0.5,0.62]]
  };

  function cpath(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function suitPath(c, suit, sz) {
    c.save();
    c.font = '900 ' + sz + 'px "Times New Roman", Georgia, ui-serif, serif';
    c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText(SUIT_GLYPH[suit], 0, sz * 0.035);
    c.restore();
  }
  function pip(c, suit, x, y, sz, flip) {
    c.save();
    c.translate(x, y);
    if (flip) c.rotate(Math.PI);
    suitPath(c, suit, sz);
    c.restore();
  }
  function drawCardInk(c, card, w, h) {
    var red = isRed(card.suit);
    var ink = red ? "#8f2119" : "#17120d";
    c.fillStyle = ink;
    c.textAlign = "center"; c.textBaseline = "middle";
    function drawCorner() {
      c.save();
      c.font = '800 ' + (w * (card.rank === "10" ? 0.155 : 0.19)) + 'px "Times New Roman", Georgia, ui-serif, serif';
      c.fillText(card.rank, w * 0.12, h * 0.088);
      c.restore();
      pip(c, card.suit, w * 0.12, h * 0.175, w * 0.135, false);
    }
    drawCorner();
    c.save(); c.translate(w, h); c.rotate(Math.PI); drawCorner(); c.restore();

    var cx = w / 2, cy = h / 2;
    var fieldH = h * 1.02, columnW = w * 0.43;
    var isFace = card.rank === "J" || card.rank === "Q" || card.rank === "K";
    if (card.rank === "A") {
      pip(c, card.suit, cx, cy, w * 0.52, false);
    } else if (isFace) {
      c.save();
      c.strokeStyle = red ? "rgba(192,54,44,0.5)" : "rgba(23,19,16,0.45)";
      c.lineWidth = Math.max(1, w * 0.012);
      cpath(c, w * 0.22, h * 0.24, w * 0.56, h * 0.52, w * 0.05);
      c.stroke();
      c.fillStyle = red ? "rgba(192,54,44,0.08)" : "rgba(23,19,16,0.07)";
      c.fill();
      c.restore();
      c.fillStyle = ink;
      c.font = '800 ' + (w * 0.28) + 'px "Times New Roman", Georgia, ui-serif, serif';
      c.fillText(card.rank, cx, cy - h * 0.06);
      pip(c, card.suit, cx, cy + h * 0.11, w * 0.25, false);
    } else {
      var pips = PIP_LAYOUT[card.rank] || [];
      var dense = card.rank === "9" || card.rank === "10" || card.rank === "8";
      var sz = dense ? w * 0.225 : w * 0.285;
      for (var i = 0; i < pips.length; i++) {
        pip(c, card.suit, cx + pips[i][0] * columnW, cy + pips[i][1] * (fieldH / 2), sz, pips[i][1] > 0.02);
      }
    }
  }
  function cardInkCanvas(card, w, mirror) {
    w = w || 220;
    var key = card.rank + card.suit + ":" + w + ":" + (mirror ? "m" : "n") + ":ink";
    if (inkCache[key]) return inkCache[key];
    var h = Math.round(w * 1.4);
    var cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    var c = cv.getContext("2d");
    if (mirror) { c.translate(w, 0); c.scale(-1, 1); }
    drawCardInk(c, card, w, h);
    inkCache[key] = cv;
    return cv;
  }
  function cardFaceCanvas(card, w, mirror) {
    w = w || 220;
    var key = card.rank + card.suit + ":" + w + ":" + (mirror ? "m" : "n");
    if (faceCache[key]) return faceCache[key];
    var h = Math.round(w * 1.4);
    var cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    var c = cv.getContext("2d");
    if (mirror) { c.translate(w, 0); c.scale(-1, 1); }
    var r = w * 0.08;
    var paper = c.createLinearGradient(0, 0, w, h);
    paper.addColorStop(0, "#fff5df");
    paper.addColorStop(0.45, "#efe2c8");
    paper.addColorStop(1, "#d5c3a5");
    c.fillStyle = paper;
    cpath(c, 0.5, 0.5, w - 1, h - 1, r);
    c.fill();

    c.save();
    cpath(c, 0.5, 0.5, w - 1, h - 1, r);
    c.clip();
    c.globalAlpha = 0.18;
    c.fillStyle = "#6b4a2e";
    for (var i = 0; i < 110; i++) {
      var x = w * ((Math.sin(i * 12.71) + 1) / 2);
      var y = h * ((Math.sin(i * 5.93 + 1.8) + 1) / 2);
      var rw = Math.max(0.45, w * (0.002 + ((Math.sin(i * 8.7) + 1) / 2) * 0.004));
      c.fillRect(x, y, rw, rw);
    }
    c.restore();

    var paperEdge = c.createRadialGradient(w / 2, h / 2, w * 0.16, w / 2, h / 2, h * 0.64);
    paperEdge.addColorStop(0, "rgba(255,255,255,0)");
    paperEdge.addColorStop(0.62, "rgba(0,0,0,0.04)");
    paperEdge.addColorStop(1, "rgba(0,0,0,0.18)");
    c.fillStyle = paperEdge;
    cpath(c, 0.5, 0.5, w - 1, h - 1, r);
    c.fill();

    c.strokeStyle = "rgba(45,28,15,0.34)";
    c.lineWidth = Math.max(1, w * 0.012);
    c.stroke();
    c.strokeStyle = "rgba(255,250,230,0.72)";
    c.lineWidth = Math.max(1, w * 0.006);
    cpath(c, w * 0.035, h * 0.025, w * 0.93, h * 0.95, r * 0.72);
    c.stroke();

    drawCardInk(c, card, w, h);
    faceCache[key] = cv;
    return cv;
  }
  function cardBackCanvas(w) {
    if (backCanvas) return backCanvas;
    w = w || 220;
    var h = Math.round(w * 1.4);
    var cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    var c = cv.getContext("2d");
    var r = w * 0.08;
    c.fillStyle = "#eadcc5";
    cpath(c, 0.5, 0.5, w - 1, h - 1, r);
    c.fill();
    var back = c.createLinearGradient(0, 0, w, h);
    back.addColorStop(0, "#172622");
    back.addColorStop(0.48, "#253d38");
    back.addColorStop(1, "#091313");
    c.fillStyle = back;
    cpath(c, w * 0.05, h * 0.036, w * 0.9, h * 0.928, r * 0.8);
    c.fill();
    c.save();
    cpath(c, w * 0.05, h * 0.036, w * 0.9, h * 0.928, r * 0.8);
    c.clip();
    c.strokeStyle = "rgba(188,128,52,0.18)";
    c.lineWidth = Math.max(1, w * 0.01);
    for (var i = -h; i < w + h; i += w * 0.11) {
      c.beginPath(); c.moveTo(i, 0); c.lineTo(i + h, h); c.stroke();
      c.beginPath(); c.moveTo(i + h, 0); c.lineTo(i, h); c.stroke();
    }
    c.strokeStyle = "rgba(224,184,104,0.34)";
    c.lineWidth = Math.max(1, w * 0.01);
    [0.68, 0.44, 0.22].forEach(function (sc) {
      c.beginPath();
      c.ellipse(w / 2, h / 2, w * sc * 0.42, h * sc * 0.32, 0, 0, TAU);
      c.stroke();
    });
    c.fillStyle = "rgba(218,156,70,0.32)";
    c.save(); c.translate(w / 2, h * 0.32); suitPath(c, "spades", w * 0.18); c.restore();
    c.save(); c.translate(w / 2, h * 0.68); c.rotate(Math.PI); suitPath(c, "spades", w * 0.18); c.restore();
    c.restore();
    c.strokeStyle = "rgba(231,192,118,0.5)";
    c.lineWidth = Math.max(1, w * 0.014);
    cpath(c, w * 0.1, h * 0.075, w * 0.8, h * 0.85, r * 0.6);
    c.stroke();
    var edge = c.createRadialGradient(w / 2, h / 2, w * 0.12, w / 2, h / 2, h * 0.62);
    edge.addColorStop(0, "rgba(255,255,255,0)");
    edge.addColorStop(0.72, "rgba(0,0,0,0.12)");
    edge.addColorStop(1, "rgba(0,0,0,0.38)");
    c.fillStyle = edge;
    cpath(c, 0.5, 0.5, w - 1, h - 1, r);
    c.fill();
    backCanvas = cv;
    return cv;
  }

  // ================================================== PORTED: daily.ts
  var OBSTACLE_NAMES = {
    couch: "velvet couch", lamp: "brass lamp", cat: "watchful cat", books: "book stack",
    glass: "wine glass", chair: "chair leg", candle: "candle draft", fan: "table fan",
    plant: "parlor plant", curtain: "loose curtain", grate: "floor grate"
  };
  var OBSTACLES = ["couch", "lamp", "cat", "books", "glass", "chair", "candle", "fan", "plant", "curtain", "grate"];
  var ROOM_TITLES = [
    "The Amber Study", "The Crooked Parlor", "The Midnight Floorboards", "The Scarabee Room",
    "The Green Velvet Den", "The Long Throw", "The Lamplight Table", "The House After Hours"
  ];
  var ROOM_MOODS = [
    "warm lamp, cold walls", "dust in the throw line", "thin crosswind",
    "low light, slick boards", "quiet room, loud rim", "every card leaves a trace"
  ];
  var EYE_Y = 1.35;

  function keepBowlVisible(room) {
    var ob = room.obstacle;
    if (!ob) return;
    var occludes = (EYE_Y - ob.top) / ob.z < (EYE_Y - room.bowlHeight) / room.bowlZ;
    if (!occludes) return;
    var bowlAngle = room.bowlX / room.bowlZ;
    var need = (ob.halfWidth + 0.1) / ob.z + (room.bowlRadius * 1.4) / room.bowlZ;
    var gap = Math.abs(ob.x / ob.z - bowlAngle);
    if (gap > need) return;
    var limit = 1.9 - ob.halfWidth;
    var sides = ob.x >= room.bowlX ? [1, -1] : [-1, 1];
    for (var i = 0; i < sides.length; i++) {
      var x = ob.z * (bowlAngle + sides[i] * need);
      if (Math.abs(x) <= limit) { ob.x = x; return; }
    }
    room.obstacle = null;
  }

  function buildRoom(rng) {
    var bowlZ = rngRange(rng, 5.4, 8.6);
    var bowlRadius = rngRange(rng, 0.19, 0.31);
    var bowlX = rngRange(rng, -0.75, 0.75);
    var hasObstacle = rng() < 0.55;
    var obstacle = null;
    if (hasObstacle) {
      var kind = rngPick(rng, OBSTACLES);
      var z = bowlZ - rngRange(rng, 1.5, 3.2);
      if (kind === "couch") obstacle = { kind: kind, x: rngRange(rng, -0.6, 0.6), z: z, halfWidth: 0.62, top: 0.62 };
      else if (kind === "lamp") obstacle = { kind: kind, x: rngRange(rng, -0.9, 0.9), z: z, halfWidth: 0.16, top: 1.45 };
      else if (kind === "cat") obstacle = { kind: kind, x: rngRange(rng, -0.7, 0.7), z: z, halfWidth: 0.34, top: 0.26 };
      else if (kind === "books") obstacle = { kind: kind, x: rngRange(rng, -0.78, 0.78), z: z, halfWidth: 0.38, top: 0.34 };
      else if (kind === "glass") obstacle = { kind: kind, x: rngRange(rng, -0.95, 0.95), z: z, halfWidth: 0.18, top: 0.58 };
      else if (kind === "chair") obstacle = { kind: kind, x: rngRange(rng, -0.85, 0.85), z: z, halfWidth: 0.28, top: 0.9 };
      else if (kind === "candle") obstacle = { kind: kind, x: rngRange(rng, -0.75, 0.75), z: z, halfWidth: 0.16, top: 0.48 };
      else if (kind === "fan") obstacle = { kind: kind, x: rngRange(rng, -1.0, 1.0), z: z, halfWidth: 0.32, top: 0.72 };
      else if (kind === "plant") obstacle = { kind: kind, x: rngRange(rng, -0.92, 0.92), z: z, halfWidth: 0.34, top: 0.88 };
      else if (kind === "curtain") obstacle = { kind: kind, x: rngRange(rng, -1.15, 1.15), z: z, halfWidth: 0.4, top: 1.85 };
      else obstacle = { kind: kind, x: rngRange(rng, -0.8, 0.8), z: z, halfWidth: 0.44, top: 0.08 };
    }
    var room = {
      bowlZ: bowlZ, bowlX: bowlX, bowlRadius: bowlRadius,
      bowlHeight: 0.16 + bowlRadius * 0.35,
      windX: 0, windZ: 0, obstacle: obstacle
    };
    keepBowlVisible(room);
    return room;
  }

  function buildSetup(seed) {
    var rng = mulberry32(seed);
    var room = buildRoom(rng);
    var title = rngPick(rng, ROOM_TITLES);
    var mood = rngPick(rng, ROOM_MOODS);
    var baseWind = rngRange(rng, -1.1, 1.1);
    var gust = rngRange(rng, 0.25, 0.9);
    var winds = [];
    for (var i = 0; i < ROUND_SIZE; i++) {
      winds.push({ x: baseWind + Math.sin(i * 1.7 + (seed % 7)) * gust, z: rngRange(rng, -0.35, 0.35) });
    }
    var cards = dealRound(rng, ROUND_SIZE);
    return { room: room, cards: cards, winds: winds, seed: seed, title: title, mood: mood };
  }

  function practiceSetup(nonce) { return buildSetup(hashString("practice:" + nonce)); }
  function randomNonce() { return rngInt(mulberry32((Date.now() ^ 0x9e3779b9) >>> 0), 1, 1000000); }

  /* The real game keys its daily on localDayKey() — a LOCAL date. The banner
     countdown must target the same rollover or it tells people the wrong thing. */
  function msUntilLocalMidnight(now) {
    now = now || new Date();
    var next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
    return next.getTime() - now.getTime();
  }

  // ================================================================== ART
  var ART = {};
  var artReady = 0, artTotal = 0;
  function loadArt(name, file) {
    artTotal++;
    var img = new Image();
    img.decoding = "async";
    img.onload = function () { artReady++; };
    img.onerror = function () { artReady++; };
    img.src = "art/" + file;
    ART[name] = img;
  }
  loadArt("room", "room.webp");
  loadArt("bowl", "bowl.webp");
  loadArt("hand", "hand.webp");
  OBSTACLES.forEach(function (k) { loadArt(k, k + ".webp"); });
  function ready(img) { return img && img.complete && img.naturalWidth > 0; }

  // ================================================== PORTED: lib/audio.ts
  // Ported rather than invented. The first pass had a dense inharmonic partial
  // stack through a 1.6s convolver, which is why the bowl buzzed — the real
  // thing is a papery tick and three clean porcelain sines, no reverb at all.
  var actx = null, master = null, flutterOsc = null;
  var soundOn = true;
  try { if (localStorage.getItem("tc_sound") === "0") soundOn = false; } catch (e) {}

  function ensure() {
    if (!actx) {
      var Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      actx = new Ctor();
      master = actx.createGain();
      master.gain.value = soundOn ? 0.9 : 0;
      master.connect(actx.destination);
    }
    if (actx.state === "suspended") actx.resume();
    return actx;
  }
  function unlockAudio() {
    var c = ensure();
    if (c && c.state !== "running") c.resume();
  }
  function setMuted(next) {
    soundOn = !next;
    if (master && actx) master.gain.setTargetAtTime(next ? 0 : 0.9, actx.currentTime, 0.02);
  }
  function noiseBuffer(c, seconds) {
    var len = Math.floor(c.sampleRate * (seconds || 1));
    var buf = c.createBuffer(1, len, c.sampleRate);
    var data = buf.getChannelData(0);
    var st = 12345;
    for (var i = 0; i < len; i++) {
      st = (Math.imul(st, 1103515245) + 12345) & 0x7fffffff;
      data[i] = (st / 0x3fffffff - 1) * 0.6;
    }
    return buf;
  }

  // A card in the air isn't hiss: filtered noise amplitude-modulated at the
  // card's rotation rate, so a clean spin blurs and a tumble flaps.
  function startFlutter() {
    var c = ensure();
    if (!c || !master || flutterOsc) return;
    var src = c.createBufferSource();
    src.buffer = noiseBuffer(c, 2);
    src.loop = true;
    var filter = c.createBiquadFilter();
    filter.type = "bandpass"; filter.frequency.value = 620; filter.Q.value = 2.1;
    var tame = c.createBiquadFilter();
    tame.type = "lowpass"; tame.frequency.value = 1750;
    var gain = c.createGain(); gain.gain.value = 0;
    var lfo = c.createOscillator();
    lfo.type = "sine"; lfo.frequency.value = 9;
    var lfoDepth = c.createGain(); lfoDepth.gain.value = 0;
    lfo.connect(lfoDepth).connect(gain.gain);
    var bodyOsc = c.createOscillator();
    bodyOsc.type = "triangle"; bodyOsc.frequency.value = 150;
    var bodyGain = c.createGain(); bodyGain.gain.value = 0;
    bodyOsc.connect(bodyGain).connect(master);
    src.connect(filter).connect(tame).connect(gain).connect(master);
    src.start(); lfo.start(); bodyOsc.start();
    flutterOsc = { src: src, gain: gain, filter: filter, tame: tame, lfo: lfo,
                   lfoDepth: lfoDepth, body: bodyOsc, bodyGain: bodyGain };
  }
  function updateFlutter(spin, speed) {
    if (!flutterOsc || !actx) return;
    var t = actx.currentTime;
    var sp = Math.min(1, spin);
    var level = Math.min(0.072, 0.009 + sp * 0.022 + speed * 0.0032);
    flutterOsc.lfo.frequency.setTargetAtTime(4 + sp * 22, t, 0.06);
    flutterOsc.lfoDepth.gain.setTargetAtTime(level * (0.65 - sp * 0.42), t, 0.06);
    flutterOsc.gain.gain.setTargetAtTime(level, t, 0.05);
    flutterOsc.filter.frequency.setTargetAtTime(430 + sp * 620 + speed * 16, t, 0.06);
    flutterOsc.tame.frequency.setTargetAtTime(1200 + sp * 900, t, 0.08);
    flutterOsc.bodyGain.gain.setTargetAtTime(Math.min(0.022, speed * 0.0017), t, 0.06);
    flutterOsc.body.frequency.setTargetAtTime(92 + speed * 3.5, t, 0.08);
  }
  function stopFlutter() {
    if (!flutterOsc || !actx) return;
    var f = flutterOsc, t = actx.currentTime;
    f.gain.gain.setTargetAtTime(0, t, 0.05);
    f.lfoDepth.gain.setTargetAtTime(0, t, 0.05);
    f.bodyGain.gain.setTargetAtTime(0, t, 0.05);
    setTimeout(function () {
      [f.src, f.lfo, f.body].forEach(function (n) { try { n.stop(); } catch (e) {} });
    }, 300);
    flutterOsc = null;
  }

  function shapedNoise(args) {
    var c = ensure();
    if (!c || !master) return;
    var src = c.createBufferSource();
    src.buffer = noiseBuffer(c, Math.max(0.25, args.dur + 0.08));
    var f = c.createBiquadFilter();
    f.type = args.type || "bandpass";
    f.frequency.value = args.freq;
    f.Q.value = args.q == null ? 1.4 : args.q;
    var g = c.createGain();
    var pn = c.createStereoPanner();
    pn.pan.value = args.pan || 0;
    var t = c.currentTime;
    var attack = args.attack == null ? 0.003 : args.attack;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(args.vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + args.dur);
    src.connect(f).connect(g).connect(pn).connect(master);
    src.start(t);
    src.stop(t + args.dur + 0.08);
  }
  function resonant(freq, dur, vol, decay, pan) {
    var c = ensure();
    if (!c || !master) return;
    var o = c.createOscillator();
    var g = c.createGain();
    var pn = c.createStereoPanner();
    o.type = "sine"; o.frequency.value = freq;
    pn.pan.value = pan || 0;
    var t = c.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (decay == null ? 0.08 : decay));
    o.connect(g).connect(pn).connect(master);
    o.start(t);
    o.stop(t + dur);
  }

  var sfx = {
    release: function () {
      shapedNoise({ freq: 5200, dur: 0.025, vol: 0.09, q: 5, pan: -0.12 });
      shapedNoise({ freq: 1900, dur: 0.075, vol: 0.105, q: 1.7, pan: 0.04 });
      shapedNoise({ freq: 760, dur: 0.045, vol: 0.05, q: 1.1, type: "highpass" });
    },
    floor: function () {
      shapedNoise({ freq: 210, dur: 0.12, vol: 0.18, q: 0.8, type: "lowpass", pan: 0.06 });
      shapedNoise({ freq: 1450, dur: 0.09, vol: 0.07, q: 1.3, pan: -0.04 });
      resonant(92, 0.16, 0.045, 0.11);
    },
    bowl: function () {
      shapedNoise({ freq: 2400, dur: 0.035, vol: 0.07, q: 2.5, pan: 0.03 });
      resonant(640, 0.34, 0.11, 0.24, -0.04);
      resonant(970, 0.28, 0.065, 0.18, 0.04);
      resonant(1320, 0.18, 0.035, 0.12, 0.02);
    },
    rim: function () {
      var hits = [[0, 820, 0.11], [34, 1180, 0.07], [78, 690, 0.055], [126, 1450, 0.035]];
      hits.forEach(function (h) {
        setTimeout(function () {
          shapedNoise({ freq: h[1] * 2.1, dur: 0.026, vol: h[2] * 0.45, q: 6 });
          resonant(h[1], 0.22, h[2], 0.12, h[0] % 2 ? 0.08 : -0.08);
        }, h[0]);
      });
    },
    thud: function () {
      shapedNoise({ freq: 160, dur: 0.16, vol: 0.18, q: 0.7, type: "lowpass" });
      shapedNoise({ freq: 900, dur: 0.06, vol: 0.07, q: 1.2 });
      resonant(72, 0.18, 0.035, 0.1);
    },
    done: function () {
      [420, 530, 670].forEach(function (f, i) {
        setTimeout(function () { resonant(f, 0.32, 0.09 - i * 0.012, 0.22); }, i * 105);
      });
    }
  };

  soundBtn.addEventListener("click", function () {
    setMuted(soundOn);
    soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
    try { localStorage.setItem("tc_sound", soundOn ? "1" : "0"); } catch (e) {}
    unlockAudio();
  });
  soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");

  // ================================================================ STATE
  var state = "menu";            // menu | aim | fly | done
  var cam = null, dpr = 1, W = 0, H = 0;
  var setup = null, room = null, throwIdx = 0, throws = [], body = null;
  var best = 0, rounds = 0;
  var settleT = 0, flash = 0, bowlPulse = 0, t = 0, reported = false;
  var floaters = [];
  var litter = [];                 // cards that have landed, they stay in the room
  var heldIntro = 0;               // 0..1 ease as the next card comes up
  var drag = null;
  // A real CardBody used only for the held pose, so the hand sprite and the
  // card ink share one set of projected corners.
  var held = createCard({ speed: 6.5, aimX: 0, spin: 0, curve: 0 });

  try { best = parseInt(localStorage.getItem("tc_best") || "0", 10) || 0; } catch (e) {}
  try { rounds = parseInt(localStorage.getItem("tc_rounds") || "0", 10) || 0; } catch (e) {}

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cam = makeCamera(W, H);
  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", function () {
    resize(); setTimeout(resize, 180); setTimeout(resize, 520);
  });

  function windLabel(wx) {
    var a = Math.abs(wx);
    if (a < 0.28) return "still air";
    var dir = wx < 0 ? "left" : "right";
    if (a < 0.8) return "light breeze " + dir;
    return "strong draft " + dir;
  }

  function updateHud() {
    scoreEl.textContent = totalScore(throws);
    roomNameEl.textContent = setup ? setup.title : "";
    var bits = [];
    if (state !== "done") bits.push("card " + Math.min(throwIdx + 1, ROUND_SIZE) + "/" + ROUND_SIZE);
    if (room) bits.push(windLabel(room.windX));
    if (setup && setup.room.obstacle) bits.push(OBSTACLE_NAMES[setup.room.obstacle.kind]);
    roomSubEl.textContent = bits.join(" · ");
  }

  function newRound() {
    setup = practiceSetup(randomNonce());
    room = setup.room;
    throwIdx = 0;
    throws = [];
    body = null;
    floaters.length = 0;
    litter.length = 0;
    heldIntro = 0;
    state = "aim";
    applyWind();
    updateHud();
  }

  function applyWind() {
    var w = setup.winds[Math.min(throwIdx, setup.winds.length - 1)];
    room.windX = w.x;
    room.windZ = w.z;
  }

  // ================================================================ INPUT
  function pointAt(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp };
  }

  canvas.addEventListener("pointerdown", function (e) {
    unlockAudio();
    if (state !== "aim") return;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    var p = pointAt(e);
    drag = { id: e.pointerId, samples: [p] };
    hint.classList.add("is-gone");
  });

  canvas.addEventListener("pointermove", function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag.samples.push(pointAt(e));
    if (drag.samples.length > 90) drag.samples.shift();
  });

  function release(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var samples = drag.samples;
    drag = null;
    if (state !== "aim") return;
    var flick = analyzeFlick(samples, e.timeStamp);
    if (!flick) return;
    // Only an upward flick throws — same rule as the real game.
    if (flick.dy > -0.25) return;
    var refPx = canvas.getBoundingClientRect().height || 700;
    var input = flickToThrow(flick, refPx);
    launch(input);
  }
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", function () { drag = null; });

  function launch(input) {
    applyWind();
    body = createCard(input);
    state = "fly";
    settleT = 0;
    reported = false;
    sfx.release();
    startFlutter();
    updateFlutter(input.spin, input.speed);
  }

  window.addEventListener("keydown", function (e) {
    if (e.code === "Space" || e.key === " ") {
      e.preventDefault();
      unlockAudio();
      if (state === "menu" || state === "done") ovBtn.click();
    }
  });

  // ============================================================ RESOLUTION
  function resolveThrow() {
    var card = setup.cards[throwIdx];
    var outcome = body.outcome || "miss";
    var pts = pointsFor(card, outcome);
    throws.push({ card: card, outcome: outcome, points: pts });
    if (pts > 0) {
      floaters.push({ x: body.pos.x, y: body.pos.y, z: body.pos.z, txt: "+" + pts, t: 0, col: outcome === "in" ? "#f5a25c" : "#c2a07a" });
    }
    // the thrown card stays where it landed, like the real game
    litter.push({ body: body, card: card });
    if (litter.length > ROUND_SIZE) litter.shift();
    throwIdx++;
    updateHud();
    if (throwIdx >= ROUND_SIZE) endRound();
    else { state = "aim"; body = null; heldIntro = 0; applyWind(); updateHud(); }
  }

  function endRound() {
    state = "done";
    var score = totalScore(throws);
    var inCount = cardsIn(throws);
    rounds++;
    try { localStorage.setItem("tc_rounds", String(rounds)); } catch (e) {}
    var isBest = score > best;
    if (isBest) {
      best = score;
      try { localStorage.setItem("tc_best", String(best)); } catch (e) {}
    }
    stopFlutter();
    sfx.done();

    resultGrid.innerHTML = "";
    throws.forEach(function (th) {
      var cell = document.createElement("div");
      cell.className = "result__cell result__cell--" + th.outcome;
      cell.textContent = th.card.rank;
      resultGrid.appendChild(cell);
    });
    resultLine.innerHTML = "<b>" + inCount + " of " + ROUND_SIZE + "</b> in the bowl · " +
      verdict(inCount, ROUND_SIZE, score) + (isBest ? " · <b>new best</b>" : " · best " + best);

    ovEyebrow.textContent = setup.title + " · " + setup.mood;
    ovTitle.textContent = String(score);
    ovBody.hidden = true;
    resultBox.hidden = false;
    ovBtn.textContent = "Another room";
    ovKeys.textContent = "drag back & flick up";
    refreshCta();
    cta.hidden = false;
    overlay.hidden = false;
    hud.hidden = true;
    document.body.classList.remove("is-playing");

    window.OPT_SHARE_TEXT =
      "Tossing Cards (practice): " + score + " pts, " + inCount + " of " + ROUND_SIZE + " in.\n" +
      shareGrid(throws) +
      "\nPlay today's room against everyone → https://www.tossingcards.com/?utm_source=onepagetoys&utm_medium=share";
    if (window.OPT_SHARE && window.OPT_SHARE.refresh) window.OPT_SHARE.refresh();
  }

  // the real game's share glyphs, so a practice grid reads the same as a daily
  var GLYPH = { in: "\u{1F7E9}", rim: "\u{1F7E8}", miss: "⬜" };
  function shareGrid(list) {
    return list.map(function (th) { return GLYPH[th.outcome]; }).join("");
  }
  function verdict(inCount, total, score) {
    if (inCount === total) return "perfect room";
    if (inCount >= 8) return "threaded the room";
    if (inCount >= 6) return "sharp flicking";
    if (score >= 35) return "saved by the faces";
    if (inCount >= 3) return "respectable chaos";
    return "still finding the line";
  }

  ovBtn.addEventListener("click", function () {
    unlockAudio();
    ovBody.hidden = false;
    resultBox.hidden = true;
    cta.hidden = true;
    overlay.hidden = true;
    hud.hidden = false;
    document.body.classList.add("is-playing");
    hint.classList.remove("is-gone");
    newRound();
  });

  // ================================================================= FEEDER
  // Links name www because tossingcards.com 308s the apex to www; pointing at
  // the apex would cost every CTA a redirect hop.
  function tickCountdown() {
    var left = Math.max(0, msUntilLocalMidnight());
    var h = Math.floor(left / 3600000);
    var m = Math.floor(left / 60000) % 60;
    var s = Math.floor(left / 1000) % 60;
    dailyTime.textContent = h + "h " + (m < 10 ? "0" : "") + m + "m " + (s < 10 ? "0" : "") + s + "s";
    dailyEl.title = "A new room drops in " + h + "h " + m + "m at tossingcards.com";
  }
  tickCountdown();
  setInterval(tickCountdown, 1000);

  function refreshCta() {
    if (rounds >= 3) {
      dailyEl.classList.add("is-hot");
      ctaLine.innerHTML = "That is <b>" + rounds + " rooms</b> in the practice edition. " +
        "The daily gives everyone the <b>same room</b> — one setup, ten cards, and a streak for coming back.";
      ctaBtn.textContent = "Start a streak →";
    } else {
      ctaLine.innerHTML = "Everyone gets the <b>same room</b> on the daily — one setup, ten cards, " +
        "and a streak for coming back.";
      ctaBtn.textContent = "Play today's room →";
    }
  }
  refreshCta();

  function track(name, params) {
    if (window.gtag) { try { gtag("event", name, params); } catch (e) {} }
  }
  [[dailyEl, "banner"], [ctaBtn, "post_round"]].forEach(function (pair) {
    pair[0].addEventListener("click", function () {
      track("outbound_click", { destination: "tossingcards.com", link_id: pair[1] });
    });
  });
  // share.js injects its button after this script runs, so delegate
  document.addEventListener("click", function (e) {
    var el = e.target && e.target.closest ? e.target.closest(".opt-share") : null;
    if (el) track("share", { method: "tossingcards_feeder", value: totalScore(throws) });
  });

  // ================================================ PORTED: render.ts
  // The first pass approximated this and it showed: props were drawn from the
  // projected top instead of the real per-kind tables, so the art never lined
  // up with the collision box the physics uses — you could hit a prop that
  // looked like nothing but a shadow. These are the game's own numbers.
  var OBSTACLE_HEIGHT_SCALE = {
    couch: 1.1, lamp: 1.06, cat: 1.14, books: 1, glass: 1.08, chair: 1.02,
    candle: 1.08, fan: 1.16, plant: 1.05, curtain: 1, grate: 1
  };
  var OBSTACLE_Y_OFFSET = {
    couch: 0.02, lamp: 0, cat: 0.01, books: 0, glass: 0, chair: 0,
    candle: 0, fan: 0.01, plant: 0, curtain: 0, grate: 0
  };

  function drawRoomArt() {
    var img = ART.room;
    if (ready(img)) {
      var scale = Math.max(W / img.naturalWidth, H / img.naturalHeight);
      var dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
      ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      return;
    }
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#071111");
    g.addColorStop(Math.max(0.01, Math.min(0.99, cam.horizon / H)), "#0d2021");
    g.addColorStop(1, "#090f0e");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawObstacle() {
    var ob = room.obstacle;
    if (!ob) return;
    var base = projectXYZ(cam, ob.x, 0, ob.z);
    var s = base.scale;

    // floor shadow, elongated away from the lamp rather than dropped straight down
    var rx = Math.max(6, ob.halfWidth * 1.45 * s);
    var ry = Math.max(2, rx * 0.34);
    var lampSx = cam.width * 0.64, lampSy = cam.height * 0.36;
    var awayX = base.sx - lampSx, awayY = base.sy - lampSy;
    var len = Math.hypot(awayX, awayY) || 1;
    var shX = base.sx + (awayX / len) * Math.min(rx * 0.42, ob.top * s * 0.12);
    var shY = base.sy + Math.max(1, (awayY / len) * Math.min(rx * 0.2, ob.top * s * 0.055));
    var ring = ctx.createRadialGradient(shX, shY, rx * 0.1, shX, shY, rx * 1.18);
    ring.addColorStop(0, "rgba(0,0,0,0.42)");
    ring.addColorStop(0.56, "rgba(0,0,0,0.18)");
    ring.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.filter = "blur(" + Math.max(1, rx * 0.045) + "px)";
    ctx.fillStyle = ring;
    ctx.beginPath();
    ctx.ellipse(shX, shY, rx * 1.12, ry * 0.9, -0.12, 0, TAU);
    ctx.fill();
    ctx.restore();

    var img = ART[ob.kind];
    var drawW, drawH;
    if (ready(img)) {
      if (ob.kind === "grate") {
        drawW = Math.max(28, ob.halfWidth * 2.2 * s);
        drawH = drawW * (img.naturalHeight / img.naturalWidth);
      } else {
        drawH = Math.max(18, ob.top * s * OBSTACLE_HEIGHT_SCALE[ob.kind]);
        drawW = drawH * (img.naturalWidth / img.naturalHeight);
      }
      var x = base.sx - drawW / 2;
      var y = base.sy - drawH + drawH * OBSTACLE_Y_OFFSET[ob.kind];

      if (ob.kind === "lamp" || ob.kind === "candle") {
        var gy = y + drawH * (ob.kind === "lamp" ? 0.22 : 0.12);
        var gr = drawH * (ob.kind === "lamp" ? 0.62 : 0.58);
        var glow = ctx.createRadialGradient(base.sx, gy, 1, base.sx, gy, gr);
        glow.addColorStop(0, ob.kind === "lamp" ? "rgba(255,190,112,0.24)" : "rgba(255,188,86,0.3)");
        glow.addColorStop(1, ob.kind === "lamp" ? "rgba(255,170,92,0)" : "rgba(255,130,62,0)");
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(base.sx, gy, gr, 0, TAU);
        ctx.fill();
        ctx.restore();
      }

      ctx.save();
      ctx.filter = "saturate(0.82) contrast(1.08) brightness(0.78)";
      ctx.globalAlpha = ob.kind === "glass" ? 0.74 : 0.98;
      ctx.drawImage(img, x, y, drawW, drawH);
      ctx.restore();
      return;
    }

    // Art missing: draw the collision box itself rather than nothing, so a prop
    // can never be invisible while still stopping the card.
    var topP = projectXYZ(cam, ob.x, ob.top, ob.z);
    var bw2 = ob.halfWidth * 2 * s;
    ctx.save();
    ctx.fillStyle = "rgba(14,22,21,0.92)";
    ctx.fillRect(base.sx - bw2 / 2, topP.sy, bw2, Math.max(4, base.sy - topP.sy));
    ctx.strokeStyle = "rgba(226,165,72,0.35)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(base.sx - bw2 / 2, topP.sy, bw2, Math.max(4, base.sy - topP.sy));
    ctx.restore();
  }

  function drawBowl() {
    var base = projectXYZ(cam, room.bowlX, 0, room.bowlZ);
    var rim = projectXYZ(cam, room.bowlX, room.bowlHeight, room.bowlZ);
    var s = base.scale;
    var rx = room.bowlRadius * s * (1 + bowlPulse * 0.08);
    var ry = rx * 0.42;

    var shadowX = base.sx - rx * 0.12, shadowY = base.sy + ry * 0.2;
    var sh = ctx.createRadialGradient(shadowX, shadowY, rx * 0.2, shadowX, shadowY, rx * 1.72);
    sh.addColorStop(0, "rgba(0,0,0,0.5)");
    sh.addColorStop(0.58, "rgba(0,0,0,0.2)");
    sh.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.filter = "blur(" + Math.max(1, rx * 0.055) + "px)";
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.ellipse(shadowX, shadowY, rx * 1.74, ry * 1.04, -0.08, 0, TAU);
    ctx.fill();
    ctx.restore();

    var img = ART.bowl;
    if (ready(img)) {
      var drawW = rx * 2.52;
      var drawH = drawW * (img.naturalHeight / img.naturalWidth);
      ctx.save();
      ctx.filter = "saturate(0.82) contrast(1.08) brightness(0.76)";
      ctx.drawImage(img, base.sx - drawW / 2, rim.sy - drawH * 0.26, drawW, drawH);
      ctx.restore();
    } else {
      ctx.fillStyle = "#d8cdbb";
      ctx.beginPath();
      ctx.ellipse(base.sx, rim.sy, rx, ry, 0, 0, TAU);
      ctx.fill();
    }

    if (bowlPulse > 0.02) {
      var pulseAlpha = Math.min(0.34, bowlPulse * 0.34);
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.strokeStyle = "rgba(255,168,92," + pulseAlpha.toFixed(3) + ")";
      ctx.lineWidth = Math.max(1, rx * 0.028);
      ctx.beginPath();
      ctx.ellipse(rim.sx, rim.sy + ry * 0.03, rx * 0.88, ry * 0.58, 0,
                  Math.PI * 1.04, Math.PI * 1.96);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawShadow(c, visualScale) {
    visualScale = visualScale || 1;
    var g = projectXYZ(cam, c.pos.x, 0, c.pos.z);
    var height = Math.max(0, c.pos.y);
    var floorFade = 1 / (1 + height * 1.1);
    var liftFade = Math.max(0.08, 1 - height / 1.35);
    var alpha = 0.38 * floorFade * liftFade;
    var lampSx = cam.width * 0.64, lampSy = cam.height * 0.36;
    var awayX = g.sx - lampSx, awayY = g.sy - lampSy;
    var len = Math.hypot(awayX, awayY) || 1;
    var cast = Math.min(g.scale * 0.12, height * g.scale * 0.1);
    var sx = g.sx + (awayX / len) * cast;
    var sy = g.sy + Math.max(0, (awayY / len) * cast * 0.45);
    var stretch = 1 + height * 0.95;
    var rx = (CARD_H / 2) * g.scale * floorFade * visualScale * stretch;
    var ry = (CARD_W / 2) * g.scale * floorFade * visualScale * 0.58;
    ctx.save();
    ctx.globalAlpha = Math.max(0.035, alpha);
    ctx.filter = "blur(" + Math.max(0.8, height * g.scale * 0.018) + "px)";
    ctx.fillStyle = "#04100f";
    ctx.beginPath();
    ctx.ellipse(sx, sy, Math.max(1, rx), Math.max(0.8, ry), c.phi - 0.1, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawCardBody(bodyRef, card, visualScale) {
    visualScale = visualScale || 1;
    var corners = scaledCardCorners(bodyRef, visualScale);
    var p = corners.map(function (c) { return project(cam, c); });
    var n = cardNormal(bodyRef);
    var view = { x: bodyRef.pos.x, y: bodyRef.pos.y - cam.eyeY, z: bodyRef.pos.z };
    var vlen = Math.hypot(view.x, view.y, view.z) || 1;
    var facing = (n.x * view.x + n.y * view.y + n.z * view.z) / vlen;
    var showFace = facing < 0;

    var p0 = p[0], p1 = p[1], p3 = p[3];
    var probe = showFace ? cardFaceCanvas(card) : cardBackCanvas();
    var sw = probe.width, shh = probe.height;
    var a = (p1.sx - p0.sx) / sw;
    var b2 = (p1.sy - p0.sy) / sw;
    var cc = (p3.sx - p0.sx) / shh;
    var d = (p3.sy - p0.sy) / shh;
    var img = showFace ? cardFaceCanvas(card, 220, a * d - b2 * cc < 0) : probe;
    var area = Math.abs(a * d - b2 * cc) * sw * shh;

    var edge = Math.max(0.6, Math.hypot(a, b2) * sw * 0.03);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = Math.max(4, edge * 2.5);
    ctx.shadowOffsetY = Math.max(2, edge * 1.8);
    ctx.fillStyle = "rgba(7,10,9,0.88)";
    ctx.beginPath();
    ctx.moveTo(p[0].sx + edge * 0.28, p[0].sy + edge);
    for (var i = 1; i < 4; i++) ctx.lineTo(p[i].sx + edge * 0.28, p[i].sy + edge);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    if (area < 2) return;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.transform(a, b2, cc, d, p0.sx, p0.sy);
    ctx.drawImage(img, 0, 0);
    ctx.globalCompositeOperation = "multiply";
    var edgeShade = ctx.createRadialGradient(sw * 0.5, shh * 0.48, sw * 0.16, sw * 0.5, shh * 0.48, shh * 0.65);
    edgeShade.addColorStop(0, "rgba(255,255,255,1)");
    edgeShade.addColorStop(0.7, "rgba(150,135,112,0.9)");
    edgeShade.addColorStop(1, "rgba(48,35,24,0.72)");
    ctx.fillStyle = edgeShade;
    ctx.fillRect(0, 0, sw, shh);
    ctx.globalCompositeOperation = "screen";
    var lampSheen = ctx.createLinearGradient(0, 0, sw, shh);
    lampSheen.addColorStop(0, "rgba(255,236,185,0.32)");
    lampSheen.addColorStop(0.45, "rgba(255,221,150,0.04)");
    lampSheen.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = lampSheen;
    ctx.fillRect(0, 0, sw, shh);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(255,244,208,0.42)";
    ctx.lineWidth = Math.max(0.8, edge * 0.55);
    ctx.beginPath();
    ctx.moveTo(p[0].sx, p[0].sy);
    ctx.lineTo(p[1].sx, p[1].sy);
    ctx.stroke();
    ctx.restore();

    var catchAmt = Math.pow(Math.max(0, Math.abs(n.y)), 6) * 0.5 + Math.max(0, -n.z) * 0.12;
    if (catchAmt > 0.02) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.5, catchAmt);
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "rgba(255,236,196,0.7)";
      ctx.beginPath();
      ctx.moveTo(p[0].sx, p[0].sy);
      for (var j = 1; j < 4; j++) ctx.lineTo(p[j].sx, p[j].sy);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function drawTrail() {
    if (!body || REDMO) return;
    var speed = Math.hypot(body.vel.x, body.vel.y, body.vel.z);
    if (speed < 2.5 || body.pos.z < 1) return;
    var pts = body.trail.map(function (p) { return project(cam, p); });
    if (pts.length < 3) return;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.lineCap = "round";
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b2 = pts[i];
      var f = i / (pts.length - 1);
      var width = Math.max(1, b2.scale * (0.012 + f * 0.024));
      ctx.filter = "blur(" + Math.max(1, width * 0.55) + "px)";
      ctx.strokeStyle = "rgba(255,214,160," + (Math.pow(f, 1.7) * 0.18).toFixed(4) + ")";
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      var mx = (a.sx + b2.sx) / 2, my = (a.sy + b2.sy) / 2;
      ctx.quadraticCurveTo(mx, my, b2.sx, b2.sy);
      ctx.stroke();
    }
    ctx.restore();
    ctx.filter = "none";
  }

  /* The held card is the hand sprite with the card ink mapped into the sprite's
     OWN card corners. Drawing an independent rectangle beside the hand is what
     made the first pass look huge and misaligned. */
  var SRC_CARD = {
    tl: { x: 0.524, y: 0.089 }, tr: { x: 0.646, y: 0.141 },
    br: { x: 0.622, y: 0.49 }, bl: { x: 0.474, y: 0.404 }
  };
  var HELD_CARD_SCALE = 1.22;

  function drawHeldCardHand(bodyRef, card, visualScale, alpha) {
    var img = ART.hand;
    if (!ready(img)) return;
    var projected = scaledCardCorners(bodyRef, visualScale).map(function (c) { return project(cam, c); });
    var tl = projected[0], tr = projected[1], br = projected[2], bl = projected[3];
    var targetCenter = {
      sx: (tl.sx + tr.sx + br.sx + bl.sx) / 4,
      sy: (tl.sy + tr.sy + br.sy + bl.sy) / 4
    };
    var targetH = Math.hypot(tl.sx - bl.sx, tl.sy - bl.sy);
    var srcH = Math.hypot(
      (SRC_CARD.tl.x - SRC_CARD.bl.x) * img.naturalWidth,
      (SRC_CARD.tl.y - SRC_CARD.bl.y) * img.naturalHeight
    );
    var drawScale = (targetH / srcH) * 1.02;
    var drawW = img.naturalWidth * drawScale;
    var drawH = img.naturalHeight * drawScale;
    var srcCenter = {
      x: ((SRC_CARD.tl.x + SRC_CARD.tr.x + SRC_CARD.br.x + SRC_CARD.bl.x) / 4) * drawW,
      y: ((SRC_CARD.tl.y + SRC_CARD.tr.y + SRC_CARD.br.y + SRC_CARD.bl.y) / 4) * drawH
    };
    var x = targetCenter.sx - srcCenter.x - targetH * 0.06;
    var y = targetCenter.sy - srcCenter.y + targetH * 0.03;

    ctx.save();
    ctx.globalAlpha = 0.99 * alpha;
    ctx.filter = "saturate(0.8) contrast(1.08) brightness(0.8) drop-shadow(0 " +
      Math.max(5, cam.height * 0.012) + "px " + Math.max(18, cam.height * 0.038) +
      "px rgba(0,0,0,0.66))";
    ctx.drawImage(img, x, y, drawW, drawH);
    ctx.restore();

    var q = {
      tl: { sx: x + SRC_CARD.tl.x * drawW, sy: y + SRC_CARD.tl.y * drawH },
      tr: { sx: x + SRC_CARD.tr.x * drawW, sy: y + SRC_CARD.tr.y * drawH },
      br: { sx: x + SRC_CARD.br.x * drawW, sy: y + SRC_CARD.br.y * drawH },
      bl: { sx: x + SRC_CARD.bl.x * drawW, sy: y + SRC_CARD.bl.y * drawH }
    };
    var ink = cardInkCanvas(card);
    var a = (q.tr.sx - q.tl.sx) / ink.width;
    var b2 = (q.tr.sy - q.tl.sy) / ink.width;
    var cc = (q.bl.sx - q.tl.sx) / ink.height;
    var d = (q.bl.sy - q.tl.sy) / ink.height;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(q.tl.sx, q.tl.sy);
    ctx.lineTo(q.tr.sx, q.tr.sy);
    ctx.lineTo(q.br.sx, q.br.sy);
    ctx.lineTo(q.bl.sx, q.bl.sy);
    ctx.closePath();
    ctx.clip();
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = 0.88 * alpha;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.transform(a, b2, cc, d, q.tl.sx, q.tl.sy);
    ctx.drawImage(ink, 0, 0);
    ctx.restore();
  }

  function drawFloaters() {
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (var i = 0; i < floaters.length; i++) {
      var f = floaters[i];
      var p = project(cam, { x: f.x, y: f.y + f.t * 0.8, z: f.z });
      ctx.globalAlpha = clamp(1 - f.t / 1.1, 0, 1);
      ctx.fillStyle = f.col;
      ctx.font = "700 " + Math.round(Math.max(15, p.scale * 0.055)) + "px Georgia, ui-serif, serif";
      ctx.fillText(f.txt, p.sx, p.sy);
    }
    ctx.restore();
  }

  function drawAimGuide() {
    if (!drag || drag.samples.length < 2) return;
    var a = drag.samples[0];
    var b2 = drag.samples[drag.samples.length - 1];
    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.strokeStyle = "#e2a548";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b2.x, b2.y);
    ctx.stroke();
    ctx.restore();
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawRoomArt();
    if (!room) return;

    // One painter's list sorted by depth, so props always occlude what is
    // behind them — landed cards included.
    var items = [];
    for (var i = 0; i < litter.length; i++) {
      (function (d) {
        var z = d.body.pos.y > 0.1 ? d.body.pos.z - 0.6 : d.body.pos.z;
        items.push({ z: z, paint: function () {
          if (d.body.pos.y < 0.1) drawShadow(d.body);
          drawCardBody(d.body, d.card);
        } });
      })(litter[i]);
    }
    items.push({ z: room.bowlZ, paint: drawBowl });
    if (room.obstacle) items.push({ z: room.obstacle.z, paint: drawObstacle });
    if (body) {
      items.push({ z: body.pos.z, paint: function () {
        if (!(body.settled && body.outcome === "in")) {
          drawTrail();
          drawShadow(body);
          drawCardBody(body, setup.cards[Math.min(throwIdx, setup.cards.length - 1)]);
        }
      } });
    }
    items.sort(function (a, b2) { return b2.z - a.z; });
    for (var k = 0; k < items.length; k++) items[k].paint();

    drawFloaters();

    if (state === "aim") {
      // the pose the real game holds the card in before a throw
      var ease = heldIntro;
      var settle = Math.sin(t * 1.6) * 0.004;
      held.pitch = -1.05 + ease * 0.28;
      held.roll = 0.16 - ease * 0.1;
      held.phi = -0.08 + ease * 0.13;
      held.pos = {
        x: -0.02 + ease * 0.02,
        y: LAUNCH.y - 0.58 + ease * 0.5 + settle,
        z: LAUNCH.z - 0.06 + ease * 0.08
      };
      drawHeldCardHand(held, setup.cards[throwIdx], HELD_CARD_SCALE * (0.94 + ease * 0.06), 1);
    }

    drawAimGuide();
    if (flash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = flash * 0.14;
      ctx.fillStyle = "#f5a25c";
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  // ================================================================== LOOP
  var last = 0, acc = 0;
  document.addEventListener("visibilitychange", function () { if (!document.hidden) last = 0; });

  function frame(ts) {
    if (!last) last = ts;
    var dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;
    t += dt;

    if (state === "fly" && body) {
      acc += dt;
      var steps = 0;
      while (acc >= FIXED_DT && steps < 12) {
        acc -= FIXED_DT;
        steps++;
        bowlPulse *= 0.9;
        // Only step — and only read `event` — while the card is still live.
        // stepCard early-returns on a settled card WITHOUT clearing `event`, so
        // reading it unconditionally re-fired the landing sound every frame for
        // the whole settle window. That stacking was the ring in the bowl.
        if (!body.settled) {
          stepCard(body, room, FIXED_DT);
          var ev = body.event;
          if (ev === "bowl") { sfx.bowl(); bowlPulse = 1; flash = 0.6; }
          else if (ev === "rim") { sfx.rim(); bowlPulse = 0.6; }
          else if (ev === "floor") sfx.floor();
          else if (ev === "obstacle") sfx.thud();
        } else if (!reported) {
          settleT += FIXED_DT;
          if (settleT > 0.45) { reported = true; stopFlutter(); resolveThrow(); }
          break;
        } else break;
      }
      if (body && !body.settled) {
        updateFlutter(body.spin, Math.hypot(body.vel.x, body.vel.y, body.vel.z));
      }
    }

    if (state === "aim" && heldIntro < 1) heldIntro = Math.min(1, heldIntro + dt / 0.48);

    for (var i = floaters.length - 1; i >= 0; i--) {
      floaters[i].t += dt;
      if (floaters[i].t > 1.1) floaters.splice(i, 1);
    }
    if (flash > 0) flash = Math.max(0, flash - dt * 1.8);

    draw();
    requestAnimationFrame(frame);
  }





  resize();
  requestAnimationFrame(frame);
})();
