// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SpatialAudioEnvironment.js - Advanced Spatial Audio Processing
 * 
 * Industry-grade environment audio: material absorption, ground reflection,
 * environment zones (underwater/cave/outdoor), diffraction, and dynamic reverb.
 * 
 * Research basis:
 *   - FMOD/Wwise material absorption coefficients (ISO 354 standard)
 *   - Image-source method for early reflections (Allen & Berkley 1979)
 *   - Underwater acoustics: 300Hz LPF + extended reverb (Wikipedia/Navy research)
 *   - Diffraction: UTD edge diffraction approximation (Kouyoumjian & Pathak 1974)
 *   - Ground reflection: single-bounce mirror source below floor plane
 * 
 * All processing uses Web Audio API nodes (BiquadFilter, Gain, Delay, Convolver).
 * Zero external dependencies.
 */

import { uniformDistribution } from '../core/math/MathRandom.js';

// ============================================================================
// MATERIAL ABSORPTION COEFFICIENTS
// How much sound each material absorbs (0 = perfect reflector, 1 = full absorber)
// Values are approximate averages across 500Hz-4kHz (the speech/impact range).
// Based on ISO 354 measurements and game audio industry conventions.
// ============================================================================

const MATERIAL_ABSORPTION = {
    // Hard reflective surfaces
    stone:    { abs: 0.03, lpfMult: 0.4, name: 'Stone/Concrete' },
    metal:    { abs: 0.05, lpfMult: 0.3, name: 'Metal' },
    glass:    { abs: 0.04, lpfMult: 0.35, name: 'Glass' },
    ice:      { abs: 0.02, lpfMult: 0.3, name: 'Ice' },
    
    // Medium absorption
    wood:     { abs: 0.15, lpfMult: 0.6, name: 'Wood' },
    plastic:  { abs: 0.10, lpfMult: 0.5, name: 'Plastic' },
    wax:      { abs: 0.12, lpfMult: 0.55, name: 'Wax' },
    
    // Soft absorptive surfaces
    sand:     { abs: 0.35, lpfMult: 0.75, name: 'Sand' },
    snow:     { abs: 0.60, lpfMult: 0.85, name: 'Snow' },
    carpet:   { abs: 0.50, lpfMult: 0.8, name: 'Carpet/Fabric' },
    grass:    { abs: 0.40, lpfMult: 0.7, name: 'Grass/Dirt' },
    debris:   { abs: 0.30, lpfMult: 0.65, name: 'Debris/Rubble' },
    
    // Liquids (sound travels differently)
    water:    { abs: 0.01, lpfMult: 0.2, name: 'Water' },
    lava:     { abs: 0.05, lpfMult: 0.3, name: 'Lava' },
    oil:      { abs: 0.08, lpfMult: 0.4, name: 'Oil' },
    
    // Gas/vapor (minimal interaction)
    smoke:    { abs: 0.02, lpfMult: 0.95, name: 'Smoke' },
    steam:    { abs: 0.03, lpfMult: 0.9, name: 'Steam' },
    plasma:   { abs: 0.01, lpfMult: 0.95, name: 'Plasma' },
    
    // Default fallback
    default:  { abs: 0.10, lpfMult: 0.5, name: 'Default' },
};

// ============================================================================
// ENVIRONMENT PRESETS
// Each environment has reverb parameters and characteristic filtering
// ============================================================================

