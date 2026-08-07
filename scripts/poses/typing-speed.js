// Pose Typing Speed for its card. Types at a real human cadence (~165ms/char)
// rather than instantly: WPM is derived from wall-clock elapsed, so a
// synchronous pose produces a nonsense number like 856 in the HUD.
// Returns a promise — Playwright's evaluate awaits it.
(function () {
  var sink = document.getElementById("sink");
  // The card crops to .typebox, so no WPM readout is visible and the cadence
  // does not need to be human — it only needs to fill the middle band, which
  // is the part of the image the 118px card preview actually shows.
  var PER_CHAR = 12;
  var WORDS_TO_TYPE = 34;
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function send(v) {
    sink.value = v;
    sink.dispatchEvent(new Event("input", { bubbles: true }));
  }
  function space() {
    sink.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    sink.value = "";
  }
  function currentWord() {
    var ws = document.querySelectorAll(".w");
    for (var i = 0; i < ws.length; i++) if (ws[i].querySelector(".cur")) return ws[i].textContent.replace(/\s+$/, "");
    return null;
  }
  sink.focus();
  var n = 0;
  function nextWord() {
    if (n >= WORDS_TO_TYPE) return send("th");                       // half-typed word under the caret
    var word = currentWord();
    if (!word) return;
    var typedWord = (n === 21) ? word.slice(0, 2) + "xk" : word;   // one visible slip
    n++;
    var c = 0;
    function nextChar() {
      if (c >= typedWord.length) { space(); return wait(PER_CHAR).then(nextWord); }
      c++;
      send(typedWord.slice(0, c));
      return wait(PER_CHAR).then(nextChar);
    }
    return nextChar();
  }
  return nextWord();
})();

/* Regenerate this tool's card + OG:
 *   python3 -m http.server 3000
 *   node scripts/gen-card.cjs typing-speed --dir tools --el ".typebox" \
 *        --vw 560 --vh 1100 --at 300 --eval "$(cat scripts/poses/typing-speed.js)"
 *   node scripts/gen-og.cjs typing-speed
 */
