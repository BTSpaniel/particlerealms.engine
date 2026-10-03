// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// ConstraintMath.js - pure joint limit, drive, spring, and projection reports.

import { EPSILON, TAU } from './MathConstants.js';
import { clamp } from './MathScalar.js';
import {
  vec3Cross,
  vec3Distance,
  vec3Dot,
  vec3IsFinite,
  vec3Length,
  vec3Negate,
  vec3Normalize,
  vec3Sub,
} from './MathVec3.js';
import {
  quatDifference,
  quatNormalize,
  quatSwingTwist,
  quatToAxisAngle,
} from './MathQuat.js';

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function finiteMaybeInfinity(value, fallback = Infinity) {
  const number = Number(value);
  return Number.isFinite(number) || number === Infinity ? number : fallback;
}

function finiteNonNegative(value, fallback = 0) {
  return Math.max(0, finiteNumber(value, fallback));
}

function finitePositive(value, fallback = 1) {
  const number = finiteNumber(value, fallback);
  return number > EPSILON ? number : fallback;
}

function hasFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function mod(value, period) {
  return ((value % period) + period) % period;
}

function normalizePeriodic(value, period = TAU, center = 0) {
  return center + mod(value - center + period * 0.5, period) - period * 0.5;
}

function normalizeSignedAngle(value) {
  return normalizePeriodic(value, TAU, 0);
}

function angularDelta(from, to) {
  return normalizeSignedAngle(to - from);
}

function vec3From(value, fallback = [0, 0, 0]) {
  if (ArrayBuffer.isView(value) || Array.isArray(value)) {
    return [
      finiteNumber(value[0], fallback[0]),
      finiteNumber(value[1], fallback[1]),
      finiteNumber(value[2], fallback[2]),
    ];
  }
  if (value && typeof value === 'object') {
    return [
      finiteNumber(value.x ?? value[0], fallback[0]),
      finiteNumber(value.y ?? value[1], fallback[1]),
      finiteNumber(value.z ?? value[2], fallback[2]),
    ];
  }
  return [...fallback];
}

function quatFrom(value, fallback = [0, 0, 0, 1]) {
  if (ArrayBuffer.isView(value) || Array.isArray(value)) {
    return [
      finiteNumber(value[0], fallback[0]),
      finiteNumber(value[1], fallback[1]),
      finiteNumber(value[2], fallback[2]),
      finiteNumber(value[3], fallback[3]),
    ];
  }
  if (value && typeof value === 'object') {
    return [
      finiteNumber(value.x ?? value[0], fallback[0]),
      finiteNumber(value.y ?? value[1], fallback[1]),
      finiteNumber(value.z ?? value[2], fallback[2]),
      finiteNumber(value.w ?? value[3], fallback[3]),
    ];
  }
  return [...fallback];
}

function quatFinite(value) {
  return Number.isFinite(value[0]) && Number.isFinite(value[1]) &&
    Number.isFinite(value[2]) && Number.isFinite(value[3]);
}

function normalizedAxis(axisValue, fallback = [1, 0, 0]) {
  const axis = vec3From(axisValue, fallback);
  const normalized = vec3Normalize(axis);
  const valid = vec3IsFinite(axis) && vec3Length(normalized) > EPSILON;
  return {
    valid,
    axis: valid ? normalized : [...fallback],
    input: axis,
  };
}

function signedAxisAngle(quaternion, referenceAxis) {
  const axisAngle = quatToAxisAngle(quatNormalize(quaternion));
  let angle = axisAngle.angle;
  let axis = axisAngle.axis;

  if (angle > Math.PI) {
    angle = TAU - angle;
    axis = vec3Negate(axis);
  }

  const sign = vec3Dot(axis, referenceAxis) < 0 ? -1 : 1;
  return {
    axis,
    angle: angle * sign,
    absoluteAngle: Math.abs(angle),
  };
}

