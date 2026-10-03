// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { imageDataReport, imageLuminanceMap, imageCopyRect, imageSampleBilinear } from './ImageMath.js';
import { statsMedian } from './MathStatistics.js';
import { clamp } from './MathScalar.js';

export const DOCUMENT_GLYPH_FEATURE_SIZE = 580;
export const DOCUMENT_GLYPH_RASTER_SIZE = 24;
export const DOCUMENT_IMAGE_MAX_PIXELS = 4_000_000;

function failure(code, message) { const error = new Error(message); error.code = code; return error; }
function integer(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw failure('DOCUMENT_IMAGE_INVALID', `${name} must be an integer in [${min}, ${max}]`);
  return value;
}
function imageInput(image, maxPixels) {
  const report = imageDataReport(image);
  if (!report.valid || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height)
    || report.extraByteLength || !(image.data instanceof Uint8Array || image.data instanceof Uint8ClampedArray)) throw failure('DOCUMENT_IMAGE_INVALID', 'Document image requires exact RGBA byte dimensions');
  if (report.width > 16384 || report.height > 16384) throw failure('DOCUMENT_IMAGE_INVALID', 'Document raster dimensions may not exceed 16384 pixels');
  if (report.pixelCount > maxPixels) throw failure('DOCUMENT_IMAGE_TOO_LARGE', `Rasterize or tile this page to at most ${maxPixels} pixels`);
  return report;
}
function whiteRgba(image) {
  const data = new Uint8ClampedArray(image.data.length);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = image.data[i + 3] / 255;
    for (let c = 0; c < 3; c++) data[i + c] = image.data[i + c] * alpha + 255 * (1 - alpha);
    data[i + 3] = 255;
  }
  return { data, width: image.width, height: image.height };
}
function grayRgba(gray, width, box) {
  const data = new Uint8ClampedArray(box.width * box.height * 4);
  for (let y = 0; y < box.height; y++) for (let x = 0; x < box.width; x++) {
    const i = (y * box.width + x) * 4, value = gray[(box.y + y) * width + box.x + x];
    data[i] = data[i + 1] = data[i + 2] = value; data[i + 3] = 255;
  }
  return { data, width: box.width, height: box.height };
}
function featuresFromCrop(crop, box, options) {
  const side = DOCUMENT_GLYPH_RASTER_SIZE, output = new Float32Array(DOCUMENT_GLYPH_FEATURE_SIZE);
  const scale = 22 / Math.max(box.width, box.height), left = (side - box.width * scale) / 2, top = (side - box.height * scale) / 2;
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const sx = (x + .5 - left) / scale - .5, sy = (y + .5 - top) / scale - .5;
    if (sx < -.5 || sy < -.5 || sx > crop.width - .5 || sy > crop.height - .5) continue;
    const rgba = imageSampleBilinear(crop, sx, sy, { edgeMode: 'clamp' });
    output[y * side + x] = clamp(1 - (rgba[0] * .2126 + rgba[1] * .7152 + rgba[2] * .0722) / 255, 0, 1);
  }
  const lineHeight = Number(options.lineHeight ?? box.height), baseline = Number(options.baseline ?? box.y + box.height);
  if (!(lineHeight > 0) || !Number.isFinite(lineHeight) || !Number.isFinite(baseline)) throw failure('DOCUMENT_IMAGE_INVALID', 'Glyph line metrics must be finite');
  output[576] = Math.min(2, box.width / box.height) / 2;
  output[577] = Math.min(2, box.height / lineHeight) / 2;
  output[578] = clamp((baseline - box.y) / lineHeight, 0, 2) / 2;
  output[579] = Math.min(2, box.width / lineHeight) / 2;
  return output;
}

/** Same normalized ink and geometric features for recognition and training. */
export function extractGlyphFeatures(image, bbox, options = {}) {
  const report = imageInput(image, DOCUMENT_IMAGE_MAX_PIXELS);
  const box = { x: integer(Math.floor(bbox.x), 'glyph x', 0, report.width - 1), y: integer(Math.floor(bbox.y), 'glyph y', 0, report.height - 1),
    width: integer(Math.ceil(bbox.width), 'glyph width', 1, report.width), height: integer(Math.ceil(bbox.height), 'glyph height', 1, report.height) };
  if (box.x + box.width > report.width || box.y + box.height > report.height) throw failure('DOCUMENT_IMAGE_INVALID', 'Glyph box escapes the input image');
  return featuresFromCrop(whiteRgba(imageCopyRect(image, box)), box, options);
}

/** Between-class variance threshold with deterministic ties and bounded bins. */
export function documentOtsuThreshold(gray) {
  if (!(gray instanceof Float32Array || gray instanceof Float64Array || gray instanceof Uint8Array || gray instanceof Uint8ClampedArray)
    || gray.length > DOCUMENT_IMAGE_MAX_PIXELS) throw failure('DOCUMENT_IMAGE_INVALID', 'Otsu threshold requires a bounded numeric pixel array');
  const bins = new Uint32Array(256); let total = 0;
  for (const value of gray) {
    if (!Number.isFinite(value)) throw failure('DOCUMENT_IMAGE_INVALID', 'Document gray pixels must be finite');
    const bin = clamp(Math.round(value), 0, 255); bins[bin]++; total += bin;
  }
  let lowerWeight = 0, lowerSum = 0, best = -1, threshold = 127;
  for (let t = 0; t < 255; t++) {
    lowerWeight += bins[t]; lowerSum += bins[t] * t;
    if (!lowerWeight || lowerWeight === gray.length) continue;
    const upperWeight = gray.length - lowerWeight, delta = lowerSum / lowerWeight - (total - lowerSum) / upperWeight;
    const score = lowerWeight * upperWeight * delta * delta;
    if (score > best) { best = score; threshold = t; }
  }
  return threshold;
}

