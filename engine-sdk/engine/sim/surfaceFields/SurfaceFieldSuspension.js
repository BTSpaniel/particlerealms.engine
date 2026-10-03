// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { BlastScene } from '../destruction/BlastScene.js';
import { createBody, removeBody, stepPhysicsWorld, destroyPhysicsWorld } from '../physics/PhysXPhysicsWorld.js';
import { createDistanceJoint, getPhysXJointCapabilities } from '../physics/PhysXJoints.js';
import { quatRotateVec3 } from '../../core/math/MathQuat.js';
import { cloneStrictJson } from '../../core/schema/StrictJsonValue.js';

export const SURFACE_SUSPENSION_FORMAT = 'particle-realms/surface-field-suspension';
const NATIVE_FORCE_LIMIT = 3e38;
const corners = [[0, 0, -1, -1], [1, 0, 1, -1], [1, 1, 1, 1], [0, 1, -1, 1]];
const nativePositive = value => Number.isFinite(value) && Number.isFinite(Math.fround(value)) && Math.fround(value) > 0;
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const breakCallbacks = new WeakMap();

// The installed world callback handles contacts/triggers but leaves the
// WebIDL onConstraintBreak virtual unimplemented. Complete that application
// callback without replacing either its native owner or existing handlers.
function retainBreakNotifications(world, owner) {
    const callback = world._simulationEventCallback;
    if (!callback) return null;
    let entry = breakCallbacks.get(callback);
    if (!entry) {
        const own = Object.hasOwn(callback, 'onConstraintBreak'), previous = callback.onConstraintBreak;
        if (own && typeof previous !== 'function') throw new TypeError('Invalid native constraint-break callback');
        entry = { own, previous, owners: new Set(), listener: null };
        entry.listener = function (constraints, count) {
            if (entry.own) entry.previous.call(this, constraints, count);
            for (const current of entry.owners) current._breakNotifications += count;
        };
        callback.onConstraintBreak = entry.listener; breakCallbacks.set(callback, entry);
    }
    entry.owners.add(owner);
    return () => {
        entry.owners.delete(owner);
        if (entry.owners.size) return;
        if (callback.onConstraintBreak === entry.listener) {
            if (entry.own) callback.onConstraintBreak = entry.previous;
            else delete callback.onConstraintBreak;
        }
        breakCallbacks.delete(callback);
    };
}

/** Native suspended sheets. Material cells remain the sole mass/strength
 * authority; PhysX owns motion and support loads, and Blast owns islands.
 * structuralState lanes are initial solid kg, retained solid kg, surviving
 * strength fraction, and carried liquid kg, indexed by stable surface cell. */
