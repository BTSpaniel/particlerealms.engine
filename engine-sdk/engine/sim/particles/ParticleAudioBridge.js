// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleAudioBridge.js - Real-Time Procedural Spatial Audio for Particle Systems
 * 
 * Zero-latency audio driven by GPU particle events via onParticleEvent callbacks.
 * Every collision triggers sound immediately — no polling, no timers.
 * 
 * Architecture informed by FMOD, PopcornFX, and Web Audio API perf research:
 *   - HRTF panning — binaural left/right ear simulation with elevation + front/back cues
 *   - Spatial clustering — nearby same-material impacts merge into single louder sound
 *   - Priority classes — critical/high/normal/low tiers (FMOD-style, not just volume)
 *   - Fade-out on voice steal — 5ms gain ramp prevents audible clicks
 *   - Separate ambient bus — continuous loops bypass transient compressor (no pumping)
 *   - Listener orientation — correct panning from camera forward/up vectors
 *   - Shared AudioContext — accepts external context to avoid browser resource limits
 *   - Per-material spatial cooldown — dedupes only within a radius, not globally
 *   - Dynamic compressor on impact bus — tames peak transients without affecting ambients
 * 
 * Usage:
 *   const bridge = createAudioBridge({ maxVoices: 32, maxDistance: 100 });
 *   wireEventCallbacks(bridge, world.eventSystem, getMaterialForEvent);
 *   // Per-frame (for ambient loops + listener tracking):
 *   updateListenerFromCamera(bridge, camera);
 *   updateEmitterAmbients(bridge, emitters);
 *   // Cleanup:
 *   destroyAudioBridge(bridge);
 */

import { getImpactPatch, getAmbientPatch, getPatchOverride, IMPACT_PATCHES } from '../../audio/synth/ProceduralPatches.js';
import { applySubstanceParamMap as applyMappedParams } from '../../audio/bridge/SubstanceAudioResolver.js';
import { uniformDistribution } from '../../core/math/MathRandom.js';
import { dbToGain, gainToDb } from '../../core/math/UnitMath.js';

// ============================================================================
// MATERIAL → PATCH KEY LOOKUP
// ============================================================================

const MATERIAL_PATCH_KEY = [
    'stone',    // 0  NONE (default)
    'water',    // 1  WATER
    'ice',      // 2  ICE
    'metal',    // 3  METAL
    'wood',     // 4  WOOD
    'wax',      // 5  WAX
    'lava',     // 6  LAVA
    'oil',      // 7  OIL
    'glass',    // 8  GLASS
    'stone',    // 9  STONE
    'plasma',   // 10 PLASMA
    'fire',     // 11 FIRE
    'smoke',    // 12 SMOKE
    'steam',    // 13 STEAM
    'sparks',   // 14 SPARKS
    'debris',   // 15 DEBRIS
    'mercury',  // 16 MERCURY
    'acid',     // 17 ACID
    'blood',    // 18 BLOOD
    'honey',    // 19 HONEY
    'sand',     // 20 SAND
    'snow',     // 21 SNOW
];

function resolvePatchKey(substanceOrIndex) {
    if (typeof substanceOrIndex === 'number') return MATERIAL_PATCH_KEY[substanceOrIndex] || 'stone';
    if (typeof substanceOrIndex === 'string') {
        // Direct match in patch registry is handled downstream by getImpactPatch.
        // But if the string is an unknown chemical formula, infer a fallback category
        // so we never silently drop sounds for new substances.
        if (_KNOWN_PATCH_KEYS.has(substanceOrIndex)) return substanceOrIndex;
        // Chemical formula heuristics: H2O-like → fluid, Fe/Cu/etc → metal
        const s = substanceOrIndex;
        if (s.includes('H2O') || s.includes('H2S') || s === 'HCl' || s === 'HF') return 'water';
        if (/^(Fe|Cu|Al|Au|Ag|Ti|Zn|Sn|Pb|Ni|Cr|Co|W|Mo|Mn|V)/.test(s)) return 'metal';
        if (s.includes('SiO')) return 'glass';
        if (s.includes('ite') || s.includes('ite2')) return 'stone';
        // Fallback: return as-is (getImpactPatch will check its own registry)
        return substanceOrIndex;
    }
    return 'stone';
}

/**
 * Apply a substance audio.paramMap onto runtime emitter params.
 * Maps source fields (emitRate/avgVelocity/temperature/density) to target leaf keys
 * used by procedural patch update() handlers.
 */
function mapSubstanceParams(substanceKey, params = {}) {
    if (!substanceKey || typeof substanceKey !== 'string') return params;
    const mapOverrides = getPatchOverride(substanceKey) || null;
    return applyMappedParams(substanceKey, params, mapOverrides);
}

// Pre-built set of known patch keys for fast O(1) lookup in resolvePatchKey
const _KNOWN_PATCH_KEYS = new Set(Object.keys(IMPACT_PATCHES));

// Per-material cooldown tuning (seconds) — fast materials get shorter cooldown
const MATERIAL_COOLDOWN = {
    water: 0.009, oil: 0.012, mercury: 0.012, acid: 0.012, blood: 0.013, honey: 0.02,
    fire: 0.016, lava: 0.026, combustion: 0.018,
    metal: 0.015, glass: 0.019, stone: 0.02, wood: 0.019, ice: 0.02,
    plasma: 0.009, sparks: 0.009, electric: 0.009,
    sand: 0.008, snow: 0.008, smoke: 0.028, steam: 0.02, debris: 0.012,
    wax: 0.02,
    // Canonical patch names (in case passed directly)
    fluid: 0.009, drop: 0.014, hiss: 0.018, crackle: 0.009,
    modal_impact_metal: 0.015,
    modal_impact_glass: 0.019,
    modal_impact_stone: 0.02,
    modal_impact_wood: 0.019,
    modal_impact_ice: 0.02,
};

function getCooldownForMaterial(patchKey) {
    return MATERIAL_COOLDOWN[patchKey] ?? 0.015;
}

// Per-material volume calibration (multiplier) — balances the mix so loud materials
// (metal, glass) don't drown quiet ones (sand, snow). Based on real-world acoustic properties.
const MATERIAL_VOLUME_CAL = {
    water: 1.14, oil: 0.98, mercury: 1.04, acid: 0.92, blood: 0.94, honey: 0.82,
    fire: 1.02, lava: 0.98, combustion: 1.05,
    metal: 0.98, glass: 0.92, stone: 0.88, wood: 0.83, ice: 0.8,
    plasma: 0.86, sparks: 0.69, electric: 0.84,
    sand: 0.58, snow: 0.52, smoke: 0.37, steam: 0.51, debris: 0.79,
    wax: 0.56,
    // Canonical patch names
    fluid: 1.14, drop: 0.88, hiss: 0.46, crackle: 0.67,
    modal_impact_metal: 0.98,
    modal_impact_glass: 0.92,
    modal_impact_stone: 0.88,
    modal_impact_wood: 0.83,
    modal_impact_ice: 0.8,
};

function getMaterialVolumeCal(patchKey) {
    return MATERIAL_VOLUME_CAL[patchKey] ?? 0.7;
}

// Per-material voice duration (must outlast longest envelope in each patch)
const PATCH_DURATIONS = {
    metal: 0.5, glass: 0.42, ice: 0.38, wood: 0.28, stone: 0.27,
    modal_impact_metal: 0.5,
    modal_impact_glass: 0.42,
    modal_impact_ice: 0.38,
    modal_impact_wood: 0.28,
    modal_impact_stone: 0.27,
    combustion: 0.32, lava: 0.32, fire: 0.32,
    drop: 0.24, oil: 0.24, mercury: 0.24, blood: 0.24, honey: 0.24, wax: 0.24,
    fluid: 0.19, water: 0.19,
    hiss: 0.24, smoke: 0.24, steam: 0.24, acid: 0.24,
    crackle: 0.23, sparks: 0.23, debris: 0.23,
    electric: 0.26, plasma: 0.26,
    sand: 0.24, snow: 0.22,
};

function getPatchDuration(patchKey) {
    return PATCH_DURATIONS[patchKey] ?? 0.24;
}

// ============================================================================
// PRIORITY CLASSES (FMOD-style coarse tiers)
// ============================================================================

export const PRIORITY_CRITICAL = 100;  // UI, player-caused explosions — never stolen
export const PRIORITY_HIGH     = 10;   // Close impacts, important events
export const PRIORITY_NORMAL   = 1;    // Standard particle impacts (default)
export const PRIORITY_LOW      = 0.1;  // Distant/quiet sounds
export const PRIORITY_AMBIENT  = 0.01; // Background loops

// ============================================================================
// SPATIAL CLUSTERING
// ============================================================================

const CLUSTER_RADIUS_SQ = 4.0;    // 2m radius — impacts within this merge
const CLUSTER_TIME_WINDOW = 0.01; // 10ms — impacts within this time window cluster

// ============================================================================
// AIR ABSORPTION (distance-based low-pass filter)
// Research: Air absorbs high frequencies proportional to distance. This is the
// #1 spatial cue the brain uses for distance estimation (after volume).
// Formula: cutoff = baseFreq * (1 - dist/maxDist)^exponent, clamped to [200, 22050]
// ============================================================================

const LPF_BASE_FREQ = 22050;   // Full bandwidth at distance 0
const LPF_MIN_FREQ = 800;      // Minimum cutoff at max distance (keeps some body)
const LPF_EXPONENT = 1.5;      // Rolloff curve — 1.5 feels natural (faster than linear)

function distanceLPFCutoff(dist, maxDist) {
    if (dist <= 1) return LPF_BASE_FREQ;
    const t = Math.min(dist / maxDist, 1.0);
    return LPF_MIN_FREQ + (LPF_BASE_FREQ - LPF_MIN_FREQ) * Math.pow(1 - t, LPF_EXPONENT);
}

// ============================================================================
// DOPPLER EFFECT
// Research: Wwise/FMOD calculate radial velocity (component toward/away from
// listener) and apply pitch shift: f' = f * c / (c + v_radial)
// For particles, we use velocity dot (normalized listener direction) as v_radial.
// ============================================================================

const SPEED_OF_SOUND = 343.0;  // m/s at 20°C
const DOPPLER_SCALE = 0.4;     // Artistic scaling (1.0 = physically accurate, 0.4 = subtle)
const DOPPLER_DEADZONE = 0.75; // m/s — ignore tiny chaotic radial jitter from particle turbulence
const DOPPLER_MIN = 0.7;       // Clamp to prevent extreme shifts
const DOPPLER_MAX = 1.4;

function dopplerShift(bridge, px, py, pz, vx, vy, vz) {
    const dx = px - bridge.listenerPos[0];
    const dy = py - bridge.listenerPos[1];
    const dz = pz - bridge.listenerPos[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < 0.01) return 1.0;
    // Radial velocity: positive = moving away, negative = approaching
    const radialVel = (vx * dx + vy * dy + vz * dz) / dist;
    if (Math.abs(radialVel) < DOPPLER_DEADZONE) return 1.0;
    const scaledVel = radialVel * DOPPLER_SCALE;
    const ratio = SPEED_OF_SOUND / (SPEED_OF_SOUND + scaledVel);
    return Math.max(DOPPLER_MIN, Math.min(DOPPLER_MAX, ratio));
}