function thresholdImage(gray, width, height, mode, guard) {
  const mask = new Uint8Array(gray.length), threshold = documentOtsuThreshold(gray);
  if (mode === 'otsu') {
    for (let i = 0; i < gray.length; i++) { if ((i & 65535) === 0) guard(); mask[i] = gray[i] <= threshold && gray[i] < 250 ? 1 : 0; }
    return { mask, threshold };
  }
  const stride = width + 1, sums = new Float64Array(stride * (height + 1)), squares = new Float64Array(sums.length);
  for (let y = 0; y < height; y++) {
    guard(); let row = 0, rowSquare = 0;
    for (let x = 0; x < width; x++) { const value = gray[y * width + x], p = (y + 1) * stride + x + 1; row += value; rowSquare += value * value; sums[p] = sums[p - stride] + row; squares[p] = squares[p - stride] + rowSquare; }
  }
  const radius = clamp(Math.round(Math.min(width, height) / 60), 7, 25);
  for (let y = 0; y < height; y++) {
    guard();
    const top = Math.max(0, y - radius), bottom = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - radius), right = Math.min(width, x + radius + 1), count = (bottom - top) * (right - left);
      const a = top * stride + left, b = top * stride + right, c = bottom * stride + left, d = bottom * stride + right;
      const mean = (sums[d] - sums[b] - sums[c] + sums[a]) / count;
      const variance = Math.max(0, (squares[d] - squares[b] - squares[c] + squares[a]) / count - mean * mean);
      const local = Math.min(mean - 3, mean * (1 + .12 * (Math.sqrt(variance) / 128 - 1)));
      mask[y * width + x] = gray[y * width + x] < local ? 1 : 0;
    }
  }
  return { mask, threshold };
}

function estimateSkew(mask, width, height, guard) {
  const points = [], stride = Math.max(1, Math.ceil(mask.length / 300000));
  for (let i = 0; i < mask.length; i += stride) if (mask[i]) points.push([i % width - width / 2, Math.floor(i / width) - height / 2]);
  if (points.length < 50) return { angleDegrees: 0, confidence: 0 };
  const sampleStep = Math.max(1, Math.ceil(points.length / 30000));
  function score(angle) {
    guard(); const radians = angle * Math.PI / 180, cosine = Math.cos(radians), sine = Math.sin(radians), rows = new Uint32Array(height + width);
    for (let i = 0; i < points.length; i += sampleStep) { const p = points[i], y = Math.round(-sine * p[0] + cosine * p[1] + rows.length / 2); if (y >= 0 && y < rows.length) rows[y]++; }
    let energy = 0; for (const count of rows) energy += count * count; return energy;
  }
  const zero = score(0); let best = zero, angle = 0;
  for (let candidate = -7; candidate <= 7; candidate += .5) { const value = score(candidate); if (value > best) { best = value; angle = candidate; } }
  const coarse = angle;
  for (let offset = -.4; offset <= .4; offset += .1) { const candidate = coarse + offset, value = score(candidate); if (value > best) { best = value; angle = candidate; } }
  return { angleDegrees: best > zero * 1.035 && Math.abs(angle) >= .15 ? Math.round(angle * 10) / 10 : 0, confidence: zero ? clamp((best / zero - 1) / .5, 0, 1) : 0 };
}

function rotateGray(gray, width, height, degrees, guard) {
  if (!degrees) return gray;
  const radians = degrees * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians), output = new Float32Array(gray.length);
  const read = (x, y) => x >= 0 && y >= 0 && x < width && y < height ? gray[y * width + x] : 255;
  for (let y = 0; y < height; y++) {
    guard(); for (let x = 0; x < width; x++) {
      const dx = x - width / 2, dy = y - height / 2, sx = c * dx - s * dy + width / 2, sy = s * dx + c * dy + height / 2;
      const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
      output[y * width + x] = (read(ix, iy) * (1 - fx) + read(ix + 1, iy) * fx) * (1 - fy) + (read(ix, iy + 1) * (1 - fx) + read(ix + 1, iy + 1) * fx) * fy;
    }
  }
  return output;
}

/** Eight-connected document ink components, independent from Paint's mutation UI. */
export function documentInkComponents(mask, width, height, { guard = () => {}, maxComponents = 20000 } = {}) {
  integer(width, 'mask width', 1, 16384); integer(height, 'mask height', 1, 16384); integer(maxComponents, 'maxComponents', 1, 40000);
  if (!(mask instanceof Uint8Array) || mask.length !== width * height || mask.length > DOCUMENT_IMAGE_MAX_PIXELS) throw failure('DOCUMENT_IMAGE_INVALID', 'Invalid or oversized document mask');
  const seen = new Uint8Array(mask.length), queue = new Uint32Array(mask.length), components = [];
  for (let start = 0; start < mask.length; start++) {
    if ((start & 65535) === 0) guard();
    if (seen[start] || !mask[start]) continue;
    let head = 0, tail = 1, left = start % width, right = left, top = Math.floor(start / width), bottom = top;
    let sumX = 0, sumY = 0, sumXX = 0, sumYY = 0, sumXY = 0; queue[0] = start; seen[start] = 1;
    while (head < tail) {
      if ((head & 16383) === 0) guard();
      const pixel = queue[head++], x = pixel % width, y = Math.floor(pixel / width);
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      sumX += x; sumY += y; sumXX += x * x; sumYY += y * y; sumXY += x * y;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const nx = x + ox, ny = y + oy, next = ny * width + nx;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || seen[next] || !mask[next]) continue;
        seen[next] = 1; queue[tail++] = next;
      }
    }
    const varianceX = Math.max(0, sumXX - sumX * sumX / tail), varianceY = Math.max(0, sumYY - sumY * sumY / tail);
    const correlation = varianceX && varianceY ? clamp((sumXY - sumX * sumY / tail) / Math.sqrt(varianceX * varianceY), -1, 1) : 0;
    components.push({ id: components.length, x: left, y: top, width: right - left + 1, height: bottom - top + 1, area: tail, inkCorrelation: correlation });
    if (components.length > maxComponents) throw failure('DOCUMENT_IMAGE_COMPONENT_LIMIT', 'Page contains too many isolated ink components; crop or clean it first');
  }
  return components;
}

