// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Deterministic conservation accounting across immutable matter-state snapshots. */

import {
    cloneStrictJson,
    isPlainJsonObject,
} from '../../core/schema/StrictJsonValue.js';
import { snapshotMatterStates } from '../contracts/MatterContracts.js';
import { float64Ulp } from '../../core/math/RobustNumericMath.js';

export const MATTER_CONSERVATION_LEDGER_SCHEMA = 'engine.matter.conservation-ledger';
export const MATTER_CONSERVATION_LEDGER_VERSION = '1.0.0';
export const MATTER_CONSERVATION_DEFAULT_TOLERANCE = 1e-9;
export const MATTER_ENERGY_ROUNDOFF_MODEL = 'binary64-summary-v1';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$/;
const CONSERVED_KEYS = new Set([
    'speciesMassKg', 'momentumKgMPerS', 'internalEnergyJ', 'electricChargeC',
]);
const LEDGER_KEYS = new Set([
    'schema', 'schemaVersion', 'tolerance', 'before', 'after',
    'externalDelta', 'deltas', 'errors', 'balanced',
]);
const BALANCED_KEYS = new Set([
    'speciesMassKg', 'momentumKgMPerS', 'internalEnergyJ', 'electricChargeC', 'all',
]);
const ROUNDOFF_LEDGER_KEYS = new Set([...LEDGER_KEYS, 'energyRoundoff']);
const ENERGY_ROUNDOFF_KEYS = new Set(['model', 'allowanceJ']);
const conservedSummaries = new WeakMap();
// Proof belongs only to receipts constructed and recursively frozen here.
// Caller-frozen lookalikes still require complete data/schema admission.
const immutableLedgers = new WeakSet();

function fail(message) {
    throw new TypeError(`MatterConservationLedger: ${message}`);
}

function cleanZero(value) {
    return value === 0 ? 0 : value;
}

