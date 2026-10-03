// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { BlastFamily } from './BlastFamily.js';
import { createBody, removeBody } from '../physics/PhysXPhysicsWorld.js';
import { quatNormalize, quatRotateVec3 } from '../../core/math/MathQuat.js';
import { validateBlastGeometry, cookAndRegisterBlastHull } from './BlastGeometry.js';
import { validateBlastCollisionPartitions } from './BlastCollisionGeometry.js';
import { registerCustomMesh, unregisterCustomMesh } from '../../render/mesh/CustomMeshRegistry.js';
import { validateChunkMasses, chunkMassProperties, compoundMassProperties, nativeMassUpdate } from './BlastMassProperties.js';

const finiteVector = (value, length) => Array.isArray(value) && value.length === length
    && value.every(n => Number.isFinite(n) && Number.isFinite(Math.fround(n)));
const validMotion = body => body && [body.position, body.linearVelocity, body.angularVelocity].every(v => finiteVector(v, 3))
    && finiteVector(body.rotation, 4) && Math.abs(Math.hypot(...body.rotation) - 1) <= 1e-5;
const validContactOffset = value => Number.isFinite(value) && Number.isFinite(Math.fround(value)) && Math.fround(value) > 0;

/** Prefractured box or authored convex chunks become native compound bodies.
 * Call applyContacts(world.contactEvents) after stepping and before clearing events.
 * The owner must dispose this scene before destroying its borrowed physics world.
 */
export class BlastScene {
    constructor(world, { chunks, bonds, health = 1, bondAreasM2 = null, bondCentroids = null, bondNormals = null, stress = null, density = 1000, position = [0, 0, 0],
        rotation = [0, 0, 0, 1], linearVelocity = [0, 0, 0], angularVelocity = [0, 0, 0],
        impulseThreshold = 1, damageScale = .05, damageRadius = .5, collisionGroups = null, contactOffset = .02, chunkMassesKg = null, log = null } = {}) {
        if (!world?.ready || world.destroyed) throw new Error('Blast requires a ready PhysX PE world');
        if (!validContactOffset(contactOffset)) throw new RangeError('Blast contact offset must be positive and finite in native precision');
        if (![density, damageRadius].every(n => Number.isFinite(n) && n > 0)
            || ![impulseThreshold, damageScale].every(n => Number.isFinite(n) && n >= 0)
            || !validMotion({ position, rotation, linearVelocity, angularVelocity })
            || !Array.isArray(chunks) || !Array.isArray(bonds)) throw new RangeError('Invalid Blast scene settings');
        this.chunks = chunks.map(chunk => {
            if (chunk?.geometry) return validateBlastGeometry(chunk);
            if (!finiteVector(chunk?.position, 3) || !finiteVector(chunk.halfExtents, 3)
                || !chunk.halfExtents.every(n => n > 0)) throw new RangeError('Blast chunks require finite positions and positive box half extents');
            return { position: [...chunk.position], halfExtents: [...chunk.halfExtents],
                volume: 8 * chunk.halfExtents.reduce((a, b) => a * b, 1), anchored: !!chunk.anchored };
        });
        if (this.chunks.some(chunk => chunk.geometry) && (!bondAreasM2 || !bondCentroids || !bondNormals))
            throw new RangeError('Authored Blast geometry requires its physical bond areas, centroids and normals');
        this.collisionGroups = validateBlastCollisionPartitions(this.chunks, collisionGroups);
        this._chunkMassesKg = validateChunkMasses(chunkMassesKg ?? this.chunks.map(chunk => chunk.volume * density), this.chunks.length);
        this._explicitMasses = chunkMassesKg !== null; this._massRevision = 0;
        this._massProperties = null; this._releasedChunks = new Set();
        Object.assign(this, { world, density, impulseThreshold, damageScale, damageRadius, contactOffset, log });
        this.bonds = bonds.map(b => [...b]); this.bodies = []; this.disposed = false; this.needsReconciliation = false;
        this.stats = { fractures: 0, damageEvents: 0, actors: 0 };
        this.meshTypes = this.chunks.map(() => null); this._meshes = new Map();
        if (stress !== null && (!stress || typeof stress !== 'object' || Array.isArray(stress)
            || stress.densityKgM3 != null || stress.anchoredChunks != null || stress.chunkMassesKg != null)) throw new RangeError('Scene stress derives mass and anchors from its owned geometry; provide settings and optional interface sections only');
        const stressConfig = stress === null ? null : { densityKgM3: density,
            ...(this._explicitMasses ? { chunkMassesKg: this._chunkMassesKg } : {}),
            anchoredChunks: this.chunks.flatMap((chunk, index) => chunk.anchored ? [index] : []), settings: stress.settings,
            ...(stress.sections !== undefined ? { sections: stress.sections } : {}) };
        this.family = new BlastFamily(world.module, { chunks: this.chunks, bonds, health, bondAreasM2, bondCentroids, bondNormals, stress: stressConfig });
        if (stressConfig) this.stats.stressUpdates = 0;
        try {
            this._prepareGeometry();
            this.bodies = [this._create(this.chunks.map((_, i) => i), { center: [0, 0, 0], body: { position, rotation, linearVelocity, angularVelocity } })];
            this.stats.actors = 1; this.log?.('Blast scene created', { chunks: chunks.length, bonds: bonds.length, contactOffset });
        } catch (error) {
            for (const piece of this.bodies) removeBody(world, piece.body.handle);
            this._releaseGeometry(); this.family.dispose(); this.disposed = true; throw error;
        }
    }

