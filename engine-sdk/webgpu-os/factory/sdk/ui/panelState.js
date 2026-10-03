// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Domain-neutral panel collection helpers shared by OS-native workbenches.
 * Callers retain ownership of panel definitions, migrations, labels, and UI.
 */

function allowedPanelIds(value) {
  const source = value instanceof Set ? [...value] : Array.isArray(value) ? value : [];
  return new Set(source.filter(id => typeof id === 'string' && id.length));
}

function uniqueAllowedIds(value, allowed) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter(id => typeof id === 'string' && allowed.has(id))));
}

/** Normalize a panel-id list without retaining unknown or duplicate IDs. */
export function normalizePanelIds(value, {
  allowedIds = [],
  fallbackIds = [],
  allowEmpty = false,
} = {}) {
  const allowed = allowedPanelIds(allowedIds);
  const requested = uniqueAllowedIds(value, allowed);
  if (requested.length || allowEmpty) return requested;
  return uniqueAllowedIds(fallbackIds, allowed);
}

/**
 * Normalize persisted panel order and append every omitted default exactly once.
 * Unknown IDs are discarded; app-specific migrations remain the caller's job.
 */
export function normalizePanelOrder(value, {
  allowedIds = [],
  defaultOrder = [],
} = {}) {
  const allowed = allowedPanelIds(allowedIds);
  const requested = Array.isArray(value) ? value : defaultOrder;
  const normalized = uniqueAllowedIds(requested, allowed);
  for (const id of uniqueAllowedIds(defaultOrder, allowed)) {
    if (!normalized.includes(id)) normalized.push(id);
  }
  return normalized;
}

/** Return a stable reordered copy of panel definitions. */
export function orderPanels(definitions, panelOrder = []) {
  const source = Array.isArray(definitions) ? definitions : [];
  const order = new Map((Array.isArray(panelOrder) ? panelOrder : [])
    .filter(id => typeof id === 'string')
    .map((id, index) => [id, index]));
  return source
    .map((definition, sourceIndex) => ({ definition, sourceIndex }))
    .sort((left, right) => {
      const leftIndex = order.get(left.definition?.id) ?? Number.MAX_SAFE_INTEGER;
      const rightIndex = order.get(right.definition?.id) ?? Number.MAX_SAFE_INTEGER;
      return leftIndex - rightIndex || left.sourceIndex - right.sourceIndex;
    })
    .map(entry => entry.definition);
}

/** Resolve visible and active panels against a caller-owned definition list. */
export function resolvePanelActivity(definitions, state = {}, {
  fallbackVisibleIds = [],
} = {}) {
  const source = Array.isArray(definitions) ? definitions : [];
  const allowedIds = source.map(definition => definition?.id);
  const visibleIds = normalizePanelIds(state.visiblePanelIds, {
    allowedIds,
    fallbackIds: fallbackVisibleIds,
  });
  const visible = new Set(visibleIds);
  const active = visible.has(state.activePanelId)
    ? state.activePanelId
    : source.find(definition => visible.has(definition?.id))?.id ?? '';
  return { visible, active };
}

export default Object.freeze({
  normalizePanelIds,
  normalizePanelOrder,
  orderPanels,
  resolvePanelActivity,
});
