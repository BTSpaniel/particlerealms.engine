// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { validateChunkMasses } from './BlastMassProperties.js';
import { validateBlastSections } from './BlastInterfaceSections.js';
const finiteF32 = value => Number.isFinite(value) && Number.isFinite(Math.fround(value));
const forceArray = (value, count) => (Array.isArray(value) || ArrayBuffer.isView(value))
    && value.length === count * 3 && Array.from(value).every(finiteF32);

function sectionV3PreparationIdentity(module) {
    const getter = module._pr_blast_stress_sections_v3_preparation_abi;
    if (getter === undefined) return undefined;
    if (typeof getter !== 'function' || getter() !== 1)
        throw new Error('Unsupported native Blast section revision 3 preparation ABI');
    return 'submitted-f32-data/f64-physical-preparation-v1';
}

function stressConfiguration(value, chunks, bondCount) {
    if (!value || !finiteF32(value.densityKgM3) || Math.fround(value.densityKgM3) <= 0
        || !Array.isArray(value.anchoredChunks ?? [])) throw new RangeError('Invalid Blast stress mass/support configuration');
    const anchoredChunks = [...(value.anchoredChunks ?? [])];
    if (new Set(anchoredChunks).size !== anchoredChunks.length
        || anchoredChunks.some(index => !Number.isInteger(index) || index < 0 || index >= chunks.length)) throw new RangeError('Invalid Blast stress anchored chunk');
    const masses = validateChunkMasses(value.chunkMassesKg ?? chunks.map(chunk => chunk.volume * value.densityKgM3), chunks.length);
    if (value.settings != null && (typeof value.settings !== 'object' || Array.isArray(value.settings))) throw new RangeError('Blast stress settings must be an object');
    const input = value.settings ?? {}, settings = {};
    if (input.physicalLoads !== undefined && typeof input.physicalLoads !== 'boolean')
        throw new RangeError('Blast physical load mode must be a boolean');
    if (input.physicalLoads !== undefined) settings.physicalLoads = input.physicalLoads;
    if (input.graphReductionLevel != null && input.graphReductionLevel !== 0) throw new RangeError('Blast stress graph reduction is not supported');
    settings.maxSolverIterationsPerFrame = input.maxSolverIterationsPerFrame ?? 25;
    if (!Number.isInteger(settings.maxSolverIterationsPerFrame) || settings.maxSolverIterationsPerFrame < 1
        || settings.maxSolverIterationsPerFrame > 0xffffffff) throw new RangeError('Invalid Blast stress iteration count');
    for (const channel of ['compression', 'tension', 'shear']) {
        const elastic = `${channel}ElasticLimitPa`, fatal = `${channel}FatalLimitPa`;
        settings[elastic] = input[elastic] ?? settings.compressionElasticLimitPa ?? 1;
        settings[fatal] = input[fatal] ?? settings.compressionFatalLimitPa ?? 2;
        if (!finiteF32(settings[elastic]) || !finiteF32(settings[fatal]) || Math.fround(settings[elastic]) < 0
            || Math.fround(settings[fatal]) <= Math.fround(settings[elastic])) throw new RangeError('Blast stress requires fatal pressure greater than elastic pressure in Pa');
    }
    if (value.sections !== undefined && settings.physicalLoads !== true)
        throw new RangeError('Elastic interface sections require physical load mode');
    if (input.sectionSolverRevision !== undefined) {
        if (value.sections === undefined || settings.physicalLoads !== true
            || ![2, 3].includes(input.sectionSolverRevision))
            throw new RangeError('Blast section solver revision must be 2 or 3 in physical section mode');
        settings.sectionSolverRevision = input.sectionSolverRevision;
    }
    return { densityKgM3: value.densityKgM3, anchoredChunks, settings,
        ...(value.sections !== undefined ? { sections: validateBlastSections(value.sections, bondCount) } : {}),
        ...(value.chunkMassesKg !== undefined ? { chunkMassesKg: masses } : {}) };
}

/** Owns a real NVIDIA Blast support graph in the shared PhysX PE WASM heap.
 * Legacy health is arbitrary damage units. Explicit bondAreasM2 opts into
 * remaining-area health; health then means its initial fraction in (0,1].
 */
