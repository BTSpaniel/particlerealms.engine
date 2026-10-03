// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Strict, app-neutral contracts for immutable matter definitions and runtime state. */

import {
    cloneAndFreezeStrictJson,
    cloneStrictJson,
    deepFreezeJson,
    isPlainJsonObject,
    strictJsonArrayDescriptors,
} from '../../core/schema/StrictJsonValue.js';

export const MATTER_DEFINITION_SCHEMA = 'engine.matter.definition';
export const MATTER_DEFINITION_VERSION = '1.0.0';
export const MATTER_STATE_SCHEMA = 'engine.matter.state';
export const MATTER_STATE_VERSION = '1.0.0';
export const MATTER_INTERACTION_SCHEMA = 'engine.matter.interaction';
export const MATTER_INTERACTION_VERSION = '1.0.0';

export const MATTER_REPRESENTATIONS = Object.freeze([
    'rigid',
    'deformable',
    'fragments',
    'granules',
    'powder',
    'fluid',
    'aerosol',
    'voxel',
]);

export const MATTER_FIDELITY_LEVELS = Object.freeze(['L0', 'L1', 'L2', 'L3', 'L4', 'L5']);
export const MATTER_ATTRIBUTION_MODES = Object.freeze(['explicit', 'exact-singleton-projections']);

const REPRESENTATIONS = new Set(MATTER_REPRESENTATIONS);
// Only successfully validated, deeply frozen snapshots enter this set. A raw
// caller's Object.freeze is not evidence that its schema or children are safe.
const immutableStates = new WeakSet();
// A serialization-layout proof is separate from schema admission: valid raw
// states may order their keys differently or carry optional physical fields.
const compactStateLayouts = new WeakSet();
const COMPACT_STATE_KEYS = Object.freeze([
    'revision', 'regionId', 'definitionId', 'definitionHash', 'representation',
    'ancestry', 'conserved', 'schema', 'schemaVersion',
]);
const immutableStateLists = new WeakSet();
const emptyStateTemplates = new WeakSet();
const validatedDerivedChanges = new WeakSet();
const FIDELITY_LEVELS = new Set(MATTER_FIDELITY_LEVELS);
const ATTRIBUTION_MODES = new Set(MATTER_ATTRIBUTION_MODES);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA256 = /^sha256(?::256)?:[0-9a-f]{64}$/;
const FRACTION_TOLERANCE = 1e-9;

const DEFINITION_KEYS = new Set([
    'schema', 'schemaVersion', 'id', 'label', 'source', 'constituents',
    'modelBindings', 'missingParameters',
]);
const SOURCE_KEYS = new Set(['resourceId', 'resourceHash', 'resourceSchema', 'resourceSchemaVersion']);
const CONSTITUENT_KEYS = new Set(['speciesId', 'massFraction']);
const MODEL_BINDING_KEYS = new Set(['modelId', 'modelVersion', 'parameters', 'parameterSources']);

const STATE_KEYS = new Set([
    'schema', 'schemaVersion', 'regionId', 'definitionId', 'definitionHash',
    'revision', 'representation', 'ancestry', 'conserved', 'fields',
    'mechanics', 'structure', 'environment', 'derived',
]);
const REPRESENTATION_KEYS = new Set(['kind', 'fidelityLevel', 'backendId']);
const ANCESTRY_KEYS = new Set(['rootRegionId', 'parentRegionId', 'eventId', 'generation']);
const CONSERVED_KEYS = new Set([
    'speciesMassKg', 'momentumKgMPerS', 'internalEnergyJ', 'electricChargeC',
]);
const FIELD_KEYS = new Set(['temperatureK', 'pressurePa', 'phaseFractions']);
const MECHANICS_KEYS = new Set([
    'deformationGradient', 'stressTensorPa', 'plasticStrainTensor',
    'damageTensor', 'crackDensity',
]);
const STRUCTURE_KEYS = new Set([
    'porosity', 'permeabilityM2', 'orientationTensor', 'grainSizeMeters', 'fibreDirection',
]);
const ENVIRONMENT_KEYS = new Set([
    'uvDoseJPerM2', 'wetDryCycles', 'freezeThawCycles', 'oxidationFraction', 'biologicalDamage',
]);
const DERIVED_KEYS = new Set(['dirtyPaths']);
const STATE_CHANGE_KEYS = new Set(['revision', 'derived']);
const EMPTY_STATE_CHANGE = Object.freeze({});
const DISCARD_DERIVED_CHANGE = Object.freeze({ derived: null });

