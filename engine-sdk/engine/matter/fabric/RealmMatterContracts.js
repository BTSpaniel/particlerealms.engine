// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Versioned, immutable contracts for definitions, states, observations, and transformations. */

import { cloneStrictJson } from '../../core/schema/StrictJsonValue.js';
import {
    cloneStamped,
    fail,
    freeze,
    requireBoolean,
    requireEnum,
    requireExactKeys,
    requireFinite,
    requireHash,
    requireIdentifier,
    requireIdentifierArray,
    requireInteger,
    requireNumberRecord,
    requireRecord,
    requireString,
} from './FabricSupport.js';

export const REALM_MATTER_DEFINITION_SCHEMA = 'engine.matter.fabric.definition';
export const REALM_MATTER_DEFINITION_VERSION = '1.0.0';
export const REALM_CANONICAL_IDENTIFIER_SCHEMA = 'engine.matter.fabric.canonical-identifier';
export const REALM_CANONICAL_IDENTIFIER_VERSION = '1.0.0';
export const REALM_MATTER_STATE_SCHEMA = 'engine.matter.fabric.state';
export const REALM_MATTER_STATE_VERSION = '1.0.0';
export const REALM_COMPOSITION_PROFILE_SCHEMA = 'engine.matter.fabric.composition-profile';
export const REALM_COMPOSITION_PROFILE_VERSION = '1.0.0';
export const REALM_PHASE_PROFILE_SCHEMA = 'engine.matter.fabric.phase-profile';
export const REALM_PHASE_PROFILE_VERSION = '1.0.0';
export const REALM_MICROSTRUCTURE_PROFILE_SCHEMA = 'engine.matter.fabric.microstructure-profile';
export const REALM_MICROSTRUCTURE_PROFILE_VERSION = '1.0.0';
export const REALM_HISTORY_PROFILE_SCHEMA = 'engine.matter.fabric.history-profile';
export const REALM_HISTORY_PROFILE_VERSION = '1.0.0';
export const REALM_GEOMETRY_PROFILE_SCHEMA = 'engine.matter.fabric.geometry-profile';
export const REALM_GEOMETRY_PROFILE_VERSION = '1.0.0';
export const REALM_PROPERTY_OBSERVATION_SCHEMA = 'engine.matter.fabric.property-observation';
export const REALM_PROPERTY_OBSERVATION_VERSION = '1.0.0';
export const REALM_TRANSFORMATION_SCHEMA = 'engine.matter.fabric.transformation';
export const REALM_TRANSFORMATION_VERSION = '1.0.0';
export const REALM_EVIDENCE_SCHEMA = 'engine.matter.fabric.evidence';
export const REALM_EVIDENCE_VERSION = '1.0.0';

export const REALM_EVIDENCE_CLASSES = Object.freeze([
    'EVALUATED', 'MEASURED', 'COMPUTED', 'CURATED', 'INFERRED',
    'PREDICTED', 'PROCEDURAL', 'FICTIONAL', 'UNKNOWN',
]);
export const REALM_DEFINITION_KINDS = Object.freeze([
    'isotope', 'element', 'species', 'compound', 'mixture', 'material',
    'stock', 'component', 'assembly', 'debris', 'reservoir',
]);
export const REALM_TRANSFORMATION_CATEGORIES = Object.freeze([
    'nuclear', 'electronic', 'chemical', 'phase', 'mixing', 'separation',
    'microstructural', 'mechanical', 'assembly', 'environmental',
    'biological', 'recycling', 'disposal', 'realm-specific',
]);

const EVIDENCE = new Set(REALM_EVIDENCE_CLASSES);
const DEFINITION_KINDS = new Set(REALM_DEFINITION_KINDS);
const TRANSFORMATION_CATEGORIES = new Set(REALM_TRANSFORMATION_CATEGORIES);
const COMPOSITION_BASES = new Set(['mass', 'mole', 'volume', 'particle']);
const INTENTS = new Set(['intentional', 'spontaneous', 'environmental', 'simulation']);
const RELATIONSHIPS = new Set(['new-instance', 'same-instance', 'descendant-instance', 'environment']);
const RESERVOIR_DIRECTIONS = new Set(['input', 'output']);
const INTERPOLATIONS = new Set(['none', 'nearest', 'linear', 'log-linear']);
const PHASES = new Set(['solid', 'liquid', 'gas', 'plasma', 'supercritical', 'slurry']);
// Only this constructor's fully admitted, recursively frozen transformations
// carry schema proof. Caller-frozen records still cross strict JSON admission.
const immutableTransformations = new WeakSet();

