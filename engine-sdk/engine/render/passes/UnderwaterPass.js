// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>

//

// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha



/**

 * UnderwaterPass.js - Underwater Post-Processing Effect

 * Now powered by vGPU driver

 *

 * When camera is submerged in water:

 * 1. Apply blue tint and fog

 * 2. Add screen distortion (wavy effect)

 * 3. Caustics light patterns

 * 4. Depth-based color attenuation

 */



import { initVGPU } from '../../core/gpu/VirtualGPU.js';
import {
    LEGACY_PCG32_WGSL,
    LEGACY_RENDER_RUNTIME_PCG_HASH_WGSL,
} from '../../core/math/MathBits.js';


// ============================================================================

// SHADER

// ============================================================================



const UNDERWATER_SHADER = /* wgsl */ `

struct UnderwaterUniforms {

    time: f32,

    waterDepth: f32,        // How deep underwater (0 = surface, larger = deeper)

    fogDensity: f32,

    distortionStrength: f32,

    tintColor: vec3<f32>,

    _pad: f32,

}



@group(0) @binding(0) var<uniform> underwater: UnderwaterUniforms;

@group(0) @binding(1) var sceneTex: texture_2d<f32>;

@group(0) @binding(2) var sceneSampler: sampler;



struct VertexOutput {

    @builtin(position) position: vec4<f32>,

    @location(0) uv: vec2<f32>,

}



// Fullscreen triangle

@vertex

fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {

    var output: VertexOutput;

    let x = f32((vertexIndex & 1u) << 2u) - 1.0;

    let y = f32((vertexIndex & 2u) << 1u) - 1.0;

    output.position = vec4<f32>(x, y, 0.0, 1.0);

    output.uv = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);

    return output;

}



// PCG hash - deterministic across all GPUs
${LEGACY_PCG32_WGSL}
${LEGACY_RENDER_RUNTIME_PCG_HASH_WGSL}

// Simple noise for caustics (deterministic)
fn hash2(p: vec2<f32>) -> f32 {

    let seed = pcg_uw(bitcast<u32>(p.x) + pcg_uw(bitcast<u32>(p.y)));

    return f32(seed) / 4294967295.0;

}



fn noise2D(p: vec2<f32>) -> f32 {

    let i = floor(p);

    let f = fract(p);

    let u = f * f * (3.0 - 2.0 * f);



    return mix(

        mix(hash2(i + vec2<f32>(0.0, 0.0)), hash2(i + vec2<f32>(1.0, 0.0)), u.x),

        mix(hash2(i + vec2<f32>(0.0, 1.0)), hash2(i + vec2<f32>(1.0, 1.0)), u.x),

        u.y

    );

}



// Caustics pattern

fn caustics(uv: vec2<f32>, time: f32) -> f32 {

    var c = 0.0;

    let scale1 = 8.0;

    let scale2 = 16.0;



    // Layer 1

    let p1 = uv * scale1 + vec2<f32>(time * 0.3, time * 0.2);

    c += noise2D(p1) * 0.5;



    // Layer 2 (finer detail, different speed)

    let p2 = uv * scale2 + vec2<f32>(-time * 0.2, time * 0.4);

    c += noise2D(p2) * 0.3;



    // Layer 3 (even finer)

    let p3 = uv * scale2 * 1.5 + vec2<f32>(time * 0.15, -time * 0.1);

    c += noise2D(p3) * 0.2;



    // Create bright caustic lines from the noise

    c = pow(c, 2.0) * 2.0;



    return clamp(c, 0.0, 1.0);

}



@fragment

fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {

    // Screen distortion (wavy effect)

    var distortedUV = input.uv;

    let distortAmount = underwater.distortionStrength * 0.01;

    distortedUV.x += sin(input.uv.y * 20.0 + underwater.time * 2.0) * distortAmount;

    distortedUV.y += cos(input.uv.x * 15.0 + underwater.time * 1.5) * distortAmount * 0.7;



    // Clamp UV to avoid sampling outside texture

    distortedUV = clamp(distortedUV, vec2<f32>(0.001), vec2<f32>(0.999));



    // Sample scene

    var color = textureSample(sceneTex, sceneSampler, distortedUV).rgb;



    // Depth-based fog (more fog = more tint, less scene visibility)

    let depthFactor = clamp(underwater.waterDepth / 20.0, 0.0, 1.0); // 20 units = max fog

    let fogStrength = 1.0 - exp(-underwater.fogDensity * (1.0 + depthFactor * 2.0));



    // Apply underwater tint (blue-green)

    let tint = underwater.tintColor;

    color = mix(color, color * tint, 0.4 + depthFactor * 0.3);



    // Apply fog toward tint color

    let fogColor = tint * 0.3; // Dark water color

    color = mix(color, fogColor, fogStrength * 0.6);



    // Caustics (light patterns from surface) - stronger near surface

    let causticsStrength = (1.0 - depthFactor) * 0.3;

    let causticsValue = caustics(input.uv, underwater.time);

    color += vec3<f32>(causticsValue * causticsStrength);



    // Slight vignette effect underwater

    let center = input.uv - 0.5;

    let vignette = 1.0 - dot(center, center) * 0.5;

    color *= vignette;



    // Reduce contrast slightly (underwater murk)

    let gray = dot(color, vec3<f32>(0.299, 0.587, 0.114));

    color = mix(vec3<f32>(gray), color, 0.85 - depthFactor * 0.2);



    return vec4<f32>(color, 1.0);

}

`;



