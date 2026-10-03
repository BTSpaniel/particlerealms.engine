// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// Authored ISO/IEC 11172-2 / ITU-T H.262 elementary-stream subset. All pictures
// are progressive I pictures, each 8x8 block contains its DC coefficient only.
// This is intentionally coarse compression, not a general MPEG decoder.
// VLC codes are normative H.262 Annex B tables B.12/B.13 (also MPEG-1).
import { byteView, dimensions, integer, Writer, MAX_CONTAINER_BYTES, MAX_FRAMES } from './Binary.js';
import { Bits, ReadBits } from './Bitstream.js';

const LUMA_DC = ['100','00','01','101','110','1110','11110','111110','1111110','11111110','111111110','111111111'];
const CHROMA_DC = ['00','01','10','110','1110','11110','111110','1111110','11111110','111111110','1111111110','1111111111'];
const RATES = [0, 24000 / 1001, 24, 25, 30000 / 1001, 30, 50, 60000 / 1001, 60];
const clamp = value => Math.max(0, Math.min(255, value));
function requireTool(condition, name) { if (!condition) throw new RangeError(`unsupported MPEG tool: ${name}; authored subset supports progressive DC-only I pictures`); }
function code(bits, value) { for (const bit of value) bits.bit(bit === '1'); }
function unit(writer, identifier, bits = null) { writer.data(Uint8Array.of(0, 0, 1, identifier)); if (bits) writer.data(bits.finish(false)); }

export function rgbaToMpeg420(value, width, height) {
    const rgba = byteView(value); if (rgba.length !== dimensions(width, height) || width % 2 || height % 2) throw new RangeError('MPEG requires an even-sized RGBA picture');
    const cw = width / 2, ch = height / 2, planes = [new Uint8Array(width * height), new Uint8Array(cw * ch), new Uint8Array(cw * ch)];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 4; if (rgba[at + 3] !== 255) throw new RangeError('MPEG 4:2:0 requires opaque input');
        planes[0][y * width + x] = 16 + ((66 * rgba[at] + 129 * rgba[at + 1] + 25 * rgba[at + 2] + 128) >> 8);
    }
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        let cb = 0, cr = 0;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
            const at = ((y * 2 + dy) * width + x * 2 + dx) * 4;
            cb += 128 + ((-38 * rgba[at] - 74 * rgba[at + 1] + 112 * rgba[at + 2] + 128) >> 8);
            cr += 128 + ((112 * rgba[at] - 94 * rgba[at + 1] - 18 * rgba[at + 2] + 128) >> 8);
        }
        planes[1][y * cw + x] = (cb + 2) >> 2; planes[2][y * cw + x] = (cr + 2) >> 2;
    }
    return planes;
}

export function mpeg420ToRgba(planes, width, height) {
    const rgba = new Uint8Array(dimensions(width, height)), cw = width / 2;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 4, chroma = Math.floor(y / 2) * cw + Math.floor(x / 2), luma = planes[0][y * width + x] - 16, cb = planes[1][chroma] - 128, cr = planes[2][chroma] - 128;
        rgba[at] = clamp((298 * luma + 409 * cr + 128) >> 8); rgba[at + 1] = clamp((298 * luma - 100 * cb - 208 * cr + 128) >> 8); rgba[at + 2] = clamp((298 * luma + 516 * cb + 128) >> 8); rgba[at + 3] = 255;
    }
    return rgba;
}

function blockMean(plane, width, height, bx, by) {
    let sum = 0;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) sum += plane[Math.min(height - 1, by + y) * width + Math.min(width - 1, bx + x)];
    return (sum + 32) >> 6;
}

function writeDc(bits, difference, luma) {
    const size = difference === 0 ? 0 : Math.floor(Math.log2(Math.abs(difference))) + 1;
    code(bits, (luma ? LUMA_DC : CHROMA_DC)[size]);
    if (size) bits.bits(difference > 0 ? difference : 2 ** size - 1 + difference, size);
    code(bits, '10'); // Table B.14 dct_coefficients EOB, intra_vlc_format=0.
}

