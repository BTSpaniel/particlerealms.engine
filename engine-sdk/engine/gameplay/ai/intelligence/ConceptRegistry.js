// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { cloneStrictJson, deepFreezeJson } from '../../../core/schema/StrictJsonValue.js';
import { contentHashHex } from '../../../core/math/ChecksumMath.js';
import { canonicalize } from '../../../state/util/canonical.js';
import { normalizeConceptPhrase, assertLanguageEvidenceScope } from './LanguageEvidence.js';

export const CONCEPT_REFERENCE_FORMAT = 'particle-concept-reference-v1';
export const LEXICON_SNAPSHOT_FORMAT = 'particle-language-lexicon-v1';
const HASH = /^sha256:[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;
const VERSION = /^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,63}$/;

function exact(value, keys, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length
        || Object.keys(value).some(key => !keys.includes(key))) throw new TypeError(`${name} has invalid fields`);
}

/** Exact immutable provider binding. A hash identifies content, never permission. */
export function validateConceptReference(input) {
    const reference = cloneStrictJson(input, '$.conceptReference');
    exact(reference, ['providerId', 'definitionId', 'version', 'contentHash'], 'Concept reference');
    if (![reference.providerId, reference.definitionId, reference.version, reference.contentHash].every(value => typeof value === 'string')
        || !ID.test(reference.providerId) || !ID.test(reference.definitionId) || !VERSION.test(reference.version)
        || !HASH.test(reference.contentHash)) throw new TypeError('Concept reference requires provider, definition, version and SHA-256');
    return deepFreezeJson(reference);
}

const identity = reference => `${reference.providerId}/${reference.definitionId}@${reference.version}`;
const matchesReference = (left, right) => canonicalize(left) === canonicalize(right);

function reviewedDefinition(value, reference) {
    if (value === null || value === undefined) return null;
    const record = cloneStrictJson(value, '$.reviewedConcept');
    exact(record, ['reference', 'label', 'aliases', 'reviewed', 'reviewReceiptId'], 'Reviewed concept');
    if (!matchesReference(validateConceptReference(record.reference), reference)) throw new TypeError('Concept provider returned a different definition');
    if (record.reviewed !== true) return null;
    if (typeof record.reviewReceiptId !== 'string' || !record.reviewReceiptId.trim() || record.reviewReceiptId.length > 240
        || typeof record.label !== 'string' || !record.label.trim() || record.label.length > 240
        || !Array.isArray(record.aliases) || !record.aliases.length || record.aliases.length > 64) throw new TypeError('Concept lacks reviewed label, aliases or receipt');
    record.aliases = record.aliases.map(alias => {
        if (typeof alias !== 'string' || alias.length > 120) throw new TypeError('Concept alias exceeds 120 characters');
        return normalizeConceptPhrase(alias);
    });
    if (new Set(record.aliases).size !== record.aliases.length) throw new TypeError('Concept aliases must be unique after normalization');
    record.aliases.sort();
    return deepFreezeJson(record);
}

function lexiconSnapshot(input) {
    const snapshot = cloneStrictJson(input, '$.lexiconSnapshot');
    exact(snapshot, ['format', 'providerId', 'version', 'words', 'provenance'], 'Lexicon snapshot');
    if (snapshot.format !== LEXICON_SNAPSHOT_FORMAT || typeof snapshot.providerId !== 'string' || typeof snapshot.version !== 'string'
        || !ID.test(snapshot.providerId) || !VERSION.test(snapshot.version)
        || !Array.isArray(snapshot.words) || snapshot.words.length > 500000 || !snapshot.provenance
        || typeof snapshot.provenance !== 'object' || Array.isArray(snapshot.provenance)) throw new TypeError('Lexicon snapshot identity or bounds are invalid');
    let previous = null;
    for (const word of snapshot.words) {
        if (typeof word !== 'string' || word.length > 120 || normalizeConceptPhrase(word) !== word
            || /\s/u.test(word) || (previous !== null && previous >= word)) throw new TypeError('Lexicon keys must be normalized, sorted and unique');
        previous = word;
    }
    if (JSON.stringify(snapshot.provenance).length > 32000) throw new RangeError('Lexicon provenance is too large');
    return deepFreezeJson(snapshot);
}

/** SHA-256 of canonical strict JSON, including source provenance and sorted keys. */
export async function hashLexiconSnapshot(input) {
    return `sha256:${await contentHashHex(canonicalize(lexiconSnapshot(input)), 'SHA-256')}`;
}

