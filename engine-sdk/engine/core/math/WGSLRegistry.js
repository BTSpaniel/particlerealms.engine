// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// WGSLRegistry.js - metadata for reusable WGSL chunks and CPU/WGSL mirror links.

import { MATH_FUNCTION_REGISTRY } from './MathRegistry.js';
import { COMPUTE_SHADER_SOURCE_MODULES } from '../shaders/compute/compute_shader_sources.generated.js';
import {
  WGSL_MODULE_EXPORT_CLASSIFICATIONS,
  WGSL_MODULE_EXPORTS,
  WGSL_REGISTERED_MODULE_EXPORT_CHUNKS,
} from './WGSLModuleExports.generated.js';

export const WGSL_REGISTRY_VERSION = '2026-06-17.wgsl-registry-v1';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

const COMPILE_PREFIX_IDS = deepFreeze({
  light_attenuation: ['math_common'],
  diffuse_lighting: ['math_common'],
  light_calculation: ['struct_light', 'light_attenuation', 'diffuse_lighting'],
  phase_functions: ['math_common'],
  pbr_brdf_functions: ['math_common', 'pbr_inputs_struct'],
  ray_box_intersect: ['math_common'],
  legacy_deterministic_rng_seed32: ['legacy_pcg32'],
  restir_temporal_pcg_hash: ['legacy_pcg32'],
  restir_spatial_pcg_hash: ['legacy_pcg32'],
  path_tracing_pcg_hash: ['legacy_pcg32'],
  volumetric_clouds_jitter_pcg_hash: ['legacy_pcg32'],
  ssr_jitter_pcg_hash: ['legacy_pcg32'],
  custom_particle_sparkle_pcg_hash: ['legacy_pcg32'],
  marching_cubes_material_pcg_hash: ['legacy_pcg32'],
  legacy_particle_vertex_quality_pcg: ['legacy_pcg32'],
  legacy_standalone_runtime_pcg: ['legacy_pcg32'],
  legacy_render_runtime_pcg_hash: ['legacy_pcg32'],
  legacy_world_generation_runtime_pcg_hash: ['legacy_pcg32'],
  mesh_to_particles_runtime_pcg: ['legacy_pcg32'],
  legacy_particle_runtime_pcg: ['legacy_pcg32'],
  fluid_water_pcg_hash: ['legacy_pcg32'],
  magic_effects_pcg_hash: ['legacy_pcg32'],
  phase_vfx_pcg_hash: ['legacy_pcg32'],
  pathtracing_gi_pcg: ['legacy_pcg32'],
  pbr_materials_pcg_hash: ['legacy_pcg32'],
  ray_tracing_random_float_pcg: ['legacy_pcg32'],
  gpu_random_core: ['legacy_pcg32'],
  multiplayer_random_core: ['legacy_deterministic_rng_seed32'],
});

const RUNTIME_EXPORTS = deepFreeze({
  dispatch_gen_runtime: {
    path: 'engine/core/shaders/compute/dispatch_gen.generated.js',
    exportName: 'DISPATCH_GEN_SHADER',
  },
});

