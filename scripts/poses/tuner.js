// Pose the Tuner for its card: a guitar's A string ringing 7 cents flat, heard
// through the page's own microphone path. The "microphone" here is a plucked
// A2 rendered by the page's own voice.js and handed over as a MediaStream, so
// everything after getUserMedia (AnalyserNode, detector, tracker, needle spring,
// strobe) runs exactly as it does for a real string. Returns a promise that
// resolves once the needle has settled.
(function () {
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var AC = window.AudioContext || window.webkitAudioContext;
  navigator.mediaDevices.getUserMedia = function () {
    var ac = new AC(), sr = ac.sampleRate;
    var f = 110 * Math.pow(2, -7 / 1200);
    var data = window.TunerVoice.renderPluck(f, sr, { seconds: 6, t60: 12, bright: 0.5, seed: 9 });
    var buf = ac.createBuffer(1, data.length, sr);
    buf.getChannelData(0).set(data);
    var src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
    var g = ac.createGain(); g.gain.value = 0.5;
    var dest = ac.createMediaStreamDestination();
    src.connect(g); g.connect(dest); src.start();
    if (ac.resume) ac.resume();
    return Promise.resolve(dest.stream);
  };
  document.getElementById("startBtn").click();
  return wait(1800);
})();

// Regenerate (dev server on :8123):
//   node scripts/gen-card.cjs tuner --dir tools --base http://localhost:8123 --el ".tn-face" --size 1080 --at 600 --motion --eval "$(cat scripts/poses/tuner.js)"
