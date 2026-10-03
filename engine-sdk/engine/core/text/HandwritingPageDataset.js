// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { mulberry32, shuffleInPlace } from '../math/MathRandom.js';
import { documentQuadTransform, rectifyDocumentQuad } from '../math/DocumentQuadMath.js';
import { documentOtsuThreshold } from '../math/DocumentImageMath.js';
import { normalizeHandwritingInk } from './HandwritingSequenceDataset.js';
import { contentHashHex } from '../math/ChecksumMath.js';
import { imageLuminanceMap } from '../math/ImageMath.js';
import { HANDWRITING_RASTER_RECIPE, prepareHandwritingRaster, handwritingRasterTransformReport } from './HandwritingRasterPreparation.js';
import { mat3Multiply } from '../math/MathMat.js';

export const ENGLISH_HANDWRITING_SOURCE = Object.freeze({ id: 'gnhk-2021', source: 'https://github.com/GoodNotes/GNHK-dataset', archiveSha256: '5f4b470030b41cd80e32d3a5ae7bc8bc41acc79b4bf770a451e7ec54ca3be34d', license: 'CC-BY-4.0', originalTrainingPages: 515, originalTestPages: 172, writerDisjointVerified: false });

async function readHandwritingBytes(url, expectedHash, maximumBytes, signal) {
  signal?.throwIfAborted(); const response = await fetch(url, { signal }); if (!response.ok) throw new Error(`Cannot read handwriting source: ${url}`);
  if (Number(response.headers.get('content-length') ?? 0) > maximumBytes) throw new RangeError('Handwriting source exceeds its byte budget');
  const reader = response.body?.getReader(); if (!reader) throw new Error('Handwriting source has no readable body');
  const chunks = []; let total = 0;
  try {
    while (true) { signal?.throwIfAborted(); const next = await reader.read(); if (next.done) break; total += next.value.length; if (total > maximumBytes) throw new RangeError('Handwriting source exceeded its byte budget'); chunks.push(next.value); }
  } catch (error) { await reader.cancel(error).catch(() => {}); throw error; } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  if (await contentHashHex(bytes) !== expectedHash) throw new Error('Handwriting source checksum differs');
  return bytes;
}

/** Split developer training pages by whole image identity; preserve original test. */
export function partitionHandwritingPages(manifest, { seed = 88319 } = {}) {
  if (manifest?.schema !== 'particle-realms.handwriting-pages.v1' || manifest.id !== ENGLISH_HANDWRITING_SOURCE.id || manifest.mirror?.archiveSha256 !== ENGLISH_HANDWRITING_SOURCE.archiveSha256 || manifest.license !== ENGLISH_HANDWRITING_SOURCE.license || manifest.writerDisjointVerified !== false || !Array.isArray(manifest.pages) || manifest.pages.length !== 687 || !Number.isSafeInteger(seed)) throw new TypeError('Use the hash-verified original English page manifest');
  const ids = new Set(), groups = new Map(); let trainingCount = 0, testCount = 0;
  for (const page of manifest.pages) {
    if (!page || !/^eng_[A-Z]{2}_[0-9]{3}$/.test(page.id) || ids.has(page.id) || !['train', 'test'].includes(page.partition) || page.file !== `${page.partition}/${page.id}.jpg` || page.annotations !== `${page.partition}/${page.id}.json` || !/^[a-f0-9]{64}$/.test(page.sha256) || !/^[a-f0-9]{64}$/.test(page.annotationsSha256) || page.writer !== null) throw new TypeError('Invalid English page provenance');
    ids.add(page.id); if (page.partition === 'train') trainingCount++; else testCount++;
    const group = groups.get(page.sha256) ?? { sha256: page.sha256, originalPartition: page.partition, pages: [] };
    if (group.originalPartition !== page.partition) throw new Error('Identical page pixels overlap the original train/test split');
    group.pages.push(page); groups.set(page.sha256, group);
  }
  if (trainingCount !== 515 || testCount !== 172) throw new Error('English source split cardinality differs');
  const trainingGroups = Array.from(groups.values()).filter(group => group.originalPartition === 'train').sort((a, b) => a.sha256.localeCompare(b.sha256));
  shuffleInPlace(trainingGroups, mulberry32(seed)); const validationHashes = new Set(trainingGroups.slice(0, Math.ceil(trainingGroups.length / 10)).map(group => group.sha256));
  const partitions = { training: [], validation: [], test: [] };
  for (const page of manifest.pages) {
    const partition = page.partition === 'test' ? 'test' : validationHashes.has(page.sha256) ? 'validation' : 'training';
    partitions[partition].push(Object.freeze({ ...page, originalPartition: page.partition, partition }));
  }
  return { source: ENGLISH_HANDWRITING_SOURCE, seed, partitions, writerDisjointVerified: false, imageDisjointVerified: true,
    splitBasis: 'Whole original training photograph hashes; writers unknown; original test stays sealed', duplicateGroups: Array.from(groups.values()).filter(group => group.pages.length > 1).map(group => ({ sha256: group.sha256, pages: group.pages.map(page => page.id) })) };
}

