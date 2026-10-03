// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { cloneStrictJson, deepFreezeJson } from '../../../core/schema/StrictJsonValue.js';
import { canonicalize } from '../../../state/util/canonical.js';

export const LANGUAGE_EVIDENCE_FORMAT = 'particle-language-evidence-v1';
export const ACTOR_LANGUAGE_OBSERVATION_FORMAT = 'particle-actor-language-observation-v1';
const HASH = /^sha256:[a-f0-9]{64}$/;
const QUANTITY = /\d|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|hundred|thousand|half|quarter|dozen)\b/i;

function text(value, name, limit = 32000) {
    if (typeof value !== 'string' || !value.trim() || value.length > limit) throw new TypeError(`${name} must contain 1..${limit} characters`);
    return value;
}
function identifier(value, name) {
    text(value, name, 240);
    if (value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) throw new TypeError(`${name} must be a trimmed identifier`);
    return value;
}
function timestamp(value, name) {
    text(value, name, 40);
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw new TypeError(`${name} must be a UTC ISO timestamp`);
    return value;
}
function exact(value, keys, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new TypeError(`${name} contains unsupported fields`);
}

/** Shared owner guard: synchronous void/true assertions are supported; false and asynchronous assertions fail closed. */
export function assertLanguageEvidenceScope(assertCurrent = null) {
    if (assertCurrent === null) return;
    if (typeof assertCurrent !== 'function') throw new TypeError('Language scope assertion must be a function');
    const result = assertCurrent();
    if (result?.then) {
        void Promise.resolve(result).catch(() => {});
        throw new TypeError('Language scope assertion must be synchronous');
    }
    if (result === false) throw new Error('Language scope is no longer current');
}

/** Shared matching normalization only; original wording and spoken-number meaning remain intact. */
export function normalizeConceptPhrase(value) {
    return text(value, 'phrase').normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
}

function ocrReasons(value, sourceId) {
    const reasons = [];
    if (value.format === 'factory.document-text.v1') {
        if (value.source?.sourceId !== sourceId || !HASH.test(value.source?.contentHash)
            || !Array.isArray(value.pages) || !value.pages.length || value.pages.length > 8
            || typeof value.coverage?.complete !== 'boolean' || typeof value.coverage?.truncated !== 'boolean'
            || !Array.isArray(value.coverage?.readPages) || !Number.isSafeInteger(value.coverage?.pageCount)
            || value.coverage.pageCount < 1 || typeof value.reviewRequired !== 'boolean'
            || !Number.isSafeInteger(value.uncertainGlyphs) || value.uncertainGlyphs < 0) throw new TypeError('OCR document evidence is incomplete');
        const selected = new Set(value.coverage.readPages);
        if (selected.size !== value.pages.length || selected.size !== value.coverage.readPages.length
            || value.pages.some(page => !selected.has(page.pageNumber) || !Number.isSafeInteger(page.pageNumber)
                || page.pageNumber < 1 || page.pageNumber > value.coverage.pageCount
                || page.source?.sourceId !== sourceId || page.source?.contentHash !== value.source.contentHash
                || page.source?.pageNumber !== page.pageNumber || typeof page.reviewRequired !== 'boolean'
                || !['ocr', 'embedded-text'].includes(page.method) || typeof page.text !== 'string')) throw new TypeError('OCR pages do not match their source or coverage');
        if (value.coverage.complete && (value.coverage.truncated || value.pages.length !== value.coverage.pageCount)) throw new TypeError('OCR complete coverage is inconsistent');
        if (!value.coverage.complete || value.coverage.truncated) reasons.push('partial-document');
        if (value.reviewRequired || value.uncertainGlyphs || value.pages.some(page => page.reviewRequired || page.uncertainGlyphs > 0)) reasons.push('uncertain-recognition');
        if (value.pages.some(page => page.unresolvedReadings?.length)) reasons.push('unresolved-readings');
        if (value.issues?.length || value.pages.some(page => page.issues?.length)) reasons.push('reading-issues');
    } else if (value.schema === 'factory.ocr.v1') {
        if (value.sourceId !== sourceId || typeof value.reviewRequired !== 'boolean' || value.coordinateUnit !== 'image-pixels'
            || !Array.isArray(value.glyphs) || !Array.isArray(value.words) || !Array.isArray(value.unresolvedReadings)
            || value.scoreKind !== 'cosine-similarity-uncalibrated') throw new TypeError('OCR glyph evidence is incomplete');
        if (value.reviewRequired || value.glyphs.some(glyph => glyph.accepted !== true) || value.words.some(word => word.uncertain)) reasons.push('uncertain-recognition');
        if (value.unresolvedReadings.length) reasons.push('unresolved-readings');
        if (value.issues?.length) reasons.push('reading-issues');
    } else throw new TypeError('Unsupported OCR evidence format');
    return reasons;
}

/**
 * Source-preserving ingress. Input is strict JSON: kind, sourceId, observedAt,
 * optional sourceActorId and exactly one of text / ocr / transcript. Transcript
 * records require {text,isFinal,providerId}; all provider fields are preserved.
 * Optional review {actorId,text,reviewedAt} corrects text without rewriting source.
 * OCR similarity and transcript confidence retain their original representation;
 * neither becomes probability or world truth. Every result is observation-only.
 */
