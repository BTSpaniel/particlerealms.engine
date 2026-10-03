// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Shared strict application path for validated Matter model results. */

import {
  cloneStrictJson,
  isPlainJsonObject,
} from '../../core/schema/StrictJsonValue.js';
import { createMatterState } from '../contracts/MatterContracts.js';

const STATE_PATH = /^(?:conserved|fields|mechanics|structure|environment|derived)(?:\.[A-Za-z][A-Za-z0-9]*)+$/;
const FORBIDDEN_STATE_PATH_PARTS = new Set(['__proto__', 'prototype', 'constructor']);

function fail(message) {
  throw new TypeError(`MatterModelApplication: ${message}`);
}

function requireStatePath(value, label) {
  if (typeof value !== 'string' || !STATE_PATH.test(value)) fail(`${label} has invalid state-path syntax`);
  if (value.split('.').some(part => FORBIDDEN_STATE_PATH_PARTS.has(part))) {
    fail(`${label} contains a forbidden prototype segment`);
  }
  return value;
}

function normalizeResult(input) {
  const result = cloneStrictJson(input, '$.matterModelResult');
  if (!isPlainJsonObject(result)) fail('model result must be a plain object');
  for (const key of Object.keys(result)) {
    if (!['status', 'mutations', 'externalDelta', 'invalidatedPaths', 'diagnostics'].includes(key)) {
      fail(`model result '${key}' is unsupported`);
    }
  }
  if (!['applied', 'unsupported'].includes(result.status)) fail('model result status is unsupported');
  if (!Array.isArray(result.mutations)) fail('model result mutations must be an array');
  if (!Array.isArray(result.invalidatedPaths)) fail('model result invalidatedPaths must be an array');
  for (const [index, mutation] of result.mutations.entries()) {
    if (!isPlainJsonObject(mutation)) fail(`mutation ${index} must be a plain object`);
    const keys = Object.keys(mutation);
    if (keys.length !== 2 || !keys.includes('path') || !keys.includes('value')) {
      fail(`mutation ${index} must contain only path and value`);
    }
    requireStatePath(mutation.path, `mutation ${index} path`);
  }
  for (const [index, path] of result.invalidatedPaths.entries()) {
    requireStatePath(path, `invalidated path ${index}`);
  }
  if (result.status === 'unsupported' && result.mutations.length > 0) {
    fail('unsupported model results cannot mutate state');
  }
  return result;
}

function setStatePath(target, path, value) {
  const parts = path.split('.');
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    if (!Object.hasOwn(cursor, part)) cursor[part] = {};
    if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) {
      fail(`mutation path '${path}' crosses a non-object field`);
    }
    cursor = cursor[part];
  }
  cursor[parts.at(-1)] = cloneStrictJson(value, `$.matterModelResult.mutation.${path}`);
}

/**
 * Apply one registry-validated result without mutating its state or result.
 * Schedulers may defer the revision increment until their whole atomic pass ends.
 */
export function applyMatterModelResult(stateInput, resultInput, { advanceRevision = true } = {}) {
  if (typeof advanceRevision !== 'boolean') fail('advanceRevision must be boolean');
  const state = createMatterState(stateInput);
  const result = normalizeResult(resultInput);
  if (result.status === 'unsupported') return state;
  if (advanceRevision && state.revision === Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`MatterModelApplication: region '${state.regionId}' revision cannot advance`);
  }

  const next = cloneStrictJson(state, '$.matterState');
  for (const mutation of result.mutations) setStatePath(next, mutation.path, mutation.value);
  if (result.invalidatedPaths.length > 0) {
    const dirtyPaths = new Set(next.derived?.dirtyPaths ?? []);
    for (const path of result.invalidatedPaths) dirtyPaths.add(path);
    next.derived = { dirtyPaths: [...dirtyPaths].sort() };
  }
  if (advanceRevision) next.revision += 1;
  return createMatterState(next);
}

export default applyMatterModelResult;
