// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Atmospheric water enthalpy closure shared by retained films and parcels.
 * The energy reference is ice at 273.15 K; negative ice enthalpy is intentional.
 * This constant-capacity model retains the established 0..2000 K temperature
 * input and +/-1e8 J/kg enthalpy input ranges; it is not a pressure-dependent EOS.
 */

export const MELTING_TEMPERATURE_K = 273.15;
export const BOILING_TEMPERATURE_K = 373.15;
export const LATENT_HEAT_FUSION = 333550;
export const LATENT_HEAT_VAPORIZATION = 2256400;
export const SPECIFIC_HEAT_ICE = 2090;
export const SPECIFIC_HEAT_LIQUID_WATER = 4184;
export const SPECIFIC_HEAT_WATER_VAPOR = 2010;
export const WATER_DENSITY_KG_PER_M3 = 997;
export const ICE_DENSITY_KG_PER_M3 = 917;
export const WATER_VAPOR_DENSITY_KG_PER_M3 = 0.597;

export const THERMAL_PHASE = Object.freeze({
  SNOW: 0,
  WATER: 1,
  VAPOR: 2,
});

// The GPU uses ice at the melting point as its specific-enthalpy reference.
// Ice is negative, fusion occupies [0, Lf], and liquid/vapor remain continuous.
const FUSION_START_ENTHALPY = 0;
const FUSION_END_ENTHALPY = LATENT_HEAT_FUSION;
const VAPORIZATION_START_ENTHALPY = FUSION_END_ENTHALPY
  + SPECIFIC_HEAT_LIQUID_WATER * (BOILING_TEMPERATURE_K - MELTING_TEMPERATURE_K);
const VAPORIZATION_END_ENTHALPY = VAPORIZATION_START_ENTHALPY + LATENT_HEAT_VAPORIZATION;

export const WATER_THERMODYNAMICS = Object.freeze({
  meltingTemperatureK: MELTING_TEMPERATURE_K,
  boilingTemperatureK: BOILING_TEMPERATURE_K,
  latentHeatFusionJPerKg: LATENT_HEAT_FUSION,
  latentHeatVaporizationJPerKg: LATENT_HEAT_VAPORIZATION,
  specificHeatIceJPerKgK: SPECIFIC_HEAT_ICE,
  specificHeatLiquidJPerKgK: SPECIFIC_HEAT_LIQUID_WATER,
  specificHeatVaporJPerKgK: SPECIFIC_HEAT_WATER_VAPOR,
  fusionStartEnthalpyJPerKg: FUSION_START_ENTHALPY,
  fusionEndEnthalpyJPerKg: FUSION_END_ENTHALPY,
  vaporizationStartEnthalpyJPerKg: VAPORIZATION_START_ENTHALPY,
  vaporizationEndEnthalpyJPerKg: VAPORIZATION_END_ENTHALPY,
});

export const THERMAL_CONSTANTS = Object.freeze({
  MELTING_TEMPERATURE_K,
  BOILING_TEMPERATURE_K,
  LATENT_HEAT_FUSION,
  LATENT_HEAT_VAPORIZATION,
  SPECIFIC_HEAT_ICE,
  SPECIFIC_HEAT_WATER: SPECIFIC_HEAT_LIQUID_WATER,
  SPECIFIC_HEAT_VAPOR: SPECIFIC_HEAT_WATER_VAPOR,
});

function finite(value, label, minimum = -Infinity, maximum = Infinity) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new RangeError(`${label} must be finite in [${minimum}, ${maximum}]`);
  }
  return number;
}

function phaseName(phase) {
  if (phase === THERMAL_PHASE.SNOW) return 'snow';
  if (phase === THERMAL_PHASE.WATER) return 'water';
  if (phase === THERMAL_PHASE.VAPOR) return 'vapor';
  throw new RangeError(`Unknown thermal phase: ${phase}`);
}

/**
 * Convert a temperature and unambiguous phase to SI specific enthalpy. The
 * reference is ice at the melting point. Latent plateaus are represented explicitly by
 * thermalStateFromSpecificEnthalpy().
 */
