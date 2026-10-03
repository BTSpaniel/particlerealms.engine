// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { IncrementalSha256 } from '../../../storage/IncrementalSha256.js';

export const AMBIENT_PROJECT_V2_SCHEMA = 'particle-realms.ambient-project.v2';
export const AMBIENT_PROJECT_V2_VERSION = 2;
export const AMBIENT_PROJECT_V2_LIMITS = Object.freeze({
    jsonBytes: 8 * 1024 * 1024,
    assets: 510,
    layers: 4096,
    graphNodes: 4096,
    graphConnections: 16384,
    timelineTracks: 4096,
    keyframes: 65536,
    publishedControls: 256,
    extensionDepth: 32,
});

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const RECORD_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const ASSET_PATH_PATTERN = /^assets\/([a-f0-9]{64})\.([a-z0-9]{1,12})$/;
const ISO_EPOCH = '1970-01-01T00:00:00.000Z';
const FORBIDDEN_ASSET_MEDIA = /^(?:text\/html|application\/(?:javascript|ecmascript|x-javascript)|text\/(?:javascript|ecmascript)|image\/svg\+xml)$/i;
const RUNTIME_KINDS = new Set(['shader', 'particles', 'scene', 'layered']);
const LAYER_KINDS = new Set(['image', 'video', 'audio', 'particle', 'voxel', 'shader', 'solid', 'group']);
const PLAYBACK_MODES = new Set(['loop', 'mirror', 'once']);
const INTERPOLATIONS = new Set(['linear', 'step', 'smoothstep', 'cubic']);
const CONTROL_TYPES = new Set(['number', 'boolean', 'color', 'select', 'text']);

export class AmbientProjectV2Error extends Error {
    constructor(code, path, message, details = null) {
        super(`${path}: ${message}`);
        this.name = 'AmbientProjectV2Error';
        this.code = code;
        this.path = path;
        this.details = details;
    }
}

export function createAmbientProjectV2(init = {}, {
    now = ISO_EPOCH,
    idFactory = null,
} = {}) {
    const createdAt = normalizeTimestamp(now, ISO_EPOCH);
    const suppliedId = String(init?.projectId ?? init?.metadata?.id ?? '').trim().toLowerCase();
    const generatedId = suppliedId || normalizeGeneratedProjectId(idFactory?.()) || 'untitled-wallpaper';
    return normalizeAmbientProjectV2({
        ...dataObject(init),
        schema: AMBIENT_PROJECT_V2_SCHEMA,
        version: AMBIENT_PROJECT_V2_VERSION,
        projectId: generatedId,
        revision: init?.revision ?? 0,
        contentHash: init?.contentHash ?? null,
        audit: {
            createdAt,
            updatedAt: createdAt,
            ...dataObject(init?.audit),
        },
    });
}

