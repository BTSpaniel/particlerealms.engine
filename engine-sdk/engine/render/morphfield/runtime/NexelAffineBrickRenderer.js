// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { verifyAffineNexelBrick } from '../systems/NexelMicrostructure.js';
import {
  bufferUsage,
  inspectNexelComputeCapabilities,
  shaderStages,
  validateBorrowedDevice,
  validateExternalEncoder,
} from './capabilities.js';
import { NEXEL_AFFINE_BRICK_SHADER_WGSL } from './NexelAffineBrickShaders.js';
import {
  NEXEL_FRAME_UNIFORM_BYTES,
  assertNexelShaderCompiles,
  checkedNexelU32,
  clampNexelNumber,
  createNexelOverlayPassDescriptor,
  finiteNexelNumber,
  finiteNexelVector,
  nextNexelCapacity,
  packNexelRgba8,
  writeNexelFrameUniforms,
} from './NexelPresentationRuntime.js';
import { ResourceOwnershipTracker } from './ResourceOwnershipTracker.js';

const BRICK_RECORD_STRIDE_BYTES = 64;
const AFFINE_PAYLOAD_BYTES = 32;
const MICRO_CUBES_PER_BRICK = 64;
const SAMPLES_PER_MICRO_CUBE = 8;
const SAMPLES_PER_BRICK = MICRO_CUBES_PER_BRICK * SAMPLES_PER_MICRO_CUBE;

function morphologyWeight(code) {
  if (code === 0) return 0;
  if (code === 1) return 8;
  return 4;
}

function snapshotAffineBrick(brick) {
  if (!brick || typeof brick !== 'object') throw new TypeError('Affine Nexel brick is required');
  const payload = brick.payload;
  const faces = brick.faceSignatures;
  const neighbors = brick.neighborGenerations;
  return {
    mode: brick.mode,
    origin: Array.from(brick.origin || []),
    scale: brick.scale,
    generation: brick.generation,
    payload: payload instanceof Uint32Array ? payload.slice() : payload,
    payloadBytes: brick.payloadBytes,
    payloadCrc32: brick.payloadCrc32,
    crc32: brick.crc32,
    faceSignatures: faces instanceof Uint32Array ? faces.slice() : faces,
    neighborGenerations: neighbors instanceof Uint32Array ? neighbors.slice() : neighbors,
    integrityScope: brick.integrityScope,
  };
}

/**
 * Directly expands 32-byte AFFINE4 morphology payloads into render-only cells.
 * Simulation/collision remains attached to the authoritative MorphField scene.
 */
export class NexelAffineBrickRenderer {
  constructor(options = {}) {
    this.device = validateBorrowedDevice(options.device);
    this.colorFormat = options.colorFormat || 'bgra8unorm';
    this.depthFormat = options.depthFormat === null ? null : (options.depthFormat || 'depth32float');
    this.tracker = new ResourceOwnershipTracker('NexelAffineBrick');
    const limits = this.device.limits || {};
    const storageLimit = Math.min(
      finiteNexelNumber(limits.maxStorageBufferBindingSize, 128 * 1024 * 1024),
      finiteNexelNumber(limits.maxBufferSize, 256 * 1024 * 1024),
    );
    this.maximumBricks = Math.max(1, Math.min(
      Math.floor(storageLimit / BRICK_RECORD_STRIDE_BYTES),
      Math.floor(0xffffffff / SAMPLES_PER_BRICK),
    ));
    this.capabilities = inspectNexelComputeCapabilities(this.device, options);
    this.brickCount = 0;
    this.occupiedSamples = 0;
    this.capacity = 0;
    this.brickBuffer = null;
    this.bindGroup = null;
    this.smoothedQuality = 1;
    this.targetQuality = 1;
    this.frameCount = 0;
    this._destroyed = false;
    this._uniformData = new Float32Array(NEXEL_FRAME_UNIFORM_BYTES / 4);
    this.uniformBuffer = this.tracker.own(this.device.createBuffer({
      label: 'NexelAffineBrick.FrameUniforms',
      size: NEXEL_FRAME_UNIFORM_BYTES,
      usage: bufferUsage('UNIFORM', 'COPY_DST'),
    }), { kind: 'buffer', label: 'frame-uniforms', bytes: NEXEL_FRAME_UNIFORM_BYTES });
  }

