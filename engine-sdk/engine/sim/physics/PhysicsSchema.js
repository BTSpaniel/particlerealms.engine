/**
 * PhysicsSchema.js - Unified JSON Schema for Physics System
 * 
 * Defines consistent data structures for:
 * - Body types (dynamic, kinematic, static)
 * - Collider shapes (box, sphere, capsule, mesh)
 * - Joint types (D6, revolute, spherical, distance)
 * - Collision layers and masks
 * - Material properties (friction, restitution)
 * 
 * All physics code should use these schemas for consistency.
 */

// ============================================================================
// BODY TYPES
// ============================================================================

/**
 * Physics simulation modes
 */
export const SIM_MODES = {
  dynamic: { id: 0, label: "Dynamic", desc: "Fully simulated, responds to forces" },
  kinematic: { id: 1, label: "Kinematic", desc: "Animated, affects other bodies" },
  static: { id: 2, label: "Static", desc: "Immovable, infinite mass" },
};

/**
 * Get simulation mode ID from name
 */
export function getSimModeId(modeName) {
  return SIM_MODES[modeName]?.id ?? SIM_MODES.dynamic.id;
}

/**
 * Get simulation mode name from ID
 */
export function getSimModeName(modeId) {
  for (const [name, mode] of Object.entries(SIM_MODES)) {
    if (mode.id === modeId) return name;
  }
  return "dynamic";
}

// ============================================================================
// COLLIDER SHAPES
// ============================================================================

/**
 * Collider shape types
 */
export const COLLIDER_SHAPES = {
  box: { id: 0, label: "Box", desc: "Axis-aligned box", hasHalfExtents: true },
  sphere: { id: 1, label: "Sphere", desc: "Sphere collider", hasRadius: true },
  capsule: { id: 2, label: "Capsule", desc: "Capsule (cylinder with hemispherical caps)", hasRadius: true, hasHalfHeight: true },
  cylinder: { id: 3, label: "Cylinder", desc: "Cylinder collider", hasRadius: true, hasHalfHeight: true },
  cone: { id: 4, label: "Cone", desc: "Cone collider", hasRadius: true, hasHalfHeight: true },
  convexMesh: { id: 5, label: "Convex Mesh", desc: "Convex hull from mesh", hasMeshId: true },
  triangleMesh: { id: 6, label: "Triangle Mesh", desc: "Concave mesh (static only)", hasMeshId: true },
  heightfield: { id: 7, label: "Heightfield", desc: "Terrain heightmap", hasHeightData: true },
  plane: { id: 8, label: "Plane", desc: "Infinite plane", hasNormal: true },
  sdf: { id: 9, label: "SDF", desc: "Signed distance field collider", hasSdfId: true },
};

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

// ============================================================================
// JOINT TYPES
// ============================================================================

/**
 * Joint types for articulated bodies
 */
export const JOINT_TYPES = {
  fixed: { id: 0, label: "Fixed", desc: "No relative motion allowed", dof: 0 },
  revolute: { id: 1, label: "Revolute", desc: "Single axis rotation (hinge)", dof: 1 },
  prismatic: { id: 2, label: "Prismatic", desc: "Single axis translation (slider)", dof: 1 },
  spherical: { id: 3, label: "Spherical", desc: "Ball-and-socket (3 rotations)", dof: 3 },
  distance: { id: 4, label: "Distance", desc: "Maintains distance between bodies", dof: 1 },
  d6: { id: 5, label: "D6", desc: "Configurable 6-DOF joint", dof: 6 },
};

/**
 * D6 joint axis motion types
 */
export const D6_MOTION = {
  locked: { id: 0, label: "Locked", desc: "No motion allowed" },
  limited: { id: 1, label: "Limited", desc: "Motion within limits" },
  free: { id: 2, label: "Free", desc: "Unrestricted motion" },
};

/**
 * D6 joint axes
 */
export const D6_AXES = {
  x: { id: 0, label: "X", desc: "Linear X axis" },
  y: { id: 1, label: "Y", desc: "Linear Y axis" },
  z: { id: 2, label: "Z", desc: "Linear Z axis" },
  twist: { id: 3, label: "Twist", desc: "Rotation around X" },
  swing1: { id: 4, label: "Swing1", desc: "Rotation around Y" },
  swing2: { id: 5, label: "Swing2", desc: "Rotation around Z" },
};

