// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>

//

// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha



/**

 * World3DPreviewRenderer.js - Real 3D WebGPU World Preview

 * Now powered by vGPU driver

 *

 * Renders a live 3D view of the world from a floating camera above.

 * Shows actual terrain chunks with rotation and lighting.

 */



import { acquireGpuDeviceForConsumer } from '../core/gpu/GpuDeviceOwnership.js';
import { acquireVGPU } from '../core/gpu/VirtualGPU.js';
import {
    LEGACY_PCG32_WGSL,
    LEGACY_RENDER_RUNTIME_PCG_HASH_WGSL,
} from '../core/math/MathBits.js';
import { degreesToRadians } from '../core/math/UnitMath.js';


// Reusable buffer for hot paths (reduce/reuse/recycle)

const _world3DUniformData = new Float32Array(8);
let world3DPreviewOwnerSequence = 0;



// Raymarched planet terrain shader - renders actual chunk data as terrain

const PREVIEW_SHADER = `

const PI: f32 = 3.14159265359;

const PLANET_RADIUS: f32 = 1.0;

const MAX_HEIGHT: f32 = 0.35;

const MAX_RAY_DIST: f32 = 1.6;

const TERRAIN_STEPS: i32 = 100;

const TERRAIN_EPS: f32 = 0.003;



struct Uniforms {

    time: f32,

    hasChunks: f32,  // 1.0 if we have chunk data, 0.0 for procedural

    _pad0: f32,

    _pad1: f32,

    _pad2: f32,

    _pad3: f32,

    _pad4: vec2<f32>,

}



@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@group(0) @binding(1) var heightmapTex: texture_2d<f32>;

@group(0) @binding(2) var heightmapSampler: sampler;



struct VertexOutput {

    @builtin(position) position: vec4<f32>,

    @location(0) uv: vec2<f32>,

}



@vertex

fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {

    var pos = array<vec2<f32>, 6>(

        vec2<f32>(-1.0, -1.0),

        vec2<f32>(1.0, -1.0),

        vec2<f32>(1.0, 1.0),

        vec2<f32>(-1.0, -1.0),

        vec2<f32>(1.0, 1.0),

        vec2<f32>(-1.0, 1.0)

    );

    var output: VertexOutput;

    output.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);

    output.uv = pos[vertexIndex];

    return output;

}



// PCG hash - deterministic across all GPUs
${LEGACY_PCG32_WGSL}
${LEGACY_RENDER_RUNTIME_PCG_HASH_WGSL}

fn hash(n: f32) -> f32 {
    return f32(pcg_prev(bitcast<u32>(n))) / 4294967295.0;

}



// 3D noise

fn noise3d(x: vec3<f32>) -> f32 {

    let p = floor(x);

    let f = fract(x);

    let ff = f * f * (3.0 - 2.0 * f);

    let n = p.x + p.y * 157.0 + 113.0 * p.z;

    return mix(

        mix(mix(hash(n + 0.0), hash(n + 1.0), ff.x),

            mix(hash(n + 157.0), hash(n + 158.0), ff.x), ff.y),

        mix(mix(hash(n + 113.0), hash(n + 114.0), ff.x),

            mix(hash(n + 270.0), hash(n + 271.0), ff.x), ff.y),

        ff.z

    );

}



// FBM noise

fn fbm(pos: vec3<f32>) -> f32 {

    var p = pos;

    var H = 0.5;

    var t = 0.0;

    for (var i = 0; i < 4; i++) {

        t += noise3d(p) * H;

        p *= 2.0276;

        H *= 0.5;

    }

    return t;

}



// Sample heightmap - converts 3D sphere position to 2D UV

fn sampleHeightmap(pos: vec3<f32>) -> vec4<f32> {

    // Convert sphere position to lat/lon UV

    let n = normalize(pos);

    let u = 0.5 + atan2(n.z, n.x) / (2.0 * PI);

    let v = 0.5 + asin(clamp(n.y, -1.0, 1.0)) / PI;

    return textureSampleLevel(heightmapTex, heightmapSampler, vec2<f32>(u, v), 0.0);

}



// Get terrain height from heightmap or procedural

fn getTerrainHeight(pos: vec3<f32>) -> vec2<f32> {

    if (uniforms.hasChunks > 0.5) {

        // Sample from chunk heightmap

        let sample = sampleHeightmap(pos);

        let height = sample.r;  // R = height (0-1)

        let explored = sample.a; // A = explored (1.0 = yes)



        if (explored < 0.5) {

            // Unexplored - return very far distance

            return vec2<f32>(10.0, 0.0);

        }



        return vec2<f32>(length(pos) - PLANET_RADIUS - height * MAX_HEIGHT, height);

    } else {

        // Procedural fallback

        let h0 = fbm(pos * 2.5);

        let n0 = smoothstep(0.3, 0.8, h0);

        let h1 = fbm(pos * 4.0 + vec3<f32>(5.0, 3.0, 7.0));

        let n1 = smoothstep(0.5, 0.9, h1) * 0.5;

        let n = n0 + n1;

        return vec2<f32>(length(pos) - PLANET_RADIUS - n * MAX_HEIGHT, n);

    }

}



// Get material color from heightmap

fn getMaterialFromHeightmap(pos: vec3<f32>) -> f32 {

    if (uniforms.hasChunks > 0.5) {

        let sample = sampleHeightmap(pos);

        return sample.g; // G = material ID (normalized 0-1)

    }

    return 0.0;

}



// Terrain normal from gradient

fn getTerrainNormal(p: vec3<f32>) -> vec3<f32> {

    let dt = vec3<f32>(0.002, 0.0, 0.0);

    return normalize(vec3<f32>(

        getTerrainHeight(p + dt.xyy).x - getTerrainHeight(p - dt.xyy).x,

        getTerrainHeight(p + dt.yxy).x - getTerrainHeight(p - dt.yxy).x,

        getTerrainHeight(p + dt.yyx).x - getTerrainHeight(p - dt.yyx).x

    ));

}



// Rotation matrices

fn rotateY(angle: f32) -> mat3x3<f32> {

    let s = sin(angle); let c = cos(angle);

    return mat3x3<f32>(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);

}



fn rotateX(angle: f32) -> mat3x3<f32> {

    let s = sin(angle); let c = cos(angle);

    return mat3x3<f32>(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c);

}



// Lighting

fn setupLights(L: vec3<f32>, normal: vec3<f32>) -> vec3<f32> {

    var diffuse = vec3<f32>(0.0);

    diffuse += max(0.0, dot(L, normal)) * vec3<f32>(7.0, 5.0, 3.0);

    diffuse += clamp(0.25 + 0.5 * normal.y, 0.0, 1.0) * vec3<f32>(0.4, 0.6, 0.8) * 0.2;

    diffuse += clamp(0.12 + 0.8 * max(0.0, dot(-L, normal)), 0.0, 1.0) * vec3<f32>(0.4, 0.5, 0.6);

    return diffuse;

}



// Material colors

const C_WATER: vec3<f32> = vec3<f32>(0.015, 0.110, 0.455);

const C_SAND: vec3<f32> = vec3<f32>(0.76, 0.70, 0.50);

const C_GRASS: vec3<f32> = vec3<f32>(0.086, 0.132, 0.018);

const C_DIRT: vec3<f32> = vec3<f32>(0.45, 0.30, 0.15);

const C_STONE: vec3<f32> = vec3<f32>(0.40, 0.40, 0.42);

const C_SNOW: vec3<f32> = vec3<f32>(0.85, 0.88, 0.92);



// Get material color from ID or height

fn getMaterialColor(matId: f32, height: f32, normal: vec3<f32>) -> vec3<f32> {

    let slope = dot(normal, normalize(vec3<f32>(0.0, 1.0, 0.0)));



    // If we have chunk data, use material ID

    if (uniforms.hasChunks > 0.5 && matId > 0.01) {

        // Material IDs: 0=air, 1=stone, 2=dirt, 3=grass, 4=sand, 5=water, 6=wood, 7=leaves, 8=snow

        if (matId < 0.08) { return C_WATER; }      // Water (5)

        if (matId < 0.12) { return C_STONE; }      // Stone (1)

        if (matId < 0.16) { return C_DIRT; }       // Dirt (2)

        if (matId < 0.20) { return C_GRASS; }      // Grass (3)

        if (matId < 0.24) { return C_SAND; }       // Sand (4)

        if (matId < 0.32) { return C_SNOW; }       // Snow (8)

        if (matId < 0.36) { return vec3<f32>(0.4, 0.25, 0.1); } // Wood (6)

        if (matId < 0.40) { return vec3<f32>(0.15, 0.35, 0.1); } // Leaves (7)

        return C_GRASS; // Default

    }



    // Procedural material based on height and slope

    if (height < 0.08) { return C_WATER; }

    if (height < 0.15) { return C_SAND; }

    if (height > 0.7 && slope > 0.5) { return C_SNOW; }

    if (height > 0.5 || slope < 0.3) { return C_STONE; }

    if (height > 0.3) { return mix(C_GRASS, C_DIRT, smoothstep(0.3, 0.5, height)); }

    return C_GRASS;

}



// Illuminate terrain

fn illuminate(pos: vec3<f32>, rot: mat3x3<f32>, height: f32) -> vec3<f32> {

    let normal = getTerrainNormal(pos);

    let matId = getMaterialFromHeightmap(pos);

    let matColor = getMaterialColor(matId, height, normal);

    let L = rot * normalize(vec3<f32>(1.0, 0.8, 0.5));

    return matColor * setupLights(L, normal);

}



// Camera ray

fn getPrimaryRay(camLocalPoint: vec3<f32>, camOrigin: vec3<f32>, camLookAt: vec3<f32>) -> vec3<f32> {

    let fwd = normalize(camLookAt - camOrigin);

    let up = vec3<f32>(0.0, 1.0, 0.0);

    let right = cross(up, fwd);

    let upCorrected = cross(fwd, right);

    return normalize(fwd + upCorrected * camLocalPoint.y + right * camLocalPoint.x);

}



// Sphere intersection

fn intersectSphere(ro: vec3<f32>, rd: vec3<f32>, center: vec3<f32>, radius: f32) -> f32 {

    let rc = center - ro;

    let tca = dot(rc, rd);

    if (tca < 0.0) { return -1.0; }

    let d2 = dot(rc, rc) - tca * tca;

    let radius2 = radius * radius;

    if (d2 > radius2) { return -1.0; }

    let thc = sqrt(radius2 - d2);

    var t0 = tca - thc;

    if (t0 < 0.0) { t0 = tca + thc; }

    return t0;

}



fn linearToSrgb(color: vec3<f32>) -> vec3<f32> {

    return pow(color, vec3<f32>(1.0 / 2.2));

}



@fragment

fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {

    let FOV = tan(radians(30.0));

    let eye = vec3<f32>(0.0, 0.0, -2.5);

    let lookAt = vec3<f32>(0.0, 0.0, 2.0);

    let pointCam = vec3<f32>(input.uv * FOV, -1.0);

    let rayDir = getPrimaryRay(pointCam, eye, lookAt);



    // Slow rotation

    let rotY_m = rotateY(radians(27.0));

    let rot = rotateX(uniforms.time * -0.15) * rotY_m;



    let atmosphereRadius = PLANET_RADIUS + MAX_HEIGHT;

    let hitT = intersectSphere(eye, rayDir, vec3<f32>(0.0), atmosphereRadius);



    if (hitT < 0.0) {

        return vec4<f32>(0.02, 0.02, 0.05, 1.0);

    }



    // Raymarch terrain

    var t = 0.0;

    var df = vec2<f32>(1.0, 0.0);

    var pos = vec3<f32>(0.0);

    let hitOrigin = eye + rayDir * hitT;



    for (var i = 0; i < TERRAIN_STEPS; i++) {

        if (t > MAX_RAY_DIST) { break; }

        let o = hitOrigin + t * rayDir;

        pos = rot * o;

        df = getTerrainHeight(pos);

        if (df.x < TERRAIN_EPS) { break; }

        t += df.x * 0.5;

    }



    var color = vec3<f32>(0.02, 0.02, 0.05);



    if (df.x < TERRAIN_EPS) {

        color = illuminate(pos, rot, df.y);

    }



    // Atmosphere rim

    let rimFactor = 1.0 - abs(dot(rayDir, normalize(pos)));

    color += vec3<f32>(0.1, 0.2, 0.4) * pow(rimFactor, 3.0) * 0.5;



    color = linearToSrgb(color);

    return vec4<f32>(color, 1.0);

}

`;