const EVIDENCE_KEYS = new Set(['schema', 'schemaVersion', 'class', 'confidence', 'sourceIds', 'method', 'reviewed']);
const ALIAS_KEYS = new Set(['namespace', 'value']);
const CANONICAL_IDENTIFIER_KEYS = new Set(['schema', 'schemaVersion', 'id', 'aliases']);
const CONSTITUENT_KEYS = new Set([
    'constituentId', 'fraction', 'elementAmountsMol', 'isotopeAmountsMol', 'chargeNumber',
]);
const RANGE_KEYS = new Set(['minimum', 'maximum']);
const PROFILE_REF_KEYS = new Set(['composition', 'phase', 'microstructure', 'history', 'geometry']);

function optionalIdentifier(value, path) {
    return value === null ? null : requireIdentifier(value, path);
}

function optionalFinite(value, path, options = {}) {
    return value === null ? null : requireFinite(value, path, options);
}

function validateEvidence(value, path) {
    requireExactKeys(value, EVIDENCE_KEYS, EVIDENCE_KEYS, path);
    if (value.schema !== REALM_EVIDENCE_SCHEMA) fail(`${path}.schema`, 'is unsupported');
    if (value.schemaVersion !== REALM_EVIDENCE_VERSION) fail(`${path}.schemaVersion`, 'is unsupported');
    requireEnum(value.class, EVIDENCE, `${path}.class`);
    requireFinite(value.confidence, `${path}.confidence`, { minimum: 0, maximum: 1 });
    requireIdentifierArray(value.sourceIds, `${path}.sourceIds`);
    requireString(value.method, `${path}.method`, { maximum: 512 });
    requireBoolean(value.reviewed, `${path}.reviewed`);
    if (value.class === 'FICTIONAL' && value.sourceIds.length !== 0) {
        fail(`${path}.sourceIds`, 'fictional evidence must not claim scientific sources');
    }
    if ((value.class === 'EVALUATED' || value.class === 'MEASURED') && value.sourceIds.length === 0) {
        fail(`${path}.sourceIds`, 'evaluated and measured evidence require a source');
    }
    return value;
}

function validateAlias(value, path) {
    requireExactKeys(value, ALIAS_KEYS, ALIAS_KEYS, path);
    requireIdentifier(value.namespace, `${path}.namespace`);
    requireString(value.value, `${path}.value`, { maximum: 256 });
    return value;
}

function validateCanonicalIdentifierValue(value, path) {
    requireExactKeys(value, CANONICAL_IDENTIFIER_KEYS, CANONICAL_IDENTIFIER_KEYS, path);
    if (value.schema !== REALM_CANONICAL_IDENTIFIER_SCHEMA) fail(`${path}.schema`, 'is unsupported');
    if (value.schemaVersion !== REALM_CANONICAL_IDENTIFIER_VERSION) fail(`${path}.schemaVersion`, 'is unsupported');
    requireIdentifier(value.id, `${path}.id`);
    if (!Array.isArray(value.aliases)) fail(`${path}.aliases`, 'must be an array');
    const keys = new Set();
    value.aliases.forEach((alias, index) => {
        validateAlias(alias, `${path}.aliases[${index}]`);
        const key = `${alias.namespace}\u0000${alias.value.normalize('NFKC').toLowerCase()}`;
        if (keys.has(key)) fail(`${path}.aliases[${index}]`, 'duplicates an earlier alias');
        keys.add(key);
    });
    return value;
}

function validateRange(value, path, { minimum = -Number.MAX_VALUE, allowOpenMaximum = false } = {}) {
    requireExactKeys(value, RANGE_KEYS, RANGE_KEYS, path);
    requireFinite(value.minimum, `${path}.minimum`, { minimum });
    if (allowOpenMaximum && value.maximum === null) return value;
    requireFinite(value.maximum, `${path}.maximum`, { minimum: value.minimum });
    return value;
}

function validateProfileRefs(value, path) {
    requireExactKeys(value, PROFILE_REF_KEYS, PROFILE_REF_KEYS, path);
    for (const key of PROFILE_REF_KEYS) optionalIdentifier(value[key], `${path}.${key}`);
    return value;
}

function sumFractions(entries, valueOf, path) {
    let sum = 0;
    let compensation = 0;
    for (const entry of entries) {
        const corrected = valueOf(entry) - compensation;
        const next = sum + corrected;
        compensation = (next - sum) - corrected;
        sum = next;
    }
    if (Math.abs(sum - 1) > 1e-9) fail(path, 'fractions must sum to 1');
}

