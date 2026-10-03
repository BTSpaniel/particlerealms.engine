// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Canonical localStorage contracts for structured editor preferences.
 *
 * The original keys remain v1 rollback mirrors. Current clients publish the
 * legacy payload first and the v2 envelope last. The envelope remembers the
 * exact legacy JSON it accompanied, allowing a later write from an older tab
 * to be detected and read instead of being shadowed by stale v2 data.
 */

export const EDITOR_PREFERENCE_SCHEMA_VERSION = 2;
export const EDITOR_PREFERENCE_MAX_RECORD_BYTES = 16 * 1024 * 1024;

export class EditorPreferenceContractError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'EditorPreferenceContractError';
        this.code = code;
        this.details = details;
    }
}

const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isStringArray = value => Array.isArray(value) && value.every(item => typeof item === 'string');
const encoder = new TextEncoder();

function isRecentProjectList(value) {
    return Array.isArray(value) && value.every(project => (
        isPlainObject(project)
        && typeof project.name === 'string'
        && (project.path === undefined || typeof project.path === 'string')
        && (project.lastOpened === undefined || typeof project.lastOpened === 'string')
        && (project.thumbnail === undefined || project.thumbnail === null || typeof project.thumbnail === 'string')
    ));
}

function isRoomCredentials(value) {
    return isPlainObject(value)
        && typeof value.roomId === 'string'
        && typeof value.wordKey === 'string'
        && typeof value.numberKey === 'string'
        && (value.hostId === undefined || typeof value.hostId === 'string');
}

const CONTRACTS = Object.freeze({
    settings: Object.freeze({
        schema: 'editor.settings', legacyKey: 'editor_settings', currentKey: 'editor_settings.v2',
        payloadKey: 'settings', validate: isPlainObject,
    }),
    hotkeys: Object.freeze({
        schema: 'editor.hotkeys', legacyKey: 'editor_hotkeys', currentKey: 'editor_hotkeys.v2',
        payloadKey: 'bindings', validate: isPlainObject,
    }),
    recentProjects: Object.freeze({
        schema: 'editor.recent-projects', legacyKey: 'editor_recent_projects', currentKey: 'editor_recent_projects.v2',
        payloadKey: 'projects', validate: isRecentProjectList,
    }),
    worldEnvironment: Object.freeze({
        schema: 'editor.world-environment', legacyKey: 'worldPanel.environment', currentKey: 'worldPanel.environment.v2',
        payloadKey: 'environment', validate: isPlainObject,
    }),
    worldPostprocess: Object.freeze({
        schema: 'editor.world-postprocess', legacyKey: 'worldPanel.postprocess', currentKey: 'worldPanel.postprocess.v2',
        payloadKey: 'postprocess', validate: isPlainObject,
    }),
    worldPanelCollapse: Object.freeze({
        schema: 'editor.world-panel-collapse', legacyKey: 'worldPanel.collapsedSections', currentKey: 'worldPanel.collapsedSections.v2',
        payloadKey: 'sections', validate: isStringArray,
    }),
    collabRoom: Object.freeze({
        schema: 'editor.collab-room', legacyKey: 'collab.room', currentKey: 'collab.room.v2',
        payloadKey: 'room', validate: isRoomCredentials,
    }),
    audioMotion: Object.freeze({
        schema: 'editor.audio-motion', legacyKey: 'audioEditor.motionPatch', currentKey: 'audioEditor.motionPatch.v2',
        payloadKey: 'motion', validate: isPlainObject,
    }),
    audioFavorites: Object.freeze({
        schema: 'editor.audio-favorites', legacyKey: 'audioEditor.favorites', currentKey: 'audioEditor.favorites.v2',
        payloadKey: 'values', validate: isStringArray,
    }),
    audioRecents: Object.freeze({
        schema: 'editor.audio-recents', legacyKey: 'audioEditor.recents', currentKey: 'audioEditor.recents.v2',
        payloadKey: 'values', validate: isStringArray,
    }),
});

function storageOrDefault(storage) {
    const resolved = storage ?? globalThis.localStorage;
    if (!resolved || typeof resolved.getItem !== 'function' || typeof resolved.setItem !== 'function') {
        throw new EditorPreferenceContractError('STORAGE_UNAVAILABLE', 'localStorage is unavailable');
    }
    return resolved;
}

