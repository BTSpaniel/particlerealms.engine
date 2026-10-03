// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// Independently authored H.264 Constrained Baseline subset: progressive 8-bit
// 4:2:0, one all-I_PCM IDR slice per picture, no entropy-coded residuals,
// no prediction, no FMO, and deblocking disabled. This valid standards subset
// is deliberately uncompressed; it is NOT a general H.264 decoder.
import { byteView, dimensions, integer, Writer, MAX_CONTAINER_BYTES, MAX_FRAMES } from './Binary.js';
import { rgbaTo420, planes420ToRgba } from './LossyCodec.js';
import { Bits, ReadBits } from './Bitstream.js';

// Baseline VCL MaxBR from H.264 table A-1. I_PCM is uncompressed; a level
// admitting the frame dimensions can still have an insufficient bit-rate cap.
const LEVEL_BITRATES = Object.freeze({ 31: 14_000_000, 50: 135_000_000, 51: 240_000_000, 61: 480_000_000, 62: 800_000_000 });
export function h264PcmLevel(width, height, frameRate) {
    dimensions(width, height); integer(frameRate, 1, 30, 'frameRate');
    // Each macroblock has 384 PCM bytes plus <=2 bytes type/alignment. Include
    // 64 slice-header bytes, maximal 50% emulation-prevention growth, and 256
    // bytes for start codes/parameter sets. This is deliberately conservative.
    const bitRate = (Math.ceil((Math.ceil(width / 16) * Math.ceil(height / 16) * 386 + 64) * 1.5) + 256) * frameRate * 8;
    const levelIdc = [31, 50, 51, 61, 62].find(level => bitRate <= LEVEL_BITRATES[level]);
    if (!levelIdc) throw new RangeError('I_PCM worst-case bitrate exceeds supported H.264 levels');
    return { levelIdc, level: (levelIdc / 10).toFixed(1), maximumBitRate: LEVEL_BITRATES[levelIdc], worstCaseBitRate: bitRate };
}

function nal(header, rbsp) {
    const writer = new Writer(); writer.data(Uint8Array.of(0, 0, 0, 1, header));
    let zeros = 0;
    for (const byte of rbsp) {
        if (zeros === 2 && byte <= 3) { writer.u8(3); zeros = 0; }
        writer.u8(byte); zeros = byte === 0 ? zeros + 1 : 0;
    }
    return writer.finish();
}

function sequenceParameters(width, height, frameRate) {
    const bits = new Bits(), mw = Math.ceil(width / 16), mh = Math.ceil(height / 16);
    bits.bits(66, 8); bits.bits(0xc0, 8); bits.bits(h264PcmLevel(width, height, frameRate).levelIdc, 8); bits.ue(0); // profile, constraints, conservative level, SPS id.
    bits.ue(0); bits.ue(2); bits.ue(1); bits.bit(0); // frame_num=4 bits; POC type 2; one DPB frame.
    bits.ue(mw - 1); bits.ue(mh - 1); bits.bit(1); bits.bit(1);
    const cropped = mw * 16 !== width || mh * 16 !== height; bits.bit(cropped);
    if (cropped) { bits.ue(0); bits.ue((mw * 16 - width) / 2); bits.ue(0); bits.ue((mh * 16 - height) / 2); }
    bits.bit(1); // VUI: full-range SDR BT.709, fixed frame rate.
    bits.bit(0); bits.bit(0); bits.bit(1); bits.bits(5, 3); bits.bit(1); bits.bit(1); bits.bits(1, 8); bits.bits(1, 8); bits.bits(1, 8);
    bits.bit(0); bits.bit(1); bits.bits(1, 32); bits.bits(frameRate * 2, 32); bits.bit(1);
    bits.bit(0); bits.bit(0); bits.bit(0); bits.bit(0);
    return nal(0x67, bits.finish());
}

function pictureParameters() {
    const bits = new Bits();
    bits.ue(0); bits.ue(0); bits.bit(0); bits.bit(0); bits.ue(0); bits.ue(0); bits.ue(0); bits.bit(0); bits.bits(0, 2);
    bits.se(0); bits.se(0); bits.se(0); bits.bit(1); bits.bit(1); bits.bit(0);
    return nal(0x68, bits.finish());
}

