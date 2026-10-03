// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// RadioMath.js - reusable RF power, noise, path-loss, channel, and link-budget helpers.

import { statsMean } from './MathStatistics.js';

export const RADIO_SPEED_OF_LIGHT_MPS = 299792458;
export const RADIO_BOLTZMANN_J_PER_K = 1.380649e-23;
export const RADIO_REFERENCE_TEMPERATURE_K = 290;
export const RADIO_REFERENCE_NOISE_FLOOR_DBM_PER_HZ = wattsToDbm(RADIO_BOLTZMANN_J_PER_K * RADIO_REFERENCE_TEMPERATURE_K);

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

function decibelNumber(value, name) {
  const number = Number(value);
  if (Number.isNaN(number)) {
    throw new RangeError(`${name} must be a decibel number`);
  }
  return number;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

export function linearToDecibels(ratio) {
  const value = nonnegativeNumber(ratio, 'ratio');
  if (value === 0) return -Infinity;
  return 10 * Math.log10(value);
}

export function decibelsToLinear(decibels) {
  const value = decibelNumber(decibels, 'decibels');
  if (value === -Infinity) return 0;
  return 10 ** (value / 10);
}

export function milliwattsToDbm(milliwatts) {
  const value = nonnegativeNumber(milliwatts, 'milliwatts');
  if (value === 0) return -Infinity;
  return 10 * Math.log10(value);
}

export function dbmToMilliwatts(dbm) {
  const value = decibelNumber(dbm, 'dbm');
  if (value === -Infinity) return 0;
  return 10 ** (value / 10);
}

export function wattsToDbm(watts) {
  return milliwattsToDbm(nonnegativeNumber(watts, 'watts') * 1000);
}

export function dbmToWatts(dbm) {
  return dbmToMilliwatts(dbm) / 1000;
}

export function dbmToDbw(dbm) {
  return decibelNumber(dbm, 'dbm') - 30;
}

export function dbwToDbm(dbw) {
  return decibelNumber(dbw, 'dbw') + 30;
}

export function snrDb(signalDbm, noiseDbm) {
  return decibelNumber(signalDbm, 'signalDbm') - decibelNumber(noiseDbm, 'noiseDbm');
}

export function snrLinear(signalWatts, noiseWatts) {
  const signal = nonnegativeNumber(signalWatts, 'signalWatts');
  const noise = positiveNumber(noiseWatts, 'noiseWatts');
  return signal / noise;
}

export function thermalNoiseFloorDbm(bandwidthHz, options = {}) {
  const bandwidth = positiveNumber(bandwidthHz, 'bandwidthHz');
  const temperatureK = positiveNumber(options.temperatureK ?? RADIO_REFERENCE_TEMPERATURE_K, 'temperatureK');
  const noiseFigureDb = decibelNumber(options.noiseFigureDb ?? 0, 'noiseFigureDb');
  const watts = RADIO_BOLTZMANN_J_PER_K * temperatureK * bandwidth;
  return wattsToDbm(watts) + noiseFigureDb;
}

export function receiverSensitivityDbm(options = {}) {
  const bandwidthHz = positiveNumber(options.bandwidthHz, 'bandwidthHz');
  const requiredSnrDb = decibelNumber(options.requiredSnrDb ?? 0, 'requiredSnrDb');
  return thermalNoiseFloorDbm(bandwidthHz, options) + requiredSnrDb;
}

export function freeSpacePathLossDb(options = {}) {
  const distanceMeters = positiveNumber(options.distanceMeters, 'distanceMeters');
  const frequencyHz = positiveNumber(options.frequencyHz, 'frequencyHz');
  const speedOfLightMps = positiveNumber(options.speedOfLightMps ?? RADIO_SPEED_OF_LIGHT_MPS, 'speedOfLightMps');
  return 20 * Math.log10((4 * Math.PI * distanceMeters * frequencyHz) / speedOfLightMps);
}

export function logDistancePathLossDb(options = {}) {
  const distanceMeters = positiveNumber(options.distanceMeters, 'distanceMeters');
  const referenceDistanceMeters = positiveNumber(options.referenceDistanceMeters ?? 1, 'referenceDistanceMeters');
  const pathLossExponent = positiveNumber(options.pathLossExponent ?? 2, 'pathLossExponent');
  const shadowingDb = decibelNumber(options.shadowingDb ?? 0, 'shadowingDb');
  const referenceLossDb = options.referenceLossDb === undefined
    ? freeSpacePathLossDb({
      distanceMeters: referenceDistanceMeters,
      frequencyHz: positiveNumber(options.frequencyHz, 'frequencyHz'),
      speedOfLightMps: options.speedOfLightMps,
    })
    : decibelNumber(options.referenceLossDb, 'referenceLossDb');
  return referenceLossDb + 10 * pathLossExponent * Math.log10(distanceMeters / referenceDistanceMeters) + shadowingDb;
}

export function receivedPowerDbm(options = {}) {
  const transmitPowerDbm = decibelNumber(options.transmitPowerDbm, 'transmitPowerDbm');
  const transmitGainDbi = decibelNumber(options.transmitGainDbi ?? 0, 'transmitGainDbi');
  const receiveGainDbi = decibelNumber(options.receiveGainDbi ?? 0, 'receiveGainDbi');
  const transmitLossDb = decibelNumber(options.transmitLossDb ?? 0, 'transmitLossDb');
  const receiveLossDb = decibelNumber(options.receiveLossDb ?? 0, 'receiveLossDb');
  const systemLossDb = decibelNumber(options.systemLossDb ?? options.miscLossDb ?? 0, 'systemLossDb');
  const pathLossDb = options.pathLossDb === undefined
    ? freeSpacePathLossDb(options)
    : decibelNumber(options.pathLossDb, 'pathLossDb');
  return transmitPowerDbm + transmitGainDbi - transmitLossDb - pathLossDb - systemLossDb + receiveGainDbi - receiveLossDb;
}

export function linkBudgetReport(options = {}) {
  const pathLossDb = options.pathLossDb === undefined
    ? freeSpacePathLossDb(options)
    : decibelNumber(options.pathLossDb, 'pathLossDb');
  const transmitPowerDbm = decibelNumber(options.transmitPowerDbm, 'transmitPowerDbm');
  const transmitGainDbi = decibelNumber(options.transmitGainDbi ?? 0, 'transmitGainDbi');
  const transmitLossDb = decibelNumber(options.transmitLossDb ?? 0, 'transmitLossDb');
  const receiveGainDbi = decibelNumber(options.receiveGainDbi ?? 0, 'receiveGainDbi');
  const receiveLossDb = decibelNumber(options.receiveLossDb ?? 0, 'receiveLossDb');
  const systemLossDb = decibelNumber(options.systemLossDb ?? options.miscLossDb ?? 0, 'systemLossDb');
  const eirpDbm = transmitPowerDbm + transmitGainDbi - transmitLossDb;
  const receivedDbm = eirpDbm - pathLossDb - systemLossDb + receiveGainDbi - receiveLossDb;
  const bandwidthHz = options.bandwidthHz === undefined ? null : positiveNumber(options.bandwidthHz, 'bandwidthHz');
  const noiseFloorDbm = bandwidthHz === null ? null : thermalNoiseFloorDbm(bandwidthHz, options);
  const requiredSnrDb = options.requiredSnrDb === undefined ? null : decibelNumber(options.requiredSnrDb, 'requiredSnrDb');
  const sensitivityDbm = bandwidthHz === null || requiredSnrDb === null
    ? null
    : receiverSensitivityDbm({ ...options, bandwidthHz, requiredSnrDb });
  const linkSnrDb = noiseFloorDbm === null ? null : snrDb(receivedDbm, noiseFloorDbm);
  const capacityBps = bandwidthHz === null || linkSnrDb === null
    ? null
    : channelCapacityBps(bandwidthHz, { snrDb: linkSnrDb });
  return {
    eirpDbm,
    pathLossDb,
    receivedPowerDbm: receivedDbm,
    noiseFloorDbm,
    snrDb: linkSnrDb,
    requiredSnrDb,
    receiverSensitivityDbm: sensitivityDbm,
    linkMarginDb: sensitivityDbm === null ? null : receivedDbm - sensitivityDbm,
    capacityBps,
  };
}

export function channelCapacityBps(bandwidthHz, options = {}) {
  const bandwidth = nonnegativeNumber(bandwidthHz, 'bandwidthHz');
  if (bandwidth === 0) return 0;
  const ratio = options.snrLinear === undefined
    ? decibelsToLinear(decibelNumber(options.snrDb ?? 0, 'snrDb'))
    : nonnegativeNumber(options.snrLinear, 'snrLinear');
  return bandwidth * Math.log2(1 + ratio);
}

export function requiredSnrForCapacityDb(capacityBps, bandwidthHz) {
  const capacity = nonnegativeNumber(capacityBps, 'capacityBps');
  const bandwidth = positiveNumber(bandwidthHz, 'bandwidthHz');
  return linearToDecibels((2 ** (capacity / bandwidth)) - 1);
}

export function rssiQualityScore(rssiDbm, options = {}) {
  const rssi = decibelNumber(rssiDbm, 'rssiDbm');
  const unusableDbm = decibelNumber(options.unusableDbm ?? -100, 'unusableDbm');
  const excellentDbm = decibelNumber(options.excellentDbm ?? -50, 'excellentDbm');
  if (excellentDbm <= unusableDbm) throw new RangeError('excellentDbm must be greater than unusableDbm');
  return clamp01((rssi - unusableDbm) / (excellentDbm - unusableDbm));
}

export function snrQualityScore(snrValueDb, options = {}) {
  const value = decibelNumber(snrValueDb, 'snrValueDb');
  const unusableDb = decibelNumber(options.unusableDb ?? 0, 'unusableDb');
  const excellentDb = decibelNumber(options.excellentDb ?? 30, 'excellentDb');
  if (excellentDb <= unusableDb) throw new RangeError('excellentDb must be greater than unusableDb');
  return clamp01((value - unusableDb) / (excellentDb - unusableDb));
}

export function channelOverlapReport(aCenterHz, aBandwidthHz, bCenterHz, bBandwidthHz) {
  const aCenter = finiteNumber(aCenterHz, 'aCenterHz');
  const bCenter = finiteNumber(bCenterHz, 'bCenterHz');
  const aWidth = positiveNumber(aBandwidthHz, 'aBandwidthHz');
  const bWidth = positiveNumber(bBandwidthHz, 'bBandwidthHz');
  const aMin = aCenter - aWidth / 2;
  const aMax = aCenter + aWidth / 2;
  const bMin = bCenter - bWidth / 2;
  const bMax = bCenter + bWidth / 2;
  const overlapHz = Math.max(0, Math.min(aMax, bMax) - Math.max(aMin, bMin));
  const narrowerHz = Math.min(aWidth, bWidth);
  const unionHz = Math.max(aMax, bMax) - Math.min(aMin, bMin);
  return {
    overlapHz,
    overlapRatio: overlapHz / narrowerHz,
    unionRatio: unionHz > 0 ? overlapHz / unionHz : 0,
    centerSeparationHz: Math.abs(aCenter - bCenter),
    aRangeHz: Object.freeze([aMin, aMax]),
    bRangeHz: Object.freeze([bMin, bMax]),
  };
}

export function interferencePowerDbm(powersDbm = []) {
  if (!powersDbm || typeof powersDbm[Symbol.iterator] !== 'function') {
    throw new TypeError('powersDbm must be iterable');
  }
  let totalMilliwatts = 0;
  for (const powerDbm of powersDbm) {
    totalMilliwatts += dbmToMilliwatts(powerDbm);
  }
  return milliwattsToDbm(totalMilliwatts);
}

export function signalInterferenceNoiseRatioDb(signalDbm, noiseDbm, interferenceDbm = -Infinity) {
  const signal = decibelNumber(signalDbm, 'signalDbm');
  const noiseAndInterferenceDbm = interferencePowerDbm([noiseDbm, interferenceDbm]);
  return signal - noiseAndInterferenceDbm;
}

export function interferenceScore(interferenceDbm, signalDbm, options = {}) {
  const sirDb = snrDb(signalDbm, interferenceDbm);
  const unusableSirDb = decibelNumber(options.unusableSirDb ?? 0, 'unusableSirDb');
  const cleanSirDb = decibelNumber(options.cleanSirDb ?? 30, 'cleanSirDb');
  if (cleanSirDb <= unusableSirDb) throw new RangeError('cleanSirDb must be greater than unusableSirDb');
  return 1 - clamp01((sirDb - unusableSirDb) / (cleanSirDb - unusableSirDb));
}

export function radioLinkQualityReport(options = {}) {
  const budget = linkBudgetReport(options);
  const receivedScore = rssiQualityScore(budget.receivedPowerDbm, options.rssi ?? {});
  const snrScore = budget.snrDb === null ? null : snrQualityScore(budget.snrDb, options.snr ?? {});
  const marginScore = budget.linkMarginDb === null
    ? null
    : clamp01((budget.linkMarginDb - decibelNumber(options.unusableMarginDb ?? 0, 'unusableMarginDb')) /
      (decibelNumber(options.excellentMarginDb ?? 30, 'excellentMarginDb') - decibelNumber(options.unusableMarginDb ?? 0, 'unusableMarginDb')));
  const scoreParts = [receivedScore, snrScore, marginScore].filter((value) => value !== null);
  const qualityScore = scoreParts.length === 0 ? Number.NaN : statsMean(scoreParts);
  return {
    ...budget,
    receivedScore,
    snrScore,
    marginScore,
    qualityScore,
    quality: qualityScore >= 0.8 ? 'excellent' : (qualityScore >= 0.6 ? 'good' : (qualityScore >= 0.35 ? 'weak' : 'poor')),
  };
}

export default Object.freeze({
  RADIO_BOLTZMANN_J_PER_K,
  RADIO_REFERENCE_NOISE_FLOOR_DBM_PER_HZ,
  RADIO_REFERENCE_TEMPERATURE_K,
  RADIO_SPEED_OF_LIGHT_MPS,
  channelCapacityBps,
  channelOverlapReport,
  dbmToDbw,
  dbmToMilliwatts,
  dbmToWatts,
  dbwToDbm,
  decibelsToLinear,
  freeSpacePathLossDb,
  interferencePowerDbm,
  interferenceScore,
  linearToDecibels,
  linkBudgetReport,
  logDistancePathLossDb,
  milliwattsToDbm,
  radioLinkQualityReport,
  receivedPowerDbm,
  receiverSensitivityDbm,
  requiredSnrForCapacityDb,
  rssiQualityScore,
  signalInterferenceNoiseRatioDb,
  snrDb,
  snrLinear,
  snrQualityScore,
  thermalNoiseFloorDbm,
  wattsToDbm,
});
