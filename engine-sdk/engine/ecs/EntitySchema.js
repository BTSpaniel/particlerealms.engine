// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * EntitySchema.js - Unified JSON Schema for ECS Components
 * 
 * Defines consistent data structures for all entity components:
 * - Transform, PhysicsBody, Collider
 * - Renderable, Light, Camera
 * - ParticleEmitter, NavAgent
 * - Snapshot formats for rewind
 * 
 * All ECS code should use these schemas for consistency.
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Common field types used across components
 */
export const FIELD_TYPES = {
  vec2: { size: 2, normalize: normalizeVec2 },
  vec3: { size: 3, normalize: normalizeVec3 },
  vec4: { size: 4, normalize: normalizeVec4 },
  quat: { size: 4, normalize: normalizeQuat },
  number: { normalize: normalizeNumber },
  boolean: { normalize: normalizeBoolean },
  string: { normalize: normalizeString },
  enum: { normalize: normalizeEnum },
};

// ============================================================================
// NORMALIZATION HELPERS
// ============================================================================

function normalizeVec2(input, defaultValue) {
  const base = Array.isArray(input) ? input : defaultValue;
  const x = Number(base[0]);
  const y = Number(base[1]);
  return [
    Number.isFinite(x) ? x : defaultValue[0],
    Number.isFinite(y) ? y : defaultValue[1],
  ];
}

function normalizeVec3(input, defaultValue) {
  const base = Array.isArray(input) ? input : defaultValue;
  const x = Number(base[0]);
  const y = Number(base[1]);
  const z = Number(base[2]);
  return [
    Number.isFinite(x) ? x : defaultValue[0],
    Number.isFinite(y) ? y : defaultValue[1],
    Number.isFinite(z) ? z : defaultValue[2],
  ];
}

function normalizeVec4(input, defaultValue) {
  const base = Array.isArray(input) ? input : defaultValue;
  const r = Number(base[0]);
  const g = Number(base[1]);
  const b = Number(base[2]);
  const a = Number(base[3]);
  return [
    Number.isFinite(r) ? r : defaultValue[0],
    Number.isFinite(g) ? g : defaultValue[1],
    Number.isFinite(b) ? b : defaultValue[2],
    Number.isFinite(a) ? a : defaultValue[3],
  ];
}

function normalizeQuat(input, defaultValue) {
  const base = Array.isArray(input) ? input : defaultValue;
  const x = Number(base[0]);
  const y = Number(base[1]);
  const z = Number(base[2]);
  const w = Number(base[3]);
  const q = [
    Number.isFinite(x) ? x : defaultValue[0],
    Number.isFinite(y) ? y : defaultValue[1],
    Number.isFinite(z) ? z : defaultValue[2],
    Number.isFinite(w) ? w : defaultValue[3],
  ];
  const lenSq = q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3];
  if (!Number.isFinite(lenSq) || lenSq === 0) {
    return defaultValue.slice();
  }
  const invLen = 1 / Math.sqrt(lenSq);
  return [q[0] * invLen, q[1] * invLen, q[2] * invLen, q[3] * invLen];
}

function normalizeNumber(value, defaultValue, constraints = {}) {
  // Handle null/undefined - return default (important for Infinity defaults from JSON)
  if (value === null || value === undefined) return defaultValue;
  
  // Handle string representations of special values from JSON serialization
  if (value === "Infinity") return Infinity;
  if (value === "-Infinity") return -Infinity;
  if (value === "NaN") return defaultValue; // NaN should use default, not propagate
  
  const n = Number(value);
  
  // NaN check (NaN !== NaN is true) - use default instead of propagating NaN
  if (n !== n) return defaultValue;
  
  // Allow Infinity if that's what the value already is (not from string)
  if (!Number.isFinite(n) && n !== Infinity && n !== -Infinity) return defaultValue;
  
  if (constraints.min !== undefined && n < constraints.min) return constraints.min;
  if (constraints.max !== undefined && n > constraints.max) return constraints.max;
  if (constraints.positive && n <= 0) return defaultValue;
  if (constraints.nonNegative && n < 0) return defaultValue;
  return n;
}

function normalizeBoolean(value, defaultValue) {
  return typeof value === "boolean" ? value : defaultValue;
}

function normalizeString(value, defaultValue) {
  return typeof value === "string" ? value : defaultValue;
}

function normalizeEnum(value, enumValues, defaultValue) {
  return enumValues.includes(value) ? value : defaultValue;
}

function normalizeArray(value, defaultValue) {
  // Preserve the array as-is if it's valid, otherwise use default
  if (Array.isArray(value)) {
    return value;
  }
  return defaultValue ? [...defaultValue] : [];
}

function normalizeAny(value, defaultValue) {
  // Use nullish coalescing to preserve null values but use default for undefined
  return value !== undefined ? value : defaultValue;
}

/**
 * Normalize vec3 that allows null values (for optional position fields)
 */
function normalizeVec3Nullable(value, defaultValue) {
  // If value is explicitly null or undefined and default is null, return null
  if ((value === null || value === undefined) && defaultValue === null) {
    return null;
  }
  // If value is a valid array, normalize it
  if (Array.isArray(value) && value.length >= 3) {
    return normalizeVec3(value, [0, 0, 0]);
  }
  // Otherwise return default (which could be null or an array)
  return defaultValue;
}

// Export normalizers for use by component files
export {
  normalizeVec2,
  normalizeVec3,
  normalizeVec3Nullable,
  normalizeVec4,
  normalizeQuat,
  normalizeNumber,
  normalizeBoolean,
  normalizeString,
  normalizeEnum,
  normalizeArray,
  normalizeAny,
};

/**
 * Normalize a single field value based on its type definition
 */
export function normalizeField(fieldDef, value) {
  const defaultValue = fieldDef.default;
  
  switch (fieldDef.type) {
    case "vec2":
      return normalizeVec2(value, defaultValue);
    case "vec3":
      // Use nullable normalizer for vec3 fields with null default
      if (defaultValue === null) {
        return normalizeVec3Nullable(value, defaultValue);
      }
      return normalizeVec3(value, defaultValue);
    case "vec4":
      // Check array length for color fields
      if (Array.isArray(value) && value.length >= 4) {
        return normalizeVec4(value, defaultValue);
      }
      return Array.isArray(value) && value.length >= 3 
        ? [...value.slice(0, 3), value[3] ?? defaultValue[3]] 
        : (defaultValue ? [...defaultValue] : [1, 1, 1, 1]);
    case "quat":
      return normalizeQuat(value, defaultValue);
    case "number":
      return normalizeNumber(value, defaultValue, fieldDef);
    case "boolean":
      return normalizeBoolean(value, defaultValue);
    case "string":
      return normalizeString(value, defaultValue);
    case "enum":
      return normalizeEnum(value, fieldDef.enum, defaultValue);
    case "array":
      return normalizeArray(value, defaultValue);
    case "any":
      return normalizeAny(value, defaultValue);
    default:
      return value !== undefined ? value : defaultValue;
  }
}

