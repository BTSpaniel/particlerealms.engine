// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { byteSignature } from '../core/math/FormatMath.js';
import { animationPlaybackStateReport } from '../core/math/AnimationTimeMath.js';
import { morphWeightStateReport } from '../core/math/MeshAttributeMath.js';
import { finiteNumberReport } from '../core/math/MathValidation.js';

/**
 * CollabSceneSync.js
 * Serializes EditorHistory actions <-> collab ops.
 * Handles full scene snapshots for new joiners.
 */

export const COLLAB_SCENE_LIMITS = Object.freeze({
    maxEntities: 10000,
    maxFolders: 2048,
    maxEcsIndex: 262143,
    maxChildren: 4096,
    maxTags: 64,
    maxBatchEntities: 256,
    maxTextBytes: 1024,
    maxValueDepth: 32,
    maxValueNodes: 500000,
    maxValueBytes: 64 * 1024 * 1024,
    maxArrayLength: 10000,
    maxObjectKeys: 256,
    maxMeshParts: 4096,
});

const KNOWN_COMPONENTS = Object.freeze([
    'Transform', 'PhysicsBody', 'Collider', 'Renderable', 'Light', 'Camera',
    'ParticleEmitter', 'NavAgent', 'PhysicsChain', 'PhysicsRope', 'TwistedRope',
    'WeldConstraint', 'EntityFlags', 'Cloth', 'FluidSource', 'FluidVolume', 'Input',
    'NetReplicated', 'ParticleField', 'PhysicalMaterial', 'PhysicsCloth', 'PhysicsHair',
    'PhysicsSoftBody', 'PhysicsWire', 'StickmanRagdoll', 'Emitter',
]);
const KNOWN_COMPONENT_SET = new Set(KNOWN_COMPONENTS);
const SYNCED_ACTION_TYPES = new Set([
    'transform', 'create', 'delete', 'delete_multi', 'property', 'model_animation', 'model_morph_weights', 'rename',
    'reparent', 'folder_create', 'folder_delete', 'folder_rename',
    'component_add', 'component_remove', 'paste',
]);
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const _sceneTextEncoder = new TextEncoder();

function _textReport(value, { allowEmpty = false, nullable = false } = {}) {
    if (nullable && value == null) return { valid: true, value: null, byteLength: 0 };
    const validType = typeof value === 'string';
    const byteLength = validType ? _sceneTextEncoder.encode(value).byteLength : 0;
    const valid = validType && (allowEmpty || value.length > 0) && byteLength <= COLLAB_SCENE_LIMITS.maxTextBytes;
    return { valid, value: valid ? value : '', byteLength };
}

export function collabSceneEntityIdReport(value) {
    const admitted = finiteNumberReport(value, {
        integer: true,
        min: _ECS_INDEX_CAPACITY,
        max: Number.MAX_SAFE_INTEGER,
        allowNegativeZero: false,
    });
    const generation = admitted.valid ? Math.floor(admitted.value / _ECS_INDEX_CAPACITY) : 0;
    const index = admitted.valid ? admitted.value - generation * _ECS_INDEX_CAPACITY : 0;
    const valid = admitted.valid && generation > 0 && index <= COLLAB_SCENE_LIMITS.maxEcsIndex;
    return { valid, value: valid ? admitted.value : 0, index, generation };
}

export function collabSceneValueReport(value, options = {}) {
    const limits = {
        maxDepth: options.maxDepth ?? COLLAB_SCENE_LIMITS.maxValueDepth,
        maxNodes: options.maxNodes ?? COLLAB_SCENE_LIMITS.maxValueNodes,
        maxBytes: options.maxBytes ?? COLLAB_SCENE_LIMITS.maxValueBytes,
        maxArrayLength: options.maxArrayLength ?? COLLAB_SCENE_LIMITS.maxArrayLength,
        maxObjectKeys: options.maxObjectKeys ?? COLLAB_SCENE_LIMITS.maxObjectKeys,
        maxTextBytes: options.maxTextBytes ?? COLLAB_SCENE_LIMITS.maxValueBytes,
    };
    if (!Object.values(limits).every((limit) => Number.isSafeInteger(limit) && limit >= 0)) {
        return { valid: false, value: null, nodes: 0, byteLength: 0, reason: 'invalid-limits' };
    }
    const state = { nodes: 0, byteLength: 0, ancestors: new WeakSet(), reason: 'valid' };
    const fail = (reason) => { state.reason = reason; return undefined; };
    const visit = (input, depth) => {
        state.nodes += 1;
        if (state.nodes > limits.maxNodes) return fail('node-limit');
        if (depth > limits.maxDepth) return fail('depth-limit');
        if (input === null || typeof input === 'boolean') return input;
        if (typeof input === 'number') return Number.isFinite(input) ? input : fail('non-finite-number');
        if (typeof input === 'string') {
            const bytes = _sceneTextEncoder.encode(input).byteLength;
            state.byteLength += bytes;
            return bytes <= limits.maxTextBytes && state.byteLength <= limits.maxBytes ? input : fail('byte-limit');
        }
        if (typeof input !== 'object') return fail('unsupported-value');
        if (state.ancestors.has(input)) return fail('cycle');
        if (ArrayBuffer.isView(input)) {
            state.byteLength += input.byteLength;
            if (state.byteLength > limits.maxBytes) return fail('byte-limit');
            return typeof input.slice === 'function' ? input.slice(0) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength).slice();
        }
        if (input instanceof ArrayBuffer) {
            state.byteLength += input.byteLength;
            return state.byteLength <= limits.maxBytes ? input.slice(0) : fail('byte-limit');
        }
        state.ancestors.add(input);
        let output;
        if (Array.isArray(input)) {
            if (input.length > limits.maxArrayLength) {
                state.ancestors.delete(input);
                return fail('array-limit');
            }
            output = [];
            for (const item of input) {
                const cloned = visit(item, depth + 1);
                if (state.reason !== 'valid') break;
                output.push(cloned);
            }
        } else {
            const prototype = Object.getPrototypeOf(input);
            if (prototype !== Object.prototype && prototype !== null) {
                state.ancestors.delete(input);
                return fail('non-plain-object');
            }
            const keys = Object.keys(input);
            if (keys.length > limits.maxObjectKeys || keys.some((key) => DANGEROUS_KEYS.has(key))) {
                state.ancestors.delete(input);
                return fail('object-key-limit');
            }
            output = {};
            for (const key of keys) {
                if (input[key] === undefined) continue;
                const keyBytes = _sceneTextEncoder.encode(key).byteLength;
                state.byteLength += keyBytes;
                if (keyBytes > COLLAB_SCENE_LIMITS.maxTextBytes || state.byteLength > limits.maxBytes) {
                    fail('byte-limit');
                    break;
                }
                const cloned = visit(input[key], depth + 1);
                if (state.reason !== 'valid') break;
                output[key] = cloned;
            }
        }
        state.ancestors.delete(input);
        return output;
    };
    const cloned = visit(value, 0);
    return {
        valid: state.reason === 'valid',
        value: state.reason === 'valid' ? cloned : null,
        nodes: state.nodes,
        byteLength: state.byteLength,
        reason: state.reason,
    };
}

