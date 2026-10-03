// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { triangleClosestPointWithWeights, closestPointOnSegment } from '../../core/math/MathGeometry.js';

/** Mass-weighted sphere/panel contacts, solved with the yarn constraints. */
export class WovenClothContacts {
    constructor(cloth) {
        this.cloth = cloth;
        this.bodies = [];
        this.edgeCells = new Map(cloth.edges.map(edge => [edge, []]));
        for (const cell of cloth.cells) for (const edge of cell.edges) this.edgeCells.get(edge).push(cell);
    }

    begin(projectiles, dt) {
        this.bodies = projectiles.map(source => {
            const velocity = source.position.map((v, i) => (v - source.previous[i]) / dt);
            return { source, position: [...source.previous], previous: [...source.previous],
                velocity, initialVelocity: [...velocity], inverseMass: 1 / source.mass };
        });
    }

    advance(dt) {
        for (const body of this.bodies) for (let axis = 0; axis < 3; axis++) {
            body.previous[axis] = body.position[axis];
            body.position[axis] += body.velocity[axis] * dt;
        }
    }

    solve() {
        const { warp, weft, cells, radius } = this.cloth;
        for (const body of this.bodies) {
            const target = body.source.radius + radius;
            for (const cell of cells) {
                // Collision topology matches the rendered surface after a tear.
                if (cell.edges.some(edge => edge.constraint.broken)) continue;
                const points = cell.indices.map(i => [
                    (warp[i].x + weft[i].x) * .5, (warp[i].y + weft[i].y) * .5, (warp[i].z + weft[i].z) * .5,
                ]);
                if ([0, 1, 2].some(axis => body.position[axis] < Math.min(...points.map(p => p[axis])) - target
                    || body.position[axis] > Math.max(...points.map(p => p[axis])) + target)) continue;
                for (const corners of [[0, 1, 2], [0, 2, 3]]) {
                    const vertices = corners.map(i => points[i]);
                    const closest = triangleClosestPointWithWeights(body.position, ...vertices);
                    const nodes = corners.flatMap((corner, j) => [warp[cell.indices[corner]], weft[cell.indices[corner]]]
                        .map(p => ({ p, weight: closest.weights[j] * .5 })));
                    this.project(body, closest.point, nodes, target);
                }
            }
            // A torn panel disappears, but its surviving yarns still collide.
            for (const [edge, adjacent] of this.edgeCells) {
                if (edge.constraint.broken || adjacent.some(cell => cell.edges.every(e => !e.constraint.broken))) continue;
                const a = edge.constraint.particleA, b = edge.constraint.particleB;
                const start = [a.x, a.y, a.z], end = [b.x, b.y, b.z];
                if ([0, 1, 2].some(i => body.position[i] < Math.min(start[i], end[i]) - target
                    || body.position[i] > Math.max(start[i], end[i]) + target)) continue;
                const closest = closestPointOnSegment(body.position, start, end);
                const length = Math.hypot(...end.map((v, i) => v - start[i]));
                const t = length > 1e-10 ? Math.hypot(...closest.map((v, i) => v - start[i])) / length : 0;
                this.project(body, closest, [{ p: a, weight: 1 - t }, { p: b, weight: t }], target);
            }
        }
    }

    project(body, point, nodes, target) {
        const delta = body.position.map((v, i) => v - point[i]), distance = Math.hypot(...delta);
        if (distance >= target) return;
        const fallback = body.previous.map((v, i) => v - point[i]), length = Math.hypot(...fallback);
        const normal = distance > 1e-10 ? delta.map(v => v / distance)
            : length > 1e-10 ? fallback.map(v => v / length) : [0, 0, 1];
        const inverseMass = nodes.reduce((sum, { p, weight }) => sum + weight * weight * p.invMass, body.inverseMass);
        const lambda = (target - distance) / inverseMass;
        for (let i = 0; i < 3; i++) body.position[i] += normal[i] * lambda * body.inverseMass;
        for (const { p, weight } of nodes) {
            const scale = lambda * weight * p.invMass;
            p.x -= normal[0] * scale; p.y -= normal[1] * scale; p.z -= normal[2] * scale;
        }
        this.cloth.stats.contacts++;
    }

    commit(dt) {
        for (const body of this.bodies) for (let axis = 0; axis < 3; axis++) {
            body.velocity[axis] = (body.position[axis] - body.previous[axis]) / dt;
        }
    }

    finish() {
        for (const body of this.bodies) for (let axis = 0; axis < 3; axis++) {
            body.source.position[axis] = body.position[axis];
            body.source.impulse[axis] += (body.velocity[axis] - body.initialVelocity[axis]) / body.inverseMass;
        }
        this.bodies = [];
    }
}
