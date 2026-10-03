// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Deterministic condition-aware hypergraph search and material substitution. */

import { cloneStrictJson } from '../../core/schema/StrictJsonValue.js';
import {
    FabricDiagnostics,
    compareOrdinal,
    fail,
    freeze,
    requireExactKeys,
    requireFinite,
    requireIdentifier,
    requireIdentifierArray,
    requireInteger,
    requireRecord,
    requireString,
} from './FabricSupport.js';
import { validateRealmTransformation } from './RealmMatterContracts.js';

const OBJECTIVES = new Set(['operations', 'energy', 'duration', 'waste', 'economic']);
const CONTEXT_KEYS = new Set([
    'temperatureK', 'pressurePa', 'durationS', 'energyAvailableJ', 'moistureFraction', 'direction',
    'strainRatePerS', 'atmosphereIds', 'equipmentIds', 'tags',
]);
const SEARCH_KEYS = new Set([
    'availableDefinitionIds', 'targetDefinitionIds', 'context', 'objective', 'maxDepth', 'maxStates',
]);
const SUBSTITUTION_KEYS = new Set([
    'availableDefinitionIds', 'requiredTags', 'propertyRequirements', 'context', 'objective',
    'maxDepth', 'maxStates', 'limit',
]);
const PROPERTY_REQUIREMENT_KEYS = new Set(['propertyId', 'minimum', 'maximum', 'unit']);

function validateContext(input, path = '$.context') {
    const value = cloneStrictJson(input ?? {}, path);
    const candidate = {
        temperatureK: 293.15,
        pressurePa: 101325,
        durationS: 0,
        energyAvailableJ: 0,
        moistureFraction: 0,
        direction: 'unspecified',
        strainRatePerS: 0,
        atmosphereIds: [],
        equipmentIds: [],
        tags: [],
        ...value,
    };
    requireExactKeys(candidate, CONTEXT_KEYS, CONTEXT_KEYS, path);
    requireFinite(candidate.temperatureK, `${path}.temperatureK`, { minimum: 0 });
    requireFinite(candidate.pressurePa, `${path}.pressurePa`, { minimum: 0 });
    requireFinite(candidate.durationS, `${path}.durationS`, { minimum: 0 });
    requireFinite(candidate.energyAvailableJ, `${path}.energyAvailableJ`, { minimum: 0 });
    requireFinite(candidate.moistureFraction, `${path}.moistureFraction`, { minimum: 0, maximum: 1 });
    requireString(candidate.direction, `${path}.direction`, { maximum: 128 });
    requireFinite(candidate.strainRatePerS, `${path}.strainRatePerS`, { minimum: 0 });
    requireIdentifierArray(candidate.atmosphereIds, `${path}.atmosphereIds`);
    requireIdentifierArray(candidate.equipmentIds, `${path}.equipmentIds`);
    requireIdentifierArray(candidate.tags, `${path}.tags`);
    return candidate;
}

function inRange(value, range) {
    return value >= range.minimum && (range.maximum === null || value <= range.maximum);
}

function conditionsSatisfied(transformation, contextInput = {}) {
    const context = validateContext(contextInput);
    const conditions = transformation.conditions;
    if (!inRange(context.temperatureK, conditions.temperatureRangeK)) return false;
    if (!inRange(context.pressurePa, conditions.pressureRangePa)) return false;
    if (!inRange(context.durationS, conditions.durationRangeS)) return false;
    if (!inRange(context.energyAvailableJ, conditions.energyRangeJ)) return false;
    if (context.durationS < transformation.cost.durationS || context.energyAvailableJ < transformation.cost.energyJ) return false;
    if (conditions.atmosphereIds.length > 0
        && !conditions.atmosphereIds.some(id => context.atmosphereIds.includes(id))) return false;
    if (!conditions.requiredTags.every(tag => context.tags.includes(tag))) return false;
    if (!transformation.equipment.every(item => context.equipmentIds.includes(item.selectorId))) return false;
    return true;
}

export function transformationConditionsSatisfied(transformation, contextInput = {}) {
    validateRealmTransformation(transformation);
    return conditionsSatisfied(transformation, contextInput);
}

function edgeCost(transformation, objective) {
    if (objective === 'energy') return transformation.cost.energyJ;
    if (objective === 'duration') return transformation.cost.durationS;
    if (objective === 'waste') return transformation.cost.wasteKg;
    return transformation.cost[objective];
}

function stateKey(ids) {
    return [...ids].sort().join('\u001f');
}

function queueSort(left, right) {
    return left.cost - right.cost
        || left.path.length - right.path.length
        || compareOrdinal(left.path.join('\u001f'), right.path.join('\u001f'))
        || compareOrdinal(stateKey(left.ids), stateKey(right.ids));
}

function inputIds(transformation) {
    return transformation.inputs.map(flow => flow.definitionId);
}

