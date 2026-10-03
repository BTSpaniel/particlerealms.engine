// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Engine-owned material facade for dense cellular sandboxes.
 *
 * Atomic numbers, particle material IDs, and sandbox cell codes are separate
 * identities.  A sandbox code is only a compact runtime index.  The catalog
 * keeps the canonical references beside it so the Editor, demos, and future
 * authoring tools can share labels and properties without conflating those
 * identity spaces.
 *
 * The generated behaviour is qualitative and mesoscale.  It does not claim
 * that a grid cell is an atom or that periodic-table properties alone predict
 * chemistry.  Only explicitly flagged reaction classes react in a solver.
 */

import { getAllElements } from '../ParticleElementTable.js';
import './materials/index.js';
import { getAllSubstances } from './SubstanceRegistry.js';

export const SANDBOX_REFERENCE_TEMPERATURE_K = 293.15;
export const SANDBOX_TEMPERATURE_STEP_K = 64;
export const SANDBOX_SPECIES_CAPACITY = 256;
export const SANDBOX_SUBSTANCE_CODE_BASE = 127;

export const SANDBOX_BEHAVIOR = Object.freeze({
  EMPTY: 0,
  STATIC: 1,
  POWDER: 2,
  LIQUID: 3,
  GAS: 4,
  ENERGY: 5,
});

export const SANDBOX_PHASE = Object.freeze({
  SOLID: 0,
  LIQUID: 1,
  GAS: 2,
  PLASMA: 3,
});

export const SANDBOX_FLAGS = Object.freeze({
  FLAMMABLE: 1 << 0,
  OXIDIZER: 1 << 1,
  CORROSIVE: 1 << 2,
  WATER: 1 << 3,
  HOT: 1 << 4,
  EXPLOSIVE: 1 << 5,
  TRANSIENT: 1 << 6,
  ESTIMATED: 1 << 7,
});

export const SANDBOX_REACTION = Object.freeze({
  NONE: 0,
  WATER: 1,
  COMBUSTIBLE: 2,
  FIRE: 3,
  CORROSIVE: 4,
  LAVA: 5,
  WATER_VAPOR: 6,
  EXPLOSIVE: 7,
  ALKALI_METAL: 8,
  OXIDIZER: 9,
});

/** Pairwise interaction traits compiled into the high byte of LUT word 3. */
export const SANDBOX_INTERACTION = Object.freeze({
  CORRODIBLE: 1 << 0,
  AQUEOUS: 1 << 1,
  IMMISCIBLE: 1 << 2,
});

export const SANDBOX_OBJECT = Object.freeze({
  NONE: 0,
  WALL: 1,
  HEATER: 2,
  COOLER: 3,
  SOURCE: 4,
  DRAIN: 5,
  FAN: 6,
  ATTRACTOR: 7,
});

export const SANDBOX_OBJECTS = Object.freeze([
  Object.freeze({ id: SANDBOX_OBJECT.WALL, key: 'wall', label: 'Wall', icon: '🧱', color: 0x718096, description: 'Rigid collision boundary.' }),
  Object.freeze({ id: SANDBOX_OBJECT.HEATER, key: 'heater', label: 'Heater', icon: '♨', color: 0xff6b35, description: 'Adds heat to adjacent matter.' }),
  Object.freeze({ id: SANDBOX_OBJECT.COOLER, key: 'cooler', label: 'Cooler', icon: '❄', color: 0x67e8f9, description: 'Removes heat from adjacent matter.' }),
  Object.freeze({ id: SANDBOX_OBJECT.SOURCE, key: 'source', label: 'Source', icon: '+', color: 0x86efac, description: 'Emits the last selected material.' }),
  Object.freeze({ id: SANDBOX_OBJECT.DRAIN, key: 'drain', label: 'Drain', icon: '−', color: 0xf472b6, description: 'Removes matter that enters it.' }),
  Object.freeze({ id: SANDBOX_OBJECT.FAN, key: 'fan', label: 'Fan', icon: '→', color: 0xc4b5fd, description: 'Biases mobile matter away from the world centre.' }),
  Object.freeze({ id: SANDBOX_OBJECT.ATTRACTOR, key: 'attractor', label: 'Gravity', icon: '◎', color: 0xfacc15, description: 'Locally increases the inward gravity bias.' }),
]);

