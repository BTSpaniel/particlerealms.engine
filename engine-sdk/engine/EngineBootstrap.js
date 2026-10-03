// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import * as ComputeNamespace from './core/compute/index.js';
// Keep the native spell-library persistence module available to PE.requireModule.
// Importing it creates only private metadata; storage access remains explicit.
import './gameplay/spells/SpellGeneratorIntegration.js';
export * from './core/compute/index.js';
export { ComputeNamespace as Compute };

/**
 * EngineBootstrap.js - Unified engine import for games and tests
 * 
 * Single import point for all engine functionality:
 * - Math utilities
 * - ECS (Entity Component System)
 * - Rendering (meshes, shaders, pipelines)
 * - Tools (inspector, camera, physics sandbox)
 * - GPU utilities (buffers, WebGPU init)
 * - Simulation (particles, fluids)
 * - Configuration
 */

// =============================================================================
// MATH
// =============================================================================
export {
  // Vec3 core
  vec3, vec3Add, vec3Sub, vec3Scale, vec3Dot, vec3Cross, vec3Length, vec3Normalize,
  vec3Lerp, vec3Negate, vec3Mul, vec3Distance, vec3DistanceSq, vec3LengthSq,
  vec3Clone, vec3Zero, vec3One, vec3Up, vec3Forward, vec3Right,
  // Vec3 deep audit
  vec3DirectionTo, vec3Midpoint, vec3Bounce, vec3Reflect, vec3Project,
  vec3SmoothDamp, vec3RotateTowards, vec3Refract, vec3FaceForward,
  vec3Saturate, vec3OctEncode, vec3OctDecode,
  // Vec2 core
  vec2, vec2Add, vec2Sub, vec2Scale, vec2Dot, vec2Length, vec2Normalize,
  vec2Lerp, vec2Distance, vec2Clone,
  // Quat
  quatRotateVec3, quatMultiply, quatNormalize, quatConjugate, quatInverse,
  quatSlerp, quatFromAxisAngle, quatFromEuler, quatIdentity, quatLookAt,
  quatRotateTowards, quatDifference,
  // Mat4 core
  mat4Identity, mat4Multiply, mat4Translate, mat4Scale, mat4Inverse,
  mat4LookAt, mat4FromRotationTranslation,
  mat4PerspectiveRad, mat4PerspectiveRadWebGPU,
  mat4PerspectiveDeg, mat4PerspectiveDegWebGPU,
  mat4Orthographic, mat4OrthographicWebGPU,
  // Scalar
  clamp, lerp, smoothstep, saturate, inverseLerp, remap,
  // Oscillator / resonance
  createOscillator, createOscillatorBank,
  sampleWave, sampleOscillator,
  sampleAmplitudeModulated, samplePhaseModulated, sampleRingModulated,
  beatFrequency, resonanceWeight, phaseCoherence, stepCoupledOscillators,
  rootAlgebraMask, rootAlgebraDimension, rootAlgebraGeneratorName,
  rootAlgebraBasisName, rootAlgebraFormatElement, rootAlgebraSquare,
  rootAlgebraMultiply, rootAlgebraTraceMultiply, rootAlgebraReverseMaskBits,
  rootAlgebraEncodedMultiply, rootAlgebraEncodedTrace,
  rootAlgebraGenerateTable, rootAlgebraCompileExecutionPlan,
  rootAlgebraEvaluateExecutionPlan, rootAlgebraExecutionPlanWGSL,
  rootAlgebraValidate, rootAlgebraPropertyReport,
  rootAlgebraFindSimpleZeroDivisors, rootAlgebraSearchEncodedMultipliers,
} from "./MathImports.js";

// Full math namespace for additional functions
export { Math } from "./MathImports.js";

// Collaboration runtime and its validated math/protocol boundaries.
export * from "./collab/index.js";

// =============================================================================
// ECS (Entity Component System)
// =============================================================================
export {
  createWorld,
  createEntity,
  stepWorld,
  stepWorldFrame,
  setEntityComponent,
  getEntityComponent,
  removeEntityComponent,
  createCamera,
  createLight,
  createPhysicsBody,
  createCollider,
  createTransform,
} from "./EcsImports.js";

export {
  destroyEntity,
  registerEntityDestroyHook,
  positiveSafeEntityHandleReport,
  encodeEntityHandle,
  decodeEntityHandle,
  splitEntityHandle,
  joinEntityHandle,
  WORLD_ENTITY_INDEX_BITS,
  WORLD_ENTITY_INDEX_CAPACITY,
  WORLD_ENTITY_INDEX_MASK,
  WORLD_ENTITY_MAX_GENERATION,
} from "./ecs/world/World.js";
export { removeEntityFromStorage } from "./ecs/storage/ArchetypeStorage.js";
export { createQuery, forEachEntity } from "./ecs/query/Query.js";
export {
  registerSystem,
  unregisterSystem,
  setSystemEnabled,
  getRegisteredSystems,
  setSystemGroupEnabled,
} from "./ecs/systems/SystemRegistry.js";
export {
  defineComponentType,
  getComponentDefinition,
  listComponentDefinitions,
  getComponentSchema,
  validateComponentSchema,
  createDefaultFromSchema,
} from "./ecs/components/ComponentRegistry.js";

// ECS Scene initialization
export { initEcsWorld, createMinimalWorld } from "./ecs/SceneInit.js";

export {
  EventGraph,
  createEvent,
} from "./gameplay/events/index.js";

