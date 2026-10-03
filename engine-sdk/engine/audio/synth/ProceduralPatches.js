// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ProceduralPatches.js - Real-time procedural sound patches for particle substances
 * 
 * Each patch is a factory: (ctx, destination, params) => { stop(), update?(params) }
 *   ctx         — AudioContext
 *   destination — AudioNode (pre-spatialized via PannerNode)
 *   params      — { volume, pitch, speed, temperature, ... }
 * 
 * Impact patches are one-shot (auto-stop).
 * Ambient patches loop until stop() is called, and support update() for real-time modulation.
 */

import { FOOTSTEP_PATCHES } from './FootstepPatches.js';
import { BODY_FOLEY_PATCHES } from './BodyFoleyPatches.js';
import { uniformDistribution } from '../../core/math/MathRandom.js';

// ============================================================================
// SHARED HELPERS
// ============================================================================

/** Lazily create a shared 2-second white noise buffer */
function getNoiseBuffer(ctx) {
    if (!ctx._sharedNoiseBuffer) {
        const size = ctx.sampleRate * 2;
        const buf = ctx.createBuffer(1, size, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < size; i++) data[i] = randRange(-1, 1);
        ctx._sharedNoiseBuffer = buf;
    }
    return ctx._sharedNoiseBuffer;
}

/** Quick noise source */
function noiseSource(ctx) {
    const src = ctx.createBufferSource();
    src.buffer = getNoiseBuffer(ctx);
    src.loop = true;
    return src;
}

/** One-shot noise (auto-stops) */
function noiseShot(ctx, duration) {
    const src = ctx.createBufferSource();
    src.buffer = getNoiseBuffer(ctx);
    src.start(ctx.currentTime);
    src.stop(ctx.currentTime + duration + 0.01);
    return src;
}

/** Quick envelope: attack → hold → decay */
function envelope(ctx, volume, attack, hold, decay) {
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(volume, t + attack);
    g.gain.setValueAtTime(volume, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.001, t + attack + hold + decay);
    return g;
}

function clamp(v, min, max) {
    return Math.min(Math.max(v, min), max);
}

function randRange(min, max) {
    return uniformDistribution(min, max, Math.random);
}

// ============================================================================
// IMPACT PATCHES (one-shot, auto-stop)
// ============================================================================

/**
 * Water/fluid impact — velocity-driven splat/drip/splash.
 *
 * Sound design based on real water acoustics:
 *   - "Plop" body: fast sine pitch-sweep downward (Helmholtz cavity resonance).
 *     A water droplet traps an air bubble on impact; the bubble oscillates at a
 *     frequency that sweeps down as it grows. Duration ~15-40ms.
 *   - "Spray" transient: ultra-short highpass noise burst (<20ms) for the
 *     broadband crack of water hitting a surface. Only audible at higher speeds.
 *   - Bubble resonances: at high speed, 1-3 random short sine pips simulate
 *     secondary bubbles breaking the surface.
 *
 * Speed mapping:
 *   slow  (< 1)  → gentle drip: mostly plop body, minimal spray
 *   medium (1-4)  → splat: plop + moderate spray
 *   fast  (> 4)  → full splash: plop + loud spray + bubble pips
 */
export function impact_fluid(ctx, dest, p) {
    const t = ctx.currentTime;
    const baseVol = p.volume ?? 0.5;
    const pitch = p.pitch ?? 1.0;
    const speed = p.speed ?? 3;
    const spd = Math.min(speed / 6, 2.0);
    const temp = Math.min((p.temperature ?? 300) / 1000, 1.0);
    const quality = clamp(p.quality ?? 1.0, 0, 1);

    const mappedSplashRate = Number.isFinite(p.splashRate) ? clamp(p.splashRate, 0.2, 40) : null;
    const mappedDropPitch = Number.isFinite(p.dropPitch) ? clamp(p.dropPitch, 80, 1800) : null;
    const mappedFlowLevel = Number.isFinite(p.flowLevel) ? clamp(p.flowLevel, 0, 2.2) : null;
    const mappedBrightness = Number.isFinite(p.brightness) ? clamp(p.brightness, 450, 8000) : null;
    const mappedImpactGain = Number.isFinite(p.impactGain) ? clamp(p.impactGain, 0.2, 2.2) : 1.0;

    const vol = baseVol * mappedImpactGain;
    const splashEnergy = mappedSplashRate != null
        ? clamp(mappedSplashRate / 16, 0.12, 2.4)
        : (0.22 + spd * 0.55);
    const flowLevel = mappedFlowLevel != null
        ? mappedFlowLevel
        : clamp(0.18 + Math.min((p.density ?? 0) * 0.012, 1.2), 0.08, 2.0);
    const bubbleToneBias = 1.0 - temp * 0.2;

    // --- Layer 1: "Plop" body (always present) ---
    // Fast downward sine sweep simulating cavity resonance.
    // Higher speed → higher start frequency (bigger impact = higher initial resonance)
    const plopCenter = mappedDropPitch != null ? mappedDropPitch : (540 + spd * 360 + flowLevel * 130);
    const plopStartHz = clamp((plopCenter + randRange(0, 220)) * pitch, 120, 2200);
    const plopEndHz = clamp((65 + flowLevel * 35 + randRange(0, 45)) * pitch, 35, 420);
    const plopDur = 0.017 + 0.024 / Math.max(spd, 0.3) + flowLevel * 0.006;
    const plopOsc = ctx.createOscillator();
    plopOsc.type = 'sine';
    plopOsc.frequency.setValueAtTime(plopStartHz, t);
    plopOsc.frequency.exponentialRampToValueAtTime(plopEndHz, t + plopDur);
    const plopGain = ctx.createGain();
    // Sharp attack, fast exponential decay — the "plop" is a transient
    plopGain.gain.setValueAtTime(vol * 0.8, t);
    plopGain.gain.exponentialRampToValueAtTime(0.001, t + plopDur);
    plopOsc.connect(plopGain).connect(dest);
    plopOsc.start(t);
    plopOsc.stop(t + plopDur + 0.01);

    // --- Layer 2: "Spray" transient (only for fast impacts, saves CPU for drips) ---
    if (splashEnergy > 0.18) {
        const sprayDur = 0.006 + spd * 0.008 + splashEnergy * 0.004;
        const spraySrc = noiseShot(ctx, sprayDur + 0.01);
        const sprayHP = ctx.createBiquadFilter();
        sprayHP.type = 'highpass';
        sprayHP.frequency.value = (mappedBrightness ?? (2400 + spd * 1700 + flowLevel * 450)) * pitch;
        sprayHP.Q.value = 0.7;
        const sprayNotch = ctx.createBiquadFilter();
        sprayNotch.type = 'peaking';
        sprayNotch.frequency.value = 1600;
        sprayNotch.Q.value = 1.2;
        sprayNotch.gain.value = -5;
        const sprayGain = ctx.createGain();
        sprayGain.gain.setValueAtTime(vol * Math.min(0.18 + spd * 0.25 + splashEnergy * 0.24, 0.95), t);
        sprayGain.gain.exponentialRampToValueAtTime(0.001, t + sprayDur);
        spraySrc.connect(sprayHP).connect(sprayNotch).connect(sprayGain).connect(dest);
    }

    // --- Layer 3: Bubble pips (max 2 for CPU, skip for distant/low-quality) ---
    if (quality > 0.28 && splashEnergy > 0.2) {
        const bubbleCount = Math.floor(clamp(1 + splashEnergy * 2.6 + flowLevel * 0.6, 1, 5));
        for (let i = 0; i < bubbleCount; i++) {
            const delay = 0.003 + randRange(0, 0.03) + i * 0.0015;
            const bubbleRadiusMm = randRange(0.8, 2.4) / (1.0 + spd * 0.25);
            const bFreq = clamp((1200 / bubbleRadiusMm) * pitch * bubbleToneBias, 180, 1800);
            const bDur = 0.01 + randRange(0, 0.02);
            const bOsc = ctx.createOscillator();
            bOsc.type = 'sine';
            bOsc.frequency.setValueAtTime(bFreq, t + delay);
            bOsc.frequency.exponentialRampToValueAtTime(bFreq * 0.5, t + delay + bDur);
            const bGain = ctx.createGain();
            bGain.gain.setValueAtTime(0, t);
            bGain.gain.setValueAtTime(vol * 0.2, t + delay);
            bGain.gain.exponentialRampToValueAtTime(0.001, t + delay + bDur);
            bOsc.connect(bGain).connect(dest);
            bOsc.start(t + delay);
            bOsc.stop(t + delay + bDur + 0.01);
        }
    }

    // --- Layer 4: Wet tail smear (low-mid noise ring) ---
    if (flowLevel > 0.12) {
        const wetDur = 0.035 + flowLevel * 0.04;
        const wet = noiseShot(ctx, wetDur + 0.03);
        const wetBP = ctx.createBiquadFilter();
        wetBP.type = 'bandpass';
        wetBP.frequency.value = (350 + flowLevel * 340 + temp * 220) * pitch;
        wetBP.Q.value = 0.9;
        const wetEnv = ctx.createGain();
        wetEnv.gain.setValueAtTime(vol * (0.06 + flowLevel * 0.08), t + 0.003);
        wetEnv.gain.exponentialRampToValueAtTime(0.001, t + wetDur);
        wet.connect(wetBP).connect(wetEnv).connect(dest);
    }

    return { stop() {} };
}

/** Metal clang — multi-partial ring + noise transient */
export function impact_metal(ctx, dest, p) {
    const t = ctx.currentTime;
    const mappedImpactGain = Number.isFinite(p.impactGain) ? clamp(p.impactGain, 0.2, 2.4) : 1.0;
    const mappedRingTime = Number.isFinite(p.ringTime) ? clamp(p.ringTime, 0.55, 2.0) : 1.0;
    const mappedBrightness = Number.isFinite(p.brightness) ? clamp(p.brightness, 0.65, 1.8) : 1.0;
    const vol = (p.volume ?? 0.6) * mappedImpactGain;
    const pitch = p.pitch ?? 1.0;
    const spd = Math.min((p.speed ?? 3) / 6, 2.0);
    const temp = Math.min((p.temperature ?? 300) / 1000, 1.0);
    const baseFreq = (180 + randRange(0, 280)) * (0.9 + mappedBrightness * 0.35);

    // Speed affects ring time (harder hit = longer ring) and transient intensity
    const ringScale = (0.8 + spd * 0.3) * mappedRingTime;
    // Temperature shifts partials up (hot metal = higher pitched overtones)
    const tempShift = 1.0 + temp * 0.3;

    // Inharmonic partials (metallic character)
    // Synthesis LOD: distant sounds (quality < 0.5) use fewer partials to save CPU
    const quality = p.quality ?? 1.0;
    const allModes = [
        { ratio: 1.0, amp: 1.0, decay: 1.0 },
        { ratio: 1.58, amp: 0.72, decay: 0.78 },
        { ratio: 2.41, amp: 0.5, decay: 0.62 },
        { ratio: 3.76, amp: 0.36, decay: 0.5 },
        { ratio: 5.12, amp: 0.24, decay: 0.42 },
    ];
    const modes = quality < 0.5 ? allModes.slice(0, 3) : allModes;
    const strikePos = randRange(0.22, 0.78);
    for (let i = 0; i < modes.length; i++) {
        const mode = modes[i];
        const freq = baseFreq * mode.ratio * pitch * tempShift;
        const osc = ctx.createOscillator();
        osc.type = i === 0 ? 'triangle' : 'sine';
        osc.frequency.value = freq;
        const env = ctx.createGain();
        const excWeight = 0.35 + 0.65 * Math.abs(Math.sin(Math.PI * strikePos * (i + 1)));
        const pVol = vol * mode.amp * excWeight;
        const freqNorm = clamp(freq / 4000, 0, 1.2);
        const ringTime = (0.46 * mode.decay * ringScale) / (1.0 + freqNorm * 0.9);
        env.gain.setValueAtTime(pVol, t);
        env.gain.exponentialRampToValueAtTime(0.001, t + ringTime);
        osc.connect(env).connect(dest);
        osc.start(t); osc.stop(t + ringTime + 0.05);
    }

    // Attack transient (harder hit = louder transient)
    const n = noiseShot(ctx, 0.03);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = (3000 + temp * 2000) * mappedBrightness;
    const nEnv = ctx.createGain();
    nEnv.gain.setValueAtTime(vol * (0.3 + spd * 0.2), t);
    nEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.015);
    n.connect(hp).connect(nEnv).connect(dest);

    return { stop() {} };
}

