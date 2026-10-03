// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createUniformBuffer, destroyBuffers, updateBuffer } from "../../core/gpu/GpuBuffer.js";
import { BindGroupSignals, generateWGSLBindGroupDeclarations } from "../../core/gpu/BindingSignals.js";
import { labelResource } from "../../core/gpu/GpuDebug.js";
import { getGPUMemoryManager } from "../../core/memory/GPUMemoryManager.js";

const smoothStateByDevice = new Map();

const WGSL_BINDINGS = [
  { binding: 0, name: "srcDensity", addressSpace: "storage", access: "read", wgslType: "array<f32>" },
  { binding: 1, name: "srcColor", addressSpace: "storage", access: "read", wgslType: "array<vec4<f32>>" },
  { binding: 2, name: "dstDensity", addressSpace: "storage", access: "read_write", wgslType: "array<f32>" },
  { binding: 3, name: "dstColor", addressSpace: "storage", access: "read_write", wgslType: "array<vec4<f32>>" },
  { binding: 4, name: "params", addressSpace: "uniform", wgslType: "Params" },
];

function getState(device) {
  let state = smoothStateByDevice.get(device);
  if (state) return state;

  const bindingsWGSL = generateWGSLBindGroupDeclarations(0, WGSL_BINDINGS);

  const shaderCode = /* wgsl */`
struct Params {
  gridSize : vec3<u32>,
  _pad0 : u32,
};

${bindingsWGSL}

fn indexOf(x : u32, y : u32, z : u32) -> u32 {
  return x + y * params.gridSize.x + z * params.gridSize.x * params.gridSize.y;
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  if (gid.x >= params.gridSize.x || gid.y >= params.gridSize.y || gid.z >= params.gridSize.z) {
    return;
  }

  let gx = params.gridSize.x;
  let gy = params.gridSize.y;
  let gz = params.gridSize.z;

  let ix = gid.x;
  let iy = gid.y;
  let iz = gid.z;

  let idx = indexOf(ix, iy, iz);
  if (idx >= arrayLength(&dstDensity)) {
    return;
  }

  var sumD = 0.0;
  var sumC = vec4<f32>(0.0);
  var sumW = 0.0;

  let sigma2 = 1.0;

  for (var dz : i32 = -1; dz <= 1; dz = dz + 1) {
    for (var dy : i32 = -1; dy <= 1; dy = dy + 1) {
      for (var dx : i32 = -1; dx <= 1; dx = dx + 1) {
        let nx = clamp(i32(ix) + dx, 0, i32(gx) - 1);
        let ny = clamp(i32(iy) + dy, 0, i32(gy) - 1);
        let nz = clamp(i32(iz) + dz, 0, i32(gz) - 1);

        let nidx = indexOf(u32(nx), u32(ny), u32(nz));
        if (nidx >= arrayLength(&srcDensity) || nidx >= arrayLength(&srcColor)) {
          continue;
        }

        let dist2 = f32(dx * dx + dy * dy + dz * dz);
        let w = exp(-0.5 * dist2 / sigma2);

        sumD = sumD + srcDensity[nidx] * w;
        sumC = sumC + srcColor[nidx] * w;
        sumW = sumW + w;
      }
    }
  }

  let invW = 1.0 / max(sumW, 1e-6);
  dstDensity[idx] = sumD * invW;
  dstColor[idx] = sumC * invW;
}
`;

  const shaderModule = device.createShaderModule({
    label: "VolumeFieldSmooth.shader",
    code: shaderCode,
  });

  const pipeline = device.createComputePipeline({
    label: "VolumeFieldSmooth.pipeline",
    layout: "auto",
    compute: {
      module: shaderModule,
      entryPoint: "main",
    },
  });

  const paramsBuffer = createUniformBuffer(device, 16, { label: "VolumeFieldSmooth.params" });
  labelResource(paramsBuffer, "VolumeFieldSmooth.params");

  const gpu = getGPUMemoryManager(device);
  const externalGetBindGroup = gpu && gpu.bindGroupCache && typeof gpu.getBindGroup === "function" ? gpu.getBindGroup.bind(gpu) : null;

  state = {
    pipeline,
    paramsBuffer,
    bindGroupLayout: pipeline.getBindGroupLayout(0),
    bindGroups: new BindGroupSignals(
      device,
      pipeline.getBindGroupLayout(0),
      [
        { name: "srcDensity", binding: 0 },
        { name: "srcColor", binding: 1 },
        { name: "dstDensity", binding: 2 },
        { name: "dstColor", binding: 3 },
        { name: "params", binding: 4 },
      ],
      { label: "VolumeFieldSmooth.bindGroup", maxEntries: 8, getBindGroup: externalGetBindGroup }
    ),
  };

  smoothStateByDevice.set(device, state);
  return state;
}

