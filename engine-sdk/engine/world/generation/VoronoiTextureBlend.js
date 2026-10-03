// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>

//

// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha



/**

 * VoronoiTextureBlend.js - GPU Voronoi-Based Texture Blending

 *

 * INTEGRATION:

 * - Uses GPU compute shaders for O(1) Voronoi generation

 * - Integrates with UnifiedTerrainPipeline for biome blending

 * - Uses SpatialHashCompute for centroid neighbor queries

 *

 * Implements GPU-accelerated Voronoi diagrams for:

 * - Natural biome transitions (no hard edges)

 * - Material splatting (stone patches in dirt)

 * - Procedural detail variation (no texture tiling)

 * - Weathering effects (moss, rust, cracks)

 *

 * Based on: Nick McDonald's GPU Accelerated Voronoi

 * https://nickmcd.me/2020/08/01/gpu-accelerated-voronoi/

 *

 * Key technique: Uses depth buffer as distance field for O(1) Voronoi generation

 */



// ============================================================================

// SHADER SOURCES

// ============================================================================



import {
    LEGACY_PCG32_WGSL,
    LEGACY_WORLD_GENERATION_RUNTIME_PCG_HASH_WGSL,
    legacyPrimeCoordinateXorHash3D,
} from '../../core/math/MathBits.js';

const VORONOI_PARAMS = /* wgsl */ `
struct VoronoiParams {

    resolution: vec2<u32>,

    centroid_count: u32,

    max_radius: f32,

    time: f32,

    blend_sharpness: f32,

    edge_width: f32,

    _pad: f32,

}

`;



const VORONOI_GENERATE_SHADER = /* wgsl */ `

${VORONOI_PARAMS}



struct Centroid {

    position: vec2<f32>,

    material_id: u32,

    variation: f32,  // Per-cell texture variation

}



@group(0) @binding(0) var<uniform> params: VoronoiParams;

@group(0) @binding(1) var<storage, read> centroids: array<Centroid>;

@group(0) @binding(2) var output_texture: texture_storage_2d<rgba32float, write>;



@compute @workgroup_size(8, 8)

fn generateVoronoi(@builtin(global_invocation_id) gid: vec3<u32>) {

    let pixel = vec2<i32>(gid.xy);



    if (pixel.x >= i32(params.resolution.x) || pixel.y >= i32(params.resolution.y)) {

        return;

    }



    // Normalize pixel position to [0, 1]

    let uv = vec2<f32>(f32(pixel.x) / f32(params.resolution.x),

                       f32(pixel.y) / f32(params.resolution.y));



    // Find closest and second-closest centroids

    var minDist1 = 1000000.0;

    var minDist2 = 1000000.0;

    var closestIdx: u32 = 0u;

    var secondIdx: u32 = 0u;



    for (var i: u32 = 0u; i < params.centroid_count; i++) {

        let centroid = centroids[i];

        let dist = distance(uv, centroid.position);



        if (dist < minDist1) {

            minDist2 = minDist1;

            secondIdx = closestIdx;

            minDist1 = dist;

            closestIdx = i;

        } else if (dist < minDist2) {

            minDist2 = dist;

            secondIdx = i;

        }

    }



    // Pack output:

    // R: closest cell ID (as float)

    // G: distance to closest

    // B: blend factor (for smooth transitions)

    // A: edge factor (distance to cell boundary)



    let closest = centroids[closestIdx];

    let second = centroids[secondIdx];



    // Blend factor based on relative distances

    let blendRange = params.blend_sharpness;

    let distDiff = minDist2 - minDist1;

    let blendFactor = smoothstep(0.0, blendRange, distDiff);



    // Edge factor (1 at edges, 0 in center)

    let edgeDist = distDiff * 0.5;

    let edgeFactor = 1.0 - smoothstep(0.0, params.edge_width, edgeDist);



    textureStore(output_texture, pixel, vec4<f32>(

        f32(closestIdx),

        minDist1,

        blendFactor,

        edgeFactor

    ));

}

`;