/** Glass clink — high FM harmonics, crystalline */
export function impact_glass(ctx, dest, p) {
    const t = ctx.currentTime;
    const mappedImpactGain = Number.isFinite(p.impactGain) ? clamp(p.impactGain, 0.2, 2.2) : 1.0;
    const mappedShimmer = Number.isFinite(p.shimmerDepth) ? clamp(p.shimmerDepth, 0.5, 2.0) : 1.0;
    const vol = (p.volume ?? 0.5) * mappedImpactGain;
    const pitch = p.pitch ?? 1.0;
    const spd = Math.min((p.speed ?? 3) / 6, 2.0);
    const temp = Math.min((p.temperature ?? 300) / 1000, 1.0);
    const baseFreq = (1200 + randRange(0, 600)) * (1.0 + randRange(-0.01, 0.01));

    // Speed affects FM modulation depth (harder = more complex shimmer)
    const modDepth = baseFreq * (1.5 + spd * 0.5) * mappedShimmer;
    // Temperature affects shimmer duration (hot glass rings longer)
    const shimmerDur = (0.25 + temp * 0.1) * (0.9 + mappedShimmer * 0.16);
    // Synthesis LOD: skip FM modulator for distant sounds
    const quality = p.quality ?? 1.0;

    const carrier = ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.value = baseFreq * pitch;

    if (quality >= 0.5) {
        // Full quality: FM shimmer (carrier + modulator)
        const mod = ctx.createOscillator();
        mod.type = 'sine';
        mod.frequency.setValueAtTime(baseFreq * 3.35 * pitch, t);
        mod.frequency.exponentialRampToValueAtTime(baseFreq * 2.6 * pitch, t + shimmerDur);
        const modGain = ctx.createGain();
        modGain.gain.setValueAtTime(modDepth, t);
        modGain.gain.exponentialRampToValueAtTime(5, t + shimmerDur);
        mod.connect(modGain);
        modGain.connect(carrier.frequency);
        mod.start(t); mod.stop(t + shimmerDur + 0.1);
    }

    if (quality > 0.35) {
        const overtone = ctx.createOscillator();
        overtone.type = 'sine';
        overtone.frequency.value = baseFreq * 2.62 * pitch;
        const overtoneEnv = ctx.createGain();
        overtoneEnv.gain.setValueAtTime(vol * 0.12, t);
        overtoneEnv.gain.exponentialRampToValueAtTime(0.001, t + shimmerDur * 0.7);
        overtone.connect(overtoneEnv).connect(dest);
        overtone.start(t);
        overtone.stop(t + shimmerDur + 0.05);
    }

    const env = ctx.createGain();
    env.gain.setValueAtTime(vol, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + shimmerDur + 0.05);
    carrier.connect(env).connect(dest);

    const stopTime = shimmerDur + 0.1;
    carrier.start(t); carrier.stop(t + stopTime);

    // Bright transient (harder hit = louder transient)
    const n = noiseShot(ctx, 0.02);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 5000 + temp * 2000;
    const nEnv = ctx.createGain();
    nEnv.gain.setValueAtTime(vol * (0.2 + spd * 0.15), t);
    nEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.008);
    n.connect(hp).connect(nEnv).connect(dest);

    return { stop() {} };
}

/** Stone/debris thud — low filtered noise + crack + sub thump */
export function impact_stone(ctx, dest, p) {
    const t = ctx.currentTime;
    const mappedImpactGain = Number.isFinite(p.impactGain) ? clamp(p.impactGain, 0.2, 2.2) : 1.0;
    const mappedHardness = Number.isFinite(p.hardness) ? clamp(p.hardness, 0.55, 1.9) : 1.0;
    const vol = (p.volume ?? 0.6) * mappedImpactGain;
    const pitch = p.pitch ?? 1.0;
    const spd = Math.min((p.speed ?? 3) / 6, 2.0);

    // Speed affects thud brightness and sub intensity
    const lpFreqStart = (360 + spd * 220 * mappedHardness) * pitch;

    // Layer 1: Low thud — resonant lowpass noise (the "weight" of the stone)
    const n = noiseShot(ctx, 0.2);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(lpFreqStart, t);
    lp.frequency.exponentialRampToValueAtTime(80, t + 0.12);
    lp.Q.value = 3;
    const env = ctx.createGain();
    env.gain.setValueAtTime(vol, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    n.connect(lp).connect(env).connect(dest);

    // Layer 2: Mid-freq crack transient (sharp stone-on-stone contact)
    const crack = noiseShot(ctx, 0.025);
    const crackBP = ctx.createBiquadFilter();
    crackBP.type = 'bandpass'; crackBP.frequency.value = (1700 + spd * 720 * mappedHardness) * pitch; crackBP.Q.value = 1.3 + mappedHardness * 0.45;
    const crackEnv = ctx.createGain();
    crackEnv.gain.setValueAtTime(vol * (0.25 + spd * 0.15), t);
    crackEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
    crack.connect(crackBP).connect(crackEnv).connect(dest);

    // Layer 3: Low modal pair (more natural than single sine thump)
    const subModes = [95, 145];
    for (let i = 0; i < subModes.length; i++) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(subModes[i] * pitch, t);
        osc.frequency.exponentialRampToValueAtTime((subModes[i] * 0.55) * pitch, t + 0.08 + i * 0.015);
        const oEnv = ctx.createGain();
        oEnv.gain.setValueAtTime(vol * (0.22 + spd * 0.16) * (i === 0 ? 1.0 : 0.55), t);
        oEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.09 + i * 0.02);
        osc.connect(oEnv).connect(dest);
        osc.start(t);
        osc.stop(t + 0.13 + i * 0.02);
    }

    return { stop() {} };
}

/** Wood knock — multi-mode resonant body + knock transient */
export function impact_wood(ctx, dest, p) {
    const t = ctx.currentTime;
    const mappedImpactGain = Number.isFinite(p.impactGain) ? clamp(p.impactGain, 0.2, 2.0) : 1.0;
    const mappedHollow = Number.isFinite(p.hollow) ? clamp(p.hollow, 0.5, 1.8) : 1.0;
    const vol = (p.volume ?? 0.5) * mappedImpactGain;
    const pitch = p.pitch ?? 1.0;
    const spd = Math.min((p.speed ?? 3) / 6, 2.0);
    const freq = (190 + randRange(0, 115)) * (0.92 + mappedHollow * 0.15) * pitch;

    // Speed affects resonant body duration and knock intensity
    const bodyDur = 0.12 + spd * 0.06;
    const strikePos = randRange(0.18, 0.82);
    const mode1Amp = 0.45 + 0.35 * Math.abs(Math.sin(Math.PI * strikePos));
    const mode2Amp = 0.2 + 0.25 * Math.abs(Math.sin(2 * Math.PI * strikePos));

    // Layer 1: Primary resonant mode (fundamental body tone)
    const osc1 = ctx.createOscillator();
    osc1.type = 'triangle';
    osc1.frequency.value = freq;
    const bp1 = ctx.createBiquadFilter();
    bp1.type = 'bandpass'; bp1.frequency.value = freq; bp1.Q.value = 7 + mappedHollow * 2.2;
    const env1 = ctx.createGain();
    env1.gain.setValueAtTime(vol * mode1Amp, t);
    env1.gain.exponentialRampToValueAtTime(0.001, t + bodyDur);
    osc1.connect(bp1).connect(env1).connect(dest);
    osc1.start(t); osc1.stop(t + bodyDur + 0.03);

    // Layer 2: Second resonant mode (~2.5x fundamental — hollow "tok" overtone)
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = freq * 2.47;
    const bp2 = ctx.createBiquadFilter();
    bp2.type = 'bandpass'; bp2.frequency.value = freq * 2.47; bp2.Q.value = 8.5 + mappedHollow * 2.0;
    const env2 = ctx.createGain();
    env2.gain.setValueAtTime(vol * mode2Amp, t);
    env2.gain.exponentialRampToValueAtTime(0.001, t + bodyDur * 0.7);
    osc2.connect(bp2).connect(env2).connect(dest);
    osc2.start(t); osc2.stop(t + bodyDur + 0.03);

    // Layer 3: Knock transient (harder = louder + brighter)
    const n = noiseShot(ctx, 0.025);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1500 + spd * 500;
    const nEnv = ctx.createGain();
    nEnv.gain.setValueAtTime(vol * (0.4 + spd * 0.2), t);
    nEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
    n.connect(lp).connect(nEnv).connect(dest);

    return { stop() {} };
}

/** Ice crack — sharp noise + crystalline inharmonic pings */
export function impact_ice(ctx, dest, p) {
    const t = ctx.currentTime;
    const mappedImpactGain = Number.isFinite(p.impactGain) ? clamp(p.impactGain, 0.2, 2.2) : 1.0;
    const mappedBrittleness = Number.isFinite(p.brittleness) ? clamp(p.brittleness, 0.55, 2.0) : 1.0;
    const vol = (p.volume ?? 0.5) * mappedImpactGain;
    const pitch = p.pitch ?? 1.0;
    const spd = Math.min((p.speed ?? 3) / 6, 2.0);
    const temp = Math.min((p.temperature ?? 200) / 500, 1.0);

    // Speed affects crack sharpness and duration
    const crackDur = 0.035 + spd * 0.02;
    // Temperature near melting makes crack softer (approaching water behavior)
    const crackIntensity = (0.6 + (1.0 - temp) * 0.2) * (0.8 + mappedBrittleness * 0.35);
    const brittleQ = (1.0 + (1.0 - temp) * 2.5) * mappedBrittleness;

    // Pre-crack chirp (cold ice starts with a sharp brittle chirp)
    const chirp = ctx.createOscillator();
    chirp.type = 'triangle';
    chirp.frequency.setValueAtTime((4800 + spd * 1200) * pitch, t);
    chirp.frequency.exponentialRampToValueAtTime((1500 + spd * 500) * pitch, t + 0.012);
    const chirpEnv = ctx.createGain();
    chirpEnv.gain.setValueAtTime(vol * 0.16 * (1.0 - temp * 0.6), t);
    chirpEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
    chirp.connect(chirpEnv).connect(dest);
    chirp.start(t);
    chirp.stop(t + 0.02);

    // Layer 1: Crack — sharp HP noise
    const n = noiseShot(ctx, crackDur + 0.05);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 2000 * pitch;
    hp.Q.value = brittleQ;
    const nEnv = ctx.createGain();
    nEnv.gain.setValueAtTime(vol * crackIntensity, t);
    nEnv.gain.exponentialRampToValueAtTime(0.001, t + crackDur);
    n.connect(hp).connect(nEnv).connect(dest);

    // Layer 2: Primary crystalline ping (harder hit = longer ring)
    const pingDur = 0.18 + spd * 0.08;
    const baseFreq = 2400 * pitch + randRange(0, 400);
    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = baseFreq;
    const oEnv1 = ctx.createGain();
    oEnv1.gain.setValueAtTime(vol * 0.3, t);
    oEnv1.gain.exponentialRampToValueAtTime(0.001, t + pingDur);
    osc1.connect(oEnv1).connect(dest);
    osc1.start(t); osc1.stop(t + pingDur + 0.05);

    // Layer 3: Second inharmonic partial (crystalline shimmer, slightly detuned)
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = baseFreq * 1.618; // golden ratio — maximally inharmonic
    const oEnv2 = ctx.createGain();
    oEnv2.gain.setValueAtTime(vol * 0.15, t);
    oEnv2.gain.exponentialRampToValueAtTime(0.001, t + pingDur * 0.6);
    osc2.connect(oEnv2).connect(dest);
    osc2.start(t); osc2.stop(t + pingDur + 0.05);

    return { stop() {} };
}

