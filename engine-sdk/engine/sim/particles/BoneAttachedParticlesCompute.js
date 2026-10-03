// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createUniformBuffer, updateBuffer } from "../../core/gpu/GpuBuffer.js";
import { BindGroupSignals } from "../../core/gpu/BindingSignals.js";
import { labelResource } from "../../core/gpu/GpuDebug.js";
import { getGPUMemoryManager } from "../../core/memory/GPUMemoryManager.js";

const stateByDevice = new WeakMap();
const SHADER_VERSION = 1;

function createShaderCode(workgroupSize) {
  const wg = Math.max(1, Math.min(256, workgroupSize | 0));
  return /* wgsl */`
struct Params {
  particleCount: u32,
  boneCount: u32,
  _pad0: u32,
  _pad1: u32,
}

struct Attachment {
  triIndex: u32,
  b: f32,
  c: f32,
  flags: u32,
}

@group(0) @binding(0) var<storage, read_write> positions : array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> attachments : array<Attachment>;
@group(0) @binding(2) var<storage, read> bones : array<vec4<f32>>;
@group(0) @binding(3) var<uniform> params : Params;

fn signNotZero(x: f32) -> f32 {
  return select(-1.0, 1.0, x >= 0.0);
}

fn octEncode(nIn: vec3<f32>) -> vec2<f32> {
  let denom = abs(nIn.x) + abs(nIn.y) + abs(nIn.z);
  let inv = 1.0 / max(denom, 1e-6);
  var n = nIn * inv;
  var e = n.xy;
  if (n.z < 0.0) {
    e = (vec2<f32>(1.0, 1.0) - abs(e.yx)) * vec2<f32>(signNotZero(e.x), signNotZero(e.y));
  }
  return clamp(e, vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, 1.0));
}

fn octDecode(eIn: vec2<f32>) -> vec3<f32> {
  var e = clamp(eIn, vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, 1.0));
  var v = vec3<f32>(e.x, e.y, 1.0 - abs(e.x) - abs(e.y));
  if (v.z < 0.0) {
    let oldX = v.x;
    v.x = (1.0 - abs(v.y)) * signNotZero(oldX);
    v.y = (1.0 - abs(oldX)) * signNotZero(v.y);
  }
  return normalize(v);
}

@compute @workgroup_size(${wg})
fn assignMain(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.particleCount) {
    return;
  }

  if (params.boneCount == 0u) {
    return;
  }

  let pos = positions[idx].xyz;

  var bestI: u32 = 0u;
  var bestD2: f32 = 1e30;

  for (var bi: u32 = 0u; bi < params.boneCount; bi = bi + 1u) {
    let bp = bones[bi].xyz;
    let d = pos - bp;
    let d2 = dot(d, d);
    if (d2 < bestD2) {
      bestD2 = d2;
      bestI = bi;
    }
  }

  let bp = bones[bestI].xyz;
  let off = pos - bp;
  let mag = length(off);
  let dir = select(vec3<f32>(0.0, 1.0, 0.0), off / mag, mag > 1e-6);

  let oct = octEncode(dir);

  attachments[idx].triIndex = 0x80000000u | bestI;
  attachments[idx].b = oct.x;
  attachments[idx].c = oct.y;
  attachments[idx].flags = bitcast<u32>(mag);
}

@compute @workgroup_size(${wg})
fn updateMain(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  if (idx >= params.particleCount) {
    return;
  }

  let tri = attachments[idx].triIndex;
  if ((tri & 0x80000000u) == 0u) {
    return;
  }

  let boneIndex = tri & 0x7fffffffu;
  if (boneIndex >= params.boneCount) {
    return;
  }

  let bp = bones[boneIndex].xyz;
  let dir = octDecode(vec2<f32>(attachments[idx].b, attachments[idx].c));
  let mag = bitcast<f32>(attachments[idx].flags);

  let age = positions[idx].w;
  positions[idx] = vec4<f32>(bp + dir * mag, age);
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

  const shaderModule = device.createShaderModule({
    label: "BoneAttachedParticlesCompute.shader",
    code: createShaderCode(workgroupSize),
  });

  const pipelineAssign = await device.createComputePipelineAsync({
    label: "BoneAttachedParticlesCompute.assign",
    layout: "auto",
    compute: { module: shaderModule, entryPoint: "assignMain" },
  });

  const pipelineUpdate = await device.createComputePipelineAsync({
    label: "BoneAttachedParticlesCompute.update",
    layout: "auto",
    compute: { module: shaderModule, entryPoint: "updateMain" },
  });

  const paramsBuffer = createUniformBuffer(device, 16, {
    label: "BoneAttachedParticlesCompute.params",
  });

  labelResource(paramsBuffer, "BoneAttachedParticlesCompute.params");

  const paramsData = new Uint32Array(4);

  const gpu = getGPUMemoryManager(device);
  const externalGetBindGroup = gpu && gpu.bindGroupCache && typeof gpu.getBindGroup === "function" ? gpu.getBindGroup.bind(gpu) : null;

  entry = {
    version: SHADER_VERSION,
    pipelineAssign,
    pipelineUpdate,
    paramsBuffer,
    paramsData,
    bindGroupsAssign: new BindGroupSignals(
      device,
      pipelineAssign.getBindGroupLayout(0),
      [
        { name: "positions", binding: 0 },
        { name: "attachments", binding: 1 },
        { name: "bones", binding: 2 },
        { name: "params", binding: 3 },
      ],
      { label: "BoneAttachedParticlesCompute.bindGroup", maxEntries: 2048, getBindGroup: externalGetBindGroup }
    ),
    bindGroupsUpdate: new BindGroupSignals(
      device,
      pipelineUpdate.getBindGroupLayout(0),
      [
        { name: "positions", binding: 0 },
        { name: "attachments", binding: 1 },
        { name: "bones", binding: 2 },
        { name: "params", binding: 3 },
      ],
      { label: "BoneAttachedParticlesCompute.bindGroup", maxEntries: 2048, getBindGroup: externalGetBindGroup }
    ),
    workgroupSize,
  };

  stateByDevice.set(device, entry);
  return entry;
}

async function dispatchPass(device, pipeline, particleWorld, attachmentBuffer, boneBuffer, options = {}) {
  if (!particleWorld || !particleWorld.positionBuffer) {
    throw new Error("BoneAttachedParticlesCompute: particleWorld.positionBuffer required");
  }
  if (!attachmentBuffer) {
    throw new Error("BoneAttachedParticlesCompute: attachmentBuffer required");
  }
  if (!boneBuffer) {
    throw new Error("BoneAttachedParticlesCompute: boneBuffer required");
  }

  const state = await getOrCreateState(device, options);

  const particleCountRaw =
    typeof options.particleCount === "number" && Number.isFinite(options.particleCount)
      ? options.particleCount
      : (particleWorld.maxParticles || 0);
  let particleCount = particleCountRaw | 0;
  if (particleCount < 0) particleCount = 0;
  if (particleCount > (particleWorld.maxParticles | 0)) particleCount = particleWorld.maxParticles | 0;
  if (particleCount === 0) {
    return;
  }

  const boneCountRaw =
    typeof options.boneCount === "number" && Number.isFinite(options.boneCount)
      ? options.boneCount
      : 0;
  let boneCount = boneCountRaw | 0;
  if (boneCount < 0) boneCount = 0;

  const paramsData = state.paramsData;
  paramsData[0] = particleCount >>> 0;
  paramsData[1] = boneCount >>> 0;
  paramsData[2] = 0;
  paramsData[3] = 0;
  updateBuffer(device, state.paramsBuffer, paramsData, 0);

  const bindGroupFactory = pipeline === state.pipelineAssign ? state.bindGroupsAssign : state.bindGroupsUpdate;
  const posBuf = particleWorld.positionBuffer;
  const bindGroup = bindGroupFactory.get({
    positions: posBuf,
    attachments: attachmentBuffer,
    bones: boneBuffer,
    params: state.paramsBuffer,
  }, "BoneAttachedParticlesCompute.bindGroup");

  const encoder = device.createCommandEncoder({
    label: "BoneAttachedParticlesCompute.encode",
  });

  const pass = encoder.beginComputePass({
    label: "BoneAttachedParticlesCompute.pass",
  });

  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);

  const workgroups = Math.ceil(particleCount / state.workgroupSize);
  pass.dispatchWorkgroups(workgroups);
  pass.end();

  device.queue.submit([encoder.finish()]);
}

export async function assignParticlesToBonesIntoWorld(gpuDevice, boneBuffer, particleWorld, attachmentBuffer, options = {}) {
  if (!gpuDevice || typeof gpuDevice.getDevice !== "function") {
    throw new Error("assignParticlesToBonesIntoWorld: gpuDevice required");
  }
  const device = gpuDevice.getDevice();
  if (!device) throw new Error("assignParticlesToBonesIntoWorld: gpuDevice.getDevice() returned null");

  const state = await getOrCreateState(device, options);
  await dispatchPass(device, state.pipelineAssign, particleWorld, attachmentBuffer, boneBuffer, options);
}

export async function updateBoneAttachedParticlesIntoWorld(gpuDevice, boneBuffer, particleWorld, attachmentBuffer, options = {}) {
  if (!gpuDevice || typeof gpuDevice.getDevice !== "function") {
    throw new Error("updateBoneAttachedParticlesIntoWorld: gpuDevice required");
  }
  const device = gpuDevice.getDevice();
  if (!device) throw new Error("updateBoneAttachedParticlesIntoWorld: gpuDevice.getDevice() returned null");

  const state = await getOrCreateState(device, options);
  await dispatchPass(device, state.pipelineUpdate, particleWorld, attachmentBuffer, boneBuffer, options);
}

export async function assignParticlesToBonesIntoParticlesState(particles, boneBuffer, options = {}) {
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

      await assignParticlesToBonesIntoWorld(world.gpuDevice, boneBuffer, world, attachmentBuffer, {
        ...options,
        particleCount,
      });
    }

    return;
  }

  if (!particles || !particles.world) {
    throw new Error("assignParticlesToBonesIntoParticlesState: particles.world is required");
  }
  if (!particles.attachmentBuffer) {
    throw new Error("assignParticlesToBonesIntoParticlesState: particles.attachmentBuffer is required");
  }

  const particleWorld = particles.world;
  const gpuDevice = particleWorld.gpuDevice;
  if (!gpuDevice) {
    throw new Error("assignParticlesToBonesIntoParticlesState: particles.world.gpuDevice is required");
  }

  const particleCount = typeof options.particleCount === "number" ? options.particleCount : (particles.instanceCount | 0);
  await assignParticlesToBonesIntoWorld(gpuDevice, boneBuffer, particleWorld, particles.attachmentBuffer, {
    ...options,
    particleCount,
  });
}

export async function updateBoneAttachedParticlesIntoParticlesState(particles, boneBuffer, options = {}) {
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

      await updateBoneAttachedParticlesIntoWorld(world.gpuDevice, boneBuffer, world, attachmentBuffer, {
        ...options,
        particleCount,
      });
    }

    return;
  }

  if (!particles || !particles.world) {
    throw new Error("updateBoneAttachedParticlesIntoParticlesState: particles.world is required");
  }
  if (!particles.attachmentBuffer) {
    throw new Error("updateBoneAttachedParticlesIntoParticlesState: particles.attachmentBuffer is required");
  }

  const particleWorld = particles.world;
  const gpuDevice = particleWorld.gpuDevice;
  if (!gpuDevice) {
    throw new Error("updateBoneAttachedParticlesIntoParticlesState: particles.world.gpuDevice is required");
  }

  const particleCount = typeof options.particleCount === "number" ? options.particleCount : (particles.instanceCount | 0);
  await updateBoneAttachedParticlesIntoWorld(gpuDevice, boneBuffer, particleWorld, particles.attachmentBuffer, {
    ...options,
    particleCount,
  });
}

export default {
  assignParticlesToBonesIntoWorld,
  updateBoneAttachedParticlesIntoWorld,
  assignParticlesToBonesIntoParticlesState,
  updateBoneAttachedParticlesIntoParticlesState,
};
