// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// Cell-relative, random-access Particle Storm state. The ordinary lane is
// exactly two u32 words per particle. Exceptional states retain the ordinary
// slot and add one stable-order three-u32 override; the header mask maps a slot
// to its override rank without storing a redundant sidecar index.

import {
  dequantizeRange,
  dequantizeSignedFloat,
  quantizeRange,
  quantizeSignedFloat,
} from '../../core/math/QuantMath.js';

export const PARTICLE_STORM_PAGE_CODEC_FORMAT = 'particle-storm/cell-page-u32x2-v1';
export const PARTICLE_STORM_PAGE_CODEC_VERSION = 1;
export const PARTICLE_STORM_PAGE_MAGIC = 0x31505350; // "PSP1" in little endian.
export const PARTICLE_STORM_PAGE_SIZES = Object.freeze([128, 256]);
export const PARTICLE_STORM_PAGE_HEADER_WORDS = 32;
export const PARTICLE_STORM_PAGE_HEADER_BYTES = PARTICLE_STORM_PAGE_HEADER_WORDS * 4;
export const PARTICLE_STORM_PAGE_PARTICLE_WORDS = 2;
export const PARTICLE_STORM_PAGE_PARTICLE_BYTES = PARTICLE_STORM_PAGE_PARTICLE_WORDS * 4;
export const PARTICLE_STORM_PAGE_EXCEPTION_WORDS = 3;
export const PARTICLE_STORM_PAGE_EXCEPTION_BYTES = PARTICLE_STORM_PAGE_EXCEPTION_WORDS * 4;

export const PARTICLE_STORM_PAGE_FLAGS = Object.freeze({
  CELL_RELATIVE_POSITION: 1 << 0,
  MEAN_RELATIVE_VELOCITY: 1 << 1,
  RANKED_EXCEPTION_SIDECAR: 1 << 2,
  TOLERANCE_VALIDATED: 1 << 3,
});

const REQUIRED_HEADER_FLAGS = PARTICLE_STORM_PAGE_FLAGS.CELL_RELATIVE_POSITION
  | PARTICLE_STORM_PAGE_FLAGS.MEAN_RELATIVE_VELOCITY
  | PARTICLE_STORM_PAGE_FLAGS.RANKED_EXCEPTION_SIDECAR;
const HEADER_INDEX = Object.freeze({
  MAGIC: 0,
  VERSION: 1,
  PAGE_SIZE: 2,
  PARTICLE_COUNT: 3,
  EXCEPTION_COUNT: 4,
  PAGE_INDEX: 5,
  GENERATION: 6,
  FLAGS: 7,
  ORIGIN_X: 8,
  ORIGIN_Y: 9,
  ORIGIN_Z: 10,
  LIFE_MAXIMUM: 11,
  EXTENT_X: 12,
  EXTENT_Y: 13,
  EXTENT_Z: 14,
  BASE_VELOCITY_RANGE: 15,
  VELOCITY_MEAN_X: 16,
  VELOCITY_MEAN_Y: 17,
  VELOCITY_MEAN_Z: 18,
  SIDECAR_VELOCITY_RANGE: 19,
  MAX_POSITION_ERROR: 20,
  MAX_VELOCITY_ERROR: 21,
  MAX_LIFE_ERROR: 22,
  RMS_STATE_ERROR: 23,
  EXCEPTION_MASK: 24,
});

export const PARTICLE_STORM_PAGE_HEADER_SCHEMA = Object.freeze([
  Object.freeze({ name: 'magic', byteOffset: 0, type: 'u32' }),
  Object.freeze({ name: 'version', byteOffset: 4, type: 'u32' }),
  Object.freeze({ name: 'pageSize', byteOffset: 8, type: 'u32' }),
  Object.freeze({ name: 'particleCount', byteOffset: 12, type: 'u32' }),
  Object.freeze({ name: 'exceptionCount', byteOffset: 16, type: 'u32' }),
  Object.freeze({ name: 'pageIndex', byteOffset: 20, type: 'u32' }),
  Object.freeze({ name: 'generation', byteOffset: 24, type: 'u32' }),
  Object.freeze({ name: 'flags', byteOffset: 28, type: 'u32' }),
  Object.freeze({ name: 'originLifeMaximum', byteOffset: 32, type: 'vec4<f32>' }),
  Object.freeze({ name: 'extentBaseVelocityRange', byteOffset: 48, type: 'vec4<f32>' }),
  Object.freeze({ name: 'velocityMeanSidecarRange', byteOffset: 64, type: 'vec4<f32>' }),
  Object.freeze({ name: 'errorBounds', byteOffset: 80, type: 'vec4<f32>' }),
  Object.freeze({ name: 'exceptionMaskLow', byteOffset: 96, type: 'vec4<u32>' }),
  Object.freeze({ name: 'exceptionMaskHigh', byteOffset: 112, type: 'vec4<u32>' }),
]);

export const PARTICLE_STORM_PAGE_RECORD_SCHEMA = Object.freeze({
  byteStride: PARTICLE_STORM_PAGE_PARTICLE_BYTES,
  word0: Object.freeze({
    positionX: Object.freeze({ bitOffset: 0, bitCount: 10, encoding: 'unorm' }),
    positionY: Object.freeze({ bitOffset: 10, bitCount: 10, encoding: 'unorm' }),
    positionZ: Object.freeze({ bitOffset: 20, bitCount: 10, encoding: 'unorm' }),
    active: Object.freeze({ bitOffset: 30, bitCount: 1, encoding: 'boolean' }),
    exceptional: Object.freeze({ bitOffset: 31, bitCount: 1, encoding: 'boolean' }),
  }),
  word1: Object.freeze({
    velocityX: Object.freeze({ bitOffset: 0, bitCount: 8, encoding: 'snorm' }),
    velocityY: Object.freeze({ bitOffset: 8, bitCount: 8, encoding: 'snorm' }),
    velocityZ: Object.freeze({ bitOffset: 16, bitCount: 8, encoding: 'snorm' }),
    life: Object.freeze({ bitOffset: 24, bitCount: 8, encoding: 'unorm' }),
  }),
});

export const PARTICLE_STORM_PAGE_EXCEPTION_SCHEMA = Object.freeze({
  byteStride: PARTICLE_STORM_PAGE_EXCEPTION_BYTES,
  order: 'strictly ascending page slot; rank is the popcount of preceding header mask bits',
  word0: 'positionX unorm16 | positionY unorm16 << 16',
  word1: 'positionZ unorm16 | life unorm15 << 16 | velocityX bit0 << 31',
  word2: 'velocityX bits1..10 | velocityY snorm11 << 10 | velocityZ snorm11 << 21',
});

const UINT32_MAX = 0xffffffff;
const POSITION_BASE_MAX = 0x3ff;
const POSITION_SIDECAR_MAX = 0xffff;
const LIFE_BASE_MAX = 0xff;
const LIFE_SIDECAR_MAX = 0x7fff;
const VELOCITY_BASE_MAX = 0x7f;
const VELOCITY_SIDECAR_MAX = 0x3ff;
const MINIMUM_EXTENT = 1e-6;
const FLOAT32_PADDING_SCALE = 2 ** -20;

export class ParticleStormPageCodecError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ParticleStormPageCodecError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function codecError(code, message, details) {
  return new ParticleStormPageCodecError(code, message, details);
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw codecError('PARTICLE_STORM_PAGE_NONFINITE', `${label} must be finite`, { label, value });
  }
  return number;
}

function uint32(value, label, fallback = 0) {
  const number = value == null ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > UINT32_MAX) {
    throw codecError('PARTICLE_STORM_PAGE_U32', `${label} must be an unsigned 32-bit integer`, {
      label,
      value,
    });
  }
  return number >>> 0;
}

function pageSizeValue(value) {
  const pageSize = Number(value ?? 256);
  if (!PARTICLE_STORM_PAGE_SIZES.includes(pageSize)) {
    throw codecError(
      'PARTICLE_STORM_PAGE_SIZE',
      `Particle Storm page size must be ${PARTICLE_STORM_PAGE_SIZES.join(' or ')}`,
      { pageSize },
    );
  }
  return pageSize;
}