/** Fire/lava impact burst — noise burst + low boom + rumble tail */
export function impact_combustion(ctx, dest, p) {
    const t = ctx.currentTime;
    const vol = p.volume ?? 0.6;
    const pitch = p.pitch ?? 1.0;
    const spd = Math.min((p.speed ?? 3) / 6, 2.0);
    const temp = Math.min((p.temperature ?? 800) / 2000, 1.0);
    const quality = clamp(p.quality ?? 1.0, 0, 1);

    // Optional mapped controls from substance paramMap (leaf keys after bridge mapping)
    const crackleRate = Number.isFinite(p.crackleRate) ? clamp(p.crackleRate, 2, 220) : null;
    const brightness = Number.isFinite(p.brightness) ? clamp(p.brightness, 350, 7000) : null;
    const hissLevel = Number.isFinite(p.hissLevel) ? clamp(p.hissLevel, 0, 1.6) : null;
    const rumbleLevel = Number.isFinite(p.rumbleLevel) ? clamp(p.rumbleLevel, 0, 1.6) : null;

    const crackleDensity = crackleRate != null
        ? clamp(crackleRate / 120, 0.12, 1.8)
        : (0.25 + spd * 0.45 + temp * 0.5);
    const hissMix = hissLevel != null
        ? clamp(hissLevel, 0.05, 1.4)
        : (0.25 + temp * 0.45);
    const rumbleMix = rumbleLevel != null
        ? clamp(rumbleLevel, 0.08, 1.5)
        : (0.2 + spd * 0.35);
    const outDrive = 1.08 + quality * 0.2;

    const fireBus = ctx.createGain();
    fireBus.gain.value = 1.0;
    const fireGlue = ctx.createWaveShaper();
    const glueCurve = new Float32Array(256);
    for (let i = 0; i < glueCurve.length; i++) {
        const x = i / (glueCurve.length - 1) * 2 - 1;
        glueCurve[i] = Math.tanh(x * (1.7 + temp * 0.8));
    }
    fireGlue.curve = glueCurve;
    fireGlue.oversample = '2x';
    const outGain = ctx.createGain();
    outGain.gain.value = outDrive;
    fireBus.connect(fireGlue).connect(outGain).connect(dest);

    // Temperature affects burst brightness (hotter = more high freq)
    const burstFreq = (brightness != null ? brightness * 0.45 : (400 + temp * 400)) * pitch;
    // Speed affects burst intensity and boom depth
    const burstDur = 0.1 + spd * 0.05;

    // Layer 1: Burst — wideband noise (initial flash)
    const n = noiseShot(ctx, burstDur + 0.1);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = burstFreq; bp.Q.value = 0.8;
    const burstLP = ctx.createBiquadFilter();
    burstLP.type = 'lowpass';
    burstLP.frequency.value = (2600 + temp * 2200 + hissMix * 1200) * pitch;
    const nEnv = ctx.createGain();
    nEnv.gain.setValueAtTime(vol * (0.3 + spd * 0.22 + hissMix * 0.3), t);
    nEnv.gain.exponentialRampToValueAtTime(0.001, t + burstDur);
    n.connect(bp).connect(burstLP).connect(nEnv).connect(fireBus);

    // Layer 1b: Mid roar body (adds natural fire texture)
    const roar = noiseShot(ctx, burstDur + 0.06);
    const roarBP = ctx.createBiquadFilter();
    roarBP.type = 'bandpass';
    roarBP.frequency.value = (brightness != null ? brightness * 0.78 : (900 + temp * 1200)) * pitch;
    roarBP.Q.value = 0.5;
    const roarLP = ctx.createBiquadFilter();
    roarLP.type = 'lowpass';
    roarLP.frequency.value = (1800 + hissMix * 1600 + temp * 1200) * pitch;
    const roarEnv = ctx.createGain();
    roarEnv.gain.setValueAtTime(vol * (0.11 + hissMix * 0.24), t);
    roarEnv.gain.exponentialRampToValueAtTime(0.001, t + burstDur * 0.9);
    roar.connect(roarBP).connect(roarLP).connect(roarEnv).connect(fireBus);

    // Layer 1d: Low-mid whoof body (air displacement)
    const whoof = noiseShot(ctx, burstDur + 0.08);
    const whoofBP = ctx.createBiquadFilter();
    whoofBP.type = 'bandpass';
    whoofBP.frequency.value = (260 + rumbleMix * 190) * pitch;
    whoofBP.Q.value = 0.8;
    const whoofEnv = ctx.createGain();
    whoofEnv.gain.setValueAtTime(vol * (0.1 + rumbleMix * 0.14), t);
    whoofEnv.gain.exponentialRampToValueAtTime(0.001, t + burstDur * 0.85);
    whoof.connect(whoofBP).connect(whoofEnv).connect(fireBus);

    // Layer 1c: Stochastic crackle packet (hybrid realistic/cinematic pops)
    const crackleCount = Math.floor(clamp(3 + crackleDensity * 5 + quality * 2.5, 3, 13));
    let crackleDelay = 0;
    for (let i = 0; i < crackleCount; i++) {
        crackleDelay += -Math.log(Math.max(1e-4, Math.random())) * 0.005;
        const cDur = 0.003 + randRange(0, 0.008);
        const c = noiseShot(ctx, cDur + 0.01);
        const cBp = ctx.createBiquadFilter();
        cBp.type = 'bandpass';
        cBp.frequency.value = (1500 + temp * 1700 + randRange(0, 2000)) * pitch;
        cBp.Q.value = 2.4;
        const cEnv = ctx.createGain();
        cEnv.gain.setValueAtTime(0.0001, t);
        cEnv.gain.setValueAtTime(vol * (0.03 + crackleDensity * 0.05), t + crackleDelay);
        cEnv.gain.exponentialRampToValueAtTime(0.001, t + crackleDelay + cDur);
        c.connect(cBp).connect(cEnv).connect(fireBus);
    }

    // Layer 2: Low boom sweep (harder impact = deeper boom)
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime((85 + spd * 18 + rumbleMix * 20) * pitch, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + 0.18);
    const oEnv = ctx.createGain();
    oEnv.gain.setValueAtTime(vol * (0.2 + rumbleMix * 0.24), t);
    oEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(oEnv).connect(dest);
    osc.start(t); osc.stop(t + 0.22);

    // Layer 3: Rumble tail (low-freq LP noise, fading out — debris/afterburn)
    const tail = noiseShot(ctx, 0.3);
    const tailLP = ctx.createBiquadFilter();
    tailLP.type = 'lowpass'; tailLP.frequency.value = (180 + rumbleMix * 140) * pitch; tailLP.Q.value = 1.0;
    const tailEnv = ctx.createGain();
    tailEnv.gain.setValueAtTime(0, t);
    tailEnv.gain.linearRampToValueAtTime(vol * (0.1 + rumbleMix * 0.18), t + burstDur * 0.5);
    tailEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    tail.connect(tailLP).connect(tailEnv).connect(dest);

    return { stop() {} };
}

/** Sand soft impact — muffled body + grain scatter */
export function impact_sand(ctx, dest, p) {
    const t = ctx.currentTime;
    const baseVol = (p.volume ?? 0.3) * 0.5;
    const mappedImpactGain = Number.isFinite(p.impactGain) ? clamp(p.impactGain, 0.2, 2.2) : 1.0;
    const mappedScatter = Number.isFinite(p.scatter) ? clamp(p.scatter, 0.2, 2.5) : null;
    const mappedDryness = Number.isFinite(p.dryness) ? clamp(p.dryness, 0.4, 1.8) : null;
    const mappedBodyLevel = Number.isFinite(p.bodyLevel) ? clamp(p.bodyLevel, 0, 1.8) : null;
    const vol = baseVol * mappedImpactGain;
    const pitch = p.pitch ?? 1.0;
    const spd = Math.min((p.speed ?? 2) / 6, 2.0);
    const scatterEnergy = mappedScatter ?? (0.7 + spd * 0.5);
    const dryness = mappedDryness ?? 1.0;
    const bodyLevel = mappedBodyLevel ?? (0.55 + spd * 0.25);

    // Speed affects grain scatter duration and filter brightness
    const grainDur = 0.046 + spd * 0.028 + scatterEnergy * 0.012;
    const lpFreq = (240 + spd * 170 + dryness * 110) * pitch;

    // Layer 1: Muffled body (low thud absorbed by sand)
    const n = noiseShot(ctx, grainDur + 0.04);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = lpFreq; lp.Q.value = 0.7;
    const env = ctx.createGain();
    env.gain.setValueAtTime(vol * bodyLevel, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + grainDur);
    n.connect(lp).connect(env).connect(dest);

    // Layer 1b: Mid scratch packet (dry grains rubbing)
    const scratch = noiseShot(ctx, grainDur + 0.03);
    const scratchBP = ctx.createBiquadFilter();
    scratchBP.type = 'bandpass';
    scratchBP.frequency.value = (900 + dryness * 500 + spd * 300) * pitch;
    scratchBP.Q.value = 1.1;
    const scratchEnv = ctx.createGain();
    scratchEnv.gain.setValueAtTime(vol * (0.08 + scatterEnergy * 0.08), t + 0.002);
    scratchEnv.gain.exponentialRampToValueAtTime(0.001, t + grainDur * 0.75);
    scratch.connect(scratchBP).connect(scratchEnv).connect(dest);

    // Layer 2: High-freq grain scatter (sparkly sand particles splashing)
    const scatterNoise = noiseShot(ctx, grainDur + 0.02);
    const scatterHP = ctx.createBiquadFilter();
    scatterHP.type = 'highpass'; scatterHP.frequency.value = (3200 + spd * 1200 + dryness * 600) * pitch; scatterHP.Q.value = 0.5;
    const scatterEnv = ctx.createGain();
    scatterEnv.gain.setValueAtTime(vol * (0.07 + scatterEnergy * 0.09), t + 0.003);
    scatterEnv.gain.exponentialRampToValueAtTime(0.001, t + grainDur * 0.6);
    scatterNoise.connect(scatterHP).connect(scatterEnv).connect(dest);

    // Layer 3: Micro-grain packet events (granular texture)
    const grainCount = Math.floor(clamp(2 + spd * 2 + scatterEnergy * 2.5, 2, 11));
    for (let i = 0; i < grainCount; i++) {
        const delay = randRange(0.002, grainDur * 0.8);
        const g = noiseShot(ctx, 0.01);
        const gBP = ctx.createBiquadFilter();
        gBP.type = 'bandpass';
        gBP.frequency.value = (1800 + randRange(0, 2200)) * pitch;
        gBP.Q.value = 1.6;
        const gEnv = ctx.createGain();
        gEnv.gain.setValueAtTime(0.0001, t);
        gEnv.gain.setValueAtTime(vol * 0.05, t + delay);
        gEnv.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.01);
        g.connect(gBP).connect(gEnv).connect(dest);
    }

    return { stop() {} };
}

