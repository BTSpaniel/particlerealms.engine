// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import {
    AMBIENT_PROGRAM_PLAN_SCHEMA,
    AMBIENT_PROGRAM_UNIFORM_BYTES,
    validateAmbientProgramSource,
} from './AmbientProgramContract.js';
import { validateParticleAmbientPlan } from './ParticleAmbientContract.js';
import { IncrementalSha256 } from '../../storage/IncrementalSha256.js';
import { normalizeAmbientAssetV2 } from '../../factory/apps/ambient-studio/AmbientProjectV2.js';
import { normalizeAmbientReaction } from '../../factory/apps/ambient-studio/AmbientReactionGraph.js';
import { normalizeSpatialSourceClip } from '../../factory/apps/ambient-studio/spatial/SpatialCore.js';

export const COMPOSITE_AMBIENT_PLAN_SCHEMA = 'particle-realms.ambient-composite-plan.v2';
export const COMPOSITE_AMBIENT_PLAN_VERSION = 2;
export const COMPOSITE_AMBIENT_RUNTIME_ABI = 'particle-realms.ambient-composite-runtime.v2';
export const COMPOSITE_AMBIENT_RECEIPT_SCHEMA = 'particle-realms.ambient-composite-receipt.v2';
export const COMPOSITE_AMBIENT_RUNTIME_ID = 'webgpu-os.kernel.ambient-composite';
export const COMPOSITE_AMBIENT_BUILD_ID = 'ambient-composite-v2.2026-09-22';

const MAX_PLAN_BYTES = 512 * 1024;
const MAX_LAYERS = 32;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/;
const ID_PATTERN = /^[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)*$/;
const MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;
const TOP_KEYS = Object.freeze([
    'schema', 'version', 'projectId', 'revision', 'contentHash', 'runtimeAbi',
    'settings', 'layers', 'output', 'accessibility',
]);
const SETTINGS_KEYS = Object.freeze(['clearColor', 'targetFps', 'maxDpr', 'maxPixelCount', 'interactive']);
const LAYER_KEYS = Object.freeze(['id', 'kind', 'active', 'opacity', 'blendMode', 'inputs', 'descriptor']);
const OUTPUT_KEYS = Object.freeze(['layerIds']);
const ACCESSIBILITY_KEYS = Object.freeze(['reducedMotion', 'staticFallback']);
const FALLBACK_KEYS = Object.freeze(['type', 'color']);
const ASSET_KEYS = Object.freeze(['assetId', 'contentHash', 'mimeType']);
const PLAN_REF_KEYS = Object.freeze(['schema', 'version', 'contentHash']);
const SUPPORTED_KINDS = Object.freeze(['procedural', 'image', 'video', 'particles', 'voxel', 'scene']);
const EXECUTABLE_KINDS = new Set(['procedural', 'image', 'video']);
const BLEND_MODES = new Set(['source-over', 'add']);

/** Create and hash a strict v2 composite plan from editor/compiler-owned fields. */
export function createCompositeAmbientPlan(source = {}) {
    if (!isPlainObject(source)) throw new TypeError('composite wallpaper source must be a plain object');
    const settings = cloneJson(source.settings);
    // Omit the default so existing persisted payloads keep their exact hashes.
    if (settings.motionPaused === false) delete settings.motionPaused;
    const plan = {
        schema: COMPOSITE_AMBIENT_PLAN_SCHEMA,
        version: COMPOSITE_AMBIENT_PLAN_VERSION,
        projectId: source.projectId,
        revision: source.revision,
        contentHash: '',
        runtimeAbi: COMPOSITE_AMBIENT_RUNTIME_ABI,
        settings,
        layers: cloneJson(source.layers),
        output: cloneJson(source.output),
        accessibility: cloneJson(source.accessibility),
        ...(source.reaction === undefined ? {} : { reaction: normalizeAmbientReaction(source.reaction) }),
    };
    plan.contentHash = compositeAmbientPlanHash(plan);
    const checked = validateCompositeAmbientPlan(plan);
    if (!checked.ok) throw typedError(checked.code, checked.message);
    return checked.plan;
}