function _componentNameReport(value) {
    const text = _textReport(value);
    return { valid: text.valid && KNOWN_COMPONENT_SET.has(value), value: text.valid ? value : '' };
}

function _folderIdReport(value, nullable = true) {
    return _textReport(value, { nullable });
}

function _meshPartsReport(value) {
    if (value == null) return { valid: true, value: null };
    if (!Array.isArray(value) || value.length === 0 || value.length > COLLAB_SCENE_LIMITS.maxMeshParts) {
        return { valid: false, value: null };
    }
    const parts = [];
    for (const part of value) {
        if (!part || typeof part !== 'object' || Array.isArray(part)) return { valid: false, value: null };
        const meshType = _textReport(part.meshType);
        const name = _textReport(part.name ?? '', { allowEmpty: true });
        const materialId = _textReport(part.materialId ?? '', { allowEmpty: true });
        const indices = ['partIndex', 'meshIndex', 'primitiveIndex'].map((key) =>
            finiteNumberReport(part[key], { integer: true, min: 0, max: COLLAB_SCENE_LIMITS.maxMeshParts }));
        const optionalIndices = ['materialIndex', 'morphTargetNode', 'nodeIndex', 'skinIndex'].map((key) => part[key] == null
            ? { valid: true, value: null }
            : finiteNumberReport(part[key], { integer: true, min: 0, max: Number.MAX_SAFE_INTEGER }));
        const nodeWorldMatrix = part.nodeWorldMatrix == null
            ? null
            : (Array.isArray(part.nodeWorldMatrix) && part.nodeWorldMatrix.length === 16
                && part.nodeWorldMatrix.every(Number.isFinite) ? [...part.nodeWorldMatrix] : false);
        const skinned = part.skinned == null ? false : part.skinned;
        if (!meshType.valid || !name.valid || !materialId.valid || indices.some((entry) => !entry.valid)
            || optionalIndices.some((entry) => !entry.valid) || nodeWorldMatrix === false
            || typeof skinned !== 'boolean') return { valid: false, value: null };
        parts.push({
            meshType: meshType.value,
            partIndex: indices[0].value,
            meshIndex: indices[1].value,
            primitiveIndex: indices[2].value,
            materialIndex: optionalIndices[0].value,
            materialId: materialId.value || null,
            morphTargetNode: optionalIndices[1].value,
            nodeIndex: optionalIndices[2].value,
            skinIndex: optionalIndices[3].value,
            nodeWorldMatrix,
            skinned,
            name: name.value,
        });
    }
    return { valid: new Set(parts.map((part) => part.meshType)).size === parts.length, value: parts };
}

function _modelBoundsReport(value) {
    if (value == null) return { valid: true, value: null };
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { valid: false, value: null };
    const vectors = ['min', 'max', 'center', 'extents'].map((key) => value[key]);
    const finiteVectors = vectors.every((vector) => Array.isArray(vector) && vector.length === 3 && vector.every(Number.isFinite));
    const vertexCount = finiteNumberReport(value.vertexCount, { integer: true, min: 1, max: Number.MAX_SAFE_INTEGER });
    const ordered = finiteVectors && value.min.every((entry, axis) => entry <= value.max[axis])
        && value.extents.every((entry) => entry >= 0);
    return {
        valid: finiteVectors && vertexCount.valid && ordered,
        value: finiteVectors && vertexCount.valid && ordered ? {
            min: [...value.min], max: [...value.max], center: [...value.center], extents: [...value.extents],
            vertexCount: vertexCount.value,
        } : null,
    };
}