/**
 * Normalize a component value using its schema definition
 * This is the primary function component files should use
 */
export function normalizeBySchema(schema, value) {
  if (!schema?.fields) return value;
  const src = value && typeof value === "object" ? value : {};
  const result = {};
  
  for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
    result[fieldName] = normalizeField(fieldDef, src[fieldName]);
  }
  
  return result;
}

/**
 * Get default values from a schema
 */
export function getSchemaDefaults(schema) {
  if (!schema?.fields) return {};
  const defaults = {};
  for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
    const def = fieldDef.default;
    defaults[fieldName] = Array.isArray(def) ? [...def] : def;
  }
  return defaults;
}

// ============================================================================
// COMPONENT SCHEMAS
// ============================================================================

/**
 * Transform component schema
 */
export const TRANSFORM_SCHEMA = {
  name: "Transform",
  version: 1,
  runtime: ["_worldMatrix", "_dirty"],
  fields: {
    position: { type: "vec3", default: [0, 0, 0], desc: "World position" },
    rotation: { type: "quat", default: [0, 0, 0, 1], desc: "Rotation quaternion (x,y,z,w)" },
    scale: { type: "vec3", default: [1, 1, 1], desc: "Scale factors" },
  },
};

/**
 * PhysicsBody component schema
 */
export const PHYSICS_BODY_SCHEMA = {
  name: "PhysicsBody",
  version: 1,
  runtime: ["bodyHandle", "_actor", "_rigidBody", "_shape"],
  fields: {
    bodyHandle: { type: "any", default: null, desc: "Physics engine body handle" },
    linearVelocity: { type: "vec3", default: [0, 0, 0], desc: "Linear velocity" },
    angularVelocity: { type: "vec3", default: [0, 0, 0], desc: "Angular velocity" },
    simMode: { type: "enum", enum: ["dynamic", "kinematic", "static"], default: "dynamic", desc: "Simulation mode" },
    mass: { type: "number", default: null, positive: true, desc: "Body mass (kg)" },
    density: { type: "number", default: null, positive: true, desc: "Material density" },
    linearDamping: { type: "number", default: null, nonNegative: true, desc: "Linear damping" },
    angularDamping: { type: "number", default: null, nonNegative: true, desc: "Angular damping" },
    centerOfMass: { type: "vec3", default: [0, 0, 0], desc: "Center of mass offset" },
  },
};

/**
 * Collider shapes
 */
export const COLLIDER_SHAPES = {
  box: { id: 0, label: "Box", desc: "Axis-aligned box" },
  sphere: { id: 1, label: "Sphere", desc: "Sphere collider" },
  capsule: { id: 2, label: "Capsule", desc: "Capsule collider" },
  convexMesh: { id: 3, label: "Convex Mesh", desc: "Convex hull" },
  triangleMesh: { id: 4, label: "Triangle Mesh", desc: "Concave mesh" },
  cylinder: { id: 5, label: "Cylinder", desc: "Cylinder collider" },
};

/**
 * Collider component schema
 */
export const COLLIDER_SCHEMA = {
  name: "Collider",
  version: 1,
  runtime: ["_shape", "_actor", "_geometry"],
  fields: {
    shape: { type: "enum", enum: Object.keys(COLLIDER_SHAPES), default: "box", desc: "Collision shape type" },
    halfExtents: { type: "vec3", default: [0.5, 0.5, 0.5], desc: "Box half extents" },
    radius: { type: "number", default: 0.5, positive: true, desc: "Sphere/capsule radius" },
    halfHeight: { type: "number", default: 0.5, positive: true, desc: "Capsule half height" },
    isTrigger: { type: "boolean", default: false, desc: "Is trigger (no physics response)" },
    meshId: { type: "string", default: null, desc: "Mesh ID for mesh colliders" },
    localOffset: { type: "vec3", default: [0, 0, 0], desc: "Collider center offset from entity origin" },
    compoundColliders: { type: "array", default: [], desc: "Local child collider descriptors" },
  },
};

/**
 * Light types
 */
export const LIGHT_TYPES = {
  point: { id: 0, label: "Point", desc: "Omnidirectional light" },
  directional: { id: 1, label: "Directional", desc: "Sun/moon light" },
  spot: { id: 2, label: "Spot", desc: "Cone-shaped light" },
};

/**
 * Light component schema
 */
export const LIGHT_SCHEMA = {
  name: "Light",
  version: 1,
  runtime: ["_shadowMap", "_lightIndex"],
  fields: {
    type: { type: "enum", enum: Object.keys(LIGHT_TYPES), default: "point", desc: "Light type" },
    intensity: { type: "number", default: 1.5, nonNegative: true, desc: "Light intensity" },
    color: { type: "vec3", default: [1, 1, 1], desc: "Light color RGB" },
    range: { type: "number", default: 10, nonNegative: true, desc: "Light range/radius (point/spot)" },
    direction: { type: "vec3", default: [0, -1, 0], desc: "Light direction (directional/spot)" },
    innerConeAngle: { type: "number", default: 0.3, nonNegative: true, desc: "Spot inner cone (radians)" },
    outerConeAngle: { type: "number", default: 0.5, nonNegative: true, desc: "Spot outer cone (radians)" },
  },
};

/**
 * Camera projection types
 */
export const CAMERA_PROJECTIONS = {
  perspective: { id: 0, label: "Perspective", desc: "Standard 3D perspective" },
  orthographic: { id: 1, label: "Orthographic", desc: "2D/isometric view" },
};

/**
 * Camera modes
 */
export const CAMERA_MODES = {
  free: { id: 0, label: "Free", desc: "Free-flying camera" },
  fps: { id: 1, label: "FPS", desc: "First-person shooter" },
  thirdPerson: { id: 2, label: "Third Person", desc: "Over-the-shoulder" },
  orbital: { id: 3, label: "Orbital", desc: "Orbit around target" },
  fixed: { id: 4, label: "Fixed", desc: "Static camera" },
};

/**
 * Camera component schema
 */
export const CAMERA_SCHEMA = {
  name: "Camera",
  version: 1,
  runtime: ["_projectionMatrix", "_viewMatrix"],
  fields: {
    fov: { type: "number", default: 60, min: 1, max: 179, desc: "Field of view (degrees)" },
    near: { type: "number", default: 0.1, positive: true, desc: "Near clip plane" },
    far: { type: "number", default: 1000, positive: true, desc: "Far clip plane" },
    active: { type: "boolean", default: true, desc: "Is active camera" },
    projection: { type: "enum", enum: Object.keys(CAMERA_PROJECTIONS), default: "perspective", desc: "Projection type" },
    aspect: { type: "number", default: null, positive: true, desc: "Aspect ratio (null=auto)" },
    exposure: { type: "number", default: 1.0, positive: true, desc: "Exposure value" },
    mode: { type: "string", default: "free", desc: "Camera control mode" },
    targetEntity: { type: "any", default: null, desc: "Target entity ID for tracking" },
  },
};