// Terrain colors matching MaterialSchema

const MATERIAL_COLORS = {

    0: [0.0, 0.0, 0.0],      // AIR (transparent)

    1: [0.42, 0.42, 0.42],   // STONE

    2: [0.55, 0.35, 0.17],   // DIRT

    3: [0.29, 0.56, 0.29],   // GRASS

    4: [0.83, 0.72, 0.59],   // SAND

    5: [0.29, 0.56, 0.85],   // WATER

    6: [0.55, 0.27, 0.07],   // WOOD

    7: [0.18, 0.35, 0.18],   // LEAVES

    8: [0.94, 0.94, 0.94],   // SNOW

    9: [0.63, 0.83, 0.91],   // ICE

    10: [1.0, 0.27, 0.0],    // LAVA

    11: [0.24, 0.47, 0.24],  // CACTUS

    12: [0.24, 0.24, 0.27],  // DEEPSTONE

    13: [0.12, 0.08, 0.16],  // OBSIDIAN

    14: [0.71, 0.24, 0.08],  // MAGMA

    15: [0.78, 0.59, 1.0],   // CRYSTAL

};



export class World3DPreviewRenderer {

    constructor(options = {}) {

        this.vgpu = null;

        this.vgpuLease = null;

        this.deviceLease = null;

        this.deviceInput = options.gpuDevice || options.device || null;

        this.deviceOwnership = options.deviceOwnership || options.ownership || null;

        this.ownsDevice = options.ownsDevice === true;

        this.gpuProfile = options.profile || 'baseline-render';

        this.acquireDeviceLease = typeof options.acquireDeviceLease === 'function'

            ? options.acquireDeviceLease

            : acquireGpuDeviceForConsumer;

        this.acquireVGpuLease = typeof options.acquireVGpuLease === 'function'

            ? options.acquireVGpuLease

            : acquireVGPU;

        this.ownerId = options.ownerId || `world-3d-preview-${++world3DPreviewOwnerSequence}`;

        this.device = null;

        this.context = null;

        this.canvas = null;

        this.pipeline = null;

        this.uniformBuffer = null;

        this.heightmapTexture = null;

        this.heightmapSampler = null;

        this.bindGroup = null;



        this.rotation = 0;

        this.animationFrame = null;



        // Heightmap data

        this.heightmapSize = 256;

        this.heightmapData = null;

        this.worldRadius = 5.0;

        this.maxHeight = 2.0;

        this.hasChunks = false;  // True when using actual chunk data



        this.initialized = false;

        this.destroyed = false;

        this.lifecycleEpoch = 0;

        this.initPromise = null;

    }



