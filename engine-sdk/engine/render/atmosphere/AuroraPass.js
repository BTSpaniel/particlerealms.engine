// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>

//

// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha



/**

 * AuroraPass.js - Volumetric Aurora Borealis Rendering

 * Now powered by vGPU driver

 *

 * Implements realistic aurora curtains using:

 * - Difference-of-Perlin noise for curtain patterns

 * - Ray marching through aurora volume (polar regions)

 * - Physically-based color gradient (557nm green → 630nm red)

 * - Multi-layer noise scrolling for animation

 * - Additive blending for glow effect

 */



import { initVGPU } from '../../core/gpu/VirtualGPU.js';
import {
    LEGACY_PCG32_WGSL,
    LEGACY_RENDER_RUNTIME_PCG_HASH_WGSL,
} from '../../core/math/MathBits.js';


// Aurora altitude range (in meters)

const AURORA_MIN_ALTITUDE = 80000;   // 80km

const AURORA_MAX_ALTITUDE = 300000;  // 300km

const AURORA_THICKNESS = AURORA_MAX_ALTITUDE - AURORA_MIN_ALTITUDE;



// Aurora visibility (latitude threshold)

const AURORA_LATITUDE_MIN = 60;  // degrees (visible above 60°N/S)



// WGSL Compute/Fragment shader for aurora rendering