const ENVIRONMENT_PRESETS = {
    outdoor: {
        reverbDuration: 0.3,
        reverbDecay: 6.0,
        reverbLPF: 6000,
        reverbWet: 0.08,
        earlyRefGain: 0.05,
        predelay: 0.002,
        masterLPF: 20000,     // no filtering
        masterHPF: 20,        // no filtering
        name: 'Outdoor',
    },
    indoor: {
        reverbDuration: 0.6,
        reverbDecay: 3.5,
        reverbLPF: 5000,
        reverbWet: 0.18,
        earlyRefGain: 0.12,
        predelay: 0.005,
        masterLPF: 20000,
        masterHPF: 20,
        name: 'Indoor/Room',
    },
    cave: {
        reverbDuration: 2.0,
        reverbDecay: 1.5,
        reverbLPF: 3000,
        reverbWet: 0.40,
        earlyRefGain: 0.20,
        predelay: 0.015,
        masterLPF: 12000,     // caves absorb some highs
        masterHPF: 40,
        name: 'Cave/Tunnel',
    },
    underwater: {
        reverbDuration: 1.5,
        reverbDecay: 2.0,
        reverbLPF: 800,
        reverbWet: 0.55,
        earlyRefGain: 0.08,
        predelay: 0.020,
        masterLPF: 300,       // heavy LPF — water blocks highs
        masterHPF: 30,
        name: 'Underwater',
    },
    small_room: {
        reverbDuration: 0.35,
        reverbDecay: 5.0,
        reverbLPF: 5500,
        reverbWet: 0.22,
        earlyRefGain: 0.18,
        predelay: 0.003,
        masterLPF: 20000,
        masterHPF: 20,
        name: 'Small Room',
    },
    underground: {
        reverbDuration: 1.0,
        reverbDecay: 2.5,
        reverbLPF: 2000,
        reverbWet: 0.30,
        earlyRefGain: 0.10,
        predelay: 0.008,
        masterLPF: 4000,      // earth/soil absorbs highs heavily
        masterHPF: 50,        // slight rumble emphasis
        name: 'Underground',
    },
    large_hall: {
        reverbDuration: 1.8,
        reverbDecay: 1.8,
        reverbLPF: 4000,
        reverbWet: 0.35,
        earlyRefGain: 0.15,
        predelay: 0.012,
        masterLPF: 18000,
        masterHPF: 25,
        name: 'Large Hall',
    },
};

// ============================================================================
// GROUND REFLECTION PARAMETERS
// ============================================================================

const GROUND_REFLECTION_DELAY_PER_METER = 0.003;  // ~3ms per meter of ground bounce path
const GROUND_REFLECTION_MAX_DELAY = 0.025;         // cap at 25ms
const GROUND_REFLECTION_GAIN_BASE = 0.15;          // base reflection volume

// ============================================================================
// DIFFRACTION PARAMETERS
// ============================================================================

const DIFFRACTION_RAY_COUNT = 3;       // rays around the occluder edge
const DIFFRACTION_SPREAD_ANGLE = 0.4;  // radians — how far rays spread around edges
const DIFFRACTION_LPF_MIN = 400;       // Hz — heavily diffracted sound LPF
const DIFFRACTION_LPF_MAX = 8000;      // Hz — slightly diffracted sound LPF

// ============================================================================
// SPATIAL AUDIO ENVIRONMENT SYSTEM
// ============================================================================

/**
 * Create the spatial audio environment system.
 * Attaches to an existing AudioContext and provides environment processing.
 * 
 * @param {AudioContext} ctx - The Web Audio API context
 * @param {Object} config - Configuration options
 * @returns {Object} The environment system handle
 */
export function createSpatialEnvironment(ctx, config = {}) {
    const env = {
        ctx,
        // Current environment state
        currentZone: 'outdoor',
        targetZone: 'outdoor',
        zoneBlendTime: 0,
        zoneBlendDuration: config.zoneBlendDuration ?? 0.8, // seconds to crossfade
        
        // Ground reflection state
        groundHeight: 0,
        groundMaterial: 'stone',
        groundReflectionEnabled: config.groundReflection !== false,
        
        // Underwater state
        isUnderwater: false,
        waterSurfaceY: config.waterSurfaceY ?? null, // null = no water
        
        // Underground state (camera below ground/floor surface)
        isUnderground: false,
        groundSurfaceY: null, // detected Y of the ground surface above (when underground)
        
        // Listener cache (updated per frame)
        listenerPos: [0, 0, 0],
        listenerFwd: [0, 0, -1],
        
        // Raycast function (set by game code)
        _raycastFn: null,
        
        // Entity material lookup (set by game code)
        _getEntityMaterial: null,
        
        // Audio nodes
        _masterLPF: null,
        _masterHPF: null,
        _groundReflectionDelay: null,
        _groundReflectionGain: null,
        _groundReflectionLPF: null,
        
        // Environment detection cache (throttled)
        _envDetectTime: 0,
        _envDetectInterval: config.envDetectInterval ?? 500, // ms between env probes
        
        // Cached reverb IRs per environment (avoid regenerating)
        _reverbIRCache: new Map(),
        
        // Stats
        _stats: {
            zoneChanges: 0,
            groundReflections: 0,
            diffractionTests: 0,
        },
    };
    
    // Create master filter chain: source → masterHPF → masterLPF → destination
    // These shape the overall sound based on environment (e.g., underwater = heavy LPF)
    env._masterLPF = ctx.createBiquadFilter();
    env._masterLPF.type = 'lowpass';
    env._masterLPF.frequency.value = 20000;
    env._masterLPF.Q.value = 0.7;
    
    env._masterHPF = ctx.createBiquadFilter();
    env._masterHPF.type = 'highpass';
    env._masterHPF.frequency.value = 20;
    env._masterHPF.Q.value = 0.7;
    
    // Ground reflection chain: source → delay → LPF → gain → output
    if (env.groundReflectionEnabled) {
        env._groundReflectionDelay = ctx.createDelay(0.1);
        env._groundReflectionDelay.delayTime.value = 0.008;
        
        env._groundReflectionLPF = ctx.createBiquadFilter();
        env._groundReflectionLPF.type = 'lowpass';
        env._groundReflectionLPF.frequency.value = 4000;
        env._groundReflectionLPF.Q.value = 0.5;
        
        env._groundReflectionGain = ctx.createGain();
        env._groundReflectionGain.gain.value = GROUND_REFLECTION_GAIN_BASE;
        
        env._groundReflectionDelay.connect(env._groundReflectionLPF);
        env._groundReflectionLPF.connect(env._groundReflectionGain);
    }
    
    return env;
}

