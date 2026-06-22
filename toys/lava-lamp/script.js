(function () {
  "use strict";

  var wrap = document.getElementById("blobs");
  var N = 14;
  var items = [];
  var W = window.innerWidth;
  var H = window.innerHeight;

  window.addEventListener("resize", function () {
    W = window.innerWidth;
    H = window.innerHeight;
  });

  /* hsl components — tight orange-red range, no yellows */
  var palette = [
    [18, 92, 50],
    [14, 95, 46],
    [22, 88, 48],
    [10, 96, 44],
    [20, 90, 52],
    [16, 94, 47],
    [24, 86, 49],
  ];

  for (var i = 0; i < N; i++) {
    var el = document.createElement("div");
    el.className = "blob";
    var r = 48 + Math.random() * 100;
    var c = palette[i % palette.length];
    el.style.cssText =
      "width:" + (r * 2) + "px;" +
      "height:" + (r * 2) + "px;" +
      "background:hsl(" + c[0] + "," + c[1] + "%," + c[2] + "%)";
    wrap.appendChild(el);

    /* Each blob has two superimposed sine waves per axis for organic drift */
    items.push({
      el: el,
      r: r,
      bx: 0.08 + Math.random() * 0.84,   /* base x, normalized */
      by: 0.10 + Math.random() * 0.80,   /* base y, normalized */
      ox: [                               /* [amplitude_norm, freq, phase] */
        [0.08 + Math.random() * 0.09, 2.0e-4 + Math.random() * 2.8e-4, Math.random() * 6.28],
        [0.03 + Math.random() * 0.04, 5.5e-4 + Math.random() * 5.0e-4, Math.random() * 6.28],
      ],
      oy: [
        [0.14 + Math.random() * 0.14, 1.7e-4 + Math.random() * 2.0e-4, Math.random() * 6.28],
        [0.05 + Math.random() * 0.05, 4.8e-4 + Math.random() * 4.0e-4, Math.random() * 6.28],
      ],
    });
  }

  function frame(t) {
    var w = W, h = H;
    for (var i = 0; i < items.length; i++) {
      var b = items[i];
      var dx = b.ox[0][0] * w * Math.sin(t * b.ox[0][1] + b.ox[0][2])
             + b.ox[1][0] * w * Math.sin(t * b.ox[1][1] + b.ox[1][2]);
      var dy = b.oy[0][0] * h * Math.sin(t * b.oy[0][1] + b.oy[0][2])
             + b.oy[1][0] * h * Math.sin(t * b.oy[1][1] + b.oy[1][2]);
      b.el.style.transform =
        "translate(" + (b.bx * w + dx - b.r) + "px," + (b.by * h + dy - b.r) + "px)";
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