export function normalizeAmbientProjectV2(value = {}) {
    const source = dataObject(value);
    const assets = boundedArray(source.assets, AMBIENT_PROJECT_V2_LIMITS.assets)
        .map((asset, index) => normalizeAmbientAssetV2(asset, index))
        .sort((left, right) => left.id.localeCompare(right.id));
    const layers = boundedArray(source.layers, AMBIENT_PROJECT_V2_LIMITS.layers)
        .map((layer, index) => normalizeAmbientLayerV2(layer, index))
        .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    const controls = boundedArray(source.publishedControls, AMBIENT_PROJECT_V2_LIMITS.publishedControls)
        .map((control, index) => normalizeAmbientPublishedControlV2(control, index))
        .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    const metadata = dataObject(source.metadata);
    const audit = dataObject(source.audit);
    const canvas = dataObject(source.canvas);
    const runtime = dataObject(source.runtime);
    const quality = dataObject(source.quality);
    const accessibility = dataObject(source.accessibility);
    const staticFallback = dataObject(accessibility.staticFallback);
    const project = {
        schema: AMBIENT_PROJECT_V2_SCHEMA,
        version: AMBIENT_PROJECT_V2_VERSION,
        projectId: projectId(source.projectId ?? metadata.id, 'untitled-wallpaper'),
        revision: integer(source.revision, 0, 0, Number.MAX_SAFE_INTEGER),
        contentHash: HASH_PATTERN.test(String(source.contentHash ?? '').toLowerCase())
            ? String(source.contentHash).toLowerCase()
            : null,
        metadata: {
            name: text(metadata.name, 'Untitled Wallpaper', 120),
            description: text(metadata.description, '', 4000),
            author: text(metadata.author, '', 160),
            tags: uniqueStrings(metadata.tags, 64, 80),
            thumbnailAssetId: nullableRecordId(metadata.thumbnailAssetId),
        },
        audit: {
            createdAt: normalizeTimestamp(audit.createdAt, ISO_EPOCH),
            updatedAt: normalizeTimestamp(audit.updatedAt, normalizeTimestamp(audit.createdAt, ISO_EPOCH)),
        },
        canvas: {
            width: integer(canvas.width, 1920, 1, 16384),
            height: integer(canvas.height, 1080, 1, 16384),
            aspectMode: enumValue(canvas.aspectMode, new Set(['fixed', 'display', 'cover', 'contain']), 'display'),
            backgroundColor: color(canvas.backgroundColor, '#070b16'),
        },
        runtime: {
            kind: enumValue(runtime.kind, RUNTIME_KINDS, 'layered'),
            entryNodeId: nullableRecordId(runtime.entryNodeId),
            settings: normalizeJsonValue(runtime.settings ?? {}, '$.runtime.settings'),
        },
        assets,
        layers,
        graph: normalizeAmbientGraphV2(source.graph),
        timeline: normalizeAmbientTimelineV2(source.timeline),
        publishedControls: controls,
        quality: {
            targetFps: integer(quality.targetFps, 60, 1, 240),
            renderScale: number(quality.renderScale, 1, 0.1, 4),
            maxPixelCount: integer(quality.maxPixelCount, 8_294_400, 65_536, 268_435_456),
        },
        accessibility: {
            reducedMotion: Boolean(accessibility.reducedMotion),
            reducedTransparency: Boolean(accessibility.reducedTransparency),
            staticFallback: {
                color: color(staticFallback.color ?? staticFallback.backgroundColor, '#070b16'),
                assetId: nullableRecordId(staticFallback.assetId),
            },
        },
        extensions: normalizeJsonValue(source.extensions ?? {}, '$.extensions'),
    };
    return deepFreeze(project);
}

/** Apply one authoring mutation and invalidate any seal from prior content. */
export function editAmbientProjectV2(value, mutator) {
    if (typeof mutator !== 'function') throw new TypeError('Ambient V2 edit requires a mutation function');
    const normalized = normalizeAmbientProjectV2(value);
    const draft = typeof structuredClone === 'function'
        ? structuredClone(normalized)
        : JSON.parse(JSON.stringify(normalized));
    const returned = mutator(draft);
    const candidate = returned && typeof returned === 'object' ? returned : draft;
    candidate.contentHash = null;
    return normalizeAmbientProjectV2(candidate);
}

export function normalizeAmbientAssetV2(value = {}, index = 0) {
    const source = dataObject(value);
    const sha256 = HASH_PATTERN.test(String(source.sha256 ?? '').toLowerCase())
        ? String(source.sha256).toLowerCase()
        : '';
    const mediaType = text(source.mediaType, 'application/octet-stream', 160).toLowerCase();
    const extension = safeExtension(source.path ?? source.name, mediaType);
    const defaultPath = sha256 ? `assets/${sha256.slice(7)}.${extension}` : '';
    const dimensions = dataObject(source.dimensions);
    return deepFreeze({
        id: recordId(source.id, `asset-${index + 1}`),
        name: text(source.name, `Asset ${index + 1}`, 255),
        kind: enumValue(source.kind, new Set(['image', 'video', 'audio', 'voxel', 'binary']), 'binary'),
        mediaType,
        byteLength: integer(source.byteLength, 0, 0, 256 * 1024 * 1024),
        sha256,
        path: archiveRelativePath(source.path, defaultPath),
        dimensions: {
            width: nullableInteger(dimensions.width, 1, 65536),
            height: nullableInteger(dimensions.height, 1, 65536),
            depth: nullableInteger(dimensions.depth, 1, 4096),
            durationSeconds: nullableNumber(dimensions.durationSeconds, 0, 86400),
        },
        metadata: normalizeJsonValue(source.metadata ?? {}, `$.assets[${index}].metadata`),
    });
}

