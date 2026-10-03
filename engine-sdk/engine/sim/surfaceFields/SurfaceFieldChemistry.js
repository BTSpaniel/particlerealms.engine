// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import oilIdentity from '../particles/substances/materials/oil/identity.js';
import acidIdentity from '../particles/substances/materials/acid/identity.js';
import { getElementBySymbol } from '../particles/ParticleElementTable.js';
import { createMatterState, createMatterEmptyState, snapshotMatterState, replaceMatterConserved, replaceMatterInternalEnergy } from '../../matter/contracts/MatterContracts.js';
import { transferMatterInventory, transferMatterInventories } from '../../matter/transformations/MatterOperators.js';
import { createMatterConservationLedger, assertMatterConservation, MATTER_ENERGY_ROUNDOFF_MODEL } from '../../matter/state/MatterConservationLedger.js';
import { createRealmTransformation } from '../../matter/fabric/RealmMatterContracts.js';
import { RealmConservationValidator } from '../../matter/fabric/RealmConservationValidator.js';
import { contentHash } from '../../matter/fabric/FabricSupport.js';
import { cloneStrictJson } from '../../core/schema/StrictJsonValue.js';
import { SURFACE_NO_NEIGHBOR } from './SurfaceFieldTopology.js';
import { STEFAN_BOLTZMANN } from '../../core/math/MathConstants.js';
import { compensatedSum } from '../../core/math/RobustNumericMath.js';
import { WATER_THERMODYNAMICS as WT, specificEnthalpyFromTemperature, thermalStateFromSpecificEnthalpy } from '../thermodynamics/WaterThermodynamics.js';
import { SurfaceFieldRunoff, SURFACE_RUNOFF_STRIDE } from './SurfaceFieldRunoff.js';

export const SURFACE_OIL_PROFILE = Object.freeze({ id: 'surface.fuel-oil-2.c12h26-proxy.v1', substanceId: oilIdentity.id,
    materialId: oilIdentity.materialId, densityKgM3: 879, ignitionTemperatureK: 529.8167, regressionMPerSecond: .004 / 60,
    heatOfCombustionJPerKg: 45.217e6, specificHeatJPerKgK: 2203, heatFeedbackFraction: .01, contactWPerM2K: 25,
    emissivity: .9, compositionProxy: 'C12H26',
    propertySource: 'https://cameochemicals.noaa.gov/chris/OTW.pdf',
    heatCapacitySource: 'https://webbook.nist.gov/cgi/cbook.cgi?ID=C112403&Units=SI&Mask=2#Thermo-Condensed',
    scope: 'Fuel Oil #2 bulk properties; C12H26 is an explicit bookkeeping proxy for a commercial mixture. Heat capacity is a constant dodecane proxy; feedback and contact are reduced-model closures.' });
export const SURFACE_ACID_PROFILE = Object.freeze({ id: 'surface.hcl30-calcite.v1', substanceId: acidIdentity.id,
    materialId: acidIdentity.materialId, hclMassFraction: .30, solutionDensityKgM3: 1150, calciteDensityKgM3: 2710,
    carbonateRateKgM2Second: .12,
    densitySource: 'https://www.govinfo.gov/content/pkg/GOVPUB-C13-0dd1458c29aace6b60ecba3311f8a195/pdf/GOVPUB-C13-0dd1458c29aace6b60ecba3311f8a195.pdf',
    scope: 'CaCO3 + 2 HCl -> CaCl2(aq) + CO2 + H2O. 30% solution density and the accelerated dissolution rate are explicit demonstration closures, not universal measured kinetics. Acid reaction heat is not modelled.' });

const cp = SURFACE_OIL_PROFILE.specificHeatJPerKgK, ambientK = 293.15;
const atomic = symbol => getElementBySymbol(symbol).mass / 1000;
const H = atomic('H'), C = atomic('C'), O = atomic('O'), Ca = atomic('Ca'), Cl = atomic('Cl');
export const SURFACE_IRON_PROFILE = Object.freeze({ id: 'surface.hcl-carbon-steel.v1', ironMolarKg: atomic('Fe'),
    ferrousChlorideMolarKg: atomic('Fe') + 2 * Cl, hydrogenMolarKg: 2 * H, dissolutionKgM2Second: .4,
    source: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8432721/',
    scope: 'Fe + 2HCl -> FeCl2(aq) + H2. Local finite reactants; authored accelerated surface rate, not measured corrosion kinetics. FeCl2 uses the existing constant solute thermal/partial-volume closure. Reaction enthalpy is unresolved and recorded as an isothermal closure; hydrogen is retained gas, not automatic flame fuel.' });
export const SURFACE_CHEMICAL_MOLAR_MASS_KG = Object.freeze({ oil: 12 * C + 26 * H, oxygen: 2 * O, hcl: H + Cl,
    carbonate: Ca + C + 3 * O, salt: Ca + 2 * Cl, co2: C + 2 * O, water: 2 * H + O });
const M = SURFACE_CHEMICAL_MOLAR_MASS_KG;
const species = Object.freeze({ oil: 'species:surface-fuel-oil-c12h26-proxy', acid: 'species:HCl', carbonate: 'species:CaCO3', salt: 'species:CaCl2', water: 'species:H2O', co2: 'species:CO2', ferrous: 'species:FeCl2', hydrogen: 'species:H2' });
const legacyDefinitionHash = contentHash({ oil: SURFACE_OIL_PROFILE, acid: SURFACE_ACID_PROFILE, molarMass: M });
export const SURFACE_LIQUID_CLOSURE = Object.freeze({ id: 'surface.aqueous-oil.v2', waterDensityKgM3: 1000,
    solutePartialVolumeM3PerKg: (1 / 1150 - .7 / 1000) / .3, soluteHeatCapacityJPerKgK: 1000,
    waterEnthalpyOffsetJPerKg: WT.meltingTemperatureK * WT.specificHeatIceJPerKgK,
    aqueousContactWPerM2K: 1000, oilWaterContactWPerM2K: 250, oilCoverageDepthM: .0002,
    scope: 'Aqueous HCl/CaCl2 share one solvent inventory; oil is a separate immiscible film. Constant solute partial volume and heat capacity are explicit reduced closures, without electrolyte activity, solubility, HCl volatility or emulsification. Calcite kinetics scale linearly with HCl mass fraction relative to the authored 30% dose. Neutralization is isothermal with its unresolved thermal conversion recorded; dilution heat is not predicted.' });
const definitionHash = contentHash({ oil: SURFACE_OIL_PROFILE, acid: SURFACE_ACID_PROFILE, molarMass: M, liquids: SURFACE_LIQUID_CLOSURE });
const supportDefinitionHash = contentHash({ definitionHash, iron: SURFACE_IRON_PROFILE });
const aqueousSpecies = [species.acid, species.water, species.salt, species.ferrous];
const liquidSpecies = [species.oil, ...aqueousSpecies];
function finite(value, name, min = 0, max = 1e12) {
    if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`${name} must be finite in [${min}, ${max}]`);
    return value;
}

const waterOffset = SURFACE_LIQUID_CLOSURE.waterEnthalpyOffsetJPerKg;
const soluteCp = SURFACE_LIQUID_CLOSURE.soluteHeatCapacityJPerKgK;
const waterEnthalpy = (temperatureK, phase) => waterOffset + specificEnthalpyFromTemperature(temperatureK, phase);
const aqueousMass = masses => aqueousSpecies.reduce((sum, id) => sum + (masses[id] ?? 0), 0);
const aqueousVolume = masses => (masses[species.water] ?? 0) / 1000
    + ((masses[species.acid] ?? 0) + (masses[species.salt] ?? 0) + (masses[species.ferrous] ?? 0)) * SURFACE_LIQUID_CLOSURE.solutePartialVolumeM3PerKg;
function aqueousEnergy(masses, temperatureK, phase = null) {
    return (masses[species.water] ?? 0) * waterEnthalpy(temperatureK, phase)
        + ((masses[species.acid] ?? 0) + (masses[species.salt] ?? 0) + (masses[species.ferrous] ?? 0)) * soluteCp * temperatureK;
}
/** Invert the shared water enthalpy with the declared constant-capacity solute.
 * Latent intervals retain phase fractions rather than inventing temperatures. */
function aqueousThermal(masses, energyJ) {
    const water = masses[species.water] ?? 0, soluteCapacity = ((masses[species.acid] ?? 0) + (masses[species.salt] ?? 0) + (masses[species.ferrous] ?? 0)) * soluteCp;
    if (!water) return { temperatureK: soluteCapacity ? energyJ / soluteCapacity : ambientK, liquidFraction: 0, vaporFraction: 0 };
    const meltStart = water * waterOffset + soluteCapacity * WT.meltingTemperatureK;
    const meltEnd = meltStart + water * WT.latentHeatFusionJPerKg;
    const boilStart = meltEnd + (water * WT.specificHeatLiquidJPerKgK + soluteCapacity) * (WT.boilingTemperatureK - WT.meltingTemperatureK);
    const boilEnd = boilStart + water * WT.latentHeatVaporizationJPerKg;
    let temperatureK;
    if (energyJ < meltStart) temperatureK = WT.meltingTemperatureK + (energyJ - meltStart) / (water * WT.specificHeatIceJPerKgK + soluteCapacity);
    else if (energyJ < meltEnd) temperatureK = WT.meltingTemperatureK;
    else if (energyJ < boilStart) temperatureK = WT.meltingTemperatureK + (energyJ - meltEnd) / (water * WT.specificHeatLiquidJPerKgK + soluteCapacity);
    else if (energyJ < boilEnd) temperatureK = WT.boilingTemperatureK;
    else temperatureK = WT.boilingTemperatureK + (energyJ - boilEnd) / (water * WT.specificHeatVaporJPerKgK + soluteCapacity);
    // Nonnegative retained energy cannot imply a negative absolute temperature;
    // subtraction at an almost empty film can land a few ULPs below zero.
    temperatureK = Math.max(0, temperatureK);
    const state = thermalStateFromSpecificEnthalpy((energyJ - soluteCapacity * temperatureK) / water - waterOffset);
    return { temperatureK, liquidFraction: state.liquidFraction, vaporFraction: state.vaporFraction };
}

/** Finite liquids and minerals use the existing immutable Matter states.
 * Each phase retains its own energy as well as the checked Matter total.
 * Subtracting hot oil energy from a total cannot resolve a trace water film;
 * explicit partitions preserve that film's finite temperature and enthalpy. */
