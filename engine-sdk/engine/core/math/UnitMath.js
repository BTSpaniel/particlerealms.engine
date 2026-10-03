// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * UnitMath.js - deterministic scalar unit conversion helpers.
 */

import { DEG2RAD, RAD2DEG, SPEED_OF_LIGHT, TAU } from './MathConstants.js';
import { finiteNumber, safeDiv } from './MathScalar.js';

export const MILLISECONDS_PER_SECOND = 1000;
export const SECONDS_PER_MINUTE = 60;
export const MINUTES_PER_HOUR = 60;
export const HOURS_PER_DAY = 24;
export const DEFAULT_FRAME_RATE = 60;
export const DEFAULT_SAMPLE_RATE = 48000;
export const DEFAULT_BPM = 120;
export const BITS_PER_BYTE = 8;
export const BYTES_PER_KIB = 1024;
export const BYTES_PER_MIB = BYTES_PER_KIB * BYTES_PER_KIB;
export const BYTES_PER_GIB = BYTES_PER_MIB * BYTES_PER_KIB;

function finiteUnitNumber(value, fallback = 0) {
  return finiteNumber(value, fallback);
}

function positiveUnitNumber(value, fallback = 1) {
  const number = finiteUnitNumber(value, fallback);
  return number > 0 ? number : fallback;
}

function positiveInteger(value, fallback = 1) {
  return Math.max(1, Math.trunc(positiveUnitNumber(value, fallback)));
}

const ANGLE_TO_RADIANS = Object.freeze({
  rad: 1,
  radian: 1,
  radians: 1,
  deg: DEG2RAD,
  degree: DEG2RAD,
  degrees: DEG2RAD,
  turn: TAU,
  turns: TAU,
  grad: TAU / 400,
  grads: TAU / 400,
  gradian: TAU / 400,
  gradians: TAU / 400,
  gon: TAU / 400,
  gons: TAU / 400,
});

function angleScaleToRadians(unit) {
  return ANGLE_TO_RADIANS[String(unit || 'rad').toLowerCase()] || 1;
}

export const degreesToRadians = (degrees) => finiteUnitNumber(degrees) * DEG2RAD;
export const radiansToDegrees = (radians) => finiteUnitNumber(radians) * RAD2DEG;
export const degreesToTurns = (degrees) => finiteUnitNumber(degrees) / 360;
export const turnsToDegrees = (turns) => finiteUnitNumber(turns) * 360;
export const radiansToTurns = (radians) => finiteUnitNumber(radians) / TAU;
export const turnsToRadians = (turns) => finiteUnitNumber(turns) * TAU;
export const degreesToGradians = (degrees) => finiteUnitNumber(degrees) * (400 / 360);
export const gradiansToDegrees = (gradians) => finiteUnitNumber(gradians) * (360 / 400);
export const radiansToGradians = (radians) => radiansToTurns(radians) * 400;
export const gradiansToRadians = (gradians) => finiteUnitNumber(gradians) * (TAU / 400);
export const turnsToGradians = (turns) => finiteUnitNumber(turns) * 400;
export const gradiansToTurns = (gradians) => finiteUnitNumber(gradians) / 400;

export function angleToRadians(value, unit = 'rad') {
  return finiteUnitNumber(value) * angleScaleToRadians(unit);
}

export function radiansToAngle(radians, unit = 'rad') {
  return safeDiv(finiteUnitNumber(radians), angleScaleToRadians(unit), 0);
}

export const secondsToMilliseconds = (seconds) => finiteUnitNumber(seconds) * MILLISECONDS_PER_SECOND;
export const millisecondsToSeconds = (milliseconds) => finiteUnitNumber(milliseconds) / MILLISECONDS_PER_SECOND;
export const secondsToMinutes = (seconds) => finiteUnitNumber(seconds) / SECONDS_PER_MINUTE;
export const minutesToSeconds = (minutes) => finiteUnitNumber(minutes) * SECONDS_PER_MINUTE;
export const minutesToHours = (minutes) => finiteUnitNumber(minutes) / MINUTES_PER_HOUR;
export const hoursToMinutes = (hours) => finiteUnitNumber(hours) * MINUTES_PER_HOUR;
export const hoursToSeconds = (hours) => minutesToSeconds(hoursToMinutes(hours));
export const secondsToHours = (seconds) => minutesToHours(secondsToMinutes(seconds));
export const daysToSeconds = (days) => hoursToSeconds(finiteUnitNumber(days) * HOURS_PER_DAY);
export const secondsToDays = (seconds) => secondsToHours(seconds) / HOURS_PER_DAY;

