/* Pose Pendulum Wave for its card.
 *
 * The frame that explains this toy is the TRAVELLING WAVE — early in the cycle,
 * when the bobs still form one continuous sweep down the row. Later moments are
 * more spectacular but read as scattered dots in a still; at rest it is just a
 * line of balls. Real input to start, then the clock is set directly, because a
 * card needs the same frame every time.
 */
(function () {
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var btn = document.getElementById("ovBtn");
  if (btn) btn.click();
  return wait(320).then(function () {
    var P = window.__pw;
    if (!P) return;
    P.G.t = 0;
    P.advance(P.G.cycle * 0.055);
  });
})();
