// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const DEFAULT_AMBIENT_TEMPERATURE_K = 293.15;

const OVERRIDE_KEYS = new Set([
    'resistanceOhms',
    'temperatureCoefficientPerK',
    'referenceTemperatureK',
    'thermalCapacityJPerK',
    'thermalResistanceKPerW',
    'ambientTemperatureK',
    'warnTemperatureK',
    'deratingStartTemperatureK',
    'shutdownTemperatureK',
    'resetHysteresisK',
]);

function finite(value, label, minimum = -Number.MAX_VALUE) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
        throw new RangeError(label + ' must be finite and at least ' + minimum);
    }
    return value;
}

function optionalFinite(value, label, minimum = -Number.MAX_VALUE) {
    return value == null ? null : finite(value, label, minimum);
}

function plainRecord(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype) {
        throw new TypeError(label + ' must be a plain object');
    }
    return value;
}

export function normalizeElectricalComponentOverrides(value = {}) {
    const source = plainRecord(value, 'componentOverrides');
    const normalized = {};
    for (const componentId of Object.keys(source).sort()) {
        const raw = plainRecord(source[componentId], 'componentOverrides.' + componentId);
        for (const key of Object.keys(raw)) {
            if (!OVERRIDE_KEYS.has(key)) {
                throw new RangeError('componentOverrides.' + componentId + '.' + key + ' is unsupported');
            }
        }
        const override = {};
        const positiveKeys = [
            'resistanceOhms',
            'referenceTemperatureK',
            'thermalCapacityJPerK',
            'thermalResistanceKPerW',
            'ambientTemperatureK',
            'warnTemperatureK',
            'deratingStartTemperatureK',
            'shutdownTemperatureK',
        ];
        for (const key of positiveKeys) {
            if (Object.hasOwn(raw, key)) override[key] = finite(raw[key], componentId + '.' + key, Number.MIN_VALUE);
        }
        if (Object.hasOwn(raw, 'temperatureCoefficientPerK')) {
            override.temperatureCoefficientPerK = finite(
                raw.temperatureCoefficientPerK,
                componentId + '.temperatureCoefficientPerK',
            );
        }
        if (Object.hasOwn(raw, 'resetHysteresisK')) {
            override.resetHysteresisK = finite(raw.resetHysteresisK, componentId + '.resetHysteresisK', 0);
        }
        const hasCapacity = Object.hasOwn(override, 'thermalCapacityJPerK');
        const hasResistance = Object.hasOwn(override, 'thermalResistanceKPerW');
        if (hasCapacity !== hasResistance) {
            throw new RangeError(componentId + ' thermal capacity and resistance must be supplied together');
        }
        if (override.deratingStartTemperatureK != null && override.shutdownTemperatureK == null) {
            throw new RangeError(componentId + ' derating requires shutdownTemperatureK');
        }
        if (override.deratingStartTemperatureK != null &&
            override.deratingStartTemperatureK >= override.shutdownTemperatureK) {
            throw new RangeError(componentId + ' deratingStartTemperatureK must be below shutdownTemperatureK');
        }
        if (override.warnTemperatureK != null && override.shutdownTemperatureK != null &&
            override.warnTemperatureK > override.shutdownTemperatureK) {
            throw new RangeError(componentId + ' warnTemperatureK must not exceed shutdownTemperatureK');
        }
        if (override.warnTemperatureK != null && override.deratingStartTemperatureK != null &&
            override.warnTemperatureK > override.deratingStartTemperatureK) {
            throw new RangeError(componentId + ' warnTemperatureK must not exceed deratingStartTemperatureK');
        }
        const ambient = override.ambientTemperatureK ?? override.referenceTemperatureK;
        if (ambient != null && override.shutdownTemperatureK != null &&
            ambient >= override.shutdownTemperatureK) {
            throw new RangeError(componentId + ' ambientTemperatureK must be below shutdownTemperatureK');
        }
        if (override.resetHysteresisK != null && override.shutdownTemperatureK != null) {
            const recoveryTemperature = override.shutdownTemperatureK - override.resetHysteresisK;
            if (!(recoveryTemperature > 0) || (ambient != null && recoveryTemperature <= ambient)) {
                throw new RangeError(
                    componentId + ' reset hysteresis must leave recoveryTemperatureK above ambientTemperatureK',
                );
            }
        }
        normalized[componentId] = Object.freeze(override);
    }
    return Object.freeze(normalized);
}

