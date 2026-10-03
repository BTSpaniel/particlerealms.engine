// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const ELECTRICAL_CIRCUIT_SCHEMA = 'engine.electrical.circuit';
export const ELECTRICAL_CIRCUIT_VERSION = '1.0.0';

export const ELECTRICAL_LIMITS = Object.freeze({
    maximumNets: 512,
    maximumComponents: 512,
    maximumTerminals: 2_048,
    maximumPortsPerComponent: 64,
    maximumProbes: 512,
    maximumUnknowns: 128,
    maximumElectricalSubsteps: 1_024,
    maximumMechanicalHz: 100_000,
    maximumFrequencyHz: 100_000_000_000,
    maximumAbsoluteNumber: 1e15,
});

const IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9._:/-]{0,255}$/;
const PORT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const TOP_LEVEL_KEYS = new Set([
    'schema',
    'version',
    'id',
    'referenceNets',
    'nets',
    'components',
    'probes',
    'settings',
]);
const NET_KEYS = new Set(['id', 'terminalRefs']);
const COMPONENT_KEYS = new Set([
    'id',
    'kind',
    'ports',
    'parameters',
    'materialRef',
    'actuatorRef',
]);
const SETTINGS_KEYS = new Set(['mechanicalHz', 'electricalSubsteps']);
const MAX = ELECTRICAL_LIMITS.maximumAbsoluteNumber;

const numberRule = ({
    required = false,
    minimum = -MAX,
    maximum = MAX,
    exclusiveMinimum = false,
    integer = false,
    nonZero = false,
} = {}) => Object.freeze({
    type: 'number',
    required,
    minimum,
    maximum,
    exclusiveMinimum,
    integer,
    nonZero,
});
const booleanRule = ({ required = false } = {}) => Object.freeze({
    type: 'boolean',
    required,
});
const identifierRule = ({ required = false } = {}) => Object.freeze({
    type: 'identifier',
    required,
});
const enumRule = (values, { required = false } = {}) => Object.freeze({
    type: 'enum',
    required,
    values: Object.freeze([...values]),
});

const positive = (required = true, maximum = MAX) => numberRule({
    required,
    minimum: 0,
    maximum,
    exclusiveMinimum: true,
});
const nonNegative = (required = false, maximum = MAX) => numberRule({
    required,
    minimum: 0,
    maximum,
});
const finite = (required = false, maximum = MAX) => numberRule({
    required,
    minimum: -maximum,
    maximum,
});

function defineKind(kind, {
    requiredPorts = [],
    optionalPorts = [],
    variablePorts = false,
    minimumPorts = requiredPorts.length,
    maximumPorts = requiredPorts.length + optionalPorts.length,
    idealUnion = false,
    islandGroups = [],
    branchUnknowns = [],
    parameters = {},
    requiresActuatorRef = false,
    control = null,
} = {}) {
    return Object.freeze({
        kind,
        requiredPorts: Object.freeze([...requiredPorts]),
        optionalPorts: Object.freeze([...optionalPorts]),
        variablePorts,
        minimumPorts,
        maximumPorts,
        idealUnion,
        islandGroups: Object.freeze(islandGroups.map((group) => Object.freeze([...group]))),
        branchUnknowns: Object.freeze([...branchUnknowns]),
        parameters: Object.freeze({ ...parameters }),
        requiresActuatorRef,
        control: control == null ? null : Object.freeze({ ...control }),
    });
}

const TWO_TERMINAL = Object.freeze([Object.freeze(['positive', 'negative'])]);
const AB_TERMINAL = Object.freeze([Object.freeze(['a', 'b'])]);