// ============================================================================
// NODE POOL (reduces GC pressure from AudioNode creation)
// Research: Web Audio nodes are GC'd objects. Creating 32+ per second causes
// GC spikes. Pool and reuse disconnected nodes.
// ============================================================================

const POOL_MAX = 48; // Keep up to 48 of each node type pooled

const POOL_WARMUP = 8; // Pre-create this many nodes to avoid first-sound GC spike

function _initNodePool(bridge) {
    bridge._nodePool = {
        panners: [],
        gains: [],
        filters: [],
    };
    // Warm up pool: pre-create nodes so first sounds don't trigger GC
    // Research (padenot): node creation is the main source of GC pressure
    const ctx = bridge.ctx;
    for (let i = 0; i < POOL_WARMUP; i++) {
        const p = ctx.createPanner();
        p.panningModel = 'HRTF';
        p.distanceModel = 'inverse';
        p.refDistance = 1;
        p.maxDistance = 10000;
        p.rolloffFactor = 0;
        bridge._nodePool.panners.push(p);

        const g = ctx.createGain();
        g.gain.value = 1.0;
        bridge._nodePool.gains.push(g);

        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.Q.value = 0.7;
        bridge._nodePool.filters.push(f);
    }
}

function acquirePanner(bridge, px, py, pz) {
    const pool = bridge._nodePool?.panners;
    let p;
    if (pool && pool.length > 0) {
        p = pool.pop();
    } else {
        p = bridge.ctx.createPanner();
        p.panningModel = 'HRTF';
        p.distanceModel = 'inverse';
        p.refDistance = 1;
        p.maxDistance = 10000;
        p.rolloffFactor = 0;
    }
    // Modern AudioParam API (setPosition is deprecated per MDN)
    if (p.positionX) {
        p.positionX.value = px; p.positionY.value = py; p.positionZ.value = pz;
    } else {
        p.setPosition(px, py, pz);
    }
    return p;
}

function releasePanner(bridge, panner) {
    try { panner.disconnect(); } catch {}
    const pool = bridge._nodePool?.panners;
    if (pool && pool.length < POOL_MAX) pool.push(panner);
}

function acquireGain(bridge) {
    const pool = bridge._nodePool?.gains;
    if (pool && pool.length > 0) {
        const g = pool.pop();
        // Cancel lingering scheduled events to prevent AudioParam list growth
        // Research: Each setValueAtTime/linearRamp adds to an internal event list
        // that never shrinks unless explicitly cancelled.
        try { g.gain.cancelScheduledValues(0); } catch {}
        g.gain.value = 1.0;
        return g;
    }
    const g = bridge.ctx.createGain();
    g.gain.value = 1.0;
    return g;
}

function releaseGain(bridge, gain) {
    try { gain.disconnect(); } catch {}
    const pool = bridge._nodePool?.gains;
    if (pool && pool.length < POOL_MAX) pool.push(gain);
}

function acquireFilter(bridge, cutoff) {
    const pool = bridge._nodePool?.filters;
    let f;
    if (pool && pool.length > 0) {
        f = pool.pop();
        try { f.frequency.cancelScheduledValues(0); } catch {}
    } else {
        f = bridge.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.Q.value = 0.7; // Butterworth — flat passband, no resonance
    }
    f.frequency.value = cutoff;
    return f;
}

function releaseFilter(bridge, filter) {
    try { filter.disconnect(); } catch {}
    const pool = bridge._nodePool?.filters;
    if (pool && pool.length < POOL_MAX) pool.push(filter);
}

// ============================================================================
// STALE MAP CLEANUP (prevents memory leak in _lastTrigger / _clusters)
// ============================================================================

const MAP_CLEANUP_INTERVAL = 5.0; // seconds between cleanups

// ============================================================================
// PER-MATERIAL VOICE LIMIT
// Research: FMOD limits instances per event type. Without this, one material
// (e.g. 50 water particles) could monopolize all 32 voices.
// ============================================================================

const MAX_VOICES_PER_MATERIAL = 4; // Max voices of same material type (reduced for perf)

function countMaterialVoices(bridge, patchKey) {
    let count = 0;
    for (let i = 0; i < bridge._voices.length; i++) {
        if (bridge._voices[i]?.patchKey === patchKey) count++;
    }
    return count;
}

// ============================================================================
// SPEED-RESPONSIVE BRIGHTNESS
// Research: Faster impacts have more high-frequency energy. We boost the
// distance LPF cutoff based on speed to let more brightness through.
// ============================================================================

const SPEED_BRIGHTNESS_MIN = 1.0;  // No boost at speed 0
const SPEED_BRIGHTNESS_MAX = 1.8;  // 80% higher cutoff at max speed
const SPEED_BRIGHTNESS_SCALE = 10; // Speed at which max brightness is reached

function speedBrightnessFactor(speed) {
    const t = Math.min(speed / SPEED_BRIGHTNESS_SCALE, 1.0);
    return SPEED_BRIGHTNESS_MIN + (SPEED_BRIGHTNESS_MAX - SPEED_BRIGHTNESS_MIN) * t;
}

// ============================================================================
// AMBIENT AUTO-DUCKING
// Research: Professional game mixes duck ambient/music when many transient
// impacts play. We reduce ambientGain when voice count is high.
// ============================================================================

const DUCK_VOICE_THRESHOLD = 8;   // Start ducking when this many voices active
const DUCK_MIN_GAIN = 0.3;        // Minimum ambient gain during heavy impacts
const DUCK_ATTACK = 0.02;         // Seconds to duck down
const DUCK_RELEASE = 0.15;        // Seconds to duck back up

function updateAmbientDucking(bridge) {
    if (!bridge.ambientGain) return;
    const count = bridge._voiceCount;
    const now = bridge.ctx.currentTime;
    if (count >= DUCK_VOICE_THRESHOLD) {
        const duckAmount = Math.min((count - DUCK_VOICE_THRESHOLD) / (bridge.maxVoices - DUCK_VOICE_THRESHOLD), 1.0);
        const targetGain = 1.0 - duckAmount * (1.0 - DUCK_MIN_GAIN);
        bridge.ambientGain.gain.setTargetAtTime(targetGain, now, DUCK_ATTACK);
    } else {
        bridge.ambientGain.gain.setTargetAtTime(1.0, now, DUCK_RELEASE);
    }

    // Auto-headroom: scale master gain by 1/sqrt(activeVoices) to prevent clipping
    // Research: uncorrelated signals sum as sqrt(N), so 1/sqrt(N) maintains headroom
    if (bridge.masterGain && count > 1) {
        const headroom = bridge.masterVolume / Math.sqrt(count);
        bridge.masterGain.gain.setTargetAtTime(headroom, now, 0.02);
    } else if (bridge.masterGain) {
        bridge.masterGain.gain.setTargetAtTime(bridge.masterVolume, now, 0.02);
    }
}

// ============================================================================
// PROCEDURAL REVERB (shared ConvolverNode with generated impulse response)
// Research: ConvolverNode is expensive (FFT-based) but we only need ONE shared
// instance as a send bus. Exponentially decaying white noise + lowpass makes a
// surprisingly good reverb (Moorer 1979, reverbGen library).
// ============================================================================

const REVERB_DURATION = 0.8;   // seconds — short tail for particle impacts
const REVERB_DECAY = 3.0;      // decay rate — higher = faster decay
const REVERB_LPF_FREQ = 4000;  // lowpass on IR — removes harsh high-freq ringing
const REVERB_WET_NEAR = 0.05;  // reverb send level at distance 0 (dry)
const REVERB_WET_FAR = 0.35;   // reverb send level at max distance (wet)
const REVERB_PREDELAY = 0.006; // seconds — small gap before diffuse tail starts
const EARLY_REF_TAPS = [0.011, 0.023]; // seconds — 2 early reflection tap delays
const EARLY_REF_GAIN = 0.12;   // gain per early reflection tap

/**
 * Generate a procedural impulse response AudioBuffer.
 * Method: exponentially decaying white noise with gradual lowpass.
 */
function generateReverbIR(ctx) {
    const sampleRate = ctx.sampleRate;
    const length = Math.floor(sampleRate * REVERB_DURATION);
    const buffer = ctx.createBuffer(2, length, sampleRate);

    for (let ch = 0; ch < 2; ch++) {
        const data = buffer.getChannelData(ch);
        for (let i = 0; i < length; i++) {
            const t = i / sampleRate;
            // Exponential decay envelope
            const envelope = Math.exp(-REVERB_DECAY * t);
            // Gradual lowpass: reduce high-freq content over time
            // Simple 1-pole IIR approximation
            const lpfAmount = 1.0 - (t / REVERB_DURATION) * 0.7;
            const noise = uniformDistribution(-1, 1, Math.random) * lpfAmount;
            data[i] = noise * envelope;
        }
        // Apply simple 1-pole smoothing to reduce harshness
        const alpha = Math.exp(-2 * Math.PI * REVERB_LPF_FREQ / sampleRate);
        for (let i = 1; i < length; i++) {
            data[i] = data[i] * (1 - alpha) + data[i - 1] * alpha;
        }
    }
    return buffer;
}

/** Compute reverb send level based on distance (further = more reverb) */
function reverbWetLevel(dist, maxDist) {
    const t = Math.min(dist / maxDist, 1.0);
    return REVERB_WET_NEAR + (REVERB_WET_FAR - REVERB_WET_NEAR) * t;
}

// ============================================================================
// SOFT-CLIP LIMITER (WaveShaperNode on master bus)
// Research: When many impacts stack, the summed signal can exceed 0dBFS causing
// harsh digital clipping. A tanh() waveshaper provides warm soft-clipping that
// gracefully limits peaks. Much cheaper than a brick-wall limiter.
// ============================================================================

function createSoftClipCurve(samples = 8192) {
    const curve = new Float32Array(samples);
    const half = samples / 2;
    for (let i = 0; i < samples; i++) {
        const x = (i - half) / half; // -1 to +1
        curve[i] = Math.tanh(x * 1.5); // 1.5 = drive amount (subtle warmth)
    }
    return curve;
}

// ============================================================================
// SEMITONE-QUANTIZED PITCH VARIATION (musical anti-repetition)
// Research: Pure random pitch sounds unnatural. Quantizing to semitone steps
// (2^(n/12)) creates musical variation. ±2 semitones = subtle but effective.
// ============================================================================

const SEMITONE_OFFSETS = [-2, -1, 0, 0, 0, 1, 2]; // weighted toward center
const _lastSemitone = new Map(); // per-material anti-repetition tracking

function musicalPitchVariation(patchKey) {
    let semitones = SEMITONE_OFFSETS[Math.floor(uniformDistribution(0, SEMITONE_OFFSETS.length, Math.random))];
    // Anti-repetition: re-roll once if same offset as last play of this material
    const last = _lastSemitone.get(patchKey);
    if (last === semitones && SEMITONE_OFFSETS.length > 1) {
        semitones = SEMITONE_OFFSETS[Math.floor(uniformDistribution(0, SEMITONE_OFFSETS.length, Math.random))];
    }
    if (patchKey) _lastSemitone.set(patchKey, semitones);
    return Math.pow(2, semitones / 12);
}

