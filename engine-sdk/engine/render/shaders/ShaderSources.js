// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ShaderSources - Central registry for all WGSL shader modules
 * 
 * ARCHITECTURE:
 * 
 * This engine uses a modular shader system where WGSL code is stored in
 * JavaScript files as template literals. This allows:
 *   - String interpolation for compile-time constants
 *   - ES module imports for shader composition
 *   - No async loading (bundled with app)
 * 
 * FOLDER STRUCTURE:
 *   shaders/
 *   ├── modules/
 *   │   ├── chunks/          # Reusable WGSL fragments
 *   │   │   ├── math_common.js      - PI, saturate(), remap(), etc.
 *   │   │   ├── structs_common.js   - Light, Camera, Material structs
 *   │   │   ├── lighting_common.js  - Attenuation, diffuse, specular
 *   │   │   ├── noise2d.js / noise3d.js - Noise functions
 *   │   │   ├── fullscreen_quad.js  - Fullscreen triangle vertex shader
 *   │   │   └── raymarching.js      - Ray-box, phase functions, etc.
 *   │   ├── core/            - Complete particle/billboard shaders
 *   │   └── postfx/          - Post-processing effects
 *   ├── core/                - Standard/legacy complete shaders
 *   ├── materials/           - PBR, shadow, IBL shaders
 *   ├── debug/               - Debug visualization shaders
 *   └── WgslPreprocessor.js  - Tagged template for conditionals
 * 
 * USAGE:
 *   import { mathCommonWGSL } from "./modules/chunks/math_common.js";
 *   const myShader = mathCommonWGSL + myShaderCode;
 */

// Core shaders
import { particlesBillboardWGSL } from "./modules/core/particles_billboard.js";
import { particlesPointWGSL } from "./modules/core/particles_point.js";
import { particlesSdfBillboardShader } from "./modules/core/particles_sdf_billboard.js";
import { standardShaderWGSL } from "./core/standard.js";
import { clearColorWGSL } from "./core/clear_color.js";
import { globalCommonWGSL } from "./core/global_common.js";
import { lightingWGSL } from "./core/lighting.js";
import { monitorPatternsWGSL } from "./core/monitor_patterns.js";
import { particlesBillboardLegacyWGSL } from "./core/particles_billboard_legacy.js";
import { solidColorWGSL } from "./core/solid_color.js";
import { texturedQuadWGSL } from "./core/textured_quad.js";

// Debug shaders
import { clothDebugWGSL } from "./debug/cloth_debug.js";
import { debugViewsWGSL } from "./debug/debug_views.js";
import { fluidDebugWGSL } from "./debug/fluid_debug.js";

// Material shaders
import { pbrBrdfWGSL } from "./materials/pbr_brdf.js";
import { pbrExtensionsWGSL } from "./materials/pbr_extensions.js";
import { pbrIblWGSL } from "./materials/pbr_ibl.js";
import { pbrMaterialUniformsWGSL } from "./materials/pbr_material_uniforms.js";
import { shadowPcfWGSL } from "./materials/shadow_pcf.js";
import { unlitWorldWGSL } from "./materials/unlit_world.js";
import { voxelWorldWGSL } from "./materials/voxel_world.js";

// Postfx shaders
import { volumeSmokeWGSL } from "./modules/postfx/volume_smoke.js";
import { volumeIsoSurfaceWGSL } from "./modules/postfx/volume_isosurface.js";

// Compute shaders
import { gridSplatComputeWGSL, gridClearComputeWGSL, gridFinalizeComputeWGSL } from "./modules/compute/grid_splat.js";

// GPU Tile (WebGPU equivalent of NVIDIA cuda-tile)
export { GpuTile, gpuTile, VEC4_TILE_64, VEC4_TILE_128, F32_TILE_64, VEC2_TILE_64, TILED_NBODY_EXAMPLE_WGSL } from "./modules/compute/gpu_tile.js";

// Reusable chunks (for direct import, not via ShaderSources)
export { mathCommonWGSL } from "./modules/chunks/math_common.js";
export { lightStructWGSL, cameraStructWGSL, frameUniformsWGSL } from "./modules/chunks/structs_common.js";
export { lightingModuleWGSL } from "./modules/chunks/lighting_common.js";
export { noise2dWGSL } from "./modules/chunks/noise2d.js";
export { noise3dWGSL } from "./modules/chunks/noise3d.js";
export { fullscreenQuadVertexWGSL } from "./modules/chunks/fullscreen_quad.js";
export { raymarchingModuleWGSL } from "./modules/chunks/raymarching.js";

export { packingWGSL } from "./modules/chunks/packing.js";

