// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Inline performance tags in a script, in the widely used bracket style:
 *
 *   [calm] Welcome back. [excited] We did it! [pause] [whispers] Don't tell.
 *
 * A style tag applies to the text that follows it until the next style tag
 * (or `[neutral]`, which clears it). Event tags act where they appear:
 * `[pause]` / `[pause:1.5s]` / `[pause:400ms]` insert silence, `[breath]` and
 * `[sigh]` insert the synthesizer's breath sound. Tags this voice cannot
 * perform (for example `[laughs]`) are reported as unsupported and removed —
 * never read aloud and never faked.
 */
import { EXPRESSION_DESCRIPTORS } from '../model/ExpressionPrompt.js';

/** Delivery words people write as tags, mapped onto the descriptor vocabulary. */
export const TAG_ALIASES = Object.freeze({
    whispers: 'whisper', whispering: 'whisper', softly: 'soft', quietly: 'quiet', shouts: 'loud', shouting: 'loud', loudly: 'loud',
    slowly: 'slow', quickly: 'fast', happily: 'happy', sadly: 'sad', excitedly: 'excited', calmly: 'calm', warmly: 'warm',
    seriously: 'serious', cheerfully: 'cheerful', angrily: 'angry', flatly: 'flat', deadpan: 'flat', gently: 'gentle',
});
export const TAG_EVENTS = Object.freeze(['pause', 'breath', 'sigh', 'neutral']);
const MAX_PAUSE_MS = 5000, DEFAULT_PAUSE_MS = 600;

/** The style words a tag stands for, or null when it is not a style tag. */
export function styleWordOf(tag) {
    const word = TAG_ALIASES[tag] ?? tag;
    return EXPRESSION_DESCRIPTORS[word] ? word : null;
}

/**
 * @param {string} script
 * @returns {{segments: Array<{kind: 'speech', text: string, style: string[]} | {kind: 'pause', ms: number} | {kind: 'breath'}>, unsupported: string[]}}
 */
export function parseScriptTags(script) {
    if (typeof script !== 'string') throw new TypeError('A script must be text');
    const segments = [], unsupported = [];
    let style = [], cursor = 0;
    const pushText = (text) => { if (text.trim()) segments.push(Object.freeze({ kind: 'speech', text: text.trim(), style: Object.freeze([...style]) })); };
    const pattern = /\[([a-z][a-z ]{0,30}?)(?::\s*(\d+(?:\.\d+)?)\s*(ms|s)?)?\]/gi;
    let match;
    while ((match = pattern.exec(script))) {
        pushText(script.slice(cursor, match.index));
        cursor = match.index + match[0].length;
        const tag = match[1].trim().toLowerCase().replace(/\s+/g, ' ');
        if (tag === 'pause') {
            const amount = match[2] === undefined ? DEFAULT_PAUSE_MS : Number(match[2]) * (match[3]?.toLowerCase() === 'ms' ? 1 : 1000);
            segments.push(Object.freeze({ kind: 'pause', ms: Math.min(MAX_PAUSE_MS, Math.max(50, Math.round(amount))) }));
        } else if (tag === 'breath' || tag === 'sigh') segments.push(Object.freeze({ kind: 'breath' }));
        else if (tag === 'neutral') style = [];
        else {
            const words = tag.split(' ').map(styleWordOf);
            if (words.every(Boolean)) style = words;
            else unsupported.push(tag);
        }
    }
    pushText(script.slice(cursor));
    return Object.freeze({ segments: Object.freeze(segments), unsupported: Object.freeze([...new Set(unsupported)]) });
}

/** Tags the demo offers as one-click inserts, in display order. */
export const SCRIPT_TAG_PALETTE = Object.freeze(['whispers', 'excited', 'calm', 'sad', 'serious', 'slowly', 'quickly', 'softly', 'shouts', 'pause', 'breath', 'neutral']);
