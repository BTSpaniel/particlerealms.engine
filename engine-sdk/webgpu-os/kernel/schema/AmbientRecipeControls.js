// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Numeric authoring controls shared by native source generation and execution.
 * These are pipeline constants, not a second frame ABI or a scripting surface.
 */
const control = (label, min, max, value, step = .01) => Object.freeze({ label, type: 'number', min, max, default: value, step });
export const AMBIENT_MATERIAL_CONTROLS = Object.freeze({
    scale: control('Form scale', .45, 2.5, 1), detail: control('Surface detail', 0, 1, .5),
    warp: control('Flow and distortion', 0, 1, .5), gloss: control('Surface sheen', 0, 1, .65),
    angle: control('Direction', -180, 180, 0, 1), focusX: control('Focal position', .15, .85, .55),
    quiet: control('Quiet left edge', 0, .8, .18), grain: control('Fine grain', 0, .12, .018, .001),
    vignette: control('Edge shading', 0, .8, .15),
});
const CONTROLS = Object.freeze({
    'aurora-curtains': { curtainSpread: control('Curtain spacing', .6, 1.4, 1), foldDepth: control('Fold depth', 0, 1, .55), veilDensity: control('Veil density', .4, 1.6, .85) },
    'flowing-ink': { viscosity: control('Pigment viscosity', .05, 1, .4), vorticity: control('Current curl', .1, 2, .8), pigmentLoad: control('Pigment deposition', .1, 1.4, .65), sourceSpread: control('Source spacing', .45, 1.3, .9) },
    'liquid-chrome': { bodies: control('Connected lobes', 4, 16, 10, 1), cohesion: control('Sculpture cohesion', .25, 1.5, .9), metalRoughness: control('Metal roughness', .07, .4, .16) },
    'deep-space-nebula': { dustDepth: control('Dust opacity', .25, 2, 1), pillarScale: control('Pillar formation', .6, 1.6, 1), starDensity: control('Stellar density', .3, 1.6, .9) },
    'midnight-downpour': { rainDensity: control('Rain density', .2, 1, .7), puddleRoughness: control('Puddle disturbance', .3, 2, 1), lampWarmth: control('Lamplight warmth', 0, 1, .6) },
    'ripple-horizon': { waveHeight: control('Ocean swell', .2, 1.8, .8), waveDamping: control('Wave damping', .25, 3, 1.25), rippleStrength: control('Impulse strength', .1, 2, .9) },
    'neural-lattice': { branchDensity: control('Branch density', .4, 1.6, .9), pulseReach: control('Signal reach', .3, 1.5, .8), rootGlow: control('Root illumination', .1, 1, .45) },
    'quantum-probability-field': { coherence: control('Coherent emission', .2, 1, .65), decoherence: control('Decoherence rate', .1, 2, 1), fringeScale: control('Interference spacing', .5, 1.5, .8) },
    'holographic-data-streams': { artifactScale: control('Archive artifact scale', .6, 1.5, 1), signalDensity: control('Signal occupancy', .2, 1, .55), scanlineStrength: control('Scanline texture', 0, 1, .18) },
    'circuit-voxel-city': { towerScale: control('Tower elevation', .6, 1.6, 1), circuitBrightness: control('Circuit illumination', .15, 1.5, .65), quiet: control('Quiet left edge', 0, .8, .4) },
    'event-horizon': { inclination: control('Observer elevation', .12, .6, .25), diskTemperature: control('Disk temperature', .7, 1.3, 1), diskTurbulence: control('Accretion texture', .2, 1.5, .8) },
    'rainlit-study': { rainDensity: control('Rain on window', .1, 1, .55), lampGlow: control('Desk lamplight', .2, 1.6, .9), depthSeparation: control('Window depth', 0, 1, .5) },
    'sky-garden': { cloudCover: control('Cloud cover', .2, 1, .7), foliageSway: control('Foliage sway', 0, 1, .35), hazeDepth: control('Valley haze', 0, 1, .5) },
    'neon-district': { rainDensity: control('Street rainfall', .1, 1, .65), reflectionSpread: control('Wet reflection width', .4, 1.8, .95), signBrightness: control('Sign illumination', .25, 1.5, .85) },
    'orbital-observatory': { ringTilt: control('Ring inclination', -.6, .3, -.25), planetScale: control('Planet size', .7, 1.25, 1), roomWarmth: control('Lounge warmth', 0, 1, .5) },
    'broadcast-prism': { fluteWidth: control('Flute spacing', .5, 1.5, 1), refraction: control('Glass refraction', 0, 1, .65), prismAngle: control('Prism inclination', -.65, .3, -.3) },
    'particle-world': { population: control('Particle population', 4000, 32000, 32000, 1000), fieldScale: control('Disc radius', .6, 1.6, 1), attraction: control('Local attraction', 0, 1, .4), discThickness: control('Disc thickness', .02, .6, .12) },
    'stellar-drift': { population: control('Star population', 4000, 32000, 14000, 1000), fieldScale: control('Star field width', .6, 1.6, 1), attraction: control('Local lens response', 0, 1, .3), travelDepth: control('Travel depth', 6, 20, 12) },
    'vortex-bloom': { population: control('Particle population', 4000, 32000, 32000, 1000), fieldScale: control('Sculpture radius', .6, 1.6, 1), attraction: control('Local attraction', 0, 1, .5), petalTwist: control('Petal winding', 1, 7, 3, 1) },
});
const MATERIAL_IDS = new Set(['pearlescent-silk', 'aurora-glass', 'liquid-metal', 'mineral-ink', 'moonlit-water', 'atmospheric-depth']);
const VARIANTS = Object.freeze({
    'experiment-flowing-ink': { viscosity: .72, vorticity: .36, pigmentLoad: .42, sourceSpread: 1.22 },
    'experiment-liquid-chrome': { bodies: 6, cohesion: 1.28, metalRoughness: .23 },
    'experiment-ripple-horizon': { waveHeight: .42, waveDamping: 2.2, rippleStrength: .55 },
    'experiment-quantum-probability-field': { coherence: .38, decoherence: 1.5, fringeScale: 1.24 },
});