export const AURORA_WGSL = /* wgsl */ `

struct AuroraUniforms {

    // Planet

    planetRadius: f32,

    atmosphereRadius: f32,

    auroraMinAlt: f32,

    auroraMaxAlt: f32,



    // Aurora parameters

    intensity: f32,

    curtainScale: f32,

    animationSpeed: f32,

    colorShift: f32,



    // Camera

    cameraPosition: vec3<f32>,

    time: f32,



    // Sun (for visibility)

    sunDirection: vec3<f32>,

    latitudeThreshold: f32,

}



const PI: f32 = 3.14159265359;

const AURORA_STEPS: u32 = 32u;



// PCG hash - deterministic across all GPUs
${LEGACY_PCG32_WGSL}
${LEGACY_RENDER_RUNTIME_PCG_HASH_WGSL}

fn hash(p: vec2<f32>) -> f32 {
    let seed = pcg_aurora(bitcast<u32>(p.x) + pcg_aurora(bitcast<u32>(p.y)));

    return f32(seed) / 4294967295.0;

}



// 2D noise

fn noise2D(p: vec2<f32>) -> f32 {

    let i = floor(p);

    let f = fract(p);

    let u = f * f * (3.0 - 2.0 * f);



    return mix(

        mix(hash(i + vec2<f32>(0.0, 0.0)), hash(i + vec2<f32>(1.0, 0.0)), u.x),

        mix(hash(i + vec2<f32>(0.0, 1.0)), hash(i + vec2<f32>(1.0, 1.0)), u.x),

        u.y

    );

}



// Fractal Brownian Motion

fn fbm(p: vec2<f32>, octaves: i32) -> f32 {

    var value = 0.0;

    var amplitude = 0.5;

    var frequency = 1.0;

    var pos = p;



    for (var i = 0; i < octaves; i++) {

        value += amplitude * noise2D(pos * frequency);

        amplitude *= 0.5;

        frequency *= 2.0;

    }

    return value;

}



// Difference-of-noise curtain pattern (Hillaire aurora technique)

fn auroraCurtain(xz: vec2<f32>, time: f32, scale: f32) -> f32 {

    let scale1 = scale * 0.5;

    let scale2 = scale * 0.8;



    // Two scrolling noise layers

    let noise1 = fbm(xz * scale1 + vec2<f32>(time * 0.1, 0.0), 4);

    let noise2 = fbm(xz * scale2 - vec2<f32>(time * 0.15, time * 0.05), 4);



    // Difference creates curtain-like patterns

    let diff = abs(noise1 - noise2);



    // Sharp curtain edges

    return pow(diff, 2.5);

}



// Aurora color based on altitude (emission line physics)

// 557.7nm green (oxygen) dominant at low altitude

// 630.0nm red (oxygen) at high altitude

// 427.8nm blue/purple (nitrogen) sometimes visible

fn auroraColor(altitude: f32, intensity: f32, colorShift: f32) -> vec3<f32> {

    // Normalize altitude within aurora band

    let t = saturate((altitude - 80000.0) / 220000.0);



    // Base colors (emission lines)

    let green = vec3<f32>(0.2, 1.0, 0.3);   // 557.7nm oxygen

    let red = vec3<f32>(1.0, 0.2, 0.3);     // 630.0nm oxygen

    let purple = vec3<f32>(0.4, 0.2, 1.0);  // 427.8nm nitrogen



    // Altitude-based color mixing

    var color = mix(green, red, pow(t, 0.7 + colorShift * 0.3));



    // Add purple at very high altitudes

    color = mix(color, purple, smoothstep(0.7, 1.0, t) * 0.3);



    return color * intensity;

}



// Ray-sphere intersection

fn raySphereIntersect(rayOrigin: vec3<f32>, rayDir: vec3<f32>, sphereRadius: f32) -> vec2<f32> {

    let b = dot(rayOrigin, rayDir);

    let c = dot(rayOrigin, rayOrigin) - sphereRadius * sphereRadius;

    let d = b * b - c;



    if (d < 0.0) {

        return vec2<f32>(-1.0, -1.0);

    }



    let sqrtD = sqrt(d);

    return vec2<f32>(-b - sqrtD, -b + sqrtD);

}



// Sample aurora at a 3D point

fn sampleAurora(pos: vec3<f32>, aurora: AuroraUniforms) -> vec4<f32> {

    let altitude = length(pos) - aurora.planetRadius;



    // Only render within aurora altitude band

    if (altitude < aurora.auroraMinAlt || altitude > aurora.auroraMaxAlt) {

        return vec4<f32>(0.0);

    }



    // Latitude check (aurora near poles)

    let lat = asin(pos.y / length(pos)) * 180.0 / PI;

    let latFactor = smoothstep(aurora.latitudeThreshold - 10.0, aurora.latitudeThreshold + 5.0, abs(lat));



    if (latFactor < 0.01) {

        return vec4<f32>(0.0);

    }



    // Project to XZ plane for curtain sampling

    let xz = pos.xz / (aurora.planetRadius + altitude);



    // Sample curtain pattern

    let curtain = auroraCurtain(xz, aurora.time * aurora.animationSpeed, aurora.curtainScale);



    // Vertical falloff (soft edges at altitude boundaries)

    let altNorm = (altitude - aurora.auroraMinAlt) / (aurora.auroraMaxAlt - aurora.auroraMinAlt);

    let verticalFade = sin(altNorm * PI);  // Peaks in middle



    // Night-side visibility (aurora dimmer on day side)

    let upDir = normalize(pos);

    let nightFactor = smoothstep(0.1, -0.2, dot(upDir, aurora.sunDirection));



    // Combined density

    let density = curtain * verticalFade * latFactor * nightFactor * aurora.intensity;



    if (density < 0.001) {

        return vec4<f32>(0.0);

    }



    // Get aurora color

    let color = auroraColor(altitude, density, aurora.colorShift);



    return vec4<f32>(color, density);

}



// Main aurora ray marching

fn rayMarchAurora(rayOrigin: vec3<f32>, rayDir: vec3<f32>, aurora: AuroraUniforms) -> vec4<f32> {

    // Find intersection with aurora shell (inner and outer)

    let innerRadius = aurora.planetRadius + aurora.auroraMinAlt;

    let outerRadius = aurora.planetRadius + aurora.auroraMaxAlt;



    let innerHit = raySphereIntersect(rayOrigin, rayDir, innerRadius);

    let outerHit = raySphereIntersect(rayOrigin, rayDir, outerRadius);



    // Determine ray segment through aurora volume

    var tStart = max(0.0, outerHit.x);

    var tEnd = outerHit.y;



    // Handle camera inside aurora volume

    let camAlt = length(rayOrigin) - aurora.planetRadius;

    if (camAlt > aurora.auroraMinAlt && camAlt < aurora.auroraMaxAlt) {

        tStart = 0.0;

    } else if (camAlt < aurora.auroraMinAlt) {

        // Camera below aurora

        if (innerHit.x > 0.0) {

            tStart = innerHit.x;

            tEnd = min(outerHit.y, innerHit.y);

        }

    }



    if (tStart >= tEnd || tEnd < 0.0) {

        return vec4<f32>(0.0);

    }



    // Ray march

    let stepSize = (tEnd - tStart) / f32(AURORA_STEPS);

    var accumulatedColor = vec3<f32>(0.0);

    var accumulatedAlpha = 0.0;



    for (var i = 0u; i < AURORA_STEPS; i++) {

        let t = tStart + (f32(i) + 0.5) * stepSize;

        let pos = rayOrigin + rayDir * t;



        let sample = sampleAurora(pos, aurora);



        if (sample.a > 0.001) {

            // Front-to-back compositing with additive color

            let alpha = sample.a * stepSize * 0.001;  // Scale for integration

            accumulatedColor += sample.rgb * alpha * (1.0 - accumulatedAlpha);

            accumulatedAlpha += alpha * (1.0 - accumulatedAlpha);



            // Early termination

            if (accumulatedAlpha > 0.99) {

                break;

            }

        }

    }



    return vec4<f32>(accumulatedColor, accumulatedAlpha);

}

`;



