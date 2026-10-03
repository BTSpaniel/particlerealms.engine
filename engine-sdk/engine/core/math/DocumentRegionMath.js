// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { documentInkComponents, DOCUMENT_IMAGE_MAX_PIXELS } from './DocumentImageMath.js';
import { domMatrixTransformPoint } from './DOMGeometryMath.js';
import { vec2Cross, vec2Dot, vec2Distance } from './MathVec2.js';
import { clamp } from './MathScalar.js';

const fault = (code, message) => Object.assign(new Error(message), { code });
function bounded(value, name, low, high, integer = false) {
  if (!Number.isFinite(value) || value < low || value > high || integer && !Number.isSafeInteger(value)) throw fault('DOCUMENT_REGION_INVALID', `${name} must be ${integer ? 'an integer' : 'finite'} in [${low}, ${high}]`);
  return value;
}
function boundsOf(points) {
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  for (const point of points) { x = Math.min(x, point[0]); y = Math.min(y, point[1]); right = Math.max(right, point[0]); bottom = Math.max(bottom, point[1]); }
  return { x, y, width: right - x, height: bottom - y };
}
function boxCorners(box) { return [[box.x, box.y], [box.x + box.width, box.y], [box.x + box.width, box.y + box.height], [box.x, box.y + box.height]]; }
function removeCollinear(points) {
  return points.filter((point, index) => {
    const before = points[(index + points.length - 1) % points.length], after = points[(index + 1) % points.length];
    return vec2Cross([point[0] - before[0], point[1] - before[1]], [after[0] - point[0], after[1] - point[1]]) !== 0;
  });
}

// Directed cell edges keep ink on their right. A right-turn preference at a
// diagonal junction preserves separate boundaries instead of crossing them.
function traceInkBoundaries(mask, width, height, maxEdges, guard) {
  const from = new Int32Array(maxEdges), to = new Int32Array(maxEdges), directions = new Uint8Array(maxEdges), next = new Int32Array(maxEdges).fill(-1);
  const heads = new Map(), stride = width + 1; let count = 0;
  function edge(x, y, endX, endY, direction) {
    if (count === maxEdges) throw fault('DOCUMENT_REGION_EDGE_LIMIT', 'Ink boundaries exceed the region edge budget');
    const start = y * stride + x; from[count] = start; to[count] = endY * stride + endX; directions[count] = direction;
    next[count] = heads.get(start) ?? -1; heads.set(start, count++);
  }
  for (let y = 0; y < height; y++) {
    guard(); for (let x = 0; x < width; x++) {
      const index = y * width + x; if (!mask[index]) continue;
      if (!y || !mask[index - width]) edge(x, y, x + 1, y, 0);
      if (x + 1 === width || !mask[index + 1]) edge(x + 1, y, x + 1, y + 1, 1);
      if (y + 1 === height || !mask[index + width]) edge(x + 1, y + 1, x, y + 1, 2);
      if (!x || !mask[index - 1]) edge(x, y + 1, x, y, 3);
    }
  }
  const visited = new Uint8Array(count), loops = [];
  for (let start = 0; start < count; start++) {
    if (visited[start]) continue; guard(); const points = []; let cursor = start, closed = false;
    for (let steps = 0; steps <= count; steps++) {
      if ((steps & 1023) === 0) guard(); if (visited[cursor]) break;
      visited[cursor] = 1; points.push([from[cursor] % stride, Math.floor(from[cursor] / stride)]);
      if (to[cursor] === from[start]) { closed = true; break; }
      let chosen = -1, best = 5;
      for (let candidate = heads.get(to[cursor]) ?? -1; candidate !== -1; candidate = next[candidate]) {
        if (visited[candidate]) continue;
        const turn = (directions[candidate] - directions[cursor] + 4) % 4, rank = ({ 1: 0, 0: 1, 3: 2, 2: 3 })[turn];
        if (rank < best) { chosen = candidate; best = rank; }
      }
      if (chosen === -1) break; cursor = chosen;
    }
    if (!closed) throw fault('DOCUMENT_REGION_TOPOLOGY', 'An ink boundary could not be closed without crossing visited edges');
    const compact = removeCollinear(points); let signedArea = 0;
    for (let index = 0; index < compact.length; index++) signedArea += vec2Cross(compact[index], compact[(index + 1) % compact.length]);
    if (compact.length >= 4 && signedArea) loops.push({ points: compact, signedArea: signedArea / 2, bbox: boundsOf(compact), edgeCount: points.length });
  }
  return { loops, edgeCount: count };
}