/**
 * Renderable component schema
 */
export const RENDERABLE_SCHEMA = {
  name: "Renderable",
  version: 1,
  runtime: ["_mesh", "_material", "_gpuBuffers", "visible", "_isWeldRoot", "_isWeldChild", "_originalMeshId"],
  fields: {
    meshId: { type: "any", default: null, desc: "Mesh asset ID" },
    materialId: { type: "any", default: null, desc: "Material asset ID" },
    layer: { type: "number", default: 0, desc: "Render layer" },
    visible: { type: "boolean", default: true, desc: "Is visible" },
    layerMask: { type: "number", default: 0xffffffff, desc: "Layer visibility mask" },
    castShadow: { type: "boolean", default: true, desc: "Casts shadows" },
    receiveShadow: { type: "boolean", default: true, desc: "Receives shadows" },
    tintColor: { type: "vec4", default: [1, 1, 1, 1], desc: "Color tint RGBA" },
  },
};

/**
 * Emitter shapes for particle spawning
 */
export const EMITTER_SHAPES = {
  point: { id: 0, label: "Point", desc: "Single point" },
  sphere: { id: 1, label: "Sphere", desc: "Spherical volume" },
  box: { id: 2, label: "Box", desc: "Box volume" },
  cone: { id: 3, label: "Cone", desc: "Cone direction" },
  mesh: { id: 4, label: "Mesh", desc: "Mesh surface" },
};

/**
 * ParticleEmitter component schema
 */
export const PARTICLE_EMITTER_SCHEMA = {
  name: "ParticleEmitter",
  version: 1,
  runtime: ["_handle", "_particles", "_lastSpawnTime"],
  fields: {
    enabled: { type: "boolean", default: true, desc: "Emitter active" },
    maxParticles: { type: "number", default: 1000000, nonNegative: true, desc: "Max particle count" },
    rate: { type: "number", default: 100, nonNegative: true, desc: "Particles per second" },
    burstCount: { type: "number", default: 0, nonNegative: true, desc: "Burst emit count" },
    lifetime: { type: "number", default: 5, nonNegative: true, desc: "Particle lifetime (s)" },
    lifetimeRandomness: { type: "number", default: 0, nonNegative: true, desc: "Lifetime variance" },
    shape: { type: "enum", enum: Object.keys(EMITTER_SHAPES), default: "point", desc: "Spawn shape" },
    shapeRadius: { type: "number", default: 1, nonNegative: true, desc: "Shape radius" },
    shapeBoxExtents: { type: "vec3", default: [1, 1, 1], desc: "Box extents" },
    direction: { type: "vec3", default: [0, 1, 0], desc: "Emit direction" },
    spreadAngle: { type: "number", default: Math.PI * 0.5, nonNegative: true, desc: "Spread angle (radians)" },
    speed: { type: "number", default: 5, desc: "Initial speed" },
    speedRandomness: { type: "number", default: 0, nonNegative: true, desc: "Speed variance" },
    gravity: { type: "vec3", default: [0, -9.81, 0], desc: "Gravity acceleration" },
    colorStart: { type: "vec4", default: [1, 1, 1, 1], desc: "Start color RGBA" },
    colorEnd: { type: "vec4", default: [1, 1, 1, 0], desc: "End color RGBA" },
    sizeStart: { type: "number", default: 1, desc: "Start size" },
    sizeEnd: { type: "number", default: 1, desc: "End size" },
    looping: { type: "boolean", default: true, desc: "Loop emission" },
    // Physics properties
    mass: { type: "number", default: 1.0, positive: true, desc: "Particle mass" },
    drag: { type: "number", default: 0.02, min: 0, max: 1, desc: "Air resistance" },
    bounciness: { type: "number", default: 0.3, min: 0, max: 1, desc: "Restitution" },
    collisionEnabled: { type: "boolean", default: true, desc: "Particles collide with world" },
    inheritVelocity: { type: "number", default: 0.0, min: 0, max: 1, desc: "Velocity inheritance" },
    // Custom SDF Effect properties
    useCustomEffect: { type: "boolean", default: false, desc: "Use custom SDF effect for visual & collision" },
    effectId: { type: "string", default: "sphere", desc: "ID of custom particle effect preset" },
    effectParams: { type: "vec4", default: [0, 0, 0, 0], desc: "Custom effect parameters" },
  },
};

/**
 * NavAgent component schema
 */
export const NAV_AGENT_SCHEMA = {
  name: "NavAgent",
  version: 1,
  runtime: ["_agent", "_path", "_currentWaypoint"],
  fields: {
    layer: { type: "string", default: "ground", desc: "Navigation layer" },
    speed: { type: "number", default: 3, positive: true, desc: "Movement speed" },
    stoppingDistance: { type: "number", default: 0.25, nonNegative: true, desc: "Stop distance" },
    destination: { type: "vec3", default: [0, 0, 0], desc: "Target position" },
    hasDestination: { type: "boolean", default: false, desc: "Has active destination" },
  },
};

/**
 * Chain physics backends
 */
export const CHAIN_BACKENDS = {
  gpu: { id: 0, label: "GPU", desc: "WebGPU compute shader" },
  pbd: { id: 1, label: "PBD", desc: "CPU position-based dynamics" },
  physx: { id: 2, label: "PhysX", desc: "WASM PhysX articulation" },
};
/** @deprecated Use CHAIN_BACKENDS */
export const ROPE_BACKENDS = CHAIN_BACKENDS;

/**
 * PhysicsChain component schema (unified: particle chains + rigid chains)
 * 
 * mode: "particle" = PBD/GPU/PhysX particle chain (formerly PhysicsRope)
 * mode: "rigid"    = rigid linked chain (formerly PhysicsChain)
 */
