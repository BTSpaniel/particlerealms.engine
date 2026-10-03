// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { BlastScene } from '../destruction/BlastScene.js';
import { ensurePhysXModule } from '../physics/PhysXModule.js';
import { createPhysicsWorld, destroyPhysicsWorld, createBody, removeBody, stepPhysicsWorld } from '../physics/PhysXPhysicsWorld.js';
import { SurfaceFieldSuspension, SURFACE_SUSPENSION_FORMAT } from './SurfaceFieldSuspension.js';

const FORMAT = 'particle-realms/surface-field-structure';
const positive = value => Number.isFinite(value) && Number.isFinite(Math.fround(value)) && Math.fround(value) > 0;

/** A finite calcite sheet delegates all islands, rigid motion and ownership to
 * existing NVIDIA Blast/PhysX. The chemical inventory owns dissolved mass;
 * this adapter removes contact area, never manufactures solid debris or fuel.
 * Box collision geometry stays authored until a completely dissolved leaf is
 * removed. Material coordinates remain attached to their stable storage ids.
 */
export class SurfaceFieldStructure {
    static async create(surfaceWorld, options = {}) {
        return this._open(surfaceWorld, options, null);
    }

    static async restore(surfaceWorld, snapshot, options = {}) {
        return this._open(surfaceWorld, options, snapshot);
    }

    static async _open(surfaceWorld, options, snapshot) {
        await ensurePhysXModule();
        const ownsWorld = !options.physicsWorld;
        const physicsWorld = options.physicsWorld ?? createPhysicsWorld({ gravity: [0, -9.80665, 0], maxStep: 1 / 120, maxSubSteps: 8,
            material: { restitution: .05, staticFriction: .65, dynamicFriction: .5 } });
        try {
            // createPhysicsWorld initializes on the loader promise's microtask.
            await ensurePhysXModule();
            if (!physicsWorld.ready || physicsWorld.destroyed) throw new Error('Surface structure requires a ready PhysX PE world');
            return options.suspended === true || snapshot?.format === SURFACE_SUSPENSION_FORMAT
                ? new SurfaceFieldSuspension(surfaceWorld, { ...options, physicsWorld, ownsWorld, snapshot })
                : new this(surfaceWorld, { ...options, physicsWorld, ownsWorld, snapshot });
        } catch (error) {
            if (ownsWorld) destroyPhysicsWorld(physicsWorld);
            throw error;
        }
    }

