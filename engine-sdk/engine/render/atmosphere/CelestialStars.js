// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>

//

// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha



/**

 * CelestialStars.js - Star field configuration and rendering

 * Customizable star properties for the procedural sky
 */

import {
    LEGACY_PCG32_WGSL,
    LEGACY_RENDER_RUNTIME_PCG_HASH_WGSL,
} from '../../core/math/MathBits.js';

/**
 * Star layer types - for different visual effects
 */

export const StarLayer = {

    BACKGROUND: 'background',   // Distant, dim stars

    MIDGROUND: 'midground',     // Normal stars

    FOREGROUND: 'foreground',   // Bright, prominent stars

    NEBULA: 'nebula',           // Colored nebula regions

};



/**

 * Star field configuration defaults

 */

export const StarDefaults = {

    // Density and distribution

    density: 0.0015,                // Stars per solid angle

    minBrightness: 0.3,             // Minimum star brightness

    maxBrightness: 1.0,             // Maximum star brightness



    // Twinkling

    twinkleSpeed: 2.0,              // Twinkle animation speed

    twinkleAmount: 0.3,             // How much stars twinkle (0-1)



    // Color variation

    colorVariation: 0.15,           // How much color varies between stars

    baseColor: [1.0, 1.0, 1.0],     // Base star color



    // Visibility

    fadeStartSunAngle: 0.0,         // Sun angle where stars start fading

    fadeEndSunAngle: 0.3,           // Sun angle where stars fully fade

    horizonFade: true,              // Fade stars near horizon



    // Rendering

    enabled: true,

    pointSize: 1.0,                 // Base point size

};



/**

 * Star layer presets

 */

export const StarLayerPresets = {

    // Dim background stars - most numerous

    background: {

        name: 'Background Stars',

        layer: StarLayer.BACKGROUND,

        density: 0.003,

        minBrightness: 0.1,

        maxBrightness: 0.4,

        twinkleAmount: 0.1,

        colorVariation: 0.05,

        enabled: true,

    },



    // Normal visible stars

    normal: {

        name: 'Normal Stars',

        layer: StarLayer.MIDGROUND,

        density: 0.0015,

        minBrightness: 0.4,

        maxBrightness: 0.8,

        twinkleAmount: 0.3,

        colorVariation: 0.15,

        enabled: true,

    },



    // Bright prominent stars

    bright: {

        name: 'Bright Stars',

        layer: StarLayer.FOREGROUND,

        density: 0.0003,

        minBrightness: 0.8,

        maxBrightness: 1.0,

        twinkleAmount: 0.5,

        twinkleSpeed: 1.5,

        colorVariation: 0.25,

        enabled: true,

    },



    // Colored nebula regions

    nebula: {

        name: 'Nebula Glow',

        layer: StarLayer.NEBULA,

        density: 0.0001,

        minBrightness: 0.05,

        maxBrightness: 0.15,

        twinkleAmount: 0.0,

        colorVariation: 0.5,

        baseColor: [0.4, 0.2, 0.6],  // Purple tint

        enabled: true,

    },

};



/**

 * Constellation definitions (named star patterns)

 */

export const Constellations = {

    orion: {

        name: 'The Hunter',

        stars: [

            { ra: 5.5, dec: 7.4, brightness: 0.9, color: [0.8, 0.9, 1.0] },    // Betelgeuse

            { ra: 5.2, dec: -8.2, brightness: 0.95, color: [0.9, 0.95, 1.0] }, // Rigel

            { ra: 5.4, dec: -1.2, brightness: 0.7, color: [1.0, 1.0, 1.0] },   // Belt star 1

            { ra: 5.5, dec: -1.9, brightness: 0.7, color: [1.0, 1.0, 1.0] },   // Belt star 2

            { ra: 5.6, dec: -2.6, brightness: 0.7, color: [1.0, 1.0, 1.0] },   // Belt star 3

        ],

        enabled: true,

    },



    northStar: {

        name: 'North Star',

        stars: [

            { ra: 2.5, dec: 89.3, brightness: 1.0, color: [1.0, 0.98, 0.9] },  // Polaris

        ],

        enabled: true,

    },

};



/**

 * WGSL shader code for star rendering

 */

