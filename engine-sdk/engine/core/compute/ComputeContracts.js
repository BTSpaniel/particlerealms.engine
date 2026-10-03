// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { JsonSchemaValidator } from '../schema/JsonSchemaValidator.js';
import { isPlainJsonObject } from '../schema/StrictJsonValue.js';
import { ComputeError } from './ComputeErrors.js';
import { COMPUTE_CONTRACTS } from './ComputeContractSchemas.generated.js';
export { COMPUTE_CONTRACTS, COMPUTE_CONTRACT_SCHEMA_VERSION, COMPUTE_CONTRACT_SOURCE_HASH } from './ComputeContractSchemas.generated.js';

const byId = new Map(Object.values(COMPUTE_CONTRACTS).map(schema => [schema.$id, schema]));
const validator = new JsonSchemaValidator(id => byId.get(id) ?? null);
const compiled = new Map();
const typedPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedGet = name => Object.getOwnPropertyDescriptor(typedPrototype, name).get;
const getBuffer = typedGet('buffer'), getLength = typedGet('length'), getBytes = typedGet('byteLength');
const getTag = Object.getOwnPropertyDescriptor(typedPrototype, Symbol.toStringTag).get;
const arrayBufferBytes = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
const TYPES = new Map([['Uint8Array', 'u8'], ['Uint8ClampedArray', 'u8clamped'], ['Int8Array', 'i8'],
    ['Uint16Array', 'u16'], ['Int16Array', 'i16'], ['Uint32Array', 'u32'], ['Int32Array', 'i32'],
    ['Float32Array', 'f32'], ['Float64Array', 'f64']]);

/** Read immutable canonical metadata. Schema version is independent of ABI/operation/storage versions. */
export function getComputeContract(name) {
    if (typeof name !== 'string') return null;
    const [base, ...fragments] = name.split('#');
    const root = Object.hasOwn(COMPUTE_CONTRACTS, base) ? COMPUTE_CONTRACTS[base] : byId.get(base);
    if (!root || fragments.length > 1) return null;
    if (!fragments.length || !fragments[0]) return root;
    if (!fragments[0].startsWith('/')) return null;
    let schema = root;
    for (const part of fragments[0].slice(1).split('/')) {
        const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
        if (!schema || typeof schema !== 'object' || !Object.hasOwn(schema, key)) return null;
        schema = schema[key];
    }
    // Validate through the owning document so local refs retain their root scope.
    return Object.freeze({ $ref: `${root.$id}#${fragments[0]}` });
}

/** Validate a JSON metadata projection using only bundled, local references. */
export function validateComputeContract(name, value) {
    const schema = getComputeContract(name);
    if (!schema) return { valid: false, errors: [`Unknown compute contract: ${String(name).slice(0, 128)}`] };
    try {
        if (!compiled.has(name)) compiled.set(name, validator.compile(schema));
        return compiled.get(name).validate(value);
    } catch (error) {
        return { valid: false, errors: error.errors || ['Invalid compiled compute contract'] };
    }
}

/** Preserve the caller's input; failures use the compute boundary's stable error category. */
export function assertComputeContract(name, value, { code = 'COMPUTE_INVALID_INPUT' } = {}) {
    const result = validateComputeContract(name, value);
    if (!result.valid) throw new ComputeError(code, `Invalid compute ${name}: ${result.errors.slice(0, 3).join('; ').slice(0, 2048)}`);
    return value;
}

/**
 * Produce bounded validation metadata, never a transport encoding or binary copy.
 * Accessors/unsupported host objects/cycles are rejected. Native byte lengths and
 * element types come from intrinsics; caller properties cannot spoof native identity.
 */
export function projectComputeContractValue(value, { maxNodes = 100000, maxDepth = 64, maxBytes = 8 * 1024 * 1024 } = {}) {
    for (const limit of [maxNodes, maxDepth, maxBytes]) if (!Number.isSafeInteger(limit) || limit <= 0)
        throw new ComputeError('COMPUTE_INVALID_INPUT', 'Invalid compute projection limit');
    let nodes = 0, bytes = 0;
    const active = new Set();
    const fail = message => { throw new ComputeError('COMPUTE_INVALID_INPUT', message); };
    const visit = (item, depth) => {
        if (++nodes > maxNodes || depth > maxDepth) fail('Compute metadata traversal limit exceeded');
        bytes += typeof item === 'string' ? item.length * 2 + 16 : 32;
        if (bytes > maxBytes) fail('Compute metadata byte limit exceeded');
        if (item === null || typeof item === 'boolean' || typeof item === 'string') return item;
        if (typeof item === 'number') {
            if (Number.isFinite(item) && !Object.is(item, -0)) return item;
            return { $computeType: 'number', value: Object.is(item, -0) ? '-0' : String(item) };
        }
        if (item === undefined) return { $computeType: 'undefined' };
        if (ArrayBuffer.isView(item)) {
            let buffer, length, byteLength, dtype;
            try { buffer = getBuffer.call(item); length = getLength.call(item); byteLength = getBytes.call(item); dtype = TYPES.get(getTag.call(item)); }
            catch (_) { fail('Unsupported native compute view'); }
            if (!dtype) fail('Unsupported compute element type');
            // The original typed array remains untouched. Shared input copying has
            // its own runtime admission rule; schema projection does not authorize it.
            if (!buffer || !Number.isSafeInteger(byteLength) || !Number.isSafeInteger(length)) fail('Invalid native compute view');
            return { $computeType: 'typed-array', dtype, byteLength, length };
        }
        try { return { $computeType: 'array-buffer', byteLength: arrayBufferBytes.call(item) }; }
        catch (_) { /* Not an ArrayBuffer; only ordinary metadata is permitted below. */ }
        if (!Array.isArray(item) && !isPlainJsonObject(item)) fail('Unsupported compute metadata value');
        if (active.has(item)) fail('Cyclic compute metadata');
        active.add(item);
        const array = Array.isArray(item), keys = Reflect.ownKeys(item);
        if (keys.length > maxNodes - nodes + 1 || array && item.length > maxNodes - nodes) fail('Compute metadata traversal limit exceeded');
        const result = array ? [] : {};
        if (array && keys.length !== item.length + 1) fail('Compute metadata arrays must be dense');
        for (const key of keys) {
            if (array && key === 'length') continue;
            if (typeof key !== 'string' || key === '__proto__' || key === 'constructor' || key === 'prototype') fail('Unsupported compute metadata key');
            if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= item.length)) fail('Unexpected compute array property');
            const property = Object.getOwnPropertyDescriptor(item, key);
            if (!property || !property.enumerable || !Object.hasOwn(property, 'value')) fail('Compute metadata accessors are forbidden');
            bytes += key.length * 2;
            if (bytes > maxBytes) fail('Compute metadata byte limit exceeded');
            if (!array && property.value === undefined) continue;
            result[key] = visit(property.value, depth + 1);
        }
        active.delete(item);
        return result;
    };
    return visit(value, 0);
}