    _prepareGeometry() {
        this.chunks.forEach((chunk, index) => {
            if (!chunk.geometry) return;
            const meshId = `custom_blast_${crypto.randomUUID()}`;
            const mesh = cookAndRegisterBlastHull(this.world, meshId, chunk);
            this._meshes.set(meshId, mesh); this.meshTypes[index] = meshId;
            registerCustomMesh(meshId, { positions: new Float32Array(chunk.geometry.positions),
                normals: new Float32Array(chunk.geometry.normals), uvs: new Float32Array(chunk.geometry.uvs),
                indices: new Uint32Array(chunk.geometry.indices) });
        });
    }

    _releaseGeometry() {
        for (const [meshId, mesh] of this._meshes) {
            unregisterCustomMesh(meshId);
            if (!this.world.destroyed && this.world.convexMeshes.get(meshId) === mesh) {
                this.world.convexMeshes.delete(meshId); mesh.release();
            }
        }
        this._meshes.clear(); this.meshTypes.fill(null);
        this._massProperties = null;
    }

    _attachConvexShapes(body, colliders, mass) {
        const P = this.world.module;
        for (const collider of colliders) {
            let geometry, shape, position, rotation, pose;
            try {
                geometry = new P.PxConvexMeshGeometry(this._meshes.get(collider.meshId));
                shape = this.world.physics.createShape(geometry, this.world.defaultMaterial, true,
                    this.world.shapeFlagsWithQuery || this.world.shapeFlags);
                if (!shape?.ptr) throw new Error('Blast convex shape creation failed');
                position = new P.PxVec3(...collider.localOffset); rotation = new P.PxQuat(0, 0, 0, 1);
                pose = new P.PxTransform(position, rotation);
                shape.setLocalPose(pose); shape.setRestOffset(0);
                shape.setSimulationFilterData(this.world.filterData);
                if (!body._actor.attachShape(shape)) throw new Error('Blast convex shape attachment failed');
            } finally {
                if (shape?.ptr) shape.release();
                for (const value of [pose, rotation, position, geometry]) if (value) P.destroy(value);
            }
        }
        if (colliders.length && body.simMode !== 'static') {
            if (!P.PxRigidBodyExt.setMassAndUpdateInertia(body._actor, mass)) throw new Error('Blast compound inertia update failed');
            const inertia = body._actor.getMassSpaceInertiaTensor();
            if (![inertia.get_x(), inertia.get_y(), inertia.get_z()].every(value => Number.isFinite(value) && value > 0))
                throw new Error('Blast compound has invalid inertia');
        }
    }

    _center(indices) {
        const mass = indices.reduce((sum, i) => sum + this._chunkMassesKg[i], 0);
        if (!Number.isFinite(Math.fround(mass)) || Math.fround(mass) <= 0) throw new RangeError('Blast fragment mass exceeds native precision');
        return [0, 1, 2].map(axis => indices.reduce((sum, i) => sum + (this._explicitMasses
            ? this.chunks[i].position[axis] * this._chunkMassesKg[i]
            : this.chunks[i].position[axis] * this.chunks[i].volume * this.density), 0) / mass);
    }

    _massFor(indices, masses, origin) {
        this._massProperties ??= this.chunks.map((chunk, index) =>
            chunkMassProperties(this.world.module, chunk, this._meshes.get(this.meshTypes[index])));
        return compoundMassProperties(this.world.module, indices, this.chunks, this._massProperties, masses, origin);
    }

