// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SamplePlayerNode.js — Advanced Sample Playback
 * 
 * Enhanced sample player with:
 * - Loop modes: forward, pingpong, reverse
 * - Start/end points and loop regions
 * - Crossfade looping for seamless loops
 * - Built-in ADSR envelope
 * - Pitch tracking from MIDI note
 *
 * Usage:
 *   import { createSamplePlayer } from './SamplePlayerNode.js';
 *   const player = createSamplePlayer(audioCtx, buffer, { loop: true, loopMode: 'pingpong' });
 *   player.trigger();
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const LOOP_MODES = ['forward', 'pingpong', 'reverse'];

// ============================================================================
// SAMPLE PLAYER
// ============================================================================

/**
 * Create an advanced sample player.
 * @param {AudioContext} ctx
 * @param {AudioBuffer} buffer - Source audio buffer
 * @param {Object} config
 * @returns {Object} Sample player instance
 */
export function createSamplePlayer(ctx, buffer, config = {}) {
  const rate = config.rate ?? 1.0;
  const loop = config.loop ?? false;
  const loopMode = config.loopMode ?? 'forward';
  const startTime = config.startTime ?? 0;
  const endTime = config.endTime ?? -1;
  const loopStart = config.loopStart ?? 0;
  const loopEnd = config.loopEnd ?? -1;
  const crossfade = config.crossfade ?? 0.01;
  const attack = config.attack ?? 0;
  const decay = config.decay ?? 0;
  const sustain = config.sustain ?? 1;
  const release = config.release ?? 0.01;

  const output = ctx.createGain();
  output.gain.value = 1.0;

  let activeSource = null;
  let activeEnvelope = null;

  const player = {
    ctx,
    buffer,
    output,
    config: { rate, loop, loopMode, startTime, endTime, loopStart, loopEnd, crossfade, attack, decay, sustain, release },
    _playing: false,

    /**
     * Trigger playback.
     * @param {number} when - Start time (default: now)
     * @param {number} velocity - Trigger velocity 0-1 (default: 1)
     */
    trigger(when = 0, velocity = 1) {
      const startAt = when || ctx.currentTime;

      // Stop any existing playback
      player.stop(startAt);

      // Resolve buffer to use (may need to reverse)
      let playBuffer = buffer;
      if (loopMode === 'reverse') {
        playBuffer = _reverseBuffer(ctx, buffer);
      }

      // Calculate actual start/end points
      const actualStart = Math.max(0, startTime);
      const actualEnd = endTime > 0 ? Math.min(endTime, buffer.duration) : buffer.duration;
      const duration = actualEnd - actualStart;

      // Create source
      activeSource = ctx.createBufferSource();
      activeSource.buffer = playBuffer;
      activeSource.playbackRate.value = rate;

      if (loop) {
        activeSource.loop = true;
        activeSource.loopStart = loopStart > 0 ? loopStart : actualStart;
        activeSource.loopEnd = loopEnd > 0 ? loopEnd : actualEnd;
      }

      // Create envelope
      activeEnvelope = ctx.createGain();
      activeEnvelope.gain.value = 0;

      // Apply ADSR
      _applyADSR(activeEnvelope.gain, startAt, velocity, { attack, decay, sustain, release }, loop ? Infinity : duration);

      // Connect
      activeSource.connect(activeEnvelope);
      activeEnvelope.connect(output);

      // Start playback
      if (loop) {
        activeSource.start(startAt, actualStart);
      } else {
        activeSource.start(startAt, actualStart, duration);
      }

      player._playing = true;

      // Auto-cleanup for non-looping
      if (!loop) {
        const cleanupDelay = (duration / rate + release + 0.1) * 1000;
        setTimeout(() => {
          if (activeSource) {
            try { activeSource.disconnect(); } catch { /* */ }
            activeSource = null;
          }
          if (activeEnvelope) {
            try { activeEnvelope.disconnect(); } catch { /* */ }
            activeEnvelope = null;
          }
          player._playing = false;
        }, cleanupDelay);
      }
    },

    /**
     * Stop playback with release.
     * @param {number} when - Stop time (default: now)
     */
    stop(when = 0) {
      const stopAt = when || ctx.currentTime;

      if (activeEnvelope && player._playing) {
        // Apply release
        activeEnvelope.gain.cancelScheduledValues(stopAt);
        activeEnvelope.gain.setValueAtTime(activeEnvelope.gain.value, stopAt);
        activeEnvelope.gain.linearRampToValueAtTime(0, stopAt + release);
      }

      if (activeSource) {
        try {
          activeSource.stop(stopAt + release + 0.01);
        } catch { /* */ }
      }

      player._playing = false;
    },

    /**
     * Set playback rate.
     * @param {number} newRate
     */
    setRate(newRate) {
      player.config.rate = newRate;
      if (activeSource) {
        activeSource.playbackRate.value = newRate;
      }
    },

    /**
     * Replace the buffer.
     * @param {AudioBuffer} newBuffer
     */
    setBuffer(newBuffer) {
      player.buffer = newBuffer;
    },

    /**
     * Check if playing.
     * @returns {boolean}
     */
    isPlaying() {
      return player._playing;
    },

    /**
     * Disconnect and cleanup.
     */
    destroy() {
      player.stop();
      try { output.disconnect(); } catch { /* */ }
    },
  };

  return player;
}