// ============================================================================

// UNDERWATER PASS CLASS

// ============================================================================



export class UnderwaterPass {

    constructor() {

        this.vgpu = null;

        this.initialized = false;

        this.enabled = true;

        this.isUnderwater = false;

        this.waterDepth = 0;



        // Configurable parameters

        this.fogDensity = 0.15;

        this.distortionStrength = 1.0;

        this.tintColor = [0.2, 0.5, 0.8]; // Blue-ish



        // GPU resources

        this.pipeline = null;

        this.uniformBuffer = null;

        this.bindGroupLayout = null;

        this.sampler = null;



        // Textures

        this.outputTexture = null;

        this.outputView = null;



        this.width = 0;

        this.height = 0;

        this.time = 0;



        // Pre-allocated buffer to avoid per-frame allocations

        this._uniformData = new Float32Array(8);

    }



    /**

     * Initialize GPU resources

     * @param {GPUDevice} device

     * @param {number} width

     * @param {number} height

     */

    init(device, width, height) {

        this.vgpu = initVGPU(device);

        this.device = device;

        this.width = width;

        this.height = height;



        // Create shader module

        const shaderModule = this.vgpu.shader.compile('underwater', UNDERWATER_SHADER);



        // Create sampler

        this.sampler = this.vgpu.texture.sampler({ filter: 'linear', addressMode: 'clamp' });



        // Uniform buffer

        this.uniformBuffer = this.vgpu.buffer.create({ size: 32, usage: 'uniform', label: 'UnderwaterUniforms' }).buffer;



        // Bind group layout

        this.bindGroupLayout = this.vgpu.bindings.defineLayout('underwater', [

            { binding: 0, type: 'uniform', visibility: 'fragment' },

            { binding: 1, type: 'texture', visibility: 'fragment', sampleType: 'float' },

            { binding: 2, type: 'sampler', visibility: 'fragment' },

        ]);



        // Create pipeline (no depth attachment - post-processing)

        this.pipeline = this.vgpu.pipeline.render({

            vertex: { module: shaderModule, entryPoint: 'vs_main' },

            fragment: { module: shaderModule, entryPoint: 'fs_main' },

            layouts: [this.bindGroupLayout],

            colorFormat: navigator.gpu.getPreferredCanvasFormat(),

            depthFormat: null,

            topology: 'triangle-list',

            label: 'UnderwaterPipeline'

        });



        // Create output texture

        this.createTextures(width, height);



        this.initialized = true;

        console.log('Underwater pass initialized');

    }



    /**

     * Create/resize textures

     */