export class SurfaceFieldChemicalInventory {
    constructor(topology, { runoff = false, runoffCapacity, supportChemistry = false, namespace = 'surface' } = {}) {
        if (typeof supportChemistry !== 'boolean' || typeof namespace !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(namespace)
            || !supportChemistry && namespace !== 'surface') throw new RangeError('Invalid support chemistry configuration');
        this.supportChemistry = supportChemistry; this.namespace = namespace;
        this.definitionHash = supportChemistry ? supportDefinitionHash : definitionHash;
        this.supportLedger = { exchangedMassKg: 0, exchangedWaterKg: 0, exchangedEnergyJ: 0, ironAddedKg: 0, ironAddedEnergyJ: 0, ironConsumedKg: 0, hclConsumedKg: 0, hydrogenProducedKg: 0, ferrousProducedKg: 0 };
        this.topology = topology; this.states = new Map(); this.sequence = 0; this.steps = 0; this.timeSeconds = 0;
        this.runoff = new SurfaceFieldRunoff(topology, { enabled: runoff, capacity: runoffCapacity });
        this._runoffTransferScratch = null;
        this.initialCarbonateKg = new Float64Array(topology.count); this.rates = new Float64Array(topology.count * 3);
        this.gasSourceRates = new Float64Array(topology.count * 2); this.evaporationRates = new Float64Array(topology.count);
        this.oilEnergyJ = new Float64Array(topology.count); this.aqueousEnergyJ = new Float64Array(topology.count);
        this._transportScratch = Object.fromEntries([['oil', [species.oil]], ['aqueous', aqueousSpecies]].map(([phase, speciesIds]) => [phase, {
            speciesIds, sourceIndices: new Uint32Array(topology.count * 4), targetIndices: new Uint32Array(topology.count * 4),
            quantities: new Float64Array(topology.count * 4 * (speciesIds.length + 5)),
        }]));
        this.auxiliary = new Float32Array(topology.count * 8); this.liquidProperties = new Float32Array(topology.count * 4);
        this.validator = new RealmConservationValidator(); this.lastReceipts = {};
        this.gas = this._state('surface:chemical-gas', {}); this.disposal = this._state('surface:chemical-wipe', {});
        this._emptyOwnerTemplate = this.gas;
        this.outflow = this._state('surface:chemical-outflow', {}); this.absorbed = this._state('surface:chemical-absorbed', {});
        this.ledger = { initialCarbonateKg: 0, oilAddedKg: 0, acidHClAddedKg: 0, acidWaterAddedKg: 0,
            oxygenConsumedKg: 0, oilBurnedKg: 0, carbonateConsumedKg: 0, saltProducedKg: 0,
            co2ProducedKg: 0, waterProducedKg: 0, oilAddedSensibleJ: 0, externalHeatJ: 0, boundaryHeatJ: 0,
            combustionHeatJ: 0, heatToSubstrateJ: 0, discardedOilKg: 0, discardedHClKg: 0,
            externalWaterAddedKg: 0, aqueousAddedEnergyJ: 0, aqueousExternalHeatJ: 0,
            absorbedWaterKg: 0, absorbedWaterEnergyJ: 0, evaporatedWaterKg: 0, evaporatedWaterEnergyJ: 0,
            outflowWaterKg: 0, wipedWaterKg: 0, reactionLiquidWaterKg: 0, reactionThermalClosureJ: 0,
            legacyThermalReferenceJ: 0 };
        for (let i = 0; i < topology.count; i++) if (topology.domains[topology.meta[i * 8 + 4]].material === 'calcite') {
            const mass = topology.meta[i * 8 + 3] * topology.domains[topology.meta[i * 8 + 4]].substrateDepthM * SURFACE_ACID_PROFILE.calciteDensityKgM3;
            this.initialCarbonateKg[i] = mass; this.ledger.initialCarbonateKg += mass;
            this.states.set(i, this._state(`surface:chemical-cell:${i}`, { [species.carbonate]: mass }));
        }
        this.validator.assert(reaction('oil', 1)); this.validator.assert(reaction('acid', 1)); this.sync();
    }
    _state(regionId, speciesMassKg, internalEnergyJ = 0, revision = 0) {
        regionId = regionId.replace(/^surface:/, `${this.namespace}:`);
        return createMatterState({ regionId, definitionId: 'engine.surface.chemical-inventory', definitionHash: this.definitionHash, revision,
            representation: { kind: 'voxel', fidelityLevel: 'L1', backendId: 'engine.surface-fields.cpu' },
            ancestry: { rootRegionId: regionId, parentRegionId: null, eventId: null, generation: 0 },
            conserved: { speciesMassKg, momentumKgMPerS: [0, 0, 0], internalEnergyJ, electricChargeC: 0 } });
    }
    _retainedState(input, regionId, allowedSpecies, legacy = false) {
        regionId = regionId.replace(/^surface:/, `${this.namespace}:`);
        const state = createMatterState(input), r = state.representation, a = state.ancestry, c = state.conserved;
        if (state.regionId !== regionId || state.definitionId !== 'engine.surface.chemical-inventory' || state.definitionHash !== (legacy ? legacyDefinitionHash : this._restoringDefinitionHash ?? this.definitionHash)
            || r.kind !== 'voxel' || r.fidelityLevel !== 'L1' || r.backendId !== 'engine.surface-fields.cpu'
            || a.rootRegionId !== regionId || a.parentRegionId !== null || a.eventId !== null || a.generation !== 0
            || c.electricChargeC !== 0 || c.momentumKgMPerS.some(value => value !== 0)
            || Object.keys(c.speciesMassKg).some(id => !allowedSpecies.includes(id) || !this.supportChemistry && [species.ferrous, species.hydrogen].includes(id))) throw new RangeError('Checkpoint changed chemical owner identity');
        return legacy || state.definitionHash !== this.definitionHash ? this._state(regionId, c.speciesMassKg, c.internalEnergyJ, state.revision) : state;
    }
    _owned(i) { return this.states.get(i) ?? createMatterEmptyState(this._emptyOwnerTemplate, `${this.namespace}:chemical-cell:${i}`); }
    _replace(i, masses, energyJ) {
        const current = this._owned(i);
        this.states.set(i, masses === current.conserved.speciesMassKg
            ? replaceMatterInternalEnergy(current, Math.max(0, energyJ), { derived: null })
            : replaceMatterConserved(current, { ...current.conserved,
                speciesMassKg: masses, internalEnergyJ: Math.max(0, energyJ) }, { derived: null }));
    }
    /** Project explicit phase energies back into the scalar Matter total.
     * Removing a large phase can reveal heat which was below that total's ULP.
     * The adjustment is bounded by the transaction's floating-point scale and
     * the complete candidate must still satisfy the shared conservation law. */
    _projectPhaseTotals(receipt, totals) {
        const before = new Map(receipt.beforeStates.map(state => [state.regionId, state])); let changed = false;
        const after = receipt.afterStates.map(state => {
            if (!totals.has(state.regionId)) return state;
            const energyJ = totals.get(state.regionId), current = state.conserved.internalEnergyJ;
            if (energyJ === current) return state;
            const scale = Math.max(1, current, energyJ, before.get(state.regionId)?.conserved.internalEnergyJ ?? 0);
            if (!Number.isFinite(energyJ) || energyJ < 0 || Math.abs(energyJ - current) > Math.max(1e-9, 64 * Number.EPSILON * scale)) throw new RangeError(`Liquid phase energy projection exceeded roundoff: ${state.regionId}`);
            changed = true;
            return replaceMatterInternalEnergy(state, energyJ, { revision: state.revision });
        });
        if (changed) {
            const ledger = createMatterConservationLedger({ beforeStates: receipt.beforeStates, afterStates: after, energyRoundoff: MATTER_ENERGY_ROUNDOFF_MODEL });
            assertMatterConservation(ledger); this.lastReceipts.phaseProjection = ledger;
        }
        return after;
    }
    _assertCell(i) {
        if (!Number.isInteger(i) || i < 0 || i >= this.topology.count) throw new RangeError('Invalid chemical cell');
    }
    /** Exact phase geometry without thermal inversion. Callers which scan the
     * field can lend one output object; retained masses remain immutable. */
    phaseGeometry(i, output = {}) {
        this._assertCell(i);
        const masses = this.states.get(i)?.conserved.speciesMassKg ?? {};
        output.waterKg = masses[species.water] ?? 0; output.oilKg = masses[species.oil] ?? 0;
        output.aqueousMassKg = output.waterKg + (masses[species.acid] ?? 0) + (masses[species.salt] ?? 0) + (masses[species.ferrous] ?? 0);
        output.aqueousVolumeM3 = aqueousVolume(masses); return output;
    }
    cell(i) {
        this._assertCell(i);
        const state = this.states.get(i), mass = state?.conserved.speciesMassKg ?? {}, oilKg = mass[species.oil] ?? 0;
        const carbonateKg = mass[species.carbonate] ?? 0, area = this.topology.meta[i * 8 + 3];
        const waterKg = mass[species.water] ?? 0, acidHClKg = mass[species.acid] ?? 0, dissolvedCaCl2Kg = mass[species.salt] ?? 0;
        const dissolvedFeCl2Kg = mass[species.ferrous] ?? 0;
        const aqueousMassKg = waterKg + acidHClKg + dissolvedCaCl2Kg + dissolvedFeCl2Kg;
        const aqueousEnergyJ = this.aqueousEnergyJ[i];
        const thermal = aqueousThermal(mass, aqueousEnergyJ);
        return { oilKg, acidHClKg, waterKg, carbonateKg, initialCarbonateKg: this.initialCarbonateKg[i], dissolvedCaCl2Kg, dissolvedFeCl2Kg,
            oilEnergyJ: this.oilEnergyJ[i], oilTemperatureK: oilKg > 0 ? this.oilEnergyJ[i] / (oilKg * cp) : ambientK,
            aqueousMassKg, aqueousEnergyJ, aqueousTemperatureK: thermal.temperatureK,
            aqueousLiquidFraction: thermal.liquidFraction, aqueousVaporFraction: thermal.vaporFraction,
            aqueousVolumeM3: aqueousVolume(mass),
            hclMassFraction: aqueousMassKg > 0 ? acidHClKg / aqueousMassKg : 0,
            removedSolidDepthM: (this.initialCarbonateKg[i] - carbonateKg) / (area * SURFACE_ACID_PROFILE.calciteDensityKgM3),
            oilBurnKgPerSecond: this.rates[i * 3], acidReactionKgPerSecond: this.rates[i * 3 + 1], co2KgPerSecond: this.rates[i * 3 + 2] };
    }
    _add(i, masses, energyJ) {
        this._assertCell(i); const source = this._state(`surface:chemical-input:${++this.sequence}`, masses, energyJ);
        const receipt = transferMatterInventory({ sourceState: source, targetState: this._owned(i), energyRoundoff: MATTER_ENERGY_ROUNDOFF_MODEL,
            inventory: { speciesMassKg: masses, momentumKgMPerS: [0, 0, 0], internalEnergyJ: energyJ, electricChargeC: 0 }, eventId: `surface:chemical-add:${this.sequence}` });
        const oil = this.oilEnergyJ[i] + ((masses[species.oil] ?? 0) > 0 ? energyJ : 0);
        const aqueous = this.aqueousEnergyJ[i] + ((masses[species.oil] ?? 0) > 0 ? 0 : energyJ);
        const projected = this._projectPhaseTotals(receipt, new Map([[this._owned(i).regionId, oil + aqueous]]));
        this.states.set(i, projected[1]); this.oilEnergyJ[i] = oil; this.aqueousEnergyJ[i] = aqueous;
    }
    addOil(i, massKg, temperatureK = ambientK) {
        finite(massKg, 'Added oil'); finite(temperatureK, 'Oil temperature', 1, 1500); if (!massKg) return;
        const energyJ = massKg * cp * temperatureK; this._add(i, { [species.oil]: massKg }, energyJ);
        this.ledger.oilAddedKg += massKg; this.ledger.oilAddedSensibleJ += energyJ; this._syncCell(i);
    }
    addWater(i, massKg, temperatureK = ambientK) {
        finite(massKg, 'Added water'); finite(temperatureK, 'Water temperature', 1, 2000); if (!massKg) return;
        this.addWaters([{ index: i, waterKg: massKg, temperatureK }]);
    }
    /** Admit a rain field through one conserved Matter transaction. The input
     * reservoir is external; only the actual transferred mass/heat is booked. */
    addWaters(entries) {
        const inputs = cloneStrictJson(entries, '$.surfaceWaterInputs');
        if (!Array.isArray(inputs)) throw new RangeError('Water inputs must be an array');
        const indices = new Set(), planned = []; let sourceMass = 0, sourceEnergy = 0;
        for (const entry of inputs) {
            const i = entry?.index; this._assertCell(i);
            if (indices.has(i)) throw new RangeError('Water inputs must have unique cell owners'); indices.add(i);
            const waterKg = finite(entry.waterKg, 'Added water'), temperatureK = finite(entry.temperatureK ?? ambientK, 'Water temperature', 1, 2000);
            const energyJ = waterKg * waterEnthalpy(temperatureK);
            planned.push({ index: i, waterKg, temperatureK, energyJ }); sourceMass += waterKg; sourceEnergy += energyJ;
        }
        sourceMass = compensatedSum(planned.map(entry => entry.waterKg)).sum;
        sourceEnergy = compensatedSum(planned.map(entry => entry.energyJ)).sum;
        if (!(sourceMass > 0)) return planned;
        const source = this._state(`surface:chemical-input:${this.sequence + 1}`, { [species.water]: sourceMass }, sourceEnergy);
        const states = [source], owners = new Map(); let remainingMass = sourceMass, remainingEnergy = sourceEnergy, admittedMass = 0, admittedEnergy = 0;
        const packed = { speciesIds: [species.water], sourceIndices: new Uint32Array(planned.length), targetIndices: new Uint32Array(planned.length), quantities: new Float64Array(planned.length * 6) };
        for (const entry of planned) {
            // A final donor cap resolves summation roundoff without spending
            // more than the declared external reservoir or fabricating heat.
            const requested = entry.waterKg;
            entry.waterKg = Math.min(requested, remainingMass);
            entry.energyJ = Math.min(remainingEnergy, requested > 0 ? entry.energyJ * (entry.waterKg / requested) : 0);
            if (!(entry.waterKg > 0)) continue;
            const target = this._owned(entry.index); states.push(target); owners.set(target.regionId, entry.index);
            const row = states.length - 2;
            packed.targetIndices[row] = states.length - 1;
            packed.quantities[row * 6] = entry.waterKg; packed.quantities[row * 6 + 4] = entry.energyJ;
            remainingMass -= entry.waterKg; remainingEnergy -= entry.energyJ; admittedMass += entry.waterKg; admittedEnergy += entry.energyJ;
        }
        const transferCount = states.length - 1;
        const packedTransfers = { speciesIds: packed.speciesIds, sourceIndices: packed.sourceIndices.subarray(0, transferCount),
            targetIndices: packed.targetIndices.subarray(0, transferCount), quantities: packed.quantities.subarray(0, transferCount * 6) };
        const receipt = transferMatterInventories({ states, packedTransfers, eventId: `surface:chemical-water-add:${this.sequence + 1}`, energyRoundoff: MATTER_ENERGY_ROUNDOFF_MODEL });
        const aqueous = this.aqueousEnergyJ.slice(); for (const entry of planned) aqueous[entry.index] += entry.energyJ;
        const totals = new Map([...owners].map(([id, i]) => [id, this.oilEnergyJ[i] + aqueous[i]]));
        for (const state of this._projectPhaseTotals(receipt, totals)) if (owners.has(state.regionId)) this.states.set(owners.get(state.regionId), state);
        this.aqueousEnergyJ.set(aqueous);
        this.ledger.externalWaterAddedKg += admittedMass; this.ledger.aqueousAddedEnergyJ += admittedEnergy; this.sequence++;
        for (const i of owners.values()) this._syncCell(i);
        return planned;
    }
    addAcid(i, solutionMassKg, temperatureK = ambientK) {
        finite(solutionMassKg, 'Added acid solution'); finite(temperatureK, 'Acid temperature', 1, 2000); if (!solutionMassKg) return;
        const hcl = solutionMassKg * SURFACE_ACID_PROFILE.hclMassFraction, water = solutionMassKg - hcl;
        const masses = { [species.acid]: hcl, [species.water]: water }, energyJ = aqueousEnergy(masses, temperatureK);
        this._add(i, masses, energyJ); this.ledger.acidHClAddedKg += hcl; this.ledger.acidWaterAddedKg += water;
        this.ledger.aqueousAddedEnergyJ += energyJ; this._syncCell(i);
    }
    /** Explicit heat admission; empty films never acquire a flame flag. */
    heat(i, energyJ) {
        finite(energyJ, 'Oil heat', -1e15, 1e15); const cell = this.cell(i); if (!cell.oilKg) return 0;
        const actual = Math.max(cell.oilKg * cp - cell.oilEnergyJ, Math.min(energyJ, cell.oilKg * cp * 1500 - cell.oilEnergyJ));
        const state = this._owned(i); this.oilEnergyJ[i] += actual;
        this._replace(i, state.conserved.speciesMassKg, this.oilEnergyJ[i] + this.aqueousEnergyJ[i]);
        this.ledger.externalHeatJ += actual; this._syncCell(i); return actual;
    }
    exchangeAqueousHeat(i, energyJ) {
        finite(energyJ, 'Aqueous heat', -1e15, 1e15); const cell = this.cell(i); if (!cell.aqueousMassKg) return 0;
        const state = this._owned(i), masses = state.conserved.speciesMassKg;
        const actual = Math.max(aqueousEnergy(masses, 1) - cell.aqueousEnergyJ,
            Math.min(energyJ, aqueousEnergy(masses, 2000) - cell.aqueousEnergyJ));
        this.aqueousEnergyJ[i] += actual; this._replace(i, masses, this.oilEnergyJ[i] + this.aqueousEnergyJ[i]);
        this.ledger.aqueousExternalHeatJ += actual; this._syncCell(i); return actual;
    }
    ignite(i) { const cell = this.cell(i); return cell.oilKg > 0 ? this.heat(i, cell.oilKg * cp * Math.max(0, 570 - cell.oilTemperatureK)) : 0; }
    /** Move two distinct phases between retained owners. Boundary ledgers are
     * equal and opposite; neither inventory creates an external dose. */
    transferLiquidTo(target, sourceIndex, targetIndex, { aqueousFraction = 0, oilFraction = 0 } = {}) {
        if (!(target instanceof SurfaceFieldChemicalInventory) || !this.supportChemistry || !target.supportChemistry) throw new RangeError('Liquid exchange requires support-enabled inventories');
        this._assertCell(sourceIndex); target._assertCell(targetIndex);
        finite(aqueousFraction, 'Aqueous exchange fraction', 0, 1); finite(oilFraction, 'Oil exchange fraction', 0, 1);
        const source = this._owned(sourceIndex), receiver = target._owned(targetIndex);
        if (source.regionId === receiver.regionId) throw new RangeError('Liquid exchange needs distinct retained owner identities');
        const masses = {}, before = source.conserved.speciesMassKg;
        for (const id of liquidSpecies) { const moved = (before[id] ?? 0) * (id === species.oil ? oilFraction : aqueousFraction); if (moved > 0) masses[id] = moved; }
        const massKg = Object.values(masses).reduce((a, b) => a + b, 0);
        if (!massKg) return { massKg: 0, energyJ: 0, speciesMassKg: masses };
        const oil = this.oilEnergyJ[sourceIndex] * oilFraction, aqueous = this.aqueousEnergyJ[sourceIndex] * aqueousFraction;
        const energyJ = oil + aqueous;
        const receipt = transferMatterInventory({ sourceState: source, targetState: receiver, energyRoundoff: MATTER_ENERGY_ROUNDOFF_MODEL,
            inventory: { speciesMassKg: masses, internalEnergyJ: energyJ, momentumKgMPerS: [0, 0, 0], electricChargeC: 0 },
            eventId: `${this.namespace}:liquid-exchange:${this.sequence + 1}` });
        const sourceOil = this.oilEnergyJ[sourceIndex] - oil, sourceAqueous = this.aqueousEnergyJ[sourceIndex] - aqueous;
        const targetOil = target.oilEnergyJ[targetIndex] + oil, targetAqueous = target.aqueousEnergyJ[targetIndex] + aqueous;
        const after = this._projectPhaseTotals(receipt, new Map([[source.regionId, sourceOil + sourceAqueous], [receiver.regionId, targetOil + targetAqueous]]));
        this.states.set(sourceIndex, after[0]); target.states.set(targetIndex, after[1]);
        this.oilEnergyJ[sourceIndex] = sourceOil; this.aqueousEnergyJ[sourceIndex] = sourceAqueous;
        target.oilEnergyJ[targetIndex] = targetOil; target.aqueousEnergyJ[targetIndex] = targetAqueous;
        if (target !== this) { this.supportLedger.exchangedMassKg -= massKg; this.supportLedger.exchangedEnergyJ -= energyJ;
            this.supportLedger.exchangedWaterKg -= masses[species.water] ?? 0;
            target.supportLedger.exchangedWaterKg += masses[species.water] ?? 0;
            target.supportLedger.exchangedMassKg += massKg; target.supportLedger.exchangedEnergyJ += energyJ; }
        this.sequence++; if (target !== this) target.sequence++;
        this._syncCell(sourceIndex); target._syncCell(targetIndex);
        return { massKg, energyJ, speciesMassKg: masses };
    }
    /** Redirect finite exported gas heat to a contacted material. Gas mass
     * stays retained; the receiver must book the returned SI joules. */
    takeGasHeat(energyJ) {
        finite(energyJ, 'Gas heat exchange');
        const actual = Math.min(energyJ, this.gas.conserved.internalEnergyJ);
        if (actual > 0) {
            this.gas = replaceMatterInternalEnergy(this.gas, this.gas.conserved.internalEnergyJ - actual, { derived: null });
            this.ledger.heatToSubstrateJ += actual;
        }
        return actual;
    }
    /** The caller retains the returned steel owner. Iron, acid and products
     * share one atom-balanced extent; unreacted carbon remains in the wire. */
    reactIron(i, inputIron, { dt, areaM2 } = {}) {
        if (!this.supportChemistry) throw new RangeError('Iron reaction requires support chemistry');
        this._assertCell(i); finite(dt, 'Iron reaction step', Number.MIN_VALUE, .25); finite(areaM2, 'Iron contact area');
        const iron = snapshotMatterState(inputIron), cell = this.cell(i), original = iron.conserved.speciesMassKg;
        if (Object.keys(original).some(id => !['species:Fe', 'species:C'].includes(id))) throw new RangeError('Steel reaction received an incompatible solid owner');
        const fe = original['species:Fe'] ?? 0, p = SURFACE_IRON_PROFILE;
        let mol = Math.min(fe / p.ironMolarKg, cell.acidHClKg / (2 * M.hcl),
            areaM2 * p.dissolutionKgM2Second * Math.min(1, cell.hclMassFraction / .3) * cell.aqueousLiquidFraction * dt / p.ironMolarKg);
        if (!(mol > 0) || fe - mol * p.ironMolarKg === fe) return { state: iron, ironConsumedKg: 0, hydrogenProducedKg: 0 };
        const consumedFe = mol === fe / p.ironMolarKg ? fe : mol * p.ironMolarKg;
        const consumedHCl = mol === cell.acidHClKg / (2 * M.hcl) ? cell.acidHClKg : mol * 2 * M.hcl;
        const ferrous = mol * p.ferrousChlorideMolarKg, hydrogen = mol * p.hydrogenMolarKg;
        const mass = { ...this._owned(i).conserved.speciesMassKg, [species.acid]: Math.max(0, cell.acidHClKg - consumedHCl) };
        mass[species.ferrous] = (mass[species.ferrous] ?? 0) + ferrous;
        const ironEnergy = iron.conserved.internalEnergyJ * consumedFe / massSum(iron);
        const steel = replaceMatterConserved(iron, { ...iron.conserved, speciesMassKg: { ...original, 'species:Fe': Math.max(0, fe - consumedFe) },
            internalEnergyJ: Math.max(0, iron.conserved.internalEnergyJ - ironEnergy) }, { derived: null });
        const aqueous = this.aqueousEnergyJ[i] + (ferrous - consumedHCl) * soluteCp * cell.aqueousTemperatureK;
        const liquid = replaceMatterConserved(this._owned(i), { ...this._owned(i).conserved, speciesMassKg: mass,
            internalEnergyJ: this.oilEnergyJ[i] + aqueous }, { derived: null });
        const gas = replaceMatterConserved(this.gas, { ...this.gas.conserved, speciesMassKg: { ...this.gas.conserved.speciesMassKg,
            [species.hydrogen]: (this.gas.conserved.speciesMassKg[species.hydrogen] ?? 0) + hydrogen } }, { derived: null });
        const receipt = this.validator.assert(ironReaction(mol));
        this.states.set(i, liquid); this.gas = gas;
        this.ledger.reactionThermalClosureJ += aqueous - this.aqueousEnergyJ[i] - ironEnergy;
        this.aqueousEnergyJ[i] = aqueous;
        const l = this.supportLedger; l.ironAddedKg += consumedFe; l.ironAddedEnergyJ += ironEnergy;
        l.ironConsumedKg += consumedFe; l.hclConsumedKg += consumedHCl; l.hydrogenProducedKg += hydrogen; l.ferrousProducedKg += ferrous;
        this.lastReceipts.iron = receipt; this._syncCell(i);
        return { state: steel, ironConsumedKg: consumedFe, hydrogenProducedKg: hydrogen };
    }
    /** Transfer through the engine's existing conserved Matter operation. */
    _transfer(i, target, masses, energyJ, event, sourceEnergyJ = null) {
        const source = this._owned(i), sourceMasses = source.conserved.speciesMassKg;
        // Donor caps absorb only floating-point roundoff, never a missing mass.
        const moved = Object.fromEntries(Object.entries(masses).map(([id, mass]) => [id, Math.min(mass, sourceMasses[id] ?? 0)]));
        if (!Object.values(moved).some(value => value > 0)) return null;
        const actualEnergyJ = Math.min(energyJ, source.conserved.internalEnergyJ);
        const receipt = transferMatterInventory({ sourceState: source, targetState: target, energyRoundoff: MATTER_ENERGY_ROUNDOFF_MODEL,
            inventory: { speciesMassKg: moved, momentumKgMPerS: [0, 0, 0], internalEnergyJ: actualEnergyJ, electricChargeC: 0 },
            eventId: `surface:chemical-${event}:${++this.sequence}` });
        const after = sourceEnergyJ === null ? receipt.afterStates : this._projectPhaseTotals(receipt, new Map([[source.regionId, sourceEnergyJ]]));
        this.states.set(i, after[0]);
        return { target: after[1], masses: moved, energyJ: actualEnergyJ };
    }
    wipe(i, fraction) {
        finite(fraction, 'Chemical wipe fraction', 0, 1); const state = this.states.get(i); if (!state || !fraction) return;
        const masses = Object.fromEntries(liquidSpecies.filter(id => state.conserved.speciesMassKg[id] > 0).map(id => [id, state.conserved.speciesMassKg[id] * fraction]));
        const oil = this.oilEnergyJ[i] * (1 - fraction), aqueous = this.aqueousEnergyJ[i] * (1 - fraction);
        const moved = this._transfer(i, this.disposal, masses, state.conserved.internalEnergyJ * fraction, 'wipe', oil + aqueous); if (!moved) return;
        this.disposal = moved.target; this.oilEnergyJ[i] = oil; this.aqueousEnergyJ[i] = aqueous;
        this.ledger.discardedOilKg += moved.masses[species.oil] ?? 0; this.ledger.discardedHClKg += moved.masses[species.acid] ?? 0;
        this.ledger.wipedWaterKg += moved.masses[species.water] ?? 0; this._syncCell(i);
    }
    /** Aqueous flux is solvent-water equivalent m³, matching the existing GPU
     * finite-volume solver. Each donor moves its original composition and heat;
     * arriving liquid cannot be forwarded again during this simultaneous step. */
    transportPhase(phase, fluxM3, runoffContext = {}) {
        if (!['aqueous', 'oil'].includes(phase) || !(fluxM3 instanceof Float32Array) || fluxM3.length !== this.topology.count * 4) throw new RangeError('Invalid liquid transport');
        const oil = phase === 'oil', ids = oil ? [species.oil] : aqueousSpecies, density = oil ? SURFACE_OIL_PROFILE.densityKgM3 : 1000;
        const donors = new Map();
        for (let i = 0; i < this.topology.count; i++) {
            let total = 0; for (let k = 0; k < 4; k++) total += finite(fluxM3[i * 4 + k], 'Liquid flux', 0, 1e12);
            if (!total) continue;
            const masses = this.states.get(i)?.conserved.speciesMassKg;
            const volume = (masses?.[oil ? species.oil : species.water] ?? 0) / density;
            if (total > volume + Math.max(1e-12, volume * 2e-6)) throw new RangeError('Liquid flux exceeds donor inventory');
            if (!volume) continue;
            const energyJ = oil ? this.oilEnergyJ[i] : this.aqueousEnergyJ[i];
            donors.set(i, { masses, energyJ, remainingMasses: { ...masses }, remainingEnergyJ: energyJ,
                phaseMassKg: ids.reduce((sum, id) => sum + (masses[id] ?? 0), 0), volume, scale: Math.min(1, volume / total) });
        }
        const states = [], indices = new Map(), slots = new Map(), packed = this._transportScratch[phase], stride = ids.length + 5;
        packed.quantities.fill(0); let transferCount = 0;
        const phaseOwner = oil ? this.oilEnergyJ : this.aqueousEnergyJ, phaseEnergies = phaseOwner.slice();
        const incomingEnergyJ = new Float64Array(this.topology.count);
        let outflowWaterKg = 0, blockedVolumeM3 = 0;
        const parcels = [], parcelOwners = new Map();
        const includeOwner = index => {
            const state = typeof index === 'string' ? parcelOwners.get(index).state : index === SURFACE_NO_NEIGHBOR ? this.outflow : this._owned(index);
            if (!slots.has(state.regionId)) { slots.set(state.regionId, states.length); states.push(state); indices.set(state.regionId, index); }
            return slots.get(state.regionId);
        };
        for (const [i, donor] of donors) for (let k = 0; k < 4; k++) {
            const fraction = fluxM3[i * 4 + k] * donor.scale / donor.volume; if (!fraction) continue;
            let j = this.runoff.motion?.neighbors[i * 4 + k] ?? this.topology.neighbors[i * 4 + k]; if (j === i) continue;
            let parcel = null;
            if (this.runoff.enabled && this.runoff.edges.has(i * 4 + k)) {
                const phaseVolumeM3 = oil ? (donor.masses[species.oil] ?? 0) / SURFACE_OIL_PROFILE.densityKgM3 : aqueousVolume(donor.masses);
                // Submillimetre remnants accumulate in their finite donor;
                // numerical trace films do not allocate an airborne owner.
                if (phaseVolumeM3 * fraction < 1e-9) continue;
                const cell = this.phaseGeometry(i), area = this.topology.meta[i * 8 + 3];
                parcel = this.runoff.plan(i * 4 + k, phase, { ...runoffContext, timeSeconds: this.timeSeconds,
                    removedDepthM: runoffContext.removedDepth?.(i) ?? this.cell(i).removedSolidDepthM,
                    liquidDepthM: (cell.aqueousVolumeM3 + cell.oilKg / SURFACE_OIL_PROFILE.densityKgM3) / area }, parcels.length);
                if (!parcel) { blockedVolumeM3 += fluxM3[i * 4 + k] * donor.scale; continue; }
            }
            const offset = transferCount * stride; let positiveMass = false, waterKg = 0, movedMassKg = 0;
            for (let lane = 0; lane < ids.length; lane++) {
                const id = ids[lane], mass = (donor.masses[id] ?? 0) > 0 ? Math.min(donor.remainingMasses[id], donor.masses[id] * fraction) : 0;
                packed.quantities[offset + lane] = mass;
                if (mass > 0) { donor.remainingMasses[id] -= mass; movedMassKg += mass; positiveMass = true; }
                if (id === species.water) waterKg = mass;
            }
            if (!positiveMass) continue;
            if (parcel) {
                parcel.state = createMatterEmptyState(this._emptyOwnerTemplate, `surface:chemical-runoff:${parcel.id}`);
                j = parcel.state.regionId; parcelOwners.set(j, parcel); parcels.push(parcel);
            }
            // Carry heat with the actual capped mass withdrawal. Independent
            // fractional subtraction can otherwise leave finite heat behind
            // after its last representable mass has left the donor.
            const remainingMass = ids.reduce((sum, id) => sum + (donor.remainingMasses[id] ?? 0), 0);
            const retainedEnergyJ = donor.energyJ * (remainingMass / donor.phaseMassKg);
            const energyJ = Math.min(donor.remainingEnergyJ, donor.energyJ * (movedMassKg / donor.phaseMassKg));
            donor.remainingEnergyJ -= energyJ;
            packed.sourceIndices[transferCount] = includeOwner(i); packed.targetIndices[transferCount] = includeOwner(j);
            packed.quantities[offset + ids.length + 3] = energyJ; transferCount++;
            phaseEnergies[i] = retainedEnergyJ;
            if (typeof j === 'number' && j !== SURFACE_NO_NEIGHBOR) incomingEnergyJ[j] += energyJ;
            if (j === SURFACE_NO_NEIGHBOR) outflowWaterKg += waterKg;
        }
        if (transferCount) {
            for (let i = 0; i < phaseEnergies.length; i++) phaseEnergies[i] += incomingEnergyJ[i];
            const packedTransfers = { speciesIds: packed.speciesIds, sourceIndices: packed.sourceIndices.subarray(0, transferCount),
                targetIndices: packed.targetIndices.subarray(0, transferCount), quantities: packed.quantities.subarray(0, transferCount * stride) };
            const receipt = transferMatterInventories({ states, packedTransfers, eventId: `surface:chemical-transport-${phase}:${this.sequence + 1}`, energyRoundoff: MATTER_ENERGY_ROUNDOFF_MODEL });
            const otherPhase = oil ? this.aqueousEnergyJ : this.oilEnergyJ;
            const totals = new Map([...indices].filter(([, i]) => typeof i === 'number' && i !== SURFACE_NO_NEIGHBOR).map(([id, i]) => [id, phaseEnergies[i] + otherPhase[i]]));
            // No retained state, partition, ledger or sequence advances until
            // the shared batch validates every donor and its conservation.
            for (const state of this._projectPhaseTotals(receipt, totals)) {
                const i = indices.get(state.regionId);
                if (typeof i === 'string') parcelOwners.get(i).state = state;
                else if (i === SURFACE_NO_NEIGHBOR) this.outflow = state; else this.states.set(i, state);
            }
            this.runoff.commit(parcels);
            phaseOwner.set(phaseEnergies);
            this.ledger.outflowWaterKg += outflowWaterKg; this.sequence++;
            for (const i of indices.values()) if (typeof i === 'number' && i !== SURFACE_NO_NEIGHBOR) this._syncCell(i);
        }
        this.runoff.blockedVolumeM3 += blockedVolumeM3;
    }
    /** A parcel leaves the airborne inventory only when its physical impact
     * has completed. Batch all arrivals and preserve each phase's exact heat. */
    advanceRunoff(timeSeconds) {
        finite(timeSeconds, 'Runoff material time');
        const arrived = [...this.runoff.parcels.values()].filter(parcel => parcel.impactTime <= timeSeconds);
        if (!arrived.length) return;
        const states = [], slots = new Map(), cells = new Map();
        const include = state => {
            if (!slots.has(state.regionId)) { slots.set(state.regionId, states.length); states.push(state); }
            return slots.get(state.regionId);
        };
        const stride = liquidSpecies.length + 5;
        const packed = this._runoffTransferScratch ??= { speciesIds: liquidSpecies,
            sourceIndices: new Uint32Array(this.runoff.capacity), targetIndices: new Uint32Array(this.runoff.capacity),
            quantities: new Float64Array(this.runoff.capacity * stride) };
        packed.quantities.fill(0, 0, arrived.length * stride); let row = 0;
        const oil = this.oilEnergyJ.slice(), aqueous = this.aqueousEnergyJ.slice();
        for (const parcel of arrived) {
            const destination = this._owned(parcel.destinationIndex), conserved = parcel.state.conserved;
            packed.sourceIndices[row] = include(parcel.state); packed.targetIndices[row] = include(destination);
            cells.set(destination.regionId, parcel.destinationIndex);
            for (let lane = 0; lane < liquidSpecies.length; lane++) packed.quantities[row * stride + lane] = conserved.speciesMassKg[liquidSpecies[lane]] ?? 0;
            packed.quantities[row * stride + liquidSpecies.length + 3] = conserved.internalEnergyJ; row++;
            (parcel.phase === 'oil' ? oil : aqueous)[parcel.destinationIndex] += conserved.internalEnergyJ;
        }
        // Reuse the same validated packed transfer path as surface transport.
        // Every parcel remains a distinct donor; no phase or owner is merged.
        const packedTransfers = { speciesIds: packed.speciesIds, sourceIndices: packed.sourceIndices.subarray(0, row),
            targetIndices: packed.targetIndices.subarray(0, row), quantities: packed.quantities.subarray(0, row * stride) };
        const receipt = transferMatterInventories({ states, packedTransfers, eventId: `surface:runoff-impact:${this.sequence + 1}`, energyRoundoff: MATTER_ENERGY_ROUNDOFF_MODEL });
        const totals = new Map([...cells].map(([id, i]) => [id, oil[i] + aqueous[i]]));
        const after = this._projectPhaseTotals(receipt, totals);
        for (const state of after) if (cells.has(state.regionId)) this.states.set(cells.get(state.regionId), state);
        this.oilEnergyJ.set(oil); this.aqueousEnergyJ.set(aqueous);
        for (const parcel of arrived) this.runoff.parcels.delete(parcel.id);
        this.runoff.depositedCount += arrived.length; this.sequence++;
        for (const i of cells.values()) this._syncCell(i);
    }
    /** Read-only GPU carrier. Its volume and radius derive from the same
     * retained species owner used for deposition and conservation. */
    runoffFrame() {
        const frame = new Float32Array(this.runoff.parcels.size * SURFACE_RUNOFF_STRIDE); let index = 0;
        for (const parcel of this.runoff.parcels.values()) {
            const masses = parcel.state.conserved.speciesMassKg, energy = parcel.state.conserved.internalEnergyJ, oil = parcel.phase === 'oil';
            const mass = oil ? masses[species.oil] : aqueousMass(masses), volume = oil ? mass / SURFACE_OIL_PROFILE.densityKgM3 : aqueousVolume(masses);
            const temperature = oil ? energy / (mass * cp) : aqueousThermal(masses, energy).temperatureK;
            frame.set([...parcel.origin, parcel.birthTime, ...parcel.velocity, parcel.impactTime,
                Math.cbrt(3 * volume / (4 * Math.PI)), Number(oil), oil ? 0 : (masses[species.acid] ?? 0) / mass, temperature,
                ...parcel.destination, volume], index); index += SURFACE_RUNOFF_STRIDE;
        }
        return frame;
    }
    /** Selective water transport: native wood takes liquid solvent, while
     * evaporation exports vapor only after its retained latent energy is paid.
     * HCl and CaCl2 remain in the aqueous owner under this declared closure. */
    takeAqueousWater(i, massKg, { kind = 'absorption' } = {}) {
        const { index, ...result } = this.takeAqueousWaters([{ index: i, waterKg: massKg }], { kind })[0];
        return result;
    }
    /** Batched solvent export preserves each source's own temperature and
     * phase energy. Each result maps to the corresponding requested cell. */
    takeAqueousWaters(entries, { kind = 'absorption' } = {}) {
        if (!['absorption', 'evaporation'].includes(kind)) throw new RangeError('Invalid aqueous water transfer');
        const inputs = cloneStrictJson(entries, '$.surfaceWaterExports');
        if (!Array.isArray(inputs)) throw new RangeError('Water exports must be an array');
        const evaporation = kind === 'evaporation', target = evaporation ? this.gas : this.absorbed;
        const states = [target], owners = new Map(), indices = new Set(), results = [];
        let packed = null;
        let movedMass = 0, movedEnergy = 0;
        for (const entry of inputs) {
            const i = entry?.index, massKg = finite(entry?.waterKg, 'Removed aqueous water'), cell = this.cell(i);
            if (indices.has(i)) throw new RangeError('Water exports must have unique cell owners'); indices.add(i);
            const amount = Math.min(massKg, cell.waterKg * (evaporation ? cell.aqueousVaporFraction : cell.aqueousLiquidFraction));
            const temperatureK = Math.max(0, Math.min(2000, cell.aqueousTemperatureK));
            const wholePhase = amount === cell.waterKg && !cell.acidHClKg && !cell.dissolvedCaCl2Kg && !cell.dissolvedFeCl2Kg;
            const energyJ = amount > 0 ? wholePhase ? cell.aqueousEnergyJ
                : Math.min(cell.aqueousEnergyJ, amount * waterEnthalpy(temperatureK, evaporation ? 'vapor' : 'water')) : 0;
            results.push({ index: i, waterKg: amount, energyJ, temperatureK,
                sensibleEnergyJ: amount > 0 ? amount * WT.specificHeatLiquidJPerKgK * (temperatureK - ambientK) : 0 });
            if (!(amount > 0)) continue;
            packed ??= { speciesIds: [species.water], sourceIndices: new Uint32Array(inputs.length), targetIndices: new Uint32Array(inputs.length), quantities: new Float64Array(inputs.length * 6) };
            const source = this._owned(i); states.push(source); owners.set(source.regionId, i);
            const row = states.length - 2;
            packed.sourceIndices[row] = states.length - 1;
            packed.quantities[row * 6] = amount; packed.quantities[row * 6 + 4] = energyJ;
            movedMass += amount; movedEnergy += energyJ;
        }
        const transferCount = states.length - 1;
        if (transferCount) {
            const packedTransfers = { speciesIds: packed.speciesIds, sourceIndices: packed.sourceIndices.subarray(0, transferCount),
                targetIndices: packed.targetIndices.subarray(0, transferCount), quantities: packed.quantities.subarray(0, transferCount * 6) };
            const receipt = transferMatterInventories({ states, packedTransfers, eventId: `surface:chemical-${kind}:${this.sequence + 1}`, energyRoundoff: MATTER_ENERGY_ROUNDOFF_MODEL });
            const aqueous = this.aqueousEnergyJ.slice(); for (const result of results) aqueous[result.index] = Math.max(0, aqueous[result.index] - result.energyJ);
            const totals = new Map([...owners].map(([id, i]) => [id, this.oilEnergyJ[i] + aqueous[i]]));
            for (const state of this._projectPhaseTotals(receipt, totals)) {
                if (owners.has(state.regionId)) this.states.set(owners.get(state.regionId), state);
                else if (evaporation) this.gas = state; else this.absorbed = state;
            }
            if (evaporation) { this.ledger.evaporatedWaterKg += movedMass; this.ledger.evaporatedWaterEnergyJ += movedEnergy; }
            else { this.ledger.absorbedWaterKg += movedMass; this.ledger.absorbedWaterEnergyJ += movedEnergy; }
            this.aqueousEnergyJ.set(aqueous);
            this.sequence++; for (const i of owners.values()) this._syncCell(i);
        }
        return results;
    }
    step(dt, { ambientTemperatureK = ambientK, substrateTemperature, transferHeat } = {}) {
        finite(dt, 'Chemical timestep', Number.MIN_VALUE, .25); finite(ambientTemperatureK, 'Chemical ambient temperature', 1, 5000);
        this.rates.fill(0); this.gasSourceRates.fill(0); this.evaporationRates.fill(0);
        let oilMol = 0, carbonateMol = 0, gasCO2 = 0, gasWater = 0, gasEnergyJ = 0;
        const evaporationRequests = [];
        for (const [i, current] of this.states) {
            const area = this.topology.meta[i * 8 + 3];
            // Heat exchange does not alter composition. Keep the canonical
            // inventory until a reaction needs a private writable candidate.
            let masses = current.conserved.speciesMassKg;
            let oilEnergy = this.oilEnergyJ[i], aqueous = this.aqueousEnergyJ[i];
            const oilKg = masses[species.oil] ?? 0, aqMass = aqueousMass(masses), water = masses[species.water] ?? 0;
            const aqCapacity = water * WT.specificHeatLiquidJPerKgK + (aqMass - water) * soluteCp;
            const oilCapacity = oilKg * cp;
            if (oilKg > 0 && aqMass > 0) {
                const aqT = aqueousThermal(masses, aqueous).temperatureK, oilT = oilEnergy / oilCapacity;
                const equilibriumCapacity = 1 / (1 / oilCapacity + 1 / aqCapacity);
                const proposed = (oilT - aqT) * Math.min(area * SURFACE_LIQUID_CLOSURE.oilWaterContactWPerM2K * dt, equilibriumCapacity * .5);
                // Bound the donor and receiver in the proposed direction.
                // A donor can be a few ULPs above its temperature cap; forcing
                // that residual into a trace receiving film invents enormous
                // specific enthalpy when the receiver cannot hold that heat.
                const exchange = proposed >= 0
                    ? Math.min(proposed, Math.max(0, oilEnergy - oilCapacity), Math.max(0, aqueousEnergy(masses, 2000) - aqueous))
                    : -Math.min(-proposed, Math.max(0, aqueous - aqueousEnergy(masses, 1)), Math.max(0, oilCapacity * 1500 - oilEnergy));
                oilEnergy -= exchange; aqueous += exchange;
            }
            for (const phase of ['aqueous', 'oil']) {
                const isOil = phase === 'oil', capacity = isOil ? oilCapacity : aqCapacity;
                if (!(capacity > 0)) continue;
                let energy = isOil ? oilEnergy : aqueous;
                let t = isOil ? energy / capacity : aqueousThermal(masses, energy).temperatureK;
                const cover = isOil ? 1 : Math.max(0, 1 - oilKg / (SURFACE_OIL_PROFILE.densityKgM3 * area * SURFACE_LIQUID_CLOSURE.oilCoverageDepthM));
                const boundaryW = cover * area * (8 * (ambientTemperatureK - t) + .9 * STEFAN_BOLTZMANN * (ambientTemperatureK ** 4 - t ** 4));
                const minimumEnergy = isOil ? capacity : aqueousEnergy(masses, 1);
                const maximumEnergy = isOil ? capacity * 1500 : aqueousEnergy(masses, 2000);
                const boundaryTemperature = Math.max(1, Math.min(isOil ? 1500 : 2000, ambientTemperatureK));
                const boundaryTarget = isOil ? capacity * boundaryTemperature : aqueousEnergy(masses, boundaryTemperature);
                const boundaryJ = Math.max(Math.min(0, boundaryTarget - energy), Math.min(boundaryW * dt, Math.max(0, boundaryTarget - energy)));
                energy += boundaryJ; this.ledger.boundaryHeatJ += boundaryJ;
                t = isOil ? energy / capacity : aqueousThermal(masses, energy).temperatureK;
                // The aqueous layer contacts the substrate; oil contacts it
                // only where there is no retained aqueous material beneath it.
                if ((!isOil || !aqMass) && typeof substrateTemperature === 'function' && typeof transferHeat === 'function') {
                    const substrateT = finite(substrateTemperature(i), 'Liquid substrate temperature', 1, 1e6);
                    const conductance = isOil ? SURFACE_OIL_PROFILE.contactWPerM2K : SURFACE_LIQUID_CLOSURE.aqueousContactWPerM2K;
                    const rawJ = (t - substrateT) * Math.min(area * conductance * dt, capacity * .1);
                    const proposedJ = Math.max(energy - maximumEnergy, Math.min(rawJ, energy - minimumEnergy));
                    const actualJ = finite(transferHeat(i, proposedJ, { phase }), 'Liquid heat transfer', -1e15, 1e15);
                    if (actualJ * proposedJ < 0 || Math.abs(actualJ) > Math.abs(proposedJ) + 1e-7) {
                        throw new RangeError(`Substrate heat transfer exceeded the proposed exchange: cell ${i}, phase ${phase}, proposed ${proposedJ} J, accepted ${actualJ} J`);
                    }
                    energy -= actualJ; this.ledger.heatToSubstrateJ += actualJ;
                }
                if (isOil) oilEnergy = energy; else aqueous = energy;
            }
            if (oilKg > 0 && oilEnergy / oilCapacity >= SURFACE_OIL_PROFILE.ignitionTemperatureK) {
                const burned = Math.min(oilKg, area * SURFACE_OIL_PROFILE.densityKgM3 * SURFACE_OIL_PROFILE.regressionMPerSecond * dt);
                const mol = burned / M.oil, sensible = oilEnergy * burned / oilKg, released = burned * SURFACE_OIL_PROFILE.heatOfCombustionJPerKg;
                const remaining = Math.max(0, oilKg - burned), feedback = Math.min(released * SURFACE_OIL_PROFILE.heatFeedbackFraction, Math.max(0, remaining * cp * 1500 - oilEnergy + sensible));
                masses = { ...masses };
                oilEnergy = remaining > 0 ? oilEnergy - sensible + feedback : 0; masses[species.oil] = remaining;
                oilMol += mol; gasCO2 += 12 * M.co2 * mol; gasWater += 13 * M.water * mol; gasEnergyJ += sensible + released - feedback;
                this.gasSourceRates[i * 2] = (sensible + released - feedback) / dt; this.gasSourceRates[i * 2 + 1] = (12 * M.co2 + 13 * M.water) * mol / dt;
                this.ledger.oxygenConsumedKg += 18.5 * M.oxygen * mol; this.ledger.oilBurnedKg += burned; this.ledger.combustionHeatJ += released;
                this.rates[i * 3] = burned / dt; this.rates[i * 3 + 2] += 12 * M.co2 * mol / dt;
            }
            const hcl = masses[species.acid] ?? 0, carbonate = masses[species.carbonate] ?? 0;
            let thermal = aqueousThermal(masses, aqueous);
            if (hcl > 0 && carbonate > 0 && thermal.liquidFraction > 0) {
                const concentration = Math.min(1, hcl / Math.max(aqueousMass(masses), 1e-30) / SURFACE_ACID_PROFILE.hclMassFraction);
                let mol = Math.min(carbonate / M.carbonate, hcl / (2 * M.hcl), area * SURFACE_ACID_PROFILE.carbonateRateKgM2Second * concentration * thermal.liquidFraction * dt / M.carbonate);
                // Preserve sub-ULP trace reagent rather than reporting a
                // reaction which cannot change the finite mineral inventory.
                if (carbonate - mol * M.carbonate === carbonate) mol = 0;
                const removed = mol === carbonate / M.carbonate ? carbonate : mol * M.carbonate;
                const consumed = mol === hcl / (2 * M.hcl) ? hcl : mol * 2 * M.hcl;
                const salt = mol * M.salt, producedWater = mol * M.water, co2 = mol * M.co2;
                if (masses === current.conserved.speciesMassKg) masses = { ...masses };
                masses[species.carbonate] = Math.max(0, carbonate - removed); masses[species.acid] = Math.max(0, hcl - consumed);
                masses[species.salt] = (masses[species.salt] ?? 0) + salt; masses[species.water] = (masses[species.water] ?? 0) + producedWater;
                // Reference enthalpies differ between reactants/products. The
                // isothermal reduced chemistry records that unresolved heat,
                // preventing spurious freezing without claiming calorimetry.
                const retainedWaterEnthalpy = water > 0
                    ? (aqueous - (aqMass - water) * soluteCp * thermal.temperatureK) / water
                    : waterEnthalpy(Math.min(2000, thermal.temperatureK), 'water');
                const nextAqueous = aqueous + producedWater * retainedWaterEnthalpy + (salt - consumed) * soluteCp * thermal.temperatureK;
                this.ledger.reactionThermalClosureJ += nextAqueous - aqueous; aqueous = nextAqueous;
                carbonateMol += mol; gasCO2 += co2; this.ledger.carbonateConsumedKg += removed; this.ledger.saltProducedKg += salt;
                this.ledger.waterProducedKg += producedWater; this.ledger.reactionLiquidWaterKg += producedWater;
                this.rates[i * 3 + 1] = removed / dt; this.rates[i * 3 + 2] += co2 / dt;
                thermal = aqueousThermal(masses, aqueous);
            }
            this.oilEnergyJ[i] = Math.max(0, oilEnergy); this.aqueousEnergyJ[i] = Math.max(0, aqueous);
            this._replace(i, masses, this.aqueousEnergyJ[i] + this.oilEnergyJ[i]);
            // The export boundary would return zero for a non-vapor film.
            // Reuse this phase calculation instead of cloning and deriving
            // every cold-water owner again in the solvent export batch.
            if ((masses[species.water] ?? 0) > 0 && thermal.vaporFraction > 0) evaporationRequests.push({ index: i, waterKg: masses[species.water] });
        }
        for (const result of this.takeAqueousWaters(evaporationRequests, { kind: 'evaporation' })) this.evaporationRates[result.index] = result.waterKg / dt;
        if (oilMol > 0) this.lastReceipts.oil = this.validator.assert(reaction('oil', oilMol));
        if (carbonateMol > 0) this.lastReceipts.acid = this.validator.assert(reaction('acid', carbonateMol));
        if (gasCO2 > 0 || gasWater > 0) {
            const mass = { ...this.gas.conserved.speciesMassKg };
            mass[species.co2] = (mass[species.co2] ?? 0) + gasCO2; mass[species.water] = (mass[species.water] ?? 0) + gasWater;
            this.gas = replaceMatterConserved(this.gas, { ...this.gas.conserved, speciesMassKg: mass,
                internalEnergyJ: this.gas.conserved.internalEnergyJ + gasEnergyJ }, { derived: null });
            this.ledger.co2ProducedKg += gasCO2; this.ledger.waterProducedKg += gasWater;
        }
        this.timeSeconds += dt; this.steps++; this.advanceRunoff(this.timeSeconds); this.sync(); return this.stats();
    }
    _syncCell(i) {
        const cell = this.cell(i), area = this.topology.meta[i * 8 + 3], oilDepth = cell.oilKg / (area * SURFACE_OIL_PROFILE.densityKgM3);
        this.auxiliary.set([oilDepth, cell.aqueousVolumeM3 / area, cell.removedSolidDepthM, cell.acidReactionKgPerSecond / area,
            cell.oilBurnKgPerSecond / area, cell.co2KgPerSecond / area], i * 8);
        this.liquidProperties.set([cell.hclMassFraction, cell.aqueousTemperatureK, cell.aqueousVolumeM3 / area,
            Math.min(1, oilDepth / SURFACE_LIQUID_CLOSURE.oilCoverageDepthM)], i * 4);
    }
    sync() { for (let i = 0; i < this.topology.count; i++) this._syncCell(i); }
    stats() {
        let oilKg = 0, acidHClKg = 0, carbonateKg = 0, dissolvedKg = 0, freeWaterKg = 0, aqueousMassKg = 0, aqueousVolumeM3 = 0;
        let aqueousEnergyJ = 0, oilEnergyJ = 0, oilBurnKgPerSecond = 0, acidReactionKgPerSecond = 0;
        let trackedMassKg = 0, storedEnergyJ = 0, airborneWaterKg = 0, airborneOilKg = 0, airborneHClKg = 0, airborneSaltKg = 0, airborneEnergyJ = 0;
        for (const { state } of this.runoff.parcels.values()) {
            const masses = state.conserved.speciesMassKg;
            airborneWaterKg += masses[species.water] ?? 0; airborneOilKg += masses[species.oil] ?? 0;
            airborneHClKg += masses[species.acid] ?? 0; airborneSaltKg += (masses[species.salt] ?? 0) + (masses[species.ferrous] ?? 0);
            airborneEnergyJ += state.conserved.internalEnergyJ;
            trackedMassKg += massSum(state); storedEnergyJ += state.conserved.internalEnergyJ;
        }
        for (const state of [this.gas, this.disposal, this.outflow, this.absorbed]) { trackedMassKg += massSum(state); storedEnergyJ += state.conserved.internalEnergyJ; }
        for (const [i, state] of this.states) {
            const masses = state.conserved.speciesMassKg, water = masses[species.water] ?? 0, acid = masses[species.acid] ?? 0, salt = masses[species.salt] ?? 0;
            oilKg += masses[species.oil] ?? 0; acidHClKg += acid; carbonateKg += masses[species.carbonate] ?? 0; dissolvedKg += salt;
            const ferrous = masses[species.ferrous] ?? 0;
            freeWaterKg += water; aqueousMassKg += water + acid + salt + ferrous; aqueousVolumeM3 += aqueousVolume(masses); dissolvedKg += ferrous;
            aqueousEnergyJ += this.aqueousEnergyJ[i]; oilEnergyJ += this.oilEnergyJ[i];
            trackedMassKg += massSum(state); storedEnergyJ += state.conserved.internalEnergyJ;
            oilBurnKgPerSecond += this.rates[i * 3]; acidReactionKgPerSecond += this.rates[i * 3 + 1];
        }
        const l = this.ledger, sl = this.supportLedger, expectedMassKg = l.initialCarbonateKg + l.oilAddedKg + l.acidHClAddedKg + l.acidWaterAddedKg + l.externalWaterAddedKg + l.oxygenConsumedKg + sl.exchangedMassKg + sl.ironAddedKg;
        const expectedEnergyJ = l.oilAddedSensibleJ + l.aqueousAddedEnergyJ + l.externalHeatJ + l.aqueousExternalHeatJ + l.boundaryHeatJ + l.combustionHeatJ
            + l.reactionThermalClosureJ + l.legacyThermalReferenceJ - l.heatToSubstrateJ + sl.exchangedEnergyJ + sl.ironAddedEnergyJ;
        return { oilKg, acidHClKg, acidMol: acidHClKg / M.hcl, carbonateKg, dissolvedKg, freeWaterKg, aqueousMassKg, aqueousVolumeM3,
            aqueousEnergyJ, oilEnergyJ, oilBurnKgPerSecond, acidReactionKgPerSecond,
            runoffCount: this.runoff.parcels.size, airborneWaterKg, airborneOilKg, airborneHClKg, airborneSaltKg, airborneEnergyJ,
            runoffBlockedVolumeM3: this.runoff.blockedVolumeM3, runoffDepositedCount: this.runoff.depositedCount,
            externalWaterAddedKg: l.externalWaterAddedKg, absorbedWaterKg: l.absorbedWaterKg, absorbedWaterEnergyJ: l.absorbedWaterEnergyJ,
            evaporatedWaterKg: l.evaporatedWaterKg, evaporatedWaterEnergyJ: l.evaporatedWaterEnergyJ, outflowWaterKg: l.outflowWaterKg,
            wipedWaterKg: l.wipedWaterKg, reactionLiquidWaterKg: l.reactionLiquidWaterKg,
            chemicalMassResidualKg: expectedMassKg - trackedMassKg, chemicalEnergyResidualJ: expectedEnergyJ - storedEnergyJ,
            chemicalLedger: { ...l, expectedMassKg, trackedMassKg, expectedEnergyJ, storedEnergyJ },
            ...(this.supportChemistry ? { supportLedger: { ...sl } } : {}),
            assumptions: [SURFACE_OIL_PROFILE.scope, SURFACE_ACID_PROFILE.scope, SURFACE_LIQUID_CLOSURE.scope,
                'Atmospheric oxygen is a prescribed reservoir. Gas, runoff, wipe and absorbed-water export obligations retain their masses and energy. Solvent-only absorption leaves HCl/CaCl2 at the surface; humidity drying, diffusion into wood and electrolyte phase equilibria are not solved.',
                'Water phase changes retain their enthalpy, but lateral transport treats the aqueous inventory as a homogeneous film. Frozen-film adhesion, ice/slush mechanics and phase-dependent mobility are not solved.'] };
    }
    snapshot() {
        const retainRunoff = this.runoff.enabled || this.runoff.nextId > 1 || this.runoff.blockedVolumeM3 > 0;
        return { schema: 'engine.surface-chemical-inventory', version: this.supportChemistry ? 4 : retainRunoff ? 3 : 2, definitionHash: this.definitionHash, topologyIdentity: this.topology.identity,
            ...(this.supportChemistry ? { namespace: this.namespace, supportLedger: { ...this.supportLedger } } : {}),
            ...(retainRunoff ? { runoff: this.runoff.snapshot() } : {}),
            states: [...this.states].map(([index, state]) => ({ index, state })), gas: this.gas, disposal: this.disposal, outflow: this.outflow, absorbed: this.absorbed,
            initialCarbonateKg: [...this.initialCarbonateKg], rates: [...this.rates], gasSourceRates: [...this.gasSourceRates], oilEnergyJ: [...this.oilEnergyJ],
            aqueousEnergyJ: [...this.aqueousEnergyJ],
            evaporationRates: [...this.evaporationRates], ledger: { ...this.ledger }, sequence: this.sequence, steps: this.steps, timeSeconds: this.timeSeconds };
    }
    restore(input) {
        const snapshot = cloneStrictJson(input, '$.surfaceChemistry'), legacy = snapshot.version === 1;
        const extended = snapshot.version === 4;
        if (snapshot.schema !== 'engine.surface-chemical-inventory' || ![1, 2, 3, 4].includes(snapshot.version)
            || snapshot.definitionHash !== (legacy ? legacyDefinitionHash : extended ? supportDefinitionHash : definitionHash)
            || snapshot.topologyIdentity !== this.topology.identity || extended && (!this.supportChemistry || snapshot.namespace !== this.namespace)
            || !extended && this.namespace !== 'surface') throw new RangeError('Incompatible chemical inventory snapshot');
        const replacement = new SurfaceFieldChemicalInventory(this.topology, { runoff: this.runoff.enabled, runoffCapacity: this.runoff.capacity,
            supportChemistry: this.supportChemistry, namespace: this.namespace }), states = new Map();
        replacement._restoringDefinitionHash = snapshot.definitionHash;
        if (extended) for (const key of Object.keys(replacement.supportLedger)) replacement.supportLedger[key] = finite(snapshot.supportLedger?.[key], `Support ledger ${key}`,
            key.startsWith('exchanged') ? -1e30 : 0, 1e30);
        if (extended) {
            const ledger = replacement.supportLedger, mol = ledger.ironConsumedKg / SURFACE_IRON_PROFILE.ironMolarKg;
            for (const [actual, expected] of [[ledger.ironAddedKg, ledger.ironConsumedKg], [ledger.hclConsumedKg, 2 * M.hcl * mol],
                [ledger.hydrogenProducedKg, SURFACE_IRON_PROFILE.hydrogenMolarKg * mol], [ledger.ferrousProducedKg, SURFACE_IRON_PROFILE.ferrousChlorideMolarKg * mol]]) {
                if (Math.abs(actual - expected) > Math.max(1e-10, Math.abs(expected) * 1e-9)) throw new RangeError('Support reaction ledger is not stoichiometric');
            }
        }
        if (!Array.isArray(snapshot.states) || snapshot.states.length > this.topology.count || !Array.isArray(snapshot.initialCarbonateKg)
            || snapshot.initialCarbonateKg.length !== this.topology.count || !Array.isArray(snapshot.rates) || snapshot.rates.length !== this.rates.length) throw new RangeError('Invalid chemical inventory dimensions');
        for (let i = 0; i < this.topology.count; i++) if (snapshot.initialCarbonateKg[i] !== replacement.initialCarbonateKg[i]) throw new RangeError('Checkpoint changed calcite initial mass');
        for (const entry of snapshot.states) {
            if (!Number.isInteger(entry.index) || entry.index < 0 || entry.index >= this.topology.count || states.has(entry.index)) throw new RangeError('Invalid chemical cell ownership');
            let state = replacement._retainedState(entry.state, `surface:chemical-cell:${entry.index}`, [...liquidSpecies, species.carbonate], legacy);
            if ((state.conserved.speciesMassKg[species.carbonate] ?? 0) > replacement.initialCarbonateKg[entry.index]) throw new RangeError('Checkpoint changed available mineral');
            if (legacy) {
                if (!(state.conserved.speciesMassKg[species.oil] > 0) && state.conserved.internalEnergyJ !== 0) throw new RangeError('Legacy liquid energy has no retained oil owner');
                replacement.oilEnergyJ[entry.index] = state.conserved.internalEnergyJ;
                const energy = aqueousEnergy(state.conserved.speciesMassKg, ambientK);
                replacement.aqueousEnergyJ[entry.index] = energy;
                replacement.ledger.legacyThermalReferenceJ += energy;
                state = replacement._state(state.regionId, state.conserved.speciesMassKg, state.conserved.internalEnergyJ + energy, state.revision);
            }
            states.set(entry.index, state);
        }
        for (let i = 0; i < this.topology.count; i++) if (replacement.initialCarbonateKg[i] > 0 && !states.has(i)) throw new RangeError('Checkpoint discarded a calcite cell owner');
        const oldKeys = ['initialCarbonateKg', 'oilAddedKg', 'acidHClAddedKg', 'acidWaterAddedKg', 'oxygenConsumedKg', 'oilBurnedKg', 'carbonateConsumedKg',
            'saltProducedKg', 'co2ProducedKg', 'waterProducedKg', 'oilAddedSensibleJ', 'externalHeatJ', 'boundaryHeatJ', 'combustionHeatJ', 'heatToSubstrateJ', 'discardedOilKg', 'discardedHClKg'];
        const signed = ['externalHeatJ', 'aqueousExternalHeatJ', 'boundaryHeatJ', 'heatToSubstrateJ', 'reactionThermalClosureJ', 'legacyThermalReferenceJ'];
        for (const key of legacy ? oldKeys : Object.keys(replacement.ledger)) finite(snapshot.ledger?.[key], `Chemical ledger ${key}`, signed.includes(key) ? -1e30 : 0, 1e30);
        if (snapshot.ledger.initialCarbonateKg !== replacement.ledger.initialCarbonateKg) throw new RangeError('Checkpoint changed initial mineral inventory');
        replacement.gas = replacement._retainedState(snapshot.gas, this.gas.regionId, [species.co2, species.water, species.hydrogen], legacy);
        replacement.disposal = replacement._retainedState(snapshot.disposal, this.disposal.regionId, liquidSpecies, legacy);
        if (legacy) {
            const state = replacement.disposal, energy = aqueousEnergy(state.conserved.speciesMassKg, ambientK);
            replacement.ledger.legacyThermalReferenceJ += energy;
            replacement.disposal = replacement._state(state.regionId, state.conserved.speciesMassKg, state.conserved.internalEnergyJ + energy, state.revision);
            replacement.ledger.wipedWaterKg = state.conserved.speciesMassKg[species.water] ?? 0;
            replacement.ledger.reactionLiquidWaterKg = snapshot.ledger.carbonateConsumedKg / M.carbonate * M.water;
        } else {
            replacement.outflow = replacement._retainedState(snapshot.outflow, this.outflow.regionId, liquidSpecies);
            replacement.absorbed = replacement._retainedState(snapshot.absorbed, this.absorbed.regionId, [species.water]);
        }
        for (const key of ['sequence', 'steps']) if (!Number.isSafeInteger(snapshot[key]) || snapshot[key] < 0) throw new RangeError('Invalid chemical clock');
        finite(snapshot.timeSeconds, 'Chemical time', 0, 1e30);
        for (const key of legacy ? ['rates'] : ['rates', 'gasSourceRates', 'oilEnergyJ', 'evaporationRates']) {
            if (!Array.isArray(snapshot[key]) || snapshot[key].length !== replacement[key].length) throw new RangeError(`Invalid chemical ${key} dimensions`);
            snapshot[key].forEach(value => finite(value, `Chemical ${key}`, 0, 1e30)); replacement[key].set(snapshot[key]);
        }
        if (legacy && Object.hasOwn(snapshot, 'gasSourceRates')) {
            if (!Array.isArray(snapshot.gasSourceRates) || snapshot.gasSourceRates.length !== replacement.gasSourceRates.length) throw new RangeError('Invalid chemical gas source dimensions');
            snapshot.gasSourceRates.forEach(value => finite(value, 'Chemical gas source rate', 0, 1e30)); replacement.gasSourceRates.set(snapshot.gasSourceRates);
        }
        if (!legacy) {
            if (Object.hasOwn(snapshot, 'aqueousEnergyJ')) {
                if (!Array.isArray(snapshot.aqueousEnergyJ) || snapshot.aqueousEnergyJ.length !== replacement.aqueousEnergyJ.length) throw new RangeError('Invalid chemical aqueousEnergyJ dimensions');
                snapshot.aqueousEnergyJ.forEach(value => finite(value, 'Chemical aqueousEnergyJ', 0, 1e30)); replacement.aqueousEnergyJ.set(snapshot.aqueousEnergyJ);
            } else {
                // Earlier v2 checkpoints retained only the oil partition.
                // Recover their available precision once, then keep both
                // phase energies explicitly for all subsequent evolution.
                for (const [i, state] of states) {
                    if (aqueousMass(state.conserved.speciesMassKg) > 0) replacement.aqueousEnergyJ[i] = Math.max(0, state.conserved.internalEnergyJ - replacement.oilEnergyJ[i]);
                    else if ((state.conserved.speciesMassKg[species.oil] ?? 0) > 0) replacement.oilEnergyJ[i] = state.conserved.internalEnergyJ;
                }
            }
        }
        replacement.states = states;
        replacement.ledger = { ...replacement.ledger, ...Object.fromEntries((legacy ? oldKeys : Object.keys(replacement.ledger)).map(key => [key, snapshot.ledger[key]])) };
        replacement.sequence = snapshot.sequence; replacement.steps = snapshot.steps; replacement.timeSeconds = snapshot.timeSeconds;
        if (snapshot.version === 3 || extended && snapshot.runoff) replacement.runoff.restore(snapshot.runoff, snapshot.timeSeconds,
            (state, regionId, phase) => replacement._retainedState(state, regionId, phase === 'oil' ? [species.oil] : aqueousSpecies));
        for (let i = 0; i < this.topology.count; i++) {
            const state = replacement.states.get(i), oil = state?.conserved.speciesMassKg[species.oil] ?? 0, energy = state?.conserved.internalEnergyJ ?? 0;
            const partitionToleranceJ = Math.max(1e-7, 32 * Number.EPSILON * Math.max(1, energy));
            if (Math.abs(replacement.oilEnergyJ[i] + replacement.aqueousEnergyJ[i] - energy) > partitionToleranceJ
                || (!oil && replacement.oilEnergyJ[i] !== 0)
                || (!aqueousMass(state?.conserved.speciesMassKg ?? {}) && replacement.aqueousEnergyJ[i] > partitionToleranceJ)) throw new RangeError('Liquid energy partition has no retained owner');
        }
        const retainedStates = [...states.values()];
        const phaseTotals = new Map([...states].filter(([, state]) => liquidSpecies.some(id => (state.conserved.speciesMassKg[id] ?? 0) > 0))
            .map(([i, state]) => [state.regionId, replacement.oilEnergyJ[i] + replacement.aqueousEnergyJ[i]]));
        const projected = replacement._projectPhaseTotals({ beforeStates: retainedStates, afterStates: retainedStates }, phaseTotals);
        let position = 0; for (const i of states.keys()) states.set(i, projected[position++]);
        const stats = replacement.stats();
        if (Math.abs(stats.chemicalMassResidualKg) > Math.max(1e-7, stats.chemicalLedger.expectedMassKg * 1e-9)
            || Math.abs(stats.chemicalEnergyResidualJ) > Math.max(1e-5, Math.abs(stats.chemicalLedger.expectedEnergyJ) * 1e-9)) throw new RangeError('Chemical checkpoint conservation failed');
        delete replacement._restoringDefinitionHash; Object.assign(this, replacement); this.sync(); return this;
    }
    dispose() { this.states.clear(); this.runoff.parcels.clear(); this.auxiliary.fill(0); this.liquidProperties.fill(0); }
}
const massSum = state => Object.values(state.conserved.speciesMassKg).reduce((sum, mass) => sum + mass, 0);
function flow(id, massKg, elements) {
    return { definitionId: id, role: 'reactant-or-product', relationship: 'new-instance', consumed: true, massKg,
        constituentMassKg: { [id]: massKg }, elementAmountsMol: elements, isotopeAmountsMol: {}, chargeC: 0, stateEffectTags: [] };
}
function ironReaction(mol) {
    const p = SURFACE_IRON_PROFILE;
    const value = reactionInput('acid', mol);
    return createRealmTransformation({ ...value, id: 'transform:surface-hcl-iron', label: 'Finite HCl corrosion of iron',
        inputs: [flow('species:Fe', p.ironMolarKg * mol, { 'element:Fe': mol }), flow(species.acid, 2 * M.hcl * mol, { 'element:H': 2 * mol, 'element:Cl': 2 * mol })],
        outputs: [flow(species.ferrous, p.ferrousChlorideMolarKg * mol, { 'element:Fe': mol, 'element:Cl': 2 * mol }),
            flow(species.hydrogen, p.hydrogenMolarKg * mol, { 'element:H': 2 * mol })],
        evidence: { ...value.evidence, sourceIds: ['source:engine-element-table', 'source:alcaraz-2021-steel-pickling'], method: SURFACE_IRON_PROFILE.scope } });
}
function reaction(kind, mol) {
    return createRealmTransformation(reactionInput(kind, mol));
}
// Build the final reaction description before strict contract admission. Iron
// reuses the acid policy without constructing a discarded calcite contract.
function reactionInput(kind, mol) {
    const oil = kind === 'oil';
    const inputs = oil ? [flow(species.oil, M.oil * mol, { 'element:C': 12 * mol, 'element:H': 26 * mol })]
        : [flow(species.carbonate, M.carbonate * mol, { 'element:Ca': mol, 'element:C': mol, 'element:O': 3 * mol }),
            flow(species.acid, 2 * M.hcl * mol, { 'element:H': 2 * mol, 'element:Cl': 2 * mol })];
    const outputs = [flow(species.co2, (oil ? 12 : 1) * M.co2 * mol, { 'element:C': (oil ? 12 : 1) * mol, 'element:O': (oil ? 24 : 2) * mol }),
        flow(species.water, (oil ? 13 : 1) * M.water * mol, { 'element:H': (oil ? 26 : 2) * mol, 'element:O': (oil ? 13 : 1) * mol })];
    if (!oil) outputs.push(flow(species.salt, M.salt * mol, { 'element:Ca': mol, 'element:Cl': 2 * mol }));
    return { id: oil ? 'transform:surface-oil-combustion-proxy' : 'transform:surface-hcl-calcite',
        label: oil ? 'Reduced Fuel Oil #2 combustion (C12H26 proxy)' : 'Hydrochloric acid neutralizes finite calcite', category: 'chemical', intent: 'simulation', physicsDomain: 'real-world-curated', inputs, outputs,
        byproducts: [], equipment: [], reservoirs: oil ? [{ reservoirId: 'reservoir:atmospheric-oxygen', direction: 'input', massKg: 18.5 * M.oxygen * mol,
            constituentMassKg: { 'species:O2': 18.5 * M.oxygen * mol }, elementAmountsMol: { 'element:O': 37 * mol }, isotopeAmountsMol: {}, chargeC: 0 }] : [],
        conditions: { temperatureRangeK: { minimum: 0, maximum: null }, pressureRangePa: { minimum: 0, maximum: null }, durationRangeS: { minimum: 0, maximum: null }, energyRangeJ: { minimum: 0, maximum: null }, atmosphereIds: oil ? ['reservoir:atmospheric-oxygen'] : [], requiredTags: [] },
        conservation: { mass: true, constituents: false, elements: true, isotopes: true, charge: true, allowEnvironmentalExchange: oil, absoluteTolerance: 1e-9, relativeTolerance: 1e-9 },
        cost: { operations: 1, energyJ: 0, durationS: 0, wasteKg: 0, economic: 0 },
        evidence: { schema: 'engine.matter.fabric.evidence', schemaVersion: '1.0.0', class: 'CURATED', confidence: .8,
            sourceIds: ['source:engine-element-table', oil ? 'source:noaa-fuel-oil-2' : 'source:nist-calcite'], method: oil ? 'Balanced C12H26 proxy; NOAA bulk fuel properties and explicit reduced thermal closure' : 'Balanced CaCO3 + 2 HCl neutralization with an accelerated demonstration rate', reviewed: true }, tags: ['finite-inventory', 'surface-fields', 'reduced-model'] };
}
