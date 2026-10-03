// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

const DURABILITY_HINTS = new Set(['default', 'strict', 'relaxed']);

export function normalizeIndexedDBDurability(value = 'default') {
    const durability = String(value ?? 'default');
    if (!DURABILITY_HINTS.has(durability)) {
        throw new TypeError(`IndexedDB durability must be default, strict, or relaxed; received ${JSON.stringify(value)}`);
    }
    return durability;
}

/**
 * Open a transaction with a standards-based durability hint. Older engines
 * that reject the options argument fall back to their default transaction.
 */
export function openIndexedDBTransaction(database, storeNames, mode = 'readonly', { durability = 'default' } = {}) {
    if (!database || typeof database.transaction !== 'function') {
        throw new TypeError('openIndexedDBTransaction requires an IDBDatabase-like object');
    }
    const normalizedDurability = normalizeIndexedDBDurability(durability);
    if (mode !== 'readwrite' || normalizedDurability === 'default') {
        return database.transaction(storeNames, mode);
    }
    try {
        return database.transaction(storeNames, mode, { durability: normalizedDurability });
    } catch (error) {
        if (error?.name !== 'TypeError' && error?.name !== 'NotSupportedError') throw error;
        return database.transaction(storeNames, mode);
    }
}
