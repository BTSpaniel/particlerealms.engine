// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  WAVEFRONT_MAX_TRACE_STEPS,
  WAVEFRONT_WORKGROUP_SIZE,
} from "./constants.js";

const FRAME_WGSL = /* wgsl */ `
struct FrameUniforms {
  inverseViewProjection: mat4x4<f32>,
  cameraPosition: vec4<f32>,
  resolution: vec4<f32>,
  sunDirectionIntensity: vec4<f32>,
  sunColor: vec4<f32>,
  environmentZenithIntensity: vec4<f32>,
  environmentHorizon: vec4<f32>,
  counts: vec4<u32>,
  trace: vec4<f32>,
  random: vec4<u32>,
  dispatch: vec4<u32>,
}

@group(0) @binding(0) var<uniform> frame: FrameUniforms;

const PI: f32 = 3.14159265358979323846;
const INVALID_REF: u32 = 0xFFFFFFFFu;
const TRACE_STATUS_CLEAR: u32 = 0u;
const TRACE_STATUS_HIT: u32 = 1u;
const TRACE_STATUS_EXHAUSTED: u32 = 2u;
const TRACE_STATUS_INVALID: u32 = 3u;
const PRIMARY_RAY_MINIMUM_SENTINEL: f32 = -1.0;

fn finiteScalar(value: f32) -> bool {
  return value == value && abs(value) <= 3.402823466e+38;
}

fn safeNormalize(value: vec3<f32>, fallback: vec3<f32>) -> vec3<f32> {
  let magnitudeSquared = dot(value, value);
  if (!finiteScalar(magnitudeSquared) || magnitudeSquared <= 1e-20) { return fallback; }
  return value * inverseSqrt(magnitudeSquared);
}

fn hash32(input: u32) -> u32 {
  var value = input;
  value = value ^ (value >> 16u);
  value = value * 0x7FEB352Du;
  value = value ^ (value >> 15u);
  value = value * 0x846CA68Bu;
  return value ^ (value >> 16u);
}

fn randomFloat(state: ptr<function, u32>) -> f32 {
  *state = hash32(*state + 0x9E3779B9u);
  return f32(*state) * 2.3283064365386963e-10;
}

fn linearInvocationIndex(invocation: vec3<u32>) -> u32 {
  return invocation.x + invocation.y * frame.dispatch.x * ${WAVEFRONT_WORKGROUP_SIZE}u;
}

fn environmentRadiance(direction: vec3<f32>) -> vec3<f32> {
  let blend = clamp(direction.y * 0.5 + 0.5, 0.0, 1.0);
  return mix(frame.environmentHorizon.rgb, frame.environmentZenithIntensity.rgb, blend)
    * max(frame.environmentZenithIntensity.w, 0.0);
}

fn tangentFrame(normal: vec3<f32>) -> mat3x3<f32> {
  let helper = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), abs(normal.y) > 0.95);
  let tangent = safeNormalize(cross(helper, normal), vec3<f32>(1.0, 0.0, 0.0));
  return mat3x3<f32>(tangent, cross(normal, tangent), normal);
}

fn cosineHemisphere(normal: vec3<f32>, state: ptr<function, u32>) -> vec3<f32> {
  let u1 = randomFloat(state);
  let u2 = randomFloat(state);
  let radius = sqrt(u1);
  let phi = 2.0 * PI * u2;
  let local = vec3<f32>(radius * cos(phi), radius * sin(phi), sqrt(max(0.0, 1.0 - u1)));
  return safeNormalize(tangentFrame(normal) * local, normal);
}
`;

const PATH_TYPES_WGSL = /* wgsl */ `
struct PathRay {
  originMinimum: vec4<f32>,
  directionPixel: vec4<f32>,
}

struct HitRecord {
  positionMaterial: vec4<f32>,
  normalPixel: vec4<f32>,
  offsetSource: vec4<f32>,
}

struct ShadowRecord {
  originMaximum: vec4<f32>,
  directionPadding: vec4<f32>,
  contributionPixel: vec4<f32>,
}

struct PathState {
  throughputEta: vec4<f32>,
  radianceSeed: vec4<f32>,
}

struct RayQueue {
  count: atomic<u32>,
  overflow: atomic<u32>,
  capacity: u32,
  reserved: u32,
  records: array<PathRay>,
}

struct HitQueue {
  count: atomic<u32>,
  overflow: atomic<u32>,
  capacity: u32,
  reserved: u32,
  records: array<HitRecord>,
}

struct ShadowQueue {
  count: atomic<u32>,
  overflow: atomic<u32>,
  capacity: u32,
  reserved: u32,
  records: array<ShadowRecord>,
}
`;

