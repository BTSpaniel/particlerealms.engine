// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { uniformDistribution } from '../../core/math/MathRandom.js';

/**
 * BodyFoleyPatches.js - Body Action Sound Generators
 * 
 * Procedural generators for character body foley: jumps, lands, slides,
 * cloth rustles, breathing, etc.
 */

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
// BODY FOLEY PATCHES
// ============================================================================

/**
 * Jump effort sound — short vocal grunt (bandpassed noise + formant)
 */
export function body_jump_effort(ctx, dest, p) {
  const t = ctx.currentTime;
  const vol = (p.volume ?? 0.35) * 0.8;
  const pitch = p.pitch ?? 1.0;
  
  const nodes = [];
  
  // Grunt body (bandpassed noise for vocal quality)
  const gruntDur = 0.12;
  const gruntBuf = noiseBuffer(ctx, gruntDur);
  const gruntSrc = ctx.createBufferSource();
  gruntSrc.buffer = gruntBuf;
  
  // Formant filter (vocal tract resonance around 500-800 Hz)
  const formantBP = ctx.createBiquadFilter();
  formantBP.type = 'bandpass';
  formantBP.frequency.value = uniformDistribution(600, 800, Math.random) * pitch;
  formantBP.Q.value = 3.5;
  
  const gruntGain = envelope(ctx, vol * 0.6, 0.01, 0.03, gruntDur - 0.04);
  gruntSrc.connect(formantBP).connect(gruntGain).connect(dest);
  gruntSrc.start(t);
  nodes.push(gruntSrc, formantBP, gruntGain);
  
  // Sub harmonic (low-freq body)
  const subOsc = ctx.createOscillator();
  subOsc.type = 'sine';
  subOsc.frequency.value = 120 * pitch;
  const subGain = envelope(ctx, vol * 0.25, 0.008, 0.02, 0.06);
  subOsc.connect(subGain).connect(dest);
  subOsc.start(t);
  subOsc.stop(t + 0.094);
  nodes.push(subOsc, subGain);
  
  return { stop: () => nodes.forEach(n => { try { n.disconnect(); } catch (_) {} }) };
}

/**
 * Slide friction sound — continuous lowpass swept noise
 */
export function body_slide(ctx, dest, p) {
  const t = ctx.currentTime;
  const vol = (p.volume ?? 0.5) * 0.7;
  const pitch = p.pitch ?? 1.0;
  
  const nodes = [];
  
  // Friction noise (swept lowpass)
  const slideDur = 0.5; // Longer duration for continuous slide
  const slideBuf = noiseBuffer(ctx, slideDur);
  const slideSrc = ctx.createBufferSource();
  slideSrc.buffer = slideBuf;
  
  const slideLP = ctx.createBiquadFilter();
  slideLP.type = 'lowpass';
  slideLP.frequency.setValueAtTime(800 * pitch, t);
  slideLP.frequency.exponentialRampToValueAtTime(300 * pitch, t + slideDur);
  slideLP.Q.value = 1.5;
  
  const slideGain = ctx.createGain();
  slideGain.gain.setValueAtTime(0, t);
  slideGain.gain.linearRampToValueAtTime(vol * 0.5, t + 0.05);
  slideGain.gain.setValueAtTime(vol * 0.5, t + slideDur - 0.1);
  slideGain.gain.exponentialRampToValueAtTime(0.001, t + slideDur);
  
  slideSrc.connect(slideLP).connect(slideGain).connect(dest);
  slideSrc.start(t);
  nodes.push(slideSrc, slideLP, slideGain);
  
  // Rumble layer (low-freq)
  const rumbleOsc = ctx.createOscillator();
  rumbleOsc.type = 'sawtooth';
  rumbleOsc.frequency.setValueAtTime(60 * pitch, t);
  rumbleOsc.frequency.exponentialRampToValueAtTime(40 * pitch, t + slideDur);
  
  const rumbleGain = ctx.createGain();
  rumbleGain.gain.setValueAtTime(0, t);
  rumbleGain.gain.linearRampToValueAtTime(vol * 0.2, t + 0.05);
  rumbleGain.gain.setValueAtTime(vol * 0.2, t + slideDur - 0.1);
  rumbleGain.gain.exponentialRampToValueAtTime(0.001, t + slideDur);
  
  rumbleOsc.connect(rumbleGain).connect(dest);
  rumbleOsc.start(t);
  rumbleOsc.stop(t + slideDur);
  nodes.push(rumbleOsc, rumbleGain);
  
  return { stop: () => nodes.forEach(n => { try { n.disconnect(); } catch (_) {} }) };
}

/**
 * Cloth rustle — short high-freq noise burst
 */
