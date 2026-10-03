// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleSchema.js - Unified JSON Schema for Particle System
 * 
 * Defines consistent data structures for:
 * - Particle buffer layouts (GPU data)
 * - Shader uniform parameters
 * - Emitter configurations
 * - Snapshot formats for rewind
 * 
 * All particle-related code should use these schemas for consistency.
 */

// ============================================================================
// BUFFER SCHEMAS - GPU Data Layouts
// ============================================================================

/**
 * Per-particle data layout in GPU buffers.
 * Each particle uses 3 vec4s (48 bytes total).
 */
export const PARTICLE_BUFFER_SCHEMA = {
  position: {
    buffer: "positions",
    layout: "vec4<f32>",
    fields: {
      x: { offset: 0, type: "f32", desc: "World X position" },
      y: { offset: 1, type: "f32", desc: "World Y position" },
      z: { offset: 2, type: "f32", desc: "World Z position" },
      age: { offset: 3, type: "f32", desc: "Current age in seconds" },
    },
  },
  velocity: {
    buffer: "velocities",
    layout: "vec4<f32>",
    fields: {
      vx: { offset: 0, type: "f32", desc: "Velocity X" },
      vy: { offset: 1, type: "f32", desc: "Velocity Y" },
      vz: { offset: 2, type: "f32", desc: "Velocity Z" },
      lifetime: { offset: 3, type: "f32", desc: "Total lifetime in seconds" },
    },
  },
  meta: {
    buffer: "meta",
    layout: "vec4<f32>",
    fields: {
      r: { offset: 0, type: "f32", desc: "Color red (0-1)" },
      g: { offset: 1, type: "f32", desc: "Color green (0-1)" },
      b: { offset: 2, type: "f32", desc: "Color blue (0-1)" },
      packed: { offset: 3, type: "f32", desc: "Packed: size*1e4 + renderMode*1e3 + shape*10 + behavior" },
    },
  },
  uv: {
    buffer: "uvs",
    layout: "vec4<f32>",
    fields: {
      u: { offset: 0, type: "f32", desc: "Texture U coordinate" },
      v: { offset: 1, type: "f32", desc: "Texture V coordinate" },
      opacity: { offset: 2, type: "f32", desc: "Per-particle opacity (0-1)" },
      flags: { offset: 3, type: "f32", desc: "Bitfield flags" },
    },
  },
  thermal: {
    buffer: "thermal",
    layout: "vec4<f32>",
    fields: {
      temperature: { offset: 0, type: "f32", desc: "Temperature in Kelvin (293 = room temp)" },
      phase: { offset: 1, type: "f32", desc: "Material phase: 0=solid, 1=liquid, 2=gas, 3=plasma" },
      packedGroupMaterial: { offset: 2, type: "f32", desc: "Packed: (collisionGroup << 8) | materialIdx. Lower 8 bits = material index (0-15), upper bits = collision group" },
      latentEnergy: { offset: 3, type: "f32", desc: "Latent energy accumulator for phase transitions (0 = not transitioning)" },
    },
  },
};

/**
 * Pack meta.w value from individual components (full format with physics)
 * Format: mass * 1e8 + drag * 1e6 + size * 1e4 + renderMode * 1e3 + shape * 10 + behavior
 * 
 * @param {number} size - Particle size (0-99)
 * @param {number} renderMode - Render mode ID (0-9)
 * @param {number} shape - Shape ID (0-9)
 * @param {number} behavior - Behavior ID (0-9)
 * @param {number} mass - Particle mass (0.0-9.9, encoded as 0-99)
 * @param {number} drag - Air resistance (0.0-0.99, encoded as 0-99)
 */
export function packParticleMeta(size, renderMode, shape, behavior = 0, mass = 1.0, drag = 0.02) {
  const massEncoded = Math.min(99, Math.floor(mass * 10));
  const dragEncoded = Math.min(99, Math.floor(drag * 100));
  const sizeEncoded = Math.min(99, Math.floor(size * 10));
  return massEncoded * 1e8 + dragEncoded * 1e6 + sizeEncoded * 1e4 + renderMode * 1e3 + (shape % 10) * 10 + behavior;
}