const COMPOSITION_KEYS = new Set(['schema', 'schemaVersion', 'id', 'basis', 'constituents', 'evidence']);
function validateCompositionProfileValue(value, path) {
    requireExactKeys(value, COMPOSITION_KEYS, COMPOSITION_KEYS, path);
    if (value.schema !== REALM_COMPOSITION_PROFILE_SCHEMA) fail(`${path}.schema`, 'is unsupported');
    if (value.schemaVersion !== REALM_COMPOSITION_PROFILE_VERSION) fail(`${path}.schemaVersion`, 'is unsupported');
    requireIdentifier(value.id, `${path}.id`);
    requireEnum(value.basis, COMPOSITION_BASES, `${path}.basis`);
    if (!Array.isArray(value.constituents) || value.constituents.length === 0) {
        fail(`${path}.constituents`, 'must be a non-empty array');
    }
    const ids = new Set();
    value.constituents.forEach((entry, index) => {
        const itemPath = `${path}.constituents[${index}]`;
        requireExactKeys(entry, CONSTITUENT_KEYS, CONSTITUENT_KEYS, itemPath);
        const id = requireIdentifier(entry.constituentId, `${itemPath}.constituentId`);
        if (ids.has(id)) fail(`${itemPath}.constituentId`, 'duplicates an earlier constituent');
        ids.add(id);
        requireFinite(entry.fraction, `${itemPath}.fraction`, { minimum: 0, maximum: 1 });
        requireNumberRecord(entry.elementAmountsMol, `${itemPath}.elementAmountsMol`, { minimum: 0 });
        requireNumberRecord(entry.isotopeAmountsMol, `${itemPath}.isotopeAmountsMol`, { minimum: 0 });
        requireInteger(entry.chargeNumber, `${itemPath}.chargeNumber`, {
            minimum: -Number.MAX_SAFE_INTEGER,
            maximum: Number.MAX_SAFE_INTEGER,
        });
    });
    sumFractions(value.constituents, entry => entry.fraction, `${path}.constituents`);
    validateEvidence(value.evidence, `${path}.evidence`);
    return value;
}

const PHASE_KEYS = new Set([
    'schema', 'schemaVersion', 'id', 'temperatureRangeK', 'pressureRangePa', 'phaseFractions', 'evidence',
]);
function validatePhaseProfileValue(value, path) {
    requireExactKeys(value, PHASE_KEYS, PHASE_KEYS, path);
    if (value.schema !== REALM_PHASE_PROFILE_SCHEMA) fail(`${path}.schema`, 'is unsupported');
    if (value.schemaVersion !== REALM_PHASE_PROFILE_VERSION) fail(`${path}.schemaVersion`, 'is unsupported');
    requireIdentifier(value.id, `${path}.id`);
    validateRange(value.temperatureRangeK, `${path}.temperatureRangeK`, { minimum: 0 });
    validateRange(value.pressureRangePa, `${path}.pressureRangePa`, { minimum: 0 });
    requireRecord(value.phaseFractions, `${path}.phaseFractions`);
    const entries = Object.entries(value.phaseFractions);
    if (entries.length === 0) fail(`${path}.phaseFractions`, 'must not be empty');
    entries.forEach(([phase, fraction]) => {
        requireEnum(phase, PHASES, `${path}.phaseFractions key`);
        requireFinite(fraction, `${path}.phaseFractions.${phase}`, { minimum: 0, maximum: 1 });
    });
    sumFractions(entries, entry => entry[1], `${path}.phaseFractions`);
    validateEvidence(value.evidence, `${path}.evidence`);
    return value;
}

const MICROSTRUCTURE_KEYS = new Set([
    'schema', 'schemaVersion', 'id', 'phaseIds', 'grainSizeM', 'porosityFraction',
    'orientation', 'defects', 'tags', 'evidence',
]);
function validateMicrostructureProfileValue(value, path) {
    requireExactKeys(value, MICROSTRUCTURE_KEYS, MICROSTRUCTURE_KEYS, path);
    if (value.schema !== REALM_MICROSTRUCTURE_PROFILE_SCHEMA) fail(`${path}.schema`, 'is unsupported');
    if (value.schemaVersion !== REALM_MICROSTRUCTURE_PROFILE_VERSION) fail(`${path}.schemaVersion`, 'is unsupported');
    requireIdentifier(value.id, `${path}.id`);
    requireIdentifierArray(value.phaseIds, `${path}.phaseIds`);
    optionalFinite(value.grainSizeM, `${path}.grainSizeM`, { minimum: Number.MIN_VALUE });
    requireFinite(value.porosityFraction, `${path}.porosityFraction`, { minimum: 0, maximum: 1 });
    requireString(value.orientation, `${path}.orientation`, { maximum: 128 });
    requireIdentifierArray(value.defects, `${path}.defects`);
    requireIdentifierArray(value.tags, `${path}.tags`);
    validateEvidence(value.evidence, `${path}.evidence`);
    return value;
}