export function specificEnthalpyFromTemperature(temperatureK, phase = null) {
  const temperature = finite(temperatureK, 'temperature', 0, 2000);
  let resolvedPhase = phase;
  if (typeof phase === 'string') {
    const key = phase.toLowerCase();
    resolvedPhase = key === 'snow' || key === 'ice' || key === 'solid'
      ? THERMAL_PHASE.SNOW
      : key === 'water' || key === 'liquid'
        ? THERMAL_PHASE.WATER
        : key === 'vapor' || key === 'steam' || key === 'gas'
          ? THERMAL_PHASE.VAPOR
          : null;
  }
  if (resolvedPhase == null) {
    resolvedPhase = temperature < MELTING_TEMPERATURE_K
      ? THERMAL_PHASE.SNOW
      : temperature < BOILING_TEMPERATURE_K
        ? THERMAL_PHASE.WATER
        : THERMAL_PHASE.VAPOR;
  }
  if (resolvedPhase === THERMAL_PHASE.SNOW) {
    return (temperature - MELTING_TEMPERATURE_K) * SPECIFIC_HEAT_ICE;
  }
  if (resolvedPhase === THERMAL_PHASE.WATER) {
    return FUSION_END_ENTHALPY
      + (temperature - MELTING_TEMPERATURE_K) * SPECIFIC_HEAT_LIQUID_WATER;
  }
  if (resolvedPhase === THERMAL_PHASE.VAPOR) {
    return VAPORIZATION_END_ENTHALPY
      + (temperature - BOILING_TEMPERATURE_K) * SPECIFIC_HEAT_WATER_VAPOR;
  }
  throw new RangeError(`Unknown thermal phase: ${phase}`);
}

/** Resolve temperature, dominant phase, and latent progress from SI enthalpy. */
export function thermalStateFromSpecificEnthalpy(specificEnthalpy) {
  const enthalpy = finite(specificEnthalpy, 'specific enthalpy', -1e8, 1e8);
  if (enthalpy < FUSION_START_ENTHALPY) {
    return Object.freeze({
      temperatureK: MELTING_TEMPERATURE_K + enthalpy / SPECIFIC_HEAT_ICE,
      phase: THERMAL_PHASE.SNOW,
      phaseName: phaseName(THERMAL_PHASE.SNOW),
      liquidFraction: 0,
      vaporFraction: 0,
      latentProgress: 0,
    });
  }
  if (enthalpy < FUSION_END_ENTHALPY) {
    const progress = (enthalpy - FUSION_START_ENTHALPY) / LATENT_HEAT_FUSION;
    return Object.freeze({
      temperatureK: MELTING_TEMPERATURE_K,
      phase: progress < 0.5 ? THERMAL_PHASE.SNOW : THERMAL_PHASE.WATER,
      phaseName: progress < 0.5 ? 'snow' : 'water',
      liquidFraction: progress,
      vaporFraction: 0,
      latentProgress: progress,
    });
  }
  if (enthalpy < VAPORIZATION_START_ENTHALPY) {
    return Object.freeze({
      temperatureK: MELTING_TEMPERATURE_K
        + (enthalpy - FUSION_END_ENTHALPY) / SPECIFIC_HEAT_LIQUID_WATER,
      phase: THERMAL_PHASE.WATER,
      phaseName: phaseName(THERMAL_PHASE.WATER),
      liquidFraction: 1,
      vaporFraction: 0,
      latentProgress: 0,
    });
  }
  if (enthalpy < VAPORIZATION_END_ENTHALPY) {
    const progress = (enthalpy - VAPORIZATION_START_ENTHALPY) / LATENT_HEAT_VAPORIZATION;
    return Object.freeze({
      temperatureK: BOILING_TEMPERATURE_K,
      phase: progress < 0.5 ? THERMAL_PHASE.WATER : THERMAL_PHASE.VAPOR,
      phaseName: progress < 0.5 ? 'water' : 'vapor',
      liquidFraction: 1 - progress,
      vaporFraction: progress,
      latentProgress: progress,
    });
  }
  return Object.freeze({
    temperatureK: BOILING_TEMPERATURE_K
      + (enthalpy - VAPORIZATION_END_ENTHALPY) / SPECIFIC_HEAT_WATER_VAPOR,
    phase: THERMAL_PHASE.VAPOR,
    phaseName: phaseName(THERMAL_PHASE.VAPOR),
    liquidFraction: 0,
    vaporFraction: 1,
    latentProgress: 0,
  });
}

