// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Strict, app-neutral contracts for immutable composite material data. */

import { TEXTURE_SLOTS } from '../EngineMaterial.js';

export const ENGINE_COMPOSITE_MATERIAL_SCHEMA = 'engine.composite-material';
export const ENGINE_COMPOSITE_MATERIAL_VERSION_1_0 = '1.0.0';
export const ENGINE_COMPOSITE_MATERIAL_VERSION_1_1 = '1.1.0';
/** Retained as the v1.0 compatibility constant for existing callers. */
export const ENGINE_COMPOSITE_MATERIAL_VERSION = '1.0.0';
export const ENGINE_COMPOSITE_MATERIAL_LATEST_VERSION = ENGINE_COMPOSITE_MATERIAL_VERSION_1_1;
export const ENGINE_COMPOSITE_MATERIAL_SUPPORTED_VERSIONS = Object.freeze([
    ENGINE_COMPOSITE_MATERIAL_VERSION_1_0,
    ENGINE_COMPOSITE_MATERIAL_VERSION_1_1,
]);

export const COMPOSITE_MATERIAL_FACETS = Object.freeze([
    'identity',
    'chemistry',
    'render',
    'physical',
    'contact',
    'mechanical',
    'thermal',
    'electrical',
    'substance',
    'fabrication',
    'fiber',
    'audio',
]);

/** v1.1 adds sourced joining guidance without changing the v1.0 facet state space. */
export const COMPOSITE_MATERIAL_FACETS_V1_1 = Object.freeze([
    ...COMPOSITE_MATERIAL_FACETS,
    'joining',
]);

const FACET_SET_V1_0 = new Set(COMPOSITE_MATERIAL_FACETS);
const FACET_SET_V1_1 = new Set(COMPOSITE_MATERIAL_FACETS_V1_1);
const TEXTURE_SLOT_SET = new Set(TEXTURE_SLOTS);
const MATERIAL_ID = /^(?:builtin|rf)\.material\.[a-z0-9][a-z0-9.-]*$/;
const SOURCE_ID = /^[a-z][a-z0-9-]{0,79}$/;
const FIELD_PATH = /^(?:identity|chemistry|render|physical|contact|mechanical|thermal|electrical|substance|fabrication|fiber|audio|joining)\.[a-z][A-Za-z0-9]*$/;
const PATH = /^material\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)*[a-z0-9]+(?:-[a-z0-9]+)*\.json$/;

const TOP_LEVEL_KEYS_V1_0 = new Set([
    'schema', 'schemaVersion', 'copyright', 'license', 'id', 'logicalPath',
    'name', 'category', 'basedOn', 'facets', 'missingFacets',
    'notApplicableFacets', 'sources', 'fieldSources',
]);
const TOP_LEVEL_KEYS_V1_1 = new Set([...TOP_LEVEL_KEYS_V1_0, 'missingFields']);

const FACET_FIELDS = Object.freeze({
    identity: new Set(['kind', 'phaseAt293K', 'description']),
    chemistry: new Set(['symbol', 'atomicNumber', 'relativeAtomicMass', 'compositionMassFraction']),
    render: new Set([
        'workflow', 'baseColorFactor', 'metallicFactor', 'roughnessFactor',
        'emissiveFactor', 'alphaMode', 'alphaCutoff', 'doubleSided', 'textures',
    ]),
    physical: new Set(['densityKgPerM3']),
    contact: new Set(['staticFriction', 'dynamicFriction', 'restitution']),
    mechanical: new Set([
        'youngsModulusPa', 'poissonRatio', 'yieldStrengthPa', 'tensileStrengthPa',
        'elasticityNormalized', 'hardnessNormalized', 'tensileStrengthNormalized',
        'brittlenessNormalized', 'deformable', 'breakable',
    ]),
    thermal: new Set([
        'meltingPointK', 'boilingPointK', 'specificHeatJPerKgK',
        'thermalConductivityWPerMK', 'linearExpansionPerK',
        'ignitionTemperatureK', 'structuralBreakTemperatureK',
    ]),
    electrical: new Set([
        'resistivityOhmM', 'referenceTemperatureK', 'temperatureCoefficientPerK',
        'relativePermittivity', 'relativePermeability', 'dielectricStrengthVPerM',
    ]),
    substance: new Set([
        'engineSubstanceId', 'particleElementSymbol',
        'normalizedThermalConductivity', 'flammabilityNormalized',
        'moistureCapacityNormalized', 'corrosionRateNormalized',
    ]),
    fabrication: new Set(['processes', 'joiningConstraints', 'notes']),
    fiber: new Set([
        'bendingStiffnessNormalized', 'elasticityNormalized', 'dampingNormalized',
        'anisotropyNormalized', 'sheenStrengthNormalized', 'roughnessNormalized',
        'moistureCapacityNormalized', 'wetMassMultiplier',
        'wetStiffnessMultiplier', 'breakingStrengthN', 'linearDensityKgPerM',
    ]),
    audio: new Set([
        'impactSound', 'scrapeSound', 'collisionSound', 'proceduralPatch',
        'footstepMaterial',
    ]),
});