/** Preserve every annotation, including explicitly non-readable source regions. */
export function handwritingPageAnnotations(annotations, page) {
  if (!Array.isArray(annotations) || annotations.length > 4000 || !/^eng_[A-Z]{2}_[0-9]{3}$/.test(page?.id) || !['training', 'validation', 'test'].includes(page.partition)) throw new TypeError('Declare a bounded source annotation array and its page partition');
  return annotations.map((source, index) => {
    if (typeof source?.text !== 'string' || source.text.length > 512 || !['H', 'P'].includes(source.type) || !Number.isInteger(source.line_idx) || source.line_idx < 0) throw new TypeError('Invalid original handwriting annotation');
    const sourceQuad = Array.from({ length: 4 }, (_, at) => ({ x: source.polygon?.[`x${at}`], y: source.polygon?.[`y${at}`] }));
    // GNHK indices do not consistently start on the reading-direction edge.
    // Canonicalize the polygon on the supplied upright photograph, retaining
    // every original coordinate and the explicit orientation assumption.
    const center = { x: sourceQuad.reduce((sum, point) => sum + point.x, 0) / 4, y: sourceQuad.reduce((sum, point) => sum + point.y, 0) / 4 };
    const ordered = [...sourceQuad].sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x));
    const first = ordered.reduce((best, point, at) => point.x + point.y < ordered[best].x + ordered[best].y ? at : best, 0), quad = ordered.slice(first).concat(ordered.slice(0, first));
    let issue = null;
    try { documentQuadTransform(quad); } catch (error) { issue = { code: 'invalid-source-quadrilateral', message: error.message }; }
    if (/^%.*%$/.test(source.text)) issue ??= { code: 'source-nonreadable-marker', marker: source.text };
    if (!source.text.trim()) issue ??= { code: 'empty-source-transcript' };
    return { id: `${page.id}:${index}`, page: page.id, pageSha256: page.sha256, annotationsSha256: page.annotationsSha256, partition: page.partition,
      index, text: source.text, type: source.type === 'H' ? 'handwritten' : 'printed', line: source.line_idx, quad, sourceQuad, orientation: 'supplied-page-upright; polygon order canonicalized from coordinates', issue, sourceTranscriptUnchanged: true };
  });
}

