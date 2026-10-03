// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/facts/Constraints.js — the laws of the system.
//
// Layer law: runtime uses simple validators; commit uses stronger validators
// (a superset). A constraint never repairs — it accepts or rejects. When a
// commit constraint fails, the caller branches / quarantines / requests
// authority (see CommitGate, M5) rather than silently fixing.

export const SCOPE_RUNTIME = 'runtime';
export const SCOPE_COMMIT = 'commit';

/**
 * Define a constraint.
 * @param {string} id
 * @param {(liveFacts:Set<string>)=>boolean} test  true = legal
 * @param {object} [opts] { scope:'runtime'|'commit', message }
 */
export function constraint(id, test, opts = {}) {
  return Object.freeze({
    id,
    test,
    scope: opts.scope === SCOPE_COMMIT ? SCOPE_COMMIT : SCOPE_RUNTIME,
    message: opts.message || `constraint failed: ${id}`,
  });
}

/**
 * Validate live facts. phase 'runtime' runs only runtime constraints; phase
 * 'commit' runs ALL (runtime + commit) — commit is strictly stronger.
 * @returns {{ ok:boolean, violations:Array<{id,message}> }}
 */
export function validateFacts(liveFacts, constraints, { phase = SCOPE_RUNTIME } = {}) {
  const violations = [];
  for (const c of constraints) {
    if (phase === SCOPE_RUNTIME && c.scope === SCOPE_COMMIT) continue; // commit-only skipped at runtime
    let ok = false;
    try { ok = !!c.test(liveFacts); } catch (e) { ok = false; }
    if (!ok) violations.push({ id: c.id, message: c.message });
  }
  return { ok: violations.length === 0, violations };
}

// ── Common constraint helpers ────────────────────────────────────────────────

/** No more than one live fact matching a regex (single source of truth). */
export function atMostOne(id, pattern, opts = {}) {
  return constraint(id, (facts) => {
    let n = 0;
    for (const f of facts) if (pattern.test(f)) { n++; if (n > 1) return false; }
    return true;
  }, opts);
}

/** Two facts must never be live at once (mutual exclusion). */
export function mutuallyExclusive(id, a, b, opts = {}) {
  return constraint(id, (facts) => !(facts.has(a) && facts.has(b)), opts);
}
