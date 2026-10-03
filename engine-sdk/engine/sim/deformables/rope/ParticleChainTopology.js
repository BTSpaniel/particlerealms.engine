// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Native distance constraints store XPBD multipliers, not forces in newtons. */
export function configureTensileBreakForce(constraint, force) {
    const nativeFracture = Object.hasOwn(constraint, 'breakForce');
    let limit = Infinity;
    Object.defineProperty(constraint, 'breakForce', { configurable: true,
        get() { return this.lambda <= 0 ? limit : Infinity; }, set(value) { limit = value; } });
    const solve = constraint.solve;
    constraint.solve = dt => {
        if (constraint.broken) return;
        limit = force() * dt * dt;
        if (!nativeFracture) {
            const a = constraint.particleA, b = constraint.particleB, weight = a.invMass + b.invMass;
            const extension = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) - constraint.restLength;
            if (weight > 0 && extension * constraint.stiffness / weight > limit) { constraint.broken = true; return; }
            // Spring damping must not reverse relative velocity for light masses.
            if (weight * constraint.stiffness > 0 && constraint.dampingCoeff !== undefined) {
                constraint.dampingCoeff = Math.min(constraint.dampingCoeff, 1 / (weight * constraint.stiffness));
            }
        }
        solve.call(constraint, dt);
    };
}

/** Structural chain edges and the bending/LRA constraints supported by them. */
export class ParticleChainTopology {
    constructor(sim, threads, force) {
        this.sim = sim;
        this.threads = threads;
        this.force = force;
        this.locations = new Map();
        this.edges = threads.map(thread => new Array(thread.length - 1));
        threads.forEach((thread, t) => thread.forEach((p, i) => this.locations.set(p, { t, i })));
        for (const c of sim.solver.constraints) {
            const a = this.locations.get(c.particleA), b = this.locations.get(c.particleB);
            if (a && b && a.t === b.t && Math.abs(a.i - b.i) === 1 && c.restLength !== undefined && !c.particleC) {
                const i = Math.min(a.i, b.i);
                this.edges[a.t][i] = c;
                c.chainEdge = { thread: a.t, index: i };
                // The underlying XPBD solver tests |lambda|. Only a tensile
                // multiplier may fracture a yarn; compression cannot tear it.
                configureTensileBreakForce(c, this.force);
            }
        }
        for (const c of sim.solver.constraints) {
            if (c.chainEdge) continue;
            const locations = [c.particleA, c.particleB, c.particleC, c.anchorParticle, c.targetParticle]
                .map(p => this.locations.get(p)).filter(Boolean);
            if (locations.length < 2) continue;
            const lo = Math.min(...locations.map(p => p.i)), hi = Math.max(...locations.map(p => p.i));
            const dependencies = [...new Set(locations.map(p => p.t))].flatMap(t => this.edges[t].slice(lo, hi)).filter(Boolean);
            if (!dependencies.length) continue;
            c.chainDependencies = dependencies;
            const solve = c.solve;
            c.solve = dt => { if (dependencies.every(edge => !edge.broken)) solve.call(c, dt); };
        }
        sim.torn = false;
        sim.tearIndices = [];
        sim.solver.onConstraintBreak = c => {
            if (!c.chainEdge) return;
            sim.torn = true;
            const i = sim.particles.indexOf(c.particleA), j = sim.particles.indexOf(c.particleB);
            const index = Math.min(i, j);
            if (!sim.tearIndices.includes(index)) sim.tearIndices.push(index);
            sim.tearIndices.sort((a, b) => a - b);
            console.debug('[ParticleChainTopology] severed structural edge', c.chainEdge);
        };
    }

    /** Apply projection only within an intact span, retaining its real pins. */
    project(projector, fixedStart, fixedEnd, ...args) {
        this.threads.forEach((thread, t) => {
            let start = 0;
            for (let end = 1; end <= thread.length; end++) {
                if (end < thread.length && !this.edges[t][end - 1]?.broken) continue;
                if (end - start > 1) projector(thread.slice(start, end),
                    this.edges[t][start]?.restLength ?? this.sim.restSegmentLength,
                    start === 0 && fixedStart, end === thread.length && fixedEnd, ...args);
                start = end;
            }
        });
    }

    /** End-to-end body coupling is valid only while a material path survives. */
    get connected() {
        if (!this.sim.torn) return true;
        const neighbours = new Map(this.sim.particles.map(p => [p, []]));
        for (const c of this.sim.solver.constraints) {
            if (c.broken || c.chainDependencies?.some(edge => edge.broken)) continue;
            const a = c.particleA, b = c.particleB;
            if (!neighbours.has(a) || !neighbours.has(b)) continue;
            neighbours.get(a).push(b); neighbours.get(b).push(a);
        }
        const targets = new Set(this.threads.map(t => t[t.length - 1]));
        const queue = this.threads.map(t => t[0]), seen = new Set(queue);
        for (let i = 0; i < queue.length; i++) {
            if (targets.has(queue[i])) return true;
            for (const next of neighbours.get(queue[i])) if (!seen.has(next)) { seen.add(next); queue.push(next); }
        }
        return false;
    }
}
