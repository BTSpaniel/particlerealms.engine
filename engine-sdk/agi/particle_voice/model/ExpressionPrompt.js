// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Expression prompts: "express as" (positive) and "avoid" (negative) words
 * mapped onto the authored synthesis controls that already exist.
 *
 * This is a transparent, deterministic control mapping, not a learned style
 * model. Every recognized word adds a fixed delta on seven axes; the negative
 * prompt applies the inverse at reduced strength (so "avoid robotic" widens the
 * pitch range without inverting it into a caricature). Unknown words are
 * reported, never guessed. The result is ordinary ParticleVoiceModel options,
 * so a receipt shows exactly which parameters an expression changed.
 *
 * Axes: pitch (semitones), range (pitch-excursion multiplier), rate (speech
 * rate multiplier), breath (voiced-aspiration multiplier), tension (open
 * quotient delta; + is laxer/breathier, − is pressed), energy (loudness
 * multiplier) and steadiness (jitter/shimmer multiplier).
 */
import { DEFAULT_PROSODY_CONFIG } from './ProsodyPlanner.js';
import { DEFAULT_ARTICULATION_CONFIG } from './ArticulationHead.js';
import { getVoicePreset } from './VoicePresets.js';

export const EXPRESSION_PROMPT_VERSION = 'expression-prompt-v1';

const D = (values) => Object.freeze(values);
/** Authored descriptor table. Each entry lists only the axes it moves. */
export const EXPRESSION_DESCRIPTORS = Object.freeze({
    warm: D({ pitch: -1, breath: 1.4, tension: 0.02, rate: 0.96 }),
    calm: D({ range: 0.75, rate: 0.9, energy: 0.92 }),
    gentle: D({ range: 0.85, energy: 0.85, breath: 1.3 }),
    soft: D({ energy: 0.8, breath: 1.3 }),
    excited: D({ pitch: 2, range: 1.5, rate: 1.12, energy: 1.15 }),
    happy: D({ pitch: 1.5, range: 1.3, rate: 1.05 }),
    cheerful: D({ pitch: 1.5, range: 1.35 }),
    sad: D({ pitch: -2, range: 0.6, rate: 0.86, energy: 0.85, breath: 1.5 }),
    serious: D({ pitch: -1, range: 0.8, rate: 0.95 }),
    confident: D({ pitch: -0.5, range: 1.1, energy: 1.1, tension: -0.02, breath: 0.7 }),
    angry: D({ pitch: 1, range: 1.3, rate: 1.1, energy: 1.2, tension: -0.05, breath: 0.6 }),
    whisper: D({ breath: 6, energy: 0.7, tension: 0.08, range: 0.7 }),
    breathy: D({ breath: 3, tension: 0.04 }),
    airy: D({ breath: 3, tension: 0.04 }),
    clear: D({ breath: 0.4, tension: -0.02 }),
    crisp: D({ breath: 0.4, tension: -0.03, rate: 1.03 }),
    deep: D({ pitch: -3 }),
    low: D({ pitch: -2 }),
    high: D({ pitch: 3 }),
    bright: D({ pitch: 1.5, tension: -0.02 }),
    slow: D({ rate: 0.85 }),
    fast: D({ rate: 1.15 }),
    loud: D({ energy: 1.2 }),
    quiet: D({ energy: 0.8 }),
    expressive: D({ range: 1.4 }),
    lively: D({ range: 1.35, rate: 1.05 }),
    monotone: D({ range: 0.4 }),
    flat: D({ range: 0.5 }),
    robotic: D({ range: 0.4, steadiness: 0.7 }),
    natural: D({ range: 1.1, steadiness: 1.2 }),
    rough: D({ steadiness: 2 }),
    smooth: D({ steadiness: 0.6 }),
});

/** Safety bounds: no prompt combination may leave the renderer's validated space. */
const BOUNDS = Object.freeze({
    pitch: [-8, 8], range: [0.25, 2.5], rate: [0.6, 1.6], breath: [0, 8], tension: [-0.1, 0.12], energy: [0.6, 1.4], steadiness: [0, 2.5],
});
/** Exclusions push the other way at reduced strength, so "exclude robotic" is livelier, not a caricature. */
const NEGATIVE_STRENGTH = 0.4;
const clamp = (value, [min, max]) => Math.min(max, Math.max(min, value));
const MULTIPLIERS = new Set(['range', 'rate', 'breath', 'energy', 'steadiness']);