    constructor(surfaceWorld, { physicsWorld, ownsWorld = false, domain = null, anchoredCells = null, log = null, snapshot = null } = {}) {
        const topology = surfaceWorld?.topology;
        if (!topology?.address || !surfaceWorld?.chemicals?.cell) throw new TypeError('A chemical SurfaceFieldWorld is required');
        if (!physicsWorld?.ready || physicsWorld.destroyed) throw new Error('A ready native PhysX world is required');
        const selected = domain ?? topology.domains.findIndex(value => value.material === 'calcite');
        this.domain = typeof selected === 'string' ? topology.domains.findIndex(value => value.id === selected) : selected;
        const sheet = topology.domains[this.domain];
        if (!sheet || sheet.material !== 'calcite') throw new RangeError('Surface structure requires a calcite domain');
        if (sheet.tiltX !== 0 || sheet.tiltZ !== 0) throw new RangeError('The native calcite sheet requires a flat authored rest plane');
        this.surfaceWorld = surfaceWorld; this.topology = topology; this.physicsWorld = physicsWorld; this.ownsWorld = ownsWorld;
        this.log = log; this.disposed = false; this.timeSeconds = 0; this.scene = null; this.floor = null;
        this.cells = []; this._nativePoses = []; this._poses = new Float32Array(topology.count * 8);
        const n = topology.n, width = sheet.size[0] / n, length = sheet.size[1] / n, thickness = sheet.substrateDepthM;
        if (anchoredCells !== null && !Array.isArray(anchoredCells)) throw new TypeError('Anchored calcite cells must be an array');
        const anchors = anchoredCells === null ? null : new Set(anchoredCells);
        if (anchors && (anchors.size !== anchoredCells.length || [...anchors].some(value => !Number.isInteger(value) || value < 0 || value >= n * n)))
            throw new RangeError('Anchored calcite cells must be unique canonical chunk indices');
        const chunks = [], bonds = [], bondAreasM2 = [], bondCentroids = [], bondNormals = [];
        for (let y = 0; y < n; ++y) for (let x = 0; x < n; ++x) {
            const index = y * n + x;
            this.cells.push(topology.address(this.domain, x, y));
            chunks.push({ position: [(x + .5 - n / 2) * width, -thickness / 2, (y + .5 - n / 2) * length],
                halfExtents: [width / 2, thickness / 2, length / 2], anchored: anchors ? anchors.has(index) : x === 0 || x === n - 1 });
            for (const [other, normal, area] of [[x + 1 < n ? index + 1 : -1, [1, 0, 0], length * thickness],
                [y + 1 < n ? index + n : -1, [0, 0, 1], width * thickness]]) {
                if (other < 0) continue;
                bonds.push([index, other]); bondAreasM2.push(area); bondNormals.push(normal);
                bondCentroids.push([chunks[index].position[0] + normal[0] * width / 2, -thickness / 2,
                    chunks[index].position[2] + normal[2] * length / 2]);
            }
        }
        this.initialMassesKg = this.cells.map(index => surfaceWorld.chemicals.cell(index).initialCarbonateKg);
        if (!this.initialMassesKg.every(positive)) throw new RangeError('Native calcite chunks require positive finite initial chemical mass');
        this._chemicalMassesKg = [...this.initialMassesKg];
        this._restChunks = chunks; this._restBonds = bonds; this._restAreas = bondAreasM2;
        const density = this.initialMassesKg.reduce((sum, mass) => sum + mass, 0) / (sheet.size[0] * sheet.size[1] * thickness);
        try {
            if (snapshot) {
                this._validateSnapshot(snapshot, sheet);
                this.scene = BlastScene.restore(physicsWorld, snapshot.scene, { log });
                this._validateRestoredScene();
                this.timeSeconds = snapshot.timeSeconds;
                this._chemicalMassesKg = [...snapshot.chemicalMassesKg];
            } else {
                this.scene = new BlastScene(physicsWorld, { chunks, bonds, bondAreasM2, bondCentroids, bondNormals, density,
                    chunkMassesKg: this.initialMassesKg, position: [...sheet.center], contactOffset: Math.min(.00005, thickness / 8),
                    collisionGroups: [chunks.map((_, index) => index)], log });
                this.update();
            }
            if (ownsWorld) {
                const receiving = topology.domains.find(value => value.receiveRunoff);
                if (receiving) this.floor = createBody(physicsWorld, { entityId: `surface-calcite-floor:${crypto.randomUUID()}`, simMode: 'static',
                    position: [receiving.center[0], receiving.center[1] - .05, receiving.center[2]],
                    collider: { shape: 'box', halfExtents: [receiving.size[0] / 2, .05, receiving.size[1] / 2] } });
                if (receiving && !this.floor?._actor) throw new Error('Native calcite receiving floor failed to initialize');
                if (this.floor) {
                    const shape = physicsWorld.module.SupportFunctions.prototype.PxActor_getShape(this.floor._actor, 0);
                    if (!shape?.ptr) throw new Error('Native calcite receiving floor has no shape');
                    shape.setContactOffset(Math.min(.00005, thickness / 8));
                }
            }
            this.log?.('Surface calcite structure ready', { cells: this.cells.length, domain: sheet.id, massKg: this.totalMassKg });
        } catch (error) {
            this.scene?.dispose();
            if (this.floor) removeBody(physicsWorld, this.floor.handle);
            throw error;
        }
    }