export const ELECTRICAL_COMPONENT_DEFINITIONS = Object.freeze({
    'gpio.pin': defineKind('gpio.pin', {
        requiredPorts: ['signal', 'vcc', 'ground'],
        islandGroups: [['signal', 'vcc', 'ground']],
        parameters: {
            outputResistanceOhms: positive(true),
            pullupResistanceOhms: positive(true),
            inputConductanceSiemens: positive(true),
        },
    }),
    reference: defineKind('reference', {
        requiredPorts: ['terminal'],
        islandGroups: [['terminal']],
    }),
    wire: defineKind('wire', {
        requiredPorts: ['a', 'b'],
        idealUnion: true,
    }),
    junction: defineKind('junction', {
        variablePorts: true,
        minimumPorts: 2,
        maximumPorts: ELECTRICAL_LIMITS.maximumPortsPerComponent,
        idealUnion: true,
    }),
    resistor: defineKind('resistor', {
        requiredPorts: ['positive', 'negative'],
        islandGroups: TWO_TERMINAL,
        parameters: {
            resistanceOhms: positive(false),
            referenceTemperatureKelvin: positive(false, 100_000),
            temperatureCoefficientPerKelvin: finite(false, 1_000),
        },
    }),
    capacitor: defineKind('capacitor', {
        requiredPorts: ['positive', 'negative'],
        islandGroups: TWO_TERMINAL,
        parameters: {
            capacitanceFarads: positive(true),
            initialVoltageVolts: finite(),
        },
    }),
    inductor: defineKind('inductor', {
        requiredPorts: ['positive', 'negative'],
        islandGroups: TWO_TERMINAL,
        branchUnknowns: ['current'],
        parameters: {
            inductanceHenries: positive(true),
            seriesResistanceOhms: nonNegative(),
            initialCurrentAmps: finite(),
        },
    }),
    'coupled-inductors': defineKind('coupled-inductors', {
        requiredPorts: ['primaryPositive', 'primaryNegative', 'secondaryPositive', 'secondaryNegative'],
        islandGroups: [
            ['primaryPositive', 'primaryNegative'],
            ['secondaryPositive', 'secondaryNegative'],
        ],
        branchUnknowns: ['primaryCurrent', 'secondaryCurrent'],
        parameters: {
            primaryInductanceHenries: positive(true),
            secondaryInductanceHenries: positive(true),
            couplingCoefficient: numberRule({ required: true, minimum: -1, maximum: 1 }),
            primarySeriesResistanceOhms: nonNegative(),
            secondarySeriesResistanceOhms: nonNegative(),
            primaryInitialCurrentAmps: finite(),
            secondaryInitialCurrentAmps: finite(),
        },
    }),
    transformer: defineKind('transformer', {
        requiredPorts: ['primaryPositive', 'primaryNegative', 'secondaryPositive', 'secondaryNegative'],
        islandGroups: [
            ['primaryPositive', 'primaryNegative'],
            ['secondaryPositive', 'secondaryNegative'],
        ],
        branchUnknowns: ['primaryCurrent', 'secondaryCurrent'],
        parameters: {
            turnsRatio: numberRule({ required: true, minimum: -MAX, maximum: MAX, nonZero: true }),
            magnetizingInductanceHenries: positive(false),
            primaryResistanceOhms: nonNegative(),
            secondaryResistanceOhms: nonNegative(),
        },
    }),
    'voltage-source.dc': defineKind('voltage-source.dc', {
        requiredPorts: ['positive', 'negative'],
        islandGroups: TWO_TERMINAL,
        branchUnknowns: ['current'],
        parameters: {
            voltageVolts: finite(true),
            seriesResistanceOhms: nonNegative(),
        },
    }),
    'voltage-source.pulse': defineKind('voltage-source.pulse', {
        requiredPorts: ['positive', 'negative'],
        islandGroups: TWO_TERMINAL,
        branchUnknowns: ['current'],
        parameters: {
            lowVolts: finite(true),
            highVolts: finite(true),
            delaySeconds: nonNegative(),
            riseSeconds: nonNegative(),
            fallSeconds: nonNegative(),
            pulseWidthSeconds: positive(true),
            periodSeconds: positive(true),
        },
    }),
    'voltage-source.sine': defineKind('voltage-source.sine', {
        requiredPorts: ['positive', 'negative'],
        islandGroups: TWO_TERMINAL,
        branchUnknowns: ['current'],
        parameters: {
            offsetVolts: finite(true),
            amplitudeVolts: finite(true),
            frequencyHz: positive(true, ELECTRICAL_LIMITS.maximumFrequencyHz),
            phaseDegrees: finite(),
            delaySeconds: nonNegative(),
        },
    }),
    'current-source.dc': defineKind('current-source.dc', {
        requiredPorts: ['positive', 'negative'],
        islandGroups: TWO_TERMINAL,
        parameters: {
            currentAmps: finite(true),
        },
    }),
    'current-source.pulse': defineKind('current-source.pulse', {
        requiredPorts: ['positive', 'negative'],
        islandGroups: TWO_TERMINAL,
        parameters: {
            lowAmps: finite(true),
            highAmps: finite(true),
            delaySeconds: nonNegative(),
            riseSeconds: nonNegative(),
            fallSeconds: nonNegative(),
            pulseWidthSeconds: positive(true),
            periodSeconds: positive(true),
        },
    }),
    'current-source.sine': defineKind('current-source.sine', {
        requiredPorts: ['positive', 'negative'],
        islandGroups: TWO_TERMINAL,
        parameters: {
            offsetAmps: finite(true),
            amplitudeAmps: finite(true),
            frequencyHz: positive(true, ELECTRICAL_LIMITS.maximumFrequencyHz),
            phaseDegrees: finite(),
            delaySeconds: nonNegative(),
        },
    }),
    'dependent-source.vcvs': defineKind('dependent-source.vcvs', {
        requiredPorts: ['outputPositive', 'outputNegative', 'controlPositive', 'controlNegative'],
        islandGroups: [
            ['outputPositive', 'outputNegative'],
            ['controlPositive', 'controlNegative'],
        ],
        branchUnknowns: ['outputCurrent'],
        parameters: {
            voltageGain: finite(true),
        },
        control: { mode: 'voltage-ports' },
    }),
    'dependent-source.vccs': defineKind('dependent-source.vccs', {
        requiredPorts: ['outputPositive', 'outputNegative', 'controlPositive', 'controlNegative'],
        islandGroups: [
            ['outputPositive', 'outputNegative'],
            ['controlPositive', 'controlNegative'],
        ],
        parameters: {
            transconductanceSiemens: finite(true),
        },
        control: { mode: 'voltage-ports' },
    }),
    'dependent-source.ccvs': defineKind('dependent-source.ccvs', {
        requiredPorts: ['outputPositive', 'outputNegative'],
        islandGroups: [['outputPositive', 'outputNegative']],
        branchUnknowns: ['outputCurrent'],
        parameters: {
            controlComponentId: identifierRule({ required: true }),
            controlBranch: identifierRule(),
            transresistanceOhms: finite(true),
        },
        control: { mode: 'branch-current' },
    }),
    'dependent-source.cccs': defineKind('dependent-source.cccs', {
        requiredPorts: ['outputPositive', 'outputNegative'],
        islandGroups: [['outputPositive', 'outputNegative']],
        parameters: {
            controlComponentId: identifierRule({ required: true }),
            controlBranch: identifierRule(),
            currentGain: finite(true),
        },
        control: { mode: 'branch-current' },
    }),
    'supply.dc': defineKind('supply.dc', {
        requiredPorts: ['positive', 'negative'],
        islandGroups: TWO_TERMINAL,
        branchUnknowns: ['current'],
        parameters: {
            openCircuitVoltageVolts: finite(true),
            internalResistanceOhms: nonNegative(true),
            currentLimitAmps: positive(true),
            brownoutVoltageVolts: nonNegative(true),
            regenerationPolicy: enumRule(['reject', 'clamp', 'accept'], { required: true }),
        },
    }),
    'diode.piecewise-linear': defineKind('diode.piecewise-linear', {
        requiredPorts: ['anode', 'cathode'],
        islandGroups: [['anode', 'cathode']],
        parameters: {
            forwardVoltageVolts: nonNegative(true),
            onResistanceOhms: positive(true),
            offConductanceSiemens: nonNegative(true),
            reverseClampVolts: nonNegative(),
        },
    }),
    'switch.spst': defineKind('switch.spst', {
        requiredPorts: ['a', 'b'],
        islandGroups: AB_TERMINAL,
        parameters: {
            controlId: identifierRule(),
            initialClosed: booleanRule(),
            onResistanceOhms: positive(true),
            offConductanceSiemens: nonNegative(true),
        },
    }),
    'switch.spdt': defineKind('switch.spdt', {
        requiredPorts: ['common', 'normallyOpen', 'normallyClosed'],
        islandGroups: [['common', 'normallyOpen', 'normallyClosed']],
        parameters: {
            controlId: identifierRule(),
            initialThrow: enumRule(['normally-open', 'normally-closed'], { required: true }),
            onResistanceOhms: positive(true),
            offConductanceSiemens: nonNegative(true),
        },
    }),
    relay: defineKind('relay', {
        requiredPorts: ['coilPositive', 'coilNegative', 'common', 'normallyOpen', 'normallyClosed'],
        islandGroups: [
            ['coilPositive', 'coilNegative'],
            ['common', 'normallyOpen', 'normallyClosed'],
        ],
        branchUnknowns: ['coilCurrent'],
        parameters: {
            coilResistanceOhms: positive(true),
            coilInductanceHenries: positive(true),
            pickupCurrentAmps: nonNegative(true),
            dropoutCurrentAmps: nonNegative(true),
            contactResistanceOhms: positive(true),
            offConductanceSiemens: nonNegative(true),
            initialEnergized: booleanRule(),
        },
    }),
    mosfet: defineKind('mosfet', {
        requiredPorts: ['drain', 'gate', 'source'],
        islandGroups: [['drain', 'gate', 'source']],
        parameters: {
            channel: enumRule(['n', 'p'], { required: true }),
            thresholdVolts: nonNegative(true),
            transconductanceSiemens: positive(true),
            onResistanceOhms: positive(true),
            offConductanceSiemens: nonNegative(true),
        },
    }),
    'switch.pwm': defineKind('switch.pwm', {
        requiredPorts: ['input', 'output', 'return'],
        // `return` is the authored control reference, not a hidden electrical
        // path between the power terminals and the control domain.
        islandGroups: [['input', 'output'], ['return']],
        parameters: {
            controlId: identifierRule(),
            dutyCycle: numberRule({ required: true, minimum: 0, maximum: 1 }),
            frequencyHz: positive(true, ELECTRICAL_LIMITS.maximumFrequencyHz),
            onResistanceOhms: positive(true),
            offConductanceSiemens: nonNegative(true),
        },
    }),
    fuse: defineKind('fuse', {
        requiredPorts: ['a', 'b'],
        islandGroups: AB_TERMINAL,
        parameters: {
            ratedCurrentAmps: positive(true),
            tripI2tAmpSquaredSeconds: positive(true),
            onResistanceOhms: positive(true),
            initialOpen: booleanRule(),
        },
    }),
    breaker: defineKind('breaker', {
        requiredPorts: ['a', 'b'],
        islandGroups: AB_TERMINAL,
        parameters: {
            ratedCurrentAmps: positive(true),
            tripI2tAmpSquaredSeconds: positive(true),
            resetI2tAmpSquaredSeconds: nonNegative(true),
            hysteresisAmps: nonNegative(true),
            onResistanceOhms: positive(true),
            initialOpen: booleanRule(),
            heatingModel: enumRule(['absolute-i2t', 'excess-i2t']),
            instantaneousTripCurrentAmps: positive(false),
            thermalTimeConstantSeconds: positive(false),
        },
    }),
    'probe.voltage': defineKind('probe.voltage', {
        requiredPorts: ['positive', 'negative'],
        islandGroups: [['positive'], ['negative']],
    }),
    'probe.current': defineKind('probe.current', {
        requiredPorts: ['positive', 'negative'],
        islandGroups: TWO_TERMINAL,
        branchUnknowns: ['current'],
    }),
    'probe.power': defineKind('probe.power', {
        requiredPorts: ['currentPositive', 'currentNegative', 'voltagePositive', 'voltageNegative'],
        islandGroups: [['currentPositive', 'currentNegative'], ['voltagePositive'], ['voltageNegative']],
        branchUnknowns: ['current'],
    }),
    'probe.temperature': defineKind('probe.temperature', {
        parameters: {
            componentId: identifierRule({ required: true }),
        },
    }),
    'motor.dc': defineKind('motor.dc', {
        requiredPorts: ['positive', 'negative'],
        islandGroups: TWO_TERMINAL,
        branchUnknowns: ['current'],
        requiresActuatorRef: true,
        parameters: {
            resistanceOhms: positive(true),
            inductanceHenries: positive(true),
            torqueConstantNewtonMetersPerAmp: positive(true),
            backEmfVoltsPerRadianPerSecond: positive(true),
            viscousFrictionNewtonMeterSeconds: nonNegative(),
            coulombFrictionNewtonMeters: nonNegative(),
            initialCurrentAmps: finite(),
        },
    }),
    'motor.linear': defineKind('motor.linear', {
        requiredPorts: ['positive', 'negative'],
        islandGroups: TWO_TERMINAL,
        branchUnknowns: ['current'],
        requiresActuatorRef: true,
        parameters: {
            resistanceOhms: positive(true),
            inductanceHenries: positive(true),
            forceConstantNewtonsPerAmp: positive(true),
            backEmfVoltsPerMeterPerSecond: positive(true),
            initialCurrentAmps: finite(),
        },
    }),
    'voice-coil': defineKind('voice-coil', {
        requiredPorts: ['positive', 'negative'],
        islandGroups: TWO_TERMINAL,
        branchUnknowns: ['current'],
        requiresActuatorRef: true,
        parameters: {
            resistanceOhms: positive(true),
            inductanceHenries: positive(true),
            forceConstantNewtonsPerAmp: positive(true),
            backEmfVoltsPerMeterPerSecond: positive(true),
            initialCurrentAmps: finite(),
        },
    }),
    'solenoid.variable-inductance': defineKind('solenoid.variable-inductance', {
        requiredPorts: ['positive', 'negative'],
        islandGroups: TWO_TERMINAL,
        branchUnknowns: ['current'],
        requiresActuatorRef: true,
        parameters: {
            resistanceOhms: positive(true),
            minimumInductanceHenries: positive(true),
            maximumInductanceHenries: positive(true),
            initialCurrentAmps: finite(),
        },
    }),
});