function parseJson(raw, contract, medium) {
    if (typeof raw !== 'string' || encoder.encode(raw).byteLength > EDITOR_PREFERENCE_MAX_RECORD_BYTES) {
        throw new EditorPreferenceContractError(
            'CORRUPT_EDITOR_PREFERENCE',
            `${contract.schema} ${medium} record exceeds its size limit`,
            { schema: contract.schema, medium },
        );
    }
    try {
        return JSON.parse(raw);
    } catch (cause) {
        throw new EditorPreferenceContractError(
            'CORRUPT_EDITOR_PREFERENCE',
            `${contract.schema} ${medium} record is not valid JSON`,
            { schema: contract.schema, medium, cause },
        );
    }
}

function validatePayload(payload, contract, medium) {
    if (!contract.validate(payload)) {
        throw new EditorPreferenceContractError(
            'CORRUPT_EDITOR_PREFERENCE',
            `${contract.schema} ${medium} payload is invalid`,
            { schema: contract.schema, medium },
        );
    }
    return payload;
}

function parseLegacy(raw, contract) {
    if (raw === null) return null;
    const payload = parseJson(raw, contract, 'legacy-v1');
    return { payload: validatePayload(payload, contract, 'legacy-v1'), raw };
}

function parseCurrent(raw, contract) {
    if (raw === null) return null;
    const record = parseJson(raw, contract, 'current-v2');
    if (!isPlainObject(record) || record.schema !== contract.schema || !Number.isInteger(record.schemaVersion)) {
        throw new EditorPreferenceContractError(
            'CORRUPT_EDITOR_PREFERENCE',
            `${contract.schema} current envelope is invalid`,
            { schema: contract.schema, medium: 'current-v2' },
        );
    }
    if (record.schemaVersion > EDITOR_PREFERENCE_SCHEMA_VERSION) {
        throw new EditorPreferenceContractError(
            'FUTURE_EDITOR_PREFERENCE_VERSION',
            `${contract.schema} v${record.schemaVersion} is newer than supported v${EDITOR_PREFERENCE_SCHEMA_VERSION}`,
            { schema: contract.schema, actualVersion: record.schemaVersion },
        );
    }
    if (record.schemaVersion !== EDITOR_PREFERENCE_SCHEMA_VERSION || typeof record.legacySnapshot !== 'string') {
        throw new EditorPreferenceContractError(
            'UNSUPPORTED_EDITOR_PREFERENCE_VERSION',
            `${contract.schema} current key requires v${EDITOR_PREFERENCE_SCHEMA_VERSION}`,
            { schema: contract.schema, actualVersion: record.schemaVersion },
        );
    }
    if (encoder.encode(record.legacySnapshot).byteLength > EDITOR_PREFERENCE_MAX_RECORD_BYTES) {
        throw new EditorPreferenceContractError(
            'CORRUPT_EDITOR_PREFERENCE', `${contract.schema} legacy snapshot exceeds its size limit`,
            { schema: contract.schema, medium: 'current-v2' },
        );
    }
    const payload = validatePayload(record[contract.payloadKey], contract, 'current-v2');
    if (JSON.stringify(payload) !== record.legacySnapshot) {
        throw new EditorPreferenceContractError(
            'CORRUPT_EDITOR_PREFERENCE', `${contract.schema} payload does not match its legacy snapshot`,
            { schema: contract.schema, medium: 'current-v2' },
        );
    }
    return {
        payload,
        legacySnapshot: record.legacySnapshot,
        record,
    };
}

function inspect(storage, contract) {
    const resolved = storageOrDefault(storage);
    const legacyRaw = resolved.getItem(contract.legacyKey);
    const currentRaw = resolved.getItem(contract.currentKey);
    return {
        storage: resolved,
        legacy: parseLegacy(legacyRaw, contract),
        current: parseCurrent(currentRaw, contract),
    };
}

function readContract(contract, storage) {
    const state = inspect(storage, contract);
    if (state.current && state.legacy && state.current.legacySnapshot !== state.legacy.raw) {
        return structuredCloneValue(state.legacy.payload);
    }
    const selected = state.current?.payload ?? state.legacy?.payload ?? null;
    return selected === null ? null : structuredCloneValue(selected);
}

