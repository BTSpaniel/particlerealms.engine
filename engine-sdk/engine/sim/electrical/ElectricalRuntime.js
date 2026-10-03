// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { isCompiledElectricalCircuit } from './ElectricalNetCompiler.js';
import { MnaStamping } from './MnaStamping.js';
import { sampleElectricalSource, resolveAveragedPwmDuty } from './ElectricalWaveforms.js';
import {
    advanceBreakerState,
    advanceFuseState,
    advanceThermalState,
    cloneThermalState,
    createBreakerState,
    createFuseState,
    createThermalState,
    normalizeElectricalComponentOverrides,
    temperatureAdjustedResistanceOhms,
} from './ElectricalThermalProtection.js';
import {
    advanceElectricalEnergyLedger,
    calculateElectricalEnergyResidual,
    createElectricalEnergyLedger,
    restoreElectricalEnergyLedger,
    snapshotElectricalEnergyLedger,
} from './ElectricalEnergyLedger.js';

export const ELECTRICAL_RUNTIME_SNAPSHOT_SCHEMA = 'engine.electrical.runtime-snapshot';
export const ELECTRICAL_RUNTIME_SNAPSHOT_VERSION = '1.0.0';
export const ELECTRICAL_ACTIVE_SET_MAXIMUM_ITERATIONS = 8;

const OPEN_CONDUCTANCE_SIEMENS = 1e-12;
const THERMAL_SHUTDOWN_RESISTANCE_OHMS = 1e12;
const ACTIVE_TOLERANCE = 1e-12;
const THERMAL_STATE_KEYS = Object.freeze([
    'coolingEnergyJoules',
    'deratingFactor',
    'jouleEnergyJoules',
    'shutdown',
    'temperatureKelvin',
    'warned',
]);

function finite(value, label, minimum = -Number.MAX_VALUE) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
        throw new RangeError(label + ' must be finite and at least ' + minimum);
    }
    return value;
}

function positive(value, label) {
    return finite(value, label, Number.MIN_VALUE);
}

function plainRecord(value, label, fallback = null) {
    if (value == null && fallback != null) return fallback;
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype) {
        throw new TypeError(label + ' must be a plain object');
    }
    return value;
}

function clonePlain(value) {
    if (value == null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return finite(value, 'state number');
    if (Array.isArray(value)) return value.map(clonePlain);
    const result = {};
    for (const key of Object.keys(value).sort()) result[key] = clonePlain(value[key]);
    return result;
}

function freezeTree(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) freezeTree(child);
    return Object.freeze(value);
}

function diagnostic(error, fallbackCode = 'ELECTRICAL_RUNTIME') {
    return freezeTree({
        code: typeof error?.code === 'string' ? error.code : fallbackCode,
        message: error instanceof Error ? error.message : String(error),
        details: error?.details == null ? null : clonePlain(error.details),
    });
}

function successReport(value) {
    return freezeTree({ ok: true, errors: [], ...value });
}

function failureReport(error, state) {
    return freezeTree({
        ok: false,
        errors: [diagnostic(error)],
        statePreserved: true,
        timeSeconds: state.timeSeconds,
        stepCount: state.stepCount,
    });
}

function exactRecord(value, expectedKeys, label) {
    const source = plainRecord(value, label);
    const actual = Object.keys(source).sort();
    const expected = [...expectedKeys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
        throw new RangeError(
            label + ' must contain exactly [' + expected.join(', ') + ']',
        );
    }
    return source;
}

function componentStateStringValues(component, key) {
    if (component.kind === 'switch.spdt' && key === 'throw') {
        return ['normally-closed', 'normally-open'];
    }
    if (component.kind === 'diode.piecewise-linear' && key === 'mode') {
        return component.parameters.reverseClampVolts == null
            ? ['off', 'on']
            : ['off', 'on', 'reverse-clamp'];
    }
    if (component.kind === 'supply.dc' && key === 'mode') {
        return [
            'normal',
            'current-limit-delivery',
            'current-limit-regeneration',
            'regeneration-reject',
            'off',
        ];
    }
    return null;
}

function restoreComponentState(component, value) {
    const template = initialComponentState(component);
    const source = exactRecord(value, Object.keys(template), 'component state ' + component.id);
    const restored = {};
    for (const key of Object.keys(template).sort()) {
        const expectedType = typeof template[key];
        const entry = source[key];
        if (expectedType === 'number') {
            const minimum = key === 'i2tAmpSquaredSeconds' || key === 'dutyCycle' ? 0 : -Number.MAX_VALUE;
            restored[key] = finite(entry, component.id + ' state.' + key, minimum);
            if (key === 'dutyCycle' && restored[key] > 1) {
                throw new RangeError(component.id + ' state.dutyCycle must be in [0, 1]');
            }
        } else if (expectedType === 'boolean') {
            if (typeof entry !== 'boolean') {
                throw new TypeError(component.id + ' state.' + key + ' must be boolean');
            }
            restored[key] = entry;
        } else if (expectedType === 'string') {
            const allowed = componentStateStringValues(component, key);
            if (typeof entry !== 'string' || allowed == null || !allowed.includes(entry)) {
                throw new RangeError(component.id + ' state.' + key + ' is invalid');
            }
            restored[key] = entry;
        } else {
            throw new TypeError(component.id + ' has unsupported runtime state field ' + key);
        }
    }
    return restored;
}

function probeUnit(kind) {
    switch (kind) {
        case 'probe.voltage': return 'V';
        case 'probe.current': return 'A';
        case 'probe.power': return 'W';
        case 'probe.temperature': return 'K';
        default: throw new RangeError('Unsupported probe kind ' + kind);
    }
}

function restoreProbeState(compiled, value, initialized) {
    if (!Array.isArray(value)) throw new TypeError('snapshot probes must be an array');
    const expectedIds = initialized ? [...compiled.probes] : [];
    if (value.length !== expectedIds.length) {
        throw new RangeError('snapshot probe count does not match the compiled probe selection');
    }
    const expected = new Set(expectedIds);
    const components = new Map(compiled.components.map((component) => [component.id, component]));
    const probes = new Map();
    for (const [index, rawRecord] of value.entries()) {
        const record = exactRecord(rawRecord, ['id', 'value'], 'snapshot probe record');
        if (typeof record.id !== 'string' || record.id !== expectedIds[index] ||
            !expected.has(record.id) || probes.has(record.id)) {
            throw new RangeError('snapshot contains an undeclared or duplicate probe ' + String(record.id));
        }
        const component = components.get(record.id);
        if (!component || !component.kind.startsWith('probe.')) {
            throw new RangeError('snapshot probe ' + record.id + ' has no compiled probe component');
        }
        const probe = exactRecord(
            record.value,
            ['id', 'kind', 'unit', 'value'],
            'snapshot probe ' + record.id,
        );
        if (probe.id !== record.id || probe.kind !== component.kind || probe.unit !== probeUnit(component.kind)) {
            throw new RangeError('snapshot probe ' + record.id + ' identity, kind, or unit is invalid');
        }
        probes.set(record.id, {
            id: record.id,
            kind: component.kind,
            value: finite(probe.value, 'snapshot probe ' + record.id + ' value'),
            unit: probe.unit,
        });
    }
    for (const id of expectedIds) {
        if (!probes.has(id)) throw new RangeError('snapshot is missing declared probe ' + id);
    }
    return probes;
}

function solveDiagnosticDetails(compiled, rawDetails) {
    const details = rawDetails == null ? {} : clonePlain(rawDetails);
    const indices = new Set();
    // LU row indices may already reflect deterministic row permutations. The
    // pivot/column is still the exact stable unknown; never mislabel a
    // permuted equation row as another authored component.
    for (const key of ['pivot', 'column', 'index']) {
        if (Number.isSafeInteger(details[key]) && details[key] >= 0 &&
            details[key] < compiled.unknowns.length) {
            indices.add(details[key]);
        }
    }
    const unknownIds = new Set();
    const componentIds = new Set();
    const netIds = new Set();
    for (const index of indices) {
        const unknown = compiled.unknowns[index];
        if (!unknown) continue;
        unknownIds.add(unknown.id);
        if (unknown.componentId != null) componentIds.add(unknown.componentId);
        if (unknown.netId != null) netIds.add(unknown.netId);
    }
    for (const componentId of [...componentIds]) {
        const component = compiled.components.find((entry) => entry.id === componentId);
        for (const netId of Object.values(component?.portNetIds ?? {})) netIds.add(netId);
    }
    if (unknownIds.size > 0) details.unknownIds = [...unknownIds].sort();
    if (componentIds.size > 0) details.componentIds = [...componentIds].sort();
    if (netIds.size > 0) details.netIds = [...netIds].sort();
    return details;
}

function solveFailure(compiled, value) {
    const details = solveDiagnosticDetails(compiled, value?.details);
    const context = [];
    if (details.unknownIds?.length) context.push('unknowns ' + details.unknownIds.join(', '));
    if (details.componentIds?.length) context.push('components ' + details.componentIds.join(', '));
    if (details.netIds?.length) context.push('nets ' + details.netIds.join(', '));
    const error = new Error(
        (value?.message ?? 'Electrical MNA solve failed') +
        (context.length > 0 ? ' [' + context.join('; ') + ']' : ''),
    );
    error.code = value?.code ?? 'ELECTRICAL_RUNTIME_SOLVE';
    error.details = details;
    return error;
}