export const ELECTRICAL_COMPONENT_KINDS = Object.freeze(
    Object.keys(ELECTRICAL_COMPONENT_DEFINITIONS).sort(),
);

export class ElectricalContractError extends Error {
    constructor(code, path, message, details = null) {
        super(path + ': ' + message);
        this.name = 'ElectricalContractError';
        this.code = String(code || 'ELECTRICAL_CONTRACT');
        this.path = String(path || '$');
        this.details = details == null ? null : freezeTree(clonePlain(details, '$.error.details'));
    }
}

function fail(code, path, message, details = null) {
    throw new ElectricalContractError(code, path, message, details);
}

function rethrowWithStableIdentity(error, identity) {
    if (error instanceof ElectricalContractError && identity != null) {
        error.details = freezeTree({
            ...(error.details == null ? {} : clonePlain(error.details, '$.error.details')),
            ...identity,
        });
    }
    throw error;
}

function requireRecord(value, path) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        fail('ELECTRICAL_CONTRACT_RECORD', path, 'must be an object');
    }
    return value;
}

function exactKeys(value, allowed, path) {
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) {
            fail('ELECTRICAL_CONTRACT_UNKNOWN_FIELD', path + '.' + key, 'is not allowed');
        }
    }
}

export function requireElectricalIdentifier(value, path = '$.id') {
    if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
        fail(
            'ELECTRICAL_CONTRACT_IDENTIFIER',
            path,
            'must match ' + IDENTIFIER_PATTERN,
        );
    }
    return value;
}