const VORONOI_BLEND_SHADER = /* wgsl */ `

${VORONOI_PARAMS}



struct Centroid {

    position: vec2<f32>,

    material_id: u32,

    variation: f32,

}



@group(0) @binding(0) var<uniform> params: VoronoiParams;

@group(0) @binding(1) var<storage, read> centroids: array<Centroid>;

@group(0) @binding(2) var voronoi_map: texture_2d<f32>;

@group(0) @binding(3) var material_textures: texture_2d_array<f32>;

@group(0) @binding(4) var tex_sampler: sampler;

@group(0) @binding(5) var output_texture: texture_storage_2d<rgba8unorm, write>;



// Hash for variation

fn hash21(p: vec2<f32>) -> f32 {

    var p3 = fract(vec3<f32>(p.xyx) * 0.1031);

    p3 += dot(p3, p3.yzx + 33.33);

    return fract((p3.x + p3.y) * p3.z);

}



@compute @workgroup_size(8, 8)

fn blendTextures(@builtin(global_invocation_id) gid: vec3<u32>) {

    let pixel = vec2<i32>(gid.xy);



    if (pixel.x >= i32(params.resolution.x) || pixel.y >= i32(params.resolution.y)) {

        return;

    }



    let uv = vec2<f32>(f32(pixel.x) / f32(params.resolution.x),

                       f32(pixel.y) / f32(params.resolution.y));



    // Sample Voronoi map

    let voronoi = textureLoad(voronoi_map, pixel, 0);

    let cellIdx = u32(voronoi.r);

    let distToCenter = voronoi.g;

    let blendFactor = voronoi.b;

    let edgeFactor = voronoi.a;



    let cell = centroids[cellIdx];



    // UV offset based on cell variation (prevents tiling)

    let variationOffset = vec2<f32>(

        hash21(cell.position * 100.0),

        hash21(cell.position * 100.0 + vec2<f32>(17.3, 31.7))

    );



    // Sample material texture with variation

    let texUV = uv * 4.0 + variationOffset * cell.variation;

    let materialColor = textureSampleLevel(

        material_textures,

        tex_sampler,

        texUV,

        i32(cell.material_id),

        0.0

    );



    // Apply edge darkening (cracks/borders)

    let edgeDarken = 1.0 - edgeFactor * 0.3;



    // Apply distance-based detail (fade near edges for blend)

    var finalColor = materialColor.rgb * edgeDarken;



    textureStore(output_texture, pixel, vec4<f32>(finalColor, 1.0));

}

`;



const BIOME_BLEND_SHADER = /* wgsl */ `

${VORONOI_PARAMS}



struct BiomeData {

    position: vec2<f32>,

    biome_id: u32,

    temperature: f32,

    humidity: f32,

    elevation: f32,

    _pad: vec2<f32>,

}



@group(0) @binding(0) var<uniform> params: VoronoiParams;

@group(0) @binding(1) var<storage, read> biomes: array<BiomeData>;

@group(0) @binding(2) var voronoi_map: texture_2d<f32>;

@group(0) @binding(3) var output_texture: texture_storage_2d<rgba32float, write>;



@compute @workgroup_size(8, 8)

fn blendBiomes(@builtin(global_invocation_id) gid: vec3<u32>) {

    let pixel = vec2<i32>(gid.xy);



    if (pixel.x >= i32(params.resolution.x) || pixel.y >= i32(params.resolution.y)) {

        return;

    }



    let uv = vec2<f32>(f32(pixel.x) / f32(params.resolution.x),

                       f32(pixel.y) / f32(params.resolution.y));



    // Sample Voronoi map

    let voronoi = textureLoad(voronoi_map, pixel, 0);

    let cellIdx = u32(voronoi.r);

    let blendFactor = voronoi.b;



    let biome = biomes[cellIdx];



    // Output: biome ID + blend weights for smooth transitions

    // This can be used by the terrain shader for material selection

    textureStore(output_texture, pixel, vec4<f32>(

        f32(biome.biome_id),

        biome.temperature,

        biome.humidity,

        blendFactor

    ));

}

`;



