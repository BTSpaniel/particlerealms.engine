// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
  countSetBits8,
  expandAffineCube,
  packNexelDescriptor,
} from '../systems/NexelMicrostructure.js';
import {
  bufferUsage,
  inspectNexelComputeCapabilities,
  shaderStages,
  validateBorrowedDevice,
  validateExternalEncoder,
} from './capabilities.js';
import { ResourceOwnershipTracker } from './ResourceOwnershipTracker.js';
import { NEXEL_MICROSTRUCTURE_SHADER_WGSL } from './NexelMicrostructureShaders.js';
import {
  NEXEL_FRAME_UNIFORM_BYTES as FRAME_UNIFORM_BYTES,
  assertNexelShaderCompiles as assertShaderCompiles,
  checkedNexelU32 as u32,
  clampNexelNumber as clamp,
  createNexelOverlayPassDescriptor,
  finiteNexelNumber as finite,
  finiteNexelVector as finiteVector,
  nextNexelCapacity as nextCapacity,
  packNexelRgba8 as rgba8,
  writeNexelFrameUniforms,
} from './NexelPresentationRuntime.js';

const RECORD_STRIDE_BYTES = 32;
const SAMPLES_PER_NEXEL = 8;

/**
 * A borrowed-device, external-encoder renderer. Each 32-byte parent Nexel is
 * decoded directly in WGSL into at most eight render-only samples.
 */
export class NexelMicrostructureRenderer {
  constructor(options = {}) {
    this.device = validateBorrowedDevice(options.device);
    this.colorFormat = options.colorFormat || 'bgra8unorm';
    this.depthFormat = options.depthFormat === null ? null : (options.depthFormat || 'depth32float');
    this.tracker = new ResourceOwnershipTracker('NexelMicrostructure');
    const limits = this.device.limits || {};
    const storageLimit = Math.min(
      finite(limits.maxStorageBufferBindingSize, 128 * 1024 * 1024),
      finite(limits.maxBufferSize, 256 * 1024 * 1024),
    );
    this.maximumRecords = Math.max(1, Math.floor(storageLimit / RECORD_STRIDE_BYTES));
    this.capabilities = inspectNexelComputeCapabilities(this.device, options);
    this.recordCount = 0;
    this.activeSampleCount = 0;
    this.diagnosticErrorCount = 0;
    this.capacity = 0;
    this.recordBuffer = null;
    this.bindGroup = null;
    this.smoothedQuality = 1;
    this.targetQuality = 1;
    this.frameCount = 0;
    this._destroyed = false;
    this._uniformData = new Float32Array(FRAME_UNIFORM_BYTES / 4);
    this.uniformBuffer = this.tracker.own(this.device.createBuffer({
      label: 'NexelMicrostructure.FrameUniforms',
      size: FRAME_UNIFORM_BYTES,
      usage: bufferUsage('UNIFORM', 'COPY_DST'),
    }), { kind: 'buffer', label: 'frame-uniforms', bytes: FRAME_UNIFORM_BYTES });
  }

  static async create(options = {}) {
    const renderer = new NexelMicrostructureRenderer(options);
    try {
      await renderer._initialize();
      renderer._ensureCapacity(1);
      return renderer;
    } catch (error) {
      renderer.destroy();
      throw error;
    }
  }

