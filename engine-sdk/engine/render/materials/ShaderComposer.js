// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ShaderComposer.js - WGSL Modular Shader Composition System
 * 
 * Since WGSL v1.0 lacks #include, this implements:
 * 1. Chunk-based composition (concatenating shader modules)
 * 2. Include directive preprocessing (#include "filename")
 * 3. Override constants for pipeline specialization
 * 4. Automatic bind group layout extraction
 */

/**
 * ShaderChunkRegistry - Central registry for shader code chunks
 */
export class ShaderChunkRegistry {
    constructor() {
        this.chunks = new Map();
        this.includePattern = /#include\s+"([^"]+)"/g;
    }
    
    /**
     * Register a shader chunk
     * @param {string} name - Chunk identifier
     * @param {string} code - WGSL code
     */
    register(name, code) {
        this.chunks.set(name, code);
    }
    
    /**
     * Register multiple chunks at once
     * @param {Object} chunks - { name: code, ... }
     */
    registerAll(chunks) {
        for (const [name, code] of Object.entries(chunks)) {
            this.register(name, code);
        }
    }
    
    /**
     * Get a chunk by name
     * @param {string} name 
     * @returns {string|null}
     */
    get(name) {
        return this.chunks.get(name) || null;
    }
    
    /**
     * Check if chunk exists
     * @param {string} name 
     * @returns {boolean}
     */
    has(name) {
        return this.chunks.has(name);
    }
    
    /**
     * Process #include directives recursively
     * @param {string} source - Source code with includes
     * @param {Set<string>} included - Already included files (prevents circular)
     * @returns {string} - Processed code
     */
    processIncludes(source, included = new Set()) {
        return source.replace(this.includePattern, (match, filename) => {
            // Prevent circular includes
            if (included.has(filename)) {
                return `// [Already included: ${filename}]`;
            }
            
            const chunk = this.chunks.get(filename);
            if (!chunk) {
                console.warn(`[ShaderComposer] Missing include: ${filename}`);
                return `// [Missing include: ${filename}]`;
            }
            
            included.add(filename);
            // Recursively process includes in the chunk
            return this.processIncludes(chunk, included);
        });
    }
    
    /**
     * Compose shader from multiple chunks
     * @param {string[]} chunkNames - Ordered list of chunk names
     * @returns {string} - Combined WGSL code
     */
    compose(...chunkNames) {
        const parts = [];
        const included = new Set();
        
        for (const name of chunkNames) {
            const chunk = this.chunks.get(name);
            if (!chunk) {
                console.warn(`[ShaderComposer] Missing chunk: ${name}`);
                parts.push(`// [Missing chunk: ${name}]`);
                continue;
            }
            
            // Process includes within each chunk
            const processed = this.processIncludes(chunk, included);
            parts.push(`// === ${name} ===\n${processed}`);
        }
        
        return parts.join('\n\n');
    }
}

/**
 * PipelineOverrides - Manage WGSL override constants
 * 
 * WGSL override constants allow compile-time specialization:
 * ```wgsl
 * override USE_NORMAL_MAP: bool = false;
 * override ALPHA_CUTOFF: f32 = 0.5;
 * ```
 */
export class PipelineOverrides {
    constructor() {
        this.overrides = new Map();
    }
    
    /**
     * Set an override value
     * @param {string} name - Override name (matches WGSL)
     * @param {number|boolean} value - Value (bools become 0/1)
     * @returns {PipelineOverrides} - this for chaining
     */
    set(name, value) {
        // Convert boolean to number (WebGPU API uses doubles)
        const numValue = typeof value === 'boolean' ? (value ? 1.0 : 0.0) : Number(value);
        this.overrides.set(name, numValue);
        return this;
    }
    
    /**
     * Set multiple overrides at once
     * @param {Object} values - { name: value, ... }
     * @returns {PipelineOverrides}
     */
    setAll(values) {
        for (const [name, value] of Object.entries(values)) {
            this.set(name, value);
        }
        return this;
    }
    
    /**
     * Get override value
     * @param {string} name 
     * @returns {number|undefined}
     */
    get(name) {
        return this.overrides.get(name);
    }
    
    /**
     * Check if override is set
     * @param {string} name 
     * @returns {boolean}
     */
    has(name) {
        return this.overrides.has(name);
    }
    
    /**
     * Remove an override
     * @param {string} name 
     * @returns {boolean}
     */
    delete(name) {
        return this.overrides.delete(name);
    }
    
    /**
     * Clear all overrides
     */
    clear() {
        this.overrides.clear();
    }
    
    /**
     * Convert to WebGPU constants format
     * For use in pipeline compilation options
     * @returns {Object} - { constantName: value }
     */
    toConstants() {
        const constants = {};
        for (const [name, value] of this.overrides) {
            constants[name] = value;
        }
        return constants;
    }
    
    /**
     * Generate cache key for pipeline caching
     * @returns {string}
     */
    toCacheKey() {
        const sorted = [...this.overrides.entries()].sort((a, b) => a[0].localeCompare(b[0]));
        return sorted.map(([k, v]) => `${k}=${v}`).join('|');
    }
    
    /**
     * Clone overrides
     * @returns {PipelineOverrides}
     */
    clone() {
        const cloned = new PipelineOverrides();
        for (const [name, value] of this.overrides) {
            cloned.overrides.set(name, value);
        }
        return cloned;
    }
}

/**
 * ShaderVariant - A specific configuration of a shader
 */
export class ShaderVariant {
    constructor(baseModule, overrides = new PipelineOverrides()) {
        this.baseModule = baseModule;
        this.overrides = overrides;
    }
    
    /**
     * Get compilation options for this variant
     * @returns {Object}
     */
    getCompilationOptions() {
        return {
            constants: this.overrides.toConstants(),
        };
    }
    
    /**
     * Generate unique key for this variant
     * @returns {string}
     */
    getCacheKey() {
        return `${this.baseModule.label || 'shader'}_${this.overrides.toCacheKey()}`;
    }
}

/**
 * UberShaderBuilder - Build ubershaders with feature toggles
 */
export class UberShaderBuilder {
    constructor(registry) {
        this.registry = registry;
        this.features = new Map();
        this.baseChunks = [];
    }
    
    /**
     * Add a base chunk (always included)
     * @param {string} chunkName 
     * @returns {UberShaderBuilder}
     */
    addBaseChunk(chunkName) {
        this.baseChunks.push(chunkName);
        return this;
    }
    
    /**
     * Define a feature with its override constant and chunks
     * @param {string} featureName 
     * @param {Object} config - { overrideName, defaultEnabled, chunks }
     * @returns {UberShaderBuilder}
     */
    defineFeature(featureName, config) {
        this.features.set(featureName, {
            overrideName: config.overrideName || `USE_${featureName.toUpperCase()}`,
            defaultEnabled: config.defaultEnabled ?? false,
            chunks: config.chunks || [],
        });
        return this;
    }
    
    /**
     * Build shader source for specific feature set
     * @param {Set<string>} enabledFeatures 
     * @returns {string}
     */
    buildSource(enabledFeatures = new Set()) {
        const chunks = [...this.baseChunks];
        
        for (const [featureName, config] of this.features) {
            if (enabledFeatures.has(featureName) || config.defaultEnabled) {
                chunks.push(...config.chunks);
            }
        }
        
        return this.registry.compose(...chunks);
    }
    
    /**
     * Build overrides for specific feature set
     * @param {Set<string>} enabledFeatures 
     * @returns {PipelineOverrides}
     */
    buildOverrides(enabledFeatures = new Set()) {
        const overrides = new PipelineOverrides();
        
        for (const [featureName, config] of this.features) {
            const enabled = enabledFeatures.has(featureName) || config.defaultEnabled;
            overrides.set(config.overrideName, enabled);
        }
        
        return overrides;
    }
}

/**
 * Standard WGSL chunks for voxel rendering
 */
export const STANDARD_CHUNKS = {
    // Common math utilities
    'math_utils': /* wgsl */ `
fn saturate(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }
fn saturate3(v: vec3<f32>) -> vec3<f32> { return clamp(v, vec3(0.0), vec3(1.0)); }
fn lerp(a: f32, b: f32, t: f32) -> f32 { return a + (b - a) * t; }
fn lerp3(a: vec3<f32>, b: vec3<f32>, t: f32) -> vec3<f32> { return a + (b - a) * t; }
fn remap(v: f32, inMin: f32, inMax: f32, outMin: f32, outMax: f32) -> f32 {
    return outMin + (v - inMin) * (outMax - outMin) / (inMax - inMin);
}
`,
    
    // Noise functions
    'noise': /* wgsl */ `
fn hash3(p: vec3<f32>) -> f32 {
    var p3 = fract(p * 0.1031);
    p3 = p3 + dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

fn noise3D(p: vec3<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    
    return mix(
        mix(mix(hash3(i + vec3(0.0, 0.0, 0.0)), hash3(i + vec3(1.0, 0.0, 0.0)), u.x),
            mix(hash3(i + vec3(0.0, 1.0, 0.0)), hash3(i + vec3(1.0, 1.0, 0.0)), u.x), u.y),
        mix(mix(hash3(i + vec3(0.0, 0.0, 1.0)), hash3(i + vec3(1.0, 0.0, 1.0)), u.x),
            mix(hash3(i + vec3(0.0, 1.0, 1.0)), hash3(i + vec3(1.0, 1.0, 1.0)), u.x), u.y),
        u.z
    );
}

fn fbm(p: vec3<f32>, octaves: i32) -> f32 {
    var value = 0.0;
    var amplitude = 0.5;
    var pos = p;
    for (var i = 0; i < octaves; i = i + 1) {
        value = value + amplitude * noise3D(pos);
        amplitude = amplitude * 0.5;
        pos = pos * 2.0;
    }
    return value;
}
`,
    
    // Color space conversions
    'color_utils': /* wgsl */ `
fn linearToSRGB(color: vec3<f32>) -> vec3<f32> {
    let cutoff = color < vec3(0.0031308);
    let higher = vec3(1.055) * pow(color, vec3(1.0/2.4)) - vec3(0.055);
    let lower = color * vec3(12.92);
    return select(higher, lower, cutoff);
}

fn sRGBToLinear(color: vec3<f32>) -> vec3<f32> {
    let cutoff = color < vec3(0.04045);
    let higher = pow((color + vec3(0.055)) / vec3(1.055), vec3(2.4));
    let lower = color / vec3(12.92);
    return select(higher, lower, cutoff);
}

fn luminance(color: vec3<f32>) -> f32 {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

// ACES tone mapping
fn ACESFilm(x: vec3<f32>) -> vec3<f32> {
    let a = 2.51;
    let b = 0.03;
    let c = 2.43;
    let d = 0.59;
    let e = 0.14;
    return saturate3((x * (a * x + b)) / (x * (c * x + d) + e));
}
`,
    
    // PBR lighting
    'pbr_lighting': /* wgsl */ `
const PI: f32 = 3.14159265359;

fn fresnelSchlick(cosTheta: f32, F0: vec3<f32>) -> vec3<f32> {
    return F0 + (1.0 - F0) * pow(saturate(1.0 - cosTheta), 5.0);
}

fn distributionGGX(N: vec3<f32>, H: vec3<f32>, roughness: f32) -> f32 {
    let a = roughness * roughness;
    let a2 = a * a;
    let NdotH = max(dot(N, H), 0.0);
    let NdotH2 = NdotH * NdotH;
    
    let num = a2;
    var denom = (NdotH2 * (a2 - 1.0) + 1.0);
    denom = PI * denom * denom;
    
    return num / denom;
}

fn geometrySchlickGGX(NdotV: f32, roughness: f32) -> f32 {
    let r = (roughness + 1.0);
    let k = (r * r) / 8.0;
    let num = NdotV;
    let denom = NdotV * (1.0 - k) + k;
    return num / denom;
}

fn geometrySmith(N: vec3<f32>, V: vec3<f32>, L: vec3<f32>, roughness: f32) -> f32 {
    let NdotV = max(dot(N, V), 0.0);
    let NdotL = max(dot(N, L), 0.0);
    let ggx2 = geometrySchlickGGX(NdotV, roughness);
    let ggx1 = geometrySchlickGGX(NdotL, roughness);
    return ggx1 * ggx2;
}

fn calculatePBR(
    albedo: vec3<f32>,
    metallic: f32,
    roughness: f32,
    N: vec3<f32>,
    V: vec3<f32>,
    L: vec3<f32>,
    lightColor: vec3<f32>,
    lightIntensity: f32
) -> vec3<f32> {
    let H = normalize(V + L);
    
    let F0 = mix(vec3(0.04), albedo, metallic);
    
    let NDF = distributionGGX(N, H, roughness);
    let G = geometrySmith(N, V, L, roughness);
    let F = fresnelSchlick(max(dot(H, V), 0.0), F0);
    
    let kS = F;
    var kD = vec3(1.0) - kS;
    kD = kD * (1.0 - metallic);
    
    let numerator = NDF * G * F;
    let denominator = 4.0 * max(dot(N, V), 0.0) * max(dot(N, L), 0.0) + 0.0001;
    let specular = numerator / denominator;
    
    let NdotL = max(dot(N, L), 0.0);
    
    return (kD * albedo / PI + specular) * lightColor * lightIntensity * NdotL;
}
`,
    
    // Triplanar mapping
    'triplanar': /* wgsl */ `
fn triplanarWeights(normal: vec3<f32>, sharpness: f32) -> vec3<f32> {
    var weights = abs(normal);
    weights = pow(weights, vec3(sharpness));
    weights = weights / (weights.x + weights.y + weights.z);
    return weights;
}

fn triplanarSample(worldPos: vec3<f32>, normal: vec3<f32>, scale: f32, sharpness: f32) -> f32 {
    let weights = triplanarWeights(normal, sharpness);
    
    let texYZ = noise3D(vec3(worldPos.y, worldPos.z, 0.0) * scale);
    let texXZ = noise3D(vec3(worldPos.x, worldPos.z, 1.0) * scale);
    let texXY = noise3D(vec3(worldPos.x, worldPos.y, 2.0) * scale);
    
    return texYZ * weights.x + texXZ * weights.y + texXY * weights.z;
}
`,
    
    // Atmospheric scattering
    'atmosphere': /* wgsl */ `
fn rayleighPhase(cosTheta: f32) -> f32 {
    return 3.0 / (16.0 * PI) * (1.0 + cosTheta * cosTheta);
}

fn miePhase(cosTheta: f32, g: f32) -> f32 {
    let g2 = g * g;
    let num = 3.0 * (1.0 - g2) * (1.0 + cosTheta * cosTheta);
    let denom = (8.0 * PI) * (2.0 + g2) * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5);
    return num / denom;
}

fn applyFog(color: vec3<f32>, distance: f32, fogColor: vec3<f32>, fogDensity: f32) -> vec3<f32> {
    let fogFactor = 1.0 - exp(-distance * fogDensity);
    return mix(color, fogColor, fogFactor);
}
`,
};

/**
 * Create a default shader chunk registry with standard chunks
 */
export function createDefaultRegistry() {
    const registry = new ShaderChunkRegistry();
    registry.registerAll(STANDARD_CHUNKS);
    return registry;
}

export default {
    ShaderChunkRegistry,
    PipelineOverrides,
    ShaderVariant,
    UberShaderBuilder,
    STANDARD_CHUNKS,
    createDefaultRegistry,
};