function producedIds(transformation) {
    return [...transformation.outputs, ...transformation.byproducts]
        .map(flow => flow.definitionId);
}

function allContained(container, required) {
    return [...required].every(id => container.has(id));
}

function result(direction, node, exploredStates, targets) {
    const reached = [...node.ids].sort();
    return freeze({
        found: true,
        direction,
        path: node.path,
        totalCost: node.cost,
        reachedDefinitionIds: reached,
        unmetDefinitionIds: [...targets].filter(id => !node.ids.has(id)).sort(),
        exploredStates,
    }, '$.graphSearchResult');
}

function notFound(direction, best, exploredStates, targets) {
    return freeze({
        found: false,
        direction,
        path: best?.path ?? [],
        totalCost: best?.cost ?? 0,
        reachedDefinitionIds: best ? [...best.ids].sort() : [],
        unmetDefinitionIds: [...targets].filter(id => !best?.ids.has(id)).sort(),
        exploredStates,
    }, '$.graphSearchResult');
}

function validateSearch(input, direction) {
    const candidate = cloneStrictJson(input, '$.search');
    requireExactKeys(candidate, SEARCH_KEYS, SEARCH_KEYS, '$.search');
    requireIdentifierArray(candidate.availableDefinitionIds, '$.search.availableDefinitionIds');
    requireIdentifierArray(candidate.targetDefinitionIds, '$.search.targetDefinitionIds', { allowEmpty: false });
    candidate.context = validateContext(candidate.context, '$.search.context');
    requireString(candidate.objective, '$.search.objective');
    if (!OBJECTIVES.has(candidate.objective)) fail('$.search.objective', 'is unsupported');
    requireInteger(candidate.maxDepth, '$.search.maxDepth', { minimum: 0, maximum: 64 });
    requireInteger(candidate.maxStates, '$.search.maxStates', { minimum: 1, maximum: 100000 });
    if (direction === 'reverse' && candidate.availableDefinitionIds.length === 0) {
        fail('$.search.availableDefinitionIds', 'reverse search requires at least one available definition');
    }
    return candidate;
}

export class RealmTransformationGraph {
    #registry;
    #transformations;
    #propertyResolver;
    #diagnostics;

    constructor(registry, { propertyResolver = null, logger = null } = {}) {
        if (!registry || typeof registry.listTransformations !== 'function' || typeof registry.getDefinition !== 'function') {
            throw new TypeError('$.registry: must be a RealmMatterRegistry-compatible object');
        }
        this.#registry = registry;
        this.#transformations = registry.listTransformations();
        this.#propertyResolver = propertyResolver;
        this.#diagnostics = new FabricDiagnostics('matter.fabric.graph', logger);
    }

    forwardSearch(input) {
        return this.#search('forward', validateSearch(input, 'forward'));
    }

    reverseSearch(input) {
        return this.#search('reverse', validateSearch(input, 'reverse'));
    }

