/* Renders "Related tools" from tools-registry.json using body[data-tool-slug]. */

(function () {
  /** Relative href from current page to registry path (e.g. tools/foo/index.html). */
  function hrefToRegistryPath(registryPath) {
    var parts = location.pathname.split("/").filter(Boolean);
    var depth = 0;
    if (parts.length && /\.html$/i.test(parts[parts.length - 1])) {
      depth = parts.length - 1;
    } else {
      depth = parts.length;
    }
    var up = depth ? new Array(depth).fill("..").join("/") + "/" : "";
    return up + registryPath;
  }

  var CATEGORY_LABELS = {
    utility: "Tools",
    game: "Games & play",
    visual: "Visual & color",
    audio: "Audio",
    wellness: "Wellness"
  };

  document.addEventListener("DOMContentLoaded", function () {
    var root = document.getElementById("toolCrossRoot");
    var slug = document.body && document.body.getAttribute("data-tool-slug");
    if (!root || !slug) return;

    fetch("../../tools-registry.json", { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("registry");
        return r.json();
      })
      .then(function (list) {
        if (!Array.isArray(list)) return;
        var bySlug = {};
        list.forEach(function (t) {
          if (t && t.slug) bySlug[t.slug] = t;
        });
        var current = bySlug[slug];
        if (!current || !Array.isArray(current.related) || !current.related.length) return;

        var items = current.related
          .map(function (s) {
            return bySlug[s];
          })
          .filter(function (t) {
            return t && t.path && t.slug !== slug;
          });
        if (!items.length) return;

        var section = document.createElement("section");
        section.className = "tool-cross panel";
        section.setAttribute("aria-labelledby", "toolCrossHeading");

        var h2 = document.createElement("h2");
        h2.id = "toolCrossHeading";
        h2.className = "tool-cross__title";
        h2.textContent = "Related tools & toys";
        section.appendChild(h2);

        var ul = document.createElement("ul");
        ul.className = "tool-cross__list";

        items.forEach(function (t) {
          var li = document.createElement("li");
          var a = document.createElement("a");
          a.className = "tool-cross__link";
          a.href = hrefToRegistryPath(t.path);

          var name = document.createElement("span");
          name.className = "tool-cross__name";
          name.textContent = t.name || t.slug;

          var desc = document.createElement("span");
          desc.className = "tool-cross__desc";
          desc.textContent = t.shortDescription || "";

          a.appendChild(name);
          if (desc.textContent) a.appendChild(desc);
          li.appendChild(a);
          ul.appendChild(li);
        });

        section.appendChild(ul);

        var more = document.createElement("p");
        more.className = "tool-cross__more";

        var cat = current.category && String(current.category).toLowerCase();
        if (cat && CATEGORY_LABELS[cat]) {
          var catA = document.createElement("a");
          catA.href = "../../all-tools.html?cat=" + encodeURIComponent(cat);
          catA.textContent = "More in " + CATEGORY_LABELS[cat];
          more.appendChild(catA);
          more.appendChild(document.createTextNode(" · "));
        }

        var ga = document.createElement("a");
        ga.href = "../../all-tools.html";
        ga.textContent = "Browse all tools";
        more.appendChild(ga);

        section.appendChild(more);

        root.appendChild(section);
      })
      .catch(function () {
        /* silent: optional enhancement */
      });
  });
})();
