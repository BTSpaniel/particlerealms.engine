// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { bufferUsage, shaderStages, validateExternalEncoder } from "./capabilities.js";
import { QUERY_KIND } from "./SceneBufferUploader.js";
import { QUERY_LINEAR_SHADER_WGSL } from "./RuntimeShaders.js";

const QUERY_FLOATS = 16;
const QUERY_BYTES = QUERY_FLOATS * 4;
const F32_MAX = 3.4028234663852886e38;
const U32_MAX = 0xFFFFFFFF;

const QUERY_NAME_TO_KIND = Object.freeze({
  bound: QUERY_KIND.BOUND,
  surface: QUERY_KIND.SURFACE,
  medium: QUERY_KIND.MEDIUM,
  material: QUERY_KIND.MATERIAL,
  motion: QUERY_KIND.MOTION,
  collision: QUERY_KIND.COLLISION,
});

const QUERY_DESCRIPTOR_KEYS = new Set([
  "kind",
  "type",
  "point",
  "position",
  "direction",
  "maxDistance",
  "fieldletIndex",
  "flags",
  "radius",
  "collisionRadius",
]);

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function align4(value) {
  return Math.max(16, Math.ceil(value / 4) * 4);
}

function kindOf(value, index) {
  if (value === undefined) return QUERY_KIND.SURFACE;
  if (Number.isInteger(value) && value >= QUERY_KIND.BOUND && value <= QUERY_KIND.COLLISION) return value;
  const kind = typeof value === "string" ? QUERY_NAME_TO_KIND[value.toLowerCase()] : undefined;
  if (kind === undefined) throw new RangeError(`MorphField query ${index}: unknown query kind ${value}`);
  return kind;
}

function finiteQueryNumber(value, fallback, label, index, minimum = -Infinity) {
  const number = value === undefined ? fallback : value;
  if (typeof number !== "number" || !Number.isFinite(number) || Math.abs(number) > F32_MAX
      || !Number.isFinite(Math.fround(number))) {
    throw new RangeError(`MorphField query ${index}: ${label} must be finite and representable as f32`);
  }
  if (number < minimum) {
    throw new RangeError(`MorphField query ${index}: ${label} must be at least ${minimum}`);
  }
  return number;
}

function finiteQueryVector(value, fallback, label, index) {
  if (value === undefined) return fallback;
  const vectorLike = Array.isArray(value) || (ArrayBuffer.isView(value) && !(value instanceof DataView));
  if (!vectorLike || value.length !== 3) {
    throw new TypeError(`MorphField query ${index}: ${label} must contain exactly three finite f32 components`);
  }
  return [0, 1, 2].map((axis) => {
    const component = value[axis];
    if (typeof component !== "number" || !Number.isFinite(component) || Math.abs(component) > F32_MAX
        || !Number.isFinite(Math.fround(component))) {
      throw new RangeError(`MorphField query ${index}: ${label}[${axis}] must be finite and representable as f32`);
    }
    return component;
  });
}

function unsignedQueryInteger(value, fallback, label, index) {
  const number = value === undefined ? fallback : value;
  if (!Number.isInteger(number) || number < 0 || number > U32_MAX) {
    throw new RangeError(`MorphField query ${index}: ${label} must be a u32 integer`);
  }
  return number;
}

function aliasValue(query, canonical, alias, index) {
  if (hasOwn(query, canonical) && hasOwn(query, alias)) {
    throw new TypeError(`MorphField query ${index}: ${canonical} and ${alias} cannot both be specified`);
  }
  if (hasOwn(query, canonical)) return query[canonical];
  return hasOwn(query, alias) ? query[alias] : undefined;
}

function ownValue(query, key) {
  return hasOwn(query, key) ? query[key] : undefined;
}