// ============================================================================
// AUDIO LOD (Level of Detail)
// Research: Professional engines simplify audio for distant sources.
// Far sounds skip expensive processing (reverb send, extra nodes).
// ============================================================================

const LOD_NEAR_DIST = 0.3;  // 0-30% of maxDist = full quality
const LOD_FAR_DIST = 0.7;   // 70-100% = simplified (no reverb send)

// ============================================================================
// PRE-BAKE CACHE (OfflineAudioContext renders patches to AudioBuffers)
// Research: padenot perf notes recommend "baking" — render procedural patches
// offline once, then replay via BufferSourceNode (much cheaper than re-synthesizing).
// We cache the first N unique (patchKey, pitchBucket) combinations.
// ============================================================================

const BAKE_CACHE_MAX = 32;        // Max cached buffers
const BAKE_PITCH_BUCKETS = 3;     // Low/mid/high pitch buckets
const BAKE_DURATION = 0.6;        // Seconds to render

function bakePitchBucket(pitch) {
    if (pitch < 0.9) return 0;      // low
    if (pitch > 1.1) return 2;      // high
    return 1;                       // mid
}

async function preBakePatch(bridge, patchKey, patchFn, pitch) {
    const bucket = bakePitchBucket(pitch);
    const cacheKey = `${patchKey}_${bucket}`;
    if (bridge._bakeCache.has(cacheKey)) return;

    // LRU eviction: when cache is full, delete oldest entry
    // Research (iOS Safari): nulling buffer references prevents AudioBuffer memory leaks
    if (bridge._bakeCache.size >= BAKE_CACHE_MAX) {
        const oldest = bridge._bakeCache.keys().next().value;
        bridge._bakeCache.delete(oldest);
    }

    // Mark as pending to avoid duplicate bakes
    bridge._bakeCache.set(cacheKey, null);

    try {
        const sampleRate = bridge.ctx.sampleRate;
        const length = Math.floor(sampleRate * BAKE_DURATION);
        const offline = new OfflineAudioContext(1, length, sampleRate);
        const dest = offline.createGain();
        dest.connect(offline.destination);
        patchFn(offline, dest, { volume: 0.5, pitch, speed: 3, temperature: 500 });
        const rendered = await offline.startRendering();
        bridge._bakeCache.set(cacheKey, rendered);
    } catch {
        bridge._bakeCache.delete(cacheKey);
    }
}

function playBakedBuffer(bridge, cacheKey, fadeGain) {
    const buffer = bridge._bakeCache.get(cacheKey);
    if (!buffer) return false;
    const src = bridge.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(fadeGain);
    src.start();
    return true;
}

// ============================================================================
// REACTION SOUND MAPPING
// Research: Our particle system has cross-emitter reactions (EVENT_REACTION=5).
// Reactions are visually dramatic — they deserve distinct, louder sounds.
// ============================================================================

const REACTION_SOUND_MAP = {
    // Actual reaction products (from ParticleReactionTable.js initDefaultReactions)
    'steam':    'steam',     // Fire+Water, Plasma+Water → Steam
    'water':    'water',     // Fire+Ice, Plasma+Ice → Water
    'debris':   'debris',    // Lava+Water → Obsidian debris
    'sparks':   'sparks',    // Fire+Smoke, Plasma+Fire → Sparks
    // Fallback aliases for string-based product names
    'obsidian': 'stone',
    'frost':    'ice',
    'ash':      'sand',
    'slag':     'stone',
    'vapor':    'steam',
    'melt':     'lava',
    // Thermal alias coverage
    'ember':    'combustion',
    'cinder':   'combustion',
    'flame':    'combustion',
    'ignite':   'combustion',
    'char':     'combustion',
};

function reactionTemperatureForPatch(patchKey, rawTemp) {
    // Reaction events can encode rule index in temperature; convert to meaningful
    // synthesis temperature when value is implausibly low for thermal materials.
    if (Number.isFinite(rawTemp) && rawTemp >= 120) return rawTemp;
    switch (patchKey) {
        case 'fire':
        case 'combustion':
            return 1050;
        case 'lava':
            return 1350;
        case 'sparks':
        case 'electric':
        case 'plasma':
            return 900;
        case 'steam':
            return 650;
        case 'water':
            return 330;
        case 'ice':
            return 230;
        default:
            return 520;
    }
}

// ============================================================================
// PERCEPTUAL LOUDNESS CURVE
// Research (Boris Smus, Web Audio API book): Human hearing is logarithmic.
// A linear gain of 0.5 is perceived as much quieter than "half volume".
// Applying x^0.6 approximates perceived-linear loudness (Fletcher-Munson).
// ============================================================================

const LOUDNESS_EXPONENT = 0.6;

function perceptualVolume(linearVol) {
    return Math.pow(Math.min(linearVol, 1.5), LOUDNESS_EXPONENT);
}

// ============================================================================
// TAIL TIME PROTECTION
// Research: Voice expireTime must account for reverb tail, not just patch
// duration. Otherwise recycled voices cut off audible reverb tails.
// ============================================================================

const REVERB_TAIL_EXTRA = 0.25; // extra seconds to let reverb tail ring out

// ============================================================================
// VELOCITY LAYERS (Force Unleashed technique)
// Research: Professional physics audio uses velocity thresholds to select
// different sound "sizes". Soft impacts get quieter + lower pitched,
// hard impacts get louder + brighter. We modulate patch params by layer.
// ============================================================================

const VELOCITY_SOFT = 1.5;   // Below this = soft layer
const VELOCITY_HARD = 8.0;   // Above this = hard layer

function velocityLayer(speed) {
    if (speed < VELOCITY_SOFT) return { volScale: 0.4, pitchScale: 0.85, label: 'soft' };
    if (speed > VELOCITY_HARD) return { volScale: 1.3, pitchScale: 1.1, label: 'hard' };
    return { volScale: 1.0, pitchScale: 1.0, label: 'medium' };
}

// ============================================================================
// HDR AUDIBILITY CULLING (Wwise HDR technique)
// Research: Wwise HDR drops sounds quieter than X dB below the loudest active
// voice. This prevents inaudible sounds from consuming voice slots when a loud
// explosion is playing alongside tiny pebble impacts.
// ============================================================================

const HDR_WINDOW_DB = 30; // dB below loudest voice = inaudible, cull it
const HDR_WINDOW_LINEAR = dbToGain(-HDR_WINDOW_DB); // ~0.032

// ============================================================================
// SUB-BASS MANAGEMENT ON REVERB BUS
// Research: Professional mixing always HPF the reverb return to prevent low-freq
// mud buildup. When many impacts feed into the convolver, sub-bass accumulates
// and muddies the mix. A 120Hz HPF on the reverb send keeps things clean.
// ============================================================================

const REVERB_HPF_FREQ = 120; // Hz — cut sub-bass from reverb send

// ============================================================================
// STEREO MICRO-PAN (clustered impact spread)
// Research: When clustered impacts merge, they stack in the exact same pan
// position. A tiny random StereoPannerNode offset (-0.15 to +0.15) spreads
// them across the stereo field for a more natural, wider sound.
// ============================================================================

const STEREO_SPREAD_RANGE = 0.15; // Max pan offset for clustered sounds

// ============================================================================
// PROXIMITY BASS BOOST
// Research: Close sound sources exhibit bass enhancement (proximity effect).
// We add a subtle low-shelf boost for very close impacts (<20% maxDist)
// to add warmth and physicality to nearby collisions.
// ============================================================================

const PROXIMITY_THRESHOLD = 0.2;  // Within 20% of maxDist
const PROXIMITY_BASS_BOOST = 4;   // dB boost on low shelf
const PROXIMITY_BASS_FREQ = 200;  // Hz — low shelf center frequency

function hdrCullCheck(bridge, candidateVolume) {
    // Find loudest active voice volume
    let loudest = 0;
    for (let i = 0; i < bridge._voices.length; i++) {
        const v = bridge._voices[i];
        if (v && v.priority > loudest) loudest = v.priority;
    }
    // If no voices, always allow
    if (loudest <= 0) return false;
    // Cull if candidate is below HDR window
    return candidateVolume < loudest * HDR_WINDOW_LINEAR;
}

function cleanupStaleMaps(bridge) {
    const now = bridge.ctx.currentTime;
    if (now - (bridge._lastMapCleanup || 0) < MAP_CLEANUP_INTERVAL) return;
    bridge._lastMapCleanup = now;

    // Prune cooldown entries older than 2 seconds
    for (const [key, time] of bridge._lastTrigger) {
        if (now - time > 2.0) bridge._lastTrigger.delete(key);
    }
    // Prune cluster entries older than 1 second
    for (const [key, cluster] of bridge._clusters) {
        if (now - cluster.time > 1.0) bridge._clusters.delete(key);
    }
}

// ============================================================================
// CREATE / DESTROY
// ============================================================================

/**
 * Create an audio bridge with full voice management.
 * @param {Object} config
 * @param {number}       config.maxVoices    - Max concurrent one-shot voices (default 32)
 * @param {number}       config.maxDistance   - Max audible distance (default 100)
 * @param {number}       config.masterVolume  - Master volume (default 0.5)
 * @param {AudioContext} config.audioContext  - External AudioContext to share (optional)
 */