export class SurfaceFieldSuspension {
    constructor(surfaceWorld, { physicsWorld, ownsWorld = false, supportHeightM = 1.4,
        supportBreakForceN = NATIVE_FORCE_LIMIT, log = null, snapshot = null } = {}) {
        if (!surfaceWorld?.topology?.address || !physicsWorld?.ready || physicsWorld.destroyed)
            throw new TypeError('Suspended surfaces require material and native physics owners');
        if (!getPhysXJointCapabilities(physicsWorld).hasDistance) throw new Error('Suspended surfaces require native PhysX distance joints');
        this.surfaceWorld = surfaceWorld; this.topology = surfaceWorld.topology; this.physicsWorld = physicsWorld;
        this.ownsWorld = ownsWorld; this.log = log; this.disposed = false; this.timeSeconds = 0;
        this.panels = []; this.supports = []; this._rods = []; this.floor = null;
        this._poses = new Float32Array(this.topology.count * 8); this._force = null; this._torque = null;
        this._velocities = new Float32Array(this.topology.count * 6);
        this._connectedEdges = new Uint8Array(this.topology.count * 4);
        this._breakNotifications = 0; this._releaseBreakNotifications = null;
        this._massLogs = new Map(); this._nextMassLogAt = 1;
        const saved = snapshot === null ? null : cloneStrictJson(snapshot, '$.surfaceSuspension');
        if (saved) {
            if (saved.format !== SURFACE_SUSPENSION_FORMAT || saved.version !== 1 || saved.topology !== this.topology.identity
                || !Number.isFinite(saved.timeSeconds) || saved.timeSeconds < 0 || !Array.isArray(saved.panels) || !Array.isArray(saved.supports))
                throw new RangeError('Incompatible suspended surface checkpoint');
            supportHeightM = saved.supportHeightM;
        }
        if (!nativePositive(supportHeightM) || supportHeightM > 100 || !nativePositive(supportBreakForceN) || supportBreakForceN > NATIVE_FORCE_LIMIT)
            throw new RangeError('Suspension height and breaking force must be positive native values');
        this.supportHeightM = supportHeightM;
        const material = this._materialFrame();
        try {
            this._releaseBreakNotifications = retainBreakNotifications(physicsWorld, this);
            this._force = new physicsWorld.module.PxVec3(0, 0, 0); this._torque = new physicsWorld.module.PxVec3(0, 0, 0);
            for (let domain = 0; domain < this.topology.domains.length; domain++) {
                const sheet = this.topology.domains[domain];
                if (sheet.receiveRunoff) continue;
                if (!['wood', 'metal', 'calcite'].includes(sheet.material) || sheet.tiltX !== 0 || sheet.tiltZ !== 0)
                    throw new RangeError('Suspension requires flat wood, metal or calcite rest sheets');
                const panel = this._panel(domain, material); this.panels.push(panel);
                const checkpoint = saved?.panels[this.panels.length - 1];
                if (saved) {
                    this._validatePanel(checkpoint, panel, material);
                    panel.scene = BlastScene.restore(physicsWorld, checkpoint.scene, { log: log ? (message, detail) => this._sceneLog(panel, message, detail) : null });
                    panel.strength = [...checkpoint.strength];
                } else {
                    panel.scene = new BlastScene(physicsWorld, { chunks: panel.chunks, bonds: panel.bonds, bondAreasM2: panel.areas,
                        bondCentroids: panel.centroids, bondNormals: panel.normals, chunkMassesKg: panel.initialMasses,
                        density: panel.initialMasses.reduce((a, b) => a + b, 0) / (sheet.size[0] * sheet.size[1] * sheet.substrateDepthM),
                        position: [...sheet.center], contactOffset: Math.min(.00005, sheet.substrateDepthM / 8),
                        collisionGroups: [panel.chunks.map((_, index) => index)], log: log ? (message, detail) => this._sceneLog(panel, message, detail) : null });
                }
                this._makeSupports(panel, supportBreakForceN);
                this._makeRods(panel);
            }
            if (!this.panels.length || saved && (saved.panels.length !== this.panels.length || saved.supports.length !== this.supports.length))
                throw new RangeError('Suspension checkpoint changed the panel/support count');
            if (saved) {
                this.supports.forEach((support, index) => this._restoreSupport(support, saved.supports[index], material));
                for (const panel of this.panels) this._validateMasses(panel, material);
                this.timeSeconds = saved.timeSeconds;
                this._nextMassLogAt = this.timeSeconds + 1;
            }
            if (ownsWorld) this._makeFloor();
            this.scene = this.panels.find(panel => this.topology.domains[panel.domain].material === 'calcite')?.scene ?? this.panels[0].scene;
            this.update();
            this.log?.('Native sheets suspended from corner wires', { panels: this.panels.length, supports: this.supports.length, massKg: this.totalMassKg });
        } catch (error) { this.dispose(); throw error; }
    }

    _materialFrame() {
        const frame = this.surfaceWorld.structuralState;
        if (!(frame instanceof Float64Array) || frame.length !== this.topology.count * 4)
            throw new TypeError('Suspension requires the exact four-lane structural material frame');
        for (let i = 0; i < this.topology.count; i++) {
            const at = i * 4;
            if (!Number.isFinite(frame[at]) || !Number.isFinite(frame[at + 1]) || !Number.isFinite(frame[at + 2]) || !Number.isFinite(frame[at + 3])
                || frame[at] < 0 || frame[at + 1] < 0 || frame[at + 2] < 0 || frame[at + 2] > 1 || frame[at + 3] < 0)
                throw new RangeError('Invalid structural material inventory');
        }
        return frame;
    }

    _sceneLog(panel, message, detail) {
        const domain = this.topology.domains[panel.domain].id;
        if (message !== 'Blast chunk masses updated') { this.log?.(message, { domain, ...detail }); return; }
        const total = this._massLogs.get(domain) ?? { domain, updates: 0, deltaMassKg: 0, totalMassKg: 0 };
        total.updates++; total.deltaMassKg += detail.deltaMassKg; total.totalMassKg = detail.totalMassKg;
        this._massLogs.set(domain, total);
    }

