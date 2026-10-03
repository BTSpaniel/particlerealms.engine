// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  createEntityInspectorModel,
  setEntityComponentFromInspector,
  removeEntityComponentFromInspector,
} from "./EntityInspector.js";
import {
  createPropertySection,
  addNumberRow,
  showInspectorContextMenu,
  showInspectorTextInputModal,
} from "./ui/InspectorControls.js";
import { createEmitterInspectorCard } from "./panels/spawner/index.js";
import { INSPECTOR_THEME } from "./ui/InspectorTheme.js";
import {
  renderTransformComponentEditor,
} from "./entityEditors/TransformComponentEditor.js";
import { renderLightComponentEditor } from "./entityEditors/LightComponentEditor.js";
import { renderCameraComponentEditor } from "./entityEditors/CameraComponentEditor.js";
import { renderRenderableComponentEditor } from "./entityEditors/RenderableComponentEditor.js";
import { renderJsonComponentEditor } from "./entityEditors/JsonComponentEditor.js";
import { renderPhysicsRopeComponentEditor } from "./entityEditors/PhysicsRopeComponentEditor.js";
import { renderPhysicalMaterialComponentEditor } from "./entityEditors/PhysicalMaterialComponentEditor.js";

let _emitterTraceIdSequence = 0;

function _newEmitterTraceId() {
  return `emitter-${++_emitterTraceIdSequence}`;
}

function createEmitterConfigAdapter(emitter, onPropertyChanged = null) {
  if (!emitter || typeof emitter !== "object") {
    return null;
  }

  // Notify callback when a property changes (for saving to ECS)
  function notifyChange(prop, value) {
    if (typeof onPropertyChanged === 'function') {
      onPropertyChanged(prop, value, emitter);
    }
  }

  function getLifetimePair() {
    const src = Array.isArray(emitter.lifetime) && emitter.lifetime.length >= 2
      ? emitter.lifetime
      : [2.0, 5.0];
    const min = Number(src[0]);
    const max = Number(src[1]);
    const safeMin = Number.isFinite(min) ? min : 2.0;
    const safeMax = Number.isFinite(max) ? max : Math.max(safeMin, 5.0);
    return [safeMin, safeMax];
  }

  function setLifetime(minVal, maxVal) {
    let min = Number(minVal);
    let max = Number(maxVal);
    if (!Number.isFinite(min)) {
      const pair = getLifetimePair();
      min = pair[0];
    }
    if (!Number.isFinite(max)) {
      const pair = getLifetimePair();
      max = pair[1];
    }
    if (min < 0.1) min = 0.1;
    if (max < min) max = min;
    emitter.lifetime = [min, max];
    notifyChange('lifetime', (min + max) / 2);
  }

  function getUpSpeedPair() {
    const src = Array.isArray(emitter.upSpeed) && emitter.upSpeed.length >= 2
      ? emitter.upSpeed
      : [1.0, 3.0];
    const min = Number(src[0]);
    const max = Number(src[1]);
    const safeMin = Number.isFinite(min) ? min : 1.0;
    const safeMax = Number.isFinite(max) ? max : Math.max(safeMin, 3.0);
    return [safeMin, safeMax];
  }

  function setUpSpeed(minVal, maxVal) {
    let min = Number(minVal);
    let max = Number(maxVal);
    if (!Number.isFinite(min)) {
      const pair = getUpSpeedPair();
      min = pair[0];
    }
    if (!Number.isFinite(max)) {
      const pair = getUpSpeedPair();
      max = pair[1];
    }
    if (min < 0) min = 0;
    if (max < min) max = min;
    emitter.upSpeed = [min, max];
    notifyChange('speed', (min + max) / 2);
  }

  const cfg = {};

  Object.defineProperties(cfg, {
    // Pass through state and elements for the full card UI
    // UI uses 'state' but engine reads 'renderMode' — map to both
    state: {
      get() {
        return emitter.renderMode || emitter.state || "gas";
      },
      set(v) {
        emitter.renderMode = v;
        emitter.state = v;
        notifyChange('state', v);
      },
    },
    shape: {
      get() { return emitter.shape || "sphere"; },
      set(v) { emitter.shape = v; },
    },
    elements: {
      get() {
        // Ensure elements array exists
        if (!Array.isArray(emitter.elements)) {
          emitter.elements = [
            { id: "fire", enabled: false, power: 0.0 },
            { id: "smoke", enabled: false, power: 0.0 },
            { id: "water", enabled: false, power: 0.0 },
            { id: "magic", enabled: false, power: 0.0 },
          ];
        }
        return emitter.elements;
      },
      set(v) {
        emitter.elements = v;
      },
    },
    useAimDirection: {
      get() {
        return emitter.useAimDirection !== false;
      },
      set(v) {
        emitter.useAimDirection = !!v;
      },
    },
    emitRate: {
      get() {
        const v = Number(emitter.emitRate);
        return Number.isFinite(v) ? v : 0;
      },
      set(v) {
        const n = Number(v);
        if (Number.isFinite(n)) {
          emitter.emitRate = Math.max(0, n);
          notifyChange('rate', emitter.emitRate);
        }
      },
    },
    pointSize: {
      get() {
        const v = Number(emitter.pointSize);
        return Number.isFinite(v) ? v : 1.0;
      },
      set(v) {
        const n = Number(v);
        if (Number.isFinite(n)) {
          emitter.pointSize = Math.max(0.05, n);
          notifyChange('sizeStart', emitter.pointSize);
        }
      },
    },
    lifetimeMin: {
      get() {
        const pair = getLifetimePair();
        return pair[0];
      },
      set(v) {
        const pair = getLifetimePair();
        setLifetime(v, pair[1]);
      },
    },
    lifetimeMax: {
      get() {
        const pair = getLifetimePair();
        return pair[1];
      },
      set(v) {
        const pair = getLifetimePair();
        setLifetime(pair[0], v);
      },
    },
    gravity: {
      get() {
        const v = Number(emitter.gravity);
        return Number.isFinite(v) ? v : 0;
      },
      set(v) {
        const n = Number(v);
        if (Number.isFinite(n)) {
          emitter.gravity = n;
          notifyChange('gravity', [0, n, 0]);
        }
      },
    },
    upSpeedMin: {
      get() {
        const pair = getUpSpeedPair();
        return pair[0];
      },
      set(v) {
        const pair = getUpSpeedPair();
        setUpSpeed(v, pair[1]);
      },
    },
    upSpeedMax: {
      get() {
        const pair = getUpSpeedPair();
        return pair[1];
      },
      set(v) {
        const pair = getUpSpeedPair();
        setUpSpeed(pair[0], v);
      },
    },
    horizontalSpeed: {
      get() {
        const v = Number(emitter.horizontalSpeed);
        return Number.isFinite(v) ? v : 0;
      },
      set(v) {
        const n = Number(v);
        if (Number.isFinite(n)) {
          emitter.horizontalSpeed = n;
          notifyChange('forward', n);
        }
      },
    },
    // Physics properties
    mass: {
      get() {
        const v = Number(emitter.mass);
        return Number.isFinite(v) ? v : 1.0;
      },
      set(v) {
        const n = Number(v);
        if (Number.isFinite(n)) {
          emitter.mass = Math.max(0.1, n);
          notifyChange('mass', emitter.mass);
        }
      },
    },
    drag: {
      get() {
        const v = Number(emitter.drag);
        return Number.isFinite(v) ? v : 0.02;
      },
      set(v) {
        const n = Number(v);
        if (Number.isFinite(n)) {
          emitter.drag = Math.max(0, Math.min(1, n));
          notifyChange('drag', emitter.drag);
        }
      },
    },
    bounciness: {
      get() {
        const v = Number(emitter.bounciness);
        return Number.isFinite(v) ? v : 0.3;
      },
      set(v) {
        const n = Number(v);
        if (Number.isFinite(n)) {
          emitter.bounciness = Math.max(0, Math.min(1, n));
          notifyChange('bounciness', emitter.bounciness);
        }
      },
    },
    inheritVelocity: {
      get() {
        const v = Number(emitter.inheritVelocity);
        return Number.isFinite(v) ? v : 0.0;
      },
      set(v) {
        const n = Number(v);
        if (Number.isFinite(n)) {
          emitter.inheritVelocity = Math.max(0, Math.min(1, n));
          notifyChange('inheritVelocity', emitter.inheritVelocity);
        }
      },
    },
    collisionEnabled: {
      get() {
        return emitter.collisionEnabled !== false;
      },
      set(v) {
        emitter.collisionEnabled = !!v;
        notifyChange('collisionEnabled', emitter.collisionEnabled);
      },
    },
    // Color and visual properties (needed by EmitterInspectorCard color pickers)
    color: {
      get() { return emitter.color || null; },
      set(v) {
        console.log(`[TRACE adapter.color SET] entityId=${emitter.entityId || emitter.markerEntityId} old=[${emitter.color}] new=[${v}]`);
        emitter.color = v;
        notifyChange('colorStart', v);
      },
    },
    colorEnd: {
      get() { return emitter.colorEnd || null; },
      set(v) { emitter.colorEnd = v; notifyChange('colorEnd', v); },
    },
    _colorOverride: {
      get() { return emitter._colorOverride || false; },
      set(v) { emitter._colorOverride = !!v; },
    },
    opacity: {
      get() { return typeof emitter.opacity === 'number' ? emitter.opacity : 1.0; },
      set(v) { emitter.opacity = Number(v); },
    },
    // Material index (thermal LUT) — must update when elements change
    materialIndex: {
      get() { return emitter.materialIndex ?? 0; },
      set(v) { emitter.materialIndex = Number(v) | 0; notifyChange('materialIndex', emitter.materialIndex); },
    },
    // Substance / preset tracking
    substance: {
      get() { return emitter.substance || null; },
      set(v) { emitter.substance = v; notifyChange('substance', v); },
    },
    temperature: {
      get() { return emitter.temperature ?? 293; },
      set(v) { emitter.temperature = Number(v); notifyChange('temperature', emitter.temperature); },
    },
    phase: {
      get() { return emitter.phase ?? 2; },
      set(v) { emitter.phase = Number(v); notifyChange('phase', emitter.phase); },
    },
    charge: {
      get() { return emitter.charge ?? 0; },
      set(v) { emitter.charge = Number(v); notifyChange('charge', emitter.charge); },
    },
    substanceCharge: {
      get() { return emitter.substanceCharge ?? 0; },
      set(v) { emitter.substanceCharge = Number(v); notifyChange('substanceCharge', emitter.substanceCharge); },
    },
    sphRestDensity: {
      get() { return emitter.sphRestDensity ?? 1000; },
      set(v) { emitter.sphRestDensity = Number(v); notifyChange('sphRestDensity', emitter.sphRestDensity); },
    },
    sphViscosity: {
      get() { return emitter.sphViscosity ?? 0.1; },
      set(v) { emitter.sphViscosity = Number(v); notifyChange('sphViscosity', emitter.sphViscosity); },
    },
    physicsProfile: {
      get() { return emitter.physicsProfile || null; },
      set(v) { emitter.physicsProfile = v; },
    },
    type: {
      get() { return emitter.type || 'fire'; },
      set(v) { emitter.type = v; },
    },
    _activePreset: {
      get() { return emitter._activePreset || null; },
      set(v) { emitter._activePreset = v; },
    },
    // Lifetime and speed aliases used by applyPreset
    riseMin: {
      get() { const pair = getUpSpeedPair(); return pair[0]; },
      set(v) { const pair = getUpSpeedPair(); setUpSpeed(v, pair[1]); },
    },
    riseMax: {
      get() { const pair = getUpSpeedPair(); return pair[1]; },
      set(v) { const pair = getUpSpeedPair(); setUpSpeed(pair[0], v); },
    },
  });

  return cfg;
}

