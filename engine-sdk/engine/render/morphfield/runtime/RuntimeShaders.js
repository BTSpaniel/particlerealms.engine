// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const FRAME_UNIFORMS_WGSL = /* wgsl */ `
struct FrameUniforms {
  invViewProj: mat4x4<f32>,
  viewProj: mat4x4<f32>,
  cameraPosition: vec4<f32>,
  resolutionTime: vec4<f32>,
  sunDirection: vec4<f32>,
  sunColor: vec4<f32>,
  skyColor: vec4<f32>,
  frameIndex: u32,
  fieldletCount: u32,
  maxTraceSteps: u32,
  maxBounces: u32,
  mode: u32,
  sceneRevision: u32,
  historySamples: u32,
  flags: u32,
  maxDistance: f32,
  hitEpsilon: f32,
  exposure: f32,
  outputTransfer: f32,
}
`;

export const FIELDLET_SCENE_WGSL = /* wgsl */ `
struct FieldletHeader {
  boundsRef: u32,
  payloadRef: u32,
  metadata: u32,
  certificateRef: u32,
}

struct SpatialRecord {
  minimum: vec3<f32>,
  escape: u32,
  maximum: vec3<f32>,
  flags: u32,
  metadata: vec4<u32>,
}

struct DistanceSample {
  distance: f32,
  errorMax: f32,
  lipschitzMax: f32,
  fallbackBand: f32,
  materialIndex: u32,
  sourceIndex: u32,
  valid: u32,
}

@group(0) @binding(1) var<storage, read> fieldletHeaders: array<FieldletHeader>;
@group(0) @binding(2) var<storage, read> payloadRecords: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> resolvedCertificates: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> materialRecords: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read> analyticProgram: array<vec2<u32>>;
@group(0) @binding(6) var<storage, read> analyticParameters: array<vec4<f32>>;
@group(0) @binding(8) var<storage, read> spatialRecords: array<SpatialRecord>;

const SPATIAL_RECORD_MAGIC: u32 = 0x4d464233u;
const SPATIAL_INVALID_REF: u32 = 0xffffffffu;
const FIELDLET_FAMILY_ANALYTIC: u32 = 0u;
const FIELDLET_FAMILY_SPARSE_RESIDUAL: u32 = 1u;
const FIELDLET_SUBTYPE_ANALYTIC_PROGRAM: u32 = 0u;
const FIELDLET_SUBTYPE_SAMPLED_FIELD: u32 = 0u;
const FIELDLET_SUBTYPE_ANALYTIC_PLUS_RESIDUAL: u32 = 1u;
const FIELDLET_QUERY_SURFACE: u32 = 0x2u;
const FIELDLET_QUERY_COLLISION: u32 = 0x20u;
const FIELDLET_FLAG_CERTIFIED_SURFACE: u32 = 0x10u;
const FIELDLET_FLAG_CERTIFIED_COLLISION: u32 = 0x80u;

fn finiteScalar(value: f32) -> bool {
  return value == value && abs(value) <= 3.402823466e+38;
}

fn safeNormalize(value: vec3<f32>, fallback: vec3<f32>) -> vec3<f32> {
  let lengthSquared = dot(value, value);
  if (lengthSquared <= 1e-12) { return fallback; }
  return value * inverseSqrt(lengthSquared);
}

fn rotateQuaternion(value: vec3<f32>, quaternionInput: vec4<f32>) -> vec3<f32> {
  let fallback = vec4<f32>(0.0, 0.0, 0.0, 1.0);
  let quaternion = select(fallback, quaternionInput, dot(quaternionInput, quaternionInput) > 1e-12);
  let normalized = quaternion * inverseSqrt(max(dot(quaternion, quaternion), 1e-12));
  return value + 2.0 * cross(normalized.xyz, cross(normalized.xyz, value) + normalized.w * value);
}

fn sdfBox(point: vec3<f32>, halfExtents: vec3<f32>) -> f32 {
  let delta = abs(point) - halfExtents;
  return length(max(delta, vec3<f32>(0.0))) + min(max(delta.x, max(delta.y, delta.z)), 0.0);
}

fn sdfCapsuleY(point: vec3<f32>, radius: f32, halfHeight: f32) -> f32 {
  let closest = vec3<f32>(0.0, clamp(point.y, -halfHeight, halfHeight), 0.0);
  return length(point - closest) - radius;
}

fn distanceToAabb(point: vec3<f32>, bounds: SpatialRecord) -> f32 {
  let center = (bounds.minimum.xyz + bounds.maximum.xyz) * 0.5;
  let halfExtents = max((bounds.maximum.xyz - bounds.minimum.xyz) * 0.5, vec3<f32>(0.0));
  return sdfBox(point - center, halfExtents);
}

fn spatialTrailer() -> SpatialRecord {
  return spatialRecords[arrayLength(&spatialRecords) - 1u];
}

fn hasValidatedSpatialBvh(fieldletCount: u32) -> bool {
  let recordCount = arrayLength(&spatialRecords);
  if (recordCount < 2u) { return false; }
  let trailer = spatialRecords[recordCount - 1u];
  let boundCount = trailer.metadata.x;
  let nodeCount = trailer.metadata.y;
  let root = trailer.metadata.z;
  return trailer.metadata.w == SPATIAL_RECORD_MAGIC
    && fieldletCount <= arrayLength(&fieldletHeaders)
    && nodeCount > 0u
    && root < nodeCount
    && boundCount + nodeCount + fieldletCount + 1u == recordCount;
}

fn fieldletBound(boundsRef: u32) -> SpatialRecord {
  return spatialRecords[boundsRef];
}

fn spatialBoundCount() -> u32 {
  let recordCount = arrayLength(&spatialRecords);
  if (recordCount == 0u) { return 0u; }
  let trailer = spatialRecords[recordCount - 1u];
  if (trailer.metadata.w != SPATIAL_RECORD_MAGIC || trailer.metadata.x >= recordCount) { return 0u; }
  return trailer.metadata.x;
}

fn validBoundsRef(boundsRef: u32) -> bool {
  return boundsRef < spatialBoundCount();
}

fn isCertifiedAnalyticSurface(header: FieldletHeader) -> bool {
  let subtype = header.metadata & 0xFFFu;
  let family = (header.metadata >> 12u) & 0xFu;
  let queryMask = (header.metadata >> 16u) & 0x3Fu;
  let flags = (header.metadata >> 22u) & 0x3FFu;
  return family == FIELDLET_FAMILY_ANALYTIC
    && subtype == FIELDLET_SUBTYPE_ANALYTIC_PROGRAM
    && (queryMask & FIELDLET_QUERY_SURFACE) != 0u
    && (flags & FIELDLET_FLAG_CERTIFIED_SURFACE) != 0u;
}

fn isCertifiedAnalyticCollision(header: FieldletHeader) -> bool {
  let subtype = header.metadata & 0xFFFu;
  let family = (header.metadata >> 12u) & 0xFu;
  let queryMask = (header.metadata >> 16u) & 0x3Fu;
  let flags = (header.metadata >> 22u) & 0x3FFu;
  return family == FIELDLET_FAMILY_ANALYTIC
    && subtype == FIELDLET_SUBTYPE_ANALYTIC_PROGRAM
    && (queryMask & FIELDLET_QUERY_COLLISION) != 0u
    && (flags & FIELDLET_FLAG_CERTIFIED_COLLISION) != 0u;
}

fn isCertifiedResidualSurface(header: FieldletHeader) -> bool {
  let subtype = header.metadata & 0xFFFu;
  let family = (header.metadata >> 12u) & 0xFu;
  let queryMask = (header.metadata >> 16u) & 0x3Fu;
  let flags = (header.metadata >> 22u) & 0x3FFu;
  return family == FIELDLET_FAMILY_SPARSE_RESIDUAL
    && subtype <= FIELDLET_SUBTYPE_ANALYTIC_PLUS_RESIDUAL
    && (queryMask & FIELDLET_QUERY_SURFACE) != 0u
    && (flags & FIELDLET_FLAG_CERTIFIED_SURFACE) != 0u;
}

fn isCertifiedResidualCollision(header: FieldletHeader) -> bool {
  let subtype = header.metadata & 0xFFFu;
  let family = (header.metadata >> 12u) & 0xFu;
  let queryMask = (header.metadata >> 16u) & 0x3Fu;
  let flags = (header.metadata >> 22u) & 0x3FFu;
  return family == FIELDLET_FAMILY_SPARSE_RESIDUAL
    && subtype <= FIELDLET_SUBTYPE_ANALYTIC_PLUS_RESIDUAL
    && (queryMask & FIELDLET_QUERY_COLLISION) != 0u
    && (flags & FIELDLET_FLAG_CERTIFIED_COLLISION) != 0u;
}

fn isCertifiedSurface(header: FieldletHeader) -> bool {
  return isCertifiedAnalyticSurface(header) || isCertifiedResidualSurface(header);
}

fn isCertifiedCollision(header: FieldletHeader) -> bool {
  return isCertifiedAnalyticCollision(header) || isCertifiedResidualCollision(header);
}

fn directPrimitiveDistance(point: vec3<f32>, header: FieldletHeader) -> f32 {
  let payloadBase = header.payloadRef * 4u;
  if (payloadBase + 3u >= arrayLength(&payloadRecords)) { return 1e20; }
  let position = payloadRecords[payloadBase];
  let shape = payloadRecords[payloadBase + 1u];
  let subtype = u32(max(shape.w, 0.0));
  var distance = 1e20;
  if (subtype == 0u) {
    // A sphere is rotationally invariant. This branch is the dominant
    // simulation-stress workload, so do not normalize a quaternion and apply
    // two cross products for every sphere at every certified trace step.
    distance = length(point - position.xyz) - max(abs(position.w), 1e-7);
  } else if (subtype == 1u) {
    let rotation = payloadRecords[payloadBase + 2u];
    let localPoint = rotateQuaternion(point - position.xyz, vec4<f32>(-rotation.xyz, rotation.w));
    distance = sdfBox(localPoint, max(abs(shape.xyz), vec3<f32>(1e-7)));
  } else if (subtype == 2u) {
    let rotation = payloadRecords[payloadBase + 2u];
    let localPoint = rotateQuaternion(point - position.xyz, vec4<f32>(-rotation.xyz, rotation.w));
    distance = sdfCapsuleY(localPoint, max(abs(position.w), 1e-7), max(abs(shape.y), 0.0));
  }
  return distance;
}

fn parameterPrimitiveDistance(point: vec3<f32>, parameterRef: u32, opcode: u32) -> f32 {
  let parameterBase = parameterRef * 4u;
  if (parameterBase + 3u >= arrayLength(&analyticParameters)) { return 1e20; }
  let translationScale = analyticParameters[parameterBase];
  let shape = analyticParameters[parameterBase + 2u];
  let scale = max(abs(translationScale.w), 1e-7);
  var distance = 1e20;
  if (opcode == 1u) {
    let localPoint = (point - translationScale.xyz) / scale;
    distance = length(localPoint) - max(abs(shape.x), 1e-7);
  } else if (opcode == 2u) {
    let rotation = analyticParameters[parameterBase + 1u];
    let localPoint = rotateQuaternion(point - translationScale.xyz, vec4<f32>(-rotation.xyz, rotation.w)) / scale;
    distance = sdfBox(localPoint, max(abs(shape.xyz), vec3<f32>(1e-7)));
  } else if (opcode == 3u) {
    let rotation = analyticParameters[parameterBase + 1u];
    let localPoint = rotateQuaternion(point - translationScale.xyz, vec4<f32>(-rotation.xyz, rotation.w)) / scale;
    distance = sdfCapsuleY(localPoint, max(abs(shape.x), 1e-7), max(abs(shape.y), 0.0));
  }
  return distance * scale;
}