export const PHYSICS_CHAIN_SCHEMA = {
  name: "PhysicsChain",
  version: 2,
  runtime: ["_solver", "_particles", "_articulation"],
  fields: {
    // Chain mode
    mode: { type: "enum", enum: ["particle", "rigid"], default: "particle", desc: "Chain simulation mode" },
    particles: { type: "array", default: [], desc: "Particle positions [{x,y,z}]" },
    length: { type: "number", default: 2.0, positive: true, desc: "Chain length" },
    segments: { type: "number", default: 50, min: 2, desc: "Number of segments" },
    radius: { type: "number", default: 0.01, positive: true, desc: "Chain radius" },
    stiffness: { type: "number", default: 0.85, min: 0, max: 1, desc: "Constraint stiffness" },
    damping: { type: "number", default: 0.95, min: 0, max: 1, desc: "Velocity damping" },
    gravity: { type: "number", default: -9.8, desc: "Gravity acceleration" },
    fixStart: { type: "boolean", default: true, desc: "Fix start point" },
    fixEnd: { type: "boolean", default: false, desc: "Fix end point" },
    color: { type: "vec4", default: [0.6, 0.4, 0.2, 1], desc: "Chain color RGBA" },
    startEntityId: { type: "any", default: null, desc: "Attached start entity" },
    endEntityId: { type: "any", default: null, desc: "Attached end entity" },
    endPosition: { type: "vec3", default: null, desc: "End position if no entity" },
    startAnchorWorldPos: { type: "vec3", default: null, desc: "Start anchor world position" },
    endAnchorWorldPos: { type: "vec3", default: null, desc: "End anchor world position" },
    startAnchorLocalOffset: { type: "vec3", default: null, desc: "Start local offset" },
    endAnchorLocalOffset: { type: "vec3", default: null, desc: "End local offset" },
    backend: { type: "enum", enum: Object.keys(CHAIN_BACKENDS), default: "gpu", desc: "Physics backend" },
    // Chain constraint physics
    chainStrength: { type: "number", default: Infinity, desc: "Max tension before breaking" },
    chainStiffness: { type: "number", default: 1.0, min: 0, max: 1, desc: "Length enforcement" },
    enableTwoWayCoupling: { type: "boolean", default: true, desc: "Apply forces to attached bodies" },
    tensionStiffness: { type: "number", default: 50.0, nonNegative: true, desc: "Soft coupling force" },
    isBroken: { type: "boolean", default: false, desc: "Chain is broken" },
    // Contact properties
    contactRadius: { type: "number", default: 0.001, positive: true, desc: "Contact detection radius" },
    contactStiffness: { type: "number", default: 5e4, positive: true, desc: "Contact stiffness" },
    friction: { type: "number", default: 0.4, nonNegative: true, desc: "Friction coefficient" },
    selfCollision: { type: "boolean", default: true, desc: "Enable self-collision" },
    collideWithVoxels: { type: "boolean", default: true, desc: "Collide with voxel terrain" },
    // Solver properties
    positionIterations: { type: "number", default: 16, min: 1, desc: "Position solver iterations" },
    velocityIterations: { type: "number", default: 4, min: 1, desc: "Velocity solver iterations" },
    density: { type: "number", default: 1.0, positive: true, desc: "Mass density" },
    scale: { type: "number", default: 1.0, positive: true, desc: "Scale multiplier" },
    // Multi-thread twisted chain properties (set threadCount > 1 for realistic fibers)
    threadCount: { type: "number", default: 1, min: 1, max: 12, desc: "Number of threads (1=single strand, 2+=twisted)" },
    threadRadius: { type: "number", default: 0.002, positive: true, desc: "Individual thread radius when twisted" },
    twistRate: { type: "number", default: 2.0, desc: "Twists per meter of chain length" },
    twistDirection: { type: "enum", enum: ["clockwise", "counterclockwise"], default: "clockwise", desc: "Twist direction" },
    bundleRadius: { type: "number", default: 0.01, positive: true, desc: "Overall bundle radius when twisted" },
    bindingStiffness: { type: "number", default: 0.95, min: 0, max: 1, desc: "Inter-thread binding constraint stiffness" },
    diagonalStiffness: { type: "number", default: 0.8, min: 0, max: 1, desc: "Diagonal shear constraint stiffness" },
    plyDirection: { type: "enum", enum: ["balanced", "s-ply", "z-ply"], default: "balanced", desc: "Ply direction for stability" },
    // Fiber material and shading
    fiberMaterial: { type: "enum", enum: ["cotton", "wool", "silk", "nylon", "hemp", "steel"], default: "hemp", desc: "Fiber material type" },
    materialPreset: { type: "enum", enum: ["chain", "rubber", "slime", "water", "honey", "cloth", "rope", "web", "balloon", "mud"], default: "chain", desc: "Material preset" },
    anisotropy: { type: "number", default: 0.5, min: 0, max: 1, desc: "Fiber anisotropic specular strength" },
    sheenStrength: { type: "number", default: 0.3, min: 0, max: 1, desc: "Fuzz/backlight sheen intensity" },
    roughness: { type: "number", default: 0.6, min: 0, max: 1, desc: "Surface roughness" },
    // Color blending (marled/heathered yarn)
    enableColorBlend: { type: "boolean", default: false, desc: "Enable two-color marled blending" },
    secondaryColor: { type: "vec4", default: [0.9, 0.85, 0.8, 1], desc: "Secondary blend color RGBA" },
    blendRatio: { type: "number", default: 0.5, min: 0, max: 1, desc: "Primary/secondary color ratio" },
    blendNoiseScale: { type: "number", default: 5.0, min: 1, max: 20, desc: "Noise frequency for color variation" },
    blendFollowsTwist: { type: "boolean", default: true, desc: "Color pattern follows twist direction" },
    // Procedural styling
    enableFraying: { type: "boolean", default: false, desc: "Enable frayed/flyaway fibers" },
    frayingAmount: { type: "number", default: 0.2, min: 0, max: 1, desc: "Density of frayed fibers" },
    frayingLength: { type: "number", default: 0.015, positive: true, desc: "Max length of frayed fibers" },
    // Advanced effects
    enableBending: { type: "boolean", default: false, desc: "Enable bending constraints" },
    bendingStiffness: { type: "number", default: 0.3, min: 0, max: 1, desc: "Bending constraint stiffness" },
    enableSprings: { type: "boolean", default: false, desc: "Use spring constraints" },
    springStiffness: { type: "number", default: 0.5, min: 0, max: 1, desc: "Spring stiffness" },
    // Surface interaction
    sticky: { type: "boolean", default: false, desc: "Adheres to surfaces" },
    adhesionStrength: { type: "number", default: 1.0, nonNegative: true, desc: "Adhesion force multiplier" },
    cohesive: { type: "boolean", default: false, desc: "Particles attract each other" },
    cohesionRadius: { type: "number", default: 0.5, positive: true, desc: "Cohesion interaction radius" },
    restitution: { type: "number", default: 0.1, min: 0, max: 1, desc: "Bounce coefficient" },
    // Rigid chain link properties (mode: "rigid" only)
    linkCount: { type: "number", default: 10, min: 1, desc: "Number of rigid chain links" },
    linkLength: { type: "number", default: 0.2, positive: true, desc: "Length of each rigid link" },
    linkGap: { type: "number", default: 0.05, nonNegative: true, desc: "Gap between rigid links" },
    linkRadius: { type: "number", default: 0.05, positive: true, desc: "Radius of rigid link wire" },
    links: { type: "array", default: [], desc: "Rigid link state data" },
  },
};
/** @deprecated Use PHYSICS_CHAIN_SCHEMA */
export const PHYSICS_ROPE_SCHEMA = PHYSICS_CHAIN_SCHEMA;

