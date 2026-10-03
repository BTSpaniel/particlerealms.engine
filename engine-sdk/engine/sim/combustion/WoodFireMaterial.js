// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** FDS pine input, not the differing material-library README parameter set.
 * Numbers describe one effective pine model, not all species or a fire rating.
 * FDS uses kJ/(kg K) and kJ/kg; this module converts those values to SI joules.
 * https://github.com/firemodels/fds/blob/48ae3e4f77c699efc98eba9ab32cc4b9b3ff156e/Utilities/Input_Libraries/MATL/pine_wood_1C_MATL.fds
 */
export const PINE_FIRE_MATERIAL = Object.freeze({
    id: 'fds-pine-48ae3e4f', sourceCommit: '48ae3e4f77c699efc98eba9ab32cc4b9b3ff156e',
    sourceSha256: '0a21732731b22ae37525c0a629b109a71aa58a0dd9f88ae4274ed2ee5560889c',
    dryDensityKgM3: 360, charYield: .31, ashYield: .02, pyrolysisJPerKg: 416000,
    charOxidationJPerKg: 32000000, charOxygenKgPerKg: 2.67, charCO2KgPerKg: 3.65,
    oxidativeOxygenKgPerKg: .1, atmosphericOxygenMassFraction: .233,
    pyrolysis: Object.freeze({ preExponentialPerSecond: 1e7, activationJPerMol: 1e5, order: .5 }),
    oxidativePyrolysis: Object.freeze({ preExponentialPerSecond: 1e13, activationJPerMol: 1.58e5, order: .63, oxygenOrder: .72 }),
    charOxidation: Object.freeze({ preExponentialPerSecond: 7e6, activationJPerMol: 1.09e5, order: .56, oxygenOrder: .68 }),
    temperatureKnotsK: Object.freeze([293.15, 573.15, 873.15, 1173.15, 1473.15]),
    wood: Object.freeze({
        conductivity: Object.freeze([.173549, .258492, .331944, .395609, .452913]),
        heatCapacity: Object.freeze([1638.272, 2550.559, 3367.617, 4092.512, 4756.277]),
    }),
    char: Object.freeze({
        conductivity: Object.freeze([.069043, .121335, .227944, .419637, .727922]),
        heatCapacity: Object.freeze([1210.882, 1463.983, 1649.246, 1793.039, 1912.405]),
    }),
    ash: Object.freeze({
        conductivity: Object.freeze([.066647, .141158, .326017, .679571, 1.261558]),
        heatCapacity: Object.freeze([1234.783, 1525.267, 1741.593, 1911.42, 2053.577]),
    }),
});

/** Explicit reduced-model closure values, separate from the cited FDS inputs.
 * Oxygen is an atmospheric reservoir with a prescribed penetration length;
 * this is not an oxygen-transport or sealed-enclosure model. Solid char heat
 * retention requires calibration; the balance is reported as gas heat, never
 * silently discarded. The Flow adapter must supply SI temperatures/irradiance.
 */
export const WOOD_FIRE_CLOSURE = Object.freeze({
    referenceTemperatureK: 293.15, emissivity: .9, surfaceLayerM: .001,
    layerGrowth: 1.6, oxygenPenetrationM: .002, charHeatToSolidFraction: .1,
    waterHeatCapacityJPerKgK: 4184, waterBoilingK: 373.15, waterLatentJPerKg: 2257000,
    volatileHeatCapacityJPerKgK: 1200, co2HeatCapacityJPerKgK: 1100,
    ambientHeatTransferWPerM2K: 8,
});