const CATEGORY_COLORS = Object.freeze({
  'alkali-metal': '#fb7185',
  'alkaline-earth': '#fdba74',
  'transition-metal': '#fbbf24',
  'post-transition-metal': '#a3e635',
  metalloid: '#34d399',
  nonmetal: '#22d3ee',
  halogen: '#60a5fa',
  'noble-gas': '#a78bfa',
  lanthanoid: '#f0abfc',
  actinoid: '#f472b6',
  unknown: '#94a3b8',
});

const PERIOD_LAYOUT = Object.freeze([
  Object.freeze([[1, 1], [2, 18]]),
  Object.freeze([[3, 1], [4, 2], [5, 13], [6, 14], [7, 15], [8, 16], [9, 17], [10, 18]]),
  Object.freeze([[11, 1], [12, 2], [13, 13], [14, 14], [15, 15], [16, 16], [17, 17], [18, 18]]),
  Object.freeze(Array.from({ length: 18 }, (_, index) => Object.freeze([19 + index, index + 1]))),
  Object.freeze(Array.from({ length: 18 }, (_, index) => Object.freeze([37 + index, index + 1]))),
  Object.freeze([[55, 1], [56, 2], ...Array.from({ length: 15 }, (_, index) => Object.freeze([57 + index, index + 3])), ...Array.from({ length: 15 }, (_, index) => Object.freeze([72 + index, index + 4]))]),
  Object.freeze([[87, 1], [88, 2], ...Array.from({ length: 15 }, (_, index) => Object.freeze([89 + index, index + 3])), ...Array.from({ length: 15 }, (_, index) => Object.freeze([104 + index, index + 4]))]),
]);

const PERIODIC_POSITION = new Map();
for (let periodIndex = 0; periodIndex < PERIOD_LAYOUT.length; periodIndex += 1) {
  for (const [atomicNumber, group] of PERIOD_LAYOUT[periodIndex]) {
    if (atomicNumber >= 57 && atomicNumber <= 71) {
      PERIODIC_POSITION.set(atomicNumber, Object.freeze({ period: 6, group: 3, row: 8, column: atomicNumber - 53, series: 'lanthanoid' }));
    } else if (atomicNumber >= 89 && atomicNumber <= 103) {
      PERIODIC_POSITION.set(atomicNumber, Object.freeze({ period: 7, group: 3, row: 9, column: atomicNumber - 85, series: 'actinoid' }));
    } else {
      PERIODIC_POSITION.set(atomicNumber, Object.freeze({ period: periodIndex + 1, group, row: periodIndex + 1, column: group, series: null }));
    }
  }
}

const METALLOIDS = new Set([5, 14, 32, 33, 51, 52]);
const NONMETALS = new Set([1, 6, 7, 8, 15, 16, 34]);
const POST_TRANSITION_METALS = new Set([13, 31, 49, 50, 81, 82, 83, 113, 114, 115, 116]);
const ALKALI_REACTIVE = new Set([3, 11, 19, 37, 55, 87]);
const OXIDIZERS = new Set([8, 9, 17]);

const SUBSTANCE_BEHAVIOR = Object.freeze({
  water: 'liquid', oil: 'liquid', lava: 'liquid', mercury: 'liquid', acid: 'liquid', blood: 'liquid', honey: 'liquid',
  smoke: 'gas', steam: 'gas',
  fire: 'energy', plasma: 'energy', sparks: 'energy',
  metal: 'powder', wood: 'powder', wax: 'powder', glass: 'powder', stone: 'powder', debris: 'powder', sand: 'powder', snow: 'powder', ice: 'powder',
});

