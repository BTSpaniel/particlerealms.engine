// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * CollabCodec.js
 * Inline MessagePack encoder/decoder for binary collab messages.
 * Zero dependencies — implements msgpack spec directly.
 *
 * Supports: null, bool, int (safe integer range), float64, string,
 *           bin (Uint8Array), array, map (plain objects).
 *
 * Special extension type 0x01: Float32Array with canonical little-endian bytes.
 *
 * Usage:
 *   import { encode, decode } from './CollabCodec.js';
 *   const bytes = encode({ ch: 'ops', data: { type: 'transform', pos: new Float32Array([1,2,3]) } });
 *   const obj = decode(bytes);
 */

// ─── Encoder ──────────────────────────────────────────────────────────────────

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });
const HOST_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

export const COLLAB_CODEC_LIMITS = Object.freeze({
    maxBytes: 64 * 1024 * 1024,
    maxDepth: 64,
    maxContainerEntries: 1_000_000,
    maxMapEntries: 100_000,
    maxNodes: 2_000_000,
});

function _limits(options = {}) {
    const result = {};
    for (const [key, fallback] of Object.entries(COLLAB_CODEC_LIMITS)) {
        const value = options[key] ?? fallback;
        if (!Number.isSafeInteger(value) || value <= 0 || value > fallback) {
            throw new RangeError(`${key} must be a positive safe integer no greater than ${fallback}`);
        }
        result[key] = value;
    }
    return result;
}

/**
 * Encode a JS value into a msgpack Uint8Array.
 * @param {*} value
 * @returns {Uint8Array}
 */
export function encode(value, options = {}) {
    const limits = _limits(options);
    const parts = [];
    const state = { parts, totalBytes: 0, nodes: 0, ancestors: new WeakSet(), limits };
    _encode(value, state, 0);
    const out = new Uint8Array(state.totalBytes);
    let offset = 0;
    for (const p of parts) {
        out.set(p, offset);
        offset += p.length;
    }
    return out;
}

export function codecEncodeReport(value, options = {}) {
    try {
        const bytes = encode(value, options);
        return { valid: true, reason: 'valid', bytes, byteLength: bytes.byteLength };
    } catch (error) {
        return { valid: false, reason: error?.message || 'encode-failed', bytes: null, byteLength: 0 };
    }
}

function _push(state, part) {
    if (!(part instanceof Uint8Array)) throw new TypeError('codec part must be Uint8Array');
    const next = state.totalBytes + part.byteLength;
    if (!Number.isSafeInteger(next) || next > state.limits.maxBytes) {
        throw new RangeError(`encoded message exceeds ${state.limits.maxBytes} bytes`);
    }
    state.parts.push(part);
    state.totalBytes = next;
}

function _encode(value, state, depth) {
    if (depth > state.limits.maxDepth) throw new RangeError('maximum codec depth exceeded');
    state.nodes++;
    if (state.nodes > state.limits.maxNodes) throw new RangeError('maximum codec node count exceeded');
    if (value === null || value === undefined) {
        _push(state, _BYTE_NIL);
        return;
    }

    if (typeof value === 'boolean') {
        _push(state, value ? _BYTE_TRUE : _BYTE_FALSE);
        return;
    }

    if (typeof value === 'number') {
        _encodeNumber(value, state);
        return;
    }

    if (typeof value === 'string') {
        _encodeString(value, state);
        return;
    }

    if (value instanceof Uint8Array) {
        _encodeBin(value, state);
        return;
    }

    if (value instanceof Float32Array) {
        _encodeFloat32Array(value, state);
        return;
    }

    if (Array.isArray(value)) {
        _enterContainer(value, state);
        try { _encodeArray(value, state, depth); } finally { state.ancestors.delete(value); }
        return;
    }

    if (typeof value === 'object') {
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError('only plain objects, Uint8Array, and Float32Array are supported');
        }
        _enterContainer(value, state);
        try { _encodeMap(value, state, depth); } finally { state.ancestors.delete(value); }
        return;
    }

    throw new TypeError(`unsupported codec value type: ${typeof value}`);
}

