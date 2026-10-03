// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

const SPECTRAL_PHOTON_DISPLAY_WGSL = `
struct U{count:u32,_p0:u32,_p1:u32,_p2:u32}
struct P{pos:vec4f,col:vec4f}
@group(0)@binding(0)var<uniform> u:U;
@group(0)@binding(1)var<storage,read> photons:array<P>;
struct VO{@builtin(position)p:vec4f,@location(0)c:vec4f,@location(1)uv:vec2f}
@vertex fn vs(@builtin(vertex_index)vi:u32,@builtin(instance_index)ii:u32)->VO{
  let q=array<vec2f,6>(vec2f(-1.,-1.),vec2f(1.,-1.),vec2f(1.,1.),vec2f(-1.,-1.),vec2f(1.,1.),vec2f(-1.,1.))[vi%6u];
  let ph=photons[ii];
  var o:VO;
  o.p=vec4f(ph.pos.xy+q*ph.pos.w,0.,1.);
  o.c=ph.col;
  o.uv=q;
  return o;
}
@fragment fn fs(i:VO)->@location(0)vec4f{
  let d=dot(i.uv,i.uv);
  if(d>1.){discard;}
  let core=exp(-d*4.5);
  return vec4f(i.c.rgb*core*i.c.a,core*.75);
}`;

export class SpectralPhotonMappingPass {
  constructor(device, options = {}) {
    this.device = device;
    this.vgpu = initVGPU(device);
    this.format = options.format || 'bgra8unorm';
    this.capacity = Math.max(1, options.capacity || 8192);
    this.uniformBuffer = null;
    this.photonBuffer = null;
    this.pipeline = null;
    this.bindGroup = null;
    this.initialized = false;
    this._upload = new Float32Array(this.capacity * 8);
  }

  init(format = this.format) {
    this.format = format;
    const module = this.device.createShaderModule({ label: 'SpectralPhotonMappingPass.shader', code: SPECTRAL_PHOTON_DISPLAY_WGSL });
    const bgl = this.device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ] });
    this.uniformBuffer = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.photonBuffer = this.device.createBuffer({ size: this.capacity * 8 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.pipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: this.format, blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } } }] },
      primitive: { topology: 'triangle-list' },
    });
    this.bindGroup = this.device.createBindGroup({ layout: bgl, entries: [
      { binding: 0, resource: { buffer: this.uniformBuffer } },
      { binding: 1, resource: { buffer: this.photonBuffer } },
    ] });
    this.initialized = true;
  }

  uploadPhotons(photons, view = {}) {
    if (!this.initialized) this.init();
    const count = Math.min(this.capacity, photons?.length || 0);
    const scale = view.scale || 0.085;
    const radius = view.radius || 0.008;
    this._upload.fill(0, 0, Math.max(1, count) * 8);
    for (let i = 0; i < count; i += 1) {
      const photon = photons[i];
      const p = photon.position || [0, 0, 0];
      const c = photon.color || [1, 1, 1];
      const o = i * 8;
      this._upload[o] = p[0] * scale;
      this._upload[o + 1] = p[2] * scale;
      this._upload[o + 2] = 0;
      this._upload[o + 3] = radius;
      this._upload[o + 4] = c[0];
      this._upload[o + 5] = c[1];
      this._upload[o + 6] = c[2];
      this._upload[o + 7] = Math.min(1, 0.25 + Math.max(0, photon.flux || 0) * 80);
    }
    this.device.queue.writeBuffer(this.photonBuffer, 0, this._upload.subarray(0, Math.max(1, count) * 8));
    this.device.queue.writeBuffer(this.uniformBuffer, 0, new Uint32Array([count, 0, 0, 0]));
    return count;
  }

  render(renderPass, count) {
    if (!this.initialized || !renderPass || count <= 0) return;
    renderPass.setPipeline(this.pipeline);
    renderPass.setBindGroup(0, this.bindGroup);
    renderPass.draw(6, count);
  }

  destroy() {
    this.uniformBuffer?.destroy();
    this.photonBuffer?.destroy();
    this.uniformBuffer = null;
    this.photonBuffer = null;
    this.pipeline = null;
    this.bindGroup = null;
    this.initialized = false;
  }
}

export function createSpectralPhotonMappingPass(device, options) {
  return new SpectralPhotonMappingPass(device, options);
}
