// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Deterministic offline compiler and network-free runtime importer for Matter domain packs. */

import { cloneStrictJson } from '../../core/schema/StrictJsonValue.js';
import {
    FabricDiagnostics,
    canonicalStringify,
    compareOrdinal,
    contentHash,
    fail,
    freeze,
    requireExactKeys,
    requireHash,
    requireIdentifier,
    requireInteger,
    requireRecord,
    requireSemver,
    requireString,
} from './FabricSupport.js';
import { createRealmMatterRegistry } from './RealmMatterRegistry.js';

export const REALM_MATTER_PACK_SCHEMA = 'engine.matter.fabric.domain-pack';
export const REALM_MATTER_PACK_VERSION = '1.0.0';

const COMPILE_KEYS = new Set(['packId', 'packVersion', 'license', 'sourceRecords', 'registry']);
const SOURCE_KEYS = new Set(['sourceId', 'sourceVersion', 'license', 'contentHash', 'recordCount']);
const PACK_KEYS = new Set([
    'schema', 'schemaVersion', 'packId', 'packVersion', 'license', 'sourceRecords',
    'dictionary', 'encodedRegistry', 'registryHash', 'packHash',
]);
const UNIT_NORMALIZATION = Object.freeze({
    'g/cm3': { unit: 'kg/m3', scale: 1000 },
    MPa: { unit: 'Pa', scale: 1e6 },
    GPa: { unit: 'Pa', scale: 1e9 },
    kPa: { unit: 'Pa', scale: 1e3 },
    kJ: { unit: 'J', scale: 1e3 },
});

function validateSources(value, path = '$.sourceRecords') {
    if (!Array.isArray(value) || value.length === 0) fail(path, 'must be a non-empty array');
    const ids = new Set();
    value.forEach((source, index) => {
        const itemPath = `${path}[${index}]`;
        requireExactKeys(source, SOURCE_KEYS, SOURCE_KEYS, itemPath);
        const id = requireIdentifier(source.sourceId, `${itemPath}.sourceId`);
        if (ids.has(id)) fail(`${itemPath}.sourceId`, 'duplicates an earlier source');
        ids.add(id);
        requireSemver(source.sourceVersion, `${itemPath}.sourceVersion`);
        requireString(source.license, `${itemPath}.license`, { maximum: 256 });
        requireHash(source.contentHash, `${itemPath}.contentHash`);
        requireInteger(source.recordCount, `${itemPath}.recordCount`);
    });
    return value;
}

function normalizedRegistryInput(input) {
    const snapshot = typeof input?.snapshot === 'function' ? input.snapshot() : input;
    const candidate = cloneStrictJson(snapshot, '$.registry');
    if (!Array.isArray(candidate.propertyObservations)) return candidate;
    candidate.propertyObservations = candidate.propertyObservations.map(observation => {
        const normalization = UNIT_NORMALIZATION[observation.value?.unit];
        if (!normalization) return observation;
        observation.value.minimum *= normalization.scale;
        observation.value.nominal *= normalization.scale;
        observation.value.maximum *= normalization.scale;
        observation.value.unit = normalization.unit;
        observation.uncertainty.absolute *= normalization.scale;
        return observation;
    });
    return candidate;
}

function collectStrings(value, strings) {
    if (typeof value === 'string') {
        strings.add(value);
    } else if (Array.isArray(value)) {
        value.forEach(entry => collectStrings(entry, strings));
    } else if (value !== null && typeof value === 'object') {
        Object.entries(value).forEach(([key, entry]) => {
            strings.add(key);
            collectStrings(entry, strings);
        });
    }
}

function collectEvidenceSources(value, output) {
    if (Array.isArray(value)) {
        value.forEach(entry => collectEvidenceSources(entry, output));
    } else if (value !== null && typeof value === 'object') {
        for (const [key, entry] of Object.entries(value)) {
            if (key === 'evidence' && entry && Array.isArray(entry.sourceIds)) {
                entry.sourceIds.forEach(id => output.add(id));
            }
            collectEvidenceSources(entry, output);
        }
    }
}