    _validateSnapshot(snapshot, sheet) {
        if (!snapshot || snapshot.format !== FORMAT || snapshot.version !== 1 || snapshot.topology !== this.topology.identity
            || snapshot.domain !== sheet.id || !Number.isFinite(snapshot.timeSeconds) || snapshot.timeSeconds < 0
            || !Array.isArray(snapshot.cells) || snapshot.cells.length !== this.cells.length
            || snapshot.cells.some((value, index) => value !== this.cells[index])
            || !Array.isArray(snapshot.chemicalMassesKg) || snapshot.chemicalMassesKg.length !== this.cells.length
            || snapshot.chemicalMassesKg.some((value, index) => !Number.isFinite(value) || value < 0 || value > this.initialMassesKg[index]
                || value !== this.surfaceWorld.chemicals.cell(this.cells[index]).carbonateKg))
            throw new RangeError('Incompatible calcite structure checkpoint');
        const scene = snapshot.scene, graph = scene?.family?.graph;
        if (!Array.isArray(scene?.chunks) || scene.chunks.length !== this._restChunks.length
            || scene.chunks.some((chunk, index) => !['position', 'halfExtents'].every(key => Array.isArray(chunk[key])
                && chunk[key].length === 3 && chunk[key].every((value, axis) => value === this._restChunks[index][key][axis]))
                || chunk.anchored !== this._restChunks[index].anchored)
            || !Array.isArray(graph?.bonds) || graph.bonds.length !== this._restBonds.length
            || graph.bonds.some((bond, index) => !Array.isArray(bond) || bond.length !== 2 || bond.some((value, endpoint) => value !== this._restBonds[index][endpoint]))
            || !Array.isArray(graph?.bondAreasM2) || graph.bondAreasM2.length !== this._restAreas.length
            || graph.bondAreasM2.some((area, index) => area !== this._restAreas[index]))
            throw new RangeError('Calcite structure checkpoint changed authored geometry');
    }

    _validateRestoredScene() {
        const released = new Set(this.scene.releasedChunks), masses = this.scene.chunkMassesKg;
        for (let index = 0; index < this.cells.length; ++index) {
            const mass = this.surfaceWorld.chemicals.cell(this.cells[index]).carbonateKg;
            if (released.has(index) !== (mass === 0) || (!released.has(index) && masses[index] !== mass))
                throw new RangeError('Native calcite mass differs from the chemical checkpoint');
        }
    }

    /** Chemical depth removes measured side contact area. Blast owns island
     * splitting and rigid actors; no separate fracture or repair law runs here.
     */
    update() {
        this._assertLive();
        const released = new Set(this.scene.releasedChunks), masses = this.scene.chunkMassesKg;
        const next = this.cells.map((cell, index) => {
            const value = this.surfaceWorld.chemicals.cell(cell).carbonateKg;
            if (!Number.isFinite(value) || value < 0 || value > this._chemicalMassesKg[index]) throw new RangeError('Calcite mass cannot regrow without restoring its exact structural checkpoint');
            if (value > 0 && !positive(value)) throw new RangeError('Calcite residue exceeds native mass precision');
            if (released.has(index) && value !== 0) throw new RangeError('Released calcite belongs to its chemical sink');
            return value;
        });
        const remaining = this.scene.family.remainingAreasM2(), damage = [];
        for (let bond = 0; bond < this._restBonds.length; ++bond) {
            const [a, b] = this._restBonds[bond];
            const target = Math.fround(this._restAreas[bond] * Math.min(next[a] / this.initialMassesKg[a], next[b] / this.initialMassesKg[b]));
            if (target < remaining[bond]) damage.push([bond, target === 0 ? remaining[bond] * 1.0001 : remaining[bond] - target]);
        }
        if (damage.length) this.scene.damageBonds(damage);
        for (let index = 0; index < next.length; ++index) {
            if (next[index] !== 0 || released.has(index)) continue;
            const dissolved = this.scene.releaseChunk(index);
            removeBody(this.physicsWorld, dissolved.body.handle);
            released.add(index);
        }
        for (let index = 0; index < next.length; ++index) if (!released.has(index)) masses[index] = next[index];
        this.scene.setChunkMasses(masses);
        const changed = next.some((value, index) => value !== this._chemicalMassesKg[index]);
        this._chemicalMassesKg = next;
        if (changed) this.log?.('Calcite chemistry updated native structure', { massKg: this.totalMassKg, removedCells: released.size, damagedBonds: damage.length });
        return { changed, massKg: this.totalMassKg, actors: this.scene.bodies.length, removedCells: released.size };
    }