    /**

     * Initialize WebGPU for the preview

     */

    init(container, options = {}) {

        if (this.destroyed) return Promise.resolve(false);

        if (this.initialized) return Promise.resolve(true);

        if (this.initPromise) return this.initPromise;

        const lifecycleEpoch = ++this.lifecycleEpoch;

        const initPromise = this.initialize(container, options, lifecycleEpoch);

        this.initPromise = initPromise;

        const clearInitPromise = () => {

            if (this.initPromise === initPromise) this.initPromise = null;

        };

        initPromise.then(clearInitPromise, clearInitPromise);

        return initPromise;

    }



    isLifecycleCurrent(lifecycleEpoch) {

        return !this.destroyed && lifecycleEpoch === this.lifecycleEpoch;

    }



    async initialize(container, options, lifecycleEpoch) {

        if (!navigator.gpu) {

            console.warn('[World3DPreview] WebGPU not available');

            return false;

        }



        // Create wrapper for layered canvases

        container.innerHTML = '';

        container.style.position = 'relative';



        // Create WebGPU canvas

        const canvas = document.createElement('canvas');

        this.canvas = canvas;

        canvas.style.width = '100%';

        canvas.style.height = '100%';

        canvas.style.position = 'absolute';

        canvas.style.top = '0';

        canvas.style.left = '0';

        container.appendChild(canvas);





        // Prefer caller/kernel injection. A standalone preview owns and releases
        // the fallback device explicitly.

        let candidateDeviceLease = null;

        let candidateVGpuLease = null;

        try {

            candidateDeviceLease = await this.acquireDeviceLease({

                ownerId: options.ownerId || this.ownerId,

                device: options.gpuDevice || options.device || this.deviceInput,

                ownership: options.deviceOwnership || options.ownership || this.deviceOwnership,

                ownsDevice: options.ownsDevice ?? this.ownsDevice,

                profile: options.profile || this.gpuProfile,

                label: 'World3DPreview.device',

            });

            if (!this.isLifecycleCurrent(lifecycleEpoch)) {

                candidateDeviceLease?.release?.();

                return false;

            }

            candidateVGpuLease = this.acquireVGpuLease(

                options.ownerId || this.ownerId,

                candidateDeviceLease.device,

            );

            if (!this.isLifecycleCurrent(lifecycleEpoch)) {

                candidateVGpuLease?.release?.();

                candidateDeviceLease?.release?.();

                return false;

            }

        } catch (error) {

            this.releaseInitializationCandidate({

                canvas,

                deviceLease: candidateDeviceLease,

                vgpuLease: candidateVGpuLease,

            });

            if (!this.isLifecycleCurrent(lifecycleEpoch)) return false;

            console.warn('[World3DPreview] GPU acquisition failed:', error);

            return false;

        }

        let initializationSucceeded = false;

        try {

        this.deviceLease = candidateDeviceLease;

        this.device = candidateDeviceLease.device;

        this.vgpuLease = candidateVGpuLease;

        this.vgpu = candidateVGpuLease.vgpu;



        // Setup context

        this.context = canvas.getContext('webgpu');

        const format = navigator.gpu.getPreferredCanvasFormat();



        this.context.configure({

            device: this.device,

            format: format,

            alphaMode: 'premultiplied',

        });



        // Create pipeline

        await this._createPipeline(format);

        if (!this.isLifecycleCurrent(lifecycleEpoch)) return false;



        // Create uniform buffer and sampler

        this.uniformBuffer = this.vgpu.buffer.create({ size: 32, usage: 'uniform', label: 'World3DPreviewUniforms' }).buffer;

        this.heightmapSampler = this.vgpu.texture.sampler({ filter: 'linear', addressMode: 'repeat' });



        // Create default heightmap (procedural - will be replaced with chunk data if available)

        await this._createDefaultHeightmap();

        if (!this.isLifecycleCurrent(lifecycleEpoch)) return false;



        if (!this.isLifecycleCurrent(lifecycleEpoch)) return false;

        this.initialized = true;

        initializationSucceeded = true;

        return true;

        } finally {

            if (!initializationSucceeded) {

                this.releaseInitializationCandidate({

                    canvas,

                    deviceLease: candidateDeviceLease,

                    vgpuLease: candidateVGpuLease,

                });

            }

        }

    }



