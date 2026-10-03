// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * FootstepPatches.js - Procedural Footstep Sound Generators
 * 
 * Generates material-specific footstep sounds procedurally using Web Audio API.
 * Each patch creates layered sounds (body impact + surface texture) with
 * parameters for speed, weight, and pitch variation.
 */

import { uniformDistribution } from '../../core/math/MathRandom.js';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

function noiseBuffer(ctx, duration) {
  const sr = ctx.sampleRate;
  const len = Math.ceil(sr * duration);
  const buf = ctx.createBuffer(1, len, sr);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    data[i] = uniformDistribution(-1, 1, Math.random);
  }
  return buf;
}

function envelope(ctx, peak, attack, sustain, release) {
  const gain = ctx.createGain();
  const t = ctx.currentTime;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(peak, t + attack);
  gain.gain.setValueAtTime(peak, t + attack + sustain);
  gain.gain.exponentialRampToValueAtTime(0.001, t + attack + sustain + release);
  return gain;
}

// ============================================================================
// TERRAIN FOOTSTEPS
// ============================================================================

/**
 * Dirt footstep — muffled thud + grain scatter
 */
export function footstep_dirt(ctx, dest, p) {
  const t = ctx.currentTime;
  const vol = (p.volume ?? 0.4) * (p.weight ?? 1.0);
  const pitch = p.pitch ?? 1.0;
  const speed = p.speed ?? 1.0;
  
  const nodes = [];
  
  // Layer 1: Thud body (low bandpass noise)
  const thudDur = 0.08 + 0.02 / Math.max(speed, 0.4);
  const thudBuf = noiseBuffer(ctx, thudDur);
  const thudSrc = ctx.createBufferSource();
  thudSrc.buffer = thudBuf;
  const thudLP = ctx.createBiquadFilter();
  thudLP.type = 'lowpass';
  thudLP.frequency.value = uniformDistribution(180, 260, Math.random) * pitch;
  thudLP.Q.value = 1.8;
  const thudGain = envelope(ctx, vol * 0.6, 0.002, 0.01, thudDur - 0.012);
  thudSrc.connect(thudLP).connect(thudGain).connect(dest);
  thudSrc.start(t);
  nodes.push(thudSrc, thudLP, thudGain);
  
  // Layer 2: Grain scatter (high-freq crunch)
  const grainDur = uniformDistribution(0.04, 0.07, Math.random);
  const grainBuf = noiseBuffer(ctx, grainDur);
  const grainSrc = ctx.createBufferSource();
  grainSrc.buffer = grainBuf;
  const grainHP = ctx.createBiquadFilter();
  grainHP.type = 'highpass';
  grainHP.frequency.value = uniformDistribution(1200, 1800, Math.random) * pitch;
  grainHP.Q.value = 0.6;
  const grainGain = envelope(ctx, vol * 0.25, 0.001, 0.005, grainDur - 0.006);
  grainSrc.connect(grainHP).connect(grainGain).connect(dest);
  grainSrc.start(t);
  nodes.push(grainSrc, grainHP, grainGain);
  
  return { stop: () => nodes.forEach(n => { try { n.disconnect(); } catch (_) {} }) };
}

/**
 * Grass footstep — soft rustle + muffled thud
 */
export function footstep_grass(ctx, dest, p) {
  const t = ctx.currentTime;
  const vol = (p.volume ?? 0.35) * (p.weight ?? 1.0);
  const pitch = p.pitch ?? 1.0;
  
  const nodes = [];
  
  // Rustle layer (high-freq noise)
  const rustleDur = uniformDistribution(0.06, 0.1, Math.random);
  const rustleBuf = noiseBuffer(ctx, rustleDur);
  const rustleSrc = ctx.createBufferSource();
  rustleSrc.buffer = rustleBuf;
  const rustleBP = ctx.createBiquadFilter();
  rustleBP.type = 'bandpass';
  rustleBP.frequency.value = uniformDistribution(2400, 3600, Math.random) * pitch;
  rustleBP.Q.value = 2.5;
  const rustleGain = envelope(ctx, vol * 0.4, 0.003, 0.008, rustleDur - 0.011);
  rustleSrc.connect(rustleBP).connect(rustleGain).connect(dest);
  rustleSrc.start(t);
  nodes.push(rustleSrc, rustleBP, rustleGain);
  
  // Soft thud (low-freq body)
  const thudDur = 0.05;
  const thudBuf = noiseBuffer(ctx, thudDur);
  const thudSrc = ctx.createBufferSource();
  thudSrc.buffer = thudBuf;
  const thudLP = ctx.createBiquadFilter();
  thudLP.type = 'lowpass';
  thudLP.frequency.value = 150 * pitch;
  thudLP.Q.value = 1.2;
  const thudGain = envelope(ctx, vol * 0.3, 0.002, 0.006, thudDur - 0.008);
  thudSrc.connect(thudLP).connect(thudGain).connect(dest);
  thudSrc.start(t);
  nodes.push(thudSrc, thudLP, thudGain);
  
  return { stop: () => nodes.forEach(n => { try { n.disconnect(); } catch (_) {} }) };
}