  async _initialize() {
    const visibility = shaderStages('VERTEX', 'FRAGMENT');
    this.bindGroupLayout = this.tracker.own(this.device.createBindGroupLayout({
      label: 'NexelMicrostructure.BindGroupLayout',
      entries: [
        { binding: 0, visibility, buffer: { type: 'uniform' } },
        { binding: 1, visibility: shaderStages('VERTEX'), buffer: { type: 'read-only-storage' } },
      ],
    }), { kind: 'bind-group-layout', label: 'main' });
    this.pipelineLayout = this.tracker.own(this.device.createPipelineLayout({
      label: 'NexelMicrostructure.PipelineLayout',
      bindGroupLayouts: [this.bindGroupLayout],
    }), { kind: 'pipeline-layout', label: 'main' });
    this.shaderModule = this.tracker.own(this.device.createShaderModule({
      label: 'NexelMicrostructure.DirectDecodeShader',
      code: NEXEL_MICROSTRUCTURE_SHADER_WGSL,
    }), { kind: 'shader', label: 'direct-decode' });
    await assertShaderCompiles(this.shaderModule, 'Nexel microstructure');
    const descriptor = {
      label: 'NexelMicrostructure.Pipeline',
      layout: this.pipelineLayout,
      vertex: { module: this.shaderModule, entryPoint: 'vertexMain' },
      fragment: {
        module: this.shaderModule,
        entryPoint: 'fragmentMain',
        targets: [{
          format: this.colorFormat,
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      ...(this.depthFormat ? {
        depthStencil: { format: this.depthFormat, depthWriteEnabled: false, depthCompare: 'less-equal' },
      } : {}),
    };
    this.pipeline = this.tracker.own(
      typeof this.device.createRenderPipelineAsync === 'function'
        ? await this.device.createRenderPipelineAsync(descriptor)
        : this.device.createRenderPipeline(descriptor),
      { kind: 'pipeline', label: 'direct-decode' },
    );
  }

  _assertAlive() {
    if (this._destroyed) throw new Error('Nexel microstructure renderer is destroyed');
  }

  _ensureCapacity(required) {
    this._assertAlive();
    if (required <= this.capacity) return false;
    if (required > this.maximumRecords) {
      throw new RangeError(`Nexel microstructure record count ${required} exceeds adapter limit ${this.maximumRecords}`);
    }
    const capacity = nextCapacity(required, this.maximumRecords);
    let next = null;
    let nextBindGroup = null;
    try {
      next = this.tracker.own(this.device.createBuffer({
        label: `NexelMicrostructure.Records.${capacity}`,
        size: capacity * RECORD_STRIDE_BYTES,
        usage: bufferUsage('STORAGE', 'COPY_DST'),
      }), { kind: 'buffer', label: 'records', bytes: capacity * RECORD_STRIDE_BYTES });
      nextBindGroup = this.device.createBindGroup({
        label: 'NexelMicrostructure.BindGroup',
        layout: this.bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer } },
          { binding: 1, resource: { buffer: next } },
        ],
      });
    } catch (error) {
      if (next) this.tracker.release(next);
      throw error;
    }
    const previous = this.recordBuffer;
    this.recordBuffer = next;
    this.bindGroup = nextBindGroup;
    this.capacity = capacity;
    if (previous) this.tracker.release(previous);
    return true;
  }

  setRecords(records) {
    this._assertAlive();
    if (!Array.isArray(records)) throw new TypeError('Nexel microstructure records must be an array');
    if (records.length > this.maximumRecords) {
      throw new RangeError(`Nexel microstructure record count ${records.length} exceeds adapter limit ${this.maximumRecords}`);
    }
    const payload = new ArrayBuffer(records.length * RECORD_STRIDE_BYTES);
    const floats = new Float32Array(payload);
    const integers = new Uint32Array(payload);
    let activeSamples = 0;
    let diagnosticErrors = 0;
    records.forEach((record, index) => {
      if (!record || typeof record !== 'object') throw new TypeError(`Nexel microstructure record ${index} is invalid`);
      const origin = finiteVector(record.origin || record.position, 3, `Nexel record ${index} origin`);
      const scale = finite(record.scale, 0);
      if (!(scale > 0)) throw new RangeError(`Nexel record ${index} scale must be positive and finite`);
      const descriptor = record.descriptor !== undefined
        ? u32(record.descriptor, `Nexel record ${index} descriptor`)
        : packNexelDescriptor(record);
      const morphology = (descriptor >>> 21) & 0x0f;
      const flags = (descriptor >>> 30) & 0x03;
      const base = index * 8;
      floats[base] = origin[0];
      floats[base + 1] = origin[1];
      floats[base + 2] = origin[2];
      floats[base + 3] = scale;
      integers[base + 4] = descriptor;
      integers[base + 5] = rgba8(record.color);
      const seed = record.seed === undefined
        ? index >>> 0
        : u32(record.seed, `Nexel record ${index} seed`);
      integers[base + 6] = seed;
      integers[base + 7] = record.parentId === undefined
        ? index >>> 0
        : u32(record.parentId, `Nexel record ${index} parentId`);
      let occupancy = expandAffineCube(morphology);
      if ((flags & 1) !== 0) occupancy ^= 1 << (seed & 7);
      activeSamples += countSetBits8(occupancy);
      diagnosticErrors += (flags & 1) !== 0 ? 1 : 0;
    });
    this._ensureCapacity(Math.max(1, records.length));
    if (payload.byteLength > 0) this.device.queue.writeBuffer(this.recordBuffer, 0, payload);
    this.recordCount = records.length;
    this.activeSampleCount = activeSamples;
    this.diagnosticErrorCount = diagnosticErrors;
    return this.getStats();
  }