function structuredCloneValue(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function writeContract(contract, payload, storage) {
    validatePayload(payload, contract, 'write');
    const state = inspect(storage, contract);
    const legacyJson = JSON.stringify(payload);
    const currentJson = JSON.stringify({
        schema: contract.schema,
        schemaVersion: EDITOR_PREFERENCE_SCHEMA_VERSION,
        [contract.payloadKey]: payload,
        legacySnapshot: legacyJson,
    });
    if (encoder.encode(legacyJson).byteLength > EDITOR_PREFERENCE_MAX_RECORD_BYTES
        || encoder.encode(currentJson).byteLength > EDITOR_PREFERENCE_MAX_RECORD_BYTES) {
        throw new EditorPreferenceContractError(
            'CORRUPT_EDITOR_PREFERENCE', `${contract.schema} write exceeds its size limit`,
            { schema: contract.schema, medium: 'write' },
        );
    }
    const previousLegacy = state.storage.getItem(contract.legacyKey);

    state.storage.setItem(contract.legacyKey, legacyJson);
    try {
        state.storage.setItem(contract.currentKey, currentJson);
    } catch (error) {
        try {
            if (previousLegacy === null) state.storage.removeItem(contract.legacyKey);
            else state.storage.setItem(contract.legacyKey, previousLegacy);
        } catch (_) {
            // Best-effort rollback. The current envelope remains the commit marker.
        }
        throw error;
    }
    return structuredCloneValue(payload);
}

function removeContract(contract, storage) {
    const state = inspect(storage, contract);
    state.storage.removeItem(contract.legacyKey);
    state.storage.removeItem(contract.currentKey);
}

export const EDITOR_PREFERENCE_CONTRACTS = CONTRACTS;

export const readEditorSettings = storage => readContract(CONTRACTS.settings, storage);
export const writeEditorSettings = (value, storage) => writeContract(CONTRACTS.settings, value, storage);
export const clearEditorSettings = storage => removeContract(CONTRACTS.settings, storage);

export const readEditorHotkeys = storage => readContract(CONTRACTS.hotkeys, storage);
export const writeEditorHotkeys = (value, storage) => writeContract(CONTRACTS.hotkeys, value, storage);
export const clearEditorHotkeys = storage => removeContract(CONTRACTS.hotkeys, storage);

export const readRecentProjects = storage => readContract(CONTRACTS.recentProjects, storage);
export const writeRecentProjects = (value, storage) => writeContract(CONTRACTS.recentProjects, value, storage);
export const clearRecentProjectsRecord = storage => removeContract(CONTRACTS.recentProjects, storage);

export const readWorldEnvironment = storage => readContract(CONTRACTS.worldEnvironment, storage);
export const writeWorldEnvironment = (value, storage) => writeContract(CONTRACTS.worldEnvironment, value, storage);
export const readWorldPostprocess = storage => readContract(CONTRACTS.worldPostprocess, storage);
export const writeWorldPostprocess = (value, storage) => writeContract(CONTRACTS.worldPostprocess, value, storage);
export const readWorldPanelCollapse = storage => readContract(CONTRACTS.worldPanelCollapse, storage);
export const writeWorldPanelCollapse = (value, storage) => writeContract(CONTRACTS.worldPanelCollapse, value, storage);

export const readCollabRoom = storage => readContract(CONTRACTS.collabRoom, storage);
export const writeCollabRoom = (value, storage) => writeContract(CONTRACTS.collabRoom, value, storage);
export const clearCollabRoom = storage => removeContract(CONTRACTS.collabRoom, storage);

export const readAudioMotion = storage => readContract(CONTRACTS.audioMotion, storage);
export const writeAudioMotion = (value, storage) => writeContract(CONTRACTS.audioMotion, value, storage);

export const readAudioFavorites = storage => readContract(CONTRACTS.audioFavorites, storage);
export const writeAudioFavorites = (value, storage) => writeContract(CONTRACTS.audioFavorites, value, storage);
export const readAudioRecents = storage => readContract(CONTRACTS.audioRecents, storage);
export const writeAudioRecents = (value, storage) => writeContract(CONTRACTS.audioRecents, value, storage);