function initialComponentState(component) {
    const p = component.parameters;
    switch (component.kind) {
        case 'capacitor':
            return { voltageVolts: p.initialVoltageVolts ?? 0, currentAmps: 0 };
        case 'inductor':
            return { currentAmps: p.initialCurrentAmps ?? 0 };
        case 'coupled-inductors':
            return {
                primaryCurrentAmps: p.primaryInitialCurrentAmps ?? 0,
                secondaryCurrentAmps: p.secondaryInitialCurrentAmps ?? 0,
            };
        case 'transformer':
            return { primaryCurrentAmps: 0, secondaryCurrentAmps: 0, magnetizingCurrentAmps: 0 };
        case 'relay':
            return {
                coilCurrentAmps: 0,
                energized: p.initialEnergized ?? false,
                contactCurrentAmps: 0,
            };
        case 'switch.spst':
            return { closed: p.initialClosed ?? false, currentAmps: 0 };
        case 'switch.spdt':
            return { throw: p.initialThrow, currentAmps: 0 };
        case 'diode.piecewise-linear':
            return { mode: 'off', currentAmps: 0 };
        case 'mosfet':
            return { on: false, currentAmps: 0 };
        case 'switch.pwm':
            return { dutyCycle: p.dutyCycle, currentAmps: 0 };
        case 'fuse':
            return { ...createFuseState(component), currentAmps: 0 };
        case 'breaker':
            return { ...createBreakerState(component), currentAmps: 0 };
        case 'supply.dc':
            return {
                mode: 'normal',
                currentAmps: 0,
                terminalVoltageVolts: p.openCircuitVoltageVolts,
                currentLimited: false,
                brownout: false,
                regeneration: false,
            };
        case 'motor.dc':
        case 'motor.linear':
        case 'voice-coil':
        case 'solenoid.variable-inductance':
            return { currentAmps: p.initialCurrentAmps ?? 0, effort: 0 };
        default:
            return { currentAmps: 0 };
    }
}

function createInitialState(compiled, overrides) {
    return {
        initialized: false,
        timeSeconds: 0,
        stepCount: 0,
        solution: new Float64Array(compiled.unknownCount),
        componentStates: new Map(compiled.components.map((component) => [
            component.id,
            initialComponentState(component),
        ])),
        thermalStates: new Map(compiled.components.map((component) => [
            component.id,
            createThermalState(component.id, overrides[component.id] ?? {}),
        ])),
        probes: new Map(),
        energyLedger: createElectricalEnergyLedger(),
        storedElectricalEnergyJoules: 0,
        capacitiveEnergyJoules: 0,
        magneticEnergyJoules: 0,
        lastStep: null,
    };
}

function cloneRuntimeState(state) {
    return {
        initialized: state.initialized,
        timeSeconds: state.timeSeconds,
        stepCount: state.stepCount,
        solution: state.solution.slice(),
        componentStates: new Map([...state.componentStates.entries()].map(([id, value]) => [
            id,
            clonePlain(value),
        ])),
        thermalStates: new Map([...state.thermalStates.entries()].map(([id, value]) => [
            id,
            cloneThermalState(value),
        ])),
        probes: new Map([...state.probes.entries()].map(([id, value]) => [id, clonePlain(value)])),
        energyLedger: restoreElectricalEnergyLedger(snapshotElectricalEnergyLedger(state.energyLedger)),
        storedElectricalEnergyJoules: state.storedElectricalEnergyJoules,
        capacitiveEnergyJoules: state.capacitiveEnergyJoules,
        magneticEnergyJoules: state.magneticEnergyJoules,
        lastStep: state.lastStep,
    };
}

function controlValue(inputs, component, fallback) {
    const controls = inputs.controls;
    const controlId = component.parameters.controlId;
    if (controlId && Object.hasOwn(controls, controlId)) return controls[controlId];
    if (Object.hasOwn(controls, component.id)) return controls[component.id];
    return fallback;
}

function booleanControl(inputs, component, fallback) {
    const value = controlValue(inputs, component, fallback);
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value >= 0.5;
    throw new TypeError('Control for ' + component.id + ' must be boolean or finite numeric');
}

function gpioDrive(inputs, component) {
    const drive = inputs.gpio[component.id] ?? { mode: 'input', pullup: false };
    exactRecord(drive, ['mode', 'pullup'], 'GPIO drive ' + component.id);
    if (!['high', 'low', 'input'].includes(drive.mode) || typeof drive.pullup !== 'boolean') {
        throw new TypeError('GPIO drive requires high, low or input mode and boolean pullup');
    }
    return drive;
}

function gpioConductances(inputs, component) {
    const drive = gpioDrive(inputs, component), p = component.parameters;
    return { drive,
        high: drive.mode === 'high' ? 1 / p.outputResistanceOhms
            : drive.mode === 'input' && drive.pullup ? 1 / p.pullupResistanceOhms : p.inputConductanceSiemens,
        low: drive.mode === 'low' ? 1 / p.outputResistanceOhms : p.inputConductanceSiemens };
}

function smoothstep01(value) {
    const clamped = Math.max(0, Math.min(1, value));
    return clamped * clamped * (3 - 2 * clamped);
}

function solenoidGeometry(component, coordinate) {
    const minimum = component.parameters.minimumInductanceHenries;
    const maximum = component.parameters.maximumInductanceHenries;
    const lower = Number.isFinite(coordinate?.lowerLimit) ? coordinate.lowerLimit : 0;
    const upper = Number.isFinite(coordinate?.upperLimit) ? coordinate.upperLimit : 1;
    const span = upper - lower;
    if (!(span > 0)) throw new RangeError(component.id + ' mechanics limits must have positive span');
    const normalized = Math.max(0, Math.min(1, (coordinate.position - lower) / span));
    const inductance = minimum + (maximum - minimum) * smoothstep01(normalized);
    const derivative = (maximum - minimum) * 6 * normalized * (1 - normalized) / span;
    return { inductance, derivativeHenriesPerUnit: derivative };
}

export class ElectricalRuntime {
    constructor(compiled, options = {}) {
        if (!isCompiledElectricalCircuit(compiled)) {
            throw new TypeError('A compiled electrical circuit is required');
        }
        const normalizedOptions = plainRecord(options, 'runtime options', {});
        for (const key of Object.keys(normalizedOptions)) {
            if (key !== 'componentOverrides' && key !== 'luOptions') {
                throw new RangeError('Unsupported electrical runtime option ' + key);
            }
        }
        this.compiled = compiled;
        this.componentOverrides = normalizeElectricalComponentOverrides(
            normalizedOptions.componentOverrides ?? {},
        );
        this.luOptions = freezeTree(clonePlain(normalizedOptions.luOptions ?? {}));
        this._componentById = new Map(compiled.components.map((component) => [component.id, component]));
        for (const componentId of Object.keys(this.componentOverrides)) {
            if (!this._componentById.has(componentId)) {
                throw new RangeError('componentOverrides names unknown component ' + componentId);
            }
        }
        this._state = createInitialState(compiled, this.componentOverrides);
        this._disposed = false;
    }

    _assertLive() {
        if (this._disposed) throw new Error('Electrical runtime is disposed');
    }

    _normalizeInputs(value = {}) {
        const input = plainRecord(value, 'electrical inputs', {});
        for (const key of Object.keys(input)) {
            if (key !== 'controls' && key !== 'resets' && key !== 'gpio') {
                throw new RangeError('Unsupported electrical input ' + key);
            }
        }
        const gpio = plainRecord(input.gpio, 'electrical inputs.gpio', {});
        for (const id of Object.keys(gpio)) {
            const component = this._componentById.get(id);
            if (component?.kind !== 'gpio.pin') throw new RangeError('GPIO drive names a non-GPIO component ' + id);
            gpioDrive({ gpio }, component);
        }
        return {
            controls: plainRecord(input.controls, 'electrical inputs.controls', {}),
            resets: plainRecord(input.resets, 'electrical inputs.resets', {}),
            gpio,
        };
    }

    _coordinateMap(value = {}) {
        if (value instanceof Map) return value;
        const source = plainRecord(value, 'mechanics coordinates', {});
        return new Map(Object.entries(source));
    }

    _nodeIndex(netId) {
        const index = this.compiled.indices.unknownById['voltage:' + netId];
        return Number.isSafeInteger(index) ? index : -1;
    }

    _portNode(component, portName) {
        return this._nodeIndex(component.portNetIds[portName]);
    }

    _branchIndex(component, branchName) {
        const index = this.compiled.indices.unknownById[
            'current:' + component.id + ':' + branchName
        ];
        if (!Number.isSafeInteger(index)) {
            throw new RangeError(component.id + ' has no branch unknown ' + branchName);
        }
        return index;
    }

    _voltage(solution, nodeIndex) {
        return nodeIndex < 0 ? 0 : finite(solution[nodeIndex], 'node voltage');
    }

    _portVoltage(solution, component, positivePort, negativePort) {
        return this._voltage(solution, this._portNode(component, positivePort)) -
            this._voltage(solution, this._portNode(component, negativePort));
    }

    _coordinate(component, coordinates) {
        if (!component.actuatorRef) return null;
        const coordinate = coordinates.get(component.actuatorRef);
        if (!coordinate) {
            throw new RangeError(
                component.id + ' requires mechanics coordinate ' + component.actuatorRef,
            );
        }
        finite(coordinate.position, component.actuatorRef + ' position');
        finite(coordinate.velocity, component.actuatorRef + ' velocity');
        finite(coordinate.externalLoad ?? 0, component.actuatorRef + ' externalLoad');
        return coordinate;
    }

    _resistance(component, state, parameterName = 'resistanceOhms') {
        const base = component.parameters[parameterName];
        const proxy = base == null || parameterName === 'resistanceOhms'
            ? component
            : { ...component, parameters: { ...component.parameters, resistanceOhms: base } };
        const thermal = state.thermalStates.get(component.id);
        const override = this.componentOverrides[component.id] ?? {};
        return temperatureAdjustedResistanceOhms(proxy, thermal, override);
    }

    _thermalShutdown(component, state) {
        return state.thermalStates.get(component.id)?.shutdown === true;
    }

    _thermalDerating(component, state) {
        return state.thermalStates.get(component.id)?.deratingFactor ?? 1;
    }