const HISTORY_KEYS = new Set([
    'schema', 'schemaVersion', 'id', 'processTags', 'transformationIds', 'notes', 'evidence',
]);
function validateHistoryProfileValue(value, path) {
    requireExactKeys(value, HISTORY_KEYS, HISTORY_KEYS, path);
    if (value.schema !== REALM_HISTORY_PROFILE_SCHEMA) fail(`${path}.schema`, 'is unsupported');
    if (value.schemaVersion !== REALM_HISTORY_PROFILE_VERSION) fail(`${path}.schemaVersion`, 'is unsupported');
    requireIdentifier(value.id, `${path}.id`);
    requireIdentifierArray(value.processTags, `${path}.processTags`);
    requireIdentifierArray(value.transformationIds, `${path}.transformationIds`);
    requireString(value.notes, `${path}.notes`, { maximum: 2048, allowEmpty: true });
    validateEvidence(value.evidence, `${path}.evidence`);
    return value;
}

const GEOMETRY_KEYS = new Set([
    'schema', 'schemaVersion', 'id', 'form', 'dimensionsM', 'surfaceAreaM2', 'volumeM3',
    'geometryRef', 'orientation', 'evidence',
]);
function validateGeometryProfileValue(value, path) {
    requireExactKeys(value, GEOMETRY_KEYS, GEOMETRY_KEYS, path);
    if (value.schema !== REALM_GEOMETRY_PROFILE_SCHEMA) fail(`${path}.schema`, 'is unsupported');
    if (value.schemaVersion !== REALM_GEOMETRY_PROFILE_VERSION) fail(`${path}.schemaVersion`, 'is unsupported');
    requireIdentifier(value.id, `${path}.id`);
    requireIdentifier(value.form, `${path}.form`);
    if (!Array.isArray(value.dimensionsM) || value.dimensionsM.length > 4) fail(`${path}.dimensionsM`, 'must have at most four dimensions');
    value.dimensionsM.forEach((entry, index) => requireFinite(entry, `${path}.dimensionsM[${index}]`, { minimum: 0 }));
    optionalFinite(value.surfaceAreaM2, `${path}.surfaceAreaM2`, { minimum: 0 });
    optionalFinite(value.volumeM3, `${path}.volumeM3`, { minimum: 0 });
    if (value.geometryRef !== null) requireString(value.geometryRef, `${path}.geometryRef`, { maximum: 512 });
    requireString(value.orientation, `${path}.orientation`, { maximum: 128 });
    validateEvidence(value.evidence, `${path}.evidence`);
    return value;
}

const DEFINITION_KEYS = new Set([
    'schema', 'schemaVersion', 'id', 'label', 'kind', 'aliases', 'profileRefs',
    'propertyObservationIds', 'tags', 'evidence',
]);
function validateDefinitionValue(value, path) {
    requireExactKeys(value, DEFINITION_KEYS, DEFINITION_KEYS, path);
    if (value.schema !== REALM_MATTER_DEFINITION_SCHEMA) fail(`${path}.schema`, 'is unsupported');
    if (value.schemaVersion !== REALM_MATTER_DEFINITION_VERSION) fail(`${path}.schemaVersion`, 'is unsupported');
    requireIdentifier(value.id, `${path}.id`);
    requireString(value.label, `${path}.label`, { maximum: 256 });
    requireEnum(value.kind, DEFINITION_KINDS, `${path}.kind`);
    if (!Array.isArray(value.aliases)) fail(`${path}.aliases`, 'must be an array');
    const aliases = new Set();
    value.aliases.forEach((alias, index) => {
        validateAlias(alias, `${path}.aliases[${index}]`);
        const key = `${alias.namespace}\u0000${alias.value.normalize('NFKC').toLowerCase()}`;
        if (aliases.has(key)) fail(`${path}.aliases[${index}]`, 'duplicates an earlier alias');
        aliases.add(key);
    });
    validateProfileRefs(value.profileRefs, `${path}.profileRefs`);
    requireIdentifierArray(value.propertyObservationIds, `${path}.propertyObservationIds`);
    requireIdentifierArray(value.tags, `${path}.tags`);
    validateEvidence(value.evidence, `${path}.evidence`);
    return value;
}

