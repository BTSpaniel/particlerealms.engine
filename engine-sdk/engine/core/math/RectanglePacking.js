// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Allocate one nonrotated rectangle from disjoint free rectangles.
 * Extracted from the Engine texture atlas. Units belong to the caller.
 * The input free list is mutated only when a placement exists.
 */
export function allocateBestAreaRectangle(freeRects, width, height) {
    if (![width, height].every(n => Number.isFinite(n) && n > 0)) throw new RangeError('Rectangle extents must be finite and positive');
    let bestIndex = -1, bestScore = Infinity;
    for (let i = 0; i < freeRects.length; i++) {
        const rect = freeRects[i];
        if (rect.w >= width && rect.h >= height) {
            const score = rect.w * rect.h - width * height;
            if (score < bestScore) { bestScore = score; bestIndex = i; }
        }
    }
    if (bestIndex < 0) return null;
    const rect = freeRects.splice(bestIndex, 1)[0];
    if (rect.w > width) freeRects.push({ x: rect.x + width, y: rect.y, w: rect.w - width, h: height });
    if (rect.h > height) freeRects.push({ x: rect.x, y: rect.y + height, w: rect.w, h: rect.h - height });
    return { x: rect.x, y: rect.y, w: width, h: height };
}