/**
 * Set the raycast function for environment probing.
 * Function signature: (origin: [x,y,z], direction: [x,y,z], maxDist: number) => { hit, distance, position, normal, entityId } | null
 */
export function setEnvironmentRaycast(env, fn) {
    if (!env) return;
    env._raycastFn = typeof fn === 'function' ? fn : null;
}

/**
 * Set the entity material lookup function.
 * Function signature: (entityId) => 'stone' | 'wood' | 'metal' | etc.
 */
export function setEntityMaterialLookup(env, fn) {
    if (!env) return;
    env._getEntityMaterial = typeof fn === 'function' ? fn : null;
}

/**
 * Set the water surface Y level. Listener below this = underwater.
 * Pass null to disable underwater detection.
 */
export function setWaterSurfaceY(env, y) {
    if (!env) return;
    env.waterSurfaceY = y;
}

// ============================================================================
// PER-FRAME UPDATE
// ============================================================================

/**
 * Update the environment system each frame.
 * Detects environment zone, updates ground reflection, handles underwater.
 * 
 * @param {Object} env - The environment system
 * @param {Array} listenerPos - [x, y, z] listener position
 * @param {Array} listenerFwd - [x, y, z] listener forward direction
 */
export function updateEnvironment(env, listenerPos, listenerFwd) {
    if (!env || !env.ctx || env.ctx.state !== 'running') return;
    
    env.listenerPos[0] = listenerPos[0];
    env.listenerPos[1] = listenerPos[1];
    env.listenerPos[2] = listenerPos[2];
    if (listenerFwd) {
        env.listenerFwd[0] = listenerFwd[0];
        env.listenerFwd[1] = listenerFwd[1];
        env.listenerFwd[2] = listenerFwd[2];
    }
    
    const now = performance.now();
    
    // Throttled environment detection (every 500ms — not per-frame)
    if (now - env._envDetectTime > env._envDetectInterval) {
        env._envDetectTime = now;
        detectEnvironmentZone(env);
        updateGroundReflection(env);
    }
    
    // Smooth zone transitions
    if (env.currentZone !== env.targetZone) {
        env.zoneBlendTime += (now - (env._lastUpdateTime || now)) / 1000;
        if (env.zoneBlendTime >= env.zoneBlendDuration) {
            env.currentZone = env.targetZone;
            env.zoneBlendTime = 0;
            // Transition complete — apply final zone fully (swap reverb IR + wet level)
            applyZoneImmediate(env);
        } else {
            applyZoneBlend(env);
        }
    }
    
    env._lastUpdateTime = now;
}

// ============================================================================
// ENVIRONMENT ZONE DETECTION
// ============================================================================

const _probeDir = [0, 0, 0]; // reusable