    releaseInitializationCandidate({ canvas, deviceLease, vgpuLease }) {

        this.stopRendering();

        try { this.uniformBuffer?.destroy?.(); } catch (_) {}

        try { this.heightmapTexture?.destroy?.(); } catch (_) {}

        if (this.vgpuLease === vgpuLease) {

            try { this.vgpuLease?.release?.(); } catch (_) {}

            this.vgpuLease = null;

            this.vgpu = null;

        } else {

            try { vgpuLease?.release?.(); } catch (_) {}

        }

        if (this.canvas === canvas) {

            try { this.context?.unconfigure?.(); } catch (_) {}

            canvas?.remove?.();

            this.canvas = null;

            this.context = null;

        }

        if (this.deviceLease === deviceLease) {

            try { this.deviceLease?.release?.(); } catch (_) {}

            this.deviceLease = null;

            this.device = null;

        } else {

            try { deviceLease?.release?.(); } catch (_) {}

        }

        this.uniformBuffer = null;

        this.heightmapTexture = null;

        this.heightmapSampler = null;

        this.bindGroup = null;

        this.pipeline = null;

        this.initialized = false;

    }



    async _createDefaultHeightmap() {

        const size = this.heightmapSize;

        const data = new Float32Array(size * size * 4); // RGBA



        // Generate procedural heightmap as default

        for (let z = 0; z < size; z++) {

            for (let x = 0; x < size; x++) {

                const idx = (z * size + x) * 4;

                const nx = (x / size - 0.5) * 2;

                const nz = (z / size - 0.5) * 2;

                const dist = Math.sqrt(nx * nx + nz * nz);



                // Procedural height

                const noise = Math.sin(x * 0.1) * Math.cos(z * 0.1) * 0.5 + 0.5;

                const height = noise * (1 - dist) * 0.5;



                data[idx + 0] = Math.max(0, height);  // R = height

                data[idx + 1] = 0.25;                  // G = material (grass)

                data[idx + 2] = 0;                     // B = unused

                data[idx + 3] = 1;                     // A = alpha

            }

        }



        this._uploadHeightmap(data);

    }



    _uploadHeightmap(data) {

        const size = this.heightmapSize;



        // Destroy old texture if exists

        if (this.heightmapTexture) {

            this.heightmapTexture.destroy();

        }



        // Use rgba16float which is filterable (rgba32float requires unfilterable-float)

        this.heightmapTexture = this.vgpu.texture.create({

            width: size, height: size, format: 'rgba16float',

            usage: 'texture|copy-dst', label: 'World3DPreviewHeightmap'

        }).texture;



        // Convert Float32Array to Uint16Array (half-float)

        const halfData = new Uint16Array(size * size * 4);

        for (let i = 0; i < data.length; i++) {

            halfData[i] = this._floatToHalf(data[i]);

        }



        this.device.queue.writeTexture(

            { texture: this.heightmapTexture },

            halfData,

            { bytesPerRow: size * 8 },  // 4 components * 2 bytes each

            { width: size, height: size }

        );



        // Create bind group with new texture

        this.bindGroup = this.device.createBindGroup({

            layout: this.pipeline.getBindGroupLayout(0),

            entries: [

                { binding: 0, resource: { buffer: this.uniformBuffer } },

                { binding: 1, resource: this.heightmapTexture.createView() },

                { binding: 2, resource: this.heightmapSampler },

            ],

        });

    }



