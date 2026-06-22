/* Lava Lamp — warm metaball blobs that rise, merge, and sink across the whole
 * viewport. The blur+contrast on the .goo layer fuses neighbouring blobs; motion
 * is a slow vertical convection loop (heat at the bottom, cool at the top).
 */
(function () {
  "use strict";

  var blobsEl = document.getElementById("blobs");
  var W = 0, H = 0, MIN = 0;
  function size() { var r = blobsEl.getBoundingClientRect(); W = r.width; H = r.height; MIN = Math.min(W, H); }
  size();
  window.addEventListener("resize", size);

  // warm wax palette — orange → amber → coral (kept saturated so contrast stays vivid)
  var HUES = [16, 22, 12, 28, 18, 24, 14, 20];
  var items = [];
  var N = 11;
  for (var i = 0; i < N; i++) {
    var big = i < 4;                       // a few big slow globs + smaller ones
    var el = document.createElement("div");
    el.className = "blob";
    var rFrac = big ? (0.16 + Math.random() * 0.09) : (0.09 + Math.random() * 0.06);
    var h = HUES[i % HUES.length];
    el.style.background = "radial-gradient(circle at 38% 34%, hsl(" + (h + 14) + ",100%,66%), hsl(" + h + ",95%,52%) 70%)";
    blobsEl.appendChild(el);
    items.push({
      el: el, rFrac: rFrac,
      x: 0.06 + Math.random() * 0.88,
      xamp: 0.03 + Math.random() * 0.06,
      xfreq: 0.00015 + Math.random() * 0.0003,
      xph: Math.random() * 6.28,
      period: (big ? 20000 : 13000) + Math.random() * 9000,
      vph: Math.random(),                          // vertical phase offset (0..1)
      lo: 0.04 + Math.random() * 0.07,             // travel bounds (fraction of H)
      hi: 0.04 + Math.random() * 0.07
    });
  }

  function frame(t) {
    for (var i = 0; i < items.length; i++) {
      var b = items[i];
      var r = b.rFrac * MIN;
      var p = (t / b.period + b.vph) % 1;
      var yf = b.lo + (1 - b.lo - b.hi) * (0.5 - 0.5 * Math.cos(p * 6.28318));
      var stretch = 1 + 0.1 * Math.cos(p * 6.28318);  // swell at the warm bottom, slim at top
      var x = b.x * W + Math.sin(t * b.xfreq + b.xph) * b.xamp * W;
      var y = yf * H;
      b.el.style.width = (r * 2) + "px";
      b.el.style.height = (r * 2 * stretch) + "px";
      b.el.style.transform = "translate(" + (x - r) + "px," + (y - r * stretch) + "px)";
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
