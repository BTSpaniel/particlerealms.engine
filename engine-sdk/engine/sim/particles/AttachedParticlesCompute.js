// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createUniformBuffer, updateBuffer } from "../../core/gpu/GpuBuffer.js";
import { BindGroupSignals } from "../../core/gpu/BindingSignals.js";
import { labelResource } from "../../core/gpu/GpuDebug.js";
import { getGPUMemoryManager } from "../../core/memory/GPUMemoryManager.js";
import { getAttrOffsetFloats } from "./MeshToParticlesCompute.js";

const stateByDevice = new WeakMap();
const SHADER_VERSION = 1;

function createShaderCode(workgroupSize) {
  const wg = Math.max(1, Math.min(256, workgroupSize | 0));
  return /* wgsl */ `
struct Params {
  vertexStride: u32,
  posOffset: u32,
  triCount: u32,
  particleCount: u32,
}

struct Attachment {
  triIndex: u32,
  b: f32,
  c: f32,
  flags: u32,
}

@group(0) @binding(0) var<storage, read> vertexData : array<f32>;
@group(0) @binding(1) var<storage, read> indexData : array<u32>;
@group(0) @binding(2) var<storage, read> attachments : array<Attachment>;
@group(0) @binding(3) var<storage, read_write> outPositions : array<vec4<f32>>;
@group(0) @binding(4) var<uniform> params : Params;

fn readVec3(vidx: u32, offset: u32) -> vec3<f32> {
  let base = vidx * params.vertexStride + offset;
  return vec3<f32>(
    vertexData[base + 0u],
    vertexData[base + 1u],
    vertexData[base + 2u],
  );
}

@compute @workgroup_size(${wg})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.particleCount) {
    return;
  }

  let att = attachments[idx];
  if (att.flags == 0u) {
    return;
  }

  let triIndex = att.triIndex;
  if (triIndex >= params.triCount) {
    return;
  }

  let base = triIndex * 3u;
  let i0 = indexData[base + 0u];
  let i1 = indexData[base + 1u];
  let i2 = indexData[base + 2u];

  let b = att.b;
  let c = att.c;
  let a = 1.0 - b - c;

  let p0 = readVec3(i0, params.posOffset);
  let p1 = readVec3(i1, params.posOffset);
  let p2 = readVec3(i2, params.posOffset);

  let pos = p0 * a + p1 * b + p2 * c;

  let age = outPositions[idx].w;
  outPositions[idx] = vec4<f32>(pos, age);
}
`;
}

async function getOrCreateState(device, options = {}) {
  let entry = stateByDevice.get(device);
  if (entry && entry.version === SHADER_VERSION) {
    return entry;
  }

  const workgroupSize =
    typeof options.workgroupSize === "number" && options.workgroupSize > 0
      ? options.workgroupSize | 0
      : 256;
  const shaderCode = createShaderCode(workgroupSize);

  const shaderModule = device.createShaderModule({
    label: "AttachedParticlesCompute.shader",
    code: shaderCode,
  });

  const pipeline = await device.createComputePipelineAsync({
    label: "AttachedParticlesCompute.pipeline",
    layout: "auto",
    compute: { module: shaderModule, entryPoint: "main" },
  });

  const paramsBuffer = createUniformBuffer(device, 16, {
    label: "AttachedParticlesCompute.params",
  });

  labelResource(paramsBuffer, "AttachedParticlesCompute.params");

  const paramsData = new Uint32Array(4);

  const gpu = getGPUMemoryManager(device);
  const externalGetBindGroup = gpu && gpu.bindGroupCache && typeof gpu.getBindGroup === "function" ? gpu.getBindGroup.bind(gpu) : null;

  entry = {
    version: SHADER_VERSION,
    pipeline,
    paramsBuffer,
    paramsData,
    bindGroups: new BindGroupSignals(
      device,
      pipeline.getBindGroupLayout(0),
      [
        { name: "vertexData", binding: 0 },
        { name: "indexData", binding: 1 },
        { name: "attachments", binding: 2 },
        { name: "outPositions", binding: 3 },
        { name: "params", binding: 4 },
      ],
      { label: "AttachedParticlesCompute.bindGroup", maxEntries: 2048, getBindGroup: externalGetBindGroup }
    ),
    workgroupSize,
  };

  stateByDevice.set(device, entry);
  return entry;
}

