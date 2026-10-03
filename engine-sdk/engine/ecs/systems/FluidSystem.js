// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createQuery, forEachEntity } from "../query/Query.js";
import { registerSystem } from "./SystemRegistry.js";
import { createFluidVolume } from "../components/FluidVolume.js";
import {
  createFluidSimWorld,
  destroyFluidSimWorld,
  stepFluidSimWorld,
} from "../../sim/fluids/FluidSimWorld.js";
import {
  createFluidCpuWorld,
  destroyFluidCpuWorld,
  stepFluidCpuWorld,
  applyFluidSourcesCpu,
} from "../../sim/fluids/FluidCpuWorld.js";
import { getGpuDevice } from "../../core/gpu/GpuDevice.js";
import {
  splatFluidSources,
  disposeFluidSourceSplat,
} from "../../sim/fluids/FluidSourceSplat.js";

function createVolumeQuery() {
  return createQuery({
    name: "FluidVolumeQuery",
    all: ["FluidVolume"],
  });
}

function createSourceQuery() {
  return createQuery({
    name: "FluidSourceQuery",
    all: ["FluidSource", "Transform"],
  });
}

export function registerFluidSystem(world, options = {}) {
  const phase = options.phase || "postPhysics";
  const updateKind = options.updateKind || "tick";
  const name = options.name || "FluidSystem";

  const workgroupSizeOption = options.workgroupSize;
  const gpuOptions = options.gpuOptions || {};
  const acquireGpuDevice = options.acquireGpuDevice || getGpuDevice;
  const createGpuWorld = options.createGpuWorld || createFluidSimWorld;
  const destroyGpuWorld = options.destroyGpuWorld || destroyFluidSimWorld;
  const createCpuWorld = options.createCpuWorld || createFluidCpuWorld;
  const destroyCpuWorld = options.destroyCpuWorld || destroyFluidCpuWorld;
  const splatSources = options.splatSources || splatFluidSources;
  const disposeSplat = options.disposeSplat || disposeFluidSourceSplat;
  const backendOption = options.backend === "cpu" ? "cpu" : "gpu";
  const resolutionScale =
    typeof options.resolutionScale === "number" && options.resolutionScale > 0
      ? options.resolutionScale
      : 1;
  const stepInterval =
    typeof options.stepInterval === "number" && options.stepInterval > 0
      ? options.stepInterval
      : 0;
  const pressureIterations =
    typeof options.pressureIterations === "number" &&
    options.pressureIterations > 0
      ? options.pressureIterations | 0
      : undefined;

  return registerSystem(world, {
    name,
    phase,
    updateKind,
    group: options.group || "Sim",
    createState() {
      const defaultVolume = createFluidVolume(undefined);
      return {
        volumeQuery: createVolumeQuery(),
        sourceQuery: createSourceQuery(),
        gpuDevice: options.gpuDevice || null,
        gpuOptions,
        fluidWorld: null,
        initPromise: null,
        metrics: null,
        splatPromise: null,
        defaultVolume,
        stepInterval,
        accumulatedTime: 0,
        backend: backendOption,
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
      state.initPromise = null;
      state.splatPromise = null;
      const fluidWorld = state.fluidWorld;
      state.fluidWorld = null;
      if (fluidWorld) {
        if (state.backend === "gpu") {
          if (fluidWorld.device) {
            disposeSplat(fluidWorld.device);
          }
          destroyGpuWorld(fluidWorld);
        } else {
          destroyCpuWorld(fluidWorld);
        }
      }
    },
    update(worldRef, deltaSeconds, system) {
      const state = system.state;

      if (state.destroyed) return;

      if (!state.fluidWorld) {
        if (!state.initPromise) {
          const lifecycleEpoch = ++state.lifecycleEpoch;
          let trackedInit;
          trackedInit = (async () => {
            try {
              let gridSize = options.gridSize;
              let activeVolumeFound = false;

              forEachEntity(worldRef, state.volumeQuery, (entityId, get) => {
                if (activeVolumeFound) {
                  return;
                }
                const volume = get("FluidVolume");
                if (!volume || volume.enabled === false) {
                  return;
                }
                gridSize = volume.gridSize;
                activeVolumeFound = true;
              });

              let effectiveGridSize = gridSize;
              if (
                resolutionScale !== 1 &&
                Array.isArray(effectiveGridSize) &&
                effectiveGridSize.length === 3
              ) {
                const sx = Number(effectiveGridSize[0]) || 0;
                const sy = Number(effectiveGridSize[1]) || 0;
                const sz = Number(effectiveGridSize[2]) || 0;
                const rx = Math.max(1, Math.floor(sx * resolutionScale));
                const ry = Math.max(1, Math.floor(sy * resolutionScale));
                const rz = Math.max(1, Math.floor(sz * resolutionScale));
                effectiveGridSize = [rx, ry, rz];
              }

              if (state.backend === "gpu") {
                let gpuDevice = state.gpuDevice;
                if (!gpuDevice) {
                  gpuDevice = await acquireGpuDevice(state.gpuOptions);
                  if (state.destroyed || lifecycleEpoch !== state.lifecycleEpoch) return;
                  state.gpuDevice = gpuDevice;
                }

                const simWorld = await createGpuWorld(gpuDevice, {
                  gridSize: effectiveGridSize,
                  workgroupSize: workgroupSizeOption,
                  pressureIterations,
                });
                if (state.destroyed || lifecycleEpoch !== state.lifecycleEpoch) {
                  if (simWorld?.device) disposeSplat(simWorld.device);
                  destroyGpuWorld(simWorld);
                  return;
                }
                state.fluidWorld = simWorld;
              } else {
                const simWorld = createCpuWorld({
                  gridSize: effectiveGridSize,
                });
                if (state.destroyed || lifecycleEpoch !== state.lifecycleEpoch) {
                  destroyCpuWorld(simWorld);
                  return;
                }
                state.fluidWorld = simWorld;
              }
            } catch (error) {
              if (state.destroyed || lifecycleEpoch !== state.lifecycleEpoch) return;
              system.lastError = error || new Error("FluidSystem init failed");
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

      const fluidWorld = state.fluidWorld;
      const volumeQuery = state.volumeQuery;
      const sourceQuery = state.sourceQuery;

      let activeVolumes = 0;
      let activeSources = 0;

      let worldMin = null;
      let worldMax = null;
      const sourcesForSplat = [];

      forEachEntity(worldRef, volumeQuery, (entityId, get) => {
        const volume = get("FluidVolume");
        if (!volume) {
          return;
        }
        if (volume.enabled === false) {
          return;
        }
        activeVolumes++;
        if (!worldMin) {
          worldMin = volume.worldMin;
          worldMax = volume.worldMax;
        }
      });

      forEachEntity(worldRef, sourceQuery, (entityId, get) => {
        const source = get("FluidSource");
        const transform = get("Transform");
        if (!source || !transform) {
          return;
        }
        if (source.enabled === false) {
          return;
        }
        activeSources++;

        const pos = Array.isArray(transform.position)
          ? transform.position
          : [0, 0, 0];
        const radiusValue = Number(source.radius);
        const strengthValue = Number(source.strength);
        const radius = Number.isFinite(radiusValue) ? radiusValue : 0;
        const strength = Number.isFinite(strengthValue) ? strengthValue : 0;

        sourcesForSplat.push({
          position: pos,
          radius,
          strength,
        });
      });

      if (!worldMin || !worldMax) {
        const dv = state.defaultVolume;
        if (dv) {
          worldMin = dv.worldMin;
          worldMax = dv.worldMax;
        } else {
          worldMin = [-10, -10, -10];
          worldMax = [10, 10, 10];
        }
      }

      const metrics = state.metrics || {};
      metrics.activeVolumes = activeVolumes;
      metrics.activeSources = activeSources;
      metrics.cellCount = fluidWorld.cellCount | 0;
      state.metrics = metrics;

      if (worldRef && worldRef.metrics) {
        worldRef.metrics.fluids = {
          activeVolumes: metrics.activeVolumes,
          activeSources: metrics.activeSources,
          cellCount: metrics.cellCount,
        };
      }

      if (sourcesForSplat.length > 0 && !state.splatPromise) {
        const lifecycleEpoch = state.lifecycleEpoch;
        let trackedSplat;
        trackedSplat = (async () => {
          try {
            if (state.backend === "gpu") {
              await splatSources(fluidWorld, state.gpuDevice, {
                sources: sourcesForSplat,
                worldMin,
                worldMax,
              });
            } else {
              applyFluidSourcesCpu(fluidWorld, {
                sources: sourcesForSplat,
                worldMin,
                worldMax,
              });
            }
          } catch (error) {
            if (state.destroyed
              || lifecycleEpoch !== state.lifecycleEpoch
              || state.fluidWorld !== fluidWorld) return;
            system.lastError = error || system.lastError || new Error("FluidSystem splat failed");
            if (!system.errorCount) {
              system.errorCount = 0;
            }
            system.errorCount++;
          } finally {
            if (state.splatPromise === trackedSplat
              && !state.destroyed
              && lifecycleEpoch === state.lifecycleEpoch) {
              state.splatPromise = null;
            }
          }
        })();
        state.splatPromise = trackedSplat;
      }

      if (state.splatPromise) {
        return;
      }

      const interval = state.stepInterval || 0;
      if (interval > 0) {
        state.accumulatedTime += deltaSeconds;
        if (state.accumulatedTime < interval) {
          return;
        }
        state.accumulatedTime -= interval;
        if (state.backend === "gpu") {
          stepFluidSimWorld(fluidWorld, interval);
        } else {
          stepFluidCpuWorld(fluidWorld, interval);
        }
      } else {
        if (state.backend === "gpu") {
          stepFluidSimWorld(fluidWorld, deltaSeconds);
        } else {
          stepFluidCpuWorld(fluidWorld, deltaSeconds);
        }
      }
    },
  });
}