/** Viscous liquid drop/drip — thicker plop than water, low resonance, no spray */
export function impact_drop(ctx, dest, p) {
    const t = ctx.currentTime;
    const mappedImpactGain = Number.isFinite(p.impactGain) ? clamp(p.impactGain, 0.2, 2.2) : 1.0;
    const mappedAmplitude = Number.isFinite(p.amplitude) ? clamp(p.amplitude, 0.15, 2.8) : 1.0;
    const mappedRate = Number.isFinite(p.rate) ? clamp(p.rate, 0.05, 24) : null;
    const mappedDecay = Number.isFinite(p.decay) ? clamp(p.decay, 0.04, 0.8) : null;
    const mappedBodyRes = Number.isFinite(p.bodyResonance) ? clamp(p.bodyResonance, 40, 220) : null;
    const vol = (p.volume ?? 0.4) * mappedImpactGain;
    const pitch = p.pitch ?? 1.0;
    const spd = Math.min((p.speed ?? 2) / 6, 2.0);
    const temp = Math.min((p.temperature ?? 300) / 1000, 1.0);
    const viscosity = 0.7 + (1.0 - temp) * 0.6;
    const dropletDensity = mappedRate != null
        ? clamp(mappedRate / 8, 0.15, 2.8)
        : (0.45 + spd * 0.55);

    // Viscous drops have a lower, slower pitch sweep than water
    const plopStartHz = (280 + spd * 200 + randRange(0, 100)) * pitch;
    const plopEndHz = (48 + dropletDensity * 8 + randRange(0, 28)) * pitch;
    const plopDur = mappedDecay ?? (0.028 * viscosity + 0.04 / Math.max(spd, 0.3));

    // Layer 1: Thick plop body (sine sweep, slower than water)
    const plopOsc = ctx.createOscillator();
    plopOsc.type = 'sine';
    plopOsc.frequency.setValueAtTime(plopStartHz, t);
    plopOsc.frequency.exponentialRampToValueAtTime(plopEndHz, t + plopDur);
    const plopGain = ctx.createGain();
    plopGain.gain.setValueAtTime(0.0001, t);
    plopGain.gain.linearRampToValueAtTime(vol * (0.68 + mappedAmplitude * 0.26), t + 0.002 * viscosity);
    plopGain.gain.exponentialRampToValueAtTime(0.001, t + plopDur);
    plopOsc.connect(plopGain).connect(dest);
    plopOsc.start(t); plopOsc.stop(t + plopDur + 0.01);

    // Layer 2: Low resonant thump (viscous mass hitting surface)
    const thumpDur = clamp(plopDur * 0.7, 0.03, 0.16);
    const thump = ctx.createOscillator();
    thump.type = 'sine';
    const bodyResHz = mappedBodyRes ?? (75 + dropletDensity * 16);
    thump.frequency.setValueAtTime(bodyResHz * pitch, t);
    thump.frequency.exponentialRampToValueAtTime(40, t + thumpDur);
    const thumpEnv = ctx.createGain();
    thumpEnv.gain.setValueAtTime(vol * (0.16 + mappedAmplitude * 0.14 + spd * 0.12), t);
    thumpEnv.gain.exponentialRampToValueAtTime(0.001, t + thumpDur);
    thump.connect(thumpEnv).connect(dest);
    thump.start(t); thump.stop(t + thumpDur + 0.01);

    // Layer 3: Muted LP noise (squelch, not bright spray like water)
    if (dropletDensity > 0.2) {
        const squelchDur = 0.01 + spd * 0.008 + dropletDensity * 0.006;
        const squelch = noiseShot(ctx, squelchDur + 0.01);
        const squelchLP = ctx.createBiquadFilter();
        squelchLP.type = 'lowpass'; squelchLP.frequency.value = (650 + spd * 300 + dropletDensity * 180) * pitch / viscosity; squelchLP.Q.value = 1.0;
        const squelchEnv = ctx.createGain();
        squelchEnv.gain.setValueAtTime(vol * Math.min(0.08 + dropletDensity * 0.16, 0.42), t);
        squelchEnv.gain.exponentialRampToValueAtTime(0.001, t + squelchDur);
        squelch.connect(squelchLP).connect(squelchEnv).connect(dest);
    }

    // Layer 4: Secondary droplets (sticky splat fragments)
    const dropCount = Math.floor(clamp(1 + dropletDensity * 2.2, 1, 5));
    for (let i = 0; i < dropCount; i++) {
        const delay = randRange(0.004, plopDur * 0.7);
        const d = ctx.createOscillator();
        d.type = 'sine';
        const dFreq = clamp((160 + randRange(0, 170)) * pitch / viscosity, 90, 520);
        d.frequency.setValueAtTime(dFreq, t + delay);
        d.frequency.exponentialRampToValueAtTime(dFreq * 0.58, t + delay + 0.016);
        const dEnv = ctx.createGain();
        dEnv.gain.setValueAtTime(0.0001, t);
        dEnv.gain.setValueAtTime(vol * (0.03 + mappedAmplitude * 0.05), t + delay);
        dEnv.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.018);
        d.connect(dEnv).connect(dest);
        d.start(t + delay);
        d.stop(t + delay + 0.03);
    }

    return { stop() {} };
}

/** Gas/vapor/granular hiss — soft broadband whoosh, not a hard impact */
export function impact_hiss(ctx, dest, p) {
    const t = ctx.currentTime;
    const mappedImpactGain = Number.isFinite(p.impactGain) ? clamp(p.impactGain, 0.2, 2.2) : 1.0;
    const mappedCutoff = Number.isFinite(p.cutoff) ? clamp(p.cutoff, 350, 9000) : null;
    const mappedGustiness = Number.isFinite(p.gustiness) ? clamp(p.gustiness, 0.1, 2.2) : null;
    const mappedWhoosh = Number.isFinite(p.whooshLevel) ? clamp(p.whooshLevel, 0, 2.0) : null;
    const baseVol = (p.volume ?? 0.3) * 0.6;
    const vol = baseVol * mappedImpactGain;
    const pitch = p.pitch ?? 1.0;
    const spd = Math.min((p.speed ?? 2) / 6, 2.0);
    const temp = Math.min((p.temperature ?? 300) / 1000, 1.0);
    const gustiness = mappedGustiness ?? (0.55 + spd * 0.45);
    const whooshLevel = mappedWhoosh ?? (0.4 + spd * 0.3);

    // Hiss duration scales with speed (faster gas = longer whoosh)
    const hissDur = 0.055 + spd * 0.05 + gustiness * 0.02;
    // Temperature shifts the spectral center up (hotter gas = brighter)
    const centerFreq = (mappedCutoff ?? (1500 + temp * 2100 + gustiness * 260)) * pitch;

    // Layer 1: Broadband hiss (bandpass noise, soft attack)
    const n = noiseShot(ctx, hissDur + 0.06);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = centerFreq; bp.Q.value = 0.55 + gustiness * 0.15;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = (3800 + temp * 2400 + whooshLevel * 500) * pitch;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vol * (0.42 + gustiness * 0.35), t + 0.005);
    env.gain.exponentialRampToValueAtTime(0.001, t + hissDur);
    n.connect(bp).connect(lp).connect(env).connect(dest);

    // Layer 2: High airy shimmer (very quiet HP noise)
    const shimmerDur = hissDur * 0.7;
    const shimmer = noiseShot(ctx, shimmerDur + 0.02);
    const shimmerHP = ctx.createBiquadFilter();
    shimmerHP.type = 'highpass'; shimmerHP.frequency.value = (5000 + temp * 2200 + gustiness * 400) * pitch; shimmerHP.Q.value = 0.5;
    const shimmerEnv = ctx.createGain();
    shimmerEnv.gain.setValueAtTime(vol * (0.1 + whooshLevel * 0.08), t);
    shimmerEnv.gain.exponentialRampToValueAtTime(0.001, t + shimmerDur);
    shimmer.connect(shimmerHP).connect(shimmerEnv).connect(dest);

    // Layer 3: Sub-bass puff (pressure wave for steam/smoke)
    if (whooshLevel > 0.2) {
        const puffDur = 0.03 + spd * 0.02;
        const puff = ctx.createOscillator();
        puff.type = 'sine';
        puff.frequency.setValueAtTime(60 * pitch, t);
        puff.frequency.exponentialRampToValueAtTime(30, t + puffDur);
        const puffEnv = ctx.createGain();
        puffEnv.gain.setValueAtTime(vol * (0.12 + whooshLevel * 0.12), t);
        puffEnv.gain.exponentialRampToValueAtTime(0.001, t + puffDur);
        puff.connect(puffEnv).connect(dest);
        puff.start(t); puff.stop(t + puffDur + 0.01);
    }

    // Layer 4: Turbulent chuffs (stochastic pressure spikes)
    const chuffCount = Math.floor(clamp(1 + gustiness * 2.2, 1, 6));
    let chuffDelay = 0;
    for (let i = 0; i < chuffCount; i++) {
        chuffDelay += -Math.log(Math.max(1e-4, Math.random())) * 0.008;
        const cDur = 0.006 + randRange(0, 0.01);
        const c = noiseShot(ctx, cDur + 0.01);
        const cBP = ctx.createBiquadFilter();
        cBP.type = 'bandpass';
        cBP.frequency.value = (800 + randRange(0, 1400) + temp * 800) * pitch;
        cBP.Q.value = 0.85;
        const cEnv = ctx.createGain();
        cEnv.gain.setValueAtTime(0.0001, t);
        cEnv.gain.setValueAtTime(vol * (0.045 + gustiness * 0.05), t + chuffDelay);
        cEnv.gain.exponentialRampToValueAtTime(0.001, t + chuffDelay + cDur);
        c.connect(cBP).connect(cEnv).connect(dest);
    }

    return { stop() {} };
}