export function normalizeAmbientLayerV2(value = {}, index = 0) {
    const source = dataObject(value);
    const transform = dataObject(source.transform);
    return deepFreeze({
        id: recordId(source.id, `layer-${index + 1}`),
        name: text(source.name, `Layer ${index + 1}`, 160),
        kind: enumValue(source.kind, LAYER_KINDS, 'group'),
        parentId: nullableRecordId(source.parentId),
        assetId: nullableRecordId(source.assetId),
        graphNodeId: nullableRecordId(source.graphNodeId),
        order: integer(source.order, index, -1_000_000, 1_000_000),
        visible: source.visible !== false,
        opacity: number(source.opacity, 1, 0, 1),
        blendMode: enumValue(source.blendMode, new Set(['normal', 'add', 'multiply', 'screen', 'overlay']), 'normal'),
        transform: {
            position: vector(transform.position, 3, [0, 0, 0], -1_000_000, 1_000_000),
            rotation: vector(transform.rotation, 3, [0, 0, 0], -360_000, 360_000),
            scale: vector(transform.scale, 3, [1, 1, 1], -10_000, 10_000),
            anchor: vector(transform.anchor, 2, [0.5, 0.5], -10_000, 10_000),
        },
        properties: normalizeJsonValue(source.properties ?? {}, `$.layers[${index}].properties`),
    });
}

export function normalizeAmbientGraphV2(value = {}) {
    const source = dataObject(value);
    const nodes = boundedArray(source.nodes, AMBIENT_PROJECT_V2_LIMITS.graphNodes)
        .map((node, index) => {
            const candidate = dataObject(node);
            const position = dataObject(candidate.position);
            return {
                id: recordId(candidate.id, `node-${index + 1}`),
                type: recordId(candidate.type, 'unknown'),
                position: {
                    x: number(position.x ?? candidate.x, 0, -1_000_000, 1_000_000),
                    y: number(position.y ?? candidate.y, 0, -1_000_000, 1_000_000),
                },
                params: normalizeJsonValue(candidate.params ?? {}, `$.graph.nodes[${index}].params`),
            };
        })
        .sort((left, right) => left.id.localeCompare(right.id));
    const connections = boundedArray(source.connections ?? source.edges, AMBIENT_PROJECT_V2_LIMITS.graphConnections)
        .map((connection, index) => {
            const candidate = dataObject(connection);
            const from = dataObject(candidate.from);
            const to = dataObject(candidate.to);
            return {
                id: recordId(candidate.id, `connection-${index + 1}`),
                from: {
                    nodeId: recordId(from.nodeId ?? candidate.fromNodeId, 'missing-node'),
                    portId: recordId(from.portId ?? candidate.fromPortId, 'output'),
                },
                to: {
                    nodeId: recordId(to.nodeId ?? candidate.toNodeId, 'missing-node'),
                    portId: recordId(to.portId ?? candidate.toPortId, 'input'),
                },
            };
        })
        .sort((left, right) => left.id.localeCompare(right.id));
    return deepFreeze({ nodes, connections });
}