const FACET_FIELDS_V1_1 = Object.freeze({
    ...FACET_FIELDS,
    mechanical: new Set([
        ...FACET_FIELDS.mechanical,
        'compressiveStrengthPa',
        'shearStrengthPa',
    ]),
    joining: new Set(['methods', 'compatibleMaterialIds', 'constraints', 'notes']),
});

const UNIT_INTERVAL_FIELDS = new Set([
    'render.metallicFactor', 'render.roughnessFactor', 'render.alphaCutoff',
    'contact.restitution', 'mechanical.elasticityNormalized',
    'mechanical.hardnessNormalized', 'mechanical.tensileStrengthNormalized',
    'mechanical.brittlenessNormalized', 'substance.normalizedThermalConductivity',
    'substance.flammabilityNormalized', 'substance.moistureCapacityNormalized',
    'substance.corrosionRateNormalized', 'fiber.bendingStiffnessNormalized',
    'fiber.elasticityNormalized', 'fiber.dampingNormalized',
    'fiber.anisotropyNormalized', 'fiber.sheenStrengthNormalized',
    'fiber.roughnessNormalized', 'fiber.moistureCapacityNormalized',
]);

const POSITIVE_FIELDS = new Set([
    'physical.densityKgPerM3', 'mechanical.youngsModulusPa',
    'mechanical.yieldStrengthPa', 'mechanical.tensileStrengthPa',
    'mechanical.compressiveStrengthPa', 'mechanical.shearStrengthPa',
    'thermal.meltingPointK', 'thermal.boilingPointK',
    'thermal.specificHeatJPerKgK', 'thermal.thermalConductivityWPerMK',
    'thermal.ignitionTemperatureK', 'thermal.structuralBreakTemperatureK',
    'electrical.resistivityOhmM', 'electrical.referenceTemperatureK',
    'electrical.relativePermittivity', 'electrical.relativePermeability',
    'electrical.dielectricStrengthVPerM', 'fiber.wetMassMultiplier',
    'fiber.wetStiffnessMultiplier', 'fiber.breakingStrengthN',
    'fiber.linearDensityKgPerM',
]);

function fail(path, message) {
    throw new TypeError(`${path}: ${message}`);
}

function supportedVersion(value, path = '$.schemaVersion') {
    if (!ENGINE_COMPOSITE_MATERIAL_SUPPORTED_VERSIONS.includes(value)) {
        fail(path, 'is unsupported');
    }
    return value;
}

function versionedFacetSet(schemaVersion) {
    return schemaVersion === ENGINE_COMPOSITE_MATERIAL_VERSION_1_1
        ? FACET_SET_V1_1
        : FACET_SET_V1_0;
}

function versionedFacetNames(schemaVersion) {
    return schemaVersion === ENGINE_COMPOSITE_MATERIAL_VERSION_1_1
        ? COMPOSITE_MATERIAL_FACETS_V1_1
        : COMPOSITE_MATERIAL_FACETS;
}