  encode({
    encoder,
    target,
    camera,
    viewport,
    time = 0,
    deltaTime = 1 / 60,
    quality = 1,
    opacity = 1,
  } = {}) {
    this._assertAlive();
    validateExternalEncoder(encoder);
    if (!target?.colorView) throw new TypeError('NexelMicrostructure.encode requires target.colorView');
    if (this.depthFormat && !target.depthView) throw new TypeError('NexelMicrostructure.encode requires target.depthView');
    if (this.recordCount === 0) return this.getStats();
    const dt = clamp(finite(deltaTime, 1 / 60) > 1 ? finite(deltaTime) / 1000 : finite(deltaTime, 1 / 60), 0, 0.25);
    this.targetQuality = clamp(finite(quality, 1), 0.18, 1.35);
    const response = 1 - Math.exp(-dt / 0.22);
    this.smoothedQuality += (this.targetQuality - this.smoothedQuality) * response;
    const { width, height } = writeNexelFrameUniforms(this._uniformData, {
      camera,
      viewport,
      time,
      frameCount: this.frameCount,
      quality: this.smoothedQuality,
      pointGain: 0.036,
      projectionScale: 0.48,
      opacity,
    });
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this._uniformData);
    const passDescriptor = createNexelOverlayPassDescriptor(
      'NexelMicrostructure.DirectDecodePass',
      target,
      this.depthFormat,
    );
    const pass = encoder.beginRenderPass(passDescriptor);
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setViewport(0, 0, width, height, 0, 1);
    pass.draw(6, this.recordCount * SAMPLES_PER_NEXEL, 0, 0);
    pass.end();
    this.frameCount += 1;
    return this.getStats();
  }

  getStats() {
    return Object.freeze({
      records: this.recordCount,
      logicalSamples: this.recordCount * SAMPLES_PER_NEXEL,
      drawInstanceSlots: this.recordCount * SAMPLES_PER_NEXEL,
      decodedOccupiedSamples: this.activeSampleCount,
      occupiedSamples: this.activeSampleCount,
      diagnosticErrors: this.diagnosticErrorCount,
      capacity: this.capacity,
      maximumRecords: this.maximumRecords,
      residentBytes: this.capacity * RECORD_STRIDE_BYTES + FRAME_UNIFORM_BYTES,
      recordStrideBytes: RECORD_STRIDE_BYTES,
      smoothedQuality: this.smoothedQuality,
      targetQuality: this.targetQuality,
      capabilities: this.capabilities,
      ownership: this.tracker.getStats(),
      submissionOwner: 'host',
      decodePath: 'portable-u32-rm13',
      metadataUsage: 'morton-cpu-locality-flags-gpu-diagnostics-other-fields-reserved',
      compositePath: 'host-final-premultiplied-overlay',
    });
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.bindGroup = null;
    this.recordBuffer = null;
    this.tracker.destroyAll();
  }
}

export function createNexelMicrostructureRenderer(options) {
  return NexelMicrostructureRenderer.create(options);
}

export default NexelMicrostructureRenderer;