export {
  RuleGraph,
  createRule,
  RuleCategory,
  RuleEffect,
} from "./gameplay/rules/index.js";

export {
  SchemaValidator,
} from "./core/schema/index.js";

export {
  ENGINE_VERSION,
  EDITOR_VERSION,
  PLAUNA_VERSION,
  AGI_CORE_VERSION,
  BUILD_TAG,
  ENGINE_FULL,
  EDITOR_FULL,
  PLAUNA_FULL,
  AGI_CORE_FULL,
  VERSION_BANNER,
  ENGINE_STARTED,
  EDITOR_STARTED,
  STATS,
} from "./version.js";

export {
  SaveSystem,
  SAVE_SCHEMA_VERSION,
  createLocalStorageAdapter,
} from "./core/save/index.js";

export {
  PerceptionGraph,
  PerceptionLevel,
} from "./gameplay/perception/index.js";

export {
  InstinctGraph,
  NPCBrain,
  DriveType,
} from "./gameplay/ai/index.js";

export {
  ContractSystem,
  ResolveSystem,
  PowerGraph,
  createPower,
  DomainGraph,
} from "./gameplay/progression/index.js";

export {
  SoulGraph,
  SoulGraphMessaging,
  createMessage,
  MessageChannel,
} from "./gameplay/social/index.js";

export {
  SimulationManager,
  SimLevel,
} from "./gameplay/simulation/index.js";

export {
  AnimationLearning,
  SkeletonHierarchy,
  MotionClip,
  MotionDataset,
  MotionMatcher,
  buildJointPositionDataset,
  buildMotionFeatureIndex,
  fillRagdollFeature,
  extractMotionClipFromGltf,
  extractMotionDatasetFromGltf,
  extractMotionClipFromFbxAscii,
  extractMotionDatasetFromFbxAsciiEntries,
  extractMotionDatasetFromFbxFiles,
  extractMotionDatasetFromFbxDirectoryHandle,
} from "./animation/index.js";

export {
  ItemOwnership,
  TransferType,
  createOwnedItem,
  ItemSoulSystem,
  SoulStage,
  SOUL_STAGE_NAMES,
} from "./gameplay/items/index.js";

export {
  Inventory,
  EquipSlot,
  createInventory,
  defaultResolveEquipSlot,
} from "./gameplay/inventory/index.js";

export {
  CitySystem,
  createCity,
  FactionGraph,
  createFaction,
  FactionAction,
  LawGraph,
  CrimeType,
  PunishmentType,
  createCrimeRecord,
} from "./gameplay/society/index.js";

export {
  extractOriginTags,
  mapTagsToOrigin,
  generateOrigin,
  LifePhases,
  Phase,
  StoryGraph,
  StoryletRarity,
  createStorylet,
  DialogueSystem,
  VoiceStyle,
  DialogueRunner,
  NodeType,
  node,
  textNode,
  choiceNode,
  branchNode,
  setNode,
  endNode,
  WorldDirector,
  DirectorEventType,
  SituationGraph,
  SituationBucket,
  CORE_STORYLETS,
} from "./gameplay/narrative/index.js";

// =============================================================================
// RENDERING
// =============================================================================
export {
  createUnitCubeMesh,
  getVertexBufferLayoutForMesh,
  createEngineMesh,
  createSkyboxGeometry,
  createCubeGeometry,
  createGroundGeometry,
  createPlaneGeometry,
  createSphereGeometry,
  createCylinderGeometry,
  createShaderLoader,
  createStandardRoomRenderer,
  createVoxelWorldRenderer,
  updateVoxelWorldFrameUniforms,
  updateStandardLights,
  updateStandardUniforms,
  createStandardEntityRenderResources,
  createSmokeVolumeRenderer,
  createParticleBillboardRenderer,
  createParticleBillboardDataBindGroup,
  setParticleBillboardParams,
  createParticleQualityManager,
  PARTICLE_QUALITY_PRESETS,
  IndexedClusterCuller,
} from "./RenderImports.js";

// Rendering initialization helpers
export {
  initParticleSystem,
  initSmokeRenderer,
  initSimulationRendering,
} from "./render/RenderingInit.js";

export {
  RASTERIZER_MODE,
  STATE_FIRST_REPRESENTATION,
  STATE_FIRST_DIRTY,
  STATE_FIRST_REPRESENTATION_NAMES,
  STATE_FIRST_QUALITY_PROFILE,
  StateFirstRasterizer,
  chooseStateFirstRepresentation,
  createStateFirstRasterizer,
  stateFirstModeLabel,
  StateFirstGpuCuller,
  createStateFirstGpuCuller,
  STATE_FIRST_RETAINED_RECORD_FLOATS,
  STATE_FIRST_RETAINED_RECORD_BYTES,
  STATE_FIRST_RETAINED_INDEX_BYTES,
  StateFirstRetainedStorage,
  createStateFirstRetainedStorage,
  STATE_FIRST_EXECUTION_BACKEND,
  STATE_FIRST_PARITY_STATUS,
  StateFirstExecutionBackend,
  createStateFirstExecutionBackend,
  STATE_FIRST_SOURCE,
  STATE_FIRST_SOURCE_VERSION,
  STATE_FIRST_SOURCE_KIND,
  StateFirstSourceBridge,
  discoverStateFirstSource,
  createStateFirstSourceBridge,
  StateFirstPresentationSlots,
  createStateFirstPresentationSlots,
  STATE_FIRST_ECS_METADATA_VERSION,
  StateFirstEcsSourceAdapter,
  createStateFirstEcsSourceAdapter,
} from "./render/state/index.js";