    createTextures(width, height) {

        if (this.outputTexture) {

            this.outputTexture.destroy();

        }



        this.outputTexture = this.vgpu.texture.create({

            width, height, format: navigator.gpu.getPreferredCanvasFormat(),

            usage: 'render|texture', label: 'UnderwaterOutput'

        }).texture;

        this.outputView = this.outputTexture.createView();



        this.width = width;

        this.height = height;

    }



    /**

     * Resize pass

     */

    resize(width, height) {

        if (width !== this.width || height !== this.height) {

            this.createTextures(width, height);

        }

    }



    /**

     * Update underwater state from camera position and voxel data

     * @param {ChunkManager} chunkManager

     * @param {number[]} cameraPos - [x, y, z]

     * @param {number} waterMaterial - MATERIAL.WATER constant

     */

    updateUnderwaterState(chunkManager, cameraPos, waterMaterial) {

        if (!cameraPos) {

            this.isUnderwater = false;

            this.waterDepth = 0;

            return;

        }



        const [cx, cy, cz] = cameraPos;

        const voxel = chunkManager.getVoxel(cx, cy, cz);



        this.isUnderwater = (voxel === waterMaterial);



        if (this.isUnderwater) {

            // Calculate depth below water surface

            // Scan upward to find surface

            let depth = 0;

            for (let y = Math.ceil(cy); y < cy + 50; y++) {

                const above = chunkManager.getVoxel(cx, y, cz);

                if (above !== waterMaterial) {

                    depth = y - cy;

                    break;

                }

                depth = y - cy + 1;

            }

            this.waterDepth = Math.max(0, depth);

        } else {

            this.waterDepth = 0;

        }

    }



    /**

     * Render underwater effect

     * @param {GPUCommandEncoder} commandEncoder

     * @param {GPUTextureView} inputView - Scene color texture

     * @param {GPUTextureView} outputView - Target to render to (swapchain or intermediate)

     * @param {number} deltaTime

     */

    render(commandEncoder, inputView, outputView, deltaTime) {

        if (!this.initialized || !this.enabled || !this.isUnderwater) {

            return false; // Skip if not underwater

        }



        this.time += deltaTime;



        // Update uniforms - use pre-allocated buffer

        const uniformData = this._uniformData;

        uniformData[0] = this.time;

        uniformData[1] = this.waterDepth;

        uniformData[2] = this.fogDensity;

        uniformData[3] = this.distortionStrength;

        uniformData[4] = this.tintColor[0];

        uniformData[5] = this.tintColor[1];

        uniformData[6] = this.tintColor[2];

        uniformData[7] = 0;

        this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);



        // Create bind group for this frame

        const bindGroup = this.device.createBindGroup({

            layout: this.bindGroupLayout,

            entries: [

                { binding: 0, resource: { buffer: this.uniformBuffer } },

                { binding: 1, resource: inputView },

                { binding: 2, resource: this.sampler },

            ],

        });



        // Render pass

        const pass = commandEncoder.beginRenderPass({

            colorAttachments: [{

                view: outputView,

                loadOp: 'load',

                storeOp: 'store',

            }],

        });



        pass.setPipeline(this.pipeline);

        pass.setBindGroup(0, bindGroup);

        pass.draw(3); // Fullscreen triangle

        pass.end();



        return true;

    }



    /**

     * Load configuration from engine.cfg section

     * @param {Object} cfg - Config from [underwater] section

     */

    loadConfig(cfg) {

        if (!cfg) return;



        this.enabled = cfg.enabled !== false;

        this.fogColor = [

            parseFloat(cfg.fog_r) || 0.0,

            parseFloat(cfg.fog_g) || 0.3,

            parseFloat(cfg.fog_b) || 0.5,

        ];

        this.fogDensity = parseFloat(cfg.fog_density) || 0.1;

        this.causticsIntensity = parseFloat(cfg.caustics_intensity) || 0.3;

        this.distortion = parseFloat(cfg.distortion) || 0.02;

    }



    /**

     * Cleanup

     */

    destroy() {

        if (this.outputTexture) this.outputTexture.destroy();

        if (this.uniformBuffer) this.uniformBuffer.destroy();

        this.initialized = false;

    }

}



export default UnderwaterPass;
