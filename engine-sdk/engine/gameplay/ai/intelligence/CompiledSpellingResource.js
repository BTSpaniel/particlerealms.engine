// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { contentHashHex } from '../../../core/math/ChecksumMath.js';
import { cloneStrictJson, deepFreezeJson } from '../../../core/schema/StrictJsonValue.js';

export const COMPILED_SPELLING_PROFILE = Object.freeze({ bytes: 796740, states: 82500, edges: 205470,
    rootExact: 82499, rootFolded: 82499, wordCount: 228133, maxWordBytes: 45 });
export const COMPILED_SPELLING_MANIFEST_URL = new URL('./resources/spelling/manifest.json', import.meta.url).href;
export const COMPILED_SPELLING_MANIFEST_SHA256 = '38f6878ad2757e21044c5f776721513756132d9d8d40217f383376b98a611559';
const MANIFEST_BYTES = 3022;
const MAGIC = [80, 82, 76, 88, 1, 0, 0, 0];
const error = (code, message) => Object.assign(new Error(message), { code });

/** Match the recovered compiler's NFC + ASCII folding, without altering source text. */
export function normalizeCompiledSpellingWord(text) {
    if (typeof text !== 'string' || text.length > 1024) throw error('SPELLING_WORD_INVALID', 'Spelling lookup requires at most 512 Unicode code points');
    let count = 0;
    for (const character of text) {
        const point = character.codePointAt(0);
        if (++count > 512 || (point >= 0xd800 && point <= 0xdfff)
            || (point < 32 && ![9, 10, 13].includes(point))) throw error('SPELLING_WORD_INVALID', 'Spelling lookup contains invalid Unicode or exceeds its bound');
    }
    return text.normalize('NFC').replace(/[A-Z]/g, letter => String.fromCharCode(letter.charCodeAt(0) + 32));
}

/**
 * Bounded PRLX v1 decoder, ported from the preserved module-63 Python oracle.
 * Validating a graph proves structure and membership counts, never provenance or
 * meaning. The production resource below additionally pins both byte hashes.
 * Only binary bytes and state offsets are retained, not an expanded word list.
 */
export function decodeCompiledSpellingGraph(input, profile = COMPILED_SPELLING_PROFILE) {
    if (!(input instanceof Uint8Array) || !profile || !Number.isSafeInteger(profile.bytes)
        || profile.bytes < 24 || profile.bytes > 1048576 || input.byteLength !== profile.bytes) throw error('SPELLING_GRAPH_INVALID', 'Compiled graph has an invalid byte length');
    const bytes = input.slice();
    if (!MAGIC.every((value, index) => bytes[index] === value)) throw error('SPELLING_GRAPH_INVALID', 'Unsupported compiled spelling header');
    const view = new DataView(bytes.buffer);
    const states = view.getUint32(8, true), rootExact = view.getUint32(12, true), rootFolded = view.getUint32(16, true), edges = view.getUint32(20, true);
    if (states < 1 || states > 100000 || states !== profile.states || edges > 300000 || edges !== profile.edges
        || rootExact >= states || rootFolded >= states || rootExact !== profile.rootExact || rootFolded !== profile.rootFolded
        || !Number.isSafeInteger(profile.wordCount) || profile.wordCount < 1 || profile.wordCount > 1000000
        || !Number.isSafeInteger(profile.maxWordBytes) || profile.maxWordBytes < 1 || profile.maxWordBytes > 2048) {
        throw error('SPELLING_GRAPH_INVALID', 'Compiled spelling counts or roots differ from their profile');
    }
    const maxWordBytes = profile.maxWordBytes;
    const offsets = new Uint32Array(states), counts = new Uint32Array(states), depths = new Uint16Array(states);
    let cursor = 24, totalEdges = 0;
    const byte = () => {
        if (cursor >= bytes.length) throw error('SPELLING_GRAPH_INVALID', 'Truncated compiled graph');
        return bytes[cursor++];
    };
    const variable = () => {
        let value = 0;
        for (let position = 0; position < 5; position += 1) {
            const current = byte();
            value += (current & 127) * 2 ** (position * 7);
            if (!(current & 128)) {
                if (value > 0xffffffff || (position > 0 && current === 0)) break;
                return value;
            }
        }
        throw error('SPELLING_GRAPH_INVALID', 'Noncanonical or overflowing graph varint');
    };
    for (let state = 0; state < states; state += 1) {
        offsets[state] = cursor;
        const mask = byte(), degree = variable();
        if (mask > 3 || degree > 256) throw error('SPELLING_GRAPH_INVALID', 'Invalid graph terminal mask or degree');
        let count = mask > 0 ? 1 : 0, depth = 0, last = -1;
        for (let index = 0; index < degree; index += 1) {
            const label = byte(), destination = state - variable();
            if (label <= last || destination < 0 || destination >= state) throw error('SPELLING_GRAPH_INVALID', 'Graph transitions must be sorted and point backward');
            last = label; count += counts[destination]; depth = Math.max(depth, depths[destination] + 1);
            if (count > 1000000 || depth > maxWordBytes) throw error('SPELLING_GRAPH_INVALID', 'Graph language exceeds its bounded profile');
        }
        counts[state] = count; depths[state] = depth; totalEdges += degree;
    }
    if (cursor !== bytes.length || totalEdges !== edges || counts[rootExact] !== profile.wordCount
        || counts[rootFolded] !== profile.wordCount || depths[rootFolded] !== maxWordBytes) {
        throw error('SPELLING_GRAPH_INVALID', 'Graph length, edge total or accepted language count differs from its profile');
    }
    return Object.freeze({ states, edges, count: profile.wordCount,
        hasWord(text) {
            const word = new TextEncoder().encode(normalizeCompiledSpellingWord(text));
            if (word.length > maxWordBytes) return false;
            let state = rootFolded;
            for (const label of word) {
                cursor = offsets[state] + 1;
                const degree = variable(); let next = -1;
                for (let index = 0; index < degree; index += 1) {
                    const candidate = byte(), destination = state - variable();
                    if (candidate === label) { next = destination; break; }
                    if (candidate > label) break;
                }
                if (next < 0) return false;
                state = next;
            }
            return bytes[offsets[state]] > 0;
        },
    });
}

