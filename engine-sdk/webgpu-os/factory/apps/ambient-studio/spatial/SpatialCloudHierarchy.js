// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { packCloud, unpackCloud, validateCloud, encodeFloats, decodeFloats, decodeGroups, quatCovariance, normalizeSpatialOrigin } from './SpatialCore.js';
import { cloneStrictJson, deepFreezeJson } from '../../../../../engine/core/schema/StrictJsonValue.js';

/** Static captured Gaussian hierarchy. Leaves partition every original identity;
 * internal payloads are deterministic representatives, not reconstructed geometry.
 * Bounds and payload positions share the manifest's double-precision origin.
 * Runtime must replace an entire frontier only after all its assets are ready. */
export const SPATIAL_CLOUD_HIERARCHY_BUDGETS = Object.freeze({
    maxLeafPoints: 4096, maxCoarsePoints: 256, maxNodes: 255,
    maxDepth: 16, maxStoredPoints: 400000, maxStoredBytes: 128 * 1024 * 1024,
});
const LIMITS = Object.freeze({ maxLeafPoints: 160000, maxCoarsePoints: 160000, maxNodes: 511, maxDepth: 24, maxStoredPoints: 600000, maxStoredBytes: 256 * 1024 * 1024 });
const NODE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,95}$/;
const ASSET_ID = /^asset-[\w-]{1,80}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const validated = new WeakMap();

function integer(value, min, max, label) {
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new TypeError(`${label} must be an integer in [${min}, ${max}].`);
    return value;
}

function keys(value, allowed, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new TypeError(`Unknown or invalid ${label} fields.`);
}

function hierarchyBudgets(value = {}) {
    keys(value, Object.keys(LIMITS), 'hierarchy budget');
    const result = { ...SPATIAL_CLOUD_HIERARCHY_BUDGETS, ...value };
    for (const key of Object.keys(LIMITS)) integer(result[key], 1, LIMITS[key], key);
    if (result.maxCoarsePoints > result.maxLeafPoints) throw new TypeError('Coarse point budget cannot exceed leaf point budget.');
    return result;
}

function bounds(value) {
    keys(value, ['min', 'max'], 'hierarchy bounds');
    const min = normalizeSpatialOrigin(value.min), max = normalizeSpatialOrigin(value.max);
    // Selection-only bounds may apply a supported 1000x object transform to an
    // unrelated far node conservatively. Raw payload limits remain in unpackCloud.
    if (min.some((x, axis) => x > max[axis] || Math.abs(x) > 5e10 || Math.abs(max[axis]) > 5e10)) throw new TypeError('Invalid local hierarchy bounds.');
    return { min, max };
}

function containsBounds(outer, inner) {
    return inner.min.every((x, axis) => x >= outer.min[axis] && inner.max[axis] <= outer.max[axis]);
}

/** Validate before resolving any asset. Returned JSON is a frozen owned copy.
 * Source identities prove that leaves are an exact partition, and every coarse
 * payload uses only identities owned by its subtree. Unbound drafts are explicit. */