function pcmPicture(rgba, width, height, sequence) {
    const planes = rgbaTo420(rgba, width, height), cw = width / 2, ch = height / 2, bits = new Bits();
    bits.ue(0); bits.ue(7); bits.ue(0); bits.bits(0, 4); bits.ue(sequence % 65536); bits.bit(0); bits.bit(0); bits.se(0); bits.ue(1);
    for (let my = 0; my < Math.ceil(height / 16); my++) for (let mx = 0; mx < Math.ceil(width / 16); mx++) {
        bits.ue(25); bits.align();
        const pcm = new Uint8Array(384);
        for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) pcm[y * 16 + x] = planes[0][Math.min(height - 1, my * 16 + y) * width + Math.min(width - 1, mx * 16 + x)];
        for (let p = 1; p < 3; p++) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) pcm[256 + (p - 1) * 64 + y * 8 + x] = planes[p][Math.min(ch - 1, my * 8 + y) * cw + Math.min(cw - 1, mx * 8 + x)];
        bits.data(pcm);
    }
    return nal(0x65, bits.finish());
}

export function encodeH264Pcm({ width, height, frameRate = 24, frames } = {}) {
    dimensions(width, height); integer(frameRate, 1, 30, 'frameRate');
    if (width % 2 || height % 2) throw new RangeError('H.264 4:2:0 dimensions must be even');
    if (!Array.isArray(frames)) throw new TypeError('H.264 frames must be an array');
    integer(frames.length, 1, MAX_FRAMES, 'frameCount');
    const writer = new Writer(MAX_CONTAINER_BYTES); writer.data(sequenceParameters(width, height, frameRate)); writer.data(pictureParameters());
    frames.forEach((frame, index) => writer.data(pcmPicture(frame.rgba ?? frame.data ?? frame, width, height, index)));
    return writer.finish();
}

function annexBNals(value) {
    const bytes = byteView(value);
    if (bytes.length > MAX_CONTAINER_BYTES) throw new RangeError('H.264 input exceeds byte limit');
    const starts = [];
    for (let i = 0; i < bytes.length - 2; i++) {
        if (bytes[i] !== 0 || bytes[i + 1] !== 0) continue;
        if (bytes[i + 2] === 1) { starts.push([i, i + 3]); i += 2; }
        else if (bytes[i + 2] === 0 && bytes[i + 3] === 1) { starts.push([i, i + 4]); i += 3; }
        if (starts.length > MAX_FRAMES + 2) throw new RangeError('H.264 NAL count exceeds bounds');
    }
    if (!starts.length || starts[0][0] !== 0 || starts.length > MAX_FRAMES + 2) throw new RangeError('invalid/bounded H.264 Annex B stream');
    return starts.map(([start, from], index) => {
        const end = index + 1 < starts.length ? starts[index + 1][0] : bytes.length;
        if (from >= end) throw new RangeError('empty H.264 NAL');
        const header = bytes[from]; if (header & 0x80) throw new RangeError('H.264 forbidden_zero_bit is set');
        const rbsp = new Writer(); let zeros = 0;
        for (let at = from + 1; at < end; at++) {
            const byte = bytes[at];
            if (zeros === 2 && byte === 3) { if (at + 1 >= end || bytes[at + 1] > 3) throw new RangeError('invalid H.264 emulation prevention'); zeros = 0; continue; }
            rbsp.u8(byte); zeros = byte === 0 ? zeros + 1 : 0;
        }
        return { header, type: header & 31, bits: new ReadBits(rbsp.finish()) };
    });
}

function unsupported(condition, tool) { if (condition) throw new RangeError(`unsupported H.264 tool: ${tool}; authored subset supports all-I_PCM IDR only`); }

function readSequence(bits) {
    unsupported(bits.bits(8) !== 66 || bits.bits(8) !== 0xc0, 'profile/constraint flags');
    const levelIdc = bits.bits(8); unsupported(!LEVEL_BITRATES[levelIdc], 'level');
    unsupported(bits.ue() !== 0 || bits.ue() !== 0 || bits.ue() !== 2 || bits.ue() !== 1 || bits.bit() !== 0, 'SPS/POC/reference configuration');
    const mw = bits.ue(79) + 1, mh = bits.ue(44) + 1;
    unsupported(bits.bit() !== 1 || bits.bit() !== 1, 'interlaced picture');
    let right = 0, bottom = 0;
    if (bits.bit()) { unsupported(bits.ue() !== 0, 'left crop'); right = bits.ue(7); unsupported(bits.ue() !== 0, 'top crop'); bottom = bits.ue(7); }
    const width = mw * 16 - right * 2, height = mh * 16 - bottom * 2; dimensions(width, height);
    let frameRate = 24;
    if (bits.bit()) {
        unsupported(bits.bit() !== 0 || bits.bit() !== 0, 'aspect/overscan VUI');
        unsupported(bits.bit() !== 1 || bits.bits(3) !== 5 || bits.bit() !== 1 || bits.bit() !== 1 || bits.bits(8) !== 1 || bits.bits(8) !== 1 || bits.bits(8) !== 1, 'SDR full-range BT.709 VUI');
        unsupported(bits.bit() !== 0 || bits.bit() !== 1, 'chroma/timing VUI');
        const unit = bits.bits(32), scale = bits.bits(32); unsupported(unit !== 1 || scale % 2 || bits.bit() !== 1, 'variable timing'); frameRate = integer(scale / 2, 1, 30, 'frameRate');
        unsupported(bits.bit() !== 0 || bits.bit() !== 0 || bits.bit() !== 0 || bits.bit() !== 0, 'HRD/bitstream restriction');
    }
    unsupported(h264PcmLevel(width, height, frameRate).worstCaseBitRate > LEVEL_BITRATES[levelIdc], 'declared level has insufficient I_PCM bitrate');
    bits.end(); return { width, height, mw, mh, frameRate, levelIdc, level: (levelIdc / 10).toFixed(1) };
}

