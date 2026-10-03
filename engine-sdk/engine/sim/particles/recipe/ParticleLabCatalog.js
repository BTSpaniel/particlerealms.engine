// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Curated Particle Sandbox experiments backed by the engine's matter registries. */

import { PARTICLE_CONFIG } from '../ParticleConfig.js';
import { getElementBySymbol, MOLECULE_PRESETS } from '../ParticleElementTable.js';
import { MATERIAL, getMaterialName } from '../ParticleReactionTable.js';
import { ALL_SUBSTANCES } from '../substances/materials/index.js';

export const ENGINE_PARTICLE_HARD_LIMIT = PARTICLE_CONFIG.hardMaxParticles;
export const ENGINE_SUBSTANCE_COUNT = ALL_SUBSTANCES.length;
export const ENGINE_ELEMENT_COUNT = 118;
export const ENGINE_MOLECULE_COUNT = Object.keys(MOLECULE_PRESETS).length;

/** Truthful classification labels used by every built-in particle preset. */
export const PARTICLE_CLASSIFICATIONS = Object.freeze({
  ARTISTIC: 'Artistic',
  EDUCATIONAL_MODEL: 'Educational Model',
});

export const PARTICLE_PRESETS = Object.freeze({
  solar: Object.freeze({ label: 'Solar plasma', hue: .075, spread: .13, background: Object.freeze([0.012, .004, .002, 1]) }),
  neon: Object.freeze({ label: 'Neon reactor', hue: .78, spread: .35, background: Object.freeze([.004, .002, .025, 1]) }),
  ocean: Object.freeze({ label: 'Ocean current', hue: .52, spread: .16, background: Object.freeze([.001, .012, .02, 1]) }),
  aurora: Object.freeze({ label: 'Aurora field', hue: .34, spread: .30, background: Object.freeze([.001, .014, .016, 1]) }),
  ember: Object.freeze({ label: 'Ember storm', hue: .015, spread: .09, background: Object.freeze([.025, .003, .001, 1]) }),
  ion: Object.freeze({ label: 'Ion discharge', hue: .61, spread: .42, background: Object.freeze([.003, .005, .026, 1]) }),
  chemical: Object.freeze({ label: 'Reaction spectrum', hue: .12, spread: .62, background: Object.freeze([.009, .006, .012, 1]) }),
  spectral: Object.freeze({ label: 'Full spectrum', hue: .92, spread: .95, background: Object.freeze([.003, .002, .012, 1]) }),
});

/** Presentation styles backed by explicit WebGPU blend and depth policies. */
export const PARTICLE_RENDER_STYLES = Object.freeze({
  glow: Object.freeze({ id: 0, label: 'Luminous glow', blend: 'additive', depthWrite: false, description: 'Pixel-sized HDR particles with compact emissive cores and highlight-limited bloom.' }),
  volume: Object.freeze({ id: 1, label: 'Soft volume', blend: 'alpha', depthWrite: false, description: 'Premultiplied density particles for smoke, fluid, and atmospheric effects.' }),
  solid: Object.freeze({ id: 2, label: 'PBR spheres', blend: 'opaque', depthWrite: true, description: 'Depth-writing GGX-lit sphere billboards with key, fill, Fresnel, and specular response.' }),
  unlit: Object.freeze({ id: 3, label: 'Full bright', blend: 'opaque', depthWrite: true, description: 'Depth-writing unlit color that remains bright independent of surface lighting.' }),
});

/** Artist-selectable micro-surface families sampled by lit and volumetric particles. */
export const PARTICLE_MATERIAL_PROFILES = Object.freeze({
  adaptive: Object.freeze({ id: 0, label: 'Adaptive matter', layer: -1, metallic: .08, roughness: .4, description: 'Selects plasma, frost, or molten detail from the live particle state.' }),
  plasma: Object.freeze({ id: 1, label: 'Ion plasma', layer: 0, metallic: .18, roughness: .24, description: 'Generated ion filaments with sharp emissive microstructure.' }),
  frost: Object.freeze({ id: 2, label: 'Crystal frost', layer: 1, metallic: 0, roughness: .34, description: 'Generated crystalline facets with dielectric frost response.' }),
  molten: Object.freeze({ id: 3, label: 'Molten mineral', layer: 2, metallic: .72, roughness: .46, description: 'Generated mineral crust with conductive grains and hot fissures.' }),
  procedural: Object.freeze({ id: 4, label: 'Procedural clean', layer: -1, metallic: .08, roughness: .32, description: 'Disables sampled micro-surface detail while retaining GGX lighting.' }),
});

/**
 * Build the color/depth portion shared by every particle render pipeline.
 * Keeping this policy centralized prevents the HDR and native paths from
 * silently disagreeing about blend or occlusion behavior.
 */
export function particleRenderPipelineState(styleId, colorFormat, depthFormat = 'depth24plus') {
  const style = PARTICLE_RENDER_STYLES[styleId];
  if (!style) throw new TypeError(`Unknown particle render style: ${styleId}`);
  if (typeof colorFormat !== 'string' || !colorFormat.trim()) throw new TypeError('Particle color format must be a non-empty string');
  const target = { format: colorFormat };
  if (style.blend === 'additive') {
    target.blend = { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } };
  } else if (style.blend === 'alpha') {
    target.blend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
  }
  return Object.freeze({
    target: Object.freeze(target),
    depthStencil: Object.freeze({ format: depthFormat, depthWriteEnabled: style.depthWrite, depthCompare: 'less' }),
  });
}

export const PARTICLE_CATEGORIES = Object.freeze({
  cosmic: Object.freeze({ label: 'Cosmic', modes: Object.freeze(['galaxy', 'nbody', 'supernova', 'blackhole', 'cometstorm', 'planetaryrings', 'pulsarjets', 'starcluster']) }),
  fields: Object.freeze({ label: 'Fields', modes: Object.freeze(['vortex', 'turbulence', 'electromagnetic', 'aurora', 'tornado', 'lightningcage', 'solarwind', 'gravitylens', 'magneticreconnection', 'vectorweave']) }),
  matter: Object.freeze({ label: 'Matter', modes: Object.freeze(['fountain', 'fluid', 'molecular', 'chemistry', 'oceanwaves', 'waterfall', 'lavaflow', 'crystalgrowth', 'smokechamber']) }),
  life: Object.freeze({ label: 'Life', modes: Object.freeze(['attractor', 'flock', 'jellyfishbloom', 'fireflyswarm', 'myceliumgrowth', 'planktoncurrent', 'neuralpulse']) }),
  events: Object.freeze({ label: 'Events', modes: Object.freeze(['fireworks', 'meteorshower', 'rainstorm', 'snowglobe', 'sandstorm', 'geyserburst']) }),
});

const MACRO_DEFINITIONS = Object.freeze({
  count: Object.freeze({ key: 'count', label: 'Particle count', type: 'integer', min: 1_000, max: 10_000_000, step: 1_000, unit: 'particles' }),
  force: Object.freeze({ key: 'force', label: 'Field strength', type: 'number', min: .1, max: 4, step: .05, unit: 'relative' }),
  size: Object.freeze({ key: 'size', label: 'Particle size', type: 'number', min: .35, max: 8, step: .05, unit: 'px' }),
  exposure: Object.freeze({ key: 'exposure', label: 'Exposure', type: 'number', min: .35, max: 3, step: .05, unit: 'EV' }),
  emission: Object.freeze({ key: 'emission', label: 'Emission', type: 'number', min: 0, max: 4, step: .05, unit: 'relative' }),
  gravity: Object.freeze({ key: 'gravity', label: 'Gravity', type: 'number', min: -3, max: 3, step: .05, unit: 'relative' }),
  drag: Object.freeze({ key: 'drag', label: 'Velocity retention', type: 'number', min: .94, max: 1, step: .001, unit: 'ratio' }),
  turbulence: Object.freeze({ key: 'turbulence', label: 'Turbulence', type: 'number', min: 0, max: 4, step: .05, unit: 'relative' }),
  cohesion: Object.freeze({ key: 'cohesion', label: 'Cohesion', type: 'number', min: 0, max: 4, step: .05, unit: 'relative' }),
  temperature: Object.freeze({ key: 'temperature', label: 'Temperature', type: 'number', min: 50, max: 15_000, step: 50, unit: 'K' }),
  reactionRate: Object.freeze({ key: 'reactionRate', label: 'Reaction rate', type: 'number', min: 0, max: 3, step: .05, unit: 'relative' }),
  charge: Object.freeze({ key: 'charge', label: 'Charge', type: 'number', min: -3, max: 3, step: .05, unit: 'relative' }),
  trailPersistence: Object.freeze({ key: 'trailPersistence', label: 'Trail persistence', type: 'number', min: .7, max: .98, step: .01, unit: 'ratio' }),
  bloom: Object.freeze({ key: 'bloom', label: 'Bloom', type: 'number', min: 0, max: 2, step: .05, unit: 'relative' }),
  autoOrbit: Object.freeze({ key: 'autoOrbit', label: 'Auto orbit', type: 'number', min: 0, max: 1, step: .01, unit: 'speed' }),
});