function words(prompt) {
    if (prompt === undefined || prompt === null) return [];
    if (typeof prompt !== 'string' || prompt.length > 400) throw new TypeError('Expression prompts must be text of at most 400 characters');
    return prompt.toLowerCase().split(/[^a-z]+/).filter(Boolean);
}

/**
 * @param {{positive?: string, negative?: string, voicePreset?: string, targetRms?: number}} prompt
 * @returns {{modelOptions: object, axes: object, receipt: object}}
 */
export function resolveExpression({ positive = '', negative = '', voicePreset, targetRms = 0.11, pitchScale = 1, rateScale = 1 } = {}) {
    if (![pitchScale, rateScale].every((value) => Number.isFinite(value) && value >= 0.5 && value <= 2)) throw new RangeError('Expression pitch and rate scales must be in [0.5, 2]');
    const preset = getVoicePreset(voicePreset);
    const axes = { pitch: 0, range: 1, rate: 1, breath: 1, tension: 0, energy: 1, steadiness: 1 };
    const applied = [], ignored = [];
    for (const [sign, list] of [[1, words(positive)], [-1, words(negative)]]) {
        for (const word of list) {
            const descriptor = EXPRESSION_DESCRIPTORS[word];
            if (!descriptor) { ignored.push(word); continue; }
            applied.push(sign > 0 ? word : `not ${word}`);
            for (const [axis, value] of Object.entries(descriptor)) {
                if (MULTIPLIERS.has(axis)) axes[axis] *= sign > 0 ? value : value ** -NEGATIVE_STRENGTH;
                else axes[axis] -= sign > 0 ? -value : value * NEGATIVE_STRENGTH;
            }
        }
    }
    for (const axis of Object.keys(axes)) axes[axis] = clamp(axes[axis], BOUNDS[axis]);

    const scaleExcursion = (value) => 1 + (value - 1) * axes.range;
    const prosody = DEFAULT_PROSODY_CONFIG, articulation = { ...DEFAULT_ARTICULATION_CONFIG, ...preset.articulation };
    const prosodyConfig = {
        baseF0Hz: preset.prosody.baseF0Hz * 2 ** (axes.pitch / 12) * pitchScale,
        speechRate: clamp(axes.rate * rateScale, [0.5, 2]),
        declinationRatio: Math.min(0.4, prosody.declinationRatio * axes.range),
        stressF0Scale: Object.fromEntries(Object.entries(prosody.stressF0Scale).map(([key, value]) => [key, scaleExcursion(value)])),
        terminalF0Scale: Object.fromEntries(Object.entries(prosody.terminalF0Scale).map(([key, value]) => [key, Math.max(0.5, scaleExcursion(value))])),
        whQuestionF0Scale: clamp(scaleExcursion(prosody.whQuestionF0Scale), [0.5, 1.5]),
    };
    const articulationConfig = {
        voicedAspiration: Math.min(0.2, articulation.voicedAspiration * axes.breath),
        openQuotient: clamp(articulation.openQuotient + axes.tension, [0.45, 0.8]),
        jitterAmount: Math.min(0.05, articulation.jitterAmount * axes.steadiness),
        shimmerAmount: Math.min(0.12, articulation.shimmerAmount * axes.steadiness),
    };
    const modelOptions = { voicePreset: preset.id, targetRms: clamp(targetRms * axes.energy, [0.05, 0.16]), prosodyConfig, articulationConfig };
    return Object.freeze({
        modelOptions, axes: Object.freeze({ ...axes, pitchScale, rateScale }),
        receipt: Object.freeze({ method: EXPRESSION_PROMPT_VERSION, positive, negative, applied: Object.freeze(applied), ignored: Object.freeze(ignored), kind: 'authored-control-mapping-not-learned-style' }),
    });
}
