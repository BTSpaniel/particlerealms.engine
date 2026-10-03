// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { encodeContainer } from './Container.js';
import { decodeAuthoredContainer } from './AuthoredContainer.js';
import { FrameEncoder, FrameDecoder } from './FramePacket.js';
import { encodeH264Pcm, decodeH264Pcm } from './H264Pcm.js';
import { encodeMpeg1Intra, encodeMpeg2Intra, decodeMpegIntra } from './MpegIntra.js';
import { encodeAV1Intra, decodeAV1Intra } from './AV1Intra.js';

let container = null, encoder = null;
const liveDecoder = new FrameDecoder();
self.addEventListener('message', ({ data }) => {
    const { id, operation, value } = data ?? {}, start = performance.now();
    try {
        let result;
        if (operation === 'encode') result = encodeContainer(value);
        else if (operation === 'encodeH264Pcm') result = encodeH264Pcm(value);
        else if (operation === 'decodeH264Pcm') result = decodeH264Pcm(value);
        else if (operation === 'encodeMpeg1Intra') result = encodeMpeg1Intra(value);
        else if (operation === 'encodeMpeg2Intra') result = encodeMpeg2Intra(value);
        else if (operation === 'decodeMpegIntra') result = decodeMpegIntra(value);
        else if (operation === 'encodeAV1Intra') result = encodeAV1Intra(value);
        else if (operation === 'decodeAV1Intra') result = decodeAV1Intra(value);
        else if (operation === 'open') {
            container = null;
            container = decodeAuthoredContainer(value);
            result = { metadata: container.metadata, frameCount: container.frameCount, frameInfo: container.frameInfo };
        } else if (operation === 'frame') { if (!container) throw new Error('open a container first'); result = container.decodeFrame(value); }
        else if (operation === 'seek') { if (!container) throw new Error('open a container first'); result = container.seek(value); }
        else if (operation === 'audio') { if (!container) throw new Error('open a container first'); result = container.decodeAudio(); }
        else if (operation === 'configureEncoder') { encoder = null; encoder = new FrameEncoder(value); result = true; }
        else if (operation === 'encodePacket') { if (!encoder) throw new Error('configure an encoder first'); result = encoder.encodePacket(value.rgba, value); }
        else if (operation === 'decodePacket') result = liveDecoder.decodePacket(value);
        else if (operation === 'reset') { container = null; encoder = null; liveDecoder.reset(); result = true; }
        else throw new RangeError('unknown codec worker operation');
        const transfers = result instanceof Uint8Array ? [result.buffer] : result?.rgba ? [result.rgba.buffer] : result?.samples ? [result.samples.buffer] : [];
        self.postMessage({ id, ok: true, result, elapsedMs: performance.now() - start }, transfers);
    } catch (error) { self.postMessage({ id, ok: false, error: { name: error.name, message: error.message }, elapsedMs: performance.now() - start }); }
});