function union(boxes) {
  const left = Math.min(...boxes.map(b => b.x)), top = Math.min(...boxes.map(b => b.y));
  return { x: left, y: top, width: Math.max(...boxes.map(b => b.x + b.width)) - left, height: Math.max(...boxes.map(b => b.y + b.height)) - top };
}
const overlap = (a, b) => Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

// Assemble only compact, independently evidenced multi-part shapes. Reading the
// component crops separately can otherwise read a whole fraction and its digits.
function compoundInk(components, bodyHeight, guard, recognitionProfile) {
  const cell = Math.max(8, bodyHeight), buckets = new Map(), used = new Set(), combined = [];
  const cx = box => box.x + box.width / 2, cy = box => box.y + box.height / 2;
  for (const part of components) { const key = Math.floor(cx(part) / cell) + ':' + Math.floor(cy(part) / cell); const rows = buckets.get(key) || []; rows.push(part); buckets.set(key, rows); }
  const nearby = (core, radius) => {
    const rows = [];
    for (let x = Math.floor((cx(core) - radius) / cell); x <= Math.floor((cx(core) + radius) / cell); x++) {
      guard(); for (let y = Math.floor((cy(core) - radius) / cell); y <= Math.floor((cy(core) + radius) / cell); y++)
        for (const part of buckets.get(x + ':' + y) || []) if (part !== core && !used.has(part.id) && part.area >= 2) rows.push(part);
    }
    return rows;
  };
  const combine = (core, parts, evidence) => { const all = [core, ...parts]; all.forEach(part => used.add(part.id)); combined.push({ ...core, ...union(all), area: all.reduce((sum, part) => sum + part.area, 0), componentIds: all.map(part => part.id), compoundEvidence: evidence }); };
  if (recognitionProfile === 'handprint') {
    const compatible = (a, b) => {
      const xOverlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x), height = Math.max(a.height, b.height);
      const verticalGap = Math.max(a.y - b.y - b.height, b.y - a.y - a.height, 0), box = union([a, b]);
      const shorter = a.height < b.height ? a : b;
      // A separated horizontal cross-stroke can be thin yet substantial; a
      // small isolated noise dot must not establish this compound candidate.
      const substantial = shorter.height >= height * .18 || shorter.width >= height * .5 && shorter.width >= shorter.height * 2;
      return substantial && xOverlap >= Math.min(a.width, b.width) * .5
        && verticalGap <= height * .35 && box.width <= box.height * 1.6 && box.height <= 512 && box.width <= 512;
    };
    const partners = core => nearby(core, Math.max(bodyHeight, core.height) * 1.5).filter(part => compatible(core, part));
    for (const core of components) {
      guard(); if (used.has(core.id) || core.area < 2) continue;
      const matches = partners(core);
      // Ambiguous three-way intersections are left separate. A confirmed pair
      // preserves both source component IDs and always requires text review.
      if (matches.length === 1 && partners(matches[0]).length === 1) combine(core, matches, 'handprint-overlapping-strokes');
    }
  }
  for (const core of components) {
    guard(); const h = core.height;
    if (used.has(core.id) || h < 10 || h > Math.max(48, bodyHeight * 3) || core.width < h * .15 || core.width > h * .9 || core.inkCorrelation > -.8 || core.area > core.width * h * .6) continue;
    const corners = nearby(core, h).filter(part => part.height >= h * .18 && part.height <= h * .8 && part.width <= h * .65 && part.y >= core.y - h * .15 && part.y + part.height <= core.y + h * 1.15);
    const upper = corners.filter(part => cy(part) < core.y + h * .45 && cx(part) < cx(core) && part.x + part.width >= core.x - 1 && part.x < core.x + core.width * .6);
    const lower = corners.filter(part => cy(part) > core.y + h * .55 && cx(part) > cx(core) && part.x <= core.x + core.width + 1 && part.x + part.width > core.x + core.width * .4);
    if (upper.length === 1 && lower.length === 1 && upper[0] !== lower[0] && union([core, upper[0], lower[0]]).width <= h * 1.6) combine(core, [upper[0], lower[0]], 'rising-diagonal-with-opposite-corners');
  }
  for (const core of components) {
    guard(); const w = core.width;
    if (used.has(core.id) || w < 5 || w > Math.max(24, bodyHeight * 1.8) || core.height > Math.max(3, w * .2) || w / core.height < 3) continue;
    const neighbors = nearby(core, w), centered = part => Math.abs(cx(part) - cx(core)) <= Math.max(1, w * .12);
    const dots = neighbors.filter(part => centered(part) && part.width <= w * .35 && part.height <= w * .35 && Math.abs(part.width - part.height) <= Math.max(2, w * .12));
    const above = dots.filter(part => part.y + part.height <= core.y && core.y - part.y - part.height <= w * .55);
    const below = dots.filter(part => part.y >= core.y + core.height && part.y - core.y - core.height <= w * .55);
    if (above.length === 1 && below.length === 1 && Math.abs(cy(core) - cy(above[0]) - (cy(below[0]) - cy(core))) <= Math.max(2, w * .15)) { combine(core, [above[0], below[0]], 'centered-bar-and-dots'); continue; }
    const bars = neighbors.filter(part => centered(part) && part.width >= w * .8 && part.width <= w * 1.2 && part.height <= Math.max(3, w * .2)
      && part.width / part.height >= 3 && part.y > core.y + core.height && part.y - core.y - core.height <= w * .5);
    if (bars.length === 1 && union([core, bars[0]]).height <= w * .8) combine(core, bars, 'aligned-parallel-bars');
  }
  return [...components.filter(part => !used.has(part.id)), ...combined];
}

