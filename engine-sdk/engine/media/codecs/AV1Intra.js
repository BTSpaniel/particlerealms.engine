// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// Independently authored AV1 Main 8-bit monochrome palette-intra subset.
// Independent 64x64 two-color palette tiles, static CDFs, skipped residuals,
// and disabled filters. Arbitrary RGBA input is quantized to two luma values;
// this is a deliberately restricted standards codec, not a general AV1 decoder.
// Syntax, integer arithmetic and normative probability constants are specified
// by https://aomediacodec.github.io/av1-spec/ (chapters 5, 8 and 9).
import { byteView, integer, Writer, Reader, MAX_CONTAINER_BYTES, MAX_FRAMES, MAX_PACKET_BYTES } from './Binary.js';
import { Bits, ReadBits } from './Bitstream.js';

const SIZE = 64, PIXELS = SIZE * SIZE, MAX_TILE = 8192;
const BOOL = [16384, 32768];
const PARTITION = [20137, 21547, 23078, 29566, 29837, 30261, 30524, 30892, 31724, 32768];
const SKIP = [31671, 32768];
const INTRA_MODE = [15588, 17027, 19338, 20218, 20682, 21110, 21825, 23244, 24189, 28165, 29093, 30466, 32768];
const PALETTE_MODE = [32450, 32768];
const PALETTE_SIZE = [14940, 20797, 21678, 24186, 27033, 28999, 32768];
const PALETTE_COLOR = [[28710, 32768], [16384, 32768], [10553, 32768], [27036, 32768], [31603, 32768]];
const COLOR_CONTEXT = [-1, -1, 0, -1, -1, 4, 3, 2, 1];
// AV1 Annex A: [level index, picture samples, display samples/sec, Main bitrate,
// tile count, tile columns]. Conservative 30fps selection also bounds lower
// file rates. Still-picture sequences use Annex A's still-picture ratio rule.
const LEVELS = [
    [0, 147456, 4423680, 1500000, 8, 4], [1, 278784, 8363520, 3000000, 8, 4],
    [4, 665856, 19975680, 6000000, 16, 6], [5, 1065024, 31950720, 10000000, 16, 6],
    [8, 2359296, 70778880, 12000000, 32, 8], [9, 2359296, 141557760, 20000000, 32, 8],
    [12, 8912896, 267386880, 30000000, 64, 8], [13, 8912896, 534773760, 40000000, 64, 8],
    [14, 8912896, 1069547520, 60000000, 64, 8], [15, 8912896, 1069547520, 60000000, 64, 8],
    [16, 35651584, 1069547520, 60000000, 128, 16], [17, 35651584, 2139095040, 100000000, 128, 16],
    [18, 35651584, 4278190080, 160000000, 128, 16], [19, 35651584, 4278190080, 160000000, 128, 16],
];

function frameDimensions(width, height) {
    integer(width, 64, 1024, 'AV1 width'); integer(height, 64, 512, 'AV1 height');
    if (width % SIZE || height % SIZE) throw new RangeError('authored AV1 palette-intra dimensions must be multiples of 64');
    return { columns: width / SIZE, rows: height / SIZE, count: width * height / PIXELS };
}

function selectLevel(width, height, byteLength) {
    const { columns, count } = frameDimensions(width, height), picture = width * height;
    const level = LEVELS.find(([, samples, rate, bitrate, tiles, cols]) => picture <= samples && picture * 30 <= rate && byteLength * 8 * 30 <= bitrate && count <= tiles && columns <= cols);
    if (!level) throw new RangeError('AV1 palette output exceeds supported level/tier bounds');
    return level[0];
}

function bounds(range, cdf, symbol) {
    const boundary = index => ((range >>> 8) * ((32768 - cdf[index]) >>> 6) >>> 1) + 4 * (cdf.length - index - 1);
    return [boundary(symbol), symbol ? boundary(symbol - 1) : range];
}

