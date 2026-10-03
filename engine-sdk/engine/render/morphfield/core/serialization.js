// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { failMorphField } from './errors.js';

export const MORPHFIELD_CANONICAL_LIMITS = Object.freeze({
  MAXIMUM_DEPTH: 128,
  MAXIMUM_NODES: 1_000_000,
});

export function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Compare identifiers by ECMAScript UTF-16 code-unit order. Unlike
 * localeCompare(), this ordering is independent of the host locale and ICU
 * version, so packed Fieldlet indices remain reproducible across machines.
 */
export function compareCanonicalStrings(left, right) {
  const a = String(left);
  const b = String(right);
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function canonicalLimit(options, key, fallback) {
  const configured = Number(options?.[key] ?? fallback);
  if (!Number.isSafeInteger(configured) || configured < 0 || configured > fallback) {
    failMorphField('CANONICAL_LIMIT_RANGE', `${key} must be an integer no greater than ${fallback}`, {
      key,
      configured,
      maximum: fallback,
    });
  }
  return configured;
}

function createCanonicalState(options) {
  return {
    active: new WeakSet(),
    maximumDepth: canonicalLimit(options, 'maximumDepth', MORPHFIELD_CANONICAL_LIMITS.MAXIMUM_DEPTH),
    maximumNodes: canonicalLimit(options, 'maximumNodes', MORPHFIELD_CANONICAL_LIMITS.MAXIMUM_NODES),
    nodes: 0,
  };
}

function visitCanonicalNode(state, path, depth) {
  if (depth > state.maximumDepth) {
    failMorphField('JSON_DEPTH_LIMIT', `Value at ${path} exceeds the maximum canonical depth of ${state.maximumDepth}`, {
      path,
      depth,
      maximumDepth: state.maximumDepth,
    });
  }
  state.nodes += 1;
  if (state.nodes > state.maximumNodes) {
    failMorphField('JSON_NODE_LIMIT', `Canonical value exceeds the ${state.maximumNodes}-node limit`, {
      path,
      nodes: state.nodes,
      maximumNodes: state.maximumNodes,
    });
  }
}

function ensureCanonicalCapacity(state, additionalNodes, path) {
  if (additionalNodes > state.maximumNodes - state.nodes) {
    failMorphField('JSON_NODE_LIMIT', `Canonical value exceeds the ${state.maximumNodes}-node limit`, {
      path,
      nodes: state.nodes + additionalNodes,
      maximumNodes: state.maximumNodes,
    });
  }
}

function defineCanonicalProperty(target, key, value) {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function canonicalizeInternal(value, path, state, depth) {
  visitCanonicalNode(state, path, depth);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      failMorphField('NON_FINITE_NUMBER', `Non-finite number at ${path}`, { path, value: String(value) });
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol' || value === undefined) {
    failMorphField('NON_SERIALIZABLE_VALUE', `Value at ${path} is not JSON serializable`, {
      path,
      type: typeof value,
    });
  }
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    ensureCanonicalCapacity(state, value.length, path);
    const result = [];
    for (let index = 0; index < value.length; index++) {
      result.push(canonicalizeInternal(value[index], `${path}[${index}]`, state, depth + 1));
    }
    return result;
  }
  if (value instanceof ArrayBuffer) {
    const bytes = new Uint8Array(value);
    ensureCanonicalCapacity(state, bytes.length, path);
    const result = [];
    for (let index = 0; index < bytes.length; index++) {
      result.push(canonicalizeInternal(bytes[index], `${path}[${index}]`, state, depth + 1));
    }
    return result;
  }
  if (state.active.has(value)) {
    failMorphField('CYCLIC_VALUE', `Cyclic value at ${path}`, { path });
  }
  state.active.add(value);
  try {
    if (Array.isArray(value)) {
      ensureCanonicalCapacity(state, value.length, path);
      const result = [];
      for (let index = 0; index < value.length; index++) {
        result.push(canonicalizeInternal(value[index], `${path}[${index}]`, state, depth + 1));
      }
      return result;
    }
    if (!isPlainObject(value)) {
      failMorphField('NON_PLAIN_OBJECT', `Expected a plain object at ${path}`, {
        path,
        constructor: value?.constructor?.name || 'unknown',
      });
    }
    const keys = Object.keys(value);
    ensureCanonicalCapacity(state, keys.length, path);
    keys.sort();
    const result = {};
    for (const key of keys) {
      defineCanonicalProperty(
        result,
        key,
        canonicalizeInternal(value[key], `${path}[${JSON.stringify(key)}]`, state, depth + 1),
      );
    }
    return result;
  } finally {
    state.active.delete(value);
  }
}

export function canonicalize(value, path = '$', options = {}) {
  return canonicalizeInternal(value, path, createCanonicalState(options), 0);
}

export function canonicalStringify(value, options = {}) {
  return JSON.stringify(canonicalize(value, '$', options));
}

export function canonicalParse(text, options = {}) {
  const maximumLength = Number(options.maximumLength ?? 64 * 1024 * 1024);
  if (typeof text !== 'string') failMorphField('EXPECTED_TEXT', 'Expected JSON text');
  if (!Number.isSafeInteger(maximumLength) || maximumLength < 0 || text.length > maximumLength) {
    failMorphField('JSON_SIZE_LIMIT', `JSON text exceeds the ${maximumLength}-character limit`, {
      length: text.length,
      maximumLength,
    });
  }
  try {
    return canonicalize(JSON.parse(text), '$', options);
  } catch (error) {
    if (error?.name === 'MorphFieldError') throw error;
    failMorphField('INVALID_JSON', 'Invalid JSON text', { cause: String(error?.message || error) });
  }
}

export function deepFreeze(value, visited = new WeakSet()) {
  if (value === null || typeof value !== 'object' || visited.has(value)) return value;
  visited.add(value);
  if (!ArrayBuffer.isView(value)) {
    for (const child of Object.values(value)) deepFreeze(child, visited);
    Object.freeze(value);
  }
  return value;
}

export function cloneCanonical(value) {
  return canonicalize(value);
}

export function utf8Encode(text) {
  if (typeof TextEncoder !== 'function') {
    failMorphField('TEXT_ENCODER_UNAVAILABLE', 'TextEncoder is required for MorphField serialization');
  }
  return new TextEncoder().encode(String(text));
}

export function utf8Decode(bytes, options = {}) {
  if (typeof TextDecoder !== 'function') {
    failMorphField('TEXT_DECODER_UNAVAILABLE', 'TextDecoder is required for MorphField serialization');
  }
  try {
    return new TextDecoder('utf-8', { fatal: options.fatal !== false }).decode(bytes);
  } catch (error) {
    failMorphField('INVALID_UTF8', 'MorphField text chunk contains invalid UTF-8', {
      cause: String(error?.message || error),
    });
  }
}
