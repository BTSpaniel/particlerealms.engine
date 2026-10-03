// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { defineComponentType } from "./ComponentRegistry.js";
import { PHYSICS_CHAIN_SCHEMA, normalizeBySchema, getSchemaDefaults } from "../EntitySchema.js";

const defaults = getSchemaDefaults(PHYSICS_CHAIN_SCHEMA);

function normalize(input) {
    return normalizeBySchema(PHYSICS_CHAIN_SCHEMA, input);
}

function validate(value) {
    return normalize(value);
}

export const PhysicsChainDefinition = defineComponentType({
    name: "PhysicsChain",
    version: 2,
    schema: PHYSICS_CHAIN_SCHEMA,
    defaults,
    normalize,
    validate,
});

export function createPhysicsChain(initial) {
    return PhysicsChainDefinition.create(initial);
}
