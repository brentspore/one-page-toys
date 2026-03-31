/* Renders the gallery cards from tools-registry.json (same-origin fetch). */

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

function renderCards(tools) {
  const grid = document.getElementById("toolsGrid");
  const meta = document.getElementById("toolsMeta");
  const errorEl = document.getElementById("toolsError");

  if (!grid) return;
  grid.innerHTML = "";

  if (meta) meta.textContent = tools.length ? `Showing ${tools.length} toys` : "No toys yet";

  if (!tools.length) return;

  for (const tool of tools) {
    const card = document.createElement("a");
    card.className = "card";
    card.href = tool.path || "#";

    const cardTop = document.createElement("div");
    cardTop.className = "card__top";

    const h3Wrap = document.createElement("div");
    const h3 = document.createElement("h3");
    h3.textContent = tool.name || tool.slug || "Untitled";
    h3Wrap.appendChild(h3);

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

    card.appendChild(cardTop);
    card.appendChild(desc);
    card.appendChild(tagsEl);

    // Keep cards accessible; prevent empty href from stealing focus.
    if (!tool.path) card.href = "#";
    if (tool.path) card.rel = "noopener";

    grid.appendChild(card);
  }

  if (errorEl) errorEl.hidden = true;
}

async function loadRegistryAndRender() {
  const errorEl = document.getElementById("toolsError");
  const grid = document.getElementById("toolsGrid");

  if (!grid) return;

  try {
    const res = await fetch("tools-registry.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load registry (${res.status})`);
    const tools = await res.json();

    if (!Array.isArray(tools)) {
      throw new Error("tools-registry.json must export an array of tools");
    }

    // Sort stable by name for predictable browsing.
    const sorted = tools.slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    renderCards(sorted);

    const randomBtn = document.getElementById("randomToolBtn");
    if (randomBtn) {
      randomBtn.addEventListener("click", () => {
        const list = sorted.filter((t) => t && t.path);
        if (!list.length) return;
        const pick = list[Math.floor(Math.random() * list.length)];
        window.location.href = pick.path;
      });
    }
  } catch (err) {
    if (errorEl) {
      errorEl.hidden = false;
      errorEl.textContent = err && err.message ? err.message : "Could not load tools registry";
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadRegistryAndRender();
});

