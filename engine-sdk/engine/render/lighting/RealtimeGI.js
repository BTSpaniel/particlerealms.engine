// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Real-Time Global Illumination System
 * Implements compute-based radiance cascades and probe-based lighting
 * Based on techniques from Lumen (UE5) and DDGI (NVIDIA)
 * Now powered by vGPU driver
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

// Reusable buffers for hot paths (reduce/reuse/recycle)
const _giParamsF32 = new Float32Array(4);

export class RealtimeGI {
    constructor(device, options = {}) {
        this.vgpu = initVGPU(device);
        this.device = device;
        this.probeGridSize = options.probeGridSize || [32, 16, 32];
        this.probeSpacing = options.probeSpacing || 4.0;
        this.raysPerProbe = options.raysPerProbe || 256;
        this.bounces = options.bounces || 2;
        this.gridOrigin = options.gridOrigin || [0, 0, 0];
        this.hysteresis = options.hysteresis || 0.97; // Temporal stability
        
        // Probe grid buffers
        this.probePositions = null;
        this.probeIrradiance = null;
        this.probeDepth = null;
        this.probeStates = null;
        
        // Ray tracing
        this.rayBuffer = null;
        this.hitBuffer = null;
        
        // Params buffer
        this.paramsBuffer = null;
        this.probeGridBuffer = null;
        
        // Bind groups
        this.rayGenBindGroup = null;
        this.probeUpdateBindGroup = null;
        
        // Pipelines
        this.rayGenPipeline = null;
        this.probeUpdatePipeline = null;
        this.rayTracePipeline = null;
        
        this.frameIndex = 0;
    }

    async init() {
        await this._createBuffers();
        await this._createPipelines();
        console.log('[RealtimeGI] Initialized - Probe-based GI ready');
    }

    async _createBuffers() {
        const totalProbes = this.probeGridSize[0] * this.probeGridSize[1] * this.probeGridSize[2];
        
        // Probe positions (computed from grid)
        this.probePositions = this.vgpu.buffer.create({
            size: totalProbes * 16, usage: 'storage', label: 'ProbePositions'
        }).buffer;

        // Probe irradiance (spherical harmonics, 9 RGB coefficients = 27 floats per probe)
        this.probeIrradiance = this.vgpu.buffer.create({
            size: totalProbes * 9 * 3 * 4, usage: 'storage', label: 'ProbeIrradiance'
        }).buffer;

        // Probe depth (for visibility testing)
        this.probeDepth = this.vgpu.buffer.create({
            size: totalProbes * this.raysPerProbe * 4, usage: 'storage', label: 'ProbeDepth'
        }).buffer;

        // Ray buffer for probe updates (origin, direction, radiance, hitDistance)
        this.rayBuffer = this.vgpu.buffer.create({
            size: totalProbes * this.raysPerProbe * 32, usage: 'storage', label: 'GIRayBuffer'
        }).buffer;

        // Params buffer
        this.paramsBuffer = this.vgpu.buffer.create({
            size: 64, usage: 'uniform', label: 'GIParams'
        }).buffer;

        // Probe grid configuration buffer
        this.probeGridBuffer = this.vgpu.buffer.create({
            size: 64, usage: 'uniform', label: 'ProbeGridConfig'
        }).buffer;

        // Initialize probe positions
        this._initializeProbePositions(totalProbes);
    }

    _initializeProbePositions(totalProbes) {
        const positions = new Float32Array(totalProbes * 4);
        let idx = 0;
        
        for (let z = 0; z < this.probeGridSize[2]; z++) {
            for (let y = 0; y < this.probeGridSize[1]; y++) {
                for (let x = 0; x < this.probeGridSize[0]; x++) {
                    positions[idx * 4 + 0] = this.gridOrigin[0] + x * this.probeSpacing;
                    positions[idx * 4 + 1] = this.gridOrigin[1] + y * this.probeSpacing;
                    positions[idx * 4 + 2] = this.gridOrigin[2] + z * this.probeSpacing;
                    positions[idx * 4 + 3] = 1.0; // Active flag
                    idx++;
                }
            }
        }
        
        this.device.queue.writeBuffer(this.probePositions, 0, positions);

        // Update grid config buffer
        const gridConfig = new Float32Array([
            this.gridOrigin[0], this.gridOrigin[1], this.gridOrigin[2], this.probeSpacing,
            this.probeGridSize[0], this.probeGridSize[1], this.probeGridSize[2], this.raysPerProbe,
        ]);
        this.device.queue.writeBuffer(this.probeGridBuffer, 0, gridConfig);
    }