/**
 * Return immutable macro descriptors for existing Particle Sandbox settings.
 * @param {string[]} keys
 * @returns {ReadonlyArray<object>}
 */
function macros(keys) {
  return Object.freeze(keys.map((key) => {
    const descriptor = MACRO_DEFINITIONS[key];
    if (!descriptor) throw new Error(`Unknown particle macro setting: ${key}`);
    return descriptor;
  }));
}

/**
 * Describe an available native-engine migration seam without claiming it is
 * already used by the lightweight Particle Sandbox shader.
 * @param {string[]} systems
 * @param {string} note
 * @returns {Readonly<object>}
 */
function nativeMigration(systems, note, status = 'available-not-connected') {
  return Object.freeze({
    status,
    world: 'engine/sim/particles/ParticleSimWorld.js#createParticleSimWorld',
    systems: Object.freeze([...systems]),
    note,
  });
}

/** @param {object} definition @returns {Readonly<object>} */
function defineMode(definition) {
  const classification = Object.values(PARTICLE_CLASSIFICATIONS).includes(definition.classification)
    ? definition.classification
    : PARTICLE_CLASSIFICATIONS.ARTISTIC;
  return Object.freeze({
    ...definition,
    runtimeId: Number.isInteger(definition.runtimeId) ? definition.runtimeId : definition.id,
    title: definition.title || definition.label,
    classification,
    tags: Object.freeze([...definition.tags]),
    limitations: Object.freeze([...definition.limitations]),
    defaults: Object.freeze({ ...definition.defaults }),
    macros: macros(definition.macros),
  });
}

/** Create a new authored recipe that deliberately reuses one audited solver family. */
function defineModeVariant(base, definition) {
  return defineMode({
    ...base,
    ...definition,
    runtimeId: Number.isInteger(definition.runtimeId) ? definition.runtimeId : base.runtimeId,
    tags: definition.tags,
    limitations: definition.limitations,
    defaults: { ...base.defaults, ...definition.defaults },
    macros: definition.macros || base.macros.map((macro) => macro.key),
    nativeMigration: definition.nativeMigration || nativeMigration(
      base.nativeMigration.systems,
      `This authored recipe reuses the ${base.label} visual solver family; connect the declared native systems before claiming native physical fidelity.`,
    ),
  });
}

