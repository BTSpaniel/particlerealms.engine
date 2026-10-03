// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { defineComponentType } from "./ComponentRegistry.js";
import { NAV_AGENT_SCHEMA, normalizeBySchema, getSchemaDefaults } from "../EntitySchema.js";

const defaults = getSchemaDefaults(NAV_AGENT_SCHEMA);

function normalize(input) {
  return normalizeBySchema(NAV_AGENT_SCHEMA, input);
}

function validate(value) {
  return normalize(value);
}

export const NavAgentDefinition = defineComponentType({
  name: "NavAgent",
  version: 1,
  schema: NAV_AGENT_SCHEMA,
  defaults,
  normalize,
  validate,
});

export function createNavAgent(initial) {
  return NavAgentDefinition.create(initial);
}
