// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { withErrorScope } from '../../../engine/core/gpu/GpuDebug.js';

/** Encoder-owned visibility/sort. No queue submission or GPU readback is hidden here. */
export const SPATIAL_GPU_VISIBILITY_WGSL = `
struct Scene { p:array<vec4f,26> }
struct Params { count:u32,padded:u32,step:u32,block:u32 }
struct Draw { vertices:u32,instances:atomic<u32>,firstVertex:u32,firstInstance:u32 }
override spatialWorkgroupSize:u32=128u;
@group(0) @binding(0) var<uniform> scene:Scene;
@group(0) @binding(1) var<uniform> params:Params;
@group(0) @binding(2) var<storage,read> geometry:array<vec4f>;
@group(0) @binding(3) var<storage,read_write> pairs:array<vec2u>;
@group(0) @binding(4) var<storage,read_write> order:array<u32>;
@group(0) @binding(5) var<storage,read_write> draw:Draw;
fn before(a:vec2u,b:vec2u)->bool { return a.x<b.x || (a.x==b.x && a.y<b.y); }
@compute @workgroup_size(spatialWorkgroupSize) fn cull(@builtin(global_invocation_id) gid:vec3u) {
 let id=gid.x;if(id>=params.padded){return;}pairs[id]=vec2u(0xffffffffu,id);if(id>=params.count){return;}
 let a=geometry[id*10u];let b=geometry[id*10u+1u];let c=geometry[id*10u+2u];let pigment=geometry[id*10u+3u];let velocity=geometry[id*10u+8u].xyz;
 let delta=a.xyz-scene.p[1].xyz;let cp=vec3f(dot(delta,scene.p[2].xyz),dot(delta,scene.p[3].xyz),dot(delta,scene.p[4].xyz));
 if(cp.z<=scene.p[22].z || cp.z>scene.p[22].w || a.w*pigment.a*scene.p[3].w<.002){return;}
 var C=mat3x3f(vec3f(b.x,b.y,b.z),vec3f(b.y,b.w,c.x),vec3f(b.z,c.x,c.y))*scene.p[1].w*scene.p[1].w;
 C+=mat3x3f(velocity*velocity.x,velocity*velocity.y,velocity*velocity.z)*(scene.p[2].w*scene.p[2].w/12.);
 let sx=scene.p[5].x*scene.p[0].x/cp.z;let sy=scene.p[5].y*scene.p[0].y/cp.z;
 let jx=sx*(scene.p[2].xyz-scene.p[4].xyz*cp.x/cp.z);let jy=sy*(scene.p[3].xyz-scene.p[4].xyz*cp.y/cp.z);
 let aa=dot(jx,C*jx)+.25;let ab=dot(jx,C*jy);let bb=dot(jy,C*jy)+.25;
 let middle=.5*(aa+bb);let spread=sqrt(max(0.,.25*(aa-bb)*(aa-bb)+ab*ab));let major=3.*sqrt(max(0.,middle+spread-.25));let minor=3.*sqrt(max(0.,middle-spread-.25));
 let center=vec2f(scene.p[5].z+scene.p[5].x*cp.x/cp.z,scene.p[5].w-scene.p[5].y*cp.y/cp.z)*scene.p[0].xy;
 let radius=3.*sqrt(max(vec2f(aa,bb),vec2f(0)));
 if(any(center+radius<vec2f(0)) || any(center-radius>scene.p[0].xy)){return;}
 if(major<scene.p[21].x && major<max(minor*4.,.00001)){return;}
 // Camera-Z is positive. Complementing its IEEE bits sorts far before near.
 pairs[id]=vec2u(~bitcast<u32>(cp.z),id);
}
@compute @workgroup_size(spatialWorkgroupSize) fn bitonic(@builtin(global_invocation_id) gid:vec3u) {
 let id=gid.x;if(id>=params.padded){return;}let partner=id^params.step;if(partner<=id || partner>=params.padded){return;}
 let a=pairs[id];let b=pairs[partner];let ascending=(id&params.block)==0u;
 if(select(before(a,b),before(b,a),ascending)){pairs[id]=b;pairs[partner]=a;}
}
@compute @workgroup_size(spatialWorkgroupSize) fn publish(@builtin(global_invocation_id) gid:vec3u) {
 let id=gid.x;if(id>=params.count){return;}let pair=pairs[id];if(pair.x==0xffffffffu){return;}
 order[id]=pair.y;atomicAdd(&draw.instances,1u);
}
`;