function lineFromBoundary(loop, minLength, maxWidth) {
  // Use all unit boundary edges for uniform moments, not just corner counts.
  let mass = 0, meanX = 0, meanY = 0, xx = 0, xy = 0, yy = 0;
  for (let index = 0; index < loop.points.length; index++) {
    const a = loop.points[index], b = loop.points[(index + 1) % loop.points.length], length = vec2Distance(a, b);
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    mass += length; meanX += length * mx; meanY += length * my;
    xx += length * (a[0] ** 2 + a[0] * b[0] + b[0] ** 2) / 3;
    yy += length * (a[1] ** 2 + a[1] * b[1] + b[1] ** 2) / 3;
    xy += length * (2 * a[0] * a[1] + a[0] * b[1] + b[0] * a[1] + 2 * b[0] * b[1]) / 6;
  }
  if (!mass) return null; meanX /= mass; meanY /= mass; xx = xx / mass - meanX ** 2; xy = xy / mass - meanX * meanY; yy = yy / mass - meanY ** 2;
  const angle = .5 * Math.atan2(2 * xy, xx - yy), direction = [Math.cos(angle), Math.sin(angle)], normal = [-direction[1], direction[0]];
  let first = Infinity, last = -Infinity, low = Infinity, high = -Infinity;
  for (const point of loop.points) { const along = vec2Dot(point, direction), across = vec2Dot(point, normal); first = Math.min(first, along); last = Math.max(last, along); low = Math.min(low, across); high = Math.max(high, across); }
  const length = last - first, thickness = high - low;
  if (length < minLength || thickness > maxWidth || length < thickness * 8 || Math.abs(loop.signedArea) < length * thickness * .4) return null;
  const middle = (low + high) / 2, pointAt = value => [direction[0] * value + normal[0] * middle, direction[1] * value + normal[1] * middle];
  const spread = Math.sqrt((xx - yy) ** 2 + 4 * xy * xy), major = (xx + yy + spread) / 2, minor = Math.max(0, (xx + yy - spread) / 2);
  return { points: [pointAt(first), pointAt(last)], lengthPixels: length, thicknessPixels: thickness, linearity: major > 0 ? 1 - minor / major : 0 };
}

function continuousToneRegions(gray, width, height, guard) {
  if (!gray) return [];
  const tile = 32, columns = Math.ceil(width / tile), rows = Math.ceil(height / tile), selected = new Uint8Array(columns * rows), entropies = new Float32Array(selected.length);
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    guard(); const histogram = new Uint32Array(16); let count = 0, midtones = 0;
    for (let y = row * tile; y < Math.min(height, (row + 1) * tile); y++) for (let x = column * tile; x < Math.min(width, (column + 1) * tile); x++) {
      const value = gray[y * width + x]; histogram[Math.min(15, Math.floor(value / 16))]++; count++; if (value > 24 && value < 231) midtones++;
    }
    let entropy = 0; for (const bin of histogram) if (bin) { const probability = bin / count; entropy -= probability * Math.log2(probability); }
    const index = row * columns + column; entropies[index] = entropy; selected[index] = midtones > count * .3 && entropy >= 1.75 ? 1 : 0;
  }
  return documentInkComponents(selected, columns, rows, { guard }).filter(component => component.area >= 2).map(component => {
    let totalEntropy = 0, count = 0;
    for (let y = component.y; y < component.y + component.height; y++) for (let x = component.x; x < component.x + component.width; x++) if (selected[y * columns + x]) { totalEntropy += entropies[y * columns + x]; count++; }
    return { bbox: { x: component.x * tile, y: component.y * tile, width: Math.min(width, (component.x + component.width) * tile) - component.x * tile, height: Math.min(height, (component.y + component.height) * tile) - component.y * tile }, grayEntropy: totalEntropy / count, selectedTileCount: component.area, tileSize: tile };
  });
}

