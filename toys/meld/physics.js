/* Meld — physics. Glass orbs in an open-topped jar.
 *
 * Circles only, so it is small enough to own. Fixed 480Hz substeps; each one
 * integrates gravity, solves contact VELOCITIES with accumulated impulses
 * (warm-started from the previous substep, which is what lets a tall pile sit
 * still instead of shivering), moves the bodies, then pushes any remaining
 * overlap apart POSITIONALLY so the correction never adds energy.
 *
 * Friction acts at the contact point, so an orb dragged along a wall or over
 * another orb ROLLS. Contacts are speculative: a gap that would close inside
 * this substep is already a contact, so a fast small orb cannot tunnel.
 *
 * Merging is detected here (two of a tier touching) but scored by the game,
 * through world.onMerge(a, b, born). Two top-tier orbs vanish (born = null).
 *
 * Runs in a browser (window.MeldPhysics) and in node (module.exports), so the
 * whole thing can be torture-tested headless with a bot dropping thousands.
 */
(function (root) {
  "use strict";

  var H = 1 / 480;          // substep
  var VI = 8;               // velocity iterations per substep (8 is where every test pile fell fully asleep)
  var PI = 2;               // position iterations per substep
  var SLOP = 0.02;          // overlap left alone, in jar units
  var BETA = 0.45;          // share of the overlap removed per position pass
  var MARGIN = 0.6;         // speculative contact distance
  var GROW_T = 0.11;        // seconds for a fresh orb to swell to full size
  var MERGE_DELAY = 0.1;    // a fresh orb waits this long before it can merge again
  var VMAX = 520;
  var IMPACT = 22;          // closing speed that counts as an audible hit
  // Sleep: an orb that has sat still for a moment freezes solid until something
  // hits it, slides past it or melds near it. Without this a pile never quite
  // stops (solver residue shows up as slow spin and creep, measured).
  var SLEEP_V = 1.6, SLEEP_W = 0.35, SLEEP_T = 0.3, WAKE = 5;

  function World(o) {
    this.W = o.W; this.H = o.H;
    this.radii = o.radii;
    this.top = o.radii.length - 1;
    this.g = o.g || 900;
    this.e = o.e === undefined ? 0.16 : o.e;
    this.mu = o.mu === undefined ? 0.28 : o.mu;
    this.roll = o.roll === undefined ? 2.2 : o.roll;   // rolling resistance while touching
    this.pop = o.pop === undefined ? 1.15 : o.pop;     // how hard a swelling orb shoves
    this.merge = o.merge !== false;
    this.vi = o.vi || VI; this.pi = o.pi || PI; this.beta = o.beta || BETA;
    this.sleep = o.sleep !== false;
    this.warm = o.warm === undefined ? 0.85 : o.warm;
    this.ratio = o.ratio || 2;
    this.bodies = [];
    this.nid = 1;
    this.time = 0;
    this.acc = 0;
    this.pool = [];
    this.nc = 0;
    this.prevN = new Map(); this.prevT = new Map();
    this.nextN = new Map(); this.nextT = new Map();
    this.merges = [];
    this.onMerge = null;
    this.onHit = null;
  }

  World.prototype.clear = function () {
    this.bodies.length = 0;
    this.prevN.clear(); this.prevT.clear(); this.nextN.clear(); this.nextT.clear();
    this.merges.length = 0;
    this.acc = 0;
  };

  World.prototype.add = function (tier, x, y, vx, vy, o) {
    var R = this.radii[tier];
    var r0 = o && o.r0 ? Math.min(R, o.r0) : R;
    var b = {
      id: this.nid++, tier: tier, R: R, r: r0,
      gr: r0 < R ? (R - r0) / GROW_T : 0,
      x: x, y: y, vx: vx || 0, vy: vy || 0,
      a: o && o.a !== undefined ? o.a : Math.random() * Math.PI * 2, w: 0,
      im: 1 / (R * R), iI: 2 / (R * R * R * R),
      born: this.time,
      mergeAt: this.time + (o && o.merged ? MERGE_DELAY : 0),
      merged: !!(o && o.merged),
      dead: false, busy: false, touch: 0, lastHit: -1,
      zz: false, still: 0
    };
    this.bodies.push(b);
    return b;
  };

  World.prototype.wakeAll = function () {
    for (var i = 0; i < this.bodies.length; i++) { this.bodies[i].zz = false; this.bodies[i].still = 0; }
  };

  World.prototype.step = function (dt) {
    this.acc = Math.min(this.acc + dt, 0.12);
    var n = 0;
    while (this.acc >= H && n < 64) { this.sub(); this.acc -= H; n++; }
  };

  function contact(w) {
    var c = w.pool[w.nc];
    if (!c) { c = w.pool[w.nc] = {}; }
    w.nc++;
    return c;
  }

  World.prototype.sub = function () {
    var B = this.bodies, nb = B.length, i, j, a, b, c;
    var g = this.g, W = this.W, HH = this.H;
    this.time += H;

    // grow, then gravity
    for (i = 0; i < nb; i++) {
      b = B[i];
      b.touch = 0;
      if (b.zz) continue;
      if (b.r < b.R) { b.r = Math.min(b.R, b.r + b.gr * H); }
      b.vy += g * H;
    }

    // ---- contacts
    this.nc = 0;
    var tmp = this.prevN; this.prevN = this.nextN; this.nextN = tmp; this.nextN.clear();
    tmp = this.prevT; this.prevT = this.nextT; this.nextT = tmp; this.nextT.clear();
    for (i = 0; i < nb; i++) {
      a = B[i];
      for (j = i + 1; j < nb; j++) {
        b = B[j];
        var dx = b.x - a.x, dy = b.y - a.y, rs = a.r + b.r;
        // two sleepers keep the force between them, so when a meld wakes the
        // pile it wakes already holding itself up instead of sagging a frame
        if (a.zz && b.zz) { if (dx < rs && dx > -rs) carry(this, a.id * 4096 + b.id); continue; }
        if (dx > rs + MARGIN || dx < -rs - MARGIN) continue;
        var d2 = dx * dx + dy * dy, lim = rs + MARGIN;
        if (d2 >= lim * lim) continue;
        var d = Math.sqrt(d2), nx, ny;
        if (d < 1e-6) { nx = 0; ny = 1; d = 0; } else { nx = dx / d; ny = dy / d; }
        // two of a kind touching meld; the game decides what that is worth
        if (this.merge && a.tier === b.tier && d < rs + 0.25 && !a.busy && !b.busy &&
            this.time >= a.mergeAt && this.time >= b.mergeAt) {
          a.busy = b.busy = true;
          this.merges.push(a, b);
        }
        c = contact(this);
        c.a = a; c.b = b; c.nx = nx; c.ny = ny; c.ra = a.r; c.rb = b.r;
        c.pen = rs - d;
        c.key = a.id * 4096 + b.id;
        prep(this, c);
      }
      // the jar: two walls that run up forever, and a floor
      if (a.zz) { carry(this, a.id * 4096 + 4095); carry(this, a.id * 4096 + 4094); carry(this, a.id * 4096 + 4093); continue; }
      if (a.x - a.r < MARGIN) wall(this, a, 1, 0, a.r - a.x, -1);
      if (a.x + a.r > W - MARGIN) wall(this, a, -1, 0, a.x + a.r - W, -2);
      if (a.y + a.r > HH - MARGIN) wall(this, a, 0, -1, a.y + a.r - HH, -3);
    }

    // ---- velocities
    var nc = this.nc, P = this.pool, mu = this.mu, it;
    for (it = 0; it < this.vi; it++) {
      for (i = 0; i < nc; i++) solveVel(P[i], mu);
    }
    for (i = 0; i < nc; i++) {
      c = P[i];
      if (c.jn > 0) { this.nextN.set(c.key, c.jn); this.nextT.set(c.key, c.jt); }
    }

    // ---- move
    var air = 1 - 0.12 * H, spin = 1 - 0.5 * H, roll = 1 - this.roll * H;
    for (i = 0; i < nb; i++) {
      b = B[i];
      if (b.zz) continue;
      var sp = b.vx * b.vx + b.vy * b.vy;
      if (sp > VMAX * VMAX) { var k = VMAX / Math.sqrt(sp); b.vx *= k; b.vy *= k; }
      b.vx *= air; b.vy *= air;
      b.w *= b.touch ? roll : spin;
      b.x += b.vx * H; b.y += b.vy * H; b.a += b.w * H;
    }

    // ---- positions
    for (it = 0; it < this.pi; it++) {
      for (i = 0; i < nc; i++) solvePos(this, P[i], it === 0);
    }
    for (i = 0; i < nb; i++) {
      b = B[i];
      if (b.zz) continue;
      if (b.x < b.r) b.x = b.r; else if (b.x > W - b.r) b.x = W - b.r;
      if (b.y > HH - b.r) b.y = HH - b.r;
      if (this.sleep && b.touch && b.r === b.R &&
          b.vx * b.vx + b.vy * b.vy < SLEEP_V * SLEEP_V && b.w * b.w < SLEEP_W * SLEEP_W) {
        b.still += H;
        if (b.still > SLEEP_T) { b.zz = true; b.vx = b.vy = b.w = 0; }
      } else b.still = 0;
    }

    // ---- meld
    if (this.merges.length) this.meld();
  };

  function wall(w, b, nx, ny, pen, id) {
    var c = contact(w);
    c.a = null; c.b = b; c.nx = nx; c.ny = ny; c.ra = 0; c.rb = b.r;
    c.pen = pen;
    c.key = b.id * 4096 + 4096 + id;   // 4095..4093: a pair key's second id never gets that high
    prep(w, c);
  }

  function carry(w, key) {
    var v = w.prevN.get(key);
    if (v !== undefined) { w.nextN.set(key, v); w.nextT.set(key, w.prevT.get(key)); }
  }

  // effective masses, restitution target, warm start
  function prep(w, c) {
    var a = c.a, b = c.b;
    var vn = relN(c);
    // one side asleep: anything arriving, leaving, sliding past or swelling wakes it
    if (a && (a.zz !== b.zz)) {
      var s = a.zz ? a : b, o = a.zz ? b : a;
      if (vn > WAKE || vn < -WAKE || o.r < o.R || (c.pen > -SLOP && Math.abs(relT(c)) > WAKE)) {
        s.zz = false; s.still = 0;
      }
    }
    c.imA = a && !a.zz ? a.im : 0; c.iIA = a && !a.zz ? a.iI : 0;
    c.imB = b.zz ? 0 : b.im; c.iIB = b.zz ? 0 : b.iI;
    c.kn = 1 / (c.imA + c.imB);
    c.kt = 1 / (c.imA + c.imB + c.ra * c.ra * c.iIA + c.rb * c.rb * c.iIB);
    var touching = c.pen > -SLOP;
    if (touching) { b.touch++; if (a) a.touch++; }
    var was = w.prevN.get(c.key);
    // A gap still open is a speed limit: close it this substep and no faster.
    // Bounce belongs to a FRESH impact only: applied to resting contacts it
    // turned solver residue into a bounce that never died (measured: with it,
    // whole piles never fell asleep).
    c.target = c.pen < 0 ? c.pen / H : (was === undefined && vn < -IMPACT * 0.6 ? -w.e * vn : 0);
    c.jn = 0; c.jt = 0;
    if (was !== undefined && touching) {
      c.jn = was * w.warm; c.jt = w.prevT.get(c.key) * w.warm;
      apply(c, c.jn * c.nx - c.jt * c.ny, c.jn * c.ny + c.jt * c.nx);
    }
    // a hit is the substep a gap actually closes, at the speed it closed with
    // (measured here, before the speculative limit has trimmed it)
    if (was === undefined && vn < -IMPACT && c.pen - vn * H > 0 && w.onHit) {
      if (w.time - b.lastHit > 0.06 && (!a || w.time - a.lastHit > 0.06)) {
        b.lastHit = w.time; if (a) a.lastHit = w.time;
        w.onHit(a, b, -vn);
      }
    }
  }

  // relative velocity along the normal at the contact point (rotation adds
  // nothing along the normal for circles)
  function relN(c) {
    var a = c.a, b = c.b;
    var vx = b.vx - (a ? a.vx : 0), vy = b.vy - (a ? a.vy : 0);
    return vx * c.nx + vy * c.ny;
  }
  // and along the tangent, where rotation is the whole story
  function relT(c) {
    var a = c.a, b = c.b, tx = -c.ny, ty = c.nx;
    // velocity of each surface at the contact: v + w x r, with rA = +n ra, rB = -n rb
    var vbx = b.vx + b.w * c.ny * c.rb, vby = b.vy - b.w * c.nx * c.rb;
    var vax = 0, vay = 0;
    if (a) { vax = a.vx - a.w * c.ny * c.ra; vay = a.vy + a.w * c.nx * c.ra; }
    return (vbx - vax) * tx + (vby - vay) * ty;
  }

  // push impulse (px, py) onto B and its opposite onto A, with the torque
  function apply(c, px, py) {
    var a = c.a, b = c.b;
    // rB = -n rb: cross(rB, P) = -rb (nx py - ny px)
    var tq = c.nx * py - c.ny * px;
    b.vx += px * c.imB; b.vy += py * c.imB; b.w += -c.rb * tq * c.iIB;
    if (a) { a.vx -= px * c.imA; a.vy -= py * c.imA; a.w -= c.ra * tq * c.iIA; }
  }

  function solveVel(c, mu) {
    var vn = relN(c);
    var dj = (c.target - vn) * c.kn;
    var jn = Math.max(0, c.jn + dj);
    dj = jn - c.jn; c.jn = jn;
    if (dj) apply(c, dj * c.nx, dj * c.ny);
    if (c.jn <= 0 && c.jt === 0) return;
    var vt = relT(c);
    var dt = -vt * c.kt;
    var max = mu * c.jn;
    var jt = Math.max(-max, Math.min(max, c.jt + dt));
    dt = jt - c.jt; c.jt = jt;
    if (dt) apply(c, -dt * c.ny, dt * c.nx);
  }

  function solvePos(w, c, first) {
    var a = c.a, b = c.b, nx, ny, pen;
    if (a) {
      var dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy);
      if (d < 1e-6) { nx = 0; ny = 1; } else { nx = dx / d; ny = dy / d; }
      pen = a.r + b.r - d;
    } else {
      nx = c.nx; ny = c.ny;
      pen = c.nx ? (c.nx > 0 ? b.r - b.x : b.x + b.r - w.W) : b.y + b.r - w.H;
    }
    if (pen <= SLOP) return;
    var imA = a && !a.zz ? a.im : 0, imB = b.zz ? 0 : b.im;
    // A big orb on small ones would barely move (mass-weighted), so the small
    // ones get shoved into the floor and back every pass and the big one sinks
    // into them. Cap the ratio for overlap only; momentum stays physical.
    if (imA && imB) {
      if (imA > imB * w.ratio) imA = imB * w.ratio;
      else if (imB > imA * w.ratio) imB = imA * w.ratio;
    }
    var s = imA + imB;
    if (!s) return;
    var corr = w.beta * (pen - SLOP) / s;
    if (imA) { a.x -= nx * corr * imA; a.y -= ny * corr * imA; }
    if (imB) { b.x += nx * corr * imB; b.y += ny * corr * imB; }
    // a swelling orb SHOVES: that is the pressure release that can launch a
    // neighbour, which is half the drama of the genre
    if (first && a) {
      var grow = (a.r < a.R ? a.gr : 0) - (b.r < b.R ? b.gr : 0);
      if (grow) {
        var out = Math.abs(grow) * w.pop, o = grow > 0 ? b : a, sg = grow > 0 ? 1 : -1;
        if (o.zz) { o.zz = false; o.still = 0; }
        var vn = o.vx * nx * sg + o.vy * ny * sg;
        if (vn < out) { o.vx += nx * sg * (out - vn); o.vy += ny * sg * (out - vn); }
      }
    }
  }

  World.prototype.meld = function () {
    var M = this.merges, i, a, b, born;
    for (i = 0; i < M.length; i += 2) {
      a = M[i]; b = M[i + 1];
      if (a.dead || b.dead) continue;
      a.dead = b.dead = true;
      born = null;
      if (a.tier < this.top) {
        var x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
        x = Math.max(a.R, Math.min(this.W - a.R, x)); y = Math.min(this.H - a.R, y);
        born = this.add(a.tier + 1, x, y, (a.vx + b.vx) / 2, (a.vy + b.vy) / 2,
          { r0: a.R, merged: true, a: (a.a + b.a) / 2 });
        born.w = (a.w + b.w) * 0.25;
      }
      if (this.onMerge) this.onMerge(a, b, born);
    }
    M.length = 0;
    var B = this.bodies, k = 0;
    for (i = 0; i < B.length; i++) { if (!B[i].dead) B[k++] = B[i]; else B[i].busy = false; }
    B.length = k;
    // a vanished orb can leave anything above it unsupported, so all wake
    for (i = 0; i < B.length; i++) { B[i].busy = false; B[i].zz = false; B[i].still = 0; }
  };

  // the first surface straight below x: where an orb dropped there will land
  World.prototype.landing = function (x, r) {
    var B = this.bodies, best = this.H - r, i;
    for (i = 0; i < B.length; i++) {
      var b = B[i], dx = Math.abs(b.x - x), rs = b.r + r;
      if (dx >= rs) continue;
      var y = b.y - Math.sqrt(rs * rs - dx * dx);
      if (y < best) best = y;
    }
    return best;
  };

  var api = { World: World, H: H };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MeldPhysics = api;
})(typeof window !== "undefined" ? window : this);
