// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createImageSurface, createVideoSurface } from '../../../engine/surfaces/MediaSurface.js';
import { withErrorScope } from '../../../engine/core/gpu/GpuDebug.js';
import { createSpatialVideoPlayback, prepareSpatialVideoFrame } from './SpatialVideoPlayback.js';

/** Decode project-owned media and expose uploads exclusively to the composite frame. */
export async function createAmbientCompositeMedia({ device, format, layer, projectId, assetResolver, signal, resources }) {
    const descriptor = layer.descriptor.asset.descriptor;
    if (!descriptor) throw new TypeError(`Media layer ${layer.id} needs its project asset descriptor; reopen and save this project in Ambient Studio`);
    if (typeof assetResolver !== 'function') throw new TypeError(`Media layer ${layer.id} requires operator asset storage`);
    let value = await assetResolver(descriptor, { projectId, signal }); signal?.throwIfAborted();
    const blob = value instanceof Blob ? value : new Blob([value], { type: descriptor.mediaType });
    let source, videoPlayback = null, url = null;
    if (layer.kind === 'image') {
        const bitmap = await createImageBitmap(blob);
        resources.trackBrowserHandle(bitmap); signal?.throwIfAborted(); source = createImageSurface({ element: bitmap });
    } else {
        url = URL.createObjectURL(blob); resources.trackBrowserHandle({ dispose: () => URL.revokeObjectURL(url) });
        const video = document.createElement('video');
        video.muted = true; video.loop = layer.descriptor.playback.loop; video.playsInline = true; video.preload = 'auto'; video.src = url;
        // The resource scope owns the element; the temporary surface owns only
        // readiness. Playback then has one decoded-frame callback owner.
        source = createVideoSurface({ element: video, autoplay: false });
        resources.trackBrowserHandle(source); resources.trackMedia(source.element);
        const abort = () => source.dispose(); signal?.addEventListener('abort', abort, { once: true });
        let timer;
        try { await Promise.race([source.ready, new Promise((_, reject) => { timer = setTimeout(() => { source.dispose(); reject(new Error('Composite video decode timed out')); }, 15000); })]); }
        finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
        signal?.throwIfAborted(); source.element.playbackRate = layer.descriptor.playback.playbackRate;
        const settings = { sourcePlayback: 'timeline', sourceClip: layer.descriptor.playback.clip, sourceRate: layer.descriptor.playback.playbackRate, sourceLoop: layer.descriptor.playback.loop };
        await prepareSpatialVideoFrame(video, settings, signal);
        source.dispose(); videoPlayback = createSpatialVideoPlayback(video, settings); resources.trackBrowserHandle(videoPlayback);
    }
    const sourceWidth = source.element.videoWidth || source.element.width, sourceHeight = source.element.videoHeight || source.element.height;
    const scale = Math.min(1, 1024 / sourceWidth, 1024 / sourceHeight);
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(sourceWidth * scale)); canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext('2d');
    const texture = resources.trackTexture(device.createTexture({ label: `ambient-media-${layer.id}`, size: [canvas.width, canvas.height], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT }));
    const uniformBuffer = resources.trackBuffer(device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: `ambient-media-${layer.id}-uniforms` }));
    const module = device.createShaderModule({ code: MEDIA_WGSL, label: 'ambient-composite-media' });
    const pipeline = await withErrorScope(device, () => {
        const descriptor = { layout: 'auto', vertex: { module, entryPoint: 'vertexMain' }, fragment: { module, entryPoint: 'fragmentMain', targets: [{ format, blend: { color: { operation: 'add', srcFactor: 'one', dstFactor: layer.blendMode === 'add' ? 'one' : 'one-minus-src-alpha' }, alpha: { operation: 'add', srcFactor: 'one', dstFactor: layer.blendMode === 'add' ? 'one' : 'one-minus-src-alpha' } } }] }, primitive: { topology: 'triangle-list' } };
        return device.createRenderPipelineAsync ? device.createRenderPipelineAsync(descriptor) : device.createRenderPipeline(descriptor);
    });
    const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
    const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniformBuffer } }, { binding: 1, resource: texture.createView() }, { binding: 2, resource: sampler }] });
    let uploaded = false;
    const pause = () => { if (layer.kind === 'video') source.element.pause(); };
    return Object.freeze({ layer, pipeline, bindGroup, uniformBuffer, pause, uploadBytes: canvas.width * canvas.height * 4,
        update(width, height, frozen, opacity) {
            if (videoPlayback) videoPlayback.update(0, { frozen });
            else source.render();
            const decoded = videoPlayback?.consumeFrame();
            if (videoPlayback ? !!decoded : !uploaded || source.dirty) {
                context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(source.element, 0, 0, canvas.width, canvas.height);
                device.queue.copyExternalImageToTexture({ source: canvas }, { texture }, [canvas.width, canvas.height]); uploaded = true; source.dirty = false;
            }
            const position = layer.descriptor.position ?? 'center';
            const focalX = position === 'custom' ? layer.descriptor.focalX : position === 'left' ? 0 : position === 'right' ? 1 : .5;
            const focalY = position === 'custom' ? layer.descriptor.focalY : position === 'top' ? 0 : position === 'bottom' ? 1 : .5;
            const uniforms = new Float32Array(16); uniforms.set([width, height, sourceWidth, sourceHeight, ['cover', 'contain', 'fill'].indexOf(layer.descriptor.fit ?? 'cover'), focalX, focalY, opacity]);
            device.queue.writeBuffer(uniformBuffer, 0, uniforms);
        },
    });
}

const MEDIA_WGSL = `
struct Media { dimensions:vec4f, fit:vec4f, reserved:vec4f, reserved2:vec4f }
@group(0) @binding(0) var<uniform> media:Media;
@group(0) @binding(1) var image:texture_2d<f32>;
@group(0) @binding(2) var imageSampler:sampler;
struct Output { @builtin(position) position:vec4f,@location(0) uv:vec2f }
@vertex fn vertexMain(@builtin(vertex_index) index:u32)->Output {let p=vec2f(f32((index<<1u)&2u),f32(index&2u));var result:Output;result.position=vec4f(p*2.-1.,0,1);result.uv=vec2f(p.x,1.-p.y);return result;}
@fragment fn fragmentMain(input:Output)->@location(0) vec4f {
 let ratio=media.dimensions.xy/media.dimensions.zw;var size=vec2f(1);
 if(media.fit.x<2){let scale=select(max(ratio.x,ratio.y),min(ratio.x,ratio.y),media.fit.x==1);size=media.dimensions.zw*scale/media.dimensions.xy;}
 let uv=(input.uv-media.fit.yz*(vec2f(1)-size))/size;if(any(uv<vec2f(0))||any(uv>vec2f(1))){discard;}
 let color=textureSampleLevel(image,imageSampler,uv,0);let alpha=color.a*media.fit.w;return vec4f(color.rgb*alpha,alpha);
}`;
