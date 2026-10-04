/* Settle Up: who paid what on the trip, and the fewest payments that square
 * everyone. The whole trip lives in the URL hash; nothing goes to a server.
 * Pure logic (money, splits, the settlement, the link codec) is in core.js. */
(function () {
  "use strict";

  var C = window.SettleCore;
  var A = window.SettleAudio || { unlock: noop, isOn: function () { return false; }, setOn: noop, print: noop, coin: noop, tear: noop, stamp: noop, tick: noop };
  function noop() {}

  var LOCALE = (navigator.languages && navigator.languages[0]) || navigator.language || "en-US";
  var SVGNS = "http://www.w3.org/2000/svg";
  var COLORS = ["#e0644a", "#e5a03a", "#79a93a", "#2c9c84", "#3b8bd0", "#6a6cd6", "#a259c6", "#d4568d", "#a8714a", "#5b7d8e", "#c39a1e", "#cf4141"];
  var RECENT_KEY = "settleup_recent";
  var LONG_LINK = 1800;
  var reduced = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  var finePointer = window.matchMedia ? window.matchMedia("(pointer: fine)").matches : true;

  var $ = function (id) { return document.getElementById(id); };

  // ---------- state ----------
  function blank() { return { k: "", name: "", cur: "USD", people: [], exps: [], paid: [], nextId: 0 }; }
  var state = blank();
  var calc = C.compute(state);
  var ui = {
    editPerson: null,       // person id being edited
    editExp: null,          // expense object being edited
    mode: "eq",             // "eq" | "sh"
    payer: null,
    sel: {},                // person id -> shares in the form (0 = left out)
    focus: null,            // person id highlighted on the table
    justPrinted: null,      // expense object to animate on the tape
    square: false,          // was the trip all square at the last render
    lastTotal: 0
  };
  var currentCode = "", lastHash = "", writeSeq = 0, pendingWrite = null;
  var undoSnap = null;

  function ga(name, params) {
    try { if (typeof window.gtag === "function") window.gtag("event", name, params || {}); } catch (e) {}
  }

  // ---------- small DOM helpers (user text only ever goes in via textContent) ----------
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function sv(tag, attrs, text) {
    var n = document.createElementNS(SVGNS, tag);
    for (var k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }
  function graphemes(s) {
    try {
      if (window.Intl && Intl.Segmenter) {
        var out = [], it = new Intl.Segmenter(LOCALE, { granularity: "grapheme" }).segment(s);
        for (var x of it) out.push(x.segment);
        return out;
      }
    } catch (e) {}
    return Array.from(s);
  }
  function initials(name) {
    var words = String(name).split(/[\s&+,]+/).filter(Boolean);
    if (!words.length) return "?";
    var a = graphemes(words[0])[0] || "?";
    if (words.length > 1) a += graphemes(words[words.length > 2 && /^(and|y|et|und)$/i.test(words[1]) ? 2 : 1])[0] || "";
    return a.toUpperCase();
  }
  function short(name, max) {
    var g = graphemes(name);
    return g.length > max ? g.slice(0, max - 1).join("") + "…" : name;
  }
  function person(id) {
    for (var i = 0; i < state.people.length; i++) if (state.people[i].id === id) return state.people[i];
    return null;
  }
  function color(p) { return p ? COLORS[p.color % COLORS.length] : "#888"; }
  function dot(p, cls) {
    var d = el("span", "chip__dot" + (cls ? " " + cls : ""), initials(p ? p.name : "?"));
    d.style.background = color(p);
    d.setAttribute("aria-hidden", "true");
    return d;
  }
  function money(v) { return C.money(v, state.cur, LOCALE); }
  // "Mia & Theo pay", "Sam pays"
  function pays(p) { return p && /\s(&|and|\+)\s/i.test(p.name) ? "pay" : "pays"; }
  function heads() { var h = 0; state.people.forEach(function (p) { h += p.w || 1; }); return h; }
  function tripName() { return state.name.trim() || "Our trip"; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function isEmpty() { return !state.people.length && !state.exps.length && !state.name.trim(); }
  function newKey() {
    var s = "", a = "abcdefghjkmnpqrstuvwxyz23456789";
    var r = new Uint8Array(8);
    try { crypto.getRandomValues(r); } catch (e) { for (var j = 0; j < 8; j++) r[j] = Math.floor(Math.random() * 256); }
    for (var i = 0; i < 8; i++) s += a.charAt(r[i] % a.length);
    return s;
  }

  // ---------- toast ----------
  var toastT = null, toastUndoFn = null;
  function toast(msg, undoFn) {
    var t = $("toast");
    $("toastMsg").textContent = msg;
    toastUndoFn = undoFn || null;
    $("toastUndo").hidden = !undoFn;
    t.hidden = false;
    requestAnimationFrame(function () { t.classList.add("is-on"); });
    clearTimeout(toastT);
    toastT = setTimeout(hideToast, undoFn ? 6500 : 3200);
  }
  function hideToast() {
    var t = $("toast");
    t.classList.remove("is-on");
    toastUndoFn = null;
    setTimeout(function () { if (!t.classList.contains("is-on")) t.hidden = true; }, 260);
  }
  $("toastUndo").addEventListener("click", function () {
    var fn = toastUndoFn;
    hideToast();
    if (fn) fn();
  });

  function snapshot() { return { c: C.toCompact(state), next: state.nextId }; }
  function restore(snap) {
    var st = C.fromCompact(snap.c);
    adopt(st);
    commit({ quiet: true, initial: true });
  }

  // ---------- commit: every change goes through here ----------
  function adopt(st) {
    st.nextId = st.people.length;
    state = st;
    ui.editPerson = null; ui.editExp = null; ui.focus = null; ui.justPrinted = null;
    ui.payer = null; ui.square = false;
    resetForm();
  }

  function commit(opts) {
    opts = opts || {};
    if (!state.k && !isEmpty()) state.k = newKey();
    var foldedBefore = state.paid.filter(function (p) { return p.fold; }).length;
    var ticksBefore = state.paid.length - foldedBefore;
    C.normalize(state);
    var foldedAfter = state.paid.filter(function (p) { return p.fold; }).length;
    if (ticksBefore && foldedAfter > foldedBefore && !opts.quiet) {
      toast("The trip changed, so the payments were worked out again. What's already paid still counts.");
    }
    render(opts);
    persist();
  }

  // ---------- the link ----------
  function persist() {
    var my = ++writeSeq;
    if (isEmpty()) {
      currentCode = ""; lastHash = "";
      try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
      renderLink();
      pendingWrite = null;
      return;
    }
    pendingWrite = C.pack(state).then(function (code) {
      if (my !== writeSeq) return;
      currentCode = code;
      lastHash = "t=" + code;
      try { history.replaceState(null, "", "#" + lastHash); } catch (e) {}
      saveRecent();
      renderLink();
    }).catch(function () {});
  }

  function tripUrl() {
    return location.origin + location.pathname + (currentCode ? "#t=" + currentCode : "");
  }

  function loadFromHash() {
    var h = location.hash.replace(/^#/, "");
    var m = /^t=([01][A-Za-z0-9_-]+)$/.exec(h);
    var note = $("loadNote");
    note.hidden = true;
    if (!m) {
      if (h && /^t=/.test(h)) {
        note.textContent = "That trip link didn't open. It may have been cut off when it was pasted. Ask for the link again, or paste the summary instead.";
        note.hidden = false;
      }
      render({ initial: true });
      return Promise.resolve(false);
    }
    return C.unpack(m[1]).then(function (st) {
      adopt(st);
      C.normalize(state);
      lastHash = h; currentCode = m[1];
      render({ initial: true });
      saveRecent();
      ga("settle_open_link", { people: state.people.length, expenses: state.exps.length });
      return true;
    }).catch(function (err) {
      note.textContent = err && err.message === "old browser"
        ? "This trip link needs a newer browser to open. Try it in an up-to-date browser, or ask for the summary text."
        : "That trip link didn't open. It may have been cut off when it was pasted. Ask for the link again, or paste the summary instead.";
      note.hidden = false;
      render({ initial: true });
      return false;
    });
  }
  window.addEventListener("hashchange", function () {
    var h = location.hash.replace(/^#/, "");
    if (h === lastHash) return;
    loadFromHash();
  });

  // recent trips on this device: a convenience, never the source of truth
  function readRecent() {
    try {
      var r = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      return Array.isArray(r) ? r.filter(function (x) { return x && typeof x.code === "string" && typeof x.k === "string"; }) : [];
    } catch (e) { return []; }
  }
  function saveRecent() {
    if (!currentCode || !state.k || (!state.exps.length && state.people.length < 2)) return;
    var list = readRecent().filter(function (x) { return x.k !== state.k; });
    list.unshift({ k: state.k, n: tripName(), code: currentCode, people: state.people.length, total: calc.total, cur: state.cur, t: Date.now() });
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 6))); } catch (e) {}
  }
  function dropRecent(k) {
    var list = readRecent().filter(function (x) { return x.k !== k; });
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch (e) {}
  }

  // ---------- currency ----------
  (function () {
    var sel = $("curSel");
    C.CURRENCIES.forEach(function (c) {
      var o = el("option", null, c[0] + " · " + c[1]);
      o.value = c[0];
      sel.appendChild(o);
    });
    sel.addEventListener("change", function () {
      var from = state.cur, to = sel.value;
      if (!C.isCurrency(to) || to === from) return;
      var f = Math.pow(10, C.digits(to) - C.digits(from));
      if (f !== 1) {
        state.exps.forEach(function (e) { e.amt = Math.max(1, Math.round(e.amt * f)); });
        state.paid.forEach(function (p) { p.a = Math.max(1, Math.round(p.a * f)); });
      }
      state.cur = to;
      A.tick();
      commit();
    });
  })();
  function currencySymbol() {
    try {
      var parts = new Intl.NumberFormat(LOCALE, { style: "currency", currency: state.cur }).formatToParts(0);
      for (var i = 0; i < parts.length; i++) if (parts[i].type === "currency") return parts[i].value;
    } catch (e) {}
    return state.cur;
  }

  // ---------- people ----------
  function addPeople(raw) {
    var names = String(raw).split(/[,;\n]/).map(function (s) { return s.trim(); }).filter(Boolean);
    var added = [], dup = [], full = false;
    names.forEach(function (n) {
      n = n.slice(0, 32);
      if (state.people.some(function (p) { return p.name.toLowerCase() === n.toLowerCase(); })) { dup.push(n); return; }
      if (state.people.length >= C.MAX_PEOPLE) { full = true; return; }
      var used = {};
      state.people.forEach(function (p) { used[p.color % COLORS.length] = 1; });
      var ci = 0;
      while (used[ci] && ci < COLORS.length) ci++;
      if (ci >= COLORS.length) ci = state.people.length % COLORS.length;
      var p = { id: state.nextId++, name: n, color: ci, w: 1 };
      state.people.push(p);
      added.push(p);
      if (!state.exps.length || ui.editExp == null) ui.sel[p.id] = 1;
    });
    if (added.length) {
      A.tick();
      if (ui.payer == null) ui.payer = added[0].id;
      commit();
      if (state.exps.length) toast(names.length > 1 ? "Added. New people are only in expenses you add from now on." : "Added " + added[0].name + ". They're only in expenses you add from now on.");
    }
    if (dup.length) toast(dup[0] + " is already on the trip.");
    else if (full) toast("That's the most this page can hold: " + C.MAX_PEOPLE + " people.");
    return added.length;
  }

  $("addPerson").addEventListener("submit", function (e) {
    e.preventDefault();
    var inp = $("personName");
    if (!inp.value.trim()) { inp.focus(); return; }
    if (addPeople(inp.value)) inp.value = "";
    inp.focus();
  });

  function renderPeople() {
    var box = $("people");
    box.textContent = "";
    state.people.forEach(function (p) {
      var b = el("button", "chip" + (ui.editPerson === p.id ? " is-editing" : ""));
      b.type = "button";
      b.setAttribute("role", "listitem");
      b.style.setProperty("--c", color(p));
      b.setAttribute("aria-label", p.name + (p.w > 1 ? ", counts as " + p.w : "") + ". Edit");
      b.setAttribute("aria-expanded", ui.editPerson === p.id ? "true" : "false");
      b.appendChild(dot(p));
      b.appendChild(el("span", "chip__name", p.name));
      if (p.w > 1) b.appendChild(el("span", "chip__w", "×" + p.w));
      b.addEventListener("click", function () {
        ui.editPerson = ui.editPerson === p.id ? null : p.id;
        A.tick();
        renderPeople();
        renderPersonEditor();
        if (ui.editPerson != null) $("pEditName").focus();
      });
      box.appendChild(b);
    });
    $("peopleTip").textContent = state.people.length
      ? "Tap a name to rename it, or to make one chip count as two, like a couple who pays as one."
      : "Add everyone on the trip. A couple who pays as one can be one name that counts as two.";
  }

  function usage(id) {
    var n = 0;
    state.exps.forEach(function (e) {
      if (e.by === id || e.split.some(function (s) { return s.id === id; })) n++;
    });
    var pays = state.paid.filter(function (x) { return x.f === id || x.t === id; }).length;
    return { exps: n, pays: pays };
  }

  function weightHint(w) {
    if (w === 1) return "1 person";
    if (w === 2) return "2 people, like a couple";
    return w + " people, like a family";
  }

  function renderPersonEditor() {
    var box = $("pEdit"), p = person(ui.editPerson);
    if (!p) { box.hidden = true; return; }
    box.hidden = false;
    if (document.activeElement !== $("pEditName")) $("pEditName").value = p.name;
    $("pEditW").textContent = p.w;
    $("pEditWHint").textContent = weightHint(p.w);
    $("pEditMinus").disabled = p.w <= 1;
    $("pEditPlus").disabled = p.w >= C.MAX_SHARES;
    var u = usage(p.id), note = $("pEditNote");
    var blocked = u.exps > 0 || u.pays > 0;
    $("pEditRemove").disabled = blocked;
    note.hidden = !blocked;
    if (blocked) {
      note.textContent = p.name + " is on " + (u.exps ? plural(u.exps, "expense", "expenses") : plural(u.pays, "payment", "payments")) +
        ", so they can't be removed. Take them off " + (u.exps ? "those" : "it") + " first.";
    }
  }

  $("pEditName").addEventListener("change", function () {
    var p = person(ui.editPerson);
    if (!p) return;
    var n = this.value.trim().slice(0, 32);
    if (!n) { this.value = p.name; return; }
    if (state.people.some(function (q) { return q !== p && q.name.toLowerCase() === n.toLowerCase(); })) {
      toast(n + " is already on the trip.");
      this.value = p.name;
      return;
    }
    p.name = n;
    commit();
  });
  $("pEditName").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); this.blur(); closePersonEditor(); }
  });
  function setWeight(delta) {
    var p = person(ui.editPerson);
    if (!p) return;
    var old = p.w, w = Math.max(1, Math.min(C.MAX_SHARES, old + delta));
    if (w === old) return;
    p.w = w;
    // "this chip is two people" means it, everywhere they were counted at the old size
    var touched = 0;
    state.exps.forEach(function (e) {
      e.split.forEach(function (s) { if (s.id === p.id && s.w === old) { s.w = w; touched++; } });
    });
    if (ui.sel[p.id]) ui.sel[p.id] = ui.mode === "sh" ? w : 1;
    if (w > 1 && ui.editExp == null) setMode("sh", true);
    A.tick();
    commit();
    if (touched) toast(p.name + " now counts as " + w + " in " + plural(touched, "split", "splits") + ".");
  }
  $("pEditMinus").addEventListener("click", function () { setWeight(-1); });
  $("pEditPlus").addEventListener("click", function () { setWeight(1); });
  function closePersonEditor() {
    var id = ui.editPerson;
    ui.editPerson = null;
    renderPeople(); renderPersonEditor();
    var chips = $("people").querySelectorAll(".chip");
    var idx = state.people.findIndex(function (p) { return p.id === id; });
    if (chips[idx]) chips[idx].focus();
  }
  $("pEditDone").addEventListener("click", function () {
    $("pEditName").dispatchEvent(new Event("change"));
    closePersonEditor();
  });
  $("pEditRemove").addEventListener("click", function () {
    var p = person(ui.editPerson);
    if (!p) return;
    var u = usage(p.id);
    if (u.exps || u.pays) return;
    var snap = snapshot();
    state.people = state.people.filter(function (q) { return q !== p; });
    delete ui.sel[p.id];
    if (ui.payer === p.id) ui.payer = state.people.length ? state.people[0].id : null;
    ui.editPerson = null;
    A.tear();
    commit();
    toast("Removed " + p.name + ".", function () { restore(snap); });
  });

  // ---------- the expense form ----------
  function defaultSel() {
    ui.sel = {};
    state.people.forEach(function (p) { ui.sel[p.id] = p.w || 1; });
    ui.mode = state.people.some(function (p) { return p.w > 1; }) ? "sh" : "eq";
    if (ui.mode === "eq") state.people.forEach(function (p) { ui.sel[p.id] = 1; });
  }
  function resetForm() {
    $("expWhat").value = "";
    $("expAmt").value = "";
    $("expErr").textContent = "";
    defaultSel();
  }
  function setMode(m, silent) {
    if (ui.mode === m) return;
    ui.mode = m;
    state.people.forEach(function (p) {
      if (ui.sel[p.id]) ui.sel[p.id] = m === "sh" ? (p.w || 1) : 1;
    });
    if (!silent) { A.tick(); renderForm(); }
  }
  $("modeEq").addEventListener("click", function () { setMode("eq"); });
  $("modeSh").addEventListener("click", function () { setMode("sh"); });
  $("splitAll").addEventListener("click", function () {
    state.people.forEach(function (p) { ui.sel[p.id] = ui.mode === "sh" ? (ui.sel[p.id] || p.w || 1) : 1; });
    A.tick(); renderForm();
  });
  $("splitNone").addEventListener("click", function () {
    state.people.forEach(function (p) { ui.sel[p.id] = 0; });
    A.tick(); renderForm();
  });
  $("expAmt").addEventListener("input", renderPreview);
  $("expWhat").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); $("expAmt").focus(); }
  });

  function formParts() {
    var parts = [];
    state.people.forEach(function (p) { var w = ui.sel[p.id] || 0; if (w > 0) parts.push({ id: p.id, w: w }); });
    return parts;
  }
  function formAmount() { return C.parseAmount($("expAmt").value, C.digits(state.cur)); }

  function renderForm() {
    var editing = !!ui.editExp;
    $("expForm").closest(".card").classList.toggle("is-editing", editing);
    $("expForm").classList.toggle("is-empty", !state.people.length);
    $("formTitle").lastChild.textContent = editing ? " Edit this one" : " What got paid?";
    $("expSubmit").textContent = editing ? "Save changes" : "Print it on the tape";
    $("expCancel").hidden = !editing;
    $("expDelete").hidden = !editing;
    $("amtSym").textContent = currencySymbol();
    $("expAmt").placeholder = C.digits(state.cur) ? "0.00" : "0";

    if (ui.payer != null && !person(ui.payer)) ui.payer = null;
    if (ui.payer == null && state.people.length) ui.payer = state.people[0].id;

    // paid by: a radio group of chips (arrow keys move the choice)
    var pb = $("paidBy");
    pb.textContent = "";
    state.people.forEach(function (p, i) {
      var on = ui.payer === p.id;
      var b = el("button", "opt");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
      b.style.setProperty("--c", color(p));
      b.appendChild(dot(p));
      b.appendChild(el("span", "opt__name", p.name));
      b.addEventListener("click", function () { ui.payer = p.id; A.tick(); renderForm(); pb.children[i].focus(); });
      b.addEventListener("keydown", function (e) {
        var d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        var j = (i + d + state.people.length) % state.people.length;
        ui.payer = state.people[j].id; A.tick(); renderForm(); pb.children[j].focus();
      });
      pb.appendChild(b);
    });

    $("modeEq").setAttribute("aria-pressed", ui.mode === "eq" ? "true" : "false");
    $("modeSh").setAttribute("aria-pressed", ui.mode === "sh" ? "true" : "false");

    var sp = $("splitPick"), sl = $("sharesList");
    sp.hidden = ui.mode !== "eq";
    sl.hidden = ui.mode !== "sh";
    sp.textContent = "";
    sl.textContent = "";
    state.people.forEach(function (p) {
      var w = ui.sel[p.id] || 0;
      if (ui.mode === "eq") {
        var b = el("button", "opt");
        b.type = "button";
        b.setAttribute("aria-pressed", w > 0 ? "true" : "false");
        b.style.setProperty("--c", color(p));
        b.appendChild(dot(p));
        b.appendChild(el("span", "opt__name", p.name));
        b.addEventListener("click", function () {
          ui.sel[p.id] = ui.sel[p.id] ? 0 : 1;
          A.tick();
          b.setAttribute("aria-pressed", ui.sel[p.id] ? "true" : "false");
          renderPreview();
        });
        sp.appendChild(b);
      } else {
        var row = el("div", "share" + (w > 0 ? " is-in" : ""));
        row.style.setProperty("--c", color(p));
        row.appendChild(dot(p));
        row.appendChild(el("span", "share__name", p.name));
        var amt = el("span", "share__amt", "");
        amt.dataset.id = p.id;
        row.appendChild(amt);
        var st = el("div", "stepper");
        st.setAttribute("role", "group");
        st.setAttribute("aria-label", p.name + " shares");
        var minus = el("button", "stepper__b", "−");
        minus.type = "button"; minus.disabled = w <= 0;
        minus.setAttribute("aria-label", "One share less for " + p.name);
        var out = el("output", null, String(w));
        out.setAttribute("aria-live", "polite");
        var plus = el("button", "stepper__b", "+");
        plus.type = "button"; plus.disabled = w >= C.MAX_SHARES;
        plus.setAttribute("aria-label", "One share more for " + p.name);
        minus.addEventListener("click", function () { ui.sel[p.id] = Math.max(0, (ui.sel[p.id] || 0) - 1); A.tick(); renderForm(); focusShare(p.id, "minus"); });
        plus.addEventListener("click", function () { ui.sel[p.id] = Math.min(C.MAX_SHARES, (ui.sel[p.id] || 0) + 1); A.tick(); renderForm(); focusShare(p.id, "plus"); });
        st.appendChild(minus); st.appendChild(out); st.appendChild(plus);
        row.appendChild(st);
        row.dataset.id = p.id;
        sl.appendChild(row);
      }
    });
    $("expSubmit").disabled = !state.people.length;
    renderPreview();
  }
  function focusShare(id, which) {
    var row = $("sharesList").querySelector('.share[data-id="' + id + '"]');
    if (!row) return;
    var b = row.querySelectorAll(".stepper__b")[which === "minus" ? 0 : 1];
    if (b && !b.disabled) b.focus();
    else if (row.querySelectorAll(".stepper__b")[which === "minus" ? 1 : 0]) row.querySelectorAll(".stepper__b")[which === "minus" ? 1 : 0].focus();
  }

  function renderPreview() {
    var pv = $("preview"), parts = formParts(), amt = formAmount();
    var amtEls = $("sharesList").querySelectorAll(".share__amt");
    var cuts = null;
    if (parts.length && amt > 0) cuts = C.splitAmount(amt, parts, C.expenseSeed({ what: $("expWhat").value.trim(), amt: amt, by: ui.payer }));
    for (var i = 0; i < amtEls.length; i++) {
      var id = Number(amtEls[i].dataset.id), txt = "";
      if (cuts) for (var j = 0; j < parts.length; j++) if (parts[j].id === id) txt = money(cuts[j]);
      amtEls[i].textContent = txt;
    }
    if (!state.people.length) { pv.textContent = ""; return; }
    if (!parts.length) { pv.textContent = "Pick at least one person to split it with."; return; }
    var W = 0; parts.forEach(function (p) { W += p.w; });
    if (!(amt > 0)) {
      pv.textContent = ui.mode === "eq" ? "Split " + parts.length + (parts.length === 1 ? " way." : " ways.") : plural(W, "share", "shares") + " in all.";
      return;
    }
    if (ui.mode === "eq") {
      var lo = Math.floor(amt / parts.length), hi = lo + (amt % parts.length ? 1 : 0);
      pv.textContent = (parts.length === 1 ? "All of it, " + money(amt) + ", on one person." :
        (lo === hi ? money(lo) : money(lo) + " or " + money(hi)) + " each, " + parts.length + " ways.");
    } else {
      pv.textContent = plural(W, "share", "shares") + ", about " + money(Math.round(amt / W)) + " a share.";
    }
  }

  $("expForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var err = $("expErr");
    if (!state.people.length) { err.textContent = "Add who came first, up in step 1."; $("personName").focus(); return; }
    var amt = formAmount();
    if (!(amt > 0)) { err.textContent = "How much was it? Type an amount, like 42.50."; $("expAmt").focus(); return; }
    var parts = formParts();
    if (!parts.length) { err.textContent = "Pick at least one person to split it with."; return; }
    if (ui.payer == null || !person(ui.payer)) { err.textContent = "Who paid for it?"; return; }
    if (!ui.editExp && state.exps.length >= C.MAX_EXPENSES) { err.textContent = "That's the most one trip can hold here."; return; }
    err.textContent = "";
    var what = $("expWhat").value.trim().slice(0, 60);
    if (!what) what = "Expense " + (ui.editExp ? state.exps.indexOf(ui.editExp) + 1 : state.exps.length + 1);
    var first = !state.exps.length;
    var target;
    if (ui.editExp) {
      target = ui.editExp;
      target.what = what; target.amt = amt; target.by = ui.payer; target.split = parts;
      ui.editExp = null;
      toast("Saved " + what + ".");
    } else {
      target = { what: what, amt: amt, by: ui.payer, split: parts };
      state.exps.push(target);
      toast("Printed " + what + ", " + money(amt) + ".", function () {
        var i = state.exps.indexOf(target);
        if (i !== -1) { state.exps.splice(i, 1); A.tear(); commit({ quiet: true }); }
      });
      if (first) ga("settle_first_expense", { people: state.people.length });
    }
    ui.justPrinted = [target];
    A.print(target.what.length > 18 ? 3 : 2);
    flashLed();
    resetForm();
    commit();
    if (finePointer) $("expWhat").focus();
    else document.activeElement && document.activeElement.blur && document.activeElement.blur();
  });

  $("expCancel").addEventListener("click", function () {
    ui.editExp = null;
    resetForm();
    render();
  });
  $("expDelete").addEventListener("click", function () {
    var e = ui.editExp;
    if (!e) return;
    var snap = snapshot();
    var line = $("lines").querySelector('.line[data-i="' + state.exps.indexOf(e) + '"]');
    ui.editExp = null;
    A.tear();
    var go = function () {
      state.exps = state.exps.filter(function (x) { return x !== e; });
      resetForm();
      commit();
      toast("Deleted " + e.what + ".", function () { restore(snap); });
    };
    if (line && !reduced.matches) { line.classList.add("is-going"); setTimeout(go, 320); }
    else go();
  });

  function startEdit(e) {
    ui.editExp = e;
    ui.payer = e.by;
    ui.sel = {};
    state.people.forEach(function (p) { ui.sel[p.id] = 0; });
    e.split.forEach(function (s) { ui.sel[s.id] = s.w; });
    ui.mode = e.split.every(function (s) { return s.w === 1; }) ? "eq" : "sh";
    $("expWhat").value = e.what;
    var d = C.digits(state.cur);
    $("expAmt").value = (e.amt / Math.pow(10, d)).toFixed(d);
    $("expErr").textContent = "";
    A.tick();
    render();
    var card = $("expForm").closest(".card");
    var r = card.getBoundingClientRect();
    if (r.top < 0 || r.top > window.innerHeight * 0.5) card.scrollIntoView({ behavior: reduced.matches ? "auto" : "smooth", block: "start" });
    setTimeout(function () { $("expAmt").focus({ preventScroll: true }); }, reduced.matches ? 0 : 350);
  }

  // ---------- the receipt tape ----------
  function flashLed() {
    var l = $("printLed");
    l.classList.add("is-on");
    setTimeout(function () { l.classList.remove("is-on"); }, 650);
  }

  function renderTape() {
    var t = $("tripName");
    if (document.activeElement !== t) t.value = state.name;
    var today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toUpperCase();
    $("tapeMeta").textContent = plural(heads(), "PERSON", "PEOPLE") + " · " + state.cur + " · " + today;
    var ol = $("lines");
    ol.textContent = "";
    state.exps.forEach(function (e, i) {
      var payer = person(e.by);
      var pi = ui.justPrinted ? ui.justPrinted.indexOf(e) : -1;
      var fresh = pi !== -1 && !reduced.matches;
      var li = el("li", "line" + (fresh ? " is-new is-grow" : "") + (e === ui.editExp ? " is-editing" : ""));
      if (pi > 0) { li.style.animationDelay = (pi * 110) + "ms"; li.style.transitionDelay = (pi * 110) + "ms"; }
      li.dataset.i = i;
      var b = el("button", "line__btn");
      b.type = "button";
      var n = 0, W = 0;
      e.split.forEach(function (s) { n++; W += s.w; });
      var everyone = n === state.people.length;
      var splitTxt = everyone ? (W === n ? "SPLIT " + n + " WAYS" : W + " SHARES") : (n === 1 ? "ALL ON " + short(person(e.split[0].id).name, 12).toUpperCase() : (W === n ? n + " OF " + state.people.length : W + " SHARES, " + n + " OF " + state.people.length));
      b.setAttribute("aria-label", e.what + ", " + money(e.amt) + ", paid by " + (payer ? payer.name : "someone") + ". Edit");
      b.appendChild(el("span", "line__what", e.what));
      b.appendChild(el("span", "line__amt", money(e.amt)));
      var sub = el("span", "line__sub");
      var d = el("span", "line__dot");
      d.style.setProperty("--c", color(payer));
      sub.appendChild(d);
      sub.appendChild(el("span", null, (payer ? short(payer.name, 14).toUpperCase() : "?") + " PAID · " + splitTxt));
      b.appendChild(sub);
      b.addEventListener("click", function () {
        if (ui.editExp === e) { ui.editExp = null; resetForm(); A.tick(); render(); return; }
        startEdit(e);
      });
      var wrap = el("div");
      wrap.appendChild(b);
      li.appendChild(wrap);
      ol.appendChild(li);
    });
    if (ui.justPrinted) {
      // the paper feeds out: open each new line's row after it is in the layout
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          var g = ol.querySelectorAll(".line.is-grow");
          for (var q = 0; q < g.length; q++) g[q].classList.remove("is-grow");
        });
      });
    }
    ui.justPrinted = null;
    $("tapeEmpty").hidden = state.exps.length > 0;
    $("tapeSum").hidden = !state.exps.length;
    var tot = $("tapeTotal");
    tot.textContent = money(calc.total);
    if (calc.total !== ui.lastTotal && !reduced.matches) {
      tot.classList.remove("is-bump"); void tot.offsetWidth; tot.classList.add("is-bump");
    }
    ui.lastTotal = calc.total;
    $("tapeItems").textContent = String(state.exps.length);
    $("tapeAvg").textContent = money(heads() ? Math.round(calc.total / heads()) : 0);
    renderBarcode();
  }
  $("tripName").addEventListener("input", function () {
    state.name = this.value.slice(0, 40);
    if (!state.k && !isEmpty()) state.k = newKey();
    clearTimeout(this._t);
    this._t = setTimeout(function () { persist(); renderLink(); renderHeroButtons(); }, 250);
  });
  $("tripName").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); this.blur(); } });

  function renderBarcode() {
    var svg = $("barcode");
    svg.textContent = "";
    var h = C.hash((state.k || "settle") + "|" + calc.total + "|" + state.exps.length);
    var x = 0, i = 0;
    while (x < 200) {
      h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
      var w = 1 + (h % 3), gap = 1 + ((h >>> 3) % 3);
      if (x + w > 200) break;
      if (i % 2 === 0 || (h >>> 7) % 4) svg.appendChild(sv("rect", { x: x, y: 0, width: w, height: 34 }));
      x += w + gap; i++;
    }
  }

  // ---------- the table ----------
  var T = { arrows: [], layout: {}, flying: [], raf: 0, visible: true, prevKeys: {} };

  function tableSize() {
    var svg = $("tableSvg");
    var r = svg.getBoundingClientRect();
    return { W: Math.max(200, Math.round(r.width)), H: Math.max(200, Math.round(r.height)) };
  }

  function qpt(a, t) {
    var u = 1 - t;
    return { x: u * u * a.p0.x + 2 * u * t * a.cp.x + t * t * a.p2.x, y: u * u * a.p0.y + 2 * u * t * a.cp.y + t * t * a.p2.y };
  }

  function renderTable() {
    var svg = $("tableSvg");
    var sz = tableSize(), W = sz.W, H = sz.H;
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.textContent = "";
    T.arrows = []; T.layout = {};

    var defs = sv("defs", {});
    var cg = sv("radialGradient", { id: "suCoin", cx: "38%", cy: "34%", r: "70%" });
    cg.appendChild(sv("stop", { offset: "0", "stop-color": "#fff6cf" }));
    cg.appendChild(sv("stop", { offset: "0.45", "stop-color": "#e8bd55" }));
    cg.appendChild(sv("stop", { offset: "1", "stop-color": "#9a6a18" }));
    defs.appendChild(cg);
    var hg = sv("radialGradient", { id: "suGloss", cx: "35%", cy: "28%", r: "75%" });
    hg.appendChild(sv("stop", { offset: "0", "stop-color": "#fff", "stop-opacity": "0.45" }));
    hg.appendChild(sv("stop", { offset: "0.5", "stop-color": "#fff", "stop-opacity": "0.06" }));
    hg.appendChild(sv("stop", { offset: "1", "stop-color": "#000", "stop-opacity": "0.25" }));
    defs.appendChild(hg);
    svg.appendChild(defs);

    var P = state.people, N = P.length;
    var small = W < 420;
    if (!N) {
      svg.appendChild(sv("text", { class: "t-empty", x: W / 2, y: H / 2, "text-anchor": "middle", "font-size": small ? 16 : 19 }, "Pull up a chair."));
      svg.appendChild(sv("text", { class: "t-empty", x: W / 2, y: H / 2 + 24, "text-anchor": "middle", "font-size": 13, opacity: 0.7 }, "Add who came, and they sit here."));
      svg.setAttribute("aria-label", "An empty table. Add who came on the trip.");
      return;
    }

    var tiny = W < 300;
    var r = Math.max(13, Math.min(small ? 21 : 25, W / 15, (Math.PI * (W + H) / 2) / (N * 3.6)));
    var nameSize = r < 18 ? 11 : 12.5, netSize = r < 18 ? 10 : 11;
    var showNet = N <= 14;
    var lab = showNet && state.exps.length ? 36 : 24;
    var mx = Math.max(r + 12, small ? 40 : 52), mTop = r + (N > 2 ? lab : 14), mBot = r + lab;
    var cx = W / 2, rx = W / 2 - mx, ry = (H - mTop - mBot) / 2, ecy = mTop + ry;
    var a0 = N === 2 ? Math.PI : -Math.PI / 2;
    var left = calc.left;

    P.forEach(function (p, i) {
      var ang = a0 + i * 2 * Math.PI / N;
      var x = N === 1 ? cx : cx + rx * Math.cos(ang), y = N === 1 ? ecy : ecy + ry * Math.sin(ang);
      T.layout[p.id] = { x: x, y: y, r: r, up: N > 2 && Math.sin(ang) < -0.55 };
    });

    // arrows first so the tokens sit on top
    var maxA = 1;
    calc.plan.forEach(function (t) { maxA = Math.max(maxA, t.a); });
    var gA = sv("g", { class: "t-arrows" }), gT = sv("g", { class: "t-tags" }), gC = sv("g", { class: "t-coins" }), gP = sv("g", { class: "t-people" });
    var boxes = [];
    P.forEach(function (p) {
      var L = T.layout[p.id], lw = Math.max(2 * r, 76), lh = lab - 6;
      boxes.push({ x: L.x - r, y: L.y - r, w: 2 * r, h: 2 * r, k: 3 });
      boxes.push({ x: L.x - lw / 2, y: L.up ? L.y - r - lh : L.y + r, w: lw, h: lh, k: 1.5 });
    });
    var keysNow = {};
    calc.plan.forEach(function (t, k) {
      var A0 = T.layout[t.f], B0 = T.layout[t.t];
      if (!A0 || !B0) return;
      var dx = B0.x - A0.x, dy = B0.y - A0.y, dist = Math.hypot(dx, dy) || 1;
      var ux = dx / dist, uy = dy / dist;
      var mxp = (A0.x + B0.x) / 2, myp = (A0.y + B0.y) / 2;
      var nx = -uy, ny = ux;
      var toC = (cx - mxp) * nx + (ecy - myp) * ny;
      var sgn = Math.abs(toC) < 8 ? 1 : Math.sign(toC);
      var bend = Math.min(70, dist * 0.2);
      var cp = { x: mxp + nx * bend * sgn, y: myp + ny * bend * sgn };
      var s0 = { x: A0.x - cp.x, y: A0.y - cp.y }, s0l = Math.hypot(s0.x, s0.y) || 1;
      var p0 = { x: A0.x - s0.x / s0l * (r + 4), y: A0.y - s0.y / s0l * (r + 4) };
      var e0 = { x: B0.x - cp.x, y: B0.y - cp.y }, e0l = Math.hypot(e0.x, e0.y) || 1;
      var tip = { x: B0.x - e0.x / e0l * (r + 3), y: B0.y - e0.y / e0l * (r + 3) };
      var hl = 11, hw = 5.5;
      var ex = e0.x / e0l, ey = e0.y / e0l;
      var p2 = { x: tip.x - ex * (hl - 2), y: tip.y - ey * (hl - 2) };
      var sw = 2 + 3 * Math.sqrt(t.a / maxA);
      var key = t.f + ">" + t.t + ":" + t.a;
      keysNow[key] = 1;
      var isNew = !T.prevKeys[key] && !t.done && !reduced.matches;
      var g = sv("g", { class: "t-arrow" + (t.done ? " is-done" : "") + (isNew ? " is-new" : "") });
      g.dataset.f = t.f; g.dataset.t = t.t;
      var d = "M" + p0.x.toFixed(1) + " " + p0.y.toFixed(1) + " Q" + cp.x.toFixed(1) + " " + cp.y.toFixed(1) + " " + p2.x.toFixed(1) + " " + p2.y.toFixed(1);
      var path = sv("path", { class: "t-path", d: d, "stroke-width": sw.toFixed(2) });
      g.appendChild(path);
      g.appendChild(sv("path", {
        class: "t-head",
        d: "M" + tip.x.toFixed(1) + " " + tip.y.toFixed(1) +
           " L" + (tip.x - ex * hl - ey * hw).toFixed(1) + " " + (tip.y - ey * hl + ex * hw).toFixed(1) +
           " L" + (tip.x - ex * hl + ey * hw).toFixed(1) + " " + (tip.y - ey * hl - ex * hw).toFixed(1) + " Z"
      }));
      gA.appendChild(g);
      var len = 0;
      try { len = path.getTotalLength(); } catch (e2) { len = dist; }
      if (isNew) g.style.setProperty("--len", len.toFixed(0));
      var arrow = { f: t.f, t: t.t, a: t.a, done: t.done, p0: p0, cp: cp, p2: p2, len: len, g: g, k: k, coins: [] };

      // the amount tag, placed where it collides least
      var label = (t.done ? "✓ " : "") + money(t.a);
      var tagFont = tiny ? 10.5 : 11.5;
      var tw = label.length * (tiny ? 6.5 : 7.1) + (tiny ? 12 : 16), th = tiny ? 20 : 22;
      var best = null, bestScore = Infinity;
      [0.5, 0.44, 0.56, 0.38, 0.62, 0.32, 0.68, 0.26, 0.74, 0.2, 0.8, 0.15, 0.85].forEach(function (tt) {
        var pt = qpt(arrow, tt);
        var bx = { x: pt.x - tw / 2, y: pt.y - th / 2, w: tw, h: th };
        var sc = 0;
        boxes.forEach(function (o) {
          var ox = Math.max(0, Math.min(bx.x + bx.w, o.x + o.w) - Math.max(bx.x, o.x));
          var oy = Math.max(0, Math.min(bx.y + bx.h, o.y + o.h) - Math.max(bx.y, o.y));
          sc += ox * oy * (o.k || 2);
        });
        // keep clear of the table's rail too
        if (bx.x < 4 || bx.x + bx.w > W - 4 || bx.y < 4 || bx.y + bx.h > H - 4) sc += 400;
        sc += Math.abs(tt - 0.5) * 40;
        if (sc < bestScore) { bestScore = sc; best = { pt: pt, bx: bx }; }
      });
      best.bx.k = 2;
      boxes.push(best.bx);
      var tag = sv("g", { class: "t-tag", transform: "translate(" + best.pt.x.toFixed(1) + " " + best.pt.y.toFixed(1) + ")", tabindex: "0", role: "button" });
      var fp = person(t.f), tp = person(t.t);
      tag.setAttribute("aria-label", (fp ? fp.name : "") + " " + pays(fp) + " " + (tp ? tp.name : "") + " " + money(t.a) + (t.done ? ", paid. Mark as not paid" : ". Mark as paid"));
      tag.appendChild(sv("rect", { class: "t-hit", x: (-Math.max(tw, 44) / 2).toFixed(1), y: -22, width: Math.max(tw, 44).toFixed(1), height: 44 }));
      tag.appendChild(sv("rect", { x: (-tw / 2).toFixed(1), y: -th / 2, width: tw.toFixed(1), height: th, rx: 5 }));
      tag.appendChild(sv("text", { x: 0, y: 0, dy: "0.35em", "text-anchor": "middle", "font-size": tagFont }, label));
      tag.addEventListener("click", function (ev) { ev.stopPropagation(); togglePaid(k); });
      tag.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); togglePaid(k); } });
      gT.appendChild(tag);

      if (!t.done) {
        for (var c = 0; c < 2; c++) {
          var coin = makeCoin();
          gC.appendChild(coin);
          arrow.coins.push({ el: coin, phase: c * 0.5 + (k * 0.17) % 1 });
        }
      }
      T.arrows.push(arrow);
    });
    T.prevKeys = keysNow;
    svg.appendChild(gA);
    svg.appendChild(gC);
    svg.appendChild(gT);

    // tokens: poker chips with the person's initials
    P.forEach(function (p) {
      var L = T.layout[p.id], v = left[p.id] || 0;
      var g = sv("g", { class: "t-token", transform: "translate(" + L.x.toFixed(1) + " " + L.y.toFixed(1) + ")", tabindex: "0", role: "button" });
      g.dataset.id = p.id;
      var status = v > 0 ? "is owed " + money(v) : v < 0 ? "owes " + money(-v) : "is even";
      g.setAttribute("aria-label", p.name + " " + status + ". Show their payments");
      g.setAttribute("aria-pressed", ui.focus === p.id ? "true" : "false");
      g.appendChild(sv("circle", { r: r + 1.5, cy: 3, fill: "rgba(0,0,0,0.35)" }));
      var chip = sv("g", { class: "t-chip" });
      chip.appendChild(sv("circle", { class: "t-ring", r: r, fill: color(p) }));
      var circ = 2 * Math.PI * (r - 2.6), seg = circ / 16;
      chip.appendChild(sv("circle", { r: r - 2.6, fill: "none", stroke: "#fff", "stroke-width": 4, "stroke-dasharray": seg.toFixed(2) + " " + seg.toFixed(2), opacity: 0.6 }));
      chip.appendChild(sv("circle", { r: r * 0.64, fill: color(p), stroke: "rgba(255,255,255,0.6)", "stroke-width": 1.4, "stroke-dasharray": "2 2.2" }));
      chip.appendChild(sv("circle", { r: r, fill: "url(#suGloss)" }));
      chip.appendChild(sv("text", { class: "t-init", y: 0, dy: "0.36em", "text-anchor": "middle", "font-size": (r * 0.62).toFixed(1) }, initials(p.name)));
      g.appendChild(chip);
      var withNet = showNet && state.exps.length;
      var L2 = T.layout[p.id];
      var yName = L2.up ? -r - (withNet ? 22 : 8) : r + 15, yNet = L2.up ? -r - 8 : r + 29;
      g.appendChild(sv("text", { class: "t-name", y: yName, "text-anchor": "middle", "font-size": nameSize }, short(p.name, small ? 9 : 12) + (p.w > 1 ? " ×" + p.w : "")));
      if (withNet) {
        g.appendChild(sv("text", {
          class: "t-net " + (v > 0 ? "t-net--up" : v < 0 ? "t-net--down" : "t-net--even"),
          y: yNet, "text-anchor": "middle", "font-size": netSize
        }, v > 0 ? "+" + money(v) : v < 0 ? money(v) : "even"));
      }
      g.addEventListener("click", function () { setFocus(p.id); });
      g.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); setFocus(p.id); } });
      gP.appendChild(g);
    });
    svg.appendChild(gP);

    if (!state.exps.length) {
      svg.appendChild(sv("text", { class: "t-empty", x: W / 2, y: ecy + 5, "text-anchor": "middle", "font-size": small ? 14 : 16 }, N < 2 ? "Who else came?" : "Nothing owed yet."));
    }
    svg.setAttribute("aria-label", tableLabel());
    applyFocus();
    kick();
  }

  function tableLabel() {
    if (!state.exps.length) return "The table, with " + plural(state.people.length, "person", "people") + " sitting around it. Nothing owed yet.";
    if (!calc.plan.length) return "The table. Everyone is even.";
    return "The table. " + calc.plan.map(function (t) {
      var f = person(t.f), to = person(t.t);
      return (f ? f.name : "") + " " + pays(f) + " " + (to ? to.name : "") + " " + money(t.a) + (t.done ? ", paid" : "");
    }).join(". ") + ".";
  }

  function makeCoin() {
    var g = sv("g", { class: "t-coin", opacity: 0 });
    g.appendChild(sv("circle", { r: 7.5, cy: 2, fill: "rgba(0,0,0,0.3)" }));
    g.appendChild(sv("circle", { r: 7, fill: "url(#suCoin)", stroke: "#8a5c12", "stroke-width": 1 }));
    g.appendChild(sv("circle", { r: 4.4, fill: "none", stroke: "rgba(122, 82, 14, 0.55)", "stroke-width": 1 }));
    return g;
  }

  function setFocus(id) {
    ui.focus = ui.focus === id ? null : id;
    A.tick();
    applyFocus();
    var toks = $("tableSvg").querySelectorAll(".t-token");
    for (var i = 0; i < toks.length; i++) toks[i].setAttribute("aria-pressed", String(Number(toks[i].dataset.id) === ui.focus));
  }
  function applyFocus() {
    var f = ui.focus;
    if (f != null && !person(f)) f = ui.focus = null;
    var svg = $("tableSvg");
    var toks = svg.querySelectorAll(".t-token"), arrs = svg.querySelectorAll(".t-arrow");
    var linked = {};
    if (f != null) {
      linked[f] = 1;
      calc.plan.forEach(function (t) { if (t.f === f || t.t === f) { linked[t.f] = 1; linked[t.t] = 1; } });
    }
    for (var i = 0; i < toks.length; i++) toks[i].classList.toggle("is-dim", f != null && !linked[Number(toks[i].dataset.id)]);
    for (var j = 0; j < arrs.length; j++) {
      var a = arrs[j];
      a.classList.toggle("is-dim", f != null && Number(a.dataset.f) !== f && Number(a.dataset.t) !== f);
    }
    var rows = $("pays").children;
    for (var k = 0; k < rows.length; k++) {
      var on = f != null && (Number(rows[k].dataset.f) === f || Number(rows[k].dataset.t) === f);
      rows[k].classList.toggle("is-hot", on);
    }
  }

  // coins travel along every unpaid arrow, and fly in a burst when one is paid
  function kick() {
    if (T.raf) return;
    if (reduced.matches) { hideCoins(); return; }
    T.raf = requestAnimationFrame(frame);
  }
  function hideCoins() {
    T.arrows.forEach(function (a) { a.coins.forEach(function (c) { c.el.setAttribute("opacity", 0); }); });
  }
  function frame(now) {
    T.raf = 0;
    if (document.hidden || !T.visible) return;
    var busy = false;
    T.arrows.forEach(function (a) {
      if (a.done || !a.coins.length) return;
      busy = true;
      var period = 1700 + a.len * 4.5;
      a.coins.forEach(function (c) {
        var t = ((now / period) + c.phase) % 1;
        var e = t * t * (3 - 2 * t);
        var pt = qpt(a, e);
        var lift = Math.sin(Math.PI * e);
        var s = 0.82 + 0.3 * lift;
        c.el.setAttribute("transform", "translate(" + pt.x.toFixed(1) + " " + (pt.y - lift * 6).toFixed(1) + ") scale(" + s.toFixed(3) + ")");
        c.el.setAttribute("opacity", Math.min(1, Math.sin(Math.PI * t) * 1.6).toFixed(2));
      });
    });
    T.flying = T.flying.filter(function (fc) {
      var t = (now - fc.start) / fc.dur;
      if (t < 0) { fc.el.setAttribute("opacity", 0); busy = true; return true; }
      if (t >= 1) {
        fc.el.remove();
        if (fc.onLand) fc.onLand();
        return false;
      }
      busy = true;
      var e = 1 - Math.pow(1 - t, 2.2);
      var pt = qpt(fc.a, e);
      var lift = Math.sin(Math.PI * e);
      fc.el.setAttribute("transform", "translate(" + pt.x.toFixed(1) + " " + (pt.y - lift * 14).toFixed(1) + ") scale(" + (1 + 0.35 * lift).toFixed(3) + ")");
      fc.el.setAttribute("opacity", 1);
      return true;
    });
    if (busy) T.raf = requestAnimationFrame(frame);
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) kick(); });
  if (window.IntersectionObserver) {
    new IntersectionObserver(function (ents) {
      T.visible = ents[0].isIntersecting;
      if (T.visible) kick();
    }).observe($("tableWrap"));
  }
  if (reduced.addEventListener) reduced.addEventListener("change", function () { renderTable(); });

  function popToken(id) {
    var g = $("tableSvg").querySelector('.t-token[data-id="' + id + '"]');
    if (!g) return;
    g.classList.remove("is-pop"); void g.getBBox(); g.classList.add("is-pop");
    setTimeout(function () { g.classList.remove("is-pop"); }, 600);
  }
  function panFor(id) {
    var L = T.layout[id];
    if (!L) return 0;
    var w = tableSize().W;
    return Math.max(-0.8, Math.min(0.8, (L.x / w) * 2 - 1));
  }

  // ---------- paying ----------
  function togglePaid(k) {
    var t = calc.plan[k];
    if (!t) return;
    var arrow = T.arrows.filter(function (a) { return a.k === k; })[0];
    if (t.done) {
      for (var i = 0; i < state.paid.length; i++) {
        var p = state.paid[i];
        if (!p.fold && p.f === t.f && p.t === t.t && p.a === t.a) { state.paid.splice(i, 1); break; }
      }
      A.tick();
      commit();
      return;
    }
    state.paid.push({ f: t.f, t: t.t, a: t.a, fold: false });
    var land = reduced.matches || !arrow ? 0 : 640;
    A.coin(panFor(t.t), 3, land / 1000);
    var geo = arrow ? { p0: arrow.p0, cp: arrow.cp, p2: arrow.p2 } : null;
    commit({ paidK: k });
    if (geo && !reduced.matches) {
      var gC = $("tableSvg").querySelector(".t-coins");
      var now = performance.now();
      for (var c = 0; c < 3; c++) {
        var coin = makeCoin();
        (gC || $("tableSvg")).appendChild(coin);
        T.flying.push({ el: coin, a: geo, start: now + c * 110, dur: 520, onLand: c === 2 ? function () { popToken(t.t); } : null });
      }
      kick();
    } else {
      popToken(t.t);
    }
  }

  // ---------- verdict, payments, balances ----------
  function renderSettle(opts) {
    var v = $("verdict"), sub = $("verdictSub");
    var n = calc.plan.length, done = calc.done, h = heads();
    var html = "", subTxt = "";
    var squareNow = false;
    if (!state.people.length) {
      html = "Add who came to get started.";
    } else if (state.people.length < 2) {
      html = "Just " + state.people[0].name + " so far.";
      subTxt = "Add the rest of the group, then what everyone paid.";
    } else if (!state.exps.length) {
      html = "Nothing owed yet.";
      subTxt = "Add what got paid, and the payments show up here.";
    } else if (!n) {
      html = "<em>All square.</em>";
      squareNow = true;
      subTxt = calc.folded.length ? "Every payment is in. Nobody owes anybody." : "Everyone paid their share already. Nobody owes anybody.";
    } else if (done === n) {
      html = "<em>All square.</em>";
      squareNow = true;
      subTxt = plural(n, "payment", "payments") + " made. Everyone's even.";
    } else if (done) {
      html = "<em>" + done + " of " + n + "</em> payments made.";
      subTxt = plural(n - done, "payment", "payments") + " to go.";
    } else {
      var more = calc.folded.length ? " more" : "";
      html = "<em>" + plural(n, "payment" + more, "payments" + more) + "</em> " + (n === 1 ? "settles " : "settle ") + plural(h, "person", "people") + ".";
      if (!calc.exact) subTxt = "With this many people it's a close shortcut, though maybe not the very fewest.";
      else if (calc.naive > n && !calc.folded.length) subTxt = "Paying everyone back one by one would take " + calc.naive + ".";
      else subTxt = "That's as few as it gets.";
    }
    if (v.innerHTML !== html) {
      v.innerHTML = html;
      if (!opts.initial && !reduced.matches) { v.classList.remove("is-swap"); void v.offsetWidth; v.classList.add("is-swap"); }
    }
    sub.textContent = subTxt;

    // payments list
    var ol = $("pays");
    ol.textContent = "";
    calc.plan.forEach(function (t, k) {
      var f = person(t.f), to = person(t.t);
      var li = el("li", "pay" + (t.done ? " is-done" : ""));
      li.dataset.f = t.f; li.dataset.t = t.t;
      var who = el("span", "pay__who");
      var a = el("span", "pay__p"); a.appendChild(dot(f)); a.appendChild(el("span", null, f ? f.name : "?"));
      var b = el("span", "pay__p"); b.appendChild(dot(to)); b.appendChild(el("span", null, to ? to.name : "?"));
      who.appendChild(a); who.appendChild(el("span", "pay__verb", pays(f))); who.appendChild(b);
      who.appendChild(el("span", "pay__amt", money(t.a)));
      li.appendChild(who);
      var btn = el("button", "paid");
      btn.type = "button";
      btn.setAttribute("aria-pressed", t.done ? "true" : "false");
      btn.setAttribute("aria-label", (f ? f.name : "") + " " + pays(f) + " " + (to ? to.name : "") + " " + money(t.a) + ". Paid");
      btn.title = t.done ? "Paid" : "Mark paid";
      var box = el("span", "paid__box");
      box.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
      btn.appendChild(box);
      btn.appendChild(el("span", "paid__txt", t.done ? "Paid" : "Mark paid"));
      btn.addEventListener("click", function () {
        togglePaid(k);
        var again = $("pays").children[k];
        if (again) again.querySelector(".paid").focus({ preventScroll: true });
      });
      li.appendChild(btn);
      ol.appendChild(li);
    });

    // payments recorded before the trip changed
    var fb = $("folded"), fl = $("foldedList");
    fl.textContent = "";
    fb.hidden = !calc.folded.length;
    state.paid.forEach(function (p) {
      if (!p.fold) return;
      var f = person(p.f), to = person(p.t);
      var li = el("li", "folded__item");
      var s = el("span");
      s.appendChild(el("b", null, f ? f.name : "?"));
      s.appendChild(document.createTextNode(" paid "));
      s.appendChild(el("b", null, to ? to.name : "?"));
      s.appendChild(document.createTextNode(" " + money(p.a)));
      li.appendChild(s);
      var x = el("button", "folded__x", "×");
      x.type = "button";
      x.setAttribute("aria-label", "Remove the record of " + (f ? f.name : "") + " paying " + (to ? to.name : "") + " " + money(p.a));
      x.addEventListener("click", function () {
        var snap = snapshot();
        state.paid = state.paid.filter(function (q) { return q !== p; });
        A.tear();
        commit();
        toast("Removed that payment.", function () { restore(snap); });
      });
      li.appendChild(x);
      fl.appendChild(li);
    });

    // who's up, who's down
    var bl = $("balsList"), bw = $("bals");
    bl.textContent = "";
    bw.hidden = !state.exps.length;
    var maxAbs = 1;
    state.people.forEach(function (p) { maxAbs = Math.max(maxAbs, Math.abs(calc.base[p.id] || 0)); });
    state.people.forEach(function (p) {
      var v2 = calc.left[p.id] || 0;
      var li = el("li", "bal");
      li.appendChild(dot(p));
      li.appendChild(el("span", "bal__name", p.name));
      li.appendChild(el("span", "bal__net " + (v2 > 0 ? "is-up" : v2 < 0 ? "is-down" : "is-even"),
        v2 > 0 ? "gets back " + money(v2) : v2 < 0 ? "owes " + money(-v2) : "even"));
      li.appendChild(el("span", "bal__detail", "paid " + money(calc.tally.paid[p.id] || 0) + " · share " + money(calc.tally.share[p.id] || 0)));
      var bar = el("span", "bal__bar");
      bar.setAttribute("aria-hidden", "true");
      var i2 = el("i", v2 > 0 ? "is-up" : "is-down");
      var w = Math.abs(v2) / maxAbs * 50;
      i2.style.width = w.toFixed(2) + "%";
      i2.style.left = (v2 > 0 ? 50 : 50 - w).toFixed(2) + "%";
      bar.appendChild(i2);
      li.appendChild(bar);
      bl.appendChild(li);
    });

    // the ALL SQUARE moment
    var real = squareNow && state.people.length > 1;
    var stamp = $("stamp");
    $("stampDate").textContent = "SETTLED · " + new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toUpperCase();
    if (real && !ui.square) {
      ui.square = true;
      if (opts.initial) {
        stamp.classList.add("is-on");
      } else {
        ga("settle_all_square", { people: state.people.length, payments: n });
        slam(opts.paidK != null);
      }
    } else if (!real) {
      ui.square = false;
      stamp.classList.remove("is-on", "is-slam");
    }
  }

  function slam(afterCoins) {
    var stamp = $("stamp"), wrap = $("tableWrap");
    var r = wrap.getBoundingClientRect();
    var offscreen = r.top < 0 || r.bottom > window.innerHeight;
    if (offscreen) wrap.scrollIntoView({ behavior: reduced.matches ? "auto" : "smooth", block: "center" });
    var wait = (afterCoins && !reduced.matches ? 900 : 120) + (offscreen && !reduced.matches ? 350 : 0);
    setTimeout(function () {
      if (!ui.square) return;
      stamp.classList.remove("is-slam");
      void stamp.offsetWidth;
      stamp.classList.add("is-on");
      if (!reduced.matches) {
        stamp.classList.add("is-slam");
        wrap.classList.remove("is-shake"); void wrap.offsetWidth; wrap.classList.add("is-shake");
        setTimeout(function () { wrap.classList.remove("is-shake"); }, 400);
      }
      A.stamp();
    }, wait);
  }

  // ---------- link + summary ----------
  function summaryText() {
    if (!state.exps.length) return "";
    var lines = [];
    var head = tripName() + ": " + plural(heads(), "person", "people") + ", " + money(calc.total) + " total.";
    lines.push(head);
    if (!calc.plan.length) {
      lines.push("All square. Nobody owes anybody.");
    } else if (calc.done === calc.plan.length) {
      lines.push("All square. " + plural(calc.plan.length, "payment", "payments") + " made, and nobody owes anybody.");
    } else {
      var n = calc.plan.length;
      lines.push(plural(n, "payment", "payments") + (n === 1 ? " settles it:" : " settle it:"));
      calc.plan.forEach(function (t) {
        var f = person(t.f), to = person(t.t);
        lines.push("• " + (f ? f.name : "?") + " " + pays(f) + " " + (to ? to.name : "?") + " " + money(t.a) + (t.done ? " (paid)" : ""));
      });
    }
    var folded = state.paid.filter(function (p) { return p.fold; });
    if (folded.length) {
      lines.push("Already paid: " + folded.map(function (p) {
        var f = person(p.f), to = person(p.t);
        return (f ? f.name : "?") + " paid " + (to ? to.name : "?") + " " + money(p.a);
      }).join(", ") + ".");
    }
    if (currentCode) lines.push("", "The whole trip: " + tripUrl());
    return lines.join("\n");
  }

  function renderLink() {
    var show = state.exps.length > 0 || state.people.length >= 2;
    $("linkCard").hidden = !show;
    if (!show) return;
    $("summary").textContent = summaryText() || "Add an expense and a summary for the group chat shows up here.";
    $("copySummary").disabled = !state.exps.length;
    var url = tripUrl(), note = $("linkNote");
    if (currentCode && url.length > LONG_LINK) {
      note.hidden = false;
      note.textContent = "This link is " + url.length.toLocaleString("en-US") + " characters long. Most chat apps handle that fine, but a few cut long links off. If it breaks for someone, send the summary below instead.";
    } else note.hidden = true;
    var canShare = typeof navigator.share === "function";
    $("shareLink").hidden = !canShare;
    $("copyLink").className = "btn " + (canShare ? "btn--ghost" : "btn--primary");
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    try {
      var ta = el("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed"; ta.style.opacity = "0"; ta.style.top = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }
  function withCode(fn) {
    if (currentCode || !pendingWrite) { fn(); return; }
    pendingWrite.then(fn);
  }
  $("copyLink").addEventListener("click", function () {
    withCode(function () {
      copyText(tripUrl()).then(function (ok) {
        if (ok) { toast("Link copied. Paste it in the group chat."); ga("settle_link", { method: "copy" }); }
        else window.prompt("Copy this link:", tripUrl());
      });
    });
  });
  $("shareLink").addEventListener("click", function () {
    withCode(function () {
      var data = { title: tripName() + " · Settle Up", text: "The split for " + tripName() + ".", url: tripUrl() };
      navigator.share(data).then(function () { ga("settle_link", { method: "share" }); }, function () {});
    });
  });
  $("copySummary").addEventListener("click", function () {
    withCode(function () {
      var txt = summaryText();
      if (!txt) return;
      copyText(txt).then(function (ok) {
        if (ok) { toast("Summary copied."); ga("settle_summary_copy", { payments: calc.plan.length }); }
        else window.prompt("Copy this:", txt);
      });
    });
  });

  // ---------- hero ----------
  function renderHeroButtons() {
    $("newBtn").hidden = isEmpty();
    var rec = readRecent().filter(function (x) { return x.k !== state.k; });
    var box = $("recent"), ul = $("recentList");
    box.hidden = !rec.length || !isEmpty();
    ul.textContent = "";
    rec.forEach(function (r) {
      var li = el("li", "recent__item");
      var b = el("button", "recent__open");
      b.type = "button";
      b.appendChild(el("b", null, r.n || "A trip"));
      var tot = "";
      try { tot = C.money(r.total || 0, C.isCurrency(r.cur) ? r.cur : "USD", LOCALE); } catch (e) {}
      b.appendChild(el("span", null, plural(r.people || 0, "person", "people") + " · " + tot));
      b.addEventListener("click", function () {
        location.hash = "t=" + r.code;
      });
      var x = el("button", "recent__x", "×");
      x.type = "button";
      x.setAttribute("aria-label", "Forget " + (r.n || "this trip") + " on this device");
      x.addEventListener("click", function () { dropRecent(r.k); renderHeroButtons(); });
      li.appendChild(b); li.appendChild(x);
      ul.appendChild(li);
    });
  }

  $("sampleBtn").addEventListener("click", function () {
    var snap = isEmpty() ? null : snapshot();
    loadSample();
    A.print(4);
    flashLed();
    ga("settle_sample", {});
    if (snap) toast("Loaded the sample trip.", function () { restore(snap); });
    var tgt = window.innerWidth >= 980 ? $("tableWrap") : document.querySelector(".tapewrap");
    setTimeout(function () {
      if (tgt) tgt.scrollIntoView({ behavior: reduced.matches ? "auto" : "smooth", block: "start" });
    }, 60);
  });
  $("newBtn").addEventListener("click", function () {
    var snap = snapshot();
    var name = tripName();
    saveRecent();
    adopt(blank());
    commit({ quiet: true });
    A.tear();
    toast("Started a new trip. " + name + " is under Trips on this device.", function () { restore(snap); });
    $("personName").focus();
  });

  function loadSample() {
    var st = blank();
    st.k = newKey();
    st.name = "Lake trip";
    st.cur = "USD";
    var names = [["Alex", 0, 1], ["Sam", 4, 1], ["Priya", 3, 1], ["Jordan", 1, 1], ["Mia & Theo", 6, 2], ["Lee", 7, 1]];
    names.forEach(function (n, i) { st.people.push({ id: i, name: n[0], color: n[1], w: n[2] }); });
    st.nextId = names.length;
    var all = function () { return st.people.map(function (p) { return { id: p.id, w: p.w }; }); };
    var some = function (ids) { return ids.map(function (id) { return { id: id, w: st.people[id].w }; }); };
    st.exps = [
      { what: "Cabin, 3 nights", amt: 96000, by: 0, split: all() },
      { what: "Groceries", amt: 21437, by: 2, split: all() },
      { what: "Gas for the drive up", amt: 8640, by: 1, split: some([1, 2, 3]) },
      { what: "Boat rental", amt: 24000, by: 4, split: some([0, 1, 2, 3, 4]) },
      { what: "Dinner at the pier", amt: 37510, by: 3, split: all() },
      { what: "Firewood and ice", amt: 2750, by: 5, split: st.people.map(function (p) { return { id: p.id, w: 1 }; }) }
    ];
    adopt(st);
    ui.justPrinted = st.exps.slice();
    commit({ quiet: true });
  }

  // ---------- render ----------
  function render(opts) {
    opts = opts || {};
    calc = C.compute(state);
    $("curSel").value = state.cur;
    $("curVal").textContent = state.cur;
    if (ui.editExp && state.exps.indexOf(ui.editExp) === -1) ui.editExp = null;
    if (ui.editPerson != null && !person(ui.editPerson)) ui.editPerson = null;
    // keep the form's split in step with who exists
    state.people.forEach(function (p) { if (!(p.id in ui.sel)) ui.sel[p.id] = ui.editExp ? 0 : (ui.mode === "sh" ? p.w : 1); });
    renderPeople();
    renderPersonEditor();
    renderForm();
    renderTape();
    renderSettle(opts);
    renderTable();
    renderLink();
    renderHeroButtons();
  }

  // re-lay the table when its box changes size
  if (window.ResizeObserver) {
    var lastW = 0, rq = 0;
    new ResizeObserver(function (ents) {
      var w = Math.round(ents[0].contentRect.width);
      if (w === lastW) return;
      lastW = w;
      cancelAnimationFrame(rq);
      rq = requestAnimationFrame(renderTable);
    }).observe($("tableWrap"));
  }

  // ---------- sound ----------
  (function () {
    var b = $("soundBtn");
    function sync() {
      var on = A.isOn();
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.setAttribute("aria-label", on ? "Sound on" : "Sound off");
      b.title = on ? "Sound on" : "Sound off";
    }
    b.addEventListener("click", function () { A.unlock(); A.setOn(!A.isOn()); sync(); if (A.isOn()) A.tick(); });
    sync();
    var once = function () {
      A.unlock();
      window.removeEventListener("pointerdown", once, true);
      window.removeEventListener("keydown", once, true);
    };
    window.addEventListener("pointerdown", once, true);
    window.addEventListener("keydown", once, true);
  })();

  // automation only: a read-only window into the state for headless checks
  if (navigator.webdriver) {
    window.__settleUp = {
      state: function () { return JSON.parse(JSON.stringify(C.toCompact(state))); },
      calc: function () { return JSON.parse(JSON.stringify({ plan: calc.plan, total: calc.total, square: calc.square, left: calc.left, naive: calc.naive, exact: calc.exact })); },
      code: function () { return currentCode; },
      tokens: function () {
        var out = {}, svg = $("tableSvg"), m = svg.getScreenCTM();
        Object.keys(T.layout).forEach(function (id) {
          var L = T.layout[id], pt = svg.createSVGPoint();
          pt.x = L.x; pt.y = L.y;
          var s = pt.matrixTransform(m);
          out[id] = { x: s.x, y: s.y };
        });
        return out;
      },
      summary: summaryText
    };
  }

  // ---------- boot ----------
  resetForm();
  loadFromHash();
})();
