// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { cloneStrictJson, isPlainJsonObject } from '../../core/schema/StrictJsonValue.js';

/** Portable terrain bake data. Heights and flow, rather than a procedural
 * approximation, are the authority when this record is saved in a scene. */
export function normalizeTerrainHeightfield(value) {
    const keys = ['version', 'width', 'height', 'bounds', 'heights', 'flow', 'provenance'];
    if (!value || value.version !== 1 || Object.keys(value).some(key => !keys.includes(key))) throw new TypeError('Invalid terrain heightfield record');
    const { width, height, bounds, heights, flow } = value;
    if (![width, height].every(size => Number.isInteger(size) && size >= 2 && size <= 256)) throw new TypeError('Terrain grid dimensions must be integers in [2,256]');
    if (!Array.isArray(bounds) || bounds.length !== 4 || Array.from(bounds).some(number => !Number.isFinite(number) || Math.abs(number) > 100000)
        || bounds[2] <= bounds[0] || bounds[3] <= bounds[1]) throw new TypeError('Terrain bounds must be finite increasing X/Z intervals');
    const count = width * height;
    if (!Array.isArray(heights) || heights.length !== count || Array.from(heights).some(number => !Number.isFinite(number) || number < 0 || number > 10000)) throw new TypeError('Terrain heights must be bounded finite samples matching the grid');
    if (!Array.isArray(flow) || flow.length !== count || Array.from(flow).some(number => !Number.isFinite(number) || number < 0 || number > 1)) throw new TypeError('Terrain flow must be samples in [0,1] matching the grid');
    const result = { version: 1, width, height, bounds: [...bounds], heights: [...heights], flow: [...flow] };
    if (value.provenance != null) {
        if (!isPlainJsonObject(value.provenance)) throw new TypeError('Terrain provenance must be a bounded JSON object');
        const provenance = cloneStrictJson(value.provenance, 'Terrain provenance');
        const encoded = JSON.stringify(provenance);
        if (encoded.length > 16384) throw new TypeError('Terrain provenance must be a bounded JSON object');
        result.provenance = provenance;
    }
    return result;
}

/** Bilinear height sampling, clamped at the saved map boundary. */
export function sampleTerrainHeightfield(field, x, z, channel = 'heights') {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !['heights', 'flow'].includes(channel)) throw new TypeError('Invalid terrain sample coordinate or channel');
    const gx = Math.max(0, Math.min(field.width - 1, (x - field.bounds[0]) / (field.bounds[2] - field.bounds[0]) * (field.width - 1)));
    const gz = Math.max(0, Math.min(field.height - 1, (z - field.bounds[1]) / (field.bounds[3] - field.bounds[1]) * (field.height - 1)));
    const ix = Math.min(field.width - 2, Math.floor(gx)), iz = Math.min(field.height - 2, Math.floor(gz));
    const tx = gx - ix, tz = gz - iz, values = field[channel];
    const first = values[iz * field.width + ix] * (1 - tx) + values[iz * field.width + ix + 1] * tx;
    const second = values[(iz + 1) * field.width + ix] * (1 - tx) + values[(iz + 1) * field.width + ix + 1] * tx;
    return first * (1 - tz) + second * tz;
}

/** Resampling changes display coordinates only; it never adds erosion or noise. */
export function resampleTerrainHeightfield(value, { width = value.width, height = value.height, bounds = value.bounds, heightScale = 1 } = {}) {
    const field = normalizeTerrainHeightfield(value), heights = [], flow = [];
    if (!Number.isFinite(heightScale) || heightScale <= 0 || heightScale > 100) throw new TypeError('Terrain height scale must be in (0,100]');
    if (![width, height].every(size => Number.isInteger(size) && size >= 2 && size <= 256)) throw new TypeError('Terrain resampling dimensions must be integers in [2,256]');
    if (!Array.isArray(bounds) || bounds.length !== 4 || Array.from(bounds).some(number => !Number.isFinite(number) || Math.abs(number) > 100000)
        || bounds[2] <= bounds[0] || bounds[3] <= bounds[1]) throw new TypeError('Terrain resampling bounds must be finite increasing intervals');
    for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
        const x = field.bounds[0] + column / (width - 1) * (field.bounds[2] - field.bounds[0]);
        const z = field.bounds[1] + row / (height - 1) * (field.bounds[3] - field.bounds[1]);
        heights.push(sampleTerrainHeightfield(field, x, z) * heightScale);
        flow.push(sampleTerrainHeightfield(field, x, z, 'flow'));
    }
    return normalizeTerrainHeightfield({ ...field, width, height, bounds: [...bounds], heights, flow });
}