const PROCEDURAL_DETAIL_SHADER = /* wgsl */ `

${VORONOI_PARAMS}



@group(0) @binding(0) var<uniform> params: VoronoiParams;

@group(0) @binding(1) var voronoi_map: texture_2d<f32>;
@group(0) @binding(2) var output_texture: texture_storage_2d<rgba8unorm, write>;

${LEGACY_PCG32_WGSL}
${LEGACY_WORLD_GENERATION_RUNTIME_PCG_HASH_WGSL}

// PCG hash - deterministic across all GPUs

// Procedural noise (deterministic)
fn hash(p: vec2<f32>) -> f32 {
    let seed = pcg_vor(bitcast<u32>(p.x) + pcg_vor(bitcast<u32>(p.y)));

    return f32(seed) / 4294967295.0;

}



fn noise(p: vec2<f32>) -> f32 {

    let i = floor(p);

    let f = fract(p);

    let u = f * f * (3.0 - 2.0 * f);



    return mix(

        mix(hash(i), hash(i + vec2<f32>(1.0, 0.0)), u.x),

        mix(hash(i + vec2<f32>(0.0, 1.0)), hash(i + vec2<f32>(1.0, 1.0)), u.x),

        u.y

    );

}



fn fbm(p: vec2<f32>) -> f32 {

    var value = 0.0;

    var amplitude = 0.5;

    var pos = p;



    for (var i = 0; i < 4; i++) {

        value += amplitude * noise(pos);

        pos *= 2.0;

        amplitude *= 0.5;

    }



    return value;

}



@compute @workgroup_size(8, 8)

fn generateDetail(@builtin(global_invocation_id) gid: vec3<u32>) {

    let pixel = vec2<i32>(gid.xy);



    if (pixel.x >= i32(params.resolution.x) || pixel.y >= i32(params.resolution.y)) {

        return;

    }



    let uv = vec2<f32>(f32(pixel.x), f32(pixel.y));



    // Sample Voronoi for cell info

    let voronoi = textureLoad(voronoi_map, pixel, 0);

    let cellIdx = voronoi.r;

    let distToCenter = voronoi.g;

    let edgeFactor = voronoi.a;



    // Per-cell noise offset (prevents repetition)

    let cellOffset = vec2<f32>(cellIdx * 17.3, cellIdx * 31.7);



    // Multi-scale detail

    let detail1 = fbm((uv + cellOffset) * 0.02);

    let detail2 = fbm((uv + cellOffset) * 0.05);

    let detail3 = fbm((uv + cellOffset) * 0.1);



    // Combine details

    let detail = detail1 * 0.5 + detail2 * 0.3 + detail3 * 0.2;



    // Moss/weathering pattern (more at edges)

    let weathering = edgeFactor * detail * 0.5;



    // Cracks at edges

    let crackIntensity = pow(edgeFactor, 2.0) * (1.0 - detail2);



    // Output: detail, weathering, cracks, variation

    textureStore(output_texture, pixel, vec4<f32>(

        detail,

        weathering,

        crackIntensity,

        hash(vec2<f32>(cellIdx, cellIdx * 2.0))  // Per-cell variation

    ));

}

`;



// ============================================================================

// MAIN CLASS

// ============================================================================



export function voronoiTextureVariationHash(x, z, index) {
    return legacyPrimeCoordinateXorHash3D(
        Math.floor(x * 100),
        Math.floor(z * 100),
        index
    );
}

export class VoronoiTextureBlend {
    constructor(config = {}) {

        this.config = {

            resolution: config.resolution || 512,

            maxCentroids: config.maxCentroids || 256,

            blendSharpness: config.blendSharpness || 0.05,

            edgeWidth: config.edgeWidth || 0.02,

            ...config,

        };



        this.device = null;

        this.initialized = false;



        // Buffers

        this.paramsBuffer = null;

        this.centroidBuffer = null;



        // Textures

        this.voronoiTexture = null;

        this.blendedTexture = null;

        this.detailTexture = null;



        // Pipelines

        this.generatePipeline = null;

        this.blendPipeline = null;

        this.detailPipeline = null;

        this.biomePipeline = null;



        // Sampler

        this.sampler = null;

    }



