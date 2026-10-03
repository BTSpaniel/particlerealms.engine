// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { withErrorScope } from '../../../engine/core/gpu/GpuDebug.js';

export function spatialMipLevelCount(width, height, projection = 'perspective', enabled = true) {
    return enabled ? 1 + Math.floor(Math.log2(Math.max(1, projection === 'cubemap-atlas' ? height : Math.max(width, height)))) : 1;
}
export function spatialTextureBytes(width, height, layers, levels) {
    let total = 0; for (let level = 0; level < levels; level++) total += Math.max(1, width >> level) * Math.max(1, height >> level) * layers * 4; return total;
}
export function spatialMediaDimensions(width, height, projection = 'perspective', history = false) {
    if (projection === 'cubemap-atlas') {
        if (width !== height * 6) throw new TypeError('Cubemap atlas requires six square faces in one horizontal row: +X, -X, +Y, -Y, +Z, -Z');
        const face = 2 ** Math.floor(Math.log2(Math.max(1, Math.min(height, history ? 256 : 512)))); return [face * 6, face];
    }
    if (projection === 'equirectangular' && width !== height * 2) throw new TypeError('Equirectangular media must have a 2:1 full-sphere layout');
    const maxDimension = history ? 640 : projection === 'equirectangular' ? 2048 : 1024, pixels = history ? 300000 : projection === 'equirectangular' ? 2097152 : 1048576;
    const scale = Math.min(1, maxDimension / width, maxDimension / height, Math.sqrt(pixels / (width * height))); return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

function mipShader(array, linearValues = false) { return `
@group(0) @binding(0) var image:${array ? 'texture_2d_array<f32>' : 'texture_2d<f32>'};
struct Quad { @builtin(position) position:vec4f,@location(0) uv:vec2f ${array ? ',@location(1) @interpolate(flat,either) layer:u32' : ''} }
@vertex fn vertex(@builtin(vertex_index) id:u32 ${array ? ',@builtin(instance_index) layer:u32' : ''})->Quad {let p=vec2f(f32((id<<1u)&2u),f32(id&2u));var o:Quad;o.position=vec4f(p*2.-1.,0,1);o.uv=vec2f(p.x,1.-p.y);${array ? 'o.layer=layer;' : ''}return o;}
fn decode(rgb:vec3f)->vec3f{return mix(rgb/12.92,pow((rgb+.055)/1.055,vec3f(2.4)),step(vec3f(.04045),rgb));}
fn encode(rgb:vec3f)->vec3f{return mix(rgb*12.92,1.055*pow(max(rgb,vec3f(0)),vec3f(1./2.4))-.055,step(vec3f(.0031308),rgb));}
fn pixel(p:vec2i ${array ? ',layer:u32' : ''})->vec4f {let dimensions=vec2i(textureDimensions(image));let value=textureLoad(image,clamp(p,vec2i(0),dimensions-1),${array ? 'i32(layer),0' : '0'});return ${linearValues ? 'value' : 'vec4f(decode(value.rgb)*value.a,value.a)'};}
@fragment fn fragment(in:Quad)->@location(0) vec4f {
 // A mip texel integrates its entire source footprint. Odd dimensions such
 // as3->1 need three source columns, not a bilinear centre sample.
 let sourceSize=vec2f(textureDimensions(image));let destinationSize=max(vec2f(1),floor(sourceSize*.5));let scale=sourceSize/destinationSize;
 let start=floor(in.position.xy)*scale;let end=start+scale;let base=vec2i(floor(start));var color=vec4f(0);
 for(var y=0;y<3;y++){for(var x=0;x<3;x++){let at=base+vec2i(x,y);let coverage=max(vec2f(0),min(end,vec2f(at)+1.)-max(start,vec2f(at)));color+=pixel(at ${array ? ',in.layer' : ''})*coverage.x*coverage.y;}}
 color/=scale.x*scale.y;
 return ${linearValues ? 'color' : 'vec4f(encode(color.rgb/max(color.a,.00001)),color.a)'};
}`; }
/** Linear-light premultiplied downsampling. Every mip/layer has an explicit render pass. */
export async function createSpatialMipGenerator(device, { format = 'rgba8unorm', linearValues = false } = {}) {
    if (!['rgba8unorm', 'rgba16float'].includes(format) || typeof linearValues !== 'boolean') throw new TypeError('Invalid spatial mip format or value policy.');
    const pipelines = [];
    for (const array of [false, true]) {
        const shader = device.createShaderModule({ label: 'ambient-spatial-linear-mips', code: mipShader(array, linearValues) });
        const info = await shader.getCompilationInfo?.(); const error = info?.messages?.find(value => value.type === 'error'); if (error) throw new Error(`Spatial mip shader:${error.lineNum}: ${error.message}`);
        pipelines.push(await withErrorScope(device, () => device.createRenderPipelineAsync({ label: 'ambient-spatial-linear-mips', layout: 'auto', vertex: { module: shader, entryPoint: 'vertex' }, fragment: { module: shader, entryPoint: 'fragment', targets: [{ format }] }, primitive: { topology: 'triangle-list' } })));
    }
    const groups = new WeakMap();
    return { encode(encoder, texture, layer = 0, array = false) {
        if (texture.mipLevelCount <= 1) return 0;
        let cached = groups.get(texture); if (!cached) { cached = new Map(); groups.set(texture, cached); }
        let passes = 0;
        for (let mip = 1; mip < texture.mipLevelCount; mip++) {
            const key = `${layer}:${mip}:${array}`, pipeline = pipelines[array ? 1 : 0]; let pair = cached.get(key);
            if (!pair) { pair = {
                // Compatibility sampling views must cover the whole array.
                // firstInstance selects the actual layer without mutable GPU
                // uniforms shared by the separately encoded mip passes.
                group: device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: texture.createView({ dimension: array ? '2d-array' : '2d', baseMipLevel: mip - 1, mipLevelCount: 1, ...(array ? {} : { baseArrayLayer: layer, arrayLayerCount: 1 }) }) }] }),
                target: texture.createView({ dimension: '2d', baseMipLevel: mip, mipLevelCount: 1, baseArrayLayer: layer, arrayLayerCount: 1 }),
            }; cached.set(key, pair); }
            const pass = encoder.beginRenderPass({ label: 'ambient-spatial-media-mip', colorAttachments: [{ view: pair.target, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }] });
            pass.setPipeline(pipeline); pass.setBindGroup(0, pair.group); pass.draw(3, 1, 0, array ? layer : 0); pass.end(); passes++;
        }
        return passes;
    } };
}
