// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PatternLayout.js — deterministic instance layouts for repeated features.
 *
 * A bolt circle, a run of fence posts, a row of balusters: these are one part
 * repeated on a rule, not many authored parts. Emitting the RULE keeps documents
 * small and keeps the spacing exact, and because every layout is a pure function
 * of its arguments the resulting transforms fold straight into a geometry key.
 *
 * Layouts return plain `{ translation, rotationRadians, index }` records rather
 * than matrices, so callers can compose them with whatever transform convention
 * they already use. Rotation is a single angle about the layout's own axis, which
 * is all a circular or path pattern needs; anything richer belongs in the caller.
 *
 * Right-handed, +Y up. Circular patterns lie in the XZ plane by default so they
 * read as bolt circles on a horizontal flange.
 */

const EPSILON = 1e-12;
const TAU = Math.PI * 2;

function finiteVector3(value, label) {
    if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
        throw new Error(`PatternLayout: ${label} must be three finite numbers`);
    }
    return [...value];
}

function positiveInteger(value, label, maximum = 4096) {
    const count = Math.floor(Number(value));
    if (!Number.isFinite(count) || count < 1 || count > maximum) {
        throw new Error(`PatternLayout: ${label} must be an integer within 1..${maximum}`);
    }
    return count;
}

/**
 * Evenly spaced instances around a circle.
 *
 * `align` rotates each instance to face along the circle, which is what a bolt
 * head or a spoke wants; without it every instance keeps the source orientation,
 * which is what a lamp on a ring wants.
 *
 * @param {object} options
 * @param {number} options.count Instances around the circle.
 * @param {number} options.radiusMeters
 * @param {number[]} [options.centerMeters]
 * @param {number} [options.startAngleDegrees]
 * @param {number} [options.sweepDegrees] Total arc covered; 360 closes the ring.
 * @param {boolean} [options.align] Rotate each instance to face outward.
 * @param {'xz'|'xy'|'zy'} [options.plane]
 * @returns {ReadonlyArray<{index:number, translation:number[], rotationRadians:number}>}
 */
export function circularPattern({
    count,
    radiusMeters,
    centerMeters = [0, 0, 0],
    startAngleDegrees = 0,
    sweepDegrees = 360,
    align = true,
    plane = 'xz',
} = {}) {
    const instances = positiveInteger(count, 'count');
    const radius = Number(radiusMeters);
    if (!Number.isFinite(radius) || radius < 0) {
        throw new Error('PatternLayout: radiusMeters must be a non-negative finite number');
    }
    const center = finiteVector3(centerMeters, 'centerMeters');
    const sweep = Number(sweepDegrees);
    if (!Number.isFinite(sweep) || Math.abs(sweep) > 360) {
        throw new Error('PatternLayout: sweepDegrees must be finite and within -360..360');
    }
    if (!['xz', 'xy', 'zy'].includes(plane)) {
        throw new Error(`PatternLayout: plane '${plane}' must be one of xz, xy, zy`);
    }
    // A full ring divides by count so first and last do not collide; a partial arc
    // divides by the gaps so both ends land exactly on the requested sweep.
    const closed = Math.abs(Math.abs(sweep) - 360) < 1e-9;
    const divisor = closed ? instances : Math.max(1, instances - 1);
    const start = (Number(startAngleDegrees) || 0) * (Math.PI / 180);
    const step = (sweep * (Math.PI / 180)) / divisor;
    const records = [];
    for (let index = 0; index < instances; index++) {
        const angle = start + step * index;
        const across = Math.cos(angle) * radius;
        const along = Math.sin(angle) * radius;
        const offset = plane === 'xz'
            ? [across, 0, along]
            : (plane === 'xy' ? [across, along, 0] : [0, along, across]);
        records.push(Object.freeze({
            index,
            translation: Object.freeze([
                center[0] + offset[0],
                center[1] + offset[1],
                center[2] + offset[2],
            ]),
            rotationRadians: align ? angle : 0,
        }));
    }
    return Object.freeze(records);
}

