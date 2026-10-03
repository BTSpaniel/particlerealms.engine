// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Conservative f32 admission bounds for the non-authoritative GPU SPH operator. */

import {
    ADAPTIVE_FLUID_ERROR_CODES,
    AdaptiveFluidError,
    fluidFreeze,
} from './AdaptiveFluidContracts.js';

export const ADAPTIVE_SPH_GPU_NUMERIC_BOUNDS_SCHEMA =
    'engine.matter.adaptive-sph-gpu-numeric-bounds';
export const ADAPTIVE_SPH_GPU_NUMERIC_BOUNDS_VERSION = '1.0.0';

const PI = Math.PI;
const NORMAL_F32_MINIMUM = 2 ** -126;
const FINITE_F32_MAXIMUM = (2 - 2 ** -23) * 2 ** 127;
const POLY6_FACTOR = 315 / (64 * PI);
const GRADIENT_FACTOR = 945 / (32 * PI);
const VISCOSITY_FACTOR = 45 / PI;
const GPU_EPSILON = 1e-12;

function reject(stage, risk, magnitude) {
    throw new AdaptiveFluidError(
        ADAPTIVE_FLUID_ERROR_CODES.INVALID_INPUT,
        `Adaptive SPH GPU numeric preflight rejected ${stage}: ${risk}`,
        {
            stage,
            risk,
            magnitude: Number.isFinite(magnitude) ? magnitude : String(magnitude),
            normalF32Minimum: NORMAL_F32_MINIMUM,
            finiteF32Maximum: FINITE_F32_MAXIMUM,
        },
    );
}

function magnitude(value, stage, { zero = false, underflow = true } = {}) {
    const absolute = Math.abs(value);
    if (!Number.isFinite(absolute) || absolute > FINITE_F32_MAXIMUM) {
        reject(stage, 'f32-overflow-risk', absolute);
    }
    if (!zero && underflow && absolute > 0 && absolute < NORMAL_F32_MINIMUM) {
        reject(stage, 'f32-underflow-risk', absolute);
    }
    return absolute;
}

function product(stage, factors, options) {
    let result = 1;
    for (const factor of factors) {
        const absolute = Math.abs(factor);
        if (absolute === 0) return 0;
        result = magnitude(result * absolute, stage, options);
    }
    return result;
}

function quotient(stage, numerator, denominator, options) {
    magnitude(denominator, `${stage}.denominator`);
    return magnitude(numerator / denominator, stage, options);
}

function sum(stage, values, options) {
    let result = 0;
    for (const value of values) result = magnitude(result + Math.abs(value), stage, options);
    return result;
}

function supportBounds(supportM, label) {
    const support2 = product(`${label}.support2`, [supportM, supportM]);
    const support3 = product(`${label}.support3`, [support2, supportM]);
    const support4 = product(`${label}.support4`, [support3, supportM]);
    const support5 = product(`${label}.support5`, [support4, supportM]);
    return {
        densityKernel: quotient(`${label}.densityKernel`, POLY6_FACTOR, support3),
        gradientKernel: quotient(`${label}.gradientKernel`, GRADIENT_FACTOR, support4),
        viscosityKernel: quotient(`${label}.viscosityKernel`, VISCOSITY_FACTOR, support5),
    };
}

/**
 * Rejects inputs whose conservative shader-operation envelope can leave the
 * normal finite f32 domain. It derives bounds only; density and forces remain
 * GPU work and this receipt grants no simulation authority.
 */