const INTERACTION_KEYS = new Set([
    'schema', 'schemaVersion', 'eventId', 'kind', 'targetRegionIds', 'attribution', 'inputs',
]);
const ATTRIBUTION_KEYS = new Set(['mode', 'sourceId']);
const INTERACTION_INPUT_KEYS = new Set([
    'impulseKgMPerS', 'energyJ', 'chargeC', 'speciesTransfers',
]);
const SPECIES_TRANSFER_KEYS = new Set([
    'speciesId', 'massKg', 'sourceRegionId', 'targetRegionId',
]);

function fail(path, message) {
    throw new TypeError(`${path}: ${message}`);
}

function record(value, path) {
    if (!isPlainJsonObject(value)) fail(path, 'must be a plain object');
    return value;
}

function exactKeys(value, allowed, required, path) {
    record(value, path);
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) fail(`${path}.${key}`, 'unknown field');
    }
    for (const key of required) {
        if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, 'is required');
    }
    return value;
}

function string(value, path, { pattern = null, maximum = 512 } = {}) {
    if (typeof value !== 'string' || value.length === 0 || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
        fail(path, 'must be a non-empty bounded control-free string');
    }
    if (pattern && !pattern.test(value)) fail(path, 'has invalid syntax');
    return value;
}

function identifier(value, path) {
    return string(value, path, { pattern: IDENTIFIER, maximum: 192 });
}

function semver(value, path) {
    return string(value, path, { pattern: SEMVER, maximum: 64 });
}

function hash(value, path) {
    return string(value, path, { pattern: SHA256, maximum: 75 });
}

function finite(value, path, { minimum = -Number.MAX_VALUE, maximum = Number.MAX_VALUE } = {}) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
        fail(path, `must be finite in [${minimum}, ${maximum}]`);
    }
    return value;
}

function integer(value, path, { minimum = 0 } = {}) {
    if (!Number.isSafeInteger(value) || value < minimum) fail(path, `must be a safe integer >= ${minimum}`);
    return value;
}

function vector(value, path, length, options = {}) {
    if (!Array.isArray(value) || value.length !== length) fail(path, `must be a ${length}-vector`);
    for (let index = 0; index < value.length; index += 1) {
        finite(value[index], `${path}[${index}]`, options);
    }
    return value;
}

function uniqueStrings(value, path, { identifiers = true, allowEmpty = true } = {}) {
    if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
        fail(path, allowEmpty ? 'must be an array' : 'must be a non-empty array');
    }
    const seen = new Set();
    for (let index = 0; index < value.length; index += 1) {
        const entry = identifiers
            ? identifier(value[index], `${path}[${index}]`)
            : string(value[index], `${path}[${index}]`);
        if (seen.has(entry)) fail(`${path}[${index}]`, 'duplicates an earlier value');
        seen.add(entry);
    }
    return value;
}

function nullableIdentifier(value, path) {
    return value === null ? null : identifier(value, path);
}

function sumFractions(entries, valueOf, path) {
    let sum = 0;
    let correction = 0;
    for (const entry of entries) {
        const value = valueOf(entry);
        const adjusted = value - correction;
        const next = sum + adjusted;
        correction = (next - sum) - adjusted;
        sum = next;
    }
    if (Math.abs(sum - 1) > FRACTION_TOLERANCE) fail(path, 'fractions must sum to 1');
}

function numberRecord(value, path, options = {}) {
    record(value, path);
    for (const [key, entry] of Object.entries(value)) {
        identifier(key, `${path} key`);
        finite(entry, `${path}.${key}`, options);
    }
    return value;
}