const QUANTITY_KEYS = new Set(['massKg', 'volumeM3', 'chargeC']);
const ENVIRONMENT_KEYS = new Set([
    'temperatureK', 'pressurePa', 'moistureFraction', 'damageFraction', 'oxidationFraction', 'atmosphereId',
]);
const STATE_KEYS = new Set([
    'schema', 'schemaVersion', 'instanceId', 'soulSeedId', 'definitionId', 'revision',
    'quantity', 'profileRefs', 'environment', 'historyEventIds', 'parentInstanceIds',
]);
function validateStateValue(value, path) {
    requireExactKeys(value, STATE_KEYS, STATE_KEYS, path);
    if (value.schema !== REALM_MATTER_STATE_SCHEMA) fail(`${path}.schema`, 'is unsupported');
    if (value.schemaVersion !== REALM_MATTER_STATE_VERSION) fail(`${path}.schemaVersion`, 'is unsupported');
    requireIdentifier(value.instanceId, `${path}.instanceId`);
    requireIdentifier(value.soulSeedId, `${path}.soulSeedId`);
    requireIdentifier(value.definitionId, `${path}.definitionId`);
    requireInteger(value.revision, `${path}.revision`);
    requireExactKeys(value.quantity, QUANTITY_KEYS, QUANTITY_KEYS, `${path}.quantity`);
    requireFinite(value.quantity.massKg, `${path}.quantity.massKg`, { minimum: 0 });
    requireFinite(value.quantity.volumeM3, `${path}.quantity.volumeM3`, { minimum: 0 });
    requireFinite(value.quantity.chargeC, `${path}.quantity.chargeC`);
    validateProfileRefs(value.profileRefs, `${path}.profileRefs`);
    requireExactKeys(value.environment, ENVIRONMENT_KEYS, ENVIRONMENT_KEYS, `${path}.environment`);
    requireFinite(value.environment.temperatureK, `${path}.environment.temperatureK`, { minimum: 0 });
    requireFinite(value.environment.pressurePa, `${path}.environment.pressurePa`, { minimum: 0 });
    requireFinite(value.environment.moistureFraction, `${path}.environment.moistureFraction`, { minimum: 0, maximum: 1 });
    requireFinite(value.environment.damageFraction, `${path}.environment.damageFraction`, { minimum: 0, maximum: 1 });
    requireFinite(value.environment.oxidationFraction, `${path}.environment.oxidationFraction`, { minimum: 0, maximum: 1 });
    optionalIdentifier(value.environment.atmosphereId, `${path}.environment.atmosphereId`);
    requireIdentifierArray(value.historyEventIds, `${path}.historyEventIds`);
    requireIdentifierArray(value.parentInstanceIds, `${path}.parentInstanceIds`);
    if (value.parentInstanceIds.includes(value.instanceId)) fail(`${path}.parentInstanceIds`, 'cannot contain the instance itself');
    return value;
}

const OBSERVATION_VALUE_KEYS = new Set(['minimum', 'nominal', 'maximum', 'unit']);
const OBSERVATION_CONDITION_KEYS = new Set([
    'temperatureRangeK', 'pressureRangePa', 'moistureRange', 'direction', 'strainRateRangePerS',
    'phaseProfileId', 'microstructureProfileId', 'historyProfileId',
]);
const UNCERTAINTY_KEYS = new Set(['absolute', 'relative']);
const OBSERVATION_KEYS = new Set([
    'schema', 'schemaVersion', 'id', 'definitionId', 'propertyId', 'value', 'conditions',
    'uncertainty', 'method', 'interpolation', 'evidence', 'tags',
]);
function validateObservationValue(value, path) {
    requireExactKeys(value, OBSERVATION_KEYS, OBSERVATION_KEYS, path);
    if (value.schema !== REALM_PROPERTY_OBSERVATION_SCHEMA) fail(`${path}.schema`, 'is unsupported');
    if (value.schemaVersion !== REALM_PROPERTY_OBSERVATION_VERSION) fail(`${path}.schemaVersion`, 'is unsupported');
    requireIdentifier(value.id, `${path}.id`);
    requireIdentifier(value.definitionId, `${path}.definitionId`);
    requireIdentifier(value.propertyId, `${path}.propertyId`);
    requireExactKeys(value.value, OBSERVATION_VALUE_KEYS, OBSERVATION_VALUE_KEYS, `${path}.value`);
    requireFinite(value.value.minimum, `${path}.value.minimum`);
    requireFinite(value.value.nominal, `${path}.value.nominal`, { minimum: value.value.minimum });
    requireFinite(value.value.maximum, `${path}.value.maximum`, { minimum: value.value.nominal });
    requireString(value.value.unit, `${path}.value.unit`, { maximum: 64 });
    requireExactKeys(value.conditions, OBSERVATION_CONDITION_KEYS, OBSERVATION_CONDITION_KEYS, `${path}.conditions`);
    validateRange(value.conditions.temperatureRangeK, `${path}.conditions.temperatureRangeK`, { minimum: 0 });
    validateRange(value.conditions.pressureRangePa, `${path}.conditions.pressureRangePa`, { minimum: 0 });
    validateRange(value.conditions.moistureRange, `${path}.conditions.moistureRange`, { minimum: 0 });
    if (value.conditions.moistureRange.maximum > 1) fail(`${path}.conditions.moistureRange.maximum`, 'must be <= 1');
    requireString(value.conditions.direction, `${path}.conditions.direction`, { maximum: 128 });
    validateRange(value.conditions.strainRateRangePerS, `${path}.conditions.strainRateRangePerS`, { minimum: 0 });
    optionalIdentifier(value.conditions.phaseProfileId, `${path}.conditions.phaseProfileId`);
    optionalIdentifier(value.conditions.microstructureProfileId, `${path}.conditions.microstructureProfileId`);
    optionalIdentifier(value.conditions.historyProfileId, `${path}.conditions.historyProfileId`);
    requireExactKeys(value.uncertainty, UNCERTAINTY_KEYS, UNCERTAINTY_KEYS, `${path}.uncertainty`);
    requireFinite(value.uncertainty.absolute, `${path}.uncertainty.absolute`, { minimum: 0 });
    requireFinite(value.uncertainty.relative, `${path}.uncertainty.relative`, { minimum: 0 });
    requireString(value.method, `${path}.method`, { maximum: 512 });
    requireEnum(value.interpolation, INTERPOLATIONS, `${path}.interpolation`);
    validateEvidence(value.evidence, `${path}.evidence`);
    requireIdentifierArray(value.tags, `${path}.tags`);
    return value;
}