/** @deprecated Use PhysicsChain with threadCount > 1 instead */
export const TWISTED_ROPE_SCHEMA = PHYSICS_CHAIN_SCHEMA;

// ============================================================================
// WELD CONSTRAINT SCHEMA
// ============================================================================

/**
 * Weld constraint types
 */
export const WELD_TYPES = {
  shapeTransfer: { id: 0, label: "Shape Transfer", desc: "Shapes merged into parent body" },
  fixedJoint: { id: 1, label: "Fixed Joint", desc: "PhysX fixed joint constraint" },
  distanceJoint: { id: 2, label: "Distance Joint", desc: "Maintains distance between bodies" },
};

/**
 * WeldConstraint component schema - Defines a physics weld between two entities
 * Welds merge collision shapes from child into parent, creating compound bodies.
 * 
 * When saved: stores entity IDs and offset
 * When loaded: recreates weld during physics init
 */
export const WELD_CONSTRAINT_SCHEMA = {
  name: "WeldConstraint",
  version: 1,
  runtime: ["_joint", "_parentBody", "_childBody", "_shapesTransferred"],
  fields: {
    // Entity references
    parentEntityId: { type: "number", default: null, required: true, desc: "Parent entity ID (receives shapes)" },
    childEntityId: { type: "number", default: null, required: true, desc: "Child entity ID (shapes transferred from)" },
    
    // Weld configuration
    weldType: { type: "enum", enum: Object.keys(WELD_TYPES), default: "shapeTransfer", desc: "Type of weld constraint" },
    
    // Relative transform (child relative to parent at time of weld)
    offset: { type: "vec3", default: [0, 0, 0], desc: "Child offset from parent center" },
    relativeRotation: { type: "vec4", default: [0, 0, 0, 1], desc: "Child rotation relative to parent (quaternion)" },
    
    // Breakable constraints
    breakable: { type: "boolean", default: false, desc: "Can this weld break under force" },
    breakForce: { type: "number", default: 0, nonNegative: true, desc: "Force to break weld (0 = unbreakable)" },
    breakTorque: { type: "number", default: 0, nonNegative: true, desc: "Torque to break weld (0 = unbreakable)" },
    
    // State
    isBroken: { type: "boolean", default: false, desc: "Weld has been broken" },
    shapesTransferred: { type: "number", default: 0, nonNegative: true, desc: "Number of shapes transferred" },
    createdAt: { type: "number", default: 0, desc: "Timestamp when weld was created" },
  },
};

// ============================================================================
// ENTITY FLAGS SCHEMA
// ============================================================================

/**
 * Collision modes - determines how physics engine handles collisions
 * Maps to PhysX PxPairFlags and shape flags
 */
export const COLLISION_MODES = {
  solid: { id: 0, label: "Solid", desc: "Full collision detection and response (eSOLVE_CONTACT + eDETECT)" },
  trigger: { id: 1, label: "Trigger", desc: "Detect overlaps but no physics response (events only)" },
  queryOnly: { id: 2, label: "Query Only", desc: "Raycasts/sweeps only, no simulation (eSCENE_QUERY_SHAPE)" },
  noPush: { id: 3, label: "No Push", desc: "Detect contacts but don't apply forces (eDETECT only)" },
  noCollision: { id: 4, label: "No Collision", desc: "Ignore all collision (disabled shape)" },
  ghost: { id: 5, label: "Ghost", desc: "Pass through everything, events only" },
};

/**
 * Predefined collision layers (bitmask)
 * Each entity belongs to one layer (collisionLayer) and can collide with multiple layers (collisionMask)
 */
export const COLLISION_LAYERS = {
  default: { bit: 0, mask: 0x0001, label: "Default" },
  static: { bit: 1, mask: 0x0002, label: "Static" },
  dynamic: { bit: 2, mask: 0x0004, label: "Dynamic" },
  kinematic: { bit: 3, mask: 0x0008, label: "Kinematic" },
  trigger: { bit: 4, mask: 0x0010, label: "Trigger" },
  character: { bit: 5, mask: 0x0020, label: "Character" },
  projectile: { bit: 6, mask: 0x0040, label: "Projectile" },
  debris: { bit: 7, mask: 0x0080, label: "Debris" },
  ragdoll: { bit: 8, mask: 0x0100, label: "Ragdoll" },
  vehicle: { bit: 9, mask: 0x0200, label: "Vehicle" },
  water: { bit: 10, mask: 0x0400, label: "Water" },
  terrain: { bit: 11, mask: 0x0800, label: "Terrain" },
  particle: { bit: 12, mask: 0x1000, label: "Particle" },
  chain: { bit: 13, mask: 0x2000, label: "Chain" },
  sensor: { bit: 14, mask: 0x4000, label: "Sensor" },
  custom: { bit: 15, mask: 0x8000, label: "Custom" },
};

/**
 * EntityFlags component schema - Unified flags for collision, visibility, and editor behavior
 * 
 * This component centralizes all entity interaction flags:
 * - Collision: layer/mask filtering, collision mode (solid/trigger/noPush/ghost)
 * - Visibility: render visibility, layer masks, editor-only visibility
 * - Editor: pickable, selectable, locked, hidden in hierarchy
 * - Physics: weldable, pushable, sleepable
 * 
 * PhysX Integration:
 * - collisionLayer → PxFilterData.word0
 * - collisionMask → PxFilterData.word1  
 * - collisionMode → PxPairFlags (eSOLVE_CONTACT, eDETECT_DISCRETE_CONTACT, etc.)
 */