function validateDefinitionValue(value, path) {
    exactKeys(value, DEFINITION_KEYS, DEFINITION_KEYS, path);
    if (value.schema !== MATTER_DEFINITION_SCHEMA) fail(`${path}.schema`, 'is unsupported');
    if (value.schemaVersion !== MATTER_DEFINITION_VERSION) fail(`${path}.schemaVersion`, 'is unsupported');
    identifier(value.id, `${path}.id`);
    string(value.label, `${path}.label`, { maximum: 256 });

    exactKeys(value.source, SOURCE_KEYS, SOURCE_KEYS, `${path}.source`);
    identifier(value.source.resourceId, `${path}.source.resourceId`);
    hash(value.source.resourceHash, `${path}.source.resourceHash`);
    identifier(value.source.resourceSchema, `${path}.source.resourceSchema`);
    semver(value.source.resourceSchemaVersion, `${path}.source.resourceSchemaVersion`);

    if (!Array.isArray(value.constituents) || value.constituents.length === 0) {
        fail(`${path}.constituents`, 'must be a non-empty array');
    }
    const speciesIds = new Set();
    for (const [index, constituent] of value.constituents.entries()) {
        const itemPath = `${path}.constituents[${index}]`;
        exactKeys(constituent, CONSTITUENT_KEYS, CONSTITUENT_KEYS, itemPath);
        const speciesId = identifier(constituent.speciesId, `${itemPath}.speciesId`);
        if (speciesIds.has(speciesId)) fail(`${itemPath}.speciesId`, 'duplicates an earlier constituent');
        speciesIds.add(speciesId);
        finite(constituent.massFraction, `${itemPath}.massFraction`, { minimum: 0, maximum: 1 });
    }
    sumFractions(value.constituents, entry => entry.massFraction, `${path}.constituents`);

    if (!Array.isArray(value.modelBindings)) fail(`${path}.modelBindings`, 'must be an array');
    const bindings = new Set();
    for (const [index, binding] of value.modelBindings.entries()) {
        const itemPath = `${path}.modelBindings[${index}]`;
        exactKeys(binding, MODEL_BINDING_KEYS, MODEL_BINDING_KEYS, itemPath);
        const modelId = identifier(binding.modelId, `${itemPath}.modelId`);
        const modelVersion = integer(binding.modelVersion, `${itemPath}.modelVersion`, { minimum: 1 });
        const bindingKey = `${modelId}@${modelVersion}`;
        if (bindings.has(bindingKey)) fail(itemPath, 'duplicates an earlier model binding');
        bindings.add(bindingKey);
        record(binding.parameters, `${itemPath}.parameters`);
        record(binding.parameterSources, `${itemPath}.parameterSources`);
        const parameterKeys = Object.keys(binding.parameters).sort();
        const sourceKeys = Object.keys(binding.parameterSources).sort();
        if (JSON.stringify(parameterKeys) !== JSON.stringify(sourceKeys)) {
            fail(`${itemPath}.parameterSources`, 'must provide provenance for every top-level parameter and no others');
        }
        for (const parameterKey of parameterKeys) {
            identifier(parameterKey, `${itemPath}.parameters key`);
            uniqueStrings(binding.parameterSources[parameterKey], `${itemPath}.parameterSources.${parameterKey}`, {
                allowEmpty: false,
            });
        }
    }
    uniqueStrings(value.missingParameters, `${path}.missingParameters`);
    return value;
}

function validateFields(value, path) {
    exactKeys(value, FIELD_KEYS, [], path);
    if (Object.hasOwn(value, 'temperatureK')) finite(value.temperatureK, `${path}.temperatureK`, { minimum: 0 });
    if (Object.hasOwn(value, 'pressurePa')) finite(value.pressurePa, `${path}.pressurePa`, { minimum: 0 });
    if (Object.hasOwn(value, 'phaseFractions')) {
        const entries = Object.entries(numberRecord(value.phaseFractions, `${path}.phaseFractions`, { minimum: 0, maximum: 1 }));
        if (entries.length === 0) fail(`${path}.phaseFractions`, 'must not be empty');
        sumFractions(entries, entry => entry[1], `${path}.phaseFractions`);
    }
}

function validateMechanics(value, path) {
    exactKeys(value, MECHANICS_KEYS, [], path);
    if (Object.hasOwn(value, 'deformationGradient')) vector(value.deformationGradient, `${path}.deformationGradient`, 9);
    if (Object.hasOwn(value, 'stressTensorPa')) vector(value.stressTensorPa, `${path}.stressTensorPa`, 9);
    if (Object.hasOwn(value, 'plasticStrainTensor')) vector(value.plasticStrainTensor, `${path}.plasticStrainTensor`, 9);
    if (Object.hasOwn(value, 'damageTensor')) vector(value.damageTensor, `${path}.damageTensor`, 9, { minimum: 0, maximum: 1 });
    if (Object.hasOwn(value, 'crackDensity')) finite(value.crackDensity, `${path}.crackDensity`, { minimum: 0 });
}