function requirePortName(value, path) {
    if (typeof value !== 'string' || !PORT_NAME_PATTERN.test(value)) {
        fail('ELECTRICAL_CONTRACT_PORT_NAME', path, 'must match ' + PORT_NAME_PATTERN);
    }
    return value;
}

function requireArray(value, path, maximum, { minimum = 0 } = {}) {
    if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
        fail(
            'ELECTRICAL_CONTRACT_ARRAY',
            path,
            'must be an array with length in [' + minimum + ', ' + maximum + ']',
        );
    }
    return value;
}

function requireUniqueIdentifiers(value, path, maximum, options = {}) {
    const result = [];
    const seen = new Set();
    for (const [index, entry] of requireArray(value, path, maximum, options).entries()) {
        const id = requireElectricalIdentifier(entry, path + '[' + index + ']');
        if (seen.has(id)) {
            fail('ELECTRICAL_CONTRACT_DUPLICATE', path + '[' + index + ']', 'duplicates ' + id);
        }
        seen.add(id);
        result.push(id);
    }
    return result.sort();
}

function normalizeParameters(value, definition, path) {
    const source = requireRecord(value, path);
    const allowed = new Set(Object.keys(definition.parameters));
    exactKeys(source, allowed, path);
    const normalized = {};
    for (const key of [...allowed].sort()) {
        const rule = definition.parameters[key];
        if (!Object.hasOwn(source, key)) {
            if (rule.required) {
                fail('ELECTRICAL_CONTRACT_REQUIRED_PARAMETER', path + '.' + key, 'is required');
            }
            continue;
        }
        const entry = source[key];
        if (rule.type === 'number') {
            if (typeof entry !== 'number' || !Number.isFinite(entry) ||
                entry < rule.minimum || entry > rule.maximum ||
                (rule.exclusiveMinimum && entry === rule.minimum) ||
                (rule.integer && !Number.isSafeInteger(entry)) ||
                (rule.nonZero && entry === 0)) {
                fail(
                    'ELECTRICAL_CONTRACT_NUMBER',
                    path + '.' + key,
                    'must be a finite' + (rule.integer ? ' integer' : ' number') +
                    ' in the declared bounds',
                );
            }
            normalized[key] = entry;
        } else if (rule.type === 'boolean') {
            if (typeof entry !== 'boolean') {
                fail('ELECTRICAL_CONTRACT_BOOLEAN', path + '.' + key, 'must be boolean');
            }
            normalized[key] = entry;
        } else if (rule.type === 'identifier') {
            normalized[key] = requireElectricalIdentifier(entry, path + '.' + key);
        } else if (rule.type === 'enum') {
            if (typeof entry !== 'string' || !rule.values.includes(entry)) {
                fail(
                    'ELECTRICAL_CONTRACT_ENUM',
                    path + '.' + key,
                    'must be one of ' + rule.values.join(', '),
                );
            }
            normalized[key] = entry;
        } else {
            fail('ELECTRICAL_CONTRACT_RULE', path + '.' + key, 'has an unsupported validation rule');
        }
    }
    if ((definition.kind === 'voltage-source.pulse' ||
        definition.kind === 'current-source.pulse') &&
        normalized.pulseWidthSeconds > normalized.periodSeconds) {
        fail(
            'ELECTRICAL_CONTRACT_PULSE_TIMING',
            path + '.pulseWidthSeconds',
            'must not exceed periodSeconds',
        );
    }
    if (definition.kind === 'relay' &&
        normalized.dropoutCurrentAmps > normalized.pickupCurrentAmps) {
        fail(
            'ELECTRICAL_CONTRACT_RELAY_THRESHOLDS',
            path + '.dropoutCurrentAmps',
            'must not exceed pickupCurrentAmps',
        );
    }
    if (definition.kind === 'supply.dc' &&
        normalized.brownoutVoltageVolts > Math.abs(normalized.openCircuitVoltageVolts)) {
        fail(
            'ELECTRICAL_CONTRACT_BROWNOUT',
            path + '.brownoutVoltageVolts',
            'must not exceed the magnitude of openCircuitVoltageVolts',
        );
    }
    if (definition.kind === 'breaker' &&
        normalized.resetI2tAmpSquaredSeconds > normalized.tripI2tAmpSquaredSeconds) {
        fail(
            'ELECTRICAL_CONTRACT_BREAKER_THRESHOLDS',
            path + '.resetI2tAmpSquaredSeconds',
            'must not exceed tripI2tAmpSquaredSeconds',
        );
    }
    if (definition.kind === 'breaker' && normalized.instantaneousTripCurrentAmps != null &&
        normalized.instantaneousTripCurrentAmps <= normalized.ratedCurrentAmps) {
        fail(
            'ELECTRICAL_CONTRACT_BREAKER_THRESHOLDS',
            path + '.instantaneousTripCurrentAmps',
            'must exceed ratedCurrentAmps',
        );
    }
    if (definition.kind === 'solenoid.variable-inductance' &&
        normalized.maximumInductanceHenries < normalized.minimumInductanceHenries) {
        fail(
            'ELECTRICAL_CONTRACT_SOLENOID_INDUCTANCE',
            path + '.maximumInductanceHenries',
            'must be at least minimumInductanceHenries',
        );
    }
    return freezeTree(normalized);
}