export const ENTITY_FLAGS_SCHEMA = {
  name: "EntityFlags",
  version: 1,
  runtime: ["_filterDataDirty"],
  fields: {
    // ========== COLLISION FLAGS ==========
    collisionLayer: { type: "number", default: 0x0001, desc: "Collision layer bitmask (which layer this entity belongs to)" },
    collisionMask: { type: "number", default: 0xFFFF, desc: "Collision mask (which layers this entity collides with)" },
    collisionMode: { type: "enum", enum: Object.keys(COLLISION_MODES), default: "solid", desc: "How collisions are handled" },
    
    // ========== VISIBILITY FLAGS ==========
    visible: { type: "boolean", default: true, desc: "Is entity visible in game" },
    renderLayer: { type: "number", default: 0, desc: "Render layer (for camera culling)" },
    renderMask: { type: "number", default: 0xFFFFFFFF, desc: "Render layer mask" },
    castShadow: { type: "boolean", default: true, desc: "Casts shadows" },
    receiveShadow: { type: "boolean", default: true, desc: "Receives shadows" },
    
    // ========== EDITOR FLAGS ==========
    editorVisible: { type: "boolean", default: true, desc: "Visible in editor (can be hidden but still in game)" },
    pickable: { type: "boolean", default: true, desc: "Can be selected by clicking in editor" },
    selectable: { type: "boolean", default: true, desc: "Can be added to selection" },
    locked: { type: "boolean", default: false, desc: "Cannot be moved/edited in editor" },
    hideInHierarchy: { type: "boolean", default: false, desc: "Hidden in hierarchy panel" },
    
    // ========== PHYSICS BEHAVIOR FLAGS ==========
    weldable: { type: "boolean", default: true, desc: "Can be welded to other bodies" },
    pushable: { type: "boolean", default: true, desc: "Can be pushed by other bodies (when false, acts like infinite mass for contacts)" },
    sleepable: { type: "boolean", default: true, desc: "Can enter sleep state when idle" },
    ccdEnabled: { type: "boolean", default: false, desc: "Continuous collision detection (fast-moving objects)" },
    
    // ========== INTERACTION FLAGS ==========
    interactable: { type: "boolean", default: false, desc: "Can be interacted with (triggers interaction events)" },
    highlightOnHover: { type: "boolean", default: false, desc: "Highlight when mouse hovers" },
    
    // ========== STATIC FLAGS (optimization) ==========
    isStatic: { type: "boolean", default: false, desc: "Marked as static (batching, lightmaps, navigation)" },
    isOccluder: { type: "boolean", default: false, desc: "Occludes objects behind it" },
    isOccludee: { type: "boolean", default: true, desc: "Can be occluded by other objects" },
    contributeGI: { type: "boolean", default: true, desc: "Contributes to global illumination" },
  },
};

/**
 * Helper: Get collision layer mask from layer names
 */
export function getCollisionMask(...layerNames) {
  let mask = 0;
  for (const name of layerNames) {
    const layer = COLLISION_LAYERS[name];
    if (layer) mask |= layer.mask;
  }
  return mask;
}

/**
 * Helper: Check if two layer masks collide
 */
export function layersCollide(layerA, maskA, layerB, maskB) {
  return (layerA & maskB) !== 0 && (layerB & maskA) !== 0;
}

/**
 * Helper: Get collision mode flags for PhysX
 * Returns { pairFlags, shapeFlags } for PhysX configuration
 */
export function getPhysXFlagsForCollisionMode(mode) {
  // PxPairFlagEnum values (from PhysX). These are bit POSITIONS in the enum
  // declared by physx-pe.d.ts, so the values follow from its ordering:
  // eSOLVE_CONTACT is index 0, eNOTIFY_CONTACT_POINTS index 9,
  // eDETECT_DISCRETE_CONTACT index 10 and eDETECT_CCD_CONTACT index 11.
  //
  // DETECT_DISCRETE_CONTACT and DETECT_CCD_CONTACT were previously 512 and 1024,
  // i.e. each one bit position too low. 512 is actually eNOTIFY_CONTACT_POINTS, so
  // 'solid' produced SOLVE_CONTACT | NOTIFY_CONTACT_POINTS | NOTIFY_TOUCH_FOUND and
  // requested NO discrete contact detection whatsoever: any body that received
  // these flags fell straight through geometry it should have rested on.
  // PhysXPhysicsWorld already used the correct 2048 for CCD, so the two disagreed.
  const SOLVE_CONTACT = 1 << 0;
  const DETECT_DISCRETE_CONTACT = 1 << 10;
  const DETECT_CCD_CONTACT = 1 << 11;
  const NOTIFY_TOUCH_FOUND = 1 << 2;
  const NOTIFY_TOUCH_LOST = 1 << 4;
  const TRIGGER_DEFAULT = NOTIFY_TOUCH_FOUND | NOTIFY_TOUCH_LOST;
  
  // PxShapeFlagEnum values
  const SIMULATION_SHAPE = 1;
  const SCENE_QUERY_SHAPE = 2;
  const TRIGGER_SHAPE = 4;
  const VISUALIZATION = 8;
  
  switch (mode) {
    case 'solid':
      return {
        pairFlags: SOLVE_CONTACT | DETECT_DISCRETE_CONTACT | NOTIFY_TOUCH_FOUND,
        shapeFlags: SIMULATION_SHAPE | SCENE_QUERY_SHAPE | VISUALIZATION,
      };
    case 'trigger':
      return {
        pairFlags: TRIGGER_DEFAULT | DETECT_DISCRETE_CONTACT,
        shapeFlags: TRIGGER_SHAPE | SCENE_QUERY_SHAPE | VISUALIZATION,
      };
    case 'queryOnly':
      return {
        pairFlags: 0,
        shapeFlags: SCENE_QUERY_SHAPE | VISUALIZATION,
      };
    case 'noPush':
      return {
        pairFlags: DETECT_DISCRETE_CONTACT | NOTIFY_TOUCH_FOUND,
        shapeFlags: SIMULATION_SHAPE | SCENE_QUERY_SHAPE | VISUALIZATION,
      };
    case 'noCollision':
      return {
        pairFlags: 0,
        shapeFlags: VISUALIZATION,
      };
    case 'ghost':
      return {
        pairFlags: NOTIFY_TOUCH_FOUND | NOTIFY_TOUCH_LOST,
        shapeFlags: TRIGGER_SHAPE | VISUALIZATION,
      };
    default:
      return {
        pairFlags: SOLVE_CONTACT | DETECT_DISCRETE_CONTACT,
        shapeFlags: SIMULATION_SHAPE | SCENE_QUERY_SHAPE | VISUALIZATION,
      };
  }
}

// ============================================================================
// ALL COMPONENT SCHEMAS
// ============================================================================

export const COMPONENT_SCHEMAS = {
  Transform: TRANSFORM_SCHEMA,
  PhysicsBody: PHYSICS_BODY_SCHEMA,
  Collider: COLLIDER_SCHEMA,
  Light: LIGHT_SCHEMA,
  Camera: CAMERA_SCHEMA,
  Renderable: RENDERABLE_SCHEMA,
  ParticleEmitter: PARTICLE_EMITTER_SCHEMA,
  NavAgent: NAV_AGENT_SCHEMA,
  PhysicsChain: PHYSICS_CHAIN_SCHEMA,
  // Legacy aliases for backward compat (scene loading)
  PhysicsRope: PHYSICS_CHAIN_SCHEMA,
  TwistedRope: PHYSICS_CHAIN_SCHEMA,
  WeldConstraint: WELD_CONSTRAINT_SCHEMA,
  EntityFlags: ENTITY_FLAGS_SCHEMA,
};

/**
 * Register a custom component schema at runtime
 * Allows component files to auto-register their schemas
 */