export function secondsToFrames(seconds, frameRate = DEFAULT_FRAME_RATE) {
  return finiteUnitNumber(seconds) * positiveUnitNumber(frameRate, DEFAULT_FRAME_RATE);
}

export function framesToSeconds(frames, frameRate = DEFAULT_FRAME_RATE) {
  return safeDiv(finiteUnitNumber(frames), positiveUnitNumber(frameRate, DEFAULT_FRAME_RATE), 0);
}

export function millisecondsToFrames(milliseconds, frameRate = DEFAULT_FRAME_RATE) {
  return secondsToFrames(millisecondsToSeconds(milliseconds), frameRate);
}

export function framesToMilliseconds(frames, frameRate = DEFAULT_FRAME_RATE) {
  return secondsToMilliseconds(framesToSeconds(frames, frameRate));
}

export function secondsToSamples(seconds, sampleRate = DEFAULT_SAMPLE_RATE) {
  return finiteUnitNumber(seconds) * positiveUnitNumber(sampleRate, DEFAULT_SAMPLE_RATE);
}

export function samplesToSeconds(samples, sampleRate = DEFAULT_SAMPLE_RATE) {
  return safeDiv(finiteUnitNumber(samples), positiveUnitNumber(sampleRate, DEFAULT_SAMPLE_RATE), 0);
}

export function sampleIndexAtTime(seconds, sampleRate = DEFAULT_SAMPLE_RATE) {
  return Math.floor(secondsToSamples(seconds, sampleRate));
}

export function samplesToMilliseconds(samples, sampleRate = DEFAULT_SAMPLE_RATE) {
  return secondsToMilliseconds(samplesToSeconds(samples, sampleRate));
}

export function millisecondsToSamples(milliseconds, sampleRate = DEFAULT_SAMPLE_RATE) {
  return secondsToSamples(millisecondsToSeconds(milliseconds), sampleRate);
}

export function bpmToSecondsPerBeat(bpm = DEFAULT_BPM) {
  return safeDiv(SECONDS_PER_MINUTE, positiveUnitNumber(bpm, DEFAULT_BPM), 0);
}

export function secondsPerBeatToBpm(secondsPerBeat) {
  return safeDiv(SECONDS_PER_MINUTE, positiveUnitNumber(secondsPerBeat, 0), 0);
}

export function beatsToSeconds(beats, bpm = DEFAULT_BPM) {
  return finiteUnitNumber(beats) * bpmToSecondsPerBeat(bpm);
}

export function secondsToBeats(seconds, bpm = DEFAULT_BPM) {
  return safeDiv(finiteUnitNumber(seconds), bpmToSecondsPerBeat(bpm), 0);
}

export const bpmToHz = (bpm = DEFAULT_BPM) => positiveUnitNumber(bpm, DEFAULT_BPM) / SECONDS_PER_MINUTE;
export const hzToBpm = (frequencyHz) => finiteUnitNumber(frequencyHz) * SECONDS_PER_MINUTE;
export const hzToKhz = (frequencyHz) => finiteUnitNumber(frequencyHz) / 1000;
export const khzToHz = (frequencyKHz) => finiteUnitNumber(frequencyKHz) * 1000;

export function frequencyToPeriodSeconds(frequencyHz) {
  return safeDiv(1, positiveUnitNumber(frequencyHz, 0), 0);
}

export function periodSecondsToFrequencyHz(periodSeconds) {
  return safeDiv(1, positiveUnitNumber(periodSeconds, 0), 0);
}

export function frequencyToWavelengthMeters(frequencyHz, waveSpeed = SPEED_OF_LIGHT) {
  return safeDiv(positiveUnitNumber(waveSpeed, SPEED_OF_LIGHT), positiveUnitNumber(frequencyHz, 0), 0);
}

export function wavelengthMetersToFrequencyHz(wavelengthMeters, waveSpeed = SPEED_OF_LIGHT) {
  return safeDiv(positiveUnitNumber(waveSpeed, SPEED_OF_LIGHT), positiveUnitNumber(wavelengthMeters, 0), 0);
}

