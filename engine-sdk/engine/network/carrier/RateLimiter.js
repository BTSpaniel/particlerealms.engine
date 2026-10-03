// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/carrier/RateLimiter.js — token-bucket rate limiting for carrier
// forwarding (network plan §35/§36 spam controls, V1: rate limits + dedupe,
// no proof-of-work yet).

import { runtimeFrameDeltaSeconds } from '../../core/math/FrameMath.js';
import { tokenBucketConsume, tokenBucketRefill } from '../../core/math/QueueMath.js';

/**
 * Create a token bucket.
 * @param {object} [c]
 * @param {number} [c.capacity=30]         max burst size
 * @param {number} [c.refillPerSecond=10]  steady-state rate
 */
export function createRateLimiter({ capacity = 30, refillPerSecond = 10 } = {}) {
  const initial = tokenBucketRefill(capacity, {
    capacity,
    refillRatePerSecond: refillPerSecond,
    elapsedMs: 0,
  });
  return {
    capacity: initial.capacity,
    tokens: initial.tokensAfterRefill,
    refillPerSecond: initial.refillRatePerSecond,
    lastRefill: Date.now(),
  };
}

function _elapsedMs(limiter, now) {
  return runtimeFrameDeltaSeconds(now, limiter.lastRefill, Infinity) * 1000;
}

function _commitRefill(limiter, now, tokens) {
  limiter.tokens = tokens;
  const timestamp = Number(now);
  if (Number.isFinite(timestamp)) limiter.lastRefill = timestamp;
}

/** Try to consume `cost` tokens. Returns false (caller should drop/reject) if insufficient. */
export function tryConsume(limiter, cost = 1, now = Date.now()) {
  const result = tokenBucketConsume({
    tokens: limiter.tokens,
    capacity: limiter.capacity,
    refillRatePerSecond: limiter.refillPerSecond,
    elapsedMs: _elapsedMs(limiter, now),
    cost,
  });
  _commitRefill(limiter, now, result.tokensAfter);
  return result.conforming;
}

/** Tokens currently available (after applying refill for elapsed time). */
export function availableTokens(limiter, now = Date.now()) {
  const result = tokenBucketRefill(limiter.tokens, {
    capacity: limiter.capacity,
    refillRatePerSecond: limiter.refillPerSecond,
    elapsedMs: _elapsedMs(limiter, now),
  });
  _commitRefill(limiter, now, result.tokensAfterRefill);
  return limiter.tokens;
}