function validateQueryDescriptor(query, index, fieldletCount) {
  if (query === null || typeof query !== "object" || Array.isArray(query)) {
    throw new TypeError(`MorphField query ${index}: descriptor must be an object`);
  }
  for (const key of Reflect.ownKeys(query)) {
    if (typeof key !== "string" || !QUERY_DESCRIPTOR_KEYS.has(key)) {
      throw new TypeError(`MorphField query ${index}: unknown property ${String(key)}`);
    }
  }
  const kind = kindOf(aliasValue(query, "kind", "type", index), index);
  const point = finiteQueryVector(aliasValue(query, "point", "position", index), [0, 0, 0], "point", index);
  const direction = finiteQueryVector(ownValue(query, "direction"), [0, 0, 0], "direction", index);
  const maxDistance = finiteQueryNumber(ownValue(query, "maxDistance"), 0, "maxDistance", index, 0);
  const fieldletIndex = unsignedQueryInteger(ownValue(query, "fieldletIndex"), U32_MAX, "fieldletIndex", index);
  if (fieldletIndex !== U32_MAX && fieldletIndex >= fieldletCount) {
    throw new RangeError(
      `MorphField query ${index}: fieldletIndex ${fieldletIndex} is outside scene fieldlet count ${fieldletCount}`,
    );
  }
  const flags = unsignedQueryInteger(ownValue(query, "flags"), 0, "flags", index);
  const radius = finiteQueryNumber(
    aliasValue(query, "radius", "collisionRadius", index),
    0,
    "radius",
    index,
    0,
  );
  return Object.freeze({ kind, point, direction, maxDistance, fieldletIndex, flags, radius });
}

function positiveLimit(value, fallback) {
  const number = Math.floor(Number(value));
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function validateQueryBatch(count, resultOffset, limits) {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new RangeError("MorphField query: queryCount must be a positive safe integer");
  }
  const storageBindingLimit = positiveLimit(limits?.maxStorageBufferBindingSize, 128 * 1024 * 1024);
  const bufferLimit = positiveLimit(limits?.maxBufferSize, 256 * 1024 * 1024);
  const dispatchLimit = positiveLimit(limits?.maxComputeWorkgroupsPerDimension, 65535);
  const byteLength = count * QUERY_BYTES;
  const dispatchCount = Math.ceil(count / 64);
  if (!Number.isSafeInteger(byteLength) || byteLength > storageBindingLimit) {
    throw new RangeError(
      `MorphField query: ${count} records require ${byteLength} bytes, exceeding maxStorageBufferBindingSize ${storageBindingLimit}`,
    );
  }
  if (resultOffset > bufferLimit || byteLength > bufferLimit - resultOffset) {
    throw new RangeError(
      `MorphField query: result range ${resultOffset}..${resultOffset + byteLength} exceeds maxBufferSize ${bufferLimit}`,
    );
  }
  if (dispatchCount > dispatchLimit) {
    throw new RangeError(
      `MorphField query: ${dispatchCount} workgroups exceed maxComputeWorkgroupsPerDimension ${dispatchLimit}`,
    );
  }
  return Object.freeze({ byteLength, dispatchCount });
}

function validateBufferUsage(buffer, requiredUsage, label) {
  const usage = Number(buffer?.usage);
  // Raw GPUBuffer objects expose `usage`. Compatible forwarding facades may
  // omit it, in which case WebGPU validation remains authoritative.
  if (!Number.isFinite(usage)) return;
  if ((usage & requiredUsage) !== requiredUsage) {
    const names = [];
    if ((requiredUsage & bufferUsage("STORAGE")) !== 0) names.push("STORAGE");
    if ((requiredUsage & bufferUsage("COPY_SRC")) !== 0) names.push("COPY_SRC");
    if ((requiredUsage & bufferUsage("COPY_DST")) !== 0) names.push("COPY_DST");
    throw new TypeError(`MorphField query: ${label} must include GPUBufferUsage.${names.join("|")}`);
  }
}

function writeQueryRecords(queries, fieldletCount) {
  if (!Array.isArray(queries)) throw new TypeError("MorphField query: queries must be an array");
  const data = new Float32Array(Math.max(1, queries.length) * QUERY_FLOATS);
  const integers = new Uint32Array(data.buffer);
  queries.forEach((query, index) => {
    const normalized = validateQueryDescriptor(query, index, fieldletCount);
    const { point, direction } = normalized;
    const base = index * QUERY_FLOATS;
    data[base] = point[0];
    data[base + 1] = point[1];
    data[base + 2] = point[2];
    integers[base + 3] = normalized.kind;
    data[base + 4] = direction[0];
    data[base + 5] = direction[1];
    data[base + 6] = direction[2];
    data[base + 7] = normalized.maxDistance;
    integers[base + 8] = normalized.fieldletIndex;
    integers[base + 9] = normalized.flags;
    data[base + 10] = normalized.radius;
  });
  return data;
}