function _modelAnimationReport(value) {
    if (value == null) return { valid: true, value: null };
    return animationPlaybackStateReport(value, {
        clipCount: 65536,
        maxTime: 1e9,
        maxAbsSpeed: 16,
    });
}

function _modelMorphWeightsReport(value) {
    if (value == null) return { valid: true, value: null };
    return morphWeightStateReport(value);
}

function _entityActionDataValid(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
    if (data.name !== undefined && !_textReport(data.name, { allowEmpty: true }).valid) return false;
    if (data.folderId !== undefined && !_folderIdReport(data.folderId).valid) return false;
    if (data.children !== undefined && (!Array.isArray(data.children)
        || data.children.length > COLLAB_SCENE_LIMITS.maxChildren
        || !_uniqueArray(data.children)
        || !data.children.every((id) => collabSceneEntityIdReport(id).valid))) return false;
    if (data.tags !== undefined && (!Array.isArray(data.tags)
        || data.tags.length > COLLAB_SCENE_LIMITS.maxTags
        || !data.tags.every((tag) => _textReport(tag, { allowEmpty: true }).valid))) return false;
    if (data.components !== undefined) {
        if (!data.components || typeof data.components !== 'object' || Array.isArray(data.components)) return false;
        if (Object.keys(data.components).some((name) => !_componentNameReport(name).valid)) return false;
    }
    if (data.modelInstanceId !== undefined && !_textReport(data.modelInstanceId, { nullable: true }).valid) return false;
    if (data.meshParts !== undefined && !_meshPartsReport(data.meshParts).valid) return false;
    if (data.modelBounds !== undefined && !_modelBoundsReport(data.modelBounds).valid) return false;
    if (data.modelAnimation !== undefined && !_modelAnimationReport(data.modelAnimation).valid) return false;
    if (data.modelMorphWeights !== undefined && !_modelMorphWeightsReport(data.modelMorphWeights).valid) return false;
    return true;
}

function _folderActionDataValid(data) {
    return !!data && typeof data === 'object' && !Array.isArray(data)
        && (data.name === undefined || _textReport(data.name, { allowEmpty: true }).valid)
        && (data.parent === undefined || _folderIdReport(data.parent).valid)
        && (data.children === undefined || (Array.isArray(data.children)
            && data.children.length <= COLLAB_SCENE_LIMITS.maxChildren
            && _uniqueArray(data.children)
            && data.children.every((id) => _folderIdReport(id, false).valid)))
        && (data.entities === undefined || (Array.isArray(data.entities)
            && data.entities.length <= COLLAB_SCENE_LIMITS.maxEntities
            && _uniqueArray(data.entities)
            && data.entities.every((id) => collabSceneEntityIdReport(id).valid)));
}

function _actionPayloadReport(type, payload) {
    if (!SYNCED_ACTION_TYPES.has(type) || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return { valid: false, action: null, reason: 'unsupported-action' };
    }
    const value = collabSceneValueReport(payload, { maxNodes: 100000, maxBytes: 8 * 1024 * 1024 });
    if (!value.valid) return { valid: false, action: null, reason: value.reason };
    const p = value.value;
    const entity = () => collabSceneEntityIdReport(p.entityId).valid;
    const folder = () => _folderIdReport(p.folderId, false).valid;
    let valid = false;
    switch (type) {
        case 'transform':
            valid = entity() && p.after && typeof p.after === 'object';
            break;
        case 'create':
        case 'delete':
            valid = entity() && (p.data === null || _entityActionDataValid(p.data));
            break;
        case 'delete_multi':
            valid = Array.isArray(p.entities) && p.entities.length <= COLLAB_SCENE_LIMITS.maxBatchEntities
                && p.entities.every((entry) => entry && collabSceneEntityIdReport(entry.entityId).valid
                    && (entry.data === null || _entityActionDataValid(entry.data)));
            break;
        case 'property':
            valid = entity() && _componentNameReport(p.componentName).valid && _textReport(p.propertyName).valid
                && !DANGEROUS_KEYS.has(p.propertyName) && Object.prototype.hasOwnProperty.call(p, 'after');
            break;
        case 'model_animation':
            valid = entity() && p.before != null && p.after != null
                && _modelAnimationReport(p.before).valid
                && _modelAnimationReport(p.after).valid;
            break;
        case 'model_morph_weights':
            valid = entity() && p.before != null && p.after != null
                && _modelMorphWeightsReport(p.before).valid
                && _modelMorphWeightsReport(p.after).valid;
            break;
        case 'rename':
            valid = entity() && _textReport(p.after, { allowEmpty: true }).valid;
            break;
        case 'reparent':
            valid = entity() && _folderIdReport(p.before).valid && _folderIdReport(p.after).valid;
            break;
        case 'folder_create':
        case 'folder_delete':
            valid = folder() && _folderActionDataValid(p.data);
            if (valid && type === 'folder_delete') {
                valid = Array.isArray(p.childEntities) && p.childEntities.length <= COLLAB_SCENE_LIMITS.maxChildren
                    && p.childEntities.every((id) => collabSceneEntityIdReport(id).valid);
            }
            break;
        case 'folder_rename':
            valid = folder() && _textReport(p.after, { allowEmpty: true }).valid;
            break;
        case 'component_add':
        case 'component_remove':
            valid = entity() && _componentNameReport(p.componentName).valid
                && (p.data === null || (p.data && typeof p.data === 'object'));
            break;
        case 'paste':
            valid = Array.isArray(p.entityIds) && Array.isArray(p.entityData)
                && p.entityIds.length === p.entityData.length
                && p.entityIds.length <= COLLAB_SCENE_LIMITS.maxBatchEntities
                && p.entityIds.every((id) => collabSceneEntityIdReport(id).valid)
                && p.entityData.every((entry) => _entityActionDataValid(entry));
            break;
    }
    return { valid, action: valid ? { type, ...p } : null, reason: valid ? 'valid' : 'invalid-shape' };
}