export class BlastFamily {
    constructor(module, { chunks, bonds, health = 1, bondAreasM2 = null, bondCentroids = null, bondNormals = null, stress = null }) {
        if (module?._pr_blast_scene_abi?.() !== 1) throw new Error('PhysX PE Blast scene ABI 1 is required');
        if (!Array.isArray(chunks) || chunks.length < 2 || chunks.length > 4096
            || !Array.isArray(bonds) || bonds.length > 65536 || !Number.isFinite(health)
            || !Number.isFinite(Math.fround(health)) || Math.fround(health) <= 0) throw new RangeError('Invalid Blast graph');
        const data = new Float32Array(chunks.length * 4), edges = new Uint32Array(bonds.length * 2);
        chunks.forEach((chunk, i) => {
            if (chunk.position?.length !== 3 || !chunk.position.every(Number.isFinite)
                || !Number.isFinite(chunk.volume) || chunk.volume <= 0) throw new RangeError('Invalid Blast chunk');
            data.set([...chunk.position, chunk.volume], i * 4);
            if (!data.subarray(i * 4, i * 4 + 4).every(Number.isFinite) || data[i * 4 + 3] <= 0) throw new RangeError('Blast chunk exceeds native precision');
        });
        const neighbours = chunks.map(() => []), pairs = new Set();
        bonds.forEach((bond, i) => {
            if (bond?.length !== 2 || !bond.every(n => Number.isInteger(n) && n >= 0 && n < chunks.length)
                || bond[0] === bond[1]) throw new RangeError('Invalid Blast bond');
            const key = [...bond].sort((a, b) => a - b).join(':');
            if (pairs.has(key)) throw new RangeError('Duplicate Blast bond');
            pairs.add(key); edges.set(bond, i * 2);
            neighbours[bond[0]].push(bond[1]); neighbours[bond[1]].push(bond[0]);
        });
        const visited = new Set([0]), pending = [0];
        while (pending.length) for (const n of neighbours[pending.pop()]) if (!visited.has(n)) { visited.add(n); pending.push(n); }
        if (visited.size !== chunks.length) throw new RangeError('Initial Blast support graph must be connected');
        const physical = bondAreasM2 !== null;
        if (physical && (module._pr_blast_stress_abi?.() !== 1 || !Array.isArray(bondAreasM2)
            || bondAreasM2.length !== bonds.length || health > 1 || bondAreasM2.some(area => !finiteF32(area)
                || Math.fround(area) <= 0 || !finiteF32(Math.fround(area) * Math.fround(health))
                || Math.fround(Math.fround(area) * Math.fround(health)) <= 0))) throw new RangeError('Physical Blast requires explicit positive bond areas in m2 and initial health fraction <=1');
        if (stress && !physical) throw new RangeError('Native stress requires a physical bondAreasM2 graph');
        const authored = bondCentroids !== null || bondNormals !== null;
        if (authored && (!physical || module._pr_blast_authoring_abi?.() !== 1
            || ![bondCentroids, bondNormals].every(vectors => Array.isArray(vectors) && vectors.length === bonds.length
                && vectors.every(vector => Array.isArray(vector) && vector.length === 3 && vector.every(finiteF32)))
            || bondNormals.some(normal => Math.abs(Math.hypot(...normal) - 1) > 1e-4)))
            throw new RangeError('Authored Blast requires physical areas, finite bond centroids and unit normals');
        const stressConfig = stress === null ? null : stressConfiguration(stress, chunks, bonds.length);
        const sectionRevision = stressConfig?.sections ? stressConfig.settings.sectionSolverRevision ?? 2 : null;
        if (stressConfig?.settings.physicalLoads && (module._pr_blast_stress_physical_abi?.() !== 1
            || typeof module._pr_blast_stress_configure_physical !== 'function'
            || typeof module._pr_blast_stress_update_physical !== 'function'
            || typeof module._pr_blast_stress_physical_tolerance !== 'function'))
            throw new Error('Mass-preserving Blast stress requires native physical stress ABI 1');
        if (module._pr_blast_stress_physical_revision !== undefined && typeof module._pr_blast_stress_physical_revision !== 'function')
            throw new Error('Invalid native physical stress revision getter');
        if (stressConfig?.sections && (module._pr_blast_stress_sections_abi?.() !== 1
            || typeof module._pr_blast_stress_configure_sections !== 'function'
            || typeof module._pr_blast_stress_physical_revision !== 'function'
            || typeof module._pr_blast_stress_section_results !== 'function'))
            throw new Error('Elastic interface sections require native sections ABI 1');
        if (sectionRevision === 3 && (module._pr_blast_stress_sections_v3_abi?.() !== 1
            || typeof module._pr_blast_stress_configure_sections_v3 !== 'function'))
            throw new Error('Blast section solver revision 3 requires native sections v3 ABI 1');
        this._sectionPreparationIdentity = sectionRevision === 3 ? sectionV3PreparationIdentity(module) : undefined;
        this.module = module; this.count = chunks.length; this.bondCount = bonds.length;
        this._graph = { chunks: chunks.map(({ position, volume }) => ({ position: [...position], volume })),
            bonds: bonds.map(bond => [...bond]), health };
        if (physical) Object.assign(this._graph, { bondAreasM2: [...bondAreasM2], stress: stressConfig });
        if (authored) Object.assign(this._graph, { bondCentroids: bondCentroids.map(vector => [...vector]),
            bondNormals: bondNormals.map(vector => [...vector]) });
        this._damageHistory = [];
        this._operations = [];
        this._stressFailure = null;
        this._chunkMassesKg = stressConfig ? [...(stressConfig.chunkMassesKg ?? chunks.map(chunk => chunk.volume * stressConfig.densityKgM3))] : null;
        this._massUpdates = false;
        this.handle = this.groupsPointer = this.healthPointer = this.forcePointer = this.stressPointer = this.sectionResultsPointer = 0;
        const input = module._malloc(data.byteLength + edges.byteLength + (physical ? bonds.length * 4 : 0)
            + (authored ? bonds.length * 24 : 0));
        if (!input) throw new Error('Blast input allocation failed');
        try {
            module.HEAPF32.set(data, input / 4); module.HEAPU32.set(edges, (input + data.byteLength) / 4);
            if (physical) {
                const areaPointer = input + data.byteLength + edges.byteLength;
                module.HEAPF32.set(bondAreasM2, areaPointer / 4);
                if (authored) {
                    const centroidPointer = areaPointer + bonds.length * 4, normalPointer = centroidPointer + bonds.length * 12;
                    module.HEAPF32.set(bondCentroids.flat(), centroidPointer / 4);
                    module.HEAPF32.set(bondNormals.flat(), normalPointer / 4);
                    this.handle = module._pr_blast_family_create_authored(this.count, input, bonds.length,
                        input + data.byteLength, health, areaPointer, centroidPointer, normalPointer);
                } else this.handle = module._pr_blast_family_create_physical(this.count, input, bonds.length, input + data.byteLength, health, areaPointer);
            } else this.handle = module._pr_blast_family_create(this.count, input, bonds.length, input + data.byteLength, health);
            if (!this.handle) throw new Error('Native Blast rejected support graph');
            this.groupsPointer = module._malloc(chunks.length * 4);
            if (!this.groupsPointer) throw new Error('Blast group allocation failed');
            if (physical) {
                this.healthPointer = module._malloc(bonds.length * 4);
                if (!this.healthPointer) throw new Error('Blast area allocation failed');
            }
            if (stressConfig) {
                this.forcePointer = module._malloc(Math.max(chunks.length * 3, chunks.length + 6) * 4);
                this.stressPointer = module._malloc(6 * 8);
                if (!this.forcePointer || !this.stressPointer) throw new Error('Blast stress allocation failed');
                const anchored = new Set(stressConfig.anchoredChunks), settings = stressConfig.settings;
                module.HEAPF32.set(this._chunkMassesKg.map((mass, index) => anchored.has(index) ? 0 : mass), this.forcePointer / 4);
                const limits = ['compression', 'tension', 'shear'].flatMap(channel =>
                    [settings[`${channel}ElasticLimitPa`], settings[`${channel}FatalLimitPa`]]);
                const limitsPointer = this.forcePointer + chunks.length * 4;
                module.HEAPF32.set(limits, limitsPointer / 4);
                if (stressConfig.sections) {
                    const sections = stressConfig.sections, matrixBytes = bonds.length * 36 * 8;
                    const sampleOffset = Math.ceil((matrixBytes + sections.offsets.length * 4) / 8) * 8;
                    const sectionInput = module._malloc(sampleOffset + sections.samples.length * 24 * 8);
                    if (!sectionInput) throw new Error('Blast interface section allocation failed');
                    try {
                        sections.stiffness.forEach((row, i) => module.HEAPF64.set(row, sectionInput / 8 + i * 36));
                        module.HEAPU32.set(sections.offsets, (sectionInput + matrixBytes) / 4);
                        sections.samples.forEach((row, i) => module.HEAPF64.set(row, (sectionInput + sampleOffset) / 8 + i * 24));
                        const configureSections = sectionRevision === 3 ? module._pr_blast_stress_configure_sections_v3
                            : module._pr_blast_stress_configure_sections;
                        if (configureSections(this.handle, this.forcePointer,
                            settings.maxSolverIterationsPerFrame, bonds.length, sectionInput, sectionInput + matrixBytes,
                            sectionInput + sampleOffset, sections.samples.length) !== 0)
                            throw new Error('Native elastic interface setup failed');
                    } finally { module._free(sectionInput); }
                    this.sectionResultsPointer = module._malloc(sections.samples.length * 8);
                    if (!this.sectionResultsPointer) throw new Error('Blast interface result allocation failed');
                } else {
                    const configure = settings.physicalLoads ? module._pr_blast_stress_configure_physical : module._pr_blast_stress_configure;
                    if (configure(this.handle, this.forcePointer, limitsPointer, settings.maxSolverIterationsPerFrame) !== 0)
                        throw new Error('Native NVIDIA ExtStress setup failed');
                }
                if (settings.physicalLoads) {
                    this._physicalTolerance = module._pr_blast_stress_physical_tolerance(this.handle);
                    if (!Number.isFinite(this._physicalTolerance) || this._physicalTolerance <= 0 || this._physicalTolerance >= 1)
                        throw new Error('Invalid native physical stress tolerance');
                    // The original physical ABI predates continuation. A new
                    // numerical history must never replay as that old solver.
                    this._physicalRevision = module._pr_blast_stress_physical_revision === undefined ? 1
                        : module._pr_blast_stress_physical_revision(this.handle);
                    if (this._physicalRevision !== (sectionRevision ?? 1))
                        throw new Error('Unsupported native physical stress numerical revision');
                }
            }
        } catch (error) { this.dispose(); throw error; }
        finally { module._free(input); }
    }

