// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { projectClothContacts } from './triangular/contact.js';

/** Adapt yarn masses to the editor's swept vertex/triangle and edge/edge contact.
 * Surface midpoints have their exact effective inverse mass. Exposed strands
 * retain their own endpoints; no contact feature is created across a torn edge.
 */
export class WovenClothSelfContact {
    constructor(cloth) { this.cloth = cloth; this.model = null; this.signature = ''; }

    rebuild() {
        const cloth = this.cloth, bindings = [], ids = new Map(), triangles = [], edges = new Map(), patches = [];
        const node = (key, particles) => {
            if (!ids.has(key)) { ids.set(key, bindings.length); bindings.push(particles); }
            return ids.get(key);
        };
        const edge = (a, b) => edges.set(a < b ? `${a}:${b}` : `${b}:${a}`, [a, b]);
        for (const cell of cloth.cells) {
            if (cell.edges.some(e => e.constraint.broken)) continue;
            const corners = cell.indices.map(i => node(`m${i}`, [cloth.warp[i], cloth.weft[i]]));
            patches.push(corners);
            for (const indices of [[0, 1, 2], [0, 2, 3]]) {
                const row = indices.map(i => corners[i]); triangles.push({ ids: row });
                for (let i = 0; i < 3; i++) edge(row[i], row[(i + 1) % 3]);
            }
        }
        const particleIds = new Map(cloth.solver.particles.map((p, i) => [p, i]));
        for (const [yarn, cells] of cloth._contacts.edgeCells) {
            if (yarn.constraint.broken || cells.some(c => c.edges.every(e => !e.constraint.broken))) continue;
            const ends = [yarn.constraint.particleA, yarn.constraint.particleB].map(p => node(`p${particleIds.get(p)}`, [p]));
            patches.push(ends); edge(...ends);
        }
        // Exclude connected local neighborhoods, including midpoint/strand
        // aliases at a frayed boundary. Remote folds remain collision candidates.
        const adjacent = new Map(cloth.solver.particles.map(p => [p, new Set([p])]));
        for (const c of [...cloth.edges.map(e => e.constraint), ...cloth.crossings]) if (!c.broken) {
            adjacent.get(c.particleA).add(c.particleB); adjacent.get(c.particleB).add(c.particleA);
        }
        const owners = new Map();
        bindings.forEach((ps, id) => ps.forEach(p => { if (!owners.has(p)) owners.set(p, []); owners.get(p).push(id); }));
        const neighbors = bindings.map((ps, id) => {
            const result = new Set([id]);
            for (const p of ps) for (const q of adjacent.get(p)) for (const r of adjacent.get(q)) {
                for (const other of owners.get(r) ?? []) result.add(other);
            }
            return result;
        });
        const count = bindings.length;
        this.bindings = bindings;
        this.patches = patches; this.triangles = triangles; this.edges = [...edges.values()];
        this.model = { positions: [], inverseMasses: [], triangles, edges: [...edges.values()], neighbors,
            clothVertexCount: count, configuration: { selfContact: true }, colliders: [], exclusions: new Set(),
            vertexDof: bindings.map((_, i) => i), vertexGroups: new Map(bindings.map((_, i) => [i, [i]])),
            // The broad-phase neighborhoods above follow the current topology.
            restChartContact: () => false,
            thicknesses: bindings.map(ps => ps.length === 1 ? cloth.radius * 2 : Math.min(cloth.radius, .02)),
            frictions: new Array(count).fill(.2) };
    }

