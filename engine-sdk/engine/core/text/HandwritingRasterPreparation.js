// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { documentQuadTransform, rectifyDocumentQuad } from '../math/DocumentQuadMath.js';
import { bilinearSample } from '../math/MathGrid.js';
import { byteFrequencyHistogram } from '../math/MathEntropy.js';
import { mat3Inverse, mat3Multiply, mat3TransformVec3 } from '../math/MathMat.js';

export const HANDWRITING_RASTER_RECIPE = Object.freeze({ id: 'owned-handwriting-gray-aspect-v2', height: 32, inkHeight: 26, padding: 2, supportThreshold: 8, backgroundPercentile: .95, widthBuckets: Object.freeze([64, 128, 256, 512]), maximumCropPixels: 1_048_576 });

/** Validate the existing matrix inverse at all observed ink-support corners. */
export function handwritingRasterTransformReport(outputToSource, { inkBox, scaleX, scaleY, offsetX, offsetY } = {}) {
  if (!outputToSource || outputToSource.length !== 9 || !Array.from(outputToSource).every(Number.isFinite) || ![inkBox?.width, inkBox?.height, scaleX, scaleY, offsetX, offsetY].every(Number.isFinite) || inkBox.width <= 0 || inkBox.height <= 0 || scaleX <= 0 || scaleY <= 0) throw new TypeError('Declare a finite handwriting map and its observed support');
  const inverse = mat3Inverse(outputToSource); let maxOutputError = 0, maxSourceError = 0;
  for (const x of [offsetX, offsetX + inkBox.width * scaleX]) for (const y of [offsetY, offsetY + inkBox.height * scaleY]) {
    const source = mat3TransformVec3(outputToSource, [x, y, 1]);
    if (!source.every(Number.isFinite) || Math.abs(source[2]) < 1e-10) return { valid: false, issue: 'unstable-handwriting-source-transform', maxOutputError: null, maxSourceError: null, sourceToOutput: null };
    const sx = source[0] / source[2], sy = source[1] / source[2], restored = mat3TransformVec3(inverse, [sx, sy, 1]);
    if (!restored.every(Number.isFinite) || Math.abs(restored[2]) < 1e-10) return { valid: false, issue: 'unstable-handwriting-source-transform', maxOutputError: null, maxSourceError: null, sourceToOutput: null };
    const ox = restored[0] / restored[2], oy = restored[1] / restored[2], sourceAgain = mat3TransformVec3(outputToSource, [ox, oy, 1]);
    const outputError = Math.hypot(ox - x, oy - y), sourceError = Math.hypot(sourceAgain[0] / sourceAgain[2] - sx, sourceAgain[1] / sourceAgain[2] - sy);
    if (!Number.isFinite(outputError) || !Number.isFinite(sourceError)) return { valid: false, issue: 'unstable-handwriting-source-transform', maxOutputError: null, maxSourceError: null, sourceToOutput: null };
    maxOutputError = Math.max(maxOutputError, outputError); maxSourceError = Math.max(maxSourceError, sourceError);
  }
  const valid = maxOutputError <= .05 && maxSourceError <= .05;
  return { valid, issue: valid ? null : 'unstable-handwriting-source-transform', maxOutputError, maxSourceError, sourceToOutput: valid ? Array.from(inverse) : null };
}