    groups() {
        if (!this.handle) throw new Error('Blast family is disposed');
        const count = this.module._pr_blast_family_groups(this.handle, this.groupsPointer, this.count);
        if (count < 1) throw new Error('Native Blast group query failed');
        // Never retain a heap view across WASM calls or heap growth.
        const groups = Array.from(this.module.HEAPU32.subarray(this.groupsPointer / 4, this.groupsPointer / 4 + this.count));
        if (groups.includes(0xffffffff) || new Set(groups).size !== count) throw new Error('Incomplete native Blast chunk ownership');
        return groups;
    }

    damage(bond, amount) {
        return this.damageMany([[bond, amount]]);
    }

    /** Apply ordered native commands and copy the final ownership graph once.
     * All input is validated before mutation. A native failure can commit a
     * prefix; that exact successful prefix remains in the replay journal.
     */
    damageMany(commands) {
        if (!this.handle) throw new Error('Blast family is disposed');
        if (this._stressFailure) throw this._stressFailure;
        if (!Array.isArray(commands)) throw new RangeError('Blast damage commands must be an array');
        for (const command of commands) {
            if (!Array.isArray(command) || command.length !== 2) throw new RangeError('Invalid Blast damage command');
            const [bond, amount] = command;
            if (!Number.isInteger(bond) || bond < 0 || bond >= this.bondCount || !Number.isFinite(amount)
                || !Number.isFinite(Math.fround(amount)) || amount < 0) throw new RangeError('Invalid Blast damage');
        }
        for (const [bond, amount] of commands) {
            if (this.module._pr_blast_family_damage(this.handle, bond, amount) < 1) throw new Error('Native Blast damage failed');
            // Summing damage changes native float rounding. Commit each command
            // before another mutation or a fallible ownership readback.
            this._damageHistory.push([bond, amount]);
            if (this._graph.bondAreasM2) this._operations.push(['damage', bond, amount]);
        }
        return this.groups();
    }

