// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { defineComponentType } from "./ComponentRegistry.js";
import { PHYSICS_BODY_SCHEMA, normalizeBySchema, getSchemaDefaults } from "../EntitySchema.js";

const defaults = getSchemaDefaults(PHYSICS_BODY_SCHEMA);

function normalize(input) {
  return normalizeBySchema(PHYSICS_BODY_SCHEMA, input);
}

function validate(value) {
  return normalize(value);
}

export const PhysicsBodyDefinition = defineComponentType({
  name: "PhysicsBody",
  version: 1,
  schema: PHYSICS_BODY_SCHEMA,
  defaults,
  normalize,
  validate,
});

export function createPhysicsBody(initial) {
  return PhysicsBodyDefinition.create(initial);
}
