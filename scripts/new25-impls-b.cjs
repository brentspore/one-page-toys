/* eslint-disable no-var */
/** Tools batch B + 5 toys */

module.exports = function new25ImplsB(CSS_BASE, JS_COMMON, JS_END) {
  function S(body) {
    return JS_COMMON + body + JS_END;
  }

  return {
    "markdown-previewer": function () {
      return {
        css:
          CSS_BASE +
          `.md-body{line-height:1.55}.md-body h1,.md-body h2,.md-body h3{margin:0.6em 0 0.3em;font-family:var(--font-display)}.md-body code{background:rgba(45,42,38,0.07);padding:0.1em 0.35em;border-radius:4px}.md-body pre{background:rgba(45,42,38,0.06);padding:10px;border-radius:8px;overflow:auto}.md-body a{color:var(--accent);font-weight:700}`,
        inner: `          <div class="local">
            <div class="local-row local-row--2">
              <div><label class="muted" for="mdIn" style="font-weight:800">Markdown</label><textarea class="local-text" id="mdIn" placeholder="# Hello"></textarea></div>
              <div><label class="muted" for="mdOut" style="font-weight:800">Preview</label><div class="panel md-body" id="mdOut" style="padding:12px;min-height:10rem"></div></div>
            </div>
            <div class="local-actions"><button type="button" class="btn btn--secondary" id="mdHtml">Copy HTML-ish</button></div>
            <p class="ui-live" id="mdS" aria-live="polite">Type to preview.</p>
          </div>`,
        script: S(`
        function esc(s){ return String(s).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];}); }
        function inline(s){
          s=esc(s); var BT=String.fromCharCode(96);
          s=s.replace(new RegExp(BT+'([^'+BT+']+)'+BT,'g'),'<code>$1</code>');
          s=s.replace(/\\*\\*([^*]+)\\*\\*/g,'<strong>$1</strong>');
          s=s.replace(/\\*([^*]+)\\*/g,'<em>$1</em>');
          s=s.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g,'<a href=\"$2\" target=\"_blank\" rel=\"noopener\">$1</a>');
          return s;
        }
        function run(){
          var t=$('mdIn').value||'';
          var lines=t.split(/\\n/), html=[], i=0, inCode=false, buf=[];
          var fence=String.fromCharCode(96,96,96);
          function flushCode(){ if(buf.length){ html.push('<pre><code>'+esc(buf.join('\\n'))+'</code></pre>'); buf=[]; } }
          while(i<lines.length){
            var L=lines[i];
            if(new RegExp('^\\\\s*'+fence).test(L)){ if(inCode){ flushCode(); inCode=false; } else { flushCode(); inCode=true; } i++; continue; }
            if(inCode){ buf.push(L); i++; continue; }
            if(/^####\\s+/.test(L)){ html.push('<h4>'+inline(L.replace(/^####\\s+/,''))+'</h4>'); i++; continue; }
            if(/^###\\s+/.test(L)){ html.push('<h3>'+inline(L.replace(/^###\\s+/,''))+'</h3>'); i++; continue; }
            if(/^##\\s+/.test(L)){ html.push('<h2>'+inline(L.replace(/^##\\s+/,''))+'</h2>'); i++; continue; }
            if(/^#\\s+/.test(L)){ html.push('<h1>'+inline(L.replace(/^#\\s+/,''))+'</h1>'); i++; continue; }
            if(/^-\\s+/.test(L)){ var items=[]; while(i<lines.length && /^-\\s+/.test(lines[i])){ items.push('<li>'+inline(lines[i].replace(/^-\\s+/,''))+'</li>'); i++; } html.push('<ul>'+items.join('')+'</ul>'); continue; }
            if(L.trim()===''){ i++; continue; }
            html.push('<p>'+inline(L)+'</p>'); i++;
          }
          flushCode();
          $('mdOut').innerHTML=html.join(''); setStatus('mdS','Updated.');
        }
        on($('mdIn'),'input',run);
        on($('mdHtml'),'click',function(){ copyText($('mdOut').innerHTML).then(function(){ setStatus('mdS','Copied.'); }); });
        run();
        `)
      };
    },

    "og-meta-builder": function () {
      return {
        css:
          CSS_BASE +
          `.og-card{display:grid;grid-template-columns:minmax(0,140px) 1fr;gap:12px;border:1px solid var(--border);border-radius:12px;overflow:hidden;background:#fff}
.og-img{min-height:110px;background:#f4f4f0;background-size:cover;background-position:center}
.og-bod{padding:10px 12px}.og-site{font-size:0.72rem;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em}
.og-t{font-family:var(--font-display);font-weight:800;margin-top:4px}.og-d{margin-top:6px;color:var(--muted);font-size:0.9rem}
@media(max-width:520px){.og-card{grid-template-columns:1fr}}`,
        inner: `          <div class="local">
            <div class="local-row local-row--2">
              <div><label class="muted" for="ogT" style="font-weight:800">Title</label><input class="local-input" id="ogT" /></div>
              <div><label class="muted" for="ogU" style="font-weight:800">URL</label><input class="local-input" id="ogU" placeholder="https://…" /></div>
            </div>
            <label class="muted" for="ogD" style="font-weight:800">Description</label><textarea class="local-text" id="ogD" style="min-height:5rem"></textarea>
            <div class="local-row local-row--2">
              <div><label class="muted" for="ogI" style="font-weight:800">Image URL</label><input class="local-input" id="ogI" /></div>
              <div><label class="muted" for="ogN" style="font-weight:800">Site name</label><input class="local-input" id="ogN" value="One Page Toys" /></div>
            </div>
            <div class="local-actions"><button type="button" class="btn btn--secondary" id="ogCp">Copy meta tags</button></div>
            <div class="og-card"><div class="og-img" id="ogImg"></div><div class="og-bod"><div class="og-site" id="ogPs">—</div><div class="og-t" id="ogPt">—</div><div class="og-d" id="ogPd">—</div></div></div>
            <textarea class="local-text" id="ogOut" readonly style="min-height:6rem"></textarea>
            <p class="ui-live" id="ogS" aria-live="polite">Ready.</p>
          </div>`,
        script: S(`
        function q(s){ return String(s||'').replace(/"/g,'&quot;'); }
        function run(){
          var t=$('ogT').value.trim(), u=$('ogU').value.trim(), d=$('ogD').value.trim(), img=$('ogI').value.trim(), n=$('ogN').value.trim();
          $('ogPt').textContent=t||'—'; $('ogPd').textContent=d||'—'; $('ogPs').textContent=n||'—';
          var el=$('ogImg'); if(img){ el.style.backgroundImage='url('+img+')'; el.textContent=''; } else { el.style.backgroundImage='none'; el.textContent='Image'; }
          var L=[];
          if(t){ L.push('<meta property="og:title" content="'+q(t)+'" />'); L.push('<meta name="twitter:title" content="'+q(t)+'" />'); }
          if(d){ L.push('<meta property="og:description" content="'+q(d)+'" />'); L.push('<meta name="twitter:description" content="'+q(d)+'" />'); }
          if(u){ L.push('<meta property="og:url" content="'+q(u)+'" />'); }
          if(n){ L.push('<meta property="og:site_name" content="'+q(n)+'" />'); }
          if(img){ L.push('<meta property="og:image" content="'+q(img)+'" />'); L.push('<meta name="twitter:image" content="'+q(img)+'" />'); L.push('<meta name="twitter:card" content="summary_large_image" />'); }
          $('ogOut').value=L.join('\\n'); setStatus('ogS','Updated.');
        }
        ['ogT','ogU','ogD','ogI','ogN'].forEach(function(id){ on($(id),'input',run); });
        on($('ogCp'),'click',function(){ copyText($('ogOut').value||'').then(function(){ setStatus('ogS','Copied.'); }); });
        run();
        `)
      };
    },

    "a11y-quick-checklist": function () {
      var items = [
        "Headings follow logical order (H1 → H2…)",
        "Interactive elements show keyboard focus",
        "Controls have clear accessible names",
        "Body text has sufficient color contrast",
        "Form inputs have labels / instructions",
        "Motion can be reduced (prefers-reduced-motion)",
        "Core flows work with keyboard only",
        "Dynamic updates expose status (aria-live when needed)"
      ];
      var checks = items
        .map(function (txt, i) {
          return '<label class="a11-l"><input type="checkbox" data-i="' + i + '" /> <span>' + txt + "</span></label>";
        })
        .join("");
      return {
        css: CSS_BASE + `.a11-l{display:flex;gap:10px;align-items:flex-start;font-weight:650}.a11-l input{margin-top:3px}`,
        inner: `          <div class="local">
            <div class="ui-hud"><div class="ui-stat"><span class="ui-stat__label">Done</span><span class="ui-stat__value" id="aD">0</span></div><div class="ui-stat"><span class="ui-stat__label">Total</span><span class="ui-stat__value" id="aT">${items.length}</span></div></div>
            <div class="panel" style="padding:12px">${checks}</div>
            <div class="local-actions"><button type="button" class="btn btn--secondary" id="aCp">Copy</button><button type="button" class="btn" id="aR">Reset</button></div>
            <p class="ui-live" id="aS" aria-live="polite">Saved locally.</p>
          </div>`,
        script: S(`
        var K='ops_a11y_v1', st=load(K,{c:{}});
        var boxes=[].slice.call(document.querySelectorAll('.a11-l input'));
        function renderCount(){ var n=0; boxes.forEach(function(b){ if(b.checked) n++; }); $('aD').textContent=String(n); }
        boxes.forEach(function(b){
          var i=b.getAttribute('data-i'); b.checked=!!(st.c&&st.c[i]);
          b.addEventListener('change',function(){ st.c=st.c||{}; st.c[i]=b.checked; save(K,st); renderCount(); setStatus('aS','Saved.'); });
        });
        on($('aR'),'click',function(){ st={c:{}}; save(K,st); boxes.forEach(function(b){ b.checked=false; }); renderCount(); setStatus('aS','Reset.'); });
        on($('aCp'),'click',function(){ var lines=[]; boxes.forEach(function(b){ var i=b.getAttribute('data-i'); var t=b.parentElement.textContent.trim(); lines.push((b.checked?'[x] ':'[ ] ')+t); }); copyText(lines.join('\\n')).then(function(){ setStatus('aS','Copied.'); }); });
        renderCount();
        `)
      };
    },

    "unit-converter": function () {
      return {
        css: CSS_BASE,
        inner: `          <div class="local">
            <div class="ui-hud"><div class="ui-stat"><span class="ui-stat__label">Base px</span><span class="ui-stat__value" id="uB">16</span></div></div>
            <div class="local-row local-row--2">
              <div><label class="muted" for="uRoot" style="font-weight:800">Root font (px)</label><input class="local-input" type="number" id="uRoot" min="8" max="32" value="16" /></div>
              <div></div>
            </div>
            <div class="local-row local-row--2">
              <div><label class="muted" for="uPx" style="font-weight:800">px</label><input class="local-input" id="uPx" inputmode="decimal" placeholder="24" /></div>
              <div><label class="muted" for="uRem" style="font-weight:800">rem</label><input class="local-input" id="uRem" inputmode="decimal" placeholder="1.5" /></div>
            </div>
            <p class="ui-live" id="uS" aria-live="polite">Type in either field.</p>
            <ul class="ui-history" id="uSteps" aria-label="Scale"></ul>
          </div>`,
        script: S(`
        function f(v){ var n=parseFloat(String(v).trim()); return isNaN(n)?null:n; }
        function root(){ return Math.max(8,Math.min(32,parseInt($('uRoot').value,10)||16)); }
        function scaleRow(b, r, k){ return (Math.round(b*Math.pow(r,k)*1000)/1000)+'px · '+(Math.round(Math.pow(r,k)*1000)/1000)+'rem'; }
        function renderSteps(){ var b=root(), r=1.25, ul=$('uSteps'); ul.innerHTML=''; [-2,-1,0,1,2,3].forEach(function(k){ var li=document.createElement('li'); li.textContent=scaleRow(b,r,k); ul.appendChild(li); }); }
        function sync(src){
          var b=root(); $('uB').textContent=String(b); $('uRoot').value=String(b); renderSteps();
          var px=f($('uPx').value), rm=f($('uRem').value);
          if(src==='px'&&px!=null){ $('uRem').value=String(Math.round(px/b*1000)/1000); }
          if(src==='rem'&&rm!=null){ $('uPx').value=String(Math.round(rm*b*1000)/1000); }
          setStatus('uS','Updated.');
        }
        on($('uPx'),'input',function(){ sync('px'); }); on($('uRem'),'input',function(){ sync('rem'); }); on($('uRoot'),'input',function(){ sync('px'); });
        sync('px');
        `)
      };
    },

    "meeting-notes-timer": function () {
      return {
        css: CSS_BASE,
        inner: `          <div class="local">
            <div class="ui-hud"><div class="ui-stat"><span class="ui-stat__label">Elapsed</span><span class="ui-stat__value" id="mtT">0:00</span></div></div>
            <div class="local-actions"><button type="button" class="btn btn--primary" id="mtGo">Start / pause</button><button type="button" class="btn" id="mtRs">Reset timer</button><button type="button" class="btn btn--secondary" id="mtEx">Export MD</button></div>
            <div class="local-row">
              <label class="muted" for="mtN" style="font-weight:800">Note line</label><input class="local-input" id="mtN" placeholder="What happened…" />
            </div>
            <div class="local-actions"><button type="button" class="btn" id="mtAdd">Add timestamped line</button></div>
            <textarea class="local-text" id="mtLog"></textarea>
            <p class="ui-live" id="mtS" aria-live="polite">Ready.</p>
          </div>`,
        script: S(`
        var run=false, t0=0, acc=0, tick=null;
        function fmt(ms){ var s=Math.floor(ms/1000), m=Math.floor(s/60); s=s%60; return m+':'+String(s).padStart(2,'0'); }
        function disp(){ $('mtT').textContent=fmt(acc+(run?Date.now()-t0:0)); }
        on($('mtGo'),'click',function(){
          if(!run){ run=true; t0=Date.now(); tick=setInterval(disp,250); } else { acc+=Date.now()-t0; run=false; clearInterval(tick); disp(); }
          setStatus('mtS', run?'Running.':'Paused.');
        });
        on($('mtRs'),'click',function(){ run=false; clearInterval(tick); acc=0; disp(); setStatus('mtS','Reset.'); });
        on($('mtAdd'),'click',function(){
          var ms=acc+(run?Date.now()-t0:0); var note=$('mtN').value.trim(); $('mtN').value='';
          var line='- ['+fmt(ms)+'] '+(note||'(note)'); $('mtLog').value += ($('mtLog').value?'\\n':'')+line; setStatus('mtS','Logged.');
        });
        on($('mtEx'),'click',function(){ copyText($('mtLog').value||'').then(function(){ setStatus('mtS','Copied log.'); }); });
        disp();
        `)
      };
    },

    "ux-copy-generator": function () {
      return {
        css: CSS_BASE,
        inner: `          <div class="local">
            <div class="local-row local-row--2">
              <div><label class="muted" for="uxCtx" style="font-weight:800">Context</label>
                <select class="local-input" id="uxCtx"><option value="btn">Button label</option><option value="empty">Empty state</option><option value="err">Error message</option><option value="success">Success toast</option></select></div>
              <div><label class="muted" for="uxTone" style="font-weight:800">Tone</label>
                <select class="local-input" id="uxTone"><option value="friendly">Friendly</option><option value="direct">Direct</option><option value="playful">Playful</option></select></div>
            </div>
            <label class="muted" for="uxTopic" style="font-weight:800">Topic (optional)</label><input class="local-input" id="uxTopic" placeholder="e.g. save recipe" />
            <div class="local-actions"><button type="button" class="btn btn--primary" id="uxGen">Generate</button><button type="button" class="btn btn--secondary" id="uxCp">Copy</button></div>
            <textarea class="local-text" id="uxOut" readonly></textarea>
            <p class="ui-live" id="uxS" aria-live="polite">Ready.</p>
          </div>`,
        script: S(`
        var B={ friendly:{btn:'Continue',empty:'Nothing here yet—add something to get started.',err:'Something went wrong. Try again in a moment.',success:'All set!'},
                direct:{btn:'Next',empty:'No items.',err:'Error. Retry.',success:'Done.'},
                playful:{btn:'Let’s go',empty:'So empty… want to drop the first thing in?',err:'Oops—tiny glitch. One more try?',success:'Nice—saved.'} };
        on($('uxGen'),'click',function(){
          var ctx=$('uxCtx').value, tone=$('uxTone').value, topic=($('uxTopic').value||'').trim();
          var pack=B[tone]||B.friendly; var base=pack[ctx]||pack.btn;
          $('uxOut').value = topic ? base + ' ('+topic+')' : base; setStatus('uxS','Generated.');
        });
        on($('uxCp'),'click',function(){ copyText($('uxOut').value||'').then(function(){ setStatus('uxS','Copied.'); }); });
        `)
      };
    },

    "file-hash-tool": function () {
      return {
        css: CSS_BASE,
        inner: `          <div class="local">
            <div class="local-actions"><button type="button" class="btn btn--primary" id="h256">SHA-256</button><button type="button" class="btn" id="h1">SHA-1</button></div>
            <div class="local-row local-row--2">
              <div><label class="muted" for="hTx" style="font-weight:800">Text</label><textarea class="local-text" id="hTx"></textarea></div>
              <div><label class="muted" for="hFi" style="font-weight:800">Or file</label><input type="file" class="local-input" id="hFi" /></div>
            </div>
            <div class="local-actions"><button type="button" class="btn btn--secondary" id="hCp">Copy digest</button></div>
            <p class="ui-live" id="hS" aria-live="polite">Ready.</p>
            <pre class="panel local-out" id="hO" style="padding:12px">—</pre>
          </div>`,
        script: S(`
        var alg='SHA-256';
        function hex(buf){ return [].map.call(new Uint8Array(buf),function(x){return x.toString(16).padStart(2,'0');}).join(''); }
        async function go(){
          try{
            var file=$('hFi').files&&$('hFi').files[0];
            var bytes=file? new Uint8Array(await file.arrayBuffer()) : new TextEncoder().encode($('hTx').value||'');
            var d=await crypto.subtle.digest(alg, bytes); $('hO').textContent=hex(d); setStatus('hS','OK.');
          }catch(e){ $('hO').textContent='—'; setStatus('hS','Not available in this context.'); }
        }
        on($('h256'),'click',function(){ alg='SHA-256'; go(); }); on($('h1'),'click',function(){ alg='SHA-1'; go(); });
        on($('hTx'),'input',function(){ $('hFi').value=''; go(); }); on($('hFi'),'change',function(){ $('hTx').value=''; go(); });
        on($('hCp'),'click',function(){ copyText($('hO').textContent||'').then(function(){ setStatus('hS','Copied.'); }); });
        go();
        `)
      };
    },

    "json-schema-quickcheck": function () {
      return {
        css: CSS_BASE,
        inner: `          <div class="local">
            <div class="local-row local-row--2">
              <div><label class="muted" for="jsD" style="font-weight:800">JSON</label><textarea class="local-text" id="jsD" placeholder='{ }'></textarea></div>
              <div><label class="muted" for="jsS" style="font-weight:800">Schema (subset)</label><textarea class="local-text" id="jsS" placeholder='{ \"type\":\"object\", \"properties\":{…} }'></textarea></div>
            </div>
            <div class="local-actions"><button type="button" class="btn btn--primary" id="jsRun">Validate</button><button type="button" class="btn btn--secondary" id="jsCp">Copy errors</button></div>
            <div class="ui-hud"><div class="ui-stat"><span class="ui-stat__label">Errors</span><span class="ui-stat__value" id="jsN">0</span></div></div>
            <pre class="panel local-out" id="jsO" style="padding:12px;min-height:6rem"></pre>
            <p class="ui-live" id="jsL" aria-live="polite">Supports: type, required, properties, items, enum, min/max, pattern (basic).</p>
          </div>`,
        script: S(`
        function err(a,p,m){ a.push(p+': '+m); }
        function val(v,s,p,errors){
          if(s===true) return; if(!s||typeof s!=='object') return;
          if(Array.isArray(s.enum) && !s.enum.some(function(x){ try{return JSON.stringify(x)===JSON.stringify(v);}catch(e){return false;} })){ err(errors,p,'not in enum'); return; }
          var t=s.type;
          if(t==='null'){ if(v!==null) err(errors,p,'expected null'); return; }
          if(t==='boolean'){ if(typeof v!=='boolean') err(errors,p,'expected boolean'); return; }
          if(t==='string'){
            if(typeof v!=='string') err(errors,p,'expected string');
            else {
              if(s.minLength!=null && v.length<s.minLength) err(errors,p,'minLength');
              if(s.maxLength!=null && v.length>s.maxLength) err(errors,p,'maxLength');
              if(s.pattern){ try{ if(!new RegExp(s.pattern).test(v)) err(errors,p,'pattern'); }catch(e){} }
            } return;
          }
          if(t==='number'||t==='integer'){
            if(typeof v!=='number'||!isFinite(v)) err(errors,p,'expected number');
            else { if(t==='integer'&&Math.floor(v)!==v) err(errors,p,'expected integer'); if(s.minimum!=null&&v<s.minimum) err(errors,p,'minimum'); if(s.maximum!=null&&v>s.maximum) err(errors,p,'maximum'); }
            return;
          }
          if(t==='array'){
            if(!Array.isArray(v)) err(errors,p,'expected array');
            else { if(s.minItems!=null && v.length<s.minItems) err(errors,p,'minItems'); if(s.items) v.forEach(function(it,i){ val(it,s.items,p+'['+i+']',errors); }); }
            return;
          }
          if(t==='object'){
            if(typeof v!=='object'||v===null||Array.isArray(v)) err(errors,p,'expected object');
            else { (s.required||[]).forEach(function(k){ if(!(k in v)) err(errors,p+'.'+k,'required'); }); var pr=s.properties||{}; Object.keys(pr).forEach(function(k){ if(k in v) val(v[k],pr[k],p+'.'+k,errors); }); }
          }
        }
        on($('jsRun'),'click',function(){
          var errors=[]; try{ var data=JSON.parse($('jsD').value||'null'); var schema=JSON.parse($('jsS').value||'{}'); val(data,schema,'$',errors); }
          catch(e){ errors=['Parse error: '+e.message]; }
          $('jsN').textContent=String(errors.length); $('jsO').textContent=errors.length?errors.join('\\n'):'OK — no issues found.'; setStatus('jsL', errors.length?'See errors.':'Valid.');
        });
        on($('jsCp'),'click',function(){ copyText($('jsO').textContent||'').then(function(){}); });
        `)
      };
    },

    "daily-doodle-prompt": function () {
      return {
        css: CSS_BASE,
        inner: `          <div class="local">
            <div class="ui-hud"><div class="ui-stat"><span class="ui-stat__label">Streak</span><span class="ui-stat__value" id="dpK">0</span></div><div class="ui-stat"><span class="ui-stat__label">Last</span><span class="ui-stat__value" id="dpL">—</span></div></div>
            <div class="panel" style="padding:12px"><p class="muted" style="margin:0 0 0.35rem;font-weight:800">Prompt</p><p style="margin:0;font-weight:800" id="dpP">—</p></div>
            <div class="local-actions"><button type="button" class="btn btn--primary" id="dpD">Mark done</button><button type="button" class="btn" id="dpN">New</button><button type="button" class="btn btn--secondary" id="dpC">Copy</button></div>
            <p class="ui-live" id="dpS" aria-live="polite">—</p>
          </div>`,
        script: S(`
        var PR=${JSON.stringify([
          "Sketch a mascot for this site.",
          "Design a button that feels honest.",
          "Draw an icon for “Surprise me”.",
          "Three shapes, two colors—make a sticker.",
          "A loading state that feels humane.",
          "An error message you’d actually read.",
          "Constellation made of tiny tools.",
          "A door that leads somewhere weird.",
          "Typography-only creature.",
          "Micro-interaction you can describe in one sentence."
        ])};
        function day(d){ return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0'); }
        function pick(seed){ var h=0; for(var i=0;i<seed.length;i++) h=(h*31+seed.charCodeAt(i))>>>0; return PR[h%PR.length]; }
        var K='ops_doodle_v1', st=load(K,{day:'',prompt:'',streak:0,done:''});
        function sync(){ var t=day(new Date()); if(st.day!==t){ st.day=t; st.prompt=pick(t+Math.random()); save(K,st); } $('dpP').textContent=st.prompt; $('dpK').textContent=String(st.streak||0); $('dpL').textContent=st.done||'—'; }
        on($('dpD'),'click',function(){
          var t=day(new Date()); if(st.done===t){ setStatus('dpS','Already today.'); return; }
          var y=new Date(); y.setUTCDate(y.getUTCDate()-1);
          st.streak = (st.done===day(y)) ? (st.streak||0)+1 : 1; st.done=t; save(K,st); sync(); setStatus('dpS','Marked done.');
        });
        on($('dpN'),'click',function(){ st.prompt=pick(String(Date.now())); save(K,st); sync(); setStatus('dpS','New prompt.'); });
        on($('dpC'),'click',function(){ copyText($('dpP').textContent||'').then(function(){ setStatus('dpS','Copied.'); }); });
        sync();
        `)
      };
    },

    "reaction-ladder": function () {
      return {
        css: CSS_BASE + `.rlb{min-height:3.5rem;padding:0 1.25rem;font-weight:800}`,
        inner: `          <div class="local">
            <div class="ui-hud"><div class="ui-stat"><span class="ui-stat__label">Round</span><span class="ui-stat__value" id="rlR">0/10</span></div><div class="ui-stat"><span class="ui-stat__label">Best</span><span class="ui-stat__value" id="rlB">—</span></div><div class="ui-stat"><span class="ui-stat__label">Avg</span><span class="ui-stat__value" id="rlA">—</span></div></div>
            <div class="panel" style="padding:14px;text-align:center">
              <button type="button" class="btn btn--primary rlb" id="rlBtn">Start</button>
              <p class="ui-live" id="rlS" aria-live="polite" style="margin-top:12px">Wait for green-ish cue, then click.</p>
            </div>
            <p class="muted" style="margin:0;font-weight:800">Recent runs</p>
            <ul class="ui-history" id="rlH"></ul>
          </div>`,
        script: S(`
        var K='ops_rladder_v1', st=load(K,{h:[]});
        var rounds=[], total=10, phase='done', tmr=null, goAt=0, btn=$('rlBtn');
        function ms(n){ return Math.round(n)+'ms'; }
        function stats(){ if(!rounds.length){ $('rlB').textContent=$('rlA').textContent='—'; return; } var b=Math.min.apply(null,rounds), a=rounds.reduce(function(x,y){return x+y;},0)/rounds.length; $('rlB').textContent=ms(b); $('rlA').textContent=ms(a); }
        function lbl(){ $('rlR').textContent=rounds.length+'/'+total; }
        function hud(){ lbl(); stats(); }
        function hist(){ var ul=$('rlH'); ul.innerHTML=''; (st.h||[]).slice(0,8).forEach(function(x){ var li=document.createElement('li'); li.textContent=ms(x.b)+' best · '+ms(x.a)+' avg'; ul.appendChild(li); }); }
        function finish(){ var b=Math.min.apply(null,rounds), a=rounds.reduce(function(x,y){return x+y;},0)/rounds.length; st.h=[{b:b,a:a,t:Date.now()}].concat(st.h||[]).slice(0,10); save(K,st); hist(); phase='done'; btn.disabled=false; btn.textContent='Start again'; btn.style.background=''; hud(); setStatus('rlS','Run complete.'); }
        function nextWait(){ if(rounds.length>=total){ finish(); return; }
          phase='wait'; btn.disabled=true; btn.textContent='Wait…'; btn.style.background=''; setStatus('rlS','Wait…'); var d=550+Math.random()*1600;
          tmr=setTimeout(function(){ phase='go'; btn.disabled=false; btn.textContent='Tap!'; btn.style.background='rgba(34,197,94,0.85)'; goAt=performance.now(); setStatus('rlS','Go!'); }, d);
        }
        on(btn,'click',function(){
          if(phase==='done'){ rounds=[]; hud(); phase='wait'; nextWait(); return; }
          if(phase==='wait'){ clearTimeout(tmr); btn.disabled=false; btn.textContent='Start again'; phase='done'; setStatus('rlS','Too soon—tap Start again.'); return; }
          if(phase==='go'){ var dt=performance.now()-goAt; rounds.push(dt); btn.style.background=''; lbl(); stats(); setStatus('rlS',ms(dt)); setTimeout(nextWait, 400); }
        });
        hist(); hud(); btn.textContent='Start';
        `)
      };
    },

    "tiny-idle-garden": function () {
      return {
        css: CSS_BASE + `.ig{font-size:4.5rem;line-height:1;text-align:center;filter:drop-shadow(0 10px 16px rgba(15,23,42,0.15))}`,
        inner: `          <div class="local">
            <div class="ui-hud"><div class="ui-stat"><span class="ui-stat__label">Growth</span><span class="ui-stat__value" id="igG">0%</span></div><div class="ui-stat"><span class="ui-stat__label">Taps</span><span class="ui-stat__value" id="igT">0</span></div></div>
            <div class="panel" style="padding:16px;text-align:center"><div class="ig" id="igP">🌱</div><p class="ui-live" id="igS" aria-live="polite" style="margin-top:12px">Grow.</p><div class="local-actions"><button type="button" class="btn btn--primary" id="igW">Water</button><button type="button" class="btn" id="igR">Reset</button></div></div>
          </div>`,
        script: S(`
        var K='ops_garden_v1', st=load(K,{g:0,n:0,last:Date.now()});
        function emoji(){ var g=st.g||0; return g<15?'🌱':g<40?'🌿':g<75?'🪴':'🌳'; }
        function render(){ $('igG').textContent=Math.min(100,0|st.g)+'%'; $('igT').textContent=String(st.n||0); $('igP').textContent=emoji(); }
        function tick(){ var now=Date.now(); st.g=(st.g||0)+Math.min(2,(now-(st.last||now))/20000); st.last=now; st.g=Math.min(100,st.g); save(K,st); render(); }
        setInterval(tick,1000);
        on($('igW'),'click',function(){ st.n=(st.n||0)+1; st.g=Math.min(100,(st.g||0)+6); save(K,st); render(); setStatus('igS','Nice.'); });
        on($('igR'),'click',function(){ st={g:0,n:0,last:Date.now()}; save(K,st); render(); setStatus('igS','Reset.'); });
        render();
        `)
      };
    },

    "mood-meteor": function () {
      return {
        css:
          CSS_BASE +
          `.sky{height:200px;border-radius:var(--radius-sm);border:1px solid var(--border);position:relative;overflow:hidden}.sky i{position:absolute;inset:0;background:radial-gradient(circle at 20% 20%, rgba(255,255,255,0.45), transparent 42%),radial-gradient(circle at 75% 35%, rgba(255,255,255,0.35), transparent 38%);mix-blend-mode:overlay;animation:dr 9s ease-in-out infinite}
@keyframes dr{50%{transform:translate(10px,-8px)}}`,
        inner: `          <div class="local">
            <div class="local-actions" id="mdBtns"></div>
            <div class="panel" style="padding:0"><div class="sky" id="sky"><i></i></div></div>
            <p class="ui-live" id="mdS" aria-live="polite">Pick a mood.</p>
            <div class="local-actions"><button type="button" class="btn btn--primary" id="mdL">Log today</button><button type="button" class="btn btn--secondary" id="mdC">Copy</button><button type="button" class="btn" id="mdX">Clear log</button></div>
            <ul class="ui-history" id="mdH"></ul>
          </div>`,
        script: S(`
        var MOODS=[['Calm','linear-gradient(135deg,#93c5fd,#a7f3d0)'],['Focus','linear-gradient(135deg,#c7d2fe,#fef3c7)'],['Hype','linear-gradient(135deg,#fb7185,#fbbf24)'],['Cozy','linear-gradient(135deg,#fda4af,#fde68a)'],['Midnight','linear-gradient(135deg,#0f172a,#6366f1)']];
        var K='ops_mood_v1', st=load(K,{i:0,h:[]});
        var wrap=$('mdBtns'); MOODS.forEach(function(m,idx){ var b=document.createElement('button'); b.type='button'; b.className='btn'+(idx===st.i?' btn--primary':''); b.textContent=m[0]; b.addEventListener('click',function(){ st.i=idx; save(K,st); paint(); }); wrap.appendChild(b); });
        function day(d){ return d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0'); }
        function paint(){ var i=st.i||0; $('sky').style.background=MOODS[i][1]; [].forEach.call(wrap.querySelectorAll('button'),function(b,idx){ b.className='btn'+(idx===i?' btn--primary':''); }); $('mdS').textContent='Mood: '+MOODS[i][0];
          var ul=$('mdH'); ul.innerHTML=''; (st.h||[]).slice(0,12).forEach(function(x){ var li=document.createElement('li'); li.textContent=x.d+' · '+x.m; ul.appendChild(li); });
        }
        on($('mdL'),'click',function(){ var d=day(new Date()), m=MOODS[st.i||0][0]; st.h=[{d:d,m:m}].concat((st.h||[]).filter(function(x){ return x.d!==d; }).filter(Boolean)).slice(0,12); save(K,st); paint(); setStatus('mdS','Logged '+d+'.'); });
        on($('mdC'),'click',function(){ copyText($('mdS').textContent||'').then(function(){}); });
        on($('mdX'),'click',function(){ st.h=[]; save(K,st); paint(); });
        paint();
        `)
      };
    },

    "micro-rhythm-tapper": function () {
      return {
        css:
          CSS_BASE +
          `.pad{width:min(320px,100%);height:150px;border-radius:18px;border:2px solid var(--border);background:rgba(255,254,248,0.92);box-shadow:6px 6px 0 rgba(45,42,38,0.08);font-family:var(--font-display);font-weight:800;font-size:1.2rem;cursor:pointer}`,
        inner: `          <div class="local">
            <div class="ui-hud"><div class="ui-stat"><span class="ui-stat__label">BPM</span><span class="ui-stat__value" id="rtB">100</span></div><div class="ui-stat"><span class="ui-stat__label">Score</span><span class="ui-stat__value" id="rtSc">—</span></div></div>
            <div class="local-row local-row--2">
              <div><label class="muted" for="rtIn" style="font-weight:800">Target BPM</label><input class="local-input" type="number" id="rtIn" min="40" max="200" value="100" /></div>
              <div class="local-actions" style="justify-content:flex-start"><button type="button" class="btn btn--primary" id="rtSt">Start</button><button type="button" class="btn" id="rtSp">Stop</button></div>
            </div>
            <div class="panel" style="padding:14px;text-align:center"><button type="button" class="pad" id="rtPad">Tap on the beat</button><p class="ui-live" id="rtL" aria-live="polite">Space to tap.</p></div>
            <ul class="ui-history" id="rtH"></ul>
          </div>`,
        script: S(`
        var run=false, t0=0, taps=[], iv=null, K='ops_rhy_v1', st=load(K,{h:[]});
        function bpm(){ return Math.max(40,Math.min(200,parseInt($('rtIn').value,10)||100)); }
        function beat(){ return 60000/bpm(); }
        function score(){
          if(taps.length<3){ $('rtSc').textContent='—'; return; }
          var b=beat(), err=taps.map(function(t){ var x=(t-t0)%b; return Math.min(x,b-x); }), avg=err.reduce(function(a,c){return a+c;},0)/err.length, sc=Math.max(0,100-(avg/(b/2))*100);
          $('rtSc').textContent=Math.round(sc)+'%';
        }
        function hist(){ var ul=$('rtH'); ul.innerHTML=''; (st.h||[]).slice(0,8).forEach(function(x){ var li=document.createElement('li'); li.textContent=x.b+' bpm · '+x.sc+'%'; ul.appendChild(li); }); }
        function tap(){ if(!run){ setStatus('rtL','Start first.'); return; } taps.push(performance.now()); score(); }
        on($('rtSt'),'click',function(){ run=true; taps=[]; t0=performance.now(); $('rtB').textContent=String(bpm()); iv=setInterval(function(){ $('rtPad').classList.toggle('btn--primary'); }, beat()); setStatus('rtL','Tap!'); });
        on($('rtSp'),'click',function(){ run=false; clearInterval(iv); $('rtPad').classList.remove('btn--primary'); var sc=parseInt($('rtSc').textContent,10); if(!isNaN(sc)&&taps.length>=3){ st.h=[{b:bpm(),sc:sc,t:Date.now()}].concat(st.h||[]).slice(0,10); save(K,st); hist(); } setStatus('rtL','Stopped.'); });
        on($('rtPad'),'click',tap); document.addEventListener('keydown',function(e){ if(e.code==='Space'){ e.preventDefault(); tap(); } });
        hist();
        `)
      };
    }
  };
};
