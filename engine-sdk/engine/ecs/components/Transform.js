// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { defineComponentType } from "./ComponentRegistry.js";
import { TRANSFORM_SCHEMA, normalizeBySchema, getSchemaDefaults } from "../EntitySchema.js";

const defaults = getSchemaDefaults(TRANSFORM_SCHEMA);

function normalize(input) {
  return normalizeBySchema(TRANSFORM_SCHEMA, input);
}

function validate(value) {
  return normalize(value);
}

export const TransformDefinition = defineComponentType({
  name: "Transform",
  version: 1,
  schema: TRANSFORM_SCHEMA,
  defaults,
  normalize,
  validate,
});

export function createTransform(initial) {
  return TransformDefinition.create(initial);
}