function sequenceHeader(writer, width, height, frameRate, standard) {
    const bits = new Bits(); bits.bits(width, 12); bits.bits(height, 12); bits.bits(1, 4); bits.bits(RATES.indexOf(frameRate), 4);
    bits.bits(50000, 18); bits.bit(1); bits.bits(112, 10); bits.bit(0); bits.bit(0); bits.bit(0); unit(writer, 0xb3, bits); // 20 Mbit/s covers worst DC entropy at 720p30.
    if (standard === 'mpeg2') {
        const extension = new Bits(); extension.bits(1, 4); extension.bits(0x46, 8); // Main Profile @ High-1440 Level, permitting 720p30.
        extension.bit(1); extension.bits(1, 2); extension.bits(0, 2); extension.bits(0, 2); extension.bits(0, 12); extension.bit(1); extension.bits(0, 8); extension.bit(1); extension.bits(0, 2); extension.bits(0, 5); unit(writer, 0xb5, extension);
        const display = new Bits(); display.bits(2, 4); display.bits(5, 3); display.bit(1); display.bits(5, 8); display.bits(5, 8); display.bits(5, 8); display.bits(width, 14); display.bit(1); display.bits(height, 14); unit(writer, 0xb5, display);
    }
}

function writePicture(writer, rgba, width, height, sequence, standard) {
    const planes = rgbaToMpeg420(rgba, width, height), mw = Math.ceil(width / 16), mh = Math.ceil(height / 16), cw = width / 2, ch = height / 2;
    const header = new Bits(); header.bits(sequence % 1024, 10); header.bits(1, 3); header.bits(0xffff, 16); header.bit(0); unit(writer, 0, header);
    if (standard === 'mpeg2') {
        const extension = new Bits(); extension.bits(8, 4); for (let i = 0; i < 4; i++) extension.bits(15, 4);
        extension.bits(0, 2); extension.bits(3, 2); extension.bit(0); extension.bit(1); extension.bit(0); extension.bit(0); extension.bit(0); extension.bit(0); extension.bit(0); extension.bit(1); extension.bit(1); extension.bit(0); unit(writer, 0xb5, extension);
    }
    for (let my = 0; my < mh; my++) {
        const bits = new Bits(), predictor = [128, 128, 128]; bits.bits(8, 5); bits.bit(0);
        for (let mx = 0; mx < mw; mx++) {
            bits.bit(1); bits.bit(1); // address increment 1; I macroblock type intra, no quantizer change.
            for (let block = 0; block < 6; block++) {
                const p = block < 4 ? 0 : block - 3, w = p ? cw : width, h = p ? ch : height;
                const x = p ? mx * 8 : mx * 16 + (block % 2) * 8, y = p ? my * 8 : my * 16 + Math.floor(block / 2) * 8;
                const dc = blockMean(planes[p], w, h, x, y); writeDc(bits, dc - predictor[p], !p); predictor[p] = dc;
            }
        }
        unit(writer, my + 1, bits);
    }
}

export function encodeMpegIntra({ width, height, frameRate = 24, frames, standard = 'mpeg1' } = {}) {
    dimensions(width, height); requireTool(standard === 'mpeg1' || standard === 'mpeg2', 'standard');
    requireTool(width % 2 === 0 && height % 2 === 0, 'odd 4:2:0 dimensions'); requireTool([24, 25, 30].includes(frameRate), 'frame rate');
    if (!Array.isArray(frames)) throw new TypeError('MPEG frames must be an array'); integer(frames.length, 1, MAX_FRAMES, 'frameCount');
    const writer = new Writer(MAX_CONTAINER_BYTES); sequenceHeader(writer, width, height, frameRate, standard);
    frames.forEach((frame, index) => writePicture(writer, frame.rgba ?? frame.data ?? frame, width, height, index, standard)); unit(writer, 0xb7); return writer.finish();
}
export const encodeMpeg1Intra = options => encodeMpegIntra({ ...options, standard: 'mpeg1' });
export const encodeMpeg2Intra = options => encodeMpegIntra({ ...options, standard: 'mpeg2' });