function detectEnvironmentZone(env) {
    // Skip auto-detection if zone is forced by game code
    if (env._forcedZone) return;
    
    // Check underwater first (cheapest)
    if (env.waterSurfaceY !== null && env.listenerPos[1] < env.waterSurfaceY) {
        if (env.targetZone !== 'underwater') {
            setTargetZone(env, 'underwater');
        }
        env.isUnderwater = true;
        return;
    }
    env.isUnderwater = false;
    
    if (!env._raycastFn) {
        // No raycast = assume outdoor
        if (env.targetZone === 'underwater') setTargetZone(env, 'outdoor');
        return;
    }
    
    // Probe upward: if ceiling close = indoor/cave, if open = outdoor
    _probeDir[0] = 0; _probeDir[1] = 1; _probeDir[2] = 0;
    const ceilingHit = env._raycastFn(env.listenerPos, _probeDir, 50);
    
    // Probe downward: needed for underground detection + ground info
    _probeDir[0] = 0; _probeDir[1] = -1; _probeDir[2] = 0;
    const floorHit = env._raycastFn(env.listenerPos, _probeDir, 50);
    
    // ── Underground detection ──
    // Underground = surface very close ABOVE us (floor/ground underside)
    // AND either: no floor below, OR floor below is far away (void under ground)
    // The normal check: if the surface above has normal.y < 0, it's the underside of a floor
    if (ceilingHit && ceilingHit.distance < 1.5) {
        const normalY = ceilingHit.normal ? ceilingHit.normal[1] : 0;
        const floorFar = !floorHit || floorHit.distance > 10;
        // Underside of floor (normal points down) OR very close ceiling with no floor
        if (normalY < -0.5 || (ceilingHit.distance < 0.8 && floorFar)) {
            env.isUnderground = true;
            env.groundSurfaceY = env.listenerPos[1] + ceilingHit.distance;
            setTargetZone(env, 'underground');
            return;
        }
    }
    env.isUnderground = false;
    env.groundSurfaceY = null;
    
    if (!ceilingHit) {
        // No ceiling = outdoor
        setTargetZone(env, 'outdoor');
        return;
    }
    
    const ceilingDist = ceilingHit.distance;
    
    // Probe sideways (4 cardinal directions) to estimate room size
    let wallHits = 0;
    let avgWallDist = 0;
    const dirs = [[1,0,0], [-1,0,0], [0,0,1], [0,0,-1]];
    for (let i = 0; i < dirs.length; i++) {
        _probeDir[0] = dirs[i][0]; _probeDir[1] = dirs[i][1]; _probeDir[2] = dirs[i][2];
        const hit = env._raycastFn(env.listenerPos, _probeDir, 50);
        if (hit) {
            wallHits++;
            avgWallDist += hit.distance;
        }
    }
    if (wallHits > 0) avgWallDist /= wallHits;
    
    // Classify environment
    if (wallHits >= 3 && avgWallDist < 4 && ceilingDist < 4) {
        setTargetZone(env, 'small_room');
    } else if (wallHits >= 3 && ceilingDist < 15) {
        if (avgWallDist > 15) {
            setTargetZone(env, 'large_hall');
        } else {
            setTargetZone(env, 'cave');
        }
    } else if (ceilingDist < 6) {
        setTargetZone(env, 'indoor');
    } else {
        setTargetZone(env, 'outdoor');
    }
}

function setTargetZone(env, zone) {
    if (env.targetZone === zone) return;
    env.targetZone = zone;
    env.zoneBlendTime = 0;
    env._stats.zoneChanges++;
}

// ============================================================================
// ZONE BLENDING (smooth transitions between environments)
// ============================================================================

function applyZoneBlend(env) {
    const t = Math.min(env.zoneBlendTime / env.zoneBlendDuration, 1.0);
    const fromPreset = ENVIRONMENT_PRESETS[env.currentZone] || ENVIRONMENT_PRESETS.outdoor;
    const toPreset = ENVIRONMENT_PRESETS[env.targetZone] || ENVIRONMENT_PRESETS.outdoor;
    
    // Interpolate master filters
    const lpf = fromPreset.masterLPF + (toPreset.masterLPF - fromPreset.masterLPF) * t;
    const hpf = fromPreset.masterHPF + (toPreset.masterHPF - fromPreset.masterHPF) * t;
    
    const now = env.ctx.currentTime;
    env._masterLPF.frequency.setTargetAtTime(lpf, now, 0.05);
    env._masterHPF.frequency.setTargetAtTime(hpf, now, 0.05);
    
    // Interpolate reverb wet level
    if (env._bridge?.reverbSend) {
        const wet = fromPreset.reverbWet + (toPreset.reverbWet - fromPreset.reverbWet) * t;
        env._bridge.reverbSend.gain.setTargetAtTime(wet, now, 0.05);
    }
    
    // Swap reverb IR at blend midpoint (avoids jarring switch at start or end)
    if (t > 0.5 && !env._irSwapped) {
        env._irSwapped = true;
        if (env._bridge?.convolver) {
            const ir = getEnvironmentIR(env, env.targetZone);
            try { env._bridge.convolver.buffer = ir; } catch {}
        }
    }
    if (t < 0.1) env._irSwapped = false; // reset for next transition
}