function perpendicularBasis(axis) {
  const seed = Math.abs(axis[0]) > 0.75 ? [0, 1, 0] : [1, 0, 0];
  const dot = vec3Dot(seed, axis);
  const basisA = vec3Normalize([
    seed[0] - axis[0] * dot,
    seed[1] - axis[1] * dot,
    seed[2] - axis[2] * dot,
  ]);
  const basisB = vec3Normalize(vec3Cross(axis, basisA));
  return { basisA, basisB };
}

function linearLimitReport(value, lowerLimit, upperLimit, options = {}) {
  const tolerance = finiteNonNegative(options.tolerance, 0);
  const lower = finiteNumber(lowerLimit, -Infinity);
  const upper = finiteNumber(upperLimit, Infinity);
  const current = Number(value);
  const rangeValid = lower <= upper;
  const valid = Number.isFinite(current) && rangeValid;
  let state = 'inside';
  let correction = 0;
  let clampedValue = current;

  if (!valid) {
    state = 'invalid';
    clampedValue = Number.NaN;
  } else if (current < lower - tolerance) {
    state = 'below';
    correction = lower - current;
    clampedValue = lower;
  } else if (current > upper + tolerance) {
    state = 'above';
    correction = upper - current;
    clampedValue = upper;
  }

  return {
    valid,
    inside: valid && state === 'inside',
    state,
    value: current,
    lowerLimit: lower,
    upperLimit: upper,
    clampedValue,
    correction,
    violation: valid ? Math.abs(correction) : Number.NaN,
    tolerance,
  };
}

export function constraintNormalizeAngle(angle, options = {}) {
  const input = Number(angle);
  const period = finitePositive(options.period, TAU);
  const center = finiteNumber(options.center, 0);
  const wrapped = options.wrap !== false && options.useExtendedLimits !== true;
  const valid = Number.isFinite(input);
  const normalizedAngle = valid
    ? wrapped
      ? normalizePeriodic(input, period, center)
      : input
    : Number.NaN;

  return {
    valid,
    angle: input,
    normalizedAngle,
    period,
    center,
    wrapped,
    revolutions: valid && wrapped ? Math.trunc((input - normalizedAngle) / period) : 0,
  };
}

export function constraintAngularLimitReport(angle, lowerLimit, upperLimit, options = {}) {
  const useExtendedLimits = options.useExtendedLimits === true || options.wrap === false;
  const tolerance = finiteNonNegative(options.tolerance, 0);
  const angleReport = constraintNormalizeAngle(angle, {
    ...options,
    wrap: !useExtendedLimits,
  });
  const current = angleReport.normalizedAngle;
  let lower = Number(lowerLimit);
  let upper = Number(upperLimit);

  if (!useExtendedLimits) {
    lower = normalizeSignedAngle(lower);
    upper = normalizeSignedAngle(upper);
  }

  const limitsFinite = Number.isFinite(lower) && Number.isFinite(upper);
  const rangeValid = limitsFinite && (!useExtendedLimits || lower <= upper);
  let inside = false;
  let state = 'invalid';
  let correction = Number.NaN;
  let clampedAngle = Number.NaN;

  if (angleReport.valid && rangeValid) {
    if (useExtendedLimits) {
      if (current < lower - tolerance) {
        state = 'below';
        correction = lower - current;
        clampedAngle = lower;
      } else if (current > upper + tolerance) {
        state = 'above';
        correction = upper - current;
        clampedAngle = upper;
      } else {
        inside = true;
        state = 'inside';
        correction = 0;
        clampedAngle = current;
      }
    } else {
      const wrapsRange = lower > upper;
      inside = wrapsRange
        ? current >= lower - tolerance || current <= upper + tolerance
        : current >= lower - tolerance && current <= upper + tolerance;
      if (inside) {
        state = 'inside';
        correction = 0;
        clampedAngle = current;
      } else {
        const toLower = angularDelta(current, lower);
        const toUpper = angularDelta(current, upper);
        correction = Math.abs(toLower) <= Math.abs(toUpper) ? toLower : toUpper;
        state = correction >= 0 ? 'below' : 'above';
        clampedAngle = normalizeSignedAngle(current + correction);
      }
    }
  }

  const span = !rangeValid
    ? Number.NaN
    : useExtendedLimits
      ? upper - lower
      : lower <= upper
        ? upper - lower
        : TAU - lower + upper;

  return {
    valid: angleReport.valid && rangeValid,
    inside,
    state,
    angle: Number(angle),
    normalizedAngle: current,
    lowerLimit: lower,
    upperLimit: upper,
    limitSpan: span,
    clampedAngle,
    correction,
    violation: Number.isFinite(correction) ? Math.abs(correction) : Number.NaN,
    tolerance,
    useExtendedLimits,
    wrapsRange: !useExtendedLimits && lower > upper,
  };
}

