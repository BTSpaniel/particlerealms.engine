// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * schemas.js — declarative schemas for the compatibility profile and its parts.
 *
 * Kept as plain JS descriptors (not .json) so the engine module is self-contained
 * and needs no fetch. Validated by `schema-registry.js`'s tiny checker, which
 * supports: type, required, enum, properties, items, additionalProperties.
 */

export const permissionsSchema = {
    type: 'object',
    // Permission map: capability → boolean. Open-ended keys, boolean values.
    additionalProperties: { type: 'boolean' },
};

export const domSchema = {
    type: 'object',
    required: ['requiredElements'],
    properties: {
        requiredElements: {
            type: 'array',
            items: {
                type: 'object',
                required: ['id'],
                properties: {
                    id:     { type: 'string' },
                    tag:    { type: 'string' },
                    width:  { type: 'number' },
                    height: { type: 'number' },
                },
            },
        },
    },
};

export const gpuSchema = {
    type: 'object',
    properties: {
        requestsDevice:      { type: 'boolean' },
        usesCompute:         { type: 'boolean' },
        usesRenderPipelines: { type: 'boolean' },
        usesStorageBuffers:  { type: 'boolean' },
        usesCopySrc:         { type: 'boolean' },
        usesTimestamp:       { type: 'boolean' },
        presentation:        { type: 'string', enum: ['webgpu-canvas', 'canvas-2d', 'engine-texture', 'offscreen', 'none'] },
        workerModule:        { type: 'string' },
        workerProfile:       { type: 'string' },
        workerDeviceOptions: { type: 'object', additionalProperties: true },
        presentationOptions: { type: 'object', additionalProperties: true },
        textureFormat:       { type: 'string' },
    },
};

export const usesSchema = {
    type: 'object',
    additionalProperties: { type: 'boolean' },
};

export const healingSchema = {
    type: 'object',
    additionalProperties: { type: 'boolean' },
};

export const importsSchema = {
    type: 'object',
    properties: {
        // Bare-specifier → URL pins (exact or trailing-slash prefix).
        map: { type: 'object', additionalProperties: { type: 'string' } },
        // CDN base for unmapped bare specifiers (null disables the fallback).
        cdn: { type: ['string', 'null'] },
    },
};

export const appProfileSchema = {
    type: 'object',
    required: ['format', 'id', 'sourceType', 'uses', 'dom'],
    properties: {
        format:     { type: 'string', enum: ['compat-profile-v1'] },
        id:         { type: 'string' },
        name:       { type: 'string' },
        version:    { type: 'string' },
        // 'realm' = shared-origin light DOM (fast, shares GPU); 'iframe' = opaque
        // sandboxed origin (hard isolation for untrusted apps).
        isolation:  { type: 'string', enum: ['realm', 'iframe'] },
        sourceType: { type: 'string', enum: ['package', 'single-file-html', 'multi-file-web', 'compat'] },
        sourceHash: { type: ['string', 'null'] },
        liveSource: { type: ['string', 'null'] },
        createdAt:  { type: 'string' },
        uses:        usesSchema,
        dom:         domSchema,
        gpu:         gpuSchema,
        healing:     healingSchema,
        permissions: permissionsSchema,
        imports:     importsSchema,
    },
};

export const COMPAT_SCHEMAS = {
    'compat.AppProfile':  appProfileSchema,
    'compat.Dom':         domSchema,
    'compat.Gpu':         gpuSchema,
    'compat.Uses':        usesSchema,
    'compat.Permissions': permissionsSchema,
};
