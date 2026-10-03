// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { bufferUsage, shaderStages } from "../capabilities.js";
import { ResourceOwnershipTracker } from "../ResourceOwnershipTracker.js";
import { withErrorScope } from "../../../../core/gpu/GpuDebug.js";
import {
  WAVEFRONT_LIMITATIONS,
  WAVEFRONT_MAX_BOUNCES,
  WAVEFRONT_MAX_TRACE_STEPS,
  WAVEFRONT_OUTPUT_ENCODING,
  WAVEFRONT_RECORD_BYTES,
  WAVEFRONT_WORKGROUP_SIZE,
  packMaterialExtensions,
  queueByteSize,
} from "./constants.js";
import { WAVEFRONT_SHADER_SOURCES } from "./WavefrontShaders.js";

const MAP_READ_FALLBACK = 0x0001;
const DEFAULT_QUEUE_CAPACITY = 1_048_576;
const DEFAULT_MEMORY_BUDGET = 512 * 1024 * 1024;
const FRAME_UNIFORM_USED_BYTES = 224;
const STATS_BYTES = 64;

function noOperation() {}

function normalizeLogger(logger) {
  return Object.freeze({
    debug: typeof logger?.debug === "function" ? logger.debug.bind(logger) : noOperation,
    info: typeof logger?.info === "function" ? logger.info.bind(logger) : noOperation,
    warn: typeof logger?.warn === "function" ? logger.warn.bind(logger) : noOperation,
    error: typeof logger?.error === "function" ? logger.error.bind(logger) : noOperation,
  });
}

function requireMethod(value, name, context) {
  if (!value || typeof value[name] !== "function") {
    throw new TypeError(`${context} must provide ${name}()`);
  }
}

function validateDevice(device) {
  if (!device || typeof device !== "object") {
    throw new TypeError("MorphField wavefront path tracing requires a borrowed GPUDevice-compatible object");
  }
  for (const method of [
    "createBuffer",
    "createShaderModule",
    "createBindGroupLayout",
    "createPipelineLayout",
    "createBindGroup",
    "createComputePipeline",
  ]) requireMethod(device, method, "MorphField wavefront device facade");
  if (!device.queue || typeof device.queue.writeBuffer !== "function") {
    throw new TypeError("MorphField wavefront device facade must expose queue.writeBuffer()");
  }
  return device;
}

function validateEncoder(encoder, captureStats) {
  requireMethod(encoder, "beginComputePass", "MorphField wavefront external encoder");
  requireMethod(encoder, "clearBuffer", "MorphField wavefront external encoder");
  if (captureStats) requireMethod(encoder, "copyBufferToBuffer", "MorphField wavefront external encoder");
  return encoder;
}

function requireBuffer(value, name) {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    throw new TypeError(`MorphField wavefront scene buffer ${name} is required`);
  }
  return value;
}

function positiveInteger(value, fallback, name, maximum = Number.MAX_SAFE_INTEGER) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
    throw new RangeError(`${name} must be an integer in [1, ${maximum}]`);
  }
  return number;
}

function nonNegativeInteger(value, fallback, name, maximum = 0xFFFFFFFF) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > maximum) {
    throw new RangeError(`${name} must be an integer in [0, ${maximum}]`);
  }
  return number;
}

function finite(value, fallback, minimum = -Number.MAX_VALUE, maximum = Number.MAX_VALUE) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function vector(value, length, fallback, output = new Array(length)) {
  const source = ArrayBuffer.isView(value) || Array.isArray(value) ? value : fallback;
  for (let index = 0; index < length; index += 1) output[index] = finite(source?.[index], fallback[index]);
  return output;
}

function matrix4(value) {
  const source = value?.elements || value;
  if ((!Array.isArray(source) && !ArrayBuffer.isView(source)) || source.length !== 16) {
    throw new TypeError("MorphField wavefront camera requires a 16-value inverseViewProjection matrix");
  }
  for (let index = 0; index < 16; index += 1) {
    if (!Number.isFinite(Number(source[index]))) {
      throw new RangeError("MorphField wavefront inverseViewProjection matrix must contain finite values");
    }
  }
  return source;
}

function alignTo(value, alignment) {
  return Math.ceil(value / alignment) * alignment;
}

