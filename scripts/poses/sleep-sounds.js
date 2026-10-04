// Pose Sleep Sounds for its card: a rainy night by the sea with the fire lit,
// playing. Moves the page's own sliders (input events, as a drag would) and
// presses the real Play button, so the night window answers the mix the way
// it does for a visitor. Then it waits (reading, not driving, the test hook)
// for a wave to start breaking, so the surf is in the frame.
// Framing only: the panel is widened to the full card width (the page caps it
// near 560px) and the clock caption is hidden, since a card frozen at
// "1:38 PM" over a night sky reads wrong. The gallery band shows the middle of
// the image: the horizon, the lighthouse, the surf and the drops on the glass.
// Render: node scripts/gen-card.cjs sleep-sounds --dir tools --base http://localhost:8123 --el "#night" --size 1080 --vh 1400 --at 600 --eval "$(cat scripts/poses/sleep-sounds.js)"
(function () {
  var ss = document.querySelector(".ss");
  ss.style.maxWidth = "1080px"; ss.style.display = "block";
  var cap = document.querySelector(".night__cap"); if (cap) cap.style.display = "none";
  function set(id, v) {
    var el = document.getElementById("lv-" + id);
    el.value = String(v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  set("rain", 58); set("waves", 74); set("fire", 56); set("thunder", 0); set("fan", 0);
  set("brown", 0); set("pink", 0); set("white", 0);
  document.getElementById("playBtn").click();
  var t0 = Date.now();
  return new Promise(function (done) {
    (function wait() {
      var s = window.__sleepSounds && window.__sleepSounds.scene();
      var breaking = s && s.wavePhases && s.wavePhases.some(function (p) { return p > 1.04 && p < 1.12; });
      if (breaking || Date.now() - t0 > 30000) done(); else setTimeout(wait, 50);
    })();
  });
})();
