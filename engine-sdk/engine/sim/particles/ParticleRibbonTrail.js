// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleRibbonTrail.js - GPU ribbon/trail rendering for particles
 * 
 * Connects particle position history into continuous camera-facing triangle strips
 * for smoke trails, magic effects, and motion streaks.
 * 
 * Architecture:
 * 1. Trail Update (compute): shifts history ring buffer back, inserts current position
 * 2. Ribbon Render (vertex+fragment): reads trail history, generates camera-facing
 *    triangle strip with width tapering and alpha fade
 * 
 * Each particle trail is rendered as one triangle strip instance.
 * Vertex count per instance = historyLength × 2.
 * No intermediate vertex buffer needed — the vertex shader reads history directly.
 * 
 * Ref: GPU Gems 3 Ch.23, UE5 Niagara ribbon renderer
 */

import { createUniformBuffer, createStorageBuffer, updateBuffer } from "../../core/gpu/GpuBuffer.js";
import { labelResource } from "../../core/gpu/GpuDebug.js";

// ============================================================================
// TRAIL UPDATE COMPUTE SHADER
// ============================================================================

const TRAIL_UPDATE_SHADER = `
struct TrailParams {
    maxParticles: u32,
    historyLength: u32,
    _pad0: u32,
    _pad1: u32,
}

@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> trailHistory: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> trailParams: TrailParams;
@group(0) @binding(3) var<storage, read> velocities: array<vec4<f32>>;

@compute @workgroup_size(256)
fn updateTrails(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= trailParams.maxParticles) { return; }

    let pos = positions[idx];
    let histLen = trailParams.historyLength;
    let base = idx * histLen;

    // Dead particle: age (pos.w) exceeds lifetime (velocities.w)
    let lifetime = velocities[idx].w;
    if (pos.w >= lifetime) {
        for (var i = 0u; i < histLen; i++) {
            trailHistory[base + i] = vec4<f32>(0.0, 0.0, 0.0, 0.0);
        }
        return;
    }

    // Shift history back (oldest entries get overwritten)
    for (var i = histLen - 1u; i > 0u; i = i - 1u) {
        trailHistory[base + i] = trailHistory[base + i - 1u];
    }

    // Insert current position at head (w=1 = visible)
    trailHistory[base] = vec4<f32>(pos.xyz, 1.0);
}
`;

// ============================================================================
// RIBBON RENDER SHADERS
// ============================================================================

const RIBBON_RENDER_SHADER = `
struct RibbonUniforms {
    viewProj: mat4x4<f32>,
    cameraPos: vec3<f32>,
    ribbonWidth: f32,
    historyLength: u32,
    maxParticles: u32,
    colorR: f32,
    colorG: f32,
    colorB: f32,
    opacity: f32,
    _pad0: u32,
    _pad1: u32,
}

struct VSOut {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) alpha: f32,
}

@group(0) @binding(0) var<uniform> ribbon: RibbonUniforms;
@group(0) @binding(1) var<storage, read> trailHistory: array<vec4<f32>>;

@vertex
fn ribbonVS(@builtin(vertex_index) vertexIndex: u32,
            @builtin(instance_index) instanceIndex: u32) -> VSOut {
    var out: VSOut;

    let particleIdx = instanceIndex;
    let histLen = ribbon.historyLength;
    let base = particleIdx * histLen;

    let pointIdx = vertexIndex / 2u;
    let side = f32(vertexIndex % 2u) * 2.0 - 1.0; // -1 or +1

    // Clamp point index to valid range
    let clampedPoint = min(pointIdx, histLen - 1u);
    let histEntry = trailHistory[base + clampedPoint];
    let histPos = histEntry.xyz;
    let histAlpha = histEntry.w;

    // If this history point is empty, degenerate the vertex
    if (histAlpha <= 0.0) {
        out.position = vec4<f32>(0.0, 0.0, -2.0, 1.0);
        out.alpha = 0.0;
        out.uv = vec2<f32>(0.0);
        return out;
    }

    // Compute tangent from adjacent history points
    var tangent: vec3<f32>;
    if (clampedPoint == 0u) {
        let nextEntry = trailHistory[base + 1u];
        if (nextEntry.w > 0.0) {
            tangent = histPos - nextEntry.xyz;
        } else {
            tangent = vec3<f32>(0.0, 1.0, 0.0);
        }
    } else if (clampedPoint >= histLen - 1u) {
        let prevEntry = trailHistory[base + clampedPoint - 1u];
        tangent = prevEntry.xyz - histPos;
    } else {
        let prevEntry = trailHistory[base + clampedPoint - 1u];
        let nextEntry = trailHistory[base + clampedPoint + 1u];
        if (nextEntry.w > 0.0) {
            tangent = prevEntry.xyz - nextEntry.xyz;
        } else {
            tangent = prevEntry.xyz - histPos;
        }
    }

    let tangentLen = length(tangent);
    if (tangentLen < 0.0001) {
        out.position = vec4<f32>(0.0, 0.0, -2.0, 1.0);
        out.alpha = 0.0;
        out.uv = vec2<f32>(0.0);
        return out;
    }
    tangent = tangent / tangentLen;

    // Camera-facing perpendicular (billboard ribbon)
    let viewDir = normalize(ribbon.cameraPos - histPos);
    var perp = cross(tangent, viewDir);
    let perpLen = length(perp);
    if (perpLen < 0.0001) {
        // Tangent parallel to view — use fallback perpendicular
        perp = cross(tangent, vec3<f32>(0.0, 1.0, 0.0));
    }
    perp = normalize(perp);

    // Width tapering: full at head, zero at tail (quadratic)
    let t = f32(clampedPoint) / f32(max(histLen - 1u, 1u));
    let width = ribbon.ribbonWidth * (1.0 - t * t);

    let worldPos = histPos + perp * side * width * 0.5;

    out.position = ribbon.viewProj * vec4<f32>(worldPos, 1.0);
    out.uv = vec2<f32>((side + 1.0) * 0.5, t);
    out.alpha = histAlpha * (1.0 - t) * ribbon.opacity;

    return out;
}

@fragment
fn ribbonFS(input: VSOut) -> @location(0) vec4<f32> {
    if (input.alpha < 0.005) { discard; }

    // Soft edge along ribbon width
    let edgeDist = abs(input.uv.x * 2.0 - 1.0);
    let softEdge = 1.0 - smoothstep(0.7, 1.0, edgeDist);

    let finalAlpha = input.alpha * softEdge;
    let color = vec3<f32>(ribbon.colorR, ribbon.colorG, ribbon.colorB);
    return vec4<f32>(color * finalAlpha, finalAlpha);
}
`;