/** Spark/debris crackle — scattered hard micro-transients */
export function impact_crackle(ctx, dest, p) {
    const t = ctx.currentTime;
    const mappedImpactGain = Number.isFinite(p.impactGain) ? clamp(p.impactGain, 0.2, 2.4) : 1.0;
    const mappedDensity = Number.isFinite(p.density) ? clamp(p.density, 1, 180) : null;
    const mappedBrightness = Number.isFinite(p.brightness) ? clamp(p.brightness, 600, 9000) : null;
    const mappedThudLevel = Number.isFinite(p.thudLevel) ? clamp(p.thudLevel, 0, 2.0) : null;
    const vol = (p.volume ?? 0.5) * mappedImpactGain;
    const pitch = p.pitch ?? 1.0;
    const spd = Math.min((p.speed ?? 3) / 6, 2.0);
    const temp = Math.min((p.temperature ?? 500) / 2000, 1.0);
    const density = mappedDensity != null ? clamp(mappedDensity / 24, 0.2, 2.6) : (0.6 + spd * 0.8);
    const brightness = mappedBrightness ?? (1800 + temp * 2300 + spd * 900);
    const thudMix = mappedThudLevel != null ? clamp(mappedThudLevel, 0, 1.8) : (1.0 - temp * 0.5);

    // Number of micro-transients (1-4, based on speed)
    const burstCount = Math.floor(clamp(2 + density * 2.6, 2, 10));

    // Layer 1: Scattered HP noise micro-bursts (the "crackle")
    let delay = 0;
    for (let i = 0; i < burstCount; i++) {
        delay += -Math.log(Math.max(1e-4, Math.random())) * 0.006;
        const burstDur = 0.004 + randRange(0, 0.008);
        const burst = noiseShot(ctx, burstDur + 0.01);
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = (brightness * (0.65 + randRange(0, 0.9))) * pitch;
        hp.Q.value = 0.4 + density * 0.22;
        const burstEnv = ctx.createGain();
        burstEnv.gain.setValueAtTime(0, t);
        burstEnv.gain.setValueAtTime(vol * (0.16 + density * 0.15 + randRange(0, 0.16)), t + delay);
        burstEnv.gain.exponentialRampToValueAtTime(0.001, t + delay + burstDur);
        burst.connect(hp).connect(burstEnv).connect(dest);
    }

    // Layer 2: Bright ping (hot sparks have a metallic ting)
    if (temp > 0.18 || density > 0.7) {
        const pingFreq = (brightness * (0.55 + randRange(0, 0.48))) * pitch;
        const pingDur = 0.02 + spd * 0.01;
        const ping = ctx.createOscillator();
        ping.type = 'sine';
        ping.frequency.value = pingFreq;
        const pingEnv = ctx.createGain();
        pingEnv.gain.setValueAtTime(vol * (0.04 + temp * 0.11 + density * 0.06), t);
        pingEnv.gain.exponentialRampToValueAtTime(0.001, t + pingDur);
        ping.connect(pingEnv).connect(dest);
        ping.start(t); ping.stop(t + pingDur + 0.01);
    }

    // Layer 3: Sub-thud (debris chunk hitting ground)
    const thudVol = vol * (0.1 + spd * 0.09) * thudMix;
    if (thudVol > 0.05) {
        const thudDur = 0.03 + spd * 0.015;
        const thud = noiseShot(ctx, thudDur + 0.02);
        const thudLP = ctx.createBiquadFilter();
        thudLP.type = 'lowpass'; thudLP.frequency.value = (320 + (1.0 - Math.min(temp, 0.9)) * 160) * pitch; thudLP.Q.value = 1.5;
        const thudEnv = ctx.createGain();
        thudEnv.gain.setValueAtTime(thudVol, t);
        thudEnv.gain.exponentialRampToValueAtTime(0.001, t + thudDur);
        thud.connect(thudLP).connect(thudEnv).connect(dest);
    }

    return { stop() {} };
}

/** Plasma/spark electric snap */
export function impact_electric(ctx, dest, p) {
    const t = ctx.currentTime;
    const mappedImpactGain = Number.isFinite(p.impactGain) ? clamp(p.impactGain, 0.2, 2.3) : 1.0;
    const mappedBuzzFreq = Number.isFinite(p.buzzFreq) ? clamp(p.buzzFreq, 25, 220) : null;
    const mappedSnapRate = Number.isFinite(p.snapRate) ? clamp(p.snapRate, 2, 220) : null;
    const mappedArcLevel = Number.isFinite(p.arcLevel) ? clamp(p.arcLevel, 0, 2.0) : null;
    const vol = (p.volume ?? 0.5) * mappedImpactGain;
    const pitch = p.pitch ?? 1.0;
    const spd = Math.min((p.speed ?? 3) / 6, 2.0);
    const temp = Math.min((p.temperature ?? 500) / 2000, 1.0);
    const snapDensity = mappedSnapRate != null ? clamp(mappedSnapRate / 60, 0.1, 3.0) : (0.55 + spd * 0.65);
    const arcLevel = mappedArcLevel ?? (0.35 + temp * 0.6);

    // Speed affects snap intensity, temperature affects buzz frequency
    const snapDur = 0.018 + spd * 0.014;
    const buzzFreq = (mappedBuzzFreq ?? (40 + temp * 42)) * pitch;
    const fmDepth = (360 + spd * 220 + snapDensity * 80) * pitch;

    // Noise snap cluster
    const snapCount = Math.floor(clamp(1 + snapDensity * 2.8, 1, 8));
    let snapDelay = 0;
    for (let i = 0; i < snapCount; i++) {
        snapDelay += -Math.log(Math.max(1e-4, Math.random())) * 0.006;
        const n = noiseShot(ctx, snapDur + 0.03);
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = (2400 + temp * 1800 + randRange(0, 1900)) * pitch;
        const nEnv = ctx.createGain();
        nEnv.gain.setValueAtTime(0.0001, t);
        nEnv.gain.setValueAtTime(vol * (0.16 + snapDensity * 0.1), t + snapDelay);
        nEnv.gain.exponentialRampToValueAtTime(0.001, t + snapDelay + snapDur);
        const shaper = ctx.createWaveShaper();
        const curve = new Float32Array(256);
        for (let j = 0; j < curve.length; j++) {
            const x = j / (curve.length - 1) * 2 - 1;
            curve[j] = Math.tanh(x * (2.6 + arcLevel * 0.5));
        }
        shaper.curve = curve;
        n.connect(hp).connect(nEnv).connect(shaper).connect(dest);
    }

    // FM buzz snap (hotter plasma = higher frequency)
    const mod = ctx.createOscillator();
    mod.type = 'sawtooth'; mod.frequency.value = buzzFreq;
    const modG = ctx.createGain(); modG.gain.value = fmDepth;
    mod.connect(modG);
    const carrier = ctx.createOscillator();
    carrier.type = 'sine'; carrier.frequency.value = (150 + temp * 100) * pitch;
    modG.connect(carrier.frequency);
    const cEnv = ctx.createGain();
    cEnv.gain.setValueAtTime(vol * (0.15 + arcLevel * 0.18 + spd * 0.1), t);
    cEnv.gain.exponentialRampToValueAtTime(0.001, t + snapDur + 0.025);
    carrier.connect(cEnv).connect(dest);
    const buzzStop = snapDur + 0.045;
    mod.start(t); mod.stop(t + buzzStop);
    carrier.start(t); carrier.stop(t + buzzStop);

    if (arcLevel > 0.2) {
        const arc = ctx.createOscillator();
        arc.type = 'triangle';
        arc.frequency.setValueAtTime((1300 + temp * 1600) * pitch, t + 0.004);
        arc.frequency.exponentialRampToValueAtTime((260 + temp * 420) * pitch, t + 0.02 + arcLevel * 0.01);
        const arcEnv = ctx.createGain();
        arcEnv.gain.setValueAtTime(0.0001, t);
        arcEnv.gain.setValueAtTime(vol * (0.04 + arcLevel * 0.08), t + 0.004);
        arcEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.02 + arcLevel * 0.01);
        arc.connect(arcEnv).connect(dest);
        arc.start(t + 0.004);
        arc.stop(t + 0.05 + arcLevel * 0.02);
    }

    return { stop() {} };
}

// ============================================================================
// AMBIENT PATCHES (looping, stoppable, updatable)
// ============================================================================

/** Fire/lava crackling ambient — random noise bursts + low rumble */
export function ambient_combustion(ctx, dest, p) {
    const vol = (p.volume ?? 0.3) * 1.22;
    let alive = true;
    const nodes = [];
    let crackleTimer = null;
    let dynVolume = vol;
    let dynCrackleRate = 70;
    let dynBrightness = 2600;
    let dynHissLevel = 0.5;
    let dynRumbleLevel = 0.45;

    // Low rumble base
    const rumble = ctx.createOscillator();
    rumble.type = 'sine'; rumble.frequency.value = 45;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = vol * 0.25;
    rumble.connect(rumbleGain).connect(dest);
    rumble.start(); nodes.push(rumble);

    // Continuous filtered noise (hiss)
    const hiss = noiseSource(ctx);
    const hissBP = ctx.createBiquadFilter();
    hissBP.type = 'bandpass'; hissBP.frequency.value = 3000; hissBP.Q.value = 1;
    const hissGain = ctx.createGain();
    hissGain.gain.value = vol * 0.08;
    hiss.connect(hissBP).connect(hissGain).connect(dest);
    hiss.start(); nodes.push(hiss);

    // Mid roar body for fuller flame tone
    const roar = noiseSource(ctx);
    const roarBP = ctx.createBiquadFilter();
    roarBP.type = 'bandpass'; roarBP.frequency.value = 900; roarBP.Q.value = 0.55;
    const roarGain = ctx.createGain();
    roarGain.gain.value = vol * 0.12;
    roar.connect(roarBP).connect(roarGain).connect(dest);
    roar.start(); nodes.push(roar);

    // Slow flicker modulation so texture doesn't feel static between updates
    const flicker = ctx.createOscillator();
    flicker.type = 'triangle';
    flicker.frequency.value = 0.42;
    const flickerDepth = ctx.createGain();
    flickerDepth.gain.value = vol * 0.04;
    flicker.connect(flickerDepth).connect(roarGain.gain);
    flicker.start(); nodes.push(flicker);

    const breath = ctx.createOscillator();
    breath.type = 'sine';
    breath.frequency.value = 0.18;
    const breathDepth = ctx.createGain();
    breathDepth.gain.value = 180;
    breath.connect(breathDepth).connect(hissBP.frequency);
    breath.start(); nodes.push(breath);

    // Random crackle pops (scheduled via setTimeout chain)
    function scheduleCrackle() {
        if (!alive) return;
        const t = ctx.currentTime;
        const clusterCount = 1 + Math.floor(randRange(0, dynCrackleRate > 100 ? 3 : 2));
        let localDelay = 0;
        for (let i = 0; i < clusterCount; i++) {
            localDelay += -Math.log(Math.max(1e-4, Math.random())) * 0.004;
            const n = noiseShot(ctx, 0.02);
            const bp = ctx.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.value = dynBrightness * (0.45 + randRange(0, 0.75));
            bp.Q.value = 2.0;
            const env = ctx.createGain();
            env.gain.setValueAtTime(0.0001, t);
            env.gain.setValueAtTime(dynVolume * (0.04 + dynHissLevel * 0.08 + randRange(0, 0.08)), t + localDelay);
            env.gain.exponentialRampToValueAtTime(0.001, t + localDelay + 0.01 + randRange(0, 0.015));
            n.connect(bp).connect(env).connect(dest);
        }

        const crackleGap = clamp(240 - dynCrackleRate * 0.95, 20, 260);
        const nextDelay = crackleGap + randRange(0, 80);
        crackleTimer = setTimeout(scheduleCrackle, nextDelay);
    }
    scheduleCrackle();

    return {
        update(params) {
            const now = ctx.currentTime;
            const v = params.volume ?? vol;
            const temp = Math.min((params.temperature ?? 600) / 2000, 1.0);
            const density = Math.min(Math.max(params.density ?? 0, 0), 200);

            const mappedCrackleRate = Number.isFinite(params.crackleRate) ? clamp(params.crackleRate, 5, 220) : null;
            const mappedBrightness = Number.isFinite(params.brightness) ? clamp(params.brightness, 500, 7000) : null;
            const mappedHissLevel = Number.isFinite(params.hissLevel) ? clamp(params.hissLevel, 0, 1.6) : null;
            const mappedRumbleLevel = Number.isFinite(params.rumbleLevel) ? clamp(params.rumbleLevel, 0, 1.6) : null;

            dynVolume = v;
            dynCrackleRate = mappedCrackleRate ?? clamp(35 + temp * 80 + density * 0.22, 18, 220);
            dynBrightness = mappedBrightness ?? clamp(1800 + temp * 2600 + density * 2.5, 900, 7000);
            dynHissLevel = mappedHissLevel ?? clamp(0.2 + temp * 0.75, 0.05, 1.5);
            dynRumbleLevel = mappedRumbleLevel ?? clamp(0.16 + density * 0.006 + temp * 0.25, 0.08, 1.5);

            const rumbleVol = v * (0.06 + dynRumbleLevel * 0.28);
            const hissVol = v * (0.03 + dynHissLevel * 0.16);
            const roarVol = v * (0.05 + dynHissLevel * 0.24);
            if (rumbleGain.gain?.setTargetAtTime) rumbleGain.gain.setTargetAtTime(rumbleVol, now, 0.06);
            else rumbleGain.gain.value = rumbleVol;
            if (hissGain.gain?.setTargetAtTime) hissGain.gain.setTargetAtTime(hissVol, now, 0.06);
            else hissGain.gain.value = hissVol;
            if (roarGain.gain?.setTargetAtTime) roarGain.gain.setTargetAtTime(roarVol, now, 0.06);
            else roarGain.gain.value = roarVol;
            if (hissBP.frequency?.setTargetAtTime) hissBP.frequency.setTargetAtTime(dynBrightness, now, 0.08);
            else hissBP.frequency.value = dynBrightness;
            if (roarBP.frequency?.setTargetAtTime) roarBP.frequency.setTargetAtTime(420 + dynBrightness * 0.55, now, 0.08);
            else roarBP.frequency.value = 420 + dynBrightness * 0.55;
            if (rumble.frequency?.setTargetAtTime) rumble.frequency.setTargetAtTime(36 + dynRumbleLevel * 28, now, 0.1);
            else rumble.frequency.value = 36 + dynRumbleLevel * 28;
        },
        stop() {
            alive = false;
            if (crackleTimer) clearTimeout(crackleTimer);
            for (const n of nodes) { try { n.stop(); } catch {} }
            try { rumbleGain.disconnect(); } catch {}
            try { hissGain.disconnect(); } catch {}
            try { roarGain.disconnect(); } catch {}
        }
    };
}

