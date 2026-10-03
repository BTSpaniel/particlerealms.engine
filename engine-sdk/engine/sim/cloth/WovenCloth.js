// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { PBDSolver } from '../physics/PBDSolver.js';
import { FIBER_MATERIALS, WEAVE_TYPES } from './FiberMaterials.js';
import { normalizeClothMaterial } from './triangular/materials.js';
import { WovenClothContacts } from './WovenClothContacts.js';
import { WovenClothWeaveConstraint } from './WovenClothWeaveConstraint.js';
import { WovenClothSelfContact } from './WovenClothSelfContact.js';
import { configureTensileBreakForce } from '../deformables/rope/ParticleChainTopology.js';
export { FIBER_MATERIALS, WEAVE_TYPES };
export { GpuWovenCloth } from './GpuWovenCloth.js';

/** Separate warp and weft particles, using the editor's existing XPBD solver. */
export class WovenCloth {
    constructor({ columns = 25, rows = 25, width = 3, height = 2.5, top = 3.5,
        radius = 0.009, density = 0.18, tearForce = 18, pinned = 'edge', fiber = 'cotton', weave = 'plain', material = null } = {}) {
        if (![columns, rows].every(n => Number.isInteger(n) && n >= 3 && n <= 65)
            || ![width, height, radius, density, tearForce].every(n => Number.isFinite(n) && n > 0)
            || !Number.isFinite(top) || !['edge', 'corners', 'none'].includes(pinned)
            || !['cotton', 'wool', 'silk', 'nylon', 'hemp'].includes(fiber) || !Object.hasOwn(WEAVE_TYPES, weave)) {
            throw new RangeError('Invalid woven cloth dimensions, material or pinning');
        }
        Object.assign(this, { columns, rows, width, height, top, radius, tearForce, fiber, weave });
        this.fiberProperties = FIBER_MATERIALS[fiber];
        this.material = normalizeClothMaterial(material ?? { id: fiber, role: 'fabric', estimatedPreset: 'woven-light',
            arealMassKgM2: { value: density, status: 'estimated', source: 'User-selected Playground areal mass' } });
        // Paired forward/backward sweeps avoid alternating residuals becoming
        // velocities on every substep of a hanging, tightly woven sheet.
        this.solver = new PBDSolver({ substeps: 4, iterations: 4, damping: this.fiberProperties.damping,
            enableSleep: false, selfCollision: false, useOGC: false, groundY: radius,
            maxVelocity: 45, contactRadius: radius });
        this.warp = []; this.weft = []; this.threads = []; this.edges = []; this.cells = []; this.crossings = [];
        this.stats = { particles: columns * rows * 2, threads: columns + rows,
            broken: 0, contacts: 0, steps: 0, maximumForce: 0 };
        this._topologyDirty = false;
        const inverseMass = columns * rows * 2 / (width * height * this.material.mass);
        for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
            const fixed = y === 0 && (pinned === 'edge' || (pinned === 'corners' && (x === 0 || x === columns - 1)));
            const z = this.crossingSign(x, y) * radius;
            const px = width * (x / (columns - 1) - 0.5), py = top - height * y / (rows - 1);
            const a = this.solver.addParticle(px, py, z, fixed ? 0 : inverseMass);
            const b = this.solver.addParticle(px, py, -z, fixed ? 0 : inverseMass);
            a.radius = b.radius = radius;
            this.warp.push(a); this.weft.push(b);
            // Compliant crossing keeps the interlaced yarns in contact. They
            // remain separate masses; severing a yarn does not cut its neighbour.
            const crossing = this.solver.addDistanceConstraint(a, b, radius * 2, 1);
            crossing.compliance = 1e-7;
            this.crossings.push(crossing);
        }
        const makeThread = (particles, family) => {
            const edges = [];
            for (let i = 1; i < particles.length; i++) {
                const constraint = this.solver.addDistanceConstraint(particles[i - 1], particles[i], null, 1);
                constraint.compliance = 2e-7 * this.fiberProperties.elasticity / FIBER_MATERIALS.cotton.elasticity;
                configureTensileBreakForce(constraint, () => this.tearForce);
                const edge = { constraint, family, dependents: [] };
                edges.push(edge); this.edges.push(edge);
                constraint.fabricEdge = edge;
            }
            // Bending spans are removed with either underlying yarn segment.
            for (let i = 2; i < particles.length; i++) {
                const bend = this.solver.addDistanceConstraint(particles[i - 2], particles[i], null, 1);
                bend.compliance = 4e-4 * FIBER_MATERIALS.cotton.bendingStiffness / this.fiberProperties.bendingStiffness;
                const solveBend = bend.solve.bind(bend);
                bend.solve = dt => {
                    if (edges[i - 2].constraint.broken || edges[i - 1].constraint.broken) { bend.broken = true; return; }
                    solveBend(dt);
                };
                edges[i - 2].dependents.push(bend); edges[i - 1].dependents.push(bend);
            }
            this.threads.push({ particles, edges, family });
            return edges;
        };
        const vertical = [], horizontal = [];
        for (let x = 0; x < columns; x++) vertical.push(makeThread(Array.from({ length: rows }, (_, y) => this.warp[y * columns + x]), 'warp'));
        for (let y = 0; y < rows; y++) horizontal.push(makeThread(this.weft.slice(y * columns, (y + 1) * columns), 'weft'));
        for (let y = 0; y < rows - 1; y++) for (let x = 0; x < columns - 1; x++) {
            this.cells.push({ indices: [y * columns + x, y * columns + x + 1,
                (y + 1) * columns + x + 1, (y + 1) * columns + x],
                edges: [vertical[x][y], vertical[x + 1][y], horizontal[y][x], horizontal[y + 1][x]] });
        }
        this.solver.onConstraintBreak = constraint => {
            if (!constraint.fabricEdge) return;
            this.stats.broken++;
            this._topologyDirty = true;
            for (const bend of constraint.fabricEdge.dependents) bend.broken = true;
        };
        this._contacts = new WovenClothContacts(this);
        this._weave = new WovenClothWeaveConstraint(this);
        this._selfContact = new WovenClothSelfContact(this);
        this.solver.constraints.push({ type: 'woven-contact', lambda: 0, solve: dt => { this._weave.solve(dt); this._contacts.solve(); } });
        this.solver.postSubstepCallback = () => {
            if (this._topologyDirty) this.updateTornCrossings();
            this._selfContact.solve(); this._contacts.solve();
        };
        this.rest = this.solver.particles.map(p => [p.x, p.y, p.z, p.invMass]);
    }

    releasePins() { for (const p of this.solver.particles) if (p.invMass === 0) p.invMass = this.rest.find(r => r[3] > 0)[3]; }

    /** An exposed crossing is no longer locked into a surrounding weave. */
    updateTornCrossings() {
        for (let i = 0; i < this.crossings.length; i++) {
            if (this.crossings[i].broken) continue;
            if (this._weave.incident[i].every(cell => cell.edges.some(edge => edge.constraint.broken))) {
                this.crossings[i].broken = true;
                this.stats.releasedCrossings = (this.stats.releasedCrossings ?? 0) + 1;
            }
        }
        this._topologyDirty = false;
    }

    crossingSign(x, y) {
        const over = this.weave === 'plain' ? (x + y) % 2 === 0
            : this.weave === 'twill' ? (x + y) % 4 < 2 : (x + 2 * y) % 5 < 4;
        return over ? 1 : -1;
    }

    /** One-way air drag from sampled Flow velocities (m/s), per yarn mass.
     * Exact exponential relaxation cannot overshoot the sampled air velocity.
     * Projected cell area is shared by the two crossing yarn masses.
     */
    applyAirVelocities(velocities, dt) {
        if (velocities?.length !== this.solver.particles.length * 3 || !velocities.every(Number.isFinite)
            || !Number.isFinite(dt) || dt <= 0 || dt > 1 / 30) throw new RangeError('Invalid cloth airflow samples');
        const area = this.width * this.height / this.solver.particles.length;
        let impulse = 0;
        this.solver.particles.forEach((p, i) => {
            if (p.isFixed()) return;
            const delta = [velocities[i * 3] - p.vx, velocities[i * 3 + 1] - p.vy, velocities[i * 3 + 2] - p.vz];
            const speed = Math.hypot(...delta), blend = -Math.expm1(-.5 * 1.225 * area * speed * p.invMass * dt);
            p.vx += delta[0] * blend; p.vy += delta[1] * blend; p.vz += delta[2] * blend;
            impulse += speed * blend / p.invMass;
        });
        this.stats.airImpulse = (this.stats.airImpulse ?? 0) + impulse;
    }

    /** Projectiles have position/previous/radius/mass and a mutable impulse[3]. */
    step(dt, projectiles = [], wind = 0) {
        if (!Number.isFinite(dt) || dt <= 0 || dt > 1 / 30 || !Number.isFinite(wind)) throw new RangeError('Use bounded cloth steps');
        for (const body of projectiles) if (![body.radius, body.mass].every(n => Number.isFinite(n) && n > 0)
            || ![body.position, body.previous, body.impulse].every(v => v?.length === 3 && v.every(Number.isFinite))) {
            throw new RangeError('Invalid cloth projectile');
        }
        const substeps = this.solver.substeps;
        // Resolve travel in intervals smaller than a sphere radius. The native
        // body is corrected alongside the fabric, not after it crosses through.
        const count = projectiles.reduce((n, sphere) => Math.max(n, Math.ceil(Math.hypot(...sphere.position.map((v, i) => v - sphere.previous[i])) / (sphere.radius * .5))), substeps);
        if (count > 128) throw new RangeError('Projectile travel exceeds cloth contact budget');
        const h = dt / count;
        this.solver.gravity[2] = wind;
        this._contacts.begin(projectiles, dt);
        this.solver.substeps = 1;
        try {
            for (let i = 0; i < count; i++) {
                if (this._topologyDirty) this.updateTornCrossings();
                this._weave.reset();
                this._contacts.advance(h);
                this.solver.step(h);
                this._contacts.commit(h);
            }
            this._contacts.finish();
        } finally { this.solver.substeps = substeps; }
        this.stats.steps++;
        this.stats.maximumForce = this.edges.reduce((peak, edge) => Math.max(peak, Math.abs(edge.constraint.lambda) / (h * h)), this.stats.maximumForce);
    }

    /** Cut one real yarn segment near a world-space point, never a visual mask. */
    cut(point, radius = 0.15) {
        let count = 0;
        for (const { constraint: c } of this.edges) {
            if (c.broken) continue;
            const a = c.particleA, b = c.particleB;
            const delta = [b.x - a.x, b.y - a.y, b.z - a.z];
            const length2 = delta.reduce((sum, n) => sum + n * n, 0);
            const t = Math.max(0, Math.min(1, ((point[0] - a.x) * delta[0] + (point[1] - a.y) * delta[1] + (point[2] - a.z) * delta[2]) / Math.max(length2, 1e-12)));
            if (Math.hypot(a.x + t * delta[0] - point[0], a.y + t * delta[1] - point[1], a.z + t * delta[2] - point[2]) <= radius) { c.broken = true; count++; }
        }
        if (count) this._topologyDirty = true;
        return count;
    }

    dispose() {
        this._contacts.bodies = []; this.solver.reset();
        this._contacts.edgeCells.clear();
        this._selfContact.dispose(); this.crossings.length = 0;
        this.solver.particles.length = this.solver.constraints.length = 0;
        this.solver._gsOthers = this.solver._gsAttachments = this.solver.colorGroups = null;
        this.solver.onConstraintBreak = this.solver.postSubstepCallback = null;
        this.threads.length = this.edges.length = this.cells.length = this.warp.length = this.weft.length = 0;
        this.rest.length = 0;
    }
}
