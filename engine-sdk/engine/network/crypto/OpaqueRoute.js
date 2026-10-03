// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

const ENCODER = new TextEncoder();

async function secretBytes(value, projectId) {
    if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
        const bytes = value instanceof Uint8Array ? value.slice() : new Uint8Array(value);
        if (bytes.length !== 32) throw new RangeError('private route invites must contain exactly 32 random bytes');
        return bytes;
    }
    if (typeof value === 'string' && value.length) {
        if (ENCODER.encode(value).length < 12) throw new RangeError('private room passphrases must contain at least 12 UTF-8 bytes');
        const material = await crypto.subtle.importKey('raw', ENCODER.encode(value), 'PBKDF2', false, ['deriveBits']);
        return new Uint8Array(await crypto.subtle.deriveBits({
            name: 'PBKDF2',
            hash: 'SHA-256',
            iterations: 210_000,
            salt: ENCODER.encode(`particle-private-room-v2:${String(projectId ?? 'default')}`),
        }, material, 256));
    }
    return new Uint8Array(await crypto.subtle.digest(
        'SHA-256', ENCODER.encode(`particle-public-room-v2:${String(projectId ?? 'default')}`),
    ));
}

function toHex(value) {
    return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function deriveOpaqueRoute({ routeSecret = null, projectId = 'default' } = {}) {
    const normalized = await secretBytes(routeSecret, projectId);
    const key = await crypto.subtle.importKey('raw', normalized, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const tag = await crypto.subtle.sign('HMAC', key, ENCODER.encode('particle-route-v2'));
    return Object.freeze({
        routeTag: toHex(tag),
        privacy: routeSecret == null ? 'public' : 'private',
    });
}
