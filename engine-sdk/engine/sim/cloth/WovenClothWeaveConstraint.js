// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** XPBD separation with reactions on every mass defining the surface normal.
 * Moving only the crossing pair injects energy as the fabric bends.
 * Reusable scratch arrays keep the per-crossing solve allocation-free.
 */
export class WovenClothWeaveConstraint {
    constructor(cloth) {
        this.cloth = cloth;
        this.lambda = new Float64Array(cloth.warp.length);
        this.incident = Array.from({ length: cloth.warp.length }, () => []);
        for (const cell of cloth.cells) for (const i of cell.indices) this.incident[i].push(cell);
        this.particles = cloth.warp.flatMap((p, i) => [p, cloth.weft[i]]);
        this.gradients = new Float64Array(this.particles.length * 3);
        this.touched = [];
        this.stamps = new Uint32Array(this.particles.length);
        this.generation = 0;
        this.faces = new Float64Array(24);
        this.faceCells = [];
    }

    reset() { this.lambda.fill(0); }

    add(index, x, y, z) {
        const offset = index * 3, g = this.gradients;
        if (this.stamps[index] !== this.generation) {
            this.stamps[index] = this.generation; this.touched.push(index);
            g[offset] = x; g[offset + 1] = y; g[offset + 2] = z;
        } else { g[offset] += x; g[offset + 1] += y; g[offset + 2] += z; }
    }

    addMidpoint(index, x, y, z) {
        this.add(index * 2, x * .5, y * .5, z * .5);
        this.add(index * 2 + 1, x * .5, y * .5, z * .5);
    }

    solve(dt) {
        const { warp, weft, radius, columns } = this.cloth;
        const alpha = 1e-7 / (dt * dt), f = this.faces, g = this.gradients;
        for (let index = 0; index < warp.length; index++) {
            const a = warp[index], b = weft[index];
            if (!a.invMass && !b.invMass) continue;
            let nx = 0, ny = 0, nz = 0, count = 0;
            for (const cell of this.incident[index]) {
                if (cell.edges.some(edge => edge.constraint.broken)) continue;
                const o = cell.indices[0], down = cell.indices[3], right = cell.indices[1];
                const ox = (warp[o].x + weft[o].x) * .5, oy = (warp[o].y + weft[o].y) * .5, oz = (warp[o].z + weft[o].z) * .5;
                const ux = (warp[down].x + weft[down].x) * .5 - ox, uy = (warp[down].y + weft[down].y) * .5 - oy, uz = (warp[down].z + weft[down].z) * .5 - oz;
                const vx = (warp[right].x + weft[right].x) * .5 - ox, vy = (warp[right].y + weft[right].y) * .5 - oy, vz = (warp[right].z + weft[right].z) * .5 - oz;
                nx += uy * vz - uz * vy; ny += uz * vx - ux * vz; nz += ux * vy - uy * vx;
                const offset = count * 6;
                f[offset] = ux; f[offset + 1] = uy; f[offset + 2] = uz;
                f[offset + 3] = vx; f[offset + 4] = vy; f[offset + 5] = vz;
                this.faceCells[count++] = cell;
            }
            const magnitude = Math.hypot(nx, ny, nz);
            if (magnitude < 1e-12) { this.lambda[index] = 0; continue; }
            nx /= magnitude; ny /= magnitude; nz /= magnitude;
            const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
            const sign = this.cloth.crossingSign(index % columns, Math.floor(index / columns));
            const projection = dx * nx + dy * ny + dz * nz, value = sign * projection - radius * 2;
            if (value >= 0 && this.lambda[index] === 0) continue;
            this.generation = (this.generation + 1) >>> 0;
            if (!this.generation) { this.stamps.fill(0); this.generation = 1; }
            this.touched.length = 0;
            this.add(index * 2, sign * nx, sign * ny, sign * nz);
            this.add(index * 2 + 1, -sign * nx, -sign * ny, -sign * nz);
            const gx = sign * (dx - nx * projection) / magnitude;
            const gy = sign * (dy - ny * projection) / magnitude;
            const gz = sign * (dz - nz * projection) / magnitude;
            for (let j = 0; j < count; j++) {
                const offset = j * 6, cell = this.faceCells[j];
                const ux = f[offset], uy = f[offset + 1], uz = f[offset + 2];
                const vx = f[offset + 3], vy = f[offset + 4], vz = f[offset + 5];
                const ax = vy * gz - vz * gy, ay = vz * gx - vx * gz, az = vx * gy - vy * gx;
                const bx = gy * uz - gz * uy, by = gz * ux - gx * uz, bz = gx * uy - gy * ux;
                this.addMidpoint(cell.indices[0], -ax - bx, -ay - by, -az - bz);
                this.addMidpoint(cell.indices[3], ax, ay, az);
                this.addMidpoint(cell.indices[1], bx, by, bz);
            }
            let denominator = alpha;
            for (const i of this.touched) {
                const o = i * 3;
                denominator += this.particles[i].invMass * (g[o] * g[o] + g[o + 1] * g[o + 1] + g[o + 2] * g[o + 2]);
            }
            const old = this.lambda[index];
            this.lambda[index] = Math.max(0, old + (-value - alpha * old) / denominator);
            const change = this.lambda[index] - old;
            for (const i of this.touched) {
                const p = this.particles[i], scale = change * p.invMass, o = i * 3;
                p.x += g[o] * scale; p.y += g[o + 1] * scale; p.z += g[o + 2] * scale;
            }
        }
    }
}