/**
 * Sand footstep — soft grain scatter + muffled impact
 */
export function footstep_sand(ctx, dest, p) {
  const t = ctx.currentTime;
  const vol = (p.volume ?? 0.3) * (p.weight ?? 1.0) * 0.6;
  const pitch = p.pitch ?? 1.0;
  
  const nodes = [];
  
  // Grain scatter (mid-freq filtered noise)
  const scatterDur = uniformDistribution(0.09, 0.14, Math.random);
  const scatterBuf = noiseBuffer(ctx, scatterDur);
  const scatterSrc = ctx.createBufferSource();
  scatterSrc.buffer = scatterBuf;
  const scatterBP = ctx.createBiquadFilter();
  scatterBP.type = 'bandpass';
  scatterBP.frequency.value = uniformDistribution(800, 1400, Math.random) * pitch;
  scatterBP.Q.value = 1.5;
  const scatterGain = envelope(ctx, vol * 0.5, 0.005, 0.015, scatterDur - 0.02);
  scatterSrc.connect(scatterBP).connect(scatterGain).connect(dest);
  scatterSrc.start(t);
  nodes.push(scatterSrc, scatterBP, scatterGain);
  
  // Muffled body impact
  const bodyDur = 0.06;
  const bodyBuf = noiseBuffer(ctx, bodyDur);
  const bodySrc = ctx.createBufferSource();
  bodySrc.buffer = bodyBuf;
  const bodyLP = ctx.createBiquadFilter();
  bodyLP.type = 'lowpass';
  bodyLP.frequency.value = 120 * pitch;
  bodyLP.Q.value = 0.8;
  const bodyGain = envelope(ctx, vol * 0.35, 0.003, 0.008, bodyDur - 0.011);
  bodySrc.connect(bodyLP).connect(bodyGain).connect(dest);
  bodySrc.start(t);
  nodes.push(bodySrc, bodyLP, bodyGain);
  
  return { stop: () => nodes.forEach(n => { try { n.disconnect(); } catch (_) {} }) };
}

/**
 * Gravel footstep — sharp scatter + rattle
 */
export function footstep_gravel(ctx, dest, p) {
  const t = ctx.currentTime;
  const vol = (p.volume ?? 0.45) * (p.weight ?? 1.0);
  const pitch = p.pitch ?? 1.0;
  
  const nodes = [];
  
  // Sharp scatter (bright noise bursts)
  const scatterCount = Math.floor(uniformDistribution(3, 6, Math.random));
  for (let i = 0; i < scatterCount; i++) {
    const delay = uniformDistribution(0, 0.03, Math.random);
    const dur = uniformDistribution(0.01, 0.025, Math.random);
    const buf = noiseBuffer(ctx, dur);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = uniformDistribution(1800, 2800, Math.random) * pitch;
    hp.Q.value = 0.5;
    const gain = envelope(ctx, vol * 0.2, 0.001, 0.002, dur - 0.003);
    src.connect(hp).connect(gain).connect(dest);
    src.start(t + delay);
    nodes.push(src, hp, gain);
  }
  
  // Body impact
  const bodyDur = 0.05;
  const bodyBuf = noiseBuffer(ctx, bodyDur);
  const bodySrc = ctx.createBufferSource();
  bodySrc.buffer = bodyBuf;
  const bodyLP = ctx.createBiquadFilter();
  bodyLP.type = 'lowpass';
  bodyLP.frequency.value = 200 * pitch;
  bodyLP.Q.value = 1.5;
  const bodyGain = envelope(ctx, vol * 0.4, 0.002, 0.008, bodyDur - 0.01);
  bodySrc.connect(bodyLP).connect(bodyGain).connect(dest);
  bodySrc.start(t);
  nodes.push(bodySrc, bodyLP, bodyGain);
  
  return { stop: () => nodes.forEach(n => { try { n.disconnect(); } catch (_) {} }) };
}

/**
 * Mud footstep — wet squelch + suction release
 */
