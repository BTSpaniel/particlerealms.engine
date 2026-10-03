// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { registerSystem } from "./SystemRegistry.js";
import { EventCategories, buildEventName } from "../../core/events/EventBus.js";

export function registerFluidDebugSystem(world, options = {}) {
  const phase = options.phase || "render";
  const updateKind = options.updateKind || "frame";
  const name = options.name || "FluidDebugSystem";
  const group = options.group || "Debug";
  const fluidSystemName = options.fluidSystemName || "FluidSystem";
  const logInterval =
    typeof options.logInterval === "number" && options.logInterval > 0
      ? options.logInterval
      : 0.5;

  return registerSystem(world, {
    name,
    phase,
    updateKind,
    group,
    createState() {
      return {
        lastLogTime: 0,
      };
    },
    update(worldRef, deltaSeconds, system) {
      const state = system.state;
      const now =
        worldRef &&
        worldRef.time &&
        typeof worldRef.time.time === "number"
          ? worldRef.time.time
          : 0;

      if (now - state.lastLogTime < logInterval) {
        return;
      }
      state.lastLogTime = now;

      const worldMetrics = worldRef && worldRef.metrics ? worldRef.metrics : {};
      const rawFluids = worldMetrics.fluids || {
        activeVolumes: 0,
        activeSources: 0,
        cellCount: 0,
      };

      const activeVolumes = rawFluids.activeVolumes | 0;
      const activeSources = rawFluids.activeSources | 0;
      const cellCount = rawFluids.cellCount | 0;

      let simTimeMs = 0;
      const systems = Array.isArray(worldRef.systems) ? worldRef.systems : [];
      for (let i = 0; i < systems.length; i++) {
        const s = systems[i];
        if (!s || s.name !== fluidSystemName) {
          continue;
        }
        const t = s.lastTimeMs;
        if (typeof t === "number" && t > 0) {
          simTimeMs = t;
        }
        break;
      }

      const payload = {
        activeVolumes,
        activeSources,
        cellCount,
        dt: Number(deltaSeconds) || 0,
        simTimeMs,
        stepTimeMs:
          typeof worldMetrics.lastStepDuration === "number"
            ? worldMetrics.lastStepDuration
            : 0,
        time: now,
      };

      const eventBus = worldRef && worldRef.eventBus ? worldRef.eventBus : null;
      if (eventBus && typeof eventBus.publish === "function") {
        const eventName = buildEventName(
          EventCategories.DEBUG,
          "fluids.metrics"
        );
        eventBus.publish(eventName, payload);
      }
    },
  });
}
