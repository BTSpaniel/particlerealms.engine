// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Authored identities for the existing articulatory renderer, not trained speakers.
 * Pitch and tract size are separate controls; neither alone certifies a perceived
 * voice identity. Values are bounded project calibrations, not population norms.
 * https://pubmed.ncbi.nlm.nih.gov/19525544/
 */
import { DEFAULT_ARTICULATION_CONFIG } from './ArticulationHead.js';
import { DEFAULT_PROSODY_CONFIG } from './ProsodyPlanner.js';
import { DEFAULT_TRACT_CONFIG } from '../articulatory/ParticleTract.js';

export const DEFAULT_VOICE_PRESET = 'american-male';
const source = Object.freeze({
    openQuotient: DEFAULT_ARTICULATION_CONFIG.openQuotient,
    peakQuotient: DEFAULT_ARTICULATION_CONFIG.peakQuotient,
    returnQuotient: DEFAULT_ARTICULATION_CONFIG.returnQuotient,
    voicedAspiration: DEFAULT_ARTICULATION_CONFIG.voicedAspiration,
    fricationAmplitude: DEFAULT_ARTICULATION_CONFIG.fricationAmplitude,
});
export const VOICE_PRESETS = Object.freeze([
    Object.freeze({ id: DEFAULT_VOICE_PRESET, label: 'American male', locale: 'en-US',
        kind: 'authored-articulatory', experimental: true, learnedModel: false,
        model: Object.freeze({ numSections: DEFAULT_TRACT_CONFIG.numSections, nasalSections: DEFAULT_TRACT_CONFIG.nasalSections }),
        prosody: Object.freeze({ baseF0Hz: DEFAULT_PROSODY_CONFIG.baseF0Hz }), articulation: source }),
    // At 64 kHz a section is ~0.55 cm: 27 sections is a ~14.8 cm tract, raising
    // formants ~18% over the 32-section default, near reported adult male/female
    // ratios; the nasal branch scales with it. The source is breathier with a
    // longer open phase and a slightly softer return (steeper spectral tilt).
    Object.freeze({ id: 'american-female', label: 'American female', locale: 'en-US',
        kind: 'authored-articulatory', experimental: true, learnedModel: false,
        model: Object.freeze({ numSections: 27, nasalSections: 20 }),
        prosody: Object.freeze({ baseF0Hz: 205 }),
        articulation: Object.freeze({ ...source, openQuotient: 0.68, returnQuotient: 0.016, voicedAspiration: 0.04 }) }),
]);

/** Resolve a known immutable preset; never silently substitute an unknown voice. */
export function getVoicePreset(id = DEFAULT_VOICE_PRESET) {
    const preset = VOICE_PRESETS.find((entry) => entry.id === id);
    if (!preset) throw new RangeError(`Unknown authored voice preset: ${String(id)}`);
    return preset;
}