    remainingAreasM2() {
        if (!this.handle || !this._graph.bondAreasM2) throw new Error('Physical Blast family is required');
        if (this.module._pr_blast_family_bond_healths(this.handle, this.healthPointer, this.bondCount) !== this.bondCount)
            throw new Error('Native Blast bond area query failed');
        return Array.from(this.module.HEAPF32.subarray(this.healthPointer / 4, this.healthPointer / 4 + this.bondCount));
    }

    get chunkMassesKg() { return this._chunkMassesKg ? [...this._chunkMassesKg] : null; }

    /** Update live ExtStress node masses without changing health, supports or
     * its frame count. The ordered mass command is part of exact native replay. */
    setChunkMasses(values) {
        if (!this.handle || !this._graph.stress) throw new Error('Native Blast stress is not configured');
        if (this._stressFailure) throw this._stressFailure;
        const masses = validateChunkMasses(values, this.count);
        if (masses.every((mass, index) => mass === this._chunkMassesKg[index])) return false;
        if (this.module._pr_blast_stress_mass_abi?.() !== 1 || typeof this.module._pr_blast_stress_set_masses !== 'function')
            throw new Error('Live Blast mass updates require native stress mass ABI 1');
        const anchored = new Set(this._graph.stress.anchoredChunks);
        this.module.HEAPF32.set(masses.map((mass, index) => anchored.has(index) ? 0 : mass), this.forcePointer / 4);
        if (this.module._pr_blast_stress_set_masses(this.handle, this.forcePointer, this.count) !== 0)
            throw new Error('Native Blast stress mass update rejected');
        this._operations.push(['masses', masses]);
        this._chunkMassesKg = masses; this._massUpdates = true;
        return true;
    }

