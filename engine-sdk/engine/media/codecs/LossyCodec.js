// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// PRV lossy v1: integer Walsh-Hadamard 8x8 transform, scalar quantization,
// sparse coefficient runs, and bounded motion prediction from RECONSTRUCTED planes.
// This is an authored format, not H.264, MPEG, AV1, or the native WebCodecs API.
import { lossyZigZagIndices } from '../../core/math/LossyCompressionMath.js';
import { byteView, dimensions, integer, Reader, Writer } from './Binary.js';

const ORDER = lossyZigZagIndices(8, 8);
const clamp = value => Math.max(0, Math.min(255, value));
const roundDivide = (value, divisor) => value < 0 ? -Math.floor((-value + divisor / 2) / divisor) : Math.floor((value + divisor / 2) / divisor);

export function integerTransform8x8(values) {
    if (!values || values.length !== 64) throw new RangeError('transform requires 64 samples');
    const result = Int32Array.from(values);
    for (let step = 1; step < 8; step *= 2) {
        for (let row = 0; row < 8; row++) for (let group = 0; group < 8; group += step * 2) for (let j = 0; j < step; j++) {
            const a = row * 8 + group + j, b = a + step, x = result[a], y = result[b];
            result[a] = x + y; result[b] = x - y;
        }
    }
    for (let step = 1; step < 8; step *= 2) {
        for (let col = 0; col < 8; col++) for (let group = 0; group < 8; group += step * 2) for (let j = 0; j < step; j++) {
            const a = (group + j) * 8 + col, b = a + step * 8, x = result[a], y = result[b];
            result[a] = x + y; result[b] = x - y;
        }
    }
    return result;
}

function shapes(width, height) {
    return [[width, height], [Math.ceil(width / 2), Math.ceil(height / 2)], [Math.ceil(width / 2), Math.ceil(height / 2)]];
}

export function rgbaTo420(value, width, height) {
    const rgba = byteView(value);
    if (rgba.length !== dimensions(width, height)) throw new RangeError('RGBA frame size mismatch');
    const cw = Math.ceil(width / 2), ch = Math.ceil(height / 2);
    const planes = [new Uint8Array(width * height), new Uint8Array(cw * ch), new Uint8Array(cw * ch)];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 4, r = rgba[at], g = rgba[at + 1], b = rgba[at + 2];
        if (rgba[at + 3] !== 255) throw new RangeError('lossy SDR 4:2:0 requires opaque RGBA input');
        planes[0][y * width + x] = (54 * r + 183 * g + 19 * b + 128) >> 8;
    }
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        let cb = 0, cr = 0;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
            const at = (Math.min(height - 1, y * 2 + dy) * width + Math.min(width - 1, x * 2 + dx)) * 4;
            cb += clamp(((-29 * rgba[at] - 99 * rgba[at + 1] + 128 * rgba[at + 2] + 128) >> 8) + 128);
            cr += clamp(((128 * rgba[at] - 116 * rgba[at + 1] - 12 * rgba[at + 2] + 128) >> 8) + 128);
        }
        planes[1][y * cw + x] = (cb + 2) >> 2; planes[2][y * cw + x] = (cr + 2) >> 2;
    }
    return planes;
}

export function planes420ToRgba(planes, width, height) {
    const rgba = new Uint8Array(dimensions(width, height)), cw = Math.ceil(width / 2);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const luma = planes[0][y * width + x], at = (y * width + x) * 4, chroma = Math.floor(y / 2) * cw + Math.floor(x / 2);
        const cb = planes[1][chroma] - 128, cr = planes[2][chroma] - 128;
        rgba[at] = clamp(luma + ((403 * cr + 128) >> 8));
        rgba[at + 1] = clamp(luma - ((48 * cb + 120 * cr + 128) >> 8));
        rgba[at + 2] = clamp(luma + ((475 * cb + 128) >> 8)); rgba[at + 3] = 255;
    }
    return rgba;
}

function sample(plane, width, height, x, y) {
    return plane[Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))];
}

function prediction(reference, width, height, x, y, mx, my) {
    const output = new Int32Array(64);
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
        output[row * 8 + col] = reference ? sample(reference, width, height, x + col + mx, y + row + my) : 128;
    }
    return output;
}

function writeBlock(plane, width, height, x, y, values) {
    for (let row = 0; row < Math.min(8, height - y); row++) for (let col = 0; col < Math.min(8, width - x); col++) plane[(y + row) * width + x + col] = clamp(values[row * 8 + col]);
}

function chooseMotion(source, previous, width, height, x, y) {
    let best = Infinity, mx = 0, my = 0;
    // Zero motion wins ties; all candidates are integer-pixel and clamp at edges.
    for (const [dx, dy] of [[0, 0], [-4, 0], [4, 0], [0, -4], [0, 4], [-2, 0], [2, 0], [0, -2], [0, 2], [-4, -4], [4, -4], [-4, 4], [4, 4]]) {
        let score = 0;
        for (let row = 0; row < 8; row += 2) for (let col = 0; col < 8; col += 2) score += Math.abs(sample(source, width, height, x + col, y + row) - sample(previous, width, height, x + col + dx, y + row + dy));
        if (score < best) { best = score; mx = dx; my = dy; }
    }
    return [mx, my];
}