    _flushMassLogs() {
        if (!this._massLogs.size) return;
        this.log?.('Native suspended material loads updated', { simulationSeconds: this.timeSeconds, panels: [...this._massLogs.values()] });
        this._massLogs.clear();
    }

    _panel(domain, frame) {
        const t = this.topology, sheet = t.domains[domain], width = sheet.size[0] / t.n, length = sheet.size[1] / t.n, thickness = sheet.substrateDepthM;
        const panel = { domain, cells: [], chunks: [], bonds: [], areas: [], centroids: [], normals: [], initialMasses: [], strength: [], scene: null, nativePoses: [] };
        for (let z = 0; z < t.n; z++) for (let x = 0; x < t.n; x++) {
            const index = z * t.n + x, cell = t.address(domain, x, z), initial = frame[cell * 4];
            if (!nativePositive(initial)) throw new RangeError('Suspended cells require positive initial solid mass');
            panel.cells.push(cell); panel.initialMasses.push(initial); panel.strength.push(1);
            panel.chunks.push({ position: [(x + .5 - t.n / 2) * width, -thickness / 2, (z + .5 - t.n / 2) * length],
                halfExtents: [width / 2, thickness / 2, length / 2], anchored: false });
            for (const [other, normal, area] of [[x + 1 < t.n ? index + 1 : -1, [1, 0, 0], length * thickness],
                [z + 1 < t.n ? index + t.n : -1, [0, 0, 1], width * thickness]]) {
                if (other < 0) continue;
                panel.bonds.push([index, other]); panel.areas.push(area); panel.normals.push(normal);
                panel.centroids.push([panel.chunks[index].position[0] + normal[0] * width / 2, -thickness / 2,
                    panel.chunks[index].position[2] + normal[2] * length / 2]);
            }
        }
        this._motionBondEdges(panel);
        return panel;
    }

    // Bonds are authored once, but the public topology neighbor carrier can be
    // edited. Rebuild directed addresses only when one of its panel rows changes.
    _motionBondEdges(panel) {
        const neighbors = this.topology.neighbors, cells = panel.cells;
        let changed = !panel.motionNeighbors;
        if (!changed) for (let index = 0; index < cells.length && !changed; index++) {
            const source = cells[index] * 4, cached = index * 4;
            for (let edge = 0; edge < 4; edge++) if (neighbors[source + edge] !== panel.motionNeighbors[cached + edge]) { changed = true; break; }
        }
        if (changed) {
            panel.motionNeighbors ??= new Uint32Array(cells.length * 4);
            for (let index = 0; index < cells.length; index++) for (let edge = 0; edge < 4; edge++)
                panel.motionNeighbors[index * 4 + edge] = neighbors[cells[index] * 4 + edge];
            panel.motionEdges = panel.bonds.map(([a, b]) => {
                const from = cells[a], to = cells[b], edges = [];
                for (let edge = 0; edge < 4; edge++) {
                    if (neighbors[from * 4 + edge] === to) edges.push(from * 4 + edge);
                    if (neighbors[to * 4 + edge] === from) edges.push(to * 4 + edge);
                }
                return edges;
            });
        }
        return panel.motionEdges;
    }

    _makeSupports(panel, breakForceN) {
        const sheet = this.topology.domains[panel.domain], n = this.topology.n;
        corners.forEach(([x, z, sx, sz], corner) => {
            const chunk = z * (n - 1) * n + x * (n - 1), attachment = [sx * sheet.size[0] / 2, 0, sz * sheet.size[1] / 2];
            this.supports.push({ id: `${sheet.id}:corner:${corner}`, domain: panel.domain, corner, chunk, cellIndex: panel.cells[chunk], panel,
                anchor: [sheet.center[0] + attachment[0], sheet.center[1] + this.supportHeightM, sheet.center[2] + attachment[2]],
                attachment, maxLengthM: this.supportHeightM, breakForceN, loadMassKg: 0, reason: null, forceN: [0, 0, 0],
                material: sheet.material === 'calcite' ? 'carbon-steel' : 'hemp-pine-proxy', radiusM: sheet.material === 'calcite' ? .0015 : .004,
                joint: null, body: null, appliedBreakForceN: null, appliedLengthM: null });
        });
    }