// Scene rendering helpers
export {
  renderEntities,
  encodeEntitiesClusterCulling,
  renderRoom,
  renderLightCube,
} from "./render/SceneRenderer.js";

// =============================================================================
// TOOLS
// =============================================================================
export {
  attachInspectorPanel,
  spawnPhysicsObjectAtPosition,
  configurePhysicsSandboxScene,
  getGhostPreviewInfo,
  createGhostSelectionState,
  addGhostToSelection,
  setActiveGhostInSelection,
  setActiveGhostBasePosition,
  setActiveGhostOffset,
  getGhostWorldPosition,
  getActiveGhost,
  getActiveGhostWorldPosition,
  pickRoomSurfaceFromRay,
  pickEntityFromRay,
  getPickRayForCanvasFromScreen,
  ROOM_PICKING_LIMITS,
  pickingRayReport,
  roomPickingOptionsReport,
  entityPickingOptionsReport,
  SCREEN_RAY_LIMITS,
  screenPickInputReport,
  screenCameraBasisReport,
  screenCameraStateReport,
  updateStandardCamera,
  getStandardCameraEyeBasis,
  STANDARD_CAMERA_LIMITS,
  standardCameraStateReport,
  standardCameraOptionsReport,
  standardCameraUpdateReport,
  standardCameraKeysReport,
  standardCameraMovementResponseReport,
  standardCameraZoomReport,
  standardCameraBoomReport,
  standardCameraFocusReport,
  standardCameraFocusTransitionReport,
  standardCameraSphereFitReport,
  standardCameraBoundsReport,
  standardCameraBoundsFocusReport,
  standardCameraMovementIntentReport,
  createGrabState,
  startGrabCandidate,
  cancelGrabCandidate,
  releaseGrabbed,
  attachPhysicsSandboxInspector,
} from "./ToolsImports.js";

// Global aiming helpers (shared by player and NPC logic)
export {
  getEntityWorldPosition,
  computeAimBetweenEntities,
  computeAimFromEntityToPoint,
} from "./tools/aiming/GlobalAim.js";

// Inspector config factory
export { createInspectorConfig } from "./tools/inspector/InspectorConfigFactory.js";

// Grab controller extensions
export {
  GRAB_CONTROLLER_LIMITS,
  grabControllerEntityReport,
  grabControllerTimingReport,
  grabControllerRayReport,
  updateGrabbedEntity,
  clearGrabForEntity,
} from "./tools/interaction/GrabController.js";

// Camera controller
export {
  stepCamera,
  syncCameraToEcs,
  updateCameraFull,
  switchCameraMode,
  focusThirdPersonCamera,
  cameraEntityBoundsReport,
  cameraEntityFocusReport,
  focusThirdPersonCameraOnEntities,
  CAMERA_CONTROLLER_LIMITS,
  cameraControllerStepReport,
  cameraCollisionOptionsReport,
  cameraFocusReport,
  cameraFocusTransitionReport,
  cameraControllerEntityReport,
  cameraModeSwitchReport,
} from "./tools/camera/CameraController.js";

// Entity management
export {
  deleteEntity,
  deleteSelectedEntity,
} from "./ecs/EntityManager.js";

// Spawn type defaults
export {
  SPAWN_TYPE_COLORS,
  SPAWN_TYPE_MESHES,
  SPAWN_TYPE_CATEGORIES,
  getSpawnTypeColor,
  getSpawnTypeMeshKey,
  getAvailableSpawnTypes,
  getSpawnTypesByCategory,
  resolveSpawnAppearance,
  createMeshLookup,
} from "./tools/spawn/SpawnTypeDefaults.js";

// Spawn manager
export {
  spawnEntity,
  spawnParticleEmitter,
} from "./tools/spawn/SpawnManager.js";

// Procedural skeleton generation (PCA + surface sampling)
export {
  generateProceduralSkeleton,
  augmentGeoWithSkeleton,
} from "./render/mesh/ProceduralSkeleton.js";

// =============================================================================
// PROXY GEOMETRY SYSTEM
// =============================================================================
export {
  ProxyGeometrySystem,
  PROXY_MODE,
  PROXY_TIER,
} from "./render/proxy/ProxyGeometrySystem.js";

export {
  TLASBuilder,
} from "./render/proxy/TLASBuilder.js";

export {
  ProxyBillboardAlign,
} from "./render/proxy/ProxyBillboardAlign.js";

export {
  ProxyOctahedralCache,
} from "./render/proxy/ProxyOctahedralCache.js";

export {
  ProxySDF,
} from "./render/proxy/ProxySDF.js";

export {
  ProxyMaskPass,
} from "./render/proxy/ProxyMaskPass.js";

export {
  ProxyShadePass,
} from "./render/proxy/ProxyShadePass.js";

export {
  ProxyGBufferPass,
} from "./render/proxy/ProxyGBufferPass.js";

export {
  PathTracingPass,
} from "./render/passes/PathTracingPass.js";

export {
  ReSTIRGIPass,
} from "./render/passes/ReSTIRGIPass.js";

export * from "./render/spectral/index.js";
export * from "./render/morphfield/index.js";

export {
  rayTerminationWGSL,
  restirGuidePolicyWGSL,
} from "./render/shaders/ShaderSources.js";

