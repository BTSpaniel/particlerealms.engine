// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Bounded hysteretic quality selection driven by measured frame and memory pressure. */

import {
    fluidClone,
    fluidExactObject,
    fluidFinite,
    fluidFreeze,
    fluidInteger,
    logAdaptiveFluid,
    resolveAdaptiveFluidQualityProfile,
} from './AdaptiveFluidContracts.js';

export const ADAPTIVE_FLUID_QUALITY_GOVERNOR_SNAPSHOT_SCHEMA = 'engine.matter.adaptive-fluid-quality-governor';
export const ADAPTIVE_FLUID_QUALITY_GOVERNOR_SNAPSHOT_VERSION = '1.0.0';

const AUTO_ORDER = Object.freeze(['performance', 'balanced', 'quality', 'scientific']);
const SNAPSHOT_KEYS = new Set([
    'schema', 'schemaVersion', 'requestedProfile', 'effectiveRank', 'targetFrameTimeMs',
    'pressureWindows', 'recoveryWindows', 'sampleCount', 'lastSample',
]);
const SAMPLE_KEYS = new Set([
    'frameTimeMs', 'simulationTimeMs', 'vramHeadroomRatio', 'maximumPhysicalError',
    'maximumSurfaceError', 'pressureRatio',
]);

function validateQualitySample(value, sampleCount) {
    if (value === null) {
        if (sampleCount !== 0) {
            throw new TypeError('$.lastSample: must exist when sampleCount is nonzero');
        }
        return null;
    }
    if (sampleCount === 0) {
        throw new TypeError('$.lastSample: must be null when sampleCount is zero');
    }
    const sample = fluidExactObject(value, SAMPLE_KEYS, '$.lastSample');
    return {
        frameTimeMs: fluidFinite(sample.frameTimeMs, '$.lastSample.frameTimeMs', {
            minimum: 0,
            maximum: 10_000,
        }),
        simulationTimeMs: fluidFinite(sample.simulationTimeMs, '$.lastSample.simulationTimeMs', {
            minimum: 0,
            maximum: 10_000,
        }),
        vramHeadroomRatio: fluidFinite(sample.vramHeadroomRatio, '$.lastSample.vramHeadroomRatio', {
            minimum: 0,
            maximum: 1,
        }),
        maximumPhysicalError: fluidFinite(
            sample.maximumPhysicalError,
            '$.lastSample.maximumPhysicalError',
            { minimum: 0 },
        ),
        maximumSurfaceError: fluidFinite(
            sample.maximumSurfaceError,
            '$.lastSample.maximumSurfaceError',
            { minimum: 0 },
        ),
        pressureRatio: fluidFinite(sample.pressureRatio, '$.lastSample.pressureRatio', {
            minimum: 0,
        }),
    };
}

export class AdaptiveFluidQualityGovernor {
    #requestedProfile;
    #effectiveRank;
    #targetFrameTimeMs;
    #pressureWindows = 0;
    #recoveryWindows = 0;
    #sampleCount = 0;
    #lastSample = null;
    #logger;
    #destroyed = false;

    constructor({
        qualityProfile = 'balanced',
        targetFrameTimeMs = 1000 / 60,
        logger = null,
        snapshot = null,
    } = {}) {
        this.#requestedProfile = resolveAdaptiveFluidQualityProfile(qualityProfile).name;
        this.#effectiveRank = this.#requestedProfile === 'auto'
            ? AUTO_ORDER.indexOf('balanced')
            : Math.max(0, AUTO_ORDER.indexOf(this.#requestedProfile));
        this.#targetFrameTimeMs = fluidFinite(targetFrameTimeMs, '$.targetFrameTimeMs', {
            minimum: 1,
            maximum: 1000,
        });
        this.#logger = logger;
        if (snapshot) this.restore(snapshot);
    }

    #assertAlive() {
        if (this.#destroyed) throw new Error('Adaptive fluid quality governor is destroyed');
    }

    get requestedProfile() {
        this.#assertAlive();
        return this.#requestedProfile;
    }