function normalizePorts(value, componentId, definition, path) {
    const source = requireRecord(value, path);
    const names = Object.keys(source);
    if (names.length < definition.minimumPorts || names.length > definition.maximumPorts) {
        fail(
            'ELECTRICAL_CONTRACT_PORT_COUNT',
            path,
            'must contain between ' + definition.minimumPorts + ' and ' +
            definition.maximumPorts + ' ports for ' + definition.kind,
        );
    }
    const required = new Set(definition.requiredPorts);
    const allowed = new Set([...definition.requiredPorts, ...definition.optionalPorts]);
    if (!definition.variablePorts) exactKeys(source, allowed, path);
    for (const name of required) {
        if (!Object.hasOwn(source, name)) {
            fail('ELECTRICAL_CONTRACT_REQUIRED_PORT', path + '.' + name, 'is required');
        }
    }
    const normalized = {};
    const seenTerminalRefs = new Set();
    for (const name of names.sort()) {
        requirePortName(name, path + '.' + name);
        const expected = componentId + '.' + name;
        const terminalRef = requireElectricalIdentifier(source[name], path + '.' + name);
        if (terminalRef !== expected) {
            fail(
                'ELECTRICAL_CONTRACT_TERMINAL_REF',
                path + '.' + name,
                'must equal the canonical terminal reference ' + expected,
            );
        }
        if (seenTerminalRefs.has(terminalRef)) {
            fail('ELECTRICAL_CONTRACT_DUPLICATE_TERMINAL', path + '.' + name, 'duplicates ' + terminalRef);
        }
        seenTerminalRefs.add(terminalRef);
        normalized[name] = terminalRef;
    }
    return freezeTree(normalized);
}