// Word spaces depend on a line's advances and side bearings, not just ink height.
// Require repeated geometric evidence before replacing the conservative fallback.
function lineWordSpacing(ordered, lineHeight, guard, recognitionProfile) {
  const fallback = lineHeight * .35, pairs = [];
  for (let index = 1; index < ordered.length; index++) {
    const before = ordered[index - 1], after = ordered[index];
    pairs.push({ gap: Math.max(0, after.x - before.x - before.width), advance: after.x + after.width / 2 - before.x - before.width / 2,
      body: before.height >= lineHeight * .55 && after.height >= lineHeight * .55,
      regular: before.width <= lineHeight * 1.6 && after.width <= lineHeight * 1.6 });
  }
  // A wide joined candidate does not have a known character center. Keep its
  // gap evidence, but do not let it establish or contradict a character pitch.
  const regularPairs = pairs.filter(pair => pair.regular), bodyAdvances = regularPairs.filter(pair => pair.body && pair.advance > 0).map(pair => pair.advance);
  if (recognitionProfile === 'handprint' && bodyAdvances.length >= 3) {
    // Handprinting has variable side bearings and does not promise a font's
    // integer character pitch. Require two separated advance groups *and* a
    // larger clear-ink gap for the wide group before joining ordinary letters.
    const orderedPairs = regularPairs.filter(pair => pair.body && pair.advance > 0).sort((a, b) => a.advance - b.advance);
    const total = orderedPairs.reduce((sum, pair) => sum + pair.advance, 0), squares = orderedPairs.reduce((sum, pair) => sum + pair.advance ** 2, 0);
    let lower = 0, lowerSquares = 0, best = null;
    for (let at = 0; at < orderedPairs.length - 1; at++) {
      guard(); lower += orderedPairs[at].advance; lowerSquares += orderedPairs[at].advance ** 2;
      const count = at + 1, remaining = orderedPairs.length - count;
      if (count < 2 || orderedPairs[at + 1].advance - orderedPairs[at].advance < Math.max(2, lineHeight * .15)) continue;
      const small = lower / count, large = (total - lower) / remaining, error = Math.max(0, lowerSquares - lower ** 2 / count + squares - lowerSquares - (total - lower) ** 2 / remaining);
      if (large < small * 1.45 || orderedPairs[at + 1].advance < small * 1.3 || large - small < Math.max(lineHeight * .35, 2.75 * Math.sqrt(error / orderedPairs.length))) continue;
      const smallGap = statsMedian(orderedPairs.slice(0, count).map(pair => pair.gap)), largeGroup = orderedPairs.slice(count);
      if (largeGroup.some(pair => pair.gap <= fallback) || statsMedian(largeGroup.map(pair => pair.gap)) - smallGap < lineHeight * .3) continue;
      if (!best || error < best.error) best = { error, threshold: (orderedPairs[at].advance + orderedPairs[at + 1].advance) / 2 };
    }
    if (best) return { method: 'handprint-separated-advances', advanceThreshold: best.threshold, gapThreshold: fallback,
      boundaries: pairs.map(pair => pair.regular ? pair.advance > best.threshold && pair.gap > fallback : pair.gap > fallback) };
    const median = statsMedian(bodyAdvances), minimum = Math.min(...bodyAdvances), maximum = Math.max(...bodyAdvances);
    if (median >= lineHeight * .4 && median <= lineHeight * 1.8 && maximum - minimum <= median * .35
      && regularPairs.length === pairs.length && regularPairs.every(pair => pair.advance >= median * .75 && pair.advance <= median * 1.25 && pair.gap < median * .9)) {
      return { method: 'handprint-consistent-advances', pitch: median, gapThreshold: fallback, boundaries: pairs.map(() => false) };
    }
  }
  const longEvidence = bodyAdvances.length >= 6 && regularPairs.length >= 8;
  if (longEvidence || bodyAdvances.length >= 3 && regularPairs.length >= 5) {
    const median = statsMedian(bodyAdvances), pitch = statsMedian(bodyAdvances.filter(value => value >= median * .65 && value <= median * 1.35));
    if (pitch >= lineHeight * .3 && pitch <= lineHeight * 1.4) {
      const near = pair => { const cells = Math.round(pair.advance / pitch); return cells >= 1 && cells <= 8 && Math.abs(pair.advance - cells * pitch) <= pitch * .12; };
      const matched = regularPairs.filter(near), singles = matched.filter(pair => Math.round(pair.advance / pitch) === 1);
      // Short numeric labels need stronger agreement than a long text line.
      if (matched.length >= regularPairs.length * (longEvidence ? .85 : 1) && singles.length >= (longEvidence ? 6 : 4)) return {
        method: 'repeated-advances', pitch, gapThreshold: fallback,
        boundaries: pairs.map(pair => pair.regular && near(pair) ? Math.round(pair.advance / pitch) >= 2 : pair.gap > fallback),
      };
    }
  }
  const gaps = pairs.filter(pair => pair.body && pair.gap > 0).map(pair => pair.gap).sort((a, b) => a - b);
  let threshold = fallback, method = 'height-fallback';
  if (gaps.length >= 5) {
    const total = gaps.reduce((sum, value) => sum + value, 0), totalSquare = gaps.reduce((sum, value) => sum + value * value, 0);
    let lower = 0, lowerSquare = 0, best = null;
    for (let index = 0; index < gaps.length - 1; index++) {
      if ((index & 63) === 0) guard();
      lower += gaps[index]; lowerSquare += gaps[index] * gaps[index];
      const count = index + 1, remaining = gaps.length - count;
      if (count < 3 || gaps[index + 1] - gaps[index] < Math.max(1, lineHeight * .07)) continue;
      const small = lower / count, large = (total - lower) / remaining;
      const error = Math.max(0, lowerSquare - lower * lower / count + totalSquare - lowerSquare - (total - lower) ** 2 / remaining);
      if (large < small * 1.8 || large - small < lineHeight * .1 || large - small < 2.5 * Math.sqrt(error / gaps.length)) continue;
      if (!best || error < best.error) best = { error, threshold: (gaps[index] + gaps[index + 1]) / 2 };
    }
    // Very wide word spaces can pull a two-group fit above narrower real spaces.
    // Gap-only evidence may recover a tight space, but cannot erase an existing
    // height-based boundary. Only the separately verified fixed-advance model
    // can explain that large ink gap as a narrow glyph's side bearings.
    if (best && best.threshold < fallback) { threshold = best.threshold; method = 'separated-gap-groups'; }
  }
  return { method, gapThreshold: threshold, boundaries: pairs.map(pair => pair.gap > threshold) };
}

