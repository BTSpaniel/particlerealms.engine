// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * engine/world/generation/index.js - World Generation Barrel Export
 */

// Core generators
export { WorldGenerator, BIOME } from './WorldGenerator.js';
export { GPUWorldGenerator } from './GPUWorldGenerator.js';
export { WorldMapGenerator } from './WorldMapGenerator.js';

// Terrain
export { UnifiedTerrainPipeline } from './UnifiedTerrainPipeline.js';
export { LayerMap } from './LayerMap.js';
export { VoronoiTextureBlend } from './VoronoiTextureBlend.js';
export { bakeTerrainHeightfield, normalizeTerrainBakeConfig, TERRAIN_BAKE_DEFAULTS } from './TerrainBake.js';
export { normalizeTerrainHeightfield, sampleTerrainHeightfield, resampleTerrainHeightfield } from './TerrainHeightfield.js';

// Flora
export { ProceduralTreeGenerator } from './ProceduralTreeGenerator.js';

// Erosion systems
export { HydraulicErosion } from './HydraulicErosion.js';
export { ThermalErosion } from './ThermalErosion.js';
export { WindErosion } from './WindErosion.js';
export { TectonicSimulation } from './TectonicSimulation.js';
