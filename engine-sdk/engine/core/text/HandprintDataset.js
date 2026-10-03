// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { extractGlyphFeatures, documentOtsuThreshold } from '../math/DocumentImageMath.js';
import { mulberry32, shuffleInPlace } from '../math/MathRandom.js';

/** NIST EMNIST Balanced labels; fifteen uppercase labels also represent lowercase. */
export const HANDPRINT_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabdefghnqrt';
export const HANDPRINT_CASE_MERGED = 'CIJKLMOPSUVWXYZ';
export const HANDPRINT_DATASET = Object.freeze({
  id: 'nist-emnist-balanced-2017', source: 'https://www.nist.gov/itl/products-and-services/emnist-dataset',
  download: 'https://biometrics.nist.gov/cs_links/EMNIST/gzip.zip',
  archiveSha256: 'fb9bb67e33772a9cc0b895e4ecf36d2cf35be8b709693c3564cea2a019fcda8e',
  trainCount: 112800, testCount: 18800, validationStart: 94000, imageSize: 28,
  writerDisjointVerified: false, recognitionScope: 'isolated-handprinted-characters',
});

const alive = signal => { if (signal?.aborted) throw new DOMException('Handprint preparation cancelled', 'AbortError'); };

/** Parse checked, decompressed IDX bytes. No executable dataset or model content. */
export function parseHandprintIdx(imageBytes, labelBytes, { split, mapping } = {}) {
  if (!(imageBytes instanceof Uint8Array) || !(labelBytes instanceof Uint8Array) || !['train', 'test'].includes(split)) throw new TypeError('Provide EMNIST image/label bytes and their published split');
  if (imageBytes.length < 16 || labelBytes.length < 8) throw new TypeError('Truncated EMNIST IDX header');
  const images = new DataView(imageBytes.buffer, imageBytes.byteOffset, imageBytes.byteLength), labels = new DataView(labelBytes.buffer, labelBytes.byteOffset, labelBytes.byteLength);
  const count = split === 'train' ? HANDPRINT_DATASET.trainCount : HANDPRINT_DATASET.testCount;
  if (images.getUint32(0) !== 2051 || labels.getUint32(0) !== 2049 || images.getUint32(4) !== count || labels.getUint32(4) !== count
    || images.getUint32(8) !== 28 || images.getUint32(12) !== 28 || imageBytes.length !== 16 + count * 784 || labelBytes.length !== 8 + count) throw new TypeError('EMNIST IDX dimensions, split count, magic or exact length mismatch');
  if (typeof mapping !== 'string' || mapping.length > 4096) throw new TypeError('Verify the published EMNIST mapping');
  const lines = mapping.trim().split(/\r?\n/);
  if (lines.length !== HANDPRINT_ALPHABET.length || lines.some((line, index) => line.trim() !== `${index} ${HANDPRINT_ALPHABET.codePointAt(index)}`)) throw new TypeError('Noncanonical EMNIST class mapping');
  const data = imageBytes.subarray(16), classes = labelBytes.subarray(8);
  if (classes.some(label => label >= HANDPRINT_ALPHABET.length)) throw new TypeError('EMNIST label escapes the declared alphabet');
  return Object.freeze({ id: HANDPRINT_DATASET.id, split, count, data, labels: classes, width: 28, height: 28 });
}

/** Upright white-paper source pixels; IDX storage is transposed, not mirrored. */
export function handprintSample(dataset, index) {
  if (dataset?.id !== HANDPRINT_DATASET.id || !Number.isSafeInteger(index) || index < 0 || index >= dataset.count) throw new RangeError('Choose a valid EMNIST source row');
  const data = new Uint8ClampedArray(784 * 4), gray = new Uint8Array(784), offset = index * 784;
  for (let y = 0; y < 28; y++) for (let x = 0; x < 28; x++) {
    const at = y * 28 + x, value = 255 - dataset.data[offset + x * 28 + y]; gray[at] = value;
    data[at * 4] = data[at * 4 + 1] = data[at * 4 + 2] = value; data[at * 4 + 3] = 255;
  }
  const threshold = documentOtsuThreshold(gray); let left = 28, top = 28, right = -1, bottom = -1;
  for (let y = 0; y < 28; y++) for (let x = 0; x < 28; x++) if (gray[y * 28 + x] <= threshold && gray[y * 28 + x] < 250) {
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  if (right < left) throw new TypeError(`Blank EMNIST sample ${dataset.split}:${index}`);
  const bbox = { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }, image = { data, width: 28, height: 28 };
  return { image, bbox, label: HANDPRINT_ALPHABET[dataset.labels[index]], index, split: dataset.split,
    features: extractGlyphFeatures(image, bbox, { lineHeight: bbox.height, baseline: bottom + 1 }) };
}

/** Seeded balanced subsets never cross train/validation/test boundaries. */
export function selectHandprintIndices(dataset, { partition, perClass, seed = 74219 } = {}) {
  if (!['training', 'validation', 'test'].includes(partition) || dataset?.split !== (partition === 'test' ? 'test' : 'train')) throw new TypeError('The requested partition does not belong to this IDX split');
  if (!Number.isSafeInteger(perClass) || perClass < 1 || perClass > 400 || !Number.isSafeInteger(seed)) throw new RangeError('Choose 1–400 examples per class and an integer seed');
  const start = partition === 'validation' ? HANDPRINT_DATASET.validationStart : 0, end = partition === 'training' ? HANDPRINT_DATASET.validationStart : dataset.count;
  const groups = Array.from(HANDPRINT_ALPHABET, () => []), rng = mulberry32(seed);
  for (let index = start; index < end; index++) groups[dataset.labels[index]].push(index);
  const selected = [];
  for (const group of groups) { if (group.length < perClass) throw new RangeError('EMNIST partition has too few examples of a class'); shuffleInPlace(group, rng); selected.push(...group.slice(0, perClass)); }
  return shuffleInPlace(selected, rng);
}

/** Developer training preparation uses the production Engine feature extractor. */
export async function prepareHandprintExamples(dataset, indices, { partition, signal, onProgress } = {}) {
  alive(signal);
  if (!Array.isArray(indices) || indices.length > 18800 || new Set(indices).size !== indices.length) throw new RangeError('Provide unique bounded EMNIST row indices');
  const examples = [];
  for (let at = 0; at < indices.length; at++) {
    const index = indices[at];
    if (partition === 'training' && (dataset.split !== 'train' || index >= HANDPRINT_DATASET.validationStart)
      || partition === 'validation' && (dataset.split !== 'train' || index < HANDPRINT_DATASET.validationStart)
      || partition === 'test' && dataset.split !== 'test' || !['training', 'validation', 'test'].includes(partition)) throw new TypeError('Sample crosses the declared evaluation boundary');
    const sample = handprintSample(dataset, index);
    examples.push({ label: sample.label, features: sample.features, provenance: { kind: 'nist-handprinted-character', dataset: HANDPRINT_DATASET.id,
      split: dataset.split, partition, index, orientation: 'idx-transpose-upright', caseMerged: HANDPRINT_CASE_MERGED.includes(sample.label) } });
    if (at % 32 === 0) { onProgress?.({ phase: 'features', completed: at + 1, total: indices.length, partition }); await new Promise(resolve => setTimeout(resolve, 0)); alive(signal); }
  }
  alive(signal); return examples;
}
