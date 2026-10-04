// Card pose for Hearing Age (tools/hearing-age): run the volume check, then answer
// "I hear it" through the page's own buttons until the climb reaches 16 kHz, and
// stop there so the scope is caught mid-beep with echo rings going out and the
// ladder filled to 16. Real clicks on the page's buttons only, no test hook.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (id) => document.getElementById(id);
  const ready = async () => {
    for (let w = 0; w < 120 && $("yesBtn").getAttribute("aria-disabled") !== "false"; w++) await sleep(40);
    await sleep(320); // the page ignores answers for 280ms after a beep starts
  };
  $("startBtn").click();
  await sleep(700);
  $("checkOk").click();
  for (let i = 0; i < 60; i++) {
    await ready();
    if (parseFloat($("toneOut").textContent) >= 16) return;
    $("yesBtn").click();
  }
})();

// Regenerate (dev server on 8123):
//   node scripts/gen-card.cjs hearing-age --dir tools --base http://localhost:8123 \
//     --el ".rig" --size 1080 --at 480 --motion --eval "$(cat scripts/poses/hearing-age.js)"
