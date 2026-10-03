// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Immutable, cross-referenced registry for canonical Realm Matter records. */

import { cloneStrictJson } from '../../core/schema/StrictJsonValue.js';
import {
    FabricDiagnostics,
    compareOrdinal,
    fail,
    freeze,
    requireExactKeys,
    requireIdentifier,
    requireRecord,
    requireString,
} from './FabricSupport.js';
import {
    createRealmCompositionProfile,
    createRealmGeometryProfile,
    createRealmHistoryProfile,
    createRealmMatterDefinition,
    createRealmMicrostructureProfile,
    createRealmPhaseProfile,
    createRealmPropertyObservation,
    createRealmTransformation,
} from './RealmMatterContracts.js';

export const REALM_MATTER_REGISTRY_SCHEMA = 'engine.matter.fabric.registry';
export const REALM_MATTER_REGISTRY_VERSION = '1.0.0';

const REGISTRY_KEYS = new Set([
    'schema', 'schemaVersion', 'definitions', 'compositionProfiles', 'phaseProfiles',
    'microstructureProfiles', 'historyProfiles', 'geometryProfiles', 'propertyObservations', 'transformations',
]);
const REQUIRED_KEYS = new Set(REGISTRY_KEYS);
const COLLECTIONS = Object.freeze([
    ['definitions', createRealmMatterDefinition],
    ['compositionProfiles', createRealmCompositionProfile],
    ['phaseProfiles', createRealmPhaseProfile],
    ['microstructureProfiles', createRealmMicrostructureProfile],
    ['historyProfiles', createRealmHistoryProfile],
    ['geometryProfiles', createRealmGeometryProfile],
    ['propertyObservations', createRealmPropertyObservation],
    ['transformations', createRealmTransformation],
]);

function sortedValues(map) {
    return [...map.values()].sort((left, right) => compareOrdinal(left.id, right.id));
}

function buildMap(entries, create, path) {
    if (!Array.isArray(entries)) fail(path, 'must be an array');
    const result = new Map();
    entries.forEach((entry, index) => {
        const record = create(entry);
        if (result.has(record.id)) fail(`${path}[${index}].id`, 'duplicates an earlier record');
        result.set(record.id, record);
    });
    return result;
}

function requireReference(map, id, path) {
    if (id !== null && !map.has(id)) fail(path, `references missing record ${id}`);
}

function aliasKey(namespace, value) {
    return `${namespace}\u0000${value.normalize('NFKC').toLowerCase()}`;
}

export class RealmMatterRegistry {
    #maps = new Map();
    #aliases = new Map();
    #snapshot;
    #diagnostics;

    constructor(input, { logger = null } = {}) {
        this.#diagnostics = new FabricDiagnostics('matter.fabric.registry', logger);
        const token = this.#diagnostics.begin('registry.create');
        try {
            const candidate = cloneStrictJson(input, '$.registry');
            requireRecord(candidate, '$.registry');
            candidate.schema ??= REALM_MATTER_REGISTRY_SCHEMA;
            candidate.schemaVersion ??= REALM_MATTER_REGISTRY_VERSION;
            requireExactKeys(candidate, REGISTRY_KEYS, REQUIRED_KEYS, '$.registry');
            if (candidate.schema !== REALM_MATTER_REGISTRY_SCHEMA) fail('$.registry.schema', 'is unsupported');
            if (candidate.schemaVersion !== REALM_MATTER_REGISTRY_VERSION) fail('$.registry.schemaVersion', 'is unsupported');
            for (const [name, create] of COLLECTIONS) {
                this.#maps.set(name, buildMap(candidate[name], create, `$.registry.${name}`));
            }
            this.#validateReferences();
            this.#buildAliases();
            this.#snapshot = freeze({
                schema: REALM_MATTER_REGISTRY_SCHEMA,
                schemaVersion: REALM_MATTER_REGISTRY_VERSION,
                ...Object.fromEntries(COLLECTIONS.map(([name]) => [name, sortedValues(this.#maps.get(name))])),
            }, '$.registrySnapshot');
            this.#diagnostics.end(token, { records: COLLECTIONS.reduce((sum, [name]) => sum + this.#maps.get(name).size, 0) }, {
                stateChanged: true,
            });
        } catch (error) {
            this.#diagnostics.error(token, error);
            throw error;
        }
    }

    getDefinition(id) {
        return this.#get('definitions', id);
    }

    resolveAlias(namespace, value) {
        requireIdentifier(namespace, '$.namespace');
        requireString(value, '$.value', { maximum: 256 });
        const id = this.#aliases.get(aliasKey(namespace, value)) ?? null;
        return id === null ? null : this.#maps.get('definitions').get(id);
    }