    async init(device) {

        this.device = device;

        const cfg = this.config;

        const res = cfg.resolution;



        // Create params buffer

        this.paramsBuffer = device.createBuffer({

            label: 'Voronoi Params',

            size: 32,

            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,

        });



        // Create centroid buffer (position + material_id + variation)

        const centroidStride = 16;  // 4 floats

        this.centroidBuffer = device.createBuffer({

            label: 'Voronoi Centroids',

            size: cfg.maxCentroids * centroidStride,

            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,

        });



        // Create output textures

        this.voronoiTexture = device.createTexture({

            label: 'Voronoi Map',

            size: [res, res],

            format: 'rgba32float',

            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,

        });



        this.blendedTexture = device.createTexture({

            label: 'Blended Texture',

            size: [res, res],

            format: 'rgba8unorm',

            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,

        });



        this.detailTexture = device.createTexture({

            label: 'Detail Texture',

            size: [res, res],

            format: 'rgba8unorm',

            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,

        });



        // Create sampler

        this.sampler = device.createSampler({

            magFilter: 'linear',

            minFilter: 'linear',

            addressModeU: 'repeat',

            addressModeV: 'repeat',

        });



        // Update params

        this._updateParams();



        // Create pipelines

        await this._createPipelines();



        this.initialized = true;

        console.log(`[VoronoiTextureBlend] Initialized ${res}×${res}`);

    }



    _updateParams(time = 0) {

        const cfg = this.config;

        const data = new Float32Array([

            cfg.resolution,

            cfg.resolution,

            this.currentCentroidCount || 0,

            cfg.maxRadius || 0.2,

            time,

            cfg.blendSharpness,

            cfg.edgeWidth,

            0,  // padding

        ]);



        // Fix integer fields

        const view = new DataView(data.buffer);

        view.setUint32(0, cfg.resolution, true);

        view.setUint32(4, cfg.resolution, true);

        view.setUint32(8, this.currentCentroidCount || 0, true);



        this.device.queue.writeBuffer(this.paramsBuffer, 0, data);

    }



    async _createPipelines() {

        // Generate Voronoi pipeline

        const generateModule = this.device.createShaderModule({

            label: 'Voronoi Generate',

            code: VORONOI_GENERATE_SHADER,

        });

        this.generatePipeline = this.device.createComputePipeline({

            label: 'Voronoi Generate Pipeline',

            layout: 'auto',

            compute: { module: generateModule, entryPoint: 'generateVoronoi' },

        });



        // Procedural detail pipeline

        const detailModule = this.device.createShaderModule({

            label: 'Voronoi Detail',

            code: PROCEDURAL_DETAIL_SHADER,

        });

        this.detailPipeline = this.device.createComputePipeline({

            label: 'Voronoi Detail Pipeline',

            layout: 'auto',

            compute: { module: detailModule, entryPoint: 'generateDetail' },

        });



        // Biome blend pipeline

        const biomeModule = this.device.createShaderModule({

            label: 'Biome Blend',

            code: BIOME_BLEND_SHADER,

        });

        this.biomePipeline = this.device.createComputePipeline({

            label: 'Biome Blend Pipeline',

            layout: 'auto',

            compute: { module: biomeModule, entryPoint: 'blendBiomes' },

        });

    }



    /**

     * Set centroids from world positions

     * @param {Array} centroids - Array of {x, z, materialId, variation}

     */