function requireDeclaredProvenance(registrySnapshot, sources, path) {
    const declared = new Set(sources.map(source => source.sourceId));
    const referenced = new Set();
    collectEvidenceSources(registrySnapshot, referenced);
    for (const id of referenced) {
        if (!declared.has(id)) fail(path, `evidence references undeclared source ${id}`);
    }
}

function dictionaryEncode(value, indices) {
    if (typeof value === 'string') return ['s', indices.get(value)];
    if (Array.isArray(value)) return ['a', ...value.map(entry => dictionaryEncode(entry, indices))];
    if (value !== null && typeof value === 'object') {
        const entries = Object.entries(value).sort(([left], [right]) => compareOrdinal(left, right));
        return ['o', ...entries.flatMap(([key, entry]) => [indices.get(key), dictionaryEncode(entry, indices)])];
    }
    return value;
}

function dictionaryDecode(value, dictionary, path = '$.encodedRegistry') {
    if (!Array.isArray(value)) return value;
    if (value[0] === 's') {
        if (value.length !== 2 || !Number.isSafeInteger(value[1]) || value[1] < 0 || value[1] >= dictionary.length) {
            fail(path, 'contains an invalid string reference');
        }
        return dictionary[value[1]];
    }
    if (value[0] === 'a') return value.slice(1).map((entry, index) => dictionaryDecode(entry, dictionary, `${path}[${index}]`));
    if (value[0] === 'o') {
        if (value.length % 2 !== 1) fail(path, 'contains a malformed encoded object');
        const result = Object.create(null);
        for (let index = 1; index < value.length; index += 2) {
            const keyIndex = value[index];
            if (!Number.isSafeInteger(keyIndex) || keyIndex < 0 || keyIndex >= dictionary.length) {
                fail(`${path}[${index}]`, 'contains an invalid key reference');
            }
            const key = dictionary[keyIndex];
            if (Object.hasOwn(result, key)) fail(path, `duplicates decoded key ${key}`);
            result[key] = dictionaryDecode(value[index + 1], dictionary, `${path}.${key}`);
        }
        return result;
    }
    fail(path, 'contains an unknown dictionary token');
}

function basePack(pack) {
    const { packHash: _packHash, ...base } = pack;
    return base;
}

function validatePack(input) {
    const pack = cloneStrictJson(input, '$.domainPack');
    requireExactKeys(pack, PACK_KEYS, PACK_KEYS, '$.domainPack');
    if (pack.schema !== REALM_MATTER_PACK_SCHEMA) fail('$.domainPack.schema', 'is unsupported');
    if (pack.schemaVersion !== REALM_MATTER_PACK_VERSION) fail('$.domainPack.schemaVersion', 'is unsupported');
    requireIdentifier(pack.packId, '$.domainPack.packId');
    requireSemver(pack.packVersion, '$.domainPack.packVersion');
    requireString(pack.license, '$.domainPack.license', { maximum: 256 });
    validateSources(pack.sourceRecords, '$.domainPack.sourceRecords');
    if (!Array.isArray(pack.dictionary)) fail('$.domainPack.dictionary', 'must be an array');
    let previous = null;
    pack.dictionary.forEach((entry, index) => {
        requireString(entry, `$.domainPack.dictionary[${index}]`, { maximum: 4096, allowEmpty: true });
        if (previous !== null && compareOrdinal(previous, entry) >= 0) {
            fail(`$.domainPack.dictionary[${index}]`, 'must be unique and ordinally sorted');
        }
        previous = entry;
    });
    requireHash(pack.registryHash, '$.domainPack.registryHash');
    requireHash(pack.packHash, '$.domainPack.packHash');
    if (contentHash(basePack(pack), '$.domainPack.payload') !== pack.packHash) {
        fail('$.domainPack.packHash', 'does not bind the pack payload');
    }
    const decoded = dictionaryDecode(pack.encodedRegistry, pack.dictionary);
    if (contentHash(decoded, '$.decodedRegistry') !== pack.registryHash) {
        fail('$.domainPack.registryHash', 'does not bind the decoded registry');
    }
    const registry = createRealmMatterRegistry(decoded);
    requireDeclaredProvenance(registry.snapshot(), pack.sourceRecords, '$.domainPack.sourceRecords');
    return { pack: freeze(pack, '$.domainPack'), registry };
}