function segmentInk(components, width, height, issues, guard, recognitionProfile) {
  const eligible = components.filter(c => c.area >= 2 && c.height >= 2 && c.width < width * .9 && c.width / c.height < 12);
  const bodyHeight = Math.max(3, statsMedian(eligible.filter(c => c.area >= 5).map(c => c.height)) || 12);
  components = compoundInk(components, bodyHeight, guard, recognitionProfile);
  const textBodies = components.filter(part => part.area >= 5 && part.height >= bodyHeight * .6 && part.height <= bodyHeight * 1.8 && part.width <= bodyHeight * 1.8);
  const glyphs = [], small = [];
  for (const component of components) {
    guard();
    if (component.area < 2) continue;
    const thin = component.width / component.height > 12;
    const inlineStroke = thin && component.width <= bodyHeight * 2 && textBodies.filter(part => overlap(part, component) >= component.height * .5
      && Math.max(part.x - component.x - component.width, component.x - part.x - part.width, 0) <= bodyHeight * 6).length >= 2;
    // A cropped handwritten character can occupy more than 6% of its image.
    // Admit bounded, non-solid character-shaped ink in the explicit handprint
    // profile; keep page-artwork/ruling defaults for all existing consumers.
    const croppedHandprint = recognitionProfile === 'handprint' && component.width <= 512 && component.height <= 512
      && component.width <= component.height * 2 && (component.area < component.width * component.height * .85 || component.width <= component.height * .35);
    const maximumPageInk = width * height * (croppedHandprint ? .65 : .06);
    if (thin && !inlineStroke || component.height > Math.max(bodyHeight * 4, height * .25) || component.area > maximumPageInk) { issues.push({ code: 'graphics-region', bbox: component, message: 'Large artwork or ruling excluded from text recognition' }); continue; }
    const glyph = { ...component, componentIds: component.componentIds || [component.id] };
    if (component.compoundEvidence === 'handprint-overlapping-strokes') {
      glyph.unsupported = 'handprint-stroke-group';
      issues.push({ code: 'handprint-stroke-group', bbox: component, message: 'Disconnected overlapping strokes were grouped; review this character' });
    }
    if (component.height < bodyHeight * .48) small.push(glyph); else glyphs.push(glyph);
  }
  // Two similar small marks stacked in one otherwise empty column are one colon
  // or semicolon, not two periods. Pair them before any mark can become a dot.
  const stacked = new Set(), columnOverlap = (a, b) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  for (const upper of small) {
    guard(); if (stacked.has(upper) || upper.width > bodyHeight * .45) continue;
    const lower = small.filter(mark => mark !== upper && !stacked.has(mark) && mark.width <= bodyHeight * .45
      && columnOverlap(upper, mark) >= Math.min(upper.width, mark.width) * .5
      && mark.y - upper.y - upper.height >= bodyHeight * .12 && mark.y - upper.y - upper.height <= bodyHeight * .9
      && mark.height <= upper.height * 2.6 + 1 && upper.height <= mark.height * 1.6 + 1);
    if (lower.length !== 1 || glyphs.some(glyph => columnOverlap(glyph, upper) > 0 && glyph.y < lower[0].y + lower[0].height && glyph.y + glyph.height > upper.y)) continue;
    stacked.add(upper); stacked.add(lower[0]);
    glyphs.push({ ...upper, ...union([upper, lower[0]]), area: upper.area + lower[0].area, componentIds: [...upper.componentIds, ...lower[0].componentIds], compoundEvidence: 'stacked-marks' });
  }
  for (const mark of small) {
    if (stacked.has(mark)) continue;
    let candidate = null, distance = Infinity;
    for (const glyph of glyphs) {
      const xOverlap = Math.min(glyph.x + glyph.width, mark.x + mark.width) - Math.max(glyph.x, mark.x);
      const aboveGap = glyph.y - (mark.y + mark.height), belowGap = mark.y - (glyph.y + glyph.height);
      const gap = aboveGap >= -1 ? aboveGap : belowGap;
      if (glyph.height >= bodyHeight * .48 && xOverlap > 0 && gap >= -1 && gap < bodyHeight * (aboveGap >= -1 ? .65 : .4)
        && mark.width <= glyph.width * 1.5 + 2 && gap < distance) { candidate = glyph; distance = gap; }
    }
    if (candidate) { const box = union([candidate, mark]); Object.assign(candidate, box); candidate.area += mark.area; candidate.componentIds.push(...mark.componentIds); }
    else glyphs.push(mark);
  }
  const lines = [];
  for (const glyph of glyphs.sort((a, b) => a.y + a.height / 2 - b.y - b.height / 2 || a.x - b.x)) {
    guard(); let best = null, bestOverlap = 0;
    for (const line of lines) {
      const common = overlap(glyph, line.bbox) / Math.max(1, Math.min(glyph.height, line.bbox.height));
      if (common > .35 && common > bestOverlap) { best = line; bestOverlap = common; }
    }
    if (!best) { best = { glyphs: [], bbox: glyph }; lines.push(best); }
    best.glyphs.push(glyph); best.bbox = union(best.glyphs);
  }
  const output = [];
  for (const line of lines.sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x)) {
    const ordered = line.glyphs.sort((a, b) => a.x - b.x), heights = ordered.filter(g => g.height >= bodyHeight * .55).map(g => g.height).sort((a, b) => a - b);
    const lineHeight = heights[Math.min(heights.length - 1, Math.floor(heights.length * .8))] || bodyHeight;
    const baseline = statsMedian(ordered.filter(g => g.height >= lineHeight * .65).map(g => g.y + g.height)) || line.bbox.y + line.bbox.height;
    const spacing = lineWordSpacing(ordered, lineHeight, guard, recognitionProfile);
    let wordIndex = 0;
    for (const [index, glyph] of ordered.entries()) {
      if (index && spacing.boundaries[index - 1]) wordIndex++;
      glyph.wordIndex = wordIndex;
      if (glyph.width > lineHeight * 1.6) { glyph.unsupported = 'joined-glyphs-or-artwork'; issues.push({ code: 'joined-glyphs-or-artwork', bbox: glyph, message: 'Connected wide ink requires review; glyph boundaries are uncertain' }); }
    }
    const { boundaries, ...spacingEvidence } = spacing;
    output.push({ ...line, lineHeight, baseline, spacing: spacingEvidence, glyphs: ordered });
  }
  return output;
}