const SUBSTANCE_REACTION = Object.freeze({
  water: SANDBOX_REACTION.WATER,
  ice: SANDBOX_REACTION.WATER,
  snow: SANDBOX_REACTION.WATER,
  steam: SANDBOX_REACTION.WATER_VAPOR,
  wood: SANDBOX_REACTION.COMBUSTIBLE,
  wax: SANDBOX_REACTION.COMBUSTIBLE,
  oil: SANDBOX_REACTION.COMBUSTIBLE,
  fire: SANDBOX_REACTION.FIRE,
  sparks: SANDBOX_REACTION.FIRE,
  acid: SANDBOX_REACTION.CORROSIVE,
  lava: SANDBOX_REACTION.LAVA,
});

const SUBSTANCE_FLAGS = Object.freeze({
  water: SANDBOX_FLAGS.WATER,
  ice: SANDBOX_FLAGS.WATER,
  steam: SANDBOX_FLAGS.WATER,
  wood: SANDBOX_FLAGS.FLAMMABLE,
  wax: SANDBOX_FLAGS.FLAMMABLE,
  oil: SANDBOX_FLAGS.FLAMMABLE,
  fire: SANDBOX_FLAGS.HOT | SANDBOX_FLAGS.TRANSIENT,
  sparks: SANDBOX_FLAGS.HOT | SANDBOX_FLAGS.TRANSIENT,
  smoke: SANDBOX_FLAGS.TRANSIENT,
  plasma: SANDBOX_FLAGS.HOT | SANDBOX_FLAGS.TRANSIENT,
  acid: SANDBOX_FLAGS.CORROSIVE,
  lava: SANDBOX_FLAGS.HOT,
});

const SUBSTANCE_INTERACTION = Object.freeze({
  water: SANDBOX_INTERACTION.AQUEOUS,
  acid: SANDBOX_INTERACTION.AQUEOUS,
  blood: SANDBOX_INTERACTION.AQUEOUS,
  honey: SANDBOX_INTERACTION.AQUEOUS,
  oil: SANDBOX_INTERACTION.IMMISCIBLE,
  mercury: SANDBOX_INTERACTION.IMMISCIBLE,
  lava: SANDBOX_INTERACTION.IMMISCIBLE,
  metal: SANDBOX_INTERACTION.CORRODIBLE,
  wood: SANDBOX_INTERACTION.CORRODIBLE,
  stone: SANDBOX_INTERACTION.CORRODIBLE,
});