    _initialActiveModes(state) {
        const modes = new Map();
        for (const component of this.compiled.components) {
            const componentState = state.componentStates.get(component.id);
            switch (component.kind) {
                case 'diode.piecewise-linear':
                    modes.set(component.id, componentState.mode);
                    break;
                case 'relay':
                    modes.set(component.id, componentState.energized ? 'energized' : 'released');
                    break;
                case 'mosfet':
                    modes.set(component.id, componentState.on ? 'on' : 'off');
                    break;
                case 'supply.dc':
                    modes.set(component.id, componentState.mode ?? 'normal');
                    break;
                default:
                    break;
            }
        }
        return modes;
    }

    _stampComponent(mna, component, state, activeModes, mode, h, inputs, coordinates) {
        const p = component.parameters;
        const componentState = state.componentStates.get(component.id);
        const node = (name) => this._portNode(component, name);
        const branch = (name) => this._branchIndex(component, name);
        const active = activeModes.get(component.id);
        switch (component.kind) {
            case 'gpio.pin': {
                const conductance = gpioConductances(inputs, component);
                mna.stampConductance(node('signal'), node('vcc'), conductance.high);
                mna.stampConductance(node('signal'), node('ground'), conductance.low);
                return;
            }
            case 'reference':
            case 'wire':
            case 'junction':
            case 'probe.voltage':
            case 'probe.temperature':
                return;
            case 'resistor': {
                const resistance = this._thermalShutdown(component, state)
                    ? THERMAL_SHUTDOWN_RESISTANCE_OHMS
                    : this._resistance(component, state);
                mna.stampConductance(node('positive'), node('negative'), 1 / resistance);
                return;
            }
            case 'capacitor':
                if (mode !== 'dc') {
                    mna.stampCapacitorBackwardEuler(
                        node('positive'), node('negative'), p.capacitanceFarads, h,
                        componentState.voltageVolts,
                    );
                }
                return;
            case 'inductor': {
                const resistance = this._thermalShutdown(component, state)
                    ? THERMAL_SHUTDOWN_RESISTANCE_OHMS
                    : p.seriesResistanceOhms ?? 0;
                if (mode === 'dc') {
                    mna.stampVoltageBranch(node('positive'), node('negative'), branch('current'), 0, resistance);
                } else {
                    mna.stampInductorBackwardEuler(
                        node('positive'), node('negative'), branch('current'), p.inductanceHenries,
                        h, componentState.currentAmps, resistance,
                    );
                }
                return;
            }
            case 'coupled-inductors': {
                const primaryBranch = branch('primaryCurrent');
                const secondaryBranch = branch('secondaryCurrent');
                if (mode === 'dc') {
                    mna.stampVoltageBranch(
                        node('primaryPositive'), node('primaryNegative'), primaryBranch, 0,
                        p.primarySeriesResistanceOhms ?? 0,
                    );
                    mna.stampVoltageBranch(
                        node('secondaryPositive'), node('secondaryNegative'), secondaryBranch, 0,
                        p.secondarySeriesResistanceOhms ?? 0,
                    );
                } else {
                    mna.stampCoupledInductorsBackwardEuler({
                        primaryPositive: node('primaryPositive'),
                        primaryNegative: node('primaryNegative'),
                        secondaryPositive: node('secondaryPositive'),
                        secondaryNegative: node('secondaryNegative'),
                        primaryBranch,
                        secondaryBranch,
                        primaryInductanceHenries: p.primaryInductanceHenries,
                        secondaryInductanceHenries: p.secondaryInductanceHenries,
                        mutualInductanceHenries: p.couplingCoefficient * Math.sqrt(
                            p.primaryInductanceHenries * p.secondaryInductanceHenries,
                        ),
                        primaryResistanceOhms: p.primarySeriesResistanceOhms ?? 0,
                        secondaryResistanceOhms: p.secondarySeriesResistanceOhms ?? 0,
                        previousPrimaryCurrentAmps: componentState.primaryCurrentAmps,
                        previousSecondaryCurrentAmps: componentState.secondaryCurrentAmps,
                        h,
                    });
                }
                return;
            }
            case 'transformer':
                if (mode === 'dc') {
                    mna.stampIdealTransformer({
                        primaryPositive: node('primaryPositive'),
                        primaryNegative: node('primaryNegative'),
                        secondaryPositive: node('secondaryPositive'),
                        secondaryNegative: node('secondaryNegative'),
                        primaryBranch: branch('primaryCurrent'),
                        secondaryBranch: branch('secondaryCurrent'),
                        turnsRatio: p.turnsRatio,
                        primaryResistanceOhms: p.primaryResistanceOhms ?? 0,
                        secondaryResistanceOhms: p.secondaryResistanceOhms ?? 0,
                    });
                } else {
                    mna.stampTransformerBackwardEuler({
                        primaryPositive: node('primaryPositive'),
                        primaryNegative: node('primaryNegative'),
                        secondaryPositive: node('secondaryPositive'),
                        secondaryNegative: node('secondaryNegative'),
                        primaryBranch: branch('primaryCurrent'),
                        secondaryBranch: branch('secondaryCurrent'),
                        turnsRatio: p.turnsRatio,
                        magnetizingInductanceHenries: p.magnetizingInductanceHenries,
                        previousMagnetizingCurrentAmps: componentState.magnetizingCurrentAmps,
                        primaryResistanceOhms: p.primaryResistanceOhms ?? 0,
                        secondaryResistanceOhms: p.secondaryResistanceOhms ?? 0,
                        h,
                    });
                }
                return;
            case 'voltage-source.dc':
            case 'voltage-source.pulse':
            case 'voltage-source.sine':
                mna.stampVoltageBranch(
                    node('positive'), node('negative'), branch('current'),
                    sampleElectricalSource(component, state.solveTimeSeconds ?? state.timeSeconds),
                    p.seriesResistanceOhms ?? 0,
                );
                return;
            case 'current-source.dc':
            case 'current-source.pulse':
            case 'current-source.sine':
                mna.stampCurrentSource(
                    node('positive'), node('negative'),
                    sampleElectricalSource(component, state.solveTimeSeconds ?? state.timeSeconds),
                );
                return;
            case 'dependent-source.vcvs':
                mna.stampVcvs(
                    node('outputPositive'), node('outputNegative'),
                    node('controlPositive'), node('controlNegative'),
                    branch('outputCurrent'), p.voltageGain,
                );
                return;
            case 'dependent-source.vccs':
                mna.stampVccs(
                    node('outputPositive'), node('outputNegative'),
                    node('controlPositive'), node('controlNegative'),
                    p.transconductanceSiemens,
                );
                return;
            case 'dependent-source.ccvs': {
                const control = this._componentById.get(p.controlComponentId);
                const controlBranch = p.controlBranch ?? control.branchUnknowns[0];
                mna.stampCcvs(
                    node('outputPositive'), node('outputNegative'), branch('outputCurrent'),
                    this._branchIndex(control, controlBranch), p.transresistanceOhms,
                );
                return;
            }
            case 'dependent-source.cccs': {
                const control = this._componentById.get(p.controlComponentId);
                const controlBranch = p.controlBranch ?? control.branchUnknowns[0];
                mna.stampCccs(
                    node('outputPositive'), node('outputNegative'),
                    this._branchIndex(control, controlBranch), p.currentGain,
                );
                return;
            }
            case 'supply.dc': {
                const positiveNode = node('positive');
                const negativeNode = node('negative');
                const branchIndex = branch('current');
                const derating = this._thermalDerating(component, state);
                const limit = p.currentLimitAmps * derating;
                if (this._thermalShutdown(component, state) || active === 'off') {
                    mna.stampBranchCurrentConstraint(positiveNode, negativeNode, branchIndex, 0);
                } else if (active === 'current-limit-delivery') {
                    mna.stampBranchCurrentConstraint(positiveNode, negativeNode, branchIndex, -limit);
                } else if (active === 'current-limit-regeneration') {
                    mna.stampBranchCurrentConstraint(positiveNode, negativeNode, branchIndex, limit);
                } else if (active === 'regeneration-reject') {
                    mna.stampBranchCurrentConstraint(positiveNode, negativeNode, branchIndex, 0);
                } else {
                    mna.stampVoltageBranch(
                        positiveNode, negativeNode, branchIndex,
                        p.openCircuitVoltageVolts,
                        this.componentOverrides[component.id]?.resistanceOhms ?? p.internalResistanceOhms,
                    );
                }
                return;
            }
            case 'diode.piecewise-linear': {
                if (active === 'on') {
                    const conductance = 1 / p.onResistanceOhms;
                    mna.stampAffineConductance(
                        node('anode'), node('cathode'), conductance,
                        -conductance * p.forwardVoltageVolts,
                    );
                } else if (active === 'reverse-clamp') {
                    const conductance = 1 / p.onResistanceOhms;
                    mna.stampAffineConductance(
                        node('anode'), node('cathode'), conductance,
                        conductance * p.reverseClampVolts,
                    );
                } else {
                    mna.stampConductance(node('anode'), node('cathode'), p.offConductanceSiemens);
                }
                return;
            }
            case 'switch.spst': {
                const closed = booleanControl(inputs, component, componentState.closed);
                const conductance = closed ? 1 / p.onResistanceOhms : p.offConductanceSiemens;
                mna.stampConductance(node('a'), node('b'), conductance);
                return;
            }
            case 'switch.spdt': {
                const selected = controlValue(inputs, component, componentState.throw);
                let selectedThrow;
                if (selected === 'normally-open' || selected === 'normally-closed') selectedThrow = selected;
                else if (typeof selected === 'boolean') selectedThrow = selected ? 'normally-open' : 'normally-closed';
                else if (typeof selected === 'number' && Number.isFinite(selected)) {
                    selectedThrow = selected >= 0.5 ? 'normally-open' : 'normally-closed';
                } else throw new TypeError('SPDT control for ' + component.id + ' is invalid');
                mna.stampConductance(
                    node('common'), node('normallyOpen'),
                    selectedThrow === 'normally-open' ? 1 / p.onResistanceOhms : p.offConductanceSiemens,
                );
                mna.stampConductance(
                    node('common'), node('normallyClosed'),
                    selectedThrow === 'normally-closed' ? 1 / p.onResistanceOhms : p.offConductanceSiemens,
                );
                return;
            }
            case 'relay': {
                const coilResistance = this.componentOverrides[component.id]?.resistanceOhms ??
                    p.coilResistanceOhms;
                if (mode === 'dc') {
                    mna.stampVoltageBranch(
                        node('coilPositive'), node('coilNegative'), branch('coilCurrent'), 0,
                        coilResistance,
                    );
                } else {
                    mna.stampInductorBackwardEuler(
                        node('coilPositive'), node('coilNegative'), branch('coilCurrent'),
                        p.coilInductanceHenries, h, componentState.coilCurrentAmps, coilResistance,
                    );
                }
                mna.stampConductance(
                    node('common'), node('normallyOpen'),
                    active === 'energized' ? 1 / p.contactResistanceOhms : p.offConductanceSiemens,
                );
                mna.stampConductance(
                    node('common'), node('normallyClosed'),
                    active === 'energized' ? p.offConductanceSiemens : 1 / p.contactResistanceOhms,
                );
                return;
            }
            case 'mosfet': {
                const drain = node('drain');
                const gate = node('gate');
                const source = node('source');
                if (active === 'on') {
                    mna.stampConductance(drain, source, 1 / p.onResistanceOhms);
                    if (p.channel === 'n') {
                        mna.stampVccs(drain, source, gate, source, p.transconductanceSiemens);
                        mna.stampCurrentSource(
                            drain, source, -p.transconductanceSiemens * p.thresholdVolts,
                        );
                    } else {
                        mna.stampVccs(drain, source, gate, source, p.transconductanceSiemens);
                        mna.stampCurrentSource(
                            drain, source, p.transconductanceSiemens * p.thresholdVolts,
                        );
                    }
                } else {
                    mna.stampConductance(drain, source, p.offConductanceSiemens);
                }
                return;
            }
            case 'switch.pwm': {
                const duty = resolveAveragedPwmDuty(component, inputs.controls);
                const conductance = duty / p.onResistanceOhms +
                    (1 - duty) * p.offConductanceSiemens;
                mna.stampConductance(node('input'), node('output'), conductance);
                return;
            }
            case 'fuse':
                mna.stampConductance(
                    node('a'), node('b'),
                    componentState.open ? OPEN_CONDUCTANCE_SIEMENS : 1 / p.onResistanceOhms,
                );
                return;
            case 'breaker':
                mna.stampConductance(
                    node('a'), node('b'),
                    componentState.open ? OPEN_CONDUCTANCE_SIEMENS : 1 / p.onResistanceOhms,
                );
                return;
            case 'probe.current':
                mna.stampVoltageBranch(
                    node('positive'), node('negative'), branch('current'), 0, 0,
                );
                return;
            case 'probe.power':
                mna.stampVoltageBranch(
                    node('currentPositive'), node('currentNegative'), branch('current'), 0, 0,
                );
                return;
            case 'motor.dc':
            case 'motor.linear':
            case 'voice-coil': {
                const coordinate = this._coordinate(component, coordinates);
                const resistance = this._thermalShutdown(component, state)
                    ? THERMAL_SHUTDOWN_RESISTANCE_OHMS
                    : this._resistance(component, state);
                const backEmfConstant = component.kind === 'motor.dc'
                    ? p.backEmfVoltsPerRadianPerSecond
                    : p.backEmfVoltsPerMeterPerSecond;
                const backEmf = backEmfConstant * coordinate.velocity;
                if (mode === 'dc') {
                    mna.stampVoltageBranch(
                        node('positive'), node('negative'), branch('current'), backEmf, resistance,
                    );
                } else {
                    mna.stampInductorBackwardEuler(
                        node('positive'), node('negative'), branch('current'), p.inductanceHenries,
                        h, componentState.currentAmps, resistance, backEmf,
                    );
                }
                return;
            }
            case 'solenoid.variable-inductance': {
                const coordinate = this._coordinate(component, coordinates);
                const geometry = solenoidGeometry(component, coordinate);
                const resistance = this._thermalShutdown(component, state)
                    ? THERMAL_SHUTDOWN_RESISTANCE_OHMS
                    : this._resistance(component, state);
                const motionEmf = componentState.currentAmps *
                    geometry.derivativeHenriesPerUnit * coordinate.velocity;
                if (mode === 'dc') {
                    mna.stampVoltageBranch(
                        node('positive'), node('negative'), branch('current'), motionEmf, resistance,
                    );
                } else {
                    mna.stampInductorBackwardEuler(
                        node('positive'), node('negative'), branch('current'), geometry.inductance,
                        h, componentState.currentAmps, resistance, motionEmf,
                    );
                }
                return;
            }
            default:
                throw new RangeError('Unsupported runtime component kind ' + component.kind);
        }
    }

