// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// RobustNumericMath.js - floating-point policy, stable sums, cancellation, and filtered predicates.

export const FLOAT64_SIGNIFICAND_BITS = 52;
export const FLOAT64_MIN_NORMAL = 2 ** -1022;
export const FLOAT64_MAX_FINITE = Number.MAX_VALUE;
export const FLOAT64_EPSILON = Number.EPSILON;

const FLOAT64_SIGN_MASK = 0x8000000000000000n;
const FLOAT64_FULL_MASK = 0xffffffffffffffffn;
const FLOAT64_BUFFER = new ArrayBuffer(8);
const FLOAT64_VIEW = new DataView(FLOAT64_BUFFER);

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function arrayLikeNumbers(values) {
  if (!values || typeof values.length !== 'number') {
    return {
      valid: false,
      error: 'values must be array-like',
      count: 0,
      finiteValues: [],
      finiteCount: 0,
      nonFiniteCount: 0,
      nanCount: 0,
      infiniteCount: 0,
    };
  }

  const length = Math.max(0, Math.trunc(values.length));
  const finiteValues = [];
  let nonFiniteCount = 0;
  let nanCount = 0;
  let infiniteCount = 0;

  for (let i = 0; i < length; i++) {
    const value = Number(values[i]);
    if (Number.isFinite(value)) {
      finiteValues.push(value);
    } else {
      nonFiniteCount += 1;
      if (Number.isNaN(value)) nanCount += 1;
      else infiniteCount += 1;
    }
  }

  return {
    valid: nonFiniteCount === 0,
    error: nonFiniteCount === 0 ? '' : 'values contain non-finite numbers',
    count: length,
    finiteValues,
    finiteCount: finiteValues.length,
    nonFiniteCount,
    nanCount,
    infiniteCount,
  };
}

function point2(value, name) {
  const x = Array.isArray(value) || ArrayBuffer.isView(value) ? Number(value[0]) : Number(value?.x);
  const y = Array.isArray(value) || ArrayBuffer.isView(value) ? Number(value[1]) : Number(value?.y);
  return {
    name,
    x,
    y,
    finite: Number.isFinite(x) && Number.isFinite(y),
  };
}

function riskFromLostBits(lostBits) {
  if (!Number.isFinite(lostBits)) return 'high';
  if (lostBits >= 40) return 'high';
  if (lostBits >= 24) return 'medium';
  if (lostBits >= 8) return 'low';
  return 'none';
}

function stableConditionNumber(absoluteSum, sum) {
  if (absoluteSum === 0) return 0;
  const magnitude = Math.abs(sum);
  return magnitude === 0 ? Infinity : absoluteSum / magnitude;
}

export function float64Bits(value) {
  FLOAT64_VIEW.setFloat64(0, Number(value), false);
  return FLOAT64_VIEW.getBigUint64(0, false);
}

export function float64FromBits(bits) {
  FLOAT64_VIEW.setBigUint64(0, BigInt(bits), false);
  return FLOAT64_VIEW.getFloat64(0, false);
}

export function float64Classify(value) {
  const number = Number(value);
  const nan = Number.isNaN(number);
  const finite = Number.isFinite(number);
  const infinite = number === Infinity || number === -Infinity;
  const positiveInfinity = number === Infinity;
  const negativeInfinity = number === -Infinity;
  const negativeZero = Object.is(number, -0);
  const zero = number === 0;
  const abs = Math.abs(number);
  const subnormal = finite && !zero && abs < FLOAT64_MIN_NORMAL;
  const normal = finite && !zero && !subnormal;
  const sign = nan ? 0 : (negativeZero || number < 0 || negativeInfinity ? -1 : 1);

  return {
    value: number,
    inputType: typeof value,
    type: nan ? 'nan' : (infinite ? 'infinity' : (zero ? 'zero' : (subnormal ? 'subnormal' : 'normal'))),
    finite,
    nan,
    infinite,
    positiveInfinity,
    negativeInfinity,
    zero,
    negativeZero,
    subnormal,
    normal,
    sign,
    abs: finite ? abs : Infinity,
  };
}