export function normalizeAmbientTimelineV2(value = {}) {
    const source = dataObject(value);
    const durationSeconds = number(source.durationSeconds, 12, 0.01, 86_400);
    let keyframeCount = 0;
    const tracks = boundedArray(source.tracks, AMBIENT_PROJECT_V2_LIMITS.timelineTracks)
        .map((track, trackIndex) => {
            const candidate = dataObject(track);
            const target = normalizeTarget(candidate.target);
            const keyframes = boundedArray(candidate.keyframes, AMBIENT_PROJECT_V2_LIMITS.keyframes)
                .map((keyframe, keyframeIndex) => {
                    keyframeCount += 1;
                    if (keyframeCount > AMBIENT_PROJECT_V2_LIMITS.keyframes) {
                        throw new AmbientProjectV2Error('TOO_MANY_KEYFRAMES', '$.timeline.tracks', `exceeds ${AMBIENT_PROJECT_V2_LIMITS.keyframes} keyframes`);
                    }
                    const item = dataObject(keyframe);
                    return {
                        id: recordId(item.id, `keyframe-${trackIndex + 1}-${keyframeIndex + 1}`),
                        timeSeconds: number(item.timeSeconds, 0, 0, durationSeconds),
                        value: normalizeJsonValue(item.value ?? 0, `$.timeline.tracks[${trackIndex}].keyframes[${keyframeIndex}].value`),
                    };
                })
                .sort((left, right) => left.timeSeconds - right.timeSeconds || left.id.localeCompare(right.id));
            return {
                id: recordId(candidate.id, `track-${trackIndex + 1}`),
                target,
                interpolation: enumValue(candidate.interpolation, INTERPOLATIONS, 'linear'),
                keyframes,
            };
        })
        .sort((left, right) => left.id.localeCompare(right.id));
    return deepFreeze({
        durationSeconds,
        playbackMode: source.loop === false
            ? 'once'
            : enumValue(source.playbackMode, PLAYBACK_MODES, 'loop'),
        framesPerSecond: integer(source.framesPerSecond, 60, 1, 240),
        tracks,
    });
}

