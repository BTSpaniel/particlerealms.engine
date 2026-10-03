// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SpellConfig.js — local stub for the external spell configuration system.
 */

export const SPELL_CATEGORIES = Object.freeze({
    combat: 'combat',
    utility: 'utility',
    defense: 'defense',
    healing: 'healing',
});

export const SPELL_PRESETS = Object.freeze({
    fireball: { id: 'fireball', name: 'Fireball', category: 'combat', params: {} },
});

export const SPELL_PARAM_SCHEMA = Object.freeze({
    color: { type: 'color', default: '#ff5500' },
    radius: { type: 'number', default: 1.0, min: 0.1, max: 10.0 },
    speed: { type: 'number', default: 1.0, min: 0.0, max: 10.0 },
});

export function cloneSpellConfig(id) {
    const preset = SPELL_PRESETS[id] || { id, name: id, category: 'combat', params: {} };
    return JSON.parse(JSON.stringify(preset));
}

export function rgbToHex(r, g, b) {
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export function hexToRgb(hex) {
    const val = parseInt(hex.replace('#', ''), 16);
    return { r: (val >> 16) & 0xff, g: (val >> 8) & 0xff, b: val & 0xff };
}