export const D6_DRIVES = {
  x: { id: 0, label: "X", desc: "Linear X drive" },
  y: { id: 1, label: "Y", desc: "Linear Y drive" },
  z: { id: 2, label: "Z", desc: "Linear Z drive" },
  swing: { id: 3, label: "Swing", desc: "Combined swing drive" },
  twist: { id: 4, label: "Twist", desc: "Twist drive" },
  slerp: { id: 5, label: "SLERP", desc: "Spherical interpolation drive" },
  swing1: { id: 6, label: "Swing1", desc: "Independent swing1 drive" },
  swing2: { id: 7, label: "Swing2", desc: "Independent swing2 drive" },
};

// ============================================================================
// COLLISION LAYERS
// ============================================================================

/**
 * Collision layer definitions (bitmask)
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
};

/**
 * Get collision layer mask from layer names
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
 * Check if two layer masks collide
 */
export function layersCollide(maskA, maskB) {
  return (maskA & maskB) !== 0;
}

// ============================================================================
// PHYSICS MATERIAL
// ============================================================================

/**
 * Physics material schema
 * 
 * **Compliant Contacts (PhysX 5.1+):**
 * Set restitution to a NEGATIVE value to enable spring-damper contact model.
 * This provides more stable collision behavior for complex contact configurations.
 * - restitution = -springStiffness (negative enables compliant mode)
 * - damping = damping ratio for the spring
 * - compliantAcceleration = true to use acceleration spring (mass-independent)
 */
export const PHYSICS_MATERIAL_SCHEMA = {
  name: "PhysicsMaterial",
  fields: {
    staticFriction: { type: "number", default: 0.5, min: 0, max: 1, desc: "Static friction coefficient" },
    dynamicFriction: { type: "number", default: 0.5, min: 0, max: 1, desc: "Dynamic friction coefficient" },
    restitution: { type: "number", default: 0.25, min: -1000, max: 1, desc: "Bounciness (negative=compliant spring stiffness)" },
    damping: { type: "number", default: 0.0, min: 0, desc: "Contact damping (for compliant contacts)" },
    density: { type: "number", default: 1.0, min: 0.001, desc: "Material density (kg/m³ scale)" },
    compliantAcceleration: { type: "boolean", default: false, desc: "Use acceleration spring (mass-independent)" },
  },
};

/**
 * Preset physics materials
 * Note: Negative restitution enables compliant (spring-damper) contacts
 */
export const PHYSICS_MATERIALS = {
  default: { staticFriction: 0.5, dynamicFriction: 0.5, restitution: 0.25, density: 1.0 },
  ice: { staticFriction: 0.05, dynamicFriction: 0.02, restitution: 0.1, density: 0.9 },
  rubber: { staticFriction: 0.9, dynamicFriction: 0.8, restitution: 0.8, density: 1.1 },
  metal: { staticFriction: 0.4, dynamicFriction: 0.3, restitution: 0.3, density: 7.8 },
  wood: { staticFriction: 0.5, dynamicFriction: 0.4, restitution: 0.2, density: 0.6 },
  concrete: { staticFriction: 0.7, dynamicFriction: 0.6, restitution: 0.1, density: 2.4 },
  glass: { staticFriction: 0.4, dynamicFriction: 0.3, restitution: 0.5, density: 2.5 },
  mud: { staticFriction: 0.8, dynamicFriction: 0.6, restitution: 0.0, density: 1.8 },
  sand: { staticFriction: 0.6, dynamicFriction: 0.5, restitution: 0.0, density: 1.5 },
  water: { staticFriction: 0.0, dynamicFriction: 0.0, restitution: 0.0, density: 1.0 },
  // Compliant materials (spring-damper contacts for stable stacking)
  softRubber: { staticFriction: 0.9, dynamicFriction: 0.8, restitution: -100, damping: 10, density: 1.1 },
  foam: { staticFriction: 0.7, dynamicFriction: 0.6, restitution: -50, damping: 20, density: 0.2 },
  softBody: { staticFriction: 0.6, dynamicFriction: 0.5, restitution: -200, damping: 30, density: 1.0 },
};

// ============================================================================
// BODY SCHEMA
// ============================================================================

/**
 * Physics body schema
 */
export const PHYSICS_BODY_SCHEMA = {
  name: "PhysicsBody",
  fields: {
    simMode: { type: "enum", enum: Object.keys(SIM_MODES), default: "dynamic", desc: "Simulation mode" },
    position: { type: "vec3", default: [0, 0, 0], desc: "World position" },
    rotation: { type: "quat", default: [0, 0, 0, 1], desc: "Rotation quaternion" },
    linearVelocity: { type: "vec3", default: [0, 0, 0], desc: "Linear velocity" },
    angularVelocity: { type: "vec3", default: [0, 0, 0], desc: "Angular velocity" },
    mass: { type: "number", default: 1.0, min: 0.001, desc: "Body mass (kg)" },
    linearDamping: { type: "number", default: 0.1, min: 0, desc: "Linear velocity damping" },
    angularDamping: { type: "number", default: 0.1, min: 0, desc: "Angular velocity damping" },
    gravityScale: { type: "number", default: 1.0, desc: "Gravity multiplier" },
    ccdEnabled: { type: "boolean", default: false, desc: "Continuous collision detection" },
    collisionLayer: { type: "number", default: 0x0001, desc: "Collision layer mask" },
    collisionMask: { type: "number", default: 0xFFFF, desc: "Collide-with mask" },
  },
};

