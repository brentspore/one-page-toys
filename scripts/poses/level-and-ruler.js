// Pose Level & Ruler for its card: the brass machinist's level standing on its
// edge, a hair off true, the bubble just short of the center lines. Real input
// only: a 60 Hz stream of devicemotion events, the same path a phone's sensor
// takes (spec convention, so Chromium's non-iPhone sign guess reads it right).
// Set window.__poseDeg first to change the tilt (0.05 shows the green LEVEL lock).
//
// ⚠ gen-card loads without a sensor, so the page may already have given up and
//   switched to the ruler; the first real event brings it back to the level.
// ⚠ Keep feeding: the level releases its lock when the sensor goes quiet for 1s.
(function () {
  var deg = window.__poseDeg === undefined ? 0.4 : window.__poseDeg;
  var G = 9.80665, e = deg * Math.PI / 180;
  setInterval(function () {
    window.dispatchEvent(new DeviceMotionEvent("devicemotion", {
      accelerationIncludingGravity: { x: Math.sin(e) * G, y: Math.cos(e) * G, z: 0.02 },
      interval: 16
    }));
  }, 16);
  return new Promise(function (r) { setTimeout(r, 600); });
})()

// Regenerate (dev server on :8123):
//   node scripts/gen-card.cjs level-and-ruler --dir tools --base http://localhost:8123 --el "#bench" \
//     --size 1080 --at 1500 --motion --eval "$(cat scripts/poses/level-and-ruler.js)"