function finite(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${label} must be finite`);
    return value;
}

function add(accumulator, value, label) {
    const adjusted = value - accumulator.correction;
    const next = accumulator.sum + adjusted;
    if (!Number.isFinite(next)) fail(`${label} exceeds the finite numeric range`);
    accumulator.correction = (next - accumulator.sum) - adjusted;
    accumulator.sum = next;
}

function total(accumulator) {
    return cleanZero(accumulator.sum);
}

// These fixed-shape rows contain only locally constructed data. Admitted
// summaries and external deltas already have finite leaves; subtraction can
// overflow, so computed rows must check every result before gaining proof.
function freezeOwnedConserved(value, computedPath = null) {
    if (computedPath !== null) {
        for (const key of Object.keys(value.speciesMassKg)) finite(value.speciesMassKg[key], `${computedPath}.speciesMassKg.${key}`);
        for (let axis = 0; axis < 3; axis++) finite(value.momentumKgMPerS[axis], `${computedPath}.momentumKgMPerS[${axis}]`);
        finite(value.internalEnergyJ, `${computedPath}.internalEnergyJ`);
        finite(value.electricChargeC, `${computedPath}.electricChargeC`);
    }
    Object.freeze(value.speciesMassKg);
    Object.freeze(value.momentumKgMPerS);
    return Object.freeze(value);
}

function normalizedStates(states, label, reference = null) {
    if (!Array.isArray(states)) fail(`${label} must be an array`);
    // A ledger's two admitted lists commonly update the same owners in place.
    // Reuse only the private ordering proof after comparing every region ID;
    // this also proves uniqueness without another Set or locale sort.
    if (reference && states.length === reference.states.length
        && states.every((state, index) => state.regionId === reference.states[index].regionId)) {
        return reference.order;
    }
    const normalized = [];
    const regionIds = new Set();
    for (let index = 0; index < states.length; index += 1) {
        const state = states[index];
        if (regionIds.has(state.regionId)) fail(`${label} duplicates region '${state.regionId}'`);
        regionIds.add(state.regionId);
        normalized.push(index);
    }
    return normalized.sort((left, right) => states[left].regionId.localeCompare(states[right].regionId));
}

function identifier(value, label) {
    if (typeof value !== 'string' || !IDENTIFIER.test(value)) fail(`${label} has invalid syntax`);
    return value;
}

function signedSpeciesRecord(value, label) {
    if (!isPlainJsonObject(value)) fail(`${label} must be a plain object`);
    const normalized = {};
    for (const key of Object.keys(value).sort()) {
        identifier(key, `${label} key`);
        normalized[key] = cleanZero(finite(value[key], `${label}.${key}`));
    }
    return normalized;
}

function signedVector(value, label) {
    if (!Array.isArray(value) || value.length !== 3) fail(`${label} must be a 3-vector`);
    return value.map((entry, index) => cleanZero(finite(entry, `${label}[${index}]`)));
}

function exactRecord(value, keys, label) {
    if (!isPlainJsonObject(value)) fail(`${label} must be a plain object`);
    for (const key of Object.keys(value)) {
        if (!keys.has(key)) fail(`${label}.${key} is an unknown field`);
    }
    for (const key of keys) {
        if (!Object.hasOwn(value, key)) fail(`${label}.${key} is required`);
    }
    return value;
}

function validateSummary(value, label, { nonnegative = false } = {}) {
    exactRecord(value, CONSERVED_KEYS, label);
    signedSpeciesRecord(value.speciesMassKg, `${label}.speciesMassKg`);
    signedVector(value.momentumKgMPerS, `${label}.momentumKgMPerS`);
    finite(value.internalEnergyJ, `${label}.internalEnergyJ`);
    finite(value.electricChargeC, `${label}.electricChargeC`);
    if (nonnegative) {
        if (Object.values(value.speciesMassKg).some(amount => amount < 0)) {
            fail(`${label}.speciesMassKg must be non-negative`);
        }
        if (value.internalEnergyJ < 0) fail(`${label}.internalEnergyJ must be non-negative`);
    }
    return value;
}

function sameSpecies(left, right) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    return [...keys].every(key => Object.hasOwn(left, key)
        && Object.hasOwn(right, key) && left[key] === right[key]);
}

function sameConserved(left, right) {
    return sameSpecies(left.speciesMassKg, right.speciesMassKg)
        && left.momentumKgMPerS.every((value, index) => value === right.momentumKgMPerS[index])
        && left.internalEnergyJ === right.internalEnergyJ
        && left.electricChargeC === right.electricChargeC;
}

function normalizeExternalDelta(value) {
    const source = value == null ? {} : cloneStrictJson(value, '$.externalDelta');
    if (!isPlainJsonObject(source)) fail('externalDelta must be a plain object');
    for (const key of Object.keys(source)) {
        if (!CONSERVED_KEYS.has(key)) fail(`externalDelta.${key} is an unknown field`);
    }
    return {
        speciesMassKg: signedSpeciesRecord(source.speciesMassKg ?? {}, 'externalDelta.speciesMassKg'),
        momentumKgMPerS: signedVector(source.momentumKgMPerS ?? [0, 0, 0], 'externalDelta.momentumKgMPerS'),
        internalEnergyJ: cleanZero(finite(source.internalEnergyJ ?? 0, 'externalDelta.internalEnergyJ')),
        electricChargeC: cleanZero(finite(source.electricChargeC ?? 0, 'externalDelta.electricChargeC')),
    };
}

/** Sum the four conserved quantities over a deterministic region ordering. */
export function summarizeMatterConserved(states) {
    return summarizedStates(states).summary;
}

function summarizedStates(states, reference = null) {
    if (!Array.isArray(states)) fail('$.states must be an array');
    // Only snapshotMatterStates' admitted immutable list can be reused. A raw
    // caller list is detached on every call, even when its elements are frozen.
    const admitted = snapshotMatterStates(states, '$.states');
    const cached = conservedSummaries.get(admitted);
    if (cached) return cached;
    const normalized = normalizedStates(admitted, '$.states', reference);
    const species = new Map();
    const momentum = Array.from({ length: 3 }, () => ({ sum: 0, correction: 0 }));
    const internalEnergy = { sum: 0, correction: 0 };
    const electricCharge = { sum: 0, correction: 0 };

    for (const index of normalized) {
        const state = admitted[index];
        for (const speciesId of Object.keys(state.conserved.speciesMassKg).sort()) {
            let accumulator = species.get(speciesId);
            if (!accumulator) {
                accumulator = { sum: 0, correction: 0 };
                species.set(speciesId, accumulator);
            }
            add(accumulator, state.conserved.speciesMassKg[speciesId], `species '${speciesId}' mass`);
        }
        for (let axis = 0; axis < 3; axis += 1) {
            add(momentum[axis], state.conserved.momentumKgMPerS[axis], `momentum axis ${axis}`);
        }
        add(internalEnergy, state.conserved.internalEnergyJ, 'internal energy');
        add(electricCharge, state.conserved.electricChargeC, 'electric charge');
    }

    const speciesMassKg = {};
    for (const speciesId of [...species.keys()].sort()) speciesMassKg[speciesId] = total(species.get(speciesId));
    const summary = freezeOwnedConserved({
        speciesMassKg,
        momentumKgMPerS: momentum.map(total),
        internalEnergyJ: total(internalEnergy),
        electricChargeC: total(electricCharge),
    });
    const evidence = { states: admitted, order: normalized, summary };
    conservedSummaries.set(admitted, evidence);
    return evidence;
}

function difference(after, before) {
    const speciesIds = new Set([
        ...Object.keys(before.speciesMassKg),
        ...Object.keys(after.speciesMassKg),
    ]);
    const speciesMassKg = {};
    for (const speciesId of [...speciesIds].sort()) {
        speciesMassKg[speciesId] = cleanZero(
            (after.speciesMassKg[speciesId] ?? 0) - (before.speciesMassKg[speciesId] ?? 0),
        );
    }
    return {
        speciesMassKg,
        momentumKgMPerS: after.momentumKgMPerS.map((value, axis) => (
            cleanZero(value - before.momentumKgMPerS[axis])
        )),
        internalEnergyJ: cleanZero(after.internalEnergyJ - before.internalEnergyJ),
        electricChargeC: cleanZero(after.electricChargeC - before.electricChargeC),
    };
}

function residual(delta, externalDelta) {
    const speciesIds = new Set([
        ...Object.keys(delta.speciesMassKg),
        ...Object.keys(externalDelta.speciesMassKg),
    ]);
    const speciesMassKg = {};
    for (const speciesId of [...speciesIds].sort()) {
        speciesMassKg[speciesId] = cleanZero(
            (delta.speciesMassKg[speciesId] ?? 0) - (externalDelta.speciesMassKg[speciesId] ?? 0),
        );
    }
    return {
        speciesMassKg,
        momentumKgMPerS: delta.momentumKgMPerS.map((value, axis) => (
            cleanZero(value - externalDelta.momentumKgMPerS[axis])
        )),
        internalEnergyJ: cleanZero(delta.internalEnergyJ - externalDelta.internalEnergyJ),
        electricChargeC: cleanZero(delta.electricChargeC - externalDelta.electricChargeC),
    };
}

function within(value, tolerance) {
    return Math.abs(value) <= tolerance;
}

/** Each compensated energy summary is still rounded to one binary64 value.
 * Retain the raw subtraction error and account for one ULP per operand when
 * explicitly requested. This changes no inventory or other quantity's bound. */
function energyRoundoffEvidence(model, before, after, external) {
    if (model === null) return null;
    if (model !== MATTER_ENERGY_ROUNDOFF_MODEL) fail('unsupported energy roundoff model');
    const allowanceJ = finite(float64Ulp(before.internalEnergyJ)
        + float64Ulp(after.internalEnergyJ) + float64Ulp(external.internalEnergyJ), 'energy roundoff allowance');
    return { model, allowanceJ };
}

/** Build an immutable conservation receipt, strict by default. The optional
 * energyRoundoff model records a recomputable binary64 energy-only allowance. */
export function createMatterConservationLedger({
    beforeStates,
    afterStates,
    externalDelta = null,
    tolerance = MATTER_CONSERVATION_DEFAULT_TOLERANCE,
    energyRoundoff = null,
} = {}) {
    const absoluteTolerance = finite(tolerance, 'tolerance');
    if (absoluteTolerance < 0) fail('tolerance must be non-negative');
    const beforeEvidence = summarizedStates(beforeStates);
    const before = beforeEvidence.summary;
    const after = summarizedStates(afterStates, beforeEvidence).summary;
    const external = freezeOwnedConserved(normalizeExternalDelta(externalDelta));
    const deltas = freezeOwnedConserved(difference(after, before), '$.matterConservationLedger.deltas');
    const errors = freezeOwnedConserved(residual(deltas, external), '$.matterConservationLedger.errors');
    const rounding = energyRoundoffEvidence(energyRoundoff, before, after, external);
    const energyTolerance = finite(absoluteTolerance + (rounding?.allowanceJ ?? 0), 'energy tolerance');
    const balanced = {
        speciesMassKg: Object.values(errors.speciesMassKg).every(value => within(value, absoluteTolerance)),
        momentumKgMPerS: errors.momentumKgMPerS.every(value => within(value, absoluteTolerance)),
        internalEnergyJ: within(errors.internalEnergyJ, energyTolerance),
        electricChargeC: within(errors.electricChargeC, absoluteTolerance),
    };
    balanced.all = Object.values(balanced).every(Boolean);
    Object.freeze(balanced);
    if (rounding) Object.freeze(rounding);

    const ledger = Object.freeze({
        schema: MATTER_CONSERVATION_LEDGER_SCHEMA,
        schemaVersion: MATTER_CONSERVATION_LEDGER_VERSION,
        tolerance: absoluteTolerance,
        before,
        after,
        externalDelta: external,
        deltas,
        errors,
        balanced,
        ...(rounding ? { energyRoundoff: rounding } : {}),
    });
    immutableLedgers.add(ledger);
    return ledger;
}

/** Recompute receipt evidence and reject errors beyond the declared bounds. */
export function assertMatterConservation(ledger) {
    const owned = immutableLedgers.has(ledger);
    const value = owned ? ledger : cloneStrictJson(ledger, '$.matterConservationLedger');
    if (!owned) {
        exactRecord(value, Object.hasOwn(value, 'energyRoundoff') ? ROUNDOFF_LEDGER_KEYS : LEDGER_KEYS, 'ledger');
        if (value.schema !== MATTER_CONSERVATION_LEDGER_SCHEMA
            || value.schemaVersion !== MATTER_CONSERVATION_LEDGER_VERSION) {
            fail('ledger schema is unsupported');
        }
        finite(value.tolerance, 'ledger.tolerance');
        if (value.tolerance < 0) fail('ledger.tolerance must be non-negative');
        validateSummary(value.before, 'ledger.before', { nonnegative: true });
        validateSummary(value.after, 'ledger.after', { nonnegative: true });
        exactRecord(value.externalDelta, CONSERVED_KEYS, 'ledger.externalDelta');
    }
    const tolerance = value.tolerance;
    const externalDelta = owned ? value.externalDelta : normalizeExternalDelta(value.externalDelta);
    let energyTolerance = tolerance;
    if (Object.hasOwn(value, 'energyRoundoff')) {
        if (!owned) exactRecord(value.energyRoundoff, ENERGY_ROUNDOFF_KEYS, 'ledger.energyRoundoff');
        const evidence = energyRoundoffEvidence(value.energyRoundoff.model, value.before, value.after, externalDelta);
        if (!evidence || value.energyRoundoff.allowanceJ !== evidence.allowanceJ) fail('energy roundoff allowance does not match summary precision');
        energyTolerance = finite(tolerance + evidence.allowanceJ, 'energy tolerance');
    }
    if (!owned) {
        validateSummary(value.deltas, 'ledger.deltas');
        validateSummary(value.errors, 'ledger.errors');
    }
    const expectedDeltas = difference(value.after, value.before);
    if (!sameConserved(value.deltas, expectedDeltas)) {
        fail('ledger.deltas do not match before/after summaries');
    }
    const expectedErrors = residual(expectedDeltas, externalDelta);
    if (!sameConserved(value.errors, expectedErrors)) {
        fail('ledger.errors do not match the external delta');
    }

    if (!owned) exactRecord(value.balanced, BALANCED_KEYS, 'ledger.balanced');
    const expectedBalanced = {
        speciesMassKg: Object.values(expectedErrors.speciesMassKg).every(entry => within(entry, tolerance)),
        momentumKgMPerS: expectedErrors.momentumKgMPerS.every(entry => within(entry, tolerance)),
        internalEnergyJ: within(expectedErrors.internalEnergyJ, energyTolerance),
        electricChargeC: within(expectedErrors.electricChargeC, tolerance),
    };
    expectedBalanced.all = Object.values(expectedBalanced).every(Boolean);
    for (const key of BALANCED_KEYS) {
        if (typeof value.balanced[key] !== 'boolean' || value.balanced[key] !== expectedBalanced[key]) {
            fail(`ledger.balanced.${key} does not match the conservation error`);
        }
    }
    if (!expectedBalanced.all) {
        const quantities = ['speciesMassKg', 'momentumKgMPerS', 'internalEnergyJ', 'electricChargeC']
            .filter(key => expectedBalanced[key] !== true);
        throw new RangeError(`Matter conservation failed for: ${quantities.join(', ')}`);
    }
    return ledger;
}

export default createMatterConservationLedger;