// An interval encoder derived directly from the normative integer symbol
// decoder. BigInt carries the global interval exactly; no floating-point
// probability operations or native/compiled encoder are involved.
class SymbolEncoder {
    constructor() { this.low = 0n; this.range = 32768; this.shifts = 0; }
    symbol(value, cdf) {
        const [low, high] = bounds(this.range, cdf, value), range = high - low;
        const shift = 15 - Math.floor(Math.log2(range));
        this.low = (this.low + BigInt(low)) << BigInt(shift);
        this.range = range * 2 ** shift; this.shifts += shift;
    }
    literal(value, count) { for (let i = count - 1; i >= 0; i--) this.symbol((value >>> i) & 1, BOOL); }
    finish() {
        // The normative exit bit lies at shifts, followed only by zero padding.
        // Select an odd prefix at that precision lying inside the final interval.
        const scale = 1n << BigInt(this.shifts + 15), minimum = scale - this.low - BigInt(this.range);
        const maximum = scale - this.low - 1n, step = 1n << 14n;
        let prefix = (minimum + step - 1n) / step;
        if (!(prefix & 1n)) prefix++;
        if (prefix * step > maximum) throw new Error('AV1 arithmetic termination interval is empty');
        const count = this.shifts + 1, bytes = new Uint8Array(Math.ceil(count / 8));
        if (bytes.length > MAX_TILE) throw new RangeError('AV1 tile exceeds bounds');
        for (let i = 0; i < count; i++) if ((prefix >> BigInt(count - i - 1)) & 1n) bytes[i >>> 3] |= 1 << (7 - i % 8);
        return bytes;
    }
}

class SymbolDecoder {
    constructor(bytes) {
        if (!bytes.length || bytes.length > MAX_TILE) throw new RangeError('invalid AV1 tile length');
        this.bits = new ReadBits(bytes); this.bytes = bytes; this.shifts = 0; this.range = 32768;
        const count = Math.min(bytes.length * 8, 15);
        this.value = 32767 ^ (this.bits.bits(count) << (15 - count));
        this.remaining = bytes.length * 8 - 15;
    }
    symbol(cdf) {
        let value = 0, low, high;
        do { [low, high] = bounds(this.range, cdf, value); if (this.value >= low) break; value++; } while (value < cdf.length);
        if (value === cdf.length) throw new RangeError('invalid AV1 arithmetic symbol');
        const range = high - low, shift = 15 - Math.floor(Math.log2(range));
        this.range = range * 2 ** shift; this.value -= low;
        const count = Math.min(shift, Math.max(0, this.remaining));
        const data = this.bits.bits(count) * 2 ** (shift - count);
        this.value = data ^ ((this.value + 1) * 2 ** shift - 1);
        this.remaining -= shift; this.shifts += shift;
        if (this.remaining < -14) throw new RangeError('truncated AV1 arithmetic symbols');
        return value;
    }
    literal(count) { let value = 0; for (let i = 0; i < count; i++) value = value * 2 + this.symbol(BOOL); return value; }
    expect(value, cdf, name) { if (this.symbol(cdf) !== value) throw new RangeError(`unsupported AV1 ${name}`); }
    end() {
        const bits = new ReadBits(this.bytes); bits.position = this.shifts;
        if (bits.bit() !== 1) throw new RangeError('missing AV1 arithmetic trailing bit');
        while (bits.position < this.bytes.length * 8) if (bits.bit()) throw new RangeError('nonzero AV1 arithmetic padding');
    }
}

function colorContext(map, row, column) {
    const scores = [0, 0, 0];
    if (column) scores[map[row * SIZE + column - 1]] += 2;
    if (row && column) scores[map[(row - 1) * SIZE + column - 1]]++;
    if (row) scores[map[(row - 1) * SIZE + column]] += 2;
    const first = scores[1] > scores[0] ? 1 : 0, second = 1 - first;
    const context = COLOR_CONTEXT[scores[first] + scores[second] * 2];
    if (context < 0 || context === undefined) throw new RangeError('invalid AV1 palette context');
    return { first, cdf: PALETTE_COLOR[context] };
}

