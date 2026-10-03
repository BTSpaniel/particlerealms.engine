// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const STATE_CHANNEL_VERSION = 1;
export const STATE_CHANNEL_LATEST_VERSION = 2;
export const STATE_CHANNEL_SUPPORTED_VERSIONS = Object.freeze([2, 1]);
export const STATE_CHANNEL_MESSAGE_FORMAT = 'particle-state-channel-message/2';
export const DEFAULT_STATE_CHANNEL_TRANSPORT = 'sse';
export const STATE_CHANNEL_TRANSPORT = Object.freeze({
    SSE: 'sse',
    IN_PROCESS: 'in-process',
    BROADCAST_CHANNEL: 'broadcast-channel',
    MESH: 'mesh',
    PARTICLE_SIGNAL: 'particle-signal',
});
export const STATE_CHANNEL_MESSAGE = Object.freeze({
    INTENT: 'intent',
    PROJECTION: 'projection',
    RECEIPT: 'receipt',
    HEARTBEAT: 'heartbeat',
});
export const STATE_CHANNEL_PROJECTION = Object.freeze({
    SNAPSHOT: 'snapshot',
    MERGE_PATCH: 'merge-patch',
    EVENT: 'event',
});

const CHANNEL_RE = /^[a-z0-9][a-z0-9._/-]{0,127}$/i;
const ACTION_RE = /^[a-z][a-z0-9._-]{0,95}$/i;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 100_000;
let fallbackId = 0;

export function defineStateChannelContract(input = {}) {
    const id = validText(input.id, CHANNEL_RE, 'channel id');
    const intents = input.intents && typeof input.intents === 'object' ? { ...input.intents } : {};
    for (const [action, descriptor] of Object.entries(intents)) {
        validText(action, ACTION_RE, 'intent action');
        if (typeof descriptor !== 'function' && (!descriptor || typeof descriptor !== 'object')) {
            throw new TypeError(`State channel intent ${action} requires a reducer or descriptor`);
        }
    }
    const defaultTransport = input.defaultTransport ?? DEFAULT_STATE_CHANNEL_TRANSPORT;
    if (!Object.values(STATE_CHANNEL_TRANSPORT).includes(defaultTransport)) {
        throw new TypeError(`Unknown state channel transport: ${defaultTransport}`);
    }
    const allowedTransports = [...new Set(input.allowedTransports ?? Object.values(STATE_CHANNEL_TRANSPORT))];
    if (!allowedTransports.includes(defaultTransport)) allowedTransports.unshift(defaultTransport);
    const cadenceHz = Number(input.cadenceHz ?? 20);
    if (!Number.isFinite(cadenceHz) || cadenceHz <= 0 || cadenceHz > 240) {
        throw new RangeError('State channel cadenceHz must be in (0, 240]');
    }
    return Object.freeze({
        version: STATE_CHANNEL_VERSION,
        wireVersion: resolveStateChannelVersion(input.wireVersion ?? STATE_CHANNEL_VERSION),
        supportedVersions: Object.freeze([...STATE_CHANNEL_SUPPORTED_VERSIONS]),
        id,
        authority: String(input.authority ?? 'host'),
        initialState: jsonClone(input.initialState ?? {}),
        intents: Object.freeze(intents),
        reduce: typeof input.reduce === 'function' ? input.reduce : null,
        project: typeof input.project === 'function' ? input.project : null,
        authorize: typeof input.authorize === 'function' ? input.authorize : null,
        consistency: input.consistency ?? 'authoritative',
        cadenceHz,
        interest: input.interest ?? 'subscribers',
        defaultTransport,
        allowedTransports: Object.freeze(allowedTransports),
    });
}

export function createStateIntent(channelId, action, payload, options = {}) {
    const version = resolveStateChannelVersion(options.version ?? STATE_CHANNEL_VERSION);
    return Object.freeze(withMessageFormat({
        version,
        kind: STATE_CHANNEL_MESSAGE.INTENT,
        channelId: validText(channelId, CHANNEL_RE, 'channel id'),
        id: validIdentifier(options.id ?? uniqueId('intent'), 'intent id'),
        clientId: validIdentifier(options.clientId ?? 'anonymous', 'intent client id'),
        action: validText(action, ACTION_RE, 'intent action'),
        payload: jsonClone(payload ?? null),
        expectedRevision: optionalInteger(options.expectedRevision),
        authorityEpoch: optionalInteger(options.authorityEpoch),
        createdAt: validTimestamp(options.createdAt),
    }, version));
}