function validateStructure(value, path) {
    exactKeys(value, STRUCTURE_KEYS, [], path);
    if (Object.hasOwn(value, 'porosity')) finite(value.porosity, `${path}.porosity`, { minimum: 0, maximum: 1 });
    if (Object.hasOwn(value, 'permeabilityM2')) finite(value.permeabilityM2, `${path}.permeabilityM2`, { minimum: 0 });
    if (Object.hasOwn(value, 'orientationTensor')) vector(value.orientationTensor, `${path}.orientationTensor`, 9);
    if (Object.hasOwn(value, 'grainSizeMeters')) finite(value.grainSizeMeters, `${path}.grainSizeMeters`, { minimum: 0 });
    if (Object.hasOwn(value, 'fibreDirection')) vector(value.fibreDirection, `${path}.fibreDirection`, 3);
}

function validateEnvironment(value, path) {
    exactKeys(value, ENVIRONMENT_KEYS, [], path);
    if (Object.hasOwn(value, 'uvDoseJPerM2')) finite(value.uvDoseJPerM2, `${path}.uvDoseJPerM2`, { minimum: 0 });
    if (Object.hasOwn(value, 'wetDryCycles')) integer(value.wetDryCycles, `${path}.wetDryCycles`);
    if (Object.hasOwn(value, 'freezeThawCycles')) integer(value.freezeThawCycles, `${path}.freezeThawCycles`);
    if (Object.hasOwn(value, 'oxidationFraction')) finite(value.oxidationFraction, `${path}.oxidationFraction`, { minimum: 0, maximum: 1 });
    if (Object.hasOwn(value, 'biologicalDamage')) finite(value.biologicalDamage, `${path}.biologicalDamage`, { minimum: 0, maximum: 1 });
}

function validateConserved(value, path) {
    exactKeys(value, CONSERVED_KEYS, CONSERVED_KEYS, path);
    numberRecord(value.speciesMassKg, `${path}.speciesMassKg`, { minimum: 0 });
    vector(value.momentumKgMPerS, `${path}.momentumKgMPerS`, 3);
    finite(value.internalEnergyJ, `${path}.internalEnergyJ`, { minimum: 0 });
    finite(value.electricChargeC, `${path}.electricChargeC`);
}

function validateDerived(value, path) {
    exactKeys(value, DERIVED_KEYS, DERIVED_KEYS, path);
    uniqueStrings(value.dirtyPaths, `${path}.dirtyPaths`, { identifiers: false });
}

function validateStateValue(value, path) {
    const required = new Set([
        'schema', 'schemaVersion', 'regionId', 'definitionId', 'definitionHash',
        'revision', 'representation', 'ancestry', 'conserved',
    ]);
    exactKeys(value, STATE_KEYS, required, path);
    if (value.schema !== MATTER_STATE_SCHEMA) fail(`${path}.schema`, 'is unsupported');
    if (value.schemaVersion !== MATTER_STATE_VERSION) fail(`${path}.schemaVersion`, 'is unsupported');
    identifier(value.regionId, `${path}.regionId`);
    identifier(value.definitionId, `${path}.definitionId`);
    hash(value.definitionHash, `${path}.definitionHash`);
    integer(value.revision, `${path}.revision`);

    exactKeys(value.representation, REPRESENTATION_KEYS, REPRESENTATION_KEYS, `${path}.representation`);
    if (!REPRESENTATIONS.has(value.representation.kind)) fail(`${path}.representation.kind`, 'is unsupported');
    if (!FIDELITY_LEVELS.has(value.representation.fidelityLevel)) fail(`${path}.representation.fidelityLevel`, 'is unsupported');
    identifier(value.representation.backendId, `${path}.representation.backendId`);

    exactKeys(value.ancestry, ANCESTRY_KEYS, ANCESTRY_KEYS, `${path}.ancestry`);
    identifier(value.ancestry.rootRegionId, `${path}.ancestry.rootRegionId`);
    nullableIdentifier(value.ancestry.parentRegionId, `${path}.ancestry.parentRegionId`);
    nullableIdentifier(value.ancestry.eventId, `${path}.ancestry.eventId`);
    integer(value.ancestry.generation, `${path}.ancestry.generation`);
    if (value.ancestry.generation === 0 && value.ancestry.parentRegionId !== null) {
        fail(`${path}.ancestry.parentRegionId`, 'must be null for generation zero');
    }
    if (value.ancestry.generation > 0 && value.ancestry.parentRegionId === null) {
        fail(`${path}.ancestry.parentRegionId`, 'is required after generation zero');
    }

    validateConserved(value.conserved, `${path}.conserved`);

    if (Object.hasOwn(value, 'fields')) validateFields(value.fields, `${path}.fields`);
    if (Object.hasOwn(value, 'mechanics')) validateMechanics(value.mechanics, `${path}.mechanics`);
    if (Object.hasOwn(value, 'structure')) validateStructure(value.structure, `${path}.structure`);
    if (Object.hasOwn(value, 'environment')) validateEnvironment(value.environment, `${path}.environment`);
    if (Object.hasOwn(value, 'derived')) validateDerived(value.derived, `${path}.derived`);
    return value;
}