/** Pixel-only word preparation for actual photographs; no transcript geometry. */
export function handwritingPageWordPixels(luminance, quad, { signal, recipe = 'owned-quad-v1' } = {}) {
  if (recipe === HANDWRITING_RASTER_RECIPE.id) return prepareHandwritingRaster(luminance, { quad, signal });
  if (recipe !== 'owned-quad-v1') throw new TypeError('Declare an existing handwriting pixel recipe');
  const transform = documentQuadTransform(quad), width = Math.max(2, Math.min(252, Math.round(28 * transform.sourceWidth / transform.sourceHeight)));
  const crop = rectifyDocumentQuad(luminance, quad, { width, height: 28, signal }), threshold = documentOtsuThreshold(crop.data), pixels = new Uint8Array(256 * 32);
  for (let y = 0; y < 28; y++) for (let x = 0; x < width; x++) pixels[(y + 2) * 256 + x + 2] = crop.data[y * width + x] <= threshold && crop.data[y * width + x] < 250 ? 255 : 0;
  const normalized = normalizeHandwritingInk(pixels);
  return { ...normalized, provenance: { source: 'original-photograph-word-quadrilateral', transform: crop.transform, threshold: { method: 'owned-word-otsu', value: threshold }, normalizedInkHeight: 26, transcriptUsed: false } };
}