// ============================================================================
// GROUND REFLECTION
// ============================================================================

function updateGroundReflection(env) {
    if (!env.groundReflectionEnabled || !env._raycastFn) return;
    
    // Raycast downward to find ground
    _probeDir[0] = 0; _probeDir[1] = -1; _probeDir[2] = 0;
    const groundHit = env._raycastFn(env.listenerPos, _probeDir, 20);
    
    if (!groundHit) return;
    
    env.groundHeight = env.listenerPos[1] - groundHit.distance;
    
    // Determine ground material from entity
    let groundMat = 'stone'; // default
    if (groundHit.entityId != null && env._getEntityMaterial) {
        groundMat = env._getEntityMaterial(groundHit.entityId) || 'stone';
    }
    env.groundMaterial = groundMat;
    
    // Calculate reflection delay based on height above ground
    const heightAboveGround = groundHit.distance;
    const reflectionPath = heightAboveGround * 2; // sound travels down and back up
    const delay = Math.min(reflectionPath * GROUND_REFLECTION_DELAY_PER_METER, GROUND_REFLECTION_MAX_DELAY);
    
    // Material affects reflection: hard surfaces reflect more, soft absorb more
    const mat = MATERIAL_ABSORPTION[groundMat] || MATERIAL_ABSORPTION.default;
    const reflectionGain = GROUND_REFLECTION_GAIN_BASE * (1.0 - mat.abs);
    const reflectionLPF = 2000 + 6000 * (1.0 - mat.abs); // hard = brighter reflection
    
    // Apply to ground reflection chain (smoothed)
    const now = env.ctx.currentTime;
    if (env._groundReflectionDelay) {
        env._groundReflectionDelay.delayTime.setTargetAtTime(delay, now, 0.05);
    }
    if (env._groundReflectionGain) {
        env._groundReflectionGain.gain.setTargetAtTime(reflectionGain, now, 0.05);
    }
    if (env._groundReflectionLPF) {
        env._groundReflectionLPF.frequency.setTargetAtTime(reflectionLPF, now, 0.05);
    }
    
    env._stats.groundReflections++;
}

// ============================================================================
// MATERIAL-BASED OCCLUSION
// Enhanced version: returns { occlusion, lpfMult } based on hit entity material
// ============================================================================

/**
 * Compute material-aware occlusion between a source and the listener.
 * Returns { factor: 0-1, lpfMult: 0-1 } where factor affects volume,
 * lpfMult affects high-frequency content (material filtering).
 * 
 * @param {Object} env - The environment system
 * @param {Array} srcPos - [x, y, z] sound source position
 * @returns {{ factor: number, lpfMult: number }}
 */