export function createThermalState(componentId, override = {}) {
    const ambient = override.ambientTemperatureK ??
        override.referenceTemperatureK ?? DEFAULT_AMBIENT_TEMPERATURE_K;
    const temperatureKelvin = finite(ambient, componentId + ' ambientTemperatureK', Number.MIN_VALUE);
    return {
        temperatureKelvin,
        warned: override.warnTemperatureK != null && temperatureKelvin >= override.warnTemperatureK,
        shutdown: override.shutdownTemperatureK != null && temperatureKelvin >= override.shutdownTemperatureK,
        deratingFactor: thermalDeratingFactor(
            temperatureKelvin,
            override,
            override.shutdownTemperatureK != null && temperatureKelvin >= override.shutdownTemperatureK,
        ),
        jouleEnergyJoules: 0,
        coolingEnergyJoules: 0,
    };
}

export function cloneThermalState(state) {
    return {
        temperatureKelvin: state.temperatureKelvin,
        warned: state.warned,
        shutdown: state.shutdown,
        deratingFactor: state.deratingFactor,
        jouleEnergyJoules: state.jouleEnergyJoules,
        coolingEnergyJoules: state.coolingEnergyJoules,
    };
}

export function temperatureAdjustedResistanceOhms(component, thermalState, override = {}) {
    const authored = component?.parameters?.resistanceOhms;
    const referenceResistance = override.resistanceOhms ?? authored;
    const resistance = finite(referenceResistance, component.id + ' resolved resistanceOhms', Number.MIN_VALUE);
    const coefficient = override.temperatureCoefficientPerK ??
        component.parameters.temperatureCoefficientPerKelvin ?? 0;
    const referenceTemperature = override.referenceTemperatureK ??
        component.parameters.referenceTemperatureKelvin ??
        override.ambientTemperatureK ?? DEFAULT_AMBIENT_TEMPERATURE_K;
    finite(coefficient, component.id + ' temperatureCoefficientPerK');
    finite(referenceTemperature, component.id + ' referenceTemperatureK', Number.MIN_VALUE);
    const adjusted = resistance * (
        1 + coefficient * (thermalState.temperatureKelvin - referenceTemperature)
    );
    return finite(adjusted, component.id + ' temperature-adjusted resistanceOhms', Number.MIN_VALUE);
}

export function thermalDeratingFactor(temperatureKelvin, override = {}, shutdown = false) {
    if (shutdown) return 0;
    const start = override.deratingStartTemperatureK;
    const stop = override.shutdownTemperatureK;
    if (start == null || stop == null || temperatureKelvin <= start) return 1;
    if (temperatureKelvin >= stop) return 0;
    return (stop - temperatureKelvin) / (stop - start);
}

/** Advance a lumped thermal RC with backward Euler. */
export function advanceThermalState(previous, override, joulePowerWatts, dtSeconds) {
    const dt = finite(dtSeconds, 'thermal dtSeconds', Number.MIN_VALUE);
    const power = finite(joulePowerWatts, 'thermal joulePowerWatts', 0);
    const candidate = cloneThermalState(previous);
    const capacity = override.thermalCapacityJPerK;
    const resistance = override.thermalResistanceKPerW;
    const ambient = override.ambientTemperatureK ??
        override.referenceTemperatureK ?? DEFAULT_AMBIENT_TEMPERATURE_K;
    let coolingEnergy = 0;
    if (capacity != null && resistance != null) {
        const conductance = 1 / resistance;
        const nextTemperature = (
            capacity * previous.temperatureKelvin + dt * (power + conductance * ambient)
        ) / (capacity + dt * conductance);
        candidate.temperatureKelvin = finite(nextTemperature, 'next temperatureKelvin', Number.MIN_VALUE);
        coolingEnergy = dt * conductance * (candidate.temperatureKelvin - ambient);
    }
    candidate.jouleEnergyJoules = finite(
        previous.jouleEnergyJoules + power * dt,
        'cumulative Joule energy',
        0,
    );
    candidate.coolingEnergyJoules = finite(
        previous.coolingEnergyJoules + coolingEnergy,
        'cumulative cooling energy',
    );
    const shutdownTemperature = override.shutdownTemperatureK;
    if (shutdownTemperature != null) {
        const recoveryTemperature = shutdownTemperature - (override.resetHysteresisK ?? 0);
        candidate.shutdown = previous.shutdown
            ? candidate.temperatureKelvin > recoveryTemperature
            : candidate.temperatureKelvin >= shutdownTemperature;
    } else {
        candidate.shutdown = false;
    }
    candidate.warned = override.warnTemperatureK != null &&
        candidate.temperatureKelvin >= override.warnTemperatureK;
    candidate.deratingFactor = thermalDeratingFactor(
        candidate.temperatureKelvin,
        override,
        candidate.shutdown,
    );
    return candidate;
}

