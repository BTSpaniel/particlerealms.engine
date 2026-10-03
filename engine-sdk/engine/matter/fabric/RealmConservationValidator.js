// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Conservation receipts for matter, constituents, elements, isotopes, charge, and reservoirs. */

import {
    FabricDiagnostics,
    freeze,
} from './FabricSupport.js';
import { validateRealmTransformation } from './RealmMatterContracts.js';

export const REALM_CONSERVATION_RECEIPT_SCHEMA = 'engine.matter.fabric.conservation-receipt';
export const REALM_CONSERVATION_RECEIPT_VERSION = '1.0.0';

function addRecord(target, source, multiplier = 1) {
    for (const [id, value] of Object.entries(source)) target[id] = (target[id] ?? 0) + value * multiplier;
}

function sideSummary() {
    return { massKg: 0, constituentMassKg: {}, elementAmountsMol: {}, isotopeAmountsMol: {}, chargeC: 0 };
}

function addFlow(side, flow) {
    if (!flow.consumed) return;
    side.massKg += flow.massKg;
    side.chargeC += flow.chargeC;
    addRecord(side.constituentMassKg, flow.constituentMassKg);
    addRecord(side.elementAmountsMol, flow.elementAmountsMol);
    addRecord(side.isotopeAmountsMol, flow.isotopeAmountsMol);
}

function addReservoir(side, reservoir) {
    side.massKg += reservoir.massKg;
    side.chargeC += reservoir.chargeC;
    addRecord(side.constituentMassKg, reservoir.constituentMassKg);
    addRecord(side.elementAmountsMol, reservoir.elementAmountsMol);
    addRecord(side.isotopeAmountsMol, reservoir.isotopeAmountsMol);
}

function residualRecord(before, after) {
    const result = {};
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of [...keys].sort()) result[key] = (after[key] ?? 0) - (before[key] ?? 0);
    return result;
}

function within(before, after, residual, absolute, relative) {
    return Math.abs(residual) <= absolute + relative * Math.max(1, Math.abs(before), Math.abs(after));
}

function recordBalanced(before, after, residual, absolute, relative) {
    return Object.keys(residual).every(id => within(before[id] ?? 0, after[id] ?? 0, residual[id], absolute, relative));
}

function coverageIssues(flows, reservoirs, policy) {
    if (!policy.constituents) return [];
    const issues = [];
    for (const [group, records] of [['flow', flows], ['reservoir', reservoirs]]) {
        records.forEach((record, index) => {
            if (group === 'flow' && !record.consumed) return;
            const sum = Object.values(record.constituentMassKg).reduce((total, value) => total + value, 0);
            if (!within(record.massKg, sum, sum - record.massKg, policy.absoluteTolerance, policy.relativeTolerance)) {
                issues.push(`${group}[${index}] constituent mass ${sum} does not cover declared mass ${record.massKg}`);
            }
        });
    }
    return issues;
}

export class RealmConservationValidator {
    #diagnostics;

    constructor({ logger = null } = {}) {
        this.#diagnostics = new FabricDiagnostics('matter.fabric.conservation', logger);
    }

    validate(transformation) {
        const token = this.#diagnostics.begin('conservation.validate');
        try {
            validateRealmTransformation(transformation);
            const before = sideSummary();
            const after = sideSummary();
            transformation.inputs.forEach(flow => addFlow(before, flow));
            transformation.outputs.forEach(flow => addFlow(after, flow));
            transformation.byproducts.forEach(flow => addFlow(after, flow));
            if (transformation.conservation.allowEnvironmentalExchange) {
                transformation.reservoirs.forEach(reservoir => (
                    addReservoir(reservoir.direction === 'input' ? before : after, reservoir)
                ));
            }
            const residual = {
                massKg: after.massKg - before.massKg,
                constituentMassKg: residualRecord(before.constituentMassKg, after.constituentMassKg),
                elementAmountsMol: residualRecord(before.elementAmountsMol, after.elementAmountsMol),
                isotopeAmountsMol: residualRecord(before.isotopeAmountsMol, after.isotopeAmountsMol),
                chargeC: after.chargeC - before.chargeC,
            };
            const policy = transformation.conservation;
            const balanced = {
                mass: !policy.mass || within(before.massKg, after.massKg, residual.massKg,
                    policy.absoluteTolerance, policy.relativeTolerance),
                constituents: !policy.constituents || recordBalanced(before.constituentMassKg, after.constituentMassKg,
                    residual.constituentMassKg, policy.absoluteTolerance, policy.relativeTolerance),
                elements: !policy.elements || recordBalanced(before.elementAmountsMol, after.elementAmountsMol,
                    residual.elementAmountsMol, policy.absoluteTolerance, policy.relativeTolerance),
                isotopes: !policy.isotopes || recordBalanced(before.isotopeAmountsMol, after.isotopeAmountsMol,
                    residual.isotopeAmountsMol, policy.absoluteTolerance, policy.relativeTolerance),
                charge: !policy.charge || within(before.chargeC, after.chargeC, residual.chargeC,
                    policy.absoluteTolerance, policy.relativeTolerance),
                declaredReservoirs: policy.allowEnvironmentalExchange || transformation.reservoirs.length === 0,
            };
            const coverage = coverageIssues(
                [...transformation.inputs, ...transformation.outputs, ...transformation.byproducts],
                transformation.reservoirs,
                policy,
            );
            balanced.constituentCoverage = coverage.length === 0;
            balanced.all = Object.values(balanced).every(Boolean);
            const receipt = freeze({
                schema: REALM_CONSERVATION_RECEIPT_SCHEMA,
                schemaVersion: REALM_CONSERVATION_RECEIPT_VERSION,
                transformationId: transformation.id,
                before,
                after,
                residual,
                balanced,
                issues: coverage,
                policy,
            }, '$.conservationReceipt');
            this.#diagnostics.end(token, {
                transformationId: transformation.id,
                balanced: balanced.all,
                trackedScalars: 2 + Object.keys(residual.constituentMassKg).length
                    + Object.keys(residual.elementAmountsMol).length + Object.keys(residual.isotopeAmountsMol).length,
            });
            return receipt;
        } catch (error) {
            this.#diagnostics.error(token, error);
            throw error;
        }
    }

    assert(transformation) {
        const receipt = this.validate(transformation);
        if (!receipt.balanced.all) {
            const error = new Error(`Transformation ${transformation.id} violates its conservation policy`);
            error.name = 'RealmConservationError';
            error.receipt = receipt;
            throw error;
        }
        return receipt;
    }

    diagnostics() {
        return this.#diagnostics.snapshot();
    }
}

export function createRealmConservationValidator(options = {}) {
    return new RealmConservationValidator(options);
}

export function validateRealmTransformationConservation(transformation) {
    return new RealmConservationValidator().validate(transformation);
}

export function assertRealmTransformationConservation(transformation) {
    return new RealmConservationValidator().assert(transformation);
}