/** Preserve grayscale strokes and rectified pixel aspect before CTC features. */
export function prepareHandwritingRaster(source, { quad = null, signal } = {}) {
  signal?.throwIfAborted();
  const corners = quad ?? [{ x: 0, y: 0 }, { x: source?.width, y: 0 }, { x: source?.width, y: source?.height }, { x: 0, y: source?.height }];
  const geometry = documentQuadTransform(corners), cropWidth = Math.max(2, Math.ceil(geometry.sourceWidth)), cropHeight = Math.max(2, Math.ceil(geometry.sourceHeight));
  const provenance = { recipe: HANDWRITING_RASTER_RECIPE, sourceQuad: geometry.corners, sourceSize: { width: source?.width, height: source?.height }, transcriptUsed: false, pixelsBinarized: false };
  const issue = (code, details = {}) => ({ status: 'unsupported', width: null, height: 32, pixels: null, inkBox: null, preparationIssue: { code, ...details }, provenance });
  if (cropWidth > 4096 || cropHeight > 4096 || cropWidth * cropHeight > HANDWRITING_RASTER_RECIPE.maximumCropPixels) return issue('source-word-raster-budget', { requestedWidth: cropWidth, requestedHeight: cropHeight });
  const crop = rectifyDocumentQuad(source, corners, { width: cropWidth, height: cropHeight, signal }), bytes = Uint8Array.from(crop.data, value => Math.round(value)), histogram = byteFrequencyHistogram(bytes);
  let background = 255, accumulated = 0;
  for (let value = 0; value < 256; value++) { accumulated += histogram[value]; if (accumulated >= bytes.length * HANDWRITING_RASTER_RECIPE.backgroundPercentile) { background = value; break; } }
  const ink = Float32Array.from(crop.data, value => Math.max(0, background - value));
  let left = cropWidth, top = cropHeight, right = -1, bottom = -1;
  for (let y = 0; y < cropHeight; y++) {
    signal?.throwIfAborted();
    for (let x = 0; x < cropWidth; x++) if (ink[y * cropWidth + x] >= HANDWRITING_RASTER_RECIPE.supportThreshold) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
  }
  provenance.backgroundLuminance = background;
  if (right < left) return issue('empty-or-low-contrast-observed-ink');
  const inkBox = { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
  // Compensate the integer preliminary raster dimensions so horizontal and
  // vertical distances retain one common scale in rectified source pixels.
  const unitX = geometry.sourceWidth / cropWidth, unitY = geometry.sourceHeight / cropHeight, scale = HANDWRITING_RASTER_RECIPE.inkHeight / (inkBox.height * unitY), scaleX = scale * unitX, scaleY = scale * unitY;
  if (inkBox.width * unitX < 1 || inkBox.height * unitY < 1) return { ...issue('insufficient-source-resolution', { observedSourceWidth: inkBox.width * unitX, observedSourceHeight: inkBox.height * unitY, minimumSourcePixels: 1 }), inkBox };
  const requiredWidth = Math.ceil(inkBox.width * scaleX) + HANDWRITING_RASTER_RECIPE.padding * 2, width = HANDWRITING_RASTER_RECIPE.widthBuckets.find(value => value >= requiredWidth);
  if (!width) return { ...issue('word-width-exceeds-sequence-budget', { requiredWidth, maximumWidth: 512 }), inkBox };
  const pixels = new Uint8Array(width * 32), offsetX = HANDWRITING_RASTER_RECIPE.padding, offsetY = (32 - inkBox.height * scaleY) / 2;
  for (let y = 0; y < 32; y++) {
    signal?.throwIfAborted(); const sy = top + (y + .5 - offsetY) / scaleY - .5;
    if (sy < top - .5 || sy > bottom + .5) continue;
    for (let x = offsetX; x < offsetX + Math.ceil(inkBox.width * scaleX); x++) {
      const sx = left + (x + .5 - offsetX) / scaleX - .5;
      if (sx < left - .5 || sx > right + .5) continue;
      pixels[y * width + x] = Math.round(bilinearSample(ink, cropWidth, cropHeight, Math.max(0, Math.min(cropWidth - 1, sx)), Math.max(0, Math.min(cropHeight - 1, sy))));
    }
  }
  const outputToUnit = [1 / (scaleX * cropWidth), 0, 0, 0, 1 / (scaleY * cropHeight), 0, (left - offsetX / scaleX) / cropWidth, (top - offsetY / scaleY) / cropHeight, 1];
  const outputToSource = mat3Multiply(geometry.matrix, outputToUnit), inverse = handwritingRasterTransformReport(outputToSource, { inkBox, scaleX, scaleY, offsetX, offsetY });
  if (!inverse.valid) return { ...issue(inverse.issue, inverse), inkBox };
  return { status: 'prepared', width, height: 32, pixels, inkBox, preparationIssue: null, provenance: { ...provenance, requiredWidth, rectifiedPixelScale: scale, scaleUnits: 'output pixels per rectified source pixel; no physical calibration', preliminaryRaster: { width: cropWidth, height: cropHeight }, transform: { outputToSource: Array.from(outputToSource), sourceToOutput: inverse.sourceToOutput, coordinateConvention: 'pixel-edge coordinates; sample centers at x+0.5,y+0.5', scaleX, scaleY, offsetX, offsetY } } };
}
