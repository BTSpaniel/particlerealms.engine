// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { uniformDistribution } from '../../../core/math/MathRandom.js';

/**
 * ImpulseNode.js — Advanced Impulse/Excitation Generator
 * 
 * Generates various impulse types for exciting resonant bodies:
 * - click:    Single sample spike
 * - burst:    Short noise burst
 * - noise:    Shaped noise pulse
 * - chirp:    Frequency sweep
 * - sine:     Damped sine wave
 * - triangle: Triangle pulse
 *
 * Used to excite ModalBank, Waveguide, and other resonators.
 *
 * Usage:
 *   import { createImpulseEngine, generateImpulseBuffer } from './ImpulseNode.js';
 *   const engine = createImpulseEngine(audioCtx, { shape: 'burst', rate: 20 });
 *   engine.output.connect(destination);
 *   engine.start();
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const IMPULSE_SHAPES = ['click', 'burst', 'noise', 'chirp', 'sine', 'triangle'];

// ============================================================================
// IMPULSE ENGINE
// ============================================================================

/**
 * Create a real-time impulse generator engine.
 * @param {AudioContext} ctx
 * @param {Object} config
 * @returns {Object} Engine instance
 */
export function createImpulseEngine(ctx, config = {}) {
  const rate = config.rate ?? 10;
  const shape = config.shape ?? 'click';
  const jitter = config.jitter ?? 0.5;
  const attack = config.attack ?? 0.001;
  const decay = config.decay ?? 0.01;
  const burstLength = config.burstLength ?? 0.005;
  const pitch = config.pitch ?? 1000;
  const velocityMin = config.velocityMin ?? 0.5;
  const velocityMax = config.velocityMax ?? 1.0;

  const output = ctx.createGain();
  output.gain.value = 1.0;

  const engine = {
    ctx,
    output,
    params: { rate, shape, jitter, attack, decay, burstLength, pitch, velocityMin, velocityMax },
    _running: false,
    _timeoutId: null,
    _nextImpulseTime: 0,
  };

  engine.start = () => {
    if (engine._running) return;
    engine._running = true;
    engine._nextImpulseTime = ctx.currentTime;
    _scheduleNextImpulse(engine);
  };

  engine.stop = () => {
    engine._running = false;
    if (engine._timeoutId) {
      clearTimeout(engine._timeoutId);
      engine._timeoutId = null;
    }
  };

  engine.setParam = (key, value) => {
    if (key in engine.params) {
      engine.params[key] = value;
    }
  };

  engine.trigger = (when = 0) => {
    _triggerImpulse(engine, when || ctx.currentTime);
  };

  return engine;
}

/**
 * Schedule the next impulse based on rate and jitter.
 */
function _scheduleNextImpulse(engine) {
  if (!engine._running) return;

  const ctx = engine.ctx;
  const { rate, jitter } = engine.params;

  // Calculate interval with jitter
  const baseInterval = 1 / rate;
  const jitterAmount = baseInterval * jitter * uniformDistribution(-1, 1, Math.random);
  const interval = Math.max(0.001, baseInterval + jitterAmount);

  // Trigger the impulse
  _triggerImpulse(engine, engine._nextImpulseTime);

  // Schedule next
  engine._nextImpulseTime += interval;
  const delay = Math.max(0, (engine._nextImpulseTime - ctx.currentTime) * 1000);

  engine._timeoutId = setTimeout(() => _scheduleNextImpulse(engine), delay);
}

/**
 * Trigger a single impulse at the specified time.
 */
function _triggerImpulse(engine, when) {
  const ctx = engine.ctx;
  const { shape, attack, decay, burstLength, pitch, velocityMin, velocityMax } = engine.params;

  // Random velocity
  const velocity = uniformDistribution(velocityMin, velocityMax, Math.random);

  // Generate impulse buffer based on shape
  const buffer = generateImpulseBuffer(ctx, {
    shape,
    attack,
    decay,
    burstLength,
    pitch,
    velocity,
  });

  // Play the buffer
  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const gain = ctx.createGain();
  gain.gain.value = velocity;

  source.connect(gain);
  gain.connect(engine.output);
  source.start(when);
}

// ============================================================================
// BUFFER GENERATION
// ============================================================================

/**
 * Generate a single impulse as an AudioBuffer.
 * @param {AudioContext} ctx
 * @param {Object} config
 * @returns {AudioBuffer}
 */
