// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const SMART_CONTEXT_ASSIST_FORMAT = 'plauna-smart-context-assist';
export const SMART_CONTEXT_ASSIST_VERSION = 1;

const ROOT_KEYS = new Set(['format', 'version', 'target', 'cursor']);
const TARGET_KEYS = new Set(['id', 'type', 'role']);
const CURSOR_KEYS = new Set(['x', 'y']);
const SEMANTIC_ID_PATTERN = /^[A-Za-z0-9_.:#/-]{1,160}$/;
const SEMANTIC_KIND_PATTERN = /^[A-Za-z0-9_.:-]{1,80}$/;

function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed) {
    return Object.keys(value).every(key => allowed.has(key));
}

function semanticToken(value, pattern) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string') return null;
    const token = value.trim();
    return pattern.test(token) ? token : null;
}

function semanticCoordinate(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.round(Math.min(1_000_000, Math.max(-1_000_000, number)));
}

function freezeDescriptor(target, cursor) {
    return Object.freeze({
        format: SMART_CONTEXT_ASSIST_FORMAT,
        version: SMART_CONTEXT_ASSIST_VERSION,
        target: Object.freeze(target),
        cursor: Object.freeze(cursor),
    });
}

/** Build a content-free descriptor directly from a Plauna semantic node. */
export function createSmartContextAssistDescriptor(node = null, cursor = null) {
    return freezeDescriptor({
        id: semanticToken(node?.id, SEMANTIC_ID_PATTERN),
        type: semanticToken(node?.type, SEMANTIC_KIND_PATTERN),
        role: semanticToken(node?.role, SEMANTIC_KIND_PATTERN),
    }, {
        x: semanticCoordinate(cursor?.x),
        y: semanticCoordinate(cursor?.y),
    });
}

/**
 * Validate an untrusted assist payload at the receiving app boundary.
 * Unknown fields are rejected so content, labels, DOM handles, or authority
 * cannot hitchhike beside the semantic identity.
 */
export function normalizeSmartContextAssistDescriptor(value) {
    if (!isRecord(value) || !hasOnlyKeys(value, ROOT_KEYS)) return null;
    if (value.format !== SMART_CONTEXT_ASSIST_FORMAT || value.version !== SMART_CONTEXT_ASSIST_VERSION) return null;
    if (!isRecord(value.target) || !hasOnlyKeys(value.target, TARGET_KEYS)) return null;
    if (!isRecord(value.cursor) || !hasOnlyKeys(value.cursor, CURSOR_KEYS)) return null;
    const id = semanticToken(value.target.id, SEMANTIC_ID_PATTERN);
    const type = semanticToken(value.target.type, SEMANTIC_KIND_PATTERN);
    const role = semanticToken(value.target.role, SEMANTIC_KIND_PATTERN);
    if ((value.target.id != null && value.target.id !== '' && id === null)
        || (value.target.type != null && value.target.type !== '' && type === null)
        || (value.target.role != null && value.target.role !== '' && role === null)) return null;
    if (!Number.isFinite(value.cursor.x) || !Number.isFinite(value.cursor.y)) return null;
    return freezeDescriptor({ id, type, role }, {
        x: semanticCoordinate(value.cursor.x),
        y: semanticCoordinate(value.cursor.y),
    });
}

export function buildSmartContextReviewPrompt(value) {
    const descriptor = normalizeSmartContextAssistDescriptor(value);
    if (!descriptor) return '';
    const tokens = [
        descriptor.target.type ? `type=${descriptor.target.type}` : '',
        descriptor.target.role ? `role=${descriptor.target.role}` : '',
        descriptor.target.id ? `id=${descriptor.target.id}` : '',
    ].filter(Boolean);
    const target = tokens.length ? tokens.join(', ') : 'desktop-surface';
    return `Review this OS interface target and explain what it is, what I can do with it, and one safe next step. Semantic target: ${target}; cursor=(${descriptor.cursor.x},${descriptor.cursor.y}). Do not execute anything or infer hidden content.`;
}