    _create(indices, parent) {
        const mass = indices.reduce((sum, i) => sum + this._chunkMassesKg[i], 0);
        const center = this._center(indices);
        const offset = quatRotateVec3(center.map((n, i) => n - parent.center[i]), parent.body.rotation);
        const angular = parent.body.angularVelocity, spin = [angular[1] * offset[2] - angular[2] * offset[1], angular[2] * offset[0] - angular[0] * offset[2], angular[0] * offset[1] - angular[1] * offset[0]];
        const admitted = new Set(indices), coalesced = new Set(), colliders = [];
        for (const group of this.collisionGroups ?? []) {
            if (!group.indices.every(index => admitted.has(index))) continue;
            group.indices.forEach(index => coalesced.add(index));
            colliders.push({ shape: 'box', halfExtents: [...group.halfExtents],
                localOffset: group.position.map((value, axis) => value - center[axis]) });
        }
        colliders.push(...indices.filter(index => !coalesced.has(index)).map(i => ({ ...(this.chunks[i].geometry
            ? { shape: 'convexMesh', meshId: this.meshTypes[i] } : { shape: 'box', halfExtents: this.chunks[i].halfExtents }),
            localOffset: this.chunks[i].position.map((n, a) => n - center[a]) })));
        const position = parent.body.position.map((n, i) => n + offset[i]);
        const linearVelocity = parent.preserveVelocity ? [...parent.body.linearVelocity]
            : parent.body.linearVelocity.map((n, i) => n + spin[i]);
        if (!validMotion({ ...parent.body, position, linearVelocity })) throw new RangeError('Invalid Blast fragment motion');
        const entityId = `blast:${crypto.randomUUID()}`;
        let body;
        try {
            body = createBody(this.world, { entityId, simMode: indices.some(i => this.chunks[i].anchored) ? 'static' : 'dynamic',
                mass, position, rotation: [...parent.body.rotation], linearVelocity, angularVelocity: [...angular],
                collider: colliders[0], compoundColliders: colliders.slice(1).filter(collider => collider.shape !== 'convexMesh') });
            if (body?._actor) this._attachConvexShapes(body, colliders.slice(1).filter(collider => collider.shape === 'convexMesh'), mass);
            if (!body?._actor || body._actor.getNbShapes() !== colliders.length) throw new Error('Blast fragment collider creation failed');
            // This binding calls PxRigidActor::getShapes(&shape, 1, index).
            // Shapes are borrowed from the actor: do not release/destroy them.
            // Visit the complete actor after attachment so the initial collider,
            // additional boxes and authored convexes all receive the same skin.
            for (let index = 0; index < colliders.length; ++index) {
                const shape = this.world.module.SupportFunctions.prototype.PxActor_getShape(body._actor, index);
                if (!shape?.ptr) throw new Error('Blast fragment shape enumeration failed');
                shape.setContactOffset(this.contactOffset);
                if (shape.getContactOffset() !== Math.fround(this.contactOffset)) throw new Error('Blast fragment contact offset was not applied');
            }
            if (body.simMode !== 'static') {
                if (this._explicitMasses) {
                    const update = nativeMassUpdate(this.world.module, this._massFor(indices, this._chunkMassesKg, center));
                    try { update.apply(body); } finally { update.dispose(); }
                }
                const child = this._bodyState(body);
                // PhysX linear velocity belongs to its computed center of mass,
                // which need not coincide with the authored actor origin. Read
                // it after every compound shape and inertia update has finished.
                if (!parent.preserveVelocity && parent.body.centerOfMassOffset) {
                    const parentOffset = quatRotateVec3(parent.body.centerOfMassOffset, parent.body.rotation);
                    const childOffset = quatRotateVec3(child.centerOfMassOffset, child.rotation);
                    const delta = child.position.map((value, axis) =>
                        value + childOffset[axis] - parent.body.position[axis] - parentOffset[axis]);
                    const centerSpin = [angular[1] * delta[2] - angular[2] * delta[1],
                        angular[2] * delta[0] - angular[0] * delta[2], angular[0] * delta[1] - angular[1] * delta[0]];
                    const velocity = parent.body.linearVelocity.map((value, axis) => value + centerSpin[axis]);
                    if (!finiteVector(velocity, 3)) throw new RangeError('Invalid Blast fragment center-of-mass velocity');
                    const nativeVelocity = new this.world.module.PxVec3(...velocity);
                    try { body._actor.setLinearVelocity(nativeVelocity, true); }
                    finally { this.world.module.destroy(nativeVelocity); }
                    velocity.forEach((value, axis) => { body.linearVelocity[axis] = value; });
                }
            }
            return { body, center, indices, entityId };
        } catch (error) {
            // createBody registers ownership before allocating the native actor.
            body ??= this.world._bodyByEntityId.get(entityId);
            if (body) removeBody(this.world, body.handle);
            throw error;
        }
    }

    get chunkMassesKg() { return [...this._chunkMassesKg]; }
    get massRevision() { return this._massRevision; }
    get releasedChunks() { return [...this._releasedChunks]; }
    get totalMassKg() { return this._chunkMassesKg.reduce((sum, mass, index) => sum + (this._releasedChunks.has(index) ? 0 : mass), 0); }