const SCENE_WGSL = /* wgsl */ `
struct FieldletHeader {
  boundsRef: u32,
  payloadRef: u32,
  metadata: u32,
  certificateRef: u32,
}

struct SceneSample {
  distance: f32,
  errorMaximum: f32,
  lipschitzMaximum: f32,
  fallbackMaximum: f32,
  materialIndex: u32,
  sourceIndex: u32,
  valid: u32,
}

struct TraceResult {
  status: u32,
  distance: f32,
  materialIndex: u32,
  sourceIndex: u32,
  position: vec3<f32>,
  normal: vec3<f32>,
}

@group(0) @binding(1) var<storage, read> fieldletHeaders: array<FieldletHeader>;
@group(0) @binding(2) var<storage, read> payloadRecords: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> packedQueryCertificates: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> analyticProgram: array<vec2<u32>>;
@group(0) @binding(5) var<storage, read> analyticParameters: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read> boundRecords: array<vec4<f32>>;

const FIELDLET_SUBTYPE_ANALYTIC_PROGRAM: u32 = 0u;
const FIELDLET_FAMILY_ANALYTIC: u32 = 0u;
const FIELDLET_QUERY_SURFACE: u32 = 1u << 1u;
const FIELDLET_FLAG_CERTIFIED_SURFACE: u32 = 1u << 4u;

fn rotateQuaternion(value: vec3<f32>, quaternionInput: vec4<f32>) -> vec3<f32> {
  let magnitudeSquared = dot(quaternionInput, quaternionInput);
  let quaternion = select(
    vec4<f32>(0.0, 0.0, 0.0, 1.0),
    quaternionInput * inverseSqrt(max(magnitudeSquared, 1e-20)),
    magnitudeSquared > 1e-20,
  );
  return value + 2.0 * cross(quaternion.xyz, cross(quaternion.xyz, value) + quaternion.w * value);
}

fn sdfBox(point: vec3<f32>, halfExtents: vec3<f32>) -> f32 {
  let delta = abs(point) - halfExtents;
  return length(max(delta, vec3<f32>(0.0))) + min(max(delta.x, max(delta.y, delta.z)), 0.0);
}

fn sdfCapsuleY(point: vec3<f32>, radius: f32, halfHeight: f32) -> f32 {
  let closest = vec3<f32>(0.0, clamp(point.y, -halfHeight, halfHeight), 0.0);
  return length(point - closest) - radius;
}

fn parameterPrimitiveDistance(point: vec3<f32>, parameterReference: u32, opcode: u32) -> f32 {
  let base = parameterReference * 4u;
  if (base + 3u >= arrayLength(&analyticParameters)) { return 1e30; }
  let translationScale = analyticParameters[base];
  let rotation = analyticParameters[base + 1u];
  let shape = analyticParameters[base + 2u];
  let scale = max(abs(translationScale.w), 1e-7);
  let localPoint = rotateQuaternion(
    point - translationScale.xyz,
    vec4<f32>(-rotation.xyz, rotation.w),
  ) / scale;
  var distance = 1e30;
  if (opcode == 1u) {
    distance = length(localPoint) - max(abs(shape.x), 1e-7);
  } else if (opcode == 2u) {
    distance = sdfBox(localPoint, max(abs(shape.xyz), vec3<f32>(1e-7)));
  } else if (opcode == 3u) {
    distance = sdfCapsuleY(localPoint, max(abs(shape.x), 1e-7), max(abs(shape.y), 0.0));
  }
  return distance * scale;
}

fn programDistance(point: vec3<f32>, offset: u32, length: u32) -> f32 {
  if (length == 0u || length > 64u || offset > arrayLength(&analyticProgram)
      || length > arrayLength(&analyticProgram) - offset) {
    return 1e30;
  }
  var stack: array<f32, 32>;
  var depth = 0u;
  for (var instructionIndex = 0u; instructionIndex < 64u; instructionIndex = instructionIndex + 1u) {
    if (instructionIndex >= length) { break; }
    let instruction = analyticProgram[offset + instructionIndex];
    if (instruction.x >= 1u && instruction.x <= 3u) {
      if (depth >= 32u) { return 1e30; }
      stack[depth] = parameterPrimitiveDistance(point, instruction.y, instruction.x);
      depth = depth + 1u;
    } else if (instruction.x >= 16u && instruction.x <= 18u) {
      if (depth < 2u) { return 1e30; }
      let right = stack[depth - 1u];
      let left = stack[depth - 2u];
      depth = depth - 1u;
      if (instruction.x == 16u) {
        stack[depth - 1u] = min(left, right);
      } else if (instruction.x == 17u) {
        stack[depth - 1u] = max(left, right);
      } else {
        stack[depth - 1u] = max(left, -right);
      }
    } else {
      return 1e30;
    }
  }
  if (depth != 1u || !finiteScalar(stack[0])) { return 1e30; }
  return stack[0];
}

fn directPrimitiveDistance(point: vec3<f32>, header: FieldletHeader) -> f32 {
  let base = header.payloadRef * 4u;
  if (base + 3u >= arrayLength(&payloadRecords)) { return 1e30; }
  let positionRadius = payloadRecords[base];
  let shape = payloadRecords[base + 1u];
  let rotation = payloadRecords[base + 2u];
  let localPoint = rotateQuaternion(
    point - positionRadius.xyz,
    vec4<f32>(-rotation.xyz, rotation.w),
  );
  let shapeCode = u32(max(shape.w, 0.0));
  if (shapeCode == 0u) {
    return length(localPoint) - max(abs(positionRadius.w), 1e-7);
  }
  if (shapeCode == 1u) {
    return sdfBox(localPoint, max(abs(shape.xyz), vec3<f32>(1e-7)));
  }
  if (shapeCode == 2u) {
    return sdfCapsuleY(localPoint, max(abs(positionRadius.w), 1e-7), max(abs(shape.y), 0.0));
  }
  return 1e30;
}

fn fieldletDistance(point: vec3<f32>, header: FieldletHeader) -> f32 {
  let base = header.payloadRef * 4u;
  if (base + 3u >= arrayLength(&payloadRecords)) { return 1e30; }
  let auxiliary = payloadRecords[base + 3u];
  let programLength = u32(max(auxiliary.y, 0.0));
  if (programLength > 0u) {
    return programDistance(point, u32(max(auxiliary.x, 0.0)), programLength);
  }
  return directPrimitiveDistance(point, header);
}

fn surfaceCertificate(fieldletIndex: u32) -> vec4<f32> {
  let recordIndex = fieldletIndex * 4u;
  if (recordIndex >= arrayLength(&packedQueryCertificates)) { return vec4<f32>(-1.0); }
  let certificate = packedQueryCertificates[recordIndex];
  if (!finiteScalar(certificate.x) || !finiteScalar(certificate.y) || !finiteScalar(certificate.z)
      || !finiteScalar(certificate.w)
      || certificate.x < 0.0 || certificate.y <= 0.0 || certificate.z < 0.0 || certificate.w < 0.0) {
    return vec4<f32>(-1.0);
  }
  return certificate;
}

fn isCertifiedAnalyticSurface(header: FieldletHeader, certificate: vec4<f32>) -> bool {
  let subtype = header.metadata & 0xFFFu;
  let family = (header.metadata >> 12u) & 0xFu;
  let queryMask = (header.metadata >> 16u) & 0x3Fu;
  let flags = (header.metadata >> 22u) & 0x3FFu;
  return subtype == FIELDLET_SUBTYPE_ANALYTIC_PROGRAM
    && family == FIELDLET_FAMILY_ANALYTIC
    && (queryMask & FIELDLET_QUERY_SURFACE) != 0u
    && (flags & FIELDLET_FLAG_CERTIFIED_SURFACE) != 0u
    && header.certificateRef != INVALID_REF
    && certificate.x >= 0.0;
}

fn distanceToFieldletBound(point: vec3<f32>, header: FieldletHeader) -> f32 {
  let base = header.boundsRef * 2u;
  if (base + 1u >= arrayLength(&boundRecords)) { return -1e30; }
  let minimum = boundRecords[base].xyz;
  let maximum = boundRecords[base + 1u].xyz;
  let center = (minimum + maximum) * 0.5;
  let halfExtents = max((maximum - minimum) * 0.5, vec3<f32>(0.0));
  return sdfBox(point - center, halfExtents);
}

fn sceneDistance(point: vec3<f32>) -> SceneSample {
  var result = SceneSample(1e30, 0.0, 1.0, 0.0, 0u, 0u, 0u);
  let count = min(frame.counts.x, arrayLength(&fieldletHeaders));
  for (var index = 0u; index < count; index = index + 1u) {
    let header = fieldletHeaders[index];
    let certificate = surfaceCertificate(index);
    if (!isCertifiedAnalyticSurface(header, certificate)) { continue; }
    if (result.valid != 0u) {
      let certifiedCandidateFloor = distanceToFieldletBound(point, header) - certificate.x;
      if (finiteScalar(certifiedCandidateFloor) && certifiedCandidateFloor >= result.distance) {
        result.errorMaximum = max(result.errorMaximum, certificate.x);
        result.lipschitzMaximum = max(result.lipschitzMaximum, certificate.y);
        result.fallbackMaximum = max(result.fallbackMaximum, certificate.z);
        continue;
      }
    }
    let distance = fieldletDistance(point, header);
    if (!finiteScalar(distance)) { continue; }
    let payloadBase = header.payloadRef * 4u;
    if (payloadBase + 3u >= arrayLength(&payloadRecords)) { continue; }
    let materialIndex = u32(max(payloadRecords[payloadBase + 3u].z, 0.0));
    if (result.valid == 0u || distance < result.distance) {
      result.distance = distance;
      result.materialIndex = materialIndex;
      result.sourceIndex = index;
      result.valid = 1u;
    }
    result.errorMaximum = max(result.errorMaximum, certificate.x);
    result.lipschitzMaximum = max(result.lipschitzMaximum, certificate.y);
    result.fallbackMaximum = max(result.fallbackMaximum, certificate.z);
  }
  return result;
}

fn sceneNormal(point: vec3<f32>) -> vec3<f32> {
  let epsilon = max(frame.trace.y * 2.0, 1e-5);
  let k0 = vec3<f32>(1.0, -1.0, -1.0);
  let k1 = vec3<f32>(-1.0, -1.0, 1.0);
  let k2 = vec3<f32>(-1.0, 1.0, -1.0);
  let k3 = vec3<f32>(1.0, 1.0, 1.0);
  let gradient = k0 * sceneDistance(point + k0 * epsilon).distance
    + k1 * sceneDistance(point + k1 * epsilon).distance
    + k2 * sceneDistance(point + k2 * epsilon).distance
    + k3 * sceneDistance(point + k3 * epsilon).distance;
  return safeNormalize(gradient, vec3<f32>(0.0, 1.0, 0.0));
}

fn axisInterval(origin: f32, direction: f32, minimum: f32, maximum: f32) -> vec2<f32> {
  if (abs(direction) <= 1e-20) {
    if (origin < minimum || origin > maximum) { return vec2<f32>(1e30, -1e30); }
    return vec2<f32>(-1e30, 1e30);
  }
  let first = (minimum - origin) / direction;
  let second = (maximum - origin) / direction;
  return vec2<f32>(min(first, second), max(first, second));
}

fn rayBoundInterval(origin: vec3<f32>, direction: vec3<f32>, header: FieldletHeader) -> vec2<f32> {
  let base = header.boundsRef * 2u;
  if (base + 1u >= arrayLength(&boundRecords)) { return vec2<f32>(1e30, -1e30); }
  let minimum = boundRecords[base].xyz;
  let maximum = boundRecords[base + 1u].xyz;
  let x = axisInterval(origin.x, direction.x, minimum.x, maximum.x);
  let y = axisInterval(origin.y, direction.y, minimum.y, maximum.y);
  let z = axisInterval(origin.z, direction.z, minimum.z, maximum.z);
  return vec2<f32>(max(x.x, max(y.x, z.x)), min(x.y, min(y.y, z.y)));
}

fn sceneRayInterval(origin: vec3<f32>, direction: vec3<f32>, minimumDistance: f32, maximumDistance: f32) -> vec2<f32> {
  var nearDistance = maximumDistance;
  var farDistance = minimumDistance;
  var found = false;
  let count = min(frame.counts.x, arrayLength(&fieldletHeaders));
  for (var index = 0u; index < count; index = index + 1u) {
    let header = fieldletHeaders[index];
    let certificate = surfaceCertificate(index);
    if (!isCertifiedAnalyticSurface(header, certificate)) { continue; }
    let interval = rayBoundInterval(origin, direction, header);
    if (interval.y < interval.x || interval.y < minimumDistance || interval.x > maximumDistance) { continue; }
    nearDistance = min(nearDistance, max(interval.x, minimumDistance));
    farDistance = max(farDistance, min(interval.y, maximumDistance));
    found = true;
  }
  return select(vec2<f32>(maximumDistance, minimumDistance), vec2<f32>(nearDistance, farDistance), found);
}

fn refineBracket(origin: vec3<f32>, direction: vec3<f32>, lowInput: f32, highInput: f32) -> f32 {
  var low = lowInput;
  var high = highInput;
  let lowSample = sceneDistance(origin + direction * low);
  let highSample = sceneDistance(origin + direction * high);
  if (lowSample.valid == 0u || highSample.valid == 0u
      || !finiteScalar(lowSample.distance) || !finiteScalar(highSample.distance)
      || !((lowSample.distance < 0.0 && highSample.distance >= 0.0)
        || (lowSample.distance > 0.0 && highSample.distance <= 0.0))) {
    return -1.0;
  }
  var lowDistance = lowSample.distance;
  for (var iteration = 0u; iteration < 24u; iteration = iteration + 1u) {
    if (high - low <= max(frame.trace.y, 1e-7)) { break; }
    let middle = 0.5 * (low + high);
    let middleSample = sceneDistance(origin + direction * middle);
    if (middleSample.valid == 0u || !finiteScalar(middleSample.distance)) { return -1.0; }
    let middleDistance = middleSample.distance;
    if ((lowDistance <= 0.0 && middleDistance <= 0.0)
        || (lowDistance >= 0.0 && middleDistance >= 0.0)) {
      low = middle;
      lowDistance = middleDistance;
    } else {
      high = middle;
    }
  }
  return 0.5 * (low + high);
}

fn signTransition(left: f32, right: f32) -> bool {
  return (left < 0.0 && right >= 0.0) || (left > 0.0 && right <= 0.0);
}

fn isolateUncertainCrossing(
  origin: vec3<f32>,
  direction: vec3<f32>,
  travel: f32,
  intervalExit: f32,
  sample: SceneSample,
  threshold: f32,
) -> f32 {
  if (sample.fallbackMaximum <= threshold) { return -1.0; }
  let available = max(intervalExit - travel, 0.0);
  let probeStep = min(sample.fallbackMaximum / max(sample.lipschitzMaximum, 1e-6), available);
  if (!finiteScalar(probeStep) || probeStep <= 0.0) { return -1.0; }
  let probeTravel = travel + probeStep;
  let probe = sceneDistance(origin + direction * probeTravel);
  if (probe.valid == 0u || !finiteScalar(probe.distance)) { return -1.0; }
  if (signTransition(sample.distance, probe.distance)) {
    return refineBracket(origin, direction, travel, probeTravel);
  }
  return -1.0;
}

fn traceScene(
  origin: vec3<f32>,
  directionInput: vec3<f32>,
  minimumDistance: f32,
  maximumDistance: f32,
  stepLimitInput: u32,
) -> TraceResult {
  let directionMagnitudeSquared = dot(directionInput, directionInput);
  if (!finiteScalar(directionMagnitudeSquared) || directionMagnitudeSquared <= 1e-20
      || !finiteScalar(minimumDistance) || !finiteScalar(maximumDistance)
      || minimumDistance < 0.0 || maximumDistance < minimumDistance) {
    return TraceResult(TRACE_STATUS_INVALID, maximumDistance, 0u, INVALID_REF, origin, vec3<f32>(0.0));
  }
  let direction = directionInput * inverseSqrt(directionMagnitudeSquared);
  let interval = sceneRayInterval(origin, direction, minimumDistance, maximumDistance);
  if (interval.y < interval.x) {
    return TraceResult(TRACE_STATUS_CLEAR, maximumDistance, 0u, INVALID_REF, origin + direction * maximumDistance, vec3<f32>(0.0));
  }
  let stepLimit = min(stepLimitInput, ${WAVEFRONT_MAX_TRACE_STEPS}u);
  if (stepLimit == 0u) {
    return TraceResult(TRACE_STATUS_EXHAUSTED, interval.x, 0u, INVALID_REF, origin + direction * interval.x, vec3<f32>(0.0));
  }
  var travel = interval.x;
  var previousTravel = travel;
  var previousDistance = 1e30;
  var previousValid = false;
  var last = SceneSample(1e30, 0.0, 1.0, 0.0, 0u, INVALID_REF, 0u);
  for (var stepIndex = 0u; stepIndex < ${WAVEFRONT_MAX_TRACE_STEPS}u; stepIndex = stepIndex + 1u) {
    if (travel > interval.y || travel > maximumDistance) {
      return TraceResult(TRACE_STATUS_CLEAR, travel, last.materialIndex, last.sourceIndex, origin + direction * travel, vec3<f32>(0.0));
    }
    if (stepIndex >= stepLimit) {
      return TraceResult(TRACE_STATUS_EXHAUSTED, travel, last.materialIndex, last.sourceIndex, origin + direction * travel, vec3<f32>(0.0));
    }
    let position = origin + direction * travel;
    let sample = sceneDistance(position);
    last = sample;
    if (sample.valid == 0u || !finiteScalar(sample.distance)) {
      return TraceResult(TRACE_STATUS_INVALID, travel, sample.materialIndex, sample.sourceIndex, position, vec3<f32>(0.0));
    }
    var acceptedTravel = travel;
    var accepted = false;
    if (previousValid && signTransition(previousDistance, sample.distance) && travel > previousTravel) {
      acceptedTravel = refineBracket(origin, direction, previousTravel, travel);
      accepted = acceptedTravel >= previousTravel;
    }
    let threshold = frame.trace.y + sample.errorMaximum;
    if (!accepted && abs(sample.distance) <= threshold) { accepted = true; }
    if (!accepted && abs(sample.distance) <= sample.fallbackMaximum) {
      let fallbackTravel = isolateUncertainCrossing(origin, direction, travel, interval.y, sample, threshold);
      if (fallbackTravel >= travel) {
        acceptedTravel = fallbackTravel;
        accepted = true;
      }
    }
    if (accepted) {
      let hitPosition = origin + direction * acceptedTravel;
      let refinedSample = sceneDistance(hitPosition);
      if (refinedSample.valid == 0u || !finiteScalar(refinedSample.distance)) {
        return TraceResult(TRACE_STATUS_INVALID, acceptedTravel, 0u, INVALID_REF, hitPosition, vec3<f32>(0.0));
      }
      return TraceResult(
        TRACE_STATUS_HIT,
        acceptedTravel,
        refinedSample.materialIndex,
        refinedSample.sourceIndex,
        hitPosition,
        sceneNormal(hitPosition),
      );
    }
    let safeStep = max(abs(sample.distance) - sample.errorMaximum, 0.0)
      / max(sample.lipschitzMaximum, 1e-6);
    if (!finiteScalar(safeStep)) {
      return TraceResult(TRACE_STATUS_INVALID, travel, sample.materialIndex, sample.sourceIndex, position, vec3<f32>(0.0));
    }
    if (safeStep <= 0.0) {
      return TraceResult(TRACE_STATUS_EXHAUSTED, travel, sample.materialIndex, sample.sourceIndex, position, vec3<f32>(0.0));
    }
    if (travel >= interval.y || travel >= maximumDistance) {
      return TraceResult(TRACE_STATUS_CLEAR, travel, sample.materialIndex, sample.sourceIndex, position, vec3<f32>(0.0));
    }
    let boundedStep = min(safeStep, max((interval.y - interval.x) * 0.125, 0.0));
    let nextTravel = travel + boundedStep;
    if (!finiteScalar(nextTravel)) {
      return TraceResult(TRACE_STATUS_INVALID, travel, sample.materialIndex, sample.sourceIndex, position, vec3<f32>(0.0));
    }
    if (nextTravel <= travel) {
      return TraceResult(TRACE_STATUS_EXHAUSTED, travel, sample.materialIndex, sample.sourceIndex, position, vec3<f32>(0.0));
    }
    previousTravel = travel;
    previousDistance = sample.distance;
    previousValid = true;
    travel = nextTravel;
  }
  return TraceResult(TRACE_STATUS_EXHAUSTED, travel, last.materialIndex, last.sourceIndex, origin + direction * travel, vec3<f32>(0.0));
}
`;