    _makeRods(panel) {
        const sheet = this.topology.domains[panel.domain];
        const floor = this.topology.domains.find(domain => domain.receiveRunoff), baseY = floor?.center[1] ?? 0;
        const add = (id, start, end, radiusM) => {
            const geometry = { id, start, end, radiusM,
                position: start.map((value, axis) => (value + end[axis]) / 2),
                halfExtents: start.map((value, axis) => Math.max(radiusM, Math.abs(end[axis] - value) / 2)),
                rotation: [0, 0, 0, 1], material: 'steel' };
            const rod = { geometry, body: null }; this._rods.push(rod);
            const entityId = `surface-rod:${crypto.randomUUID()}`;
            try {
                rod.body = createBody(this.physicsWorld, { entityId, simMode: 'static',
                    position: geometry.position, collider: { shape: 'box', halfExtents: geometry.halfExtents } });
            } catch (error) { rod.body ??= this.physicsWorld._bodyByEntityId.get(entityId); throw error; }
            if (!rod.body?._actor) throw new Error('Native suspension rod creation failed');
        };
        for (const side of [-1, 1]) {
            const y = sheet.center[1] + this.supportHeightM, z = sheet.center[2] + side * sheet.size[1] / 2;
            const start = [sheet.center[0] - sheet.size[0] / 2 - .24, y, z], end = [sheet.center[0] + sheet.size[0] / 2 + .24, y, z];
            add(`${sheet.id}:rod:${side}`, start, end, .018);
            for (const [corner, top] of [start, end].entries()) add(`${sheet.id}:leg:${side}:${corner}`, [top[0], baseY, top[2]], [...top], .018);
        }
    }

    _makeFloor() {
        const floor = this.topology.domains.find(domain => domain.receiveRunoff);
        if (!floor) return;
        if (floor.tiltX !== 0 || floor.tiltZ !== 0) throw new RangeError('Suspension receiving floor must have a flat rest plane');
        const entityId = `surface-suspension-floor:${crypto.randomUUID()}`;
        try {
            this.floor = createBody(this.physicsWorld, { entityId, simMode: 'static',
                position: [floor.center[0], floor.center[1] - .05, floor.center[2]],
                collider: { shape: 'box', halfExtents: [floor.size[0] / 2, .05, floor.size[1] / 2] } });
        } catch (error) { this.floor ??= this.physicsWorld._bodyByEntityId.get(entityId); throw error; }
        if (!this.floor?._actor) throw new Error('Native suspension floor creation failed');
        const shape = this.physicsWorld.module.SupportFunctions.prototype.PxActor_getShape(this.floor._actor, 0);
        if (!shape?.ptr) throw new Error('Native suspension floor has no shape');
        shape.setContactOffset(.000025);
    }

    _detach(support) {
        support.joint?.destroy();
        // Constraint removal does not wake a sleeping PxRigidDynamic. Gravity
        // must resume when its last wire is cut, even after a long quiet hold.
        support.body?._actor?.wakeUp();
        support.joint = null; support.body = null; support.appliedBreakForceN = null; support.appliedLengthM = null;
    }

    _detachPanel(panel) { for (const support of this.supports) if (support.panel === panel) this._detach(support); }

    _bind(support, material) {
        if (support.reason) return;
        const strength = material[support.cellIndex * 4 + 2];
        if (material[support.cellIndex * 4 + 1] === 0 || strength === 0) {
            this._detach(support); support.reason = 'material'; return;
        }
        const piece = support.panel.scene.bodies.find(value => value.indices.includes(support.chunk));
        if (!piece) throw new Error('Suspension corner lost its native owner');
        const force = Math.fround(support.breakForceN * strength);
        if (!(force > 0)) { this._detach(support); support.reason = 'material'; return; }
        if (support.body !== piece.body) {
            this._detach(support);
            const frameB = { position: support.attachment.map((value, axis) => value - piece.center[axis]) };
            const joint = createDistanceJoint(this.physicsWorld, null, piece.body,
                { frameA: { position: support.anchor }, frameB, maxDistance: support.maxLengthM });
            support.joint = joint; support.body = piece.body;
            if (!joint?._joint?.ptr) throw new Error('Native suspension joint creation failed');
        }
        if (force !== support.appliedBreakForceN) {
            const changed = support.appliedBreakForceN !== null;
            support.joint._joint.setBreakForce(force, NATIVE_FORCE_LIMIT); support.appliedBreakForceN = force;
            if (changed) piece.body._actor.wakeUp();
        }
        if (support.maxLengthM !== support.appliedLengthM) {
            const changed = support.appliedLengthM !== null;
            support.joint._joint.setMaxDistance(support.maxLengthM); support.appliedLengthM = support.maxLengthM;
            if (changed) piece.body._actor.wakeUp();
        }
    }

