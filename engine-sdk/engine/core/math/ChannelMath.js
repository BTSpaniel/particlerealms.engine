// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// ChannelMath.js - reusable channel geometry, spacing, hopset, and planning reports.

import {
  channelOverlapReport,
  dbmToMilliwatts,
  milliwattsToDbm,
} from './RadioMath.js';

export const CHANNEL_DEFAULT_BASE_INDEX = 1;
export const CHANNEL_DEFAULT_BASE_CENTER_HZ = 2412e6;
export const CHANNEL_DEFAULT_SPACING_HZ = 5e6;
export const CHANNEL_DEFAULT_BANDWIDTH_HZ = 20e6;
export const CHANNEL_DEFAULT_COCHANNEL_OVERLAP_RATIO = 0.95;
export const CHANNEL_DEFAULT_REQUIRED_HOP_SPACING_HZ = 25e3;
export const CHANNEL_DEFAULT_PLAN_WEIGHTS = Object.freeze({
  interference: 0.65,
  utilization: 0.25,
  preference: 0.10,
});

export const WIFI_24_GHZ_CHANNEL_14_CENTER_HZ = 2484e6;

function finiteNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new RangeError(`${name} must be finite`);
  }
  return number;
}

function nonnegativeNumber(value, name) {
  const number = finiteNumber(value, name);
  if (number < 0) {
    throw new RangeError(`${name} must be nonnegative`);
  }
  return number;
}

function positiveNumber(value, name) {
  const number = finiteNumber(value, name);
  if (number <= 0) {
    throw new RangeError(`${name} must be positive`);
  }
  return number;
}

function optionalFinite(value, name, fallback = null) {
  return value === undefined || value === null ? fallback : finiteNumber(value, name);
}

