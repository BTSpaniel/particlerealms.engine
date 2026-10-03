// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Small, explicitly curated starter domain spanning common real-world matter families. */

import { contentHash, freeze } from './FabricSupport.js';
import { createRealmMatterRegistry } from './RealmMatterRegistry.js';
import { compileRealmMatterDomainPack } from './RealmMatterPack.js';

const CURATED_SOURCE = 'source:realm-matter-curated-baseline';
const PERIODIC_SOURCE = 'source:iupac-periodic-table-baseline';
const ENGINEERING_SOURCE = 'source:engineering-handbook-baseline';

function evidence(sourceIds = [CURATED_SOURCE], method = 'Curated illustrative engineering baseline') {
    return {
        schema: 'engine.matter.fabric.evidence', schemaVersion: '1.0.0',
        class: 'CURATED', confidence: 0.8, sourceIds, method, reviewed: true,
    };
}

function curatedObservation(method) {
    return {
        schema: 'engine.matter.fabric.evidence', schemaVersion: '1.0.0',
        class: 'CURATED', confidence: 0.75, sourceIds: [ENGINEERING_SOURCE], method, reviewed: true,
    };
}

function constituent(constituentId, fraction, elementAmountsMol = {}, isotopeAmountsMol = {}, chargeNumber = 0) {
    return { constituentId, fraction, elementAmountsMol, isotopeAmountsMol, chargeNumber };
}

function composition(id, constituents) {
    return { id, basis: 'mass', constituents, evidence: evidence() };
}

function phase(id, phaseName, minimumK, maximumK) {
    return {
        id,
        temperatureRangeK: { minimum: minimumK, maximum: maximumK },
        pressureRangePa: { minimum: 0, maximum: 1e9 },
        phaseFractions: { [phaseName]: 1 },
        evidence: evidence([ENGINEERING_SOURCE], 'Broad phase envelope for gameplay classification; not a phase-equilibrium model'),
    };
}

function definition(id, label, kind, compositionId, phaseId, tags, aliases = [], geometry = 'geometry:bulk') {
    return {
        id,
        label,
        kind,
        aliases,
        profileRefs: {
            composition: compositionId,
            phase: phaseId,
            microstructure: phaseId === 'phase:ambient-solid'
                && kind !== 'element' && kind !== 'species' && kind !== 'compound'
                ? 'microstructure:generic-isotropic' : null,
            history: 'history:unprocessed',
            geometry,
        },
        propertyObservationIds: [],
        tags,
        evidence: evidence(kind === 'element' ? [PERIODIC_SOURCE] : [CURATED_SOURCE]),
    };
}

function observation(id, definitionId, propertyId, nominal, minimum, maximum, unit, phaseProfileId, sourceMethod) {
    return {
        id,
        definitionId,
        propertyId,
        value: { minimum, nominal, maximum, unit },
        conditions: {
            temperatureRangeK: { minimum: 273.15, maximum: 323.15 },
            pressureRangePa: { minimum: 80000, maximum: 120000 },
            moistureRange: { minimum: 0, maximum: 1 },
            direction: 'any',
            strainRateRangePerS: { minimum: 0, maximum: 1000 },
            phaseProfileId,
            microstructureProfileId: null,
            historyProfileId: null,
        },
        uncertainty: { absolute: Math.abs(maximum - minimum) / 2, relative: 0.05 },
        method: sourceMethod,
        interpolation: 'nearest',
        evidence: curatedObservation(sourceMethod),
        tags: ['illustrative-range'],
    };
}

function flow(definitionId, role, massKg, constituentMassKg, elementAmountsMol, stateEffectTags = [],
    relationship = 'new-instance') {
    return {
        definitionId,
        role,
        relationship,
        consumed: true,
        massKg,
        constituentMassKg,
        elementAmountsMol,
        isotopeAmountsMol: {},
        chargeC: 0,
        stateEffectTags,
    };
}

function conservation({ constituents = true, reservoirs = false } = {}) {
    return {
        mass: true,
        constituents,
        elements: true,
        isotopes: true,
        charge: true,
        allowEnvironmentalExchange: reservoirs,
        absoluteTolerance: 1e-9,
        relativeTolerance: 1e-9,
    };
}