// Scene serialization
export {
  serializeScene,
  exportSceneToJson,
  downloadScene,
  parseSceneJson,
  loadSceneFromJson,
  loadSceneFromFile,
  createSceneFileInput,
} from "./tools/scene/SceneSerializer.js";

export {
  createInputController,
  attachInputListeners,
  detachInputListeners,
  consumeMouseDelta,
  consumeZoomDelta,
  getKeys,
  getInputActions,
  getInputActionMap,
  getMovementAxes,
  getLastMousePosition,
  pollInputGamepad,
  standardGamepadMovementReport,
  standardGamepadButtonReport,
  standardGamepadInputReport,
  standardGamepadHapticEffectReport,
  playStandardGamepadHaptics,
  standardInputWheelZoomReport,
  standardInputActionMapReport,
  standardInputActionStateReport,
  rebindStandardInputAction,
  DEFAULT_STANDARD_INPUT_ACTION_MAP,
  STANDARD_INPUT_LIMITS,
} from "./tools/input/StandardInputController.js";

// Ray Picking (unified wrappers)
export {
  createRayPicker,
  getCameraEyeBasisFromState,
  getPickRayFromState,
  RAY_PICKER_LIMITS,
  resolvePickFovRadians,
  rayPickerOptionsReport,
} from "./tools/picking/RayPicking.js";

// =============================================================================
// GPU UTILITIES
// =============================================================================
export {
  createUniformBuffer,
  createStorageBuffer,
  updateBuffer,
  destroyBuffer,
  destroyBuffers,
} from "./core/gpu/GpuBuffer.js";

export {
  BVHNode,
  BVHBuilder,
  serializeBVHForGPU,
  INF_T,
  EPSILON,
} from "./core/math/BVHAccel.js";

export * from "./core/math/TetrahedralCageAccel.js";
export * from "./core/math/TetrahedralCageCompiler.js";

export { encodeOctahedralNormal } from "./core/compression/CompressionUtils.js";

export { SurfaceCacheExtractor } from "./render/morphfield/systems/SurfaceCacheExtractor.js";

export { initWebGpuCanvas } from "./core/gpu/WebGpuCanvasBootstrap.js";
export { GPUTimestampProfiler } from "./core/gpu/GPUTimestampProfiler.js";
export { GpuRenderWorkerHost } from "./core/gpu/GpuRenderWorkerHost.js";
export { HiZPass } from "./render/passes/HiZPass.js";
export {
  ADAPTIVE_QUALITY_TIERS,
  AdaptiveQualityGovernor,
  createAdaptiveQualityGovernor,
} from "./core/gpu/AdaptiveQualityGovernor.js";
export { SVGFDenoise } from "./render/passes/SVGFDenoise.js";

// GPU initialization helpers
export {
  initGpuState,
  isWebGpuSupported,
  waitForCanvasReady,
} from "./core/gpu/GpuInit.js";

// App bootstrap helpers
export {
  bootstrapApp,
  createMainLoop,
  runApp,
} from "./core/AppBootstrap.js";

export {
  drawMesh,
  drawMeshes,
  encodeIndexedMeshClusterCulling,
  beginStandardRenderPass,
  ensureDepthTexture,
  ensureSceneColorTexture,
  buildViewProjData,
  renderParticleBillboards,
  renderVolumetricSmoke,
} from "./render/DrawHelpers.js";

// =============================================================================
// SIMULATION - Particles
// =============================================================================
export {
  createParticleSimWorld,
  stepParticleSimWorld,
  destroyParticleSimWorld,
  attachFluidWorld,
  configureParticleLongRange,
  getParticleLongRangeState,
  createNBodySystem,
  initNBodyBindGroups,
  executeNBody,
  destroyNBodySystem,
  createFmmSystem,
  initFmmBindGroups,
  executeFmm,
  readFmmDiagnostics,
  destroyFmmSystem,
  createParticleMeshEwaldSystem,
  initParticleMeshEwaldBindGroups,
  executeParticleMeshEwald,
  readParticleMeshEwaldDiagnostics,
  destroyParticleMeshEwaldSystem,
  normalizeFmmConfig,
  estimateFmmMemory,
  fmmLevelCellCount,
  fmmLevelOffset,
  fmmTotalCellCount,
  fmmSelectDepth,
  fmmCellCoordinate,
  fmmMortonCellIndex,
  fmmInteractionCells,
  normalizeParticleMeshConfig,
  estimateParticleMeshMemory,
  generateProlateWindowTable,
  generateProlateSplitTable,
  prolateSplitFourierResponse,
  directLongRangeAccelerations,
  compareLongRangeVectors,
  createNeighborGridSystem,
  initNeighborGridBindGroups,
  buildNeighborGrid,
  getNeighborGridBuffers,
  destroyNeighborGridSystem,
} from "./sim/particles/ParticleSimWorld.js";

export {
  createNoiseTextureSystem,
  bakeNoiseTexture,
  destroyNoiseTextureSystem,
} from "./sim/particles/ParticleNoiseTexture.js";

export {
  createMeshParticleBuffers,
  generateMeshParticlesIntoWorld,
  generateMeshParticlesIntoParticlesState,
} from "./sim/particles/MeshToParticlesCompute.js";

export {
  updateAttachedParticlesIntoWorld,
  updateAttachedParticlesIntoParticlesState,
} from "./sim/particles/AttachedParticlesCompute.js";