export function footstep_mud(ctx, dest, p) {
  const t = ctx.currentTime;
  const vol = (p.volume ?? 0.4) * (p.weight ?? 1.0);
  const pitch = p.pitch ?? 1.0;
  
  const nodes = [];
  
  // Squelch (low-freq filtered noise)
  const squelchDur = 0.08;
  const squelchBuf = noiseBuffer(ctx, squelchDur);
  const squelchSrc = ctx.createBufferSource();
  squelchSrc.buffer = squelchBuf;
  const squelchLP = ctx.createBiquadFilter();
  squelchLP.type = 'lowpass';
  squelchLP.frequency.value = uniformDistribution(250, 350, Math.random) * pitch;
  squelchLP.Q.value = 2.0;
  const squelchGain = envelope(ctx, vol * 0.5, 0.005, 0.012, squelchDur - 0.017);
  squelchSrc.connect(squelchLP).connect(squelchGain).connect(dest);
  squelchSrc.start(t);
  nodes.push(squelchSrc, squelchLP, squelchGain);
  
  // Suction pop (brief pitch sweep)
  const popOsc = ctx.createOscillator();
  popOsc.type = 'sine';
  popOsc.frequency.setValueAtTime(180 * pitch, t + 0.03);
  popOsc.frequency.exponentialRampToValueAtTime(80 * pitch, t + 0.08);
  const popGain = envelope(ctx, vol * 0.25, 0.002, 0.005, 0.04);
  popOsc.connect(popGain).connect(dest);
  popOsc.start(t + 0.03);
  popOsc.stop(t + 0.11);
  nodes.push(popOsc, popGain);
  
  return { stop: () => nodes.forEach(n => { try { n.disconnect(); } catch (_) {} }) };
}

/**
 * Snow footstep — soft crunch + squeak
 */
export function footstep_snow(ctx, dest, p) {
  const t = ctx.currentTime;
  const vol = (p.volume ?? 0.35) * (p.weight ?? 1.0);
  const pitch = p.pitch ?? 1.0;
  
  const nodes = [];
  
  // Crunch (mid-high filtered noise)
  const crunchDur = 0.07;
  const crunchBuf = noiseBuffer(ctx, crunchDur);
  const crunchSrc = ctx.createBufferSource();
  crunchSrc.buffer = crunchBuf;
  const crunchBP = ctx.createBiquadFilter();
  crunchBP.type = 'bandpass';
  crunchBP.frequency.value = uniformDistribution(1400, 2200, Math.random) * pitch;
  crunchBP.Q.value = 2.2;
  const crunchGain = envelope(ctx, vol * 0.4, 0.004, 0.01, crunchDur - 0.014);
  crunchSrc.connect(crunchBP).connect(crunchGain).connect(dest);
  crunchSrc.start(t);
  nodes.push(crunchSrc, crunchBP, crunchGain);
  
  // Squeak (high sine)
  const squeakOsc = ctx.createOscillator();
  squeakOsc.type = 'sine';
  squeakOsc.frequency.value = uniformDistribution(2200, 3000, Math.random) * pitch;
  const squeakGain = envelope(ctx, vol * 0.15, 0.003, 0.008, 0.025);
  squeakOsc.connect(squeakGain).connect(dest);
  squeakOsc.start(t + 0.01);
  squeakOsc.stop(t + 0.046);
  nodes.push(squeakOsc, squeakGain);
  
  return { stop: () => nodes.forEach(n => { try { n.disconnect(); } catch (_) {} }) };
}

// ============================================================================
// HARD SURFACE FOOTSTEPS
// ============================================================================

/**
 * Stone footstep — hard impact + high-freq crack
 */
export function footstep_stone(ctx, dest, p) {
  const t = ctx.currentTime;
  const vol = (p.volume ?? 0.5) * (p.weight ?? 1.0);
  const pitch = p.pitch ?? 1.0;
  
  const nodes = [];
  
  // Impact transient (short noise burst)
  const impactDur = 0.02;
  const impactBuf = noiseBuffer(ctx, impactDur);
  const impactSrc = ctx.createBufferSource();
  impactSrc.buffer = impactBuf;
  const impactHP = ctx.createBiquadFilter();
  impactHP.type = 'highpass';
  impactHP.frequency.value = 400 * pitch;
  impactHP.Q.value = 0.7;
  const impactGain = envelope(ctx, vol * 0.7, 0.001, 0.003, impactDur - 0.004);
  impactSrc.connect(impactHP).connect(impactGain).connect(dest);
  impactSrc.start(t);
  nodes.push(impactSrc, impactHP, impactGain);
  
  // Crack (bright noise tail)
  const crackDur = 0.04;
  const crackBuf = noiseBuffer(ctx, crackDur);
  const crackSrc = ctx.createBufferSource();
  crackSrc.buffer = crackBuf;
  const crackBP = ctx.createBiquadFilter();
  crackBP.type = 'bandpass';
  crackBP.frequency.value = uniformDistribution(2800, 4000, Math.random) * pitch;
  crackBP.Q.value = 1.8;
  const crackGain = envelope(ctx, vol * 0.3, 0.001, 0.005, crackDur - 0.006);
  crackSrc.connect(crackBP).connect(crackGain).connect(dest);
  crackSrc.start(t);
  nodes.push(crackSrc, crackBP, crackGain);
  
  return { stop: () => nodes.forEach(n => { try { n.disconnect(); } catch (_) {} }) };
}

