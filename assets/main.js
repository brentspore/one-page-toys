/* Gallery: tools-registry.json + search, tag filters, URL sync. */

function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, function (ch) {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return ch;
    }
  });
}

function badgeClassForStatus(status) {
  const s = String(status || "").toLowerCase();
  if (s === "beta") return "badge badge--beta";
  if (s === "experimental") return "badge badge--experimental";
  if (s === "live") return "badge badge--live";
  return "badge";
}

/** Stable ordering for category chips and “sort by category”. */
const CATEGORY_ORDER = ["utility", "game", "visual", "audio", "wellness"];

const CATEGORY_LABELS = {
  utility: "Utilities & dev",
  game: "Games & play",
  visual: "Visual & color",
  audio: "Audio",
  wellness: "Wellness"
};

let allTools = [];
let activeTag = "";
let activeCategory = "";
let knownTags = [];
let knownCategories = [];
let galleryMode = "all";
let homeFeatured = null;

function shuffleInPlace(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor((rand ? rand() : Math.random()) * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function normalizeHaystack(tool) {
  const cat = String(tool.category || "").toLowerCase();
  const catLabel =
    cat && CATEGORY_LABELS[cat] ? String(CATEGORY_LABELS[cat]).toLowerCase() : "";
  const parts = [
    tool.name,
    tool.shortDescription,
    tool.slug,
    tool.slug ? tool.slug.replace(/-/g, " ") : "",
    tool.status,
    cat,
    catLabel,
    Array.isArray(tool.tags) ? tool.tags.join(" ") : ""
  ];
  return parts
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function splitHayWords(hay) {
  return hay.split(/[^a-z0-9]+/).filter(function (w) {
    return w.length > 0;
  });
}

/** Substring match, or prefix match on any word (e.g. “typ” → typing). */
function tokenMatchesHaystack(tok, hay) {
  if (!tok.length) return true;
  if (hay.indexOf(tok) !== -1) return true;
  if (tok.length < 2) return false;
  const words = splitHayWords(hay);
  return words.some(function (w) {
    return w.indexOf(tok) === 0;
  });
}

function toolMatchesSearch(tool, tokens) {
  if (!tokens.length) return true;
  const hay = normalizeHaystack(tool);
  return tokens.every(function (tok) {
    return tokenMatchesHaystack(tok, hay);
  });
}

function toolMatchesTag(tool) {
  if (!activeTag) return true;
  const tags = Array.isArray(tool.tags) ? tool.tags : [];
  return tags.some(function (t) {
    return String(t).toLowerCase() === activeTag;
  });
}

function toolMatchesCategory(tool) {
  if (!activeCategory) return true;
  return String(tool.category || "").toLowerCase() === activeCategory;
}

function getSearchTokens() {
  const el = document.getElementById("toolsSearch");
  const raw = (el && el.value) || "";
  return raw
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function getFilteredTools() {
  const tokens = getSearchTokens();
  return allTools.filter(function (tool) {
    return (
      toolMatchesCategory(tool) &&
      toolMatchesTag(tool) &&
      toolMatchesSearch(tool, tokens)
    );
  });
}

function sortToolsForDisplay(tools) {
  const sortEl = document.getElementById("toolsSort");
  const sortMode = sortEl && sortEl.value === "category" ? "category" : "name";
  const slice = tools.slice();
  if (sortMode === "category") {
    slice.sort(function (a, b) {
      const ca = String(a.category || "").toLowerCase();
      const cb = String(b.category || "").toLowerCase();
      const ia = CATEGORY_ORDER.indexOf(ca);
      const ib = CATEGORY_ORDER.indexOf(cb);
      const sa = ia === -1 ? 999 : ia;
      const sb = ib === -1 ? 999 : ib;
      if (sa !== sb) return sa - sb;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
  } else {
    slice.sort(function (a, b) {
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
  }
  return slice;
}

function collectTagsFromTools(tools) {
  const set = new Set();
  tools.forEach(function (t) {
    (Array.isArray(t.tags) ? t.tags : []).forEach(function (tag) {
      set.add(String(tag).toLowerCase());
    });
  });
  return Array.from(set).sort(function (a, b) {
    return a.localeCompare(b);
  });
}

function collectCategoriesFromTools(tools) {
  const set = new Set();
  tools.forEach(function (t) {
    const c = String(t.category || "").toLowerCase();
    if (c) set.add(c);
  });
  return Array.from(set).sort(function (a, b) {
    const ia = CATEGORY_ORDER.indexOf(a);
    const ib = CATEGORY_ORDER.indexOf(b);
    const sa = ia === -1 ? 999 : ia;
    const sb = ib === -1 ? 999 : ib;
    if (sa !== sb) return sa - sb;
    return a.localeCompare(b);
  });
}

function formatTagLabel(tag) {
  return tag.charAt(0).toUpperCase() + tag.slice(1);
}

function syncURL() {
  const qEl = document.getElementById("toolsSearch");
  const q = (qEl && qEl.value.trim()) || "";
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (activeTag) params.set("tag", activeTag);
  if (activeCategory) params.set("cat", activeCategory);
  const sortEl = document.getElementById("toolsSort");
  if (sortEl && sortEl.value === "category") params.set("sort", "category");
  const qs = params.toString();
  const path = location.pathname;
  const hash = location.hash || "";
  const next = qs ? path + "?" + qs + hash : path + hash;
  if (next !== path + location.search + hash) {
    history.replaceState(null, "", next);
  }
}

function readFiltersFromURL() {
  let q = "";
  let tag = "";
  let cat = "";
  let sort = "";
  try {
    const p = new URLSearchParams(location.search);
    q = p.get("q") || "";
    tag = (p.get("tag") || "").toLowerCase().trim();
    cat = (p.get("cat") || "").toLowerCase().trim();
    sort = (p.get("sort") || "").toLowerCase().trim();
  } catch (e) {
    /* ignore */
  }
  return { q, tag, cat, sort };
}

function renderTagChips() {
  const wrap = document.getElementById("toolsTags");
  if (!wrap) return;
  wrap.innerHTML = "";

  function addChip(label, value, pressed) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tools-tag";
    btn.textContent = label;
    btn.setAttribute("data-tag", value);
    btn.setAttribute("aria-pressed", pressed ? "true" : "false");
    btn.addEventListener("click", function () {
      activeTag = value;
      renderTagChips();
      applyFilters();
    });
    wrap.appendChild(btn);
  }

  addChip("All", "", activeTag === "");
  knownTags.forEach(function (t) {
    addChip(formatTagLabel(t), t, activeTag === t);
  });
}

function renderCategoryChips() {
  const wrap = document.getElementById("toolsCategories");
  if (!wrap) return;
  wrap.innerHTML = "";

  function addChip(label, value, pressed) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tools-tag tools-tag--category";
    btn.textContent = label;
    btn.setAttribute("data-category", value);
    btn.setAttribute("aria-pressed", pressed ? "true" : "false");
    btn.addEventListener("click", function () {
      activeCategory = value;
      renderCategoryChips();
      applyFilters();
    });
    wrap.appendChild(btn);
  }

  addChip("All categories", "", activeCategory === "");
  knownCategories.forEach(function (c) {
    const label = CATEGORY_LABELS[c] || formatTagLabel(c);
    addChip(label, c, activeCategory === c);
  });
}

function updateClearButton() {
  const btn = document.getElementById("toolsClearFilters");
  const qEl = document.getElementById("toolsSearch");
  if (!btn || !qEl) return;
  const hasQ = qEl.value.trim().length > 0;
  const hasTag = activeTag.length > 0;
  const hasCat = activeCategory.length > 0;
  btn.hidden = !hasQ && !hasTag && !hasCat;
}

function updateMeta(filteredCount, total) {
  const meta = document.getElementById("toolsMeta");
  if (!meta) return;
  const tokens = getSearchTokens();
  const filtered =
    filteredCount !== total || tokens.length > 0 || activeTag || activeCategory;
  if (total === 0) {
    meta.textContent = "No toys yet";
    return;
  }
  if (filtered) {
    meta.textContent =
      filteredCount === total
        ? "Showing all " + total
        : "Showing " + filteredCount + " of " + total;
  } else {
    meta.textContent = total === 1 ? "1 toy" : total + " toys";
  }
}

function renderCards(tools) {
  const grid = document.getElementById("toolsGrid");
  const errorEl = document.getElementById("toolsError");
  const emptyEl = document.getElementById("toolsEmpty");

  if (!grid) return;
  grid.innerHTML = "";

  if (emptyEl) {
    emptyEl.hidden = tools.length > 0;
  }

  const total = allTools.length;
  updateMeta(tools.length, total);

  if (!tools.length) {
    if (errorEl) errorEl.hidden = true;
    return;
  }

  for (const tool of tools) {
    const card = document.createElement("a");
    card.className = "card";
    card.href = tool.path || "#";

    const cardTop = document.createElement("div");
    cardTop.className = "card__top";

    const h3Wrap = document.createElement("div");
    h3Wrap.className = "card__title-stack";
    const h3 = document.createElement("h3");
    h3.textContent = tool.name || tool.slug || "Untitled";
    h3Wrap.appendChild(h3);

    const catKey = String(tool.category || "").toLowerCase();
    if (catKey && CATEGORY_LABELS[catKey]) {
      const catLine = document.createElement("p");
      catLine.className = "card__category";
      catLine.textContent = CATEGORY_LABELS[catKey];
      h3Wrap.appendChild(catLine);
    }

    const status = document.createElement("span");
    status.className = badgeClassForStatus(tool.status);
    status.textContent = String(tool.status || "experimental");

    cardTop.appendChild(h3Wrap);
    cardTop.appendChild(status);

    const desc = document.createElement("p");
    desc.textContent = tool.shortDescription || "";

    const tagsEl = document.createElement("div");
    tagsEl.className = "tags";
    const tags = Array.isArray(tool.tags) ? tool.tags : [];
    for (const tag of tags) {
      const chip = document.createElement("span");
      chip.className = "tag";
      chip.textContent = tag;
      tagsEl.appendChild(chip);
    }

    const cta = document.createElement("span");
    cta.className = "card__cta";
    cta.textContent = "Open";

    card.appendChild(cardTop);
    card.appendChild(desc);
    card.appendChild(tagsEl);
    card.appendChild(cta);

    if (!tool.path) card.href = "#";
    if (tool.path) card.rel = "noopener";

    grid.appendChild(card);
  }

  if (errorEl) errorEl.hidden = true;
}

function applyFilters() {
  if (galleryMode === "home") {
    if (!homeFeatured) {
      const pool = allTools.filter(function (t) {
        return t && t.path;
      });
      const shuffled = shuffleInPlace(pool.slice(), Math.random);
      homeFeatured = shuffled.slice(0, 9);
    }
    renderCards(homeFeatured);
    updateClearButton();
    return;
  }

  const filtered = sortToolsForDisplay(getFilteredTools());
  renderCards(filtered);
  updateClearButton();
  syncURL();
}

function validateActiveTag() {
  if (!activeTag) return;
  if (knownTags.indexOf(activeTag) === -1) activeTag = "";
}

function validateActiveCategory() {
  if (!activeCategory) return;
  if (knownCategories.indexOf(activeCategory) === -1) activeCategory = "";
}

function wireRandomButton() {
  const randomBtn = document.getElementById("randomToolBtn");
  if (!randomBtn) return;
  randomBtn.addEventListener("click", function () {
    const filtered = getFilteredTools().filter(function (t) {
      return t && t.path;
    });
    const pool = filtered.length ? filtered : allTools.filter(function (t) {
      return t && t.path;
    });
    if (!pool.length) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    window.location.href = pick.path;
  });
}

function wireSearchAndFilters() {
  const searchEl = document.getElementById("toolsSearch");
  const clearBtn = document.getElementById("toolsClearFilters");

  if (searchEl) {
    searchEl.addEventListener("input", function () {
      applyFilters();
    });
    searchEl.addEventListener("search", function () {
      applyFilters();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      if (searchEl) searchEl.value = "";
      activeTag = "";
      activeCategory = "";
      const sortEl = document.getElementById("toolsSort");
      if (sortEl) sortEl.value = "name";
      renderTagChips();
      renderCategoryChips();
      applyFilters();
      if (searchEl) searchEl.focus();
    });
  }

  const sortEl = document.getElementById("toolsSort");
  if (sortEl) {
    sortEl.addEventListener("change", function () {
      applyFilters();
    });
  }
}

async function loadRegistryAndRender() {
  const errorEl = document.getElementById("toolsError");
  const grid = document.getElementById("toolsGrid");

  if (!grid) return;

  try {
    const modeAttr = document.body && document.body.getAttribute("data-gallery-mode");
    galleryMode = modeAttr === "home" ? "home" : "all";
    homeFeatured = null;

    const res = await fetch(new URL("tools-registry.json", location.href).toString(), { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to load registry (" + res.status + ")");
    const tools = await res.json();

    if (!Array.isArray(tools)) {
      throw new Error("tools-registry.json must export an array of tools");
    }

    allTools = tools.slice().sort(function (a, b) {
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
    knownTags = collectTagsFromTools(allTools);
    knownCategories = collectCategoriesFromTools(allTools);

    const urlState = readFiltersFromURL();
    const searchEl = document.getElementById("toolsSearch");
    if (galleryMode === "home") {
      if (searchEl) searchEl.value = "";
      activeTag = "";
      activeCategory = "";
    } else {
      if (searchEl) searchEl.value = urlState.q;
      activeTag = urlState.tag;
      activeCategory = urlState.cat;
      const sortEl = document.getElementById("toolsSort");
      if (sortEl) {
        sortEl.value = urlState.sort === "category" ? "category" : "name";
      }
    }
    validateActiveTag();
    validateActiveCategory();

    renderTagChips();
    renderCategoryChips();
    wireSearchAndFilters();
    wireRandomButton();
    applyFilters();
  } catch (err) {
    if (errorEl) {
      errorEl.hidden = false;
      errorEl.textContent = err && err.message ? err.message : "Could not load tools registry";
    }
  }
}

document.addEventListener("DOMContentLoaded", function () {
  loadRegistryAndRender();
});