export function encodeLossyFrame(value, width, height, reference = null, keyframe = false, quantization = 12) {
    integer(quantization, 1, 64, 'quantization');
    const planes = rgbaTo420(value, width, height), shape = shapes(width, height), reconstructed = [], writer = new Writer();
    const step = quantization * 8;
    for (let p = 0; p < 3; p++) {
        const [pw, ph] = shape[p], plane = planes[p], previous = keyframe ? null : reference?.[p], result = new Uint8Array(pw * ph);
        if (previous && previous.length !== result.length) throw new RangeError('reference plane size mismatch');
        for (let y = 0; y < ph; y += 8) for (let x = 0; x < pw; x += 8) {
            const motion = previous ? chooseMotion(plane, previous, pw, ph, x, y) : [0, 0];
            const predicted = prediction(previous, pw, ph, x, y, ...motion), residual = new Int32Array(64), source = new Uint8Array(64);
            for (let i = 0; i < 64; i++) { source[i] = sample(plane, pw, ph, x + i % 8, y + Math.floor(i / 8)); residual[i] = source[i] - predicted[i]; }
            const transformed = integerTransform8x8(residual), coefficients = new Int32Array(64), entries = [];
            for (let i = 0; i < 64; i++) {
                const coefficient = roundDivide(transformed[ORDER[i]], step);
                coefficients[ORDER[i]] = coefficient * step;
                if (coefficient) entries.push([i, coefficient]);
            }
            if (entries.length * 3 + (previous ? 4 : 2) >= 65) { writer.u8(3); writer.data(source); writeBlock(result, pw, ph, x, y, source); continue; }
            if (previous && entries.length === 0 && motion[0] === 0 && motion[1] === 0) writer.u8(0);
            else {
                writer.u8(previous ? 2 : 1);
                if (previous) { writer.i8(motion[0]); writer.i8(motion[1]); }
                writer.u8(entries.length);
                let last = -1;
                for (const [index, coefficient] of entries) { writer.u8(index - last - 1); writer.i16(coefficient); last = index; }
            }
            const inverse = integerTransform8x8(coefficients);
            for (let i = 0; i < 64; i++) predicted[i] += roundDivide(inverse[i], 64);
            writeBlock(result, pw, ph, x, y, predicted);
        }
        reconstructed.push(result);
    }
    return { payload: writer.finish(), reference: reconstructed };
}

export function decodeLossyFrame(payload, width, height, reference = null, keyframe = false, quantization = 12) {
    dimensions(width, height); integer(quantization, 1, 64, 'quantization');
    const reader = new Reader(payload), reconstructed = [], shape = shapes(width, height);
    for (let p = 0; p < 3; p++) {
        const [pw, ph] = shape[p], previous = keyframe ? null : reference?.[p], result = new Uint8Array(pw * ph);
        if (previous && previous.length !== result.length) throw new RangeError('reference plane size mismatch');
        for (let y = 0; y < ph; y += 8) for (let x = 0; x < pw; x += 8) {
            const mode = reader.u8();
            if (mode === 3) { writeBlock(result, pw, ph, x, y, reader.data(64)); continue; }
            if (mode > 2 || ((mode === 0 || mode === 2) && !previous)) throw new RangeError('lossy prediction requires a reference frame');
            const mx = mode === 2 ? reader.i8() : 0, my = mode === 2 ? reader.i8() : 0;
            if (Math.abs(mx) > 4 || Math.abs(my) > 4) throw new RangeError('motion vector exceeds v1 bounds');
            const predicted = prediction(mode === 1 ? null : previous, pw, ph, x, y, mx, my), coefficients = new Int32Array(64);
            if (mode !== 0) {
                const count = reader.u8(); if (count > 64) throw new RangeError('too many block coefficients');
                let index = -1;
                for (let i = 0; i < count; i++) {
                    index += reader.u8() + 1;
                    const coefficient = reader.i16();
                    if (index > 63 || Math.abs(coefficient) > Math.ceil(16320 / (quantization * 8)) || coefficient === 0) throw new RangeError('invalid transform coefficient');
                    coefficients[ORDER[index]] = coefficient * quantization * 8;
                }
            }
            const inverse = integerTransform8x8(coefficients);
            for (let i = 0; i < 64; i++) predicted[i] += roundDivide(inverse[i], 64);
            writeBlock(result, pw, ph, x, y, predicted);
        }
        reconstructed.push(result);
    }
    reader.end();
    return { rgba: planes420ToRgba(reconstructed, width, height), reference: reconstructed };
}
