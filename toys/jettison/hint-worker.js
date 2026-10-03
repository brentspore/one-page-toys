/* Jettison — the thinking, off the main thread so a drag never stutters.
 *   { id, op: "hint", level, st } -> { move: [i, x, y, d] | null }
 * d is the side it leaves by, or -1 for "park it here". `level` is the stored
 * (raw) level; it is prepared once per level and cached. A jettison on offer
 * never needs a search (taking one is always right), so this only runs when
 * the next good move is a module dragged aside.
 */
importScripts("rules.js?v=2");
var R = self.JettisonRules;
var cacheKey = null, cached = null;

function lv(raw) {
  var k = JSON.stringify([raw.W, raw.H, raw.holes, raw.gates, raw.blocks]);
  if (k !== cacheKey) { cacheKey = k; cached = R.prepare(raw); }
  return cached;
}

self.onmessage = function (e) {
  var q = e.data, level = lv(q.level), out = { id: q.id, op: q.op, move: null };
  try {
    if (q.op === "hint") {
      var res = R.solve(level, Int16Array.from(q.st), 200000, 14);
      if (res.par > 0 && res.path.length) { var m = res.path[0]; out.move = [m.i, m.x, m.y, m.d]; }
    }
  } catch (err) { out.error = String(err); }
  self.postMessage(out);
};