export function constraintAxisStateReport(value, options = {}) {
  const axis = String(options.axis ?? 'x');
  const mode = String(options.mode ?? (options.locked ? 'locked' : 'free')).toLowerCase();
  const tolerance = finiteNonNegative(options.tolerance, 0);
  const angular = options.angular === true;
  const current = Number(value);

  if (mode === 'free') {
    return {
      valid: Number.isFinite(current),
      axis,
      mode,
      inside: Number.isFinite(current),
      state: Number.isFinite(current) ? 'free' : 'invalid',
      value: current,
      correction: 0,
      violation: 0,
      tolerance,
    };
  }

  if (mode === 'locked') {
    const target = finiteNumber(options.target, 0);
    const error = angular ? angularDelta(current, target) : target - current;
    const violation = Math.abs(error);
    return {
      valid: Number.isFinite(current) && Number.isFinite(target),
      axis,
      mode,
      inside: violation <= tolerance,
      state: violation <= tolerance ? 'locked' : 'violated',
      value: current,
      target,
      correction: error,
      violation,
      tolerance,
    };
  }

  if (mode === 'limited') {
    const report = angular
      ? constraintAngularLimitReport(current, options.lowerLimit, options.upperLimit, options)
      : linearLimitReport(current, options.lowerLimit, options.upperLimit, options);
    return {
      ...report,
      axis,
      mode,
      value: current,
    };
  }

  return {
    valid: false,
    axis,
    mode,
    inside: false,
    state: 'invalid-mode',
    value: current,
    correction: Number.NaN,
    violation: Number.NaN,
    tolerance,
  };
}

export function constraintConeLimitReport(swingY, swingZ, limitY, limitZ, options = {}) {
  const y = Number(swingY);
  const z = Number(swingZ);
  const yLimit = finiteNumber(limitY, 0);
  const zLimit = finiteNumber(limitZ, 0);
  const tolerance = finiteNonNegative(options.tolerance, 0);
  const valid = Number.isFinite(y) && Number.isFinite(z) && yLimit > EPSILON && zLimit > EPSILON;
  const normalizedY = valid ? y / yLimit : Number.NaN;
  const normalizedZ = valid ? z / zLimit : Number.NaN;
  const ellipticalRadius = valid ? Math.hypot(normalizedY, normalizedZ) : Number.NaN;
  const inside = valid && ellipticalRadius <= 1 + tolerance;
  const scale = valid && ellipticalRadius > 1 ? 1 / ellipticalRadius : 1;
  const clampedSwingY = valid ? y * scale : Number.NaN;
  const clampedSwingZ = valid ? z * scale : Number.NaN;
  const correctionY = valid ? clampedSwingY - y : Number.NaN;
  const correctionZ = valid ? clampedSwingZ - z : Number.NaN;

  return {
    valid,
    inside,
    state: !valid ? 'invalid' : inside ? 'inside' : 'outside',
    swingY: y,
    swingZ: z,
    limitY: yLimit,
    limitZ: zLimit,
    normalizedY,
    normalizedZ,
    ellipticalRadius,
    clampedSwingY,
    clampedSwingZ,
    correctionY,
    correctionZ,
    violationRatio: valid ? Math.max(0, ellipticalRadius - 1) : Number.NaN,
    violation: valid ? Math.hypot(correctionY, correctionZ) : Number.NaN,
    tolerance,
  };
}

