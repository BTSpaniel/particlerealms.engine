// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { defineComponentType } from "./ComponentRegistry.js";
import { COLLIDER_SCHEMA, normalizeBySchema, getSchemaDefaults } from "../EntitySchema.js";

const defaults = getSchemaDefaults(COLLIDER_SCHEMA);

function normalize(input) {
  return normalizeBySchema(COLLIDER_SCHEMA, input);
}

function validate(value) {
  return normalize(value);
}

export const ColliderDefinition = defineComponentType({
  name: "Collider",
  version: 1,
  schema: COLLIDER_SCHEMA,
  defaults,
  normalize,
  validate,
});

export function createCollider(initial) {
  return ColliderDefinition.create(initial);
}
