// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Collision-free, generation-scoped identity for WebGPU descriptors.
 *
 * Pipeline descriptors mix value dictionaries with opaque WebGPU host objects.
 * JSON.stringify() collapses distinct GPUShaderModule and GPUPipelineLayout
 * instances to the same `{}` value, so a numeric hash of that JSON can return a
 * pipeline compiled for the wrong module. This encoder keeps canonical value
 * identity for descriptor dictionaries and assigns stable WeakMap identities to
 * opaque host objects. The full canonical key is used for Map lookup; the short
 * token is diagnostic-only and can never decide cache equality.
 */
export class GpuDescriptorIdentity {
    constructor({ generation = 0 } = {}) {
        this.generation = Number.isInteger(generation) ? generation : 0;
        this._objectIds = new WeakMap();
        this._symbolIds = new Map();
        this._nextObjectId = 1;
        this._tokens = new Map();
        this._nextToken = 1;
    }

    key(descriptor, kind = 'pipeline') {
        const stack = new Set();
        return `${String(kind)}|generation:${this.generation}|${this._encode(descriptor, '', stack)}`;
    }

    token(key) {
        let token = this._tokens.get(key);
        if (!token) {
            token = (this._nextToken++).toString(36);
            this._tokens.set(key, token);
        }
        return token;
    }

    clear() {
        this._objectIds = new WeakMap();
        this._symbolIds.clear();
        this._nextObjectId = 1;
        this._tokens.clear();
        this._nextToken = 1;
    }

    _objectIdentity(value) {
        let id = this._objectIds.get(value);
        if (!id) {
            id = this._nextObjectId++;
            this._objectIds.set(value, id);
        }
        return id;
    }

    _encode(value, field, stack) {
        if (value === null) return 'null';
        if (value === undefined) return 'undefined';
        const type = typeof value;
        if (type === 'string') return `string:${JSON.stringify(value)}`;
        if (type === 'boolean') return value ? 'boolean:true' : 'boolean:false';
        if (type === 'number') {
            if (Number.isNaN(value)) return 'number:NaN';
            if (Object.is(value, -0)) return 'number:-0';
            return `number:${String(value)}`;
        }
        if (type === 'bigint') return `bigint:${value.toString()}`;
        if (type === 'symbol') return `symbol:${this._symbolIdentity(value)}`;
        if (type === 'function') return `function:object-${this._objectIdentity(value)}`;

        if (isOpaqueGpuObject(value, field)) {
            return `gpu-object:${gpuObjectKind(value)}:${this._objectIdentity(value)}`;
        }
        if (Array.isArray(value)) {
            return `array:[${value.map(item => this._encode(item, `${field}[]`, stack)).join(',')}]`;
        }
        if (ArrayBuffer.isView(value)) {
            const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
            return `${value.constructor?.name || 'TypedArray'}:${bytesToHex(bytes)}`;
        }
        if (value instanceof ArrayBuffer) {
            return `ArrayBuffer:${bytesToHex(new Uint8Array(value))}`;
        }
        if (value instanceof Date) return `Date:${value.toISOString()}`;
        if (value instanceof Set) {
            const entries = [...value].map(item => this._encode(item, `${field}{set}`, stack)).sort();
            return `Set:{${entries.join(',')}}`;
        }
        if (value instanceof Map) {
            const entries = [...value].map(([key, item]) => [
                this._encode(key, `${field}{key}`, stack),
                this._encode(item, `${field}{value}`, stack),
            ]).sort((a, b) => a[0].localeCompare(b[0]));
            return `Map:{${entries.map(([key, item]) => `${key}=>${item}`).join(',')}}`;
        }

        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            return `opaque-object:${gpuObjectKind(value)}:${this._objectIdentity(value)}`;
        }
        if (stack.has(value)) {
            return `cycle:${this._objectIdentity(value)}`;
        }
        stack.add(value);
        const encoded = Object.keys(value)
            // Only the root descriptor label is diagnostic metadata. Nested
            // dictionaries can legally contain a semantic key named `label`
            // (for example GPUProgrammableStage.constants), so stripping every
            // occurrence can alias two pipelines with different overrides.
            .filter(key => !(field === '' && key === 'label') && value[key] !== undefined)
            .sort()
            .map(key => `${JSON.stringify(key)}:${this._encode(value[key], key, stack)}`)
            .join(',');
        stack.delete(value);
        return `object:{${encoded}}`;
    }

    _symbolIdentity(value) {
        let id = this._symbolIds.get(value);
        if (!id) {
            id = this._nextObjectId++;
            this._symbolIds.set(value, id);
        }
        return id;
    }
}

function isOpaqueGpuObject(value, field) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
    if (field === 'module' || field === 'layout' || field === 'bindGroupLayouts[]') return true;
    return /^GPU[A-Z]/.test(gpuObjectKind(value));
}

function gpuObjectKind(value) {
    const tag = Object.prototype.toString.call(value).slice(8, -1);
    if (tag && tag !== 'Object') return tag;
    return value?.constructor?.name || 'Object';
}

function bytesToHex(bytes) {
    let output = '';
    for (let index = 0; index < bytes.length; index++) {
        output += bytes[index].toString(16).padStart(2, '0');
    }
    return output;
}
