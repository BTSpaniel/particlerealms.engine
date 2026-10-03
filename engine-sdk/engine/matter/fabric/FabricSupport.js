// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Shared fail-closed helpers for the versioned Realm Matter Fabric. */

import {
    cloneStrictJson,
    deepFreezeJson,
    isPlainJsonObject,
} from '../../core/schema/StrictJsonValue.js';

export const FABRIC_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$/;
export const FABRIC_SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const FABRIC_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

export function compareOrdinal(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}

export function fail(path, message) {
    throw new TypeError(`${path}: ${message}`);
}

export function requireRecord(value, path) {
    if (!isPlainJsonObject(value)) fail(path, 'must be a plain JSON object');
    return value;
}

export function requireExactKeys(value, allowed, required, path) {
    requireRecord(value, path);
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) fail(`${path}.${key}`, 'unknown field');
    }
    for (const key of required) {
        if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, 'is required');
    }
    return value;
}

export function requireString(value, path, { maximum = 512, allowEmpty = false } = {}) {
    if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || value.length > maximum
        || /[\u0000-\u001f\u007f]/.test(value)) {
        fail(path, `must be a ${allowEmpty ? '' : 'non-empty '}bounded control-free string`);
    }
    return value;
}

export function requireIdentifier(value, path) {
    requireString(value, path, { maximum: 192 });
    if (!FABRIC_IDENTIFIER_PATTERN.test(value)) fail(path, 'has invalid identifier syntax');
    return value;
}

export function requireSemver(value, path) {
    requireString(value, path, { maximum: 64 });
    if (!FABRIC_SEMVER_PATTERN.test(value)) fail(path, 'must be semantic version major.minor.patch');
    return value;
}

export function requireHash(value, path) {
    requireString(value, path, { maximum: 71 });
    if (!FABRIC_HASH_PATTERN.test(value)) fail(path, 'must be a lowercase SHA-256 identifier');
    return value;
}

export function requireFinite(value, path, { minimum = -Number.MAX_VALUE, maximum = Number.MAX_VALUE } = {}) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
        fail(path, `must be finite in [${minimum}, ${maximum}]`);
    }
    return value;
}

export function requireInteger(value, path, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        fail(path, `must be a safe integer in [${minimum}, ${maximum}]`);
    }
    return value;
}

export function requireBoolean(value, path) {
    if (typeof value !== 'boolean') fail(path, 'must be boolean');
    return value;
}

export function requireEnum(value, values, path) {
    requireString(value, path);
    if (!values.has(value)) fail(path, `must be one of ${[...values].join(', ')}`);
    return value;
}

export function requireIdentifierArray(value, path, { allowEmpty = true } = {}) {
    if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
        fail(path, allowEmpty ? 'must be an array' : 'must be a non-empty array');
    }
    const seen = new Set();
    value.forEach((entry, index) => {
        const id = requireIdentifier(entry, `${path}[${index}]`);
        if (seen.has(id)) fail(`${path}[${index}]`, 'duplicates an earlier identifier');
        seen.add(id);
    });
    return value;
}

export function requireNumberRecord(value, path, { minimum = -Number.MAX_VALUE } = {}) {
    requireRecord(value, path);
    for (const [key, entry] of Object.entries(value)) {
        requireIdentifier(key, `${path} key`);
        requireFinite(entry, `${path}.${key}`, { minimum });
    }
    return value;
}

export function cloneStamped(input, { schema, schemaVersion, path, defaults = {} }) {
    const source = cloneStrictJson(input, path);
    requireRecord(source, path);
    if (source.schema != null && source.schema !== schema) fail(`${path}.schema`, 'is unsupported');
    if (source.schemaVersion != null && source.schemaVersion !== schemaVersion) {
        fail(`${path}.schemaVersion`, 'is unsupported');
    }
    return { ...cloneStrictJson(defaults, `${path}.defaults`), ...source, schema, schemaVersion };
}

export function freeze(value, path = '$') {
    return deepFreezeJson(value, path);
}