export function validateSpatialCloudHierarchy(value, { requireAssetIds = true } = {}) {
    const known = value && validated.get(value);
    if (known && (!requireAssetIds || known.bound)) return value;
    const manifest = cloneStrictJson(value, '$.hierarchy');
    keys(manifest, ['format', 'version', 'rootId', 'origin', 'bounds', 'sourceCount', 'sourceSha256', 'shDegree', 'budgets', 'nodes', 'groupBounds'], 'hierarchy');
    if (manifest.format !== 'ambient.gaussian-hierarchy' || manifest.version !== 1) throw new TypeError('Unsupported Gaussian hierarchy.');
    manifest.origin = normalizeSpatialOrigin(manifest.origin);
    manifest.bounds = bounds(manifest.bounds);
    integer(manifest.sourceCount, 1, 200000, 'Hierarchy source count');
    if (!(manifest.sourceSha256 === null && !requireAssetIds) && (typeof manifest.sourceSha256 !== 'string' || !SHA256.test(manifest.sourceSha256))) throw new TypeError('Hierarchy canonical source SHA-256 must be bound and valid.');
    integer(manifest.shDegree, 0, 3, 'Hierarchy SH degree');
    manifest.budgets = hierarchyBudgets(manifest.budgets);
    if (!Array.isArray(manifest.groupBounds) || !manifest.groupBounds.length || manifest.groupBounds.length > manifest.sourceCount) throw new TypeError('Hierarchy canonical group bounds are required.');
    const groupIds = new Set();
    for (const group of manifest.groupBounds) {
        keys(group, ['groupId', 'min', 'max'], 'hierarchy group bounds');
        integer(group.groupId, 0, 4294967295, 'Hierarchy group ID');
        if (groupIds.has(group.groupId) || !containsBounds(manifest.bounds, bounds({ min: group.min, max: group.max }))) throw new TypeError('Hierarchy group bounds must be unique and inside the source bounds.');
        groupIds.add(group.groupId);
    }
    if (!Array.isArray(manifest.nodes) || !manifest.nodes.length || manifest.nodes.length > manifest.budgets.maxNodes) throw new TypeError('Hierarchy node budget exceeded.');
    const nodes = new Map(), sourceIds = new Map(), owners = new Int32Array(manifest.sourceCount).fill(-1);
    let total = 0, storedBytes = 0, bound = manifest.sourceSha256 !== null;
    for (const node of manifest.nodes) {
        keys(node, ['id', 'assetId', 'parentId', 'depth', 'bounds', 'error', 'count', 'sourceCount', 'children', 'sourceIds', 'byteLength'], 'hierarchy node');
        if (typeof node.id !== 'string' || !NODE_ID.test(node.id) || nodes.has(node.id)) throw new TypeError('Hierarchy node IDs must be valid and unique.');
        if (node.assetId === null && !requireAssetIds) bound = false;
        else if (typeof node.assetId !== 'string' || !ASSET_ID.test(node.assetId)) throw new TypeError('Hierarchy asset IDs must be bound and valid.');
        if (node.parentId !== null && (typeof node.parentId !== 'string' || !NODE_ID.test(node.parentId))) throw new TypeError('Invalid hierarchy parent ID.');
        integer(node.depth, 0, manifest.budgets.maxDepth, 'Hierarchy depth');
        integer(node.count, 1, manifest.budgets.maxLeafPoints, 'Hierarchy payload count');
        integer(node.sourceCount, node.count, manifest.sourceCount, 'Hierarchy subtree count');
        integer(node.byteLength, Math.ceil(node.count * 14 * 4 / 3) * 4, manifest.budgets.maxStoredBytes, 'Hierarchy chunk byte length');
        node.bounds = bounds(node.bounds);
        if (!Number.isFinite(node.error) || node.error < 0 || node.error > 1e11) throw new TypeError('Invalid hierarchy geometric error.');
        if (!Array.isArray(node.children) || ![0, 2].includes(node.children.length) || node.children.some(id => typeof id !== 'string' || !NODE_ID.test(id))) throw new TypeError('A hierarchy node must have zero or two valid children.');
        if (node.children.length && node.count > manifest.budgets.maxCoarsePoints) throw new TypeError('Hierarchy coarse point budget exceeded.');
        if (!node.children.length && (node.count !== node.sourceCount || node.error !== 0)) throw new TypeError('Hierarchy leaf count/error is inconsistent.');
        if (typeof node.sourceIds !== 'string') throw new TypeError('Hierarchy source IDs are required.');
        const ids = decodeGroups(node.sourceIds, node.count), unique = new Set(ids);
        if (unique.size !== ids.length || ids.some(id => id >= manifest.sourceCount)) throw new TypeError('Hierarchy source IDs must be unique and in range.');
        sourceIds.set(node.id, ids); nodes.set(node.id, node); total += node.count; storedBytes += node.byteLength + node.sourceIds.length;
    }
    if (total > manifest.budgets.maxStoredPoints) throw new TypeError('Hierarchy stored point budget exceeded.');
    if (storedBytes > manifest.budgets.maxStoredBytes) throw new TypeError('Hierarchy stored byte budget exceeded.');
    const root = nodes.get(manifest.rootId);
    if (!root || root.parentId !== null || root.depth !== 0 || root.sourceCount !== manifest.sourceCount || !containsBounds(root.bounds, manifest.bounds) || !containsBounds(manifest.bounds, root.bounds)) throw new TypeError('Invalid hierarchy root.');
    const visited = new Set(), intervals = new Map();
    let leafIndex = 0;
    function visit(node) {
        if (visited.has(node.id)) throw new TypeError('Hierarchy has a cycle or shared child.');
        visited.add(node.id);
        const start = leafIndex;
        if (!node.children.length) {
            for (const id of sourceIds.get(node.id)) { if (owners[id] !== -1) throw new TypeError('Hierarchy leaves duplicate a source identity.'); owners[id] = leafIndex; }
            leafIndex++;
        } else {
            let count = 0;
            for (const id of node.children) {
                const child = nodes.get(id);
                if (!child || child.parentId !== node.id || child.depth !== node.depth + 1 || !containsBounds(node.bounds, child.bounds) || child.error > node.error) throw new TypeError('Hierarchy child relationship, bounds or error is invalid.');
                count += child.sourceCount; visit(child);
            }
            if (count !== node.sourceCount) throw new TypeError('Hierarchy child counts do not cover their parent.');
        }
        intervals.set(node.id, [start, leafIndex]);
    }
    visit(root);
    if (visited.size !== nodes.size || owners.some(owner => owner < 0)) throw new TypeError('Hierarchy has unreachable nodes or missing source identities.');
    for (const node of manifest.nodes) {
        const [start, end] = intervals.get(node.id);
        if (sourceIds.get(node.id).some(id => owners[id] < start || owners[id] >= end)) throw new TypeError('Coarse source identity lies outside its subtree.');
    }
    deepFreezeJson(manifest);
    validated.set(manifest, { bound, nodes });
    return manifest;
}

