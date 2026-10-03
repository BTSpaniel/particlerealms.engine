// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { sha256Hex, canonicalJson } from '../../network/crypto/Trust.js';
import { deriveOpaqueRoute } from '../../network/crypto/OpaqueRoute.js';
import { hpkeBytesToHex as toHex, hpkeHexToBytes as fromHex } from '../../network/crypto/Hpke.js';

export { toHex, fromHex };

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ENCODER = new TextEncoder();

export function requirePartyCrypto() {
    if (!globalThis.isSecureContext || !globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
        throw new Error('Watch Party requires HTTPS or localhost and Web Crypto');
    }
}

export function randomPartyId() {
    requirePartyCrypto();
    return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

export async function hostFingerprint(publicKeyHex) {
    return (await sha256Hex(fromHex(publicKeyHex, 65))).slice(0, 32);
}

function encodeBase32(bytes) {
    let buffer = 0, bits = 0, result = '';
    for (const byte of bytes) {
        buffer = (buffer << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            bits -= 5;
            result += ALPHABET[(buffer >>> bits) & 31];
        }
    }
    if (bits) result += ALPHABET[(buffer << (5 - bits)) & 31];
    return result;
}

/** A WP1 code is self-contained: 128 secret bits and a 128-bit pinned host hash. */
export function parsePartyInvite(value) {
    if (typeof value !== 'string' || value.length > 4096) throw new TypeError('Invalid Watch Party invite');
    let text = value.trim();
    if (/^https?:\/\//i.test(text)) {
        const url = new URL(text);
        text = new URLSearchParams(url.hash.slice(1)).get('invite') || '';
    }
    text = text.toUpperCase().replace(/[\s-]/g, '');
    if (!/^WP1[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{52}$/.test(text)) throw new TypeError('Expected WP1 and 52 Crockford base32 invite characters');
    const encoded = text.slice(3);
    const bytes = new Uint8Array(32);
    let buffer = 0, bits = 0, offset = 0;
    for (const char of encoded) {
        buffer = (buffer << 5) | ALPHABET.indexOf(char);
        bits += 5;
        if (bits >= 8) {
            bits -= 8;
            if (offset < bytes.length) bytes[offset++] = (buffer >>> bits) & 255;
        }
    }
    // Reject alternate spellings with nonzero unused low bits.
    if (offset !== 32 || encodeBase32(bytes) !== encoded) throw new TypeError('Noncanonical WP1 invite');
    return Object.freeze({ seed: bytes.slice(0, 16), fingerprint: toHex(bytes.slice(16)), code: formatCode(encoded) });
}

function formatCode(encoded) {
    return `WP1-${encoded.match(/.{4}/g).join('-')}`;
}

export async function createPartyInvite(publicKeyHex) {
    requirePartyCrypto();
    const bytes = new Uint8Array(32);
    bytes.set(crypto.getRandomValues(new Uint8Array(16)));
    bytes.set(fromHex(await hostFingerprint(publicKeyHex), 16), 16);
    return parsePartyInvite(formatCode(encodeBase32(bytes)));
}

export function partyInviteURL(code, baseURL = globalThis.location?.href) {
    parsePartyInvite(code);
    const url = new URL(baseURL);
    if (!['https:', 'http:'].includes(url.protocol)) throw new TypeError('Invite links require an HTTP(S) app URL');
    url.search = '';
    url.hash = new URLSearchParams({ invite: code }).toString();
    return url.href;
}

/** Domain-separated expansion; 32 output bytes do not increase seed entropy. */
export async function derivePartyInvite(invite) {
    requirePartyCrypto();
    const material = await crypto.subtle.importKey('raw', invite.seed, 'HKDF', false, ['deriveBits']);
    const salt = fromHex(invite.fingerprint, 16);
    const derive = label => crypto.subtle.deriveBits({
        name: 'HKDF', hash: 'SHA-256', salt, info: ENCODER.encode(`particle-watchparty/WP1/${label}`),
    }, material, 256);
    const [routeBits, proofBits] = await Promise.all([derive('rendezvous'), derive('admission-proof')]);
    const routeSecret = new Uint8Array(routeBits);
    const proofKey = await crypto.subtle.importKey('raw', proofBits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    const route = await deriveOpaqueRoute({ routeSecret });
    return Object.freeze({
        ...invite, routeSecret, routeTag: route.routeTag, proofKey,
        inviteId: (await sha256Hex(new Uint8Array([...invite.seed, ...salt]))).slice(0, 32),
    });
}

export async function makeJoinProof(invite, claims) {
    return toHex(new Uint8Array(await crypto.subtle.sign('HMAC', invite.proofKey, ENCODER.encode(canonicalJson(claims)))));
}

export async function verifyJoinProof(invite, claims, proof) {
    try {
        return await crypto.subtle.verify('HMAC', invite.proofKey, fromHex(proof, 32), ENCODER.encode(canonicalJson(claims)));
    } catch (_) { return false; }
}
