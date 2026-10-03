// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { UnionFind } from '../../core/math/UnionFind.js';
import { AVOGADRO, BOLTZMANN, STEFAN_BOLTZMANN } from '../../core/math/MathConstants.js';
import { PINE_FIRE_MATERIAL as M, WOOD_FIRE_CLOSURE as C } from './WoodFireMaterial.js';
export { PINE_FIRE_MATERIAL, WOOD_FIRE_CLOSURE } from './WoodFireMaterial.js';

const R = AVOGADRO * BOLTZMANN, knots = M.temperatureKnotsK, species = ['wood', 'char', 'ash'];
const finite = (value, name, min = 0, max = Infinity) => {
    if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`${name} must be finite in [${min}, ${max}]`);
    return value;
};
const record = (value, name) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
    return value;
};
const faceIndex = face => {
    if (!Number.isInteger(face) || face < 0 || face > 5) throw new RangeError('Face must be -X,+X,-Y,+Y,-Z,+Z index0–5');
    return face;
};
function rampInterval(temperature) {
    if (temperature <= knots[0]) return 0;
    for (let i = 1; i < knots.length; i++) if (temperature < knots[i]) return i;
    return knots.length;
}
function ramp(values, temperature, interval) {
    if (interval === 0) return values[0];
    if (interval < knots.length) return values[interval - 1] + (values[interval] - values[interval - 1])
        * (temperature - knots[interval - 1]) / (knots[interval] - knots[interval - 1]);
    return values.at(-1);
}
function specificEnergy(values, temperature) {
    if (temperature <= knots[0]) return values[0] * (temperature - knots[0]);
    let energy = 0;
    for (let i = 1; i < knots.length; i++) {
        const delta = Math.min(temperature, knots[i]) - knots[i - 1];
        energy += delta * (values[i - 1] + .5 * (values[i] - values[i - 1]) * delta / (knots[i] - knots[i - 1]));
        if (temperature <= knots[i]) return energy;
    }
    return energy + values.at(-1) * (temperature - knots.at(-1));
}
function capacity(layer, interval) {
    const temperature = layer.temperatureK;
    return layer.water * C.waterHeatCapacityJPerKgK
        + layer.wood * ramp(M.wood.heatCapacity, temperature, interval)
        + layer.char * ramp(M.char.heatCapacity, temperature, interval)
        + layer.ash * ramp(M.ash.heatCapacity, temperature, interval);
}
function capacityAtKnot(layer, index) {
    // At a tabulated knot ramp() returns these exact values. Preserve the
    // species summation order without re-searching the same fixed interval.
    return layer.water * C.waterHeatCapacityJPerKgK
        + layer.wood * M.wood.heatCapacity[index]
        + layer.char * M.char.heatCapacity[index]
        + layer.ash * M.ash.heatCapacity[index];
}
// The material table is immutable. Evaluate repeated physical boundary values
// through the original integral once, retaining its binary64 arithmetic.
const boundaryEnergies = new Map([1, C.waterBoilingK, 5000].map(temperature => [temperature,
    Object.freeze(species.map(name => specificEnergy(M[name].heatCapacity, temperature)))]));
function energyAt(layer, temperature) {
    const boundary = boundaryEnergies.get(temperature);
    return species.reduce((sum, name, index) => sum + layer[name] * (boundary ? boundary[index] : specificEnergy(M[name].heatCapacity, temperature)),
        layer.water * C.waterHeatCapacityJPerKgK * (temperature - C.referenceTemperatureK));
}
function temperatureAt(layer) {
    // Knot capacities depend on composition alone. Key every constituent so
    // reactions, added water/pine and restored layers invalidate implicitly.
    const cache = layer._temperatureCache ??= { capacities: new Float64Array(knots.length), revisions: new Uint32Array(knots.length), revision: 0, wood: NaN };
    if (cache.wood !== layer.wood || cache.char !== layer.char || cache.ash !== layer.ash || cache.water !== layer.water) {
        cache.wood = layer.wood; cache.char = layer.char; cache.ash = layer.ash; cache.water = layer.water;
        cache.revision = (cache.revision + 1) >>> 0;
        if (cache.revision === 0) { cache.revisions.fill(0); cache.revision = 1; }
        cache.energyJ = NaN;
    }
    if (cache.energyJ === layer.energyJ) return cache.temperatureK;
    const capacities = cache.capacities;
    let remaining = layer.energyJ, lo = knots[0], cp = capacities[0], temperature;
    if (cache.revisions[0] !== cache.revision) { cp = capacities[0] = capacityAtKnot(layer, 0); cache.revisions[0] = cache.revision; }
    if (remaining <= 0) temperature = lo + remaining / cp;
    else {
        for (let i = 1; i < knots.length; i++) {
            const hi = knots[i];
            let cpHi = capacities[i];
            if (cache.revisions[i] !== cache.revision) { cpHi = capacities[i] = capacityAtKnot(layer, i); cache.revisions[i] = cache.revision; }
            const width = hi - lo, intervalEnergy = .5 * (cp + cpHi) * width;
            if (remaining <= intervalEnergy) {
                const slope = (cpHi - cp) / width;
                temperature = lo + 2 * remaining / (cp + Math.sqrt(cp * cp + 2 * slope * remaining));
                break;
            }
            remaining -= intervalEnergy; lo = hi; cp = cpHi;
        }
        if (temperature === undefined) temperature = lo + remaining / cp;
    }
    cache.energyJ = layer.energyJ; cache.temperatureK = temperature;
    return temperature;
}
function meanCellTemperature(cell, remainingMassKg) {
    if (remainingMassKg === undefined) {
        const sum = key => cell.layers.reduce((total, layer) => total + layer[key], 0);
        remainingMassKg = sum('wood') + sum('char') + sum('ash') + sum('water');
    }
    return cell.layers.reduce((total, layer) => total + layer.temperatureK * (layer.wood + layer.char + layer.ash + layer.water), 0) / remainingMassKg;
}
const faceTemperature = face => face.entries.reduce((value, entry) => value + entry.layer.temperatureK * entry.weight, 0);
function conductivity(layer, interval) {
    const solid = layer.wood + layer.char + layer.ash;
    return (0 + layer.wood * ramp(M.wood.conductivity, layer.temperatureK, interval)
        + layer.char * ramp(M.char.conductivity, layer.temperatureK, interval)
        + layer.ash * ramp(M.ash.conductivity, layer.temperatureK, interval)) / solid;
}
function layerWidths(depth, surfaceLayer, growth) {
    const edge = [];
    let remainder = depth, width = Math.min(surfaceLayer, depth / 2);
    while (remainder > 2 * width * 1.5) { edge.push(width); remainder -= 2 * width; width *= growth; }
    return [...edge, remainder / 2, remainder / 2, ...edge.toReversed()];
}
function depletion(mass, referenceMass, reaction, temperature, oxygen, dt, oxygenFactor = reaction.oxygenOrder ? oxygen ** reaction.oxygenOrder : 1) {
    if (!(mass > 0)) return 0;
    const k = reaction.preExponentialPerSecond * Math.exp(-reaction.activationJPerMol / (R * temperature))
        * oxygenFactor;
    if (k === 0) return 0;
    const fraction = mass / referenceMass, power = 1 - reaction.order;
    const remainder = Math.max(0, fraction ** power - power * k * dt);
    // This is the exact identity 1**p=1 and m-m=+0, not a rate cutoff.
    if (mass === referenceMass && remainder === 1) return 0;
    return Math.max(0, Math.min(mass, mass - referenceMass * remainder ** (1 / power)));
}
function reactionRate(mass, referenceMass, reaction, temperature, oxygen, oxygenFactor = reaction.oxygenOrder ? oxygen ** reaction.oxygenOrder : 1) {
    return mass > 0 ? referenceMass * reaction.preExponentialPerSecond * Math.exp(-reaction.activationJPerMol / (R * temperature))
        * (mass / referenceMass) ** reaction.order * oxygenFactor : 0;
}