/** Strictly validate the signed/persisted plan and resolve its executable graph. */
export function validateCompositeAmbientPlan(value) {
    try {
        assertPlainObject(value, 'plan');
        assertExactKeys(value, [...TOP_KEYS, ...(value.reaction === undefined ? [] : ['reaction'])], 'plan');
        if (value.reaction !== undefined && canonicalJson(normalizeAmbientReaction(value.reaction)) !== canonicalJson(value.reaction)) throw new TypeError('Reaction config must use its canonical bounded form.');
        const encoded = new TextEncoder().encode(JSON.stringify(value));
        if (encoded.byteLength > MAX_PLAN_BYTES) throw new RangeError('plan exceeds the 512 KiB limit');
        if (value.schema !== COMPOSITE_AMBIENT_PLAN_SCHEMA || value.version !== COMPOSITE_AMBIENT_PLAN_VERSION) {
            return failure('AMBIENT_COMPOSITE_PLAN_SCHEMA', 'Composite wallpaper plan schema or version is unsupported.');
        }
        if (value.runtimeAbi !== COMPOSITE_AMBIENT_RUNTIME_ABI) {
            return failure('AMBIENT_COMPOSITE_PLAN_ABI', 'Composite wallpaper runtime ABI is unsupported.');
        }
        assertId(value.projectId, 'plan.projectId');
        if (!Number.isSafeInteger(value.revision) || value.revision < 1) {
            throw new RangeError('plan.revision must be a positive safe integer');
        }
        assertSettings(value.settings);
        assertAccessibility(value.accessibility);
        assertPlainObject(value.output, 'plan.output');
        assertExactKeys(value.output, OUTPUT_KEYS, 'plan.output');
        if (!Array.isArray(value.layers) || value.layers.length < 1 || value.layers.length > MAX_LAYERS) {
            throw new RangeError(`plan.layers must contain 1 through ${MAX_LAYERS} layers`);
        }

        const ids = new Set();
        value.layers.forEach((layer, index) => {
            assertLayer(layer, index, ids);
            ids.add(layer.id);
        });
        if (!Array.isArray(value.output.layerIds) || value.output.layerIds.length < 1
            || value.output.layerIds.length > MAX_LAYERS) {
            throw new RangeError(`plan.output.layerIds must contain 1 through ${MAX_LAYERS} ids`);
        }
        const outputIds = new Set();
        for (const id of value.output.layerIds) {
            assertId(id, 'plan.output.layerIds[]');
            if (!ids.has(id)) throw new TypeError(`plan.output references unknown layer ${id}`);
            if (outputIds.has(id)) throw new TypeError(`plan.output repeats layer ${id}`);
            outputIds.add(id);
        }
        if (!HASH_PATTERN.test(String(value.contentHash ?? ''))) {
            return failure('AMBIENT_COMPOSITE_PLAN_HASH', 'Composite wallpaper contentHash is invalid.');
        }
        const expectedHash = compositeAmbientPlanHash(value);
        if (value.contentHash !== expectedHash) {
            return failure('AMBIENT_COMPOSITE_PLAN_HASH_MISMATCH', 'Composite wallpaper contentHash does not match its canonical payload.');
        }
        const plan = deepFreeze(cloneJson(value));
        return Object.freeze({
            ok: true,
            plan,
            execution: resolveCompositeAmbientExecution(plan),
            code: null,
            message: '',
        });
    } catch (error) {
        return failure('AMBIENT_COMPOSITE_PLAN_INVALID', error?.message ?? String(error));
    }
}