export function computeOcclusion(env, srcPos) {
    if (!env._raycastFn) return { factor: 1.0, lpfMult: 1.0 };
    
    const lx = env.listenerPos[0], ly = env.listenerPos[1], lz = env.listenerPos[2];
    const dx = lx - srcPos[0], dy = ly - srcPos[1], dz = lz - srcPos[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < 0.5) return { factor: 1.0, lpfMult: 1.0 };
    
    const invDist = 1.0 / dist;
    _probeDir[0] = dx * invDist; _probeDir[1] = dy * invDist; _probeDir[2] = dz * invDist;
    
    const hit = env._raycastFn(srcPos, _probeDir, dist);
    
    if (!hit || hit.distance >= dist - 0.3) {
        // Clear line of sight
        return { factor: 1.0, lpfMult: 1.0 };
    }
    
    // Determine occluder material
    let matKey = 'default';
    if (hit.entityId != null && env._getEntityMaterial) {
        matKey = env._getEntityMaterial(hit.entityId) || 'default';
    }
    const mat = MATERIAL_ABSORPTION[matKey] || MATERIAL_ABSORPTION.default;
    
    // Graduated occlusion: occluder close to listener = heavier
    const occluderRatio = hit.distance / dist; // 0=at source, 1=at listener
    const proximityFactor = 0.15 + 0.35 * occluderRatio;
    
    // Material-based: absorptive materials block less, reflective block more
    // Stone wall: factor ≈ 0.15-0.50 (heavy block)
    // Wood door: factor ≈ 0.30-0.65 (moderate block)
    // Carpet/curtain: factor ≈ 0.50-0.85 (light block — soft materials transmit more)
    const materialTransmission = mat.abs * 0.6 + 0.15; // more absorptive = more transmission
    const factor = Math.min(proximityFactor + materialTransmission, 0.95);
    
    // LPF multiplier: hard surfaces reflect highs back, soft surfaces absorb them
    const lpfMult = mat.lpfMult;
    
    return { factor, lpfMult };
}

// ============================================================================
// DIFFRACTION (sound bending around edges)
// ============================================================================

/**
 * Compute diffraction factor for partially occluded sources.
 * Casts multiple rays slightly offset from the direct path.
 * If some rays get through, the sound is partially diffracted (not fully blocked).
 * 
 * @param {Object} env - The environment system
 * @param {Array} srcPos - [x, y, z] sound source position
 * @returns {{ diffraction: number, lpfMult: number }} 0=fully blocked, 1=clear
 */
export function computeDiffraction(env, srcPos) {
    if (!env._raycastFn) return { diffraction: 1.0, lpfMult: 1.0 };
    
    const lx = env.listenerPos[0], ly = env.listenerPos[1], lz = env.listenerPos[2];
    const dx = lx - srcPos[0], dy = ly - srcPos[1], dz = lz - srcPos[2];
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < 1.0) return { diffraction: 1.0, lpfMult: 1.0 };
    
    const invDist = 1.0 / dist;
    const dirX = dx * invDist, dirY = dy * invDist, dirZ = dz * invDist;
    
    // Compute a perpendicular basis for spreading rays
    // up = cross(dir, [0,1,0]) if dir isn't vertical, else cross(dir, [1,0,0])
    let upX, upY, upZ;
    if (Math.abs(dirY) > 0.9) {
        upX = dirZ; upY = 0; upZ = -dirX;
    } else {
        upX = -dirZ * 0; upY = dirZ * dirX; upZ = 0;
        // cross(dir, [0,1,0]) = [dirZ, 0, -dirX]
        upX = dirZ; upY = 0; upZ = -dirX;
    }
    const upLen = Math.sqrt(upX * upX + upY * upY + upZ * upZ) || 1;
    upX /= upLen; upY /= upLen; upZ /= upLen;
    
    // Also compute a right vector: cross(dir, up)
    const rightX = dirY * upZ - dirZ * upY;
    const rightY = dirZ * upX - dirX * upZ;
    const rightZ = dirX * upY - dirY * upX;
    
    let clearRays = 0;
    const spread = DIFFRACTION_SPREAD_ANGLE;
    
    // Test rays in a cross pattern around the direct path
    const offsets = [
        [0, spread],     // up
        [0, -spread],    // down
        [spread, 0],     // right
        [-spread, 0],    // left
        [spread * 0.5, spread * 0.5],   // diagonal
        [-spread * 0.5, -spread * 0.5], // diagonal
    ];
    
    const totalRays = offsets.length;
    for (let i = 0; i < totalRays; i++) {
        const [offR, offU] = offsets[i];
        _probeDir[0] = dirX + rightX * offR + upX * offU;
        _probeDir[1] = dirY + rightY * offR + upY * offU;
        _probeDir[2] = dirZ + rightZ * offR + upZ * offU;
        // Normalize
        const len = Math.sqrt(_probeDir[0] ** 2 + _probeDir[1] ** 2 + _probeDir[2] ** 2) || 1;
        _probeDir[0] /= len; _probeDir[1] /= len; _probeDir[2] /= len;
        
        const hit = env._raycastFn(srcPos, _probeDir, dist * 1.2);
        if (!hit || hit.distance >= dist - 0.5) {
            clearRays++;
        }
    }
    
    env._stats.diffractionTests++;
    
    const diffraction = clearRays / totalRays;
    // Diffracted sound loses high frequencies (bends around = LPF)
    const lpfMult = diffraction < 0.5
        ? DIFFRACTION_LPF_MIN + (DIFFRACTION_LPF_MAX - DIFFRACTION_LPF_MIN) * (diffraction * 2)
        : DIFFRACTION_LPF_MAX;
    
    return { diffraction, lpfMult: diffraction < 1.0 ? lpfMult / 20000 : 1.0 };
}

