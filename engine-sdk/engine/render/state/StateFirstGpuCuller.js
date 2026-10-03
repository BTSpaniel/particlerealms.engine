// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

const WORKGROUP_SIZE = 256;
const DRAW_INDIRECT_STRIDE = 16;
const DRAW_INDIRECT_CLASS_COUNT = 2;
const GPU_CULL_PARAMS_SIZE = 160;
const COUNTER_COUNT = 9;
const COUNTER_BYTES = COUNTER_COUNT * Uint32Array.BYTES_PER_ELEMENT;

const STATE_FIRST_GPU_CULL_WGSL = `
struct Params {
  mvp: mat4x4f,
  count: u32,
  vertexCount: u32,
  firstInstanceBase: u32,
  entityStrideVec4: u32,
  viewportHeight: f32,
  viewportWidth: f32,
  nearZ: f32,
  farZ: f32,
  cameraPos: vec3f,
  facingThreshold: f32,
  enableFacingCull: u32,
  enableHiZ: u32,
  hiZMipCount: u32,
  hiZBias: f32,
  useCandidateIndices: u32,
  representation: u32,
  enableLodMembership: u32,
  dispatchGroupsX: u32,
  enableRenderClassCompaction: u32,
  renderClassThreshold: f32,
  outputCapacity: u32,
  _pad0: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> entityWords: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> visibleIndices: array<u32>;
@group(0) @binding(3) var<storage, read_write> counters: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> indirectArgs: array<u32>;
@group(0) @binding(5) var<storage, read> metadata: array<vec4f>;
@group(0) @binding(6) var hiZTexture: texture_2d<f32>;
@group(0) @binding(7) var<storage, read> candidateIndices: array<u32>;

@compute @workgroup_size(1)
fn reset() {
  for (var index = 0u; index < ${COUNTER_COUNT}u; index += 1u) { atomicStore(&counters[index], 0u); }
  indirectArgs[0] = params.vertexCount;
  indirectArgs[1] = 0u;
  indirectArgs[2] = 0u;
  indirectArgs[3] = params.firstInstanceBase;
  indirectArgs[4] = params.vertexCount;
  indirectArgs[5] = 0u;
  indirectArgs[6] = 0u;
  indirectArgs[7] = 0u;
}

fn bitReverse8(value: u32) -> u32 {
  var bits = value & 255u;
  bits = ((bits & 0x55u) << 1u) | ((bits >> 1u) & 0x55u);
  bits = ((bits & 0x33u) << 2u) | ((bits >> 2u) & 0x33u);
  bits = ((bits & 0x0fu) << 4u) | ((bits >> 4u) & 0x0fu);
  return bits & 255u;
}

fn stableLodRank(entityId: u32) -> f32 {
  let lane = entityId & 255u;
  let block = entityId >> 8u;
  var permutation = (block ^ 0x9e3779b9u) * 0x85ebca6bu;
  permutation = permutation ^ (permutation >> 16u);
  let rank = (bitReverse8(lane) ^ (permutation & 255u)) & 255u;
  return (f32(rank) + 0.5) / 256.0;
}

fn hiZMipLevel(pixelRadius: f32) -> i32 {
  let diameter = max(1.0, pixelRadius * 2.0);
  return clamp(i32(floor(log2(diameter))), 0, i32(max(1u, params.hiZMipCount)) - 1);
}

fn hiZMaxDepth(ndc: vec2f, pixelRadius: f32, level: i32) -> f32 {
  let dimensions = vec2i(textureDimensions(hiZTexture, level));
  let centerUv = ndc * vec2f(0.5, -0.5) + vec2f(0.5);
  let extentUv = vec2f(
    pixelRadius / max(1.0, params.viewportWidth),
    pixelRadius / max(1.0, params.viewportHeight)
  );
  let low = clamp(vec2i((centerUv - extentUv) * vec2f(dimensions)), vec2i(0), dimensions - vec2i(1));
  let high = clamp(vec2i((centerUv + extentUv) * vec2f(dimensions)), vec2i(0), dimensions - vec2i(1));
  let center = clamp(vec2i(centerUv * vec2f(dimensions)), vec2i(0), dimensions - vec2i(1));
  return max(textureLoad(hiZTexture, low, level).r,
    max(textureLoad(hiZTexture, vec2i(high.x, low.y), level).r,
    max(textureLoad(hiZTexture, center, level).r,
    max(textureLoad(hiZTexture, vec2i(low.x, high.y), level).r,
        textureLoad(hiZTexture, high, level).r))));
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn compact(@builtin(global_invocation_id) gid: vec3u) {
  let candidateIndex = gid.x + gid.y * max(1u, params.dispatchGroupsX) * ${WORKGROUP_SIZE}u;
  if (candidateIndex >= params.count) { return; }

  let stride = max(1u, params.entityStrideVec4);
  let index = select(candidateIndex, candidateIndices[candidateIndex], params.useCandidateIndices != 0u);
  if (params.enableLodMembership != 0u) {
    let lod = entityWords[index * stride + 2u];
    let fromMode = u32(lod.x + 0.5);
    let toMode = u32(lod.y + 0.5);
    if (fromMode != toMode) {
      let toSelected = stableLodRank(index) < clamp(lod.z, 0.0, 1.0);
      let selected = (params.representation == toMode && toSelected)
        || (params.representation == fromMode && !toSelected);
      if (!selected) { atomicAdd(&counters[4], 1u); return; }
    }
  }
  let position = entityWords[index * stride];
  let clip = params.mvp * vec4f(position.xyz, 1.0);
  if (clip.w <= params.nearZ) { atomicAdd(&counters[1], 1u); return; }

  let ndc = clip.xyz / clip.w;
  let radius = max(position.w, 0.0001);
  let pixelRadius = radius * params.viewportHeight * 0.5 / max(clip.w, 0.001);
  let padding = min(0.2, pixelRadius / max(1.0, params.viewportHeight));
  if (abs(ndc.x) > 1.0 + padding || abs(ndc.y) > 1.0 + padding || ndc.z < -padding || ndc.z > params.farZ) {
    atomicAdd(&counters[1], 1u);
    return;
  }

  if (params.enableHiZ != 0u) {
    atomicAdd(&counters[5], 1u);
    let cameraDelta = params.cameraPos - position.xyz;
    let nearestWorld = position.xyz + cameraDelta / max(length(cameraDelta), 0.0001) * radius;
    let nearestClip = params.mvp * vec4f(nearestWorld, 1.0);
    let nearestDepth = nearestClip.z / max(nearestClip.w, 0.001);
    let level = hiZMipLevel(pixelRadius);
    let conservativeBias = params.hiZBias * (1.0 + 0.35 * f32(level));
    if (nearestDepth > hiZMaxDepth(ndc.xy, pixelRadius, level) + conservativeBias) {
      atomicAdd(&counters[2], 1u);
      return;
    }
  }

  if (params.enableFacingCull != 0u) {
    let cone = metadata[index];
    let axisLength = length(cone.xyz);
    if (axisLength > 0.0001) {
      atomicAdd(&counters[6], 1u);
      let viewDirection = normalize(params.cameraPos - position.xyz);
      if (dot(cone.xyz / axisLength, viewDirection) + cone.w < params.facingThreshold) {
        atomicAdd(&counters[3], 1u);
        return;
      }
    }
  }

  let outputIndex = atomicAdd(&counters[0], 1u);
  if (params.enableRenderClassCompaction != 0u) {
    let material = entityWords[index * stride + 1u].w;
    if (material >= params.renderClassThreshold) {
      let classOutputIndex = atomicAdd(&counters[7], 1u);
      visibleIndices[classOutputIndex] = index;
    } else {
      // The sparse class grows down from the other end of the same allocation.
      // Since counters[7] + counters[8] never exceeds outputCapacity, the two
      // compacted lists cannot overlap and no second capacity-sized buffer is
      // needed merely to partition rendering work.
      let classOutputIndex = atomicAdd(&counters[8], 1u);
      visibleIndices[params.outputCapacity - 1u - classOutputIndex] = index;
    }
  } else {
    visibleIndices[outputIndex] = index;
  }
}

@compute @workgroup_size(1)
fn finalize() {
  if (params.enableRenderClassCompaction != 0u) {
    let class0Count = atomicLoad(&counters[7]);
    let class1Count = atomicLoad(&counters[8]);
    indirectArgs[1] = class0Count;
    indirectArgs[3] = 0u;
    indirectArgs[5] = class1Count;
    indirectArgs[7] = params.outputCapacity - class1Count;
  } else {
    indirectArgs[1] = atomicLoad(&counters[0]);
  }
}
`;