export const WAVEFRONT_GENERATE_WGSL = /* wgsl */ `
${FRAME_WGSL}
${PATH_TYPES_WGSL}

@group(1) @binding(0) var<storage, read_write> rayQueue: RayQueue;
@group(1) @binding(1) var<storage, read_write> pathStates: array<PathState>;

fn unproject(ndc: vec2<f32>, depth: f32) -> vec3<f32> {
  let world = frame.inverseViewProjection * vec4<f32>(ndc, depth, 1.0);
  return world.xyz / max(abs(world.w), 1e-8) * sign(world.w);
}

@compute @workgroup_size(${WAVEFRONT_WORKGROUP_SIZE})
fn generatePrimary(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let localIndex = linearInvocationIndex(invocation);
  let tileCount = min(frame.dispatch.z, rayQueue.capacity);
  if (localIndex == 0u) {
    atomicStore(&rayQueue.count, tileCount);
    if (frame.dispatch.z > rayQueue.capacity) {
      atomicAdd(&rayQueue.overflow, frame.dispatch.z - rayQueue.capacity);
    }
  }
  if (localIndex >= tileCount || localIndex >= arrayLength(&pathStates)) { return; }
  let globalIndex = frame.dispatch.y + localIndex;
  let width = max(u32(frame.resolution.x), 1u);
  let pixel = vec2<u32>(globalIndex % width, globalIndex / width);
  var seed = hash32(
    globalIndex
      ^ hash32(frame.random.x + 0xA511E9B3u)
      ^ hash32(frame.random.y + frame.random.z * 0x9E3779B9u)
      ^ frame.random.w
  );
  // Until progressive first-hit guides are accumulated alongside radiance,
  // sample the same pixel center as the direct G-buffer visibility pass.
  let primarySample = vec2<f32>(0.5);
  let uv = (vec2<f32>(pixel) + primarySample) * frame.resolution.zw;
  let ndc = vec2<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let nearPoint = unproject(ndc, 0.0);
  let farPoint = unproject(ndc, 1.0);
  let direction = safeNormalize(farPoint - nearPoint, vec3<f32>(0.0, 0.0, -1.0));
  rayQueue.records[localIndex] = PathRay(
    vec4<f32>(nearPoint, PRIMARY_RAY_MINIMUM_SENTINEL),
    vec4<f32>(direction, bitcast<f32>(localIndex)),
  );
  pathStates[localIndex] = PathState(
    vec4<f32>(1.0, 1.0, 1.0, 1.0),
    vec4<f32>(0.0, 0.0, 0.0, bitcast<f32>(seed)),
  );
}
`;