/**
 * Unpack meta.w value to individual components
 */
export function unpackParticleMeta(packed) {
  const mass = (Math.floor(packed / 1e8) % 100) * 0.1;
  const drag = (Math.floor(packed / 1e6) % 100) * 0.01;
  const size = (Math.floor(packed / 1e4) % 100) * 0.1;
  const renderMode = Math.floor(packed / 1e3) % 10;
  const shape = Math.floor(packed / 10) % 10;
  const behavior = Math.floor(packed) % 10;
  return { size, renderMode, shape, behavior, mass, drag };
}

// ============================================================================
// SHADER PARAM SCHEMAS - Uniform Structures
// ============================================================================

/**
 * Frame uniforms passed to all particle shaders
 */
export const FRAME_UNIFORMS_SCHEMA = {
  layout: "struct",
  size: 96, // bytes
  fields: {
    viewProj: { offset: 0, type: "mat4x4<f32>", size: 64, desc: "View-projection matrix" },
    viewRight: { offset: 64, type: "vec3<f32>", size: 12, desc: "Camera right vector" },
    _pad0: { offset: 76, type: "f32", size: 4, desc: "Padding" },
    viewUp: { offset: 80, type: "vec3<f32>", size: 12, desc: "Camera up vector" },
    _pad1: { offset: 92, type: "f32", size: 4, desc: "Padding" },
  },
};

/**
 * Per-draw particle parameters
 */
export const PARTICLE_PARAMS_SCHEMA = {
  layout: "struct",
  size: 32, // bytes (padded to 16-byte alignment)
  fields: {
    defaultSize: { offset: 0, type: "f32", desc: "Fallback particle size" },
    quality: { offset: 4, type: "f32", desc: "Render quality (0-1), affects culling" },
    lodBias: { offset: 8, type: "f32", desc: "LOD distance bias" },
    cullThreshold: { offset: 12, type: "f32", desc: "Max instance index to render (0=no limit)" },
    time: { offset: 16, type: "f32", desc: "Current simulation time" },
    deltaTime: { offset: 20, type: "f32", desc: "Frame delta time" },
    _pad: { offset: 24, type: "vec2<f32>", size: 8, desc: "Padding" },
  },
  defaults: {
    defaultSize: 2.0,
    quality: 1.0,
    lodBias: 1.0,
    cullThreshold: 0,
    time: 0,
    deltaTime: 0.016,
  },
};

/**
 * Force parameters uniform (group 2 binding 0 in main particle compute shader)
 * Controls global wind, turbulence, force points, vortex, and velocity clamping.
 */
export const FORCE_PARAMS_SCHEMA = {
  layout: "struct",
  size: 80, // bytes (5 × vec4 aligned)
  fields: {
    windDir:             { offset: 0,  type: "vec3<f32>", desc: "Wind direction (normalized)" },
    windStrength:        { offset: 12, type: "f32",       desc: "Wind speed (m/s). 0 = no wind" },
    gustPhase:           { offset: 16, type: "f32",       desc: "Current gust oscillation phase (radians)" },
    gustStrength:        { offset: 20, type: "f32",       desc: "Gust amplitude multiplier (0-2)" },
    turbulenceStrength:  { offset: 24, type: "f32",       desc: "Global turbulence intensity. 0 = disabled" },
    turbulenceScale:     { offset: 28, type: "f32",       desc: "Noise spatial frequency (default 2.0)" },
    turbulenceSpeed:     { offset: 32, type: "f32",       desc: "Noise panning speed (default 0.1)" },
    turbulenceOctaves:   { offset: 36, type: "u32",       desc: "Noise octaves 1-4 (default 1)" },
    forcePointCount:     { offset: 40, type: "u32",       desc: "Active attractor/repeller count (0-16)" },
    maxVelocity:         { offset: 44, type: "f32",       desc: "Velocity clamp m/s (default 100)" },
    vortexPos:           { offset: 48, type: "vec3<f32>", desc: "Vortex center position" },
    vortexStrength:      { offset: 60, type: "f32",       desc: "Vortex spin strength. 0 = off, negative = reverse" },
    vortexAxis:          { offset: 64, type: "vec3<f32>", desc: "Vortex rotation axis (default 0,1,0)" },
    vortexRadius:        { offset: 76, type: "f32",       desc: "Vortex falloff radius (default 5)" },
  },
  forcePointLayout: {
    desc: "Force points storage buffer (group 2 binding 1). Up to 16 entries.",
    stride: 16,
    fields: {
      position: { offset: 0, type: "vec3<f32>", desc: "World position" },
      strength: { offset: 12, type: "f32", desc: "Force strength. Negative = repel" },
    },
  },
};

