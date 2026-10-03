// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { WoodCombustion, PINE_FIRE_MATERIAL } from '../combustion/WoodCombustion.js';
import { SurfaceFieldChemicalInventory, SURFACE_IRON_PROFILE } from './SurfaceFieldChemistry.js';
import { createMatterState, replaceMatterInternalEnergy } from '../../matter/contracts/MatterContracts.js';
import { cloneStrictJson } from '../../core/schema/StrictJsonValue.js';
import { contentHash } from '../../matter/fabric/FabricSupport.js';

export const SURFACE_SUPPORT_PROFILE = Object.freeze({ id: 'surface.supports.pine-proxy-steel.v1',
    fiber: 'hemp-pine-proxy', steel: 'carbon-steel', steelDensityKgM3: 7850, steelCpJPerKgK: 500,
    wickingPerSecond: .5, absorbedWaterDryBasis: .6, adjacentPlumeHeatUpFraction: .08, adjacentPlumeHeatDownFraction: .02,
    plumeHeatToFilmFraction: .75, residueDensityKgM3: PINE_FIRE_MATERIAL.dryDensityKgM3,
    scope: 'Hemp appearance with explicitly approximate FDS pine density, conduction, moisture and pyrolysis; no calibrated hemp kinetics claimed. Carbon steel is the existing 99% Fe/1% C bookkeeping composition. Remaining virgin fiber or iron cross-section scales authored tensile strength; char/residue carries mass but no tensile strength. Local film redistribution is a bounded adjacent-segment wicking closure, not a porous-flow solver. Adjacent plume heat returns a bounded 8% upward/2% downward share of finite oil gas energy to nearby fibers, with distance attenuation; this is an authored heat-coupling closure, not sampled gas CFD.' });
const P = SURFACE_SUPPORT_PROFILE, ambient = 293.15;
const finite = (v, name, min = 0, max = 1e12) => {
    if (!Number.isFinite(v) || v < min || v > max) throw new RangeError(`Invalid support ${name}`); return v;
};
const vector = (v, label) => {
    if (!Array.isArray(v) || v.length !== 3) throw new RangeError(`Invalid support ${label}`);
    return v.map(x => finite(x, label, -1e6, 1e6));
};
const mass = state => Object.values(state.conserved.speciesMassKg).reduce((a, b) => a + b, 0);
const midpoint = (a, b) => a.map((x, i) => (x + b[i]) / 2);

/** Material ownership is independent of native constraints. Cutting a support
 * changes thermal connectivity and tensile capacity, never deletes its matter.
 * Geometry is bottom-to-top: attachment at node 0, overhead anchor at node N. */