    async _createPipeline(format) {

        const shaderModule = this.vgpu.shader.compile('world3DPreview', PREVIEW_SHADER);



        // Fullscreen raymarched pipeline - no vertex buffers needed

        this.pipeline = this.vgpu.pipeline.render({

            vertex: { module: shaderModule, entryPoint: 'vs_main' },

            fragment: { module: shaderModule, entryPoint: 'fs_main' },

            colorFormat: format,

            topology: 'triangle-list',

            label: 'World3DPreviewPipeline'

        });

    }



    /**

     * Generate heightmap from chunk data

     * @param {Map} chunks - Map of chunk keys to chunk data with heightmap info

     * @param {number} seed - World seed

     */

    generateTerrainMesh(chunks, seed) {

        this.worldSeed = seed;



        if (!chunks || chunks.size === 0) {

            console.log(`[World3DPreview] No chunks, using procedural heightmap`);

            this.hasChunks = false;

            return;

        }



        this.hasChunks = true;



        // Calculate world bounds from chunks

        let minX = Infinity, maxX = -Infinity;

        let minZ = Infinity, maxZ = -Infinity;



        for (const [key, chunkData] of chunks) {

            const [cx, cy, cz] = key.split(',').map(Number);

            minX = Math.min(minX, cx);

            maxX = Math.max(maxX, cx);

            minZ = Math.min(minZ, cz);

            maxZ = Math.max(maxZ, cz);

        }



        const chunkSize = 32;

        const rangeX = (maxX - minX + 1) * chunkSize;

        const rangeZ = (maxZ - minZ + 1) * chunkSize;

        const worldSize = Math.max(rangeX, rangeZ, 256);



        const centerX = (minX + maxX) / 2 * chunkSize;

        const centerZ = (minZ + maxZ) / 2 * chunkSize;



        // Generate heightmap in equirectangular projection (lat/lon)

        // UV maps to: u = 0.5 + atan2(z, x) / (2*PI), v = 0.5 + asin(y) / PI

        const size = this.heightmapSize;

        const data = new Float32Array(size * size * 4);



        // Seeded random for consistent terrain

        const seededRand = (x, z) => {

            const n = Math.sin(x * 12.9898 + z * 78.233 + seed * 0.001) * 43758.5453;

            return n - Math.floor(n);

        };



        // FBM noise for terrain

        const fbm = (x, z, octaves = 4) => {

            let value = 0;

            let amplitude = 1;

            let frequency = 0.015;

            let maxValue = 0;



            for (let i = 0; i < octaves; i++) {

                value += seededRand(x * frequency, z * frequency) * amplitude;

                maxValue += amplitude;

                amplitude *= 0.5;

                frequency *= 2;

            }

            return value / maxValue;

        };



        // Scale for mapping UV to world coords

        const worldScale = worldSize / 2;



        for (let py = 0; py < size; py++) {

            for (let px = 0; px < size; px++) {

                const idx = (py * size + px) * 4;



                // UV coords (0-1)

                const u = px / size;

                const v = py / size;



                // Convert UV to spherical coords (lat/lon)

                const lon = (u - 0.5) * 2 * Math.PI;

                const lat = (v - 0.5) * Math.PI;



                // Convert to 3D point on unit sphere

                const cosLat = Math.cos(lat);

                const sx = Math.cos(lon) * cosLat;

                const sy = Math.sin(lat);

                const sz = Math.sin(lon) * cosLat;



                // Map sphere point to world XZ coords (centered on player area)

                const worldX = centerX + sx * worldScale;

                const worldZ = centerZ + sz * worldScale;



                // Find which chunk this is in

                const cx = Math.floor(worldX / chunkSize);

                const cz = Math.floor(worldZ / chunkSize);

                const chunkKey = `${cx},0,${cz}`;



                const chunkData = chunks.get(chunkKey);



                if (chunkData && chunkData.explored) {

                    // Generate terrain height from FBM noise

                    const terrainHeight = fbm(worldX, worldZ);



                    // Determine material based on height and position

                    let material = 0.18; // Default grass

                    if (terrainHeight < 0.2) material = 0.05; // Water

                    else if (terrainHeight < 0.25) material = 0.22; // Sand

                    else if (terrainHeight > 0.7) material = 0.28; // Snow

                    else if (terrainHeight > 0.5) material = 0.10; // Stone

                    else if (seededRand(cx, cz) > 0.7) material = 0.38; // Leaves/forest



                    data[idx + 0] = terrainHeight;      // R = height

                    data[idx + 1] = material;           // G = material ID (normalized)

                    data[idx + 2] = 0;                  // B = unused

                    data[idx + 3] = 1.0;                // A = explored flag

                } else {

                    // Unexplored - mark as not explored

                    data[idx + 0] = 0;

                    data[idx + 1] = 0;

                    data[idx + 2] = 0;

                    data[idx + 3] = 0;  // A = 0 means unexplored

                }

            }

        }



        this._uploadHeightmap(data);

        console.log(`[World3DPreview] Generated heightmap from ${chunks.size} chunks (equirectangular projection)`);

    }



