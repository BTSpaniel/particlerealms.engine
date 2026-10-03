// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { crc32 } from '../../core/math/ChecksumMath.js';

export const SURFACE_FIELD_CHANNELS = Object.freeze(['waterDepthM', 'coatingKgM2', 'temperatureK',
    'damageFraction', 'sootFraction', 'moistureKgM2', 'substrateKgM2', 'mistKgM2S']);
export const SURFACE_NO_NEIGHBOR = 0xffffffff;
export const DEFAULT_SURFACE_DOMAINS = Object.freeze([
    { id: 'wood', name: 'Pine panel', center: [-2.75, .8, 0], size: [2.4, 3.1], material: 'wood', substrateDepthM: .012 },
    { id: 'metal', name: 'Copper panel', center: [0, .8, 0], size: [2.4, 3.1], material: 'metal', substrateDepthM: .003 },
    { id: 'stone', name: 'Brick panel', center: [2.75, .8, 0], size: [2.4, 3.1], material: 'stone', substrateDepthM: .025 },
    { id: 'floor', name: 'Receiving masonry floor', center: [0, 0, 0], size: [10, 6], material: 'stone', substrateDepthM: .04, receiveRunoff: true },
]);

/** Physical locations are independent of the optional rotated storage charts. */
export function createSurfaceFieldTopology({ domains = DEFAULT_SURFACE_DOMAINS, n = 16, seams = true, closed = false } = {}) {
    if (!Number.isInteger(n) || n < 2 || n > 64 || (seams && n % 2)) throw new RangeError('Surface grid must be 2–64; rotated charts require even n');
    if (!Array.isArray(domains) || !domains.length || domains.length > 16) throw new RangeError('Surface topology requires 1–16 domains');
    const ids = new Set(), owned = domains.map((input, index) => {
        if (!input || typeof input !== 'object') throw new TypeError('Surface domain must be an object');
        const id = input.id ?? `surface-${index}`, material = input.material ?? 'wood';
        if (typeof id !== 'string' || !id || ids.has(id)) throw new RangeError('Surface domain ids must be unique');
        if (!['wood', 'metal', 'stone', 'calcite'].includes(material)) throw new RangeError('Unknown surface material');
        const center = [...(input.center ?? [0, 0, 0])], size = [...(input.size ?? [2, 2])];
        if (center.length !== 3 || !center.every(Number.isFinite) || size.length !== 2 || !size.every(v => Number.isFinite(v) && v > .001 && v <= 100)) throw new RangeError('Invalid surface dimensions');
        const substrateDepthM = input.substrateDepthM ?? .01, tiltX = input.tiltX ?? 0, tiltZ = input.tiltZ ?? 0;
        if (!Number.isFinite(substrateDepthM) || substrateDepthM < .00001 || substrateDepthM > 1 || !Number.isFinite(tiltX) || !Number.isFinite(tiltZ)) throw new RangeError('Invalid surface depth or slope');
        ids.add(id); return Object.freeze({ id, name: input.name ?? id, center: Object.freeze(center), size: Object.freeze(size), material, substrateDepthM, tiltX, tiltZ, receiveRunoff: !!input.receiveRunoff });
    });
    const count = n * n * owned.length, meta = new Float32Array(count * 8), neighbors = new Uint32Array(count * 4);
    const incomingLists = Array.from({ length: count }, () => []), edgeSources = [];
    neighbors.fill(SURFACE_NO_NEIGHBOR);
    const address = (domain, x, y) => {
        const d = typeof domain === 'string' ? owned.findIndex(item => item.id === domain) : domain;
        if (!Number.isInteger(d) || d < 0 || d >= owned.length || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= n || y >= n) throw new RangeError('Invalid surface cell address');
        if (!seams) return d * n * n + y * n + x;
        const h = n / 2, qx = Math.floor(x / h), qy = Math.floor(y / h); let a = x % h, b = y % h;
        if (qx === 1 && qy === 0) [a, b] = [h - 1 - b, a];
        else if (qx === 0 && qy === 1) [a, b] = [b, h - 1 - a];
        else if (qx === 1 && qy === 1) [a, b] = [h - 1 - a, h - 1 - b];
        return d * n * n + (qy * h + b) * n + qx * h + a;
    };
    const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (let d = 0; d < owned.length; d++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const domain = owned[d], i = address(d, x, y), px = domain.center[0] + ((x + .5) / n - .5) * domain.size[0], pz = domain.center[2] + ((y + .5) / n - .5) * domain.size[1];
        const height = domain.center[1] + (px - domain.center[0]) * domain.tiltX + (pz - domain.center[2]) * domain.tiltZ;
        const sheltered = owned.some((cover, index) => index !== d && cover.center[1] + (px - cover.center[0]) * cover.tiltX + (pz - cover.center[2]) * cover.tiltZ > height
            && Math.abs(px - cover.center[0]) < cover.size[0] / 2 && Math.abs(pz - cover.center[2]) < cover.size[1] / 2);
        meta.set([px, height, pz, domain.size[0] * domain.size[1] / (n * n), d, sheltered ? 0 : 1, ['wood', 'metal', 'stone', 'calcite'].indexOf(domain.material), domain.substrateDepthM], i * 8);
        directions.forEach(([dx, dy], k) => {
            const xx = x + dx, yy = y + dy; let j = SURFACE_NO_NEIGHBOR;
            if (xx >= 0 && yy >= 0 && xx < n && yy < n) j = address(d, xx, yy);
            else if (closed) j = i;
            else if (!domain.receiveRunoff) {
                const ex = px + dx * domain.size[0] / n, ez = pz + dy * domain.size[1] / n;
                const receiver = owned.findIndex(target => target.receiveRunoff && target.center[1] < domain.center[1]
                    && Math.abs(ex - target.center[0]) < target.size[0] / 2 && Math.abs(ez - target.center[2]) < target.size[1] / 2);
                if (receiver >= 0) {
                    const target = owned[receiver];
                    j = address(receiver, Math.min(n - 1, Math.floor((.5 + (ex - target.center[0]) / target.size[0]) * n)),
                        Math.min(n - 1, Math.floor((.5 + (ez - target.center[2]) / target.size[1]) * n)));
                    edgeSources.push(i * 4 + k);
                }
            }
            neighbors[i * 4 + k] = j;
            if (j !== SURFACE_NO_NEIGHBOR) incomingLists[j].push(i * 4 + k);
        });
    }
    const offsets = new Uint32Array(count * 2), flat = [];
    incomingLists.forEach((edges, i) => { offsets.set([flat.length, edges.length], i * 2); flat.push(...edges); });
    const configuration = { n, domains: owned, seams: !!seams, closed: !!closed };
    let checksum = crc32(new TextEncoder().encode(JSON.stringify(configuration)));
    for (const array of [meta, neighbors, offsets, new Uint32Array(flat)]) checksum = crc32(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), checksum);
    const identity = `surface-v1-${checksum.toString(16).padStart(8, '0')}`;
    return Object.freeze({ ...configuration, count, identity, meta, neighbors, offsets, incoming: new Uint32Array(flat), edgeSources: new Uint32Array(edgeSources), address });
}
