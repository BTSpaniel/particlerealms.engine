// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const DESIGN_TOKEN_SCHEMA = 'plauna.design-tokens.v1';
export const DESIGN_TOKEN_SCHEMA_VERSION = 1;

export class UnsupportedDesignTokenVersionError extends Error {
  constructor(version) {
    super(`Unsupported design token schema version: ${version}`);
    this.name = 'UnsupportedDesignTokenVersionError';
    this.version = version;
  }
}

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
}

function cloneTokenValue(value, path, seen) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`Design token ${path} must be finite`);
    return value;
  }
  if (seen.has(value)) throw new TypeError(`Design token ${path} contains a cycle`);
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map((item, index) => cloneTokenValue(item, `${path}[${index}]`, seen));
  } else {
    assertRecord(value, `Design token ${path}`);
    result = {};
    for (const [key, item] of Object.entries(value)) {
      if (!key || key === '__proto__' || key === 'prototype' || key === 'constructor') {
        throw new TypeError(`Design token ${path} contains unsafe key ${key}`);
      }
      result[key] = cloneTokenValue(item, path ? `${path}.${key}` : key, seen);
    }
  }
  seen.delete(value);
  return result;
}

/** Accept legacy raw token maps and return a canonical, safely cloned v1 envelope. */
export function prepareDesignTokenDocument(input) {
  assertRecord(input, 'Design token document');
  let source = input;
  if (input.schema !== undefined) {
    if (input.schema !== DESIGN_TOKEN_SCHEMA) throw new Error(`Unsupported design token schema: ${input.schema}`);
    const version = input.schemaVersion ?? DESIGN_TOKEN_SCHEMA_VERSION;
    if (version !== DESIGN_TOKEN_SCHEMA_VERSION) throw new UnsupportedDesignTokenVersionError(version);
    const payloadKeys = Object.keys(input).filter((key) => key !== 'schema' && key !== 'schemaVersion');
    if (payloadKeys.length === 1 && payloadKeys[0] === 'tokens') {
      source = input.tokens;
      assertRecord(source, 'Design token payload');
    } else {
      source = Object.fromEntries(payloadKeys.map((key) => [key, input[key]]));
    }
  } else if (input.schemaVersion !== undefined && input.schemaVersion !== DESIGN_TOKEN_SCHEMA_VERSION) {
    throw new UnsupportedDesignTokenVersionError(input.schemaVersion);
  }
  const tokens = cloneTokenValue(source, '', new Set());
  return {
    schema: DESIGN_TOKEN_SCHEMA,
    schemaVersion: DESIGN_TOKEN_SCHEMA_VERSION,
    tokens,
  };
}

/** Emit metadata additively so legacy readers still see token categories at the root. */
export function createDesignTokenExport(input) {
  const prepared = prepareDesignTokenDocument(input);
  return {
    ...prepared.tokens,
    schema: DESIGN_TOKEN_SCHEMA,
    schemaVersion: DESIGN_TOKEN_SCHEMA_VERSION,
  };
}