export function ambientRecipeControlSpecs(id) { return MATERIAL_IDS.has(id) ? AMBIENT_MATERIAL_CONTROLS : Object.freeze(CONTROLS[String(id).replace(/^experiment-/, '')] ?? {}); }
export function ambientRecipeControlDefaults(id) { return Object.fromEntries(Object.entries(ambientRecipeControlSpecs(id)).map(([key, spec]) => [key, VARIANTS[id]?.[key] ?? spec.default])); }
export function normalizeAmbientRecipeControls(id, values = {}, { strict = false } = {}) {
    const specs = ambientRecipeControlSpecs(id), result = ambientRecipeControlDefaults(id);
    if (strict && (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length !== Object.keys(specs).length || Object.keys(values).some(key => !Object.hasOwn(specs, key)))) throw new TypeError(`Recipe controls for '${id}' must contain exactly its supported keys`);
    for (const [key, spec] of Object.entries(specs)) {
        const number = values[key];
        if (strict && (typeof number !== 'number' || !Number.isFinite(number) || number < spec.min || number > spec.max || spec.step >= 1 && !Number.isInteger(number))) throw new RangeError(`Recipe control '${key}' is outside its supported range`);
        if (typeof number === 'number' && Number.isFinite(number)) result[key] = Math.max(spec.min, Math.min(spec.max, spec.step >= 1 ? Math.round(number) : number));
    }
    return Object.freeze(result);
}
export function ambientRecipeWgslConstants(id, values) {
    return Object.entries(normalizeAmbientRecipeControls(id, values)).map(([key, value]) => `const art_${key}: f32 = ${Number(value).toFixed(6)};`).join('\n');
}
