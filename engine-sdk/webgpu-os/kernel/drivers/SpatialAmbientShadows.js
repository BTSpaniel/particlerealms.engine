// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { ShadowMapPass } from '../../../engine/render/passes/ShadowMapPass.js';
import { mat4Multiply, mat4Inverse } from '../../../engine/core/math/EngineMath.js';
import { withErrorScope } from '../../../engine/core/gpu/GpuDebug.js';

/** One saved light direction drives the sun, surface BRDF and shadow map. */
export function spatialKeyLightDirection(settings) {
    if (settings.lightAzimuth === undefined && settings.lightElevation === undefined) {
        const length = Math.hypot(-.45, .7, -.7); return [-.45 / length, .7 / length, -.7 / length];
    }
    const azimuth = (settings.lightAzimuth ?? -147) * Math.PI / 180, elevation = (settings.lightElevation ?? 40) * Math.PI / 180;
    return [Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation)];
}

/** Calibrated +Z camera projection, including the saved off-centre intrinsics. */
export function spatialCameraViewProjection(camera) {
    const { eye, right: r, up: u, forward: f, fx, fy, cx, cy } = camera;
    const near = camera.near ?? .06, far = camera.far ?? 100, A = far / (far - near), B = far * near / (far - near);
    const dot = vector => vector.reduce((sum, value, i) => sum + value * eye[i], 0);
    const view = new Float32Array([r[0], u[0], f[0], 0, r[1], u[1], f[1], 0, r[2], u[2], f[2], 0, -dot(r), -dot(u), -dot(f), 1]);
    const projection = new Float32Array([2 * fx, 0, 0, 0, 0, 2 * fy, 0, 0, 2 * (cx - .5), 2 * (.5 - cy), A, 1, 0, 0, -B, 0]);
    return mat4Multiply(projection, view, new Float32Array(16));
}

/** Bounded reflective water receives shadows but is not an opaque caster.
 * Retain triangle ownership even when one saved range mixes mesh materials. */
export function spatialOpaqueShadowRanges(geometry) {
    if (!geometry.meshMaterials) return geometry.meshRanges;
    const ranges = [];
    for (const range of geometry.meshRanges) {
        let start = range.start, count = 0;
        for (let vertex = range.start; vertex < range.start + range.count; vertex += 3) {
            const water = geometry.meshMaterials[vertex] === 4;
            if (water) { if (count) ranges.push({ ...range, start, count }); count = 0; start = vertex + 3; }
            else count += 3;
        }
        if (count) ranges.push({ ...range, start, count });
    }
    return ranges;
}

/** Engine PCF shadows for actual opaque mesh geometry. Transparent splats are
 * composed afterward and neither cast nor receive these mesh-only shadows. */
export async function createSpatialMeshShadows({ device, settings, geometry, meshBuffer, sourceLayout, sourceBindings, shaderModule, frameVertices = 0 }) {
    const casterRanges = spatialOpaqueShadowRanges(geometry);
    if (!casterRanges.some(range => range.count > 0)) return null;
    const shadow = new ShadowMapPass({ surfaceDepthOnly: true });
    shadow.mapSize = Number(settings.meshShadowMapSize ?? '1024'); shadow.shadowIntensity = settings.meshShadowStrength; shadow.shadowBias = settings.meshShadowBias ?? .0015;
    let lightBuffer = null, disposed = false;
    const dispose = () => { if (disposed) return; disposed = true; lightBuffer?.destroy(); shadow.destroy(); };
    try {
        await shadow.initValidated(device, 'rgba16float');
        if (!shadow.initialized) throw new Error('Engine geometry shadow map could not initialize');
        const visibility = globalThis.GPUShaderStage?.VERTEX ?? 1, usage = globalThis.GPUBufferUsage ?? { UNIFORM: 64, COPY_DST: 8 };
        const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility, buffer: { type: 'uniform' } }] });
        lightBuffer = device.createBuffer({ label: 'ambient-spatial-shadow-light', size: 64, usage: usage.UNIFORM | usage.COPY_DST });
        const lightBindings = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: lightBuffer } }] });
        const descriptor = { label: 'ambient-spatial-opaque-shadow-depth', layout: device.createPipelineLayout({ bindGroupLayouts: [sourceLayout, layout] }),
            vertex: { module: shaderModule, entryPoint: 'spatialShadowMeshVertex', buffers: [{ arrayStride: 24, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }] },
            primitive: { topology: 'triangle-list' }, depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less-equal' } };
        const pipeline = await withErrorScope(device, () => device.createRenderPipelineAsync ? device.createRenderPipelineAsync(descriptor) : device.createRenderPipeline(descriptor));
        shadow.beginFrame();
        const mesh = geometry.mesh, wind = geometry.meshWind;
        for (let vertex = 0; vertex < mesh.length / 6; vertex++) {
            if (geometry.meshMaterials?.[vertex] === 4) continue;
            const at = vertex * 6, w = vertex * 8;
            const radius = wind ? Math.hypot(mesh[at] - wind[w], mesh[at + 1] - wind[w + 1], mesh[at + 2] - wind[w + 2]) * Math.abs(wind[w + 3] * wind[w + 5]) : 0;
            shadow.addCaster(mesh[at], mesh[at + 1], mesh[at + 2], radius + .02);
        }
        const towardSun = spatialKeyLightDirection(settings);
        // The engine math scratch is shared across passes; each live lane owns
        // its saved matrix so Studio and desktop shadows cannot alias it.
        const light = new Float32Array(shadow.computeLightMatrix(towardSun.map(value => -value)));
        const casters = { flushShadowDepth(pass) { pass.setPipeline(pipeline); pass.setBindGroup(0, sourceBindings); pass.setBindGroup(1, lightBindings); pass.setVertexBuffer(0, meshBuffer);
            for (const range of casterRanges) if (range.count) pass.draw(range.count, 1, frameVertices + range.start, range.groupId); } };
        return { dispose, encodeDepth(encoder) { if (disposed) throw new Error('Geometry shadows are disposed'); device.queue.writeBuffer(lightBuffer, 0, light); shadow.renderShadowDepth(encoder, casters, light); },
            composite(encoder, colorView, depthTexture, camera, width, height) { shadow.composite(encoder, colorView, depthTexture, mat4Inverse(spatialCameraViewProjection(camera)), light, width, height, camera.eye); },
            mapSize: shadow.mapSize, buffers: 2, textures: 1, bytes: shadow.mapSize ** 2 * 4 + 64 + shadow.uniformBuffer.size };
    } catch (error) { dispose(); throw error; }
}