/**

 * AuroraPass - Volumetric aurora rendering pass

 */

export class AuroraPass {

    constructor() {

        this.initialized = false;

        this.device = null;

        this.enabled = true;



        // Planet parameters

        this.planetRadius = 424000;  // meters



        // Aurora parameters

        this.intensity = 1.0;

        this.curtainScale = 0.0002;

        this.animationSpeed = 1.0;

        this.colorShift = 0.0;  // -1 to 1 (more green to more red)

        this.latitudeThreshold = 60;  // degrees



        // Time

        this.time = 0;



        // Sun direction (for night visibility)

        this.sunDirection = [0, 1, 0];



        // GPU resources

        this.uniformBuffer = null;



        // Pre-allocated buffer to avoid per-update allocations

        this._uniformData = new Float32Array(16);

    }



    /**

     * Initialize GPU resources

     * @param {GPUDevice} device

     */

    init(device) {

        this.vgpu = initVGPU(device);

        this.device = device;



        // Create uniform buffer using vGPU

        this.uniformBuffer = this.vgpu.buffer.create({ size: 64, usage: 'uniform', label: 'AuroraUniforms' }).buffer;



        this.updateUniforms();

        this.initialized = true;

        console.log('[AuroraPass] Initialized with vGPU');

    }



    /**

     * Update uniform buffer

     */

    updateUniforms() {

        if (!this.device || !this.uniformBuffer) return;



        // Use pre-allocated buffer to avoid per-update allocations

        const data = this._uniformData;



        // Planet

        data[0] = this.planetRadius;

        data[1] = this.planetRadius + 100000;  // atmosphere radius

        data[2] = AURORA_MIN_ALTITUDE;

        data[3] = AURORA_MAX_ALTITUDE;



        // Aurora params

        data[4] = this.intensity;

        data[5] = this.curtainScale;

        data[6] = this.animationSpeed;

        data[7] = this.colorShift;



        // Camera position (to be updated per frame)

        data[8] = 0;

        data[9] = this.planetRadius + 1.7;

        data[10] = 0;

        data[11] = this.time;



        // Sun direction

        data[12] = this.sunDirection[0];

        data[13] = this.sunDirection[1];

        data[14] = this.sunDirection[2];

        data[15] = this.latitudeThreshold;



        this.device.queue.writeBuffer(this.uniformBuffer, 0, data);

    }



    /**

     * Update per frame (call before rendering)

     * @param {number} deltaTime - Time since last frame in seconds

     * @param {Object} camera - Camera object with position

     */

    update(deltaTime, camera = null) {

        this.time += deltaTime;



        if (camera) {

            // Would update camera position in uniforms

        }



        this.updateUniforms();

    }



    /**

     * Set sun direction (for night-side visibility)

     * @param {number[]} dir - Normalized [x, y, z]

     */

    setSunDirection(dir) {

        const len = Math.sqrt(dir[0]**2 + dir[1]**2 + dir[2]**2);

        this.sunDirection = [dir[0]/len, dir[1]/len, dir[2]/len];

        this.updateUniforms();

    }



    /**

     * Set aurora intensity

     * @param {number} intensity - 0 to 2+ (default 1.0)

     */

    setIntensity(intensity) {

        this.intensity = intensity;

        this.updateUniforms();

    }



    /**

     * Set color shift

     * @param {number} shift - -1 (green) to 1 (red), 0 = natural

     */

    setColorShift(shift) {

        this.colorShift = Math.max(-1, Math.min(1, shift));

        this.updateUniforms();

    }



    /**

     * Get uniform buffer for binding

     */

    getUniformBuffer() {

        return this.uniformBuffer;

    }



    /**

     * Get WGSL shader code

     */

    static getShaderCode() {

        return AURORA_WGSL;

    }



    /**

     * Destroy GPU resources

     */

    destroy() {

        this.uniformBuffer?.destroy();

        this.initialized = false;

    }

}



export default AuroraPass;