function aliasSpans(text, alias) {
    const spans = [];
    let start = text.indexOf(alias);
    while (start !== -1) {
        const before = text.slice(Math.max(0, start - 2), start);
        const after = text.slice(start + alias.length, start + alias.length + 2);
        if (!/[\p{L}\p{N}_]$/u.test(before) && !/^[\p{L}\p{N}_]/u.test(after)) spans.push({ start, end: start + alias.length });
        if (spans.length > 4096) throw new RangeError('Concept matching exceeds 4096 spans');
        start = text.indexOf(alias, start + 1);
    }
    return spans;
}

function spellingResult(input) {
    const result = cloneStrictJson(input, '$.spellingResult');
    exact(result, ['word', 'available', 'found', 'reference', 'meaning', 'executable'], 'Spelling result');
    if (typeof result.word !== 'string' || !result.word || [...result.word].length > 512
        || typeof result.available !== 'boolean' || (result.available ? typeof result.found !== 'boolean' : result.found !== null)
        || result.meaning !== 'spelling-membership-only' || result.executable !== false) throw new TypeError('Spelling resource must return bounded membership-only data');
    if (result.available) {
        exact(result.reference, ['providerId', 'version', 'contentHash', 'count', 'provenance'], 'Spelling reference');
        const reference = result.reference;
        if (typeof reference.providerId !== 'string' || !ID.test(reference.providerId) || typeof reference.version !== 'string' || !VERSION.test(reference.version)
            || !HASH.test(reference.contentHash) || !Number.isSafeInteger(reference.count) || reference.count < 0
            || !reference.provenance || typeof reference.provenance !== 'object' || Array.isArray(reference.provenance)
            || JSON.stringify(reference.provenance).length > 32000) throw new TypeError('Spelling resource provenance is invalid');
    } else if (result.reference !== null) throw new TypeError('Unavailable spelling resource cannot claim a verified reference');
    return deepFreezeJson(result);
}

/**
 * Non-persistent semantic index. resolveDefinition(reference) is an injected,
 * trusted owner callback: it verifies immutable content and a separate review
 * receipt, then returns {reference,label,aliases,reviewed,reviewReceiptId} or null.
 * Every matching lookup rechecks that owner; callers cannot self-approve data.
 * Optional loadLexicon() returns {snapshot,contentHash}; no dictionary is loaded
 * until lookupWord(), and hash verification precedes actual Set membership.
 * Alternatively, spellingResource.lookupWord(rawWord,options) delegates to an
 * injected verified resource using its own normalization. The resource retains
 * loading/disposal ownership. It must return the same membership-only result
 * shape as lookupWord(); neither resource choice becomes a semantic dictionary.
 * All returned data is deeply frozen; this index grants no execution authority.
 */
