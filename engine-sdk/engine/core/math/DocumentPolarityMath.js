// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Local polarity normalization for mixed light-on-dark / dark-on-light pages.
 *
 * Document analysis decides polarity once per page (it inverts only when most
 * pixels are dark). Thumbnails, slides and UI screenshots mix both: white titles
 * on a blue bar beside dark text on a light panel. Here the page is split at its
 * global Otsu threshold into connected light and dark regions. Large solid
 * regions are backgrounds and keep their own polarity; every small region
 * (strokes, letter holes) takes the polarity of the backgrounds it touches.
 * Dark backgrounds and everything inside them are inverted, so each region
 * reaches the analyzer as dark ink on a light ground. Region boundaries follow
 * real edges, so panel borders do not become ink. One-polarity pages are left
 * untouched, which keeps the analyzer's existing global rule in charge.
 */
import { documentOtsuThreshold } from './DocumentImageMath.js';

const MAX_PIXELS = 16_777_216;

/**
 * @param {{data: Uint8ClampedArray|Uint8Array, width: number, height: number}} image RGBA
 * @param {{minMixedFraction?: number}} [options]
 * @returns {{image: {data: Uint8ClampedArray, width: number, height: number}, changed: boolean, darkFraction: number, backgrounds: number}}
 */
export function normalizeDocumentPolarity(image, { minMixedFraction = .08 } = {}) {
    const { data, width, height } = image ?? {};
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > MAX_PIXELS
        || !(data instanceof Uint8ClampedArray || data instanceof Uint8Array) || data.length !== width * height * 4) {
        throw new TypeError('Polarity normalization requires a bounded RGBA image');
    }
    const count = width * height, gray = new Uint8Array(count);
    for (let index = 0; index < count; index++) gray[index] = 0.2126 * data[index * 4] + 0.7152 * data[index * 4 + 1] + 0.0722 * data[index * 4 + 2];
    const threshold = documentOtsuThreshold(gray);
    const unchanged = (darkFraction, backgrounds) => ({ image: { data: data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data), width, height }, changed: false, darkFraction, backgrounds });

    // 4-connected regions of one class (light = above threshold).
    const labels = new Int32Array(count).fill(-1), stack = new Int32Array(count);
    const area = [], light = [], minX = [], maxX = [], minY = [], maxY = [];
    for (let start = 0; start < count; start++) {
        if (labels[start] >= 0) continue;
        const label = area.length, isLight = gray[start] > threshold;
        let top = 0, size = 0, x0 = width, x1 = 0, y0 = height, y1 = 0;
        labels[start] = label; stack[top++] = start;
        const push = next => { if (labels[next] < 0 && (gray[next] > threshold) === isLight) { labels[next] = label; stack[top++] = next; } };
        while (top) {
            const index = stack[--top], x = index % width, y = (index - x) / width; size++;
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
            if (x > 0) push(index - 1); if (x < width - 1) push(index + 1);
            if (y > 0) push(index - width); if (y < height - 1) push(index + width);
        }
        area.push(size); light.push(isLight); minX.push(x0); maxX.push(x1); minY.push(y0); maxY.push(y1);
    }
    /** Visit each pair of different regions sharing a pixel edge (only boundaries call back). */
    const forEachBoundary = visit => {
        for (let y = 0; y < height; y++) {
            for (let x = 0, index = y * width; x < width; x++, index++) {
                const a = labels[index];
                if (x < width - 1 && labels[index + 1] !== a) visit(a, labels[index + 1]);
                if (y < height - 1 && labels[index + width] !== a) visit(a, labels[index + width]);
            }
        }
    };
    // Backgrounds are large, solid regions: wider and taller than any text line.
    const span = Math.max(24, Math.round(Math.sqrt(count) / 12));
    const big = area.map((size, label) => {
        const boxWidth = maxX[label] - minX[label] + 1, boxHeight = maxY[label] - minY[label] + 1;
        return boxWidth >= span * 2 && boxHeight >= span && size >= boxWidth * boxHeight * .4;
    });
    // A huge dark glyph on a light page (display type) is also large and solid.
    // A dark BACKGROUND must host text: at least three text-sized light regions
    // touching it. Speckle inside a textured letter is too small to count, and
    // a letter's own counter is only one.
    const textSized = label => area[label] >= 16 && maxY[label] - minY[label] >= 5;
    const hosted = new Map();
    const host = (background, child) => {
        if (!big[background] || light[background] || big[child] || !light[child] || !textSized(child)) return;
        let children = hosted.get(background); if (!children) hosted.set(background, children = new Set());
        if (children.size < 3) children.add(child);
    };
    forEachBoundary((a, b) => { host(a, b); host(b, a); });
    big.forEach((isBig, label) => { if (isBig && !light[label] && (hosted.get(label)?.size ?? 0) < 3) big[label] = false; });
    let darkArea = 0, backgroundArea = 0, backgrounds = 0;
    big.forEach((isBig, label) => { if (isBig) { backgrounds++; backgroundArea += area[label]; if (!light[label]) darkArea += area[label]; } });
    const darkFraction = backgroundArea ? darkArea / backgroundArea : 0;
    if (!backgroundArea || darkFraction < minMixedFraction || darkFraction > 1 - minMixedFraction) return unchanged(darkFraction, backgrounds);

    // Small regions vote with the backgrounds they touch.
    const darkVotes = new Int32Array(area.length), lightVotes = new Int32Array(area.length);
    const vote = (small, background) => { if (light[background]) lightVotes[small]++; else darkVotes[small]++; };
    forEachBoundary((a, b) => { if (big[a] && !big[b]) vote(b, a); else if (big[b] && !big[a]) vote(a, b); });
    // Letter holes touch only their stroke; they inherit through it (bounded passes).
    const invert = new Uint8Array(area.length), decided = new Uint8Array(area.length);
    for (let label = 0; label < area.length; label++) {
        if (big[label]) { invert[label] = light[label] ? 0 : 1; decided[label] = 1; }
        else if (darkVotes[label] || lightVotes[label]) { invert[label] = darkVotes[label] > lightVotes[label] ? 1 : 0; decided[label] = 1; }
    }
    for (let pass = 0; pass < 3; pass++) {
        let progress = false;
        forEachBoundary((a, b) => {
            if (decided[a] && !decided[b]) { invert[b] = invert[a]; decided[b] = 1; progress = true; }
            else if (decided[b] && !decided[a]) { invert[a] = invert[b]; decided[a] = 1; progress = true; }
        });
        if (!progress) break;
    }
    // Backgrounds are flattened to white: a tone step between two dark panels
    // (a blue bar on a navy page) would otherwise survive inversion as an edge
    // the adaptive threshold reads as a stroke.
    const output = new Uint8ClampedArray(data);
    for (let index = 0; index < count; index++) {
        const label = labels[index], offset = index * 4;
        if (big[label]) { output[offset] = output[offset + 1] = output[offset + 2] = 255; continue; }
        if (!invert[label]) continue;
        output[offset] = 255 - data[offset]; output[offset + 1] = 255 - data[offset + 1]; output[offset + 2] = 255 - data[offset + 2];
    }
    console.debug('[Engine][DocumentPolarity][normalized]', { width, height, backgrounds, darkFraction: Number(darkFraction.toFixed(3)) });
    return { image: { data: output, width, height }, changed: true, darkFraction, backgrounds };
}
