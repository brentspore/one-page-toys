/* Settle Up core: money, splits, balances, the fewest-payments settlement and
 * the link codec. No DOM in here, so node can load it for the unit tests
 * (module.exports) and the page gets it as window.SettleCore.
 *
 * Money is ALWAYS an integer count of the currency's minor unit (cents, or
 * whole yen). Nothing here ever adds two floats. */
(function (root) {
  "use strict";

  var CURRENCIES = [
    ["USD", "US dollar"], ["EUR", "Euro"], ["GBP", "British pound"], ["CAD", "Canadian dollar"],
    ["AUD", "Australian dollar"], ["NZD", "New Zealand dollar"], ["MXN", "Mexican peso"],
    ["JPY", "Japanese yen"], ["INR", "Indian rupee"], ["CHF", "Swiss franc"], ["SEK", "Swedish krona"],
    ["NOK", "Norwegian krone"], ["DKK", "Danish krone"], ["BRL", "Brazilian real"],
    ["ZAR", "South African rand"], ["SGD", "Singapore dollar"], ["HKD", "Hong Kong dollar"],
    ["KRW", "South Korean won"], ["THB", "Thai baht"], ["PHP", "Philippine peso"]
  ];
  var ZERO_DIGIT = { JPY: 1, KRW: 1 };
  var MAX_AMOUNT = 1e11;        // a billion dollars in cents; keeps a*w far inside 2^53
  var MAX_PEOPLE = 24;
  var MAX_EXPENSES = 400;
  var MAX_SHARES = 20;
  var DP_LIMIT = 18;            // exact minimum up to this many people with a nonzero balance

  function isCurrency(c) {
    for (var i = 0; i < CURRENCIES.length; i++) if (CURRENCIES[i][0] === c) return true;
    return false;
  }

  // Minor-unit digits. Intl knows, but a table is the fallback so node and old
  // browsers agree with each other.
  function digits(cur) {
    if (ZERO_DIGIT[cur]) return 0;
    return 2;
  }

  // ---------- parsing typed amounts ----------
  // "42", "42.5", "1,234.56", "1.234,56", "12,50", "$ 9.99", "¥1,500"
  // Returns integer minor units, or NaN.
  function parseAmount(str, d) {
    if (d === undefined) d = 2;
    var s = String(str == null ? "" : str).replace(/[\s  ']/g, "");
    if (/-/.test(s)) return NaN;
    s = s.replace(/[^0-9.,]/g, "");
    if (!s || !/[0-9]/.test(s)) return NaN;
    var lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
    var dec = -1;
    if (lastDot !== -1 && lastComma !== -1) {
      dec = Math.max(lastDot, lastComma);
    } else if (lastDot !== -1 || lastComma !== -1) {
      var ch = lastDot !== -1 ? "." : ",";
      var at = Math.max(lastDot, lastComma);
      var count = s.split(ch).length - 1;
      var after = s.length - at - 1;
      if (count > 1) dec = -1;                         // 1.234.567 or 1,234,567
      else if (after === 3 && (ch === "," || d === 0)) dec = -1;  // 1,500 (or ¥1.500)
      else dec = at;
    }
    var intPart, frac;
    if (dec === -1) { intPart = s.replace(/[.,]/g, ""); frac = ""; }
    else { intPart = s.slice(0, dec).replace(/[.,]/g, ""); frac = s.slice(dec + 1).replace(/[.,]/g, ""); }
    if (!intPart) intPart = "0";
    if (intPart.length > 13) return NaN;
    var v = parseInt(intPart, 10) * Math.pow(10, d);
    if (d > 0 && frac) {
      var f = (frac + "000000").slice(0, d);
      v += parseInt(f, 10);
      if (frac.length > d && parseInt(frac.charAt(d), 10) >= 5) v += 1;   // round half up
    } else if (d === 0 && frac && parseInt(frac.charAt(0), 10) >= 5) {
      v += 1;
    }
    if (!isFinite(v) || v > MAX_AMOUNT) return NaN;
    return v;
  }

  // ---------- formatting ----------
  var fmtCache = {};
  function formatter(cur, locale) {
    var key = cur + "|" + (locale || "");
    if (fmtCache[key]) return fmtCache[key];
    var d = digits(cur), f;
    try {
      f = new Intl.NumberFormat(locale || undefined, { style: "currency", currency: cur, minimumFractionDigits: d, maximumFractionDigits: d });
    } catch (e) {
      f = { format: function (n) { return cur + " " + n.toFixed(d); } };
    }
    fmtCache[key] = f;
    return f;
  }
  function money(minor, cur, locale) {
    var d = digits(cur);
    var neg = minor < 0;
    var s = formatter(cur, locale).format(Math.abs(minor) / Math.pow(10, d));
    return neg ? "−" + s : s;
  }

  // ---------- splitting one expense ----------
  // Small stable string hash (FNV-1a), so the extra cents land the same way on
  // every device that opens the link, and do not move when some OTHER expense
  // is deleted (an index-based rotation would).
  function hash(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  // amount: integer minor units. parts: [{id, w}] with integer w >= 1, in a
  // fixed order. Returns an array of integer shares, same order, that sums to
  // exactly `amount`. Floor everyone, then hand the leftover units out by the
  // largest remainder; ties go round a start point picked by `seed`.
  function splitAmount(amount, parts, seed) {
    var n = parts.length;
    var out = new Array(n);
    if (!n) return out;
    var W = 0, i;
    for (i = 0; i < n; i++) W += parts[i].w;
    var given = 0, rems = [];
    for (i = 0; i < n; i++) {
      var num = amount * parts[i].w;
      var q = Math.floor(num / W);
      out[i] = q;
      given += q;
      rems.push({ i: i, r: num - q * W });
    }
    var left = amount - given;           // 0 <= left < n
    var start = (seed >>> 0) % n;
    rems.sort(function (a, b) {
      if (b.r !== a.r) return b.r - a.r;
      return ((a.i - start + n) % n) - ((b.i - start + n) % n);
    });
    for (i = 0; i < left; i++) out[rems[i].i] += 1;
    return out;
  }

  function expenseSeed(e) { return hash(String(e.what) + "|" + e.amt + "|" + e.by); }

  // ---------- balances ----------
  // net[id] = what they paid minus their share. Positive: the group owes them.
  function tally(state) {
    var paid = {}, share = {}, net = {};
    state.people.forEach(function (p) { paid[p.id] = 0; share[p.id] = 0; net[p.id] = 0; });
    state.exps.forEach(function (e) {
      if (!(e.by in paid)) return;
      var parts = e.split.filter(function (s) { return s.id in share && s.w > 0; });
      if (!parts.length) return;
      var cuts = splitAmount(e.amt, parts, expenseSeed(e));
      paid[e.by] += e.amt;
      net[e.by] += e.amt;
      for (var i = 0; i < parts.length; i++) {
        share[parts[i].id] += cuts[i];
        net[parts[i].id] -= cuts[i];
      }
    });
    return { paid: paid, share: share, net: net };
  }

  // Apply recorded payments: a payer's balance goes UP (they put money in),
  // the receiver's goes DOWN.
  function applyPayments(net, pays) {
    var out = {};
    for (var k in net) out[k] = net[k];
    (pays || []).forEach(function (p) {
      if (p.f in out && p.t in out) { out[p.f] += p.a; out[p.t] -= p.a; }
    });
    return out;
  }

  // ---------- the fewest payments ----------
  // Greedy fallback (and the per-group pass): the biggest debtor pays the
  // biggest creditor, ties to the lower index. Every step zeroes at least one
  // person, so a zero-sum group of k people takes at most k - 1 payments.
  function greedy(list) {
    var cred = [], debt = [], out = [];
    list.forEach(function (x) {
      if (x.v > 0) cred.push({ id: x.id, v: x.v, o: x.o });
      else if (x.v < 0) debt.push({ id: x.id, v: -x.v, o: x.o });
    });
    function pick(arr) {
      var best = -1;
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].v <= 0) continue;
        if (best === -1 || arr[i].v > arr[best].v || (arr[i].v === arr[best].v && arr[i].o < arr[best].o)) best = i;
      }
      return best;
    }
    for (var guard = 0; guard < 1000; guard++) {
      var ci = pick(cred), di = pick(debt);
      if (ci === -1 || di === -1) break;
      var a = Math.min(cred[ci].v, debt[di].v);
      out.push({ f: debt[di].id, t: cred[ci].id, a: a });
      cred[ci].v -= a; debt[di].v -= a;
    }
    return out;
  }

  // Exact minimum: the fewest payments = (people with a nonzero balance) minus
  // (the most groups they can be split into that each sum to zero). Each group
  // settles inside itself in size - 1 payments, and no plan can beat that.
  //
  // dp over subsets: dp[mask] = max over i in mask of dp[mask without i], plus 1
  // if mask itself sums to zero. Walking the chosen removals back from the full
  // set gives an order in which every zero-sum prefix closes a group.
  function minTransfers(netMap, order) {
    var ids = order || Object.keys(netMap);
    var list = [];
    ids.forEach(function (id, o) { var v = netMap[id]; if (v) list.push({ id: id, v: v, o: o }); });
    var m = list.length;
    if (!m) return { transfers: [], exact: true, groups: 0, nonzero: 0 };
    if (m > DP_LIMIT) {
      var g = greedy(list);
      return { transfers: sortPlan(g, ids), exact: false, groups: m - g.length, nonzero: m };
    }
    var N = 1 << m;
    var sum = new Float64Array(N);
    var dp = new Int8Array(N);
    var par = new Int8Array(N);
    for (var mask = 1; mask < N; mask++) {
      var low = mask & -mask;
      var bit = 31 - Math.clz32(low);
      sum[mask] = sum[mask ^ low] + list[bit].v;
      var best = -1, bi = 0;
      for (var i = 0; i < m; i++) {
        if (!(mask & (1 << i))) continue;
        var c = dp[mask ^ (1 << i)];
        if (c > best) { best = c; bi = i; }
      }
      dp[mask] = best + (sum[mask] === 0 ? 1 : 0);
      par[mask] = bi;
    }
    var groups = [], cur = [], mk = N - 1;
    while (mk) {
      var e = par[mk];
      cur.push(list[e]);
      mk ^= (1 << e);
      if (sum[mk] === 0) { groups.push(cur); cur = []; }
    }
    var transfers = [];
    groups.forEach(function (grp) { transfers = transfers.concat(greedy(grp)); });
    return { transfers: sortPlan(transfers, ids), exact: true, groups: groups.length, nonzero: m };
  }

  // A stable reading order: by payer's place in the list, then biggest first.
  function sortPlan(ts, ids) {
    var pos = {};
    ids.forEach(function (id, i) { pos[id] = i; });
    return ts.slice().sort(function (a, b) {
      if (pos[a.f] !== pos[b.f]) return pos[a.f] - pos[b.f];
      if (b.a !== a.a) return b.a - a.a;
      return pos[a.t] - pos[b.t];
    });
  }

  // How many payments it would take with no simplifying at all: everyone pays
  // back each person who covered them, netted per pair.
  function naiveCount(state) {
    var pair = {};
    state.exps.forEach(function (e) {
      var parts = e.split.filter(function (s) { return s.w > 0; });
      if (!parts.length) return;
      var cuts = splitAmount(e.amt, parts, expenseSeed(e));
      parts.forEach(function (s, i) {
        if (s.id === e.by || !cuts[i]) return;
        var a = s.id, b = e.by;            // a owes b
        var key = a < b ? a + ">" + b : b + ">" + a;
        pair[key] = (pair[key] || 0) + (a < b ? cuts[i] : -cuts[i]);
      });
    });
    var n = 0;
    for (var k in pair) if (pair[k]) n++;
    return n;
  }

  // ---------- the whole picture ----------
  // Recorded payments are either TICKS (checked off against the current plan)
  // or FOLDED (counted into the balances first). Ticks keep the plan from
  // reshuffling as you check things off; if the trip changes under them so they
  // no longer match the plan, normalize() folds them all and a fresh plan for
  // what is left takes over.
  function compute(state) {
    var ids = state.people.map(function (p) { return p.id; });
    var t = tally(state);
    var folded = state.paid.filter(function (p) { return p.fold; });
    var ticks = state.paid.filter(function (p) { return !p.fold; });
    var base = applyPayments(t.net, folded);
    var res = minTransfers(base, ids);
    var plan = res.transfers.map(function (x) { return { f: x.f, t: x.t, a: x.a, done: false }; });
    var unmatched = 0;
    ticks.forEach(function (tk) {
      for (var i = 0; i < plan.length; i++) {
        var p = plan[i];
        if (!p.done && String(p.f) === String(tk.f) && String(p.t) === String(tk.t) && p.a === tk.a) { p.done = true; return; }
      }
      unmatched++;
    });
    var left = applyPayments(base, ticks);
    var total = 0;
    state.exps.forEach(function (e) { total += e.amt; });
    var heads = 0;
    state.people.forEach(function (p) { heads += p.w || 1; });
    var doneN = plan.filter(function (p) { return p.done; }).length;
    return {
      tally: t, base: base, left: left, plan: plan, folded: folded,
      exact: res.exact, unmatched: unmatched, total: total, heads: heads,
      done: doneN, square: state.exps.length > 0 && doneN === plan.length,
      naive: naiveCount(state)
    };
  }

  function normalize(state) {
    var c = compute(state);
    if (c.unmatched) {
      state.paid.forEach(function (p) { p.fold = true; });
    }
    // drop any recorded payment that points at someone who is gone
    var have = {};
    state.people.forEach(function (p) { have[p.id] = 1; });
    state.paid = state.paid.filter(function (p) { return have[p.f] && have[p.t] && p.f !== p.t && p.a > 0; });
    return state;
  }

  // ---------- the link ----------
  // Compact shape: { v, k, n, c, p:[[name,color,w?]], e:[[what,amt,payer,split]], d:[[f,t,a,fold]] }
  // people are referenced by their position in p. split: 0 = everyone, one
  // share each; 1 = everyone at their usual shares; else [idx | [idx, w], ...].
  function toCompact(state) {
    var idx = {};
    state.people.forEach(function (p, i) { idx[p.id] = i; });
    var o = { v: 1, k: state.k || "", n: state.name || "", c: state.cur || "USD" };
    o.p = state.people.map(function (p) {
      var a = [p.name, p.color];
      if ((p.w || 1) !== 1) a.push(p.w);
      return a;
    });
    o.e = state.exps.map(function (e) {
      var sp = e.split.filter(function (s) { return s.id in idx && s.w > 0; });
      var everyoneOne = sp.length === state.people.length && sp.every(function (s) { return s.w === 1; }) && orderedAll(sp, state);
      var everyoneUsual = sp.length === state.people.length && orderedAll(sp, state) &&
        sp.every(function (s, i) { return s.w === (state.people[i].w || 1); });
      var code;
      if (everyoneOne) code = 0;
      else if (everyoneUsual) code = 1;
      else code = sp.map(function (s) { return s.w === 1 ? idx[s.id] : [idx[s.id], s.w]; });
      return [e.what || "", e.amt, idx[e.by], code];
    });
    if (state.paid.length) {
      o.d = state.paid.map(function (p) { return [idx[p.f], idx[p.t], p.a, p.fold ? 1 : 0]; });
    }
    return o;
  }
  function orderedAll(sp, state) {
    for (var i = 0; i < sp.length; i++) if (sp[i].id !== state.people[i].id) return false;
    return true;
  }

  function str(x, max) {
    return typeof x === "string" ? x.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max) : "";
  }
  function int(x, lo, hi) {
    return typeof x === "number" && isFinite(x) && Math.floor(x) === x && x >= lo && x <= hi;
  }

  // Never trust a link: everything is checked and clamped on the way in.
  function fromCompact(o) {
    if (!o || typeof o !== "object" || o.v !== 1) throw new Error("not a trip");
    var state = { k: str(o.k, 12), name: str(o.n, 48), cur: isCurrency(o.c) ? o.c : "USD", people: [], exps: [], paid: [] };
    var P = Array.isArray(o.p) ? o.p.slice(0, MAX_PEOPLE) : [];
    P.forEach(function (row, i) {
      if (!Array.isArray(row)) row = [];
      state.people.push({
        id: i, name: str(row[0], 32) || "Person " + (i + 1),
        color: int(row[1], 0, 63) ? row[1] : i % 12,
        w: int(row[2], 1, MAX_SHARES) ? row[2] : 1
      });
    });
    var np = state.people.length;
    var E = Array.isArray(o.e) ? o.e.slice(0, MAX_EXPENSES) : [];
    E.forEach(function (row) {
      if (!Array.isArray(row) || !int(row[1], 1, MAX_AMOUNT) || !int(row[2], 0, np - 1)) return;
      var split = [];
      if (row[3] === 0 || row[3] === 1) {
        state.people.forEach(function (p) { split.push({ id: p.id, w: row[3] === 0 ? 1 : p.w }); });
      } else if (Array.isArray(row[3])) {
        var seen = {};
        row[3].forEach(function (s) {
          var id, w = 1;
          if (Array.isArray(s)) { id = s[0]; w = s[1]; } else id = s;
          if (!int(id, 0, np - 1) || !int(w, 1, MAX_SHARES) || seen[id]) return;
          seen[id] = 1;
          split.push({ id: id, w: w });
        });
      }
      if (!split.length) return;
      state.exps.push({ what: str(row[0], 60), amt: row[1], by: row[2], split: split });
    });
    var D = Array.isArray(o.d) ? o.d.slice(0, 200) : [];
    D.forEach(function (row) {
      if (!Array.isArray(row) || !int(row[0], 0, np - 1) || !int(row[1], 0, np - 1) || row[0] === row[1] || !int(row[2], 1, MAX_AMOUNT)) return;
      state.paid.push({ f: row[0], t: row[1], a: row[2], fold: row[3] === 1 });
    });
    return state;
  }

  // base64url over bytes
  function b64u(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function unb64u(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function pipe(bytes, stream) {
    var blob = new Blob([bytes]);
    return new Response(blob.stream().pipeThrough(stream)).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function canCompress() { return typeof CompressionStream === "function" && typeof Blob === "function" && typeof Response === "function"; }

  // "1" + base64url(deflate-raw(json)), or "0" + base64url(json) when the
  // browser has no CompressionStream (or when raw comes out shorter).
  function pack(state, opts) {
    var json = JSON.stringify(toCompact(state));
    var raw = new TextEncoder().encode(json);
    var plain = "0" + b64u(raw);
    if ((opts && opts.noCompress) || !canCompress()) return Promise.resolve(plain);
    return pipe(raw, new CompressionStream("deflate-raw")).then(function (z) {
      var packed = "1" + b64u(z);
      return packed.length < plain.length ? packed : plain;
    }, function () { return plain; });
  }

  function unpack(code) {
    return Promise.resolve().then(function () {
      if (typeof code !== "string" || code.length < 2 || code.length > 60000) throw new Error("bad link");
      var kind = code.charAt(0), bytes = unb64u(code.slice(1));
      if (kind === "0") return bytes;
      if (kind === "1") {
        if (typeof DecompressionStream !== "function") throw new Error("old browser");
        return pipe(bytes, new DecompressionStream("deflate-raw"));
      }
      throw new Error("bad link");
    }).then(function (bytes) {
      return fromCompact(JSON.parse(new TextDecoder().decode(bytes)));
    });
  }

  var API = {
    CURRENCIES: CURRENCIES, MAX_PEOPLE: MAX_PEOPLE, MAX_EXPENSES: MAX_EXPENSES, MAX_SHARES: MAX_SHARES, DP_LIMIT: DP_LIMIT,
    isCurrency: isCurrency, digits: digits, parseAmount: parseAmount, money: money, hash: hash,
    splitAmount: splitAmount, expenseSeed: expenseSeed, tally: tally, applyPayments: applyPayments,
    greedy: greedy, minTransfers: minTransfers, naiveCount: naiveCount, compute: compute, normalize: normalize,
    toCompact: toCompact, fromCompact: fromCompact, pack: pack, unpack: unpack, b64u: b64u, unb64u: unb64u,
    canCompress: canCompress
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.SettleCore = API;
})(this);