export function body_cloth(ctx, dest, p) {
  const t = ctx.currentTime;
  const vol = (p.volume ?? 0.2) * 0.6;
  const pitch = p.pitch ?? 1.0;
  
  const nodes = [];
  
  // Rustle (high-freq filtered noise)
  const rustleDur = uniformDistribution(0.08, 0.12, Math.random);
  const rustleBuf = noiseBuffer(ctx, rustleDur);
  const rustleSrc = ctx.createBufferSource();
  rustleSrc.buffer = rustleBuf;
  
  const rustleBP = ctx.createBiquadFilter();
  rustleBP.type = 'bandpass';
  rustleBP.frequency.value = uniformDistribution(3000, 5000, Math.random) * pitch;
  rustleBP.Q.value = 2.8;
  
  const rustleGain = envelope(ctx, vol * 0.5, 0.005, 0.015, rustleDur - 0.02);
  rustleSrc.connect(rustleBP).connect(rustleGain).connect(dest);
  rustleSrc.start(t);
  nodes.push(rustleSrc, rustleBP, rustleGain);
  
  return { stop: () => nodes.forEach(n => { try { n.disconnect(); } catch (_) {} }) };
}

/**
 * Light breathing — soft airy noise with bandpass
 */
export function body_breath_light(ctx, dest, p) {
  const t = ctx.currentTime;
  const vol = (p.volume ?? 0.2) * 0.5;
  const pitch = p.pitch ?? 1.0;
  
  const nodes = [];
  
  // Breath body (airy bandpass noise)
  const breathDur = 0.6;
  const breathBuf = noiseBuffer(ctx, breathDur);
  const breathSrc = ctx.createBufferSource();
  breathSrc.buffer = breathBuf;
  
  const breathBP = ctx.createBiquadFilter();
  breathBP.type = 'bandpass';
  breathBP.frequency.value = uniformDistribution(800, 1200, Math.random) * pitch;
  breathBP.Q.value = 1.5;
  
  const breathGain = ctx.createGain();
  breathGain.gain.setValueAtTime(0, t);
  breathGain.gain.linearRampToValueAtTime(vol * 0.4, t + 0.1);
  breathGain.gain.setValueAtTime(vol * 0.4, t + 0.3);
  breathGain.gain.exponentialRampToValueAtTime(0.001, t + breathDur);
  
  breathSrc.connect(breathBP).connect(breathGain).connect(dest);
  breathSrc.start(t);
  nodes.push(breathSrc, breathBP, breathGain);
  
  return { stop: () => nodes.forEach(n => { try { n.disconnect(); } catch (_) {} }) };
}

/**
 * Heavy breathing — louder breath with low-end rumble
 */
export function body_breath_heavy(ctx, dest, p) {
  const t = ctx.currentTime;
  const vol = (p.volume ?? 0.3) * 0.7;
  const pitch = p.pitch ?? 1.0;
  
  const nodes = [];
  
  // Breath body (airy bandpass)
  const breathDur = 0.8;
  const breathBuf = noiseBuffer(ctx, breathDur);
  const breathSrc = ctx.createBufferSource();
  breathSrc.buffer = breathBuf;
  
  const breathBP = ctx.createBiquadFilter();
  breathBP.type = 'bandpass';
  breathBP.frequency.value = uniformDistribution(700, 1000, Math.random) * pitch;
  breathBP.Q.value = 2.0;
  
  const breathGain = ctx.createGain();
  breathGain.gain.setValueAtTime(0, t);
  breathGain.gain.linearRampToValueAtTime(vol * 0.5, t + 0.12);
  breathGain.gain.setValueAtTime(vol * 0.5, t + 0.4);
  breathGain.gain.exponentialRampToValueAtTime(0.001, t + breathDur);
  
  breathSrc.connect(breathBP).connect(breathGain).connect(dest);
  breathSrc.start(t);
  nodes.push(breathSrc, breathBP, breathGain);
  
  // Low rumble (exertion)
  const rumbleOsc = ctx.createOscillator();
  rumbleOsc.type = 'sawtooth';
  rumbleOsc.frequency.value = 80 * pitch;
  
  const rumbleGain = ctx.createGain();
  rumbleGain.gain.setValueAtTime(0, t);
  rumbleGain.gain.linearRampToValueAtTime(vol * 0.2, t + 0.1);
  rumbleGain.gain.setValueAtTime(vol * 0.2, t + 0.4);
  rumbleGain.gain.exponentialRampToValueAtTime(0.001, t + breathDur);
  
  rumbleOsc.connect(rumbleGain).connect(dest);
  rumbleOsc.start(t);
  rumbleOsc.stop(t + breathDur);
  nodes.push(rumbleOsc, rumbleGain);
  
  return { stop: () => nodes.forEach(n => { try { n.disconnect(); } catch (_) {} }) };
}

// ============================================================================
// PATCH REGISTRY
// ============================================================================

export const BODY_FOLEY_PATCHES = {
  body_jump_effort,
  body_slide,
  body_cloth,
  body_breath_light,
  body_breath_heavy,
};
