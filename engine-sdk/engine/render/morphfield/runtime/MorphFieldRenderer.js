// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  bufferUsage,
  inspectDeviceCapabilities,
  positiveExtent,
  shaderStages,
  textureUsage,
  validateBorrowedDevice,
  validateExternalEncoder,
} from "./capabilities.js";
import { AdaptiveQualityGovernor, normalizeQualityDecision } from "./AdaptiveQualityGovernor.js";
import { ResourceOwnershipTracker } from "./ResourceOwnershipTracker.js";
import { SceneBufferUploader } from "./SceneBufferUploader.js";
import { MorphFieldQueryEncoder } from "./QueryEncoder.js";
import { MorphFieldWavefrontPathTracer } from "./wavefront/MorphFieldWavefrontPathTracer.js";
import { withErrorScope } from "../../../core/gpu/GpuDebug.js";
import {
  FIELDLET_FAMILY,
  FIELDLET_FLAG,
  FIELDLET_HEADER_WORD,
  FIELDLET_SUBTYPE,
  INVALID_REF,
  META_LAYOUT,
  QUERY_MASK,
} from "../core/constants.js";
import {
  COMPOSITE_SHADER_WGSL,
  PHASE_SHADER_WGSL,
  TILE_BVH_BIN_SHADER_WGSL,
  TRACE_LINEAR_SHADER_WGSL,
  TRACE_SHADER_WGSL,
  TRACE_TILE_BVH_SHADER_WGSL,
  WAVEFRONT_RESOLVE_SHADER_WGSL,
} from "./RuntimeShaders.js";

const INTERNAL_COLOR_FORMAT = "rgba16float";
const INTERNAL_DEPTH_FORMAT = "depth32float";
const FRAME_UNIFORM_BYTES = 256;
const FRAME_UNIFORM_SLOTS = 64;
const SCREEN_TILE_BIN_UNIFORM_BYTES = 112;
const SCREEN_TILE_BIN_UNIFORM_STRIDE = 256;
const PHASE_UNIFORM_STRIDE = 256;
const PHASE_COUNT = 8;
const TIMING_WINDOW_FRAMES = 120;
const MIN_BVH_PIPELINE_FIELDLETS = 64;
const TRACE_BVH_EXPERIMENTAL_POLICY = "explicit-opt-in";
const SCREEN_TILE_BVH_TILE_SIZE = 16;
const SCREEN_TILE_BVH_CANDIDATE_CAPACITY = 64;
const SCREEN_TILE_BVH_RECORD_PAIR_STRIDE = 33;
const SCREEN_TILE_BVH_BIN_WORKGROUP_SIZE = 1;
const SCREEN_TILE_BVH_MIN_FIELDLETS = 64;
const SCREEN_TILE_BVH_EXPERIMENTAL_POLICY = "explicit-opt-in";
const AUTO_PROGRESSIVE_MIN_SAMPLES = 45;
const AUTO_PROGRESSIVE_ADMISSION_RATIO = 0.72;
const AUTO_PROGRESSIVE_ADMISSION_P97_RATIO = 0.90;
const AUTO_PROGRESSIVE_ABORT_RATIO = 1.18;
const AUTO_PROGRESSIVE_CRITICAL_RATIO = 1.75;
const AUTO_PROGRESSIVE_BASE_COOLDOWN_MS = 10_000;
const AUTO_PROGRESSIVE_MAX_COOLDOWN_MS = 60_000;
const DEFAULT_WAVEFRONT_HYBRID_RETENTION_BYTES = 64 * 1024 * 1024;
const AUTHORITATIVE_PERFORMANCE_FIELDS = Object.freeze([
  "targetMode",
  "targetFPS",
  "targetFrameMs",
  "displayRefresh",
  "frameP50Ms",
  "frameP95Ms",
  "frameP97Ms",
  "frameP99Ms",
  "frameMaxMs",
  "frameOverBudgetRatio",
  "frameEmaMs",
  "cpuP95Ms",
  "cpuP97Ms",
  "cpuSamples",
  "gpuP95Ms",
  "gpuP97Ms",
  "gpuSamples",
  "timingSource",
  "gpuTimingAvailable",
  "gpuSamplePending",
  "queueDepth",
  "queueCapacity",
  "queueThrottled",
  "queueNearCapacity",
  "queuePressure",
  "queuePressureDowngrade",
  "queueDowngradeStreak",
  "presentationMs",
  "displayIntervalMs",
  "queueCompletionWallMs",
  "performanceSignalsReady",
  "qualityUpgradeSignalsReady",
  "autoProgressiveEligible",
  "progressiveBudget",
  "progressiveBudgetMs",
]);
const OUTPUT_TRANSFER = Object.freeze({ AUTO: "auto", LINEAR: "linear", SRGB: "srgb" });
const COMPOSITION_MODE = Object.freeze({ REPLACE: "replace", OVER: "over" });
const DEBUG_VIEW = Object.freeze({
  composite: 0,
  bounds: 1,
  family: 2,
  certificates: 3,
  "trace-steps": 4,
  residency: 5,
  normal: 6,
  depth: 7,
  history: 8,
  queries: 9,
});
const LOGICAL_PHASES = Object.freeze([
  "Patch and stream",
  "Simulate",
  "Maintain spatial structures",
  "Cull and bin",
  "Render validated opaque surface caches",
  "Trace direct fields",
  "Integrate media and oriented kernels",
  "Shade, temporally reconstruct, and compose",
]);
const PHASE_PASS_DESCRIPTORS = Object.freeze(LOGICAL_PHASES.map((name, phase) => Object.freeze({
  label: `MorphField.${phase + 1}.${name}.State`,
})));
const PHASE_EXECUTION_KIND = Object.freeze({
  MARKER: "marker",
  EXTERNAL: "external",
  CPU: "cpu",
  GPU: "gpu",
});
const PHASE_EXECUTION = Object.freeze(LOGICAL_PHASES.map((name, phaseIndex) => {
  const phase = phaseIndex + 1;
  const substantiveWork = phase === 6 || phase === 8;
  const implementedWork = phase === 6
    ? Object.freeze(["direct-field-trace"])
    : phase === 8
      ? Object.freeze(["wavefront-progressive", "wavefront-resolve-progressive", "host-composite"])
      : Object.freeze([]);
  return Object.freeze({
    phase,
    name,
    execution: substantiveWork ? PHASE_EXECUTION_KIND.GPU : PHASE_EXECUTION_KIND.MARKER,
    status: substantiveWork ? "partial" : "marker-only",
    substantiveWork,
    markerOnly: !substantiveWork,
    markerEncoded: true,
    implementedWork,
  });
}));
const SCREEN_TILE_BVH_PHASE_EXECUTION = Object.freeze(PHASE_EXECUTION.map((entry) => (
  entry.phase === 4
    ? Object.freeze({
      ...entry,
      execution: PHASE_EXECUTION_KIND.GPU,
      status: "partial",
      substantiveWork: true,
      markerOnly: false,
      implementedWork: Object.freeze(["screen-tile-bvh-cull-and-bin"]),
    })
    : entry
)));
const EMPTY_ENCODED_WORK = Object.freeze([]);
const DEFAULT_CLEAR_COLOR = Object.freeze({ r: 0, g: 0, b: 0, a: 1 });

function wavefrontFrameTelemetry(frameIndex = -1, encoding = null) {
  return Object.freeze({
    encoded: Boolean(encoding?.encoded),
    frameIndex,
    passCount: encoding?.passCount || 0,
    tileCount: encoding?.tileCount || 0,
    queueCapacity: encoding?.queueCapacity || 0,
    resolveEncoded: Boolean(encoding?.encoded),
  });
}

function encodedWorkEvent(order, phase, label, kind, substantiveWork, passCount = 1) {
  return Object.freeze({
    order,
    phase,
    label,
    kind,
    execution: substantiveWork ? PHASE_EXECUTION_KIND.GPU : PHASE_EXECUTION_KIND.MARKER,
    substantiveWork,
    passCount,
  });
}