/** Stream one verified source photograph at a time for owned developer learning. */
export async function* iterateHandwritingPageWords(pages, { sourceUrl, signal, onProgress, recipe = 'owned-quad-v1' } = {}) {
  if (!Array.isArray(pages) || !pages.length || pages.length > 687 || typeof sourceUrl !== 'string') throw new TypeError('Declare bounded English source pages and their local URL');
  const base = new URL(sourceUrl, globalThis.location?.href);
  if (base.origin !== globalThis.location?.origin || !base.pathname.endsWith('/')) throw new TypeError('Handwriting photographs must come from the caller local origin');
  if (!['owned-quad-v1', HANDWRITING_RASTER_RECIPE.id].includes(recipe)) throw new TypeError('Declare an existing handwriting pixel recipe');
  const read = (file, expectedHash, maximumBytes) => readHandwritingBytes(new URL(file, base), expectedHash, maximumBytes, signal);
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex]; signal?.throwIfAborted();
    if (!page || !['training', 'validation', 'test'].includes(page.partition) || !['train', 'test'].includes(page.originalPartition) || (page.originalPartition === 'test') !== (page.partition === 'test') || !/^eng_[A-Z]{2}_[0-9]{3}$/.test(page.id) || page.file !== `${page.originalPartition}/${page.id}.jpg` || page.annotations !== `${page.originalPartition}/${page.id}.json` || !/^[a-f0-9]{64}$/.test(page.sha256) || !/^[a-f0-9]{64}$/.test(page.annotationsSha256)) throw new TypeError('Invalid original page paths or identity');
    const annotations = handwritingPageAnnotations(JSON.parse(new TextDecoder().decode(await read(page.annotations, page.annotationsSha256, 12000000))), page);
    const image = await read(page.file, page.sha256, 12000000), bitmap = await createImageBitmap(new Blob([image], { type: 'image/jpeg' })); let surface = null;
    try {
      if (bitmap.width > 16384 || bitmap.height > 16384 || bitmap.width * bitmap.height > 67108864) throw new RangeError('Original handwriting photograph exceeds its pixel budget');
      if (recipe === HANDWRITING_RASTER_RECIPE.id) {
        surface = new OffscreenCanvas(2, 2); const context = surface.getContext('2d', { willReadFrequently: true });
        for (const annotation of annotations) {
          signal?.throwIfAborted();
          if (annotation.issue) { yield { ...annotation, pixels: null, width: null, height: 32, preparationIssue: annotation.issue }; continue; }
          const x = Math.floor(Math.min(...annotation.quad.map(point => point.x))), y = Math.floor(Math.min(...annotation.quad.map(point => point.y)));
          const width = Math.ceil(Math.max(...annotation.quad.map(point => point.x))) - x, height = Math.ceil(Math.max(...annotation.quad.map(point => point.y))) - y;
          if (width < 2 || height < 2 || width > 4096 || height > 4096 || width * height > HANDWRITING_RASTER_RECIPE.maximumCropPixels) {
            yield { ...annotation, pixels: null, width: null, height: 32, preparationIssue: { code: 'source-word-raster-budget', requestedWidth: width, requestedHeight: height } }; continue;
          }
          surface.width = width; surface.height = height; context.fillStyle = '#fff'; context.fillRect(0, 0, width, height); context.drawImage(bitmap, x, y, width, height, 0, 0, width, height);
          const source = { width, height, data: imageLuminanceMap(context.getImageData(0, 0, width, height)) }, localQuad = annotation.quad.map(point => ({ x: point.x - x, y: point.y - y }));
          const prepared = handwritingPageWordPixels(source, localQuad, { signal, recipe });
          if (prepared.provenance.transform) {
            const matrix = mat3Multiply([1, 0, 0, 0, 1, 0, x, y, 1], prepared.provenance.transform.outputToSource);
            const inverse = handwritingRasterTransformReport(matrix, { ...prepared.provenance.transform, inkBox: prepared.inkBox });
            if (inverse.valid) { prepared.provenance.transform.outputToSource = Array.from(matrix); prepared.provenance.transform.sourceToOutput = inverse.sourceToOutput; }
            else { prepared.status = 'unsupported'; prepared.pixels = null; prepared.width = null; prepared.preparationIssue = { code: inverse.issue, maxOutputError: inverse.maxOutputError, maxSourceError: inverse.maxSourceError }; prepared.provenance.transform = null; }
          }
          yield { ...annotation, ...prepared, provenance: { ...prepared.provenance, originalPageSize: { width: bitmap.width, height: bitmap.height }, sourceSize: { width: bitmap.width, height: bitmap.height }, sourceQuad: annotation.sourceQuad, readingOrderQuad: annotation.quad, originalPixelCrop: { x, y, width, height }, pageReduction: { scaleX: 1, scaleY: 1 }, orientation: annotation.orientation } };
        }
        onProgress?.({ completedPages: pageIndex + 1, totalPages: pages.length, sourcePage: page.id, partition: page.partition, annotations: annotations.length });
        continue;
      }
      const fit = Math.min(1, Math.sqrt(4000000 / (bitmap.width * bitmap.height))), width = Math.max(2, Math.floor(bitmap.width * fit)), height = Math.max(2, Math.floor(bitmap.height * fit));
      surface = new OffscreenCanvas(width, height); const context = surface.getContext('2d', { willReadFrequently: true }); context.drawImage(bitmap, 0, 0, width, height);
      const source = { width, height, data: imageLuminanceMap(context.getImageData(0, 0, width, height)) }, scaleX = width / bitmap.width, scaleY = height / bitmap.height;
      for (const annotation of annotations) {
        signal?.throwIfAborted();
        if (annotation.issue) { yield { ...annotation, pixels: null, preparationIssue: annotation.issue }; continue; }
        const quad = annotation.quad.map(point => ({ x: point.x * scaleX, y: point.y * scaleY })), prepared = handwritingPageWordPixels(source, quad, { signal });
        yield { ...annotation, pixels: prepared.pixels, inkBox: prepared.inkBox, preparationIssue: prepared.inkBox ? null : { code: 'empty-observed-ink' }, provenance: { ...prepared.provenance, originalPageSize: { width: bitmap.width, height: bitmap.height }, pageReduction: { scaleX, scaleY }, sourceQuad: annotation.sourceQuad, orientation: annotation.orientation } };
      }
      onProgress?.({ completedPages: pageIndex + 1, totalPages: pages.length, sourcePage: page.id, partition: page.partition, annotations: annotations.length });
    } finally { bitmap.close(); if (surface) surface.width = surface.height = 0; }
  }
}

const preparedCorpora = new WeakMap();