function transform(id, label, category, inputs, outputs, {
    byproducts = [], reservoirs = [], equipment = [], minimumTemperatureK = 0,
    maximumTemperatureK = null, energyJ = 0, durationS = 0, policy = conservation(), tags = [],
    atmosphereIds = [],
} = {}) {
    return {
        id,
        label,
        category,
        intent: category === 'environmental' ? 'environmental' : 'intentional',
        physicsDomain: 'real-world-curated',
        inputs,
        outputs,
        byproducts,
        conditions: {
            temperatureRangeK: { minimum: minimumTemperatureK, maximum: maximumTemperatureK },
            pressureRangePa: { minimum: 0, maximum: null },
            durationRangeS: { minimum: 0, maximum: null },
            energyRangeJ: { minimum: 0, maximum: null },
            atmosphereIds,
            requiredTags: [],
        },
        equipment: equipment.map(selectorId => ({ selectorId, consumed: false })),
        reservoirs,
        conservation: policy,
        cost: { operations: 1, energyJ, durationS, wasteKg: byproducts.reduce((sum, item) => sum + item.massKg, 0), economic: 1 },
        evidence: evidence([ENGINEERING_SOURCE], 'Curated transformation topology; quantities are normalized demonstrator batches'),
        tags,
    };
}

function buildRegistryInput() {
    const elementSpecs = [
        ['H', 'Hydrogen', 'gas'], ['O', 'Oxygen', 'gas'], ['N', 'Nitrogen', 'gas'], ['Ar', 'Argon', 'gas'],
        ['C', 'Carbon', 'solid'], ['Fe', 'Iron', 'solid'], ['Si', 'Silicon', 'solid'], ['Ca', 'Calcium', 'solid'],
        ['Al', 'Aluminium', 'solid'], ['Cu', 'Copper', 'solid'], ['Na', 'Sodium', 'solid'],
    ];
    const definitions = [];
    const compositionProfiles = [];
    for (const [symbol, label, phaseName] of elementSpecs) {
        const id = `element:${symbol}`;
        const compositionId = `composition:pure-${symbol.toLowerCase()}`;
        compositionProfiles.push(composition(compositionId, [constituent(id, 1, { [id]: 1 })]));
        definitions.push(definition(id, label, 'element', compositionId,
            phaseName === 'gas' ? 'phase:ambient-gas' : 'phase:ambient-solid', ['element'], [
                { namespace: 'symbol', value: symbol },
                { namespace: 'name', value: label },
            ]));
    }

    const species = [
        ['species:H2O', 'Water molecule', [['element:H', 2], ['element:O', 1]], [0.1119, 0.8881]],
        ['species:N2', 'Dinitrogen', [['element:N', 2]], [1]],
        ['species:O2', 'Dioxygen', [['element:O', 2]], [1]],
        ['species:Ar', 'Argon species', [['element:Ar', 1]], [1]],
        ['species:CO2', 'Carbon dioxide', [['element:C', 1], ['element:O', 2]], [0.2729, 0.7271]],
        ['species:Fe', 'Iron species', [['element:Fe', 1]], [1]],
        ['species:C', 'Carbon species', [['element:C', 1]], [1]],
        ['species:SiO2', 'Silicon dioxide', [['element:Si', 1], ['element:O', 2]], [0.4674, 0.5326]],
        ['species:CaO', 'Calcium oxide', [['element:Ca', 1], ['element:O', 1]], [0.7147, 0.2853]],
        ['species:Na2O', 'Sodium oxide', [['element:Na', 2], ['element:O', 1]], [0.7419, 0.2581]],
        ['species:cellulose', 'Cellulose repeat-unit family', [['element:C', 6], ['element:H', 10], ['element:O', 5]], [0.444, 0.062, 0.494]],
        ['species:polyethylene', 'Polyethylene repeat-unit family', [['element:C', 2], ['element:H', 4]], [0.856, 0.144]],
        ['species:methane', 'Methane', [['element:C', 1], ['element:H', 4]], [0.749, 0.251]],
    ];
    for (const [id, label, elements, fractions] of species) {
        const compositionId = `composition:species-${id.slice(id.indexOf(':') + 1).toLowerCase()}`;
        compositionProfiles.push(composition(compositionId, elements.map(([elementId, amount], index) => (
            constituent(elementId, fractions[index], { [elementId]: amount })
        ))));
        definitions.push(definition(id, label, 'species', compositionId,
            ['species:N2', 'species:O2', 'species:Ar', 'species:CO2', 'species:methane'].includes(id)
                ? 'phase:ambient-gas' : 'phase:ambient-solid', ['chemical-species']));
    }

    const waterComposition = composition('composition:water', [constituent('species:H2O', 1, { 'element:H': 2, 'element:O': 1 })]);
    const airComposition = composition('composition:dry-air', [
        constituent('species:N2', 0.755, { 'element:N': 2 }),
        constituent('species:O2', 0.232, { 'element:O': 2 }),
        constituent('species:Ar', 0.0124, { 'element:Ar': 1 }),
        constituent('species:CO2', 0.0006, { 'element:C': 1, 'element:O': 2 }),
    ]);
    const steelComposition = composition('composition:carbon-steel', [
        constituent('species:Fe', 0.99, { 'element:Fe': 1 }), constituent('species:C', 0.01, { 'element:C': 1 }),
    ]);
    const glassComposition = composition('composition:soda-lime-glass', [
        constituent('species:SiO2', 0.74, { 'element:Si': 1, 'element:O': 2 }),
        constituent('species:CaO', 0.12, { 'element:Ca': 1, 'element:O': 1 }),
        constituent('species:Na2O', 0.14, { 'element:Na': 2, 'element:O': 1 }),
    ]);
    const woodComposition = composition('composition:softwood-dry-reference', [
        constituent('species:cellulose', 0.9, { 'element:C': 6, 'element:H': 10, 'element:O': 5 }),
        constituent('species:H2O', 0.1, { 'element:H': 2, 'element:O': 1 }),
    ]);
    const concreteComposition = composition('composition:concrete-simplified', [
        constituent('species:SiO2', 0.6, { 'element:Si': 1, 'element:O': 2 }),
        constituent('species:CaO', 0.3, { 'element:Ca': 1, 'element:O': 1 }),
        constituent('species:H2O', 0.1, { 'element:H': 2, 'element:O': 1 }),
    ]);
    const polymerComposition = composition('composition:polyethylene', [
        constituent('species:polyethylene', 1, { 'element:C': 2, 'element:H': 4 }),
    ]);
    const copperComposition = composition('composition:copper', [
        constituent('element:Cu', 1, { 'element:Cu': 1 }),
    ]);
    const methaneComposition = composition('composition:methane-fuel', [
        constituent('species:methane', 1, { 'element:C': 1, 'element:H': 4 }),
    ]);
    const quartzComposition = composition('composition:quartz-mineral', [
        constituent('species:SiO2', 1, { 'element:Si': 1, 'element:O': 2 }),
    ]);
    const drySoilComposition = composition('composition:loam-soil-dry-reference', [
        constituent('species:SiO2', 0.7, { 'element:Si': 1, 'element:O': 2 }),
        constituent('species:cellulose', 0.2, { 'element:C': 6, 'element:H': 10, 'element:O': 5 }),
        constituent('species:H2O', 0.1, { 'element:H': 2, 'element:O': 1 }),
    ]);
    const mudComposition = composition('composition:loam-mud-reference', [
        constituent('species:SiO2', 0.56, { 'element:Si': 1, 'element:O': 2 }),
        constituent('species:cellulose', 0.16, { 'element:C': 6, 'element:H': 10, 'element:O': 5 }),
        constituent('species:H2O', 0.28, { 'element:H': 2, 'element:O': 1 }),
    ]);
    compositionProfiles.push(waterComposition, airComposition, steelComposition, glassComposition, woodComposition,
        concreteComposition, polymerComposition, copperComposition, methaneComposition, quartzComposition,
        drySoilComposition, mudComposition);

    const materialSpecs = [
        ['compound:water', 'Water', 'compound', 'composition:water', 'phase:water-liquid', ['water', 'compound']],
        ['material:water-liquid', 'Liquid water', 'material', 'composition:water', 'phase:water-liquid', ['water', 'liquid']],
        ['material:water-ice', 'Water ice', 'material', 'composition:water', 'phase:water-ice', ['water', 'solid', 'insulator']],
        ['material:water-steam', 'Water vapour', 'material', 'composition:water', 'phase:water-steam', ['water', 'gas']],
        ['mixture:dry-air', 'Dry atmospheric air', 'mixture', 'composition:dry-air', 'phase:ambient-gas', ['air', 'gas']],
        ['reservoir:atmosphere', 'Atmospheric reservoir', 'reservoir', 'composition:dry-air', 'phase:ambient-gas', ['environment']],
        ['material:carbon-steel', 'Generic carbon steel', 'material', 'composition:carbon-steel', 'phase:ambient-solid', ['metal', 'structural', 'conductor']],
        ['stock:steel-bar', 'Carbon-steel bar', 'stock', 'composition:carbon-steel', 'phase:ambient-solid', ['metal', 'stock', 'structural']],
        ['component:steel-part', 'Machined steel component', 'component', 'composition:carbon-steel', 'phase:ambient-solid', ['metal', 'component']],
        ['debris:steel-scrap', 'Steel scrap', 'debris', 'composition:carbon-steel', 'phase:ambient-solid', ['metal', 'recyclable']],
        ['material:soda-lime-glass', 'Simplified soda-lime glass', 'material', 'composition:soda-lime-glass', 'phase:ambient-solid', ['glass', 'insulator', 'construction']],
        ['debris:glass-fragments', 'Glass fragments', 'debris', 'composition:soda-lime-glass', 'phase:ambient-solid', ['glass', 'debris']],
        ['material:softwood', 'Generic softwood', 'material', 'composition:softwood-dry-reference', 'phase:ambient-solid', ['wood', 'construction', 'insulator']],
        ['debris:wood-chips', 'Wood chips', 'debris', 'composition:softwood-dry-reference', 'phase:ambient-solid', ['wood', 'debris', 'fuel']],
        ['material:concrete', 'Simplified cured concrete', 'material', 'composition:concrete-simplified', 'phase:ambient-solid', ['concrete', 'construction', 'insulator']],
        ['debris:concrete-rubble', 'Concrete rubble', 'debris', 'composition:concrete-simplified', 'phase:ambient-solid', ['concrete', 'debris']],
        ['material:polyethylene', 'Generic polyethylene', 'material', 'composition:polyethylene', 'phase:ambient-solid', ['polymer', 'insulator']],
        ['debris:polymer-scrap', 'Polyethylene scrap', 'debris', 'composition:polyethylene', 'phase:ambient-solid', ['polymer', 'recyclable']],
        ['material:copper', 'Copper conductor', 'material', 'composition:copper', 'phase:ambient-solid', ['metal', 'conductor']],
        ['stock:copper-wire', 'Copper wire', 'stock', 'composition:copper', 'phase:ambient-solid', ['wire', 'conductor', 'stock']],
        ['material:methane-fuel', 'Methane fuel', 'material', 'composition:methane-fuel', 'phase:ambient-gas', ['fuel', 'gas']],
        ['material:quartz', 'Quartz mineral', 'material', 'composition:quartz-mineral', 'phase:ambient-solid', ['mineral', 'silicate', 'geology']],
        ['material:quartz-sand', 'Quartz sand', 'material', 'composition:quartz-mineral', 'phase:ambient-solid', ['mineral', 'soil', 'granular']],
        ['material:loam-soil', 'Reference dry loam soil', 'mixture', 'composition:loam-soil-dry-reference', 'phase:ambient-solid', ['soil', 'mineral', 'organic', 'granular']],
        ['material:loam-mud', 'Reference hydrated loam mud', 'mixture', 'composition:loam-mud-reference', 'phase:water-liquid', ['soil', 'mud', 'wet', 'granular']],
        ['debris:excavated-soil', 'Excavated loam soil', 'debris', 'composition:loam-soil-dry-reference', 'phase:ambient-solid', ['soil', 'debris', 'granular']],
    ];
    for (const [id, label, kind, compositionId, phaseId, tags] of materialSpecs) {
        const geometry = id === 'stock:steel-bar' ? 'geometry:bar'
            : id === 'stock:copper-wire' ? 'geometry:wire' : 'geometry:bulk';
        definitions.push(definition(id, label, kind, compositionId, phaseId, tags,
            [{ namespace: 'realm', value: label }], geometry));
    }

    const propertyObservations = [
        observation('observation:steel-density-a', 'material:carbon-steel', 'property:density', 7850, 7750, 8050,
            'kg/m3', 'phase:ambient-solid', 'Broad room-temperature carbon-steel density range'),
        observation('observation:steel-density-b', 'material:carbon-steel', 'property:density', 7870, 7800, 7950,
            'kg/m3', 'phase:ambient-solid', 'Independent generic steel density range retained as a conflict'),
        observation('observation:copper-conductivity', 'material:copper', 'property:electrical-conductivity', 5.8e7, 5.5e7, 6.0e7,
            'S/m', 'phase:ambient-solid', 'Broad annealed-copper conductivity range'),
        observation('observation:glass-conductivity', 'material:soda-lime-glass', 'property:electrical-conductivity', 1e-11, 1e-13, 1e-9,
            'S/m', 'phase:ambient-solid', 'Order-of-magnitude insulating glass range'),
        observation('observation:water-density', 'material:water-liquid', 'property:density', 997, 988, 1000,
            'kg/m3', 'phase:water-liquid', 'Liquid-water near-ambient density range'),
        observation('observation:quartz-density', 'material:quartz', 'property:density', 2650, 2600, 2700,
            'kg/m3', 'phase:ambient-solid', 'Broad room-temperature quartz density range'),
        observation('observation:loam-bulk-density', 'material:loam-soil', 'property:density', 1400, 1100, 1700,
            'kg/m3', 'phase:ambient-solid', 'Illustrative loose-to-compacted dry loam bulk-density range'),
    ];
    for (const property of propertyObservations) {
        definitions.find(item => item.id === property.definitionId).propertyObservationIds.push(property.id);
    }

    const phaseProfiles = [
        phase('phase:ambient-solid', 'solid', 0, 5000),
        phase('phase:ambient-gas', 'gas', 0, 5000),
        phase('phase:water-ice', 'solid', 0, 273.15),
        phase('phase:water-liquid', 'liquid', 273.15, 373.15),
        phase('phase:water-steam', 'gas', 373.15, 5000),
    ];
    const microstructureProfiles = [{
        id: 'microstructure:generic-isotropic',
        phaseIds: ['phase:ambient-solid'],
        grainSizeM: null,
        porosityFraction: 0,
        orientation: 'approximately-isotropic',
        defects: [],
        tags: ['generic'],
        evidence: evidence([], 'Unspecified fallback; not a measured microstructure'),
    }];
    const historyProfiles = [{
        id: 'history:unprocessed', processTags: [], transformationIds: [], notes: 'No process history is asserted.',
        evidence: evidence([], 'Empty initial process history'),
    }];
    const geometryProfiles = [
        { id: 'geometry:bulk', form: 'bulk', dimensionsM: [], surfaceAreaM2: null, volumeM3: null,
            geometryRef: null, orientation: 'unspecified', evidence: evidence([], 'Geometry supplied by owning instance') },
        { id: 'geometry:bar', form: 'bar', dimensionsM: [], surfaceAreaM2: null, volumeM3: null,
            geometryRef: null, orientation: 'longitudinal', evidence: evidence([], 'Stock-form classification only') },
        { id: 'geometry:wire', form: 'wire', dimensionsM: [], surfaceAreaM2: null, volumeM3: null,
            geometryRef: null, orientation: 'longitudinal', evidence: evidence([], 'Stock-form classification only') },
    ];

    const waterMass = { 'species:H2O': 1 };
    const waterElements = { 'element:H': 2, 'element:O': 1 };
    const steelMass = { 'species:Fe': 0.99, 'species:C': 0.01 };
    const steelElements = { 'element:Fe': 0.99, 'element:C': 0.01 };
    const glassMass = { 'species:SiO2': 0.74, 'species:CaO': 0.12, 'species:Na2O': 0.14 };
    const glassElements = { 'element:Si': 0.74, 'element:Ca': 0.12, 'element:Na': 0.28, 'element:O': 1.88 };
    const woodMass = { 'species:cellulose': 0.9, 'species:H2O': 0.1 };
    const woodElements = { 'element:C': 5.4, 'element:H': 9.2, 'element:O': 4.6 };
    const concreteMass = { 'species:SiO2': 0.6, 'species:CaO': 0.3, 'species:H2O': 0.1 };
    const concreteElements = { 'element:Si': 0.6, 'element:Ca': 0.3, 'element:H': 0.2, 'element:O': 1.6 };
    const polymerMass = { 'species:polyethylene': 1 };
    const polymerElements = { 'element:C': 2, 'element:H': 4 };
    const copperMass = { 'element:Cu': 1 };
    const copperElements = { 'element:Cu': 1 };
    const quartzMass = { 'species:SiO2': 1 };
    const quartzElements = { 'element:Si': 1, 'element:O': 2 };
    const drySoilMass = { 'species:SiO2': 0.7, 'species:cellulose': 0.2, 'species:H2O': 0.1 };
    const drySoilElements = { 'element:Si': 0.7, 'element:O': 2.5, 'element:C': 1.2, 'element:H': 2.2 };
    const hydratedSoilMass = { 'species:SiO2': 0.56, 'species:cellulose': 0.16, 'species:H2O': 0.28 };
    const hydratedSoilElements = { 'element:Si': 0.56, 'element:O': 2.2, 'element:C': 0.96, 'element:H': 2.16 };
    const transformations = [
        transform('transform:air-blend', 'Blend normalized dry-air constituents', 'mixing', [
            flow('species:N2', 'constituent', 0.755, { 'species:N2': 0.755 }, { 'element:N': 1.51 }),
            flow('species:O2', 'constituent', 0.232, { 'species:O2': 0.232 }, { 'element:O': 0.464 }),
            flow('species:Ar', 'constituent', 0.0124, { 'species:Ar': 0.0124 }, { 'element:Ar': 0.0124 }),
            flow('species:CO2', 'constituent', 0.0006, { 'species:CO2': 0.0006 },
                { 'element:C': 0.0006, 'element:O': 0.0012 }),
        ], [flow('mixture:dry-air', 'product', 1, {
            'species:N2': 0.755, 'species:O2': 0.232, 'species:Ar': 0.0124, 'species:CO2': 0.0006,
        }, { 'element:N': 1.51, 'element:O': 0.4652, 'element:Ar': 0.0124, 'element:C': 0.0006 })]),
        transform('transform:water-freeze', 'Freeze liquid water', 'phase',
            [flow('material:water-liquid', 'workpiece', 1, waterMass, waterElements)],
            [flow('material:water-ice', 'product', 1, waterMass, waterElements, ['frozen'], 'same-instance')], { maximumTemperatureK: 273.15 }),
        transform('transform:water-melt', 'Melt water ice', 'phase',
            [flow('material:water-ice', 'workpiece', 1, waterMass, waterElements)],
            [flow('material:water-liquid', 'product', 1, waterMass, waterElements, ['melted'], 'same-instance')], { minimumTemperatureK: 273.15 }),
        transform('transform:water-boil', 'Boil liquid water', 'phase',
            [flow('material:water-liquid', 'workpiece', 1, waterMass, waterElements)],
            [flow('material:water-steam', 'product', 1, waterMass, waterElements, ['vaporized'], 'same-instance')], { minimumTemperatureK: 373.15, energyJ: 2257000 }),
        transform('transform:water-condense', 'Condense water vapour', 'phase',
            [flow('material:water-steam', 'workpiece', 1, waterMass, waterElements)],
            [flow('material:water-liquid', 'product', 1, waterMass, waterElements, ['condensed'], 'same-instance')], { maximumTemperatureK: 373.15 }),
        transform('transform:steel-roll-bar', 'Roll steel into bar stock', 'mechanical',
            [flow('material:carbon-steel', 'workpiece', 1, steelMass, steelElements)],
            [flow('stock:steel-bar', 'product', 1, steelMass, steelElements, ['rolled'])], { equipment: ['equipment:rolling-mill'] }),
        transform('transform:steel-machine-part', 'Machine steel component and retain cuttings', 'mechanical',
            [flow('stock:steel-bar', 'workpiece', 1, steelMass, steelElements)],
            [flow('component:steel-part', 'product', 0.85, { 'species:Fe': 0.8415, 'species:C': 0.0085 },
                { 'element:Fe': 0.8415, 'element:C': 0.0085 }, ['machined'])], {
                byproducts: [flow('debris:steel-scrap', 'cuttings', 0.15,
                    { 'species:Fe': 0.1485, 'species:C': 0.0015 }, { 'element:Fe': 0.1485, 'element:C': 0.0015 })],
                equipment: ['equipment:machine-tool'],
            }),
        transform('transform:steel-recycle', 'Remelt sorted steel scrap', 'recycling',
            [flow('debris:steel-scrap', 'feedstock', 1, steelMass, steelElements)],
            [flow('material:carbon-steel', 'product', 1, steelMass, steelElements, ['remelted'])], { minimumTemperatureK: 1700, energyJ: 1e6 }),
        transform('transform:glass-fracture', 'Fracture glass into retained fragments', 'mechanical',
            [flow('material:soda-lime-glass', 'workpiece', 1, glassMass, glassElements)],
            [flow('debris:glass-fragments', 'fragments', 1, glassMass, glassElements, ['fractured'])]),
        transform('transform:wood-chip', 'Chip wood into retained debris', 'mechanical',
            [flow('material:softwood', 'workpiece', 1, woodMass, woodElements)],
            [flow('debris:wood-chips', 'chips', 1, woodMass, woodElements, ['damaged'])]),
        transform('transform:concrete-crush', 'Crush concrete into retained rubble', 'mechanical',
            [flow('material:concrete', 'workpiece', 1, concreteMass, concreteElements)],
            [flow('debris:concrete-rubble', 'rubble', 1, concreteMass, concreteElements, ['damaged'])]),
        transform('transform:polymer-shred', 'Shred polyethylene into recyclable scrap', 'recycling',
            [flow('material:polyethylene', 'workpiece', 1, polymerMass, polymerElements)],
            [flow('debris:polymer-scrap', 'scrap', 1, polymerMass, polymerElements, ['shredded'])]),
        transform('transform:polymer-reprocess', 'Reprocess polyethylene scrap', 'recycling',
            [flow('debris:polymer-scrap', 'feedstock', 1, polymerMass, polymerElements)],
            [flow('material:polyethylene', 'product', 1, polymerMass, polymerElements, ['reprocessed'])]),
        transform('transform:copper-refine', 'Refine elemental copper into conductor stock material', 'separation',
            [flow('element:Cu', 'feedstock', 1, copperMass, copperElements)],
            [flow('material:copper', 'product', 1, copperMass, copperElements, ['refined'])]),
        transform('transform:copper-draw-wire', 'Draw copper into wire stock', 'mechanical',
            [flow('material:copper', 'workpiece', 1, copperMass, copperElements)],
            [flow('stock:copper-wire', 'product', 1, copperMass, copperElements, ['drawn'])], { equipment: ['equipment:wire-draw'] }),
        transform('transform:quartz-crush-sand', 'Crush quartz mineral into retained sand', 'mechanical',
            [flow('material:quartz', 'workpiece', 1, quartzMass, quartzElements)],
            [flow('material:quartz-sand', 'granules', 1, quartzMass, quartzElements, ['crushed'], 'same-instance')]),
        transform('transform:soil-excavate', 'Excavate dry loam into retained soil debris', 'mechanical',
            [flow('material:loam-soil', 'ground', 1, drySoilMass, drySoilElements)],
            [flow('debris:excavated-soil', 'excavated', 1, drySoilMass, drySoilElements, ['excavated'])]),
        transform('transform:soil-hydrate', 'Hydrate dry loam into mud', 'mixing', [
            flow('material:loam-soil', 'soil', 0.8,
                { 'species:SiO2': 0.56, 'species:cellulose': 0.16, 'species:H2O': 0.08 },
                { 'element:Si': 0.56, 'element:O': 2, 'element:C': 0.96, 'element:H': 1.76 }),
            flow('material:water-liquid', 'water', 0.2, { 'species:H2O': 0.2 },
                { 'element:H': 0.4, 'element:O': 0.2 }),
        ], [flow('material:loam-mud', 'mud', 1, hydratedSoilMass, hydratedSoilElements, ['hydrated'])]),
        transform('transform:soil-dry', 'Dry mud into soil and recovered water', 'separation',
            [flow('material:loam-mud', 'mud', 1, hydratedSoilMass, hydratedSoilElements)], [
                flow('material:loam-soil', 'soil', 0.8,
                    { 'species:SiO2': 0.56, 'species:cellulose': 0.16, 'species:H2O': 0.08 },
                    { 'element:Si': 0.56, 'element:O': 2, 'element:C': 0.96, 'element:H': 1.76 },
                    ['dried']),
                flow('material:water-liquid', 'recovered-water', 0.2, { 'species:H2O': 0.2 },
                    { 'element:H': 0.4, 'element:O': 0.2 }),
            ], { minimumTemperatureK: 273.15 }),
        transform('transform:methane-combustion', 'Idealized complete methane combustion', 'chemical',
            [flow('material:methane-fuel', 'fuel', 0.016, { 'species:methane': 0.016 }, { 'element:C': 1, 'element:H': 4 })],
            [
                flow('species:CO2', 'product', 0.044, { 'species:CO2': 0.044 }, { 'element:C': 1, 'element:O': 2 }),
                flow('compound:water', 'product', 0.036, { 'species:H2O': 0.036 }, { 'element:H': 4, 'element:O': 2 }),
            ], {
                reservoirs: [{
                    reservoirId: 'reservoir:atmosphere', direction: 'input', massKg: 0.064,
                    constituentMassKg: { 'species:O2': 0.064 }, elementAmountsMol: { 'element:O': 4 },
                    isotopeAmountsMol: {}, chargeC: 0,
                }],
                policy: conservation({ constituents: false, reservoirs: true }),
                energyJ: 802000,
                tags: ['idealized-stoichiometry'],
                atmosphereIds: ['reservoir:atmosphere'],
            }),
    ];
    return {
        schema: 'engine.matter.fabric.registry', schemaVersion: '1.0.0', definitions,
        compositionProfiles, phaseProfiles, microstructureProfiles, historyProfiles, geometryProfiles,
        propertyObservations, transformations,
    };
}