  static async create(options = {}) {
    const renderer = new NexelAffineBrickRenderer(options);
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
      label: 'NexelAffineBrick.BindGroupLayout',
      entries: [
        { binding: 0, visibility, buffer: { type: 'uniform' } },
        { binding: 1, visibility: shaderStages('VERTEX'), buffer: { type: 'read-only-storage' } },
      ],
    }), { kind: 'bind-group-layout', label: 'main' });
    this.pipelineLayout = this.tracker.own(this.device.createPipelineLayout({
      label: 'NexelAffineBrick.PipelineLayout',
      bindGroupLayouts: [this.bindGroupLayout],
    }), { kind: 'pipeline-layout', label: 'main' });
    this.shaderModule = this.tracker.own(this.device.createShaderModule({
      label: 'NexelAffineBrick.DirectDecodeShader',
      code: NEXEL_AFFINE_BRICK_SHADER_WGSL,
    }), { kind: 'shader', label: 'direct-decode' });
    await assertNexelShaderCompiles(this.shaderModule, 'Nexel affine brick');
    const descriptor = {
      label: 'NexelAffineBrick.Pipeline',
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
    if (this._destroyed) throw new Error('Nexel affine brick renderer is destroyed');
  }

  _ensureCapacity(required) {
    this._assertAlive();
    if (required <= this.capacity) return false;
    if (required > this.maximumBricks) {
      throw new RangeError(`Nexel brick count ${required} exceeds adapter limit ${this.maximumBricks}`);
    }
    const capacity = nextNexelCapacity(required, this.maximumBricks);
    let next = null;
    let nextBindGroup = null;
    try {
      next = this.tracker.own(this.device.createBuffer({
        label: `NexelAffineBrick.Records.${capacity}`,
        size: capacity * BRICK_RECORD_STRIDE_BYTES,
        usage: bufferUsage('STORAGE', 'COPY_DST'),
      }), { kind: 'buffer', label: 'records', bytes: capacity * BRICK_RECORD_STRIDE_BYTES });
      nextBindGroup = this.device.createBindGroup({
        label: 'NexelAffineBrick.BindGroup',
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
    const previous = this.brickBuffer;
    this.brickBuffer = next;
    this.bindGroup = nextBindGroup;
    this.capacity = capacity;
    if (previous) this.tracker.release(previous);
    return true;
  }

  setBricks(entries) {
    this._assertAlive();
    if (!Array.isArray(entries)) throw new TypeError('Nexel affine brick entries must be an array');
    if (entries.length > this.maximumBricks) {
      throw new RangeError(`Nexel brick count ${entries.length} exceeds adapter limit ${this.maximumBricks}`);
    }
    const payload = new ArrayBuffer(entries.length * BRICK_RECORD_STRIDE_BYTES);
    const floats = new Float32Array(payload);
    const integers = new Uint32Array(payload);
    let occupiedSamples = 0;
    entries.forEach((entry, index) => {
      const brick = snapshotAffineBrick(entry?.brick || entry);
      const verification = verifyAffineNexelBrick(brick);
      if (!verification.valid) {
        throw new Error(`Nexel affine brick ${index} failed local integrity verification`);
      }
      const origin = finiteNexelVector(brick.origin, 3, `Nexel brick ${index} origin`);
      const scale = finiteNexelNumber(brick.scale, 0);
      if (!(scale > 0)) throw new RangeError(`Nexel brick ${index} scale must be positive and finite`);
      const packed = brick.payload;
      const base = index * 16;
      floats[base] = origin[0];
      floats[base + 1] = origin[1];
      floats[base + 2] = origin[2];
      floats[base + 3] = scale;
      for (let word = 0; word < 8; word += 1) integers[base + 4 + word] = packed[word];
      integers[base + 12] = packNexelRgba8(entry?.color);
      integers[base + 13] = entry?.seed === undefined
        ? index >>> 0
        : checkedNexelU32(entry.seed, `Nexel brick ${index} seed`);
      integers[base + 14] = brick.generation >>> 0;
      integers[base + 15] = brick.crc32 >>> 0;
      for (let micro = 0; micro < MICRO_CUBES_PER_BRICK; micro += 1) {
        const morphology = (packed[micro >>> 3] >>> ((micro & 7) * 4)) & 0x0f;
        occupiedSamples += morphologyWeight(morphology);
      }
    });
    this._ensureCapacity(Math.max(1, entries.length));
    if (payload.byteLength > 0) this.device.queue.writeBuffer(this.brickBuffer, 0, payload);
    this.brickCount = entries.length;
    this.occupiedSamples = occupiedSamples;
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
    if (this.brickCount === 0) return this.getStats();
    const rawDelta = finiteNexelNumber(deltaTime, 1 / 60);
    const dt = clampNexelNumber(rawDelta > 1 ? rawDelta / 1000 : rawDelta, 0, 0.25);
    this.targetQuality = clampNexelNumber(finiteNexelNumber(quality, 1), 0.18, 1.35);
    const response = 1 - Math.exp(-dt / 0.22);
    this.smoothedQuality += (this.targetQuality - this.smoothedQuality) * response;
    const { width, height } = writeNexelFrameUniforms(this._uniformData, {
      camera,
      viewport,
      time,
      frameCount: this.frameCount,
      quality: this.smoothedQuality,
      pointGain: 0.028,
      projectionScale: 0.5,
      opacity,
    });
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this._uniformData);
    const pass = encoder.beginRenderPass(createNexelOverlayPassDescriptor(
      'NexelAffineBrick.DirectDecodePass',
      target,
      this.depthFormat,
    ));
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setViewport(0, 0, width, height, 0, 1);
    pass.draw(6, this.brickCount * SAMPLES_PER_BRICK, 0, 0);
    pass.end();
    this.frameCount += 1;
    return this.getStats();
  }

  getStats() {
    return Object.freeze({
      bricks: this.brickCount,
      microCubes: this.brickCount * MICRO_CUBES_PER_BRICK,
      logicalSamples: this.brickCount * SAMPLES_PER_BRICK,
      occupiedSamples: this.occupiedSamples,
      morphologyPayloadBytes: this.brickCount * AFFINE_PAYLOAD_BYTES,
      residentBytes: this.capacity * BRICK_RECORD_STRIDE_BYTES + NEXEL_FRAME_UNIFORM_BYTES,
      recordStrideBytes: BRICK_RECORD_STRIDE_BYTES,
      capacity: this.capacity,
      maximumBricks: this.maximumBricks,
      smoothedQuality: this.smoothedQuality,
      targetQuality: this.targetQuality,
      capabilities: this.capabilities,
      ownership: this.tracker.getStats(),
      submissionOwner: 'host',
      decodePath: 'portable-u32-rm13-affine4-brick',
      integrity: 'crc32-local-not-authenticated',
      metadataUsage: 'generation-and-crc-cpu-upload-validation',
      compositePath: 'host-final-premultiplied-overlay',
    });
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.bindGroup = null;
    this.brickBuffer = null;
    this.tracker.destroyAll();
  }
}

export function createNexelAffineBrickRenderer(options) {
  return NexelAffineBrickRenderer.create(options);
}

export default NexelAffineBrickRenderer;
