// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ReceiptCrypto.js — shared canonicalization + SHA-256 hashing for every
 * Phase -1 risk-spike JSON receipt under `agi/particle_voice/risk/`.
 *
 * Kept tiny and dependency-free so any risk page can import it directly.
 */

/** Recursively sort object keys so hashing is independent of insertion order. */
export function canonicalizeForHash(value) {
    if (Array.isArray(value)) return value.map(canonicalizeForHash);
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.keys(value).sort().map((key) => [key, canonicalizeForHash(value[key])]),
        );
    }
    return value;
}

/** Hash exactly the supplied byte view, or null if WebCrypto is unavailable. */
export async function sha256HexOfBytes(value) {
    if (!globalThis.crypto?.subtle) return null;
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value)
        : ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : null;
    if (!bytes) throw new TypeError('Receipt hashing requires an ArrayBuffer or an ArrayBuffer view.');
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 hex digest of a canonicalized JSON value, or null if WebCrypto is unavailable. */
export async function sha256HexOf(value) {
    if (!globalThis.crypto?.subtle) return null;
    return sha256HexOfBytes(new TextEncoder().encode(JSON.stringify(canonicalizeForHash(value))));
}

/** Convenience: `sha256:<hex>` prefixed digest, or null. */
export async function receiptHashOf(value) {
    const hex = await sha256HexOf(value);
    return hex ? `sha256:${hex}` : null;
}

export function prepareJsonDownload(receipt, filenamePrefix) {
    const blob = new Blob([`${JSON.stringify(receipt, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const timestamp = String(receipt.generatedAt ?? new Date().toISOString()).replace(/[:.]/g, '-');
    return Object.freeze({
        url,
        filename: `${filenamePrefix}-${timestamp}.json`,
        revoke() { URL.revokeObjectURL(url); },
    });
}
