// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Converts bounded transformation-graph routes into executable, evidence-bearing process plans. */

import { cloneStrictJson } from '../../core/schema/StrictJsonValue.js';
import {
    FabricDiagnostics,
    freeze,
    requireExactKeys,
    requireFinite,
    requireIdentifierArray,
    requireInteger,
    requireRecord,
    requireString,
} from './FabricSupport.js';
import { createRealmTransformationGraph } from './RealmTransformationGraph.js';

export const REALM_PROCESS_PLAN_SCHEMA = 'engine.matter.fabric.process-plan';
export const REALM_PROCESS_PLAN_VERSION = '1.0.0';

const PLAN_KEYS = new Set([
    'availableDefinitionIds', 'targetDefinitionIds', 'context', 'objective',
    'maxDepth', 'maxStates', 'batchScale',
]);
const REQUIRED_PLAN_KEYS = new Set(['availableDefinitionIds', 'targetDefinitionIds']);
const OBJECTIVES = new Set(['operations', 'energy', 'duration', 'waste', 'economic']);

function scaleRecord(record, scale) {
    return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, value * scale]));
}

function scaleFlow(flow, scale) {
    return {
        ...cloneStrictJson(flow),
        massKg: flow.massKg * scale,
        constituentMassKg: scaleRecord(flow.constituentMassKg, scale),
        elementAmountsMol: scaleRecord(flow.elementAmountsMol, scale),
        isotopeAmountsMol: scaleRecord(flow.isotopeAmountsMol, scale),
        chargeC: flow.chargeC * scale,
    };
}

function scaleReservoir(reservoir, scale) {
    return {
        ...cloneStrictJson(reservoir),
        massKg: reservoir.massKg * scale,
        constituentMassKg: scaleRecord(reservoir.constituentMassKg, scale),
        elementAmountsMol: scaleRecord(reservoir.elementAmountsMol, scale),
        isotopeAmountsMol: scaleRecord(reservoir.isotopeAmountsMol, scale),
        chargeC: reservoir.chargeC * scale,
    };
}

function request(input) {
    const source = cloneStrictJson(input, '$.processPlanRequest');
    requireExactKeys(source, PLAN_KEYS, REQUIRED_PLAN_KEYS, '$.processPlanRequest');
    requireIdentifierArray(source.availableDefinitionIds, '$.processPlanRequest.availableDefinitionIds');
    requireIdentifierArray(source.targetDefinitionIds, '$.processPlanRequest.targetDefinitionIds', { allowEmpty: false });
    const objective = source.objective ?? 'operations';
    requireString(objective, '$.processPlanRequest.objective');
    if (!OBJECTIVES.has(objective)) throw new RangeError('$.processPlanRequest.objective: is unsupported');
    const maxDepth = source.maxDepth ?? 12;
    const maxStates = source.maxStates ?? 4096;
    const batchScale = source.batchScale ?? 1;
    requireInteger(maxDepth, '$.processPlanRequest.maxDepth', { minimum: 0, maximum: 64 });
    requireInteger(maxStates, '$.processPlanRequest.maxStates', { minimum: 1, maximum: 100000 });
    requireFinite(batchScale, '$.processPlanRequest.batchScale', { minimum: Number.MIN_VALUE });
    const context = source.context ?? {};
    requireRecord(context, '$.processPlanRequest.context');
    return {
        availableDefinitionIds: source.availableDefinitionIds,
        targetDefinitionIds: source.targetDefinitionIds,
        context,
        objective,
        maxDepth,
        maxStates,
        batchScale,
    };
}

function stepRecord(transformation, index, scale) {
    return {
        sequence: index + 1,
        transformationId: transformation.id,
        label: transformation.label,
        category: transformation.category,
        inputs: transformation.inputs.map(flow => scaleFlow(flow, scale)),
        outputs: transformation.outputs.map(flow => scaleFlow(flow, scale)),
        byproducts: transformation.byproducts.map(flow => scaleFlow(flow, scale)),
        reservoirs: transformation.reservoirs.map(reservoir => scaleReservoir(reservoir, scale)),
        equipment: cloneStrictJson(transformation.equipment),
        conditions: cloneStrictJson(transformation.conditions),
        evidence: cloneStrictJson(transformation.evidence),
        stateEffectTags: [...new Set([
            ...transformation.outputs.flatMap(flow => flow.stateEffectTags),
            ...transformation.byproducts.flatMap(flow => flow.stateEffectTags),
        ])].sort(),
        estimatedCost: {
            operations: transformation.cost.operations,
            energyJ: transformation.cost.energyJ * scale,
            durationS: transformation.cost.durationS,
            wasteKg: transformation.cost.wasteKg * scale,
            economic: transformation.cost.economic * scale,
        },
    };
}

export class RealmProcessPlanner {
    #registry;
    #graph;
    #diagnostics;

    constructor(registry, { graph = null, propertyResolver = null, logger = null } = {}) {
        if (!registry || typeof registry.getTransformation !== 'function') {
            throw new TypeError('$.registry: must be a RealmMatterRegistry-compatible object');
        }
        if (graph != null && typeof graph.forwardSearch !== 'function') {
            throw new TypeError('$.graph: must be a RealmTransformationGraph-compatible object');
        }
        this.#registry = registry;
        this.#graph = graph ?? createRealmTransformationGraph(registry, { propertyResolver, logger });
        this.#diagnostics = new FabricDiagnostics('matter.fabric.process-planner', logger);
    }

    plan(input) {
        const token = this.#diagnostics.begin('process.plan');
        try {
            const candidate = request(input);
            const route = this.#graph.forwardSearch({
                availableDefinitionIds: candidate.availableDefinitionIds,
                targetDefinitionIds: candidate.targetDefinitionIds,
                context: candidate.context,
                objective: candidate.objective,
                maxDepth: candidate.maxDepth,
                maxStates: candidate.maxStates,
            });
            const steps = route.path.map((transformationId, index) => {
                const transformation = this.#registry.getTransformation(transformationId);
                if (!transformation) throw new Error(`Planned transformation '${transformationId}' is unavailable`);
                return stepRecord(transformation, index, candidate.batchScale);
            });
            const totals = steps.reduce((sum, step) => ({
                operations: sum.operations + step.estimatedCost.operations,
                energyJ: sum.energyJ + step.estimatedCost.energyJ,
                durationS: sum.durationS + step.estimatedCost.durationS,
                wasteKg: sum.wasteKg + step.estimatedCost.wasteKg,
                economic: sum.economic + step.estimatedCost.economic,
            }), { operations: 0, energyJ: 0, durationS: 0, wasteKg: 0, economic: 0 });
            const output = freeze({
                schema: REALM_PROCESS_PLAN_SCHEMA,
                schemaVersion: REALM_PROCESS_PLAN_VERSION,
                found: route.found,
                objective: candidate.objective,
                batchScale: candidate.batchScale,
                scalingAssumption: 'linear-normalized-batch-mass-energy-cost',
                availableDefinitionIds: candidate.availableDefinitionIds,
                targetDefinitionIds: candidate.targetDefinitionIds,
                reachedDefinitionIds: route.reachedDefinitionIds,
                unmetDefinitionIds: route.unmetDefinitionIds,
                exploredStates: route.exploredStates,
                steps,
                totals,
            }, '$.realmProcessPlan');
            this.#diagnostics.end(token, { found: output.found, steps: steps.length, exploredStates: route.exploredStates });
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

export function createRealmProcessPlanner(registry, options = {}) {
    return new RealmProcessPlanner(registry, options);
}
