// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { hpkeHexToBytes } from './Hpke.js';

const ENCODER = new TextEncoder();

export function canonicalJson(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function toHex(value) {
    return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(value) {
    const binary = typeof value === 'string' ? ENCODER.encode(value) : value;
    return toHex(await crypto.subtle.digest('SHA-256', binary));
}

export async function verifyRawSignature(publicKeyHex, bytes, signatureHex) {
    try {
        const key = await crypto.subtle.importKey(
            'raw', hpkeHexToBytes(publicKeyHex, 65), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'],
        );
        return crypto.subtle.verify(
            { name: 'ECDSA', hash: 'SHA-256' }, key,
            hpkeHexToBytes(signatureHex, 64), bytes,
        );
    } catch (_) {
        return false;
    }
}

export async function verifySignedManifest(
    signed,
    expectedPins,
    nowSeconds = Math.floor(Date.now() / 1000),
    expectedRootId = null,
    expectedRootVersion = null,
    expectedRollbackVersion = null,
    expectedFormat = 'particle-node-manifest/2',
) {
    try {
        if (!signed || signed.payload?.format !== expectedFormat) return false;
        const rawKey = hpkeHexToBytes(signed.payload.signingPublicKeyHex, 65);
        const pin = await sha256Hex(rawKey);
        const candidates = (Array.isArray(expectedPins) ? expectedPins : [expectedPins])
            .map((entry) => typeof entry === 'string' ? { pin: entry } : entry)
            .filter((entry) => entry && typeof entry.pin === 'string' && entry.revoked !== true)
            .filter((entry) => !Number.isSafeInteger(entry.activatesAt) || entry.activatesAt <= nowSeconds)
            .filter((entry) => !Number.isSafeInteger(entry.expiresAt) || entry.expiresAt >= nowSeconds)
            .map((entry) => entry.pin.toLowerCase());
        if (!candidates.includes(pin)) return false;
        if (signed.keyId !== pin || signed.payload.signingKeyId !== pin) return false;
        if (expectedRootId && signed.payload.networkRootId !== expectedRootId) return false;
        if (Number.isSafeInteger(expectedRootVersion) && signed.payload.networkRootVersion !== expectedRootVersion) return false;
        if (Number.isSafeInteger(expectedRollbackVersion)
            && signed.payload.networkRootRollbackVersion !== expectedRollbackVersion) return false;
        const validity = signed.payload.signingKeyValidity;
        if (!validity || !Number.isSafeInteger(validity.activatesAt) || !Number.isSafeInteger(validity.expiresAt)) return false;
        if (validity.activatesAt > nowSeconds || validity.expiresAt < nowSeconds) return false;
        if (!Number.isSafeInteger(signed.payload.issuedAt) || !Number.isSafeInteger(signed.payload.expiresAt)) return false;
        if (signed.payload.issuedAt > nowSeconds || signed.payload.expiresAt < nowSeconds) return false;
        const key = await crypto.subtle.importKey(
            'raw', rawKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'],
        );
        return crypto.subtle.verify(
            { name: 'ECDSA', hash: 'SHA-256' }, key,
            hpkeHexToBytes(signed.signatureHex, 64), ENCODER.encode(canonicalJson(signed.payload)),
        );
    } catch (_) {
        return false;
    }
}

export async function verifySignedV3Manifest(
    signed,
    expectedPins,
    nowSeconds = Math.floor(Date.now() / 1000),
    expectedRootId = null,
    expectedRootVersion = null,
    expectedRollbackVersion = null,
) {
    if (!await verifySignedManifest(
        signed, expectedPins, nowSeconds, expectedRootId, expectedRootVersion,
        expectedRollbackVersion, 'particle-node-manifest/3',
    )) return false;
    const payload = signed.payload;
    const protocols = payload.protocols;
    const capabilities = payload.capabilities;
    const endpoints = payload.endpoints;
    const limits = payload.limits;
    return (
        Array.isArray(protocols)
        && protocols.includes('particle-session/3')
        && protocols.includes('particle-rendezvous/3')
        && capabilities?.opaqueRendezvous === true
        && capabilities?.stateless === true
        && capabilities?.persistentRealmState === false
        && capabilities?.downgradePolicy === 'fail-closed-after-v3-advertisement'
        && typeof endpoints?.websocketV3 === 'string'
        && typeof endpoints?.admissionV3 === 'string'
        && Number.isSafeInteger(limits?.maxFrameBytes)
        && limits.maxFrameBytes >= 1024
        && Number.isSafeInteger(limits?.maxRoutesPerSession)
        && limits.maxRoutesPerSession >= 1
        && Number.isSafeInteger(limits?.outboundQueueBytes)
        && limits.outboundQueueBytes >= limits.maxFrameBytes
    );
}