const CORE_PARTICLE_MODES = Object.freeze({
  galaxy: defineMode({
    presetId: 'particle-realms.preset.galaxy.v1', label: 'Spiral galaxy', title: 'Spiral Galaxy', id: 0, category: 'cosmic',
    classification: PARTICLE_CLASSIFICATIONS.ARTISTIC, tags: ['space', 'orbit', 'spiral', 'trails'], difficulty: 2, fidelity: 'Stylized visual model',
    systems: 'orbital gravity · curl field', model: 'Analytic spiral-arm flow with a central attraction field.',
    description: 'Four luminous arms orbit a dense visual core in a deterministic GPU field.',
    limitations: ['Uses an analytic field, not pairwise stellar gravity or a cosmological model.', 'Scale, mass, and time are artistic relative units.'],
    macros: ['count', 'force', 'turbulence', 'cohesion', 'trailPersistence', 'bloom', 'autoOrbit'],
    nativeMigration: nativeMigration(['ParticleNBody.js'], 'Connected to explicit native mass state with a 10K interactive O(N²) ceiling; larger scenes retain the lightweight visual model.', 'runtime-connected-with-fallback'),
    defaults: { preset: 'solar', force: 1, gravity: 0, turbulence: .35, cohesion: 1.1, trails: true, trailPersistence: .88, bloom: 1.25, autoOrbit: .18, cameraDistance: 34 },
  }),
  vortex: defineMode({
    presetId: 'particle-realms.preset.vortex.v1', label: 'Quantum vortex', title: 'Quantum Vortex', id: 1, category: 'fields',
    classification: PARTICLE_CLASSIFICATIONS.ARTISTIC, tags: ['vortex', 'field', 'helical', 'trails'], difficulty: 2, fidelity: 'Stylized visual model',
    systems: 'vector field · vorticity', model: 'Procedural helical vector field with radial confinement.',
    description: 'A helical force field braids particles around a breathing axis.',
    limitations: ['The “quantum” name is thematic; no quantum-fluid equations are solved.', 'Vorticity is procedural and has no calibrated physical units.'],
    macros: ['count', 'force', 'turbulence', 'cohesion', 'trailPersistence', 'bloom'],
    nativeMigration: nativeMigration(['ParticleVectorField.js'], 'Use the native vector-field system for authored FGA data or reusable procedural fields.'),
    defaults: { preset: 'neon', force: 1.35, gravity: 0, turbulence: .65, cohesion: .35, trails: true, trailPersistence: .91, bloom: 1.4, autoOrbit: .12, cameraDistance: 32 },
  }),
  fountain: defineMode({
    presetId: 'particle-realms.preset.fountain.v1', label: 'Thermal fountain', title: 'Thermal Fountain', id: 2, category: 'matter',
    classification: PARTICLE_CLASSIFICATIONS.EDUCATIONAL_MODEL, tags: ['emitter', 'ballistic', 'gravity', 'thermal'], difficulty: 1, fidelity: 'Conceptual educational model',
    systems: 'emitter · gravity · phase color', model: 'Ballistic emitter with gravity, drag, lifetime reset, and temperature-driven color.',
    description: 'A temperature-colored ballistic emitter demonstrates gravity and drag controls.',
    limitations: ['Temperature affects appearance rather than a solved heat-transfer field.', 'No collision geometry, pressure, or calibrated projectile units are used.'],
    macros: ['count', 'force', 'gravity', 'drag', 'temperature', 'size', 'exposure'],
    nativeMigration: nativeMigration(['ParticleEmitterSystem.js'], 'Use ParticleEmitterSystem for reusable emitters, substances, lifetimes, and collision-aware spawning.'),
    defaults: { preset: 'ocean', force: 1, gravity: 1.25, turbulence: .25, cohesion: .2, temperature: 620, trails: false, bloom: .75, autoOrbit: .08, cameraDistance: 34 },
  }),
  attractor: defineMode({
    presetId: 'particle-realms.preset.attractor.v1', label: 'Strange attractor', title: 'Strange Attractor', id: 3, category: 'life',
    classification: PARTICLE_CLASSIFICATIONS.EDUCATIONAL_MODEL, tags: ['chaos', 'attractor', 'dynamics', 'trails'], difficulty: 3, fidelity: 'Conceptual educational model',
    systems: 'force points · chaotic flow', model: 'Time-varying multi-pole flow inspired by chaotic attractor phase portraits.',
    description: 'Moving force poles produce a repeatable, sensitive knot of particle motion.',
    limitations: ['The field is attractor-inspired rather than a named differential-equation solver.', 'The particle projection is qualitative and not suitable for numerical analysis.'],
    macros: ['count', 'force', 'turbulence', 'cohesion', 'trailPersistence', 'autoOrbit'],
    nativeMigration: nativeMigration(['ParticleVectorField.js'], 'Represent the field in ParticleVectorField before adding solver-specific integration and analysis.'),
    defaults: { preset: 'spectral', force: 1.25, gravity: 0, turbulence: .9, cohesion: 1.3, trails: true, trailPersistence: .93, bloom: 1.05, autoOrbit: .2, cameraDistance: 31 },
  }),
  turbulence: defineMode({
    presetId: 'particle-realms.preset.turbulence.v1', label: 'Curl-noise nebula', title: 'Curl-Noise Nebula', id: 4, category: 'fields',
    classification: PARTICLE_CLASSIFICATIONS.ARTISTIC, tags: ['noise', 'nebula', 'flow', 'volume'], difficulty: 2, fidelity: 'Stylized visual model',
    systems: 'FBM curl noise · volumetric glow', model: 'Procedural curl-noise advection with additive HDR rendering.',
    description: 'Procedural curl flow sculpts a luminous, cloud-like particle volume.',
    limitations: ['The field is noise-derived and is not a fluid or magnetohydrodynamics solve.', 'Glow indicates density and palette, not measured emission.'],
    macros: ['count', 'force', 'turbulence', 'drag', 'size', 'exposure', 'bloom'],
    nativeMigration: nativeMigration(['ParticleVectorField.js'], 'Use ParticleVectorField to share and sample a persistent 3D velocity field.'),
    defaults: { preset: 'aurora', force: 1.15, gravity: 0, turbulence: 1.8, cohesion: .15, trails: true, trailPersistence: .86, bloom: 1.15, autoOrbit: .14, cameraDistance: 35 },
  }),
  flock: defineMode({
    presetId: 'particle-realms.preset.flock.v1', label: 'Flocking ribbons', title: 'Flocking Ribbons', id: 5, category: 'life',
    classification: PARTICLE_CLASSIFICATIONS.EDUCATIONAL_MODEL, tags: ['flocking', 'swarm', 'cohesion', 'ribbons'], difficulty: 3, fidelity: 'Conceptual educational model',
    systems: 'leader fields · cohesion · curl avoidance', model: 'Leader-following bands with approximate cohesion and procedural avoidance.',
    description: 'Multiple GPU bands chase moving leaders and avoid the central field.',
    limitations: ['This lightweight path does not evaluate full per-neighbor Boids rules.', 'Agent perception, occlusion, and biological behavior are not modeled.'],
    macros: ['count', 'force', 'turbulence', 'cohesion', 'drag', 'trailPersistence'],
    nativeMigration: nativeMigration(['ParticleFlocking.js'], 'Connected to the native spatial-grid separation, alignment, and cohesion solver on compatible devices.', 'runtime-connected-with-fallback'),
    defaults: { preset: 'aurora', force: 1.1, gravity: 0, turbulence: .45, cohesion: 2.1, trails: true, trailPersistence: .9, bloom: .9, autoOrbit: .16, cameraDistance: 33 },
  }),
  electromagnetic: defineMode({
    presetId: 'particle-realms.preset.electromagnetic.v1', label: 'Magnetosphere', title: 'Magnetosphere', id: 6, category: 'fields',
    classification: PARTICLE_CLASSIFICATIONS.EDUCATIONAL_MODEL, tags: ['electromagnetic', 'charge', 'lorentz', 'field'], difficulty: 4, fidelity: 'Conceptual educational model',
    systems: 'electromagnetic · charged matter', model: 'Signed particles in analytic electric and magnetic-like force fields.',
    description: 'Positive and negative particles follow conceptual electric and Lorentz-like forces.',
    limitations: ['No Maxwell field solve, plasma collisions, or self-consistent charge density is computed.', 'Charge, field strength, distance, and time use relative visual units.'],
    macros: ['count', 'force', 'charge', 'temperature', 'drag', 'trailPersistence', 'bloom'],
    nativeMigration: nativeMigration(['ParticleElectromagnetic.js'], 'Connected to native charge buffers, external fields, and the engine electromagnetic pass on compatible devices.', 'runtime-connected-with-fallback'),
    defaults: { preset: 'ion', force: 1.2, gravity: 0, turbulence: .2, cohesion: .1, charge: 1.4, temperature: 9500, trails: true, trailPersistence: .94, bloom: 1.65, autoOrbit: .22, cameraDistance: 31 },
  }),
  chemistry: defineMode({
    presetId: 'particle-realms.preset.chemistry.v1', label: 'Reaction chamber', title: 'Reaction Chamber', id: 7, category: 'matter',
    classification: PARTICLE_CLASSIFICATIONS.EDUCATIONAL_MODEL, tags: ['chemistry', 'reaction', 'thermal', 'materials'], difficulty: 4, fidelity: 'Conceptual educational model',
    systems: 'chemistry · thermal · event products', model: 'Rule-based reactant lanes with probabilistic product-state changes.',
    description: 'Opposing material groups mix, change color, and emit heat under selectable reaction rules.',
    limitations: ['Reaction rules are discrete visual events, not molecular kinetics or stoichiometric simulation.', 'Temperature and energy values guide effects and are not laboratory predictions.'],
    macros: ['count', 'force', 'reactionRate', 'temperature', 'turbulence', 'cohesion', 'exposure'],
    nativeMigration: nativeMigration(['ParticleChemistry.js'], 'Connected to native element buffers, valence initialization, and the chemistry pass; event products remain outside this adapter.', 'runtime-connected-with-fallback'),
    defaults: { preset: 'chemical', force: 1, gravity: -.15, turbulence: .55, cohesion: .3, reactionRate: 1.15, temperature: 900, trails: true, trailPersistence: .84, bloom: 1.2, autoOrbit: .1, cameraDistance: 30 },
  }),
  fluid: defineMode({
    presetId: 'particle-realms.preset.fluid.v1', label: 'Cohesive fluid', title: 'Cohesive Fluid', id: 8, category: 'matter',
    classification: PARTICLE_CLASSIFICATIONS.EDUCATIONAL_MODEL, tags: ['fluid', 'cohesion', 'drag', 'flow'], difficulty: 3, fidelity: 'Conceptual educational model',
    systems: 'cohesion field · drag · vorticity', model: 'Global cohesion, gravity, damping, and procedural vorticity.',
    description: 'A lightweight visual liquid profile demonstrates cohesion, damping, and flow energy.',
    limitations: ['This preset does not compute SPH density, pressure, viscosity kernels, or free surfaces.', 'It must not be used for engineering fluid predictions.'],
    macros: ['count', 'force', 'gravity', 'drag', 'turbulence', 'cohesion', 'size'],
    nativeMigration: nativeMigration(['ParticleSPH.js'], 'Connected to native SPH density, pressure, viscosity, and spatial-grid neighborhood passes on compatible devices.', 'runtime-connected-with-fallback'),
    defaults: { preset: 'ocean', force: .9, gravity: 1, turbulence: .55, cohesion: 2.7, temperature: 293, trails: false, bloom: .55, autoOrbit: .08, cameraDistance: 29 },
  }),
  molecular: defineMode({
    presetId: 'particle-realms.preset.molecular.v1', label: 'Molecular lattice', title: 'Molecular Lattice', id: 9, category: 'matter',
    classification: PARTICLE_CLASSIFICATIONS.EDUCATIONAL_MODEL, tags: ['molecule', 'lattice', 'thermal', 'elements'], difficulty: 4, fidelity: 'Conceptual educational model',
    systems: 'element registry · lattice springs · thermal motion', model: 'Index-addressed lattice sites with spring-like restoration and temperature jitter.',
    description: 'Element-colored particles oscillate around deterministic lattice sites.',
    limitations: ['Particles are visual sites, not atoms with solved electronic structure or bonds.', 'Thermal motion and spring forces use relative units and omit quantum effects.'],
    macros: ['count', 'force', 'cohesion', 'temperature', 'turbulence', 'size', 'autoOrbit'],
    nativeMigration: nativeMigration(['ParticleLennardJones.js'], 'Connected to native Lennard-Jones pair forces and exact element buffers on compatible devices.', 'runtime-connected-with-fallback'),
    defaults: { preset: 'chemical', force: .8, gravity: 0, turbulence: .18, cohesion: 3.2, temperature: 420, trails: false, bloom: .8, autoOrbit: .22, cameraDistance: 27 },
  }),
  supernova: defineMode({
    presetId: 'particle-realms.preset.supernova.v1', label: 'Supernova shell', title: 'Supernova Shell', id: 10, category: 'cosmic',
    classification: PARTICLE_CLASSIFICATIONS.ARTISTIC, tags: ['space', 'explosion', 'shockwave', 'thermal'], difficulty: 2, fidelity: 'Stylized visual model',
    systems: 'collapse field · thermal color · shockwave', model: 'Periodic radial collapse and expanding shell impulse with temperature color.',
    description: 'A repeating stellar visual event collapses and launches a hot expanding shell.',
    limitations: ['No stellar evolution, radiation transport, nucleosynthesis, or relativistic shock physics is solved.', 'The cycle is intentionally repeatable and uses artistic timing.'],
    macros: ['count', 'force', 'temperature', 'turbulence', 'trailPersistence', 'bloom', 'exposure'],
    nativeMigration: nativeMigration(['ParticleEmitterSystem.js', 'ParticleEventSpawn.js'], 'Use engine emitters and event spawning for authored phases, products, and reusable event timing.'),
    defaults: { preset: 'ember', force: 1.45, gravity: 0, turbulence: .8, cohesion: .25, temperature: 12000, trails: true, trailPersistence: .9, bloom: 1.75, autoOrbit: .12, cameraDistance: 36 },
  }),
  aurora: defineMode({
    presetId: 'particle-realms.preset.aurora.v1', label: 'Aurora curtains', title: 'Aurora Curtains', id: 11, category: 'fields',
    classification: PARTICLE_CLASSIFICATIONS.ARTISTIC, tags: ['aurora', 'magnetic', 'curtain', 'charged'], difficulty: 2, fidelity: 'Stylized visual model',
    systems: 'magnetic field · wave phase', model: 'Layered sinusoidal curtains with charge-colored advection.',
    description: 'Charged ribbons travel along animated, magnetic-inspired curtains.',
    limitations: ['Curtains are procedural and do not model solar-wind particles or atmospheric excitation.', 'Geography, altitude, and geomagnetic data are not represented.'],
    macros: ['count', 'force', 'charge', 'turbulence', 'cohesion', 'trailPersistence', 'bloom'],
    nativeMigration: nativeMigration(['ParticleElectromagnetic.js', 'ParticleVectorField.js'], 'Combine native electromagnetic forces with a spatial vector field for data-driven curtains.'),
    defaults: { preset: 'aurora', force: .85, gravity: 0, turbulence: .35, cohesion: .8, charge: .8, temperature: 4800, trails: true, trailPersistence: .9, bloom: 1.35, autoOrbit: .09, cameraDistance: 33 },
  }),
  fireworks: defineMode({
    presetId: 'particle-realms.preset.fireworks.v1', label: 'Event fireworks', title: 'Event Fireworks', id: 12, category: 'events',
    classification: PARTICLE_CLASSIFICATIONS.ARTISTIC, tags: ['fireworks', 'event', 'emitter', 'sparks'], difficulty: 1, fidelity: 'Stylized visual model',
    systems: 'event spawn · sub-emitter · thermal', model: 'Deterministic time lanes for rockets, radial shells, sparks, and ballistic embers.',
    description: 'Staggered GPU bursts produce rockets, shells, sparks, and embers.',
    limitations: ['The lightweight shader uses timed particle lanes rather than a general event graph.', 'Combustion, wind, sound propagation, and safety distances are not modeled.'],
    macros: ['count', 'force', 'gravity', 'drag', 'temperature', 'trailPersistence', 'bloom'],
    nativeMigration: nativeMigration(['ParticleEmitterSystem.js', 'ParticleEventSpawn.js', 'ParticleEventSystem.js'], 'Use the native emitter and event systems for chained, reusable sub-emitter graphs.'),
    defaults: { preset: 'spectral', force: 1, gravity: 1.2, turbulence: .28, cohesion: 0, temperature: 3200, trails: true, trailPersistence: .88, bloom: 1.55, autoOrbit: .04, cameraDistance: 38 },
  }),
  tornado: defineMode({
    presetId: 'particle-realms.preset.tornado.v1', label: 'Tornado field', title: 'Tornado Field', id: 13, category: 'fields',
    classification: PARTICLE_CLASSIFICATIONS.EDUCATIONAL_MODEL, tags: ['tornado', 'vector-field', 'lift', 'turbulence'], difficulty: 3, fidelity: 'Conceptual educational model',
    systems: '3D vector field · soft containment', model: 'Height-varying swirl, radial confinement, lift, and procedural turbulence.',
    description: 'A procedural funnel lifts and ejects particles through a controllable 3D field.',
    limitations: ['This is not a computational weather or fluid-dynamics model.', 'Pressure, humidity, terrain, debris collisions, and real wind units are omitted.'],
    macros: ['count', 'force', 'gravity', 'turbulence', 'cohesion', 'drag', 'trailPersistence'],
    nativeMigration: nativeMigration(['ParticleVectorField.js'], 'Use the native field system for reusable tornado fields or imported volumetric FGA data.'),
    defaults: { preset: 'ember', force: 1.2, gravity: .35, turbulence: 1.35, cohesion: .35, trails: true, trailPersistence: .88, bloom: .9, autoOrbit: .15, cameraDistance: 34 },
  }),
  nbody: defineMode({
    presetId: 'particle-realms.preset.nbody.v1', label: 'Orbital clusters', title: 'Orbital Clusters', id: 14, category: 'cosmic',
    classification: PARTICLE_CLASSIFICATIONS.EDUCATIONAL_MODEL, tags: ['orbit', 'gravity', 'clusters', 'space'], difficulty: 4, fidelity: 'Conceptual educational model',
    systems: 'multi-well gravity · orbital renderer', model: 'Three animated analytic gravity wells with independently advected test particles.',
    description: 'Three moving gravity wells exchange streams of orbiting visual particles.',
    limitations: ['Particles do not exert pairwise gravity or conserve the energy of a full N-body system.', 'Mass, distance, and time are relative values intended for interactive exploration.'],
    macros: ['count', 'force', 'turbulence', 'cohesion', 'drag', 'trailPersistence', 'autoOrbit'],
    nativeMigration: nativeMigration(['ParticleNBody.js'], 'Connected to native gravity integration and explicit mass state with a 10K interactive O(N²) ceiling.', 'runtime-connected-with-fallback'),
    defaults: { preset: 'spectral', force: 1.15, gravity: 0, turbulence: .15, cohesion: .65, trails: true, trailPersistence: .92, bloom: 1.4, autoOrbit: .24, cameraDistance: 37 },
  }),
});

