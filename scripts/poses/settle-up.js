// Settle Up card pose: load the sample trip, then check off every payment with
// the page's own "Mark paid" buttons until the ALL SQUARE stamp comes down.
// node scripts/gen-card.cjs settle-up --dir tools --base http://localhost:8123 --el "#tableWrap" --size 1080 --at 1500 --eval "$(cat scripts/poses/settle-up.js)"
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  document.getElementById("sampleBtn").click();
  await wait(900);
  const btns = () => Array.from(document.querySelectorAll("#pays .paid"));
  for (let i = 0; i < btns().length; i++) {
    btns()[i].click();
    await wait(300);
  }
  await wait(1400);
})()