export const STARTER_REALM_MATTER_PACK_METADATA = freeze({
    packId: 'matter:starter-common-materials',
    packVersion: '1.1.0',
    scientificScope: 'Curated demonstrator topology with broad engineering ranges; not a standards database.',
    sourceIds: [PERIODIC_SOURCE, ENGINEERING_SOURCE, CURATED_SOURCE],
}, '$.starterMatterPackMetadata');

export function createStarterRealmMatterRegistry(options = {}) {
    return createRealmMatterRegistry(buildRegistryInput(), options);
}

export function createStarterRealmMatterPack(options = {}) {
    const registry = buildRegistryInput();
    const recordCount = Object.values(registry).filter(Array.isArray).reduce((sum, records) => sum + records.length, 0);
    const sourceRecords = [
        { sourceId: PERIODIC_SOURCE, sourceVersion: '1.0.0', license: 'Source metadata only; values curated into project data',
            contentHash: contentHash({ source: PERIODIC_SOURCE, revision: 1 }), recordCount: 11 },
        { sourceId: ENGINEERING_SOURCE, sourceVersion: '1.0.0', license: 'Project-curated broad engineering baselines',
            contentHash: contentHash({ source: ENGINEERING_SOURCE, revision: 2 }), recordCount: 32 },
        { sourceId: CURATED_SOURCE, sourceVersion: '1.0.0', license: 'LicenseRef-ParticleRealms-Alpha',
            contentHash: contentHash({ source: CURATED_SOURCE, revision: 1 }), recordCount },
    ];
    return compileRealmMatterDomainPack({
        packId: STARTER_REALM_MATTER_PACK_METADATA.packId,
        packVersion: STARTER_REALM_MATTER_PACK_METADATA.packVersion,
        license: 'LicenseRef-ParticleRealms-Alpha',
        sourceRecords,
        registry,
    }, options);
}