/** Viscous/fluid flow ambient — subtle high-freq trickle.
 *  Shared by water + viscous liquids through AMBIENT_PATCHES aliases. */
export function ambient_fluid(ctx, dest, p) {
    const vol = (p.volume ?? 0.25) * 0.3;
    let alive = true;
    const nodes = [];
    let dropletTimer = null;
    let bubbleTimer = null;
    let dynVolume = vol;
    let dynFlowLevel = 0.4;
    let dynSplashRate = 2.0;
    let dynBrightness = 3200;
    let dynGurgleLevel = 0.45;
    let dynViscosity = 0.9;
    let dynTurbulence = 0.6;

    const src = noiseSource(ctx);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 1900; hp.Q.value = 0.55;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 3300; bp.Q.value = 1.35;
    const gain = ctx.createGain();
    gain.gain.value = vol;

    const body = noiseSource(ctx);
    const bodyBP = ctx.createBiquadFilter();
    bodyBP.type = 'bandpass'; bodyBP.frequency.value = 420; bodyBP.Q.value = 0.7;
    const bodyGain = ctx.createGain();
    bodyGain.gain.value = vol * 0.28;

    const churn = noiseSource(ctx);
    const churnBP = ctx.createBiquadFilter();
    churnBP.type = 'bandpass'; churnBP.frequency.value = 980; churnBP.Q.value = 0.8;
    const churnGain = ctx.createGain();
    churnGain.gain.value = vol * 0.1;

    const gurgle = ctx.createOscillator();
    gurgle.type = 'sine';
    gurgle.frequency.value = 72;
    const gurgleGain = ctx.createGain();
    gurgleGain.gain.value = vol * 0.12;
    gurgle.connect(gurgleGain).connect(dest);
    gurgle.start(); nodes.push(gurgle);

    const gurgleSub = ctx.createOscillator();
    gurgleSub.type = 'triangle';
    gurgleSub.frequency.value = 46;
    const gurgleSubGain = ctx.createGain();
    gurgleSubGain.gain.value = vol * 0.04;
    gurgleSub.connect(gurgleSubGain).connect(dest);
    gurgleSub.start(); nodes.push(gurgleSub);

    const lfo = ctx.createOscillator();
    lfo.type = 'sine'; lfo.frequency.value = 2.8;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 700;
    lfo.connect(lfoGain).connect(bp.frequency);
    lfo.start(); nodes.push(lfo);

    const drift = ctx.createOscillator();
    drift.type = 'triangle';
    drift.frequency.value = 0.19;
    const driftGain = ctx.createGain();
    driftGain.gain.value = 230;
    drift.connect(driftGain).connect(hp.frequency);
    drift.start(); nodes.push(drift);

    const shimmer = ctx.createOscillator();
    shimmer.type = 'sine';
    shimmer.frequency.value = 5.7;
    const shimmerGain = ctx.createGain();
    shimmerGain.gain.value = 170;
    shimmer.connect(shimmerGain).connect(churnBP.frequency);
    shimmer.start(); nodes.push(shimmer);

    src.connect(hp).connect(bp).connect(gain).connect(dest);
    src.start(); nodes.push(src);
    body.connect(bodyBP).connect(bodyGain).connect(dest);
    body.start(); nodes.push(body);
    churn.connect(churnBP).connect(churnGain).connect(dest);
    churn.start(); nodes.push(churn);

    function scheduleDroplet() {
        if (!alive) return;
        const now = ctx.currentTime;
        const d = noiseShot(ctx, 0.018);
        const dBP = ctx.createBiquadFilter();
        dBP.type = 'bandpass';
        dBP.frequency.value = dynBrightness * (0.58 + randRange(0, 0.65)) * (1.0 - Math.min(dynViscosity * 0.15, 0.24));
        dBP.Q.value = 1.9;
        const dEnv = ctx.createGain();
        dEnv.gain.setValueAtTime(dynVolume * (0.03 + dynFlowLevel * 0.05), now);
        dEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.014 + randRange(0, 0.01));
        d.connect(dBP).connect(dEnv).connect(dest);

        if (dynSplashRate > 1.8 && Math.random() < Math.min(0.2 + dynFlowLevel * 0.22, 0.75)) {
            const ping = ctx.createOscillator();
            ping.type = 'sine';
            const pingStart = clamp((290 + dynBrightness * 0.12 + randRange(0, 280)) / (0.9 + dynViscosity * 0.25), 170, 2800);
            ping.frequency.setValueAtTime(pingStart, now + 0.002);
            ping.frequency.exponentialRampToValueAtTime(Math.max(90, pingStart * 0.58), now + 0.024);
            const pingEnv = ctx.createGain();
            pingEnv.gain.setValueAtTime(0.0001, now);
            pingEnv.gain.setValueAtTime(dynVolume * (0.02 + dynFlowLevel * 0.03), now + 0.002);
            pingEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.026);
            ping.connect(pingEnv).connect(dest);
            ping.start(now + 0.002);
            ping.stop(now + 0.03);
        }

        const baseInterval = clamp(420 - dynSplashRate * 28 + dynViscosity * 95, 55, 560);
        const poisson = -Math.log(Math.max(1e-4, Math.random())) * baseInterval;
        dropletTimer = setTimeout(scheduleDroplet, clamp(poisson, 40, 640));
    }

    function scheduleBubble() {
        if (!alive) return;
        const now = ctx.currentTime;
        if (dynGurgleLevel > 0.2 && Math.random() < Math.min(0.16 + dynGurgleLevel * 0.24, 0.72)) {
            const b = ctx.createOscillator();
            b.type = 'sine';
            const bStart = clamp((95 + dynGurgleLevel * 70 + randRange(0, 60)) / (0.82 + dynViscosity * 0.2), 45, 240);
            b.frequency.setValueAtTime(bStart, now);
            b.frequency.exponentialRampToValueAtTime(Math.max(28, bStart * 0.52), now + 0.085);
            const bEnv = ctx.createGain();
            bEnv.gain.setValueAtTime(0.0001, now);
            bEnv.gain.linearRampToValueAtTime(dynVolume * (0.03 + dynGurgleLevel * 0.05), now + 0.01);
            bEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
            b.connect(bEnv).connect(dest);
            b.start(now);
            b.stop(now + 0.1);
        }
        const bubbleBase = clamp(680 - dynGurgleLevel * 210 + dynViscosity * 120, 220, 1200);
        const poisson = -Math.log(Math.max(1e-4, Math.random())) * bubbleBase;
        bubbleTimer = setTimeout(scheduleBubble, clamp(poisson, 140, 1700));
    }

    scheduleDroplet();
    scheduleBubble();

    return {
        update(params) {
            const now = ctx.currentTime;
            const mappedImpactGain = Number.isFinite(params.impactGain) ? clamp(params.impactGain, 0.2, 2.2) : 1.0;
            const nextVol = (params.volume ?? vol) * 0.3 * mappedImpactGain;
            const emitRate = Math.max(params.emitRate ?? 0, 0);
            const temp = Math.min((params.temperature ?? 300) / 1200, 1.0);

            const mappedFlowLevel = Number.isFinite(params.flowLevel) ? clamp(params.flowLevel, 0, 2.2) : null;
            const mappedSplashRate = Number.isFinite(params.splashRate) ? clamp(params.splashRate, 0.2, 40) : null;
            const mappedBrightness = Number.isFinite(params.brightness) ? clamp(params.brightness, 600, 8000) : null;
            const mappedGurgle = Number.isFinite(params.gurgleLevel) ? clamp(params.gurgleLevel, 0, 1.8) : null;
            const mappedRate = Number.isFinite(params.rate) ? clamp(params.rate, 0.05, 24) : null;
            const mappedDecay = Number.isFinite(params.decay) ? clamp(params.decay, 0.04, 0.8) : null;
            const mappedBodyRes = Number.isFinite(params.bodyResonance) ? clamp(params.bodyResonance, 40, 220) : null;

            const flowFromRate = mappedRate != null ? clamp(mappedRate / 8, 0.06, 2.2) : null;
            const splashFromRate = mappedRate != null ? clamp(mappedRate * 1.85, 0.2, 40) : null;
            const gurgleFromBody = mappedBodyRes != null ? clamp((mappedBodyRes - 40) / 95, 0.06, 1.8) : null;
            const brightFromBody = mappedBodyRes != null ? clamp(1450 + mappedBodyRes * 18, 900, 7800) : null;

            dynVolume = nextVol;
            dynFlowLevel = mappedFlowLevel
                ?? flowFromRate
                ?? clamp(0.18 + Math.min((params.density ?? 0) * 0.012, 1.6), 0.08, 2.0);
            dynSplashRate = mappedSplashRate
                ?? splashFromRate
                ?? clamp(2 + emitRate * 0.32 + dynFlowLevel * 4.5, 1, 40);
            dynBrightness = mappedBrightness
                ?? brightFromBody
                ?? clamp(2200 + emitRate * 7 + temp * 1300, 1000, 7800);
            dynGurgleLevel = mappedGurgle
                ?? gurgleFromBody
                ?? clamp(0.22 + dynFlowLevel * 0.5, 0.1, 1.7);
            dynViscosity = mappedDecay != null
                ? clamp(0.45 + mappedDecay * 1.55, 0.45, 1.8)
                : clamp(0.65 + (1.0 - temp) * 0.55, 0.45, 1.65);
            dynTurbulence = clamp(0.16 + dynFlowLevel * 0.34 + dynSplashRate / 52, 0.16, 1.9);

            if (gain.gain?.setTargetAtTime) gain.gain.setTargetAtTime(nextVol, now, 0.05);
            else gain.gain.value = nextVol;
            if (bodyGain.gain?.setTargetAtTime) bodyGain.gain.setTargetAtTime(nextVol * (0.08 + dynFlowLevel * 0.24 + dynViscosity * 0.07), now, 0.08);
            else bodyGain.gain.value = nextVol * (0.08 + dynFlowLevel * 0.24 + dynViscosity * 0.07);
            if (churnGain.gain?.setTargetAtTime) churnGain.gain.setTargetAtTime(nextVol * (0.03 + dynTurbulence * 0.12), now, 0.07);
            else churnGain.gain.value = nextVol * (0.03 + dynTurbulence * 0.12);
            if (gurgleGain.gain?.setTargetAtTime) gurgleGain.gain.setTargetAtTime(nextVol * (0.05 + dynGurgleLevel * 0.1), now, 0.08);
            else gurgleGain.gain.value = nextVol * (0.05 + dynGurgleLevel * 0.1);
            if (gurgleSubGain.gain?.setTargetAtTime) gurgleSubGain.gain.setTargetAtTime(nextVol * (0.018 + dynGurgleLevel * 0.04), now, 0.1);
            else gurgleSubGain.gain.value = nextVol * (0.018 + dynGurgleLevel * 0.04);

            const flowFreq = Math.min(2100 + emitRate * 7 + dynFlowLevel * 450 + dynTurbulence * 150, 6400);
            if (bp.frequency?.setTargetAtTime) bp.frequency.setTargetAtTime(flowFreq, now, 0.08);
            else bp.frequency.value = flowFreq;
            const driftAmt = 120 + Math.min(emitRate * 1.4 + dynFlowLevel * 180, 520);
            if (driftGain.gain?.setTargetAtTime) driftGain.gain.setTargetAtTime(driftAmt, now, 0.1);
            else driftGain.gain.value = driftAmt;
            if (hp.frequency?.setTargetAtTime) hp.frequency.setTargetAtTime(1200 + dynBrightness * 0.22, now, 0.08);
            else hp.frequency.value = 1200 + dynBrightness * 0.22;
            if (bodyBP.frequency?.setTargetAtTime) bodyBP.frequency.setTargetAtTime(220 + dynFlowLevel * 200 + emitRate * 1.05, now, 0.1);
            else bodyBP.frequency.value = 220 + dynFlowLevel * 200 + emitRate * 1.05;
            if (churnBP.frequency?.setTargetAtTime) churnBP.frequency.setTargetAtTime(720 + dynBrightness * 0.18 + dynTurbulence * 210, now, 0.08);
            else churnBP.frequency.value = 720 + dynBrightness * 0.18 + dynTurbulence * 210;
            if (gurgle.frequency?.setTargetAtTime) gurgle.frequency.setTargetAtTime(45 + dynGurgleLevel * 52 + temp * 18, now, 0.12);
            else gurgle.frequency.value = 45 + dynGurgleLevel * 52 + temp * 18;
            if (gurgleSub.frequency?.setTargetAtTime) gurgleSub.frequency.setTargetAtTime(28 + dynGurgleLevel * 25 + dynViscosity * 11, now, 0.12);
            else gurgleSub.frequency.value = 28 + dynGurgleLevel * 25 + dynViscosity * 11;
        },
        stop() {
            alive = false;
            if (dropletTimer) clearTimeout(dropletTimer);
            if (bubbleTimer) clearTimeout(bubbleTimer);
            for (const n of nodes) { try { n.stop(); } catch {} }
            try { gain.disconnect(); } catch {}
            try { bodyGain.disconnect(); } catch {}
            try { churnGain.disconnect(); } catch {}
            try { gurgleGain.disconnect(); } catch {}
            try { gurgleSubGain.disconnect(); } catch {}
        }
    };
}

