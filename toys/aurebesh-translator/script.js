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
  var speakBtn  = document.getElementById("speakBtn");
  var voiceBtn  = document.getElementById("voiceBtn");
  var voiceName = document.getElementById("voiceName");
  var screenEl  = document.getElementById("screen");

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

  // short radio "key" blip to open / close a transmission (plays on the
  // explicit Transmit action regardless of the ambient Sound toggle)
  function commsBlip(open){
    if(!actx) return;
    var t = actx.currentTime, dur = 0.13;
    var buf = actx.createBuffer(1, Math.floor(actx.sampleRate*dur), actx.sampleRate);
    var d = buf.getChannelData(0);
    for(var i=0;i<d.length;i++){ d[i] = (Math.random()*2-1) * Math.pow(1 - i/d.length, 1.4); }
    var src = actx.createBufferSource(); src.buffer = buf;
    var bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = open ? 1500 : 950; bp.Q.value = 5;
    var g = actx.createGain(); g.gain.value = 0.06;
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t);
  }

  // ---------- transmit: "speak" the message in Aurebesh ----------
  // Aurebesh is a script, not a spoken tongue, so we offer two voices:
  //   names  — recite each glyph's name (Aurek, Besh…) via Web Speech
  //   droid  — wordless astromech beeps, one motif per glyph (pure synth)
  var synth = window.speechSynthesis || null;
  if(synth && synth.getVoices){ try{ synth.getVoices(); synth.onvoiceschanged = function(){}; }catch(e){} }

  var VOICES = synth ? ["names","droid"] : ["droid"];
  var VOICE_LABEL = { names:"Letter names", droid:"Droid" };
  var voiceIx = 0;
  var speaking = false, speakTimer = null, hopTimer = null;

  function pickVoice(){
    if(!synth) return null;
    var vs = synth.getVoices() || [];
    if(!vs.length) return null;
    // nudge toward deeper / synthetic-sounding voices when present, else any English voice
    var pref = ["Zarvox","Trinoids","Cellos","Eddy","Rocko","Grandpa","Google UK English Male","Daniel","Microsoft David","Alex","Fred"];
    for(var i=0;i<pref.length;i++){ for(var j=0;j<vs.length;j++){ if(vs[j].name && vs[j].name.indexOf(pref[i])!==-1) return vs[j]; } }
    for(var k=0;k<vs.length;k++){ if(/^en/i.test(vs[k].lang||"")) return vs[k]; }
    return vs[0];
  }

  function clearSpoken(){
    var els = out.querySelectorAll(".glyph.speaking");
    for(var i=0;i<els.length;i++){ els[i].classList.remove("speaking"); }
  }
  function lightGlyph(g){ clearSpoken(); if(g) g.classList.add("speaking"); }

  // ordered list of { token, glyph } for each spoken character (skips spaces/unknowns)
  function tokens(){
    var list = [], glyphs = out.querySelectorAll(".glyph"), gi = 0, text = input.value;
    for(var i=0;i<text.length;i++){
      var ch = text.charAt(i);
      if(ch === " "){ continue; }
      var g = glyphs[gi++]; var up = ch.toUpperCase();
      var name = NAMES[up] || (/[0-9]/.test(ch) ? ch : null);
      list.push({ ch:ch, name:name, glyph:g });
    }
    return list;
  }

  function endTransmit(){
    speaking = false;
    if(synth){ try{ synth.cancel(); }catch(e){} }
    if(speakTimer){ clearTimeout(speakTimer); speakTimer = null; }
    if(hopTimer){ clearTimeout(hopTimer); hopTimer = null; }
    screenEl.classList.remove("is-transmitting");
    clearSpoken();
    speakBtn.textContent = "Transmit ►";
  }

  // VOICE 1 — recite glyph names, one chained utterance each (perfect highlight sync)
  function speakNames(list){
    var idx = 0;
    (function next(){
      if(!speaking) return;
      while(idx < list.length && !list[idx].name) idx++;
      if(idx >= list.length){ commsBlip(false); endTransmit(); return; }
      var tk = list[idx++];
      lightGlyph(tk.glyph);
      var u = new SpeechSynthesisUtterance(tk.name);
      var v = pickVoice(); if(v){ u.voice = v; u.lang = v.lang || "en-US"; } else { u.lang = "en-US"; }
      u.rate = 0.95; u.pitch = 0.6; u.volume = 1;
      u.onend = next; u.onerror = next;
      try{ synth.speak(u); }catch(e){ next(); }
    })();
  }

  // VOICE 2 — wordless astromech chatter, a chirp per glyph
  function droidBeep(ch){
    if(!actx) return;
    var t = actx.currentTime;
    var code = ch ? ch.toUpperCase().charCodeAt(0) : 65;
    var base = 320 + (code % 14) * 90;          // ~320..1490 Hz
    var up = (code % 2) === 0;
    var dur = 0.10 + (code % 3) * 0.03;
    var osc = actx.createOscillator(); osc.type = (code % 3 === 0) ? "square" : "sawtooth";
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(150, base * (up ? 1.7 : 0.58)), t + dur);
    var lfo = actx.createOscillator(); lfo.frequency.value = 22 + (code % 9);
    var lg = actx.createGain(); lg.gain.value = base * 0.06; lfo.connect(lg); lg.connect(osc.frequency);
    var bp = actx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = base * 1.2; bp.Q.value = 2;
    var g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.04);
    osc.connect(bp); bp.connect(g); g.connect(master);
    osc.start(t); lfo.start(t); osc.stop(t + dur + 0.06); lfo.stop(t + dur + 0.06);
  }
  function speakDroid(list){
    var idx = 0;
    (function step(){
      if(!speaking) return;
      if(idx >= list.length){ commsBlip(false); endTransmit(); return; }
      var tk = list[idx++];
      lightGlyph(tk.glyph);
      droidBeep(tk.ch);
      hopTimer = setTimeout(step, 150 + (tk.ch.charCodeAt(0) % 4) * 18);
    })();
  }

  function transmit(){
    if(speaking){ endTransmit(); return; }
    var list = tokens(); if(!list.length) return;
    unlockAudio();
    speaking = true;
    screenEl.classList.add("is-transmitting");
    speakBtn.textContent = "Transmitting…";
    commsBlip(true);
    var mode = VOICES[voiceIx] || "droid";
    if(mode === "names" && synth){
      speakNames(list);
      speakTimer = setTimeout(endTransmit, list.length * 1500 + 3000); // backstop only
    } else {
      speakDroid(list);
    }
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
    if(speaking) endTransmit();
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

  // Transmit works as long as we have any audio path (Droid is pure synth, so
  // it runs even without speechSynthesis); only hide it if the browser has none.
  var hasAudio = !!(window.AudioContext || window.webkitAudioContext);
  function updateVoiceLabel(){ voiceName.textContent = VOICE_LABEL[VOICES[voiceIx]] || "Droid"; }
  if(synth || hasAudio){
    speakBtn.addEventListener("click", transmit);
    if(VOICES.length > 1){
      voiceBtn.addEventListener("click", function(){
        if(speaking) endTransmit();
        voiceIx = (voiceIx + 1) % VOICES.length;
        updateVoiceLabel();
        unlockAudio();
        if(VOICES[voiceIx] === "droid") droidBeep("A");
      });
      updateVoiceLabel();
    } else { voiceBtn.style.display = "none"; }
  } else {
    speakBtn.style.display = "none";
    voiceBtn.style.display = "none";
  }

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