export function constraintSwingTwistLimitReport(rotation, twistAxis = [1, 0, 0], options = {}) {
  const inputQuat = quatFrom(rotation);
  const axisReport = normalizedAxis(twistAxis, [1, 0, 0]);
  const validInput = quatFinite(inputQuat) && axisReport.valid;
  const q = quatNormalize(inputQuat);
  const decomposition = validInput
    ? quatSwingTwist(q, axisReport.axis)
    : { swing: [0, 0, 0, 1], twist: [0, 0, 0, 1] };
  const twistAxisAngle = signedAxisAngle(decomposition.twist, axisReport.axis);
  const swingAxisAngle = signedAxisAngle(decomposition.swing, axisReport.axis);
  const basis = perpendicularBasis(axisReport.axis);
  const swingY = vec3Dot(swingAxisAngle.axis, basis.basisA) * swingAxisAngle.absoluteAngle;
  const swingZ = vec3Dot(swingAxisAngle.axis, basis.basisB) * swingAxisAngle.absoluteAngle;
  const twistLower = options.twistLowerLimit ?? options.lowerTwistLimit ?? options.lowerLimit;
  const twistUpper = options.twistUpperLimit ?? options.upperTwistLimit ?? options.upperLimit;
  const hasTwistLimit = hasFiniteNumber(twistLower) && hasFiniteNumber(twistUpper);
  const swingYLimit = options.swingYLimit ?? options.coneYLimit ?? options.yLimit;
  const swingZLimit = options.swingZLimit ?? options.coneZLimit ?? options.zLimit;
  const hasConeLimit = hasFiniteNumber(swingYLimit) && hasFiniteNumber(swingZLimit);
  const twistLimit = hasTwistLimit
    ? constraintAngularLimitReport(twistAxisAngle.angle, twistLower, twistUpper, options)
    : null;
  const coneLimit = hasConeLimit
    ? constraintConeLimitReport(swingY, swingZ, swingYLimit, swingZLimit, options)
    : null;

  return {
    valid: validInput && (!twistLimit || twistLimit.valid) && (!coneLimit || coneLimit.valid),
    inside: validInput && (!twistLimit || twistLimit.inside) && (!coneLimit || coneLimit.inside),
    rotation: q,
    twistAxis: axisReport.axis,
    swing: decomposition.swing,
    twist: decomposition.twist,
    swingAngle: swingAxisAngle.absoluteAngle,
    swingY,
    swingZ,
    twistAngle: twistAxisAngle.angle,
    twistLimit,
    coneLimit,
    basisY: basis.basisA,
    basisZ: basis.basisB,
  };
}

export function constraintSpringDamperCoefficients(options = {}) {
  const timeStep = finiteNonNegative(options.timeStep ?? options.dt, 1 / 60);
  const effectiveMass = finitePositive(options.effectiveMass ?? options.mass, 1);
  const mode = String(options.mode ?? (hasFiniteNumber(options.frequencyHz) ? 'frequency' : 'stiffness-damping')).toLowerCase();
  let stiffness = finiteNonNegative(options.stiffness, 0);
  let damping = finiteNonNegative(options.damping, 0);
  let frequencyHz = finiteNonNegative(options.frequencyHz, 0);
  let dampingRatio = finiteNonNegative(options.dampingRatio, 0);

  if (mode === 'frequency') {
    const angularFrequency = TAU * frequencyHz;
    stiffness = effectiveMass * angularFrequency * angularFrequency;
    damping = 2 * dampingRatio * effectiveMass * angularFrequency;
  } else if (mode === 'mass-normalized' || mode === 'acceleration') {
    const normalizedStiffness = finiteNonNegative(options.normalizedStiffness ?? options.stiffness, 0);
    const normalizedDamping = finiteNonNegative(options.normalizedDamping ?? options.damping, 0);
    stiffness = effectiveMass * normalizedStiffness;
    damping = effectiveMass * normalizedDamping;
    frequencyHz = normalizedStiffness > 0 ? Math.sqrt(normalizedStiffness) / TAU : 0;
  } else if (stiffness > EPSILON && dampingRatio > 0 && damping <= EPSILON) {
    damping = 2 * dampingRatio * Math.sqrt(stiffness * effectiveMass);
  }

  const angularFrequency = stiffness > EPSILON ? Math.sqrt(stiffness / effectiveMass) : 0;
  if (frequencyHz <= EPSILON && angularFrequency > 0) frequencyHz = angularFrequency / TAU;
  const criticalDamping = stiffness > EPSILON ? 2 * Math.sqrt(stiffness * effectiveMass) : 0;
  if (dampingRatio <= EPSILON && criticalDamping > EPSILON) dampingRatio = damping / criticalDamping;
  const stableFrequencyLimitHz = timeStep > EPSILON ? 0.5 / timeStep : Infinity;

  return {
    valid: effectiveMass > EPSILON && stiffness >= 0 && damping >= 0 && timeStep >= 0,
    mode,
    effectiveMass,
    stiffness,
    damping,
    dampingRatio,
    criticalDamping,
    angularFrequency,
    frequencyHz,
    timeStep,
    stableFrequencyLimitHz,
    frequencyStable: frequencyHz <= stableFrequencyLimitHz + EPSILON,
    massNormalizedStiffness: effectiveMass > EPSILON ? stiffness / effectiveMass : Number.NaN,
    massNormalizedDamping: effectiveMass > EPSILON ? damping / effectiveMass : Number.NaN,
  };
}