const EXTRA_PARTICLE_MODES = Object.freeze({
  blackhole: defineModeVariant(CORE_PARTICLE_MODES.galaxy, {
    presetId: 'particle-realms.preset.blackhole.v1', label: 'Black-hole accretion', title: 'Black-Hole Accretion', id: 15, category: 'cosmic', previewKind: 'accretion-disk',
    classification: PARTICLE_CLASSIFICATIONS.ARTISTIC, tags: ['space', 'accretion', 'disk', 'relativistic-inspired'], difficulty: 3, fidelity: 'Stylized visual model',
    systems: 'orbital gravity · accretion disk · polar glow', model: 'Layered orbital bands with a dark central mask and accelerated inner flow.',
    description: 'Hot orbital bands shear around a dark core while polar particles form narrow luminous outflows.',
    limitations: ['No general relativity, event horizon, radiation transport, or magnetohydrodynamics is solved.', 'The dark core and jets are artistic visualization cues.'],
    defaults: { preset: 'neon', force: 1.55, turbulence: .42, cohesion: 1.55, renderStyle: 'glow', materialProfile: 'plasma', materialDetail: .75, bloom: 1.65, autoOrbit: .2, cameraDistance: 32 },
  }),
  cometstorm: defineModeVariant(CORE_PARTICLE_MODES.supernova, {
    presetId: 'particle-realms.preset.cometstorm.v1', label: 'Comet storm', title: 'Comet Storm', id: 16, category: 'cosmic', previewKind: 'comet-streaks',
    classification: PARTICLE_CLASSIFICATIONS.ARTISTIC, tags: ['space', 'comets', 'tails', 'streaks'], difficulty: 2, fidelity: 'Stylized visual model',
    systems: 'radial emitter · curl tails · thermal color', model: 'Repeated directional launches with persistent curved tail particles.',
    description: 'Icy and incandescent comet heads cross the scene with long, wind-swept particle tails.',
    limitations: ['Orbits, sublimation, collisions, and solar radiation pressure are not computed.', 'Trail curvature and timing use artistic relative units.'],
    defaults: { preset: 'ion', force: 1.2, turbulence: .52, cohesion: .1, renderStyle: 'glow', materialProfile: 'frost', materialDetail: .72, temperature: 2400, trailPersistence: .95, bloom: 1.45, autoOrbit: .06, cameraDistance: 40 },
  }),
  planetaryrings: defineModeVariant(CORE_PARTICLE_MODES.galaxy, {
    presetId: 'particle-realms.preset.planetaryrings.v1', label: 'Planetary rings', title: 'Planetary Rings', id: 17, category: 'cosmic', previewKind: 'planetary-rings',
    classification: PARTICLE_CLASSIFICATIONS.EDUCATIONAL_MODEL, tags: ['space', 'rings', 'orbit', 'ice'], difficulty: 2, fidelity: 'Conceptual educational model',
    systems: 'banded orbit · radial gaps · tilted camera', model: 'Analytic concentric particle bands with seeded radial clearings.',
    description: 'Layered ice and dust bands orbit a central planet with visible gaps and tilted perspective.',
    limitations: ['Resonances, shepherd moons, particle collisions, and self-gravity are not solved.', 'Ring thickness and orbital speed use visual relative units.'],
    defaults: { preset: 'ocean', force: .88, turbulence: .08, cohesion: 1.35, renderStyle: 'solid', materialProfile: 'frost', materialDetail: .9, bloom: .45, autoOrbit: .14, cameraDistance: 36 },
  }),
  pulsarjets: defineModeVariant(CORE_PARTICLE_MODES.vortex, {
    presetId: 'particle-realms.preset.pulsarjets.v1', label: 'Pulsar jets', title: 'Pulsar Jets', id: 18, category: 'cosmic', previewKind: 'pulsar-jets',
    classification: PARTICLE_CLASSIFICATIONS.ARTISTIC, tags: ['space', 'pulsar', 'jets', 'beam'], difficulty: 3, fidelity: 'Stylized visual model',
    systems: 'axial vector field · rotating beam · emission pulse', model: 'Counter-propagating helical streams with a periodic emissive phase.',
    description: 'Twin helical jets pulse from a rotating stellar core and sweep narrow cones through space.',
    limitations: ['Neutron-star structure, magnetic reconnection, and relativistic plasma are not modeled.', 'Pulse timing and jet width are artistic.'],
    defaults: { preset: 'ion', force: 1.8, turbulence: .3, cohesion: .5, renderStyle: 'glow', materialProfile: 'plasma', materialDetail: .82, temperature: 14500, bloom: 1.9, autoOrbit: .26, cameraDistance: 35 },
  }),
  starcluster: defineModeVariant(CORE_PARTICLE_MODES.nbody, {
    presetId: 'particle-realms.preset.starcluster.v1', label: 'Globular star cluster', title: 'Globular Star Cluster', id: 19, category: 'cosmic', previewKind: 'star-cluster',
    classification: PARTICLE_CLASSIFICATIONS.EDUCATIONAL_MODEL, tags: ['space', 'cluster', 'gravity', 'stars'], difficulty: 3, fidelity: 'Conceptual educational model',
    systems: 'multi-well gravity · radial population · stellar palette', model: 'Centrally concentrated test particles orbiting three analytic moving wells.',
    description: 'A dense golden stellar core transitions into sparse blue-white halo orbits.',
    limitations: ['Stellar evolution, binary systems, relaxation, and pairwise gravity are not computed.', 'Population color is illustrative rather than astronomical measurement.'],
    defaults: { preset: 'solar', force: .95, turbulence: .12, cohesion: 1.8, renderStyle: 'glow', materialProfile: 'plasma', materialDetail: .5, bloom: 1.25, autoOrbit: .3, cameraDistance: 38 },
  }),

  lightningcage: defineModeVariant(CORE_PARTICLE_MODES.electromagnetic, {
    presetId: 'particle-realms.preset.lightningcage.v1', label: 'Lightning cage', title: 'Lightning Cage', id: 20, category: 'fields', previewKind: 'lightning-cage',
    classification: PARTICLE_CLASSIFICATIONS.ARTISTIC, tags: ['electric', 'arcs', 'charge', 'cage'], difficulty: 3, fidelity: 'Stylized visual model',
    systems: 'signed charge · arc lanes · electric field', model: 'Charged streams constrained between animated analytic pole pairs.',
    description: 'Branching ion streams snap between moving poles to form a pulsing electric cage.',
    limitations: ['Breakdown voltage, conductivity, plasma channels, and Maxwell equations are not solved.', 'Branches are seeded visual paths.'],
    defaults: { preset: 'ion', force: 1.65, charge: 2.1, turbulence: .75, cohesion: .15, renderStyle: 'glow', materialProfile: 'plasma', materialDetail: .95, bloom: 1.95, trailPersistence: .96, cameraDistance: 30 },
  }),
  solarwind: defineModeVariant(CORE_PARTICLE_MODES.aurora, {
    presetId: 'particle-realms.preset.solarwind.v1', label: 'Solar wind', title: 'Solar Wind Stream', id: 21, category: 'fields', previewKind: 'solar-wind',
    classification: PARTICLE_CLASSIFICATIONS.EDUCATIONAL_MODEL, tags: ['solar', 'wind', 'magnetic', 'stream'], difficulty: 3, fidelity: 'Conceptual educational model',
    systems: 'charged stream · field deflection · bow envelope', model: 'Directional charged particles deflected by a magnetic-inspired analytic envelope.',
    description: 'A broad solar particle stream bends around a compact magnetosphere and stretches into a tail.',
    limitations: ['No kinetic plasma, Maxwell, or solar-weather data is used.', 'Field strength and particle flux are relative visualization values.'],
    defaults: { preset: 'solar', force: 1.1, charge: 1.25, turbulence: .28, cohesion: .25, renderStyle: 'glow', materialProfile: 'plasma', materialDetail: .6, bloom: 1.2, autoOrbit: .04, cameraDistance: 38 },
  }),
  gravitylens: defineModeVariant(CORE_PARTICLE_MODES.vortex, {
    presetId: 'particle-realms.preset.gravitylens.v1', label: 'Gravity lens', title: 'Gravity Lens', id: 22, category: 'fields', previewKind: 'gravity-lens',
    classification: PARTICLE_CLASSIFICATIONS.ARTISTIC, tags: ['gravity', 'lens', 'caustic', 'space'], difficulty: 3, fidelity: 'Stylized visual model',
    systems: 'radial deflection · caustic ring · background stream', model: 'Analytic flow lines bend around a central exclusion radius.',
    description: 'Background particle streams curve into a bright ring around a dark central lens.',
    limitations: ['Light rays, spacetime curvature, redshift, and lens equations are not solved.', 'The caustic ring is a compositional effect.'],
    defaults: { preset: 'spectral', force: 1.42, turbulence: .12, cohesion: .9, renderStyle: 'glow', materialProfile: 'procedural', materialDetail: 0, bloom: 1.5, autoOrbit: .08, cameraDistance: 34 },
  }),
  magneticreconnection: defineModeVariant(CORE_PARTICLE_MODES.electromagnetic, {
    presetId: 'particle-realms.preset.reconnection.v1', label: 'Magnetic reconnection', title: 'Magnetic Reconnection', id: 23, category: 'fields', previewKind: 'reconnection',
    classification: PARTICLE_CLASSIFICATIONS.EDUCATIONAL_MODEL, tags: ['magnetic', 'reconnection', 'x-point', 'plasma'], difficulty: 4, fidelity: 'Conceptual educational model',
    systems: 'opposed fields · x-point flow · charged outflow', model: 'Opposed analytic field lanes converge and redirect through a central X-shaped region.',
    description: 'Two magnetic-inspired particle sheets converge, cross, and launch bright opposing outflows.',
    limitations: ['Resistive or collisionless reconnection physics is not solved.', 'Field topology and energy conversion are qualitative.'],
    defaults: { preset: 'neon', force: 1.5, charge: 1.6, turbulence: .62, cohesion: .1, renderStyle: 'glow', materialProfile: 'plasma', materialDetail: .9, bloom: 1.7, trailPersistence: .95, cameraDistance: 31 },
  }),
  vectorweave: defineModeVariant(CORE_PARTICLE_MODES.turbulence, {
    presetId: 'particle-realms.preset.vectorweave.v1', label: 'Vector weave', title: 'Vector Weave', id: 24, category: 'fields', previewKind: 'vector-weave',
    classification: PARTICLE_CLASSIFICATIONS.ARTISTIC, tags: ['vector-field', 'weave', 'flow', 'ribbons'], difficulty: 2, fidelity: 'Stylized visual model',
    systems: 'orthogonal curl fields · ribbon layers · phase palette', model: 'Two phase-shifted curl fields advect alternating particle bands.',
    description: 'Interlaced luminous streams pass over and under one another like a living woven field.',
    limitations: ['The weave is procedural and does not represent a measured vector field.', 'Apparent crossings have no collision or topology constraint.'],
    defaults: { preset: 'aurora', force: 1.05, turbulence: 1.25, cohesion: .65, renderStyle: 'glow', materialProfile: 'adaptive', materialDetail: .55, bloom: 1.1, trailPersistence: .94, cameraDistance: 34 },
  }),

  oceanwaves: defineModeVariant(CORE_PARTICLE_MODES.fluid, {
    presetId: 'particle-realms.preset.oceanwaves.v1', label: 'Ocean waves', title: 'Ocean Waves', id: 25, runtimeId: 15, category: 'matter', previewKind: 'ocean-waves',
    classification: PARTICLE_CLASSIFICATIONS.EDUCATIONAL_MODEL, tags: ['ocean', 'waves', 'water', 'surface'], difficulty: 3, fidelity: 'Conceptual educational model',
    systems: 'cohesive fluid · traveling wave field · foam layer', model: 'A bounded particle sheet follows superposed traveling height waves and curl advection.',
    description: 'Deep-blue swells roll across a layered particle ocean while bright foam gathers on animated crests.',
    limitations: ['No Navier-Stokes, SPH free surface, bathymetry, breaking-wave, or weather model is solved.', 'Wave height, speed, and foam are illustrative relative values.'],
    macros: ['count', 'force', 'gravity', 'drag', 'turbulence', 'cohesion', 'size', 'exposure', 'bloom'],
    defaults: { preset: 'ocean', force: 1.15, gravity: .55, drag: .994, turbulence: .7, cohesion: 3.1, renderStyle: 'volume', materialProfile: 'frost', materialDetail: .68, size: 2.2, exposure: 1.05, emission: 1.2, bloom: .7, autoOrbit: .03, cameraYaw: .58, cameraPitch: .52, cameraDistance: 22 },
  }),
  waterfall: defineModeVariant(CORE_PARTICLE_MODES.fountain, {
    presetId: 'particle-realms.preset.waterfall.v1', label: 'Waterfall canyon', title: 'Waterfall Canyon', id: 26, category: 'matter', previewKind: 'waterfall',
    classification: PARTICLE_CLASSIFICATIONS.ARTISTIC, tags: ['water', 'waterfall', 'mist', 'gravity'], difficulty: 2, fidelity: 'Stylized visual model',
    systems: 'sheet emitter · gravity · mist sub-layer', model: 'Wide ballistic emitter lanes descend into a rebounding mist volume.',
    description: 'A broad turquoise water sheet falls into a bright basin and disperses into drifting mist.',
    limitations: ['No collision geometry, fluid pressure, droplets, or terrain erosion is computed.', 'The basin and mist are visual emitter regions.'],
    defaults: { preset: 'ocean', force: .75, gravity: 2.2, drag: .989, turbulence: .38, cohesion: 1.4, renderStyle: 'volume', materialProfile: 'frost', materialDetail: .62, trails: true, trailPersistence: .8, bloom: .65, cameraDistance: 34 },
  }),
  lavaflow: defineModeVariant(CORE_PARTICLE_MODES.fluid, {
    presetId: 'particle-realms.preset.lavaflow.v1', label: 'Lava flow', title: 'Lava Flow', id: 27, category: 'matter', previewKind: 'lava-river',
    classification: PARTICLE_CLASSIFICATIONS.ARTISTIC, tags: ['lava', 'molten', 'flow', 'thermal'], difficulty: 2, fidelity: 'Stylized visual model',
    systems: 'cohesive flow · thermal color · cooling crust', model: 'Damped cohesive particles advect through a sloped curl field with temperature color.',
    description: 'A dense molten river snakes through dark crust, exposing bright orange fissures as it moves.',
    limitations: ['Viscosity, phase change, radiative cooling, terrain, and volcanic chemistry are not solved.', 'Crust and heat are appearance-driven.'],
    defaults: { preset: 'ember', force: .72, gravity: .7, drag: .998, turbulence: .32, cohesion: 3.6, temperature: 1450, renderStyle: 'solid', materialProfile: 'molten', materialDetail: 1, size: 3.1, emission: 1.7, bloom: 1.15, cameraDistance: 29 },
  }),
  crystalgrowth: defineModeVariant(CORE_PARTICLE_MODES.molecular, {
    presetId: 'particle-realms.preset.crystalgrowth.v1', label: 'Crystal growth', title: 'Crystal Growth', id: 28, category: 'matter', previewKind: 'crystal-growth',
    classification: PARTICLE_CLASSIFICATIONS.EDUCATIONAL_MODEL, tags: ['crystal', 'lattice', 'growth', 'facets'], difficulty: 4, fidelity: 'Conceptual educational model',
    systems: 'lattice anchors · seeded growth front · thermal jitter', model: 'Indexed lattice sites reveal outward from seeded axes under spring-like restoration.',
    description: 'Faceted cyan branches grow outward from seed points while lattice sites shimmer thermally.',
    limitations: ['Nucleation, diffusion, chemistry, defects, and crystallographic energetics are not computed.', 'Growth order is deterministic and illustrative.'],
    defaults: { preset: 'ion', force: .6, turbulence: .08, cohesion: 3.8, temperature: 260, renderStyle: 'solid', materialProfile: 'frost', materialDetail: 1, size: 2.7, bloom: .75, autoOrbit: .18, cameraDistance: 28 },
  }),
  smokechamber: defineModeVariant(CORE_PARTICLE_MODES.turbulence, {
    presetId: 'particle-realms.preset.smokechamber.v1', label: 'Smoke chamber', title: 'Smoke Chamber', id: 29, category: 'matter', previewKind: 'smoke-plume',
    classification: PARTICLE_CLASSIFICATIONS.ARTISTIC, tags: ['smoke', 'plume', 'volume', 'turbulence'], difficulty: 2, fidelity: 'Stylized visual model',
    systems: 'curl advection · buoyant plume · volumetric density', model: 'Layered curl-noise volume with upward bias and density-weighted opacity.',
    description: 'A dark rolling plume rises, folds, and thins through a softly lit chamber.',
    limitations: ['Combustion, buoyancy, heat transfer, pressure, and calibrated smoke density are not solved.', 'Volume density is an artistic opacity field.'],
    defaults: { preset: 'chemical', force: .78, gravity: -.45, drag: .997, turbulence: 2.1, cohesion: .35, renderStyle: 'volume', materialProfile: 'adaptive', materialDetail: .38, size: 4.2, exposure: .72, emission: .25, bloom: .25, cameraDistance: 31 },
  }),

  jellyfishbloom: defineModeVariant(CORE_PARTICLE_MODES.flock, {
    presetId: 'particle-realms.preset.jellyfishbloom.v1', label: 'Jellyfish bloom', title: 'Jellyfish Bloom', id: 30, category: 'life', previewKind: 'jellyfish-bloom',
    classification: PARTICLE_CLASSIFICATIONS.ARTISTIC, tags: ['jellyfish', 'ocean', 'bioluminescent', 'swarm'], difficulty: 2, fidelity: 'Stylized visual model',
    systems: 'leader fields · pulsed drift · trailing ribbons', model: 'Soft flock leaders drive pulsing bell clusters and persistent trailing particles.',
    description: 'Bioluminescent jellyfish-like clusters pulse upward through a dark ocean with ribboned tentacles.',
    limitations: ['No anatomy, swimming biomechanics, ecology, or ocean-current data is modeled.', 'Organisms are abstract particle groups.'],
    defaults: { preset: 'neon', force: .82, gravity: -.2, turbulence: .35, cohesion: 2.6, renderStyle: 'volume', materialProfile: 'plasma', materialDetail: .52, trailPersistence: .94, bloom: 1.45, autoOrbit: .06, cameraDistance: 32 },
  }),
  fireflyswarm: defineModeVariant(CORE_PARTICLE_MODES.flock, {
    presetId: 'particle-realms.preset.fireflyswarm.v1', label: 'Firefly swarm', title: 'Firefly Swarm', id: 31, category: 'life', previewKind: 'firefly-swarm',
    classification: PARTICLE_CLASSIFICATIONS.EDUCATIONAL_MODEL, tags: ['fireflies', 'swarm', 'synchrony', 'agents'], difficulty: 3, fidelity: 'Conceptual educational model',
    systems: 'leader fields · pulse phase · cohesion', model: 'Leader-following agents carry seeded blinking phases with approximate cohesion.',
    description: 'Warm lights drift through layered foliage space and gradually synchronize their pulses.',
    limitations: ['No insect perception, communication, obstacle avoidance, or biological oscillator model is solved.', 'Pulse synchronization is a visual phase pattern.'],
    defaults: { preset: 'solar', force: .65, turbulence: .52, cohesion: 2.2, renderStyle: 'glow', materialProfile: 'plasma', materialDetail: .35, size: 1.7, trailPersistence: .76, bloom: 1.2, autoOrbit: .02, cameraDistance: 30 },
  }),
  myceliumgrowth: defineModeVariant(CORE_PARTICLE_MODES.attractor, {
    presetId: 'particle-realms.preset.mycelium.v1', label: 'Mycelium growth', title: 'Mycelium Growth', id: 32, category: 'life', previewKind: 'mycelium',
    classification: PARTICLE_CLASSIFICATIONS.ARTISTIC, tags: ['mycelium', 'growth', 'branching', 'network'], difficulty: 3, fidelity: 'Stylized visual model',
    systems: 'branch attractors · seeded tips · nutrient glow', model: 'Time-varying attractor tips trace persistent branching paths through a bounded plane.',
    description: 'Fine luminous hyphae branch from multiple roots and weave into a dense underground network.',
    limitations: ['Fungal biology, nutrients, substrate chemistry, competition, and growth mechanics are not solved.', 'Branches are persistent attractor trails.'],
    defaults: { preset: 'aurora', force: .92, turbulence: .22, cohesion: 1.7, renderStyle: 'glow', materialProfile: 'frost', materialDetail: .58, size: 1.25, trailPersistence: .98, bloom: .7, autoOrbit: .01, cameraDistance: 29 },
  }),
  planktoncurrent: defineModeVariant(CORE_PARTICLE_MODES.fluid, {
    presetId: 'particle-realms.preset.plankton.v1', label: 'Plankton current', title: 'Plankton Current', id: 33, category: 'life', previewKind: 'plankton-current',
    classification: PARTICLE_CLASSIFICATIONS.ARTISTIC, tags: ['plankton', 'ocean', 'current', 'bioluminescent'], difficulty: 2, fidelity: 'Stylized visual model',
    systems: 'cohesive current · glow pulses · curl advection', model: 'Small emissive particles drift through a bounded procedural ocean-current field.',
    description: 'Thousands of blue-green plankton lights reveal rolling underwater currents and eddies.',
    limitations: ['Species behavior, population ecology, turbulence spectra, and measured ocean data are not modeled.', 'Luminescence is an artistic density cue.'],
    defaults: { preset: 'ocean', force: .88, gravity: .05, drag: .997, turbulence: 1.15, cohesion: 1.35, renderStyle: 'glow', materialProfile: 'plasma', materialDetail: .42, size: 1.4, bloom: 1.35, autoOrbit: .05, cameraDistance: 34 },
  }),
  neuralpulse: defineModeVariant(CORE_PARTICLE_MODES.attractor, {
    presetId: 'particle-realms.preset.neuralpulse.v1', label: 'Neural pulse web', title: 'Neural Pulse Web', id: 34, category: 'life', previewKind: 'neural-network',
    classification: PARTICLE_CLASSIFICATIONS.ARTISTIC, tags: ['neural', 'network', 'pulses', 'signals'], difficulty: 3, fidelity: 'Stylized visual model',
    systems: 'node attractors · traveling pulses · persistent paths', model: 'Moving analytic attractors route emissive particle pulses through a fixed visual graph.',
    description: 'Electric pulses race across a branching neural-inspired web and flare at junctions.',
    limitations: ['No neurons, synapses, membrane voltage, learning, or biological signaling is simulated.', 'The network is a visual routing metaphor.'],
    defaults: { preset: 'ion', force: 1.3, turbulence: .3, cohesion: 1.9, renderStyle: 'glow', materialProfile: 'plasma', materialDetail: .72, trailPersistence: .97, bloom: 1.6, autoOrbit: .04, cameraDistance: 30 },
  }),

  meteorshower: defineModeVariant(CORE_PARTICLE_MODES.fireworks, {
    presetId: 'particle-realms.preset.meteorshower.v1', label: 'Meteor shower', title: 'Meteor Shower', id: 35, category: 'events', previewKind: 'meteor-shower',
    classification: PARTICLE_CLASSIFICATIONS.ARTISTIC, tags: ['meteors', 'streaks', 'event', 'sky'], difficulty: 1, fidelity: 'Stylized visual model',
    systems: 'timed lanes · thermal streaks · fragment sparks', model: 'Seeded directional event lanes launch bright heads and fading ballistic trails.',
    description: 'A night sky fills with diagonal meteor streaks, glowing heads, and occasional fragment showers.',
    limitations: ['Atmospheric entry, ablation, trajectories, impact, and sky coordinates are not modeled.', 'Event timing is deterministic and artistic.'],
    defaults: { preset: 'solar', force: 1.25, gravity: .5, turbulence: .18, temperature: 5200, renderStyle: 'glow', materialProfile: 'molten', materialDetail: .68, trailPersistence: .97, bloom: 1.55, cameraDistance: 42 },
  }),
  rainstorm: defineModeVariant(CORE_PARTICLE_MODES.fountain, {
    presetId: 'particle-realms.preset.rainstorm.v1', label: 'Rainstorm', title: 'Rainstorm', id: 36, category: 'events', previewKind: 'rainstorm',
    classification: PARTICLE_CLASSIFICATIONS.ARTISTIC, tags: ['rain', 'storm', 'weather', 'event'], difficulty: 1, fidelity: 'Stylized visual model',
    systems: 'sheet emitter · gravity · wind curl', model: 'Repeated downward ballistic lanes with lateral curl and impact-reset timing.',
    description: 'Dense rain bands sweep diagonally across the scene under gusting wind and pale lightning flashes.',
    limitations: ['Cloud microphysics, weather, terrain impacts, accumulation, and real wind units are not solved.', 'Rain and flashes are visual event layers.'],
    defaults: { preset: 'ocean', force: 1.4, gravity: 2.8, drag: .995, turbulence: .75, cohesion: .05, renderStyle: 'unlit', materialProfile: 'frost', materialDetail: .4, size: 1.15, trails: true, trailPersistence: .82, bloom: .3, cameraDistance: 36 },
  }),
  snowglobe: defineModeVariant(CORE_PARTICLE_MODES.turbulence, {
    presetId: 'particle-realms.preset.snowglobe.v1', label: 'Snow globe', title: 'Snow Globe', id: 37, category: 'events', previewKind: 'snow-globe',
    classification: PARTICLE_CLASSIFICATIONS.ARTISTIC, tags: ['snow', 'globe', 'winter', 'event'], difficulty: 1, fidelity: 'Stylized visual model',
    systems: 'bounded curl field · settling flakes · shake impulse', model: 'Low-speed curl advection and gravity settle bright particles inside a circular visual boundary.',
    description: 'Soft crystalline flakes swirl, sparkle, and slowly settle inside a glass-like globe.',
    limitations: ['No collision geometry, air flow, ice crystals, or real snow settling is computed.', 'The globe boundary is a preview and composition cue.'],
    defaults: { preset: 'ion', force: .55, gravity: .45, drag: .999, turbulence: .65, cohesion: .08, renderStyle: 'solid', materialProfile: 'frost', materialDetail: 1, size: 2.1, exposure: 1.15, bloom: .55, autoOrbit: .02, cameraDistance: 28 },
  }),
  sandstorm: defineModeVariant(CORE_PARTICLE_MODES.tornado, {
    presetId: 'particle-realms.preset.sandstorm.v1', label: 'Sandstorm wall', title: 'Sandstorm Wall', id: 38, category: 'events', previewKind: 'sandstorm',
    classification: PARTICLE_CLASSIFICATIONS.ARTISTIC, tags: ['sand', 'storm', 'dust', 'event'], difficulty: 2, fidelity: 'Stylized visual model',
    systems: 'turbulent wall · lift · volumetric dust', model: 'Height-varying curl and lateral flow compress particles into a moving density front.',
    description: 'A towering amber dust wall rolls forward with turbulent billows and fast ground-level grains.',
    limitations: ['Weather, terrain, particle collisions, erosion, and real aerosol transport are not solved.', 'The advancing wall is a procedural density composition.'],
    defaults: { preset: 'ember', force: 1.65, gravity: .25, drag: .996, turbulence: 2.5, cohesion: .45, renderStyle: 'volume', materialProfile: 'molten', materialDetail: .42, size: 4.5, exposure: .8, emission: .15, bloom: .2, cameraDistance: 38 },
  }),
  geyserburst: defineModeVariant(CORE_PARTICLE_MODES.fountain, {
    presetId: 'particle-realms.preset.geyser.v1', label: 'Geyser burst', title: 'Geyser Burst', id: 39, category: 'events', previewKind: 'geyser-burst',
    classification: PARTICLE_CLASSIFICATIONS.ARTISTIC, tags: ['geyser', 'water', 'steam', 'event'], difficulty: 2, fidelity: 'Stylized visual model',
    systems: 'timed fountain · ballistic spray · steam plume', model: 'Periodic high-energy fountain emission followed by cooler ballistic spray and mist.',
    description: 'A compressed blue-white water column erupts, fans outward, and collapses into drifting steam.',
    limitations: ['Subsurface pressure, thermodynamics, phase change, rock geometry, and fluid collisions are not solved.', 'Eruption timing and steam are authored visual phases.'],
    defaults: { preset: 'ocean', force: 1.75, gravity: 1.9, drag: .992, turbulence: .48, cohesion: .7, temperature: 430, renderStyle: 'volume', materialProfile: 'frost', materialDetail: .62, size: 2.5, trails: true, trailPersistence: .78, bloom: .8, cameraDistance: 35 },
  }),
});

