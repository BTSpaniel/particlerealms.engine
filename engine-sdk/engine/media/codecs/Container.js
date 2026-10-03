// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { crc32 } from '../../core/math/ChecksumMath.js';
import { byteView, dimensions, integer, timestamp, Reader, Writer, MAX_CONTAINER_BYTES, MAX_FRAMES } from './Binary.js';
import { FrameEncoder, FrameDecoder, parseVideoPacket } from './FramePacket.js';

export const CONTAINER_MAGIC = 0x31565250; // PRV1.
const HEADER_SIZE = 56, INDEX_SIZE = 24;

export function encodeContainer({ width = 640, height = 360, frameRate = 24, mode = 'lossless', quantization = 12, frames, audio = null } = {}) {
    dimensions(width, height); integer(frameRate, 1, 30, 'frameRate');
    if (!Array.isArray(frames)) throw new TypeError('frames must be an array of RGBA frame inputs');
    integer(frames.length, 1, MAX_FRAMES, 'frameCount');
    const encoder = new FrameEncoder({ width, height, frameRate, mode, quantization }), writer = new Writer(MAX_CONTAINER_BYTES), index = [];
    writer.data(new Uint8Array(HEADER_SIZE));
    let keyframeIndex = 0, lastTimestamp = 0;
    for (let i = 0; i < frames.length; i++) {
        const input = frames[i], timestampUs = input.timestampUs ?? Math.round(i * 1_000_000 / frameRate);
        if (i === 0 && timestampUs !== 0) throw new RangeError('container timeline must start at zero');
        const bytes = encoder.encodePacket(input.rgba ?? input.data ?? input, { timestampUs, sequence: i, forceKeyframe: input.keyframe === true });
        const keyframe = bytes[6] === 1;
        if (keyframe) keyframeIndex = i;
        index.push({ timestampUs, offset: writer.length, length: bytes.length, keyframeIndex, keyframe });
        writer.data(bytes); lastTimestamp = timestampUs;
    }
    const indexOffset = writer.length;
    for (const entry of index) {
        writer.f64(entry.timestampUs); writer.u32(entry.offset); writer.u32(entry.length); writer.u32(entry.keyframeIndex); writer.u32(entry.keyframe ? 1 : 0);
    }
    writer.u32(crc32(writer.bytes.subarray(indexOffset, writer.length)));
    let audioOffset = 0, audioBytes = 0, sampleRate = 0, channels = 0, audioDuration = 0;
    if (audio) {
        if (!(audio.samples instanceof Int16Array)) throw new TypeError('audio.samples must be interleaved PCM16 Int16Array');
        sampleRate = integer(audio.sampleRate, 8000, 192000, 'sampleRate'); channels = integer(audio.channels, 1, 2, 'channels');
        if (!audio.samples.length || audio.samples.length % channels) throw new RangeError('invalid PCM16 sample count');
        audioOffset = writer.length; audioBytes = audio.samples.length * 2;
        writer.reserve(audioBytes + 4);
        for (const sample of audio.samples) writer.i16(sample);
        writer.u32(crc32(writer.bytes.subarray(audioOffset, audioOffset + audioBytes)));
        audioDuration = Math.round(audio.samples.length / channels / sampleRate * 1_000_000);
    }
    const bytes = writer.finish(), view = new DataView(bytes.buffer), durationUs = Math.max(lastTimestamp + Math.round(1_000_000 / frameRate), audioDuration);
    view.setUint32(0, CONTAINER_MAGIC, true); view.setUint8(4, mode === 'lossy' ? 1 : 0); view.setUint8(5, 1); view.setUint16(6, HEADER_SIZE, true);
    view.setUint16(8, width, true); view.setUint16(10, height, true); view.setUint16(12, frameRate, true); view.setUint16(14, encoder.quantization, true);
    view.setUint32(16, frames.length, true); view.setUint32(20, indexOffset, true); view.setUint32(24, audioOffset, true); view.setUint32(28, audioBytes, true);
    view.setUint32(32, sampleRate, true); view.setUint16(36, channels, true); view.setFloat64(40, durationUs, true); view.setUint32(48, bytes.length, true);
    view.setUint32(52, crc32(bytes.subarray(0, 52)), true);
    return bytes;
}

