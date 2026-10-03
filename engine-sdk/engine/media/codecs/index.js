// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export { encodeContainer, decodeContainer, CONTAINER_MAGIC } from './Container.js';
export { decodeAuthoredContainer } from './AuthoredContainer.js';
export { FrameEncoder, FrameDecoder, parseVideoPacket, encodeAudioPacket, decodeAudioPacket, VIDEO_PACKET_MAGIC, AUDIO_PACKET_MAGIC } from './FramePacket.js';
export { CodecClient, WORKER_URL } from './CodecClient.js';
export { TILE_SIZE, TILE_MODES } from './LosslessCodec.js';
export { MAX_CONTAINER_BYTES, MAX_PACKET_BYTES, MAX_FRAMES } from './Binary.js';
export { encodeH264Pcm, decodeH264Pcm, h264PcmLevel } from './H264Pcm.js';
export { encodeMpegIntra, decodeMpegIntra, encodeMpeg1Intra, decodeMpeg1Intra, encodeMpeg2Intra, decodeMpeg2Intra } from './MpegIntra.js';
export { encodeAV1Intra, decodeAV1Intra, encodeAV1PaletteFrame, decodeAV1PaletteFrame } from './AV1Intra.js';

// No standard codec is advertised until its independently authored implementation
// has standards interoperability evidence. PRV formats are explicitly separate.
export const AUTHORED_CODECS = Object.freeze([
    Object.freeze({ id: 'prv-lossless/1', format: 'PRV1', pixels: 'RGBA8', maximumWidth: 1280, maximumHeight: 720, maximumFrameRate: 30 }),
    Object.freeze({ id: 'prv-lossy/1', format: 'PRV1', pixels: 'SDR full-range BT.709 YCbCr 4:2:0', transform: 'integer Walsh-Hadamard 8x8', maximumWidth: 1280, maximumHeight: 720, maximumFrameRate: 30 }),
]);

export const AUTHORED_STANDARDS = Object.freeze([
    Object.freeze({ id: 'h264-constrained-baseline-ipcm/1', format: 'Annex B', profile: 'Constrained Baseline', level: 'selected by conservative I_PCM bitrate: 3.1, 5.0, 5.1, 6.1 or 6.2', tools: 'progressive 8-bit 4:2:0 all-I_PCM IDR, one slice, deblocking off', compressed: false, generalDecoder: false }),
    Object.freeze({ id: 'mpeg1-dc-intra/1', format: 'MPEG video elementary stream', tools: 'progressive 8-bit 4:2:0 I pictures, DC coefficients only, one slice per macroblock row', compressed: true, generalDecoder: false, interoperability: 'independent JSMpeg MPEG-1 decoder' }),
    Object.freeze({ id: 'mpeg2-dc-intra/1', format: 'MPEG video elementary stream', profile: 'Main', level: 'High-1440', tools: 'progressive 8-bit 4:2:0 I pictures, DC coefficients only, one slice per macroblock row', compressed: true, generalDecoder: false, interoperability: 'H.262 extension syntax and independent MPEG-1 decoder for common intra picture data; independent MPEG-2 decoder unverified' }),
    Object.freeze({ id: 'av1-palette-intra/1', format: 'AV01 IVF', profile: 'Main 8-bit', tools: 'monochrome two-color palette per 64x64 intra tile, no residuals/filters, static CDF', minimumWidth: 64, minimumHeight: 64, maximumWidth: 1024, maximumHeight: 512, dimensionAlignment: 64, maximumFrameRate: 30, compressed: true, generalDecoder: false, interoperability: 'independent browser software AV1 decoder exact Y samples; hardware compatibility varies' }),
]);