// ============================================================================
// SYSTEM CREATION
// ============================================================================

// RibbonUniforms struct size: mat4(64) + vec3+f32(16) + u32×2+f32×5+u32(32) = 112 → aligned to 16 = 112
const RIBBON_UNIFORMS_SIZE = 112;
const TRAIL_PARAMS_SIZE = 16;

/**
 * Create ribbon trail system.
 * @param {GPUDevice} device
 * @param {number} maxParticles
 * @param {number} historyLength - Number of position history frames per particle (default 8)
 * @param {string} targetFormat - Render target format (e.g. 'bgra8unorm', 'rgba16float')
 * @param {object} options - { depthFormat, blendMode }
 */
export function createRibbonTrailSystem(device, maxParticles, historyLength = 8, targetFormat = 'bgra8unorm', options = {}) {
    const depthFormat = options.depthFormat || null; // null = no depth (compatible with half-res pass)

    // Trail history buffer: maxParticles × historyLength × vec4<f32>
    const historyBufferSize = maxParticles * historyLength * 16;
    const trailHistoryBuffer = createStorageBuffer(device, historyBufferSize, {
        label: "RibbonTrail.history",
    });
    labelResource(trailHistoryBuffer, "RibbonTrail.history");

    // Trail update compute pipeline
    const updateModule = device.createShaderModule({
        label: "RibbonTrail.updateShader",
        code: TRAIL_UPDATE_SHADER,
    });
    const updatePipeline = device.createComputePipeline({
        label: "RibbonTrail.updatePipeline",
        layout: "auto",
        compute: { module: updateModule, entryPoint: "updateTrails" },
    });

    // Trail params uniform
    const trailParamsBuffer = createUniformBuffer(device, TRAIL_PARAMS_SIZE, {
        label: "RibbonTrail.trailParams",
    });
    labelResource(trailParamsBuffer, "RibbonTrail.trailParams");
    const trailParamsData = new Uint32Array(4);
    trailParamsData[0] = maxParticles;
    trailParamsData[1] = historyLength;
    updateBuffer(device, trailParamsBuffer, trailParamsData, 0);

    // Ribbon render pipeline
    const renderModule = device.createShaderModule({
        label: "RibbonTrail.renderShader",
        code: RIBBON_RENDER_SHADER,
    });

    const renderPipeline = device.createRenderPipeline({
        label: "RibbonTrail.renderPipeline",
        layout: "auto",
        vertex: {
            module: renderModule,
            entryPoint: "ribbonVS",
        },
        fragment: {
            module: renderModule,
            entryPoint: "ribbonFS",
            targets: [{
                format: targetFormat,
                blend: {
                    color: {
                        srcFactor: 'one',
                        dstFactor: 'one-minus-src-alpha',
                        operation: 'add',
                    },
                    alpha: {
                        srcFactor: 'one',
                        dstFactor: 'one-minus-src-alpha',
                        operation: 'add',
                    },
                },
                writeMask: GPUColorWrite.ALL,
            }],
        },
        primitive: {
            topology: 'triangle-strip',
            stripIndexFormat: undefined,
        },
        // Depth stencil is optional — omit for render passes without depth (e.g. half-res)
        ...(depthFormat ? {
            depthStencil: {
                format: depthFormat,
                depthWriteEnabled: false, // Trails are translucent
                depthCompare: 'less-equal',
            },
        } : {}),
    });

    // Ribbon uniforms buffer
    const ribbonUniformsBuffer = createUniformBuffer(device, RIBBON_UNIFORMS_SIZE, {
        label: "RibbonTrail.ribbonUniforms",
    });
    labelResource(ribbonUniformsBuffer, "RibbonTrail.ribbonUniforms");

    console.log(`[RibbonTrail] System created (${maxParticles} particles, ${historyLength} history frames, ${historyBufferSize / 1024}KB)`);

    return {
        device,
        maxParticles,
        historyLength,
        trailHistoryBuffer,
        updatePipeline,
        trailParamsBuffer,
        renderPipeline,
        ribbonUniformsBuffer,
        updateBindGroup: null,
        renderBindGroup: null,
        enabled: true,
        // Default visual params
        ribbonWidth: 0.15,
        color: [1.0, 0.8, 0.4],
        opacity: 0.6,
    };
}

