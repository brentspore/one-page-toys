/* Three Doors — the Monty Hall problem. Pick, host reveals a goat, switch or stay.
 * Tracks switch vs stay win rates so the 2/3 vs 1/3 truth emerges over plays.
 */
(function () {
  "use strict";

  var PRIZE = "🏆", GOAT = "🐐";
  var doors = Array.prototype.slice.call(document.querySelectorAll(".door"));
  var statusEl = document.getElementById("status");
  var choice = document.getElementById("choice");
  var switchBtn = document.getElementById("switchBtn");
  var stayBtn = document.getElementById("stayBtn");
  var againBtn = document.getElementById("againBtn");
  var playsEl = document.getElementById("plays");
  var switchRateEl = document.getElementById("switchRate");
  var stayRateEl = document.getElementById("stayRate");
  if (!doors.length) return;

  var prize, picked, host, phase;
  var st = { plays: 0, switchWins: 0, switchPlays: 0, stayWins: 0, stayPlays: 0 };

  function rnd(n) {
    try { var a = new Uint8Array(1); crypto.getRandomValues(a); return a[0] % n; }
    catch (e) { return Math.floor(Math.random() * n); }
  }

  function reset() {
    phase = "pick";
    prize = rnd(3); picked = -1; host = -1;
    doors.forEach(function (d) {
      d.classList.remove("open", "picked", "win");
      d.disabled = false;
      d.querySelector(".door__inside").textContent = "";
    });
    choice.hidden = true;
    againBtn.hidden = true;
    statusEl.innerHTML = "Pick a door. One hides the <span class='win'>prize</span>.";
  }

  function openDoor(i, content) {
    doors[i].classList.add("open");
    doors[i].querySelector(".door__inside").textContent = content;
  }

  function pick(i) {
    if (phase !== "pick") return;
    picked = i;
    doors[picked].classList.add("picked");
    // host opens a goat door that isn't the pick
    var options = [0, 1, 2].filter(function (d) { return d !== picked && d !== prize; });
    host = options[rnd(options.length)];
    openDoor(host, GOAT);
    doors.forEach(function (d) { d.disabled = true; });
    phase = "decide";
    statusEl.innerHTML = "Door " + (host + 1) + " is a 🐐. <strong>Switch</strong> or <strong>stay</strong>?";
    choice.hidden = false;
  }

  function decide(doSwitch) {
    if (phase !== "decide") return;
    phase = "done";
    choice.hidden = true;
    var other = [0, 1, 2].filter(function (d) { return d !== picked && d !== host; })[0];
    var finalPick = doSwitch ? other : picked;

    // reveal everything
    doors.forEach(function (d, i) {
      if (!d.classList.contains("open")) openDoor(i, i === prize ? PRIZE : GOAT);
    });
    doors[picked].classList.remove("picked");
    doors[finalPick].classList.add("picked");
    doors[prize].classList.add("win");

    var won = finalPick === prize;
    st.plays++;
    if (doSwitch) { st.switchPlays++; if (won) st.switchWins++; }
    else { st.stayPlays++; if (won) st.stayWins++; }

    statusEl.innerHTML = won
      ? "🏆 You won by " + (doSwitch ? "switching" : "staying") + "!"
      : "🐐 No prize. You " + (doSwitch ? "switched" : "stayed") + ".";
    if (won) {
      var r = doors[prize].getBoundingClientRect();
      confetti(r.left + r.width / 2, r.top + r.height / 2);
    }
    renderStats();
    againBtn.hidden = false;
  }

  function confetti(x, y) {
    var cols = ["#f4c430", "#ffe79a", "#b8860b", "#fff7d6"];
    for (var i = 0; i < 34; i++) {
      var d = document.createElement("div");
      d.className = "confetti";
      d.style.left = x + "px"; d.style.top = y + "px";
      d.style.background = cols[i % cols.length];
      var a = Math.random() * Math.PI * 2, sp = 100 + Math.random() * 170;
      d.style.setProperty("--dx", (Math.cos(a) * sp).toFixed(0) + "px");
      d.style.setProperty("--dy", (Math.sin(a) * sp - 70).toFixed(0) + "px");
      document.body.appendChild(d);
      d.addEventListener("animationend", function () { this.remove(); });
    }
  }

  function pct(w, p) { return p ? Math.round((w / p) * 100) + "%" : "–"; }
  function renderStats() {
    playsEl.textContent = st.plays;
    switchRateEl.textContent = st.switchPlays ? pct(st.switchWins, st.switchPlays) + " (" + st.switchPlays + ")" : "–";
    stayRateEl.textContent = st.stayPlays ? pct(st.stayWins, st.stayPlays) + " (" + st.stayPlays + ")" : "–";
  }

  doors.forEach(function (d) { d.addEventListener("click", function () { pick(+d.dataset.i); }); });
  switchBtn.addEventListener("click", function () { decide(true); });
  stayBtn.addEventListener("click", function () { decide(false); });
  againBtn.addEventListener("click", reset);

  reset();
})();