const IDENTITY_MATRIX = Object.freeze([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);

function nowMilliseconds() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function optionalNonNegative(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function preserveAuthoritativePerformance(decision, authoritative) {
  const merged = { ...decision };
  for (const field of AUTHORITATIVE_PERFORMANCE_FIELDS) {
    merged[field] = authoritative[field];
  }
  return Object.freeze(merged);
}

function matrixValue(value) {
  if (ArrayBuffer.isView(value) || Array.isArray(value)) {
    if (value.length >= 16) return value;
  }
  return null;
}

function cameraMatrix(camera, names) {
  for (const name of names) {
    const value = typeof camera?.[name] === "function" ? camera[name]() : camera?.[name];
    const matrix = matrixValue(value);
    if (matrix) return matrix;
  }
  return null;
}

function invertMatrix4(input, output = new Float32Array(16)) {
  const m = input;
  const b00 = m[0] * m[5] - m[1] * m[4];
  const b01 = m[0] * m[6] - m[2] * m[4];
  const b02 = m[0] * m[7] - m[3] * m[4];
  const b03 = m[1] * m[6] - m[2] * m[5];
  const b04 = m[1] * m[7] - m[3] * m[5];
  const b05 = m[2] * m[7] - m[3] * m[6];
  const b06 = m[8] * m[13] - m[9] * m[12];
  const b07 = m[8] * m[14] - m[10] * m[12];
  const b08 = m[8] * m[15] - m[11] * m[12];
  const b09 = m[9] * m[14] - m[10] * m[13];
  const b10 = m[9] * m[15] - m[11] * m[13];
  const b11 = m[10] * m[15] - m[11] * m[14];
  let determinant = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return Float32Array.from(IDENTITY_MATRIX);
  determinant = 1 / determinant;
  output[0] = (m[5] * b11 - m[6] * b10 + m[7] * b09) * determinant;
  output[1] = (m[2] * b10 - m[1] * b11 - m[3] * b09) * determinant;
  output[2] = (m[13] * b05 - m[14] * b04 + m[15] * b03) * determinant;
  output[3] = (m[10] * b04 - m[9] * b05 - m[11] * b03) * determinant;
  output[4] = (m[6] * b08 - m[4] * b11 - m[7] * b07) * determinant;
  output[5] = (m[0] * b11 - m[2] * b08 + m[3] * b07) * determinant;
  output[6] = (m[14] * b02 - m[12] * b05 - m[15] * b01) * determinant;
  output[7] = (m[8] * b05 - m[10] * b02 + m[11] * b01) * determinant;
  output[8] = (m[4] * b10 - m[5] * b08 + m[7] * b06) * determinant;
  output[9] = (m[1] * b08 - m[0] * b10 - m[3] * b06) * determinant;
  output[10] = (m[12] * b04 - m[13] * b02 + m[15] * b00) * determinant;
  output[11] = (m[9] * b02 - m[8] * b04 - m[11] * b00) * determinant;
  output[12] = (m[5] * b07 - m[4] * b09 - m[6] * b06) * determinant;
  output[13] = (m[0] * b09 - m[1] * b07 + m[2] * b06) * determinant;
  output[14] = (m[13] * b01 - m[12] * b03 - m[14] * b00) * determinant;
  output[15] = (m[8] * b03 - m[9] * b01 + m[10] * b00) * determinant;
  return output;
}

function normalizeLogger(logger) {
  if (typeof logger === "function") {
    return {
      debug: (event, details) => logger("debug", event, details),
      info: (event, details) => logger("info", event, details),
      warn: (event, details) => logger("warn", event, details),
      error: (event, details) => logger("error", event, details),
    };
  }
  const sink = logger || {};
  return {
    debug: typeof sink.debug === "function" ? sink.debug.bind(sink) : () => {},
    info: typeof sink.info === "function" ? sink.info.bind(sink) : () => {},
    warn: typeof sink.warn === "function" ? sink.warn.bind(sink) : () => {},
    error: typeof sink.error === "function" ? sink.error.bind(sink) : () => {},
  };
}

function cameraPosition(camera, output = new Array(3)) {
  const value = camera?.position || camera?.worldPosition || camera?.eye || [0, 0, 5];
  output[0] = finite(value[0]);
  output[1] = finite(value[1]);
  output[2] = finite(value[2], 5);
  return output;
}

function firstDirectionalLight(lights) {
  if (Array.isArray(lights)) return lights.find((light) => light?.type === "directional") || lights[0] || {};
  if (Array.isArray(lights?.directional)) return lights.directional[0] || {};
  if (lights?.sunDirection || lights?.sunColor || lights?.sunIntensity !== undefined) {
    return {
      direction: lights.sunDirection,
      color: lights.sunColor,
      intensity: lights.enableSun === false ? 0 : lights.sunIntensity,
    };
  }
  return lights?.sun || lights?.directional || lights || {};
}

function vector3(value, fallback, output = new Array(3)) {
  output[0] = finite(value?.[0], fallback[0]);
  output[1] = finite(value?.[1], fallback[1]);
  output[2] = finite(value?.[2], fallback[2]);
  return output;
}

function resolveDirectionToLight(light, output = new Array(3)) {
  if (light?.directionToLight) return vector3(light.directionToLight, [0.4, 0.8, 0.3], output);
  if (light?.direction) {
    vector3(light.direction, [-0.4, -0.8, -0.3], output);
    output[0] = -output[0];
    output[1] = -output[1];
    output[2] = -output[2];
    return output;
  }
  output[0] = 0.4;
  output[1] = 0.8;
  output[2] = 0.3;
  return output;
}

function cameraSignature(matrix, position) {
  let hash = 2166136261;
  for (let index = 0; index < 16; index += 1) {
    const quantized = Math.round(finite(matrix[index]) * 100000);
    hash ^= quantized;
    hash = Math.imul(hash, 16777619);
  }
  for (const component of position) {
    hash ^= Math.round(component * 10000);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function assertLightingMode(mode) {
  if (mode !== "auto" && mode !== "hybrid" && mode !== "progressive") {
    throw new RangeError("MorphField: lighting mode must be auto, hybrid, or progressive");
  }
  return mode;
}

function assertOutputTransfer(value) {
  const mode = String(value || OUTPUT_TRANSFER.AUTO).toLowerCase();
  if (!Object.values(OUTPUT_TRANSFER).includes(mode)) {
    throw new RangeError("MorphField: outputTransfer must be auto, linear, or srgb");
  }
  return mode;
}

function manualSrgbTransfer(format, mode) {
  const normalized = String(format || "").toLowerCase();
  if (normalized.endsWith("-srgb")) return false;
  if (mode === OUTPUT_TRANSFER.SRGB) return true;
  if (mode === OUTPUT_TRANSFER.LINEAR) return false;
  return normalized === "rgba8unorm" || normalized === "bgra8unorm";
}

function normalizeTarget(target, output) {
  const composition = String(target?.composition ?? target?.compositionMode ?? COMPOSITION_MODE.REPLACE).toLowerCase();
  if (composition !== COMPOSITION_MODE.REPLACE && composition !== COMPOSITION_MODE.OVER) {
    throw new RangeError("MorphField.encode: target composition must be replace or over");
  }
  output.colorView = target.colorView;
  output.depthView = target.depthView || null;
  output.composition = composition;
  output.colorLoadOp = target.colorLoadOp || (composition === COMPOSITION_MODE.OVER ? "load" : "clear");
  output.colorStoreOp = target.colorStoreOp || "store";
  output.depthLoadOp = target.depthLoadOp || (composition === COMPOSITION_MODE.OVER ? "load" : "clear");
  output.depthStoreOp = target.depthStoreOp || "store";
  output.clearColor = target.clearColor || null;
  output.depthClearValue = target.depthClearValue;
  return output;
}

class FixedTimingWindow {
  constructor(capacity) {
    this.capacity = capacity;
    this.values = new Float64Array(capacity);
    this.scratch = new Float64Array(capacity);
    this.count = 0;
    this.cursor = 0;
  }

  push(value) {
    this.values[this.cursor] = value;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.count = Math.min(this.capacity, this.count + 1);
  }

  clear() {
    this.count = 0;
    this.cursor = 0;
  }

  countAbove(threshold) {
    let total = 0;
    for (let index = 0; index < this.count; index += 1) {
      if (this.values[index] > threshold) total += 1;
    }
    return total;
  }

  snapshot(targetFrameMs) {
    if (this.count === 0) {
      return Object.freeze({ samples: 0, p50Ms: 0, p95Ms: 0, p97Ms: 0, p99Ms: 0, maxMs: 0, overBudget: 0, severeSpikes: 0 });
    }
    this.scratch.set(this.values.subarray(0, this.count), 0);
    const sorted = this.scratch.subarray(0, this.count);
    sorted.sort();
    const percentile = (fraction) => sorted[Math.min(this.count - 1, Math.max(0, Math.ceil(this.count * fraction) - 1))];
    return Object.freeze({
      samples: this.count,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      p97Ms: percentile(0.97),
      p99Ms: percentile(0.99),
      maxMs: sorted[this.count - 1],
      overBudget: this.countAbove(targetFrameMs * AUTO_PROGRESSIVE_ABORT_RATIO),
      severeSpikes: this.countAbove(targetFrameMs * 2),
    });
  }
}

function hashValue(hash, value) {
  return Math.imul(hash ^ Math.round(finite(value) * 10000), 16777619);
}

function lightSignature(lights) {
  let hash = 2166136261;
  const directional = lights.directional[0];
  for (let index = 0; index < 3; index += 1) hash = hashValue(hash, directional.directionToLight[index]);
  for (let index = 0; index < 3; index += 1) hash = hashValue(hash, directional.color[index]);
  hash = hashValue(hash, directional.intensity);
  for (let index = 0; index < 3; index += 1) hash = hashValue(hash, lights.environmentZenith[index]);
  for (let index = 0; index < 3; index += 1) hash = hashValue(hash, lights.environmentHorizon[index]);
  return hashValue(hash, lights.environmentIntensity) >>> 0;
}

function sceneSupportsWavefront(canonical) {
  const headers = canonical?.fieldletHeaders;
  const bundles = canonical?.certificateBundles;
  const certificates = canonical?.surfaceCertificates;
  const count = Number(canonical?.fieldletCount);
  if (!headers || !bundles || !certificates || !Number.isInteger(count) || count <= 0
      || headers.length < count * 4) return false;
  for (let index = 0; index < count; index += 1) {
    const headerBase = index * 4;
    const meta = headers[headerBase + FIELDLET_HEADER_WORD.META] >>> 0;
    const subtype = (meta >>> META_LAYOUT.SUBTYPE_SHIFT) & META_LAYOUT.SUBTYPE_MASK;
    const family = (meta >>> META_LAYOUT.FAMILY_SHIFT) & META_LAYOUT.FAMILY_MASK;
    const queryMask = (meta >>> META_LAYOUT.QUERY_SHIFT) & META_LAYOUT.QUERY_MASK;
    const flags = (meta >>> META_LAYOUT.FLAG_SHIFT) & META_LAYOUT.FLAG_MASK;
    if (family !== FIELDLET_FAMILY.ANALYTIC
        || subtype !== FIELDLET_SUBTYPE.ANALYTIC_PROGRAM
        || (queryMask & QUERY_MASK.SURFACE) === 0
        || (flags & FIELDLET_FLAG.CERTIFIED_SURFACE) === 0) return false;

    const bundleRef = headers[headerBase + FIELDLET_HEADER_WORD.CERTIFICATE_REF] >>> 0;
    const bundleBase = bundleRef * 4;
    if (bundleRef === INVALID_REF || bundleBase + 3 >= bundles.length) return false;
    const surfaceRef = bundles[bundleBase] >>> 0;
    const certificateBase = surfaceRef * 4;
    if (surfaceRef === INVALID_REF || certificateBase + 3 >= certificates.length) return false;
    const fieldError = certificates[certificateBase];
    const lipschitz = certificates[certificateBase + 1];
    const fallbackBand = certificates[certificateBase + 2];
    const motionRadius = certificates[certificateBase + 3];
    if (!Number.isFinite(fieldError) || fieldError < 0
        || !Number.isFinite(lipschitz) || lipschitz <= 0
        || !Number.isFinite(fallbackBand) || fallbackBand < 0
        || !Number.isFinite(motionRadius) || motionRadius < 0) return false;
  }
  return true;
}

function sceneNeedsPointBvh(canonical) {
  return (canonical?.fieldletCount || 0) >= MIN_BVH_PIPELINE_FIELDLETS
    && canonical?.spatialStats?.mode === "bvh";
}

function sceneNeedsScreenTileBvh(canonical) {
  return (canonical?.fieldletCount || 0) >= SCREEN_TILE_BVH_MIN_FIELDLETS
    && canonical?.spatialStats?.mode === "bvh";
}

function tileGrid(width, height) {
  const x = Math.ceil(Math.max(0, width) / SCREEN_TILE_BVH_TILE_SIZE);
  const y = Math.ceil(Math.max(0, height) / SCREEN_TILE_BVH_TILE_SIZE);
  return Object.freeze({ x, y, count: x * y });
}

async function shaderDiagnostics(modules) {
  const failures = [];
  for (const [name, module] of modules) {
    if (typeof module?.getCompilationInfo !== "function") continue;
    const info = await module.getCompilationInfo();
    for (const message of info.messages || []) {
      if (message.type === "error") failures.push(`${name}:${message.lineNum || 0}:${message.linePos || 0} ${message.message}`);
    }
  }
  if (failures.length > 0) throw new Error(`MorphField shader compilation failed:\n${failures.join("\n")}`);
}

function deferUntilNextTask() {
  if (typeof globalThis.setTimeout === "function") {
    return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
  }
  return Promise.resolve();
}

export class MorphFieldRenderer {
  constructor(options) {
    this.device = validateBorrowedDevice(options?.device);
    this.colorFormat = options?.colorFormat || "bgra8unorm";
    this.depthFormat = options?.depthFormat === null ? null : (options?.depthFormat || "depth32float");
    this.logger = normalizeLogger(options?.logger);
    this.capabilities = inspectDeviceCapabilities(this.device);
    this._pipelinePreparation = (typeof this.device.createComputePipelineAsync === "function"
      || typeof this.device.createRenderPipelineAsync === "function") ? "async" : "sync";
    this.qualityGovernor = new AdaptiveQualityGovernor(options?.quality || {});
    this.lightingMode = assertLightingMode(options?.lightingMode || "auto");
    this.outputTransfer = assertOutputTransfer(options?.outputTransfer || OUTPUT_TRANSFER.AUTO);
    this.maxDistance = Math.max(1, finite(options?.maxDistance, 1000));
    this.hitEpsilon = Math.max(1e-6, finite(options?.hitEpsilon, 0.0005));
    this.exposure = Math.max(0, finite(options?.exposure, 1));
    this.tracker = new ResourceOwnershipTracker("MorphField");
    this.sceneUploader = new SceneBufferUploader(this.device, this.tracker, this.capabilities);
    this._baseWidth = 1;
    this._baseHeight = 1;
    this._width = 0;
    this._height = 0;
    this._capacityWidth = 0;
    this._capacityHeight = 0;
    this._inverseViewProjectionScratch = new Float32Array(16);
    this._cameraPositionScratch = [0, 0, 5];
    this._frameUniformData = new ArrayBuffer(FRAME_UNIFORM_BYTES);
    this._frameUniformFloats = new Float32Array(this._frameUniformData);
    this._frameUniformIntegers = new Uint32Array(this._frameUniformData);
    this._frameUniformBytes = new Uint8Array(this._frameUniformData);
    this._screenTileBinUniformData = new ArrayBuffer(SCREEN_TILE_BIN_UNIFORM_BYTES);
    this._screenTileBinUniformFloats = new Float32Array(this._screenTileBinUniformData);
    this._screenTileBinUniformIntegers = new Uint32Array(this._screenTileBinUniformData);
    this._screenTileBinUniformBytes = new Uint8Array(this._screenTileBinUniformData);
    this._phaseUniformData = new ArrayBuffer(PHASE_COUNT * PHASE_UNIFORM_STRIDE);
    this._phaseUniformIntegers = new Uint32Array(this._phaseUniformData);
    this._phaseUniformBytes = new Uint8Array(this._phaseUniformData);
    this._hostViewport = { x: 0, y: 0, width: 1, height: 1, minDepth: 0, maxDepth: 1 };
    this._normalizedTarget = {
      colorView: null,
      depthView: null,
      composition: COMPOSITION_MODE.REPLACE,
      colorLoadOp: "clear",
      colorStoreOp: "store",
      depthLoadOp: "clear",
      depthStoreOp: "store",
      clearColor: null,
      depthClearValue: 1,
    };
    const initialQuality = this.qualityGovernor.getDecision();
    this._quality = normalizeQualityDecision(initialQuality, initialQuality);
    this._textures = null;
    this._views = null;
    this._outputsSnapshot = null;
    this._tracePassDescriptor = null;
    this._pixelMetadata = null;
    this._frameIndex = 0;
    this._frameUniformOffset = 0;
    this._frameUniformWriteSerial = 0;
    this._screenTileBinUniformOffset = 0;
    this._historyIndex = 0;
    this._historySamples = 0;
    this._stableFrames = 0;
    this._cameraSignature = null;
    this._lightSignature = null;
    this._activeLightingMode = "hybrid";
    this._lightingFallbackReason = null;
    this._resolvedLights = {
      directional: [{
        type: "directional",
        directionToLight: [0.4, 0.8, 0.3],
        color: [1, 0.96, 0.88],
        intensity: 3,
      }],
      environmentZenith: [0.32, 0.48, 0.78],
      environmentHorizon: [0.12, 0.16, 0.22],
      environmentIntensity: 1,
    };
    this._lightColorScratch = [1, 0.96, 0.88];
    this._particleTintScratch = [1, 1, 1];
    this._debugView = "composite";
    this._debugMode = DEBUG_VIEW.composite;
    this._lastSceneRevision = 0;
    this._encodeCpuMs = 0;
    this._frameTimings = new FixedTimingWindow(TIMING_WINDOW_FRAMES);
    this._hybridTimings = new FixedTimingWindow(TIMING_WINDOW_FRAMES);
    this._progressiveTimings = new FixedTimingWindow(TIMING_WINDOW_FRAMES);
    this._progressiveConsecutiveOverBudget = 0;
    this._progressiveAbortRequested = null;
    this._progressiveFailureCount = 0;
    this._progressiveBlockedUntilMs = -Infinity;
    this._progressiveLastAdmissionMs = -Infinity;
    this._progressiveLastAbortMs = -Infinity;
    this._progressiveLastReason = "not-evaluated";
    this._progressiveSustainedFrames = 0;
    this._lastHistoryResetReason = null;
    this._historyResetCount = 0;
    this._lastHistoryResetLogMs = -Infinity;
    this._encodedWork = EMPTY_ENCODED_WORK;
    this._errors = 0;
    this._skipQualitySamples = 0;
    this._externalQualityTier = null;
    this._deviceReplacementPromise = null;
    this._destroyed = false;
    this._initialized = false;
    this._sourceScene = null;
    const pointBvhEnabled = options?.experimental?.pointBvh === true;
    const screenTileBvhEnabled = options?.experimental?.screenTileBvh === true;
    if (pointBvhEnabled && screenTileBvhEnabled) {
      throw new RangeError("MorphField: experimental.pointBvh and experimental.screenTileBvh are mutually exclusive");
    }
    // Dawn currently spends minutes optimizing the full point-BVH fragment
    // graph on affected drivers. Keep the measured linear shader as the safe
    // default; the accelerated variant is available only to explicit
    // diagnostic/benchmark hosts until its cold-pipeline gate is bounded.
    this._traceBvhEnabled = pointBvhEnabled;
    this._traceBvhPipeline = null;
    this._traceBvhPreparationPromise = null;
    this._traceBvhPreparationGeneration = 0;
    this._traceBvhPreparationState = this._traceBvhEnabled ? "idle" : "disabled";
    this._traceBvhPreparationReason = this._traceBvhEnabled
      ? "not-requested"
      : "explicit-opt-in-required";
    this._traceBvhPreparationError = null;
    this._traceBvhPreparationAttempts = 0;
    this._traceTraversalRequested = "linear";
    // Screen-tile BVH traversal is a separate, explicit experiment. Phase 4
    // projects the compiler BVH into bounded 16x16 candidate records. Phase 6
    // consumes a record only when its frame/revision tag is valid; invalid or
    // overflowing records take the shader's certified linear fallback.
    this._screenTileBvhEnabled = screenTileBvhEnabled;
    this._screenTileBvhBinPipeline = null;
    this._screenTileBvhTracePipeline = null;
    this._screenTileBvhBinBindGroupLayout = null;
    this._screenTileBvhBinPipelineLayout = null;
    this._screenTileBvhBinBindGroup = null;
    this._screenTileBvhPreparationPromise = null;
    this._screenTileBvhPreparationGeneration = 0;
    this._screenTileBvhPublishedGeneration = -1;
    this._screenTileBvhPreparationState = screenTileBvhEnabled ? "idle" : "disabled";
    this._screenTileBvhPreparationReason = screenTileBvhEnabled
      ? "not-requested"
      : "explicit-opt-in-required";
    this._screenTileBvhPreparationError = null;
    this._screenTileBvhPreparationAttempts = 0;
    this._screenTileBvhCapacityGrid = tileGrid(0, 0);
    this._screenTileBvhActiveGrid = tileGrid(0, 0);
    this._screenTileBvhArenaBytes = 0;
    this._screenTileBvhArenaAllocationBytes = 0;
    this._pixelMetadataBytes = 0;
    this._wavefrontTracer = null;
    this._wavefrontInitializationPromise = null;
    this._wavefrontInitializationGeneration = 0;
    this._wavefrontInitializationState = "idle";
    this._wavefrontInitializationReason = "not-requested";
    this._wavefrontInitializationError = null;
    this._wavefrontInitializationAttempts = 0;
    this._wavefrontInitializationStartedAtMs = null;
    this._wavefrontInitializationReadyAtMs = null;
    this._wavefrontExtent = { width: 0, height: 0 };
    this._wavefrontFrame = wavefrontFrameTelemetry();
    this._wavefrontOptions = Object.freeze({ ...(options?.wavefront || {}) });
    this._wavefrontHybridRetentionBytes = Math.max(
      0,
      finite(options?.wavefront?.hybridRetentionBytes, DEFAULT_WAVEFRONT_HYBRID_RETENTION_BYTES),
    );
  }

  static async create(options) {
    const renderer = new MorphFieldRenderer(options);
    try {
      await renderer._initialize();
      return renderer;
    } catch (error) {
      renderer.destroy();
      throw error;
    }
  }

  setScene(compiledScene) {
    this._assertAlive();
    const canonical = this.sceneUploader.upload(compiledScene);
    // Retain the compiler-produced, device-independent source object.  The
    // detached upload canonical is not compiler-branded and must never become
    // the recovery authority after device loss/replacement.
    this._sourceScene = compiledScene;
    this._lastSceneRevision = canonical.revision;
    this._rebuildSceneBindGroups();
    this._selectTraceTraversal(canonical, "scene-replaced");
    this._syncWavefrontScene();
    this._stableFrames = 0;
    this._resetHistory("scene-replaced");
    this.logger.info("MorphField.scene.set", { revision: canonical.revision, fieldletCount: canonical.fieldletCount });
    return canonical;
  }

  applyPatch(compiledPatch) {
    this._assertAlive();
    const merged = this.sceneUploader.mergePatch(compiledPatch);
    const publication = this.sceneUploader.update(merged, compiledPatch?.runtimeDelta || merged?.runtimeDelta || null);
    const { canonical, reallocated } = publication;
    this._sourceScene = merged;
    this._lastSceneRevision = canonical.revision;
    if (reallocated) this._rebuildSceneBindGroups();
    this._selectTraceTraversal(canonical, "scene-patched");
    if (reallocated) {
      this._syncWavefrontScene();
    } else {
      this._wavefrontTracer?.updateSceneMetadata({
        revision: canonical.revision,
        fieldletCount: canonical.fieldletCount,
        materialCount: Math.max(1, canonical.materials.length / 12),
        materialDescriptors: canonical.materialDescriptors,
      });
    }
    this._stableFrames = 0;
    this._resetHistory("scene-patched");
    this.logger.debug("MorphField.scene.patch", {
      revision: canonical.revision,
      fieldletCount: canonical.fieldletCount,
      reallocated,
      mode: publication.mode,
      bytesWritten: publication.bytesWritten,
      writeCount: publication.writeCount,
      touchedFieldlets: publication.touchedFieldlets || canonical.fieldletCount,
      touchedBvhNodes: publication.touchedBvhNodes || 0,
      deltaFallbackReason: publication.deltaFallbackReason,
    });
    return canonical;
  }

  resize(width, height) {
    this._assertAlive();
    const nextBaseWidth = positiveExtent(width, this.capabilities.limits.maxTextureDimension2D);
    const nextBaseHeight = positiveExtent(height, this.capabilities.limits.maxTextureDimension2D);
    const baseChanged = nextBaseWidth !== this._baseWidth || nextBaseHeight !== this._baseHeight;
    const previousBaseWidth = this._baseWidth;
    const previousBaseHeight = this._baseHeight;
    this._baseWidth = nextBaseWidth;
    this._baseHeight = nextBaseHeight;
    try {
      this._ensureFrameResources(this._quality.renderScale, baseChanged);
    } catch (error) {
      this._baseWidth = previousBaseWidth;
      this._baseHeight = previousBaseHeight;
      this.logger.error("MorphField.resize.rejected", {
        width: nextBaseWidth,
        height: nextBaseHeight,
        reason: String(error?.message || error),
      });
      throw error;
    }
    return { width: this._width, height: this._height };
  }

  setLightingMode(mode) {
    this._assertAlive();
    this.lightingMode = assertLightingMode(mode);
    this._stableFrames = 0;
    this._resetHistory("lighting-mode-changed");
    this._wavefrontFrame = wavefrontFrameTelemetry(this._frameIndex - 1);
    if (this.lightingMode === "hybrid") {
      if (this._wavefrontInitializationState === "initializing") {
        // Invalidate before a deferred task starts so it cannot construct. If
        // creation is already awaiting pipelines, the generation guard rejects
        // publication and destroys the stale tracer when it resolves.
        this._invalidateWavefrontInitialization("explicit-hybrid-mode");
      } else {
        // A ready tracer remains reusable across explicit mode toggles. Release
        // only capacity above the configured Hybrid retention threshold.
        this._releaseWavefrontExtent("explicit-hybrid-mode");
      }
      return null;
    }
    return this._startWavefrontInitialization(`lighting-mode-${this.lightingMode}`, {
      deferred: true,
    });
  }

  setOutputTransfer(mode) {
    this._assertAlive();
    this.outputTransfer = assertOutputTransfer(mode);
    return this.outputTransfer;
  }

  setDebugView(view = "composite") {
    this._assertAlive();
    const name = String(view);
    if (!Object.prototype.hasOwnProperty.call(DEBUG_VIEW, name)) {
      throw new RangeError(`MorphField: unknown debug view ${name}`);
    }
    this._debugView = name;
    this._debugMode = DEBUG_VIEW[name];
    return name;
  }

  encode({
    encoder,
    target,
    viewport,
    camera,
    lights,
    time = 0,
    deltaTime = 1 / 60,
    frameIndex,
    qualityDecision,
    performanceSample,
    memoryPressure = 0,
    cameraCut = false,
    debugView,
  } = {}) {
    this._assertAlive();
    validateExternalEncoder(encoder);
    if (!target?.colorView) throw new TypeError("MorphField.encode: target.colorView is required");
    const normalizedTarget = normalizeTarget(target, this._normalizedTarget);
    if (normalizedTarget.depthView && !this.depthFormat) throw new Error("MorphField.encode: renderer was created without a host depth format");
    if (!this.sceneUploader.buffers) throw new Error("MorphField.encode: setScene must be called before encode");
    if (debugView !== undefined) this.setDebugView(debugView);
    const started = nowMilliseconds();
    const deltaSample = finite(deltaTime, 1 / 60);
    const sampleMs = Math.max(0.001, deltaSample <= 1 ? deltaSample * 1000 : deltaSample);
    const suppliedPerformance = performanceSample && typeof performanceSample === "object"
      ? performanceSample
      : null;
    const measuredCpuMs = optionalNonNegative(suppliedPerformance?.cpuMs);
    const measuredGpuMs = optionalNonNegative(suppliedPerformance?.gpuMs);
    const measuredTotalMs = optionalNonNegative(suppliedPerformance?.totalMs);
    const measuredWorkMs = measuredCpuMs !== null || measuredGpuMs !== null
      ? Math.max(measuredCpuMs ?? 0, measuredGpuMs ?? 0)
      : (measuredTotalMs ?? sampleMs);
    this._recordFrameTiming(Math.max(0.001, measuredWorkMs));
    const governorSample = {
      ...(suppliedPerformance || {}),
      frameMs: optionalNonNegative(suppliedPerformance?.frameMs) ?? sampleMs,
      memoryPressure: memoryPressure >= 0.95 || memoryPressure === "critical" ? "critical" : memoryPressure,
      nowMs: started,
    };
    const hasExternalQuality = qualityDecision !== undefined && qualityDecision !== null;
    let automatic;
    let nextQuality;
    if (hasExternalQuality) {
      automatic = this.qualityGovernor.getDecision();
      const externalTier = String(qualityDecision.tier || qualityDecision.name || automatic.name || automatic.tier);
      if (externalTier !== this._externalQualityTier) {
        this.qualityGovernor.setMode("fixed", externalTier);
        this._externalQualityTier = externalTier;
      }
      const skipCadenceOnlySample = this._skipQualitySamples > 0 && !suppliedPerformance;
      if (this._skipQualitySamples > 0) this._skipQualitySamples -= 1;
      if (skipCadenceOnlySample) {
        automatic = this.qualityGovernor.getDecision();
      } else {
        automatic = this.qualityGovernor.recordFrame({
          ...governorSample,
        });
      }
      // The host owns the tier and workload knobs, but performance evidence is
      // sampled by this encode call. Never allow a cached external decision to
      // clear pending timestamps, queue debt, or the measured GPU window.
      nextQuality = preserveAuthoritativePerformance(
        normalizeQualityDecision(qualityDecision, automatic, { allowResolutionScaling: true }),
        automatic,
      );
    } else {
      if (this._externalQualityTier !== null) {
        this.qualityGovernor.setMode("auto");
        this.qualityGovernor.reset();
        this._externalQualityTier = null;
        this._skipQualitySamples = Math.max(this._skipQualitySamples, 2);
      }
      const skipCadenceOnlySample = this._skipQualitySamples > 0 && !suppliedPerformance;
      if (this._skipQualitySamples > 0) this._skipQualitySamples -= 1;
      if (skipCadenceOnlySample) {
        automatic = this.qualityGovernor.getDecision();
      } else {
        automatic = this.qualityGovernor.recordFrame({
          ...governorSample,
        });
      }
      // The engine-wide governor may emit shadowLevel 0 for its lowest generic
      // tiers. Normalize every automatic decision through MorphField's scoped
      // continuity policy before it reaches the frame ABI.
      nextQuality = normalizeQualityDecision(automatic, automatic);
    }
    const qualityChanged = (nextQuality.name || nextQuality.tier) !== (this._quality.name || this._quality.tier)
      || nextQuality.renderScale !== this._quality.renderScale;
    this._quality = nextQuality;
    const extentChanged = this._ensureFrameResources(nextQuality.renderScale);
    if (qualityChanged) {
      this._stableFrames = 0;
      if (!extentChanged) this._resetHistory("quality-changed");
    }

    const viewProjection = cameraMatrix(camera, ["viewProjectionMatrix", "viewProjection", "viewProj", "getViewProjectionMatrix"])
      || IDENTITY_MATRIX;
    const inverseViewProjection = cameraMatrix(camera, ["inverseViewProjectionMatrix", "inverseViewProjection", "invViewProj", "getInverseViewProjectionMatrix"])
      || invertMatrix4(viewProjection, this._inverseViewProjectionScratch);
    const position = cameraPosition(camera, this._cameraPositionScratch);
    const signature = cameraSignature(viewProjection, position);
    if (cameraCut || (this._cameraSignature !== null && signature !== this._cameraSignature)) {
      this._stableFrames = 0;
      this._resetHistory(cameraCut ? "camera-cut" : "camera-moved");
    } else {
      this._stableFrames += 1;
    }
    this._cameraSignature = signature;
    this._resolveLights(lights);
    const nextLightSignature = lightSignature(this._resolvedLights);
    if (this._lightSignature !== null && nextLightSignature !== this._lightSignature) {
      this._stableFrames = 0;
      this._resetHistory("lights-changed");
    }
    this._lightSignature = nextLightSignature;
    const previousLightingMode = this._activeLightingMode;
    this._activeLightingMode = this._selectLightingMode(started);
    if (this._activeLightingMode === "progressive" && !this._ensureWavefrontExtent()) {
      this._activeLightingMode = "hybrid";
      if (this.lightingMode === "auto") this._beginProgressiveCooldown("wavefront-capacity", started);
    }
    if (this._activeLightingMode !== previousLightingMode) {
      this._resetHistory(`lighting-active-${previousLightingMode}-to-${this._activeLightingMode}`);
      if (this._activeLightingMode === "progressive") {
        this._progressiveTimings.clear();
        this._progressiveConsecutiveOverBudget = 0;
        this._progressiveSustainedFrames = 0;
      } else if (this.lightingMode === "auto") {
        // Auto fallback already entered a bounded cooldown. Reclaim only queue
        // generations above the Hybrid retention threshold, so small extents
        // stay warm while large allocations cannot linger behind Hybrid work.
        this._releaseWavefrontExtent(`auto-${previousLightingMode}-to-hybrid`);
      }
    }
    if (this._activeLightingMode !== "progressive") this._historySamples = 0;

    const hostViewport = this._hostViewport;
    hostViewport.x = Math.max(0, finite(viewport?.x, 0));
    hostViewport.y = Math.max(0, finite(viewport?.y, 0));
    hostViewport.width = positiveExtent(viewport?.width ?? this._baseWidth, this.capabilities.limits.maxTextureDimension2D);
    hostViewport.height = positiveExtent(viewport?.height ?? this._baseHeight, this.capabilities.limits.maxTextureDimension2D);
    hostViewport.minDepth = Math.max(0, Math.min(1, finite(viewport?.minDepth, 0)));
    hostViewport.maxDepth = Math.max(0, Math.min(1, finite(viewport?.maxDepth, 1)));
    const actualFrameIndex = Number.isInteger(frameIndex) ? frameIndex >>> 0 : this._frameIndex >>> 0;
    this._wavefrontFrame = wavefrontFrameTelemetry(actualFrameIndex);
    this._writeFrameUniforms({
      camera,
      viewProjection,
      inverseViewProjection,
      position,
      lights: this._resolvedLights,
      time,
      deltaTime,
      frameIndex: actualFrameIndex,
      viewport: hostViewport,
      target: normalizedTarget,
    });
    this._writePhaseUniforms(actualFrameIndex);

    const encodedWork = [];
    let encodedOrder = 0;
    const screenTileBvhActive = this._screenTileBvhActive();
    for (let phase = 0; phase < PHASE_COUNT; phase += 1) {
      encoder.pushDebugGroup?.(`MorphField.${phase + 1}.${LOGICAL_PHASES[phase]}`);
      this._encodePhaseMarker(encoder, phase);
      encodedWork.push(encodedWorkEvent(
        encodedOrder++,
        phase + 1,
        PHASE_PASS_DESCRIPTORS[phase].label,
        "compute",
        false,
      ));
      if (phase === 3 && screenTileBvhActive) {
        this._encodeScreenTileBvhBin(encoder);
        encodedWork.push(encodedWorkEvent(
          encodedOrder++,
          phase + 1,
          "MorphField.4.ScreenTileBvh.CullAndBin",
          "compute",
          true,
        ));
      }
      if (phase === 5) {
        this._encodeTrace(encoder);
        encodedWork.push(encodedWorkEvent(
          encodedOrder++,
          phase + 1,
          "MorphField.6.TraceDirectFields",
          "render",
          true,
        ));
      }
      if (phase === 7) {
        const shadeWork = this._encodeShadeAndComposite(encoder, normalizedTarget, hostViewport, {
          inverseViewProjection,
          position,
          frameIndex: actualFrameIndex,
        });
        for (const label of shadeWork.wavefrontPassLabels) {
          encodedWork.push(encodedWorkEvent(
            encodedOrder++,
            phase + 1,
            label,
            "compute",
            true,
          ));
        }
        if (shadeWork.resolveEncoded) {
          encodedWork.push(encodedWorkEvent(
            encodedOrder++,
            phase + 1,
            "MorphField.8.WavefrontResolve",
            "compute",
            true,
          ));
        }
        encodedWork.push(encodedWorkEvent(
          encodedOrder++,
          phase + 1,
          "MorphField.8.Composite",
          "render",
          true,
        ));
      }
      encoder.popDebugGroup?.();
    }

    this._encodedWork = Object.freeze(encodedWork);
    this._frameIndex = actualFrameIndex + 1;
    this._encodeCpuMs = nowMilliseconds() - started;
    return this.getOutputs();
  }

  getOutputs() {
    this._assertAlive();
    return this._outputsSnapshot;
  }

  getStats() {
    this._assertAlive();
    const wavefrontLifetime = this._wavefrontTracer?.getStats() || null;
    const wavefrontInitialization = Object.freeze({
      state: this._wavefrontInitializationState,
      reason: this._wavefrontInitializationReason,
      generation: this._wavefrontInitializationGeneration,
      attempts: this._wavefrontInitializationAttempts,
      startedAtMs: this._wavefrontInitializationStartedAtMs,
      readyAtMs: this._wavefrontInitializationReadyAtMs,
      error: this._wavefrontInitializationError
        ? Object.freeze({
          name: this._wavefrontInitializationError.name || "Error",
          message: this._wavefrontInitializationError.message || String(this._wavefrontInitializationError),
        })
        : null,
    });
    const wavefront = Object.freeze({
      ...(wavefrontLifetime || {}),
      state: wavefrontInitialization.state,
      initialization: wavefrontInitialization,
      currentFrame: this._wavefrontFrame,
    });
    const screenTileBvhActive = this._screenTileBvhActive();
    const screenTileBvh = Object.freeze({
      enabled: this._screenTileBvhEnabled,
      active: screenTileBvhActive,
      requested: this._traceTraversalRequested === "screen-tile-bvh",
      policy: SCREEN_TILE_BVH_EXPERIMENTAL_POLICY,
      minimumFieldlets: SCREEN_TILE_BVH_MIN_FIELDLETS,
      tileSize: SCREEN_TILE_BVH_TILE_SIZE,
      candidateCapacity: SCREEN_TILE_BVH_CANDIDATE_CAPACITY,
      recordPairStride: SCREEN_TILE_BVH_RECORD_PAIR_STRIDE,
      secondaryTraversal: "certified-linear",
      arenaBytes: this._screenTileBvhArenaBytes,
      allocationBytes: this._screenTileBvhArenaAllocationBytes,
      metadataAllocationBytes: this._pixelMetadataBytes,
      tiles: Object.freeze({
        x: this._screenTileBvhActiveGrid.x,
        y: this._screenTileBvhActiveGrid.y,
        count: this._screenTileBvhActiveGrid.count,
        capacityX: this._screenTileBvhCapacityGrid.x,
        capacityY: this._screenTileBvhCapacityGrid.y,
        capacityCount: this._screenTileBvhCapacityGrid.count,
      }),
      preparation: Object.freeze({
        state: this._screenTileBvhPreparationState,
        reason: this._screenTileBvhPreparationReason,
        generation: this._screenTileBvhPreparationGeneration,
        publishedGeneration: this._screenTileBvhPublishedGeneration,
        attempts: this._screenTileBvhPreparationAttempts,
        error: this._screenTileBvhPreparationError
          ? Object.freeze({
            name: this._screenTileBvhPreparationError.name || "Error",
            message: this._screenTileBvhPreparationError.message || String(this._screenTileBvhPreparationError),
          })
          : null,
      }),
    });
    const traceTraversal = Object.freeze({
      active: screenTileBvhActive
        ? "screen-tile-bvh"
        : this._traceTraversalRequested === "bvh" && this._traceBvhPipeline ? "bvh" : "linear",
      requested: this._traceTraversalRequested,
      experimentalBvhEnabled: this._traceBvhEnabled,
      bvhPolicy: TRACE_BVH_EXPERIMENTAL_POLICY,
      minimumBvhFieldlets: MIN_BVH_PIPELINE_FIELDLETS,
      preparation: Object.freeze({
        state: this._traceBvhPreparationState,
        reason: this._traceBvhPreparationReason,
        generation: this._traceBvhPreparationGeneration,
        attempts: this._traceBvhPreparationAttempts,
        error: this._traceBvhPreparationError
          ? Object.freeze({
            name: this._traceBvhPreparationError.name || "Error",
            message: this._traceBvhPreparationError.message || String(this._traceBvhPreparationError),
          })
          : null,
      }),
      screenTileBvh,
    });
    return Object.freeze({
      frameIndex: this._frameIndex,
      encodeCpuMs: this._encodeCpuMs,
      dimensions: Object.freeze({
        baseWidth: this._baseWidth,
        baseHeight: this._baseHeight,
        width: this._width,
        height: this._height,
        capacityWidth: this._capacityWidth,
        capacityHeight: this._capacityHeight,
      }),
      scene: Object.freeze(this.sceneUploader.getStats()),
      quality: Object.freeze({ decision: this._quality, governor: Object.freeze(this.qualityGovernor.getStats()) }),
      lighting: Object.freeze({
        requested: this.lightingMode,
        active: this._activeLightingMode,
        fallbackReason: this._lightingFallbackReason,
        stableFrames: this._stableFrames,
        historySamples: this._historySamples,
        outputTransfer: this.outputTransfer,
        wavefront,
        autoPolicy: Object.freeze({
          minimumSamples: AUTO_PROGRESSIVE_MIN_SAMPLES,
          admissionP95Ratio: AUTO_PROGRESSIVE_ADMISSION_RATIO,
          admissionP97Ratio: AUTO_PROGRESSIVE_ADMISSION_P97_RATIO,
          abortRatio: AUTO_PROGRESSIVE_ABORT_RATIO,
          criticalRatio: AUTO_PROGRESSIVE_CRITICAL_RATIO,
          consecutiveOverBudget: this._progressiveConsecutiveOverBudget,
          failures: this._progressiveFailureCount,
          cooldownMsRemaining: Math.max(0, this._progressiveBlockedUntilMs - nowMilliseconds()),
          lastAdmissionMs: this._progressiveLastAdmissionMs,
          lastAbortMs: this._progressiveLastAbortMs,
          lastReason: this._progressiveLastReason,
          hybridTiming: this._hybridTimings.snapshot(this.qualityGovernor.targetFrameMs),
          progressiveTiming: this._progressiveTimings.snapshot(this.qualityGovernor.targetFrameMs),
          timingSource: this._quality.timingSource || "none",
          gpuTimingAvailable: this._quality.gpuTimingAvailable === true,
          gpuSamples: this._quality.gpuSamples || 0,
          gpuSamplePending: this._quality.gpuSamplePending || 0,
          queueDepth: this._quality.queueDepth || 0,
          queueCapacity: this._quality.queueCapacity || 1,
          queueNearCapacity: this._quality.queueNearCapacity === true,
          queuePressure: this._quality.queuePressure === true,
        }),
      }),
      frameTiming: this._frameTimings.snapshot(this.qualityGovernor.targetFrameMs),
      frameUniformRing: Object.freeze({
        slots: FRAME_UNIFORM_SLOTS,
        slot: this._frameUniformOffset / FRAME_UNIFORM_BYTES,
        writes: this._frameUniformWriteSerial,
      }),
      debugView: this._debugView,
      resources: Object.freeze(this.tracker.getStats()),
      queries: Object.freeze(this._queryEncoder?.getStats() || {}),
      traceTraversal,
      logicalPasses: LOGICAL_PHASES,
      phaseExecution: this._screenTileBvhActive() ? SCREEN_TILE_BVH_PHASE_EXECUTION : PHASE_EXECUTION,
      encodedWork: this._encodedWork,
      capabilities: this.capabilities,
      pipelinePreparation: this._pipelinePreparation,
      errors: this._errors,
      ownership: Object.freeze({ device: "borrowed", encoder: "external", targetViews: "borrowed", queueSubmission: "host" }),
    });
  }

  getQueryInterface() {
    this._assertAlive();
    return this._queryApi;
  }

  async replaceDevice(newDevice) {
    this._assertAlive();
    if (this._deviceReplacementPromise) {
      throw new Error("MorphField: device replacement is already in progress");
    }
    const device = validateBorrowedDevice(newDevice);
    // Validate immutable limits before releasing a still-usable generation.
    // A rejected candidate must not destructively change this renderer.
    const capabilities = inspectDeviceCapabilities(device);
    const operation = this._replaceDeviceResources(device, capabilities);
    this._deviceReplacementPromise = operation;
    try {
      return await operation;
    } finally {
      if (this._deviceReplacementPromise === operation) this._deviceReplacementPromise = null;
    }
  }

  async _replaceDeviceResources(device, capabilities) {
    const sourceScene = this._sourceScene;
    const baseWidth = this._baseWidth;
    const baseHeight = this._baseHeight;
    this._queryEncoder?.destroy();
    this._invalidateTraceBvhPreparation("device-replaced");
    this._invalidateScreenTileBvhPreparation(
      "device-replaced",
      this._screenTileBvhEnabled ? "idle" : "disabled",
    );
    this._invalidateWavefrontInitialization("device-replaced");
    this.sceneUploader.release();
    this.tracker.destroyAll();
    this.device = device;
    this.capabilities = capabilities;
    this._pipelinePreparation = (typeof device.createComputePipelineAsync === "function"
      || typeof device.createRenderPipelineAsync === "function") ? "async" : "sync";
    this.tracker = new ResourceOwnershipTracker("MorphField");
    this.sceneUploader = new SceneBufferUploader(device, this.tracker, this.capabilities);
    this._textures = null;
    this._views = null;
    this._outputsSnapshot = null;
    this._tracePassDescriptor = null;
    this._pixelMetadata = null;
    this._pixelMetadataBytes = 0;
    this._screenTileBvhCapacityGrid = tileGrid(0, 0);
    this._screenTileBvhActiveGrid = tileGrid(0, 0);
    this._screenTileBvhArenaBytes = 0;
    this._screenTileBvhArenaAllocationBytes = 0;
    this._width = 0;
    this._height = 0;
    this._capacityWidth = 0;
    this._capacityHeight = 0;
    this._skipQualitySamples = 0;
    this._externalQualityTier = null;
    this._wavefrontExtent = { width: 0, height: 0 };
    this._wavefrontFrame = wavefrontFrameTelemetry();
    this._frameTimings.clear();
    this._hybridTimings.clear();
    this._progressiveTimings.clear();
    this._progressiveConsecutiveOverBudget = 0;
    this._progressiveAbortRequested = null;
    this._progressiveFailureCount = 0;
    this._progressiveBlockedUntilMs = -Infinity;
    this._encodedWork = EMPTY_ENCODED_WORK;
    this._initialized = false;
    await this._initialize(false);
    if (sourceScene) this.setScene(sourceScene);
    this.resize(baseWidth, baseHeight);
    this._resetHistory("device-replaced");
    this.logger.info("MorphField.device.replaced", { fieldletCount: this.sceneUploader.canonical?.fieldletCount || 0 });
  }

  destroy() {
    if (this._destroyed) return;
    this._queryEncoder?.destroy();
    this._invalidateTraceBvhPreparation("renderer-destroyed", "destroyed");
    this._invalidateScreenTileBvhPreparation("renderer-destroyed", "destroyed");
    this._invalidateWavefrontInitialization("renderer-destroyed", "destroyed");
    this.sceneUploader.release();
    this.tracker.destroyAll();
    this._textures = null;
    this._views = null;
    this._outputsSnapshot = null;
    this._tracePassDescriptor = null;
    this._pixelMetadata = null;
    this._pixelMetadataBytes = 0;
    this._screenTileBvhCapacityGrid = tileGrid(0, 0);
    this._screenTileBvhActiveGrid = tileGrid(0, 0);
    this._screenTileBvhArenaBytes = 0;
    this._screenTileBvhArenaAllocationBytes = 0;
    this._encodedWork = EMPTY_ENCODED_WORK;
    this._sourceScene = null;
    this._destroyed = true;
    this.logger.info("MorphField.renderer.destroyed", {});
  }

  async _initialize(createEmptyScene = true) {
    this._assertAlive();
    try {
      await withErrorScope(this.device, async () => {
        const { modules, pipelinePromises } = this._createPipelinesAndPersistentResources();
        const diagnostics = shaderDiagnostics(modules);
        const pipelines = Promise.all(pipelinePromises);
        try {
          await Promise.all([diagnostics, pipelines]);
        } catch (error) {
          // Drain every sibling before cleanup so no late resolution can publish
          // into a retired tracker after one pipeline or diagnostic fails.
          await Promise.allSettled(pipelinePromises);
          throw error;
        }
      });
      await withErrorScope(this.device, () => {
        this._queryEncoder = new MorphFieldQueryEncoder({
          device: this.device,
          tracker: this.tracker,
          capabilities: this.capabilities,
          sceneBuffers: () => this.sceneUploader.buffers,
          sceneStats: () => this.sceneUploader.getStats(),
          logger: this.logger,
          asyncPipeline: true,
        });
        return this._queryEncoder.validateCompilation();
      });
      this._queryApi = Object.freeze({
        encode: (request) => {
          this._assertAlive();
          return this._queryEncoder.encode(request);
        },
        getLayout: () => MorphFieldQueryEncoder.layout,
        getBuffers: () => {
          this._assertAlive();
          return Object.freeze({ ...(this.sceneUploader.buffers || {}) });
        },
        getStats: () => {
          this._assertAlive();
          return this._queryEncoder.getStats();
        },
      });
      this._initialized = true;
      if (createEmptyScene) this.sceneUploader.uploadEmpty();
      this.resize(1, 1);
      if (this.lightingMode === "progressive") {
        const tracer = await this._startWavefrontInitialization("create-progressive", {
          deferred: false,
        });
        if (!tracer) {
          throw this._wavefrontInitializationError
            || new Error("MorphField progressive renderer could not initialize wavefront lighting");
        }
      } else if (this.lightingMode === "auto") {
        // Auto preparation is deliberately task-deferred. Async functions run
        // synchronously until their first await, so a mere Promise wrapper would
        // still create every wavefront module and pipeline before create() yields.
        this._startWavefrontInitialization("create-auto", { deferred: true });
      }
    } catch (error) {
      if (error !== this._wavefrontInitializationError) this._errors += 1;
      this.logger.error("MorphField.initialize.failed", { message: error.message });
      this._wavefrontInitializationGeneration += 1;
      this._wavefrontInitializationPromise = null;
      this._wavefrontTracer?.destroy();
      this._wavefrontTracer = null;
      this._initialized = false;
      this.tracker.destroyAll();
      throw error;
    }
  }

  _selectTraceTraversal(canonical, reason) {
    if (this._screenTileBvhEnabled) {
      this._selectScreenTileBvhTraversal(canonical, reason);
      return;
    }
    if (!this._traceBvhEnabled) {
      if (this._traceBvhPreparationState === "initializing") {
        this._invalidateTraceBvhPreparation(`${reason}-experimental-bvh-disabled`, "disabled");
      }
      this._traceTraversalRequested = "linear";
      this._traceBvhPreparationState = "disabled";
      this._traceBvhPreparationReason = "explicit-opt-in-required";
      return;
    }
    const needsBvh = sceneNeedsPointBvh(canonical);
    this._traceTraversalRequested = needsBvh ? "bvh" : "linear";
    if (!needsBvh) {
      if (this._traceBvhPreparationState === "initializing") {
        this._invalidateTraceBvhPreparation(`${reason}-linear-scene`);
      }
      return;
    }
    if (this._traceBvhPipeline && this._traceBvhPreparationState === "ready") return;
    if (this._traceBvhPreparationState === "failed") return;
    this._startTraceBvhPreparation(reason);
  }

  _startTraceBvhPreparation(reason) {
    if (this._traceBvhPipeline && this._traceBvhPreparationState === "ready") {
      return Promise.resolve(this._traceBvhPipeline);
    }
    if (this._traceBvhPreparationPromise && this._traceBvhPreparationState === "initializing") {
      return this._traceBvhPreparationPromise;
    }
    const generation = ++this._traceBvhPreparationGeneration;
    const device = this.device;
    const layout = this._tracePipelineLayout;
    this._traceBvhPreparationState = "initializing";
    this._traceBvhPreparationReason = String(reason || "scene-requested");
    this._traceBvhPreparationError = null;
    this._traceBvhPreparationAttempts += 1;
    this.logger.info("MorphField.trace.bvh.initialize.started", {
      generation,
      reason: this._traceBvhPreparationReason,
    });
    const preparation = deferUntilNextTask().then(async () => {
      if (this._destroyed || generation !== this._traceBvhPreparationGeneration || device !== this.device) return null;
      let module = null;
      let pipeline = null;
      let published = false;
      try {
        module = this.tracker.own(device.createShaderModule({
          label: "MorphField.Trace.Bvh.Shader",
          code: TRACE_SHADER_WGSL,
        }), { kind: "shader", label: "trace-bvh-shader" });
        await shaderDiagnostics([["trace-bvh", module]]);
        if (this._destroyed || generation !== this._traceBvhPreparationGeneration || device !== this.device) return null;
        const descriptor = {
          label: "MorphField.Trace.Bvh.Pipeline",
          layout,
          vertex: { module, entryPoint: "vertexMain" },
          fragment: {
            module,
            entryPoint: "fragmentMain",
            targets: Array.from({ length: 4 }, () => ({ format: INTERNAL_COLOR_FORMAT })),
          },
          primitive: { topology: "triangle-list", cullMode: "none" },
          depthStencil: { format: INTERNAL_DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: "always" },
        };
        pipeline = typeof device.createRenderPipelineAsync === "function"
          ? await device.createRenderPipelineAsync(descriptor)
          : device.createRenderPipeline(descriptor);
        if (this._destroyed || generation !== this._traceBvhPreparationGeneration || device !== this.device) return null;
        this._traceBvhPipeline = this.tracker.own(pipeline, { kind: "pipeline", label: "trace-bvh-pipeline" });
        pipeline = null;
        published = true;
        this._traceBvhPreparationState = "ready";
        this._traceBvhPreparationError = null;
        this._resetHistory("trace-bvh-ready");
        this.logger.info("MorphField.trace.bvh.initialize.ready", { generation });
        return this._traceBvhPipeline;
      } finally {
        if (!published) {
          if (module && this.tracker.owns(module)) this.tracker.release(module);
          pipeline?.destroy?.();
        }
      }
    }).catch((error) => {
      if (!this._destroyed && generation === this._traceBvhPreparationGeneration && device === this.device) {
        this._traceBvhPreparationState = "failed";
        this._traceBvhPreparationError = error;
        this._errors += 1;
        this.logger.error("MorphField.trace.bvh.initialize.failed", {
          generation,
          message: error?.message || String(error),
        });
      }
      return null;
    }).finally(() => {
      if (generation === this._traceBvhPreparationGeneration) this._traceBvhPreparationPromise = null;
    });
    this._traceBvhPreparationPromise = preparation;
    return preparation;
  }

  _invalidateTraceBvhPreparation(reason, terminalState = "idle") {
    const previousState = this._traceBvhPreparationState;
    const generation = ++this._traceBvhPreparationGeneration;
    this._traceBvhPreparationPromise = null;
    this._traceBvhPipeline = null;
    this._traceBvhPreparationState = terminalState;
    this._traceBvhPreparationReason = String(reason || "invalidated");
    this._traceBvhPreparationError = null;
    this._traceTraversalRequested = "linear";
    this.logger.debug("MorphField.trace.bvh.initialize.invalidated", {
      generation,
      previousState,
      reason: this._traceBvhPreparationReason,
    });
  }

  _selectScreenTileBvhTraversal(canonical, reason) {
    const needsTileBvh = sceneNeedsScreenTileBvh(canonical);
    this._traceTraversalRequested = needsTileBvh ? "screen-tile-bvh" : "linear";
    if (!needsTileBvh) {
      if (this._screenTileBvhPreparationState === "initializing") {
        this._invalidateScreenTileBvhPreparation(`${reason}-linear-scene`);
      } else if (this._screenTileBvhPreparationState === "ready") {
        this._screenTileBvhPreparationReason = `${reason}-linear-scene`;
      }
      return;
    }
    if (this._screenTileBvhTracePipeline
        && this._screenTileBvhBinPipeline
        && this._screenTileBvhPreparationState === "ready"
        && this._screenTileBvhPublishedGeneration === this._screenTileBvhPreparationGeneration) {
      this._rebuildScreenTileBvhBindGroup();
      return;
    }
    if (this._screenTileBvhPreparationState === "failed") return;
    this._startScreenTileBvhPreparation(reason);
  }

  _startScreenTileBvhPreparation(reason) {
    if (!this._screenTileBvhEnabled) return Promise.resolve(null);
    if (this._screenTileBvhActive()) {
      return Promise.resolve(Object.freeze({
        bin: this._screenTileBvhBinPipeline,
        trace: this._screenTileBvhTracePipeline,
      }));
    }
    if (this._screenTileBvhPreparationPromise
        && this._screenTileBvhPreparationState === "initializing") {
      return this._screenTileBvhPreparationPromise;
    }

    const generation = ++this._screenTileBvhPreparationGeneration;
    const device = this.device;
    const tracker = this.tracker;
    const traceLayout = this._tracePipelineLayout;
    this._screenTileBvhPreparationState = "initializing";
    this._screenTileBvhPreparationReason = String(reason || "scene-requested");
    this._screenTileBvhPreparationError = null;
    this._screenTileBvhPreparationAttempts += 1;
    this.logger.info("MorphField.trace.screenTileBvh.initialize.started", {
      generation,
      reason: this._screenTileBvhPreparationReason,
    });

    const preparation = deferUntilNextTask().then(async () => {
      if (this._destroyed
          || generation !== this._screenTileBvhPreparationGeneration
          || device !== this.device
          || tracker !== this.tracker) return null;

      let traceModule = null;
      let tracePipeline = null;
      let tracePipelineTracked = false;
      let published = false;
      const ownTemporary = (resource, ownership) => tracker.own(resource, ownership);
      const releaseTracked = (resource) => {
        // A device replacement may already have drained the captured tracker.
        // In that case the resource was destroyed exactly once by destroyAll.
        if (resource && tracker.owns(resource)) tracker.release(resource);
      };
      const releaseUntracked = (resource) => {
        if (!resource) return;
        try { resource.destroy?.(); } catch (_) { /* best-effort unpublished-pipeline cleanup */ }
      };
      try {
        if (!this._screenTileBvhBinPipeline || !this._screenTileBvhBinBindGroupLayout) {
          throw new Error("MorphField screen-tile bin kernel is unavailable on the active device");
        }
        traceModule = ownTemporary(device.createShaderModule({
          label: "MorphField.Trace.ScreenTileBvh.Shader",
          code: TRACE_TILE_BVH_SHADER_WGSL,
        }), { kind: "shader", label: "screen-tile-bvh-trace-shader" });
        await shaderDiagnostics([["screen-tile-bvh-trace", traceModule]]);
        if (this._destroyed
            || generation !== this._screenTileBvhPreparationGeneration
            || device !== this.device
            || tracker !== this.tracker) return null;

        const traceDescriptor = {
          label: "MorphField.Trace.ScreenTileBvh.Pipeline",
          layout: traceLayout,
          vertex: { module: traceModule, entryPoint: "vertexMain" },
          fragment: {
            module: traceModule,
            entryPoint: "fragmentMain",
            targets: Array.from({ length: 4 }, () => ({ format: INTERNAL_COLOR_FORMAT })),
          },
          primitive: { topology: "triangle-list", cullMode: "none" },
          depthStencil: { format: INTERNAL_DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: "always" },
        };
        tracePipeline = typeof device.createRenderPipelineAsync === "function"
          ? await device.createRenderPipelineAsync(traceDescriptor)
          : device.createRenderPipeline(traceDescriptor);
        if (this._destroyed
            || generation !== this._screenTileBvhPreparationGeneration
            || device !== this.device
            || tracker !== this.tracker) return null;

        // Publish the complete pair atomically. No frame can observe the tile
        // trace pipeline before its matching bin pipeline and layout are ready.
        tracePipeline = ownTemporary(tracePipeline, {
          kind: "pipeline",
          label: "screen-tile-bvh-trace-pipeline",
        });
        tracePipelineTracked = true;
        this._screenTileBvhTracePipeline = tracePipeline;
        this._screenTileBvhPublishedGeneration = generation;
        this._screenTileBvhPreparationState = "ready";
        this._screenTileBvhPreparationError = null;
        this._rebuildScreenTileBvhBindGroup();
        this._resetHistory("screen-tile-bvh-ready");
        this.logger.info("MorphField.trace.screenTileBvh.initialize.ready", { generation });
        published = true;
        return Object.freeze({
          bin: this._screenTileBvhBinPipeline,
          trace: this._screenTileBvhTracePipeline,
        });
      } finally {
        if (!published) {
          if (tracePipelineTracked) releaseTracked(tracePipeline);
          else releaseUntracked(tracePipeline);
          releaseTracked(traceModule);
        }
      }
    }).catch((error) => {
      if (!this._destroyed
          && generation === this._screenTileBvhPreparationGeneration
          && device === this.device
          && tracker === this.tracker) {
        this._screenTileBvhPreparationState = "failed";
        this._screenTileBvhPreparationError = error;
        this._screenTileBvhPublishedGeneration = -1;
        this._errors += 1;
        this.logger.error("MorphField.trace.screenTileBvh.initialize.failed", {
          generation,
          message: error?.message || String(error),
        });
      }
      return null;
    }).finally(() => {
      if (generation === this._screenTileBvhPreparationGeneration) {
        this._screenTileBvhPreparationPromise = null;
      }
    });
    this._screenTileBvhPreparationPromise = preparation;
    return preparation;
  }

  _invalidateScreenTileBvhPreparation(reason, terminalState = "idle") {
    const previousState = this._screenTileBvhPreparationState;
    const generation = ++this._screenTileBvhPreparationGeneration;
    this._screenTileBvhPreparationPromise = null;
    this._screenTileBvhTracePipeline = null;
    this._screenTileBvhBinBindGroup = null;
    this._screenTileBvhPublishedGeneration = -1;
    this._screenTileBvhPreparationState = terminalState;
    this._screenTileBvhPreparationReason = String(reason || "invalidated");
    this._screenTileBvhPreparationError = null;
    if (this._traceTraversalRequested === "screen-tile-bvh") this._traceTraversalRequested = "linear";
    this.logger.debug("MorphField.trace.screenTileBvh.initialize.invalidated", {
      generation,
      previousState,
      reason: this._screenTileBvhPreparationReason,
    });
  }

  _screenTileBvhActive() {
    return this._traceTraversalRequested === "screen-tile-bvh"
      && this._screenTileBvhPreparationState === "ready"
      && this._screenTileBvhPublishedGeneration === this._screenTileBvhPreparationGeneration
      && Boolean(this._screenTileBvhBinPipeline)
      && Boolean(this._screenTileBvhTracePipeline)
      && Boolean(this._screenTileBvhBinBindGroup);
  }

  _startWavefrontInitialization(reason, { deferred = true } = {}) {
    this._assertAlive();
    if (this._wavefrontTracer && this._wavefrontInitializationState === "ready") {
      return Promise.resolve(this._wavefrontTracer);
    }
    if (this._wavefrontInitializationPromise && this._wavefrontInitializationState === "initializing") {
      return this._wavefrontInitializationPromise;
    }

    const generation = ++this._wavefrontInitializationGeneration;
    const device = this.device;
    const startedAtMs = nowMilliseconds();
    this._wavefrontInitializationState = "initializing";
    this._wavefrontInitializationReason = String(reason || "requested");
    this._wavefrontInitializationError = null;
    this._wavefrontInitializationAttempts += 1;
    this._wavefrontInitializationStartedAtMs = startedAtMs;
    this._wavefrontInitializationReadyAtMs = null;
    this.logger.info("MorphField.wavefront.initialize.started", {
      reason: this._wavefrontInitializationReason,
      generation,
      deferred,
    });

    const start = deferred ? deferUntilNextTask() : Promise.resolve();
    const initialization = start.then(async () => {
      if (this._destroyed || generation !== this._wavefrontInitializationGeneration || device !== this.device) {
        return null;
      }
      const tracer = await MorphFieldWavefrontPathTracer.create({
        ...this._wavefrontOptions,
        device,
        logger: this.logger,
        label: "MorphField.Wavefront",
      });
      if (this._destroyed || generation !== this._wavefrontInitializationGeneration || device !== this.device) {
        tracer.destroy();
        this.logger.debug("MorphField.wavefront.initialize.stale", { reason, generation });
        return null;
      }
      this._wavefrontTracer = tracer;
      this._wavefrontInitializationState = "ready";
      this._wavefrontInitializationError = null;
      this._wavefrontInitializationReadyAtMs = nowMilliseconds();
      this._syncWavefrontScene();
      this._rebuildWavefrontResolveBindGroup();
      this.logger.info("MorphField.wavefront.initialize.ready", {
        reason,
        generation,
        durationMs: this._wavefrontInitializationReadyAtMs - startedAtMs,
        sceneRevision: this.sceneUploader.canonical?.revision ?? null,
      });
      return tracer;
    }).catch((error) => {
      if (!this._destroyed && generation === this._wavefrontInitializationGeneration && device === this.device) {
        this._wavefrontTracer?.destroy();
        this._wavefrontTracer = null;
        this._wavefrontExtent.width = 0;
        this._wavefrontExtent.height = 0;
        this._wavefrontResolveBindGroup = null;
        this._wavefrontInitializationState = "error";
        this._wavefrontInitializationError = error;
        this._wavefrontInitializationReadyAtMs = null;
        this._errors += 1;
        this.logger.error("MorphField.wavefront.initialize.failed", {
          reason,
          generation,
          message: error.message,
        });
      } else {
        this.logger.debug("MorphField.wavefront.initialize.stale-error", {
          reason,
          generation,
          message: error.message,
        });
      }
      return null;
    }).finally(() => {
      if (generation === this._wavefrontInitializationGeneration) {
        this._wavefrontInitializationPromise = null;
      }
    });
    this._wavefrontInitializationPromise = initialization;
    return initialization;
  }

  _invalidateWavefrontInitialization(reason, terminalState = "idle") {
    const previousState = this._wavefrontInitializationState;
    const generation = ++this._wavefrontInitializationGeneration;
    this._wavefrontInitializationPromise = null;
    this._wavefrontTracer?.destroy();
    this._wavefrontTracer = null;
    this._wavefrontExtent.width = 0;
    this._wavefrontExtent.height = 0;
    this._wavefrontResolveBindGroup = null;
    this._wavefrontInitializationState = terminalState;
    this._wavefrontInitializationReason = String(reason || "invalidated");
    this._wavefrontInitializationError = null;
    this._wavefrontInitializationStartedAtMs = null;
    this._wavefrontInitializationReadyAtMs = null;
    this.logger.debug("MorphField.wavefront.initialize.invalidated", {
      reason: this._wavefrontInitializationReason,
      previousState,
      generation,
    });
  }

  _createPipelinesAndPersistentResources() {
    const modules = [];
    const pipelinePromises = [];
    const createPipeline = (property, type, descriptor, ownership) => {
      const asyncName = type === "compute" ? "createComputePipelineAsync" : "createRenderPipelineAsync";
      const syncName = type === "compute" ? "createComputePipeline" : "createRenderPipeline";
      let created;
      if (typeof this.device[asyncName] === "function") {
        created = this.device[asyncName](descriptor);
      } else {
        created = this.device[syncName](descriptor);
      }
      pipelinePromises.push(Promise.resolve(created).then((pipeline) => {
        this[property] = this.tracker.own(pipeline, ownership);
      }));
    };
    this._frameUniformBuffer = this.tracker.own(this.device.createBuffer({
      label: "MorphField.FrameUniforms",
      size: FRAME_UNIFORM_BYTES * FRAME_UNIFORM_SLOTS,
      usage: bufferUsage("UNIFORM", "COPY_DST"),
    }), { kind: "uniform-buffer", label: "frame", bytes: FRAME_UNIFORM_BYTES * FRAME_UNIFORM_SLOTS });
    if (this._screenTileBvhEnabled) {
      this._screenTileBinUniformBuffer = this.tracker.own(this.device.createBuffer({
        label: "MorphField.Trace.ScreenTileBvh.BinUniforms",
        size: SCREEN_TILE_BIN_UNIFORM_STRIDE * FRAME_UNIFORM_SLOTS,
        usage: bufferUsage("UNIFORM", "COPY_DST"),
      }), {
        kind: "uniform-buffer",
        label: "screen-tile-bvh-bin-uniforms",
        bytes: SCREEN_TILE_BIN_UNIFORM_STRIDE * FRAME_UNIFORM_SLOTS,
      });
    }
    this._phaseUniformBuffer = this.tracker.own(this.device.createBuffer({
      label: "MorphField.PhaseUniforms",
      size: PHASE_COUNT * PHASE_UNIFORM_STRIDE,
      usage: bufferUsage("UNIFORM", "COPY_DST"),
    }), { kind: "uniform-buffer", label: "phase", bytes: PHASE_COUNT * PHASE_UNIFORM_STRIDE });
    this._runtimeStateBuffer = this.tracker.own(this.device.createBuffer({
      label: "MorphField.RuntimeState",
      size: 64,
      usage: bufferUsage("STORAGE", "COPY_SRC", "COPY_DST"),
    }), { kind: "runtime-state", label: "logical-pass-state", bytes: 64 });
    this._compositeSampler = this.tracker.own(this.device.createSampler({
      label: "MorphField.Composite.LinearSampler",
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    }), { kind: "sampler", label: "composite-linear" });

    // Compile the explicit screen-tile bin kernel before the larger renderer
    // variants. D3D12/Dawn pipeline objects cannot be explicitly destroyed;
    // preparing this tiny kernel first avoids backend pipeline-heap exhaustion
    // and lets every scene generation reuse the same device-local kernel.
    if (this._screenTileBvhEnabled) {
      const tileVisibility = shaderStages("COMPUTE");
      this._screenTileBvhBinBindGroupLayout = this.tracker.own(this.device.createBindGroupLayout({
        label: "MorphField.Trace.ScreenTileBvh.Bin.BindGroupLayout",
        entries: [
          { binding: 0, visibility: tileVisibility, buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: SCREEN_TILE_BIN_UNIFORM_BYTES } },
          { binding: 1, visibility: tileVisibility, buffer: { type: "storage" } },
          { binding: 2, visibility: tileVisibility, buffer: { type: "read-only-storage" } },
        ],
      }), { kind: "pipeline-layout", label: "screen-tile-bvh-bin-bind-group-layout" });
      this._screenTileBvhBinPipelineLayout = this.tracker.own(this.device.createPipelineLayout({
        label: "MorphField.Trace.ScreenTileBvh.Bin.PipelineLayout",
        bindGroupLayouts: [this._screenTileBvhBinBindGroupLayout],
      }), { kind: "pipeline-layout", label: "screen-tile-bvh-bin-pipeline-layout" });
      const tileBinModule = this.tracker.own(this.device.createShaderModule({
        label: "MorphField.Trace.ScreenTileBvh.Bin.Shader",
        code: TILE_BVH_BIN_SHADER_WGSL,
      }), { kind: "shader", label: "screen-tile-bvh-bin-shader" });
      modules.push(["screen-tile-bvh-bin", tileBinModule]);
      this._screenTileBvhBinPipeline = this.tracker.own(this.device.createComputePipeline({
        label: "MorphField.Trace.ScreenTileBvh.Bin.Pipeline",
        layout: this._screenTileBvhBinPipelineLayout,
        compute: { module: tileBinModule, entryPoint: "main" },
      }), { kind: "pipeline", label: "screen-tile-bvh-bin-pipeline" });
    }

    const phaseVisibility = shaderStages("COMPUTE");
    this._phaseBindGroupLayout = this.tracker.own(this.device.createBindGroupLayout({
      label: "MorphField.Phase.BindGroupLayout",
      entries: [
        { binding: 0, visibility: phaseVisibility, buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: 16 } },
        { binding: 1, visibility: phaseVisibility, buffer: { type: "storage" } },
      ],
    }), { kind: "pipeline-layout", label: "phase-bind-group-layout" });
    const phaseLayout = this.tracker.own(this.device.createPipelineLayout({ label: "MorphField.Phase.PipelineLayout", bindGroupLayouts: [this._phaseBindGroupLayout] }), { kind: "pipeline-layout", label: "phase-pipeline-layout" });
    const phaseModule = this.tracker.own(this.device.createShaderModule({ label: "MorphField.Phase.Shader", code: PHASE_SHADER_WGSL }), { kind: "shader", label: "phase-shader" });
    modules.push(["phase", phaseModule]);
    createPipeline("_phasePipeline", "compute", {
      label: "MorphField.Phase.Pipeline",
      layout: phaseLayout,
      compute: { module: phaseModule, entryPoint: "main" },
    }, { kind: "pipeline", label: "phase-pipeline" });
    this._phaseBindGroup = this.device.createBindGroup({
      label: "MorphField.Phase.BindGroup",
      layout: this._phaseBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this._phaseUniformBuffer, offset: 0, size: 16 } },
        { binding: 1, resource: { buffer: this._runtimeStateBuffer } },
      ],
    });

    const fragmentVisibility = shaderStages("FRAGMENT");
    this._traceBindGroupLayout = this.tracker.own(this.device.createBindGroupLayout({
      label: "MorphField.Trace.BindGroupLayout",
      entries: [
        { binding: 0, visibility: fragmentVisibility, buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: FRAME_UNIFORM_BYTES } },
        ...Array.from({ length: 6 }, (_, index) => ({ binding: index + 1, visibility: fragmentVisibility, buffer: { type: "read-only-storage" } })),
        { binding: 7, visibility: fragmentVisibility, buffer: { type: "storage" } },
        { binding: 8, visibility: fragmentVisibility, buffer: { type: "read-only-storage" } },
      ],
    }), { kind: "pipeline-layout", label: "trace-bind-group-layout" });
    const traceLayout = this.tracker.own(this.device.createPipelineLayout({ label: "MorphField.Trace.PipelineLayout", bindGroupLayouts: [this._traceBindGroupLayout] }), { kind: "pipeline-layout", label: "trace-pipeline-layout" });
    this._tracePipelineLayout = traceLayout;
    const traceModule = this.tracker.own(this.device.createShaderModule({
      label: "MorphField.Trace.Linear.Shader",
      code: TRACE_LINEAR_SHADER_WGSL,
    }), {
      kind: "shader",
      label: "trace-linear-shader",
    });
    modules.push(["trace", traceModule]);
    createPipeline("_tracePipeline", "render", {
      label: "MorphField.Trace.Linear.Pipeline",
      layout: traceLayout,
      vertex: { module: traceModule, entryPoint: "vertexMain" },
      fragment: {
        module: traceModule,
        entryPoint: "fragmentMain",
        targets: Array.from({ length: 4 }, () => ({ format: INTERNAL_COLOR_FORMAT })),
      },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: { format: INTERNAL_DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: "always" },
    }, {
      kind: "pipeline",
      label: "trace-linear-pipeline",
    });

    const computeVisibility = shaderStages("COMPUTE");
    this._wavefrontResolveBindGroupLayout = this.tracker.own(this.device.createBindGroupLayout({
      label: "MorphField.WavefrontResolve.BindGroupLayout",
      entries: [
        { binding: 0, visibility: computeVisibility, buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: FRAME_UNIFORM_BYTES } },
        { binding: 1, visibility: computeVisibility, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: computeVisibility, storageTexture: { access: "write-only", format: INTERNAL_COLOR_FORMAT } },
      ],
    }), { kind: "pipeline-layout", label: "wavefront-resolve-bind-group-layout" });
    const wavefrontResolveLayout = this.tracker.own(this.device.createPipelineLayout({
      label: "MorphField.WavefrontResolve.PipelineLayout",
      bindGroupLayouts: [this._wavefrontResolveBindGroupLayout],
    }), { kind: "pipeline-layout", label: "wavefront-resolve-pipeline-layout" });
    const wavefrontResolveModule = this.tracker.own(this.device.createShaderModule({
      label: "MorphField.WavefrontResolve.Shader",
      code: WAVEFRONT_RESOLVE_SHADER_WGSL,
    }), { kind: "shader", label: "wavefront-resolve-shader" });
    modules.push(["wavefront-resolve", wavefrontResolveModule]);
    createPipeline("_wavefrontResolvePipeline", "compute", {
      label: "MorphField.WavefrontResolve.Pipeline",
      layout: wavefrontResolveLayout,
      compute: { module: wavefrontResolveModule, entryPoint: "main" },
    }, { kind: "pipeline", label: "wavefront-resolve-pipeline" });

    const compositeVisibility = shaderStages("FRAGMENT");
    this._compositeBindGroupLayout = this.tracker.own(this.device.createBindGroupLayout({
      label: "MorphField.Composite.BindGroupLayout",
      entries: [
        { binding: 0, visibility: compositeVisibility, buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: FRAME_UNIFORM_BYTES } },
        { binding: 1, visibility: compositeVisibility, texture: { sampleType: "float" } },
        { binding: 2, visibility: compositeVisibility, texture: { sampleType: "depth" } },
        { binding: 3, visibility: compositeVisibility, sampler: { type: "filtering" } },
        { binding: 4, visibility: compositeVisibility, texture: { sampleType: "float" } },
        { binding: 5, visibility: compositeVisibility, texture: { sampleType: "float" } },
        { binding: 6, visibility: compositeVisibility, buffer: { type: "read-only-storage" } },
      ],
    }), { kind: "pipeline-layout", label: "composite-bind-group-layout" });
    const compositeLayout = this.tracker.own(this.device.createPipelineLayout({ label: "MorphField.Composite.PipelineLayout", bindGroupLayouts: [this._compositeBindGroupLayout] }), { kind: "pipeline-layout", label: "composite-pipeline-layout" });
    const compositeModule = this.tracker.own(this.device.createShaderModule({ label: "MorphField.Composite.Shader", code: COMPOSITE_SHADER_WGSL }), { kind: "shader", label: "composite-shader" });
    modules.push(["composite", compositeModule]);
    const compositeBase = {
      layout: compositeLayout,
      vertex: { module: compositeModule, entryPoint: "vertexMain" },
      primitive: { topology: "triangle-list", cullMode: "none" },
    };
    const overBlend = {
      color: { operation: "add", srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
      alpha: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
    };
    createPipeline("_compositePipeline", "render", {
      ...compositeBase,
      label: "MorphField.Composite.ColorPipeline",
      fragment: { module: compositeModule, entryPoint: "fragmentNoDepth", targets: [{ format: this.colorFormat }] },
    }, { kind: "pipeline", label: "composite-color-pipeline" });
    createPipeline("_compositeOverPipeline", "render", {
      ...compositeBase,
      label: "MorphField.Composite.OverColorPipeline",
      fragment: { module: compositeModule, entryPoint: "fragmentNoDepth", targets: [{ format: this.colorFormat, blend: overBlend }] },
    }, { kind: "pipeline", label: "composite-over-color-pipeline" });
    this._compositeDepthPipeline = null;
    this._compositeOverDepthPipeline = null;
    if (this.depthFormat) {
      createPipeline("_compositeDepthPipeline", "render", {
        ...compositeBase,
        label: "MorphField.Composite.DepthPipeline",
        fragment: { module: compositeModule, entryPoint: "fragmentWithDepth", targets: [{ format: this.colorFormat }] },
        depthStencil: { format: this.depthFormat, depthWriteEnabled: true, depthCompare: "always" },
      }, { kind: "pipeline", label: "composite-depth-pipeline" });
      createPipeline("_compositeOverDepthPipeline", "render", {
        ...compositeBase,
        label: "MorphField.Composite.OverDepthPipeline",
        fragment: { module: compositeModule, entryPoint: "fragmentWithDepth", targets: [{ format: this.colorFormat, blend: overBlend }] },
        depthStencil: { format: this.depthFormat, depthWriteEnabled: true, depthCompare: "less" },
      }, { kind: "pipeline", label: "composite-over-depth-pipeline" });
    }
    return { modules, pipelinePromises };
  }

  _ensureFrameResources(scale, forceReallocate = false) {
    const width = positiveExtent(Math.ceil(this._baseWidth * scale), this.capabilities.limits.maxTextureDimension2D);
    const height = positiveExtent(Math.ceil(this._baseHeight * scale), this.capabilities.limits.maxTextureDimension2D);
    const activeExtentChanged = width !== this._width || height !== this._height;
    const capacityTooSmall = this._capacityWidth < this._baseWidth || this._capacityHeight < this._baseHeight;
    const requiresAllocation = !this._textures || forceReallocate || capacityTooSmall;
    if (!requiresAllocation) {
      this._width = width;
      this._height = height;
      this._screenTileBvhActiveGrid = tileGrid(width, height);
      this._screenTileBvhArenaBytes = this._screenTileBvhEnabled
        ? (1 + this._screenTileBvhActiveGrid.count * SCREEN_TILE_BVH_RECORD_PAIR_STRIDE) * 8
        : 0;
      if (activeExtentChanged) {
        this._resetHistory("quality-extent-changed");
        this.logger.debug("MorphField.resize", {
          width,
          height,
          capacityWidth: this._capacityWidth,
          capacityHeight: this._capacityHeight,
          scale,
          reused: true,
        });
      }
      return activeExtentChanged;
    }
    const capacityWidth = this._baseWidth;
    const capacityHeight = this._baseHeight;
    const pixelCount = capacityWidth * capacityHeight;
    const capacityTileGrid = tileGrid(capacityWidth, capacityHeight);
    const activeTileGrid = tileGrid(width, height);
    const tileArenaPairs = this._screenTileBvhEnabled
      ? 1 + capacityTileGrid.count * SCREEN_TILE_BVH_RECORD_PAIR_STRIDE
      : 0;
    const metadataPairCount = pixelCount + tileArenaPairs;
    const metadataBytes = Math.max(16, metadataPairCount * 8);
    const metadataLimit = Math.min(
      this.capabilities.limits.maxStorageBufferBindingSize,
      this.capabilities.limits.maxBufferSize,
    );
    const tileDispatchCount = Math.ceil(capacityTileGrid.count / SCREEN_TILE_BVH_BIN_WORKGROUP_SIZE);
    if (!Number.isSafeInteger(pixelCount)
        || !Number.isSafeInteger(capacityTileGrid.count)
        || !Number.isSafeInteger(tileArenaPairs)
        || !Number.isSafeInteger(metadataPairCount)
        || !Number.isSafeInteger(metadataBytes)
        || metadataBytes > metadataLimit) {
      throw new RangeError(
        `MorphField resize ${capacityWidth}x${capacityHeight} requires ${metadataBytes} pixel-metadata bytes; device limit is ${metadataLimit}`,
      );
    }
    if (this._screenTileBvhEnabled
        && (!Number.isSafeInteger(tileDispatchCount)
          || tileDispatchCount > this.capabilities.limits.maxComputeWorkgroupsPerDimension)) {
      throw new RangeError(
        `MorphField resize ${capacityWidth}x${capacityHeight} requires ${tileDispatchCount} screen-tile workgroups; device limit is ${this.capabilities.limits.maxComputeWorkgroupsPerDimension}`,
      );
    }
    const colorUsage = textureUsage("RENDER_ATTACHMENT", "TEXTURE_BINDING", "COPY_SRC");
    const historyUsage = textureUsage("TEXTURE_BINDING", "STORAGE_BINDING", "COPY_SRC");
    const pendingResources = [];
    const createTexture = (label, format, usage, bytesPerPixel) => {
      const resource = this.device.createTexture({
        label: `MorphField.${label}`,
        size: { width: capacityWidth, height: capacityHeight, depthOrArrayLayers: 1 },
        format,
        usage,
      });
      pendingResources.push({
        resource,
        ownership: { kind: "frame-texture", label, bytes: capacityWidth * capacityHeight * bytesPerPixel },
      });
      return resource;
    };
    let gbuffer;
    let depth;
    let history;
    let views;
    let pixelMetadata;
    try {
      gbuffer = Array.from({ length: 4 }, (_, index) => createTexture(`GBuffer${index}`, INTERNAL_COLOR_FORMAT, colorUsage, 8));
      depth = createTexture("Depth", INTERNAL_DEPTH_FORMAT, textureUsage("RENDER_ATTACHMENT", "TEXTURE_BINDING", "COPY_SRC"), 4);
      history = [
        createTexture("History0", INTERNAL_COLOR_FORMAT, historyUsage, 8),
        createTexture("History1", INTERNAL_COLOR_FORMAT, historyUsage, 8),
      ];
      pixelMetadata = this.device.createBuffer({
        label: "MorphField.PixelMetadata",
        size: metadataBytes,
        usage: bufferUsage("STORAGE", "COPY_SRC", "COPY_DST"),
      });
      pendingResources.push({
        resource: pixelMetadata,
        ownership: { kind: "pixel-metadata", label: "source-id-version", bytes: metadataBytes },
      });
      views = {
        gbuffer: gbuffer.map((texture) => texture.createView()),
        depth: depth.createView(),
        history: history.map((texture) => texture.createView()),
      };
    } catch (error) {
      for (const { resource } of pendingResources) {
        try { resource.destroy?.(); } catch (_) { /* best-effort rollback */ }
      }
      throw error;
    }
    this.tracker.releaseWhere((entry) => entry.kind === "frame-texture" || entry.kind === "pixel-metadata");
    for (const { resource, ownership } of pendingResources) this.tracker.own(resource, ownership);
    this._capacityWidth = capacityWidth;
    this._capacityHeight = capacityHeight;
    this._width = width;
    this._height = height;
    this._pixelMetadata = pixelMetadata;
    this._pixelMetadataBytes = metadataBytes;
    this._screenTileBvhCapacityGrid = capacityTileGrid;
    this._screenTileBvhActiveGrid = activeTileGrid;
    this._screenTileBvhArenaAllocationBytes = this._screenTileBvhEnabled ? tileArenaPairs * 8 : 0;
    this._screenTileBvhArenaBytes = this._screenTileBvhEnabled
      ? (1 + activeTileGrid.count * SCREEN_TILE_BVH_RECORD_PAIR_STRIDE) * 8
      : 0;
    this._textures = { gbuffer, depth, history };
    this._views = views;
    this._tracePassDescriptor = {
      label: "MorphField.6.TraceDirectFields",
      colorAttachments: this._views.gbuffer.map((view) => ({
        view,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: "clear",
        storeOp: "store",
      })),
      depthStencilAttachment: {
        view: this._views.depth,
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    };
    this._rebuildOutputsSnapshot();
    this._rebuildFrameBindGroups();
    this._rebuildSceneBindGroups();
    this._resetHistory("resized");
    this._skipQualitySamples = Math.max(this._skipQualitySamples, 2);
    this.logger.debug("MorphField.resize", {
      width,
      height,
      capacityWidth: this._capacityWidth,
      capacityHeight: this._capacityHeight,
      scale,
      reused: false,
    });
    return true;
  }

  _rebuildOutputsSnapshot() {
    if (!this._textures || !this._views || !this._pixelMetadata) {
      this._outputsSnapshot = null;
      return;
    }
    const renderer = this;
    this._outputsSnapshot = Object.freeze({
      get width() { return renderer._width; },
      get height() { return renderer._height; },
      hdr: Object.freeze({ texture: this._textures.gbuffer[0], view: this._views.gbuffer[0], format: INTERNAL_COLOR_FORMAT, channels: "rgb=HDR,a=transmittance" }),
      normal: Object.freeze({ texture: this._textures.gbuffer[1], view: this._views.gbuffer[1], format: INTERNAL_COLOR_FORMAT, channels: "rgb=world-normal" }),
      linearDepth: Object.freeze({ texture: this._textures.gbuffer[1], view: this._views.gbuffer[1], format: INTERNAL_COLOR_FORMAT, channel: "a" }),
      albedoMaterial: Object.freeze({ texture: this._textures.gbuffer[2], view: this._views.gbuffer[2], format: INTERNAL_COLOR_FORMAT, channels: "rgb=albedo,a=roughness" }),
      roughMetalMotion: Object.freeze({ texture: this._textures.gbuffer[3], view: this._views.gbuffer[3], format: INTERNAL_COLOR_FORMAT, channels: "rg=motion,b=metallic,a=material-index" }),
      depth: Object.freeze({ texture: this._textures.depth, view: this._views.depth, format: INTERNAL_DEPTH_FORMAT }),
      sourceId: Object.freeze({ buffer: this._pixelMetadata, stride: 8, offset: 0, format: "u32" }),
      version: Object.freeze({ buffer: this._pixelMetadata, stride: 8, offset: 4, format: "u32" }),
      progressive: Object.freeze({
        get texture() { return renderer._textures.history[renderer._historyIndex]; },
        get view() { return renderer._views.history[renderer._historyIndex]; },
        format: INTERNAL_COLOR_FORMAT,
        get samples() { return renderer._historySamples; },
      }),
      get activeLightingMode() { return renderer._activeLightingMode; },
    });
  }

  _rebuildSceneBindGroups() {
    const buffers = this.sceneUploader.buffers;
    if (!buffers || !this._pixelMetadata || !this._traceBindGroupLayout) return;
    this._traceBindGroup = this.device.createBindGroup({
      label: "MorphField.Trace.BindGroup",
      layout: this._traceBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this._frameUniformBuffer, offset: 0, size: FRAME_UNIFORM_BYTES } },
        { binding: 1, resource: { buffer: buffers.fieldletHeaders } },
        { binding: 2, resource: { buffer: buffers.payloads } },
        { binding: 3, resource: { buffer: buffers.resolvedCertificates } },
        { binding: 4, resource: { buffer: buffers.materials } },
        { binding: 5, resource: { buffer: buffers.programWords } },
        { binding: 6, resource: { buffer: buffers.analyticParameters } },
        { binding: 7, resource: { buffer: this._pixelMetadata } },
        { binding: 8, resource: { buffer: buffers.spatialRecords } },
      ],
    });
    this._rebuildScreenTileBvhBindGroup();
  }

  _rebuildFrameBindGroups() {
    if (!this._views || !this._compositeBindGroupLayout) return;
    const sources = [this._views.gbuffer[0], this._views.history[0], this._views.history[1]];
    this._compositeBindGroups = sources.map((source, index) => this.device.createBindGroup({
      label: `MorphField.Composite.BindGroup${index}`,
      layout: this._compositeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this._frameUniformBuffer, offset: 0, size: FRAME_UNIFORM_BYTES } },
        { binding: 1, resource: source },
        { binding: 2, resource: this._views.depth },
        { binding: 3, resource: this._compositeSampler },
        { binding: 4, resource: this._views.gbuffer[0] },
        { binding: 5, resource: this._views.gbuffer[1] },
        { binding: 6, resource: { buffer: this._pixelMetadata } },
      ],
    }));
    this._rebuildScreenTileBvhBindGroup();
    this._rebuildWavefrontResolveBindGroup();
  }

  _rebuildScreenTileBvhBindGroup() {
    const buffers = this.sceneUploader.buffers;
    if (!this._screenTileBvhBinBindGroupLayout
        || !buffers
        || !this._pixelMetadata
        || !this._screenTileBinUniformBuffer) {
      this._screenTileBvhBinBindGroup = null;
      return;
    }
    this._screenTileBvhBinBindGroup = this.device.createBindGroup({
      label: "MorphField.Trace.ScreenTileBvh.Bin.BindGroup",
      layout: this._screenTileBvhBinBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this._screenTileBinUniformBuffer, offset: 0, size: SCREEN_TILE_BIN_UNIFORM_BYTES } },
        { binding: 1, resource: { buffer: this._pixelMetadata } },
        { binding: 2, resource: { buffer: buffers.spatialRecords } },
      ],
    });
  }

  _rebuildWavefrontResolveBindGroup() {
    const output = this._wavefrontTracer?.getOutput();
    if (!output || !this._views || !this._wavefrontResolveBindGroupLayout) {
      this._wavefrontResolveBindGroup = null;
      return;
    }
    this._wavefrontResolveBindGroup = this.device.createBindGroup({
      label: "MorphField.WavefrontResolve.BindGroup",
      layout: this._wavefrontResolveBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this._frameUniformBuffer, offset: 0, size: FRAME_UNIFORM_BYTES } },
        { binding: 1, resource: { buffer: output.buffer } },
        { binding: 2, resource: this._views.history[0] },
      ],
    });
  }

  _resolveLights(lights) {
    const source = lights || {};
    const light = firstDirectionalLight(source);
    const output = this._resolvedLights;
    const directional = output.directional[0];
    resolveDirectionToLight(light, directional.directionToLight);
    const globalBrightness = Math.max(0, finite(source.globalBrightness, 1));
    const enabled = source.enableSun === false || source.lightingMode === "unlit" ? 0 : 1;
    const particleShadow = Math.max(0, Math.min(0.95, finite(source.particleSunShadow, 0)));
    const particleTint = vector3(source.particleSunTint, [1, 1, 1], this._particleTintScratch);
    const lightColor = vector3(light.color || source.sunColor, [1, 0.96, 0.88], this._lightColorScratch);
    const lightIntensity = Math.max(0, finite(light.intensity ?? source.sunIntensity, 3))
      * globalBrightness * enabled * (1 - particleShadow);
    vector3(source.environmentZenith || source.skyColor || source.ambientColor, [0.32, 0.48, 0.78], output.environmentZenith);
    vector3(source.environmentHorizon || source.horizonColor, [0.12, 0.16, 0.22], output.environmentHorizon);
    const ambientIntensity = source.lightingMode === "unlit"
      ? 1
      : Math.max(0, finite(source.environmentIntensity ?? source.ambientIntensity, 1));
    for (let index = 0; index < 3; index += 1) {
      directional.color[index] = lightColor[index] * particleTint[index];
    }
    directional.intensity = lightIntensity;
    output.environmentIntensity = ambientIntensity;
    return output;
  }

  _writeFrameUniforms({ viewProjection, inverseViewProjection, position, lights, time, deltaTime, frameIndex, viewport, target }) {
    const data = this._frameUniformFloats;
    const integers = this._frameUniformIntegers;
    data.set(inverseViewProjection, 0);
    data.set(viewProjection, 16);
    data[32] = position[0]; data[33] = position[1]; data[34] = position[2]; data[35] = viewport.width;
    data[36] = this._width; data[37] = this._height; data[38] = finite(time); data[39] = finite(deltaTime);
    const light = firstDirectionalLight(lights);
    const direction = light.directionToLight;
    const color = light.color;
    const intensity = Math.max(0, finite(light.intensity, 3));
    const sky = vector3(lights?.environmentZenith, [0.32, 0.48, 0.78]);
    const environmentIntensity = Math.max(0, finite(lights?.environmentIntensity, 1));
    data[40] = direction[0]; data[41] = direction[1]; data[42] = direction[2]; data[43] = viewport.height;
    data[44] = color[0] * intensity; data[45] = color[1] * intensity; data[46] = color[2] * intensity; data[47] = viewport.y;
    data[48] = sky[0] * environmentIntensity; data[49] = sky[1] * environmentIntensity;
    data[50] = sky[2] * environmentIntensity; data[51] = viewport.x;
    integers[52] = frameIndex;
    integers[53] = this.sceneUploader.canonical?.fieldletCount || 0;
    integers[54] = this._quality.maxTraceSteps;
    integers[55] = this._quality.pathBounces;
    integers[56] = this._activeLightingMode === "progressive" ? 1 : 0;
    integers[57] = this.sceneUploader.canonical?.revision || 0;
    integers[58] = this._historySamples;
    const shadowLevel = Math.max(0, Math.min(3, Math.floor(finite(this._quality.shadowLevel, 1))));
    integers[59] = this._debugMode
      | (target.composition === COMPOSITION_MODE.OVER ? 0x100 : 0)
      | (shadowLevel << 9);
    data[60] = this.maxDistance;
    data[61] = this.hitEpsilon;
    data[62] = this.exposure;
    data[63] = manualSrgbTransfer(this.colorFormat, this.outputTransfer) ? 1 : 0;
    // frameIndex belongs to the host's simulation/presentation timeline and is
    // allowed to repeat (stereo views, probes, or multiple targets in one
    // command encoder). Ring ownership must therefore follow encode calls, not
    // that semantic index, or two queued encodes can bind the same bytes before
    // the host submits either command buffer.
    const frameUniformSlot = this._frameUniformWriteSerial % FRAME_UNIFORM_SLOTS;
    this._frameUniformOffset = frameUniformSlot * FRAME_UNIFORM_BYTES;
    this._frameUniformWriteSerial += 1;
    this.device.queue.writeBuffer(this._frameUniformBuffer, this._frameUniformOffset, this._frameUniformBytes);
    if (this._screenTileBinUniformBuffer) {
      const tile = this._screenTileBinUniformIntegers;
      tile.fill(0);
      this._screenTileBinUniformFloats.set(viewProjection, 0);
      tile[16] = this._width;
      tile[17] = this._height;
      tile[18] = this.sceneUploader.canonical?.fieldletCount || 0;
      tile[19] = this.sceneUploader.canonical?.revision || 0;
      tile[20] = frameIndex;
      this._screenTileBinUniformFloats[24] = position[0];
      this._screenTileBinUniformFloats[25] = position[1];
      this._screenTileBinUniformFloats[26] = position[2];
      this._screenTileBinUniformOffset = frameUniformSlot * SCREEN_TILE_BIN_UNIFORM_STRIDE;
      this.device.queue.writeBuffer(
        this._screenTileBinUniformBuffer,
        this._screenTileBinUniformOffset,
        this._screenTileBinUniformBytes,
      );
    }
  }

  _writePhaseUniforms(frameIndex) {
    const data = this._phaseUniformIntegers;
    const revision = this.sceneUploader.canonical?.revision || 0;
    const count = this.sceneUploader.canonical?.fieldletCount || 0;
    for (let phase = 0; phase < PHASE_COUNT; phase += 1) {
      const offset = (phase * PHASE_UNIFORM_STRIDE) / 4;
      data[offset] = phase;
      data[offset + 1] = frameIndex;
      data[offset + 2] = revision;
      data[offset + 3] = count;
    }
    this.device.queue.writeBuffer(this._phaseUniformBuffer, 0, this._phaseUniformBytes);
  }

  _encodePhaseMarker(encoder, phase) {
    const pass = encoder.beginComputePass(PHASE_PASS_DESCRIPTORS[phase]);
    pass.setPipeline(this._phasePipeline);
    pass.setBindGroup(0, this._phaseBindGroup, [phase * PHASE_UNIFORM_STRIDE]);
    pass.dispatchWorkgroups(1);
    pass.end();
  }

  _encodeScreenTileBvhBin(encoder) {
    if (!this._screenTileBvhActive()) return false;
    const dispatchCount = this._screenTileBvhActiveGrid.count;
    if (dispatchCount < 1) return false;
    if (dispatchCount > this.capabilities.limits.maxComputeWorkgroupsPerDimension) {
      throw new RangeError(
        `MorphField screen-tile BVH dispatch ${dispatchCount} exceeds device limit ${this.capabilities.limits.maxComputeWorkgroupsPerDimension}`,
      );
    }
    const pass = encoder.beginComputePass({ label: "MorphField.4.ScreenTileBvh.CullAndBin" });
    pass.setPipeline(this._screenTileBvhBinPipeline);
    pass.setBindGroup(0, this._screenTileBvhBinBindGroup, [this._screenTileBinUniformOffset]);
    pass.dispatchWorkgroups(dispatchCount, 1, 1);
    pass.end();
    return true;
  }

  _encodeTrace(encoder) {
    const pass = encoder.beginRenderPass(this._tracePassDescriptor);
    let pipeline = this._tracePipeline;
    if (this._screenTileBvhActive()) {
      pipeline = this._screenTileBvhTracePipeline;
    } else if (this._traceTraversalRequested === "bvh" && this._traceBvhPipeline) {
      pipeline = this._traceBvhPipeline;
    }
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this._traceBindGroup, [this._frameUniformOffset]);
    pass.setViewport?.(0, 0, this._width, this._height, 0, 1);
    pass.setScissorRect?.(0, 0, this._width, this._height);
    pass.draw(3, 1, 0, 0);
    pass.end();
  }

  _encodeShadeAndComposite(encoder, target, viewport, frame) {
    let compositeIndex = 0;
    let wavefrontPassLabels = EMPTY_ENCODED_WORK;
    let resolveEncoded = false;
    if (this._activeLightingMode === "progressive") {
      const wavefrontEncoding = this._wavefrontTracer.encode({
        encoder,
        camera: {
          inverseViewProjection: frame.inverseViewProjection,
          position: frame.position,
        },
        lights: this._resolvedLights,
        frameIndex: frame.frameIndex,
        sampleIndex: this._historySamples,
        sceneRevision: this._lastSceneRevision,
        maxBounces: this._quality.pathBounces,
        maxTraceSteps: this._quality.maxTraceSteps,
        maxDistance: this.maxDistance,
        hitEpsilon: this.hitEpsilon,
        rayEpsilon: Math.max(this.hitEpsilon * 2, 0.001),
      });
      this._wavefrontFrame = wavefrontFrameTelemetry(frame.frameIndex, wavefrontEncoding);
      wavefrontPassLabels = wavefrontEncoding.passLabels;
      const resolve = encoder.beginComputePass({ label: "MorphField.8.WavefrontResolve" });
      resolve.setPipeline(this._wavefrontResolvePipeline);
      resolve.setBindGroup(0, this._wavefrontResolveBindGroup, [this._frameUniformOffset]);
      resolve.dispatchWorkgroups(Math.ceil(this._width / 8), Math.ceil(this._height / 8));
      resolve.end();
      resolveEncoded = true;
      this._historyIndex = 0;
      this._historySamples = this._wavefrontTracer.getOutput()?.sampleCount || 0;
      compositeIndex = 1;
    }
    const descriptor = {
      label: "MorphField.8.Composite",
      colorAttachments: [{
        view: target.colorView,
        clearValue: target.clearColor || DEFAULT_CLEAR_COLOR,
        loadOp: target.colorLoadOp,
        storeOp: target.colorStoreOp,
      }],
    };
    if (target.depthView) {
      descriptor.depthStencilAttachment = {
        view: target.depthView,
        depthClearValue: finite(target.depthClearValue, 1),
        depthLoadOp: target.depthLoadOp,
        depthStoreOp: target.depthStoreOp,
      };
    }
    const pass = encoder.beginRenderPass(descriptor);
    const over = target.composition === COMPOSITION_MODE.OVER;
    const pipeline = target.depthView
      ? (over ? this._compositeOverDepthPipeline : this._compositeDepthPipeline)
      : (over ? this._compositeOverPipeline : this._compositePipeline);
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this._compositeBindGroups[compositeIndex], [this._frameUniformOffset]);
    pass.setViewport?.(viewport.x, viewport.y, viewport.width, viewport.height, viewport.minDepth, viewport.maxDepth);
    pass.draw(3, 1, 0, 0);
    pass.end();
    return Object.freeze({ wavefrontPassLabels, resolveEncoded, compositeEncoded: true });
  }

  _recordFrameTiming(sampleMs) {
    this._frameTimings.push(sampleMs);
    if (this._activeLightingMode !== "progressive") {
      this._hybridTimings.push(sampleMs);
      return;
    }
    this._progressiveTimings.push(sampleMs);
    this._progressiveSustainedFrames += 1;
    const target = this.qualityGovernor.targetFrameMs;
    if (sampleMs > target * AUTO_PROGRESSIVE_CRITICAL_RATIO) {
      this._progressiveAbortRequested = "critical-frame-spike";
      this._progressiveConsecutiveOverBudget = 0;
    } else if (sampleMs > target * AUTO_PROGRESSIVE_ABORT_RATIO) {
      this._progressiveConsecutiveOverBudget += 1;
      if (this._progressiveConsecutiveOverBudget >= 2) {
        this._progressiveAbortRequested = "consecutive-frame-overrun";
      }
    } else {
      this._progressiveConsecutiveOverBudget = 0;
    }
    if (this._progressiveSustainedFrames >= TIMING_WINDOW_FRAMES && !this._progressiveAbortRequested) {
      this._progressiveFailureCount = 0;
    }
  }

  _beginProgressiveCooldown(reason, nowMs) {
    this._progressiveFailureCount = Math.min(8, this._progressiveFailureCount + 1);
    const cooldownMs = Math.min(
      AUTO_PROGRESSIVE_MAX_COOLDOWN_MS,
      AUTO_PROGRESSIVE_BASE_COOLDOWN_MS * (2 ** (this._progressiveFailureCount - 1)),
    );
    this._progressiveBlockedUntilMs = nowMs + cooldownMs;
    this._progressiveLastAbortMs = nowMs;
    this._progressiveLastReason = reason;
    this._progressiveAbortRequested = null;
    this._progressiveConsecutiveOverBudget = 0;
    this._lightingFallbackReason = `auto-progressive-${reason}`;
    this.logger.warn("MorphField.wavefront.auto.abort", {
      reason,
      cooldownMs,
      failures: this._progressiveFailureCount,
    });
  }

  _selectLightingMode(nowMs) {
    this._lightingFallbackReason = null;
    const automatic = this.lightingMode === "auto";
    if (!automatic && this.lightingMode !== "progressive") return "hybrid";
    if (automatic && this._activeLightingMode === "progressive" && this._progressiveAbortRequested) {
      this._beginProgressiveCooldown(this._progressiveAbortRequested, nowMs);
      return "hybrid";
    }
    if (this._debugMode !== DEBUG_VIEW.composite && this._debugMode !== DEBUG_VIEW.history) {
      this._lightingFallbackReason = "debug-view-requires-direct-output";
      return "hybrid";
    }
    if (!this._wavefrontTracer) {
      this._lightingFallbackReason = this._wavefrontInitializationState === "initializing"
        ? "wavefront-initializing"
        : this._wavefrontInitializationState === "error"
          ? "wavefront-initialization-error"
          : "wavefront-unavailable";
      return "hybrid";
    }
    if (!sceneSupportsWavefront(this.sceneUploader.canonical)) {
      this._lightingFallbackReason = "wavefront-analytic-family-only";
      return "hybrid";
    }
    if (automatic) {
      const tierName = this._quality.name || this._quality.tier;
      const capableTier = tierName === "ultra" || tierName === "high";
      if (!capableTier) {
        this._lightingFallbackReason = "auto-progressive-quality-tier";
        return "hybrid";
      }
      const queuePressure = this._quality.queuePressure === true;
      if (this._activeLightingMode === "progressive" && queuePressure) {
        this._beginProgressiveCooldown("queue-pressure", nowMs);
        return "hybrid";
      }
      if (this._stableFrames < Math.max(AUTO_PROGRESSIVE_MIN_SAMPLES, this.qualityGovernor.historySize)) {
        this._lightingFallbackReason = "auto-progressive-awaiting-stability";
        return "hybrid";
      }
      if (nowMs < this._progressiveBlockedUntilMs) {
        this._lightingFallbackReason = "auto-progressive-cooldown";
        return "hybrid";
      }
      if (this._activeLightingMode !== "progressive") {
        if ((this._quality.gpuSamplePending || 0) > 0) {
          this._lightingFallbackReason = "auto-progressive-gpu-sample-pending";
          return "hybrid";
        }
        if (this._quality.autoProgressiveEligible !== true
            || !(this._quality.progressiveBudgetMs > 0)) {
          this._lightingFallbackReason = this._quality.progressiveBudget?.reason === "timing-warming"
            ? "auto-progressive-gpu-timing-warming"
            : this._quality.progressiveBudget?.reason === "queue-pressure"
              ? "auto-progressive-queue-pressure"
              : "auto-progressive-no-spare-budget";
          return "hybrid";
        }
        if (queuePressure) {
          this._lightingFallbackReason = "auto-progressive-queue-pressure";
          return "hybrid";
        }
        const gpuTimingAvailable = this._quality.gpuTimingAvailable === true;
        const minimumGpuSamples = this.qualityGovernor.minimumGpuSamples;
        if (gpuTimingAvailable && (this._quality.gpuSamples || 0) < minimumGpuSamples) {
          this._lightingFallbackReason = "auto-progressive-gpu-timing-warming";
          return "hybrid";
        }
        const sampleCount = this._hybridTimings.count;
        const target = this.qualityGovernor.targetFrameMs;
        const p95Threshold = target * AUTO_PROGRESSIVE_ADMISSION_RATIO;
        const p97Threshold = target * AUTO_PROGRESSIVE_ADMISSION_P97_RATIO;
        const allowedP95Outliers = Math.floor(sampleCount * 0.05);
        const allowedP97Outliers = Math.floor(sampleCount * 0.03);
        const adequateBudget = gpuTimingAvailable
          ? this._quality.gpuP95Ms <= p95Threshold && this._quality.gpuP97Ms <= p97Threshold
          : sampleCount >= AUTO_PROGRESSIVE_MIN_SAMPLES
            && this._hybridTimings.countAbove(p95Threshold) <= allowedP95Outliers
            && this._hybridTimings.countAbove(p97Threshold) <= allowedP97Outliers;
        if (!adequateBudget) {
          this._lightingFallbackReason = "auto-progressive-insufficient-headroom";
          return "hybrid";
        }
        this._progressiveLastAdmissionMs = nowMs;
        this._progressiveLastReason = "admitted-with-measured-headroom";
        this.logger.info("MorphField.wavefront.auto.admit", {
          hybridSamples: sampleCount,
          gpuSamples: this._quality.gpuSamples || 0,
          timingSource: gpuTimingAvailable ? "gpu-timestamp" : "frame-cadence-fallback",
          targetFrameMs: target,
          p95Threshold,
          p97Threshold,
          progressiveBudgetMs: this._quality.progressiveBudgetMs,
          progressiveUnits: this._quality.progressiveBudget?.admittedUnits || 0,
        });
      }
    }
    return "progressive";
  }

  _syncWavefrontScene() {
    if (!this._wavefrontTracer || !this.sceneUploader.buffers || !this.sceneUploader.canonical) return;
    const canonical = this.sceneUploader.canonical;
    this._wavefrontTracer.setSceneBuffers({
      buffers: this.sceneUploader.buffers,
      canonical,
      fieldletCount: canonical.fieldletCount,
      materialCount: Math.max(1, canonical.materials.length / 12),
      materialDescriptors: canonical.materialDescriptors,
      revision: canonical.revision,
    });
  }

  _ensureWavefrontExtent() {
    if (!this._wavefrontTracer) return false;
    if (this._wavefrontExtent.width === this._width
        && this._wavefrontExtent.height === this._height
        && this._wavefrontResolveBindGroup) return true;
    try {
      this._wavefrontTracer.resize(this._width, this._height);
      this._wavefrontExtent.width = this._width;
      this._wavefrontExtent.height = this._height;
      this._rebuildWavefrontResolveBindGroup();
      return Boolean(this._wavefrontResolveBindGroup);
    } catch (error) {
      this._lightingFallbackReason = `wavefront-capacity: ${error.message}`;
      this.logger.warn("MorphField.wavefront.fallback", {
        reason: this._lightingFallbackReason,
        width: this._width,
        height: this._height,
      });
      return false;
    }
  }

  _releaseWavefrontExtent(reason) {
    if (!this._wavefrontTracer) return 0;
    const frameResourceBytes = this._wavefrontTracer.getStats().frameResourceBytes;
    if (frameResourceBytes <= this._wavefrontHybridRetentionBytes) {
      this.logger.debug("MorphField.wavefront.frame-resources.retained", {
        reason,
        bytes: frameResourceBytes,
        thresholdBytes: this._wavefrontHybridRetentionBytes,
      });
      return 0;
    }
    const released = this._wavefrontTracer.releaseFrameResources(reason);
    this._wavefrontExtent.width = 0;
    this._wavefrontExtent.height = 0;
    this._wavefrontResolveBindGroup = null;
    return released;
  }

  _resetHistory(reason) {
    this._historySamples = 0;
    this._historyIndex = 0;
    this._wavefrontTracer?.reset(reason);
    this._historyResetCount += 1;
    const nowMs = nowMilliseconds();
    if (reason !== this._lastHistoryResetReason || nowMs - this._lastHistoryResetLogMs >= 1000) {
      this.logger.debug("MorphField.history.reset", { reason, count: this._historyResetCount });
      this._lastHistoryResetLogMs = nowMs;
    }
    this._lastHistoryResetReason = reason;
  }

  _assertAlive() {
    if (this._destroyed) throw new Error("MorphField: renderer has been destroyed");
  }
}

export { LOGICAL_PHASES as MORPHFIELD_LOGICAL_PHASES };