// ============================================================================
// EMITTER CONFIG SCHEMAS
// ============================================================================

/**
 * Shape types for particle rendering
 */
export const PARTICLE_SHAPES = {
  sphere: { id: 0, label: "Sphere", desc: "3D shaded ball" },
  point: { id: 1, label: "Point", desc: "Tiny bright dot" },
  soft: { id: 2, label: "Soft", desc: "Gaussian glow" },
  spark: { id: 3, label: "Spark", desc: "Star/cross shape" },
  ring: { id: 4, label: "Ring", desc: "Hollow circle" },
  square: { id: 5, label: "Square", desc: "Flat square" },
  trail: { id: 6, label: "Trail", desc: "Motion streak" },
  orb: { id: 7, label: "Orb", desc: "Glowing energy ball" },
};

/**
 * Render modes for particle blending
 */
export const RENDER_MODES = {
  solid: { id: 0, label: "Solid", blend: "alpha" },
  gas: { id: 0, label: "Gas", blend: "alpha", overdrawReduction: true },
  smoke: { id: 0, label: "Smoke", blend: "alpha" },
  liquid: { id: 1, label: "Liquid", blend: "alpha" },
  water: { id: 1, label: "Water", blend: "alpha" },
  additive: { id: 2, label: "Additive", blend: "additive" },
  plasma: { id: 3, label: "Plasma", blend: "additive" },
  metaball: { id: 3, label: "Metaball", blend: "additive" },
  orb: { id: 3, label: "Orb", blend: "additive" },
  fire_core: { id: 3, label: "Fire Core", blend: "additive" },
};

/**
 * Behavior types for particle movement patterns
 */
export const PARTICLE_BEHAVIORS = {
  trail: { id: 0, label: "Trail", desc: "Follow velocity direction" },
  orbital: { id: 1, label: "Orbital", desc: "Circle around emitter" },
  rising: { id: 2, label: "Rising", desc: "Float upward with swirl" },
  spiral: { id: 3, label: "Spiral", desc: "Spiral inward" },
  explosion: { id: 4, label: "Explosion", desc: "Radiate outward" },
  wind: { id: 5, label: "Wind", desc: "Affected by wind force" },
};

/**
 * Get behavior ID from behavior name
 */
export function getBehaviorId(behaviorName) {
  return PARTICLE_BEHAVIORS[behaviorName]?.id ?? PARTICLE_BEHAVIORS.trail.id;
}

/**
 * Complete emitter configuration schema
 */