export function float64NextAfter(value, direction) {
  const number = Number(value);
  const target = Number(direction);
  if (Number.isNaN(number) || Number.isNaN(target)) return Number.NaN;
  if (Object.is(number, target) || number === target) return target;
  if (number === 0) return target > 0 ? Number.MIN_VALUE : -Number.MIN_VALUE;
  if (number === Infinity) return FLOAT64_MAX_FINITE;
  if (number === -Infinity) return -FLOAT64_MAX_FINITE;

  let bits = float64Bits(number);
  if ((target > number) === (number > 0)) bits += 1n;
  else bits -= 1n;
  return float64FromBits(bits);
}

export function float64Ulp(value) {
  const number = Number(value);
  if (Number.isNaN(number)) return Number.NaN;
  if (!Number.isFinite(number)) return Infinity;
  if (number === 0) return Number.MIN_VALUE;
  const next = float64NextAfter(number, number > 0 ? Infinity : -Infinity);
  return Math.abs(next - number);
}

export function float64UlpDistance(left, right) {
  const a = Number(left);
  const b = Number(right);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  if (a === 0 && b === 0) return 0n;
  if (Object.is(a, b) || a === b) return 0n;

  const ordered = (value) => {
    const bits = float64Bits(value);
    return (bits & FLOAT64_SIGN_MASK) === 0n ? bits | FLOAT64_SIGN_MASK : (~bits) & FLOAT64_FULL_MASK;
  };
  const oa = ordered(a);
  const ob = ordered(b);
  return oa >= ob ? oa - ob : ob - oa;
}

export function compensatedSum(values) {
  const meta = arrayLikeNumbers(values);
  let sum = 0;
  let compensation = 0;
  let absoluteSum = 0;

  for (const value of meta.finiteValues) {
    const next = sum + value;
    if (Math.abs(sum) >= Math.abs(value)) {
      compensation += (sum - next) + value;
    } else {
      compensation += (value - next) + sum;
    }
    sum = next;
    absoluteSum += Math.abs(value);
  }

  return {
    valid: meta.valid,
    count: meta.count,
    finiteCount: meta.finiteCount,
    nonFiniteCount: meta.nonFiniteCount,
    nanCount: meta.nanCount,
    infiniteCount: meta.infiniteCount,
    rawSum: sum,
    compensation,
    sum: sum + compensation,
    absoluteSum,
  };
}

export function pairwiseSum(values) {
  const meta = arrayLikeNumbers(values);
  let work = meta.finiteValues.slice();
  let absoluteSum = 0;
  for (const value of work) absoluteSum += Math.abs(value);

  if (work.length === 0) {
    return {
      valid: meta.valid,
      count: meta.count,
      finiteCount: meta.finiteCount,
      nonFiniteCount: meta.nonFiniteCount,
      nanCount: meta.nanCount,
      infiniteCount: meta.infiniteCount,
      sum: 0,
      absoluteSum,
      passes: 0,
    };
  }

  let length = work.length;
  let passes = 0;
  while (length > 1) {
    let write = 0;
    for (let read = 0; read < length; read += 2) {
      work[write++] = read + 1 < length ? work[read] + work[read + 1] : work[read];
    }
    length = write;
    passes += 1;
  }

  return {
    valid: meta.valid,
    count: meta.count,
    finiteCount: meta.finiteCount,
    nonFiniteCount: meta.nonFiniteCount,
    nanCount: meta.nanCount,
    infiniteCount: meta.infiniteCount,
    sum: work[0],
    absoluteSum,
    passes,
  };
}

export function stableSumReport(values) {
  const meta = arrayLikeNumbers(values);
  let naiveSum = 0;
  let absoluteSum = 0;
  for (const value of meta.finiteValues) {
    naiveSum += value;
    absoluteSum += Math.abs(value);
  }

  const compensated = compensatedSum(values);
  const pairwise = pairwiseSum(values);
  const stableSum = compensated.sum;
  const conditionNumber = stableConditionNumber(absoluteSum, stableSum);
  const cancellationBits = absoluteSum > 0 && Math.abs(stableSum) > 0
    ? Math.max(0, Math.log2(conditionNumber))
    : (absoluteSum > 0 ? Infinity : 0);

  return {
    valid: meta.valid,
    count: meta.count,
    finiteCount: meta.finiteCount,
    nonFiniteCount: meta.nonFiniteCount,
    nanCount: meta.nanCount,
    infiniteCount: meta.infiniteCount,
    naiveSum,
    compensatedSum: stableSum,
    compensation: compensated.compensation,
    pairwiseSum: pairwise.sum,
    stableSum,
    absoluteSum,
    conditionNumber,
    cancellationBits,
    cancellationRisk: meta.valid ? riskFromLostBits(cancellationBits) : 'invalid',
    naiveErrorEstimate: Math.abs(naiveSum - stableSum),
    pairwiseErrorEstimate: Math.abs(pairwise.sum - stableSum),
  };
}