/** Bind existing content-addressed chunks and the original source descriptor's
 * SHA-256. Playback must match sourceSha256 to its selected canonical asset. */
export function bindSpatialCloudHierarchyAssets(value, assetIdsByNode, options = {}) {
    const manifest = validateSpatialCloudHierarchy(value, { requireAssetIds: false });
    options = cloneStrictJson(options, '$.hierarchyBinding');
    keys(options, ['sourceSha256'], 'hierarchy binding');
    if (!assetIdsByNode || typeof assetIdsByNode !== 'object') throw new TypeError('Hierarchy asset bindings are required.');
    return validateSpatialCloudHierarchy({ ...manifest, sourceSha256: options.sourceSha256 === undefined ? manifest.sourceSha256 : options.sourceSha256, nodes: manifest.nodes.map(node => ({ ...node, assetId: assetIdsByNode instanceof Map ? assetIdsByNode.get(node.id) : assetIdsByNode[node.id] })) });
}

/** Admit resolved immutable payloads before handing them to a renderer. */
export function validateSpatialCloudHierarchyChunk(value, nodeId, candidate) {
    const manifest = validateSpatialCloudHierarchy(value), node = validated.get(manifest).nodes.get(nodeId);
    if (!node) throw new TypeError('Unknown hierarchy chunk node.');
    const cloud = validateCloud(candidate), raw = unpackCloud(cloud);
    if (cloud.count !== node.count || (cloud.sphericalHarmonics?.degree ?? 0) !== manifest.shDegree || !cloud.origin || cloud.origin.some((x, axis) => x !== manifest.origin[axis])) throw new TypeError('Hierarchy chunk count, SH degree or origin mismatch.');
    if (new TextEncoder().encode(JSON.stringify(cloud)).length !== node.byteLength) throw new TypeError('Hierarchy chunk byte length mismatch.');
    if (cloud.sphericalHarmonics) decodeFloats(cloud.sphericalHarmonics.data, cloud.count * (manifest.shDegree + 1) ** 2 * 3);
    const groups = decodeGroups(cloud.groups, cloud.count), canonical = new Map(manifest.groupBounds.map(group => [group.groupId, group]));
    for (let id = 0; id < cloud.count; id++) {
        const k = id * 14, covariance = quatCovariance(...raw.subarray(k + 3, k + 10)), group = canonical.get(groups[id]);
        if (!group) throw new TypeError('Hierarchy chunk has an unknown canonical group.');
        for (let axis = 0; axis < 3; axis++) {
            const p = raw[k + axis], extent = 3 * Math.sqrt(covariance[[0, 3, 5][axis]]);
            if (p - extent < node.bounds.min[axis] || p + extent > node.bounds.max[axis] || p < group.min[axis] || p > group.max[axis]) throw new TypeError('Hierarchy chunk exceeds its declared canonical bounds.');
        }
    }
    return cloud;
}

