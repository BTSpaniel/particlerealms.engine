// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Inspector Panels - Standalone Panel Exports
 * 
 * Each panel can be mounted independently into any container.
 * Call injectInspectorStyles() first, then use the init* functions.
 * 
 * Usage:
 * ```js
 * import { 
 *   injectInspectorStyles,
 *   initEntitiesInspectorPanel,
 *   initWorldInspectorPanel,
 *   initSpawnerInspectorPanel,
 *   initNavInspectorPanel,
 * } from 'engine/tools/inspector/panels/index.js';
 * 
 * // Inject shared styles once
 * injectInspectorStyles();
 * 
 * // Mount entities panel into left sidebar
 * const entitiesApi = initEntitiesInspectorPanel(document, leftContainer, {
 *   getWorld: () => myWorld,
 *   onSelectionChanged: (id) => { ... },
 *   onRemoveEntity: (id) => { ... },
 * });
 * 
 * // Mount world panel into right sidebar
 * const worldApi = initWorldInspectorPanel(document, rightContainer, {
 *   getWorld: () => myWorld,
 *   statsConfig: { getStats: () => ({ fps: 60, ... }) },
 * });
 * ```
 */

// Shared styles
export { 
  injectInspectorStyles, 
  applyPanelContainerStyles,
  areStylesInjected,
} from "./InspectorStyles.js";

// Theme (for custom styling)
export { INSPECTOR_THEME } from "../ui/InspectorTheme.js";

// UI Controls (for building custom panels)
export {
  createPropertySection,
  addNumberRow,
  addSliderRow,
  addCheckboxRow,
  addTextRow,
  addConfigRow,
  createThemedBox,
  createStatItem,
  createThemedCheckboxRow,
  createThemedSlider,
  renderInspectorSchema,
} from "../ui/InspectorControls.js";

// ============================================
// STANDALONE PANEL INITIALIZERS
// ============================================

/**
 * Entities Panel - Entity list + component editor
 * 
 * Options:
 * - getWorld: () => World - Required, returns ECS world
 * - onSelectionChanged: (entityId) => void - Called when selection changes
 * - onRemoveEntity: (entityId) => void - Called when entity should be removed
 * - getEntityLabel: (entityId) => string - Returns display name for entity
 * - emitterConfig: { getSelectedEmitter: () => emitter } - For emitter entities
 * 
 * Returns: { renderEntitiesPanel, setSelectedEntity, getSelectedEntity }
 */
export { initEntitiesInspectorPanel } from "./EntitiesInspectorPanel.js";

/**
 * World Panel - World stats, physics settings, render settings
 * 
 * Options:
 * - getWorld: () => World - Required, returns ECS world
 * - statsConfig: { getStats: () => stats } - Performance stats provider
 * - renderConfig: { getShaderState, setShaderState, getLightState, setLightState }
 * - physicsConfig: { getPhysicsState, setPhysicsState }
 * - engineConfig: { getConfig: () => config } - Engine config provider
 * - emitterConfig: { ... } - Emitter system config
 * - loadJSONFromStorage: (key) => obj - Storage loader
 * - saveJSONToStorage: (key, obj) => void - Storage saver
 * 
 * Returns: { renderWorldPanel }
 */
export { initWorldInspectorPanel } from "./WorldInspectorPanel.js";

/**
 * Spawner Panel - Entity/emitter spawning presets
 * 
 * Options:
 * - getWorld: () => World - Required, returns ECS world
 * - spawn: { 
 *     modes: [{ id, label, icon?, disabled? }],
 *     onSpawn: (modeId, props) => void,
 *     setGhostOffset?: (x, y, z) => void,
 *     setSpawnPreviewProps?: (props) => void,
 *   }
 * - entitiesApi: { setSelectedEntity } - Link to entities panel
 * 
 * Returns: { renderSpawnerPanel }
 */
export { initSpawnerInspectorPanel } from "./SpawnerInspectorPanel.js";

/**
 * Nav Panel - Navigation/pathfinding debug info
 * 
 * Options:
 * - getWorld: () => World - Required, returns ECS world
 * 
 * Returns: { renderNavPanel }
 */
export { initNavInspectorPanel } from "./NavInspectorPanel.js";

// ============================================
// OPTIONAL PANELS
// ============================================

/**
 * Spell Book Panel - Spell inventory/browsing
 */
export { initSpellBookPanel } from "./SpellBookPanel.js";

/**
 * Spell Builder Panel - Spell creation/editing
 */
export { initSpellBuilderPanel } from "./SpellBuilderPanel.js";