export const EMITTER_CONFIG_SCHEMA = {
  // Identity
  id: { type: "string", required: false, desc: "Unique emitter ID" },
  label: { type: "string", required: false, desc: "Display name" },
  entityId: { type: "number", required: false, desc: "Linked ECS entity ID" },
  
  // Visual
  shape: { type: "string", enum: Object.keys(PARTICLE_SHAPES), default: "sphere", desc: "Particle shape" },
  renderMode: { type: "string", enum: Object.keys(RENDER_MODES), default: "solid", desc: "Blend mode" },
  color: { type: "vec3", default: [1, 1, 1], desc: "Start color RGB (0-1)" },
  colorEnd: { type: "vec3", default: [1, 1, 1], desc: "End color RGB (0-1)" },
  pointSize: { type: "number", min: 0.1, max: 100, default: 2.0, desc: "Particle size in world units" },
  density: { type: "number", min: 0, max: 1, default: 0.5, desc: "Overdraw density factor" },
  
  // Timing
  emitRate: { type: "number", min: 0, max: 10000, default: 50, desc: "Particles per second" },
  maxParticles: { type: "number", min: 1, max: 1000000, default: 1000, desc: "Max alive particles" },
  lifetime: { type: "vec2", default: [1.0, 3.0], desc: "[min, max] lifetime in seconds" },
  fadeOut: { type: "boolean", default: true, desc: "Fade alpha at end of life" },
  
  // Physics
  position: { type: "vec3", default: [0, 0, 0], desc: "Emitter world position" },
  upSpeed: { type: "vec2", default: [1.0, 3.0], desc: "[min, max] initial vertical velocity" },
  horizontalSpeed: { type: "number", min: 0, max: 100, default: 0.5, desc: "Random horizontal spread" },
  gravity: { type: "number", min: -100, max: 100, default: 0, desc: "Vertical acceleration" },
  mass: { type: "number", min: 0.01, max: 10, default: 1.0, desc: "Particle mass" },
  drag: { type: "number", min: 0, max: 1, default: 0.01, desc: "Air resistance" },
  
  // Thermal
  temperature: { type: "number", min: 0, max: 100000, default: 293, desc: "Initial temperature in Kelvin (293 = room temp)" },
  phase: { type: "number", min: 0, max: 3, default: 0, desc: "Material phase: 0=solid, 1=liquid, 2=gas, 3=plasma" },
  collisionGroup: { type: "number", min: 0, max: 16777215, default: 0, desc: "Collision group ID (0=collides with all). Packed into upper bits of thermalData.z" },
  materialIndex: { type: "number", min: 0, max: 15, default: 0, desc: "Material index for thermal LUT (0=default, 1=water, 2=ice, 3=metal, 4=wood, 5=wax, 6=lava, 7=oil, 8=glass, 9=stone, 10=plasma)" },
  
  // Substance (GAP 33-44 integration) — drives real physics from periodic table
  substance: { type: "string", default: null, desc: "Element symbol ('H','O','Fe'), compound ('H2O','CO2'), or preset ('fire','water','smoke','magic'). null = legacy mode." },
  charge: { type: "number", min: -4, max: 4, default: 0, desc: "Electric charge per particle. 0 = auto-derive from element table." },
  sphRestDensity: { type: "number", min: 50, max: 5000, default: 1000, desc: "SPH rest density (kg/m³). Only used when state = liquid." },
  sphViscosity: { type: "number", min: 0, max: 2, default: 0.1, desc: "SPH viscosity coefficient. Only used when state = liquid." },
  
  // Over-lifetime curves (normalized 0-1)
  sizeOverLife: { type: "vec3", default: [1, 1, 1], desc: "[start, mid, end] size multiplier" },
  alphaOverLife: { type: "vec3", default: [1, 1, 1], desc: "[start, mid, end] alpha multiplier" },
  velocityOverLife: { type: "vec3", default: [1, 1, 1], desc: "[start, mid, end] velocity multiplier" },
  
  // Element layers (for color/behavior mixing)
  elements: { type: "array", items: "ElementLayer", default: [], desc: "Element composition" },
};

/**
 * Element layer for emitter mixing
 */
export const ELEMENT_LAYER_SCHEMA = {
  id: { type: "string", required: true, desc: "Element ID (fire, water, magic, smoke)" },
  power: { type: "number", min: 0, max: 1, default: 1.0, desc: "Blend weight" },
};

// ============================================================================
// SNAPSHOT SCHEMAS - Rewind System
// ============================================================================

/**
 * Single particle snapshot entry
 */