const MANUAL_MODULE_EXPORT_CHUNKS = deepFreeze([
  ['legacy_prime_coordinate_u32_xor_bucket3d', 'engine/core/math/MathBits.js', ['math', 'bits', 'hash', 'spatial', 'bucket', 'coordinate', 'xor', 'legacy'], 'manual-module-export', 'LEGACY_PRIME_COORDINATE_U32_XOR_BUCKET3D_WGSL'],
  ['legacy_prime_coordinate_signed_add_abs_bucket3d', 'engine/core/math/MathBits.js', ['math', 'bits', 'hash', 'spatial', 'bucket', 'coordinate', 'additive', 'abs', 'legacy'], 'manual-module-export', 'LEGACY_PRIME_COORDINATE_SIGNED_ADD_ABS_BUCKET3D_WGSL'],
  ['legacy_mesh_particle_seed32', 'engine/core/math/MathBits.js', ['math', 'bits', 'hash', 'seed', 'particle', 'mesh', 'legacy'], 'manual-module-export', 'LEGACY_MESH_PARTICLE_SEED_WGSL'],
  ['legacy_pcg32', 'engine/core/math/MathBits.js', ['math', 'bits', 'pcg', 'rng', 'legacy'], 'manual-module-export', 'LEGACY_PCG32_WGSL'],
  ['legacy_particle_vertex_quality_pcg', 'engine/core/math/MathBits.js', ['math', 'bits', 'pcg', 'rng', 'particle', 'vertex', 'quality', 'runtime', 'legacy'], 'manual-module-export', 'LEGACY_PARTICLE_VERTEX_QUALITY_PCG_WGSL'],
  ['legacy_standalone_runtime_pcg', 'engine/core/math/MathBits.js', ['math', 'bits', 'pcg', 'rng', 'standalone', 'runtime', 'random-float', 'legacy'], 'manual-module-export', 'LEGACY_STANDALONE_RUNTIME_PCG_WGSL'],
  ['legacy_render_runtime_pcg_hash', 'engine/core/math/MathBits.js', ['math', 'bits', 'pcg', 'rng', 'render', 'runtime', 'world-preview', 'aurora', 'stars', 'underwater', 'legacy'], 'manual-module-export', 'LEGACY_RENDER_RUNTIME_PCG_HASH_WGSL'],
  ['legacy_world_generation_runtime_pcg_hash', 'engine/core/math/MathBits.js', ['math', 'bits', 'pcg', 'rng', 'world-generation', 'runtime', 'voronoi', 'tree', 'legacy'], 'manual-module-export', 'LEGACY_WORLD_GENERATION_RUNTIME_PCG_HASH_WGSL'],
  ['mesh_to_particles_runtime_pcg', 'engine/core/math/MathBits.js', ['math', 'bits', 'pcg', 'rng', 'mesh-to-particles', 'particle', 'random-float', 'runtime', 'legacy'], 'manual-module-export', 'MESH_TO_PARTICLES_RUNTIME_PCG_WGSL'],
  ['legacy_particle_runtime_pcg', 'engine/core/math/MathBits.js', ['math', 'bits', 'pcg', 'rng', 'particle', 'runtime', 'sdf', 'random-float', 'legacy'], 'manual-module-export', 'LEGACY_PARTICLE_RUNTIME_PCG_WGSL'],
  ['fluid_water_pcg_hash', 'engine/core/math/MathBits.js', ['math', 'bits', 'pcg', 'rng', 'fluid-water', 'postfx', 'shader-module', 'runtime', 'legacy'], 'manual-module-export', 'FLUID_WATER_PCG_HASH_WGSL'],
  ['magic_effects_pcg_hash', 'engine/core/math/MathBits.js', ['math', 'bits', 'pcg', 'rng', 'magic-effects', 'shader-module', 'runtime', 'legacy'], 'manual-module-export', 'MAGIC_EFFECTS_PCG_HASH_WGSL'],
  ['phase_vfx_pcg_hash', 'engine/core/math/MathBits.js', ['math', 'bits', 'pcg', 'rng', 'phase-vfx', 'shader-module', 'runtime', 'legacy'], 'manual-module-export', 'PHASE_VFX_PCG_HASH_WGSL'],
  ['pathtracing_gi_pcg', 'engine/core/math/MathBits.js', ['math', 'bits', 'pcg', 'rng', 'pathtracing-gi', 'shader-module', 'random-float', 'hash-step', 'runtime', 'legacy'], 'manual-module-export', 'PATH_TRACING_GI_PCG_WGSL'],
  ['pbr_materials_pcg_hash', 'engine/core/math/MathBits.js', ['math', 'bits', 'pcg', 'rng', 'pbr', 'material', 'shader-module', 'runtime', 'legacy'], 'manual-module-export', 'PBR_MATERIALS_PCG_HASH_WGSL'],
  ['ray_tracing_random_float_pcg', 'engine/core/math/MathBits.js', ['math', 'bits', 'pcg', 'rng', 'ray-tracing', 'shader-module', 'random-float', 'state-step', 'legacy'], 'manual-module-export', 'RAY_TRACING_RANDOM_FLOAT_WGSL'],
  ['gpu_random_core', 'engine/core/gpu/GPURandom.js', ['math', 'bits', 'pcg', 'rng', 'gpu-random', 'runtime', 'random-float', 'legacy'], 'manual-module-export', 'GPU_RANDOM_CORE_WGSL'],
  ['multiplayer_random_core', 'engine/core/gpu/GPURandom.js', ['math', 'bits', 'pcg', 'rng', 'gpu-random', 'multiplayer', 'deterministic', 'seed', 'runtime', 'legacy'], 'manual-module-export', 'MULTIPLAYER_RANDOM_CORE_WGSL'],
  ['legacy_deterministic_rng_seed32', 'engine/core/math/MathBits.js', ['math', 'bits', 'pcg', 'rng', 'deterministic', 'seed', 'legacy'], 'manual-module-export', 'LEGACY_DETERMINISTIC_RNG_SEED32_WGSL'],
  ['restir_temporal_pcg_hash', 'engine/render/passes/ReSTIRGIPass.js', ['math', 'bits', 'pcg', 'rng', 'restir', 'temporal', 'runtime'], 'manual-module-export', 'RESTIR_TEMPORAL_PCG_HASH_WGSL'],
  ['restir_spatial_pcg_hash', 'engine/render/passes/ReSTIRGIPass.js', ['math', 'bits', 'pcg', 'rng', 'restir', 'spatial', 'runtime'], 'manual-module-export', 'RESTIR_SPATIAL_PCG_HASH_WGSL'],
  ['path_tracing_pcg_hash', 'engine/render/passes/PathTracingPass.js', ['math', 'bits', 'pcg', 'rng', 'path-tracing', 'runtime'], 'manual-module-export', 'PATH_TRACING_PCG_HASH_WGSL'],
  ['volumetric_clouds_jitter_pcg_hash', 'engine/render/passes/VolumetricCloudsPass.js', ['math', 'bits', 'pcg', 'rng', 'cloud', 'volumetric-clouds', 'jitter', 'runtime'], 'manual-module-export', 'VOLUMETRIC_CLOUDS_JITTER_PCG_HASH_WGSL'],
  ['ssr_jitter_pcg_hash', 'engine/render/passes/SSRPass.js', ['math', 'bits', 'pcg', 'rng', 'screen-space-reflection', 'jitter', 'runtime'], 'manual-module-export', 'SSR_JITTER_PCG_HASH_WGSL'],
  ['custom_particle_sparkle_pcg_hash', 'engine/render/particles/CustomParticleEffect.js', ['math', 'bits', 'pcg', 'rng', 'sparkle', 'particle-effect', 'custom-particle-effect', 'runtime'], 'manual-module-export', 'CUSTOM_PARTICLE_SPARKLE_PCG_HASH_WGSL'],
  ['marching_cubes_material_pcg_hash', 'engine/voxel/MarchingCubesMesher.js', ['math', 'bits', 'pcg', 'rng', 'voxel', 'marching-cubes', 'material', 'runtime'], 'manual-module-export', 'MARCHING_CUBES_MATERIAL_PCG_HASH_WGSL'],
]);

const COMPUTE_SHADER_SOURCE_MODULES_BY_PATH = deepFreeze(Object.fromEntries(
  Object.values(COMPUTE_SHADER_SOURCE_MODULES).map((entry) => [entry.sourcePath, entry])
));

function generatedSourceModuleForPath(sourcePath) {
  return COMPUTE_SHADER_SOURCE_MODULES_BY_PATH[sourcePath] || null;
}

function moduleExportKey(sourcePath, exportName) {
  return `${sourcePath}::${exportName}`;
}

function isModuleExportSourceType(sourceType) {
  return sourceType === 'module-export' || sourceType === 'manual-module-export';
}

function moduleExportRecords(moduleExports = WGSL_MODULE_EXPORTS) {
  return Object.entries(moduleExports).flatMap(([sourcePath, exports]) => (
    Array.isArray(exports)
      ? exports.map((exportName) => ({ sourcePath, exportName, key: moduleExportKey(sourcePath, exportName) }))
      : []
  ));
}

function generatedModuleExportChunkDefinitions() {
  return Object.values(WGSL_REGISTERED_MODULE_EXPORT_CHUNKS).map((entry) => [
    entry.registryId,
    entry.sourcePath,
    Array.isArray(entry.tags) ? entry.tags : [],
    'module-export',
    entry.compileExportName,
  ]);
}