    setCentroids(centroids) {

        const data = new Float32Array(centroids.length * 4);



        for (let i = 0; i < centroids.length; i++) {

            const c = centroids[i];

            data[i * 4 + 0] = c.x;

            data[i * 4 + 1] = c.z;

            data[i * 4 + 2] = c.materialId || 0;

            // Deterministic variation based on position (multiplayer sync)

            const varHash = voronoiTextureVariationHash(c.x, c.z, i);
            data[i * 4 + 3] = c.variation ?? ((varHash % 1000) / 1000);

        }



        // Fix material ID as u32

        const view = new DataView(data.buffer);

        for (let i = 0; i < centroids.length; i++) {

            view.setUint32((i * 4 + 2) * 4, centroids[i].materialId || 0, true);

        }



        this.device.queue.writeBuffer(this.centroidBuffer, 0, data);

        this.currentCentroidCount = centroids.length;

        this._updateParams();

    }



    /**

     * Generate Voronoi diagram from current centroids

     * @param {GPUCommandEncoder} encoder

     */

    generate(encoder) {

        if (!this.initialized || !this.currentCentroidCount) return;



        const cfg = this.config;

        const workgroups = Math.ceil(cfg.resolution / 8);



        // Create bind group

        const bindGroup = this.device.createBindGroup({

            layout: this.generatePipeline.getBindGroupLayout(0),

            entries: [

                { binding: 0, resource: { buffer: this.paramsBuffer } },

                { binding: 1, resource: { buffer: this.centroidBuffer } },

                { binding: 2, resource: this.voronoiTexture.createView() },

            ],

        });



        const pass = encoder.beginComputePass({ label: 'Voronoi Generate' });

        pass.setPipeline(this.generatePipeline);

        pass.setBindGroup(0, bindGroup);

        pass.dispatchWorkgroups(workgroups, workgroups);

        pass.end();

    }



    /**

     * Generate procedural detail texture

     * @param {GPUCommandEncoder} encoder

     */

    generateDetail(encoder) {

        if (!this.initialized) return;



        const cfg = this.config;

        const workgroups = Math.ceil(cfg.resolution / 8);



        const bindGroup = this.device.createBindGroup({

            layout: this.detailPipeline.getBindGroupLayout(0),

            entries: [

                { binding: 0, resource: { buffer: this.paramsBuffer } },

                { binding: 1, resource: this.voronoiTexture.createView() },

                { binding: 2, resource: this.detailTexture.createView() },

            ],

        });



        const pass = encoder.beginComputePass({ label: 'Voronoi Detail' });

        pass.setPipeline(this.detailPipeline);

        pass.setBindGroup(0, bindGroup);

        pass.dispatchWorkgroups(workgroups, workgroups);

        pass.end();

    }



    /**

     * Generate Voronoi from Poisson disc sampling

     * @param {number} minDistance - Minimum distance between points

     * @param {number} seed - Random seed

     */