function paletteInput(rgba, width, tileX, tileY) {
    const luma = new Uint8Array(PIXELS); let low = 255, high = 0;
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
        const i = y * SIZE + x, j = ((tileY * SIZE + y) * width + tileX * SIZE + x) * 4;
        const v = (77 * rgba[j] + 150 * rgba[j + 1] + 29 * rgba[j + 2] + 128) >>> 8; luma[i] = v; low = Math.min(low, v); high = Math.max(high, v);
    }
    if (low === high) { if (high === 255) low--; else high++; }
    const map = new Uint8Array(PIXELS), threshold = (low + high) / 2;
    for (let i = 0; i < PIXELS; i++) map[i] = luma[i] > threshold ? 1 : 0;
    return { low, high, map };
}

function encodeTile({ low, high, map }) {
    const coder = new SymbolEncoder();
    coder.symbol(0, PARTITION); coder.symbol(1, SKIP); coder.symbol(0, INTRA_MODE);
    coder.symbol(1, PALETTE_MODE); coder.symbol(0, PALETTE_SIZE);
    coder.literal(low, 8); coder.literal(3, 2); coder.literal(high - low - 1, 8);
    coder.literal(map[0], 1);
    for (let diagonal = 1; diagonal < SIZE * 2 - 1; diagonal++) {
        for (let column = Math.min(diagonal, SIZE - 1); column >= Math.max(0, diagonal - SIZE + 1); column--) {
            const row = diagonal - column, { first, cdf } = colorContext(map, row, column);
            coder.symbol(map[row * SIZE + column] === first ? 0 : 1, cdf);
        }
    }
    return coder.finish();
}

function decodeTile(bytes) {
    const coder = new SymbolDecoder(bytes);
    coder.expect(0, PARTITION, 'partition'); coder.expect(1, SKIP, 'residuals'); coder.expect(0, INTRA_MODE, 'intra mode');
    coder.expect(1, PALETTE_MODE, 'palette mode'); coder.expect(0, PALETTE_SIZE, 'palette size');
    const low = coder.literal(8), extra = coder.literal(2), high = Math.min(255, low + coder.literal(5 + extra) + 1);
    if (low >= high) throw new RangeError('AV1 palette must contain two distinct colors');
    const map = new Uint8Array(PIXELS); map[0] = coder.literal(1);
    for (let diagonal = 1; diagonal < SIZE * 2 - 1; diagonal++) {
        for (let column = Math.min(diagonal, SIZE - 1); column >= Math.max(0, diagonal - SIZE + 1); column--) {
            const row = diagonal - column, { first, cdf } = colorContext(map, row, column);
            map[row * SIZE + column] = coder.symbol(cdf) ? 1 - first : first;
        }
    }
    coder.end();
    const rgba = new Uint8Array(PIXELS * 4);
    for (let i = 0; i < PIXELS; i++) { const v = map[i] ? high : low, j = i * 4; rgba[j] = rgba[j + 1] = rgba[j + 2] = v; rgba[j + 3] = 255; }
    return rgba;
}

function sequenceHeader(width, height, level) {
    const bits = new Bits();
    bits.bits(0, 3); bits.bit(1); bits.bit(1); bits.bits(level, 5); // Main, still-picture, reduced header, Main tier.
    const widthBits = Math.ceil(Math.log2(width)), heightBits = Math.ceil(Math.log2(height));
    bits.bits(widthBits - 1, 4); bits.bits(heightBits - 1, 4); bits.bits(width - 1, widthBits); bits.bits(height - 1, heightBits);
    bits.bit(0); bits.bit(0); bits.bit(0); // 64x64 superblock, no intra filtering.
    bits.bit(0); bits.bit(0); bits.bit(0); // no superres, CDEF or restoration.
    bits.bit(0); bits.bit(1); bits.bit(0); bits.bit(1); // 8-bit, monochrome, unspecified primaries, full range.
    bits.bit(0); // no film grain.
    return bits.finish();
}

