// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { canonicalJson, verifyRawSignature } from '../../network/crypto/Trust.js';

export const PARTY_PROTOCOL = 'particle-watchparty/1';
export const MAX_GUESTS = 5;
export const MAX_PACKET_BYTES = 8 * 1024 * 1024;
export const MAX_WIRE_BYTES = 40 * 1024;
export const MESSAGE_TTL_MS = 120_000;
const ENCODER = new TextEncoder();
const KEY = /^04[0-9a-f]{128}$/;
const ID = /^[0-9a-f]{32}$/;
const KINDS = new Set(['descriptor', 'join', 'grant', 'reject', 'ready', 'signal', 'state', 'members', 'leave', 'end', 'removed', 'key-request', 'ping', 'pong']);

export function validKey(value) { return typeof value === 'string' && KEY.test(value); }
export function validId(value) { return typeof value === 'string' && ID.test(value); }
export function safeInteger(value, maximum = Number.MAX_SAFE_INTEGER) { return Number.isSafeInteger(value) && value >= 0 && value <= maximum; }
export function boundedText(value, maximum, allowEmpty = false) {
    return typeof value === 'string' && (allowEmpty || value.length > 0) && ENCODER.encode(value).length <= maximum
        && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value);
}

export function normalizeHostState(input) {
    if (!input || typeof input !== 'object' || !safeInteger(input.sourceRevision)
        || !boundedText(input.itemId, 160, true) || !/^[A-Za-z0-9._:-]*$/.test(input.itemId)
        || /^(?:vfs|blob|file):/i.test(input.itemId)
        || !['restream', 'url', 'custom'].includes(input.mode)
        || typeof input.paused !== 'boolean' || !Number.isFinite(input.position) || input.position < 0 || input.position > 1e9
        || !Number.isFinite(input.rate) || input.rate < 0.25 || input.rate > 4
        || !Number.isFinite(input.clock) || input.clock < 0 || input.clock > Number.MAX_SAFE_INTEGER
        || !input.source || !['url', 'file', 'custom'].includes(input.source.kind)) {
        throw new TypeError('Invalid Watch Party playback state');
    }
    const source = { kind: input.source.kind };
    if (input.source.title !== undefined) {
        if (!boundedText(input.source.title, 256, true)) throw new TypeError('Invalid source title');
        source.title = input.source.title;
    }
    if (input.source.kind === 'url' && input.source.url !== undefined) {
        if (!boundedText(input.source.url, 2048)) throw new TypeError('Invalid shared URL');
        const url = new URL(input.source.url);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new TypeError('Shared URLs must use HTTP(S) without credentials');
        source.url = url.href;
    }
    if (input.mode === 'url' && (source.kind !== 'url' || !source.url)) throw new TypeError('URL mode requires a shared HTTP(S) source');
    // Whitelist only shareable fields. File handles, VFS paths and blob URLs stay local.
    return Object.freeze({
        sourceRevision: input.sourceRevision, itemId: input.itemId, source: Object.freeze(source), mode: input.mode,
        position: input.position, paused: input.paused, rate: input.rate, clock: input.clock,
    });
}

export function normalizePacketMeta(meta) {
    if (!meta || !['video', 'audio'].includes(meta.kind) || !safeInteger(meta.sourceRevision)
        || !safeInteger(meta.sequence, 0xffffffff) || !Number.isFinite(meta.timestamp) || meta.timestamp < 0 || meta.timestamp > 1e10
        || typeof meta.keyframe !== 'boolean') throw new TypeError('Invalid custom media metadata');
    return Object.freeze({ kind: meta.kind, sourceRevision: meta.sourceRevision, sequence: meta.sequence, timestamp: meta.timestamp, keyframe: meta.keyframe });
}