/**
 * Collider schema
 */
export const COLLIDER_SCHEMA = {
  name: "Collider",
  fields: {
    shape: { type: "enum", enum: Object.keys(COLLIDER_SHAPES), default: "box", desc: "Collider shape type" },
    halfExtents: { type: "vec3", default: [0.5, 0.5, 0.5], desc: "Box half extents" },
    radius: { type: "number", default: 0.5, min: 0.001, desc: "Sphere/capsule radius" },
    halfHeight: { type: "number", default: 0.5, min: 0, desc: "Capsule/cylinder half height" },
    offset: { type: "vec3", default: [0, 0, 0], desc: "Local offset from body" },
    rotation: { type: "quat", default: [0, 0, 0, 1], desc: "Local rotation" },
    isTrigger: { type: "boolean", default: false, desc: "Trigger (no physics response)" },
    material: { type: "string", default: "default", desc: "Physics material name" },
    meshId: { type: "string", default: null, desc: "Mesh ID for mesh colliders" },
    sdfId: { type: "string", default: null, desc: "SDF ID for SDF colliders" },
    sdfResolution: { type: "number", default: 32, min: 4, desc: "SDF voxel resolution per axis" },
    sdfSpacing: { type: "number", default: 0.05, min: 0.0001, desc: "SDF voxel spacing" },
    sdfNarrowBand: { type: "number", default: 0.12, min: 0, desc: "SDF narrow-band thickness" },
    preferSdfProjection: { type: "boolean", default: true, desc: "Prefer PhysX SDF projection when available" },
  },
};

/**
 * Joint schema
 */
export const JOINT_SCHEMA = {
  name: "Joint",
  fields: {
    type: { type: "enum", enum: Object.keys(JOINT_TYPES), default: "fixed", desc: "Joint type" },
    bodyA: { type: "any", default: null, desc: "First body (null = world)" },
    bodyB: { type: "any", required: true, desc: "Second body" },
    anchorA: { type: "vec3", default: [0, 0, 0], desc: "Anchor point on body A" },
    anchorB: { type: "vec3", default: [0, 0, 0], desc: "Anchor point on body B" },
    axisA: { type: "vec3", default: [1, 0, 0], desc: "Joint axis on body A" },
    axisB: { type: "vec3", default: [1, 0, 0], desc: "Joint axis on body B" },
    breakForce: { type: "number", default: Infinity, desc: "Force to break joint" },
    breakTorque: { type: "number", default: Infinity, desc: "Torque to break joint" },
    enableCollision: { type: "boolean", default: false, desc: "Enable collision between joined bodies" },
    motion: { type: "any", default: {}, desc: "Per-axis D6 motion config" },
    drive: { type: "any", default: {}, desc: "Per-axis D6 drive config" },
    drivePosition: { type: "any", default: null, desc: "D6 target pose" },
    driveVelocity: { type: "any", default: null, desc: "D6 target velocity" },
  },
};

// ============================================================================
// WORLD CONFIG SCHEMA
// ============================================================================

/**
 * Physics world configuration
 */
export const PHYSICS_WORLD_SCHEMA = {
  name: "PhysicsWorld",
  fields: {
    gravity: { type: "vec3", default: [0, -9.81, 0], desc: "World gravity" },
    bounce: { type: "number", default: 0.25, min: 0, max: 1, desc: "Default restitution" },
    maxStep: { type: "number", default: 1/60, min: 0.001, desc: "Max simulation step (s)" },
    maxSubSteps: { type: "number", default: 4, min: 1, max: 16, desc: "Max sub-steps per frame" },
    solverIterations: { type: "number", default: 4, min: 1, max: 32, desc: "Solver iterations" },
    sleepThreshold: { type: "number", default: 0.05, min: 0, desc: "Sleep velocity threshold" },
  },
};

// ============================================================================
// STANDARD COLLIDER MESH IDS
// ============================================================================

/**
 * Standard convex collider mesh IDs
 */
