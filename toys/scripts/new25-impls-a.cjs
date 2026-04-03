/* eslint-disable no-var */
/** Tools batch A: clipboard through image compressor */

module.exports = function new25ImplsA(CSS_BASE, JS_COMMON, JS_END) {
  function S(body) {
    return JS_COMMON + body + JS_END;
  }

  return {
    "clipboard-stack": function () {
      return {
        css:
          CSS_BASE +
          `.cs-list{display:grid;gap:0.75rem}.cs-item{padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:rgba(255,255,255,0.92)}.cs-top{display:flex;flex-wrap:wrap;gap:0.5rem;justify-content:space-between;align-items:flex-start}.cs-pre{margin:10px 0 0;white-space:pre-wrap;word-break:break-word;font-size:0.9rem}`,
        inner: `          <div class="local">
            <div class="ui-hud" aria-label="Stats">
              <div class="ui-stat"><span class="ui-stat__label">Items</span><span class="ui-stat__value" id="csCount">0</span></div>
              <div class="ui-stat"><span class="ui-stat__label">Pinned</span><span class="ui-stat__value" id="csPin">0</span></div>
            </div>
            <div class="local-row local-row--2">
              <div><label class="muted" for="csLabel" style="font-weight:800">Label</label><input class="local-input" id="csLabel" placeholder="Optional" /></div>
              <div><label class="muted" for="csText" style="font-weight:800">Text</label><textarea class="local-text" id="csText" placeholder="Paste…"></textarea></div>
            </div>
            <div class="local-actions">
              <button type="button" class="btn btn--primary" id="csAdd">Add</button>
              <button type="button" class="btn" id="csClear">Clear all</button>
            </div>
            <p class="ui-live" id="csStatus" aria-live="polite">Ready.</p>
            <div class="cs-list" id="csList"></div>
          </div>`,
        script: S(`
        var KEY='ops_clipstack_v1';
        var items = load(KEY, []);
        function esc(s){ return String(s).replace(/[&<>\"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[ch]||ch;}); }
        function render(){
          var list=$('csList'); list.innerHTML='';
          var p=0; items.forEach(function(it){ if(it.pinned)p++; });
          $('csCount').textContent=String(items.length); $('csPin').textContent=String(p);
          if(!items.length){ var e=document.createElement('p'); e.className='muted'; e.textContent='No items yet.'; list.appendChild(e); return; }
          items.slice().sort(function(a,b){ return (b.pinned===true)-(a.pinned===true) || (b.t-a.t); }).forEach(function(it){
            var card=document.createElement('div'); card.className='cs-item';
            var top=document.createElement('div'); top.className='cs-top';
            var t=document.createElement('div'); t.innerHTML='<strong>'+esc(it.label||'Untitled')+'</strong>';
            var act=document.createElement('div'); act.className='local-actions'; act.style.justifyContent='flex-end';
            var b1=document.createElement('button'); b1.type='button'; b1.className='btn btn--secondary'; b1.textContent='Copy';
            b1.addEventListener('click',function(){ copyText(it.text).then(function(){ setStatus('csStatus','Copied.'); }); });
            var b2=document.createElement('button'); b2.type='button'; b2.className='btn'; b2.textContent=it.pinned?'Unpin':'Pin';
            b2.addEventListener('click',function(){ it.pinned=!it.pinned; save(KEY,items); render(); });
            var b3=document.createElement('button'); b3.type='button'; b3.className='btn'; b3.textContent='Delete';
            b3.addEventListener('click',function(){ items=items.filter(function(x){ return x.id!==it.id; }); save(KEY,items); render(); });
            act.appendChild(b1); act.appendChild(b2); act.appendChild(b3);
            top.appendChild(t); top.appendChild(act);
            var pre=document.createElement('pre'); pre.className='cs-pre'; pre.textContent=it.text;
            card.appendChild(top); card.appendChild(pre); list.appendChild(card);
          });
        }
        on($('csAdd'),'click',function(){
          var label=$('csLabel').value.trim(); var text=$('csText').value;
          if(!text.trim()){ setStatus('csStatus','Add text first.'); return; }
          items.unshift({ id:String(Date.now())+Math.random().toString(16).slice(2), label:label, text:text, pinned:false, t:Date.now() });
          save(KEY,items); $('csLabel').value=''; $('csText').value=''; setStatus('csStatus','Saved.'); render();
        });
        on($('csClear'),'click',function(){ items=[]; save(KEY,items); setStatus('csStatus','Cleared.'); render(); });
        render();
        `)
      };
    },

    "diff-two-texts": function () {
      return {
        css: CSS_BASE + `.d-out{max-height:20rem;overflow:auto;font-size:0.88rem}.d-line{margin:0;padding:2px 6px;border-radius:4px}.d-add{background:rgba(34,197,94,0.18)}.d-rem{background:rgba(239,68,68,0.16)}`,
        inner: `          <div class="local">
            <div class="ui-hud" aria-label="Diff"><div class="ui-stat"><span class="ui-stat__label">+</span><span class="ui-stat__value" id="dP">0</span></div><div class="ui-stat"><span class="ui-stat__label">−</span><span class="ui-stat__value" id="dM">0</span></div></div>
            <div class="local-row local-row--2">
              <div><label class="muted" for="dA" style="font-weight:800">A</label><textarea class="local-text" id="dA"></textarea></div>
              <div><label class="muted" for="dB" style="font-weight:800">B</label><textarea class="local-text" id="dB"></textarea></div>
            </div>
            <div class="local-actions"><button type="button" class="btn btn--primary" id="dRun">Update</button><button type="button" class="btn btn--secondary" id="dCopy">Copy unified</button></div>
            <p class="ui-live" id="dS" aria-live="polite">Ready.</p>
            <pre class="panel d-out" id="dO"></pre>
          </div>`,
        script: S(`
        var K='ops_diff_v1'; var st=load(K,{a:'',b:''}); $('dA').value=st.a||''; $('dB').value=st.b||'';
        function diff(a,b){ var A=a.split(/\\n/), B=b.split(/\\n/), n=A.length,m=B.length; var dp=Array.from({length:n+1},()=>new Array(m+1).fill(0));
          for(var i=n-1;i>=0;i--) for(var j=m-1;j>=0;j--) dp[i][j]=A[i]===B[j]?dp[i+1][j+1]+1:Math.max(dp[i+1][j],dp[i][j+1]);
          var i=0,j=0,o=[]; while(i<n&&j<m){ if(A[i]===B[j]){o.push({t:' ',v:A[i]});i++;j++;} else if(dp[i+1][j]>=dp[i][j+1]){o.push({t:'-',v:A[i++]});} else {o.push({t:'+',v:B[j++]});} }
          while(i<n)o.push({t:'-',v:A[i++]}); while(j<m)o.push({t:'+',v:B[j++]}); return o; }
        function run(){ var a=$('dA').value||'', b=$('dB').value||''; save(K,{a:a,b:b}); var ops=diff(a,b); var P=0,M=0; ops.forEach(function(o){ if(o.t==='+')P++; if(o.t==='-')M++; }); $('dP').textContent=String(P); $('dM').textContent=String(M);
          var txt='--- A\\n+++ B\\n'; ops.forEach(function(o){ txt+=o.t+o.v+'\\n'; }); $('dO').textContent=txt; setStatus('dS','Updated.'); }
        on($('dRun'),'click',run); on($('dCopy'),'click',function(){ copyText($('dO').textContent||'').then(function(){ setStatus('dS','Copied.'); }); });
        on($('dA'),'input',run); on($('dB'),'input',run); run();
        `)
      };
    },

    "regex-tester": function () {
      return {
        css:
          CSS_BASE +
          `.rx-h{white-space:pre-wrap;word-break:break-word;min-height:6rem;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:#fff}
.rx-h mark{background:rgba(240,180,41,0.45);padding:0 2px;border-radius:3px}`,
        inner: `          <div class="local">
            <div class="local-row local-row--2">
              <div><label class="muted" for="rxP" style="font-weight:800">Pattern</label><input class="local-input" id="rxP" placeholder="(\\\\w+)" /></div>
              <div><label class="muted" for="rxF" style="font-weight:800">Flags</label><input class="local-input" id="rxF" value="g" /></div>
            </div>
            <div class="local-row local-row--2">
              <div><label class="muted" for="rxT" style="font-weight:800">Text</label><textarea class="local-text" id="rxT"></textarea></div>
              <div><label class="muted" for="rxR" style="font-weight:800">Replace</label><input class="local-input" id="rxR" placeholder="$1" /><p class="muted" style="margin:0.5rem 0 0;font-weight:800">Preview</p><pre class="panel local-out" id="rxPrev" style="padding:10px;min-height:4rem"></pre></div>
            </div>
            <div class="ui-hud"><div class="ui-stat"><span class="ui-stat__label">Matches</span><span class="ui-stat__value" id="rxN">0</span></div></div>
            <p class="ui-live" id="rxS" aria-live="polite">Ready.</p>
            <div class="rx-h" id="rxH" aria-label="Highlighted"></div>
          </div>`,
        script: S(`
        function eH(str){ return String(str).replace(/[&<>\"']/g,function(ch){ return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[ch]||ch;}); }
        function run(){
          var pat=$('rxP').value, fl=($('rxF').value||'').replace(/[^gimsuy]/g,''), txt=$('rxT').value||'', rep=$('rxR').value;
          var re; try{ re=new RegExp(pat, fl); }catch(e){ $('rxH').textContent=txt; $('rxPrev').textContent=''; $('rxN').textContent='0'; setStatus('rxS','Invalid pattern.'); return; }
          try{ $('rxPrev').textContent = rep ? txt.replace(re, rep) : ''; }catch(e){ $('rxPrev').textContent=''; }
          if(!pat){ $('rxH').innerHTML=eH(txt); $('rxN').textContent='0'; setStatus('rxS','Ready.'); return; }
          var n=0, html='', last=0; if(!fl.includes('g')){ var m=txt.match(re); if(m){ n=1; var s=m.index, e=s+m[0].length; html=eH(txt.slice(0,s))+'<mark>'+eH(txt.slice(s,e))+'</mark>'+eH(txt.slice(e));} else html=eH(txt); $('rxH').innerHTML=html; $('rxN').textContent=String(n); setStatus('rxS','Updated.'); return; }
          re.lastIndex=0; var m; while((m=re.exec(txt))){ n++; var s=m.index, e=s+m[0].length; html+=eH(txt.slice(last,s))+'<mark>'+eH(txt.slice(s,e))+'</mark>'; last=e; if(m[0].length===0) re.lastIndex++; if(n>800) break; }
          html+=eH(txt.slice(last)); $('rxH').innerHTML=html; $('rxN').textContent=String(n); setStatus('rxS','Updated.');
        }
        ['rxP','rxF','rxT','rxR'].forEach(function(id){ on($(id),'input',run); }); run();
        `)
      };
    },

    "uuid-nanoid-generator": function () {
      return {
        css: CSS_BASE,
        inner: `          <div class="local">
            <div class="ui-hud"><div class="ui-stat"><span class="ui-stat__label">Type</span><span class="ui-stat__value" id="idTy">UUID</span></div><div class="ui-stat"><span class="ui-stat__label">Count</span><span class="ui-stat__value" id="idC">10</span></div></div>
            <div class="local-row local-row--2">
              <div><label class="muted" for="idN" style="font-weight:800">Count</label><input class="local-input" type="number" id="idN" min="1" max="300" value="10" /></div>
              <div><label class="muted" for="idL" style="font-weight:800">Nanoid length</label><input class="local-input" type="number" id="idL" min="6" max="64" value="16" /></div>
            </div>
            <div class="local-actions"><button type="button" class="btn btn--primary" id="idU">UUID</button><button type="button" class="btn" id="idNano">Nanoid</button><button type="button" class="btn btn--secondary" id="idCopy">Copy</button></div>
            <p class="ui-live" id="idS" aria-live="polite">Ready.</p>
            <textarea class="local-text" id="idOut" readonly style="min-height:8rem"></textarea>
          </div>`,
        script: S(`
        var ty='uuid';
        function rb(n){ var a=new Uint8Array(n); try{crypto.getRandomValues(a);}catch(e){for(var i=0;i<n;i++)a[i]=0|Math.random()*256;} return a; }
        function uuid(){ if(crypto.randomUUID) return crypto.randomUUID(); var b=rb(16); b[6]=(b[6]&15)|64; b[8]=(b[8]&63)|128; var h=[].map.call(b,function(x){return x.toString(16).padStart(2,'0');}).join(''); return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20); }
        function nano(L){ var ab='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_'; var b=rb(L), o=''; for(var i=0;i<L;i++) o+=ab[b[i]%ab.length]; return o; }
        function gen(){ var n=Math.max(1,Math.min(300,parseInt($('idN').value,10)||10)); var L=Math.max(6,Math.min(64,parseInt($('idL').value,10)||16)); $('idN').value=String(n); $('idL').value=String(L); $('idTy').textContent=ty==='uuid'?'UUID':'Nanoid'; $('idC').textContent=String(n);
          var lines=[]; for(var i=0;i<n;i++) lines.push(ty==='uuid'?uuid():nano(L)); $('idOut').value=lines.join('\\n'); setStatus('idS','Generated.'); }
        on($('idU'),'click',function(){ ty='uuid'; gen(); }); on($('idNano'),'click',function(){ ty='nanoid'; gen(); }); on($('idCopy'),'click',function(){ copyText($('idOut').value||'').then(function(){ setStatus('idS','Copied.'); }); }); on($('idN'),'input',gen); on($('idL'),'input',gen); gen();
        `)
      };
    },

    "timestamp-converter": function () {
      return {
        css: CSS_BASE,
        inner: `          <div class="local">
            <div class="ui-hud"><div class="ui-stat"><span class="ui-stat__label">Now UTC</span><span class="ui-stat__value" id="tsN" style="font-size:0.75rem">—</span></div></div>
            <div class="local-row local-row--2">
              <div><label class="muted" for="tsU" style="font-weight:800">Unix (seconds)</label><input class="local-input" id="tsU" inputmode="numeric" placeholder="…" /></div>
              <div><label class="muted" for="tsI" style="font-weight:800">ISO / date string</label><input class="local-input" id="tsI" placeholder="2026-04-03T12:00:00Z" /></div>
            </div>
            <div class="local-row local-row--2">
              <div><label class="muted" for="tsZ" style="font-weight:800">Timezone</label><select class="local-input" id="tsZ"></select></div>
              <div class="local-actions" style="justify-content:flex-start"><button type="button" class="btn btn--primary" id="tsNow">Now</button><button type="button" class="btn btn--secondary" id="tsCp">Copy formatted</button></div>
            </div>
            <div class="panel" style="padding:12px"><code id="tsF" class="local-out">—</code></div>
            <p class="ui-live" id="tsS" aria-live="polite">Ready.</p>
          </div>`,
        script: S(`
        var tzSel=$('tsZ'); var tzs=[]; try{ tzs = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : ['UTC']; }catch(e){ tzs=['UTC']; }
        tzs.forEach(function(t){ var o=document.createElement('option'); o.value=t; o.textContent=t; tzSel.appendChild(o); });
        var def = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; tzSel.value = tzs.indexOf(def)>=0 ? def : 'UTC';
        function fmt(d){ try{ return new Intl.DateTimeFormat('en-US',{timeZone:tzSel.value,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(d); }catch(e){ return d.toISOString(); } }
        function tick(){ $('tsN').textContent=new Date().toISOString().replace('T',' ').slice(0,19)+'Z'; }
        setInterval(tick,500); tick();
        function parse(){
          var u=$('tsU').value.trim(), i=$('tsI').value.trim(), d=null;
          if(u){ var s=parseInt(u,10); if(!isNaN(s)) d=new Date(s*1000); }
          else if(i){ d=new Date(i); }
          if(!d||isNaN(d.getTime())){ $('tsF').textContent='—'; setStatus('tsS','Enter unix or date.'); return; }
          $('tsF').textContent=fmt(d)+' · '+tzSel.value; setStatus('tsS','OK.');
        }
        on($('tsU'),'input',function(){ $('tsI').value=''; parse(); }); on($('tsI'),'input',function(){ $('tsU').value=''; parse(); }); on($('tsZ'),'change',parse);
        on($('tsNow'),'click',function(){ var d=new Date(); $('tsU').value=String(Math.floor(d.getTime()/1000)); $('tsI').value=''; parse(); });
        on($('tsCp'),'click',function(){ copyText($('tsF').textContent||'').then(function(){ setStatus('tsS','Copied.'); }); });
        parse();
        `)
      };
    },

    "csv-json-converter": function () {
      return {
        css: CSS_BASE,
        inner: `          <div class="local">
            <div class="local-actions"><button type="button" class="btn btn--primary" id="cjCsv2j">CSV → JSON</button><button type="button" class="btn" id="cjJ2c">JSON → CSV</button></div>
            <div class="local-row local-row--2">
              <div><label class="muted" for="cjDel" style="font-weight:800">Delimiter</label><input class="local-input" id="cjDel" value="," maxlength="1" /></div>
              <div><label class="muted" for="cjHdr" style="font-weight:800">Header row</label><select class="local-input" id="cjHdr"><option value="yes" selected>Yes</option><option value="no">No</option></select></div>
            </div>
            <div class="local-row local-row--2">
              <div><label class="muted" for="cjIn" style="font-weight:800">Input</label><textarea class="local-text" id="cjIn"></textarea></div>
              <div><label class="muted" for="cjOut" style="font-weight:800">Output</label><textarea class="local-text" id="cjOut" readonly></textarea></div>
            </div>
            <div class="local-actions"><button type="button" class="btn btn--secondary" id="cjCp">Copy output</button></div>
            <p class="ui-live" id="cjS" aria-live="polite">Ready.</p>
          </div>`,
        script: S(`
        function parseCsv(text, delim, header){
          var rows=[], i=0, cur='', row=[], inQ=false;
          function pushCell(){ row.push(cur); cur=''; }
          function pushRow(){ rows.push(row); row=[]; }
          while(i<text.length){ var c=text[i];
            if(inQ){ if(c==='\"' && text[i+1]==='\"'){ cur+='\"'; i+=2; continue; } if(c==='\"'){ inQ=false; i++; continue; } cur+=c; i++; continue; }
            if(c==='\"'){ inQ=true; i++; continue; }
            if(c===delim){ pushCell(); i++; continue; }
            if(c==='\\n'||c==='\\r'){ if(c==='\\r'&&text[i+1]==='\\n') i++; pushCell(); pushRow(); i++; continue; }
            cur+=c; i++;
          }
          pushCell(); if(row.length>1 || row[0]!=='') pushRow();
          if(!header){ return rows.map(function(r){ return r; }); }
          var heads=rows[0]; return rows.slice(1).map(function(r){ var o={}; heads.forEach(function(h,idx){ o[h]=r[idx]!==undefined?r[idx]:''; }); return o; });
        }
        function toCsv(arr, delim){
          if(!arr.length) return '';
          if(typeof arr[0]!=='object') return '';
          var keys=Object.keys(arr[0]);
          var esc=function(v){ v=String(v==null?'':v); if(v.indexOf(delim)>=0||v.indexOf('\\n')>=0||v.indexOf('\"')>=0) return '\"'+v.replace(/\"/g,'\"\"')+'\"'; return v; };
          var lines=[keys.map(esc).join(delim)];
          arr.forEach(function(o){ lines.push(keys.map(function(k){ return esc(o[k]); }).join(delim)); });
          return lines.join('\\n');
        }
        var mode='c2j';
        function run(){
          var delim=($('cjDel').value||',').slice(0,1)||',';
          var hdr=$('cjHdr').value==='yes';
          var inp=$('cjIn').value||'';
          try{
            if(mode==='c2j'){ var data=parseCsv(inp, delim, hdr); $('cjOut').value=JSON.stringify(data,null,2); setStatus('cjS','Converted.'); }
            else { var j=JSON.parse(inp); if(!Array.isArray(j)) throw new Error('JSON must be array of objects'); $('cjOut').value=toCsv(j, delim); setStatus('cjS','Converted.'); }
          }catch(e){ $('cjOut').value=''; setStatus('cjS','Could not convert.'); }
        }
        on($('cjCsv2j'),'click',function(){ mode='c2j'; run(); }); on($('cjJ2c'),'click',function(){ mode='j2c'; run(); });
        on($('cjCp'),'click',function(){ copyText($('cjOut').value||'').then(function(){ setStatus('cjS','Copied.'); }); }); on($('cjIn'),'input',function(){});
        `)
      };
    },

    "base64-url-encoder": function () {
      return {
        css: CSS_BASE,
        inner: `          <div class="local">
            <div class="ui-hud"><div class="ui-stat"><span class="ui-stat__label">Mode</span><span class="ui-stat__value" id="bM">B64 enc</span></div></div>
            <div class="local-actions"><button type="button" class="btn btn--primary" id="b1">B64 encode</button><button type="button" class="btn" id="b2">B64 decode</button><button type="button" class="btn" id="b3">URL enc</button><button type="button" class="btn" id="b4">URL dec</button></div>
            <div class="local-row local-row--2">
              <div><label class="muted" for="bI" style="font-weight:800">In</label><textarea class="local-text" id="bI"></textarea></div>
              <div><label class="muted" for="bO" style="font-weight:800">Out</label><textarea class="local-text" id="bO" readonly></textarea></div>
            </div>
            <div class="local-actions"><button type="button" class="btn btn--secondary" id="bCp">Copy out</button><button type="button" class="btn" id="bSw">Swap</button></div>
            <p class="ui-live" id="bS" aria-live="polite">Ready.</p>
          </div>`,
        script: S(`
        var m='e64';
        function u8(s){ return new TextEncoder().encode(s); }
        function dec8(b){ return new TextDecoder().decode(b); }
        function b64e(s){ var b=u8(s), bin=''; for(var i=0;i<b.length;i++) bin+=String.fromCharCode(b[i]); return btoa(bin); }
        function b64d(s){ var bin=atob(String(s).replace(/\\s+/g,'')), u=new Uint8Array(bin.length); for(var i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i); return dec8(u); }
        function lbl(){ var L={e64:'B64 enc',d64:'B64 dec',ue:'URL enc',ud:'URL dec'}; $('bM').textContent=L[m]||m; }
        function go(){ var v=$('bI').value||''; try{ var o=''; if(m==='e64') o=b64e(v); else if(m==='d64') o=b64d(v); else if(m==='ue') o=encodeURIComponent(v); else o=decodeURIComponent(v); $('bO').value=o; setStatus('bS','OK.'); }catch(e){ $('bO').value=''; setStatus('bS','Error.');} lbl(); }
        on($('b1'),'click',function(){ m='e64'; go(); }); on($('b2'),'click',function(){ m='d64'; go(); }); on($('b3'),'click',function(){ m='ue'; go(); }); on($('b4'),'click',function(){ m='ud'; go(); });
        on($('bI'),'input',go); on($('bCp'),'click',function(){ copyText($('bO').value||'').then(function(){ setStatus('bS','Copied.'); }); });
        on($('bSw'),'click',function(){ var t=$('bI').value; $('bI').value=$('bO').value; $('bO').value=t; go(); }); lbl(); go();
        `)
      };
    },

    "jwt-inspector": function () {
      return {
        css: CSS_BASE + `.jwt-pre{max-height:14rem;overflow:auto;padding:12px;margin:0}`,
        inner: `          <div class="local">
            <label class="muted" for="jIn" style="font-weight:800">JWT</label>
            <textarea class="local-text" id="jIn" style="min-height:5rem"></textarea>
            <div class="ui-hud"><div class="ui-stat"><span class="ui-stat__label">exp</span><span class="ui-stat__value" id="jE">—</span></div></div>
            <div class="local-actions"><button type="button" class="btn btn--secondary" id="jCp">Copy payload</button></div>
            <p class="ui-live" id="jS" aria-live="polite">Ready.</p>
            <div class="local-row local-row--2">
              <div><p class="muted" style="margin:0 0 0.35rem;font-weight:800">Header</p><pre class="panel jwt-pre" id="jH"></pre></div>
              <div><p class="muted" style="margin:0 0 0.35rem;font-weight:800">Payload</p><pre class="panel jwt-pre" id="jP"></pre></div>
            </div>
          </div>`,
        script: S(`
        function b64u(s){ s=String(s).replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4) s+='='; var b=atob(s), u=new Uint8Array(b.length); for(var i=0;i<b.length;i++) u[i]=b.charCodeAt(i); return new TextDecoder().decode(u); }
        function run(){
          var raw=$('jIn').value.trim().split(' ').pop(); var p=raw.split('.');
          if(p.length<2){ $('jH').textContent=$('jP').textContent=''; $('jE').textContent='—'; setStatus('jS','Paste JWT.'); return; }
          try{ var h=JSON.parse(b64u(p[0])), pl=JSON.parse(b64u(p[1])); $('jH').textContent=JSON.stringify(h,null,2); $('jP').textContent=JSON.stringify(pl,null,2);
            if(typeof pl.exp==='number'){ var d=new Date(pl.exp*1000); $('jE').textContent=isNaN(d.getTime())?'—':d.toISOString().slice(0,19)+'Z'; } else $('jE').textContent='—';
            setStatus('jS','Decoded.'); }catch(e){ setStatus('jS','Invalid.'); }
        }
        on($('jIn'),'input',run); on($('jCp'),'click',function(){ copyText($('jP').textContent||'').then(function(){ setStatus('jS','Copied.'); }); }); run();
        `)
      };
    },

    "palette-from-image": function () {
      return {
        css:
          CSS_BASE +
          `.pal-sw{display:flex;flex-wrap:wrap;gap:8px}.pal-s{width:52px;height:52px;border-radius:10px;border:2px solid rgba(45,42,38,0.12);box-shadow:2px 2px 0 rgba(0,0,0,0.06)}`,
        inner: `          <div class="local">
            <input type="file" class="local-input" id="pF" accept="image/*" />
            <div class="local-actions"><button type="button" class="btn btn--secondary" id="pCss">Copy CSS vars</button></div>
            <div class="pal-sw" id="pSw" aria-label="Swatches"></div>
            <textarea class="local-text" id="pOut" readonly style="min-height:6rem"></textarea>
            <p class="ui-live" id="pS" aria-live="polite">Pick an image.</p>
            <canvas id="pC" hidden></canvas>
          </div>`,
        script: S(`
        var cv=$('pC'), ctx=cv.getContext('2d');
        function rgbhex(r,g,b){ return '#'+[r,g,b].map(function(x){return x.toString(16).padStart(2,'0');}).join(''); }
        on($('pF'),'change',function(ev){
          var f=ev.target.files && ev.target.files[0]; if(!f) return;
          var url=URL.createObjectURL(f); var im=new Image();
          im.onload=function(){
            var w=48,h=48; cv.width=w; cv.height=h; ctx.drawImage(im,0,0,w,h); URL.revokeObjectURL(url);
            var d=ctx.getImageData(0,0,w,h).data, buckets={};
            for(var i=0;i<d.length;i+=4){
              var r=d[i],g=d[i+1],b=d[i+2]; var R=r>>4<<4,G=g>>4<<4,B=b>>4<<4; var k=R+','+G+','+B;
              buckets[k]=(buckets[k]||0)+1;
            }
            var top=Object.keys(buckets).map(function(k){ return {k:k,n:buckets[k]}; }).sort(function(a,b){ return b.n-a.n; }).slice(0,8);
            var wrap=$('pSw'); wrap.innerHTML='';
            var lines=[':root{'];
            top.forEach(function(o,idx){
              var ps=o.k.split(','); var hex=rgbhex(+ps[0],+ps[1],+ps[2]);
              var sw=document.createElement('button'); sw.type='button'; sw.className='pal-s'; sw.style.background=hex; sw.title=hex; sw.addEventListener('click',function(){ copyText(hex).then(function(){ setStatus('pS','Copied '+hex); }); });
              wrap.appendChild(sw); lines.push('  --pal-'+(idx+1)+': '+hex+';');
            });
            lines.push('}'); $('pOut').value=lines.join('\\n'); setStatus('pS','Extracted '+top.length+' swatches.');
          };
          im.src=url;
        });
        on($('pCss'),'click',function(){ copyText($('pOut').value||'').then(function(){ setStatus('pS','Copied CSS.'); }); });
        `)
      };
    },

    "gradient-generator": function () {
      return {
        css: CSS_BASE,
        inner: `          <div class="local">
            <div class="local-row local-row--2">
              <div><label class="muted" for="gA" style="font-weight:800">Angle (deg)</label><input class="local-input" type="number" id="gA" value="135" /></div>
              <div><label class="muted" for="gC1" style="font-weight:800">Color A</label><input class="local-input" type="color" id="gC1" value="#6366f1" /></div>
            </div>
            <div class="local-row local-row--2">
              <div><label class="muted" for="gC2" style="font-weight:800">Color B</label><input class="local-input" type="color" id="gC2" value="#fbbf24" /></div>
              <div><label class="muted" for="gPrev" style="font-weight:800">Preview</label><div id="gP" style="height:100px;border-radius:var(--radius-sm);border:1px solid var(--border)"></div></div>
            </div>
            <div class="local-actions"><button type="button" class="btn btn--secondary" id="gCp">Copy CSS</button></div>
            <textarea class="local-text" id="gOut" readonly style="min-height:4rem"></textarea>
            <p class="ui-live" id="gS" aria-live="polite">Ready.</p>
          </div>`,
        script: S(`
        function run(){ var a=parseInt($('gA').value,10)||0, c1=$('gC1').value, c2=$('gC2').value;
          var css='background: linear-gradient('+a+'deg, '+c1+', '+c2+');';
          $('gP').style.background='linear-gradient('+a+'deg,'+c1+','+c2+')'; $('gOut').value=css; setStatus('gS','Updated.'); }
        ['gA','gC1','gC2'].forEach(function(id){ on($(id),'input',run); }); on($('gCp'),'click',function(){ copyText($('gOut').value||'').then(function(){ setStatus('gS','Copied.'); }); }); run();
        `)
      };
    },

    "favicon-generator": function () {
      return {
        css: CSS_BASE,
        inner: `          <div class="local">
            <input type="file" class="local-input" id="fvF" accept="image/*" />
            <p class="muted">Generates square PNGs: 32, 16, 180 (download each).</p>
            <div class="local-actions">
              <button type="button" class="btn btn--primary" id="fv32">Download 32×32</button>
              <button type="button" class="btn" id="fv16">Download 16×16</button>
              <button type="button" class="btn" id="fv180">Download 180×180</button>
            </div>
            <canvas id="fvC" hidden></canvas>
            <p class="ui-live" id="fvS" aria-live="polite">Choose an image.</p>
          </div>`,
        script: S(`
        var cv=$('fvC'), ctx=cv.getContext('2d'), src=null;
        function draw(sz){ if(!src){ setStatus('fvS','No image.'); return; }
          cv.width=sz; cv.height=sz; ctx.clearRect(0,0,sz,sz); ctx.drawImage(src,0,0,sz,sz);
          cv.toBlob(function(blob){ var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='favicon-'+sz+'.png'; a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); },800); setStatus('fvS','Downloaded '+sz+'.'); });
        }
        on($('fvF'),'change',function(ev){
          var f=ev.target.files[0]; if(!f) return;
          var u=URL.createObjectURL(f); src=new Image(); src.onload=function(){ setStatus('fvS','Ready.'); }; src.src=u;
        });
        on($('fv32'),'click',function(){ draw(32); }); on($('fv16'),'click',function(){ draw(16); }); on($('fv180'),'click',function(){ draw(180); });
        `)
      };
    },

    "image-compressor": function () {
      return {
        css: CSS_BASE,
        inner: `          <div class="local">
            <input type="file" class="local-input" id="imF" accept="image/*" />
            <div class="local-row local-row--2">
              <div><label class="muted" for="imQ" style="font-weight:800">Quality (JPEG)</label><input class="local-input" type="range" id="imQ" min="0.3" max="1" step="0.05" value="0.82" /></div>
              <div><span class="muted" style="font-weight:800">Preview</span><img id="imP" alt="" style="max-width:100%;border-radius:var(--radius-sm);border:1px solid var(--border)" /></div>
            </div>
            <div class="local-actions"><button type="button" class="btn btn--primary" id="imDl">Download JPEG</button></div>
            <p class="ui-live" id="imS" aria-live="polite">Pick an image.</p>
            <canvas id="imC" hidden></canvas>
          </div>`,
        script: S(`
        var cv=$('imC'), ctx=cv.getContext('2d'), img=null;
        on($('imF'),'change',function(ev){
          var f=ev.target.files[0]; if(!f) return;
          var u=URL.createObjectURL(f); img=new Image();
          img.onload=function(){
            var max=1400, w=img.width,h=img.height; if(w>max){ h=h*max/w; w=max; } if(h>max){ w=w*max/h; h=max; }
            cv.width=0|w; cv.height=0|h; ctx.drawImage(img,0,0,cv.width,cv.height);
            $('imP').src=cv.toDataURL('image/jpeg',0.82); setStatus('imS','Loaded.');
          };
          img.src=u;
        });
        on($('imQ'),'input',function(){ if(!img) return; var q=parseFloat($('imQ').value)||0.8; $('imP').src=cv.toDataURL('image/jpeg',q); });
        on($('imDl'),'click',function(){
          if(!cv.width){ setStatus('imS','No image.'); return; }
          var q=parseFloat($('imQ').value)||0.8;
          cv.toBlob(function(b){ var a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download='compressed.jpg'; a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); },800); setStatus('imS','Saved.'); }, 'image/jpeg', q);
        });
        `)
      };
    }
  };
};