/** Open hash-pinned developer pixel shards without loading original test pages. */
export async function openPreparedHandwritingCorpus({ indexUrl, indexSha256, signal } = {}) {
  if (typeof indexUrl !== 'string' || !/^[a-f0-9]{64}$/.test(indexSha256)) throw new TypeError('Pin the prepared handwriting index URL and SHA-256');
  const url = new URL(indexUrl, globalThis.location?.href);
  if (url.origin !== globalThis.location?.origin || !url.pathname.endsWith('/index.json')) throw new TypeError('Prepared handwriting must use a local index.json');
  const bytes = await readHandwritingBytes(url, indexSha256, 4_194_304, signal), index = JSON.parse(new TextDecoder().decode(bytes));
  const grayscale = index.schema === 'particle-realms.prepared-handwriting-corpus.v2';
  if (index.schema !== `particle-realms.prepared-handwriting-corpus.v${grayscale ? 2 : 1}` || index.id !== (grayscale ? 'gnhk-2021-owned-gray-aspect-v2' : 'gnhk-2021-owned-quad-v1') || grayscale && JSON.stringify(index.recipe) !== JSON.stringify(HANDWRITING_RASTER_RECIPE) || index.source?.archiveSha256 !== ENGLISH_HANDWRITING_SOURCE.archiveSha256 || index.writerDisjointVerified !== false || index.imageDisjointVerified !== true || index.testImagesLoaded !== false || index.testAnnotationsLoaded !== false || !/^[a-f0-9]{64}$/.test(index.sourceManifestSha256)) throw new TypeError('Prepared handwriting provenance differs');
  const original = Object.values(index.sourcePages ?? {}).flat().map(page => ({ ...page, partition: page.originalPartition }));
  const split = partitionHandwritingPages({ schema: 'particle-realms.handwriting-pages.v1', id: ENGLISH_HANDWRITING_SOURCE.id, mirror: { archiveSha256: ENGLISH_HANDWRITING_SOURCE.archiveSha256 }, license: ENGLISH_HANDWRITING_SOURCE.license, writerDisjointVerified: false, pages: original }, { seed: index.seed });
  const pages = new Map();
  for (const [partition, records] of Object.entries(split.partitions)) {
    if (JSON.stringify(records) !== JSON.stringify(index.sourcePages[partition])) throw new Error('Prepared page membership differs from its whole-image split');
    for (const page of records) pages.set(page.id, page);
  }
  if (!Array.isArray(index.shards) || !index.shards.length || index.shards.length > 2048) throw new RangeError('Prepared corpus shard count exceeds its budget');
  const totals = { training: 0, validation: 0 };
  for (const [ordinal, shard] of index.shards.entries()) {
    const pixelBounds = grayscale ? Number.isInteger(shard.pixelBytes) && shard.pixelBytes >= shard.pixelRows * 2048 && shard.pixelBytes <= shard.pixelRows * 16384 && shard.pixelBytes % 2048 === 0 : shard.pixelBytes === shard.pixelRows * 8192;
    if (shard.ordinal !== ordinal || !['training', 'validation'].includes(shard.partition) || !Number.isInteger(shard.rows) || shard.rows < 1 || shard.rows > 64 || !Number.isInteger(shard.pixelRows) || shard.pixelRows < 0 || shard.pixelRows > shard.rows || !pixelBounds || shard.metadataFile !== `${shard.partition}-${String(ordinal).padStart(5, '0')}.json` || shard.pixelsFile !== `${shard.partition}-${String(ordinal).padStart(5, '0')}.pixels` || !/^[a-f0-9]{64}$/.test(shard.metadataSha256) || !/^[a-f0-9]{64}$/.test(shard.pixelsSha256)) throw new TypeError('Invalid prepared shard bounds or provenance');
    totals[shard.partition] += shard.rows;
  }
  for (const partition of ['training', 'validation']) if (totals[partition] !== index.counts?.[partition]?.annotations || index.counts[partition].pages !== split.partitions[partition].length) throw new Error('Prepared corpus cardinality differs');
  const handle = Object.freeze({ id: index.id, indexSha256, sourceManifestSha256: index.sourceManifestSha256, source: ENGLISH_HANDWRITING_SOURCE, seed: index.seed, writerDisjointVerified: false, imageDisjointVerified: true, counts: Object.freeze({ training: totals.training, validation: totals.validation }), shardCount: index.shards.length, ...(grayscale ? { recipe: HANDWRITING_RASTER_RECIPE } : {}) });
  preparedCorpora.set(handle, { base: new URL('./', url), index, pages, grayscale }); return handle;
}

