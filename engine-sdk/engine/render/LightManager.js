// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * LightManager.js - Collects ECS Light entities and uploads to GPU
 * 
 * Queries all entities with Light + Transform components each frame,
 * builds a GPU uniform buffer, and exposes a bind group for renderers.
 * 
 * GPU Layout (std140-aligned):
 *   vec3 ambientColor + f32 ambientIntensity        (16 bytes)
 *   vec3 sunDirection + f32 sunIntensity             (16 bytes)
 *   vec3 sunColor     + u32 lightCount               (16 bytes)
 *   f32  globalBrightness + f32 enableDiffuse + f32 enableSun + f32 _pad (16 bytes)
 *   Light[16] array                                   (16 * 48 = 768 bytes)
 *   Total: 64 + 768 = 832 bytes
 * 
 * Each Light (48 bytes, 12 floats):
 *   vec3 position  + u32 lightType     (16 bytes)
 *   vec3 color     + f32 intensity     (16 bytes)
 *   vec3 direction + f32 range         (16 bytes)
 */

import { getArchetypeStorage } from '../ecs/storage/ArchetypeStorage.js';

const MAX_LIGHTS = 16;

// Per-light: 12 floats (48 bytes)
const FLOATS_PER_LIGHT = 12;
// Header: 16 floats (64 bytes)
const HEADER_FLOATS = 16;
// Total buffer size in floats
const TOTAL_FLOATS = HEADER_FLOATS + MAX_LIGHTS * FLOATS_PER_LIGHT;
// Total buffer size in bytes (must be 16-byte aligned)
const BUFFER_SIZE = TOTAL_FLOATS * 4; // 832 bytes

// Light type string → u32
const LIGHT_TYPE_MAP = { point: 0, directional: 1, spot: 2 };

// Reusable CPU-side buffer (avoids per-frame allocation)
const _lightData = new Float32Array(TOTAL_FLOATS);
const _u32View = new Uint32Array(_lightData.buffer);

export class LightManager {
    constructor(device) {
        this.device = device;

        // Defaults (overridden by EditorSettings / renderState)
        this.ambientColor = [0.35, 0.38, 0.45];
        this.ambientIntensity = 0.5;
        this.sunDirection = [0.2, -1.0, 0.1];
        this.sunColor = [1.0, 0.95, 0.85];
        this.sunIntensity = 1.0;
        this.globalBrightness = 1.4;
        this.enableDiffuse = true;
        this.enableSun = true;
        this.lightingMode = 'dynamic'; // 'unlit', 'static', 'dynamic'
        this.debugMode = 0; // 0=standard, 1=normals, 2=depth

        // GPU resources
        this.uniformBuffer = null;
        this.bindGroupLayout = null;
        this.bindGroup = null;

        // Collected light count (for stats)
        this.activeLightCount = 0;

        // Particle-emitted lights (fed from ParticleLightEmission system)
        this.particleLights = [];

        // Particle light transmission: how much particles shadow/tint the sun
        // sunShadow: 0 = no shadow (clear sky), 1 = fully blocked
        // sunTint: color shift from light passing through colored particles
        this.particleSunShadow = 0;
        this.particleSunTint = [1, 1, 1];

        this._init();
    }

    _init() {
        // Create uniform buffer
        this.uniformBuffer = this.device.createBuffer({
            size: BUFFER_SIZE,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            label: 'LightingUniforms',
        });

        // Create bind group layout - renderers bind this at group(1)
        this.bindGroupLayout = this.device.createBindGroupLayout({
            label: 'LightingBindGroupLayout',
            entries: [{
                binding: 0,
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                buffer: { type: 'uniform', minBindingSize: BUFFER_SIZE },
            }],
        });

        // Create bind group
        this.bindGroup = this.device.createBindGroup({
            label: 'LightingBindGroup',
            layout: this.bindGroupLayout,
            entries: [{
                binding: 0,
                resource: { buffer: this.uniformBuffer },
            }],
        });
    }