export class MorphFieldQueryEncoder {
  constructor({ device, tracker, capabilities, sceneBuffers, sceneStats, logger, asyncPipeline = false }) {
    this.device = device;
    this.tracker = tracker;
    this.capabilities = capabilities;
    this.sceneBuffers = sceneBuffers;
    this.sceneStats = sceneStats;
    this.logger = logger;
    this._inputBuffer = null;
    this._outputBuffer = null;
    this._inputCapacity = 0;
    this._outputCapacity = 0;
    this._batchesEncoded = 0;
    this._queriesEncoded = 0;
    this._bindGroup = null;
    this._bindGroupKey = null;
    this._bindGroupBuilds = 0;
    this._uniformData = new Uint32Array(4);
    this._destroyed = false;
    this._createPipeline(asyncPipeline);
  }

  encode({ encoder, queries, inputBuffer, resultBuffer, queryCount, resultOffset = 0 } = {}) {
    this._assertAlive();
    validateExternalEncoder(encoder);
    if (!this._pipeline) throw new Error("MorphField query pipeline is still initializing; await validateCompilation() before encode()");
    if (!Number.isSafeInteger(resultOffset) || resultOffset < 0
        || resultOffset % this.capabilities.limits.minStorageBufferOffsetAlignment !== 0) {
      throw new RangeError(`MorphField query: resultOffset must be aligned to ${this.capabilities.limits.minStorageBufferOffsetAlignment} bytes`);
    }
    const hasCpuQueries = queries != null;
    if (hasCpuQueries && !Array.isArray(queries)) {
      throw new TypeError("MorphField query: queries must be an array");
    }
    const count = hasCpuQueries ? queries.length : queryCount;
    const { byteLength, dispatchCount } = validateQueryBatch(count, resultOffset, this.capabilities.limits);
    const stats = this.sceneStats();
    const buffers = this.sceneBuffers();
    if (!buffers) throw new Error("MorphField query: setScene must be called before encoding queries");
    if (!Number.isInteger(stats?.fieldletCount) || stats.fieldletCount < 0 || stats.fieldletCount > U32_MAX) {
      throw new RangeError("MorphField query: scene fieldlet count must be a u32 integer");
    }
    const cpuData = hasCpuQueries ? writeQueryRecords(queries, stats.fieldletCount) : null;
    const input = inputBuffer || null;
    if (input && (!resultBuffer || input !== resultBuffer)) {
      validateBufferUsage(input, bufferUsage("COPY_SRC"), "inputBuffer");
    }
    if (input && Number.isFinite(Number(input.size)) && Number(input.size) < byteLength) {
      throw new RangeError("MorphField query: inputBuffer is too small");
    }
    if (resultBuffer) {
      validateBufferUsage(resultBuffer, bufferUsage("STORAGE"), "resultBuffer");
      if (cpuData || (input && input !== resultBuffer)) {
        validateBufferUsage(resultBuffer, bufferUsage("COPY_DST"), "resultBuffer");
      }
    }
    const output = resultBuffer || this._ensureOutput(byteLength);
    validateBufferUsage(output, bufferUsage("STORAGE"), "resultBuffer");
    if (cpuData || (input && input !== output)) {
      validateBufferUsage(output, bufferUsage("COPY_DST"), "resultBuffer");
    }
    if (Number.isFinite(Number(output.size)) && Number(output.size) < resultOffset + byteLength) {
      throw new RangeError("MorphField query: resultBuffer is too small");
    }
    if (cpuData) {
      this.device.queue.writeBuffer(output, resultOffset, cpuData);
    } else if (input && input !== output) {
      if (typeof encoder.copyBufferToBuffer !== "function") {
        throw new TypeError("MorphField query: external inputBuffer requires encoder.copyBufferToBuffer");
      }
      encoder.copyBufferToBuffer(input, 0, output, resultOffset, byteLength);
    }

    this._uniformData[0] = count;
    this._uniformData[1] = stats.fieldletCount;
    this._uniformData[2] = stats.revision;
    this._uniformData[3] = 0;
    this.device.queue.writeBuffer(this._uniformBuffer, 0, this._uniformData);
    const bindingSize = byteLength;
    const key = this._bindGroupKey;
    const reusable = key
      && key.fieldletHeaders === buffers.fieldletHeaders
      && key.payloads === buffers.payloads
      && key.resolvedCertificates === buffers.resolvedCertificates
      && key.materials === buffers.materials
      && key.programWords === buffers.programWords
      && key.analyticParameters === buffers.analyticParameters
      && key.spatialRecords === buffers.spatialRecords
      && key.output === output
      && key.resultOffset === resultOffset
      && key.bindingSize === bindingSize;
    if (!reusable) {
      this._bindGroup = this.device.createBindGroup({
        label: "MorphField.Query.BindGroup",
        layout: this._bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this._uniformBuffer } },
          { binding: 1, resource: { buffer: buffers.fieldletHeaders } },
          { binding: 2, resource: { buffer: buffers.payloads } },
          { binding: 3, resource: { buffer: buffers.resolvedCertificates } },
          { binding: 4, resource: { buffer: buffers.materials } },
          { binding: 5, resource: { buffer: buffers.programWords } },
          { binding: 6, resource: { buffer: buffers.analyticParameters } },
          { binding: 7, resource: { buffer: output, offset: resultOffset, size: bindingSize } },
          { binding: 8, resource: { buffer: buffers.spatialRecords } },
        ],
      });
      this._bindGroupKey = {
        fieldletHeaders: buffers.fieldletHeaders,
        payloads: buffers.payloads,
        resolvedCertificates: buffers.resolvedCertificates,
        materials: buffers.materials,
        programWords: buffers.programWords,
        analyticParameters: buffers.analyticParameters,
        spatialRecords: buffers.spatialRecords,
        output,
        resultOffset,
        bindingSize,
      };
      this._bindGroupBuilds += 1;
    }
    const pass = encoder.beginComputePass({ label: "MorphField.Query" });
    pass.setPipeline(this._pipeline);
    pass.setBindGroup(0, this._bindGroup);
    pass.dispatchWorkgroups(dispatchCount);
    pass.end();
    this._batchesEncoded += 1;
    this._queriesEncoded += count;
    return Object.freeze({
      resultBuffer: output,
      resultOffset,
      count,
      byteLength,
      layout: MorphFieldQueryEncoder.layout,
    });
  }

  getStats() {
    return {
      traversal: "linear",
      batchesEncoded: this._batchesEncoded,
      queriesEncoded: this._queriesEncoded,
      ownedInputCapacity: this._inputCapacity,
      ownedOutputCapacity: this._outputCapacity,
      bindGroupBuilds: this._bindGroupBuilds,
    };
  }

  async validateCompilation() {
    this._assertAlive();
    await this._pipelineReady;
    if (typeof this._shaderModule?.getCompilationInfo !== "function") return;
    const info = await this._shaderModule.getCompilationInfo();
    const errors = (info.messages || []).filter(message => message.type === "error");
    if (errors.length) {
      throw new Error(`MorphField query shader compilation failed:\n${errors.map(message => `${message.lineNum || 0}:${message.linePos || 0} ${message.message}`).join("\n")}`);
    }
  }

  destroy() {
    if (this._destroyed) return false;
    for (const resource of [this._inputBuffer, this._outputBuffer, this._uniformBuffer]) {
      if (resource) this.tracker.release(resource);
    }
    this._inputBuffer = null;
    this._outputBuffer = null;
    this._uniformBuffer = null;
    this._bindGroup = null;
    this._bindGroupKey = null;
    this._pipeline = null;
    this._destroyed = true;
    return true;
  }

  _createPipeline(asyncPipeline) {
    const visibility = shaderStages("COMPUTE");
    this._bindGroupLayout = this.tracker.own(this.device.createBindGroupLayout({
      label: "MorphField.Query.BindGroupLayout",
      entries: [
        { binding: 0, visibility, buffer: { type: "uniform" } },
        ...Array.from({ length: 6 }, (_, index) => ({ binding: index + 1, visibility, buffer: { type: "read-only-storage" } })),
        { binding: 7, visibility, buffer: { type: "storage" } },
        { binding: 8, visibility, buffer: { type: "read-only-storage" } },
      ],
    }), { kind: "pipeline-layout", label: "query-bind-group-layout" });
    const layout = this.tracker.own(this.device.createPipelineLayout({
      label: "MorphField.Query.PipelineLayout",
      bindGroupLayouts: [this._bindGroupLayout],
    }), { kind: "pipeline-layout", label: "query-pipeline-layout" });
    const module = this.tracker.own(this.device.createShaderModule({
      label: "MorphField.Query.Linear.Shader",
      code: QUERY_LINEAR_SHADER_WGSL,
    }), { kind: "shader", label: "query-linear-shader" });
    this._shaderModule = module;
    const descriptor = {
      label: "MorphField.Query.Linear.Pipeline",
      layout,
      compute: { module, entryPoint: "main" },
    };
    if (asyncPipeline && typeof this.device.createComputePipelineAsync === "function") {
      this._pipeline = null;
      this._pipelineReady = Promise.resolve(this.device.createComputePipelineAsync(descriptor)).then((pipeline) => {
        this._pipeline = this.tracker.own(pipeline, { kind: "pipeline", label: "query-linear-pipeline" });
      });
    } else {
      this._pipeline = this.tracker.own(this.device.createComputePipeline(descriptor), { kind: "pipeline", label: "query-linear-pipeline" });
      this._pipelineReady = Promise.resolve();
    }
    this._uniformBuffer = this.tracker.own(this.device.createBuffer({
      label: "MorphField.Query.Uniforms",
      size: 16,
      usage: bufferUsage("UNIFORM", "COPY_DST"),
    }), { kind: "uniform-buffer", label: "query-uniforms", bytes: 16 });
  }

  _ensureInput(byteLength) {
    if (this._inputCapacity >= byteLength && this._inputBuffer) return this._inputBuffer;
    const capacity = align4(byteLength);
    const replacement = this.tracker.own(this.device.createBuffer({
      label: "MorphField.Query.Input",
      size: capacity,
      usage: bufferUsage("STORAGE", "COPY_DST"),
    }), { kind: "query-buffer", label: "query-input", bytes: capacity });
    const previous = this._inputBuffer;
    this._inputBuffer = replacement;
    this._inputCapacity = capacity;
    if (previous) this.tracker.release(previous);
    return replacement;
  }

  _ensureOutput(byteLength) {
    if (this._outputCapacity >= byteLength && this._outputBuffer) return this._outputBuffer;
    const capacity = align4(byteLength);
    const replacement = this.tracker.own(this.device.createBuffer({
      label: "MorphField.Query.Output",
      size: capacity,
      usage: bufferUsage("STORAGE", "COPY_SRC", "COPY_DST"),
    }), { kind: "query-buffer", label: "query-output", bytes: capacity });
    const previous = this._outputBuffer;
    this._outputBuffer = replacement;
    this._outputCapacity = capacity;
    if (previous) this.tracker.release(previous);
    return replacement;
  }

  _assertAlive() {
    if (this._destroyed) throw new Error("MorphField query encoder has been destroyed");
  }

  static get layout() {
    return Object.freeze({
      inputStrideBytes: QUERY_BYTES,
      outputStrideBytes: QUERY_BYTES,
      input: Object.freeze({ pointAndKind: 0, directionAndDistance: 16, selectionAndFlags: 32, userData: 48 }),
      collisionInput: Object.freeze({ point: 0, kind: 12, fieldletIndex: 32, flags: 36, radius: 40 }),
      output: Object.freeze({ valueAndNormal: 0, baseColor: 16, materialParameters: 32, identifiers: 48 }),
      collisionOutput: Object.freeze({
        distance: 0,
        normal: 4,
        contact: 16,
        supported: 20,
        restOffset: 24,
        fieldValueErrorMax: 32,
        lipschitzMax: 36,
        contactOffset: 40,
        penetration: 44,
        materialIndex: 48,
        fieldletIndex: 52,
        layer: 56,
        mask: 60,
      }),
      kinds: QUERY_KIND,
    });
  }
}