function pointBounds(ids, raw, extents = null) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const id of ids) for (let axis = 0; axis < 3; axis++) {
        const position = raw[id * 14 + axis], extent = extents?.[id * 3 + axis] ?? 0;
        min[axis] = Math.min(min[axis], position - extent); max[axis] = Math.max(max[axis], position + extent);
    }
    return { min, max };
}

function splitIds(ids, raw) {
    const box = pointBounds(ids, raw), spans = box.max.map((value, axis) => value - box.min[axis]);
    const axis = spans.indexOf(Math.max(...spans));
    const sorted = [...ids].sort((a, b) => raw[a * 14 + axis] - raw[b * 14 + axis] || a - b), middle = Math.floor(sorted.length / 2);
    return [sorted.slice(0, middle), sorted.slice(middle)];
}

/** Spatial median cells preserve group coverage without random/stride sampling.
 * A group's last member is never discarded to satisfy a coarse budget. */
function representatives(ids, raw, groups, budget) {
    const grouped = new Map();
    for (const id of ids) { const group = groups[id]; if (!grouped.has(group)) grouped.set(group, []); grouped.get(group).push(id); }
    if (grouped.size > budget) throw new RangeError('Coarse budget cannot preserve all explicit object groups; increase maxCoarsePoints.');
    const cells = [...grouped.values()];
    while (cells.length < budget) {
        let at = -1, count = 1;
        for (let i = 0; i < cells.length; i++) if (cells[i].length > count) { at = i; count = cells[i].length; }
        if (at < 0) break;
        cells.splice(at, 1, ...splitIds(cells[at], raw));
    }
    let error = 0;
    const selected = cells.map(cell => {
        const box = pointBounds(cell, raw), center = box.min.map((x, axis) => (x + box.max[axis]) * .5);
        let best = cell[0], distance = Infinity;
        for (const id of cell) {
            const d = center.reduce((sum, x, axis) => sum + (x - raw[id * 14 + axis]) ** 2, 0);
            if (d < distance || d === distance && id < best) { best = id; distance = d; }
        }
        for (const id of cell) if (id !== best) {
            const separation = Math.hypot(...[0, 1, 2].map(axis => raw[id * 14 + axis] - raw[best * 14 + axis]));
            // Conservative support displacement, including differences in footprints.
            const support = 3 * (Math.max(...raw.subarray(id * 14 + 3, id * 14 + 6)) + Math.max(...raw.subarray(best * 14 + 3, best * 14 + 6)));
            error = Math.max(error, separation + support);
        }
        return best;
    });
    return { ids: selected.sort((a, b) => a - b), error };
}

/** Build a deterministic immutable draft plus serialized cloud chunks. Budget
 * exhaustion rejects the build rather than dropping original leaf geometry.
 * onEvent receives bounded preparation diagnostics; no global logging state. */