export function admitAdaptiveSphGpuNumericBounds({
    packets,
    interactions,
    dtSeconds,
    gravityMPerS2,
    viscosity,
    pressureScale,
    surfaceTensionNPerM,
    bounds,
    kernelProfile,
}) {
    const incidence = packets.map(() => []);
    const pairBounds = interactions.map((pair, pairIndex) => {
        const kernels = supportBounds(pair.smoothingRadiusM, `pair[${pairIndex}]`);
        incidence[pair.leftIndex].push({ pair, pairIndex, otherIndex: pair.rightIndex, kernels });
        incidence[pair.rightIndex].push({ pair, pairIndex, otherIndex: pair.leftIndex, kernels });
        return { pair, kernels };
    });
    const carrierBounds = packets.map((packet, packetIndex) => {
        const self = supportBounds(packet.smoothingRadiusM, `carrier[${packetIndex}]`);
        const minimumDensity = product(`carrier[${packetIndex}].minimumDensity`, [
            packet.massKg, self.densityKernel,
        ]);
        const neighborDensity = incidence[packetIndex].map(({ otherIndex, kernels }) =>
            product(`carrier[${packetIndex}].neighborDensity`, [
                packets[otherIndex].massKg, kernels.densityKernel,
            ]));
        const maximumDensity = sum(`carrier[${packetIndex}].maximumDensity`, [
            minimumDensity, ...neighborDensity,
        ]);
        const maximumDensityGradient = sum(`carrier[${packetIndex}].densityGradient`,
            incidence[packetIndex].map(({ otherIndex, kernels }) =>
                product(`carrier[${packetIndex}].densityGradientTerm`, [
                    packets[otherIndex].massKg, kernels.gradientKernel,
                ])), { zero: true });
        product(`carrier[${packetIndex}].densityGradientLength2`, [
            maximumDensityGradient, maximumDensityGradient,
        ], { zero: true });
        const surfaceNumerator = product(`carrier[${packetIndex}].surfaceNumerator`, [
            maximumDensityGradient, packet.smoothingRadiusM,
        ], { zero: true });
        if (surfaceNumerator > 0) {
            quotient(`carrier[${packetIndex}].surfaceIndicator`, surfaceNumerator, minimumDensity);
        }
        const minimumRatio = quotient(`carrier[${packetIndex}].minimumDensityRatio`,
            minimumDensity, packet.restDensityKgM3);
        const maximumRatio = quotient(`carrier[${packetIndex}].maximumDensityRatio`,
            maximumDensity, packet.restDensityKgM3);
        const maximumPressure = product(`carrier[${packetIndex}].pressure`, [
            kernelProfile.pressureStiffnessPa,
            Math.max(Math.abs(minimumRatio - 1), Math.abs(maximumRatio - 1)),
        ], { zero: true });
        product(`carrier[${packetIndex}].densitySquared`, [maximumDensity, maximumDensity]);
        return { minimumDensity, maximumDensity, maximumDensityGradient, maximumPressure };
    });

    const forceBounds = pairBounds.map(({ pair, kernels }, pairIndex) => {
        const left = packets[pair.leftIndex];
        const right = packets[pair.rightIndex];
        const leftBound = carrierBounds[pair.leftIndex];
        const rightBound = carrierBounds[pair.rightIndex];
        const massProduct = product(`pair[${pairIndex}].massProduct`, [left.massKg, right.massKg]);
        const leftDenominator = Math.max(GPU_EPSILON,
            leftBound.minimumDensity * leftBound.minimumDensity);
        const rightDenominator = Math.max(GPU_EPSILON,
            rightBound.minimumDensity * rightBound.minimumDensity);
        const pressureSum = sum(`pair[${pairIndex}].pressureRatioSum`, [
            quotient(`pair[${pairIndex}].leftPressureRatio`,
                leftBound.maximumPressure, leftDenominator, { zero: true }),
            quotient(`pair[${pairIndex}].rightPressureRatio`,
                rightBound.maximumPressure, rightDenominator, { zero: true }),
        ], { zero: true });
        const pressureCoefficient = product(`pair[${pairIndex}].pressureCoefficient`, [
            massProduct, pressureScale, pressureSum,
        ], { zero: true });
        const pressureForce = product(`pair[${pairIndex}].pressureForce`, [
            kernels.gradientKernel, pressureCoefficient,
        ], { zero: true });

        const densityProduct = product(`pair[${pairIndex}].densityProduct`, [
            leftBound.maximumDensity, rightBound.maximumDensity,
        ]);
        const viscousNumerator = product(`pair[${pairIndex}].viscousNumerator`, [
            viscosity, left.massKg, right.massKg, kernels.viscosityKernel,
        ], { zero: true });
        const viscousCoefficient = viscousNumerator === 0 ? 0 : quotient(
            `pair[${pairIndex}].viscousCoefficient`, viscousNumerator,
            Math.max(GPU_EPSILON, Math.min(densityProduct,
                leftBound.minimumDensity * rightBound.minimumDensity)),
        );
        const velocityDelta = Math.max(...left.velocityMPerS.map((value, axis) =>
            magnitude(Math.abs(value) + Math.abs(right.velocityMPerS[axis]),
                `pair[${pairIndex}].velocityDelta[${axis}]`, { zero: true })));
        const viscousForce = product(`pair[${pairIndex}].viscousForce`, [
            velocityDelta, viscousCoefficient,
        ], { zero: true });

        const pairAreaM2 = magnitude(0.5 * (
            left.representedVolumeM3 ** (2 / 3)
            + right.representedVolumeM3 ** (2 / 3)
        ), `pair[${pairIndex}].area`);
        const capillaryForce = surfaceTensionNPerM === 0 ? 0 : quotient(
            `pair[${pairIndex}].capillaryForce`,
            product(`pair[${pairIndex}].capillaryNumerator`, [
                surfaceTensionNPerM, pairAreaM2,
            ]),
            pair.smoothingRadiusM,
        );
        return sum(`pair[${pairIndex}].force`, [
            pressureForce, viscousForce, capillaryForce,
        ], { zero: true });
    });

    let maximumAcceleration = 0;
    let maximumIntegratedVelocity = 0;
    let maximumIntegratedPosition = 0;
    for (let packetIndex = 0; packetIndex < packets.length; packetIndex += 1) {
        const packet = packets[packetIndex];
        const forceAcceleration = sum(`carrier[${packetIndex}].forceAcceleration`,
            incidence[packetIndex].map(({ pairIndex }) => quotient(
                `carrier[${packetIndex}].pairAcceleration`, forceBounds[pairIndex], packet.massKg,
                { zero: true },
            )), { zero: true });
        const acceleration = magnitude(
            Math.max(...gravityMPerS2.map(Math.abs)) + forceAcceleration,
            `carrier[${packetIndex}].acceleration`, { zero: true },
        );
        const integratedVelocity = magnitude(
            Math.max(...packet.velocityMPerS.map(Math.abs))
                + product(`carrier[${packetIndex}].velocityDelta`, [acceleration, dtSeconds],
                    { zero: true }),
            `carrier[${packetIndex}].integratedVelocity`, { zero: true },
        );
        const integratedPosition = magnitude(
            Math.max(...packet.positionM.map(Math.abs))
                + product(`carrier[${packetIndex}].positionDelta`, [integratedVelocity, dtSeconds],
                    { zero: true }),
            `carrier[${packetIndex}].integratedPosition`, { zero: true },
        );
        if (bounds) {
            const radiusM = magnitude(0.5 * packet.representedVolumeM3 ** (1 / 3),
                `carrier[${packetIndex}].boundaryRadius`);
            bounds.min.forEach((value, axis) => magnitude(Math.abs(value) + radiusM,
                `carrier[${packetIndex}].boundaryMinimum[${axis}]`, { zero: true }));
            bounds.max.forEach((value, axis) => magnitude(Math.abs(value) + radiusM,
                `carrier[${packetIndex}].boundaryMaximum[${axis}]`, { zero: true }));
        }
        maximumAcceleration = Math.max(maximumAcceleration, acceleration);
        maximumIntegratedVelocity = Math.max(maximumIntegratedVelocity, integratedVelocity);
        maximumIntegratedPosition = Math.max(maximumIntegratedPosition, integratedPosition);
    }

    return fluidFreeze({
        schema: ADAPTIVE_SPH_GPU_NUMERIC_BOUNDS_SCHEMA,
        schemaVersion: ADAPTIVE_SPH_GPU_NUMERIC_BOUNDS_VERSION,
        admitted: true,
        packetCount: packets.length,
        pairCount: interactions.length,
        maximumDensityKgM3: Math.max(...carrierBounds.map(entry => entry.maximumDensity)),
        maximumPressureMagnitudePa: Math.max(...carrierBounds.map(entry => entry.maximumPressure)),
        maximumDensityGradientKgM4: Math.max(
            ...carrierBounds.map(entry => entry.maximumDensityGradient),
        ),
        maximumPairForceN: Math.max(0, ...forceBounds),
        maximumAccelerationMPerS2: maximumAcceleration,
        maximumIntegratedVelocityMPerS: maximumIntegratedVelocity,
        maximumIntegratedPositionM: maximumIntegratedPosition,
        normalF32Minimum: NORMAL_F32_MINIMUM,
        finiteF32Maximum: FINITE_F32_MAXIMUM,
        authority: { liveSimulationMutation: false, physicalHandoff: false },
    }, '$.adaptiveSphGpuNumericBounds');
}

