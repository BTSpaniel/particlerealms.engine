// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { mulberry32, shuffleInPlace } from '../math/MathRandom.js';
import { imageLuminanceMap } from '../math/ImageMath.js';
import { bilinearSample } from '../math/MathGrid.js';
import { contentHashHex } from '../math/ChecksumMath.js';

export const CONNECTED_HANDWRITING_ALPHABET = ' ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-().;ÄÖÜäöüßóš';
export const CONNECTED_HANDWRITING_SOURCE = Object.freeze({ id: 'dhsd-1.0.0', source: 'https://zenodo.org/records/18743313', archiveSha256: '6259aed259a8d5ddb4c0b118f98307ce957b2c698c7a2f20fd7b58b446d4d878', license: 'CC-BY-4.0', scope: 'genuine-connected-german-geographic-names', samples: 5939, writers: 37 });

/** Whole-writer split; the upstream supplied split is intentionally not used. */
export function partitionHandwritingWriters(manifest, { seed = 61203 } = {}) {
  if (manifest?.schema !== 'particle-realms.handwriting-corpus.v1' || manifest.id !== CONNECTED_HANDWRITING_SOURCE.id || manifest.archiveSha256 !== CONNECTED_HANDWRITING_SOURCE.archiveSha256 || !Array.isArray(manifest.records) || manifest.records.length !== 5939 || !Number.isSafeInteger(seed)) throw new TypeError('Use the hash-verified, original DHSD writer manifest');
  const files = new Set(), writers = new Set(), hashes = new Map(), records = [];
  for (const source of manifest.records) {
    if (!source || !Number.isSafeInteger(source.writer) || source.writer < 1 || source.writer > 37 || typeof source.file !== 'string' || !new RegExp(`^german_hw_data/writer${source.writer}/[0-9]+_[0-9]+\\.png$`).test(source.file) || files.has(source.file) || !/^[a-f0-9]{64}$/.test(source.sha256) || typeof source.text !== 'string' || !source.text.length || Array.from(source.text).length > 64 || Array.from(source.text).some(label => !CONNECTED_HANDWRITING_ALPHABET.includes(label))) throw new TypeError('Invalid or duplicated handwriting source record');
    files.add(source.file); writers.add(source.writer);
    const duplicate = hashes.get(source.sha256);
    if (duplicate && duplicate.text !== source.text) throw new Error('Identical source image has conflicting transcripts');
    if (duplicate && duplicate.writer !== source.writer) throw new Error('Identical source image spans writer IDs; resolve provenance before splitting');
    if (!duplicate) { const row = Object.freeze({ file: source.file, text: source.text, writer: source.writer, sha256: source.sha256 }); hashes.set(row.sha256, row); records.push(row); }
  }
  if (writers.size !== 37) throw new Error('Writer manifest is incomplete');
  const shuffled = Array.from(writers).sort((a, b) => a - b); shuffleInPlace(shuffled, mulberry32(seed));
  const splitWriters = { training: shuffled.slice(0, 27), validation: shuffled.slice(27, 32), test: shuffled.slice(32) }, owner = new Map();
  for (const [partition, ids] of Object.entries(splitWriters)) for (const id of ids) owner.set(id, partition);
  const partitions = { training: [], validation: [], test: [] };
  for (const row of records) { const partition = owner.get(row.writer); partitions[partition].push(Object.freeze({ ...row, partition })); }
  const trainingText = new Set(partitions.training.map(row => row.text));
  return { source: CONNECTED_HANDWRITING_SOURCE, seed, writerDisjointVerified: true, splitWriters, partitions, duplicateImagesRemoved: manifest.records.length - records.length,
    novelText: { validation: partitions.validation.filter(row => !trainingText.has(row.text)).length, test: partitions.test.filter(row => !trainingText.has(row.text)).length } };
}

/** Compact dark-ink pixels for the declared 256x32 training/inference transform. */
export function handwritingSequencePixels(image) {
  if (image?.width !== 256 || image.height !== 32 || image.data?.length !== 256 * 32 * 4) throw new TypeError('Connected-word images must use the declared 256 by 32 transform');
  const luma = imageLuminanceMap(image), pixels = new Uint8Array(256 * 32);
  for (let at = 0; at < pixels.length; at++) pixels[at] = Math.max(0, Math.min(255, Math.round(255 - luma[at])));
  return pixels;
}