    /**
     * Collect lights from ECS world and upload to GPU.
     * Call once per frame before rendering.
     */
    update(ecsWorld) {
        // Zero out buffer
        _lightData.fill(0);

        const isUnlit = this.lightingMode === 'unlit';

        // --- Header (offsets 0-15) ---
        // ambientColor (0-2) + ambientIntensity (3)
        if (isUnlit) {
            _lightData[0] = 1.0;
            _lightData[1] = 1.0;
            _lightData[2] = 1.0;
            _lightData[3] = 1.0;
        } else {
            _lightData[0] = this.ambientColor[0];
            _lightData[1] = this.ambientColor[1];
            _lightData[2] = this.ambientColor[2];
            _lightData[3] = this.ambientIntensity;
        }

        // sunDirection (4-6) + sunIntensity (7)
        // Apply particle shadow: smoke/gas attenuates sunlight passing through
        const shadowFactor = 1 - Math.min(this.particleSunShadow, 0.95);
        if (!isUnlit && this.enableSun) {
            const sd = this.sunDirection;
            const len = Math.sqrt(sd[0] * sd[0] + sd[1] * sd[1] + sd[2] * sd[2]) || 1;
            _lightData[4] = sd[0] / len;
            _lightData[5] = sd[1] / len;
            _lightData[6] = sd[2] / len;
            _lightData[7] = this.sunIntensity * this.globalBrightness * shadowFactor;
        }
        // else: sunIntensity stays 0 → shader skips sun

        // sunColor (8-10) tinted by particle absorption + lightCount placeholder (11 as u32)
        if (!isUnlit && this.enableSun) {
            const tint = this.particleSunTint;
            _lightData[8] = this.sunColor[0] * tint[0];
            _lightData[9] = this.sunColor[1] * tint[1];
            _lightData[10] = this.sunColor[2] * tint[2];
        }
        // lightCount written below after collecting

        // globalBrightness (12), enableDiffuse (13), enableSun (14), pad (15)
        _lightData[12] = isUnlit ? 0.0 : this.globalBrightness;
        _lightData[13] = (isUnlit || !this.enableDiffuse) ? 0.0 : 1.0;
        _lightData[14] = (isUnlit || !this.enableSun) ? 0.0 : 1.0;
        _lightData[15] = this.debugMode;

        // --- Collect dynamic lights from ECS ---
        let lightCount = 0;

        if (!isUnlit && ecsWorld) {
            const storage = getArchetypeStorage(ecsWorld);
            if (storage && storage.archetypesByKey) {
                for (const archetype of storage.archetypesByKey.values()) {
                    const names = archetype.componentNames;
                    // Must have both Light and Transform
                    if (names.indexOf('Light') === -1 || names.indexOf('Transform') === -1) continue;

                    const lightArr = archetype.componentData['Light'];
                    const transformArr = archetype.componentData['Transform'];
                    const count = archetype.entities.length;

                    for (let i = 0; i < count && lightCount < MAX_LIGHTS; i++) {
                        const light = lightArr[i];
                        const transform = transformArr[i];
                        if (!light || !transform) continue;

                        const offset = HEADER_FLOATS + lightCount * FLOATS_PER_LIGHT;

                        // position (0-2) from transform
                        const pos = transform.position || [0, 0, 0];
                        _lightData[offset + 0] = pos[0];
                        _lightData[offset + 1] = pos[1];
                        _lightData[offset + 2] = pos[2];

                        // lightType (3) as u32
                        _u32View[offset + 3] = LIGHT_TYPE_MAP[light.type] ?? 0;

                        // color (4-6)
                        const col = light.color || [1, 1, 1];
                        _lightData[offset + 4] = col[0];
                        _lightData[offset + 5] = col[1];
                        _lightData[offset + 6] = col[2];

                        // intensity (7)
                        _lightData[offset + 7] = (light.intensity ?? 1.5) * this.globalBrightness;

                        // direction (8-10) - for directional/spot, derive from transform rotation
                        const dir = light.direction || [0, -1, 0];
                        _lightData[offset + 8] = dir[0];
                        _lightData[offset + 9] = dir[1];
                        _lightData[offset + 10] = dir[2];

                        // range (11) - use range field, or fallback to 10
                        _lightData[offset + 11] = light.range ?? 10.0;

                        lightCount++;
                    }
                }
            }
        }

        // --- Merge particle-emitted lights (fire, plasma → point lights) ---
        if (!isUnlit && this.particleLights.length > 0) {
            for (let p = 0; p < this.particleLights.length && lightCount < MAX_LIGHTS; p++) {
                const pl = this.particleLights[p];
                if (!pl || pl.intensity < 0.01) continue;

                const offset = HEADER_FLOATS + lightCount * FLOATS_PER_LIGHT;

                // position
                _lightData[offset + 0] = pl.position[0];
                _lightData[offset + 1] = pl.position[1];
                _lightData[offset + 2] = pl.position[2];
                // lightType = 0 (point)
                _u32View[offset + 3] = 0;
                // color
                _lightData[offset + 4] = pl.color[0];
                _lightData[offset + 5] = pl.color[1];
                _lightData[offset + 6] = pl.color[2];
                // intensity (scaled by globalBrightness)
                _lightData[offset + 7] = pl.intensity * this.globalBrightness;
                // direction (unused for point lights)
                _lightData[offset + 8] = 0;
                _lightData[offset + 9] = 0;
                _lightData[offset + 10] = 0;
                // range
                _lightData[offset + 11] = pl.radius || 5.0;

                lightCount++;
            }
        }

        // Write lightCount as u32 at offset 11
        _u32View[11] = lightCount;
        this.activeLightCount = lightCount;

        // Upload to GPU
        this.device.queue.writeBuffer(this.uniformBuffer, 0, _lightData);
    }