export const WAVEFRONT_INTERSECT_WGSL = /* wgsl */ `
${FRAME_WGSL}
${PATH_TYPES_WGSL}
${SCENE_WGSL}

@group(1) @binding(0) var<storage, read_write> rayQueue: RayQueue;
@group(1) @binding(1) var<storage, read_write> hitQueue: HitQueue;

@compute @workgroup_size(${WAVEFRONT_WORKGROUP_SIZE})
fn intersectRays(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let queueCount = min(atomicLoad(&rayQueue.count), rayQueue.capacity);
  let index = linearInvocationIndex(invocation);
  let hitCapacity = min(hitQueue.capacity, arrayLength(&hitQueue.records));
  let boundedCount = min(queueCount, hitCapacity);
  if (index == 0u) {
    atomicStore(&hitQueue.count, boundedCount);
    if (queueCount > hitCapacity) { atomicAdd(&hitQueue.overflow, queueCount - hitCapacity); }
  }
  if (index >= boundedCount || index >= arrayLength(&rayQueue.records)) { return; }
  let ray = rayQueue.records[index];
  let localPixel = bitcast<u32>(ray.directionPixel.w);
  let primaryRay = ray.originMinimum.w == PRIMARY_RAY_MINIMUM_SENTINEL;
  let result = traceScene(
    ray.originMinimum.xyz,
    ray.directionPixel.xyz,
    max(ray.originMinimum.w, 0.0),
    frame.trace.x,
    select(frame.counts.w, ${WAVEFRONT_MAX_TRACE_STEPS}u, primaryRay),
  );
  if (result.status == TRACE_STATUS_HIT) {
    let certificate = surfaceCertificate(result.sourceIndex);
    let secondaryOffset = max(
      frame.trace.z,
      frame.trace.y + max(certificate.x * 2.0, certificate.z),
    );
    hitQueue.records[index] = HitRecord(
      vec4<f32>(result.position, bitcast<f32>(result.materialIndex)),
      vec4<f32>(result.normal, bitcast<f32>(localPixel)),
      vec4<f32>(secondaryOffset, bitcast<f32>(result.sourceIndex), f32(result.status), 0.0),
    );
  } else {
    hitQueue.records[index] = HitRecord(
      vec4<f32>(0.0, 0.0, 0.0, -1.0),
      vec4<f32>(0.0, 0.0, 0.0, bitcast<f32>(localPixel)),
      vec4<f32>(frame.trace.z, 0.0, f32(result.status), 0.0),
    );
  }
}
`;