export function normalizeAmbientPublishedControlV2(value = {}, index = 0) {
    const source = dataObject(value);
    const options = boundedArray(source.options, 256).map((option, optionIndex) => {
        const candidate = dataObject(option);
        return {
            value: normalizeJsonValue(candidate.value ?? optionIndex, `$.publishedControls[${index}].options[${optionIndex}].value`),
            label: text(candidate.label, `Option ${optionIndex + 1}`, 120),
        };
    });
    return deepFreeze({
        id: recordId(source.id, `control-${index + 1}`),
        label: text(source.label, `Control ${index + 1}`, 120),
        description: text(source.description, '', 500),
        type: enumValue(source.type, CONTROL_TYPES, 'number'),
        target: normalizeTarget(source.target),
        defaultValue: normalizeJsonValue(source.defaultValue ?? 0, `$.publishedControls[${index}].defaultValue`),
        min: nullableNumber(source.min, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
        max: nullableNumber(source.max, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
        step: nullableNumber(source.step, 0, Number.MAX_SAFE_INTEGER),
        options,
        group: text(source.group, 'General', 120),
        order: integer(source.order, index, -1_000_000, 1_000_000),
    });
}

export function validateAmbientProjectV2(value, { requireCanonical = true, requireHash = false } = {}) {
    const errors = [];
    let project;
    try { project = normalizeAmbientProjectV2(value); }
    catch (error) {
        const item = error instanceof AmbientProjectV2Error
            ? error
            : new AmbientProjectV2Error('NORMALIZATION_FAILED', '$', error?.message ?? String(error));
        return deepFreeze({ ok: false, errors: [issueFromError(item)], project: null });
    }
    const add = (code, path, message) => errors.push({ code, path, message });
    if (value?.schema !== AMBIENT_PROJECT_V2_SCHEMA) add('SCHEMA', '$.schema', `must equal ${AMBIENT_PROJECT_V2_SCHEMA}`);
    if (value?.version !== AMBIENT_PROJECT_V2_VERSION) add('VERSION', '$.version', `must equal ${AMBIENT_PROJECT_V2_VERSION}`);
    if (!PROJECT_ID_PATTERN.test(project.projectId)) add('PROJECT_ID', '$.projectId', 'must be a bounded path-safe identifier');
    if (requireHash && !HASH_PATTERN.test(project.contentHash ?? '')) add('CONTENT_HASH', '$.contentHash', 'must contain a canonical SHA-256 hash');
    if (project.contentHash !== null && !HASH_PATTERN.test(project.contentHash)) add('CONTENT_HASH', '$.contentHash', 'must be null or a canonical SHA-256 hash');
    validateUnique(project.assets, '$.assets', add);
    validateUnique(project.layers, '$.layers', add);
    validateUnique(project.graph.nodes, '$.graph.nodes', add);
    validateUnique(project.graph.connections, '$.graph.connections', add);
    validateUnique(project.timeline.tracks, '$.timeline.tracks', add);
    validateUnique(project.publishedControls, '$.publishedControls', add);
    const assetIds = new Set(project.assets.map(asset => asset.id));
    const nodeIds = new Set(project.graph.nodes.map(node => node.id));
    const layerIds = new Set(project.layers.map(layer => layer.id));
    for (const [index, asset] of project.assets.entries()) {
        if (!HASH_PATTERN.test(asset.sha256)) add('ASSET_HASH', `$.assets[${index}].sha256`, 'must be a canonical SHA-256 hash');
        const pathMatch = ASSET_PATH_PATTERN.exec(asset.path);
        if (!pathMatch || `sha256:${pathMatch?.[1]}` !== asset.sha256) add('ASSET_PATH', `$.assets[${index}].path`, 'must be content-addressed under assets/');
        if (FORBIDDEN_ASSET_MEDIA.test(asset.mediaType)) add('ASSET_MEDIA', `$.assets[${index}].mediaType`, 'HTML, JavaScript, and SVG assets are forbidden');
    }
    for (const [index, layer] of project.layers.entries()) {
        if (layer.assetId && !assetIds.has(layer.assetId)) add('LAYER_ASSET', `$.layers[${index}].assetId`, `unknown asset '${layer.assetId}'`);
        if (layer.parentId && (!layerIds.has(layer.parentId) || layer.parentId === layer.id)) add('LAYER_PARENT', `$.layers[${index}].parentId`, 'must reference another layer');
        if (layer.graphNodeId && !nodeIds.has(layer.graphNodeId)) add('LAYER_NODE', `$.layers[${index}].graphNodeId`, `unknown node '${layer.graphNodeId}'`);
    }
    for (const [index, connection] of project.graph.connections.entries()) {
        if (!nodeIds.has(connection.from.nodeId)) add('CONNECTION_FROM', `$.graph.connections[${index}].from.nodeId`, `unknown node '${connection.from.nodeId}'`);
        if (!nodeIds.has(connection.to.nodeId)) add('CONNECTION_TO', `$.graph.connections[${index}].to.nodeId`, `unknown node '${connection.to.nodeId}'`);
    }
    if (project.runtime.entryNodeId && !nodeIds.has(project.runtime.entryNodeId)) add('RUNTIME_ENTRY', '$.runtime.entryNodeId', `unknown node '${project.runtime.entryNodeId}'`);
    if (project.metadata.thumbnailAssetId && !assetIds.has(project.metadata.thumbnailAssetId)) add('THUMBNAIL_ASSET', '$.metadata.thumbnailAssetId', 'must reference an asset');
    if (project.accessibility.staticFallback.assetId && !assetIds.has(project.accessibility.staticFallback.assetId)) add('FALLBACK_ASSET', '$.accessibility.staticFallback.assetId', 'must reference an asset');
    for (const [trackIndex, track] of project.timeline.tracks.entries()) {
        validateTarget(track.target, `$.timeline.tracks[${trackIndex}].target`, { assetIds, nodeIds, layerIds }, add);
        validateUnique(track.keyframes, `$.timeline.tracks[${trackIndex}].keyframes`, add);
    }
    for (const [index, control] of project.publishedControls.entries()) {
        validateTarget(control.target, `$.publishedControls[${index}].target`, { assetIds, nodeIds, layerIds }, add);
        if (control.type === 'select' && !control.options.length) add('CONTROL_OPTIONS', `$.publishedControls[${index}].options`, 'select controls require options');
        if (control.min !== null && control.max !== null && control.min > control.max) add('CONTROL_RANGE', `$.publishedControls[${index}]`, 'min cannot exceed max');
    }
    const canonical = canonicalJson(project);
    const byteLength = new TextEncoder().encode(canonical).byteLength;
    if (byteLength > AMBIENT_PROJECT_V2_LIMITS.jsonBytes) add('PROJECT_TOO_LARGE', '$', `canonical project exceeds ${AMBIENT_PROJECT_V2_LIMITS.jsonBytes} bytes`);
    if (requireCanonical) {
        try {
            if (canonicalJson(value) !== canonical) add('NON_CANONICAL_PROJECT', '$', 'must use the normalized V2 representation');
        } catch (error) {
            add('NON_CANONICAL_PROJECT', '$', error?.message ?? 'contains non-data values');
        }
    }
    return deepFreeze({ ok: errors.length === 0, errors, project: errors.length ? null : project });
}

export function canonicalizeAmbientProjectV2(value, { space = 0 } = {}) {
    const project = normalizeAmbientProjectV2(value);
    if (!space) return canonicalJson(project);
    return JSON.stringify(JSON.parse(canonicalJson(project)), null, Math.max(0, Math.min(8, Math.floor(space))));
}

export async function computeAmbientProjectV2ContentHash(value, options = {}) {
    const project = normalizeAmbientProjectV2(value);
    const projection = contentProjection(project);
    return hashBytes(new TextEncoder().encode(canonicalJson(projection)), options);
}

export async function sealAmbientProjectV2(value, options = {}) {
    const normalized = normalizeAmbientProjectV2(value);
    const contentHash = await computeAmbientProjectV2ContentHash(normalized, options);
    const sealed = normalizeAmbientProjectV2({ ...normalized, contentHash });
    const validation = validateAmbientProjectV2(sealed, { requireCanonical: true, requireHash: true });
    if (!validation.ok) throw validationError(validation);
    return sealed;
}

export async function verifyAmbientProjectV2ContentHash(value, options = {}) {
    const project = normalizeAmbientProjectV2(value);
    if (!HASH_PATTERN.test(project.contentHash ?? '')) return false;
    return project.contentHash === await computeAmbientProjectV2ContentHash(project, options);
}

export function migrateLegacyAmbientProjectV2(value, {
    projectId: nextProjectId = null,
    now = ISO_EPOCH,
    sourcePath = null,
    sourceHash = null,
} = {}) {
    const legacy = normalizeJsonValue(value, '$.legacyProject');
    const metadata = dataObject(value?.metadata);
    const inferredId = nextProjectId ?? metadata.id ?? value?.projectId ?? value?.id ?? 'migrated-wallpaper';
    const kindText = String(value?.kind ?? value?.runtime?.kind ?? value?.schema ?? '').toLowerCase();
    const kind = kindText.includes('particle') ? 'particles' : kindText.includes('scene') || kindText.includes('voxel') ? 'scene' : 'shader';
    const graphSource = value?.graph ?? value?.scene?.graph ?? {};
    const migrated = createAmbientProjectV2({
        projectId: inferredId,
        revision: Math.max(0, Number(value?.revision) || 0),
        metadata: {
            name: metadata.name ?? value?.name ?? 'Migrated Wallpaper',
            description: metadata.description ?? '',
            author: metadata.author ?? '',
            tags: [...(Array.isArray(metadata.tags) ? metadata.tags : []), 'legacy-import'],
        },
        runtime: { kind },
        graph: graphSource,
        timeline: value?.timeline ?? {},
        quality: value?.quality ?? {},
        accessibility: value?.accessibility ?? {},
        extensions: {
            legacyProject: legacy,
            migrationSource: {
                path: sourcePath == null ? null : String(sourcePath),
                sha256: HASH_PATTERN.test(String(sourceHash ?? '')) ? String(sourceHash) : null,
                schema: value?.schema == null ? null : String(value.schema),
            },
        },
    }, { now });
    return migrated;
}

function contentProjection(project) {
    // Revision counters and audit timestamps describe persistence history rather
    // than authored wallpaper content, so they cannot perturb content identity.
    const { contentHash: _contentHash, revision: _revision, audit: _audit, ...content } = project;
    return content;
}

async function hashBytes(bytes, { cryptoApi = globalThis.crypto, hashBytes: hook = null } = {}) {
    if (typeof hook === 'function') {
        const result = String(await hook(bytes));
        const normalized = result.startsWith('sha256:') ? result.toLowerCase() : `sha256:${result.toLowerCase()}`;
        if (!HASH_PATTERN.test(normalized)) throw new AmbientProjectV2Error('HASH_FAILURE', '$', 'hashBytes returned an invalid SHA-256 value');
        return normalized;
    }
    if (cryptoApi?.subtle?.digest) {
        const digest = new Uint8Array(await cryptoApi.subtle.digest('SHA-256', bytes));
        return `sha256:${hex(digest)}`;
    }
    const hash = new IncrementalSha256();
    hash.update(bytes);
    return `sha256:${hash.hex()}`;
}

function normalizeTarget(value) {
    const source = dataObject(value);
    const legacyKind = String(source.kind ?? '').toLowerCase();
    const kind = enumValue(legacyKind, new Set(['project', 'layer', 'node', 'asset']), legacyKind === 'node-param' ? 'node' : 'project');
    const id = source.id ?? source.nodeId ?? source.layerId ?? source.assetId ?? null;
    const property = source.property ?? source.paramId ?? source.name ?? '';
    return {
        kind,
        id: kind === 'project' ? null : nullableRecordId(id),
        property: text(property, '', 240),
    };
}

function validateTarget(target, path, refs, add) {
    if (!target.property) add('TARGET_PROPERTY', `${path}.property`, 'must name a property');
    if (target.kind === 'node' && !refs.nodeIds.has(target.id)) add('TARGET_NODE', `${path}.id`, `unknown node '${target.id}'`);
    if (target.kind === 'layer' && !refs.layerIds.has(target.id)) add('TARGET_LAYER', `${path}.id`, `unknown layer '${target.id}'`);
    if (target.kind === 'asset' && !refs.assetIds.has(target.id)) add('TARGET_ASSET', `${path}.id`, `unknown asset '${target.id}'`);
}

function validateUnique(records, path, add) {
    const seen = new Set();
    for (const [index, record] of records.entries()) {
        if (!RECORD_ID_PATTERN.test(record.id)) add('RECORD_ID', `${path}[${index}].id`, 'must be a bounded identifier');
        if (seen.has(record.id)) add('DUPLICATE_ID', `${path}[${index}].id`, `duplicates '${record.id}'`);
        seen.add(record.id);
    }
}

function validationError(validation) {
    const first = validation.errors?.[0] ?? { code: 'INVALID_PROJECT', path: '$', message: 'Ambient project is invalid' };
    return new AmbientProjectV2Error(first.code, first.path, first.message, { errors: validation.errors });
}

function issueFromError(error) {
    return { code: error.code, path: error.path, message: error.message.replace(`${error.path}: `, '') };
}

function normalizeJsonValue(value, path, depth = 0) {
    if (depth > AMBIENT_PROJECT_V2_LIMITS.extensionDepth) throw new AmbientProjectV2Error('JSON_DEPTH', path, 'data nesting is too deep');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new AmbientProjectV2Error('INVALID_NUMBER', path, 'non-finite numbers are forbidden');
        return Object.is(value, -0) ? 0 : value;
    }
    if (Array.isArray(value)) return value.map((item, index) => normalizeJsonValue(item, `${path}[${index}]`, depth + 1));
    if (!isPlainObject(value)) throw new AmbientProjectV2Error('INVALID_DATA', path, 'must contain JSON data only');
    const result = {};
    for (const key of Object.keys(value).sort()) {
        if (value[key] === undefined) continue;
        result[key] = normalizeJsonValue(value[key], `${path}.${key}`, depth + 1);
    }
    return result;
}

function canonicalJson(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new AmbientProjectV2Error('INVALID_NUMBER', '$', 'canonical JSON forbids non-finite numbers');
        return JSON.stringify(Object.is(value, -0) ? 0 : value);
    }
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (!isPlainObject(value)) throw new AmbientProjectV2Error('INVALID_DATA', '$', 'canonical JSON accepts only plain data objects');
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function dataObject(value) { return isPlainObject(value) ? value : {}; }
function isPlainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function boundedArray(value, limit) { return Array.isArray(value) ? value.slice(0, limit + 1) : []; }
function text(value, fallback, max) { const result = String(value ?? '').trim(); return (result || fallback).slice(0, max); }
function projectId(value, fallback) { const result = String(value ?? '').trim().toLowerCase(); return PROJECT_ID_PATTERN.test(result) ? result : fallback; }
function recordId(value, fallback) { const result = String(value ?? '').trim(); return RECORD_ID_PATTERN.test(result) ? result : fallback; }
function nullableRecordId(value) { if (value == null || value === '') return null; const result = String(value).trim(); return RECORD_ID_PATTERN.test(result) ? result : null; }
function number(value, fallback, min, max) { const result = Number(value); return Number.isFinite(result) ? Math.max(min, Math.min(max, result)) : fallback; }
function integer(value, fallback, min, max) { return Math.floor(number(value, fallback, min, max)); }
function nullableNumber(value, min, max) { return value == null || value === '' ? null : number(value, null, min, max); }
function nullableInteger(value, min, max) { const result = nullableNumber(value, min, max); return result == null ? null : Math.floor(result); }
function enumValue(value, allowed, fallback) { const result = String(value ?? '').trim().toLowerCase(); return allowed.has(result) ? result : fallback; }
function color(value, fallback) { const result = String(value ?? '').trim().toLowerCase(); return /^#[a-f0-9]{6}(?:[a-f0-9]{2})?$/.test(result) ? result : fallback; }
function vector(value, length, fallback, min, max) { return Array.from({ length }, (_, index) => number(Array.isArray(value) ? value[index] : undefined, fallback[index], min, max)); }
function uniqueStrings(value, maxItems, maxLength) { return [...new Set((Array.isArray(value) ? value : []).map(item => String(item ?? '').trim()).filter(Boolean).map(item => item.slice(0, maxLength)))].slice(0, maxItems).sort(); }
function normalizeGeneratedProjectId(value) { const result = String(value ?? '').trim().toLowerCase(); return PROJECT_ID_PATTERN.test(result) ? result : ''; }
function normalizeTimestamp(value, fallback) { const date = new Date(value ?? fallback); return Number.isFinite(date.getTime()) ? date.toISOString() : fallback; }
function safeExtension(value, mediaType) {
    const match = String(value ?? '').toLowerCase().match(/\.([a-z0-9]{1,12})$/);
    if (match && !/^(?:html?|m?js|cjs|jsx|tsx?|svgz?)$/.test(match[1])) return match[1];
    const known = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav' };
    return known[mediaType] ?? 'bin';
}
function archiveRelativePath(value, fallback) { const result = String(value ?? '').trim().replace(/\\/g, '/'); return result || fallback; }
function hex(bytes) { return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
function deepFreeze(value, seen = new WeakSet()) { if (!value || typeof value !== 'object' || seen.has(value)) return value; seen.add(value); for (const child of Object.values(value)) deepFreeze(child, seen); return Object.freeze(value); }
