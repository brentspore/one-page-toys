/* engine.js — the regulars at the teahouse, in a Worker so a thinking opponent never
   costs the board a frame. If a Worker cannot start, the page loads this same file
   as a script and calls GoEngine.think() directly.

   Monte Carlo tree search (UCT with RAVE / AMAF) over light playouts.

   The playout board is its own fast structure, not core.js: every group keeps its
   liberties as a 128-bit set (four Int32 words; the padded board has 121 cells), so
   a merge is an OR, a liberty count is a popcount, and "what would this group's
   liberties be if I played here" is a few ORs with no flood fill. Playouts check the
   simple ko only; the root's moves come from the page, which applies positional
   superko with core.js.

   The playout policy is light but not blind:
   - never fill your own true single-point eye;
   - if the last move left its own group in atari, take it;
   - if the last move put one of your groups in atari, run, when running gives it
     two liberties or more;
   - do not self-atari a group of two or more stones (a single-stone throw-in is fine);
   - otherwise, a uniformly random legal move.
   The weakest regulars play their playouts with less of this, which is most of what
   makes them weak.

   Ownership: every playout's final board is counted point by point, so each search
   also says who it thinks will own each point. That feeds the Territory view and the
   dead-stone estimate at the end. */
(function (root) {
  "use strict";
  if (!root.GoCore && typeof importScripts === "function") importScripts("core.js?v=1");
  var K = root.GoCore;
  var S = K.S, SZ = K.SZ, EMPTY = 0, BLACK = 1, WHITE = 2, EDGE = 3, PASS = 0;
  var POINTS = K.POINTS, NP = POINTS.length;
  var DIRS = K.DIRS, DIAG = K.DIAG;

  /* ---------- the regulars ----------
     playouts: the search budget; timeMs: a ceiling on think time (it only matters on a
     slow phone); policy: 0 = eyes only, 1 = half the heuristics, 2 = all of them;
     temp: choose among root moves in proportion to visits^(1/temp) (0 = the most
     visited); blunder: the chance of a random sensible move instead.
     Ranks are rough guesses. Tuned by engine-against-engine matches (see toys-log). */
  var P = {
    hana:  { playouts: 160,   timeMs: 600,  policy: 0, temp: 1.0,  blunder: 0.12 },
    ota:   { playouts: 600,   timeMs: 900,  policy: 1, temp: 0.5,  blunder: 0.04 },
    emiko: { playouts: 1800,  timeMs: 1100, policy: 2, temp: 0.25, blunder: 0.01 },
    saito: { playouts: 4000,  timeMs: 1500, policy: 2, temp: 0.15, blunder: 0 },
    lin:   { playouts: 12000, timeMs: 2000, policy: 2, temp: 0,    blunder: 0 },
    kenji: { playouts: 36000, timeMs: 2400, policy: 2, temp: 0,    blunder: 0 }
  };

  /* ---------- random numbers ---------- */
  var rs = (Date.now() ^ 0x9e3779b9) | 0 || 1;
  function rnd() { rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5; return (rs >>> 0) / 4294967296; }
  function seedRandom(s) { rs = (s | 0) || 1; }

  /* ---------- bit tricks ---------- */
  function pop(x) {
    x = x - ((x >>> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    return Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
  }
  function low(x) { return 31 - Math.clz32(x & -x); }

  /* ---------- 3x3 shape patterns ----------
     The well-known playout shapes (hane, cuts, edge blocks), as written down for the
     early Monte Carlo programs. Around the last move, a point whose 3x3 neighborhood
     matches one of these is usually the local answer, so playouts try it first.
     X and O are the two colors (either way round), x is "not X", o is "not O", ?
     is anything, and a space is the edge. The center is always empty. */
  var PATS = [
    ["XOX", "...", "???"], ["XO.", "...", "?.?"], ["XO?", "X..", "x.?"], [".O.", "X..", "..."],
    ["XO?", "O.o", "?o?"], ["XO?", "O.X", "???"], ["?X?", "O.O", "ooo"], ["OX?", "o.O", "???"],
    ["X.?", "O.?", "   "], ["OX?", "X.O", "   "], ["?X?", "x.O", "   "], ["?XO", "x.x", "   "], ["?OX", "X.O", "   "]
  ];
  var PAT = new Uint8Array(65536);
  (function buildPatterns() {
    var V = { ".": 0, "X": 1, "O": 2, " ": 3 };
    function rot(p) { return [p[2][0] + p[1][0] + p[0][0], p[2][1] + p[1][1] + p[0][1], p[2][2] + p[1][2] + p[0][2]]; }
    function vflip(p) { return [p[2], p[1], p[0]]; }
    function hflip(p) { return p.map(function (l) { return l.split("").reverse().join(""); }); }
    function swap(p) { return p.map(function (l) { return l.replace(/X/g, "Z").replace(/x/g, "z").replace(/O/g, "X").replace(/o/g, "x").replace(/Z/g, "O").replace(/z/g, "o"); }); }
    function wild(str, out) {
      var i = str.search(/[?xo]/);
      if (i < 0) { out.push(str); return; }
      var ch = str[i], opts = ch === "?" ? ".XO " : ch === "x" ? ".O " : ".X ";
      for (var k = 0; k < opts.length; k++) wild(str.slice(0, i) + opts[k] + str.slice(i + 1), out);
    }
    PATS.forEach(function (p0) {
      [p0, rot(p0)].forEach(function (p1) {
        [p1, vflip(p1)].forEach(function (p2) {
          [p2, hflip(p2)].forEach(function (p3) {
            [p3, swap(p3)].forEach(function (p4) {
              var all = []; wild(p4.join(""), all);
              all.forEach(function (s) {
                /* s: NW N NE W C E SW S SE */
                var order = [0, 1, 2, 3, 5, 6, 7, 8], code = 0;
                for (var k = 0; k < 8; k++) code |= V[s[order[k]]] << (2 * k);
                PAT[code] = 1;
              });
            });
          });
        });
      });
    });
  })();
  var NB8 = [-S - 1, -S, -S + 1, -1, 1, S - 1, S, S + 1];
  function patAt(c, q) {
    var code = 0;
    for (var k = 0; k < 8; k++) code |= c[q + NB8[k]] << (2 * k);
    return PAT[code];
  }

  /* ---------- the fast board ---------- */
  function Board() {
    this.c = new Uint8Array(SZ);       /* color */
    this.gid = new Int16Array(SZ);     /* the group's representative point */
    this.nxt = new Int16Array(SZ);     /* next stone in the group, a ring */
    this.gsz = new Int16Array(SZ);     /* stones in the group (at the representative) */
    this.lib = new Int32Array(SZ * 4); /* the group's liberties (at the representative) */
    this.emp = new Int16Array(SZ);     /* the empty points, in any order */
    this.epos = new Int16Array(SZ);
    this.ne = 0;
    this.ko = 0; this.turn = BLACK; this.last = 0; this.passes = 0;
  }
  Board.prototype.copyFrom = function (o) {
    this.c.set(o.c); this.gid.set(o.gid); this.nxt.set(o.nxt); this.gsz.set(o.gsz); this.lib.set(o.lib);
    this.emp.set(o.emp); this.epos.set(o.epos); this.ne = o.ne;
    this.ko = o.ko; this.turn = o.turn; this.last = o.last; this.passes = o.passes;
  };
  Board.prototype.clear = function () {
    var c = this.c; c.fill(EDGE); this.lib.fill(0); this.ne = 0;
    for (var i = 0; i < NP; i++) { var p = POINTS[i]; c[p] = EMPTY; this.emp[this.ne] = p; this.epos[p] = this.ne++; }
    this.ko = 0; this.turn = BLACK; this.last = 0; this.passes = 0;
  };
  Board.prototype.libs = function (r) {
    var L = this.lib, k = r << 2;
    return pop(L[k]) + pop(L[k + 1]) + pop(L[k + 2]) + pop(L[k + 3]);
  };
  Board.prototype.firstLib = function (r) {
    var L = this.lib, k = r << 2;
    for (var w = 0; w < 4; w++) if (L[k + w]) return (w << 5) + low(L[k + w]);
    return 0;
  };
  Board.prototype.delEmpty = function (p) {
    var i = this.epos[p], q = this.emp[--this.ne];
    this.emp[i] = q; this.epos[q] = i;
  };
  Board.prototype.addEmpty = function (p) { this.emp[this.ne] = p; this.epos[p] = this.ne++; };
  /* lay a stone with no captures (building a position) */
  Board.prototype.place = function (p, col) {
    var c = this.c, L = this.lib;
    this.delEmpty(p);
    c[p] = col; this.gid[p] = p; this.nxt[p] = p; this.gsz[p] = 1;
    var k = p << 2; L[k] = L[k + 1] = L[k + 2] = L[k + 3] = 0;
    for (var d = 0; d < 4; d++) {
      var q = p + DIRS[d], v = c[q];
      if (v === EMPTY) L[k + (q >> 5)] |= 1 << (q & 31);
      else if (v === BLACK || v === WHITE) { var r = this.gid[q]; L[(r << 2) + (p >> 5)] &= ~(1 << (p & 31)); }
    }
    for (var e = 0; e < 4; e++) {
      var q2 = p + DIRS[e];
      if (c[q2] === col) { var a = this.gid[p], b = this.gid[q2]; if (a !== b) this.merge(a, b); }
    }
  };
  Board.prototype.merge = function (a, b) {
    if (this.gsz[a] < this.gsz[b]) { var t = a; a = b; b = t; }
    var gid = this.gid, nxt = this.nxt, s = b;
    do { gid[s] = a; s = nxt[s]; } while (s !== b);
    var tmp = nxt[a]; nxt[a] = nxt[b]; nxt[b] = tmp;
    this.gsz[a] += this.gsz[b];
    var L = this.lib, ka = a << 2, kb = b << 2;
    L[ka] |= L[kb]; L[ka + 1] |= L[kb + 1]; L[ka + 2] |= L[kb + 2]; L[ka + 3] |= L[kb + 3];
  };
  Board.prototype.remove = function (r) {
    var c = this.c, nxt = this.nxt, gid = this.gid, L = this.lib, s = r, n = 0;
    do { c[s] = EMPTY; this.addEmpty(s); n++; s = nxt[s]; } while (s !== r);
    s = r;
    do {
      for (var d = 0; d < 4; d++) {
        var q = s + DIRS[d], v = c[q];
        if (v === BLACK || v === WHITE) { var g = gid[q]; L[(g << 2) + (s >> 5)] |= 1 << (s & 31); }
      }
      s = nxt[s];
    } while (s !== r);
    return n;
  };
  /* play p for the side to move; the caller has checked it is legal */
  var lastCaps = 0;
  Board.prototype.play = function (p) {
    var col = this.turn, opp = 3 - col, c = this.c;
    this.place(p, col);
    var caps = 0, capAt = 0;
    for (var d = 0; d < 4; d++) {
      var q = p + DIRS[d];
      if (c[q] === opp) {
        var r = this.gid[q];
        if (this.libs(r) === 0) { if (this.gsz[r] === 1) capAt = r; caps += this.remove(r); }
      }
    }
    var g = this.gid[p];
    this.ko = caps === 1 && this.gsz[g] === 1 && this.libs(g) === 1 ? capAt : 0;
    this.turn = opp; this.last = p; this.passes = 0;
    lastCaps = caps;
    return caps;
  };
  Board.prototype.pass = function () { this.turn = 3 - this.turn; this.ko = 0; this.last = PASS; this.passes++; };
  Board.prototype.load = function (b, turn) {
    this.clear();
    for (var i = 0; i < NP; i++) { var p = POINTS[i]; if (b[p] === BLACK || b[p] === WHITE) this.place(p, b[p]); }
    this.turn = turn;
  };
  /* legal for `col`: empty, not the ko point, not suicide */
  Board.prototype.legal = function (p, col) {
    var c = this.c;
    if (c[p] !== EMPTY || p === this.ko) return false;
    for (var d = 0; d < 4; d++) {
      var q = p + DIRS[d], v = c[q];
      if (v === EMPTY) return true;
      if (v === col) { if (this.libs(this.gid[q]) > 1) return true; }
      else if (v !== EDGE) { if (this.libs(this.gid[q]) === 1) return true; }
    }
    return false;
  };
  Board.prototype.eye = function (p, col) {
    var c = this.c;
    for (var d = 0; d < 4; d++) { var v = c[p + DIRS[d]]; if (v !== col && v !== EDGE) return false; }
    var bad = 0, edge = 0;
    for (var e = 0; e < 4; e++) { var w = c[p + DIAG[e]]; if (w === EDGE) edge = 1; else if (w !== col && w !== EMPTY) bad++; }
    return bad + edge < 2;
  };
  /* Liberties `col` would have at p after playing there: 99 if it captures. Leaves the
     merged size in afterSize. */
  var afterSize = 0;
  Board.prototype.libsAfter = function (p, col) {
    var c = this.c, L = this.lib, gid = this.gid;
    var t0 = 0, t1 = 0, t2 = 0, t3 = 0, size = 1, r0 = -1, r1 = -1, r2 = -1;
    for (var d = 0; d < 4; d++) {
      var q = p + DIRS[d], v = c[q];
      if (v === EMPTY) {
        var w = q >> 5, bit = 1 << (q & 31);
        if (w === 0) t0 |= bit; else if (w === 1) t1 |= bit; else if (w === 2) t2 |= bit; else t3 |= bit;
      } else if (v === col) {
        var r = gid[q];
        if (r === r0 || r === r1 || r === r2) continue;
        if (r0 < 0) r0 = r; else if (r1 < 0) r1 = r; else r2 = r;
        var k = r << 2;
        t0 |= L[k]; t1 |= L[k + 1]; t2 |= L[k + 2]; t3 |= L[k + 3];
        size += this.gsz[r];
      } else if (v !== EDGE) {
        if (this.libs(gid[q]) === 1) { afterSize = size; return 99; }
      }
    }
    var pw = p >> 5, pb = ~(1 << (p & 31));
    if (pw === 0) t0 &= pb; else if (pw === 1) t1 &= pb; else if (pw === 2) t2 &= pb; else t3 &= pb;
    afterSize = size;
    return pop(t0) + pop(t1) + pop(t2) + pop(t3);
  };
  /* area score at the end of a playout, Black's margin before komi */
  Board.prototype.area = function (own) {
    var c = this.c, s = 0;
    for (var i = 0; i < NP; i++) {
      var p = POINTS[i], v = c[p], o = 0;
      if (v === BLACK) o = 1;
      else if (v === WHITE) o = -1;
      else {
        var hb = 0, hw = 0;
        for (var d = 0; d < 4; d++) { var w = c[p + DIRS[d]]; if (w === BLACK) hb = 1; else if (w === WHITE) hw = 1; }
        o = hb && !hw ? 1 : hw && !hb ? -1 : 0;
      }
      s += o;
      if (own) own[p] += o;
    }
    return s;
  };

  /* ---------- the playout ---------- */
  var SEQ_MAX = 1024;
  var seqP = new Int16Array(SEQ_MAX), seqC = new Uint8Array(SEQ_MAX), seqLen = 0;

  var cand = new Int16Array(8);
  function choose(bd, col, policy) {
    var c = bd.c;
    if (policy > 0) {
      var L = bd.last, strong = policy === 2 ? 1 : 0.5;
      if (L && c[L] === 3 - col && rnd() < strong) {
        /* take the group that was just played, if it is in atari */
        var r = bd.gid[L];
        if (bd.libs(r) === 1) { var q = bd.firstLib(r); if (bd.legal(q, col)) return q; }
        /* run with a group of ours the last move put in atari */
        for (var d = 0; d < 4; d++) {
          var n = L + DIRS[d];
          if (c[n] !== col) continue;
          var g = bd.gid[n];
          if (bd.libs(g) !== 1) continue;
          var lp = bd.firstLib(g);
          if (bd.legal(lp, col) && bd.libsAfter(lp, col) >= 2) return lp;
        }
      }
      /* a good shape next to the last move */
      if (L && policy === 2 && rnd() < 0.95) {
        var nc = 0;
        for (var e = 0; e < 8; e++) {
          var q2 = L + NB8[e];
          if (c[q2] === EMPTY && q2 !== bd.ko && patAt(c, q2)) cand[nc++] = q2;
        }
        while (nc > 0) {
          var ci = (rnd() * nc) | 0, pq = cand[ci];
          cand[ci] = cand[--nc];
          if (!bd.legal(pq, col) || bd.eye(pq, col)) continue;
          if (bd.libsAfter(pq, col) <= 1 && afterSize >= 2 && rnd() < 0.9) continue;
          return pq;
        }
      }
    }
    var cnt = bd.ne, emp = bd.emp, epos = bd.epos;
    var avoid = policy === 2 ? 1 : policy === 1 ? 0.5 : 0;
    while (cnt > 0) {
      var k = (rnd() * cnt) | 0, p = emp[k];
      if (bd.legal(p, col) && !bd.eye(p, col)) {
        if (!avoid || bd.libsAfter(p, col) > 1 || afterSize < 2 || rnd() >= avoid) return p;
      }
      /* set it aside for this turn */
      var last = emp[--cnt];
      emp[k] = last; epos[last] = k; emp[cnt] = p; epos[p] = cnt;
    }
    return PASS;
  }

  var MAX_PLAYOUT = 260;
  function playout(bd, policy) {
    var n = 0;
    while (bd.passes < 2 && n < MAX_PLAYOUT) {
      var col = bd.turn, p = choose(bd, col, policy);
      if (p === PASS) bd.pass(); else bd.play(p);
      if (seqLen < SEQ_MAX) { seqP[seqLen] = p; seqC[seqLen] = col; seqLen++; }
      n++;
    }
  }

  /* ---------- the tree ---------- */
  var MAXN = 500000;
  var nMove = new Int16Array(MAXN), nFirst = new Int32Array(MAXN), nKids = new Int16Array(MAXN);
  var nN = new Float32Array(MAXN), nW = new Float32Array(MAXN);     /* with the prior */
  var nV = new Int32Array(MAXN), nWr = new Float32Array(MAXN);      /* real visits and wins */
  var nRN = new Float32Array(MAXN), nRW = new Float32Array(MAXN);   /* AMAF */
  var used = 0;
  var RAVE_EQ = 900, EXPAND_AT = 3, UCB_C = 0.12, PRIOR_N = 18;
  var rootBd = new Board(), bd = new Board(), tmpBd = new Board();
  var rootLegal = new Uint8Array(SZ), rootRestrict = false;
  var own = new Float64Array(SZ), ownN = 0;
  var fst = new Uint8Array(SZ), fstS = new Int32Array(SZ), fstStamp = 1;
  var path = new Int32Array(512);

  function nearStones(b, p, dist) {
    var x = K.px(p), y = K.py(p);
    for (var dy = -dist; dy <= dist; dy++) for (var dx = -dist; dx <= dist; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > dist || (!dx && !dy)) continue;
      var xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx > 8 || yy > 8) continue;
      var v = b.c[K.pt(xx, yy)];
      if (v === BLACK || v === WHITE) return true;
    }
    return false;
  }

  /* the prior for col playing p: [visits, wins] */
  function prior(b, p, col) {
    var v = 0.5;
    var la = b.libsAfter(p, col);
    if (la === 99) v = 0.85;
    else {
      /* a group of ours in atari that this move rescues */
      for (var d = 0; d < 4; d++) {
        var q = p + DIRS[d];
        if (b.c[q] === col && b.libs(b.gid[q]) === 1 && la >= 2) { v = 0.75; break; }
      }
      if (la <= 1 && afterSize >= 2) v = 0.12;
      else if (la === 1) v = Math.min(v, 0.35);
    }
    var x = K.px(p), y = K.py(p), line = Math.min(x, y, 8 - x, 8 - y);
    if (line === 0 && v <= 0.5 && !nearStones(b, p, 2)) v = 0.2;
    else if (line === 1 && v <= 0.5 && !nearStones(b, p, 2)) v = 0.4;
    if (b.last && v <= 0.5) {
      var lx = K.px(b.last), ly = K.py(b.last);
      if (Math.abs(lx - x) <= 1 && Math.abs(ly - y) <= 1) v = patAt(b.c, p) ? 0.68 : v + 0.08;
    }
    return v;
  }

  function newNode(move, priorV) {
    var i = used++;
    nMove[i] = move; nFirst[i] = -1; nKids[i] = 0;
    nN[i] = PRIOR_N; nW[i] = PRIOR_N * priorV; nV[i] = 0; nWr[i] = 0; nRN[i] = 0; nRW[i] = 0;
    return i;
  }
  /* children for the side to move on b; false when the tree is full */
  function expand(i, b, isRoot) {
    var col = b.turn, first = used, count = 0;
    if (used + NP + 1 >= MAXN) return false;
    for (var k = 0; k < NP; k++) {
      var p = POINTS[k];
      if (isRoot && rootRestrict && !rootLegal[p]) continue;
      if (!b.legal(p, col) || b.eye(p, col)) continue;
      newNode(p, prior(b, p, col)); count++;
    }
    if (!count) { newNode(PASS, 0.5); count = 1; }
    nFirst[i] = first; nKids[i] = count;
    return true;
  }
  function select(i) {
    var f = nFirst[i], n = nKids[i], best = f, bv = -1e9;
    var lp = Math.log(nV[i] + 1);
    for (var k = f; k < f + n; k++) {
      var q = nW[k] / nN[k];
      var rn = nRN[k];
      if (rn > 0) { var beta = rn / (rn + nN[k] + rn * nN[k] / RAVE_EQ); q = (1 - beta) * q + beta * nRW[k] / rn; }
      var v = q + UCB_C * Math.sqrt(lp / (nV[k] + 1));
      if (v > bv) { bv = v; best = k; }
    }
    return best;
  }

  function simulate(policy) {
    bd.copyFrom(rootBd);
    var depth = 0, node = 0, rootCol = rootBd.turn;
    path[0] = 0; seqLen = 0;
    var terminal = false;
    while (true) {
      if (nFirst[node] < 0) {
        if (node !== 0 && nV[node] < EXPAND_AT) break;
        if (!expand(node, bd, node === 0)) break;
      }
      var ch = select(node), m = nMove[ch], col = bd.turn;
      if (m === PASS) bd.pass(); else bd.play(m);
      seqP[seqLen] = m; seqC[seqLen] = col; seqLen++;
      path[++depth] = ch; node = ch;
      if (bd.passes >= 2) { terminal = true; break; }
      if (depth >= 500) break;
    }
    if (!terminal) playout(bd, policy);
    var margin = bd.area(own) - komi;
    ownN++;
    var winner = margin > 0 ? BLACK : WHITE;
    /* back up, with AMAF: a child of a node on the path is credited when its move was
       first played, at or after that node, by the side to move there */
    fstStamp++;
    var j = seqLen - 1;
    for (var d = depth; d >= 0; d--) {
      while (j >= d) { var sp = seqP[j]; if (sp) { fst[sp] = seqC[j]; fstS[sp] = fstStamp; } j--; }
      var nd = path[d];
      var toMove = (d & 1) ? 3 - rootCol : rootCol;      /* side to move at nd */
      if (d > 0) {
        var mover = 3 - toMove, won = winner === mover ? 1 : 0;
        nN[nd] += 1; nW[nd] += won; nV[nd] += 1; nWr[nd] += won;
      } else nV[nd] += 1;
      if (nFirst[nd] >= 0) {
        var f = nFirst[nd], n = nKids[nd], w2 = winner === toMove ? 1 : 0;
        for (var k = f; k < f + n; k++) {
          var mv = nMove[k];
          if (mv && fstS[mv] === fstStamp && fst[mv] === toMove) { nRN[k] += 1; nRW[k] += w2; }
        }
      }
    }
  }

  var komi = 7.5;
  function now() { return typeof performance !== "undefined" ? performance.now() : Date.now(); }

  /* plain playouts from the root position, for ownership only */
  function ownership(n, policy) {
    for (var i = 0; i < n; i++) {
      bd.copyFrom(rootBd);
      if (i & 1) { bd.turn = 3 - bd.turn; bd.ko = 0; }
      seqLen = 0;
      playout(bd, policy);
      bd.area(own); ownN++;
    }
  }
  function ownArray() {
    var out = new Array(SZ);
    for (var i = 0; i < SZ; i++) out[i] = ownN ? Math.round(own[i] / ownN * 1000) / 1000 : 0;
    return out;
  }
  function resetOwn() { own.fill(0); ownN = 0; }

  /* The engine's own count: take off stones its playouts mostly lose, then area-count. */
  function estimate(b, ownv, km) {
    var dead = new Uint8Array(SZ);
    for (var i = 0; i < NP; i++) {
      var p = POINTS[i];
      if (b[p] === BLACK && ownv[p] < 0) dead[p] = 1;
      else if (b[p] === WHITE && ownv[p] > 0) dead[p] = 1;
    }
    return K.score(b, km, dead);
  }

  /* ---------- the root ---------- */
  function think(msg) {
    var who = P[msg.who] || P.kenji;
    var t0 = now();
    komi = msg.komi != null ? msg.komi : 7.5;
    rootBd.load(msg.b, msg.turn);
    rootBd.passes = msg.passes || 0;
    rootBd.last = msg.last > 0 ? msg.last : 0;
    rootLegal.fill(0); rootRestrict = !!msg.legal;
    if (msg.legal) for (var i = 0; i < msg.legal.length; i++) rootLegal[msg.legal[i]] = 1;
    if (msg.seed) seedRandom(msg.seed);
    used = 0; resetOwn();
    newNode(rootBd.last, 0.5);
    var budget = msg.playouts || who.playouts, limit = msg.timeMs || who.timeMs;
    var policy = msg.policy != null ? msg.policy : who.policy;
    var sims = 0;
    expand(0, rootBd, true);
    var col = rootBd.turn;
    /* nothing to play but passing */
    if (nKids[0] === 1 && nMove[nFirst[0]] === PASS) {
      ownership(1200, 2);
      return result(PASS, 0.5, 0, t0, "nomoves", msg);
    }
    while (sims < budget) {
      simulate(policy);
      sims++;
      if ((sims & 63) === 0 && now() - t0 > limit) break;
    }
    /* the dumb playouts of the weakest regulars give a poor map; top it up for the
       pass and resign decisions (it does not change the move they chose) */
    var searchOwn = ownN;
    if (searchOwn < 1500) ownership(1500 - searchOwn, 2);
    var ownv = ownArray();

    /* the candidates, most visited first */
    var f = nFirst[0], n = nKids[0], kids = [];
    for (var k = f; k < f + n; k++) kids.push(k);
    kids.sort(function (a, b) { return nV[b] - nV[a]; });
    var best = kids[0];
    var wr = nV[best] ? nWr[best] / nV[best] : 0.5;

    /* passing: when the other side has just passed and we are ahead on our own count,
       or when no move left is worth anything */
    var useful = kids.filter(function (k2) { return isUseful(nMove[k2], ownv); });
    var est = estimate(msg.b, ownv, komi);
    var ahead = est.winner === col;
    var early = (msg.moveNum || 0) < 12;
    if (!early && ((msg.passes >= 1 && ahead) || !useful.length)) {
      return result(PASS, wr, sims, t0, msg.passes >= 1 && ahead ? "ahead" : "settled", msg, ownv, est);
    }
    var pick = best;
    /* the search often rates a stone dropped into its own settled area as good as
       anything (under area scoring it costs nothing); a person would play something
       that matters, so take a live move when one is about as good */
    if (useful.length && !isUseful(nMove[best], ownv)) {
      var alt = useful[0], awr = nV[alt] ? nWr[alt] / nV[alt] : 0;
      if (awr >= wr - 0.04) pick = alt;
    }
    var pool = useful.length ? useful : kids;
    if (who.blunder && rnd() < who.blunder) {
      /* a beginner's move: anything that is not a plain self-atari */
      var sane = pool.filter(function (k3) { var m = nMove[k3]; return m && (rootBd.libsAfter(m, col) > 1 || afterSize < 2); });
      if (sane.length) pick = sane[(rnd() * sane.length) | 0];
    } else if (who.temp > 0) {
      var top = pool.slice(0, 12), sum = 0;
      var wts = top.map(function (k4) { var w = Math.pow(nV[k4] + 1, 1 / who.temp); sum += w; return w; });
      var u = rnd() * sum;
      for (var q = 0; q < top.length; q++) { u -= wts[q]; if (u <= 0) { pick = top[q]; break; } }
    }
    var pwr = nV[pick] ? nWr[pick] / nV[pick] : wr;
    return result(nMove[pick], Math.max(wr, pwr), sims, t0, "", msg, ownv, est);
  }
  function isUseful(m, ownv) {
    if (!m) return false;
    if (Math.abs(ownv[m]) < 0.8) return true;
    /* a liberty of a group in atari is always worth a look */
    for (var d = 0; d < 4; d++) {
      var q = m + DIRS[d], v = rootBd.c[q];
      if ((v === BLACK || v === WHITE) && rootBd.libs(rootBd.gid[q]) === 1) return true;
    }
    return false;
  }
  function result(move, wr, sims, t0, why, msg, ownv, est) {
    ownv = ownv || ownArray();
    est = est || estimate(msg.b, ownv, komi);
    return {
      move: move, winrate: wr, playouts: sims, ms: Math.round(now() - t0), pass: why,
      own: msg.wantOwn ? ownv : null,
      est: { black: est.black.total, white: est.white.total, winner: est.winner }
    };
  }

  /* An ownership pass for the Territory view and for counting: plain playouts, half
     with each side to move. */
  function ownPass(msg) {
    var t0 = now();
    komi = msg.komi != null ? msg.komi : 7.5;
    rootBd.load(msg.b, msg.turn);
    rootBd.last = 0; rootBd.passes = 0;
    resetOwn();
    var n = msg.playouts || 2000, lim = msg.timeMs || 1500, i = 0;
    while (i < n) {
      ownership(64, msg.policy != null ? msg.policy : 2);
      i += 64;
      if (now() - t0 > lim) break;
    }
    return { own: ownArray(), playouts: ownN, ms: Math.round(now() - t0) };
  }

  /* a speed check: playouts per second from a position */
  function bench(msg) {
    rootBd.load(msg.b || K.emptyBoard(), msg.turn || BLACK);
    var t0 = now(), n = 0;
    while (now() - t0 < (msg.ms || 1000)) { bd.copyFrom(rootBd); seqLen = 0; playout(bd, msg.policy != null ? msg.policy : 2); n++; }
    return { perSec: Math.round(n / ((now() - t0) / 1000)) };
  }

  var api = { P: P, think: think, ownPass: ownPass, bench: bench, Board: Board, seedRandom: seedRandom,
    _choose: choose, _lastCaps: function () { return lastCaps; } };
  root.GoEngine = api;

  if (typeof self !== "undefined" && typeof importScripts === "function" && typeof window === "undefined") {
    self.onmessage = function (e) {
      var d = e.data, res = null, err = null;
      try {
        if (d.type === "go") res = think(d);
        else if (d.type === "own") res = ownPass(d);
        else if (d.type === "bench") res = bench(d);
      } catch (x) { err = String(x && x.message || x); }
      self.postMessage({ type: d.type, id: d.id, res: res, error: err });
    };
  }
})(typeof self !== "undefined" ? self : this);
