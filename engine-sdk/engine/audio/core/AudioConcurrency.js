// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AudioConcurrency.js - Voice Management & Stealing
 * 
 * Manages the maximum number of concurrent voices. When the limit is reached,
 * uses priority-based voice stealing (quietest, oldest, or farthest).
 */

// ============================================================================
// CREATION
// ============================================================================

/**
 * Create a concurrency manager.
 * @param {Object} config
 * @param {number} config.maxVoices - Maximum concurrent voices (default 64)
 * @param {string} config.stealPolicy - 'quietest'|'oldest'|'farthest' (default 'quietest')
 * @returns {Object}
 */
export function createAudioConcurrency(config = {}) {
  return {
    maxVoices: config.maxVoices ?? 64,
    stealPolicy: config.stealPolicy || 'quietest',
  };
}

// ============================================================================
// TICK
// ============================================================================

/**
 * Tick concurrency — steal voices if over limit.
 * @param {Object} concurrency
 * @param {Map} activeSources - Map of id → AudioSource
 * @param {number} time - Current engine time
 */
export function tickConcurrency(concurrency, activeSources, time) {
  if (!concurrency || !activeSources) return;
  if (activeSources.size <= concurrency.maxVoices) return;

  // Need to steal voices
  const excess = activeSources.size - concurrency.maxVoices;
  const sorted = _sortForStealing(concurrency.stealPolicy, activeSources, time);

  // Stop the lowest-priority/quietest sources
  for (let i = 0; i < excess && i < sorted.length; i++) {
    const source = sorted[i];
    if (source.stopping || source.done) continue;
    // Quick fade out
    try {
      source.gainNode.gain.setTargetAtTime(0, source.context.currentTime, 0.01);
      source.bufferSource.stop(source.context.currentTime + 0.05);
    } catch (_) { /* ignore */ }
    source.done = true;
  }
}

/**
 * Check if a new voice can be added, or which voice to steal.
 * @param {Object} concurrency
 * @param {Map} activeSources
 * @param {number} newPriority - Priority of the new voice
 * @returns {boolean} true if the new voice can play
 */
export function canAddVoice(concurrency, activeSources, newPriority) {
  if (!concurrency || !activeSources) return true;
  if (activeSources.size < concurrency.maxVoices) return true;

  // Check if any existing voice has lower priority
  for (const source of activeSources.values()) {
    if (source.priority < newPriority && !source.stopping) {
      return true;
    }
  }
  return false;
}

// ============================================================================
// DESTROY
// ============================================================================

/**
 * Destroy concurrency manager.
 * @param {Object} concurrency
 */
export function destroyAudioConcurrency(concurrency) {
  // No resources to free — plain object
}

// ============================================================================
// INTERNAL
// ============================================================================

function _sortForStealing(policy, activeSources, time) {
  const sources = [];
  for (const source of activeSources.values()) {
    if (!source.done && !source.stopping) {
      sources.push(source);
    }
  }

  switch (policy) {
    case 'oldest':
      sources.sort((a, b) => a.startTime - b.startTime);
      break;

    case 'farthest':
      // Would need listener position — fall through to quietest
    case 'quietest':
    default:
      sources.sort((a, b) => {
        // Lower priority first, then lower volume
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.volume - b.volume;
      });
      break;
  }

  return sources;
}