function bytesOf(view) {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

function mapReadFlag() {
  return globalThis.GPUMapMode?.READ ?? MAP_READ_FALLBACK;
}

function firstDirectionalLight(lights) {
  if (Array.isArray(lights)) {
    return lights.find((light) => light && (light.type === "directional" || light.direction || light.directionToLight)) || {};
  }
  if (lights?.directional) return Array.isArray(lights.directional) ? (lights.directional[0] || {}) : lights.directional;
  return lights || {};
}

function resolveDirectionToLight(light, output = new Array(3)) {
  if (light?.directionToLight) return vector(light.directionToLight, 3, [0.4, 0.8, 0.3], output);
  if (light?.direction) {
    vector(light.direction, 3, [-0.4, -0.8, -0.3], output);
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

function groupsFor(count, maximumPerDimension, output = { x: 1, y: 1 }) {
  const groupCount = Math.max(1, Math.ceil(count / WAVEFRONT_WORKGROUP_SIZE));
  const x = Math.min(groupCount, maximumPerDimension);
  const y = Math.ceil(groupCount / x);
  if (y > maximumPerDimension) {
    throw new RangeError("MorphField wavefront dispatch exceeds maxComputeWorkgroupsPerDimension");
  }
  output.x = x;
  output.y = y;
  return output;
}

function freezeStats(stats) {
  return Object.freeze({
    ...stats,
    gpuQueues: Object.freeze({
      rayA: Object.freeze({ ...stats.gpuQueues.rayA }),
      rayB: Object.freeze({ ...stats.gpuQueues.rayB }),
      hit: Object.freeze({ ...stats.gpuQueues.hit }),
      shadow: Object.freeze({ ...stats.gpuQueues.shadow }),
    }),
  });
}

/**
 * Buffer-only compute wavefront path tracer for compiled MorphField scenes.
 * It borrows every host object, records only into the supplied encoder, and
 * owns only its pipelines, queue/state buffers, uniforms, and accumulation.
 */
export class MorphFieldWavefrontPathTracer {
  static async create(options = {}) {
    const tracer = new MorphFieldWavefrontPathTracer(options);
    try {
      await tracer._initialize();
      if (options.width !== undefined || options.height !== undefined) {
        tracer.resize(options.width ?? 1, options.height ?? 1);
      }
      return tracer;
    } catch (error) {
      tracer.destroy();
      throw error;
    }
  }

  constructor({
    device,
    logger,
    label = "MorphField.Wavefront",
    queueCapacity = DEFAULT_QUEUE_CAPACITY,
    memoryBudgetBytes = DEFAULT_MEMORY_BUDGET,
    seed = 0x4D4F5232,
    diagnosticLogStride = 120,
  } = {}) {
    this.device = validateDevice(device);
    this.logger = normalizeLogger(logger);
    this.label = String(label || "MorphField.Wavefront");
    this._pipelinePreparation = typeof this.device.createComputePipelineAsync === "function" ? "async" : "sync";
    this.tracker = new ResourceOwnershipTracker(this.label);
    this.requestedQueueCapacity = positiveInteger(queueCapacity, DEFAULT_QUEUE_CAPACITY, "queueCapacity", 0xFFFFFFFF);
    this.memoryBudgetBytes = positiveInteger(memoryBudgetBytes, DEFAULT_MEMORY_BUDGET, "memoryBudgetBytes");
    this.seed = nonNegativeInteger(seed, 0x4D4F5232, "seed");
    const limits = this.device.limits || {};
    this._limits = Object.freeze({
      maxStorageBufferBindingSize: positiveInteger(
        Math.floor(Number(limits.maxStorageBufferBindingSize) || 128 * 1024 * 1024),
        128 * 1024 * 1024,
        "maxStorageBufferBindingSize",
      ),
      maxBufferSize: positiveInteger(
        Math.floor(Number(limits.maxBufferSize) || Number(limits.maxStorageBufferBindingSize) || 256 * 1024 * 1024),
        256 * 1024 * 1024,
        "maxBufferSize",
      ),
      maxComputeWorkgroupsPerDimension: positiveInteger(
        Math.floor(Number(limits.maxComputeWorkgroupsPerDimension) || 65535),
        65535,
        "maxComputeWorkgroupsPerDimension",
      ),
      minUniformBufferOffsetAlignment: positiveInteger(
        Math.floor(Number(limits.minUniformBufferOffsetAlignment) || 256),
        256,
        "minUniformBufferOffsetAlignment",
      ),
    });
    this._uniformStride = alignTo(WAVEFRONT_RECORD_BYTES.frameUniform, this._limits.minUniformBufferOffsetAlignment);
    this._bounceStride = alignTo(WAVEFRONT_RECORD_BYTES.bounceUniform, this._limits.minUniformBufferOffsetAlignment);
    this._destroyed = false;
    this._initialized = false;
    this._scene = null;
    this._resources = null;
    this._outputDescriptor = null;
    this._groups = null;
    this._width = 0;
    this._height = 0;
    this._pixelCount = 0;
    this._queueCapacity = 0;
    this._tileCount = 0;
    this._capacityPixelCount = 0;
    this._frameUniformTileCapacity = 0;
    this._frameUniformCpuData = null;
    this._frameUniformCpuBytes = null;
    this._frameUniformFloatViews = [];
    this._frameUniformIntegerViews = [];
    this._tileDispatches = [];
    this._frameOffsets = [];
    this._shadeOffsets = [];
    this._emptyOffsets = Object.freeze([]);
    this._bounceUniformCpuData = new ArrayBuffer(WAVEFRONT_MAX_BOUNCES * this._bounceStride);
    this._bounceUniformCpuBytes = new Uint8Array(this._bounceUniformCpuData);
    this._lastBounceCount = -1;
    this._cameraPositionScratch = [0, 0, 0];
    this._sunDirectionScratch = [0.4, 0.8, 0.3];
    this._sunColorScratch = [1, 0.96, 0.88];
    this._environmentZenithScratch = [0.32, 0.48, 0.78];
    this._environmentHorizonScratch = [0.12, 0.16, 0.22];
    this._historySamples = 0;
    this._encodedFrames = 0;
    this._encodedPasses = 0;
    this._lastEncode = Object.freeze({
      encoded: false,
      frameIndex: -1,
      sampleIndex: 0,
      passCount: 0,
      tileCount: 0,
      queueCapacity: 0,
    });
    this._resetPending = true;
    this._resetReason = "created";
    this._statsPending = false;
    this._statsTicket = 0;
    this._lastGpuStats = freezeStats({
      available: false,
      ticket: 0,
      gpuQueues: {
        rayA: { count: 0, overflow: 0, capacity: 0 },
        rayB: { count: 0, overflow: 0, capacity: 0 },
        hit: { count: 0, overflow: 0, capacity: 0 },
        shadow: { count: 0, overflow: 0, capacity: 0 },
      },
    });
    this._debugLogStride = positiveInteger(diagnosticLogStride, 120, "diagnosticLogStride", 1_000_000);
  }

  /**
   * Binds borrowed scene buffers. `resolvedCertificates` contains four vec4
   * records per Fieldlet in surface, medium, motion, collision order.
   * Optional material extensions may be a borrowed GPU buffer, packed CPU
   * data, or semantic descriptors. No borrowed buffer is ever destroyed.
   */
  setSceneBuffers(input) {
    this._assertReady();
    if (!input || typeof input !== "object") {
      throw new TypeError("MorphField wavefront setSceneBuffers requires a scene-buffer descriptor");
    }
    const buffers = input.buffers && typeof input.buffers === "object" ? input.buffers : input;
    const canonical = input.canonical || input.scene || {};
    const scene = {
      fieldletHeaders: requireBuffer(buffers.fieldletHeaders, "fieldletHeaders"),
      payloads: requireBuffer(buffers.payloads, "payloads"),
      resolvedCertificates: requireBuffer(
        buffers.resolvedCertificates || buffers.packedQueryCertificates,
        "resolvedCertificates",
      ),
      materials: requireBuffer(buffers.materials, "materials"),
      programWords: requireBuffer(buffers.programWords, "programWords"),
      analyticParameters: requireBuffer(buffers.analyticParameters, "analyticParameters"),
      bounds: requireBuffer(buffers.bounds, "bounds"),
      fieldletCount: nonNegativeInteger(
        input.fieldletCount ?? canonical.fieldletCount,
        0,
        "fieldletCount",
      ),
      materialCount: positiveInteger(
        input.materialCount ?? canonical.materialCount ?? (canonical.materials?.length ? canonical.materials.length / 12 : 1),
        1,
        "materialCount",
      ),
      revision: nonNegativeInteger(input.revision ?? canonical.revision, 0, "scene revision"),
    };

    const previousScene = this._scene;
    const externalExtensions = buffers.materialExtensions;
    if (externalExtensions) {
      scene.materialExtensions = requireBuffer(externalExtensions, "materialExtensions");
      scene.materialExtensionCount = positiveInteger(
        input.materialExtensionCount ?? canonical.materialExtensionCount,
        scene.materialCount,
        "materialExtensionCount",
      );
      scene.materialExtensionsOwned = false;
    } else {
      let packed;
      if (input.materialExtensionData !== undefined) {
        if (!(input.materialExtensionData instanceof Float32Array)
            || input.materialExtensionData.length === 0
            || input.materialExtensionData.length % 4 !== 0) {
          throw new TypeError("materialExtensionData must be a non-empty Float32Array with four values per record");
        }
        packed = new Float32Array(input.materialExtensionData);
      } else {
        packed = packMaterialExtensions(input.materialDescriptors || canonical.materialDescriptors || []);
      }
      scene.materialExtensions = this._createUploadedBuffer(
        `${this.label}.MaterialExtensions`,
        packed,
        "wavefront-material-extension",
      );
      scene.materialExtensionCount = packed.length / 4;
      scene.materialExtensionsOwned = true;
    }
    this._scene = scene;
    try {
      this._rebuildBindGroups();
    } catch (error) {
      if (scene.materialExtensionsOwned) this.tracker.release(scene.materialExtensions);
      this._scene = previousScene;
      this._rebuildBindGroups();
      throw error;
    }
    if (previousScene?.materialExtensionsOwned) {
      this.tracker.release(previousScene.materialExtensions);
    }
    this.reset("scene-buffers-changed");
    this.logger.debug("MorphField.wavefront.scene", {
      fieldletCount: scene.fieldletCount,
      materialCount: scene.materialCount,
      revision: scene.revision,
    });
    return Object.freeze({
      fieldletCount: scene.fieldletCount,
      materialCount: scene.materialCount,
      materialExtensionCount: scene.materialExtensionCount,
      revision: scene.revision,
    });
  }

  /** Updates same-allocation scene metadata without rebuilding borrowed bind groups. */
  updateSceneMetadata({
    revision,
    fieldletCount,
    materialCount,
    materialDescriptors,
  } = {}) {
    this._assertReady();
    if (!this._scene) throw new Error("MorphField wavefront updateSceneMetadata requires setSceneBuffers() first");
    const nextFieldletCount = nonNegativeInteger(fieldletCount, this._scene.fieldletCount, "fieldletCount");
    const nextMaterialCount = positiveInteger(materialCount, this._scene.materialCount, "materialCount");
    if (nextMaterialCount !== this._scene.materialCount) {
      throw new RangeError("MorphField wavefront same-allocation metadata updates cannot change materialCount");
    }
    if (this._scene.materialExtensionsOwned && materialDescriptors !== undefined) {
      const packed = packMaterialExtensions(materialDescriptors);
      if (packed.length / 4 !== this._scene.materialExtensionCount) {
        throw new RangeError("MorphField wavefront same-allocation metadata updates cannot change material extension count");
      }
      this.device.queue.writeBuffer(this._scene.materialExtensions, 0, bytesOf(packed));
    }
    this._scene.fieldletCount = nextFieldletCount;
    this._scene.materialCount = nextMaterialCount;
    this._scene.revision = nonNegativeInteger(revision, this._scene.revision, "scene revision");
    this.reset("scene-metadata-changed");
    this.logger.debug("MorphField.wavefront.scene.metadata", {
      fieldletCount: this._scene.fieldletCount,
      materialCount: this._scene.materialCount,
      revision: this._scene.revision,
    });
    return Object.freeze({
      fieldletCount: this._scene.fieldletCount,
      materialCount: this._scene.materialCount,
      materialExtensionCount: this._scene.materialExtensionCount,
      revision: this._scene.revision,
    });
  }

  /** Allocates bounded owned queues and an f32 sum/count accumulation buffer. */
  resize(width, height) {
    this._assertReady();
    const nextWidth = positiveInteger(Math.floor(Number(width)), 1, "width");
    const nextHeight = positiveInteger(Math.floor(Number(height)), 1, "height");
    const pixelCount = nextWidth * nextHeight;
    if (!Number.isSafeInteger(pixelCount)) throw new RangeError("MorphField wavefront resolution overflows a safe pixel count");
    const maximumStorage = Math.min(this._limits.maxStorageBufferBindingSize, this._limits.maxBufferSize);
    const accumulationBytes = pixelCount * WAVEFRONT_RECORD_BYTES.accumulation;
    if (accumulationBytes > maximumStorage) {
      throw new RangeError(`MorphField wavefront accumulation needs ${accumulationBytes} bytes, exceeding the device storage-buffer limit ${maximumStorage}`);
    }
    if (nextWidth === this._width && nextHeight === this._height && this._resources) {
      return Object.freeze({ width: nextWidth, height: nextHeight, queueCapacity: this._queueCapacity, tileCount: this._tileCount, reused: true });
    }
    if (this._resources && pixelCount <= this._capacityPixelCount) {
      const reusedTileCount = Math.ceil(pixelCount / this._queueCapacity);
      if (reusedTileCount <= this._frameUniformTileCapacity) {
        this._width = nextWidth;
        this._height = nextHeight;
        this._pixelCount = pixelCount;
        this._tileCount = reusedTileCount;
        this._updateTileDispatches();
        this.reset("resized-within-capacity");
        this.logger.debug("MorphField.wavefront.resize.reuse", {
          width: nextWidth,
          height: nextHeight,
          pixels: pixelCount,
          capacityPixels: this._capacityPixelCount,
          queueCapacity: this._queueCapacity,
          tileCount: reusedTileCount,
        });
        return Object.freeze({ width: nextWidth, height: nextHeight, queueCapacity: this._queueCapacity, tileCount: reusedTileCount, reused: true });
      }
    }
    const largestQueueStride = Math.max(
      WAVEFRONT_RECORD_BYTES.ray,
      WAVEFRONT_RECORD_BYTES.hit,
      WAVEFRONT_RECORD_BYTES.shadow,
    );
    const maximumCapacityByBinding = Math.floor(
      (maximumStorage - WAVEFRONT_RECORD_BYTES.queueHeader) / largestQueueStride,
    );
    const perCapacityBytes = WAVEFRONT_RECORD_BYTES.ray * 2
      + WAVEFRONT_RECORD_BYTES.hit
      + WAVEFRONT_RECORD_BYTES.shadow
      + WAVEFRONT_RECORD_BYTES.pathState;
    const budgetCapacity = Math.floor((this.memoryBudgetBytes - accumulationBytes) / perCapacityBytes);
    const capacity = Math.min(
      pixelCount,
      this.requestedQueueCapacity,
      maximumCapacityByBinding,
      budgetCapacity,
    );
    if (capacity < 1) {
      throw new RangeError("MorphField wavefront memory budget cannot hold one bounded queue record plus accumulation");
    }
    const tileCount = Math.ceil(pixelCount / capacity);
    const frameUniformBytes = tileCount * this._uniformStride;
    if (frameUniformBytes > this._limits.maxBufferSize) {
      throw new RangeError("MorphField wavefront tiled frame-uniform buffer exceeds maxBufferSize");
    }

    const previousResources = this._resources;
    const previousDimensions = {
      width: this._width,
      height: this._height,
      pixelCount: this._pixelCount,
      queueCapacity: this._queueCapacity,
      tileCount: this._tileCount,
    };
    const resources = {};
    try {
      resources.rayA = this._createQueueBuffer("RayQueueA", capacity, WAVEFRONT_RECORD_BYTES.ray);
      resources.rayB = this._createQueueBuffer("RayQueueB", capacity, WAVEFRONT_RECORD_BYTES.ray);
      resources.hit = this._createQueueBuffer("HitQueue", capacity, WAVEFRONT_RECORD_BYTES.hit);
      resources.shadow = this._createQueueBuffer("ShadowQueue", capacity, WAVEFRONT_RECORD_BYTES.shadow);
      resources.pathState = this._createBuffer(
        `${this.label}.PathState`,
        Math.max(16, capacity * WAVEFRONT_RECORD_BYTES.pathState),
        bufferUsage("STORAGE", "COPY_SRC", "COPY_DST"),
        "wavefront-frame",
      );
      resources.accumulation = this._createBuffer(
        `${this.label}.Accumulation`,
        Math.max(16, accumulationBytes),
        bufferUsage("STORAGE", "COPY_SRC", "COPY_DST"),
        "wavefront-frame",
      );
      resources.frameUniforms = this._createBuffer(
        `${this.label}.FrameUniforms`,
        Math.max(this._uniformStride, frameUniformBytes),
        bufferUsage("UNIFORM", "COPY_DST"),
        "wavefront-frame",
      );
    } catch (error) {
      for (const resource of Object.values(resources)) this.tracker.release(resource);
      throw error;
    }
    this._width = nextWidth;
    this._height = nextHeight;
    this._pixelCount = pixelCount;
    this._queueCapacity = capacity;
    this._tileCount = tileCount;
    this._resources = resources;
    try {
      this._rebuildBindGroups();
    } catch (error) {
      this._resources = previousResources;
      this._width = previousDimensions.width;
      this._height = previousDimensions.height;
      this._pixelCount = previousDimensions.pixelCount;
      this._queueCapacity = previousDimensions.queueCapacity;
      this._tileCount = previousDimensions.tileCount;
      for (const resource of Object.values(resources)) this.tracker.release(resource);
      this._rebuildBindGroups();
      throw error;
    }
    if (previousResources) {
      for (const resource of Object.values(previousResources)) this.tracker.release(resource);
    }
    this._capacityPixelCount = pixelCount;
    this._frameUniformTileCapacity = tileCount;
    this._frameUniformCpuData = new ArrayBuffer(Math.max(this._uniformStride, frameUniformBytes));
    this._frameUniformCpuBytes = new Uint8Array(this._frameUniformCpuData);
    this._frameUniformFloatViews = Array.from({ length: tileCount }, (_, tile) => (
      new Float32Array(this._frameUniformCpuData, tile * this._uniformStride, FRAME_UNIFORM_USED_BYTES / 4)
    ));
    this._frameUniformIntegerViews = Array.from({ length: tileCount }, (_, tile) => (
      new Uint32Array(this._frameUniformCpuData, tile * this._uniformStride, FRAME_UNIFORM_USED_BYTES / 4)
    ));
    this._tileDispatches = Array.from({ length: tileCount }, () => ({ x: 1, y: 1 }));
    this._frameOffsets = Array.from({ length: tileCount }, (_, tile) => Object.freeze([tile * this._uniformStride]));
    this._shadeOffsets = Array.from({ length: tileCount }, (_, tile) => Array.from(
      { length: WAVEFRONT_MAX_BOUNCES },
      (_, bounce) => Object.freeze([tile * this._uniformStride, bounce * this._bounceStride]),
    ));
    this._updateTileDispatches();
    const tracer = this;
    this._outputDescriptor = Object.freeze({
      buffer: resources.accumulation,
      get width() { return tracer._width; },
      get height() { return tracer._height; },
      get sampleCount() { return tracer._historySamples; },
      ...WAVEFRONT_OUTPUT_ENCODING,
    });
    this.reset("resized");
    this.logger.info("MorphField.wavefront.resize", {
      width: nextWidth,
      height: nextHeight,
      pixels: pixelCount,
      queueCapacity: capacity,
      tileCount,
    });
    return Object.freeze({ width: nextWidth, height: nextHeight, queueCapacity: capacity, tileCount, reused: false });
  }

  _updateTileDispatches() {
    for (let tile = 0; tile < this._tileCount; tile += 1) {
      const tileOffset = tile * this._queueCapacity;
      const tilePixels = Math.min(this._queueCapacity, this._pixelCount - tileOffset);
      groupsFor(tilePixels, this._limits.maxComputeWorkgroupsPerDimension, this._tileDispatches[tile]);
    }
  }

  /** Invalidates progressive accumulation on the next external encode. */
  reset(reason = "requested") {
    this._assertReady();
    this._historySamples = 0;
    this._resetPending = true;
    this._resetReason = String(reason);
  }

  /**
   * Records generate/intersect/shade/shadow/finalize compute passes. The host
   * retains responsibility for finishing and submitting `encoder`.
   */
  encode({
    encoder,
    camera,
    lights,
    frameIndex = this._encodedFrames,
    sampleIndex = this._historySamples,
    sceneRevision = this._scene?.revision ?? 0,
    maxBounces = 8,
    maxTraceSteps = 192,
    maxDistance = 10_000,
    hitEpsilon = 0.0005,
    rayEpsilon = 0.001,
    radianceClamp = 10_000,
    captureStats = false,
  } = {}) {
    this._assertReady();
    if (!this._scene) throw new Error("MorphField wavefront encode requires setSceneBuffers() first");
    if (!this._resources || !this._groups) throw new Error("MorphField wavefront encode requires resize() first");
    validateEncoder(encoder, captureStats);
    const bounceCount = positiveInteger(maxBounces, 8, "maxBounces", WAVEFRONT_MAX_BOUNCES);
    const traceSteps = positiveInteger(maxTraceSteps, 192, "maxTraceSteps", WAVEFRONT_MAX_TRACE_STEPS);
    const normalizedFrameIndex = nonNegativeInteger(frameIndex, this._encodedFrames, "frameIndex");
    const normalizedSampleIndex = nonNegativeInteger(sampleIndex, this._historySamples, "sampleIndex");
    const normalizedRevision = nonNegativeInteger(sceneRevision, this._scene.revision, "sceneRevision");
    const inverseViewProjection = matrix4(
      camera?.inverseViewProjection
        || camera?.invViewProjection
        || camera?.inverseViewProjectionMatrix,
    );
    const cameraPosition = vector(camera?.position || camera?.worldPosition, 3, [0, 0, 0], this._cameraPositionScratch);
    const directional = firstDirectionalLight(lights);
    const sunDirection = resolveDirectionToLight(directional, this._sunDirectionScratch);
    const sunColor = vector(directional.color, 3, [1, 0.96, 0.88], this._sunColorScratch);
    const sunIntensity = finite(directional.intensity, 3, 0, 1e6);
    const environmentZenith = vector(
      lights?.environmentZenith || lights?.skyColor || lights?.ambientColor,
      3,
      [0.32, 0.48, 0.78],
      this._environmentZenithScratch,
    );
    const environmentHorizon = vector(
      lights?.environmentHorizon || lights?.horizonColor,
      3,
      [0.12, 0.16, 0.22],
      this._environmentHorizonScratch,
    );
    const environmentIntensity = finite(lights?.environmentIntensity, 1, 0, 1e6);
    const safeMaxDistance = finite(maxDistance, 10_000, 0.001, 1e12);
    const safeHitEpsilon = finite(hitEpsilon, 0.0005, 1e-7, 1);
    const safeRayEpsilon = finite(rayEpsilon, Math.max(safeHitEpsilon * 2, 0.001), safeHitEpsilon, 2);
    const safeRadianceClamp = finite(radianceClamp, 10_000, 1, 1e12);

    for (let tile = 0; tile < this._tileCount; tile += 1) {
      const tileOffset = tile * this._queueCapacity;
      const tilePixels = Math.min(this._queueCapacity, this._pixelCount - tileOffset);
      const dispatch = this._tileDispatches[tile];
      const floats = this._frameUniformFloatViews[tile];
      const integers = this._frameUniformIntegerViews[tile];
      floats.set(inverseViewProjection, 0);
      floats[16] = cameraPosition[0]; floats[17] = cameraPosition[1]; floats[18] = cameraPosition[2]; floats[19] = 1;
      floats[20] = this._width; floats[21] = this._height; floats[22] = 1 / this._width; floats[23] = 1 / this._height;
      floats[24] = sunDirection[0]; floats[25] = sunDirection[1]; floats[26] = sunDirection[2]; floats[27] = sunIntensity;
      floats[28] = sunColor[0]; floats[29] = sunColor[1]; floats[30] = sunColor[2]; floats[31] = 0;
      floats[32] = environmentZenith[0]; floats[33] = environmentZenith[1]; floats[34] = environmentZenith[2]; floats[35] = environmentIntensity;
      floats[36] = environmentHorizon[0]; floats[37] = environmentHorizon[1]; floats[38] = environmentHorizon[2]; floats[39] = 0;
      integers[40] = this._scene.fieldletCount; integers[41] = this._scene.materialCount;
      integers[42] = this._scene.materialExtensionCount; integers[43] = traceSteps;
      floats[44] = safeMaxDistance; floats[45] = safeHitEpsilon; floats[46] = safeRayEpsilon; floats[47] = safeRadianceClamp;
      integers[48] = normalizedSampleIndex; integers[49] = normalizedFrameIndex;
      integers[50] = normalizedRevision; integers[51] = this.seed;
      integers[52] = dispatch.x; integers[53] = tileOffset; integers[54] = tilePixels; integers[55] = 0;
    }
    this.device.queue.writeBuffer(this._resources.frameUniforms, 0, this._frameUniformCpuBytes);
    if (bounceCount !== this._lastBounceCount) {
      for (let bounce = 0; bounce < WAVEFRONT_MAX_BOUNCES; bounce += 1) {
        const values = new Uint32Array(this._bounceUniformCpuData, bounce * this._bounceStride, 4);
        values[0] = bounce;
        values[1] = bounceCount;
        values[2] = 0;
        values[3] = 0;
      }
      this.device.queue.writeBuffer(this._bounceUniforms, 0, this._bounceUniformCpuBytes);
      this._lastBounceCount = bounceCount;
    }

    for (const queue of [
      this._resources.rayA,
      this._resources.rayB,
      this._resources.hit,
      this._resources.shadow,
    ]) {
      encoder.clearBuffer(queue, 0, 8);
    }
    if (this._resetPending) {
      encoder.clearBuffer(this._resources.accumulation, 0, this._pixelCount * WAVEFRONT_RECORD_BYTES.accumulation);
      this.logger.debug("MorphField.wavefront.history.reset", { reason: this._resetReason });
      this._resetPending = false;
    }

    let passCount = 0;
    const passLabels = [];
    for (let tile = 0; tile < this._tileCount; tile += 1) {
      const dispatch = this._tileDispatches[tile];
      const frameOffsets = this._frameOffsets[tile];
      encoder.clearBuffer(this._resources.rayA, 0, 4);
      encoder.clearBuffer(this._resources.rayB, 0, 4);
      encoder.clearBuffer(this._resources.hit, 0, 4);
      encoder.clearBuffer(this._resources.shadow, 0, 4);
      const generateLabel = `${this.label}.Tile${tile}.Generate`;
      this._dispatch(
        encoder,
        generateLabel,
        this._pipelines.generate,
        this._groups.generateFrame,
        frameOffsets,
        this._groups.generateQueue,
        this._emptyOffsets,
        dispatch,
      );
      passLabels.push(generateLabel);
      passCount += 1;
      let inputIsA = true;
      for (let bounce = 0; bounce < bounceCount; bounce += 1) {
        encoder.clearBuffer(this._resources.hit, 0, 4);
        encoder.clearBuffer(inputIsA ? this._resources.rayB : this._resources.rayA, 0, 4);
        encoder.clearBuffer(this._resources.shadow, 0, 4);
        const intersectLabel = `${this.label}.Tile${tile}.Bounce${bounce}.Intersect`;
        const shadeLabel = `${this.label}.Tile${tile}.Bounce${bounce}.Shade`;
        const shadowLabel = `${this.label}.Tile${tile}.Bounce${bounce}.Shadow`;
        this._dispatch(
          encoder,
          intersectLabel,
          this._pipelines.intersect,
          this._groups.intersectScene,
          frameOffsets,
          inputIsA ? this._groups.intersectA : this._groups.intersectB,
          this._emptyOffsets,
          dispatch,
        );
        this._dispatch(
          encoder,
          shadeLabel,
          this._pipelines.shade,
          this._groups.shadeScene,
          this._shadeOffsets[tile][bounce],
          inputIsA ? this._groups.shadeAToB : this._groups.shadeBToA,
          this._emptyOffsets,
          dispatch,
        );
        this._dispatch(
          encoder,
          shadowLabel,
          this._pipelines.shadow,
          this._groups.shadowScene,
          frameOffsets,
          this._groups.shadowQueue,
          this._emptyOffsets,
          dispatch,
        );
        passLabels.push(intersectLabel, shadeLabel, shadowLabel);
        inputIsA = !inputIsA;
        passCount += 3;
      }
      const finalizeLabel = `${this.label}.Tile${tile}.Finalize`;
      this._dispatch(
        encoder,
        finalizeLabel,
        this._pipelines.finalize,
        this._groups.finalizeFrame,
        frameOffsets,
        this._groups.finalizeQueue,
        this._emptyOffsets,
        dispatch,
      );
      passLabels.push(finalizeLabel);
      passCount += 1;
    }

    let statsTicket = null;
    if (captureStats && !this._statsPending && typeof this._statsReadback.mapAsync === "function") {
      [
        this._resources.rayA,
        this._resources.rayB,
        this._resources.hit,
        this._resources.shadow,
      ].forEach((queue, index) => encoder.copyBufferToBuffer(queue, 0, this._statsReadback, index * 16, 16));
      this._statsPending = true;
      this._statsTicket += 1;
      statsTicket = this._statsTicket;
    }
    this._historySamples += 1;
    this._encodedFrames += 1;
    this._encodedPasses += passCount;
    this._lastEncode = Object.freeze({
      encoded: true,
      frameIndex: normalizedFrameIndex,
      sampleIndex: normalizedSampleIndex,
      passCount,
      tileCount: this._tileCount,
      queueCapacity: this._queueCapacity,
    });
    if (this._encodedFrames === 1 || this._encodedFrames % this._debugLogStride === 0) {
      this.logger.debug("MorphField.wavefront.encode", {
        frameIndex: normalizedFrameIndex,
        sampleIndex: normalizedSampleIndex,
        bounces: bounceCount,
        tiles: this._tileCount,
        passes: passCount,
      });
    }
    return Object.freeze({
      encoded: true,
      submitted: false,
      passCount,
      passLabels: Object.freeze(passLabels),
      tileCount: this._tileCount,
      queueCapacity: this._queueCapacity,
      statsTicket,
      output: this.getOutput(),
    });
  }

  /** Resolves an explicitly requested queue-header readback after host submit. */
  async resolveStats(ticket = this._statsTicket) {
    this._assertReady();
    if (!this._statsPending || ticket !== this._statsTicket) return this._lastGpuStats;
    try {
      await this._statsReadback.mapAsync(mapReadFlag(), 0, STATS_BYTES);
      const mapped = this._statsReadback.getMappedRange(0, STATS_BYTES);
      const copy = new Uint32Array(mapped.slice(0));
      const queue = (offset) => ({ count: copy[offset], overflow: copy[offset + 1], capacity: copy[offset + 2] });
      this._lastGpuStats = freezeStats({
        available: true,
        ticket,
        gpuQueues: {
          rayA: queue(0),
          rayB: queue(4),
          hit: queue(8),
          shadow: queue(12),
        },
      });
      this._statsReadback.unmap();
      this._statsPending = false;
      return this._lastGpuStats;
    } catch (error) {
      try { this._statsReadback.unmap?.(); } catch { /* already unmapped */ }
      this._statsPending = false;
      this.logger.error("MorphField.wavefront.stats.failed", { message: error.message });
      throw error;
    }
  }

  /** Returns the owned rgba32float radiance-sum/sample-count output buffer. */
  getOutput() {
    this._assertReady();
    return this._outputDescriptor;
  }

  /**
   * Releases only resolution-dependent queues and accumulation. Persistent
   * pipelines, layouts, scene bindings, and lifetime counters remain ready so
   * a later progressive encode can rebuild the extent without recompilation.
   */
  releaseFrameResources(reason = "requested") {
    this._assertReady();
    const released = this.tracker.releaseWhere((entry) => entry.kind === "wavefront-frame");
    this._resources = null;
    this._outputDescriptor = null;
    this._groups = null;
    this._width = 0;
    this._height = 0;
    this._pixelCount = 0;
    this._queueCapacity = 0;
    this._tileCount = 0;
    this._capacityPixelCount = 0;
    this._frameUniformTileCapacity = 0;
    this._frameUniformCpuData = null;
    this._frameUniformCpuBytes = null;
    this._frameUniformFloatViews = [];
    this._frameUniformIntegerViews = [];
    this._tileDispatches = [];
    this._frameOffsets = [];
    this._shadeOffsets = [];
    this._historySamples = 0;
    this._resetPending = true;
    this._resetReason = String(reason);
    if (released > 0) {
      this.logger.info("MorphField.wavefront.frame-resources.released", { reason: this._resetReason, released });
    }
    return released;
  }

  /** Returns synchronous lifecycle data plus the latest resolved GPU counters. */
  getStats() {
    this._assertReady();
    const ownership = this.tracker.getStats();
    return Object.freeze({
      width: this._width,
      height: this._height,
      pixelCount: this._pixelCount,
      capacityPixelCount: this._capacityPixelCount,
      queueCapacity: this._queueCapacity,
      tileCount: this._tileCount,
      encodedFrames: this._encodedFrames,
      encodedPasses: this._encodedPasses,
      lastEncode: this._lastEncode,
      historySamples: this._historySamples,
      frameResourcesResident: Boolean(this._resources),
      frameResourceBytes: ownership.byKind["wavefront-frame"]?.bytes || 0,
      sceneRevision: this._scene?.revision ?? 0,
      fieldletCount: this._scene?.fieldletCount ?? 0,
      pendingStatsReadback: this._statsPending,
      pipelinePreparation: this._pipelinePreparation,
      gpu: this._lastGpuStats,
      ownership,
      limitations: WAVEFRONT_LIMITATIONS,
    });
  }

  /** Releases only owned resources. Safe to call more than once. */
  destroy() {
    if (this._destroyed) return false;
    try { this._statsReadback?.unmap?.(); } catch { /* buffer was not mapped */ }
    this.tracker.destroyAll();
    this._scene = null;
    this._resources = null;
    this._outputDescriptor = null;
    this._groups = null;
    this._destroyed = true;
    this.logger.info("MorphField.wavefront.destroy", { released: true });
    return true;
  }

  async _initialize() {
    this._assertAlive();
    try {
      await withErrorScope(this.device, async () => {
        this._createLayoutsAndPipelines();
        this._bounceUniforms = this._createBuffer(
          `${this.label}.BounceUniforms`,
          WAVEFRONT_MAX_BOUNCES * this._bounceStride,
          bufferUsage("UNIFORM", "COPY_DST"),
          "wavefront-persistent",
        );
        this._statsReadback = this._createBuffer(
          `${this.label}.StatsReadback`,
          STATS_BYTES,
          bufferUsage("MAP_READ", "COPY_DST"),
          "wavefront-persistent",
        );
        const pipelinePreparations = Object.entries(this._pipelines).map(async ([name, pipeline]) => {
          this._pipelines[name] = await pipeline;
        });
        try {
          await Promise.all(pipelinePreparations);
        } catch (pipelineError) {
          // Drain sibling pipeline promises before destroying the tracker. A late
          // async pipeline must never become owned after initialization cleanup.
          await Promise.allSettled(pipelinePreparations);
          throw pipelineError;
        }
      });
      await this._validateShaderCompilation();
      this._initialized = true;
      this.logger.info("MorphField.wavefront.initialize", { f32Baseline: true, optionalFeatures: [] });
      return this;
    } catch (error) {
      this.tracker.destroyAll();
      this.logger.error("MorphField.wavefront.initialize.failed", { message: error.message });
      throw error;
    }
  }

  _createLayoutsAndPipelines() {
    const compute = shaderStages("COMPUTE");
    const uniformDynamic = { type: "uniform", hasDynamicOffset: true, minBindingSize: FRAME_UNIFORM_USED_BYTES };
    const storage = { type: "storage" };
    const readStorage = { type: "read-only-storage" };
    const layout = (label, entries) => this.tracker.own(this.device.createBindGroupLayout({
      label: `${this.label}.${label}`,
      entries,
    }), { kind: "wavefront-layout", label });
    const frameEntry = { binding: 0, visibility: compute, buffer: uniformDynamic };
    const sceneEntries = [
      frameEntry,
      ...Array.from({ length: 6 }, (_, index) => ({ binding: index + 1, visibility: compute, buffer: readStorage })),
    ];
    this._layouts = {
      generateFrame: layout("Generate.FrameLayout", [frameEntry]),
      generateQueue: layout("Generate.QueueLayout", [
        { binding: 0, visibility: compute, buffer: storage },
        { binding: 1, visibility: compute, buffer: storage },
      ]),
      intersectScene: layout("Intersect.SceneLayout", sceneEntries),
      intersectQueue: layout("Intersect.QueueLayout", [
        { binding: 0, visibility: compute, buffer: storage },
        { binding: 1, visibility: compute, buffer: storage },
      ]),
      shadeScene: layout("Shade.SceneLayout", [
        frameEntry,
        { binding: 1, visibility: compute, buffer: readStorage },
        { binding: 2, visibility: compute, buffer: readStorage },
        { binding: 3, visibility: compute, buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: 16 } },
      ]),
      shadeQueue: layout("Shade.QueueLayout", Array.from({ length: 5 }, (_, binding) => ({
        binding,
        visibility: compute,
        buffer: storage,
      }))),
      shadowScene: layout("Shadow.SceneLayout", sceneEntries),
      shadowQueue: layout("Shadow.QueueLayout", [
        { binding: 0, visibility: compute, buffer: storage },
        { binding: 1, visibility: compute, buffer: storage },
      ]),
      finalizeFrame: layout("Finalize.FrameLayout", [frameEntry]),
      finalizeQueue: layout("Finalize.QueueLayout", [
        { binding: 0, visibility: compute, buffer: readStorage },
        { binding: 1, visibility: compute, buffer: storage },
      ]),
    };
    const pipeline = (name, source, entryPoint, layouts) => {
      const module = this.tracker.own(this.device.createShaderModule({
        label: `${this.label}.${name}.Shader`,
        code: source,
      }), { kind: "wavefront-shader", label: name });
      this._shaderModules.push({ name, module });
      const pipelineLayout = this.tracker.own(this.device.createPipelineLayout({
        label: `${this.label}.${name}.PipelineLayout`,
        bindGroupLayouts: layouts,
      }), { kind: "wavefront-layout", label: `${name}-pipeline` });
      const descriptor = {
        label: `${this.label}.${name}.Pipeline`,
        layout: pipelineLayout,
        compute: { module, entryPoint },
      };
      const created = typeof this.device.createComputePipelineAsync === "function"
        ? this.device.createComputePipelineAsync(descriptor)
        : this.device.createComputePipeline(descriptor);
      return Promise.resolve(created).then((resolved) => this.tracker.own(
        resolved,
        { kind: "wavefront-pipeline", label: name },
      ));
    };
    this._shaderModules = [];
    this._pipelines = {
      generate: pipeline("Generate", WAVEFRONT_SHADER_SOURCES.generate, "generatePrimary", [this._layouts.generateFrame, this._layouts.generateQueue]),
      intersect: pipeline("Intersect", WAVEFRONT_SHADER_SOURCES.intersect, "intersectRays", [this._layouts.intersectScene, this._layouts.intersectQueue]),
      shade: pipeline("Shade", WAVEFRONT_SHADER_SOURCES.shade, "shadeHits", [this._layouts.shadeScene, this._layouts.shadeQueue]),
      shadow: pipeline("Shadow", WAVEFRONT_SHADER_SOURCES.shadow, "resolveShadows", [this._layouts.shadowScene, this._layouts.shadowQueue]),
      finalize: pipeline("Finalize", WAVEFRONT_SHADER_SOURCES.finalize, "finalizeSample", [this._layouts.finalizeFrame, this._layouts.finalizeQueue]),
    };
  }

  async _validateShaderCompilation() {
    for (const { name, module } of this._shaderModules) {
      if (typeof module.getCompilationInfo !== "function") continue;
      const info = await module.getCompilationInfo();
      const errors = (info.messages || []).filter((message) => message.type === "error");
      if (errors.length > 0) {
        throw new Error(`MorphField wavefront ${name} WGSL failed: ${errors.map((entry) => {
          const location = Number.isInteger(entry.lineNum)
            ? `${entry.lineNum}:${Number.isInteger(entry.linePos) ? entry.linePos : 0} `
            : "";
          return `${location}${entry.message}`;
        }).join(" | ")}`);
      }
    }
  }

  _rebuildBindGroups() {
    if (!this._resources || !this._scene || !this._initialized) return;
    const resource = (buffer, size) => ({ buffer, ...(size ? { size } : {}) });
    const frameResource = resource(this._resources.frameUniforms, FRAME_UNIFORM_USED_BYTES);
    const bounceResource = resource(this._bounceUniforms, 16);
    const create = (label, layout, entries) => this.device.createBindGroup({
      label: `${this.label}.${label}`,
      layout,
      entries,
    });
    const sceneEntries = [
      { binding: 0, resource: frameResource },
      { binding: 1, resource: resource(this._scene.fieldletHeaders) },
      { binding: 2, resource: resource(this._scene.payloads) },
      { binding: 3, resource: resource(this._scene.resolvedCertificates) },
      { binding: 4, resource: resource(this._scene.programWords) },
      { binding: 5, resource: resource(this._scene.analyticParameters) },
      { binding: 6, resource: resource(this._scene.bounds) },
    ];
    this._groups = {
      generateFrame: create("Generate.Frame", this._layouts.generateFrame, [{ binding: 0, resource: frameResource }]),
      generateQueue: create("Generate.Queue", this._layouts.generateQueue, [
        { binding: 0, resource: resource(this._resources.rayA) },
        { binding: 1, resource: resource(this._resources.pathState) },
      ]),
      intersectScene: create("Intersect.Scene", this._layouts.intersectScene, sceneEntries),
      intersectA: create("Intersect.A", this._layouts.intersectQueue, [
        { binding: 0, resource: resource(this._resources.rayA) },
        { binding: 1, resource: resource(this._resources.hit) },
      ]),
      intersectB: create("Intersect.B", this._layouts.intersectQueue, [
        { binding: 0, resource: resource(this._resources.rayB) },
        { binding: 1, resource: resource(this._resources.hit) },
      ]),
      shadeScene: create("Shade.Scene", this._layouts.shadeScene, [
        { binding: 0, resource: frameResource },
        { binding: 1, resource: resource(this._scene.materials) },
        { binding: 2, resource: resource(this._scene.materialExtensions) },
        { binding: 3, resource: bounceResource },
      ]),
      shadeAToB: create("Shade.AToB", this._layouts.shadeQueue, [
        { binding: 0, resource: resource(this._resources.hit) },
        { binding: 1, resource: resource(this._resources.rayA) },
        { binding: 2, resource: resource(this._resources.rayB) },
        { binding: 3, resource: resource(this._resources.shadow) },
        { binding: 4, resource: resource(this._resources.pathState) },
      ]),
      shadeBToA: create("Shade.BToA", this._layouts.shadeQueue, [
        { binding: 0, resource: resource(this._resources.hit) },
        { binding: 1, resource: resource(this._resources.rayB) },
        { binding: 2, resource: resource(this._resources.rayA) },
        { binding: 3, resource: resource(this._resources.shadow) },
        { binding: 4, resource: resource(this._resources.pathState) },
      ]),
      shadowScene: create("Shadow.Scene", this._layouts.shadowScene, sceneEntries),
      shadowQueue: create("Shadow.Queue", this._layouts.shadowQueue, [
        { binding: 0, resource: resource(this._resources.shadow) },
        { binding: 1, resource: resource(this._resources.pathState) },
      ]),
      finalizeFrame: create("Finalize.Frame", this._layouts.finalizeFrame, [{ binding: 0, resource: frameResource }]),
      finalizeQueue: create("Finalize.Queue", this._layouts.finalizeQueue, [
        { binding: 0, resource: resource(this._resources.pathState) },
        { binding: 1, resource: resource(this._resources.accumulation) },
      ]),
    };
  }

  _dispatch(encoder, label, pipeline, firstGroup, firstOffsets, secondGroup, secondOffsets, dispatch) {
    const pass = encoder.beginComputePass({ label });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, firstGroup, firstOffsets);
    pass.setBindGroup(1, secondGroup, secondOffsets);
    pass.dispatchWorkgroups(dispatch.x, dispatch.y, 1);
    pass.end();
  }

  _createQueueBuffer(name, capacity, stride) {
    const size = queueByteSize(capacity, stride);
    const buffer = this._createBuffer(
      `${this.label}.${name}`,
      size,
      bufferUsage("STORAGE", "COPY_SRC", "COPY_DST"),
      "wavefront-frame",
    );
    this.device.queue.writeBuffer(buffer, 0, new Uint32Array([0, 0, capacity, 0]));
    return buffer;
  }

  _createUploadedBuffer(label, data, kind) {
    const size = Math.max(16, alignTo(data.byteLength, 4));
    const buffer = this._createBuffer(label, size, bufferUsage("STORAGE", "COPY_SRC", "COPY_DST"), kind);
    this.device.queue.writeBuffer(buffer, 0, bytesOf(data));
    return buffer;
  }

  _createBuffer(label, size, usage, kind) {
    if (!Number.isSafeInteger(size) || size < 1 || size > this._limits.maxBufferSize) {
      throw new RangeError(`${label} requests invalid GPU buffer size ${size}`);
    }
    return this.tracker.own(this.device.createBuffer({ label, size, usage }), {
      kind,
      label,
      bytes: size,
    });
  }

  _assertAlive() {
    if (this._destroyed) throw new Error("MorphField wavefront path tracer has been destroyed");
  }

  _assertReady() {
    this._assertAlive();
    if (!this._initialized) throw new Error("MorphField wavefront path tracer is not initialized");
  }
}

export async function createWavefrontPathTracer(options) {
  return MorphFieldWavefrontPathTracer.create(options);
}