export const frequencyToWavelength = frequencyToWavelengthMeters;
export const wavelengthToFrequency = wavelengthMetersToFrequencyHz;

export const dbToGain = (db) => 10 ** (finiteUnitNumber(db) / 20);

export function gainToDb(gain, floorDb = -Infinity) {
  const value = finiteUnitNumber(gain, 0);
  return value > 0 ? 20 * Math.log10(value) : floorDb;
}

export const dbToPowerRatio = (db) => 10 ** (finiteUnitNumber(db) / 10);

export function powerRatioToDb(powerRatio, floorDb = -Infinity) {
  const value = finiteUnitNumber(powerRatio, 0);
  return value > 0 ? 10 * Math.log10(value) : floorDb;
}

export const centsToFrequencyRatio = (cents) => 2 ** (finiteUnitNumber(cents) / 1200);

export function frequencyRatioToCents(ratio, floorCents = -Infinity) {
  const value = finiteUnitNumber(ratio, 0);
  return value > 0 ? 1200 * Math.log2(value) : floorCents;
}

export const bitsToBytes = (bits) => finiteUnitNumber(bits) / BITS_PER_BYTE;
export const bytesToBits = (bytes) => finiteUnitNumber(bytes) * BITS_PER_BYTE;
export const bytesToKiB = (bytes) => finiteUnitNumber(bytes) / BYTES_PER_KIB;
export const kiBToBytes = (kibibytes) => finiteUnitNumber(kibibytes) * BYTES_PER_KIB;
export const bytesToMiB = (bytes) => finiteUnitNumber(bytes) / BYTES_PER_MIB;
export const miBToBytes = (mebibytes) => finiteUnitNumber(mebibytes) * BYTES_PER_MIB;
export const bytesToGiB = (bytes) => finiteUnitNumber(bytes) / BYTES_PER_GIB;
export const giBToBytes = (gibibytes) => finiteUnitNumber(gibibytes) * BYTES_PER_GIB;

export function cssPixelsToDevicePixels(cssPixels, devicePixelRatio = 1) {
  return finiteUnitNumber(cssPixels) * positiveUnitNumber(devicePixelRatio, 1);
}

export function devicePixelsToCssPixels(devicePixels, devicePixelRatio = 1) {
  return safeDiv(finiteUnitNumber(devicePixels), positiveUnitNumber(devicePixelRatio, 1), 0);
}

export function worldUnitsToGridIndex(worldValue, cellSize = 1, origin = 0) {
  return Math.floor(safeDiv(finiteUnitNumber(worldValue) - finiteUnitNumber(origin), positiveUnitNumber(cellSize, 1), 0));
}

export function gridIndexToWorldUnits(gridIndex, cellSize = 1, origin = 0, centered = false) {
  const offset = centered ? 0.5 : 0;
  return finiteUnitNumber(origin) + (Math.trunc(finiteUnitNumber(gridIndex)) + offset) * positiveUnitNumber(cellSize, 1);
}

export function worldUnitsToChunkIndex(worldValue, chunkCells = 16, cellSize = 1, origin = 0) {
  const chunkWorldSize = positiveInteger(chunkCells, 16) * positiveUnitNumber(cellSize, 1);
  return Math.floor(safeDiv(finiteUnitNumber(worldValue) - finiteUnitNumber(origin), chunkWorldSize, 0));
}

export function chunkIndexToWorldUnits(chunkIndex, chunkCells = 16, cellSize = 1, origin = 0, centered = false) {
  const chunkWorldSize = positiveInteger(chunkCells, 16) * positiveUnitNumber(cellSize, 1);
  const offset = centered ? 0.5 : 0;
  return finiteUnitNumber(origin) + (Math.trunc(finiteUnitNumber(chunkIndex)) + offset) * chunkWorldSize;
}

export function worldUnitsToLocalChunkIndex(worldValue, chunkCells = 16, cellSize = 1, origin = 0) {
  const cells = positiveInteger(chunkCells, 16);
  const gridIndex = worldUnitsToGridIndex(worldValue, cellSize, origin);
  return ((gridIndex % cells) + cells) % cells;
}