function finiteVector(value, label) {
  if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || value.length < 3) {
    throw codecError('PARTICLE_STORM_PAGE_VECTOR', `${label} must contain three finite components`, {
      label,
    });
  }
  return Object.freeze([
    finiteNumber(value[0], `${label}[0]`),
    finiteNumber(value[1], `${label}[1]`),
    finiteNumber(value[2], `${label}[2]`),
  ]);
}

function sourcePosition(particle) {
  return particle?.positionM ?? particle?.position ?? particle?.positionLife;
}

function sourceVelocity(particle) {
  return particle?.velocityMPerS ?? particle?.velocity;
}

function sourceLife(particle) {
  if (particle?.lifeSeconds != null) return particle.lifeSeconds;
  if (particle?.lifetimeSeconds != null) return particle.lifetimeSeconds;
  if (particle?.life != null) return particle.life;
  if (particle?.positionLife?.[3] != null) return particle.positionLife[3];
  return undefined;
}

function normalizeParticle(particle, slot, forcedSlots) {
  if (!particle || typeof particle !== 'object') {
    throw codecError('PARTICLE_STORM_PAGE_PARTICLE', `Particle ${slot} must be an object`, { slot });
  }
  const lifeSeconds = finiteNumber(sourceLife(particle), `particles[${slot}].lifeSeconds`);
  if (lifeSeconds < 0) {
    throw codecError('PARTICLE_STORM_PAGE_LIFE', `Particle ${slot} life must be non-negative`, {
      slot,
      lifeSeconds,
    });
  }
  return Object.freeze({
    positionM: finiteVector(sourcePosition(particle), `particles[${slot}].positionM`),
    velocityMPerS: finiteVector(sourceVelocity(particle), `particles[${slot}].velocityMPerS`),
    lifeSeconds,
    active: particle.active !== false,
    forcedException: forcedSlots.has(slot)
      || particle.exceptional === true
      || particle.forceException === true
      || particle.explicit === true,
  });
}

function forcedSlotSet(value, count) {
  if (value == null) return new Set();
  if (!Array.isArray(value) && !(value instanceof Set) && !ArrayBuffer.isView(value)) {
    throw codecError(
      'PARTICLE_STORM_PAGE_EXCEPTION_SLOTS',
      'forcedExceptionSlots must be an array, typed array, or Set',
    );
  }
  const slots = new Set();
  for (const candidate of value) {
    const slot = Number(candidate);
    if (!Number.isSafeInteger(slot) || slot < 0 || slot >= count) {
      throw codecError('PARTICLE_STORM_PAGE_EXCEPTION_SLOT', 'Forced exception slot is outside the page', {
        slot: candidate,
        particleCount: count,
      });
    }
    slots.add(slot);
  }
  return slots;
}

function tolerance(value, label) {
  if (value == null || value === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw codecError('PARTICLE_STORM_PAGE_TOLERANCE', `${label} must be non-negative`, {
      label,
      value,
    });
  }
  return number;
}

function positiveFiniteOption(value, label, fallback) {
  if (value == null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw codecError('PARTICLE_STORM_PAGE_RANGE', `${label} must be positive and finite`, {
      label,
      value,
    });
  }
  return number;
}

function bitDepthForMaximum(maximum) {
  return Math.round(Math.log2(maximum + 1));
}

function quantizeUnorm(value, origin, extent, maximum) {
  return quantizeRange(value, origin, origin + extent, bitDepthForMaximum(maximum), 0);
}

function dequantizeUnorm(value, origin, extent, maximum) {
  return dequantizeRange(value, origin, origin + extent, bitDepthForMaximum(maximum), origin);
}

function quantizeLife(value, maximumLife, maximum) {
  return quantizeRange(value, 0, maximumLife, bitDepthForMaximum(maximum), 0);
}

function dequantizeLife(value, maximumLife, maximum) {
  return dequantizeRange(value, 0, maximumLife, bitDepthForMaximum(maximum), 0);
}

function quantizeSnorm(value, range, maximum) {
  return quantizeSignedFloat(value, range, maximum);
}

function signedBits(value, bitCount) {
  const sign = 2 ** (bitCount - 1);
  const modulus = 2 ** bitCount;
  const bits = value & (modulus - 1);
  return bits >= sign ? bits - modulus : bits;
}

function dequantizeSnorm(bits, bitCount, range, maximum) {
  return dequantizeSignedFloat(signedBits(bits, bitCount), range, maximum);
}

function vectorDistance(left, right) {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function paddedPositionBounds(particles, minimumExtent) {
  if (particles.length === 0) {
    return Object.freeze({
      originM: Object.freeze([0, 0, 0]),
      extentM: Object.freeze([minimumExtent, minimumExtent, minimumExtent]),
    });
  }
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (const particle of particles) {
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis], particle.positionM[axis]);
      maximum[axis] = Math.max(maximum[axis], particle.positionM[axis]);
    }
  }
  const originM = new Array(3);
  const extentM = new Array(3);
  for (let axis = 0; axis < 3; axis += 1) {
    const padding = Math.max(1, Math.abs(minimum[axis]), Math.abs(maximum[axis]))
      * FLOAT32_PADDING_SCALE;
    originM[axis] = Math.fround(minimum[axis] - padding);
    extentM[axis] = Math.fround(Math.max(
      minimumExtent,
      maximum[axis] + padding - originM[axis],
    ));
  }
  return Object.freeze({ originM: Object.freeze(originM), extentM: Object.freeze(extentM) });
}

function velocityFit(particles, exceptional, options) {
  const regular = particles.filter((_, slot) => !exceptional[slot]);
  const meanSources = regular.length > 0 ? regular : particles;
  let velocityMeanMPerS;
  if (options.velocityMeanMPerS != null) {
    velocityMeanMPerS = finiteVector(options.velocityMeanMPerS, 'velocityMeanMPerS').map(Math.fround);
  } else if (meanSources.length > 0) {
    velocityMeanMPerS = [0, 0, 0];
    for (const particle of meanSources) {
      for (let axis = 0; axis < 3; axis += 1) {
        velocityMeanMPerS[axis] += particle.velocityMPerS[axis];
      }
    }
    velocityMeanMPerS = velocityMeanMPerS.map(value => Math.fround(value / meanSources.length));
  } else {
    velocityMeanMPerS = [0, 0, 0];
  }

  const maximumResidual = sources => sources.reduce((maximum, particle) => {
    for (let axis = 0; axis < 3; axis += 1) {
      maximum = Math.max(maximum, Math.abs(
        particle.velocityMPerS[axis] - velocityMeanMPerS[axis],
      ));
    }
    return maximum;
  }, 0);
  const minimumVelocityRange = positiveFiniteOption(
    options.minimumVelocityRangeMPerS,
    'minimumVelocityRangeMPerS',
    MINIMUM_EXTENT,
  );
  const regularResidual = maximumResidual(regular);
  const allResidual = maximumResidual(particles);
  const fittedBaseRange = Math.max(minimumVelocityRange, regularResidual * (1 + FLOAT32_PADDING_SCALE));
  const baseVelocityRangeMPerS = Math.fround(positiveFiniteOption(
    options.baseVelocityRangeMPerS,
    'baseVelocityRangeMPerS',
    fittedBaseRange,
  ));
  const fittedSidecarRange = Math.max(
    minimumVelocityRange,
    allResidual * (1 + FLOAT32_PADDING_SCALE),
    baseVelocityRangeMPerS,
  );
  const sidecarVelocityRangeMPerS = Math.fround(positiveFiniteOption(
    options.sidecarVelocityRangeMPerS,
    'sidecarVelocityRangeMPerS',
    fittedSidecarRange,
  ));
  if (sidecarVelocityRangeMPerS < allResidual) {
    throw codecError(
      'PARTICLE_STORM_PAGE_SIDECAR_RANGE',
      'sidecarVelocityRangeMPerS cannot represent every page velocity residual',
      { sidecarVelocityRangeMPerS, requiredRangeMPerS: allResidual },
    );
  }
  return Object.freeze({
    velocityMeanMPerS: Object.freeze(velocityMeanMPerS),
    baseVelocityRangeMPerS,
    sidecarVelocityRangeMPerS,
  });
}

