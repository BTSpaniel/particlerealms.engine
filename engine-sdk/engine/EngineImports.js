// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// Global barrel for engine modules, grouped by domain.
// This is intended for games/tests/tools that want a single import
// and then access Math/Gpu/Ecs/Render/Tools/etc as namespaces.

import * as Math from "./core/math/index.js";

import * as Gpu from "./core/gpu/GpuBuffer.js";
import * as GpuDevice from "./core/gpu/GpuDevice.js";
import * as Platform from "./core/platform/PlatformCanvas.js";

import * as Mesh from "./render/Mesh.js";
import * as Geometry from "./render/geometry/PrimitiveGeometry.js";
import * as Shaders from "./render/shaders/ShaderLoader.js";
import * as StandardRoom from "./render/scenes/StandardRoomRenderer.js";
import * as VoxelWorld from "./render/scenes/VoxelWorldRenderer.js";
import * as StandardUniforms from "./render/scenes/StandardUniforms.js";
import * as StandardEntityRenderResources from "./render/scenes/StandardEntityRenderResources.js";
import * as SmokeVolumes from "./render/volumes/SmokeVolumeRenderer.js";
import * as ParticleBillboards from "./render/particles/ParticleBillboardRenderer.js";
import * as ParticleQuality from "./render/particles/ParticleQualityManager.js";
import * as SpectralRender from "./render/spectral/index.js";

import * as World from "./ecs/world/World.js";
import * as Camera from "./ecs/components/Camera.js";
import * as Light from "./ecs/components/Light.js";
import * as PhysicsBody from "./ecs/components/PhysicsBody.js";
import * as Collider from "./ecs/components/Collider.js";
import * as Transform from "./ecs/components/Transform.js";
import * as ParticleEmitter from "./ecs/components/ParticleEmitter.js";
import * as NetReplicated from "./ecs/components/NetReplicated.js";
import * as ReplicationProfiles from "./ecs/replication/ReplicationProfiles.js";
import * as Storage from "./ecs/storage/ArchetypeStorage.js";
import * as CoreSchema from "./core/schema/index.js";
import * as CoreSave from "./core/save/index.js";
import * as GameplayEvents from "./gameplay/events/index.js";
import * as GameplayRules from "./gameplay/rules/index.js";
import * as GameplayPerception from "./gameplay/perception/index.js";
import * as GameplayAI from "./gameplay/ai/index.js";
import * as GameplayProgression from "./gameplay/progression/index.js";
import * as GameplaySocial from "./gameplay/social/index.js";
import * as GameplaySimulation from "./gameplay/simulation/index.js";
import * as GameplayItems from "./gameplay/items/index.js";
import * as GameplayInventory from "./gameplay/inventory/index.js";
import * as GameplaySociety from "./gameplay/society/index.js";
import * as Network from "./network/index.js";
import * as Narrative from "./gameplay/narrative/index.js";
import * as Animation from "./animation/index.js";
import { Rig } from "./assets/rig/index.js";
import * as Matter from "./matter/index.js";

import * as Inspector from "./tools/inspector/InspectorPanel.js";
import * as Spawn from "./tools/spawn/PhysicsSpawnController.js";
import * as Ghost from "./tools/spawn/GhostPreviewController.js";
import * as Picking from "./tools/picking/RoomPicking.js";
import * as ScreenRayCaster from "./tools/picking/ScreenRayCaster.js";
import * as CameraTools from "./tools/camera/StandardCameraController.js";
import * as Grab from "./tools/interaction/GrabController.js";

import * as PhysicsScenes from "./scenes/PhysicsSandboxScene.js";
import * as Aim from "./tools/aiming/GlobalAim.js";
import * as Config from "./config/EngineConfig.js";

export {
  Math,
  Gpu,
  GpuDevice,
  Platform,
  Mesh,
  Geometry,
  Shaders,
  StandardRoom,
  VoxelWorld,
  StandardUniforms,
  StandardEntityRenderResources,
  SmokeVolumes,
  ParticleBillboards,
  ParticleQuality,
  SpectralRender,
  World,
  Camera,
  Light,
  PhysicsBody,
  Collider,
  Transform,
  ParticleEmitter,
  NetReplicated,
  ReplicationProfiles,
  Storage,
  CoreSchema,
  CoreSave,
  GameplayEvents,
  GameplayRules,
  GameplayPerception,
  GameplayAI,
  GameplayProgression,
  GameplaySocial,
  GameplaySimulation,
  GameplayItems,
  GameplayInventory,
  GameplaySociety,
  Network,
  Narrative,
  Animation,
  Rig,
  Matter,
  Inspector,
  Spawn,
  Ghost,
  Picking,
  ScreenRayCaster,
  CameraTools,
  Grab,
  PhysicsScenes,
  Aim,
  Config,
};
