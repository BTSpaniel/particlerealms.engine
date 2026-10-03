// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Fail-closed cloning and freezing for finite, data-only JSON values. */

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const ARRAY_INDEX = /^(0|[1-9]\d*)$/;

function fail(path, message) {
    throw new TypeError(`${path}: ${message}`);
}

export function isPlainJsonObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function primitive(value, path) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) fail(path, 'numbers must be finite');
        return value;
    }
    if (typeof value !== 'object') fail(path, 'must contain JSON data only');
    return undefined;
}

function arrayDescriptors(value, path) {
    const indexes = [];
    for (const key of Reflect.ownKeys(value)) {
        if (key === 'length') continue;
        if (typeof key !== 'string' || !ARRAY_INDEX.test(key)) {
            fail(path, 'custom array fields are not supported');
        }
        const index = Number(key);
        if (!Number.isSafeInteger(index) || index >= value.length) {
            fail(path, 'custom array fields are not supported');
        }
        indexes.push(index);
    }
    if (indexes.length !== value.length) fail(path, 'sparse arrays are not supported');
    indexes.sort((left, right) => left - right);

    const descriptors = [];
    for (let index = 0; index < indexes.length; index += 1) {
        if (indexes[index] !== index) fail(`${path}[${index}]`, 'sparse arrays are not supported');
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor?.enumerable) fail(`${path}[${index}]`, 'non-enumerable fields are not supported');
        if (!Object.hasOwn(descriptor, 'value')) fail(`${path}[${index}]`, 'accessors are not supported');
        descriptors.push(descriptor);
    }
    return descriptors;
}

/** Inspect a dense data-only JSON array without reading accessor values. */
export function strictJsonArrayDescriptors(value, path = '$') {
    if (!Array.isArray(value)) fail(String(path), 'must be an array');
    return arrayDescriptors(value, String(path));
}

function objectDescriptors(value, path) {
    if (!isPlainJsonObject(value)) fail(path, 'objects must use a plain prototype');
    const descriptors = [];
    for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string') fail(path, 'symbol keys are not supported');
        if (FORBIDDEN_KEYS.has(key)) fail(`${path}.${key}`, 'forbidden key');
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable) fail(`${path}.${key}`, 'non-enumerable fields are not supported');
        if (!Object.hasOwn(descriptor, 'value')) fail(`${path}.${key}`, 'accessors are not supported');
        descriptors.push([key, descriptor]);
    }
    return descriptors;
}

function cloneValue(value, path, ancestors, freeze = false) {
    const scalar = primitive(value, path);
    if (scalar !== undefined) return scalar;
    if (ancestors.has(value)) fail(path, 'cycles are not supported');
    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            const copy = arrayDescriptors(value, path).map((descriptor, index) => (
                cloneValue(descriptor.value, `${path}[${index}]`, ancestors, freeze)
            ));
            return freeze ? Object.freeze(copy) : copy;
        }
        const copy = {};
        for (const [key, descriptor] of objectDescriptors(value, path)) {
            copy[key] = cloneValue(descriptor.value, `${path}.${key}`, ancestors, freeze);
        }
        return freeze ? Object.freeze(copy) : copy;
    } finally {
        ancestors.delete(value);
    }
}

/** Clone a finite JSON value without invoking accessors or retaining caller objects. */
export function cloneStrictJson(value, path = '$') {
    return cloneValue(value, String(path), new Set());
}

function freezeValue(value, path, ancestors) {
    const scalar = primitive(value, path);
    if (scalar !== undefined) return scalar;
    if (ancestors.has(value)) fail(path, 'cycles are not supported');
    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            for (const [index, descriptor] of arrayDescriptors(value, path).entries()) {
                freezeValue(descriptor.value, `${path}[${index}]`, ancestors);
            }
        } else {
            for (const [key, descriptor] of objectDescriptors(value, path)) {
                freezeValue(descriptor.value, `${path}.${key}`, ancestors);
            }
        }
        return Object.freeze(value);
    } finally {
        ancestors.delete(value);
    }
}

/** Validate and recursively freeze a strict JSON value in place. */
export function deepFreezeJson(value, path = '$') {
    return freezeValue(value, String(path), new Set());
}

/** Clone, validate, and recursively freeze a strict JSON value. */
export function cloneAndFreezeStrictJson(value, path = '$') {
    return cloneValue(value, String(path), new Set(), true);
}