export function createStateProjection(channelId, projection, options = {}) {
    const projectionKind = options.projectionKind ?? STATE_CHANNEL_PROJECTION.SNAPSHOT;
    if (!Object.values(STATE_CHANNEL_PROJECTION).includes(projectionKind)) {
        throw new TypeError(`Unknown projection kind: ${projectionKind}`);
    }
    const version = resolveStateChannelVersion(options.version ?? STATE_CHANNEL_VERSION);
    return Object.freeze(withMessageFormat({
        version,
        kind: STATE_CHANNEL_MESSAGE.PROJECTION,
        channelId: validText(channelId, CHANNEL_RE, 'channel id'),
        id: validIdentifier(options.id ?? uniqueId('projection'), 'projection id'),
        projectionKind,
        data: jsonClone(projection),
        revision: requiredInteger(options.revision, 'projection revision', 0),
        sequence: requiredInteger(options.sequence, 'projection sequence', 0),
        authorityId: validIdentifier(options.authorityId ?? 'unknown', 'projection authority id'),
        authorityEpoch: requiredInteger(options.authorityEpoch ?? 0, 'authority epoch', 0),
        causedBy: options.causedBy == null ? null : validIdentifier(options.causedBy, 'projection cause id'),
        createdAt: validTimestamp(options.createdAt),
    }, version));
}

export function createStateReceipt(intent, options = {}) {
    const status = options.status ?? 'accepted';
    if (!['accepted', 'rejected', 'duplicate'].includes(status)) throw new TypeError(`Invalid receipt status: ${status}`);
    const version = resolveStateChannelVersion(options.version ?? STATE_CHANNEL_VERSION);
    return Object.freeze(withMessageFormat({
        version,
        kind: STATE_CHANNEL_MESSAGE.RECEIPT,
        channelId: validText(intent.channelId, CHANNEL_RE, 'channel id'),
        id: validIdentifier(options.id ?? uniqueId('receipt'), 'receipt id'),
        intentId: validIdentifier(intent.id, 'receipt intent id'),
        clientId: validIdentifier(intent.clientId ?? 'anonymous', 'receipt client id'),
        status,
        reason: options.reason == null ? null : validBoundedText(options.reason, 'receipt reason', 1024),
        revision: requiredInteger(options.revision ?? 0, 'receipt revision', 0),
        sequence: requiredInteger(options.sequence ?? 0, 'receipt sequence', 0),
        authorityEpoch: requiredInteger(options.authorityEpoch ?? 0, 'authority epoch', 0),
        createdAt: validTimestamp(options.createdAt),
    }, version));
}

export function validateStateChannelMessage(message, channelId = null) {
    try { readStateChannelMessage(message, channelId); return true; }
    catch { return false; }
}

