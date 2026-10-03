// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { cloneStrictJson } from '../../../../../engine/core/schema/StrictJsonValue.js';
import { validateSpatialCloudHierarchy } from './SpatialCloudHierarchy.js';
import { normalizeSpatialObjectEdits } from './SpatialObjectEdits.js';

/** Conservative selection bounds for saved object edits. Original canonical
 * group bounds supply each object's pivot, shared with prepareSpatialObjectEdits.
 * Every visible transform is applied independently to every original node box;
 * the union intentionally overestimates support and preserves parent containment.
 * Use the original manifest when validating unedited asset payloads. */
export function spatialCloudSelectionHierarchy(manifest, objectEdits) {
    if (objectEdits == null) return manifest;
    const edits = normalizeSpatialObjectEdits(objectEdits);
    if (!edits.objects.length) return manifest;
    manifest = validateSpatialCloudHierarchy(manifest);
    const canonical = new Map(manifest.groupBounds.map(group => [group.groupId, group]));
    const transforms = edits.objects.map(object => {
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (const groupId of object.groups) {
            const group = canonical.get(groupId);
            if (!group) throw new TypeError(`Object '${object.label}' selects no canonical Gaussian group ${groupId}.`);
            for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis], group.min[axis]); max[axis] = Math.max(max[axis], group.max[axis]); }
        }
        return { ...object, center: min.map((x, axis) => (x + max[axis]) * .5) };
    });
    const errorScale = Math.max(1, ...transforms.map(transform => transform.scale));
    const nodes = manifest.nodes.map(node => {
        const min = [...node.bounds.min], max = [...node.bounds.max];
        for (const transform of transforms) if (transform.visible) for (let axis = 0; axis < 3; axis++) {
            const low = transform.center[axis] + (node.bounds.min[axis] - transform.center[axis]) * transform.scale + transform.translation[axis];
            const high = transform.center[axis] + (node.bounds.max[axis] - transform.center[axis]) * transform.scale + transform.translation[axis];
            min[axis] = Math.min(min[axis], low); max[axis] = Math.max(max[axis], high);
        }
        return { ...node, bounds: { min, max }, error: node.error * errorScale };
    });
    return validateSpatialCloudHierarchy({ ...manifest, bounds: nodes.find(node => node.id === manifest.rootId).bounds, nodes });
}

/** Saved source policy, shared by node JSON, Studio and every playback surface. */
export const SPATIAL_STREAMING_DEFAULTS = Object.freeze({ version: 1, enabled: true, pixelError: 2,
    maxPoints: 160000, maxResidentBytes: 134217728, maxConcurrentLoads: 2, settleMs: 350, hysteresis: .2 });

export function normalizeSpatialStreamingPolicy(value = {}) {
    value = cloneStrictJson(value, '$.streaming');
    if (!value || Array.isArray(value) || Object.keys(value).some(key => !Object.hasOwn(SPATIAL_STREAMING_DEFAULTS, key))) throw new TypeError('Unknown progressive detail setting.');
    const policy = { ...SPATIAL_STREAMING_DEFAULTS, ...value };
    if (policy.version !== 1 || typeof policy.enabled !== 'boolean') throw new TypeError('Progressive detail needs version 1 and a boolean enabled setting.');
    for (const [key, min, max, integer] of [['pixelError', .25, 64], ['maxPoints', 256, 160000, true], ['maxResidentBytes', 8388608, 1073741824, true], ['maxConcurrentLoads', 1, 4, true], ['settleMs', 100, 5000, true], ['hysteresis', 0, .8]]) {
        if (!Number.isFinite(policy[key]) || policy[key] < min || policy[key] > max || integer && !Number.isInteger(policy[key])) throw new TypeError(`Progressive ${key} must be ${integer ? 'an integer' : 'a number'} in [${min}, ${max}].`);
    }
    return Object.freeze(policy);
}

/** Conservative admission reservation for decoded source, merge, simulation and
 * GPU lane staging. Render-target textures belong to the compositor's pixel
 * budget; this is a managed payload reservation, not a browser-heap measurement. */
export function spatialCloudReservation(manifest, nodeIds, assets) {
    const nodes = new Map(manifest.nodes.map(node => [node.id, node]));
    let count = 0, bytes = 1048576;
    for (const id of nodeIds) {
        const node = nodes.get(id), asset = assets.find(value => value.id === node?.assetId);
        if (!node || !asset || !Number.isSafeInteger(asset.byteLength) || asset.byteLength < 1) throw new TypeError('Progressive chunk needs a declared asset byte length.');
        count += node.count;
        bytes += asset.byteLength * 6;
    }
    // Includes raw/unpacked/local/edited arrays, geometry, phase/physics state,
    // neighbor edges, sorting/visibility and the GPU copies at maximum SH degree.
    return bytes + count * (1536 + Math.max(0, (manifest.shDegree + 1) ** 2) * 48);
}