export {
  // States of matter & elements
  ELEMENTS,
  STATES,
  EMITTER_TYPES,
  getElements,
  getStates,
  getEmitterTypes,
  getEmitterPreset,
  deriveColorFromElements,
  // Emitter creation
  createEmitter,
  createEmittersForEffect,
  normalizeElementPower,
  mixElementPower,
  buildEffectKeyFromElements,
  computeVisualPower,
  stepEmitters,
  buildColliderBuffer,
  buildFluidSources,
  // Particle slot tracking
  initSlotTracking,
  updateParticleCounts,
} from "./sim/particles/ParticleEmitterSystem.js";

export {
  SANDBOX_REFERENCE_TEMPERATURE_K,
  SANDBOX_TEMPERATURE_STEP_K,
  SANDBOX_SPECIES_CAPACITY,
  SANDBOX_SUBSTANCE_CODE_BASE,
  SANDBOX_BEHAVIOR,
  SANDBOX_PHASE,
  SANDBOX_FLAGS,
  SANDBOX_REACTION,
  SANDBOX_INTERACTION,
  SANDBOX_OBJECT,
  SANDBOX_OBJECTS,
  createSandboxMaterialCatalog,
  createSandboxSpeciesLut,
  temperatureToSandboxBucket,
  sandboxBucketToTemperature,
  packSandboxCell,
  unpackSandboxCell,
  packSandboxObject,
  unpackSandboxObject,
  sandboxSpeciesIdForSubstance,
  validateSandboxMaterialCatalog,
} from "./sim/particles/substances/SandboxMaterialCatalog.js";

// =============================================================================
// SIMULATION - Fluids
// =============================================================================
export {
  createFluidSimWorld,
  stepFluidSimWorld,
  initFluidSimWorldLazy,
  clearFluidSimWorld,
  clearFluidDensity,
} from "./sim/fluids/FluidSimWorld.js";

export { splatFluidSources, splatParticleDensity } from "./sim/fluids/FluidSourceSplat.js";

// MPM (Material Point Method) hybrid particle-grid simulation
export {
  createMPMWorld,
  destroyMPMWorld,
  stepMPMWorld,
  setMPMWorldBounds,
  createMPMBuffers,
  createMPMPipelines,
} from "./sim/fluids/FluidMPM.js";
import * as FluidMPMAll from "./sim/fluids/FluidMPM.js";

// World fluid domain (collider-based boundaries)
export {
  buildFluidDomainFromColliders,
  createSolidMaskTexture,
  createWorldFluidDomain,
  updateWorldFluidDomainParams,
  destroyWorldFluidDomain,
  rebuildSolidMask,
} from "./sim/fluids/FluidWorldDomain.js";
import * as FluidWorldDomainAll from "./sim/fluids/FluidWorldDomain.js";

// Fluid boundary enforcement
export {
  createBoundaryShader,
  createBoundaryPipeline,
  applyBoundaries,
} from "./sim/fluids/FluidBoundary.js";
import * as FluidBoundaryAll from "./sim/fluids/FluidBoundary.js";

// Phase change (freeze/melt) with particle chain reaction
export {
  FluidPhase,
  PARTICLE_PHASE_STRIDE,
  DEFAULT_CRYSTAL_PARAMS,
  createPhaseChangeBuffers,
  createSpellForce,
  createCrystallizationShader,
  createCrystallizationPipeline,
  stepCrystallization,
  applyPhaseVisuals,
  injectFreezeSeeds,
  injectHeatSeeds,
  createSeedInjectionParams,
  extractFrozenShape,
  extractFrozenParticles,
  clearFreezeRegion,
  injectMeltedFluid,
  destroyPhaseChangeBuffers,
} from "./sim/fluids/FluidPhaseChange.js";
import * as FluidPhaseChangeAll from "./sim/fluids/FluidPhaseChange.js";

// Screen-space water/metaball rendering
export {
  createFluidWaterPass,
  renderFluidWater,
  resizeFluidWaterPass,
  destroyFluidWaterPass,
} from "./render/passes/FluidWaterPass.js";
import * as FluidWaterAll from "./render/passes/FluidWaterPass.js";

// Authored-image screen-space heat refraction
export { ImageHeatHazePass, projectImagePointToViewport, startImageHeatHaze } from "./render/passes/ImageHeatHazePass.js";
import * as ImageHeatHazeAll from "./render/passes/ImageHeatHazePass.js";

// Lightweight interactive underwater particulate field
export { UnderwaterSiltField, startUnderwaterSiltField } from "./render/passes/UnderwaterSiltField.js";
import * as UnderwaterSiltAll from "./render/passes/UnderwaterSiltField.js";

// GPU Spell Effect rendering
export {
  createSpellEffectPass,
  renderSpellEffects,
  spellElementToEffectType,
  spellConfigToInstance,
  EFFECT_TYPES as SPELL_EFFECT_TYPES,
  SPELL_TYPES as SPELL_PASS_TYPES,
} from "./render/passes/SpellEffectPass.js";
import * as SpellEffectPassAll from "./render/passes/SpellEffectPass.js";

// Simulation Update (unified stepping)
export {
  stepParticles,
  stepFluid,
  stepAllSimulations,
} from "./sim/SimulationUpdate.js";

// =============================================================================
// CONFIGURATION & STATE
// =============================================================================
export { Config } from "./EngineImports.js";