function readVec3(value) {
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return [value[0] || 0, value[1] || 0, value[2] || 0];
  if (value && typeof value === 'object') return [value.x || 0, value.y || 0, value.z || 0];
  return [0, 0, 0];
}

function adapterVisibleCapacity(device) {
  const storageLimit = Number(device?.limits?.maxStorageBufferBindingSize) || (128 * 1024 * 1024);
  const bufferLimit = Number(device?.limits?.maxBufferSize) || storageLimit;
  return Math.max(1, Math.floor(Math.min(storageLimit, bufferLimit) / 4));
}

export class StateFirstGpuCuller {
  constructor(device, options = {}) {
    this.device = device;
    this.maxCapacity = adapterVisibleCapacity(device);
    this.maxDispatchGroups = Math.max(1, Number(device?.limits?.maxComputeWorkgroupsPerDimension) || 65535);
    this.capacity = Math.min(this.maxCapacity, Math.max(1, options.capacity || 1));
    this.label = options.label || 'StateFirstGpuCuller';
    this.renderClassCompaction = options.renderClassCompaction === true;
    this.renderClassThreshold = Number.isFinite(Number(options.renderClassThreshold))
      ? Number(options.renderClassThreshold)
      : 3;
    this.paramsBuffer = null;
    this.visibleIndexBuffer = null;
    this.counterBuffer = null;
    this.indirectBuffer = null;
    this.metadataBuffer = null;
    this.fallbackMetadataBuffer = null;
    this.fallbackHiZTexture = null;
    this.fallbackHiZView = null;
    this.fallbackCandidateBuffer = null;
    this.pipelineReset = null;
    this.pipelineCompact = null;
    this.pipelineFinalize = null;
    this.bindGroupLayout = null;
    this.pipelineLayout = null;
    this.bindGroup = null;
    this.boundEntityBuffer = null;
    this.boundMetadataBuffer = null;
    this.boundHiZView = null;
    this.boundCandidateBuffer = null;
    this.metadataCapacity = 0;
    this.readbackSlots = [];
    this.readbackCursor = 0;
    this.lastEncodedCount = 0;
    this.lastCounters = Object.freeze({
      candidates: 0,
      visible: 0,
      frustumRejected: 0,
      hiZRejected: 0,
      facingRejected: 0,
      lodRejected: 0,
      hiZTested: 0,
      facingTested: 0,
      renderClass0Visible: 0,
      renderClass1Visible: 0,
      classPartitionResidual: 0,
      sampleSerial: 0,
    });
    this._params = new ArrayBuffer(GPU_CULL_PARAMS_SIZE);
    this._paramsF32 = new Float32Array(this._params);
    this._paramsU32 = new Uint32Array(this._params);
    this._metadataUpload = new Float32Array(Math.max(1, this.capacity) * 4);
    this._initialized = false;
  }

