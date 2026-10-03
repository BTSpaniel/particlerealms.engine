// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { PBDSolver } from '../physics/PBDSolver.js';
import { ParticleChainTopology } from '../deformables/rope/ParticleChainTopology.js';

/** Small endpoint-driven chains for slack and broken fibers. PhysX joints own
 * panel loads; these existing PBD chains resolve strand shape and free tips.
 * Positions run from the panel to the rod. Material ownership stays separate. */
export class SurfaceFieldSupportGeometry {
    constructor(supports, { segments = 6, groundY = 0 } = {}) {
        if (!Array.isArray(supports) || !Number.isInteger(segments) || segments < 2 || segments > 16 || !Number.isFinite(groundY)) throw new RangeError('Invalid support geometry');
        this.segments = segments; this.chains = new Map(); this.timeSeconds = 0;
        for (const support of supports) {
            if (this.chains.has(support.id) || ![support.anchor, support.attachment].every(p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite))) throw new RangeError('Invalid support endpoint');
            const solver = new PBDSolver({ substeps: 6, iterations: 3, gravity: [0, -9.80665, 0], damping: .99,
                selfCollision: false, enableSleep: false, useOGC: false, groundY });
            const length = Math.hypot(...support.anchor.map((v, k) => v - support.attachment[k]));
            if (!(length > 0)) throw new RangeError('Support has no length');
            const particles = Array.from({ length: segments + 1 }, (_, i) => {
                const position = support.attachment.map((v, k) => v + (support.anchor[k] - v) * i / segments);
                const particle = solver.addParticle(...position, i === 0 || i === segments ? 0 : 1);
                particle.radius = support.radiusM ?? .008; return particle;
            });
            for (let i = 0; i < segments; i++) solver.addDistanceConstraint(particles[i], particles[i + 1], length / segments);
            const sim = { solver, particles, restSegmentLength: length / segments };
            const topology = new ParticleChainTopology(sim, [particles], () => Infinity);
            this.chains.set(support.id, { solver, particles, sim, topology, anchor: [...support.anchor] });
        }
    }
    update(dt, supports, frames = []) {
        if (!Number.isFinite(dt) || dt < 0 || dt > .1) throw new RangeError('Invalid support geometry timestep');
        if (!Array.isArray(supports) || supports.length !== this.chains.size || !Array.isArray(frames)) throw new RangeError('Invalid support geometry frame');
        const seen = new Set(), materialIds = new Set();
        for (const support of supports) {
            const chain = this.chains.get(support.id);
            if (!chain || seen.has(support.id) || !Array.isArray(support.anchor) || support.anchor.length !== 3
                || support.anchor.some((v, i) => !Number.isFinite(v) || v !== chain.anchor[i])
                || support.attachment !== null && (!Array.isArray(support.attachment) || support.attachment.length !== 3 || support.attachment.some(v => !Number.isFinite(v)))) throw new RangeError('Invalid completed support endpoint');
            seen.add(support.id);
        }
        for (const row of frames) {
            const id = `${row.id}:${row.segment}`;
            if (!this.chains.has(row.id) || !Number.isInteger(row.segment) || row.segment < 0 || row.segment >= this.segments || materialIds.has(id)
                || !Number.isFinite(row.strengthFraction) || row.strengthFraction < 0 || row.strengthFraction > 1 || row.broken !== undefined && typeof row.broken !== 'boolean') throw new RangeError('Invalid completed support material');
            materialIds.add(id);
        }
        const material = new Map(frames.map(frame => [`${frame.id}:${frame.segment}`, frame]));
        for (const support of supports) {
            const chain = this.chains.get(support.id);
            if (!chain) throw new RangeError('Unknown support geometry');
            const { particles, topology, sim } = chain;
            particles[this.segments].invMass = 0; particles[this.segments].setPosition(...support.anchor);
            if (support.attachment) {
                particles[0].invMass = 0; particles[0].setPosition(...support.attachment);
            } else particles[0].invMass = 1;
            let cut = false, weakest = 0, strength = Infinity;
            for (let i = 0; i < this.segments; i++) {
                const state = material.get(`${support.id}:${i}`);
                if (state?.broken) { topology.edges[0][i].broken = true; cut = true; }
                if ((state?.strengthFraction ?? 1) < strength) { strength = state?.strengthFraction ?? 1; weakest = i; }
            }
            if (support.broken && !topology.edges[0].some(edge => edge.broken)) { topology.edges[0][weakest].broken = true; cut = true; }
            if (cut) sim.torn = true;
            if (dt > 0) chain.solver.step(dt);
        }
        this.timeSeconds += dt; return this.frame();
    }
    frame() {
        return [...this.chains].map(([id, chain]) => ({ id,
            positions: chain.particles.map(p => [p.x, p.y, p.z]),
            brokenSegments: chain.topology.edges[0].flatMap((edge, i) => edge.broken ? [i] : []) }));
    }
    snapshot() {
        return { version: 1, segments: this.segments, timeSeconds: this.timeSeconds, chains: [...this.chains].map(([id, chain]) => ({ id,
            particles: chain.particles.map(p => [p.x, p.y, p.z, p.px, p.py, p.pz, p.vx, p.vy, p.vz, p.invMass]),
            broken: chain.topology.edges[0].map(edge => !!edge.broken) })) };
    }
    restore(snapshot) {
        if (snapshot?.version !== 1 || snapshot.segments !== this.segments || !Number.isFinite(snapshot.timeSeconds) || snapshot.timeSeconds < 0
            || !Array.isArray(snapshot.chains) || snapshot.chains.length !== this.chains.size) throw new RangeError('Invalid support geometry checkpoint');
        const seen = new Set();
        for (const entry of snapshot.chains) {
            if (!this.chains.has(entry.id) || seen.has(entry.id) || entry.particles?.length !== this.segments + 1 || entry.broken?.length !== this.segments
                || entry.broken.some(value => typeof value !== 'boolean') || entry.particles.some((p, i) => !Array.isArray(p) || p.length !== 10 || p.some(v => !Number.isFinite(v))
                    || (i === 0 ? ![0, 1].includes(p[9]) : p[9] !== (i === this.segments ? 0 : 1)))
                || this.chains.get(entry.id).anchor.some((v, k) => entry.particles[this.segments][k] !== v)) throw new RangeError('Invalid support strand checkpoint');
            seen.add(entry.id);
        }
        for (const entry of snapshot.chains) {
            const chain = this.chains.get(entry.id);
            entry.particles.forEach((values, i) => ['x', 'y', 'z', 'px', 'py', 'pz', 'vx', 'vy', 'vz', 'invMass'].forEach((key, k) => { chain.particles[i][key] = values[k]; }));
            entry.broken.forEach((broken, i) => { chain.topology.edges[0][i].broken = broken; });
            chain.sim.torn = entry.broken.some(Boolean);
        }
        this.timeSeconds = snapshot.timeSeconds; return this;
    }
    dispose() { this.chains.clear(); }
}