    stressState() {
        if (!this.handle || !this._graph.stress) throw new Error('Native Blast stress is not configured');
        if (this._stressFailure) throw this._stressFailure;
        if (this.module._pr_blast_stress_state(this.handle, this.stressPointer, 6) !== 0) throw new Error('Native Blast stress receipt failed');
        const values = Array.from(this.module.HEAPF64.subarray(this.stressPointer / 8, this.stressPointer / 8 + 6));
        if (!values.every(Number.isFinite)) throw new Error('Nonfinite native Blast stress receipt');
        const physicalLoads = this._graph.stress.settings.physicalLoads === true;
        let sectionDamageFractions = null;
        if (this._graph.stress.sections && values[4] === 1 && values[0] > 0) {
            const count = this._graph.stress.sections.samples.length;
            if (this.module._pr_blast_stress_section_results(this.handle, this.sectionResultsPointer, count) !== count)
                throw new Error('Native interface traction results are unavailable');
            sectionDamageFractions = Array.from(this.module.HEAPF64.subarray(this.sectionResultsPointer / 8, this.sectionResultsPointer / 8 + count));
            if (!sectionDamageFractions.every(value => Number.isFinite(value) && value >= 0))
                throw new Error('Invalid native interface damage fractions');
        }
        return { backend: 'cpu-wasm', solver: this._physicalRevision === 3
                ? 'Particle Realms elastic interface solver' : 'NVIDIA ExtStress scalar', frame: values[0], overstressed: values[1],
            ...(physicalLoads ? { numericalRevision: this._physicalRevision, relativeSolverTolerance: this._physicalTolerance,
                residualUnits: 'mass/length-normalized normal-equation residual' } : {}),
            ...(this._sectionPreparationIdentity !== undefined ? { preparationIdentity: this._sectionPreparationIdentity } : {}),
            ...(this._graph.stress.sections ? { sectionsAbi: 1, sectionDamageFractions } : {}),
            errorLinear: values[2], errorAngular: values[3], converged: values[4] === 1, solverBonds: values[5],
            damageCadence: this._graph.stress.sections ? 'caller-owned interface traction fracture'
                : physicalLoads ? 'per converged native update' : 'per native update',
            loadDiscretization: physicalLoads ? 'actual masses, volume-derived isotropic inertia, authored bond offsets'
                : 'equalized masses and midpoint bond offsets',
            healthUnits: 'm2', stressUnits: 'Pa',
            remainingAreasM2: this.remainingAreasM2(), groups: this.groups() };
    }

