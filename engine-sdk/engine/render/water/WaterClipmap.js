// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Indexed nested rings. Outer fine edges collapse onto the next coarse edge;
 * the shader transfers their high frequencies continuously before the seam.
 * Coordinates remain local; authored camera/source controls determine placement.
 */
export function createWaterClipmap({ cells = 64, levels = 7 } = {}) {
    if (![32, 64, 96].includes(cells) || !Number.isInteger(levels) || levels < 1 || levels > 7) throw new RangeError('Water clipmap requires 32/64/96 cells and 1–7 levels.');
    const vertices = [], indices = [], ranges = [];
    const half = cells / 2, inner = cells / 4;
    for (let level = 0; level < levels; level++) {
        const start = indices.length, base = vertices.length / 4, spacing = 2 ** level;
        for (let z = -half; z <= half; z++) for (let x = -half; x <= half; x++) {
            let px = x, pz = z;
            if (level < levels - 1) {
                if (Math.abs(z) === half && Math.abs(x) < half) px = Math.floor(x / 2) * 2;
                if (Math.abs(x) === half && Math.abs(z) < half) pz = Math.floor(z / 2) * 2;
            }
            vertices.push(px * spacing, pz * spacing, spacing, level);
        }
        for (let z = -half; z < half; z++) for (let x = -half; x < half; x++) {
            if (level && x >= -inner && x < inner && z >= -inner && z < inner) continue;
            const a = base + (z + half) * (cells + 1) + x + half, b = a + 1, c = a + cells + 1, d = c + 1;
            indices.push(a, c, b, b, c, d);
        }
        ranges.push(Object.freeze({ level, firstIndex: start, indexCount: indices.length - start }));
    }
    const positions = Float32Array.from(vertices), triangles = Uint32Array.from(indices), bytes = positions.byteLength + triangles.byteLength;
    if (bytes > 4 * 1024 * 1024) throw new RangeError('Water clipmap exceeds its 4 MiB geometry budget.');
    return Object.freeze({ vertices: positions, indices: triangles, ranges: Object.freeze(ranges), cells, levels, bytes });
}