fn programDistance(point: vec3<f32>, programOffset: u32, programLength: u32) -> f32 {
  if (programLength == 0u || programLength > 64u || programOffset + programLength > arrayLength(&analyticProgram)) {
    return 1e20;
  }
  var stack: array<f32, 32>;
  var stackDepth = 0u;
  for (var instructionIndex = 0u; instructionIndex < programLength; instructionIndex = instructionIndex + 1u) {
    let instruction = analyticProgram[programOffset + instructionIndex];
    let opcode = instruction.x;
    if (opcode >= 1u && opcode <= 3u) {
      if (stackDepth >= 32u) { return 1e20; }
      stack[stackDepth] = parameterPrimitiveDistance(point, instruction.y, opcode);
      stackDepth = stackDepth + 1u;
    } else if (opcode >= 16u && opcode <= 18u) {
      if (stackDepth < 2u) { return 1e20; }
      let right = stack[stackDepth - 1u];
      let left = stack[stackDepth - 2u];
      stackDepth = stackDepth - 1u;
      if (opcode == 16u) {
        stack[stackDepth - 1u] = min(left, right);
      } else if (opcode == 17u) {
        stack[stackDepth - 1u] = max(left, right);
      } else {
        stack[stackDepth - 1u] = max(left, -right);
      }
    } else {
      return 1e20;
    }
  }
  if (stackDepth != 1u) { return 1e20; }
  return stack[0];
}

fn gridParameterScalar(valuesRef: u32, scalarIndex: u32) -> f32 {
  let vectorIndex = valuesRef + scalarIndex / 4u;
  if (vectorIndex >= arrayLength(&analyticParameters)) { return 0.0; }
  return analyticParameters[vectorIndex][scalarIndex & 3u];
}

fn gridSampleTrilinear(gridPoint: vec3<f32>, dimensions: vec3<u32>, valuesRef: u32) -> f32 {
  let cellMaximum = dimensions - vec3<u32>(1u);
  let coordinate = clamp(gridPoint, vec3<f32>(0.0), vec3<f32>(cellMaximum));
  let lower = min(vec3<u32>(floor(coordinate)), dimensions - vec3<u32>(2u));
  let fraction = coordinate - vec3<f32>(lower);
  let rowStride = dimensions.x;
  let planeStride = dimensions.x * dimensions.y;
  let i000 = lower.x + lower.y * rowStride + lower.z * planeStride;
  let i100 = i000 + 1u;
  let i010 = i000 + rowStride;
  let i110 = i010 + 1u;
  let i001 = i000 + planeStride;
  let i101 = i001 + 1u;
  let i011 = i001 + rowStride;
  let i111 = i011 + 1u;
  let x00 = mix(gridParameterScalar(valuesRef, i000), gridParameterScalar(valuesRef, i100), fraction.x);
  let x10 = mix(gridParameterScalar(valuesRef, i010), gridParameterScalar(valuesRef, i110), fraction.x);
  let x01 = mix(gridParameterScalar(valuesRef, i001), gridParameterScalar(valuesRef, i101), fraction.x);
  let x11 = mix(gridParameterScalar(valuesRef, i011), gridParameterScalar(valuesRef, i111), fraction.x);
  return mix(mix(x00, x10, fraction.y), mix(x01, x11, fraction.y), fraction.z);
}

fn gridFieldDistance(point: vec3<f32>, header: FieldletHeader) -> f32 {
  let payloadBase = header.payloadRef * 4u;
  if (payloadBase + 3u >= arrayLength(&payloadRecords)) { return 1e20; }
  let headerRef = u32(max(payloadRecords[payloadBase + 3u].x, 0.0));
  if (headerRef + 5u >= arrayLength(&analyticParameters)) { return 1e20; }
  let grid = analyticParameters[headerRef];
  let localMinimum = analyticParameters[headerRef + 1u];
  let localMaximum = analyticParameters[headerRef + 2u];
  let translationScale = analyticParameters[headerRef + 3u];
  let rotation = analyticParameters[headerRef + 4u];
  let baseProgram = analyticParameters[headerRef + 5u];
  let dimensions = vec3<u32>(grid.xyz);
  if (any(dimensions < vec3<u32>(2u))) { return 1e20; }
  let scale = max(abs(translationScale.w), 1e-7);
  let localPoint = rotateQuaternion(point - translationScale.xyz, vec4<f32>(-rotation.xyz, rotation.w)) / scale;
  let inside = all(localPoint >= localMinimum.xyz) && all(localPoint <= localMaximum.xyz);
  let clampedPoint = clamp(localPoint, localMinimum.xyz, localMaximum.xyz);
  let gridExtent = localMaximum.xyz - localMinimum.xyz;
  if (any(gridExtent <= vec3<f32>(0.0))) { return 1e20; }
  let gridPoint = ((clampedPoint - localMinimum.xyz) / gridExtent) * vec3<f32>(dimensions - vec3<u32>(1u));
  let gridValue = gridSampleTrilinear(gridPoint, dimensions, u32(max(localMaximum.w, 0.0)));
  let gridKind = u32(max(grid.w, 0.0));
  if (gridKind == FIELDLET_SUBTYPE_SAMPLED_FIELD) {
    let outside = length(max(max(localMinimum.xyz - localPoint, localPoint - localMaximum.xyz), vec3<f32>(0.0)));
    return select(max(gridValue, 0.0) + outside, gridValue, inside) * scale;
  }
  if (gridKind == FIELDLET_SUBTYPE_ANALYTIC_PLUS_RESIDUAL) {
    let baseLength = u32(max(baseProgram.y, 0.0));
    if (baseLength == 0u) { return 1e20; }
    let residual = select(0.0, gridValue * scale, inside);
    return programDistance(point, u32(max(baseProgram.x, 0.0)), baseLength) + residual;
  }
  return 1e20;
}

fn fieldletDistance(point: vec3<f32>, header: FieldletHeader) -> f32 {
  let payloadBase = header.payloadRef * 4u;
  if (payloadBase + 3u >= arrayLength(&payloadRecords)) { return 1e20; }
  let payloadAux = payloadRecords[payloadBase + 3u];
  let family = (header.metadata >> 12u) & 0xFu;
  if (family == FIELDLET_FAMILY_SPARSE_RESIDUAL) {
    return gridFieldDistance(point, header);
  }
  let programLength = u32(max(payloadAux.y, 0.0));
  if (programLength > 0u) {
    return programDistance(point, u32(max(payloadAux.x, 0.0)), programLength);
  }
  let shapeCode = u32(max(payloadRecords[payloadBase + 1u].w, 0.0));
  if (shapeCode <= 2u) { return directPrimitiveDistance(point, header); }
  return 1e20;
}

fn surfaceCertificate(fieldletIndex: u32) -> vec3<f32> {
  let certificateIndex = fieldletIndex * 4u;
  if (certificateIndex >= arrayLength(&resolvedCertificates)) { return vec3<f32>(-1.0); }
  let certificate = resolvedCertificates[certificateIndex];
  if (!finiteScalar(certificate.x) || !finiteScalar(certificate.y) || !finiteScalar(certificate.z)
      || certificate.x < 0.0 || certificate.y <= 0.0 || certificate.z < 0.0) {
    return vec3<f32>(-1.0);
  }
  return certificate.xyz;
}

fn evalSceneLinear(point: vec3<f32>, fieldletCount: u32) -> DistanceSample {
  var result = DistanceSample(1e20, 0.0, 1.0, 0.0, 0u, 0u, 0u);
  var initialized = false;
  let count = min(fieldletCount, arrayLength(&fieldletHeaders));
  for (var index = 0u; index < count; index = index + 1u) {
    let header = fieldletHeaders[index];
    if (!isCertifiedSurface(header)) { continue; }
    let payloadBase = header.payloadRef * 4u;
    if (payloadBase + 3u >= arrayLength(&payloadRecords)) { continue; }
    let payloadAux = payloadRecords[payloadBase + 3u];
    let certificate = surfaceCertificate(index);
    if (certificate.x < 0.0) { continue; }
    if (initialized && result.distance >= 0.0 && validBoundsRef(header.boundsRef)) {
      let boundDistance = distanceToAabb(point, fieldletBound(header.boundsRef));
      let certifiedCandidateFloor = boundDistance - certificate.x;
      // Equality must reach the evaluator so the stable lower-source-index
      // tie-break remains identical even when BVH order differs from source
      // order. Only a strictly larger lower bound proves irrelevance.
      if (finiteScalar(certifiedCandidateFloor) && certifiedCandidateFloor > result.distance) {
        result.errorMax = max(result.errorMax, certificate.x);
        result.lipschitzMax = max(result.lipschitzMax, certificate.y);
        result.fallbackBand = max(result.fallbackBand, certificate.z);
        continue;
      }
    }
    let primitive = fieldletDistance(point, header);
    if (!finiteScalar(primitive)) { continue; }
    let materialIndex = u32(max(payloadAux.z, 0.0));
    if (!initialized) {
      result = DistanceSample(primitive, certificate.x, certificate.y, certificate.z, materialIndex, index, 1u);
      initialized = true;
      continue;
    }
    if (primitive < result.distance || (primitive == result.distance && index < result.sourceIndex)) {
      result.distance = primitive;
      result.materialIndex = materialIndex;
      result.sourceIndex = index;
    }
    result.errorMax = max(result.errorMax, certificate.x);
    result.lipschitzMax = max(result.lipschitzMax, certificate.y);
    result.fallbackBand = max(result.fallbackBand, certificate.z);
  }
  return result;
}

