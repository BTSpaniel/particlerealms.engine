// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { byteView, integer, timestamp } from './Binary.js';
import { CONTAINER_MAGIC, decodeContainer } from './Container.js';
import { decodeH264Pcm } from './H264Pcm.js';
import { decodeMpegIntra } from './MpegIntra.js';
import { decodeAV1Intra } from './AV1Intra.js';

// Standard elementary streams have no PRV index or PCM audio track. Their
// independently decoded I pictures are retained under the bounded output cap.
export function decodeAuthoredContainer(value) {
    const bytes = byteView(value);
    if (bytes.length >= 4 && new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) === CONTAINER_MAGIC) return decodeContainer(bytes);
    let decoded;
    if (bytes.length >= 4 && bytes[0] === 68 && bytes[1] === 75 && bytes[2] === 73 && bytes[3] === 70) decoded = decodeAV1Intra(bytes);
    else if (bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0xb3) decoded = decodeMpegIntra(bytes);
    else {
        const nal = bytes.length >= 5 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 1 ? bytes[4]
            : bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 ? bytes[3] : -1;
        if ((nal & 31) !== 7) throw new RangeError('unrecognized authored format; supported: PRV1, restricted H.264 I_PCM, MPEG-1/MPEG-2 DC-only intra, AV1 palette-intra IVF');
        decoded = decodeH264Pcm(bytes);
    }
    const { frames } = decoded, metadata = Object.freeze({ ...decoded.metadata, durationUs: decoded.metadata.durationUs ?? Math.round(frames.length * 1_000_000 / decoded.metadata.frameRate), quantization: 0, audio: null }), frameCount = frames.length;
    const frameInfo = Object.freeze(frames.map((frame, index) => Object.freeze({ index, timestampUs: frame.timestampUs, keyframe: true, keyframeIndex: index })));
    return {
        metadata, frameCount, frameInfo,
        decodeFrame(index) {
            integer(index, 0, frameCount - 1, 'frame index'); const frame = frames[index];
            return { index, sequence: index, timestampUs: frame.timestampUs, width: frame.width, height: frame.height, keyframe: true, mode: metadata.mode, rgba: frame.rgba.slice() };
        },
        seek(timestampUs) {
            timestamp(timestampUs); let low = 0, high = frameCount;
            while (low < high) { const middle = Math.floor((low + high) / 2); if (frames[middle].timestampUs <= timestampUs) low = middle + 1; else high = middle; }
            return this.decodeFrame(Math.max(0, low - 1));
        },
        decodeAudio() { return null; },
    };
}