export function buildSpatialCloudHierarchy(value, options = {}) {
    const budgets = hierarchyBudgets(options.budgets ?? Object.fromEntries(Object.keys(LIMITS).filter(key => options[key] !== undefined).map(key => [key, options[key]])));
    const cloud = validateCloud(value), canonical = unpackCloud(cloud), raw = decodeFloats(cloud.data, cloud.count * 14);
    const origin = cloud.origin ? [...cloud.origin] : [0, 0, 0], groups = decodeGroups(cloud.groups, cloud.count);
    const shDegree = cloud.sphericalHarmonics?.degree ?? 0, stride = (shDegree + 1) ** 2 * 3;
    const sh = cloud.sphericalHarmonics ? decodeFloats(cloud.sphericalHarmonics.data, cloud.count * stride) : null;
    const confidence = cloud.confidence ? decodeFloats(cloud.confidence, cloud.count) : null, extents = new Float64Array(cloud.count * 3);
    const started = performance.now(), emit = typeof options.onEvent === 'function' ? options.onEvent : () => {};
    emit({ operation: 'hierarchy-build', state: 'start', sourceCount: cloud.count });
    try {
        for (let id = 0; id < cloud.count; id++) {
            const k = id * 14, covariance = quatCovariance(...canonical.subarray(k + 3, k + 10));
            for (let axis = 0; axis < 3; axis++) extents[id * 3 + axis] = 3 * Math.sqrt(covariance[[0, 3, 5][axis]]);
        }
        const nodes = [], clouds = {}, grouped = new Map();
        for (let id = 0; id < cloud.count; id++) { if (!grouped.has(groups[id])) grouped.set(groups[id], []); grouped.get(groups[id]).push(id); }
        const groupBounds = [...grouped].sort(([a], [b]) => a - b).map(([groupId, ids]) => ({ groupId, ...pointBounds(ids, raw) }));
        let storedPoints = 0, storedBytes = 0;
        function build(ids, parentId, depth) {
            if (nodes.length >= budgets.maxNodes || depth > budgets.maxDepth) throw new RangeError('Hierarchy node/depth budget cannot retain every source point.');
            const id = `n${nodes.length}`, leaf = ids.length <= budgets.maxLeafPoints;
            const sample = leaf ? { ids: [...ids].sort((a, b) => a - b), error: 0 } : representatives(ids, raw, groups, budgets.maxCoarsePoints);
            storedPoints += sample.ids.length;
            if (storedPoints > budgets.maxStoredPoints) throw new RangeError('Hierarchy stored point budget exceeded.');
            const data = new Float32Array(sample.ids.length * 14);
            sample.ids.forEach((source, index) => data.set(raw.subarray(source * 14, source * 14 + 14), index * 14));
            const payload = packCloud(data, { ...cloud.metadata, name: `${cloud.metadata.name} · ${id}`, provenance: `${cloud.metadata.provenance} ${leaf ? 'Exact hierarchy leaf.' : 'Deterministic coarse spatial representatives; omitted detail remains in leaves.'}` }, { origin });
            if (cloud.groups) payload.groups = encodeFloats(Uint32Array.from(sample.ids, source => groups[source]));
            if (confidence) payload.confidence = encodeFloats(Float32Array.from(sample.ids, source => confidence[source]));
            if (sh) {
                const values = new Float32Array(sample.ids.length * stride);
                sample.ids.forEach((source, index) => values.set(sh.subarray(source * stride, (source + 1) * stride), index * stride));
                payload.sphericalHarmonics = { degree: shDegree, data: encodeFloats(values) };
            }
            clouds[id] = deepFreezeJson(validateCloud(payload));
            const node = { id, assetId: null, parentId, depth, bounds: pointBounds(ids, raw, extents), error: sample.error, count: sample.ids.length, sourceCount: ids.length, children: [], sourceIds: encodeFloats(Uint32Array.from(sample.ids)), byteLength: new TextEncoder().encode(JSON.stringify(clouds[id])).length };
            storedBytes += node.byteLength + node.sourceIds.length;
            if (storedBytes > budgets.maxStoredBytes) throw new RangeError('Hierarchy stored byte budget exceeded.');
            nodes.push(node);
            if (!leaf) for (const subset of splitIds(ids, raw)) { const child = build(subset, id, depth + 1); node.children.push(child.id); node.error = Math.max(node.error, child.error); }
            return node;
        }
        const root = build(Array.from({ length: cloud.count }, (_, id) => id), null, 0);
        const manifest = validateSpatialCloudHierarchy({ format: 'ambient.gaussian-hierarchy', version: 1, rootId: root.id, origin, bounds: root.bounds, sourceCount: cloud.count, sourceSha256: null, shDegree, budgets, nodes, groupBounds }, { requireAssetIds: false });
        emit({ operation: 'hierarchy-build', state: 'complete', sourceCount: cloud.count, nodes: nodes.length, storedPoints, storedBytes, durationMs: performance.now() - started });
        return Object.freeze({ manifest, clouds: Object.freeze(clouds) });
    } catch (error) {
        emit({ operation: 'hierarchy-build', state: 'error', message: error.message });
        throw error;
    }
}

/** Camera matches SpatialCore: eye, forward, normalized fy; pixel scale is fy*height.
 * localOrigin permits small eye offsets at large world coordinates without ever
 * adding them to a large base. Hysteresis uses the previous complete frontier. */