function _payloadFromAction(action) {
    const payload = { ...action };
    delete payload.type;
    return payload;
}

/**
 * Convert an EditorHistory action into a collab op payload.
 */
export function actionToOp(action, selfId, seq) {
    if (!action || !SYNCED_ACTION_TYPES.has(action.type) || !_textReport(selfId).valid) return null;
    const sequence = finiteNumberReport(seq, { integer: true, min: 0, max: Number.MAX_SAFE_INTEGER, allowNegativeZero: false });
    if (!sequence.valid) return null;
    const payload = _serializeAction(action);
    const admitted = _actionPayloadReport(action.type, payload);
    if (!admitted.valid) return null;
    return {
        id: _uuid(),
        peerId: selfId,
        seq: sequence.value,
        type: action.type,
        payload: _payloadFromAction(admitted.action),
        ts: Date.now(),
    };
}

/**
 * Convert a collab op back into an EditorHistory-compatible action.
 */
export function opToAction(op) {
    if (!op || !op.type || !op.payload) return null;
    const admitted = _actionPayloadReport(op.type, op.payload);
    return admitted.valid ? admitted.action : null;
}

export function collabSceneOpReport(op) {
    if (!op || typeof op !== 'object') return { valid: false, value: null, reason: 'not-object' };
    const id = _textReport(op.id);
    const peerId = _textReport(op.peerId);
    const seq = finiteNumberReport(op.seq, { integer: true, min: 0, max: Number.MAX_SAFE_INTEGER, allowNegativeZero: false });
    const ts = finiteNumberReport(op.ts, { min: 0, max: Number.MAX_SAFE_INTEGER, allowNegativeZero: false });
    const action = _actionPayloadReport(op.type, op.payload);
    const valid = id.valid && peerId.valid && seq.valid && ts.valid && action.valid;
    return {
        valid,
        value: valid ? { id: id.value, peerId: peerId.value, seq: seq.value, type: op.type, payload: _payloadFromAction(action.action), ts: ts.value } : null,
        reason: valid ? 'valid' : 'invalid-envelope',
    };
}

/**
 * Serialize the full scene state into a compact snapshot for new joiners.
 */
export function serializeSnapshot(editor) {
    if (!editor?.scene?.entities || !editor?.scene?.folders) {
        throw new TypeError('serializeSnapshot requires an initialized editor scene');
    }
    const storage = _getStorageImports();
    if (editor.ecsWorld && editor.scene.entities.size > 0 && typeof storage?.getEntityComponentRecord !== 'function') {
        throw new Error('serializeSnapshot requires injected ECS component-record access');
    }
    const snapshot = {
        v: 1,
        ts: Date.now(),
        nextFolderId: Number.isSafeInteger(editor.scene.nextFolderId) ? editor.scene.nextFolderId : 1,
        entities: [],
        folders: [],
        root: editor.scene.root ? [...editor.scene.root] : [],
    };

    for (const [entityId, meta] of editor.scene.entities) {
        const entityData = {
            id: entityId,
            name: meta.name || `Entity ${entityId}`,
            meshType: meta.meshType || null,
            spawnId: meta.spawnId || null,
            assetId: meta.assetId || null,
            modelInstanceId: meta.modelInstanceId || null,
            meshParts: meta.meshParts ? _deepClone(meta.meshParts) : null,
            modelBounds: meta.modelBounds ? _deepClone(meta.modelBounds) : null,
            modelAnimation: meta.modelAnimation ? _deepClone(meta.modelAnimation) : null,
            modelMorphWeights: meta.modelMorphWeights ? _deepClone(meta.modelMorphWeights) : null,
            color: meta.color ?? null,
            parent: meta.parent || null,
            children: meta.children ? [...meta.children] : [],
            folderId: meta.folderId || null,
            tags: meta.tags || [],
            layer: meta.layer ?? null,
            tag: meta.tag ?? null,
            enabled: meta.enabled !== false,
            visible: meta.visible !== false,
            hidden: meta.hidden === true,
            locked: meta.locked === true,
            renderFlags: meta.renderFlags ?? null,
            lodBias: meta.lodBias ?? null,
            lodGroup: meta.lodGroup ?? null,
            prefabUuid: meta.prefabUuid ?? null,
            prefabInstanceId: meta.prefabInstanceId ?? null,
            prefabOverrides: meta.prefabOverrides ?? null,
            prefabSource: meta.prefabSource ?? null,
            emitterConfig: meta.emitterConfig ?? null,
            components: {},
        };

        const record = editor.ecsWorld ? storage.getEntityComponentRecord(editor.ecsWorld, entityId) : null;
        for (const [compName, comp] of Object.entries(record || {})) {
            if (!KNOWN_COMPONENT_SET.has(compName)) throw new RangeError(`unregistered snapshot component: ${compName}`);
            if (comp != null) entityData.components[compName] = _deepClone(comp);
        }
        if (!entityData.components.Emitter && meta.emitterConfig) entityData.components.Emitter = _deepClone(meta.emitterConfig);

        snapshot.entities.push(entityData);
    }

    for (const [folderId, folder] of editor.scene.folders) {
        snapshot.folders.push({
            id: folderId,
            name: folder.name || 'Folder',
            parent: folder.parent || null,
            children: folder.children ? [...folder.children] : [],
            entities: folder.entities ? [...folder.entities] : [],
        });
    }

    const admitted = collabSceneSnapshotReport(snapshot);
    if (!admitted.valid) throw new RangeError(`scene snapshot rejected: ${admitted.reason}`);
    return admitted.value;
}

