// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const RASTERIZER_MODE = Object.freeze({
  NATIVE: 'native',
  STATE_FIRST: 'state-first',
  HYBRID: 'hybrid',
});

export const STATE_FIRST_REPRESENTATION = Object.freeze({
  NONE: 0,
  STATE_ONLY: 1,
  POINT: 2,
  SPLAT: 3,
  LINE: 4,
  BILLBOARD: 5,
  FIELD: 6,
  SDF: 7,
  LOW_MESH: 8,
  FULL_MESH: 9,
});

export const STATE_FIRST_DIRTY = Object.freeze({
  POSITION: 1 << 0,
  ROTATION: 1 << 1,
  SCALE: 1 << 2,
  VELOCITY: 1 << 3,
  MATERIAL: 1 << 4,
  SHAPE: 1 << 5,
  ANIMATION: 1 << 6,
  BOUNDS: 1 << 7,
  VISIBILITY: 1 << 8,
  LIGHTING: 1 << 9,
  PHYSICS: 1 << 10,
});

export const STATE_FIRST_REPRESENTATION_NAMES = Object.freeze({
  [STATE_FIRST_REPRESENTATION.NONE]: 'NONE',
  [STATE_FIRST_REPRESENTATION.STATE_ONLY]: 'STATE_ONLY',
  [STATE_FIRST_REPRESENTATION.POINT]: 'POINT',
  [STATE_FIRST_REPRESENTATION.LINE]: 'LINE',
  [STATE_FIRST_REPRESENTATION.SPLAT]: 'SPLAT',
  [STATE_FIRST_REPRESENTATION.BILLBOARD]: 'BILLBOARD',
  [STATE_FIRST_REPRESENTATION.FIELD]: 'FIELD',
  [STATE_FIRST_REPRESENTATION.SDF]: 'SDF',
  [STATE_FIRST_REPRESENTATION.LOW_MESH]: 'LOW_MESH',
  [STATE_FIRST_REPRESENTATION.FULL_MESH]: 'FULL_MESH',
});

export const STATE_FIRST_QUALITY_PROFILE = Object.freeze({
  ULTRA: 'ultra',
  HIGH: 'high',
  BALANCED: 'balanced',
  PERFORMANCE: 'performance',
  EMERGENCY: 'emergency',
});

const DEFAULT_THRESHOLDS = Object.freeze({
  promotePointToSplat: 1.2,
  demoteSplatToPoint: 0.75,
  promoteSplatToLine: 3.2,
  demoteLineToSplat: 2.2,
  promoteLineToLowMesh: 9.5,
  demoteLowMeshToLine: 6.4,
});

const QUALITY_PROFILES = Object.freeze({
  [STATE_FIRST_QUALITY_PROFILE.ULTRA]: Object.freeze({ thresholdScale: 0.75, updateStride: 1, maxDirtyFraction: 1, farCullDistance: 256, smallPixelCull: 0.08, maxRepresentation: STATE_FIRST_REPRESENTATION.FULL_MESH }),
  [STATE_FIRST_QUALITY_PROFILE.HIGH]: Object.freeze({ thresholdScale: 0.9, updateStride: 1, maxDirtyFraction: 0.75, farCullDistance: 192, smallPixelCull: 0.12, maxRepresentation: STATE_FIRST_REPRESENTATION.LOW_MESH }),
  [STATE_FIRST_QUALITY_PROFILE.BALANCED]: Object.freeze({ thresholdScale: 1.15, updateStride: 2, maxDirtyFraction: 0.45, farCullDistance: 128, smallPixelCull: 0.18, maxRepresentation: STATE_FIRST_REPRESENTATION.LOW_MESH }),
  [STATE_FIRST_QUALITY_PROFILE.PERFORMANCE]: Object.freeze({ thresholdScale: 1.55, updateStride: 3, maxDirtyFraction: 0.25, farCullDistance: 96, smallPixelCull: 0.28, maxRepresentation: STATE_FIRST_REPRESENTATION.LINE }),
  [STATE_FIRST_QUALITY_PROFILE.EMERGENCY]: Object.freeze({ thresholdScale: 2.25, updateStride: 5, maxDirtyFraction: 0.12, farCullDistance: 72, smallPixelCull: 0.42, maxRepresentation: STATE_FIRST_REPRESENTATION.SPLAT }),
});

const QUALITY_PROFILE_ORDER = Object.freeze([
  STATE_FIRST_QUALITY_PROFILE.ULTRA,
  STATE_FIRST_QUALITY_PROFILE.HIGH,
  STATE_FIRST_QUALITY_PROFILE.BALANCED,
  STATE_FIRST_QUALITY_PROFILE.PERFORMANCE,
  STATE_FIRST_QUALITY_PROFILE.EMERGENCY,
]);

