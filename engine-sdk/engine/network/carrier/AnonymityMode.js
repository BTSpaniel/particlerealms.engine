// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/carrier/AnonymityMode.js — connection mode selection + UI
// transport-truth labels (network plan §25/§42): the UI must never claim a
// connection is more private than it actually is.

export const ANONYMITY_MODE = Object.freeze({
  ANONYMOUS: 'anonymous',           // unknown/public peers -> carrier/onion required
  TRUST_PENDING: 'trust_pending',   // invite accepted, identity exchange not yet approved
  TRUSTED_DIRECT: 'trusted_direct', // group-approved peer, direct allowed
  MY_DEVICES: 'my_devices',         // own device, direct preferred
  HIGH_RISK: 'high_risk',           // policy forces anonymous/onion regardless of trust
});

const TRANSPORT_LABEL = Object.freeze({
  [ANONYMITY_MODE.ANONYMOUS]: 'Anonymous route',
  [ANONYMITY_MODE.TRUST_PENDING]: 'Carrier route (pending trust)',
  [ANONYMITY_MODE.TRUSTED_DIRECT]: 'Trusted direct',
  [ANONYMITY_MODE.MY_DEVICES]: 'My devices (direct)',
  [ANONYMITY_MODE.HIGH_RISK]: 'Anonymous route (forced)',
});

/**
 * Decide the anonymity mode for a peer relationship (network plan §25
 * policy: unknown/public -> anonymous; new invites -> anonymous until
 * approved; group members -> group policy; trusted/own devices -> direct).
 * @param {object} c
 * @param {boolean} [c.isSelfDevice]
 * @param {boolean} [c.groupApproved]
 * @param {boolean} [c.trustPending]
 * @param {boolean} [c.highRiskOverride]  force anonymous regardless of trust
 * @returns {string} one of ANONYMITY_MODE
 */
export function selectAnonymityMode({ isSelfDevice = false, groupApproved = false, trustPending = false, highRiskOverride = false } = {}) {
  if (highRiskOverride) return ANONYMITY_MODE.HIGH_RISK;
  if (isSelfDevice) return ANONYMITY_MODE.MY_DEVICES;
  if (groupApproved) return ANONYMITY_MODE.TRUSTED_DIRECT;
  if (trustPending) return ANONYMITY_MODE.TRUST_PENDING;
  return ANONYMITY_MODE.ANONYMOUS;
}

/** Human-readable, honest transport label for the UI (§42). */
export function transportTruthLabel(mode) {
  return TRANSPORT_LABEL[mode] || 'Unknown route';
}

/** Whether a mode permits direct (non-relayed) transport — direct may reveal network metadata to the peer (§42). */
export function allowsDirectTransport(mode) {
  return mode === ANONYMITY_MODE.TRUSTED_DIRECT || mode === ANONYMITY_MODE.MY_DEVICES;
}
