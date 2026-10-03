// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Deterministic XPBD-style bonded-matter constraint solver and lifecycle. */

import {
    cloneAndFreezeStrictJson,
    cloneStrictJson,
    isPlainJsonObject,
} from '../../core/schema/StrictJsonValue.js';
import {
    STRUCTURAL_BOND_STAGES,
    validateStructuralCrackResidual,
    validateStructuralMaterialProfile,
} from './StructuralContracts.js';
import {
    STRUCTURAL_MATERIAL_PROFILES,
} from './StructuralMaterialProfiles.js';
import {
    selectPowerOfTwoTimeBin,
    shouldRunPowerOfTwoTimeBin,
} from './StructuralTimeBins.js';

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,191}$/;
const MEASUREMENT_KEYS = new Set(['bondId', 'shearDisplacementM', 'bendRadians', 'temperatureK']);
const STEP_KEYS = new Set(['frameId', 'stepIndex', 'deltaSeconds', 'substeps', 'measurements']);
const STAGE_INDEX = new Map(STRUCTURAL_BOND_STAGES.map((stage, index) => [stage, index]));

function fail(path, message) { throw new TypeError(`${path}: ${message}`); }

function identifier(value, path) {
    if (typeof value !== 'string' || !IDENTIFIER.test(value)) fail(path, 'has invalid identifier syntax');
    return value;
}

function finite(value, path, minimum = -Number.MAX_VALUE, maximum = Number.MAX_VALUE) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
        fail(path, `must be finite in [${minimum}, ${maximum}]`);
    }
    return value;
}

function integer(value, path, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        fail(path, `must be a safe integer in [${minimum}, ${maximum}]`);
    }
    return value;
}

