// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const THEME_SCHEMA_VERSION = 1;
const THEME_ID_PATTERN = /^_?[a-z0-9][a-z0-9_-]*$/i;
const CSS_VARIABLE_PATTERN = /^--[a-z0-9-]+$/i;

function assertObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`${label} must be an object`);
    }
}

export function validateThemeId(value, label = 'Theme id') {
    if (typeof value !== 'string' || !THEME_ID_PATTERN.test(value)) {
        throw new TypeError(`${label} is invalid`);
    }
    return value;
}

export function prepareThemeVariables(input, { allowNull = true } = {}) {
    assertObject(input, 'Theme variables');
    const variables = {};
    for (const [key, value] of Object.entries(input)) {
        if (!CSS_VARIABLE_PATTERN.test(key)) throw new TypeError(`Invalid CSS variable name: ${key}`);
        if (value === null && allowNull) {
            variables[key] = value;
            continue;
        }
        if (typeof value !== 'string' && typeof value !== 'number') {
            throw new TypeError(`Theme variable ${key} must be a string, number, or null`);
        }
        const serialized = String(value);
        if (/[{};]/.test(serialized)) throw new TypeError(`Theme variable ${key} contains unsafe CSS syntax`);
        variables[key] = value;
    }
    return variables;
}

export function prepareThemeRegistry(input) {
    assertObject(input, 'Theme registry');
    const version = input.schemaVersion ?? 1;
    if (version !== THEME_SCHEMA_VERSION) throw new Error(`Unsupported theme registry schema version: ${version}`);
    if (!Array.isArray(input.themes)) throw new TypeError('Theme registry themes must be an array');
    const themes = input.themes.map((id) => validateThemeId(id));
    if (new Set(themes).size !== themes.length) throw new Error('Theme registry contains duplicate ids');
    return { ...input, schemaVersion: THEME_SCHEMA_VERSION, themes };
}

export function prepareThemeManifest(input, requestedId) {
    assertObject(input, 'Theme manifest');
    const version = input.schemaVersion ?? 1;
    if (version !== THEME_SCHEMA_VERSION) throw new Error(`Unsupported theme manifest schema version: ${version}`);
    const id = validateThemeId(input.id ?? requestedId);
    if (requestedId && id !== requestedId) throw new Error(`Theme id mismatch: expected ${requestedId}, received ${id}`);
    const parent = input.extends == null ? null : validateThemeId(input.extends, 'Parent theme id');
    if (typeof input.name !== 'string' || !input.name.trim()) throw new TypeError('Theme name must be a non-empty string');
    return {
        ...input,
        schemaVersion: THEME_SCHEMA_VERSION,
        id,
        name: input.name.trim(),
        extends: parent,
        vars: prepareThemeVariables(input.vars ?? {}),
    };
}