function _enterContainer(value, state) {
    if (state.ancestors.has(value)) throw new TypeError('cyclic codec value');
    state.ancestors.add(value);
}

const _BYTE_NIL   = new Uint8Array([0xc0]);
const _BYTE_TRUE  = new Uint8Array([0xc3]);
const _BYTE_FALSE = new Uint8Array([0xc2]);

function _encodeNumber(n, state) {
    if (!Number.isFinite(n)) throw new RangeError('codec numbers must be finite');
    if (Number.isInteger(n) && !Number.isSafeInteger(n)) throw new RangeError('codec integers must be safe');
    if (Number.isInteger(n) && n >= -2147483648 && n <= 2147483647) {
        if (n >= 0) {
            if (n <= 0x7f) {
                // positive fixint
                _push(state, new Uint8Array([n]));
            } else if (n <= 0xff) {
                _push(state, new Uint8Array([0xcc, n]));
            } else if (n <= 0xffff) {
                _push(state, new Uint8Array([0xcd, n >> 8, n & 0xff]));
            } else {
                _push(state, new Uint8Array([0xce, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]));
            }
        } else {
            if (n >= -32) {
                // negative fixint
                _push(state, new Uint8Array([n & 0xff]));
            } else if (n >= -128) {
                _push(state, new Uint8Array([0xd0, n & 0xff]));
            } else if (n >= -32768) {
                _push(state, new Uint8Array([0xd1, (n >> 8) & 0xff, n & 0xff]));
            } else {
                const buf = new Uint8Array(5);
                const dv = new DataView(buf.buffer);
                buf[0] = 0xd2;
                dv.setInt32(1, n, false);
                _push(state, buf);
            }
        }
    } else {
        // float64
        const buf = new Uint8Array(9);
        const dv = new DataView(buf.buffer);
        buf[0] = 0xcb;
        dv.setFloat64(1, n, false);
        _push(state, buf);
    }
}

function _encodeString(s, state) {
    const bytes = TEXT_ENCODER.encode(s);
    const len = bytes.length;
    if (len <= 31) {
        _push(state, new Uint8Array([0xa0 | len]));
    } else if (len <= 0xff) {
        _push(state, new Uint8Array([0xd9, len]));
    } else if (len <= 0xffff) {
        _push(state, new Uint8Array([0xda, len >> 8, len & 0xff]));
    } else {
        _push(state, new Uint8Array([0xdb, (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff]));
    }
    _push(state, bytes);
}

function _encodeBin(buf, state) {
    const len = buf.length;
    if (len <= 0xff) {
        _push(state, new Uint8Array([0xc4, len]));
    } else if (len <= 0xffff) {
        _push(state, new Uint8Array([0xc5, len >> 8, len & 0xff]));
    } else {
        _push(state, new Uint8Array([0xc6, (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff]));
    }
    _push(state, buf);
}

// Extension type 0x01: Float32Array — encoded as ext with raw LE bytes
function _encodeFloat32Array(arr, state) {
    const byteLen = arr.byteLength;
    for (const value of arr) {
        if (!Number.isFinite(value)) throw new RangeError('Float32Array values must be finite');
    }
    // ext format: fixext or ext8/16/32 depending on size
    if (byteLen <= 0xff) {
        _push(state, new Uint8Array([0xc7, byteLen, 0x01])); // ext8
    } else if (byteLen <= 0xffff) {
        _push(state, new Uint8Array([0xc8, byteLen >> 8, byteLen & 0xff, 0x01])); // ext16
    } else {
        _push(state, new Uint8Array([0xc9, (byteLen >>> 24) & 0xff, (byteLen >>> 16) & 0xff, (byteLen >>> 8) & 0xff, byteLen & 0xff, 0x01])); // ext32
    }
    if (HOST_LITTLE_ENDIAN) {
        _push(state, new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength));
        return;
    }
    const bytes = new Uint8Array(byteLen);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < arr.length; index++) view.setFloat32(index * 4, arr[index], true);
    _push(state, bytes);
}