/** Plasma/electric buzz ambient — FM buzz + noise crackle */
export function ambient_electric(ctx, dest, p) {
    const vol = p.volume ?? 0.2;
    let alive = true;
    const nodes = [];
    let snapTimer = null;
    let dynVolume = vol;
    let dynTemp = 0.3;
    let dynRate = 40;
    let dynArc = 0.45;
    let dynBrightness = 2600;

    // FM buzz
    const mod = ctx.createOscillator();
    mod.type = 'sawtooth'; mod.frequency.value = 55;
    const modG = ctx.createGain(); modG.gain.value = 320;
    mod.connect(modG);
    const carrier = ctx.createOscillator();
    carrier.type = 'sine'; carrier.frequency.value = 120;
    modG.connect(carrier.frequency);
    const buzzGain = ctx.createGain();
    buzzGain.gain.value = vol * 0.26;
    carrier.connect(buzzGain).connect(dest);
    mod.start(); carrier.start();
    nodes.push(mod, carrier);

    const bed = noiseSource(ctx);
    const bedBP = ctx.createBiquadFilter();
    bedBP.type = 'bandpass';
    bedBP.frequency.value = 1700;
    bedBP.Q.value = 0.7;
    const bedGain = ctx.createGain();
    bedGain.gain.value = vol * 0.07;
    bed.connect(bedBP).connect(bedGain).connect(dest);
    bed.start();
    nodes.push(bed);

    // Random snaps
    function scheduleSnap() {
        if (!alive) return;
        const t = ctx.currentTime;
        const clusterCount = Math.floor(clamp(1 + dynRate / 42, 1, 4));
        let localDelay = 0;
        for (let i = 0; i < clusterCount; i++) {
            localDelay += -Math.log(Math.max(1e-4, Math.random())) * 0.005;
            const n = noiseShot(ctx, 0.015);
            const bp = ctx.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.value = dynBrightness * (0.65 + randRange(0, 0.55));
            bp.Q.value = 1.4 + dynArc * 0.7;
            const env = ctx.createGain();
            env.gain.setValueAtTime(0.0001, t);
            env.gain.setValueAtTime(dynArc * dynVolume * (0.18 + randRange(0, 0.24)), t + localDelay);
            env.gain.exponentialRampToValueAtTime(0.001, t + localDelay + 0.01 + randRange(0, 0.007));
            n.connect(bp).connect(env).connect(dest);
        }

        if (Math.random() < 0.16 + dynArc * 0.45) {
            const arc = ctx.createOscillator();
            arc.type = 'triangle';
            arc.frequency.setValueAtTime(1200 + dynTemp * 1800, t + 0.002);
            arc.frequency.exponentialRampToValueAtTime(300 + dynTemp * 500, t + 0.012 + dynArc * 0.008);
            const arcEnv = ctx.createGain();
            arcEnv.gain.setValueAtTime(0.0001, t);
            arcEnv.gain.setValueAtTime(dynVolume * (0.05 + dynArc * 0.09), t + 0.002);
            arcEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.014 + dynArc * 0.01);
            arc.connect(arcEnv).connect(dest);
            arc.start(t + 0.002);
            arc.stop(t + 0.03 + dynArc * 0.02);
        }

        const nextDelay = clamp(180 - dynRate * 0.7, 28, 220) + randRange(0, 90);
        snapTimer = setTimeout(scheduleSnap, nextDelay);
    }
    scheduleSnap();

    return {
        update(params) {
            const now = ctx.currentTime;
            const mappedImpactGain = Number.isFinite(params.impactGain) ? clamp(params.impactGain, 0.2, 2.2) : 1.0;
            const v = (params.volume ?? vol) * mappedImpactGain;
            const temp = Math.min((params.temperature ?? 500) / 2000, 1.0);
            const emitRate = Math.min(Math.max(params.emitRate ?? 0, 0), 200);
            const density = Math.min(Math.max(params.density ?? 0, 0), 200);
            const mappedBuzzFreq = Number.isFinite(params.buzzFreq) ? clamp(params.buzzFreq, 25, 220) : null;
            const mappedSnapRate = Number.isFinite(params.snapRate) ? clamp(params.snapRate, 2, 220) : null;
            const mappedArcLevel = Number.isFinite(params.arcLevel) ? clamp(params.arcLevel, 0, 2.0) : null;
            const mappedBrightness = Number.isFinite(params.brightness) ? clamp(params.brightness, 700, 9000) : null;

            dynVolume = v;
            const buzzVol = v * 0.22;
            if (buzzGain.gain?.setTargetAtTime) buzzGain.gain.setTargetAtTime(buzzVol, now, 0.05);
            else buzzGain.gain.value = buzzVol;

            dynTemp = temp;
            dynRate = mappedSnapRate ?? clamp(emitRate + density * 0.25, 2, 220);
            dynArc = mappedArcLevel != null ? clamp(mappedArcLevel / 1.2, 0.1, 1.8) : clamp(0.3 + temp * 0.65, 0.1, 1.7);
            dynBrightness = mappedBrightness ?? clamp(1700 + temp * 2600 + dynRate * 8, 1000, 9000);

            const carrierHz = mappedBuzzFreq ?? (90 + temp * 120);
            const modHz = 35 + Math.min(dynRate * 0.4, 90);
            dynTemp = temp;
            if (carrier.frequency?.setTargetAtTime) carrier.frequency.setTargetAtTime(carrierHz, now, 0.08);
            else carrier.frequency.value = carrierHz;
            if (mod.frequency?.setTargetAtTime) mod.frequency.setTargetAtTime(modHz, now, 0.08);
            else mod.frequency.value = modHz;
            if (modG.gain?.setTargetAtTime) modG.gain.setTargetAtTime(240 + dynArc * 250 + dynRate * 1.1, now, 0.08);
            else modG.gain.value = 240 + dynArc * 250 + dynRate * 1.1;
            if (bedBP.frequency?.setTargetAtTime) bedBP.frequency.setTargetAtTime(700 + dynBrightness * 0.42, now, 0.1);
            else bedBP.frequency.value = 700 + dynBrightness * 0.42;
            if (bedGain.gain?.setTargetAtTime) bedGain.gain.setTargetAtTime(v * (0.04 + dynArc * 0.08), now, 0.08);
            else bedGain.gain.value = v * (0.04 + dynArc * 0.08);
        },
        stop() {
            alive = false;
            if (snapTimer) clearTimeout(snapTimer);
            for (const n of nodes) { try { n.stop(); } catch {} }
            try { buzzGain.disconnect(); } catch {}
            try { bedGain.disconnect(); } catch {}
        }
    };
}

