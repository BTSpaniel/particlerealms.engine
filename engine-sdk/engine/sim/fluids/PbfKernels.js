// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Shared pressure-projection kernels used by the playground PBF solver and
 * bounded production fluid patches. Callers own neighbors, boundaries and GPU
 * resources. Distances are metres, density is kg/m^3, and time is seconds. */
export const PBF_KERNELS_WGSL = /* wgsl */`
fn pbfPoly6(distanceSquared: f32, radiusSquared: f32, coefficient: f32) -> f32 {
 let support = max(0.0, radiusSquared - distanceSquared);
 return coefficient * support * support * support;
}
fn pbfSpikyGradient(displacement: vec3f, radius: f32, coefficient: f32) -> vec3f {
 let distanceSquared = dot(displacement, displacement);
 if (distanceSquared <= 0.00000001 || distanceSquared >= radius * radius) { return vec3f(0.0); }
 let distance = sqrt(distanceSquared);
 let support = radius - distance;
 return -coefficient * support * support * displacement / distance;
}
fn pbfDensityLambda(densityRatio: f32, gradientSquares: f32, epsilon: f32) -> f32 {
 return -max(0.0, densityRatio - 1.0) / max(epsilon, gradientSquares);
}
fn pbfArtificialPressure(kernel: f32, referenceKernel: f32, strength: f32) -> f32 {
 let ratio = kernel / max(referenceKernel, 0.000001);
 return -strength * ratio * ratio * ratio * ratio;
}
`;

export function pbfKernelCoefficients(radius) {
 if (!Number.isFinite(radius) || radius <= 0) throw new RangeError('PBF smoothing radius must be finite and positive.');
 return Object.freeze({ radius, radiusSquared: radius * radius, poly6: 315 / (64 * Math.PI * radius ** 9), spiky: 45 / (Math.PI * radius ** 6) });
}

/** Plan a bounded batch while retaining a sub-fixed-step residual. */
export function planPbfStepBatch({
  accumulatorSeconds = 0,
  frameDeltaSeconds = 0,
  fixedStepSeconds = 1 / 90,
  maximumStepSeconds = fixedStepSeconds,
  maximumSubsteps = 1,
} = {}) {
  const fixedStep = Math.max(Number.MIN_VALUE, Number(fixedStepSeconds) || 0);
  const maximumStep = Math.max(fixedStep, Number(maximumStepSeconds) || fixedStep);
  const stepLimit = Math.max(1, Math.floor(Number(maximumSubsteps) || 1));
  const pending = Math.max(0, Number(accumulatorSeconds) || 0)
    + Math.max(0, Math.min(0.1, Number(frameDeltaSeconds) || 0));
  if (pending + 1e-12 < fixedStep) {
    return Object.freeze({
      substeps: 0,
      stepDeltaSeconds: Object.freeze([]),
      simulatedSeconds: 0,
      droppedSeconds: 0,
      remainingSeconds: pending,
      coalesced: false,
    });
  }
  let substeps;
  let simulatedSeconds;
  let stepDeltaSeconds;
  let remainingSeconds;
  let droppedSeconds = 0;
  const coalesced = maximumStep > fixedStep * (1 + 1e-9);
  if (!coalesced) {
    const available = Math.floor((pending + 1e-12) / fixedStep);
    substeps = Math.min(stepLimit, available);
    simulatedSeconds = substeps * fixedStep;
    droppedSeconds = Math.max(0, available - substeps) * fixedStep;
    remainingSeconds = Math.max(0, pending - simulatedSeconds - droppedSeconds);
    stepDeltaSeconds = Array.from({ length: substeps }, () => fixedStep);
  } else {
    const required = Math.max(1, Math.ceil((pending - 1e-12) / maximumStep));
    substeps = Math.min(stepLimit, required);
    simulatedSeconds = Math.min(pending, substeps * maximumStep);
    const delta = simulatedSeconds / substeps;
    stepDeltaSeconds = Array.from({ length: substeps }, () => delta);
    remainingSeconds = Math.max(0, pending - simulatedSeconds);
    const discardedSteps = Math.floor((remainingSeconds + 1e-12) / fixedStep);
    droppedSeconds = discardedSteps * fixedStep;
    remainingSeconds = Math.max(0, remainingSeconds - droppedSeconds);
  }
  return Object.freeze({
    substeps,
    stepDeltaSeconds: Object.freeze(stepDeltaSeconds),
    simulatedSeconds,
    droppedSeconds,
    remainingSeconds,
    coalesced,
  });
}