export function generateImpulseBuffer(ctx, config = {}) {
  const sampleRate = ctx.sampleRate;
  const shape = config.shape ?? 'click';
  const attack = config.attack ?? 0.001;
  const decay = config.decay ?? 0.01;
  const burstLength = config.burstLength ?? 0.005;
  const pitch = config.pitch ?? 1000;
  const velocity = config.velocity ?? 1.0;

  const duration = attack + decay + 0.001;
  const length = Math.ceil(duration * sampleRate);
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  switch (shape) {
    case 'click':
      _generateClick(data, sampleRate, attack, decay, velocity);
      break;
    case 'burst':
      _generateBurst(data, sampleRate, burstLength, velocity);
      break;
    case 'noise':
      _generateNoisePulse(data, sampleRate, attack, decay, velocity);
      break;
    case 'chirp':
      _generateChirp(data, sampleRate, pitch, decay, velocity);
      break;
    case 'sine':
      _generateDampedSine(data, sampleRate, pitch, decay, velocity);
      break;
    case 'triangle':
      _generateTriangle(data, sampleRate, attack, decay, velocity);
      break;
    default:
      _generateClick(data, sampleRate, attack, decay, velocity);
  }

  return buffer;
}

/**
 * Click: single sample spike with quick decay
 */
function _generateClick(data, sampleRate, attack, decay, velocity) {
  const attackSamples = Math.ceil(attack * sampleRate);
  const decaySamples = Math.ceil(decay * sampleRate);

  for (let i = 0; i < data.length; i++) {
    let env = 0;
    if (i < attackSamples) {
      env = i / attackSamples;
    } else if (i < attackSamples + decaySamples) {
      const t = (i - attackSamples) / decaySamples;
      env = 1 - t;
    }
    // Spike at peak
    data[i] = env * velocity * (i === attackSamples ? 1 : env * 0.1);
  }
}

/**
 * Burst: short noise burst
 */
function _generateBurst(data, sampleRate, burstLength, velocity) {
  const burstSamples = Math.ceil(burstLength * sampleRate);

  for (let i = 0; i < data.length && i < burstSamples; i++) {
    const env = 1 - (i / burstSamples); // Linear decay
    data[i] = uniformDistribution(-1, 1, Math.random) * env * velocity;
  }
}

/**
 * Noise pulse: shaped white noise with attack/decay envelope
 */
function _generateNoisePulse(data, sampleRate, attack, decay, velocity) {
  const attackSamples = Math.ceil(attack * sampleRate);
  const decaySamples = Math.ceil(decay * sampleRate);

  for (let i = 0; i < data.length; i++) {
    let env = 0;
    if (i < attackSamples) {
      env = i / attackSamples;
    } else if (i < attackSamples + decaySamples) {
      const t = (i - attackSamples) / decaySamples;
      env = Math.pow(1 - t, 2); // Exponential decay
    }
    data[i] = uniformDistribution(-1, 1, Math.random) * env * velocity;
  }
}

/**
 * Chirp: frequency sweep from high to low
 */
function _generateChirp(data, sampleRate, startFreq, duration, velocity) {
  const endFreq = startFreq * 0.1;
  const samples = Math.min(data.length, Math.ceil(duration * sampleRate));

  let phase = 0;
  for (let i = 0; i < samples; i++) {
    const t = i / samples;
    const freq = startFreq + (endFreq - startFreq) * t;
    const env = Math.pow(1 - t, 1.5);

    phase += (2 * Math.PI * freq) / sampleRate;
    data[i] = Math.sin(phase) * env * velocity;
  }
}

/**
 * Damped sine: exponentially decaying sine wave
 */
function _generateDampedSine(data, sampleRate, freq, decay, velocity) {
  const decayRate = 1 / (decay * sampleRate);

  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-i * decayRate * 5);
    data[i] = Math.sin(2 * Math.PI * freq * t) * env * velocity;
  }
}

/**
 * Triangle: triangular pulse shape
 */
function _generateTriangle(data, sampleRate, attack, decay, velocity) {
  const attackSamples = Math.ceil(attack * sampleRate);
  const decaySamples = Math.ceil(decay * sampleRate);
  const totalSamples = attackSamples + decaySamples;

  for (let i = 0; i < data.length && i < totalSamples; i++) {
    let env = 0;
    if (i < attackSamples) {
      env = i / attackSamples;
    } else {
      env = 1 - ((i - attackSamples) / decaySamples);
    }
    data[i] = env * velocity;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export const IMPULSE_SHAPE_OPTIONS = IMPULSE_SHAPES;

export function isValidImpulseShape(shape) {
  return IMPULSE_SHAPES.includes(shape);
}
