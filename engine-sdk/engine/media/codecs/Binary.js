// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// Bounds are checked before every read and allocation, including untrusted packets.
export const MAX_CONTAINER_BYTES = 128 * 1024 * 1024;
export const MAX_PACKET_BYTES = 4 * 1024 * 1024;
export const MAX_FRAMES = 50_000;

export function byteView(value) {
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    throw new TypeError('codec input must be binary data');
}

export function integer(value, min, max, name) {
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new RangeError(`${name} must be an integer in ${min}..${max}`);
    return value;
}

export function dimensions(width, height) {
    integer(width, 1, 1280, 'width');
    integer(height, 1, 720, 'height');
    return width * height * 4;
}

export function timestamp(value) {
    return integer(value, 0, Number.MAX_SAFE_INTEGER, 'timestampUs');
}

export class Writer {
    constructor(maximum = MAX_PACKET_BYTES) {
        this.maximum = maximum;
        this.bytes = new Uint8Array(Math.min(4096, maximum));
        this.length = 0;
    }
    reserve(count) {
        if (!Number.isSafeInteger(count) || count < 0 || this.length + count > this.maximum) throw new RangeError('codec output exceeds byte limit');
        if (this.length + count > this.bytes.length) {
            const next = new Uint8Array(Math.min(this.maximum, Math.max(this.length + count, this.bytes.length * 2)));
            next.set(this.bytes); this.bytes = next;
        }
    }
    u8(value) { this.reserve(1); this.bytes[this.length++] = value; }
    i8(value) { this.u8(value); }
    u16(value) { this.reserve(2); new DataView(this.bytes.buffer).setUint16(this.length, value, true); this.length += 2; }
    i16(value) { this.reserve(2); new DataView(this.bytes.buffer).setInt16(this.length, value, true); this.length += 2; }
    u32(value) { this.reserve(4); new DataView(this.bytes.buffer).setUint32(this.length, value, true); this.length += 4; }
    f64(value) { this.reserve(8); new DataView(this.bytes.buffer).setFloat64(this.length, value, true); this.length += 8; }
    data(value) { const bytes = byteView(value); this.reserve(bytes.length); this.bytes.set(bytes, this.length); this.length += bytes.length; }
    finish() { return this.bytes.slice(0, this.length); }
}

export class Reader {
    constructor(value, maximum = MAX_PACKET_BYTES) {
        this.bytes = byteView(value);
        if (this.bytes.length > maximum) throw new RangeError('codec input exceeds byte limit');
        this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
        this.offset = 0;
    }
    require(count) { if (!Number.isSafeInteger(count) || count < 0 || count > this.bytes.length - this.offset) throw new RangeError('truncated codec data'); }
    u8() { this.require(1); return this.bytes[this.offset++]; }
    i8() { const value = this.u8(); return value > 127 ? value - 256 : value; }
    u16() { this.require(2); const value = this.view.getUint16(this.offset, true); this.offset += 2; return value; }
    i16() { this.require(2); const value = this.view.getInt16(this.offset, true); this.offset += 2; return value; }
    u32() { this.require(4); const value = this.view.getUint32(this.offset, true); this.offset += 4; return value; }
    f64() { this.require(8); const value = this.view.getFloat64(this.offset, true); this.offset += 8; return value; }
    data(count) { this.require(count); const bytes = this.bytes.subarray(this.offset, this.offset + count); this.offset += count; return bytes; }
    end() { if (this.offset !== this.bytes.length) throw new RangeError('trailing codec data'); }
}