    _deriveActiveModes(solution, state, previousModes) {
        const next = new Map(previousModes);
        for (const component of this.compiled.components) {
            const p = component.parameters;
            switch (component.kind) {
                case 'diode.piecewise-linear': {
                    const voltage = this._portVoltage(solution, component, 'anode', 'cathode');
                    const previous = previousModes.get(component.id) ?? 'off';
                    let mode = 'off';
                    if (previous === 'on' && voltage >= p.forwardVoltageVolts - ACTIVE_TOLERANCE) {
                        mode = 'on';
                    } else if (previous === 'reverse-clamp' && p.reverseClampVolts != null &&
                        voltage <= -p.reverseClampVolts + ACTIVE_TOLERANCE) {
                        mode = 'reverse-clamp';
                    } else if (voltage > p.forwardVoltageVolts + ACTIVE_TOLERANCE) {
                        mode = 'on';
                    } else if (p.reverseClampVolts != null &&
                        voltage < -p.reverseClampVolts - ACTIVE_TOLERANCE) {
                        mode = 'reverse-clamp';
                    }
                    next.set(component.id, mode);
                    break;
                }
                case 'relay': {
                    const current = Math.abs(solution[this._branchIndex(component, 'coilCurrent')]);
                    const previous = previousModes.get(component.id) === 'energized';
                    const energized = previous
                        ? current > p.dropoutCurrentAmps
                        : current >= p.pickupCurrentAmps;
                    next.set(component.id, energized ? 'energized' : 'released');
                    break;
                }
                case 'mosfet': {
                    const gate = this._voltage(solution, this._portNode(component, 'gate'));
                    const source = this._voltage(solution, this._portNode(component, 'source'));
                    const drive = p.channel === 'n' ? gate - source : source - gate;
                    const previousOn = previousModes.get(component.id) === 'on';
                    const on = previousOn
                        ? drive >= p.thresholdVolts - ACTIVE_TOLERANCE
                        : drive > p.thresholdVolts + ACTIVE_TOLERANCE;
                    next.set(component.id, on ? 'on' : 'off');
                    break;
                }
                case 'supply.dc': {
                    if (this._thermalShutdown(component, state)) {
                        next.set(component.id, 'off');
                        break;
                    }
                    const current = solution[this._branchIndex(component, 'current')];
                    const voltage = this._portVoltage(solution, component, 'positive', 'negative');
                    const resistance = this.componentOverrides[component.id]?.resistanceOhms ??
                        p.internalResistanceOhms;
                    const residual = voltage - resistance * current - p.openCircuitVoltageVolts;
                    const limit = p.currentLimitAmps * this._thermalDerating(component, state);
                    const previous = previousModes.get(component.id) ?? 'normal';
                    let supplyMode = 'normal';
                    if (previous === 'current-limit-delivery' && residual <= ACTIVE_TOLERANCE) {
                        supplyMode = 'current-limit-delivery';
                    } else if (previous === 'current-limit-regeneration' && residual >= -ACTIVE_TOLERANCE) {
                        supplyMode = 'current-limit-regeneration';
                    } else if (previous === 'regeneration-reject' && residual >= -ACTIVE_TOLERANCE) {
                        supplyMode = 'regeneration-reject';
                    } else if (-current > limit + ACTIVE_TOLERANCE) {
                        supplyMode = 'current-limit-delivery';
                    } else if (current > ACTIVE_TOLERANCE && p.regenerationPolicy === 'reject') {
                        supplyMode = 'regeneration-reject';
                    } else if (current > limit + ACTIVE_TOLERANCE && p.regenerationPolicy === 'clamp') {
                        supplyMode = 'current-limit-regeneration';
                    }
                    next.set(component.id, supplyMode);
                    break;
                }
                default:
                    break;
            }
        }
        return next;
    }

    _activeModesEqual(left, right) {
        if (left.size !== right.size) return false;
        for (const [id, mode] of left) if (right.get(id) !== mode) return false;
        return true;
    }

    _solveState(state, mode, h, inputs, coordinates) {
        let activeModes = this._initialActiveModes(state);
        let lastSolve = null;
        for (let iteration = 1; iteration <= ELECTRICAL_ACTIVE_SET_MAXIMUM_ITERATIONS; iteration += 1) {
            let solution;
            if (this.compiled.unknownCount === 0) {
                solution = new Float64Array(0);
                lastSolve = {
                    residual: { maximumAbsolute: 0, relative: 0 },
                };
            } else {
                const mna = new MnaStamping(this.compiled.unknownCount);
                for (const component of this.compiled.components) {
                    this._stampComponent(
                        mna, component, state, activeModes, mode, h, inputs, coordinates,
                    );
                }
                const solve = mna.solve(this.luOptions);
                if (!solve.ok) {
                    throw solveFailure(this.compiled, solve.diagnostic);
                }
                solution = solve.solution;
                lastSolve = solve;
            }
            for (let index = 0; index < solution.length; index += 1) {
                finite(solution[index], 'electrical solution[' + index + ']');
            }
            const derived = this._deriveActiveModes(solution, state, activeModes);
            if (this._activeModesEqual(activeModes, derived)) {
                return {
                    solution,
                    activeModes: derived,
                    iterations: iteration,
                    residual: lastSolve.residual,
                };
            }
            activeModes = derived;
        }
        const error = new Error(
            'Electrical active-set solve did not converge within ' +
            ELECTRICAL_ACTIVE_SET_MAXIMUM_ITERATIONS + ' iterations',
        );
        error.code = 'ELECTRICAL_RUNTIME_NONCONVERGENCE';
        error.details = {
            maximumIterations: ELECTRICAL_ACTIVE_SET_MAXIMUM_ITERATIONS,
            componentModes: Object.fromEntries([...activeModes.entries()].sort()),
        };
        throw error;
    }