/** Complete immutable preset catalog: audited solver families plus authored recipe variants. */
export const PARTICLE_MODES = Object.freeze({ ...CORE_PARTICLE_MODES, ...EXTRA_PARTICLE_MODES });

export const PARTICLE_INTERACTIONS = Object.freeze({
  attract: Object.freeze({ label: 'Attract', id: 0, hint: 'Pull matter into the brush' }),
  repel: Object.freeze({ label: 'Repel', id: 1, hint: 'Push matter away' }),
  orbit: Object.freeze({ label: 'Orbit brush', id: 2, hint: 'Add tangential velocity' }),
  stir: Object.freeze({ label: 'Turbulence', id: 3, hint: 'Inject curl noise' }),
  heat: Object.freeze({ label: 'Heat', id: 4, hint: 'Raise temperature and emission' }),
  cool: Object.freeze({ label: 'Cool', id: 5, hint: 'Remove heat and damp motion' }),
  charge: Object.freeze({ label: 'Charge', id: 6, hint: 'Polarize nearby particles' }),
  shockwave: Object.freeze({ label: 'Shockwave', id: 7, hint: 'Launch an expanding impulse' }),
});

export const PARTICLE_REACTIONS = Object.freeze([
  Object.freeze({ id: 0, label: 'Fire + Water → Steam', a: MATERIAL.FIRE, b: MATERIAL.WATER, product: MATERIAL.STEAM, energy: 50 }),
  Object.freeze({ id: 1, label: 'Lava + Water → Obsidian', a: MATERIAL.LAVA, b: MATERIAL.WATER, product: MATERIAL.DEBRIS, energy: 200 }),
  Object.freeze({ id: 2, label: 'Plasma + Ice → Water', a: MATERIAL.PLASMA, b: MATERIAL.ICE, product: MATERIAL.WATER, energy: 80 }),
  Object.freeze({ id: 3, label: 'Fire + Smoke → Sparks', a: MATERIAL.FIRE, b: MATERIAL.SMOKE, product: MATERIAL.SPARKS, energy: 100 }),
]);

