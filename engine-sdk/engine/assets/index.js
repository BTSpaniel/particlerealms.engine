// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/index.js — Global Asset Ingestion Runtime barrel.
//
// Turns any source file into an EngineModel and a usable simulation object:
//   decode → normalize → deduplicate → preserve hierarchy/materials/animations
//   → generate colliders/SDF/rigs/surfaces → cache → spawn.
//
// Build status:
//   [x] Phase 0  foundations (EngineModel, AssetRecord, vpath, canonical space)
//   [x] Phase 1  asset core (dedup, cache/OPFS, registry, resolver, importers)
//   [x] Phase 2  materials & textures (decode, bindings, segments, variants)
//   [x] Phase 3  vehicles (wheel/chassis detect, rig builder, suspension/tire/sync)
//   [x] Render   reusable model rendering (shader/pipeline, GPU drawables,
//                wheel-spin, ModelRenderer) + geometry PCA — shared by demos,
//                editor, and runtime so importing/viewing assets is one call.
//   [ ] Phase 4  render surfaces
//   [ ] Phase 5  humanoids, hands & weapons

// --- Phase 0: foundations ---
export {
  createEngineModel, createImportTransform, createEngineNode,
  createEngineMesh, createEnginePrimitive, ENGINE_MODEL_LAYERS, layerStatus,
} from './EngineModel.js';

export {
  ASSET_TYPES, createAssetRecord, createLicenseBlock, licenseNeedsReview,
} from './AssetRecord.js';

export {
  VPATH_SCHEMES, parseVPath, isVPath, makeVPath, normalizeSegments,
  withScheme, vpathBasename, vpathExtension, cachePathFor,
} from './vpath.js';

export {
  CANONICAL, axisVector, axisCorrectionQuat, mat3ToQuat, rotateVecByQuat,
  UNIT_TO_METERS, unitScaleToMeters,
} from './CanonicalSpace.js';

// --- Phase 1: asset core ---
export { hashContent, classify, DEDUP } from './AssetDeduper.js';
export { AssetCache } from './AssetCache.js';
export { AssetRegistry } from './AssetRegistry.js';
export {
  AssetResolver, backendFromCache, makeFetchBackend, makeMemoryBackend,
} from './AssetResolver.js';
export { LicenseTracker, GATE } from './LicenseTracker.js';

// --- Phase 1: import pipeline ---
export {
  detectFormat, sniffMagic, classOf, FORMAT_CLASS,
  NATIVE_FORMATS, BRIDGE_FORMATS, IMAGE_FORMATS,
} from './import/FormatDetector.js';
export { importGltf, parseGlb } from './import/GltfSceneImporter.js';
export { importObj, parseMtl } from './import/ObjImporter.js';
export { importStl } from './import/StlImporter.js';
export { importPly } from './import/PlyImporter.js';
export {
  resolveOrientation, classifyConfidence, CONFIDENCE_POLICY,
} from './import/OrientationResolver.js';
export { detectHierarchy, detectParts, detectSemanticDomain } from './import/Detectors.js';
export {
  uploadModel, uploadPrimitive, releaseModelGpu,
  standardVertexLayout, interleaveStandard, STANDARD_STRIDE_FLOATS,
} from './import/GpuUploader.js';
export { importFile, parseToModel } from './import/ImportPipeline.js';

// --- Phase 2: materials & textures ---
export {
  WORKFLOW, ALPHA_MODE, TEXTURE_SLOTS, COLOR_SPACE, TEXTURE_USAGE,
  defaultChannelMap, createEngineMaterial, createTextureBinding, hasTextureTransform,
} from './material/EngineMaterial.js';
export { importMaterials } from './material/MaterialImport.js';
export { normalizeTextures, decodeTexture, decodeAllTextures } from './material/TextureImport.js';
export { buildSurfaceBindings } from './material/SurfaceBinding.js';
export { SEGMENT_MODE, createSegmentView, bakeSegment } from './material/SegmentView.js';
export {
  createMaterialVariant, approximateToMetallicRoughness, restoreOriginal,
} from './material/MaterialVariant.js';