export function normalizeSignal(body) {
    if (!body || !['control', 'content'].includes(body.channel) || !validId(body.admissionId)
        || !safeInteger(body.offerId, 0xffffffff) || body.offerId < 1 || !['offer', 'answer', 'ice'].includes(body.type)) {
        throw new TypeError('Invalid Watch Party signaling');
    }
    const data = body.data;
    if (!data || typeof data !== 'object') throw new TypeError('Invalid RTC signaling data');
    if (body.type === 'ice') {
        if (!boundedText(data.candidate, 2048, true)
            || !(data.sdpMid === null || boundedText(data.sdpMid, 64, true))
            || !(data.sdpMLineIndex === null || safeInteger(data.sdpMLineIndex, 32))
            || !(data.usernameFragment === undefined || data.usernameFragment === null || boundedText(data.usernameFragment, 256, true))) {
            throw new TypeError('Invalid RTC ICE candidate');
        }
        return { ...body, data: { candidate: data.candidate, sdpMid: data.sdpMid, sdpMLineIndex: data.sdpMLineIndex, usernameFragment: data.usernameFragment ?? null } };
    }
    if (data.type !== body.type || !boundedText(data.sdp, 28 * 1024) || !data.sdp.startsWith('v=0')) throw new TypeError('Invalid RTC session description');
    return { ...body, data: { type: data.type, sdp: data.sdp } };
}

function validateTree(value, depth = 0, budget = { nodes: 0 }) {
    if (++budget.nodes > 1024 || depth > 8) return false;
    if (value === null || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'string') return ENCODER.encode(value).length <= 32 * 1024;
    if (!value || typeof value !== 'object') return false;
    if (Array.isArray(value)) return value.length <= 64 && value.every(child => validateTree(child, depth + 1, budget));
    const keys = Object.keys(value);
    return keys.length <= 32 && keys.every(key => key.length <= 64 && !['__proto__', 'constructor', 'prototype'].includes(key)
        && validateTree(value[key], depth + 1, budget));
}

export async function signPartyEnvelope(signer, { kind, partyId, toKey, seq, body, expiresAt = Date.now() + MESSAGE_TTL_MS }) {
    if (!signer?.secure || !validKey(signer.publicKeyHex) || typeof signer.signRaw !== 'function'
        || !KINDS.has(kind) || !validId(partyId) || !(validKey(toKey) || (kind === 'descriptor' && toKey === '*'))
        || !safeInteger(seq) || !validateTree(body)) throw new TypeError('Invalid party envelope fields');
    const unsigned = { protocol: PARTY_PROTOCOL, kind, partyId, fromKey: signer.publicKeyHex, toKey, seq, issuedAt: Date.now(), expiresAt, body };
    const bytes = ENCODER.encode(canonicalJson(unsigned));
    if (bytes.length > MAX_WIRE_BYTES) throw new RangeError('Party envelope is too large');
    const signatureHex = await signer.signRaw(bytes);
    if (typeof signatureHex !== 'string' || !/^[0-9a-f]{128}$/.test(signatureHex)) throw new Error('Party signing failed');
    return { ...unsigned, signatureHex };
}

export async function verifyPartyEnvelope(envelope, { partyId = null, fromKey = null, toKey = null, now = Date.now() } = {}) {
    try {
        if (!envelope || !validateTree(envelope)
            || Object.keys(envelope).sort().join(',') !== 'body,expiresAt,fromKey,issuedAt,kind,partyId,protocol,seq,signatureHex,toKey'
            || envelope.protocol !== PARTY_PROTOCOL || !KINDS.has(envelope.kind) || !validId(envelope.partyId)
            || !validKey(envelope.fromKey) || !(validKey(envelope.toKey) || (envelope.kind === 'descriptor' && envelope.toKey === '*'))
            || !safeInteger(envelope.seq) || !safeInteger(envelope.issuedAt) || !safeInteger(envelope.expiresAt)
            || envelope.issuedAt > now + 10_000 || envelope.expiresAt <= now || envelope.expiresAt < envelope.issuedAt
            || envelope.expiresAt - envelope.issuedAt > MESSAGE_TTL_MS
            || (partyId && envelope.partyId !== partyId) || (fromKey && envelope.fromKey !== fromKey)
            || (toKey && envelope.toKey !== toKey && !(envelope.kind === 'descriptor' && envelope.toKey === '*'))) return false;
        const { signatureHex, ...unsigned } = envelope;
        const bytes = ENCODER.encode(canonicalJson(unsigned));
        return bytes.length <= MAX_WIRE_BYTES && await verifyRawSignature(envelope.fromKey, bytes, signatureHex);
    } catch (_) { return false; }
}
