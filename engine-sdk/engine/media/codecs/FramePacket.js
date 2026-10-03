// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { crc32 } from '../../core/math/ChecksumMath.js';
import { byteView, dimensions, integer, timestamp, Reader, Writer, MAX_PACKET_BYTES } from './Binary.js';
import { encodeLosslessFrame, decodeLosslessFrame } from './LosslessCodec.js';
import { encodeLossyFrame, decodeLossyFrame } from './LossyCodec.js';

export const VIDEO_PACKET_MAGIC = 0x31465250; // PRF1, little endian.
export const AUDIO_PACKET_MAGIC = 0x31415250; // PRA1.
const VIDEO_HEADER_BYTES = 36;

export function parseVideoPacket(value) {
    const reader = new Reader(value);
    if (reader.u32() !== VIDEO_PACKET_MAGIC || reader.u8() !== 1) throw new RangeError('unsupported video packet format');
    const codec = reader.u8(), flags = reader.u8(), reserved = reader.u8();
    if (codec > 1 || flags > 1 || reserved) throw new RangeError('unsupported video packet flags');
    const width = reader.u16(), height = reader.u16(), frameRate = reader.u16(), quantization = reader.u16();
    dimensions(width, height); integer(frameRate, 1, 30, 'frameRate');
    if (codec) integer(quantization, 1, 64, 'quantization');
    else if (quantization) throw new RangeError('lossless packet cannot contain a quantizer');
    const sequence = reader.u32(), timestampUs = timestamp(reader.f64()), length = reader.u32(), checksum = reader.u32();
    const payload = reader.data(length); reader.end();
    if (crc32(payload, crc32(reader.bytes.subarray(0, 32))) !== checksum) throw new RangeError('video packet CRC mismatch');
    return { width, height, frameRate, quantization, sequence, timestampUs, keyframe: !!flags, mode: codec ? 'lossy' : 'lossless', payload };
}

export class FrameEncoder {
    constructor({ width = 640, height = 360, frameRate = 24, mode = 'lossless', quantization = 12 } = {}) {
        dimensions(width, height); integer(frameRate, 1, 30, 'frameRate');
        if (!['lossless', 'lossy'].includes(mode)) throw new RangeError('unknown authored video codec');
        if (mode === 'lossy') integer(quantization, 1, 64, 'quantization');
        Object.assign(this, { width, height, frameRate, mode, quantization: mode === 'lossy' ? quantization : 0 });
        this.reset();
    }
    reset() { this.reference = null; this.lastSequence = -1; this.lastTimestamp = -1; this.lastKeyTimestamp = -1; }
    encode(rgba, timestampUs, options = {}) { return this.encodePacket(rgba, { ...options, timestampUs }); }
    encodePacket(rgba, { timestampUs = 0, sequence = this.lastSequence + 1, forceKeyframe = false } = {}) {
        timestamp(timestampUs); integer(sequence, 0, 0xffffffff, 'sequence');
        if (timestampUs <= this.lastTimestamp) throw new RangeError('video timestamps must increase');
        const keyframe = forceKeyframe || !this.reference || timestampUs - this.lastKeyTimestamp >= 2_000_000 || sequence !== this.lastSequence + 1;
        let payload, nextReference;
        if (this.mode === 'lossless') {
            payload = encodeLosslessFrame(rgba, this.width, this.height, this.reference, keyframe); nextReference = byteView(rgba).slice();
        } else {
            const encoded = encodeLossyFrame(rgba, this.width, this.height, this.reference, keyframe, this.quantization);
            payload = encoded.payload; nextReference = encoded.reference;
        }
        const writer = new Writer();
        writer.u32(VIDEO_PACKET_MAGIC); writer.u8(1); writer.u8(this.mode === 'lossy' ? 1 : 0); writer.u8(keyframe ? 1 : 0); writer.u8(0);
        writer.u16(this.width); writer.u16(this.height); writer.u16(this.frameRate); writer.u16(this.quantization);
        writer.u32(sequence); writer.f64(timestampUs); writer.u32(payload.length); writer.u32(0); writer.data(payload);
        const bytes = writer.finish(), view = new DataView(bytes.buffer);
        view.setUint32(32, crc32(bytes.subarray(VIDEO_HEADER_BYTES), crc32(bytes.subarray(0, 32))), true);
        this.reference = nextReference; this.lastSequence = sequence; this.lastTimestamp = timestampUs;
        if (keyframe) this.lastKeyTimestamp = timestampUs;
        return bytes;
    }
}