export function registerComponentSchema(schema) {
  if (!schema?.name || !schema?.fields) {
    console.warn('registerComponentSchema: invalid schema', schema);
    return false;
  }
  if (COMPONENT_SCHEMAS[schema.name]) {
    return true;
  }
  COMPONENT_SCHEMAS[schema.name] = schema;
  return true;
}

/**
 * Get all registered component schema names
 */
export function getRegisteredSchemaNames() {
  return Object.keys(COMPONENT_SCHEMAS);
}

// ============================================================================
// ENTITY SCHEMA
// ============================================================================

/**
 * Complete entity schema (entity + components)
 */
export const ENTITY_SCHEMA = {
  id: { type: "number", required: true, desc: "Unique entity ID" },
  name: { type: "string", default: "", desc: "Display name" },
  parent: { type: "number", default: null, desc: "Parent entity ID" },
  children: { type: "array", default: [], desc: "Child entity IDs" },
  tags: { type: "array", default: [], desc: "Entity tags" },
  components: { type: "object", default: {}, desc: "Component data by name" },
};

// ============================================================================
// SNAPSHOT SCHEMAS
// ============================================================================

/**
 * Entity state snapshot (for rewind)
 */
export const ENTITY_SNAPSHOT_SCHEMA = {
  id: { type: "number", desc: "Entity ID" },
  transform: { type: "object", desc: "Transform component state" },
  physicsBody: { type: "object", desc: "PhysicsBody component state" },
};

/**
 * World snapshot schema
 */
export const WORLD_SNAPSHOT_SCHEMA = {
  time: { type: "number", required: true, desc: "Simulation time" },
  frameIndex: { type: "number", required: true, desc: "Frame number" },
  entities: { type: "Map", desc: "Map<entityId, EntitySnapshot>" },
  isKeyframe: { type: "boolean", default: false, desc: "Full snapshot vs delta" },
};

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validate and normalize a component value against its schema
 */
export function validateComponent(componentName, value) {
  const schema = COMPONENT_SCHEMAS[componentName];
  if (!schema) {
    console.warn(`Unknown component: ${componentName}`);
    return { valid: true, errors: [], value };
  }
  
  const src = value && typeof value === "object" ? value : {};
  const result = {};
  const errors = [];
  
  for (const [fieldName, fieldSchema] of Object.entries(schema.fields)) {
    // Use normalizeField which handles all edge cases correctly
    result[fieldName] = normalizeField(fieldSchema, src[fieldName]);
  }
  
  return { valid: errors.length === 0, errors, value: result };
}

/**
 * Create default component data
 */
export function createDefaultComponent(componentName) {
  const schema = COMPONENT_SCHEMAS[componentName];
  if (!schema) {
    console.warn(`Unknown component: ${componentName}`);
    return {};
  }
  
  const result = {};
  for (const [fieldName, fieldSchema] of Object.entries(schema.fields)) {
    const def = fieldSchema.default;
    result[fieldName] = Array.isArray(def) ? [...def] : def;
  }
  return result;
}

/**
 * Validate Transform component
 */
export function validateTransform(value) {
  return validateComponent("Transform", value);
}

/**
 * Validate PhysicsBody component
 */
export function validatePhysicsBody(value) {
  return validateComponent("PhysicsBody", value);
}

/**
 * Validate Collider component
 */
export function validateCollider(value) {
  return validateComponent("Collider", value);
}

/**
 * Validate Light component
 */
export function validateLight(value) {
  return validateComponent("Light", value);
}

/**
 * Validate Camera component
 */
export function validateCamera(value) {
  return validateComponent("Camera", value);
}

/**
 * Validate Renderable component
 */
export function validateRenderable(value) {
  return validateComponent("Renderable", value);
}

/**
 * Validate ParticleEmitter component
 */
export function validateParticleEmitter(value) {
  return validateComponent("ParticleEmitter", value);
}

/**
 * Validate NavAgent component
 */
export function validateNavAgent(value) {
  return validateComponent("NavAgent", value);
}

/**
 * Validate PhysicsChain component
 */
export function validatePhysicsChain(value) {
  return validateComponent("PhysicsChain", value);
}
/** @deprecated Use validatePhysicsChain */
export const validatePhysicsRope = validatePhysicsChain;

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create default Transform
 */
export function createDefaultTransform() {
  return createDefaultComponent("Transform");
}

/**
 * Create default PhysicsBody
 */
export function createDefaultPhysicsBody() {
  return createDefaultComponent("PhysicsBody");
}

/**
 * Create default Collider
 */
export function createDefaultCollider() {
  return createDefaultComponent("Collider");
}

/**
 * Create default Light
 */
export function createDefaultLight() {
  return createDefaultComponent("Light");
}

/**
 * Create default Camera
 */
export function createDefaultCamera() {
  return createDefaultComponent("Camera");
}

/**
 * Create default Renderable
 */
export function createDefaultRenderable() {
  return createDefaultComponent("Renderable");
}

/**
 * Create default PhysicsChain
 */
export function createDefaultPhysicsChain() {
  return createDefaultComponent("PhysicsChain");
}
/** @deprecated Use createDefaultPhysicsChain */
export const createDefaultPhysicsRope = createDefaultPhysicsChain;

/**
 * Create empty entity
 */
export function createEmptyEntity(id) {
  return {
    id,
    name: "",
    parent: null,
    children: [],
    tags: [],
    components: {},
  };
}

/**
 * Create entity snapshot
 */
export function createEntitySnapshot(entityId, transform, physicsBody) {
  return {
    id: entityId,
    transform: transform ? { ...transform, position: [...transform.position], rotation: [...transform.rotation], scale: [...transform.scale] } : null,
    physicsBody: physicsBody ? { 
      ...physicsBody, 
      linearVelocity: [...physicsBody.linearVelocity], 
      angularVelocity: [...physicsBody.angularVelocity] 
    } : null,
  };
}

/**
 * Create world snapshot
 */
export function createWorldSnapshot(time, frameIndex) {
  return {
    time,
    frameIndex,
    entities: new Map(),
    isKeyframe: true,
  };
}

// ============================================================================
// SERIALIZATION
// ============================================================================

/**
 * Deep clone a value for serialization
 * Handles special numeric values for JSON compatibility:
 * - Infinity -> "Infinity"
 * - -Infinity -> "-Infinity"  
 * - NaN -> null (will use schema default on deserialize)
 */
function deepCloneForSerialize(v) {
  if (v === null || v === undefined) return v;
  
  // Handle special numeric values for JSON compatibility
  if (typeof v === 'number') {
    if (v === Infinity) return "Infinity";
    if (v === -Infinity) return "-Infinity";
    if (v !== v) return null; // NaN check (NaN !== NaN)
  }
  
  if (Array.isArray(v)) {
    return v.map(item => deepCloneForSerialize(item));
  }
  if (typeof v === 'object') {
    const result = {};
    for (const key of Object.keys(v)) {
      result[key] = deepCloneForSerialize(v[key]);
    }
    return result;
  }
  return v;
}