export function createLanguageEvidence(input) {
    const value = cloneStrictJson(input, '$.languageInput');
    exact(value, ['kind', 'sourceId', 'sourceActorId', 'observedAt', 'text', 'ocr', 'transcript', 'review'], 'language input');
    if (!['typed', 'ocr', 'transcript'].includes(value.kind)) throw new TypeError('Unknown language source kind');
    identifier(value.sourceId, 'sourceId');
    timestamp(value.observedAt, 'observedAt');
    const sourceActorId = value.sourceActorId ?? null;
    if (sourceActorId !== null) identifier(sourceActorId, 'sourceActorId');
    const payloadName = value.kind === 'typed' ? 'text' : value.kind;
    if (['text', 'ocr', 'transcript'].some(key => key !== payloadName && Object.hasOwn(value, key))) throw new TypeError('Language source payloads cannot be mixed');
    let originalText, reasons = [];
    if (value.kind === 'typed') originalText = text(value.text, 'typed text');
    if (value.kind === 'ocr') {
        if (!value.ocr || typeof value.ocr !== 'object') throw new TypeError('OCR evidence is required');
        originalText = text(value.ocr.text, 'OCR text');
        reasons = ocrReasons(value.ocr, value.sourceId);
    }
    if (value.kind === 'transcript') {
        if (!value.transcript || typeof value.transcript.isFinal !== 'boolean') throw new TypeError('Transcript finality is required');
        identifier(value.transcript.providerId, 'transcript providerId');
        originalText = text(value.transcript.text, 'transcript text');
        if (!value.transcript.isFinal) reasons.push('interim-transcript');
        // Provider scores are not enough to establish that a listener heard the words correctly.
        reasons.push('unreviewed-transcript');
    }
    const review = value.review ?? null;
    if (review) {
        exact(review, ['actorId', 'text', 'reviewedAt'], 'review');
        identifier(review.actorId, 'review actorId'); timestamp(review.reviewedAt, 'reviewedAt'); text(review.text, 'review text');
    }
    const selectedText = review?.text ?? originalText;
    const ambiguousText = /[\uFFFD?]|\b(?:unknown|uncertain|approximately|about|maybe)\b/i.test(selectedText);
    if (ambiguousText) reasons.push('ambiguous-wording');
    const requiresReview = ambiguousText || (!review && reasons.length > 0);
    const result = { format: LANGUAGE_EVIDENCE_FORMAT, kind: value.kind, sourceId: value.sourceId, sourceActorId,
        observedAt: value.observedAt, originalText, text: selectedText, normalizedText: normalizeConceptPhrase(selectedText),
        provenance: { ocr: value.ocr ?? null, transcript: value.transcript ?? null, review },
        uncertainty: { requiresReview, quantityReviewRequired: requiresReview && QUANTITY.test(selectedText), reasons },
        authority: 'observation-only', executable: false };
    if (JSON.stringify(result).length > 2_000_000) throw new RangeError('Language evidence exceeds two million JSON characters');
    return deepFreezeJson(result);
}

/** Rebuild derived fields and reject forged authority, text, or uncertainty on persisted input. */
export function validateLanguageEvidence(input) {
    const value = cloneStrictJson(input, '$.languageEvidence');
    exact(value, ['format', 'kind', 'sourceId', 'sourceActorId', 'observedAt', 'originalText', 'text', 'normalizedText', 'provenance', 'uncertainty', 'authority', 'executable'], 'language evidence');
    exact(value.provenance, ['ocr', 'transcript', 'review'], 'language provenance');
    const rebuilt = createLanguageEvidence({ kind: value.kind, sourceId: value.sourceId, sourceActorId: value.sourceActorId,
        observedAt: value.observedAt, [value.kind === 'typed' ? 'text' : value.kind]: value.kind === 'typed' ? value.originalText : value.provenance[value.kind],
        review: value.provenance.review });
    for (const key of ['format', 'originalText', 'text', 'normalizedText', 'authority', 'executable']) if (value[key] !== rebuilt[key]) throw new TypeError(`Language evidence ${key} was changed`);
    if (canonicalize(value.uncertainty) !== canonicalize(rebuilt.uncertainty)
        || canonicalize(value.provenance) !== canonicalize(rebuilt.provenance)) throw new TypeError('Language evidence provenance or uncertainty was changed');
    return rebuilt;
}

/** An actor-private attributed observation; this function neither stores nor broadcasts it. */
export function createActorLanguageObservation({ actorId, evidence } = {}) {
    identifier(actorId, 'actorId');
    const reading = validateLanguageEvidence(evidence);
    return deepFreezeJson({ format: ACTOR_LANGUAGE_OBSERVATION_FORMAT, actorId, visibility: 'actor-private',
        attribution: { sourceId: reading.sourceId, sourceActorId: reading.sourceActorId, observedAt: reading.observedAt },
        authority: 'attributed-observation', executable: false, evidence: reading });
}