    /** Keep geometry and every material point's rigid velocity unchanged while
     * mass leaves/enters at that velocity. This is an open-system mass transfer,
     * not a momentum-preserving impulse applied to the remaining body. Native
     * actors, local shapes, authored indices and their origins remain stable. */
    setChunkMasses(values) {
        if (this.disposed || this.world.destroyed) throw new Error('Blast scene is disposed');
        const masses = validateChunkMasses(values, this.chunks.length);
        if ([...this._releasedChunks].some(index => masses[index] !== this._chunkMassesKg[index]))
            throw new RangeError('Released chunk mass belongs to its new owner');
        const changed = masses.some((mass, index) => mass !== this._chunkMassesKg[index]);
        if (!changed) return { changed: false, totalMassKg: this.totalMassKg, deltaMassKg: 0 };
        if (this.family._graph.stress && this.world.module._pr_blast_stress_mass_abi?.() !== 1)
            throw new Error('Live Blast mass updates require native stress mass ABI 1');
        if (this.needsReconciliation) this.reconcile();
        const P = this.world.module, prepared = [], previousMass = this.totalMassKg;
        const read = value => [value.get_x(), value.get_y(), value.get_z()];
        try {
            for (const piece of this.bodies) {
                if (piece.indices.every(index => masses[index] === this._chunkMassesKg[index])) continue;
                const oldMass = piece.body.mass, mass = piece.indices.reduce((sum, index) => sum + masses[index], 0);
                const item = { piece, oldMass, mass }; prepared.push(item);
                if (piece.body.simMode === 'static') continue;
                const state = this._bodyState(piece.body), actor = piece.body._actor;
                const nativePose = actor.getCMassLocalPose(), q = nativePose.get_q();
                const old = { mass: actor.getMass(), center: state.centerOfMassOffset,
                    rotation: [q.get_x(), q.get_y(), q.get_z(), q.get_w()], inertia: read(actor.getMassSpaceInertiaTensor()) };
                const next = this._massFor(piece.indices, masses, piece.center);
                const delta = quatRotateVec3(next.center.map((value, axis) => value - old.center[axis]), state.rotation), w = state.angularVelocity;
                const spin = [w[1] * delta[2] - w[2] * delta[1], w[2] * delta[0] - w[0] * delta[2], w[0] * delta[1] - w[1] * delta[0]];
                const velocity = state.linearVelocity.map((value, axis) => value + spin[axis]);
                if (!finiteVector(velocity, 3)) throw new RangeError('Updated Blast center-of-mass velocity exceeds native precision');
                item.previous = nativeMassUpdate(P, old, state.linearVelocity);
                item.next = nativeMassUpdate(P, next, velocity); item.sleeping = state.sleeping;
            }
            let applied = 0;
            try {
                for (const item of prepared) { ++applied; if (item.next) item.next.apply(item.piece.body); else item.piece.body.mass = item.mass; }
                if (this.family._graph.stress) this.family.setChunkMasses(masses);
            } catch (error) {
                const failures = [];
                for (const item of prepared.slice(0, applied).reverse()) try {
                    item.previous?.apply(item.piece.body, false); item.piece.body.mass = item.oldMass;
                    if (item.sleeping) item.piece.body._actor.putToSleep();
                } catch (rollbackError) { failures.push(rollbackError); }
                if (failures.length) throw new AggregateError([error, ...failures], 'Blast mass update and native rollback failed');
                throw error;
            }
            this._chunkMassesKg = masses; this._explicitMasses = true; ++this._massRevision;
            const receipt = { changed: true, totalMassKg: this.totalMassKg, deltaMassKg: this.totalMassKg - previousMass, actorsUpdated: prepared.length };
            this.log?.('Blast chunk masses updated', receipt);
            return receipt;
        } finally { for (const item of prepared) { item.next?.dispose(); item.previous?.dispose(); } }
    }

    /** Transfer an already isolated leaf's actual native actor to its caller.
     * The caller owns disposal/replacement and its separate snapshot from here.
     * A retired index stays in the native damage graph but receives no loads. */
    releaseChunk(index) {
        if (this.disposed || this.world.destroyed) throw new Error('Blast scene is disposed');
        if (!Number.isInteger(index) || index < 0 || index >= this.chunks.length || this._releasedChunks.has(index))
            throw new RangeError('Unknown or already released Blast chunk');
        this.reconcile();
        const piece = this.bodies.find(value => value.indices.includes(index));
        if (!piece || piece.indices.length !== 1) throw new Error('Only an isolated single-chunk actor can be released');
        const groups = this.family.groups();
        if (groups.some((group, other) => other !== index && group === groups[index]))
            throw new Error('Blast chunk still belongs to a connected native island');
        const result = { ...piece, indices: [...piece.indices], center: [...piece.center],
            massKg: this._chunkMassesKg[index], motion: this._bodyState(piece.body) };
        this.bodies = this.bodies.filter(value => value !== piece); this._releasedChunks.add(index);
        this.stats.actors = this.bodies.length;
        this.log?.('Blast chunk ownership released', { index, massKg: result.massKg, handle: piece.body.handle });
        return result;
    }

    damageBond(index, amount) {
        return this.damageBonds([[index, amount]]);
    }

    /** Ordered damage batch with one native group readback and reconciliation. */
    damageBonds(commands) {
        if (this.disposed || this.world.destroyed) throw new Error('Blast scene is disposed');
        if (this.needsReconciliation) this.reconcile();
        this.needsReconciliation = true;
        let groups;
        const previousCommands = this.family._damageHistory.length;
        try { groups = this.family.damageMany(commands); }
        finally { this.stats.damageEvents += this.family._damageHistory.length - previousCommands; }
        return this._reconcile(groups);
    }