/**
 * Concrete footstep — dull thud + mid-freq resonance
 */
export function footstep_concrete(ctx, dest, p) {
  const t = ctx.currentTime;
  const vol = (p.volume ?? 0.48) * (p.weight ?? 1.0);
  const pitch = p.pitch ?? 1.0;
  
  const nodes = [];
  
  // Thud body
  const thudDur = 0.06;
  const thudBuf = noiseBuffer(ctx, thudDur);
  const thudSrc = ctx.createBufferSource();
  thudSrc.buffer = thudBuf;
  const thudLP = ctx.createBiquadFilter();
  thudLP.type = 'lowpass';
  thudLP.frequency.value = 350 * pitch;
  thudLP.Q.value = 1.0;
  const thudGain = envelope(ctx, vol * 0.6, 0.002, 0.01, thudDur - 0.012);
  thudSrc.connect(thudLP).connect(thudGain).connect(dest);
  thudSrc.start(t);
  nodes.push(thudSrc, thudLP, thudGain);
  
  // Mid resonance
  const resOsc = ctx.createOscillator();
  resOsc.type = 'sine';
  resOsc.frequency.value = uniformDistribution(320, 400, Math.random) * pitch;
  const resGain = envelope(ctx, vol * 0.2, 0.003, 0.008, 0.03);
  resOsc.connect(resGain).connect(dest);
  resOsc.start(t);
  resOsc.stop(t + 0.041);
  nodes.push(resOsc, resGain);
  
  return { stop: () => nodes.forEach(n => { try { n.disconnect(); } catch (_) {} }) };
}

/**
 * Marble footstep — bright click + ring
 */
export function footstep_marble(ctx, dest, p) {
  const t = ctx.currentTime;
  const vol = (p.volume ?? 0.45) * (p.weight ?? 1.0);
  const pitch = p.pitch ?? 1.0;
  
  const nodes = [];
  
  // Click (sharp transient)
  const clickDur = 0.015;
  const clickBuf = noiseBuffer(ctx, clickDur);
  const clickSrc = ctx.createBufferSource();
  clickSrc.buffer = clickBuf;
  const clickHP = ctx.createBiquadFilter();
  clickHP.type = 'highpass';
  clickHP.frequency.value = 1200 * pitch;
  clickHP.Q.value = 0.5;
  const clickGain = envelope(ctx, vol * 0.6, 0.0005, 0.002, clickDur - 0.0025);
  clickSrc.connect(clickHP).connect(clickGain).connect(dest);
  clickSrc.start(t);
  nodes.push(clickSrc, clickHP, clickGain);
  
  // Ring (bright sine decay)
  const ringOsc = ctx.createOscillator();
  ringOsc.type = 'sine';
  ringOsc.frequency.value = uniformDistribution(1800, 2400, Math.random) * pitch;
  const ringGain = envelope(ctx, vol * 0.25, 0.001, 0.005, 0.04);
  ringOsc.connect(ringGain).connect(dest);
  ringOsc.start(t);
  ringOsc.stop(t + 0.046);
  nodes.push(ringOsc, ringGain);
  
  return { stop: () => nodes.forEach(n => { try { n.disconnect(); } catch (_) {} }) };
}

/**
 * Brick footstep — textured impact + dust scatter
 */
export function footstep_brick(ctx, dest, p) {
  const t = ctx.currentTime;
  const vol = (p.volume ?? 0.46) * (p.weight ?? 1.0);
  const pitch = p.pitch ?? 1.0;
  
  const nodes = [];
  
  // Impact (mid-freq noise)
  const impactDur = 0.05;
  const impactBuf = noiseBuffer(ctx, impactDur);
  const impactSrc = ctx.createBufferSource();
  impactSrc.buffer = impactBuf;
  const impactBP = ctx.createBiquadFilter();
  impactBP.type = 'bandpass';
  impactBP.frequency.value = uniformDistribution(600, 1000, Math.random) * pitch;
  impactBP.Q.value = 1.2;
  const impactGain = envelope(ctx, vol * 0.55, 0.002, 0.008, impactDur - 0.01);
  impactSrc.connect(impactBP).connect(impactGain).connect(dest);
  impactSrc.start(t);
  nodes.push(impactSrc, impactBP, impactGain);
  
  // Dust scatter (high-freq tail)
  const dustDur = 0.03;
  const dustBuf = noiseBuffer(ctx, dustDur);
  const dustSrc = ctx.createBufferSource();
  dustSrc.buffer = dustBuf;
  const dustHP = ctx.createBiquadFilter();
  dustHP.type = 'highpass';
  dustHP.frequency.value = 2000 * pitch;
  dustHP.Q.value = 0.8;
  const dustGain = envelope(ctx, vol * 0.2, 0.002, 0.005, dustDur - 0.007);
  dustSrc.connect(dustHP).connect(dustGain).connect(dest);
  dustSrc.start(t + 0.01);
  nodes.push(dustSrc, dustHP, dustGain);
  
  return { stop: () => nodes.forEach(n => { try { n.disconnect(); } catch (_) {} }) };
}

