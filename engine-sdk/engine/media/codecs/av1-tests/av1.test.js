// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { encodeAV1PaletteFrame, decodeAV1PaletteFrame, encodeAV1Intra, decodeAV1Intra } from '../AV1Intra.js';

const results = [];
window.av1TestResults = results;
const assert = (value, message) => { if (!value) throw new Error(message); };
const equal = (a, b, message) => assert(a.length === b.length && a.every((value, i) => value === b[i]), message);
const rejects = (callback, message) => { let threw = false; try { callback(); } catch { threw = true; } assert(threw, message); };
function fixture(pattern, low = 17, high = 231) {
    const rgba = new Uint8Array(64 * 64 * 4);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        const v = pattern(x, y) ? high : low, i = (y * 64 + x) * 4;
        rgba[i] = rgba[i + 1] = rgba[i + 2] = v; rgba[i + 3] = 255;
    }
    return rgba;
}
function tiledFixture(width, height) {
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const tile = Math.floor(y / 64) * (width / 64) + Math.floor(x / 64), low = tile % 100, high = 150 + tile % 100;
        const v = ((x * 13 + y * 7) % 17) < 9 ? high : low, i = (y * width + x) * 4;
        rgba[i] = rgba[i + 1] = rgba[i + 2] = v; rgba[i + 3] = 255;
    }
    return rgba;
}
async function nativePixels(packets, width, height, levelIndex) {
    assert(typeof VideoDecoder === 'function', 'native AV1 validation requires VideoDecoder');
    const config = { codec: `av01.0.${String(levelIndex).padStart(2, '0')}M.08`, codedWidth: width, codedHeight: height, hardwareAcceleration: 'prefer-software' };
    const support = await VideoDecoder.isConfigSupported(config); assert(support.supported, 'browser AV1 decoder unavailable');
    let failure = null; const outputs = [], copies = [];
    const decoder = new VideoDecoder({ error(error) { failure = error; }, output(frame) {
        copies.push((async () => {
            try {
                assert(['I420', 'I422', 'I444', 'NV12'].includes(frame.format), `unsupported native validation pixel format ${frame.format}`);
                const storage = new Uint8Array(frame.allocationSize()), layout = await frame.copyTo(storage), luma = new Uint8Array(width * height);
                for (let row = 0; row < height; row++) luma.set(storage.subarray(layout[0].offset + row * layout[0].stride, layout[0].offset + row * layout[0].stride + width), row * width);
                outputs.push({ timestamp: frame.timestamp, luma, format: frame.format, width: frame.codedWidth, height: frame.codedHeight });
            } finally { frame.close(); }
        })().catch(error => { failure = error; }));
    } });
    try {
        decoder.configure(config);
        packets.forEach((data, i) => decoder.decode(new EncodedVideoChunk({ type: 'key', timestamp: i * 100000, data })));
        try { await decoder.flush(); } catch (error) { throw failure ?? error; }
        await Promise.all(copies); if (failure) throw failure;
        assert(outputs.length === packets.length, 'native decoder did not emit every frame');
        outputs.sort((a, b) => a.timestamp - b.timestamp); return outputs;
    } finally { if (decoder.state !== 'closed') decoder.close(); }
}
const fixtures = [fixture(() => 0), fixture(() => 1), fixture(x => x > 29), fixture((x, y) => (x ^ y) & 1), fixture((x, y) => ((x * 31 + y * 17) % 11) < 5, 0, 255), fixture((x, y) => (x - 32) ** 2 + (y - 32) ** 2 < 650, 49, 170)];
async function test(name, callback) {
    try { const detail = await callback(); results.push({ name, passed: true, detail }); }
    catch (error) { results.push({ name, passed: false, error: error.stack ?? String(error) }); }
    document.querySelector('#results').textContent = JSON.stringify(results, null, 2);
}