/** Resolve ordered reachability and truthful unsupported-layer diagnostics. */
export function resolveCompositeAmbientExecution(plan) {
    const byId = new Map(plan.layers.map(layer => [layer.id, layer]));
    const reachable = new Set();
    const visit = id => {
        if (reachable.has(id)) return;
        reachable.add(id);
        for (const input of byId.get(id)?.inputs ?? []) visit(input);
    };
    for (const id of plan.output.layerIds) visit(id);

    const activeReachableLayerIds = [];
    const executableLayerIds = [];
    const unsupportedLayerIds = [];
    const inactiveLayerIds = [];
    const unreachableLayerIds = [];
    const warnings = [];
    for (const layer of plan.layers) {
        if (!reachable.has(layer.id)) {
            unreachableLayerIds.push(layer.id);
            continue;
        }
        if (!layer.active) {
            inactiveLayerIds.push(layer.id);
            continue;
        }
        activeReachableLayerIds.push(layer.id);
        const mediaMissingDescriptor = ['image', 'video'].includes(layer.kind) && !layer.descriptor.asset.descriptor;
        if (EXECUTABLE_KINDS.has(layer.kind) && !mediaMissingDescriptor) executableLayerIds.push(layer.id);
        else {
            unsupportedLayerIds.push(layer.id);
            warnings.push(Object.freeze({
                code: 'AMBIENT_COMPOSITE_LAYER_UNSUPPORTED',
                layerId: layer.id,
                kind: layer.kind,
                message: mediaMissingDescriptor
                    ? `${layer.kind} layer ${layer.id} requires its project asset descriptor; reopen and save the project in Ambient Studio.`
                    : `${layer.kind} layer ${layer.id} is valid but is not executable by composite runtime v2.`,
            }));
        }
    }
    return deepFreeze({
        reachableLayerIds: plan.layers.filter(layer => reachable.has(layer.id)).map(layer => layer.id),
        activeReachableLayerIds,
        executableLayerIds,
        unsupportedLayerIds,
        inactiveLayerIds,
        unreachableLayerIds,
        warnings,
    });
}

/** Deterministic synchronous SHA-256 over every meaning-bearing plan field. */
export function compositeAmbientPlanHash(value) {
    const payload = cloneJson(value);
    delete payload.contentHash;
    const hasher = new IncrementalSha256();
    hasher.update(new TextEncoder().encode(canonicalJson(payload)));
    return `sha256:${hasher.hex()}`;
}

function assertLayer(layer, index, priorIds) {
    const label = `plan.layers[${index}]`;
    assertPlainObject(layer, label);
    assertExactKeys(layer, LAYER_KEYS, label);
    assertId(layer.id, `${label}.id`);
    if (priorIds.has(layer.id)) throw new TypeError(`${label}.id is duplicated`);
    if (!SUPPORTED_KINDS.includes(layer.kind)) throw new TypeError(`${label}.kind is unsupported`);
    if (typeof layer.active !== 'boolean') throw new TypeError(`${label}.active must be boolean`);
    if (!Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1) {
        throw new RangeError(`${label}.opacity must be from 0 through 1`);
    }
    if (!BLEND_MODES.has(layer.blendMode)) throw new TypeError(`${label}.blendMode is unsupported`);
    if (!Array.isArray(layer.inputs) || layer.inputs.length > MAX_LAYERS) {
        throw new TypeError(`${label}.inputs must be a bounded array`);
    }
    const inputs = new Set();
    for (const input of layer.inputs) {
        assertId(input, `${label}.inputs[]`);
        if (!priorIds.has(input)) throw new TypeError(`${label}.inputs must reference an earlier layer`);
        if (inputs.has(input)) throw new TypeError(`${label}.inputs repeats ${input}`);
        inputs.add(input);
    }
    assertDescriptor(layer.kind, layer.descriptor, `${label}.descriptor`);
}

