// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// ============================================================
// Universal Resonance State Engine (URC) — version source.
// ============================================================
// Order-on-demand state engine: unordered facts, a resonance codebook,
// causal order only when forced, branches when order matters, and commit
// gates that decide final truth. The machine runs in order; the MODEL does
// not assume order unless forced.
//
// Versions are facts too: migration rules reference these stamps, e.g.
// "URC-v1 dense #88 maps to URC-v2 dense #402 iff hashID and symbolicSig match".
// ============================================================

export const URC_VERSION       = '0.3.0';
export const URC_CODEBOOK      = 'URC-v1';
export const URC_SCHEMA        = 'State-v3';
export const URC_TRANSFORM     = 'DCT-v1';
export const URC_BUILD_TAG     = 'alpha';

// Causal State Engine layer stamps — referenced by transaction envelopes,
// witness receipts, and migration rules (spec rule 5: everything is versioned).
// CSE phases 1–7 complete (formal core, single-authority, reliability, safe
// concurrency, AI world model, distributed authority, simulation & resonance).
export const CSE_TX_SCHEMA     = 'cse-tx-1';
export const CSE_VALIDATOR     = 'validator-1';
export const CSE_POLICY        = 'policy-1';
export const CSE_PHASES        = 7;

export const URC_FULL = `v${URC_VERSION}-${URC_BUILD_TAG}`;

/** Version stamp embedded on every State/CodeEntry/Receipt for migration + audit. */
export function urcVersionStamp() {
  return Object.freeze({
    codebookVersion: URC_CODEBOOK,
    schemaVersion: URC_SCHEMA,
    transformVersion: URC_TRANSFORM,
    txSchema: CSE_TX_SCHEMA,
    validatorVersion: CSE_VALIDATOR,
    policyVersion: CSE_POLICY,
    engineVersion: URC_FULL,
  });
}