fn evalSceneBvh(point: vec3<f32>, fieldletCount: u32) -> DistanceSample {
  let trailer = spatialTrailer();
  let boundCount = trailer.metadata.x;
  let nodeCount = trailer.metadata.y;
  let root = trailer.metadata.z;
  let envelope = trailer.minimum.xyz;
  let recordCount = arrayLength(&spatialRecords);
  var result = DistanceSample(1e20, envelope.x, max(envelope.y, 1.0), envelope.z, 0u, 0u, 0u);
  var nodeIndex = root;
  var traversalFailed = root >= nodeCount || boundCount >= recordCount;
  if (!traversalFailed && root >= recordCount - boundCount) {
    traversalFailed = true;
  }
  if (!traversalFailed && spatialRecords[boundCount + root].escape != SPATIAL_INVALID_REF) {
    traversalFailed = true;
  }
  // CPU validation publishes one escape reference per node. At most nodeCount
  // records can be visited; a cycle or malformed rope therefore fails closed
  // through one shared certified-linear exit instead of allocating a private
  // stack or duplicating that evaluator at every validation branch.
  for (var visit = 0u; visit < nodeCount; visit = visit + 1u) {
    if (traversalFailed) { break; }
    if (nodeIndex == SPATIAL_INVALID_REF) { return result; }
    if (nodeIndex >= nodeCount) {
      traversalFailed = true;
      break;
    }
    let node = spatialRecords[boundCount + nodeIndex];
    let isLeaf = node.metadata.w == 1u;
    let escape = node.escape;
    if (isLeaf) {
      if (node.metadata.x != SPATIAL_INVALID_REF || node.metadata.y != SPATIAL_INVALID_REF) {
        traversalFailed = true;
        break;
      }
    } else if (node.metadata.w == 0u) {
      if (node.metadata.x >= nodeCount || node.metadata.y >= nodeCount
          || node.metadata.x == nodeIndex || node.metadata.y == nodeIndex
          || node.metadata.z != SPATIAL_INVALID_REF) {
        traversalFailed = true;
        break;
      }
      let left = spatialRecords[boundCount + node.metadata.x];
      let right = spatialRecords[boundCount + node.metadata.y];
      if (left.escape != node.metadata.y || right.escape != escape) {
        traversalFailed = true;
        break;
      }
    } else {
      traversalFailed = true;
      break;
    }
    if (escape != SPATIAL_INVALID_REF && escape >= nodeCount) {
      traversalFailed = true;
      break;
    }
    let nodeFloor = distanceToAabb(point, node) - envelope.x;
    if (result.valid != 0u && result.distance >= 0.0
        && finiteScalar(nodeFloor) && nodeFloor > result.distance) {
      nodeIndex = escape;
      continue;
    }
    if (isLeaf) {
      let index = node.metadata.z;
      if (index >= fieldletCount || index >= arrayLength(&fieldletHeaders)) {
        traversalFailed = true;
        break;
      }
      let header = fieldletHeaders[index];
      if (!isCertifiedSurface(header)) {
        nodeIndex = escape;
        continue;
      }
      let payloadBase = header.payloadRef * 4u;
      if (payloadBase + 3u >= arrayLength(&payloadRecords)) {
        nodeIndex = escape;
        continue;
      }
      let certificate = surfaceCertificate(index);
      if (certificate.x < 0.0) {
        nodeIndex = escape;
        continue;
      }
      let primitive = fieldletDistance(point, header);
      if (!finiteScalar(primitive)) {
        nodeIndex = escape;
        continue;
      }
      if (result.valid == 0u || primitive < result.distance
          || (primitive == result.distance && index < result.sourceIndex)) {
        let payloadAux = payloadRecords[payloadBase + 3u];
        result.distance = primitive;
        result.materialIndex = u32(max(payloadAux.z, 0.0));
        result.sourceIndex = index;
        result.valid = 1u;
      }
      nodeIndex = escape;
      continue;
    }
    nodeIndex = node.metadata.x;
  }
  if (!traversalFailed && nodeIndex == SPATIAL_INVALID_REF) { return result; }
  return evalSceneLinear(point, fieldletCount);
}

fn evalScene(point: vec3<f32>, fieldletCount: u32) -> DistanceSample {
  if (fieldletCount < 8u || !hasValidatedSpatialBvh(fieldletCount)) {
    return evalSceneLinear(point, fieldletCount);
  }
  return evalSceneBvh(point, fieldletCount);
}

fn sceneNormal(point: vec3<f32>, fieldletCount: u32, epsilon: f32) -> vec3<f32> {
  let e = max(epsilon, 1e-5);
  let k1 = vec3<f32>(1.0, -1.0, -1.0);
  let k2 = vec3<f32>(-1.0, -1.0, 1.0);
  let k3 = vec3<f32>(-1.0, 1.0, -1.0);
  let k4 = vec3<f32>(1.0, 1.0, 1.0);
  let gradient = k1 * evalScene(point + k1 * e, fieldletCount).distance
    + k2 * evalScene(point + k2 * e, fieldletCount).distance
    + k3 * evalScene(point + k3 * e, fieldletCount).distance
    + k4 * evalScene(point + k4 * e, fieldletCount).distance;
  return safeNormalize(gradient, vec3<f32>(0.0, 1.0, 0.0));
}

fn contributingFieldletNormal(point: vec3<f32>, sourceIndex: u32, fieldletCount: u32, epsilon: f32) -> vec3<f32> {
  let count = min(fieldletCount, arrayLength(&fieldletHeaders));
  if (sourceIndex >= count) { return sceneNormal(point, fieldletCount, epsilon); }
  let header = fieldletHeaders[sourceIndex];
  if (!isCertifiedSurface(header)) { return sceneNormal(point, fieldletCount, epsilon); }
  let e = max(epsilon, 1e-5);
  let k1 = vec3<f32>(1.0, -1.0, -1.0);
  let k2 = vec3<f32>(-1.0, -1.0, 1.0);
  let k3 = vec3<f32>(-1.0, 1.0, -1.0);
  let k4 = vec3<f32>(1.0, 1.0, 1.0);
  let d1 = fieldletDistance(point + k1 * e, header);
  let d2 = fieldletDistance(point + k2 * e, header);
  let d3 = fieldletDistance(point + k3 * e, header);
  let d4 = fieldletDistance(point + k4 * e, header);
  if (!finiteScalar(d1) || !finiteScalar(d2) || !finiteScalar(d3) || !finiteScalar(d4)) {
    return sceneNormal(point, fieldletCount, epsilon);
  }
  // evalScene is a hard minimum across Fieldlets. At a traced surface its
  // selected source is the contributing branch, so its gradient is the scene
  // gradient wherever the minimum is differentiable. At an exact hard-union
  // seam the gradient is undefined; retaining the deterministic selected
  // branch is a valid stable subgradient and avoids four redundant scene-wide
  // postfix-program scans per visible hit.
  return safeNormalize(k1 * d1 + k2 * d2 + k3 * d3 + k4 * d4, vec3<f32>(0.0, 1.0, 0.0));
}

fn materialBase(materialIndexInput: u32) -> vec4<f32> {
  let count = arrayLength(&materialRecords) / 3u;
  if (count == 0u) { return vec4<f32>(0.72, 0.74, 0.8, 1.0); }
  let materialIndex = min(materialIndexInput, count - 1u);
  return materialRecords[materialIndex * 3u];
}

fn materialParams(materialIndexInput: u32) -> vec4<f32> {
  let count = arrayLength(&materialRecords) / 3u;
  if (count == 0u) { return vec4<f32>(0.45, 0.0, 1.0, 1.5); }
  let materialIndex = min(materialIndexInput, count - 1u);
  return materialRecords[materialIndex * 3u + 1u];
}

fn materialEmission(materialIndexInput: u32) -> vec3<f32> {
  let count = arrayLength(&materialRecords) / 3u;
  if (count == 0u) { return vec3<f32>(0.0); }
  let materialIndex = min(materialIndexInput, count - 1u);
  return max(materialRecords[materialIndex * 3u + 2u].rgb, vec3<f32>(0.0));
}
`;

function withoutPointBvh(sceneSource) {
  const bvhStart = sceneSource.indexOf("fn evalSceneBvh(");
  const normalStart = sceneSource.indexOf("fn sceneNormal(", bvhStart);
  if (bvhStart < 0 || normalStart <= bvhStart) {
    throw new Error("MorphField: unable to derive the linear Fieldlet shader source");
  }
  return `${sceneSource.slice(0, bvhStart)}fn evalScene(point: vec3<f32>, fieldletCount: u32) -> DistanceSample {
  return evalSceneLinear(point, fieldletCount);
}\n\n${sceneSource.slice(normalStart)}`;
}

// Small scenes must not pay Dawn's backend-compilation cost for an unreachable
// BVH traversal. Both variants share every evaluator, certificate, material,
// ray, and lighting function; only the point-local dispatch body differs.
export const FIELDLET_SCENE_LINEAR_WGSL = withoutPointBvh(FIELDLET_SCENE_WGSL);

// Screen-tile acceleration only tightens the certified ray start. Fieldlet
// evaluation itself remains byte-identical to the lean linear authority.
export const FIELDLET_SCENE_TILE_LINEAR_WGSL = FIELDLET_SCENE_LINEAR_WGSL;

export const TRACE_SHADER_WGSL = /* wgsl */ `
${FRAME_UNIFORMS_WGSL}
@group(0) @binding(0) var<uniform> frame: FrameUniforms;
${FIELDLET_SCENE_WGSL}
@group(0) @binding(7) var<storage, read_write> pixelMetadata: array<vec2<u32>>;

const PI: f32 = 3.141592653589793;
const MAX_TRACE_STEPS: u32 = 192u;
const RAY_STATUS_CLEAR: u32 = 0u;
const RAY_STATUS_HIT: u32 = 1u;
const RAY_STATUS_EXHAUSTED: u32 = 2u;
const RAY_STATUS_INVALID: u32 = 3u;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
}

struct RayHit {
  valid: u32,
  status: u32,
  distance: f32,
  position: vec3<f32>,
  normal: vec3<f32>,
  materialIndex: u32,
  sourceIndex: u32,
  steps: u32,
}

struct RayInterval {
  valid: u32,
  entry: f32,
  exit: f32,
}

struct FragmentOutput {
  @location(0) hdrTransmittance: vec4<f32>,
  @location(1) normalLinearDepth: vec4<f32>,
  @location(2) albedoRoughness: vec4<f32>,
  @location(3) motionMetalMaterial: vec4<f32>,
  @builtin(frag_depth) depth: f32,
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  var output: VertexOutput;
  output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  return output;
}

fn unproject(ndc: vec2<f32>, depth: f32) -> vec3<f32> {
  let world = frame.invViewProj * vec4<f32>(ndc, depth, 1.0);
  return world.xyz / max(abs(world.w), 1e-8) * sign(world.w);
}

fn rayAxisInterval(origin: f32, direction: f32, minimum: f32, maximum: f32) -> vec2<f32> {
  if (abs(direction) <= 1e-20) {
    if (origin < minimum || origin > maximum) { return vec2<f32>(1.0, -1.0); }
    return vec2<f32>(-1e20, 1e20);
  }
  let first = (minimum - origin) / direction;
  let second = (maximum - origin) / direction;
  return vec2<f32>(min(first, second), max(first, second));
}

fn rayBoundInterval(origin: vec3<f32>, direction: vec3<f32>, bounds: SpatialRecord) -> vec2<f32> {
  let x = rayAxisInterval(origin.x, direction.x, bounds.minimum.x, bounds.maximum.x);
  let y = rayAxisInterval(origin.y, direction.y, bounds.minimum.y, bounds.maximum.y);
  let z = rayAxisInterval(origin.z, direction.z, bounds.minimum.z, bounds.maximum.z);
  return vec2<f32>(max(x.x, max(y.x, z.x)), min(x.y, min(y.y, z.y)));
}