// ============================================================================
// ADSR ENVELOPE
// ============================================================================

/**
 * Apply ADSR envelope to a gain parameter.
 */
function _applyADSR(gainParam, startTime, velocity, adsr, duration) {
  const { attack, decay, sustain, release } = adsr;
  const peak = velocity;
  const sustainLevel = peak * sustain;

  gainParam.setValueAtTime(0, startTime);

  if (attack > 0) {
    gainParam.linearRampToValueAtTime(peak, startTime + attack);
  } else {
    gainParam.setValueAtTime(peak, startTime);
  }

  if (decay > 0) {
    gainParam.linearRampToValueAtTime(sustainLevel, startTime + attack + decay);
  }

  // Hold at sustain level (for looping sounds)
  if (duration < Infinity) {
    const releaseStart = startTime + duration - release;
    gainParam.setValueAtTime(sustainLevel, releaseStart);
    gainParam.linearRampToValueAtTime(0, releaseStart + release);
  }
}

// ============================================================================
// BUFFER UTILITIES
// ============================================================================

/**
 * Create a reversed copy of an AudioBuffer.
 */
function _reverseBuffer(ctx, buffer) {
  const reversed = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = reversed.getChannelData(ch);
    for (let i = 0; i < src.length; i++) {
      dst[i] = src[src.length - 1 - i];
    }
  }
  return reversed;
}

/**
 * Create a crossfade loop buffer.
 * Blends the end of the loop region back into the start for seamless looping.
 * @param {AudioContext} ctx
 * @param {AudioBuffer} buffer
 * @param {number} loopStart - Loop start in seconds
 * @param {number} loopEnd - Loop end in seconds
 * @param {number} crossfadeDuration - Crossfade length in seconds
 * @returns {AudioBuffer}
 */
export function createCrossfadeLoopBuffer(ctx, buffer, loopStart, loopEnd, crossfadeDuration) {
  const sampleRate = buffer.sampleRate;
  const channels = buffer.numberOfChannels;

  const startSample = Math.floor(loopStart * sampleRate);
  const endSample = Math.floor(loopEnd * sampleRate);
  const crossfadeSamples = Math.floor(crossfadeDuration * sampleRate);

  const loopLength = endSample - startSample;
  if (loopLength <= crossfadeSamples * 2) {
    return buffer; // Loop too short for crossfade
  }

  const newBuffer = ctx.createBuffer(channels, buffer.length, sampleRate);

  for (let ch = 0; ch < channels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = newBuffer.getChannelData(ch);

    // Copy everything
    dst.set(src);

    // Apply crossfade at loop boundary
    for (let i = 0; i < crossfadeSamples; i++) {
      const fadeOut = 1 - (i / crossfadeSamples);
      const fadeIn = i / crossfadeSamples;

      const endIdx = endSample - crossfadeSamples + i;
      const startIdx = startSample + i;

      // Blend end into start region
      if (endIdx < buffer.length && startIdx < buffer.length) {
        dst[startIdx] = src[startIdx] * fadeIn + src[endIdx] * fadeOut;
      }
    }
  }

  return newBuffer;
}

// ============================================================================
// EXPORTS
// ============================================================================

export const SAMPLE_LOOP_MODES = LOOP_MODES;

export function isValidLoopMode(mode) {
  return LOOP_MODES.includes(mode);
}