function versionedFacetFields(schemaVersion) {
    return schemaVersion === ENGINE_COMPOSITE_MATERIAL_VERSION_1_1
        ? FACET_FIELDS_V1_1
        : FACET_FIELDS;
}

export function isPlainCompositeMaterialObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, allowed, path) {
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) fail(`${path}.${key}`, 'unknown field');
    }
}

function string(value, path, { pattern = null, maximum = 2048 } = {}) {
    if (typeof value !== 'string' || !value || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) {
        fail(path, 'must be a non-empty bounded control-free string');
    }
    if (pattern && !pattern.test(value)) fail(path, 'has invalid syntax');
    return value;
}

function finite(value, path, { minimum = -Infinity, maximum = Infinity } = {}) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
        fail(path, `must be finite in [${minimum}, ${maximum}]`);
    }
    return value;
}

function stringArray(value, path) {
    if (!Array.isArray(value)) fail(path, 'must be an array');
    const result = value.map((entry, index) => string(entry, `${path}[${index}]`, { maximum: 512 }));
    if (new Set(result).size !== result.length) fail(path, 'must not contain duplicates');
    return result;
}

function vector(value, path, length, minimum = 0, maximum = 1) {
    if (!Array.isArray(value) || value.length !== length) fail(path, `must be a ${length}-vector`);
    return value.map((entry, index) => finite(entry, `${path}[${index}]`, { minimum, maximum }));
}

function validateTextureBinding(value, path, expectedSlot) {
    if (!isPlainCompositeMaterialObject(value)) fail(path, 'must be an object');
    exactKeys(value, new Set([
        'textureId', 'slot', 'uvSet', 'transform', 'sampler', 'colorSpace',
        'usage', 'channelUse',
    ]), path);
    string(value.textureId, `${path}.textureId`, { maximum: 512 });
    string(value.slot, `${path}.slot`, { maximum: 64 });
    if (!TEXTURE_SLOT_SET.has(value.slot)) fail(`${path}.slot`, 'is not an Engine texture slot');
    if (value.slot !== expectedSlot) fail(`${path}.slot`, `must match map slot '${expectedSlot}'`);
    finite(value.uvSet, `${path}.uvSet`, { minimum: 0, maximum: 7 });
    if (!Number.isSafeInteger(value.uvSet)) fail(`${path}.uvSet`, 'must be an integer');
    if (value.transform != null) {
        if (!isPlainCompositeMaterialObject(value.transform)) fail(`${path}.transform`, 'must be an object');
        exactKeys(value.transform, new Set(['offset', 'rotation', 'scale']), `${path}.transform`);
        if (value.transform.offset != null) vector(value.transform.offset, `${path}.transform.offset`, 2, -Infinity, Infinity);
        if (value.transform.rotation != null) finite(value.transform.rotation, `${path}.transform.rotation`);
        if (value.transform.scale != null) vector(value.transform.scale, `${path}.transform.scale`, 2, -Infinity, Infinity);
    }
    if (value.sampler != null) {
        if (!isPlainCompositeMaterialObject(value.sampler)) fail(`${path}.sampler`, 'must be an object');
        exactKeys(value.sampler, new Set(['wrapU', 'wrapV', 'minFilter', 'magFilter']), `${path}.sampler`);
        const wrap = new Set(['repeat', 'clamp-to-edge', 'mirrored-repeat']);
        const minFilter = new Set(['nearest', 'linear', 'nearestMipmapNearest', 'linearMipmapNearest', 'nearestMipmapLinear', 'linearMipmapLinear']);
        const magFilter = new Set(['nearest', 'linear']);
        if (value.sampler.wrapU != null && !wrap.has(value.sampler.wrapU)) fail(`${path}.sampler.wrapU`, 'is unsupported');
        if (value.sampler.wrapV != null && !wrap.has(value.sampler.wrapV)) fail(`${path}.sampler.wrapV`, 'is unsupported');
        if (value.sampler.minFilter != null && !minFilter.has(value.sampler.minFilter)) fail(`${path}.sampler.minFilter`, 'is unsupported');
        if (value.sampler.magFilter != null && !magFilter.has(value.sampler.magFilter)) fail(`${path}.sampler.magFilter`, 'is unsupported');
    }
    if (value.channelUse != null) {
        if (!isPlainCompositeMaterialObject(value.channelUse)) fail(`${path}.channelUse`, 'must be an object');
        for (const [semantic, channel] of Object.entries(value.channelUse)) {
            string(semantic, `${path}.channelUse.${semantic}`, { pattern: /^[a-z][A-Za-z0-9]*$/, maximum: 64 });
            if (!['r', 'g', 'b', 'a', 'rg', 'rgb', 'rgba'].includes(channel)) fail(`${path}.channelUse.${semantic}`, 'is unsupported');
        }
    }
    if (value.colorSpace != null && !['srgb', 'linear'].includes(value.colorSpace)) fail(`${path}.colorSpace`, 'is unsupported');
    if (value.usage != null && !['color', 'data', 'normal', 'mask', 'hdr'].includes(value.usage)) fail(`${path}.usage`, 'is unsupported');
}

