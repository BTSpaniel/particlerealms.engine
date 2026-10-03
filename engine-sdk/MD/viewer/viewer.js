/* SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
 * SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
 *
 * WebGPU OS Docs — zero-build SPA viewer.
 * Reads the same Markdown tree consumed by MkDocs and the OS `docs` app.
 * No build step: open via start_server.py and browse to /MD/viewer/.
 *
 * Part of the WebGPU OS stack.
 * Author: Jake Wehmeier (BTSpaniel) — https://github.com/BTSpaniel
 */
(function () {
  "use strict";

  var runtimeScript = document.currentScript;
  var runtimeConfig = runtimeScript ? runtimeScript.dataset : {};
  var DOC_ROOT = (runtimeConfig.docRoot || "../").replace(/\/?$/, "/");
  var DEFAULT_DOC = runtimeConfig.defaultDoc || "";
  var DEFAULT_KIND = runtimeConfig.defaultKind || "";
  var PORTAL_CANONICAL = runtimeConfig.portalCanonical || "";
  var PLATFORM_REPOSITORY = runtimeConfig.platformRepository || "";
  var MASTER_SERVER_REPOSITORY = runtimeConfig.masterServerRepository || "";
  var INLINE_MODE = runtimeConfig.inline === "true";
  var NAV_URL = DOC_ROOT + "_config/nav.json";
  var SEARCH_URL = DOC_ROOT + "_config/search-index.json";
  var GIT_DATES_URL = DOC_ROOT + "_config/git-dates.json";
  var BUNDLE_URL = DOC_ROOT + "_config/docs-bundle.json.gz";

  var state = {
    nav: null, flat: [], allItems: [], groups: [], open: {},
    current: null, searchIndex: null, gitDates: {}, lastMeta: {}, lastMarkdown: "",
    sourceBlobUrl: "", bundle: null, tocObserver: null, mermaidPromise: null,
    searchTimer: 0, navTimer: 0, sbTimer: 0, srActive: -1
  };

  var el = {
    tree: document.getElementById("nav-tree"),
    content: document.getElementById("doc-content"),
    toc: document.getElementById("toc-list"),
    tocWrap: document.getElementById("toc"),
    prev: document.getElementById("prev-link"),
    next: document.getElementById("next-link"),
    source: document.getElementById("source-path"),
    search: document.getElementById("search-input"),
    searchResults: document.getElementById("search-results"),
    sidebar: document.getElementById("sidebar"),
    sidebarToggle: document.getElementById("sidebar-toggle"),
    version: document.getElementById("version-badge"),
    navFilter: document.getElementById("nav-filter"),
    collapseAll: document.getElementById("nav-collapse-all"),
    breadcrumbs: document.getElementById("breadcrumbs"),
    progress: document.getElementById("read-progress"),
    backTop: document.getElementById("back-to-top"),
    backdrop: document.getElementById("nav-backdrop")
  };

  // Page transition engine for internal doc navigation.
  var pt = null;
  import('../../plauna/motion/PageTransition.js').then(function (mod) {
    pt = new mod.PageTransition({
      target: el.content,
      // Animate only this article. Native transitions reserve `root` for html;
      // assigning it to the article too would duplicate that transition name.
      fallback: 'only',
      type: 'slide-left',
      duration: 250,
      reducedMotion: true
    });
  });

  /* ----------------------------- utilities ----------------------------- */
  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function slugify(s) {
    return String(s).toLowerCase().trim()
      .replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-");
  }
  function absoluteDocUrl(path) {
    return new URL(DOC_ROOT + path, window.location.href).href;
  }
  function normalizeDocPath(path) {
    try { path = decodeURIComponent(String(path || "")); } catch (e) { return ""; }
    if (!path || path.charAt(0) === "/" || path.indexOf("\\") !== -1 || !/\.md$/i.test(path)) return "";
    var segments = path.split("/");
    if (segments.some(function (part) { return !part || part === "." || part === ".."; })) return "";
    return path;
  }
  function isGeneratedReferencePath(path) {
    return /(?:^|\/)reference\/.+\.md$/i.test(path);
  }
  function isBundledOnlyPath(path) {
    return isGeneratedReferencePath(path) || path === "README.md" || /^archive\/appforge\/.+\.md$/i.test(path);
  }
  function viewerDocUrl(path) {
    var url = new URL(DOC_ROOT + "viewer/", window.location.href);
    url.searchParams.set("doc", path);
    return url.href;
  }
  function updateDocumentMetadata(path, meta, title) {
    var rawUrl = absoluteDocUrl(path);
    var generatedReference = isGeneratedReferencePath(path);
    var canonicalUrl = generatedReference ? viewerDocUrl(path) : rawUrl;
    if (PORTAL_CANONICAL && DEFAULT_DOC && path === DEFAULT_DOC) {
      canonicalUrl = new URL(PORTAL_CANONICAL, window.location.href).href;
    }
    var canonical = document.getElementById("canonical-link");
    var alternate = document.getElementById("markdown-alternate");
    var description = document.querySelector('meta[name="description"]');
    if (canonical) canonical.setAttribute("href", canonicalUrl);
    if (alternate) {
      alternate.setAttribute(
        "href",
        generatedReference ? new URL("../../api-index.json", window.location.href).href : rawUrl
      );
      alternate.setAttribute("type", generatedReference ? "application/json" : "text/markdown");
      alternate.setAttribute(
        "title",
        generatedReference ? "Machine API catalog" : "Current page as Markdown"
      );
    }
    if (description) {
      description.setAttribute(
        "content",
        meta.description || (title ? title + " — WebGPU OS documentation." : "WebGPU OS documentation.")
      );
    }
    var effectiveKind = meta.kind || (path === DEFAULT_DOC ? DEFAULT_KIND : "") || "guide";
    document.documentElement.setAttribute("data-doc-kind", effectiveKind);

    var structured = document.getElementById("page-structured-data");
    if (!structured) return;
    var article = {
      "@type": effectiveKind === "reference" ? "APIReference" : "TechArticle",
      headline: title || meta.title || path,
      description: meta.description || "Source-backed WebGPU OS documentation.",
      url: canonicalUrl,
      inLanguage: "en",
      author: { "@type": "Person", name: "Jake Wehmeier" },
      isPartOf: {
        "@type": "WebSite",
        name: "WebGPU OS Documentation",
        url: absoluteDocUrl("index.md")
      }
    };
    var mentions = [];
    if (PLATFORM_REPOSITORY) mentions.push({ "@id": PLATFORM_REPOSITORY + "#distribution" });
    if (MASTER_SERVER_REPOSITORY) mentions.push({ "@id": MASTER_SERVER_REPOSITORY + "#service" });
    if (mentions.length) article.mentions = mentions.length === 1 ? mentions[0] : mentions;
    if (meta.updated) article.dateModified = meta.updated;
    var crumbs = [{
      "@type": "ListItem", position: 1, name: "Documentation",
      item: absoluteDocUrl("index.md")
    }];
    if (path !== "index.md") {
      crumbs.push({ "@type": "ListItem", position: 2, name: title || path, item: canonicalUrl });
    }
    var graph = [article, { "@type": "BreadcrumbList", itemListElement: crumbs }];
    if (PLATFORM_REPOSITORY) {
      graph.push({
        "@type": "SoftwareApplication",
        "@id": PLATFORM_REPOSITORY + "#distribution",
        name: "WebGPU OS platform downloads",
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Any browser with WebGPU support",
        downloadUrl: PLATFORM_REPOSITORY
      });
    }
    if (MASTER_SERVER_REPOSITORY) {
      graph.push({
        "@type": "SoftwareSourceCode",
        "@id": MASTER_SERVER_REPOSITORY + "#service",
        name: "Particle Realms master server",
        description: "Separate discovery, admission, encrypted signaling, TURN, and trusted-node service. It is never gameplay authority.",
        codeRepository: MASTER_SERVER_REPOSITORY,
        additionalProperty: {
          "@type": "PropertyValue",
          name: "Gameplay authority",
          value: false
        }
      });
    }
    structured.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@graph": graph
    });
  }
  // Resolve a markdown-relative href against the current document path.
  function resolvePath(currentPath, href) {
    try {
      var base = new URL(currentPath, "doc://root/");
      var resolved = new URL(href, base);
      return resolved.pathname.replace(/^\//, "");
    } catch (e) { return href; }
  }

  /* --------------------------- fallback markdown ------------------------ */
  // Minimal CommonMark-ish parser used only when vendored marked.js is absent.
  function fallbackMarkdown(md) {
    var out = [], lines = md.replace(/\r\n/g, "\n").split("\n");
    var i = 0, inList = false, listType = "ul";
    function inline(t) {
      t = escapeHtml(t);
      t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
      t = t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">');
      t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
      t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      t = t.replace(/\*([^*]+)\*/g, "<em>$1</em>");
      return t;
    }
    function closeList() { if (inList) { out.push("</" + listType + ">"); inList = false; } }
    while (i < lines.length) {
      var line = lines[i];
      if (/^```/.test(line)) {
        var lang = line.replace(/^```/, "").trim(), buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        closeList();
        out.push('<pre><code class="language-' + escapeHtml(lang) + '">' + escapeHtml(buf.join("\n")) + "</code></pre>");
        continue;
      }
      // GFM table: a row containing pipes followed by a |---|---| separator.
      if (line.indexOf("|") !== -1 && i + 1 < lines.length &&
          /^\s*\|?[ \t]*:?-{1,}:?[ \t]*(\|[ \t]*:?-{1,}:?[ \t]*)*\|?\s*$/.test(lines[i + 1])) {
        closeList();
        var splitRow = function (row) {
          var r = row.trim().replace(/^\|/, "").replace(/\|$/, "");
          return r.split(/(?<!\\)\|/).map(function (c) { return inline(c.trim().replace(/\\\|/g, "|")); });
        };
        var thead = splitRow(line);
        i += 2;
        var tbody = [];
        while (i < lines.length && lines[i].indexOf("|") !== -1 && lines[i].trim() !== "") {
          tbody.push(splitRow(lines[i])); i++;
        }
        var tbl = "<table><thead><tr>";
        thead.forEach(function (c) { tbl += "<th>" + c + "</th>"; });
        tbl += "</tr></thead><tbody>";
        tbody.forEach(function (cs) {
          tbl += "<tr>";
          cs.forEach(function (c) { tbl += "<td>" + c + "</td>"; });
          tbl += "</tr>";
        });
        out.push(tbl + "</tbody></table>");
        continue;
      }
      var h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) { closeList(); var lvl = h[1].length; out.push("<h" + lvl + ">" + inline(h[2]) + "</h" + lvl + ">"); i++; continue; }
      if (/^\s*[-*]\s+/.test(line)) {
        if (!inList) { inList = true; listType = "ul"; out.push("<ul>"); }
        out.push("<li>" + inline(line.replace(/^\s*[-*]\s+/, "")) + "</li>"); i++; continue;
      }
      if (/^\s*\d+\.\s+/.test(line)) {
        if (!inList) { inList = true; listType = "ol"; out.push("<ol>"); }
        out.push("<li>" + inline(line.replace(/^\s*\d+\.\s+/, "")) + "</li>"); i++; continue;
      }
      if (/^>\s?/.test(line)) { closeList(); out.push("<blockquote>" + inline(line.replace(/^>\s?/, "")) + "</blockquote>"); i++; continue; }
      if (/^(\s*---\s*)$/.test(line)) { closeList(); out.push("<hr>"); i++; continue; }
      if (line.trim() === "") { closeList(); i++; continue; }
      closeList(); out.push("<p>" + inline(line) + "</p>"); i++;
    }
    closeList();
    return out.join("\n");
  }

  function renderMarkdown(md) {
    if (window.marked) {
      if (window.marked.parse) return window.marked.parse(md, { mangle: false, headerIds: false });
      return window.marked(md);
    }
    return fallbackMarkdown(md);
  }

  // Strip and parse a leading YAML frontmatter block (--- ... ---).
  function parseFrontmatter(md) {
    var m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
    if (!m) return { meta: {}, body: md };
    var meta = {};
    m[1].split(/\r?\n/).forEach(function (line) {
      var i = line.indexOf(":");
      if (i > 0) {
        var k = line.slice(0, i).trim();
        var v = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
        if (k) meta[k] = v;
      }
    });
    return { meta: meta, body: md.slice(m[0].length) };
  }

  /* --------------------------- data source ----------------------------- */
  // A deployed site ships ONE gzipped bundle (docs-bundle.json.gz) holding the
  // nav, search index, git-dates, every page, and the reference indexes, so it
  // can stay under static-host file-count caps (e.g. Cloudflare Pages = 1000).
  // The viewer gunzips it in-browser; when it is absent (dev, serving the raw
  // MD/ tree) it falls back to per-file fetch. Decompress via DecompressionStream.
  function gunzipJSON(resp) {
    if (typeof DecompressionStream === "function" && resp.body) {
      var stream = resp.body.pipeThrough(new DecompressionStream("gzip"));
      return new Response(stream).text().then(function (t) { return JSON.parse(t); });
    }
    return resp.json(); // host already decompressed (Content-Encoding: gzip)
  }
  function loadBundle() {
    return fetch(BUNDLE_URL).then(function (r) {
      if (!r.ok) throw new Error("no bundle");
      return gunzipJSON(r);
    }).then(function (b) {
      state.bundle = b;
      if (b && b.gitDates) state.gitDates = b.gitDates;
      if (b && b.search) state.searchIndex = b.search;
    }).catch(function () { state.bundle = null; });
  }
  function getDoc(path) {
    path = normalizeDocPath(path);
    if (!path) return Promise.reject(new Error("Unsafe or invalid documentation path"));
    var docs = state.bundle && state.bundle.docs;
    if (docs && Object.prototype.hasOwnProperty.call(docs, path)) {
      return Promise.resolve(docs[path]);
    }
    return fetch(DOC_ROOT + path).then(function (r) {
      if (!r.ok) throw new Error(r.status + " " + r.statusText);
      return r.text();
    });
  }
  function getRefIndex(auto) {
    var ri = state.bundle && state.bundle.refIndex;
    if (ri && ri[auto]) return Promise.resolve(ri[auto]);
    return fetch(DOC_ROOT + auto + "/_index.json").then(function (r) { return r.ok ? r.json() : null; });
  }

  /* ------------------------------- nav --------------------------------- */
  function flattenNav(nav) {
    var flat = [];
    nav.sections.forEach(function (sec) {
      (sec.items || []).forEach(function (it) {
        flat.push({ title: it.title, path: it.path, section: sec.title });
        state.allItems.push({ title: it.title, path: it.path, section: sec.title });
      });
    });
    return flat;
  }

  /* ---- persisted open/closed state (localStorage) ---- */
  function loadOpenState() {
    try { state.open = JSON.parse(localStorage.getItem("wgpu-docs-open") || "{}") || {}; }
    catch (e) { state.open = {}; }
  }
  function saveOpenState() {
    try { localStorage.setItem("wgpu-docs-open", JSON.stringify(state.open)); } catch (e) {}
  }
  function isOpen(key, def) {
    return Object.prototype.hasOwnProperty.call(state.open, key) ? !!state.open[key] : def;
  }
  function setOpen(key, val) { state.open[key] = !!val; saveOpenState(); }

  function buildSidebar(nav) {
    el.tree.innerHTML = "";
    state.groups = [];
    nav.sections.forEach(function (sec) {
      var section = document.createElement("div");
      section.className = "nav-section";
      var secKey = "sec:" + sec.title;
      if (!isOpen(secKey, true)) section.classList.add("collapsed");

      var btn = document.createElement("button");
      btn.className = "nav-section-title";
      btn.type = "button";
      btn.innerHTML = escapeHtml(sec.title) + '<span class="chevron">&#9662;</span>';
      btn.setAttribute("aria-expanded", String(!section.classList.contains("collapsed")));
      btn.addEventListener("click", function () {
        var collapsed = section.classList.toggle("collapsed");
        btn.setAttribute("aria-expanded", String(!collapsed));
        setOpen(secKey, !collapsed);
      });
      section.appendChild(btn);

      var ul = document.createElement("ul");
      ul.className = "nav-items";
      (sec.items || []).forEach(function (it) { ul.appendChild(navLink(it.title, it.path, 0)); });
      section.appendChild(ul);

      (sec.groups || []).forEach(function (grp) { section.appendChild(buildAutoGroup(grp)); });

      el.tree.appendChild(section);
    });
  }

  function navLink(title, path, depth) {
    var li = document.createElement("li");
    var a = document.createElement("a");
    a.href = "#/" + path;
    a.textContent = title;
    a.setAttribute("data-path", path);
    if (depth) a.style.paddingLeft = (10 + depth * 13) + "px";
    li.appendChild(a);
    return li;
  }

  // A reference group becomes a top-level collapsible folder, filled lazily on open.
  function buildAutoGroup(grp) {
    var wrap = document.createElement("ul");
    wrap.className = "nav-items";
    var li = document.createElement("li");
    li.className = "nav-folder collapsed";

    var title = document.createElement("button");
    title.type = "button";
    title.className = "nav-folder-title";
    title.style.paddingLeft = "8px";
    title.innerHTML = '<span class="fchev">&#9662;</span><span class="ficon">&#128218;</span>' +
      '<span class="fname">' + escapeHtml(grp.title) + '</span><span class="fcount">\u2026</span>';

    var items = document.createElement("ul");
    items.className = "nav-folder-items";

    var groupKey = "grp:" + grp.auto;
    var entry = { dir: grp.auto, li: li, itemsUl: items, node: null, loaded: false };
    state.groups.push(entry);

    title.setAttribute("aria-expanded", "false");
    title.addEventListener("click", function () {
      var collapsed = li.classList.toggle("collapsed");
      title.setAttribute("aria-expanded", String(!collapsed));
      setOpen(groupKey, !collapsed);
      if (!collapsed) ensureGroupLoaded(entry);
    });

    li.appendChild(title);
    li.appendChild(items);
    wrap.appendChild(li);

    getRefIndex(grp.auto)
      .then(function (list) {
        var count = li.querySelector(".fcount");
        if (!list || !list.length) {
          if (count) count.textContent = "0";
          title.title = "Run tools/extract_api.py to generate the API reference.";
          return;
        }
        entry.list = list;
        entry.node = buildTree(list);
        if (count) count.textContent = String(list.length);
        list.forEach(function (it) {
          state.flat.push({ title: it.title, path: it.path, section: grp.auto });
          state.allItems.push({ title: it.title, path: it.path, section: grp.title });
        });
        if (isOpen(groupKey, false)) { li.classList.remove("collapsed"); ensureGroupLoaded(entry); }
        if (state.current && state.current.indexOf(grp.auto + "/") === 0) revealActive();
        highlightActive();
      })
      .catch(function () { var c = li.querySelector(".fcount"); if (c) c.textContent = "!"; });

    return wrap;
  }

  function ensureGroupLoaded(entry) {
    if (entry.loaded || !entry.node) return;
    renderTreeInto(entry.node, entry.itemsUl, 1, entry.dir + ":");
    entry.loaded = true;
  }

  // Build a nested folder tree from [{title:"core/gpu/X", path:"..."}].
  function buildTree(list) {
    var root = { folders: {}, files: [], count: 0 };
    list.forEach(function (it) {
      var parts = it.title.split("/");
      var node = root;
      for (var i = 0; i < parts.length - 1; i++) {
        var seg = parts[i];
        if (!node.folders[seg]) node.folders[seg] = { name: seg, folders: {}, files: [], count: 0 };
        node = node.folders[seg];
      }
      node.files.push({ name: parts[parts.length - 1], path: it.path });
    });
    countTree(root);
    return root;
  }
  function countTree(node) {
    var c = node.files.length;
    Object.keys(node.folders).forEach(function (k) { c += countTree(node.folders[k]); });
    node.count = c; return c;
  }

  function renderTreeInto(node, container, depth, keyPrefix) {
    Object.keys(node.folders).sort().forEach(function (name) {
      var folder = node.folders[name];
      var key = keyPrefix + name;
      var li = document.createElement("li");
      li.className = "nav-folder collapsed";
      li.setAttribute("data-fname", name);

      var title = document.createElement("button");
      title.type = "button";
      title.className = "nav-folder-title";
      title.style.paddingLeft = (8 + depth * 13) + "px";
      title.innerHTML = '<span class="fchev">&#9662;</span><span class="ficon">&#128193;</span>' +
        '<span class="fname">' + escapeHtml(name) + '</span><span class="fcount">' + folder.count + '</span>';

      var items = document.createElement("ul");
      items.className = "nav-folder-items";

      li._items = items; li._key = key; li._rendered = false;
      li._keyPrefix = keyPrefix + name + "/";
      li._render = function () {
        if (li._rendered) return;
        renderTreeInto(folder, items, depth + 1, li._keyPrefix);
        li._rendered = true;
      };

      if (isOpen(key, false)) { li.classList.remove("collapsed"); li._render(); }
      title.setAttribute("aria-expanded", String(!li.classList.contains("collapsed")));

      title.addEventListener("click", function () {
        var collapsed = li.classList.toggle("collapsed");
        title.setAttribute("aria-expanded", String(!collapsed));
        setOpen(key, !collapsed);
        if (!collapsed) li._render();
      });

      li.appendChild(title); li.appendChild(items);
      container.appendChild(li);
    });
    node.files.sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (f) {
      container.appendChild(navLink(f.name, f.path, depth));
    });
  }

  function highlightActive() {
    var links = el.tree.querySelectorAll("a[data-path]");
    links.forEach(function (a) {
      var on = a.getAttribute("data-path") === state.current;
      a.classList.toggle("active", on);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
  }

  function cssEscape(s) { return String(s).replace(/[\"\\]/g, "\\$&"); }
  function childFolder(ul, name) {
    var kids = ul.children;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].classList && kids[i].classList.contains("nav-folder") &&
          kids[i].getAttribute("data-fname") === name) return kids[i];
    }
    return null;
  }

  // Expand ancestor folders so the active reference page is visible, then scroll to it.
  function revealActive() {
    var path = state.current;
    if (!path) return;
    for (var i = 0; i < state.groups.length; i++) {
      var g = state.groups[i];
      if (g.node && path.indexOf(g.dir + "/") === 0) {
        g.li.classList.remove("collapsed");
        setOpen("grp:" + g.dir, true);
        ensureGroupLoaded(g);
        var rel = path.slice(g.dir.length + 1).replace(/\.md$/, "");
        var segs = rel.split("/");
        var ul = g.itemsUl;
        for (var s = 0; s < segs.length - 1; s++) {
          var folderLi = childFolder(ul, segs[s]);
          if (!folderLi) break;
          folderLi.classList.remove("collapsed");
          if (folderLi._render) folderLi._render();
          setOpen(folderLi._key, true);
          ul = folderLi._items;
        }
        break;
      }
    }
    var active = el.tree.querySelector('a[data-path="' + cssEscape(path) + '"]');
    highlightActive();
    if (active) active.scrollIntoView({ block: "nearest" });
  }

  /* ---- sidebar filter ---- */
  function hlMatch(text, q) {
    var i = text.toLowerCase().indexOf(q);
    if (i === -1) return escapeHtml(text);
    return escapeHtml(text.slice(0, i)) +
      '<mark class="nav-hl">' + escapeHtml(text.slice(i, i + q.length)) + "</mark>" +
      escapeHtml(text.slice(i + q.length));
  }
  function clearNavFilter() {
    if (el.navFilter) el.navFilter.value = "";
    var existing = document.getElementById("nav-filter-results");
    if (existing) existing.remove();
    el.tree.style.display = "";
  }
  function runNavFilter(raw) {
    var q = (raw || "").trim().toLowerCase();
    var existing = document.getElementById("nav-filter-results");
    if (!q) { if (existing) existing.remove(); el.tree.style.display = ""; return; }
    el.tree.style.display = "none";
    var ul = existing || document.createElement("ul");
    ul.id = "nav-filter-results";
    ul.className = "nav-filter-results";
    ul.innerHTML = "";
    var matches = state.allItems.filter(function (it) {
      return it.title.toLowerCase().indexOf(q) !== -1 || it.path.toLowerCase().indexOf(q) !== -1;
    });
    if (!matches.length) {
      ul.innerHTML = '<li class="nav-empty">No pages match \u201c' + escapeHtml(q) + '\u201d.</li>';
    } else {
      var cap = matches.slice(0, 300), bySec = {}, order = [];
      cap.forEach(function (m) { if (!bySec[m.section]) { bySec[m.section] = []; order.push(m.section); } bySec[m.section].push(m); });
      order.forEach(function (sec) {
        var head = document.createElement("li");
        head.className = "nfr-section"; head.textContent = sec;
        ul.appendChild(head);
        bySec[sec].forEach(function (m) {
          var li = document.createElement("li");
          var a = document.createElement("a");
          a.href = "#/" + m.path;
          a.setAttribute("data-path", m.path);
          a.innerHTML = hlMatch(m.title, q) + '<span class="nfr-crumb">' + escapeHtml(m.path) + "</span>";
          a.addEventListener("click", function () { clearNavFilter(); });
          li.appendChild(a); ul.appendChild(li);
        });
      });
      if (matches.length > cap.length) {
        var more = document.createElement("li");
        more.className = "nav-filter-more";
        more.textContent = "+" + (matches.length - cap.length) + " more \u2014 refine your filter";
        ul.appendChild(more);
      }
    }
    if (!existing) el.sidebar.appendChild(ul);
  }

  function collapseAll() {
    clearNavFilter();
    el.tree.querySelectorAll(".nav-section").forEach(function (s) { s.classList.add("collapsed"); });
    (state.nav.sections || []).forEach(function (sec) { setOpen("sec:" + sec.title, false); });
  }

  /* ---- breadcrumbs ---- */
  function buildBreadcrumbs(path, h1text) {
    var bc = el.breadcrumbs; if (!bc) return;
    bc.innerHTML = "";
    var home = state.nav ? state.nav.site.home : "index.md";
    function addLink(label, href) { var a = document.createElement("a"); a.href = href; a.textContent = label; bc.appendChild(a); }
    function addText(label) { var s = document.createElement("span"); s.className = "crumb-current"; s.textContent = label; bc.appendChild(s); }
    function sep() { var s = document.createElement("span"); s.className = "sep"; s.textContent = "/"; bc.appendChild(s); }
    if (path === home) { addText("Home"); return; }
    addLink("Home", "#/" + home);
    var section = null, item = null, refGroup = null;
    (state.nav ? state.nav.sections : []).forEach(function (s) {
      (s.items || []).forEach(function (it) { if (it.path === path) { item = it; section = s; } });
      (s.groups || []).forEach(function (g) { if (path.indexOf(g.auto + "/") === 0) { section = s; refGroup = g; } });
    });
    if (section) { sep(); addText(section.title); }
    if (refGroup) {
      var rel = path.slice(refGroup.auto.length + 1).replace(/\.md$/, "");
      var segs = rel.split("/");
      segs.forEach(function (seg, i) { sep(); if (i === segs.length - 1) addText(seg); else addText(seg); });
    } else {
      sep(); addText(h1text || (item ? item.title : path));
    }
  }

  /* ---- scroll-driven UI (progress + back-to-top) ---- */
  function onScroll() {
    var doc = document.documentElement;
    var top = window.pageYOffset || doc.scrollTop || 0;
    var height = doc.scrollHeight - doc.clientHeight;
    var progressTop = top;
    if (INLINE_MODE && el.content) {
      var workspace = el.content.closest(".portal-docs-workspace");
      if (workspace) {
        var workspaceTop = workspace.getBoundingClientRect().top + top;
        progressTop = Math.max(0, top + parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-height") || "56") - workspaceTop);
        height = Math.max(1, workspace.offsetHeight - doc.clientHeight + 120);
      }
    }
    var pct = height > 0 ? Math.max(0, Math.min(100, (progressTop / height) * 100)) : 0;
    if (el.progress) {
      el.progress.style.width = pct.toFixed(1) + "%";
      el.progress.setAttribute("aria-valuenow", String(Math.round(pct)));
    }
    if (el.backTop) {
      if (top > 400) { el.backTop.hidden = false; el.backTop.classList.add("show"); }
      else { el.backTop.classList.remove("show"); }
    }
  }

  /* ------------------------------ routing ------------------------------ */
  function parseHash() {
    var rawHash = location.hash || "";
    if (rawHash && rawHash.indexOf("#/") !== 0) {
      return {
        path: DEFAULT_DOC || (state.nav ? state.nav.site.home : "index.md"),
        anchor: rawHash.slice(1)
      };
    }
    var h = rawHash.replace(/^#\/?/, "");
    if (!h) {
      var queryPath = normalizeDocPath(new URLSearchParams(location.search).get("doc") || "");
      return {
        path: queryPath || DEFAULT_DOC || (state.nav ? state.nav.site.home : "index.md"),
        anchor: ""
      };
    }
    var parts = h.split("#");
    return {
      path: normalizeDocPath(parts[0]) || DEFAULT_DOC || (state.nav ? state.nav.site.home : "index.md"),
      anchor: parts[1] || ""
    };
  }

  function navigate() {
    var route = parseHash();
    if (route.anchor && state.current && location.hash.indexOf("#/") !== 0) {
      var portalTarget = document.getElementById(route.anchor);
      if (portalTarget) portalTarget.scrollIntoView({ block: "start" });
      return;
    }
    loadDoc(route.path, route.anchor);
    if (isMobile()) setSidebar(false);   // close the drawer after navigating
  }

  function scrollAfterLoad(anchor) {
    if (anchor) {
      var target = document.getElementById(anchor);
      if (target) target.scrollIntoView({ block: "start" });
      return;
    }
    // Embedded portals keep their editorial hero visible on first load. Once a
    // hash route is chosen, navigation returns focus to the live document.
    if (INLINE_MODE) {
      if (location.hash) el.content.scrollIntoView({ block: "start" });
      return;
    }
    window.scrollTo(0, 0);
  }

  function loadDoc(path, anchor) {
    state.current = path;
    highlightActive();

    if (pt) {
      // The shared element animation fades the old article out, applies the
      // fetched content, then reveals it without animating the surrounding UI.
      pt.start(async function () {
        try {
          var md = await getDoc(path);
          renderDoc(md, path);
          scrollAfterLoad(anchor);
          if (!INLINE_MODE || location.hash.indexOf("#/") === 0) {
            try { el.content.focus({ preventScroll: true }); } catch (e) { el.content.focus(); }
          }
        } catch (err) {
          el.content.innerHTML = '<h1>Page not found</h1><p>Could not load <code>' +
            escapeHtml(path) + '</code> (' + escapeHtml(err.message) + ').</p>' +
            '<p>Check <code>_config/nav.json</code> or run the generators in <code>MD/tools/</code>.</p>';
          el.toc.innerHTML = "";
        }
      });
      return;
    }

    el.content.innerHTML = '<p class="loading">Loading&hellip;</p>';
    getDoc(path)
      .then(function (md) {
        renderDoc(md, path);
        scrollAfterLoad(anchor);
        if (!INLINE_MODE || location.hash.indexOf("#/") === 0) {
          try { el.content.focus({ preventScroll: true }); } catch (e) { el.content.focus(); }
        }
      })
      .catch(function (err) {
        el.content.innerHTML = '<h1>Page not found</h1><p>Could not load <code>' +
          escapeHtml(path) + '</code> (' + escapeHtml(err.message) + ').</p>' +
          '<p>Check <code>_config/nav.json</code> or run the generators in <code>MD/tools/</code>.</p>';
        el.toc.innerHTML = "";
      });
  }

  function renderDoc(md, path) {
    state.lastMarkdown = md;
    var fm = parseFrontmatter(md);
    state.lastMeta = fm.meta;
    el.content.innerHTML = renderMarkdown(fm.body);
    var h1 = el.content.querySelector("h1");
    if (fm.meta.description && h1) {
      var sub = document.createElement("p");
      sub.className = "page-subtitle";
      sub.textContent = fm.meta.description;
      h1.insertAdjacentElement("afterend", sub);
    }
    rewriteLinks(path);
    enhanceHeadings();
    enhanceCode();
    renderMermaid();
    buildToc();
    buildPageNav();
    var h1text = h1 ? h1.textContent.replace(/#$/, "").trim() : (fm.meta.title || "");
    buildBreadcrumbs(path, h1text);
    revealActive();
    onScroll();
    buildSourceFooter(path, fm.meta, md);
    document.title = (h1text || "Docs") + " — WebGPU OS Docs";
    updateDocumentMetadata(path, fm.meta, h1text);
  }

  function buildSourceFooter(path, meta, markdown) {
    if (!el.source) return;
    if (state.sourceBlobUrl) {
      URL.revokeObjectURL(state.sourceBlobUrl);
      state.sourceBlobUrl = "";
    }
    var raw = DOC_ROOT + path;
    var html;
    if (state.bundle && isBundledOnlyPath(path) && markdown) {
      state.sourceBlobUrl = URL.createObjectURL(
        new Blob([markdown], { type: "text/markdown;charset=utf-8" })
      );
      var filename = path.split("/").pop() || "reference.md";
      html = 'Source: <code>MD/' + escapeHtml(path) + '</code>';
      html += ' · <a href="' + state.sourceBlobUrl + '" download="' +
        escapeHtml(filename) + '">Download bundled Markdown</a>';
    } else {
      html = 'Source: <a href="' + raw + '" target="_blank" rel="noopener">MD/' +
        escapeHtml(path) + '</a>';
      html += ' · <a href="' + raw + '" target="_blank" rel="alternate noopener" ' +
        'type="text/markdown">Open Markdown</a>';
    }
    html += ' · <a href="' + DOC_ROOT + '../api-index.json" target="_blank" rel="noopener">Machine API catalog</a>';
    html += ' · <a href="' + DOC_ROOT + '../docs-chunks.jsonl" target="_blank" rel="noopener">Docs JSONL</a>';
    html += ' · <a href="' + DOC_ROOT + '../api-symbols.jsonl" target="_blank" rel="noopener">API JSONL</a>';
    var updated = (meta && meta.updated) ? meta.updated : (state.gitDates && state.gitDates[path]);
    if (updated) html += ' · Last updated: ' + escapeHtml(updated);
    el.source.innerHTML = html;
  }

  // Last-updated dates derived from git history (fallback when a page has no
  // `updated` frontmatter). Best-effort: absent file just disables the fallback.
  function loadGitDates() {
    if (state.bundle) return;            // already populated from the bundle
    fetch(GIT_DATES_URL)
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (d) {
        state.gitDates = d || {};
        if (state.current) buildSourceFooter(state.current, state.lastMeta, state.lastMarkdown);
      })
      .catch(function () {});
  }

  function rewriteLinks(path) {
    el.content.querySelectorAll("a[href]").forEach(function (a) {
      var href = a.getAttribute("href");
      if (/^https?:\/\//i.test(href) || href.indexOf("mailto:") === 0) {
        a.target = "_blank"; a.rel = "noopener noreferrer"; return;
      }
      if (href.charAt(0) === "#") { // in-page anchor
        a.addEventListener("click", function (e) {
          e.preventDefault();
          var id = href.slice(1);
          var t = document.getElementById(id);
          if (t) { t.scrollIntoView(); history.replaceState(null, "", "#/" + path + "#" + id); }
        });
        return;
      }
      var clean = href.split("#"), anchor = clean[1] || "";
      // Leading "/" = docroot-absolute (depth-independent — used by shared API
      // notes that are injected into reference pages at varying depths).
      var resolved = clean[0].charAt(0) === "/"
        ? clean[0].slice(1)
        : resolvePath(path, clean[0]);
      if (/\.md$/i.test(resolved)) {
        a.setAttribute("href", "#/" + resolved + (anchor ? "#" + anchor : ""));
      } else {
        a.setAttribute("href", DOC_ROOT + resolved);
      }
    });
    el.content.querySelectorAll("img[src]").forEach(function (img) {
      var src = img.getAttribute("src");
      if (/^https?:\/\//i.test(src) || src.charAt(0) === "/") return;
      img.setAttribute("src", DOC_ROOT + resolvePath(path, src));
    });
  }

  function enhanceHeadings() {
    el.content.querySelectorAll("h1, h2, h3, h4").forEach(function (h) {
      if (!h.id) h.id = slugify(h.textContent);
      var a = document.createElement("a");
      a.className = "heading-anchor";
      a.href = "#/" + state.current + "#" + h.id;
      a.textContent = "#";
      a.setAttribute("aria-label", "Link to this section");
      h.appendChild(a);
    });
  }

  function enhanceCode() {
    el.content.querySelectorAll("pre > code").forEach(function (code) {
      if (/language-mermaid/.test(code.className)) return;
      if (window.hljs) { try { window.hljs.highlightElement(code); } catch (e) {} }
      var pre = code.parentElement;
      var btn = document.createElement("button");
      btn.className = "copy-btn"; btn.type = "button"; btn.textContent = "Copy";
      btn.addEventListener("click", function () {
        navigator.clipboard.writeText(code.textContent).then(function () {
          btn.textContent = "Copied"; btn.classList.add("copied");
          setTimeout(function () { btn.textContent = "Copy"; btn.classList.remove("copied"); }, 1400);
        });
      });
      pre.appendChild(btn);
    });
  }

  function renderMermaid() {
    var blocks = el.content.querySelectorAll("pre > code.language-mermaid");
    if (!blocks.length) return;
    function run() {
      blocks.forEach(function (code) {
        if (!code.isConnected) return;
        var div = document.createElement("div");
        div.className = "mermaid";
        div.textContent = code.textContent;
        code.parentElement.replaceWith(div);
      });
      try {
        window.mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
        window.mermaid.run({ querySelector: ".mermaid" });
      } catch (e) {}
    }
    if (window.mermaid) { run(); return; }
    if (!state.mermaidPromise) {
      state.mermaidPromise = new Promise(function (resolve, reject) {
        var script = document.createElement("script");
        script.src = DOC_ROOT + "assets/vendor/mermaid/mermaid.min.js";
        script.onload = resolve;
        script.onerror = function () { reject(new Error("Could not load Mermaid renderer")); };
        document.head.appendChild(script);
      });
    }
    state.mermaidPromise.then(run).catch(function () {});
  }

  function buildToc() {
    var heads = el.content.querySelectorAll("h2, h3");
    el.toc.innerHTML = "";
    if (!heads.length) { el.tocWrap.style.visibility = "hidden"; return; }
    el.tocWrap.style.visibility = "visible";
    heads.forEach(function (h) {
      var li = document.createElement("li");
      if (h.tagName === "H3") li.className = "toc-h3";
      var a = document.createElement("a");
      a.href = "#/" + state.current + "#" + h.id;
      a.textContent = h.textContent.replace(/#$/, "");
      a.setAttribute("data-target", h.id);
      a.addEventListener("click", function (e) {
        e.preventDefault();
        document.getElementById(h.id).scrollIntoView();
        history.replaceState(null, "", a.getAttribute("href"));
      });
      li.appendChild(a);
      el.toc.appendChild(li);
    });
    setupScrollSpy(heads);
  }

  function setupScrollSpy(heads) {
    if (!("IntersectionObserver" in window)) return;
    if (state.tocObserver) state.tocObserver.disconnect();
    var links = {};
    el.toc.querySelectorAll("a[data-target]").forEach(function (a) { links[a.getAttribute("data-target")] = a; });
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          Object.keys(links).forEach(function (k) { links[k].classList.remove("active"); });
          if (links[en.target.id]) links[en.target.id].classList.add("active");
        }
      });
    }, { rootMargin: "-70px 0px -70% 0px" });
    state.tocObserver = obs;
    heads.forEach(function (h) { obs.observe(h); });
  }

  function buildPageNav() {
    var idx = state.flat.findIndex(function (f) { return f.path === state.current; });
    var prev = idx > 0 ? state.flat[idx - 1] : null;
    var next = idx >= 0 && idx < state.flat.length - 1 ? state.flat[idx + 1] : null;
    if (prev) { el.prev.hidden = false; el.prev.href = "#/" + prev.path; el.prev.innerHTML = "&larr; " + escapeHtml(prev.title); }
    else el.prev.hidden = true;
    if (next) { el.next.hidden = false; el.next.href = "#/" + next.path; el.next.innerHTML = escapeHtml(next.title) + " &rarr;"; }
    else el.next.hidden = true;
  }

  /* ------------------------------ search ------------------------------- */
  function loadSearchIndex() {
    if (state.bundle) return;            // already populated from the bundle
    fetch(SEARCH_URL).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (idx) { state.searchIndex = idx; })
      .catch(function () { state.searchIndex = null; });
  }

  function runSearch(q) {
    q = q.trim().toLowerCase();
    if (q.length < 2) { hideSearch(); return; }
    var results = [];
    if (state.searchIndex) {
      state.searchIndex.forEach(function (doc) {
        var hay = (doc.title + " " + doc.text).toLowerCase();
        var pos = hay.indexOf(q);
        if (pos !== -1) {
          var score = (doc.title.toLowerCase().indexOf(q) !== -1 ? 100 : 0) + Math.max(0, 40 - pos / 20);
          results.push({ doc: doc, score: score, pos: pos });
        }
      });
      results.sort(function (a, b) { return b.score - a.score; });
    } else {
      // Fallback: title-only search across nav.
      state.flat.forEach(function (f) {
        if (f.title.toLowerCase().indexOf(q) !== -1) results.push({ doc: { title: f.title, path: f.path, text: "" }, score: 1, pos: 0 });
      });
    }
    showSearch(results.slice(0, 24), q);
  }

  function showSearch(results, q) {
    state.srActive = -1;
    if (!results.length) { el.searchResults.innerHTML = '<li class="search-empty">No matches for "' + escapeHtml(q) + '"</li>'; el.searchResults.hidden = false; return; }
    el.searchResults.innerHTML = results.map(function (r) {
      var d = r.doc, snippet = "";
      if (d.text) {
        var start = Math.max(0, r.pos - 35);
        var raw = d.text.substr(start, 120);
        snippet = (start > 0 ? "…" : "") + escapeHtml(raw).replace(new RegExp("(" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig"), "<mark>$1</mark>");
      }
      return '<li><a href="#/' + d.path + '">' +
        '<span class="sr-title">' + escapeHtml(d.title) + '</span>' +
        '<span class="sr-crumb">' + escapeHtml(d.path) + '</span>' +
        (snippet ? '<span class="sr-snippet">' + snippet + '…</span>' : "") +
        '</a></li>';
    }).join("");
    el.searchResults.hidden = false;
    el.searchResults.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () { hideSearch(); el.search.value = ""; });
    });
  }
  function hideSearch() { el.searchResults.hidden = true; el.searchResults.innerHTML = ""; }

  /* --------------------------- sidebar drawer -------------------------- */
  // On narrow screens the sidebar is an off-canvas drawer: closed by default,
  // opened by the hamburger, dismissed by the backdrop or after navigating.
  function isMobile() { return window.matchMedia("(max-width: 900px)").matches; }
  function setSidebar(open) {
    el.sidebar.classList.toggle("collapsed", !open);
    el.sidebarToggle.setAttribute("aria-expanded", String(open));
    if (el.backdrop) el.backdrop.hidden = !(open && isMobile());
  }

  /* ------------------------------ events ------------------------------- */
  function bindEvents() {
    window.addEventListener("hashchange", navigate);
    el.sidebarToggle.addEventListener("click", function () {
      setSidebar(el.sidebar.classList.contains("collapsed"));
    });
    if (el.backdrop) el.backdrop.addEventListener("click", function () { setSidebar(false); });
    window.addEventListener("resize", function () {
      if (!isMobile()) setSidebar(true);   // back to desktop: always show, hide backdrop
    });
    el.search.addEventListener("input", function () {
      clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(function () { runSearch(el.search.value); }, 120);
    });
    el.search.addEventListener("keydown", function (e) {
      var items = el.searchResults.querySelectorAll("a");
      if (e.key === "ArrowDown") { e.preventDefault(); state.srActive = Math.min(items.length - 1, state.srActive + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); state.srActive = Math.max(0, state.srActive - 1); }
      else if (e.key === "Enter" && items[state.srActive]) { items[state.srActive].click(); return; }
      else if (e.key === "Escape") { hideSearch(); el.search.blur(); return; }
      items.forEach(function (a, i) { a.classList.toggle("active", i === state.srActive); });
      if (items[state.srActive]) items[state.srActive].scrollIntoView({ block: "nearest" });
    });
    document.addEventListener("click", function (e) {
      if (!el.searchResults.contains(e.target) && e.target !== el.search) hideSearch();
    });
    document.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); el.search.focus(); el.search.select(); }
      if (e.key === "Escape" && isMobile() && !el.sidebar.classList.contains("collapsed")) {
        setSidebar(false);
        el.sidebarToggle.focus();
      }
    });

    if (el.navFilter) {
      el.navFilter.addEventListener("input", function () {
        clearTimeout(state.navTimer);
        state.navTimer = setTimeout(function () { runNavFilter(el.navFilter.value); }, 110);
      });
      el.navFilter.addEventListener("keydown", function (e) {
        if (e.key === "Escape") { clearNavFilter(); el.navFilter.blur(); }
      });
    }
    if (el.collapseAll) el.collapseAll.addEventListener("click", collapseAll);
    if (el.backTop) el.backTop.addEventListener("click", function () { window.scrollTo({ top: 0, behavior: "smooth" }); });
    window.addEventListener("scroll", onScroll, { passive: true });
    if (el.sidebar) el.sidebar.addEventListener("scroll", function () {
      clearTimeout(state.sbTimer);
      state.sbTimer = setTimeout(function () {
        try { localStorage.setItem("wgpu-docs-sb", String(el.sidebar.scrollTop)); } catch (e) {}
      }, 200);
    });
  }

  /* ------------------------------- boot -------------------------------- */
  loadBundle()
    .then(function () {
      return (state.bundle && state.bundle.nav)
        ? state.bundle.nav
        : fetch(NAV_URL).then(function (r) { return r.json(); });
    })
    .then(function (nav) {
      state.nav = nav;
      loadOpenState();
      state.flat = flattenNav(nav);
      if (el.version && nav.site && nav.site.version) el.version.textContent = "v" + nav.site.version;
      var workspace = el.content ? el.content.closest(".portal-docs-workspace") : null;
      var brandText = workspace ? workspace.querySelector(".brand-text") : document.querySelector(".brand-text");
      if (brandText) brandText.textContent = nav.site.title.replace(/ Docs$/, "");
      buildSidebar(nav);
      bindEvents();
      setSidebar(!isMobile());   // drawer closed on mobile, open on desktop
      loadSearchIndex();
      loadGitDates();
      navigate();
      try { var sb = localStorage.getItem("wgpu-docs-sb"); if (sb) el.sidebar.scrollTop = parseInt(sb, 10) || 0; } catch (e) {}
    })
    .catch(function (err) {
      el.content.innerHTML = '<h1>Could not load navigation</h1><p>Failed to fetch <code>_config/nav.json</code>: ' +
        escapeHtml(err.message) + '</p><p>Serve the <code>MD/</code> folder over HTTP (e.g. <code>python start_server.py</code>) rather than opening the file directly.</p>';
    });
})();