    get effectiveProfile() {
        this.#assertAlive();
        return this.#requestedProfile === 'auto'
            ? AUTO_ORDER[this.#effectiveRank]
            : this.#requestedProfile;
    }

    setProfile(profile) {
        this.#assertAlive();
        const previousRequested = this.#requestedProfile;
        const previousEffective = this.effectiveProfile;
        this.#requestedProfile = resolveAdaptiveFluidQualityProfile(profile).name;
        if (this.#requestedProfile !== 'auto') {
            this.#effectiveRank = Math.max(0, AUTO_ORDER.indexOf(this.#requestedProfile));
        }
        this.#pressureWindows = 0;
        this.#recoveryWindows = 0;
        logAdaptiveFluid(this.#logger, 'info', 'quality-governor-profile-change', {
            previousRequested,
            requested: this.#requestedProfile,
            previousEffective,
            effective: this.effectiveProfile,
        });
        return this.state(false);
    }

    update({
        frameTimeMs,
        simulationTimeMs = frameTimeMs,
        vramHeadroomRatio = 1,
        maximumPhysicalError = 0,
        maximumSurfaceError = 0,
    } = {}) {
        this.#assertAlive();
        const frame = fluidFinite(frameTimeMs, '$.frameTimeMs', { minimum: 0, maximum: 10_000 });
        const simulation = fluidFinite(simulationTimeMs, '$.simulationTimeMs', {
            minimum: 0,
            maximum: 10_000,
        });
        const headroom = fluidFinite(vramHeadroomRatio, '$.vramHeadroomRatio', {
            minimum: 0,
            maximum: 1,
        });
        const physicalError = fluidFinite(maximumPhysicalError, '$.maximumPhysicalError', {
            minimum: 0,
        });
        const surfaceError = fluidFinite(maximumSurfaceError, '$.maximumSurfaceError', {
            minimum: 0,
        });
        const previous = this.effectiveProfile;
        const pressure = Math.max(
            frame / this.#targetFrameTimeMs,
            simulation / (this.#targetFrameTimeMs * 0.72),
            headroom < 0.08 ? 2 : headroom < 0.16 ? 1.25 : 0,
        );
        if (this.#requestedProfile === 'auto') {
            if (pressure > 1.08) {
                this.#pressureWindows += 1;
                this.#recoveryWindows = 0;
                if (this.#pressureWindows >= 2 && this.#effectiveRank > 0) {
                    this.#effectiveRank -= 1;
                    this.#pressureWindows = 0;
                } else if (this.#effectiveRank === 0) {
                    this.#pressureWindows = 0;
                }
            } else if (pressure < 0.68 && headroom > 0.25
                && (physicalError > 0.08 || surfaceError > 0.08)) {
                this.#recoveryWindows += 1;
                this.#pressureWindows = 0;
                if (this.#recoveryWindows >= 4 && this.#effectiveRank < AUTO_ORDER.length - 1) {
                    this.#effectiveRank += 1;
                    this.#recoveryWindows = 0;
                } else if (this.#effectiveRank === AUTO_ORDER.length - 1) {
                    this.#recoveryWindows = 0;
                }
            } else {
                this.#pressureWindows = 0;
                this.#recoveryWindows = 0;
            }
        }
        this.#sampleCount += 1;
        this.#lastSample = {
            frameTimeMs: frame,
            simulationTimeMs: simulation,
            vramHeadroomRatio: headroom,
            maximumPhysicalError: physicalError,
            maximumSurfaceError: surfaceError,
            pressureRatio: pressure,
        };
        const current = this.effectiveProfile;
        const changed = current !== previous;
        if (changed) {
            logAdaptiveFluid(this.#logger, 'info', 'quality-governor-effective-change', {
                previous,
                current,
                pressureRatio: pressure,
            });
        }
        return this.state(changed);
    }

    state(changed = false) {
        this.#assertAlive();
        return fluidFreeze({
            requestedProfile: this.#requestedProfile,
            effectiveProfile: this.effectiveProfile,
            targetFrameTimeMs: this.#targetFrameTimeMs,
            changed,
            pressureWindows: this.#pressureWindows,
            recoveryWindows: this.#recoveryWindows,
            sampleCount: this.#sampleCount,
            lastSample: this.#lastSample,
        }, '$.adaptiveFluidQualityState');
    }

    snapshot() {
        this.#assertAlive();
        return fluidFreeze({
            schema: ADAPTIVE_FLUID_QUALITY_GOVERNOR_SNAPSHOT_SCHEMA,
            schemaVersion: ADAPTIVE_FLUID_QUALITY_GOVERNOR_SNAPSHOT_VERSION,
            requestedProfile: this.#requestedProfile,
            effectiveRank: this.#effectiveRank,
            targetFrameTimeMs: this.#targetFrameTimeMs,
            pressureWindows: this.#pressureWindows,
            recoveryWindows: this.#recoveryWindows,
            sampleCount: this.#sampleCount,
            lastSample: this.#lastSample,
        }, '$.adaptiveFluidQualityGovernorSnapshot');
    }

    restore(snapshotInput) {
        this.#assertAlive();
        const snapshot = fluidClone(snapshotInput, '$.adaptiveFluidQualityGovernorSnapshot');
        fluidExactObject(snapshot, SNAPSHOT_KEYS, '$.adaptiveFluidQualityGovernorSnapshot');
        if (snapshot.schema !== ADAPTIVE_FLUID_QUALITY_GOVERNOR_SNAPSHOT_SCHEMA
            || snapshot.schemaVersion !== ADAPTIVE_FLUID_QUALITY_GOVERNOR_SNAPSHOT_VERSION) {
            throw new TypeError('$.adaptiveFluidQualityGovernorSnapshot: unsupported schema or version');
        }
        const requestedProfile = resolveAdaptiveFluidQualityProfile(snapshot.requestedProfile).name;
        const effectiveRank = fluidInteger(snapshot.effectiveRank, '$.effectiveRank', {
            maximum: AUTO_ORDER.length - 1,
        });
        const expectedFixedRank = AUTO_ORDER.indexOf(requestedProfile);
        if (requestedProfile !== 'auto' && effectiveRank !== expectedFixedRank) {
            throw new RangeError(
                `$.effectiveRank: fixed profile '${requestedProfile}' requires rank ${expectedFixedRank}`,
            );
        }
        const targetFrameTimeMs = fluidFinite(snapshot.targetFrameTimeMs, '$.targetFrameTimeMs', {
            minimum: 1,
            maximum: 1000,
        });
        const pressureWindows = fluidInteger(snapshot.pressureWindows, '$.pressureWindows', {
            maximum: 1,
        });
        const recoveryWindows = fluidInteger(snapshot.recoveryWindows, '$.recoveryWindows', {
            maximum: 3,
        });
        if (pressureWindows > 0 && recoveryWindows > 0) {
            throw new RangeError('$.adaptiveFluidQualityGovernorSnapshot: pressure and recovery windows conflict');
        }
        if (requestedProfile !== 'auto' && (pressureWindows !== 0 || recoveryWindows !== 0)) {
            throw new RangeError('$.adaptiveFluidQualityGovernorSnapshot: fixed profiles cannot retain Auto windows');
        }
        const sampleCount = fluidInteger(snapshot.sampleCount, '$.sampleCount');
        const lastSample = validateQualitySample(snapshot.lastSample, sampleCount);

        this.#requestedProfile = requestedProfile;
        this.#effectiveRank = effectiveRank;
        this.#targetFrameTimeMs = targetFrameTimeMs;
        this.#pressureWindows = pressureWindows;
        this.#recoveryWindows = recoveryWindows;
        this.#sampleCount = sampleCount;
        this.#lastSample = lastSample;
        return this;
    }

    destroy() {
        this.#destroyed = true;
    }
}

export function createAdaptiveFluidQualityGovernor(options) {
    return new AdaptiveFluidQualityGovernor(options);
}