function normalizeComponent(value, path) {
    const source = requireRecord(value, path);
    const componentId = typeof source.id === 'string' && IDENTIFIER_PATTERN.test(source.id)
        ? source.id
        : null;
    try {
        exactKeys(source, COMPONENT_KEYS, path);
        const id = requireElectricalIdentifier(source.id, path + '.id');
        const kind = requireElectricalIdentifier(source.kind, path + '.kind');
        const definition = ELECTRICAL_COMPONENT_DEFINITIONS[kind];
        if (!definition) {
            fail('ELECTRICAL_CONTRACT_COMPONENT_KIND', path + '.kind', 'is unsupported');
        }
        if (!Object.hasOwn(source, 'ports')) {
            fail('ELECTRICAL_CONTRACT_REQUIRED_FIELD', path + '.ports', 'is required');
        }
        if (!Object.hasOwn(source, 'parameters')) {
            fail('ELECTRICAL_CONTRACT_REQUIRED_FIELD', path + '.parameters', 'is required');
        }
        const materialRef = source.materialRef == null
            ? null
            : requireElectricalIdentifier(source.materialRef, path + '.materialRef');
        const actuatorRef = source.actuatorRef == null
            ? null
            : requireElectricalIdentifier(source.actuatorRef, path + '.actuatorRef');
        if (definition.requiresActuatorRef && actuatorRef == null) {
            fail('ELECTRICAL_CONTRACT_ACTUATOR_REF', path + '.actuatorRef', 'is required for ' + kind);
        }
        const component = {
            id,
            kind,
            ports: normalizePorts(source.ports, id, definition, path + '.ports'),
            parameters: normalizeParameters(source.parameters, definition, path + '.parameters'),
        };
        if (materialRef != null) component.materialRef = materialRef;
        if (actuatorRef != null) component.actuatorRef = actuatorRef;
        return freezeTree(component);
    } catch (error) {
        rethrowWithStableIdentity(error, componentId == null ? null : { componentId });
    }
}

