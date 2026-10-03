// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Deterministic projection of sparse motion samples onto stable Matter packet
 * handles. The projection changes only position and velocity; packet identity,
 * material, mass, volume, and revision authority remain with the caller's
 * codec transaction.
 */

function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function finiteVector3(value) {
    return (Array.isArray(value) || ArrayBuffer.isView(value))
        && value.length >= 3
        && Number.isFinite(Number(value[0]))
        && Number.isFinite(Number(value[1]))
        && Number.isFinite(Number(value[2]));
}

function vector3(value) {
    return [finite(value[0]), finite(value[1]), finite(value[2])];
}

function meanVector(entries, key) {
    const result = [0, 0, 0];
    for (const entry of entries) {
        for (let axis = 0; axis < 3; axis += 1) result[axis] += finite(entry[key]?.[axis]);
    }
    const inverse = entries.length > 0 ? 1 / entries.length : 0;
    return result.map(value => value * inverse);
}

function massWeightedVector(entries, key) {
    const result = [0, 0, 0];
    let totalMassKg = 0;
    for (const entry of entries) {
        const massKg = Math.max(Number.MIN_VALUE, finite(entry.massKg, 1));
        totalMassKg += massKg;
        for (let axis = 0; axis < 3; axis += 1) {
            result[axis] += finite(entry[key]?.[axis]) * massKg;
        }
    }
    return result.map(value => value / Math.max(Number.MIN_VALUE, totalMassKg));
}

function mortonPositionKey(positionM, minimum, maximum) {
    const quantized = positionM.map((value, axis) => {
        const span = Math.max(Number.MIN_VALUE, maximum[axis] - minimum[axis]);
        return Math.max(0, Math.min(1023, Math.round((value - minimum[axis]) / span * 1023)));
    });
    let key = 0;
    for (let bit = 0; bit < 10; bit += 1) {
        key += ((quantized[0] >> bit) & 1) * 2 ** (bit * 3);
        key += ((quantized[1] >> bit) & 1) * 2 ** (bit * 3 + 1);
        key += ((quantized[2] >> bit) & 1) * 2 ** (bit * 3 + 2);
    }
    return key;
}

function squaredDistance(left, right) {
    return left.reduce((sum, value, axis) => sum + (value - right[axis]) ** 2, 0);
}

/**
 * Cluster equal-weight observations in Morton order, then assign those
 * clusters to current packets by nearest stable lineage. When there are enough
 * observations to constrain every packet, a shared correction preserves the
 * observed centre of mass and momentum under unequal packet masses.
 */
export function projectMatterKinematicSamplesToPackets(samplesInput, packetsInput) {
    const samples = (Array.isArray(samplesInput) ? samplesInput : [])
        .filter(sample => sample?.valid !== false
            && finiteVector3(sample?.positionM)
            && finiteVector3(sample?.velocityMPerS))
        .map((sample, sourceIndex) => ({
            sourceIndex: Math.max(0, Math.floor(finite(sample.sourceParticleIndex, sourceIndex))),
            positionM: vector3(sample.positionM),
            velocityMPerS: vector3(sample.velocityMPerS),
        }));
    const packets = (Array.isArray(packetsInput) ? packetsInput : [])
        .filter(packet => packet?.handle && packet?.lineage?.id
            && finiteVector3(packet?.positionM))
        .map(packet => ({
            handle: packet.handle,
            lineageId: String(packet.lineage.id),
            massKg: Math.max(Number.MIN_VALUE, finite(packet.massKg, 1)),
            positionM: vector3(packet.positionM),
        }))
        .sort((left, right) => left.lineageId.localeCompare(right.lineageId));
    // One observation cannot authoritatively constrain multiple independent
    // packet identities. Reusing it would fabricate overlapping packet state,
    // so sparse evidence is rejected and the caller keeps its prior state.
    if (samples.length < packets.length || packets.length === 0) return Object.freeze([]);

    const minimum = [0, 1, 2].map(axis => Math.min(...samples.map(sample => sample.positionM[axis])));
    const maximum = [0, 1, 2].map(axis => Math.max(...samples.map(sample => sample.positionM[axis])));
    samples.sort((left, right) => (
        mortonPositionKey(left.positionM, minimum, maximum)
        - mortonPositionKey(right.positionM, minimum, maximum)
        || left.sourceIndex - right.sourceIndex
    ));

    const clusters = packets.map((_packet, packetIndex) => {
        const start = Math.floor(packetIndex * samples.length / packets.length);
        const end = Math.max(start + 1, Math.floor((packetIndex + 1) * samples.length / packets.length));
        const group = samples.slice(start, end);
        return {
            positionM: meanVector(group, 'positionM'),
            velocityMPerS: meanVector(group, 'velocityMPerS'),
        };
    });
    const remainingClusters = [...clusters];
    const projected = packets.map(packet => {
        let nearestIndex = 0;
        for (let index = 1; index < remainingClusters.length; index += 1) {
            if (squaredDistance(packet.positionM, remainingClusters[index].positionM)
                < squaredDistance(packet.positionM, remainingClusters[nearestIndex].positionM)) {
                nearestIndex = index;
            }
        }
        const cluster = remainingClusters.splice(nearestIndex, 1)[0];
        return {
            handle: packet.handle,
            massKg: packet.massKg,
            positionM: cluster.positionM,
            velocityMPerS: cluster.velocityMPerS,
        };
    });

    const samplePositionMean = meanVector(samples, 'positionM');
    const sampleVelocityMean = meanVector(samples, 'velocityMPerS');
    const projectedPositionMean = massWeightedVector(projected, 'positionM');
    const projectedVelocityMean = massWeightedVector(projected, 'velocityMPerS');
    for (const update of projected) {
        update.positionM = update.positionM.map(
            (value, axis) => value + samplePositionMean[axis] - projectedPositionMean[axis],
        );
        update.velocityMPerS = update.velocityMPerS.map(
            (value, axis) => value + sampleVelocityMean[axis] - projectedVelocityMean[axis],
        );
    }

    return Object.freeze(projected.map(update => Object.freeze({
        handle: update.handle,
        positionM: Object.freeze(update.positionM),
        velocityMPerS: Object.freeze(update.velocityMPerS),
    })));
}

export default projectMatterKinematicSamplesToPackets;