/** Normalize a word's observed ink band, without transcript-derived geometry. */
export function normalizeHandwritingInk(pixels, { threshold = 32, inkHeight = 26 } = {}) {
  if (!(pixels instanceof Uint8Array) || pixels.length !== 256 * 32 || !Number.isInteger(threshold) || threshold < 1 || threshold > 254 || !Number.isInteger(inkHeight) || inkHeight < 8 || inkHeight > 28) throw new TypeError('Invalid handwriting ink normalization');
  let left = 256, top = 32, right = -1, bottom = -1;
  for (let y = 0; y < 32; y++) for (let x = 0; x < 256; x++) if (pixels[y * 256 + x] >= threshold) {
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  const normalized = new Uint8Array(pixels.length);
  if (right < left) return { pixels: normalized, inkBox: null, transform: null };
  // Keep horizontal sampling unchanged: normalization must not guess word
  // length from its label. Two white columns separate ink from context padding.
  const offsetY = (32 - inkHeight) / 2, height = bottom - top + 1, width = right - left + 1, xScale = Math.min(1, 252 / width);
  for (let y = 0; y < 32; y++) {
    const sourceY = top + (y - offsetY + .5) * height / inkHeight - .5;
    if (sourceY < top - .5 || sourceY > bottom + .5) continue;
    for (let x = 2; x < 2 + Math.ceil(width * xScale); x++) {
      const sourceX = left + (x - 2 + .5) / xScale - .5;
      normalized[y * 256 + x] = Math.max(0, Math.min(255, Math.round(bilinearSample(pixels, 256, 32, Math.max(0, Math.min(255, sourceX)), Math.max(0, Math.min(31, sourceY))))));
    }
  }
  return { pixels: normalized, inkBox: { x: left, y: top, width, height }, transform: { xScale, yScale: inkHeight / height, xOffset: 2 - left * xScale, yOffset: offsetY - top * inkHeight / height } };
}

/** Vertical strips retain connected pixels; no component splitting or vocabulary. */
export function handwritingSequenceFeatures(pixels, { radius = 4, stride = 2, trimInk = false, width = 256 } = {}) {
  if (!(pixels instanceof Uint8Array) || ![64, 128, 256, 512].includes(width) || pixels.length !== width * 32 || !Number.isSafeInteger(radius) || radius < 0 || radius > 8 || stride !== 2 || typeof trimInk !== 'boolean') throw new TypeError('Invalid bounded handwriting strip features');
  let right = -1;
  if (trimInk) for (let y = 0; y < 32; y++) for (let x = 0; x < width; x++) if (pixels[y * width + x] >= 8) right = Math.max(right, x);
  const steps = trimInk ? Math.max(1, Math.min(width / stride, Math.ceil((right + 1 + radius) / stride))) : width / stride, features = (radius * 2 + 1) * 32, values = new Float32Array(steps * features);
  for (let time = 0; time < steps; time++) for (let dx = -radius; dx <= radius; dx++) {
    const x = time * stride + dx, offset = time * features + (dx + radius) * 32;
    if (x < 0 || x >= width) continue;
    for (let y = 0; y < 32; y++) values[offset + y] = pixels[y * width + x] / 255;
  }
  return { values, steps, features };
}

/** Developer visual pretraining from the same owned font raster source. */
export async function createHandwritingVisualExamples({ alphabet = CONNECTED_HANDWRITING_ALPHABET, fonts = ['Arial', 'Times New Roman', 'Courier New', 'Verdana', 'Segoe Print', 'Segoe Script', 'Comic Sans MS', 'Brush Script MT'], sequenceCount = 0, seed = 71209, signal, onProgress } = {}) {
  if (!Number.isSafeInteger(sequenceCount) || sequenceCount < 0 || sequenceCount > 4096) throw new RangeError('Visual pretraining allows at most 4096 composed sequences');
  const { createGlyphRasterDataset } = await import('./GlyphRasterSource.js');
  const labels = Array.from(alphabet).filter(label => !/\s/u.test(label)).join('');
  const source = await createGlyphRasterDataset({ alphabet: labels, fonts, sizes: [28, 40], augment: true, seed, signal, onProgress });
  const examples = [], visualRng = mulberry32(seed ^ 0x537ac1);
  for (const glyph of source.examples) {
    signal?.throwIfAborted();
    const pixels = new Uint8Array(256 * 32);
    // These 24-square values are the Engine's observed, aspect-preserving
    // raster samples before classifier normalization, not model predictions.
    const xScale = .45 + visualRng() * .55, inkHeight = 12 + Math.floor(visualRng() * 17);
    for (let y = 0; y < 24; y++) for (let x = 0; x < Math.ceil(24 * xScale); x++) {
      const sx = Math.max(0, Math.min(23, (x + .5) / xScale - .5));
      pixels[(y + 4) * 256 + x + 2] = Math.round(bilinearSample(glyph.features, 24, 24, sx, y) * 255);
    }
    const normalized = normalizeHandwritingInk(pixels, { inkHeight }), strips = handwritingSequenceFeatures(normalized.pixels);
    if (!normalized.inkBox) continue;
    const steps = Math.max(8, Math.min(20, Math.ceil((normalized.inkBox.width + 6) / 2)));
    const width = steps * 2, raster = sequenceCount ? new Uint8Array(width * 32) : null;
    if (raster) for (let y = 0; y < 32; y++) raster.set(normalized.pixels.subarray(y * 256, y * 256 + width), y * width);
    examples.push({ text: glyph.label, steps, features: strips.values.slice(0, steps * strips.features), pixelSha256: await contentHashHex(normalized.pixels), provenance: { ...glyph.provenance, sequenceAugmentation: { xScale, inkHeight } }, ...(raster ? { raster: { data: raster, width } } : {}) });
  }
  const identities = examples.map(row => ({ label: row.text, steps: row.steps, pixelSha256: row.pixelSha256, requestedFont: row.provenance.requestedFont, sequenceAugmentation: row.provenance.sequenceAugmentation })), sha256 = await contentHashHex(new TextEncoder().encode(JSON.stringify(identities)));
  const sequences = [], sequenceIdentities = [];
  for (let index = 0; index < sequenceCount; index++) {
    signal?.throwIfAborted(); const pixels = new Uint8Array(256 * 32), members = [], count = 2 + Math.floor(visualRng() * 5); let x = 2, text = '';
    for (let at = 0; at < count; at++) {
      const id = Math.floor(visualRng() * examples.length), member = examples[id], gap = Math.floor(visualRng() * 4) - 1;
      for (let y = 0; y < 32; y++) for (let column = 0; column < member.raster.width; column++) if (x + column < 256) pixels[y * 256 + x + column] = Math.max(pixels[y * 256 + x + column], member.raster.data[y * member.raster.width + column]);
      members.push({ id, x }); text += member.text; x += member.raster.width - 3 + gap;
    }
    const strips = handwritingSequenceFeatures(pixels), steps = Math.min(128, Math.ceil((x + 5) / 2)), pixelSha256 = await contentHashHex(pixels);
    sequences.push({ text, steps, features: strips.values.slice(0, steps * strips.features), pixelSha256 }); sequenceIdentities.push({ text, steps, pixelSha256, members });
  }
  for (const row of examples) delete row.raster;
  const sequenceSha256 = sequenceCount ? await contentHashHex(new TextEncoder().encode(JSON.stringify(sequenceIdentities))) : null;
  return { examples, sequences, provenance: { source: 'owned-browser-glyph-raster', role: 'synthetic-visual-pretraining-only', alphabet: labels, seed, sha256, identities, sequences: { count: sequenceCount, sha256: sequenceSha256, identities: sequenceIdentities, role: 'random-label-composites-not-natural-writing' }, fonts: source.provenance.fonts, normalization: { method: 'observed-ink-band', threshold: 32, inkHeightRange: [12, 28], xScaleRange: [.45, 1] }, sourceExamples: source.examples.length, preparedExamples: examples.length, includesBenchmarkTranscripts: false, includesNaturalCursive: false } };
}
