// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createQuery, forEachEntity } from "../query/Query.js";
import { registerSystem } from "./SystemRegistry.js";
import {
  EventCategories,
  buildEventName,
} from "../../core/events/EventBus.js";

function createWatcherQuery() {
  return createQuery({
    name: "PerceptionWatcherQuery",
    all: ["NavAgent", "Transform"],
  });
}

function createTargetQuery() {
  return createQuery({
    name: "PerceptionTargetQuery",
    all: ["Transform"],
  });
}

function getPositionFromTransform(transform) {
  if (!transform || !Array.isArray(transform.position)) {
    return [0, 0, 0];
  }
  const p = transform.position;
  const x = Number(p[0]);
  const y = Number(p[1]);
  const z = Number(p[2]);
  return [
    Number.isFinite(x) ? x : 0,
    Number.isFinite(y) ? y : 0,
    Number.isFinite(z) ? z : 0,
  ];
}

export function registerPerceptionSystem(world, options = {}) {
  const phase = options.phase || "postPhysics";
  const updateKind = options.updateKind || "tick";
  const name = options.name || "PerceptionSystem";

  const radiusRaw = options.radius;
  const perceptionRadius =
    typeof radiusRaw === "number" && Number.isFinite(radiusRaw) && radiusRaw > 0
      ? radiusRaw
      : 10;

  const radiusSq = perceptionRadius * perceptionRadius;

  return registerSystem(world, {
    name,
    phase,
    updateKind,
    group: options.group || "AI",
    createState() {
      return {
        watcherQuery: createWatcherQuery(),
        targetQuery: createTargetQuery(),
        radius: perceptionRadius,
        radiusSq,
        perceived: new Map(),
      };
    },
    update(worldRef, deltaSeconds, system) {
      const state = system.state;
      const watcherQuery = state.watcherQuery;
      const targetQuery = state.targetQuery;

      if (!watcherQuery || !targetQuery) {
        return;
      }

      const eventBus =
        worldRef &&
        worldRef.eventBus &&
        typeof worldRef.eventBus.publish === "function"
          ? worldRef.eventBus
          : null;

      const newPerceived = new Map();

      const targets = [];
      forEachEntity(worldRef, targetQuery, (entityId, get) => {
        const t = get("Transform");
        if (!t) {
          return;
        }
        const pos = getPositionFromTransform(t);
        targets.push({ id: entityId, pos });
      });

      forEachEntity(worldRef, watcherQuery, (watcherId, get) => {
        const t = get("Transform");
        if (!t) {
          return;
        }
        const wpos = getPositionFromTransform(t);
        const wx = wpos[0];
        const wy = wpos[1];
        const wz = wpos[2];

        const currentSet = new Set();
        newPerceived.set(watcherId, currentSet);

        for (let i = 0; i < targets.length; i++) {
          const target = targets[i];
          if (target.id === watcherId) {
            continue;
          }
          const tp = target.pos;
          const dx = tp[0] - wx;
          const dy = tp[1] - wy;
          const dz = tp[2] - wz;
          const distSq = dx * dx + dy * dy + dz * dz;
          if (distSq <= radiusSq) {
            currentSet.add(target.id);
          }
        }
      });

      if (!eventBus) {
        state.perceived = newPerceived;
        return;
      }

      const enterEventName = buildEventName(
        EventCategories.GAMEPLAY,
        "ai.perception.enter",
      );
      const exitEventName = buildEventName(
        EventCategories.GAMEPLAY,
        "ai.perception.exit",
      );

      const oldPerceived = state.perceived;

      for (const [watcherId, newSet] of newPerceived.entries()) {
        const oldSet = oldPerceived.get(watcherId) || new Set();

        for (const targetId of newSet) {
          if (!oldSet.has(targetId)) {
            eventBus.publish(enterEventName, {
              watcherEntityId: watcherId,
              targetEntityId: targetId,
              radius: state.radius,
            });
          }
        }

        for (const targetId of oldSet) {
          if (!newSet.has(targetId)) {
            eventBus.publish(exitEventName, {
              watcherEntityId: watcherId,
              targetEntityId: targetId,
              radius: state.radius,
            });
          }
        }
      }

      state.perceived = newPerceived;
    },
  });
}