fn sceneRayInterval(origin: vec3<f32>, direction: vec3<f32>, maxDistance: f32) -> RayInterval {
  if (hasValidatedSpatialBvh(frame.fieldletCount)) {
    let trailer = spatialTrailer();
    let rootBounds = spatialRecords[trailer.metadata.x + trailer.metadata.z];
    let interval = rayBoundInterval(origin, direction, rootBounds);
    let boundedEntry = max(interval.x, 0.0);
    let boundedExit = min(interval.y, maxDistance);
    let found = boundedExit >= boundedEntry && boundedExit >= 0.0 && boundedEntry <= maxDistance;
    return RayInterval(select(0u, 1u, found), boundedEntry, boundedExit);
  }
  var hasCertifiedBounds = false;
  var found = false;
  var entry = maxDistance;
  var exit = 0.0;
  let count = min(frame.fieldletCount, arrayLength(&fieldletHeaders));
  for (var index = 0u; index < count; index = index + 1u) {
    let header = fieldletHeaders[index];
    if (!isCertifiedSurface(header) || !validBoundsRef(header.boundsRef)) { continue; }
    hasCertifiedBounds = true;
    let interval = rayBoundInterval(origin, direction, fieldletBound(header.boundsRef));
    let boundedEntry = max(interval.x, 0.0);
    let boundedExit = min(interval.y, maxDistance);
    if (boundedExit < boundedEntry || boundedExit < 0.0 || boundedEntry > maxDistance) { continue; }
    found = true;
    entry = min(entry, boundedEntry);
    exit = max(exit, boundedExit);
  }
  if (!hasCertifiedBounds) { return RayInterval(1u, 0.0, maxDistance); }
  return RayInterval(select(0u, 1u, found), entry, exit);
}

