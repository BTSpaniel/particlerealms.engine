// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { defineComponentType } from "./ComponentRegistry.js";

const defaults = {
    particles: [],
    width: 2.0,
    height: 2.0,
    resolutionX: 20,
    resolutionY: 20,
    stiffness: 0.9,
    damping: 0.98,
    gravity: -9.8,
    fixTop: true,
    fixCorners: false,
    color: [0.8, 0.2, 0.2, 1],
    _solver: null,
};

function normalize(input) {
    const src = input && typeof input === "object" ? input : {};
    
    return {
        particles: Array.isArray(src.particles) ? src.particles : defaults.particles,
        width: Number.isFinite(src.width) ? src.width : defaults.width,
        height: Number.isFinite(src.height) ? src.height : defaults.height,
        resolutionX: Number.isFinite(src.resolutionX) ? Math.max(2, src.resolutionX | 0) : defaults.resolutionX,
        resolutionY: Number.isFinite(src.resolutionY) ? Math.max(2, src.resolutionY | 0) : defaults.resolutionY,
        stiffness: Number.isFinite(src.stiffness) ? src.stiffness : defaults.stiffness,
        damping: Number.isFinite(src.damping) ? src.damping : defaults.damping,
        gravity: Number.isFinite(src.gravity) ? src.gravity : defaults.gravity,
        fixTop: src.fixTop !== false,
        fixCorners: !!src.fixCorners,
        color: Array.isArray(src.color) && src.color.length >= 3 ? src.color : defaults.color,
        _solver: src._solver ?? null,
    };
}

function validate(value) {
    return normalize(value);
}

export const PhysicsClothDefinition = defineComponentType({
    name: "PhysicsCloth",
    version: 1,
    defaults,
    normalize,
    validate,
});

export function createPhysicsCloth(initial) {
    return PhysicsClothDefinition.create(initial);
}