    /** Retry physical actor creation without applying native damage again. */
    reconcile() {
        if (this.disposed || this.world.destroyed) throw new Error('Blast scene is disposed');
        return this._reconcile(this.family.groups());
    }

    _reconcile(groups) {
        const replacements = [], retired = [];
        this.needsReconciliation = true;
        try {
            for (const parent of this.bodies) {
                const partitions = new Map();
                for (const i of parent.indices) { const group = groups[i]; if (!partitions.has(group)) partitions.set(group, []); partitions.get(group).push(i); }
                if (partitions.size < 2) continue;
                retired.push(parent);
                const state = { ...parent, body: this._bodyState(parent.body) };
                for (const indices of partitions.values()) replacements.push(this._create(indices, state));
            }
        } catch (error) {
            for (const piece of replacements) removeBody(this.world, piece.body.handle);
            this.log?.('Blast fragment creation failed', { error: String(error) });
            // The graph is committed, but the previous actors remain intact.
            // Call reconcile() before stepping again; do not replay the damage.
            throw error;
        }
        for (const old of retired) removeBody(this.world, old.body.handle);
        // Consumers key authored-local ownership/BVH caches by this array.
        // Partial interface damage does not change any actual actor/member.
        if (retired.length) this.bodies = this.bodies.filter(body => !retired.includes(body)).concat(replacements);
        this.stats.fractures += replacements.length - retired.length;
        this.stats.actors = this.bodies.length;
        this.needsReconciliation = false;
        if (retired.length) this.log?.('Blast scene fractured', { ...this.stats });
        return this.bodies;
    }

    _bodyState(body) {
        const actor = body._actor, transform = actor.getGlobalPose();
        const p = transform.get_p();
        const position = [p.get_x(), p.get_y(), p.get_z()];
        const q = transform.get_q();
        let rotation = [q.get_x(), q.get_y(), q.get_z(), q.get_w()];
        // Native mass-frame updates accumulate small float32 scale drift.
        // PxQuat::isUnit accepts <1e-3; publish the same orientation in our
        // stricter form before snapshot, fracture and mass/velocity handoffs.
        // This never repairs external input or changes the native actor.
        const magnitudeError = Math.abs(Math.hypot(...rotation) - 1);
        if (!finiteVector(rotation, 4) || magnitudeError >= 1e-3) throw new Error('Invalid native Blast rotation');
        if (magnitudeError > 1e-5) rotation = quatNormalize(rotation);
        const read = vector => [vector.get_x(), vector.get_y(), vector.get_z()];
        // Copy [Value] getters immediately: native temporaries are reused.
        const linearVelocity = body.simMode === 'static' ? [0, 0, 0] : read(actor.getLinearVelocity());
        const angularVelocity = body.simMode === 'static' ? [0, 0, 0] : read(actor.getAngularVelocity());
        const centerOfMassOffset = body.simMode === 'static' ? [0, 0, 0] : read(actor.getCMassLocalPose().get_p());
        if (!finiteVector(centerOfMassOffset, 3)) throw new Error('Invalid native Blast center of mass');
        return { position, rotation, linearVelocity, angularVelocity, centerOfMassOffset,
            sleeping: body.simMode !== 'static' && actor.isSleeping() };
    }

    /** Save authored geometry, native damage replay and current fragment motion. */
    snapshot() {
        this.reconcile();
        const physicalLoads = this.family._graph.stress?.settings.physicalLoads === true;
        const variableMass = this._explicitMasses || this._releasedChunks.size > 0 || physicalLoads;
        const revisedPhysical = physicalLoads && [2, 3].includes(this.family._physicalRevision);
        return { format: 'particle-realms/blast-scene', version: physicalLoads ? this.family._physicalRevision === 3 ? 7 : revisedPhysical ? 6 : 5 : variableMass ? 4 : this.family._graph.bondCentroids ? 3 : this.family._graph.bondAreasM2 ? 2 : 1,
            ...(physicalLoads ? { physicalStressAbi: 1 } : {}),
            ...(revisedPhysical ? { physicalStressRevision: this.family._physicalRevision } : {}),
            ...(variableMass ? { massAbi: 1, chunkMassesKg: this.chunkMassesKg, releasedChunks: this.releasedChunks } : {}),
            family: this.family.snapshot(), chunks: structuredClone(this.chunks),
            settings: { density: this.density, impulseThreshold: this.impulseThreshold,
                damageScale: this.damageScale, damageRadius: this.damageRadius, contactOffset: this.contactOffset },
            bodies: this.bodies.map(piece => {
                const { centerOfMassOffset, ...motion } = this._bodyState(piece.body);
                return { chunks: [...piece.indices], ...(variableMass ? { center: [...piece.center] } : {}), ...motion };
            }),
            stats: { ...this.stats } };
    }