fn refineBracket(
  origin: vec3<f32>,
  direction: vec3<f32>,
  lowInput: f32,
  highInput: f32,
) -> f32 {
  var low = lowInput;
  var high = highInput;
  let lowSample = evalScene(origin + direction * low, frame.fieldletCount);
  let highSample = evalScene(origin + direction * high, frame.fieldletCount);
  if (lowSample.valid == 0u || highSample.valid == 0u
      || !finiteScalar(lowSample.distance) || !finiteScalar(highSample.distance)
      || !((lowSample.distance < 0.0 && highSample.distance >= 0.0)
        || (lowSample.distance > 0.0 && highSample.distance <= 0.0))) {
    return -1.0;
  }
  var lowDistance = lowSample.distance;
  for (var iteration = 0u; iteration < 24u; iteration = iteration + 1u) {
    if (high - low <= max(frame.hitEpsilon, 1e-7)) { break; }
    let middle = 0.5 * (low + high);
    let middleSample = evalScene(origin + direction * middle, frame.fieldletCount);
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
  sample: DistanceSample,
  threshold: f32,
) -> f32 {
  if (sample.fallbackBand <= threshold) { return -1.0; }
  let available = max(intervalExit - travel, 0.0);
  let probeStep = min(sample.fallbackBand / max(sample.lipschitzMax, 1e-6), available);
  if (!finiteScalar(probeStep) || probeStep <= 0.0) { return -1.0; }
  let probeTravel = travel + probeStep;
  let probe = evalScene(origin + direction * probeTravel, frame.fieldletCount);
  if (probe.valid == 0u || !finiteScalar(probe.distance)) { return -1.0; }
  if (signTransition(sample.distance, probe.distance)) {
    return refineBracket(origin, direction, travel, probeTravel);
  }
  return -1.0;
}

fn rayHitAt(
  origin: vec3<f32>,
  direction: vec3<f32>,
  travel: f32,
  steps: u32,
  sampleInput: DistanceSample,
  sampleAtTravel: bool,
) -> RayHit {
  let hitPosition = origin + direction * travel;
  var sample = sampleInput;
  if (!sampleAtTravel) { sample = evalScene(hitPosition, frame.fieldletCount); }
  return RayHit(
    sample.valid,
    RAY_STATUS_HIT,
    travel,
    hitPosition,
    contributingFieldletNormal(hitPosition, sample.sourceIndex, frame.fieldletCount, frame.hitEpsilon * 2.0),
    sample.materialIndex,
    sample.sourceIndex,
    steps,
  );
}

fn traceRay(
  origin: vec3<f32>,
  direction: vec3<f32>,
  minimumDistance: f32,
  maxDistance: f32,
  stepLimit: u32,
  resolveSurface: bool,
) -> RayHit {
  let interval = sceneRayInterval(origin, direction, maxDistance);
  if (interval.valid == 0u) {
    return RayHit(0u, RAY_STATUS_CLEAR, maxDistance, origin + direction * maxDistance, vec3<f32>(0.0, 1.0, 0.0), 0u, 0u, 0u);
  }
  var travel = clamp(max(interval.entry, minimumDistance), 0.0, maxDistance);
  var previousTravel = travel;
  var previousDistance = 1e20;
  var previousValid = false;
  var lastSample = DistanceSample(1e20, 0.0, 1.0, 0.0, 0u, 0u, 0u);
  var stepIndex = 0u;
  let boundedStepLimit = min(stepLimit, MAX_TRACE_STEPS);
  for (var step = 0u; step < boundedStepLimit; step = step + 1u) {
    stepIndex = step;
    if (travel > interval.exit) {
      return RayHit(0u, RAY_STATUS_CLEAR, travel, origin + direction * travel, vec3<f32>(0.0, 1.0, 0.0), lastSample.materialIndex, lastSample.sourceIndex, stepIndex);
    }
    let point = origin + direction * travel;
    let sample = evalScene(point, frame.fieldletCount);
    lastSample = sample;
    if (sample.valid == 0u || !finiteScalar(sample.distance)) {
      return RayHit(0u, RAY_STATUS_INVALID, travel, point, vec3<f32>(0.0, 1.0, 0.0), sample.materialIndex, sample.sourceIndex, step + 1u);
    }
    var acceptedTravel = travel;
    var accepted = false;
    if (previousValid && signTransition(previousDistance, sample.distance) && travel > previousTravel) {
      acceptedTravel = refineBracket(origin, direction, previousTravel, travel);
      accepted = acceptedTravel >= previousTravel;
    }
    let threshold = frame.hitEpsilon + sample.errorMax;
    if (!accepted && abs(sample.distance) <= threshold) { accepted = true; }
    if (!accepted && abs(sample.distance) <= sample.fallbackBand) {
      let fallbackTravel = isolateUncertainCrossing(origin, direction, travel, interval.exit, sample, threshold);
      if (fallbackTravel >= travel) {
        acceptedTravel = fallbackTravel;
        accepted = true;
      }
    }
    if (accepted) {
      // Occlusion callers consume only the terminal status. Avoid the extra
      // hit-point scene evaluation and four full-scene normal evaluations for
      // those rays; traversal and its fail-closed status remain identical.
      if (!resolveSurface) {
        return RayHit(
          1u,
          RAY_STATUS_HIT,
          acceptedTravel,
          origin + direction * acceptedTravel,
          vec3<f32>(0.0, 1.0, 0.0),
          sample.materialIndex,
          sample.sourceIndex,
          step + 1u,
        );
      }
      return rayHitAt(origin, direction, acceptedTravel, step + 1u, sample, acceptedTravel == travel);
    }
    let safeStep = max(abs(sample.distance) - sample.errorMax, 0.0) / max(sample.lipschitzMax, 1e-6);
    if (!finiteScalar(safeStep) || safeStep <= 0.0) {
      return RayHit(0u, RAY_STATUS_INVALID, travel, point, vec3<f32>(0.0, 1.0, 0.0), sample.materialIndex, sample.sourceIndex, step + 1u);
    }
    let remaining = max(interval.exit - travel, 0.0);
    if (remaining <= 0.0) {
      return RayHit(0u, RAY_STATUS_CLEAR, travel, point, vec3<f32>(0.0, 1.0, 0.0), sample.materialIndex, sample.sourceIndex, step + 1u);
    }
    let advance = min(safeStep, min(maxDistance * 0.125 + frame.hitEpsilon, remaining));
    let nextTravel = travel + advance;
    if (!finiteScalar(nextTravel) || nextTravel <= travel) {
      return RayHit(0u, RAY_STATUS_INVALID, travel, point, vec3<f32>(0.0, 1.0, 0.0), sample.materialIndex, sample.sourceIndex, step + 1u);
    }
    previousTravel = travel;
    previousDistance = sample.distance;
    previousValid = true;
    travel = nextTravel;
  }
  return RayHit(0u, RAY_STATUS_EXHAUSTED, travel, origin + direction * travel, vec3<f32>(0.0, 1.0, 0.0), lastSample.materialIndex, lastSample.sourceIndex, stepIndex);
}

fn hash32(valueInput: u32) -> u32 {
  var value = valueInput;
  value = value ^ (value >> 16u);
  value = value * 0x7FEB352Du;
  value = value ^ (value >> 15u);
  value = value * 0x846CA68Bu;
  return value ^ (value >> 16u);
}

fn proceduralSky(direction: vec3<f32>) -> vec3<f32> {
  let factor = clamp(direction.y * 0.5 + 0.5, 0.0, 1.0);
  let horizon = frame.skyColor.rgb * 0.45;
  return mix(horizon, frame.skyColor.rgb, factor);
}

fn environment(direction: vec3<f32>) -> vec3<f32> {
  let sky = proceduralSky(direction);
  let sun = pow(max(dot(direction, safeNormalize(frame.sunDirection.xyz, vec3<f32>(0.4, 0.8, 0.3))), 0.0), 512.0);
  return sky + frame.sunColor.rgb * sun * 12.0;
}

fn surfaceOffset(sourceIndex: u32, normalLightCosine: f32) -> f32 {
  let certificateIndex = sourceIndex * 4u;
  if (certificateIndex >= arrayLength(&resolvedCertificates)) { return frame.hitEpsilon * 2.0; }
  let certificate = resolvedCertificates[certificateIndex];
  if (!finiteScalar(certificate.x) || !finiteScalar(certificate.z) || certificate.x < 0.0 || certificate.z < 0.0) {
    return frame.hitEpsilon * 2.0;
  }
  // Keep the secondary origin outside the certified uncertainty interval, but
  // do not turn the primary hit tolerance into a multi-millimetre visual gap.
  // Exact analytic fields therefore use a 1 mm base offset at the default
  // 0.5 mm hit epsilon, while residual fields retain their larger certificate-
  // derived offset. A bounded grazing multiplier supplies the extra numerical
  // margin needed by shallow rays without erasing a 2 mm contact shadow.
  let certifiedOffset = certificate.x * 2.0 + certificate.z;
  let baseOffset = max(frame.hitEpsilon * 2.0, certifiedOffset);
  let grazingFactor = 1.0 + 0.5 * (1.0 - clamp(normalLightCosine, 0.0, 1.0));
  return baseOffset * grazingFactor;
}

fn shadowVisibility(hit: RayHit, normal: vec3<f32>, lightDirection: vec3<f32>) -> f32 {
  let normalLightCosine = max(dot(normal, lightDirection), 0.0);
  let offset = surfaceOffset(hit.sourceIndex, normalLightCosine);
  let shadow = traceRay(
    hit.position + normal * offset,
    lightDirection,
    max(frame.hitEpsilon * 0.5, offset * 0.25),
    frame.maxDistance,
    frame.maxTraceSteps,
    false,
  );
  // Only a certified traversal that exits every relevant bound is visible.
  // HIT, EXHAUSTED, and INVALID all fail closed so a reduced tier budget can
  // never turn uncertainty into a light leak.
  if (shadow.status == RAY_STATUS_CLEAR) { return 1.0; }
  return 0.0;
}

fn hybridLighting(hit: RayHit, viewDirection: vec3<f32>) -> vec3<f32> {
  let base = materialBase(hit.materialIndex).rgb;
  let params = materialParams(hit.materialIndex);
  let roughness = max(params.x, 0.04);
  let metallic = clamp(params.y, 0.0, 1.0);
  let shadingNormal = select(-hit.normal, hit.normal, dot(hit.normal, viewDirection) >= 0.0);
  let lightDirection = safeNormalize(frame.sunDirection.xyz, vec3<f32>(0.4, 0.8, 0.3));
  let halfDirection = safeNormalize(lightDirection + viewDirection, shadingNormal);
  let nDotL = max(dot(shadingNormal, lightDirection), 0.0);
  let nDotV = max(dot(shadingNormal, viewDirection), 1e-4);
  let nDotH = max(dot(shadingNormal, halfDirection), 1e-4);
  let vDotH = max(dot(viewDirection, halfDirection), 0.0);
  let alpha = roughness * roughness;
  let alpha2 = alpha * alpha;
  let denominator = nDotH * nDotH * (alpha2 - 1.0) + 1.0;
  let distribution = alpha2 / max(PI * denominator * denominator, 1e-6);
  let k = (roughness + 1.0) * (roughness + 1.0) * 0.125;
  let geometryV = nDotV / (nDotV * (1.0 - k) + k);
  let geometryL = nDotL / (nDotL * (1.0 - k) + k);
  let f0 = mix(vec3<f32>(0.04), base, metallic);
  let fresnel = f0 + (vec3<f32>(1.0) - f0) * pow(1.0 - vDotH, 5.0);
  let specular = distribution * geometryV * geometryL * fresnel / max(4.0 * nDotV * nDotL, 1e-5);
  let diffuse = base * (vec3<f32>(1.0) - fresnel) * (1.0 - metallic) / PI;
  var visibility = 1.0;
  let shadowLevel = (frame.flags >> 9u) & 0x3u;
  if (nDotL > 0.0 && shadowLevel > 0u) { visibility = shadowVisibility(hit, shadingNormal, lightDirection); }
  let direct = (diffuse + specular) * frame.sunColor.rgb * nDotL * visibility;
  let skyLuminance = dot(frame.skyColor.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
  let environmentIrradiance = proceduralSky(shadingNormal) * 0.72 + vec3<f32>(skyLuminance * 0.14);
  let environmentFresnel = f0 + (vec3<f32>(1.0) - f0) * pow(1.0 - nDotV, 5.0);
  let ambientDiffuse = base * (vec3<f32>(1.0) - f0) * (1.0 - metallic) * environmentIrradiance;
  let reflectedDirection = reflect(-viewDirection, shadingNormal);
  let reflectedEnvironment = proceduralSky(reflectedDirection);
  let ambientSpecular = reflectedEnvironment * environmentFresnel * (0.18 + 0.82 * (1.0 - roughness) * (1.0 - roughness));
  return direct + ambientDiffuse + ambientSpecular + materialEmission(hit.materialIndex);
}

fn idColor(identifier: u32) -> vec3<f32> {
  let hashed = hash32(identifier + 1u);
  return vec3<f32>(
    0.25 + 0.75 * f32(hashed & 255u) / 255.0,
    0.25 + 0.75 * f32((hashed >> 8u) & 255u) / 255.0,
    0.25 + 0.75 * f32((hashed >> 16u) & 255u) / 255.0
  );
}

fn debugSurfaceColor(hit: RayHit, shaded: vec3<f32>) -> vec3<f32> {
  let debugMode = frame.flags & 0xFFu;
  if (debugMode == 0u || debugMode == 8u) { return shaded; }
  if (debugMode == 2u) {
    let family = (fieldletHeaders[hit.sourceIndex].metadata >> 12u) & 0xFu;
    let palette = array<vec3<f32>, 4>(
      vec3<f32>(0.1, 0.85, 1.0), vec3<f32>(1.0, 0.35, 0.08),
      vec3<f32>(0.72, 0.2, 1.0), vec3<f32>(0.18, 1.0, 0.42)
    );
    return palette[min(family, 3u)];
  }
  if (debugMode == 3u) {
    let certificate = surfaceCertificate(hit.sourceIndex);
    let errorHeat = clamp(certificate.x * 64.0, 0.0, 1.0);
    let lipschitzHeat = clamp((certificate.y - 1.0) * 0.25, 0.0, 1.0);
    return vec3<f32>(errorHeat, 1.0 - errorHeat, lipschitzHeat);
  }
  if (debugMode == 4u) {
    let heat = clamp(f32(hit.steps) / f32(MAX_TRACE_STEPS), 0.0, 1.0);
    return vec3<f32>(smoothstep(0.45, 1.0, heat), 1.0 - abs(heat * 2.0 - 1.0), 1.0 - heat);
  }
  if (debugMode == 5u) { return vec3<f32>(0.08, 0.95, 0.35); }
  if (debugMode == 6u) { return hit.normal * 0.5 + vec3<f32>(0.5); }
  if (debugMode == 7u) {
    let depthValue = clamp(hit.distance / max(frame.maxDistance, 1e-6), 0.0, 1.0);
    return vec3<f32>(1.0 - depthValue);
  }
  if (debugMode == 9u) { return idColor(hit.sourceIndex); }
  if (debugMode == 1u && hit.sourceIndex < arrayLength(&fieldletHeaders)) {
    let reference = fieldletHeaders[hit.sourceIndex].boundsRef;
    if (validBoundsRef(reference)) {
      let bounds = fieldletBound(reference);
      let center = (bounds.minimum.xyz + bounds.maximum.xyz) * 0.5;
      let halfExtent = max((bounds.maximum.xyz - bounds.minimum.xyz) * 0.5, vec3<f32>(1e-5));
      let normalized = abs((hit.position - center) / halfExtent);
      let edge = smoothstep(0.90, 0.995, max(min(normalized.x, normalized.y), max(min(normalized.x, normalized.z), min(normalized.y, normalized.z))));
      return mix(shaded * 0.22, vec3<f32>(0.05, 1.0, 0.88), edge);
    }
  }
  return shaded;
}

@fragment
fn fragmentMain(input: VertexOutput) -> FragmentOutput {
  let resolution = max(frame.resolutionTime.xy, vec2<f32>(1.0));
  let pixel = min(vec2<u32>(input.position.xy), vec2<u32>(resolution) - vec2<u32>(1u));
  let uv = (vec2<f32>(pixel) + vec2<f32>(0.5)) / resolution;
  let ndc = vec2<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let nearPoint = unproject(ndc, 0.0);
  let farPoint = unproject(ndc, 1.0);
  let rayOrigin = frame.cameraPosition.xyz;
  let rayDirection = safeNormalize(farPoint - nearPoint, vec3<f32>(0.0, 0.0, -1.0));
  let primaryMinimumDistance = max(length(nearPoint - rayOrigin), frame.hitEpsilon * 2.0);
  let primary = traceRay(rayOrigin, rayDirection, primaryMinimumDistance, frame.maxDistance, MAX_TRACE_STEPS, true);
  var output: FragmentOutput;
  let metadataIndex = pixel.y * u32(resolution.x) + pixel.x;
  if (primary.valid == 0u) {
    let sky = environment(rayDirection);
    output.hdrTransmittance = vec4<f32>(sky, 1.0);
    output.normalLinearDepth = vec4<f32>(0.0, 1.0, 0.0, frame.maxDistance);
    output.albedoRoughness = vec4<f32>(0.0, 0.0, 0.0, 1.0);
    output.motionMetalMaterial = vec4<f32>(0.0);
    output.depth = 1.0;
    if (metadataIndex < arrayLength(&pixelMetadata)) { pixelMetadata[metadataIndex] = vec2<u32>(0u, frame.sceneRevision); }
    return output;
  }
  let base = materialBase(primary.materialIndex);
  let params = materialParams(primary.materialIndex);
  let viewDirection = safeNormalize(rayOrigin - primary.position, -rayDirection);
  var shadedColor = base.rgb + materialEmission(primary.materialIndex);
  if (frame.mode == 0u) {
    shadedColor = hybridLighting(primary, viewDirection);
  }
  let color = debugSurfaceColor(primary, shadedColor);
  let clip = frame.viewProj * vec4<f32>(primary.position, 1.0);
  output.hdrTransmittance = vec4<f32>(color, 0.0);
  output.normalLinearDepth = vec4<f32>(primary.normal, primary.distance);
  output.albedoRoughness = vec4<f32>(base.rgb, params.x);
  output.motionMetalMaterial = vec4<f32>(0.0, 0.0, params.y, f32(primary.materialIndex));
  output.depth = 1.0;
  if (finiteScalar(clip.z) && finiteScalar(clip.w) && abs(clip.w) > 1e-8) {
    let projectedDepth = clip.z / clip.w;
    if (finiteScalar(projectedDepth)) { output.depth = clamp(projectedDepth, 0.0, 1.0); }
  }
  if (metadataIndex < arrayLength(&pixelMetadata)) { pixelMetadata[metadataIndex] = vec2<u32>(primary.sourceIndex + 1u, frame.sceneRevision); }
  return output;
}
`;

export const TRACE_LINEAR_SHADER_WGSL = TRACE_SHADER_WGSL.replace(
  FIELDLET_SCENE_WGSL,
  FIELDLET_SCENE_LINEAR_WGSL,
);

function createTileTraceShader(traceSource) {
  const minimumNeedle = "  let primaryMinimumDistance = max(length(nearPoint - rayOrigin), frame.hitEpsilon * 2.0);";
  const first = traceSource.indexOf(minimumNeedle);
  if (first < 0 || traceSource.indexOf(minimumNeedle, first + minimumNeedle.length) >= 0) {
    throw new Error("MorphField: tile trace derivation is missing the unique primary-distance initialization");
  }
  const replacement = `  var primaryMinimumDistance = max(length(nearPoint - rayOrigin), frame.hitEpsilon * 2.0);
  // Phase 4 publishes one conservative camera-to-candidate lower bound per
  // pixel. A matching tag proves the hint belongs to this exact scene/frame/
  // extent; zero is the explicit linear fallback for invalid, empty, and
  // capacity-overflow tiles. The certified linear tracer remains unchanged.
  let tileTraceMetadata = pixelMetadata[pixel.y * u32(resolution.x) + pixel.x];
  let tileTraceExtent = vec2<u32>(resolution);
  let tileTraceTag = (frame.sceneRevision ^ frame.frameIndex ^ tileTraceExtent.x
    ^ (tileTraceExtent.y << 16u)) | 1u;
  let tileTraceEntry = bitcast<f32>(tileTraceMetadata.x);
  if (tileTraceMetadata.y == tileTraceTag && finiteScalar(tileTraceEntry) && tileTraceEntry > 0.0) {
    primaryMinimumDistance = max(primaryMinimumDistance, tileTraceEntry);
  }`;
  return traceSource.slice(0, first) + replacement + traceSource.slice(first + minimumNeedle.length);
}

// Experimental primary-ray accelerator. A preceding compute dispatch bins the
// CPU-validated threaded BVH into conservative 16x16 screen tiles and
// publishes a per-pixel empty-space lower bound. Primary tracing starts no
// later than the nearest admitted AABB; every SDF, normal, and secondary ray
// remains the exact certified-linear implementation.
export const TRACE_TILE_BVH_SHADER_WGSL = createTileTraceShader(TRACE_LINEAR_SHADER_WGSL);

export const TILE_BVH_BIN_SHADER_WGSL = /* wgsl */ `
struct TileBinUniforms {
  viewProjection: mat4x4<f32>,
  resolution: vec2<u32>,
  fieldletCount: u32,
  sceneRevision: u32,
  frameIndex: u32,
  cameraPosition: vec3<f32>,
}
@group(0) @binding(0) var<uniform> bin: TileBinUniforms;

@group(0) @binding(1) var<storage, read_write> pixelMetadata: array<vec2<u32>>;
struct SpatialRecord {
  minimum: vec3<f32>,
  escape: u32,
  maximum: vec3<f32>,
  flags: u32,
  metadata: vec4<u32>,
}
@group(0) @binding(2) var<storage, read> spatialRecords: array<SpatialRecord>;
const SPATIAL_RECORD_MAGIC: u32 = 0x4d464233u;
const SPATIAL_INVALID_REF: u32 = 0xffffffffu;
const MORPHFIELD_TILE_SIZE: u32 = 16u;
const MORPHFIELD_TILE_CAPACITY: u32 = 64u;
const MORPHFIELD_TILE_RECORD_PAIRS: u32 = 33u;
const MORPHFIELD_TILE_INVALID_COUNT: u32 = 0xffffffffu;

fn tileContextTag(width: u32, height: u32) -> u32 {
  return (bin.sceneRevision ^ bin.frameIndex ^ width ^ (height << 16u)) | 1u;
}

fn publishInvalidTile(tileBase: u32, tag: u32) {
  pixelMetadata[tileBase] = vec2<u32>(MORPHFIELD_TILE_INVALID_COUNT, tag);
}

fn writeTileCandidate(tilePairBase: u32, slot: u32, value: u32) {
  let address = tilePairBase + 1u + slot / 2u;
  let previous = pixelMetadata[address];
  pixelMetadata[address] = select(
    vec2<u32>(previous.x, value),
    vec2<u32>(value, previous.y),
    (slot & 1u) == 0u,
  );
}

fn finiteTileScalar(value: f32) -> bool {
  return value == value && abs(value) < 1e30;
}

fn finiteTileVector(value: vec3<f32>) -> bool {
  return finiteTileScalar(value.x) && finiteTileScalar(value.y) && finiteTileScalar(value.z);
}

fn cameraToBoundLowerDistance(bounds: SpatialRecord) -> f32 {
  let outside = max(
    max(bounds.minimum - bin.cameraPosition, bin.cameraPosition - bounds.maximum),
    vec3<f32>(0.0),
  );
  return length(outside);
}

fn publishTileEntryHints(
  pixelMinimum: vec2<u32>,
  pixelMaximum: vec2<u32>,
  width: u32,
  entry: f32,
  tag: u32,
) {
  let packedEntry = bitcast<u32>(max(entry, 0.0));
  for (var pixelY = pixelMinimum.y; pixelY < pixelMaximum.y; pixelY = pixelY + 1u) {
    for (var pixelX = pixelMinimum.x; pixelX < pixelMaximum.x; pixelX = pixelX + 1u) {
      pixelMetadata[pixelY * width + pixelX] = vec2<u32>(packedEntry, tag);
    }
  }
}

fn projectedNodeOverlapsTile(
  bounds: SpatialRecord,
  tileMinimumNdc: vec2<f32>,
  tileMaximumNdc: vec2<f32>,
) -> bool {
  if (any(bounds.minimum > bounds.maximum)) { return true; }
  let center = (bounds.minimum + bounds.maximum) * 0.5;
  let extent = max((bounds.maximum - bounds.minimum) * 0.5, vec3<f32>(0.0));
  let clip = bin.viewProjection * vec4<f32>(center, 1.0);
  let radiusX = dot(abs(vec3<f32>(
    bin.viewProjection[0].x, bin.viewProjection[1].x, bin.viewProjection[2].x,
  )), extent);
  let radiusY = dot(abs(vec3<f32>(
    bin.viewProjection[0].y, bin.viewProjection[1].y, bin.viewProjection[2].y,
  )), extent);
  let radiusW = dot(abs(vec3<f32>(
    bin.viewProjection[0].w, bin.viewProjection[1].w, bin.viewProjection[2].w,
  )), extent);
  if (!finiteTileScalar(clip.x) || !finiteTileScalar(clip.y) || !finiteTileScalar(clip.w)
      || !finiteTileScalar(radiusX) || !finiteTileScalar(radiusY)
      || !finiteTileScalar(radiusW) || clip.w - radiusW <= 0.0) { return true; }
  let minimumW = clip.w - radiusW;
  let maximumW = clip.w + radiusW;
  let minimumX = clip.x - radiusX;
  let maximumX = clip.x + radiusX;
  let minimumY = clip.y - radiusY;
  let maximumY = clip.y + radiusY;
  let projectedMinimum = vec2<f32>(
    min(minimumX / minimumW, minimumX / maximumW),
    min(minimumY / minimumW, minimumY / maximumW),
  );
  let projectedMaximum = vec2<f32>(
    max(maximumX / minimumW, maximumX / maximumW),
    max(maximumY / minimumW, maximumY / maximumW),
  );
  return projectedMaximum.x >= tileMinimumNdc.x
    && projectedMinimum.x <= tileMaximumNdc.x
    && projectedMaximum.y >= tileMinimumNdc.y
    && projectedMinimum.y <= tileMaximumNdc.y;
}

// One invocation owns one tile, so candidate publication never needs atomics
// and the following fragment pass observes an all-or-fallback record.
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let width = max(bin.resolution.x, 1u);
  let height = max(bin.resolution.y, 1u);
  let activePixelCount = width * height;
  if (activePixelCount >= arrayLength(&pixelMetadata)) { return; }
  let tileColumns = (width + MORPHFIELD_TILE_SIZE - 1u) / MORPHFIELD_TILE_SIZE;
  let tileRows = (height + MORPHFIELD_TILE_SIZE - 1u) / MORPHFIELD_TILE_SIZE;
  if (tileRows == 0u) { return; }
  let tileCount = tileColumns * tileRows;
  let tag = tileContextTag(width, height);
  let requiredLength = activePixelCount + 1u + tileCount * MORPHFIELD_TILE_RECORD_PAIRS;
  if (requiredLength > arrayLength(&pixelMetadata)) {
    if (invocation.x == 0u) { pixelMetadata[activePixelCount] = vec2<u32>(0u); }
    return;
  }
  let tileIndex = invocation.x;
  if (tileIndex >= tileCount) { return; }
  let tilePairBase = activePixelCount + 1u + tileIndex * MORPHFIELD_TILE_RECORD_PAIRS;
  let tileX = tileIndex % tileColumns;
  let tileY = tileIndex / tileColumns;
  let pixelMinimum = vec2<u32>(tileX, tileY) * MORPHFIELD_TILE_SIZE;
  let pixelMaximum = min(pixelMinimum + vec2<u32>(MORPHFIELD_TILE_SIZE), vec2<u32>(width, height));
  let padding = vec2<f32>(2.0 / f32(width), 2.0 / f32(height));
  let tileMinimumNdc = vec2<f32>(
    2.0 * f32(pixelMinimum.x) / f32(width) - 1.0,
    1.0 - 2.0 * f32(pixelMaximum.y) / f32(height),
  ) - padding;
  let tileMaximumNdc = vec2<f32>(
    2.0 * f32(pixelMaximum.x) / f32(width) - 1.0,
    1.0 - 2.0 * f32(pixelMinimum.y) / f32(height),
  ) + padding;

  let recordCount = arrayLength(&spatialRecords);
  var invalid = recordCount < 2u;
  var boundCount = 0u;
  var nodeCount = 0u;
  if (!invalid) {
    let trailer = spatialRecords[recordCount - 1u];
    boundCount = trailer.metadata.x;
    nodeCount = trailer.metadata.y;
    invalid = trailer.metadata.w != SPATIAL_RECORD_MAGIC
      || nodeCount == 0u
      || boundCount > recordCount
      || nodeCount > recordCount - boundCount;
  }
  var candidateCount = 0u;
  var nearestCandidateEntry = 1e20;
  for (var nodeIndex = 0u; nodeIndex < nodeCount && !invalid; nodeIndex = nodeIndex + 1u) {
    if (boundCount + nodeIndex >= recordCount - 1u) {
      invalid = true;
      break;
    }
    let node = spatialRecords[boundCount + nodeIndex];
    if (node.metadata.w > 1u) {
      invalid = true;
      break;
    }
    if (node.metadata.w != 1u) { continue; }
    if (node.metadata.x != SPATIAL_INVALID_REF || node.metadata.y != SPATIAL_INVALID_REF
        || node.metadata.z >= bin.fieldletCount) {
      invalid = true;
      break;
    }
    if (any(node.minimum > node.maximum)
        || !finiteTileVector(node.minimum)
        || !finiteTileVector(node.maximum)) {
      invalid = true;
      break;
    }
    if (!projectedNodeOverlapsTile(node, tileMinimumNdc, tileMaximumNdc)) { continue; }
    if (candidateCount >= MORPHFIELD_TILE_CAPACITY) {
      invalid = true;
      break;
    }
    let candidateEntry = cameraToBoundLowerDistance(node);
    if (!finiteTileScalar(candidateEntry)) {
      invalid = true;
      break;
    }
    nearestCandidateEntry = min(nearestCandidateEntry, candidateEntry);
    writeTileCandidate(tilePairBase, candidateCount, node.metadata.z);
    candidateCount = candidateCount + 1u;
  }
  if (invalid) {
    publishInvalidTile(tilePairBase, tag);
  } else {
    for (var pairIndex = 0u; pairIndex < 32u; pairIndex = pairIndex + 1u) {
      if (pairIndex >= (candidateCount + 1u) / 2u) {
        pixelMetadata[tilePairBase + 1u + pairIndex] = vec2<u32>(SPATIAL_INVALID_REF);
      }
    }
    pixelMetadata[tilePairBase] = vec2<u32>(candidateCount, tag);
  }
  // The render pass consumes this prefill only as a conservative start hint
  // and then overwrites each pair with the public source-id/version output.
  // Zero preserves the complete linear path for empty, invalid, and overflow
  // records while the arena header retains the diagnostic sentinel.
  let entryHint = select(0.0, nearestCandidateEntry, !invalid && candidateCount > 0u);
  publishTileEntryHints(pixelMinimum, pixelMaximum, width, entryHint, tag);
  if (tileIndex == 0u) {
    pixelMetadata[activePixelCount] = vec2<u32>(tag, tileCount);
  }
}
`;

export const PHASE_SHADER_WGSL = /* wgsl */ `
struct PhaseUniforms {
  phase: u32,
  frameIndex: u32,
  sceneRevision: u32,
  fieldletCount: u32,
}
@group(0) @binding(0) var<uniform> phase: PhaseUniforms;
@group(0) @binding(1) var<storage, read_write> runtimeState: array<atomic<u32>>;

@compute @workgroup_size(1)
fn main() {
  if (phase.phase < 8u && phase.phase < arrayLength(&runtimeState)) {
    atomicStore(&runtimeState[phase.phase], phase.frameIndex);
  }
  if (phase.phase == 0u) {
    atomicStore(&runtimeState[8u], phase.sceneRevision);
    atomicStore(&runtimeState[9u], 0u);
    atomicStore(&runtimeState[10u], 0u);
  } else if (phase.phase == 3u) {
    atomicStore(&runtimeState[9u], phase.fieldletCount);
  } else if (phase.phase == 6u) {
    atomicStore(&runtimeState[10u], phase.fieldletCount);
  }
}
`;

export const ACCUMULATION_SHADER_WGSL = /* wgsl */ `
${FRAME_UNIFORMS_WGSL}
@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var currentSample: texture_2d<f32>;
@group(0) @binding(2) var historyInput: texture_2d<f32>;
@group(0) @binding(3) var historyOutput: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let resolution = vec2<u32>(frame.resolutionTime.xy);
  if (invocation.x >= resolution.x || invocation.y >= resolution.y) { return; }
  let coordinate = vec2<i32>(invocation.xy);
  let sample = min(textureLoad(currentSample, coordinate, 0).rgb, vec3<f32>(64.0));
  let previous = textureLoad(historyInput, coordinate, 0).rgb;
  let count = f32(frame.historySamples);
  let accumulated = (previous * count + sample) / (count + 1.0);
  textureStore(historyOutput, coordinate, vec4<f32>(accumulated, 1.0));
}
`;

export const WAVEFRONT_RESOLVE_SHADER_WGSL = /* wgsl */ `
${FRAME_UNIFORMS_WGSL}
@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var<storage, read> wavefrontRadiance: array<vec4<f32>>;
@group(0) @binding(2) var resolvedOutput: texture_storage_2d<rgba16float, write>;

