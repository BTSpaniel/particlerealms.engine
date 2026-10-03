// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { crc32 as checksumCrc32 } from '../../engine/core/math/ChecksumMath.js';

/**
 * Zip.js — minimal ZIP container (write + read, no external ZIP dependency).
 *
 * DEPRECATED for `.prpkg`: the package format now uses solid **gzip** (see
 * `Gzip.js`), matching `bundle_engine.py`'s `*.min.js.gz` + `DecompressionStream`
 * pattern instead of a custom ZIP container. Kept for any general-purpose ZIP needs.
 *
 * Writing uses the STORE method (no compression) so output is always a valid,
 * spec-compliant ZIP that any tool can open — and the implementation is simple
 * enough to be obviously correct without an external library. Reading supports
 * both STORE (method 0) and DEFLATE (method 8, via DecompressionStream) so we
 * can ingest zips produced by other tools.
 *
 * API:
 *   await Zip.create({ 'manifest.json': stringOrBytes, 'files/app.js': '…' })  → Uint8Array
 *   await Zip.parse(uint8array)  → Map<string, Uint8Array>
 *   Zip.textOf(bytes)            → decode Uint8Array → string (UTF-8)
 *
 * Little-endian throughout (ZIP spec).
 */

const SIG_LFH = 0x04034b50;  // local file header
const SIG_CDH = 0x02014b50;  // central directory header
const SIG_EOCD = 0x06054b50; // end of central directory
const FLAG_ENCRYPTED = 0x0001;
const FLAG_DEFLATE_OPTIONS = 0x0006;
const FLAG_DATA_DESCRIPTOR = 0x0008;
const FLAG_UTF8 = 0x0800;