function _encodeArray(arr, state, depth) {
    const len = arr.length;
    if (len > state.limits.maxContainerEntries) throw new RangeError('array entry limit exceeded');
    if (len <= 15) {
        _push(state, new Uint8Array([0x90 | len]));
    } else if (len <= 0xffff) {
        _push(state, new Uint8Array([0xdc, len >> 8, len & 0xff]));
    } else {
        _push(state, new Uint8Array([0xdd, (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff]));
    }
    for (let i = 0; i < len; i++) {
        _encode(arr[i], state, depth + 1);
    }
}

function _encodeMap(obj, state, depth) {
    if (Object.getOwnPropertySymbols(obj).length > 0) {
        throw new TypeError('symbol map keys are not supported');
    }
    const keys = Object.keys(obj);
    const len = keys.length;
    if (len > state.limits.maxMapEntries) throw new RangeError('map entry limit exceeded');
    if (len <= 15) {
        _push(state, new Uint8Array([0x80 | len]));
    } else if (len <= 0xffff) {
        _push(state, new Uint8Array([0xde, len >> 8, len & 0xff]));
    } else {
        _push(state, new Uint8Array([0xdf, (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff]));
    }
    for (const key of keys) {
        _encodeString(key, state);
        _encode(obj[key], state, depth + 1);
    }
}

// ─── Decoder ──────────────────────────────────────────────────────────────────

/**
 * Decode a msgpack Uint8Array (or ArrayBuffer) back into a JS value.
 * @param {Uint8Array|ArrayBuffer} data
 * @returns {*}
 */
export function decode(data, options = {}) {
    const limits = _limits(options);
    let buf;
    if (data instanceof Uint8Array) buf = data;
    else if (data instanceof ArrayBuffer) buf = new Uint8Array(data);
    else if (ArrayBuffer.isView(data)) buf = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    else throw new TypeError('codec input must be an ArrayBuffer or typed-array view');
    if (buf.byteLength === 0) throw new RangeError('codec input is empty');
    if (buf.byteLength > limits.maxBytes) throw new RangeError(`codec input exceeds ${limits.maxBytes} bytes`);
    const state = { buf, pos: 0, nodes: 0, limits };
    const value = _decode(state, 0);
    if (state.pos !== buf.byteLength) throw new RangeError('trailing codec bytes');
    return value;
}

export function codecDecodeReport(data, options = {}) {
    try {
        const value = decode(data, options);
        const byteLength = data?.byteLength ?? 0;
        return { valid: true, reason: 'valid', value, byteLength };
    } catch (error) {
        return { valid: false, reason: error?.message || 'decode-failed', value: null, byteLength: 0 };
    }
}

function _require(s, byteLength) {
    if (!Number.isSafeInteger(byteLength) || byteLength < 0 || s.pos + byteLength > s.buf.byteLength) {
        throw new RangeError('truncated codec payload');
    }
}

function _readByte(s) {
    _require(s, 1);
    return s.buf[s.pos++];
}

function _decode(s, depth) {
    if (depth > s.limits.maxDepth) throw new RangeError('maximum codec depth exceeded');
    s.nodes++;
    if (s.nodes > s.limits.maxNodes) throw new RangeError('maximum codec node count exceeded');
    const b = _readByte(s);

    // positive fixint (0x00 - 0x7f)
    if (b <= 0x7f) return b;

    // fixmap (0x80 - 0x8f)
    if (b >= 0x80 && b <= 0x8f) return _decodeMapN(s, b & 0x0f, depth);

    // fixarray (0x90 - 0x9f)
    if (b >= 0x90 && b <= 0x9f) return _decodeArrayN(s, b & 0x0f, depth);

    // fixstr (0xa0 - 0xbf)
    if (b >= 0xa0 && b <= 0xbf) return _decodeStrN(s, b & 0x1f);

    // negative fixint (0xe0 - 0xff)
    if (b >= 0xe0) return b - 256;

    switch (b) {
        case 0xc0: return null;           // nil
        case 0xc2: return false;          // false
        case 0xc3: return true;           // true

        // bin8, bin16, bin32
        case 0xc4: return _decodeBinN(s, _readByte(s));
        case 0xc5: return _decodeBinN(s, _readU16(s));
        case 0xc6: return _decodeBinN(s, _readU32(s));

        // ext8, ext16, ext32
        case 0xc7: { const len = _readByte(s); const type = _readByte(s); return _decodeExt(s, type, len); }
        case 0xc8: { const len = _readU16(s); const type = _readByte(s); return _decodeExt(s, type, len); }
        case 0xc9: { const len = _readU32(s); const type = _readByte(s); return _decodeExt(s, type, len); }

        // float32
        case 0xca: {
            _require(s, 4);
            const dv = new DataView(s.buf.buffer, s.buf.byteOffset + s.pos, 4);
            s.pos += 4;
            const value = dv.getFloat32(0, false);
            if (!Number.isFinite(value)) throw new RangeError('decoded number is non-finite');
            return value;
        }
        // float64
        case 0xcb: {
            _require(s, 8);
            const dv = new DataView(s.buf.buffer, s.buf.byteOffset + s.pos, 8);
            s.pos += 8;
            const value = dv.getFloat64(0, false);
            if (!Number.isFinite(value)) throw new RangeError('decoded number is non-finite');
            return value;
        }

        // uint8, uint16, uint32
        case 0xcc: return _readByte(s);
        case 0xcd: return _readU16(s);
        case 0xce: return _readU32(s);
        // uint64 — read as Number (loses precision above 2^53)
        case 0xcf: {
            const hi = _readU32(s);
            const lo = _readU32(s);
            const value = hi * 0x100000000 + lo;
            if (!Number.isSafeInteger(value)) throw new RangeError('decoded uint64 exceeds safe integer range');
            return value;
        }

        // int8
        case 0xd0: {
            const v = _readByte(s);
            return v > 127 ? v - 256 : v;
        }
        // int16
        case 0xd1: {
            _require(s, 2);
            const dv = new DataView(s.buf.buffer, s.buf.byteOffset + s.pos, 2);
            s.pos += 2;
            return dv.getInt16(0, false);
        }
        // int32
        case 0xd2: {
            _require(s, 4);
            const dv = new DataView(s.buf.buffer, s.buf.byteOffset + s.pos, 4);
            s.pos += 4;
            return dv.getInt32(0, false);
        }
        // int64 — read as Number
        case 0xd3: {
            _require(s, 8);
            const dv = new DataView(s.buf.buffer, s.buf.byteOffset + s.pos, 8);
            s.pos += 8;
            const hi = dv.getInt32(0, false);
            const lo = dv.getUint32(4, false);
            const value = hi * 0x100000000 + lo;
            if (!Number.isSafeInteger(value)) throw new RangeError('decoded int64 exceeds safe integer range');
            return value;
        }

        // fixext 1,2,4,8,16
        case 0xd4: { const type = _readByte(s); return _decodeExt(s, type, 1); }
        case 0xd5: { const type = _readByte(s); return _decodeExt(s, type, 2); }
        case 0xd6: { const type = _readByte(s); return _decodeExt(s, type, 4); }
        case 0xd7: { const type = _readByte(s); return _decodeExt(s, type, 8); }
        case 0xd8: { const type = _readByte(s); return _decodeExt(s, type, 16); }

        // str8, str16, str32
        case 0xd9: return _decodeStrN(s, _readByte(s));
        case 0xda: return _decodeStrN(s, _readU16(s));
        case 0xdb: return _decodeStrN(s, _readU32(s));

        // array16, array32
        case 0xdc: return _decodeArrayN(s, _readU16(s), depth);
        case 0xdd: return _decodeArrayN(s, _readU32(s), depth);

        // map16, map32
        case 0xde: return _decodeMapN(s, _readU16(s), depth);
        case 0xdf: return _decodeMapN(s, _readU32(s), depth);

        default:
            throw new RangeError(`unsupported MessagePack tag 0x${b.toString(16).padStart(2, '0')}`);
    }
}

function _readU16(s) {
    _require(s, 2);
    const v = (s.buf[s.pos] << 8) | s.buf[s.pos + 1];
    s.pos += 2;
    return v;
}

function _readU32(s) {
    _require(s, 4);
    const v = ((s.buf[s.pos] << 24) | (s.buf[s.pos + 1] << 16) | (s.buf[s.pos + 2] << 8) | s.buf[s.pos + 3]) >>> 0;
    s.pos += 4;
    return v;
}

function _decodeStrN(s, len) {
    if (len > s.limits.maxBytes) throw new RangeError('string byte limit exceeded');
    _require(s, len);
    const str = TEXT_DECODER.decode(s.buf.subarray(s.pos, s.pos + len));
    s.pos += len;
    return str;
}

function _decodeBinN(s, len) {
    if (len > s.limits.maxBytes) throw new RangeError('binary byte limit exceeded');
    _require(s, len);
    const bin = s.buf.slice(s.pos, s.pos + len);
    s.pos += len;
    return bin;
}

function _decodeArrayN(s, len, depth) {
    if (len > s.limits.maxContainerEntries) throw new RangeError('array entry limit exceeded');
    if (len > s.buf.byteLength - s.pos) throw new RangeError('array length exceeds remaining payload');
    const arr = new Array(len);
    for (let i = 0; i < len; i++) arr[i] = _decode(s, depth + 1);
    return arr;
}

function _decodeMapN(s, len, depth) {
    if (len > s.limits.maxMapEntries) throw new RangeError('map entry limit exceeded');
    if (len * 2 > s.buf.byteLength - s.pos) throw new RangeError('map length exceeds remaining payload');
    const obj = {};
    const keys = new Set();
    for (let i = 0; i < len; i++) {
        const key = _decode(s, depth + 1);
        if (typeof key !== 'string') throw new TypeError('decoded map key must be a string');
        if (keys.has(key)) throw new RangeError('duplicate decoded map key');
        keys.add(key);
        const value = _decode(s, depth + 1);
        Object.defineProperty(obj, key, { value, enumerable: true, configurable: true, writable: true });
    }
    return obj;
}

function _decodeExt(s, type, len) {
    if (len > s.limits.maxBytes) throw new RangeError('extension byte limit exceeded');
    _require(s, len);
    const data = s.buf.slice(s.pos, s.pos + len);
    s.pos += len;
    // Extension type 0x01: Float32Array
    if (type === 0x01) {
        if (data.byteLength % 4 !== 0) throw new RangeError('Float32 extension length must be divisible by four');
        if (HOST_LITTLE_ENDIAN) {
            const values = new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
            for (const value of values) {
                if (!Number.isFinite(value)) throw new RangeError('Float32 extension contains non-finite value');
            }
            return values;
        }
        const values = new Float32Array(data.byteLength / 4);
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        for (let index = 0; index < values.length; index++) {
            values[index] = view.getFloat32(index * 4, true);
            if (!Number.isFinite(values[index])) throw new RangeError('Float32 extension contains non-finite value');
        }
        return values;
    }
    // Unknown ext — return raw bytes
    return data;
}

// Audit gaps: the codec has no streaming decoder, schema-specific operation
// validation remains in collaboration modules, and captured cross-implementation
// MessagePack/WebRTC corpora plus fuzzing coverage remain absent.