await test('authored entropy/palette round trips six unrelated input-derived images', () => {
    const sizes = [];
    for (const rgba of fixtures) { const bytes = encodeAV1PaletteFrame(rgba); equal(decodeAV1PaletteFrame(bytes).rgba, rgba, 'authored pixels differ'); sizes.push(bytes.length); }
    return { bytes: sizes };
});
await test('IVF multi-frame timing and authored decoder plus strict malformed input rejection', () => {
    const bytes = encodeAV1Intra({ width: 64, height: 64, frameRate: 24, frames: fixtures }), decoded = decodeAV1Intra(bytes);
    assert(decoded.frames.length === fixtures.length, 'frame count mismatch');
    decoded.frames.forEach((frame, i) => { equal(frame.rgba, fixtures[i], 'IVF pixels differ'); assert(frame.timestampUs === Math.round(i * 1e6 / 24), 'timestamp mismatch'); });
    rejects(() => encodeAV1Intra({ width: 1280, height: 64, frames: fixtures }), 'dimensions gate missing');
    rejects(() => encodeAV1Intra({ width: 127, height: 64, frames: fixtures }), 'tile alignment gate missing');
    rejects(() => encodeAV1PaletteFrame(new Uint8Array(15)), 'input size gate missing');
    rejects(() => decodeAV1Intra(bytes.subarray(0, bytes.length - 1)), 'truncated IVF accepted');
    const header = bytes.slice(); header[12] = 128; rejects(() => decodeAV1Intra(header), 'foreign dimensions accepted');
    const raw = encodeAV1PaletteFrame(fixtures[2]), badProfile = raw.slice(); badProfile[2] ^= 0x80;
    rejects(() => decodeAV1PaletteFrame(badProfile), 'foreign AV1 profile accepted');
    const badPadding = raw.slice(); badPadding[badPadding.length - 1] ^= 1;
    rejects(() => decodeAV1PaletteFrame(badPadding), 'corrupt entropy padding accepted');
    return { bytes: bytes.length, durationUs: decoded.frames.at(-1).timestampUs };
});
await test('independent browser AV1 decoder renders authored bitstreams with exact luma', async () => {
    const outputs = await nativePixels(fixtures.map(rgba => encodeAV1PaletteFrame(rgba)), 64, 64, 0);
    outputs.forEach((frame, i) => { assert(frame.width === 64 && frame.height === 64, 'native dimensions differ'); equal(frame.luma, fixtures[i].filter((_, j) => j % 4 === 0), `native luma mismatch frame ${i}`); });
    return { frames: outputs.length, formats: outputs.map(frame => frame.format) };
});
await test('independent multi-tile AV1 native interoperability through 1024x512 and level selection', async () => {
    const report = [];
    for (const [width, height] of [[128, 64], [64, 128], [128, 128], [320, 192], [384, 192], [512, 256], [512, 384], [512, 512], [1024, 256], [1024, 512]]) {
        const rgba = tiledFixture(width, height), start = performance.now(), bytes = encodeAV1PaletteFrame(rgba, width, height), authored = decodeAV1PaletteFrame(bytes);
        equal(authored.rgba, rgba, 'multi-tile authored pixels differ');
        let frames;
        try { frames = await nativePixels([bytes], width, height, authored.levelIndex); }
        catch (error) { throw new Error(`${width}x${height} AV1 native failure (${Array.from(bytes.subarray(0, 24)).join(',')}): ${error.message}`); }
        assert(frames[0].width === width && frames[0].height === height, 'native multi-tile dimensions differ');
        equal(frames[0].luma, rgba.filter((_, i) => i % 4 === 0), 'native multi-tile luma differs');
        const ivf = encodeAV1Intra({ width, height, frameRate: 30, frames: [rgba] }), decoded = decodeAV1Intra(ivf);
        equal(decoded.frames[0].rgba, rgba, 'multi-tile IVF pixels differ');
        assert(decoded.metadata.durationUs === 33333, 'metadata duration missing');
        report.push({ width, height, bytes: bytes.length, levelIndex: authored.levelIndex, elapsedMs: Math.round(performance.now() - start) });
    }
    return report;
});
await test('arbitrary colored RGBA quantizes from its pixels and native decoder matches authored result', async () => {
    const width = 128, height = 64, rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        rgba[i] = (x * 7 + y * 3) % 256; rgba[i + 1] = (x * 13 + y * 11) % 256; rgba[i + 2] = (x * 5 + y * 19) % 256; rgba[i + 3] = 255;
    }
    const packet = encodeAV1PaletteFrame(rgba, width, height), authored = decodeAV1PaletteFrame(packet), outputs = await nativePixels([packet], width, height, authored.levelIndex);
    equal(outputs[0].luma, authored.rgba.filter((_, i) => i % 4 === 0), 'colored quantization native pixels differ');
    assert(!authored.rgba.every((value, i) => value === rgba[i]), 'lossy colored input unexpectedly unchanged');
    const colors = [new Set(), new Set()];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4, v = authored.rgba[i];
        assert(authored.rgba[i + 1] === v && authored.rgba[i + 2] === v && authored.rgba[i + 3] === 255, 'palette output is not monochrome opaque');
        colors[Math.floor(x / 64)].add(v);
    }
    assert(colors.every(set => set.size === 2), 'input-derived tile palette missing');
    const badTileLength = packet.slice();
    // Locate the frame header through the public OBU lengths, then force its
    // first tile length beyond the declared bounded decoder capability.
    let at = 1, size = 0, shift = 0, value;
    do { value = badTileLength[at++]; size += (value & 127) * 2 ** shift; shift += 7; } while (value & 128);
    at += size + 1; do { value = badTileLength[at++]; } while (value & 128);
    // 128x64 has 22 uncompressed frame-header bits, padded to three bytes.
    at += 3 + 1; badTileLength[at] = 255; badTileLength[at + 1] = 255;
    let bounded = false;
    try { decodeAV1PaletteFrame(badTileLength); } catch (error) { bounded = error.message.includes('tile length must be an integer'); }
    assert(bounded, 'oversized tile did not fail at its bounds check');
    rejects(() => decodeAV1Intra(new Uint8Array(128 * 1024 * 1024 + 1)), 'oversized IVF accepted');
    return { tilePalettes: colors.map(set => Array.from(set)), bytes: packet.length };
});
document.documentElement.dataset.testStatus = results.every(result => result.passed) ? 'passed' : 'failed';
