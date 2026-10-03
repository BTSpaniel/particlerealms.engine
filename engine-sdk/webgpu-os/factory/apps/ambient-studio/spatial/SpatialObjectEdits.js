// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { encodeFloats, decodeFloats } from './DepthEngine.js';
import { cloneStrictJson } from '../../../../../engine/core/schema/StrictJsonValue.js';

/** Saved overrides over immutable captured geometry. Groups are explicit selections,
 * not inferred semantic labels; a tree needs a supplied group or segmentation. */
export function normalizeSpatialObjectEdits(value) {
    value = cloneStrictJson(value, '$.objectEdits');
    if (!value || value.version !== 1 || !Array.isArray(value.objects) || value.objects.length > 64) throw new TypeError('Object edits need version 1 and at most 64 selections.');
    if (Object.keys(value).some(key => !['version', 'objects'].includes(key))) throw new TypeError('Unknown object edit field.');
    const used = new Set(), ids = new Set();
    return { version: 1, objects: value.objects.map(object => {
        if (!object || Object.keys(object).some(key => !['id', 'label', 'groups', 'visible', 'translation', 'scale', 'opacity'].includes(key))) throw new TypeError('Unknown selected object field.');
        if (typeof object.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(object.id) || ids.has(object.id)) throw new TypeError('Object IDs must be unique.');
        ids.add(object.id);
        if (!Array.isArray(object.groups) || !object.groups.length || object.groups.length > 256) throw new TypeError('Select 1–256 explicit Gaussian group IDs.');
        for (const group of object.groups) { if (!Number.isInteger(group) || group < 0 || group > 4294967295 || used.has(group)) throw new TypeError('Selected groups must be unique and cannot have overlapping ownership.'); used.add(group); }
        const translation = object.translation ?? [0, 0, 0];
        if (!Array.isArray(translation) || translation.length !== 3 || translation.some(x => !Number.isFinite(x) || Math.abs(x) > 10000)) throw new TypeError('Object translation must be a finite world-space vector.');
        const scale = object.scale ?? 1, opacity = object.opacity ?? 1;
        if (!Number.isFinite(scale) || scale < .001 || scale > 1000 || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new TypeError('Object scale or opacity is out of range.');
        if (object.visible !== undefined && typeof object.visible !== 'boolean') throw new TypeError('Object visibility must be boolean.');
        return { id: object.id, label: String(object.label ?? object.id).slice(0, 100), groups: [...object.groups], visible: object.visible !== false, translation: [...translation], scale, opacity };
    }) };
}

/** Apply once to canonical splats before runtime normalization. Uniform scaling
 * preserves quaternion and SH direction; the pivot is the selected bounds center.
 * For origin-bearing clouds both payload and pivot remain local. Translation is
 * a world-space delta, so it never needs the large world origin added to it. */
export function prepareSpatialObjectEdits(cloud, value, options = {}) {
    if (!value) return { cloud, transforms: null };
    const edits = normalizeSpatialObjectEdits(value), data = decodeFloats(cloud.data, cloud.count * 14);
    const groups = decodeGroups(cloud.groups, cloud.count), transforms = new Map();
    let canonicalBounds = null;
    if (options.groupBounds !== undefined) {
        if (!Array.isArray(options.groupBounds)) throw new TypeError('Canonical group bounds must be an array.');
        canonicalBounds = new Map();
        for (const bounds of options.groupBounds) {
            if (!bounds || !Number.isInteger(bounds.groupId) || bounds.groupId < 0 || bounds.groupId > 4294967295 || canonicalBounds.has(bounds.groupId)) throw new TypeError('Canonical group bounds need unique group IDs.');
            for (const key of ['min', 'max']) if (!Array.isArray(bounds[key]) || bounds[key].length !== 3 || Array.from(bounds[key]).some(x => !Number.isFinite(x))) throw new TypeError('Canonical group bounds need finite local coordinates.');
            if (bounds.min.some((x, axis) => x > bounds.max[axis])) throw new TypeError('Canonical group bounds cannot be inverted.');
            canonicalBounds.set(bounds.groupId, bounds);
        }
    }
    for (const object of edits.objects) {
        const selected = new Set(object.groups), indexes = [], lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < cloud.count; i++) if (selected.has(groups[i])) { indexes.push(i); for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], data[i * 14 + a]); hi[a] = Math.max(hi[a], data[i * 14 + a]); } }
        if (canonicalBounds) {
            lo.fill(Infinity); hi.fill(-Infinity);
            for (const group of object.groups) { const bounds = canonicalBounds.get(group); if (!bounds) throw new TypeError(`Object '${object.label}' selects no canonical Gaussian group ${group}.`); for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], bounds.min[a]); hi[a] = Math.max(hi[a], bounds.max[a]); } }
        } else if (!indexes.length) throw new TypeError(`Object '${object.label}' selects no supplied Gaussian groups.`);
        const center = lo.map((x, a) => (x + hi[a]) / 2);
        const transform = { center, translation: object.translation, scale: object.scale, opacity: object.visible ? object.opacity : 0 };
        for (const group of object.groups) transforms.set(group, transform);
        for (const i of indexes) { const at = i * 14; for (let a = 0; a < 3; a++) { data[at + a] = center[a] + (data[at + a] - center[a]) * object.scale + object.translation[a]; data[at + 3 + a] *= object.scale; } data[at + 13] *= object.visible ? object.opacity : 0; }
    }
    return { cloud: { ...cloud, data: encodeFloats(data) }, transforms };
}

/** Static baking and sequence playback share the same canonical object pivot. */
export function applySpatialObjectEdits(cloud, value) {
    return prepareSpatialObjectEdits(cloud, value).cloud;
}

export function decodeGroups(text,count){if(text==null)return new Uint32Array(count);if(typeof text!=='string'||text.length!==Math.ceil(count*4/3)*4||!(/^[A-Za-z0-9+/]*={0,2}$/).test(text))throw new TypeError('Invalid object-group buffer');const raw=atob(text);if(raw.length!==count*4)throw new TypeError('Object-group length mismatch');const a=new Uint8Array(raw.length);for(let i=0;i<a.length;i++)a[i]=raw.charCodeAt(i);return new Uint32Array(a.buffer);}