function validateFacetField(facet, field, value, path) {
    const key = `${facet}.${field}`;
    if (UNIT_INTERVAL_FIELDS.has(key)) finite(value, path, { minimum: 0, maximum: 1 });
    else if (POSITIVE_FIELDS.has(key)) finite(value, path, { minimum: Number.MIN_VALUE });
    else if (key === 'electrical.temperatureCoefficientPerK' || key === 'thermal.linearExpansionPerK') finite(value, path);
    else if (key === 'contact.staticFriction' || key === 'contact.dynamicFriction') finite(value, path, { minimum: 0 });
    else if (key === 'mechanical.poissonRatio') finite(value, path, { minimum: -0.999999999, maximum: 0.5 });
    else if (key === 'chemistry.atomicNumber') {
        finite(value, path, { minimum: 1, maximum: 118 });
        if (!Number.isSafeInteger(value)) fail(path, 'must be an integer');
    } else if (key === 'chemistry.relativeAtomicMass') finite(value, path, { minimum: Number.MIN_VALUE });
    else if (key === 'chemistry.compositionMassFraction') {
        if (!isPlainCompositeMaterialObject(value) || Object.keys(value).length === 0) fail(path, 'must be a non-empty object');
        let sum = 0;
        for (const [component, fraction] of Object.entries(value)) {
            string(component, `${path}.${component}`, { pattern: MATERIAL_ID });
            sum += finite(fraction, `${path}.${component}`, { minimum: 0, maximum: 1 });
        }
        if (Math.abs(sum - 1) > 1e-9) fail(path, 'mass fractions must sum to one');
    } else if (key === 'render.baseColorFactor') vector(value, path, 4);
    else if (key === 'render.emissiveFactor') vector(value, path, 3);
    else if (key === 'render.workflow' && !['metallicRoughness', 'specularGlossiness', 'phong', 'unlit', 'custom'].includes(value)) fail(path, 'has unsupported workflow');
    else if (key === 'render.alphaMode' && !['opaque', 'mask', 'blend'].includes(value)) fail(path, 'has unsupported alpha mode');
    else if (key === 'render.doubleSided' || key === 'mechanical.deformable' || key === 'mechanical.breakable') {
        if (typeof value !== 'boolean') fail(path, 'must be boolean');
    } else if (key === 'render.textures') {
        if (!isPlainCompositeMaterialObject(value)) fail(path, 'must be an object');
        for (const [slot, binding] of Object.entries(value)) {
            if (!TEXTURE_SLOT_SET.has(slot)) fail(`${path}.${slot}`, 'is not an Engine texture slot');
            validateTextureBinding(binding, `${path}.${slot}`, slot);
        }
    } else if (key === 'fabrication.processes' || key === 'fabrication.joiningConstraints'
        || key === 'joining.methods' || key === 'joining.constraints') stringArray(value, path);
    else if (key === 'joining.compatibleMaterialIds') {
        const ids = stringArray(value, path);
        for (const [index, id] of ids.entries()) string(id, `${path}[${index}]`, { pattern: MATERIAL_ID });
    }
    else string(value, path, { maximum: 2048 });
}