/** Smoke/steam/wind ambient — airy bandpass sweep */
export function ambient_wind(ctx, dest, p) {
    const vol = p.volume ?? 0.15;
    let alive = true;
    const nodes = [];
    let gustTimer = null;
    let dynVolume = vol;
    let dynGustiness = 0.5;
    let dynWhoosh = 0.45;
    let dynCutoff = 600;
    let dynScatter = 0.5;
    let dynBody = 0.45;
    let dynDryness = 0.6;

    const src = noiseSource(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 600; bp.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.value = vol;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 260;
    const whooshGain = ctx.createGain();
    whooshGain.gain.value = vol * 0.4;

    const whistle = ctx.createOscillator();
    whistle.type = 'triangle';
    whistle.frequency.value = 380;
    const whistleGain = ctx.createGain();
    whistleGain.gain.value = vol * 0.03;
    whistle.connect(whistleGain).connect(dest);
    whistle.start(); nodes.push(whistle);

    // Slow sweep
    const lfo = ctx.createOscillator();
    lfo.type = 'sine'; lfo.frequency.value = 0.08;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 400;
    lfo.connect(lfoG).connect(bp.frequency);
    lfo.start(); nodes.push(lfo);

    const gustLfo = ctx.createOscillator();
    gustLfo.type = 'triangle'; gustLfo.frequency.value = 0.18;
    const gustDepth = ctx.createGain();
    gustDepth.gain.value = vol * 0.18;
    gustLfo.connect(gustDepth).connect(gain.gain);
    gustLfo.connect(gustDepth).connect(whooshGain.gain);
    gustLfo.start(); nodes.push(gustLfo);

    src.connect(bp).connect(gain).connect(dest);
    src.connect(lp).connect(whooshGain).connect(dest);
    src.start(); nodes.push(src);

    function scheduleGust() {
        if (!alive) return;
        const now = ctx.currentTime;
        const gust = noiseShot(ctx, 0.06 + dynScatter * 0.045 + randRange(0, 0.05));
        const gustBP = ctx.createBiquadFilter();
        gustBP.type = 'bandpass';
        gustBP.frequency.value = dynCutoff * (0.72 + randRange(0, 0.3 + dynScatter * 0.35));
        gustBP.Q.value = 0.9;
        const gustEnv = ctx.createGain();
        gustEnv.gain.setValueAtTime(0.0001, now);
        gustEnv.gain.setValueAtTime(dynVolume * (0.05 + dynGustiness * 0.08 + dynScatter * 0.06), now + 0.01);
        gustEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.08 + randRange(0, 0.04));
        gust.connect(gustBP).connect(gustEnv).connect(dest);

        const nextDelay = clamp(850 - dynGustiness * 360 - dynScatter * 120, 160, 900) + randRange(0, 220);
        gustTimer = setTimeout(scheduleGust, nextDelay);
    }
    scheduleGust();

    return {
        update(params) {
            const now = ctx.currentTime;
            const v = params.volume ?? vol;
            const speed = Math.min(Math.max(params.avgVelocity ?? 1, 0), 20);
            const temp = Math.min((params.temperature ?? 300) / 1500, 1.0);
            const mappedCutoff = Number.isFinite(params.cutoff) ? clamp(params.cutoff, 220, 6200) : null;
            const mappedGustiness = Number.isFinite(params.gustiness) ? clamp(params.gustiness, 0.1, 2.0) : null;
            const mappedWhoosh = Number.isFinite(params.whooshLevel) ? clamp(params.whooshLevel, 0, 2.0) : null;
            const mappedScatter = Number.isFinite(params.scatter) ? clamp(params.scatter, 0.1, 2.2) : null;
            const mappedBody = Number.isFinite(params.bodyLevel) ? clamp(params.bodyLevel, 0.05, 2.2) : null;
            const mappedDryness = Number.isFinite(params.dryness) ? clamp(params.dryness, 0.05, 2.2) : null;

            dynVolume = v;
            dynScatter = mappedScatter ?? clamp(0.25 + (params.emitRate ?? 0) * 0.01, 0.1, 2.0);
            dynBody = mappedBody ?? clamp(0.22 + (params.density ?? 0) * 0.015, 0.1, 2.0);
            dynDryness = mappedDryness ?? clamp(0.2 + temp * 0.9, 0.05, 2.0);

            dynGustiness = mappedGustiness ?? clamp(0.2 + speed * 0.045 + dynScatter * 0.35 + (params.emitRate ?? 0) * 0.003, 0.1, 2.0);
            dynWhoosh = mappedWhoosh ?? clamp(0.16 + temp * 0.5 + dynBody * 0.42, 0.05, 1.9);
            dynCutoff = mappedCutoff ?? clamp(360 + speed * 80 + temp * 420 + dynDryness * 260, 220, 6200);
            const lowWhoosh = 150 + speed * 20 + dynWhoosh * 42 + dynBody * 35;

            if (gain.gain?.setTargetAtTime) gain.gain.setTargetAtTime(v * (0.92 + dynBody * 0.05), now, 0.05);
            else gain.gain.value = v * (0.92 + dynBody * 0.05);
            if (bp.frequency?.setTargetAtTime) bp.frequency.setTargetAtTime(dynCutoff, now, 0.08);
            else bp.frequency.value = dynCutoff;
            if (lp.frequency?.setTargetAtTime) lp.frequency.setTargetAtTime(lowWhoosh, now, 0.1);
            else lp.frequency.value = lowWhoosh;
            if (whooshGain.gain?.setTargetAtTime) whooshGain.gain.setTargetAtTime(v * (0.14 + dynWhoosh * 0.22 + dynBody * 0.08 + speed * 0.004), now, 0.08);
            else whooshGain.gain.value = v * (0.14 + dynWhoosh * 0.22 + dynBody * 0.08 + speed * 0.004);
            if (gustDepth.gain?.setTargetAtTime) gustDepth.gain.setTargetAtTime(v * (0.04 + dynGustiness * 0.07 + dynScatter * 0.05), now, 0.1);
            else gustDepth.gain.value = v * (0.04 + dynGustiness * 0.07 + dynScatter * 0.05);
            if (whistle.frequency?.setTargetAtTime) whistle.frequency.setTargetAtTime(200 + dynCutoff * 0.38 + dynDryness * 70, now, 0.12);
            else whistle.frequency.value = 200 + dynCutoff * 0.38 + dynDryness * 70;
            if (whistleGain.gain?.setTargetAtTime) whistleGain.gain.setTargetAtTime(v * (0.008 + dynGustiness * 0.012 + dynDryness * 0.008), now, 0.1);
            else whistleGain.gain.value = v * (0.008 + dynGustiness * 0.012 + dynDryness * 0.008);
        },
        stop() {
            alive = false;
            if (gustTimer) clearTimeout(gustTimer);
            for (const n of nodes) { try { n.stop(); } catch {} }
            try { gain.disconnect(); } catch {}
            try { whooshGain.disconnect(); } catch {}
            try { whistleGain.disconnect(); } catch {}
        }
    };
}

// ============================================================================
// PATCH REGISTRY
// ============================================================================

/** Map of proceduralPatch strings → impact patch functions */
export const IMPACT_PATCHES = {
    // Canonical patch names (match substance audio.proceduralPatch values)
    fluid:                impact_fluid,
    drop:                 impact_drop,
    hiss:                 impact_hiss,
    crackle:              impact_crackle,
    combustion:           impact_combustion,
    modal_impact_metal:   impact_metal,
    modal_impact_glass:   impact_glass,
    modal_impact_stone:   impact_stone,
    modal_impact_wood:    impact_wood,
    modal_impact_ice:     impact_ice,
    electric:             impact_electric,
    sand:                 impact_sand,
    // Substance key aliases
    water:   impact_fluid,
    lava:    impact_combustion,
    fire:    impact_combustion,
    metal:   impact_metal,
    glass:   impact_glass,
    stone:   impact_stone,
    ice:     impact_ice,
    wood:    impact_wood,
    plasma:  impact_electric,
    sparks:  impact_crackle,     // sparks → crackle (not electric)
    debris:  impact_crackle,     // debris → crackle (not stone)
    snow:    impact_hiss,        // snow → hiss (not sand)
    wax:     impact_drop,        // wax → drop (viscous)
    oil:     impact_drop,        // oil → drop (viscous)
    mercury: impact_drop,        // mercury → drop (viscous)
    acid:    impact_hiss,        // acid → hiss (corrosive vapor)
    blood:   impact_drop,        // blood → drop (viscous)
    honey:   impact_drop,        // honey → drop (viscous)
    smoke:   impact_hiss,        // smoke → hiss (gas)
    steam:   impact_hiss,        // steam → hiss (vapor)
    // Chemical formula aliases (from substance/element table)
    H2O:     impact_fluid,
    SiO2:    impact_glass,
    ite:     impact_stone,
    ite2:    impact_stone,
    ite3:    impact_stone,
    Fe:      impact_metal,
    Cu:      impact_metal,
    Al:      impact_metal,
    Au:      impact_metal,
    Ag:      impact_metal,
    NaCl:    impact_stone,
    ite4:    impact_stone,
    C:       impact_wood,
    Hg:      impact_drop,
    oil2:    impact_drop,
    HCl:     impact_hiss,
    H2SO4:   impact_hiss,
    // Footstep patches (from FootstepPatches.js)
    ...FOOTSTEP_PATCHES,
    // Body foley patches (from BodyFoleyPatches.js)
    ...BODY_FOLEY_PATCHES,
};

/** Map of proceduralPatch strings → ambient patch functions */
export const AMBIENT_PATCHES = {
    // Canonical patch names
    combustion:  ambient_combustion,
    fluid:       ambient_fluid,
    drop:        ambient_fluid,     // viscous liquids share fluid ambient
    electric:    ambient_electric,
    crackle:     ambient_electric,  // spark crackle shares electric ambient
    wind:        ambient_wind,
    hiss:        ambient_wind,      // gas/vapor hiss shares wind ambient
    // Substance key aliases
    water:   ambient_fluid,    // active water emitters get subtle trickle ambient
    fire:    ambient_combustion,
    lava:    ambient_combustion,
    oil:     ambient_fluid,
    mercury: ambient_fluid,
    acid:    ambient_fluid,
    blood:   ambient_fluid,
    honey:   ambient_fluid,
    wax:     ambient_fluid,
    plasma:  ambient_electric,
    sparks:  ambient_electric,
    smoke:   ambient_wind,
    steam:   ambient_wind,
    sand:    ambient_wind,
    snow:    ambient_wind,
    debris:  ambient_wind,
    // Chemical formula aliases
    Hg:      ambient_fluid,
    HCl:     ambient_fluid,
    H2SO4:   ambient_fluid,
    SiO2:    ambient_wind,
    Fe:      ambient_wind,
    NaCl:    ambient_wind,
};

/**
 * Get the impact patch function for a substance key.
 * If runtime overrides exist for this key, returns a wrapper that merges them.
 * @param {string} key - Substance key or proceduralPatch name
 * @returns {Function|null}
 */
export function getImpactPatch(key) {
    const fn = IMPACT_PATCHES[key];
    if (!fn) return null;
    const overrides = PATCH_OVERRIDES.get(key);
    if (!overrides) return fn;
    // Return a wrapper that merges overrides into params
    return (ctx, dest, p) => fn(ctx, dest, { ...p, ...overrides });
}

/**
 * Get the ambient patch function for a substance key.
 * If runtime overrides exist for this key, returns a wrapper that merges them.
 * @param {string} key - Substance key or proceduralPatch name
 * @returns {Function|null}
 */
export function getAmbientPatch(key) {
    const fn = AMBIENT_PATCHES[key];
    if (!fn) return null;
    const overrides = PATCH_OVERRIDES.get(key);
    if (!overrides) return fn;
    return (ctx, dest, p) => fn(ctx, dest, { ...p, ...overrides });
}

// ============================================================================
// RUNTIME PATCH OVERRIDES
// ============================================================================

/** Per-material param overrides set at runtime from the editor */
const PATCH_OVERRIDES = new Map();

/**
 * Set a param override for a material patch.
 * These overrides are merged into patch params at call time.
 * @param {string} key - Material key (e.g. 'water', 'metal', 'fire')
 * @param {string} param - Param name ('volume', 'pitch', 'speed', 'temperature', 'quality')
 * @param {number} value
 */
export function setPatchOverride(key, param, value) {
    let o = PATCH_OVERRIDES.get(key);
    if (!o) { o = {}; PATCH_OVERRIDES.set(key, o); }
    o[param] = value;
}

/**
 * Set all overrides for a material at once.
 * @param {string} key
 * @param {Object} overrides - { volume, pitch, speed, temperature, quality }
 */
export function setPatchOverrides(key, overrides) {
    PATCH_OVERRIDES.set(key, { ...overrides });
}

/**
 * Get current overrides for a material.
 * @param {string} key
 * @returns {Object|null}
 */
export function getPatchOverride(key) {
    return PATCH_OVERRIDES.get(key) || null;
}

/**
 * Clear all runtime overrides (reset to defaults).
 */
export function clearPatchOverrides() {
    PATCH_OVERRIDES.clear();
}

/**
 * Get all unique canonical material keys (de-duplicated patch function names).
 * Returns objects with { key, type, patchFn } for both impact and ambient.
 */
export function getAllPatchKeys() {
    // Collect unique impact patch types (de-dup by function reference)
    const seen = new Map();
    const keys = [];
    for (const [k, fn] of Object.entries(IMPACT_PATCHES)) {
        if (!seen.has(fn)) {
            seen.set(fn, k);
            keys.push({ key: k, impactFn: fn, ambientFn: AMBIENT_PATCHES[k] || null });
        }
    }
    return keys;
}

/**
 * Get a flat list of all material alias keys (including duplicates).
 */
export function getAllMaterialAliases() {
    return Object.keys(IMPACT_PATCHES);
}