export function selectSpatialCloudFrontier(value, camera, options = {}) {
    const manifest = validateSpatialCloudHierarchy(value), nodes = validated.get(manifest).nodes;
    const eye = normalizeSpatialOrigin(camera?.eye), forward = normalizeSpatialOrigin(camera?.forward), origin = camera.localOrigin === undefined ? [0, 0, 0] : normalizeSpatialOrigin(camera.localOrigin);
    const norm = Math.hypot(...forward), fy = camera.fy, height = options.viewportHeight ?? 1080;
    if (Math.abs(norm - 1) > 1e-4 || !Number.isFinite(fy) || fy <= 0 || fy > 1e6) throw new TypeError('Hierarchy camera needs a unit forward vector and positive finite fy.');
    integer(height, 1, 32768, 'Hierarchy viewport height');
    const maxPoints = integer(options.maxPoints ?? 160000, 1, 160000, 'Frontier point budget'), maxNodes = integer(options.maxNodes ?? 64, 1, LIMITS.maxNodes, 'Frontier node budget');
    const pixelError = options.pixelError ?? 2, hysteresis = options.hysteresis ?? .2;
    if (!Number.isFinite(pixelError) || pixelError <= 0 || !Number.isFinite(hysteresis) || hysteresis < 0 || hysteresis >= 1) throw new TypeError('Invalid frontier error/hysteresis threshold.');
    const localEye = eye.map((x, axis) => (origin[axis] - manifest.origin[axis]) + x), priorRefined = new Set();
    if (localEye.some(x => !Number.isFinite(x))) throw new TypeError('Hierarchy camera origin difference is not finite.');
    const previous = options.previousNodeIds ?? [];
    if (!Array.isArray(previous) || previous.length > LIMITS.maxNodes || new Set(previous).size !== previous.length) throw new TypeError('Invalid previous hierarchy frontier.');
    for (const id of previous) {
        let node = nodes.get(id);
        if (!node) throw new TypeError('Previous frontier contains an unknown node.');
        while (node.parentId !== null) { priorRefined.add(node.parentId); node = nodes.get(node.parentId); }
    }
    if (previous.some(id => priorRefined.has(id))) throw new TypeError('Previous frontier overlaps a parent and child.');
    if (previous.length && previous.reduce((sum, id) => sum + nodes.get(id).sourceCount, 0) !== manifest.sourceCount) throw new TypeError('Previous frontier must cover the complete source.');
    const errors = Object.create(null);
    function projected(node) {
        if (Object.hasOwn(errors, node.id)) return errors[node.id];
        const center = node.bounds.min.map((x, axis) => (x + node.bounds.max[axis]) * .5), half = node.bounds.max.map((x, axis) => (x - node.bounds.min[axis]) * .5);
        const depth = center.reduce((sum, x, axis) => sum + (x - localEye[axis]) * forward[axis], 0), radius = half.reduce((sum, x, axis) => sum + Math.abs(forward[axis]) * x, 0);
        const error = depth + radius <= 0 ? 0 : node.error * fy * height / Math.max(1e-6, depth - radius);
        errors[node.id] = error;
        return error;
    }
    const root = nodes.get(manifest.rootId), frontier = [root];
    if (root.count > maxPoints) throw new RangeError('Frontier point budget cannot hold the root payload.');
    let count = root.count, budgetLimited = false;
    while (true) {
        const candidates = frontier.filter(node => node.children.length && projected(node) > pixelError * (priorRefined.has(node.id) ? 1 - hysteresis : 1 + hysteresis));
        candidates.sort((a, b) => projected(b) - projected(a) || a.id.localeCompare(b.id));
        let replacement = null;
        for (const node of candidates) {
            const children = node.children.map(id => nodes.get(id)), nextCount = count - node.count + children.reduce((sum, child) => sum + child.count, 0);
            if (nextCount > maxPoints || frontier.length + children.length - 1 > maxNodes) { budgetLimited = true; continue; }
            replacement = { node, children, nextCount }; break;
        }
        if (!replacement) break;
        frontier.splice(frontier.indexOf(replacement.node), 1, ...replacement.children); count = replacement.nextCount;
    }
    const selectedErrors = {};
    for (const node of frontier) selectedErrors[node.id] = projected(node);
    return deepFreezeJson({ nodeIds: frontier.map(node => node.id), assetIds: frontier.map(node => node.assetId), count, errors: selectedErrors, budgetLimited });
}