export function readStateChannelMessage(message, channelId = null) {
    if (!isRecord(message)) throw new TypeError('State channel message must be an object');
    const version = resolveStateChannelVersion(message.version);
    if (version === 2 && message.format !== STATE_CHANNEL_MESSAGE_FORMAT) {
        throw new TypeError(`State channel v2 message requires format ${STATE_CHANNEL_MESSAGE_FORMAT}`);
    }
    if (!Object.values(STATE_CHANNEL_MESSAGE).includes(message.kind)) {
        throw new TypeError(`Unknown state channel message kind: ${message.kind}`);
    }
    if (typeof message.channelId !== 'string') throw new TypeError('State channel id must be a string');
    validText(message.channelId, CHANNEL_RE, 'channel id');
    if (channelId !== null && message.channelId !== channelId) {
        throw new TypeError(`State channel mismatch: expected ${channelId}, got ${message.channelId}`);
    }
    if (message.kind === STATE_CHANNEL_MESSAGE.INTENT) {
        if (typeof message.action !== 'string') throw new TypeError('State channel intent action must be a string');
        validText(message.action, ACTION_RE, 'intent action');
        validIdentifier(message.id, 'intent id');
        validIdentifier(message.clientId, 'intent client id');
        if (!Object.hasOwn(message, 'payload')
            || !Object.hasOwn(message, 'expectedRevision')
            || !Object.hasOwn(message, 'authorityEpoch')
            || !Object.hasOwn(message, 'createdAt')) {
            throw new TypeError('State channel intent is missing required fields');
        }
        optionalInteger(message.expectedRevision);
        optionalInteger(message.authorityEpoch);
        validTimestamp(message.createdAt);
    } else if (message.kind === STATE_CHANNEL_MESSAGE.PROJECTION) {
        validIdentifier(message.id, 'projection id');
        if (!Object.values(STATE_CHANNEL_PROJECTION).includes(message.projectionKind)) {
            throw new TypeError(`Unknown projection kind: ${message.projectionKind}`);
        }
        if (!Object.hasOwn(message, 'data')) throw new TypeError('State channel projection requires data');
        requiredInteger(message.revision, 'projection revision', 0);
        requiredInteger(message.sequence, 'projection sequence', 0);
        validIdentifier(message.authorityId, 'projection authority id');
        requiredInteger(message.authorityEpoch, 'projection authority epoch', 0);
        if (!Object.hasOwn(message, 'causedBy') || !Object.hasOwn(message, 'createdAt')) {
            throw new TypeError('State channel projection is missing required fields');
        }
        if (message.causedBy !== null) validIdentifier(message.causedBy, 'projection cause id');
        validTimestamp(message.createdAt);
    } else if (message.kind === STATE_CHANNEL_MESSAGE.RECEIPT) {
        validIdentifier(message.id, 'receipt id');
        validIdentifier(message.intentId, 'receipt intent id');
        validIdentifier(message.clientId, 'receipt client id');
        if (!['accepted', 'rejected', 'duplicate'].includes(message.status)) {
            throw new TypeError(`Invalid receipt status: ${message.status}`);
        }
        if (!Object.hasOwn(message, 'reason') || !Object.hasOwn(message, 'createdAt')) {
            throw new TypeError('State channel receipt is missing required fields');
        }
        if (message.reason !== null) validBoundedText(message.reason, 'receipt reason', 1024);
        requiredInteger(message.revision, 'receipt revision', 0);
        requiredInteger(message.sequence, 'receipt sequence', 0);
        requiredInteger(message.authorityEpoch, 'receipt authority epoch', 0);
        validTimestamp(message.createdAt);
    }
    return Object.freeze(jsonClone(message));
}

export function negotiateStateChannelVersion(peerVersions, localVersions = STATE_CHANNEL_SUPPORTED_VERSIONS) {
    const peer = normalizeVersionList(peerVersions, 'peer versions');
    const local = normalizeVersionList(localVersions, 'local versions');
    const selected = local.find(version => peer.includes(version));
    if (!selected) throw new Error(`No compatible state channel message version: peer=${peer.join(',')} local=${local.join(',')}`);
    return selected;
}

export function applyStateProjection(currentState, message) {
    let projection;
    try { projection = readStateChannelMessage(message); }
    catch { throw new TypeError('Invalid state channel projection'); }
    if (projection.kind !== STATE_CHANNEL_MESSAGE.PROJECTION) {
        throw new TypeError('Invalid state channel projection');
    }
    if (projection.projectionKind === STATE_CHANNEL_PROJECTION.EVENT) return jsonClone(currentState);
    if (projection.projectionKind === STATE_CHANNEL_PROJECTION.MERGE_PATCH) {
        return applyMergePatch(currentState, projection.data);
    }
    return jsonClone(projection.data);
}

export function createMergePatch(previous, next) {
    if (Object.is(previous, next)) return {};
    if (!isRecord(previous) || !isRecord(next)) return jsonClone(next);
    const patch = {};
    for (const key of Object.keys(previous)) {
        assertSafeKey(key);
        if (!Object.hasOwn(next, key)) patch[key] = null;
    }
    for (const [key, value] of Object.entries(next)) {
        assertSafeKey(key);
        if (!Object.hasOwn(previous, key)) patch[key] = jsonClone(value);
        else if (!Object.is(previous[key], value)) patch[key] = createMergePatch(previous[key], value);
    }
    return patch;
}

export function applyMergePatch(target, patch) {
    if (!isRecord(patch)) return jsonClone(patch);
    const result = isRecord(target) ? jsonClone(target) : {};
    for (const [key, value] of Object.entries(patch)) {
        assertSafeKey(key);
        if (value === null) delete result[key];
        else result[key] = isRecord(value) ? applyMergePatch(result[key], value) : jsonClone(value);
    }
    return result;
}