// ============================================================================
// WOOD FOOTSTEPS
// ============================================================================

/**
 * Wood plank footstep — resonant body + plank slap
 */
export function footstep_wood_plank(ctx, dest, p) {
  const t = ctx.currentTime;
  const vol = (p.volume ?? 0.44) * (p.weight ?? 1.0);
  const pitch = p.pitch ?? 1.0;
  
  const nodes = [];
  
  // Slap transient
  const slapDur = 0.025;
  const slapBuf = noiseBuffer(ctx, slapDur);
  const slapSrc = ctx.createBufferSource();
  slapSrc.buffer = slapBuf;
  const slapBP = ctx.createBiquadFilter();
  slapBP.type = 'bandpass';
  slapBP.frequency.value = uniformDistribution(800, 1200, Math.random) * pitch;
  slapBP.Q.value = 1.5;
  const slapGain = envelope(ctx, vol * 0.6, 0.001, 0.004, slapDur - 0.005);
  slapSrc.connect(slapBP).connect(slapGain).connect(dest);
  slapSrc.start(t);
  nodes.push(slapSrc, slapBP, slapGain);
  
  // Resonant body (multi-mode)
  const freqs = [220, 340, 480];
  freqs.forEach((f, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f * pitch * uniformDistribution(0.98, 1.02, Math.random);
    const gain = envelope(ctx, vol * (0.15 - i * 0.03), 0.002, 0.01, 0.05 + i * 0.01);
    osc.connect(gain).connect(dest);
    osc.start(t);
    osc.stop(t + 0.062 + i * 0.01);
    nodes.push(osc, gain);
  });
  
  return { stop: () => nodes.forEach(n => { try { n.disconnect(); } catch (_) {} }) };
}

/**
 * Wood creak footstep — creaking friction + resonance
 */
export function footstep_wood_creak(ctx, dest, p) {
  const t = ctx.currentTime;
  const vol = (p.volume ?? 0.42) * (p.weight ?? 1.0);
  const pitch = p.pitch ?? 1.0;
  
  const nodes = [];
  
  // Creak (frequency sweep)
  const creakOsc = ctx.createOscillator();
  creakOsc.type = 'sawtooth';
  creakOsc.frequency.setValueAtTime(180 * pitch, t);
  creakOsc.frequency.exponentialRampToValueAtTime(120 * pitch, t + 0.08);
  const creakLP = ctx.createBiquadFilter();
  creakLP.type = 'lowpass';
  creakLP.frequency.value = 600 * pitch;
  creakLP.Q.value = 2.0;
  const creakGain = envelope(ctx, vol * 0.4, 0.01, 0.02, 0.05);
  creakOsc.connect(creakLP).connect(creakGain).connect(dest);
  creakOsc.start(t);
  creakOsc.stop(t + 0.08);
  nodes.push(creakOsc, creakLP, creakGain);
  
  // Slap
  const slapDur = 0.02;
  const slapBuf = noiseBuffer(ctx, slapDur);
  const slapSrc = ctx.createBufferSource();
  slapSrc.buffer = slapBuf;
  const slapBP = ctx.createBiquadFilter();
  slapBP.type = 'bandpass';
  slapBP.frequency.value = 900 * pitch;
  slapBP.Q.value = 1.2;
  const slapGain = envelope(ctx, vol * 0.35, 0.001, 0.003, slapDur - 0.004);
  slapSrc.connect(slapBP).connect(slapGain).connect(dest);
  slapSrc.start(t);
  nodes.push(slapSrc, slapBP, slapGain);
  
  return { stop: () => nodes.forEach(n => { try { n.disconnect(); } catch (_) {} }) };
}

// ============================================================================
// METAL FOOTSTEPS
// ============================================================================

/**
 * Metal solid footstep — clang + ring
 */
