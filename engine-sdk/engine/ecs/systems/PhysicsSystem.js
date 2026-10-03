// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createQuery, forEachEntity } from "../query/Query.js";
import { registerSystem } from "./SystemRegistry.js";
import {
  createPhysicsWorld,
  destroyPhysicsWorld,
  createBody,
  getBody,
  setBodyKinematic,
  removeBody,
  stepPhysicsWorld,
} from "../../sim/physics/PhysXPhysicsWorld.js";
import {
  EventCategories,
  buildEventName,
} from "../../core/events/EventBus.js";
import {
  createActiveRigController,
  createActiveRigControllerOptionsFromStickman,
} from "../../sim/physics/rig/index.js";

function createPhysicsQuery() {
  return createQuery({
    name: "PhysicsSystemQuery",
    all: ["PhysicsBody", "Transform"],
  });
}

function createActiveRigQuery() {
  return createQuery({
    name: "ActiveRigSystemQuery",
    all: ["StickmanRagdoll", "Transform"],
  });
}

export function registerPhysicsSystem(world, options = {}) {
  const phase = options.phase || "physics";
  const updateKind = options.updateKind || "tick";
  const name = options.name || "PhysicsSystem";

  return registerSystem(world, {
    name,
    phase,
    updateKind,
    group: options.group || "Sim",
    createState() {
      return {
        physicsWorld: createPhysicsWorld(options.worldOptions || {}),
        query: createPhysicsQuery(),
        activeRigQuery: createActiveRigQuery(),
        entityToBody: new Map(),
        bodyToEntity: new Map(),
        activeEntities: new Set(),
        activeRigControllers: new Map(),
        activeRigEntities: new Set(),
      };
    },
    teardown(worldRef, system) {
      const state = system && system.state;
      if (!state) {
        return;
      }
      for (const controller of state.activeRigControllers.values()) {
        controller.destroy?.();
      }
      destroyPhysicsWorld(state.physicsWorld);
      state.entityToBody.clear();
      state.bodyToEntity.clear();
      state.activeEntities.clear();
      state.activeRigControllers.clear();
      state.activeRigEntities.clear();
    },
    update(worldRef, deltaSeconds, system) {
      const state = system.state;
      const physicsWorld = state.physicsWorld;
      const query = state.query;
      const activeRigQuery = state.activeRigQuery;
      const entityToBody = state.entityToBody;
      const bodyToEntity = state.bodyToEntity;
      const activeEntities = state.activeEntities;
      const activeRigControllers = state.activeRigControllers;
      const activeRigEntities = state.activeRigEntities;

      if (worldRef && !worldRef.physicsWorld) {
        worldRef.physicsWorld = physicsWorld;
      }

      activeEntities.clear();
      activeRigEntities.clear();

      forEachEntity(worldRef, query, (entityId, get) => {
        const physicsBody = get("PhysicsBody");
        const transform = get("Transform");
        const collider = get("Collider");
        if (!physicsBody || !transform) {
          return;
        }

        activeEntities.add(entityId);

        let handle = entityToBody.has(entityId)
          ? entityToBody.get(entityId)
          : physicsBody.bodyHandle;

        let body = null;

        if (typeof handle !== "number") {
          body = createBody(physicsWorld, {
            simMode: physicsBody.simMode,
            position: transform.position,
            rotation: transform.rotation,
            linearVelocity: physicsBody.linearVelocity,
            angularVelocity: physicsBody.angularVelocity,
            mass: physicsBody.mass ?? undefined,
            density: physicsBody.density ?? undefined,
            linearDamping: physicsBody.linearDamping ?? undefined,
            angularDamping: physicsBody.angularDamping ?? undefined,
            collider: collider || null,
            userData: entityId,
          });
          handle = body.handle;
          entityToBody.set(entityId, handle);
          bodyToEntity.set(handle, entityId);
          physicsBody.bodyHandle = handle;
        } else {
          body = getBody(physicsWorld, handle);
          if (!body) {
            body = createBody(physicsWorld, {
              simMode: physicsBody.simMode,
              position: transform.position,
              rotation: transform.rotation,
              linearVelocity: physicsBody.linearVelocity,
              angularVelocity: physicsBody.angularVelocity,
              mass: physicsBody.mass ?? undefined,
              density: physicsBody.density ?? undefined,
              linearDamping: physicsBody.linearDamping ?? undefined,
              angularDamping: physicsBody.angularDamping ?? undefined,
              collider: collider || null,
              userData: entityId,
            });
            handle = body.handle;
            entityToBody.set(entityId, handle);
            bodyToEntity.set(handle, entityId);
            physicsBody.bodyHandle = handle;
          }
        }

        const prevMode = body.simMode;
        const modeValue = physicsBody.simMode;
        if (
          modeValue === "static" ||
          modeValue === "kinematic" ||
          modeValue === "dynamic"
        ) {
          body.simMode = modeValue;
        } else {
          body.simMode = "dynamic";
        }

        if (prevMode !== body.simMode) {
          if (body.simMode === "kinematic") {
            setBodyKinematic(physicsWorld, body, true);
          } else if (body.simMode === "dynamic") {
            setBodyKinematic(physicsWorld, body, false);
          }
        }

        if (body.simMode === "static" || body.simMode === "kinematic") {
          copyVec3(body.position, transform.position);
          copyQuat(body.rotation, transform.rotation);
          copyVec3(body.linearVelocity, physicsBody.linearVelocity);
          copyVec3(body.angularVelocity, physicsBody.angularVelocity);
        }
      });

      for (const [entityId, handle] of entityToBody.entries()) {
        if (!activeEntities.has(entityId)) {
          removeBody(physicsWorld, handle);
          entityToBody.delete(entityId);
          bodyToEntity.delete(handle);
        }
      }

      const dt =
        typeof deltaSeconds === "number" && deltaSeconds > 0
          ? deltaSeconds
          : worldRef.time && typeof worldRef.time.fixedDelta === "number"
          ? worldRef.time.fixedDelta
          : 1 / 60;

      forEachEntity(worldRef, activeRigQuery, (entityId, get) => {
        const stickman = get("StickmanRagdoll");
        const transform = get("Transform");
        if (!stickman?.activeRig?.enabled) return;
        activeRigEntities.add(entityId);

        let controller = activeRigControllers.get(entityId);
        if (!controller && physicsWorld.ready) {
          const controllerOptions = createActiveRigControllerOptionsFromStickman(stickman, {
            id: `stickman_active_rig_${entityId}`,
            backend: stickman.activeRig.backend,
            preset: stickman.activeRig.preset,
            massKg: stickman.activeRig.massKg,
            frequencyHz: stickman.activeRig.frequencyHz,
            dampingRatio: stickman.activeRig.dampingRatio,
            driveMode: stickman.activeRig.driveMode,
            initialPoseState: stickman.activeRig.poseState,
            rootPosition: transform?.position || [0, 0, 0],
          });
          controller = createActiveRigController({
            world: physicsWorld,
            ...controllerOptions,
            autoInitialize: false,
          });
          if (controller.initialize(physicsWorld)) {
            activeRigControllers.set(entityId, controller);
          } else {
            controller.destroy();
            controller = null;
          }
        }

        if (controller) {
          const intent = {
            ...(stickman.activeRig.intent || {}),
            poseState: stickman.activeRig.poseState || stickman.activeRig.intent?.poseState,
          };
          const result = controller.update(dt, intent);
          stickman.activeRigState = {
            state: result.state,
            poseState: result.poseState?.state || intent.poseState || "idle_stand",
            balanceError: result.balance?.balanceError ?? 0,
            groundedFeet: result.balance?.groundedFeet ?? 0,
          };
        }
      });

      for (const [entityId, controller] of activeRigControllers.entries()) {
        if (!activeRigEntities.has(entityId)) {
          controller.destroy?.();
          activeRigControllers.delete(entityId);
        }
      }

      stepPhysicsWorld(physicsWorld, dt);

      const contactEvents = physicsWorld.contactEvents || [];
      const triggerEvents = physicsWorld.triggerEvents || [];
      const eventBus = worldRef && worldRef.eventBus ? worldRef.eventBus : null;

      if (eventBus && typeof eventBus.publish === "function") {
        const contactEventName = buildEventName(
          EventCategories.GAMEPLAY,
          "physics.contact"
        );
        const triggerEventName = buildEventName(
          EventCategories.GAMEPLAY,
          "physics.trigger"
        );

        for (let i = 0; i < contactEvents.length; i++) {
          const ev = contactEvents[i];
          if (!ev) {
            continue;
          }
          eventBus.publish(contactEventName, ev);
        }

        for (let i = 0; i < triggerEvents.length; i++) {
          const ev = triggerEvents[i];
          if (!ev) {
            continue;
          }
          eventBus.publish(triggerEventName, ev);
        }
      }

      if (contactEvents.length) {
        contactEvents.length = 0;
      }
      if (triggerEvents.length) {
        triggerEvents.length = 0;
      }

      forEachEntity(worldRef, query, (entityId, get) => {
        const physicsBody = get("PhysicsBody");
        const transform = get("Transform");
        if (!physicsBody || !transform) {
          return;
        }

        const handle = entityToBody.get(entityId);
        if (typeof handle !== "number") {
          return;
        }

        const body = getBody(physicsWorld, handle);
        if (!body) {
          return;
        }

        copyVec3(transform.position, body.position);
        copyQuat(transform.rotation, body.rotation);
        copyVec3(physicsBody.linearVelocity, body.linearVelocity);
        copyVec3(physicsBody.angularVelocity, body.angularVelocity);
      });
    },
  });
}

function copyVec3(out, src) {
  if (!out || !src) {
    return;
  }
  if (!Array.isArray(out) || out.length < 3) {
    return;
  }
  out[0] = typeof src[0] === "number" && Number.isFinite(src[0]) ? src[0] : out[0];
  out[1] = typeof src[1] === "number" && Number.isFinite(src[1]) ? src[1] : out[1];
  out[2] = typeof src[2] === "number" && Number.isFinite(src[2]) ? src[2] : out[2];
}

function copyQuat(out, src) {
  if (!out || !src) {
    return;
  }
  if (!Array.isArray(out) || out.length < 4) {
    return;
  }
  out[0] = typeof src[0] === "number" && Number.isFinite(src[0]) ? src[0] : out[0];
  out[1] = typeof src[1] === "number" && Number.isFinite(src[1]) ? src[1] : out[1];
  out[2] = typeof src[2] === "number" && Number.isFinite(src[2]) ? src[2] : out[2];
  out[3] = typeof src[3] === "number" && Number.isFinite(src[3]) ? src[3] : out[3];
}