export function jsonClone(value) {
    assertSafeJson(value);
    let encoded;
    try {
        encoded = JSON.stringify(value);
    } catch (error) {
        throw new TypeError(`State channel data must be JSON-serializable: ${error.message}`);
    }
    if (encoded === undefined) throw new TypeError('State channel data must be JSON-serializable');
    const parsed = JSON.parse(encoded);
    assertSafeJson(parsed);
    return parsed;
}

function withMessageFormat(message, version) {
    return version === 2 ? { format: STATE_CHANNEL_MESSAGE_FORMAT, ...message } : message;
}

function resolveStateChannelVersion(value) {
    if (!Number.isSafeInteger(value) || !STATE_CHANNEL_SUPPORTED_VERSIONS.includes(value)) {
        throw new TypeError(`Unsupported state channel message version: ${value}`);
    }
    return value;
}

function normalizeVersionList(value, label) {
    if (!value || typeof value[Symbol.iterator] !== 'function') throw new TypeError(`${label} must be iterable`);
    const versions = [...new Set([...value])];
    if (versions.some(version => !Number.isSafeInteger(version) || version < 1)) {
        throw new TypeError(`${label} must contain positive integer versions`);
    }
    versions.sort((a, b) => b - a);
    if (!versions.length) throw new TypeError(`${label} must not be empty`);
    return versions;
}

function validTimestamp(value) {
    const timestamp = Number(value ?? Date.now());
    if (!Number.isFinite(timestamp) || timestamp < 0) throw new TypeError('createdAt must be a finite non-negative number');
    return timestamp;
}

function validIdentifier(value, label) {
    const text = String(value ?? '');
    if (!text || text.length > 256) throw new TypeError(`Invalid state channel ${label}`);
    return text;
}

function validBoundedText(value, label, maximumLength) {
    if (typeof value !== 'string') throw new TypeError(`Invalid state channel ${label}`);
    const text = value;
    if (text.length > maximumLength) throw new TypeError(`Invalid state channel ${label}`);
    return text;
}

function assertSafeJson(root) {
    const stack = [{ value: root, depth: 0 }];
    const seen = new WeakSet();
    let nodes = 0;
    while (stack.length) {
        const { value, depth } = stack.pop();
        nodes++;
        if (nodes > MAX_JSON_NODES) throw new TypeError('State channel data exceeds the JSON node limit');
        if (depth > MAX_JSON_DEPTH) throw new TypeError('State channel data exceeds the JSON depth limit');
        if (value === null || typeof value === 'string' || typeof value === 'boolean') continue;
        if (typeof value === 'number') {
            if (!Number.isFinite(value)) throw new TypeError('State channel data contains a non-finite number');
            continue;
        }
        if (typeof value !== 'object') throw new TypeError(`State channel data contains unsupported ${typeof value}`);
        if (seen.has(value)) continue;
        seen.add(value);
        if (!Array.isArray(value)) {
            const prototype = Object.getPrototypeOf(value);
            if (prototype !== Object.prototype && prototype !== null) {
                throw new TypeError('State channel data must contain only plain objects and arrays');
            }
        }
        for (const [key, child] of Object.entries(value)) {
            assertSafeKey(key);
            stack.push({ value: child, depth: depth + 1 });
        }
    }
}

function uniqueId(prefix) {
    try {
        if (typeof globalThis.crypto?.randomUUID === 'function') return `${prefix}-${globalThis.crypto.randomUUID()}`;
    } catch {}
    fallbackId++;
    return `${prefix}-${Date.now().toString(36)}-${fallbackId.toString(36)}`;
}

function validText(value, expression, label) {
    const text = String(value ?? '');
    if (!expression.test(text)) throw new TypeError(`Invalid state channel ${label}: ${text}`);
    return text;
}

function optionalInteger(value) {
    if (value === undefined || value === null) return null;
    return requiredInteger(value, 'integer', 0);
}

function requiredInteger(value, label, minimum) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < minimum) throw new TypeError(`${label} must be an integer >= ${minimum}`);
    return number;
}

function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertSafeKey(key) {
    if (FORBIDDEN_KEYS.has(key)) throw new TypeError(`Unsafe state channel key: ${key}`);
}
