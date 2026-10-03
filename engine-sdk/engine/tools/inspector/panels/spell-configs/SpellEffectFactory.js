// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SpellEffectFactory.js — local stub for the external spell particle effect factory.
 */

export function createEmitterConfig(config = {}) {
    return {
        name: config.name || 'default',
        spawnRate: config.spawnRate ?? 100,
        lifetime: config.lifetime ?? 1.0,
        color: config.color || '#ff5500',
        size: config.size ?? 0.5,
        velocity: config.velocity ?? { min: [-1, -1, -1], max: [1, 1, 1] },
    };
}