fn finiteResolveScalar(value: f32) -> bool {
  return value == value && abs(value) <= 3.402823466e+38;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let resolution = vec2<u32>(frame.resolutionTime.xy);
  if (invocation.x >= resolution.x || invocation.y >= resolution.y) { return; }
  let index = invocation.y * resolution.x + invocation.x;
  if (index >= arrayLength(&wavefrontRadiance)) {
    textureStore(resolvedOutput, vec2<i32>(invocation.xy), vec4<f32>(0.0));
    return;
  }
  let accumulated = wavefrontRadiance[index];
  var radiance = accumulated.rgb / max(accumulated.a, 1.0);
  if (!finiteResolveScalar(radiance.x) || !finiteResolveScalar(radiance.y) || !finiteResolveScalar(radiance.z)) {
    radiance = vec3<f32>(0.0);
  }
  textureStore(resolvedOutput, vec2<i32>(invocation.xy), vec4<f32>(min(max(radiance, vec3<f32>(0.0)), vec3<f32>(64.0)), 1.0));
}
`;

export const COMPOSITE_SHADER_WGSL = /* wgsl */ `
${FRAME_UNIFORMS_WGSL}
@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var colorInput: texture_2d<f32>;
@group(0) @binding(2) var depthInput: texture_depth_2d;
@group(0) @binding(3) var linearSampler: sampler;
@group(0) @binding(4) var directSurfaceInput: texture_2d<f32>;
@group(0) @binding(5) var normalLinearDepthInput: texture_2d<f32>;
@group(0) @binding(6) var<storage, read> pixelMetadata: array<vec2<u32>>;