export function constraintMotorTargetErrorReport(current, target, options = {}) {
  const angular = options.angular === true;
  const currentValue = Number(current);
  const targetValue = Number(target);
  const currentVelocity = finiteNumber(options.currentVelocity, 0);
  const targetVelocity = finiteNumber(options.targetVelocity, 0);
  const coefficients = options.coefficients ?? constraintSpringDamperCoefficients(options);
  const positionError = angular ? angularDelta(currentValue, targetValue) : targetValue - currentValue;
  const velocityError = targetVelocity - currentVelocity;
  const rawEffort = coefficients.stiffness * positionError + coefficients.damping * velocityError;
  const maxEffort = finiteMaybeInfinity(options.maxEffort ?? options.maxForce ?? options.maxTorque, Infinity);
  const effort = Number.isFinite(maxEffort) ? clamp(rawEffort, -maxEffort, maxEffort) : rawEffort;
  const tolerance = finiteNonNegative(options.tolerance, 0);

  return {
    valid: Number.isFinite(currentValue) && Number.isFinite(targetValue) &&
      Number.isFinite(currentVelocity) && Number.isFinite(targetVelocity) &&
      Number.isFinite(rawEffort) && maxEffort >= 0,
    angular,
    current: currentValue,
    target: targetValue,
    currentVelocity,
    targetVelocity,
    positionError,
    velocityError,
    stiffness: coefficients.stiffness,
    damping: coefficients.damping,
    rawEffort,
    effort,
    maxEffort,
    saturated: Number.isFinite(maxEffort) && Math.abs(rawEffort) > maxEffort,
    atTarget: Math.abs(positionError) <= tolerance && Math.abs(velocityError) <= tolerance,
    tolerance,
  };
}

export function constraintJointProjectionErrorReport(frameA = {}, frameB = {}, options = {}) {
  const positionA = vec3From(frameA.position ?? frameA.origin ?? frameA.p);
  const positionB = vec3From(frameB.position ?? frameB.origin ?? frameB.p);
  const rotationA = quatNormalize(quatFrom(frameA.rotation ?? frameA.orientation ?? frameA.q));
  const rotationB = quatNormalize(quatFrom(frameB.rotation ?? frameB.orientation ?? frameB.q));
  const positionOffset = vec3Sub(positionB, positionA);
  const linearError = vec3Distance(positionA, positionB);
  const deltaRotation = quatDifference(rotationA, rotationB);
  const angular = signedAxisAngle(deltaRotation, [1, 0, 0]);
  const angularError = angular.absoluteAngle;
  const linearTolerance = finiteNonNegative(options.linearTolerance ?? options.positionTolerance, 0);
  const angularTolerance = finiteNonNegative(options.angularTolerance ?? options.rotationTolerance, 0);
  const valid = vec3IsFinite(positionA) && vec3IsFinite(positionB) && quatFinite(rotationA) && quatFinite(rotationB);

  return {
    valid,
    linearError,
    angularError,
    positionOffset,
    angularAxis: angular.axis,
    deltaRotation: quatNormalize(deltaRotation),
    linearTolerance,
    angularTolerance,
    linearWithinTolerance: valid && linearError <= linearTolerance + EPSILON,
    angularWithinTolerance: valid && angularError <= angularTolerance + EPSILON,
    needsProjection: valid && (linearError > linearTolerance + EPSILON || angularError > angularTolerance + EPSILON),
  };
}