export async function updateAttachedParticlesIntoWorld(gpuDevice, meshBuffers, particleWorld, attachmentBuffer, options = {}) {
  if (!gpuDevice || typeof gpuDevice.getDevice !== "function") {
    throw new Error("updateAttachedParticlesIntoWorld: gpuDevice required");
  }
  const device = gpuDevice.getDevice();
  if (!device) throw new Error("updateAttachedParticlesIntoWorld: gpuDevice.getDevice() returned null");

  if (!meshBuffers || !meshBuffers.vertexBuffer || !meshBuffers.indexBuffer) {
    throw new Error("updateAttachedParticlesIntoWorld: meshBuffers with vertexBuffer/indexBuffer required");
  }
  if (!particleWorld || !particleWorld.positionBuffer) {
    throw new Error("updateAttachedParticlesIntoWorld: particleWorld.positionBuffer required");
  }
  if (!attachmentBuffer) {
    throw new Error("updateAttachedParticlesIntoWorld: attachmentBuffer required");
  }

  const state = await getOrCreateState(device, options);

  const triCount = typeof meshBuffers.triCount === "number" ? meshBuffers.triCount | 0 : 0;
  if (triCount <= 0) {
    return;
  }

  const attrs = meshBuffers.attributes || [];
  const stride = typeof meshBuffers.vertexStrideFloats === "number" ? meshBuffers.vertexStrideFloats | 0 : 0;
  if (stride <= 0) throw new Error("updateAttachedParticlesIntoWorld: invalid vertex stride");

  const posOff = getAttrOffsetFloats(attrs, "position") ?? getAttrOffsetFloats(attrs, 0);
  if (posOff === null) throw new Error("updateAttachedParticlesIntoWorld: position attribute offset not found");

  const particleCountRaw =
    typeof options.particleCount === "number" && Number.isFinite(options.particleCount)
      ? options.particleCount
      : particleWorld.maxParticles;
  let particleCount = particleCountRaw | 0;
  if (particleCount < 0) particleCount = 0;
  if (particleCount > particleWorld.maxParticles) particleCount = particleWorld.maxParticles;
  if (particleCount === 0) {
    return;
  }

  const paramsData = state.paramsData;
  paramsData[0] = stride >>> 0;
  paramsData[1] = posOff >>> 0;
  paramsData[2] = triCount >>> 0;
  paramsData[3] = particleCount >>> 0;
  updateBuffer(device, state.paramsBuffer, paramsData, 0);

  const vbuf = meshBuffers.vertexBuffer;
  const ibuf = meshBuffers.indexBuffer;
  const pbuf = particleWorld.positionBuffer;

  const bindGroup = state.bindGroups.get({
    vertexData: vbuf,
    indexData: ibuf,
    attachments: attachmentBuffer,
    outPositions: pbuf,
    params: state.paramsBuffer,
  }, "AttachedParticlesCompute.bindGroup");

  const encoder = device.createCommandEncoder({
    label: "AttachedParticlesCompute.encode",
  });

  const pass = encoder.beginComputePass({
    label: "AttachedParticlesCompute.pass",
  });
  pass.setPipeline(state.pipeline);
  pass.setBindGroup(0, bindGroup);

  const workgroups = Math.ceil(particleCount / state.workgroupSize);
  pass.dispatchWorkgroups(workgroups);
  pass.end();

  device.queue.submit([encoder.finish()]);
}

export async function updateAttachedParticlesIntoParticlesState(particles, meshBuffers, options = {}) {
  const chunks = particles && Array.isArray(particles.chunks) ? particles.chunks : null;
  if (chunks && chunks.length > 0) {
    const globalCount = typeof options.particleCount === "number" && Number.isFinite(options.particleCount)
      ? (options.particleCount | 0)
      : null;
    let remaining = globalCount;

    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      const world = chunk && chunk.world;
      if (!world || !world.gpuDevice) {
        continue;
      }

      const attachmentBuffer = (chunk && chunk.attachmentBuffer) || particles.attachmentBuffer || null;
      if (!attachmentBuffer) {
        continue;
      }

      let particleCount = 0;
      if (remaining !== null) {
        const cap = chunk && typeof chunk.instanceCount === "number" ? (chunk.instanceCount | 0) : 0;
        particleCount = Math.max(0, Math.min(cap, remaining | 0));
        remaining = Math.max(0, (remaining | 0) - particleCount);
      } else {
        const active = chunk && typeof chunk.activeInstanceCount === "number" ? (chunk.activeInstanceCount | 0) : null;
        const total = chunk && typeof chunk.instanceCount === "number" ? (chunk.instanceCount | 0) : 0;
        particleCount = active !== null ? Math.max(0, Math.min(active, total)) : total;
      }

      if (particleCount <= 0) {
        continue;
      }

      await updateAttachedParticlesIntoWorld(world.gpuDevice, meshBuffers, world, attachmentBuffer, {
        ...options,
        particleCount,
      });
    }

    return;
  }

  if (!particles || !particles.world) {
    throw new Error("updateAttachedParticlesIntoParticlesState: particles.world is required");
  }
  if (!particles.attachmentBuffer) {
    throw new Error("updateAttachedParticlesIntoParticlesState: particles.attachmentBuffer is required");
  }

  const particleWorld = particles.world;
  const gpuDevice = particleWorld.gpuDevice;
  if (!gpuDevice) {
    throw new Error("updateAttachedParticlesIntoParticlesState: particles.world.gpuDevice is required");
  }

  const particleCount = typeof options.particleCount === "number" ? options.particleCount : (particles.instanceCount | 0);
  await updateAttachedParticlesIntoWorld(gpuDevice, meshBuffers, particleWorld, particles.attachmentBuffer, {
    ...options,
    particleCount,
  });
}

export default {
  updateAttachedParticlesIntoWorld,
  updateAttachedParticlesIntoParticlesState,
};
