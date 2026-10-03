// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * core/history/boundary.js — the hard boundary between content undo and the
 * session timeline.
 *
 *   content undo     changes inside a panel's content area (text, strokes,
 *                    node connections) — managed per panel
 *   session timeline workspace structure (panel arrangement, layout, open/close)
 *
 * Content undo must never carry workspace-structure changes, and vice versa.
 * This is enforced at contract-test time; violations are caught before publish.
 */

const WORKSPACE_KEYS = ['zone', 'zones', 'layout', 'panelArrangement', 'openPanels', 'mountOrder', 'displays'];

/**
 * Returns a list of boundary violations for an undo entry payload. An empty
 * list means the entry is content-only and valid.
 * @param {object} entryPayload  the data an entry mutates (optional metadata)
 * @returns {string[]}
 */
export function boundaryViolations(entryPayload) {
  if (!entryPayload || typeof entryPayload !== 'object') return [];
  const violations = [];
  for (const key of WORKSPACE_KEYS) {
    if (key in entryPayload) {
      violations.push(`content undo entry touches workspace-structure key "${key}" — use the session timeline`);
    }
  }
  return violations;
}

export function isContentSafe(entryPayload) {
  return boundaryViolations(entryPayload).length === 0;
}
