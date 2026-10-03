// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import {captureFlowRigidBody,solveFlowMomentumExchange} from './FlowMomentumExchange.js';

const owners = new WeakMap();
const rebasePreparations = new WeakMap();
const uint = value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const writableData = (object, key, label) => {
    const property = Object.getOwnPropertyDescriptor(object, key);
    if (!property || !('value' in property) || !property.writable) throw new TypeError(`${label} must be an owned writable data property`);
    return property.value;
};
function rebaseGeometryData(value) {
    if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') { if (!Number.isFinite(value)) throw new RangeError('Rebase geometry must be finite'); return value; }
    if (Array.isArray(value) || ArrayBuffer.isView(value) && !(value instanceof DataView)) return Array.from(value, rebaseGeometryData);
    if (Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError('Rebase geometry must contain plain owned data');
    const result = {};
    for (const key of Object.keys(value).sort()) {
        const property = Object.getOwnPropertyDescriptor(value, key);
        if (!property || !('value' in property)) throw new TypeError('Rebase geometry accessors are unsupported');
        result[key] = rebaseGeometryData(property.value);
    }
    return result;
}

/** Native Flow boundaries or legacy velocity obstacles from actual PhysX shapes.
 * Owns the borrowed solver's collider list, not its emitters, world or device.
 * Bind sphere/box bodies, step PhysX, then await step(dt) once for that same dt.
 * Solid mode requires the boundary-capable host explicitly. It admits native
 * planes and scaled convex hulls in addition to spheres/boxes. Neither mode
 * applies gas reaction by default. Explicit pairedMomentum enables a separate
 * conservative terminal normal exchange; it does not claim pressure/chemistry
 * conservation. Unsupported shapes fail admission.
 */
export class FlowPhysXCollision {
    constructor(world, solver, { log = null, solidBoundaries = false, pairedMomentum = null } = {}) {
        if (!world?.ready || world.destroyed || typeof solver?.setColliders !== 'function')
            throw new TypeError('Flow collision requires a ready PhysX world and collision-capable solver');
        if (owners.has(solver) || solver.stats?.collisionCount > 0)
            throw new Error('Flow collider list is already owned; use one adapter per solver');
        if (typeof solidBoundaries !== 'boolean' || solidBoundaries && typeof solver.setSolidBoundaries !== 'function')
            throw new Error('Solid Flow boundaries require the native boundary-capable host');
        if (pairedMomentum !== null && (!solidBoundaries || solver.module?._pr_flow_host_momentum_abi?.() !== 1
            || !(pairedMomentum.densities instanceof Map))) throw new TypeError('Paired momentum requires native ABI1, solids and explicit per-layer kg/m3 densities');
        this.pairedMomentum = pairedMomentum === null ? null : { densities: new Map(pairedMomentum.densities),
            maximumSweeps: pairedMomentum.maximumSweeps ?? 128, velocityTolerance: pairedMomentum.velocityTolerance ?? 1e-7, capacity: pairedMomentum.capacity ?? 393216,
            roundingVelocityTolerance: pairedMomentum.roundingVelocityTolerance ?? 1e-5,
            momentumRelativeTolerance: pairedMomentum.momentumRelativeTolerance ?? 2e-5,
            angularRelativeTolerance: pairedMomentum.angularRelativeTolerance ?? 2e-5,energyRelativeTolerance: pairedMomentum.energyRelativeTolerance ?? 2e-5 };
        if (this.pairedMomentum) {
            if (!this.pairedMomentum.densities.size || !Number.isInteger(this.pairedMomentum.capacity)
                || this.pairedMomentum.capacity < 1 || this.pairedMomentum.capacity > 393216) throw new RangeError('Invalid paired momentum capacity or density coverage');
            for (const [layer, density] of this.pairedMomentum.densities) if (!uint(layer) || layer > 65535 || !Number.isFinite(density) || density <= 0)
                throw new RangeError('Physical gas density must be positive finite kg/m3');
            solveFlowMomentumExchange([], [], [], this.pairedMomentum);
        }
        this.world = world; this.solver = solver; this.log = log;
        this.solidBoundaries = solidBoundaries; this.additionalGeometry = []; this.geometryIds = new Map();
        this.boundaryGeometry = [];
        this.bindings = new Map(); this._nextId = 1; this._pending = null; this.disposed = false; this.revision = 0; this.fault = null;
        this.stats = { mode: solidBoundaries ? 'native-solid-boundaries' : 'one-way-native-velocity-obstacle', bodies: 0, shapes: 0, steps: 0 };
        owners.set(solver, this);
        this.log?.('Flow PhysX collision adapter created', { ...this.stats });
    }

    _ready() {
        if (this.disposed || this.world.destroyed || this.fault) throw new Error('Flow PhysX collision adapter is disposed or failed');
        if (this._pending) throw new Error('Await the current Flow collision step before changing bindings');
    }

    _shapes(body) {
        if (!body?._actor || this.world.bodies.get(body.handle) !== body)
            throw new Error('Flow obstacle body is not owned by the borrowed PhysX world');
        const P = this.world.module, records = [];
        for (let i = 0; i < body._actor.getNbShapes(); ++i) {
            const shape = P.SupportFunctions.prototype.PxActor_getShape(body._actor, i);
            if (!shape?.ptr) throw new Error('Cannot read native Flow obstacle shape');
            if (!shape.getFlags().isSet(P.PxShapeFlagEnum.eSIMULATION_SHAPE)) continue;
            const holder = new P.PxGeometryHolder(shape.getGeometry());
            let geometry;
            try {
                if (holder.getType() === P.PxGeometryTypeEnum.eSPHERE) geometry = { type: 'sphere', radius: holder.sphere().get_radius() };
                else if (holder.getType() === P.PxGeometryTypeEnum.eBOX) {
                    const half = holder.box().get_halfExtents();
                    geometry = { type: 'box', halfSize: [half.get_x(), half.get_y(), half.get_z()] };
                } else if (this.solidBoundaries && holder.getType() === P.PxGeometryTypeEnum.ePLANE) geometry = { type: 'plane' };
                else if (this.solidBoundaries && holder.getType() === P.PxGeometryTypeEnum.eCONVEXMESH) {
                    if (P._pr_flow_boundary_convex_abi?.() !== 1) throw new Error('Native Flow convex boundary extraction ABI1 is required');
                    const count = P._pr_flow_boundary_convex(shape.ptr, 0, 0), size = 6 + count * 4;
                    if (count < 4) throw new Error('Native convex boundary plane query failed');
                    const pointer = P._malloc(size * 4);
                    if (!pointer) throw new Error('Native convex boundary allocation failed');
                    try {
                        if (P._pr_flow_boundary_convex(shape.ptr, pointer, size) !== count) throw new Error('Native scaled convex boundary extraction failed');
                        const values = Array.from(P.HEAPF32.subarray(pointer / 4, pointer / 4 + size));
                        if (!values.every(Number.isFinite)) throw new Error('Native convex boundary is nonfinite');
                        geometry = { type: 'convex', bounds: [values.slice(0, 3), values.slice(3, 6)],
                            planes: Array.from({ length: count }, (_, index) => values.slice(6 + index * 4, 10 + index * 4)) };
                    } finally { P._free(pointer); }
                } else throw new RangeError(this.solidBoundaries ? 'Unsupported native solid boundary geometry' : 'Flow native velocity obstacles currently require sphere or box shapes');
            } finally { P.destroy(holder); }
            const pose = P.PxShapeExt.prototype.getGlobalPose(shape, body._actor), p = pose.get_p();
            const position = [p.get_x(), p.get_y(), p.get_z()], q = pose.get_q();
            records.push({ key: shape.ptr, position, quaternion: [q.get_x(), q.get_y(), q.get_z(), q.get_w()], ...geometry });
        }
        if (!records.length) throw new RangeError('Flow obstacle body has no simulation shapes');
        return records;
    }

    /** Register a whole native compound. All its simulation shapes must be supported. */
    bind(body, { layer = 0, coupleRateVelocity = 120, multisample = true, enabled = true, paired = this.pairedMomentum !== null } = {}) {
        this._ready();
        if (this.bindings.has(body?.handle)) throw new Error('PhysX body is already bound to Flow');
        if (!uint(layer) || layer > 65535 || !(this.solver.sceneLayerIds ?? new Set([0])).has(layer)
            || !Number.isFinite(coupleRateVelocity) || coupleRateVelocity < 0
            || !Number.isFinite(Math.fround(coupleRateVelocity)) || typeof multisample !== 'boolean' || typeof enabled !== 'boolean')
            throw new RangeError('Invalid Flow obstacle settings');
        const shapes = this._shapes(body);
        if (typeof paired !== 'boolean' || paired && (!this.pairedMomentum || !this.pairedMomentum.densities.has(layer))) throw new RangeError('Paired body requires a calibrated gas layer');
        if (paired) captureFlowRigidBody(this.world, body);
        if (this._nextId + shapes.length > 0x100000000) throw new RangeError('Flow obstacle IDs exhausted');
        const ids = new Map(shapes.map(shape => [shape.key, this._nextId++]));
        this.bindings.set(body.handle, { body, layer, coupleRateVelocity, multisample, enabled, paired, ids, resetMotion: true });
        this.revision++;
        this.stats.bodies = this.bindings.size;
        this.log?.('PhysX body bound to Flow', { handle: body.handle, shapes: shapes.length, layer });
        return [...ids.values()];
    }

    unbind(body) {
        this._ready();
        const removed = this.bindings.delete(body?.handle);
        if (removed) this.revision++;
        this.stats.bodies = this.bindings.size;
        if (removed) this.log?.('PhysX body unbound from Flow', { handle: body.handle });
        return removed;
    }

    /** Reconcile actual body ownership after native fracture. Admission of new
     * bodies completes before old bindings are retired; no fragment is omitted. */
    syncBodies(bodies) {
        this._ready();
        if (!Array.isArray(bodies) || new Set(bodies).size !== bodies.length) throw new RangeError('Flow bodies must be a unique array');
        const added = [];
        try {
            for (const body of bodies) if (!this.bindings.has(body?.handle)) { this.bind(body); added.push(body); }
        } catch (error) { for (const body of added) this.unbind(body); throw error; }
        const wanted = new Set(bodies);
        for (const binding of this.bindings.values()) if (!wanted.has(binding.body)) this.unbind(binding.body);
    }

    /** Solved surfaces without a rigid proxy, such as the elastic glass pane.
     * Keys must persist across pose updates; the host validates exact geometry. */
    setAdditionalGeometry(records) {
        this._ready();
        if (!this.solidBoundaries || !Array.isArray(records)) throw new RangeError('Additional surfaces require solid boundary mode');
        const seen = new Set(), next = [];
        for (const record of records) {
            if (typeof record?.key !== 'string' || !record.key || seen.has(record.key)) throw new RangeError('Additional Flow surfaces need unique persistent keys');
            seen.add(record.key);
            let id = this.geometryIds.get(record.key);
            if (id === undefined) {
                if (!uint(this._nextId)) throw new RangeError('Flow obstacle IDs exhausted');
                id = this._nextId++; this.geometryIds.set(record.key, id);
            }
            const { key, ...geometry } = record;
            // A caller's pose arrays may be reused for native readback. Copy
            // them so completed field diagnostics retain the submitted pose.
            next.push({ layer: 0, enabled: true, ...geometry, id,
                position: geometry.position ? [...geometry.position] : [0, 0, 0],
                quaternion: geometry.quaternion ? [...geometry.quaternion] : [0, 0, 0, 1] });
        }
        this.additionalGeometry = next;
        this.revision++;
        for (const key of this.geometryIds.keys()) if (!seen.has(key)) this.geometryIds.delete(key);
    }

    /** Call after a teleport so Flow does not interpret it as physical velocity. */
    resetMotion(body) {
        this._ready();
        const binding = this.bindings.get(body?.handle);
        if (!binding) throw new RangeError('PhysX body is not bound to Flow');
        binding.resetMotion = true;
        this.revision++;
    }

    setEnabled(body, enabled) {
        this._ready();
        const binding = this.bindings.get(body?.handle);
        if (!binding || typeof enabled !== 'boolean') throw new RangeError('Invalid Flow body enable change');
        // Keep tracking the disabled pose and prime before re-enabling.
        if (enabled !== binding.enabled) binding.resetMotion = true;
        binding.enabled = enabled;
        this.revision++;
    }

    /** Choose the closest native-compatible local shift; no state is changed. */
    selectRebaseShift(desired) {
        this._ready();
        if (!Array.isArray(desired) || desired.length !== 3 || !desired.every(Number.isFinite)) throw new RangeError('Invalid requested Flow rebase');
        const period = this.solver.rebasePeriod();
        const shift = period.map((value, axis) => Math.round(desired[axis] / value) * value);
        if (!shift.every(value => Number.isFinite(value) && Math.fround(value) === value)) throw new RangeError('Rebase shift is not exactly representable by PhysX');
        this.solver.validateRebase(shift);
        return shift;
    }

    _bodyRebaseState(body) {
        if (this.world.bodies.get(body.handle) !== body || !body._actor?.getGlobalPose) throw new Error('Rebase body ownership changed');
        const pose = body._actor.getGlobalPose(), p = pose.get_p(), q = pose.get_q();
        // These WebIDL value getters borrow their native temporaries.
        const position = [p.get_x(), p.get_y(), p.get_z()];
        const values = [...position, q.get_x(), q.get_y(), q.get_z(), q.get_w()];
        for (const getter of ['getLinearVelocity', 'getAngularVelocity']) if (typeof body._actor[getter] === 'function') {
            const value = body._actor[getter](); values.push(value.get_x(), value.get_y(), value.get_z());
        }
        const cacheProperty = Object.getOwnPropertyDescriptor(body, 'position'), cache = cacheProperty?.value;
        if (!values.every(Number.isFinite) || !cache || cache.length !== 3) throw new RangeError('Rebase body state is nonfinite');
        const cached = [0, 1, 2].map(axis => writableData(cache, String(axis), 'Body position component'));
        if (!cached.every(Number.isFinite)) throw new RangeError('Rebase body position cache is nonfinite');
        return { body, actor: body._actor, position, values, cache, cached };
    }

    /** Prepare after all shared-device work completes. Tokens are single-use;
     * the caller must keep the shared physics clock paused through commit.
     */
    async prepareRebase(shift, { floatingOrigin = null } = {}) {
        this._ready();
        if (!this.solidBoundaries || typeof this.world.scene?.shiftOrigin !== 'function'
            || typeof this.solver.prepareRebase !== 'function') throw new Error('Coordinated rebase requires native solids, scene.shiftOrigin and Flow rebase ABI1');
        if (!Array.isArray(shift) || shift.length !== 3 || !shift.every(value => Number.isFinite(value) && Math.fround(value) === value)) {
            throw new RangeError('Coordinated shift must be three finite, exact f32 metre values');
        }
        if (floatingOrigin !== null && (typeof floatingOrigin.prepareRebase !== 'function'
            || typeof floatingOrigin.validatePreparedRebase !== 'function' || typeof floatingOrigin.commitPreparedRebase !== 'function')) {
            throw new TypeError('Coordinated origin requires the prepared rebase protocol');
        }
        const ownedShift = Object.freeze([...shift]);
        this._pending = (async () => {
            const flowToken = await this.solver.prepareRebase(ownedShift);
            const bodies = [...this.world.bodies.values()].map(body => this._bodyRebaseState(body));
            let maximumPoseRoundingMetres = 0;
            const translate = position => position.map((value, axis) => {
                const exact = value - ownedShift[axis], rounded = Math.fround(exact);
                if (!Number.isFinite(value) || !Number.isFinite(rounded)) throw new RangeError('Rebased world position is outside f32 range');
                maximumPoseRoundingMetres = Math.max(maximumPoseRoundingMetres, Math.abs(exact - rounded));
                return rounded;
            });
            for (const state of bodies) state.next = translate(state.position);
            const geometryBefore = [rebaseGeometryData(this.additionalGeometry), rebaseGeometryData(this.boundaryGeometry)];
            const additional = geometryBefore[0].map(record => ({ ...record, position: translate(record.position) }));
            const boundaries = geometryBefore[1].map(record => ({ ...record, position: translate(record.position) }));
            const contactEvents = this.world.contactEvents;
            const contactLists = [], contacts = [];
            for (const event of contactEvents ?? []) {
                contactLists.push({ event, list: event.contactPoints, entries: [...(event.contactPoints ?? [])] });
                for (const contact of event.contactPoints ?? []) {
                if (contact.position) {
                    const position = writableData(contact, 'position', 'Contact position');
                    contacts.push({ contact, position, previous: [...position], next: translate(position) });
                }
                }
            }
            const originToken = floatingOrigin?.prepareRebase(ownedShift) ?? null;
            const token = Object.freeze({ shift: ownedShift, maximumPoseRoundingMetres });
            rebasePreparations.set(token, { owner: this, revision: this.revision, used: false, flowToken, bodies,
                geometryBefore, additional, boundaries, contactEvents, contactLists, contacts, floatingOrigin, originToken, scene: this.world.scene, frames: this.solver.stats.frames });
            return token;
        })();
        try { return await this._pending; }
        finally { this._pending = null; }
    }

    commitPreparedRebase(token) {
        this._ready();
        const plan = rebasePreparations.get(token);
        if (!plan || plan.owner !== this || plan.used || plan.revision !== this.revision || plan.scene !== this.world.scene
            || plan.frames !== this.solver.stats.frames || plan.bodies.length !== this.world.bodies.size) throw new Error('Prepared coupled rebase is stale or reused');
        this.solver.validatePreparedRebase(plan.flowToken);
        plan.floatingOrigin?.validatePreparedRebase(plan.originToken);
        for (const state of plan.bodies) {
            const current = this._bodyRebaseState(state.body);
            if (state.actor !== current.actor || state.cache !== current.cache || state.values.some((value, axis) => value !== current.values[axis])
                || state.cached.some((value, axis) => value !== current.cached[axis])) throw new Error('Native body or position cache changed after rebase preparation');
        }
        if (JSON.stringify(plan.geometryBefore) !== JSON.stringify([rebaseGeometryData(this.additionalGeometry), rebaseGeometryData(this.boundaryGeometry)])) {
            throw new Error('Boundary geometry changed after rebase preparation');
        }
        if (this.world.contactEvents !== plan.contactEvents || (this.world.contactEvents?.length ?? 0) !== plan.contactLists.length
            || plan.contactLists.some(({ event, list, entries }, index) => this.world.contactEvents[index] !== event
                || event.contactPoints !== list || (list?.length ?? 0) !== entries.length || entries.some((entry, at) => list[at] !== entry))) {
            throw new Error('Contact ownership changed after rebase preparation');
        }
        for (const { contact, position, previous } of plan.contacts) if (writableData(contact, 'position', 'Contact position') !== position
            || previous.some((value, axis) => value !== position[axis])) throw new Error('Contacts changed after rebase preparation');
        const P = this.world.module, nativeShift = new P.PxVec3(...token.shift);
        plan.used = true;
        try {
            this._pending = this.solver.commitPreparedRebase(plan.flowToken, () => {
                // No await or user callback lies between these native commits.
                plan.scene.shiftOrigin(nativeShift);
                for (const state of plan.bodies) for (let axis = 0; axis < 3; axis++) state.cache[axis] = state.next[axis];
                for (const { contact, next } of plan.contacts) contact.position = next;
                this.additionalGeometry = plan.additional; this.boundaryGeometry = plan.boundaries; this.revision++;
                plan.floatingOrigin?.commitPreparedRebase(plan.originToken);
            });
        } catch (error) { P.destroy(nativeShift); throw error; }
        return this._pending.then(receipt => ({ ...receipt, maximumPoseRoundingMetres: token.maximumPoseRoundingMetres, bodies: plan.bodies.length }))
            .catch(error => { this.fault = error; this.log?.('Coordinated Flow rebase failed', { error: String(error) }); throw error; })
            .finally(() => { P.destroy(nativeShift); this._pending = null; });
    }

    async rebase(shift, options) {
        return this.commitPreparedRebase(await this.prepareRebase(shift, options));
    }

    async _exchangeMomentum() {
        const configuration=this.pairedMomentum;
        if(!configuration)throw new Error('Paired Flow momentum is not configured');
        const configurationStamp=JSON.stringify({...configuration,densities:[...configuration.densities]});
        const revision=this.revision,states=[],shapeBodies=new Map();
        for(const binding of this.bindings.values())if(binding.paired&&binding.enabled){
            const state=captureFlowRigidBody(this.world,binding.body);
            state.shapes=JSON.stringify(this._shapes(binding.body));state.binding=binding;
            state.bindingStamp=JSON.stringify([binding.layer,binding.enabled,binding.paired,[...binding.ids]]);
            state.caches=[...new Set(['velocity','linearVelocity','angularVelocity'].map(name=>writableData(binding.body,name,'Body velocity cache')))];
            state.cacheValues=state.caches.map(cache=>[0,1,2].map(axis=>writableData(cache,String(axis),'Body velocity component')));
            if(!state.cacheValues.flat().every(Number.isFinite))throw new RangeError('Body velocity cache is nonfinite');
            const index=states.length;states.push(state);for(const id of binding.ids.values())shapeBodies.set(id,index);
        }
        if(!states.length)return {status:'NO_PAIRED_BODIES',advancedTime:0};
        const token=await this.solver.prepareMomentumExchange(configuration.densities,{capacity:configuration.capacity});
        const contacts=token.contacts.map(contact=>{
            const body=shapeBodies.get(contact.shape);if(body===undefined)throw new Error('Native paired boundary has no finite body owner');
            return {...contact,body};
        });
        const result=solveFlowMomentumExchange(token.gas,states,contacts,configuration);
        this.solver.validatePreparedMomentum(token);
        if(this.revision!==revision || configuration!==this.pairedMomentum
            || configurationStamp!==JSON.stringify({...configuration,densities:[...configuration.densities]}))throw new Error('Paired body topology or physical controls changed during gas readback');
        states.forEach(state=>{
            const current=captureFlowRigidBody(this.world,state.body);
            if(state.actor!==current.actor||state.fingerprint.some((value,index)=>value!==current.fingerprint[index])
                ||this.bindings.get(state.body.handle)!==state.binding||state.bindingStamp!==JSON.stringify([state.binding.layer,state.binding.enabled,state.binding.paired,[...state.binding.ids]])
                ||state.shapes!==JSON.stringify(this._shapes(state.body)))throw new Error('Paired body mass, inertia, pose, velocity or geometry changed');
            const caches=[...new Set(['velocity','linearVelocity','angularVelocity'].map(name=>writableData(state.body,name,'Body velocity cache')))];
            if(caches.length!==state.caches.length||caches.some((cache,index)=>cache!==state.caches[index]
                ||state.cacheValues[index].some((value,axis)=>value!==writableData(cache,String(axis),'Body velocity component'))))throw new Error('Paired velocity cache changed during preparation');
        });
        const P=this.world.module,native=[];
        try{
            for(const value of result.bodies){native.push(new P.PxVec3(...value.velocity));native.push(new P.PxVec3(...value.angularVelocity));}
            const receipt=await this.solver.commitPreparedMomentum(token,result.gas.map(value=>value.velocity),()=>{
                states.forEach((state,index)=>{
                    state.actor.setLinearVelocity(native[index*2],true);state.actor.setAngularVelocity(native[index*2+1],true);
                    for(const key of ['velocity','linearVelocity','angularVelocity'])for(let axis=0;axis<3;axis++)state.body[key][axis]=result.bodies[index][key==='angularVelocity'?'angularVelocity':'velocity'][axis];
                });
            });
            return {...result.receipt,...receipt,densitiesKgPerM3:[...configuration.densities],
                heatDisposition:'unapplied-explicit-obligation',scope:'terminal-normal-exchange-only'};
        }finally{for(const value of native)P.destroy(value);}
    }

    async exchangeMomentum() {
        this._ready();this._pending=this._exchangeMomentum();
        try{return await this._pending;}catch(error){if(this.solver.fault)this.fault=error;throw error;}
        finally{this._pending=null;}
    }

    async step(dt) {
        this._ready();
        if (!Number.isFinite(dt) || dt <= 0 || dt > .1) throw new RangeError('Flow collision step must be in (0, 0.1] seconds');
        const records = [], removed = [];
        for (const [handle, binding] of this.bindings) {
            if (this.world.bodies.get(handle) !== binding.body) { removed.push(handle); continue; }
            const shapes = this._shapes(binding.body), active = new Set();
            for (const shape of shapes) {
                active.add(shape.key);
                let id = binding.ids.get(shape.key), resetMotion = binding.resetMotion;
                if (id === undefined) {
                    if (!uint(this._nextId)) throw new RangeError('Flow obstacle IDs exhausted');
                    id = this._nextId++; binding.ids.set(shape.key, id); resetMotion = true;
                }
                const { key, ...geometry } = shape;
                records.push({ ...geometry, id, layer: binding.layer, enabled: binding.enabled, resetMotion,
                    ...(this.solidBoundaries ? {terminalExchange:binding.paired} : { coupleRateVelocity: binding.coupleRateVelocity, multisample: binding.multisample }) });
            }
            for (const key of binding.ids.keys()) if (!active.has(key)) binding.ids.delete(key);
        }
        const boundaryGeometry = this.solidBoundaries ? [...records, ...this.additionalGeometry] : [];
        const receipt = this.solidBoundaries ? this.solver.setSolidBoundaries(boundaryGeometry) : this.solver.setColliders(records);
        this.boundaryGeometry = boundaryGeometry;
        for (const handle of removed) this.bindings.delete(handle);
        this.stats.bodies = this.bindings.size; this.stats.shapes = records.length + this.additionalGeometry.length;
        this._pending = this.solver.step(dt);
        try {
            await this._pending;
            const momentum=this.pairedMomentum?await this._exchangeMomentum():null;
            for (const binding of this.bindings.values()) binding.resetMotion = false;
            ++this.stats.steps;
            this.revision++;
            return { ...receipt, ...this.stats, ...(momentum?{momentum}: {}) };
        } catch (error) {
            this.log?.('Flow PhysX collision step failed', { error: String(error) }); throw error;
        } finally { this._pending = null; }
    }

    async dispose() {
        if (this.disposed) return;
        this.disposed = true;
        try {
            if (this._pending) { try { await this._pending; } catch { /* Native failure is reported by step. */ } }
            if (!this.solver.disposed && !this.solver.fault) {
                if (this.solidBoundaries) this.solver.setSolidBoundaries([]);
                else this.solver.setColliders([]);
            }
        } finally {
            this.bindings.clear(); owners.delete(this.solver);
            this.additionalGeometry.length = 0; this.geometryIds.clear();
            this.boundaryGeometry.length = 0;
            this.stats.bodies = 0; this.stats.shapes = 0;
            this.log?.('Flow PhysX collision adapter disposed');
        }
    }
}