export const StarsWGSL = `
// PCG hash - deterministic across all GPUs (from GPURandom.js)
${LEGACY_PCG32_WGSL}
${LEGACY_RENDER_RUNTIME_PCG_HASH_WGSL}

// Procedural star field
fn stars(

    direction: vec3<f32>,

    density: f32,

    brightness: f32,

    time: f32,

    twinkleSpeed: f32

) -> f32 {

    // Create a pseudo-random star field based on direction

    let p = direction * 1000.0;



    // Deterministic hash for star positions (PCG - no sin dependency)

    let fp = floor(p);

    let h = f32(pcg_star(bitcast<u32>(fp.x) + pcg_star(bitcast<u32>(fp.y) + pcg_star(bitcast<u32>(fp.z))))) / 4294967295.0;



    // Only show stars where hash is below density threshold

    if (h > density) {

        return 0.0;

    }



    // Star brightness variation

    let starBrightness = fract(h * 13.37) * brightness;



    // Twinkle effect

    let twinkle = sin(time * twinkleSpeed + h * 100.0) * 0.5 + 0.5;

    let twinkledBrightness = starBrightness * (0.7 + twinkle * 0.3);



    // Sharp star points

    let cellCenter = floor(p) + 0.5;

    let dist = length(p - cellCenter);

    let star = smoothstep(0.5, 0.0, dist) * twinkledBrightness;



    return star;

}



// Multi-layer star field with color variation

fn starsColored(

    direction: vec3<f32>,

    density: f32,

    brightness: f32,

    time: f32,

    twinkleSpeed: f32,

    colorVariation: f32,

    baseColor: vec3<f32>

) -> vec3<f32> {

    let p = direction * 1000.0;

    let fp2 = floor(p);

    let h = f32(pcg_star(bitcast<u32>(fp2.x) + pcg_star(bitcast<u32>(fp2.y) + pcg_star(bitcast<u32>(fp2.z))))) / 4294967295.0;



    if (h > density) {

        return vec3<f32>(0.0);

    }



    // Star brightness

    let starBrightness = fract(h * 13.37) * brightness;



    // Twinkle

    let twinkle = sin(time * twinkleSpeed + h * 100.0) * 0.5 + 0.5;

    let twinkledBrightness = starBrightness * (0.7 + twinkle * 0.3);



    // Color variation (blue to orange range for star temperatures)

    let colorSeed = fract(h * 7.89);

    var starColor = baseColor;

    if (colorSeed < 0.3) {

        // Blue-white (hot stars)

        starColor = mix(baseColor, vec3<f32>(0.8, 0.9, 1.0), colorVariation);

    } else if (colorSeed > 0.7) {

        // Yellow-orange (cool stars)

        starColor = mix(baseColor, vec3<f32>(1.0, 0.85, 0.7), colorVariation);

    }



    // Sharp star points

    let cellCenter = floor(p) + 0.5;

    let dist = length(p - cellCenter);

    let star = smoothstep(0.5, 0.0, dist) * twinkledBrightness;



    return starColor * star;

}



// Nebula glow regions

fn nebulaGlow(

    direction: vec3<f32>,

    time: f32,

    color1: vec3<f32>,

    color2: vec3<f32>,

    intensity: f32

) -> vec3<f32> {

    // Large-scale noise for nebula regions (deterministic PCG)

    let p = direction * 5.0;

    let s1 = pcg_star(bitcast<u32>(p.x) + pcg_star(bitcast<u32>(p.y) + pcg_star(bitcast<u32>(p.z))));

    let n1 = f32(s1) / 4294967295.0;

    let p2 = p * 2.0;

    let s2 = pcg_star(bitcast<u32>(p2.x) + pcg_star(bitcast<u32>(p2.y) + pcg_star(bitcast<u32>(p2.z) + 7u)));

    let n2 = f32(s2) / 4294967295.0;



    // Combine noises for cloud-like effect

    let nebula = n1 * n2 * 2.0;



    // Color gradient

    let nebulaColor = mix(color1, color2, n1);



    return nebulaColor * nebula * intensity;

}

`;



/**

 * StarField class for managing star rendering

 */

export class StarField {

    constructor(config = {}) {

        this.config = { ...StarDefaults, ...config };

        this.layers = new Map();

    }



    /**

     * Add a star layer

     */

    addLayer(id, config) {

        this.layers.set(id, { ...StarDefaults, ...config });

        return this;

    }



    /**

     * Remove a star layer

     */

    removeLayer(id) {

        this.layers.delete(id);

        return this;

    }



    /**

     * Load default layers

     */

    loadDefaultLayers() {

        this.addLayer('background', StarLayerPresets.background);

        this.addLayer('normal', StarLayerPresets.normal);

        this.addLayer('bright', StarLayerPresets.bright);

        return this;

    }



    /**

     * Get visibility factor based on sun position

     */

    getVisibility(sunY) {

        const fadeStart = this.config.fadeStartSunAngle;

        const fadeEnd = this.config.fadeEndSunAngle;



        if (sunY <= fadeStart) return 1.0;

        if (sunY >= fadeEnd) return 0.0;



        return 1.0 - (sunY - fadeStart) / (fadeEnd - fadeStart);

    }



    /**

     * Get uniform data for GPU

     */

    getUniformData() {

        return {

            density: this.config.density,

            brightness: this.config.maxBrightness,

            twinkleSpeed: this.config.twinkleSpeed,

            colorVariation: this.config.colorVariation,

            baseColor: this.config.baseColor,

        };

    }



    /**

     * Update configuration

     */

    setConfig(newConfig) {

        this.config = { ...this.config, ...newConfig };

    }

}



/**

 * StarSystem - Complete star management system

 */

export class StarSystem {

    constructor() {

        this.field = new StarField();

        this.constellations = new Map();

        this.enabled = true;

    }



    /**

     * Initialize with default settings

     */

    init() {

        this.field.loadDefaultLayers();

        return this;

    }



    /**

     * Add a constellation

     */

    addConstellation(id, config) {

        this.constellations.set(id, config);

        return this;

    }



    /**

     * Load preset constellations

     */

    loadConstellations(ids = ['orion', 'northStar']) {

        for (const id of ids) {

            if (Constellations[id]) {

                this.addConstellation(id, Constellations[id]);

            }

        }

        return this;

    }



    /**

     * Get all uniform data

     */

    getUniformData(sunY) {

        return {

            ...this.field.getUniformData(),

            visibility: this.field.getVisibility(sunY),

        };

    }

}



export default StarField;