const MATERIAL_WGSL = /* wgsl */ `
struct BounceUniform {
  bounceIndex: u32,
  maximumBounces: u32,
  flags: u32,
  reserved: u32,
}

struct BounceSample {
  direction: vec3<f32>,
  weight: vec3<f32>,
  eta: f32,
  delta: u32,
  valid: u32,
}

@group(0) @binding(1) var<storage, read> materialRecords: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> materialExtensions: array<vec4<f32>>;
@group(0) @binding(3) var<uniform> bounce: BounceUniform;

fn materialBase(indexInput: u32) -> vec4<f32> {
  let count = min(frame.counts.y, arrayLength(&materialRecords) / 3u);
  if (count == 0u) { return vec4<f32>(0.72, 0.74, 0.8, 1.0); }
  return materialRecords[min(indexInput, count - 1u) * 3u];
}

fn materialParameters(indexInput: u32) -> vec4<f32> {
  let count = min(frame.counts.y, arrayLength(&materialRecords) / 3u);
  if (count == 0u) { return vec4<f32>(0.45, 0.0, 1.0, 1.5); }
  return materialRecords[min(indexInput, count - 1u) * 3u + 1u];
}

fn materialEmission(indexInput: u32) -> vec3<f32> {
  let count = min(frame.counts.y, arrayLength(&materialRecords) / 3u);
  if (count == 0u) { return vec3<f32>(0.0); }
  return max(materialRecords[min(indexInput, count - 1u) * 3u + 2u].rgb, vec3<f32>(0.0));
}

fn materialExtension(indexInput: u32) -> vec4<f32> {
  let count = min(frame.counts.z, arrayLength(&materialExtensions));
  if (count == 0u) { return vec4<f32>(0.0, 1.5, 0.0, 0.1); }
  return materialExtensions[min(indexInput, count - 1u)];
}

fn luminance(value: vec3<f32>) -> f32 {
  return dot(value, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn fresnelSchlick(cosine: f32, f0: vec3<f32>) -> vec3<f32> {
  let factor = pow(1.0 - clamp(cosine, 0.0, 1.0), 5.0);
  return f0 + (vec3<f32>(1.0) - f0) * factor;
}

fn dielectricFresnel(cosineInput: f32, etaIncident: f32, etaTransmitted: f32) -> f32 {
  var cosine = clamp(cosineInput, -1.0, 1.0);
  var etaI = etaIncident;
  var etaT = etaTransmitted;
  if (cosine <= 0.0) {
    cosine = abs(cosine);
    let swap = etaI;
    etaI = etaT;
    etaT = swap;
  }
  let sineTransmitted = etaI / etaT * sqrt(max(0.0, 1.0 - cosine * cosine));
  if (sineTransmitted >= 1.0) { return 1.0; }
  let cosineTransmitted = sqrt(max(0.0, 1.0 - sineTransmitted * sineTransmitted));
  let parallel = ((etaT * cosine) - (etaI * cosineTransmitted))
    / max((etaT * cosine) + (etaI * cosineTransmitted), 1e-7);
  let perpendicular = ((etaI * cosine) - (etaT * cosineTransmitted))
    / max((etaI * cosine) + (etaT * cosineTransmitted), 1e-7);
  return clamp((parallel * parallel + perpendicular * perpendicular) * 0.5, 0.0, 1.0);
}

fn ggxDistribution(noH: f32, alpha: f32) -> f32 {
  let alphaSquared = alpha * alpha;
  let denominator = noH * noH * (alphaSquared - 1.0) + 1.0;
  return alphaSquared / max(PI * denominator * denominator, 1e-8);
}

fn smithG1(noX: f32, alpha: f32) -> f32 {
  if (noX <= 0.0) { return 0.0; }
  let alphaSquared = alpha * alpha;
  let tangentSquared = max(1.0 - noX * noX, 0.0) / max(noX * noX, 1e-8);
  return 2.0 / (1.0 + sqrt(1.0 + alphaSquared * tangentSquared));
}

fn sampleGGXVNDF(normal: vec3<f32>, view: vec3<f32>, alpha: f32, state: ptr<function, u32>) -> vec3<f32> {
  let basis = tangentFrame(normal);
  let localView = transpose(basis) * view;
  let stretchedView = safeNormalize(vec3<f32>(alpha * localView.x, alpha * localView.y, localView.z), vec3<f32>(0.0, 0.0, 1.0));
  let lensSquared = stretchedView.x * stretchedView.x + stretchedView.y * stretchedView.y;
  let tangent1 = select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(-stretchedView.y, stretchedView.x, 0.0) * inverseSqrt(max(lensSquared, 1e-20)), lensSquared > 1e-20);
  let tangent2 = cross(stretchedView, tangent1);
  let radius = sqrt(randomFloat(state));
  let phi = 2.0 * PI * randomFloat(state);
  let diskX = radius * cos(phi);
  var diskY = radius * sin(phi);
  let blend = 0.5 * (1.0 + stretchedView.z);
  diskY = mix(sqrt(max(0.0, 1.0 - diskX * diskX)), diskY, blend);
  let normalHeight = sqrt(max(0.0, 1.0 - diskX * diskX - diskY * diskY));
  let stretchedNormal = diskX * tangent1 + diskY * tangent2 + normalHeight * stretchedView;
  let localNormal = safeNormalize(vec3<f32>(alpha * stretchedNormal.x, alpha * stretchedNormal.y, max(0.0, stretchedNormal.z)), vec3<f32>(0.0, 0.0, 1.0));
  return safeNormalize(basis * localNormal, normal);
}

fn ggxReflectionPdf(normal: vec3<f32>, view: vec3<f32>, light: vec3<f32>, alpha: f32) -> f32 {
  let halfVector = safeNormalize(view + light, normal);
  let noV = max(dot(normal, view), 0.0);
  let noH = max(dot(normal, halfVector), 0.0);
  let voH = max(dot(view, halfVector), 0.0);
  let loH = max(abs(dot(light, halfVector)), 1e-7);
  let visibleNormalPdf = ggxDistribution(noH, alpha) * smithG1(noV, alpha) * voH / max(noV, 1e-7);
  return visibleNormalPdf / (4.0 * loH);
}

fn reflectionBrdf(
  normal: vec3<f32>,
  view: vec3<f32>,
  light: vec3<f32>,
  baseColor: vec3<f32>,
  roughness: f32,
  metallic: f32,
  transmission: f32,
  clearcoat: f32,
  clearcoatRoughness: f32,
) -> vec3<f32> {
  let noV = max(dot(normal, view), 0.0);
  let noL = max(dot(normal, light), 0.0);
  if (noV <= 0.0 || noL <= 0.0) { return vec3<f32>(0.0); }
  let halfVector = safeNormalize(view + light, normal);
  let noH = max(dot(normal, halfVector), 0.0);
  let voH = max(dot(view, halfVector), 0.0);
  let alpha = max(roughness * roughness, 0.0025);
  let f0 = mix(vec3<f32>(0.04), baseColor, metallic);
  let fresnel = fresnelSchlick(voH, f0);
  let distribution = ggxDistribution(noH, alpha);
  let geometry = smithG1(noV, alpha) * smithG1(noL, alpha);
  let specular = fresnel * distribution * geometry / max(4.0 * noV * noL, 1e-7);
  let diffuse = baseColor * (1.0 - metallic) * (1.0 - transmission) * (vec3<f32>(1.0) - fresnel) / PI;
  let coatAlpha = max(clearcoatRoughness * clearcoatRoughness, 0.0025);
  let coatFresnel = fresnelSchlick(voH, vec3<f32>(0.04));
  let coat = clearcoat * 0.25 * coatFresnel
    * ggxDistribution(noH, coatAlpha)
    * smithG1(noV, coatAlpha)
    * smithG1(noL, coatAlpha)
    / max(4.0 * noV * noL, 1e-7);
  return diffuse + specular + coat;
}

fn lobeProbabilities(baseColor: vec3<f32>, metallic: f32, transmission: f32, clearcoat: f32) -> vec4<f32> {
  let diffuse = max(luminance(baseColor) * (1.0 - metallic) * (1.0 - transmission), 0.02 * (1.0 - transmission));
  let specular = mix(0.08, max(luminance(baseColor), 0.08), metallic);
  let transmitted = (1.0 - metallic) * transmission;
  let coat = clearcoat * 0.25;
  let total = diffuse + specular + transmitted + coat;
  if (total <= 1e-7) { return vec4<f32>(0.0); }
  return vec4<f32>(diffuse, specular, transmitted, coat) / total;
}

fn reflectionMixturePdf(
  normal: vec3<f32>,
  view: vec3<f32>,
  light: vec3<f32>,
  roughness: f32,
  clearcoatRoughness: f32,
  probabilities: vec4<f32>,
) -> f32 {
  let noL = max(dot(normal, light), 0.0);
  let diffusePdf = noL / PI;
  let specularPdf = ggxReflectionPdf(normal, view, light, max(roughness * roughness, 0.0025));
  let coatPdf = ggxReflectionPdf(normal, view, light, max(clearcoatRoughness * clearcoatRoughness, 0.0025));
  return probabilities.x * diffusePdf + probabilities.y * specularPdf + probabilities.w * coatPdf;
}

fn sampleBounce(
  incoming: vec3<f32>,
  geometricNormal: vec3<f32>,
  baseColor: vec3<f32>,
  roughness: f32,
  metallic: f32,
  extension: vec4<f32>,
  currentEta: f32,
  state: ptr<function, u32>,
) -> BounceSample {
  let entering = dot(incoming, geometricNormal) < 0.0;
  let normal = select(-geometricNormal, geometricNormal, entering);
  let view = -incoming;
  let transmission = clamp(extension.x, 0.0, 1.0);
  let ior = clamp(extension.y, 1.0001, 3.0);
  let clearcoat = clamp(extension.z, 0.0, 1.0);
  let clearcoatRoughness = clamp(extension.w, 0.02, 1.0);
  let probabilities = lobeProbabilities(baseColor, metallic, transmission, clearcoat);
  if (dot(probabilities, vec4<f32>(1.0)) <= 0.0) {
    return BounceSample(vec3<f32>(0.0), vec3<f32>(0.0), currentEta, 0u, 0u);
  }
  let choice = randomFloat(state);
  var direction = vec3<f32>(0.0);
  var delta = 0u;
  var nextEta = currentEta;
  if (choice < probabilities.x) {
    direction = cosineHemisphere(normal, state);
  } else if (choice < probabilities.x + probabilities.y) {
    let halfVector = sampleGGXVNDF(normal, view, max(roughness * roughness, 0.0025), state);
    direction = safeNormalize(reflect(incoming, halfVector), normal);
  } else if (choice < probabilities.x + probabilities.y + probabilities.z) {
    let etaIncident = max(currentEta, 1.0);
    let etaTransmitted = select(1.0, ior, entering);
    let etaRatio = etaIncident / etaTransmitted;
    let fresnel = dielectricFresnel(abs(dot(view, normal)), etaIncident, etaTransmitted);
    direction = refract(incoming, normal, etaRatio);
    delta = 1u;
    if (dot(direction, direction) <= 1e-20) {
      direction = reflect(incoming, normal);
      let tirWeight = vec3<f32>((1.0 - metallic) * transmission / max(probabilities.z, 1e-7));
      return BounceSample(safeNormalize(direction, normal), tirWeight, currentEta, delta, 1u);
    }
    nextEta = etaTransmitted;
    let transport = etaRatio * etaRatio;
    let tint = mix(vec3<f32>(1.0), baseColor, 0.5);
    let transmittedWeight = tint * (1.0 - metallic) * transmission * (1.0 - fresnel) * transport
      / max(probabilities.z, 1e-7);
    return BounceSample(safeNormalize(direction, -normal), transmittedWeight, nextEta, delta, 1u);
  } else {
    let halfVector = sampleGGXVNDF(normal, view, max(clearcoatRoughness * clearcoatRoughness, 0.0025), state);
    direction = safeNormalize(reflect(incoming, halfVector), normal);
  }
  let noL = max(dot(normal, direction), 0.0);
  if (noL <= 0.0) { return BounceSample(direction, vec3<f32>(0.0), currentEta, 0u, 0u); }
  let pdf = reflectionMixturePdf(normal, view, direction, roughness, clearcoatRoughness, probabilities);
  let brdf = reflectionBrdf(normal, view, direction, baseColor, roughness, metallic, transmission, clearcoat, clearcoatRoughness);
  let weight = brdf * noL / max(pdf, 1e-7);
  return BounceSample(direction, weight, nextEta, delta, select(0u, 1u, all(weight >= vec3<f32>(0.0))));
}

fn directLightSample(
  position: vec3<f32>,
  normal: vec3<f32>,
  view: vec3<f32>,
  throughput: vec3<f32>,
  baseColor: vec3<f32>,
  roughness: f32,
  metallic: f32,
  extension: vec4<f32>,
  secondaryOffset: f32,
  state: ptr<function, u32>,
) -> ShadowRecord {
  let sunAvailable = frame.sunDirectionIntensity.w > 0.0;
  let environmentAvailable = frame.environmentZenithIntensity.w > 0.0;
  if (!sunAvailable && !environmentAvailable) {
    return ShadowRecord(vec4<f32>(0.0), vec4<f32>(0.0), vec4<f32>(0.0));
  }
  // A directional light is a delta emitter: BSDF continuation cannot sample it,
  // so always reserve next-event estimation for the sun when it is present.
  // The procedural sky is then sampled by ordinary path continuation. Randomly
  // choosing between the two made the sun (and its shadow) disappear on half of
  // all one-sample histories after a camera, scene, or quality reset.
  let chooseSun = sunAvailable;
  var direction = vec3<f32>(0.0, 1.0, 0.0);
  var incomingRadiance = vec3<f32>(0.0);
  var lightPdf = 1.0;
  if (chooseSun) {
    direction = safeNormalize(frame.sunDirectionIntensity.xyz, vec3<f32>(0.4, 0.8, 0.3));
    incomingRadiance = frame.sunColor.rgb * frame.sunDirectionIntensity.w;
  } else {
    direction = cosineHemisphere(normal, state);
    incomingRadiance = environmentRadiance(direction);
    lightPdf = max(dot(normal, direction), 0.0) / PI;
  }
  let noL = max(dot(normal, direction), 0.0);
  let transmission = clamp(extension.x, 0.0, 1.0);
  let clearcoat = clamp(extension.z, 0.0, 1.0);
  let clearcoatRoughness = clamp(extension.w, 0.02, 1.0);
  let brdf = reflectionBrdf(normal, view, direction, baseColor, roughness, metallic, transmission, clearcoat, clearcoatRoughness);
  let contribution = throughput * brdf * noL * incomingRadiance
    / max(lightPdf, 1e-7);
  return ShadowRecord(
    vec4<f32>(position + normal * secondaryOffset, frame.trace.x),
    vec4<f32>(direction, 0.0),
    vec4<f32>(contribution, 0.0),
  );
}
`;

