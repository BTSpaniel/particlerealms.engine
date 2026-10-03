// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const ELECTRICAL_ENERGY_LEDGER_SCHEMA = 'engine.electrical.energy-ledger';
export const ELECTRICAL_ENERGY_LEDGER_VERSION = '1.0.0';

const ENERGY_FIELDS = Object.freeze([
    'sourceEnergyJoules',
    'resistiveLossJoules',
    'capacitiveEnergyJoules',
    'magneticEnergyJoules',
    'mechanicalWorkJoules',
    'thermalGainJoules',
    'thermalLossJoules',
    'regeneratedEnergyJoules',
    'numericalResidualJoules',
]);

function finite(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new RangeError(label + ' must be finite');
    }
    return value;
}

function valuesFrom(source = {}) {
    return Object.fromEntries(ENERGY_FIELDS.map((field) => [
        field,
        finite(source[field] ?? 0, field),
    ]));
}

export function createElectricalEnergyLedger(initial = {}) {
    return {
        schema: ELECTRICAL_ENERGY_LEDGER_SCHEMA,
        version: ELECTRICAL_ENERGY_LEDGER_VERSION,
        stepCount: 0,
        totals: valuesFrom(initial.totals),
        lastStep: valuesFrom(initial.lastStep),
    };
}

export function advanceElectricalEnergyLedger(previous, delta) {
    if (previous?.schema !== ELECTRICAL_ENERGY_LEDGER_SCHEMA ||
        previous?.version !== ELECTRICAL_ENERGY_LEDGER_VERSION) {
        throw new TypeError('A valid electrical energy ledger is required');
    }
    const lastStep = valuesFrom(delta);
    const totals = {};
    for (const field of ENERGY_FIELDS) {
        totals[field] = finite(previous.totals[field] + lastStep[field], 'total ' + field);
    }
    return {
        schema: ELECTRICAL_ENERGY_LEDGER_SCHEMA,
        version: ELECTRICAL_ENERGY_LEDGER_VERSION,
        stepCount: previous.stepCount + 1,
        totals,
        lastStep,
    };
}

export function snapshotElectricalEnergyLedger(ledger) {
    if (ledger?.schema !== ELECTRICAL_ENERGY_LEDGER_SCHEMA ||
        ledger?.version !== ELECTRICAL_ENERGY_LEDGER_VERSION ||
        !Number.isSafeInteger(ledger.stepCount) || ledger.stepCount < 0) {
        throw new TypeError('Electrical energy ledger is invalid');
    }
    return Object.freeze({
        schema: ledger.schema,
        version: ledger.version,
        stepCount: ledger.stepCount,
        totals: Object.freeze(valuesFrom(ledger.totals)),
        lastStep: Object.freeze(valuesFrom(ledger.lastStep)),
    });
}

export function restoreElectricalEnergyLedger(snapshot) {
    const frozen = snapshotElectricalEnergyLedger(snapshot);
    return {
        schema: frozen.schema,
        version: frozen.version,
        stepCount: frozen.stepCount,
        totals: { ...frozen.totals },
        lastStep: { ...frozen.lastStep },
    };
}

export function calculateElectricalEnergyResidual({
    sourceEnergyJoules = 0,
    resistiveLossJoules = 0,
    storedEnergyChangeJoules = 0,
    mechanicalWorkJoules = 0,
} = {}) {
    // sourceEnergyJoules is signed: regeneration is already represented as
    // negative source energy. regeneratedEnergyJoules is a positive telemetry
    // magnitude and must not be counted a second time. Thermal loss is also a
    // downstream flow of heat already accounted for by resistive conversion,
    // so it is reported separately rather than subtracted from this electrical
    // domain balance.
    return finite(sourceEnergyJoules, 'sourceEnergyJoules') -
        finite(resistiveLossJoules, 'resistiveLossJoules') -
        finite(storedEnergyChangeJoules, 'storedEnergyChangeJoules') -
        finite(mechanicalWorkJoules, 'mechanicalWorkJoules');
}

export { ENERGY_FIELDS as ELECTRICAL_ENERGY_FIELDS };

export default createElectricalEnergyLedger;