    generatePoissonDisc(minDistance = 0.05, seed = 12345) {

        const centroids = [];

        const cellSize = minDistance / Math.sqrt(2);

        const gridWidth = Math.ceil(1 / cellSize);

        const grid = new Array(gridWidth * gridWidth).fill(-1);



        // Seeded random

        let rng = seed;

        const random = () => {

            rng = (rng * 1103515245 + 12345) & 0x7fffffff;

            return rng / 0x7fffffff;

        };



        const activeList = [];



        // Start with random point

        const startX = random();

        const startZ = random();

        centroids.push({ x: startX, z: startZ, materialId: 0, variation: random() });

        activeList.push(0);



        const gridIdx = (x, z) => {

            const gx = Math.floor(x / cellSize);

            const gz = Math.floor(z / cellSize);

            if (gx < 0 || gx >= gridWidth || gz < 0 || gz >= gridWidth) return -1;

            return gx + gz * gridWidth;

        };



        grid[gridIdx(startX, startZ)] = 0;



        const k = 30;  // Samples before rejection



        while (activeList.length > 0 && centroids.length < this.config.maxCentroids) {

            const activeIdx = Math.floor(random() * activeList.length);

            const pointIdx = activeList[activeIdx];

            const point = centroids[pointIdx];



            let found = false;



            for (let i = 0; i < k; i++) {

                const angle = random() * Math.PI * 2;

                const dist = minDistance + random() * minDistance;



                const newX = point.x + Math.cos(angle) * dist;

                const newZ = point.z + Math.sin(angle) * dist;



                // Check bounds

                if (newX < 0 || newX >= 1 || newZ < 0 || newZ >= 1) continue;



                // Check neighbors

                const gi = gridIdx(newX, newZ);

                if (gi < 0) continue;



                let valid = true;

                const gx = Math.floor(newX / cellSize);

                const gz = Math.floor(newZ / cellSize);



                for (let dx = -2; dx <= 2 && valid; dx++) {

                    for (let dz = -2; dz <= 2 && valid; dz++) {

                        const nx = gx + dx;

                        const nz = gz + dz;

                        if (nx < 0 || nx >= gridWidth || nz < 0 || nz >= gridWidth) continue;



                        const ni = nx + nz * gridWidth;

                        if (grid[ni] >= 0) {

                            const neighbor = centroids[grid[ni]];

                            const d = Math.sqrt(

                                (newX - neighbor.x) ** 2 +

                                (newZ - neighbor.z) ** 2

                            );

                            if (d < minDistance) valid = false;

                        }

                    }

                }



                if (valid) {

                    const newIdx = centroids.length;

                    centroids.push({

                        x: newX,

                        z: newZ,

                        materialId: Math.floor(random() * 4),  // Random material

                        variation: random(),

                    });

                    activeList.push(newIdx);

                    grid[gi] = newIdx;

                    found = true;

                    break;

                }

            }



            if (!found) {

                activeList.splice(activeIdx, 1);

            }

        }



        this.setCentroids(centroids);

        return centroids;

    }



    /**

     * Get Voronoi texture for use in terrain shader

     */

    getVoronoiTexture() {

        return this.voronoiTexture;

    }



    /**

     * Get detail texture for weathering/cracks

     */

    getDetailTexture() {

        return this.detailTexture;

    }



    /**

     * Get blended texture result

     */

    getBlendedTexture() {

        return this.blendedTexture;

    }



    /**

     * Load config from object

     */

    loadConfig(cfg) {

        if (!cfg) return;



        if (cfg.voronoi_resolution !== undefined) {

            this.config.resolution = parseInt(cfg.voronoi_resolution);

        }

        if (cfg.voronoi_blend_sharpness !== undefined) {

            this.config.blendSharpness = parseFloat(cfg.voronoi_blend_sharpness);

        }

        if (cfg.voronoi_edge_width !== undefined) {

            this.config.edgeWidth = parseFloat(cfg.voronoi_edge_width);

        }

    }



    destroy() {

        this.paramsBuffer?.destroy();

        this.centroidBuffer?.destroy();

        this.voronoiTexture?.destroy();

        this.blendedTexture?.destroy();

        this.detailTexture?.destroy();

        this.initialized = false;

    }

}



// ============================================================================

// HELPER: Sample Voronoi at world position

// ============================================================================



/**

 * Sample Voronoi data at a world position (CPU fallback)

 * @param {Array} centroids - Centroid array

 * @param {number} x - World X (normalized 0-1)

 * @param {number} z - World Z (normalized 0-1)

 * @returns {Object} {cellIdx, distance, blendFactor}

 */

export function sampleVoronoi(centroids, x, z) {

    let minDist1 = Infinity;

    let minDist2 = Infinity;

    let closestIdx = 0;



    for (let i = 0; i < centroids.length; i++) {

        const c = centroids[i];

        const dist = Math.sqrt((x - c.x) ** 2 + (z - c.z) ** 2);



        if (dist < minDist1) {

            minDist2 = minDist1;

            minDist1 = dist;

            closestIdx = i;

        } else if (dist < minDist2) {

            minDist2 = dist;

        }

    }



    const blendFactor = Math.min(1, (minDist2 - minDist1) / 0.05);

    const edgeFactor = 1 - Math.min(1, (minDist2 - minDist1) * 25);



    return {

        cellIdx: closestIdx,

        cell: centroids[closestIdx],

        distance: minDist1,

        blendFactor,

        edgeFactor,

    };

}