export { sdfPrimitivesWGSL } from "./modules/chunks/sdf_primitives.js";
export { shadowsAoWGSL, shadowsAoMacrosWGSL } from "./modules/chunks/shadows_ao.js";
export { cameraUtilsWGSL } from "./modules/chunks/camera_utils.js";
export { colorMathWGSL } from "./modules/chunks/color_math.js";
export { fireTurbulenceWGSL } from "./modules/chunks/fire_turbulence.js";
export { magicEffectsWGSL } from "./modules/chunks/magic_effects.js";
export { rayIntersectWGSL } from "./modules/chunks/ray_intersect.js";
export { rayTracingWGSL } from "./modules/chunks/ray_tracing.js";
export { rayTerminationWGSL } from "./modules/chunks/ray_termination.js";
export { restirGuidePolicyWGSL } from "./modules/chunks/restir_guide_policy.js";
export { areaLightingWGSL } from "./modules/chunks/area_lighting.js";
export { temporalAAWGSL } from "./modules/chunks/temporal_aa.js";
export { electricityWGSL } from "./modules/chunks/electricity.js";
export { voronoiWGSL } from "./modules/chunks/voronoi.js";
export { animeExplosionWGSL } from "./modules/chunks/anime_explosion.js";
export { animeToonWGSL } from "./modules/chunks/anime_toon.js";
export { quaternionWGSL } from "./modules/chunks/quaternion.js";
export { fractalEdgesWGSL } from "./modules/chunks/fractal_edges.js";
export { pathtracingGIWGSL } from "./modules/chunks/pathtracing_gi.js";
export { denoiseWGSL } from "./modules/chunks/denoise.js";
export { pbrMaterialsWGSL } from "./modules/chunks/pbr_materials.js";
export { volumetricCloudsWGSL } from "./modules/chunks/volumetric_clouds.js";
export { spellParticlesWGSL } from "./modules/chunks/spell_particles.js";

// Preprocessor
export { wgsl, wgslIf, wgslFor, wgslVariant } from "./WgslPreprocessor.js";

// Shader Schema - uniform buffer layouts and WGSL generation
export {
  WGSL_TYPES,
  FRAME_UNIFORMS_SCHEMA,
  MODEL_UNIFORMS_SCHEMA,
  MATERIAL_UNIFORMS_SCHEMA,
  PARTICLE_PARAMS_SCHEMA,
  LIGHT_STRUCT_SCHEMA,
  BINDING_GROUPS,
  VERTEX_LAYOUTS,
  UNIFORM_SCHEMAS,
  generateStructWGSL,
  generateBindingsWGSL,
  generateVertexInputWGSL,
  createUniformBuffer,
  writeUniformField,
  readUniformField,
  createFrameUniformsBuffer,
  createModelUniformsBuffer,
  createMaterialUniformsBuffer,
  COMMON_WGSL,
  FULLSCREEN_TRIANGLE_VS,
} from "./ShaderSchema.js";

export const ShaderSources = {
  // Core shaders
  "core/standard": standardShaderWGSL,
  "core/clear_color": clearColorWGSL,
  "core/global_common": globalCommonWGSL,
  "core/lighting": lightingWGSL,
  "core/monitor_patterns": monitorPatternsWGSL,
  "core/particles_billboard": particlesBillboardWGSL,
  "core/particles_billboard_legacy": particlesBillboardLegacyWGSL,
  "core/particles_point": particlesPointWGSL,
  "core/particles_sdf": particlesSdfBillboardShader,
  "core/solid_color": solidColorWGSL,
  "core/textured_quad": texturedQuadWGSL,
  // Debug shaders
  "debug/cloth_debug": clothDebugWGSL,
  "debug/debug_views": debugViewsWGSL,
  "debug/fluid_debug": fluidDebugWGSL,
  // Material shaders
  "materials/pbr_brdf": pbrBrdfWGSL,
  "materials/pbr_extensions": pbrExtensionsWGSL,
  "materials/pbr_ibl": pbrIblWGSL,
  "materials/pbr_material_uniforms": pbrMaterialUniformsWGSL,
  "materials/shadow_pcf": shadowPcfWGSL,
  "materials/unlit_world": unlitWorldWGSL,
  "materials/voxel_world": voxelWorldWGSL,
  // Postfx shaders
  "postfx/volume_smoke": volumeSmokeWGSL,
  "postfx/volume_isosurface": volumeIsoSurfaceWGSL,
  // Compute shaders
  "compute/grid_splat": gridSplatComputeWGSL,
  "compute/grid_clear": gridClearComputeWGSL,
  "compute/grid_finalize": gridFinalizeComputeWGSL,
};

// Post-processing effect exports
export { 
  bloomThresholdWGSL, 
  bloomBlurWGSL, 
  bloomCompositeWGSL,
  bloomSinglePassWGSL 
} from "./modules/postfx/bloom.js";
export { fluidWaterCompositeWGSL } from "./modules/postfx/fluid_water_composite.js";
