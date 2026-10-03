// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// state/authority/PolicyEngine.js — Authority-plane policy engine + approval/risk
// gates (spec §3 plane 6, rules 30, 34).
//
// Capabilities say WHAT a principal may do; policy says under WHICH conditions it
// is currently allowed, and which actions need human/authority approval before
// they may commit. The engine evaluates ordered rules (deny overrides allow) and
// classifies an action's risk; irreversible / high-risk actions are gated behind
// an explicit approval that must be present at commit time — closing the
// time-of-check/time-of-use gap together with the capability re-check (rule 31).
// Policy is versioned (rule 5) so receipts can record which policy decided.

export const RISK_LEVEL = Object.freeze({ SAFE: 'safe', LOW: 'low', MEDIUM: 'medium', HIGH: 'high', IRREVERSIBLE: 'irreversible' });
export const DECISION = Object.freeze({ ALLOW: 'allow', DENY: 'deny' });

/**
 * @param {object} r
 * @param {string} r.id
 * @param {(ctx:object)=>boolean} r.when   matches the request context
 * @param {string} r.effect ALLOW | DENY
 * @param {string} [r.risk] RISK_LEVEL this rule asserts for the action
 * @param {boolean} [r.requireApproval]
 */
export function policyRule(r) {
  if (typeof r?.when !== 'function') throw new TypeError('policyRule needs a when()');
  return Object.freeze({
    id: String(r.id ?? 'rule'),
    when: r.when,
    effect: r.effect === DECISION.DENY ? DECISION.DENY : DECISION.ALLOW,
    risk: r.risk ?? RISK_LEVEL.SAFE,
    requireApproval: r.requireApproval ?? (r.risk === RISK_LEVEL.HIGH || r.risk === RISK_LEVEL.IRREVERSIBLE),
  });
}

export class PolicyEngine {
  /**
   * @param {object} [cfg]
   * @param {object[]} [cfg.rules] ordered policy rules
   * @param {string} [cfg.version] policy version stamp (recorded on receipts)
   * @param {boolean} [cfg.defaultAllow] decision when no rule matches (default deny)
   */
  constructor(cfg = {}) {
    this._rules = (cfg.rules ?? []).map(policyRule);
    this.version = cfg.version ?? 'policy-1';
    this._defaultAllow = !!cfg.defaultAllow;
  }

  add(rule) { this._rules.push(policyRule(rule)); return this; }

  /**
   * Evaluate a request. DENY overrides ALLOW; risk is the max asserted by any
   * matching rule; approval is required if any matching allow rule demands it.
   * @param {object} ctx request context (principal, action, object, …)
   * @param {{ isApproved?:(ctx:object)=>boolean }} [opts]
   * @returns {{ allowed:boolean, decision:string, risk:string, requiresApproval:boolean, matched:string[], reason:string|null, policyVersion:string }}
   */
  evaluate(ctx = {}, opts = {}) {
    const isApproved = opts.isApproved ?? (() => false);
    const order = [RISK_LEVEL.SAFE, RISK_LEVEL.LOW, RISK_LEVEL.MEDIUM, RISK_LEVEL.HIGH, RISK_LEVEL.IRREVERSIBLE];
    let decision = this._defaultAllow ? DECISION.ALLOW : DECISION.DENY;
    let risk = RISK_LEVEL.SAFE;
    let requireApproval = false;
    const matched = [];
    let denied = false;
    for (const rule of this._rules) {
      if (!rule.when(ctx)) continue;
      matched.push(rule.id);
      if (order.indexOf(rule.risk) > order.indexOf(risk)) risk = rule.risk;
      if (rule.effect === DECISION.DENY) { denied = true; }
      else if (rule.requireApproval) requireApproval = true;
    }
    if (matched.length > 0 && !denied) decision = DECISION.ALLOW;
    if (denied) decision = DECISION.DENY;
    // An approval-gated action is only allowed when approval is actually present.
    const approvalSatisfied = !requireApproval || isApproved(ctx);
    const allowed = decision === DECISION.ALLOW && approvalSatisfied;
    const reason = denied ? 'policy-deny'
      : (decision === DECISION.DENY ? 'no-matching-allow'
        : (!approvalSatisfied ? 'requires-approval' : null));
    return { allowed, decision, risk, requiresApproval: requireApproval, matched, reason, policyVersion: this.version };
  }
}