    /** Update finite mass and irreversible material contact area before physics. */
    update() {
        this._assertLive(); const material = this._materialFrame();
        const plans = this.panels.map(panel => {
            const released = new Set(panel.scene.releasedChunks), masses = panel.scene.chunkMassesKg;
            const strength = panel.cells.map((cell, index) => {
                const at = cell * 4, solid = material[at + 1], carried = material[at + 3];
                if (material[at] !== panel.initialMasses[index] || material[at + 2] > panel.strength[index])
                    throw new RangeError('Suspended material cannot change its stock or regrow broken strength');
                if (released.has(index) && solid !== 0) throw new RangeError('A released solid cell cannot regrow without restoring its structure');
                if (solid > 0) {
                    const mass = solid + carried + this._supportLoad(panel, index);
                    if (!nativePositive(mass)) throw new RangeError('Suspended material mass exceeds native precision');
                    masses[index] = mass;
                }
                return solid > 0 ? material[at + 2] : 0;
            });
            const remaining = panel.scene.family.remainingAreasM2(), damage = [];
            panel.bonds.forEach(([a, b], index) => {
                const target = Math.fround(panel.areas[index] * Math.min(strength[a], strength[b]));
                if (target < remaining[index]) damage.push([index, target === 0 ? remaining[index] * 1.0001 : remaining[index] - target]);
            });
            return { panel, released, masses, strength, damage, splits: damage.some(([index, amount]) => amount >= remaining[index]) };
        });
        let changed = false;
        for (const { panel, released, masses, strength, damage, splits } of plans) {
            if (panel.scene.needsReconciliation || splits) this._detachPanel(panel);
            if (panel.scene.needsReconciliation) panel.scene.reconcile();
            if (damage.length) { panel.scene.damageBonds(damage); changed = true; }
            for (let index = 0; index < panel.cells.length; index++) {
                if (material[panel.cells[index] * 4 + 1] !== 0 || released.has(index)) continue;
                this._detachPanel(panel);
                const leaf = panel.scene.releaseChunk(index); removeBody(this.physicsWorld, leaf.body.handle); changed = true;
            }
            changed = panel.scene.setChunkMasses(masses).changed || changed;
            panel.strength = strength;
        }
        for (const support of this.supports) this._bind(support, material);
        return { changed, massKg: this.totalMassKg, actors: this.panels.reduce((sum, panel) => sum + panel.scene.bodies.length, 0) };
    }

    _readSupportLoads() {
        const P = this.physicsWorld.module;
        for (const support of this.supports) {
            if (!support.joint) continue;
            const constraint = support.joint._joint.getConstraint();
            constraint.getForce(this._force, this._torque);
            support.forceN = [this._force.get_x(), this._force.get_y(), this._force.get_z()];
            if (!support.forceN.every(Number.isFinite)) throw new Error('Native suspension returned an invalid support load');
            if (constraint.getFlags().isSet(P.PxConstraintFlagEnum.eBROKEN)) {
                this._detach(support); support.reason = 'native-break';
                this.log?.('Native corner wire broke under load', { id: support.id, forceN: support.forceN, breakForceN: support.breakForceN });
            }
        }
    }

    step(dt) {
        this._assertLive();
        if (!Number.isFinite(dt) || dt <= 0 || dt > 1 / 15) throw new RangeError('Native suspension step must be (0, 1/15] seconds');
        this.update();
        if (this.ownsWorld) {
            stepPhysicsWorld(this.physicsWorld, dt);
            this.physicsWorld.contactEvents.length = 0; this.physicsWorld.triggerEvents.length = 0;
        }
        this._readSupportLoads(); this.timeSeconds += dt;
        if (this.timeSeconds >= this._nextMassLogAt) { this._flushMassLogs(); this._nextMassLogAt = this.timeSeconds + 1; }
        return this.poses();
    }