export const WAVEFRONT_SHADE_WGSL = /* wgsl */ `
${FRAME_WGSL}
${PATH_TYPES_WGSL}
${MATERIAL_WGSL}

@group(1) @binding(0) var<storage, read_write> hitQueue: HitQueue;
@group(1) @binding(1) var<storage, read_write> inputRays: RayQueue;
@group(1) @binding(2) var<storage, read_write> outputRays: RayQueue;
@group(1) @binding(3) var<storage, read_write> shadowQueue: ShadowQueue;
@group(1) @binding(4) var<storage, read_write> pathStates: array<PathState>;

@compute @workgroup_size(${WAVEFRONT_WORKGROUP_SIZE})
fn shadeHits(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let index = linearInvocationIndex(invocation);
  let count = min(atomicLoad(&hitQueue.count), hitQueue.capacity);
  if (index >= count || index >= arrayLength(&hitQueue.records)
      || index >= arrayLength(&inputRays.records)) { return; }
  let hit = hitQueue.records[index];
  let ray = inputRays.records[index];
  let localPixel = bitcast<u32>(hit.normalPixel.w);
  if (localPixel >= arrayLength(&pathStates)) { return; }
  var path = pathStates[localPixel];
  var seed = bitcast<u32>(path.radianceSeed.w);
  let packedMaterial = hit.positionMaterial.w;
  if (packedMaterial < 0.0) {
    let traceStatus = u32(hit.offsetSource.z);
    // When a sun is present, direct-light NEE is dedicated to that delta
    // emitter, so an ordinary continuation miss is the sky estimator. With no
    // sun, directLightSample already samples the sky and only primary/delta
    // misses add it here to avoid counting the same estimator twice.
    let skySampledByContinuation = frame.sunDirectionIntensity.w > 0.0;
    if (traceStatus == TRACE_STATUS_CLEAR
        && (bounce.bounceIndex == 0u || path.throughputEta.w < 0.0 || skySampledByContinuation)) {
      path.radianceSeed = vec4<f32>(
        path.radianceSeed.xyz + path.throughputEta.xyz * environmentRadiance(ray.directionPixel.xyz),
        path.radianceSeed.w,
      );
    }
    path.throughputEta = vec4<f32>(vec3<f32>(0.0), path.throughputEta.w);
    path.radianceSeed = vec4<f32>(path.radianceSeed.xyz, bitcast<f32>(seed));
    pathStates[localPixel] = path;
    return;
  }
  let materialIndex = bitcast<u32>(packedMaterial);
  let base = materialBase(materialIndex);
  let parameters = materialParameters(materialIndex);
  let extension = materialExtension(materialIndex);
  let roughness = clamp(parameters.x, 0.02, 1.0);
  let metallic = clamp(parameters.y, 0.0, 1.0);
  let emission = materialEmission(materialIndex);
  let geometricNormal = safeNormalize(hit.normalPixel.xyz, vec3<f32>(0.0, 1.0, 0.0));
  let entering = dot(ray.directionPixel.xyz, geometricNormal) < 0.0;
  let normal = select(-geometricNormal, geometricNormal, entering);
  let view = -ray.directionPixel.xyz;
  path.radianceSeed = vec4<f32>(
    path.radianceSeed.xyz + path.throughputEta.xyz * emission,
    path.radianceSeed.w,
  );

  let direct = directLightSample(
    hit.positionMaterial.xyz,
    normal,
    view,
    path.throughputEta.xyz,
    base.rgb,
    roughness,
    metallic,
    extension,
    hit.offsetSource.x,
    &seed,
  );
  if (dot(direct.contributionPixel.xyz, direct.contributionPixel.xyz) > 0.0) {
    let shadowIndex = atomicAdd(&shadowQueue.count, 1u);
    if (shadowIndex < shadowQueue.capacity && shadowIndex < arrayLength(&shadowQueue.records)) {
      var stored = direct;
      stored.contributionPixel = vec4<f32>(stored.contributionPixel.xyz, bitcast<f32>(localPixel));
      shadowQueue.records[shadowIndex] = stored;
    } else {
      atomicAdd(&shadowQueue.overflow, 1u);
    }
  }

  if (bounce.bounceIndex + 1u >= bounce.maximumBounces) {
    path.throughputEta = vec4<f32>(vec3<f32>(0.0), path.throughputEta.w);
    path.radianceSeed = vec4<f32>(path.radianceSeed.xyz, bitcast<f32>(seed));
    pathStates[localPixel] = path;
    return;
  }
  let currentEta = max(abs(path.throughputEta.w), 1.0);
  let sampled = sampleBounce(
    ray.directionPixel.xyz,
    geometricNormal,
    base.rgb,
    roughness,
    metallic,
    extension,
    currentEta,
    &seed,
  );
  if (sampled.valid == 0u) {
    path.throughputEta = vec4<f32>(vec3<f32>(0.0), path.throughputEta.w);
    path.radianceSeed = vec4<f32>(path.radianceSeed.xyz, bitcast<f32>(seed));
    pathStates[localPixel] = path;
    return;
  }
  path.throughputEta = vec4<f32>(
    path.throughputEta.xyz * sampled.weight,
    select(sampled.eta, -sampled.eta, sampled.delta != 0u),
  );
  if (bounce.bounceIndex >= 3u) {
    let survival = clamp(max(path.throughputEta.x, max(path.throughputEta.y, path.throughputEta.z)), 0.05, 0.95);
    if (randomFloat(&seed) >= survival) {
      path.throughputEta = vec4<f32>(vec3<f32>(0.0), path.throughputEta.w);
    } else {
      path.throughputEta = vec4<f32>(path.throughputEta.xyz / survival, path.throughputEta.w);
    }
  }
  if (!all(path.throughputEta.xyz >= vec3<f32>(0.0))
      || !finiteScalar(path.throughputEta.x)
      || !finiteScalar(path.throughputEta.y)
      || !finiteScalar(path.throughputEta.z)) {
    path.throughputEta = vec4<f32>(vec3<f32>(0.0), path.throughputEta.w);
  }
  if (dot(path.throughputEta.xyz, path.throughputEta.xyz) > 0.0) {
    let outputIndex = atomicAdd(&outputRays.count, 1u);
    if (outputIndex < outputRays.capacity && outputIndex < arrayLength(&outputRays.records)) {
      let offsetNormal = select(normal, -normal, dot(sampled.direction, normal) < 0.0);
      outputRays.records[outputIndex] = PathRay(
        vec4<f32>(hit.positionMaterial.xyz + offsetNormal * hit.offsetSource.x, 0.0),
        vec4<f32>(sampled.direction, bitcast<f32>(localPixel)),
      );
    } else {
      atomicAdd(&outputRays.overflow, 1u);
      path.throughputEta = vec4<f32>(vec3<f32>(0.0), path.throughputEta.w);
    }
  }
  path.radianceSeed = vec4<f32>(path.radianceSeed.xyz, bitcast<f32>(seed));
  pathStates[localPixel] = path;
}
`;