    /** Recreates new Engine actor IDs; the snapshot's chunk indices stay stable. */
    static restore(world, snapshot, { log = null } = {}) {
        if (!world?.ready || world.destroyed) throw new Error('Blast requires a ready PhysX PE world');
        const physicalLoads = [5, 6, 7].includes(snapshot?.version), variableMass = [4, 5, 6, 7].includes(snapshot?.version);
        const sectionRevision = snapshot?.version === 7 ? 3 : snapshot?.version === 6 ? 2 : null;
        if (snapshot?.format !== 'particle-realms/blast-scene' || ![1, 2, 3, 4, 5, 6, 7].includes(snapshot.version)
            || (physicalLoads && (snapshot.physicalStressAbi !== 1 || snapshot.family?.version !== snapshot.version))
            || (sectionRevision !== null ? snapshot.physicalStressRevision !== sectionRevision : snapshot.physicalStressRevision !== undefined)
            || (!physicalLoads && snapshot.physicalStressAbi !== undefined)
            || (variableMass ? !(physicalLoads ? [snapshot.version] : [1, 2, 3, 4]).includes(snapshot.family?.version) : snapshot.family?.version !== snapshot.version)
            || !Array.isArray(snapshot.chunks) || !snapshot.settings || !Array.isArray(snapshot.bodies)
            || (!snapshot.bodies.length && !variableMass) || !snapshot.stats
            || !['damageEvents', 'fractures', 'actors'].every(key => Number.isSafeInteger(snapshot.stats[key]) && snapshot.stats[key] >= 0)
            || snapshot.stats.actors !== snapshot.bodies.length
            || !['density', 'damageRadius'].every(key => Number.isFinite(snapshot.settings[key]) && snapshot.settings[key] > 0)
            || (snapshot.settings.contactOffset !== undefined && !validContactOffset(snapshot.settings.contactOffset))
            || !['impulseThreshold', 'damageScale'].every(key => Number.isFinite(snapshot.settings[key]) && snapshot.settings[key] >= 0)) throw new RangeError('Invalid Blast scene snapshot');
        if (variableMass && (snapshot.massAbi !== 1 || !Array.isArray(snapshot.releasedChunks))) throw new RangeError('Invalid Blast scene mass snapshot');
        if (!variableMass && (snapshot.chunkMassesKg !== undefined || snapshot.releasedChunks !== undefined || snapshot.massAbi !== undefined))
            throw new RangeError('Explicit masses and released ownership require Blast scene snapshot version 4, 5, 6 or 7');
        const masses = variableMass ? validateChunkMasses(snapshot.chunkMassesKg, snapshot.chunks.length) : null;
        const released = new Set(snapshot.releasedChunks ?? []);
        if (released.size !== (snapshot.releasedChunks?.length ?? 0) || [...released].some(index => !Number.isInteger(index) || index < 0 || index >= snapshot.chunks.length)
            || snapshot.stats.fractures !== snapshot.bodies.length + released.size - 1) throw new RangeError('Invalid released Blast ownership');
        const ownership = new Set(released);
        for (const body of snapshot.bodies) {
            if (!validMotion(body) || (variableMass && !finiteVector(body.center, 3)) || typeof body.sleeping !== 'boolean' || !Array.isArray(body.chunks) || !body.chunks.length
                || (body.sleeping && [...body.linearVelocity, ...body.angularVelocity].some(value => value !== 0))) throw new RangeError('Invalid Blast fragment snapshot');
            for (const index of body.chunks) {
                if (!Number.isInteger(index) || index < 0 || index >= snapshot.chunks.length || ownership.has(index)) throw new RangeError('Invalid Blast fragment ownership');
                ownership.add(index);
            }
        }
        if (ownership.size !== snapshot.chunks.length) throw new RangeError('Incomplete Blast fragment ownership');
        let family = BlastFamily.restore(world.module, snapshot.family), scene;
        try {
            if (family.count !== snapshot.chunks.length) throw new RangeError('Blast snapshot geometry differs from native graph');
            snapshot.chunks.forEach((chunk, i) => {
                const native = family._graph.chunks[i];
                const geometry = chunk?.geometry ? validateBlastGeometry(chunk) : null;
                if (!finiteVector(chunk?.position, 3) || (!geometry && (!finiteVector(chunk.halfExtents, 3) || !chunk.halfExtents.every(value => value > 0)))
                    || typeof chunk.anchored !== 'boolean' || chunk.position.some((n, axis) => n !== native.position[axis])
                    || (geometry ? geometry.volume : 8 * chunk.halfExtents.reduce((a, b) => a * b, 1)) !== native.volume)
                    throw new RangeError('Blast snapshot geometry differs from native graph');
            });
            const groups = family.groups(), seenGroups = new Set();
            for (const index of released) {
                if (groups.some((group, other) => other !== index && group === groups[index])) throw new RangeError('Released Blast chunk is not an isolated native island');
                seenGroups.add(groups[index]);
            }
            for (const body of snapshot.bodies) {
                const group = groups[body.chunks[0]];
                if (seenGroups.has(group) || body.chunks.some(i => groups[i] !== group)) throw new RangeError('Blast fragment ownership differs from native replay');
                seenGroups.add(group);
            }
            const { density, impulseThreshold, damageScale, damageRadius, contactOffset = .02 } = snapshot.settings;
            if (family._graph.stress) {
                const authoredAnchors = snapshot.chunks.flatMap((chunk, index) => chunk.anchored ? [index] : []);
                const stressAnchors = family._graph.stress.anchoredChunks;
                if (family._graph.stress.densityKgM3 !== density || authoredAnchors.length !== stressAnchors.length
                    || authoredAnchors.some(index => !stressAnchors.includes(index))
                    || snapshot.stats.stressUpdates !== family._operations.filter(operation => operation[0] === 'stress').length)
                    throw new RangeError('Blast scene stress mass, anchors or update history differ from its geometry');
                const expectedMasses = masses ?? snapshot.chunks.map(chunk => chunk.volume * density);
                if (family.chunkMassesKg.some((mass, index) => mass !== expectedMasses[index]))
                    throw new RangeError('Blast scene masses differ from native stress replay');
            }
            scene = new this(world, { density, impulseThreshold, damageScale, damageRadius, contactOffset, chunks: snapshot.chunks,
                chunkMassesKg: masses,
                bonds: family._graph.bonds, health: family._graph.health, bondAreasM2: family._graph.bondAreasM2 ?? null,
                bondCentroids: family._graph.bondCentroids ?? null, bondNormals: family._graph.bondNormals ?? null,
                stress: family._graph.stress ? { settings: family._graph.stress.settings,
                    ...(family._graph.stress.sections ? { sections: family._graph.stress.sections } : {}) } : null });
            scene.family.dispose(); scene.family = family; family = null;
            for (const piece of scene.bodies) removeBody(world, piece.body.handle);
            scene.bodies.length = 0;
            scene._releasedChunks = released;
            for (const saved of snapshot.bodies) {
                const indices = [...saved.chunks];
                const piece = scene._create(indices, { center: variableMass ? saved.center : scene._center(indices), body: saved, preserveVelocity: true });
                scene.bodies.push(piece);
                if (saved.sleeping && piece.body.simMode !== 'static') piece.body._actor.putToSleep();
            }
            scene.stats = { ...snapshot.stats }; scene.log = log;
            scene.log?.('Blast scene restored', { ...scene.stats });
            return scene;
        } catch (error) { scene?.dispose(); family?.dispose(); throw error; }
    }

