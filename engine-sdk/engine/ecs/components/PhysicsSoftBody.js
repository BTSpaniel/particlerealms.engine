// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { defineComponentType } from "./ComponentRegistry.js";

const defaults = {
    particles: [],
    shape: 'cube',
    size: 1.0,
    resolution: 4,
    mass: 1.0,
    stiffness: 0.8,
    damping: 0.98,
    gravity: -9.8,
    pressure: 1.0,
    color: [0.3, 0.7, 0.4, 1],
    _solver: null,
    _particles: null,
};

function normalize(input) {
    const src = input && typeof input === "object" ? input : {};
    
    const shape = src.shape === 'sphere' ? 'sphere' : 'cube';
    
    return {
        particles: Array.isArray(src.particles) ? src.particles : defaults.particles,
        shape,
        size: Number.isFinite(src.size) ? src.size : defaults.size,
        resolution: Number.isFinite(src.resolution) ? Math.max(2, src.resolution | 0) : defaults.resolution,
        mass: Number.isFinite(src.mass) ? src.mass : defaults.mass,
        stiffness: Number.isFinite(src.stiffness) ? src.stiffness : defaults.stiffness,
        damping: Number.isFinite(src.damping) ? src.damping : defaults.damping,
        gravity: Number.isFinite(src.gravity) ? src.gravity : defaults.gravity,
        pressure: Number.isFinite(src.pressure) ? src.pressure : defaults.pressure,
        color: Array.isArray(src.color) && src.color.length >= 3 ? src.color : defaults.color,
        _solver: src._solver ?? null,
        _particles: src._particles ?? null,
    };
}

function validate(value) {
    return normalize(value);
}

export const PhysicsSoftBodyDefinition = defineComponentType({
    name: "PhysicsSoftBody",
    version: 1,
    defaults,
    normalize,
    validate,
});

export function createPhysicsSoftBody(initial) {
    return PhysicsSoftBodyDefinition.create(initial);
}