function renderEmitterPropertiesEditor(doc, container, entitiesState, editor) {
  const emitterConfig = entitiesState.emitterConfig;
  const emitter =
    emitterConfig && typeof emitterConfig.getSelectedEmitter === "function"
      ? emitterConfig.getSelectedEmitter()
      : null;

  if (!emitter) {
    const section = createPropertySection(doc, container, "Emitter");
    const msg = doc.createElement("div");
    msg.textContent = "No emitter linked to this entity.";
    msg.style.fontSize = "11px";
    msg.style.color = "#71717a";
    section.appendChild(msg);
    return;
  }

  // Callback to save emitter changes to ECS Emitter component for scene serialization
  // Debounced to avoid spamming saves on every slider drag frame
  let _saveTimer = null;
  const onPropertyChanged = (prop, value, emitterObj) => {
    const entityId = emitter.entityId || emitter.markerEntityId;
    if (entityId == null) return;
    
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      if (typeof emitterConfig.saveEmitterToECS === 'function') {
        emitterConfig.saveEmitterToECS(entityId, prop, value, emitterObj);
      }
    }, 500);
  };

  const adapter = createEmitterConfigAdapter(emitter, onPropertyChanged);
  const traceId = emitter._traceId || _newEmitterTraceId();
  emitter._traceId = traceId;
  console.log(`[TRACE adapter CREATED] entityId=${emitter.entityId || emitter.markerEntityId} emitter.color=[${emitter.color}] emitter.renderMode=${emitter.renderMode} emitter.elements=${JSON.stringify((emitter.elements||[]).map(e=>e.id))} emitterRef=${traceId}`);
  if (!adapter) {
    const section = createPropertySection(doc, container, "Emitter");
    const msg = doc.createElement("div");
    msg.textContent = "Emitter configuration is not available.";
    msg.style.fontSize = "11px";
    msg.style.color = "#71717a";
    section.appendChild(msg);
    return;
  }

  // Read inspector mode from editor settings (defaults to 'simple')
  const editorSettings = editor?.settings || editor?.editorSettings;
  const savedMode = editorSettings?.get?.('emitter', 'inspectorMode') || 'simple';

  // Use the shared modular emitter card - same as Spawner panel
  const entityId = emitter.entityId || emitter.markerEntityId;
  const emitterCard = createEmitterInspectorCard(doc, {
    emitterCfg: adapter,
    inspectorMode: savedMode,
    onModeChange: (mode) => {
      if (editorSettings?.set) editorSettings.set('emitter', 'inspectorMode', mode);
    },
    // Auto-blending spell effect composer callback
    // Called by "Create Spell From This" button → SpellEffectComposer → child emitter entities
    // NOTE: 'editor' param here is a <textarea>, NOT EditorApp. Use entitiesState.getEditor() instead.
    onCreateSpell: (activeElements, baseConfig) => {
      const editorApp = entitiesState.getEditor ? entitiesState.getEditor() : null;
      if (editorApp && typeof editorApp.createComposedSpellEffect === 'function') {
        editorApp.createComposedSpellEffect(editorApp, entityId, activeElements, baseConfig);
      } else {
        console.warn('[EmitterInspector] No spell composer available on editor. editorApp=', editorApp);
      }
    },
    sections: {
      header: true,
      elements: true,
      physics: true,
      matter: true,
      aim: false, // No aim controls in entity editor (no ghost offset)
    },
  });

  container.appendChild(emitterCard.element);
}

function renderComponentEditor(
  doc,
  entitiesState,
  componentEditorContainer,
  editor,
  findEntityById
) {
  const id = entitiesState.selectedEntityId;
  const componentName = entitiesState.selectedComponentName;
  if (id == null || !componentName) {
    return;
  }

  // "Emitter" is a virtual component that edits the live particle emitter
  // linked to this entity via emitterConfig.getSelectedEmitter.
  if (componentName === "Emitter") {
    renderEmitterPropertiesEditor(doc, componentEditorContainer, entitiesState, editor);
    return;
  }

  const entity = findEntityById(id);
  if (!entity || !entity.components) {
    return;
  }
  const value = entity.components[componentName];
  if (componentName === "Transform") {
    renderTransformComponentEditor(doc, componentEditorContainer, entitiesState);
  } else if (componentName === "Light") {
    renderLightComponentEditor(doc, componentEditorContainer, entitiesState);
  } else if (componentName === "Camera") {
    renderCameraComponentEditor(doc, componentEditorContainer, entitiesState);
  } else if (componentName === "Renderable") {
    renderRenderableComponentEditor(doc, componentEditorContainer, entitiesState);
  } else if (componentName === "PhysicsChain" || componentName === "PhysicsRope") {
    renderPhysicsRopeComponentEditor(doc, componentEditorContainer, entitiesState);
  } else if (componentName === "PhysicalMaterial") {
    renderPhysicalMaterialComponentEditor(doc, componentEditorContainer, entitiesState);
  } else {
    renderJsonComponentEditor(doc, componentEditorContainer, editor, value);
  }
}