export function createConceptRegistry({ resolveDefinition, loadLexicon = null, spellingResource = null, onDiagnostic = null } = {}) {
    if (typeof resolveDefinition !== 'function') throw new TypeError('Concept registry requires an owner resolver');
    if (loadLexicon !== null && typeof loadLexicon !== 'function') throw new TypeError('Lexicon loader must be a function');
    if (spellingResource !== null && typeof spellingResource.lookupWord !== 'function') throw new TypeError('Spelling resource requires lookupWord');
    if (spellingResource !== null && loadLexicon !== null) throw new TypeError('Select one spelling resource or lexicon loader');
    if (onDiagnostic !== null && typeof onDiagnostic !== 'function') throw new TypeError('Diagnostic callback must be a function');
    const concepts = new Map();
    let closed = false, lexicon = null, loading = null;
    const diagnostic = (stage, details = {}) => { try { onDiagnostic?.(Object.freeze({ stage, ...details })); } catch { /* Observability does not change admission. */ } };
    const check = ({ signal = null, assertCurrent = null } = {}) => {
        if (closed) throw new Error('Concept registry is closed');
        signal?.throwIfAborted(); assertLanguageEvidenceScope(assertCurrent);
    };
    async function resolveOwner(reference, options) {
        check(options);
        const resolved = await resolveDefinition(reference, options);
        check(options);
        return reviewedDefinition(resolved, reference);
    }
    async function publishReviewedConcept(input, options = {}) {
        const reference = validateConceptReference(input);
        check(options);
        diagnostic('concept-review-start', { providerId: reference.providerId });
        const record = await resolveOwner(reference, options);
        if (!record) throw new Error('Concept definition is missing or not reviewed');
        const key = identity(reference), previous = concepts.get(key);
        if (previous && !matchesReference(previous.reference, reference)) throw new Error('Published concept version is immutable; remove its old reference first');
        if (!previous && concepts.size >= 1024) throw new RangeError('Concept registry capacity reached');
        concepts.set(key, record);
        diagnostic('concept-published', { providerId: reference.providerId, count: concepts.size });
        return record;
    }
    async function resolve(text, options = {}) {
        check(options);
        const normalizedText = normalizeConceptPhrase(text), matches = [];
        for (const [key, original] of [...concepts]) {
            if (!original.aliases.some(alias => aliasSpans(normalizedText, alias).length)) continue;
            const current = await resolveOwner(original.reference, options);
            // A concurrent remove/republication or a revoked review cannot publish a stale match.
            if (!current || concepts.get(key) !== original) continue;
            for (const alias of current.aliases) for (const span of aliasSpans(normalizedText, alias)) {
                if (matches.length >= 4096) throw new RangeError('Concept matching exceeds 4096 candidates');
                matches.push({ reference: current.reference, label: current.label, alias, span, reviewReceiptId: current.reviewReceiptId });
            }
        }
        check(options);
        matches.sort((a, b) => {
            const spanOrder = a.span.start - b.span.start || b.span.end - a.span.end;
            if (spanOrder) return spanOrder;
            const left = identity(a.reference), right = identity(b.reference);
            return left < right ? -1 : left > right ? 1 : 0;
        });
        const ambiguousSpans = [];
        for (const match of matches) {
            if (matches.some(other => other !== match && identity(other.reference) !== identity(match.reference)
                && other.span.start < match.span.end && match.span.start < other.span.end)
                && !ambiguousSpans.some(span => span.start === match.span.start && span.end === match.span.end)) ambiguousSpans.push(match.span);
        }
        diagnostic('concept-resolved', { matches: matches.length, ambiguities: ambiguousSpans.length });
        return deepFreezeJson({ normalizedText, matches, ambiguousSpans, authority: 'concept-candidates', executable: false });
    }
    async function ensureLexicon(options) {
        check(options);
        if (lexicon || !loadLexicon) return lexicon;
        if (!loading) {
            diagnostic('lexicon-load-start');
            loading = (async () => {
                const loaded = cloneStrictJson(await loadLexicon(), '$.lexiconEnvelope');
                check();
                exact(loaded, ['snapshot', 'contentHash'], 'Lexicon envelope');
                if (!loaded || !HASH.test(loaded.contentHash)) throw new TypeError('Lexicon loader must provide a pinned SHA-256');
                const snapshot = lexiconSnapshot(loaded.snapshot);
                if (`sha256:${await contentHashHex(canonicalize(snapshot), 'SHA-256')}` !== loaded.contentHash) throw new Error('Lexicon snapshot hash mismatch');
                check();
                lexicon = { words: new Set(snapshot.words), reference: deepFreezeJson({ providerId: snapshot.providerId,
                    version: snapshot.version, contentHash: loaded.contentHash, count: snapshot.words.length, provenance: snapshot.provenance }) };
                diagnostic('lexicon-load-complete', { count: snapshot.words.length });
                return lexicon;
            })().catch(error => { diagnostic('lexicon-load-failed', { code: error.name }); throw error; }).finally(() => { loading = null; });
        }
        const loaded = await loading;
        check(options);
        return loaded;
    }
    async function lookupWord(word, options = {}) {
        check(options);
        if (spellingResource) {
            if (typeof word !== 'string' || !word || [...word].length > 512) throw new TypeError('Spelling lookup requires a bounded word');
            const result = await spellingResource.lookupWord(word, options);
            check(options);
            return spellingResult(result);
        }
        const normalized = normalizeConceptPhrase(word);
        if (normalized.length > 120 || /\s/u.test(normalized)) throw new TypeError('Lexicon lookup requires one bounded word');
        const loaded = await ensureLexicon(options);
        check(options);
        return deepFreezeJson({ word: normalized, available: loaded !== null, found: loaded ? loaded.words.has(normalized) : null,
            reference: loaded?.reference ?? null, meaning: 'spelling-membership-only', executable: false });
    }
    return Object.freeze({ publishReviewedConcept, resolve, lookupWord,
        remove(input) { check(); const reference = validateConceptReference(input), key = identity(reference), current = concepts.get(key); return current && matchesReference(current.reference, reference) ? concepts.delete(key) : false; },
        snapshot() { check(); return deepFreezeJson([...concepts.values()]); },
        close() { if (!closed) { closed = true; concepts.clear(); lexicon = null; diagnostic('closed'); } },
    });
}