function fitPage(particles, exceptional, options) {
  const minimumPositionExtentM = positiveFiniteOption(
    options.minimumPositionExtentM,
    'minimumPositionExtentM',
    MINIMUM_EXTENT,
  );
  const bounds = paddedPositionBounds(particles, minimumPositionExtentM);
  const maximumLife = particles.reduce((maximum, particle) => (
    Math.max(maximum, particle.lifeSeconds)
  ), 0);
  const lifeMaximumSeconds = Math.fround(positiveFiniteOption(
    options.lifeMaximumSeconds,
    'lifeMaximumSeconds',
    Math.max(1, maximumLife * (1 + FLOAT32_PADDING_SCALE)),
  ));
  if (lifeMaximumSeconds < maximumLife) {
    throw codecError(
      'PARTICLE_STORM_PAGE_LIFE_RANGE',
      'lifeMaximumSeconds cannot represent every particle life value',
      { lifeMaximumSeconds, requiredMaximumSeconds: maximumLife },
    );
  }
  const fit = {
    ...bounds,
    ...velocityFit(particles, exceptional, options),
    lifeMaximumSeconds,
  };
  const allFinite = [
    ...fit.originM,
    ...fit.extentM,
    ...fit.velocityMeanMPerS,
    fit.baseVelocityRangeMPerS,
    fit.sidecarVelocityRangeMPerS,
    fit.lifeMaximumSeconds,
  ].every(Number.isFinite);
  if (!allFinite
      || !fit.extentM.every(value => value > 0)
      || fit.baseVelocityRangeMPerS <= 0
      || fit.sidecarVelocityRangeMPerS <= 0
      || fit.lifeMaximumSeconds <= 0) {
    throw codecError(
      'PARTICLE_STORM_PAGE_FLOAT32_RANGE',
      'Particle page state exceeds the finite float32 codec range',
    );
  }
  return Object.freeze(fit);
}

function packBaseRecord(particle, fit, exceptional) {
  const px = quantizeUnorm(particle.positionM[0], fit.originM[0], fit.extentM[0], POSITION_BASE_MAX);
  const py = quantizeUnorm(particle.positionM[1], fit.originM[1], fit.extentM[1], POSITION_BASE_MAX);
  const pz = quantizeUnorm(particle.positionM[2], fit.originM[2], fit.extentM[2], POSITION_BASE_MAX);
  const vx = quantizeSnorm(
    particle.velocityMPerS[0] - fit.velocityMeanMPerS[0],
    fit.baseVelocityRangeMPerS,
    VELOCITY_BASE_MAX,
  );
  const vy = quantizeSnorm(
    particle.velocityMPerS[1] - fit.velocityMeanMPerS[1],
    fit.baseVelocityRangeMPerS,
    VELOCITY_BASE_MAX,
  );
  const vz = quantizeSnorm(
    particle.velocityMPerS[2] - fit.velocityMeanMPerS[2],
    fit.baseVelocityRangeMPerS,
    VELOCITY_BASE_MAX,
  );
  const life = quantizeLife(particle.lifeSeconds, fit.lifeMaximumSeconds, LIFE_BASE_MAX);
  return Object.freeze([
    (px | (py << 10) | (pz << 20)
      | (particle.active ? 0x40000000 : 0)
      | (exceptional ? 0x80000000 : 0)) >>> 0,
    ((vx & 0xff) | ((vy & 0xff) << 8) | ((vz & 0xff) << 16) | (life << 24)) >>> 0,
  ]);
}

function decodeBaseRecord(word0, word1, fit) {
  return Object.freeze({
    positionM: Object.freeze([
      dequantizeUnorm(word0 & 0x3ff, fit.originM[0], fit.extentM[0], POSITION_BASE_MAX),
      dequantizeUnorm((word0 >>> 10) & 0x3ff, fit.originM[1], fit.extentM[1], POSITION_BASE_MAX),
      dequantizeUnorm((word0 >>> 20) & 0x3ff, fit.originM[2], fit.extentM[2], POSITION_BASE_MAX),
    ]),
    velocityMPerS: Object.freeze([
      fit.velocityMeanMPerS[0]
        + dequantizeSnorm(word1 & 0xff, 8, fit.baseVelocityRangeMPerS, VELOCITY_BASE_MAX),
      fit.velocityMeanMPerS[1]
        + dequantizeSnorm((word1 >>> 8) & 0xff, 8, fit.baseVelocityRangeMPerS, VELOCITY_BASE_MAX),
      fit.velocityMeanMPerS[2]
        + dequantizeSnorm((word1 >>> 16) & 0xff, 8, fit.baseVelocityRangeMPerS, VELOCITY_BASE_MAX),
    ]),
    lifeSeconds: dequantizeLife(
      (word1 >>> 24) & 0xff,
      fit.lifeMaximumSeconds,
      LIFE_BASE_MAX,
    ),
    active: ((word0 >>> 30) & 1) !== 0,
    exceptional: ((word0 >>> 31) & 1) !== 0,
  });
}

function packExceptionRecord(particle, fit) {
  const px = quantizeUnorm(
    particle.positionM[0], fit.originM[0], fit.extentM[0], POSITION_SIDECAR_MAX,
  );
  const py = quantizeUnorm(
    particle.positionM[1], fit.originM[1], fit.extentM[1], POSITION_SIDECAR_MAX,
  );
  const pz = quantizeUnorm(
    particle.positionM[2], fit.originM[2], fit.extentM[2], POSITION_SIDECAR_MAX,
  );
  const life = quantizeLife(particle.lifeSeconds, fit.lifeMaximumSeconds, LIFE_SIDECAR_MAX);
  const vx = quantizeSnorm(
    particle.velocityMPerS[0] - fit.velocityMeanMPerS[0],
    fit.sidecarVelocityRangeMPerS,
    VELOCITY_SIDECAR_MAX,
  ) & 0x7ff;
  const vy = quantizeSnorm(
    particle.velocityMPerS[1] - fit.velocityMeanMPerS[1],
    fit.sidecarVelocityRangeMPerS,
    VELOCITY_SIDECAR_MAX,
  ) & 0x7ff;
  const vz = quantizeSnorm(
    particle.velocityMPerS[2] - fit.velocityMeanMPerS[2],
    fit.sidecarVelocityRangeMPerS,
    VELOCITY_SIDECAR_MAX,
  ) & 0x7ff;
  return Object.freeze([
    (px | (py << 16)) >>> 0,
    (pz | (life << 16) | ((vx & 1) << 31)) >>> 0,
    (((vx >>> 1) & 0x3ff) | (vy << 10) | (vz << 21)) >>> 0,
  ]);
}

function decodeExceptionRecord(word0, word1, word2, fit) {
  const velocityXBits = ((word1 >>> 31) & 1) | ((word2 & 0x3ff) << 1);
  return Object.freeze({
    positionM: Object.freeze([
      dequantizeUnorm(word0 & 0xffff, fit.originM[0], fit.extentM[0], POSITION_SIDECAR_MAX),
      dequantizeUnorm(word0 >>> 16, fit.originM[1], fit.extentM[1], POSITION_SIDECAR_MAX),
      dequantizeUnorm(word1 & 0xffff, fit.originM[2], fit.extentM[2], POSITION_SIDECAR_MAX),
    ]),
    velocityMPerS: Object.freeze([
      fit.velocityMeanMPerS[0] + dequantizeSnorm(
        velocityXBits, 11, fit.sidecarVelocityRangeMPerS, VELOCITY_SIDECAR_MAX,
      ),
      fit.velocityMeanMPerS[1] + dequantizeSnorm(
        (word2 >>> 10) & 0x7ff, 11, fit.sidecarVelocityRangeMPerS, VELOCITY_SIDECAR_MAX,
      ),
      fit.velocityMeanMPerS[2] + dequantizeSnorm(
        (word2 >>> 21) & 0x7ff, 11, fit.sidecarVelocityRangeMPerS, VELOCITY_SIDECAR_MAX,
      ),
    ]),
    lifeSeconds: dequantizeLife(
      (word1 >>> 16) & 0x7fff,
      fit.lifeMaximumSeconds,
      LIFE_SIDECAR_MAX,
    ),
  });
}

