// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// EcsImports: convenience barrel for ECS world/components/storage.
// Provides both grouped namespaces (World, Camera, etc.) and flat helpers.

import {
  World as EcsWorld,
  Camera as CameraNS,
  Light as LightNS,
  PhysicsBody as PhysicsBodyNS,
  Collider as ColliderNS,
  Transform as TransformNS,
  ParticleEmitter as ParticleEmitterNS,
  NetReplicated as NetReplicatedNS,
  ReplicationProfiles as ReplicationProfilesNS,
  Storage as StorageNS,
} from "./EngineImports.js";

// Grouped namespaces
export const World = EcsWorld;
export const Camera = CameraNS;
export const Light = LightNS;
export const PhysicsBody = PhysicsBodyNS;
export const Collider = ColliderNS;
export const Transform = TransformNS;
export const ParticleEmitter = ParticleEmitterNS;
export const NetReplicated = NetReplicatedNS;
export const ReplicationProfiles = ReplicationProfilesNS;
export const Storage = StorageNS;

// Flat world helpers
export const {
  createWorld,
  createEntity,
  stepWorld,
  stepWorldFrame,
  positiveSafeEntityHandleReport,
  encodeEntityHandle,
  decodeEntityHandle,
  splitEntityHandle,
  joinEntityHandle,
  WORLD_ENTITY_INDEX_BITS,
  WORLD_ENTITY_INDEX_CAPACITY,
  WORLD_ENTITY_INDEX_MASK,
  WORLD_ENTITY_MAX_GENERATION,
} = EcsWorld;

// Flat component constructors
export const createCamera = CameraNS.createCamera;
export const createLight = LightNS.createLight;
export const createPhysicsBody = PhysicsBodyNS.createPhysicsBody;
export const createCollider = ColliderNS.createCollider;
export const createTransform = TransformNS.createTransform;
export const createParticleEmitter = ParticleEmitterNS.createParticleEmitter;
export const createNetReplicated = NetReplicatedNS.createNetReplicated;

// Flat storage helpers
export const setEntityComponent = StorageNS.setEntityComponent;
export const getEntityComponent = StorageNS.getEntityComponent;
export const removeEntityComponent = StorageNS.removeEntityComponent;
