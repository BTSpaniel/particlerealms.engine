// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { WoodCombustion, PINE_FIRE_MATERIAL as PINE, WOOD_FIRE_CLOSURE as C } from '../combustion/WoodCombustion.js';
import { STEFAN_BOLTZMANN } from '../../core/math/MathConstants.js';
import { createSurfaceFieldTopology, SURFACE_NO_NEIGHBOR } from './SurfaceFieldTopology.js';
import { SurfaceFieldChemicalInventory, SURFACE_OIL_PROFILE, SURFACE_ACID_PROFILE } from './SurfaceFieldChemistry.js';
import { createSurfaceFieldMotion } from './SurfaceFieldMotion.js';
import { SurfaceFieldSupports } from './SurfaceFieldSupports.js';

export const SURFACE_BRUSH_RATES = Object.freeze({ waterMPerSecond: .0008, oilMPerSecond: .004, acidMPerSecond: .006, pineKgM2PerSecond: .25, heatJPerM2Second: 800000 });
const checked = (value, name, min = 0, max = 1e30) => {
    if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`${name} must be finite in [${min}, ${max}]`);
    return value;
};
const support = (topology, i, { tiltX = 0, tiltZ = 0 }) => {
    const m = i * 8, domain = topology.domains[topology.meta[m + 4]];
    return topology.meta[m + 1] + (domain.receiveRunoff || domain.material === 'calcite' ? 0 : tiltX * (topology.meta[m] - domain.center[0]) + tiltZ * (topology.meta[m + 2] - domain.center[2]));
};

/** Depths for picking the same retained solid drawn by the renderer. Pine
 * compacts the actual virgin/char/ash mass at its original dry bulk density;
 * this is a geometric closure, not an additional combustion or erosion law.
 * Calcite's optional display scale does not modify either physical inventory. */
export function surfaceFieldSolidDepths(topology, auxiliary, index, { calciteDepthScale = 1 } = {}) {
    if (!Number.isInteger(index) || index < 0 || index >= topology.count || !(auxiliary instanceof Float32Array) || auxiliary.length !== topology.count * 8) throw new RangeError('Invalid retained solid geometry');
    checked(calciteDepthScale, 'Calcite display depth scale', 1, 1000);
    const m = index * 8, kind = topology.domains[topology.meta[m + 4]].material;
    const initialDepthM = topology.meta[m + 7] * (kind === 'calcite' ? calciteDepthScale : 1);
    const removedDepthM = kind === 'wood' && auxiliary[m + 7] > 0
        ? Math.max(0, Math.min(initialDepthM, auxiliary[m + 7] - auxiliary[m + 6]))
        : Math.min(initialDepthM, auxiliary[m + 2] * (kind === 'calcite' ? calciteDepthScale : 1));
    return { initialDepthM, removedDepthM, remainingDepthM: Math.max(0, initialDepthM - removedDepthM) };
}

/** Bounded finite-volume water reference shared by the WebGPU parity tests.
 * Every directed flux is a volume in m³; incoming edges encode source*4+k. */
export function transportSurfaceWater(topology, fields, dt, { flow = 1, tiltX = 0, tiltZ = 0, headOffsets = null, motion = null } = {}, output = null) {
    checked(dt, 'Surface timestep', Number.MIN_VALUE, 1); checked(flow, 'Surface flow', 0, 100);
    checked(tiltX, 'Surface X slope', -10, 10); checked(tiltZ, 'Surface Z slope', -10, 10);
    if (!(fields instanceof Float32Array) || fields.length !== topology.count * 8) throw new RangeError('Surface fields do not match topology');
    if (headOffsets !== null && (!(headOffsets instanceof Float32Array) || headOffsets.length !== topology.count || headOffsets.some(value => !Number.isFinite(value)))) throw new RangeError('Surface pressure head does not match topology');
    if (output && (!(output instanceof Float32Array) || output.length !== fields.length || output === fields)) throw new RangeError('Surface transport output must be a separate field array');
    const next = output ?? new Float32Array(fields.length), flux = new Float32Array(topology.count * 4);
    if (motion) motion = createSurfaceFieldMotion(topology, motion);
    const neighbors = motion?.neighbors ?? topology.neighbors;
    const base = i => motion ? motion.heights[i] : support(topology, i, { tiltX, tiltZ });
    const headAt = i => motion ? base(i) + ((headOffsets?.[i] ?? 0) + fields[i * 8]) * motion.normalUp[i]
        : base(i) + (headOffsets?.[i] ?? 0) + fields[i * 8];
    next.set(fields);
    for (let i = 0; i < topology.count; i++) {
        const water = checked(fields[i * 8], 'Water depth'), head = headAt(i); let total = 0;
        for (let k = 0; k < 4; k++) {
            const j = neighbors[i * 4 + k];
            const downstream = j === SURFACE_NO_NEIGHBOR ? (motion && motion.normalUp[i] < 0 ? head : base(i)) - .2 : headAt(j);
            const volume = Math.max(head - downstream, 0) * .025 * dt * flow;
            flux[i * 4 + k] = volume; total += volume;
        }
        const scale = Math.min(1, water * topology.meta[i * 8 + 3] / Math.max(total, 1e-12));
        for (let k = 0; k < 4; k++) flux[i * 4 + k] *= scale;
    }
    let outflowM3 = 0;
    for (let i = 0; i < topology.count; i++) {
        let enter = 0, leave = 0;
        for (let k = 0; k < 4; k++) { const q = flux[i * 4 + k]; leave += q; if (neighbors[i * 4 + k] === SURFACE_NO_NEIGHBOR) outflowM3 += q; }
        const start = topology.offsets[i * 2], length = topology.offsets[i * 2 + 1];
        for (let k = 0; k < length; k++) { const edge = topology.incoming[start + k]; if (neighbors[edge] === i) enter += flux[edge]; }
        next[i * 8] = Math.max(0, fields[i * 8] + (enter - leave) / topology.meta[i * 8 + 3]);
    }
    return { fields: next, flux, outflowM3 };
}

/** Retained surface state. Pine reactions and moisture live solely in the
 * existing WoodCombustion owner. This adapter never burns normalized fuel. */
