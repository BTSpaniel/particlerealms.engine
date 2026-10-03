// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { ambientRuntimeV3PlanHash, canonicalAmbientRuntimeV3Json } from './AmbientRuntimeV3Contract.js';
import { normalizeSpatial, spatialDefaults } from '../../factory/apps/ambient-studio/spatial/SpatialCore.js';
import { normalizeAmbientAssetV2 } from '../../factory/apps/ambient-studio/AmbientProjectV2.js';
import { normalizeSpatialGeometryScene } from '../../factory/apps/ambient-studio/spatial/SpatialDioramaSchema.js';
import { normalizeAmbientReaction } from '../../factory/apps/ambient-studio/AmbientReactionGraph.js';
import { validateSpatialCloudHierarchy } from '../../factory/apps/ambient-studio/spatial/SpatialCloudHierarchy.js';
import { normalizeSpatialStreamingPolicy, spatialCloudReservation } from '../../factory/apps/ambient-studio/spatial/SpatialCloudStreaming.js';

export const AMBIENT_SPATIAL_PLAN_SCHEMA = 'particle-realms.ambient-spatial-plan.v1';
export const AMBIENT_SPATIAL_ABI = 'particle-realms.ambient-spatial.v1';
export const AMBIENT_SPATIAL_ID = 'ambient-spatial';
export const AMBIENT_SPATIAL_TYPE = 'webgpu-spatial';
export const AMBIENT_SPATIAL_SOURCE_ASSET_KEYS = Object.freeze(['mediaAssetId', 'depthAssetId', 'confidenceAssetId', 'maskAssetId', 'cloudAssetId']);
const HASH = /^sha256:[a-f0-9]{64}$/;
const COLOR = /^#[a-f0-9]{6}$/i;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

export function normalizeAmbientSpatialSource(value = {}) {
    if (!['procedural', 'image', 'video', 'cloud'].includes(value.kind ?? 'procedural')) throw new TypeError('Unknown spatial source kind');
    const result = { kind: value.kind ?? 'procedural', seed: Math.max(0, Math.min(4294967295, Math.trunc(Number.isFinite(value.seed) ? value.seed : 1))) };
    for (const key of AMBIENT_SPATIAL_SOURCE_ASSET_KEYS) {
        if (value[key] != null && !ID.test(value[key])) throw new TypeError(`Invalid spatial ${key}`);
        result[key] = value[key] ?? null;
    }
    // Optional, never inserted into legacy plans: old receipts remain exact.
    if (value.scene !== undefined) result.scene = normalizeSpatialGeometryScene(value.scene);
    if (value.hierarchy !== undefined) result.hierarchy = value.hierarchy === null ? null : validateSpatialCloudHierarchy(value.hierarchy);
    if (value.streaming !== undefined) result.streaming = value.streaming === null ? null : normalizeSpatialStreamingPolicy(value.streaming);
    if ((result.hierarchy || result.streaming) && result.kind !== 'cloud') throw new TypeError('Progressive detail requires a Gaussian cloud source.');
    if (result.streaming?.enabled && !result.hierarchy) throw new TypeError('Build a cloud hierarchy before enabling progressive detail.');
    if (value.captureAssetId !== undefined) {
        if (value.captureAssetId !== null && !ID.test(value.captureAssetId)) throw new TypeError('Invalid retained capture asset ID.');
        result.captureAssetId = value.captureAssetId;
    }
    if (value.projection !== undefined) {
        if (value.projection !== null && !['perspective', 'equirectangular', 'cubemap-atlas'].includes(value.projection)) throw new TypeError('Unknown spatial media projection.');
        if (value.projection !== null && !['image', 'video'].includes(result.kind)) throw new TypeError('Media projection requires an image or video source.');
        result.projection = value.projection;
    }
    return result;
}

/** Immutable, content-bound, data-only plan shared by Studio, Desktop and player. */
export function createAmbientSpatialPlan(value = {}) {
    const spatial = normalizeSpatial(value.spatial ?? spatialDefaults());
    const source = normalizeAmbientSpatialSource(value.source);
    const runtime = value.settings ?? {};
    const assets = (value.assets ?? []).map(normalizeAmbientAssetV2).sort((a, b) => a.id.localeCompare(b.id));
    const plan = {
        schema: AMBIENT_SPATIAL_PLAN_SCHEMA, version: 1, runtimeAbi: AMBIENT_SPATIAL_ABI,
        projectId: String(value.projectId ?? 'spatial-wallpaper'), revision: integer(value.revision, 0, 0, Number.MAX_SAFE_INTEGER),
        contentHash: null, source, assets, spatial,
        ...(value.reaction === undefined ? {} : { reaction: normalizeAmbientReaction(value.reaction) }),
        settings: {
            targetFps: integer(runtime.targetFps, 30, 1, 60), maxDpr: number(runtime.maxDpr, 2, .5, 4),
            maxPixelCount: integer(runtime.maxPixelCount, 8_294_400, 4, 67_108_864),
            interactive: runtime.interactive !== false,
            clearColor: COLOR.test(runtime.clearColor) ? runtime.clearColor.toLowerCase() : '#08131e',
            speed: 1, intensity: 1, exposure: 0, saturation: 1, pointerInfluence: 1, activityInfluence: 0,
        },
        accessibility: { reducedMotion: value.accessibility?.reducedMotion === true, staticFallback: { type: 'css', color: COLOR.test(value.accessibility?.staticFallback?.color) ? value.accessibility.staticFallback.color.toLowerCase() : '#08131e' } },
        metadata: { title: String(value.metadata?.title ?? 'Spatial wallpaper').slice(0, 120) },
    };
    assertData(plan);
    plan.contentHash = ambientRuntimeV3PlanHash(plan);
    return freeze(plan);
}