export function createAudioBridge(config = {}) {
    let ctx = config.audioContext || null;
    let ownsContext = false;

    if (!ctx) {
        const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AC) {
            console.warn('[ParticleAudioBridge] No AudioContext available');
            return null;
        }
        // latencyHint 'interactive' = smallest safe buffer for real-time game audio
        ctx = new AC({ latencyHint: 'interactive' });
        ownsContext = true;
    }

    // Impact bus: voices → compressor → masterGain → destination
    // Compressor tuned for transient impacts only
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -10;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.08;

    const masterGain = ctx.createGain();
    masterGain.gain.value = config.masterVolume ?? 0.5;

    // Post-compressor makeup gain compensation (-3dB)
    // Research: Web Audio DynamicsCompressorNode has undocumented built-in makeup gain
    // that boosts quiet sounds unexpectedly. This counteracts it.
    const compMakeup = ctx.createGain();
    compMakeup.gain.value = 0.707; // -3dB = 10^(-3/20) ≈ 0.707

    // Dedicated impact bus gain for independent volume control
    const impactGain = ctx.createGain();
    impactGain.gain.value = 1.0;

    compressor.connect(compMakeup);
    compMakeup.connect(impactGain);
    impactGain.connect(masterGain);

    // Soft-clip limiter: WaveShaperNode with tanh curve on master output
    // Prevents harsh digital clipping when many impacts stack above 0dBFS
    let softClipper = null;
    try {
        softClipper = ctx.createWaveShaper();
        softClipper.curve = createSoftClipCurve();
        softClipper.oversample = '2x'; // reduce aliasing from nonlinear distortion
        masterGain.connect(softClipper);
        softClipper.connect(ctx.destination);
    } catch (e) {
        // Fallback: direct connection
        masterGain.connect(ctx.destination);
    }

    // Ambient bus: loops → ambientGain → masterGain (bypasses compressor to avoid pumping)
    const ambientGain = ctx.createGain();
    ambientGain.gain.value = 1.0;
    ambientGain.connect(masterGain);

    // Optional AnalyserNode for real-time peak/RMS metering (debug/profiling only)
    let analyser = null;
    if (config.enableAnalyser) {
        analyser = ctx.createAnalyser();
        analyser.fftSize = 256; // small = low overhead
        analyser.smoothingTimeConstant = 0.3;
        masterGain.connect(analyser);
    }

    // Reverb send bus: reverbSend → preDelay → convolver → reverbGain → masterGain
    //                    reverbSend → earlyRef taps → masterGain (bypasses convolver)
    // Research (gskinner): early reflections via multi-tap delay give sense of room size.
    // Pre-delay separates direct sound from reverb onset.
    let convolver = null;
    let reverbSend = null;
    let reverbGain = null;
    let earlyRefTaps = null;
    let preDelayNode = null;
    try {
        convolver = ctx.createConvolver();
        convolver.buffer = generateReverbIR(ctx);
        reverbSend = ctx.createGain();
        reverbSend.gain.value = 0.15;
        reverbGain = ctx.createGain();
        reverbGain.gain.value = 1.0;

        // Sub-bass HPF → pre-delay → convolver → reverbGain → masterGain
        // HPF prevents low-freq mud buildup in the convolver
        const reverbHPF = ctx.createBiquadFilter();
        reverbHPF.type = 'highpass';
        reverbHPF.frequency.value = REVERB_HPF_FREQ;
        reverbHPF.Q.value = 0.7;

        preDelayNode = ctx.createDelay(0.1);
        preDelayNode.delayTime.value = REVERB_PREDELAY;

        reverbSend.connect(reverbHPF);
        reverbHPF.connect(preDelayNode);
        preDelayNode.connect(convolver);
        convolver.connect(reverbGain);
        reverbGain.connect(masterGain);

        // Early reflections: 2 delay taps → masterGain (bypass convolver)
        earlyRefTaps = EARLY_REF_TAPS.map(tapTime => {
            const tap = ctx.createDelay(0.1);
            tap.delayTime.value = tapTime;
            const tapGain = ctx.createGain();
            tapGain.gain.value = EARLY_REF_GAIN;
            reverbHPF.connect(tap);
            tap.connect(tapGain);
            tapGain.connect(masterGain);
            return { tap, tapGain };
        });
    } catch (e) {
        convolver = null;
        reverbSend = null;
        reverbGain = null;
        earlyRefTaps = null;
    }

    const maxVoices = config.maxVoices ?? 32;

    const bridge = {
        ctx,
        ownsContext,
        compressor,
        masterGain,
        ambientGain,
        softClipper,
        impactGain,
        analyser,
        convolver,
        reverbSend,
        reverbGain,
        earlyRefTaps,
        maxVoices,
        maxDistance:   config.maxDistance ?? 100,
        masterVolume: config.masterVolume ?? 0.5,
        distanceCurve: config.distanceCurve ?? 1.0, // 1.0 = linear, 2.0 = quadratic, 0.5 = sqrt

        listenerPos: [0, 0, 0],
        listenerFwd: [0, 0, -1],
        listenerUp:  [0, 1, 0],

        // Voice pool: array of { panner, fadeGain, lpf, priority, priorityClass, expireTime, patchKey }
        _voices: new Array(maxVoices).fill(null),
        _voiceCount: 0,

        // Spatial cooldown: "patchKey|cellX|cellY|cellZ" → last ctx.currentTime
        _lastTrigger: new Map(),

        // Spatial clustering: "patchKey|cellX|cellY|cellZ" → { count, totalSpeed, totalTemp, bestPos, time }
        _clusters: new Map(),

        // Ambient loops: emitterId → { handle, panner, patchKey }
        _ambientLoops: new Map(),

        // Material resolver callback (set by wireEventCallbacks)
        _getMaterial: null,

        // Event callback refs for cleanup
        _eventCallbackRefs: null,

        // AudioContext statechange handler ref for cleanup
        _ctxStateHandler: null,

        // Pre-delay node reference (for runtime reverb parameter changes)
        _preDelay: null,

        // Stale map cleanup timer
        _lastMapCleanup: 0,

        // Node pool (initialized below)
        _nodePool: null,

        // Dying voices: stolen voices fading out, awaiting node release
        _dyingVoices: [],

        // Pre-bake cache: "patchKey_bucket" → AudioBuffer (OfflineAudioContext rendered)
        _bakeCache: new Map(),

        // Stats (includes peak tracking for profiling)
        _stats: { impacts: 0, stolen: 0, dropped: 0, clustered: 0, ambientActive: 0, voicesActive: 0, poolHits: 0, peakVoices: 0, bakeHits: 0 },

        // Batched impact accumulator: spatialKey → { patchKey, substanceKey, count, totalSpeed, maxSpeed, sumPos, totalTemp }
        // Filled during collision callbacks, flushed once per frame by flushImpactBatches()
        _pendingImpacts: new Map(),
    };

    _initNodePool(bridge);

    // Store preDelay reference for runtime reverb parameter changes
    bridge._preDelay = preDelayNode;

    // Listen for AudioContext state changes (tab backgrounding, phone calls)
    // Research (MDN): statechange event fires when context is suspended/interrupted.
    // We auto-resume and pause/resume ambient loops accordingly.
    const onCtxStateChange = () => {
        if (ctx.state === 'running') {
            // Resume ambient loops that were paused
            for (const [, loop] of bridge._ambientLoops) {
                try { if (loop.handle?.context?.state === 'running') loop.handle.start?.(); } catch {}
            }
        }
    };
    ctx.addEventListener('statechange', onCtxStateChange);
    bridge._ctxStateHandler = onCtxStateChange;

    return bridge;
}

/**
 * Destroy the bridge and release all audio resources.
 */
export function destroyAudioBridge(bridge) {
    if (!bridge) return;

    // Stop all ambient loops
    for (const [, loop] of bridge._ambientLoops) {
        try { loop.handle.stop(); } catch {}
    }
    bridge._ambientLoops.clear();

    // Fade out and disconnect all active voices
    const now = bridge.ctx.currentTime;
    for (let i = 0; i < bridge._voices.length; i++) {
        const v = bridge._voices[i];
        if (v) {
            try {
                if (v.fadeGain) {
                    v.fadeGain.gain.setValueAtTime(v.fadeGain.gain.value, now);
                    v.fadeGain.gain.linearRampToValueAtTime(0, now + 0.01);
                }
            } catch {}
            // Immediate disconnect on destroy — no need to wait for fade, context closing
            try { v.panner?.disconnect(); } catch {}
            try { v.lpf?.disconnect(); } catch {}
            try { v.fadeGain?.disconnect(); } catch {}
            try { v.wetGain?.disconnect(); } catch {}
        }
        bridge._voices[i] = null;
    }
    bridge._voiceCount = 0;

    // Flush dying voices (stolen voices still fading out)
    if (bridge._dyingVoices) {
        for (const dv of bridge._dyingVoices) {
            try { dv.panner?.disconnect(); } catch {}
            try { dv.fadeGain?.disconnect(); } catch {}
            try { dv.lpf?.disconnect(); } catch {}
            try { dv.wetGain?.disconnect(); } catch {}
        }
        bridge._dyingVoices.length = 0;
    }

    // Disconnect analyser if present
    if (bridge.analyser) { try { bridge.analyser.disconnect(); } catch {} }

    // Clear node pool
    if (bridge._nodePool) {
        bridge._nodePool.panners.length = 0;
        bridge._nodePool.gains.length = 0;
        bridge._nodePool.filters.length = 0;
    }

    // Clear pre-bake cache
    if (bridge._bakeCache) bridge._bakeCache.clear();
    bridge._lastBudgetWarn = 0;

    // Remove visibility auto-pause listener to prevent leak
    if (bridge._visibilityHandler && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', bridge._visibilityHandler);
        bridge._visibilityHandler = null;
    }

    // Remove AudioContext statechange handler to prevent listener leaks
    if (bridge._ctxStateHandler) {
        try { bridge.ctx.removeEventListener('statechange', bridge._ctxStateHandler); } catch {}
        bridge._ctxStateHandler = null;
    }

    // Clear anti-repetition tracking
    _lastSemitone.clear();

    // Only close if we own the context
    if (bridge.ownsContext) {
        try { bridge.ctx.close(); } catch {}
    }
    bridge._lastTrigger.clear();
    bridge._clusters.clear();
    bridge._eventCallbackRefs = null;
}

// ============================================================================
// LISTENER (with orientation for correct panning)
// ============================================================================

export function setAudioListenerPos(bridge, x, y, z) {
    if (!bridge) return;
    if (Array.isArray(x)) { bridge.listenerPos[0] = x[0]; bridge.listenerPos[1] = x[1]; bridge.listenerPos[2] = x[2]; return; }
    bridge.listenerPos[0] = x; bridge.listenerPos[1] = y; bridge.listenerPos[2] = z;
}

/**
 * Update listener from a camera object. Sets both position AND orientation
 * for correct spatial panning (research: without orientation, all panning is wrong).
 */
export function updateListenerFromCamera(bridge, camera) {
    if (!bridge || !camera) return;
    const p = camera.position || camera;
    const px = p.x ?? p[0] ?? 0, py = p.y ?? p[1] ?? 0, pz = p.z ?? p[2] ?? 0;
    bridge.listenerPos[0] = px; bridge.listenerPos[1] = py; bridge.listenerPos[2] = pz;

    // Set Web Audio listener position (smoothed to prevent jerky panning on fast camera moves)
    const listener = bridge.ctx.listener;
    const now = bridge.ctx.currentTime;
    if (listener.positionX?.setTargetAtTime) {
        // Modern API (AudioParam-based) — smooth with 10ms time constant
        listener.positionX.setTargetAtTime(px, now, 0.01);
        listener.positionY.setTargetAtTime(py, now, 0.01);
        listener.positionZ.setTargetAtTime(pz, now, 0.01);
    } else if (listener.positionX) {
        listener.positionX.value = px;
        listener.positionY.value = py;
        listener.positionZ.value = pz;
    } else if (listener.setPosition) {
        listener.setPosition(px, py, pz);
    }

    // Set orientation from camera forward/up vectors if available
    let fx = 0, fy = 0, fz = -1, ux = 0, uy = 1, uz = 0;
    if (camera.getForward) {
        // CameraController-style (getForward/getUp methods returning [x,y,z])
        const fwd = camera.getForward();
        fx = fwd[0] ?? 0; fy = fwd[1] ?? 0; fz = fwd[2] ?? -1;
        if (camera.getUp) {
            const up = camera.getUp();
            ux = up[0] ?? 0; uy = up[1] ?? 1; uz = up[2] ?? 0;
        }
    } else if (camera.getWorldDirection) {
        // Three.js-style camera
        const dir = camera.getWorldDirection({ x: 0, y: 0, z: 0 });
        fx = dir.x ?? 0; fy = dir.y ?? 0; fz = dir.z ?? -1;
        if (camera.up) { ux = camera.up.x ?? 0; uy = camera.up.y ?? 1; uz = camera.up.z ?? 0; }
    } else if (camera.forward) {
        fx = camera.forward[0] ?? 0; fy = camera.forward[1] ?? 0; fz = camera.forward[2] ?? -1;
        if (camera.up) { ux = camera.up[0] ?? 0; uy = camera.up[1] ?? 1; uz = camera.up[2] ?? 0; }
    }

    bridge.listenerFwd[0] = fx; bridge.listenerFwd[1] = fy; bridge.listenerFwd[2] = fz;
    bridge.listenerUp[0] = ux; bridge.listenerUp[1] = uy; bridge.listenerUp[2] = uz;

    if (listener.forwardX?.setTargetAtTime) {
        listener.forwardX.setTargetAtTime(fx, now, 0.01);
        listener.forwardY.setTargetAtTime(fy, now, 0.01);
        listener.forwardZ.setTargetAtTime(fz, now, 0.01);
        listener.upX.setTargetAtTime(ux, now, 0.01);
        listener.upY.setTargetAtTime(uy, now, 0.01);
        listener.upZ.setTargetAtTime(uz, now, 0.01);
    } else if (listener.forwardX) {
        listener.forwardX.value = fx; listener.forwardY.value = fy; listener.forwardZ.value = fz;
        listener.upX.value = ux; listener.upY.value = uy; listener.upZ.value = uz;
    } else if (listener.setOrientation) {
        listener.setOrientation(fx, fy, fz, ux, uy, uz);
    }
}

