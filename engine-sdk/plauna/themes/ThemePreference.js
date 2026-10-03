// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { validateThemeId } from './ThemeContracts.js';

export const LEGACY_THEME_STORAGE_KEY = 'plauna-theme';
export const FILE_THEME_STORAGE_KEY = 'plauna-theme-id-v1';
export const COLOR_MODE_STORAGE_KEY = 'plauna-color-mode-v1';

function storageOrNull(storage) {
    try { return storage ?? globalThis.localStorage; } catch { return null; }
}

/**
 * Expand legacy state into both namespaced keys without contracting the old
 * key. Older tabs may still be reading it during a rolling browser rollout.
 */
export function migrateLegacyThemePreference(storage) {
    const target = storageOrNull(storage);
    if (!target) return;
    try {
        const legacy = target.getItem(LEGACY_THEME_STORAGE_KEY);
        if (!legacy) return;
        let fileTheme;
        let colorMode;
        if (legacy === 'bright') {
            fileTheme = 'light';
            colorMode = 'bright';
        } else if (legacy === 'night') {
            fileTheme = 'dark';
            colorMode = 'night';
        } else {
            fileTheme = validateThemeId(legacy);
            colorMode = legacy === 'light' ? 'bright' : 'night';
        }
        if (!target.getItem(FILE_THEME_STORAGE_KEY)) target.setItem(FILE_THEME_STORAGE_KEY, fileTheme);
        if (!target.getItem(COLOR_MODE_STORAGE_KEY)) target.setItem(COLOR_MODE_STORAGE_KEY, colorMode);
    } catch (error) {
        console.warn('[PlaunaTheme] Legacy theme preference migration failed:', error);
    }
}

export function readFileThemePreference(storage) {
    const target = storageOrNull(storage);
    if (!target) return null;
    migrateLegacyThemePreference(target);
    try {
        const value = target.getItem(FILE_THEME_STORAGE_KEY);
        return value ? validateThemeId(value) : null;
    } catch { return null; }
}

export function writeFileThemePreference(value, storage) {
    const target = storageOrNull(storage);
    if (!target) return;
    const themeId = validateThemeId(value);
    target.setItem(FILE_THEME_STORAGE_KEY, themeId);
}

export function readColorModePreference(storage) {
    const target = storageOrNull(storage);
    if (!target) return null;
    migrateLegacyThemePreference(target);
    try {
        const value = target.getItem(COLOR_MODE_STORAGE_KEY);
        return value === 'bright' || value === 'night' ? value : null;
    } catch { return null; }
}

export function writeColorModePreference(value, storage) {
    if (value !== 'bright' && value !== 'night') throw new TypeError(`Invalid Plauna color mode: ${value}`);
    const target = storageOrNull(storage);
    if (!target) return;
    target.setItem(COLOR_MODE_STORAGE_KEY, value);
    // ThemeController historically owned the ambiguous key. Keep that one
    // legacy writer during the rollback window so file-theme writes cannot
    // race it with a different value vocabulary.
    try { target.setItem(LEGACY_THEME_STORAGE_KEY, value); } catch { /* best-effort old-tab compatibility */ }
}