// --- Phase 3: vehicles ---
export {
  createWheelSlot, createSuspension, createTireProfile, createVehicleAsset,
  DRIVETRAIN, WHEEL_PHYSICS_MODE,
} from './vehicle/WheelSlot.js';
export { detectWheels } from './vehicle/WheelDetector.js';
export { detectChassis } from './vehicle/ChassisDetector.js';
export { buildVehicleRig } from './vehicle/VehicleRigBuilder.js';
export {
  suspensionForce, tireForce, longitudinalSlip, freeRollAngularVelocity,
  visualWheelMatrix, advanceSpin,
} from './vehicle/WheelPhysics.js';
export {
  computeWorldMatrices, composeTRS as vehicleComposeTRS, transformPoint as vehicleTransformPoint,
} from './vehicle/VehicleMath.js';
export {
  rotAxis, pivotSpin, buildWheelSpinMap, rollAngle,
} from './vehicle/WheelSpinVisual.js';
export {
  VEHICLE_AUTHORING_BASIS, VEHICLE_PROFILE_SCHEMA, VEHICLE_PROFILE_VERSION,
  SEDAN_2_PROFILE, DEFAULT_CAR_PROFILE, resolveVehicleProfile, resolveCarProfile,
  vehicleProfileKey, carProfileKey,
} from './vehicle/VehicleProfile.js';
export {
  computeMeshBounds as computeVehicleMeshBounds,
  aggregateBounds as aggregateVehicleBounds,
  translateMesh as translateVehicleMesh,
  makeBoxMesh as makeVehicleBoxMesh,
  makeTaperedBoxMesh as makeVehicleTaperedBoxMesh,
  makeCylinderMesh as makeVehicleCylinderMesh,
} from './vehicle/VehicleProceduralGeometry.js';
export {
  SEDAN_VISUAL_PART_IDS, buildSedanModel, buildCarModel,
} from './vehicle/SedanProceduralModel.js';
export {
  VEHICLE_PHYSX_BASIS, VEHICLE_BASIS_ADAPTER,
  vehicleHeadingToPhysXYaw, vehicleDrivetrainRatios,
  vehicleProfileToPhysXOptions, composeXForwardVehicleWorld,
} from './vehicle/VehicleBasisAdapter.js';
export {
  VEHICLE_PUBLIC_RUNTIME_CAPABILITY, VEHICLE_PUBLIC_DRIVETRAIN_CAPABILITY,
  inspectPublicVehicleDrivetrain, configurePublicVehicleDrivetrain,
  inspectPublicVehicleRuntime, createPublicVehicleRuntime,
} from './vehicle/VehiclePublicRuntime.js';

// --- Phase 5: humanoids ---
export {
  HUMANOID_BONES, REQUIRED_BONES, BODY_SIDE, createHumanoidRig, boneSide, mirrorBone,
} from './humanoid/HumanoidRig.js';
export { mapBones } from './humanoid/BoneMapper.js';
export { buildHumanoidRig } from './humanoid/HumanoidRigBuilder.js';
export { FINGERS, FINGER_JOINTS, HAND_SOURCE, createFinger, createHandRig } from './humanoid/HandRig.js';
export { mapFingers } from './humanoid/FingerMapper.js';
export { generateFingers } from './humanoid/FingerGenerator.js';
export { buildHandRig, buildHands, extractHandVertices } from './humanoid/HandRigBuilder.js';
export { buildBindPose, jointPosition, invert4 } from './humanoid/SkinPose.js';
export { healHumanoid, humanoidBonePosition, analyzeSymmetry, healSkeleton } from './humanoid/SkeletonHeal.js';
export * from './rig/index.js';

// --- Phase 5: weapons (game abstraction only) ---
export {
  WEAPON_SOCKET, MOVING_PART, WEAPON_TYPE, REQUIRED_SOCKETS, createWeaponRig,
} from './weapon/WeaponRig.js';
export { detectWeapon } from './weapon/WeaponSocketDetector.js';
export {
  WEAPON_EVENT, createWeaponAction, defaultFireAction, defaultReloadAction,
  eventsBetween, createTimelinePlayer,
} from './weapon/WeaponTimeline.js';
export { WEAPON_STATE, WEAPON_INPUT, createWeaponStateMachine } from './weapon/WeaponStateMachine.js';
export { buildWeaponRig } from './weapon/WeaponRigBuilder.js';

// --- Geometry analysis (reusable, GPU-free) ---
export { principalAxes, leastVarianceAxis, eigSym3 } from './geometry/PrincipalAxes.js';

// --- Render (reusable GPU model rendering) ---
export {
  LIT_MODEL_SHADER, SCULPTURE_COURT_RASTER_LIGHTING_WGSL,
  SCULPTURE_COURT_MODEL_SHADER, SCULPTURE_COURT_BACKDROP_SHADER,
  createModelPipeline, MODEL_UNIFORM_BYTES, MODEL_UNIFORM_FLOATS,
} from './render/ModelShader.js';
export {
  createDefaultSampler, createWhiteTexture, makeGpuTexture, uploadModelTextures,
  primitiveColor, buildModelDrawables, releaseDrawables, frameBounds, importMatrixOf, bakeSkinnedMeshes,
} from './render/ModelGpu.js';
export { createModelRenderer } from './render/ModelRenderer.js';
