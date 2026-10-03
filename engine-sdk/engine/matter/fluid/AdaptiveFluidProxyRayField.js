// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Deterministic packet ray fan for predictive fluid collision refinement. */

import { rayCreate, rayIntersectAABB } from '../../core/math/MathRay.js';
import {
    fluidFinite,
    fluidFreeze,
    fluidIdentifier,
    fluidVector3,
} from './AdaptiveFluidContracts.js';

export const ADAPTIVE_FLUID_PROXY_RAY_SCHEMA = 'engine.matter.adaptive-fluid-proxy-ray-field';
export const ADAPTIVE_FLUID_PROXY_RAY_VERSION = '1.0.0';
export const ADAPTIVE_FLUID_PROXY_QUERY_LIMIT = 10;
export const ADAPTIVE_FLUID_PROXY_RAY_DIRECTIONS = Object.freeze([
    Object.freeze({ id: 'negative-x', axis: 0, sign: -1, vector: Object.freeze([-1, 0, 0]) }),
    Object.freeze({ id: 'positive-x', axis: 0, sign: 1, vector: Object.freeze([1, 0, 0]) }),
    Object.freeze({ id: 'negative-y', axis: 1, sign: -1, vector: Object.freeze([0, -1, 0]) }),
    Object.freeze({ id: 'positive-y', axis: 1, sign: 1, vector: Object.freeze([0, 1, 0]) }),
    Object.freeze({ id: 'negative-z', axis: 2, sign: -1, vector: Object.freeze([0, 0, -1]) }),
    Object.freeze({ id: 'positive-z', axis: 2, sign: 1, vector: Object.freeze([0, 0, 1]) }),
]);

const SPEED_EPSILON_M_PER_S = 1e-9;

function validatedBounds(bounds) {
    if (!bounds || typeof bounds !== 'object' || Array.isArray(bounds)) {
        throw new TypeError('$.bounds: must be an object containing min and max vectors');
    }
    const minimum = fluidVector3(bounds.min, '$.bounds.min');
    const maximum = fluidVector3(bounds.max, '$.bounds.max');
    for (let axis = 0; axis < 3; axis += 1) {
        if (!(maximum[axis] > minimum[axis])) {
            throw new RangeError(`$.bounds: max[${axis}] must exceed min[${axis}]`);
        }
    }
    return { min: minimum, max: maximum };
}

function validatedPackets(packetInputs) {
    if (!Array.isArray(packetInputs) || packetInputs.length < 1 || packetInputs.length > 4096) {
        throw new RangeError('$.packets: must contain 1..4096 physical packets');
    }
    const ids = new Set();
    return packetInputs.map((packet, index) => {
        if (!packet || typeof packet !== 'object' || Array.isArray(packet)) {
            throw new TypeError(`$.packets[${index}]: must be a packet object`);
        }
        const id = fluidIdentifier(
            packet.id ?? packet.lineage?.id,
            `$.packets[${index}].id`,
        );
        if (ids.has(id)) throw new RangeError(`$.packets[${index}].id: duplicate packet '${id}'`);
        ids.add(id);
        return {
            id,
            positionM: fluidVector3(packet.positionM, `$.packets[${index}].positionM`),
            velocityMPerS: fluidVector3(
                packet.velocityMPerS,
                `$.packets[${index}].velocityMPerS`,
            ),
            representedVolumeM3: fluidFinite(
                packet.representedVolumeM3,
                `$.packets[${index}].representedVolumeM3`,
                { minimum: Number.MIN_VALUE, maximum: 1e18 },
            ),
        };
    }).sort((left, right) => left.id.localeCompare(right.id));
}

function proxySweepFunction(proxySceneQuery) {
    if (proxySceneQuery == null) return null;
    if (typeof proxySceneQuery === 'function') return proxySceneQuery;
    if (typeof proxySceneQuery?.sweepSphere === 'function') {
        return ({ origin, radiusM, direction, maximumDistanceM, filter }) => (
            proxySceneQuery.sweepSphere(origin, radiusM, direction, maximumDistanceM, filter)
        );
    }
    throw new TypeError('$.proxySceneQuery: must be a sweep function or expose sweepSphere()');
}

function boundaryRayDistance(positionM, radiusM, bounds, direction) {
    const insetMin = bounds.min.map(value => value + radiusM);
    const insetMax = bounds.max.map(value => value - radiusM);
    const hasValidInterior = insetMin.every((value, axis) => value <= insetMax[axis]);
    const inside = hasValidInterior && positionM.every(
        (value, axis) => value >= insetMin[axis] && value <= insetMax[axis],
    );
    if (!inside) return 0;
    const hit = rayIntersectAABB(rayCreate(positionM, direction), insetMin, insetMax);
    return hit && Number.isFinite(hit.t) ? Math.max(0, hit.t) : 0;
}

function normalizedProxyHit(rawHit, maximumDistanceM) {
    if (rawHit == null || rawHit.hit === false) return null;
    if (typeof rawHit !== 'object' || Array.isArray(rawHit) || rawHit.hit !== true) {
        throw new TypeError('proxy sweep must return null or an object with a boolean hit field');
    }
    const distanceM = fluidFinite(rawHit.distance, '$.proxyHit.distance', {
        minimum: 0,
        maximum: maximumDistanceM,
    });
    const entityId = rawHit.entityId == null ? null : String(rawHit.entityId).slice(0, 256);
    return { distanceM, entityId };
}

