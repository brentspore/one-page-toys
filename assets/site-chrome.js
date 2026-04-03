/* Shared chrome for tool pages: skip link, top bar navigation, breadcrumb, random tool. */

(function () {
  "use strict";

  function siteRootFromPathname() {
    var path = location.pathname;
    if (/\/[^/]+\.html$/i.test(path)) {
      path = path.replace(/\/[^/]+\.html$/i, "");
    } else {
      path = path.replace(/\/$/, "");
    }
    var segs = path.split("/").filter(Boolean);
    if (!segs.length) return "./";
    return segs.map(function () {
      return "..";
    }).join("/") + "/";
  }

  function injectSkipLink() {
    if (document.querySelector(".skip-link")) return;
    var main = document.querySelector("main.container");
    if (!main) return;
    if (!main.id) main.id = "main-content";
    var a = document.createElement("a");
    a.className = "skip-link";
    a.href = "#main-content";
    a.textContent = "Skip to content";
    document.body.insertBefore(a, document.body.firstChild);
  }

  function wireSurprise(root) {
    var btn = document.getElementById("randomToolBtn");
    if (!btn || btn.dataset.chromeWired === "1") return;
    btn.dataset.chromeWired = "1";
    btn.addEventListener("click", function () {
      fetch(root + "tools-registry.json", { cache: "no-store" })
        .then(function (r) {
          if (!r.ok) throw new Error();
          return r.json();
        })
        .then(function (tools) {
          if (!Array.isArray(tools) || !tools.length) return;
          var pool = tools.filter(function (t) {
            return t && t.path;
          });
          if (!pool.length) return;
          var pick = pool[Math.floor(Math.random() * pool.length)];
          window.location.href = root + pick.path;
        })
        .catch(function () {});
    });
  }

  function enhanceToolTopbar() {
    if (!document.body.getAttribute("data-tool-slug")) return;
    var inner = document.querySelector(".topbar__inner");
    if (!inner || inner.querySelector(".topbar__start")) return;
    var brand = inner.querySelector(".brand");
    if (!brand) return;
    var root = siteRootFromPathname();

    var start = document.createElement("div");
    start.className = "topbar__start";
    inner.insertBefore(start, brand);
    start.appendChild(brand);

    var nav = document.createElement("nav");
    nav.className = "topbar__nav";
    nav.setAttribute("aria-label", "Site sections");
    var aHome = document.createElement("a");
    aHome.className = "topbar__link";
    aHome.href = root + "index.html";
    aHome.textContent = "Home";
    var aAll = document.createElement("a");
    aAll.className = "topbar__link";
    aAll.href = root + "all-tools.html";
    aAll.textContent = "All toys";
    nav.appendChild(aHome);
    nav.appendChild(aAll);
    start.appendChild(nav);

    var actions = document.createElement("div");
    actions.className = "topbar__actions";

    var shareBtn = document.createElement("button");
    shareBtn.type = "button";
    shareBtn.className = "topbar__iconbtn";
    shareBtn.id = "shareBtn";
    shareBtn.setAttribute("aria-label", "Share this toy");
    shareBtn.title = "Share";
    shareBtn.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
      '<path d="M16 8a3 3 0 1 0-2.83-4H13a3 3 0 0 0 3 4ZM6 14a3 3 0 1 0 2.83 4H9a3 3 0 0 0-3-4Zm10 1a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M8.7 16.3l6.6 3.4M15.3 8.3L8.7 11.7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      "</svg>";
    actions.appendChild(shareBtn);

    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = "randomToolBtn";
    btn.className = "btn btn--primary";
    btn.textContent = "Surprise me";
    actions.appendChild(btn);
    inner.appendChild(actions);

    wireSurprise(root);

    (function wireShare() {
      var b = shareBtn;
      if (!b || b.dataset.chromeWired === "1") return;
      b.dataset.chromeWired = "1";
      b.addEventListener("click", function () {
        var url = location.href;
        var title = (document.title || "One Page Toys").trim();
        if (navigator.share) {
          navigator
            .share({ title: title, url: url })
            .catch(function () {});
          return;
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard
            .writeText(url)
            .then(function () {
              b.classList.add("topbar__iconbtn--ok");
              b.setAttribute("aria-label", "Link copied");
              b.title = "Copied";
              setTimeout(function () {
                b.classList.remove("topbar__iconbtn--ok");
                b.setAttribute("aria-label", "Share this toy");
                b.title = "Share";
              }, 1100);
            })
            .catch(function () {});
          return;
        }
        try {
          var ta = document.createElement("textarea");
          ta.value = url;
          ta.setAttribute("readonly", "true");
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
        } catch (e) {}
      });
    })();
  }

  function injectBreadcrumb() {
    var tool = document.querySelector("section.tool");
    if (!tool || tool.querySelector(".tool-breadcrumb")) return;
    var root = siteRootFromPathname();
    var slug = document.body.getAttribute("data-tool-slug") || "";
    var isDetail = /detail\.html/i.test(location.pathname);
    var h1 = tool.querySelector("h1");
    var title =
      (h1 && h1.textContent && h1.textContent.replace(/\s+/g, " ").trim()) ||
      (document.title.split(/\s*[—–-]\s*/)[0] || "").trim() ||
      "Toy";

    var nav = document.createElement("nav");
    nav.className = "tool-breadcrumb";
    nav.setAttribute("aria-label", "Breadcrumb");
    var ol = document.createElement("ol");
    ol.className = "tool-breadcrumb__list";

    function addLink(href, label) {
      var li = document.createElement("li");
      li.className = "tool-breadcrumb__item";
      var a = document.createElement("a");
      a.className = "tool-breadcrumb__link";
      a.href = href;
      a.textContent = label;
      li.appendChild(a);
      ol.appendChild(li);
    }

    addLink(root + "index.html", "Home");
    addLink(root + "all-tools.html", "All toys");
    if (isDetail && slug) {
      addLink(root + "toys/" + slug + "/index.html", "Palette explorer");
    }

    var liCur = document.createElement("li");
    liCur.className = "tool-breadcrumb__item tool-breadcrumb__item--current";
    liCur.setAttribute("aria-current", "page");
    liCur.textContent = isDetail ? title || "Palette detail" : title;
    ol.appendChild(liCur);

    nav.appendChild(ol);
    tool.insertBefore(nav, tool.firstChild);
  }

  document.addEventListener("DOMContentLoaded", function () {
    injectSkipLink();
    enhanceToolTopbar();
    injectBreadcrumb();
  });
})();
