// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/workstation/Workstation.js — a group's shared OS surface (network
// plan §18), distinct from any member's personal desktop. Wraps
// WorkstationState.js (the CRDT layer) with a groupId and a
// checkpoint-payload builder for GroupLedger's WORKSTATION_CHECKPOINTED
// event (network plan §19: "the governance ledger periodically checkpoints
// collaborative state" — the ledger stores authority decisions plus a hash
// of live state, not every live edit).

import { createWorkstationState, mergeWorkstationState, snapshotWorkstationState } from './WorkstationState.js';
import { hashIdFast } from '../../state/util/canonical.js';

/**
 * Create a new (empty) group workstation.
 * @param {object} c
 * @param {string} c.groupId
 */
export function createWorkstation({ groupId } = {}) {
  if (!groupId) throw new TypeError('createWorkstation requires a groupId');
  return { groupId, state: createWorkstationState() };
}

/** Merge in another replica's CRDT state (order-independent). */
export function mergeWorkstation(workstation, otherState) {
  return { ...workstation, state: mergeWorkstationState(workstation.state, otherState) };
}

/** Stable content hash of the current workstation state ("desktopStateRoot"). */
export function computeWorkstationStateRoot(workstation) {
  return hashIdFast(snapshotWorkstationState(workstation.state), { schemaVersion: 'workstation-state-v1' });
}

/**
 * Build the payload for a WORKSTATION_CHECKPOINTED governance event (network
 * plan §19). Pass the result straight into GroupLedger's
 * `proposeGroupEvent(ledger, { type: 'WORKSTATION_CHECKPOINTED', payload, signer })`.
 * @param {object} workstation
 * @param {object} c
 * @param {string} c.governanceHead     ledger.eventLog.head at checkpoint time
 * @param {string} [c.appRegistryHash]
 * @param {string} [c.manifestRoot]
 * @returns {object}
 */
export function buildWorkstationCheckpointPayload(workstation, { governanceHead, appRegistryHash = null, manifestRoot = null } = {}) {
  if (!governanceHead) throw new TypeError('buildWorkstationCheckpointPayload requires governanceHead');
  return {
    groupId: workstation.groupId,
    governanceHead,
    desktopStateRoot: computeWorkstationStateRoot(workstation),
    appRegistryHash,
    manifestRoot,
  };
}
