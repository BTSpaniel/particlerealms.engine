// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { initWorldInspectorPanel } from "./panels/WorldInspectorPanel.js";
import { initNavInspectorPanel } from "./panels/NavInspectorPanel.js";
import { initSpawnerInspectorPanel } from "./panels/SpawnerInspectorPanel.js";
import { initEntitiesInspectorPanel } from "./panels/EntitiesInspectorPanel.js";
import {
  createPropertySection,
  addNumberRow,
  addSliderRow,
  addCheckboxRow,
  addTextRow,
} from "./ui/InspectorControls.js";

export function attachInspectorPanel(options = {}) {
  if (typeof document === "undefined") {
    return null;
  }
  const getWorld =
    typeof options.getWorld === "function" ? options.getWorld : null;
  if (!getWorld) {
    return null;
  }
  const spawnConfig =
    options.spawn && typeof options.spawn === "object" ? options.spawn : null;
  const renderConfig =
    options.render && typeof options.render === "object" ? options.render : null;
  const physicsConfig =
    options.physics && typeof options.physics === "object" ? options.physics : null;
  const statsConfig =
    options.stats && typeof options.stats === "object" ? options.stats : null;
  const emitterConfig =
    options.emitter && typeof options.emitter === "object" ? options.emitter : null;
  const engineConfig =
    options.engine && typeof options.engine === "object" ? options.engine : null;

  const onRemoveEntity =
    typeof options.onRemoveEntity === "function" ? options.onRemoveEntity : null;

  const spawnModes =
    spawnConfig && Array.isArray(spawnConfig.modes) ? spawnConfig.modes : [];
  const canSpawn = !!(
    spawnConfig &&
    typeof spawnConfig.onSpawn === "function" &&
    spawnModes.length > 0
  );
  let selectedSpawnModeId = canSpawn && spawnModes[0] ? spawnModes[0].id : null;

  const spawnerState = {};
  function getSpawnerProps(modeId) {
    if (!modeId) {
      return { color: [1.0, 0.8, 0.3], scale: [1, 1, 1] };
    }
    if (!spawnerState[modeId]) {
      if (modeId === "cube") {
        spawnerState[modeId] = { color: [0.3, 0.8, 1.0], scale: [1, 1, 1] };
      } else if (modeId === "sphere") {
        spawnerState[modeId] = { color: [0.8, 0.3, 1.0], scale: [1, 1, 1] };
      } else if (modeId === "plane") {
        spawnerState[modeId] = { color: [1.0, 0.3, 0.8], scale: [3, 1, 3] };
      } else {
        spawnerState[modeId] = { color: [1.0, 0.8, 0.3], scale: [1, 1, 1] };
      }
    }
    return spawnerState[modeId];
  }
  const getEntityLabel =
    typeof options.getEntityLabel === "function" ? options.getEntityLabel : null;

  const doc = options.document || document;
  const parent = options.parent && options.parent.appendChild ? options.parent : null;
  const embedded = !!options.embedded;
  const hasLocalStorage =
    typeof window !== "undefined" && !!window.localStorage;
  const storagePrefix =
    hasLocalStorage && window.location
      ? "engineInspector:" + (window.location.pathname || "root")
      : null;
  const shaderStorageKey =
    storagePrefix && renderConfig ? storagePrefix + ":shader" : null;
  const lightStorageKey =
    storagePrefix && renderConfig ? storagePrefix + ":light" : null;
  const physicsStorageKey =
    storagePrefix && physicsConfig ? storagePrefix + ":physics" : null;
  const widthStorageKey =
    storagePrefix && !options.document ? storagePrefix + ":panelWidth" : null;

  function loadJSONFromStorage(key) {
    if (!hasLocalStorage || !key) {
      return null;
    }
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        return null;
      }
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function saveJSONToStorage(key, value) {
    if (!hasLocalStorage || !key) {
      return;
    }
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      return;
    }
  }

  const existing = doc.getElementById("engine-inspector-root");
  if (existing) {
    // If a caller wants an embedded inspector, ensure the root is parented correctly.
    if (parent && existing.parentElement !== parent) {
      parent.appendChild(existing);
    }
    // Prefer returning the API object if it was previously created.
    if (existing.__engineInspectorApi) {
      return existing.__engineInspectorApi;
    }
    return { root: existing };
  }
  const isPopupDocument = !!options.document && options.document !== document;

  let initialWidthPx = 440;
  if (!isPopupDocument && hasLocalStorage && widthStorageKey) {
    try {
      const rawWidth = window.localStorage.getItem(widthStorageKey);
      if (rawWidth) {
        const parsed = parseInt(rawWidth, 10);
        if (Number.isFinite(parsed)) {
          const clamped = Math.min(Math.max(parsed, 260), 900);
          initialWidthPx = clamped;
        }
      }
    } catch (e) {}
  }

  const root = doc.createElement("div");
  root.id = "engine-inspector-root";
  root.style.position = isPopupDocument || embedded ? "relative" : "fixed";
  root.style.top = "0";
  root.style.right = isPopupDocument || embedded ? "0" : "0";
  root.style.width = isPopupDocument || embedded ? "100%" : initialWidthPx + "px";
  root.style.height = "100%";
  root.style.background = "#0a0a0f";
  root.style.color = "#e5e7eb";
  root.style.fontFamily =
    "system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
  root.style.fontSize = "12px";
  root.style.zIndex = embedded ? "1" : "1000";
  root.style.display = "flex";
  root.style.flexDirection = "column";
  root.style.borderLeft = isPopupDocument || embedded ? "none" : "1px solid #1e1e2e";
  root.style.userSelect = "none";
  root.style.WebkitUserSelect = "none";

  let inspectorStyle = doc.getElementById("engine-inspector-style");
  if (!inspectorStyle) {
    inspectorStyle = doc.createElement("style");
    inspectorStyle.id = "engine-inspector-style";
    inspectorStyle.textContent = `
#engine-inspector-root {
  scrollbar-color: #27272a transparent;
  scrollbar-width: thin;
}
#engine-inspector-root::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
#engine-inspector-root::-webkit-scrollbar-track {
  background: transparent;
  border-radius: 4px;
}
#engine-inspector-root::-webkit-scrollbar-thumb {
  background: #27272a;
  border-radius: 4px;
  border: 2px solid transparent;
  background-clip: padding-box;
}
#engine-inspector-root::-webkit-scrollbar-thumb:hover {
  background: #3f3f46;
  border: 2px solid transparent;
  background-clip: padding-box;
}
#engine-inspector-root,
#engine-inspector-root * {
  user-select: none;
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
}
#engine-inspector-root input,
#engine-inspector-root textarea {
  user-select: text;
  -webkit-user-select: text;
  -moz-user-select: text;
  -ms-user-select: text;
}
#engine-inspector-root input[type="number"]::-webkit-outer-spin-button,
#engine-inspector-root input[type="number"]::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
#engine-inspector-root input[type="number"] {
  -moz-appearance: textfield;
}
`;
    if (doc.head) {
      doc.head.appendChild(inspectorStyle);
    } else {
      doc.body.appendChild(inspectorStyle);
    }
  }

  if (parent) {
    parent.appendChild(root);
  } else {
    doc.body.appendChild(root);
  }

  const resizeHandle = doc.createElement("div");
  resizeHandle.style.position = "absolute";
  resizeHandle.style.left = "0";
  resizeHandle.style.top = "0";
  resizeHandle.style.width = "6px";
  resizeHandle.style.height = "100%";
  resizeHandle.style.cursor = "ew-resize";
  resizeHandle.style.background = "transparent";
  resizeHandle.style.zIndex = "1001";
  
  // Visual indicator for resize handle (small pill in the middle)
  const resizeIndicator = doc.createElement("div");
  resizeIndicator.style.position = "absolute";
  resizeIndicator.style.left = "1px";
  resizeIndicator.style.top = "50%";
  resizeIndicator.style.transform = "translateY(-50%)";
  resizeIndicator.style.width = "4px";
  resizeIndicator.style.height = "40px";
  resizeIndicator.style.borderRadius = "2px";
  resizeIndicator.style.background = "#27272a";
  resizeIndicator.style.opacity = "0.6";
  resizeIndicator.style.transition = "opacity 0.15s, background 0.15s";
  resizeHandle.appendChild(resizeIndicator);
  
  // Highlight on hover
  resizeHandle.onmouseenter = function() {
    resizeIndicator.style.opacity = "1";
    resizeIndicator.style.background = "#60a5fa";
  };
  resizeHandle.onmouseleave = function() {
    if (!isResizing) {
      resizeIndicator.style.opacity = "0.6";
      resizeIndicator.style.background = "#27272a";
    }
  };
  
  if (!embedded) {
    root.appendChild(resizeHandle);
  }

  let isResizing = false;
  let resizeStartX = 0;
  let resizeStartWidth = 0;

  function getViewportWidth() {
    const docWidth =
      (doc.documentElement && doc.documentElement.clientWidth) || 0;
    const winWidth =
      typeof window !== "undefined" && window.innerWidth
        ? window.innerWidth
        : 0;
    return docWidth || winWidth || 1200;
  }

  function onResizeMove(event) {
    if (!isResizing) {
      return;
    }
    const clientX = event.clientX;
    if (!Number.isFinite(clientX)) {
      return;
    }
    const dx = resizeStartX - clientX;
    let newWidth = resizeStartWidth + dx;
    const minWidth = 260;
    const viewportWidth = getViewportWidth();
    const maxWidth = Math.max(minWidth, Math.min(900, viewportWidth - 220));
    if (newWidth < minWidth) {
      newWidth = minWidth;
    }
    if (newWidth > maxWidth) {
      newWidth = maxWidth;
    }
    root.style.width = newWidth + "px";
  }

  function onResizeEnd() {
    if (!isResizing) {
      return;
    }
    isResizing = false;
    doc.removeEventListener("mousemove", onResizeMove);
    doc.removeEventListener("mouseup", onResizeEnd);
    if (!isPopupDocument && hasLocalStorage && widthStorageKey) {
      try {
        const rect = root.getBoundingClientRect();
        const w = Math.round(rect.width);
        window.localStorage.setItem(widthStorageKey, String(w));
      } catch (e) {}
    }
  }

  resizeHandle.addEventListener("mousedown", function (event) {
    if (event.button !== 0) {
      return;
    }
    isResizing = true;
    resizeStartX = event.clientX;
    const rect = root.getBoundingClientRect();
    resizeStartWidth = rect.width;
    doc.addEventListener("mousemove", onResizeMove);
    doc.addEventListener("mouseup", onResizeEnd);
    event.preventDefault();
  });

  const header = doc.createElement("div");
  header.style.display = "flex";
  header.style.alignItems = "center";
  header.style.justifyContent = "space-between";
  header.style.padding = "8px 12px";
  header.style.background = "#0a0a0f";
  header.style.borderBottom = "1px solid #1e1e2e";
  header.style.boxShadow = "0 2px 10px rgba(0, 0, 0, 0.6)";
  const title = doc.createElement("div");
  title.textContent = "Engine Inspector";
  title.style.fontWeight = "600";
  title.style.fontSize = "13px";
  title.style.userSelect = "none";
  const headerButtons = doc.createElement("div");
  headerButtons.style.display = "flex";
  headerButtons.style.gap = "4px";

  // Track popup window reference for cleanup
  let popupWindow = null;
  let popupInspector = null;

  const canUndock = !embedded && !options.document && typeof window !== "undefined" && typeof window.open === "function";
  if (canUndock) {
    const undockBtn = doc.createElement("button");
    undockBtn.textContent = "↗";
    undockBtn.style.background = "transparent";
    undockBtn.style.border = "none";
    undockBtn.style.color = "#fff";
    undockBtn.style.cursor = "pointer";
    undockBtn.style.fontSize = "13px";
    undockBtn.style.padding = "0 4px";
    undockBtn.title = "Open inspector in new window";
    undockBtn.onclick = function () {
      // Close existing popup if any
      if (popupWindow && !popupWindow.closed) {
        popupWindow.focus();
        return;
      }
      
      const win = window.open("", "EngineInspectorWindow", "width=480,height=800,menubar=no,toolbar=no,location=no,status=no,titlebar=no");
      if (!win) {
        return;
      }
      popupWindow = win;
      win.document.title = "Engine Inspector";
      
      // Style the popup document to remove white borders/margins
      win.document.body.style.margin = "0";
      win.document.body.style.padding = "0";
      win.document.body.style.background = "#0a0a0f";
      win.document.body.style.overflow = "hidden";
      win.document.documentElement.style.margin = "0";
      win.document.documentElement.style.padding = "0";
      win.document.documentElement.style.background = "#0a0a0f";
      
      // Create inspector in popup, passing onClose callback
      popupInspector = attachInspectorPanel({
        getWorld,
        spawn: {
          modes: spawnModes,
          onSpawn: spawnConfig?.onSpawn,
          onSelect: spawnConfig?.onSelect,
          setSpawnPreviewProps: spawnConfig?.setSpawnPreviewProps,
        },
        render: renderConfig,
        physics: physicsConfig,
        stats: statsConfig,
        emitter: emitterConfig,
        engine: engineConfig,
        document: win.document,
        onRemoveEntity,
        getEntityLabel,
        onSelectionChanged: options.onSelectionChanged,
      });
      
      // Hide main inspector (don't remove - keep state)
      root.style.display = "none";
      
      // When popup closes, the main inspector stays hidden but ready
      win.addEventListener("beforeunload", function () {
        popupWindow = null;
        popupInspector = null;
      });
    };
    headerButtons.appendChild(undockBtn);
  }

  const closeBtn = doc.createElement("button");
  closeBtn.textContent = "×";
  closeBtn.style.background = "transparent";
  closeBtn.style.border = "none";
  closeBtn.style.color = "#fff";
  closeBtn.style.cursor = "pointer";
  closeBtn.style.fontSize = "14px";
  closeBtn.style.padding = "0 4px";
  closeBtn.title = "Hide inspector (press I to show again)";
  closeBtn.onclick = function () {
    // Hide the inspector instead of removing it entirely so it can
    // be shown again later without re-initializing all state.
    root.style.display = "none";
    // Close popup if open
    if (popupWindow && !popupWindow.closed) {
      popupWindow.close();
      popupWindow = null;
      popupInspector = null;
    }
  };
  if (!embedded) {
    headerButtons.appendChild(closeBtn);
  }
  header.appendChild(title);
  header.appendChild(headerButtons);
  // Hide header in popup windows (window already has title bar)
  if (!isPopupDocument && !embedded) {
    root.appendChild(header);
  }

  const tabsBar = doc.createElement("div");
  tabsBar.style.display = "flex";
  tabsBar.style.borderBottom = "1px solid #1e1e2e";
  tabsBar.style.background = "#0a0a0f";
  const tabs = ["World", "Entities", "Spawner", "Nav"];
  const tabButtons = {};
  let activeTab = "World";
  tabs.forEach((name) => {
    const btn = doc.createElement("button");
    btn.textContent = name;
    btn.style.flex = "1";
    btn.style.padding = "8px 12px";
    btn.style.border = "none";
    btn.style.cursor = "pointer";
    btn.style.fontSize = "12px";
    btn.style.fontWeight = "500";
    btn.style.background = "transparent";
    btn.style.color = name === activeTab ? "#60a5fa" : "#6b7280";
    btn.style.borderBottom =
      name === activeTab ? "2px solid #60a5fa" : "2px solid transparent";
    btn.onclick = function () {
      activeTab = name;
      Object.keys(tabButtons).forEach((key) => {
        const b = tabButtons[key];
        b.style.color = key === activeTab ? "#60a5fa" : "#6b7280";
        b.style.borderBottom =
          key === activeTab ? "2px solid #60a5fa" : "2px solid transparent";
      });
      renderActiveTab();
    };
    tabButtons[name] = btn;
    tabsBar.appendChild(btn);
  });
  root.appendChild(tabsBar);

  const content = doc.createElement("div");
  content.style.flex = "1";
  content.style.display = "flex";
  content.style.flexDirection = "column";
  content.style.overflow = "hidden";
  root.appendChild(content);

  const worldPanel = doc.createElement("div");
  const entitiesPanel = doc.createElement("div");
  const spawnerPanel = doc.createElement("div");
  const navPanel = doc.createElement("div");

  worldPanel.style.flex = "1";
  worldPanel.style.overflow = "auto";
  worldPanel.style.padding = "8px 12px";
  entitiesPanel.style.flex = "1";
  entitiesPanel.style.overflow = "hidden";
  spawnerPanel.style.flex = "1";
  spawnerPanel.style.overflow = "auto";
  spawnerPanel.style.padding = "8px 12px";
  navPanel.style.flex = "1";
  navPanel.style.overflow = "auto";
  navPanel.style.padding = "8px 12px";

  content.appendChild(worldPanel);
  content.appendChild(entitiesPanel);
  content.appendChild(spawnerPanel);
  content.appendChild(navPanel);

  const entitiesSelectionHandler =
    typeof options.onSelectionChanged === "function"
      ? options.onSelectionChanged
      : null;

  const entitiesApi = initEntitiesInspectorPanel(doc, entitiesPanel, {
    getWorld,
    onSelectionChanged: entitiesSelectionHandler,
    onRemoveEntity,
    emitterConfig,
    getEntityLabel,
  });

  const worldApi = initWorldInspectorPanel(doc, worldPanel, {
    getWorld,
    renderConfig,
    physicsConfig,
    statsConfig,
    emitterConfig,
    engineConfig,
    loadJSONFromStorage,
    saveJSONToStorage,
    shaderStorageKey,
    lightStorageKey,
    physicsStorageKey,
  });

  const spawnerApi = initSpawnerInspectorPanel(doc, spawnerPanel, {
    getWorld,
    spawn: spawnConfig,
    entitiesApi,
    emitterConfig,
  });

  const navApi = initNavInspectorPanel(doc, navPanel, {
    getWorld,
  });

  function renderEntitiesPanel() {
    if (
      entitiesApi &&
      typeof entitiesApi.renderEntitiesPanel === "function"
    ) {
      entitiesApi.renderEntitiesPanel();
    }
  }

  function renderActiveTab() {
    worldPanel.style.display = activeTab === "World" ? "block" : "none";
    entitiesPanel.style.display = activeTab === "Entities" ? "block" : "none";
    spawnerPanel.style.display = activeTab === "Spawner" ? "block" : "none";
    navPanel.style.display = activeTab === "Nav" ? "block" : "none";
    if (activeTab === "World") {
      if (worldApi && typeof worldApi.renderWorldPanel === "function") {
        worldApi.renderWorldPanel();
      }
    } else if (activeTab === "Entities") {
      renderEntitiesPanel();
    } else if (activeTab === "Spawner") {
      if (spawnerApi && typeof spawnerApi.renderSpawnerPanel === "function") {
        spawnerApi.renderSpawnerPanel();
      }
    } else if (activeTab === "Nav") {
      if (navApi && typeof navApi.renderNavPanel === "function") {
        navApi.renderNavPanel();
      }
    }
  }

  renderActiveTab();

  const api = {
    root,
    setSelectedEntity(id) {
      if (
        entitiesApi &&
        typeof entitiesApi.setSelectedEntity === "function"
      ) {
        entitiesApi.setSelectedEntity(id);
      }
      if (id != null && activeTab !== "Entities") {
        activeTab = "Entities";
        Object.keys(tabButtons).forEach((key) => {
          const b = tabButtons[key];
          b.style.color = key === activeTab ? "#60a5fa" : "#6b7280";
          b.style.borderBottom =
            key === activeTab ? "2px solid #60a5fa" : "2px solid transparent";
        });
        renderActiveTab();
      }
    },
    show() {
      // Close popup if open, then show main inspector
      if (popupWindow && !popupWindow.closed) {
        popupWindow.close();
        popupWindow = null;
        popupInspector = null;
      }
      root.style.display = "flex";
    },
    hide() {
      root.style.display = "none";
      // Close popup if open
      if (popupWindow && !popupWindow.closed) {
        popupWindow.close();
        popupWindow = null;
        popupInspector = null;
      }
    },
    toggle() {
      const isVisible = root.style.display !== "none";
      if (isVisible) {
        root.style.display = "none";
        if (popupWindow && !popupWindow.closed) {
          popupWindow.close();
          popupWindow = null;
          popupInspector = null;
        }
      } else {
        if (popupWindow && !popupWindow.closed) {
          popupWindow.focus();
        } else {
          root.style.display = "flex";
        }
      }
    },
    isVisible() {
      if (popupWindow && !popupWindow.closed) {
        return true;
      }
      return root.style.display !== "none";
    },
  };

  // Cache API on the root so future calls can return the same API.
  root.__engineInspectorApi = api;

  return api;
}