export class SurfaceFieldSupports {
    constructor({ supports, segments = 6 } = {}) {
        if (!Number.isInteger(segments) || segments < 2 || segments > 8 || !Array.isArray(supports) || !supports.length || supports.length > 16) throw new RangeError('Invalid support configuration');
        this.segments = segments; this.definitions = cloneStrictJson(supports, '$.surfaceSupports');
        this.records = []; this.byId = new Map(); this.geometry = new Map(); this.broken = new Set(); this.steel = new Map();
        this.steps = 0; this.timeSeconds = 0; this.lastDt = 0; this.hydrogenRates = new Float64Array(supports.length * segments);
        this.plumeReturnedW = new Float64Array(supports.length * segments);
        this.ledger = { initialSteelKg: 0, initialSteelEnergyJ: 0, steelExternalHeatJ: 0 };
        const cells = [];
        for (const definition of this.definitions) {
            const d = definition;
            if (typeof d.id !== 'string' || !/^[a-zA-Z0-9:_-]{1,100}$/.test(d.id) || this.byId.has(d.id)
                || !Number.isSafeInteger(d.domain) || d.domain < 0 || !Number.isSafeInteger(d.cellIndex) || d.cellIndex < 0
                || ![P.fiber, P.steel].includes(d.material)) throw new RangeError('Invalid support identity/material');
            d.anchor = vector(d.anchor, 'anchor'); d.attachment = vector(d.attachment, 'attachment');
            finite(d.radiusM, 'radius', .00005, .05); finite(d.breakingForceN, 'breaking force', Number.MIN_VALUE, 1e8);
            const length = Math.hypot(...d.anchor.map((x, k) => x - d.attachment[k])); finite(length, 'length', .01, 100);
            const start = this.records.length, area = Math.PI * d.radiusM ** 2, segmentLength = length / segments;
            this.byId.set(d.id, { definition: d, start });
            this.geometry.set(d.id, Array.from({ length: segments + 1 }, (_, j) => d.attachment.map((x, k) => x + (d.anchor[k] - x) * j / segments)));
            for (let j = 0; j < segments; j++) {
                const index = this.records.length, id = `${d.id}:${j}`, volume = area * segmentLength;
                const record = { id, supportId: d.id, segment: j, index, area, length: segmentLength,
                    surfaceAreaM2: 2 * Math.PI * d.radiusM * segmentLength, definition: d };
                this.records.push(record);
                if (d.material === P.fiber) cells.push({ id, dimensionsM: [Math.sqrt(area), segmentLength, Math.sqrt(area)],
                    thermalAxis: 0, moistureDryBasis: .12 });
                else {
                    const kg = volume * P.steelDensityKgM3, energy = kg * P.steelCpJPerKgK * ambient;
                    this.steel.set(index, createMatterState({ regionId: `surface-support:${id}`, definitionId: P.id,
                        definitionHash: contentHash(P), revision: 0,
                        representation: { kind: 'voxel', fidelityLevel: 'L1', backendId: 'engine.surface-fields.cpu' },
                        ancestry: { rootRegionId: `surface-support:${id}`, parentRegionId: null, eventId: null, generation: 0 },
                        conserved: { speciesMassKg: { 'species:Fe': kg * .99, 'species:C': kg * .01 }, internalEnergyJ: energy,
                            momentumKgMPerS: [0, 0, 0], electricChargeC: 0 } }));
                    record.initialIronKg = kg * .99; record.initialSteelKg = kg;
                    this.ledger.initialSteelKg += kg; this.ledger.initialSteelEnergyJ += energy;
                }
            }
        }
        this.definitionHash = contentHash({ profile: P, supports: this.definitions, segments });
        this.wood = cells.length ? new WoodCombustion({ cells, allowThinCells: true, integrationMode: 'components' }) : null;
        this._connect();
        const count = this.records.length, meta = new Float64Array(count * 8);
        for (const record of this.records) { meta[record.index * 8 + 3] = record.surfaceAreaM2; meta[record.index * 8 + 4] = 0; }
        this.chemistry = new SurfaceFieldChemicalInventory({ count, meta, identity: this.definitionHash, edgeSources: [],
            neighbors: new Uint32Array(count * 4).fill(0xffffffff), domains: [{ material: 'copper' }] },
        { supportChemistry: true, namespace: 'surface-supports' });
    }
    _record(id, segment) {
        const item = this.byId.get(id);
        if (!item || !Number.isInteger(segment) || segment < 0 || segment >= this.segments) throw new RangeError('Unknown support segment');
        return this.records[item.start + segment];
    }
    _connect() {
        if (!this.wood) return;
        const key = [...this.broken].sort((a, b) => a - b).join(',');
        if (this._connectionKey === key) return;
        const connections = [];
        for (const r of this.records) if (r.definition.material === P.fiber && r.segment > 0) {
            const previous = this.records[r.index - 1];
            if (!this.broken.has(r.index) && !this.broken.has(previous.index)) connections.push({ a: previous.id, b: r.id,
                faceA: 3, faceB: 2, areaM2: r.area, contactConductanceWPerM2K: 1000 });
        }
        this.wood.setConnections(connections); this._connectionKey = key;
    }
    /** Native contacts are explicit. Panel-wide average wetness cannot reach
     * an overhead segment. Callers may transfer only from its actual donor. */
    contact(panelChemistry, contacts = []) {
        const entries = cloneStrictJson(contacts, '$.supportContacts');
        if (!Array.isArray(entries) || !(panelChemistry instanceof SurfaceFieldChemicalInventory) || !panelChemistry.supportChemistry) throw new RangeError('Support contacts require an enabled panel inventory');
        const seen = new Set();
        for (const entry of entries) {
            const r = this._record(entry.id, entry.segment ?? 0);
            if (seen.has(r.id) || entry.cellIndex !== r.definition.cellIndex || entry.segment !== undefined && entry.segment !== 0) throw new RangeError('Panel film contact must uniquely address the attached segment');
            seen.add(r.id); panelChemistry.cell(entry.cellIndex);
            finite(entry.aqueousFraction ?? 0, 'contact aqueous fraction', 0, 1); finite(entry.oilFraction ?? 0, 'contact oil fraction', 0, 1);
        }
        return entries.map(entry => panelChemistry.transferLiquidTo(this.chemistry, entry.cellIndex,
            this._record(entry.id, entry.segment ?? 0).index, entry));
    }
    dose(id, segment, { tool, massKg, temperatureK = ambient } = {}) {
        const r = this._dose(id, segment, { tool, massKg, temperatureK });
        return this.frame().find(row => row.index === r.index);
    }
    _dose(id, segment, { tool, massKg, temperatureK = ambient }) {
        const r = this._record(id, segment); finite(massKg, 'dose mass', 0, 1e3); finite(temperatureK, 'dose temperature', 1, 1500);
        if (!['water', 'oil', 'acid'].includes(tool)) throw new RangeError('Unknown support liquid');
        this.chemistry[{ water: 'addWater', oil: 'addOil', acid: 'addAcid' }[tool]](r.index, massKg, temperatureK);
        return r;
    }
    /** Apply an ordered finite dose/ignition sequence atomically, projecting
     * its material view only after all commands succeed. */
    applyBrushes(commands) {
        const inputs = cloneStrictJson(commands, '$.supportBrushes');
        if (!Array.isArray(inputs) || !inputs.length || inputs.length > 128) throw new RangeError('Support brush batch requires 1 to 128 commands');
        for (const input of inputs) {
            if (!input || typeof input !== 'object' || Array.isArray(input)
                || Object.keys(input).some(key => !['id', 'segment', 'tool', 'massKg', 'temperatureK'].includes(key))) throw new RangeError('Invalid support brush command');
            this._record(input.id, input.segment ?? 0);
            if (!['water', 'oil', 'acid', 'ignite'].includes(input.tool)) throw new RangeError('Unknown support brush tool');
            finite(input.massKg ?? 0, 'dose mass', 0, 1e3); finite(input.temperatureK ?? ambient, 'dose temperature', 1, 1500);
        }
        const before = this.snapshot();
        try {
            for (const { id, segment = 0, tool, massKg = 0, temperatureK = ambient } of inputs) {
                if (tool === 'ignite') this.ignite(id, segment);
                else this._dose(id, segment, { tool, massKg, temperatureK });
            }
            return this.frame();
        } catch (error) { this.restore(before); throw error; }
    }
    ignite(id, segment) {
        const r = this._record(id, segment); let energyJ = this.chemistry.ignite(r.index);
        if (r.definition.material === P.fiber) {
            const cell = this.wood.cell(r.id, { faces: false });
            energyJ += this.wood.applySurfaceTransfer(r.id, { energyJ: cell.remainingMassKg * 2500 * Math.max(0, 750 - cell.temperatureK) }).energyJ;
        }
        return energyJ;
    }
    _temperature(r) { const state = this.steel.get(r.index); return state ? state.conserved.internalEnergyJ / (mass(state) * P.steelCpJPerKgK) : this.wood.temperatureK(r.id); }
    _heat(r, requested, external = true) {
        if (r.definition.material === P.fiber) return this.wood.applySurfaceTransfer(r.id, { energyJ: requested }).energyJ;
        const state = this.steel.get(r.index), capacity = mass(state) * P.steelCpJPerKgK;
        const actual = Math.max(capacity - state.conserved.internalEnergyJ, Math.min(requested, capacity * 5000 - state.conserved.internalEnergyJ));
        this.steel.set(r.index, replaceMatterInternalEnergy(state, state.conserved.internalEnergyJ + actual, { derived: null }));
        if (external) this.ledger.steelExternalHeatJ += actual; return actual;
    }
    step(dt, { geometry = [], exposures = [], brokenIds = [] } = {}) {
        finite(dt, 'step', Number.MIN_VALUE, .25);
        const geometryInput = cloneStrictJson(geometry, '$.supportGeometry'), exposureInput = cloneStrictJson(exposures, '$.supportExposures');
        if (!Array.isArray(geometryInput) || !Array.isArray(exposureInput) || !Array.isArray(brokenIds)) throw new RangeError('Invalid support step inputs');
        const nextGeometry = new Map(this.geometry), exposureMap = new Map(), seen = new Set();
        for (const g of geometryInput) {
            if (!this.byId.has(g.id) || seen.has(g.id) || !Array.isArray(g.positions) || g.positions.length !== this.segments + 1) throw new RangeError('Invalid support geometry');
            seen.add(g.id); nextGeometry.set(g.id, g.positions.map(p => vector(p, 'completed position')));
        }
        for (const e of exposureInput) {
            const r = this._record(e.id, e.segment);
            if (exposureMap.has(r.index)) throw new RangeError('Duplicate support exposure');
            exposureMap.set(r.index, { gasTemperatureK: finite(e.gasTemperatureK ?? ambient, 'gas temperature', 1, 5000),
                incidentRadiationWPerM2: finite(e.incidentRadiationWPerM2 ?? 0, 'irradiance', 0, 1e9) });
        }
        for (const id of brokenIds) if (!this.byId.has(id)) throw new RangeError('Unknown native broken support');
        this.geometry = nextGeometry;
        for (const id of brokenIds) {
            const { start } = this.byId.get(id);
            // Native broken IDs repeat every tick. A retained cut needs no
            // new material view and cannot select another segment later.
            if (this.records.slice(start, start + this.segments).some(r => this.broken.has(r.index))) continue;
            let weakest = start, strength = Infinity;
            for (let index = start; index < start + this.segments; index++) {
                const state = this.steel.get(index), value = state ? (state.conserved.speciesMassKg['species:Fe'] ?? 0) / this.records[index].initialIronKg
                    : this.wood.cell(this.records[index].id, { faces: false }).strengthFraction;
                if (value < strength) { weakest = index; strength = value; }
            }
            this.broken.add(weakest);
        }
        this._connect(); this.hydrogenRates.fill(0);
        const phaseA = {}, phaseB = {};
        // Adjacent films move only along an intact contacted material path.
        // A finite coefficient sets wicking pace; no wetness/fire flag spreads.
        for (const r of this.records) if (r.segment > 0 && !this.broken.has(r.index) && !this.broken.has(r.index - 1)) {
            const previous = this.records[r.index - 1];
            if (r.definition.material !== P.fiber) continue;
            for (const phase of ['aqueous', 'oil']) {
                const a = this.chemistry.phaseGeometry(previous.index, phaseA), b = this.chemistry.phaseGeometry(r.index, phaseB);
                const key = phase === 'oil' ? 'oilKg' : 'aqueousMassKg', from = a[key] >= b[key] ? previous : r, to = from === previous ? r : previous;
                const high = Math.max(a[key], b[key]), low = Math.min(a[key], b[key]);
                const positions = this.geometry.get(r.supportId), height = midpoint(positions[to.segment], positions[to.segment + 1])[1] - midpoint(positions[from.segment], positions[from.segment + 1])[1];
                if (high > 0 && height < .25) this.chemistry.transferLiquidTo(this.chemistry, from.index, to.index,
                    { [phase === 'oil' ? 'oilFraction' : 'aqueousFraction']: Math.min(.25, P.wickingPerSecond * dt * (high - low) / high) });
            }
        }
        const faces = [];
        for (const r of this.records) {
            const e = exposureMap.get(r.index);
            if (r.definition.material === P.fiber) {
                const waterKg = this.chemistry.phaseGeometry(r.index, phaseA).waterKg;
                const wood = waterKg > 0 ? this.wood.cell(r.id, { faces: false }) : null;
                const request = wood ? Math.min(waterKg, Math.max(0, wood.initialDryMassKg * P.absorbedWaterDryBasis - wood.waterKg) * Math.min(1, dt * 2)) : 0;
                if (request > 0) {
                    const moved = this.chemistry.takeAqueousWater(r.index, request);
                    if (moved.waterKg > 0) this.wood.applySurfaceTransfer(r.id, { waterKg: moved.waterKg, waterTemperatureK: moved.temperatureK });
                }
                if (e) for (const face of [0, 1, 4, 5]) faces.push({ cellId: r.id, face, ...e });
            } else if (e) this._heat(r, r.surfaceAreaM2 * (8 * (e.gasTemperatureK - this._temperature(r)) + e.incidentRadiationWPerM2) * dt);
        }
        this.chemistry.step(dt, { substrateTemperature: i => this._temperature(this.records[i]),
            transferHeat: (i, joules) => this._heat(this.records[i], joules) });
        this.plumeReturnedW.fill(0);
        for (const source of this.records) if (source.definition.material === P.fiber) {
            const power = this.chemistry.gasSourceRates[source.index * 2]; if (!(power > 0)) continue;
            const positions = this.geometry.get(source.supportId), center = midpoint(positions[source.segment], positions[source.segment + 1]);
            for (const j of [source.segment - 1, source.segment + 1]) {
                if (j < 0 || j >= this.segments) continue;
                const target = this._record(source.supportId, j), point = midpoint(positions[j], positions[j + 1]);
                const distance = Math.hypot(...point.map((v, axis) => v - center[axis]));
                if (distance > .5) continue;
                const fraction = point[1] >= center[1] ? P.adjacentPlumeHeatUpFraction : P.adjacentPlumeHeatDownFraction;
                const requested = power * dt * fraction * Math.min(1, (.25 / Math.max(.001, distance)) ** 2);
                // Material caps are resolved first; take only accepted heat
                // from the gas owner. No thermal energy is spent twice.
                const available = Math.min(requested, this.chemistry.gas.conserved.internalEnergyJ), film = this.chemistry.phaseGeometry(target.index, phaseA);
                const filmRequest = available * P.plumeHeatToFilmFraction;
                const liquidHeat = film.aqueousMassKg > 0 ? this.chemistry.exchangeAqueousHeat(target.index, filmRequest)
                    : film.oilKg > 0 ? this.chemistry.heat(target.index, filmRequest) : 0;
                const actual = liquidHeat + this._heat(target, available - liquidHeat);
                this.chemistry.takeGasHeat(actual); this.plumeReturnedW[source.index] += actual / dt;
            }
        }
        if (this.wood) this.wood.step(dt, { faces });
        // A fully spent cord segment becomes its finite ash residue. Reuse
        // the engine's energy-preserving remesh instead of heating a tiny
        // ash mass through the former full rope area forever.
        const residues = [];
        if (this.wood) for (const r of this.records) if (r.definition.material === P.fiber) {
            const cell = this.wood.cell(r.id, { faces: false });
            if (cell.ashConversionReady && !cell.residueSurfaceAreaM2) { this.broken.add(r.index); residues.push({ r, cell }); }
        }
        if (residues.length) {
            this._connect();
            for (const { r, cell } of residues) {
                const radius = Math.cbrt(3 * cell.ashKg / (4 * Math.PI * P.residueDensityKgM3));
                this.wood.setResidueSurface(r.id, { surfaceAreaM2: 4 * Math.PI * radius * radius });
            }
        }
        for (const [index, state] of this.steel) {
            const r = this.records[index], reaction = this.chemistry.reactIron(index, state, { dt, areaM2: r.surfaceAreaM2 });
            this.steel.set(index, reaction.state); this.hydrogenRates[index] = reaction.hydrogenProducedKg / dt;
        }
        this.timeSeconds += dt; this.steps++; this.lastDt = dt;
        return this.stats();
    }
    frame() {
        return this.records.map(r => {
            const positions = this.geometry.get(r.supportId), a = positions[r.segment], b = positions[r.segment + 1];
            const liquid = this.chemistry.cell(r.index), state = this.steel.get(r.index), wood = state ? null : this.wood.cell(r.id, { faces: false });
            const strengthFraction = state ? (state.conserved.speciesMassKg['species:Fe'] ?? 0) / r.initialIronKg : wood.strengthFraction;
            return { id: r.supportId, segment: r.segment, index: r.index, material: r.definition.material, a: [...a], b: [...b], position: midpoint(a, b),
                radiusM: r.definition.radiusM, strengthFraction, broken: this.broken.has(r.index),
                remainingRadiusM: r.definition.radiusM * Math.sqrt(state ? mass(state) / r.initialSteelKg : Math.max(0, wood.virginKg + wood.charKg + wood.ashKg) / wood.initialDryMassKg),
                massKg: (state ? mass(state) : wood.remainingMassKg) + liquid.oilKg + liquid.aqueousMassKg,
                temperatureK: wood ? wood.temperatureK : this._temperature(r), waterKg: liquid.waterKg + (wood?.waterKg ?? 0), oilKg: liquid.oilKg, acidHClKg: liquid.acidHClKg,
                charFraction: wood ? wood.charKg / wood.initialDryMassKg : 0, ironLossFraction: state ? 1 - strengthFraction : 0,
                volatileKgPerSecond: wood?.volatileRateKgPerSecond ?? 0, steamKgPerSecond: (wood?.steamRateKgPerSecond ?? 0) + this.chemistry.evaporationRates[r.index],
                gasHeatW: (wood?.gasHeatW ?? 0) + (wood?.gasSensibleW ?? 0) + Math.max(0, this.chemistry.gasSourceRates[r.index * 2] - this.plumeReturnedW[r.index]),
                woodGasHeatW: (wood?.gasHeatW ?? 0) + (wood?.gasSensibleW ?? 0),
                oilGasHeatW: Math.max(0, this.chemistry.gasSourceRates[r.index * 2] - this.plumeReturnedW[r.index]),
                oilProductKgPerSecond: this.chemistry.gasSourceRates[r.index * 2 + 1],
                oilBurnKgPerSecond: liquid.oilBurnKgPerSecond, hydrogenKgPerSecond: this.hydrogenRates[r.index] };
        });
    }
    loads() {
        const liquid = {};
        return [...this.byId].map(([id, { definition: d, start }]) => {
            const rows = this.records.slice(start, start + this.segments).map(r => {
                const state = this.steel.get(r.index), wood = state ? null : this.wood.cell(r.id, { faces: false });
                this.chemistry.phaseGeometry(r.index, liquid);
                return { segment: r.segment, strengthFraction: state ? (state.conserved.speciesMassKg['species:Fe'] ?? 0) / r.initialIronKg : wood.strengthFraction,
                    broken: this.broken.has(r.index), massKg: (state ? mass(state) : wood.remainingMassKg) + liquid.oilKg + liquid.aqueousMassKg };
            });
            let weakest = rows[0]; for (const row of rows) if (row.strengthFraction < weakest.strengthFraction) weakest = row;
            const broken = rows.some(row => row.broken);
            return { id, domain: d.domain, cellIndex: d.cellIndex, massKg: rows.reduce((sum, row) => sum + row.massKg, 0),
                strengthFraction: weakest.strengthFraction, breakingForceN: broken ? 0 : d.breakingForceN * weakest.strengthFraction,
                weakestSegment: weakest.segment, broken, brokenSegments: rows.filter(row => row.broken).map(row => row.segment) };
        });
    }
    stats() {
        const chemical = this.chemistry.stats(), wood = this.wood?.totals(), l = this.ledger;
        const steelMassKg = [...this.steel.values()].reduce((sum, state) => sum + mass(state), 0);
        const steelEnergyJ = [...this.steel.values()].reduce((sum, state) => sum + state.conserved.internalEnergyJ, 0);
        const sl = this.chemistry.supportLedger;
        const waterOwners = [...this.chemistry.states.values(), this.chemistry.gas, this.chemistry.disposal, this.chemistry.outflow, this.chemistry.absorbed];
        const trackedWater = waterOwners.reduce((sum, state) => sum + (state.conserved.speciesMassKg['species:H2O'] ?? 0), 0);
        let initialFiberWater = 0, fiberWater = 0;
        if (this.wood) for (const r of this.records) if (r.definition.material === P.fiber) {
            const cell = this.wood.cell(r.id, { faces: false }); initialFiberWater += cell.initialDryMassKg * .12; fiberWater += cell.waterKg;
        }
        const cl = this.chemistry.ledger;
        return { supports: this.byId.size, segments: this.records.length, brokenSegments: this.broken.size, timeSeconds: this.timeSeconds,
            massResidualKg: chemical.chemicalMassResidualKg + (wood?.massResidualKg ?? 0) + l.initialSteelKg - steelMassKg - sl.ironAddedKg,
            energyResidualJ: chemical.chemicalEnergyResidualJ + (wood?.energyResidualJ ?? 0) + l.initialSteelEnergyJ + l.steelExternalHeatJ - steelEnergyJ - sl.ironAddedEnergyJ,
            waterResidualKg: cl.externalWaterAddedKg + cl.acidWaterAddedKg + cl.waterProducedKg + sl.exchangedWaterKg - trackedWater
                + initialFiberWater + (wood?.externalWaterKg ?? 0) - fiberWater - (wood?.steamKg ?? 0),
            steelMassKg, ironConsumedKg: sl.ironConsumedKg, hydrogenProducedKg: sl.hydrogenProducedKg, chemical, wood,
            assumptions: [P.scope, SURFACE_IRON_PROFILE.scope] };
    }
    snapshot() {
        return { schema: 'engine.surface-supports', version: 1, definitionHash: this.definitionHash, segments: this.segments,
            definitions: cloneStrictJson(this.definitions), chemistry: this.chemistry.snapshot(), wood: this.wood?.snapshot() ?? null,
            steel: [...this.steel].map(([index, state]) => ({ index, state })), broken: [...this.broken].sort((a, b) => a - b),
            geometry: [...this.geometry].map(([id, positions]) => ({ id, positions: positions.map(p => [...p]) })),
            ledger: { ...this.ledger }, steps: this.steps, timeSeconds: this.timeSeconds, lastDt: this.lastDt, hydrogenRates: [...this.hydrogenRates], plumeReturnedW: [...this.plumeReturnedW] };
    }
    restore(input) {
        const snapshot = cloneStrictJson(input, '$.surfaceSupportSnapshot');
        if (snapshot.schema !== 'engine.surface-supports' || snapshot.version !== 1 || snapshot.definitionHash !== this.definitionHash) throw new RangeError('Incompatible support snapshot');
        const candidate = new SurfaceFieldSupports({ supports: snapshot.definitions, segments: snapshot.segments });
        if (candidate.definitionHash !== this.definitionHash || !Array.isArray(snapshot.broken) || !Array.isArray(snapshot.steel)
            || snapshot.steel.length !== candidate.steel.size || !Number.isSafeInteger(snapshot.steps) || snapshot.steps < 0) throw new RangeError('Invalid support ownership snapshot');
        candidate.chemistry.restore(snapshot.chemistry);
        if (candidate.wood) {
            const initial = candidate.wood.snapshot();
            for (const key of ['surfaceLayerM', 'charHeatToSolidFraction', 'oxygenPenetrationM', 'allowThinCells']) {
                if (snapshot.wood?.[key] !== initial[key]) throw new RangeError('Changed fiber thermal closure');
            }
            if (!Array.isArray(snapshot.wood.cells) || snapshot.wood.cells.length !== initial.cells.length
                || snapshot.wood.cells.some((cell, i) => cell.id !== initial.cells[i].id || cell.initialDryMassKg !== initial.cells[i].initialDryMassKg
                    || cell.thermalAxis !== initial.cells[i].thermalAxis || JSON.stringify(cell.dimensionsM) !== JSON.stringify(initial.cells[i].dimensionsM))) throw new RangeError('Changed fiber material geometry');
            candidate.wood.restore(snapshot.wood);
        } else if (snapshot.wood !== null) throw new RangeError('Unexpected fiber owner');
        const seen = new Set();
        for (const entry of snapshot.steel) {
            const original = candidate.steel.get(entry.index), state = createMatterState(entry.state);
            if (!original || seen.has(entry.index) || state.regionId !== original.regionId || state.definitionHash !== original.definitionHash
                || state.definitionId !== original.definitionId || JSON.stringify(state.representation) !== JSON.stringify(original.representation)
                || JSON.stringify(state.ancestry) !== JSON.stringify(original.ancestry) || state.conserved.electricChargeC !== 0 || state.conserved.momentumKgMPerS.some(v => v !== 0)
                || Object.keys(state.conserved.speciesMassKg).some(key => !['species:Fe', 'species:C'].includes(key))
                || state.conserved.speciesMassKg['species:C'] !== original.conserved.speciesMassKg['species:C']
                || (state.conserved.speciesMassKg['species:Fe'] ?? 0) > original.conserved.speciesMassKg['species:Fe']
                || state.conserved.internalEnergyJ < mass(state) * P.steelCpJPerKgK * (1 - 1e-9)
                || state.conserved.internalEnergyJ > mass(state) * P.steelCpJPerKgK * 5000 * (1 + 1e-9)) throw new RangeError('Invalid retained steel owner');
            seen.add(entry.index); candidate.steel.set(entry.index, state);
        }
        for (const index of snapshot.broken) {
            if (!Number.isInteger(index) || index < 0 || index >= candidate.records.length || candidate.broken.has(index)) throw new RangeError('Invalid severed support segment');
            candidate.broken.add(index);
        }
        if (!Array.isArray(snapshot.geometry) || snapshot.geometry.length !== candidate.byId.size) throw new RangeError('Missing support geometry');
        const geometryIds = new Set();
        for (const g of snapshot.geometry) {
            if (!candidate.byId.has(g.id) || geometryIds.has(g.id) || !Array.isArray(g.positions) || g.positions.length !== candidate.segments + 1) throw new RangeError('Invalid restored support geometry');
            geometryIds.add(g.id); candidate.geometry.set(g.id, g.positions.map(p => vector(p, 'restored position')));
        }
        for (const key of Object.keys(candidate.ledger)) candidate.ledger[key] = finite(snapshot.ledger?.[key], `ledger ${key}`, key === 'steelExternalHeatJ' ? -1e30 : 0, 1e30);
        if (candidate.ledger.initialSteelKg !== this.ledger.initialSteelKg || candidate.ledger.initialSteelEnergyJ !== this.ledger.initialSteelEnergyJ) throw new RangeError('Changed initial steel inventory');
        candidate.steps = snapshot.steps; candidate.timeSeconds = finite(snapshot.timeSeconds, 'restored clock', 0, 1e30); candidate.lastDt = finite(snapshot.lastDt, 'restored step', 0, .25);
        if (candidate.chemistry.steps !== candidate.steps || candidate.chemistry.timeSeconds !== candidate.timeSeconds || candidate.wood && (candidate.wood.steps !== candidate.steps || candidate.wood.timeSeconds !== candidate.timeSeconds)
            || !Array.isArray(snapshot.hydrogenRates) || snapshot.hydrogenRates.length !== candidate.records.length) throw new RangeError('Support clocks/rates disagree');
        if (!Array.isArray(snapshot.plumeReturnedW) || snapshot.plumeReturnedW.length !== candidate.records.length) throw new RangeError('Invalid retained plume heat');
        candidate.plumeReturnedW.set(snapshot.plumeReturnedW.map(v => finite(v, 'plume return')));
        candidate.hydrogenRates.set(snapshot.hydrogenRates.map(v => finite(v, 'hydrogen rate'))); candidate._connectionKey = null; candidate._connect();
        const stats = candidate.stats();
        if (Math.abs(stats.massResidualKg) > 1e-8 || Math.abs(stats.energyResidualJ) > 1e-4) throw new RangeError('Support snapshot does not conserve matter/energy');
        Object.assign(this, candidate); return this;
    }
    dispose() { this.chemistry.dispose(); this.steel.clear(); this.byId.clear(); this.geometry.clear(); this.broken.clear(); this.records.length = 0; this.wood = null; }
}
