// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/routes/ReconnectBackoff.js — exponential reconnect backoff with
// jitter (network plan §8: "0.5s -> 1s -> 2s -> 4s -> 8s -> max 30s, with
// random jitter"). Mirrors the constants already used by
// engine/collab/CollabCore.js (RECONNECT_BASE_MS=1000, RECONNECT_MAX_MS=30000,
// MAX_RECONNECT_ATTEMPTS=8) so route-level and WebRTC-level reconnects behave
// consistently.

export const DEFAULT_BACKOFF_BASE_MS = 1000;
export const DEFAULT_BACKOFF_MAX_MS = 30000;
export const DEFAULT_BACKOFF_MAX_ATTEMPTS = 8;
export const DEFAULT_BACKOFF_JITTER_RATIO = 0.2;

/**
 * Create a reconnect backoff sequence.
 * @param {object} [cfg]
 * @param {number} [cfg.baseMs]
 * @param {number} [cfg.maxMs]
 * @param {number} [cfg.maxAttempts]  0 = unlimited
 * @param {number} [cfg.jitterRatio]  +/- fraction of the delay to randomize
 * @param {() => number} [cfg.random]  injectable RNG for deterministic tests
 * @returns {object} backoff state
 */
export function createReconnectBackoff(cfg = {}) {
  return {
    baseMs: cfg.baseMs ?? DEFAULT_BACKOFF_BASE_MS,
    maxMs: cfg.maxMs ?? DEFAULT_BACKOFF_MAX_MS,
    maxAttempts: cfg.maxAttempts ?? DEFAULT_BACKOFF_MAX_ATTEMPTS,
    jitterRatio: cfg.jitterRatio ?? DEFAULT_BACKOFF_JITTER_RATIO,
    _random: cfg.random ?? Math.random,
    attempts: 0,
  };
}

/**
 * Compute the next delay (ms) and advance the attempt counter.
 * @param {object} backoff
 * @returns {{ delayMs:number, attempt:number, exhausted:boolean }}
 */
export function nextBackoffDelay(backoff) {
  backoff.attempts += 1;
  const exhausted = backoff.maxAttempts > 0 && backoff.attempts > backoff.maxAttempts;
  const raw = Math.min(backoff.maxMs, backoff.baseMs * (2 ** (backoff.attempts - 1)));
  const jitter = raw * backoff.jitterRatio * (backoff._random() * 2 - 1);
  const delayMs = Math.max(0, Math.round(raw + jitter));
  return { delayMs, attempt: backoff.attempts, exhausted };
}

/** True once `maxAttempts` has been exceeded (0 = never exhausted). Matches nextBackoffDelay's `exhausted` flag. */
export function isBackoffExhausted(backoff) {
  return backoff.maxAttempts > 0 && backoff.attempts > backoff.maxAttempts;
}

/** Reset the attempt counter after a successful (re)connect. */
export function resetBackoff(backoff) {
  backoff.attempts = 0;
  return backoff;
}