    substitutions(input) {
        const token = this.#diagnostics.begin('graph.substitutions');
        try {
            const candidate = cloneStrictJson(input, '$.substitution');
            requireExactKeys(candidate, SUBSTITUTION_KEYS, SUBSTITUTION_KEYS, '$.substitution');
            requireIdentifierArray(candidate.availableDefinitionIds, '$.substitution.availableDefinitionIds');
            requireIdentifierArray(candidate.requiredTags, '$.substitution.requiredTags');
            if (!Array.isArray(candidate.propertyRequirements)) fail('$.substitution.propertyRequirements', 'must be an array');
            const requirements = candidate.propertyRequirements.map((requirement, index) => {
                const path = `$.substitution.propertyRequirements[${index}]`;
                requireExactKeys(requirement, PROPERTY_REQUIREMENT_KEYS, PROPERTY_REQUIREMENT_KEYS, path);
                requireIdentifier(requirement.propertyId, `${path}.propertyId`);
                requireFinite(requirement.minimum, `${path}.minimum`);
                requireFinite(requirement.maximum, `${path}.maximum`, { minimum: requirement.minimum });
                requireString(requirement.unit, `${path}.unit`, { maximum: 64 });
                return requirement;
            });
            requireInteger(candidate.limit, '$.substitution.limit', { minimum: 1, maximum: 1000 });
            requireString(candidate.objective, '$.substitution.objective');
            if (!OBJECTIVES.has(candidate.objective)) fail('$.substitution.objective', 'is unsupported');
            requireInteger(candidate.maxDepth, '$.substitution.maxDepth', { minimum: 0, maximum: 64 });
            requireInteger(candidate.maxStates, '$.substitution.maxStates', { minimum: 1, maximum: 100000 });
            const context = validateContext(candidate.context, '$.substitution.context');
            if (requirements.length > 0 && !this.#propertyResolver) {
                fail('$.substitution.propertyRequirements', 'requires a property resolver');
            }
            const matches = [];
            for (const definition of this.#registry.listDefinitions()) {
                if (!candidate.requiredTags.every(tag => definition.tags.includes(tag))) continue;
                const resolved = [];
                let applicable = true;
                for (const requirement of requirements) {
                    const observation = this.#propertyResolver.resolve({
                        definitionId: definition.id,
                        propertyId: requirement.propertyId,
                        unit: requirement.unit,
                        context: {
                            temperatureK: context.temperatureK,
                            pressurePa: context.pressurePa,
                            moistureFraction: context.moistureFraction,
                            direction: context.direction,
                            strainRatePerS: context.strainRatePerS,
                            phaseProfileId: definition.profileRefs.phase,
                            microstructureProfileId: definition.profileRefs.microstructure,
                            historyProfileId: definition.profileRefs.history,
                        },
                    });
                    const selected = observation.selected;
                    if (!selected || selected.value.unit !== requirement.unit
                        || selected.value.maximum < requirement.minimum
                        || selected.value.minimum > requirement.maximum) {
                        applicable = false;
                        break;
                    }
                    resolved.push({ propertyId: requirement.propertyId, observationId: selected.id, value: selected.value });
                }
                if (applicable) {
                    const route = candidate.availableDefinitionIds.length === 0 ? null : this.forwardSearch({
                        availableDefinitionIds: candidate.availableDefinitionIds,
                        targetDefinitionIds: [definition.id],
                        context,
                        objective: candidate.objective,
                        maxDepth: candidate.maxDepth,
                        maxStates: candidate.maxStates,
                    });
                    if (route === null || route.found) {
                        matches.push({
                            definitionId: definition.id,
                            resolvedProperties: resolved,
                            manufacturingPath: route?.path ?? [],
                            totalCost: route?.totalCost ?? 0,
                        });
                    }
                }
            }
            matches.sort((left, right) => compareOrdinal(left.definitionId, right.definitionId));
            const output = freeze(matches.slice(0, candidate.limit), '$.substitutions');
            this.#diagnostics.end(token, { candidates: matches.length, returned: output.length });
            return output;
        } catch (error) {
            this.#diagnostics.error(token, error);
            throw error;
        }
    }

    diagnostics() {
        return this.#diagnostics.snapshot();
    }

    #search(direction, search) {
        const token = this.#diagnostics.begin(`graph.${direction}`);
        try {
            for (const id of [...search.availableDefinitionIds, ...search.targetDefinitionIds]) {
                if (!this.#registry.getDefinition(id)) fail('$.search', `references missing definition ${id}`);
            }
            const available = new Set(search.availableDefinitionIds);
            const targets = new Set(search.targetDefinitionIds);
            const startIds = direction === 'forward' ? available : targets;
            const goalIds = direction === 'forward' ? targets : available;
            const queue = [{ ids: new Set(startIds), cost: 0, path: [] }];
            const bestCosts = new Map([[stateKey(startIds), 0]]);
            let explored = 0;
            let best = queue[0];
            while (queue.length > 0 && explored < search.maxStates) {
                queue.sort(queueSort);
                const node = queue.shift();
                explored += 1;
                best = node;
                if (allContained(node.ids, goalIds)) {
                    const output = result(direction, node, explored, goalIds);
                    this.#diagnostics.end(token, { found: true, explored, depth: node.path.length });
                    return output;
                }
                if (node.path.length >= search.maxDepth) continue;
                for (const transformation of this.#transformations) {
                    if (!conditionsSatisfied(transformation, search.context)) continue;
                    const required = direction === 'forward' ? inputIds(transformation) : producedIds(transformation);
                    if (required.length === 0 || !required.some(id => node.ids.has(id))) continue;
                    if (direction === 'forward' && !required.every(id => node.ids.has(id))) continue;
                    const next = new Set(node.ids);
                    if (direction === 'forward') {
                        producedIds(transformation).forEach(id => next.add(id));
                    } else {
                        producedIds(transformation).forEach(id => next.delete(id));
                        inputIds(transformation).forEach(id => next.add(id));
                    }
                    const key = stateKey(next);
                    const cost = node.cost + edgeCost(transformation, search.objective);
                    if (bestCosts.has(key) && bestCosts.get(key) <= cost) continue;
                    bestCosts.set(key, cost);
                    queue.push({ ids: next, cost, path: [...node.path, transformation.id] });
                }
            }
            const output = notFound(direction, best, explored, goalIds);
            this.#diagnostics.end(token, { found: false, explored, depth: output.path.length });
            return output;
        } catch (error) {
            this.#diagnostics.error(token, error);
            throw error;
        }
    }
}

export function createRealmTransformationGraph(registry, options = {}) {
    return new RealmTransformationGraph(registry, options);
}
