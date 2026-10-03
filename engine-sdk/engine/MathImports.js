// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// MathImports: convenience barrel for engine math utilities.
// Provides both a grouped Math namespace and flat re-exports for common ops.

import { Math as EngineMath } from "./EngineImports.js";

// Grouped namespace: import { Math } from "../../engine/MathImports.js";
export const Math = EngineMath;

// Flat re-exports for frequently used functions/types
export const {
  // Vec3 core
  vec3, vec3Add, vec3Sub, vec3Scale, vec3Dot, vec3Cross, vec3Length, vec3Normalize,
  vec3Lerp, vec3Negate, vec3Mul, vec3Distance, vec3DistanceSq, vec3LengthSq,
  vec3Clone, vec3Zero, vec3One, vec3Up, vec3Forward, vec3Right,
  // Vec3 deep audit
  vec3DirectionTo, vec3Midpoint, vec3Bounce, vec3Reflect, vec3Project,
  vec3SmoothDamp, vec3RotateTowards, vec3Refract, vec3FaceForward,
  vec3Saturate, vec3OctEncode, vec3OctDecode,
  // Vec2 core
  vec2, vec2Add, vec2Sub, vec2Scale, vec2Dot, vec2Length, vec2Normalize,
  vec2Lerp, vec2Distance, vec2Clone,
  // Quat
  quatRotateVec3, quatMultiply, quatNormalize, quatConjugate, quatInverse,
  quatSlerp, quatFromAxisAngle, quatFromEuler, quatIdentity, quatLookAt,
  quatRotateTowards, quatDifference,
  // Mat4 core
  mat4Identity, mat4Multiply, mat4Translate, mat4Scale, mat4Inverse,
  mat4LookAt, mat4FromRotationTranslation,
  mat4PerspectiveRad,
  mat4PerspectiveRadWebGPU,  // WebGPU-style [0,1] depth range
  mat4PerspectiveDeg,
  mat4PerspectiveDegWebGPU,  // WebGPU-style [0,1] depth range
  mat4Orthographic,          // OpenGL-style [-1,1] depth range
  mat4OrthographicWebGPU,    // WebGPU-style [0,1] depth range
  // Scalar
  clamp, lerp, smoothstep, saturate, inverseLerp, remap,
  // Oscillator / resonance
  createOscillator, createOscillatorBank,
  sampleWave, sampleOscillator,
  sampleAmplitudeModulated, samplePhaseModulated, sampleRingModulated,
  beatFrequency, resonanceWeight, phaseCoherence,
  stepKuramotoPhases, stepKuramotoDriven, stepKuramotoMeanFieldDriven, stepCoupledOscillators,
  kuramotoOrderParameter, kuramotoOrderParameterComplex,
  rootAlgebraMask, rootAlgebraDimension, rootAlgebraGeneratorName,
  rootAlgebraBasisName, rootAlgebraFormatElement, rootAlgebraSquare,
  rootAlgebraMultiply, rootAlgebraTraceMultiply, rootAlgebraReverseMaskBits,
  rootAlgebraEncodedMultiply, rootAlgebraEncodedTrace,
  rootAlgebraGenerateTable, rootAlgebraCompileExecutionPlan,
  rootAlgebraEvaluateExecutionPlan, rootAlgebraExecutionPlanWGSL,
  rootAlgebraValidate, rootAlgebraPropertyReport,
  rootAlgebraFindSimpleZeroDivisors, rootAlgebraSearchEncodedMultipliers,
} = EngineMath;