function originalGeometry(box, width, height, degrees) {
  const radians = degrees * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians);
  const quad = [[box.x, box.y], [box.x + box.width, box.y], [box.x + box.width, box.y + box.height], [box.x, box.y + box.height]].map(([x, y]) => ({
    x: c * (x - width / 2) - s * (y - height / 2) + width / 2,
    y: s * (x - width / 2) + c * (y - height / 2) + height / 2,
  }));
  const x = clamp(Math.min(...quad.map(p => p.x)), 0, width), y = clamp(Math.min(...quad.map(p => p.y)), 0, height);
  return { quad, bbox: { x, y, width: clamp(Math.max(...quad.map(p => p.x)), 0, width) - x, height: clamp(Math.max(...quad.map(p => p.y)), 0, height) - y } };
}

/** Observe bounded vertical partitions without deleting ink or replacing a glyph.
 * The intact features remain authoritative until a caller compares recognition
 * evidence. Child features are a separate buffer with their own row indices.
 */
export function documentGlyphPartitions(analysis, options = {}) {
  const started = performance.now(), budgetMs = integer(options.budgetMs ?? 250, 'partition budgetMs', 1, 1000);
  const maxRegions = integer(options.maxRegions ?? 32, 'partition maxRegions', 0, 32), maxCuts = integer(options.maxCuts ?? 6, 'partition maxCuts', 1, 6);
  const { width, height, mask, gray, lines, transforms } = analysis || {};
  integer(width, 'partition width', 1, 16384); integer(height, 'partition height', 1, 16384);
  if (analysis.recognitionProfile !== undefined && !['printed', 'handprint'].includes(analysis.recognitionProfile)) throw failure('DOCUMENT_IMAGE_INVALID', 'Glyph partitions require a known document recognition profile');
  if (!(mask instanceof Uint8Array) || !(gray instanceof Float32Array) || mask.length !== width * height || gray.length !== mask.length
    || mask.length > DOCUMENT_IMAGE_MAX_PIXELS || !Array.isArray(lines) || lines.length > 10000 || !Number.isFinite(transforms?.deskewDegrees)
    || lines.some(line=>!Array.isArray(line?.glyphs)||line.glyphs.length>10000||!Number.isFinite(line.lineHeight)||line.lineHeight<=0||!Number.isFinite(line.baseline))
    || lines.reduce((sum,line)=>sum+line.glyphs.length,0)>10000) throw failure('DOCUMENT_IMAGE_INVALID', 'Glyph partitions require bounded document-analysis pixels and geometry');
  const partitions = [], featureRows = [], issues = [], allGlyphs = lines.flatMap(line => line.glyphs);
  if(allGlyphs.length>10000||allGlyphs.some(glyph=>{const box=glyph?.analysisBox;return !box||![box.x,box.y,box.width,box.height].every(Number.isSafeInteger)
    ||box.x<0||box.y<0||box.width<1||box.height<1||box.x+box.width>width||box.y+box.height>height||!Number.isSafeInteger(glyph.featureIndex)||glyph.featureIndex<0;}))throw failure('DOCUMENT_IMAGE_INVALID','Glyph partition geometry escapes its bounded source raster');
  let considered = 0, eligible = 0, limited = false;
  const guard = () => { options.signal?.throwIfAborted(); if (performance.now() - started > budgetMs) throw failure('DOCUMENT_PARTITION_BUDGET', 'Joined-print observations reached their time budget; intact readings remain available'); };
  const cutGeometry = box => originalGeometry(box, width, height, transforms.deskewDegrees);
  try {
    guard();
    // Preserve the existing wide-ink priority. Ordinary-width touching letters
    // may also have a thin neck, but must not crowd out those existing cases.
    const parents = lines.flatMap((line, lineIndex) => line.glyphs.map(glyph => ({ line, lineIndex, glyph })));
    parents.sort((a, b) => Number(b.glyph.unsupported === 'joined-glyphs-or-artwork') - Number(a.glyph.unsupported === 'joined-glyphs-or-artwork'));
    for (const { line, lineIndex, glyph } of parents) {
      guard(); const box = glyph.analysisBox;
      const wide = glyph.unsupported === 'joined-glyphs-or-artwork', margin = Math.max(2, Math.ceil(box.height * .3));
      if ((!wide && (glyph.unsupported || analysis.recognitionProfile === 'handprint')) || glyph.compoundEvidence || glyph.componentIds?.length !== 1
        || !box || box.x <= 0 || box.y <= 0 || box.x + box.width >= width || box.y + box.height >= height
        || box.height < line.lineHeight * .55 || box.width > line.lineHeight * 3 || box.width / box.height > 3.2 || box.width < margin * 2) continue;
      eligible++;
      if (considered >= maxRegions) { limited = true; continue; }
      const columns = new Uint32Array(box.width); let ink = 0;
      for (let y = 0; y < box.height; y++) { guard(); for (let x = 0; x < box.width; x++) if (mask[(box.y + y) * width + box.x + x]) { columns[x]++; ink++; } }
      // A single source component must own every thresholded pixel in its box.
      if (ink !== glyph.inkArea || ink > box.width * box.height * .7) continue;
      const cuts = [];
      for (let cut = Math.max(margin, Math.ceil(box.width * .3)); cut <= Math.min(box.width - margin, Math.floor(box.width * .7)); cut++) {
        guard(); let crossingRows = 0, crossingEdges = 0;
        for (let y = 0; y < box.height; y++) {
          const right = (box.y + y) * width + box.x + cut; let connected = false;
          if (mask[right]) for (let dy = -1; dy <= 1; dy++) if (y + dy >= 0 && y + dy < box.height && mask[right - 1 + dy * width]) { crossingEdges++; connected = true; }
          if (connected) crossingRows++;
        }
        if (crossingRows > Math.max(2, Math.floor(box.height * .2)) || Math.min(columns[cut - 1], columns[cut]) > Math.max(2, box.height * .2)) continue;
        // A normal-width shape needs a genuinely thin connected neck. A broad
        // crossbar or arch is insufficient reason to propose two characters.
        // Connected rows are integer raster observations. Round the neck budget
        // to its nearest row rather than rejecting a two-row neck at 23px.
        if (!wide && (crossingRows < 1 || crossingRows > Math.max(1, Math.round(box.height * .08)))) continue;
        cuts.push({ cut, crossingRows, crossingEdges, rank: crossingRows / box.height + Math.abs(cut / box.width - .5) * .15 });
      }
      // Check neighboring ownership only after observing a possible neck. Most
      // ordinary glyphs then avoid a page-wide comparison. No child crop is
      // published when overlapping ink has unresolved ownership.
      if (!cuts.length || allGlyphs.some(other => other !== glyph && other.analysisBox.x < box.x + box.width && other.analysisBox.x + other.analysisBox.width > box.x
        && other.analysisBox.y < box.y + box.height && other.analysisBox.y + other.analysisBox.height > box.y)) continue;
      cuts.sort((a, b) => a.rank - b.rank || a.cut - b.cut);
      const chosen = [];
      for (const observation of cuts) {
        if (chosen.length >= maxCuts) break;
        if (chosen.some(previous => Math.abs(previous.cut - observation.cut) < 2)) continue;
        const boxes = [], areas = [];
        for (const [left, right] of [[0, observation.cut], [observation.cut, box.width]]) {
          let minX = right, maxX = left - 1, minY = box.height, maxY = -1, area = 0;
          for (let y = 0; y < box.height; y++) for (let x = left; x < right; x++) if (mask[(box.y + y) * width + box.x + x]) {
            minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); area++;
          }
          boxes.push({ x: box.x + minX, y: box.y + minY, width: maxX - minX + 1, height: maxY - minY + 1 }); areas.push(area);
        }
        // Only the new narrow path permits less than one pixel of height
        // quantization; retained crops and line-relative features are unchanged.
        const minimumChildHeight = wide ? box.height * .75 : Math.floor(box.height * .75);
        if (areas.some(area => area < ink * .2) || boxes.some(child => child.width < margin || child.width > line.lineHeight * 1.6 || child.height < minimumChildHeight)) continue;
        guard(); if (!chosen.length) considered++;
        const id = `glyph-${glyph.featureIndex}-cut-${observation.cut}`, children = boxes.map((child, side) => {
          const featureIndex = featureRows.length; featureRows.push(featuresFromCrop(grayRgba(gray, width, child), child, line));
          return { ...cutGeometry(child), analysisBox: child, featureIndex, wordIndex: glyph.wordIndex, componentIds: [...glyph.componentIds],
            partitionId: id, parentFeatureIndex: glyph.featureIndex, side, inkArea: areas[side], compoundEvidence: null, unsupported: 'joined-print-partition' };
        });
        partitions.push({ id, lineIndex, parentFeatureIndex: glyph.featureIndex, parentAnalysisBox: { ...box }, parent: cutGeometry(box),
          cut: { axis: 'analysis-x', position: box.x + observation.cut, segment: cutGeometry({ x: box.x + observation.cut, y: box.y, width: 0, height: box.height }).quad.slice(0, 3).filter((_, index) => index !== 1) },
          evidence: { method: 'retained-ink-vertical-partition', parentInkArea: ink, childInkAreas: areas, crossingRows: observation.crossingRows, crossingEdges: observation.crossingEdges,
            admission: wide ? 'wide-connected-ink' : 'thin-connected-neck',
            crossedRowFraction: observation.crossingRows / box.height, leftColumnInk: columns[observation.cut - 1], rightColumnInk: columns[observation.cut],
            pitch: line.spacing?.method === 'repeated-advances' ? line.spacing.pitch : null, pixelsRemoved: 0, pixelsDuplicated: 0 }, children });
        chosen.push(observation);
      }
    }
  } catch (error) {
    if (error.code !== 'DOCUMENT_PARTITION_BUDGET') throw error;
    limited = true; issues.push({ code: 'joined-print-budget', message: error.message });
  }
  if (limited && !issues.length) issues.push({ code: 'joined-print-limit', message: 'Joined-print observations reached their region limit; remaining intact readings are preserved' });
  const partitionFeatures = new Float32Array(featureRows.length * DOCUMENT_GLYPH_FEATURE_SIZE);
  featureRows.forEach((row, index) => partitionFeatures.set(row, index * DOCUMENT_GLYPH_FEATURE_SIZE));
  return { partitions, partitionFeatures, partitionFeatureCount: featureRows.length, partitionStats: { eligible, considered, candidates: partitions.length, maxRegions, maxCuts, limited }, issues };
}