const COST_SAMPLE_LIMIT = 48;
const QUALITY_PRESSURE_KNOTS = Object.freeze([0.68, 0.84, 1, 1.28, 1.62]);
const QUALITY_PRESSURE_ATTACK_SECONDS = 0.18;
const QUALITY_PRESSURE_RELEASE_SECONDS = 0.9;
const QUALITY_DEGRADE_DWELL_SECONDS = 0.16;
const QUALITY_RECOVER_DWELL_SECONDS = 0.75;
const QUALITY_LEVEL_DEADBAND = 0.06;
const QUALITY_DEGRADE_LEVELS_PER_SECOND = 0.82;
const QUALITY_PANIC_LEVELS_PER_SECOND = 1.65;
const QUALITY_RECOVER_LEVELS_PER_SECOND = 0.2;
// If both the measured and filtered frame pressure are safely below budget,
// an older over-budget target must not continue degrading quality while the
// slower recovery dwell expires. This is a release band, not a new quality
// target: normal pressure-to-quality mapping still decides where recovery
// eventually settles.
const QUALITY_ANTI_WINDUP_RELEASE_PRESSURE = 0.98;
// Keep a hard resume/jank guard without turning a low frame rate into a
// slower governor. The time-based rate remains authoritative at ordinary
// frame intervals; only an unusually long frame is capped.
const QUALITY_MAX_DELTA_PER_FRAME = 0.08;
const QUALITY_PANIC_PRESSURE = 1.8;
const QUALITY_PROFILE_SWITCH_HYSTERESIS = 0.62;
const FPS_SMOOTH_SECONDS = 0.35;
const CPU_SMOOTH_SECONDS = 0.3;
const GPU_SMOOTH_SECONDS = 0.45;
const QUALITY_COST_MODEL_MIN_SAMPLES = 8;
const QUALITY_COST_SHARE_SMOOTH_SECONDS = 1.25;
const QUALITY_COST_SPLIT_MAX_LEVELS = 0.35;
const QUALITY_COST_BIAS_VELOCITY_EPSILON = 0.02;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function smoothstep01(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function sampleQualityProfile(level) {
  const bounded = clamp(level, 0, QUALITY_PROFILE_ORDER.length - 1);
  const lowIndex = Math.floor(bounded);
  const highIndex = Math.min(QUALITY_PROFILE_ORDER.length - 1, lowIndex + 1);
  const blend = bounded - lowIndex;
  return {
    level: bounded,
    blend,
    softBlend: smoothstep01(blend),
    low: QUALITY_PROFILES[QUALITY_PROFILE_ORDER[lowIndex]],
    high: QUALITY_PROFILES[QUALITY_PROFILE_ORDER[highIndex]],
  };
}

function pressureToQualityLevel(pressure) {
  const measured = Math.max(0, Number(pressure) || 0);
  if (measured <= QUALITY_PRESSURE_KNOTS[0]) return 0;
  for (let index = 1; index < QUALITY_PRESSURE_KNOTS.length; index += 1) {
    const upper = QUALITY_PRESSURE_KNOTS[index];
    if (measured > upper) continue;
    const lower = QUALITY_PRESSURE_KNOTS[index - 1];
    return (index - 1) + (measured - lower) / Math.max(1e-6, upper - lower);
  }
  return QUALITY_PROFILE_ORDER.length - 1;
}

function reverseBits8(value) {
  let bits = value & 255;
  bits = ((bits & 0x55) << 1) | ((bits >>> 1) & 0x55);
  bits = ((bits & 0x33) << 2) | ((bits >>> 2) & 0x33);
  bits = ((bits & 0x0f) << 4) | ((bits >>> 4) & 0x0f);
  return bits & 255;
}

function hashStateFirstIdentity(value) {
  if (Number.isFinite(value)) return Number(value) >>> 0;
  const text = String(value ?? '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

// Exact point-wise rank over every 256 consecutive numeric IDs. The rank is
// stable in world/entity space, so camera motion and frame jitter cannot make
// a representation transition swim across the screen.
function stateFirstLodRank(identity) {
  const entityId = hashStateFirstIdentity(identity);
  const lane = entityId & 255;
  const block = entityId >>> 8;
  let permutation = Math.imul(block ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  permutation ^= permutation >>> 16;
  return (((reverseBits8(lane) ^ (permutation & 255)) & 255) + 0.5) / 256;
}

function solveSymmetric3(matrix, vector) {
  const a = matrix.map((row, index) => row.map((value, column) => value + (index === column ? 1e-6 : 0)));
  const b = vector.slice();
  for (let pivot = 0; pivot < 3; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < 3; row += 1) if (Math.abs(a[row][pivot]) > Math.abs(a[best][pivot])) best = row;
    if (best !== pivot) { [a[pivot], a[best]] = [a[best], a[pivot]]; [b[pivot], b[best]] = [b[best], b[pivot]]; }
    const divisor = a[pivot][pivot];
    if (Math.abs(divisor) < 1e-10) return null;
    for (let column = pivot; column < 3; column += 1) a[pivot][column] /= divisor;
    b[pivot] /= divisor;
    for (let row = 0; row < 3; row += 1) {
      if (row === pivot) continue;
      const factor = a[row][pivot];
      for (let column = pivot; column < 3; column += 1) a[row][column] -= factor * a[pivot][column];
      b[row] -= factor * b[pivot];
    }
  }
  return b;
}

const DEFAULT_VISIBILITY = Object.freeze({
  frustumPadding: 0.08,
  depthBias: 0.0025,
  occlusionDemotePixels: 2.0,
  backfaceCull: false,
  backfaceDotThreshold: -0.08,
  facingDemotePower: 0.35,
  vertexSampleLimit: 32,
});

const DEFAULT_SPATIAL_PROXY = Object.freeze({
  enabled: false,
  cellSize: 8,
  nearDistance: 28,
  minEntitiesPerProxy: 8,
  maxProxyPixelRadius: 10,
  highImportanceKeep: 0.75,
  flowScale: 0.35,
  representation: STATE_FIRST_REPRESENTATION.FIELD,
});

const DEFAULT_TEMPORAL_VISIBILITY = Object.freeze({
  enabled: true,
  occlusionGraceFrames: 2,
  visibleBoostFrames: 4,
  maxEntries: 65536,
  staleFrameLimit: 180,
});

export function stateFirstModeLabel(mode) {
  if (mode === RASTERIZER_MODE.STATE_FIRST) return 'State-First';
  if (mode === RASTERIZER_MODE.HYBRID) return 'Hybrid';
  return 'Native';
}

export function chooseStateFirstRepresentation(pixelRadius, importance = 0, current = STATE_FIRST_REPRESENTATION.POINT, holdFrames = 0, thresholds = DEFAULT_THRESHOLDS, policy = null, lodRank = 0.5) {
  const thresholdScale = policy?.thresholdScale || 1;
  const legacyCeiling = policy?.maxRepresentation || STATE_FIRST_REPRESENTATION.FULL_MESH;
  const ceilingFrom = policy?.maxRepresentationHigh ?? policy?.representationCeilingFrom ?? legacyCeiling;
  const ceilingTo = policy?.maxRepresentationLow ?? policy?.representationCeilingTo ?? legacyCeiling;
  const ceilingBlend = clamp(policy?.maxRepresentationBlend ?? policy?.representationCeilingBlend ?? 0, 0, 1);
  const maxRepresentation = lodRank < ceilingBlend ? ceilingTo : ceilingFrom;
  const boostedPixels = pixelRadius * (1 + importance * 2.4);
  // Once a handoff begins, finish it before accepting another quality or
  // distance decision. This prevents a noisy governor from reversing an
  // entity halfway through a complementary old/new transition.
  if (holdFrames > 0) return current;
  // NONE and STATE_ONLY are transient presentation outcomes. Once an entity
  // is visible again, re-enter through POINT so it can climb the normal
  // hysteretic ladder instead of becoming permanently trapped at 0/1.
  let next = current <= STATE_FIRST_REPRESENTATION.STATE_ONLY
    ? STATE_FIRST_REPRESENTATION.POINT
    : current;
  if (current === STATE_FIRST_REPRESENTATION.POINT && boostedPixels > thresholds.promotePointToSplat * thresholdScale) next = STATE_FIRST_REPRESENTATION.SPLAT;
  else if (current === STATE_FIRST_REPRESENTATION.SPLAT && boostedPixels > thresholds.promoteSplatToLine * thresholdScale) next = STATE_FIRST_REPRESENTATION.LINE;
  else if (current === STATE_FIRST_REPRESENTATION.LINE && boostedPixels > thresholds.promoteLineToLowMesh * thresholdScale) next = STATE_FIRST_REPRESENTATION.LOW_MESH;
  if (next !== current) return Math.min(next, maxRepresentation);
  if (current === STATE_FIRST_REPRESENTATION.LOW_MESH && boostedPixels < thresholds.demoteLowMeshToLine * thresholdScale) next = STATE_FIRST_REPRESENTATION.LINE;
  else if (current === STATE_FIRST_REPRESENTATION.LINE && boostedPixels < thresholds.demoteLineToSplat * thresholdScale) next = STATE_FIRST_REPRESENTATION.SPLAT;
  else if (current === STATE_FIRST_REPRESENTATION.SPLAT && boostedPixels < thresholds.demoteSplatToPoint * thresholdScale) next = STATE_FIRST_REPRESENTATION.POINT;
  return Math.min(next, maxRepresentation);
}

function getEntityPosition(entity) {
  const p = entity.position || entity.pos || entity.center || entity.worldPosition;
  if (Array.isArray(p) || ArrayBuffer.isView(p)) return { x: p[0] || 0, y: p[1] || 0, z: p[2] || 0 };
  if (p && typeof p === 'object') return { x: p.x || 0, y: p.y || 0, z: p.z || 0 };
  return { x: entity.x || 0, y: entity.y || 0, z: entity.z || 0 };
}

function getEntityRadius(entity) {
  return Math.max(0.0001, entity.radius ?? entity.boundsRadius ?? entity.boundingRadius ?? entity.size ?? 0.5);
}

// Semantic sources may not implement every generic presentation class. Keep
// visible entities at the cheapest representation their renderer can actually
// draw; NONE remains available through shouldCullEntity() for hidden state.
function getMinimumVisibleRepresentation(entity) {
  const requested = Number(entity.minimumVisibleRepresentation);
  if (!Number.isFinite(requested)) return STATE_FIRST_REPRESENTATION.POINT;
  return Math.round(clamp(
    requested,
    STATE_FIRST_REPRESENTATION.POINT,
    STATE_FIRST_REPRESENTATION.FULL_MESH,
  ));
}

function getEntityAabb(entity) {
  const min = entity.aabbMin || entity.boundsMin || entity.min;
  const max = entity.aabbMax || entity.boundsMax || entity.max;
  if (min && max) {
    const mn = getVector3(min, { x: 0, y: 0, z: 0 });
    const mx = getVector3(max, { x: 0, y: 0, z: 0 });
    return { min: mn, max: mx };
  }
  const p = getEntityPosition(entity);
  const r = getEntityRadius(entity);
  return {
    min: { x: p.x - r, y: p.y - r, z: p.z - r },
    max: { x: p.x + r, y: p.y + r, z: p.z + r },
  };
}

function transformPoint(matrix, p) {
  const x = p.x;
  const y = p.y;
  const z = p.z;
  return {
    x: matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    y: matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    z: matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
    w: matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15],
  };
}

function distanceToCamera(position, cameraPosition) {
  if (!cameraPosition) return null;
  const cx = cameraPosition[0] ?? cameraPosition.x ?? 0;
  const cy = cameraPosition[1] ?? cameraPosition.y ?? 0;
  const cz = cameraPosition[2] ?? cameraPosition.z ?? 0;
  const dx = position.x - cx;
  const dy = position.y - cy;
  const dz = position.z - cz;
  return Math.hypot(dx, dy, dz);
}

function getEntityVelocity(entity) {
  const v = entity.velocity || entity.vel || entity.motion;
  if (Array.isArray(v) || ArrayBuffer.isView(v)) return { x: v[0] || 0, y: v[1] || 0, z: v[2] || 0 };
  if (v && typeof v === 'object') return { x: v.x || 0, y: v.y || 0, z: v.z || 0 };
  return { x: entity.vx || 0, y: entity.vy || 0, z: entity.vz || 0 };
}

function getEntityVisibilityKey(entity, fallback = '') {
  return entity.id ?? entity.key ?? entity.uid ?? entity.originalIndex ?? entity.cellKey ?? fallback;
}

function getVector3(value, fallback = null) {
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return { x: value[0] || 0, y: value[1] || 0, z: value[2] || 0 };
  if (value && typeof value === 'object') return { x: value.x || 0, y: value.y || 0, z: value.z || 0 };
  return fallback;
}

function normalizeVector(v) {
  if (!v) return null;
  const len = Math.hypot(v.x, v.y, v.z);
  if (len <= 1e-6) return null;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function dotVector(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function computeFacing(entity, position, cameraPosition, threshold = 0) {
  const normal = normalizeVector(getVector3(entity.normal || entity.viewNormal || entity.forward || entity.facing));
  if (!normal || !cameraPosition) return { facingDot: null, backFacing: false };
  const camera = getVector3(cameraPosition);
  const view = normalizeVector({ x: camera.x - position.x, y: camera.y - position.y, z: camera.z - position.z });
  if (!view) return { facingDot: null, backFacing: false };
  const facingDot = dotVector(normal, view);
  const cone = entity.normalCone || entity.cone;
  if (cone) {
    const axis = normalizeVector(getVector3(cone.axis || cone.normal || cone.direction));
    const angle = cone.angleRadians ?? cone.angle ?? null;
    const coneSlack = cone.sinAngle ?? (angle != null ? Math.sin(angle) : 0);
    if (axis && dotVector(axis, view) + coneSlack <= 0) return { facingDot, backFacing: true };
  }
  return { facingDot, backFacing: facingDot < threshold };
}

function sampleEntityVertices(entity, limit) {
  const vertices = entity.worldVertices || entity.boundsVertices || entity.vertices;
  if (!vertices) return null;
  const sampled = [];
  if (ArrayBuffer.isView(vertices)) {
    const stride = entity.vertexStride || 3;
    const count = Math.floor(vertices.length / stride);
    const step = Math.max(1, Math.ceil(count / Math.max(1, limit)));
    for (let i = 0; i < count && sampled.length < limit; i += step) sampled.push({ x: vertices[i * stride], y: vertices[i * stride + 1], z: vertices[i * stride + 2] });
    return sampled;
  }
  if (Array.isArray(vertices)) {
    const count = vertices.length;
    const flat = typeof vertices[0] === 'number';
    if (flat) {
      const stride = entity.vertexStride || 3;
      const flatCount = Math.floor(count / stride);
      const step = Math.max(1, Math.ceil(flatCount / Math.max(1, limit)));
      for (let i = 0; i < flatCount && sampled.length < limit; i += step) sampled.push({ x: vertices[i * stride], y: vertices[i * stride + 1], z: vertices[i * stride + 2] });
    } else {
      const step = Math.max(1, Math.ceil(count / Math.max(1, limit)));
      for (let i = 0; i < count && sampled.length < limit; i += step) sampled.push(getVector3(vertices[i], { x: 0, y: 0, z: 0 }));
    }
    return sampled;
  }
  return null;
}

export class StateFirstRasterizer {
  constructor(options = {}) {
    this.mode = options.mode || RASTERIZER_MODE.NATIVE;
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds || {}) };
    this.hysteresisFrames = options.hysteresisFrames ?? 18;
    this.targetFps = options.targetFps || 60;
    this.profile = options.profile || STATE_FIRST_QUALITY_PROFILE.BALANCED;
    this.visibility = { ...DEFAULT_VISIBILITY, ...(options.visibility || {}) };
    this.spatialProxy = { ...DEFAULT_SPATIAL_PROXY, ...(options.spatialProxy || {}) };
    this.temporalVisibility = { ...DEFAULT_TEMPORAL_VISIBILITY, ...(options.temporalVisibility || {}) };
    this.visibilityHistory = new Map();
    this.fpsSmooth = this.targetFps;
    this.cpuMsSmooth = 0;
    this.gpuMsSmooth = 0;
    this.lastGpuSampleSerial = null;
    this.gpuSampleElapsedSeconds = 0;
    this.qualityLevel = Math.max(0, QUALITY_PROFILE_ORDER.indexOf(this.profile));
    this.qualityTargetLevel = this.qualityLevel;
    this.qualityVelocity = 0;
    this.pressureSmooth = 1;
    this.measuredPressure = 1;
    this.degradeDwellSeconds = 0;
    this.recoverDwellSeconds = 0;
    this.antiWindupActive = false;
    this.antiWindupCanceledLevel = 0;
    this.profileIndex = this.qualityLevel;
    this.costSamples = [];
    this.costModel = { fixedMs: 0, stateMsPerMillion: 0, rasterMsPerMillion: 0, sampleCount: 0 };
    this.lastRenderedMillions = 0;
    this.rasterCostShare = 0.5;
    this.costBiasVelocity = 0;
    this.lodTransitionFrames = Math.max(1, options.lodTransitionFrames ?? 30);
    this.frameIndex = 0;
    this.framePolicy = this._makeFramePolicy();
    this.stats = this._makeStats();
  }

  setMode(mode) {
    this.mode = Object.values(RASTERIZER_MODE).includes(mode) ? mode : RASTERIZER_MODE.NATIVE;
    return this.mode;
  }

  getMode() {
    return this.mode;
  }

  isStateFirstEnabled() {
    return this.mode === RASTERIZER_MODE.STATE_FIRST || this.mode === RASTERIZER_MODE.HYBRID;
  }

  beginFrame(totalEntities = 0) {
    this.frameIndex += 1;
    this.stats = this._makeStats(totalEntities);
    this.stats.profile = this.profile;
    this.stats.framePolicy = this.framePolicy;
    return this.stats;
  }

  updateFrameMetrics(metrics = {}) {
    const fps = metrics.fps || (metrics.frameTimeMs ? 1000 / Math.max(0.001, metrics.frameTimeMs) : this.fpsSmooth);
    const measuredFrameMs = Number(metrics.frameTimeMs);
    const controllerSeconds = clamp(
      Number.isFinite(measuredFrameMs) && measuredFrameMs > 0
        ? measuredFrameMs / 1000
        : 1 / Math.max(15, Math.min(240, fps || this.targetFps)),
      1 / 240,
      1 / 15,
    );
    const fpsBlend = 1 - Math.exp(-controllerSeconds / FPS_SMOOTH_SECONDS);
    this.fpsSmooth = lerp(this.fpsSmooth, fps, fpsBlend);
    this.gpuSampleElapsedSeconds += controllerSeconds;
    const cpuMs = Number(metrics.cpuTimeMs ?? metrics.cpuMs);
    const gpuMs = Number(metrics.gpuTimeMs ?? metrics.gpuMs);
    const gpuSampleSerial = Number(metrics.gpuSampleSerial);
    const previousRasterCostShare = this.rasterCostShare;
    let costShareSampleSeconds = controllerSeconds;
    const gpuSampleFresh = Number.isFinite(gpuSampleSerial)
      ? gpuSampleSerial !== this.lastGpuSampleSerial
      : metrics.gpuSampleFresh !== false;
    if (Number.isFinite(cpuMs) && cpuMs >= 0) {
      const cpuBlend = 1 - Math.exp(-controllerSeconds / CPU_SMOOTH_SECONDS);
      this.cpuMsSmooth = this.cpuMsSmooth ? lerp(this.cpuMsSmooth, cpuMs, cpuBlend) : cpuMs;
    }
    if (Number.isFinite(gpuMs) && gpuMs >= 0 && gpuSampleFresh) {
      if (Number.isFinite(gpuSampleSerial)) this.lastGpuSampleSerial = gpuSampleSerial;
      const gpuSampleSeconds = Math.max(controllerSeconds, this.gpuSampleElapsedSeconds);
      costShareSampleSeconds = gpuSampleSeconds;
      const gpuBlend = 1 - Math.exp(-gpuSampleSeconds / GPU_SMOOTH_SECONDS);
      this.gpuMsSmooth = this.gpuMsSmooth ? lerp(this.gpuMsSmooth, gpuMs, gpuBlend) : gpuMs;
      const retainedMillions = Math.max(0, Number(metrics.retainedCount ?? metrics.entityCount ?? 0)) / 1_000_000;
      const renderedCount = metrics.renderedCount ?? metrics.visibleCount;
      const hasRenderedMeasurement = renderedCount != null
        && Number.isFinite(Number(renderedCount))
        && Number(renderedCount) >= 0;
      const renderedMillions = hasRenderedMeasurement
        ? Math.max(0, Number(renderedCount)) / 1_000_000
        : this.lastRenderedMillions;
      if (hasRenderedMeasurement) {
        this.lastRenderedMillions = renderedMillions;
        this.costSamples.push([1, retainedMillions, renderedMillions, gpuMs]);
        if (this.costSamples.length > COST_SAMPLE_LIMIT) this.costSamples.shift();
        this._fitCostModel();
      }
      if (hasRenderedMeasurement && this.costModel.sampleCount >= QUALITY_COST_MODEL_MIN_SAMPLES) {
        const stateVariableMs = this.costModel.stateMsPerMillion * retainedMillions;
        const rasterVariableMs = this.costModel.rasterMsPerMillion * renderedMillions;
        const variableMs = stateVariableMs + rasterVariableMs;
        if (variableMs > 1e-6) {
          const measuredRasterShare = clamp(rasterVariableMs / variableMs, 0, 1);
          const responsibilityBlend = 1 - Math.exp(
            -gpuSampleSeconds / QUALITY_COST_SHARE_SMOOTH_SECONDS,
          );
          this.rasterCostShare = lerp(
            this.rasterCostShare,
            measuredRasterShare,
            responsibilityBlend,
          );
        }
      }
      this.gpuSampleElapsedSeconds = 0;
    }
    const targetFrameMs = 1000 / Math.max(1, metrics.targetFps || this.targetFps);
    const measuredPressure = Math.max(
      this.gpuMsSmooth > 0 ? this.gpuMsSmooth / targetFrameMs : 0,
      this.cpuMsSmooth > 0 ? this.cpuMsSmooth / targetFrameMs : 0,
      (1000 / Math.max(1, this.fpsSmooth)) / targetFrameMs,
    );
    this.measuredPressure = measuredPressure;
    const pressureTimeConstant = measuredPressure > this.pressureSmooth
      ? QUALITY_PRESSURE_ATTACK_SECONDS
      : QUALITY_PRESSURE_RELEASE_SECONDS;
    const pressureBlend = 1 - Math.exp(-controllerSeconds / pressureTimeConstant);
    this.pressureSmooth = lerp(this.pressureSmooth, measuredPressure, pressureBlend);

    const requestedLevel = pressureToQualityLevel(this.pressureSmooth);
    this.antiWindupActive = false;
    this.antiWindupCanceledLevel = 0;
    const staleDegradeTarget = this.qualityTargetLevel - this.qualityLevel;
    const recoveryRequested = requestedLevel < this.qualityLevel - QUALITY_LEVEL_DEADBAND;
    if (staleDegradeTarget > QUALITY_LEVEL_DEADBAND
      && recoveryRequested
      && this.pressureSmooth <= QUALITY_ANTI_WINDUP_RELEASE_PRESSURE
      && measuredPressure <= 1) {
      // Cancel only the accumulated worsening direction. Recovery still waits
      // for its dwell below, so a single inexpensive frame cannot raise LOD.
      this.antiWindupActive = true;
      this.antiWindupCanceledLevel = staleDegradeTarget;
      this.qualityTargetLevel = this.qualityLevel;
      this.degradeDwellSeconds = 0;
    }
    const requestedDelta = requestedLevel - this.qualityTargetLevel;
    if (requestedDelta > QUALITY_LEVEL_DEADBAND) {
      this.degradeDwellSeconds += controllerSeconds;
      this.recoverDwellSeconds = 0;
      if (this.degradeDwellSeconds >= QUALITY_DEGRADE_DWELL_SECONDS) this.qualityTargetLevel = requestedLevel;
    } else if (requestedDelta < -QUALITY_LEVEL_DEADBAND) {
      this.recoverDwellSeconds += controllerSeconds;
      this.degradeDwellSeconds = 0;
      if (this.recoverDwellSeconds >= QUALITY_RECOVER_DWELL_SECONDS) this.qualityTargetLevel = requestedLevel;
    } else {
      this.degradeDwellSeconds = 0;
      this.recoverDwellSeconds = 0;
    }

    const qualityDelta = this.qualityTargetLevel - this.qualityLevel;
    const degradeRate = this.pressureSmooth >= QUALITY_PANIC_PRESSURE
      ? QUALITY_PANIC_LEVELS_PER_SECOND
      : QUALITY_DEGRADE_LEVELS_PER_SECOND;
    const rate = qualityDelta >= 0 ? degradeRate : QUALITY_RECOVER_LEVELS_PER_SECOND;
    const maximumQualityDelta = Math.min(QUALITY_MAX_DELTA_PER_FRAME, rate * controllerSeconds);
    const boundedDelta = clamp(qualityDelta, -maximumQualityDelta, maximumQualityDelta);
    this.qualityLevel = clamp(
      this.qualityLevel + boundedDelta,
      0,
      QUALITY_PROFILE_ORDER.length - 1,
    );
    this.qualityVelocity = boundedDelta / Math.max(1e-6, controllerSeconds);
    const specialization = clamp(
      this.qualityLevel / Math.max(1, QUALITY_PROFILE_ORDER.length - 1),
      0,
      1,
    );
    this.costBiasVelocity = (this.rasterCostShare - previousRasterCostShare) * 2
      * QUALITY_COST_SPLIT_MAX_LEVELS * specialization
      / Math.max(1e-6, costShareSampleSeconds);

    while (this.profileIndex < QUALITY_PROFILE_ORDER.length - 1
      && this.qualityLevel > this.profileIndex + QUALITY_PROFILE_SWITCH_HYSTERESIS) this.profileIndex += 1;
    while (this.profileIndex > 0
      && this.qualityLevel < this.profileIndex - QUALITY_PROFILE_SWITCH_HYSTERESIS) this.profileIndex -= 1;
    this.profile = QUALITY_PROFILE_ORDER[this.profileIndex];
    this.framePolicy = this._makeFramePolicy(metrics);
    return this.framePolicy;
  }

  _fitCostModel() {
    if (this.costSamples.length < 4) return;
    const matrix = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const vector = [0, 0, 0];
    for (const sample of this.costSamples) {
      const x = sample.slice(0, 3);
      for (let row = 0; row < 3; row += 1) {
        vector[row] += x[row] * sample[3];
        for (let column = 0; column < 3; column += 1) matrix[row][column] += x[row] * x[column];
      }
    }
    const solution = solveSymmetric3(matrix, vector);
    if (!solution || !solution.every(Number.isFinite)) return;
    this.costModel = {
      fixedMs: Math.max(0, solution[0]),
      stateMsPerMillion: Math.max(0, solution[1]),
      rasterMsPerMillion: Math.max(0, solution[2]),
      sampleCount: this.costSamples.length,
    };
  }

  getFramePolicy() {
    return { ...this.framePolicy };
  }

  estimatePixelRadius(radius, distance, viewportHeight = 1080, fovYRadians = Math.PI / 3) {
    const projectedScale = viewportHeight / (2 * Math.tan(fovYRadians * 0.5));
    return radius * projectedScale / Math.max(0.001, distance);
  }

  projectEntity(entity, options = {}) {
    const position = getEntityPosition(entity);
    const radius = getEntityRadius(entity);
    const viewportWidth = options.viewportWidth || options.width || 1920;
    const viewportHeight = options.viewportHeight || options.height || 1080;
    const viewProjection = options.viewProjectionMatrix || options.mvp || options.viewProj;
    const distance = entity.distance ?? distanceToCamera(position, options.cameraPosition);
    const projected = {
      position,
      radius,
      distance,
      pixelRadius: entity.pixelRadius ?? (distance != null ? this.estimatePixelRadius(radius, distance, viewportHeight, options.fovYRadians || Math.PI / 3) : 0),
      inFrustum: entity.frustumVisible !== false,
      ndcDepth: entity.ndcDepth ?? null,
      screenX: entity.screenX ?? null,
      screenY: entity.screenY ?? null,
      screenRadius: entity.screenRadius ?? null,
      facingDot: entity.facingDot ?? null,
      backFacing: entity.backFacing === true,
      visibleVertexFraction: entity.visibleVertexFraction ?? null,
      screenCoverage: entity.screenCoverage ?? null,
    };
    if (!viewProjection) return projected;
    const clip = transformPoint(viewProjection, position);
    const w = Math.max(1e-6, Math.abs(clip.w));
    const ndcX = clip.x / w;
    const ndcY = clip.y / w;
    const ndcZ = clip.z / w;
    const pad = this.visibility.frustumPadding + Math.min(0.25, projected.pixelRadius / Math.max(1, viewportHeight));
    projected.inFrustum = clip.w > 0 && Math.abs(ndcX) <= 1 + pad && Math.abs(ndcY) <= 1 + pad && ndcZ >= -pad && ndcZ <= 1 + pad;
    projected.ndcDepth = ndcZ;
    projected.screenX = (ndcX * 0.5 + 0.5) * viewportWidth;
    projected.screenY = (1 - (ndcY * 0.5 + 0.5)) * viewportHeight;
    projected.screenRadius = projected.pixelRadius;
    const facing = computeFacing(entity, position, options.cameraPosition, this.visibility.backfaceDotThreshold);
    projected.facingDot = facing.facingDot;
    projected.backFacing = facing.backFacing;
    const samples = sampleEntityVertices(entity, this.visibility.vertexSampleLimit);
    if (samples?.length) {
      let visibleVertices = 0;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const vertex of samples) {
        const vclip = transformPoint(viewProjection, vertex);
        if (vclip.w <= 0) continue;
        const vx = vclip.x / vclip.w;
        const vy = vclip.y / vclip.w;
        const vz = vclip.z / vclip.w;
        if (Math.abs(vx) <= 1 + this.visibility.frustumPadding && Math.abs(vy) <= 1 + this.visibility.frustumPadding && vz >= -this.visibility.frustumPadding && vz <= 1 + this.visibility.frustumPadding) visibleVertices += 1;
        const sx = (vx * 0.5 + 0.5) * viewportWidth;
        const sy = (1 - (vy * 0.5 + 0.5)) * viewportHeight;
        minX = Math.min(minX, sx);
        minY = Math.min(minY, sy);
        maxX = Math.max(maxX, sx);
        maxY = Math.max(maxY, sy);
      }
      projected.visibleVertexFraction = visibleVertices / samples.length;
      if (Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)) {
        projected.screenCoverage = Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
      }
    }
    return projected;
  }

  evaluateOcclusion(entity, projected, options = {}) {
    if (typeof options.occlusionTest === 'function') return options.occlusionTest(entity, projected) === false;
    const hiZ = options.hiZPass || options.hizPass || options.hiZ;
    if (hiZ && typeof hiZ.testAABB === 'function') {
      const aabb = getEntityAabb(entity);
      return hiZ.testAABB(aabb.min.x, aabb.min.y, aabb.min.z, aabb.max.x, aabb.max.y, aabb.max.z, projected.ndcDepth ?? 1) === false;
    }
    return false;
  }

  evaluateVisibility(entity, options = {}) {
    const projected = this.projectEntity(entity, options);
    let occluded = entity.occluded === true || entity.depthVisible === false;
    if (!occluded && typeof options.visibilityTest === 'function') {
      occluded = options.visibilityTest(entity, projected) === false;
    }
    if (!occluded) occluded = this.evaluateOcclusion(entity, projected, options);
    if (!occluded && typeof options.depthTest === 'function' && projected.screenX != null && projected.ndcDepth != null) {
      const depthVisible = options.depthTest(projected.screenX, projected.screenY, projected.ndcDepth - this.visibility.depthBias, projected.screenRadius || projected.pixelRadius, entity);
      occluded = depthVisible === false;
    }
    let score = projected.inFrustum ? 1 : 0;
    if (occluded) score *= projected.pixelRadius > this.visibility.occlusionDemotePixels ? 0.25 : 0;
    if (projected.backFacing && this.visibility.backfaceCull && entity.doubleSided !== true) score = 0;
    else if (projected.facingDot != null) score *= Math.max(0.15, Math.min(1, this.visibility.facingDemotePower + Math.max(0, projected.facingDot) * (1 - this.visibility.facingDemotePower)));
    if (projected.visibleVertexFraction != null) score *= Math.max(0.05, Math.min(1, projected.visibleVertexFraction * 1.35));
    score *= Math.min(1, Math.max(0.05, projected.pixelRadius / Math.max(1, this.framePolicy.smallPixelCull * 16)));
    return this.applyTemporalVisibility(entity, { ...projected, occluded, visibilityScore: score }, options);
  }

  applyTemporalVisibility(entity, visibility, options = {}) {
    const cfg = { ...this.temporalVisibility, ...(options.temporalVisibility || {}) };
    if (!cfg.enabled || visibility.inFrustum === false) return visibility;
    const key = getEntityVisibilityKey(entity, options.visibilityKey ?? '');
    if (key === '') return visibility;
    const previous = this.visibilityHistory.get(key);
    let occluded = visibility.occluded;
    let score = visibility.visibilityScore;
    let visibleFrames = visibility.occluded ? 0 : 1;
    let occludedFrames = visibility.occluded ? 1 : 0;
    if (previous) {
      visibleFrames = visibility.occluded ? 0 : Math.min(cfg.visibleBoostFrames, previous.visibleFrames + 1);
      occludedFrames = visibility.occluded ? previous.occludedFrames + 1 : 0;
      if (visibility.occluded && previous.wasVisible && occludedFrames <= cfg.occlusionGraceFrames) {
        occluded = false;
        score = Math.max(score, previous.score * 0.5);
        this.stats.temporalRescuedEntities += 1;
      } else if (!visibility.occluded && previous.visibleFrames > 0) {
        score = Math.min(1.25, score * (1 + Math.min(previous.visibleFrames, cfg.visibleBoostFrames) * 0.035));
      }
    }
    this.visibilityHistory.set(key, {
      frame: this.frameIndex,
      score,
      wasVisible: !occluded && score > 0,
      visibleFrames,
      occludedFrames,
    });
    if (this.visibilityHistory.size > cfg.maxEntries) this.pruneVisibilityHistory(cfg);
    return { ...visibility, occluded, visibilityScore: score, temporalVisibleFrames: visibleFrames, temporalOccludedFrames: occludedFrames };
  }

  pruneVisibilityHistory(cfg = this.temporalVisibility) {
    const staleBefore = this.frameIndex - cfg.staleFrameLimit;
    for (const [key, entry] of this.visibilityHistory) {
      if (entry.frame < staleBefore || this.visibilityHistory.size > cfg.maxEntries) this.visibilityHistory.delete(key);
      if (this.visibilityHistory.size <= cfg.maxEntries && entry.frame >= staleBefore) break;
    }
  }

  resetVisibilityHistory() {
    this.visibilityHistory.clear();
  }

  expandClusterEntities(entities, options = {}) {
    if (!options.expandClusters) return entities;
    const expanded = [];
    for (let i = 0; i < entities.length; i += 1) {
      const entity = entities[i];
      const clusters = entity.clusters || entity.meshlets || entity.visibilityClusters;
      if (!clusters?.length) {
        expanded.push(entity);
        continue;
      }
      this.stats.clusterSourceEntities += 1;
      for (let c = 0; c < clusters.length; c += 1) {
        const cluster = clusters[c];
        const aabb = getEntityAabb(cluster);
        const center = cluster.position || cluster.center || [
          (aabb.min.x + aabb.max.x) * 0.5,
          (aabb.min.y + aabb.max.y) * 0.5,
          (aabb.min.z + aabb.max.z) * 0.5,
        ];
        const dx = aabb.max.x - aabb.min.x;
        const dy = aabb.max.y - aabb.min.y;
        const dz = aabb.max.z - aabb.min.z;
        expanded.push({
          ...entity,
          ...cluster,
          id: `${getEntityVisibilityKey(entity, i)}:cluster:${c}`,
          parentEntity: entity,
          parentIndex: i,
          clusterIndex: c,
          isClusterProxy: true,
          position: center,
          radius: cluster.radius ?? Math.max(0.0001, Math.hypot(dx, dy, dz) * 0.5),
          boundsRadius: cluster.boundsRadius ?? cluster.radius ?? Math.max(0.0001, Math.hypot(dx, dy, dz) * 0.5),
          importance: cluster.importance ?? entity.importance ?? 0,
          currentRepresentation: cluster.currentRepresentation ?? entity.currentRepresentation,
          normalCone: cluster.normalCone || cluster.cone || entity.normalCone || entity.cone,
        });
        this.stats.clusterEntities += 1;
      }
    }
    return expanded;
  }

  shouldUpdateEntity(index, dirtyMask = 0, importance = 0) {
    if (dirtyMask & (STATE_FIRST_DIRTY.MATERIAL | STATE_FIRST_DIRTY.SHAPE | STATE_FIRST_DIRTY.VISIBILITY)) return true;
    if (importance >= 0.75) return true;
    const cadence = Math.max(1, Number(this.framePolicy.updateCadence ?? this.framePolicy.updateStride) || 1);
    const lowerStride = Math.max(1, Math.floor(cadence));
    const upperStride = Math.max(lowerStride, Math.ceil(cadence));
    const cadenceBlend = cadence - lowerStride;
    const stride = stateFirstLodRank(index) < cadenceBlend ? upperStride : lowerStride;
    return (index + this.frameIndex) % stride === 0;
  }

  shouldCullEntity(entity) {
    if (entity.visible === false) return true;
    if (entity.inFrustum === false) return true;
    if (entity.occluded === true && (entity.importance || 0) < 0.75) return true;
    if (entity.backFacing === true && this.visibility.backfaceCull && entity.doubleSided !== true && (entity.importance || 0) < 0.75) return true;
    if (entity.visibilityScore != null && entity.visibilityScore <= 0 && (entity.importance || 0) < 0.75) return true;
    return false;
  }

  shouldProxyCell(cell, proxy, options = {}) {
    const cfg = { ...this.spatialProxy, ...(options.spatialProxy || {}) };
    if (!cfg.enabled) return false;
    if (cell.entities.length < cfg.minEntitiesPerProxy) return false;
    if (cell.maxImportance >= cfg.highImportanceKeep) return false;
    if (proxy.inFrustum === false) return true;
    if (proxy.occluded === true) return true;
    if (proxy.distance != null && proxy.distance >= cfg.nearDistance) return true;
    return (proxy.pixelRadius || 0) <= cfg.maxProxyPixelRadius;
  }

  planSpatialProxies(entities, options = {}) {
    const cfg = { ...this.spatialProxy, ...(options.spatialProxy || {}) };
    if (!cfg.enabled) {
      return {
        directEntities: entities,
        proxies: [],
        cells: 0,
        proxiedEntities: 0,
        proxyCellCount: 0,
        cellSize: cfg.cellSize,
      };
    }
    const cells = new Map();
    const proxied = new Set();
    const proxies = [];
    const directEntities = [];
    for (let i = 0; i < entities.length; i += 1) {
      const entity = entities[i];
      const p = getEntityPosition(entity);
      const cx = Math.floor(p.x / cfg.cellSize);
      const cz = Math.floor(p.z / cfg.cellSize);
      const key = `${cx},${cz}`;
      let cell = cells.get(key);
      if (!cell) {
        cell = { key, cx, cz, entities: [], sumX: 0, sumY: 0, sumZ: 0, sumR: 0, sumVx: 0, sumVy: 0, sumVz: 0, maxImportance: 0, minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
        cells.set(key, cell);
      }
      const radius = getEntityRadius(entity);
      const velocity = getEntityVelocity(entity);
      const importance = entity.importance || 0;
      cell.entities.push({ index: i, entity });
      cell.sumX += p.x;
      cell.sumY += p.y;
      cell.sumZ += p.z;
      cell.sumR += radius;
      cell.sumVx += velocity.x;
      cell.sumVy += velocity.y;
      cell.sumVz += velocity.z;
      cell.maxImportance = Math.max(cell.maxImportance, importance);
      cell.minX = Math.min(cell.minX, p.x - radius);
      cell.minY = Math.min(cell.minY, p.y - radius);
      cell.minZ = Math.min(cell.minZ, p.z - radius);
      cell.maxX = Math.max(cell.maxX, p.x + radius);
      cell.maxY = Math.max(cell.maxY, p.y + radius);
      cell.maxZ = Math.max(cell.maxZ, p.z + radius);
    }
    for (const cell of cells.values()) {
      const inv = 1 / Math.max(1, cell.entities.length);
      const center = {
        x: cell.sumX * inv + cell.sumVx * inv * cfg.flowScale,
        y: cell.sumY * inv + cell.sumVy * inv * cfg.flowScale,
        z: cell.sumZ * inv + cell.sumVz * inv * cfg.flowScale,
      };
      const dx = cell.maxX - cell.minX;
      const dy = cell.maxY - cell.minY;
      const dz = cell.maxZ - cell.minZ;
      const radius = Math.max(cfg.cellSize * 0.5, Math.hypot(dx, dy, dz) * 0.5);
      const proxyEntity = {
        id: `spatial-proxy:${cell.key}`,
        cellKey: cell.key,
        isSpatialProxy: true,
        cellX: cell.cx,
        cellZ: cell.cz,
        sourceCount: cell.entities.length,
        position: [center.x, center.y, center.z],
        radius,
        boundsRadius: radius,
        importance: Math.min(0.65, cell.maxImportance + Math.min(0.25, cell.entities.length / 512)),
        velocity: [cell.sumVx * inv, cell.sumVy * inv, cell.sumVz * inv],
        currentRepresentation: cfg.representation,
        proxyRepresentation: cfg.representation,
      };
      const visibility = this.evaluateVisibility(proxyEntity, options);
      Object.assign(proxyEntity, {
        distance: visibility.distance,
        pixelRadius: visibility.pixelRadius,
        inFrustum: visibility.inFrustum,
        occluded: visibility.occluded,
        visibilityScore: visibility.visibilityScore,
      });
      if (this.shouldProxyCell(cell, proxyEntity, options)) {
        proxies.push(proxyEntity);
        for (const entry of cell.entities) proxied.add(entry.index);
      }
    }
    for (let i = 0; i < entities.length; i += 1) {
      if (!proxied.has(i)) directEntities.push(entities[i]);
    }
    return {
      directEntities,
      proxies,
      cells: cells.size,
      proxiedEntities: proxied.size,
      proxyCellCount: proxies.length,
      cellSize: cfg.cellSize,
    };
  }

  classifyEntity(entity) {
    if (this.shouldCullEntity(entity)) {
      this.stats.culledEntities += 1;
      this.stats.representationCounts[STATE_FIRST_REPRESENTATION.NONE] = (this.stats.representationCounts[STATE_FIRST_REPRESENTATION.NONE] || 0) + 1;
      return STATE_FIRST_REPRESENTATION.NONE;
    }
    if (entity.isSpatialProxy && entity.proxyRepresentation != null) {
      const next = entity.proxyRepresentation;
      this.stats.visibleEntities += 1;
      this.stats.representationCounts[next] = (this.stats.representationCounts[next] || 0) + 1;
      return next;
    }
    const current = entity.currentRepresentation ?? STATE_FIRST_REPRESENTATION.POINT;
    const visibilityBoost = entity.visibilityScore == null ? 1 : Math.max(0.2, Math.min(1.25, entity.visibilityScore));
    const visibilityImportance = Math.max(0, (entity.importance || 0) * visibilityBoost);
    const visibilityPixels = Math.max(0, (entity.pixelRadius || 0) * visibilityBoost);
    const lodRank = entity.lodRank ?? stateFirstLodRank(entity.id ?? entity.entityId ?? entity.index ?? 0);
    const requestedRepresentation = chooseStateFirstRepresentation(
      visibilityPixels,
      visibilityImportance,
      current,
      entity.holdFrames || 0,
      this.thresholds,
      this.framePolicy,
      lodRank,
    );
    const minimumVisibleRepresentation = getMinimumVisibleRepresentation(entity);
    const next = Math.max(requestedRepresentation, minimumVisibleRepresentation);
    if (next !== current) {
      if (next > current) this.stats.promotions += 1;
      else this.stats.demotions += 1;
      this.stats.cacheMisses += 1;
    } else {
      this.stats.cacheHits += 1;
    }
    this.stats.visibleEntities += entity.visible === false ? 0 : 1;
    if (entity.visible === false) this.stats.culledEntities += 1;
    this.stats.representationCounts[next] = (this.stats.representationCounts[next] || 0) + 1;
    return next;
  }

  planRenderBuckets(entities, options = {}) {
    this.beginFrame(entities.length);
    const clusterEntities = this.expandClusterEntities(entities, options);
    const useSpatialProxy = options.spatialProxy == null ? this.spatialProxy.enabled : options.spatialProxy === true;
    const proxyPlan = useSpatialProxy ? this.planSpatialProxies(clusterEntities, options) : null;
    const plannedEntities = proxyPlan ? proxyPlan.directEntities.concat(proxyPlan.proxies) : clusterEntities;
    const buckets = {
      [STATE_FIRST_REPRESENTATION.STATE_ONLY]: [],
      [STATE_FIRST_REPRESENTATION.POINT]: [],
      [STATE_FIRST_REPRESENTATION.SPLAT]: [],
      [STATE_FIRST_REPRESENTATION.LINE]: [],
      [STATE_FIRST_REPRESENTATION.BILLBOARD]: [],
      [STATE_FIRST_REPRESENTATION.FIELD]: [],
      [STATE_FIRST_REPRESENTATION.SDF]: [],
      [STATE_FIRST_REPRESENTATION.LOW_MESH]: [],
      [STATE_FIRST_REPRESENTATION.FULL_MESH]: [],
    };
    if (proxyPlan) {
      this.stats.spatialProxyCells = proxyPlan.cells;
      this.stats.spatialProxyBuckets = proxyPlan.proxyCellCount;
      this.stats.spatialProxyEntities = proxyPlan.proxiedEntities;
    }
    let dirtyBudget = Math.max(1, Math.floor(plannedEntities.length * this.framePolicy.maxDirtyFraction));
    for (let i = 0; i < plannedEntities.length; i += 1) {
      const entity = plannedEntities[i];
      if (options.visibility || options.viewProjectionMatrix || options.mvp || options.viewProj || options.visibilityTest || options.depthTest) {
        const visibility = this.evaluateVisibility(entity, options);
        entity.distance = entity.distance ?? visibility.distance;
        entity.pixelRadius = visibility.pixelRadius;
        entity.inFrustum = visibility.inFrustum;
        entity.occluded = visibility.occluded;
        entity.visibilityScore = visibility.visibilityScore;
        entity.facingDot = visibility.facingDot;
        entity.backFacing = visibility.backFacing;
        entity.visibleVertexFraction = visibility.visibleVertexFraction;
        entity.screenCoverage = visibility.screenCoverage;
        if (!visibility.inFrustum) this.stats.frustumCulledEntities += 1;
        if (visibility.occluded) this.stats.occlusionCulledEntities += 1;
        if (visibility.backFacing) this.stats.backFacingEntities += 1;
      }
      const dirtyMask = entity.dirtyMask || 0;
      const updateAllowed = entity.isSpatialProxy || (dirtyBudget > 0 && this.shouldUpdateEntity(i, dirtyMask, entity.importance || 0));
      if (updateAllowed && dirtyMask) {
        dirtyBudget -= 1;
        this.markDirty(dirtyMask);
      }
      if (!updateAllowed && options.skipCleanEntities) {
        this.stats.cacheHits += 1;
        continue;
      }
      const representation = this.classifyEntity(entity);
      if (buckets[representation]) buckets[representation].push(entity);
    }
    return {
      buckets,
      stats: this.getStats(),
      policy: this.getFramePolicy(),
      spatialProxy: proxyPlan,
      indirectDrawPreferred: this.framePolicy.preferIndirect,
      renderBundlePreferred: this.framePolicy.preferRenderBundles,
    };
  }

  markDirty(mask) {
    if (mask) this.stats.dirtyEntities += 1;
    this.stats.dirtyMaskUnion |= mask || 0;
  }

  getStats() {
    return {
      ...this.stats,
      representationCounts: { ...this.stats.representationCounts },
      mode: this.mode,
      modeLabel: stateFirstModeLabel(this.mode),
      profile: this.profile,
      fpsSmooth: this.fpsSmooth,
    };
  }

  _makeFramePolicy(metrics = {}) {
    // The learned model decides which half of the frame owns the pressure.
    // Keep the split deliberately narrow and smoothly varying so it avoids
    // degrading simulation and raster quality in lockstep without creating a
    // second visible profile switch.
    const specialization = clamp(
      this.qualityLevel / Math.max(1, QUALITY_PROFILE_ORDER.length - 1),
      0,
      1,
    );
    const costBias = (this.rasterCostShare - 0.5) * 2
      * QUALITY_COST_SPLIT_MAX_LEVELS * specialization;
    const rasterQuality = sampleQualityProfile(this.qualityLevel + costBias);
    const simulationQuality = sampleQualityProfile(this.qualityLevel - costBias);
    const updateCadence = lerp(
      simulationQuality.low.updateStride,
      simulationQuality.high.updateStride,
      simulationQuality.softBlend,
    );
    const transitionMotion = clamp(Math.max(
      Math.abs(this.qualityVelocity),
      Math.abs(this.costBiasVelocity),
    ) / QUALITY_DEGRADE_LEVELS_PER_SECOND, 0, 1.5);
    const adaptiveTransitionFrames = Math.ceil(this.lodTransitionFrames * (1 + transitionMotion * 0.7));
    const base = {
      thresholdScale: lerp(
        rasterQuality.low.thresholdScale,
        rasterQuality.high.thresholdScale,
        rasterQuality.blend,
      ),
      updateCadence,
      updateStride: Math.max(1, Math.ceil(updateCadence)),
      maxDirtyFraction: lerp(
        simulationQuality.low.maxDirtyFraction,
        simulationQuality.high.maxDirtyFraction,
        simulationQuality.blend,
      ),
      farCullDistance: Infinity,
      smallPixelCull: 0,
      // The ceiling changes point-wise instead of flipping for the entire
      // scene at the midpoint of a profile. `chooseStateFirstRepresentation`
      // uses a stable exact-quota entity rank to select either side.
      maxRepresentation: rasterQuality.low.maxRepresentation,
      maxRepresentationHigh: rasterQuality.low.maxRepresentation,
      maxRepresentationLow: rasterQuality.high.maxRepresentation,
      maxRepresentationBlend: rasterQuality.softBlend,
      representationCeilingFrom: rasterQuality.low.maxRepresentation,
      representationCeilingTo: rasterQuality.high.maxRepresentation,
      representationCeilingBlend: rasterQuality.softBlend,
    };
    const entityCount = metrics.entityCount || 0;
    const retainedMillions = Math.max(0, Number(metrics.retainedCount ?? entityCount)) / 1_000_000;
    const renderedCount = metrics.renderedCount ?? metrics.visibleCount;
    const renderedMillions = renderedCount != null && Number.isFinite(Number(renderedCount))
      ? Math.max(0, Number(renderedCount)) / 1_000_000
      : this.lastRenderedMillions;
    return {
      ...base,
      profile: this.profile,
      qualityLevel: this.qualityLevel,
      simulationQualityLevel: simulationQuality.level,
      rasterQualityLevel: rasterQuality.level,
      rasterCostShare: this.rasterCostShare,
      targetQualityLevel: this.qualityTargetLevel,
      qualityVelocity: this.qualityVelocity,
      costBiasVelocity: this.costBiasVelocity,
      qualityTransitioning: Math.abs(this.qualityTargetLevel - this.qualityLevel) > QUALITY_LEVEL_DEADBAND
        || Math.abs(this.costBiasVelocity) > QUALITY_COST_BIAS_VELOCITY_EPSILON,
      measuredPressure: this.measuredPressure,
      pressureSmooth: this.pressureSmooth,
      antiWindupActive: this.antiWindupActive,
      antiWindupCanceledLevel: this.antiWindupCanceledLevel,
      degradeDwellSeconds: this.degradeDwellSeconds,
      recoverDwellSeconds: this.recoverDwellSeconds,
      lodBlend: rasterQuality.blend,
      lodTransitionFrames: adaptiveTransitionFrames,
      preferIndirect: entityCount >= 1024,
      preferRenderBundles: entityCount >= 256,
      preferSinglePackedUpload: false,
      preferRetainedBuckets: true,
      preferDirtyRangeUploads: true,
      avoidGpuReadback: true,
      cpuTimeMs: this.cpuMsSmooth,
      gpuTimeMs: this.gpuMsSmooth,
      estimatedGpuMs: this.costModel.fixedMs
        + this.costModel.stateMsPerMillion * retainedMillions
        + this.costModel.rasterMsPerMillion * renderedMillions,
      costModel: { ...this.costModel },
      targetFps: metrics.targetFps || this.targetFps,
    };
  }

  _makeStats(totalEntities = 0) {
    return {
      mode: this.mode,
      profile: this.profile,
      totalEntities,
      visibleEntities: 0,
      culledEntities: 0,
      dirtyEntities: 0,
      frustumCulledEntities: 0,
      occlusionCulledEntities: 0,
      backFacingEntities: 0,
      clusterSourceEntities: 0,
      clusterEntities: 0,
      spatialProxyCells: 0,
      spatialProxyBuckets: 0,
      spatialProxyEntities: 0,
      temporalRescuedEntities: 0,
      dirtyMaskUnion: 0,
      promotions: 0,
      demotions: 0,
      cacheHits: 0,
      cacheMisses: 0,
      representationCounts: {},
      framePolicy: this.framePolicy,
    };
  }
}

export function createStateFirstRasterizer(options) {
  return new StateFirstRasterizer(options);
}