    _branchCurrent(solution, component, branchName) {
        return finite(solution[this._branchIndex(component, branchName)], component.id + ' branch current');
    }

    _componentMeasurement(component, solution, state, activeModes, mode, h, inputs, coordinates) {
        const p = component.parameters;
        const componentState = state.componentStates.get(component.id);
        const active = activeModes.get(component.id);
        const result = {
            voltageVolts: 0,
            currentAmps: 0,
            powerWatts: 0,
            resistivePowerWatts: 0,
            storedEnergyJoules: 0,
            sourcePowerWatts: 0,
            regeneratedPowerWatts: 0,
            effort: 0,
        };
        const setTwoTerminal = (positivePort, negativePort) => {
            result.voltageVolts = this._portVoltage(solution, component, positivePort, negativePort);
        };
        switch (component.kind) {
            case 'gpio.pin': {
                const conductance = gpioConductances(inputs, component);
                const signalGround = this._portVoltage(solution, component, 'signal', 'ground');
                const signalVcc = this._portVoltage(solution, component, 'signal', 'vcc');
                result.voltageVolts = signalGround;
                result.currentAmps = signalGround * conductance.low + signalVcc * conductance.high;
                result.resistivePowerWatts = signalGround ** 2 * conductance.low + signalVcc ** 2 * conductance.high;
                result.gpioMode = conductance.drive.mode; result.pullup = conductance.drive.pullup;
                break;
            }
            case 'reference':
            case 'wire':
            case 'junction':
            case 'probe.temperature':
                return result;
            case 'resistor': {
                setTwoTerminal('positive', 'negative');
                const resistance = this._thermalShutdown(component, state)
                    ? THERMAL_SHUTDOWN_RESISTANCE_OHMS
                    : this._resistance(component, state);
                result.currentAmps = result.voltageVolts / resistance;
                result.resistivePowerWatts = result.currentAmps * result.currentAmps * resistance;
                break;
            }
            case 'capacitor':
                setTwoTerminal('positive', 'negative');
                result.currentAmps = mode === 'dc'
                    ? 0
                    : p.capacitanceFarads / h *
                        (result.voltageVolts - componentState.voltageVolts);
                result.storedEnergyJoules = 0.5 * p.capacitanceFarads *
                    result.voltageVolts * result.voltageVolts;
                break;
            case 'inductor': {
                setTwoTerminal('positive', 'negative');
                result.currentAmps = this._branchCurrent(solution, component, 'current');
                const resistance = p.seriesResistanceOhms ?? 0;
                result.resistivePowerWatts = result.currentAmps * result.currentAmps * resistance;
                result.storedEnergyJoules = 0.5 * p.inductanceHenries *
                    result.currentAmps * result.currentAmps;
                break;
            }
            case 'coupled-inductors': {
                result.voltageVolts = this._portVoltage(
                    solution, component, 'primaryPositive', 'primaryNegative',
                );
                const primaryCurrent = this._branchCurrent(solution, component, 'primaryCurrent');
                const secondaryCurrent = this._branchCurrent(solution, component, 'secondaryCurrent');
                const mutual = p.couplingCoefficient * Math.sqrt(
                    p.primaryInductanceHenries * p.secondaryInductanceHenries,
                );
                result.currentAmps = primaryCurrent;
                result.primaryCurrentAmps = primaryCurrent;
                result.secondaryCurrentAmps = secondaryCurrent;
                result.resistivePowerWatts = primaryCurrent * primaryCurrent *
                    (p.primarySeriesResistanceOhms ?? 0) + secondaryCurrent * secondaryCurrent *
                    (p.secondarySeriesResistanceOhms ?? 0);
                result.storedEnergyJoules = 0.5 * p.primaryInductanceHenries *
                    primaryCurrent * primaryCurrent + 0.5 * p.secondaryInductanceHenries *
                    secondaryCurrent * secondaryCurrent + mutual * primaryCurrent * secondaryCurrent;
                break;
            }
            case 'transformer': {
                result.voltageVolts = this._portVoltage(
                    solution, component, 'primaryPositive', 'primaryNegative',
                );
                const primaryCurrent = this._branchCurrent(solution, component, 'primaryCurrent');
                const secondaryCurrent = this._branchCurrent(solution, component, 'secondaryCurrent');
                const magnetizingCurrent = primaryCurrent + secondaryCurrent / p.turnsRatio;
                result.currentAmps = primaryCurrent;
                result.primaryCurrentAmps = primaryCurrent;
                result.secondaryCurrentAmps = secondaryCurrent;
                result.magnetizingCurrentAmps = magnetizingCurrent;
                result.resistivePowerWatts = primaryCurrent * primaryCurrent *
                    (p.primaryResistanceOhms ?? 0) + secondaryCurrent * secondaryCurrent *
                    (p.secondaryResistanceOhms ?? 0);
                result.storedEnergyJoules = p.magnetizingInductanceHenries == null
                    ? 0
                    : 0.5 * p.magnetizingInductanceHenries *
                        magnetizingCurrent * magnetizingCurrent;
                break;
            }
            case 'voltage-source.dc':
            case 'voltage-source.pulse':
            case 'voltage-source.sine':
                setTwoTerminal('positive', 'negative');
                result.currentAmps = this._branchCurrent(solution, component, 'current');
                result.resistivePowerWatts = result.currentAmps * result.currentAmps *
                    (p.seriesResistanceOhms ?? 0);
                result.sourcePowerWatts = -sampleElectricalSource(
                    component, state.solveTimeSeconds ?? state.timeSeconds,
                ) * result.currentAmps;
                break;
            case 'current-source.dc':
            case 'current-source.pulse':
            case 'current-source.sine':
                setTwoTerminal('positive', 'negative');
                result.currentAmps = sampleElectricalSource(
                    component, state.solveTimeSeconds ?? state.timeSeconds,
                );
                result.sourcePowerWatts = -result.voltageVolts * result.currentAmps;
                break;
            case 'dependent-source.vcvs':
            case 'dependent-source.ccvs':
                result.voltageVolts = this._portVoltage(
                    solution, component, 'outputPositive', 'outputNegative',
                );
                result.currentAmps = this._branchCurrent(solution, component, 'outputCurrent');
                result.sourcePowerWatts = -result.voltageVolts * result.currentAmps;
                break;
            case 'dependent-source.vccs': {
                result.voltageVolts = this._portVoltage(
                    solution, component, 'outputPositive', 'outputNegative',
                );
                const controlVoltage = this._portVoltage(
                    solution, component, 'controlPositive', 'controlNegative',
                );
                result.currentAmps = p.transconductanceSiemens * controlVoltage;
                result.sourcePowerWatts = -result.voltageVolts * result.currentAmps;
                break;
            }
            case 'dependent-source.cccs': {
                result.voltageVolts = this._portVoltage(
                    solution, component, 'outputPositive', 'outputNegative',
                );
                const control = this._componentById.get(p.controlComponentId);
                const controlBranch = p.controlBranch ?? control.branchUnknowns[0];
                result.currentAmps = p.currentGain *
                    this._branchCurrent(solution, control, controlBranch);
                result.sourcePowerWatts = -result.voltageVolts * result.currentAmps;
                break;
            }
            case 'supply.dc': {
                setTwoTerminal('positive', 'negative');
                result.currentAmps = this._branchCurrent(solution, component, 'current');
                const resistance = this.componentOverrides[component.id]?.resistanceOhms ??
                    p.internalResistanceOhms;
                result.resistivePowerWatts = result.currentAmps * result.currentAmps * resistance;
                result.sourcePowerWatts = -p.openCircuitVoltageVolts * result.currentAmps;
                result.regeneratedPowerWatts = result.currentAmps > 0
                    ? p.openCircuitVoltageVolts * result.currentAmps
                    : 0;
                break;
            }
            case 'diode.piecewise-linear': {
                setTwoTerminal('anode', 'cathode');
                if (active === 'on') {
                    result.currentAmps = (result.voltageVolts - p.forwardVoltageVolts) /
                        p.onResistanceOhms;
                    result.resistivePowerWatts = result.currentAmps * result.currentAmps *
                        p.onResistanceOhms;
                } else if (active === 'reverse-clamp') {
                    result.currentAmps = (result.voltageVolts + p.reverseClampVolts) /
                        p.onResistanceOhms;
                    result.resistivePowerWatts = result.currentAmps * result.currentAmps *
                        p.onResistanceOhms;
                } else {
                    result.currentAmps = p.offConductanceSiemens * result.voltageVolts;
                }
                break;
            }
            case 'switch.spst': {
                setTwoTerminal('a', 'b');
                const closed = booleanControl(inputs, component, componentState.closed);
                const conductance = closed ? 1 / p.onResistanceOhms : p.offConductanceSiemens;
                result.currentAmps = conductance * result.voltageVolts;
                if (closed) result.resistivePowerWatts = result.currentAmps ** 2 * p.onResistanceOhms;
                result.closed = closed;
                break;
            }
            case 'switch.spdt': {
                const selected = controlValue(inputs, component, componentState.throw);
                const selectedThrow = selected === 'normally-open' || selected === true ||
                    (typeof selected === 'number' && selected >= 0.5)
                    ? 'normally-open'
                    : 'normally-closed';
                const common = this._voltage(solution, this._portNode(component, 'common'));
                const noVoltage = common - this._voltage(solution, this._portNode(component, 'normallyOpen'));
                const ncVoltage = common - this._voltage(solution, this._portNode(component, 'normallyClosed'));
                const noCurrent = noVoltage * (selectedThrow === 'normally-open'
                    ? 1 / p.onResistanceOhms : p.offConductanceSiemens);
                const ncCurrent = ncVoltage * (selectedThrow === 'normally-closed'
                    ? 1 / p.onResistanceOhms : p.offConductanceSiemens);
                result.voltageVolts = selectedThrow === 'normally-open' ? noVoltage : ncVoltage;
                result.currentAmps = noCurrent + ncCurrent;
                result.resistivePowerWatts = (selectedThrow === 'normally-open'
                    ? noCurrent * noCurrent : ncCurrent * ncCurrent) * p.onResistanceOhms;
                result.throw = selectedThrow;
                break;
            }
            case 'relay': {
                const coilVoltage = this._portVoltage(
                    solution, component, 'coilPositive', 'coilNegative',
                );
                const coilCurrent = this._branchCurrent(solution, component, 'coilCurrent');
                const common = this._voltage(solution, this._portNode(component, 'common'));
                const contactPort = active === 'energized' ? 'normallyOpen' : 'normallyClosed';
                const contactVoltage = common - this._voltage(
                    solution, this._portNode(component, contactPort),
                );
                const contactCurrent = contactVoltage / p.contactResistanceOhms;
                const coilResistance = this.componentOverrides[component.id]?.resistanceOhms ??
                    p.coilResistanceOhms;
                result.voltageVolts = coilVoltage;
                result.currentAmps = coilCurrent;
                result.coilCurrentAmps = coilCurrent;
                result.contactCurrentAmps = contactCurrent;
                result.resistivePowerWatts = coilCurrent * coilCurrent * coilResistance +
                    contactCurrent * contactCurrent * p.contactResistanceOhms;
                result.storedEnergyJoules = 0.5 * p.coilInductanceHenries *
                    coilCurrent * coilCurrent;
                result.energized = active === 'energized';
                break;
            }
            case 'mosfet': {
                setTwoTerminal('drain', 'source');
                const gate = this._voltage(solution, this._portNode(component, 'gate'));
                const source = this._voltage(solution, this._portNode(component, 'source'));
                if (active === 'on') {
                    const controlCurrent = p.channel === 'n'
                        ? p.transconductanceSiemens * (gate - source - p.thresholdVolts)
                        : p.transconductanceSiemens * (gate - source + p.thresholdVolts);
                    result.currentAmps = result.voltageVolts / p.onResistanceOhms + controlCurrent;
                    result.resistivePowerWatts = result.currentAmps * result.currentAmps *
                        p.onResistanceOhms;
                } else result.currentAmps = p.offConductanceSiemens * result.voltageVolts;
                result.on = active === 'on';
                break;
            }
            case 'switch.pwm': {
                result.voltageVolts = this._portVoltage(solution, component, 'input', 'output');
                const duty = resolveAveragedPwmDuty(component, inputs.controls);
                const conductance = duty / p.onResistanceOhms +
                    (1 - duty) * p.offConductanceSiemens;
                result.currentAmps = conductance * result.voltageVolts;
                // This element stamps an averaged conductance, so its terminal
                // dissipation must use that same conductance, including leakage.
                result.resistivePowerWatts = conductance * result.voltageVolts * result.voltageVolts;
                result.dutyCycle = duty;
                break;
            }
            case 'fuse':
            case 'breaker': {
                setTwoTerminal('a', 'b');
                const conductance = componentState.open
                    ? OPEN_CONDUCTANCE_SIEMENS
                    : 1 / p.onResistanceOhms;
                result.currentAmps = conductance * result.voltageVolts;
                if (!componentState.open) {
                    result.resistivePowerWatts = result.currentAmps * result.currentAmps *
                        p.onResistanceOhms;
                }
                break;
            }
            case 'probe.voltage':
                setTwoTerminal('positive', 'negative');
                break;
            case 'probe.current':
                setTwoTerminal('positive', 'negative');
                result.currentAmps = this._branchCurrent(solution, component, 'current');
                break;
            case 'probe.power':
                result.voltageVolts = this._portVoltage(
                    solution,
                    component,
                    'voltagePositive',
                    'voltageNegative',
                );
                result.currentAmps = this._branchCurrent(solution, component, 'current');
                break;
            case 'motor.dc':
            case 'motor.linear':
            case 'voice-coil': {
                setTwoTerminal('positive', 'negative');
                const coordinate = this._coordinate(component, coordinates);
                result.currentAmps = this._branchCurrent(solution, component, 'current');
                const resistance = this._resistance(component, state);
                result.resistivePowerWatts = result.currentAmps * result.currentAmps * resistance;
                result.storedEnergyJoules = 0.5 * p.inductanceHenries *
                    result.currentAmps * result.currentAmps;
                const derating = this._thermalDerating(component, state);
                if (component.kind === 'motor.dc') {
                    let effort = p.torqueConstantNewtonMetersPerAmp * result.currentAmps -
                        (p.viscousFrictionNewtonMeterSeconds ?? 0) * coordinate.velocity;
                    const coulomb = p.coulombFrictionNewtonMeters ?? 0;
                    if (Math.abs(coordinate.velocity) > ACTIVE_TOLERANCE) {
                        effort -= Math.sign(coordinate.velocity) * coulomb;
                    } else if (Math.abs(effort) <= coulomb) effort = 0;
                    else effort -= Math.sign(effort) * coulomb;
                    result.effort = effort * derating;
                } else {
                    result.effort = p.forceConstantNewtonsPerAmp * result.currentAmps * derating;
                }
                break;
            }
            case 'solenoid.variable-inductance': {
                setTwoTerminal('positive', 'negative');
                const coordinate = this._coordinate(component, coordinates);
                const geometry = solenoidGeometry(component, coordinate);
                result.currentAmps = this._branchCurrent(solution, component, 'current');
                const resistance = this._resistance(component, state);
                result.resistivePowerWatts = result.currentAmps * result.currentAmps * resistance;
                result.storedEnergyJoules = 0.5 * geometry.inductance *
                    result.currentAmps * result.currentAmps;
                result.effort = 0.5 * result.currentAmps * result.currentAmps *
                    geometry.derivativeHenriesPerUnit * this._thermalDerating(component, state);
                result.inductanceHenries = geometry.inductance;
                result.inductanceDerivativeHenriesPerUnit = geometry.derivativeHenriesPerUnit;
                break;
            }
            default:
                throw new RangeError('Unsupported measurement kind ' + component.kind);
        }
        result.powerWatts = result.voltageVolts * result.currentAmps;
        for (const [key, value] of Object.entries(result)) {
            if (typeof value === 'number') finite(value, component.id + ' measurement ' + key);
        }
        return result;
    }