function frameHeader(width, height) {
    const bits = new Bits();
    bits.bit(1); bits.bit(1); bits.bit(1); // static CDF, screen tools, integer motion.
    bits.bit(0); bits.bit(0); bits.bit(1); // render size equals frame, no intrabc, uniform tile grid.
    const { columns, rows, count } = frameDimensions(width, height), columnsBits = Math.ceil(Math.log2(columns)), rowsBits = Math.ceil(Math.log2(rows));
    for (let i = 0; i < columnsBits; i++) bits.bit(1);
    for (let i = 0; i < rowsBits; i++) bits.bit(1);
    if (count > 1) { bits.bits(0, columnsBits + rowsBits); bits.bits(1, 2); } // tile lengths are uint16 LE.
    bits.bits(0, 8); bits.bit(0); bits.bit(0); bits.bit(0); // Q=0, no delta, no matrix, no segments.
    bits.bit(1); // reduced transform set; all residuals skipped.
    return bits.finish(false);
}

function obu(type, payload) {
    const writer = new Writer(); writer.u8((type << 3) | 2);
    let length = payload.length;
    do { const byte = length % 128; length = Math.floor(length / 128); writer.u8(byte | (length ? 128 : 0)); } while (length);
    writer.data(payload); return writer.finish();
}

function readObu(reader, expected) {
    if (reader.u8() !== ((expected << 3) | 2)) throw new RangeError('unsupported AV1 OBU type or flags');
    let length = 0, factor = 1, byte;
    for (let i = 0; i < 4; i++) {
        byte = reader.u8(); length += (byte & 127) * factor;
        if (!(byte & 128)) { if (i && !byte) throw new RangeError('noncanonical AV1 OBU length'); return reader.data(integer(length, 0, MAX_PACKET_BYTES, 'OBU length')); }
        factor *= 128;
    }
    throw new RangeError('AV1 OBU length exceeds bounds');
}

function requireHeader(bytes, expected, name) {
    if (bytes.length !== expected.length || bytes.some((byte, i) => byte !== expected[i])) throw new RangeError(`unsupported AV1 ${name}; requires Main8 monochrome 64x64-tile palette-intra subset`);
}

/** Encode one independent standards AV1 keyframe, including its sequence OBU. */
export function encodeAV1PaletteFrame(value, width = SIZE, height = SIZE) {
    const { columns, rows, count } = frameDimensions(width, height), rgba = byteView(value);
    if (rgba.length !== width * height * 4) throw new RangeError('AV1 RGBA length does not match frame dimensions');
    const tiles = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) tiles.push(encodeTile(paletteInput(rgba, width, x, y)));
    const frame = new Writer(); frame.data(frameHeader(width, height));
    if (count > 1) frame.u8(0); // all tiles in this group; byte-aligned zero padding.
    tiles.forEach((tile, i) => { if (i < count - 1) frame.u16(tile.length - 1); frame.data(tile); });
    const payload = frame.finish(), level = selectLevel(width, height, payload.length + 32);
    const writer = new Writer(); writer.data(obu(1, sequenceHeader(width, height, level))); writer.data(obu(6, payload)); return writer.finish();
}

