// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createQuery, forEachEntity } from "../query/Query.js";
import { registerSystem } from "./SystemRegistry.js";
import { Math, quatRotateVec3 } from "../../MathImports.js";
import { World, Storage } from "../../EcsImports.js";

function createThirdPersonCameraQuery() {
  return createQuery({
    name: "ThirdPersonCameraQuery",
    all: ["Camera", "Transform"],
  });
}

export function registerThirdPersonCameraSystem(world, options = {}) {
  const phase = options.phase || "render";
  const updateKind = options.updateKind || "frame";
  const name = options.name || "ThirdPersonCameraSystem";

  return registerSystem(world, {
    name,
    phase,
    updateKind,
    group: options.group || "Render",
    before: [options.before || "CameraSystem"].filter(Boolean),
    createState() {
      return {
        query: createThirdPersonCameraQuery(),
      };
    },
    update(worldRef, delta, sys) {
      const state = sys.state;
      const query = state.query;

      forEachEntity(worldRef, query, (entityId, get) => {
        const camera = get("Camera");
        const transform = get("Transform");
        if (!camera || !transform) return;
        if (camera.mode !== "thirdPerson") return;

        const targetId = camera.targetEntity;
        if (targetId === null || targetId === undefined) {
          return;
        }
        if (!World.isEntityAlive(worldRef, targetId)) {
          return;
        }

        const targetTransform = Storage.getEntityComponent(worldRef, targetId, "Transform");
        if (!targetTransform) {
          return;
        }

        const distance =
          typeof camera.followDistance === "number" && camera.followDistance > 0
            ? camera.followDistance
            : 10;
        const height =
          typeof camera.followHeight === "number"
            ? camera.followHeight
            : 3;

        const forwardLocal = Math.vec3(0, 0, -1);
        const forwardWorld = quatRotateVec3(forwardLocal, targetTransform.rotation);
        const fx = forwardWorld[0];
        const fz = forwardWorld[2];
        const len = Math.hypot(fx, fz) || 1;
        const nx = fx / len;
        const nz = fz / len;

        const targetPos = targetTransform.position;
        const camPos = transform.position;
        camPos[0] = targetPos[0] - nx * distance;
        camPos[1] = targetPos[1] + height;
        camPos[2] = targetPos[2] - nz * distance;

        const camRot = transform.rotation;
        const trgRot = targetTransform.rotation;
        camRot[0] = trgRot[0];
        camRot[1] = trgRot[1];
        camRot[2] = trgRot[2];
        camRot[3] = trgRot[3];
      });
    },
  });
}
