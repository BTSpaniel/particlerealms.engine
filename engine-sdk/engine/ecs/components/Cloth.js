// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { defineComponentType } from "./ComponentRegistry.js";

const defaults = {
  enabled: true,
  topology: {
    type: "grid", // grid, mesh
    width: 1,
    height: 1,
    segmentsX: 10,
    segmentsY: 10,
    assetId: null,
  },
  material: {
    density: 1,
    stretchStiffness: 1,
    bendStiffness: 0.2,
    damping: 0.1,
    thickness: 0.01,
    gravityScale: 1,
    collisionFriction: 0.5,
    collisionStickiness: 0,
  },
  constraints: {
    // Logical attachment information for the solver;
    // actual attachment to entities/rigs is up to cloth system/gameplay.
    attachTopLeft: false,
    attachTopRight: false,
    attachBottomLeft: false,
    attachBottomRight: false,
  },
};

function normalizeBoolean(value, defaultValue) {
  return typeof value === "boolean" ? value : defaultValue;
}

function normalizeNumber(value, defaultValue) {
  const n = Number(value);
  return Number.isFinite(n) ? n : defaultValue;
}

function normalizePositiveNumber(value, defaultValue) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return defaultValue;
  }
  return n;
}

function normalizeNonNegativeNumber(value, defaultValue) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return defaultValue;
  }
  return n;
}

function normalizeTopology(input) {
  const src = input && typeof input === "object" ? input : {};

  const typeValue = typeof src.type === "string" ? src.type : defaults.topology.type;
  let type = typeValue === "mesh" ? "mesh" : "grid";

  const width = normalizePositiveNumber(src.width, defaults.topology.width);
  const height = normalizePositiveNumber(src.height, defaults.topology.height);

  const sx = src.segmentsX;
  const sy = src.segmentsY;
  const segmentsX = Number.isFinite(Number(sx)) && Number(sx) > 0 ? Number(sx) | 0 : defaults.topology.segmentsX;
  const segmentsY = Number.isFinite(Number(sy)) && Number(sy) > 0 ? Number(sy) | 0 : defaults.topology.segmentsY;

  const assetId =
    typeof src.assetId === "string" && src.assetId.length > 0
      ? src.assetId
      : null;

  return {
    type,
    width,
    height,
    segmentsX,
    segmentsY,
    assetId,
  };
}

function normalizeMaterial(input) {
  const src = input && typeof input === "object" ? input : {};

  const density = normalizePositiveNumber(src.density, defaults.material.density);
  const stretchStiffness = normalizePositiveNumber(
    src.stretchStiffness,
    defaults.material.stretchStiffness
  );
  const bendStiffness = normalizeNonNegativeNumber(
    src.bendStiffness,
    defaults.material.bendStiffness
  );
  const damping = normalizeNonNegativeNumber(src.damping, defaults.material.damping);
  const thickness = normalizePositiveNumber(src.thickness, defaults.material.thickness);
  const gravityScale = normalizePositiveNumber(
    src.gravityScale,
    defaults.material.gravityScale
  );
  const collisionFriction = normalizeNonNegativeNumber(
    src.collisionFriction,
    defaults.material.collisionFriction
  );
  const collisionStickiness = normalizeNonNegativeNumber(
    src.collisionStickiness,
    defaults.material.collisionStickiness
  );

  return {
    density,
    stretchStiffness,
    bendStiffness,
    damping,
    thickness,
    gravityScale,
    collisionFriction,
    collisionStickiness,
  };
}

function normalizeConstraints(input) {
  const src = input && typeof input === "object" ? input : {};

  return {
    attachTopLeft: normalizeBoolean(
      src.attachTopLeft,
      defaults.constraints.attachTopLeft
    ),
    attachTopRight: normalizeBoolean(
      src.attachTopRight,
      defaults.constraints.attachTopRight
    ),
    attachBottomLeft: normalizeBoolean(
      src.attachBottomLeft,
      defaults.constraints.attachBottomLeft
    ),
    attachBottomRight: normalizeBoolean(
      src.attachBottomRight,
      defaults.constraints.attachBottomRight
    ),
  };
}

function normalize(input) {
  const src = input && typeof input === "object" ? input : {};
  return {
    enabled: normalizeBoolean(src.enabled, defaults.enabled),
    topology: normalizeTopology(src.topology),
    material: normalizeMaterial(src.material),
    constraints: normalizeConstraints(src.constraints),
  };
}

function validate(value) {
  return normalize(value);
}

export const ClothDefinition = defineComponentType({
  name: "Cloth",
  version: 1,
  defaults,
  normalize,
  validate,
});

export function createCloth(initial) {
  return ClothDefinition.create(initial);
}
