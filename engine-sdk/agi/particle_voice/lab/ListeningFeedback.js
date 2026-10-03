// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const LISTENING_FEEDBACK_VERSION = 'particle-voice-listening-feedback-v1';
export const LISTENING_FEEDBACK_LIMITS = Object.freeze({ trialEvents: 64, sessionEvents: 1024, anotherSoundCharacters: 200 });
const CONFIDENCE = new Set(['guessing', 'unsure', 'sure']);
const RATING_FIELDS = new Set(['clarity', 'smoothness', 'naturalness']);
const FLAG_FIELDS = Object.freeze({
    questionProblems: Object.freeze(['misleading-choices', 'another-sound']),
    audioProblems: Object.freeze(['too-quiet', 'clicking', 'cut-off']),
});
const EMPTY = Object.freeze({ confidence: null, clarity: null, smoothness: null, naturalness: null,
    questionProblems: Object.freeze([]), audioProblems: Object.freeze([]), anotherSound: '' });

/** Validate only subjective metadata. No inference, recognition score or legacy rating changes. */
export function validateListeningFeedbackPatch(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.getPrototypeOf(patch) !== Object.prototype) {
        throw new TypeError('Listening feedback must be a plain patch object');
    }
    const result = {};
    for (const key of Reflect.ownKeys(patch)) {
        const property = Object.getOwnPropertyDescriptor(patch, key);
        if (typeof key !== 'string' || !Object.hasOwn(EMPTY, key) || !property.enumerable || !('value' in property)) {
            throw new TypeError('Listening feedback contains an unsupported field');
        }
        const value = property.value;
        if (key === 'confidence') {
            if (value !== null && !CONFIDENCE.has(value)) throw new TypeError('Confidence must be guessing, unsure, sure or unrated');
        } else if (RATING_FIELDS.has(key)) {
            if (value !== null && (!Number.isInteger(value) || value < 1 || value > 5)) throw new RangeError('Feedback ratings must be whole numbers from 1 to 5 or unrated');
        } else if (Object.hasOwn(FLAG_FIELDS, key)) {
            if (!Array.isArray(value) || value.length > FLAG_FIELDS[key].length
                || Reflect.ownKeys(value).some(field => field !== 'length' && !/^(0|[1-9]\d*)$/.test(String(field)))
                || Array.from({ length: value.length }, (_, index) => Object.getOwnPropertyDescriptor(value, String(index)))
                    .some(property => !property || !('value' in property) || !FLAG_FIELDS[key].includes(property.value))
                || new Set(value).size !== value.length) {
                throw new TypeError('Feedback problem flags must be unique supported choices');
            }
        } else if (typeof value !== 'string' || value.length > LISTENING_FEEDBACK_LIMITS.anotherSoundCharacters) {
            throw new RangeError('Another sound must be text of at most 200 characters');
        }
        result[key] = Array.isArray(value) ? Object.freeze(value.slice()) : value;
    }
    return Object.freeze(result);
}

/** Private append-only evidence; callers supply context derived from the session. */
export class ListeningFeedbackHistory {
    #events = [];
    #values = new Map();
    #counts = new Map();

    get size() { return this.#events.length; }

    record(patch, context) {
        const previous = this.#values.get(context.trialIndex) ?? EMPTY;
        const changed = Object.fromEntries(Object.entries(patch).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(previous[key])));
        if (!Object.keys(changed).length) return Object.freeze({ recorded: false, trialIndex: context.trialIndex, values: previous });
        if (this.#events.length >= LISTENING_FEEDBACK_LIMITS.sessionEvents
            || (this.#counts.get(context.trialIndex) ?? 0) >= LISTENING_FEEDBACK_LIMITS.trialEvents) throw new RangeError('This listening session reached its feedback event limit');
        const values = Object.freeze({ ...previous, ...changed });
        const event = Object.freeze({ sequence: this.#events.length + 1, at: new Date().toISOString(), ...context,
            patch: Object.freeze(changed), values });
        this.#events.push(event); this.#values.set(context.trialIndex, values);
        this.#counts.set(context.trialIndex, (this.#counts.get(context.trialIndex) ?? 0) + 1);
        return Object.freeze({ recorded: true, trialIndex: context.trialIndex, values });
    }

    report() {
        return Object.freeze({ schemaVersion: LISTENING_FEEDBACK_VERSION,
            scope: 'subjective-listener-metadata-not-recognition-score', events: Object.freeze(this.#events.slice()) });
    }
}