export function spatialBitonicStages(count) {
    const padded = 2 ** Math.ceil(Math.log2(Math.max(1, count))), stages = [];
    for (let block = 2; block <= padded; block *= 2) for (let step = block / 2; step >= 1; step /= 2) stages.push({ count, padded, step, block });
    return { padded, stages };
}
export async function createSpatialGpuVisibility({ device, count, geometryBuffer, orderBuffer, sceneBuffer }) {
    if (Number(device.limits?.maxStorageBuffersPerShaderStage ?? 8) < 4) throw new Error('GPU spatial visibility requires four compute storage buffers; select CPU visibility on this device');
    const U = globalThis.GPUBufferUsage, C = globalThis.GPUShaderStage.COMPUTE;
    // Compatibility devices cap invocations at 128; lower reported limits must
    // specialize both WGSL and host dispatch rather than requesting new limits.
    const limit = Math.min(128, device.limits?.maxComputeWorkgroupSizeX ?? 128, device.limits?.maxComputeInvocationsPerWorkgroup ?? 128);
    if (limit < 1) throw new Error('GPU spatial visibility requires a compute workgroup');
    const workgroupSize = 2 ** Math.floor(Math.log2(limit));
    const { padded, stages } = spatialBitonicStages(count), allocated = [];
    const buffer = (label, size, usage) => { const result = device.createBuffer({ label: `ambient-spatial-${label}`, size: Math.max(16, size), usage: usage | U.COPY_DST }); allocated.push(result); return result; };
    try {
        const pairs = buffer('gpu-visibility-pairs', padded * 8, U.STORAGE), indirect = buffer('gpu-visibility-draw', 16, U.STORAGE | U.INDIRECT | U.COPY_SRC);
        const alignment = device.limits.minUniformBufferOffsetAlignment ?? 256, stageData = new Uint32Array((stages.length + 1) * alignment / 4);
        const parameters = buffer('gpu-visibility-stages', stageData.byteLength, U.UNIFORM);
        stageData.set([count, padded, 0, 0]); stages.forEach((stage, i) => stageData.set([count, padded, stage.step, stage.block], (i + 1) * alignment / 4));
        const layout = device.createBindGroupLayout({ entries: [
            { binding: 0, visibility: C, buffer: { type: 'uniform' } }, { binding: 1, visibility: C, buffer: { type: 'uniform' } },
            { binding: 2, visibility: C, buffer: { type: 'read-only-storage' } },
            ...[3, 4, 5].map(binding => ({ binding, visibility: C, buffer: { type: 'storage' } })),
        ] });
        const shader = device.createShaderModule({ label: 'ambient-spatial-gpu-visibility', code: SPATIAL_GPU_VISIBILITY_WGSL });
        const info = await shader.getCompilationInfo?.(); const error = info?.messages?.find(message => message.type === 'error'); if (error) throw new Error(`Spatial visibility:${error.lineNum}: ${error.message}`);
        const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
        const pipelines = await Promise.all(['cull', 'bitonic', 'publish'].map(entryPoint => withErrorScope(device, () => device.createComputePipelineAsync({ label: `ambient-spatial-${entryPoint}`, layout: pipelineLayout, compute: { module: shader, entryPoint, constants: { spatialWorkgroupSize: workgroupSize } } }))));
        const groups = Array.from({ length: stages.length + 1 }, (_, i) => device.createBindGroup({ layout, entries: [
            { binding: 0, resource: { buffer: sceneBuffer } }, { binding: 1, resource: { buffer: parameters, offset: i * alignment, size: 16 } },
            { binding: 2, resource: { buffer: geometryBuffer } }, { binding: 3, resource: { buffer: pairs } }, { binding: 4, resource: { buffer: orderBuffer } }, { binding: 5, resource: { buffer: indirect } },
        ] }));
        let initialized = false;
        return { indirect, padded, workgroupSize, dispatches: stages.length + 2, bytes: pairs.size + indirect.size + parameters.size,
            encode(encoder) {
                if (!initialized) { device.queue.writeBuffer(parameters, 0, stageData); initialized = true; }
                device.queue.writeBuffer(indirect, 0, new Uint32Array([6, 0, 0, 0]));
                const run = (pipeline, group) => { const pass = encoder.beginComputePass({ label: 'ambient-spatial-visibility' }); pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(Math.ceil(padded / workgroupSize)); pass.end(); };
                run(pipelines[0], groups[0]); stages.forEach((_, i) => run(pipelines[1], groups[i + 1])); run(pipelines[2], groups[0]);
            },
            // Explicit test readback only; production does not stall the render loop.
            buffers: { indirect, pairs, order: orderBuffer },
            dispose() { allocated.splice(0).reverse().forEach(resource => resource.destroy()); },
        };
    } catch (error) { allocated.reverse().forEach(resource => resource.destroy()); throw error; }
}