/** Bounded deterministic analysis. Pixel coordinates always map back to the input. */
export function analyzeDocumentImage(image, options = {}) {
  const maxPixels = integer(options.maxPixels ?? DOCUMENT_IMAGE_MAX_PIXELS, 'maxPixels', 1, DOCUMENT_IMAGE_MAX_PIXELS);
  const budgetMs = integer(options.budgetMs ?? 10000, 'budgetMs', 1, 120000), maxGlyphs = integer(options.maxGlyphs ?? 5000, 'maxGlyphs', 1, 10000);
  const started = performance.now(), signal = options.signal, guard = () => { signal?.throwIfAborted(); if (performance.now() - started > budgetMs) throw failure('DOCUMENT_IMAGE_BUDGET', 'Document image analysis exceeded its time budget; choose a smaller region'); };
  guard(); const source = imageInput(image, maxPixels), width = source.width, height = source.height, issues = [];
  const mode = options.threshold ?? 'auto'; if (!['auto', 'otsu', 'adaptive'].includes(mode)) throw failure('DOCUMENT_IMAGE_INVALID', 'Unsupported document threshold mode');
  const recognitionProfile = options.recognitionProfile ?? 'printed';
  if (!['printed', 'handprint'].includes(recognitionProfile)) throw failure('DOCUMENT_IMAGE_INVALID', 'Unsupported document recognition profile');
  const white = whiteRgba(source); guard(); let gray = imageLuminanceMap(white);
  const globalThreshold = documentOtsuThreshold(gray);
  const darkPixels = gray.reduce((sum, value) => sum + (value <= globalThreshold && value < 250 ? 1 : 0), 0);
  let inverted = false;
  if (darkPixels > gray.length * .65) {
    gray = gray.map(value => 255 - value); inverted = true;
    issues.push({ code: 'inverted-polarity', message: 'Dark page polarity was inverted for text analysis' });
  }
  let { mask, threshold } = thresholdImage(gray, width, height, mode === 'auto' ? 'adaptive' : mode, guard);
  const skew = options.deskew === false ? { angleDegrees: 0, confidence: 0 } : estimateSkew(mask, width, height, guard);
  gray = rotateGray(gray, width, height, skew.angleDegrees, guard);
  if (skew.angleDegrees) ({ mask, threshold } = thresholdImage(gray, width, height, mode === 'auto' ? 'adaptive' : mode, guard));
  if (Math.abs(skew.angleDegrees) >= 6.8) issues.push({ code: 'orientation-review', message: 'Skew reaches the correction range; review page orientation' });
  const components = documentInkComponents(mask, width, height, { guard, maxComponents: integer(options.maxComponents ?? 20000, 'maxComponents', 1, 40000) });
  const segmented = segmentInk(components, width, height, issues, guard, recognitionProfile), glyphCount = segmented.reduce((sum, line) => sum + line.glyphs.length, 0);
  if (glyphCount > maxGlyphs) throw failure('DOCUMENT_IMAGE_GLYPH_LIMIT', 'Page has too many candidate glyphs; recognize it in smaller regions');
  if (!glyphCount) issues.push({ code: 'no-text-candidates', message: 'No sufficiently sized text candidates found' });
  const features = new Float32Array(glyphCount * DOCUMENT_GLYPH_FEATURE_SIZE); let featureIndex = 0;
  const lines = segmented.map((line, lineIndex) => {
    guard(); const geometry = originalGeometry(line.bbox, width, height, skew.angleDegrees);
    const baselineQuad = originalGeometry({ x: line.bbox.x, y: line.baseline, width: line.bbox.width, height: 0 }, width, height, skew.angleDegrees).quad;
    return { id: lineIndex, ...geometry, analysisBox: line.bbox, lineHeight: line.lineHeight, baseline: line.baseline, spacing: line.spacing,
      lineMetricCoordinates: 'analysis-pixels', baselineSegment: baselineQuad.slice(0, 2),
      glyphs: line.glyphs.map(glyph => {
        guard(); const box = { x: glyph.x, y: glyph.y, width: glyph.width, height: glyph.height };
        const featureMetrics = recognitionProfile === 'handprint' ? { lineHeight: box.height, baseline: box.y + box.height } : line;
        features.set(featuresFromCrop(grayRgba(gray, width, box), box, featureMetrics), featureIndex * DOCUMENT_GLYPH_FEATURE_SIZE);
        return { ...originalGeometry(box, width, height, skew.angleDegrees), analysisBox: box, featureIndex: featureIndex++, wordIndex: glyph.wordIndex, componentIds: glyph.componentIds, compoundEvidence: glyph.compoundEvidence || null,
          inkArea: glyph.area, unsupported: glyph.unsupported ?? null };
      }) };
  });
  for (const issue of issues) if (issue.bbox) issue.bbox = originalGeometry(issue.bbox, width, height, skew.angleDegrees).bbox;
  guard();
  const radians = skew.angleDegrees * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians);
  const result = { schema: 'engine.document-image.v1', recognitionProfile, width, height, gray, mask, features, featureSize: DOCUMENT_GLYPH_FEATURE_SIZE, glyphCount, lines, issues,
    coordinateUnit: 'original-image-pixels', transforms: { deskewDegrees: skew.angleDegrees, skewConfidence: skew.confidence, inverted, center: { x: width / 2, y: height / 2 },
      rasterCoordinates: 'analysis-pixels', affineConvention: '[a,b,c,d,e,f]: xOriginal=a*x+c*y+e; yOriginal=b*x+d*y+f',
      analysisToOriginal: [c, s, -s, c, width / 2 - c * width / 2 + s * height / 2, height / 2 - s * width / 2 - c * height / 2] },
    threshold: { method: mode === 'auto' ? 'adaptive' : mode, globalOtsu: threshold }, componentCount: components.length };
  const alternatives = documentGlyphPartitions(result, { signal, budgetMs: Math.min(250, Math.max(1, Math.floor(budgetMs - (performance.now() - started)))) });
  result.issues.push(...alternatives.issues); delete alternatives.issues;
  return Object.assign(result, alternatives);
}