export class FrameDecoder {
    constructor() { this.reset(); }
    reset() { this.reference = null; this.config = null; this.lastSequence = -1; this.lastTimestamp = -1; this.lastKeyTimestamp = -1; }
    decode(bytes) { return this.decodePacket(bytes); }
    decodePacket(value) {
        try {
            const packet = parseVideoPacket(value);
            const config = `${packet.width}:${packet.height}:${packet.mode}:${packet.quantization}:${packet.frameRate}`;
            if (!packet.keyframe && (!this.reference || config !== this.config || packet.sequence !== this.lastSequence + 1)) throw new RangeError('keyframe-required: missing or incompatible video reference');
            if (packet.timestampUs <= this.lastTimestamp) throw new RangeError('video timestamps must increase');
            if (!packet.keyframe && packet.timestampUs - this.lastKeyTimestamp >= 2_000_000) throw new RangeError('keyframe-required: v1 keyframe interval exceeds two seconds');
            let rgba, nextReference;
            if (packet.mode === 'lossless') {
                rgba = decodeLosslessFrame(packet.payload, packet.width, packet.height, this.reference, packet.keyframe); nextReference = rgba.slice();
            } else {
                const decoded = decodeLossyFrame(packet.payload, packet.width, packet.height, this.reference, packet.keyframe, packet.quantization);
                rgba = decoded.rgba; nextReference = decoded.reference;
            }
            this.reference = nextReference; this.config = config; this.lastSequence = packet.sequence; this.lastTimestamp = packet.timestampUs;
            if (packet.keyframe) this.lastKeyTimestamp = packet.timestampUs;
            const { payload, ...metadata } = packet;
            return { ...metadata, rgba };
        } catch (error) { this.reset(); throw error; }
    }
}

function pcmSamples(samples) {
    if (!(samples instanceof Int16Array)) throw new TypeError('PCM16 samples must be an Int16Array');
    return samples;
}

export function encodeAudioPacket({ samples, sampleRate = 48000, channels = 2, timestampUs = 0, sequence = 0 } = {}) {
    pcmSamples(samples); integer(sampleRate, 8000, 192000, 'sampleRate'); integer(channels, 1, 2, 'channels');
    timestamp(timestampUs); integer(sequence, 0, 0xffffffff, 'sequence');
    if (!samples.length || samples.length % channels) throw new RangeError('PCM16 samples must contain whole sample frames');
    const writer = new Writer();
    writer.u32(AUDIO_PACKET_MAGIC); writer.u8(1); writer.u8(channels); writer.u16(16);
    writer.u32(sampleRate); writer.u32(sequence); writer.f64(timestampUs); writer.u32(samples.length); writer.u32(0);
    for (const sample of samples) writer.i16(sample);
    const bytes = writer.finish();
    new DataView(bytes.buffer).setUint32(28, crc32(bytes.subarray(32), crc32(bytes.subarray(0, 28))), true);
    return bytes;
}

export function decodeAudioPacket(value) {
    const reader = new Reader(value, MAX_PACKET_BYTES);
    if (reader.u32() !== AUDIO_PACKET_MAGIC || reader.u8() !== 1) throw new RangeError('unsupported audio packet format');
    const channels = integer(reader.u8(), 1, 2, 'channels');
    if (reader.u16() !== 16) throw new RangeError('unsupported audio sample format');
    const sampleRate = integer(reader.u32(), 8000, 192000, 'sampleRate'), sequence = reader.u32(), timestampUs = timestamp(reader.f64());
    const count = reader.u32(), checksum = reader.u32();
    if (!count || count % channels || count * 2 !== reader.bytes.length - 32) throw new RangeError('invalid PCM16 sample count');
    if (crc32(reader.bytes.subarray(32), crc32(reader.bytes.subarray(0, 28))) !== checksum) throw new RangeError('audio packet CRC mismatch');
    const samples = new Int16Array(count); for (let i = 0; i < count; i++) samples[i] = reader.i16(); reader.end();
    return { samples, sampleRate, channels, timestampUs, sequence };
}
