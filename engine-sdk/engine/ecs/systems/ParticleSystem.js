// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createQuery, forEachEntity } from "../query/Query.js";
import { registerSystem } from "./SystemRegistry.js";
import {
  createParticleSimWorld,
  destroyParticleSimWorld,
  stepParticleSimWorld,
} from "../../sim/particles/ParticleSimWorld.js";
import { getGpuDevice } from "../../core/gpu/GpuDevice.js";

function createParticleQuery() {
  return createQuery({
    name: "ParticleSystemQuery",
    all: ["ParticleEmitter", "Transform"],
  });
}

export function registerParticleSystem(world, options = {}) {
  const phase = options.phase || "postPhysics";
  const updateKind = options.updateKind || "tick";
  const name = options.name || "ParticleSystem";

  const workgroupSizeOption = options.workgroupSize;
  const gpuOptions = options.gpuOptions || {};

  const acquireGpuDevice = options.acquireGpuDevice || getGpuDevice;

  const createSimWorld = options.createSimWorld || createParticleSimWorld;

  const destroySimWorld = options.destroySimWorld || destroyParticleSimWorld;

  return registerSystem(world, {
    name,
    phase,
    updateKind,
    group: options.group || "Sim",
    createState() {
      return {
        query: createParticleQuery(),
        gpuDevice: options.gpuDevice || null,
        gpuOptions,
        particleWorld: null,
        initPromise: null,
        metrics: null,

        lifecycleEpoch: 0,

        destroyed: false,
      };
    },
    teardown(worldRef, system) {
      const state = system && system.state;
      if (!state) {
        return;
      }

      state.destroyed = true;

      state.lifecycleEpoch += 1;
      if (state.particleWorld) {
        destroySimWorld(state.particleWorld);
        state.particleWorld = null;
      }
      state.initPromise = null;
    },
    update(worldRef, deltaSeconds, system) {
      const state = system.state;

      if (state.destroyed) {

        return;

      }

      if (!state.particleWorld) {
        if (!state.initPromise) {
          const lifecycleEpoch = ++state.lifecycleEpoch;
          let trackedInit;
          trackedInit = (async () => {
            try {
              let gpuDevice = state.gpuDevice;
              if (!gpuDevice) {
                gpuDevice = await acquireGpuDevice(state.gpuOptions);
                if (state.destroyed || lifecycleEpoch !== state.lifecycleEpoch) return;
                state.gpuDevice = gpuDevice;
              }

              const simWorld = await createSimWorld(gpuDevice, {
                maxParticles: options.maxParticles,
                workgroupSize: workgroupSizeOption,
              });
              if (state.destroyed || lifecycleEpoch !== state.lifecycleEpoch) {
                destroySimWorld(simWorld);
                return;
              }
              state.particleWorld = simWorld;
            } catch (error) {
              if (state.destroyed || lifecycleEpoch !== state.lifecycleEpoch) return;
              system.lastError = error || new Error("ParticleSystem init failed");
              if (!system.errorCount) {
                system.errorCount = 0;
              }
              system.errorCount++;
            } finally {
              if (state.initPromise === trackedInit) state.initPromise = null;
            }
          })();
          state.initPromise = trackedInit;
        }
        return;
      }

      const particleWorld = state.particleWorld;
      const query = state.query;

      let activeEmitters = 0;
      let requestedParticles = 0;

      forEachEntity(worldRef, query, (entityId, get) => {
        const emitter = get("ParticleEmitter");
        const transform = get("Transform");
        if (!emitter || !transform) {
          return;
        }
        if (emitter.enabled === false) {
          return;
        }
        activeEmitters++;

        const maxForEmitter =
          typeof emitter.maxParticles === "number" &&
          Number.isFinite(emitter.maxParticles)
            ? emitter.maxParticles
            : 0;
        if (maxForEmitter > 0) {
          requestedParticles += maxForEmitter;
        }
      });

      const worldMax = particleWorld.maxParticles;
      let particleCount =
        requestedParticles > 0 ? requestedParticles | 0 : worldMax | 0;
      if (particleCount < 0) {
        particleCount = 0;
      }
      if (particleCount > worldMax) {
        particleCount = worldMax;
      }

      const metrics = state.metrics || {};
      metrics.activeEmitters = activeEmitters;
      metrics.requestedParticles = requestedParticles | 0;
      metrics.particleCount = particleCount | 0;
      metrics.maxParticles = worldMax | 0;
      state.metrics = metrics;

      if (worldRef && worldRef.metrics) {
        worldRef.metrics.particles = {
          activeEmitters: metrics.activeEmitters,
          requestedParticles: metrics.requestedParticles,
          particleCount: metrics.particleCount,
          maxParticles: metrics.maxParticles,
        };
      }

      if (activeEmitters === 0 || particleCount === 0) {
        return;
      }

      const roomHalfSize = options.roomHalfSize || 50;
      const gravityY = options.gravityY ?? -9.81;

      stepParticleSimWorld(particleWorld, deltaSeconds, {
        particleCount,
        roomHalfSize,
        gravityY,
      });
    },
  });
}
