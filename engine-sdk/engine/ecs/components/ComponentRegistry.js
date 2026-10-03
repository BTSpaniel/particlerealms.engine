// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { COMPONENT_SCHEMAS, validateComponent, createDefaultComponent, registerComponentSchema, getRegisteredSchemaNames } from "../EntitySchema.js";

const registryByName = new Map();

function cloneDeep(value) {
  if (Array.isArray(value)) {
    const out = new Array(value.length);
    for (let i = 0; i < value.length; i++) {
      out[i] = cloneDeep(value[i]);
    }
    return out;
  }
  if (value && typeof value === "object") {
    const out = {};
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      out[key] = cloneDeep(value[key]);
    }
    return out;
  }
  return value;
}

function mergeDefaults(target, source) {
  if (!source || typeof source !== "object") {
    return target;
  }
  const keys = Object.keys(source);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const value = source[key];
    if (value === undefined) {
      continue;
    }
    target[key] = value;
  }
  return target;
}

export function defineComponentType(config) {
  if (!config || typeof config !== "object") {
    throw new Error("defineComponentType: config object is required");
  }
  const name = config.name;
  if (!name || typeof name !== "string") {
    throw new Error("defineComponentType: name must be a non-empty string");
  }
  if (registryByName.has(name)) {
    throw new Error("defineComponentType: component already defined: " + name);
  }

  const version =
    typeof config.version === "number" && config.version > 0
      ? config.version
      : 1;

  const defaults = config.defaults ? cloneDeep(config.defaults) : {};

  const normalizeFn =
    typeof config.normalize === "function"
      ? config.normalize
      : function normalize(input) {
          if (!input || typeof input !== "object") {
            return cloneDeep(defaults);
          }
          const base = cloneDeep(defaults);
          return mergeDefaults(base, input);
        };

  const validateFn =
    typeof config.validate === "function" ? config.validate : null;

  function create(initial) {
    let value = normalizeFn(initial);
    if (validateFn) {
      value = validateFn(value);
    }
    return value;
  }

  const def = {
    name,
    version,
    defaults,
    create,
    normalize: normalizeFn,
    validate: validateFn,
    migrate:
      typeof config.migrate === "function"
        ? config.migrate
        : function migrate(data) {
            return data;
          },
  };

  registryByName.set(name, def);
  
  // Auto-register schema if provided in config
  if (config.schema) {
    registerComponentSchema(config.schema);
  }
  
  return def;
}

export function getComponentDefinition(name) {
  return registryByName.get(name) || null;
}

export function listComponentDefinitions() {
  return Array.from(registryByName.values());
}

/**
 * Get schema for a component from EntitySchema
 */
export function getComponentSchema(name) {
  return COMPONENT_SCHEMAS[name] || null;
}

/**
 * Validate component using EntitySchema
 */
export function validateComponentSchema(name, value) {
  return validateComponent(name, value);
}

/**
 * Create default component using EntitySchema
 */
export function createDefaultFromSchema(name) {
  return createDefaultComponent(name);
}

/**
 * Register a custom component schema (re-export from EntitySchema)
 */
export { registerComponentSchema, getRegisteredSchemaNames };