/**
 * JSON replacer function for special values
 * Use with JSON.stringify(obj, jsonReplacer)
 */
export function jsonReplacer(key, value) {
  if (typeof value === 'number') {
    if (value === Infinity) return "Infinity";
    if (value === -Infinity) return "-Infinity";
    if (value !== value) return "NaN"; // NaN check
  }
  return value;
}

/**
 * JSON reviver function for special values
 * Use with JSON.parse(str, jsonReviver)
 */
export function jsonReviver(key, value) {
  if (value === "Infinity") return Infinity;
  if (value === "-Infinity") return -Infinity;
  if (value === "NaN") return NaN;
  return value;
}

/**
 * Serialize component to JSON-safe object
 */
export function serializeComponent(componentName, value) {
  const schema = COMPONENT_SCHEMAS[componentName];
  if (!schema) return value;
  
  const result = {};
  const runtimeProps = schema.runtime || [];
  
  for (const [fieldName, fieldSchema] of Object.entries(schema.fields)) {
    // Skip runtime-only properties
    if (runtimeProps.includes(fieldName)) continue;
    
    const v = value[fieldName];
    // Include null values (they're meaningful for optional fields like endPosition)
    if (v !== undefined) {
      result[fieldName] = deepCloneForSerialize(v);
    }
  }
  return result;
}

/**
 * Deserialize component from JSON with optional self-healing
 * @param {string} componentName - Component type name
 * @param {object} json - JSON data to deserialize
 * @param {object} healingContext - Optional context for triangulation healing
 * @returns {object} Deserialized and optionally healed component data
 */
export function deserializeComponent(componentName, json, healingContext = null) {
  const validated = validateComponent(componentName, json).value;
  
  // If healing context provided, apply self-healing
  if (healingContext) {
    try {
      const { healComponent, TriangulationContext } = require('./ComponentHealer.js');
      const ctx = healingContext instanceof TriangulationContext 
        ? healingContext 
        : new TriangulationContext(healingContext);
      const { data } = healComponent(componentName, validated, ctx);
      return data;
    } catch (e) {
      // Healer not available, return validated data
      console.warn('[EntitySchema] ComponentHealer not available:', e.message);
    }
  }
  
  return validated;
}

/**
 * Serialize entity snapshot to JSON-safe object
 */
export function serializeEntitySnapshot(snapshot) {
  return {
    id: snapshot.id,
    transform: snapshot.transform ? serializeComponent("Transform", snapshot.transform) : null,
    physicsBody: snapshot.physicsBody ? serializeComponent("PhysicsBody", snapshot.physicsBody) : null,
  };
}

/**
 * Serialize world snapshot to JSON-safe object
 */
export function serializeWorldSnapshot(snapshot) {
  const entities = {};
  for (const [id, entitySnap] of snapshot.entities) {
    entities[id] = serializeEntitySnapshot(entitySnap);
  }
  return {
    time: snapshot.time,
    frameIndex: snapshot.frameIndex,
    entities,
    isKeyframe: snapshot.isKeyframe,
  };
}

/**
 * Deserialize world snapshot from JSON
 */
export function deserializeWorldSnapshot(json) {
  const entities = new Map();
  for (const [id, entitySnap] of Object.entries(json.entities)) {
    entities.set(Number(id), {
      id: entitySnap.id,
      transform: entitySnap.transform ? deserializeComponent("Transform", entitySnap.transform) : null,
      physicsBody: entitySnap.physicsBody ? deserializeComponent("PhysicsBody", entitySnap.physicsBody) : null,
    });
  }
  return {
    time: json.time,
    frameIndex: json.frameIndex,
    entities,
    isKeyframe: json.isKeyframe,
  };
}

// ============================================================================
// INTERPOLATION HELPERS
// ============================================================================

/**
 * Interpolate between two vec3 values
 */
export function lerpVec3(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

/**
 * Interpolate between two quaternions (simple lerp, not slerp)
 */
export function lerpQuat(a, b, t) {
  const result = [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t,
  ];
  const lenSq = result[0] * result[0] + result[1] * result[1] + result[2] * result[2] + result[3] * result[3];
  if (lenSq > 0) {
    const invLen = 1 / Math.sqrt(lenSq);
    result[0] *= invLen;
    result[1] *= invLen;
    result[2] *= invLen;
    result[3] *= invLen;
  }
  return result;
}

/**
 * Interpolate Transform between two states
 */
export function interpolateTransform(a, b, t) {
  if (!a) return b;
  if (!b) return a;
  return {
    position: lerpVec3(a.position, b.position, t),
    rotation: lerpQuat(a.rotation, b.rotation, t),
    scale: lerpVec3(a.scale, b.scale, t),
  };
}

/**
 * Interpolate PhysicsBody between two states
 */
export function interpolatePhysicsBody(a, b, t) {
  if (!a) return b;
  if (!b) return a;
  return {
    ...a,
    linearVelocity: lerpVec3(a.linearVelocity, b.linearVelocity, t),
    angularVelocity: lerpVec3(a.angularVelocity, b.angularVelocity, t),
  };
}

/**
 * Interpolate entity snapshot between two states
 */
export function interpolateEntitySnapshot(a, b, t) {
  if (!a) return b;
  if (!b) return a;
  return {
    id: a.id,
    transform: interpolateTransform(a.transform, b.transform, t),
    physicsBody: interpolatePhysicsBody(a.physicsBody, b.physicsBody, t),
  };
}

// ============================================================================
// ID HELPERS
// ============================================================================

/**
 * Get collider shape ID from name
 */
export function getColliderShapeId(shapeName) {
  return COLLIDER_SHAPES[shapeName]?.id ?? COLLIDER_SHAPES.box.id;
}

/**
 * Get collider shape name from ID
 */
export function getColliderShapeName(shapeId) {
  for (const [name, shape] of Object.entries(COLLIDER_SHAPES)) {
    if (shape.id === shapeId) return name;
  }
  return "box";
}

/**
 * Get light type ID from name
 */
export function getLightTypeId(typeName) {
  return LIGHT_TYPES[typeName]?.id ?? LIGHT_TYPES.point.id;
}

/**
 * Get light type name from ID
 */
export function getLightTypeName(typeId) {
  for (const [name, type] of Object.entries(LIGHT_TYPES)) {
    if (type.id === typeId) return name;
  }
  return "point";
}

/**
 * Get camera projection ID from name
 */
export function getCameraProjectionId(projName) {
  return CAMERA_PROJECTIONS[projName]?.id ?? CAMERA_PROJECTIONS.perspective.id;
}

/**
 * Get emitter shape ID from name
 */
export function getEmitterShapeId(shapeName) {
  return EMITTER_SHAPES[shapeName]?.id ?? EMITTER_SHAPES.point.id;
}