export class RealmMatterPackCompiler {
    #diagnostics;

    constructor({ logger = null } = {}) {
        this.#diagnostics = new FabricDiagnostics('matter.fabric.pack-compiler', logger);
    }

    compile(input) {
        const token = this.#diagnostics.begin('pack.compile');
        try {
            const container = cloneStrictJson(input, '$.compile');
            requireExactKeys(container, COMPILE_KEYS, COMPILE_KEYS, '$.compile');
            requireIdentifier(container.packId, '$.compile.packId');
            requireSemver(container.packVersion, '$.compile.packVersion');
            requireString(container.license, '$.compile.license', { maximum: 256 });
            const sources = cloneStrictJson(container.sourceRecords, '$.compile.sourceRecords');
            validateSources(sources, '$.compile.sourceRecords');
            sources.sort((left, right) => compareOrdinal(left.sourceId, right.sourceId));
            const registry = createRealmMatterRegistry(normalizedRegistryInput(container.registry));
            const registrySnapshot = registry.snapshot();
            requireDeclaredProvenance(registrySnapshot, sources, '$.compile.sourceRecords');
            const strings = new Set();
            collectStrings(registrySnapshot, strings);
            const dictionary = [...strings].sort(compareOrdinal);
            const indices = new Map(dictionary.map((value, index) => [value, index]));
            const base = {
                schema: REALM_MATTER_PACK_SCHEMA,
                schemaVersion: REALM_MATTER_PACK_VERSION,
                packId: container.packId,
                packVersion: container.packVersion,
                license: container.license,
                sourceRecords: sources,
                dictionary,
                encodedRegistry: dictionaryEncode(registrySnapshot, indices),
                registryHash: contentHash(registrySnapshot, '$.registrySnapshot'),
            };
            const pack = freeze({ ...base, packHash: contentHash(base, '$.domainPackPayload') }, '$.domainPack');
            this.#diagnostics.end(token, {
                packId: pack.packId,
                dictionaryEntries: dictionary.length,
                encodedBytes: new TextEncoder().encode(canonicalStringify(pack)).byteLength,
            }, { stateChanged: true });
            return pack;
        } catch (error) {
            this.#diagnostics.error(token, error);
            throw error;
        }
    }

    diagnostics() { return this.#diagnostics.snapshot(); }
}

export class RealmMatterPackImporter {
    #diagnostics;

    constructor({ logger = null } = {}) {
        this.#diagnostics = new FabricDiagnostics('matter.fabric.pack-importer', logger);
    }

    import(source) {
        const token = this.#diagnostics.begin('pack.import');
        try {
            let input = source;
            if (source instanceof ArrayBuffer) input = new Uint8Array(source);
            if (ArrayBuffer.isView(input)) input = new TextDecoder('utf-8', { fatal: true }).decode(input);
            if (typeof input === 'string') {
                if (/^https?:\/\//i.test(input.trim())) fail('$.domainPack', 'network URLs are forbidden at runtime');
                try {
                    input = JSON.parse(input);
                } catch (error) {
                    fail('$.domainPack', `is not valid JSON: ${error.message}`);
                }
            }
            const loaded = validatePack(input);
            const result = Object.freeze(loaded);
            this.#diagnostics.end(token, {
                packId: result.pack.packId,
                definitions: result.registry.listDefinitions().length,
            }, { stateChanged: true });
            return result;
        } catch (error) {
            this.#diagnostics.error(token, error);
            throw error;
        }
    }

    diagnostics() { return this.#diagnostics.snapshot(); }
}

export function compileRealmMatterDomainPack(input, options = {}) {
    return new RealmMatterPackCompiler(options).compile(input);
}

export function importRealmMatterDomainPack(source, options = {}) {
    return new RealmMatterPackImporter(options).import(source);
}

export function validateRealmMatterDomainPack(value) {
    validatePack(value);
    return true;
}

export function encodeRealmMatterDomainPack(pack) {
    const validated = validatePack(pack).pack;
    return new TextEncoder().encode(canonicalStringify(validated, '$.domainPack'));
}

export function decodeRealmMatterDomainPack(bytes) {
    return importRealmMatterDomainPack(bytes);
}
