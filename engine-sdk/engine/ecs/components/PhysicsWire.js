// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { defineComponentType } from "./ComponentRegistry.js";

const defaults = {
    particles: [],
    length: 5.0,
    segments: 20,
    radius: 0.03,
    stiffness: 0.95,
    bendStiffness: 0.8,
    damping: 0.98,
    gravity: -9.8,
    fixStart: true,
    fixEnd: false,
    color: [0.3, 0.3, 0.35, 1],
    _solver: null,
    _particles: null,
};

function normalize(input) {
    const src = input && typeof input === "object" ? input : {};
    
    return {
        particles: Array.isArray(src.particles) ? src.particles : defaults.particles,
        length: Number.isFinite(src.length) ? src.length : defaults.length,
        segments: Number.isFinite(src.segments) ? Math.max(2, src.segments | 0) : defaults.segments,
        radius: Number.isFinite(src.radius) ? src.radius : defaults.radius,
        stiffness: Number.isFinite(src.stiffness) ? src.stiffness : defaults.stiffness,
        bendStiffness: Number.isFinite(src.bendStiffness) ? src.bendStiffness : defaults.bendStiffness,
        damping: Number.isFinite(src.damping) ? src.damping : defaults.damping,
        gravity: Number.isFinite(src.gravity) ? src.gravity : defaults.gravity,
        fixStart: !!src.fixStart,
        fixEnd: !!src.fixEnd,
        color: Array.isArray(src.color) && src.color.length >= 3 ? src.color : defaults.color,
        _solver: src._solver ?? null,
        _particles: src._particles ?? null,
    };
}

function validate(value) {
    return normalize(value);
}

export const PhysicsWireDefinition = defineComponentType({
    name: "PhysicsWire",
    version: 1,
    defaults,
    normalize,
    validate,
});

export function createPhysicsWire(initial) {
    return PhysicsWireDefinition.create(initial);
}