export function initEntitiesInspectorPanel(doc, entitiesPanel, options = {}) {
  const getWorld =
    options && typeof options.getWorld === "function" ? options.getWorld : null;
  if (!getWorld) {
    return {
      renderEntitiesPanel() {},
    };
  }

  const onSelectionChanged =
    options && typeof options.onSelectionChanged === "function"
      ? options.onSelectionChanged
      : null;

  const onRemoveEntity =
    options && typeof options.onRemoveEntity === "function"
      ? options.onRemoveEntity
      : null;

  const emitterConfig =
    options && typeof options.emitterConfig === "object"
      ? options.emitterConfig
      : null;
  const getEntityLabel =
    options && typeof options.getEntityLabel === "function"
      ? options.getEntityLabel
      : null;
  
  const getSceneData =
    options && typeof options.getSceneData === "function"
      ? options.getSceneData
      : null;
  
  const getSelection =
    options && typeof options.getSelection === "function"
      ? options.getSelection
      : null;
  
  const onSetParent =
    options && typeof options.onSetParent === "function"
      ? options.onSetParent
      : null;

  const onSetFolderParent =
    options && typeof options.onSetFolderParent === "function"
      ? options.onSetFolderParent
      : null;

  const propertiesDockContainer =
    options && options.propertiesDockContainer && options.propertiesDockContainer.appendChild
      ? options.propertiesDockContainer
      : null;
  let propertiesDocked = !!(options && options.propertiesDocked);
  const onPropertiesDockChanged =
    options && typeof options.onPropertiesDockChanged === "function"
      ? options.onPropertiesDockChanged
      : null;

  const onComponentApplied =
    options && typeof options.onComponentApplied === "function"
      ? options.onComponentApplied
      : null;

  const entitiesState = {
    model: null,
    selectedEntityId: null, // Kept for backward compatibility - primary selection
    selectedEntityIds: [], // Multi-select array
    selectionAnchor: null, // For shift-select range
    selectedComponentName: null,
    pendingComponentValue: null,
    expandedFolders: new Set(['scene-root']),
  };
  entitiesState.getWorld = getWorld;
  entitiesState.emitterConfig = emitterConfig;
  entitiesState.getEditor = options && typeof options.getEditor === 'function' ? options.getEditor : null;
  
  // Helper for component editors to get entity labels
  entitiesState.getEntityLabel = (entityId) => {
    if (entityId == null) return null;
    if (typeof getEntityLabel === 'function') {
      try {
        return getEntityLabel(entityId);
      } catch (e) {}
    }
    const sceneData = getSceneData ? getSceneData() : null;
    const meta = sceneData?.entities?.get(entityId);
    return meta?.name || `Entity ${entityId}`;
  };
  
  // Helper for component editors to trigger entity hover highlight
  entitiesState.onEntityHover = (entityId) => {
    if (options && typeof options.onEntityHover === 'function') {
      options.onEntityHover(entityId);
    }
  };
  
  // Helper for component editors to select an entity
  entitiesState.selectEntity = (entityId) => {
    entitiesState.selectedEntityId = entityId;
    entitiesState.selectedEntityIds = entityId != null ? [entityId] : [];
    entitiesState.selectionAnchor = entityId;
    entitiesState.selectedComponentName = null;
    if (onSelectionChanged) onSelectionChanged(entityId);
    refreshEntitiesModel();
  };

  entitiesPanel.style.display = "flex";
  entitiesPanel.style.flexDirection = "column";
  entitiesPanel.style.overflow = "auto";
  entitiesPanel.style.height = "100%";

  const entitiesHeader = doc.createElement("div");
  entitiesHeader.style.display = "flex";
  entitiesHeader.style.alignItems = "center";
  entitiesHeader.style.justifyContent = "space-between";
  entitiesHeader.style.padding = "8px 10px";
  entitiesHeader.style.background = "#0a0a0f";
  entitiesHeader.style.borderBottom = "1px solid #1e1e2e";
  const entitiesTitle = doc.createElement("div");
  entitiesTitle.textContent = "Entities";
  entitiesTitle.style.fontSize = "11px";
  entitiesTitle.style.fontWeight = "600";
  entitiesTitle.style.letterSpacing = "0.06em";
  entitiesTitle.style.textTransform = "uppercase";
  entitiesTitle.style.color = "#71717a";
  const entitiesRefresh = doc.createElement("button");
  entitiesRefresh.textContent = "Refresh";
  entitiesRefresh.style.cursor = "pointer";
  entitiesRefresh.style.fontSize = "11px";
  entitiesRefresh.style.padding = "4px 8px";
  entitiesRefresh.style.borderRadius = "4px";
  entitiesRefresh.style.border = "none";
  entitiesRefresh.style.background = "#3b82f6";
  entitiesRefresh.style.color = "#ffffff";

  const entitiesHeaderActions = doc.createElement("div");
  entitiesHeaderActions.style.display = "flex";
  entitiesHeaderActions.style.alignItems = "center";
  entitiesHeaderActions.style.gap = "6px";
  entitiesHeaderActions.appendChild(entitiesRefresh);

  let dockBtn = null;
  if (propertiesDockContainer) {
    dockBtn = doc.createElement("button");
    dockBtn.style.cursor = "pointer";
    dockBtn.style.fontSize = "11px";
    dockBtn.style.padding = "4px 8px";
    dockBtn.style.borderRadius = "4px";
    dockBtn.style.border = "none";
    dockBtn.style.background = "#27272a";
    dockBtn.style.color = "#e4e4e7";
    entitiesHeaderActions.appendChild(dockBtn);
  }

  entitiesHeader.appendChild(entitiesTitle);
  entitiesHeader.appendChild(entitiesHeaderActions);
  entitiesPanel.appendChild(entitiesHeader);

  const entitiesLayout = doc.createElement("div");
  entitiesLayout.style.display = "flex";
  entitiesLayout.style.flexDirection = "column";
  entitiesLayout.style.gap = "8px";
  entitiesLayout.style.flex = "1";
  entitiesLayout.style.minHeight = "0";
  entitiesLayout.style.overflow = "hidden";
  entitiesPanel.appendChild(entitiesLayout);

  const entityListColumn = doc.createElement("div");
  entityListColumn.style.flex = "0 0 auto";
  entityListColumn.style.minHeight = "120px";
  entityListColumn.style.maxHeight = "250px";
  entityListColumn.style.display = "flex";
  entityListColumn.style.flexDirection = "column";
  entityListColumn.style.background = INSPECTOR_THEME.colors.bg.secondary;
  entityListColumn.style.borderBottom = `1px solid ${INSPECTOR_THEME.colors.border.dark}`;
  entityListColumn.style.borderRadius = INSPECTOR_THEME.radius.lg;

  // Category filter tabs
  const ENTITY_CATEGORIES = [
    { id: "all", label: "All", icon: "📋" },
    { id: "shapes", label: "Shapes", icon: "🔷" },
    { id: "emitters", label: "Emitters", icon: "✨" },
    { id: "lights", label: "Lights", icon: "💡" },
  ];
  let activeCategory = "all";
  const categoryTabButtons = {};

  const categoryTabBar = doc.createElement("div");
  categoryTabBar.style.display = "flex";
  categoryTabBar.style.gap = INSPECTOR_THEME.spacing.xs;
  categoryTabBar.style.padding = INSPECTOR_THEME.spacing.md;
  categoryTabBar.style.borderBottom = `1px solid ${INSPECTOR_THEME.colors.border.medium}`;
  categoryTabBar.style.background = INSPECTOR_THEME.colors.bg.primary;
  categoryTabBar.style.borderRadius = `${INSPECTOR_THEME.radius.lg} ${INSPECTOR_THEME.radius.lg} 0 0`;
  categoryTabBar.style.flexWrap = "wrap";

  function updateCategoryTabs() {
    for (const cat of ENTITY_CATEGORIES) {
      const btn = categoryTabButtons[cat.id];
      if (!btn) continue;
      const isActive = activeCategory === cat.id;
      btn.style.background = isActive ? INSPECTOR_THEME.colors.border.accent : "transparent";
      btn.style.color = isActive ? INSPECTOR_THEME.colors.text.primary : INSPECTOR_THEME.colors.text.muted;
      btn.style.borderColor = isActive ? INSPECTOR_THEME.colors.semantic.info : "transparent";
    }
  }

  for (const cat of ENTITY_CATEGORIES) {
    const btn = doc.createElement("button");
    btn.textContent = `${cat.icon} ${cat.label}`;
    Object.assign(btn.style, INSPECTOR_THEME.components.tab.base);
    btn.onclick = () => {
      activeCategory = cat.id;
      updateCategoryTabs();
      refreshEntitiesModel();
    };
    categoryTabButtons[cat.id] = btn;
    categoryTabBar.appendChild(btn);
  }

  entityListColumn.appendChild(categoryTabBar);
  updateCategoryTabs();

  const entityListContainer = doc.createElement("div");
  entityListContainer.style.flex = "1";
  entityListContainer.style.minHeight = "60px";
  entityListContainer.style.overflowY = "auto";
  entityListContainer.style.overflowX = "hidden";
  entityListContainer.style.padding = "8px";
  entityListColumn.appendChild(entityListContainer);
  entitiesLayout.appendChild(entityListColumn);

  // Helper to determine entity category
  function getEntityCategory(entityId) {
    if (typeof getEntityLabel !== "function") return "shapes";
    try {
      const label = getEntityLabel(entityId);
      if (!label) return "shapes";
      const lower = label.toLowerCase();
      if (lower === "emitter" || lower.includes("emitter")) return "emitters";
      if (lower === "light" || lower.includes("light")) return "lights";
      if (lower === "camera" || lower.includes("camera")) return "cameras";
      return "shapes";
    } catch {
      return "shapes";
    }
  }

  const entityDetailColumn = doc.createElement("div");
  entityDetailColumn.style.flex = "1";
  entityDetailColumn.style.display = "flex";
  entityDetailColumn.style.flexDirection = "column";
  Object.assign(entityDetailColumn.style, INSPECTOR_THEME.components.card.base);
  const componentHeader = doc.createElement("div");
  componentHeader.style.display = "flex";
  componentHeader.style.alignItems = "center";
  componentHeader.style.justifyContent = "space-between";
  componentHeader.style.padding = INSPECTOR_THEME.spacing.md;
  componentHeader.style.borderBottom = `1px solid ${INSPECTOR_THEME.colors.border.dark}`;
  const componentTitle = doc.createElement("div");
  componentTitle.textContent = "Properties";
  componentTitle.style.fontSize = INSPECTOR_THEME.fontSize.xl;
  componentTitle.style.fontWeight = INSPECTOR_THEME.fontWeight.semibold;
  componentTitle.style.color = INSPECTOR_THEME.colors.text.primary;
  componentHeader.appendChild(componentTitle);
  const componentSelect = doc.createElement("select");
  componentSelect.style.maxWidth = "160px";
  componentSelect.style.fontSize = INSPECTOR_THEME.fontSize.md;
  componentSelect.style.padding = `${INSPECTOR_THEME.spacing.xs} ${INSPECTOR_THEME.spacing.sm}`;
  componentSelect.style.background = INSPECTOR_THEME.colors.bg.secondary;
  componentSelect.style.color = INSPECTOR_THEME.colors.text.primary;
  componentSelect.style.border = `1px solid ${INSPECTOR_THEME.colors.border.dark}`;
  componentSelect.style.borderRadius = INSPECTOR_THEME.radius.sm;
  componentHeader.appendChild(componentSelect);
  entityDetailColumn.appendChild(componentHeader);

  const componentEditorContainer = doc.createElement("div");
  componentEditorContainer.style.flex = "1";
  componentEditorContainer.style.overflowY = "auto";
  componentEditorContainer.style.padding = INSPECTOR_THEME.spacing.lg;
  componentEditorContainer.style.display = "flex";
  componentEditorContainer.style.flexDirection = "column";
  componentEditorContainer.style.gap = INSPECTOR_THEME.spacing.md;
  entityDetailColumn.appendChild(componentEditorContainer);

  const editor = doc.createElement("textarea");
  editor.style.flex = "1";
  editor.style.width = "100%";
  editor.style.minHeight = "160px";
  editor.style.fontFamily = "monospace";
  editor.style.fontSize = INSPECTOR_THEME.fontSize.md;
  editor.style.background = INSPECTOR_THEME.colors.bg.secondary;
  editor.style.color = INSPECTOR_THEME.colors.text.primary;
  editor.style.border = `1px solid ${INSPECTOR_THEME.colors.border.dark}`;
  editor.style.borderRadius = INSPECTOR_THEME.radius.md;

  const actionsRow = doc.createElement("div");
  actionsRow.style.display = "flex";
  actionsRow.style.justifyContent = "flex-end";
  actionsRow.style.gap = "6px";
  actionsRow.style.padding = "8px 10px";
  actionsRow.style.borderTop = "1px solid #1e1e2e";
  const applyBtn = doc.createElement("button");
  applyBtn.textContent = "Apply";
  applyBtn.style.cursor = "pointer";
  applyBtn.style.fontSize = "11px";
  applyBtn.style.padding = "6px 10px";
  applyBtn.style.borderRadius = "4px";
  applyBtn.style.border = "none";
  applyBtn.style.background = "#3b82f6";
  applyBtn.style.color = "#ffffff";
  const removeBtn = doc.createElement("button");
  removeBtn.textContent = "Remove";
  removeBtn.style.cursor = "pointer";
  removeBtn.style.fontSize = "11px";
  removeBtn.style.padding = "6px 10px";
  removeBtn.style.borderRadius = "4px";
  removeBtn.style.border = "none";
  removeBtn.style.background = "#b91c1c";
  removeBtn.style.color = "#f9fafb";
  actionsRow.appendChild(applyBtn);
  actionsRow.appendChild(removeBtn);
  entityDetailColumn.appendChild(actionsRow);

  const originalListMaxHeight = entityListColumn.style.maxHeight;
  const originalListFlex = entityListColumn.style.flex;

  function applyPropertiesDockState(nextDocked, notify = false) {
    if (!propertiesDockContainer) {
      entitiesLayout.appendChild(entityDetailColumn);
      return;
    }

    const docked = !!nextDocked;
    propertiesDocked = docked;

    if (dockBtn) {
      dockBtn.textContent = docked ? "Props ←" : "Props →";
      dockBtn.title = docked ? "Show Properties on the left" : "Show Properties on the right";
    }

    if (docked) {
      propertiesDockContainer.appendChild(entityDetailColumn);
      entityListColumn.style.maxHeight = "none";
      entityListColumn.style.flex = "1";
    } else {
      entitiesLayout.appendChild(entityDetailColumn);
      entityListColumn.style.maxHeight = originalListMaxHeight;
      entityListColumn.style.flex = originalListFlex;
    }

    if (notify && onPropertiesDockChanged) {
      onPropertiesDockChanged(docked);
    }
  }

  if (dockBtn) {
    dockBtn.onclick = () => {
      applyPropertiesDockState(!propertiesDocked, true);
    };
  }

  applyPropertiesDockState(propertiesDocked, false);

  componentEditorContainer.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.keyCode !== 13) {
      return;
    }
    const target = e.target;
    if (!target || target.tagName !== "INPUT") {
      return;
    }
    e.preventDefault();
    // Defer to let input onchange handlers run first
    setTimeout(function () {
      applyBtn.click();
    }, 0);
  });

  function clearComponentEditor() {
    while (componentEditorContainer.firstChild) {
      componentEditorContainer.removeChild(componentEditorContainer.firstChild);
    }
  }

  function findEntityById(id) {
    const model = entitiesState.model;
    if (!model || !Array.isArray(model.entities)) {
      return null;
    }
    for (let i = 0; i < model.entities.length; i++) {
      const e = model.entities[i];
      if (e && e.id === id) {
        return e;
      }
    }
    return null;
  }

  function refreshEntitiesModel() {
    const world = getWorld();
    if (!world) {
      entitiesState.model = null;
      entitiesState.selectedEntityId = null;
      entitiesState.selectedEntityIds = [];
      entitiesState.selectionAnchor = null;
      entitiesState.selectedComponentName = null;
      entitiesState.pendingComponentValue = null;
      while (entityListContainer.firstChild) {
        entityListContainer.removeChild(entityListContainer.firstChild);
      }
      componentSelect.innerHTML = "";
      clearComponentEditor();
      if (onSelectionChanged) {
        onSelectionChanged(null);
      }
      return;
    }
    const model = createEntityInspectorModel(world, {});
    entitiesState.model = model;
    const rawList = model.entities || [];

    // Preserve selection based on the full unsorted list
    const existingIds = new Set(rawList.map(e => e?.id).filter(id => id != null));
    
    // Filter out deleted entities from selection
    entitiesState.selectedEntityIds = entitiesState.selectedEntityIds.filter(id => existingIds.has(id));
    
    // Update primary selection
    if (entitiesState.selectedEntityIds.length > 0) {
      entitiesState.selectedEntityId = entitiesState.selectedEntityIds[entitiesState.selectedEntityIds.length - 1];
    } else if (rawList.length > 0) {
      // Auto-select first entity if nothing selected
      entitiesState.selectedEntityId = rawList[0].id;
      entitiesState.selectedEntityIds = [rawList[0].id];
      entitiesState.selectionAnchor = rawList[0].id;
    } else {
      entitiesState.selectedEntityId = null;
      entitiesState.selectedEntityIds = [];
      entitiesState.selectionAnchor = null;
    }

    // Sort for display: newest (highest id) first
    const sortedList = rawList.slice().sort((a, b) => {
      if (!a && !b) return 0;
      if (!a) return 1;
      if (!b) return -1;
      const aid = a.id | 0;
      const bid = b.id | 0;
      return bid - aid;
    });

    // Filter by active category
    const list = activeCategory === "all"
      ? sortedList
      : sortedList.filter(e => e && getEntityCategory(e.id) === activeCategory);

    // Update tab counts
    const counts = { all: sortedList.length, shapes: 0, emitters: 0, lights: 0 };
    for (const e of sortedList) {
      if (!e) continue;
      const cat = getEntityCategory(e.id);
      if (counts[cat] !== undefined) counts[cat]++;
    }
    for (const cat of ENTITY_CATEGORIES) {
      const btn = categoryTabButtons[cat.id];
      if (btn) {
        btn.textContent = `${cat.icon} ${cat.label} (${counts[cat.id] || 0})`;
      }
    }

    while (entityListContainer.firstChild) {
      entityListContainer.removeChild(entityListContainer.firstChild);
    }
    
    // Track expanded folders
    if (!entitiesState.expandedFolders) {
      entitiesState.expandedFolders = new Set(['scene-root']);
    }
    
    // Context menu element (reused) - styled like editor/mats

    function showModalTextInput(title, defaultValue, onSubmit) {
      showInspectorTextInputModal(doc, {
        id: "entity-modal",
        title,
        value: defaultValue,
        onSubmit,
      });
    }
 
    let targetFolderId = null;
    let contextSceneFolders = null;
 
    function showContextMenu(x, y, targetId, isFolder, folderId) {
      targetFolderId = folderId;
      contextSceneFolders = sceneData?.folders || new Map();
      const isSceneRoot = isFolder && folderId === 'scene-root';
      const isMultiSelect = entitiesState.selectedEntityIds.length > 1;
      const deleteLabel = isMultiSelect ? `Delete (${entitiesState.selectedEntityIds.length})` : "Delete";
      const menuSchema = [
        { label: "New Folder", action: "new-folder" },
        { label: "Rename", action: "rename", disabled: isSceneRoot || isMultiSelect, shortcut: "F2" },
        { label: "Duplicate", action: "duplicate", disabled: isFolder || isMultiSelect, shortcut: "Ctrl+D" },
        { type: "separator" },
        { label: "Save as Prefab", action: "save-prefab", disabled: !isFolder || isSceneRoot },
        { label: "Instantiate Prefab", action: "instantiate-prefab", disabled: !isFolder || isSceneRoot },
        { type: "separator" },
        { label: deleteLabel, action: "delete", disabled: isSceneRoot, danger: true, shortcut: "Del" },
      ];

      showInspectorContextMenu(doc, {
        id: "entity-context-menu",
        x,
        y,
        items: menuSchema,
        onAction: (action) => {
          if (action === "new-folder") {
            showModalTextInput("New Folder", "New Folder", (name) => {
              if (name && options && typeof options.onCreateFolder === "function") {
                const parentId = isFolder && targetFolderId && !isSceneRoot ? targetFolderId : null;
                options.onCreateFolder(name, parentId);
              }
            });
            return;
          }

          if (action === "rename") {
            let currentName = "";
            if (isFolder && targetFolderId && !isSceneRoot) {
              const folderData = contextSceneFolders.get(targetFolderId);
              currentName = folderData?.name || "";
            } else if (targetId != null) {
              const meta = sceneEntities.get(targetId);
              currentName = meta?.name || "";
            }
            if (!currentName) {
              currentName = isFolder ? "New Folder" : `Entity ${targetId}`;
            }

            showModalTextInput("Rename", currentName, (newName) => {
              if (!newName) {
                return;
              }
              if (isFolder && targetFolderId && !isSceneRoot && options?.onRenameFolder) {
                options.onRenameFolder(targetFolderId, newName);
              } else if (targetId != null && options?.onRenameEntity) {
                options.onRenameEntity(targetId, newName);
              }
            });
            return;
          }

          if (action === "delete") {
            console.log('[EntitiesInspectorPanel] Delete action triggered');
            console.log('[EntitiesInspectorPanel] isFolder:', isFolder, 'targetFolderId:', targetFolderId);
            
            // Handle folder deletion
            if (isFolder && targetFolderId && targetFolderId !== 'scene-root') {
              console.log('[EntitiesInspectorPanel] Attempting to delete folder:', targetFolderId);
              console.log('[EntitiesInspectorPanel] onDeleteFolder callback exists?', !!(options && typeof options.onDeleteFolder === 'function'));
              
              if (options && typeof options.onDeleteFolder === 'function') {
                console.log('[EntitiesInspectorPanel] Calling onDeleteFolder for:', targetFolderId);
                options.onDeleteFolder(targetFolderId);
                console.log('[EntitiesInspectorPanel] onDeleteFolder completed');
              } else {
                console.error('[EntitiesInspectorPanel] No onDeleteFolder callback available!');
              }
              return;
            }
            
            console.log('[EntitiesInspectorPanel] Handling entity deletion');
            console.log('[EntitiesInspectorPanel] selectedEntityIds:', entitiesState.selectedEntityIds);
            console.log('[EntitiesInspectorPanel] targetId:', targetId);
            
            // Handle entity deletion (single or multi-select)
            if (onRemoveEntity) {
              const world = getWorld();
              if (!world) {
                console.error('[EntitiesInspectorPanel] No world available for entity deletion');
                return;
              }
              
              // Delete all selected entities
              const idsToDelete = entitiesState.selectedEntityIds.length > 0 
                ? [...entitiesState.selectedEntityIds] 
                : (targetId != null ? [targetId] : []);
              
              console.log('[EntitiesInspectorPanel] Deleting entities:', idsToDelete);
              
              for (const id of idsToDelete) {
                onRemoveEntity(world, id);
              }
              
              // Clear selection after deletion
              entitiesState.selectedEntityId = null;
              entitiesState.selectedEntityIds = [];
              entitiesState.selectionAnchor = null;
            } else {
              console.error('[EntitiesInspectorPanel] No onRemoveEntity callback available!');
            }
            return;
          }

          if (action === "duplicate" && targetId != null) {
            if (options && typeof options.onDuplicateEntity === "function") {
              options.onDuplicateEntity(targetId);
            }
            return;
          }

          if (action === "save-prefab") {
            console.log('[EntitiesInspectorPanel] Save as prefab:', targetFolderId);
            if (targetFolderId && options && typeof options.onSaveFolderAsPrefab === "function") {
              options.onSaveFolderAsPrefab(targetFolderId);
            }
            return;
          }

          if (action === "instantiate-prefab") {
            console.log('[EntitiesInspectorPanel] Instantiate prefab:', targetFolderId);
            if (targetFolderId && options && typeof options.onInstantiatePrefabFromFolder === "function") {
              options.onInstantiatePrefabFromFolder(targetFolderId);
            }
            return;
          }
        },
      });
    }
    
    // Get scene hierarchy data
    const sceneData = getSceneData ? getSceneData() : null;
    const sceneName = sceneData?.name || 'Scene';
    const sceneEntities = sceneData?.entities || new Map();
    const sceneRoot = sceneData?.root || [];

    const handleListContextMenu = (evt) => {
      if (evt.target && evt.target.closest && evt.target.closest('[data-entity-tree-item="1"]')) {
        return;
      }
      evt.preventDefault();
      evt.stopPropagation();
      showContextMenu(evt.clientX, evt.clientY, null, true, 'scene-root');
    };
    entityListContainer.oncontextmenu = handleListContextMenu;
    entityListColumn.oncontextmenu = handleListContextMenu;
    
    // Helper to get entity icon
    function getEntityIcon(e) {
      if (!e || !e.components) return "📦";
      if (e.components.Camera) return "🎥";
      if (e.components.Light) {
        return e.components.Light.type === "directional" ? "☀️" : "💡";
      }
      if (e.components.Emitter) return "✨";
      if (e.components.PhysicsChain) return "🔗";
      if (e.components.PhysicsRope) return "🔗"; // Legacy
      if (e.components.PhysicsWire) return "〰️";
      if (e.components.PhysicsHair) return "💇";
      if (e.components.PhysicsCloth) return "🧵";
      if (e.components.PhysicsSoftBody) return "🫧";
      return "📦";
    }
    
    // Helper to render a tree item
    function renderTreeItem(entityData, depth, isFolder) {
      const id = entityData?.id;
      const meta = id != null ? sceneEntities.get(id) : null;
      const children = meta?.children || [];
      const hasChildren = children.length > 0 || isFolder;
      const isExpanded = entitiesState.expandedFolders.has(isFolder ? entityData.folderId : `entity-${id}`);
      
      const item = doc.createElement("div");
      item.dataset.entityTreeItem = "1";
      if (!isFolder && id != null) {
        item.dataset.entityId = String(id);
      }
      item.style.padding = "6px 8px";
      item.style.transition = "all 0.15s ease";
      item.style.paddingLeft = `${12 + depth * 16}px`;
      item.style.display = "flex";
      item.style.alignItems = "center";
      item.style.gap = "6px";
      item.style.cursor = "pointer";
      item.style.fontSize = "12px";
      item.style.borderRadius = "4px";
      item.style.marginBottom = "2px";
      
      // Check if this item is selected
      const isSelected = !isFolder && entitiesState.selectedEntityIds.includes(id);
      item.style.background = isSelected ? "rgba(59,130,246,0.18)" : "transparent";
      item.style.color = isSelected ? "#60a5fa" : "#e4e4e7";
      
      item.onmouseenter = () => { if (!isSelected) item.style.background = "rgba(255,255,255,0.05)"; };
      item.onmouseleave = () => { if (!isSelected) item.style.background = "transparent"; };
      
      // Expand/collapse arrow for items with children
      const arrow = doc.createElement("span");
      arrow.style.width = "14px";
      arrow.style.fontSize = "10px";
      arrow.style.color = "#71717a";
      arrow.style.userSelect = "none";
      if (hasChildren) {
        arrow.textContent = isExpanded ? "▼" : "▶";
        arrow.style.cursor = "pointer";
        arrow.onclick = (evt) => {
          evt.stopPropagation();
          const key = isFolder ? entityData.folderId : `entity-${id}`;
          if (entitiesState.expandedFolders.has(key)) {
            entitiesState.expandedFolders.delete(key);
          } else {
            entitiesState.expandedFolders.add(key);
          }
          refreshEntitiesModel();
        };
      }
      item.appendChild(arrow);
      
      // Icon
      const icon = doc.createElement("span");
      icon.style.fontSize = "14px";
      if (isFolder) {
        // Check if folder has a prefab ID (is a saved prefab)
        const folderData = sceneFolders?.get(entityData.folderId);
        const isPrefab = folderData?.prefabId != null;
        
        if (isPrefab) {
          icon.textContent = "📦"; // Package icon for prefabs
          icon.style.filter = "hue-rotate(240deg)"; // Make it blue
        } else {
          icon.textContent = isExpanded ? "📂" : "📁";
        }
      } else {
        const eData = list.find(x => x && x.id === id);
        icon.textContent = getEntityIcon(eData);
      }
      item.appendChild(icon);
      
      // Name
      const nameEl = doc.createElement("span");
      nameEl.style.flex = "1";
      nameEl.style.overflow = "hidden";
      nameEl.style.textOverflow = "ellipsis";
      nameEl.style.whiteSpace = "nowrap";
      if (isFolder) {
        nameEl.textContent = entityData.name;
        nameEl.style.fontWeight = "600";
      } else {
        let displayLabel = meta?.name || `Entity ${id}`;
        if (typeof getEntityLabel === "function") {
          try {
            const label = getEntityLabel(id);
            if (label) displayLabel = label;
          } catch (err) {}
        }
        nameEl.textContent = displayLabel;
        
        // Apply hidden styling from scene data (persists across refreshes)
        const sceneDataCheck = getSceneData ? getSceneData() : null;
        const sceneMetaCheck = sceneDataCheck?.entities?.get(id);
        if (sceneMetaCheck?.hidden) {
          nameEl.style.opacity = "0.4";
          nameEl.style.textDecoration = "line-through";
        }
      }
      item.appendChild(nameEl);
      
      // Visibility toggle (eye icon) - bigger and more visible
      if (!isFolder) {
        const visBtn = doc.createElement("span");
        // Read hidden state from actual scene data, not entityData (which is recreated on refresh)
        const sceneDataForHidden = getSceneData ? getSceneData() : null;
        const sceneMeta = sceneDataForHidden?.entities?.get(id);
        const isHidden = sceneMeta?.hidden === true;
        visBtn.textContent = isHidden ? "🚫" : "👁";
        visBtn.style.fontSize = "16px";
        visBtn.style.opacity = isHidden ? "0.4" : "1";
        visBtn.style.cursor = "pointer";
        visBtn.style.padding = "2px 4px";
        visBtn.style.borderRadius = "4px";
        visBtn.style.transition = "all 0.15s ease";
        visBtn.style.background = isHidden ? "rgba(239,68,68,0.2)" : "transparent";
        visBtn.title = isHidden ? "Show entity" : "Hide entity";
        visBtn.onmouseenter = () => { visBtn.style.background = isHidden ? "rgba(239,68,68,0.3)" : "rgba(59,130,246,0.2)"; visBtn.style.transform = "scale(1.1)"; };
        visBtn.onmouseleave = () => { visBtn.style.background = isHidden ? "rgba(239,68,68,0.2)" : "transparent"; visBtn.style.transform = "scale(1)"; };
        visBtn.onclick = (evt) => {
          evt.stopPropagation();
          // Toggle hidden state
          const sceneData = getSceneData ? getSceneData() : null;
          if (sceneData && sceneData.entities) {
            const meta = sceneData.entities.get(id);
            if (meta) {
              meta.hidden = !meta.hidden;
              visBtn.textContent = meta.hidden ? "🚫" : "👁";
              visBtn.style.opacity = meta.hidden ? "0.4" : "1";
              visBtn.style.background = meta.hidden ? "rgba(239,68,68,0.2)" : "transparent";
              visBtn.title = meta.hidden ? "Show entity" : "Hide entity";
              // Update item appearance
              nameEl.style.opacity = meta.hidden ? "0.4" : "1";
              nameEl.style.textDecoration = meta.hidden ? "line-through" : "none";
            }
          }
        };
        item.appendChild(visBtn);
      }
      
      // Right-click context menu
      item.oncontextmenu = (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        showContextMenu(evt.clientX, evt.clientY, id, isFolder, entityData?.folderId || null);
      };
      
      if (!isFolder) {
        item.onclick = (evt) => {
          const ctrlKey = evt.ctrlKey || evt.metaKey; // Support Cmd on Mac
          const shiftKey = evt.shiftKey;
          
          // Get flat list of all entity IDs in display order
          const allEntityIds = [];
          const collectIds = (entities) => {
            for (const e of entities) {
              if (e && e.id != null) {
                allEntityIds.push(e.id);
                const meta = sceneEntities.get(e.id);
                if (meta && meta.children && meta.children.length > 0) {
                  const childEntities = meta.children
                    .map(cid => list.find(x => x && x.id === cid))
                    .filter(Boolean);
                  collectIds(childEntities);
                }
              }
            }
          };
          collectIds(list);
          
          if (shiftKey && entitiesState.selectionAnchor != null) {
            // Shift-select: select range from anchor to clicked item
            const anchorIdx = allEntityIds.indexOf(entitiesState.selectionAnchor);
            const clickedIdx = allEntityIds.indexOf(id);
            
            if (anchorIdx >= 0 && clickedIdx >= 0) {
              const start = Math.min(anchorIdx, clickedIdx);
              const end = Math.max(anchorIdx, clickedIdx);
              const rangeIds = allEntityIds.slice(start, end + 1);
              
              if (ctrlKey) {
                // Ctrl+Shift: Add range to existing selection
                const combined = new Set([...entitiesState.selectedEntityIds, ...rangeIds]);
                entitiesState.selectedEntityIds = Array.from(combined);
              } else {
                // Shift only: Replace selection with range
                entitiesState.selectedEntityIds = rangeIds;
              }
            }
          } else if (ctrlKey) {
            // Ctrl-click: Toggle selection
            const idx = entitiesState.selectedEntityIds.indexOf(id);
            if (idx >= 0) {
              entitiesState.selectedEntityIds.splice(idx, 1);
            } else {
              entitiesState.selectedEntityIds.push(id);
            }
            entitiesState.selectionAnchor = id;
          } else {
            // Normal click: Select only this item
            entitiesState.selectedEntityIds = [id];
            entitiesState.selectionAnchor = id;
          }
          
          // Update primary selection to last selected (for properties panel)
          entitiesState.selectedEntityId = entitiesState.selectedEntityIds.length > 0 
            ? entitiesState.selectedEntityIds[entitiesState.selectedEntityIds.length - 1] 
            : null;
          
          entitiesState.selectedComponentName = null;
          if (onSelectionChanged) onSelectionChanged(entitiesState.selectedEntityId);
          refreshEntitiesModel();
        };
        
        // Drag support
        item.draggable = true;
        item.ondragstart = (evt) => {
          evt.dataTransfer.setData("application/x-entity", String(id));
          evt.dataTransfer.setData("text/plain", String(id));
          evt.dataTransfer.effectAllowed = "move";
        };
      } else {
        item.draggable = true;
        item.ondragstart = (evt) => {
          const folderKey = entityData?.folderId || "";
          evt.dataTransfer.setData("application/x-folder", String(folderKey));
          evt.dataTransfer.setData("text/plain", `folder:${folderKey}`);
          evt.dataTransfer.effectAllowed = "move";
        };
      }
      
      // Drop support - allow dropping entities onto other entities to parent them
      item.ondragover = (evt) => {
        evt.preventDefault();
        evt.dataTransfer.dropEffect = "move";
        item.style.outline = "1px dashed #60a5fa";
      };
      item.ondragleave = () => {
        item.style.outline = "none";
      };
      item.ondrop = (evt) => {
        evt.preventDefault();
        item.style.outline = "none";
        const folderPayload = evt.dataTransfer.getData("application/x-folder");
        const entityPayload = evt.dataTransfer.getData("application/x-entity") || evt.dataTransfer.getData("text/plain");

        if (folderPayload) {
          if (isFolder && onSetFolderParent) {
            const targetFolderId = entityData.folderId || null;
            const parentId = targetFolderId === "scene-root" ? null : targetFolderId;
            if (folderPayload && folderPayload !== parentId) {
              onSetFolderParent(folderPayload, parentId);
            }
          }
          return;
        }

        const draggedId = parseInt(entityPayload, 10);
        if (!isNaN(draggedId) && draggedId !== id) {
          // Get all entities to move (selected items if dragged item is selected, otherwise just dragged item)
          const entitiesToMove = entitiesState.selectedEntityIds.includes(draggedId)
            ? [...entitiesState.selectedEntityIds]
            : [draggedId];
          
          if (isFolder && entityData.folderId) {
            const folderTarget = entityData.folderId === "scene-root" ? null : entityData.folderId;
            if (options && typeof options.onMoveToFolder === "function") {
              for (const entityId of entitiesToMove) {
                options.onMoveToFolder(entityId, folderTarget);
              }
            }
          } else if (!isFolder && onSetParent) {
            // Drop onto entity - parent to entity
            for (const entityId of entitiesToMove) {
              if (entityId !== id) {
                onSetParent(entityId, id);
              }
            }
          }
        }
      };
      
      return { item, children, isExpanded, id };
    }
    
    // Get folders from scene data
    const sceneFolders = sceneData?.folders || new Map();

    const getFolderChildren = (parentId) => {
      const ids = [];
      if (!sceneFolders || sceneFolders.size === 0) return ids;
      for (const [folderId, folderData] of sceneFolders) {
        const parent = folderData?.parent ?? null;
        if (parentId == null ? parent == null : parent === parentId) {
          ids.push(folderId);
        }
      }
      return ids;
    };

    const renderChildrenEntities = (childIds, depth) => {
      for (const childId of childIds) {
        const childEntity = list.find(x => x && x.id === childId);
        if (!childEntity) continue;
        const childNode = renderTreeItem(childEntity, depth, false);
        entityListContainer.appendChild(childNode.item);
        if (childNode.isExpanded && childNode.children.length > 0) {
          renderChildrenEntities(childNode.children, depth + 1);
        }
      }
    };

    const renderEntityNode = (entity, depth) => {
      const node = renderTreeItem(entity, depth, false);
      entityListContainer.appendChild(node.item);
      if (node.isExpanded && node.children.length > 0) {
        renderChildrenEntities(node.children, depth + 1);
      }
    };

    const renderFolderNode = (folderId, depth) => {
      const folderData = sceneFolders.get(folderId);
      if (!folderData) return;
      const folderNode = renderTreeItem({ folderId, name: folderData.name }, depth, true);
      entityListContainer.appendChild(folderNode.item);

      if (!folderNode.isExpanded) return;

      const childFolderIds = getFolderChildren(folderId);
      for (const childId of childFolderIds) {
        renderFolderNode(childId, depth + 1);
      }

      const folderEntities = Array.isArray(folderData.entities) ? folderData.entities : [];
      const folderEntitySet = new Set(folderEntities);
      const rootFolderEntities = folderEntities
        .map((entityId) => list.find(x => x && x.id === entityId))
        .filter((e) => {
          if (!e) return false;
          const meta = sceneEntities.get(e.id);
          const parentId = meta?.parent;
          return parentId == null || !folderEntitySet.has(parentId);
        });

      for (const entity of rootFolderEntities) {
        renderEntityNode(entity, depth + 1);
      }
    };

    // Render scene root
    const sceneRoot_ = renderTreeItem({ folderId: 'scene-root', name: sceneName }, 0, true);
    entityListContainer.appendChild(sceneRoot_.item);
    
    if (sceneRoot_.isExpanded) {
      const rootFolderIds = getFolderChildren(null);
      for (const folderId of rootFolderIds) {
        renderFolderNode(folderId, 1);
      }

      // Render root entities (not parented and not in folders)
      const entitiesInFolders = new Set();
      for (const [, folderData] of sceneFolders) {
        if (folderData.entities) {
          for (const id of folderData.entities) entitiesInFolders.add(id);
        }
      }
      
      const rootEntities = sceneRoot.length > 0 
        ? list.filter(e => e && sceneRoot.includes(e.id) && !entitiesInFolders.has(e.id))
        : list.filter(e => e && !entitiesInFolders.has(e.id));
      
      for (const e of rootEntities) {
        if (!e) continue;
        const meta = sceneEntities.get(e.id);
        // Skip entities that have a parent (they'll be rendered under their parent)
        if (meta && meta.parent != null) continue;
        renderEntityNode(e, 1);
      }
    }

    refreshComponentsForSelectedEntity();
  }

  function refreshComponentsForSelectedEntity() {
    componentSelect.innerHTML = "";
    editor.value = "";
    const id = entitiesState.selectedEntityId;
    const entity = findEntityById(id);
    
    // Hide properties panel when nothing selected
    if (!entity || !entity.components) {
      entityDetailColumn.style.display = "none";
      return;
    }
    entityDetailColumn.style.display = "flex";
    
    let names = Object.keys(entity.components);
    
    // Always show PhysicalMaterial in dropdown for mesh entities (Collider/Renderable/PhysicsBody)
    const isMeshEntity = entity.components.Collider || entity.components.Renderable || entity.components.PhysicsBody;
    if (isMeshEntity && !names.includes("PhysicalMaterial")) {
      names.push("PhysicalMaterial");
    }
    let hasEmitter = false;
    if (
      entitiesState.emitterConfig &&
      typeof entitiesState.emitterConfig.getSelectedEmitter === "function"
    ) {
      const linkedEmitter = entitiesState.emitterConfig.getSelectedEmitter();
      // Only show Emitter component if this entity IS the emitter's marker
      if (linkedEmitter && linkedEmitter.markerEntityId != null) {
        const markerId = Number(linkedEmitter.markerEntityId);
        const selectedId = Number(id);
        if (Number.isFinite(markerId) && Number.isFinite(selectedId) && markerId === selectedId) {
          hasEmitter = true;
        }
      }
    }
    if (names.length === 0 && !hasEmitter) {
      return;
    }
    if (names.length > 0) {
      names.sort();
    }
    if (hasEmitter) {
      names.unshift("Emitter");
    }
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const option = doc.createElement("option");
      option.value = name;
      option.textContent = name;
      componentSelect.appendChild(option);
    }
    // Default to specialized component if present, otherwise Transform
    let defaultComponent = names[0];
    if (hasEmitter) {
      defaultComponent = "Emitter";
    } else if (names.includes("PhysicsChain")) {
      defaultComponent = "PhysicsChain";
    } else if (names.includes("PhysicsRope")) {
      defaultComponent = "PhysicsRope";
    } else if (names.includes("PhysicsBalloon")) {
      defaultComponent = "PhysicsBalloon";
    } else if (names.includes("PhysicsFluid")) {
      defaultComponent = "PhysicsFluid";
    } else if (names.includes("PhysicsSoftBody")) {
      defaultComponent = "PhysicsSoftBody";
    } else if (names.includes("Transform")) {
      defaultComponent = "Transform";
    }
    entitiesState.selectedComponentName = defaultComponent;
    componentSelect.value = defaultComponent;
    refreshEditorFromSelection();
  }

  function refreshEditorFromSelection() {
    clearComponentEditor();
    const id = entitiesState.selectedEntityId;
    const componentName = entitiesState.selectedComponentName;
    if (id == null) {
      entitiesState.pendingComponentValue = null;
      return;
    }

    const hierarchySceneData = getSceneData ? getSceneData() : null;
    const hierarchyEntities = hierarchySceneData?.entities;
    if (hierarchyEntities && typeof hierarchyEntities.get === "function") {
      const meta = hierarchyEntities.get(id);
      const parentId = meta?.parent;
      const childIds = Array.isArray(meta?.children) ? meta.children : [];
      
      // Find connected entities (ropes attached to this entity)
      const connectedRopes = [];
      for (const [otherId, otherMeta] of hierarchyEntities) {
        if (otherId === id) continue;
        const otherEntity = findEntityById(otherId);
        const ropeComp = otherEntity?.components?.PhysicsChain || otherEntity?.components?.PhysicsRope;
        if (ropeComp) {
          const rope = ropeComp;
          if (rope.startEntityId === id || rope.endEntityId === id) {
            connectedRopes.push({ id: otherId, name: otherMeta?.name || `Rope ${otherId}` });
          }
        }
      }
      
      // Find welded entities from editor's weld system
      const weldedEntities = [];
      const editorRef = options?.getEditor ? options.getEditor() : null;
      if (editorRef) {
        // Check if this entity is a weld parent with children
        const weldChildren = editorRef.weldParentChildren?.get(id);
        if (weldChildren && weldChildren.length > 0) {
          for (const childId of weldChildren) {
            const childMeta = hierarchyEntities.get(childId);
            weldedEntities.push({ id: childId, name: childMeta?.name || `Entity ${childId}`, relation: 'child' });
          }
        }
        
        // Check if this entity is a weld child - find its parent
        if (editorRef.weldChildEntities?.has(id)) {
          for (const [parentEntityId, children] of editorRef.weldParentChildren || []) {
            if (children.includes(id)) {
              const parentMeta = hierarchyEntities.get(parentEntityId);
              weldedEntities.push({ id: parentEntityId, name: parentMeta?.name || `Entity ${parentEntityId}`, relation: 'parent' });
              break;
            }
          }
        }
        
        // Check emitter weld parents (emitters welded to physics bodies)
        if (editorRef.emitterWeldParents) {
          // If this is an emitter, find what it's welded to
          const weldParent = editorRef.emitterWeldParents.get(id);
          if (weldParent != null) {
            const parentMeta = hierarchyEntities.get(weldParent);
            weldedEntities.push({ id: weldParent, name: parentMeta?.name || `Entity ${weldParent}`, relation: 'parent' });
          }
          // If this is a parent, find emitters welded to it
          for (const [emitterId, parentEntityId] of editorRef.emitterWeldParents) {
            if (parentEntityId === id) {
              const emitterMeta = hierarchyEntities.get(emitterId);
              weldedEntities.push({ id: emitterId, name: emitterMeta?.name || `Emitter ${emitterId}`, relation: 'child' });
            }
          }
        }
      }
      
      // Only show connections section if there are actual relationships
      const hasRelationships = parentId != null || childIds.length > 0 || connectedRopes.length > 0 || weldedEntities.length > 0;
      if (hasRelationships) {
        const section = createPropertySection(doc, componentEditorContainer, "Connections");

        // Helper for link buttons
        const makeLinkButton = (targetId, labelText) => {
          const btn = doc.createElement("button");
          btn.textContent = labelText;
          btn.style.cssText = `
            background: transparent;
            border: none;
            padding: 2px 4px;
            cursor: pointer;
            color: ${INSPECTOR_THEME.colors.text.accent};
            font-size: ${INSPECTOR_THEME.fontSize.lg};
            text-align: left;
            border-radius: 4px;
            transition: all 0.15s ease;
          `;
          btn.onmouseenter = () => { 
            btn.style.textDecoration = "underline";
            btn.style.background = "rgba(59, 130, 246, 0.15)";
            // Highlight in list
            const listItem = entityListContainer.querySelector(`[data-entity-id="${targetId}"]`);
            if (listItem) {
              listItem.style.background = "rgba(59, 130, 246, 0.25)";
              listItem.style.boxShadow = "0 0 8px rgba(59, 130, 246, 0.4)";
              listItem.style.animation = "entityPulse 1s ease-in-out infinite";
            }
            if (options?.onEntityHover) options.onEntityHover(targetId);
          };
          btn.onmouseleave = () => { 
            btn.style.textDecoration = "none";
            btn.style.background = "transparent";
            const listItem = entityListContainer.querySelector(`[data-entity-id="${targetId}"]`);
            if (listItem) {
              listItem.style.background = "";
              listItem.style.boxShadow = "";
              listItem.style.animation = "";
            }
            if (options?.onEntityHover) options.onEntityHover(null);
          };
          btn.onclick = () => {
            entitiesState.selectedEntityId = targetId;
            entitiesState.selectedEntityIds = [targetId];
            entitiesState.selectedComponentName = null;
            if (onSelectionChanged) onSelectionChanged(targetId);
            refreshEntitiesModel();
          };
          return btn;
        };

        // Parent row (only if has parent)
        if (parentId != null) {
          const parentRow = doc.createElement("div");
          parentRow.style.cssText = `display: grid; grid-template-columns: 70px 1fr; gap: 8px; align-items: center; margin-bottom: 6px;`;
          const parentLabel = doc.createElement("div");
          parentLabel.textContent = "Parent";
          parentLabel.style.cssText = `font-size: 12px; color: ${INSPECTOR_THEME.colors.text.muted};`;
          parentRow.appendChild(parentLabel);
          const parentMeta = hierarchyEntities.get(parentId);
          parentRow.appendChild(makeLinkButton(parentId, parentMeta?.name || `Entity ${parentId}`));
          section.appendChild(parentRow);
        }

        // Children row (only if has children)
        if (childIds.length > 0) {
          const childrenRow = doc.createElement("div");
          childrenRow.style.cssText = `display: grid; grid-template-columns: 70px 1fr; gap: 8px; align-items: start; margin-bottom: 6px;`;
          const childrenLabel = doc.createElement("div");
          childrenLabel.textContent = "Children";
          childrenLabel.style.cssText = `font-size: 12px; color: ${INSPECTOR_THEME.colors.text.muted};`;
          childrenRow.appendChild(childrenLabel);
          const childrenValue = doc.createElement("div");
          childrenValue.style.cssText = `display: flex; flex-direction: column; gap: 4px;`;
          for (const childId of childIds) {
            const childMeta = hierarchyEntities.get(childId);
            childrenValue.appendChild(makeLinkButton(childId, childMeta?.name || `Entity ${childId}`));
          }
          childrenRow.appendChild(childrenValue);
          section.appendChild(childrenRow);
        }

        // Connected ropes (only if has connected ropes)
        if (connectedRopes.length > 0) {
          const ropesRow = doc.createElement("div");
          ropesRow.style.cssText = `display: grid; grid-template-columns: 70px 1fr; gap: 8px; align-items: start; margin-bottom: 6px;`;
          const ropesLabel = doc.createElement("div");
          ropesLabel.textContent = "Ropes";
          ropesLabel.style.cssText = `font-size: 12px; color: ${INSPECTOR_THEME.colors.text.muted};`;
          ropesRow.appendChild(ropesLabel);
          const ropesValue = doc.createElement("div");
          ropesValue.style.cssText = `display: flex; flex-direction: column; gap: 4px;`;
          for (const rope of connectedRopes) {
            ropesValue.appendChild(makeLinkButton(rope.id, rope.name));
          }
          ropesRow.appendChild(ropesValue);
          section.appendChild(ropesRow);
        }
        
        // Welded entities (only if has welded entities)
        if (weldedEntities.length > 0) {
          const weldRow = doc.createElement("div");
          weldRow.style.cssText = `display: grid; grid-template-columns: 70px 1fr; gap: 8px; align-items: start; margin-bottom: 6px;`;
          const weldLabel = doc.createElement("div");
          weldLabel.textContent = "Welded";
          weldLabel.style.cssText = `font-size: 12px; color: ${INSPECTOR_THEME.colors.text.muted};`;
          weldRow.appendChild(weldLabel);
          const weldValue = doc.createElement("div");
          weldValue.style.cssText = `display: flex; flex-direction: column; gap: 4px;`;
          for (const weld of weldedEntities) {
            const linkBtn = makeLinkButton(weld.id, weld.name);
            // Add relation indicator
            const indicator = doc.createElement("span");
            indicator.textContent = weld.relation === 'parent' ? ' ↑' : ' ↓';
            indicator.style.cssText = `font-size: 10px; color: ${INSPECTOR_THEME.colors.text.secondary}; margin-left: 2px;`;
            indicator.title = weld.relation === 'parent' ? 'Welded to (parent)' : 'Welded child';
            const wrapper = doc.createElement("div");
            wrapper.style.cssText = `display: flex; align-items: center;`;
            wrapper.appendChild(linkBtn);
            wrapper.appendChild(indicator);
            weldValue.appendChild(wrapper);
          }
          weldRow.appendChild(weldValue);
          section.appendChild(weldRow);
        }
      }
    }

    // ── Per-entity SDF Raymarch flag
    // Stored on entityMeta.sdfRaymarch (plain bool, not an ECS component)
    // When enabled, this entity is included in the GPU SDF raymarcher pass.
    // The SDF pass only runs at all when 1+ entities have this flag set.
    // Use-case: spell effects, merge/phase-through-wall visuals.
    {
      const sceneEntityMeta = hierarchyEntities?.get(id);
      const flagSection = createPropertySection(doc, componentEditorContainer, "SDF Effects");
      const flagRow = doc.createElement("label");
      flagRow.style.cssText = `display:flex;align-items:center;gap:8px;font-size:12px;cursor:pointer;padding:4px 0;`;
      const cb = doc.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!(sceneEntityMeta?.sdfRaymarch);
      cb.style.accentColor = "#ce93d8";
      cb.onchange = () => {
        if (sceneEntityMeta) sceneEntityMeta.sdfRaymarch = cb.checked;
      };
      const dot = doc.createElement("span");
      dot.style.cssText = `display:inline-block;width:8px;height:8px;border-radius:50%;background:#ce93d8;flex-shrink:0;`;
      const lbl = doc.createElement("span");
      lbl.textContent = "SDF Raymarch (spell / merge effect)";
      lbl.style.color = "#e0e0e0";
      flagRow.appendChild(cb);
      flagRow.appendChild(dot);
      flagRow.appendChild(lbl);
      flagSection.appendChild(flagRow);

      const hint = doc.createElement("div");
      hint.textContent = "Enable on 2+ entities to smooth-union them in the SDF pass — creates merge / walk-through-wall effects.";
      hint.style.cssText = `font-size:10px;color:#888;margin-top:3px;line-height:1.4;`;
      flagSection.appendChild(hint);
    }

    if (!componentName) {
      entitiesState.pendingComponentValue = null;
      return;
    }
    const entity = findEntityById(id);
    if (
      componentName !== "Emitter" &&
      componentName !== "PhysicalMaterial" &&
      (!entity ||
        !entity.components ||
        !Object.prototype.hasOwnProperty.call(entity.components, componentName))
    ) {
      entitiesState.pendingComponentValue = null;
      return;
    }
    
    // PhysicalMaterial: create on-the-fly if not yet in ECS
    if (componentName === "PhysicalMaterial" && entity && entity.components && !entity.components.PhysicalMaterial) {
      import("../../sim/physics/PhysicalMaterialPresets.js").then(({ createPhysicalMaterial }) => {
        const mat = createPhysicalMaterial("stone");
        const world = getWorld ? getWorld() : null;
        if (world) {
          setEntityComponentFromInspector(world, id, "PhysicalMaterial", mat);
        }
        entity.components.PhysicalMaterial = mat;
        console.log(`[Inspector] Created PhysicalMaterial for entity ${id}`, mat._presetKey || 'stone');
        // Now render the editor with the new component
        let cloned = mat;
        try { cloned = JSON.parse(JSON.stringify(mat)); } catch (_) {}
        entitiesState.pendingComponentValue = cloned;
        renderComponentEditor(doc, entitiesState, componentEditorContainer, editor, findEntityById);
      }).catch((err) => {
        console.warn("[Inspector] Failed to create PhysicalMaterial:", err);
      });
      return;
    }
    
    const value = componentName === "Emitter" ? null : entity.components[componentName];
    let cloned = value;
    try {
      cloned = JSON.parse(JSON.stringify(value));
    } catch (e) {
      cloned = value;
    }
    entitiesState.pendingComponentValue = cloned;
    renderComponentEditor(
      doc,
      entitiesState,
      componentEditorContainer,
      editor,
      findEntityById
    );
  }

  function applyPendingComponent() {
    const id = entitiesState.selectedEntityId;
    const componentName = entitiesState.selectedComponentName;
    if (id == null || !componentName) {
      return;
    }
    if (componentName === "Emitter") {
      // Emitter edits mutate the live emitter directly via emitterConfig;
      // there's no ECS component to apply here.
      return;
    }
    const world = getWorld();
    if (!world) {
      return;
    }

    let value = null;
    if (
      componentName === "Transform" ||
      componentName === "Light" ||
      componentName === "Camera" ||
      componentName === "Renderable" ||
      componentName === "PhysicalMaterial"
    ) {
      value = entitiesState.pendingComponentValue;
    } else {
      try {
        value = JSON.parse(editor.value);
      } catch (e) {
        return;
      }
    }
    if (value == null) {
      return;
    }
    setEntityComponentFromInspector(world, id, componentName, value);
    // Don't refresh for Transform/PhysicalMaterial - it causes re-render,
    // rebuilds the component dropdown, resets selection, and loses field values.
    if (componentName !== "Transform" && componentName !== "PhysicalMaterial") {
      refreshEntitiesModel();
    }
    if (onComponentApplied) {
      onComponentApplied(componentName, id);
    }
  }

  // Expose apply helper so component editors can auto-apply on change
  entitiesState.applyPendingComponent = applyPendingComponent;

  componentSelect.onchange = function () {
    const name = componentSelect.value;
    entitiesState.selectedComponentName = name || null;
    refreshEditorFromSelection();
  };

  entitiesRefresh.onclick = function () {
    refreshEntitiesModel();
  };

  applyBtn.onclick = function () {
    applyPendingComponent();
  };

  removeBtn.onclick = function () {
    const id = entitiesState.selectedEntityId;
    const componentName = entitiesState.selectedComponentName;
    const world = getWorld();
    if (!world) {
      return;
    }
    if (id == null) {
      return;
    }

    if (onRemoveEntity) {
      onRemoveEntity(world, id);
      refreshEntitiesModel();
      return;
    }

    if (!componentName) {
      return;
    }

    removeEntityComponentFromInspector(world, id, componentName);
    refreshEntitiesModel();
  };

  function renderEntitiesPanel() {
    refreshEntitiesModel();
  }

  return {
    renderEntitiesPanel,
    refresh() {
      // Refresh the model from ECS first, then rebuild the component editor
      refreshEntitiesModel();
    },
    setSelectedEntity(id) {
      if (!getWorld) {
        return;
      }
      if (id == null) {
        entitiesState.selectedEntityId = null;
        entitiesState.selectedEntityIds = [];
        entitiesState.selectionAnchor = null;
        entitiesState.selectedComponentName = null;
        refreshEntitiesModel();
        if (onSelectionChanged) {
          onSelectionChanged(null);
        }
        return;
      }

      entitiesState.selectedEntityId = id;
      entitiesState.selectedEntityIds = [id];
      entitiesState.selectionAnchor = id;
      entitiesState.selectedComponentName = null;
      refreshEntitiesModel();
      if (onSelectionChanged) {
        onSelectionChanged(entitiesState.selectedEntityId || null);
      }
    },
    getSelectedEntities() {
      return [...entitiesState.selectedEntityIds];
    },
  };
}