const FLOW_KEYS = new Set([
    'definitionId', 'role', 'relationship', 'consumed', 'massKg', 'constituentMassKg',
    'elementAmountsMol', 'isotopeAmountsMol', 'chargeC', 'stateEffectTags',
]);
function validateFlow(value, path) {
    requireExactKeys(value, FLOW_KEYS, FLOW_KEYS, path);
    requireIdentifier(value.definitionId, `${path}.definitionId`);
    requireIdentifier(value.role, `${path}.role`);
    requireEnum(value.relationship, RELATIONSHIPS, `${path}.relationship`);
    requireBoolean(value.consumed, `${path}.consumed`);
    requireFinite(value.massKg, `${path}.massKg`, { minimum: 0 });
    requireNumberRecord(value.constituentMassKg, `${path}.constituentMassKg`, { minimum: 0 });
    requireNumberRecord(value.elementAmountsMol, `${path}.elementAmountsMol`, { minimum: 0 });
    requireNumberRecord(value.isotopeAmountsMol, `${path}.isotopeAmountsMol`, { minimum: 0 });
    requireFinite(value.chargeC, `${path}.chargeC`);
    requireIdentifierArray(value.stateEffectTags, `${path}.stateEffectTags`);
    if (!value.consumed && (value.massKg !== 0 || Object.keys(value.constituentMassKg).length !== 0
        || Object.keys(value.elementAmountsMol).length !== 0 || Object.keys(value.isotopeAmountsMol).length !== 0
        || value.chargeC !== 0)) {
        fail(path, 'non-consumed selectors must not contribute conserved quantities');
    }
    return value;
}

const CONDITIONS_KEYS = new Set([
    'temperatureRangeK', 'pressureRangePa', 'durationRangeS', 'energyRangeJ', 'atmosphereIds', 'requiredTags',
]);
function validateConditions(value, path) {
    requireExactKeys(value, CONDITIONS_KEYS, CONDITIONS_KEYS, path);
    validateRange(value.temperatureRangeK, `${path}.temperatureRangeK`, { minimum: 0, allowOpenMaximum: true });
    validateRange(value.pressureRangePa, `${path}.pressureRangePa`, { minimum: 0, allowOpenMaximum: true });
    validateRange(value.durationRangeS, `${path}.durationRangeS`, { minimum: 0, allowOpenMaximum: true });
    validateRange(value.energyRangeJ, `${path}.energyRangeJ`, { minimum: 0, allowOpenMaximum: true });
    requireIdentifierArray(value.atmosphereIds, `${path}.atmosphereIds`);
    requireIdentifierArray(value.requiredTags, `${path}.requiredTags`);
    return value;
}

const EQUIPMENT_KEYS = new Set(['selectorId', 'consumed']);
function validateEquipment(value, path) {
    requireExactKeys(value, EQUIPMENT_KEYS, EQUIPMENT_KEYS, path);
    requireIdentifier(value.selectorId, `${path}.selectorId`);
    requireBoolean(value.consumed, `${path}.consumed`);
    return value;
}

const RESERVOIR_KEYS = new Set([
    'reservoirId', 'direction', 'massKg', 'constituentMassKg', 'elementAmountsMol', 'isotopeAmountsMol', 'chargeC',
]);
function validateReservoir(value, path) {
    requireExactKeys(value, RESERVOIR_KEYS, RESERVOIR_KEYS, path);
    requireIdentifier(value.reservoirId, `${path}.reservoirId`);
    requireEnum(value.direction, RESERVOIR_DIRECTIONS, `${path}.direction`);
    requireFinite(value.massKg, `${path}.massKg`, { minimum: 0 });
    requireNumberRecord(value.constituentMassKg, `${path}.constituentMassKg`, { minimum: 0 });
    requireNumberRecord(value.elementAmountsMol, `${path}.elementAmountsMol`, { minimum: 0 });
    requireNumberRecord(value.isotopeAmountsMol, `${path}.isotopeAmountsMol`, { minimum: 0 });
    requireFinite(value.chargeC, `${path}.chargeC`);
    return value;
}