    _applySolvedState(state, solved, mode, h, inputs, coordinates) {
        const measurements = new Map();
        const efforts = new Map();
        let sourceEnergyJoules = 0;
        let regeneratedEnergyJoules = 0;
        let resistiveLossJoules = 0;
        let mechanicalWorkJoules = 0;
        let thermalGainJoules = 0;
        let thermalLossJoules = 0;
        let capacitiveEnergyJoules = 0;
        let magneticEnergyJoules = 0;

        for (const component of this.compiled.components) {
            const measurement = this._componentMeasurement(
                component,
                solved.solution,
                state,
                solved.activeModes,
                mode,
                h,
                inputs,
                coordinates,
            );
            const componentState = state.componentStates.get(component.id);
            const p = component.parameters;
            switch (component.kind) {
                case 'capacitor': {
                    const nextVoltage = mode === 'dc' && p.initialVoltageVolts != null
                        ? p.initialVoltageVolts
                        : measurement.voltageVolts;
                    componentState.voltageVolts = nextVoltage;
                    componentState.currentAmps = measurement.currentAmps;
                    const energy = 0.5 * p.capacitanceFarads * nextVoltage * nextVoltage;
                    capacitiveEnergyJoules += energy;
                    measurement.storedEnergyJoules = energy;
                    break;
                }
                case 'inductor': {
                    const nextCurrent = mode === 'dc' && p.initialCurrentAmps != null
                        ? p.initialCurrentAmps
                        : measurement.currentAmps;
                    componentState.currentAmps = nextCurrent;
                    const energy = 0.5 * p.inductanceHenries * nextCurrent * nextCurrent;
                    magneticEnergyJoules += energy;
                    measurement.storedEnergyJoules = energy;
                    break;
                }
                case 'coupled-inductors': {
                    const primaryCurrent = mode === 'dc' && p.primaryInitialCurrentAmps != null
                        ? p.primaryInitialCurrentAmps
                        : measurement.primaryCurrentAmps;
                    const secondaryCurrent = mode === 'dc' && p.secondaryInitialCurrentAmps != null
                        ? p.secondaryInitialCurrentAmps
                        : measurement.secondaryCurrentAmps;
                    componentState.primaryCurrentAmps = primaryCurrent;
                    componentState.secondaryCurrentAmps = secondaryCurrent;
                    const mutual = p.couplingCoefficient * Math.sqrt(
                        p.primaryInductanceHenries * p.secondaryInductanceHenries,
                    );
                    const energy = 0.5 * p.primaryInductanceHenries * primaryCurrent * primaryCurrent +
                        0.5 * p.secondaryInductanceHenries * secondaryCurrent * secondaryCurrent +
                        mutual * primaryCurrent * secondaryCurrent;
                    magneticEnergyJoules += energy;
                    measurement.storedEnergyJoules = energy;
                    break;
                }
                case 'transformer':
                    componentState.primaryCurrentAmps = measurement.primaryCurrentAmps;
                    componentState.secondaryCurrentAmps = measurement.secondaryCurrentAmps;
                    componentState.magnetizingCurrentAmps = measurement.magnetizingCurrentAmps;
                    magneticEnergyJoules += measurement.storedEnergyJoules;
                    break;
                case 'relay':
                    componentState.coilCurrentAmps = measurement.coilCurrentAmps;
                    componentState.contactCurrentAmps = measurement.contactCurrentAmps;
                    componentState.energized = measurement.energized;
                    magneticEnergyJoules += measurement.storedEnergyJoules;
                    break;
                case 'switch.spst':
                    componentState.closed = measurement.closed;
                    componentState.currentAmps = measurement.currentAmps;
                    break;
                case 'switch.spdt':
                    componentState.throw = measurement.throw;
                    componentState.currentAmps = measurement.currentAmps;
                    break;
                case 'diode.piecewise-linear':
                    componentState.mode = solved.activeModes.get(component.id);
                    componentState.currentAmps = measurement.currentAmps;
                    break;
                case 'mosfet':
                    componentState.on = measurement.on;
                    componentState.currentAmps = measurement.currentAmps;
                    break;
                case 'switch.pwm':
                    componentState.dutyCycle = measurement.dutyCycle;
                    componentState.currentAmps = measurement.currentAmps;
                    break;
                case 'fuse':
                    if (mode !== 'dc') {
                        Object.assign(componentState, advanceFuseState(
                            componentState, measurement.currentAmps, h, component,
                        ));
                    }
                    componentState.currentAmps = measurement.currentAmps;
                    break;
                case 'breaker':
                    if (mode !== 'dc') {
                        // The sampled trip/reset latches at this substep's end;
                        // its contact conductance changes on the following solve.
                        Object.assign(componentState, advanceBreakerState(
                            componentState,
                            measurement.currentAmps,
                            h,
                            component,
                            inputs.resets[component.id] === true,
                        ));
                    }
                    componentState.currentAmps = measurement.currentAmps;
                    break;
                case 'supply.dc':
                    componentState.mode = solved.activeModes.get(component.id);
                    componentState.currentAmps = measurement.currentAmps;
                    componentState.terminalVoltageVolts = measurement.voltageVolts;
                    componentState.currentLimited = componentState.mode === 'current-limit-delivery' ||
                        componentState.mode === 'current-limit-regeneration';
                    componentState.brownout = measurement.voltageVolts < p.brownoutVoltageVolts;
                    componentState.regeneration = measurement.currentAmps > ACTIVE_TOLERANCE;
                    break;
                case 'motor.dc':
                case 'motor.linear':
                case 'voice-coil':
                case 'solenoid.variable-inductance': {
                    const nextCurrent = mode === 'dc' && p.initialCurrentAmps != null
                        ? p.initialCurrentAmps
                        : measurement.currentAmps;
                    componentState.currentAmps = nextCurrent;
                    componentState.effort = measurement.effort;
                    let storedEnergy = measurement.storedEnergyJoules;
                    if (mode === 'dc' && nextCurrent !== measurement.currentAmps) {
                        if (component.kind === 'solenoid.variable-inductance') {
                            const coordinate = this._coordinate(component, coordinates);
                            storedEnergy = 0.5 * solenoidGeometry(component, coordinate).inductance *
                                nextCurrent * nextCurrent;
                        } else {
                            storedEnergy = 0.5 * p.inductanceHenries * nextCurrent * nextCurrent;
                        }
                        measurement.storedEnergyJoules = storedEnergy;
                    }
                    magneticEnergyJoules += storedEnergy;
                    if (component.actuatorRef) {
                        efforts.set(
                            component.actuatorRef,
                            finite(
                                (efforts.get(component.actuatorRef) ?? 0) + measurement.effort,
                                component.actuatorRef + ' summed effort',
                            ),
                        );
                    }
                    break;
                }
                default:
                    componentState.currentAmps = measurement.currentAmps;
                    break;
            }

            if (mode !== 'dc') {
                const previousThermal = state.thermalStates.get(component.id);
                const nextThermal = advanceThermalState(
                    previousThermal,
                    this.componentOverrides[component.id] ?? {},
                    Math.max(0, measurement.resistivePowerWatts),
                    h,
                );
                state.thermalStates.set(component.id, nextThermal);
                thermalGainJoules += nextThermal.jouleEnergyJoules -
                    previousThermal.jouleEnergyJoules;
                thermalLossJoules += nextThermal.coolingEnergyJoules -
                    previousThermal.coolingEnergyJoules;
                sourceEnergyJoules += measurement.sourcePowerWatts * h;
                regeneratedEnergyJoules += measurement.regeneratedPowerWatts * h;
                resistiveLossJoules += measurement.resistivePowerWatts * h;
                if (component.actuatorRef) {
                    const coordinate = this._coordinate(component, coordinates);
                    mechanicalWorkJoules += measurement.effort * coordinate.velocity * h;
                }
            }
            measurements.set(component.id, measurement);
        }

        const storedElectricalEnergyJoules = capacitiveEnergyJoules + magneticEnergyJoules;
        if (mode === 'dc') {
            state.initialized = true;
            state.solution = solved.solution.slice();
            state.capacitiveEnergyJoules = capacitiveEnergyJoules;
            state.magneticEnergyJoules = magneticEnergyJoules;
            state.storedElectricalEnergyJoules = storedElectricalEnergyJoules;
        } else {
            const storedEnergyChangeJoules = storedElectricalEnergyJoules -
                state.storedElectricalEnergyJoules;
            const numericalResidualJoules = calculateElectricalEnergyResidual({
                sourceEnergyJoules,
                resistiveLossJoules,
                storedEnergyChangeJoules,
                mechanicalWorkJoules,
            });
            state.energyLedger = advanceElectricalEnergyLedger(state.energyLedger, {
                sourceEnergyJoules,
                regeneratedEnergyJoules,
                resistiveLossJoules,
                capacitiveEnergyJoules: capacitiveEnergyJoules - state.capacitiveEnergyJoules,
                magneticEnergyJoules: magneticEnergyJoules - state.magneticEnergyJoules,
                mechanicalWorkJoules,
                thermalGainJoules,
                thermalLossJoules,
                numericalResidualJoules,
            });
            state.solution = solved.solution.slice();
            state.timeSeconds = finite(state.timeSeconds + h, 'runtime timeSeconds', 0);
            state.stepCount += 1;
            state.capacitiveEnergyJoules = capacitiveEnergyJoules;
            state.magneticEnergyJoules = magneticEnergyJoules;
            state.storedElectricalEnergyJoules = storedElectricalEnergyJoules;
        }

        const probes = new Map();
        for (const probeId of this.compiled.probes) {
            const component = this._componentById.get(probeId);
            const measurement = measurements.get(component.id);
            let value;
            let unit;
            if (component.kind === 'probe.voltage') {
                value = measurement.voltageVolts;
                unit = 'V';
            } else if (component.kind === 'probe.current') {
                value = measurement.currentAmps;
                unit = 'A';
            } else if (component.kind === 'probe.power') {
                value = measurement.powerWatts;
                unit = 'W';
            } else {
                const targetId = component.parameters.componentId;
                value = state.thermalStates.get(targetId)?.temperatureKelvin;
                if (!Number.isFinite(value)) {
                    throw new RangeError(component.id + ' targets unavailable temperature ' + targetId);
                }
                unit = 'K';
            }
            probes.set(component.id, { id: component.id, kind: component.kind, value, unit });
        }
        state.probes = probes;

        return {
            measurements,
            efforts,
            energy: mode === 'dc'
                ? snapshotElectricalEnergyLedger(state.energyLedger)
                : freezeTree({ ...state.energyLedger.lastStep }),
        };
    }