// ============================================================================
// SPATIAL HELPERS
// ============================================================================

function distSq(bridge, px, py, pz) {
    const dx = px - bridge.listenerPos[0], dy = py - bridge.listenerPos[1], dz = pz - bridge.listenerPos[2];
    return dx * dx + dy * dy + dz * dz;
}

/** Spatial cell key for clustering and cooldown (4m grid — larger cells = fewer batches = better perf) */
function spatialKey(patchKey, px, py, pz) {
    const cx = (px * 0.25) | 0, cy = (py * 0.25) | 0, cz = (pz * 0.25) | 0;
    return `${patchKey}|${cx}|${cy}|${cz}`;
}

// ============================================================================
// VOICE MANAGEMENT (with priority classes + fade-out on steal)
// ============================================================================

/** Clean up expired voices — returns nodes to pool instead of discarding */
function cleanupVoices(bridge) {
    const now = bridge.ctx.currentTime;
    for (let i = 0; i < bridge._voices.length; i++) {
        const v = bridge._voices[i];
        if (v && now >= v.expireTime) {
            releasePanner(bridge, v.panner);
            if (v.fadeGain) releaseGain(bridge, v.fadeGain);
            if (v.lpf) releaseFilter(bridge, v.lpf);
            if (v.wetGain) releaseGain(bridge, v.wetGain);
            bridge._voices[i] = null;
            bridge._voiceCount--;
        }
    }
    // Sweep dying voices (stolen voices fading out) — release nodes after fade completes
    for (let i = bridge._dyingVoices.length - 1; i >= 0; i--) {
        const dv = bridge._dyingVoices[i];
        if (now >= dv.expireTime) {
            releasePanner(bridge, dv.panner);
            if (dv.fadeGain) releaseGain(bridge, dv.fadeGain);
            if (dv.lpf) releaseFilter(bridge, dv.lpf);
            if (dv.wetGain) releaseGain(bridge, dv.wetGain);
            bridge._dyingVoices.splice(i, 1);
        }
    }
    // Periodically prune stale cooldown/cluster entries
    cleanupStaleMaps(bridge);
    // Release ambient ducking as voices expire
    updateAmbientDucking(bridge);
}

/**
 * Compute effective priority: priorityClass × volume.
 * This ensures a PRIORITY_CRITICAL sound at low volume still beats
 * a PRIORITY_LOW sound at high volume (FMOD-style).
 */
function effectivePriority(priorityClass, volume) {
    return priorityClass * volume;
}

/**
 * Age-adjusted priority for voice stealing comparison.
 * Research: FMOD 'oldest' stealing mode — older voices decay in priority,
 * making them easier to steal. We blend age into the comparison.
 */
function ageAdjustedPriority(voice, now) {
    const age = now - (voice.expireTime - 0.4); // approximate start time
    const agePenalty = Math.max(0, 1.0 - age * 0.5); // halves every 2 seconds
    return voice.priority * agePenalty;
}

/** Find a free slot, or steal the lowest-priority voice with fade-out */
function allocateVoice(bridge, priority) {
    // First pass: find free slot
    for (let i = 0; i < bridge._voices.length; i++) {
        if (!bridge._voices[i]) return i;
    }

    // Second pass: steal lowest age-adjusted priority voice
    const now = bridge.ctx.currentTime;
    let worstIdx = -1;
    let worstPriority = Infinity;
    for (let i = 0; i < bridge._voices.length; i++) {
        const v = bridge._voices[i];
        if (v) {
            const adjP = ageAdjustedPriority(v, now);
            if (adjP < worstPriority) {
                worstPriority = adjP;
                worstIdx = i;
            }
        }
    }

    // Only steal if new sound is more important
    if (worstIdx >= 0 && priority > worstPriority) {
        const old = bridge._voices[worstIdx];

        // Fade out over 5ms to prevent click (research: instant disconnect = audible pop)
        try {
            const now = bridge.ctx.currentTime;
            if (old.fadeGain) {
                old.fadeGain.gain.setValueAtTime(old.fadeGain.gain.value, now);
                old.fadeGain.gain.linearRampToValueAtTime(0, now + 0.005);
            }
        } catch {}

        // Move stolen voice to dying list — nodes stay connected for fade-out
        // cleanupVoices() will release them after expireTime passes
        old.expireTime = bridge.ctx.currentTime + 0.008;
        bridge._dyingVoices.push(old);

        bridge._voices[worstIdx] = null;
        bridge._voiceCount--;
        bridge._stats.stolen++;
        return worstIdx;
    }

    return -1;
}

// ============================================================================
// BATCHED IMPACT SOUNDS (frame-level batching for efficient voice usage)
// ============================================================================

/**
 * Flush all pending impact batches — called ONCE per frame from the update loop.
 * Groups accumulated collision events by (material + spatial zone) and plays
 * ONE rich mixed sound per group. Uses batch count/speeds to control the
 * sound character (more impacts = louder, denser, richer).
 *
 * This replaces per-event triggerImpact for collisions/deaths.
 * Reaction events still call triggerImpact directly (they're rare + high-priority).
 */
const MAX_BATCHES_PER_FLUSH = 3; // Cap voices created per frame for CPU budget

export function flushImpactBatches(bridge) {
    if (!bridge || bridge.ctx.state !== 'running') return;
    const pending = bridge._pendingImpacts;
    if (pending.size === 0) return;

    // Flush every 2nd frame (30Hz audio is perceptually fine, halves CPU cost)
    if (!bridge._flushFrame) bridge._flushFrame = 0;
    bridge._flushFrame++;
    if (bridge._flushFrame & 1) return; // skip odd frames, keep accumulating

    cleanupVoices(bridge);
    const now = bridge.ctx.currentTime;
    const maxD = bridge.maxDistance;
    const maxDSq = maxD * maxD;

    // Pre-score batches by estimated volume, play only the loudest N
    // Avoids sorting: just keep a small top-N array
    const scored = [];
    for (const [key, batch] of pending) {
        const { count, maxSpeed, sumPos } = batch;
        const cx = sumPos[0] / count, cy = sumPos[1] / count, cz = sumPos[2] / count;
        const dx = cx - bridge.listenerPos[0], dy = cy - bridge.listenerPos[1], dz = cz - bridge.listenerPos[2];
        const dSq = dx * dx + dy * dy + dz * dz;
        if (dSq > maxDSq) continue;
        const dist = Math.sqrt(dSq);
        const distNorm = dist <= 1 ? 0.0 : dist / maxD;
        const score = (1.0 - distNorm) * maxSpeed * (1 + Math.log2(Math.max(count, 1)) * 0.25);
        scored.push({ key, batch, dist, cx, cy, cz, score });
    }

    // Sort descending by score, take top N
    scored.sort((a, b) => b.score - a.score);
    const limit = Math.min(scored.length, MAX_BATCHES_PER_FLUSH);

    for (let i = 0; i < limit; i++) {
        const { batch, dist, cx, cy, cz } = scored[i];
        const { patchKey, substanceKey, count, totalSpeed, maxSpeed, totalTemp } = batch;
        const avgSpeed = totalSpeed / count;
        const avgTemp = totalTemp / count;

        // Distance attenuation
        const distNorm = dist <= 1 ? 0.0 : Math.min(dist / maxD, 1.0);
        const distAtten = Math.max(0, 1.0 - Math.pow(distNorm, bridge.distanceCurve));

        // Volume
        const countBoost = 1.0 + Math.log2(Math.max(count, 1)) * 0.25;
        const speedFactor = Math.min(0.2 + maxSpeed * 0.25, 1.5);
        const matCal = getMaterialVolumeCal(patchKey);
        const linearVol = distAtten * speedFactor * matCal * bridge.masterVolume * countBoost;
        if (linearVol < 0.001) continue;
        const volume = Math.min(perceptualVolume(linearVol), 1.0);

        const patchFn = getImpactPatch(patchKey);
        if (!patchFn) continue;

        const slot = allocateVoice(bridge, PRIORITY_NORMAL);
        if (slot < 0) break; // no more voices available

        // Lightweight audio graph: patch → fadeGain → lpf → panner → compressor
        // Cheap occlusion for batched sounds (1 raycast per batch, max 3 batches/flush)
        let batchOccl = 1.0;
        if (bridge._occlusionFn) {
            const srcPos = [cx, cy, cz];
            batchOccl = Math.max(0.05, bridge._occlusionFn(srcPos, bridge.listenerPos));
        }
        const panner = acquirePanner(bridge, cx, cy, cz);
        const fadeGain = acquireGain(bridge);
        fadeGain.gain.value = 1.0;
        let lpfCutoff = distanceLPFCutoff(dist, maxD) || LPF_BASE_FREQ;
        if (batchOccl < 1.0) lpfCutoff *= batchOccl; // muffle high freqs
        const lpf = acquireFilter(bridge, lpfCutoff);

        fadeGain.connect(lpf);
        lpf.connect(panner);
        panner.connect(bridge.compressor);

        // Reverb send for batched impacts (same as legacy path)
        let wetGain = null;
        const batchDistRatio = dist / maxD;
        if (bridge.reverbSend && batchDistRatio < LOD_FAR_DIST) {
            wetGain = acquireGain(bridge);
            wetGain.gain.value = reverbWetLevel(dist, maxD);
            panner.connect(wetGain);
            wetGain.connect(bridge.reverbSend);
        }

        const patchDuration = getPatchDuration(patchKey);
        const tailExtra = wetGain ? REVERB_TAIL_EXTRA : 0;

        bridge._voices[slot] = {
            panner, fadeGain, lpf, wetGain,
            priority: PRIORITY_NORMAL,
            priorityClass: PRIORITY_NORMAL,
            expireTime: now + patchDuration + 0.05 + tailExtra,
            patchKey,
        };
        bridge._voiceCount++;
        bridge._stats.impacts++;
        if (bridge._voiceCount > bridge._stats.peakVoices) bridge._stats.peakVoices = bridge._voiceCount;

        // Pitch: temperature shift + musical semitone variation (same as legacy)
        const batchTempNorm = Math.min(avgTemp / 2000, 1);
        const batchLayer = velocityLayer(maxSpeed);
        const batchBasePitch = (0.8 + batchTempNorm * 0.4) * batchLayer.pitchScale;
        const batchPitch = batchBasePitch * musicalPitchVariation(patchKey);

        // Occluded volume reduction (same curve as legacy path)
        const batchVol = batchOccl < 1.0 ? volume * batchLayer.volScale * (0.3 + 0.7 * Math.sqrt(batchOccl)) : volume * batchLayer.volScale;
        const mappedBatch = mapSubstanceParams(substanceKey, {
            emitRate: count,
            avgVelocity: avgSpeed,
            speed: maxSpeed,
            temperature: avgTemp,
            density: count,
        });

        try {
            patchFn(bridge.ctx, fadeGain, {
                volume: Math.min(batchVol, bridge.masterVolume * 1.5),
                pitch: batchPitch,
                speed: maxSpeed,
                avgSpeed,
                temperature: avgTemp,
                count,
                quality: Math.max(0, 1.0 - distNorm),
                ...mappedBatch,
            });
        } catch (e) {
            bridge._voices[slot] = null;
            bridge._voiceCount--;
            releasePanner(bridge, panner);
            releaseGain(bridge, fadeGain);
            releaseFilter(bridge, lpf);
            if (wetGain) releaseGain(bridge, wetGain);
        }
    }

    pending.clear();
}