function _uniqueArray(values) {
    return Array.isArray(values) && new Set(values).size === values.length;
}

function _nullableFinite(value) {
    return value == null || finiteNumberReport(value).valid;
}

function _hasParentCycle(entries, idKey, parentKey) {
    const parents = new Map(entries.map((entry) => [entry[idKey], entry[parentKey]]));
    for (const entry of entries) {
        const seen = new Set();
        let current = entry[idKey];
        while (current != null) {
            if (seen.has(current)) return true;
            seen.add(current);
            current = parents.get(current) ?? null;
        }
    }
    return false;
}

function _hasChildCycle(entries, idKey, childrenKey) {
    const children = new Map(entries.map((entry) => [entry[idKey], entry[childrenKey]]));
    const visiting = new Set();
    const visited = new Set();
    const visit = (id) => {
        if (visiting.has(id)) return true;
        if (visited.has(id)) return false;
        visiting.add(id);
        for (const child of children.get(id) || []) {
            if (visit(child)) return true;
        }
        visiting.delete(id);
        visited.add(id);
        return false;
    };
    return entries.some((entry) => visit(entry[idKey]));
}

function _restoreArray(target, source) {
    target.length = 0;
    for (const value of source) target.push(value);
}

export function collabSceneSnapshotReport(snapshot) {
    const raw = collabSceneValueReport(snapshot);
    const reject = (reason) => ({ valid: false, value: null, reason, entityCount: 0, folderCount: 0 });
    if (!raw.valid) return reject(raw.reason);
    const source = raw.value;
    if (!source || source.v !== 1 || !Array.isArray(source.entities) || !Array.isArray(source.folders)
        || !Array.isArray(source.root)) return reject('invalid-root-shape');
    const timestamp = finiteNumberReport(source.ts, { min: 0, max: Number.MAX_SAFE_INTEGER, allowNegativeZero: false });
    const nextFolderId = finiteNumberReport(source.nextFolderId ?? 1, {
        integer: true,
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
        allowNegativeZero: false,
    });
    if (!timestamp.valid || !nextFolderId.valid
        || source.entities.length > COLLAB_SCENE_LIMITS.maxEntities
        || source.folders.length > COLLAB_SCENE_LIMITS.maxFolders
        || source.root.length > COLLAB_SCENE_LIMITS.maxEntities) return reject('root-limit');

    const entities = [];
    const entityIds = new Set();
    const entityIndices = new Set();
    for (const item of source.entities) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return reject('invalid-entity');
        const id = collabSceneEntityIdReport(item.id);
        const name = _textReport(item.name, { allowEmpty: true });
        const parent = item.parent == null ? { valid: true, value: null } : collabSceneEntityIdReport(item.parent);
        const folderId = _folderIdReport(item.folderId);
        if (!id.valid || !name.valid || !parent.valid || !folderId.valid
            || entityIds.has(id.value) || entityIndices.has(id.index)
            || !Array.isArray(item.children) || item.children.length > COLLAB_SCENE_LIMITS.maxChildren
            || !_uniqueArray(item.children) || !item.children.every((child) => collabSceneEntityIdReport(child).valid)
            || !Array.isArray(item.tags) || item.tags.length > COLLAB_SCENE_LIMITS.maxTags
            || !item.tags.every((tag) => _textReport(tag, { allowEmpty: true }).valid)
            || !item.components || typeof item.components !== 'object' || Array.isArray(item.components)) {
            return reject('invalid-entity-shape');
        }
        const componentNames = Object.keys(item.components);
        if (componentNames.length > KNOWN_COMPONENTS.length
            || componentNames.some((nameValue) => !_componentNameReport(nameValue).valid)) {
            return reject('invalid-component-map');
        }
        const meshParts = _meshPartsReport(item.meshParts);
        const modelBounds = _modelBoundsReport(item.modelBounds);
        const modelAnimation = _modelAnimationReport(item.modelAnimation);
        const modelMorphWeights = _modelMorphWeightsReport(item.modelMorphWeights);
        const nullableTexts = ['meshType', 'spawnId', 'assetId', 'modelInstanceId', 'tag', 'lodGroup', 'prefabUuid', 'prefabInstanceId', 'prefabSource'];
        if (nullableTexts.some((key) => !_textReport(item[key], { nullable: true, allowEmpty: true }).valid)
            || !meshParts.valid || !modelBounds.valid || !modelAnimation.valid || !modelMorphWeights.valid
            || !_nullableFinite(item.layer) || !_nullableFinite(item.renderFlags) || !_nullableFinite(item.lodBias)
            || (item.enabled !== undefined && typeof item.enabled !== 'boolean')
            || (item.visible !== undefined && typeof item.visible !== 'boolean')
            || (item.hidden !== undefined && typeof item.hidden !== 'boolean')
            || (item.locked !== undefined && typeof item.locked !== 'boolean')) {
            return reject('invalid-entity-metadata');
        }
        entityIds.add(id.value);
        entityIndices.add(id.index);
        entities.push({
            id: id.value,
            name: name.value,
            meshType: item.meshType ?? null,
            spawnId: item.spawnId ?? null,
            assetId: item.assetId ?? null,
            modelInstanceId: item.modelInstanceId ?? null,
            meshParts: meshParts.value,
            modelBounds: modelBounds.value,
            modelAnimation: modelAnimation.value,
            modelMorphWeights: modelMorphWeights.value,
            color: item.color ?? null,
            parent: parent.value,
            children: [...item.children],
            folderId: folderId.value,
            tags: [...item.tags],
            layer: item.layer ?? null,
            tag: item.tag ?? null,
            enabled: item.enabled !== false,
            visible: item.visible !== false,
            hidden: item.hidden === true,
            locked: item.locked === true,
            renderFlags: item.renderFlags ?? null,
            lodBias: item.lodBias ?? null,
            lodGroup: item.lodGroup ?? null,
            prefabUuid: item.prefabUuid ?? null,
            prefabInstanceId: item.prefabInstanceId ?? null,
            prefabOverrides: item.prefabOverrides ?? null,
            prefabSource: item.prefabSource ?? null,
            emitterConfig: item.emitterConfig ?? item.components.Emitter ?? null,
            components: { ...item.components },
        });
    }

    const folders = [];
    const folderIds = new Set();
    for (const item of source.folders) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return reject('invalid-folder');
        const id = _folderIdReport(item.id, false);
        const name = _textReport(item.name, { allowEmpty: true });
        const parent = _folderIdReport(item.parent);
        if (!id.valid || !name.valid || !parent.valid || folderIds.has(id.value)
            || !Array.isArray(item.children) || item.children.length > COLLAB_SCENE_LIMITS.maxChildren || !_uniqueArray(item.children)
            || !item.children.every((child) => _folderIdReport(child, false).valid)
            || !Array.isArray(item.entities) || item.entities.length > COLLAB_SCENE_LIMITS.maxEntities || !_uniqueArray(item.entities)
            || !item.entities.every((entityId) => collabSceneEntityIdReport(entityId).valid)) {
            return reject('invalid-folder-shape');
        }
        folderIds.add(id.value);
        folders.push({ id: id.value, name: name.value, parent: parent.value, children: [...item.children], entities: [...item.entities] });
    }

    if (!_uniqueArray(source.root) || !source.root.every((id) => entityIds.has(id))) return reject('invalid-root-reference');
    for (const entity of entities) {
        if ((entity.parent != null && !entityIds.has(entity.parent))
            || entity.children.some((id) => !entityIds.has(id))
            || (entity.folderId != null && !folderIds.has(entity.folderId))) return reject('missing-entity-reference');
    }
    for (const folder of folders) {
        if ((folder.parent != null && !folderIds.has(folder.parent))
            || folder.children.some((id) => !folderIds.has(id))
            || folder.entities.some((id) => !entityIds.has(id))) return reject('missing-folder-reference');
    }
    if (_hasParentCycle(entities, 'id', 'parent') || _hasParentCycle(folders, 'id', 'parent')
        || _hasChildCycle(entities, 'id', 'children') || _hasChildCycle(folders, 'id', 'children')) {
        return reject('hierarchy-cycle');
    }

    return {
        valid: true,
        value: {
            v: 1,
            ts: timestamp.value,
            nextFolderId: nextFolderId.value,
            entities,
            folders,
            root: [...source.root],
        },
        reason: 'valid',
        entityCount: entities.length,
        folderCount: folders.length,
        nodes: raw.nodes,
        byteLength: raw.byteLength,
    };
}