    _buildStepReport(state, solved, applied, mode) {
        const components = Object.fromEntries([...applied.measurements.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([id, measurement]) => [id, {
                ...clonePlain(measurement),
                temperatureKelvin: state.thermalStates.get(id).temperatureKelvin,
                thermalWarned: state.thermalStates.get(id).warned,
                thermalShutdown: state.thermalStates.get(id).shutdown,
                thermalDeratingFactor: state.thermalStates.get(id).deratingFactor,
                protection: clonePlain(state.componentStates.get(id)),
            }]));
        const report = successReport({
            mode,
            timeSeconds: state.timeSeconds,
            stepCount: state.stepCount,
            iterations: solved.iterations,
            residual: {
                maximumAbsolute: solved.residual?.maximumAbsolute ?? 0,
                relative: solved.residual?.relative ?? 0,
            },
            solution: Array.from(solved.solution),
            components,
            probes: Object.fromEntries([...state.probes.entries()]
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([id, value]) => [id, clonePlain(value)])),
            efforts: Object.fromEntries([...applied.efforts.entries()].sort()),
            energy: mode === 'dc'
                ? snapshotElectricalEnergyLedger(state.energyLedger)
                : freezeTree({ ...state.energyLedger.lastStep }),
        });
        state.lastStep = report;
        return report;
    }

    _initializeCandidate(candidate, inputs, coordinates) {
        candidate.solveTimeSeconds = candidate.timeSeconds;
        const solved = this._solveState(candidate, 'dc', 1, inputs, coordinates);
        const applied = this._applySolvedState(candidate, solved, 'dc', 1, inputs, coordinates);
        delete candidate.solveTimeSeconds;
        const report = this._buildStepReport(candidate, solved, applied, 'dc');
        return { candidate, report, efforts: applied.efforts };
    }

    _prepareSubstep(h, inputValue = {}, coordinateValue = {}) {
        this._assertLive();
        const dt = positive(h, 'electrical substep');
        const inputs = this._normalizeInputs(inputValue);
        const coordinates = this._coordinateMap(coordinateValue);
        const candidate = cloneRuntimeState(this._state);
        try {
            if (!candidate.initialized) this._initializeCandidate(candidate, inputs, coordinates);
            candidate.solveTimeSeconds = candidate.timeSeconds + dt;
            const solved = this._solveState(candidate, 'transient', dt, inputs, coordinates);
            const applied = this._applySolvedState(
                candidate, solved, 'transient', dt, inputs, coordinates,
            );
            delete candidate.solveTimeSeconds;
            const report = this._buildStepReport(candidate, solved, applied, 'transient');
            return { ok: true, runtime: this, candidate, report, efforts: applied.efforts };
        } catch (error) {
            return { ok: false, runtime: this, error, report: failureReport(error, this._state) };
        }
    }

    _commitPrepared(prepared) {
        this._assertLive();
        if (!prepared || prepared.runtime !== this || prepared.ok !== true || !prepared.candidate) {
            throw new TypeError('Prepared electrical step does not belong to this runtime');
        }
        this._state = prepared.candidate;
        prepared.candidate = null;
        return prepared.report;
    }

    initialize(inputValue = {}, coordinateValue = {}) {
        this._assertLive();
        if (this._state.initialized) {
            return successReport({
                mode: 'dc',
                alreadyInitialized: true,
                timeSeconds: this._state.timeSeconds,
                stepCount: this._state.stepCount,
                snapshot: this.snapshot(),
            });
        }
        const inputs = this._normalizeInputs(inputValue);
        const coordinates = this._coordinateMap(coordinateValue);
        const candidate = cloneRuntimeState(this._state);
        try {
            const prepared = this._initializeCandidate(candidate, inputs, coordinates);
            this._state = prepared.candidate;
            return prepared.report;
        } catch (error) {
            return failureReport(error, this._state);
        }
    }

    stepElectricalSubstep(h, inputValue = {}, coordinateValue = {}) {
        const prepared = this._prepareSubstep(h, inputValue, coordinateValue);
        return prepared.ok ? this._commitPrepared(prepared) : prepared.report;
    }

    snapshot() {
        this._assertLive();
        return freezeTree({
            schema: ELECTRICAL_RUNTIME_SNAPSHOT_SCHEMA,
            version: ELECTRICAL_RUNTIME_SNAPSHOT_VERSION,
            circuitId: this.compiled.id,
            compiledVersion: this.compiled.version,
            unknownCount: this.compiled.unknownCount,
            initialized: this._state.initialized,
            timeSeconds: this._state.timeSeconds,
            stepCount: this._state.stepCount,
            solution: Array.from(this._state.solution),
            componentOverrides: clonePlain(this.componentOverrides),
            componentStates: this.compiled.components.map((component) => ({
                id: component.id,
                kind: component.kind,
                state: clonePlain(this._state.componentStates.get(component.id)),
            })),
            thermalStates: this.compiled.components.map((component) => ({
                id: component.id,
                state: cloneThermalState(this._state.thermalStates.get(component.id)),
            })),
            probes: [...this._state.probes.entries()]
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([id, value]) => ({ id, value: clonePlain(value) })),
            energyLedger: snapshotElectricalEnergyLedger(this._state.energyLedger),
            storedElectricalEnergyJoules: this._state.storedElectricalEnergyJoules,
            capacitiveEnergyJoules: this._state.capacitiveEnergyJoules,
            magneticEnergyJoules: this._state.magneticEnergyJoules,
        });
    }

    restore(snapshot) {
        this._assertLive();
        try {
            const source = plainRecord(snapshot, 'electrical runtime snapshot');
            if (source.schema !== ELECTRICAL_RUNTIME_SNAPSHOT_SCHEMA ||
                source.version !== ELECTRICAL_RUNTIME_SNAPSHOT_VERSION ||
                source.circuitId !== this.compiled.id ||
                source.compiledVersion !== this.compiled.version ||
                source.unknownCount !== this.compiled.unknownCount) {
                throw new RangeError('Electrical runtime snapshot does not match the compiled circuit');
            }
            if (JSON.stringify(clonePlain(source.componentOverrides)) !==
                JSON.stringify(clonePlain(this.componentOverrides))) {
                throw new RangeError('Electrical runtime snapshot component overrides do not match');
            }
            if (typeof source.initialized !== 'boolean') {
                throw new TypeError('snapshot initialized must be boolean');
            }
            const timeSeconds = finite(source.timeSeconds, 'snapshot timeSeconds', 0);
            if (!Number.isSafeInteger(source.stepCount) || source.stepCount < 0) {
                throw new RangeError('snapshot stepCount must be a non-negative safe integer');
            }
            if (!Array.isArray(source.solution) || source.solution.length !== this.compiled.unknownCount) {
                throw new RangeError('snapshot solution length does not match compiled unknowns');
            }
            const solution = new Float64Array(source.solution.map((value, index) =>
                finite(value, 'snapshot solution[' + index + ']')));
            if (!Array.isArray(source.componentStates) ||
                source.componentStates.length !== this.compiled.components.length ||
                !Array.isArray(source.thermalStates) ||
                source.thermalStates.length !== this.compiled.components.length) {
                throw new RangeError('snapshot component state count does not match compiled components');
            }
            const componentRecords = new Map();
            for (const [index, rawRecord] of source.componentStates.entries()) {
                const record = exactRecord(
                    rawRecord,
                    ['id', 'kind', 'state'],
                    'snapshot component state record',
                );
                if (typeof record.id !== 'string' ||
                    record.id !== this.compiled.components[index].id ||
                    componentRecords.has(record.id)) {
                    throw new RangeError('snapshot contains an invalid or duplicate component state');
                }
                componentRecords.set(record.id, record);
            }
            const thermalRecords = new Map();
            for (const [index, rawRecord] of source.thermalStates.entries()) {
                const record = exactRecord(
                    rawRecord,
                    ['id', 'state'],
                    'snapshot thermal state record',
                );
                if (typeof record.id !== 'string' ||
                    record.id !== this.compiled.components[index].id ||
                    thermalRecords.has(record.id)) {
                    throw new RangeError('snapshot contains an invalid or duplicate thermal state');
                }
                thermalRecords.set(record.id, record);
            }
            const componentStates = new Map();
            const thermalStates = new Map();
            for (const component of this.compiled.components) {
                const componentRecord = componentRecords.get(component.id);
                const thermalRecord = thermalRecords.get(component.id);
                if (!componentRecord || componentRecord.kind !== component.kind || !thermalRecord) {
                    throw new RangeError('snapshot is missing state for component ' + component.id);
                }
                componentStates.set(
                    component.id,
                    restoreComponentState(component, componentRecord.state),
                );
                const thermal = exactRecord(
                    thermalRecord.state,
                    THERMAL_STATE_KEYS,
                    'thermal state ' + component.id,
                );
                const restoredThermal = {
                    temperatureKelvin: finite(
                        thermal.temperatureKelvin,
                        component.id + ' temperatureKelvin',
                        Number.MIN_VALUE,
                    ),
                    warned: thermal.warned,
                    shutdown: thermal.shutdown,
                    deratingFactor: finite(thermal.deratingFactor, component.id + ' deratingFactor', 0),
                    jouleEnergyJoules: finite(
                        thermal.jouleEnergyJoules,
                        component.id + ' jouleEnergyJoules',
                        0,
                    ),
                    coolingEnergyJoules: finite(
                        thermal.coolingEnergyJoules,
                        component.id + ' coolingEnergyJoules',
                    ),
                };
                if (typeof restoredThermal.warned !== 'boolean' ||
                    typeof restoredThermal.shutdown !== 'boolean' ||
                    restoredThermal.deratingFactor > 1) {
                    throw new RangeError(component.id + ' thermal flags or derating are invalid');
                }
                thermalStates.set(component.id, restoredThermal);
            }
            const probes = restoreProbeState(this.compiled, source.probes, source.initialized);
            const candidate = {
                initialized: source.initialized,
                timeSeconds,
                stepCount: source.stepCount,
                solution,
                componentStates,
                thermalStates,
                probes,
                energyLedger: restoreElectricalEnergyLedger(source.energyLedger),
                storedElectricalEnergyJoules: finite(
                    source.storedElectricalEnergyJoules,
                    'snapshot storedElectricalEnergyJoules',
                    0,
                ),
                capacitiveEnergyJoules: finite(
                    source.capacitiveEnergyJoules,
                    'snapshot capacitiveEnergyJoules',
                    0,
                ),
                magneticEnergyJoules: finite(
                    source.magneticEnergyJoules,
                    'snapshot magneticEnergyJoules',
                    0,
                ),
                lastStep: null,
            };
            this._state = candidate;
            return successReport({ snapshot: this.snapshot(), statePreserved: false });
        } catch (error) {
            return failureReport(error, this._state);
        }
    }

    telemetry() {
        this._assertLive();
        return freezeTree({
            circuitId: this.compiled.id,
            initialized: this._state.initialized,
            timeSeconds: this._state.timeSeconds,
            stepCount: this._state.stepCount,
            probes: Object.fromEntries([...this._state.probes.entries()]
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([id, value]) => [id, clonePlain(value)])),
            energy: snapshotElectricalEnergyLedger(this._state.energyLedger),
            lastStep: this._state.lastStep,
        });
    }

    dispose() {
        if (this._disposed) return false;
        this._state.componentStates.clear();
        this._state.thermalStates.clear();
        this._state.probes.clear();
        this._disposed = true;
        return true;
    }
}

export function createElectricalRuntime(compiled, snapshot = null, options = {}) {
    const inheritedOptions = snapshot?.componentOverrides != null &&
        options?.componentOverrides == null
        ? { ...options, componentOverrides: snapshot.componentOverrides }
        : options;
    const runtime = new ElectricalRuntime(compiled, inheritedOptions);
    if (snapshot != null) {
        const report = runtime.restore(snapshot);
        if (!report.ok) {
            const first = report.errors[0];
            const error = new Error(first.message);
            error.code = first.code;
            error.details = first.details;
            runtime.dispose();
            throw error;
        }
    }
    return runtime;
}

export function snapshotElectricalRuntime(runtime) {
    if (!(runtime instanceof ElectricalRuntime)) {
        throw new TypeError('ElectricalRuntime is required');
    }
    return runtime.snapshot();
}

export function restoreElectricalRuntime(runtime, snapshot) {
    if (!(runtime instanceof ElectricalRuntime)) {
        throw new TypeError('ElectricalRuntime is required');
    }
    return runtime.restore(snapshot);
}

export default createElectricalRuntime;
