/* Aurebesh Translator — live Galactic Basic → Aurebesh on an Imperial datapad. */
(function(){
  "use strict";

  var input   = document.getElementById("input");
  var out     = document.getElementById("out");
  var echo    = document.getElementById("echo");
  var tip     = document.getElementById("tip");
  var hint    = document.getElementById("hint");
  var revealBtn = document.getElementById("revealBtn");
  var accentBtn = document.getElementById("accentBtn");
  var accentName= document.getElementById("accentName");
  var soundBtn  = document.getElementById("soundBtn");
  var copyBtn   = document.getElementById("copyBtn");

  // Aurebesh letter names — for the hover / tap reveal.
  var NAMES = {
    A:"Aurek", B:"Besh", C:"Cresh", D:"Dorn", E:"Esk", F:"Forn", G:"Grek",
    H:"Herf", I:"Isk", J:"Jenth", K:"Krill", L:"Leth", M:"Mern", N:"Nern",
    O:"Osk", P:"Peth", Q:"Qek", R:"Resh", S:"Senth", T:"Trill", U:"Usk",
    V:"Vev", W:"Wesk", X:"Xesh", Y:"Yirt", Z:"Zerek"
  };

  var CHANNELS = [
    { name:"Imperial",  hex:"#38e1ff", rgb:"56,225,255" },
    { name:"Rebel",     hex:"#ffb347", rgb:"255,179,71" },
    { name:"Outer Rim", hex:"#54ffb0", rgb:"84,255,176" }
  ];
  var channelIx = 0;

  // ---------- render ----------
  var prev = "";
  var timers = [];
  function clearTimers(){ for(var i=0;i<timers.length;i++){ clearInterval(timers[i]); } timers.length = 0; }

  function randAlpha(){ return "ABCDEFGHIJKLMNOPQRSTUVWXYZ".charAt(Math.floor(Math.random()*26)); }

  function render(text){
    clearTimers();
    out.innerHTML = "";
    echo.textContent = text;

    if(!text){
      var caret = document.createElement("span");
      caret.className = "glyph caret";
      caret.textContent = "▏";
      caret.style.animation = "pulse 1.1s steps(1) infinite";
      out.appendChild(caret);
      prev = "";
      return;
    }

    // how much of the head is unchanged from last render (only animate the new tail)
    var common = 0, max = Math.min(text.length, prev.length);
    while(common < max && text.charAt(common) === prev.charAt(common)){ common++; }

    for(var i=0;i<text.length;i++){
      var ch = text.charAt(i);
      if(ch === " "){ out.appendChild(document.createTextNode(" ")); continue; }

      var span = document.createElement("span");
      span.className = "glyph";
      var up = ch.toUpperCase();
      span.setAttribute("data-letter", /[a-z]/i.test(ch) ? up : ch);
      if(NAMES[up]) span.setAttribute("data-name", NAMES[up]);

      var fresh = i >= common;
      if(fresh && !reducedMotion()){
        span.classList.add("is-fresh");
        if(/[a-z]/i.test(ch)){
          span.classList.add("is-scramble");
          span.textContent = randAlpha();
          (function(s, finalCh){
            var steps = 4 + Math.floor(Math.random()*3), n = 0;
            var id = setInterval(function(){
              if(n >= steps){ clearInterval(id); s.textContent = finalCh; s.classList.remove("is-scramble"); return; }
              s.textContent = randAlpha(); n++;
            }, 34);
            timers.push(id);
          })(span, ch);
        } else { span.textContent = ch; }
        out.appendChild(span);
        // fade/unblur in
        requestAnimationFrame(function(s){ return function(){ s.classList.remove("is-fresh"); }; }(span));
      } else {
        span.textContent = ch;
        out.appendChild(span);
      }
    }
    prev = text;
  }

  function reducedMotion(){
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  // ---------- tooltip (hover / tap a glyph) ----------
  var tipHideId = null;
  function showTip(span){
    var letter = span.getAttribute("data-letter");
    if(!letter) return;
    var name = span.getAttribute("data-name");
    tip.innerHTML = name ? ("<b>"+letter+"</b> · "+name) : ("<b>"+letter+"</b>");
    var r = span.getBoundingClientRect();
    tip.style.left = (r.left + r.width/2) + "px";
    tip.style.top  = (r.top) + "px";
    tip.classList.add("is-on");
  }
  function hideTip(){ tip.classList.remove("is-on"); }

  out.addEventListener("mouseover", function(e){
    var g = e.target.closest && e.target.closest(".glyph");
    if(g && g.getAttribute("data-letter")) showTip(g);
  });
  out.addEventListener("mouseout", function(e){
    var g = e.target.closest && e.target.closest(".glyph");
    if(g) hideTip();
  });
  // touch / click: flash the tip briefly
  out.addEventListener("click", function(e){
    var g = e.target.closest && e.target.closest(".glyph");
    if(g && g.getAttribute("data-letter")){
      showTip(g);
      if(tipHideId) clearTimeout(tipHideId);
      tipHideId = setTimeout(hideTip, 1500);
    }
  });
  window.addEventListener("scroll", hideTip, true);

  // ---------- audio (soft terminal bleeps) ----------
  var actx = null, master = null, soundOn = true;
  var SCALE = [392.00, 440.00, 523.25, 587.33, 659.25, 783.99]; // G-A-C-D-E-G pentatonic
  function ensureAudio(){
    if(actx) return;
    try{
      actx = new (window.AudioContext || window.webkitAudioContext)();
      master = actx.createGain(); master.gain.value = 0.9; master.connect(actx.destination);
      // iOS silent-buffer unlock
      var b = actx.createBuffer(1,1,22050); var s = actx.createBufferSource();
      s.buffer = b; s.connect(actx.destination); s.start(0);
    }catch(e){ actx = null; }
  }
  function unlockAudio(){ ensureAudio(); if(actx && actx.state === "suspended") actx.resume(); }

  function bleep(ch){
    if(!soundOn || !actx) return;
    var t = actx.currentTime;
    var code = ch ? ch.toUpperCase().charCodeAt(0) : 65;
    var f = SCALE[code % SCALE.length] * (code % 2 ? 1 : 0.5);
    var osc = actx.createOscillator(); osc.type = "triangle"; osc.frequency.value = f;
    var o2 = actx.createOscillator(); o2.type = "sine"; o2.frequency.value = f*2;
    var lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2600;
    var g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t+0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t+0.13);
    osc.connect(g); var g2 = actx.createGain(); g2.gain.value = 0.4; o2.connect(g2); g2.connect(g);
    g.connect(lp); lp.connect(master);
    osc.start(t); o2.start(t); osc.stop(t+0.15); o2.stop(t+0.15);
  }

  // ---------- accent channels ----------
  function applyChannel(){
    var c = CHANNELS[channelIx];
    document.documentElement.style.setProperty("--accent", c.hex);
    document.documentElement.style.setProperty("--accent-rgb", c.rgb);
    accentName.textContent = c.name;
  }

  // ---------- share link ----------
  function decodeHash(){
    var m = location.hash.match(/msg=([^&]+)/);
    if(!m) return null;
    try{ return decodeURIComponent(m[1].replace(/\+/g," ")); }catch(e){ return null; }
  }
  function copyLink(){
    var base = location.href.split("#")[0];
    var url = base + "#msg=" + encodeURIComponent(input.value || "");
    var done = function(ok){
      var orig = "Copy link";
      copyBtn.textContent = ok ? "Copied ✓" : "Press ⌘C";
      setTimeout(function(){ copyBtn.textContent = orig; }, 1400);
    };
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(url).then(function(){ done(true); }, function(){ done(false); });
    } else {
      try{
        var ta = document.createElement("textarea"); ta.value = url; ta.style.position="fixed"; ta.style.opacity="0";
        document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); done(true);
      }catch(e){ done(false); }
    }
  }

  // ---------- input wiring ----------
  var hintHidden = false;
  function onInput(){
    var prevLen = prev.length;
    render(input.value);
    if(soundOn && input.value.length > prevLen){
      // bleep the newest character
      bleep(input.value.charAt(input.value.length-1));
    }
    if(!hintHidden && input.value.length){ hint.classList.add("is-hidden"); hintHidden = true; }
  }
  input.addEventListener("input", onInput);
  input.addEventListener("focus", unlockAudio);
  input.addEventListener("keydown", unlockAudio);

  revealBtn.addEventListener("click", function(){
    var on = out.classList.toggle("is-reveal");
    revealBtn.setAttribute("aria-pressed", on ? "true" : "false");
    revealBtn.textContent = on ? "Hide letters" : "Show letters";
  });
  accentBtn.addEventListener("click", function(){
    channelIx = (channelIx + 1) % CHANNELS.length;
    applyChannel();
    unlockAudio(); bleep("E");
  });
  soundBtn.addEventListener("click", function(){
    soundOn = !soundOn;
    soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
    soundBtn.textContent = soundOn ? "Sound ●" : "Sound ○";
    if(soundOn){ unlockAudio(); bleep("A"); }
  });
  copyBtn.addEventListener("click", copyLink);

  // ---------- init ----------
  applyChannel();
  var initial = decodeHash() || "May the Force be with you";
  input.value = initial;
  prev = "";                 // treat whole pre-fill as fresh so it decodes in on arrival
  render(initial);           // render() sets prev = initial when done

  if(!("ontouchstart" in window) && !decodeHash()){
    // desktop: focus & place cursor at end without scrolling the message away
    setTimeout(function(){ input.focus(); var n = input.value.length; try{ input.setSelectionRange(n,n); }catch(e){} }, 60);
  }
})();
