/* One Page Toys — Prize Counter.
 * Spend the tickets earned across the toys (window.OPT_TICKETS from
 * assets/tickets.js) on collectible prizes, most of which mint a shareable card
 * on the spot. No backend: a share is a link that encodes what you won, and
 * arriving on that link renders a read-only brag view. Forgeable by design —
 * this is for fun.
 *
 * Everything is data-driven from store-items.json, so expanding the counter is
 * just adding catalog entries (see the _comment field in that file). */
(function () {
  "use strict";

  var T = window.OPT_TICKETS; // the ticket ledger; always present via tickets.js
  var P = window.OPT_PRIZES || null; // equippable-effect runtime (assets/prizes.js)
  var DATA = null;
  var NAME_KEY = "opt_store_name";
  var els = {};

  function equippable(it) { return it && it.equippable && P && P.hasEffect(it.id); }
  function isEquipped(it) { return equippable(it) && P.isEquipped(it.id); }

  // Rarity → the two-stop gradient used on the shareable card.
  var RARITY_GRAD = {
    common: ["#6b7280", "#4b5563"],
    uncommon: ["#2f9e63", "#1f7a49"],
    rare: ["#3a7bd5", "#2456a8"],
    epic: ["#8b46c9", "#6a2fa0"],
    legendary: ["#e0873a", "#b85c1e"]
  };
  var RARITY_LABEL = {
    common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic", legendary: "Legendary"
  };

  // Rank ladder, keyed off lifetime tickets earned. Purely for flavor.
  var RANKS = [
    { at: 0, name: "Newcomer" },
    { at: 50, name: "Regular" },
    { at: 150, name: "Sharp Shooter" },
    { at: 400, name: "Arcade Ace" },
    { at: 900, name: "High Roller" },
    { at: 2000, name: "Ticket Tycoon" },
    { at: 5000, name: "Arcade Legend" },
    { at: 12000, name: "Counter Royalty" }
  ];

  /* ------------------------------------------------------------- utilities */

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function itemById(id) {
    for (var i = 0; i < DATA.items.length; i++) if (DATA.items[i].id === id) return DATA.items[i];
    return null;
  }
  function playerName() {
    var n = "";
    try { n = localStorage.getItem(NAME_KEY) || ""; } catch (e) {}
    return n.trim();
  }
  function displayName() { return playerName() || "Someone"; }

  function rankFor(life) {
    var cur = RANKS[0], nxt = null;
    for (var i = 0; i < RANKS.length; i++) {
      if (life >= RANKS[i].at) { cur = RANKS[i]; nxt = RANKS[i + 1] || null; }
    }
    return { cur: cur, nxt: nxt };
  }

  /* url-safe base64 for the share payload */
  function encodePayload(obj) {
    try {
      var json = JSON.stringify(obj);
      var b64 = btoa(unescape(encodeURIComponent(json)));
      return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    } catch (e) { return ""; }
  }
  function decodePayload(str) {
    try {
      var b64 = str.replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      return JSON.parse(decodeURIComponent(escape(atob(b64))));
    } catch (e) { return null; }
  }

  /* ------------------------------------------------------------- wallet UI */

  function paintWallet(bump) {
    var bal = T.balance(), life = T.lifetime(), owned = T.owned().length;
    els.balNum.textContent = bal.toLocaleString();
    els.lifeNum.textContent = life.toLocaleString();
    els.ownedNum.textContent = String(owned);
    var r = rankFor(life);
    els.rankName.textContent = r.cur.name;
    if (r.nxt) {
      var span = r.nxt.at - r.cur.at;
      var into = life - r.cur.at;
      els.rankBar.style.width = Math.max(3, Math.min(100, (into / span) * 100)) + "%";
      els.rankNext.textContent = (r.nxt.at - life).toLocaleString() + " to " + r.nxt.name;
    } else {
      els.rankBar.style.width = "100%";
      els.rankNext.textContent = "Top rank reached";
    }
    if (bump) {
      els.balNum.classList.remove("bump");
      void els.balNum.offsetWidth;
      els.balNum.classList.add("bump");
    }
  }

  /* --------------------------------------------------------- prize wall */

  var activeCat = "all";

  function ownedItems() { return T.owned().map(itemById).filter(Boolean); }

  function renderChips() {
    els.catChips.innerHTML = "";
    var owned = ownedItems();
    // "My prizes" leads the row (only once you own something) so bought prizes
    // are one click away instead of buried at the bottom of the page.
    var chips = [];
    if (owned.length) chips.push({ id: "mine", name: "My prizes", icon: "★", count: owned.length });
    chips.push({ id: "all", name: "All prizes", icon: "🎪", count: DATA.items.length });
    DATA.categories.forEach(function (c) {
      chips.push({ id: c.id, name: c.name, icon: c.icon, count: DATA.items.filter(function (it) { return it.cat === c.id; }).length });
    });
    // If the current filter is "mine" but nothing is owned, fall back to all.
    if (activeCat === "mine" && !owned.length) activeCat = "all";
    chips.forEach(function (c) {
      var chip = el("button", "chip" + (c.id === "mine" ? " chip--mine" : ""));
      chip.type = "button";
      chip.setAttribute("role", "tab");
      chip.setAttribute("aria-selected", c.id === activeCat ? "true" : "false");
      chip.dataset.cat = c.id;
      chip.innerHTML = '<span aria-hidden="true">' + esc(c.icon) + "</span> " + esc(c.name) +
        ' <span class="chip__count">' + c.count + "</span>";
      chip.addEventListener("click", function () { activeCat = c.id; renderChips(); renderWall(); });
      els.catChips.appendChild(chip);
    });
  }

  function renderWall() {
    els.prizeWall.innerHTML = "";
    var bal = T.balance();

    // "My prizes" view: every prize you've bought, newest first.
    if (activeCat === "mine") {
      var mine = ownedItems();
      if (!mine.length) {
        els.prizeWall.innerHTML = '<p class="wall-empty">No prizes yet — redeem something and it shows up here.</p>';
        return;
      }
      var band = el("div", "cat-band");
      band.innerHTML = '<span class="cat-band__icon" aria-hidden="true">★</span>' +
        '<span class="cat-band__name">My prizes</span>' +
        '<span class="cat-band__tag">tap any prize to show it off or equip it</span>';
      els.prizeWall.appendChild(band);
      mine.reverse().forEach(function (it) { els.prizeWall.appendChild(prizeCard(it, bal)); });
      return;
    }

    var cats = DATA.categories.filter(function (c) { return activeCat === "all" || c.id === activeCat; });
    cats.forEach(function (c) {
      var items = DATA.items.filter(function (it) { return it.cat === c.id; });
      if (!items.length) return;
      if (activeCat === "all") {
        var b2 = el("div", "cat-band");
        b2.innerHTML = '<span class="cat-band__icon" aria-hidden="true">' + esc(c.icon) + "</span>" +
          '<span class="cat-band__name">' + esc(c.name) + "</span>" +
          '<span class="cat-band__tag">' + esc(c.tagline) + "</span>";
        els.prizeWall.appendChild(b2);
      }
      items.forEach(function (it) { els.prizeWall.appendChild(prizeCard(it, bal)); });
    });
  }

  // Jump to the "My prizes" view (from the wallet count or elsewhere).
  function showMyPrizes() {
    if (!ownedItems().length) return;
    activeCat = "mine";
    renderChips();
    renderWall();
    if (els.prizeWall.scrollIntoView) els.prizeWall.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // The whole card is the tap target: clicking it opens the detail dialog,
  // which carries the full description and the actual purchase button. The foot
  // "button" is now just a state label — the card itself is the control.
  function prizeCard(it, bal) {
    var owned = T.own(it.id);
    var poor = !owned && bal < it.price;
    var card = el("div", "prize");
    card.dataset.r = it.rarity;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label",
      it.name + " — " + (RARITY_LABEL[it.rarity] || it.rarity) + ", " +
      (owned ? "already won" : it.price.toLocaleString() + " tickets") + ". View details.");
    if (owned) card.classList.add("is-owned");
    if (poor) card.classList.add("is-poor");

    var equip = equippable(it), equipped = isEquipped(it);
    if (equipped) card.classList.add("is-equipped");
    var label, locked = false;
    if (owned && equip) label = equipped ? "Equipped ✓" : "Equip";
    else if (owned) label = it.repeatable ? "Open again" : "Won ✓";
    else if (poor) { label = "Need " + (it.price - bal).toLocaleString(); locked = true; }
    else label = "Redeem";

    card.innerHTML =
      (equipped ? '<span class="prize__own-badge is-live" aria-hidden="true">● Live</span>'
        : owned ? '<span class="prize__own-badge" aria-hidden="true">✓ Won</span>' : "") +
      '<div class="prize__top">' +
        '<div class="prize__icon" aria-hidden="true">' + esc(it.icon) + "</div>" +
        '<span class="prize__rarity">' + esc(RARITY_LABEL[it.rarity] || it.rarity) + "</span>" +
      "</div>" +
      '<h3 class="prize__name">' + esc(it.name) + "</h3>" +
      '<p class="prize__blurb">' + esc(it.blurb) + "</p>" +
      '<div class="prize__foot">' +
        '<span class="prize__price"><span class="t" aria-hidden="true">🎟️</span> ' + it.price.toLocaleString() + "</span>" +
        '<span class="prize__buy' + (locked ? " is-locked" : "") + '" aria-hidden="true">' + esc(label) + "</span>" +
      "</div>";

    function open() { openDetail(it); }
    card.addEventListener("click", open);
    card.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
    return card;
  }

  /* -------------------------------------------------- detail + purchase */

  var RARITY_FLAVOR = {
    common: "A staple of the prize wall.",
    uncommon: "A cut above the everyday.",
    rare: "Not everyone walks away with this.",
    epic: "A serious flex — turn some heads.",
    legendary: "The stuff of arcade legend."
  };

  function catById(id) {
    for (var i = 0; i < DATA.categories.length; i++) if (DATA.categories[i].id === id) return DATA.categories[i];
    return null;
  }

  // Info dialog with the purchase (or share) action. This is what a card click
  // opens; redeeming from here flows straight into the celebration/share card.
  function openDetail(it) {
    var owned = T.own(it.id);
    var bal = T.balance();
    var poor = !owned && bal < it.price;
    var grad = RARITY_GRAD[it.rarity] || RARITY_GRAD.common;
    var cat = catById(it.cat);
    var equip = equippable(it);
    var equipped = isEquipped(it);

    // "What you get" line. Equippable items describe their live effect.
    var getIcon, getLine;
    if (equip) {
      getIcon = "🪄";
      getLine = (P.describe(it.id) || "A site-wide effect.") + " Turn it on or off any time.";
    } else if (it.kind === "keep") {
      getIcon = "🎒"; getLine = "A keepsake tucked into your prize bag — a little something just for you.";
    } else {
      getIcon = "📤"; getLine = "A shareable prize card, signed with your arcade name. Post it anywhere.";
    }
    if (it.repeatable) getLine += " Re-roll it as often as you like.";

    // Primary action adapts to state. Equippables toggle the effect once owned.
    var actLabel, actKind, actExtra = "";
    if (!owned && poor) { actLabel = "Need " + (it.price - bal).toLocaleString() + " more tickets"; actKind = "locked"; }
    else if (!owned) { actLabel = "Redeem for " + it.price.toLocaleString() + " 🎟️"; actKind = "buy"; }
    else if (equip && equipped) { actLabel = "Turn it off"; actKind = "unequip"; }
    else if (equip) { actLabel = "Equip it"; actKind = "equip"; }
    else if (it.repeatable) { actLabel = "Open another →"; actKind = "share"; }
    else { actLabel = it.kind === "keep" ? "View keepsake" : "Share this"; actKind = "share"; }
    // Owned equippables also keep a quiet share option.
    var showShareLink = owned && equip;

    els.modalBody.innerHTML =
      '<div class="detail" data-r="' + it.rarity + '">' +
        '<div class="detail__hero' + (equipped ? " is-on" : "") + '" style="--c1:' + grad[0] + ";--c2:" + grad[1] + '">' +
          '<span class="detail__icon" aria-hidden="true">' + esc(it.icon) + "</span>" +
          (equipped ? '<span class="detail__onbadge">● Equipped</span>' : "") +
        "</div>" +
        '<p class="detail__eyebrow">' + esc(cat ? cat.name : "Prize") + " · " + esc(RARITY_LABEL[it.rarity] || it.rarity) +
          (equip ? " · Equippable" : "") + "</p>" +
        '<h2 class="modal__title" id="modalTitle">' + esc(it.name) + "</h2>" +
        '<p class="detail__rarity">' + esc(RARITY_FLAVOR[it.rarity] || "") + "</p>" +
        '<p class="detail__blurb">' + esc(it.blurb) + "</p>" +
        '<div class="detail__get"><span aria-hidden="true">' + getIcon + "</span> " + esc(getLine) + "</div>" +
        '<div class="detail__pricerow">' +
          (owned
            ? '<span class="detail__owned">✓ In your collection</span>'
            : '<span class="detail__price"><span class="t" aria-hidden="true">🎟️</span> ' + it.price.toLocaleString() + "</span>") +
          '<span class="detail__have">You have ' + bal.toLocaleString() + " 🎟️</span>" +
        "</div>" +
        '<button type="button" class="btn btn--primary detail__action" data-kind="' + actKind + '"' + (actKind === "locked" ? " disabled" : "") + ">" + esc(actLabel) + "</button>" +
        (showShareLink ? '<button type="button" class="detail__earn detail__sharelink">Share the card instead →</button>' : "") +
        (poor ? '<a class="detail__earn" href="/all-toys/">Go earn a few more →</a>' : "") +
      "</div>";

    var act = els.modalBody.querySelector(".detail__action");
    if (actKind === "buy") act.addEventListener("click", function () { redeem(it); });
    else if (actKind === "equip") act.addEventListener("click", function () { P.equip(it.id); toast(it.name + " equipped — look around!"); openDetail(it); });
    else if (actKind === "unequip") act.addEventListener("click", function () { P.unequip(it.id); toast(it.name + " turned off"); openDetail(it); });
    else if (actKind === "share") act.addEventListener("click", function () { openPrize(it, false); });
    var sl = els.modalBody.querySelector(".detail__sharelink");
    if (sl) sl.addEventListener("click", function () { openPrize(it, false); });
    showModal();
  }

  /* ------------------------------------------------------------- redeem */

  function redeem(it) {
    if (T.own(it.id)) { openPrize(it, false); return; }
    var ok = T.spend(it.price, it.id);
    if (!ok) { toast("Not enough tickets yet — go play a little!"); refresh(true); openDetail(it); return; }
    try { if (window.gtag) window.gtag("event", "store_redeem", { item_id: it.id, price: it.price }); } catch (e) {}
    burstConfetti(it);
    refresh(true);
    openPrize(it, true);
  }

  /* --------------------------------------------------- the shareable card */

  var RARITY_STARS = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 };

  // Build the DOM for a prize card — a holographic collectible: foil sheen, a
  // rarity star rating, a spotlit icon, and rank/ticket stats. `perf` is a
  // per-open flavor line (a fortune for repeatable items).
  function cardMarkup(it, opts) {
    opts = opts || {};
    var grad = RARITY_GRAD[it.rarity] || RARITY_GRAD.common;
    var who = opts.who || displayName();
    var life = opts.life != null ? opts.life : T.lifetime();
    var perf = opts.perf || "";
    var stars = RARITY_STARS[it.rarity] || 1;
    var rank = rankFor(life).cur.name;
    var starRow = "";
    for (var i = 0; i < 5; i++) starRow += '<span class="' + (i < stars ? "on" : "") + '">★</span>';
    return '<div class="pcard pcard--' + it.rarity + '" style="--c1:' + grad[0] + ";--c2:" + grad[1] + '">' +
      '<div class="pcard__foil" aria-hidden="true"></div>' +
      '<div class="pcard__shine" aria-hidden="true"></div>' +
      '<div class="pcard__inner">' +
        '<div class="pcard__top">' +
          '<span class="pcard__brand">Prize Counter</span>' +
          '<span class="pcard__stars" aria-hidden="true">' + starRow + "</span>" +
        "</div>" +
        '<div class="pcard__spot"><div class="pcard__icon" aria-hidden="true">' + esc(it.icon) + "</div></div>" +
        '<div class="pcard__name">' + esc(it.name) + "</div>" +
        '<div class="pcard__rarity">' + esc(RARITY_LABEL[it.rarity] || it.rarity) + "</div>" +
        '<p class="pcard__who"><b>' + esc(who) + "</b> " + esc(it.share) + "</p>" +
        (perf ? '<p class="pcard__perf">“' + esc(perf) + "”</p>" : "") +
        '<div class="pcard__stats">' +
          '<span class="pcard__stat"><b>' + esc(rank) + "</b><i>arcade rank</i></span>" +
          '<span class="pcard__stat"><b>' + life.toLocaleString() + "</b><i>tickets all-time</i></span>" +
        "</div>" +
        '<p class="pcard__foot">onepagetoys.com/store</p>' +
      "</div>" +
    "</div>";
  }

  // Give a mounted .pcard a foil tilt on mouse move (desktop only, motion-safe).
  function wireCardTilt(root) {
    if (!root) return;
    var mq = window.matchMedia;
    if (mq && (mq("(prefers-reduced-motion: reduce)").matches || !mq("(pointer: fine)").matches)) return;
    var card = root.querySelector(".pcard");
    if (!card) return;
    var foil = card.querySelector(".pcard__foil");
    card.addEventListener("pointermove", function (e) {
      var r = card.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width - 0.5;
      var py = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform = "perspective(760px) rotateY(" + px * 13 + "deg) rotateX(" + -py * 13 + "deg)";
      if (foil) { foil.style.transform = "translate(" + px * 45 + "%," + py * 45 + "%)"; foil.style.opacity = String(Math.min(1, 0.4 + Math.abs(px) + Math.abs(py))); }
    });
    card.addEventListener("pointerleave", function () {
      card.style.transform = ""; if (foil) { foil.style.transform = ""; foil.style.opacity = ""; }
    });
  }

  function pickFortune() {
    var f = DATA.fortunes || [];
    if (!f.length) return "";
    return f[Math.floor(Math.random() * f.length)];
  }

  var currentOpen = null; // { it, perf } — so re-roll and share stay in sync

  function openPrize(it, justWon) {
    var perf = it.repeatable ? pickFortune() : "";
    currentOpen = { it: it, perf: perf };
    var equip = equippable(it), equipped = isEquipped(it);
    var title = justWon ? "Prize redeemed!" : (it.repeatable ? "Here's your fortune" : "Your prize");
    var sub = equip
      ? (equipped ? "It's live across the whole site. Look around!" : "Equip it and it runs on every page.")
      : it.kind === "keep"
        ? "Tucked into your prize bag. A little something just for you."
        : "Share it before the moment's gone.";

    var body = els.modalBody;
    var hasNative = !!navigator.share;
    // Equippables lead with the on/off toggle; everything is always shareable.
    var primary = (equip
      ? '<button type="button" class="btn btn--primary" id="doEquip">' + (equipped ? "Turn it off" : "Equip it") + "</button>" +
        '<button type="button" class="btn" id="doShare">' + (hasNative ? "Share the card" : "Post the card") + "</button>"
      : '<button type="button" class="btn btn--primary share-primary" id="doShare"><span aria-hidden="true">↗</span> ' + (hasNative ? "Share it" : "Post it") + "</button>");

    body.innerHTML =
      '<h2 class="modal__title" id="modalTitle">' + esc(title) + "</h2>" +
      '<p class="modal__sub">' + esc(sub) + "</p>" +
      '<div id="cardMount">' + cardMarkup(it, { perf: perf }) + "</div>" +
      '<div class="modal__actions">' + primary + "</div>" +
      '<div class="share-mini">' +
        '<button type="button" id="doDownload"><span aria-hidden="true">⬇</span> Save image</button>' +
        '<button type="button" id="doCopy"><span aria-hidden="true">🔗</span> Copy link</button>' +
        '<button type="button" id="doX"><span aria-hidden="true">𝕏</span> Post to X</button>' +
      "</div>" +
      (it.repeatable ? '<button type="button" class="modal__reroll" id="doReroll">Open another →</button>' : "");

    if (equip) {
      $("doEquip").addEventListener("click", function () {
        if (isEquipped(it)) { P.unequip(it.id); toast(it.name + " turned off"); }
        else { P.equip(it.id); toast(it.name + " equipped — look around!"); }
        refresh(false);
        openPrize(it, false);
      });
    }
    $("doShare").addEventListener("click", function () { sharePrize(it, currentOpen.perf); });
    $("doDownload").addEventListener("click", function () { savePrizeImage(it, currentOpen.perf); });
    $("doCopy").addEventListener("click", function () { copyLink(it, currentOpen.perf); });
    $("doX").addEventListener("click", function () { postToX(it, currentOpen.perf); });
    if (it.repeatable) {
      $("doReroll").addEventListener("click", function () {
        currentOpen.perf = pickFortune();
        $("cardMount").innerHTML = cardMarkup(it, { perf: currentOpen.perf });
        wireCardTilt($("cardMount"));
      });
    }
    wireCardTilt($("cardMount"));
    showModal();
  }

  function postToX(it, perf) {
    var url = "https://x.com/intent/tweet?text=" + encodeURIComponent(shareText(it)) +
      "&url=" + encodeURIComponent(shareUrl(it, perf));
    window.open(url, "_blank", "noopener");
    try { if (window.gtag) window.gtag("event", "share", { method: "x", content_type: "prize", item_id: it.id }); } catch (e) {}
  }

  /* share payload → a link that renders the brag view */
  function shareUrl(it, perf) {
    var payload = { i: it.id, n: playerName(), l: T.lifetime(), p: perf || "", v: 1 };
    return location.origin + "/store/#s=" + encodePayload(payload);
  }

  function shareText(it) {
    return displayName() + " " + it.share + " at the One Page Toys Prize Counter";
  }

  function sharePrize(it, perf) {
    var url = shareUrl(it, perf), text = shareText(it);
    try { if (window.gtag) window.gtag("event", "share", { method: navigator.share ? "web_share" : "clipboard", content_type: "prize", item_id: it.id }); } catch (e) {}
    // Try to share the rendered image where supported; fall back to link.
    renderCardImage(it, perf).then(function (blob) {
      var file = blob ? new File([blob], "prize.png", { type: "image/png" }) : null;
      if (navigator.share && file && navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ title: "My arcade prize", text: text, files: [file] }).catch(function () {});
        return;
      }
      if (navigator.share) { navigator.share({ title: "My arcade prize", text: text, url: url }).catch(function () {}); return; }
      // No native share (most desktops) — hop to an X post, which is a real share.
      postToX(it, perf);
    });
  }

  function copyLink(it, perf) {
    copyToClipboard(shareText(it) + " " + shareUrl(it, perf));
  }

  function copyToClipboard(str) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(str).then(function () { toast("Link copied!"); }, function () { window.prompt("Copy this:", str); });
    } else {
      window.prompt("Copy this:", str);
    }
  }

  /* ------------------------------------------- canvas render of the card */

  // Draw the shareable card onto a canvas so it can be shared as an image or
  // downloaded. Mirrors the DOM .pcard layout.
  function drawCard(ctx, W, H, it, opts) {
    opts = opts || {};
    var grad = RARITY_GRAD[it.rarity] || RARITY_GRAD.common;
    var who = opts.who || displayName();
    var life = opts.life != null ? opts.life : T.lifetime();
    var perf = opts.perf || "";
    var stars = RARITY_STARS[it.rarity] || 1;
    var rank = rankFor(life).cur.name;
    var pad = 18;

    // frame
    var g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, grad[0]); g.addColorStop(1, grad[1]);
    ctx.fillStyle = g; roundRect(ctx, 0, 0, W, H, 44); ctx.fill();
    // inner panel
    ctx.fillStyle = "rgba(0,0,0,0.16)"; roundRect(ctx, pad, pad, W - pad * 2, H - pad * 2, 32); ctx.fill();
    var inner = ctx.createLinearGradient(0, pad, 0, H - pad);
    inner.addColorStop(0, "rgba(255,255,255,0.08)"); inner.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = inner; roundRect(ctx, pad, pad, W - pad * 2, H - pad * 2, 32); ctx.fill();

    // diagonal foil sheen band
    ctx.save();
    roundRect(ctx, pad, pad, W - pad * 2, H - pad * 2, 32); ctx.clip();
    var sheen = ctx.createLinearGradient(0, 0, W, H);
    sheen.addColorStop(0.30, "rgba(255,255,255,0)");
    sheen.addColorStop(0.46, "rgba(255,255,255,0.22)");
    sheen.addColorStop(0.54, "rgba(255,255,255,0)");
    ctx.fillStyle = sheen; ctx.fillRect(0, 0, W, H);
    // spotlight behind the icon
    var spot = ctx.createRadialGradient(W / 2, H * 0.34, 8, W / 2, H * 0.34, W * 0.42);
    spot.addColorStop(0, "rgba(255,255,255,0.34)"); spot.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = spot; ctx.fillRect(0, 0, W, H);
    ctx.restore();

    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,0.82)";
    ctx.font = "600 18px 'Geist Mono', ui-monospace, monospace";
    ctx.fillText("PRIZE COUNTER", pad + 26, pad + 44);
    // stars, top-right
    ctx.textAlign = "right";
    for (var si = 0; si < 5; si++) {
      ctx.fillStyle = si < stars ? "#ffe08a" : "rgba(255,255,255,0.3)";
      ctx.font = "22px 'Geist', system-ui, sans-serif";
      ctx.fillText("★", W - pad - 26 - (4 - si) * 26, pad + 46);
    }

    ctx.textAlign = "center";
    ctx.font = "150px 'Geist', system-ui, sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(it.icon, W / 2, H * 0.34 + 54);

    ctx.font = "800 50px 'Geist', system-ui, sans-serif";
    ctx.fillText(it.name, W / 2, H * 0.34 + 150);

    ctx.font = "500 20px 'Geist Mono', ui-monospace, monospace";
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillText((RARITY_LABEL[it.rarity] || it.rarity).toUpperCase(), W / 2, H * 0.34 + 186);

    ctx.fillStyle = "#ffffff";
    ctx.font = "700 30px 'Geist', system-ui, sans-serif";
    var yb = wrapText(ctx, who + " " + it.share, W / 2, H * 0.34 + 250, W - 130, 40);
    if (perf) { ctx.font = "italic 23px 'Geist', system-ui, sans-serif"; ctx.fillStyle = "rgba(255,255,255,0.9)"; yb = wrapText(ctx, "“" + perf + "”", W / 2, yb + 44, W - 150, 32); }

    // stats row: rank | tickets
    var sy = H - 118, colL = W * 0.3, colR = W * 0.7;
    ctx.fillStyle = "#ffffff"; ctx.font = "800 26px 'Geist', system-ui, sans-serif";
    ctx.fillText(rank, colL, sy);
    ctx.fillText(life.toLocaleString(), colR, sy);
    ctx.fillStyle = "rgba(255,255,255,0.72)"; ctx.font = "500 14px 'Geist Mono', ui-monospace, monospace";
    ctx.fillText("ARCADE RANK", colL, sy + 24);
    ctx.fillText("TICKETS ALL-TIME", colR, sy + 24);

    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.font = "500 18px 'Geist Mono', ui-monospace, monospace";
    ctx.fillText("ONEPAGETOYS.COM/STORE", W / 2, H - 44);
  }

  function renderCardImage(it, perf, who, life) {
    return new Promise(function (resolve) {
      try {
        var scale = 2, W = 640, H = 800;
        var cv = document.createElement("canvas");
        cv.width = W * scale; cv.height = H * scale;
        var ctx = cv.getContext("2d");
        ctx.scale(scale, scale);
        drawCard(ctx, W, H, it, { perf: perf, who: who, life: life });
        if (cv.toBlob) cv.toBlob(function (b) { resolve(b); }, "image/png");
        else resolve(null);
      } catch (e) { resolve(null); }
    });
  }

  function savePrizeImage(it, perf) {
    renderCardImage(it, perf).then(function (blob) {
      if (!blob) { toast("Couldn't render the image here."); return; }
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = "opt-prize-" + it.id + ".png";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      toast("Saved!");
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function wrapText(ctx, text, x, y, maxW, lh) {
    var words = String(text).split(" "), line = "", yy = y;
    for (var i = 0; i < words.length; i++) {
      var test = line + words[i] + " ";
      if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line.trim(), x, yy); line = words[i] + " "; yy += lh; }
      else line = test;
    }
    ctx.fillText(line.trim(), x, yy);
    return yy;
  }

  /* -------------------------------------------------------------- shelf */

  function renderShelf() {
    var owned = T.owned();
    if (!owned.length) { els.shelf.hidden = true; return; }
    els.shelf.hidden = false;
    els.shelfGrid.innerHTML = "";
    owned.forEach(function (id) {
      var it = itemById(id);
      if (!it) return;
      var e = el("div", "shelf-item");
      e.dataset.r = it.rarity;
      e.title = it.name;
      if (isEquipped(it)) e.classList.add("is-equipped");
      e.innerHTML = '<div class="shelf-item__icon" aria-hidden="true">' + esc(it.icon) + "</div>" +
        '<div class="shelf-item__name">' + esc(it.name) + "</div>" +
        (isEquipped(it) ? '<div class="shelf-item__live" aria-hidden="true">● Live</div>' : "");
      // The shelf is the persistent share hub: tapping any owned prize brings its
      // shareable card back up, any time — you own it, you can always show it off.
      e.addEventListener("click", function () { openPrize(it, false); });
      els.shelfGrid.appendChild(e);
    });
  }

  function shareShelf() {
    var owned = T.owned().map(itemById).filter(Boolean);
    if (!owned.length) return;
    // The shelf shares the rarest, priciest prize as its headline card.
    var order = { legendary: 5, epic: 4, rare: 3, uncommon: 2, common: 1 };
    owned.sort(function (a, b) { return (order[b.rarity] - order[a.rarity]) || (b.price - a.price); });
    var head = owned[0];
    var text = displayName() + " has won " + owned.length + " prize" + (owned.length === 1 ? "" : "s") +
      " at the One Page Toys Prize Counter, including the " + head.name;
    var url = location.origin + "/store/#s=" + encodePayload({ i: head.id, n: playerName(), l: T.lifetime(), p: "", c: owned.length, v: 1 });
    if (navigator.share) { navigator.share({ title: "My prize shelf", text: text, url: url }).catch(function () {}); }
    else copyToClipboard(text + " " + url);
    try { if (window.gtag) window.gtag("event", "share", { method: navigator.share ? "web_share" : "clipboard", content_type: "shelf" }); } catch (e) {}
  }

  /* ------------------------------------------------------------ modal */

  function showModal() { els.modal.hidden = false; document.addEventListener("keydown", onEsc); }
  function hideModal() { els.modal.hidden = true; document.removeEventListener("keydown", onEsc); }
  function onEsc(e) { if (e.key === "Escape") hideModal(); }

  /* ------------------------------------------------------------ confetti */

  function burstConfetti(it) {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var grad = RARITY_GRAD[it.rarity] || RARITY_GRAD.common;
    var colors = [grad[0], grad[1], "#ffd9a8", "#ffffff", "#e0873a"];
    var root = els.confetti, N = it.rarity === "legendary" ? 90 : 55;
    for (var i = 0; i < N; i++) {
      (function () {
        var b = el("div", "confetti-bit");
        b.style.background = colors[(Math.random() * colors.length) | 0];
        b.style.left = (40 + Math.random() * 20) + "vw";
        b.style.top = "-20px";
        b.style.borderRadius = Math.random() < 0.5 ? "2px" : "50%";
        root.appendChild(b);
        var dx = (Math.random() - 0.5) * 60, dur = 1400 + Math.random() * 1400, rot = (Math.random() - 0.5) * 900;
        var t0 = performance.now();
        (function fall(now) {
          var k = (now - t0) / dur;
          if (k >= 1) { b.remove(); return; }
          b.style.transform = "translate(" + dx * k + "vw," + (k * 110) + "vh) rotate(" + rot * k + "deg)";
          b.style.opacity = String(1 - k * k);
          requestAnimationFrame(fall);
        })(t0);
      })();
    }
  }

  /* ------------------------------------------------------------ toast */

  var toastEl = null, toastT = null;
  function toast(msg) {
    if (!toastEl) { toastEl = el("div", "toast"); document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove("show"); }, 2200);
  }

  /* -------------------------------------------------- brag arrival view */

  function maybeBragView() {
    var h = location.hash || "";
    var m = h.match(/[#&]s=([^&]+)/);
    if (!m) return false;
    var payload = decodePayload(m[1]);
    if (!payload) return false;
    var it = itemById(payload.i);
    if (!it) return false;

    $("shopView").hidden = true;
    var bv = $("bragView");
    bv.hidden = false;

    var who = (payload.n && payload.n.trim()) || "Someone";
    var life = payload.l || 0;
    var extra = payload.c && payload.c > 1
      ? who + " has won " + payload.c + " prizes at the counter — here's the headliner."
      : "Fresh off the One Page Toys Prize Counter.";

    bv.innerHTML =
      '<div class="brag">' +
        '<p class="pagehead__eyebrow">Someone\'s arcade flex</p>' +
        '<h1 class="brag__hd">' + esc(who) + " " + esc(it.share) + "!</h1>" +
        '<p class="brag__sub">' + esc(extra) + "</p>" +
        '<div class="brag__card-wrap">' + cardMarkup(it, { who: who, life: life, perf: payload.p || "" }) + "</div>" +
        '<div class="brag__cta">' +
          '<a class="btn btn--primary" href="/all-toys/">Earn your own tickets</a>' +
          '<a class="btn" href="/store/" id="visitStore">Visit the counter</a>' +
        "</div>" +
      "</div>";
    // "Visit the counter" should drop the hash and show the real shop.
    $("visitStore").addEventListener("click", function (e) {
      e.preventDefault();
      history.replaceState(null, "", "/store/");
      bv.hidden = true;
      $("shopView").hidden = false;
      boot();
    });
    wireCardTilt(bv);
    try { if (window.gtag) window.gtag("event", "store_brag_view", { item_id: it.id }); } catch (e) {}
    return true;
  }

  /* ------------------------------------------------------------ wiring */

  function refresh(bump) { paintWallet(bump); renderWall(); renderShelf(); }

  function cacheEls() {
    ["balNum", "lifeNum", "ownedNum", "rankName", "rankBar", "rankNext", "walletMine",
     "catChips", "prizeWall", "shelf", "shelfGrid", "modal", "modalBody",
     "confetti", "nameInput", "shareShelf"].forEach(function (id) { els[id] = $(id); });
  }

  function wireStatic() {
    // modal close
    els.modal.addEventListener("click", function (e) {
      if (e.target.hasAttribute("data-close")) hideModal();
    });
    // name field
    els.nameInput.value = playerName();
    els.nameInput.addEventListener("input", function () {
      try { localStorage.setItem(NAME_KEY, els.nameInput.value.slice(0, 24)); } catch (e) {}
    });
    els.shareShelf.addEventListener("click", shareShelf);
    if (els.walletMine) els.walletMine.addEventListener("click", showMyPrizes);
    // live balance if it changes elsewhere (e.g. earning in another tab)
    T.on(function () { paintWallet(false); });
    // reflect equip toggles on the wall + shelf immediately
    if (P) P.on(function () { renderWall(); renderShelf(); });
  }

  function boot() {
    cacheEls();
    renderChips();
    refresh(false);
  }

  function start() {
    cacheEls();
    wireStatic();
    if (maybeBragView()) return; // arrived on a share link — show the brag, skip the shop
    if (/#mine\b/.test(location.hash) && ownedItems().length) activeCat = "mine"; // deep link from the bank
    renderChips();
    refresh(false);
  }

  // If the hash gains (or loses) a share payload without a full reload — e.g. a
  // same-page link — switch between the brag and shop views live.
  window.addEventListener("hashchange", function () {
    if (!DATA) return;
    var bv = $("bragView");
    if (/[#&]s=/.test(location.hash)) { maybeBragView(); }
    else if (/#mine\b/.test(location.hash)) { showMyPrizes(); }
    else if (bv && !bv.hidden) { bv.hidden = true; $("shopView").hidden = false; boot(); }
  });

  function init() {
    fetch("store-items.json?v=1")
      .then(function (r) { return r.json(); })
      .then(function (d) { DATA = d; start(); })
      .catch(function () {
        var m = $("prizeWall");
        if (m) m.innerHTML = '<p class="store-fineprint">The prize counter is momentarily closed — try a refresh.</p>';
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