export function constraintComplianceStiffnessReport(options = {}) {
  const timeStep = finiteNonNegative(options.timeStep ?? options.dt, 1 / 60);
  const effectiveMass = finitePositive(options.effectiveMass ?? options.mass, 1);
  const stiffnessInput = Number(options.stiffness);
  const complianceInput = Number(options.compliance);
  const hasStiffness = Number.isFinite(stiffnessInput) || stiffnessInput === Infinity;
  const hasCompliance = Number.isFinite(complianceInput) || complianceInput === Infinity;
  let stiffness = hasStiffness ? Math.max(0, stiffnessInput) : 0;
  let compliance = hasCompliance ? Math.max(0, complianceInput) : Infinity;

  if (hasStiffness && stiffness > EPSILON && !hasCompliance) {
    compliance = 1 / stiffness;
  } else if (hasCompliance && compliance > EPSILON && !hasStiffness) {
    stiffness = 1 / compliance;
  } else if (hasCompliance && compliance <= EPSILON && !hasStiffness) {
    stiffness = Infinity;
  } else if (hasStiffness && stiffness <= EPSILON && !hasCompliance) {
    compliance = Infinity;
  }

  const xpbdAlpha = timeStep > EPSILON ? compliance / (timeStep * timeStep) : Infinity;

  return {
    valid: (hasStiffness || hasCompliance) && stiffness >= 0 && compliance >= 0 && timeStep >= 0 && effectiveMass > EPSILON,
    stiffness,
    compliance,
    timeStep,
    xpbdAlpha,
    effectiveMass,
    massNormalizedStiffness: Number.isFinite(stiffness) ? stiffness / effectiveMass : Infinity,
    softness: Number.isFinite(compliance) ? compliance * effectiveMass : Infinity,
    rigid: compliance <= EPSILON || stiffness === Infinity,
  };
}

export function constraintDriveEnvelopeReport(options = {}) {
  const jointVelocity = Math.abs(finiteNumber(options.jointVelocity ?? options.velocity, 0));
  const requestedEffort = Math.abs(finiteNumber(options.requestedEffort ?? options.force ?? options.torque, 0));
  const maxEffort = finiteMaybeInfinity(options.maxEffort ?? options.maxForce ?? options.maxTorque, Infinity);
  const maxActuatorVelocity = finiteMaybeInfinity(options.maxActuatorVelocity, Infinity);
  const speedEffortGradient = finiteNonNegative(options.speedEffortGradient, 0);
  const velocityDependentResistance = finiteNonNegative(options.velocityDependentResistance, 0);
  const velocityLimitAtEffort = Math.max(0, maxActuatorVelocity - speedEffortGradient * requestedEffort);
  const effortLimitAtVelocity = Math.max(0, maxEffort - velocityDependentResistance * jointVelocity);
  const tolerance = finiteNonNegative(options.tolerance, 0);

  return {
    valid: jointVelocity >= 0 && requestedEffort >= 0 && maxEffort >= 0 && maxActuatorVelocity >= 0,
    accepted: jointVelocity <= velocityLimitAtEffort + tolerance && requestedEffort <= effortLimitAtVelocity + tolerance,
    jointVelocity,
    requestedEffort,
    maxEffort,
    maxActuatorVelocity,
    speedEffortGradient,
    velocityDependentResistance,
    velocityLimitAtEffort,
    effortLimitAtVelocity,
    velocityLimited: jointVelocity > velocityLimitAtEffort + tolerance,
    effortLimited: requestedEffort > effortLimitAtVelocity + tolerance,
    tolerance,
  };
}