/**
 * Instances distributed along a polyline by ARC LENGTH.
 *
 * Spacing by arc length rather than by vertex means a path with unevenly spaced
 * control points still produces evenly spaced posts. `rotationRadians` is the
 * heading of the path at each station, so instances follow the run.
 *
 * Supply either `count` (that many instances spread across the whole path) or
 * `spacingMeters` (as many as fit at that pitch). Supplying both is rejected
 * rather than silently preferring one.
 *
 * @param {number[][]} pathMeters Polyline of [x, y, z] points.
 * @param {object} options
 * @param {number} [options.count]
 * @param {number} [options.spacingMeters]
 * @param {boolean} [options.closed] Treat the path as a loop.
 * @param {boolean} [options.includeEnd] Place an instance on the final point.
 */
export function pathPattern(pathMeters, {
    count = null,
    spacingMeters = null,
    closed = false,
    includeEnd = true,
} = {}) {
    if (!Array.isArray(pathMeters) || pathMeters.length < 2) {
        throw new Error('PatternLayout: pathMeters needs at least two points');
    }
    const points = pathMeters.map((point, index) => finiteVector3(point, `pathMeters[${index}]`));
    if (count != null && spacingMeters != null) {
        throw new Error('PatternLayout: supply either count or spacingMeters, not both');
    }
    if (count == null && spacingMeters == null) {
        throw new Error('PatternLayout: supply count or spacingMeters');
    }

    const segments = [];
    let perimeter = 0;
    const limit = closed ? points.length : points.length - 1;
    for (let index = 0; index < limit; index++) {
        const from = points[index];
        const to = points[(index + 1) % points.length];
        const delta = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
        const length = Math.hypot(delta[0], delta[1], delta[2]);
        if (length <= EPSILON) continue;
        segments.push({ from, delta, length, start: perimeter });
        perimeter += length;
    }
    if (segments.length === 0 || perimeter <= EPSILON) {
        throw new Error('PatternLayout: pathMeters has zero length');
    }

    let instances;
    let step;
    if (count != null) {
        instances = positiveInteger(count, 'count');
        const divisor = closed || !includeEnd ? instances : Math.max(1, instances - 1);
        step = perimeter / divisor;
    } else {
        const pitch = Number(spacingMeters);
        if (!Number.isFinite(pitch) || pitch <= 0) {
            throw new Error('PatternLayout: spacingMeters must be a positive finite number');
        }
        step = pitch;
        instances = Math.floor(perimeter / pitch + 1e-9) + (closed ? 0 : 1);
        instances = Math.max(1, Math.min(4096, instances));
    }

    const records = [];
    for (let index = 0; index < instances; index++) {
        const distance = Math.min(perimeter, step * index);
        let segment = segments[segments.length - 1];
        for (const candidate of segments) {
            if (distance <= candidate.start + candidate.length + 1e-12) { segment = candidate; break; }
        }
        const t = Math.min(1, Math.max(0, (distance - segment.start) / segment.length));
        records.push(Object.freeze({
            index,
            translation: Object.freeze([
                segment.from[0] + segment.delta[0] * t,
                segment.from[1] + segment.delta[1] * t,
                segment.from[2] + segment.delta[2] * t,
            ]),
            // Heading in the XZ plane, which is the axis a post or picket turns about.
            rotationRadians: Math.atan2(segment.delta[0], segment.delta[2]),
            distanceMeters: distance,
        }));
    }
    return Object.freeze(records);
}

/** Total arc length of a polyline, the figure a path pattern spaces against. */
export function pathLengthMeters(pathMeters, { closed = false } = {}) {
    if (!Array.isArray(pathMeters) || pathMeters.length < 2) return 0;
    let total = 0;
    const limit = closed ? pathMeters.length : pathMeters.length - 1;
    for (let index = 0; index < limit; index++) {
        const from = pathMeters[index];
        const to = pathMeters[(index + 1) % pathMeters.length];
        total += Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    }
    return total;
}

export { TAU as PATTERN_FULL_TURN_RADIANS };
