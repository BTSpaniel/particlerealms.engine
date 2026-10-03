// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { defineComponentType } from "./ComponentRegistry.js";
import { PARTICLE_EMITTER_SCHEMA, normalizeBySchema, getSchemaDefaults } from "../EntitySchema.js";

const defaults = getSchemaDefaults(PARTICLE_EMITTER_SCHEMA);

function normalize(input) {
  return normalizeBySchema(PARTICLE_EMITTER_SCHEMA, input);
}

function validate(value) {
  return normalize(value);
}

export const ParticleEmitterDefinition = defineComponentType({
  name: "ParticleEmitter",
  version: 1,
  schema: PARTICLE_EMITTER_SCHEMA,
  defaults,
  normalize,
  validate,
});

export function createParticleEmitter(initial) {
  return ParticleEmitterDefinition.create(initial);
}