function assertDescriptor(kind, descriptor, label) {
    assertPlainObject(descriptor, label);
    if (kind === 'procedural') {
        assertExactKeys(descriptor, ['program'], label);
        assertProgramPlan(descriptor.program, `${label}.program`);
        return;
    }
    if (kind === 'image') {
        assertExactKeys(descriptor, ['asset', 'fit', 'position', ...(descriptor.position === 'custom' ? ['focalX', 'focalY'] : [])], label);
        assertAsset(descriptor.asset, `${label}.asset`, 'image/');
        assertMediaFraming(descriptor, label);
        return;
    }
    if (kind === 'video') {
        const hasFraming = Object.hasOwn(descriptor, 'fit') || Object.hasOwn(descriptor, 'position');
        assertExactKeys(descriptor, ['asset', 'playback', ...(hasFraming ? ['fit', 'position'] : []), ...(descriptor.position === 'custom' ? ['focalX', 'focalY'] : [])], label);
        assertAsset(descriptor.asset, `${label}.asset`, 'video/');
        if (hasFraming) assertMediaFraming(descriptor, label);
        assertPlainObject(descriptor.playback, `${label}.playback`);
        assertExactKeys(descriptor.playback, ['loop', 'muted', 'playbackRate', ...(Object.hasOwn(descriptor.playback, 'clip') ? ['clip'] : [])], `${label}.playback`);
        if (Object.hasOwn(descriptor.playback, 'clip')) normalizeSpatialSourceClip(descriptor.playback.clip);
        if (typeof descriptor.playback.loop !== 'boolean' || descriptor.playback.muted !== true) {
            throw new TypeError(`${label}.playback requires boolean loop and muted=true`);
        }
        if (!Number.isFinite(descriptor.playback.playbackRate)
            || descriptor.playback.playbackRate < 0.25 || descriptor.playback.playbackRate > 4) {
            throw new RangeError(`${label}.playback.playbackRate must be from 0.25 through 4`);
        }
        return;
    }
    if (kind === 'particles') {
        assertExactKeys(descriptor, ['plan'], label);
        const checked = validateParticleAmbientPlan(descriptor.plan);
        if (!checked.ok) throw typedError(checked.code, `${label}.plan: ${checked.message}`);
        return;
    }
    assertExactKeys(descriptor, ['planRef'], label);
    assertPlainObject(descriptor.planRef, `${label}.planRef`);
    assertExactKeys(descriptor.planRef, PLAN_REF_KEYS, `${label}.planRef`);
    if (!ID_PATTERN.test(String(descriptor.planRef.schema ?? ''))) throw new TypeError(`${label}.planRef.schema is invalid`);
    if (!Number.isSafeInteger(descriptor.planRef.version) || descriptor.planRef.version < 1) {
        throw new RangeError(`${label}.planRef.version must be a positive safe integer`);
    }
    if (!HASH_PATTERN.test(String(descriptor.planRef.contentHash ?? ''))) {
        throw new TypeError(`${label}.planRef.contentHash is invalid`);
    }
}

function assertMediaFraming(descriptor, label) {
    if (!['cover', 'contain', 'fill'].includes(descriptor.fit)) throw new TypeError(`${label}.fit is unsupported`);
    if (!['center', 'top', 'bottom', 'left', 'right', 'custom'].includes(descriptor.position)) throw new TypeError(`${label}.position is unsupported`);
    if (descriptor.position === 'custom') for (const key of ['focalX', 'focalY']) {
        if (!Number.isFinite(descriptor[key]) || descriptor[key] < 0 || descriptor[key] > 1) throw new RangeError(`${label}.${key} must be from 0 through 1`);
    }
}

function assertProgramPlan(plan, label) {
    assertPlainObject(plan, label);
    if (plan.schema !== AMBIENT_PROGRAM_PLAN_SCHEMA || plan.version !== 1) {
        throw new TypeError(`${label} schema or version is unsupported`);
    }
    if (!ID_PATTERN.test(String(plan.projectId ?? '')) || !Number.isSafeInteger(plan.revision) || plan.revision < 1) {
        throw new TypeError(`${label} identity is invalid`);
    }
    if (!HASH_PATTERN.test(String(plan.contentHash ?? ''))) throw new TypeError(`${label}.contentHash is invalid`);
    if (plan.uniformContract?.byteLength !== AMBIENT_PROGRAM_UNIFORM_BYTES
        || plan.entryPoints?.vertex !== 'ambientVertex' || plan.entryPoints?.fragment !== 'ambientFragment') {
        throw new TypeError(`${label} runtime ABI is unsupported`);
    }
    const checked = validateAmbientProgramSource(plan.source ?? plan.sourceWGSL);
    if (!checked.ok) throw typedError(checked.code, `${label}: ${checked.message}`);
    if (typeof plan.source === 'string' && typeof plan.sourceWGSL === 'string' && plan.source !== plan.sourceWGSL) {
        throw new TypeError(`${label} source aliases disagree`);
    }
}