export const FEATURED_ELEMENTS = Object.freeze(['H', 'C', 'O', 'Na', 'Si', 'Fe', 'Cu', 'Au'].map((symbol) => getElementBySymbol(symbol)).filter(Boolean));

/** @param {string} mode @returns {string} */
export function categoryForMode(mode) {
  return PARTICLE_MODES[mode]?.category || 'cosmic';
}

/** @param {string} category @returns {Array<[string, string]>} */
export function modesForCategory(category) {
  return (PARTICLE_CATEGORIES[category]?.modes || PARTICLE_CATEGORIES.cosmic.modes).map((id) => [id, PARTICLE_MODES[id].label]);
}

/** @param {number} index @returns {string} */
export function reactionSummary(index) {
  const reaction = PARTICLE_REACTIONS[Math.max(0, Math.min(PARTICLE_REACTIONS.length - 1, index | 0))];
  return `${getMaterialName(reaction.a)} + ${getMaterialName(reaction.b)} → ${getMaterialName(reaction.product)} · ${reaction.energy} K`;
}

/** @param {string} mode @returns {object} */
export function technologySummary(mode) {
  const item = PARTICLE_MODES[mode] || PARTICLE_MODES.galaxy;
  return {
    ...item,
    engine: `${ENGINE_SUBSTANCE_COUNT} substance definitions · ${ENGINE_ELEMENT_COUNT} elements · ${ENGINE_MOLECULE_COUNT} molecule presets · native engine hard cap ${ENGINE_PARTICLE_HARD_LIMIT.toLocaleString('en-US')}`,
    runtime: item.nativeMigration.status === 'runtime-connected-with-fallback'
      ? 'Audited ParticleSimWorld mapping is connected when the selected count and granted GPU limits are compatible; otherwise the labeled lightweight visual model remains active.'
      : 'Interactive Particle Sandbox visual model; the declared native migration seam is not connected for this mode.',
  };
}
