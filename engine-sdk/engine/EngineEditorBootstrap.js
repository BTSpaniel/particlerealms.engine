// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * EngineEditorBootstrap.js - Combined Engine + Editor entry point
 * 
 * Use this as the entry point when you want the FULL library bundled:
 * - All engine modules (math, ECS, rendering, simulation, audio, tools)
 * - All editor modules (viewport, physics sim, particles, collab, UI)
 * 
 * Usage:
 *   python bundle_engine.py --entry engine/EngineEditorBootstrap.js --eager
 * 
 * The bundled runtime exposes everything on window.PE / window.ParticleEngine:
 *   PE.vec3(), PE.createWorld(), PE.EditorApp, etc.
 */

// =============================================================================
// RE-EXPORT ENTIRE ENGINE
// =============================================================================
export * from "./EngineBootstrap.js";
export { Engine } from "./EngineBootstrap.js";

// =============================================================================
// EDITOR - Main Application
// =============================================================================
export { EditorApp } from "../editor/js/EditorApp.js";
export { ProjectManager } from "../editor/js/ProjectManager.js";
export { createPlaunaApp } from "../plauna/index.js";

export async function initializePlauna(options = {}) {
    const { createPlaunaApp } = await import("../plauna/index.js");
    return createPlaunaApp(options);
}

// =============================================================================
// EDITOR - Core Modules (force into graph for eager init)
// =============================================================================
import * as _EditorScene from "../editor/js/modules/EditorScene.js";
import * as _EditorSpawnMenu from "../editor/js/modules/EditorSpawnMenu.js";
import * as _EditorUI from "../editor/js/modules/EditorUI.js";
import * as _EditorHistory from "../editor/js/modules/EditorHistory.js";
import * as _EntitySchema from "../editor/js/modules/EntitySchema.js";
import * as _EditorAudio from "../editor/js/modules/EditorAudio.js";
import * as _EditorSettings from "../editor/js/modules/EditorSettings.js";
import * as _EditorTools from "../editor/js/modules/EditorTools.js";
import * as _HotkeyManager from "../editor/js/modules/HotkeyManager.js";
import * as _LoadingManager from "../editor/js/modules/LoadingManager.js";
import * as _EditorAudioFX from "../editor/js/modules/EditorAudioFX.js";

// =============================================================================
// EDITOR - Heavy Modules (normally lazy-loaded, pulled in for full bundle)
// =============================================================================
import * as _EditorPhysics from "../editor/js/modules/EditorPhysics.js";
import * as _EditorPhysicsSim from "../editor/js/modules/EditorPhysicsSim.js";
import * as _EditorParticles from "../editor/js/modules/EditorParticles.js";
import * as _EditorCollab from "../editor/js/modules/EditorCollab.js";
import * as _EditorWelding from "../editor/js/modules/EditorWelding.js";
import * as _ColliderGenerators from "../editor/js/modules/ColliderGenerators.js";
import * as _EditorTransitions from "../editor/js/modules/EditorTransitions.js";
import * as _PrefabLibrary from "../editor/js/modules/PrefabLibrary.js";
import * as _ProjectStorage from "../editor/js/modules/ProjectStorage.js";

// =============================================================================
// EDITOR - Panels & Viewport
// =============================================================================
import * as _Viewport from "../editor/js/panels/Viewport.js";

// =============================================================================
// EDITOR - Spawnables
// =============================================================================
import * as _Spawnables from "../editor/js/spawnables/index.js";

// =============================================================================
// EDITOR - Asset System
// =============================================================================
import * as _AssetPanel from "../editor/js/panels/AssetPanel.js";
import * as _ModelImporter from "../editor/js/modules/ModelImporter.js";
import * as _CustomMeshRegistry from "../engine/render/mesh/CustomMeshRegistry.js";
import * as _SkeletalAnimation from "../engine/render/mesh/SkeletalAnimation.js";
import * as _ProceduralSkeleton from "../engine/render/mesh/ProceduralSkeleton.js";

// =============================================================================
// EDITOR - Viewport Renderers
// =============================================================================
import * as _ViewportUtils from "../editor/js/utils/SpatialIndex.js";
import * as _InterpolationCurves from "../editor/js/utils/InterpolationCurves.js";
import * as _FrustumCulling from "../editor/js/utils/FrustumCulling.js";
import * as _MemoryIntegration from "../editor/js/utils/MemoryIntegration.js";

// =============================================================================
// COLLAB SYSTEM (full P2P networking stack)
// =============================================================================
export * from "../engine/collab/index.js";

// =============================================================================
// BUNDLED EDITOR NAMESPACE
// =============================================================================
export const Editor = {
    // Core modules
    ..._EditorScene,
    ..._EditorSpawnMenu,
    ..._EditorUI,
    ..._EditorHistory,
    ..._EntitySchema,
    ..._EditorAudio,
    ..._EditorSettings,
    ..._EditorTools,
    ..._HotkeyManager,
    ..._LoadingManager,
    ..._EditorAudioFX,
    // Heavy modules
    ..._EditorPhysics,
    ..._EditorPhysicsSim,
    ..._EditorParticles,
    ..._EditorCollab,
    ..._EditorWelding,
    ..._ColliderGenerators,
    ..._EditorTransitions,
    ..._PrefabLibrary,
    ..._ProjectStorage,
    // Panels
    ..._Viewport,
    // Spawnables
    ..._Spawnables,
    // Utilities
    ..._ViewportUtils,
    ..._InterpolationCurves,
    ..._FrustumCulling,
    ..._MemoryIntegration,
    // Asset System
    ..._AssetPanel,
    ..._ModelImporter,
    ..._CustomMeshRegistry,
    ..._SkeletalAnimation,
    ..._ProceduralSkeleton,
};
