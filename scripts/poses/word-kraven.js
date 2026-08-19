// Pose the Word Kraven feeder for its card: dismiss the intro and let the
// screened grid settle. Deliberately does NOT trace a path — the grid is
// random per load, so a scripted trace spells nonsense and the card ends up
// advertising a struck-through dead word. A clean board reads as the game.
(function () {
  var btn = document.getElementById("ovBtn");
  if (btn && !btn.disabled) btn.click();
  return new Promise(function (r) { setTimeout(r, 400); });
})();

/* Regenerate this toy's card + OG:
 *   python3 -m http.server 3000
 *   node scripts/gen-card.cjs word-kraven --size 720 --vw 720 --vh 1000 \
 *        --cropy 124 --at 200 --motion --eval "$(cat scripts/poses/word-kraven.js)"
 *   node scripts/gen-og.cjs word-kraven
 * ⚠ --at counts from AFTER this script's promise resolves. The 1400-tall
 * viewport with cropy 144 centres the board: the shell is vertically centred,
 * so a square capture would leave the grid high with dead space beneath.
 */
