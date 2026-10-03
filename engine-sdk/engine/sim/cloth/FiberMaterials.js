// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
/** Shared editor yarn preview properties; these are not measured fabric curves. */
export const FIBER_MATERIALS = {
    cotton: {
        bendingStiffness: 0.1, elasticity: 0.05, damping: 0.95, density: 1.5,
        anisotropy: 0.15, sheenStrength: 0.8, roughness: 0.7, ior: 1.53,
    },
    wool: {
        bendingStiffness: 0.2, elasticity: 0.3, damping: 0.92, density: 1.3,
        anisotropy: 0.35, sheenStrength: 0.9, roughness: 0.6, ior: 1.55,
    },
    silk: {
        bendingStiffness: 0.15, elasticity: 0.15, damping: 0.97, density: 1.34,
        anisotropy: 0.85, sheenStrength: 0.2, roughness: 0.2, ior: 1.54,
    },
    nylon: {
        bendingStiffness: 0.4, elasticity: 0.6, damping: 0.85, density: 1.14,
        anisotropy: 0.55, sheenStrength: 0.3, roughness: 0.3, ior: 1.58,
    },
    hemp: {
        bendingStiffness: 0.5, elasticity: 0.02, damping: 0.93, density: 1.48,
        anisotropy: 0.25, sheenStrength: 0.5, roughness: 0.8, ior: 1.53,
    },
    steel: {
        bendingStiffness: 0.95, elasticity: 0.01, damping: 0.99, density: 7.8,
        anisotropy: 0.9, sheenStrength: 0.1, roughness: 0.15, ior: 2.5,
    },
    chain: {
        bendingStiffness: 0.9, elasticity: 0.005, damping: 0.98, density: 7.8,
        anisotropy: 0.85, sheenStrength: 0.15, roughness: 0.2, ior: 2.5,
    },
    vine: {
        bendingStiffness: 0.25, elasticity: 0.1, damping: 0.9, density: 0.9,
        anisotropy: 0.1, sheenStrength: 0.4, roughness: 0.75, ior: 1.5,
    },
    wire: {
        bendingStiffness: 0.8, elasticity: 0.02, damping: 0.97, density: 5.5,
        anisotropy: 0.7, sheenStrength: 0.2, roughness: 0.25, ior: 2.3,
    },
};

/** Weave identities shared by the Playground simulation and retained material previews. */
export const WEAVE_TYPES = Object.freeze({ plain: 'Plain weave', twill: '2/2 twill', satin: '5-end satin' });

export const WOVEN_APPEARANCE_LIMITS = Object.freeze({
    minimumThreadsPerMm: 0.05,
    maximumThreadsPerMm: 20,
});

/**
 * Validate the visual-only woven descriptor shared by Engine renderers and
 * Factory surfaces. The caller owns color parsing so Engine receives RGBA
 * values while Factory can retain authored CSS colors.
 */
export function normalizeWovenAppearance(value, { parseColor = null } = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value.kind !== 'woven') {
        throw new TypeError('Woven appearance requires kind woven');
    }
    const weave = String(value.weave || '');
    const fiber = String(value.fiber || '');
    if (!Object.hasOwn(WEAVE_TYPES, weave)) throw new TypeError(`Unsupported weave '${weave}'`);
    if (!Object.hasOwn(FIBER_MATERIALS, fiber) || ['steel', 'chain', 'vine', 'wire'].includes(fiber)) {
        throw new TypeError(`Unsupported fabric fiber '${fiber}'`);
    }
    const density = (input, path) => {
        const number = Number(input);
        if (!Number.isFinite(number) || number < WOVEN_APPEARANCE_LIMITS.minimumThreadsPerMm
            || number > WOVEN_APPEARANCE_LIMITS.maximumThreadsPerMm) {
            throw new RangeError(`${path} must be ${WOVEN_APPEARANCE_LIMITS.minimumThreadsPerMm}-${WOVEN_APPEARANCE_LIMITS.maximumThreadsPerMm} threads/mm`);
        }
        return number;
    };
    const grainDegrees = Number(value.grainDegrees);
    if (!Number.isFinite(grainDegrees) || grainDegrees < -360 || grainDegrees > 360) {
        throw new RangeError('Woven grain direction must be between -360 and 360 degrees');
    }
    const provenance = value.provenance;
    if (!provenance || !['authored', 'sourced', 'measured', 'estimated'].includes(provenance.status)
        || typeof provenance.source !== 'string' || !provenance.source.trim() || provenance.source.length > 256) {
        throw new TypeError('Woven appearance requires authored, sourced, measured or estimated provenance with a source');
    }
    const color = (input, path) => {
        if (parseColor) return parseColor(input, path);
        if (!Array.isArray(input) || input.length !== 4
            || input.some(channel => !Number.isFinite(channel) || channel < 0 || channel > 1)) {
            throw new TypeError(`${path} must be an RGBA color`);
        }
        return Object.freeze([...input]);
    };
    return Object.freeze({
        kind: 'woven',
        weave,
        fiber,
        warpThreadsPerMm: density(value.warpThreadsPerMm, 'warpThreadsPerMm'),
        weftThreadsPerMm: density(value.weftThreadsPerMm, 'weftThreadsPerMm'),
        grainDegrees,
        warpColor: color(value.warpColor, 'warpColor'),
        weftColor: color(value.weftColor, 'weftColor'),
        provenance: Object.freeze({ status: provenance.status, source: provenance.source.trim() }),
    });
}