function exact(value, allowed, required, path) {
    if (!isPlainJsonObject(value)) fail(path, 'must be a plain object');
    for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${path}.${key}`, 'unknown field');
    for (const key of required) if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, 'is required');
    return value;
}

function safeOptions(input, allowed, path) {
    if (!isPlainJsonObject(input)) fail(path, 'must be a plain object');
    const output = {};
    for (const key of Reflect.ownKeys(input)) {
        if (typeof key !== 'string') fail(path, 'symbol keys are not supported');
        if (!allowed.has(key)) fail(`${path}.${key}`, 'unknown field');
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor?.enumerable) fail(`${path}.${key}`, 'non-enumerable fields are not supported');
        if (!Object.hasOwn(descriptor, 'value')) fail(`${path}.${key}`, 'accessors are not supported');
        output[key] = descriptor.value;
    }
    return output;
}

function vector(value, path) {
    if (!Array.isArray(value) || value.length !== 3) fail(path, 'must be a 3-vector');
    value.forEach((entry, index) => finite(entry, `${path}[${index}]`));
    return value;
}

function nowMs() { return globalThis.performance?.now?.() ?? Date.now(); }

function log(logger, type, details = {}) {
    try { logger?.(Object.freeze({ type, ...details })); } catch (_) { /* diagnostics own no simulation state */ }
}

function normalize(value, fallback) {
    const magnitude = Math.hypot(...value);
    return magnitude <= Number.EPSILON ? [...fallback] : value.map(entry => entry / magnitude);
}

function addScaled(left, direction, scale) {
    return left.map((entry, axis) => entry + direction[axis] * scale);
}

function clamp01(value) { return Math.max(0, Math.min(1, value)); }

function hashToken(value) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function solveXpbdScalarConstraint(input) {
    const candidate = cloneStrictJson(input, '$.xpbdConstraint');
    exact(candidate, new Set([
        'constraint', 'compliance', 'deltaSeconds', 'accumulatedLambda', 'inverseMassSum',
    ]), new Set([
        'constraint', 'compliance', 'deltaSeconds', 'accumulatedLambda', 'inverseMassSum',
    ]), '$.xpbdConstraint');
    const constraint = finite(candidate.constraint, '$.xpbdConstraint.constraint');
    const compliance = finite(candidate.compliance, '$.xpbdConstraint.compliance', 0);
    const deltaSeconds = finite(candidate.deltaSeconds, '$.xpbdConstraint.deltaSeconds', Number.MIN_VALUE);
    const accumulatedLambda = finite(candidate.accumulatedLambda, '$.xpbdConstraint.accumulatedLambda');
    const inverseMassSum = finite(candidate.inverseMassSum, '$.xpbdConstraint.inverseMassSum', 0);
    const alpha = compliance / (deltaSeconds * deltaSeconds);
    const denominator = inverseMassSum + alpha;
    const deltaLambda = denominator === 0 ? 0 : (-constraint - alpha * accumulatedLambda) / denominator;
    return cloneAndFreezeStrictJson({
        alpha,
        deltaLambda,
        lambda: accumulatedLambda + deltaLambda,
        correctionMagnitude: Math.abs(deltaLambda),
    });
}

function normalizeProfiles(profilesInput) {
    const cloned = cloneStrictJson(profilesInput, '$.options.profiles');
    const entries = Array.isArray(cloned) ? cloned : Object.values(cloned);
    if (entries.length === 0) fail('$.options.profiles', 'must be non-empty');
    const profiles = new Map();
    entries.forEach((profile, index) => {
        validateStructuralMaterialProfile(profile, `$.options.profiles[${index}]`);
        if (profiles.has(profile.id)) fail(`$.options.profiles[${index}].id`, 'duplicates an earlier profile');
        profiles.set(profile.id, cloneAndFreezeStrictJson(profile));
    });
    return profiles;
}

function normalizeMeasurements(input) {
    if (!Array.isArray(input) || input.length > 4_000_000) fail('$.step.measurements', 'must be a bounded array');
    const result = new Map();
    input.forEach((entry, index) => {
        exact(entry, MEASUREMENT_KEYS, MEASUREMENT_KEYS, `$.step.measurements[${index}]`);
        const bondId = identifier(entry.bondId, `$.step.measurements[${index}].bondId`);
        if (result.has(bondId)) fail(`$.step.measurements[${index}].bondId`, 'duplicates an earlier measurement');
        vector(entry.shearDisplacementM, `$.step.measurements[${index}].shearDisplacementM`);
        finite(entry.bendRadians, `$.step.measurements[${index}].bendRadians`, -Math.PI, Math.PI);
        finite(entry.temperatureK, `$.step.measurements[${index}].temperatureK`, 0);
        result.set(bondId, entry);
    });
    return result;
}

function validateIdentifierArray(value, path) {
    if (!Array.isArray(value)) fail(path, 'must be an array');
    const seen = new Set();
    value.forEach((entry, index) => {
        const id = identifier(entry, `${path}[${index}]`);
        if (seen.has(id)) fail(`${path}[${index}]`, 'duplicates an earlier identifier');
        if (index > 0 && value[index - 1].localeCompare(id) >= 0) fail(path, 'must be strictly sorted');
        seen.add(id);
    });
    return seen;
}

function validateStepReceipt(receipt, path) {
    exact(receipt, new Set([
        'frameId', 'stepIndex', 'deviceGeneration', 'processedBondIds', 'skippedBondIds',
        'constraintCounts', 'stateTransitions', 'fractures', 'localComponentCount',
    ]), new Set([
        'frameId', 'stepIndex', 'deviceGeneration', 'processedBondIds', 'skippedBondIds',
        'constraintCounts', 'stateTransitions', 'fractures', 'localComponentCount',
    ]), path);
    identifier(receipt.frameId, `${path}.frameId`);
    integer(receipt.stepIndex, `${path}.stepIndex`, 1);
    integer(receipt.deviceGeneration, `${path}.deviceGeneration`);
    const processed = validateIdentifierArray(receipt.processedBondIds, `${path}.processedBondIds`);
    const skipped = validateIdentifierArray(receipt.skippedBondIds, `${path}.skippedBondIds`);
    if ([...processed].some(id => skipped.has(id))) fail(path, 'a bond cannot be processed and skipped');
    exact(receipt.constraintCounts, new Set(['tension', 'compression', 'shear', 'bend']),
        new Set(['tension', 'compression', 'shear', 'bend']), `${path}.constraintCounts`);
    for (const mode of ['tension', 'compression', 'shear', 'bend']) {
        integer(receipt.constraintCounts[mode], `${path}.constraintCounts.${mode}`);
    }
    if (!Array.isArray(receipt.stateTransitions)) fail(`${path}.stateTransitions`, 'must be an array');
    receipt.stateTransitions.forEach((transition, index) => {
        const at = `${path}.stateTransitions[${index}]`;
        exact(transition, new Set(['bondId', 'from', 'to']), new Set(['bondId', 'from', 'to']), at);
        identifier(transition.bondId, `${at}.bondId`);
        if (!STAGE_INDEX.has(transition.from) || !STAGE_INDEX.has(transition.to)
            || STAGE_INDEX.get(transition.to) <= STAGE_INDEX.get(transition.from)) {
            fail(at, 'must advance lifecycle');
        }
    });
    if (!Array.isArray(receipt.fractures)) fail(`${path}.fractures`, 'must be an array');
    receipt.fractures.forEach((fracture, index) => validateStructuralCrackResidual(fracture, `${path}.fractures[${index}]`));
    integer(receipt.localComponentCount, `${path}.localComponentCount`);
    return receipt;
}

function effectiveCompliance(profile, mode, direction, temperatureK) {
    const alignment = Math.abs(direction.reduce((sum, value, axis) => (
        sum + value * profile.anisotropy.axis[axis]
    ), 0));
    const anisotropy = profile.anisotropy.crossScale
        + (profile.anisotropy.alongScale - profile.anisotropy.crossScale) * alignment;
    const thermalRange = profile.thermalFailureK - profile.thermalSofteningStartK;
    const thermal = temperatureK <= profile.thermalSofteningStartK
        ? 1
        : 1 + 99 * clamp01((temperatureK - profile.thermalSofteningStartK) / thermalRange);
    return profile.complianceMPerN[mode] * anisotropy * thermal;
}

function nextLifecycle(bond, profile, ratios, peakAbsoluteStrain, deltaSeconds, temperatureK) {
    const peakRatio = Math.max(...Object.values(ratios));
    const yielded = peakRatio >= 1;
    const catastrophic = temperatureK >= profile.thermalFailureK
        || peakAbsoluteStrain >= profile.fractureStrain;
    let fatigue = clamp01(bond.fatigue + (yielded
        ? Math.max(0, peakRatio - 1) * profile.fatigueRatePerSecond * deltaSeconds
        : -profile.recoveryRatePerSecond * deltaSeconds));
    let damage = bond.damage;
    let lifecycle = bond.lifecycle;

    if (catastrophic) return { lifecycle: 'fracture', fatigue: 1, damage: 1 };
    if (lifecycle === 'elastic' && yielded) lifecycle = 'yield';
    else if (lifecycle === 'yield' && yielded) lifecycle = 'plastic';
    else if (lifecycle === 'plastic' && yielded) lifecycle = 'fatigue';
    else if (lifecycle === 'fatigue' && (fatigue >= 0.25 || yielded)) lifecycle = 'damage';

    if (STAGE_INDEX.get(lifecycle) >= STAGE_INDEX.get('damage')) {
        damage = clamp01(damage + (fatigue + Math.max(0, peakRatio - 1))
            * profile.damageRatePerSecond * deltaSeconds);
        if (damage >= 1) lifecycle = 'fracture';
    }
    return { lifecycle, fatigue, damage };
}

export class XpbdStructuralSolver {
    #topology;
    #profiles;
    #logger;
    #deviceGeneration;
    #destroyed = false;
    #history = [];
    #maximumHistory;

    constructor(optionsInput = {}) {
        const options = safeOptions(optionsInput,
            new Set(['topology', 'profiles', 'logger', 'maximumHistory']), '$.options');
        const topology = options.topology;
        const profiles = options.profiles ?? STRUCTURAL_MATERIAL_PROFILES;
        const logger = options.logger ?? null;
        const maximumHistory = options.maximumHistory ?? 4096;
        if (!topology || typeof topology.bonds !== 'function' || typeof topology.node !== 'function'
            || typeof topology.updateBondState !== 'function' || typeof topology.fractureBond !== 'function') {
            fail('$.options.topology', 'must implement the StructuralTopology interface');
        }
        if (logger != null && typeof logger !== 'function') fail('$.options.logger', 'must be a function or null');
        this.#maximumHistory = integer(maximumHistory, '$.options.maximumHistory', 1, 1_000_000);
        this.#topology = topology;
        this.#profiles = normalizeProfiles(profiles);
        this.#logger = logger;
        this.#deviceGeneration = topology.deviceGeneration;
        log(this.#logger, 'xpbd-structural-solver-initialize', { deviceGeneration: this.#deviceGeneration });
    }

    #assertAlive() {
        if (this.#destroyed) throw new Error('XpbdStructuralSolver is destroyed');
    }

    step(stepInput) {
        this.#assertAlive();
        const started = nowMs();
        let rollbackSnapshot = null;
        log(this.#logger, 'xpbd-step-enter', { deviceGeneration: this.#deviceGeneration });
        try {
            if (this.#topology.deviceGeneration !== this.#deviceGeneration) {
                throw new Error('Structural solver device generation is stale');
            }
            const step = cloneStrictJson(stepInput, '$.step');
            exact(step, STEP_KEYS, STEP_KEYS, '$.step');
            const frameId = identifier(step.frameId, '$.step.frameId');
            const stepIndex = integer(step.stepIndex, '$.step.stepIndex', 1);
            if (stepIndex <= this.#topology.stepIndex) fail('$.step.stepIndex', 'must advance the topology');
            const deltaSeconds = finite(step.deltaSeconds, '$.step.deltaSeconds', Number.MIN_VALUE, 10);
            const substeps = integer(step.substeps, '$.step.substeps', 1, 64);
            const measurements = normalizeMeasurements(step.measurements);
            for (const bondId of measurements.keys()) {
                if (!this.#topology.bond(bondId)) fail('$.step.measurements', `references unknown bond '${bondId}'`);
            }
            const activeBonds = this.#topology.bonds();
            for (const bond of activeBonds) {
                if (!this.#profiles.has(bond.profileId)) throw new RangeError(`Unknown structural profile '${bond.profileId}'`);
            }
            rollbackSnapshot = this.#topology.snapshot();

            const h = deltaSeconds / substeps;
            const transitions = [];
            const fractures = [];
            const processedBondIds = [];
            const skippedBondIds = [];
            const constraintCounts = { tension: 0, compression: 0, shear: 0, bend: 0 };

            for (const initialBond of activeBonds) {
                if (!shouldRunPowerOfTwoTimeBin(stepIndex, initialBond.timeBinExponent)) {
                    skippedBondIds.push(initialBond.id);
                    continue;
                }
                const profile = this.#profiles.get(initialBond.profileId);
                if (!profile) throw new RangeError(`Unknown structural profile '${initialBond.profileId}'`);
                const measurement = measurements.get(initialBond.id) ?? {
                    shearDisplacementM: [0, 0, 0], bendRadians: initialBond.bendRestRadians, temperatureK: 293.15,
                };
                let bond = initialBond;
                let nodeA = this.#topology.node(bond.nodeAId);
                let nodeB = this.#topology.node(bond.nodeBId);
                const inverseMassSum = nodeA.inverseMassPerKg + nodeB.inverseMassPerKg;
                const peakStrains = { tension: 0, compression: 0, shear: 0, bend: 0 };

                for (let substep = 0; substep < substeps; substep++) {
                    const axial = nodeB.positionM.map((value, axis) => value - nodeA.positionM[axis]);
                    const distance = Math.hypot(...axial);
                    const direction = normalize(axial, bond.restDirection);
                    const axialMode = distance >= bond.plasticRestLengthM ? 'tension' : 'compression';
                    const axialResult = solveXpbdScalarConstraint({
                        constraint: distance - bond.plasticRestLengthM,
                        compliance: effectiveCompliance(profile, axialMode, direction, measurement.temperatureK),
                        deltaSeconds: h,
                        accumulatedLambda: bond.lambda[axialMode],
                        inverseMassSum,
                    });
                    const shearMagnitude = Math.hypot(...measurement.shearDisplacementM);
                    const rawAxialStrain = (distance - bond.plasticRestLengthM) / bond.plasticRestLengthM;
                    peakStrains.tension = Math.max(peakStrains.tension, Math.max(0, rawAxialStrain));
                    peakStrains.compression = Math.max(peakStrains.compression, Math.max(0, -rawAxialStrain));
                    peakStrains.shear = Math.max(peakStrains.shear, shearMagnitude / bond.plasticRestLengthM);
                    peakStrains.bend = Math.max(peakStrains.bend,
                        Math.abs(measurement.bendRadians - bond.bendRestRadians) / Math.PI);
                    const shearDirection = normalize(measurement.shearDisplacementM, bond.restDirection);
                    const bendDirection = normalize([-direction[1], direction[0], 0], [0, 1, 0]);
                    const shearResult = solveXpbdScalarConstraint({
                        constraint: shearMagnitude,
                        compliance: effectiveCompliance(profile, 'shear', direction, measurement.temperatureK),
                        deltaSeconds: h,
                        accumulatedLambda: bond.lambda.shear,
                        inverseMassSum,
                    });
                    const bendResult = solveXpbdScalarConstraint({
                        constraint: measurement.bendRadians - bond.bendRestRadians,
                        compliance: effectiveCompliance(profile, 'bend', direction, measurement.temperatureK),
                        deltaSeconds: h,
                        accumulatedLambda: bond.lambda.bend,
                        inverseMassSum,
                    });
                    constraintCounts[axialMode]++;
                    constraintCounts.shear++;
                    constraintCounts.bend++;

                    const aCorrection = nodeA.inverseMassPerKg * -axialResult.deltaLambda;
                    const bCorrection = nodeB.inverseMassPerKg * axialResult.deltaLambda;
                    const nextA = addScaled(
                        addScaled(addScaled(nodeA.positionM, direction, aCorrection), shearDirection,
                            nodeA.inverseMassPerKg * -shearResult.deltaLambda),
                        bendDirection,
                        nodeA.inverseMassPerKg * -bendResult.deltaLambda,
                    );
                    const nextB = addScaled(
                        addScaled(addScaled(nodeB.positionM, direction, bCorrection), shearDirection,
                            nodeB.inverseMassPerKg * shearResult.deltaLambda),
                        bendDirection,
                        nodeB.inverseMassPerKg * bendResult.deltaLambda,
                    );
                    this.#topology.setNodeKinematics(nodeA.id, { positionM: nextA });
                    this.#topology.setNodeKinematics(nodeB.id, { positionM: nextB });
                    nodeA = this.#topology.node(nodeA.id);
                    nodeB = this.#topology.node(nodeB.id);
                    bond = {
                        ...bond,
                        lambda: {
                            ...bond.lambda,
                            [axialMode]: axialResult.lambda,
                            shear: shearResult.lambda,
                            bend: bendResult.lambda,
                        },
                    };
                }

                const ratios = {
                    tension: peakStrains.tension / profile.yieldStrain.tension,
                    compression: peakStrains.compression / profile.yieldStrain.compression,
                    shear: peakStrains.shear / profile.yieldStrain.shear,
                    bend: peakStrains.bend / profile.yieldStrain.bend,
                };
                const lifecycle = nextLifecycle(
                    bond,
                    profile,
                    ratios,
                    Math.max(...Object.values(peakStrains)),
                    deltaSeconds,
                    measurement.temperatureK,
                );
                const priorStage = bond.lifecycle;
                if (lifecycle.lifecycle === 'fracture') {
                    const fracture = this.#topology.fractureBond(bond.id, {
                        fractureEventId: `solver-fracture.${hashToken(`${frameId}:${bond.id}`)}`,
                        separationNormal: normalize(nodeB.positionM.map((value, axis) => value - nodeA.positionM[axis]), bond.restDirection),
                        createdStep: stepIndex,
                    });
                    fractures.push(fracture.crack);
                } else {
                    const yielded = Math.max(...Object.values(ratios)) >= 1;
                    const plasticFactor = yielded ? clamp01(profile.plasticRatePerSecond * deltaSeconds) : 0;
                    const plasticRestLengthM = Math.max(Number.MIN_VALUE,
                        bond.plasticRestLengthM
                        + (Math.hypot(...nodeB.positionM.map((value, axis) => value - nodeA.positionM[axis]))
                            - bond.plasticRestLengthM) * plasticFactor);
                    const selection = selectPowerOfTwoTimeBin({
                        currentExponent: bond.timeBinExponent,
                        maximumExponent: 30,
                        predictedTimeToImpactS: null,
                        baseStepSeconds: deltaSeconds,
                        strainRatio: Math.max(...Object.values(ratios)),
                        phaseChanging: false,
                        interacting: false,
                    });
                    this.#topology.updateBondState(bond.id, {
                        plasticRestLengthM,
                        lambda: bond.lambda,
                        lifecycle: lifecycle.lifecycle,
                        fatigue: lifecycle.fatigue,
                        damage: lifecycle.damage,
                        revision: bond.revision + 1,
                        timeBinExponent: selection.exponent,
                    });
                }
                if (priorStage !== lifecycle.lifecycle) {
                    transitions.push({ bondId: bond.id, from: priorStage, to: lifecycle.lifecycle });
                    log(this.#logger, 'structural-bond-state-transition', transitions.at(-1));
                }
                processedBondIds.push(bond.id);
            }
            this.#topology.advanceStep(stepIndex);
            const receipt = cloneAndFreezeStrictJson({
                frameId,
                stepIndex,
                deviceGeneration: this.#deviceGeneration,
                processedBondIds,
                skippedBondIds,
                constraintCounts,
                stateTransitions: transitions,
                fractures,
                localComponentCount: fractures.length === 0 ? 0 : this.#topology.connectedComponents().length,
            });
            this.#history.push(receipt);
            if (this.#history.length > this.#maximumHistory) this.#history.shift();
            log(this.#logger, 'xpbd-step-exit', {
                frameId, processedBondCount: processedBondIds.length, fractureCount: fractures.length,
            });
            log(this.#logger, 'xpbd-step-performance', { frameId, durationMs: nowMs() - started });
            return receipt;
        } catch (error) {
            if (rollbackSnapshot !== null) this.#topology.restore(rollbackSnapshot);
            log(this.#logger, 'xpbd-step-error', { message: error.message, durationMs: nowMs() - started });
            throw error;
        }
    }

    snapshot() {
        this.#assertAlive();
        return cloneAndFreezeStrictJson({
            schema: 'engine.matter.xpbd-structural-solver',
            schemaVersion: '1.0.0',
            deviceGeneration: this.#deviceGeneration,
            topology: this.#topology.snapshot(),
            history: this.#history,
        });
    }

    restore(snapshotInput) {
        this.#assertAlive();
        const snapshot = cloneStrictJson(snapshotInput, '$.solverSnapshot');
        exact(snapshot, new Set(['schema', 'schemaVersion', 'deviceGeneration', 'topology', 'history']),
            new Set(['schema', 'schemaVersion', 'deviceGeneration', 'topology', 'history']), '$.solverSnapshot');
        if (snapshot.schema !== 'engine.matter.xpbd-structural-solver' || snapshot.schemaVersion !== '1.0.0') {
            fail('$.solverSnapshot', 'uses an unsupported schema');
        }
        const generation = integer(snapshot.deviceGeneration, '$.solverSnapshot.deviceGeneration');
        if (!Array.isArray(snapshot.history) || snapshot.history.length > this.#maximumHistory) {
            fail('$.solverSnapshot.history', 'must be a bounded array');
        }
        snapshot.history.forEach((receipt, index) => {
            validateStepReceipt(receipt, `$.solverSnapshot.history[${index}]`);
            if (receipt.deviceGeneration > generation) {
                fail(`$.solverSnapshot.history[${index}].deviceGeneration`, 'is from a future generation');
            }
            if (index > 0 && snapshot.history[index - 1].stepIndex >= receipt.stepIndex) {
                fail('$.solverSnapshot.history', 'must advance by step index');
            }
        });
        this.#topology.restore(snapshot.topology);
        if (this.#topology.deviceGeneration !== generation) fail('$.solverSnapshot', 'device generations disagree');
        this.#deviceGeneration = generation;
        this.#history = cloneStrictJson(snapshot.history);
        log(this.#logger, 'xpbd-snapshot-restored', { deviceGeneration: generation });
        return this;
    }

    replay(stepInputs) {
        this.#assertAlive();
        const steps = cloneStrictJson(stepInputs, '$.replaySteps');
        if (!Array.isArray(steps) || steps.length > 1_000_000) fail('$.replaySteps', 'must be a bounded array');
        return cloneAndFreezeStrictJson(steps.map(step => this.step(step)));
    }

    recreateDevice(nextGeneration) {
        this.#assertAlive();
        const generation = integer(nextGeneration, '$.nextGeneration');
        if (generation <= this.#deviceGeneration) fail('$.nextGeneration', 'must advance');
        if (this.#topology.deviceGeneration < generation) this.#topology.recreateDevice(generation);
        if (this.#topology.deviceGeneration !== generation) fail('$.nextGeneration', 'does not match topology generation');
        this.#deviceGeneration = generation;
        log(this.#logger, 'xpbd-device-recreated', { deviceGeneration: generation });
        return generation;
    }

    destroy() {
        if (this.#destroyed) return false;
        this.#history.length = 0;
        this.#destroyed = true;
        log(this.#logger, 'xpbd-structural-solver-destroyed');
        return true;
    }
}