export const PARTICLE_SNAPSHOT_ENTRY_SCHEMA = {
  position: { type: "vec4", desc: "[x, y, z, age]" },
  velocity: { type: "vec4", desc: "[vx, vy, vz, lifetime]" },
  meta: { type: "vec4", desc: "[r, g, b, packed]" },
  thermal: { type: "vec4", desc: "[temperature, phase, packedGroupMaterial, latentEnergy]" },
};

/**
 * Emitter state snapshot
 */
export const EMITTER_SNAPSHOT_SCHEMA = {
  id: { type: "string", desc: "Emitter ID" },
  entityId: { type: "number", desc: "Linked entity ID" },
  position: { type: "vec3", desc: "World position" },
  particleCount: { type: "number", desc: "Active particle count" },
  spawnAccumulator: { type: "number", desc: "Fractional spawn accumulator" },
  config: { type: "EmitterConfig", desc: "Full emitter config snapshot" },
};

/**
 * Complete particle system snapshot
 */
export const PARTICLE_SYSTEM_SNAPSHOT_SCHEMA = {
  time: { type: "number", required: true, desc: "Simulation time" },
  frameIndex: { type: "number", required: true, desc: "Frame number" },
  particleCount: { type: "number", required: true, desc: "Total particles" },
  emitters: { type: "array", items: "EmitterSnapshot", desc: "All emitter states" },
  bufferOffset: { type: "number", desc: "Offset in history ring buffer" },
  isKeyframe: { type: "boolean", default: false, desc: "Full snapshot vs delta" },
};

// ============================================================================
// VALIDATION & FACTORY FUNCTIONS
// ============================================================================

/**
 * Validate a value against a schema field
 */
export function validateField(value, fieldSchema) {
  const errors = [];
  
  if (fieldSchema.required && value === undefined) {
    errors.push(`Required field is missing`);
    return { valid: false, errors };
  }
  
  if (value === undefined) {
    return { valid: true, value: fieldSchema.default };
  }
  
  if (fieldSchema.type === "number") {
    if (typeof value !== "number" || isNaN(value)) {
      errors.push(`Expected number, got ${typeof value}`);
    } else {
      if (fieldSchema.min !== undefined && value < fieldSchema.min) {
        errors.push(`Value ${value} below minimum ${fieldSchema.min}`);
      }
      if (fieldSchema.max !== undefined && value > fieldSchema.max) {
        errors.push(`Value ${value} above maximum ${fieldSchema.max}`);
      }
    }
  }
  
  if (fieldSchema.type === "string") {
    if (typeof value !== "string") {
      errors.push(`Expected string, got ${typeof value}`);
    } else if (fieldSchema.enum && !fieldSchema.enum.includes(value)) {
      errors.push(`Value "${value}" not in enum: ${fieldSchema.enum.join(", ")}`);
    }
  }
  
  if (fieldSchema.type === "boolean" && typeof value !== "boolean") {
    errors.push(`Expected boolean, got ${typeof value}`);
  }
  
  if (fieldSchema.type === "vec2" || fieldSchema.type === "vec3" || fieldSchema.type === "vec4") {
    const expectedLen = parseInt(fieldSchema.type.slice(3));
    if (!Array.isArray(value) || value.length !== expectedLen) {
      errors.push(`Expected ${fieldSchema.type}, got ${Array.isArray(value) ? `array[${value.length}]` : typeof value}`);
    }
  }
  
  return { valid: errors.length === 0, errors, value };
}

/**
 * Validate an emitter config against schema
 */
export function validateEmitterConfig(config) {
  const errors = [];
  const validated = {};
  
  for (const [key, fieldSchema] of Object.entries(EMITTER_CONFIG_SCHEMA)) {
    const result = validateField(config[key], fieldSchema);
    if (!result.valid) {
      errors.push(`${key}: ${result.errors.join(", ")}`);
    }
    validated[key] = result.value !== undefined ? result.value : config[key];
  }
  
  return { valid: errors.length === 0, errors, config: validated };
}

/**
 * Create a default emitter config
 */