    /** New forces in N per chunk, authored local axes. Loads clear each update.
     * Native partial damage is per admitted solver update, not a dt-scaled
     * fatigue law. Physical mode retains its warm start while an unconverged
     * update leaves interface health and actor ownership unchanged.
     */
    updateStress(forcesNByChunk) {
        if (!this.handle || !this._graph.stress) throw new Error('Native Blast stress is not configured');
        if (this._stressFailure) throw this._stressFailure;
        if (!forceArray(forcesNByChunk, this.count)) throw new RangeError('Stress forces must be finite float3 newtons for every chunk');
        const forces = new Float32Array(forcesNByChunk);
        this.module.HEAPF32.set(forces, this.forcePointer / 4);
        const update = this._graph.stress.settings.physicalLoads ? this.module._pr_blast_stress_update_physical
            : this.module._pr_blast_stress_update;
        const result = update(this.handle, this.forcePointer, this.count);
        if (this._graph.stress.settings.physicalLoads && result < -1) {
            this._stressFailure = new Error('Native physical stress numerical failure; dispose and recreate the family');
            throw this._stressFailure;
        }
        if (!Number.isInteger(result) || result < 0 || result > this.count
            || (!this._graph.stress.settings.physicalLoads && result < 1)) throw new Error('Native Blast stress update failed');
        // Commit before any fallible readback: replay must retain solver warm-start.
        this._operations.push(['stress', Array.from(forces)]);
        const state = this.stressState();
        if (this._graph.stress.settings.physicalLoads && state.converged !== (result > 0))
            throw new Error('Native physical stress admission disagrees with its convergence receipt');
        return state;
    }

    /** Engine replay snapshot, not an NVIDIA ExtSerialization binary.
     * Only damage through this wrapper is recorded. History and replay cost grow
     * with successful commands; no float-sensitive health history is compacted.
     */
    snapshot() {
        const variableMass = this._massUpdates || this._graph.stress?.chunkMassesKg !== undefined;
        const physicalLoads = this._graph.stress?.settings.physicalLoads === true;
        if (this._graph.bondAreasM2) return { format: 'particle-realms/blast-family', version: physicalLoads ? this._physicalRevision === 3 ? 7 : this._physicalRevision === 2 ? 6 : 5 : variableMass ? 4 : this._graph.bondCentroids ? 3 : 2,
            ...(physicalLoads ? { physicalStressAbi: 1, physicalStressTolerance: this._physicalTolerance } : {}),
            ...(physicalLoads && [2, 3].includes(this._physicalRevision) ? { physicalStressRevision: this._physicalRevision } : {}),
            ...(this._sectionPreparationIdentity !== undefined ? { physicalStressPreparationIdentity: this._sectionPreparationIdentity } : {}),
            ...(this._graph.bondCentroids ? { authoringAbi: 1 } : {}), sceneAbi: 1, stressAbi: 1,
            ...(variableMass || physicalLoads ? { massAbi: 1, chunkMassesKg: this.chunkMassesKg } : {}),
            blastVersion: this.module._pr_blast_version(), graph: structuredClone(this._graph),
            operations: structuredClone(this._operations), remainingAreasM2: this.remainingAreasM2(),
            stressState: this._graph.stress ? this.stressState() : null, groups: this.groups() };
        return { format: 'particle-realms/blast-family', version: 1, sceneAbi: 1,
            blastVersion: this.module._pr_blast_version(), graph: structuredClone(this._graph),
            damage: this._damageHistory.map(command => [...command]), groups: this.groups() };
    }

