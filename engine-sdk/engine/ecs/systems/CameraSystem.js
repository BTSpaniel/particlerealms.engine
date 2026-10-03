// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createQuery, forEachEntity } from "../query/Query.js";
import { computeViewProjMatrix } from "../../render/CameraMath.js";
import { registerSystem } from "./SystemRegistry.js";
import { World } from "../../EcsImports.js";

// CameraState is not an ECS component yet; for now we attach 
// computed matrices to a small per-world store on the system state.

function createCameraQuery() {
  return createQuery({
    name: "CameraSystemQuery",
    all: ["Camera", "Transform"],
  });
}

export function registerCameraSystem(world, options = {}) {
  const phase = options.phase || "render";
  const updateKind = options.updateKind || "frame";
  const name = options.name || "CameraSystem";
 
  return registerSystem(world, {
    name,
    phase,
    updateKind,
    group: options.group || "Render",
    createState() {
      return {
        query: createCameraQuery(),
        activeCameraEntity: null,
        activeCameraMatrices: null,
      };
    },
    update(worldRef, delta, sys) {
      const stats = World.getWorldStats(worldRef);
      const width = stats.viewport ? stats.viewport.width : 1280;
      const height = stats.viewport ? stats.viewport.height : 720;

      const state = sys.state;
      const query = state.query;

      let chosenEntity = null;
      let chosenCamera = null;
      let chosenTransform = null;

      const candidates = [];

      forEachEntity(worldRef, query, (entityId, get) => {
        const camera = get("Camera");
        const transform = get("Transform");
        if (!camera || !transform) return;
        if (!camera.active) return;
        candidates.push({ entityId, camera, transform });
      });

      if (!candidates.length) {
        state.activeCameraEntity = null;
        state.activeCameraMatrices = null;
        return;
      }

      const modePriority = { fps: 0, thirdPerson: 1, free: 2 };
      candidates.sort((a, b) => {
        const am = a.camera.mode || "free";
        const bm = b.camera.mode || "free";
        const pa = modePriority[am] ?? 10;
        const pb = modePriority[bm] ?? 10;
        if (pa !== pb) return pa - pb;
        return a.entityId - b.entityId;
      });

      const top = candidates[0];
      chosenEntity = top.entityId;
      chosenCamera = top.camera;
      chosenTransform = top.transform;

      const { view, proj, viewProj } = computeViewProjMatrix(
        chosenCamera,
        {
          position: chosenTransform.position,
          rotation: chosenTransform.rotation,
        },
        width,
        height
      );

      state.activeCameraEntity = chosenEntity;
      state.activeCameraMatrices = { view, proj, viewProj };
    },
  });
}