    async _createPipelines() {
        const probeUpdateShader = this.vgpu.shader.compile('probeUpdate', `
struct Probe {
    position: vec3<f32>,
    active: u32,
}

struct Ray {
    origin: vec3<f32>,
    direction: vec3<f32>,
    radiance: vec3<f32>,
    hitDistance: f32,
}

struct SHCoeffs {
    rgb: array<vec3<f32>, 9>,
}

@group(0) @binding(0) var<storage, read> probes: array<Probe>;
@group(0) @binding(1) var<storage, read> rays: array<Ray>;
@group(0) @binding(2) var<storage, read_write> irradiance: array<SHCoeffs>;
@group(0) @binding(3) var<uniform> params: vec4<f32>; // frameIndex, blend, etc

// Spherical harmonics basis functions (for lighting storage)
fn evalSH(dir: vec3<f32>) -> array<f32, 9> {
    var sh: array<f32, 9>;
    
    // L0
    sh[0] = 0.282095;
    
    // L1
    sh[1] = 0.488603 * dir.y;
    sh[2] = 0.488603 * dir.z;
    sh[3] = 0.488603 * dir.x;
    
    // L2
    sh[4] = 1.092548 * dir.x * dir.y;
    sh[5] = 1.092548 * dir.y * dir.z;
    sh[6] = 0.315392 * (3.0 * dir.z * dir.z - 1.0);
    sh[7] = 1.092548 * dir.x * dir.z;
    sh[8] = 0.546274 * (dir.x * dir.x - dir.y * dir.y);
    
    return sh;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let probeId = gid.x;
    if (probeId >= arrayLength(&probes)) {
        return;
    }
    
    let probe = probes[probeId];
    if (probe.active == 0u) {
        return;
    }
    
    // Accumulate radiance from rays
    var newSH: array<vec3<f32>, 9>;
    for (var i = 0u; i < 9u; i++) {
        newSH[i] = vec3<f32>(0.0);
    }
    
    let raysPerProbe = 256u; // TODO: Make configurable
    for (var rayId = 0u; rayId < raysPerProbe; rayId++) {
        let ray = rays[probeId * raysPerProbe + rayId];
        let sh = evalSH(ray.direction);
        
        for (var i = 0u; i < 9u; i++) {
            newSH[i] += ray.radiance * sh[i];
        }
    }
    
    // Normalize
    let scale = 1.0 / f32(raysPerProbe);
    for (var i = 0u; i < 9u; i++) {
        newSH[i] *= scale;
    }
    
    // Temporal blend with previous frame
    let blend = params.y;
    let oldSH = irradiance[probeId];
    for (var i = 0u; i < 9u; i++) {
        newSH[i] = mix(oldSH.rgb[i], newSH[i], blend);
    }
    
    // Store updated SH coefficients
    irradiance[probeId].rgb = newSH;
}
            `);

        this.probeUpdatePipeline = this.vgpu.pipeline.compute({
            module: probeUpdateShader, entryPoint: 'main',
            label: 'ProbeUpdatePipeline'
        });

        // Ray generation pipeline (generates rays from probes using Fibonacci sphere)
        const rayGenShader = this.vgpu.shader.compile('rayGen', `
struct Probe {
    position: vec3<f32>,
    active: f32,
}

struct Ray {
    origin: vec3<f32>,
    padding1: f32,
    direction: vec3<f32>,
    padding2: f32,
    radiance: vec3<f32>,
    hitDistance: f32,
}

struct Params {
    frameIndex: u32,
    raysPerProbe: u32,
    randomSeed: f32,
    padding: f32,
}

@group(0) @binding(0) var<storage, read> probes: array<Probe>;
@group(0) @binding(1) var<storage, read_write> rays: array<Ray>;
@group(0) @binding(2) var<uniform> params: Params;

// Fibonacci sphere for uniform ray distribution
fn fibonacciSphere(idx: u32, total: u32, rotation: f32) -> vec3<f32> {
    let goldenRatio = 1.618033988749895;
    let i = f32(idx);
    let n = f32(total);
    
    let theta = 2.0 * 3.14159265 * i / goldenRatio + rotation;
    let phi = acos(1.0 - 2.0 * (i + 0.5) / n);
    
    return vec3<f32>(
        sin(phi) * cos(theta),
        cos(phi),
        sin(phi) * sin(theta)
    );
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let rayIdx = gid.x;
    let probeIdx = rayIdx / params.raysPerProbe;
    let localRayIdx = rayIdx % params.raysPerProbe;
    
    if (probeIdx >= arrayLength(&probes)) {
        return;
    }
    
    let probe = probes[probeIdx];
    if (probe.active < 0.5) {
        return;
    }
    
    // Generate ray direction using Fibonacci sphere with frame-based rotation
    let rotation = params.randomSeed + f32(params.frameIndex) * 0.618033988749895;
    let direction = fibonacciSphere(localRayIdx, params.raysPerProbe, rotation);
    
    // Initialize ray
    var ray: Ray;
    ray.origin = probe.position;
    ray.direction = direction;
    ray.radiance = vec3<f32>(0.0);
    ray.hitDistance = 1000.0; // Max distance
    
    rays[rayIdx] = ray;
}
        `);

        this.rayGenPipeline = this.vgpu.pipeline.compute({
            module: rayGenShader, entryPoint: 'main',
            label: 'RayGenPipeline'
        });
    }

