// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { cloneStrictJson, deepFreezeJson } from '../../../core/schema/StrictJsonValue.js';
import { contentHashHex } from '../../../core/math/ChecksumMath.js';
import { canonicalize } from '../../../state/util/canonical.js';
import { validateLanguageEvidence } from './LanguageEvidence.js';

export const ACTOR_TESTIMONY_FORMAT = 'particle-actor-testimony-v1';
export const ACTOR_TESTIMONY_OBSERVATION_FORMAT = 'particle-actor-testimony-observation-v1';
const HASH = /^sha256:[a-f0-9]{64}$/;
const MAX_HOPS = 8;
const KEYS = ['format', 'messageId', 'speakerActorId', 'recipientActorId', 'origin', 'correlationId', 'disclosure', 'uncertainty', 'route', 'authority', 'witnessed', 'independentCorroboration', 'executable'];

function fields(value, keys, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length
        || Object.keys(value).some(key => !keys.includes(key))) throw new TypeError(`${name} has invalid fields`);
}
function id(value, name) {
    if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > 240
        || /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError(`${name} must be a bounded identifier`);
}
function date(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)
        || !Number.isFinite(Date.parse(value))) throw new TypeError('Testimony timestamp must be UTC ISO');
}
const digest = async value => `sha256:${await contentHashHex(canonicalize(value), 'SHA-256')}`;
const correlation = origin => digest(origin.sourceContentHash === null
    ? { kind: origin.kind, sourceId: origin.sourceId, sourceActorId: origin.sourceActorId }
    : { kind: origin.kind, sourceContentHash: origin.sourceContentHash });

function routeEntry(value) {
    fields(value, ['messageId', 'speakerActorId', 'recipientActorId'], 'Testimony route');
    for (const name of ['messageId', 'speakerActorId', 'recipientActorId']) id(value[name], name);
    if (value.speakerActorId === value.recipientActorId) throw new TypeError('Testimony requires a different recipient');
    return value;
}
function select(text, selection) {
    fields(selection, ['start', 'end'], 'Disclosure selection');
    const { start, end } = selection;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > text.length
        || end - start > 4000) throw new RangeError('Disclosure selection must contain 1..4000 UTF-16 units within the available text');
    // Offsets are UTF-16, matching browser text ranges; do not disclose half a character.
    for (const offset of [start, end]) if (offset > 0 && offset < text.length
        && /[\uD800-\uDBFF]/u.test(text[offset - 1]) && /[\uDC00-\uDFFF]/u.test(text[offset])) throw new RangeError('Disclosure selection splits a Unicode character');
    const selected = text.slice(start, end);
    if (!selected.trim()) throw new TypeError('Disclosure selection cannot contain only whitespace');
    return selected;
}
async function seal(body) {
    const value = { ...body, contentHash: await digest(body) };
    if (JSON.stringify(value).length > 16000) throw new RangeError('Testimony exceeds 16000 JSON characters');
    return deepFreezeJson(value);
}

/**
 * Pure, bounded disclosure of a language observation. selection is a mandatory
 * UTF-16 [start,end) range in evidence.text (the reviewed reading when present).
 * Original OCR/transcript details and unselected text stay with the evidence owner.
 * Source IDs must identify stable source records, never generic input channels.
 * Correlation groups shared source content, or stable source ID + attributed author;
 * different correlation IDs do NOT establish independent corroboration.
 * Hashes identify content, not authenticated authorship or proof of source access.
 * This helper does not send, store, approve, execute, or grant disclosure permission.
 */
export async function prepareActorTestimony(input) {
    const value = cloneStrictJson(input, '$.testimonyInput');
    fields(value, ['messageId', 'speakerActorId', 'recipientActorId', 'evidence', 'selection'], 'Testimony input');
    const hop = routeEntry({ messageId: value.messageId, speakerActorId: value.speakerActorId, recipientActorId: value.recipientActorId });
    const evidence = validateLanguageEvidence(value.evidence), selected = select(evidence.text, value.selection);
    const review = evidence.provenance.review;
    const origin = { kind: evidence.kind, sourceId: evidence.sourceId, sourceActorId: evidence.sourceActorId,
        observedAt: evidence.observedAt, evidenceRevisionHash: await digest(evidence),
        sourceContentHash: evidence.provenance.ocr?.source?.contentHash ?? null,
        textBasis: review ? 'review' : 'original', review: review ? { actorId: review.actorId, reviewedAt: review.reviewedAt } : null };
    return seal({ format: ACTOR_TESTIMONY_FORMAT, ...hop, origin, correlationId: await correlation(origin),
        disclosure: { text: selected, selection: value.selection, evidenceTextLength: evidence.text.length },
        uncertainty: evidence.uncertainty, route: [hop], authority: 'attributed-testimony',
        witnessed: false, independentCorroboration: false, executable: false });
}