export function validateCompositeMaterialFacets(value, path = '$.facets', {
    schemaVersion = ENGINE_COMPOSITE_MATERIAL_VERSION_1_0,
} = {}) {
    supportedVersion(schemaVersion);
    if (!isPlainCompositeMaterialObject(value)) fail(path, 'must be an object');
    exactKeys(value, versionedFacetSet(schemaVersion), path);
    const fieldsByFacet = versionedFacetFields(schemaVersion);
    for (const [facet, fields] of Object.entries(value)) {
        if (!isPlainCompositeMaterialObject(fields) || Object.keys(fields).length === 0) fail(`${path}.${facet}`, 'must be a non-empty object');
        exactKeys(fields, fieldsByFacet[facet], `${path}.${facet}`);
        for (const [field, fieldValue] of Object.entries(fields)) {
            validateFacetField(facet, field, fieldValue, `${path}.${facet}.${field}`);
        }
    }
    return value;
}

function validateSources(sources, path, schemaVersion) {
    if (!Array.isArray(sources) || sources.length === 0) fail(path, 'must be a non-empty array');
    const ids = new Set();
    for (const [index, source] of sources.entries()) {
        const at = `${path}[${index}]`;
        if (!isPlainCompositeMaterialObject(source)) fail(at, 'must be an object');
        const sourceKeys = schemaVersion === ENGINE_COMPOSITE_MATERIAL_VERSION_1_1
            ? new Set(['id', 'kind', 'uri', 'citation', 'edition', 'note'])
            : new Set(['id', 'kind', 'uri', 'citation', 'note']);
        exactKeys(source, sourceKeys, at);
        const id = string(source.id, `${at}.id`, { pattern: SOURCE_ID, maximum: 80 });
        if (ids.has(id)) fail(`${at}.id`, 'must be unique');
        ids.add(id);
        if (!['repository', 'primary', 'authored'].includes(source.kind)) fail(`${at}.kind`, 'is unsupported');
        const uri = string(source.uri, `${at}.uri`);
        if (source.kind === 'primary' && !/^https:\/\//.test(uri)) fail(`${at}.uri`, 'primary sources require https');
        string(source.citation, `${at}.citation`);
        if (schemaVersion === ENGINE_COMPOSITE_MATERIAL_VERSION_1_1) {
            string(source.edition, `${at}.edition`, { maximum: 256 });
        }
        if (source.note != null) string(source.note, `${at}.note`);
    }
    return ids;
}

export function validateCompositeMaterialProvenance({ facets, sources, fieldSources }, path = '$', {
    schemaVersion = ENGINE_COMPOSITE_MATERIAL_VERSION_1_0,
} = {}) {
    supportedVersion(schemaVersion);
    const sourceIds = validateSources(sources, `${path}.sources`, schemaVersion);
    if (!isPlainCompositeMaterialObject(fieldSources)) fail(`${path}.fieldSources`, 'must be an object');
    const expected = new Set();
    for (const [facet, fields] of Object.entries(facets)) {
        for (const field of Object.keys(fields)) expected.add(`${facet}.${field}`);
    }
    for (const [fieldPath, ids] of Object.entries(fieldSources)) {
        if (!FIELD_PATH.test(fieldPath) || !expected.has(fieldPath)) fail(`${path}.fieldSources.${fieldPath}`, 'does not identify a declared field');
        const normalized = stringArray(ids, `${path}.fieldSources.${fieldPath}`);
        if (normalized.length === 0) fail(`${path}.fieldSources.${fieldPath}`, 'must identify at least one source');
        for (const id of normalized) if (!sourceIds.has(id)) fail(`${path}.fieldSources.${fieldPath}`, `references unknown source '${id}'`);
        expected.delete(fieldPath);
    }
    if (expected.size) fail(`${path}.fieldSources`, `missing provenance for ${[...expected].sort().join(', ')}`);
}

function validateFacetStates(facets, missingFacets, notApplicableFacets, path, schemaVersion) {
    const missing = stringArray(missingFacets, `${path}.missingFacets`);
    const notApplicable = stringArray(notApplicableFacets, `${path}.notApplicableFacets`);
    const facetSet = versionedFacetSet(schemaVersion);
    const facetNames = versionedFacetNames(schemaVersion);
    for (const name of [...missing, ...notApplicable]) if (!facetSet.has(name)) fail(path, `unknown facet '${name}'`);
    const state = new Set([...Object.keys(facets), ...missing, ...notApplicable]);
    if (state.size !== facetNames.length) fail(path, 'every facet must have exactly one explicit state');
    if (Object.keys(facets).length + missing.length + notApplicable.length !== state.size) fail(path, 'facet states overlap');
}

function validateMissingFields(value, facets, path, schemaVersion) {
    if (schemaVersion !== ENGINE_COMPOSITE_MATERIAL_VERSION_1_1) return;
    const missing = stringArray(value, `${path}.missingFields`);
    const fieldsByFacet = versionedFacetFields(schemaVersion);
    for (const [index, fieldPath] of missing.entries()) {
        if (!FIELD_PATH.test(fieldPath)) fail(`${path}.missingFields[${index}]`, 'has invalid syntax');
        const [facet, field] = fieldPath.split('.');
        if (!Object.hasOwn(fieldsByFacet, facet) || !fieldsByFacet[facet].has(field)) {
            fail(`${path}.missingFields[${index}]`, 'does not identify a supported v1.1 field');
        }
        if (!Object.hasOwn(facets, facet)) {
            fail(`${path}.missingFields[${index}]`, 'belongs to a facet already declared missing or not applicable');
        }
        if (Object.hasOwn(facets[facet], field)) {
            fail(`${path}.missingFields[${index}]`, 'also identifies an authored field');
        }
    }
}

/** Validate a complete built-in catalog resource. Returns the input unchanged. */
export function validateEngineCompositeMaterialResource(value, path = '$') {
    if (!isPlainCompositeMaterialObject(value)) fail(path, 'must be an object');
    if (value.schema !== ENGINE_COMPOSITE_MATERIAL_SCHEMA) fail(`${path}.schema`, 'is unsupported');
    const schemaVersion = supportedVersion(value.schemaVersion, `${path}.schemaVersion`);
    exactKeys(value, schemaVersion === ENGINE_COMPOSITE_MATERIAL_VERSION_1_1
        ? TOP_LEVEL_KEYS_V1_1
        : TOP_LEVEL_KEYS_V1_0, path);
    string(value.copyright, `${path}.copyright`);
    string(value.license, `${path}.license`);
    string(value.id, `${path}.id`, { pattern: MATERIAL_ID });
    string(value.logicalPath, `${path}.logicalPath`, { pattern: PATH });
    string(value.name, `${path}.name`, { maximum: 256 });
    string(value.category, `${path}.category`, { maximum: 80 });
    if (value.basedOn != null) string(value.basedOn, `${path}.basedOn`, { pattern: MATERIAL_ID });
    validateCompositeMaterialFacets(value.facets, `${path}.facets`, { schemaVersion });
    validateFacetStates(value.facets, value.missingFacets, value.notApplicableFacets, path, schemaVersion);
    validateMissingFields(value.missingFields, value.facets, path, schemaVersion);
    validateCompositeMaterialProvenance(value, path, { schemaVersion });
    return value;
}

export const COMPOSITE_MATERIAL_FACET_FIELDS = Object.freeze(Object.fromEntries(
    Object.entries(FACET_FIELDS).map(([facet, fields]) => [facet, Object.freeze([...fields])]),
));

export const COMPOSITE_MATERIAL_FACET_FIELDS_V1_1 = Object.freeze(Object.fromEntries(
    Object.entries(FACET_FIELDS_V1_1).map(([facet, fields]) => [facet, Object.freeze([...fields])]),
));