export const WAVEFRONT_SHADOW_WGSL = /* wgsl */ `
${FRAME_WGSL}
${PATH_TYPES_WGSL}
${SCENE_WGSL}

@group(1) @binding(0) var<storage, read_write> shadowQueue: ShadowQueue;
@group(1) @binding(1) var<storage, read_write> pathStates: array<PathState>;

@compute @workgroup_size(${WAVEFRONT_WORKGROUP_SIZE})
fn resolveShadows(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let index = linearInvocationIndex(invocation);
  let count = min(atomicLoad(&shadowQueue.count), shadowQueue.capacity);
  if (index >= count || index >= arrayLength(&shadowQueue.records)) { return; }
  let shadow = shadowQueue.records[index];
  let localPixel = bitcast<u32>(shadow.contributionPixel.w);
  if (localPixel >= arrayLength(&pathStates)) { return; }
  let occluder = traceScene(
    shadow.originMaximum.xyz,
    shadow.directionPadding.xyz,
    0.0,
    shadow.originMaximum.w,
    frame.counts.w,
  );
  // Only a certified clear traversal contributes light. Exhausted and invalid
  // shadow rays fail closed so finite quality budgets cannot create leaks.
  if (occluder.status == TRACE_STATUS_CLEAR) {
    var path = pathStates[localPixel];
    path.radianceSeed = vec4<f32>(
      path.radianceSeed.xyz + shadow.contributionPixel.xyz,
      path.radianceSeed.w,
    );
    pathStates[localPixel] = path;
  }
}
`;