export function createFuseState(component) {
    return {
        open: component.parameters.initialOpen ?? false,
        i2tAmpSquaredSeconds: 0,
        trippedThisStep: false,
    };
}

export function advanceFuseState(previous, currentAmps, dtSeconds, component) {
    const dt = finite(dtSeconds, component.id + ' fuse dtSeconds', Number.MIN_VALUE);
    const current = finite(currentAmps, component.id + ' fuse currentAmps');
    if (previous.open) return { ...previous, trippedThisStep: false };
    const i2t = finite(
        previous.i2tAmpSquaredSeconds + current * current * dt,
        component.id + ' fuse I2t',
        0,
    );
    const open = i2t >= component.parameters.tripI2tAmpSquaredSeconds;
    return {
        open,
        i2tAmpSquaredSeconds: i2t,
        trippedThisStep: open,
    };
}

export function createBreakerState(component) {
    return {
        open: component.parameters.initialOpen ?? false,
        i2tAmpSquaredSeconds: 0,
        trippedThisStep: false,
        resetThisStep: false,
    };
}

export function advanceBreakerState(previous, currentAmps, dtSeconds, component, resetRequested = false) {
    const dt = finite(dtSeconds, component.id + ' breaker dtSeconds', Number.MIN_VALUE);
    const current = Math.abs(finite(currentAmps, component.id + ' breaker currentAmps'));
    const rated = component.parameters.ratedCurrentAmps;
    // New household breakers model heating above continuous rated loading.
    // Missing selection preserves the original authored absolute-I2t model.
    const excessHeating = component.parameters.heatingModel === 'excess-i2t';
    const thermalTimeConstant = component.parameters.thermalTimeConstantSeconds;
    let i2t;
    if (thermalTimeConstant != null) {
        // Optional lumped thermal memory: d(I2t)/dt = heating - I2t/tau.
        // Backward Euler cools both closed and open contacts without overshoot.
        // Excess heating tracks only loading above the authored continuous rating.
        const heating = previous.open ? 0 : excessHeating
            ? Math.max(0, current * current - rated * rated) : current * current;
        i2t = (previous.i2tAmpSquaredSeconds + heating * dt) /
            (1 + dt / thermalTimeConstant);
    } else {
        // Preserve legacy linear cooling and accumulated-I2t behavior exactly.
        i2t = previous.open
            ? Math.max(0, previous.i2tAmpSquaredSeconds - rated * rated * dt)
            : excessHeating
                ? Math.max(0, previous.i2tAmpSquaredSeconds + (current * current - rated * rated) * dt)
                : previous.i2tAmpSquaredSeconds + current * current * dt;
    }
    i2t = finite(i2t, component.id + ' breaker I2t', 0);
    let open = previous.open;
    let trippedThisStep = false;
    let resetThisStep = false;
    const magneticTrip = component.parameters.instantaneousTripCurrentAmps != null &&
        current >= component.parameters.instantaneousTripCurrentAmps;
    if (!open && (magneticTrip || i2t >= component.parameters.tripI2tAmpSquaredSeconds)) {
        open = true;
        trippedThisStep = true;
    } else if (open && resetRequested &&
        current <= Math.max(0, rated - component.parameters.hysteresisAmps) &&
        i2t <= component.parameters.resetI2tAmpSquaredSeconds) {
        open = false;
        resetThisStep = true;
    }
    return { open, i2tAmpSquaredSeconds: i2t, trippedThisStep, resetThisStep };
}