    static restore(module, snapshot) {
        const physicalLoads = [5, 6, 7].includes(snapshot?.version), variableMass = [4, 5, 6, 7].includes(snapshot?.version);
        const physical = [2, 3, 4, 5, 6, 7].includes(snapshot?.version), authored = snapshot?.version === 3 || (variableMass && snapshot.authoringAbi === 1);
        const sectionRevision = snapshot?.version === 7 ? 3 : snapshot?.version === 6 ? 2 : null;
        if (snapshot?.format !== 'particle-realms/blast-family' || ![1, 2, 3, 4, 5, 6, 7].includes(snapshot.version)
            || snapshot.sceneAbi !== 1 || module?._pr_blast_scene_abi?.() !== 1
            || snapshot.blastVersion !== module._pr_blast_version?.()
            || !snapshot.graph || (!physical && !Array.isArray(snapshot.damage)) || !Array.isArray(snapshot.groups)
            || snapshot.groups.length !== snapshot.graph.chunks?.length
            || snapshot.groups.some(group => !Number.isInteger(group) || group < 0 || group >= snapshot.groups.length)) {
            throw new RangeError('Invalid or incompatible Blast family snapshot');
        }
        if (physicalLoads && (snapshot.physicalStressAbi !== 1 || snapshot.graph.stress?.settings.physicalLoads !== true
            || !Number.isFinite(snapshot.physicalStressTolerance) || snapshot.physicalStressTolerance <= 0 || snapshot.physicalStressTolerance >= 1
            || (sectionRevision !== null ? snapshot.physicalStressRevision !== sectionRevision : snapshot.physicalStressRevision !== undefined)
            || (sectionRevision !== null ? snapshot.graph.stress.sections === undefined : snapshot.graph.stress.sections !== undefined)
            || (sectionRevision === 3 ? snapshot.graph.stress.settings.sectionSolverRevision !== 3
                : snapshot.graph.stress.settings.sectionSolverRevision !== undefined && snapshot.graph.stress.settings.sectionSolverRevision !== sectionRevision)
            || module._pr_blast_stress_physical_abi?.() !== 1)) throw new RangeError('Invalid or incompatible physical stress snapshot');
        if (sectionRevision === 3 && (module._pr_blast_stress_sections_v3_abi?.() !== 1
            || typeof module._pr_blast_stress_configure_sections_v3 !== 'function'))
            throw new RangeError('Version 7 requires native Blast section solver revision 3');
        // Equal revision numbers do not make different physical preparations
        // interchangeable. Reject before allocating a family or replaying loads.
        const preparationIdentity = sectionRevision === 3 ? sectionV3PreparationIdentity(module) : undefined;
        if (snapshot.physicalStressPreparationIdentity !== preparationIdentity
            || snapshot.stressState?.preparationIdentity !== preparationIdentity)
            throw new RangeError('Blast snapshot physical stress preparation differs from the native solver');
        if (!physicalLoads && (snapshot.physicalStressAbi !== undefined || snapshot.physicalStressTolerance !== undefined
            || snapshot.physicalStressRevision !== undefined
            || snapshot.graph.stress?.settings.physicalLoads === true))
            throw new RangeError('Physical load snapshots require version 5, 6 or 7');
        if (variableMass && (snapshot.massAbi !== 1 || !snapshot.graph.stress)) throw new RangeError('Invalid Blast mass snapshot');
        if (!variableMass && (snapshot.graph.stress?.chunkMassesKg !== undefined || snapshot.chunkMassesKg !== undefined || snapshot.massAbi !== undefined))
            throw new RangeError('Explicit Blast masses require snapshot version 4');
        if (variableMass) validateChunkMasses(snapshot.chunkMassesKg, snapshot.graph.chunks.length);
        if (authored && (snapshot.authoringAbi !== 1 || module._pr_blast_authoring_abi?.() !== 1
            || !Array.isArray(snapshot.graph.bondCentroids) || !Array.isArray(snapshot.graph.bondNormals)))
            throw new RangeError('Invalid authored Blast snapshot');
        if (!authored && (snapshot.graph.bondCentroids != null || snapshot.graph.bondNormals != null))
            throw new RangeError('Authored bond geometry requires Blast snapshot version 3');
        const bondCount = snapshot.graph.bonds?.length;
        if (physical && (snapshot.stressAbi !== 1 || module._pr_blast_stress_abi?.() !== 1
            || !Array.isArray(snapshot.graph.bondAreasM2) || !Array.isArray(snapshot.operations)
            || !Array.isArray(snapshot.remainingAreasM2) || snapshot.remainingAreasM2.length !== bondCount
            || snapshot.remainingAreasM2.some(area => !finiteF32(area) || area < 0))) throw new RangeError('Invalid physical Blast snapshot');
        if (physical && snapshot.graph.stress && (!snapshot.stressState
            || !Number.isSafeInteger(snapshot.stressState.frame) || snapshot.stressState.frame < 0
            || typeof snapshot.stressState.converged !== 'boolean'
            || !['overstressed', 'solverBonds'].every(key => Number.isSafeInteger(snapshot.stressState[key]) && snapshot.stressState[key] >= 0)
            || !['errorLinear', 'errorAngular'].every(key => Number.isFinite(snapshot.stressState[key]) && snapshot.stressState[key] >= 0)))
            throw new RangeError('Invalid Blast stress snapshot receipt');
        if (physicalLoads && (snapshot.stressState.relativeSolverTolerance !== snapshot.physicalStressTolerance
            || (sectionRevision !== null ? snapshot.stressState.numericalRevision !== sectionRevision
                : snapshot.stressState.numericalRevision !== undefined && snapshot.stressState.numericalRevision !== 1)))
            throw new RangeError('Invalid physical stress snapshot numerical identity');
        if (sectionRevision !== null && (snapshot.stressState.sectionsAbi !== 1
            || (snapshot.stressState.sectionDamageFractions !== null
                && (!Array.isArray(snapshot.stressState.sectionDamageFractions)
                    || snapshot.stressState.sectionDamageFractions.length !== snapshot.graph.stress.sections.samples?.length
                    || snapshot.stressState.sectionDamageFractions.some(value => !Number.isFinite(value) || value < 0)))))
            throw new RangeError('Invalid interface traction snapshot receipt');
        if (!physical && (snapshot.graph.bondAreasM2 != null || snapshot.graph.stress != null)) throw new RangeError('Legacy snapshot cannot carry physical stress');
        const operations = physical ? snapshot.operations : snapshot.damage.map(command => ['damage', ...command]);
        const damage = [];
        for (const operation of operations) {
            if (!Array.isArray(operation)) throw new RangeError('Invalid Blast operation history');
            if (operation[0] === 'stress') {
                if (!snapshot.graph.stress || operation.length !== 2 || !Array.isArray(operation[1])
                    || !forceArray(operation[1], snapshot.graph.chunks.length)) throw new RangeError('Invalid Blast stress history');
            } else if (operation[0] === 'masses' && variableMass && operation.length === 2) {
                validateChunkMasses(operation[1], snapshot.graph.chunks.length);
            } else if (operation[0] === 'damage' && operation.length === 3) damage.push(operation.slice(1));
            else throw new RangeError('Invalid Blast operation history');
        }
        for (const command of damage) {
            if (!Array.isArray(command) || command.length !== 2 || !Number.isInteger(command[0])
                || command[0] < 0 || command[0] >= bondCount || !Number.isFinite(command[1])
                || !Number.isFinite(Math.fround(command[1])) || command[1] < 0) throw new RangeError('Invalid Blast damage history');
        }
        const family = new this(module, snapshot.graph);
        try {
            if (physicalLoads && family._physicalRevision !== (sectionRevision ?? 1))
                throw new Error('Blast snapshot physical stress numerical revision differs from the native solver');
            if (physicalLoads && family._physicalTolerance !== snapshot.physicalStressTolerance)
                throw new Error('Blast snapshot physical stress tolerance differs from the native solver');
            for (const operation of operations) {
                if (operation[0] === 'damage') family.damage(operation[1], operation[2]);
                else if (operation[0] === 'masses') family.setChunkMasses(operation[1]);
                else family.updateStress(operation[1]);
            }
            if (variableMass && family._chunkMassesKg.some((mass, index) => mass !== snapshot.chunkMassesKg[index]))
                throw new Error('Blast snapshot masses differ from native replay');
            if (physical) {
                const areas = family.remainingAreasM2();
                if (areas.some((area, index) => area !== snapshot.remainingAreasM2[index])) throw new Error('Blast snapshot areas differ from native replay');
                if (snapshot.graph.stress) {
                    const state = family.stressState(), saved = snapshot.stressState;
                    if (!saved || ['frame', 'overstressed', 'errorLinear', 'errorAngular', 'converged', 'solverBonds'].some(key => saved[key] !== state[key]))
                        throw new Error('Blast stress state differs from native replay');
                    if (family._graph.stress.sections && (saved.sectionsAbi !== 1
                        || JSON.stringify(saved.sectionDamageFractions) !== JSON.stringify(state.sectionDamageFractions)))
                        throw new Error('Blast interface traction results differ from native replay');
                } else if (snapshot.stressState !== null) throw new RangeError('Unexpected Blast stress snapshot state');
            }
            const actual = family.groups(), forward = new Map(), reverse = new Map();
            for (let i = 0; i < actual.length; i++) {
                const expected = snapshot.groups[i], observed = actual[i];
                if ((forward.has(expected) && forward.get(expected) !== observed)
                    || (reverse.has(observed) && reverse.get(observed) !== expected)) throw new Error('Blast snapshot partitions differ from native replay');
                forward.set(expected, observed); reverse.set(observed, expected);
            }
            return family;
        } catch (error) { family.dispose(); throw error; }
    }

    dispose() {
        if (this.handle) this.module._pr_blast_family_destroy(this.handle);
        if (this.groupsPointer) this.module._free(this.groupsPointer);
        for (const pointer of [this.healthPointer, this.forcePointer, this.stressPointer, this.sectionResultsPointer]) if (pointer) this.module._free(pointer);
        this.handle = this.groupsPointer = this.healthPointer = this.forcePointer = this.stressPointer = this.sectionResultsPointer = 0;
    }
}