    /** Stable corners survive actor replacement; a cut remains cut until restore. */
    setSupportProperties(id, options = {}) {
        this._assertLive(); const value = cloneStrictJson(options, '$.surfaceSupport');
        if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).some(key => !['breakForceN', 'breakingForceN', 'maxLengthM', 'loadMassKg', 'cut'].includes(key)))
            throw new TypeError('Unknown suspension support property');
        const support = this.supports.find(item => item.id === id);
        if (!support) throw new RangeError('Unknown suspension support');
        if (Object.hasOwn(value, 'cut') && typeof value.cut !== 'boolean') throw new TypeError('Support cut must be boolean');
        if (Object.hasOwn(value, 'breakForceN') && Object.hasOwn(value, 'breakingForceN') && value.breakForceN !== value.breakingForceN)
            throw new RangeError('Support breaking-force aliases disagree');
        const breakingForce = Object.hasOwn(value, 'breakingForceN') ? value.breakingForceN : value.breakForceN;
        if (breakingForce !== undefined && (!nativePositive(breakingForce) || breakingForce > NATIVE_FORCE_LIMIT))
            throw new RangeError('Support breaking force must be positive and within native range');
        if (Object.hasOwn(value, 'maxLengthM') && (!nativePositive(value.maxLengthM) || value.maxLengthM > 100))
            throw new RangeError('Support maximum length must be positive and bounded');
        if (Object.hasOwn(value, 'loadMassKg') && (!Number.isFinite(value.loadMassKg) || value.loadMassKg < 0 || !Number.isFinite(Math.fround(value.loadMassKg))))
            throw new RangeError('Support load mass must be nonnegative and within native range');
        const material = this._materialFrame();
        if (breakingForce !== undefined) support.breakForceN = breakingForce;
        if (Object.hasOwn(value, 'maxLengthM')) support.maxLengthM = value.maxLengthM;
        if (Object.hasOwn(value, 'loadMassKg')) support.loadMassKg = value.loadMassKg;
        if (value.cut) { this._detach(support); support.reason ??= 'cut'; }
        else this._bind(support, material);
        return this._supportView(support);
    }

    listSupports() {
        this._assertLive();
        return this.supports.map(support => this._supportView(support));
    }

    _supportView(support) {
            const piece = support.panel.scene.bodies.find(value => value.indices.includes(support.chunk));
            const offset = piece ? quatRotateVec3(support.attachment.map((value, axis) => value - piece.center[axis]), piece.body.rotation) : null;
            const attachment = piece ? piece.body.position.map((value, axis) => value + offset[axis]) : null;
            return { id: support.id, domain: support.domain, corner: support.corner, chunk: support.chunk, cellIndex: support.cellIndex,
                anchor: [...support.anchor], attachment, maxLengthM: support.maxLengthM, breakForceN: support.breakForceN,
                breakingForceN: support.breakForceN, material: support.material, radiusM: support.radiusM,
                authoredMaxLengthM: this.supportHeightM, loadMassKg: support.loadMassKg,
                appliedLoadMassKg: piece ? support.loadMassKg : 0,
                appliedBreakForceN: support.appliedBreakForceN, broken: support.reason !== null, reason: support.reason,
                forceN: [...support.forceN], actor: piece?.body.handle ?? null };
    }

    // The finite rope owner supplies the load retained at this endpoint.
    // A uniform intact cable commonly contributes half its mass; after a cut
    // it supplies only the attached lower remnant. This is an equivalent
    // corner load, not a second inventory or a native cable-chain simulation.
    _supportLoad(panel, chunk) {
        let mass = 0;
        for (const support of this.supports) if (support.panel === panel && support.chunk === chunk) mass += support.loadMassKg;
        return mass;
    }

    rods() { this._assertLive(); return this._rods.map(rod => structuredClone(rod.geometry)); }

    /** Completed native material-point velocity and actual surviving links.
     * The liquid owner receives this frame before its next transport step. */
    motion() {
        this._assertLive(); const poses = this.poses(), t = this.topology;
        this._velocities.fill(0); this._connectedEdges.fill(0);
        for (let i = 0; i < t.count; i++) if (t.domains[t.meta[i * 8 + 4]].receiveRunoff) {
            for (let edge = 0; edge < 4; edge++) {
                const neighbor = t.neighbors[i * 4 + edge];
                if (neighbor < t.count && t.meta[neighbor * 8 + 4] === t.meta[i * 8 + 4]) this._connectedEdges[i * 4 + edge] = 1;
            }
        }
        for (const panel of this.panels) {
            const owner = new Map();
            for (const piece of panel.scene.bodies) {
                // WebIDL [Value] getters reuse native temporary storage.
                // Copy immediately; these returned wrappers are not ours to delete.
                const nativeCenter = piece.body._actor.getCMassLocalPose().get_p();
                const offset = quatRotateVec3([nativeCenter.get_x(), nativeCenter.get_y(), nativeCenter.get_z()], piece.body.rotation);
                const center = piece.body.position.map((value, axis) => value + offset[axis]), angular = piece.body.angularVelocity, linear = piece.body.linearVelocity;
                for (const chunk of piece.indices) {
                    const cell = panel.cells[chunk], pose = cell * 8, velocity = cell * 6;
                    const dx = poses[pose] - center[0], dy = poses[pose + 1] - center[1], dz = poses[pose + 2] - center[2];
                    this._velocities[velocity] = linear[0] + (angular[1] * dz - angular[2] * dy);
                    this._velocities[velocity + 1] = linear[1] + (angular[2] * dx - angular[0] * dz);
                    this._velocities[velocity + 2] = linear[2] + (angular[0] * dy - angular[1] * dx);
                    this._velocities[velocity + 3] = angular[0]; this._velocities[velocity + 4] = angular[1]; this._velocities[velocity + 5] = angular[2];
                    owner.set(chunk, piece);
                }
            }
            const areas = panel.scene.family.remainingAreasM2(), bondEdges = this._motionBondEdges(panel);
            panel.bonds.forEach(([a, b], bond) => {
                if (!(areas[bond] > 0) || !owner.has(a) || owner.get(a) !== owner.get(b)) return;
                for (const edge of bondEdges[bond]) this._connectedEdges[edge] = 1;
            });
        }
        if (!this._velocities.every(Number.isFinite)) throw new Error('Native suspension material velocity exceeds presentation precision');
        return { poses, velocities: this._velocities, connectedEdges: this._connectedEdges };
    }

    poses() {
        this._assertLive();
        for (let i = 0; i < this.topology.count; i++) {
            const at = i * 8;
            this._poses.set([this.topology.meta[at], this.topology.meta[at + 1] - this.topology.meta[at + 7] / 2,
                this.topology.meta[at + 2], 1, 0, 0, 0, 1], at);
        }
        for (const panel of this.panels) panel.scene.chunkPoses(panel.nativePoses).forEach((pose, index) => {
            const at = panel.cells[index] * 8;
            if (pose) this._poses.set([...pose.position, 1, ...pose.rotation], at);
            else this._poses[at + 3] = 0;
        });
        return this._poses;
    }

    takeApart() {
        this._assertLive(); this.update(); let brokenContacts = 0;
        for (const panel of this.panels) {
            const commands = panel.scene.family.remainingAreasM2().flatMap((area, index) => area > 0 ? [[index, area * 1.0001]] : []);
            if (commands.length) { this._detachPanel(panel); panel.scene.damageBonds(commands); brokenContacts += commands.length; }
        }
        const frame = this._materialFrame(); for (const support of this.supports) this._bind(support, frame);
        return { brokenContacts, actors: this.stats.actors, massKg: this.totalMassKg };
    }

    get totalMassKg() { return this.panels.reduce((sum, panel) => sum + panel.scene.totalMassKg, 0); }
    get stats() {
        this._assertLive(); const material = this._materialFrame(); let solidMassKg = 0, carriedLiquidMassKg = 0, supportLoadMassKg = 0, bonds = 0, brokenBonds = 0, remainingContactAreaM2 = 0;
        for (const panel of this.panels) {
            for (const cell of panel.cells) if (material[cell * 4 + 1] > 0) { solidMassKg += material[cell * 4 + 1]; carriedLiquidMassKg += material[cell * 4 + 3]; }
            for (const support of this.supports) if (support.panel === panel && material[support.cellIndex * 4 + 1] > 0) supportLoadMassKg += support.loadMassKg;
            for (const area of panel.scene.family.remainingAreasM2()) { bonds++; if (area === 0) brokenBonds++; remainingContactAreaM2 += area; }
        }
        return { massKg: solidMassKg + carriedLiquidMassKg + supportLoadMassKg, solidMassKg, carriedLiquidMassKg, supportLoadMassKg, nativeOwnedMassKg: this.totalMassKg,
            massErrorKg: Math.abs(solidMassKg + carriedLiquidMassKg + supportLoadMassKg - this.totalMassKg), actors: this.panels.reduce((sum, panel) => sum + panel.scene.bodies.length, 0),
            removedCells: this.panels.reduce((sum, panel) => sum + panel.scene.releasedChunks.length, 0), bonds, brokenBonds, remainingContactAreaM2,
            supports: this.supports.length, brokenSupports: this.supports.filter(support => support.reason !== null).length, simulationSeconds: this.timeSeconds };
    }

    snapshot() {
        this._assertLive(); this.update();
        return { format: SURFACE_SUSPENSION_FORMAT, version: 1, topology: this.topology.identity, supportHeightM: this.supportHeightM,
            timeSeconds: this.timeSeconds, panels: this.panels.map(panel => ({ domain: this.topology.domains[panel.domain].id,
                cells: [...panel.cells], initialMasses: [...panel.initialMasses], strength: [...panel.strength], scene: panel.scene.snapshot() })),
            supports: this.supports.map(support => ({ id: support.id, breakForceN: support.breakForceN, maxLengthM: support.maxLengthM,
                loadMassKg: support.loadMassKg, reason: support.reason, forceN: [...support.forceN] })) };
    }

    _validatePanel(saved, panel, frame) {
        if (!saved || saved.domain !== this.topology.domains[panel.domain].id || !same(saved.cells, panel.cells) || !same(saved.initialMasses, panel.initialMasses)
            || !Array.isArray(saved.strength) || saved.strength.length !== panel.cells.length
            || saved.strength.some((value, index) => value !== (frame[panel.cells[index] * 4 + 1] > 0 ? frame[panel.cells[index] * 4 + 2] : 0)))
            throw new RangeError('Suspension checkpoint changed its retained material cells');
        const scene = saved.scene, graph = scene?.family?.graph;
        if (!Array.isArray(scene?.chunks) || scene.chunks.length !== panel.chunks.length
            || scene.chunks.some((chunk, index) => chunk.anchored || !same(chunk.position, panel.chunks[index].position) || !same(chunk.halfExtents, panel.chunks[index].halfExtents))
            || !same(graph?.bonds, panel.bonds) || !same(graph?.bondAreasM2, panel.areas)
            || !same(graph?.bondCentroids, panel.centroids) || !same(graph?.bondNormals, panel.normals))
            throw new RangeError('Suspension checkpoint changed authored native geometry');
    }

    _validateMasses(panel, frame) {
        const released = new Set(panel.scene.releasedChunks), masses = panel.scene.chunkMassesKg;
        panel.cells.forEach((cell, index) => {
            const solid = frame[cell * 4 + 1];
            if (released.has(index) !== (solid === 0) || !released.has(index) && masses[index] !== solid + frame[cell * 4 + 3] + this._supportLoad(panel, index))
                throw new RangeError('Suspension native mass differs from its exact material owner');
        });
    }

    _restoreSupport(support, saved, frame) {
        if (!saved || saved.id !== support.id || !nativePositive(saved.breakForceN) || saved.breakForceN > NATIVE_FORCE_LIMIT
            || !nativePositive(saved.maxLengthM) || saved.maxLengthM > 100
            || saved.loadMassKg !== undefined && (!Number.isFinite(saved.loadMassKg) || saved.loadMassKg < 0 || !Number.isFinite(Math.fround(saved.loadMassKg)))
            || ![null, 'cut', 'material', 'native-break'].includes(saved.reason)
            || !Array.isArray(saved.forceN) || saved.forceN.length !== 3 || !saved.forceN.every(Number.isFinite)
            || saved.reason === null && (frame[support.cellIndex * 4 + 1] === 0 || frame[support.cellIndex * 4 + 2] === 0))
            throw new RangeError('Invalid suspended corner checkpoint');
        support.breakForceN = saved.breakForceN; support.maxLengthM = saved.maxLengthM; support.loadMassKg = saved.loadMassKg ?? 0;
        support.reason = saved.reason; support.forceN = [...saved.forceN];
    }

    _assertLive() { if (this.disposed || this.physicsWorld.destroyed) throw new Error('Suspended surfaces are disposed'); }
    dispose() {
        if (this.disposed) return; this.disposed = true;
        this._flushMassLogs();
        if (!this.physicsWorld.destroyed) for (const support of this.supports) this._detach(support);
        for (const panel of this.panels) panel.scene?.dispose();
        if (!this.physicsWorld.destroyed) {
            for (const rod of this._rods) if (rod.body) removeBody(this.physicsWorld, rod.body.handle);
            if (this.floor) removeBody(this.physicsWorld, this.floor.handle);
        }
        for (const value of [this._force, this._torque]) if (value) this.physicsWorld.module.destroy(value);
        this._force = null; this._torque = null;
        this._releaseBreakNotifications?.(); this._releaseBreakNotifications = null;
        if (this.ownsWorld) destroyPhysicsWorld(this.physicsWorld);
        this.log?.('Native suspended sheets disposed');
    }
}
