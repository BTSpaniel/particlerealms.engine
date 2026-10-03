// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { registerSystem } from "./SystemRegistry.js";
import { EventCategories, buildEventName } from "../../core/events/EventBus.js";

export function registerParticleDebugSystem(world, options = {}) {
  const phase = options.phase || "render";
  const updateKind = options.updateKind || "frame";
  const name = options.name || "ParticleDebugSystem";
  const group = options.group || "Debug";
  const particleSystemName = options.particleSystemName || "ParticleSystem";
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
      const rawParticles = worldMetrics.particles || {
        activeEmitters: 0,
        requestedParticles: 0,
        particleCount: 0,
        maxParticles: 0,
      };

      const activeEmitters = rawParticles.activeEmitters | 0;
      const requestedParticles = rawParticles.requestedParticles | 0;
      let particleCount = rawParticles.particleCount | 0;
      const maxParticles = rawParticles.maxParticles | 0;

      if (activeEmitters === 0) {
        particleCount = 0;
      }

      let simTimeMs = 0;
      const systems = Array.isArray(worldRef.systems) ? worldRef.systems : [];
      for (let i = 0; i < systems.length; i++) {
        const s = systems[i];
        if (!s || s.name !== particleSystemName) {
          continue;
        }
        const t = s.lastTimeMs;
        if (typeof t === "number" && t > 0) {
          simTimeMs = t;
        }
        break;
      }

      const payload = {
        activeEmitters,
        requestedParticles,
        particleCount,
        maxParticles,
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
          "particles.metrics"
        );
        eventBus.publish(eventName, payload);
      }
    },
  });
}