/** Validate detached persisted testimony. Integrity hashes are not signatures. */
export async function validateActorTestimony(input) {
    const value = cloneStrictJson(input, '$.testimony');
    fields(value, [...KEYS, 'contentHash'], 'Testimony');
    if (JSON.stringify(value).length > 16000) throw new RangeError('Testimony exceeds 16000 JSON characters');
    if (value.format !== ACTOR_TESTIMONY_FORMAT || value.authority !== 'attributed-testimony' || value.witnessed !== false
        || value.independentCorroboration !== false || value.executable !== false) throw new TypeError('Testimony cannot acquire witnessing, corroboration or execution authority');
    const current = routeEntry({ messageId: value.messageId, speakerActorId: value.speakerActorId, recipientActorId: value.recipientActorId });
    const origin = value.origin;
    fields(origin, ['kind', 'sourceId', 'sourceActorId', 'observedAt', 'evidenceRevisionHash', 'sourceContentHash', 'textBasis', 'review'], 'Testimony origin');
    if (!['typed', 'ocr', 'transcript'].includes(origin.kind) || !HASH.test(origin.evidenceRevisionHash)
        || (origin.sourceContentHash !== null && (origin.kind !== 'ocr' || !HASH.test(origin.sourceContentHash)))) throw new TypeError('Testimony source binding is invalid');
    id(origin.sourceId, 'sourceId'); if (origin.sourceActorId !== null) id(origin.sourceActorId, 'sourceActorId'); date(origin.observedAt);
    if (origin.review !== null) {
        fields(origin.review, ['actorId', 'reviewedAt'], 'Testimony review'); id(origin.review.actorId, 'review actorId'); date(origin.review.reviewedAt);
    }
    if (origin.textBasis !== (origin.review ? 'review' : 'original')) throw new TypeError('Testimony reading basis is inconsistent');
    const disclosure = value.disclosure;
    fields(disclosure, ['text', 'selection', 'evidenceTextLength'], 'Testimony disclosure');
    fields(disclosure.selection, ['start', 'end'], 'Disclosure selection');
    const { start, end } = disclosure.selection;
    if (typeof disclosure.text !== 'string' || !disclosure.text.trim() || disclosure.text.length > 4000
        || !Number.isSafeInteger(disclosure.evidenceTextLength) || disclosure.evidenceTextLength < 1 || disclosure.evidenceTextLength > 32000
        || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end > disclosure.evidenceTextLength
        || end - start !== disclosure.text.length) throw new TypeError('Testimony disclosure bounds are invalid');
    fields(value.uncertainty, ['requiresReview', 'quantityReviewRequired', 'reasons'], 'Testimony uncertainty');
    const uncertainty = value.uncertainty;
    if (typeof uncertainty.requiresReview !== 'boolean' || typeof uncertainty.quantityReviewRequired !== 'boolean'
        || (uncertainty.quantityReviewRequired && !uncertainty.requiresReview) || !Array.isArray(uncertainty.reasons)
        || uncertainty.reasons.length > 16 || new Set(uncertainty.reasons).size !== uncertainty.reasons.length
        || uncertainty.reasons.some(reason => typeof reason !== 'string' || !/^[a-z-]{1,64}$/.test(reason))) throw new TypeError('Testimony uncertainty is invalid');
    if (!Array.isArray(value.route) || !value.route.length || value.route.length > MAX_HOPS) throw new RangeError(`Testimony route must contain 1..${MAX_HOPS} reports`);
    const messages = new Set();
    for (let index = 0; index < value.route.length; index++) {
        const hop = routeEntry(value.route[index]);
        if (messages.has(hop.messageId) || (index > 0 && value.route[index - 1].recipientActorId !== hop.speakerActorId)) throw new TypeError('Testimony route is discontinuous or repeats a message');
        messages.add(hop.messageId);
    }
    if (canonicalize(value.route.at(-1)) !== canonicalize(current)) throw new TypeError('Testimony immediate speaker does not match its route');
    if (value.correlationId !== await correlation(origin)) throw new TypeError('Testimony source correlation changed');
    const { contentHash, ...body } = value;
    if (!HASH.test(contentHash) || contentHash !== await digest(body)) throw new TypeError('Testimony content hash mismatch');
    return deepFreezeJson(value);
}

/** Relay only an explicitly selected range of the previous report, preserving origin and uncertainty. */
export async function relayActorTestimony(input) {
    const value = cloneStrictJson(input, '$.relayInput');
    fields(value, ['messageId', 'speakerActorId', 'recipientActorId', 'testimony', 'selection'], 'Relay input');
    const hop = routeEntry({ messageId: value.messageId, speakerActorId: value.speakerActorId, recipientActorId: value.recipientActorId });
    const previous = await validateActorTestimony(value.testimony);
    if (hop.speakerActorId !== previous.recipientActorId) throw new TypeError('Only the attributed recipient may relay this report');
    if (previous.route.length >= MAX_HOPS || previous.route.some(entry => entry.messageId === hop.messageId)) throw new RangeError('Testimony route is full or repeats a message');
    const text = select(previous.disclosure.text, value.selection), base = previous.disclosure.selection.start;
    const { contentHash: _previousHash, ...body } = previous;
    return seal({ ...body, ...hop, disclosure: { text,
        selection: { start: base + value.selection.start, end: base + value.selection.end }, evidenceTextLength: previous.disclosure.evidenceTextLength },
        route: [...previous.route, hop] });
}

/** Create a private recipient observation. Repeated reports retain one source correlation, never extra witnesses. */
export async function receiveActorTestimony(input) {
    const value = cloneStrictJson(input, '$.receivedTestimony');
    fields(value, ['actorId', 'testimony'], 'Recipient input'); id(value.actorId, 'actorId');
    const testimony = await validateActorTestimony(value.testimony);
    if (testimony.recipientActorId !== value.actorId) throw new TypeError('Testimony belongs to a different recipient');
    return deepFreezeJson({ format: ACTOR_TESTIMONY_OBSERVATION_FORMAT, actorId: value.actorId, visibility: 'actor-private',
        attribution: { speakerActorId: testimony.speakerActorId, origin: testimony.origin, correlationId: testimony.correlationId },
        authority: 'attributed-testimony', witnessed: false, independentCorroboration: false, executable: false, testimony });
}