// State factory functions
export {
  DEFAULT_CONFIG,
  DEFAULT_PHYSICS,
  DEFAULT_RENDER,
  createGpuState,
  createConfigState,
  createPhysicsState,
  createEcsState,
  createSpawnState,
  createParticlesState,
  createSmokeState,
  createRenderState,
  createCameraState,
  createInputState,
  createWaterPassState,
  createAudioState,
  createAllState,
  applyEngineConfigToState,
  applyEngineConfigToPhysics,
} from "./config/EngineState.js";

// =============================================================================
// AUDIO ENGINE
// =============================================================================
export {
  createAudioEngine,
  initAudioEngine,
  resumeAudioEngine,
  tickAudioEngine,
  triggerAudioEvent,
  playBuffer,
  stopSource,
  stopAllSources,
  registerAudioEvent,
  unregisterAudioEvent,
  setMasterVolume,
  setBusVolumeByName,
  destroyAudioEngine,
  updateAudioListener,
  registerFootstepEvents,
  unregisterFootstepEvents,
  resolveFootstepMaterial,
} from "./audio/core/index.js";

export {
  createCharacterAudioBridge,
  tickCharacterAudio,
  removeCharacter,
  destroyCharacterAudioBridge,
} from "./audio/bridge/index.js";


// =============================================================================
// BUNDLED ENGINE NAMESPACE
// For simple imports: import * as Engine from "./EngineBootstrap.js"
// Then use: Engine.vec3(), Engine.createWorld(), etc.
// =============================================================================
import * as MathAll from "./MathImports.js";
import * as ECSAll from "./EcsImports.js";
import * as RenderAll from "./RenderImports.js";
import * as ToolsAll from "./ToolsImports.js";
import * as GpuBufferAll from "./core/gpu/GpuBuffer.js";
import * as WebGpuCanvasAll from "./core/gpu/WebGpuCanvasBootstrap.js";
import * as GpuTimestampAll from "./core/gpu/GPUTimestampProfiler.js";
import * as GpuRenderWorkerAll from "./core/gpu/GpuRenderWorkerHost.js";
import * as DrawHelpersAll from "./render/DrawHelpers.js";
import * as ParticleSimAll from "./sim/particles/ParticleSimWorld.js";
import * as MeshToParticlesAll from "./sim/particles/MeshToParticlesCompute.js";
import * as AttachedParticlesAll from "./sim/particles/AttachedParticlesCompute.js";
import * as ParticleEmitterAll from "./sim/particles/ParticleEmitterSystem.js";
import * as SandboxMaterialAll from "./sim/particles/substances/SandboxMaterialCatalog.js";
import * as ParticleBillboardAll from "./render/particles/ParticleBillboardRenderer.js";
import * as FluidSimAll from "./sim/fluids/FluidSimWorld.js";
import * as FluidSplatAll from "./sim/fluids/FluidSourceSplat.js";
import * as SimUpdateAll from "./sim/SimulationUpdate.js";
import * as ConfigAll from "./config/EngineConfig.js";
import * as StateAll from "./config/EngineState.js";
import * as AudioCoreAll from "./audio/core/index.js";
import * as RayPickingAll from "./tools/picking/RayPicking.js";
import * as SpawnDefaultsAll from "./tools/spawn/SpawnTypeDefaults.js";
import * as SpawnManagerAll from "./tools/spawn/SpawnManager.js";
import * as InputAll from "./tools/input/StandardInputController.js";
import * as GrabAll from "./tools/interaction/GrabController.js";
import * as CameraCtrlAll from "./tools/camera/CameraController.js";
import * as EntityManagerAll from "./ecs/EntityManager.js";
import * as SceneInitAll from "./ecs/SceneInit.js";
import * as CoreSchemaAll from "./core/schema/index.js";
import * as CoreSaveAll from "./core/save/index.js";
import * as GameplayEventsAll from "./gameplay/events/index.js";
import * as GameplayRulesAll from "./gameplay/rules/index.js";
import * as GameplayPerceptionAll from "./gameplay/perception/index.js";
import * as GameplayAIAll from "./gameplay/ai/index.js";
import * as GameplayProgressionAll from "./gameplay/progression/index.js";
import * as GameplaySocialAll from "./gameplay/social/index.js";
import * as GameplaySimulationAll from "./gameplay/simulation/index.js";
import * as GameplayItemsAll from "./gameplay/items/index.js";
import * as GameplayInventoryAll from "./gameplay/inventory/index.js";
import * as GameplaySocietyAll from "./gameplay/society/index.js";
import * as NetworkAll from "./network/index.js";
import * as RenderingInitAll from "./render/RenderingInit.js";
import * as SceneRendererAll from "./render/SceneRenderer.js";
import * as StateRasterizerAll from "./render/state/index.js";
import * as SpectralRenderAll from "./render/spectral/index.js";
import { MorphField as MorphFieldNamespace } from "./render/morphfield/index.js";
import * as InspectorConfigAll from "./tools/inspector/InspectorConfigFactory.js";
import * as GpuInitAll from "./core/gpu/GpuInit.js";
import * as AppBootstrapAll from "./core/AppBootstrap.js";
import * as SceneSerializerAll from "./tools/scene/SceneSerializer.js";
import * as AimAll from "./tools/aiming/GlobalAim.js";
import * as ProceduralSkeletonAll from "./render/mesh/ProceduralSkeleton.js";
import * as NarrativeAll from "./gameplay/narrative/index.js";
import * as AnimationAll from "./animation/index.js";