/**
 * Apply a full scene snapshot to the editor (for new joiners).
 * Clears existing scene and rebuilds from snapshot.
 */
export function applySnapshot(editor, snapshot) {
    const admitted = collabSceneSnapshotReport(snapshot);
    if (!admitted.valid || !editor?.scene?.entities || !editor?.scene?.folders) {
        console.warn('[CollabSceneSync] Rejected snapshot:', admitted.reason);
        return false;
    }
    const normalized = admitted.value;
    const storage = _getStorageImports();
    const world = editor.ecsWorld || null;
    const hasComponents = normalized.entities.some((entity) => Object.keys(entity.components).some((name) => name !== 'Emitter'));
    if ((world && (typeof storage?.setEntityComponent !== 'function' || typeof storage?.removeEntityFromStorage !== 'function'))
        || (!world && hasComponents)) {
        console.warn('[CollabSceneSync] Snapshot dependencies are not available');
        return false;
    }

    const stagedEntities = new Map(normalized.entities.map((entity) => [entity.id, {
        name: entity.name,
        meshType: entity.meshType,
        spawnId: entity.spawnId,
        assetId: entity.assetId,
        modelInstanceId: entity.modelInstanceId,
        meshParts: _deepClone(entity.meshParts),
        modelBounds: _deepClone(entity.modelBounds),
        modelAnimation: _deepClone(entity.modelAnimation),
        modelMorphWeights: _deepClone(entity.modelMorphWeights),
        color: _deepClone(entity.color),
        parent: entity.parent,
        children: [...entity.children],
        folderId: entity.folderId,
        tags: [...entity.tags],
        layer: entity.layer,
        tag: entity.tag,
        enabled: entity.enabled,
        visible: entity.visible,
        hidden: entity.hidden,
        locked: entity.locked,
        renderFlags: entity.renderFlags,
        lodBias: entity.lodBias,
        lodGroup: entity.lodGroup,
        prefabUuid: entity.prefabUuid,
        prefabInstanceId: entity.prefabInstanceId,
        prefabOverrides: _deepClone(entity.prefabOverrides),
        prefabSource: entity.prefabSource,
        emitterConfig: _deepClone(entity.emitterConfig),
    }]));
    const stagedFolders = new Map(normalized.folders.map((folder) => [folder.id, {
        name: folder.name,
        parent: folder.parent,
        children: [...folder.children],
        entities: [...folder.entities],
    }]));
    const previousScene = {
        entities: new Map(editor.scene.entities),
        folders: new Map(editor.scene.folders),
        root: Array.isArray(editor.scene.root) ? [...editor.scene.root] : [],
        nextFolderId: editor.scene.nextFolderId,
    };
    const previousWorld = world ? {
        generations: [...world._entityGenerations],
        alive: [...world._entityAlive],
        freeList: [...world._freeList],
        storage: _cloneArchetypeStorage(world.storage, world),
        hadStorage: Object.prototype.hasOwnProperty.call(world, 'storage'),
    } : null;

    try {
        if (world) {
            for (const oldId of editor.scene.entities.keys()) {
                storage.removeEntityFromStorage(world, oldId);
                _ecsDestroyEntity(world, oldId);
            }
            for (const entity of normalized.entities) {
                _ecsRegisterEntity(world, entity.id);
                for (const [compName, compData] of Object.entries(entity.components)) {
                    if (compName === 'Emitter') continue;
                    storage.setEntityComponent(world, entity.id, compName, _deepClone(compData));
                }
            }
        }
        editor.scene.entities.clear();
        for (const [id, meta] of stagedEntities) editor.scene.entities.set(id, meta);
        editor.scene.folders.clear();
        for (const [id, folder] of stagedFolders) editor.scene.folders.set(id, folder);
        editor.scene.root = [...normalized.root];
        editor.scene.nextFolderId = normalized.nextFolderId;
    } catch (err) {
        editor.scene.entities.clear();
        for (const [id, meta] of previousScene.entities) editor.scene.entities.set(id, meta);
        editor.scene.folders.clear();
        for (const [id, folder] of previousScene.folders) editor.scene.folders.set(id, folder);
        editor.scene.root = previousScene.root;
        editor.scene.nextFolderId = previousScene.nextFolderId;
        if (world && previousWorld) {
            _restoreArray(world._entityGenerations, previousWorld.generations);
            _restoreArray(world._entityAlive, previousWorld.alive);
            _restoreArray(world._freeList, previousWorld.freeList);
            if (previousWorld.hadStorage) world.storage = previousWorld.storage;
            else delete world.storage;
        }
        console.error('[CollabSceneSync] Failed to apply snapshot:', err);
        return false;
    }

    for (const oldId of previousScene.entities.keys()) {
        try { editor.unregisterEmitter?.(oldId); } catch (_) {}
    }
    for (const entity of normalized.entities) {
        if (entity.emitterConfig) {
            try { editor.registerEmitter?.(entity.id, _deepClone(entity.emitterConfig)); } catch (_) {}
        }
    }
    try { editor.panels?.entities?.renderEntitiesPanel?.(); } catch (_) {}
    console.log('[CollabSceneSync] Snapshot applied:', normalized.entities.length, 'entities');
    return true;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function _serializeAction(action) {
    switch (action.type) {
        case 'transform':
            return {
                entityId: action.entityId,
                before: action.before,
                after: action.after,
            };
        case 'create':
            return {
                entityId: action.entityId,
                data: action.data ? _deepClone(action.data) : null,
            };
        case 'delete':
            return {
                entityId: action.entityId,
                data: action.data ? _deepClone(action.data) : null,
            };
        case 'delete_multi':
            return {
                entities: action.entities ? action.entities.map(e => ({
                    entityId: e.entityId,
                    data: e.data ? _deepClone(e.data) : null,
                })) : [],
            };
        case 'property':
            return {
                entityId: action.entityId,
                componentName: action.componentName,
                propertyName: action.propertyName,
                before: action.before !== undefined ? _deepClone(action.before) : undefined,
                after: action.after !== undefined ? _deepClone(action.after) : undefined,
            };
        case 'model_animation':
            return {
                entityId: action.entityId,
                before: action.before ? _deepClone(action.before) : null,
                after: action.after ? _deepClone(action.after) : null,
            };
        case 'model_morph_weights':
            return {
                entityId: action.entityId,
                before: action.before ? _deepClone(action.before) : null,
                after: action.after ? _deepClone(action.after) : null,
            };
        case 'rename':
            return { entityId: action.entityId, before: action.before, after: action.after };
        case 'reparent':
            return {
                entityId: action.entityId,
                before: action.before ?? null,
                after: action.after ?? null,
            };
        case 'folder_create':
            return { folderId: action.folderId, data: action.data ? _deepClone(action.data) : null };
        case 'folder_delete':
            return {
                folderId: action.folderId,
                data: action.data ? _deepClone(action.data) : null,
                childEntities: action.childEntities ? [...action.childEntities] : [],
            };
        case 'folder_rename':
            return { folderId: action.folderId, before: action.before, after: action.after };
        case 'component_add':
            return {
                entityId: action.entityId,
                componentName: action.componentName,
                data: action.data ? _deepClone(action.data) : null,
            };
        case 'component_remove':
            return {
                entityId: action.entityId,
                componentName: action.componentName,
                data: action.data ? _deepClone(action.data) : null,
            };
        case 'paste':
            return {
                entityIds: action.entityIds ? [...action.entityIds] : [],
                entityData: action.entityData ? _deepClone(action.entityData) : [],
            };
        default:
            return null;
    }
}

function _deepClone(value) {
    const report = collabSceneValueReport(value);
    if (!report.valid) throw new TypeError(`scene value rejected: ${report.reason}`);
    return report.value;
}

function _cloneArchetypeStorage(storage, world) {
    if (!storage) return undefined;
    const clone = {
        world,
        archetypesByKey: new Map(),
        entityLocations: new Map(),
        version: storage.version,
    };
    for (const [key, archetype] of storage.archetypesByKey || []) {
        const componentData = {};
        for (const name of archetype.componentNames || []) {
            componentData[name] = [...(archetype.componentData?.[name] || [])];
        }
        clone.archetypesByKey.set(key, {
            key: archetype.key,
            componentNames: [...(archetype.componentNames || [])],
            entities: [...(archetype.entities || [])],
            componentData,
        });
    }
    for (const [entityId, location] of storage.entityLocations || []) {
        clone.entityLocations.set(entityId, { ...location });
    }
    return clone;
}

// ECS world helpers — mirrors World.js: entityId = generation * 2^20 + index.
const _ECS_INDEX_BITS = 20;
const _ECS_INDEX_CAPACITY = 2 ** _ECS_INDEX_BITS;

function _ecsRegisterEntity(world, entityId) {
    const admitted = collabSceneEntityIdReport(entityId);
    if (!admitted.valid || !Array.isArray(world?._entityGenerations)
        || !Array.isArray(world?._entityAlive) || !Array.isArray(world?._freeList)) {
        throw new RangeError('invalid ECS entity registration');
    }
    const { index, generation } = admitted;
    if (world._entityAlive[index]) throw new Error(`ECS index ${index} is already alive`);
    while (world._entityGenerations.length <= index) {
        world._entityGenerations.push(0);
        world._entityAlive.push(false);
    }
    world._entityGenerations[index] = generation;
    world._entityAlive[index] = true;
    // Remove from freeList if it was marked dead
    for (let i = world._freeList.length - 1; i >= 0; i--) {
        if (world._freeList[i] === index) world._freeList.splice(i, 1);
    }
}

function _ecsDestroyEntity(world, entityId) {
    const admitted = collabSceneEntityIdReport(entityId);
    if (!admitted.valid || !Array.isArray(world?._entityAlive) || !Array.isArray(world?._freeList)) return false;
    const { index, generation } = admitted;
    if (index >= world._entityAlive.length) return false;
    if (world._entityAlive[index] && world._entityGenerations[index] === generation) {
        world._entityAlive[index] = false;
        if (!world._freeList.includes(index)) world._freeList.push(index);
        return true;
    }
    return false;
}

export function registerCollabSceneEntity(world, entityId) {
    try {
        _ecsRegisterEntity(world, entityId);
        return true;
    } catch (_) {
        return false;
    }
}

export function destroyCollabSceneEntity(world, entityId) {
    return _ecsDestroyEntity(world, entityId);
}

let _uuidFallbackSequence = 0;

function _uuid() {
    const cryptoApi = typeof globalThis !== 'undefined' && globalThis.crypto
        ? globalThis.crypto
        : typeof crypto !== 'undefined' ? crypto : null;
    if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
    if (typeof cryptoApi?.getRandomValues === 'function') {
        const bytes = new Uint8Array(16);
        cryptoApi.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = byteSignature(bytes);
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    const seed = `${Date.now().toString(16)}${(++_uuidFallbackSequence).toString(16).padStart(16, '0')}`;
    const hex = seed.padStart(32, '0').slice(-32);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}

// Dependencies are injected by EditorCollab after its ECS storage imports load.
let _storageImports = null;

function _getStorageImports() {
    return _storageImports;
}

export function injectSceneSyncDeps(deps) {
    if (!deps || typeof deps !== 'object') return false;
    const required = ['setEntityComponent', 'getEntityComponent', 'getEntityComponentRecord', 'removeEntityFromStorage'];
    if (!required.every((name) => typeof deps[name] === 'function')) return false;
    _storageImports = Object.freeze(Object.fromEntries(required.map((name) => [name, deps[name]])));
    return true;
}

// Audit gaps: snapshots still lack a protocol epoch, hash, compression, and delta/chunk streaming.
// Host authorization is enforced by EditorCollab rather than cryptographically bound in this module.
// Runtime physics/render/audio subsystem reconciliation and captured large-scene rollback traces remain absent.
// Selection history remains presence-owned and is intentionally not emitted as a scene mutation.