// ============================================================================
// LEGACY IMPACT SOUNDS (direct trigger, used for reactions + manual calls)
// ============================================================================

/**
 * Trigger an impact sound immediately. Used for reaction events and manual triggers.
 * For collision/death events, use the batched system (flushImpactBatches) instead.
 * @param {number} priorityClass - PRIORITY_NORMAL by default. Use PRIORITY_HIGH for player-caused.
 */
export function triggerImpact(bridge, material, position, speed = 2, temperature = 300, priorityClass = PRIORITY_NORMAL, velocity = null) {
    if (!bridge || bridge.ctx.state === 'closed') return;
    if (bridge.ctx.state === 'suspended') { bridge.ctx.resume().catch(() => {}); return; }

    const patchKey = resolvePatchKey(material);
    if (bridge._debugSolo && bridge._debugSolo !== patchKey) return;
    if (bridge._debugMuted?.has(patchKey)) return;

    const patchFn = getImpactPatch(patchKey);
    if (!patchFn) return;

    const substanceKey = typeof material === 'string'
        ? material
        : (typeof material === 'number' ? (MATERIAL_PATCH_KEY[material] || patchKey) : patchKey);
    const mappedImpact = mapSubstanceParams(substanceKey, {
        emitRate: speed * 2,
        avgVelocity: speed,
        speed,
        temperature,
        density: speed,
    });

    const [px, py, pz] = position;
    const dSqVal = distSq(bridge, px, py, pz);
    const maxD = bridge.maxDistance;
    if (dSqVal > maxD * maxD) return;

    const dist = Math.sqrt(dSqVal);
    const distNorm = dist <= 1 ? 0.0 : Math.min(dist / maxD, 1.0);
    const distAtten = Math.max(0, 1.0 - Math.pow(distNorm, bridge.distanceCurve));

    const speedFactor = Math.min(0.2 + speed * 0.25, 1.5);
    const matCal = getMaterialVolumeCal(patchKey);
    const linearVol = distAtten * speedFactor * matCal * bridge.masterVolume;
    if (linearVol < 0.001) return;
    const volume = perceptualVolume(linearVol);

    const now = bridge.ctx.currentTime;
    const cellKey = spatialKey(patchKey, px, py, pz);

    // Spatial cooldown: per-material per-cell with ±30% jitter to break rhythmic patterns
    // Research: fixed cooldowns create audible machine-gun rhythm when many particles hit
    const baseCooldown = getCooldownForMaterial(patchKey);
    const cooldown = baseCooldown * uniformDistribution(0.7, 1.3, Math.random); // ±30% jitter
    const last = bridge._lastTrigger.get(cellKey) || 0;
    if (now - last < cooldown) {
        // Cluster: accumulate into existing cluster for volume boost
        const cluster = bridge._clusters.get(cellKey);
        if (cluster && (now - cluster.time) < CLUSTER_TIME_WINDOW) {
            cluster.count++;
            cluster.totalSpeed += speed;
            cluster.totalTemp += temperature;
            bridge._stats.clustered++;
        }
        return;
    }

    // Check if we have a cluster to resolve (multiple impacts merged)
    let finalSpeed = speed;
    let finalTemp = temperature;
    let finalVolume = volume;
    const cluster = bridge._clusters.get(cellKey);
    if (cluster && cluster.count > 1 && (now - cluster.time) < CLUSTER_TIME_WINDOW * 3) {
        // Merge: logarithmic volume boost (n impacts ≈ +3dB per doubling)
        const boost = 1.0 + Math.log2(Math.min(cluster.count, 16)) * 0.3;
        finalSpeed = cluster.totalSpeed / cluster.count;
        finalTemp = cluster.totalTemp / cluster.count;
        finalVolume = Math.min(volume * boost, bridge.masterVolume * 1.5);
    }

    bridge._lastTrigger.set(cellKey, now);
    bridge._clusters.set(cellKey, { count: 1, totalSpeed: speed, totalTemp: temperature, bestPos: position, time: now });

    // Per-material voice limit: prevent one material from monopolizing all voices
    if (countMaterialVoices(bridge, patchKey) >= MAX_VOICES_PER_MATERIAL) {
        bridge._stats.dropped++;
        return;
    }

    // HDR audibility culling: drop sounds inaudible next to loudest active voice
    if (hdrCullCheck(bridge, finalVolume)) {
        bridge._stats.dropped++;
        return;
    }

    // Cleanup expired voices, then allocate
    cleanupVoices(bridge);

    const priority = effectivePriority(priorityClass, finalVolume);
    const slot = allocateVoice(bridge, priority);
    if (slot < 0) {
        bridge._stats.dropped++;
        return;
    }

    // Velocity layer: soft/medium/hard impact scaling + volume micro-variation (±10%)
    // Research: identical loudness across repeated sounds sounds mechanical
    const layer = velocityLayer(finalSpeed);
    const volJitter = uniformDistribution(0.9, 1.1, Math.random); // ±10%
    finalVolume = Math.min(finalVolume * layer.volScale * volJitter, bridge.masterVolume * 1.5);

    // Pitch: temperature shifts + musical semitone variation + velocity layer
    const tempNorm = Math.min(finalTemp / 2000, 1);
    const basePitch = (0.8 + tempNorm * 0.4) * layer.pitchScale;
    const pitch = basePitch * musicalPitchVariation(patchKey);

    // Doppler pitch shift for fast-moving particles
    let dopplerPitch = 1.0;
    if (velocity) {
        const vx = velocity[0] ?? 0, vy = velocity[1] ?? 0, vz = velocity[2] ?? 0;
        dopplerPitch = dopplerShift(bridge, px, py, pz, vx, vy, vz);
    }

    // Distance-based low-pass filter (air absorption) + speed brightness
    // Research: The brain uses high-frequency rolloff as primary distance cue after volume.
    // Air absorbs ~1dB/100m at 1kHz, ~10dB/100m at 8kHz. We approximate with a LPF.
    // Faster impacts also have more high-frequency energy — boost cutoff by speed.
    const baseLpf = distanceLPFCutoff(dist, maxD);
    // Occlusion: if callback set, modulate both LPF cutoff AND volume
    // Real occlusion = wall blocks high freqs (LPF) AND reduces loudness (volume)
    const occl = bridge._occlusionFn
        ? Math.max(0.05, bridge._occlusionFn(position, bridge.listenerPos))
        : 1.0;
    const lpfCutoff = Math.min(baseLpf * speedBrightnessFactor(finalSpeed) * occl, LPF_BASE_FREQ);
    // Volume reduction: gentler curve than LPF (sqrt) — occluded sounds are quieter but not silent
    if (occl < 1.0) {
        finalVolume *= (0.3 + 0.7 * Math.sqrt(occl)); // at occl=0.15: vol×0.57, at occl=0.5: vol×0.79
    }

    // Acquire nodes from pool (reduces GC pressure — research: node creation causes GC spikes)
    const panner = acquirePanner(bridge, px, py, pz);
    const fadeGain = acquireGain(bridge);
    const lpf = acquireFilter(bridge, lpfCutoff);

    // Micro-timing jitter: clustered impacts get 0-3ms random offset to prevent phase stacking
    const clusterCheck = bridge._clusters.get(cellKey);
    const microJitter = (clusterCheck && clusterCheck.count > 1) ? uniformDistribution(0, 0.003, Math.random) : 0;
    const startTime = now + microJitter;

    // Fade-in: 2ms ramp from 0 prevents click on voice start
    // Research (alemangui): abrupt gain changes at non-zero samples cause audible clicks
    fadeGain.gain.setValueAtTime(0, startTime);
    fadeGain.gain.linearRampToValueAtTime(1.0, startTime + 0.002);

    // Distance ratio for proximity boost and reverb LOD
    const distRatio = dist / maxD;

    // Audio chain: patch → fadeGain → LPF → [proxBoost] → [stereoPan] → panner → compressor
    fadeGain.connect(lpf);

    // Proximity bass boost: low-shelf for very close impacts
    let lpfOut = lpf;
    if (distRatio < PROXIMITY_THRESHOLD) {
        const proxShelf = bridge.ctx.createBiquadFilter();
        proxShelf.type = 'lowshelf';
        proxShelf.frequency.value = PROXIMITY_BASS_FREQ;
        proxShelf.gain.value = PROXIMITY_BASS_BOOST * (1.0 - distRatio / PROXIMITY_THRESHOLD);
        lpf.connect(proxShelf);
        lpfOut = proxShelf;
    }

    // Stereo micro-pan: small random offset for clustered impacts to widen imaging
    const clusterData = bridge._clusters.get(cellKey);
    if (clusterData && clusterData.count > 1 && bridge.ctx.createStereoPanner) {
        const stereoPan = bridge.ctx.createStereoPanner();
        stereoPan.pan.value = uniformDistribution(-STEREO_SPREAD_RANGE, STEREO_SPREAD_RANGE, Math.random);
        lpfOut.connect(stereoPan);
        stereoPan.connect(panner);
    } else {
        lpfOut.connect(panner);
    }
    panner.connect(bridge.compressor);

    // Reverb send: distance-proportional wet level (further = more reverb)
    // Audio LOD: skip reverb send for far sounds (saves one GainNode + convolution work)
    let wetGain = null;
    if (bridge.reverbSend && distRatio < LOD_FAR_DIST) {
        wetGain = acquireGain(bridge);
        wetGain.gain.value = reverbWetLevel(dist, maxD);
        panner.connect(wetGain);
        wetGain.connect(bridge.reverbSend);
    }

    const patchDuration = getPatchDuration(patchKey);
    const tailExtra = wetGain ? REVERB_TAIL_EXTRA : 0; // only add if reverb send active

    bridge._voices[slot] = {
        panner,
        fadeGain,
        lpf,
        wetGain,
        priority,
        priorityClass,
        expireTime: now + patchDuration + 0.1 + tailExtra,
        patchKey,
    };
    bridge._voiceCount++;
    bridge._stats.impacts++;
    if (bridge._voiceCount > bridge._stats.peakVoices) bridge._stats.peakVoices = bridge._voiceCount;

    // Auto-duck ambient sounds when many impact voices are active
    updateAmbientDucking(bridge);

    // Try pre-baked buffer first (much cheaper than live synthesis)
    const bakeKey = `${patchKey}_${bakePitchBucket(pitch * dopplerPitch)}`;
    const bakedBuffer = bridge._bakeCache.get(bakeKey);
    if (bakedBuffer) {
        // Play cached AudioBuffer — no oscillators, no filters, just BufferSourceNode
        try {
            const src = bridge.ctx.createBufferSource();
            src.buffer = bakedBuffer;
            src.playbackRate.value = pitch * dopplerPitch;
            const volGain = acquireGain(bridge);
            volGain.gain.value = finalVolume;
            src.connect(volGain);
            volGain.connect(fadeGain);
            src.start();
            bridge._stats.bakeHits++;
        } catch (e) {
            // Fallback to live synthesis below
            patchFn(bridge.ctx, fadeGain, {
                volume: finalVolume, pitch: pitch * dopplerPitch,
                speed: finalSpeed, temperature: finalTemp,
                ...mappedImpact,
            });
        }
    } else {
        // Live synthesis + trigger background bake for next time
        // Synthesis LOD: distant sounds get lower quality hint (0-1)
        // Patches can use this to skip expensive FM/resonance for far sounds
        const synthQuality = 1.0 - Math.pow(distRatio, 0.5);
        try {
            patchFn(bridge.ctx, fadeGain, {
                volume: finalVolume,
                pitch: pitch * dopplerPitch,
                speed: finalSpeed,
                temperature: finalTemp,
                quality: synthQuality,
                ...mappedImpact,
            });
            // Async bake for future cache hits (fire-and-forget)
            preBakePatch(bridge, patchKey, patchFn, pitch * dopplerPitch);
        } catch (e) {
            bridge._voices[slot] = null;
            bridge._voiceCount--;
            releasePanner(bridge, panner);
            releaseGain(bridge, fadeGain);
            releaseFilter(bridge, lpf);
            if (wetGain) releaseGain(bridge, wetGain);
        }
    }
}

