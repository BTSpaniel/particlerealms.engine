// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createEntity } from "../../ecs/world/World.js";
import {
  setEntityComponent,
  getEntityComponent,
  removeEntityComponent,
} from "../../ecs/storage/ArchetypeStorage.js";
import { createTransform } from "../../ecs/components/Transform.js";
import { createParticleEmitter } from "../../ecs/components/ParticleEmitter.js";

export function spawnParticleEmitterEntity(world, options = {}) {
  if (!world) {
    throw new Error("spawnParticleEmitterEntity: world is required");
  }

  const entityId = createEntity(world);

  const transformInit = {};
  if (Array.isArray(options.position)) {
    transformInit.position = options.position;
  }
  if (Array.isArray(options.rotation)) {
    transformInit.rotation = options.rotation;
  }
  if (Array.isArray(options.scale)) {
    transformInit.scale = options.scale;
  }

  const transform = createTransform(transformInit);
  setEntityComponent(world, entityId, "Transform", transform);

  const emitterInit =
    options.emitter && typeof options.emitter === "object"
      ? options.emitter
      : options;
  const emitter = createParticleEmitter(emitterInit);
  setEntityComponent(world, entityId, "ParticleEmitter", emitter);

  return entityId;
}

export function attachParticleEmitter(world, entityId, emitterDesc) {
  if (!world) {
    throw new Error("attachParticleEmitter: world is required");
  }
  if (entityId === null || entityId === undefined) {
    throw new Error("attachParticleEmitter: entityId is required");
  }

  const emitter = createParticleEmitter(emitterDesc);
  setEntityComponent(world, entityId, "ParticleEmitter", emitter);
  return emitter;
}

export function updateParticleEmitter(world, entityId, changes) {
  if (!world) {
    throw new Error("updateParticleEmitter: world is required");
  }
  if (entityId === null || entityId === undefined) {
    throw new Error("updateParticleEmitter: entityId is required");
  }

  const current = getEntityComponent(world, entityId, "ParticleEmitter");
  if (!current) {
    const emitter = createParticleEmitter(changes || {});
    setEntityComponent(world, entityId, "ParticleEmitter", emitter);
    return emitter;
  }

  const merged = Object.assign({}, current, changes || {});
  const emitter = createParticleEmitter(merged);
  setEntityComponent(world, entityId, "ParticleEmitter", emitter);
  return emitter;
}

export function disableParticleEmitter(world, entityId) {
  return updateParticleEmitter(world, entityId, { enabled: false });
}

export function removeParticleEmitter(world, entityId) {
  if (!world) {
    throw new Error("removeParticleEmitter: world is required");
  }
  if (entityId === null || entityId === undefined) {
    return false;
  }
  return removeEntityComponent(world, entityId, "ParticleEmitter");
}