    step(dt) {
        this._assertLive();
        if (!Number.isFinite(dt) || dt <= 0 || dt > 1 / 15) throw new RangeError('Native surface structure step must be (0, 1/15] seconds');
        this.update();
        if (this.ownsWorld) {
            stepPhysicsWorld(this.physicsWorld, dt);
            this.physicsWorld.contactEvents.length = 0;
            this.physicsWorld.triggerEvents.length = 0;
        }
        this.timeSeconds += dt;
        return this.poses();
    }

    /** Explicit mechanical disassembly consumes the native remaining contact
     * areas. Chemical inventories are untouched; surviving leaves fall under
     * PhysX gravity while the two authored mounting edges remain supported.
     */
    takeApart() {
        this._assertLive();
        this.update();
        const areas = this.scene.family.remainingAreasM2();
        const commands = areas.flatMap((area, index) => area > 0 ? [[index, area * 1.0001]] : []);
        if (commands.length) this.scene.damageBonds(commands);
        const receipt = { brokenContacts: commands.length, actors: this.scene.bodies.length, massKg: this.totalMassKg };
        this.log?.('Calcite sheet mechanically taken apart', receipt);
        return receipt;
    }

    /** Packed GPU poses indexed by global storage cell: center.xyz, visible,
     * rotation.xyzw. Center is the authored solid midpoint, not its top face.
     */
    poses() {
        this._assertLive();
        for (let index = 0; index < this.topology.count; ++index) {
            const meta = index * 8;
            this._poses.set([this.topology.meta[meta], this.topology.meta[meta + 1] - this.topology.meta[meta + 7] / 2,
                this.topology.meta[meta + 2], 1, 0, 0, 0, 1], meta);
        }
        const native = this.scene.chunkPoses(this._nativePoses);
        native.forEach((pose, index) => {
            const at = this.cells[index] * 8;
            if (pose) this._poses.set([...pose.position, 1, ...pose.rotation], at);
            else this._poses[at + 3] = 0;
        });
        return this._poses;
    }

    get totalMassKg() { return this._chemicalMassesKg.reduce((sum, mass) => sum + mass, 0); }
    get chunkMassesKg() { return [...this._chemicalMassesKg]; }
    get stats() {
        this._assertLive();
        const areas = this.scene.family.remainingAreasM2();
        return { massKg: this.totalMassKg, nativeOwnedMassKg: this.scene.totalMassKg,
            massErrorKg: Math.abs(this.totalMassKg - this.scene.totalMassKg), actors: this.scene.bodies.length,
            removedCells: this.scene.releasedChunks.length, bonds: areas.length, brokenBonds: areas.filter(area => area === 0).length,
            remainingContactAreaM2: areas.reduce((sum, area) => sum + area, 0), simulationSeconds: this.timeSeconds };
    }

    snapshot() {
        this._assertLive();
        this.update();
        return { format: FORMAT, version: 1, topology: this.topology.identity, domain: this.topology.domains[this.domain].id,
            timeSeconds: this.timeSeconds, cells: [...this.cells], chemicalMassesKg: [...this._chemicalMassesKg], scene: this.scene.snapshot() };
    }

    _assertLive() {
        if (this.disposed || this.physicsWorld.destroyed) throw new Error('Surface calcite structure is disposed');
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true; this.scene?.dispose();
        if (this.floor && !this.physicsWorld.destroyed) removeBody(this.physicsWorld, this.floor.handle);
        if (this.ownsWorld) destroyPhysicsWorld(this.physicsWorld);
        this.log?.('Surface calcite structure disposed');
    }
}
