// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { validateCloud, unpackCloud, packCloud, decodeFloats, encodeFloats, decodeGroups } from '../../factory/apps/ambient-studio/spatial/SpatialCore.js';
import { validateSpatialCloudHierarchyChunk } from '../../factory/apps/ambient-studio/spatial/SpatialCloudHierarchy.js';
import { cloudSH } from '../../factory/apps/ambient-studio/spatial/SpatialSH.js';

/** Resolve a whole replacement frontier before publishing it. Every async stage
 * checks currentness; a failed/aborted child can never evict the visible parent. */
export async function loadSpatialCloudFrontier({ plan, nodeIds, assetResolver, signal }) {
    const manifest = plan.source.hierarchy, controller = new AbortController();
    const abort = () => controller.abort(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const check = () => controller.signal.throwIfAborted();
    try {
        const nodes = nodeIds.map(id => manifest.nodes.find(node => node.id === id)), chunks = new Array(nodes.length);
        if (nodes.some(node => !node)) throw new TypeError('Unknown progressive frontier node.');
        let cursor = 0;
        if (typeof assetResolver !== 'function') throw new Error('Progressive assets require an asset resolver.');
        const worker = async () => {
            while (cursor < nodes.length) {
                check(); const index = cursor++, node = nodes[index], descriptor = plan.assets.find(asset => asset.id === node.assetId);
                if (!descriptor) throw new TypeError(`Missing progressive asset ${node.assetId}`);
                const resolved = await assetResolver(descriptor, { projectId: plan.projectId, signal: controller.signal }); check();
                const blob = resolved instanceof Blob ? resolved : new Blob([resolved]);
                if (blob.size !== descriptor.byteLength) throw new TypeError(`Progressive chunk ${node.id} byte length mismatch.`);
                const buffer = await blob.arrayBuffer(); check();
                const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(byte => byte.toString(16).padStart(2, '0')).join(''); check();
                if (`sha256:${hash}` !== descriptor.sha256) throw new TypeError(`Progressive chunk ${node.id} content hash mismatch.`);
                const cloud = validateCloud(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)));
                validateSpatialCloudHierarchyChunk(manifest, node.id, cloud); check(); chunks[index] = cloud;
            }
        };
        const jobs = Array.from({ length: Math.min(nodes.length, plan.source.streaming.maxConcurrentLoads) }, () => worker().catch(error => { controller.abort(error); throw error; }));
        const results = await Promise.allSettled(jobs);
        const failure = results.find(result => result.status === 'rejected'); if (failure) throw failure.reason;
        check();
        return mergeSpatialCloudFrontier(manifest, nodes, chunks);
    } finally { signal?.removeEventListener('abort', abort); }
}

/** Merge local coordinates only. Source IDs and groups remain canonical across
 * refinement; the full import is never needed by the playback lane. */
export function mergeSpatialCloudFrontier(manifest, nodes, chunks) {
    const count = nodes.reduce((sum, node) => sum + node.count, 0);
    if (!count || count > 160000 || chunks.length !== nodes.length) throw new TypeError('Invalid progressive frontier size.');
    const data = new Float32Array(count * 14), groups = new Uint32Array(count), sourceIds = new Uint32Array(count), confidence = new Float32Array(count).fill(1);
    const degree = manifest.shDegree, coefficients = degree < 0 ? 0 : (degree + 1) ** 2 * 3, sh = coefficients ? new Float32Array(count * coefficients) : null;
    let start = 0, hasGroups = false, hasConfidence = false;
    const seen = new Set();
    for (let index = 0; index < chunks.length; index++) {
        const cloud = chunks[index], node = nodes[index], origin = cloud.origin ?? [0, 0, 0];
        unpackCloud(cloud); // Validate without normalizing stored quaternion bytes twice.
        const raw = decodeFloats(cloud.data, cloud.count * 14);
        if (cloud.count !== node.count) throw new TypeError('Progressive chunk point count mismatch.');
        const ids = decodeGroups(node.sourceIds, cloud.count);
        for (let i = 0; i < cloud.count; i++) {
            if (seen.has(ids[i])) throw new TypeError('A progressive frontier must not contain overlapping source identities.');
            seen.add(ids[i]);
            for (let axis = 0; axis < 3; axis++) raw[i * 14 + axis] += origin[axis] - manifest.origin[axis];
        }
        data.set(raw, start * 14); sourceIds.set(ids, start);
        if (cloud.groups) { hasGroups = true; groups.set(decodeGroups(cloud.groups, cloud.count), start); }
        if (cloud.confidence) { hasConfidence = true; confidence.set(decodeFloats(cloud.confidence, cloud.count), start); }
        if (sh) sh.set(cloudSH(cloud, degree), start * coefficients);
        start += cloud.count;
    }
    // Depth ties must retain the canonical compositing order, independent of
    // spatial partition traversal or asynchronous load completion order.
    const order = Uint32Array.from({ length: count }, (_, i) => i).sort((a, b) => sourceIds[a] - sourceIds[b]);
    for (const [values, stride] of [[data, 14], [groups, 1], [sourceIds, 1], [confidence, 1], ...(sh ? [[sh, coefficients]] : [])]) {
        const original = values.slice();
        for (let i = 0; i < count; i++) values.set(original.subarray(order[i] * stride, (order[i] + 1) * stride), i * stride);
    }
    const cloud = packCloud(data, { name: 'Progressive scene', provenance: 'Saved local Gaussian hierarchy frontier' }, { origin: manifest.origin });
    // encodeFloats serializes bytes unchanged, including this UInt32 view.
    if (hasGroups) cloud.groups = encodeFloats(new Float32Array(groups.buffer));
    if (hasConfidence) cloud.confidence = encodeFloats(confidence);
    if (sh) cloud.sphericalHarmonics = { degree, data: encodeFloats(sh) };
    return { cloud: validateCloud(cloud), sourceIds };
}