function readPictureParameters(bits) {
    unsupported(bits.ue() !== 0 || bits.ue() !== 0 || bits.bit() !== 0 || bits.bit() !== 0 || bits.ue() !== 0 || bits.ue() !== 0 || bits.ue() !== 0 || bits.bit() !== 0 || bits.bits(2) !== 0, 'PPS/CABAC/FMO/weighted prediction');
    unsupported(bits.se() !== 0 || bits.se() !== 0 || bits.se() !== 0 || bits.bit() !== 1 || bits.bit() !== 1 || bits.bit() !== 0, 'PPS quantization/deblocking/redundant pictures'); bits.end();
}

function readPcmPicture(bits, config) {
    unsupported(bits.ue() !== 0, 'multiple slices'); const sliceType = bits.ue(); unsupported(sliceType !== 2 && sliceType !== 7, 'non-I slice');
    unsupported(bits.ue() !== 0 || bits.bits(4) !== 0, 'PPS/frame number'); bits.ue();
    unsupported(bits.bit() !== 0 || bits.bit() !== 0 || bits.se() !== 0 || bits.ue() !== 1, 'reference marking/deblocking');
    const { width, height, mw, mh } = config, cw = width / 2, ch = height / 2;
    const planes = [new Uint8Array(width * height), new Uint8Array(cw * ch), new Uint8Array(cw * ch)];
    for (let my = 0; my < mh; my++) for (let mx = 0; mx < mw; mx++) {
        unsupported(bits.ue() !== 25, 'predicted/transform-coded macroblock'); bits.align(); const pcm = bits.data(384);
        for (let y = 0; y < Math.min(16, height - my * 16); y++) for (let x = 0; x < Math.min(16, width - mx * 16); x++) planes[0][(my * 16 + y) * width + mx * 16 + x] = pcm[y * 16 + x];
        for (let p = 1; p < 3; p++) for (let y = 0; y < Math.min(8, ch - my * 8); y++) for (let x = 0; x < Math.min(8, cw - mx * 8); x++) planes[p][(my * 8 + y) * cw + mx * 8 + x] = pcm[256 + (p - 1) * 64 + y * 8 + x];
    }
    bits.end(); return { planes, rgba: planes420ToRgba(planes, width, height), width, height, keyframe: true };
}

export function decodeH264Pcm(bytes) {
    let config = null, pps = false; const frames = [];
    for (const unit of annexBNals(bytes)) {
        if (unit.type === 7) { unsupported(config !== null, 'SPS reconfiguration'); config = readSequence(unit.bits); }
        else if (unit.type === 8) { unsupported(!config || pps, 'PPS ordering'); readPictureParameters(unit.bits); pps = true; }
        else if (unit.type === 5) {
            unsupported(!config || !pps || unit.header !== 0x65, 'missing parameters/IDR reference');
            if ((frames.length + 1) * dimensions(config.width, config.height) * 1.375 > MAX_CONTAINER_BYTES) throw new RangeError('H.264 decoded output exceeds byte limit');
            const frame = readPcmPicture(unit.bits, config); frames.push({ ...frame, index: frames.length, timestampUs: Math.round(frames.length * 1_000_000 / config.frameRate) });
        } else unsupported(true, `NAL type ${unit.type}`);
    }
    if (!frames.length) throw new RangeError('H.264 stream has no pictures');
    return { metadata: { width: config.width, height: config.height, frameRate: config.frameRate, level: config.level, levelIdc: config.levelIdc, mode: 'h264-constrained-baseline-ipcm', durationUs: Math.round(frames.length * 1_000_000 / config.frameRate) }, frames };
}