export const STANDARD_COLLIDER_MESHES = {
  unitCube: "engine:collider:convex:unit_cube",
  unitSphere: "engine:collider:convex:unit_sphere",
  unitCapsule: "engine:collider:convex:unit_capsule",
  unitCylinder: "engine:collider:convex:unit_cylinder",
  unitCone: "engine:collider:convex:unit_cone",
  unitTorus: "engine:collider:convex:unit_torus",
  plane3x3: "engine:collider:convex:plane_3x3",
};

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate physics body configuration
 */
export function validatePhysicsBody(config) {
  const errors = [];
  const result = { ...config };
  
  // Validate simMode
  if (!SIM_MODES[config.simMode]) {
    result.simMode = "dynamic";
    errors.push(`Invalid simMode: ${config.simMode}`);
  }
  
  // Validate mass
  if (typeof config.mass !== "number" || config.mass <= 0) {
    result.mass = 1.0;
    if (config.mass !== undefined) errors.push(`Invalid mass: ${config.mass}`);
  }
  
  // Validate damping
  if (typeof config.linearDamping !== "number" || config.linearDamping < 0) {
    result.linearDamping = 0.1;
  }
  if (typeof config.angularDamping !== "number" || config.angularDamping < 0) {
    result.angularDamping = 0.1;
  }
  
  return { valid: errors.length === 0, errors, value: result };
}

/**
 * Validate collider configuration
 */
export function validateCollider(config) {
  const errors = [];
  const result = { ...config };
  
  // Validate shape
  if (!COLLIDER_SHAPES[config.shape]) {
    result.shape = "box";
    errors.push(`Invalid shape: ${config.shape}`);
  }
  
  // Validate radius
  if (typeof config.radius !== "number" || config.radius <= 0) {
    result.radius = 0.5;
  }
  
  // Validate halfExtents
  if (!Array.isArray(config.halfExtents) || config.halfExtents.length < 3) {
    result.halfExtents = [0.5, 0.5, 0.5];
  }
  
  return { valid: errors.length === 0, errors, value: result };
}

/**
 * Validate physics material
 */
export function validatePhysicsMaterial(config) {
  const errors = [];
  const result = { ...PHYSICS_MATERIALS.default };
  
  if (typeof config.staticFriction === "number") {
    result.staticFriction = Math.max(0, Math.min(1, config.staticFriction));
  }
  if (typeof config.dynamicFriction === "number") {
    result.dynamicFriction = Math.max(0, Math.min(1, config.dynamicFriction));
  }
  if (typeof config.restitution === "number") {
    result.restitution = Math.max(-1000, Math.min(1, config.restitution));
  }
  if (typeof config.density === "number" && config.density > 0) {
    result.density = config.density;
  }
  
  return { valid: errors.length === 0, errors, value: result };
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create default physics body config
 */
export function createDefaultPhysicsBody() {
  return {
    simMode: "dynamic",
    position: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    linearVelocity: [0, 0, 0],
    angularVelocity: [0, 0, 0],
    mass: 1.0,
    linearDamping: 0.1,
    angularDamping: 0.1,
    gravityScale: 1.0,
    ccdEnabled: true,
    collisionLayer: COLLISION_LAYERS.dynamic.mask,
    collisionMask: 0xFFFF,
  };
}

/**
 * Create default collider config
 */
export function createDefaultCollider(shape = "box") {
  return {
    shape,
    halfExtents: [0.5, 0.5, 0.5],
    radius: 0.5,
    halfHeight: 0.5,
    offset: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    isTrigger: false,
    material: "default",
    meshId: null,
    sdfId: null,
    sdfResolution: 32,
    sdfSpacing: 0.05,
    sdfNarrowBand: 0.12,
    preferSdfProjection: true,
  };
}

/**
 * Create default joint config
 */
export function createDefaultJoint(type = "fixed") {
  return {
    type,
    bodyA: null,
    bodyB: null,
    anchorA: [0, 0, 0],
    anchorB: [0, 0, 0],
    axisA: [1, 0, 0],
    axisB: [1, 0, 0],
    breakForce: Infinity,
    breakTorque: Infinity,
    enableCollision: false,
    motion: {},
    drive: {},
    drivePosition: null,
    driveVelocity: null,
  };
}

/**
 * Create default physics world config
 */
export function createDefaultPhysicsWorld() {
  return {
    gravity: [0, -9.81, 0],
    bounce: 0.25,
    maxStep: 1/60,
    maxSubSteps: 4,
    solverIterations: 4,
    sleepThreshold: 0.05,
  };
}

/**
 * Get physics material by name
 */
export function getPhysicsMaterial(name) {
  return PHYSICS_MATERIALS[name] || PHYSICS_MATERIALS.default;
}