function assertAsset(asset, label, mediaPrefix) {
    assertPlainObject(asset, label);
    assertExactKeys(asset, asset.descriptor === undefined ? ASSET_KEYS : [...ASSET_KEYS, 'descriptor'], label);
    assertId(asset.assetId, `${label}.assetId`);
    if (!HASH_PATTERN.test(String(asset.contentHash ?? ''))) throw new TypeError(`${label}.contentHash is invalid`);
    if (!MIME_PATTERN.test(String(asset.mimeType ?? '')) || !asset.mimeType.startsWith(mediaPrefix)) {
        throw new TypeError(`${label}.mimeType must be ${mediaPrefix}*`);
    }
    if (asset.descriptor !== undefined) {
        const normalized = normalizeAmbientAssetV2(asset.descriptor);
        if (canonicalJson(normalized) !== canonicalJson(asset.descriptor) || normalized.sha256 !== asset.contentHash || normalized.mediaType !== asset.mimeType || !new RegExp(`^assets/${asset.contentHash.slice(7)}\\.[a-z0-9]{1,12}$`).test(normalized.path) || normalized.byteLength < 1) throw new TypeError(`${label}.descriptor must be a matching canonical content-addressed asset`);
        if (/html|javascript|ecmascript|svg/i.test(normalized.mediaType)) throw new TypeError(`${label}.descriptor cannot contain executable web content`);
    }
}

function assertSettings(value) {
    assertPlainObject(value, 'plan.settings');
    const hasMotionPaused = Object.hasOwn(value, 'motionPaused');
    assertExactKeys(value, hasMotionPaused ? [...SETTINGS_KEYS, 'motionPaused'] : SETTINGS_KEYS, 'plan.settings');
    if (hasMotionPaused && value.motionPaused !== true) throw new TypeError('plan.settings.motionPaused must be true when present');
    if (!COLOR_PATTERN.test(String(value.clearColor ?? ''))) throw new TypeError('plan.settings.clearColor must be #rrggbb');
    if (!Number.isSafeInteger(value.targetFps) || value.targetFps < 1 || value.targetFps > 60) {
        throw new RangeError('plan.settings.targetFps must be an integer from 1 through 60');
    }
    if (!Number.isFinite(value.maxDpr) || value.maxDpr < 0.5 || value.maxDpr > 4) {
        throw new RangeError('plan.settings.maxDpr must be from 0.5 through 4');
    }
    if (!Number.isSafeInteger(value.maxPixelCount) || value.maxPixelCount < 4 || value.maxPixelCount > 67_108_864) {
        throw new RangeError('plan.settings.maxPixelCount is outside the supported range');
    }
    if (typeof value.interactive !== 'boolean') throw new TypeError('plan.settings.interactive must be boolean');
}

function assertAccessibility(value) {
    assertPlainObject(value, 'plan.accessibility');
    assertExactKeys(value, ACCESSIBILITY_KEYS, 'plan.accessibility');
    if (value.reducedMotion !== 'pause') throw new TypeError('plan.accessibility.reducedMotion is unsupported');
    assertPlainObject(value.staticFallback, 'plan.accessibility.staticFallback');
    assertExactKeys(value.staticFallback, FALLBACK_KEYS, 'plan.accessibility.staticFallback');
    if (value.staticFallback.type !== 'css' || !COLOR_PATTERN.test(String(value.staticFallback.color ?? ''))) {
        throw new TypeError('plan.accessibility.staticFallback is invalid');
    }
}

function assertId(value, label) {
    if (!ID_PATTERN.test(String(value ?? '')) || String(value).length > 96) throw new TypeError(`${label} is invalid`);
}

function assertPlainObject(value, label) {
    if (!isPlainObject(value)) throw new TypeError(`${label} must be a plain object`);
}

function assertExactKeys(value, expected, label) {
    const actual = Object.keys(value).sort();
    const wanted = [...expected].sort();
    if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
        throw new TypeError(`${label} contains unknown or missing fields`);
    }
}

function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function canonicalJson(value) {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new TypeError('Canonical JSON forbids non-finite numbers');
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (!isPlainObject(value)) throw new TypeError('Canonical JSON accepts only plain objects');
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

function typedError(code, message) {
    const error = new TypeError(message);
    error.code = code;
    return error;
}

function failure(code, message) {
    return Object.freeze({ ok: false, plan: null, execution: null, code, message });
}
