// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { byteView, dimensions, Reader, Writer } from './Binary.js';

export const TILE_SIZE = 16;
export const TILE_MODES = Object.freeze({ REUSE: 0, SOLID: 1, PALETTE: 2, RLE: 3, RAW: 4 });
const colorAt = (bytes, at) => (bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16 | bytes[at + 3] << 24) >>> 0;

function tileBytes(rgba, width, x, y, tw, th) {
    const result = new Uint8Array(tw * th * 4);
    for (let row = 0; row < th; row++) result.set(rgba.subarray(((y + row) * width + x) * 4, ((y + row) * width + x + tw) * 4), row * tw * 4);
    return result;
}

function sameTile(tile, reference, width, x, y, tw, th) {
    if (!reference) return false;
    for (let row = 0; row < th; row++) for (let col = 0; col < tw * 4; col++) {
        if (tile[row * tw * 4 + col] !== reference[((y + row) * width + x) * 4 + col]) return false;
    }
    return true;
}

export function encodeLosslessFrame(value, width, height, reference = null, keyframe = false) {
    const rgba = byteView(value), count = dimensions(width, height);
    if (rgba.length !== count || (reference && reference.length !== count)) throw new RangeError('RGBA frame size mismatch');
    const writer = new Writer();
    for (let y = 0; y < height; y += TILE_SIZE) for (let x = 0; x < width; x += TILE_SIZE) {
        const tw = Math.min(TILE_SIZE, width - x), th = Math.min(TILE_SIZE, height - y);
        const tile = tileBytes(rgba, width, x, y, tw, th), pixels = tw * th;
        if (!keyframe && sameTile(tile, reference, width, x, y, tw, th)) { writer.u8(TILE_MODES.REUSE); writer.u16(0); continue; }
        const palette = [], lookup = new Map(), indices = new Uint8Array(pixels), runs = new Writer(2048);
        let runColor = colorAt(tile, 0), runLength = 0;
        for (let i = 0; i < pixels; i++) {
            const color = colorAt(tile, i * 4);
            if (!lookup.has(color)) { lookup.set(color, palette.length); palette.push(color); }
            indices[i] = lookup.get(color);
            if (color !== runColor) { runs.u16(runLength); runs.u32(runColor); runLength = 0; runColor = color; }
            runLength++;
        }
        runs.u16(runLength); runs.u32(runColor);
        let mode = TILE_MODES.RAW, payload = tile;
        if (palette.length === 1) { mode = TILE_MODES.SOLID; payload = tile.subarray(0, 4); }
        else {
            const packed = new Writer(2048); packed.u16(palette.length);
            for (const color of palette) packed.u32(color);
            packed.data(indices);
            const paletteData = packed.finish(), runData = runs.finish();
            if (paletteData.length < payload.length) { mode = TILE_MODES.PALETTE; payload = paletteData; }
            if (runData.length < payload.length) { mode = TILE_MODES.RLE; payload = runData; }
        }
        writer.u8(mode); writer.u16(payload.length); writer.data(payload);
    }
    return writer.finish();
}

export function decodeLosslessFrame(payload, width, height, reference = null, keyframe = false) {
    const count = dimensions(width, height), reader = new Reader(payload);
    if (reference && reference.length !== count) throw new RangeError('reference frame size mismatch');
    const rgba = keyframe || !reference ? new Uint8Array(count) : reference.slice();
    for (let y = 0; y < height; y += TILE_SIZE) for (let x = 0; x < width; x += TILE_SIZE) {
        const tw = Math.min(TILE_SIZE, width - x), th = Math.min(TILE_SIZE, height - y), pixels = tw * th;
        const mode = reader.u8(), tile = new Reader(reader.data(reader.u16()));
        if (mode === TILE_MODES.REUSE) {
            if (keyframe || !reference) throw new RangeError('tile reuse requires a reference frame');
            tile.end(); continue;
        }
        const output = new Uint8Array(pixels * 4), view = new DataView(output.buffer);
        if (mode === TILE_MODES.RAW) output.set(tile.data(output.length));
        else if (mode === TILE_MODES.SOLID) { const color = tile.u32(); for (let i = 0; i < pixels; i++) view.setUint32(i * 4, color, true); }
        else if (mode === TILE_MODES.PALETTE) {
            const size = tile.u16();
            if (size < 2 || size > pixels || size > 256) throw new RangeError('invalid tile palette size');
            const palette = new Uint32Array(size); for (let i = 0; i < size; i++) palette[i] = tile.u32();
            for (let i = 0; i < pixels; i++) { const index = tile.u8(); if (index >= size) throw new RangeError('invalid palette index'); view.setUint32(i * 4, palette[index], true); }
        } else if (mode === TILE_MODES.RLE) {
            let position = 0;
            while (position < pixels) {
                const length = tile.u16(), color = tile.u32();
                if (!length || length > pixels - position) throw new RangeError('invalid tile run length');
                for (let end = position + length; position < end; position++) view.setUint32(position * 4, color, true);
            }
        } else throw new RangeError('unknown tile mode');
        tile.end();
        for (let row = 0; row < th; row++) rgba.set(output.subarray(row * tw * 4, (row + 1) * tw * 4), ((y + row) * width + x) * 4);
    }
    reader.end(); return rgba;
}