function generatedFileChunkDefinitions() {
  return Object.values(COMPUTE_SHADER_SOURCE_MODULES).map((entry) => [
    entry.registryId,
    entry.sourcePath,
    Array.isArray(entry.tags) ? entry.tags : ['compute'],
    'file',
    null,
  ]);
}

function chunkEntry(id, sourcePath, tags = [], sourceType = 'module-export', compileExportName = null) {
  const compilePrefixIds = COMPILE_PREFIX_IDS[id] || [];
  const runtimeExport = RUNTIME_EXPORTS[id] || null;
  const generatedSourceModule = sourceType === 'file' ? generatedSourceModuleForPath(sourcePath) : null;
  const generatedModuleExportChunk = sourceType === 'module-export' ? WGSL_REGISTERED_MODULE_EXPORT_CHUNKS[id] || null : null;
  return deepFreeze({
    id,
    kind: 'wgsl-chunk',
    sourcePath,
    sourceType,
    compileCaseId: id,
    compileExportName: isModuleExportSourceType(sourceType) ? compileExportName || '' : null,
    compilePrefixIds: Object.freeze([...compilePrefixIds]),
    generatedModuleExportManifestPath: generatedModuleExportChunk ? 'engine/core/math/WGSLModuleExports.generated.js' : null,
    generatedSourceModulePath: generatedSourceModule?.modulePath || null,
    generatedSourceExportName: generatedSourceModule?.exportName || null,
    generatedSourcePathExportName: generatedSourceModule?.sourcePathExportName || null,
    runtimeExportPath: runtimeExport?.path || null,
    runtimeExportName: runtimeExport?.exportName || null,
    tests: Object.freeze(['tests/wgsl-chunk-compile.html']),
    tags: Object.freeze(tags),
  });
}

function mirrorEntry(id, cpuFunctionId, chunkId, wgslSymbol, tags = []) {
  return deepFreeze({
    id,
    kind: 'wgsl-mirror',
    cpuFunctionId,
    chunkId,
    wgslSymbol,
    parityTests: Object.freeze(['tests/math-wgsl-parity.html']),
    tags: Object.freeze(tags),
  });
}

const CHUNKS = [
  ...generatedModuleExportChunkDefinitions(),
  ...MANUAL_MODULE_EXPORT_CHUNKS,
  ...generatedFileChunkDefinitions(),
].map(([id, sourcePath, tags, sourceType, compileExportName]) => chunkEntry(id, sourcePath, tags, sourceType, compileExportName));

