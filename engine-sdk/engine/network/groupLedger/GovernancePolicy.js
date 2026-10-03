// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/groupLedger/GovernancePolicy.js — group governance modes on top of
// the CSE PolicyEngine (network plan §16 "adminless and moderatorless
// groups"): unanimous / majority / threshold / founder-protected /
// open-capability. This module decides WHETHER a given vote/approval set is
// enough for a governance action to commit; GroupLedger.js decides WHAT
// happens once it does.

import { PolicyEngine, RISK_LEVEL, DECISION, policyRule } from '../../state/authority/PolicyEngine.js';

export const GOVERNANCE_MODES = Object.freeze({
  UNANIMOUS: 'unanimous',
  MAJORITY: 'majority',
  THRESHOLD: 'threshold',
  FOUNDER_PROTECTED: 'founder-protected',
  OPEN_CAPABILITY: 'open-capability',
});

/** Governance actions that always require approval (network plan §17 eviction/bans). */
export const IRREVERSIBLE_ACTIONS = Object.freeze(new Set([
  'MEMBER_REVOKED', 'MEMBER_BANNED', 'KEY_ROTATED', 'ROLE_CHANGED',
]));

/**
 * Build a governance policy for a group.
 * @param {object} c
 * @param {string} [c.mode]              one of GOVERNANCE_MODES
 * @param {() => Set<string>} [c.founders]    live founder membershipId set
 * @param {() => number} [c.memberCount]      live member count
 * @param {number} [c.threshold]         required approvals for THRESHOLD mode
 * @returns {{ mode:string, engine:PolicyEngine, isApproved:(ctx:object)=>boolean }}
 */
export function createGovernancePolicy({
  mode = GOVERNANCE_MODES.MAJORITY,
  founders = () => new Set(),
  memberCount = () => 1,
  threshold = null,
} = {}) {
  const rules = [
    policyRule({
      id: 'irreversible-requires-approval',
      when: (ctx) => IRREVERSIBLE_ACTIONS.has(ctx.action),
      effect: DECISION.ALLOW,
      risk: RISK_LEVEL.IRREVERSIBLE,
      requireApproval: true,
    }),
    policyRule({
      id: 'default-allow-safe-actions',
      when: (ctx) => !IRREVERSIBLE_ACTIONS.has(ctx.action),
      effect: DECISION.ALLOW,
      risk: RISK_LEVEL.LOW,
    }),
  ];
  const engine = new PolicyEngine({ rules, version: `governance-${mode}` });

  /** Whether `ctx.approvals` (a Set/array of voter membershipIds) satisfies this mode. */
  function isApproved(ctx) {
    const approvals = ctx?.approvals;
    const votes = approvals instanceof Set ? approvals : new Set(approvals || []);
    if (mode === GOVERNANCE_MODES.OPEN_CAPABILITY) return true;
    if (mode === GOVERNANCE_MODES.FOUNDER_PROTECTED) {
      const f = founders();
      for (const v of votes) if (f.has(v)) return true;
      return false;
    }
    if (mode === GOVERNANCE_MODES.UNANIMOUS) return votes.size >= memberCount();
    if (mode === GOVERNANCE_MODES.THRESHOLD) return votes.size >= (threshold ?? Math.ceil(memberCount() / 2));
    // MAJORITY (default): strictly more than half of current members
    return votes.size > Math.floor(memberCount() / 2);
  }

  return { mode, engine, isApproved };
}