    chunkPose(index) {
        if (this.disposed) throw new Error('Blast scene is disposed');
        const piece = this.bodies.find(item => item.indices.includes(index));
        if (!piece) throw new RangeError('Unknown Blast chunk');
        return this._writeChunkPose(index, piece, { position: [], rotation: [] });
    }

    _writeChunkPose(index, piece, target) {
        const offset = quatRotateVec3(this.chunks[index].position.map((n, i) => n - piece.center[i]), piece.body.rotation);
        for (let axis = 0; axis < 3; ++axis) target.position[axis] = piece.body.position[axis] + offset[axis];
        for (let axis = 0; axis < 4; ++axis) target.rotation[axis] = piece.body.rotation[axis];
        return target;
    }

    /** Linear batch over current Engine body poses, after its completed native
     * fetch. Reuses caller entries; released indices are null and stay absent. */
    chunkPoses(target = []) {
        if (this.disposed) throw new Error('Blast scene is disposed');
        if (!Array.isArray(target)) throw new TypeError('Blast pose batch target must be an array');
        target.length = this.chunks.length;
        for (const index of this._releasedChunks) target[index] = null;
        for (const piece of this.bodies) for (const index of piece.indices) {
            const pose = target[index] ??= { position: [], rotation: [] };
            this._writeChunkPose(index, piece, pose); pose.actor = piece.body.handle;
        }
        return target;
    }

    _damageTargets(point, radius, amount, entityId = null) {
        if (this.disposed || this.world.destroyed) throw new Error('Blast scene is disposed');
        if (this.needsReconciliation) this.reconcile();
        if (point?.length !== 3 || !point.every(Number.isFinite) || !Number.isFinite(radius) || radius <= 0
            || !Number.isFinite(amount) || amount < 0) throw new RangeError('Invalid Blast radial damage');
        // Snapshot positions before splitting; all bonds receive the same impact.
        return this.bonds.map(([a, b], index) => {
            const parent = this.bodies.find(item => item.indices.includes(a));
            if (!parent?.indices.includes(b) || (entityId !== null && parent.entityId !== entityId)) return null;
            const authored = this.family._graph.bondCentroids?.[index];
            let center;
            if (authored) {
                const state = this._bodyState(parent.body);
                const offset = quatRotateVec3(authored.map((value, axis) => value - parent.center[axis]), state.rotation);
                center = state.position.map((value, axis) => value + offset[axis]);
            } else {
                const pa = this.chunkPose(a).position, pb = this.chunkPose(b).position;
                center = pa.map((value, axis) => (value + pb[axis]) / 2);
            }
            const distance = Math.hypot(...point.map((n, i) => n - center[i]));
            return distance < radius ? [index, amount * (1 - distance / radius)] : null;
        }).filter(Boolean);
    }

