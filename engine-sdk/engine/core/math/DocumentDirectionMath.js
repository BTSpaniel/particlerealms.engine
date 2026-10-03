// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { imageDataReport, imageSampleBilinear } from './ImageMath.js';
import { domMatrixTransformPoint } from './DOMGeometryMath.js';

/** Rotate a bounded reading hypothesis, retaining its inverse pixel-edge map.
 * angleDegrees is the clockwise direction of the text in the source image.
 * Quarter turns use exact byte sampling; explicit other angles interpolate.
 */
export function documentDirectionRaster(image, { angleDegrees = 0, region = null, signal = null, maxPixels = 4_000_000 } = {}) {
    const report = imageDataReport(image);
    if (!report.valid || report.extraByteLength || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || report.pixelCount > 4_000_000
        || !Number.isFinite(angleDegrees) || Math.abs(angleDegrees) > 360 || !Number.isSafeInteger(maxPixels) || maxPixels < 1 || maxPixels > 4_000_000) throw new RangeError('Invalid bounded document direction raster');
    const box = region || { x: 0, y: 0, width: image.width, height: image.height };
    if (![box.x, box.y, box.width, box.height].every(Number.isSafeInteger) || box.x < 0 || box.y < 0 || box.width < 1 || box.height < 1 || box.x + box.width > image.width || box.y + box.height > image.height) throw new RangeError('Reading region must lie inside the image');
    const angle = ((angleDegrees % 360) + 360) % 360, radians = angle * Math.PI / 180;
    const quarter = angle % 90 === 0, cosine = quarter ? [1, 0, -1, 0][angle / 90] : Math.cos(radians), sine = quarter ? [0, 1, 0, -1][angle / 90] : Math.sin(radians);
    const corners = [[0, 0], [box.width, 0], [box.width, box.height], [0, box.height]].map(([x, y]) => [cosine * x + sine * y, -sine * x + cosine * y]);
    const left = Math.min(...corners.map(p => p[0])), top = Math.min(...corners.map(p => p[1]));
    const width = Math.ceil(Math.max(...corners.map(p => p[0])) - left), height = Math.ceil(Math.max(...corners.map(p => p[1])) - top);
    if (width * height > maxPixels || width > 16384 || height > 16384) throw new RangeError('Rotated reading region exceeds its pixel budget; choose a smaller region');
    const readingToSource = [cosine, sine, -sine, cosine, cosine * left - sine * top + box.x, sine * left + cosine * top + box.y];
    if (!angle && !region) return { ...image, angleDegrees: angle, readingToSource, region: { ...box } };
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    for (let y = 0; y < height; y++) {
        signal?.throwIfAborted();
        for (let x = 0; x < width; x++) {
            const sx = cosine * (x + .5) - sine * (y + .5) + readingToSource[4] - .5;
            const sy = sine * (x + .5) + cosine * (y + .5) + readingToSource[5] - .5;
            if (sx < box.x - .5 || sy < box.y - .5 || sx > box.x + box.width - .5 || sy > box.y + box.height - .5) continue;
            const offset = (y * width + x) * 4;
            if (quarter) { const source = (Math.round(sy) * image.width + Math.round(sx)) * 4; data.set(image.data.subarray(source, source + 4), offset); }
            else data.set(imageSampleBilinear(image, sx, sy, { edgeMode: 'clamp' }), offset);
        }
    }
    return { data, width, height, angleDegrees: angle, readingToSource, region: { ...box } };
}

/** Map a reading quad to source pixel edges without replacing it by a box. */
export function documentDirectionGeometry(geometry, readingToSource) {
    const box = geometry.bbox || geometry;
    const quad = (geometry.quad || [{ x: box.x, y: box.y }, { x: box.x + box.width, y: box.y }, { x: box.x + box.width, y: box.y + box.height }, { x: box.x, y: box.y + box.height }]).map(point => {
        const mapped = domMatrixTransformPoint(point, readingToSource); return { x: mapped.x, y: mapped.y };
    });
    const x = Math.min(...quad.map(point => point.x)), y = Math.min(...quad.map(point => point.y));
    return { quad, bbox: { x, y, width: Math.max(...quad.map(point => point.x)) - x, height: Math.max(...quad.map(point => point.y)) - y } };
}

/** Smallest rectangle at the declared reading angle enclosing source quads. */
export function documentDirectionEnvelope(geometries, angleDegrees = 0) {
    if (!Array.isArray(geometries) || !geometries.length || geometries.length > 10000 || !Number.isFinite(angleDegrees)) throw new RangeError('A direction envelope needs bounded geometry and an angle');
    const radians = angleDegrees * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians);
    const boxes = geometries.map(geometry => documentDirectionGeometry(geometry, [c, -s, s, c, 0, 0]).bbox);
    const x = Math.min(...boxes.map(box => box.x)), y = Math.min(...boxes.map(box => box.y));
    return documentDirectionGeometry({ x, y, width: Math.max(...boxes.map(box => box.x + box.width)) - x, height: Math.max(...boxes.map(box => box.y + box.height)) - y }, [c, s, -s, c, 0, 0]);
}
