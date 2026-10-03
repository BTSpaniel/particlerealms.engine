// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// network/syncManager/SyncManager.js — per-profile sync rules (network plan
// §20). This module only decides WHAT should sync WHERE (rules + gating);
// it does not move any bytes — actual transport goes through the routes/
// group crypto layers built in earlier phases. Rules are local, in-memory
// config; callers persist them via their own storage.

import { SYNC_SCOPE, SYNC_CATEGORIES } from './SyncCategory.js';

function _defaultRules() {
  return {
    profile: { scope: SYNC_SCOPE.MY_DEVICES, enabled: true },
    desktop: { scope: SYNC_SCOPE.MY_DEVICES, enabled: true },
    apps: { scope: SYNC_SCOPE.MY_DEVICES, enabled: true },
    files: { scope: SYNC_SCOPE.DEVICE_ONLY, enabled: false },
    worlds: { scope: SYNC_SCOPE.PRIVATE_GROUP, enabled: false },
    ai: { scope: SYNC_SCOPE.DEVICE_ONLY, enabled: true },
    developer: { scope: SYNC_SCOPE.DEVICE_ONLY, enabled: false },
  };
}

/**
 * Create a sync manager with sensible defaults (network plan §20 examples:
 * "sync AI memory only to my devices", "never sync private keys" — private
 * keys simply have no category here at all, by design).
 * @param {object} [c]
 * @param {object} [c.rules]  partial overrides keyed by category
 */
export function createSyncManager({ rules = {} } = {}) {
  const merged = { ..._defaultRules(), ...rules };
  return { _rules: new Map(Object.entries(merged)) };
}

/**
 * Set/update a category's sync rule.
 * @param {object} manager
 * @param {string} category  one of SYNC_CATEGORIES
 * @param {object} c
 * @param {string} [c.scope]  one of SYNC_SCOPE
 * @param {boolean} [c.enabled]
 * @param {string[]} [c.targetDeviceIds]  required/used when scope === SELECTED_DEVICES
 * @returns {object} the resulting rule
 */
export function setSyncRule(manager, category, { scope, enabled, targetDeviceIds } = {}) {
  if (!SYNC_CATEGORIES.includes(category)) throw new TypeError(`setSyncRule: unknown sync category "${category}"`);
  const existing = manager._rules.get(category) || {};
  const rule = { ...existing };
  if (scope !== undefined) rule.scope = scope;
  if (enabled !== undefined) rule.enabled = enabled;
  if (targetDeviceIds !== undefined) rule.targetDeviceIds = [...targetDeviceIds];
  manager._rules.set(category, rule);
  return rule;
}

/** Get a category's current rule, or null if unset. */
export function getSyncRule(manager, category) {
  return manager._rules.get(category) ?? null;
}

/** All rules as a flat array of `{ category, scope, enabled, ... }`. */
export function listSyncRules(manager) {
  return [...manager._rules.entries()].map(([category, rule]) => ({ category, ...rule }));
}

/**
 * Should `category` currently sync to `targetScope` right now? Used as a
 * gate before a caller pushes an update over a route/group.
 * @returns {boolean}
 */
export function shouldSync(manager, category, targetScope) {
  const rule = manager._rules.get(category);
  if (!rule || !rule.enabled) return false;
  return rule.scope === targetScope;
}