    /**
     * Get the WGSL struct definitions for the lighting uniform.
     * Renderers embed this in their shader source.
     */
    static getShaderDefs() {
        return /* wgsl */`
struct DynamicLight {
    position:  vec3<f32>,
    lightType: u32,        // 0=point, 1=directional, 2=spot
    color:     vec3<f32>,
    intensity: f32,
    direction: vec3<f32>,
    range:     f32,
}

struct LightingUniforms {
    ambientColor:     vec3<f32>,
    ambientIntensity: f32,
    sunDirection:     vec3<f32>,
    sunIntensity:     f32,
    sunColor:         vec3<f32>,
    lightCount:       u32,
    globalBrightness: f32,
    enableDiffuse:    f32,
    enableSun:        f32,
    debugMode:        f32,
    lights:           array<DynamicLight, ${MAX_LIGHTS}>,
}
`;
    }

    /**
     * Get the WGSL lighting calculation function.
     * Expects `lighting` uniform to be bound.
     * Uses PBR: GGX/Trowbridge-Reitz NDF, Smith-Schlick geometry, Schlick Fresnel.
     * calcAllLighting(fragPos, normal, baseColor, viewDir, roughness, metallic)
     */
    static getShaderFunctions() {
        return /* wgsl */`
// ---- PBR helpers ----

// GGX Normal Distribution Function
fn pbr_D_GGX(NdotH: f32, alpha: f32) -> f32 {
    let a2 = alpha * alpha;
    let d = NdotH * NdotH * (a2 - 1.0) + 1.0;
    return a2 / (3.14159265 * d * d + 1e-7);
}

// Smith-Schlick-GGX geometry term (single direction)
fn pbr_G1_Schlick(NdotV: f32, k: f32) -> f32 {
    return NdotV / (NdotV * (1.0 - k) + k + 1e-7);
}

// Smith geometry (both directions combined)
fn pbr_G_Smith(NdotV: f32, NdotL: f32, roughness: f32) -> f32 {
    let k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
    return pbr_G1_Schlick(NdotV, k) * pbr_G1_Schlick(NdotL, k);
}

// Schlick Fresnel
fn pbr_F_Schlick(cosTheta: f32, F0: vec3<f32>) -> vec3<f32> {
    return F0 + (vec3<f32>(1.0) - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

// Full Cook-Torrance specular BRDF contribution
fn pbr_specular(N: vec3<f32>, V: vec3<f32>, L: vec3<f32>, F0: vec3<f32>, roughness: f32) -> vec3<f32> {
    let H = normalize(V + L);
    let NdotH = max(dot(N, H), 0.0);
    let NdotV = max(dot(N, V), 0.0);
    let NdotL = max(dot(N, L), 0.0);
    let HdotV = max(dot(H, V), 0.0);
    let alpha = roughness * roughness;
    let D = pbr_D_GGX(NdotH, alpha);
    let G = pbr_G_Smith(NdotV, NdotL, roughness);
    let F = pbr_F_Schlick(HdotV, F0);
    return (D * G * F) / (4.0 * NdotV * NdotL + 1e-7);
}

// ---- Light attenuation ----

fn pbr_attenuatePoint(dist: f32, range: f32) -> f32 {
    // Physically-based inverse-square with smooth window cutoff
    let r = max(range, 0.01);
    let ratio = dist / r;
    let window = clamp(1.0 - ratio * ratio * ratio * ratio, 0.0, 1.0);
    return (window * window) / (dist * dist + 1.0);
}

// ---- Per-light PBR contribution ----

fn calcDynamicLight(light: DynamicLight, fragPos: vec3<f32>, normal: vec3<f32>) -> vec3<f32> {
    var lightDir: vec3<f32>;
    var attenuation: f32 = 1.0;

    if (light.lightType == 0u) {
        // Point light
        let toLight = light.position - fragPos;
        let dist = length(toLight);
        lightDir = normalize(toLight);
        attenuation = pbr_attenuatePoint(dist, light.range);
    } else if (light.lightType == 1u) {
        // Directional light — no distance falloff
        lightDir = normalize(-light.direction);
    } else {
        // Spot light
        let toLight = light.position - fragPos;
        let dist = length(toLight);
        lightDir = normalize(toLight);
        attenuation = pbr_attenuatePoint(dist, light.range);
        let spotCos = dot(-lightDir, normalize(light.direction));
        attenuation *= smoothstep(0.5, 0.8, spotCos);
    }

    let diff = max(dot(normal, lightDir), 0.0);
    let backLight = max(dot(normal, -lightDir), 0.0) * 0.12;
    return light.color * light.intensity * (diff + backLight) * attenuation;
}

// ---- Main PBR lighting entry point ----
// viewDir: normalize(cameraPos - fragPos)
// roughness: 0=mirror, 1=fully rough (default 0.6 if unknown)
// metallic:  0=dielectric, 1=metal (default 0.0)

fn calcAllLighting(fragPos: vec3<f32>, normal: vec3<f32>, baseColor: vec3<f32>, viewDir: vec3<f32>, roughness: f32, metallic: f32) -> vec3<f32> {
    // Debug modes
    if (lighting.debugMode > 0.5 && lighting.debugMode < 1.5) {
        return normal * 0.5 + vec3<f32>(0.5);
    }
    if (lighting.debugMode > 1.5) {
        let d = clamp(length(fragPos) * 0.02, 0.0, 1.0);
        return vec3<f32>(1.0 - d, 1.0 - d * 0.8, 1.0 - d * 0.5);
    }

    let rough = clamp(roughness, 0.04, 1.0);
    let metal = clamp(metallic, 0.0, 1.0);

    // F0: dielectric ~0.04, metal uses albedo
    let F0 = mix(vec3<f32>(0.04), baseColor, metal);
    // Energy-conserving diffuse: metals have no diffuse
    let diffuseColor = baseColor * (1.0 - metal);

    let N = normalize(normal);
    let V = normalize(viewDir);
    let NdotV = max(dot(N, V), 0.0);

    // Ambient (image-based approximation: Fresnel-weighted)
    let ambF = pbr_F_Schlick(NdotV, F0);
    let kD_amb = (vec3<f32>(1.0) - ambF) * (1.0 - metal);
    let ambientIrradiance = lighting.ambientColor * lighting.ambientIntensity;
    var result = kD_amb * diffuseColor * ambientIrradiance;
    // Ambient specular approximation (roughness dims it)
    result += ambF * ambientIrradiance * (1.0 - rough) * 0.5;

    // Sun light
    if (lighting.enableSun > 0.5 && lighting.sunIntensity > 0.0) {
        let L = normalize(-lighting.sunDirection);
        let NdotL = max(dot(N, L), 0.0);
        let backLight = max(dot(N, -L), 0.0) * 0.08;
        let radiance = lighting.sunColor * lighting.sunIntensity;

        // Fresnel for this light direction
        let H = normalize(V + L);
        let F = pbr_F_Schlick(max(dot(H, V), 0.0), F0);
        let kD = (vec3<f32>(1.0) - F) * (1.0 - metal);

        // Diffuse + specular
        let diffuse = kD * diffuseColor / 3.14159265;
        let spec = pbr_specular(N, V, L, F0, rough);
        result += (diffuse + spec) * radiance * NdotL;
        // Subtle back-lighting for fill
        result += diffuseColor * radiance * backLight * 0.15;
    }

    // Dynamic lights
    if (lighting.enableDiffuse > 0.5) {
        for (var i: u32 = 0u; i < lighting.lightCount && i < ${MAX_LIGHTS}u; i++) {
            let light = lighting.lights[i];
            var lightDir: vec3<f32>;
            var attenuation: f32 = 1.0;

            if (light.lightType == 0u) {
                let toLight = light.position - fragPos;
                let dist = length(toLight);
                lightDir = normalize(toLight);
                attenuation = pbr_attenuatePoint(dist, light.range);
            } else if (light.lightType == 1u) {
                lightDir = normalize(-light.direction);
            } else {
                let toLight = light.position - fragPos;
                let dist = length(toLight);
                lightDir = normalize(toLight);
                attenuation = pbr_attenuatePoint(dist, light.range);
                let spotCos = dot(-lightDir, normalize(light.direction));
                attenuation *= smoothstep(0.5, 0.8, spotCos);
            }

            let NdotL = max(dot(N, lightDir), 0.0);
            let radiance = light.color * light.intensity * attenuation;
            let H = normalize(V + lightDir);
            let F = pbr_F_Schlick(max(dot(H, V), 0.0), F0);
            let kD = (vec3<f32>(1.0) - F) * (1.0 - metal);
            let diffuse = kD * diffuseColor / 3.14159265;
            let spec = pbr_specular(N, V, lightDir, F0, rough);
            result += (diffuse + spec) * radiance * NdotL;
        }
    }

    return result;
}

// Backward-compat overload: no viewDir/roughness/metallic (assumes matte dielectric, top-down view)
fn calcAllLightingSimple(fragPos: vec3<f32>, normal: vec3<f32>, baseColor: vec3<f32>) -> vec3<f32> {
    let fallbackView = normalize(-lighting.sunDirection + vec3<f32>(0.0, 1.0, 0.0));
    return calcAllLighting(fragPos, normal, baseColor, fallbackView, 0.7, 0.0);
}
`;
    }

    destroy() {
        if (this.uniformBuffer) {
            this.uniformBuffer.destroy();
            this.uniformBuffer = null;
        }
        this.bindGroup = null;
        this.bindGroupLayout = null;
    }
}