function normalizeNet(value, path) {
    const source = requireRecord(value, path);
    const netId = typeof source.id === 'string' && IDENTIFIER_PATTERN.test(source.id)
        ? source.id
        : null;
    try {
        exactKeys(source, NET_KEYS, path);
        const id = requireElectricalIdentifier(source.id, path + '.id');
        return freezeTree({
            id,
            terminalRefs: requireUniqueIdentifiers(
                source.terminalRefs,
                path + '.terminalRefs',
                ELECTRICAL_LIMITS.maximumTerminals,
                { minimum: 1 },
            ),
        });
    } catch (error) {
        rethrowWithStableIdentity(error, netId == null ? null : { netId });
    }
}

function normalizeSettings(value, path) {
    const source = requireRecord(value, path);
    exactKeys(source, SETTINGS_KEYS, path);
    if (!Object.hasOwn(source, 'mechanicalHz') ||
        !Object.hasOwn(source, 'electricalSubsteps')) {
        fail('ELECTRICAL_CONTRACT_SETTINGS', path, 'requires mechanicalHz and electricalSubsteps');
    }
    const mechanicalHz = source.mechanicalHz;
    const electricalSubsteps = source.electricalSubsteps;
    if (typeof mechanicalHz !== 'number' || !Number.isFinite(mechanicalHz) ||
        mechanicalHz <= 0 || mechanicalHz > ELECTRICAL_LIMITS.maximumMechanicalHz) {
        fail('ELECTRICAL_CONTRACT_MECHANICAL_HZ', path + '.mechanicalHz', 'is outside the supported finite range');
    }
    if (!Number.isSafeInteger(electricalSubsteps) || electricalSubsteps < 1 ||
        electricalSubsteps > ELECTRICAL_LIMITS.maximumElectricalSubsteps) {
        fail(
            'ELECTRICAL_CONTRACT_ELECTRICAL_SUBSTEPS',
            path + '.electricalSubsteps',
            'must be a supported positive safe integer',
        );
    }
    return Object.freeze({ mechanicalHz, electricalSubsteps });
}

/**
 * Validate and canonicalize the strict actuator-grade circuit document.
 *
 * Component ports use canonical terminal references of the form
 * componentId.portName. Nets own those references; ideal wire and junction
 * components may subsequently union authored nets during compilation.
 */