  init() {
    const module = this.device.createShaderModule({ label: `${this.label}.shader`, code: STATE_FIRST_GPU_CULL_WGSL });
    this.bindGroupLayout = this.device.createBindGroupLayout({
      label: `${this.label}.bindGroupLayout`,
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float', viewDimension: '2d' } },
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      ],
    });
    this.pipelineLayout = this.device.createPipelineLayout({ label: `${this.label}.pipelineLayout`, bindGroupLayouts: [this.bindGroupLayout] });
    this.pipelineReset = this.device.createComputePipeline({ label: `${this.label}.reset`, layout: this.pipelineLayout, compute: { module, entryPoint: 'reset' } });
    this.pipelineCompact = this.device.createComputePipeline({ label: `${this.label}.compact`, layout: this.pipelineLayout, compute: { module, entryPoint: 'compact' } });
    this.pipelineFinalize = this.device.createComputePipeline({ label: `${this.label}.finalize`, layout: this.pipelineLayout, compute: { module, entryPoint: 'finalize' } });
    this.paramsBuffer = this.device.createBuffer({ label: `${this.label}.params`, size: GPU_CULL_PARAMS_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.counterBuffer = this.device.createBuffer({ label: `${this.label}.counter`, size: COUNTER_BYTES, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    this.indirectBuffer = this.device.createBuffer({
      label: `${this.label}.indirect`,
      size: DRAW_INDIRECT_STRIDE * DRAW_INDIRECT_CLASS_COUNT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
    });
    this.fallbackMetadataBuffer = this.device.createBuffer({ label: `${this.label}.fallbackMetadata`, size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.fallbackHiZTexture = this.device.createTexture({
      label: `${this.label}.fallbackHiZ`, size: [1, 1, 1], format: 'r32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.fallbackHiZView = this.fallbackHiZTexture.createView();
    this.device.queue.writeTexture({ texture: this.fallbackHiZTexture }, new Float32Array([1]), {}, [1, 1, 1]);
    this.fallbackCandidateBuffer = this.device.createBuffer({ label: `${this.label}.fallbackCandidates`, size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.readbackSlots = Array.from({ length: 3 }, (_, index) => ({
      buffer: this.device.createBuffer({ label: `${this.label}.readback.${index}`, size: COUNTER_BYTES, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }),
      state: 'idle',
    }));
    this._ensureCapacity(this.capacity);
    this._initialized = true;
    return this;
  }

  _ensureCapacity(requiredCapacity) {
    if (this.visibleIndexBuffer && this.capacity >= requiredCapacity) return;
    if (requiredCapacity > this.maxCapacity) throw new RangeError(`${this.label} capacity ${requiredCapacity} exceeds adapter limit ${this.maxCapacity}`);
    while (this.capacity < requiredCapacity) this.capacity = Math.min(this.maxCapacity, this.capacity * 2);
    this.visibleIndexBuffer?.destroy();
    this.visibleIndexBuffer = this.device.createBuffer({
      label: `${this.label}.visibleIndices`, size: this.capacity * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.bindGroup = null;
  }

  _ensureMetadataCapacity(requiredCapacity) {
    if (this.metadataBuffer && this.metadataCapacity >= requiredCapacity) return;
    this.metadataCapacity = Math.max(1, requiredCapacity);
    this.metadataBuffer?.destroy();
    this.metadataBuffer = this.device.createBuffer({
      label: `${this.label}.metadata`, size: this.metadataCapacity * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.boundMetadataBuffer = null;
    this.bindGroup = null;
  }

  uploadFacingMetadata(entities, count = entities?.length || 0) {
    if (!this._initialized) this.init();
    const entryCount = Math.max(0, count | 0);
    this._ensureMetadataCapacity(Math.max(1, entryCount));
    if (this._metadataUpload.length < Math.max(1, entryCount) * 4) this._metadataUpload = new Float32Array(Math.max(1, entryCount) * 4);
    this._metadataUpload.fill(0, 0, Math.max(1, entryCount) * 4);
    for (let index = 0; index < entryCount; index += 1) {
      const entity = entities?.[index] || {};
      const cone = entity.normalCone || entity.cone;
      const source = cone?.axis || cone?.normal || cone?.direction || entity.normal || entity.viewNormal || entity.forward || entity.facing;
      const axis = readVec3(source);
      const angle = cone?.angleRadians ?? cone?.angle ?? null;
      const offset = index * 4;
      this._metadataUpload[offset] = axis[0];
      this._metadataUpload[offset + 1] = axis[1];
      this._metadataUpload[offset + 2] = axis[2];
      this._metadataUpload[offset + 3] = cone?.sinAngle ?? (angle != null ? Math.sin(angle) : 0);
    }
    this.device.queue.writeBuffer(this.metadataBuffer, 0, this._metadataUpload.subarray(0, Math.max(1, entryCount) * 4));
    return this.metadataBuffer;
  }

  _ensureBindGroup(entityBuffer, metadataBuffer = null, hiZView = null, candidateBuffer = null) {
    const resolvedMetadata = metadataBuffer || this.fallbackMetadataBuffer;
    const resolvedHiZ = hiZView || this.fallbackHiZView;
    const resolvedCandidates = candidateBuffer || this.fallbackCandidateBuffer;
    if (this.bindGroup && this.boundEntityBuffer === entityBuffer && this.boundMetadataBuffer === resolvedMetadata && this.boundHiZView === resolvedHiZ && this.boundCandidateBuffer === resolvedCandidates) return;
    this.boundEntityBuffer = entityBuffer;
    this.boundMetadataBuffer = resolvedMetadata;
    this.boundHiZView = resolvedHiZ;
    this.boundCandidateBuffer = resolvedCandidates;
    this.bindGroup = this.device.createBindGroup({
      label: `${this.label}.bindGroup`, layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuffer } },
        { binding: 1, resource: { buffer: entityBuffer } },
        { binding: 2, resource: { buffer: this.visibleIndexBuffer } },
        { binding: 3, resource: { buffer: this.counterBuffer } },
        { binding: 4, resource: { buffer: this.indirectBuffer } },
        { binding: 5, resource: { buffer: resolvedMetadata } },
        { binding: 6, resource: resolvedHiZ },
        { binding: 7, resource: { buffer: resolvedCandidates } },
      ],
    });
  }

  encode(encoder, entityBuffer, options = {}) {
    if (!this._initialized) this.init();
    const count = Math.max(0, options.count | 0);
    this._ensureCapacity(Math.max(1, count));
    const metadataBuffer = options.metadataEntities ? this.uploadFacingMetadata(options.metadataEntities, count) : options.metadataBuffer;
    this._ensureBindGroup(entityBuffer, metadataBuffer, options.hiZTextureView, options.candidateIndexBuffer);

    this._paramsF32.fill(0);
    this._paramsF32.set(options.mvp, 0);
    this._paramsU32[16] = count;
    this._paramsU32[17] = Math.max(1, options.vertexCount | 0);
    this._paramsU32[18] = Math.max(0, options.firstInstanceBase | 0);
    this._paramsU32[19] = Math.max(1, options.entityStrideVec4 | 0);
    this._paramsF32[20] = options.viewportHeight || 1080;
    this._paramsF32[21] = options.viewportWidth || 1920;
    this._paramsF32[22] = options.nearZ ?? 0.001;
    this._paramsF32[23] = options.farZ ?? 1.05;
    const cameraPosition = readVec3(options.cameraPosition || options.cameraPos);
    this._paramsF32[24] = cameraPosition[0];
    this._paramsF32[25] = cameraPosition[1];
    this._paramsF32[26] = cameraPosition[2];
    this._paramsF32[27] = options.facingThreshold ?? -0.08;
    this._paramsU32[28] = (options.enableFacingCull && metadataBuffer) ? 1 : 0;
    this._paramsU32[29] = options.enableHiZ && options.hiZTextureView ? 1 : 0;
    this._paramsU32[30] = Math.max(1, options.hiZMipCount | 0);
    this._paramsF32[31] = options.hiZBias ?? 0.0025;
    this._paramsU32[32] = options.candidateIndexBuffer ? 1 : 0;
    this._paramsU32[33] = Math.max(0, options.representation | 0);
    this._paramsU32[34] = options.enableLodMembership ? 1 : 0;
    const totalGroups = Math.max(1, Math.ceil(count / WORKGROUP_SIZE));
    const dispatchGroupsX = Math.min(this.maxDispatchGroups, totalGroups);
    const dispatchGroupsY = Math.ceil(totalGroups / dispatchGroupsX);
    if (dispatchGroupsY > this.maxDispatchGroups) {
      throw new RangeError(`${this.label} dispatch ${dispatchGroupsX}×${dispatchGroupsY} exceeds adapter limit ${this.maxDispatchGroups}`);
    }
    this._paramsU32[35] = dispatchGroupsX;
    this._paramsU32[36] = this.renderClassCompaction ? 1 : 0;
    this._paramsF32[37] = this.renderClassThreshold;
    this._paramsU32[38] = this.capacity;
    this.lastEncodedCount = count;
    this.device.queue.writeBuffer(this.paramsBuffer, 0, this._params);

    const pass = encoder.beginComputePass({
      label: `${this.label}.pass`,
      ...(options.timestampWrites ? { timestampWrites: options.timestampWrites } : {}),
    });
    pass.setBindGroup(0, this.bindGroup);
    pass.setPipeline(this.pipelineReset);
    pass.dispatchWorkgroups(1);
    if (count > 0) {
      pass.setPipeline(this.pipelineCompact);
      pass.dispatchWorkgroups(dispatchGroupsX, dispatchGroupsY);
    }
    pass.setPipeline(this.pipelineFinalize);
    pass.dispatchWorkgroups(1);
    pass.end();
  }

  encodeReadback(encoder, sampleSerial = 0) {
    for (let attempt = 0; attempt < this.readbackSlots.length; attempt += 1) {
      const index = (this.readbackCursor + attempt) % this.readbackSlots.length;
      const slot = this.readbackSlots[index];
      if (slot.state !== 'idle') continue;
      encoder.copyBufferToBuffer(this.counterBuffer, 0, slot.buffer, 0, COUNTER_BYTES);
      slot.state = 'encoded';
      slot.candidateCount = this.lastEncodedCount;
      slot.sampleSerial = Math.max(0, sampleSerial | 0);
      this.readbackCursor = (index + 1) % this.readbackSlots.length;
      return index;
    }
    return -1;
  }

  resolveReadback(index) {
    const slot = this.readbackSlots[index];
    if (!slot || slot.state !== 'encoded') return Promise.resolve(this.lastCounters);
    slot.state = 'mapping';
    return slot.buffer.mapAsync(GPUMapMode.READ).then(() => {
      const values = new Uint32Array(slot.buffer.getMappedRange(0, COUNTER_BYTES)).slice();
      slot.buffer.unmap();
      this.lastCounters = Object.freeze({
        candidates: slot.candidateCount || 0,
        visible: values[0],
        frustumRejected: values[1],
        hiZRejected: values[2],
        facingRejected: values[3],
        lodRejected: values[4],
        hiZTested: values[5],
        facingTested: values[6],
        renderClass0Visible: this.renderClassCompaction ? values[7] : values[0],
        renderClass1Visible: this.renderClassCompaction ? values[8] : 0,
        classPartitionResidual: this.renderClassCompaction
          ? values[0] - values[7] - values[8]
          : 0,
        sampleSerial: slot.sampleSerial || 0,
      });
      return this.lastCounters;
    }).catch(() => this.lastCounters).finally(() => { slot.state = 'idle'; });
  }

  getVisibleIndexBuffer() { return this.visibleIndexBuffer; }
  getIndirectBuffer() { return this.indirectBuffer; }
  getIndirectOffset(renderClass = 0) {
    if (!this.renderClassCompaction) return 0;
    return Math.max(0, Math.min(DRAW_INDIRECT_CLASS_COUNT - 1, renderClass | 0)) * DRAW_INDIRECT_STRIDE;
  }
  getLastCounters() { return this.lastCounters; }

  destroy() {
    this.paramsBuffer?.destroy();
    this.visibleIndexBuffer?.destroy();
    this.counterBuffer?.destroy();
    this.indirectBuffer?.destroy();
    this.metadataBuffer?.destroy();
    this.fallbackMetadataBuffer?.destroy();
    this.fallbackHiZTexture?.destroy();
    this.fallbackCandidateBuffer?.destroy();
    for (const slot of this.readbackSlots) { try { slot.buffer.unmap(); } catch (_) {} try { slot.buffer.destroy(); } catch (_) {} }
    this.readbackSlots = [];
    this.paramsBuffer = null;
    this.visibleIndexBuffer = null;
    this.counterBuffer = null;
    this.indirectBuffer = null;
    this.metadataBuffer = null;
    this.fallbackMetadataBuffer = null;
    this.fallbackHiZTexture = null;
    this.fallbackHiZView = null;
    this.fallbackCandidateBuffer = null;
    this.bindGroup = null;
    this.boundEntityBuffer = null;
    this.boundMetadataBuffer = null;
    this.boundHiZView = null;
    this.boundCandidateBuffer = null;
    this._initialized = false;
  }
}

export function createStateFirstGpuCuller(device, options) {
  return new StateFirstGpuCuller(device, options).init();
}