function stateExceedsTolerance(source, decoded, tolerances) {
  return vectorDistance(source.positionM, decoded.positionM) > tolerances.positionToleranceM
    || vectorDistance(source.velocityMPerS, decoded.velocityMPerS)
      > tolerances.velocityToleranceMPerS
    || Math.abs(source.lifeSeconds - decoded.lifeSeconds) > tolerances.lifeToleranceSeconds;
}

function baseVelocityClips(particle, fit) {
  return particle.velocityMPerS.some((value, axis) => (
    Math.abs(value - fit.velocityMeanMPerS[axis]) > fit.baseVelocityRangeMPerS
  ));
}

function immutableMetric(metric) {
  return Object.freeze(metric);
}

/** Calculate final decoded error without assigning simulation authority. */
export function particleStormPageErrorStatistics(sourceParticles, decodedParticles, {
  positionToleranceM = Number.POSITIVE_INFINITY,
  velocityToleranceMPerS = Number.POSITIVE_INFINITY,
  lifeToleranceSeconds = Number.POSITIVE_INFINITY,
} = {}) {
  const positionTolerance = tolerance(positionToleranceM, 'positionToleranceM');
  const velocityTolerance = tolerance(velocityToleranceMPerS, 'velocityToleranceMPerS');
  const lifeTolerance = tolerance(lifeToleranceSeconds, 'lifeToleranceSeconds');
  if (!Array.isArray(sourceParticles) || !Array.isArray(decodedParticles)
      || sourceParticles.length !== decodedParticles.length) {
    throw codecError(
      'PARTICLE_STORM_PAGE_ERROR_INPUT',
      'Source and decoded particle arrays must have the same length',
      { sourceCount: sourceParticles?.length, decodedCount: decodedParticles?.length },
    );
  }
  let maxPosition = 0;
  let maxVelocity = 0;
  let maxLife = 0;
  let sumPosition = 0;
  let sumVelocity = 0;
  let sumLife = 0;
  let sumSquares = 0;
  let positionFailures = 0;
  let velocityFailures = 0;
  let lifeFailures = 0;
  for (let slot = 0; slot < sourceParticles.length; slot += 1) {
    const source = sourceParticles[slot];
    const decoded = decodedParticles[slot];
    const positionError = vectorDistance(source.positionM, decoded.positionM);
    const velocityError = vectorDistance(source.velocityMPerS, decoded.velocityMPerS);
    const lifeError = Math.abs(source.lifeSeconds - decoded.lifeSeconds);
    maxPosition = Math.max(maxPosition, positionError);
    maxVelocity = Math.max(maxVelocity, velocityError);
    maxLife = Math.max(maxLife, lifeError);
    sumPosition += positionError;
    sumVelocity += velocityError;
    sumLife += lifeError;
    sumSquares += positionError * positionError + velocityError * velocityError + lifeError * lifeError;
    if (positionError > positionTolerance) positionFailures += 1;
    if (velocityError > velocityTolerance) velocityFailures += 1;
    if (lifeError > lifeTolerance) lifeFailures += 1;
  }
  const count = sourceParticles.length;
  const failureCount = new Set([
    ...sourceParticles.map((source, slot) => (
      stateExceedsTolerance(source, decodedParticles[slot], {
        positionToleranceM: positionTolerance,
        velocityToleranceMPerS: velocityTolerance,
        lifeToleranceSeconds: lifeTolerance,
      }) ? slot : -1
    )).filter(slot => slot >= 0),
  ]).size;
  return Object.freeze({
    count,
    position: immutableMetric({
      toleranceM: positionTolerance,
      maxVectorErrorM: maxPosition,
      meanVectorErrorM: count > 0 ? sumPosition / count : 0,
      failureCount: positionFailures,
    }),
    velocity: immutableMetric({
      toleranceMPerS: velocityTolerance,
      maxVectorErrorMPerS: maxVelocity,
      meanVectorErrorMPerS: count > 0 ? sumVelocity / count : 0,
      failureCount: velocityFailures,
    }),
    life: immutableMetric({
      toleranceSeconds: lifeTolerance,
      maxAbsoluteErrorSeconds: maxLife,
      meanAbsoluteErrorSeconds: count > 0 ? sumLife / count : 0,
      failureCount: lifeFailures,
    }),
    rmsStateError: count > 0 ? Math.sqrt(sumSquares / (count * 7)) : 0,
    failureCount,
    withinTolerance: failureCount === 0,
  });
}

function fitFromHeader(header) {
  return Object.freeze({
    originM: header.originM,
    extentM: header.extentM,
    lifeMaximumSeconds: header.lifeMaximumSeconds,
    velocityMeanMPerS: header.velocityMeanMPerS,
    baseVelocityRangeMPerS: header.baseVelocityRangeMPerS,
    sidecarVelocityRangeMPerS: header.sidecarVelocityRangeMPerS,
  });
}