// ============================================================================
// COMBINED OCCLUSION + DIFFRACTION
// Single call that game code uses — returns final occlusion factor
// ============================================================================

/**
 * Compute full spatial occlusion for a sound source.
 * Combines material-based occlusion with edge diffraction.
 * Returns 0-1 where 0 = fully blocked, 1 = clear.
 * 
 * @param {Object} env - The environment system
 * @param {Array} srcPos - [x, y, z] sound source position
 * @returns {number} Combined occlusion factor (0-1)
 */
export function computeFullOcclusion(env, srcPos) {
    const occ = computeOcclusion(env, srcPos);
    
    // If direct path is clear, no need for diffraction test
    if (occ.factor >= 0.95) return 1.0;
    
    // Direct path blocked — check if sound diffracts around the edge
    const diff = computeDiffraction(env, srcPos);
    
    // Blend: if some rays get through, sound is partially audible via diffraction
    // Diffracted sound is quieter and darker than direct sound
    const diffractedVolume = diff.diffraction * 0.6; // diffracted sound is 60% as loud
    
    // Final: take the better of direct (occluded) and diffracted paths
    return Math.max(occ.factor, diffractedVolume);
}

// ============================================================================
// DYNAMIC REVERB IR GENERATION
// ============================================================================

/**
 * Generate a procedural impulse response for a given environment.
 * Cached per environment to avoid regeneration.
 * 
 * @param {Object} env - The environment system
 * @param {string} zoneName - Environment zone name
 * @returns {AudioBuffer} The generated IR
 */
export function getEnvironmentIR(env, zoneName) {
    if (env._reverbIRCache.has(zoneName)) {
        return env._reverbIRCache.get(zoneName);
    }
    
    const preset = ENVIRONMENT_PRESETS[zoneName] || ENVIRONMENT_PRESETS.outdoor;
    const ctx = env.ctx;
    const sampleRate = ctx.sampleRate;
    const length = Math.floor(sampleRate * preset.reverbDuration);
    const buffer = ctx.createBuffer(2, length, sampleRate);
    
    for (let ch = 0; ch < 2; ch++) {
        const data = buffer.getChannelData(ch);
        for (let i = 0; i < length; i++) {
            const t = i / sampleRate;
            const envelope = Math.exp(-preset.reverbDecay * t);
            const lpfAmount = 1.0 - (t / preset.reverbDuration) * 0.7;
            const noise = uniformDistribution(-1, 1, Math.random) * lpfAmount;
            data[i] = noise * envelope;
        }
        // 1-pole smoothing (LPF on the IR itself)
        const alpha = Math.exp(-2 * Math.PI * preset.reverbLPF / sampleRate);
        for (let i = 1; i < length; i++) {
            data[i] = data[i] * (1 - alpha) + data[i - 1] * alpha;
        }
    }
    
    env._reverbIRCache.set(zoneName, buffer);
    return buffer;
}

// ============================================================================
// CONNECT TO AUDIO BRIDGE
// ============================================================================

/**
 * Connect the environment system's master filters into the audio bridge's output chain.
 * Call once after both bridge and environment are created.
 * 
 * Inserts: bridge.masterGain → env.masterHPF → env.masterLPF → ctx.destination
 * Also connects ground reflection send from bridge.compressor.
 * 
 * @param {Object} env - The environment system
 * @param {Object} bridge - The audio bridge
 */