export function smoothVolumeField(world, options = {}) {
  if (!world || !world.device || !world.densityBuffer || !world.colorBuffer) {
    return;
  }
  if (!world.tempDensityBuffer || !world.tempColorBuffer) {
    return;
  }

  const device = world.device;
  const state = getState(device);

  const gx = world.gridSizeX | 0;
  const gy = world.gridSizeY | 0;
  const gz = world.gridSizeZ | 0;
  if (gx <= 0 || gy <= 0 || gz <= 0) return;

  const iterations = Math.max(1, options.iterations | 0);

  if (options.computePass && (iterations % 2) === 1) {
    throw new Error("smoothVolumeField: options.computePass requires an even iteration count");
  }

  const params = new Uint32Array(4);
  params[0] = gx >>> 0;
  params[1] = gy >>> 0;
  params[2] = gz >>> 0;
  params[3] = 0;
  updateBuffer(device, state.paramsBuffer, params, 0);

  const externalPass = options.computePass;
  const externalEncoder = options.encoder;
  const encoder = externalEncoder || (externalPass ? null : device.createCommandEncoder({ label: "VolumeFieldSmooth.encoder" }));

  const wx = Math.ceil(gx / 4);
  const wy = Math.ceil(gy / 4);
  const wz = Math.ceil(gz / 4);

  const bindGroupEven = state.bindGroups.get({
    srcDensity: world.densityBuffer,
    srcColor: world.colorBuffer,
    dstDensity: world.tempDensityBuffer,
    dstColor: world.tempColorBuffer,
    params: state.paramsBuffer,
  }, "VolumeFieldSmooth.bindGroupEven");

  const bindGroupOdd = state.bindGroups.get({
    srcDensity: world.tempDensityBuffer,
    srcColor: world.tempColorBuffer,
    dstDensity: world.densityBuffer,
    dstColor: world.colorBuffer,
    params: state.paramsBuffer,
  }, "VolumeFieldSmooth.bindGroupOdd");

  for (let i = 0; i < iterations; i++) {
    const bindGroup = (i % 2) === 0 ? bindGroupEven : bindGroupOdd;
    const pass = externalPass || encoder.beginComputePass({ label: "VolumeFieldSmooth.pass" });
    pass.setPipeline(state.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(wx, wy, wz);
    if (!externalPass) {
      pass.end();
    }
  }

  if (!externalPass) {
    if ((iterations % 2) === 1) {
      encoder.copyBufferToBuffer(world.tempDensityBuffer, 0, world.densityBuffer, 0, world.scalarByteSize);
      encoder.copyBufferToBuffer(world.tempColorBuffer, 0, world.colorBuffer, 0, world.colorByteSize);
    }

    if (!externalEncoder) {
      device.queue.submit([encoder.finish()]);
    }
  }
}

export function disposeVolumeFieldSmooth(device) {
  const state = smoothStateByDevice.get(device);
  if (!state) return;
  destroyBuffers([state.paramsBuffer]);
  smoothStateByDevice.delete(device);
}