export function footstep_metal_solid(ctx, dest, p) {
  const t = ctx.currentTime;
  const vol = (p.volume ?? 0.48) * (p.weight ?? 1.0);
  const pitch = p.pitch ?? 1.0;
  
  const nodes = [];
  
  // Clang (noise burst + partials)
  const clangDur = 0.02;
  const clangBuf = noiseBuffer(ctx, clangDur);
  const clangSrc = ctx.createBufferSource();
  clangSrc.buffer = clangBuf;
  const clangHP = ctx.createBiquadFilter();
  clangHP.type = 'highpass';
  clangHP.frequency.value = 800 * pitch;
  clangHP.Q.value = 0.6;
  const clangGain = envelope(ctx, vol * 0.65, 0.0008, 0.002, clangDur - 0.0028);
  clangSrc.connect(clangHP).connect(clangGain).connect(dest);
  clangSrc.start(t);
  nodes.push(clangSrc, clangHP, clangGain);
  
  // Ring (inharmonic partials)
  const partials = [520, 870, 1340, 2100];
  partials.forEach((f, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f * pitch * uniformDistribution(0.97, 1.03, Math.random);
    const gain = envelope(ctx, vol * (0.2 - i * 0.04), 0.001, 0.008, 0.06 + i * 0.015);
    osc.connect(gain).connect(dest);
    osc.start(t);
    osc.stop(t + 0.069 + i * 0.015);
    nodes.push(osc, gain);
  });
  
  return { stop: () => nodes.forEach(n => { try { n.disconnect(); } catch (_) {} }) };
}

/**
 * Metal grate footstep — rattle + metallic ring
 */
export function footstep_metal_grate(ctx, dest, p) {
  const t = ctx.currentTime;
  const vol = (p.volume ?? 0.46) * (p.weight ?? 1.0);
  const pitch = p.pitch ?? 1.0;
  
  const nodes = [];
  
  // Rattle (short noise bursts)
  for (let i = 0; i < 3; i++) {
    const delay = i * 0.012;
    const dur = 0.01;
    const buf = noiseBuffer(ctx, dur);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = uniformDistribution(1200, 2000, Math.random) * pitch;
    bp.Q.value = 1.0;
    const gain = envelope(ctx, vol * 0.3, 0.0005, 0.001, dur - 0.0015);
    src.connect(bp).connect(gain).connect(dest);
    src.start(t + delay);
    nodes.push(src, bp, gain);
  }
  
  // Ring
  const ringOsc = ctx.createOscillator();
  ringOsc.type = 'sine';
  ringOsc.frequency.value = uniformDistribution(1400, 2000, Math.random) * pitch;
  const ringGain = envelope(ctx, vol * 0.25, 0.001, 0.005, 0.05);
  ringOsc.connect(ringGain).connect(dest);
  ringOsc.start(t);
  ringOsc.stop(t + 0.056);
  nodes.push(ringOsc, ringGain);
  
  return { stop: () => nodes.forEach(n => { try { n.disconnect(); } catch (_) {} }) };
}

// ============================================================================
// LIQUID FOOTSTEPS
// ============================================================================

/**
 * Water shallow footstep — splash + plop
 */
export function footstep_water_shallow(ctx, dest, p) {
  const t = ctx.currentTime;
  const vol = (p.volume ?? 0.4) * (p.weight ?? 1.0);
  const pitch = p.pitch ?? 1.0;
  
  const nodes = [];
  
  // Plop (low resonance)
  const plopOsc = ctx.createOscillator();
  plopOsc.type = 'sine';
  plopOsc.frequency.setValueAtTime(320 * pitch, t);
  plopOsc.frequency.exponentialRampToValueAtTime(180 * pitch, t + 0.06);
  const plopGain = envelope(ctx, vol * 0.45, 0.003, 0.008, 0.045);
  plopOsc.connect(plopGain).connect(dest);
  plopOsc.start(t);
  plopOsc.stop(t + 0.056);
  nodes.push(plopOsc, plopGain);
  
  // Splash (filtered noise)
  const splashDur = 0.08;
  const splashBuf = noiseBuffer(ctx, splashDur);
  const splashSrc = ctx.createBufferSource();
  splashSrc.buffer = splashBuf;
  const splashBP = ctx.createBiquadFilter();
  splashBP.type = 'bandpass';
  splashBP.frequency.value = uniformDistribution(2200, 3400, Math.random) * pitch;
  splashBP.Q.value = 1.8;
  const splashGain = envelope(ctx, vol * 0.3, 0.002, 0.01, splashDur - 0.012);
  splashSrc.connect(splashBP).connect(splashGain).connect(dest);
  splashSrc.start(t + 0.005);
  nodes.push(splashSrc, splashBP, splashGain);
  
  return { stop: () => nodes.forEach(n => { try { n.disconnect(); } catch (_) {} }) };
}