/** Reduced, porous pine solid in SI units; no gas flame or rigid-body solver.
 * Each authored cell owns symmetric graded finite-volume layers along one
 * axis. Side-face heating is spread across their actual areas. Internal and
 * inter-cell conduction is conservative; it is not a full3D solid heat PDE.
 * Properties hold their tabulated end values outside293.15–1473.15K.
 * Pyrolysis exports finite fuel; atmospheric char oxidation exports CO2 and
 * heat. Returned gas is a ledger obligation for the consuming Flow adapter.
 * Remaining char/ash never disappears or receives invented fracture impulses.
 * integrationMode defaults to global adaptive timesteps. The explicit
 * components mode uses the same integrator independently for each connected
 * graph of all internal and contact edges. It saves as version2; legacy
 * version1 snapshots restore global integration regardless of constructor mode.
 */
export class WoodCombustion {
    constructor({ cells, connections = [], surfaceLayerM = C.surfaceLayerM,
        charHeatToSolidFraction = C.charHeatToSolidFraction, oxygenPenetrationM = C.oxygenPenetrationM, allowThinCells = false, integrationMode = 'global' } = {}) {
        if (!Array.isArray(cells) || !cells.length) throw new RangeError('Wood model needs persistent cells');
        this.surfaceLayerM = finite(surfaceLayerM, 'Surface layer thickness', .00001);
        this.charHeatToSolidFraction = finite(charHeatToSolidFraction, 'Solid heat retention', 0, 1);
        this.oxygenPenetrationM = finite(oxygenPenetrationM, 'Oxygen penetration', .000001);
        if (typeof allowThinCells !== 'boolean') throw new TypeError('Thin-cell opt-in must be boolean');
        this.allowThinCells = allowThinCells;
        if (integrationMode !== 'global' && integrationMode !== 'components') throw new RangeError('Wood integration mode must be global or components');
        this.integrationMode = integrationMode;
        this._cells = new Map(); this._layers = []; this._internalEdges = [];
        this.timeSeconds = 0; this.steps = 0; this.lastDt = 0;
        this.ledger = { initialSolidMassKg: 0, initialEnergyJ: 0, volatileKg: 0, steamKg: 0, co2Kg: 0,
            oxygenConsumedKg: 0, convectionJ: 0, radiationJ: 0, pyrolysisJ: 0, charReactionJ: 0,
            gasSensibleJ: 0, gasReactionHeatJ: 0, steamLatentJ: 0 };
        for (const input of cells) this._addCell(input);
        this.setConnections(connections);
    }
    _addCell(input) {
        record(input, 'Wood cell');
        const { id, dimensionsM } = input;
        if (!(typeof id === 'string' && id.length || Number.isSafeInteger(id)) || this._cells.has(id)) throw new RangeError('Cell ids must be unique strings or integers');
        if (!Array.isArray(dimensionsM) || dimensionsM.length !== 3) throw new RangeError('Wood cell needs3 dimensions');
        const dimensions = dimensionsM.map(value => finite(value, 'Cell dimension', this.allowThinCells ? 1e-12 : .00001, 100));
        const volume = dimensions.reduce((a, b) => a * b, 1);
        if (input.volumeM3 !== undefined && Math.abs(finite(input.volumeM3, 'Cell volume', Number.MIN_VALUE) - volume) > volume * 1e-8)
            throw new RangeError('Cell volume does not match its box dimensions');
        const axis = input.thermalAxis ?? dimensions.indexOf(Math.min(...dimensions));
        if (!Number.isInteger(axis) || axis < 0 || axis > 2) throw new RangeError('Thermal axis must be0,1,2');
        const moisture = finite(input.moistureDryBasis ?? .12, 'Dry-basis moisture', 0, 5);
        const temperatureK = finite(input.initialTemperatureK ?? C.referenceTemperatureK, 'Initial temperature', 1, 5000);
        const widths = this.allowThinCells && dimensions[axis] < 2 * this.surfaceLayerM ? [dimensions[axis]] : layerWidths(dimensions[axis], this.surfaceLayerM, C.layerGrowth), area = volume / dimensions[axis];
        const cell = { id, dimensions, axis, volumeM3: volume, initialDryMassKg: volume * M.dryDensityKgM3,
            layers: [], faces: [], stepVolatileKg: 0, stepSteamKg: 0, stepCO2Kg: 0, stepGasHeatJ: 0,
            stepGasSensibleJ: 0, stepSteamLatentJ: 0 };
        let coordinate = 0;
        for (const width of widths) {
            const wood = width * area * M.dryDensityKgM3;
            const layer = { index: this._layers.length, cell, width, center: coordinate + width / 2,
                initialWood: wood, wood, char: 0, ash: 0, water: wood * moisture, temperatureK,
                energyJ: 0, oxygen: 0, stepVolatileKg: 0 };
            layer.energyJ = energyAt(layer, temperatureK);
            this._layers.push(layer); cell.layers.push(layer); coordinate += width;
            this.ledger.initialSolidMassKg += wood + layer.water; this.ledger.initialEnergyJ += layer.energyJ;
        }
        for (let i = 1; i < cell.layers.length; i++) this._internalEdges.push({ a: cell.layers[i - 1], b: cell.layers[i], area,
            distanceA: cell.layers[i - 1].width / 2, distanceB: cell.layers[i].width / 2, contactResistance: 0 });
        for (let face = 0; face < 6; face++) {
            const faceAxis = face >> 1, fullArea = volume / dimensions[faceAxis];
            const entries = faceAxis === axis ? [{ layer: cell.layers[face & 1 ? cell.layers.length - 1 : 0], weight: 1 }]
                : cell.layers.map(layer => ({ layer, weight: layer.width / dimensions[axis] }));
            cell.faces.push({ face, area: fullArea, entries });
        }
        cell.initialDryMassKg = cell.layers.reduce((sum, layer) => sum + layer.initialWood, 0);
        this._cells.set(id, cell);
    }
    /** Replace only thermal interfaces after native separation; thermal state
     * remains attached to the same cell ids. Validate fully before committing. */
    setConnections(connections) {
        if (!Array.isArray(connections)) throw new TypeError('Thermal connections must be an array');
        const coverage = new Map([...this._cells].map(([id]) => [id, new Float64Array(6)])), edges = [];
        for (const link of connections) {
            record(link, 'Thermal connection');
            const a = this._cells.get(link.a), b = this._cells.get(link.b);
            if (!a || !b || a === b) throw new RangeError('Thermal connection needs two distinct owned cells');
            if (a.residueSurfaceAreaM2 || b.residueSurfaceAreaM2) throw new RangeError('Isolated residue cannot reconnect as a wood panel');
            const faceA = a.faces[faceIndex(link.faceA)], faceB = b.faces[faceIndex(link.faceB)];
            const area = finite(link.areaM2, 'Thermal contact area', Number.MIN_VALUE);
            const transfer = finite(link.contactConductanceWPerM2K ?? 1000, 'Thermal contact conductance', Number.MIN_VALUE);
            for (const [cell, face] of [[a, faceA], [b, faceB]]) {
                coverage.get(cell.id)[face.face] += area;
                if (coverage.get(cell.id)[face.face] > face.area * (1 + 1e-8)) throw new RangeError('Connected areas exceed cell face');
            }
            for (const left of faceA.entries) for (const right of faceB.entries) edges.push({ a: left.layer, b: right.layer,
                area: area * left.weight * right.weight, distanceA: this._faceDistance(a, left.layer, faceA.face),
                distanceB: this._faceDistance(b, right.layer, faceB.face), contactResistance: 1 / transfer });
        }
        this._coverage = coverage; this._edges = [...this._internalEdges, ...edges];
        this._connections = connections.map(link => ({ ...link }));
    }
    /** Convert a fully spent, isolated cell to a lumped ash grain without
     * losing its mass or stored heat. The caller supplies its physical area. */
    setResidueSurface(id, { surfaceAreaM2 } = {}) {
        const cell = this._cells.get(id);
        if (!cell) throw new RangeError('Unknown wood cell');
        finite(surfaceAreaM2, 'Residue surface area', Number.MIN_VALUE);
        if (!this.cell(id).ashConversionReady) throw new RangeError('Only completely spent wood can become an ash grain');
        if (this._coverage.get(id).some(area => area > 0)) throw new RangeError('Residue must be thermally disconnected before conversion');
        const sum = key => cell.layers.reduce((total, layer) => total + layer[key], 0);
        const radius = Math.sqrt(surfaceAreaM2 / (4 * Math.PI));
        const layer = { index: 0, cell, width: 2 * radius, center: radius, initialWood: sum('initialWood'),
            wood: 0, char: 0, ash: sum('ash'), water: 0, energyJ: sum('energyJ'), oxygen: 0,
            stepVolatileKg: 0, temperatureK: 0 };
        layer.temperatureK = temperatureAt(layer);
        if (!(layer.temperatureK > 0) || !Number.isFinite(layer.temperatureK)) throw new RangeError('Residue energy cannot form a positive-temperature grain');
        cell.layers = [layer]; cell.residueSurfaceAreaM2 = surfaceAreaM2; cell.residueRadiusM = radius;
        cell.faces = Array.from({ length: 6 }, (_, face) => ({ face, area: surfaceAreaM2 / 6, entries: [{ layer, weight: 1 }] }));
        this._layers = [...this._cells.values()].flatMap(owned => owned.layers);
        this._layers.forEach((owned, index) => { owned.index = index; });
        this._internalEdges = this._internalEdges.filter(edge => edge.a.cell !== cell);
        this._edges = this._edges.filter(edge => edge.a.cell !== cell && edge.b.cell !== cell);
        return this.cell(id);
    }
    _faceDistance(cell, layer, face) {
        if (cell.residueSurfaceAreaM2) return cell.residueRadiusM;
        return (face >> 1) === cell.axis ? layer.width / 2 : cell.dimensions[face >> 1] / 2;
    }
    _boundaries({ faces = [], ambientTemperatureK = C.referenceTemperatureK } = {}) {
        finite(ambientTemperatureK, 'Ambient temperature', 1, 5000);
        if (!Array.isArray(faces)) throw new TypeError('Face exposure must be an array');
        const overrides = new Map();
        for (const input of faces) {
            record(input, 'Face exposure'); const cell = this._cells.get(input.cellId), face = faceIndex(input.face);
            if (!cell) throw new RangeError('Exposure references an unknown cell');
            if (!overrides.has(cell)) overrides.set(cell, new Map());
            if (overrides.get(cell).has(face)) throw new RangeError('Duplicate face exposure');
            const area = Math.max(0, cell.faces[face].area - this._coverage.get(cell.id)[face]);
            overrides.get(cell).set(face, {
                area: finite(input.exposedAreaM2 ?? area, 'Exposed area', 0, area * (1 + 1e-8)),
                gasTemperatureK: finite(input.gasTemperatureK ?? ambientTemperatureK, 'Gas temperature', 1, 5000),
                radiantTemperatureK: finite(input.radiantTemperatureK ?? ambientTemperatureK, 'Radiant temperature', 1, 5000),
                h: finite(input.heatTransferWPerM2K ?? C.ambientHeatTransferWPerM2K, 'Convective transfer', 0, 1e6),
                incident: finite(input.incidentRadiationWPerM2 ?? 0, 'Incident radiation', 0, 1e9),
                oxygen: finite(input.oxygenAvailability ?? 1, 'Oxygen availability', 0, 1),
            });
        }
        const boundaries = [];
        for (const layer of this._layers) layer.oxygen = 0;
        for (const cell of this._cells.values()) for (const face of cell.faces) {
            const exposure = overrides.get(cell)?.get(face.face) ?? { area: Math.max(0, face.area - this._coverage.get(cell.id)[face.face]),
                gasTemperatureK: ambientTemperatureK, radiantTemperatureK: ambientTemperatureK,
                h: C.ambientHeatTransferWPerM2K, incident: 0, oxygen: 1 };
            for (const item of face.entries) if (exposure.area > 0) boundaries.push({ ...exposure, area: exposure.area * item.weight,
                layer: item.layer, face: face.face, distance: this._faceDistance(cell, item.layer, face.face) });
            for (const layer of cell.layers) {
                const depth = (face.face >> 1) === cell.axis ? (face.face & 1 ? cell.dimensions[cell.axis] - layer.center : layer.center)
                    : cell.dimensions[face.face >> 1] / 2;
                layer.oxygen = Math.max(layer.oxygen, exposure.oxygen * Math.min(1, exposure.area / face.area)
                    * Math.exp(-depth / this.oxygenPenetrationM) * M.atmosphericOxygenMassFraction);
            }
        }
        return boundaries;
    }
    _integrateThermalGroup(dt, activeLayers, activeBoundaries, activeEdgeIds, activeEdgeValues, work) {
        const { power, conductance, capacities, conductivities, temperatures, cubed, fourth, oxidativeOxygen, charOxygen } = work;
        const activeEdgeCount = activeEdgeIds.length / 2;
        let remaining = dt, componentSubsteps = 0;
        while (remaining > dt * 1e-13) {
            if (++componentSubsteps > 200000) throw new Error('Wood thermal integration failed to advance within its numerical budget');
            power.fill(0); conductance.fill(0);
            let convectionW = 0, radiationW = 0, subDt = Math.min(remaining, .05);
            // All transport reads the same layer state until this substep's
            // energy/reaction update, so shared endpoints reuse exact values.
            for (const layer of activeLayers) {
                const interval = rampInterval(layer.temperatureK);
                capacities[layer.index] = capacity(layer, interval);
                conductivities[layer.index] = conductivity(layer, interval);
                temperatures[layer.index] = layer.temperatureK;
                cubed[layer.index] = layer.temperatureK ** 3; fourth[layer.index] = layer.temperatureK ** 4;
            }
            for (let i = 0; i < activeEdgeCount; i++) {
                const a = activeEdgeIds[i * 2], b = activeEdgeIds[i * 2 + 1], j = i * 4;
                const g = activeEdgeValues[j] / (activeEdgeValues[j + 1] / conductivities[a] + activeEdgeValues[j + 2] / conductivities[b] + activeEdgeValues[j + 3]);
                const flow = g * (temperatures[b] - temperatures[a]);
                power[a] += flow; power[b] -= flow;
                conductance[a] += g; conductance[b] += g;
            }
            for (const boundary of activeBoundaries) {
                const layer = boundary.layer, t = layer.temperatureK, area = boundary.area;
                const h = boundary.h > 0 ? 1 / (1 / boundary.h + boundary.distance / conductivities[layer.index]) : 0;
                const convection = area * h * (boundary.gasTemperatureK - t);
                const radiation = area * C.emissivity * (boundary.incident + STEFAN_BOLTZMANN * (boundary.radiantFourth - fourth[layer.index]));
                boundary.heatW = convection + radiation;
                power[layer.index] += convection + radiation; convectionW += convection; radiationW += radiation;
                conductance[layer.index] += area * (h + 4 * C.emissivity * STEFAN_BOLTZMANN * cubed[layer.index]);
            }
            for (const layer of activeLayers) {
                const i = layer.index, cp = capacities[i];
                if (conductance[i] > 0) subDt = Math.min(subDt, .2 * cp / conductance[i]);
                if (power[i] !== 0) subDt = Math.min(subDt, 20 * cp / Math.abs(power[i]));
                const charRate = reactionRate(layer.char, layer.initialWood * M.charYield, M.charOxidation, layer.temperatureK, layer.oxygen, charOxygen[i]);
                if (charRate > 0) subDt = Math.min(subDt, 20 * cp / (charRate * M.charOxidationJPerKg * Math.max(.001, this.charHeatToSolidFraction)));
            }
            if (!(subDt > 0) || !Number.isFinite(subDt)) throw new Error('Nonfinite wood thermal timestep');
            this.ledger.convectionJ += convectionW * subDt; this.ledger.radiationJ += radiationW * subDt;
            for (const boundary of activeBoundaries) boundary.layer.cell.stepFaceBoundaryHeatJ[boundary.face] += boundary.heatW * subDt;
            for (const layer of activeLayers) {
                layer.energyJ += power[layer.index] * subDt;
                layer.temperatureK = temperatureAt(layer);
                this._react(layer, subDt, oxidativeOxygen[layer.index], charOxygen[layer.index]);
                layer.temperatureK = temperatureAt(layer);
                if (!(layer.temperatureK > 0) || !Number.isFinite(layer.temperatureK)) throw new Error('Wood energy left the positive-temperature domain');
            }
            remaining -= subDt;
        }
        return componentSubsteps;
    }
    _thermalGroups(boundaries) {
        if (this.integrationMode === 'global') return [{ layers: this._layers, edges: null, boundaries }];
        const graph = new UnionFind(this._layers.length);
        for (const edge of this._edges) graph.union(edge.a.index, edge.b.index);
        const groups = new Map();
        for (const layer of this._layers) {
            const root = graph.find(layer.index);
            let group = groups.get(root);
            if (!group) { group = { layers: [], edges: [], boundaries: [] }; groups.set(root, group); }
            group.layers.push(layer);
        }
        for (let index = 0; index < this._edges.length; index++) groups.get(graph.find(this._edges[index].a.index)).edges.push(index);
        for (const boundary of boundaries) groups.get(graph.find(boundary.layer.index)).boundaries.push(boundary);
        return [...groups.values()];
    }
    step(dt, exposure = {}) {
        finite(dt, 'Wood timestep', Number.MIN_VALUE, 60); record(exposure, 'Wood exposure');
        const previousCoverage = this._coverage, previousEdges = this._edges, previousConnections = this._connections;
        let boundaries;
        try {
            if (exposure.connections !== undefined) this.setConnections(exposure.connections);
            boundaries = this._boundaries(exposure);
        } catch (error) { this._coverage = previousCoverage; this._edges = previousEdges; this._connections = previousConnections; throw error; }
        const count = this._layers.length;
        const exposedAreas = new Map([...this._cells.keys()].map(id => [id, new Float64Array(6)]));
        for (const boundary of boundaries) exposedAreas.get(boundary.layer.cell.id)[boundary.face] += boundary.area;
        const power = new Float64Array(count), conductance = new Float64Array(count), capacities = new Float64Array(count), conductivities = new Float64Array(count);
        const temperatures = new Float64Array(count), cubed = new Float64Array(count), fourth = new Float64Array(count);
        const oxidativeOxygen = new Float64Array(count), charOxygen = new Float64Array(count);
        for (const layer of this._layers) {
            oxidativeOxygen[layer.index] = layer.oxygen ** M.oxidativePyrolysis.oxygenOrder;
            charOxygen[layer.index] = layer.oxygen ** M.charOxidation.oxygenOrder;
        }
        for (const boundary of boundaries) boundary.radiantFourth = boundary.radiantTemperatureK ** 4;
        const edgeCount = this._edges.length;
        if (this._edgeIds?.length !== edgeCount * 2) { this._edgeIds = new Uint32Array(edgeCount * 2); this._edgeValues = new Float64Array(edgeCount * 4); }
        const edgeIds = this._edgeIds, edgeValues = this._edgeValues;
        // Refresh from authoritative topology each outer step, including
        // restored, deposited and remeshed layers. Preserve edge ordering.
        for (let i = 0; i < edgeCount; i++) {
            const edge = this._edges[i], j = i * 4;
            edgeIds[i * 2] = edge.a.index; edgeIds[i * 2 + 1] = edge.b.index;
            edgeValues[j] = edge.area; edgeValues[j + 1] = edge.distanceA; edgeValues[j + 2] = edge.distanceB; edgeValues[j + 3] = edge.contactResistance;
        }
        for (const cell of this._cells.values()) {
            cell.stepVolatileKg = 0; cell.stepSteamKg = 0; cell.stepCO2Kg = 0; cell.stepGasHeatJ = 0;
            cell.stepGasSensibleJ = 0; cell.stepSteamLatentJ = 0;
            cell.stepFaceVolatileKg = new Float64Array(6);
            cell.stepFaceBoundaryHeatJ = new Float64Array(6);
        }
        for (const layer of this._layers) layer.stepVolatileKg = 0;
        let substeps = 0, maximumComponentSubsteps = 0;
        const groups = this._thermalGroups(boundaries);
        const work = { power, conductance, capacities, conductivities, temperatures, cubed, fourth, oxidativeOxygen, charOxygen };
        for (const group of groups) {
            const activeLayers = group.layers, activeBoundaries = group.boundaries, activeEdgeCount = group.edges?.length ?? edgeCount;
            let activeEdgeIds = edgeIds, activeEdgeValues = edgeValues;
            if (group.edges !== null) {
                activeEdgeIds = new Uint32Array(activeEdgeCount * 2); activeEdgeValues = new Float64Array(activeEdgeCount * 4);
                for (let index = 0; index < activeEdgeCount; index++) {
                    const source = group.edges[index];
                    activeEdgeIds[index * 2] = edgeIds[source * 2]; activeEdgeIds[index * 2 + 1] = edgeIds[source * 2 + 1];
                    for (let field = 0; field < 4; field++) activeEdgeValues[index * 4 + field] = edgeValues[source * 4 + field];
                }
            }
            const componentSubsteps = this._integrateThermalGroup(dt, activeLayers, activeBoundaries, activeEdgeIds, activeEdgeValues, work);
            substeps += componentSubsteps;
            maximumComponentSubsteps = Math.max(maximumComponentSubsteps, componentSubsteps);
        }
        for (const cell of this._cells.values()) {
            const area = exposedAreas.get(cell.id);
            for (const layer of cell.layers) {
                const weights = area.map((value, face) => {
                    const depth = (face >> 1) === cell.axis ? (face & 1 ? cell.dimensions[cell.axis] - layer.center : layer.center) : cell.dimensions[face >> 1] / 2;
                    return value / Math.max(.00001, depth);
                }), sum = weights.reduce((a, b) => a + b, 0);
                if (sum > 0) weights.forEach((weight, face) => { cell.stepFaceVolatileKg[face] += layer.stepVolatileKg * weight / sum; });
            }
        }
        this.timeSeconds += dt; this.lastDt = dt; this.steps++;
        return { timeSeconds: this.timeSeconds, substeps, ...(this.integrationMode === 'components' ? { componentCount: groups.length, maximumComponentSubsteps } : {}), ...this.totals() };
    }
    _react(layer, dt, oxidativeOxygen = layer.oxygen ** M.oxidativePyrolysis.oxygenOrder, charOxygen = layer.oxygen ** M.charOxidation.oxygenOrder) {
        const cell = layer.cell, ledger = this.ledger, reference = C.referenceTemperatureK;
        if (layer.energyJ <= 0 && layer.char === 0) return;
        if (layer.water > 0 && layer.temperatureK > C.waterBoilingK) {
            const evaporated = Math.min(layer.water, Math.max(0, layer.energyJ - energyAt(layer, C.waterBoilingK)) / C.waterLatentJPerKg);
            const sensible = evaporated * C.waterHeatCapacityJPerKgK * (C.waterBoilingK - reference);
            layer.water -= evaporated; layer.energyJ -= sensible + evaporated * C.waterLatentJPerKg;
            ledger.steamKg += evaporated; cell.stepSteamKg += evaporated;
            ledger.gasSensibleJ += sensible; ledger.steamLatentJ += evaporated * C.waterLatentJPerKg;
            cell.stepGasSensibleJ += sensible; cell.stepSteamLatentJ += evaporated * C.waterLatentJPerKg;
            layer.temperatureK = temperatureAt(layer);
        }
        const temperature = layer.temperatureK;
        let dry = depletion(layer.wood, layer.initialWood, M.pyrolysis, temperature, layer.oxygen, dt, 1);
        let oxidative = depletion(layer.wood, layer.initialWood, M.oxidativePyrolysis, temperature, layer.oxygen, dt, oxidativeOxygen);
        const proposed = dry + oxidative, oxygen = oxidative * M.oxidativeOxygenKgPerKg;
        const gas = proposed * (1 - M.charYield) + oxygen;
        const sensible = gas * C.volatileHeatCapacityJPerKgK * Math.max(0, temperature - reference);
        const demand = proposed * M.pyrolysisJPerKg + sensible;
        const scale = proposed > 0 ? Math.min(1, layer.wood / proposed, demand > 0 ? Math.max(0, layer.energyJ) / demand : 1) : 0;
        dry *= scale; oxidative *= scale;
        const converted = dry + oxidative, consumedOxygen = oxidative * M.oxidativeOxygenKgPerKg;
        const volatile = converted * (1 - M.charYield) + consumedOxygen;
        layer.wood = Math.max(0, layer.wood - converted); layer.char += converted * M.charYield;
        layer.energyJ -= demand * scale;
        ledger.pyrolysisJ += converted * M.pyrolysisJPerKg; ledger.gasSensibleJ += sensible * scale;
        cell.stepGasSensibleJ += sensible * scale;
        ledger.oxygenConsumedKg += consumedOxygen; ledger.volatileKg += volatile;
        cell.stepVolatileKg += volatile; layer.stepVolatileKg += volatile;
        layer.temperatureK = temperatureAt(layer);
        const oxidized = Math.min(layer.char, depletion(layer.char, layer.initialWood * M.charYield, M.charOxidation,
            layer.temperatureK, layer.oxygen, dt, charOxygen));
        const released = oxidized * M.charOxidationJPerKg, co2 = oxidized * M.charCO2KgPerKg;
        const gasSensible = co2 * C.co2HeatCapacityJPerKgK * Math.max(0, layer.temperatureK - reference);
        // Gas cannot export more sensible energy than exists in this reaction.
        const exportSensible = Math.min(gasSensible, Math.max(0, layer.energyJ) + released * this.charHeatToSolidFraction);
        const gasHeat = released * (1 - this.charHeatToSolidFraction);
        layer.char -= oxidized; layer.ash += oxidized * M.ashYield;
        layer.energyJ += released - gasHeat - exportSensible;
        ledger.charReactionJ += released; ledger.gasReactionHeatJ += gasHeat; ledger.gasSensibleJ += exportSensible;
        cell.stepGasSensibleJ += exportSensible;
        ledger.oxygenConsumedKg += oxidized * M.charOxygenKgPerKg; ledger.co2Kg += co2;
        cell.stepCO2Kg += co2; cell.stepGasHeatJ += gasHeat;
    }
    /** Apply explicit SI heat and liquid input to an owned face. Water arrives
     * with its own sensible energy; cooling cannot remove energy below 1 K. */
    applySurfaceTransfer(id, { face = 3, energyJ = 0, waterKg = 0, waterTemperatureK = C.referenceTemperatureK } = {}) {
        const cell = this._cells.get(id);
        if (!cell) throw new RangeError('Unknown wood cell');
        finite(energyJ, 'External heat', -1e15, 1e15); finite(waterKg, 'External water', 0, 1e6);
        finite(waterTemperatureK, 'Water temperature', 1, 5000);
        const entries = cell.faces[faceIndex(face)].entries; let actualEnergyJ = 0;
        for (const { layer, weight } of entries) {
            const inputWater = waterKg * weight, sensible = inputWater * C.waterHeatCapacityJPerKgK * (waterTemperatureK - C.referenceTemperatureK);
            layer.water += inputWater; layer.energyJ += sensible;
            // A reaction can shrink the layer's heat capacity before contact.
            // Admit only the requested signed transfer; restoring a thermal
            // bound here would silently export or invent additional heat.
            const requested = energyJ * weight;
            const transferred = requested >= 0
                ? Math.min(requested, Math.max(0, energyAt(layer, 5000) - layer.energyJ))
                : Math.max(requested, Math.min(0, energyAt(layer, 1) - layer.energyJ));
            layer.energyJ += transferred; layer.temperatureK = temperatureAt(layer); actualEnergyJ += transferred;
        }
        this.ledger.externalWaterKg = (this.ledger.externalWaterKg ?? 0) + waterKg;
        this.ledger.externalWaterSensibleJ = (this.ledger.externalWaterSensibleJ ?? 0) + waterKg * C.waterHeatCapacityJPerKgK * (waterTemperatureK - C.referenceTemperatureK);
        this.ledger.externalHeatJ = (this.ledger.externalHeatJ ?? 0) + actualEnergyJ;
        return { energyJ: actualEnergyJ, waterKg, temperatureK: meanCellTemperature(cell) };
    }
    /** Add a finite pine layer to an isolated cell, retaining all previous
     * char, ash, moisture and heat. Its depth grows by the actual pine volume. */
    depositPine(id, { dryMassKg, temperatureK = C.referenceTemperatureK, moistureDryBasis = .12 } = {}) {
        const cell = this._cells.get(id);
        if (!cell || cell.residueSurfaceAreaM2 || this._coverage.get(id).some(area => area > 0)) throw new RangeError('Pine deposition requires an isolated layered cell');
        finite(dryMassKg, 'Deposited pine', Number.MIN_VALUE, 1e6); finite(temperatureK, 'Pine temperature', 1, 5000);
        finite(moistureDryBasis, 'Pine moisture', 0, 5);
        const oldDepth = cell.dimensions[cell.axis], faceArea = cell.volumeM3 / oldDepth;
        finite(oldDepth + dryMassKg / (M.dryDensityKgM3 * faceArea), 'Deposited pine cell depth', Number.MIN_VALUE, 100);
        const growth = 1 + dryMassKg / (M.dryDensityKgM3 * cell.volumeM3); let addedEnergyJ = 0;
        for (const layer of cell.layers) {
            const added = dryMassKg * layer.width / oldDepth, water = added * moistureDryBasis;
            const energy = added * specificEnergy(M.wood.heatCapacity, temperatureK) + water * C.waterHeatCapacityJPerKgK * (temperatureK - C.referenceTemperatureK);
            layer.initialWood += added; layer.wood += added; layer.water += water; layer.energyJ += energy;
            layer.width *= growth; layer.center *= growth; layer.temperatureK = temperatureAt(layer); addedEnergyJ += energy;
        }
        cell.dimensions[cell.axis] *= growth; cell.volumeM3 = faceArea * cell.dimensions[cell.axis]; cell.initialDryMassKg += dryMassKg;
        for (const face of cell.faces) {
            face.area = cell.volumeM3 / cell.dimensions[face.face >> 1];
            if ((face.face >> 1) !== cell.axis) face.entries = cell.layers.map(layer => ({ layer, weight: layer.width / cell.dimensions[cell.axis] }));
        }
        for (const edge of this._internalEdges) if (edge.a.cell === cell) { edge.distanceA = edge.a.width / 2; edge.distanceB = edge.b.width / 2; }
        this.ledger.depositedPineKg = (this.ledger.depositedPineKg ?? 0) + dryMassKg * (1 + moistureDryBasis);
        this.ledger.depositedPineEnergyJ = (this.ledger.depositedPineEnergyJ ?? 0) + addedEnergyJ;
        return this.cell(id);
    }
    /** Exact retained state, including layers, geometry, boundary transients
     * and cumulative balances. No executable data is accepted on restore. */
    snapshot() {
        const layerKeys = ['width', 'center', 'initialWood', 'wood', 'char', 'ash', 'water', 'temperatureK', 'energyJ', 'oxygen', 'stepVolatileKg'];
        const cellKeys = ['initialDryMassKg', 'stepVolatileKg', 'stepSteamKg', 'stepCO2Kg', 'stepGasHeatJ', 'stepGasSensibleJ', 'stepSteamLatentJ'];
        return { schema: 'engine.wood-combustion', version: this.integrationMode === 'components' ? 2 : 1, ...(this.integrationMode === 'components' ? { integrationMode: 'components' } : {}), materialId: M.id, materialSha256: M.sourceSha256,
            surfaceLayerM: this.surfaceLayerM, charHeatToSolidFraction: this.charHeatToSolidFraction, oxygenPenetrationM: this.oxygenPenetrationM, allowThinCells: this.allowThinCells,
            timeSeconds: this.timeSeconds, steps: this.steps, lastDt: this.lastDt, ledger: { ...this.ledger }, connections: this._connections.map(link => ({ ...link })),
            ...(this.integrationMode === 'components' ? { thermalGeometry: [...this._cells.values()].map(cell => ({
                cellId: cell.id, volumeM3: cell.volumeM3,
                internalFaceAreaM2: this._internalEdges.find(edge => edge.a.cell === cell)?.area ?? null })) } : {}),
            cells: [...this._cells.values()].map(cell => ({ id: cell.id, dimensionsM: [...cell.dimensions], thermalAxis: cell.axis,
                ...Object.fromEntries(cellKeys.map(key => [key, cell[key]])),
                residueSurfaceAreaM2: cell.residueSurfaceAreaM2 ?? null, residueRadiusM: cell.residueRadiusM ?? null,
                stepFaceVolatileKg: cell.stepFaceVolatileKg ? [...cell.stepFaceVolatileKg] : null,
                stepFaceBoundaryHeatJ: cell.stepFaceBoundaryHeatJ ? [...cell.stepFaceBoundaryHeatJ] : null,
                layers: cell.layers.map(layer => Object.fromEntries(layerKeys.map(key => [key, layer[key]]))) })) };
    }
    restore(snapshot) {
        record(snapshot, 'Wood snapshot');
        if (snapshot.schema !== 'engine.wood-combustion' || ![1, 2].includes(snapshot.version) || snapshot.materialId !== M.id || snapshot.materialSha256 !== M.sourceSha256) throw new RangeError('Incompatible wood snapshot');
        if (snapshot.version === 1 ? snapshot.integrationMode !== undefined && snapshot.integrationMode !== 'global' : snapshot.integrationMode !== 'components') throw new RangeError('Incompatible wood integration mode');
        const replacement = new WoodCombustion({ cells: snapshot.cells.map(cell => ({ id: cell.id, dimensionsM: cell.dimensionsM, thermalAxis: cell.thermalAxis, moistureDryBasis: 0 })),
            surfaceLayerM: snapshot.surfaceLayerM, charHeatToSolidFraction: snapshot.charHeatToSolidFraction, oxygenPenetrationM: snapshot.oxygenPenetrationM, allowThinCells: snapshot.allowThinCells ?? false, integrationMode: snapshot.version === 1 ? 'global' : snapshot.integrationMode });
        finite(snapshot.timeSeconds, 'Wood snapshot time'); finite(snapshot.steps, 'Wood snapshot steps'); finite(snapshot.lastDt, 'Wood snapshot timestep', 0, 60);
        if (!Number.isSafeInteger(snapshot.steps)) throw new RangeError('Wood snapshot steps must be integral');
        record(snapshot.ledger, 'Wood ledger');
        for (const [key, value] of Object.entries(snapshot.ledger)) finite(value, `Wood ledger ${key}`, -1e30, 1e30);
        for (const key of Object.keys(replacement.ledger)) if (!(key in snapshot.ledger)) throw new RangeError(`Missing wood ledger ${key}`);
        if (snapshot.version === 2 && (!Array.isArray(snapshot.thermalGeometry) || snapshot.thermalGeometry.length !== snapshot.cells.length)) throw new RangeError('Missing retained wood thermal geometry');
        replacement._layers = []; replacement._internalEdges = [];
        let geometryIndex = 0;
        for (const input of snapshot.cells) {
            const cell = replacement._cells.get(input.id), allowed = ['width', 'center', 'initialWood', 'wood', 'char', 'ash', 'water', 'temperatureK', 'energyJ', 'oxygen', 'stepVolatileKg'];
            if (!Array.isArray(input.layers) || !input.layers.length || input.layers.length > 128) throw new RangeError('Invalid retained wood layers');
            cell.layers = input.layers.map(values => {
                record(values, 'Wood layer'); const layer = { cell, index: replacement._layers.length };
                for (const key of allowed) layer[key] = finite(values[key], `Wood layer ${key}`, key === 'energyJ' ? -1e30 : 0, 1e30);
                if (!(layer.width > 0 && layer.initialWood > 0 && layer.temperatureK > 0)) throw new RangeError('Invalid retained wood layer geometry');
                if (!(layer.wood + layer.char + layer.ash > 0) || layer.wood + layer.char + layer.ash > layer.initialWood * (1 + 1e-9) || layer.oxygen > M.atmosphericOxygenMassFraction) throw new RangeError('Invalid retained wood layer mass or oxygen');
                // Retained reaction temperatures can exceed the authored
                // input cap as a layer loses mass. Its enthalpy is authority.
                const representedEnergyJ = energyAt(layer, layer.temperatureK);
                if (!Number.isFinite(representedEnergyJ) || Math.abs(representedEnergyJ - layer.energyJ) > Math.max(1e-8, Math.abs(layer.energyJ) * 1e-9)) throw new RangeError('Wood retained temperature disagrees with energy');
                replacement._layers.push(layer); return layer;
            });
            for (const key of ['initialDryMassKg', 'stepVolatileKg', 'stepSteamKg', 'stepCO2Kg', 'stepGasHeatJ', 'stepGasSensibleJ', 'stepSteamLatentJ']) cell[key] = finite(input[key], `Wood cell ${key}`);
            if (!(cell.initialDryMassKg > 0) || Math.abs(cell.layers.reduce((sum, layer) => sum + layer.initialWood, 0) - cell.initialDryMassKg) > cell.initialDryMassKg * 1e-9) throw new RangeError('Retained wood initial mass disagrees with its layers');
            if (input.residueSurfaceAreaM2 !== null) {
                cell.residueSurfaceAreaM2 = finite(input.residueSurfaceAreaM2, 'Residue area', Number.MIN_VALUE);
                cell.residueRadiusM = finite(input.residueRadiusM, 'Residue radius', Number.MIN_VALUE);
            } else if (Math.abs(cell.layers.reduce((sum, layer) => sum + layer.width, 0) - cell.dimensions[cell.axis]) > cell.dimensions[cell.axis] * 1e-9) throw new RangeError('Wood layers do not span retained depth');
            for (const key of ['stepFaceVolatileKg', 'stepFaceBoundaryHeatJ']) {
                if (input[key] !== null && (!Array.isArray(input[key]) || input[key].length !== 6)) throw new RangeError('Invalid wood face rates');
                cell[key] = input[key] === null ? undefined : new Float64Array(input[key].map(value => finite(value, 'Wood face rate', key === 'stepFaceBoundaryHeatJ' ? -1e30 : 0, 1e30)));
            }
            let internalFaceAreaM2 = cell.volumeM3 / cell.dimensions[cell.axis];
            if (snapshot.version === 2) {
                const geometry = record(snapshot.thermalGeometry[geometryIndex++], 'Wood thermal geometry');
                if (Object.keys(geometry).length !== 3 || geometry.cellId !== cell.id) throw new RangeError('Invalid retained wood thermal geometry owner');
                const volumeM3 = finite(geometry.volumeM3, 'Retained wood volume', Number.MIN_VALUE, 1e6);
                if (Math.abs(volumeM3 - cell.volumeM3) > cell.volumeM3 * 1e-10) throw new RangeError('Retained wood volume disagrees with dimensions');
                cell.volumeM3 = volumeM3;
                const hasInternalEdges = !cell.residueSurfaceAreaM2 && cell.layers.length > 1;
                if (hasInternalEdges) {
                    internalFaceAreaM2 = finite(geometry.internalFaceAreaM2, 'Retained wood internal area', Number.MIN_VALUE, 1e4);
                    const expectedArea = cell.volumeM3 / cell.dimensions[cell.axis];
                    if (Math.abs(internalFaceAreaM2 - expectedArea) > expectedArea * 1e-10) throw new RangeError('Retained wood internal area disagrees with dimensions');
                } else if (geometry.internalFaceAreaM2 !== null) throw new RangeError('Lumped wood cannot retain internal edges');
            }
            cell.faces = Array.from({ length: 6 }, (_, face) => ({ face, area: cell.residueSurfaceAreaM2 ? cell.residueSurfaceAreaM2 / 6 : cell.volumeM3 / cell.dimensions[face >> 1],
                entries: (face >> 1) === cell.axis || cell.residueSurfaceAreaM2 ? [{ layer: cell.layers[face & 1 ? cell.layers.length - 1 : 0], weight: 1 }]
                    : cell.layers.map(layer => ({ layer, weight: layer.width / cell.dimensions[cell.axis] })) }));
            if (!cell.residueSurfaceAreaM2) for (let i = 1; i < cell.layers.length; i++) replacement._internalEdges.push({ a: cell.layers[i - 1], b: cell.layers[i],
                area: internalFaceAreaM2, distanceA: cell.layers[i - 1].width / 2, distanceB: cell.layers[i].width / 2, contactResistance: 0 });
        }
        replacement.setConnections(snapshot.connections); replacement.ledger = { ...snapshot.ledger };
        replacement.timeSeconds = snapshot.timeSeconds; replacement.steps = snapshot.steps; replacement.lastDt = snapshot.lastDt;
        Object.assign(this, replacement); return this;
    }
    /** Read the retained mass-weighted temperature or one face without
     * allocating the full six-face material snapshot. No thermal state is
     * cached: transfers, reactions, deposition and restore are visible now. */
    temperatureK(id, { face = null } = {}) {
        const cell = this._cells.get(id);
        if (!cell) throw new RangeError('Unknown wood cell');
        return face === null ? meanCellTemperature(cell) : faceTemperature(cell.faces[faceIndex(face)]);
    }
    cell(id, { layers = false, faces: includeFaces = true } = {}) {
        const cell = this._cells.get(id);
        if (!cell) throw new RangeError('Unknown wood cell');
        const sum = key => cell.layers.reduce((total, layer) => total + layer[key], 0);
        const virginKg = sum('wood'), charKg = sum('char'), ashKg = sum('ash'), waterKg = sum('water');
        const remainingMassKg = virginKg + charKg + ashKg + waterKg, divisor = this.lastDt || 1;
        const faces = includeFaces ? cell.faces.map(face => ({ face: face.face, surfaceTemperatureK: faceTemperature(face),
            volatileRateKgPerSecond: (cell.stepFaceVolatileKg?.[face.face] ?? 0) / divisor,
            boundaryHeatW: (cell.stepFaceBoundaryHeatJ?.[face.face] ?? 0) / divisor })) : null;
        const output = { id, initialDryMassKg: cell.initialDryMassKg, virginKg, charKg, ashKg, waterKg, remainingMassKg,
            temperatureK: meanCellTemperature(cell, remainingMassKg),
            strengthFraction: virginKg / cell.initialDryMassKg, // effective surviving wood cross-section, no char strength claim
            ashConversionReady: virginKg === 0 && charKg === 0 && waterKg === 0,
            residueSurfaceAreaM2: cell.residueSurfaceAreaM2 ?? null,
            volatileRateKgPerSecond: cell.stepVolatileKg / divisor, steamRateKgPerSecond: cell.stepSteamKg / divisor,
            co2RateKgPerSecond: cell.stepCO2Kg / divisor, gasHeatW: cell.stepGasHeatJ / divisor,
            gasSensibleW: cell.stepGasSensibleJ / divisor, steamLatentW: cell.stepSteamLatentJ / divisor,
            unventedVolatileRateKgPerSecond: Math.max(0, cell.stepVolatileKg - (cell.stepFaceVolatileKg?.reduce((sum, value) => sum + value, 0) ?? 0)) / divisor,
            energyJ: sum('energyJ'), faces };
        if (layers) output.layers = cell.layers.map(layer => ({ centerM: layer.center, thicknessM: layer.width, temperatureK: layer.temperatureK,
            virginKg: layer.wood, charKg: layer.char, ashKg: layer.ash, waterKg: layer.water, energyJ: layer.energyJ }));
        return output;
    }
    totals() {
        let remainingMassKg = 0, storedEnergyJ = 0;
        for (const layer of this._layers) { remainingMassKg += layer.wood + layer.char + layer.ash + layer.water; storedEnergyJ += layer.energyJ; }
        const l = this.ledger, expectedEnergyJ = l.initialEnergyJ + l.convectionJ + l.radiationJ + l.charReactionJ
            + (l.externalHeatJ ?? 0) + (l.externalWaterSensibleJ ?? 0) + (l.depositedPineEnergyJ ?? 0)
            - l.pyrolysisJ - l.gasSensibleJ - l.gasReactionHeatJ - l.steamLatentJ;
        return { ...l, remainingMassKg, storedEnergyJ,
            massResidualKg: l.initialSolidMassKg + l.oxygenConsumedKg + (l.externalWaterKg ?? 0) + (l.depositedPineKg ?? 0) - remainingMassKg - l.volatileKg - l.steamKg - l.co2Kg,
            energyResidualJ: expectedEnergyJ - storedEnergyJ,
            assumptions: 'Porous one-dimensional layered pine; prescribed atmospheric oxygen reservoir; SI heat exposure required; gas products and exported energy must be coupled by the caller.' };
    }
}