export function createDefaultEmitterConfig(overrides = {}) {
  const config = {};
  
  for (const [key, fieldSchema] of Object.entries(EMITTER_CONFIG_SCHEMA)) {
    if (fieldSchema.default !== undefined) {
      config[key] = Array.isArray(fieldSchema.default) 
        ? [...fieldSchema.default] 
        : fieldSchema.default;
    }
  }
  
  return { ...config, ...overrides };
}

/**
 * Create a default particle params uniform buffer data
 */
export function createDefaultParticleParams(overrides = {}) {
  return { ...PARTICLE_PARAMS_SCHEMA.defaults, ...overrides };
}

/**
 * Create an empty particle snapshot
 */
export function createEmptySnapshot(time, frameIndex) {
  return {
    time,
    frameIndex,
    particleCount: 0,
    emitters: [],
    bufferOffset: 0,
    isKeyframe: true,
  };
}

/**
 * Create an emitter snapshot from live emitter state
 */
export function createEmitterSnapshot(emitter) {
  return {
    id: emitter.id || emitter.entityId?.toString() || "unknown",
    entityId: emitter.entityId,
    position: emitter.position ? [...emitter.position] : [0, 0, 0],
    particleCount: emitter.particleCount || 0,
    spawnAccumulator: emitter.spawnAccumulator || 0,
    config: { ...emitter.config },
  };
}

/**
 * Get shape ID from shape name
 */
export function getShapeId(shapeName) {
  return PARTICLE_SHAPES[shapeName]?.id ?? PARTICLE_SHAPES.sphere.id;
}

/**
 * Get render mode ID from mode name
 */
export function getRenderModeId(modeName) {
  return RENDER_MODES[modeName]?.id ?? RENDER_MODES.solid.id;
}

/**
 * Get shape name from ID
 */
export function getShapeName(shapeId) {
  for (const [name, shape] of Object.entries(PARTICLE_SHAPES)) {
    if (shape.id === shapeId) return name;
  }
  return "sphere";
}

/**
 * Get render mode name from ID
 */
export function getRenderModeName(modeId) {
  for (const [name, mode] of Object.entries(RENDER_MODES)) {
    if (mode.id === modeId) return name;
  }
  return "solid";
}

// ============================================================================
// SERIALIZATION
// ============================================================================

/**
 * Serialize emitter config to JSON-safe object
 */
export function serializeEmitterConfig(config) {
  const result = {};
  for (const [key, fieldSchema] of Object.entries(EMITTER_CONFIG_SCHEMA)) {
    if (config[key] !== undefined) {
      result[key] = Array.isArray(config[key]) ? [...config[key]] : config[key];
    }
  }
  return result;
}

/**
 * Deserialize emitter config from JSON
 */
export function deserializeEmitterConfig(json) {
  const { valid, errors, config } = validateEmitterConfig(json);
  if (!valid) {
    console.warn("Emitter config validation errors:", errors);
  }
  return config;
}

/**
 * Serialize particle snapshot to JSON-safe object
 */
export function serializeSnapshot(snapshot) {
  return {
    time: snapshot.time,
    frameIndex: snapshot.frameIndex,
    particleCount: snapshot.particleCount,
    emitters: snapshot.emitters.map(e => ({
      id: e.id,
      entityId: e.entityId,
      position: [...e.position],
      particleCount: e.particleCount,
      spawnAccumulator: e.spawnAccumulator,
      config: serializeEmitterConfig(e.config),
    })),
    bufferOffset: snapshot.bufferOffset,
    isKeyframe: snapshot.isKeyframe,
  };
}

/**
 * Deserialize particle snapshot from JSON
 */
export function deserializeSnapshot(json) {
  return {
    time: json.time,
    frameIndex: json.frameIndex,
    particleCount: json.particleCount,
    emitters: json.emitters.map(e => ({
      id: e.id,
      entityId: e.entityId,
      position: [...e.position],
      particleCount: e.particleCount,
      spawnAccumulator: e.spawnAccumulator,
      config: deserializeEmitterConfig(e.config),
    })),
    bufferOffset: json.bufferOffset,
    isKeyframe: json.isKeyframe,
  };
}