function validateInteractionValue(value, path) {
    exactKeys(value, INTERACTION_KEYS, INTERACTION_KEYS, path);
    if (value.schema !== MATTER_INTERACTION_SCHEMA) fail(`${path}.schema`, 'is unsupported');
    if (value.schemaVersion !== MATTER_INTERACTION_VERSION) fail(`${path}.schemaVersion`, 'is unsupported');
    identifier(value.eventId, `${path}.eventId`);
    identifier(value.kind, `${path}.kind`);
    uniqueStrings(value.targetRegionIds, `${path}.targetRegionIds`, { allowEmpty: false });
    const targetIds = new Set(value.targetRegionIds);

    exactKeys(value.attribution, ATTRIBUTION_KEYS, ATTRIBUTION_KEYS, `${path}.attribution`);
    if (!ATTRIBUTION_MODES.has(value.attribution.mode)) fail(`${path}.attribution.mode`, 'is ambiguous or unsupported');
    identifier(value.attribution.sourceId, `${path}.attribution.sourceId`);

    exactKeys(value.inputs, INTERACTION_INPUT_KEYS, INTERACTION_INPUT_KEYS, `${path}.inputs`);
    vector(value.inputs.impulseKgMPerS, `${path}.inputs.impulseKgMPerS`, 3);
    finite(value.inputs.energyJ, `${path}.inputs.energyJ`);
    finite(value.inputs.chargeC, `${path}.inputs.chargeC`);
    if (!Array.isArray(value.inputs.speciesTransfers)) fail(`${path}.inputs.speciesTransfers`, 'must be an array');
    for (const [index, transfer] of value.inputs.speciesTransfers.entries()) {
        const itemPath = `${path}.inputs.speciesTransfers[${index}]`;
        exactKeys(transfer, SPECIES_TRANSFER_KEYS, SPECIES_TRANSFER_KEYS, itemPath);
        identifier(transfer.speciesId, `${itemPath}.speciesId`);
        finite(transfer.massKg, `${itemPath}.massKg`, { minimum: Number.MIN_VALUE });
        const sourceRegionId = nullableIdentifier(transfer.sourceRegionId, `${itemPath}.sourceRegionId`);
        const targetRegionId = nullableIdentifier(transfer.targetRegionId, `${itemPath}.targetRegionId`);
        if (sourceRegionId === null && targetRegionId === null) fail(itemPath, 'must name a source or target region');
        if (sourceRegionId !== null && sourceRegionId === targetRegionId) fail(itemPath, 'must transfer between distinct regions');
        if (!targetIds.has(sourceRegionId) && !targetIds.has(targetRegionId)) {
            fail(itemPath, 'must involve at least one target region');
        }
    }
    return value;
}

function stampedInput(input, schema, version, path, defaults = {}) {
    const source = cloneStrictJson(input, path);
    record(source, path);
    if (source.schema != null && source.schema !== schema) fail(`${path}.schema`, 'is unsupported');
    if (source.schemaVersion != null && source.schemaVersion !== version) fail(`${path}.schemaVersion`, 'is unsupported');
    return { ...defaults, ...source, schema, schemaVersion: version };
}

export function createMatterDefinition(input) {
    const candidate = stampedInput(input, MATTER_DEFINITION_SCHEMA, MATTER_DEFINITION_VERSION, '$.matterDefinition', {
        modelBindings: [],
        missingParameters: [],
    });
    validateDefinitionValue(candidate, '$.matterDefinition');
    return deepFreezeJson(candidate, '$.matterDefinition');
}

export function validateMatterDefinition(value, path = '$.matterDefinition') {
    validateDefinitionValue(cloneStrictJson(value, path), String(path));
    return true;
}

export function createMatterState(input) {
    const candidate = stampedInput(input, MATTER_STATE_SCHEMA, MATTER_STATE_VERSION, '$.matterState', {
        revision: 0,
    });
    validateStateValue(candidate, '$.matterState');
    return retainMatterState(candidate, '$.matterState');
}

