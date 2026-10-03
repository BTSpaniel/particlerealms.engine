// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { defineComponentType } from "./ComponentRegistry.js";

const defaults = {
    strands: [],
    strandCount: 50,
    segmentsPerStrand: 10,
    strandLength: 1.0,
    radius: 0.01,
    stiffness: 0.7,
    bendStiffness: 0.3,
    damping: 0.95,
    gravity: -9.8,
    spreadRadius: 0.5,
    randomize: true,
    color: [0.2, 0.15, 0.1, 1],
    _solver: null,
    _strands: null,
};

function normalize(input) {
    const src = input && typeof input === "object" ? input : {};
    
    return {
        strands: Array.isArray(src.strands) ? src.strands : defaults.strands,
        strandCount: Number.isFinite(src.strandCount) ? Math.max(1, src.strandCount | 0) : defaults.strandCount,
        segmentsPerStrand: Number.isFinite(src.segmentsPerStrand) ? Math.max(2, src.segmentsPerStrand | 0) : defaults.segmentsPerStrand,
        strandLength: Number.isFinite(src.strandLength) ? src.strandLength : defaults.strandLength,
        radius: Number.isFinite(src.radius) ? src.radius : defaults.radius,
        stiffness: Number.isFinite(src.stiffness) ? src.stiffness : defaults.stiffness,
        bendStiffness: Number.isFinite(src.bendStiffness) ? src.bendStiffness : defaults.bendStiffness,
        damping: Number.isFinite(src.damping) ? src.damping : defaults.damping,
        gravity: Number.isFinite(src.gravity) ? src.gravity : defaults.gravity,
        spreadRadius: Number.isFinite(src.spreadRadius) ? src.spreadRadius : defaults.spreadRadius,
        randomize: src.randomize !== false,
        color: Array.isArray(src.color) && src.color.length >= 3 ? src.color : defaults.color,
        _solver: src._solver ?? null,
        _strands: src._strands ?? null,
    };
}

function validate(value) {
    return normalize(value);
}

export const PhysicsHairDefinition = defineComponentType({
    name: "PhysicsHair",
    version: 1,
    defaults,
    normalize,
    validate,
});

export function createPhysicsHair(initial) {
    return PhysicsHairDefinition.create(initial);
}