export class SurfaceFieldWorld {
    constructor({ topology = createSurfaceFieldTopology(), materials, logger = null, runoff = false, supports = false } = {}) {
        if (!Array.isArray(materials) || materials.length < 3 || topology.domains.some((domain, index) => materials[topology.meta[topology.address(index, 0, 0) * 8 + 6]]?.kind !== domain.material)) throw new TypeError('Load engine surface materials in their topology order before creating the world');
        this.topology = topology; this.materials = materials; this.logger = typeof logger === 'function' ? logger : () => {};
        this.fields = new Float32Array(topology.count * 8); this.emissions = new Float32Array(topology.count * 2); this.flowSources = new Float32Array(topology.count * 4); this._solidEnergyJ = new Float64Array(topology.count);
        // Exact native load projection: initial dry solid, retained solid
        // (including absorbed moisture), surviving strength, carried liquid.
        // This is a read-only projection; material owners retain all mass.
        this.structuralState = new Float64Array(topology.count * 4);
        this.waterHeadOffsets = new Float32Array(topology.count); this._oilFields = new Float32Array(topology.count * 8); this._oilHeadOffsets = new Float32Array(topology.count);
        this._phaseGeometry = { waterKg: 0, oilKg: 0, aqueousVolumeM3: 0 };
        this._coatings = new Map(); this._disposed = false; this.timeSeconds = 0; this.steps = 0;
        this.options = { rain: 0, rainDomain: null, tiltX: 0, tiltZ: 0, flow: 1, ambientTemperatureK: C.referenceTemperatureK };
        this.ledger = { waterAddedKg: 0, waterWipedKg: 0, waterOutflowKg: 0, waterEvaporatedKg: 0,
            initialWaterKg: 0, coatingAddedKg: 0, brushHeatJ: 0, chemicalBrushHeatJ: 0, unmodelledHeatJ: 0, waterCoolingJ: 0, chemicalWaterCoolingJ: 0, legacySolidCoolingJ: 0, bareBoundaryHeatJ: 0 };
        const cells = [], connections = [];
        for (let i = 0; i < topology.count; i++) {
            const m = i * 8, domain = topology.domains[topology.meta[m + 4]], material = materials[topology.meta[m + 6]];
            this.fields[m + 2] = C.referenceTemperatureK;
            if (domain.material === 'wood') {
                cells.push({ id: i, dimensionsM: [domain.size[0] / topology.n, domain.substrateDepthM, domain.size[1] / topology.n], thermalAxis: 1 });
                for (const [k, faceA, faceB, width] of [[1, 1, 0, domain.size[1] / topology.n], [3, 5, 4, domain.size[0] / topology.n]]) {
                    const j = topology.neighbors[i * 4 + k];
                    if (j !== SURFACE_NO_NEIGHBOR && j !== i && topology.meta[j * 8 + 4] === topology.meta[m + 4]) connections.push({ a: i, b: j, faceA, faceB, areaM2: width * domain.substrateDepthM });
                }
            }
        }
        this._wood = cells.length ? new WoodCombustion({ cells, connections }) : null;
        this._woodRestConnections = connections; this.motion = null;
        if (typeof supports !== 'boolean') throw new TypeError('Surface supports mode must be boolean');
        this.supportsEnabled = supports; this.supportModel = null;
        this.chemicals = new SurfaceFieldChemicalInventory(topology, { runoff, supportChemistry: supports }); this.auxiliary = this.chemicals.auxiliary; this.liquidProperties = this.chemicals.liquidProperties;
        this.ledger.initialWaterKg = this._wood?.totals().initialSolidMassKg - cells.reduce((sum, cell) => sum + this._wood.cell(cell.id).initialDryMassKg, 0) || 0;
        this._syncFields(); this.logger('Surface fields initialized', { cells: topology.count, materialIds: materials.map(m => m.id), missingProperties: materials.map(m => ({ id: m.id, fields: m.missingProperties })) });
    }
    _assertLive() { if (this._disposed) throw new Error('Surface world is disposed'); }
    configureSupports(definitions) {
        this._assertLive();
        if (!this.supportsEnabled || this.supportModel || this._asyncStepPending || this.steps) throw new Error('Configure enabled supports once before stepping');
        this.supportModel = new SurfaceFieldSupports({ supports: definitions, segments: 6 });
        this.logger('Finite support materials initialized', { supports: definitions.length, segments: 6,
            woodIntegrationMode: this.supportModel.wood?.integrationMode ?? null });
        return this.supportFrame;
    }
    get supportFrame() { return this.supportModel?.frame() ?? []; }
    get supportLoads() { return this.supportModel?.loads() ?? []; }
    applySupportBrush({ id, segment = 0, tool, massKg = 0, temperatureK = 293.15 } = {}) {
        this._assertLive();
        if (!this.supportModel || this._asyncStepPending) throw new Error('Support painting requires an idle configured owner');
        if (tool === 'ignite') this.supportModel.ignite(id, segment);
        else this.supportModel.dose(id, segment, { tool, massKg, temperatureK });
        this.logger('Support material dose applied', { id, segment, tool, massKg });
        return this.supportFrame;
    }
    applySupportBrushes(commands) {
        this._assertLive();
        if (!this.supportModel || this._asyncStepPending) throw new Error('Support painting requires an idle configured owner');
        const frame = this.supportModel.applyBrushes(commands);
        this.logger('Support material batch applied', { retainedSegments: frame.length });
        return frame;
    }
    get runoff() { this._assertLive(); return this.chemicals.runoffFrame(); }
    _owner(i) { return this._coatings.get(i) ?? (this.topology.domains[this.topology.meta[i * 8 + 4]].material === 'wood' ? this._wood : null); }
    _capacity(i) {
        const m = i * 8, domain = this.topology.domains[this.topology.meta[m + 4]], material = this.materials[this.topology.meta[m + 6]];
        return material.thermalAvailable ? this.topology.meta[m + 3] * domain.substrateDepthM * material.densityKgPerM3 * material.specificHeatJPerKgK : 0;
    }
    _heat(i, energyJ, includeOil = true) {
        if (includeOil && this.chemicals.cell(i).oilKg > 0) return this.chemicals.heat(i, energyJ);
        if (includeOil && this.chemicals.cell(i).aqueousMassKg > 0) return this.chemicals.exchangeAqueousHeat(i, energyJ);
        const owner = this._owner(i);
        if (owner) return owner.applySurfaceTransfer(i, { energyJ }).energyJ;
        const capacity = this._capacity(i);
        if (!capacity) { this.ledger.unmodelledHeatJ += energyJ; return 0; }
        const actual = Math.min(capacity * (5000 - C.referenceTemperatureK) - this._solidEnergyJ[i], Math.max(energyJ, capacity * (1 - C.referenceTemperatureK) - this._solidEnergyJ[i]));
        this._solidEnergyJ[i] += actual; return actual;
    }
    _deposit(i, dryMassKg) {
        if (!(dryMassKg > 0)) return;
        let model = this._coatings.get(i);
        if (model) model.depositPine(i, { dryMassKg, moistureDryBasis: 0 });
        else {
            const m = i * 8, domain = this.topology.domains[this.topology.meta[m + 4]], area = this.topology.meta[m + 3];
            const depth = dryMassKg / (PINE.dryDensityKgM3 * area);
            if (depth < 1e-12) return;
            model = new WoodCombustion({ allowThinCells: true, cells: [{ id: i, dimensionsM: [domain.size[0] / this.topology.n, depth, domain.size[1] / this.topology.n], thermalAxis: 1, moistureDryBasis: 0 }] });
            this._coatings.set(i, model);
        }
        this.ledger.coatingAddedKg += dryMassKg;
    }
    applyBrush({ domain = 0, x = 0, z = 0, from = null, radius = .3, tool = 'water', strength = 1, duration = .1 } = {}) {
        this._assertLive(); checked(x, 'Brush X', -1e4, 1e4); checked(z, 'Brush Z', -1e4, 1e4);
        if (this._asyncStepPending) throw new Error('Await the preceding asynchronous surface step before painting');
        checked(radius, 'Brush radius', .001, 100); checked(strength, 'Brush strength', 0, 100); checked(duration, 'Brush duration', 0, 60);
        const d = typeof domain === 'string' ? this.topology.domains.findIndex(item => item.id === domain) : domain;
        if (!Number.isInteger(d) || d < 0 || d >= this.topology.domains.length || !['water', 'fire', 'fuel', 'heat', 'wipe', 'oil', 'acid', 'ignite'].includes(tool)) throw new RangeError('Invalid surface brush');
        if (from !== null && (!Array.isArray(from) || from.length !== 2 || !from.every(Number.isFinite))) throw new RangeError('Brush stroke origin must contain X,Z');
        const origin = from ?? [x, z], vx = x - origin[0], vz = z - origin[1], lengthSq = vx * vx + vz * vz;
        let affected = 0;
        for (let i = 0; i < this.topology.count; i++) {
            const m = i * 8; if (this.topology.meta[m + 4] !== d) continue;
            const u = lengthSq > 0 ? Math.max(0, Math.min(1, ((this.topology.meta[m] - origin[0]) * vx + (this.topology.meta[m + 2] - origin[1]) * vz) / lengthSq)) : 0;
            const weight = Math.max(0, 1 - Math.hypot(this.topology.meta[m] - origin[0] - u * vx, this.topology.meta[m + 2] - origin[1] - u * vz) / radius) ** 1.4 * strength * duration;
            if (!weight) continue; affected++;
            const area = this.topology.meta[m + 3];
            if (tool === 'water') { const mass = weight * SURFACE_BRUSH_RATES.waterMPerSecond * area * 1000; this.chemicals.addWater(i, mass, this.options.ambientTemperatureK); this.ledger.waterAddedKg += mass; }
            if (tool === 'oil') this.chemicals.addOil(i, weight * SURFACE_BRUSH_RATES.oilMPerSecond * area * SURFACE_OIL_PROFILE.densityKgM3);
            if (tool === 'acid') this.chemicals.addAcid(i, weight * SURFACE_BRUSH_RATES.acidMPerSecond * area * SURFACE_ACID_PROFILE.solutionDensityKgM3);
            const hasOil = (tool === 'heat' || tool === 'fire' || tool === 'ignite') && this.chemicals.phaseGeometry(i, this._phaseGeometry).oilKg > 0;
            if (tool === 'fuel' || tool === 'fire' && !hasOil) this._deposit(i, weight * SURFACE_BRUSH_RATES.pineKgM2PerSecond * area);
            if (tool === 'heat' || tool === 'fire' || tool === 'ignite') {
                const actual = tool === 'ignite' && hasOil ? this.chemicals.ignite(i) : this._heat(i, weight * SURFACE_BRUSH_RATES.heatJPerM2Second * area);
                this.ledger.brushHeatJ += actual; if (hasOil || this.chemicals.cell(i).aqueousMassKg > 0) this.ledger.chemicalBrushHeatJ += actual;
            }
            if (tool === 'wipe') { const fraction = Math.min(1, weight * 12); this.ledger.waterWipedKg += this.chemicals.cell(i).waterKg * fraction; this.fields[m + 4] *= 1 - Math.min(1, weight * 10); this.chemicals.wipe(i, fraction); }
        }
        this._syncFields(); this.logger('Surface brush applied', { tool, domain: d, affected, duration }); return affected;
    }
    _exposure(model, i = null, ambient = C.referenceTemperatureK) {
        const faces = [], indices = i === null ? [...model._cells.keys()] : [i];
        for (const index of indices) for (let face = 0; face < 6; face++) faces.push({ cellId: index, face, exposedAreaM2: face === 3 ? model._cells.get(index).faces[face].area : 0 });
        const exposure = { ambientTemperatureK: ambient, faces };
        if (model === this._wood && this.motion) exposure.connections = this._woodConnections(this.motion);
        return exposure;
    }
    _woodConnections(motion) {
        return this._woodRestConnections.filter(link => {
            for (let k = 0; k < 4; k++) if (this.topology.neighbors[link.a * 4 + k] === link.b) return motion.connectedEdges[link.a * 4 + k] === 1;
            return false;
        });
    }
    _syncFields(woodCells = null) {
        for (let i = 0; i < this.topology.count; i++) {
            const m = i * 8, area = this.topology.meta[m + 3], native = this.topology.domains[this.topology.meta[m + 4]].material === 'wood' ? this._wood.cell(i) : null;
            const coating = this._coatings.get(i)?.cell(i), owner = coating ?? native;
            if (native) woodCells?.native.set(i, native);
            if (coating) woodCells?.coatings.set(i, coating);
            if (native) { this.fields[m + 6] = native.virginKg / area; this.fields[m + 3] = Math.max(this.fields[m + 3], 1 - native.strengthFraction); }
            this.fields[m + 1] = coating ? coating.virginKg / area : 0;
            this.fields[m + 5] = ((coating?.waterKg ?? 0) + (native?.waterKg ?? 0)) / area;
            this.fields[m + 2] = owner ? owner.faces[3].surfaceTemperatureK : C.referenceTemperatureK + (this._capacity(i) ? this._solidEnergyJ[i] / this._capacity(i) : 0);
            const chemical = this.chemicals.cell(i);
            if (this.structuralState) {
                const kind = this.topology.domains[this.topology.meta[m + 4]].material;
                const restMass = native?.initialDryMassKg ?? (kind === 'calcite' ? chemical.initialCarbonateKg
                    : (this.materials[this.topology.meta[m + 6]].densityKgPerM3 ?? 0) * area * this.topology.meta[m + 7]);
                const retainedMass = native?.remainingMassKg ?? (kind === 'calcite' ? chemical.carbonateKg : restMass);
                this.structuralState.set([restMass, retainedMass, native?.strengthFraction ?? (restMass > 0 ? retainedMass / restMass : 0),
                    chemical.aqueousMassKg + chemical.oilKg + (coating?.remainingMassKg ?? 0)], i * 4);
            }
            if (woodCells && chemical.aqueousMassKg > 0) woodCells.maxAqueousTemperatureK = Math.max(woodCells.maxAqueousTemperatureK, chemical.aqueousTemperatureK);
            this.fields[m] = chemical.waterKg / (1000 * area);
            // These two projection channels retain dry ash/char as geometry.
            // Moisture changes mass/heat, but never regrows consumed wood.
            this.auxiliary[m + 6] = native ? this.topology.domains[this.topology.meta[m + 4]].substrateDepthM * (native.virginKg + native.charKg + native.ashKg) / native.initialDryMassKg : 0;
            this.auxiliary[m + 7] = native ? this.topology.domains[this.topology.meta[m + 4]].substrateDepthM : 0;
            if (chemical.oilKg > 0) this.fields[m + 2] = chemical.oilTemperatureK;
            if (chemical.initialCarbonateKg > 0) this.fields[m + 3] = Math.max(this.fields[m + 3], 1 - chemical.carbonateKg / chemical.initialCarbonateKg);
            // This optical residue mask includes retained ash: a thin pine
            // coating may oxidize through char within one native timestep.
            // The mask is appearance history, not a separately reacted mass.
            const retainedResidueKg = (coating?.charKg ?? 0) + (coating?.ashKg ?? 0) + (native?.charKg ?? 0) + (native?.ashKg ?? 0);
            this.fields[m + 4] = Math.max(this.fields[m + 4], Math.min(1, retainedResidueKg / area * 4));
            this.emissions[i * 2] = ((coating?.volatileRateKgPerSecond ?? 0) + (native?.volatileRateKgPerSecond ?? 0)) / area;
            this.emissions[i * 2 + 1] = this.fields[m + 7];
            if (this.flowSources) this.flowSources.set([
                ((coating?.gasHeatW ?? 0) + (coating?.gasSensibleW ?? 0) + (native?.gasHeatW ?? 0) + (native?.gasSensibleW ?? 0)) / area,
                this.chemicals.gasSourceRates[i * 2] / area, this.chemicals.gasSourceRates[i * 2 + 1] / area, this.fields[m + 7],
            ], i * 4);
        }
    }
    /** Hydrology may be precomputed by the shared-device GPU adapter. The
     * adapter supplies the result for exactly this rain-adjusted input step. */
    prepareWater(dt, options = {}) {
        this._assertLive(); checked(dt, 'Surface timestep', Number.MIN_VALUE, .25);
        const p = { ...this.options, ...options };
        checked(p.rain, 'Rain mm/hour', 0, 1e6); checked(p.ambientTemperatureK, 'Ambient temperature', 1, 5000);
        if (p.rain > 0) checked(p.ambientTemperatureK, 'Rain water temperature', 1, 2000);
        checked(p.flow, 'Surface flow', 0, 100); checked(p.tiltX, 'Surface X slope', -10, 10); checked(p.tiltZ, 'Surface Z slope', -10, 10);
        const rainDomain = this._rainDomain(p.rainDomain);
        // The runoff owner returns its detached, fully admitted frame. Both
        // completed-step readers can share it without rebuilding the same
        // topology and transforms twice; caller buffers are never retained.
        this.motion = this.chemicals.runoff.setMotion(Object.hasOwn(options, 'motion') ? options.motion || null : this.motion);
        const source = this.fields.slice();
        for (let i = 0; i < this.topology.count; i++) {
            const m = i * 8, area = this.topology.meta[m + 3], liquid = this.chemicals.phaseGeometry(i, this._phaseGeometry);
            source[m] = liquid.waterKg / (1000 * area);
            if (rainDomain === null || this.topology.meta[m + 4] === rainDomain) source[m] += p.rain / 3600000 * dt * this.topology.meta[m + 5] * this._rainExposure(i);
            // Hydrostatic support from the retained aqueous and lighter oil
            // layers; recession uses physical depth, never the display scale.
            this.waterHeadOffsets[i] = liquid.aqueousVolumeM3 / area - liquid.waterKg / (1000 * area)
                + liquid.oilKg / (1000 * area) - surfaceFieldSolidDepths(this.topology, this.auxiliary, i).removedDepthM;
        }
        return source;
    }
    _rainExposure(i) { return this.motion ? this.motion.poses[i * 8 + 3] * Math.max(0, this.motion.normalUp[i]) : 1; }
    _rainDomain(value) {
        if (value === null || value === undefined) return null;
        const index = typeof value === 'string' ? this.topology.domains.findIndex(domain => domain.id === value) : value;
        if (!Number.isInteger(index) || index < 0 || index >= this.topology.domains.length) throw new RangeError('Invalid rain domain');
        return index;
    }
    step(dt, options = {}) {
        this._assertLive(); checked(dt, 'Surface timestep', Number.MIN_VALUE, .25);
        if (this._asyncStepPending) throw new Error('Await the preceding asynchronous surface step');
        const p = { ...this.options, ...options }, source = this.prepareWater(dt, p);
        const result = options.waterResult ?? transportSurfaceWater(this.topology, source, dt, { ...p, motion: this.motion, headOffsets: this.waterHeadOffsets });
        this._beginStep(dt, p, source, result);
        const oilResult = transportSurfaceWater(this.topology, this._oilFields, dt, { ...p, motion: this.motion, flow: p.flow * .2, headOffsets: this._oilHeadOffsets });
        return this._finishStep(dt, p, oilResult);
    }
    /** Resolve both finite-volume phases through one serial transport owner.
     * The oil support is prepared only after aqueous transport has committed.
     * Reactions and retained material accounting are shared with step(). */
    async stepAsync(dt, options = {}, transport) {
        this._assertLive(); checked(dt, 'Surface timestep', Number.MIN_VALUE, .25);
        if (this._asyncStepPending) throw new Error('Await the preceding asynchronous surface step');
        if (typeof transport !== 'function') throw new TypeError('Surface async step requires a transport callback');
        const p = { ...this.options, ...options }, source = this.prepareWater(dt, p);
        this._asyncStepPending = true;
        try {
            const result = await transport({ phase: 'aqueous', fields: source, headOffsets: this.waterHeadOffsets,
                dt, flow: p.flow, tiltX: p.tiltX, tiltZ: p.tiltZ, motion: this.motion });
            this._assertLive(); this._beginStep(dt, p, source, result);
            const oilResult = await transport({ phase: 'oil', fields: this._oilFields, headOffsets: this._oilHeadOffsets,
                dt, flow: p.flow * .2, tiltX: p.tiltX, tiltZ: p.tiltZ, motion: this.motion });
            this._assertLive(); return this._finishStep(dt, p, oilResult);
        } finally { this._asyncStepPending = false; }
    }
    _validateTransportResult(source, result, phase) {
        if (!(result?.fields instanceof Float32Array) || result.fields.length !== this.fields.length || !Number.isFinite(result.outflowM3) || result.outflowM3 < 0) throw new RangeError(`Invalid external ${phase} step`);
        let sourceVolumeM3 = 0, transportedVolumeM3 = 0;
        for (let i = 0; i < this.topology.count; i++) {
            const area = this.topology.meta[i * 8 + 3]; checked(result.fields[i * 8], `Transported ${phase}`);
            sourceVolumeM3 += source[i * 8] * area; transportedVolumeM3 += result.fields[i * 8] * area;
        }
        // Admit the GPU readback only if it balances this exact prepared input.
        // The small allowance covers independently rounded f32 donor/gather sums.
        const volumeToleranceM3 = Math.max(1e-8, sourceVolumeM3 * 1e-6);
        if (Math.abs(sourceVolumeM3 - transportedVolumeM3 - result.outflowM3) > volumeToleranceM3) throw new RangeError(`External ${phase} step does not conserve prepared source volume`);
        if (!(result.flux instanceof Float32Array) || result.flux.length !== this.topology.count * 4 || result.flux.some(value => !Number.isFinite(value) || value < 0)) throw new RangeError(`External ${phase} step requires bounded directed fluxes`);
        for (let i = 0; i < this.topology.count; i++) {
            const area = this.topology.meta[i * 8 + 3], start = this.topology.offsets[i * 2], length = this.topology.offsets[i * 2 + 1];
            let leave = 0, enter = 0;
            for (let k = 0; k < 4; k++) leave += result.flux[i * 4 + k];
            for (let k = 0; k < length; k++) { const edge = this.topology.incoming[start + k]; if ((this.motion?.neighbors ?? this.topology.neighbors)[edge] === i) enter += result.flux[edge]; }
            const available = source[i * 8] * area, tolerance = Math.max(1e-12, available * 2e-6);
            if (leave > available + tolerance || Math.abs(result.fields[i * 8] * area - available - enter + leave) > Math.max(tolerance, (available + enter) * 2e-6)) throw new RangeError(`External ${phase} flux disagrees with donor or gather result`);
        }
    }
    _beginStep(dt, p, source, result) {
        this._validateTransportResult(source, result, 'water');
        // Admit rain only after validating the complete GPU result. Solvent,
        // dissolved species and their heat subsequently travel together.
        const rainDomain = this._rainDomain(p.rainDomain), rainTransfers = [];
        for (let i = 0; i < this.topology.count; i++) {
            const m = i * 8, area = this.topology.meta[m + 3];
            const rainKg = rainDomain === null || this.topology.meta[m + 4] === rainDomain ? p.rain / 3600000 * dt * this.topology.meta[m + 5] * area * 1000 * this._rainExposure(i) : 0;
            if (rainKg > 0) rainTransfers.push({ index: i, waterKg: rainKg, temperatureK: p.ambientTemperatureK });
            this.fields[m + 7] = 0;
        }
        for (const transfer of this.chemicals.addWaters(rainTransfers)) this.ledger.waterAddedKg += transfer.waterKg;
        this.chemicals.transportPhase('aqueous', result.flux, { tiltX: p.tiltX, tiltZ: p.tiltZ,
            removedDepth: i => surfaceFieldSolidDepths(this.topology, this.auxiliary, i).removedDepthM });
        // Oil stays above the aqueous surface and transports its own mass and
        // sensible heat. Reduced mobility is an authored viscous-film closure.
        for (let i = 0; i < this.topology.count; i++) {
            const area = this.topology.meta[i * 8 + 3], liquid = this.chemicals.phaseGeometry(i, this._phaseGeometry);
            this._oilFields[i * 8] = liquid.oilKg / (SURFACE_OIL_PROFILE.densityKgM3 * area);
            this._oilHeadOffsets[i] = liquid.aqueousVolumeM3 / area - surfaceFieldSolidDepths(this.topology, this.auxiliary, i).removedDepthM;
        }
    }
    _finishStep(dt, p, oilResult) {
        this._validateTransportResult(this._oilFields, oilResult, 'oil');
        this.chemicals.transportPhase('oil', oilResult.flux, { tiltX: p.tiltX, tiltZ: p.tiltZ,
            removedDepth: i => surfaceFieldSolidDepths(this.topology, this.auxiliary, i).removedDepthM });
        let completedSupportStats = null;
        if (this.supportModel) {
            if (!Array.isArray(p.supportGeometry)) throw new TypeError('Suspended materials require completed support geometry');
            // Capillary contact is a declared local exchange closure. Only the
            // lowest segment touches its own corner cell; no remote acid dose.
            const contacts = (p.supportContacts ?? []).map(contact => ({ ...contact, segment: 0,
                aqueousFraction: Math.min(1, dt * .15), oilFraction: Math.min(1, dt * .15) }));
            this.supportModel.contact(this.chemicals, contacts);
            completedSupportStats = this.supportModel.step(dt, { geometry: p.supportGeometry, exposures: p.supportExposures ?? [], brokenIds: p.brokenSupports ?? [] });
        }
        // Selective solvent absorption leaves solutes on the surface. The
        // native pine owner receives the same finite water and sensible heat.
        const absorptionTransfers = [];
        for (let i = 0; i < this.topology.count; i++) {
            const m = i * 8, area = this.topology.meta[m + 3], owner = this._owner(i);
            const waterKg = owner ? this.chemicals.phaseGeometry(i, this._phaseGeometry).waterKg : 0;
            if (waterKg > 0) {
                const state = owner.cell(i, { faces: false }), available = Math.max(0, .6 * (state.virginKg + state.charKg) - state.waterKg);
                const absorbed = Math.min(waterKg, available, .08 * area * dt);
                if (absorbed > 0) absorptionTransfers.push({ index: i, waterKg: absorbed });
            }
        }
        for (const transfer of this.chemicals.takeAqueousWaters(absorptionTransfers, { kind: 'absorption' })) {
            if (transfer.waterKg > 0) this._owner(transfer.index).applySurfaceTransfer(transfer.index, { waterKg: transfer.waterKg, waterTemperatureK: transfer.temperatureK });
        }
        this._wood?.step(dt, this._exposure(this._wood, null, p.ambientTemperatureK));
        for (const [i, coating] of this._coatings) {
            coating.step(dt, this._exposure(coating, i, p.ambientTemperatureK));
            const state = coating.cell(i), t = state.temperatureK, m = i * 8, area = this.topology.meta[m + 3];
            const native = this.topology.domains[this.topology.meta[m + 4]].material === 'wood' ? this._wood : null;
            const nativeState = native?.cell(i);
            const substrateT = nativeState ? nativeState.faces[3].surfaceTemperatureK : C.referenceTemperatureK + (this._capacity(i) ? this._solidEnergyJ[i] / this._capacity(i) : 0);
            if (native || this._capacity(i)) {
                const coatingCapacity = (state.virginKg * PINE.wood.heatCapacity[0] + state.charKg * PINE.char.heatCapacity[0] + state.ashKg * PINE.ash.heatCapacity[0] + state.waterKg * C.waterHeatCapacityJPerKgK);
                const substrateCapacity = nativeState ? (nativeState.virginKg * PINE.wood.heatCapacity[0] + nativeState.charKg * PINE.char.heatCapacity[0] + nativeState.ashKg * PINE.ash.heatCapacity[0] + nativeState.waterKg * C.waterHeatCapacityJPerKgK) : this._capacity(i);
                const q = (t - substrateT) * Math.min(area * 100 * dt, coatingCapacity * .2, substrateCapacity * .2);
                const transferred = -coating.applySurfaceTransfer(i, { energyJ: -q }).energyJ;
                if (native) native.applySurfaceTransfer(i, { energyJ: transferred }); else this._solidEnergyJ[i] += transferred;
            }
        }
        // Catalog-backed noncombustible substrates conduct conservatively within their domain.
        const change = new Float64Array(this.topology.count);
        for (let i = 0; i < this.topology.count; i++) if (!this._wood?._cells.has(i) && this._capacity(i)) {
            const m = i * 8, area = this.topology.meta[m + 3], domain = this.topology.domains[this.topology.meta[m + 4]], material = this.materials[this.topology.meta[m + 6]], capacity = this._capacity(i);
            const t = C.referenceTemperatureK + this._solidEnergyJ[i] / capacity;
            const loss = area * (8 * (p.ambientTemperatureK - t) + .9 * STEFAN_BOLTZMANN * (p.ambientTemperatureK ** 4 - t ** 4));
            const boundary = Math.max(-.1 * capacity * Math.max(0, t - 1), Math.min(.1 * capacity * Math.max(0, 5000 - t), loss * dt));
            change[i] += boundary; this.ledger.bareBoundaryHeatJ += boundary;
            for (const [k, width, distance] of [[1, domain.size[1] / this.topology.n, domain.size[0] / this.topology.n], [3, domain.size[0] / this.topology.n, domain.size[1] / this.topology.n]]) {
                const j = this.topology.neighbors[i * 4 + k];
                if (j === SURFACE_NO_NEIGHBOR || j === i || this.topology.meta[j * 8 + 4] !== this.topology.meta[m + 4]) continue;
                if (this.motion && !this.motion.connectedEdges[i * 4 + k]) continue;
                const tj = C.referenceTemperatureK + this._solidEnergyJ[j] / this._capacity(j);
                const q = (tj - t) * Math.min(material.thermalConductivityWPerMK * domain.substrateDepthM * width / distance * dt, capacity * .1);
                change[i] += q; change[j] -= q;
            }
        }
        for (let i = 0; i < this.topology.count; i++) this._solidEnergyJ[i] += change[i];
        const liquidStats = this.chemicals.step(dt, { ambientTemperatureK: p.ambientTemperatureK,
            substrateTemperature: i => { const owner = this._owner(i); return owner ? owner.temperatureK(i, { face: 3 }) : C.referenceTemperatureK + (this._capacity(i) ? this._solidEnergyJ[i] / this._capacity(i) : 0); },
            transferHeat: (i, energyJ, detail) => {
                const actual = this._heat(i, energyJ, false);
                if (detail?.phase === 'aqueous' && actual < 0) this.ledger.waterCoolingJ -= actual;
                return actual;
            } });
        this.ledger.waterOutflowKg = liquidStats.outflowWaterKg; this.ledger.waterEvaporatedKg = liquidStats.evaporatedWaterKg; this.ledger.waterWipedKg = liquidStats.wipedWaterKg;
        this.timeSeconds += dt; this.steps++; this.options = { rain: p.rain, rainDomain: this._rainDomain(p.rainDomain), tiltX: p.tiltX, tiltZ: p.tiltZ, flow: p.flow, ambientTemperatureK: p.ambientTemperatureK };
        // All material mutations are complete. Reuse these exact owner reads
        // only within this projection, without retaining a cache across edits.
        const woodCells = { native: new Map(), coatings: new Map(), maxAqueousTemperatureK: 0 };
        this._syncFields(woodCells);
        for (let i = 0; i < this.topology.count; i++) {
            const coating = woodCells.coatings.get(i), native = woodCells.native.get(i);
            this.fields[i * 8 + 7] += ((coating?.steamRateKgPerSecond ?? 0) + (native?.steamRateKgPerSecond ?? 0) + this.chemicals.evaporationRates[i]) / this.topology.meta[i * 8 + 3];
            this.emissions[i * 2 + 1] = this.fields[i * 8 + 7];
            this.flowSources[i * 4 + 3] = this.fields[i * 8 + 7];
        }
        // The remaining updates affect panels only, so this support summary
        // is still current. Reuse it only for this completed-step projection.
        const stats = this._stats(liquidStats, woodCells, completedSupportStats);
        if (this.steps % 120 === 0) this.logger('Surface simulation metrics', stats);
        return stats;
    }
    stats() {
        this._assertLive(); return this._stats(this.chemicals.stats());
    }
    _stats(chemicalStats, woodCells = null, completedSupportStats) {
        this._assertLive(); let waterM3 = 0, moistureKg = 0, coatingKg = 0, substrateKg = 0, totalArea = 0, heat = 0, damage = 0, soot = 0, maxTemperatureK = 0;
        for (let i = 0; i < this.topology.count; i++) {
            const m = i * 8, area = this.topology.meta[m + 3]; totalArea += area; waterM3 += this.fields[m] * area;
            moistureKg += this.fields[m + 5] * area; coatingKg += this.fields[m + 1] * area; substrateKg += this.fields[m + 6] * area;
            heat += this.fields[m + 2] * area; damage += this.fields[m + 3] * area; soot += this.fields[m + 4] * area; maxTemperatureK = Math.max(maxTemperatureK, this.fields[m + 2]);
        }
        let woodVirginKg = 0, woodCharKg = 0, woodAshKg = 0, woodRemovedVolumeM3 = 0;
        for (const i of this._wood?._cells.keys() ?? []) {
            const cell = woodCells?.native.get(i) ?? this._wood.cell(i); woodVirginKg += cell.virginKg; woodCharKg += cell.charKg; woodAshKg += cell.ashKg;
            woodRemovedVolumeM3 += Math.max(0, (cell.initialDryMassKg - cell.virginKg - cell.charKg - cell.ashKg) / PINE.dryDensityKgM3);
        }
        const totals = [this._wood, ...this._coatings.values()].filter(Boolean).map(model => model.totals());
        const sum = key => totals.reduce((value, total) => value + (total[key] ?? 0), 0);
        if (woodCells) maxTemperatureK = Math.max(maxTemperatureK, woodCells.maxAqueousTemperatureK);
        else for (let i = 0; i < this.topology.count; i++) {
            const liquid = this.chemicals.cell(i);
            if (liquid.aqueousMassKg > 0) maxTemperatureK = Math.max(maxTemperatureK, liquid.aqueousTemperatureK);
        }
        // Budgets use retained f64 masses, never their rounded render caches.
        moistureKg = [this._wood, ...this._coatings.values()].filter(Boolean).reduce((total, model) => total + [...model._cells.keys()].reduce((value, i) => value + ((model === this._wood ? woodCells?.native.get(i) : woodCells?.coatings.get(i)) ?? model.cell(i)).waterKg, 0), 0);
        waterM3 = chemicalStats.freeWaterKg / 1000;
        const liquidWaterResidualKg = chemicalStats.externalWaterAddedKg + chemicalStats.chemicalLedger.acidWaterAddedKg + chemicalStats.reactionLiquidWaterKg + (chemicalStats.supportLedger?.exchangedWaterKg ?? 0)
            - chemicalStats.freeWaterKg - chemicalStats.airborneWaterKg - chemicalStats.absorbedWaterKg - chemicalStats.evaporatedWaterKg - chemicalStats.wipedWaterKg - chemicalStats.outflowWaterKg;
        const woodWaterResidualKg = this.ledger.initialWaterKg + sum('externalWaterKg') - moistureKg - sum('steamKg');
        const expectedEnergyJ = sum('initialEnergyJ') + sum('depositedPineEnergyJ') + sum('externalWaterSensibleJ')
            + sum('convectionJ') + sum('radiationJ') + sum('charReactionJ') - sum('pyrolysisJ') - sum('gasSensibleJ')
            - sum('gasReactionHeatJ') - sum('steamLatentJ') + this.ledger.brushHeatJ - this.ledger.chemicalBrushHeatJ
            - this.ledger.legacySolidCoolingJ + this.ledger.bareBoundaryHeatJ + chemicalStats.chemicalLedger.heatToSubstrateJ;
        const storedEnergyJ = sum('storedEnergyJ') + this._solidEnergyJ.reduce((value, energy) => value + energy, 0);
        const volatileKgPerSecond = [...(this._wood?._cells.keys() ?? [])].reduce((value, i) => value + (woodCells?.native.get(i) ?? this._wood.cell(i)).volatileRateKgPerSecond, 0)
            + [...this._coatings].reduce((value, [i, model]) => value + (woodCells?.coatings.get(i) ?? model.cell(i)).volatileRateKgPerSecond, 0);
        const steamKgPerSecond = this.fields.reduce((value, amount, i) => i % 8 === 7 ? value + amount * this.topology.meta[i - 4] : value, 0);
        const supportStats = completedSupportStats === undefined ? this.supportModel?.stats() ?? null : completedSupportStats;
        return { waterM3, moistureKg, coatingKg, substrateKg, woodVirginKg, woodCharKg, woodAshKg, woodDrySolidKg: woodVirginKg + woodCharKg + woodAshKg, woodRemovedVolumeM3, averageTemperatureK: heat / totalArea, maxTemperatureK, damageMean: damage / totalArea, sootMean: soot / totalArea, ...chemicalStats,
            supportStats, volatileKgPerSecond, steamKgPerSecond, waterResidualKg: liquidWaterResidualKg + woodWaterResidualKg + (supportStats?.waterResidualKg ?? 0),
            massResidualKg: sum('massResidualKg') + chemicalStats.chemicalMassResidualKg + (supportStats?.massResidualKg ?? 0), energyResidualJ: expectedEnergyJ - storedEnergyJ + chemicalStats.chemicalEnergyResidualJ + (supportStats?.energyResidualJ ?? 0),
            solidEnergyResidualJ: expectedEnergyJ - storedEnergyJ, liquidWaterResidualKg, woodWaterResidualKg,
            ledger: { ...this.ledger, storedEnergyJ, expectedEnergyJ, woodSteamKg: sum('steamKg'), volatileKg: sum('volatileKg'), co2Kg: sum('co2Kg') },
            assumptions: ['Layered FDS pine reactions with prescribed atmospheric oxygen; the native Flow volume presents emitted gas without feeding a second fuel inventory.', 'Liquid transport is a bounded reduced surface flow model with composition and heat carried by each phase.', 'Selective solvent absorption leaves dissolved solutes on the surface; ambient humidity exchange and electrolyte effects on wood are not solved.', 'Catalog heat capacity and conductivity are held constant; substrate melting and deformation are not modelled.',
                'Rendered pine dry solid uses a compacted mass-equivalent depth at the original dry pine density; char/ash expansion and detached residue motion are not solved. Liquid pressure includes physical recession and stratified liquid support.',
                ...this.materials.filter(material => !material.thermalAvailable).map(material => `${material.name}: substrate heat response unavailable (${material.missingProperties.join(', ')}); pine coatings remain modelled.`), ...chemicalStats.assumptions] };
    }
    snapshot() {
        if (this._asyncStepPending) throw new Error('Await the preceding asynchronous surface step before taking a checkpoint');
        this._assertLive(); return { schema: 'engine.surface-fields', version: 1, liquidModelVersion: 2, approximate: false,
            topology: { n: this.topology.n, domains: this.topology.domains.map(domain => ({ ...domain, center: [...domain.center], size: [...domain.size] })), seams: this.topology.seams, closed: this.topology.closed, identity: this.topology.identity },
            materialIds: this.materials.map(material => material.id), fields: this.fields.slice(), solidEnergyJ: this._solidEnergyJ.slice(),
            ledger: { ...this.ledger }, timeSeconds: this.timeSeconds, steps: this.steps, options: { ...this.options }, wood: this._wood?.snapshot() ?? null,
            motion: this.motion ? { topologyIdentity: this.topology.identity, poses: [...this.motion.poses], velocities: [...this.motion.velocities], connectedEdges: [...this.motion.connectedEdges] } : null,
            chemicals: this.chemicals.snapshot(),
            supports: this.supportModel?.snapshot() ?? null,
            supportsConfigured: this.supportModel !== null,
            coatings: [...this._coatings].map(([index, model]) => ({ index, model: model.snapshot() })) };
    }
    restore(snapshot) {
        this._assertLive();
        if (this._asyncStepPending) throw new Error('Await the preceding asynchronous surface step before restoring');
        const materialIds = this.materials.map(material => material.id);
        // The original v1 owner had three materials and no liquid chemistry.
        // Its additive migration is limited to topologies without calcite.
        const legacy = snapshot && !Object.hasOwn(snapshot, 'chemicals') && !this.topology.domains.some(domain => domain.material === 'calcite')
            && Array.isArray(snapshot.materialIds) && snapshot.materialIds.length === 3
            && snapshot.materialIds.every((id, index) => id === materialIds[index]);
        if (!snapshot || snapshot.schema !== 'engine.surface-fields' || snapshot.version !== 1 || snapshot.approximate || snapshot.topology?.identity !== this.topology.identity
            || !legacy && JSON.stringify(snapshot.materialIds) !== JSON.stringify(materialIds)) throw new RangeError('Incompatible authoritative surface checkpoint');
        const rebuilt = createSurfaceFieldTopology(snapshot.topology);
        if (rebuilt.identity !== this.topology.identity || !(snapshot.fields instanceof Float32Array) || snapshot.fields.length !== this.fields.length || !(snapshot.solidEnergyJ instanceof Float64Array) || snapshot.solidEnergyJ.length !== this.topology.count) throw new RangeError('Invalid retained surface geometry or field arrays');
        for (let i = 0; i < snapshot.fields.length; i++) checked(snapshot.fields[i], 'Retained surface field', i % 8 === 2 ? Number.MIN_VALUE : 0, i % 8 === 2 ? Infinity : i % 8 === 3 || i % 8 === 4 ? 1 : 1e10);
        snapshot.solidEnergyJ.forEach(value => checked(value, 'Retained substrate energy', -1e30, 1e30));
        checked(snapshot.timeSeconds, 'Retained time'); if (!Number.isSafeInteger(snapshot.steps) || snapshot.steps < 0) throw new RangeError('Invalid retained step count');
        const migrateLiquids = snapshot.liquidModelVersion === undefined;
        if (migrateLiquids ? !legacy && snapshot.chemicals?.version !== 1 : snapshot.liquidModelVersion !== 2 || ![2, 3, 4].includes(snapshot.chemicals?.version)) throw new RangeError('Unsupported surface liquid checkpoint');
        const retainedLedger = legacy ? { chemicalBrushHeatJ: 0, chemicalWaterCoolingJ: 0, ...snapshot.ledger } : { ...snapshot.ledger };
        if (migrateLiquids) retainedLedger.legacySolidCoolingJ = retainedLedger.waterCoolingJ - retainedLedger.chemicalWaterCoolingJ;
        for (const key of Object.keys(this.ledger)) checked(retainedLedger[key], `Retained ledger ${key}`, ['waterCoolingJ', 'brushHeatJ', 'chemicalBrushHeatJ', 'chemicalWaterCoolingJ', 'legacySolidCoolingJ', 'bareBoundaryHeatJ', 'unmodelledHeatJ'].includes(key) ? -1e30 : 0);
        const newChemicals = new SurfaceFieldChemicalInventory(this.topology, { runoff: this.chemicals.runoff.enabled, supportChemistry: this.supportsEnabled });
        if (legacy) { newChemicals.steps = snapshot.steps; newChemicals.timeSeconds = snapshot.timeSeconds; }
        else newChemicals.restore(snapshot.chemicals);
        let newMotion = null;
        if (snapshot.motion) {
            const retained = snapshot.motion;
            if (!['poses', 'velocities', 'connectedEdges'].every(key => Array.isArray(retained[key]) && retained[key].every(Number.isFinite))
                || retained.connectedEdges.some(value => value !== 0 && value !== 1)) throw new RangeError('Invalid retained native surface motion');
            newMotion = createSurfaceFieldMotion(this.topology, { topologyIdentity: retained.topologyIdentity,
                poses: new Float32Array(retained.poses), velocities: new Float32Array(retained.velocities), connectedEdges: new Uint8Array(retained.connectedEdges) });
        }
        newChemicals.runoff.setMotion(newMotion);
        let newSupports = null;
        if (snapshot.chemicals?.version === 4 && (typeof snapshot.supportsConfigured !== 'boolean' || snapshot.supportsConfigured !== !!snapshot.supports)) throw new RangeError('Checkpoint changed support ownership configuration');
        if (snapshot.supports) {
            if (!this.supportsEnabled) throw new RangeError('Support checkpoint requires enabled support materials');
            newSupports = new SurfaceFieldSupports({ supports: snapshot.supports.definitions, segments: snapshot.supports.segments }).restore(snapshot.supports);
            if (newSupports.timeSeconds !== snapshot.timeSeconds || newSupports.steps !== snapshot.steps) throw new RangeError('Support and surface clocks disagree');
        }
        for (const key of ['exchangedMassKg', 'exchangedWaterKg', 'exchangedEnergyJ']) {
            const panel = newChemicals.supportLedger[key] ?? 0, cord = newSupports?.chemistry.supportLedger[key] ?? 0;
            if (Math.abs(panel + cord) > Math.max(key === 'exchangedEnergyJ' ? 1e-7 : 1e-10, (Math.abs(panel) + Math.abs(cord)) * 1e-12)) throw new RangeError('Checkpoint lost a cross-owner support transfer');
        }
        if (migrateLiquids) for (let i = 0; i < this.topology.count; i++) {
            const waterKg = snapshot.fields[i * 8] * this.topology.meta[i * 8 + 3] * 1000;
            if (waterKg > 0) newChemicals.addWater(i, waterKg, snapshot.options?.ambientTemperatureK);
        }
        if (newChemicals.steps !== snapshot.steps || newChemicals.timeSeconds !== snapshot.timeSeconds) throw new RangeError('Chemical checkpoint clock disagrees with world');
        const newWood = this._wood ? new WoodCombustion({ cells: snapshot.wood?.cells.map(cell => ({ id: cell.id, dimensionsM: cell.dimensionsM, thermalAxis: cell.thermalAxis })) }).restore(snapshot.wood) : null;
        if (!this._wood && snapshot.wood !== null) throw new RangeError('Checkpoint introduced a native pine owner');
        const newCoatings = new Map();
        if (!Array.isArray(snapshot.coatings) || snapshot.coatings.length > this.topology.count) throw new RangeError('Invalid retained coatings');
        for (const entry of snapshot.coatings) {
            if (!Number.isInteger(entry.index) || entry.index < 0 || entry.index >= this.topology.count || newCoatings.has(entry.index) || entry.model?.cells.length !== 1 || entry.model.cells[0].id !== entry.index) throw new RangeError('Invalid coating ownership');
            newCoatings.set(entry.index, new WoodCombustion({ allowThinCells: true, cells: entry.model.cells.map(cell => ({ id: cell.id, dimensionsM: cell.dimensionsM, thermalAxis: cell.thermalAxis })) }).restore(entry.model));
        }
        if (newWood && (newWood._cells.size !== this._wood._cells.size || [...this._wood._cells.keys()].some(key => !newWood._cells.has(key)))) throw new RangeError('Checkpoint changed native pine ownership');
        if (newWood) {
            if (newWood.integrationMode !== this._wood.integrationMode || newWood.allowThinCells || newWood.surfaceLayerM !== this._wood.surfaceLayerM || newWood.charHeatToSolidFraction !== this._wood.charHeatToSolidFraction || newWood.oxygenPenetrationM !== this._wood.oxygenPenetrationM
                || newWood.timeSeconds !== snapshot.timeSeconds || newWood.steps !== snapshot.steps || JSON.stringify(newWood._connections) !== JSON.stringify(newMotion ? this._woodConnections(newMotion) : this._woodRestConnections)) throw new RangeError('Checkpoint changed native pine configuration');
            for (const [i, cell] of newWood._cells) if (cell.axis !== 1 || JSON.stringify(cell.dimensions) !== JSON.stringify(this._wood._cells.get(i).dimensions)) throw new RangeError('Checkpoint changed native pine cell geometry');
        }
        for (const [i, model] of newCoatings) {
            const cell = model._cells.get(i), domain = this.topology.domains[this.topology.meta[i * 8 + 4]];
            if (model.integrationMode !== 'global' || !model.allowThinCells || cell.axis !== 1 || cell.dimensions[0] !== domain.size[0] / this.topology.n || cell.dimensions[2] !== domain.size[1] / this.topology.n || model._connections.length || model.timeSeconds > snapshot.timeSeconds || model.steps > snapshot.steps) throw new RangeError('Checkpoint changed coating geometry or clock');
        }
        checked(snapshot.options?.rain, 'Retained rain', 0, 1e6); checked(snapshot.options?.flow, 'Retained flow', 0, 100);
        checked(snapshot.options?.ambientTemperatureK, 'Retained ambient temperature', 1, 5000);
        for (const key of ['tiltX', 'tiltZ']) checked(snapshot.options?.[key], `Retained option ${key}`, -10, 10);
        const retainedOptions = { ...snapshot.options, rainDomain: this._rainDomain(snapshot.options?.rainDomain) };
        const validation = Object.create(SurfaceFieldWorld.prototype);
        Object.assign(validation, { topology: this.topology, materials: this.materials, fields: snapshot.fields.slice(), emissions: new Float32Array(this.emissions.length), auxiliary: newChemicals.auxiliary, _solidEnergyJ: snapshot.solidEnergyJ, _wood: newWood, _coatings: newCoatings, chemicals: newChemicals });
        validation._syncFields();
        for (let i = 0; i < snapshot.fields.length; i++) if (!(migrateLiquids && i % 8 === 0) && i % 8 !== 7 && validation.fields[i] !== snapshot.fields[i]) throw new RangeError('Checkpoint field cache disagrees with its native owner');
        this._wood = newWood; this._coatings = newCoatings; this.fields.set(snapshot.fields); this._solidEnergyJ.set(snapshot.solidEnergyJ);
        this.chemicals = newChemicals; this.auxiliary = this.chemicals.auxiliary; this.liquidProperties = this.chemicals.liquidProperties;
        this.motion = newMotion;
        this.supportModel?.dispose(); this.supportModel = newSupports;
        this.ledger = retainedLedger; this.timeSeconds = snapshot.timeSeconds; this.steps = snapshot.steps; this.options = retainedOptions;
        this._syncFields(); this.logger('Surface checkpoint restored', { steps: this.steps, timeSeconds: this.timeSeconds, legacy,
            supportWoodIntegrationMode: this.supportModel?.wood?.integrationMode ?? null }); return this;
    }
    dispose() { if (!this._disposed) { this._disposed = true; this._coatings.clear(); this._wood = null; this.supportModel?.dispose(); this.chemicals.dispose(); this.logger('Surface fields disposed', { steps: this.steps }); } }
}
export const createSurfaceFieldWorld = options => new SurfaceFieldWorld(options);