    damageAt(point, radius, amount, entityId = null) {
        const targets = this._damageTargets(point, radius, amount, entityId);
        for (const [index, damage] of targets) this.damageBond(index, damage);
        return targets.length;
    }

    applyContacts(events) {
        if (this.family._graph.bondAreasM2) throw new Error('Physical Blast contact stress requires updateStress({contactEvents, dt}); generic damageScale has no area units');
        const identities = new Set(this.bodies.map(item => item.entityId));
        const targets = [];
        for (const event of events) {
            const actors = new Set([event.entityA, event.entityB].filter(id => identities.has(id)));
            if (!actors.size) continue;
            for (const point of event.contactPoints ?? []) {
                const impulse = point.impulse ? Math.hypot(...point.impulse) : 0;
                if (impulse <= this.impulseThreshold || !point.position) continue;
                for (const id of actors) for (const target of this._damageTargets(point.position, this.damageRadius,
                    (impulse - this.impulseThreshold) * this.damageScale, id)) targets.push(target);
            }
        }
        // Native splits replace entity IDs. Resolve every event against the same
        // pre-fracture actors so later manifold points are not silently discarded.
        for (const [index, damage] of targets) this.damageBond(index, damage);
    }

    /** Fracture loads only: PhysX already integrates gravity/contact impulses.
     * `forces` contains {chunk, forceN:[x,y,z]} in world axes. Contacts use mean
     * force impulse/dt at the nearest owned chunk, before any actor is split.
     * Do not also apply the legacy heuristic applyContacts to a physical scene.
     */
    updateStress({ gravity = this.world.gravity, forces = [], contactEvents = [], dt = null } = {}) {
        if (this.disposed || this.world.destroyed) throw new Error('Blast scene is disposed');
        if (!this.family._graph.stress) throw new Error('Native Blast stress is not configured');
        if (!finiteVector(gravity, 3) || !Array.isArray(forces) || !Array.isArray(contactEvents)
            || (contactEvents.length && (!Number.isFinite(dt) || dt <= 0))) throw new RangeError('Invalid Blast stress loads or physical contact timestep');
        if (this.needsReconciliation) this.reconcile();
        const loads = new Float64Array(this.chunks.length * 3);
        const owners = new Map(), byChunk = new Map();
        for (const piece of this.bodies) {
            const state = this._bodyState(piece.body);
            const rotationInverse = [-state.rotation[0], -state.rotation[1], -state.rotation[2], state.rotation[3]];
            const owner = { piece, state, rotationInverse };
            owners.set(piece.entityId, owner);
            for (const index of piece.indices) byChunk.set(index, owner);
        }
        const add = (index, force) => {
            const owner = byChunk.get(index);
            if (!owner || !finiteVector(force, 3)) throw new RangeError('Invalid Blast stress force or chunk index');
            const local = quatRotateVec3(force, owner.rotationInverse);
            for (let axis = 0; axis < 3; ++axis) loads[index * 3 + axis] += local[axis];
        };
        this.chunks.forEach((chunk, index) => { if (!this._releasedChunks.has(index)) add(index,
            gravity.map(value => this._explicitMasses ? value * this._chunkMassesKg[index] : value * chunk.volume * this.density)); });
        for (const force of forces) {
            if (!Number.isInteger(force?.chunk)) throw new RangeError('Blast stress force needs an authored chunk index');
            add(force.chunk, force.forceN);
        }
        for (const event of contactEvents) {
            for (const [identity, sign] of [[event.entityA, 1], [event.entityB, -1]]) {
                const owner = owners.get(identity);
                if (!owner) continue;
                for (const point of event.contactPoints ?? []) {
                    if (!finiteVector(point.position, 3) || !finiteVector(point.impulse, 3)) throw new RangeError('Invalid native Blast contact load');
                    const position = quatRotateVec3(point.position.map((value, axis) => value - owner.state.position[axis]), owner.rotationInverse)
                        .map((value, axis) => value + owner.piece.center[axis]);
                    let nearest = -1, distance = Infinity;
                    for (const index of owner.piece.indices) {
                        const squared = this.chunks[index].position.reduce((sum, value, axis) => sum + (value - position[axis]) ** 2, 0);
                        if (squared < distance) { nearest = index; distance = squared; }
                    }
                    add(nearest, point.impulse.map(value => sign * value / dt));
                }
            }
        }
        this.needsReconciliation = true;
        const before = this.family._operations.length;
        let receipt;
        try { receipt = this.family.updateStress(loads); }
        finally { this.stats.stressUpdates += this.family._operations.length - before; }
        this._reconcile(receipt.groups);
        return receipt;
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        if (!this.world.destroyed) for (const piece of this.bodies) removeBody(this.world, piece.body.handle);
        this.bodies.length = 0; this.stats.actors = 0; this._releaseGeometry(); this.family.dispose();
        this.log?.('Blast scene disposed');
    }
}