// ============================================================================
// EVENT CALLBACK WIRING
// ============================================================================

/**
 * Wire the bridge into the ParticleEventSystem via onParticleEvent callbacks.
 * Fires immediately when readbackEvents completes — zero polling, zero timers.
 * Registers for collision events (type 2, 3) and death events (type 1).
 * 
 * @param {Object} bridge
 * @param {Object} eventSystem - From initParticleEventSystem
 * @param {Function} getMaterial - (evt) => substanceKey or materialIndex.
 */
export function wireEventCallbacks(bridge, eventSystem, getMaterial) {
    if (!bridge || !eventSystem) return;

    const EVENT_DEATH = 1;
    const EVENT_GROUND_COLLISION = 2;
    const EVENT_ENTITY_COLLISION = 3;

    bridge._getMaterial = getMaterial || null;

    function resolveMaterial(evt) {
        let material = 'stone';
        if (bridge._getMaterial) {
            const m = bridge._getMaterial(evt);
            if (m != null) material = m;
        }
        if (material === 'stone') {
            if (evt.temperature > 3000) material = 'plasma';
            else if (evt.temperature > 800) material = 'lava';
        }
        return material;
    }

    function accumulateImpact(material, position, speed, temperature) {
        const patchKey = resolvePatchKey(material);
        const substanceKey = typeof material === 'string'
            ? material
            : (typeof material === 'number' ? (MATERIAL_PATCH_KEY[material] || patchKey) : patchKey);
        const [px, py, pz] = position;
        const key = spatialKey(patchKey, px, py, pz);
        const pending = bridge._pendingImpacts;
        const existing = pending.get(key);
        if (existing) {
            existing.count++;
            existing.totalSpeed += speed;
            if (speed > existing.maxSpeed) existing.maxSpeed = speed;
            existing.sumPos[0] += px; existing.sumPos[1] += py; existing.sumPos[2] += pz;
            existing.totalTemp += temperature;
            if (!existing.substanceKey && substanceKey) existing.substanceKey = substanceKey;
        } else {
            pending.set(key, {
                patchKey,
                substanceKey,
                count: 1,
                totalSpeed: speed,
                maxSpeed: speed,
                sumPos: [px, py, pz],
                totalTemp: temperature,
            });
        }
    }

    function handleCollision(evt) {
        const speed = Math.sqrt(
            evt.velocity[0] ** 2 + evt.velocity[1] ** 2 + evt.velocity[2] ** 2
        );
        if (speed < 0.3) return;
        accumulateImpact(resolveMaterial(evt), evt.position, speed, evt.temperature);
    }

    function handleDeath(evt) {
        const speed = Math.sqrt(
            evt.velocity[0] ** 2 + evt.velocity[1] ** 2 + evt.velocity[2] ** 2
        );
        accumulateImpact(resolveMaterial(evt), evt.position, speed * 0.3, evt.temperature);
    }

    function handleReaction(evt) {
        // Reaction events are visually dramatic — play with PRIORITY_HIGH
        // The temperature field encodes the reaction rule index, but we use
        // the product material from getMaterial or default to the event position
        const material = resolveMaterial(evt);
        const reactionPatch = REACTION_SOUND_MAP[material] || material;
        const reactionTemp = reactionTemperatureForPatch(reactionPatch, evt.temperature);
        const speed = Math.sqrt(
            evt.velocity[0] ** 2 + evt.velocity[1] ** 2 + evt.velocity[2] ** 2
        );
        triggerImpact(bridge, reactionPatch, evt.position, Math.max(speed, 4), reactionTemp, PRIORITY_HIGH, evt.velocity);
    }

    // Register callbacks directly on the event system
    const EVENT_REACTION = 5;
    if (eventSystem._callbacks) {
        const register = (sys, type, cb) => {
            if (!sys._callbacks.has(type)) sys._callbacks.set(type, []);
            sys._callbacks.get(type).push(cb);
        };

        register(eventSystem, EVENT_GROUND_COLLISION, handleCollision);
        register(eventSystem, EVENT_ENTITY_COLLISION, handleCollision);
        register(eventSystem, EVENT_DEATH, handleDeath);
        register(eventSystem, EVENT_REACTION, handleReaction);
        bridge._eventCallbackRefs = { handleCollision, handleDeath, handleReaction, eventSystem };
        console.log('[ParticleAudioBridge] Wired collision + death + reaction callbacks — real-time audio active');
    }
}

/**
 * Unwire event callbacks (for cleanup).
 * Actually removes the callback functions from the event system's callback arrays.
 */
export function unwireEventCallbacks(bridge) {
    if (!bridge?._eventCallbackRefs) return;
    const refs = bridge._eventCallbackRefs;
    const sys = refs.eventSystem;
    if (sys?._callbacks) {
        const EVENT_DEATH = 1, EVENT_GROUND_COLLISION = 2, EVENT_ENTITY_COLLISION = 3, EVENT_REACTION = 5;
        const removeFrom = (type, fn) => {
            const arr = sys._callbacks.get(type);
            if (arr) {
                const idx = arr.indexOf(fn);
                if (idx >= 0) arr.splice(idx, 1);
            }
        };
        removeFrom(EVENT_GROUND_COLLISION, refs.handleCollision);
        removeFrom(EVENT_ENTITY_COLLISION, refs.handleCollision);
        removeFrom(EVENT_DEATH, refs.handleDeath);
        removeFrom(EVENT_REACTION, refs.handleReaction);
    }
    bridge._eventCallbackRefs = null;
    bridge._getMaterial = null;
}

// ============================================================================
// AMBIENT LOOPS (per-emitter, separate bus — bypasses compressor)
// ============================================================================

export function updateAmbientLoop(bridge, emitterId, material, position, params = {}) {
    if (!bridge || bridge.ctx.state !== 'running') return;

    const patchKey = resolvePatchKey(material);
    const existing = bridge._ambientLoops.get(emitterId);
    const { substanceId = null, ...ambientParams } = params;
    const mappedParams = mapSubstanceParams(substanceId, ambientParams);

    const [px, py, pz] = position;
    const dSqVal = distSq(bridge, px, py, pz);
    const maxD = bridge.maxDistance;
    const dist = Math.sqrt(dSqVal);
    // Use same configurable distance curve as impacts
    const distNorm = dist <= 1 ? 0.0 : Math.min(dist / maxD, 1.0);
    const distAtten = Math.max(0, 1.0 - Math.pow(distNorm, bridge.distanceCurve));
    const volume = perceptualVolume(distAtten * bridge.masterVolume * 0.35);

    if (existing) {
        if (existing.patchKey !== patchKey) {
            // Crossfade: fade out old loop over 150ms before stopping
            // Research: abrupt material transitions cause audible pops
            try {
                if (existing.handle.update) {
                    existing.handle.update({ volume: 0.001 });
                }
            } catch {}
            const oldLoop = existing;
            bridge._ambientLoops.delete(emitterId);
            setTimeout(() => {
                try { oldLoop.handle.stop(); } catch {}
                try { oldLoop.panner?.disconnect(); } catch {}
                if (oldLoop.lpf) {
                    try { oldLoop.lpf.disconnect(); } catch {}
                    releaseFilter(bridge, oldLoop.lpf);
                }
            }, 150);
        } else {
            try {
                if (existing.panner.positionX) {
                    existing.panner.positionX.value = px;
                    existing.panner.positionY.value = py;
                    existing.panner.positionZ.value = pz;
                } else { existing.panner.setPosition(px, py, pz); }
            } catch {}
            // Occlusion + air absorption LPF cutoff for ambients (smoothed)
            let ambOccl = 1.0;
            if (bridge._occlusionFn) {
                ambOccl = Math.max(0.05, bridge._occlusionFn(position, bridge.listenerPos));
            }
            if (existing.lpf) {
                const ambLpfCutoff = distanceLPFCutoff(dist, maxD) * ambOccl;
                existing.lpf.frequency.setTargetAtTime(
                    ambLpfCutoff, bridge.ctx.currentTime, 0.05
                );
            }
            // Occluded ambients are quieter (smooth ramp via patch update)
            const ambVol = ambOccl < 1.0 ? volume * (0.3 + 0.7 * Math.sqrt(ambOccl)) : volume;
            if (existing.handle.update) existing.handle.update({ volume: ambVol, ...mappedParams });
            return;
        }
    }

    // Hysteresis: start at maxDist, stop at maxDist*1.1 — prevents start/stop flicker at boundary
    const cullDist = existing ? maxD * 1.1 : maxD;
    if (dist > cullDist || volume < 0.01) return;

    const ambientFn = getAmbientPatch(patchKey);
    if (!ambientFn) return;

    // Ambient loops go through LPF → panner → ambientGain (bypasses compressor)
    const panner = acquirePanner(bridge, px, py, pz);
    const ambLpf = acquireFilter(bridge, distanceLPFCutoff(dist, maxD));
    ambLpf.connect(panner);
    panner.connect(bridge.ambientGain);

    try {
        const handle = ambientFn(bridge.ctx, ambLpf, { volume, ...mappedParams });
        bridge._ambientLoops.set(emitterId, { handle, panner, lpf: ambLpf, patchKey });
        bridge._stats.ambientActive = bridge._ambientLoops.size;
    } catch (e) {
        try { panner.disconnect(); } catch {}
        try { ambLpf.disconnect(); } catch {}
    }
}