/** Decode the declared subset in authored JavaScript, without WebCodecs. */
export function decodeAV1PaletteFrame(value) {
    const reader = new Reader(value), sequence = readObu(reader, 1), bits = new ReadBits(sequence);
    if (bits.bits(3) !== 0 || bits.bit() !== 1 || bits.bit() !== 1) throw new RangeError('unsupported AV1 profile or non-still sequence');
    const level = bits.bits(5), widthBits = bits.bits(4) + 1, heightBits = bits.bits(4) + 1;
    const width = bits.bits(widthBits) + 1, height = bits.bits(heightBits) + 1, { columns, rows, count } = frameDimensions(width, height);
    if (!LEVELS.some(entry => entry[0] === level)) throw new RangeError('unsupported AV1 level');
    requireHeader(sequence, sequenceHeader(width, height, level), 'sequence header');
    const frame = readObu(reader, 6), header = frameHeader(width, height);
    requireHeader(frame.subarray(0, header.length), header, 'frame header'); reader.end();
    if (level < selectLevel(width, height, frame.length + 32)) throw new RangeError('AV1 sequence level is insufficient for its coded data');
    const tiles = new Reader(frame.subarray(header.length));
    if (count > 1 && tiles.u8() !== 0) throw new RangeError('unsupported AV1 partial tile group');
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0, index = 0; y < rows; y++) for (let x = 0; x < columns; x++, index++) {
        const length = index < count - 1 ? tiles.u16() + 1 : tiles.bytes.length - tiles.offset;
        const decoded = decodeTile(tiles.data(integer(length, 1, MAX_TILE, 'tile length')));
        for (let row = 0; row < SIZE; row++) rgba.set(decoded.subarray(row * SIZE * 4, (row + 1) * SIZE * 4), ((y * SIZE + row) * width + x * SIZE) * 4);
    }
    tiles.end(); return { width, height, rgba, keyframe: true, levelIndex: level };
}

/** Store independent AV1 still-picture sequences in a conventional AV01 IVF file. */
export function encodeAV1Intra({ width, height, frameRate = 24, frames } = {}) {
    frameDimensions(width, height);
    integer(frameRate, 1, 30, 'frameRate');
    if (!Array.isArray(frames)) throw new TypeError('AV1 frames must be an array');
    integer(frames.length, 1, Math.min(MAX_FRAMES, Math.floor(MAX_CONTAINER_BYTES / (width * height * 4))), 'frameCount');
    const writer = new Writer(MAX_CONTAINER_BYTES);
    writer.data(Uint8Array.of(68, 75, 73, 70)); writer.u16(0); writer.u16(32); writer.data(Uint8Array.of(65, 86, 48, 49));
    writer.u16(width); writer.u16(height); writer.u32(frameRate); writer.u32(1); writer.u32(frames.length); writer.u32(0);
    frames.forEach((frame, index) => { const packet = encodeAV1PaletteFrame(frame.rgba ?? frame.data ?? frame, width, height); writer.u32(packet.length); writer.u32(index); writer.u32(0); writer.data(packet); });
    return writer.finish();
}

export function decodeAV1Intra(value) {
    const reader = new Reader(value, MAX_CONTAINER_BYTES);
    const match = (values, name) => { if (values.some(expected => reader.u8() !== expected)) throw new RangeError(`invalid AV1 IVF ${name}`); };
    match([68, 75, 73, 70], 'signature'); if (reader.u16() !== 0 || reader.u16() !== 32) throw new RangeError('unsupported IVF version or header size');
    match([65, 86, 48, 49], 'codec');
    const width = reader.u16(), height = reader.u16(); frameDimensions(width, height);
    const frameRate = integer(reader.u32(), 1, 30, 'frameRate'); if (reader.u32() !== 1) throw new RangeError('unsupported AV1 IVF timebase');
    const count = integer(reader.u32(), 1, Math.min(MAX_FRAMES, Math.floor(MAX_CONTAINER_BYTES / (width * height * 4))), 'frameCount');
    if (reader.u32() !== 0) throw new RangeError('nonzero IVF reserved field');
    const frames = [];
    for (let i = 0; i < count; i++) {
        const length = integer(reader.u32(), 1, MAX_PACKET_BYTES, 'frame length'), ticks = reader.u32();
        if (reader.u32() !== 0 || ticks !== i) throw new RangeError('unsupported AV1 IVF timestamp sequence');
        const decoded = decodeAV1PaletteFrame(reader.data(length));
        if (decoded.width !== width || decoded.height !== height) throw new RangeError('AV1 IVF and coded frame dimensions differ');
        frames.push({ ...decoded, timestampUs: Math.round(ticks * 1_000_000 / frameRate) });
    }
    reader.end();
    return { metadata: { width, height, frameRate, durationUs: Math.round(count * 1_000_000 / frameRate), mode: 'av1-palette-intra', monochrome: true, paletteSize: 2, tileSize: SIZE, audio: null }, frames };
}