    resolveDefinition(identifierOrAlias, namespace = null) {
        requireString(identifierOrAlias, '$.identifierOrAlias', { maximum: 256 });
        if (this.#maps.get('definitions').has(identifierOrAlias)) return this.#maps.get('definitions').get(identifierOrAlias);
        return namespace === null ? null : this.resolveAlias(namespace, identifierOrAlias);
    }

    getCompositionProfile(id) { return this.#get('compositionProfiles', id); }
    getPhaseProfile(id) { return this.#get('phaseProfiles', id); }
    getMicrostructureProfile(id) { return this.#get('microstructureProfiles', id); }
    getHistoryProfile(id) { return this.#get('historyProfiles', id); }
    getGeometryProfile(id) { return this.#get('geometryProfiles', id); }
    getPropertyObservation(id) { return this.#get('propertyObservations', id); }
    getTransformation(id) { return this.#get('transformations', id); }

    listDefinitions({ kind = null, tag = null } = {}) {
        if (kind !== null) requireIdentifier(kind, '$.filter.kind');
        if (tag !== null) requireIdentifier(tag, '$.filter.tag');
        return freeze(sortedValues(this.#maps.get('definitions')).filter(record => (
            (kind === null || record.kind === kind) && (tag === null || record.tags.includes(tag))
        )), '$.definitions');
    }

    listPropertyObservations({ definitionId = null, propertyId = null } = {}) {
        if (definitionId !== null) requireIdentifier(definitionId, '$.filter.definitionId');
        if (propertyId !== null) requireIdentifier(propertyId, '$.filter.propertyId');
        return freeze(sortedValues(this.#maps.get('propertyObservations')).filter(record => (
            (definitionId === null || record.definitionId === definitionId)
            && (propertyId === null || record.propertyId === propertyId)
        )), '$.propertyObservations');
    }

    listTransformations() {
        return freeze(sortedValues(this.#maps.get('transformations')), '$.transformations');
    }

    snapshot() {
        return this.#snapshot;
    }

    diagnostics() {
        return this.#diagnostics.snapshot();
    }

    #get(collection, id) {
        requireIdentifier(id, `$.${collection}.id`);
        return this.#maps.get(collection).get(id) ?? null;
    }

    #buildAliases() {
        for (const definition of this.#maps.get('definitions').values()) {
            for (const alias of definition.aliases) {
                const key = aliasKey(alias.namespace, alias.value);
                const previous = this.#aliases.get(key);
                if (previous && previous !== definition.id) {
                    fail('$.registry.definitions', `alias ${alias.namespace}:${alias.value} is ambiguous`);
                }
                this.#aliases.set(key, definition.id);
            }
        }
    }

    #validateReferences() {
        const definitions = this.#maps.get('definitions');
        const compositions = this.#maps.get('compositionProfiles');
        const phases = this.#maps.get('phaseProfiles');
        const microstructures = this.#maps.get('microstructureProfiles');
        const histories = this.#maps.get('historyProfiles');
        const geometries = this.#maps.get('geometryProfiles');
        const observations = this.#maps.get('propertyObservations');
        const transformations = this.#maps.get('transformations');
        for (const definition of definitions.values()) {
            const refs = definition.profileRefs;
            requireReference(compositions, refs.composition, `$.definition.${definition.id}.profileRefs.composition`);
            requireReference(phases, refs.phase, `$.definition.${definition.id}.profileRefs.phase`);
            requireReference(microstructures, refs.microstructure, `$.definition.${definition.id}.profileRefs.microstructure`);
            requireReference(histories, refs.history, `$.definition.${definition.id}.profileRefs.history`);
            requireReference(geometries, refs.geometry, `$.definition.${definition.id}.profileRefs.geometry`);
            definition.propertyObservationIds.forEach((id, index) => {
                requireReference(observations, id, `$.definition.${definition.id}.propertyObservationIds[${index}]`);
                if (observations.get(id).definitionId !== definition.id) {
                    fail(`$.definition.${definition.id}.propertyObservationIds[${index}]`, 'belongs to a different definition');
                }
            });
        }
        for (const profile of compositions.values()) {
            profile.constituents.forEach((constituent, index) => {
                requireReference(definitions, constituent.constituentId, `$.composition.${profile.id}.constituents[${index}]`);
            });
        }
        for (const profile of microstructures.values()) {
            profile.phaseIds.forEach((id, index) => requireReference(phases, id, `$.microstructure.${profile.id}.phaseIds[${index}]`));
        }
        for (const profile of histories.values()) {
            profile.transformationIds.forEach((id, index) => (
                requireReference(transformations, id, `$.history.${profile.id}.transformationIds[${index}]`)
            ));
        }
        for (const observation of observations.values()) {
            requireReference(definitions, observation.definitionId, `$.observation.${observation.id}.definitionId`);
            requireReference(phases, observation.conditions.phaseProfileId, `$.observation.${observation.id}.conditions.phaseProfileId`);
            requireReference(microstructures, observation.conditions.microstructureProfileId,
                `$.observation.${observation.id}.conditions.microstructureProfileId`);
            requireReference(histories, observation.conditions.historyProfileId,
                `$.observation.${observation.id}.conditions.historyProfileId`);
        }
        for (const transformation of transformations.values()) {
            for (const field of ['inputs', 'outputs', 'byproducts']) {
                transformation[field].forEach((flow, index) => (
                    requireReference(definitions, flow.definitionId, `$.transformation.${transformation.id}.${field}[${index}]`)
                ));
            }
            transformation.reservoirs.forEach((reservoir, index) => {
                const definition = definitions.get(reservoir.reservoirId);
                requireReference(definitions, reservoir.reservoirId,
                    `$.transformation.${transformation.id}.reservoirs[${index}].reservoirId`);
                if (definition?.kind !== 'reservoir') {
                    fail(`$.transformation.${transformation.id}.reservoirs[${index}].reservoirId`, 'must identify a reservoir definition');
                }
            });
        }
    }
}

export function createRealmMatterRegistry(input, options = {}) {
    return new RealmMatterRegistry(input, options);
}