export function decodeContainer(value) {
    const input = byteView(value);
    if (input.length > MAX_CONTAINER_BYTES) throw new RangeError('container exceeds byte limit');
    // Ownership prevents callers from mutating verified headers/index/payloads later.
    const bytes = input.slice(), reader = new Reader(bytes, MAX_CONTAINER_BYTES);
    if (reader.u32() !== CONTAINER_MAGIC) throw new RangeError('not a PRV authored video container');
    const codec = reader.u8();
    if (codec > 1 || reader.u8() !== 1 || reader.u16() !== HEADER_SIZE) throw new RangeError('unsupported PRV container version');
    const width = reader.u16(), height = reader.u16(), frameRate = integer(reader.u16(), 1, 30, 'frameRate'), quantization = reader.u16();
    dimensions(width, height);
    if (codec) integer(quantization, 1, 64, 'quantization'); else if (quantization) throw new RangeError('invalid lossless quantizer');
    const frameCount = integer(reader.u32(), 1, MAX_FRAMES, 'frameCount'), indexOffset = reader.u32(), audioOffset = reader.u32(), audioBytes = reader.u32();
    const sampleRate = reader.u32(), channels = reader.u16();
    if (reader.u16() !== 0) throw new RangeError('unsupported container flags');
    const durationUs = timestamp(reader.f64()), totalBytes = reader.u32(), headerCrc = reader.u32();
    if (totalBytes !== bytes.length || crc32(bytes.subarray(0, 52)) !== headerCrc) throw new RangeError('container header CRC/length mismatch');
    const indexEnd = indexOffset + frameCount * INDEX_SIZE;
    if (indexOffset < HEADER_SIZE || indexEnd + 4 > bytes.length) throw new RangeError('container index exceeds bounds');
    const indexData = new Reader(bytes.subarray(indexOffset, indexEnd + 4), MAX_CONTAINER_BYTES), frameInfo = [];
    let nextOffset = HEADER_SIZE, latestKey = -1, lastTime = -1, latestKeyTime = -1;
    for (let i = 0; i < frameCount; i++) {
        const timestampUs = timestamp(indexData.f64()), offset = indexData.u32(), length = indexData.u32(), keyframeIndex = indexData.u32(), flags = indexData.u32();
        if (offset !== nextOffset || length < 36 || length > indexOffset - offset || flags > 1 || timestampUs <= lastTime || (i === 0 && timestampUs !== 0)) throw new RangeError('invalid container frame index');
        const packet = parseVideoPacket(bytes.subarray(offset, offset + length));
        if (packet.width !== width || packet.height !== height || packet.frameRate !== frameRate || packet.quantization !== quantization || packet.mode !== (codec ? 'lossy' : 'lossless') || packet.sequence !== i || packet.timestampUs !== timestampUs || packet.keyframe !== !!flags) throw new RangeError('container frame metadata mismatch');
        if (flags) { latestKey = i; latestKeyTime = timestampUs; }
        if (latestKey < 0 || keyframeIndex !== latestKey || (!flags && timestampUs - latestKeyTime >= 2_000_000)) throw new RangeError('invalid keyframe seek index');
        frameInfo.push(Object.freeze({ index: i, timestampUs, keyframe: !!flags, keyframeIndex, offset, length }));
        nextOffset += length; lastTime = timestampUs;
    }
    if (nextOffset !== indexOffset || indexData.u32() !== crc32(bytes.subarray(indexOffset, indexEnd))) throw new RangeError('container index CRC/offset mismatch');
    indexData.end();
    if (durationUs < lastTime + Math.round(1_000_000 / frameRate)) throw new RangeError('container duration precedes video end');
    let audio = null;
    if (audioBytes) {
        integer(sampleRate, 8000, 192000, 'sampleRate'); integer(channels, 1, 2, 'channels');
        if (audioBytes % (channels * 2) || audioOffset !== indexEnd + 4 || audioOffset + audioBytes + 4 !== bytes.length) throw new RangeError('invalid audio bounds');
        const audioView = new DataView(bytes.buffer), checksum = audioView.getUint32(audioOffset + audioBytes, true);
        if (crc32(bytes.subarray(audioOffset, audioOffset + audioBytes)) !== checksum) throw new RangeError('container audio CRC mismatch');
        if (durationUs < Math.round(audioBytes / 2 / channels / sampleRate * 1_000_000)) throw new RangeError('container duration precedes audio end');
        audio = Object.freeze({ sampleRate, channels, sampleCount: audioBytes / 2 });
    } else if (audioOffset || sampleRate || channels || indexEnd + 4 !== bytes.length) throw new RangeError('invalid absent audio metadata');
    const metadata = Object.freeze({ width, height, frameRate, mode: codec ? 'lossy' : 'lossless', quantization, durationUs, audio });
    const decoder = new FrameDecoder();
    let lastIndex = -1, lastFrame = null;
    return {
        metadata, frameCount, frameInfo: Object.freeze(frameInfo),
        decodeFrame(index) {
            integer(index, 0, frameCount - 1, 'frame index');
            if (index !== lastIndex) {
                if (lastIndex > index || lastIndex < frameInfo[index].keyframeIndex) { decoder.reset(); lastIndex = frameInfo[index].keyframeIndex - 1; }
                try {
                    while (lastIndex < index) {
                        const entry = frameInfo[lastIndex + 1];
                        lastFrame = decoder.decodePacket(bytes.subarray(entry.offset, entry.offset + entry.length));
                        lastIndex++;
                    }
                } catch (error) { decoder.reset(); lastIndex = -1; lastFrame = null; throw error; }
            }
            return { ...lastFrame, index, rgba: lastFrame.rgba.slice() };
        },
        seek(timestampUs) {
            timestamp(timestampUs);
            let low = 0, high = frameCount;
            while (low < high) { const middle = Math.floor((low + high) / 2); if (frameInfo[middle].timestampUs <= timestampUs) low = middle + 1; else high = middle; }
            return this.decodeFrame(Math.max(0, low - 1));
        },
        decodeAudio() {
            if (!audio) return null;
            const data = new DataView(bytes.buffer, audioOffset, audioBytes), samples = new Int16Array(audioBytes / 2);
            for (let i = 0; i < samples.length; i++) samples[i] = data.getInt16(i * 2, true);
            return { ...audio, samples, timestampUs: 0 };
        },
    };
}