    _generatePlanetSphere(seed) {

        const segments = 80;

        const radius = 6.0;  // 3X bigger planet



        // Generate sphere vertices with procedural terrain colors

        for (let lat = 0; lat <= segments; lat++) {

            const theta = (lat * Math.PI) / segments;

            const sinTheta = Math.sin(theta);

            const cosTheta = Math.cos(theta);



            for (let lon = 0; lon <= segments; lon++) {

                const phi = (lon * 2 * Math.PI) / segments;

                const sinPhi = Math.sin(phi);

                const cosPhi = Math.cos(phi);



                // Base sphere position

                const x = cosPhi * sinTheta;

                const y = cosTheta;

                const z = sinPhi * sinTheta;



                // Add terrain height variation

                const noise = this._noise3D(x * 3, y * 3, z * 3, seed);

                const height = 1.0 + noise * 0.08;



                const px = x * radius * height;

                const py = y * radius * height;

                const pz = z * radius * height;



                // Normal

                const nx = x;

                const ny = y;

                const nz = z;



                // Color based on latitude and noise

                const color = this._getTerrainColor(y, noise, seed);



                this.vertices.push(

                    px, py, pz,

                    nx, ny, nz,

                    color[0], color[1], color[2]

                );

            }

        }



        // Generate indices

        for (let lat = 0; lat < segments; lat++) {

            for (let lon = 0; lon < segments; lon++) {

                const first = lat * (segments + 1) + lon;

                const second = first + segments + 1;



                this.indices.push(first, second, first + 1);

                this.indices.push(second, second + 1, first + 1);

            }

        }

    }



    _generateTerrainFromChunks(chunks, seed) {

        // Generate planet sphere first, then add location marker

        this._generatePlanetSphere(seed);



        // Add orbital ring for sci-fi effect

        this._addOrbitalRing(6.5);



        // Add location marker on planet surface

        this._addLocationMarker(seed);



        return; // Skip the old terrain grid generation



        // Calculate bounds (kept for reference)

        let minX = Infinity, maxX = -Infinity;

        let minZ = Infinity, maxZ = -Infinity;



        for (const key of chunks.keys()) {

            const [cx, cy, cz] = key.split(',').map(Number);

            minX = Math.min(minX, cx);

            maxX = Math.max(maxX, cx);

            minZ = Math.min(minZ, cz);

            maxZ = Math.max(maxZ, cz);

        }



        // Generate terrain heightmap

        const rangeX = maxX - minX + 1;

        const rangeZ = maxZ - minZ + 1;

        const resolution = Math.min(128, Math.max(rangeX, rangeZ) * 4);

        const scale = 4.0 / Math.max(rangeX, rangeZ);



        // Create heightmap grid

        for (let gz = 0; gz <= resolution; gz++) {

            for (let gx = 0; gx <= resolution; gx++) {

                const u = gx / resolution;

                const v = gz / resolution;



                // World position

                const worldX = minX + u * rangeX;

                const worldZ = minZ + v * rangeZ;



                // Height from noise

                const noise1 = this._noise2D(worldX * 0.1, worldZ * 0.1, seed);

                const noise2 = this._noise2D(worldX * 0.3, worldZ * 0.3, seed) * 0.3;

                const height = (noise1 + noise2) * 0.5;



                // Position in view space

                const px = (u - 0.5) * 4;

                const py = height;

                const pz = (v - 0.5) * 4;



                // Calculate normal from neighbors

                const nx = 0, ny = 1, nz = 0;



                // Color based on height and position

                const color = this._getTerrainColorFromHeight(height, worldX, worldZ, seed);



                this.vertices.push(

                    px, py, pz,

                    nx, ny, nz,

                    color[0], color[1], color[2]

                );

            }

        }



        // Generate indices for grid

        for (let gz = 0; gz < resolution; gz++) {

            for (let gx = 0; gx < resolution; gx++) {

                const i = gz * (resolution + 1) + gx;

                this.indices.push(i, i + resolution + 1, i + 1);

                this.indices.push(i + resolution + 1, i + resolution + 2, i + 1);

            }

        }

    }



    _getTerrainColor(latitude, noise, seed) {

        const absLat = Math.abs(latitude);



        // Polar ice

        if (absLat > 0.85) return [0.9, 0.95, 1.0];



        // Ocean vs land

        if (noise < -0.1) return [0.2, 0.4, 0.7]; // Ocean

        if (noise < 0.0) return [0.25, 0.5, 0.8]; // Shallow water

        if (noise < 0.05) return [0.8, 0.75, 0.6]; // Beach



        // Land biomes

        if (absLat > 0.6) return [0.5, 0.55, 0.5]; // Tundra

        if (noise > 0.3) return [0.5, 0.45, 0.4]; // Mountain

        if (absLat < 0.2 && noise > 0.1) return [0.7, 0.65, 0.5]; // Desert



        return [0.3, 0.55, 0.3]; // Grassland

    }



    _getTerrainColorFromHeight(height, x, z, seed) {

        const noise = this._noise2D(x * 0.5, z * 0.5, seed + 1000);



        if (height < -0.2) return [0.15, 0.3, 0.6];  // Deep water

        if (height < -0.05) return [0.2, 0.45, 0.75]; // Water

        if (height < 0.0) return [0.75, 0.7, 0.55];   // Beach

        if (height < 0.2) return [0.3, 0.55, 0.3];    // Grass

        if (height < 0.35) return [0.2, 0.4, 0.2];   // Forest

        if (height < 0.5) return [0.5, 0.45, 0.4];   // Mountain

        return [0.85, 0.88, 0.92];                    // Snow

    }



    _noise2D(x, y, seed) {

        const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 0.001) * 43758.5453;

