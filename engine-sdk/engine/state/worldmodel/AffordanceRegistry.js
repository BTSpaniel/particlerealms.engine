// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/worldmodel/AffordanceRegistry.js — declares LEGAL actions rather than
// letting the model invent tool syntax (spec §15 "Affordance registry", rule
// 34/50).
//
// Each affordance binds an action to an object type and declares: preconditions
// (named predicates evaluated against context), the capability required to do
// it, predicted effects, a risk level, and a rollback/compensation hint. The
// planner asks "what may I legally do to this object?" and the registry answers
// from explicit declarations. High-risk / irreversible actions require explicit
// approval — the registry surfaces this but NEVER authorizes by itself (the
// capability + commit layer remains the authority).

export const RISK = Object.freeze({ SAFE: 'safe', LOW: 'low', MEDIUM: 'medium', HIGH: 'high', IRREVERSIBLE: 'irreversible' });

/**
 * @param {object} a
 * @param {string} a.action
 * @param {string} a.objectType
 * @param {string[]} [a.preconditions] named predicates that must hold
 * @param {string} [a.capabilityRequired]
 * @param {object} [a.predictedEffects]
 * @param {string} [a.risk] one of RISK
 * @param {string} [a.rollback] rollback / compensation hint
 * @param {boolean} [a.requiresApproval]
 */
export function makeAffordance(a = {}) {
  const risk = a.risk ?? RISK.SAFE;
  return Object.freeze({
    action: String(a.action ?? 'act'),
    objectType: String(a.objectType ?? '*'),
    preconditions: Object.freeze([...(a.preconditions ?? [])].map(String)),
    capabilityRequired: a.capabilityRequired ?? null,
    predictedEffects: Object.freeze({ ...(a.predictedEffects ?? {}) }),
    risk,
    rollback: a.rollback ?? null,
    // High-risk and irreversible actions always require approval (rule 34).
    requiresApproval: a.requiresApproval ?? (risk === RISK.HIGH || risk === RISK.IRREVERSIBLE),
  });
}

export class AffordanceRegistry {
  constructor() { this._byType = new Map(); } // objectType → Map(action → affordance)

  register(affordance) {
    const a = makeAffordance(affordance);
    if (!this._byType.has(a.objectType)) this._byType.set(a.objectType, new Map());
    this._byType.get(a.objectType).set(a.action, a);
    return this;
  }

  get(objectType, action) { return this._byType.get(String(objectType))?.get(String(action)) ?? null; }

  /**
   * Legal actions for an object type whose preconditions hold in `ctx`.
   * @param {string} objectType
   * @param {(predicate:string)=>boolean} [evaluate] precondition evaluator
   */
  legalActions(objectType, evaluate = () => true) {
    const m = this._byType.get(String(objectType));
    if (!m) return [];
    return [...m.values()].filter((a) => a.preconditions.every((p) => evaluate(p)));
  }

  /**
   * Check whether an action is permitted right now. Returns a structured verdict;
   * this is ADVISORY — it reports capability/approval requirements but the actual
   * authority decision happens at commit (capability + policy).
   * @returns {{ allowed:boolean, reasons:string[], affordance:object|null, needsApproval:boolean }}
   */
  check(objectType, action, { evaluate = () => true, hasCapability = () => false, isApproved = () => false } = {}) {
    const aff = this.get(objectType, action);
    const reasons = [];
    if (!aff) return { allowed: false, reasons: ['no-such-affordance'], affordance: null, needsApproval: false };
    for (const p of aff.preconditions) if (!evaluate(p)) reasons.push(`precondition:${p}`);
    if (aff.capabilityRequired && !hasCapability(aff.capabilityRequired)) reasons.push('missing-capability');
    const needsApproval = aff.requiresApproval && !isApproved(aff);
    if (needsApproval) reasons.push('requires-approval');
    return { allowed: reasons.length === 0, reasons, affordance: aff, needsApproval };
  }
}