export function connectToBridge(env, bridge) {
    if (!env || !bridge || !bridge.masterGain) return;
    
    const ctx = env.ctx;
    
    // Bridge chain is: masterGain → softClipper → destination (+ masterGain → analyser parallel)
    // We insert env filters AFTER softClipper (or masterGain if no softClipper):
    //   masterGain → softClipper → HPF → LPF → destination
    //   masterGain → analyser (parallel, unchanged)
    const lastNode = bridge.softClipper || bridge.masterGain;
    
    // Disconnect the last node from destination
    try { lastNode.disconnect(ctx.destination); } catch {}
    try { lastNode.disconnect(); } catch {}
    
    // If softClipper exists, reconnect masterGain → softClipper (disconnect may have broken it)
    if (bridge.softClipper) {
        try { bridge.masterGain.disconnect(bridge.softClipper); } catch {}
        bridge.masterGain.connect(bridge.softClipper);
        bridge.softClipper.connect(env._masterHPF);
    } else {
        bridge.masterGain.connect(env._masterHPF);
    }
    env._masterHPF.connect(env._masterLPF);
    env._masterLPF.connect(ctx.destination);
    
    // Re-connect analyser in parallel (if it was disconnected)
    if (bridge.analyser) {
        try { bridge.masterGain.connect(bridge.analyser); } catch {}
    }
    
    // Connect ground reflection send: compressor → groundDelay chain → masterLPF
    if (env.groundReflectionEnabled && env._groundReflectionGain && bridge.compressor) {
        bridge.compressor.connect(env._groundReflectionDelay);
        env._groundReflectionGain.connect(env._masterLPF);
    }
    
    // Store bridge reference BEFORE applying zone (needs bridge for reverb IR + wet level)
    env._bridge = bridge;
    
    // Set initial zone
    applyZoneImmediate(env);
}

/**
 * Apply zone parameters immediately (no blend).
 */
function applyZoneImmediate(env) {
    const preset = ENVIRONMENT_PRESETS[env.currentZone] || ENVIRONMENT_PRESETS.outdoor;
    const now = env.ctx.currentTime;
    env._masterLPF.frequency.setValueAtTime(preset.masterLPF, now);
    env._masterHPF.frequency.setValueAtTime(preset.masterHPF, now);
    
    // Update reverb IR if bridge has convolver
    if (env._bridge?.convolver) {
        const ir = getEnvironmentIR(env, env.currentZone);
        try { env._bridge.convolver.buffer = ir; } catch {}
    }
    
    // Update reverb wet level
    if (env._bridge?.reverbSend) {
        env._bridge.reverbSend.gain.setValueAtTime(preset.reverbWet, now);
    }
}

// ============================================================================
// MATERIAL LOOKUP HELPERS
// ============================================================================

/**
 * Get absorption data for a material key.
 * @param {string} materialKey - Material name (stone, wood, metal, etc.)
 * @returns {{ abs: number, lpfMult: number, name: string }}
 */
export function getMaterialAbsorption(materialKey) {
    return MATERIAL_ABSORPTION[materialKey] || MATERIAL_ABSORPTION.default;
}

/**
 * Get all available environment presets.
 * @returns {Object} Map of preset name → preset data
 */
export function getEnvironmentPresets() {
    return { ...ENVIRONMENT_PRESETS };
}

/**
 * Force a specific environment zone (overrides auto-detection).
 * Pass null to re-enable auto-detection.
 */
export function forceEnvironmentZone(env, zoneName) {
    if (!env) return;
    if (zoneName === null) {
        env._forcedZone = null;
        return;
    }
    if (ENVIRONMENT_PRESETS[zoneName]) {
        env._forcedZone = zoneName;
        setTargetZone(env, zoneName);
    }
}

/**
 * Get current environment stats.
 */
export function getEnvironmentStats(env) {
    if (!env) return null;
    return {
        currentZone: env.currentZone,
        targetZone: env.targetZone,
        isUnderwater: env.isUnderwater,
        isUnderground: env.isUnderground,
        groundSurfaceY: env.groundSurfaceY,
        groundMaterial: env.groundMaterial,
        groundHeight: env.groundHeight,
        ...env._stats,
    };
}

/**
 * Destroy the environment system and release all audio nodes.
 */
export function destroySpatialEnvironment(env) {
    if (!env) return;
    try { env._masterLPF?.disconnect(); } catch {}
    try { env._masterHPF?.disconnect(); } catch {}
    try { env._groundReflectionDelay?.disconnect(); } catch {}
    try { env._groundReflectionGain?.disconnect(); } catch {}
    try { env._groundReflectionLPF?.disconnect(); } catch {}
    env._reverbIRCache.clear();
    env._raycastFn = null;
    env._getEntityMaterial = null;
    env._bridge = null;
}