/**
 * Water puddle footstep — small splash
 */
export function footstep_water_puddle(ctx, dest, p) {
  const t = ctx.currentTime;
  const vol = (p.volume ?? 0.35) * (p.weight ?? 1.0) * 0.7;
  const pitch = p.pitch ?? 1.0;
  
  const nodes = [];
  
  // Small plop
  const plopOsc = ctx.createOscillator();
  plopOsc.type = 'sine';
  plopOsc.frequency.setValueAtTime(280 * pitch, t);
  plopOsc.frequency.exponentialRampToValueAtTime(160 * pitch, t + 0.04);
  const plopGain = envelope(ctx, vol * 0.5, 0.002, 0.005, 0.03);
  plopOsc.connect(plopGain).connect(dest);
  plopOsc.start(t);
  plopOsc.stop(t + 0.037);
  nodes.push(plopOsc, plopGain);
  
  // Small splash
  const splashDur = 0.05;
  const splashBuf = noiseBuffer(ctx, splashDur);
  const splashSrc = ctx.createBufferSource();
  splashSrc.buffer = splashBuf;
  const splashBP = ctx.createBiquadFilter();
  splashBP.type = 'bandpass';
  splashBP.frequency.value = uniformDistribution(1800, 2600, Math.random) * pitch;
  splashBP.Q.value = 2.0;
  const splashGain = envelope(ctx, vol * 0.25, 0.001, 0.006, splashDur - 0.007);
  splashSrc.connect(splashBP).connect(splashGain).connect(dest);
  splashSrc.start(t + 0.003);
  nodes.push(splashSrc, splashBP, splashGain);
  
  return { stop: () => nodes.forEach(n => { try { n.disconnect(); } catch (_) {} }) };
}

// ============================================================================
// SPECIAL FOOTSTEPS
// ============================================================================

/**
 * Leaves footstep — crunch + rustle
 */
export function footstep_leaves(ctx, dest, p) {
  const t = ctx.currentTime;
  const vol = (p.volume ?? 0.38) * (p.weight ?? 1.0);
  const pitch = p.pitch ?? 1.0;
  
  const nodes = [];
  
  // Crunch (mid-high noise)
  const crunchDur = 0.06;
  const crunchBuf = noiseBuffer(ctx, crunchDur);
  const crunchSrc = ctx.createBufferSource();
  crunchSrc.buffer = crunchBuf;
  const crunchBP = ctx.createBiquadFilter();
  crunchBP.type = 'bandpass';
  crunchBP.frequency.value = uniformDistribution(1600, 2600, Math.random) * pitch;
  crunchBP.Q.value = 2.0;
  const crunchGain = envelope(ctx, vol * 0.45, 0.003, 0.008, crunchDur - 0.011);
  crunchSrc.connect(crunchBP).connect(crunchGain).connect(dest);
  crunchSrc.start(t);
  nodes.push(crunchSrc, crunchBP, crunchGain);
  
  // Rustle (high-freq tail)
  const rustleDur = 0.05;
  const rustleBuf = noiseBuffer(ctx, rustleDur);
  const rustleSrc = ctx.createBufferSource();
  rustleSrc.buffer = rustleBuf;
  const rustleHP = ctx.createBiquadFilter();
  rustleHP.type = 'highpass';
  rustleHP.frequency.value = 3000 * pitch;
  rustleHP.Q.value = 0.8;
  const rustleGain = envelope(ctx, vol * 0.2, 0.005, 0.01, rustleDur - 0.015);
  rustleSrc.connect(rustleHP).connect(rustleGain).connect(dest);
  rustleSrc.start(t + 0.01);
  nodes.push(rustleSrc, rustleHP, rustleGain);
  
  return { stop: () => nodes.forEach(n => { try { n.disconnect(); } catch (_) {} }) };
}

/**
 * Glass footstep — delicate clink + shimmer
 */
export function footstep_glass(ctx, dest, p) {
  const t = ctx.currentTime;
  const vol = (p.volume ?? 0.38) * (p.weight ?? 1.0) * 0.8;
  const pitch = p.pitch ?? 1.0;
  
  const nodes = [];
  
  // Clink (bright transient)
  const clinkDur = 0.015;
  const clinkBuf = noiseBuffer(ctx, clinkDur);
  const clinkSrc = ctx.createBufferSource();
  clinkSrc.buffer = clinkBuf;
  const clinkHP = ctx.createBiquadFilter();
  clinkHP.type = 'highpass';
  clinkHP.frequency.value = 2000 * pitch;
  clinkHP.Q.value = 0.5;
  const clinkGain = envelope(ctx, vol * 0.5, 0.0005, 0.002, clinkDur - 0.0025);
  clinkSrc.connect(clinkHP).connect(clinkGain).connect(dest);
  clinkSrc.start(t);
  nodes.push(clinkSrc, clinkHP, clinkGain);
  
  // Shimmer (high partials)
  const freqs = [2400, 3800, 5600];
  freqs.forEach((f, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f * pitch * uniformDistribution(0.98, 1.02, Math.random);
    const gain = envelope(ctx, vol * (0.15 - i * 0.03), 0.001, 0.005, 0.04 + i * 0.01);
    osc.connect(gain).connect(dest);
    osc.start(t);
    osc.stop(t + 0.046 + i * 0.01);
    nodes.push(osc, gain);
  });
  
  return { stop: () => nodes.forEach(n => { try { n.disconnect(); } catch (_) {} }) };
}