/** Yield verified rows from one bounded shard at a time; no silent filtering. */
export async function* iteratePreparedHandwritingWords(corpus, { partition, signal, onProgress } = {}) {
  const state = preparedCorpora.get(corpus); if (!state || !['training', 'validation'].includes(partition)) throw new TypeError('Use an opened prepared corpus and training or validation partition');
  const shards = state.index.shards.filter(shard => shard.partition === partition), ids = new Set(); let completed = 0;
  for (const shard of shards) {
    signal?.throwIfAborted();
    const metadata = JSON.parse(new TextDecoder().decode(await readHandwritingBytes(new URL(shard.metadataFile, state.base), shard.metadataSha256, 1_048_576, signal)));
    const pixels = await readHandwritingBytes(new URL(shard.pixelsFile, state.base), shard.pixelsSha256, state.grayscale ? 1_048_576 : 524288, signal);
    if (metadata.schema !== `particle-realms.prepared-handwriting-shard.v${state.grayscale ? 2 : 1}` || metadata.partition !== partition || metadata.width !== (state.grayscale ? null : 256) || metadata.height !== 32 || !Array.isArray(metadata.rows) || metadata.rows.length !== shard.rows || pixels.length !== shard.pixelBytes) throw new Error('Prepared shard layout differs');
    const pixelIndices = new Set(); let pixelOffset = 0;
    for (const row of metadata.rows) {
      signal?.throwIfAborted(); const page = state.pages.get(row.page);
      if (!page || page.partition !== partition || row.partition !== partition || row.pageSha256 !== page.sha256 || row.annotationsSha256 !== page.annotationsSha256 || !Number.isInteger(row.index) || row.index < 0 || row.index >= 4000 || row.id !== `${page.id}:${row.index}` || ids.has(row.id) || typeof row.text !== 'string' || row.text.length > 512 || !['handwritten', 'printed'].includes(row.type) || row.sourceTranscriptUnchanged !== true) throw new Error('Prepared word escaped its source identity or partition');
      ids.add(row.id); const hasPixels = row.pixelIndex !== null;
      if (hasPixels && (!Number.isInteger(row.pixelIndex) || row.pixelIndex < 0 || row.pixelIndex >= shard.pixelRows || pixelIndices.has(row.pixelIndex))) throw new Error('Prepared pixel index is invalid or reused');
      if (!hasPixels && !row.preparationIssue) throw new Error('Missing prepared pixels have no recorded issue');
      if (state.grayscale && hasPixels && (![64, 128, 256, 512].includes(row.width) || row.height !== 32 || row.pixelOffset !== pixelOffset || row.pixelIndex !== pixelIndices.size || row.provenance?.recipe?.id !== HANDWRITING_RASTER_RECIPE.id || row.provenance.pixelsBinarized !== false || pixelOffset + row.width * 32 > pixels.length)) throw new Error('Prepared grayscale width, recipe or offset differs');
      if (hasPixels) pixelIndices.add(row.pixelIndex);
      const start = state.grayscale ? pixelOffset : row.pixelIndex * 8192, length = state.grayscale ? row.width * 32 : 8192;
      yield { ...row, file: row.id, sha256: row.pageSha256, writer: null, pixels: hasPixels ? pixels.slice(start, start + length) : null };
      if (hasPixels && state.grayscale) pixelOffset += length;
      completed++;
    }
    if (pixelIndices.size !== shard.pixelRows || state.grayscale && pixelOffset !== pixels.length) throw new Error('Prepared shard contains unreferenced pixels');
    onProgress?.({ partition, completed, total: corpus.counts[partition], ordinal: shard.ordinal });
  }
  if (completed !== corpus.counts[partition]) throw new Error('Prepared corpus lost source rows');
}