    solve() {
        // A complete sheet whose swept grid lines remain ordered in x/y cannot
        // have remote overlapping patches. Adjacent material is excluded by
        // the same two-hop topology policy below. This cheap separating-axis
        // certificate avoids a BVH/CCD pass for an ordinary hanging sheet.
        const cloth = this.cloth;
        if (!cloth.edges.some(e => e.constraint.broken)) {
            const columns = Array.from({ length: cloth.columns }, () => [Infinity, -Infinity]);
            const rows = Array.from({ length: cloth.rows }, () => [Infinity, -Infinity]);
            for (let i = 0; i < cloth.warp.length; i++) for (const previous of [false, true]) {
                const a = cloth.warp[i], b = cloth.weft[i];
                const x = ((previous ? a.px : a.x) + (previous ? b.px : b.x)) * .5;
                const y = -((previous ? a.py : a.y) + (previous ? b.py : b.y)) * .5;
                const col = columns[i % cloth.columns], row = rows[Math.floor(i / cloth.columns)];
                col[0] = Math.min(col[0], x); col[1] = Math.max(col[1], x);
                row[0] = Math.min(row[0], y); row[1] = Math.max(row[1], y);
            }
            const thickness = Math.min(cloth.radius, .02);
            if ([columns, rows].every(lines => lines.every((line, i) => !i || line[0] - lines[i - 1][1] > thickness))) return;
        }
        const signature = this.cloth.edges.map(e => e.constraint.broken ? '1' : '0').join('');
        if (!this.model || this.signature !== signature) { this.signature = signature; this.rebuild(); }
        const model = this.model;
        if (!this.bindings.length) return;
        const previous = this.sync();
        // Reject separated swept patches before constructing the editor's finer
        // contact features. Flat hanging sheets need no narrow-phase solve.
        const patches = this.patches.map(ids => {
            const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
            for (const id of ids) for (let axis = 0; axis < 3; axis++) {
                min[axis] = Math.min(min[axis], previous[id][axis] - model.thicknesses[id] / 2, model.positions[id][axis] - model.thicknesses[id] / 2);
                max[axis] = Math.max(max[axis], previous[id][axis] + model.thicknesses[id] / 2, model.positions[id][axis] + model.thicknesses[id] / 2);
            }
            return { ids, min, max };
        }).sort((a, b) => a.min[0] - b.min[0]);
        const active = new Set();
        for (let i = 0; i < patches.length; i++) for (let j = i + 1; j < patches.length; j++) {
            const a = patches[i], b = patches[j];
            if (b.min[0] > a.max[0]) break;
            if (a.min[1] > b.max[1] || b.min[1] > a.max[1] || a.min[2] > b.max[2] || b.min[2] > a.max[2]) continue;
            if (a.ids.every(id => b.ids.every(other => model.neighbors[id].has(other)))) continue;
            for (const id of [...a.ids, ...b.ids]) active.add(id);
        }
        if (!active.size) return;
        model.triangles = this.triangles.filter(t => t.ids.every(id => active.has(id)));
        model.contactTopology = { vertices: [...active].map(id => [id]), edges: this.edges.filter(e => e.every(id => active.has(id))) };
        const before = model.positions.map(p => [...p]);
        this.cloth.stats.sweptContactSteps = (this.cloth.stats.sweptContactSteps ?? 0) + 1;
        // Yarn XPBD consumes only the corrected positions. The triangular
        // solver's cached elastic contacts and linearized block rows are unused.
        for (const correction of projectClothContacts(model, previous, { retainSolverState: false })) if (correction > 0) {
            this.cloth.stats.selfContacts = (this.cloth.stats.selfContacts ?? 0) + 1;
        }
        this.apply(before);
    }

    sync() {
        const average = (ps, fields) => fields.map(key => ps.reduce((sum, p) => sum + p[key], 0) / ps.length);
        this.model.positions = this.bindings.map(ps => average(ps, ['x', 'y', 'z']));
        this.model.inverseMasses = this.bindings.map(ps => ps.reduce((sum, p) => sum + p.invMass, 0) / ps.length ** 2);
        return this.bindings.map(ps => average(ps, ['px', 'py', 'pz']));
    }

    apply(before) {
        const model = this.model;
        this.bindings.forEach((ps, id) => {
            const inverseMass = model.inverseMasses[id];
            if (!inverseMass) return;
            const delta = model.positions[id].map((v, axis) => v - before[id][axis]);
            for (const p of ps) {
                const weight = p.invMass / (ps.length * inverseMass);
                p.x += delta[0] * weight; p.y += delta[1] * weight; p.z += delta[2] * weight;
            }
        });
    }

    dispose() { this.model = null; this.bindings = []; }
}