function optionalNonnegative(value, name, fallback = 0) {
  return value === undefined || value === null ? fallback : nonnegativeNumber(value, name);
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function normalizeChannel(channel, options = {}) {
  const source = typeof channel === 'object' && channel !== null ? channel : { centerHz: channel };
  const centerHz = source.centerHz ?? source.frequencyHz ?? (
    source.channelNumber === undefined
      ? undefined
      : channelCenterFromIndex(source.channelNumber, {
        baseIndex: options.baseIndex,
        baseCenterHz: options.baseCenterHz,
        spacingHz: options.spacingHz,
      })
  );
  const bandwidthHz = source.bandwidthHz ?? source.widthHz ?? options.defaultBandwidthHz ?? CHANNEL_DEFAULT_BANDWIDTH_HZ;
  const range = channelRangeReport(centerHz, bandwidthHz);
  return {
    id: source.id ?? source.channelId ?? source.name ?? source.channelNumber ?? `${range.centerHz}:${range.bandwidthHz}`,
    channelNumber: source.channelNumber ?? null,
    centerHz: range.centerHz,
    bandwidthHz: range.bandwidthHz,
    minHz: range.minHz,
    maxHz: range.maxHz,
    source,
  };
}

function normalizeBand(band, index) {
  if (Array.isArray(band)) {
    if (band.length < 2) throw new RangeError(`bands[${index}] must include min and max`);
    const minHz = finiteNumber(band[0], `bands[${index}].minHz`);
    const maxHz = finiteNumber(band[1], `bands[${index}].maxHz`);
    if (maxHz <= minHz) throw new RangeError(`bands[${index}] maxHz must be greater than minHz`);
    return { id: `${minHz}:${maxHz}`, minHz, maxHz };
  }
  if (!band || typeof band !== 'object') throw new TypeError(`bands[${index}] must be an object or [minHz,maxHz]`);
  const minHz = finiteNumber(band.minHz ?? band.lowHz ?? band.startHz, `bands[${index}].minHz`);
  const maxHz = finiteNumber(band.maxHz ?? band.highHz ?? band.endHz, `bands[${index}].maxHz`);
  if (maxHz <= minHz) throw new RangeError(`bands[${index}] maxHz must be greater than minHz`);
  return {
    id: band.id ?? band.name ?? `${minHz}:${maxHz}`,
    minHz,
    maxHz,
  };
}

export function channelRangeReport(centerHz, bandwidthHz) {
  const center = finiteNumber(centerHz, 'centerHz');
  const bandwidth = positiveNumber(bandwidthHz, 'bandwidthHz');
  const half = bandwidth / 2;
  return {
    centerHz: center,
    bandwidthHz: bandwidth,
    minHz: center - half,
    maxHz: center + half,
    rangeHz: Object.freeze([center - half, center + half]),
  };
}

export function channelCenterFromIndex(index, options = {}) {
  const channelIndex = finiteNumber(index, 'index');
  const baseIndex = finiteNumber(options.baseIndex ?? CHANNEL_DEFAULT_BASE_INDEX, 'baseIndex');
  const baseCenterHz = finiteNumber(options.baseCenterHz ?? CHANNEL_DEFAULT_BASE_CENTER_HZ, 'baseCenterHz');
  const spacingHz = positiveNumber(options.spacingHz ?? CHANNEL_DEFAULT_SPACING_HZ, 'spacingHz');
  return baseCenterHz + (channelIndex - baseIndex) * spacingHz;
}

export function channelIndexFromCenterReport(centerHz, options = {}) {
  const center = finiteNumber(centerHz, 'centerHz');
  const baseIndex = finiteNumber(options.baseIndex ?? CHANNEL_DEFAULT_BASE_INDEX, 'baseIndex');
  const baseCenterHz = finiteNumber(options.baseCenterHz ?? CHANNEL_DEFAULT_BASE_CENTER_HZ, 'baseCenterHz');
  const spacingHz = positiveNumber(options.spacingHz ?? CHANNEL_DEFAULT_SPACING_HZ, 'spacingHz');
  const index = baseIndex + ((center - baseCenterHz) / spacingHz);
  const nearestIndex = Math.round(index);
  const nearestCenterHz = channelCenterFromIndex(nearestIndex, { baseIndex, baseCenterHz, spacingHz });
  const centerErrorHz = center - nearestCenterHz;
  const toleranceHz = nonnegativeNumber(options.toleranceHz ?? 1e-6, 'toleranceHz');
  return {
    centerHz: center,
    index,
    nearestIndex,
    nearestCenterHz,
    centerErrorHz,
    exact: Math.abs(centerErrorHz) <= toleranceHz,
  };
}

export function wifi24ChannelCenterHz(channelNumber) {
  const channel = finiteNumber(channelNumber, 'channelNumber');
  if (!Number.isInteger(channel) || channel < 1 || channel > 14) {
    throw new RangeError('2.4 GHz Wi-Fi channelNumber must be an integer from 1 through 14');
  }
  if (channel === 14) return WIFI_24_GHZ_CHANNEL_14_CENTER_HZ;
  return channelCenterFromIndex(channel, {
    baseIndex: 1,
    baseCenterHz: 2412e6,
    spacingHz: 5e6,
  });
}

export function wifi24ChannelReport(channelNumber, options = {}) {
  const centerHz = wifi24ChannelCenterHz(channelNumber);
  return {
    channelNumber,
    ...channelRangeReport(centerHz, options.bandwidthHz ?? CHANNEL_DEFAULT_BANDWIDTH_HZ),
  };
}

export function channelBandMembershipReport(channel, bands = [], options = {}) {
  const candidate = normalizeChannel(channel, options);
  if (!Array.isArray(bands)) throw new TypeError('bands must be an array');
  const guardHz = nonnegativeNumber(options.guardHz ?? 0, 'guardHz');
  const normalizedBands = bands.map(normalizeBand);
  const containingBand = normalizedBands.find((band) => (
    candidate.minHz >= band.minHz + guardHz &&
    candidate.maxHz <= band.maxHz - guardHz
  )) ?? null;
  return {
    channel: candidate,
    bands: Object.freeze(normalizedBands),
    guardHz,
    valid: normalizedBands.length === 0 || containingBand !== null,
    containingBand,
  };
}

export function channelGuardBandReport(aChannel, bChannel, options = {}) {
  const a = normalizeChannel(aChannel, options);
  const b = normalizeChannel(bChannel, options);
  const overlap = channelOverlapReport(a.centerHz, a.bandwidthHz, b.centerHz, b.bandwidthHz);
  const guardBandHz = overlap.overlapHz > 0
    ? 0
    : Math.max(0, Math.max(a.minHz, b.minHz) - Math.min(a.maxHz, b.maxHz));
  const minGuardBandHz = nonnegativeNumber(options.minGuardBandHz ?? 0, 'minGuardBandHz');
  const coChannelOverlapRatio = clamp01(finiteNumber(options.coChannelOverlapRatio ?? CHANNEL_DEFAULT_COCHANNEL_OVERLAP_RATIO, 'coChannelOverlapRatio'));
  const relation = overlap.overlapRatio >= coChannelOverlapRatio
    ? 'co-channel'
    : (overlap.overlapHz > 0 ? 'overlapping' : (guardBandHz <= minGuardBandHz ? 'adjacent' : 'separated'));
  return {
    a,
    b,
    relation,
    overlapHz: overlap.overlapHz,
    overlapRatio: overlap.overlapRatio,
    unionRatio: overlap.unionRatio,
    guardBandHz,
    minGuardBandHz,
    guardBandOk: overlap.overlapHz === 0 && guardBandHz >= minGuardBandHz,
    centerSeparationHz: overlap.centerSeparationHz,
    separationBandwidths: overlap.centerSeparationHz / Math.max(a.bandwidthHz, b.bandwidthHz),
  };
}

export function channelHopsetReport(channels = [], options = {}) {
  if (!Array.isArray(channels)) throw new TypeError('channels must be an array');
  const centers = channels
    .map((channel, index) => {
      if (typeof channel === 'object' && channel !== null) {
        return normalizeChannel(channel, options).centerHz;
      }
      return finiteNumber(channel, `channels[${index}]`);
    })
    .filter((center) => center !== null)
    .sort((a, b) => a - b);
  const uniqueCenters = [];
  for (const center of centers) {
    if (uniqueCenters.length === 0 || center !== uniqueCenters[uniqueCenters.length - 1]) uniqueCenters.push(center);
  }
  const spacingsHz = [];
  for (let index = 1; index < uniqueCenters.length; index += 1) {
    spacingsHz.push(uniqueCenters[index] - uniqueCenters[index - 1]);
  }
  const minSpacingHz = spacingsHz.length === 0 ? null : Math.min(...spacingsHz);
  const requiredSpacingHz = nonnegativeNumber(options.requiredSpacingHz ?? CHANNEL_DEFAULT_REQUIRED_HOP_SPACING_HZ, 'requiredSpacingHz');
  const minimumChannelCount = nonnegativeNumber(options.minimumChannelCount ?? 0, 'minimumChannelCount');
  return {
    channelCount: centers.length,
    uniqueChannelCount: uniqueCenters.length,
    uniqueCentersHz: Object.freeze(uniqueCenters),
    spacingsHz: Object.freeze(spacingsHz),
    minSpacingHz,
    requiredSpacingHz,
    minimumChannelCount,
    spacingValid: minSpacingHz === null || minSpacingHz >= requiredSpacingHz,
    countValid: uniqueCenters.length >= minimumChannelCount,
    valid: (minSpacingHz === null || minSpacingHz >= requiredSpacingHz) && uniqueCenters.length >= minimumChannelCount,
  };
}

export function channelInterferenceReport(candidateChannel, interferers = [], options = {}) {
  if (!Array.isArray(interferers)) throw new TypeError('interferers must be an array');
  const candidate = normalizeChannel(candidateChannel, options);
  const adjacentLeakageRatio = clamp01(optionalFinite(options.adjacentLeakageRatio, 'adjacentLeakageRatio', 0));
  const guardFalloffHz = positiveNumber(options.guardFalloffHz ?? candidate.bandwidthHz, 'guardFalloffHz');
  let weightedOverlap = 0;
  let weightedPowerMw = 0;
  const contributors = interferers.map((interferer, index) => {
    const channel = normalizeChannel(interferer, options);
    const relation = channelGuardBandReport(candidate, channel, options);
    const utilization = clamp01(optionalFinite(interferer.utilization ?? interferer.dutyCycle ?? interferer.occupancy, `interferers[${index}].utilization`, 1));
    const powerDbm = optionalFinite(interferer.powerDbm ?? interferer.interferenceDbm ?? interferer.rssiDbm, `interferers[${index}].powerDbm`, null);
    let spectralWeight = relation.overlapRatio;
    if (spectralWeight === 0 && adjacentLeakageRatio > 0 && relation.guardBandHz < guardFalloffHz) {
      spectralWeight = adjacentLeakageRatio * (1 - (relation.guardBandHz / guardFalloffHz));
    }
    const pressure = spectralWeight * utilization;
    weightedOverlap += pressure;
    if (powerDbm !== null && pressure > 0) weightedPowerMw += dbmToMilliwatts(powerDbm) * pressure;
    return Object.freeze({
      id: channel.id,
      relation: relation.relation,
      centerHz: channel.centerHz,
      bandwidthHz: channel.bandwidthHz,
      overlapHz: relation.overlapHz,
      overlapRatio: relation.overlapRatio,
      guardBandHz: relation.guardBandHz,
      utilization,
      powerDbm,
      spectralWeight,
      pressure,
    });
  });
  const pressureScore = clamp01(weightedOverlap);
  return {
    candidate,
    contributorCount: contributors.length,
    contributors: Object.freeze(contributors),
    weightedOverlap,
    pressureScore,
    availableScore: 1 - pressureScore,
    interferenceDbm: weightedPowerMw > 0 ? milliwattsToDbm(weightedPowerMw) : -Infinity,
  };
}

export function channelPlanReport(candidates = [], interferers = [], options = {}) {
  if (!Array.isArray(candidates)) throw new TypeError('candidates must be an array');
  const allowedBands = options.allowedBands ?? options.bands ?? [];
  const weights = { ...CHANNEL_DEFAULT_PLAN_WEIGHTS, ...(options.weights ?? {}) };
  const weightSum = Object.values(weights).reduce((sum, value) => sum + nonnegativeNumber(value, 'weight'), 0);
  const candidateReports = candidates.map((candidateInput) => {
    const candidate = normalizeChannel(candidateInput, options);
    const band = channelBandMembershipReport(candidate, allowedBands, options);
    const interference = channelInterferenceReport(candidate, interferers, options);
    const utilization = clamp01(optionalFinite(candidate.source.utilization ?? candidate.source.occupancy ?? candidate.source.dutyCycle, 'candidate.utilization', 0));
    const preference = clamp01(optionalFinite(candidate.source.preference ?? (candidate.source.preferred ? 1 : 0), 'candidate.preference', 0));
    const blocked = !!candidate.source.blocked || !band.valid;
    const score = blocked || weightSum === 0
      ? 0
      : clamp01((
        interference.availableScore * weights.interference +
        (1 - utilization) * weights.utilization +
        preference * weights.preference
      ) / weightSum);
    return Object.freeze({
      ...candidate,
      band,
      interference,
      utilization,
      preference,
      blocked,
      qualityScore: score,
      quality: score >= 0.8 ? 'excellent' : (score >= 0.6 ? 'good' : (score >= 0.35 ? 'weak' : 'poor')),
    });
  });
  const ranked = [...candidateReports].sort((a, b) => (
    b.qualityScore - a.qualityScore ||
    a.interference.weightedOverlap - b.interference.weightedOverlap ||
    a.centerHz - b.centerHz
  ));
  return {
    candidateCount: candidateReports.length,
    candidates: Object.freeze(candidateReports),
    ranked: Object.freeze(ranked),
    recommended: ranked.find((candidate) => !candidate.blocked) ?? null,
    weights: Object.freeze({ ...weights }),
  };
}

export default Object.freeze({
  CHANNEL_DEFAULT_BANDWIDTH_HZ,
  CHANNEL_DEFAULT_BASE_CENTER_HZ,
  CHANNEL_DEFAULT_BASE_INDEX,
  CHANNEL_DEFAULT_COCHANNEL_OVERLAP_RATIO,
  CHANNEL_DEFAULT_PLAN_WEIGHTS,
  CHANNEL_DEFAULT_REQUIRED_HOP_SPACING_HZ,
  CHANNEL_DEFAULT_SPACING_HZ,
  WIFI_24_GHZ_CHANNEL_14_CENTER_HZ,
  channelBandMembershipReport,
  channelCenterFromIndex,
  channelGuardBandReport,
  channelHopsetReport,
  channelIndexFromCenterReport,
  channelInterferenceReport,
  channelPlanReport,
  channelRangeReport,
  wifi24ChannelCenterHz,
  wifi24ChannelReport,
});
