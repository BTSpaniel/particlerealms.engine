// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { defineComponentType } from "./ComponentRegistry.js";
import { LIGHT_SCHEMA, normalizeBySchema, getSchemaDefaults } from "../EntitySchema.js";

const defaults = getSchemaDefaults(LIGHT_SCHEMA);

function normalize(input) {
  return normalizeBySchema(LIGHT_SCHEMA, input);
}

function validate(value) {
  return normalize(value);
}

export const LightDefinition = defineComponentType({
  name: "Light",
  version: 1,
  schema: LIGHT_SCHEMA,
  defaults,
  normalize,
  validate,
});

export function createLight(initial) {
  return LightDefinition.create(initial);
}