const CONSERVATION_KEYS = new Set([
    'mass', 'constituents', 'elements', 'isotopes', 'charge', 'allowEnvironmentalExchange',
    'absoluteTolerance', 'relativeTolerance',
]);
function validateConservation(value, path) {
    requireExactKeys(value, CONSERVATION_KEYS, CONSERVATION_KEYS, path);
    for (const key of ['mass', 'constituents', 'elements', 'isotopes', 'charge', 'allowEnvironmentalExchange']) {
        requireBoolean(value[key], `${path}.${key}`);
    }
    requireFinite(value.absoluteTolerance, `${path}.absoluteTolerance`, { minimum: 0 });
    requireFinite(value.relativeTolerance, `${path}.relativeTolerance`, { minimum: 0 });
    return value;
}

const COST_KEYS = new Set(['operations', 'energyJ', 'durationS', 'wasteKg', 'economic']);
const TRANSFORMATION_KEYS = new Set([
    'schema', 'schemaVersion', 'id', 'label', 'category', 'intent', 'physicsDomain',
    'inputs', 'outputs', 'byproducts', 'conditions', 'equipment', 'reservoirs',
    'conservation', 'cost', 'evidence', 'tags',
]);
function validateTransformationValue(value, path) {
    requireExactKeys(value, TRANSFORMATION_KEYS, TRANSFORMATION_KEYS, path);
    if (value.schema !== REALM_TRANSFORMATION_SCHEMA) fail(`${path}.schema`, 'is unsupported');
    if (value.schemaVersion !== REALM_TRANSFORMATION_VERSION) fail(`${path}.schemaVersion`, 'is unsupported');
    requireIdentifier(value.id, `${path}.id`);
    requireString(value.label, `${path}.label`, { maximum: 256 });
    requireEnum(value.category, TRANSFORMATION_CATEGORIES, `${path}.category`);
    requireEnum(value.intent, INTENTS, `${path}.intent`);
    requireIdentifier(value.physicsDomain, `${path}.physicsDomain`);
    for (const [field, allowEmpty] of [['inputs', false], ['outputs', false], ['byproducts', true]]) {
        if (!Array.isArray(value[field]) || (!allowEmpty && value[field].length === 0)) {
            fail(`${path}.${field}`, allowEmpty ? 'must be an array' : 'must be a non-empty array');
        }
        value[field].forEach((flow, index) => validateFlow(flow, `${path}.${field}[${index}]`));
    }
    const sameInstanceOutputs = value.outputs.filter(flow => flow.relationship === 'same-instance');
    if (sameInstanceOutputs.length > 0
        && (sameInstanceOutputs.length !== 1 || value.inputs.filter(flow => flow.consumed).length !== 1)) {
        fail(`${path}.outputs`, 'same-instance transformation requires exactly one consumed input and one same-instance output');
    }
    validateConditions(value.conditions, `${path}.conditions`);
    if (!Array.isArray(value.equipment)) fail(`${path}.equipment`, 'must be an array');
    const equipmentIds = new Set();
    value.equipment.forEach((entry, index) => {
        validateEquipment(entry, `${path}.equipment[${index}]`);
        if (equipmentIds.has(entry.selectorId)) fail(`${path}.equipment[${index}]`, 'duplicates an earlier selector');
        equipmentIds.add(entry.selectorId);
    });
    if (!Array.isArray(value.reservoirs)) fail(`${path}.reservoirs`, 'must be an array');
    value.reservoirs.forEach((entry, index) => validateReservoir(entry, `${path}.reservoirs[${index}]`));
    if (!value.conservation.allowEnvironmentalExchange && value.reservoirs.length !== 0) {
        fail(`${path}.reservoirs`, 'must be empty when environmental exchange is disabled');
    }
    validateConservation(value.conservation, `${path}.conservation`);
    requireExactKeys(value.cost, COST_KEYS, COST_KEYS, `${path}.cost`);
    requireInteger(value.cost.operations, `${path}.cost.operations`, { minimum: 1 });
    requireFinite(value.cost.energyJ, `${path}.cost.energyJ`, { minimum: 0 });
    requireFinite(value.cost.durationS, `${path}.cost.durationS`, { minimum: 0 });
    requireFinite(value.cost.wasteKg, `${path}.cost.wasteKg`, { minimum: 0 });
    requireFinite(value.cost.economic, `${path}.cost.economic`, { minimum: 0 });
    validateEvidence(value.evidence, `${path}.evidence`);
    requireIdentifierArray(value.tags, `${path}.tags`);
    if (value.evidence.class === 'FICTIONAL' && value.physicsDomain !== 'realm-specific') {
        fail(`${path}.physicsDomain`, 'fictional transformations must use realm-specific physics');
    }
    return value;
}