function units(value) {
    const bytes = byteView(value); if (bytes.length > MAX_CONTAINER_BYTES) throw new RangeError('MPEG input exceeds byte limit');
    const starts = [];
    for (let i = 0; i < bytes.length - 3; i++) if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1) { starts.push(i); i += 3; if (starts.length > MAX_FRAMES * 47 + 4) throw new RangeError('MPEG unit count exceeds bounds'); }
    if (!starts.length || starts[0] !== 0 || starts.length > MAX_FRAMES * 47 + 4) throw new RangeError('invalid/bounded MPEG elementary stream');
    return starts.map((start, i) => ({ identifier: bytes[start + 3], bits: new ReadBits(bytes.subarray(start + 4, starts[i + 1] ?? bytes.length)) }));
}

function readSequence(bits) {
    const width = bits.bits(12), height = bits.bits(12); dimensions(width, height); requireTool(!(width % 2 || height % 2), 'odd 4:2:0 dimensions');
    requireTool(bits.bits(4) === 1, 'pixel aspect ratio'); const frameRate = RATES[bits.bits(4)]; requireTool([24, 25, 30].includes(frameRate), 'frame rate');
    requireTool(bits.bits(18) === 50000 && bits.bit() === 1 && bits.bits(10) === 112 && bits.bit() === 0, 'bitrate/VBV/constrained parameters');
    requireTool(bits.bit() === 0 && bits.bit() === 0, 'custom quantization matrices'); bits.zeroEnd();
    return { width, height, frameRate, mw: Math.ceil(width / 16), mh: Math.ceil(height / 16), standard: 'mpeg1' };
}

function readExtension(bits, config, picture) {
    const identifier = bits.bits(4);
    if (identifier === 1) {
        requireTool(!picture && config.standard === 'mpeg1', 'sequence extension ordering');
        requireTool(bits.bits(8) === 0x46 && bits.bit() === 1 && bits.bits(2) === 1 && bits.bits(2) === 0 && bits.bits(2) === 0 && bits.bits(12) === 0 && bits.bit() === 1 && bits.bits(8) === 0 && bits.bit() === 1 && bits.bits(2) === 0 && bits.bits(5) === 0, 'Main@High1440 progressive 4:2:0 sequence extension'); config.standard = 'mpeg2';
    } else if (identifier === 2) {
        requireTool(!picture && config.standard === 'mpeg2' && !config.display, 'display extension ordering');
        requireTool(bits.bits(3) === 5 && bits.bit() === 1 && bits.bits(8) === 5 && bits.bits(8) === 5 && bits.bits(8) === 5 && bits.bits(14) === config.width && bits.bit() === 1 && bits.bits(14) === config.height, 'BT.601 display extension'); config.display = true;
    } else if (identifier === 8) {
        requireTool(picture && config.standard === 'mpeg2' && !picture.extension && picture.rows === 0, 'picture coding extension ordering');
        for (let i = 0; i < 4; i++) requireTool(bits.bits(4) === 15, 'motion f_code');
        requireTool(bits.bits(2) === 0 && bits.bits(2) === 3 && bits.bit() === 0 && bits.bit() === 1 && bits.bit() === 0 && bits.bit() === 0 && bits.bit() === 0 && bits.bit() === 0 && bits.bit() === 0 && bits.bit() === 1 && bits.bit() === 1 && bits.bit() === 0, 'progressive DC-precision-8 picture coding extension'); picture.extension = true;
    } else requireTool(false, `extension ${identifier}`);
    bits.zeroEnd();
}

function readDc(bits, luma) {
    const table = luma ? LUMA_DC : CHROMA_DC; let code = '', size = -1;
    for (let i = 0; i < 10 && size < 0; i++) { code += bits.bit(); size = table.indexOf(code); }
    requireTool(size >= 0 && size <= 8, 'DC differential precision');
    let difference = size ? bits.bits(size) : 0; if (size && difference < 2 ** (size - 1)) difference -= 2 ** size - 1;
    requireTool(bits.bits(2) === 2, 'AC coefficients'); return difference;
}