    /**
     * Update params buffer
     */
    _updateParams() {
        // Reuse module-level buffer
        _giParamsF32[1] = 1.0 - this.hysteresis;
        _giParamsF32[2] = 0;
        _giParamsF32[3] = 0;
        const paramsDataU32 = new Uint32Array(_giParamsF32.buffer);
        paramsDataU32[0] = this.frameIndex;
        this.device.queue.writeBuffer(this.paramsBuffer, 0, _giParamsF32);
    }

    /**
     * Create bind groups
     */
    _createBindGroups() {
        // Ray generation bind group
        this.rayGenBindGroup = this.device.createBindGroup({
            layout: this.rayGenPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.probePositions } },
                { binding: 1, resource: { buffer: this.rayBuffer } },
                { binding: 2, resource: { buffer: this.paramsBuffer } },
            ],
            label: 'RayGenBindGroup',
        });

        // Probe update bind group
        this.probeUpdateBindGroup = this.device.createBindGroup({
            layout: this.probeUpdatePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.probePositions } },
                { binding: 1, resource: { buffer: this.rayBuffer } },
                { binding: 2, resource: { buffer: this.probeIrradiance } },
                { binding: 3, resource: { buffer: this.paramsBuffer } },
            ],
            label: 'ProbeUpdateBindGroup',
        });
    }

    /**
     * Update probe irradiance (once per frame or less)
     */
    updateProbes(commandEncoder) {
        const totalProbes = this.probeGridSize[0] * this.probeGridSize[1] * this.probeGridSize[2];
        const totalRays = totalProbes * this.raysPerProbe;

        // Update params
        this._updateParams();
        
        // Create bind groups
        this._createBindGroups();
        
        // 1. Generate rays from probes
        {
            const pass = commandEncoder.beginComputePass({ label: 'GIRayGen' });
            pass.setPipeline(this.rayGenPipeline);
            pass.setBindGroup(0, this.rayGenBindGroup);
            pass.dispatchWorkgroups(Math.ceil(totalRays / 64));
            pass.end();
        }
        
        // 2. Ray tracing would happen here (software or external)
        // For now, rays are initialized but not traced
        // In a full implementation, you'd trace rays against scene geometry
        
        // 3. Accumulate radiance into SH
        {
            const pass = commandEncoder.beginComputePass({ label: 'GIProbeUpdate' });
            pass.setPipeline(this.probeUpdatePipeline);
            pass.setBindGroup(0, this.probeUpdateBindGroup);
            pass.dispatchWorkgroups(Math.ceil(totalProbes / 64));
            pass.end();
        }
        
        this.frameIndex++;
    }

    /**
     * Get shader code for sampling GI in materials
     */
    getShaderSamplingCode() {
        return `
struct ProbeGridConfig {
    origin: vec3<f32>,
    spacing: f32,
    size: vec3<u32>,
    raysPerProbe: u32,
}

struct SHCoeffs {
    rgb: array<vec3<f32>, 9>,
}

@group(2) @binding(0) var<storage, read> probeIrradiance: array<SHCoeffs>;
@group(2) @binding(1) var<uniform> probeGrid: ProbeGridConfig;

fn sampleGI(worldPos: vec3<f32>, normal: vec3<f32>) -> vec3<f32> {
    // Convert to grid coordinates
    let gridPos = (worldPos - probeGrid.origin) / probeGrid.spacing;
    let baseCoord = vec3<i32>(floor(gridPos));
    let frac = fract(gridPos);
    
    // Bounds check
    if (any(baseCoord < vec3<i32>(0)) || 
        any(baseCoord >= vec3<i32>(probeGrid.size) - 1)) {
        return vec3<f32>(0.0);
    }
    
    // SH evaluation for normal direction
    var sh: array<f32, 9>;
    sh[0] = 0.282095;
    sh[1] = 0.488603 * normal.y;
    sh[2] = 0.488603 * normal.z;
    sh[3] = 0.488603 * normal.x;
    sh[4] = 1.092548 * normal.x * normal.y;
    sh[5] = 1.092548 * normal.y * normal.z;
    sh[6] = 0.315392 * (3.0 * normal.z * normal.z - 1.0);
    sh[7] = 1.092548 * normal.x * normal.z;
    sh[8] = 0.546274 * (normal.x * normal.x - normal.y * normal.y);
    
    // Trilinear interpolation of 8 nearest probes
    var result = vec3<f32>(0.0);
    
    for (var dz = 0u; dz < 2u; dz++) {
        for (var dy = 0u; dy < 2u; dy++) {
            for (var dx = 0u; dx < 2u; dx++) {
                let coord = baseCoord + vec3<i32>(dx, dy, dz);
                let probeIdx = u32(coord.z) * probeGrid.size.y * probeGrid.size.x +
                              u32(coord.y) * probeGrid.size.x +
                              u32(coord.x);
                
                let weight = (1.0 - f32(dx)) * (1.0 - frac.x) + f32(dx) * frac.x;
                let weightY = (1.0 - f32(dy)) * (1.0 - frac.y) + f32(dy) * frac.y;
                let weightZ = (1.0 - f32(dz)) * (1.0 - frac.z) + f32(dz) * frac.z;
                let totalWeight = weight * weightY * weightZ;
                
                // Evaluate SH
                let probeSH = probeIrradiance[probeIdx];
                for (var i = 0u; i < 9u; i++) {
                    result += probeSH.rgb[i] * sh[i] * totalWeight;
                }
            }
        }
    }
    
    return max(result, vec3<f32>(0.0));
}
        `;
    }

    /**
     * Get probe irradiance buffer for shader binding
     */
    getIrradianceBuffer() {
        return this.probeIrradiance;
    }

    /**
     * Get probe grid config buffer for shader binding
     */
    getGridConfigBuffer() {
        return this.probeGridBuffer;
    }

    getStats() {
        const totalProbes = this.probeGridSize[0] * this.probeGridSize[1] * this.probeGridSize[2];
        return {
            totalProbes,
            raysPerProbe: this.raysPerProbe,
            totalRays: totalProbes * this.raysPerProbe,
            frameIndex: this.frameIndex,
        };
    }

    destroy() {
        if (this.probeIrradiance) this.probeIrradiance.destroy();
        if (this.probeDepth) this.probeDepth.destroy();
        if (this.rayBuffer) this.rayBuffer.destroy();
    }
}