/**
 * Cast six packet-radius-aware rays against the domain and optional engine
 * scene-query proxies. The result is advisory metadata for refinement and
 * scheduling; SPH neighborhood forces remain authoritative.
 */
export function traceAdaptiveFluidProxyRays(packetInputs, {
    bounds,
    proxySceneQuery = null,
    proxyFilter = undefined,
    horizonSeconds = 0.12,
} = {}) {
    const packets = validatedPackets(packetInputs);
    const domain = validatedBounds(bounds);
    const horizon = fluidFinite(horizonSeconds, '$.horizonSeconds', {
        minimum: Number.MIN_VALUE,
        maximum: 10,
    });
    const sweepProxy = proxySweepFunction(proxySceneQuery);
    const totalRayCount = packets.length * ADAPTIVE_FLUID_PROXY_RAY_DIRECTIONS.length;
    const proxyQueryBudget = sweepProxy
        ? Math.min(ADAPTIVE_FLUID_PROXY_QUERY_LIMIT, totalRayCount)
        : 0;
    // GPUSceneQuery is a deliberately small synchronous query surface. Spread
    // its fixed budget across the complete packet/ray fan while retaining all
    // inexpensive domain-boundary results for every packet.
    const proxyRayOrdinals = new Set(Array.from(
        { length: proxyQueryBudget },
        (_, index) => Math.min(
            totalRayCount - 1,
            Math.floor((index + 0.5) * totalRayCount / proxyQueryBudget),
        ),
    ));
    let proxyQueries = 0;
    let proxyHits = 0;
    let proxyFailures = 0;
    let nearestDistanceM = Number.MAX_VALUE;
    let predictedImpactSeconds = Number.MAX_VALUE;
    let impendingPackets = 0;

    const packetResults = packets.map((packet, packetIndex) => {
        const radiusM = 0.5 * Math.cbrt(packet.representedVolumeM3);
        let packetNearestDistanceM = Number.MAX_VALUE;
        let packetPredictedImpactSeconds = Number.MAX_VALUE;
        let packetProxyHits = 0;
        const rays = ADAPTIVE_FLUID_PROXY_RAY_DIRECTIONS.map((rayDirection, rayIndex) => {
            const boundaryDistanceM = boundaryRayDistance(
                packet.positionM,
                radiusM,
                domain,
                rayDirection.vector,
            );
            let distanceM = boundaryDistanceM;
            let source = 'domain-boundary';
            let proxyEntityId = null;
            const rayOrdinal = packetIndex * ADAPTIVE_FLUID_PROXY_RAY_DIRECTIONS.length + rayIndex;
            if (sweepProxy && boundaryDistanceM > 0 && proxyRayOrdinals.has(rayOrdinal)) {
                proxyQueries += 1;
                try {
                    const proxyHit = normalizedProxyHit(sweepProxy({
                        origin: [...packet.positionM],
                        radiusM,
                        direction: [...rayDirection.vector],
                        maximumDistanceM: boundaryDistanceM,
                        filter: proxyFilter,
                        packetId: packet.id,
                    }), boundaryDistanceM);
                    if (proxyHit && proxyHit.distanceM < distanceM) {
                        distanceM = proxyHit.distanceM;
                        source = 'engine-proxy';
                        proxyEntityId = proxyHit.entityId;
                        proxyHits += 1;
                        packetProxyHits += 1;
                    }
                } catch (_error) {
                    proxyFailures += 1;
                }
            }
            const approachSpeedMPerS = Math.max(
                0,
                packet.velocityMPerS[rayDirection.axis] * rayDirection.sign,
            );
            const impactSeconds = approachSpeedMPerS > SPEED_EPSILON_M_PER_S
                ? distanceM / approachSpeedMPerS
                : Number.MAX_VALUE;
            packetNearestDistanceM = Math.min(packetNearestDistanceM, distanceM);
            packetPredictedImpactSeconds = Math.min(
                packetPredictedImpactSeconds,
                impactSeconds,
            );
            return {
                id: rayDirection.id,
                distanceM,
                impactSeconds,
                source,
                proxyEntityId,
            };
        });
        const impending = packetPredictedImpactSeconds <= horizon;
        if (impending) impendingPackets += 1;
        nearestDistanceM = Math.min(nearestDistanceM, packetNearestDistanceM);
        predictedImpactSeconds = Math.min(
            predictedImpactSeconds,
            packetPredictedImpactSeconds,
        );
        return {
            id: packet.id,
            radiusM,
            nearestDistanceM: packetNearestDistanceM,
            predictedImpactSeconds: packetPredictedImpactSeconds,
            impending,
            proxyHits: packetProxyHits,
            rays,
        };
    });

    return fluidFreeze({
        schema: ADAPTIVE_FLUID_PROXY_RAY_SCHEMA,
        schemaVersion: ADAPTIVE_FLUID_PROXY_RAY_VERSION,
        horizonSeconds: horizon,
        rayCount: totalRayCount,
        proxyProviderAvailable: Boolean(sweepProxy),
        proxyQueryBudget,
        proxyQueries,
        proxyHits,
        proxyFailures,
        nearestDistanceM,
        predictedImpactSeconds,
        impendingPackets,
        packets: packetResults,
    }, '$.adaptiveFluidProxyRayField');
}