export function stopAmbientLoop(bridge, emitterId) {
    if (!bridge) return;
    const loop = bridge._ambientLoops.get(emitterId);
    if (!loop) return;
    try { loop.handle.stop(); } catch {}
    try { loop.panner.disconnect(); } catch {}
    if (loop.lpf) { try { loop.lpf.disconnect(); } catch {} releaseFilter(bridge, loop.lpf); }
    bridge._ambientLoops.delete(emitterId);
    bridge._stats.ambientActive = bridge._ambientLoops.size;
}

export function stopAllAmbientLoops(bridge) {
    if (!bridge) return;
    for (const [id] of bridge._ambientLoops) stopAmbientLoop(bridge, id);
}

/**
 * Immediately silence ALL particle audio — impacts + ambients.
 * Called when the editor exits play mode (Stop button).
 */
export function stopAllSounds(bridge) {
    if (!bridge) return;
    const now = bridge.ctx.currentTime;

    // Kill all active impact voices with a fast 5ms fade
    for (let i = 0; i < bridge._voices.length; i++) {
        const v = bridge._voices[i];
        if (v) {
            try {
                if (v.fadeGain) {
                    v.fadeGain.gain.setValueAtTime(v.fadeGain.gain.value, now);
                    v.fadeGain.gain.linearRampToValueAtTime(0, now + 0.005);
                }
            } catch {}
        }
        bridge._voices[i] = null;
    }
    bridge._voiceCount = 0;

    // Kill dying voices (stolen voices still fading)
    if (bridge._dyingVoices) {
        for (const dv of bridge._dyingVoices) {
            try { if (dv.fadeGain) { dv.fadeGain.gain.setValueAtTime(0, now); } } catch {}
        }
        bridge._dyingVoices.length = 0;
    }

    // Stop all ambient loops
    for (const [id] of bridge._ambientLoops) stopAmbientLoop(bridge, id);

    // Clear cooldown/cluster state so next play starts fresh
    bridge._lastTrigger.clear();
    bridge._clusters.clear();
}

export function updateEmitterAmbients(bridge, emitters) {
    if (!bridge) return;
    if (bridge.ctx.state === 'suspended') { bridge.ctx.resume().catch(() => {}); return; }

    const activeIds = new Set();
    for (const em of emitters) {
        if (!em.active || em.emitRate <= 0) continue;
        if (!em.substance && em.materialIndex == null) continue;
        activeIds.add(em.id);
        updateAmbientLoop(bridge, em.id, em.substance || em.materialIndex || 'stone', em.position || [0, 0, 0], {
            substanceId: em.substance || null,
            emitRate: em.emitRate,
            avgVelocity: em.avgVelocity ?? 1,
            temperature: em.temperature ?? 300,
            density: em.density ?? 0,
        });
    }

    for (const [id] of bridge._ambientLoops) {
        if (!activeIds.has(id)) stopAmbientLoop(bridge, id);
    }
}

// ============================================================================
// SETTINGS
// ============================================================================

export function setParticleAudioVolume(bridge, volume) {
    if (!bridge) return;
    bridge.masterVolume = volume;
    // Smooth volume change to avoid zipper noise
    bridge.masterGain.gain.setTargetAtTime(volume, bridge.ctx.currentTime, 0.02);
}

/**
 * Update reverb parameters at runtime (e.g., when entering a cave or outdoor area).
 * @param {Object} params - { wetLevel, decay, preDelay } - all optional
 */
export function setReverbParams(bridge, params = {}) {
    if (!bridge) return;
    const now = bridge.ctx.currentTime;
    if (params.wetLevel !== undefined && bridge.reverbGain) {
        bridge.reverbGain.gain.setTargetAtTime(params.wetLevel, now, 0.1);
    }
    if (params.preDelay !== undefined && bridge._preDelay) {
        bridge._preDelay.delayTime.setTargetAtTime(params.preDelay, now, 0.05);
    }
}

/** Set impact bus volume independently (0-1). Smoothed to avoid zipper noise. */
export function setImpactVolume(bridge, volume) {
    if (!bridge?.impactGain) return;
    bridge.impactGain.gain.setTargetAtTime(volume, bridge.ctx.currentTime, 0.02);
}

/** Set ambient bus volume independently (0-1). Smoothed to avoid zipper noise. */
export function setAmbientVolume(bridge, volume) {
    if (!bridge) return;
    bridge.ambientGain.gain.setTargetAtTime(volume, bridge.ctx.currentTime, 0.02);
}

/**
 * Resume AudioContext after browser autoplay policy suspension.
 * Research (Chrome/Safari): Context starts 'suspended' until user gesture.
 * Call this from your first click/keydown handler.
 */
export function resumeAudioContext(bridge) {
    if (!bridge) return;
    if (bridge.ctx.state === 'suspended') {
        bridge.ctx.resume().catch(() => {});
    }
}

/**
 * Auto-unlock AudioContext on first user interaction (Safari/iOS workaround).
 * Research (Matt Montag): Safari requires resume() from touch/click handler.
 * Registers one-shot listeners that self-remove after first successful resume.
 */
export function autoUnlockAudioContext(bridge) {
    if (!bridge || typeof document === 'undefined') return;
    if (bridge.ctx.state === 'running') return;
    const events = ['touchstart', 'touchend', 'mousedown', 'keydown'];
    const unlock = () => {
        bridge.ctx.resume().then(() => {
            events.forEach(e => document.body.removeEventListener(e, unlock));
        }).catch(() => {});
    };
    events.forEach(e => document.body.addEventListener(e, unlock, { once: false, passive: true }));
}

/**
 * Pause all audio (suspend context). Use when tab hidden or game paused.
 * Research (web.dev Fieldrunners): every game should pause audio on tab hide
 * to prevent wasted CPU and audio buildup.
 */
export function pauseAllAudio(bridge) {
    if (!bridge) return;
    if (bridge.ctx.state === 'running') {
        bridge.ctx.suspend().catch(() => {});
    }
}

/**
 * Resume all audio after pause.
 */
export function resumeAllAudio(bridge) {
    if (!bridge) return;
    if (bridge.ctx.state === 'suspended') {
        bridge.ctx.resume().catch(() => {});
    }
}

/**
 * Hook into Page Visibility API to auto-pause/resume audio.
 * Call once after createAudioBridge.
 */
export function hookVisibilityAutoPause(bridge) {
    if (!bridge || typeof document === 'undefined') return;
    const handler = () => {
        if (document.hidden) {
            pauseAllAudio(bridge);
        } else {
            resumeAllAudio(bridge);
        }
    };
    document.addEventListener('visibilitychange', handler);
    bridge._visibilityHandler = handler;
}

export function getAudioBridgeStats(bridge) {
    if (!bridge) return null;
    bridge._stats.voicesActive = bridge._voiceCount;
    bridge._stats.ambientActive = bridge._ambientLoops.size;

    // Per-material voice breakdown for profiling
    const materialBreakdown = {};
    for (let i = 0; i < bridge._voices.length; i++) {
        const v = bridge._voices[i];
        if (v) {
            materialBreakdown[v.patchKey] = (materialBreakdown[v.patchKey] || 0) + 1;
        }
    }
    bridge._stats.materialBreakdown = materialBreakdown;

    // Bake cache stats
    bridge._stats.bakeCacheSize = bridge._bakeCache?.size || 0;
    bridge._stats.bakeHitRate = bridge._stats.impacts > 0
        ? (bridge._stats.bakeHits / bridge._stats.impacts * 100).toFixed(1) + '%'
        : '0%';

    // Context state + compressor gain reduction + latency (all free metrics)
    bridge._stats.contextState = bridge.ctx.state;
    bridge._stats.compressorReduction = bridge.compressor.reduction?.toFixed?.(1) + 'dB'
        || bridge.compressor.reduction + 'dB';
    if (bridge.ctx.baseLatency !== undefined) bridge._stats.baseLatencyMs = (bridge.ctx.baseLatency * 1000).toFixed(1);
    if (bridge.ctx.outputLatency !== undefined) bridge._stats.outputLatencyMs = (bridge.ctx.outputLatency * 1000).toFixed(1);
    bridge._stats.dyingVoices = bridge._dyingVoices?.length || 0;

    // Pool utilization (% of max pool used)
    if (bridge._nodePool) {
        const poolTotal = POOL_MAX * 3; // panners + gains + filters
        const poolFree = (bridge._nodePool.panners?.length || 0) + (bridge._nodePool.gains?.length || 0) + (bridge._nodePool.filters?.length || 0);
        bridge._stats.poolUtilization = ((1 - poolFree / poolTotal) * 100).toFixed(0) + '%';
    }
    bridge._stats.voiceUtilization = ((bridge._voiceCount / bridge.maxVoices) * 100).toFixed(0) + '%';

    // Real-time peak level from AnalyserNode (if enabled)
    if (bridge.analyser) {
        const buf = new Float32Array(bridge.analyser.fftSize);
        bridge.analyser.getFloatTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) {
            const abs = Math.abs(buf[i]);
            if (abs > peak) peak = abs;
        }
        bridge._stats.peakLevel = peak;
        bridge._stats.peakLevelDb = peak > 0 ? gainToDb(peak).toFixed(1) + 'dB' : '-Inf dB';
    }

    return { ...bridge._stats };
}

/**
 * Set an occlusion callback. The function receives (sourcePos, listenerPos) and returns
 * 0-1 (0=fully occluded, 1=clear). Used to modulate LPF cutoff for obstruction.
 * Game code provides the raycast logic; audio system just applies the result.
 */
export function setOcclusionCallback(bridge, fn) {
    if (!bridge) return;
    bridge._occlusionFn = typeof fn === 'function' ? fn : null;
}

/** Debug: solo a specific material (only that material plays). Pass null to clear. */
export function soloMaterial(bridge, patchKey) {
    if (!bridge) return;
    bridge._debugSolo = patchKey || null;
}

/** Debug: mute a specific material. Pass null to unmute all. */
export function muteMaterial(bridge, patchKey) {
    if (!bridge) return;
    if (!bridge._debugMuted) bridge._debugMuted = new Set();
    if (patchKey) bridge._debugMuted.add(patchKey);
    else bridge._debugMuted.clear();
}

/** Reset per-frame stats counters for delta profiling. Call after getAudioBridgeStats each frame. */
export function resetAudioBridgeStats(bridge) {
    if (!bridge) return;
    bridge._stats.impacts = 0;
    bridge._stats.stolen = 0;
    bridge._stats.dropped = 0;
    bridge._stats.clustered = 0;
    bridge._stats.bakeHits = 0;
}

// ============================================================================
// LEGACY API (backward compatible)
// ============================================================================

export function registerAudioCue() {}
export function processAudioEvents() {}
export function flushPendingAudio() { return []; }
export function unregisterAudioCue() {}
export function processParticleEvents() {}
