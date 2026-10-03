// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Condition-aware property selection that retains every conflicting observation. */

import { cloneStrictJson } from '../../core/schema/StrictJsonValue.js';
import {
    FabricDiagnostics,
    compareOrdinal,
    fail,
    freeze,
    requireExactKeys,
    requireFinite,
    requireIdentifier,
    requireString,
} from './FabricSupport.js';

const QUERY_KEYS = new Set(['definitionId', 'propertyId', 'unit', 'context']);
const CONTEXT_KEYS = new Set([
    'temperatureK', 'pressurePa', 'moistureFraction', 'direction', 'strainRatePerS',
    'phaseProfileId', 'microstructureProfileId', 'historyProfileId',
]);
const EVIDENCE_WEIGHT = Object.freeze({
    EVALUATED: 900,
    MEASURED: 800,
    CURATED: 700,
    COMPUTED: 600,
    INFERRED: 500,
    PREDICTED: 400,
    PROCEDURAL: 300,
    FICTIONAL: 200,
    UNKNOWN: 100,
});

function optionalIdentifier(value, path) {
    if (value !== null) requireIdentifier(value, path);
}

function validateQuery(input) {
    const query = cloneStrictJson(input, '$.propertyQuery');
    requireExactKeys(query, QUERY_KEYS, QUERY_KEYS, '$.propertyQuery');
    requireIdentifier(query.definitionId, '$.propertyQuery.definitionId');
    requireIdentifier(query.propertyId, '$.propertyQuery.propertyId');
    if (query.unit !== null) requireString(query.unit, '$.propertyQuery.unit', { maximum: 64 });
    requireExactKeys(query.context, CONTEXT_KEYS, CONTEXT_KEYS, '$.propertyQuery.context');
    requireFinite(query.context.temperatureK, '$.propertyQuery.context.temperatureK', { minimum: 0 });
    requireFinite(query.context.pressurePa, '$.propertyQuery.context.pressurePa', { minimum: 0 });
    requireFinite(query.context.moistureFraction, '$.propertyQuery.context.moistureFraction', { minimum: 0, maximum: 1 });
    requireString(query.context.direction, '$.propertyQuery.context.direction', { maximum: 128 });
    requireFinite(query.context.strainRatePerS, '$.propertyQuery.context.strainRatePerS', { minimum: 0 });
    optionalIdentifier(query.context.phaseProfileId, '$.propertyQuery.context.phaseProfileId');
    optionalIdentifier(query.context.microstructureProfileId, '$.propertyQuery.context.microstructureProfileId');
    optionalIdentifier(query.context.historyProfileId, '$.propertyQuery.context.historyProfileId');
    return query;
}

function rangeContains(range, value) {
    return value >= range.minimum && value <= range.maximum;
}

function applicability(observation, context, requiredUnit) {
    const conditions = observation.conditions;
    const failures = [];
    if (requiredUnit !== null && observation.value.unit !== requiredUnit) failures.push('unit');
    if (!rangeContains(conditions.temperatureRangeK, context.temperatureK)) failures.push('temperature');
    if (!rangeContains(conditions.pressureRangePa, context.pressurePa)) failures.push('pressure');
    if (!rangeContains(conditions.moistureRange, context.moistureFraction)) failures.push('moisture');
    if (!rangeContains(conditions.strainRateRangePerS, context.strainRatePerS)) failures.push('strain-rate');
    if (conditions.direction !== 'any' && conditions.direction !== context.direction) failures.push('direction');
    for (const field of ['phaseProfileId', 'microstructureProfileId', 'historyProfileId']) {
        if (conditions[field] !== null && conditions[field] !== context[field]) failures.push(field);
    }
    let specificity = 0;
    if (conditions.direction !== 'any') specificity += 10;
    if (conditions.phaseProfileId !== null) specificity += 10;
    if (conditions.microstructureProfileId !== null) specificity += 10;
    if (conditions.historyProfileId !== null) specificity += 10;
    const uncertaintyPenalty = observation.uncertainty.relative * 100
        + observation.uncertainty.absolute / Math.max(1, Math.abs(observation.value.nominal));
    const score = EVIDENCE_WEIGHT[observation.evidence.class]
        + observation.evidence.confidence * 50 + specificity - uncertaintyPenalty;
    return { applicable: failures.length === 0, failures, score };
}

export class RealmPropertyResolver {
    #registry;
    #diagnostics;

    constructor(registry, { logger = null } = {}) {
        if (!registry || typeof registry.listPropertyObservations !== 'function') {
            throw new TypeError('$.registry: must be a RealmMatterRegistry-compatible object');
        }
        this.#registry = registry;
        this.#diagnostics = new FabricDiagnostics('matter.fabric.properties', logger);
    }

    resolve(input) {
        const token = this.#diagnostics.begin('property.resolve');
        try {
            const query = validateQuery(input);
            if (!this.#registry.getDefinition(query.definitionId)) {
                fail('$.propertyQuery.definitionId', 'references a missing definition');
            }
            const records = this.#registry.listPropertyObservations({
                definitionId: query.definitionId,
                propertyId: query.propertyId,
            });
            const evaluated = records.map(observation => ({
                observation,
                ...applicability(observation, query.context, query.unit),
            }));
            const applicableRecords = evaluated.filter(entry => entry.applicable).sort((left, right) => (
                right.score - left.score || compareOrdinal(left.observation.id, right.observation.id)
            ));
            const selected = applicableRecords[0]?.observation ?? null;
            const selectedId = selected?.id ?? null;
            const output = freeze({
                definitionId: query.definitionId,
                propertyId: query.propertyId,
                unit: query.unit,
                selected,
                applicable: applicableRecords.map(entry => ({
                    observation: entry.observation,
                    score: entry.score,
                })),
                conflicting: evaluated.filter(entry => entry.observation.id !== selectedId).map(entry => ({
                    observation: entry.observation,
                    applicable: entry.applicable,
                    rejectedBy: entry.failures,
                    score: entry.score,
                })),
            }, '$.resolvedProperty');
            this.#diagnostics.end(token, {
                candidates: records.length,
                applicable: applicableRecords.length,
                selectedId,
            });
            return output;
        } catch (error) {
            this.#diagnostics.error(token, error);
            throw error;
        }
    }

    diagnostics() {
        return this.#diagnostics.snapshot();
    }
}

export function createRealmPropertyResolver(registry, options = {}) {
    return new RealmPropertyResolver(registry, options);
}