export const WAVEFRONT_FINALIZE_WGSL = /* wgsl */ `
${FRAME_WGSL}
${PATH_TYPES_WGSL}

@group(1) @binding(0) var<storage, read> pathStates: array<PathState>;
@group(1) @binding(1) var<storage, read_write> accumulation: array<vec4<f32>>;

@compute @workgroup_size(${WAVEFRONT_WORKGROUP_SIZE})
fn finalizeSample(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let localIndex = linearInvocationIndex(invocation);
  if (localIndex >= frame.dispatch.z || localIndex >= arrayLength(&pathStates)) { return; }
  let globalIndex = frame.dispatch.y + localIndex;
  if (globalIndex >= arrayLength(&accumulation)) { return; }
  var radiance = pathStates[localIndex].radianceSeed.xyz;
  if (!finiteScalar(radiance.x) || !finiteScalar(radiance.y) || !finiteScalar(radiance.z)) {
    radiance = vec3<f32>(0.0);
  }
  let maximumChannel = max(radiance.x, max(radiance.y, radiance.z));
  if (maximumChannel > frame.trace.w) {
    radiance = radiance * (frame.trace.w / maximumChannel);
  }
  let previous = accumulation[globalIndex];
  accumulation[globalIndex] = vec4<f32>(previous.rgb + max(radiance, vec3<f32>(0.0)), previous.w + 1.0);
}
`;

export const WAVEFRONT_SHADER_SOURCES = Object.freeze({
  generate: WAVEFRONT_GENERATE_WGSL,
  intersect: WAVEFRONT_INTERSECT_WGSL,
  shade: WAVEFRONT_SHADE_WGSL,
  shadow: WAVEFRONT_SHADOW_WGSL,
  finalize: WAVEFRONT_FINALIZE_WGSL,
});