struct VertexOutput { @builtin(position) position: vec4<f32> }
struct ColorDepthOutput {
  @location(0) color: vec4<f32>,
  @builtin(frag_depth) depth: f32,
}

struct ReconstructionGuide {
  normal: vec3<f32>,
  linearDepth: f32,
  sourceId: u32,
  valid: u32,
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let positions = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  var output: VertexOutput;
  output.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  return output;
}

fn acesTonemap(color: vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((color * (a * color + vec3<f32>(b))) / (color * (c * color + vec3<f32>(d)) + vec3<f32>(e)), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn linearChannelToSrgb(value: f32) -> f32 {
  if (value <= 0.0031308) { return value * 12.92; }
  return 1.055 * pow(max(value, 0.0), 1.0 / 2.4) - 0.055;
}

fn linearToSrgb(color: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    linearChannelToSrgb(color.r),
    linearChannelToSrgb(color.g),
    linearChannelToSrgb(color.b),
  );
}

fn clampActiveCoordinate(coordinate: vec2<i32>, resolution: vec2<i32>) -> vec2<i32> {
  return clamp(coordinate, vec2<i32>(0), resolution - vec2<i32>(1));
}

fn finiteCompositeScalar(value: f32) -> bool {
  return value == value && abs(value) <= 3.402823466e+38;
}

struct ReconstructedSample {
  surface: vec4<f32>,
  depth: f32,
}

fn sourceSample(coordinate: vec2<i32>) -> ReconstructedSample {
  return ReconstructedSample(
    vec4<f32>(
      textureLoad(colorInput, coordinate, 0).rgb,
      textureLoad(directSurfaceInput, coordinate, 0).a,
    ),
    textureLoad(depthInput, coordinate, 0),
  );
}

fn reconstructionGuide(coordinate: vec2<i32>, activeResolution: vec2<i32>) -> ReconstructionGuide {
  let packed = textureLoad(normalLinearDepthInput, coordinate, 0);
  let metadataIndex = u32(coordinate.y) * u32(activeResolution.x) + u32(coordinate.x);
  var sourceId = 0u;
  var valid = select(0u, 1u,
    finiteCompositeScalar(packed.a) && packed.a >= 0.0 && metadataIndex < arrayLength(&pixelMetadata));
  if (metadataIndex < arrayLength(&pixelMetadata)) { sourceId = pixelMetadata[metadataIndex].x; }
  var normal = packed.xyz;
  if (sourceId == 0u) {
    normal = vec3<f32>(0.0, 1.0, 0.0);
  } else {
    let normalLengthSquared = dot(normal, normal);
    if (!finiteCompositeScalar(normalLengthSquared) || normalLengthSquared <= 1e-8) {
      valid = 0u;
    } else {
      normal = normal * inverseSqrt(normalLengthSquared);
    }
  }
  return ReconstructionGuide(normal, packed.a, sourceId, valid);
}

fn layerWeight(
  coordinate: vec2<i32>,
  activeResolution: vec2<i32>,
  reference: ReconstructionGuide,
  baseWeight: f32,
) -> f32 {
  if (baseWeight <= 0.0 || reference.valid == 0u) { return 0.0; }
  let candidate = reconstructionGuide(coordinate, activeResolution);
  if (candidate.valid == 0u || candidate.sourceId != reference.sourceId) { return 0.0; }
  if (reference.sourceId == 0u) { return baseWeight; }
  let normalAgreement = clamp(dot(reference.normal, candidate.normal), 0.0, 1.0);
  if (normalAgreement < 0.82) { return 0.0; }
  let nearerDepth = max(min(reference.linearDepth, candidate.linearDepth), frame.hitEpsilon);
  let planarAllowance = pow(normalAgreement, 8.0);
  let relativeTolerance = mix(0.0025, 0.02, planarAllowance);
  let depthTolerance = max(frame.hitEpsilon * 4.0, nearerDepth * relativeTolerance);
  let depthDifference = abs(candidate.linearDepth - reference.linearDepth);
  if (depthDifference > depthTolerance) { return 0.0; }
  let depthConfidence = 1.0 - clamp(depthDifference / max(depthTolerance, 1e-8), 0.0, 1.0);
  let normalConfidence = smoothstep(0.82, 0.98, normalAgreement);
  return baseWeight * max(depthConfidence * max(normalConfidence, 0.125), 1e-4);
}

fn reconstructedSample(uv: vec2<f32>, activeResolutionInput: vec2<f32>) -> ReconstructedSample {
  let activeResolution = vec2<i32>(activeResolutionInput);
  let sourcePosition = uv * activeResolutionInput - vec2<f32>(0.5);
  let base = vec2<i32>(floor(sourcePosition));
  let fraction = fract(sourcePosition);
  let c00 = clampActiveCoordinate(base, activeResolution);
  let c10 = clampActiveCoordinate(base + vec2<i32>(1, 0), activeResolution);
  let c01 = clampActiveCoordinate(base + vec2<i32>(0, 1), activeResolution);
  let c11 = clampActiveCoordinate(base + vec2<i32>(1, 1), activeResolution);
  let referenceCoordinate = clampActiveCoordinate(vec2<i32>(floor(uv * activeResolutionInput)), activeResolution);
  let reference = reconstructionGuide(referenceCoordinate, activeResolution);
  let w00 = layerWeight(c00, activeResolution, reference, (1.0 - fraction.x) * (1.0 - fraction.y));
  let w10 = layerWeight(c10, activeResolution, reference, fraction.x * (1.0 - fraction.y));
  let w01 = layerWeight(c01, activeResolution, reference, (1.0 - fraction.x) * fraction.y);
  let w11 = layerWeight(c11, activeResolution, reference, fraction.x * fraction.y);
  let weightSum = w00 + w10 + w01 + w11;
  // Invalid guide data or an entirely rejected footprint resolves to the
  // nearest source texel. Never average across an unidentified boundary.
  if (reference.valid == 0u || weightSum <= 1e-6) { return sourceSample(referenceCoordinate); }
  let s00 = sourceSample(c00);
  let s10 = sourceSample(c10);
  let s01 = sourceSample(c01);
  let s11 = sourceSample(c11);
  return ReconstructedSample(
    (s00.surface * w00 + s10.surface * w10 + s01.surface * w01 + s11.surface * w11) / weightSum,
    (s00.depth * w00 + s10.depth * w10 + s01.depth * w01 + s11.depth * w11) / weightSum,
  );
}

fn compositeSurfaceColor(reconstructed: vec4<f32>) -> vec4<f32> {
  let hdr = reconstructed.rgb * frame.exposure;
  var mapped = acesTonemap(max(hdr, vec3<f32>(0.0)));
  if (frame.outputTransfer > 0.5) { mapped = linearToSrgb(mapped); }
  let transmittance = clamp(reconstructed.a, 0.0, 1.0);
  let opacity = select(1.0, 1.0 - transmittance, (frame.flags & 0x100u) != 0u);
  return vec4<f32>(mapped, opacity);
}

fn compositeColor(position: vec4<f32>) -> vec4<f32> {
  let activeResolution = max(frame.resolutionTime.xy, vec2<f32>(1.0));
  let viewportOrigin = vec2<f32>(frame.skyColor.w, frame.sunColor.w);
  let outputResolution = max(vec2<f32>(frame.cameraPosition.w, frame.sunDirection.w), vec2<f32>(1.0));
  let uv = clamp((position.xy - viewportOrigin) / outputResolution, vec2<f32>(0.0), vec2<f32>(0.999999));
  return compositeSurfaceColor(reconstructedSample(uv, activeResolution).surface);
}

@fragment
fn fragmentNoDepth(input: VertexOutput) -> @location(0) vec4<f32> {
  return compositeColor(input.position);
}

@fragment
fn fragmentWithDepth(input: VertexOutput) -> ColorDepthOutput {
  let activeResolution = max(frame.resolutionTime.xy, vec2<f32>(1.0));
  let viewportOrigin = vec2<f32>(frame.skyColor.w, frame.sunColor.w);
  let outputResolution = max(vec2<f32>(frame.cameraPosition.w, frame.sunDirection.w), vec2<f32>(1.0));
  let uv = clamp((input.position.xy - viewportOrigin) / outputResolution, vec2<f32>(0.0), vec2<f32>(0.999999));
  let reconstructed = reconstructedSample(uv, activeResolution);
  var output: ColorDepthOutput;
  output.color = compositeSurfaceColor(reconstructed.surface);
  output.depth = clamp(reconstructed.depth, 0.0, 1.0);
  return output;
}
`;

export const QUERY_SHADER_WGSL = /* wgsl */ `
struct QueryUniforms {
  queryCount: u32,
  fieldletCount: u32,
  sceneRevision: u32,
  _padding: u32,
}
@group(0) @binding(0) var<uniform> queryUniforms: QueryUniforms;
${FIELDLET_SCENE_WGSL}
@group(0) @binding(7) var<storage, read_write> queryRecords: array<vec4<f32>>;

fn queryCollisionMetadata(fieldletIndex: u32) -> vec4<u32> {
  let recordCount = arrayLength(&spatialRecords);
  if (recordCount == 0u || fieldletIndex >= queryUniforms.fieldletCount) { return vec4<u32>(0u); }
  let trailer = spatialRecords[recordCount - 1u];
  let metadataIndex = trailer.metadata.x + trailer.metadata.y + fieldletIndex;
  if (trailer.metadata.w != SPATIAL_RECORD_MAGIC || metadataIndex >= recordCount - 1u) {
    return vec4<u32>(0u);
  }
  return spatialRecords[metadataIndex].metadata;
}

fn closestBoundDistance(point: vec3<f32>) -> f32 {
  var result = 1e20;
  let count = min(queryUniforms.fieldletCount, arrayLength(&fieldletHeaders));
  for (var index = 0u; index < count; index = index + 1u) {
    let reference = fieldletHeaders[index].boundsRef;
    if (validBoundsRef(reference)) {
      result = min(result, distanceToAabb(point, fieldletBound(reference)));
    }
  }
  return result;
}

fn pointInsideBound(point: vec3<f32>, bounds: SpatialRecord) -> bool {
  return all(point >= bounds.minimum.xyz) && all(point <= bounds.maximum.xyz);
}

fn findQueryFieldlet(point: vec3<f32>, queryKind: u32, preferred: u32, queryRadius: f32) -> u32 {
  let count = min(queryUniforms.fieldletCount, arrayLength(&fieldletHeaders));
  if (preferred < count) {
    let preferredHeader = fieldletHeaders[preferred];
    let mask = (preferredHeader.metadata >> 16u) & 0x3Fu;
    let typedSurface = queryKind != 1u || isCertifiedSurface(preferredHeader);
    let typedCollision = queryKind != 5u || isCertifiedCollision(preferredHeader);
    if ((mask & (1u << min(queryKind, 5u))) != 0u && typedSurface && typedCollision) { return preferred; }
  }
  for (var index = 0u; index < count; index = index + 1u) {
    let header = fieldletHeaders[index];
    let mask = (header.metadata >> 16u) & 0x3Fu;
    if ((mask & (1u << min(queryKind, 5u))) == 0u) { continue; }
    if (queryKind == 1u && !isCertifiedSurface(header)) { continue; }
    if (queryKind == 5u && !isCertifiedCollision(header)) { continue; }
    if (queryKind == 5u && queryCollisionMetadata(index).x == 0u) { continue; }
    if (validBoundsRef(header.boundsRef)) {
      let bounds = fieldletBound(header.boundsRef);
      if (queryKind == 5u) {
        let certificateIndex = index * 4u + 3u;
        var contactOffset = 0.0;
        if (certificateIndex < arrayLength(&resolvedCertificates)) {
          contactOffset = resolvedCertificates[certificateIndex].z;
        }
        if (distanceToAabb(point, bounds) <= queryRadius + contactOffset) { return index; }
      } else if (pointInsideBound(point, bounds)) {
        return index;
      }
    }
  }
  return 0xFFFFFFFFu;
}

fn selectedMaterial(fieldletIndex: u32, fallback: u32) -> u32 {
  if (fieldletIndex >= arrayLength(&fieldletHeaders)) { return fallback; }
  let payloadBase = fieldletHeaders[fieldletIndex].payloadRef * 4u;
  if (payloadBase + 3u >= arrayLength(&payloadRecords)) { return fallback; }
  return u32(max(payloadRecords[payloadBase + 3u].z, 0.0));
}

fn queryCertificate(fieldletIndex: u32, record: u32) -> vec4<f32> {
  let certificateIndex = fieldletIndex * 4u + record;
  if (fieldletIndex == 0xFFFFFFFFu || certificateIndex >= arrayLength(&resolvedCertificates)) {
    return vec4<f32>(0.0);
  }
  return resolvedCertificates[certificateIndex];
}

fn queryFieldletNormal(point: vec3<f32>, fieldletIndex: u32, epsilon: f32) -> vec3<f32> {
  if (fieldletIndex >= arrayLength(&fieldletHeaders)) { return vec3<f32>(0.0, 1.0, 0.0); }
  let header = fieldletHeaders[fieldletIndex];
  let e = max(epsilon, 1e-5);
  let k1 = vec3<f32>(1.0, -1.0, -1.0);
  let k2 = vec3<f32>(-1.0, -1.0, 1.0);
  let k3 = vec3<f32>(-1.0, 1.0, -1.0);
  let k4 = vec3<f32>(1.0, 1.0, 1.0);
  let gradient = k1 * fieldletDistance(point + k1 * e, header)
    + k2 * fieldletDistance(point + k2 * e, header)
    + k3 * fieldletDistance(point + k3 * e, header)
    + k4 * fieldletDistance(point + k4 * e, header);
  return safeNormalize(gradient, vec3<f32>(0.0, 1.0, 0.0));
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let index = invocation.x;
  if (index >= queryUniforms.queryCount) { return; }
  let inputBase = index * 4u;
  let outputBase = index * 4u;
  let first = queryRecords[inputBase];
  let queryKind = bitcast<u32>(first.w);
  let point = first.xyz;
  let requestedFieldlet = bitcast<u32>(queryRecords[inputBase + 2u].x);
  let queryRadius = max(queryRecords[inputBase + 2u].z, 0.0);
  let sample = evalScene(point, queryUniforms.fieldletCount);
  var selected = findQueryFieldlet(point, queryKind, requestedFieldlet, queryRadius);
  let requestedValid = selected == requestedFieldlet && requestedFieldlet < queryUniforms.fieldletCount;
  if (queryKind == 1u && !requestedValid && sample.distance < 1e19) {
    selected = sample.sourceIndex;
  }
  if (queryKind != 5u && selected == 0xFFFFFFFFu && sample.distance < 1e19) {
    selected = sample.sourceIndex;
  }
  let materialIndex = selectedMaterial(selected, sample.materialIndex);
  var value = sample.distance;
  var normal = sceneNormal(point, queryUniforms.fieldletCount, 0.001);
  var base = materialBase(materialIndex);
  var params = materialParams(materialIndex);
  if (queryKind == 0u) {
    if (requestedValid && selected < arrayLength(&fieldletHeaders)) {
      let reference = fieldletHeaders[selected].boundsRef;
      if (validBoundsRef(reference)) {
        value = distanceToAabb(point, fieldletBound(reference));
      } else {
        value = 1e20;
      }
    } else {
      value = closestBoundDistance(point);
    }
    normal = vec3<f32>(0.0);
  } else if (queryKind == 1u && requestedValid && selected < arrayLength(&fieldletHeaders)) {
    let header = fieldletHeaders[selected];
    let certificate = surfaceCertificate(selected);
    let surfaceSupported = isCertifiedSurface(header) && certificate.x >= 0.0;
    value = select(1e20, fieldletDistance(point, header), surfaceSupported);
    normal = select(vec3<f32>(0.0), queryFieldletNormal(point, selected, 0.001), surfaceSupported);
  } else if (queryKind == 2u) {
    let certificate = queryCertificate(selected, 1u);
    value = certificate.x;
    normal = vec3<f32>(0.0);
    base = vec4<f32>(vec3<f32>(certificate.z), 1.0);
    params = vec4<f32>(certificate.y, certificate.x, certificate.z, certificate.w);
  } else if (queryKind == 3u) {
    value = 0.0;
    normal = vec3<f32>(0.0);
  } else if (queryKind == 4u) {
    let certificate = queryCertificate(selected, 2u);
    value = certificate.x;
    normal = certificate.yzw;
    base = vec4<f32>(0.0);
    params = certificate;
  } else if (queryKind == 5u) {
    let certificate = queryCertificate(selected, 3u);
    let collisionMetadata = queryCollisionMetadata(selected);
    var collisionSupported = collisionMetadata.x != 0u
      && finiteScalar(certificate.x) && certificate.x >= 0.0
      && finiteScalar(certificate.y) && certificate.y > 0.0
      && finiteScalar(certificate.z) && certificate.z >= 0.0
      && finiteScalar(certificate.w) && certificate.w >= 0.0;
    if (collisionSupported && selected < arrayLength(&fieldletHeaders)) {
      let header = fieldletHeaders[selected];
      collisionSupported = isCertifiedCollision(header);
      value = select(1e20, fieldletDistance(point, header) - queryRadius, collisionSupported);
      normal = select(vec3<f32>(0.0), queryFieldletNormal(point, selected, 0.001), collisionSupported);
    }
    if (!collisionSupported) {
      value = 1e20;
      normal = vec3<f32>(0.0);
    }
    var restOffset = 0.0;
    if (collisionSupported) { restOffset = bitcast<f32>(collisionMetadata.w); }
    let contact = collisionSupported && value <= certificate.z;
    let penetration = select(0.0, max(restOffset - value, 0.0), collisionSupported);
    base = vec4<f32>(select(0.0, 1.0, contact), select(0.0, 1.0, collisionSupported), restOffset, 1.0);
    params = vec4<f32>(certificate.x, certificate.y, certificate.z, penetration);
  }
  queryRecords[outputBase] = vec4<f32>(value, normal);
  queryRecords[outputBase + 1u] = base;
  queryRecords[outputBase + 2u] = params;
  if (queryKind == 5u) {
    let metadata = queryCollisionMetadata(selected);
    queryRecords[outputBase + 3u] = vec4<f32>(bitcast<f32>(materialIndex), bitcast<f32>(selected), bitcast<f32>(metadata.y), bitcast<f32>(metadata.z));
  } else {
    queryRecords[outputBase + 3u] = vec4<f32>(bitcast<f32>(materialIndex), bitcast<f32>(selected), bitcast<f32>(queryUniforms.sceneRevision), bitcast<f32>(queryKind));
  }
}
`;

export const QUERY_LINEAR_SHADER_WGSL = QUERY_SHADER_WGSL.replace(
  FIELDLET_SCENE_WGSL,
  FIELDLET_SCENE_LINEAR_WGSL,
);