async function exactStream(stream, size, check) {
    if (!stream || typeof stream.getReader !== 'function') throw error('SPELLING_STREAM_UNAVAILABLE', 'Resource requires a bounded readable byte stream');
    const reader = stream.getReader(), bytes = new Uint8Array(size);
    let offset = 0, completed = false;
    try {
        while (true) {
            check(); const next = await reader.read(); check();
            if (next.done) break;
            if (!(next.value instanceof Uint8Array) || offset + next.value.byteLength > size) throw error('SPELLING_RESOURCE_SIZE', 'Resource exceeds its exact byte bound');
            bytes.set(next.value, offset); offset += next.value.byteLength;
        }
        if (offset !== size) throw error('SPELLING_RESOURCE_SIZE', 'Resource is truncated');
        completed = true;
        return bytes;
    } finally {
        if (!completed) await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

/**
 * Optional lazy local spelling pack. Construction/import performs no fetch.
 * First lookup verifies the pinned manifest, compressed and decoded SHA-256,
 * exact graph header/counts and bounded DAG before publishing any membership.
 * A lookup never resolves a concept, corrects OCR, chooses a pronunciation or
 * authorizes a task. Resource close aborts loading and drops retained graph data.
 */
export function createCompiledSpellingResource({ fetcher = globalThis.fetch, assertCurrent = () => true } = {}) {
    if (typeof fetcher !== 'function' || typeof assertCurrent !== 'function') throw new TypeError('Spelling resource requires fetch and a scope assertion');
    const lifetime = new AbortController();
    let graph = null, reference = null, loading = null, closed = false;
    const check = (options = {}) => {
        if (closed) throw error('SPELLING_RESOURCE_CLOSED', 'Spelling resource is closed');
        lifetime.signal.throwIfAborted(); options.signal?.throwIfAborted();
        for (const assertion of [assertCurrent, options.assertCurrent].filter(Boolean)) {
            if (typeof assertion !== 'function') throw new TypeError('Spelling scope assertion must be synchronous');
            const value = assertion();
            if (value?.then) { void Promise.resolve(value).catch(() => {}); throw error('SPELLING_RESOURCE_SCOPE', 'Spelling scope assertion must be synchronous'); }
            if (value === false) throw error('SPELLING_RESOURCE_SCOPE', 'Spelling resource scope was revoked');
        }
    };
    const fetchBytes = async (url, size) => {
        check();
        const response = await fetcher(url, { signal: lifetime.signal, credentials: 'same-origin' }); check();
        if (!response?.ok) throw error('SPELLING_RESOURCE_HTTP', 'Optional spelling resource is unavailable');
        const declared = response.headers?.get('content-length');
        if (declared !== null && declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) !== size)) throw error('SPELLING_RESOURCE_SIZE', 'Spelling response length differs from its pinned size');
        return exactStream(response.body, size, check);
    };
    const verify = async (bytes, digest) => {
        const actual = await contentHashHex(bytes, 'SHA-256'); check();
        if (actual !== digest) throw error('SPELLING_RESOURCE_HASH', 'Spelling resource SHA-256 differs from its pinned bytes');
    };
    const ensure = async () => {
        check();
        if (graph) return;
        if (!loading) loading = (async () => {
            const manifestBytes = await fetchBytes(COMPILED_SPELLING_MANIFEST_URL, MANIFEST_BYTES);
            await verify(manifestBytes, COMPILED_SPELLING_MANIFEST_SHA256);
            const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
            if (manifest.format !== 'particle-compiled-spelling-resource-v1' || manifest.meaning !== 'spelling-membership-only'
                || manifest.definitions !== 0 || manifest.resource.compression !== 'gzip') throw error('SPELLING_MANIFEST_INVALID', 'Unsupported spelling resource manifest');
            const compressed = await fetchBytes(new URL(manifest.resource.path, COMPILED_SPELLING_MANIFEST_URL).href, manifest.resource.compressedBytes);
            await verify(compressed, manifest.resource.compressedSha256);
            if (typeof DecompressionStream !== 'function') throw error('SPELLING_DECOMPRESSION_UNAVAILABLE', 'This browser lacks gzip decompression');
            const binary = await exactStream(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')), manifest.resource.bytes, check);
            await verify(binary, manifest.resource.sha256);
            const decoded = decodeCompiledSpellingGraph(binary);
            check();
            reference = deepFreezeJson({ providerId: manifest.providerId, version: manifest.version,
                contentHash: `sha256:${manifest.resource.sha256}`, count: decoded.count,
                provenance: cloneStrictJson({ normalization: manifest.normalization, representation: 'compiled-dafsa',
                    manifestSha256: COMPILED_SPELLING_MANIFEST_SHA256, ...manifest.provenance, licenses: manifest.licenses }) });
            graph = decoded;
        })().finally(() => { loading = null; });
        await loading;
        check();
    };
    return Object.freeze({
        async lookupWord(text, options = {}) {
            check(options);
            const word = normalizeCompiledSpellingWord(text);
            await ensure(); check(options);
            return deepFreezeJson({ word, available: true, found: graph.hasWord(word), reference,
                meaning: 'spelling-membership-only', executable: false });
        },
        close() { if (!closed) { closed = true; lifetime.abort(); graph = null; reference = null; } },
    });
}