export function validateMatterState(value, path = '$.matterState') {
    if (compactStateLayouts.has(value) || immutableStates.has(value)) return true;
    validateStateValue(cloneStrictJson(value, path), String(path));
    return true;
}

function retainMatterState(value, path) {
    const snapshot = deepFreezeJson(value, path);
    immutableStates.add(snapshot);
    const keys = Object.keys(snapshot);
    if ((keys.length === COMPACT_STATE_KEYS.length || (keys.length === COMPACT_STATE_KEYS.length + 1 && keys[keys.length - 1] === 'derived'))
        && COMPACT_STATE_KEYS.every((key, index) => keys[index] === key)) compactStateLayouts.add(snapshot);
    return snapshot;
}

/** Reuse a proven immutable state, or detach and validate a raw state. Unlike
 * the constructor, this admission boundary never stamps missing schema data. */
export function snapshotMatterState(value, path = '$.matterState') {
    if (compactStateLayouts.has(value) || immutableStates.has(value)) return value;
    const candidate = cloneStrictJson(value, path);
    validateStateValue(candidate, String(path));
    return retainMatterState(candidate, path);
}

/** Create an empty root owner from admitted definition/representation metadata.
 * The template must have no species entries, momentum, heat or charge. Its
 * physical fields and derived caches are omitted; ancestry and revision start
 * afresh. Raw templates still cross the full state-admission boundary. */
export function createMatterEmptyState(templateState, regionId) {
    const template = snapshotMatterState(templateState, '$.matterEmptyTemplate');
    identifier(regionId, '$.matterState.regionId');
    if (!emptyStateTemplates.has(template)) {
        const inventory = template.conserved;
        if (Object.keys(inventory.speciesMassKg).length || inventory.momentumKgMPerS.some(value => value !== 0)
            || inventory.internalEnergyJ !== 0 || inventory.electricChargeC !== 0) {
            fail('$.matterEmptyTemplate.conserved', 'must be an exactly empty inventory');
        }
        emptyStateTemplates.add(template);
    }
    // Match createMatterState's root-constructor key order. Every shared child
    // was admitted and frozen above; only this identity and ancestry are new.
    const state = Object.freeze({
        revision: 0, regionId, definitionId: template.definitionId, definitionHash: template.definitionHash,
        representation: template.representation,
        ancestry: Object.freeze({ rootRegionId: regionId, parentRegionId: null, eventId: null, generation: 0 }),
        conserved: template.conserved, schema: MATTER_STATE_SCHEMA, schemaVersion: MATTER_STATE_VERSION,
    });
    compactStateLayouts.add(state);
    return state;
}

/** Detach raw containers; reuse only lists already admitted and frozen here. */
export function snapshotMatterStates(values, path = '$.matterStates') {
    if (immutableStateLists.has(values)) return values;
    const snapshot = Object.freeze(strictJsonArrayDescriptors(values, path).map((descriptor, index) => (
        snapshotMatterState(descriptor.value, `${path}[${index}]`)
    )));
    immutableStateLists.add(snapshot);
    return snapshot;
}

/** Replace conserved values while sharing proven immutable metadata. New
 * values use the constructor's same validators. Omit derived to preserve it,
 * or pass null to discard that cache; revision defaults to the next revision. */
export function replaceMatterConserved(value, conserved, options = EMPTY_STATE_CHANGE) {
    const state = snapshotMatterState(value), prepared = prepareMatterStateChange(state, options);
    const inventory = cloneAndFreezeStrictJson(conserved, '$.matterState.conserved');
    validateConserved(inventory, '$.matterState.conserved');
    return assembleMatterStateChange(state, inventory, prepared);
}

/** Replace only retained internal energy. Unchanged conserved descendants are
 * shared exclusively from an admitted canonical state; arbitrary supplied
 * inventories must still use replaceMatterConserved's full validation. */
export function replaceMatterInternalEnergy(value, internalEnergyJ, options = EMPTY_STATE_CHANGE) {
    const state = snapshotMatterState(value), prepared = prepareMatterStateChange(state, options);
    const energy = cloneStrictJson(internalEnergyJ, '$.matterState.conserved.internalEnergyJ');
    finite(energy, '$.matterState.conserved.internalEnergyJ', { minimum: 0 });
    const inventory = Object.freeze({ ...state.conserved, internalEnergyJ: energy });
    return assembleMatterStateChange(state, inventory, prepared);
}