/**
 * Bundled Engine namespace - contains all exports in one object
 */
// Playground-only subsystems: bind as explicit named exports so the
// playground `loadRawEngineModule()` resolver can serve them directly from
// `window.PE` instead of attempting raw /engine/ imports that 404 on the
// deployed site (no raw engine/ tree is shipped in release).
import * as _ParticleState from "./state/index.js";
import * as _ParticleSurfaces from "./surfaces/index.js";
import * as _ParticleAssets from "./assets/index.js";
import { Rig as _ParticleRig } from "./assets/rig/index.js";
import * as _ParticleAudio from "./audio/index.js";
import * as _ParticleCollab from "./collab/index.js";
import * as _ParticleCompat from "./compat/index.js";
import * as _ParticleCore from "./core/index.js";
import * as _ParticleMatter from "./matter/index.js";
import * as _ParticleRender from "./render/index.js";
import * as _ParticleWorld from "./world/index.js";
import * as _ParticleMathRandom from "./core/math/MathRandom.js";
import * as _ParticleMathGeometry from "./core/math/MathGeometry.js";
import * as _ParticleAIVehicles from "./sim/ai/AIVehicle.js";
import * as _ParticleAIUtility from "./sim/ai/AIUtility.js";
import * as _ParticlePBD from "./sim/physics/PBDSolver.js";
import * as _ParticleWovenCloth from "./sim/cloth/WovenCloth.js";
import * as _ParticlePhysXPhysicsWorld from "./sim/physics/PhysXPhysicsWorld.js";
import * as _ParticlePhysicsRuntime from "./sim/PhysicsRuntime.js";
import * as _ParticlePhysXVehicle from "./sim/physics/PhysXVehicle.js";
import * as _ParticleSubstances from "./sim/particles/substances/index.js";
// Reformulated compressible Navier–Stokes grid solver (shear + longitudinal
// viscosity channels, per-cell materials, acoustic field, SingularityGuard
// diagnostics). Namespaced so playground demos reach it through window.PE in
// release builds instead of raw /engine/ imports that do not ship.
import * as _ParticleCompressibleNS from "./sim/fluids/CompressibleNavierStokes.js";
// Spring/motor/coil actuator (shared by pinball flippers and the printer
// extruder) and the lumped thermal RC + shutdown model (heater blocks).
import * as _ParticleActuator from "./sim/mechanics/ElectromechanicalActuator.js";
import * as _ParticleElectricalThermal from "./sim/electrical/ElectricalThermalProtection.js";
import * as _ParticleWaterThermodynamics from "./sim/thermodynamics/WaterThermodynamics.js";
import * as _ParticleSurfaceFields from "./sim/surfaceFields/index.js";
import * as _ParticleSurfaceFieldRendering from "./render/surfaceFields/index.js";
import * as _ParticleFlowRendering from "./render/flow/index.js";
// Voxel + world subsystem. Bound as a namespace rather than re-exported flatly:
// `voxel/index.js` intentionally re-exports render passes, atmosphere, physics and
// fluids for backward compatibility, so a flat `export *` here would collide with
// the named exports this module already publishes (TAAPass, SSAOPass, BloomPass,
// HiZPass, UnderwaterPass, CascadedShadowMap, HDRPipeline, FOG_TYPE, PipelineCache,
// VolumetricRaymarcher, DEFAULT_PARAMS, ...). Callers use `PE.Voxel.*`.
import * as _ParticleVoxel from "./voxel/index.js";
// AI sensing (vision cones, hearing, scent, awareness states, GPU LOS batching)
// and the anatomy subsystem (per-organ damage, circulation, and a nervous
// system with per-region motor/sensory/pain channels). Both were unreachable
// from any compiled bundle for the same reason the voxel tree was: nothing in
// the entry graph imported them. Namespaced for the same reason too — they
// re-export names that already exist at the top level.
import * as _ParticleAI from "./sim/ai/index.js";
import * as _ParticleAnatomy from "./assets/rig/active-body/anatomy/index.js";
// Structural integrity: stress propagation, breaking thresholds, and progressive
// collapse with anchor types. Bound from the leaf module rather than from
// `sim/physics/index.js` deliberately — that barrel also re-exports the GPU
// Voronoi fracture path, the mesh cutter and the whole rig tree, and this class
// has *zero* imports of its own. Pulling the barrel in to reach one
// self-contained CPU class would drag GPU bind-group and memory-manager modules
// into every consumer that only wants to know whether a ceiling is about to fall.
import * as _ParticleStructural from "./sim/physics/StructuralIntegrity.js";