        return (n - Math.floor(n)) * 2 - 1;

    }



    _noise3D(x, y, z, seed) {

        const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 0.001) * 43758.5453;

        return (n - Math.floor(n)) * 2 - 1;

    }



    /**

     * Add sci-fi orbital ring around planet

     */

    _addOrbitalRing(radius) {

        const segments = 120;

        const ringWidth = 0.08;

        const baseIdx = this.vertices.length / 9;



        // Ring color - cyan/blue sci-fi

        const ringColor = [0.3, 0.8, 1.0];



        for (let i = 0; i <= segments; i++) {

            const angle = (i / segments) * Math.PI * 2;

            const cos = Math.cos(angle);

            const sin = Math.sin(angle);



            // Inner edge

            const innerR = radius - ringWidth;

            this.vertices.push(

                cos * innerR, 0, sin * innerR,  // position

                0, 1, 0,                         // normal (up)

                ringColor[0] * 0.5, ringColor[1] * 0.5, ringColor[2] * 0.5

            );



            // Outer edge

            this.vertices.push(

                cos * radius, 0, sin * radius,

                0, 1, 0,

                ringColor[0], ringColor[1], ringColor[2]

            );

        }



        // Ring indices

        for (let i = 0; i < segments; i++) {

            const idx = baseIdx + i * 2;

            this.indices.push(idx, idx + 1, idx + 2);

            this.indices.push(idx + 1, idx + 3, idx + 2);

        }

    }



    /**

     * Add glowing location marker on planet surface

     */

    _addLocationMarker(seed) {

        const baseIdx = this.vertices.length / 9;



        // Position marker at a fixed spot on planet (slightly randomized by seed)

        const lat = 0.3 + (seed % 100) / 500;  // Near equator

        const lon = degreesToRadians(seed % 360);


        const planetR = 6.0;

        const markerHeight = 0.3;



        // Calculate surface position

        const y = Math.sin(lat) * planetR;

        const xzR = Math.cos(lat) * planetR;

        const x = Math.cos(lon) * xzR;

        const z = Math.sin(lon) * xzR;



        // Normal pointing outward

        const nx = x / planetR;

        const ny = y / planetR;

        const nz = z / planetR;



        // Marker color - bright red/orange glow

        const markerColor = [1.0, 0.3, 0.2];

        const glowColor = [1.0, 0.5, 0.3];



        // Create a small pyramid/beacon marker

        const markerSize = 0.15;



        // Base vertices (triangle on surface)

        const perpX = -nz;

        const perpZ = nx;

        const perpLen = Math.sqrt(perpX * perpX + perpZ * perpZ) || 1;

        const px = perpX / perpLen * markerSize;

        const pz = perpZ / perpLen * markerSize;



        // Cross product for second perpendicular

        const p2x = ny * pz;

        const p2y = -(nx * pz - nz * px);

        const p2z = -ny * px;

        const p2Len = Math.sqrt(p2x * p2x + p2y * p2y + p2z * p2z) || 1;

        const qx = p2x / p2Len * markerSize;

        const qy = p2y / p2Len * markerSize;

        const qz = p2z / p2Len * markerSize;



        // Tip of beacon (pointing outward from planet)

        const tipX = x + nx * markerHeight;

        const tipY = y + ny * markerHeight;

        const tipZ = z + nz * markerHeight;



        // 4 base corners

        this.vertices.push(x + px, y, z + pz, nx, ny, nz, markerColor[0], markerColor[1], markerColor[2]);

        this.vertices.push(x - px, y, z - pz, nx, ny, nz, markerColor[0], markerColor[1], markerColor[2]);

        this.vertices.push(x + qx, y + qy, z + qz, nx, ny, nz, markerColor[0], markerColor[1], markerColor[2]);

        this.vertices.push(x - qx, y - qy, z - qz, nx, ny, nz, markerColor[0], markerColor[1], markerColor[2]);



        // Tip vertex (glowing)

        this.vertices.push(tipX, tipY, tipZ, nx, ny, nz, glowColor[0], glowColor[1], glowColor[2]);



        // Pyramid faces

        const tip = baseIdx + 4;

        this.indices.push(baseIdx, baseIdx + 2, tip);

        this.indices.push(baseIdx + 2, baseIdx + 1, tip);

        this.indices.push(baseIdx + 1, baseIdx + 3, tip);

        this.indices.push(baseIdx + 3, baseIdx, tip);



        // Add a second larger glow ring around marker

        this._addMarkerGlowRing(x, y, z, nx, ny, nz, 0.4);

    }



    /**

     * Add glowing ring around location marker

     */

    _addMarkerGlowRing(cx, cy, cz, nx, ny, nz, radius) {

        const baseIdx = this.vertices.length / 9;

        const segments = 24;

        const glowColor = [1.0, 0.4, 0.2];



        // Create perpendicular vectors for the ring plane

        let perpX = -nz, perpY = 0, perpZ = nx;

        let len = Math.sqrt(perpX * perpX + perpZ * perpZ);

        if (len < 0.001) { perpX = 1; perpZ = 0; len = 1; }

        perpX /= len; perpZ /= len;



        const p2x = ny * perpZ - nz * perpY;

        const p2y = nz * perpX - nx * perpZ;

        const p2z = nx * perpY - ny * perpX;



        for (let i = 0; i <= segments; i++) {

            const angle = (i / segments) * Math.PI * 2;

            const cos = Math.cos(angle);

            const sin = Math.sin(angle);



            const px = cx + (perpX * cos + p2x * sin) * radius;

            const py = cy + (perpY * cos + p2y * sin) * radius;

            const pz = cz + (perpZ * cos + p2z * sin) * radius;



            // Pulsing alpha based on angle

            const pulse = 0.5 + Math.sin(angle * 3) * 0.3;



            this.vertices.push(

                px, py, pz,

                nx, ny, nz,

                glowColor[0] * pulse, glowColor[1] * pulse, glowColor[2] * pulse

            );

        }



        // Line strip as triangles (thin ring)

        for (let i = 0; i < segments; i++) {

            // Skip triangles - just use the ring for visual

        }

    }



    /**

     * Start rendering animation

     */

    startRendering() {

        if (this.animationFrame) return;



        const render = () => {

            this.rotation += 0.005;

            this._render();

            this.animationFrame = requestAnimationFrame(render);

        };

        render();

    }



    /**

     * Stop rendering

     */

    stopRendering() {

        if (this.animationFrame) {

            cancelAnimationFrame(this.animationFrame);

            this.animationFrame = null;

        }

    }



    _render() {

        if (!this.initialized) return;



        // Resize canvases if needed

        const rect = this.canvas.getBoundingClientRect();

        const pixelWidth = Math.floor(rect.width * window.devicePixelRatio);

        const pixelHeight = Math.floor(rect.height * window.devicePixelRatio);



        if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {

            this.canvas.width = pixelWidth;

            this.canvas.height = pixelHeight;

        }



        const time = performance.now() / 1000;



        // Update uniforms: time, hasChunks, padding... - reuse buffer

        _world3DUniformData[0] = time;

        _world3DUniformData[1] = this.hasChunks ? 1.0 : 0.0;

        _world3DUniformData[2] = 0;

        _world3DUniformData[3] = 0;

        _world3DUniformData[4] = 0;

        _world3DUniformData[5] = 0;

        _world3DUniformData[6] = 0;

        _world3DUniformData[7] = 0;



        this.device.queue.writeBuffer(this.uniformBuffer, 0, _world3DUniformData);



        if (!this.bindGroup) return;



        // Render fullscreen quad with raymarched shader

        const commandEncoder = this.device.createCommandEncoder();

        const passEncoder = commandEncoder.beginRenderPass({

            colorAttachments: [{

                view: this.context.getCurrentTexture().createView(),

                clearValue: { r: 0.0, g: 0.0, b: 0.02, a: 1 },

                loadOp: 'clear',

                storeOp: 'store',

            }],

        });



        passEncoder.setPipeline(this.pipeline);

        passEncoder.setBindGroup(0, this.bindGroup);

        passEncoder.draw(6);  // 6 vertices for fullscreen quad

        passEncoder.end();



        this.device.queue.submit([commandEncoder.finish()]);

    }



    _lookAt(eye, target, up) {

        const zAxis = this._normalize([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);

        const xAxis = this._normalize(this._cross(up, zAxis));

        const yAxis = this._cross(zAxis, xAxis);



        return [

            xAxis[0], yAxis[0], zAxis[0], 0,

            xAxis[1], yAxis[1], zAxis[1], 0,

            xAxis[2], yAxis[2], zAxis[2], 0,

            -this._dot(xAxis, eye), -this._dot(yAxis, eye), -this._dot(zAxis, eye), 1

        ];

    }



    _perspective(fov, aspect, near, far) {

        const f = 1.0 / Math.tan(fov / 2);

        const rangeInv = 1 / (near - far);



        return [

            f / aspect, 0, 0, 0,

            0, f, 0, 0,

            0, 0, far * rangeInv, -1,

            0, 0, near * far * rangeInv, 0

        ];

    }



    _multiply(a, b) {

        const result = new Array(16);

        for (let i = 0; i < 4; i++) {

            for (let j = 0; j < 4; j++) {

                result[i * 4 + j] =

                    a[i * 4 + 0] * b[0 * 4 + j] +

                    a[i * 4 + 1] * b[1 * 4 + j] +

                    a[i * 4 + 2] * b[2 * 4 + j] +

                    a[i * 4 + 3] * b[3 * 4 + j];

            }

        }

        return result;

    }



    _normalize(v) {

        const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);

        return [v[0] / len, v[1] / len, v[2] / len];

    }



    _cross(a, b) {

        return [

            a[1] * b[2] - a[2] * b[1],

            a[2] * b[0] - a[0] * b[2],

            a[0] * b[1] - a[1] * b[0]

        ];

    }



    _dot(a, b) {

        return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

    }



    /**

     * Convert float32 to float16 (half precision)

     */

    _floatToHalf(val) {

        const floatView = new Float32Array(1);

        const int32View = new Int32Array(floatView.buffer);



        floatView[0] = val;

        const x = int32View[0];



        let bits = (x >> 16) & 0x8000; // Sign

        let m = (x >> 12) & 0x07ff;    // Mantissa

        let e = (x >> 23) & 0xff;      // Exponent



        if (e < 103) {

            return bits; // Too small, return signed zero

        }



        if (e > 142) {

            bits |= 0x7c00; // Infinity

            bits |= ((e === 255) ? 0 : 1) && (x & 0x007fffff);

            return bits;

        }



        if (e < 113) {

            m |= 0x0800;

            bits |= (m >> (114 - e)) + ((m >> (113 - e)) & 1);

            return bits;

        }



        bits |= ((e - 112) << 10) | (m >> 1);

        bits += m & 1;

        return bits;

    }



    /**

     * Cleanup

     */

    destroy() {

        if (this.destroyed) return false;

        this.destroyed = true;

        this.lifecycleEpoch += 1;

        this.initialized = false;

        this.releaseInitializationCandidate({

            canvas: this.canvas,

            deviceLease: this.deviceLease,

            vgpuLease: this.vgpuLease,

        });

        return true;

    }

}



export default World3DPreviewRenderer;