const numericArrayPrototype = Object.getPrototypeOf(Uint32Array.prototype);
const numericArrayLength = Object.getOwnPropertyDescriptor(numericArrayPrototype, 'length').get;
const numericArrayBuffer = Object.getOwnPropertyDescriptor(numericArrayPrototype, 'buffer').get;
const ordinaryBufferByteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;

/** Detach numeric ABI input without invoking caller iterators or accessors.
 * Shared storage cannot supply an atomic snapshot of an inventory request. */
export function snapshotMatterNumericArray(value, Type, path) {
    if (Type !== Uint32Array && Type !== Float64Array) fail(path, 'unsupported numeric carrier type');
    if (!ArrayBuffer.isView(value) || Object.getPrototypeOf(value) !== Type.prototype) fail(path, `must be a ${Type.name}`);
    const buffer = numericArrayBuffer.call(value);
    // Intrinsic brand admission also rejects a SharedArrayBuffer from another
    // realm, for which a local instanceof SharedArrayBuffer would be false.
    try { ordinaryBufferByteLength.call(buffer); }
    catch (_error) { fail(path, 'must not use shared storage'); }
    const result = new Type(numericArrayLength.call(value));
    try { Type.prototype.set.call(result, value); }
    catch (_error) { fail(path, 'must have attached numeric storage'); }
    return result;
}

/** Replace a batch of conserved inventories from a sparse numeric carrier.
 * CSR species rows preserve absent versus explicit-zero species and key order.
 * Each dynamics row is momentum x/y/z, internal energy, then electric charge.
 * Admission copies every caller carrier before validating and committing it. */
export function replaceMatterConservedPacked(values, packed, options = EMPTY_STATE_CHANGE) {
    const states = snapshotMatterStates(values), path = '$.packedConserved';
    if (!states.length) fail('$.matterStates', 'must contain matter states');
    const keys = ['speciesIds', 'speciesOffsets', 'speciesIndices', 'speciesMassKg', 'dynamics'];
    if (!isPlainJsonObject(packed)) fail(path, 'must be a plain object');
    const fields = {};
    for (const key of Reflect.ownKeys(packed)) {
        if (!keys.includes(key)) fail(path, 'contains an unknown field');
        const descriptor = Object.getOwnPropertyDescriptor(packed, key);
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) fail(`${path}.${key}`, 'must be an enumerable data property');
        fields[key] = descriptor.value;
    }
    const speciesIds = cloneStrictJson(fields.speciesIds, `${path}.speciesIds`);
    uniqueStrings(speciesIds, `${path}.speciesIds`);
    // Identifiers become record keys, so strict JSON's forbidden-key rule also
    // applies even when an identifier has valid Matter identifier syntax.
    cloneStrictJson(Object.fromEntries(speciesIds.map(id => [id, 0])), `${path}.speciesMassKg`);
    const offsets = snapshotMatterNumericArray(fields.speciesOffsets, Uint32Array, `${path}.speciesOffsets`);
    const indices = snapshotMatterNumericArray(fields.speciesIndices, Uint32Array, `${path}.speciesIndices`);
    const masses = snapshotMatterNumericArray(fields.speciesMassKg, Float64Array, `${path}.speciesMassKg`);
    const dynamics = snapshotMatterNumericArray(fields.dynamics, Float64Array, `${path}.dynamics`);
    if (offsets.length !== states.length + 1 || offsets[0] !== 0 || offsets[offsets.length - 1] !== indices.length
        || masses.length !== indices.length || dynamics.length !== states.length * 5) fail(path, 'has inconsistent row dimensions');
    const prepared = prepareMatterStateChange(states[0] ?? { revision: 0 }, options);
    const changesRevision = Object.hasOwn(prepared.change, 'revision'), result = [];
    for (let row = 0; row < states.length; row++) {
        const start = offsets[row], end = offsets[row + 1], state = states[row];
        if (end < start || end > indices.length) fail(`${path}.speciesOffsets[${row + 1}]`, 'must be monotone and within the species carrier');
        const speciesMassKg = {};
        for (let lane = start; lane < end; lane++) {
            const speciesId = speciesIds[indices[lane]];
            if (speciesId === undefined) fail(`${path}.speciesIndices[${lane}]`, 'must address speciesIds');
            if (Object.hasOwn(speciesMassKg, speciesId)) fail(`${path}.speciesIndices[${lane}]`, 'duplicates a row species');
            speciesMassKg[speciesId] = finite(masses[lane], `$.matterState.conserved.speciesMassKg.${speciesId}`, { minimum: 0 });
        }
        const offset = row * 5;
        const momentumKgMPerS = Object.freeze([0, 1, 2].map(axis => finite(dynamics[offset + axis], `$.matterState.conserved.momentumKgMPerS[${axis}]`)));
        const internalEnergyJ = finite(dynamics[offset + 3], '$.matterState.conserved.internalEnergyJ', { minimum: 0 });
        const electricChargeC = finite(dynamics[offset + 4], '$.matterState.conserved.electricChargeC');
        const inventory = Object.freeze({ ...state.conserved, speciesMassKg: Object.freeze(speciesMassKg), momentumKgMPerS, internalEnergyJ, electricChargeC });
        const revision = changesRevision ? prepared.revision : integer(state.revision + 1, '$.matterState.revision');
        result.push(assembleMatterStateChange(state, inventory, { change: prepared.change, revision }));
    }
    const snapshot = Object.freeze(result); immutableStateLists.add(snapshot); return snapshot;
}