function countOneBits32(value) {
  let bits = value >>> 0;
  bits -= (bits >>> 1) & 0x55555555;
  bits = (bits & 0x33333333) + ((bits >>> 2) & 0x33333333);
  return (((bits + (bits >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function exceptionRank(mask, slot) {
  const wordIndex = slot >>> 5;
  const bitIndex = slot & 31;
  let rank = 0;
  for (let index = 0; index < wordIndex; index += 1) rank += countOneBits32(mask[index]);
  const lowerMask = bitIndex === 0 ? 0 : (2 ** bitIndex) - 1;
  return rank + countOneBits32(mask[wordIndex] & lowerMask);
}

function typedPageArrays(encoded) {
  if (!(encoded?.headerWords instanceof Uint32Array)
      || !(encoded?.particleWords instanceof Uint32Array)
      || !(encoded?.exceptionWords instanceof Uint32Array)) {
    throw codecError(
      'PARTICLE_STORM_PAGE_ARRAYS',
      'Encoded page requires Uint32Array headerWords, particleWords, and exceptionWords',
    );
  }
  if (encoded.headerWords.length !== PARTICLE_STORM_PAGE_HEADER_WORDS) {
    throw codecError('PARTICLE_STORM_PAGE_HEADER_LENGTH', 'Page header must be exactly 128 bytes', {
      wordLength: encoded.headerWords.length,
    });
  }
  return encoded;
}

/** Read and validate the fixed 128-byte host/WGSL header. */
export function readParticleStormPageHeader(encoded) {
  const { headerWords } = typedPageArrays(encoded);
  const headerFloats = new Float32Array(
    headerWords.buffer,
    headerWords.byteOffset,
    headerWords.length,
  );
  const pageSize = pageSizeValue(headerWords[HEADER_INDEX.PAGE_SIZE]);
  const particleCount = headerWords[HEADER_INDEX.PARTICLE_COUNT];
  const exceptionCount = headerWords[HEADER_INDEX.EXCEPTION_COUNT];
  if (headerWords[HEADER_INDEX.MAGIC] !== PARTICLE_STORM_PAGE_MAGIC
      || headerWords[HEADER_INDEX.VERSION] !== PARTICLE_STORM_PAGE_CODEC_VERSION) {
    throw codecError('PARTICLE_STORM_PAGE_HEADER_ID', 'Page magic or codec version is invalid');
  }
  if (particleCount > pageSize || exceptionCount > particleCount) {
    throw codecError('PARTICLE_STORM_PAGE_HEADER_COUNT', 'Page counts exceed their capacity', {
      pageSize,
      particleCount,
      exceptionCount,
    });
  }
  const flags = headerWords[HEADER_INDEX.FLAGS];
  if ((flags & REQUIRED_HEADER_FLAGS) !== REQUIRED_HEADER_FLAGS) {
    throw codecError('PARTICLE_STORM_PAGE_HEADER_FLAGS', 'Required page codec flags are absent', { flags });
  }
  const originM = Object.freeze([
    headerFloats[HEADER_INDEX.ORIGIN_X],
    headerFloats[HEADER_INDEX.ORIGIN_Y],
    headerFloats[HEADER_INDEX.ORIGIN_Z],
  ]);
  const extentM = Object.freeze([
    headerFloats[HEADER_INDEX.EXTENT_X],
    headerFloats[HEADER_INDEX.EXTENT_Y],
    headerFloats[HEADER_INDEX.EXTENT_Z],
  ]);
  const velocityMeanMPerS = Object.freeze([
    headerFloats[HEADER_INDEX.VELOCITY_MEAN_X],
    headerFloats[HEADER_INDEX.VELOCITY_MEAN_Y],
    headerFloats[HEADER_INDEX.VELOCITY_MEAN_Z],
  ]);
  const finiteHeaderValues = [
    ...originM,
    ...extentM,
    ...velocityMeanMPerS,
    headerFloats[HEADER_INDEX.LIFE_MAXIMUM],
    headerFloats[HEADER_INDEX.BASE_VELOCITY_RANGE],
    headerFloats[HEADER_INDEX.SIDECAR_VELOCITY_RANGE],
    headerFloats[HEADER_INDEX.MAX_POSITION_ERROR],
    headerFloats[HEADER_INDEX.MAX_VELOCITY_ERROR],
    headerFloats[HEADER_INDEX.MAX_LIFE_ERROR],
    headerFloats[HEADER_INDEX.RMS_STATE_ERROR],
  ];
  if (!finiteHeaderValues.every(Number.isFinite)
      || !extentM.every(value => value > 0)
      || headerFloats[HEADER_INDEX.LIFE_MAXIMUM] <= 0
      || headerFloats[HEADER_INDEX.BASE_VELOCITY_RANGE] <= 0
      || headerFloats[HEADER_INDEX.SIDECAR_VELOCITY_RANGE] <= 0) {
    throw codecError('PARTICLE_STORM_PAGE_HEADER_FLOATS', 'Page header ranges must be finite and positive');
  }
  return Object.freeze({
    format: PARTICLE_STORM_PAGE_CODEC_FORMAT,
    version: headerWords[HEADER_INDEX.VERSION],
    pageSize,
    particleCount,
    exceptionCount,
    pageIndex: headerWords[HEADER_INDEX.PAGE_INDEX],
    generation: headerWords[HEADER_INDEX.GENERATION],
    flags,
    originM,
    extentM,
    lifeMaximumSeconds: headerFloats[HEADER_INDEX.LIFE_MAXIMUM],
    baseVelocityRangeMPerS: headerFloats[HEADER_INDEX.BASE_VELOCITY_RANGE],
    velocityMeanMPerS,
    sidecarVelocityRangeMPerS: headerFloats[HEADER_INDEX.SIDECAR_VELOCITY_RANGE],
    errorBounds: Object.freeze({
      maxPositionErrorM: headerFloats[HEADER_INDEX.MAX_POSITION_ERROR],
      maxVelocityErrorMPerS: headerFloats[HEADER_INDEX.MAX_VELOCITY_ERROR],
      maxLifeErrorSeconds: headerFloats[HEADER_INDEX.MAX_LIFE_ERROR],
      rmsStateError: headerFloats[HEADER_INDEX.RMS_STATE_ERROR],
    }),
    exceptionMask: Object.freeze(Array.from(
      headerWords.subarray(HEADER_INDEX.EXCEPTION_MASK, HEADER_INDEX.EXCEPTION_MASK + 8),
    )),
  });
}

/** Decode one complete page, applying sidecar records in stable slot order. */
export function decodeParticleStormPage(encoded) {
  const page = typedPageArrays(encoded);
  const header = readParticleStormPageHeader(page);
  if (page.particleWords.length !== header.pageSize * PARTICLE_STORM_PAGE_PARTICLE_WORDS) {
    throw codecError('PARTICLE_STORM_PAGE_PARTICLE_LENGTH', 'Packed lane does not match page capacity', {
      expectedWords: header.pageSize * PARTICLE_STORM_PAGE_PARTICLE_WORDS,
      actualWords: page.particleWords.length,
    });
  }
  if (page.exceptionWords.length !== header.exceptionCount * PARTICLE_STORM_PAGE_EXCEPTION_WORDS) {
    throw codecError('PARTICLE_STORM_PAGE_EXCEPTION_LENGTH', 'Sidecar length does not match header count', {
      expectedWords: header.exceptionCount * PARTICLE_STORM_PAGE_EXCEPTION_WORDS,
      actualWords: page.exceptionWords.length,
    });
  }
  if (header.pageSize === 128 && header.exceptionMask.slice(4).some(Boolean)) {
    throw codecError('PARTICLE_STORM_PAGE_MASK_CAPACITY', '128-particle page has out-of-range mask bits');
  }
  const maskCount = header.exceptionMask.reduce((sum, word) => sum + countOneBits32(word), 0);
  if (maskCount !== header.exceptionCount) {
    throw codecError('PARTICLE_STORM_PAGE_MASK_COUNT', 'Header mask popcount differs from exceptionCount', {
      maskCount,
      exceptionCount: header.exceptionCount,
    });
  }
  for (let slot = header.particleCount; slot < header.pageSize; slot += 1) {
    if (((header.exceptionMask[slot >>> 5] >>> (slot & 31)) & 1) !== 0) {
      throw codecError(
        'PARTICLE_STORM_PAGE_MASK_CAPACITY',
        'Header exception mask references an unused page slot',
        { slot, particleCount: header.particleCount },
      );
    }
  }
  const fit = fitFromHeader(header);
  const decoded = new Array(header.particleCount);
  for (let slot = 0; slot < header.particleCount; slot += 1) {
    const word0 = page.particleWords[slot * 2];
    const word1 = page.particleWords[slot * 2 + 1];
    const base = decodeBaseRecord(word0, word1, fit);
    const maskedExceptional = ((header.exceptionMask[slot >>> 5] >>> (slot & 31)) & 1) !== 0;
    if (maskedExceptional !== base.exceptional) {
      throw codecError(
        'PARTICLE_STORM_PAGE_EXCEPTION_MASK',
        `Particle ${slot} exception flag disagrees with the header mask`,
        { slot },
      );
    }
    let state = base;
    let sidecarRank = -1;
    if (base.exceptional) {
      sidecarRank = exceptionRank(header.exceptionMask, slot);
      if (sidecarRank >= header.exceptionCount) {
        throw codecError('PARTICLE_STORM_PAGE_EXCEPTION_RANK', 'Exception rank exceeds sidecar count', {
          slot,
          sidecarRank,
        });
      }
      const offset = sidecarRank * 3;
      const override = decodeExceptionRecord(
        page.exceptionWords[offset],
        page.exceptionWords[offset + 1],
        page.exceptionWords[offset + 2],
        fit,
      );
      state = Object.freeze({
        ...override,
        active: base.active,
        exceptional: true,
      });
    }
    decoded[slot] = Object.freeze({ ...state, slot, sidecarRank });
  }
  return Object.freeze(decoded);
}

function normalizeSourceParticles(particles, pageSize, options) {
  if (!Array.isArray(particles)) {
    throw codecError('PARTICLE_STORM_PAGE_INPUT', 'Particle page input must be an array');
  }
  if (particles.length > pageSize) {
    throw codecError('PARTICLE_STORM_PAGE_CAPACITY', 'Particle count exceeds page capacity', {
      pageSize,
      particleCount: particles.length,
    });
  }
  const forcedSlots = forcedSlotSet(options.forcedExceptionSlots, particles.length);
  return Object.freeze(particles.map((particle, slot) => normalizeParticle(particle, slot, forcedSlots)));
}

function createHeaderWords({
  pageSize,
  particleCount,
  exceptionCount,
  pageIndex,
  generation,
  fit,
  exceptionMask,
  errors,
}) {
  const headerWords = new Uint32Array(PARTICLE_STORM_PAGE_HEADER_WORDS);
  const headerFloats = new Float32Array(headerWords.buffer);
  headerWords[HEADER_INDEX.MAGIC] = PARTICLE_STORM_PAGE_MAGIC;
  headerWords[HEADER_INDEX.VERSION] = PARTICLE_STORM_PAGE_CODEC_VERSION;
  headerWords[HEADER_INDEX.PAGE_SIZE] = pageSize;
  headerWords[HEADER_INDEX.PARTICLE_COUNT] = particleCount;
  headerWords[HEADER_INDEX.EXCEPTION_COUNT] = exceptionCount;
  headerWords[HEADER_INDEX.PAGE_INDEX] = pageIndex;
  headerWords[HEADER_INDEX.GENERATION] = generation;
  headerWords[HEADER_INDEX.FLAGS] = REQUIRED_HEADER_FLAGS
    | (errors.withinTolerance ? PARTICLE_STORM_PAGE_FLAGS.TOLERANCE_VALIDATED : 0);
  headerFloats[HEADER_INDEX.ORIGIN_X] = fit.originM[0];
  headerFloats[HEADER_INDEX.ORIGIN_Y] = fit.originM[1];
  headerFloats[HEADER_INDEX.ORIGIN_Z] = fit.originM[2];
  headerFloats[HEADER_INDEX.LIFE_MAXIMUM] = fit.lifeMaximumSeconds;
  headerFloats[HEADER_INDEX.EXTENT_X] = fit.extentM[0];
  headerFloats[HEADER_INDEX.EXTENT_Y] = fit.extentM[1];
  headerFloats[HEADER_INDEX.EXTENT_Z] = fit.extentM[2];
  headerFloats[HEADER_INDEX.BASE_VELOCITY_RANGE] = fit.baseVelocityRangeMPerS;
  headerFloats[HEADER_INDEX.VELOCITY_MEAN_X] = fit.velocityMeanMPerS[0];
  headerFloats[HEADER_INDEX.VELOCITY_MEAN_Y] = fit.velocityMeanMPerS[1];
  headerFloats[HEADER_INDEX.VELOCITY_MEAN_Z] = fit.velocityMeanMPerS[2];
  headerFloats[HEADER_INDEX.SIDECAR_VELOCITY_RANGE] = fit.sidecarVelocityRangeMPerS;
  headerFloats[HEADER_INDEX.MAX_POSITION_ERROR] = errors.position.maxVectorErrorM;
  headerFloats[HEADER_INDEX.MAX_VELOCITY_ERROR] = errors.velocity.maxVectorErrorMPerS;
  headerFloats[HEADER_INDEX.MAX_LIFE_ERROR] = errors.life.maxAbsoluteErrorSeconds;
  headerFloats[HEADER_INDEX.RMS_STATE_ERROR] = errors.rmsStateError;
  headerWords.set(exceptionMask, HEADER_INDEX.EXCEPTION_MASK);
  return headerWords;
}

function encodeWords(particles, exceptional, fit, pageSize) {
  const particleWords = new Uint32Array(pageSize * PARTICLE_STORM_PAGE_PARTICLE_WORDS);
  const exceptionCount = exceptional.reduce((sum, value) => sum + (value ? 1 : 0), 0);
  const exceptionWords = new Uint32Array(exceptionCount * PARTICLE_STORM_PAGE_EXCEPTION_WORDS);
  const exceptionMask = new Uint32Array(8);
  let exceptionIndex = 0;
  for (let slot = 0; slot < particles.length; slot += 1) {
    const base = packBaseRecord(particles[slot], fit, exceptional[slot]);
    particleWords[slot * 2] = base[0];
    particleWords[slot * 2 + 1] = base[1];
    if (!exceptional[slot]) continue;
    exceptionMask[slot >>> 5] |= (1 << (slot & 31)) >>> 0;
    const override = packExceptionRecord(particles[slot], fit);
    exceptionWords.set(override, exceptionIndex * PARTICLE_STORM_PAGE_EXCEPTION_WORDS);
    exceptionIndex += 1;
  }
  return Object.freeze({ particleWords, exceptionWords, exceptionMask });
}

function provisionalDecoded(particles, exceptional, fit) {
  return particles.map((particle, slot) => {
    const baseWords = packBaseRecord(particle, fit, exceptional[slot]);
    const base = decodeBaseRecord(baseWords[0], baseWords[1], fit);
    if (!exceptional[slot]) return base;
    const override = packExceptionRecord(particle, fit);
    return Object.freeze({
      ...decodeExceptionRecord(override[0], override[1], override[2], fit),
      active: base.active,
      exceptional: true,
    });
  });
}

/**
 * Encode up to 128 or 256 particles into a fixed-capacity random-access page.
 * Finite tolerances promote failing base records into the 12-byte sidecar.
 */
export function encodeParticleStormPage(particles, options = {}) {
  const pageSize = pageSizeValue(options.pageSize);
  const normalized = normalizeSourceParticles(particles, pageSize, options);
  const pageIndex = uint32(options.pageIndex, 'pageIndex');
  const generation = uint32(options.generation, 'generation');
  const tolerances = Object.freeze({
    positionToleranceM: tolerance(options.positionToleranceM, 'positionToleranceM'),
    velocityToleranceMPerS: tolerance(options.velocityToleranceMPerS, 'velocityToleranceMPerS'),
    lifeToleranceSeconds: tolerance(options.lifeToleranceSeconds, 'lifeToleranceSeconds'),
  });
  const exceptional = normalized.map(particle => particle.forcedException);
  let fit = fitPage(normalized, exceptional, options);
  let changed = true;
  let iteration = 0;
  while (changed && iteration <= normalized.length) {
    changed = false;
    for (let slot = 0; slot < normalized.length; slot += 1) {
      if (exceptional[slot]) continue;
      const words = packBaseRecord(normalized[slot], fit, false);
      const decoded = decodeBaseRecord(words[0], words[1], fit);
      if (baseVelocityClips(normalized[slot], fit)
          || stateExceedsTolerance(normalized[slot], decoded, tolerances)) {
        exceptional[slot] = true;
        changed = true;
      }
    }
    if (changed) fit = fitPage(normalized, exceptional, options);
    iteration += 1;
  }
  const exceptionCount = exceptional.reduce((sum, value) => sum + (value ? 1 : 0), 0);
  const maximumExceptions = options.maximumExceptions == null
    ? pageSize
    : uint32(options.maximumExceptions, 'maximumExceptions');
  if (maximumExceptions > pageSize || exceptionCount > maximumExceptions) {
    throw codecError(
      'PARTICLE_STORM_PAGE_EXCEPTION_CAPACITY',
      'Page exception count exceeds the configured sidecar capacity',
      { exceptionCount, maximumExceptions, pageSize },
    );
  }
  fit = fitPage(normalized, exceptional, options);
  const words = encodeWords(normalized, exceptional, fit, pageSize);
  const decoded = provisionalDecoded(normalized, exceptional, fit);
  const errors = particleStormPageErrorStatistics(normalized, decoded, tolerances);
  if (options.rejectUnmetTolerance !== false && !errors.withinTolerance) {
    throw codecError(
      'PARTICLE_STORM_PAGE_TOLERANCE_UNMET',
      'The 12-byte exception sidecar cannot satisfy the requested error tolerance',
      { errors, exceptionCount },
    );
  }
  const headerWords = createHeaderWords({
    pageSize,
    particleCount: normalized.length,
    exceptionCount,
    pageIndex,
    generation,
    fit,
    exceptionMask: words.exceptionMask,
    errors,
  });
  const forcedExceptionCount = normalized.reduce(
    (sum, particle) => sum + (particle.forcedException ? 1 : 0),
    0,
  );
  const residentBytes = PARTICLE_STORM_PAGE_HEADER_BYTES
    + words.particleWords.byteLength + words.exceptionWords.byteLength;
  const stats = Object.freeze({
    pageSize,
    particleCount: normalized.length,
    exceptionCount,
    forcedExceptionCount,
    automaticExceptionCount: exceptionCount - forcedExceptionCount,
    exceptionRatio: normalized.length > 0 ? exceptionCount / normalized.length : 0,
    headerBytes: PARTICLE_STORM_PAGE_HEADER_BYTES,
    packedParticleBytes: words.particleWords.byteLength,
    exceptionBytes: words.exceptionWords.byteLength,
    residentBytes,
    bytesPerStoredParticle: normalized.length > 0 ? residentBytes / normalized.length : 0,
    errors,
  });
  return Object.freeze({
    format: PARTICLE_STORM_PAGE_CODEC_FORMAT,
    headerWords,
    particleWords: words.particleWords,
    exceptionWords: words.exceptionWords,
    stats,
  });
}

function normalizeValidationSources(sourceParticles, pageSize) {
  if (sourceParticles == null) return null;
  return normalizeSourceParticles(sourceParticles, pageSize, {});
}

/** Validate ABI structure, mask/sidecar agreement, and optional source error. */
export function validateParticleStormPage(encoded, {
  sourceParticles = null,
  positionToleranceM = Number.POSITIVE_INFINITY,
  velocityToleranceMPerS = Number.POSITIVE_INFINITY,
  lifeToleranceSeconds = Number.POSITIVE_INFINITY,
} = {}) {
  try {
    const header = readParticleStormPageHeader(encoded);
    const decoded = decodeParticleStormPage(encoded);
    const maskCount = header.exceptionMask.reduce((sum, word) => sum + countOneBits32(word), 0);
    if (maskCount !== header.exceptionCount) {
      throw codecError('PARTICLE_STORM_PAGE_MASK_COUNT', 'Header mask popcount differs from exceptionCount', {
        maskCount,
        exceptionCount: header.exceptionCount,
      });
    }
    if (header.pageSize === 128 && header.exceptionMask.slice(4).some(Boolean)) {
      throw codecError('PARTICLE_STORM_PAGE_MASK_CAPACITY', '128-particle page has out-of-range mask bits');
    }
    const source = normalizeValidationSources(sourceParticles, header.pageSize);
    if (source && source.length !== header.particleCount) {
      throw codecError('PARTICLE_STORM_PAGE_SOURCE_COUNT', 'Validation source count differs from header', {
        sourceCount: source.length,
        particleCount: header.particleCount,
      });
    }
    const errors = source ? particleStormPageErrorStatistics(source, decoded, {
      positionToleranceM,
      velocityToleranceMPerS,
      lifeToleranceSeconds,
    }) : null;
    return Object.freeze({
      valid: errors?.withinTolerance !== false,
      format: header.format,
      pageIndex: header.pageIndex,
      generation: header.generation,
      pageSize: header.pageSize,
      particleCount: header.particleCount,
      exceptionCount: header.exceptionCount,
      maskCount,
      errors,
      message: errors?.withinTolerance === false ? 'Decoded page exceeds validation tolerance' : '',
    });
  } catch (error) {
    return Object.freeze({
      valid: false,
      code: error?.code ?? 'PARTICLE_STORM_PAGE_VALIDATION',
      message: error?.message ?? String(error),
    });
  }
}

function hashWords(hash, words) {
  let next = hash >>> 0;
  for (const word of words) {
    for (let shift = 0; shift < 32; shift += 8) {
      next ^= (word >>> shift) & 0xff;
      next = Math.imul(next, 0x01000193) >>> 0;
    }
  }
  return next;
}

/** Stable FNV-1a fingerprint over all resident codec words. */
export function particleStormPageFingerprint(encoded) {
  const page = typedPageArrays(encoded);
  let hash = 0x811c9dc5;
  hash = hashWords(hash, page.headerWords);
  hash = hashWords(hash, page.particleWords);
  hash = hashWords(hash, page.exceptionWords);
  return hash.toString(16).padStart(8, '0');
}

function equalWords(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/** Encode twice and prove byte-for-byte deterministic output. */
export function validateParticleStormPageDeterminism(particles, options = {}) {
  try {
    const first = encodeParticleStormPage(particles, options);
    const second = encodeParticleStormPage(particles, options);
    const headerEqual = equalWords(first.headerWords, second.headerWords);
    const particlesEqual = equalWords(first.particleWords, second.particleWords);
    const exceptionsEqual = equalWords(first.exceptionWords, second.exceptionWords);
    const firstFingerprint = particleStormPageFingerprint(first);
    const secondFingerprint = particleStormPageFingerprint(second);
    return Object.freeze({
      valid: headerEqual && particlesEqual && exceptionsEqual
        && firstFingerprint === secondFingerprint,
      headerEqual,
      particlesEqual,
      exceptionsEqual,
      firstFingerprint,
      secondFingerprint,
    });
  } catch (error) {
    return Object.freeze({
      valid: false,
      code: error?.code ?? 'PARTICLE_STORM_PAGE_DETERMINISM',
      message: error?.message ?? String(error),
    });
  }
}

// This chunk is binding-free by design. Callers can embed it in compute,
// vertex, or fragment modules and retain ownership of their buffer bindings.
export const PARTICLE_STORM_PAGE_CODEC_WGSL = /* wgsl */ `
struct ParticleStormPageHeader {
  magic: u32,
  version: u32,
  pageSize: u32,
  particleCount: u32,
  exceptionCount: u32,
  pageIndex: u32,
  generation: u32,
  flags: u32,
  originLifeMaximum: vec4f,
  extentBaseVelocityRange: vec4f,
  velocityMeanSidecarRange: vec4f,
  errorBounds: vec4f,
  exceptionMaskLow: vec4u,
  exceptionMaskHigh: vec4u,
}

struct ParticleStormPageState {
  word0: u32,
  word1: u32,
}

struct ParticleStormPageException {
  word0: u32,
  word1: u32,
  word2: u32,
}

struct ParticleStormPageDecodedState {
  positionLife: vec4f,
  velocity: vec4f,
  flags: u32,
}

fn particleStormPageSigned(bits: u32, signBit: u32, modulus: i32) -> i32 {
  return select(i32(bits), i32(bits) - modulus, (bits & signBit) != 0u);
}

fn particleStormPageExceptionMaskWord(header: ParticleStormPageHeader, index: u32) -> u32 {
  if (index < 4u) { return header.exceptionMaskLow[index]; }
  return header.exceptionMaskHigh[index - 4u];
}

fn particleStormPageExceptionRank(header: ParticleStormPageHeader, slot: u32) -> u32 {
  if (slot >= min(header.pageSize, 256u)) { return header.exceptionCount; }
  let wordIndex = slot >> 5u;
  let bitIndex = slot & 31u;
  var rank = 0u;
  for (var index = 0u; index < 8u; index += 1u) {
    if (index >= wordIndex) { break; }
    rank += countOneBits(particleStormPageExceptionMaskWord(header, index));
  }
  let lowerMask = select(0u, (1u << bitIndex) - 1u, bitIndex != 0u);
  return rank + countOneBits(
    particleStormPageExceptionMaskWord(header, wordIndex) & lowerMask
  );
}

fn particleStormPagePackUnorm(value: f32, maximum: u32) -> u32 {
  return u32(round(clamp(value, 0.0, 1.0) * f32(maximum)));
}

fn particleStormPagePackSnorm(value: f32, range: f32, maximum: i32) -> u32 {
  let quantized = i32(round(clamp(value / range, -1.0, 1.0) * f32(maximum)));
  return bitcast<u32>(quantized) & u32(maximum * 2 + 1);
}

fn particleStormPageEncodeBase(
  header: ParticleStormPageHeader,
  positionLife: vec4f,
  velocity: vec3f,
  isActive: bool,
  isExceptional: bool,
) -> ParticleStormPageState {
  let positionUnit = clamp(
    (positionLife.xyz - header.originLifeMaximum.xyz)
      / header.extentBaseVelocityRange.xyz,
    vec3f(0.0),
    vec3f(1.0)
  );
  let positionBits = vec3u(
    particleStormPagePackUnorm(positionUnit.x, 1023u),
    particleStormPagePackUnorm(positionUnit.y, 1023u),
    particleStormPagePackUnorm(positionUnit.z, 1023u)
  );
  let velocityResidual = velocity - header.velocityMeanSidecarRange.xyz;
  let velocityBits = vec3u(
    particleStormPagePackSnorm(velocityResidual.x, header.extentBaseVelocityRange.w, 127),
    particleStormPagePackSnorm(velocityResidual.y, header.extentBaseVelocityRange.w, 127),
    particleStormPagePackSnorm(velocityResidual.z, header.extentBaseVelocityRange.w, 127)
  );
  let lifeBits = particleStormPagePackUnorm(
    positionLife.w / header.originLifeMaximum.w,
    255u
  );
  let word0 = positionBits.x | (positionBits.y << 10u) | (positionBits.z << 20u)
    | select(0u, 1u << 30u, isActive) | select(0u, 1u << 31u, isExceptional);
  let word1 = velocityBits.x | (velocityBits.y << 8u) | (velocityBits.z << 16u)
    | (lifeBits << 24u);
  return ParticleStormPageState(word0, word1);
}

fn particleStormPageEncodeException(
  header: ParticleStormPageHeader,
  positionLife: vec4f,
  velocity: vec3f,
) -> ParticleStormPageException {
  let positionUnit = clamp(
    (positionLife.xyz - header.originLifeMaximum.xyz)
      / header.extentBaseVelocityRange.xyz,
    vec3f(0.0),
    vec3f(1.0)
  );
  let positionBits = vec3u(
    particleStormPagePackUnorm(positionUnit.x, 65535u),
    particleStormPagePackUnorm(positionUnit.y, 65535u),
    particleStormPagePackUnorm(positionUnit.z, 65535u)
  );
  let velocityResidual = velocity - header.velocityMeanSidecarRange.xyz;
  let velocityBits = vec3u(
    particleStormPagePackSnorm(velocityResidual.x, header.velocityMeanSidecarRange.w, 1023),
    particleStormPagePackSnorm(velocityResidual.y, header.velocityMeanSidecarRange.w, 1023),
    particleStormPagePackSnorm(velocityResidual.z, header.velocityMeanSidecarRange.w, 1023)
  );
  let lifeBits = particleStormPagePackUnorm(
    positionLife.w / header.originLifeMaximum.w,
    32767u
  );
  return ParticleStormPageException(
    positionBits.x | (positionBits.y << 16u),
    positionBits.z | (lifeBits << 16u) | ((velocityBits.x & 1u) << 31u),
    ((velocityBits.x >> 1u) & 1023u) | (velocityBits.y << 10u)
      | (velocityBits.z << 21u)
  );
}

fn particleStormPageDecodeBase(
  header: ParticleStormPageHeader,
  state: ParticleStormPageState,
) -> ParticleStormPageDecodedState {
  let positionUnit = vec3f(
    f32(state.word0 & 1023u),
    f32((state.word0 >> 10u) & 1023u),
    f32((state.word0 >> 20u) & 1023u)
  ) / 1023.0;
  let velocityBits = vec3u(
    state.word1 & 255u,
    (state.word1 >> 8u) & 255u,
    (state.word1 >> 16u) & 255u
  );
  let velocityResidual = vec3f(
    f32(particleStormPageSigned(velocityBits.x, 128u, 256)),
    f32(particleStormPageSigned(velocityBits.y, 128u, 256)),
    f32(particleStormPageSigned(velocityBits.z, 128u, 256))
  ) * (header.extentBaseVelocityRange.w / 127.0);
  let position = header.originLifeMaximum.xyz
    + positionUnit * header.extentBaseVelocityRange.xyz;
  let life = f32(state.word1 >> 24u) * (header.originLifeMaximum.w / 255.0);
  return ParticleStormPageDecodedState(
    vec4f(position, life),
    vec4f(header.velocityMeanSidecarRange.xyz + velocityResidual, 0.0),
    state.word0 >> 30u
  );
}

fn particleStormPageDecodeException(
  header: ParticleStormPageHeader,
  state: ParticleStormPageState,
  overrideState: ParticleStormPageException,
) -> ParticleStormPageDecodedState {
  let positionUnit = vec3f(
    f32(overrideState.word0 & 65535u),
    f32(overrideState.word0 >> 16u),
    f32(overrideState.word1 & 65535u)
  ) / 65535.0;
  let velocityXBits = ((overrideState.word1 >> 31u) & 1u)
    | ((overrideState.word2 & 1023u) << 1u);
  let velocityBits = vec3u(
    velocityXBits,
    (overrideState.word2 >> 10u) & 2047u,
    (overrideState.word2 >> 21u) & 2047u
  );
  let velocityResidual = vec3f(
    f32(particleStormPageSigned(velocityBits.x, 1024u, 2048)),
    f32(particleStormPageSigned(velocityBits.y, 1024u, 2048)),
    f32(particleStormPageSigned(velocityBits.z, 1024u, 2048))
  ) * (header.velocityMeanSidecarRange.w / 1023.0);
  let position = header.originLifeMaximum.xyz
    + positionUnit * header.extentBaseVelocityRange.xyz;
  let lifeBits = (overrideState.word1 >> 16u) & 32767u;
  let life = f32(lifeBits) * (header.originLifeMaximum.w / 32767.0);
  return ParticleStormPageDecodedState(
    vec4f(position, life),
    vec4f(header.velocityMeanSidecarRange.xyz + velocityResidual, 0.0),
    state.word0 >> 30u
  );
}
`;

// Engine-generic names preserve the established Particle Storm wire ABI while
// allowing any particle solver or renderer to share the same page codec.
export const PARTICLE_KINEMATICS_PAGE_CODEC_FORMAT = PARTICLE_STORM_PAGE_CODEC_FORMAT;
export const PARTICLE_KINEMATICS_PAGE_CODEC_VERSION = PARTICLE_STORM_PAGE_CODEC_VERSION;
export const PARTICLE_KINEMATICS_PAGE_MAGIC = PARTICLE_STORM_PAGE_MAGIC;
export const PARTICLE_KINEMATICS_PAGE_SIZES = PARTICLE_STORM_PAGE_SIZES;
export const PARTICLE_KINEMATICS_PAGE_HEADER_WORDS = PARTICLE_STORM_PAGE_HEADER_WORDS;
export const PARTICLE_KINEMATICS_PAGE_HEADER_BYTES = PARTICLE_STORM_PAGE_HEADER_BYTES;
export const PARTICLE_KINEMATICS_PAGE_PARTICLE_WORDS = PARTICLE_STORM_PAGE_PARTICLE_WORDS;
export const PARTICLE_KINEMATICS_PAGE_PARTICLE_BYTES = PARTICLE_STORM_PAGE_PARTICLE_BYTES;
export const PARTICLE_KINEMATICS_PAGE_EXCEPTION_WORDS = PARTICLE_STORM_PAGE_EXCEPTION_WORDS;
export const PARTICLE_KINEMATICS_PAGE_EXCEPTION_BYTES = PARTICLE_STORM_PAGE_EXCEPTION_BYTES;
export const PARTICLE_KINEMATICS_PAGE_FLAGS = PARTICLE_STORM_PAGE_FLAGS;
export const PARTICLE_KINEMATICS_PAGE_HEADER_SCHEMA = PARTICLE_STORM_PAGE_HEADER_SCHEMA;
export const PARTICLE_KINEMATICS_PAGE_RECORD_SCHEMA = PARTICLE_STORM_PAGE_RECORD_SCHEMA;
export const PARTICLE_KINEMATICS_PAGE_EXCEPTION_SCHEMA = PARTICLE_STORM_PAGE_EXCEPTION_SCHEMA;
export const particleKinematicsPageErrorStatistics = particleStormPageErrorStatistics;
export const readParticleKinematicsPageHeader = readParticleStormPageHeader;
export const decodeParticleKinematicsPage = decodeParticleStormPage;
export const encodeParticleKinematicsPage = encodeParticleStormPage;
export const validateParticleKinematicsPage = validateParticleStormPage;
export const particleKinematicsPageFingerprint = particleStormPageFingerprint;
export const validateParticleKinematicsPageDeterminism = validateParticleStormPageDeterminism;
export const PARTICLE_KINEMATICS_PAGE_CODEC_WGSL = PARTICLE_STORM_PAGE_CODEC_WGSL;
export { ParticleStormPageCodecError as ParticleKinematicsPageCodecError };