export { _ParticleState as particleState };
export { _ParticleSurfaces as particleSurfaces };
export { _ParticleAssets as particleAssets };
export { _ParticleRig as particleRig };
export { _ParticleMathRandom as particleMathRandom };
export { _ParticleMathGeometry as particleMathGeometry };
export { _ParticleAIVehicles as particleAIVehicles };
export { _ParticleAIUtility as particleAIUtility };
export { _ParticlePBD as particlePBD };
export { _ParticleWovenCloth as particleWovenCloth };
export { _ParticlePhysXPhysicsWorld as particlePhysXPhysicsWorld };
export { _ParticlePhysicsRuntime as particlePhysicsRuntime };
export { _ParticlePhysXVehicle as particlePhysXVehicle };
export { PhysXPhysicsWorld } from "./sim/physics/PhysXPhysicsWorld.js";
export {
  createPhysXVehicle,
  isPhysXVehicleSupported,
} from "./sim/physics/PhysXVehicle.js";
export { _ParticleSubstances as particleSubstances };
export { _ParticleCompressibleNS as particleCompressibleNS };
export { _ParticleActuator as particleActuator };
export { _ParticleElectricalThermal as particleElectricalThermal };
export { _ParticleWaterThermodynamics as WaterThermodynamics };
export { _ParticleSurfaceFields as SurfaceFields };
export { _ParticleSurfaceFieldRendering as SurfaceFieldRendering };
export { _ParticleFlowRendering as FlowRendering };
export { _ParticleVoxel as particleVoxel };
export { _ParticleVoxel as voxel };
export { _ParticleAI as particleAI };
export { _ParticleAnatomy as particleAnatomy };
export { _ParticleStructural as particleStructural };

// Stable public subsystem namespaces. Every top-level public barrel is exposed
// directly on window.PE so compiled-bundle consumers never depend on whichever
// leaf exports happened to be flattened into EngineBootstrap in a given build.
export { AnimationAll as Animation };
export { _ParticleAssets as Assets };
export { _ParticleRig as Rig };
export { _ParticleAI as AI };
export { _ParticleAnatomy as Anatomy };
export { _ParticleAudio as Audio };
export { _ParticleCollab as Collab };
export { _ParticleCompat as Compat };
export { _ParticleCore as Core };
export { _ParticleMatter as Matter };
export { NetworkAll as Network };
export { NetworkAll as network };
export { _ParticleRender as Render };
export { _ParticleState as State };
export { _ParticleStructural as Structural };
export { _ParticleSurfaces as Surfaces };
export { _ParticleVoxel as Voxel };
export { _ParticleWorld as World };

export const Engine = {
  // Named compute namespace preserves scalar MathEngine APIs and explicit ownership.
  Compute: ComputeNamespace,
  // Math
  ...MathAll,
  // ECS
  ...ECSAll,
  ...EntityManagerAll,
  ...SceneInitAll,
  ...CoreSchemaAll,
  ...CoreSaveAll,
  ...GameplayEventsAll,
  ...GameplayRulesAll,
  ...GameplayPerceptionAll,
  ...GameplayAIAll,
  ...GameplayProgressionAll,
  ...GameplaySocialAll,
  ...GameplaySimulationAll,
  ...GameplayItemsAll,
  ...GameplayInventoryAll,
  ...GameplaySocietyAll,
  ...NetworkAll,
  ...NarrativeAll,
  ...AnimationAll,
  // Rendering
  ...RenderAll,
  ...DrawHelpersAll,
  ...ParticleBillboardAll,
  ...RenderingInitAll,
  ...SceneRendererAll,
  ...StateRasterizerAll,
  ...SpectralRenderAll,
  // Additive renderer namespace; the existing renderer remains the default.
  MorphField: MorphFieldNamespace,
  // Voxel + world namespace (chunk registry, meshers, raycast, streaming, storage).
  // Namespaced for the same reason as the import above: flat spreading would
  // overwrite the render-pass exports this object already carries.
  Voxel: _ParticleVoxel,
  // AI sensing and anatomy. Namespaced for the same reason.
  AI: _ParticleAI,
  Anatomy: _ParticleAnatomy,
  // Generated ragdoll descriptors, joint limits, simulation and skinning.
  Rig: _ParticleRig,
  // Structural integrity — stress propagation and progressive collapse.
  Structural: _ParticleStructural,
  // Stable engine infrastructure, including frame and timing policy.
  Core: _ParticleCore,
  // Unified definitions, runtime state, model coupling, and transformations.
  Matter: _ParticleMatter,
  WaterThermodynamics: _ParticleWaterThermodynamics,
  // Surface transport and retained material state reuse the native solid model.
  SurfaceFields: _ParticleSurfaceFields,
  SurfaceFieldRendering: _ParticleSurfaceFieldRendering,
  FlowRendering: _ParticleFlowRendering,
  // Tools
  ...ToolsAll,
  ...RayPickingAll,
  ...SpawnDefaultsAll,
  ...SpawnManagerAll,
  ...InputAll,
  ...GrabAll,
  ...CameraCtrlAll,
  ...InspectorConfigAll,
  ...SceneSerializerAll,
  ...AimAll,
  // GPU
  ...GpuBufferAll,
  ...WebGpuCanvasAll,
  ...GpuTimestampAll,
  ...GpuRenderWorkerAll,
  ...GpuInitAll,
  ...AppBootstrapAll,
  // Simulation
  ...ParticleSimAll,
  ...MeshToParticlesAll,
  ...AttachedParticlesAll,
  ...ParticleEmitterAll,
  ...SandboxMaterialAll,
  ...FluidSimAll,
  ...FluidSplatAll,
  ...FluidMPMAll,
  ...FluidWorldDomainAll,
  ...FluidBoundaryAll,
  ...FluidPhaseChangeAll,
  ...SimUpdateAll,
  // Water rendering
  ...FluidWaterAll,
  ...ImageHeatHazeAll,
  ...UnderwaterSiltAll,
  // Spell effects rendering
  ...SpellEffectPassAll,
  // Procedural skeleton generation
  ...ProceduralSkeletonAll,
  // Config & State
  Config: ConfigAll,
  ...StateAll,
  // Audio
  ...AudioCoreAll,
};
