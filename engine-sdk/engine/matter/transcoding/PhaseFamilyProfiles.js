// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Canonical reversible phase families with explicit reservoir-delta bounds. */

import { createPhaseFamilyProfile } from './TranscodeContracts.js';

const ANY_NEGATIVE = -1e30;
const ANY_POSITIVE = 1e30;
const ZERO = Object.freeze({ minimum: 0, maximum: 0 });

function deltaBounds({ material = ZERO, water = ZERO, energy = ZERO } = {}) {
    return {
        materialMassKg: material,
        waterMassKg: water,
        internalEnergyJ: energy,
    };
}

function transition(fromPhaseId, toPhaseId, {
    minimumTemperatureK,
    maximumTemperatureK,
    energy,
    water = ZERO,
    structuralMode = 'preserve',
    minimumDamageDelta = 0,
}) {
    return {
        fromPhaseId,
        toPhaseId,
        minimumTemperatureK,
        maximumTemperatureK,
        deltaBounds: deltaBounds({ energy, water }),
        structuralMode,
        minimumDamageDelta,
    };
}

const HEATING = Object.freeze({ minimum: 0, maximum: ANY_POSITIVE });
const COOLING = Object.freeze({ minimum: ANY_NEGATIVE, maximum: 0 });

export const WATER_PHASE_FAMILY = createPhaseFamilyProfile({
    id: 'phase-family.water',
    label: 'Ice, slush, water, and steam',
    phases: ['phase.water.ice', 'phase.water.slush', 'phase.water.steam', 'phase.water.water'],
    transitions: [
        transition('phase.water.ice', 'phase.water.slush', {
            minimumTemperatureK: 270, maximumTemperatureK: 276, energy: HEATING,
            structuralMode: 'weaken', minimumDamageDelta: 0.1,
        }),
        transition('phase.water.slush', 'phase.water.ice', {
            minimumTemperatureK: 0, maximumTemperatureK: 274, energy: COOLING,
            structuralMode: 'preserve',
        }),
        transition('phase.water.slush', 'phase.water.water', {
            minimumTemperatureK: 272, maximumTemperatureK: 285, energy: HEATING,
            structuralMode: 'delete',
        }),
        transition('phase.water.water', 'phase.water.slush', {
            minimumTemperatureK: 0, maximumTemperatureK: 275, energy: COOLING,
            structuralMode: 'preserve',
        }),
        transition('phase.water.water', 'phase.water.steam', {
            minimumTemperatureK: 373, maximumTemperatureK: 10000, energy: HEATING,
            structuralMode: 'delete',
        }),
        transition('phase.water.steam', 'phase.water.water', {
            minimumTemperatureK: 0, maximumTemperatureK: 373.15, energy: COOLING,
            structuralMode: 'preserve',
        }),
    ],
});

export const METAL_PHASE_FAMILY = createPhaseFamilyProfile({
    id: 'phase-family.metal',
    label: 'Metal solid, plastic, and melt',
    phases: ['phase.metal.melt', 'phase.metal.plastic', 'phase.metal.solid'],
    transitions: [
        transition('phase.metal.solid', 'phase.metal.plastic', {
            minimumTemperatureK: 700, maximumTemperatureK: 2400, energy: HEATING,
            structuralMode: 'weaken', minimumDamageDelta: 0.15,
        }),
        transition('phase.metal.plastic', 'phase.metal.solid', {
            minimumTemperatureK: 0, maximumTemperatureK: 1000, energy: COOLING,
            structuralMode: 'preserve',
        }),
        transition('phase.metal.plastic', 'phase.metal.melt', {
            minimumTemperatureK: 1200, maximumTemperatureK: 5000, energy: HEATING,
            structuralMode: 'delete',
        }),
        transition('phase.metal.melt', 'phase.metal.plastic', {
            minimumTemperatureK: 0, maximumTemperatureK: 2000, energy: COOLING,
            structuralMode: 'preserve',
        }),
    ],
});

export const SOIL_WATER_PHASE_FAMILY = createPhaseFamilyProfile({
    id: 'phase-family.soil-water',
    label: 'Soil plus water and mud',
    phases: ['phase.soil.mud', 'phase.soil.soil'],
    transitions: [
        transition('phase.soil.soil', 'phase.soil.mud', {
            minimumTemperatureK: 250, maximumTemperatureK: 373,
            energy: { minimum: ANY_NEGATIVE, maximum: ANY_POSITIVE },
            water: { minimum: 0.000001, maximum: ANY_POSITIVE },
            structuralMode: 'weaken', minimumDamageDelta: 0.2,
        }),
        transition('phase.soil.mud', 'phase.soil.soil', {
            minimumTemperatureK: 250, maximumTemperatureK: 1000,
            energy: { minimum: ANY_NEGATIVE, maximum: ANY_POSITIVE },
            water: { minimum: ANY_NEGATIVE, maximum: -0.000001 },
            structuralMode: 'preserve',
        }),
    ],
});

export const PHASE_FAMILY_PROFILES = Object.freeze([
    METAL_PHASE_FAMILY,
    SOIL_WATER_PHASE_FAMILY,
    WATER_PHASE_FAMILY,
].sort((left, right) => left.id.localeCompare(right.id)));

const BY_ID = new Map(PHASE_FAMILY_PROFILES.map(profile => [profile.id, profile]));

export function getPhaseFamilyProfile(profileId) {
    return BY_ID.get(profileId) ?? null;
}
