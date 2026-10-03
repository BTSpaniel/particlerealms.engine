// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/commit/CorrectionGate.js — correction is NOT authority.
//
// Tiered policy (the layer law for repair):
//   VISUAL    state may auto-correct (particles, cache, chunk, network-with-confidence)
//   SEMANTIC  state must verify before applying (inventory, save, ...)
//   SECURITY  state must NEVER silently repair (permission, ownership, security)
//
// When unsure: branch / quarantine / request authority — never silently fix.
// Resonance (nearestAttractor) may SUGGEST the repaired value, but acceptance
// is decided here, and a security tier can only escalate, never apply.

export const CORRECTION_TIERS = Object.freeze({
  VISUAL: 'visual',
  SEMANTIC: 'semantic',
  SECURITY: 'security',
});

export const CORRECTION_ACTIONS = Object.freeze({
  APPLY: 'apply',
  QUARANTINE: 'quarantine',
  BRANCH: 'branch',
  REQUEST_AUTHORITY: 'request-authority',
});

/**
 * Decide what to do with a (resonance-)repaired candidate.
 * @param {object} o
 * @param {string} o.tier      CORRECTION_TIERS.*
 * @param {*} o.repaired       suggested repaired value (from attractor snap, etc.)
 * @param {()=>boolean} [o.verify]  semantic verifier (hash / constraint / authority check)
 * @param {boolean} [o.unsure] if true, never auto-apply even at VISUAL
 * @returns {{ action:string, value:*, reason:string }}
 */
export function correct({ tier, repaired, verify, unsure = false }) {
  if (tier === CORRECTION_TIERS.SECURITY) {
    // Security state must never silently repair — only escalate.
    return { action: CORRECTION_ACTIONS.REQUEST_AUTHORITY, value: null, reason: 'security state never silently repairs' };
  }
  if (tier === CORRECTION_TIERS.SEMANTIC) {
    if (!unsure && typeof verify === 'function' && verify()) {
      return { action: CORRECTION_ACTIONS.APPLY, value: repaired, reason: 'verified' };
    }
    return { action: CORRECTION_ACTIONS.QUARANTINE, value: null, reason: 'verification failed or unsure' };
  }
  if (tier === CORRECTION_TIERS.VISUAL) {
    if (unsure) return { action: CORRECTION_ACTIONS.BRANCH, value: repaired, reason: 'unsure — branch instead of assert' };
    return { action: CORRECTION_ACTIONS.APPLY, value: repaired, reason: 'visual auto-correct' };
  }
  return { action: CORRECTION_ACTIONS.QUARANTINE, value: null, reason: 'unknown tier' };
}