/**
 * Ice footstep — crack + slide
 */
export function footstep_ice(ctx, dest, p) {
  const t = ctx.currentTime;
  const vol = (p.volume ?? 0.42) * (p.weight ?? 1.0);
  const pitch = p.pitch ?? 1.0;
  
  const nodes = [];
  
  // Crack (sharp noise burst)
  const crackDur = 0.025;
  const crackBuf = noiseBuffer(ctx, crackDur);
  const crackSrc = ctx.createBufferSource();
  crackSrc.buffer = crackBuf;
  const crackBP = ctx.createBiquadFilter();
  crackBP.type = 'bandpass';
  crackBP.frequency.value = uniformDistribution(1800, 2800, Math.random) * pitch;
  crackBP.Q.value = 2.5;
  const crackGain = envelope(ctx, vol * 0.5, 0.001, 0.003, crackDur - 0.004);
  crackSrc.connect(crackBP).connect(crackGain).connect(dest);
  crackSrc.start(t);
  nodes.push(crackSrc, crackBP, crackGain);
  
  // Slide (low-freq sweep)
  const slideOsc = ctx.createOscillator();
  slideOsc.type = 'sine';
  slideOsc.frequency.setValueAtTime(300 * pitch, t + 0.01);
  slideOsc.frequency.exponentialRampToValueAtTime(150 * pitch, t + 0.06);
  const slideLP = ctx.createBiquadFilter();
  slideLP.type = 'lowpass';
  slideLP.frequency.value = 800 * pitch;
  slideLP.Q.value = 1.5;
  const slideGain = envelope(ctx, vol * 0.25, 0.002, 0.008, 0.04);
  slideOsc.connect(slideLP).connect(slideGain).connect(dest);
  slideOsc.start(t + 0.01);
  slideOsc.stop(t + 0.06);
  nodes.push(slideOsc, slideLP, slideGain);
  
  return { stop: () => nodes.forEach(n => { try { n.disconnect(); } catch (_) {} }) };
}

// ============================================================================
// LAND SOUNDS (heavier impacts for landing after jump/fall)
// ============================================================================

/**
 * Generic land sound — reuses footstep patch but with heavier weight/volume
 * Can be used as a wrapper for any footstep material
 */
export function land_generic(ctx, dest, p) {
  // Amplify volume and weight for landing impact
  const landParams = {
    ...p,
    volume: (p.volume ?? 0.5) * 1.5,
    weight: (p.weight ?? 1.0) * 1.8,
    pitch: (p.pitch ?? 1.0) * 0.9, // Slightly lower pitch for heavier impact
  };
  
  // Use the appropriate footstep patch based on material
  const material = p.material || 'dirt';
  const patchFn = FOOTSTEP_PATCHES[`footstep_${material}`] || footstep_dirt;
  return patchFn(ctx, dest, landParams);
}

// ============================================================================
// PATCH REGISTRY
// ============================================================================

export const FOOTSTEP_PATCHES = {
  // Terrain
  footstep_dirt,
  footstep_grass,
  footstep_sand,
  footstep_gravel,
  footstep_mud,
  footstep_snow,
  
  // Hard surfaces
  footstep_stone,
  footstep_concrete,
  footstep_marble,
  footstep_brick,
  
  // Wood
  footstep_wood_plank,
  footstep_wood_creak,
  
  // Metal
  footstep_metal_solid,
  footstep_metal_grate,
  
  // Liquids
  footstep_water_shallow,
  footstep_water_puddle,
  
  // Special
  footstep_leaves,
  footstep_glass,
  footstep_ice,
  
  // Lands
  land_generic,
};

/**
 * Get footstep patch function by material key.
 * @param {string} material - Material key (e.g., 'dirt', 'stone')
 * @returns {Function|null}
 */
export function getFootstepPatch(material) {
  return FOOTSTEP_PATCHES[`footstep_${material}`] || FOOTSTEP_PATCHES.footstep_dirt;
}