function createContract(input, schema, schemaVersion, path, validate, defaults = {}) {
    const candidate = cloneStamped(input, { schema, schemaVersion, path, defaults });
    validate(candidate, path);
    return freeze(candidate, path);
}

function validateContract(value, path, validate) {
    validate(cloneStrictJson(value, path), String(path));
    return true;
}

export function createRealmCompositionProfile(input) {
    return createContract(input, REALM_COMPOSITION_PROFILE_SCHEMA, REALM_COMPOSITION_PROFILE_VERSION,
        '$.compositionProfile', validateCompositionProfileValue);
}
export function createRealmCanonicalIdentifier(input) {
    return createContract(input, REALM_CANONICAL_IDENTIFIER_SCHEMA, REALM_CANONICAL_IDENTIFIER_VERSION,
        '$.canonicalIdentifier', validateCanonicalIdentifierValue, { aliases: [] });
}
export function validateRealmCanonicalIdentifier(value, path = '$.canonicalIdentifier') {
    return validateContract(value, path, validateCanonicalIdentifierValue);
}
export function validateRealmCompositionProfile(value, path = '$.compositionProfile') {
    return validateContract(value, path, validateCompositionProfileValue);
}
export function createRealmPhaseProfile(input) {
    return createContract(input, REALM_PHASE_PROFILE_SCHEMA, REALM_PHASE_PROFILE_VERSION,
        '$.phaseProfile', validatePhaseProfileValue);
}
export function validateRealmPhaseProfile(value, path = '$.phaseProfile') {
    return validateContract(value, path, validatePhaseProfileValue);
}
export function createRealmMicrostructureProfile(input) {
    return createContract(input, REALM_MICROSTRUCTURE_PROFILE_SCHEMA, REALM_MICROSTRUCTURE_PROFILE_VERSION,
        '$.microstructureProfile', validateMicrostructureProfileValue);
}
export function validateRealmMicrostructureProfile(value, path = '$.microstructureProfile') {
    return validateContract(value, path, validateMicrostructureProfileValue);
}
export function createRealmHistoryProfile(input) {
    return createContract(input, REALM_HISTORY_PROFILE_SCHEMA, REALM_HISTORY_PROFILE_VERSION,
        '$.historyProfile', validateHistoryProfileValue);
}
export function validateRealmHistoryProfile(value, path = '$.historyProfile') {
    return validateContract(value, path, validateHistoryProfileValue);
}
export function createRealmGeometryProfile(input) {
    return createContract(input, REALM_GEOMETRY_PROFILE_SCHEMA, REALM_GEOMETRY_PROFILE_VERSION,
        '$.geometryProfile', validateGeometryProfileValue);
}
export function validateRealmGeometryProfile(value, path = '$.geometryProfile') {
    return validateContract(value, path, validateGeometryProfileValue);
}
export function createRealmMatterDefinition(input) {
    return createContract(input, REALM_MATTER_DEFINITION_SCHEMA, REALM_MATTER_DEFINITION_VERSION,
        '$.matterDefinition', validateDefinitionValue, { aliases: [], propertyObservationIds: [], tags: [] });
}
export function validateRealmMatterDefinition(value, path = '$.matterDefinition') {
    return validateContract(value, path, validateDefinitionValue);
}
export function createRealmMatterState(input) {
    return createContract(input, REALM_MATTER_STATE_SCHEMA, REALM_MATTER_STATE_VERSION,
        '$.matterState', validateStateValue, { revision: 0, historyEventIds: [], parentInstanceIds: [] });
}
export function validateRealmMatterState(value, path = '$.matterState') {
    return validateContract(value, path, validateStateValue);
}
export function createRealmPropertyObservation(input) {
    return createContract(input, REALM_PROPERTY_OBSERVATION_SCHEMA, REALM_PROPERTY_OBSERVATION_VERSION,
        '$.propertyObservation', validateObservationValue, { tags: [] });
}
export function validateRealmPropertyObservation(value, path = '$.propertyObservation') {
    return validateContract(value, path, validateObservationValue);
}
export function createRealmTransformation(input) {
    const transformation = createContract(input, REALM_TRANSFORMATION_SCHEMA, REALM_TRANSFORMATION_VERSION,
        '$.transformation', validateTransformationValue, { byproducts: [], equipment: [], reservoirs: [], tags: [] });
    immutableTransformations.add(transformation);
    return transformation;
}
export function validateRealmTransformation(value, path = '$.transformation') {
    if (typeof path === 'string' && immutableTransformations.has(value)) return true;
    return validateContract(value, path, validateTransformationValue);
}

export function createRealmEvidence(input, path = '$.evidence') {
    return createContract(input, REALM_EVIDENCE_SCHEMA, REALM_EVIDENCE_VERSION,
        String(path), validateEvidence);
}
