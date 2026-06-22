/* Lava Lamp — warm metaball blobs that rise, merge, and sink inside a glass
 * vessel. The blur+contrast on the .goo layer fuses neighbouring blobs; motion
 * is a slow vertical convection loop (heat at the base, cool at the top).
 */
(function () {
  "use strict";

  var blobsEl = document.getElementById("blobs");
  var W = 0, H = 0;
  function size() { var r = blobsEl.getBoundingClientRect(); W = r.width; H = r.height; }
  size();
  window.addEventListener("resize", size);

  // warm wax palette — orange → amber → coral (kept saturated so contrast stays vivid)
  var HUES = [16, 22, 12, 28, 18, 24, 14];
  var items = [];
  var N = 8;
  for (var i = 0; i < N; i++) {
    var big = i < 2;                       // a couple of big slow globs + smaller ones
    var el = document.createElement("div");
    el.className = "blob";
    var rFrac = big ? (0.30 + Math.random() * 0.10) : (0.15 + Math.random() * 0.12);
    var h = HUES[i % HUES.length];
    el.style.background = "radial-gradient(circle at 38% 34%, hsl(" + (h + 14) + ",100%,66%), hsl(" + h + ",95%,52%) 70%)";
    blobsEl.appendChild(el);
    items.push({
      el: el, rFrac: rFrac,
      x: 0.26 + Math.random() * 0.48,             // kept toward the middle (vessel tapers)
      xamp: 0.04 + Math.random() * 0.06,
      xfreq: 0.00018 + Math.random() * 0.0003,
      xph: Math.random() * 6.28,
      period: (big ? 19000 : 12000) + Math.random() * 9000,
      vph: Math.random(),                          // vertical phase offset (0..1)
      lo: 0.06 + Math.random() * 0.06,             // travel bounds (fraction of H)
      hi: 0.06 + Math.random() * 0.08
    });
  }

  function frame(t) {
    for (var i = 0; i < items.length; i++) {
      var b = items[i];
      var r = b.rFrac * W;
      // vertical convection: smooth rise then sink, eased with a cosine
      var p = (t / b.period + b.vph) % 1;
      var yf = b.lo + (1 - b.lo - b.hi) * (0.5 - 0.5 * Math.cos(p * 6.28318));
      // blobs swell a touch at the warm bottom, slim at the cool top
      var stretch = 1 + 0.12 * Math.cos(p * 6.28318);
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