export function cancellationReport(left, right, operation = 'subtract') {
  const a = Number(left);
  const b = Number(right);
  const mode = operation === 'add' ? 'add' : 'subtract';
  const finite = Number.isFinite(a) && Number.isFinite(b);
  const result = mode === 'add' ? a + b : a - b;
  const inputMagnitude = Math.max(Math.abs(a), Math.abs(b));
  const resultMagnitude = Math.abs(result);
  const relativeGap = inputMagnitude > 0 ? resultMagnitude / inputMagnitude : 0;
  const lostBits = inputMagnitude > 0 && resultMagnitude > 0
    ? Math.max(0, Math.log2(inputMagnitude / resultMagnitude))
    : (inputMagnitude > 0 ? Infinity : 0);

  return {
    valid: finite && Number.isFinite(result),
    operation: mode,
    left: a,
    right: b,
    result,
    inputMagnitude,
    resultMagnitude,
    relativeGap,
    lostBits,
    risk: finite ? riskFromLostBits(lostBits) : 'invalid',
    resultUlp: float64Ulp(result),
  };
}

export function orientation2DReport(a, b, c, options = {}) {
  const pa = point2(a, 'a');
  const pb = point2(b, 'b');
  const pc = point2(c, 'c');
  const finite = pa.finite && pb.finite && pc.finite;
  const abx = pb.x - pa.x;
  const aby = pb.y - pa.y;
  const acx = pc.x - pa.x;
  const acy = pc.y - pa.y;
  const determinant = abx * acy - aby * acx;
  const errorMultiplier = Math.max(1, finiteNumber(options.errorMultiplier, 8));
  const errorBound = (Math.abs(abx * acy) + Math.abs(aby * acx)) * FLOAT64_EPSILON * errorMultiplier;
  const rawOrientation = determinant > 0 ? 1 : (determinant < 0 ? -1 : 0);
  const stable = finite && Math.abs(determinant) > errorBound;
  const orientation = stable ? rawOrientation : 0;

  return {
    valid: finite,
    points: { a: pa, b: pb, c: pc },
    determinant,
    errorBound,
    errorMultiplier,
    rawOrientation,
    orientation,
    stable,
    nearZero: finite && !stable,
    classification: !finite
      ? 'invalid'
      : (stable ? (rawOrientation > 0 ? 'counter-clockwise' : 'clockwise') : 'near-collinear'),
  };
}

export function robustNumericPolicyReport(values) {
  const meta = arrayLikeNumbers(values);
  const counts = {
    finite: 0,
    nan: 0,
    infinite: 0,
    positiveInfinity: 0,
    negativeInfinity: 0,
    zero: 0,
    negativeZero: 0,
    subnormal: 0,
    normal: 0,
  };

  if (values && typeof values.length === 'number') {
    for (let i = 0; i < Math.max(0, Math.trunc(values.length)); i++) {
      const classification = float64Classify(values[i]);
      if (classification.finite) counts.finite += 1;
      if (classification.nan) counts.nan += 1;
      if (classification.infinite) counts.infinite += 1;
      if (classification.positiveInfinity) counts.positiveInfinity += 1;
      if (classification.negativeInfinity) counts.negativeInfinity += 1;
      if (classification.zero) counts.zero += 1;
      if (classification.negativeZero) counts.negativeZero += 1;
      if (classification.subnormal) counts.subnormal += 1;
      if (classification.normal) counts.normal += 1;
    }
  }

  const sum = stableSumReport(values);
  const warnings = [];
  if (!meta.valid) warnings.push('non-finite-values');
  if (counts.negativeZero > 0) warnings.push('signed-zero');
  if (counts.subnormal > 0) warnings.push('subnormal-values');
  if (sum.cancellationRisk === 'medium' || sum.cancellationRisk === 'high') warnings.push('summation-cancellation');

  return {
    valid: meta.valid,
    count: meta.count,
    counts,
    sum,
    warnings,
    policy: {
      finiteRequired: true,
      signedZeroTracked: true,
      subnormalTracked: true,
      stableSum: 'neumaier-compensated',
      predicate: 'filtered-float64-orientation2d',
    },
  };
}
