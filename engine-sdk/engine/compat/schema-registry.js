// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * schema-registry.js — validate a compatibility profile before boot.
 *
 * Self-contained: a tiny JSON-Schema-subset checker (type / required / enum /
 * properties / items / additionalProperties) plus `validateProfile()` which also
 * applies cross-field consistency rules (e.g. GPU pipelines imply uses.webgpu).
 *
 * The bootloader calls this via `ctx.validate`; Package Studio can call
 * `engine.compat.validateProfile(profile)` to preview problems before compiling.
 */

import { COMPAT_SCHEMAS, appProfileSchema } from './schemas.js';

export class CompatSchemaRegistry {
    constructor() { this._schemas = new Map(Object.entries(COMPAT_SCHEMAS)); }
    define(name, schema) { this._schemas.set(name, schema); return this; }
    get(name) { return this._schemas.get(name) ?? null; }
    list() { return [...this._schemas.keys()]; }
    validate(name, data) {
        const schema = this.get(name);
        if (!schema) return { valid: false, errors: [`unknown schema "${name}"`] };
        const errors = [];
        checkNode(data, schema, name, errors);
        return { valid: errors.length === 0, errors };
    }
}

export const compatSchemas = new CompatSchemaRegistry();

/**
 * Validate a full compatibility profile: structural schema + consistency rules.
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateProfile(profile) {
    const errors = [];
    const warnings = [];
    checkNode(profile, appProfileSchema, 'profile', errors);

    // Cross-field consistency (warnings unless they indicate a real conflict).
    if (profile && typeof profile === 'object') {
        const g = profile.gpu ?? {};
        const u = profile.uses ?? {};
        if ((g.usesCompute || g.usesRenderPipelines || g.requestsDevice) && !u.webgpu) {
            warnings.push('GPU usage detected but uses.webgpu is false');
        }
        if (g.presentation === 'webgpu-canvas' && !u.webgpu) {
            warnings.push('presentation=webgpu-canvas but uses.webgpu is false');
        }
        for (const el of profile.dom?.requiredElements ?? []) {
            if (el.tag && el.tag.toLowerCase() === 'canvas' && !u.webgpu && !u.canvas2d) {
                warnings.push(`required <canvas#${el.id}> but no canvas/webgpu usage detected`);
            }
        }
    }

    return { valid: errors.length === 0, errors, warnings };
}

// ── Tiny JSON-Schema-subset checker ───────────────────────────────────────────

function checkNode(data, schema, path, errors) {
    if (!schema) return;

    // type (string or array of strings; 'null' supported)
    if (schema.type) {
        const types = Array.isArray(schema.type) ? schema.type : [schema.type];
        if (!types.some(t => isType(data, t))) {
            errors.push(`${path}: expected ${types.join('|')}, got ${typeName(data)}`);
            return; // further checks meaningless on a type mismatch
        }
    }

    if (schema.enum && !schema.enum.includes(data)) {
        errors.push(`${path}: "${data}" not in [${schema.enum.join(', ')}]`);
    }

    if (isObject(data)) {
        for (const key of schema.required ?? []) {
            if (!(key in data) || data[key] === undefined) errors.push(`${path}: missing required "${key}"`);
        }
        const props = schema.properties ?? {};
        for (const [key, sub] of Object.entries(props)) {
            if (key in data && data[key] !== undefined) checkNode(data[key], sub, `${path}.${key}`, errors);
        }
        if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
            const known = new Set(Object.keys(props));
            for (const [key, val] of Object.entries(data)) {
                if (!known.has(key)) checkNode(val, schema.additionalProperties, `${path}.${key}`, errors);
            }
        }
    }

    if (Array.isArray(data) && schema.items) {
        data.forEach((item, i) => checkNode(item, schema.items, `${path}[${i}]`, errors));
    }
}

function isType(v, t) {
    switch (t) {
        case 'string':  return typeof v === 'string';
        case 'number':  return typeof v === 'number' && !Number.isNaN(v);
        case 'integer': return Number.isInteger(v);
        case 'boolean': return typeof v === 'boolean';
        case 'object':  return isObject(v);
        case 'array':   return Array.isArray(v);
        case 'null':    return v === null;
        case 'any':     return true;
        default:        return false;
    }
}

function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

function typeName(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    return typeof v;
}