const SPECIAL_SPECIES = Object.freeze([
  Object.freeze({
    code: 240,
    key: 'sandbox:gunpowder',
    substanceId: 'gunpowder',
    label: 'Gunpowder',
    icon: '✹',
    category: 'Gameplay mixture',
    behavior: SANDBOX_BEHAVIOR.POWDER,
    phase: SANDBOX_PHASE.SOLID,
    density: 126,
    mobility: 176,
    friction: 104,
    conductivity: 24,
    emissive: 0,
    interactionFlags: 0,
    flags: SANDBOX_FLAGS.FLAMMABLE | SANDBOX_FLAGS.EXPLOSIVE,
    reactionClass: SANDBOX_REACTION.EXPLOSIVE,
    meltPoint: 700,
    boilPoint: 900,
    defaultTemperature: SANDBOX_REFERENCE_TEMPERATURE_K,
    color: 0x6b4f2a,
    colorHex: '#6b4f2a',
    quality: 'gameplay',
    estimated: true,
    description: 'A qualitative gameplay mixture with an explicit combustion rule.',
  }),
]);

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
}

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function colorHex(color) {
  return `#${(Number(color) >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
}

function colorFromArray(color, fallback = 0x94a3b8) {
  if (!Array.isArray(color) || color.length < 3) return fallback;
  const r = clampByte(color[0] * 255);
  const g = clampByte(color[1] * 255);
  const b = clampByte(color[2] * 255);
  return (r << 16) | (g << 8) | b;
}

function phaseAtTemperature(meltPoint, boilPoint, temperatureK) {
  const temperature = Math.max(0, Number(temperatureK) || 0);
  if (temperature >= 10000) return SANDBOX_PHASE.PLASMA;
  if (Number.isFinite(meltPoint) && temperature < meltPoint) return SANDBOX_PHASE.SOLID;
  if (Number.isFinite(boilPoint) && temperature >= boilPoint) return SANDBOX_PHASE.GAS;
  return SANDBOX_PHASE.LIQUID;
}

function behaviorForPhase(phase) {
  if (phase === SANDBOX_PHASE.PLASMA) return SANDBOX_BEHAVIOR.ENERGY;
  if (phase === SANDBOX_PHASE.GAS) return SANDBOX_BEHAVIOR.GAS;
  if (phase === SANDBOX_PHASE.LIQUID) return SANDBOX_BEHAVIOR.LIQUID;
  return SANDBOX_BEHAVIOR.POWDER;
}

function behaviorFromName(name) {
  return SANDBOX_BEHAVIOR[String(name || '').toUpperCase()] ?? SANDBOX_BEHAVIOR.POWDER;
}

function elementCategory(atomicNumber, group, series) {
  if (series) return series;
  if (group === 18) return 'noble-gas';
  if (group === 17) return 'halogen';
  if (group === 1 && atomicNumber !== 1) return 'alkali-metal';
  if (group === 2) return 'alkaline-earth';
  if (METALLOIDS.has(atomicNumber)) return 'metalloid';
  if (NONMETALS.has(atomicNumber)) return 'nonmetal';
  if (POST_TRANSITION_METALS.has(atomicNumber)) return 'post-transition-metal';
  if (group >= 3 && group <= 12) return 'transition-metal';
  return 'unknown';
}

function elementDensity(element, phase) {
  const massFraction = Math.max(0, Math.min(1, element.mass / 294));
  if (phase === SANDBOX_PHASE.GAS) return clampByte(18 + massFraction * 48);
  if (phase === SANDBOX_PHASE.LIQUID) return clampByte(112 + massFraction * 118);
  if (phase === SANDBOX_PHASE.PLASMA) return 14;
  return clampByte(92 + massFraction * 154);
}

function substanceDensity(substance, behavior) {
  if (behavior === SANDBOX_BEHAVIOR.ENERGY) return 10;
  if (behavior === SANDBOX_BEHAVIOR.GAS) return 28;
  const density = Number(substance.physics?.density);
  if (!Number.isFinite(density) || density <= 0) {
    return behavior === SANDBOX_BEHAVIOR.LIQUID ? 145 : 160;
  }
  return clampByte(22 + Math.log2(1 + density) / Math.log2(20001) * 222);
}

function elementReactionClass(element) {
  if (ALKALI_REACTIVE.has(element.atomicNumber)) return SANDBOX_REACTION.ALKALI_METAL;
  if (OXIDIZERS.has(element.atomicNumber)) return SANDBOX_REACTION.OXIDIZER;
  return SANDBOX_REACTION.NONE;
}

function elementFlags(element, estimated) {
  let flags = estimated ? SANDBOX_FLAGS.ESTIMATED : 0;
  if (ALKALI_REACTIVE.has(element.atomicNumber)) flags |= SANDBOX_FLAGS.FLAMMABLE;
  if (OXIDIZERS.has(element.atomicNumber)) flags |= SANDBOX_FLAGS.OXIDIZER;
  return flags;
}

function freezeSpecies(species) {
  return Object.freeze({
    ...species,
    provenance: Object.freeze({ ...species.provenance }),
  });
}

function createElementSpecies(element) {
  const position = PERIODIC_POSITION.get(element.atomicNumber) || Object.freeze({ period: 0, group: 0, row: 0, column: 0, series: null });
  const phase = phaseAtTemperature(element.meltPoint, element.boilPoint, SANDBOX_REFERENCE_TEMPERATURE_K);
  const estimated = element.atomicNumber >= 87;
  const quality = estimated ? 'estimated' : (element.atomicNumber >= 57 && element.atomicNumber <= 71 ? 'modelled' : 'reference');
  const categoryKey = elementCategory(element.atomicNumber, position.group, position.series);
  const behavior = behaviorForPhase(phase);
  const color = Number(element.cpkColor) >>> 0;
  return freezeSpecies({
    code: element.atomicNumber,
    key: `element:${element.symbol}`,
    atomicNumber: element.atomicNumber,
    symbol: element.symbol,
    label: element.name,
    name: element.name,
    icon: element.symbol,
    kind: 'element',
    category: categoryKey,
    categoryColor: CATEGORY_COLORS[categoryKey] || CATEGORY_COLORS.unknown,
    period: position.period,
    group: position.group,
    row: position.row,
    column: position.column,
    series: position.series,
    behavior,
    phase,
    density: elementDensity(element, phase),
    mobility: behavior === SANDBOX_BEHAVIOR.GAS ? 242 : behavior === SANDBOX_BEHAVIOR.LIQUID ? 210 : 150,
    friction: behavior === SANDBOX_BEHAVIOR.GAS ? 4 : behavior === SANDBOX_BEHAVIOR.LIQUID ? 22 : 118,
    conductivity: clampByte((element.electronegativity || 1.3) / 4 * 170),
    emissive: 0,
    interactionFlags: 0,
    flags: elementFlags(element, estimated),
    reactionClass: elementReactionClass(element),
    meltPoint: element.meltPoint,
    boilPoint: element.boilPoint,
    defaultTemperature: SANDBOX_REFERENCE_TEMPERATURE_K,
    mass: element.mass,
    electronegativity: element.electronegativity,
    color,
    colorHex: colorHex(color),
    quality,
    estimated,
    description: `Element ${element.atomicNumber}; qualitative bulk-cell behaviour at ${Math.round(SANDBOX_REFERENCE_TEMPERATURE_K)} K.`,
    provenance: {
      identity: 'engine/sim/particles/ParticleElementTable.js',
      reference: 'https://iupac.org/what-we-do/periodic-table-of-elements/',
      properties: 'https://physics.nist.gov/PhysRefData/Elements/per_noframes.html',
    },
  });
}

function createSubstanceSpecies(substance) {
  const behaviorName = SUBSTANCE_BEHAVIOR[substance.id] || 'powder';
  const behavior = behaviorFromName(behaviorName);
  const phase = behavior === SANDBOX_BEHAVIOR.LIQUID ? SANDBOX_PHASE.LIQUID
    : behavior === SANDBOX_BEHAVIOR.GAS ? SANDBOX_PHASE.GAS
      : behavior === SANDBOX_BEHAVIOR.ENERGY ? SANDBOX_PHASE.PLASMA
        : SANDBOX_PHASE.SOLID;
  const code = SANDBOX_SUBSTANCE_CODE_BASE + Number(substance.materialId);
  const color = colorFromArray(substance.visual?.color);
  const defaultTemperature = Number(substance.thermal?.defaultTemperature) || SANDBOX_REFERENCE_TEMPERATURE_K;
  return freezeSpecies({
    code,
    key: `substance:${substance.id}`,
    substanceId: substance.id,
    materialId: substance.materialId,
    label: substance.label || substance.id,
    name: substance.label || substance.id,
    icon: substance.icon || '●',
    kind: 'substance',
    category: substance.category || 'Substance',
    categoryColor: '#67e8f9',
    behavior,
    phase,
    density: substanceDensity(substance, behavior),
    mobility: behavior === SANDBOX_BEHAVIOR.ENERGY ? 250 : behavior === SANDBOX_BEHAVIOR.GAS ? 238 : behavior === SANDBOX_BEHAVIOR.LIQUID ? 205 : 154,
    friction: clampByte(finiteOr(substance.physics?.friction, behavior === SANDBOX_BEHAVIOR.LIQUID ? 0.1 : 0.45) * 220),
    conductivity: clampByte(finiteOr(substance.thermal?.conductivity, 0.15) * 80),
    emissive: clampByte(finiteOr(substance.visual?.emissive, SUBSTANCE_FLAGS[substance.id] & SANDBOX_FLAGS.HOT ? 1 : 0) * 180),
    flags: SUBSTANCE_FLAGS[substance.id] || 0,
    interactionFlags: SUBSTANCE_INTERACTION[substance.id] || 0,
    reactionClass: SUBSTANCE_REACTION[substance.id] || SANDBOX_REACTION.NONE,
    meltPoint: Number(substance.thermal?.meltPoint) || 0,
    boilPoint: Number(substance.thermal?.boilPoint) || 0,
    defaultTemperature,
    color,
    colorHex: colorHex(color),
    quality: 'curated',
    estimated: false,
    description: `${substance.category || 'Material'} profile from the Engine substance registry.`,
    provenance: {
      identity: `engine/sim/particles/substances/materials/${substance.id}`,
      reference: 'engine-substance-registry',
      properties: 'curated-engine-profile',
    },
  });
}

/**
 * Build an immutable shared element/substance/object view for dense sandboxes.
 */
export function createSandboxMaterialCatalog() {
  const elements = Object.freeze(getAllElements().map(createElementSpecies));
  const substances = Object.freeze(getAllSubstances()
    .filter(substance => Number.isInteger(substance.materialId)
      && substance.materialId > 0
      && SANDBOX_SUBSTANCE_CODE_BASE + substance.materialId < 240)
    .sort((left, right) => left.materialId - right.materialId)
    .map(createSubstanceSpecies));
  const special = Object.freeze(SPECIAL_SPECIES.map(species => freezeSpecies({
    ...species,
    kind: 'substance',
    categoryColor: '#f59e0b',
    provenance: {
      identity: 'engine/sim/particles/substances/SandboxMaterialCatalog.js',
      reference: 'qualitative-gameplay-profile',
      properties: 'authored',
    },
  })));
  const species = Object.freeze([...elements, ...substances, ...special].sort((left, right) => left.code - right.code));
  const speciesByCode = new Array(SANDBOX_SPECIES_CAPACITY).fill(null);
  const speciesByKey = Object.create(null);
  const speciesBySymbol = Object.create(null);
  for (const entry of species) {
    if (speciesByCode[entry.code]) throw new Error(`Duplicate sandbox cell code ${entry.code}`);
    speciesByCode[entry.code] = entry;
    speciesByKey[entry.key] = entry;
    if (entry.symbol) speciesBySymbol[entry.symbol] = entry;
  }
  Object.freeze(speciesByCode);
  Object.freeze(speciesByKey);
  Object.freeze(speciesBySymbol);
  const catalog = Object.freeze({
    schema: 'particle-realms.sandbox-material-catalog',
    schemaVersion: '1.0.0',
    fidelity: 'qualitative-mesoscale-rule-system',
    referenceTemperatureK: SANDBOX_REFERENCE_TEMPERATURE_K,
    elements,
    substances: Object.freeze([...substances, ...special]),
    objects: SANDBOX_OBJECTS,
    species,
    speciesByCode,
    speciesByKey,
    speciesBySymbol,
    provenance: Object.freeze({
      elementNames: 'https://iupac.org/what-we-do/periodic-table-of-elements/',
      elementProperties: 'https://physics.nist.gov/PhysRefData/Elements/per_noframes.html',
      machineReadableReference: 'https://pubchem.ncbi.nlm.nih.gov/periodic-table/',
    }),
  });
  validateSandboxMaterialCatalog(catalog);
  return catalog;
}

/** Compile the shared catalog into one vec4<u32> record per cell code. */
export function createSandboxSpeciesLut(catalog = createSandboxMaterialCatalog()) {
  validateSandboxMaterialCatalog(catalog);
  const words = new Uint32Array(SANDBOX_SPECIES_CAPACITY * 4);
  for (const entry of catalog.species) {
    const offset = entry.code * 4;
    words[offset] = (entry.behavior & 0xff)
      | ((entry.density & 0xff) << 8)
      | ((entry.mobility & 0xff) << 16)
      | ((entry.flags & 0xff) << 24);
    words[offset + 1] = temperatureToSandboxBucket(entry.meltPoint)
      | (temperatureToSandboxBucket(entry.boilPoint) << 8)
      | (temperatureToSandboxBucket(entry.defaultTemperature) << 16)
      | ((entry.reactionClass & 0xff) << 24);
    const neutronCount = entry.kind === 'element'
      ? clampByte(Math.max(0, Math.round(Number(entry.mass) || entry.atomicNumber) - entry.atomicNumber))
      : 0;
    words[offset + 2] = (entry.color & 0xffffff) | ((neutronCount & 0xff) << 24);
    words[offset + 3] = (entry.friction & 0xff)
      | ((entry.conductivity & 0xff) << 8)
      | ((entry.emissive & 0xff) << 16)
      | (((entry.interactionFlags || 0) & 0xff) << 24);
  }
  return words;
}

export function temperatureToSandboxBucket(temperatureK) {
  return clampByte(Math.max(0, Number(temperatureK) || 0) / SANDBOX_TEMPERATURE_STEP_K);
}

export function sandboxBucketToTemperature(bucket) {
  return clampByte(bucket) * SANDBOX_TEMPERATURE_STEP_K;
}

export function packSandboxCell(speciesCode, temperatureK = SANDBOX_REFERENCE_TEMPERATURE_K, life = 255, variant = 0) {
  const code = clampByte(speciesCode);
  if (code === 0) return 0;
  return (code
    | (temperatureToSandboxBucket(temperatureK) << 8)
    | (clampByte(life) << 16)
    | (clampByte(variant) << 24)) >>> 0;
}

export function unpackSandboxCell(cell) {
  const word = Number(cell) >>> 0;
  return Object.freeze({
    speciesCode: word & 0xff,
    temperatureBucket: (word >>> 8) & 0xff,
    temperatureK: sandboxBucketToTemperature((word >>> 8) & 0xff),
    life: (word >>> 16) & 0xff,
    variant: (word >>> 24) & 0xff,
  });
}

export function packSandboxObject(objectId, sourceSpeciesCode = 0, strength = 255, direction = 0) {
  return ((clampByte(objectId) & 0xff)
    | ((clampByte(sourceSpeciesCode) & 0xff) << 8)
    | ((clampByte(strength) & 0xff) << 16)
    | ((clampByte(direction) & 0xff) << 24)) >>> 0;
}

export function unpackSandboxObject(objectWord) {
  const word = Number(objectWord) >>> 0;
  return Object.freeze({
    objectId: word & 0xff,
    sourceSpeciesCode: (word >>> 8) & 0xff,
    strength: (word >>> 16) & 0xff,
    direction: (word >>> 24) & 0xff,
  });
}

export function sandboxSpeciesIdForSubstance(materialId) {
  const id = Number(materialId);
  if (!Number.isInteger(id) || id <= 0 || SANDBOX_SUBSTANCE_CODE_BASE + id >= 240) return 0;
  return SANDBOX_SUBSTANCE_CODE_BASE + id;
}

export function validateSandboxMaterialCatalog(catalog) {
  if (!catalog || catalog.schema !== 'particle-realms.sandbox-material-catalog') {
    throw new TypeError('Invalid sandbox material catalog schema');
  }
  if (!Array.isArray(catalog.elements) || catalog.elements.length !== 118) {
    throw new RangeError('Sandbox material catalog must expose all 118 elements');
  }
  const codes = new Set();
  for (const entry of catalog.species || []) {
    if (!Number.isInteger(entry.code) || entry.code <= 0 || entry.code >= SANDBOX_SPECIES_CAPACITY) {
      throw new RangeError(`Sandbox species '${entry.key}' has an invalid cell code`);
    }
    if (codes.has(entry.code)) throw new RangeError(`Sandbox cell code ${entry.code} is duplicated`);
    codes.add(entry.code);
    if (!Number.isFinite(entry.density) || !Number.isFinite(entry.mobility)) {
      throw new TypeError(`Sandbox species '${entry.key}' has non-finite GPU properties`);
    }
  }
  return true;
}