function crc32(bytes) {
    return checksumCrc32(bytes);
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const fatalUtf8 = new TextDecoder('utf-8', { fatal: true });

function decodeEntryName(bytes, flags, location) {
    try { return (flags & FLAG_UTF8 ? fatalUtf8 : dec).decode(bytes); }
    catch (_) { throw new Error(`Invalid UTF-8 ZIP entry name in ${location}`); }
}

function assertSupportedFlags(flags, method, name) {
    if (flags & FLAG_ENCRYPTED) throw new Error(`Encrypted ZIP entry is unsupported: ${name}`);
    const supported = FLAG_DATA_DESCRIPTOR | FLAG_UTF8 | (method === 8 ? FLAG_DEFLATE_OPTIONS : 0);
    const unsupported = flags & (~supported & 0xffff);
    if (unsupported) throw new Error(`Unsupported ZIP flags 0x${unsupported.toString(16).padStart(4, '0')} for ${name}`);
}

function equalBytes(left, right) {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false;
    return true;
}

function toBytes(v) {
    if (v instanceof Uint8Array) return v;
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    return enc.encode(typeof v === 'string' ? v : JSON.stringify(v));
}

export class Zip {
    /**
     * Create a ZIP archive. Entries are DEFLATE-compressed (method 8) when that
     * shrinks them, else STORED (method 0) — the result is always a valid ZIP.
     * @param {Object.<string, string|Uint8Array>} files
     * @param {{ compress?: boolean }} [opts]  compress defaults to true
     * @returns {Promise<Uint8Array>}
     */
    static async create(files, opts = {}) {
        const compress = opts.compress !== false;
        const entries = [];
        const chunks  = [];
        let offset = 0;

        for (const [name, raw] of Object.entries(files)) {
            const nameBytes = enc.encode(name);
            const data      = toBytes(raw);
            const crc       = crc32(data);
            const usize     = data.length;   // uncompressed size

            // DEFLATE only when it actually helps; CRC is always over the
            // UNCOMPRESSED bytes (ZIP spec), so integrity checks are codec-agnostic.
            let method  = 0;
            let payload = data;
            if (compress && usize > 0) {
                const deflated = await deflateRaw(data);
                if (deflated && deflated.length < usize) { method = 8; payload = deflated; }
            }
            const csize = payload.length;    // compressed (stored) size

            // Local file header (30 bytes + name)
            const lfh = new Uint8Array(30 + nameBytes.length);
            const dv  = new DataView(lfh.buffer);
            dv.setUint32(0, SIG_LFH, true);
            dv.setUint16(4, 20, true);     // version needed
            dv.setUint16(6, 0, true);      // flags
            dv.setUint16(8, method, true); // method 0 (STORE) or 8 (DEFLATE)
            dv.setUint16(10, 0, true);     // mod time
            dv.setUint16(12, 0x21, true);  // mod date (1980-01-01)
            dv.setUint32(14, crc, true);
            dv.setUint32(18, csize, true); // compressed size
            dv.setUint32(22, usize, true); // uncompressed size
            dv.setUint16(26, nameBytes.length, true);
            dv.setUint16(28, 0, true);     // extra len
            lfh.set(nameBytes, 30);

            chunks.push(lfh, payload);
            entries.push({ nameBytes, crc, csize, usize, method, offset });
            offset += lfh.length + payload.length;
        }

        // Central directory
        const cdStart = offset;
        for (const e of entries) {
            const cdh = new Uint8Array(46 + e.nameBytes.length);
            const dv  = new DataView(cdh.buffer);
            dv.setUint32(0, SIG_CDH, true);
            dv.setUint16(4, 20, true);     // version made by
            dv.setUint16(6, 20, true);     // version needed
            dv.setUint16(8, 0, true);      // flags
            dv.setUint16(10, e.method, true); // method 0 or 8
            dv.setUint16(12, 0, true);     // mod time
            dv.setUint16(14, 0x21, true);  // mod date
            dv.setUint32(16, e.crc, true);
            dv.setUint32(20, e.csize, true);
            dv.setUint32(24, e.usize, true);
            dv.setUint16(28, e.nameBytes.length, true);
            dv.setUint16(30, 0, true);     // extra len
            dv.setUint16(32, 0, true);     // comment len
            dv.setUint16(34, 0, true);     // disk number
            dv.setUint16(36, 0, true);     // internal attrs
            dv.setUint32(38, 0, true);     // external attrs
            dv.setUint32(42, e.offset, true);
            cdh.set(e.nameBytes, 46);
            chunks.push(cdh);
            offset += cdh.length;
        }
        const cdSize = offset - cdStart;

        // End of central directory
        const eocd = new Uint8Array(22);
        const edv  = new DataView(eocd.buffer);
        edv.setUint32(0, SIG_EOCD, true);
        edv.setUint16(4, 0, true);                 // disk
        edv.setUint16(6, 0, true);                 // disk with CD
        edv.setUint16(8, entries.length, true);    // entries on disk
        edv.setUint16(10, entries.length, true);   // total entries
        edv.setUint32(12, cdSize, true);
        edv.setUint32(16, cdStart, true);
        edv.setUint16(20, 0, true);                // comment len
        chunks.push(eocd);

        // Concatenate
        const total = chunks.reduce((n, c) => n + c.length, 0);
        const out = new Uint8Array(total);
        let p = 0;
        for (const c of chunks) { out.set(c, p); p += c.length; }
        return out;
    }

    /**
     * Parse a ZIP archive into a { name → Uint8Array } map.
     * Supports STORE (0) and DEFLATE (8).
     * @param {Uint8Array|ArrayBuffer} input
     * @returns {Promise<Map<string, Uint8Array>>}
     */
    static async parse(input, opts = {}) {
        // Zip-bomb guards: cap entry count and total/per-entry decompressed size.
        const maxFiles = opts.maxFiles ?? 10000;
        const maxTotal = opts.maxTotalBytes ?? 256 * 1024 * 1024;   // 256 MB
        const maxEntry = opts.maxEntryBytes ?? 64 * 1024 * 1024;    // 64 MB
        const signal = opts.signal ?? null;
        const includeEntry = typeof opts.includeEntry === 'function' ? opts.includeEntry : null;
        const throwIfAborted = () => { if (signal?.aborted) throw signal.reason ?? new DOMException('ZIP parsing cancelled', 'AbortError'); };

        throwIfAborted();
        const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

        // Locate the EOCD within the maximum comment window and require the
        // advertised comment to end exactly at the archive boundary.
        let eocd = -1;
        const eocdMinimum = Math.max(0, bytes.length - 22 - 0xffff);
        for (let i = bytes.length - 22; i >= eocdMinimum; i--) {
            if (dv.getUint32(i, true) === SIG_EOCD && i + 22 + dv.getUint16(i + 20, true) === bytes.length) { eocd = i; break; }
        }
        if (eocd < 0) throw new Error('Not a ZIP archive (EOCD not found)');

        const disk = dv.getUint16(eocd + 4, true);
        const centralDisk = dv.getUint16(eocd + 6, true);
        const diskTotal = dv.getUint16(eocd + 8, true);
        const total   = dv.getUint16(eocd + 10, true);
        const centralSize = dv.getUint32(eocd + 12, true);
        if (disk !== 0 || centralDisk !== 0 || diskTotal !== total) throw new Error('Multi-disk ZIP archives are unsupported');
        if (total > maxFiles) throw new Error(`ZIP has too many entries (${total} > ${maxFiles})`);
        let   cdPtr    = dv.getUint32(eocd + 16, true);
        const centralStart = cdPtr;
        const centralEnd = cdPtr + centralSize;
        if (cdPtr > bytes.length || centralSize > bytes.length - cdPtr || centralEnd !== eocd) throw new Error('Corrupt central directory span');
        const out      = new Map();
        const names    = new Set();
        let   totalOut = 0;

        for (let n = 0; n < total; n++) {
            throwIfAborted();
            if (cdPtr < 0 || cdPtr + 46 > bytes.length) throw new Error('Corrupt central directory (out of bounds)');
            if (dv.getUint32(cdPtr, true) !== SIG_CDH) throw new Error('Corrupt central directory');
            const flags    = dv.getUint16(cdPtr + 8, true);
            const method   = dv.getUint16(cdPtr + 10, true);
            const crcExpect = dv.getUint32(cdPtr + 16, true) >>> 0;
            const compSize = dv.getUint32(cdPtr + 20, true);
            const uncompSize = dv.getUint32(cdPtr + 24, true);
            const nameLen  = dv.getUint16(cdPtr + 28, true);
            const extraLen = dv.getUint16(cdPtr + 30, true);
            const cmtLen   = dv.getUint16(cdPtr + 32, true);
            const lfhOff   = dv.getUint32(cdPtr + 42, true);
            const nextCdPtr = cdPtr + 46 + nameLen + extraLen + cmtLen;
            if (nextCdPtr > centralEnd) throw new Error('Corrupt central directory entry');
            const nameBytes = bytes.subarray(cdPtr + 46, cdPtr + 46 + nameLen);
            const name = decodeEntryName(nameBytes, flags, 'central directory');
            assertSupportedFlags(flags, method, name);
            if (names.has(name)) throw new Error(`Duplicate ZIP entry name: ${name}`);
            names.add(name);

            // Validate the local identity before filtering or allocating so a
            // selective parse cannot accept contradictory archive metadata.
            if (lfhOff < 0 || lfhOff + 30 > bytes.length || dv.getUint32(lfhOff, true) !== SIG_LFH) throw new Error('Corrupt local file header');
            const localFlags = dv.getUint16(lfhOff + 6, true);
            const localMethod = dv.getUint16(lfhOff + 8, true);
            const lNameLen  = dv.getUint16(lfhOff + 26, true);
            const lExtraLen = dv.getUint16(lfhOff + 28, true);
            const dataStart = lfhOff + 30 + lNameLen + lExtraLen;
            if (dataStart > centralStart || compSize > centralStart - dataStart) throw new Error('Corrupt ZIP entry data span');
            const localNameBytes = bytes.subarray(lfhOff + 30, lfhOff + 30 + lNameLen);
            if (localFlags !== flags || localMethod !== method || !equalBytes(localNameBytes, nameBytes)) throw new Error(`ZIP local header conflicts with central directory: ${name}`);
            if (decodeEntryName(localNameBytes, localFlags, 'local header') !== name) throw new Error(`ZIP local entry name conflicts with central directory: ${name}`);

            if (includeEntry && !includeEntry(name)) {
                cdPtr = nextCdPtr;
                continue;
            }

            // Reject declared expansion before slicing or invoking a codec.
            // Filtered entries remain metadata-only and consume no output budget.
            if (uncompSize > maxEntry) throw new Error(`ZIP entry too large: ${name} (${uncompSize} > ${maxEntry})`);
            if (uncompSize > maxTotal - totalOut) throw new Error(`ZIP total uncompressed size exceeds ${maxTotal} bytes`);

            const raw       = bytes.subarray(dataStart, dataStart + compSize);

            let data;
            if (method === 0) {
                if (compSize !== uncompSize || compSize > maxEntry) throw new Error(`Stored ZIP entry has inconsistent size metadata: ${name}`);
                data = raw.slice();
            }
            else if (method === 8) data = await inflateRaw(raw, { maxBytes: maxEntry, signal });
            else throw new Error(`Unsupported ZIP method ${method} for ${name}`);

            // Post-decompress size guards (defends against a lying header).
            if (data.length > maxEntry) throw new Error(`ZIP entry expanded too large: ${name}`);
            totalOut += data.length;
            if (totalOut > maxTotal) throw new Error(`ZIP total uncompressed size exceeds ${maxTotal} bytes`);

            // Integrity: the decompressed bytes must match the stored CRC-32.
            if ((crc32(data) >>> 0) !== crcExpect) throw new Error(`CRC-32 mismatch for ${name}`);

            out.set(name, data);
            cdPtr = nextCdPtr;
        }
        if (cdPtr !== centralEnd) throw new Error('Corrupt central directory size');
        return out;
    }

    static textOf(bytes) { return dec.decode(bytes); }
}

async function inflateRaw(bytes, { maxBytes = Number.MAX_SAFE_INTEGER, signal = null } = {}) {
    if (typeof DecompressionStream === 'undefined') throw new Error('DEFLATE not supported in this environment');
    const ds = new DecompressionStream('deflate-raw');
    const reader = new Blob([bytes]).stream().pipeThrough(ds).getReader(); const chunks = []; let total = 0;
    const abort = () => reader.cancel(signal?.reason).catch(() => {}); signal?.addEventListener?.('abort', abort, { once: true });
    try {
        while (true) {
            if (signal?.aborted) throw signal.reason ?? new DOMException('ZIP parsing cancelled', 'AbortError');
            const { done, value } = await reader.read();
            if (signal?.aborted) throw signal.reason ?? new DOMException('ZIP parsing cancelled', 'AbortError');
            if (done) break;
            total += value.byteLength; if (total > maxBytes) { await reader.cancel('ZIP entry exceeds the decompression limit'); throw new Error(`ZIP entry expanded beyond ${maxBytes} bytes`); }
            chunks.push(value);
        }
        const output = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; } return output;
    } finally { signal?.removeEventListener?.('abort', abort); try { reader.releaseLock?.(); } catch (_) {} }
}

// Raw DEFLATE via the browser-native Compression Streams API. Returns null when
// unavailable (caller falls back to STORE) — keeps the archive a valid ZIP.
async function deflateRaw(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
        const cs = new CompressionStream('deflate-raw');
        const stream = new Blob([bytes]).stream().pipeThrough(cs);
        return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch { return null; }
}
