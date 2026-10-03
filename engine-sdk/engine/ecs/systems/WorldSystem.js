// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { registerSystem } from "./SystemRegistry.js";
import {
  createWorldSim,
  destroyWorldSim,
  stepWorldSim,
  getWorldSimSnapshot,
} from "../../sim/world/WorldSim.js";
import {
  EventCategories,
  buildEventName,
} from "../../core/events/EventBus.js";

export function registerWorldSystem(world, options = {}) {
  const phase = options.phase || "postPhysics";
  const updateKind = options.updateKind || "tick";
  const name = options.name || "WorldSystem";

  const autoWeather =
    options && typeof options.autoWeather === "boolean"
      ? options.autoWeather
      : false;

  const dayLengthSecondsOption = options.dayLengthSeconds;
  const order =
    typeof options.order === "number" && Number.isFinite(options.order)
      ? options.order
      : 0;

  return registerSystem(world, {
    name,
    phase,
    updateKind,
    order,
    group: options.group || "Sim",
    createState() {
      const worldSim = createWorldSim({
        name: `${name}.Sim`,
        dayLengthSeconds: dayLengthSecondsOption,
        timeOfDay: options.timeOfDay,
        weather: options.weather,
        terrain: options.terrain,
      });

      return {
        worldSim,
        autoWeather,
        lastDayCount:
          worldSim && worldSim.clock ? (worldSim.clock.dayCount | 0) : 0,
      };
    },
    teardown(worldRef, system) {
      const state = system && system.state;
      if (!state) {
        return;
      }
      if (state.worldSim) {
        destroyWorldSim(state.worldSim);
        state.worldSim = null;
      }
    },
    update(worldRef, deltaSeconds, system) {
      const state = system.state;
      const sim = state.worldSim;
      if (!sim) {
        return;
      }

      let dt = Number(deltaSeconds);
      if (!Number.isFinite(dt) || dt <= 0) {
        const fixed =
          worldRef &&
          worldRef.time &&
          typeof worldRef.time.fixedDelta === "number"
            ? worldRef.time.fixedDelta
            : 1 / 60;
        dt = fixed;
      }

      stepWorldSim(sim, dt, {
        autoWeather: state.autoWeather,
      });

      if (worldRef && !worldRef.worldSim) {
        worldRef.worldSim = sim;
      }

      if (worldRef && worldRef.metrics) {
        if (!worldRef.metrics.world) {
          worldRef.metrics.world = {};
        }
        const clock = sim.clock || {};
        const terrain = sim.terrain || {};
        worldRef.metrics.world.timeOfDay =
          typeof clock.timeOfDay === "number" && Number.isFinite(clock.timeOfDay)
            ? clock.timeOfDay
            : 0;
        worldRef.metrics.world.dayCount = clock.dayCount | 0;
        worldRef.metrics.world.terrainSizeX =
          typeof terrain.sizeX === "number" ? terrain.sizeX : 0;
        worldRef.metrics.world.terrainSizeZ =
          typeof terrain.sizeZ === "number" ? terrain.sizeZ : 0;
      }

      const eventBus =
        worldRef &&
        worldRef.eventBus &&
        typeof worldRef.eventBus.publish === "function"
          ? worldRef.eventBus
          : null;

      if (eventBus && sim.clock) {
        const currentDay = sim.clock.dayCount | 0;
        if (currentDay !== state.lastDayCount) {
          state.lastDayCount = currentDay;
          const eventName = buildEventName(
            EventCategories.GAMEPLAY,
            "world.dayChanged",
          );
          eventBus.publish(eventName, {
            dayCount: currentDay,
            snapshot: getWorldSimSnapshot(sim),
          });
        }
      }
    },
  });
}
