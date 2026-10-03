// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { defineComponentType } from "./ComponentRegistry.js";
import { RENDERABLE_SCHEMA, normalizeBySchema, getSchemaDefaults } from "../EntitySchema.js";

const defaults = getSchemaDefaults(RENDERABLE_SCHEMA);

function normalize(input) {
  return normalizeBySchema(RENDERABLE_SCHEMA, input);
}

function validate(value) {
  return normalize(value);
}

export const RenderableDefinition = defineComponentType({
  name: "Renderable",
  version: 1,
  schema: RENDERABLE_SCHEMA,
  defaults,
  normalize,
  validate,
});

export function createRenderable(initial) {
  return RenderableDefinition.create(initial);
}
