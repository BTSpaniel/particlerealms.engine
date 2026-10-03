// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const SPATIAL_WATER_MEMORY_LIMIT = 64 * 1024 * 1024;

/** Linear color/depth plus an opaque snapshot cost exactly24 bytes per pixel.
 * Shared field and resident source allocations are admitted before targets. */
export function spatialWaterTargetPlan(width, height, residentBytes, limit = SPATIAL_WATER_MEMORY_LIMIT) {
    if (![width, height, residentBytes, limit].every(Number.isFinite) || width < 1 || height < 1 || residentBytes < 0 || limit < 1) throw new TypeError('Invalid finite water render budget');
    const available = Math.floor((limit - residentBytes) / 24);
    if (available < 4) throw new RangeError('Finite water resident resources exceed the shared64MiB budget');
    const scale = Math.min(1, Math.sqrt(available / (width * height)));
    let w = Math.max(1, Math.floor(width * scale)), h = Math.max(1, Math.floor(height * scale));
    // A one-pixel minimum can exceed the budget for an extreme aspect ratio.
    if (w * h > available) { if (w >= h) w = Math.max(1, Math.floor(available / h)); else h = Math.max(1, Math.floor(available / w)); }
    return { width: w, height: h, targetBytes: w * h * 24, residentBytes, totalBytes: residentBytes + w * h * 24, limit, scaled: w !== width || h !== height };
}

/** Split triangle ownership without reordering vertices or saved node IDs. */
export function spatialWaterDrawRanges(geometry) {
    const opaque = [], water = [];
    for (const range of geometry.meshRanges ?? []) {
        let first = range.start, count = 0, isWater = geometry.meshMaterials?.[first] === 4;
        for (let vertex = range.start; vertex < range.start + range.count; vertex += 3) {
            const next = geometry.meshMaterials?.[vertex] === 4;
            if (next !== isWater) {
                if (count) (isWater ? water : opaque).push({ ...range, start: first, count });
                first = vertex; count = 0; isWater = next;
            }
            count += 3;
        }
        if (count) (isWater ? water : opaque).push({ ...range, start: first, count });
    }
    return { opaque, water };
}