function canonicalValue(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`;
    if (value !== null && typeof value === 'object') {
        const keys = Object.keys(value).sort();
        return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalValue(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

export function canonicalStringify(value, path = '$') {
    return canonicalValue(cloneStrictJson(value, path));
}

const SHA256_INITIAL = Object.freeze([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);
const SHA256_K = Object.freeze([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value, count) {
    return (value >>> count) | (value << (32 - count));
}

/** Synchronous SHA-256 for deterministic snapshots without a WebCrypto scheduling dependency. */
export function sha256Hex(text) {
    requireString(text, '$.sha256Input', { maximum: 16 * 1024 * 1024, allowEmpty: true });
    const bytes = new TextEncoder().encode(text);
    const bitLength = BigInt(bytes.length) * 8n;
    const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLength);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    for (let index = 0; index < 8; index += 1) {
        padded[paddedLength - 1 - index] = Number((bitLength >> BigInt(index * 8)) & 0xffn);
    }
    const hash = SHA256_INITIAL.slice();
    const words = new Uint32Array(64);
    for (let offset = 0; offset < padded.length; offset += 64) {
        for (let index = 0; index < 16; index += 1) {
            const base = offset + index * 4;
            words[index] = ((padded[base] << 24) | (padded[base + 1] << 16)
                | (padded[base + 2] << 8) | padded[base + 3]) >>> 0;
        }
        for (let index = 16; index < 64; index += 1) {
            const a = words[index - 15];
            const b = words[index - 2];
            const s0 = rotateRight(a, 7) ^ rotateRight(a, 18) ^ (a >>> 3);
            const s1 = rotateRight(b, 17) ^ rotateRight(b, 19) ^ (b >>> 10);
            words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
        }
        let [a, b, c, d, e, f, g, h] = hash;
        for (let index = 0; index < 64; index += 1) {
            const sigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
            const choose = (e & f) ^ (~e & g);
            const temp1 = (h + sigma1 + choose + SHA256_K[index] + words[index]) >>> 0;
            const sigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
            const majority = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (sigma0 + majority) >>> 0;
            h = g;
            g = f;
            f = e;
            e = (d + temp1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temp1 + temp2) >>> 0;
        }
        hash[0] = (hash[0] + a) >>> 0;
        hash[1] = (hash[1] + b) >>> 0;
        hash[2] = (hash[2] + c) >>> 0;
        hash[3] = (hash[3] + d) >>> 0;
        hash[4] = (hash[4] + e) >>> 0;
        hash[5] = (hash[5] + f) >>> 0;
        hash[6] = (hash[6] + g) >>> 0;
        hash[7] = (hash[7] + h) >>> 0;
    }
    return hash.map(value => value.toString(16).padStart(8, '0')).join('');
}

export function contentHash(value, path = '$') {
    return `sha256:${sha256Hex(canonicalStringify(value, path))}`;
}

export function monotonicNow() {
    return globalThis.performance?.now?.() ?? Date.now();
}

/** Bounded operational telemetry; domain records never depend on these timestamps. */
export class FabricDiagnostics {
    #module;
    #logger;
    #counts = { entries: 0, exits: 0, errors: 0, stateChanges: 0 };
    #operations = 0;
    #elapsedMs = 0;
    #recent = [];

    constructor(module, logger = null) {
        this.#module = requireIdentifier(module, '$.diagnostics.module');
        this.#logger = logger;
    }

    begin(operation, detail = {}) {
        const token = { operation: requireIdentifier(operation, '$.diagnostics.operation'), start: monotonicNow() };
        this.#counts.entries += 1;
        this.#emit('entry', operation, detail);
        return token;
    }

    end(token, detail = {}, { stateChanged = false } = {}) {
        const elapsedMs = Math.max(0, monotonicNow() - token.start);
        this.#counts.exits += 1;
        if (stateChanged) this.#counts.stateChanges += 1;
        this.#operations += 1;
        this.#elapsedMs += elapsedMs;
        this.#emit(stateChanged ? 'state' : 'exit', token.operation, { ...detail, elapsedMs });
    }

    error(token, error, detail = {}) {
        this.#counts.errors += 1;
        this.#emit('error', token.operation, { ...detail, message: String(error?.message ?? error) });
    }

    snapshot() {
        return freeze({
            module: this.#module,
            counts: { ...this.#counts },
            operations: this.#operations,
            elapsedMs: this.#elapsedMs,
            recentEvents: this.#recent.map(event => ({ ...event })),
        }, '$.fabricDiagnostics');
    }

    #emit(kind, operation, detail) {
        const event = cloneStrictJson({ kind, operation, detail }, '$.diagnosticEvent');
        this.#recent.push(event);
        if (this.#recent.length > 64) this.#recent.shift();
        const method = kind === 'error' ? 'error' : 'debug';
        if (typeof this.#logger?.[method] === 'function') {
            // Diagnostics are deliberately observational. A broken host logger
            // must never turn a committed Fabric operation into a reported
            // failure or prevent a validation error from reaching its caller.
            try {
                this.#logger[method](`[${this.#module}] ${operation} ${kind}`, event.detail);
            } catch {
                // The bounded in-memory event remains available through snapshot().
            }
        }
    }
}