function readSlice(bits, row, config, picture) {
    const { width, height, mw } = config, cw = width / 2, ch = height / 2;
    requireTool(row === picture.rows && row < config.mh && (config.standard === 'mpeg1' || picture.extension), 'missing/duplicate/out-of-order slice or picture extension');
    requireTool(bits.bits(5) === 8 && bits.bit() === 0, 'slice quantizer/extension'); const predictor = [128, 128, 128];
    for (let mx = 0; mx < mw; mx++) {
        requireTool(bits.bit() === 1 && bits.bit() === 1, 'skipped/non-intra/quantized macroblock');
        for (let block = 0; block < 6; block++) {
            const p = block < 4 ? 0 : block - 3, w = p ? cw : width, h = p ? ch : height;
            const x = p ? mx * 8 : mx * 16 + (block % 2) * 8, y = p ? row * 8 : row * 16 + Math.floor(block / 2) * 8;
            const dc = integer(predictor[p] + readDc(bits, !p), 0, 255, 'MPEG DC coefficient'); predictor[p] = dc;
            // DC inverse DCT is constant. MPEG-2 mismatch-control adds AC(7,7)=1;
            // its contribution is less than 0.25 everywhere and rounds to zero.
            for (let dy = 0; dy < Math.min(8, h - y); dy++) picture.planes[p].fill(dc, (y + dy) * w + x, (y + dy) * w + Math.min(w, x + 8));
        }
    }
    bits.zeroEnd(); picture.rows++;
}

export function decodeMpegIntra(value, { standard = null } = {}) {
    let config = null, picture = null, ended = false; const frames = [];
    function finishPicture() {
        if (!picture) return;
        requireTool(picture.rows === config.mh, 'incomplete picture'); const rgba = mpeg420ToRgba(picture.planes, config.width, config.height);
        frames.push({ rgba, planes: picture.planes, index: frames.length, timestampUs: Math.round(frames.length * 1_000_000 / config.frameRate), keyframe: true, width: config.width, height: config.height }); picture = null;
    }
    for (const entry of units(value)) {
        const { identifier, bits } = entry; requireTool(!ended, 'data after sequence end');
        if (identifier === 0xb3) { requireTool(!config, 'sequence reconfiguration'); config = readSequence(bits); }
        else if (identifier === 0xb5) { requireTool(config, 'extension before sequence'); readExtension(bits, config, picture); }
        else if (identifier === 0) {
            requireTool(config, 'picture before sequence'); finishPicture(); requireTool(bits.bits(10) === frames.length % 1024 && bits.bits(3) === 1 && bits.bits(16) === 0xffff && bits.bit() === 0, 'picture type/timing/VBV/extension'); bits.zeroEnd();
            if (frames.length >= MAX_FRAMES || (frames.length + 1) * dimensions(config.width, config.height) * 1.375 > MAX_CONTAINER_BYTES) throw new RangeError('MPEG decoded output exceeds byte limit');
            picture = { rows: 0, extension: false, planes: [new Uint8Array(config.width * config.height), new Uint8Array(config.width * config.height / 4), new Uint8Array(config.width * config.height / 4)] };
        } else if (identifier >= 1 && identifier <= 0xaf) { requireTool(config && picture, 'slice before picture'); readSlice(bits, identifier - 1, config, picture); }
        else if (identifier === 0xb7) { finishPicture(); requireTool(config && frames.length && bits.bytes.length === 0, 'sequence end'); ended = true; }
        else requireTool(false, `start code ${identifier}`);
    }
    requireTool(ended && frames.length && (!standard || config.standard === standard), 'missing sequence end or codec mismatch');
    return { metadata: { width: config.width, height: config.height, frameRate: config.frameRate, mode: `${config.standard}-dc-intra`, durationUs: Math.round(frames.length * 1_000_000 / config.frameRate), colorSpace: 'limited BT.601' }, frames };
}
export const decodeMpeg1Intra = bytes => decodeMpegIntra(bytes, { standard: 'mpeg1' });
export const decodeMpeg2Intra = bytes => decodeMpegIntra(bytes, { standard: 'mpeg2' });
