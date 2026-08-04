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

  // ================================================================ AUDIO
  var AC = null, outGain = null, noiseBuf = null;
  var soundOn = true;
  try { if (localStorage.getItem("tc_sound") === "0") soundOn = false; } catch (e) {}

  function initAudio() {
    if (AC) return;
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AC = null; return; }
    outGain = AC.createGain();
    outGain.gain.value = soundOn ? 1 : 0;
    var lp = AC.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 13000; lp.Q.value = 0.6;
    var comp = AC.createDynamicsCompressor();
    comp.threshold.value = -15; comp.knee.value = 26; comp.ratio.value = 3;
    comp.attack.value = 0.003; comp.release.value = 0.22;
    var verb = AC.createConvolver();
    verb.buffer = makeImpulse(1.6, 3.2);
    var vg = AC.createGain(); vg.gain.value = 0.26;
    var hp = AC.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 260;
    var master = AC.createGain(); master.gain.value = 0.9;
    outGain.connect(lp); lp.connect(comp);
    outGain.connect(hp); hp.connect(verb); verb.connect(vg); vg.connect(comp);
    comp.connect(master); master.connect(AC.destination);
    var len = Math.floor(AC.sampleRate * 2);
    noiseBuf = AC.createBuffer(1, len, AC.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  function makeImpulse(dur, decay) {
    var rate = AC.sampleRate, len = Math.max(1, Math.floor(rate * dur));
    var buf = AC.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), prev = 0;
      for (var i = 0; i < len; i++) {
        var t = i / len, env = Math.pow(1 - t, decay);
        prev = prev + 0.3 * ((Math.random() * 2 - 1) - prev);
        d[i] = prev * env;
      }
    }
    return buf;
  }
  function unlockAudio() {
    initAudio();
    if (!AC) return;
    if (AC.state === "suspended") AC.resume();
    try {
      var b = AC.createBuffer(1, 1, 22050), s = AC.createBufferSource();
      s.buffer = b; s.connect(AC.destination); s.start(0);
    } catch (e) {}
  }
  function now_() { return AC ? AC.currentTime : 0; }

  function tone(o) {
    if (!AC || !soundOn) return;
    var t = now_() + (o.at || 0);
    var osc = AC.createOscillator();
    osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + (o.dur || 0.3));
    var g = AC.createGain();
    var a = o.a != null ? o.a : 0.004, d = o.dur || 0.3, peak = o.g != null ? o.g : 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    var node = osc;
    if (o.filt) {
      var fl = AC.createBiquadFilter();
      fl.type = o.filt; fl.frequency.setValueAtTime(o.filtF || 2000, t);
      if (o.filtF2) fl.frequency.exponentialRampToValueAtTime(o.filtF2, t + a + d);
      if (o.filtQ) fl.Q.value = o.filtQ;
      node.connect(fl); node = fl;
    }
    node.connect(g);
    if (o.pan != null && AC.createStereoPanner) {
      var p = AC.createStereoPanner(); p.pan.value = clamp(o.pan, -1, 1);
      g.connect(p); p.connect(outGain);
    } else g.connect(outGain);
    osc.start(t); osc.stop(t + a + d + 0.06);
  }
  function noise(o) {
    if (!AC || !noiseBuf || !soundOn) return;
    var t = now_() + (o.at || 0), dur = o.dur || 0.1;
    var s = AC.createBufferSource();
    s.buffer = noiseBuf;
    var f = AC.createBiquadFilter();
    f.type = o.filt || "bandpass";
    f.frequency.setValueAtTime(o.f || 1800, t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.f2), t + dur);
    if (o.Q) f.Q.value = o.Q;
    var g = AC.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.g != null ? o.g : 0.16), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g);
    if (o.pan != null && AC.createStereoPanner) {
      var p = AC.createStereoPanner(); p.pan.value = clamp(o.pan, -1, 1);
      g.connect(p); p.connect(outGain);
    } else g.connect(outGain);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  // card leaving the hand: air over a thin stiff sheet
  function sndFlick(power) {
    noise({ filt: "bandpass", f: 900, f2: 2600, Q: 0.8, dur: 0.16, g: 0.07 + power * 0.06 });
    noise({ filt: "highpass", f: 3800, dur: 0.05, g: 0.03 + power * 0.03 });
  }
  // china: a soft wooden contact then the bowl's own ring
  function sndBowl(pan) {
    noise({ filt: "bandpass", f: 2400, Q: 1.6, dur: 0.02, g: 0.11, pan: pan });
    [1, 2.71, 5.1].forEach(function (m, i) {
      tone({ type: "sine", f: 620 * m, dur: 0.5 / (1 + i * 0.8), a: 0.002, g: 0.15 / (i + 1), pan: pan });
    });
  }
  function sndRim(pan) {
    noise({ filt: "bandpass", f: 3600, Q: 2.4, dur: 0.03, g: 0.1, pan: pan });
    tone({ type: "sine", f: 1180, f2: 900, dur: 0.12, a: 0.001, g: 0.08, pan: pan });
  }
  function sndFloor(pan) {
    noise({ filt: "lowpass", f: 1500, f2: 500, dur: 0.09, g: 0.11, pan: pan });
    tone({ type: "sine", f: 150, f2: 96, dur: 0.09, a: 0.001, g: 0.09, pan: pan });
  }
  function sndProp(pan) {
    noise({ filt: "bandpass", f: 700, f2: 320, Q: 1.1, dur: 0.08, g: 0.1, pan: pan });
    tone({ type: "triangle", f: 210, f2: 150, dur: 0.1, a: 0.002, g: 0.1, pan: pan });
  }
  function sndRoundEnd(good) {
    var steps = good ? [0, 4, 7, 12] : [0, -2, -5];
    for (var i = 0; i < steps.length; i++) {
      var f = 329.6 * Math.pow(2, steps[i] / 12);
      tone({ type: "triangle", f: f, dur: 0.7, a: 0.008, g: 0.09, at: i * 0.09 });
      tone({ type: "sine", f: f * 2, dur: 0.4, a: 0.005, g: 0.03, at: i * 0.09 });
    }
  }

  soundBtn.addEventListener("click", function () {
    soundOn = !soundOn;
    soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
    try { localStorage.setItem("tc_sound", soundOn ? "1" : "0"); } catch (e) {}
    if (outGain && AC) {
      try { outGain.gain.setTargetAtTime(soundOn ? 1 : 0, now_(), 0.02); }
      catch (e) { outGain.gain.value = soundOn ? 1 : 0; }
    }
    unlockAudio();
  });
  soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");

  // ================================================================ STATE
  var state = "menu";            // menu | aim | fly | done
  var cam = null, dpr = 1, W = 0, H = 0;
  var setup = null, room = null, throwIdx = 0, throws = [], body = null;
  var best = 0, rounds = 0;
  var settleT = 0, flash = 0, bowlPulse = 0, t = 0;
  var floaters = [];
  var drag = null;

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
    var power = clamp((input.speed - 6.5) / 8.5, 0, 1);
    sndFlick(power);
  }

  window.addEventListener("keydown", function (e) {
    if (e.code === "Space" || e.key === " ") {
      e.preventDefault();
      unlockAudio();
      if (state === "menu" || state === "done") ovBtn.click();
    }
  });

  // ============================================================ RESOLUTION
  function panFor(x) { return clamp(x / 2.4, -0.8, 0.8); }

  function resolveThrow() {
    var card = setup.cards[throwIdx];
    var outcome = body.outcome || "miss";
    var pts = pointsFor(card, outcome);
    throws.push({ card: card, outcome: outcome, points: pts });
    if (pts > 0) {
      floaters.push({ x: body.pos.x, y: body.pos.y, z: body.pos.z, txt: "+" + pts, t: 0, col: outcome === "in" ? "#f5a25c" : "#c2a07a" });
    }
    throwIdx++;
    updateHud();
    if (throwIdx >= ROUND_SIZE) endRound();
    else { state = "aim"; body = null; applyWind(); updateHud(); }
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
    sndRoundEnd(inCount >= 5);

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

  // ================================================================== DRAW
  function drawRoom() {
    var img = ART.room;
    if (ready(img)) {
      var scale = Math.max(W / img.naturalWidth, H / img.naturalHeight);
      var dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
      ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } else {
      var g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#071111");
      g.addColorStop(cam.horizon / H, "#0d2021");
      g.addColorStop(1, "#090f0e");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawObstacle() {
    var ob = room.obstacle;
    if (!ob) return;
    var img = ART[ob.kind];
    var base = projectXYZ(cam, ob.x, 0, ob.z);
    var topP = projectXYZ(cam, ob.x, ob.top, ob.z);
    var hpx = Math.max(6, base.sy - topP.sy);
    if (ready(img)) {
      var dw = hpx * (img.naturalWidth / img.naturalHeight);
      ctx.save();
      ctx.filter = "saturate(0.85) brightness(0.72)";
      ctx.drawImage(img, base.sx - dw / 2, topP.sy, dw, hpx);
      ctx.restore();
    } else {
      var w = ob.halfWidth * 2 * base.scale;
      ctx.fillStyle = "rgba(10,16,15,0.9)";
      ctx.fillRect(base.sx - w / 2, topP.sy, w, hpx);
    }
    // contact shadow so it sits on the boards
    ctx.save();
    var sh = ctx.createRadialGradient(base.sx, base.sy, 2, base.sx, base.sy, ob.halfWidth * base.scale * 1.6);
    sh.addColorStop(0, "rgba(0,0,0,0.5)");
    sh.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.ellipse(base.sx, base.sy, ob.halfWidth * base.scale * 1.7, ob.halfWidth * base.scale * 0.5, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawBowl() {
    var base = projectXYZ(cam, room.bowlX, 0, room.bowlZ);
    var rim = projectXYZ(cam, room.bowlX, room.bowlHeight, room.bowlZ);
    var s = base.scale;
    var rx = room.bowlRadius * s * (1 + bowlPulse * 0.08);
    var ry = rx * 0.42;

    ctx.save();
    var sh = ctx.createRadialGradient(base.sx, base.sy + ry * 0.2, rx * 0.2, base.sx, base.sy + ry * 0.2, rx * 1.72);
    sh.addColorStop(0, "rgba(0,0,0,0.5)");
    sh.addColorStop(0.58, "rgba(0,0,0,0.2)");
    sh.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.ellipse(base.sx, base.sy + ry * 0.2, rx * 1.74, ry * 1.04, -0.08, 0, TAU);
    ctx.fill();
    ctx.restore();

    var img = ART.bowl;
    if (ready(img)) {
      var dw = rx * 2.52;
      var dh = dw * (img.naturalHeight / img.naturalWidth);
      ctx.save();
      ctx.filter = "saturate(0.82) contrast(1.08) brightness(0.76)";
      ctx.drawImage(img, base.sx - dw / 2, rim.sy - dh * 0.26, dw, dh);
      ctx.restore();
    } else {
      ctx.fillStyle = "#d8cdbb";
      ctx.beginPath();
      ctx.ellipse(base.sx, rim.sy, rx, ry, 0, 0, TAU);
      ctx.fill();
    }

    if (bowlPulse > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = Math.min(0.34, bowlPulse * 0.34);
      ctx.strokeStyle = "#f5a25c";
      ctx.lineWidth = Math.max(2, rx * 0.1);
      ctx.beginPath();
      ctx.ellipse(base.sx, rim.sy, rx * 1.2, ry * 1.2, 0, 0, TAU);
      ctx.stroke();
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
      var a = pts[i - 1], b = pts[i];
      var f = i / (pts.length - 1);
      ctx.globalAlpha = Math.pow(f, 1.7) * 0.22;
      ctx.strokeStyle = "rgba(255,214,160,1)";
      ctx.lineWidth = Math.max(1, b.scale * (0.012 + f * 0.024));
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCard() {
    if (!body) return;
    var corners = cardCorners(body).map(function (p) { return project(cam, p); });
    // signed area tells us which face we are looking at
    var area = 0;
    for (var i = 0; i < 4; i++) {
      var a = corners[i], b = corners[(i + 1) % 4];
      area += a.sx * b.sy - b.sx * a.sy;
    }
    var faceUp = area < 0;
    var card = setup.cards[Math.min(throwIdx, setup.cards.length - 1)];

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(corners[0].sx, corners[0].sy);
    for (var j = 1; j < 4; j++) ctx.lineTo(corners[j].sx, corners[j].sy);
    ctx.closePath();

    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = Math.max(2, corners[0].scale * 0.02);
    ctx.shadowOffsetY = Math.max(1, corners[0].scale * 0.006);
    ctx.fillStyle = faceUp ? "#f6f2e8" : "#8d2b25";
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // rank + suit, sized to the quad
    var cx = (corners[0].sx + corners[2].sx) / 2;
    var cy = (corners[0].sy + corners[2].sy) / 2;
    var w = Math.hypot(corners[1].sx - corners[0].sx, corners[1].sy - corners[0].sy);
    var h = Math.hypot(corners[3].sx - corners[0].sx, corners[3].sy - corners[0].sy);
    var size = Math.min(w, h);
    if (faceUp && size > 14) {
      var ang = Math.atan2(corners[3].sy - corners[0].sy, corners[3].sx - corners[0].sx) - Math.PI / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang);
      ctx.fillStyle = isRed(card.suit) ? "#b3271f" : "#191512";
      ctx.font = "700 " + Math.round(size * 0.52) + "px Georgia, ui-serif, serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(card.rank + SUIT_GLYPH[card.suit], 0, 0);
      ctx.restore();
    }
  }

  function drawHeld() {
    if (state !== "aim") return;
    var img = ART.hand;
    var card = setup.cards[throwIdx];
    var baseY = H - Math.max(10, H * 0.02);
    var cw = Math.min(W * 0.30, H * 0.17);
    var chh = cw * 1.4;
    var cx = W / 2;
    var lift = drag ? Math.min(30, (drag.samples[0].y - drag.samples[drag.samples.length - 1].y) * 0.35) : 0;
    var cy = baseY - chh * 0.62 - lift;

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 16;
    ctx.fillStyle = "#f6f2e8";
    roundRect(ctx, cx - cw / 2, cy - chh / 2, cw, chh, cw * 0.09);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = isRed(card.suit) ? "#b3271f" : "#191512";
    ctx.font = "700 " + Math.round(cw * 0.3) + "px Georgia, ui-serif, serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(card.rank, cx - cw / 2 + cw * 0.1, cy - chh / 2 + chh * 0.06);
    ctx.font = "700 " + Math.round(cw * 0.26) + "px Georgia, ui-serif, serif";
    ctx.fillText(SUIT_GLYPH[card.suit], cx - cw / 2 + cw * 0.1, cy - chh / 2 + chh * 0.26);
    ctx.textAlign = "center";
    ctx.font = "700 " + Math.round(cw * 0.42) + "px Georgia, ui-serif, serif";
    ctx.fillText(SUIT_GLYPH[card.suit], cx, cy - chh * 0.06);

    // The hand goes ON TOP of the card's lower third — it is holding it, not
    // standing behind it.
    if (ready(img)) {
      var hw = cw * 2.3;
      var hh2 = hw * (img.naturalHeight / img.naturalWidth);
      ctx.drawImage(img, cx - hw * 0.44, cy + chh * 0.12, hw, hh2);
    }
  }

  function drawAimGuide() {
    if (!drag || drag.samples.length < 2) return;
    var a = drag.samples[0];
    var b = drag.samples[drag.samples.length - 1];
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = "#e2a548";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
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

  function roundRect(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawRoom();
    if (!room) return;
    drawObstacle();
    drawBowl();
    drawTrail();
    drawCard();
    drawFloaters();
    drawHeld();
    drawAimGuide();
    if (flash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = flash * 0.16;
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
        stepCard(body, room, FIXED_DT);
        if (body.event) {
          var pan = panFor(body.pos.x);
          if (body.event === "bowl") { sndBowl(pan); bowlPulse = 1; flash = 0.6; }
          else if (body.event === "rim") { sndRim(pan); bowlPulse = 0.5; }
          else if (body.event === "floor") sndFloor(pan);
          else if (body.event === "obstacle") sndProp(pan);
        }
        if (body.settled) break;
      }
      if (body.settled) {
        settleT += dt;
        if (settleT > 0.55) resolveThrow();
      }
    }

    for (var i = floaters.length - 1; i >= 0; i--) {
      floaters[i].t += dt;
      if (floaters[i].t > 1.1) floaters.splice(i, 1);
    }
    if (bowlPulse > 0) bowlPulse = Math.max(0, bowlPulse - dt * 1.6);
    if (flash > 0) flash = Math.max(0, flash - dt * 1.8);

    draw();
    requestAnimationFrame(frame);
  }



  resize();
  requestAnimationFrame(frame);
})();