const MIRRORS = [
  ['math_common.clamp', 'math.scalar.clamp', 'math_common', 'clamp', ['scalar']],
  ['math_common.lerpf', 'math.scalar.lerp', 'math_common', 'lerpf', ['scalar', 'interpolation']],
  ['texture_math.textureTransformUV', 'math.texture.transform-uv', 'texture_math', 'textureTransformUV', ['texture', 'uv']],
  ['texture_math.textureMipLevelCount', 'math.texture.mip-level-count', 'texture_math', 'textureMipLevelCount', ['texture', 'mip']],
  ['color_math.linearChannelToSrgb', 'math.color.linear-channel-to-srgb', 'color_math', 'linearChannelToSrgb', ['color']],
  ['blend_math.alphaBlend', 'math.blend.alpha-blend', 'blend_math', 'alphaBlend', ['blend']],
  ['blend_math.premultipliedAlphaBlend', 'math.blend.premultiplied-alpha-blend', 'blend_math', 'premultipliedAlphaBlend', ['blend']],
  ['raymarching.raySphereIntersect', 'math.ray.intersect-sphere', 'ray_sphere_intersect', 'raySphereIntersect', ['ray']],
  ['raymarching.trilinearSample', 'math.grid.trilinear-sample', 'trilinear_sample', 'trilinearSample', ['sampling']],
  ['legacy_prime_coordinate_u32_xor_bucket3d.legacyPrimeCoordinateU32XorBucket3D', 'math.bits.legacy-prime-coordinate-u32-xor-bucket3d', 'legacy_prime_coordinate_u32_xor_bucket3d', 'legacyPrimeCoordinateU32XorBucket3D', ['bits', 'hash', 'spatial', 'bucket']],
  ['legacy_prime_coordinate_signed_add_abs_bucket3d.legacyPrimeCoordinateSignedAddAbsBucket3D', 'math.bits.legacy-prime-coordinate-signed-add-abs-bucket3d', 'legacy_prime_coordinate_signed_add_abs_bucket3d', 'legacyPrimeCoordinateSignedAddAbsBucket3D', ['bits', 'hash', 'spatial', 'bucket']],
  ['legacy_mesh_particle_seed32.legacyMeshParticleSeed32', 'math.bits.legacy-mesh-particle-seed32', 'legacy_mesh_particle_seed32', 'legacyMeshParticleSeed32', ['bits', 'hash', 'seed', 'particle', 'mesh']],
  ['legacy_pcg32.legacyPcgAdvanceState32', 'math.bits.legacy-pcg-advance-state32', 'legacy_pcg32', 'legacyPcgAdvanceState32', ['bits', 'pcg', 'rng']],
  ['legacy_pcg32.legacyPcgOutput32', 'math.bits.legacy-pcg-output32', 'legacy_pcg32', 'legacyPcgOutput32', ['bits', 'pcg', 'rng']],
  ['legacy_pcg32.legacyPcgHash32', 'math.bits.legacy-pcg-hash32', 'legacy_pcg32', 'legacyPcgHash32', ['bits', 'pcg', 'rng']],
  ['legacy_pcg32.legacyPcgRandomFloat01', 'math.bits.legacy-pcg-random-float01-step', 'legacy_pcg32', 'legacyPcgRandomFloat01', ['bits', 'pcg', 'rng', 'random-float', 'state-step']],
  ['legacy_pcg32.legacyPcgHashStepRandomFloat01', 'math.bits.legacy-pcg-hash-step-random-float01-step', 'legacy_pcg32', 'legacyPcgHashStepRandomFloat01', ['bits', 'pcg', 'rng', 'random-float', 'hash-step']],
  ['legacy_pcg32.legacyPcgPixelFrameHash2D', 'math.bits.legacy-pcg-pixel-frame-hash2d', 'legacy_pcg32', 'legacyPcgPixelFrameHash2D', ['bits', 'pcg', 'rng', 'pixel', 'frame']],
  ['legacy_pcg32.legacyPcgPixelFrameRandom24Float01', 'math.bits.legacy-pcg-pixel-frame-random24-float01', 'legacy_pcg32', 'legacyPcgPixelFrameRandom24Float01', ['bits', 'pcg', 'rng', 'pixel', 'frame', 'random-float']],
  ['legacy_pcg32.legacyPcgCloudJitterHash2D', 'math.bits.legacy-pcg-cloud-jitter-hash2d', 'legacy_pcg32', 'legacyPcgCloudJitterHash2D', ['bits', 'pcg', 'rng', 'cloud', 'jitter']],
  ['legacy_pcg32.legacyPcgSsrJitterHash2D', 'math.bits.legacy-pcg-ssr-jitter-hash2d', 'legacy_pcg32', 'legacyPcgSsrJitterHash2D', ['bits', 'pcg', 'rng', 'screen-space-reflection', 'jitter']],
  ['legacy_pcg32.legacyPcgSparkleHash3D', 'math.bits.legacy-pcg-sparkle-hash3d', 'legacy_pcg32', 'legacyPcgSparkleHash3D', ['bits', 'pcg', 'rng', 'sparkle', 'particle-effect']],
  ['legacy_particle_vertex_quality_pcg.legacyParticleVertexQualityPcgHash2D', 'math.bits.legacy-particle-vertex-quality-pcg-hash2d', 'legacy_particle_vertex_quality_pcg', 'legacyParticleVertexQualityPcgHash2D', ['bits', 'pcg', 'rng', 'particle', 'vertex', 'quality', 'runtime']],
  ['legacy_particle_vertex_quality_pcg.legacyParticleVertexQualityRandomFloat01', 'math.bits.legacy-particle-vertex-quality-random-float01', 'legacy_particle_vertex_quality_pcg', 'legacyParticleVertexQualityRandomFloat01', ['bits', 'pcg', 'rng', 'particle', 'vertex', 'quality', 'runtime', 'random-float']],
  ['legacy_standalone_runtime_pcg.legacyStandaloneRuntimePcgHash32', 'math.bits.legacy-standalone-runtime-pcg-hash32', 'legacy_standalone_runtime_pcg', 'legacyStandaloneRuntimePcgHash32', ['bits', 'pcg', 'rng', 'standalone', 'runtime']],
  ['legacy_standalone_runtime_pcg.legacyStandaloneRuntimePcgFloat01', 'math.bits.legacy-standalone-runtime-pcg-float01', 'legacy_standalone_runtime_pcg', 'legacyStandaloneRuntimePcgFloat01', ['bits', 'pcg', 'rng', 'standalone', 'runtime', 'random-float']],
  ['legacy_standalone_runtime_pcg.legacyStandaloneRuntimePcgHashStepRandomFloat01', 'math.bits.legacy-standalone-runtime-pcg-hash-step-random-float01-step', 'legacy_standalone_runtime_pcg', 'legacyStandaloneRuntimePcgHashStepRandomFloat01', ['bits', 'pcg', 'rng', 'standalone', 'runtime', 'random-float', 'hash-step']],
  ['legacy_render_runtime_pcg_hash.pcg_prev', 'math.bits.legacy-world3d-preview-pcg-hash32', 'legacy_render_runtime_pcg_hash', 'pcg_prev', ['bits', 'pcg', 'rng', 'render', 'world-preview', 'runtime']],
  ['legacy_render_runtime_pcg_hash.pcg_aurora', 'math.bits.legacy-aurora-pcg-hash32', 'legacy_render_runtime_pcg_hash', 'pcg_aurora', ['bits', 'pcg', 'rng', 'render', 'aurora', 'runtime']],
  ['legacy_render_runtime_pcg_hash.pcg_star', 'math.bits.legacy-celestial-stars-pcg-hash32', 'legacy_render_runtime_pcg_hash', 'pcg_star', ['bits', 'pcg', 'rng', 'render', 'stars', 'runtime']],
  ['legacy_render_runtime_pcg_hash.pcg_uw', 'math.bits.legacy-underwater-pcg-hash32', 'legacy_render_runtime_pcg_hash', 'pcg_uw', ['bits', 'pcg', 'rng', 'render', 'underwater', 'runtime']],
  ['legacy_world_generation_runtime_pcg_hash.pcg_vor', 'math.bits.legacy-voronoi-runtime-pcg-hash32', 'legacy_world_generation_runtime_pcg_hash', 'pcg_vor', ['bits', 'pcg', 'rng', 'world-generation', 'voronoi', 'runtime']],
  ['legacy_world_generation_runtime_pcg_hash.pcg_h', 'math.bits.legacy-procedural-tree-runtime-pcg-hash32', 'legacy_world_generation_runtime_pcg_hash', 'pcg_h', ['bits', 'pcg', 'rng', 'world-generation', 'tree', 'runtime']],
  ['mesh_to_particles_runtime_pcg.pcg_hash', 'math.bits.legacy-mesh-to-particles-pcg-hash32', 'mesh_to_particles_runtime_pcg', 'pcg_hash', ['bits', 'pcg', 'rng', 'mesh-to-particles', 'runtime']],
  ['mesh_to_particles_runtime_pcg.randomFloat', 'math.bits.legacy-mesh-to-particles-random-float01-step', 'mesh_to_particles_runtime_pcg', 'randomFloat', ['bits', 'pcg', 'rng', 'mesh-to-particles', 'random-float', 'state-step', 'runtime']],
  ['legacy_particle_runtime_pcg.pcg_hash_sdf', 'math.bits.legacy-particle-runtime-sdf-pcg-hash32', 'legacy_particle_runtime_pcg', 'pcg_hash_sdf', ['bits', 'pcg', 'rng', 'particle', 'runtime', 'sdf']],
  ['legacy_particle_runtime_pcg.pcg_hash', 'math.bits.legacy-particle-runtime-pcg-hash32', 'legacy_particle_runtime_pcg', 'pcg_hash', ['bits', 'pcg', 'rng', 'particle', 'runtime']],
  ['legacy_particle_runtime_pcg.randomFloat', 'math.bits.legacy-particle-runtime-random-float01-step', 'legacy_particle_runtime_pcg', 'randomFloat', ['bits', 'pcg', 'rng', 'particle', 'runtime', 'random-float', 'state-step']],
  ['fluid_water_pcg_hash.pcg_water', 'math.bits.legacy-fluid-water-pcg-hash32', 'fluid_water_pcg_hash', 'pcg_water', ['bits', 'pcg', 'rng', 'fluid-water', 'postfx', 'shader-module', 'runtime']],
  ['magic_effects_pcg_hash.pcg_magic', 'math.bits.legacy-magic-effects-pcg-hash32', 'magic_effects_pcg_hash', 'pcg_magic', ['bits', 'pcg', 'rng', 'magic-effects', 'shader-module', 'runtime']],
  ['phase_vfx_pcg_hash.pcg_phase', 'math.bits.legacy-phase-vfx-pcg-hash32', 'phase_vfx_pcg_hash', 'pcg_phase', ['bits', 'pcg', 'rng', 'phase-vfx', 'shader-module', 'runtime']],
  ['pathtracing_gi_pcg.pcgHash', 'math.bits.legacy-pathtracing-gi-pcg-hash32', 'pathtracing_gi_pcg', 'pcgHash', ['bits', 'pcg', 'rng', 'pathtracing-gi', 'shader-module', 'runtime']],
  ['pathtracing_gi_pcg.randomFloatPT', 'math.bits.legacy-pathtracing-gi-random-float01-step', 'pathtracing_gi_pcg', 'randomFloatPT', ['bits', 'pcg', 'rng', 'pathtracing-gi', 'shader-module', 'random-float', 'hash-step', 'runtime']],
  ['pbr_materials_pcg_hash.pcg_pbr', 'math.bits.legacy-pbr-materials-pcg-hash32', 'pbr_materials_pcg_hash', 'pcg_pbr', ['bits', 'pcg', 'rng', 'pbr', 'material', 'shader-module', 'runtime']],
  ['ray_tracing_random_float_pcg.randomFloat', 'math.bits.legacy-ray-tracing-random-float01-step', 'ray_tracing_random_float_pcg', 'randomFloat', ['bits', 'pcg', 'rng', 'ray-tracing', 'shader-module', 'random-float', 'state-step']],
  ['restir_temporal_pcg_hash.restirTemporalHash2', 'math.bits.legacy-restir-temporal-hash2-float01', 'restir_temporal_pcg_hash', 'restirTemporalHash2', ['bits', 'pcg', 'rng', 'restir', 'temporal', 'random-float']],
  ['restir_spatial_pcg_hash.restirSpatialHash2', 'math.bits.legacy-restir-spatial-hash2-float01', 'restir_spatial_pcg_hash', 'restirSpatialHash2', ['bits', 'pcg', 'rng', 'restir', 'spatial', 'random-float']],
  ['path_tracing_pcg_hash.pcgHash', 'math.bits.legacy-path-tracing-pcg-hash32', 'path_tracing_pcg_hash', 'pcgHash', ['bits', 'pcg', 'rng', 'path-tracing', 'runtime']],
  ['volumetric_clouds_jitter_pcg_hash.volumetricCloudsJitterHash2D', 'math.bits.legacy-volumetric-clouds-jitter-pcg-hash2d', 'volumetric_clouds_jitter_pcg_hash', 'volumetricCloudsJitterHash2D', ['bits', 'pcg', 'rng', 'cloud', 'volumetric-clouds', 'jitter', 'runtime']],
  ['ssr_jitter_pcg_hash.ssrJitterHash2D', 'math.bits.legacy-ssr-jitter-pcg-hash2d', 'ssr_jitter_pcg_hash', 'ssrJitterHash2D', ['bits', 'pcg', 'rng', 'screen-space-reflection', 'jitter', 'runtime']],
  ['custom_particle_sparkle_pcg_hash.customParticleSparkleHash3D', 'math.bits.legacy-custom-particle-sparkle-pcg-hash3d', 'custom_particle_sparkle_pcg_hash', 'customParticleSparkleHash3D', ['bits', 'pcg', 'rng', 'sparkle', 'particle-effect', 'custom-particle-effect', 'runtime']],
  ['marching_cubes_material_pcg_hash.marchingCubesMaterialPcgHash2D', 'math.bits.legacy-marching-cubes-material-pcg-hash2d', 'marching_cubes_material_pcg_hash', 'marchingCubesMaterialPcgHash2D', ['bits', 'pcg', 'rng', 'voxel', 'marching-cubes', 'material', 'runtime']],
  ['legacy_deterministic_rng_seed32.legacyDeterministicRngTickSeed32', 'math.bits.legacy-deterministic-rng-tick-seed32', 'legacy_deterministic_rng_seed32', 'legacyDeterministicRngTickSeed32', ['bits', 'pcg', 'rng', 'tick', 'seed']],
  ['legacy_deterministic_rng_seed32.legacyDeterministicRngEntitySeed32', 'math.bits.legacy-deterministic-rng-entity-seed32', 'legacy_deterministic_rng_seed32', 'legacyDeterministicRngEntitySeed32', ['bits', 'pcg', 'rng', 'entity', 'seed']],
  ['legacy_deterministic_rng_seed32.legacyDeterministicRngPositionSeed32', 'math.bits.legacy-deterministic-rng-position-seed32', 'legacy_deterministic_rng_seed32', 'legacyDeterministicRngPositionSeed32', ['bits', 'pcg', 'rng', 'position', 'seed']],
  ['legacy_deterministic_rng_seed32.legacyDeterministicRngInteractionSeed32', 'math.bits.legacy-deterministic-rng-interaction-seed32', 'legacy_deterministic_rng_seed32', 'legacyDeterministicRngInteractionSeed32', ['bits', 'pcg', 'rng', 'interaction', 'seed']],
  ['gpu_random_core.pcg_hash', 'math.gpu-random.pcg-hash32', 'gpu_random_core', 'pcg_hash', ['bits', 'pcg', 'rng', 'gpu-random', 'runtime']],
  ['gpu_random_core.hash2D', 'math.gpu-random.hash2d', 'gpu_random_core', 'hash2D', ['bits', 'pcg', 'rng', 'gpu-random', 'runtime']],
  ['gpu_random_core.hash3D', 'math.gpu-random.hash3d', 'gpu_random_core', 'hash3D', ['bits', 'pcg', 'rng', 'gpu-random', 'runtime']],
  ['gpu_random_core.initRngState', 'math.gpu-random.init-rng-state', 'gpu_random_core', 'initRngState', ['bits', 'pcg', 'rng', 'gpu-random', 'runtime', 'pixel', 'frame']],
  ['gpu_random_core.randomFloat', 'math.bits.legacy-pcg-random-float01-step', 'gpu_random_core', 'randomFloat', ['bits', 'pcg', 'rng', 'gpu-random', 'random-float', 'state-step', 'runtime']],
  ['multiplayer_random_core.initTickRng', 'math.bits.legacy-deterministic-rng-tick-seed32', 'multiplayer_random_core', 'initTickRng', ['bits', 'pcg', 'rng', 'gpu-random', 'multiplayer', 'tick', 'seed']],
  ['multiplayer_random_core.initMultiplayerRng', 'math.bits.legacy-deterministic-rng-entity-seed32', 'multiplayer_random_core', 'initMultiplayerRng', ['bits', 'pcg', 'rng', 'gpu-random', 'multiplayer', 'entity', 'seed']],
  ['multiplayer_random_core.initPositionRng', 'math.bits.legacy-deterministic-rng-position-seed32', 'multiplayer_random_core', 'initPositionRng', ['bits', 'pcg', 'rng', 'gpu-random', 'multiplayer', 'position', 'seed']],
  ['multiplayer_random_core.initInteractionRng', 'math.bits.legacy-deterministic-rng-interaction-seed32', 'multiplayer_random_core', 'initInteractionRng', ['bits', 'pcg', 'rng', 'gpu-random', 'multiplayer', 'interaction', 'seed']],
].map(([id, cpuFunctionId, chunkId, wgslSymbol, tags]) => mirrorEntry(id, cpuFunctionId, chunkId, wgslSymbol, tags));

