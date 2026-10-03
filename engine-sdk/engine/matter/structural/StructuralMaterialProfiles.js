// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Calibrated qualitative response profiles for the first bonded-matter families. */

import { createStructuralMaterialProfile } from './StructuralContracts.js';

function profile(input) {
    return createStructuralMaterialProfile(input);
}

const profiles = [
    profile({
        id: 'structural.rubber',
        label: 'Rubber',
        complianceMPerN: { tension: 2e-5, compression: 1.2e-5, shear: 3e-5, bend: 5e-5 },
        yieldStrain: { tension: 0.55, compression: 0.5, shear: 0.65, bend: 0.8 },
        plasticRatePerSecond: 0.02,
        fatigueRatePerSecond: 0.015,
        damageRatePerSecond: 0.08,
        fractureStrain: 1.8,
        thermalSofteningStartK: 340,
        thermalFailureK: 520,
        recoveryRatePerSecond: 2.5,
        anisotropy: { axis: [1, 0, 0], alongScale: 1, crossScale: 1 },
    }),
    profile({
        id: 'structural.glass',
        label: 'Glass',
        complianceMPerN: { tension: 2e-10, compression: 8e-11, shear: 3e-10, bend: 5e-10 },
        yieldStrain: { tension: 0.0012, compression: 0.003, shear: 0.001, bend: 0.001 },
        plasticRatePerSecond: 0,
        fatigueRatePerSecond: 0.12,
        damageRatePerSecond: 35,
        fractureStrain: 0.006,
        thermalSofteningStartK: 800,
        thermalFailureK: 1700,
        recoveryRatePerSecond: 0,
        anisotropy: { axis: [1, 0, 0], alongScale: 1, crossScale: 1 },
    }),
    profile({
        id: 'structural.steel',
        label: 'Steel',
        complianceMPerN: { tension: 5e-12, compression: 5e-12, shear: 1.3e-11, bend: 2e-11 },
        yieldStrain: { tension: 0.002, compression: 0.002, shear: 0.0015, bend: 0.003 },
        plasticRatePerSecond: 0.35,
        fatigueRatePerSecond: 0.08,
        damageRatePerSecond: 0.75,
        fractureStrain: 0.24,
        thermalSofteningStartK: 900,
        thermalFailureK: 1800,
        recoveryRatePerSecond: 0,
        anisotropy: { axis: [1, 0, 0], alongScale: 1, crossScale: 1 },
    }),
    profile({
        id: 'structural.wood',
        label: 'Wood',
        complianceMPerN: { tension: 8e-10, compression: 1.6e-9, shear: 5e-9, bend: 7e-9 },
        yieldStrain: { tension: 0.012, compression: 0.025, shear: 0.018, bend: 0.035 },
        plasticRatePerSecond: 0.09,
        fatigueRatePerSecond: 0.18,
        damageRatePerSecond: 1.4,
        fractureStrain: 0.085,
        thermalSofteningStartK: 360,
        thermalFailureK: 620,
        recoveryRatePerSecond: 0.01,
        anisotropy: { axis: [1, 0, 0], alongScale: 0.45, crossScale: 2.4 },
    }),
    profile({
        id: 'structural.ice',
        label: 'Ice',
        complianceMPerN: { tension: 4e-9, compression: 1.5e-9, shear: 8e-9, bend: 1.2e-8 },
        yieldStrain: { tension: 0.0025, compression: 0.008, shear: 0.003, bend: 0.004 },
        plasticRatePerSecond: 0.01,
        fatigueRatePerSecond: 0.22,
        damageRatePerSecond: 9,
        fractureStrain: 0.035,
        thermalSofteningStartK: 258,
        thermalFailureK: 273.15,
        recoveryRatePerSecond: 0,
        anisotropy: { axis: [0, 1, 0], alongScale: 0.8, crossScale: 1.25 },
    }),
    profile({
        id: 'structural.soft-tissue',
        label: 'Soft Tissue',
        complianceMPerN: { tension: 8e-5, compression: 4e-5, shear: 1.1e-4, bend: 1.8e-4 },
        yieldStrain: { tension: 0.28, compression: 0.35, shear: 0.4, bend: 0.6 },
        plasticRatePerSecond: 0.16,
        fatigueRatePerSecond: 0.12,
        damageRatePerSecond: 0.45,
        fractureStrain: 1.15,
        thermalSofteningStartK: 315,
        thermalFailureK: 350,
        recoveryRatePerSecond: 0.7,
        anisotropy: { axis: [1, 0, 0], alongScale: 0.65, crossScale: 1.4 },
    }),
];

export const STRUCTURAL_MATERIAL_PROFILES = Object.freeze(Object.fromEntries(
    profiles.map(entry => [entry.id, entry]),
));

export const STRUCTURAL_MATERIAL_PROFILE_IDS = Object.freeze(
    Object.keys(STRUCTURAL_MATERIAL_PROFILES).sort(),
);

export function getStructuralMaterialProfile(profileId) {
    const profileValue = STRUCTURAL_MATERIAL_PROFILES[profileId];
    if (!profileValue) throw new RangeError(`Unknown structural material profile '${profileId}'`);
    return profileValue;
}