export function validateAmbientSpatialPlan(value) {
    try {
        if (value?.schema !== AMBIENT_SPATIAL_PLAN_SCHEMA || value?.version !== 1 || value?.runtimeAbi !== AMBIENT_SPATIAL_ABI) throw new TypeError('Unsupported spatial plan contract');
        assertData(value);
        if (!HASH.test(value.contentHash) || ambientRuntimeV3PlanHash(value) !== value.contentHash) throw new TypeError('Spatial plan content hash does not match');
        const plan = createAmbientSpatialPlan(value);
        if (canonicalAmbientRuntimeV3Json(plan) !== canonicalAmbientRuntimeV3Json(value)) throw new TypeError('Spatial plan must use its canonical bounded form');
        return Object.freeze({ ok: true, plan, execution: Object.freeze({ runtimeId: AMBIENT_SPATIAL_ID, runtimeAbi: AMBIENT_SPATIAL_ABI, executionClass: 'spatial' }) });
    } catch (error) {
        return Object.freeze({ ok: false, code: 'AMBIENT_SPATIAL_PLAN_INVALID', message: String(error.message), errors: Object.freeze([String(error.message)]) });
    }
}

function assertData(plan) {
    if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(plan.projectId)) throw new TypeError('Invalid spatial project ID');
    if (plan.assets.length > 510) throw new TypeError('Too many spatial assets');
    const ids = new Set();
    for (const asset of plan.assets) {
        if (ids.has(asset.id) || !HASH.test(asset.sha256) || !new RegExp(`^assets/${asset.sha256.slice(7)}\\.[a-z0-9]{1,12}$`).test(asset.path)) throw new TypeError('Spatial asset must have a unique ID and content-addressed path');
        if (/javascript|ecmascript|html|svg/i.test(asset.mediaType)) throw new TypeError('Spatial assets cannot contain active web content');
        ids.add(asset.id);
    }
    for (const key of AMBIENT_SPATIAL_SOURCE_ASSET_KEYS) if (plan.source[key] && !ids.has(plan.source[key])) throw new TypeError(`Missing spatial asset ${plan.source[key]}`);
    if (plan.source.captureAssetId && !ids.has(plan.source.captureAssetId)) throw new TypeError('Missing retained capture asset.');
    for (const key of ['learnedPlate', 'completionMask', 'mediaAsset', 'depthAsset', 'maskAsset']) if (plan.spatial[key] && !ids.has(plan.spatial[key])) throw new TypeError(`Missing spatial asset ${plan.spatial[key]}`);
    if (['image', 'video'].includes(plan.source.kind) && !plan.source.mediaAssetId) throw new TypeError('Spatial media requires an asset');
    if (plan.source.projection && (plan.spatial.renderVersion !== 1 || plan.spatial.mediaProjection !== plan.source.projection)) throw new TypeError('Saved source and renderer projection must agree.');
    if (['equirectangular', 'cubemap-atlas'].includes(plan.spatial.mediaProjection)) {
        if (!['image', 'video'].includes(plan.source.kind) || plan.source.projection !== plan.spatial.mediaProjection || plan.spatial.cameraRig?.mode !== 'panorama' || plan.spatial.cameraRig?.source?.kind !== 'panorama') throw new TypeError('Panoramic media requires its saved projection and a rotation-only panorama camera.');
    } else if (plan.spatial.cameraRig?.mode === 'panorama') throw new TypeError('Panorama cameras require panoramic source projection.');
    if (plan.source.kind === 'cloud' && !plan.source.cloudAssetId && !plan.spatial.cloud) throw new TypeError('Spatial cloud requires Gaussian data');
    if (plan.source.hierarchy) {
        const hierarchy = validateSpatialCloudHierarchy(plan.source.hierarchy);
        for (const node of hierarchy.nodes) if (!ids.has(node.assetId)) throw new TypeError(`Missing progressive chunk asset ${node.assetId}`);
        if (!plan.source.cloudAssetId) throw new TypeError('Retain the full canonical cloud asset for progressive editing and export.');
        if (hierarchy.sourceSha256 !== plan.assets.find(asset => asset.id === plan.source.cloudAssetId)?.sha256) throw new TypeError('Progressive hierarchy does not match the retained canonical source hash.');
        if (plan.source.streaming?.enabled) {
            const policy = normalizeSpatialStreamingPolicy(plan.source.streaming), s = plan.spatial;
            if (s.sequence || s.depthCamera || plan.source.mediaAssetId || plan.source.depthAssetId || plan.source.confidenceAssetId || plan.source.maskAssetId || s.mediaAsset || s.depthField || s.maskAsset || s.learnedPlate || s.completionMask) throw new TypeError('Progressive detail supports static clouds without source-projected media or motion frames.');
            if (!s.cloudFrame || s.cloudFrame.mode !== 'metric') throw new TypeError('Progressive detail requires a saved metric cloud frame.');
            const root = hierarchy.nodes.find(node => node.id === hierarchy.rootId);
            if (root.count > Math.min(policy.maxPoints, s.count) || spatialCloudReservation(hierarchy, [hierarchy.rootId], plan.assets) * 2 > policy.maxResidentBytes) throw new TypeError('Progressive budget must fit the coarse root and a replacement reservation.');
        }
    }
    if (new TextEncoder().encode(canonicalAmbientRuntimeV3Json(plan)).byteLength > 8 * 1024 * 1024) throw new TypeError('Spatial plan exceeds 8 MiB');
}
function integer(v, fallback, min, max) { return Math.max(min, Math.min(max, Number.isSafeInteger(v) ? v : fallback)); }
function number(v, fallback, min, max) { return Math.max(min, Math.min(max, Number.isFinite(v) ? v : fallback)); }
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