// ============================================================================
// BIND GROUPS
// ============================================================================

/**
 * Initialize bind groups for the trail system.
 * Call after the position buffer is available.
 */
export function initRibbonTrailBindGroups(system, device, positionsBuffer, velocitiesBuffer) {
    if (!system) return;

    // Update compute bind group (binding 3 = velocities for dead particle detection)
    system.updateBindGroup = device.createBindGroup({
        label: "RibbonTrail.updateBindGroup",
        layout: system.updatePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: positionsBuffer } },
            { binding: 1, resource: { buffer: system.trailHistoryBuffer } },
            { binding: 2, resource: { buffer: system.trailParamsBuffer } },
            { binding: 3, resource: { buffer: velocitiesBuffer } },
        ],
    });

    // Render bind group
    system.renderBindGroup = device.createBindGroup({
        label: "RibbonTrail.renderBindGroup",
        layout: system.renderPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: system.ribbonUniformsBuffer } },
            { binding: 1, resource: { buffer: system.trailHistoryBuffer } },
        ],
    });
}

// ============================================================================
// EXECUTION
// ============================================================================

// Pre-allocated uniform data buffers
const _ribbonUniformData = new Float32Array(RIBBON_UNIFORMS_SIZE / 4);
const _ribbonUniformU32 = new Uint32Array(_ribbonUniformData.buffer);

/**
 * Update trail history for all particles (compute pass).
 * Call once per frame AFTER the main sim step.
 */
export function updateTrailHistory(system, device) {
    if (!system || !system.updateBindGroup || !system.enabled) return;

    const encoder = device.createCommandEncoder({ label: "RibbonTrail.update.encoder" });
    const pass = encoder.beginComputePass({ label: "RibbonTrail.update.pass" });
    pass.setPipeline(system.updatePipeline);
    pass.setBindGroup(0, system.updateBindGroup);
    pass.dispatchWorkgroups(Math.ceil(system.maxParticles / 256));
    pass.end();
    device.queue.submit([encoder.finish()]);
}

/**
 * Render ribbon trails into the current render pass.
 * @param {GPURenderPassEncoder} pass - Active render pass
 * @param {Object} system - Ribbon trail system
 * @param {Float32Array} viewProjMatrix - 4×4 view-projection matrix (16 floats)
 * @param {Array|Float32Array} cameraPos - Camera position [x, y, z]
 * @param {number} instanceCount - Number of particles to render trails for
 */
export function renderRibbonTrails(pass, system, viewProjMatrix, cameraPos, instanceCount) {
    if (!system || !system.renderBindGroup || !system.enabled || instanceCount <= 0) return;

    // Update ribbon uniforms
    const f = _ribbonUniformData;
    const u = _ribbonUniformU32;

    // viewProj matrix (offsets 0-15)
    for (let i = 0; i < 16; i++) {
        f[i] = viewProjMatrix[i];
    }
    // cameraPos (offsets 16-18)
    f[16] = cameraPos[0] || 0;
    f[17] = cameraPos[1] || 0;
    f[18] = cameraPos[2] || 0;
    // ribbonWidth (offset 19)
    f[19] = system.ribbonWidth;
    // historyLength (offset 20, u32)
    u[20] = system.historyLength;
    // maxParticles (offset 21, u32)
    u[21] = system.maxParticles;
    // color RGB (offsets 22-24)
    f[22] = system.color[0];
    f[23] = system.color[1];
    f[24] = system.color[2];
    // opacity (offset 25)
    f[25] = system.opacity;

    updateBuffer(system.device, system.ribbonUniformsBuffer, f, 0);

    pass.setPipeline(system.renderPipeline);
    pass.setBindGroup(0, system.renderBindGroup);
    // Each instance = one particle trail, vertices = historyLength × 2 (triangle strip)
    pass.draw(system.historyLength * 2, instanceCount, 0, 0);
}

// ============================================================================
// CLEANUP
// ============================================================================

/**
 * Destroy ribbon trail system resources.
 */
export function destroyRibbonTrailSystem(system) {
    if (!system) return;
    if (system.trailHistoryBuffer) system.trailHistoryBuffer.destroy();
    if (system.trailParamsBuffer) system.trailParamsBuffer.destroy();
    if (system.ribbonUniformsBuffer) system.ribbonUniformsBuffer.destroy();
    console.log("[RibbonTrail] System destroyed");
}