export function normalizeElectricalCircuitDocument(value, { path = '$.circuit' } = {}) {
    const source = requireRecord(value, path);
    exactKeys(source, TOP_LEVEL_KEYS, path);
    if (source.schema !== ELECTRICAL_CIRCUIT_SCHEMA) {
        fail('ELECTRICAL_CONTRACT_SCHEMA', path + '.schema', 'is unsupported');
    }
    if (source.version !== ELECTRICAL_CIRCUIT_VERSION) {
        fail('ELECTRICAL_CONTRACT_VERSION', path + '.version', 'is unsupported');
    }
    const id = requireElectricalIdentifier(source.id, path + '.id');
    const nets = requireArray(
        source.nets,
        path + '.nets',
        ELECTRICAL_LIMITS.maximumNets,
        { minimum: 1 },
    ).map((entry, index) => normalizeNet(entry, path + '.nets[' + index + ']'));
    const components = requireArray(
        source.components,
        path + '.components',
        ELECTRICAL_LIMITS.maximumComponents,
        { minimum: 1 },
    ).map((entry, index) => normalizeComponent(entry, path + '.components[' + index + ']'));
    const netIds = new Set();
    for (const [index, net] of nets.entries()) {
        if (netIds.has(net.id)) {
            fail('ELECTRICAL_CONTRACT_DUPLICATE_NET', path + '.nets[' + index + '].id', 'duplicates ' + net.id);
        }
        netIds.add(net.id);
    }
    const componentIds = new Set();
    let terminalCount = 0;
    const terminalRefs = new Set();
    for (const [index, component] of components.entries()) {
        if (componentIds.has(component.id)) {
            fail(
                'ELECTRICAL_CONTRACT_DUPLICATE_COMPONENT',
                path + '.components[' + index + '].id',
                'duplicates ' + component.id,
            );
        }
        componentIds.add(component.id);
        for (const terminalRef of Object.values(component.ports)) {
            terminalCount += 1;
            if (terminalCount > ELECTRICAL_LIMITS.maximumTerminals) {
                fail('ELECTRICAL_CONTRACT_TERMINAL_LIMIT', path + '.components', 'exceeds terminal limit');
            }
            if (terminalRefs.has(terminalRef)) {
                fail(
                    'ELECTRICAL_CONTRACT_DUPLICATE_TERMINAL',
                    path + '.components[' + index + '].ports',
                    'duplicates ' + terminalRef,
                );
            }
            terminalRefs.add(terminalRef);
        }
    }
    const referenceNets = requireUniqueIdentifiers(
        source.referenceNets,
        path + '.referenceNets',
        ELECTRICAL_LIMITS.maximumNets,
        { minimum: 1 },
    );
    for (const [index, netId] of referenceNets.entries()) {
        if (!netIds.has(netId)) {
            fail(
                'ELECTRICAL_CONTRACT_REFERENCE_NET',
                path + '.referenceNets[' + index + ']',
                'does not name a declared net',
            );
        }
    }
    const probes = requireUniqueIdentifiers(
        source.probes,
        path + '.probes',
        ELECTRICAL_LIMITS.maximumProbes,
    );
    const componentById = new Map(components.map((component) => [component.id, component]));
    for (const [index, probeId] of probes.entries()) {
        const probe = componentById.get(probeId);
        if (!probe || !probe.kind.startsWith('probe.')) {
            fail(
                'ELECTRICAL_CONTRACT_PROBE',
                path + '.probes[' + index + ']',
                'must name a declared probe component',
            );
        }
    }
    return freezeTree({
        schema: ELECTRICAL_CIRCUIT_SCHEMA,
        version: ELECTRICAL_CIRCUIT_VERSION,
        id,
        referenceNets,
        nets: nets.sort(compareId),
        components: components.sort(compareId),
        probes,
        settings: normalizeSettings(source.settings, path + '.settings'),
    });
}

export function validateElectricalCircuitDocument(value, options = {}) {
    normalizeElectricalCircuitDocument(value, options);
    return true;
}

export function isElectricalCircuitDocument(value) {
    try {
        normalizeElectricalCircuitDocument(value);
        return true;
    } catch {
        return false;
    }
}

function compareId(left, right) {
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function clonePlain(value, path) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) fail('ELECTRICAL_CONTRACT_NONFINITE', path, 'must be finite');
        return value;
    }
    if (Array.isArray(value)) return value.map((entry, index) => clonePlain(entry, path + '[' + index + ']'));
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [
            key,
            clonePlain(value[key], path + '.' + key),
        ]));
    }
    fail('ELECTRICAL_CONTRACT_JSON', path, 'must contain plain JSON-compatible values');
}

function freezeTree(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) freezeTree(child);
    return Object.freeze(value);
}

export default normalizeElectricalCircuitDocument;