/** Geometry evidence over the existing OCR mask; no second threshold or model. */
export function analyzeDocumentRegions(analysis, options = {}) {
  const width = bounded(analysis?.width, 'width', 1, 16384, true), height = bounded(analysis?.height, 'height', 1, 16384, true);
  const budgetMs = bounded(options.budgetMs ?? 5000, 'budgetMs', 1, 30000, true), maxRegions = bounded(options.maxRegions ?? 256, 'maxRegions', 1, 1024, true);
  const maxContourPoints = bounded(options.maxContourPoints ?? 20000, 'maxContourPoints', 4, 100000, true), maxEdges = bounded(options.maxBoundaryEdges ?? 200000, 'maxBoundaryEdges', 16, 1000000, true);
  const minLineLength = bounded(options.minLineLength ?? 48, 'minLineLength', 4, 16384), minContourArea = bounded(options.minContourArea ?? 144, 'minContourArea', 1, DOCUMENT_IMAGE_MAX_PIXELS);
  const maxLineWidth = bounded(options.maxLineWidth ?? 12, 'maxLineWidth', 1, 128), maxComponents = bounded(options.maxComponents ?? 20000, 'maxComponents', 1, 40000, true);
  const started = performance.now(), checkAbort = () => options.signal?.throwIfAborted();
  const guard = () => { checkAbort(); if (performance.now() - started > budgetMs) throw fault('DOCUMENT_REGION_BUDGET', 'Document regions exceeded their analysis time budget'); };
  checkAbort(); const { mask, gray } = analysis;
  if (width * height > DOCUMENT_IMAGE_MAX_PIXELS || !(mask instanceof Uint8Array) || mask.length !== width * height
    || gray && (!(gray instanceof Float32Array || gray instanceof Float64Array || gray instanceof Uint8Array || gray instanceof Uint8ClampedArray) || gray.length !== mask.length)) throw fault('DOCUMENT_REGION_INVALID', 'Provide the existing bounded document mask and optional gray raster');
  // Validate the complete bounded input even when the optional geometry budget
  // is small. Invalid data must not be mistaken for a useful partial result.
  for (let index = 0; index < mask.length; index++) { if ((index & 65535) === 0) checkAbort(); if (mask[index] > 1 || gray && (!Number.isFinite(gray[index]) || gray[index] < 0 || gray[index] > 255)) throw fault('DOCUMENT_REGION_INVALID', 'Mask pixels must be binary and gray pixels finite bytes'); }
  const affine = analysis.transforms?.analysisToOriginal ?? [1, 0, 0, 1, 0, 0];
  if (!(Array.isArray(affine) || ArrayBuffer.isView(affine)) || affine.length !== 6 || !Array.from(affine).every(Number.isFinite) || Math.abs(affine[0] * affine[3] - affine[1] * affine[2]) < 1e-12) throw fault('DOCUMENT_REGION_INVALID', 'Region source mapping requires a finite invertible affine transform');
  const source = { sourceId: options.sourceId ?? null, pageNumber: options.pageNumber ?? null, sourceRevision: options.sourceRevision ?? null };
  if (source.sourceId !== null && (typeof source.sourceId !== 'string' || source.sourceId.length > 1024) || source.pageNumber !== null && (!Number.isSafeInteger(source.pageNumber) || source.pageNumber < 1)
    || source.sourceRevision !== null && !(typeof source.sourceRevision === 'string' && source.sourceRevision.length <= 1024 || Number.isSafeInteger(source.sourceRevision) && source.sourceRevision >= 0)) throw fault('DOCUMENT_REGION_INVALID', 'Source provenance must be bounded identifiers and a positive page number');
  const regions = [], issues = []; let status = 'complete', pointsPublished = 0, edgeCount = 0;
  function issue(code, message) { if (!issues.some(item => item.code === code)) issues.push({ code, message }); status = 'partial'; }
  function publish(kind, points, geometry, evidence) {
    guard(); if (regions.length === maxRegions) { issue('DOCUMENT_REGION_LIMIT', 'Additional regions omitted by the declared region cap'); return false; }
    let clipped = false; const map = ([x, y]) => { const point = domMatrixTransformPoint({ x, y }, affine), px = clamp(point.x, 0, width), py = clamp(point.y, 0, height); clipped ||= px !== point.x || py !== point.y; return { x: px, y: py }; };
    const mapped = points.map(map), boxPoints = kind === 'line' ? boxCorners(evidence.analysisBox).map(map) : mapped;
    const bbox = boundsOf(boxPoints.map(point => [point.x, point.y]));
    if (bbox.width <= 0 || bbox.height <= 0) { issue('DOCUMENT_REGION_OUTSIDE_SOURCE', 'Geometry entirely outside the source image was omitted'); return false; }
    const field = geometry.type === 'bounds' ? 'quad' : 'points';
    regions.push({ id: `region-${regions.length}`, kind, status: 'candidate', reviewRequired: true, bbox, geometry: { ...geometry, [field]: mapped }, evidence: { ...evidence, measurementCoordinates: 'analysis-pixels', geometryClipped: clipped }, source: { ...source } }); return true;
  }
  if (analysis.lines != null && !Array.isArray(analysis.lines)) throw fault('DOCUMENT_REGION_INVALID', 'Text-line evidence must be an array');
  const textBoxes = []; let sourceGlyphCount = 0;
  for (const line of analysis.lines || []) {
    checkAbort(); if (!line || !Array.isArray(line.glyphs)) throw fault('DOCUMENT_REGION_INVALID', 'Text-line glyph evidence must be an array');
    // Isolated large shapes can themselves be OCR glyph candidates. Suppression
    // needs a plausible multi-letter line, not merely an unclassified ink box.
    const plausibleLine = line.glyphs.length >= 3;
    for (const glyph of line.glyphs) {
      if (++sourceGlyphCount > 10000) throw fault('DOCUMENT_REGION_INVALID', 'Text evidence exceeds its glyph budget');
      const box = glyph.analysisBox; if (glyph.unsupported || !box) continue;
      if (![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0) throw fault('DOCUMENT_REGION_INVALID', 'Text evidence contains invalid analysis bounds');
      if (plausibleLine && box.height <= Math.min(width, height) * .25) textBoxes.push(box);
    }
  }
  function possibleText(box) { return textBoxes.some(text => Math.max(0, Math.min(text.x + text.width, box.x + box.width) - Math.max(text.x, box.x)) * Math.max(0, Math.min(text.y + text.height, box.y + box.height) - Math.max(text.y, box.y)) >= box.width * box.height * .5); }
  let components = [];
  try {
    guard();
    for (const tone of continuousToneRegions(gray, width, height, guard)) publish('artwork', boxCorners(tone.bbox), { type: 'bounds' }, { method: 'continuous-tone-tiles', classification: 'continuous-tone-candidate', analysisBox: tone.bbox, grayEntropy: tone.grayEntropy, selectedTileCount: tone.selectedTileCount, tileSize: tone.tileSize });
    components = documentInkComponents(mask, width, height, { guard, maxComponents });
    for (const component of components) {
      guard(); const fill = component.area / (component.width * component.height);
      if (component.width >= 32 && component.height >= 32 && component.area >= minContourArea && fill >= .18 && !possibleText(component)) {
        publish('artwork', boxCorners(component), { type: 'bounds' }, { method: 'dense-ink-component', classification: 'dense-ink-candidate', analysisBox: { x: component.x, y: component.y, width: component.width, height: component.height }, componentIds: [component.id], areaPixels: component.area, inkCoverage: fill });
      }
    }
    const boundaries = traceInkBoundaries(mask, width, height, maxEdges, guard); edgeCount = boundaries.edgeCount;
    for (const loop of boundaries.loops.sort((a, b) => Math.abs(b.signedArea) - Math.abs(a.signedArea))) {
      guard(); const textCandidate = possibleText(loop.bbox), evidence = { analysisBox: loop.bbox, areaPixels: Math.abs(loop.signedArea), possibleTextCandidate: textCandidate };
      const line = loop.signedArea > 0 ? lineFromBoundary(loop, minLineLength, maxLineWidth) : null;
      if (line && !textCandidate) { publish('line', line.points, { type: 'line' }, { ...evidence, method: 'boundary-principal-axis', lengthPixels: line.lengthPixels, thicknessPixels: line.thicknessPixels, linearity: line.linearity }); continue; }
      if (Math.abs(loop.signedArea) < minContourArea || textCandidate) continue;
      if (pointsPublished + loop.points.length + 1 > maxContourPoints) { issue('DOCUMENT_REGION_POINT_LIMIT', 'Additional complete contours omitted by the declared point cap'); continue; }
      const points = [...loop.points, loop.points[0]];
      if (publish('contour', points, { type: 'polyline', closed: true, boundaryRole: loop.signedArea > 0 ? 'outer' : 'hole', semantics: 'ink-boundary' },
        { ...evidence, method: 'pixel-cell-boundary', enclosedBackground: loop.signedArea < 0, signedAreaAnalysisPixels: loop.signedArea, boundaryEdgeCount: loop.edgeCount })) pointsPublished += points.length;
    }
    guard();
  } catch (error) {
    // Region extraction is optional enrichment. Retain completed evidence when
    // it reaches its own cap, without swallowing cancellation or invalid input.
    checkAbort();
    if (!['DOCUMENT_REGION_BUDGET', 'DOCUMENT_IMAGE_COMPONENT_LIMIT', 'DOCUMENT_REGION_EDGE_LIMIT'].includes(error.code)) throw error;
    issue(error.code, error.message);
  }
  return { schema: 'engine.document-regions.v1', coordinateUnit: 'original-image-pixels', width, height, regions, issues, status,
    source, analysisToOriginal: Array.from(affine), metrics: { componentCount: components.length, boundaryEdgeCount: edgeCount, contourPointCount: pointsPublished, elapsedMs: performance.now() - started },
    limits: { maxRegions, maxContourPoints, maxComponents, maxBoundaryEdges: maxEdges, budgetMs }, semantics: 'Geometric candidates only; ink boundaries are not validated pattern cutting lines or image subject labels.' };
}