function prepareMatterStateChange(state, options) {
    let change = options === EMPTY_STATE_CHANGE ? EMPTY_STATE_CHANGE : null;
    if (!change && isPlainJsonObject(options)) {
        // These two scalar-only shapes need no recursive clone. Inspect every
        // own key and the data descriptor on each call; raw caller identity or
        // Object.freeze alone never supplies admission evidence.
        const keys = Reflect.ownKeys(options);
        if (!keys.length) change = EMPTY_STATE_CHANGE;
        else if (keys.length === 1 && keys[0] === 'derived') {
            const descriptor = Object.getOwnPropertyDescriptor(options, 'derived');
            if (descriptor?.enumerable && Object.hasOwn(descriptor, 'value') && descriptor.value === null) change = DISCARD_DERIVED_CHANGE;
        }
    }
    if (!change) {
        change = cloneAndFreezeStrictJson(options, '$.matterStateChange');
        exactKeys(change, STATE_CHANGE_KEYS, [], '$.matterStateChange');
    }
    const revision = integer(Object.hasOwn(change, 'revision') ? change.revision : state.revision + 1, '$.matterState.revision');
    return { change, revision };
}

function assembleMatterStateChange(state, inventory, { change, revision }) {
    // Preserve the constructor's serialization order, including raw states
    // whose caller supplied revision after other keys. Only a private proof
    // admits the common root layout; every other layout keeps the generic path.
    const compact = compactStateLayouts.has(state);
    const candidate = compact ? {
        revision, regionId: state.regionId, definitionId: state.definitionId, definitionHash: state.definitionHash,
        representation: state.representation, ancestry: state.ancestry, conserved: inventory,
        schema: state.schema, schemaVersion: state.schemaVersion,
    } : Object.assign({ revision }, state);
    if (compact) {
        if (!Object.hasOwn(change, 'derived') && Object.hasOwn(state, 'derived')) candidate.derived = state.derived;
    } else {
        candidate.conserved = inventory;
        candidate.revision = revision;
    }
    if (Object.hasOwn(change, 'derived')) {
        if (change.derived === null) delete candidate.derived;
        else {
            // Only internally cloned and frozen change records reach this
            // helper. A packed commit can prove its shared derived value once.
            if (!validatedDerivedChanges.has(change)) {
                validateDerived(change.derived, '$.matterState.derived');
                validatedDerivedChanges.add(change);
            }
            candidate.derived = change.derived;
        }
    }
    Object.freeze(candidate);
    // Compact provenance already proves full immutable admission. Recording
    // the same replacement in both weak sets would duplicate hot-path work.
    if (compact) compactStateLayouts.add(candidate);
    else immutableStates.add(candidate);
    return candidate;
}

export function createMatterInteraction(input) {
    const candidate = stampedInput(input, MATTER_INTERACTION_SCHEMA, MATTER_INTERACTION_VERSION, '$.matterInteraction', {
        inputs: {
            impulseKgMPerS: [0, 0, 0],
            energyJ: 0,
            chargeC: 0,
            speciesTransfers: [],
        },
    });
    candidate.inputs = {
        impulseKgMPerS: [0, 0, 0],
        energyJ: 0,
        chargeC: 0,
        speciesTransfers: [],
        ...candidate.inputs,
    };
    validateInteractionValue(candidate, '$.matterInteraction');
    return deepFreezeJson(candidate, '$.matterInteraction');
}

export function validateMatterInteraction(value, path = '$.matterInteraction') {
    validateInteractionValue(cloneStrictJson(value, path), String(path));
    return true;
}