export const WGSL_CHUNK_REGISTRY = deepFreeze(CHUNKS);
export const WGSL_MIRROR_REGISTRY = deepFreeze(MIRRORS);
export const WGSL_REGISTRY = deepFreeze([...WGSL_CHUNK_REGISTRY, ...WGSL_MIRROR_REGISTRY]);

export function wgslRegistryEntries(filters = {}) {
  const entries = Array.isArray(filters.registry) ? filters.registry : WGSL_REGISTRY;
  return entries.filter((entry) => {
    if (filters.kind && entry.kind !== filters.kind) return false;
    if (filters.sourceType && entry.sourceType !== filters.sourceType) return false;
    if (filters.chunkId && entry.chunkId !== filters.chunkId && entry.id !== filters.chunkId) return false;
    if (filters.tag && !entry.tags?.includes(filters.tag)) return false;
    return true;
  });
}

export function wgslRegistryById(id, registry = WGSL_REGISTRY) {
  return registry.find((entry) => entry.id === id) || null;
}

export function wgslMirrorsForChunk(chunkId, mirrors = WGSL_MIRROR_REGISTRY) {
  return mirrors.filter((entry) => entry.chunkId === chunkId);
}

export function wgslRegistryReport(
  chunks = WGSL_CHUNK_REGISTRY,
  mirrors = WGSL_MIRROR_REGISTRY,
  moduleExports = WGSL_MODULE_EXPORTS,
  moduleExportClassifications = WGSL_MODULE_EXPORT_CLASSIFICATIONS
) {
  const errors = [];
  const ids = new Set();
  const chunkIds = new Set();
  const exportRecords = moduleExportRecords(moduleExports);
  const moduleExportKeys = new Set(exportRecords.map((entry) => entry.key));
  const moduleExportClassificationCounts = Object.values(moduleExportClassifications).reduce((counts, entry) => {
    const key = entry?.classification || 'invalid';
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  const registeredModuleExportByKey = new Map(chunks
    .filter((entry) => entry?.sourceType === 'module-export')
    .map((entry) => [moduleExportKey(entry.sourcePath, entry.compileExportName), entry]));

  for (const record of exportRecords) {
    const classification = moduleExportClassifications[record.key];
    if (!classification) {
      errors.push(`moduleExportClassificationMissing:${record.key}`);
      continue;
    }
    if (classification.sourcePath !== record.sourcePath) errors.push(`moduleExportClassificationSourcePath:${record.key}`);
    if (classification.exportName !== record.exportName) errors.push(`moduleExportClassificationExportName:${record.key}`);
  }

  for (const [key, classification] of Object.entries(moduleExportClassifications)) {
    if (!moduleExportKeys.has(key)) {
      errors.push(`moduleExportClassificationStale:${key}`);
      continue;
    }
    const registeredChunk = registeredModuleExportByKey.get(key);
    if (registeredChunk) {
      if (classification.classification !== 'registered-chunk') errors.push(`moduleExportClassificationRegistered:${key}`);
      if (classification.registeredChunkId !== registeredChunk.id) errors.push(`moduleExportClassificationChunkId:${key}`);
      if (classification.compileCovered !== true) errors.push(`moduleExportClassificationCoverage:${key}`);
    } else {
      if (classification.classification === 'registered-chunk') errors.push(`moduleExportClassificationUnexpectedRegistered:${key}`);
      if (classification.registeredChunkId !== null) errors.push(`moduleExportClassificationUnexpectedChunk:${key}`);
      if (classification.compileCovered !== false) errors.push(`moduleExportClassificationUnexpectedCoverage:${key}`);
    }
  }

  for (const chunk of chunks) {
    if (!chunk || typeof chunk !== 'object') {
      errors.push('chunk');
      continue;
    }
    const isGeneratedModuleExportChunk = chunk.sourceType === 'module-export';
    const isManualModuleExportChunk = chunk.sourceType === 'manual-module-export';
    const isModuleExportChunk = isModuleExportSourceType(chunk.sourceType);
    if (typeof chunk.id !== 'string' || chunk.id.trim().length === 0) errors.push('chunk.id');
    if (ids.has(chunk.id)) errors.push(`${chunk.id}.duplicate`);
    ids.add(chunk.id);
    chunkIds.add(chunk.id);
    if (chunk.kind !== 'wgsl-chunk') errors.push(`${chunk.id}.kind`);
    if (typeof chunk.sourcePath !== 'string' || chunk.sourcePath.trim().length === 0) errors.push(`${chunk.id}.sourcePath`);
    if (typeof chunk.compileCaseId !== 'string' || chunk.compileCaseId.trim().length === 0) errors.push(`${chunk.id}.compileCaseId`);
    if (!isModuleExportChunk && chunk.sourceType !== 'file') errors.push(`${chunk.id}.sourceType`);
    if (isModuleExportChunk && (typeof chunk.compileExportName !== 'string' || chunk.compileExportName.trim().length === 0)) {
      errors.push(`${chunk.id}.compileExportName`);
    }
    if (isGeneratedModuleExportChunk) {
      const generatedModuleExportChunk = WGSL_REGISTERED_MODULE_EXPORT_CHUNKS[chunk.id];
      if (!generatedModuleExportChunk) {
        errors.push(`${chunk.id}.moduleExportGeneratedChunk`);
      } else {
        if (generatedModuleExportChunk.sourcePath !== chunk.sourcePath) errors.push(`${chunk.id}.moduleExportGeneratedSourcePath`);
        if (generatedModuleExportChunk.compileExportName !== chunk.compileExportName) errors.push(`${chunk.id}.moduleExportGeneratedExportName`);
        if (chunk.generatedModuleExportManifestPath !== 'engine/core/math/WGSLModuleExports.generated.js') {
          errors.push(`${chunk.id}.generatedModuleExportManifestPath`);
        }
        for (const tag of generatedModuleExportChunk.tags || []) {
          if (!chunk.tags.includes(tag)) errors.push(`${chunk.id}.moduleExportGeneratedTag:${tag}`);
        }
      }
      const sourceExports = moduleExports[chunk.sourcePath];
      if (!Array.isArray(sourceExports)) {
        errors.push(`${chunk.id}.moduleExportSourcePath`);
      } else if (!sourceExports.includes(chunk.compileExportName)) {
        errors.push(`${chunk.id}.moduleExportMissing`);
      }
    }
    if (isManualModuleExportChunk) {
      if (!chunk.sourcePath.endsWith('.js')) errors.push(`${chunk.id}.manualModuleExportSourcePath`);
      if (chunk.generatedModuleExportManifestPath !== null) errors.push(`${chunk.id}.generatedModuleExportManifestPath`);
    }
    if (chunk.sourceType === 'file' && chunk.compileExportName !== null) errors.push(`${chunk.id}.compileExportName`);
    if (chunk.sourceType === 'file' && chunk.generatedModuleExportManifestPath !== null) errors.push(`${chunk.id}.generatedModuleExportManifestPath`);
    if (!Array.isArray(chunk.compilePrefixIds)) errors.push(`${chunk.id}.compilePrefixIds`);
    const hasGeneratedModulePath = typeof chunk.generatedSourceModulePath === 'string' && chunk.generatedSourceModulePath.trim().length > 0;
    const hasGeneratedExportName = typeof chunk.generatedSourceExportName === 'string' && chunk.generatedSourceExportName.trim().length > 0;
    const hasGeneratedSourcePathExportName = typeof chunk.generatedSourcePathExportName === 'string' && chunk.generatedSourcePathExportName.trim().length > 0;
    if (chunk.sourceType === 'file') {
      if (!hasGeneratedModulePath) errors.push(`${chunk.id}.generatedSourceModulePath`);
      if (!hasGeneratedExportName) errors.push(`${chunk.id}.generatedSourceExportName`);
      if (!hasGeneratedSourcePathExportName) errors.push(`${chunk.id}.generatedSourcePathExportName`);
      const generatedSourceModule = generatedSourceModuleForPath(chunk.sourcePath);
      if (!generatedSourceModule) {
        errors.push(`${chunk.id}.generatedSourcePath`);
      }
      if (generatedSourceModule?.registryId !== chunk.id) errors.push(`${chunk.id}.generatedSourceRegistryId`);
      for (const tag of generatedSourceModule?.tags || []) {
        if (!chunk.tags.includes(tag)) errors.push(`${chunk.id}.generatedSourceTag:${tag}`);
      }
    }
    const hasRuntimePath = typeof chunk.runtimeExportPath === 'string' && chunk.runtimeExportPath.trim().length > 0;
    const hasRuntimeName = typeof chunk.runtimeExportName === 'string' && chunk.runtimeExportName.trim().length > 0;
    if (chunk.runtimeExportPath !== null && !hasRuntimePath) errors.push(`${chunk.id}.runtimeExportPath`);
    if (chunk.runtimeExportName !== null && !hasRuntimeName) errors.push(`${chunk.id}.runtimeExportName`);
    if (hasRuntimePath !== hasRuntimeName) errors.push(`${chunk.id}.runtimeExportPair`);
    if (!Array.isArray(chunk.tests) || !chunk.tests.includes('tests/wgsl-chunk-compile.html')) errors.push(`${chunk.id}.tests`);
  }

  for (const chunk of chunks) {
    if (!Array.isArray(chunk?.compilePrefixIds)) continue;
    for (const prefixId of chunk.compilePrefixIds) {
      if (!chunkIds.has(prefixId)) errors.push(`${chunk.id}.compilePrefixMissing:${prefixId}`);
      if (prefixId === chunk.id) errors.push(`${chunk.id}.compilePrefixCycle`);
    }
  }

  for (const mirror of mirrors) {
    if (!mirror || typeof mirror !== 'object') {
      errors.push('mirror');
      continue;
    }
    if (typeof mirror.id !== 'string' || mirror.id.trim().length === 0) errors.push('mirror.id');
    if (ids.has(mirror.id)) errors.push(`${mirror.id}.duplicate`);
    ids.add(mirror.id);
    if (mirror.kind !== 'wgsl-mirror') errors.push(`${mirror.id}.kind`);
    if (!chunkIds.has(mirror.chunkId)) errors.push(`${mirror.id}.chunkMissing`);
    if (typeof mirror.cpuFunctionId !== 'string' || mirror.cpuFunctionId.trim().length === 0) errors.push(`${mirror.id}.cpuFunctionId`);
    if (typeof mirror.wgslSymbol !== 'string' || mirror.wgslSymbol.trim().length === 0) errors.push(`${mirror.id}.wgslSymbol`);
    if (!Array.isArray(mirror.parityTests) || !mirror.parityTests.includes('tests/math-wgsl-parity.html')) errors.push(`${mirror.id}.parityTests`);
  }

  return {
    valid: errors.length === 0,
    errors,
    version: WGSL_REGISTRY_VERSION,
    chunkCount: chunks.length,
    mirrorCount: mirrors.length,
    entryCount: chunks.length + mirrors.length,
    compileCaseCount: chunks.filter((entry) => entry.tests?.includes('tests/wgsl-chunk-compile.html')).length,
    fileChunkCount: chunks.filter((entry) => entry.sourceType === 'file').length,
    moduleChunkCount: chunks.filter((entry) => entry.sourceType === 'module-export').length,
    manualModuleExportChunkCount: chunks.filter((entry) => entry.sourceType === 'manual-module-export').length,
    moduleExportPathCount: Object.keys(moduleExports).length,
    moduleExportTotalCount: exportRecords.length,
    moduleExportClassifiedCount: exportRecords.filter((entry) => moduleExportClassifications[entry.key]).length,
    moduleExportUnregisteredCount: exportRecords.filter((entry) => !moduleExportClassifications[entry.key]?.compileCovered).length,
    moduleExportClassificationCounts,
    moduleExportSourceCheckedCount: chunks.filter((entry) => (
      entry.sourceType === 'module-export' &&
      Array.isArray(moduleExports[entry.sourcePath]) &&
      moduleExports[entry.sourcePath].includes(entry.compileExportName)
    )).length,
    generatedModuleExportChunkCount: chunks.filter((entry) => {
      const generatedModuleExportChunk = WGSL_REGISTERED_MODULE_EXPORT_CHUNKS[entry.id];
      return (
        entry.sourceType === 'module-export' &&
        generatedModuleExportChunk?.sourcePath === entry.sourcePath &&
        generatedModuleExportChunk?.compileExportName === entry.compileExportName &&
        entry.generatedModuleExportManifestPath === 'engine/core/math/WGSLModuleExports.generated.js'
      );
    }).length,
    prefixedChunkCount: chunks.filter((entry) => entry.compilePrefixIds?.length > 0).length,
    generatedSourceModuleCount: chunks.filter((entry) => (
      entry.generatedSourceModulePath &&
      entry.generatedSourceExportName &&
      entry.generatedSourcePathExportName
    )).length,
    runtimeExportChunkCount: chunks.filter((entry) => entry.runtimeExportPath && entry.runtimeExportName).length,
    parityMirrorCount: mirrors.filter((entry) => entry.parityTests?.includes('tests/math-wgsl-parity.html')).length,
  };
}

export function mathRegistryWGSLMirrorReport(
  mathFunctions = MATH_FUNCTION_REGISTRY,
  wgslMirrors = WGSL_MIRROR_REGISTRY
) {
  const errors = [];
  const warnings = [];
  const mirrorById = new Map(wgslMirrors.map((entry) => [entry.id, entry]));
  const functionsById = new Map(mathFunctions.map((entry) => [entry.id, entry]));
  const shaderSafeFunctions = mathFunctions.filter((entry) => entry.shaderSafe);

  for (const entry of shaderSafeFunctions) {
    const mirror = mirrorById.get(entry.wgslMirrorId);
    if (!mirror) {
      errors.push(`${entry.id}.wgslMirrorMissing`);
      continue;
    }
    if (mirror.cpuFunctionId !== entry.id) errors.push(`${entry.id}.wgslMirrorFunctionMismatch`);
  }

  for (const mirror of wgslMirrors) {
    const fn = functionsById.get(mirror.cpuFunctionId);
    if (!fn) {
      warnings.push(`${mirror.id}.cpuFunctionMissing`);
    } else if (!fn.shaderSafe) {
      warnings.push(`${mirror.id}.cpuFunctionNotShaderSafe`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    shaderSafeFunctionCount: shaderSafeFunctions.length,
    linkedMirrorCount: shaderSafeFunctions.length - errors.length,
    registeredMirrorCount: wgslMirrors.length,
  };
}

export function wgslRegistryManifest(chunks = WGSL_CHUNK_REGISTRY, mirrors = WGSL_MIRROR_REGISTRY) {
  const report = wgslRegistryReport(chunks, mirrors);
  return {
    schema: 'particle-realms.wgsl-registry.manifest.v1',
    version: WGSL_REGISTRY_VERSION,
    valid: report.valid,
    entryCount: report.entryCount,
    chunkCount: report.chunkCount,
    mirrorCount: report.mirrorCount,
    compileCaseCount: report.compileCaseCount,
    fileChunkCount: report.fileChunkCount,
    moduleChunkCount: report.moduleChunkCount,
    manualModuleExportChunkCount: report.manualModuleExportChunkCount,
    moduleExportPathCount: report.moduleExportPathCount,
    moduleExportTotalCount: report.moduleExportTotalCount,
    moduleExportClassifiedCount: report.moduleExportClassifiedCount,
    moduleExportUnregisteredCount: report.moduleExportUnregisteredCount,
    moduleExportClassificationCounts: report.moduleExportClassificationCounts,
    moduleExportSourceCheckedCount: report.moduleExportSourceCheckedCount,
    generatedModuleExportChunkCount: report.generatedModuleExportChunkCount,
    prefixedChunkCount: report.prefixedChunkCount,
    generatedSourceModuleCount: report.generatedSourceModuleCount,
    runtimeExportChunkCount: report.runtimeExportChunkCount,
    parityMirrorCount: report.parityMirrorCount,
  };
}

export default {
  WGSL_REGISTRY_VERSION,
  WGSL_CHUNK_REGISTRY,
  WGSL_MIRROR_REGISTRY,
  WGSL_REGISTRY,
  wgslRegistryEntries,
  wgslRegistryById,
  wgslMirrorsForChunk,
  wgslRegistryReport,
  mathRegistryWGSLMirrorReport,
  wgslRegistryManifest,
};
