import { ensurePhysXModule } from "./PhysXModule.js";
import { PhysicsPoseReadback } from '../PhysicsPoseReadback.js';
import { PHYSICS_RUNTIME } from '../PhysicsRuntimeDescriptor.js';

// Re-exported so a consumer can point PhysX at its own copy of the binary
// without importing a second module. `PE.particlePhysXPhysicsWorld` is the
// namespace games already reach for, and the wasm URL is the first thing a
// bundled consumer has to fix — see `setPhysXWasmUrl`.
export { setPhysXWasmUrl } from "./PhysXModule.js";
import { ensureStandardColliderMeshes, getStandardColliderBaseHalfExtents } from "./StandardColliderMeshes.js";
import { cookAndRegisterConvexMeshForWorld } from "./PhysXMeshCooking.js";
import { getPhysXFlagsForCollisionMode, COLLISION_MODES } from "../../ecs/EntitySchema.js";

// Module-level singleton for PhysX foundation (only one allowed per process)
let sharedFoundation = null;
let sharedAllocator = null;
let sharedErrorCallback = null;
let sharedPhysX = null;

/**
 * Create PxFilterData for an entity based on EntityFlags
 * @param {object} PhysX - PhysX module
 * @param {object} entityFlags - EntityFlags component data (or null for defaults)
 * @param {object} defaultFilterData - Fallback filter data from world
 * @returns {PxFilterData} Filter data for this entity
 */
function createEntityFilterData(PhysX, entityFlags, defaultFilterData) {
  if (!PhysX || !PhysX.PxFilterData) {
    return defaultFilterData;
  }
  
  // Use EntityFlags if provided, otherwise use defaults
  const collisionLayer = entityFlags?.collisionLayer ?? 0x0001;
  const collisionMask = entityFlags?.collisionMask ?? 0xFFFF;
  const collisionMode = entityFlags?.collisionMode ?? 'solid';
  
  // Get pair flags based on collision mode
  const { pairFlags } = getPhysXFlagsForCollisionMode(collisionMode);
  
  // Add CCD detection and contact point extraction flags
  const DETECT_CCD_CONTACT = PhysX.PxPairFlagEnum?.eDETECT_CCD_CONTACT || 2048;
  const NOTIFY_CONTACT_POINTS = PhysX.PxPairFlagEnum?.eNOTIFY_CONTACT_POINTS || 512;
  const finalPairFlags = pairFlags | DETECT_CCD_CONTACT | NOTIFY_CONTACT_POINTS;
  
  // word0 = collision layer (what layer this entity belongs to)
  // word1 = collision mask (what layers this entity collides with)
  // word2 = pair flags (how contacts are handled)
  // word3 = reserved (user data)
  return new PhysX.PxFilterData(collisionLayer, collisionMask, finalPairFlags, 0);
}

/**
 * Create PxShapeFlags based on EntityFlags collision mode
 * @param {object} PhysX - PhysX module
 * @param {object} entityFlags - EntityFlags component data (or null for defaults)
 * @param {object} defaultShapeFlags - Fallback shape flags from world
 * @returns {PxShapeFlags} Shape flags for this entity
 */
function createEntityShapeFlags(PhysX, entityFlags, defaultShapeFlags) {
  if (!PhysX || !PhysX.PxShapeFlags || !PhysX.PxShapeFlagEnum) {
    return defaultShapeFlags;
  }
  
  const collisionMode = entityFlags?.collisionMode ?? 'solid';
  const { shapeFlags } = getPhysXFlagsForCollisionMode(collisionMode);
  
  return new PhysX.PxShapeFlags(shapeFlags);
}

function releaseOrDestroy(PhysX, obj) {
  if (!PhysX || !obj) return;
  try {
    if (typeof obj.release === "function") {
      obj.release();
    } else {
      PhysX.destroy(obj);
    }
  } catch (_) {}
}

export function createPhysicsWorld(options = {}) {
  const gravity = resolveGravity(options.gravity);
  const maxStep = resolvePositive(options.maxStep, 1 / 60);
  const maxSubSteps = resolveInt(options.maxSubSteps, 1, 1, 8);

  const materialOpts = options.material || {};
  const materialStaticFriction = resolvePositive(
    materialOpts.staticFriction,
    0.5,
  );
  const materialDynamicFriction = resolvePositive(
    materialOpts.dynamicFriction,
    0.5,
  );
  const materialRestitution = resolvePositive(
    materialOpts.restitution,
    0.5,
  );

  const world = {
    gravity,
    maxStep,
    maxSubSteps,
    materialStaticFriction,
    materialDynamicFriction,
    materialRestitution,
    module: null,
    version: 0,
    runtime: PHYSICS_RUNTIME,
    _poseReadback: null,
    poseReadbackStats: null,
    allocator: null,
    errorCallback: null,
    foundation: null,
    tolerances: null,
    physics: null,
    scene: null,
    defaultMaterial: null,
    shapeFlags: null,
    filterData: null,
    ready: false,
    destroyed: false,
    nextBodyHandle: 1,
    bodies: new Map(), // handle -> body
    _bodyByEntityId: new Map(), // entityId -> body (reverse map for getActiveActors)
    _bodyByActorPtr: new Map(), // all actors, including bodies without ECS entity IDs
    _actorPtrToEntityId: new Map(), // WASM actor ptr -> entityId (stable lookup for contact callback)
    convexMeshes: new Map(), // meshId -> PxConvexMesh
    triangleMeshes: new Map(), // meshId -> PxTriangleMesh
    contactEvents: [],
    triggerEvents: [],
  };

  ensurePhysXModule()
    .then((mod) => {
      if (world.destroyed) {
        return;
      }
      initializePhysXWorld(world, mod);
      world._poseReadback = new PhysicsPoseReadback(mod, options.poseBatchCapacity ?? 1024);
      world.poseReadbackStats = world._poseReadback.stats;
      for (const body of world.bodies.values()) {
        if (body && !body._actor) {
          tryCreateActorForBody(world, body);
        }
      }
    })
    .catch((error) => {
      console.error("PhysXPhysicsWorld: failed to initialize PhysX module", error);
    });

  return world;
}

export { createPhysicsWorld as PhysXPhysicsWorld };

export function registerConvexMesh(world, meshId, pxConvexMesh) {
  if (!world || !world.convexMeshes || !meshId || !pxConvexMesh) {
    return;
  }
  world.convexMeshes.set(meshId, pxConvexMesh);
}

export function registerTriangleMesh(world, meshId, pxTriangleMesh) {
  if (!world || !world.triangleMeshes || !meshId || !pxTriangleMesh) {
    return;
  }
  world.triangleMeshes.set(meshId, pxTriangleMesh);
}

export function destroyPhysicsWorld(world) {
  if (!world || world.destroyed) {
    return;
  }
  world.destroyed = true;

  const PhysX = world.module;
  if (!PhysX) {
    world.bodies.clear();
    world._bodyByEntityId.clear();
    world._bodyByActorPtr.clear();
    if (world._actorPtrToEntityId) world._actorPtrToEntityId.clear();
    return;
  }

  const handles = [];
  try {
    for (const h of world.bodies.keys()) handles.push(h);
  } catch (_) {}
  for (let i = 0; i < handles.length; i++) {
    try {
      removeBody(world, handles[i]);
    } catch (_) {}
  }

  world._poseReadback?.dispose();
  world._poseReadback = null;
  if (world.scene) {
    try {
      releaseOrDestroy(PhysX, world.scene);
    } catch (error) {
      console.error("PhysXPhysicsWorld: error destroying scene", error);
    }
    world.scene = null;
  }
  if (world.defaultMaterial) {
    try {
      releaseOrDestroy(PhysX, world.defaultMaterial);
    } catch (error) {
      console.error("PhysXPhysicsWorld: error destroying material", error);
    }
    world.defaultMaterial = null;
  }
  if (world._simulationEventCallback) {
    try {
      PhysX.destroy(world._simulationEventCallback);
    } catch (_) {}
    world._simulationEventCallback = null;
  }
  if (world.convexMeshes && world.convexMeshes.size) {
    for (const mesh of world.convexMeshes.values()) {
      releaseOrDestroy(PhysX, mesh);
    }
    world.convexMeshes.clear();
  }
  if (world.triangleMeshes && world.triangleMeshes.size) {
    for (const mesh of world.triangleMeshes.values()) {
      releaseOrDestroy(PhysX, mesh);
    }
    world.triangleMeshes.clear();
  }
  if (world.shapeFlags) {
    try {
      releaseOrDestroy(PhysX, world.shapeFlags);
    } catch (error) {
      console.error("PhysXPhysicsWorld: error destroying shapeFlags", error);
    }
    world.shapeFlags = null;
  }
  if (world.filterData) {
    try {
      releaseOrDestroy(PhysX, world.filterData);
    } catch (error) {
      console.error("PhysXPhysicsWorld: error destroying filterData", error);
    }
    world.filterData = null;
  }
  if (world._filterShaderImpl) {
    world._filterShaderImpl = null;
  }
  if (world.cpuDispatcher) {
    try {
      releaseOrDestroy(PhysX, world.cpuDispatcher);
    } catch (_) {}
    world.cpuDispatcher = null;
  }
  if (world.physics) {
    try {
      releaseOrDestroy(PhysX, world.physics);
    } catch (error) {
      console.error("PhysXPhysicsWorld: error destroying physics", error);
    }
    world.physics = null;
  }
  if (world.tolerances) {
    try {
      releaseOrDestroy(PhysX, world.tolerances);
    } catch (error) {
      console.error("PhysXPhysicsWorld: error destroying tolerances", error);
    }
    world.tolerances = null;
  }
  // Don't destroy shared foundation/allocator/errorCallback - they're reused
  if (world.foundation && world.foundation !== sharedFoundation) {
    try {
      releaseOrDestroy(PhysX, world.foundation);
    } catch (error) {
      console.error("PhysXPhysicsWorld: error destroying foundation", error);
    }
  }
  world.foundation = null;

  if (world.allocator && world.allocator !== sharedAllocator) {
    try {
      PhysX.destroy(world.allocator);
    } catch (error) {
      console.error("PhysXPhysicsWorld: error destroying allocator", error);
    }
  }
  world.allocator = null;

  if (world.errorCallback && world.errorCallback !== sharedErrorCallback) {
    try {
      PhysX.destroy(world.errorCallback);
    } catch (error) {
      console.error("PhysXPhysicsWorld: error destroying errorCallback", error);
    }
  }
  world.errorCallback = null;

  world.bodies.clear();
  if (world._actorPtrToEntityId) world._actorPtrToEntityId.clear();
  world.ready = false;
}

export function createBody(world, desc) {
  if (!world || world.destroyed) {
    throw new Error(
      "PhysXPhysicsWorld.createBody: world is required and must not be destroyed"
    );
  }

  const handle = world.nextBodyHandle | 0;
  world.nextBodyHandle = handle + 1;

  const simMode = sanitizeSimMode(desc && desc.simMode);
  const collider = desc && desc.collider && typeof desc.collider === "object"
    ? desc.collider
    : null;
  
  // Support compound colliders (array of collider configs)
  const compoundColliders = desc && Array.isArray(desc.compoundColliders) 
    ? desc.compoundColliders 
    : null;

  const shapeValue = collider && typeof collider.shape === "string"
    ? collider.shape
    : "box";

  let colliderShape = "box";
  let colliderMeshType = null;
  if (
    shapeValue === "sphere" ||
    shapeValue === "capsule" ||
    shapeValue === "box" ||
    shapeValue === "convexMesh" ||
    shapeValue === "triangleMesh"
  ) {
    colliderShape = shapeValue;
  }
  if (shapeValue === "convexMesh" || shapeValue === "triangleMesh") {
    colliderMeshType = shapeValue;
  }

  const colliderHalfExtents = collider && Array.isArray(collider.halfExtents)
    ? makeVec3(collider.halfExtents, [0.5, 0.5, 0.5])
    : [0.5, 0.5, 0.5];

  const colliderRadius = collider
    ? resolvePositive(collider.radius, 0.5)
    : 0.5;

  const colliderHalfHeight = collider
    ? resolveNonNegative(collider.halfHeight, 0.5)
    : 0.5;

  const colliderIsTrigger = collider ? !!collider.isTrigger : false;

  const colliderMeshId =
    collider && typeof collider.meshId === "string" ? collider.meshId : null;

  // Store vertices for on-the-fly convex mesh cooking
  const colliderVertices = collider && collider.vertices ? collider.vertices : null;

  const colliderLocalOffset = collider && Array.isArray(collider.localOffset)
    ? makeVec3(collider.localOffset, [0, 0, 0])
    : [0, 0, 0];

  const colliderMaterial = collider && collider.material && typeof collider.material === "object"
    ? {
        staticFriction: resolvePositive(collider.material.staticFriction, null),
        dynamicFriction: resolvePositive(collider.material.dynamicFriction, null),
        restitution: resolvePositive(collider.material.restitution, null),
      }
    : null;

  const mass = desc && desc.mass !== undefined ? Number(desc.mass) : NaN;
  const density = desc && desc.density !== undefined ? Number(desc.density) : NaN;
  const linearDamping = desc && desc.linearDamping !== undefined ? Number(desc.linearDamping) : NaN;
  const angularDamping = desc && desc.angularDamping !== undefined ? Number(desc.angularDamping) : NaN;

  const lv = makeVec3(desc && desc.linearVelocity, [0, 0, 0]);
  
  // EntityFlags for per-entity collision filtering (passed from ECS)
  const entityFlags = desc && desc.entityFlags && typeof desc.entityFlags === "object"
    ? desc.entityFlags
    : null;
  
  // EntityId for linking back to ECS
  const entityId = desc && desc.entityId !== undefined ? desc.entityId : null;
  
  const body = {
    handle,
    simMode,
    position: makeVec3(desc && desc.position, [0, 0, 0]),
    rotation: makeQuat(desc && desc.rotation, [0, 0, 0, 1]),
    linearVelocity: lv,
    velocity: lv,
    angularVelocity: makeVec3(desc && desc.angularVelocity, [0, 0, 0]),
    mass: Number.isFinite(mass) && mass > 0 ? mass : NaN,
    density: Number.isFinite(density) && density > 0 ? density : NaN,
    linearDamping: Number.isFinite(linearDamping) && linearDamping >= 0 ? linearDamping : NaN,
    angularDamping: Number.isFinite(angularDamping) && angularDamping >= 0 ? angularDamping : NaN,
    colliderShape,
    colliderHalfExtents,
    colliderRadius,
    colliderHalfHeight,
    colliderIsTrigger,
    colliderMeshType,
    colliderMeshId,
    colliderVertices,
    colliderLocalOffset,
    colliderMaterial,
    compoundColliders,
    entityFlags,
    entityId,
    _actor: null,
  };

  world.bodies.set(handle, body);
  if (entityId != null) {
    world._bodyByEntityId.set(entityId, body);
  }

  if (world.ready) {
    tryCreateActorForBody(world, body);
  }

  return body;
}

export function getBody(world, handle) {
  if (!world) {
    return null;
  }
  if (typeof handle !== "number") {
    return null;
  }
  return world.bodies.get(handle) || null;
}

export function setBodyKinematic(world, handle, enabled) {
  if (!world || world.destroyed || !world.ready || !world.module) {
    return false;
  }

  const body = typeof handle === "number" ? getBody(world, handle) : handle;
  if (!body || !body._actor) {
    return false;
  }

  const PhysX = world.module;
  const actor = body._actor;
  if (!PhysX || !PhysX.PxRigidBodyFlagEnum || typeof actor.setRigidBodyFlag !== "function") {
    return false;
  }

  const wantsKinematic = !!enabled;
  
  // CRITICAL: PhysX does not support CCD on kinematic bodies
  // Must disable CCD flags BEFORE setting kinematic flag to avoid warning
  if (wantsKinematic) {
    // Switching to kinematic - disable CCD first
    if (typeof PhysX.PxRigidBodyFlagEnum.eENABLE_CCD !== "undefined") {
      try {
        actor.setRigidBodyFlag(PhysX.PxRigidBodyFlagEnum.eENABLE_CCD, false);
      } catch (_) {}
    }
    if (typeof PhysX.PxRigidBodyFlagEnum.eENABLE_SPECULATIVE_CCD !== "undefined") {
      try {
        actor.setRigidBodyFlag(PhysX.PxRigidBodyFlagEnum.eENABLE_SPECULATIVE_CCD, false);
      } catch (_) {}
    }
  }
  
  try {
    actor.setRigidBodyFlag(PhysX.PxRigidBodyFlagEnum.eKINEMATIC, wantsKinematic);
  } catch (_) {
    return false;
  }

  body.simMode = wantsKinematic ? "kinematic" : "dynamic";
  
  // Re-enable CCD when switching back to dynamic (if originally enabled)
  if (!wantsKinematic) {
    const enableCCD = body.ccdEnabled !== false; // Default true if not specified
    if (enableCCD) {
      if (typeof PhysX.PxRigidBodyFlagEnum.eENABLE_CCD !== "undefined") {
        try {
          actor.setRigidBodyFlag(PhysX.PxRigidBodyFlagEnum.eENABLE_CCD, true);
        } catch (_) {}
      }
      if (typeof PhysX.PxRigidBodyFlagEnum.eENABLE_SPECULATIVE_CCD !== "undefined") {
        try {
          actor.setRigidBodyFlag(PhysX.PxRigidBodyFlagEnum.eENABLE_SPECULATIVE_CCD, true);
        } catch (_) {}
      }
    }
    
    try {
      if (typeof actor.wakeUp === "function") {
        actor.wakeUp();
      }
    } catch (_) {}
  }

  return true;
}

/**
 * Move a kinematic body to a new pose (PhysX setKinematicTarget — the solver
 * sweeps it there over the next step, pushing dynamic bodies out of the way
 * instead of teleporting through them). Used for script-driven obstacles
 * (e.g. AI traffic cars that dynamic bodies must collide with).
 * @param {object} world
 * @param {number} handle body handle from createBody (simMode 'kinematic')
 * @param {number[]} position [x,y,z]
 * @param {number[]} [rotation] [x,y,z,w]
 * @returns {boolean}
 */
export function setKinematicPose(world, handle, position, rotation = [0, 0, 0, 1]) {
  if (!world || world.destroyed || !world.ready || !world.module) return false;
  const body = world.bodies.get(handle);
  const actor = body && body._actor;
  if (!actor || typeof actor.setKinematicTarget !== "function") return false;
  const PhysX = world.module;
  try {
    const p = new PhysX.PxVec3(position[0], position[1], position[2]);
    const q = new PhysX.PxQuat(rotation[0], rotation[1], rotation[2], rotation[3]);
    const t = new PhysX.PxTransform(p, q);
    actor.setKinematicTarget(t);
    body.position = [...position];
    body.rotation = [...rotation];
    PhysX.destroy(p);
    PhysX.destroy(q);
    PhysX.destroy(t);
    return true;
  } catch (_) {
    return false;
  }
}

export function removeBody(world, handle) {
  if (!world) {
    return false;
  }
  const body = world.bodies.get(handle);
  if (!body) {
    return false;
  }

  const PhysX = world.module;
  world._poseReadback?.remove(body);
  if (world.ready && PhysX && body._actor && world.scene) {
    // Skip removeActor if body was already removed (e.g., during welding)
    if (!body._removedFromScene) {
      try {
        if (typeof world.scene.removeActor === "function") {
          world.scene.removeActor(body._actor);
        }
      } catch (error) {
        console.error("PhysXPhysicsWorld: error removing actor from scene", error);
      }
    }
    try {
      releaseOrDestroy(PhysX, body._actor);
    } catch (error) {
      const msg =
        error && typeof error.message === "string"
          ? error.message
          : String(error || "");
      if (!msg.includes("Cannot destroy object")) {
        console.error("PhysXPhysicsWorld: error destroying actor", error);
      }
    }
    body._actor = null;
  }

  if (body.entityId != null) {
    world._bodyByEntityId.delete(body.entityId);
  }
  // Clean up actor ptr → entityId mapping
  if (body._actorPtr != null && world._actorPtrToEntityId) {
    world._actorPtrToEntityId.delete(body._actorPtr);
    world._bodyByActorPtr.delete(body._actorPtr);
  }
  world.bodies.delete(handle);
  return true;
}

/**
 * Update a body's collision filter data based on EntityFlags
 * Call this when EntityFlags.collisionLayer, collisionMask, or collisionMode changes
 * @param {object} world - Physics world
 * @param {number|object} handle - Body handle or body object
 * @param {object} entityFlags - Updated EntityFlags component data
 * @returns {boolean} True if update succeeded
 */
export function updateBodyFilterData(world, handle, entityFlags) {
  if (!world || world.destroyed || !world.ready || !world.module) {
    return false;
  }
  
  const body = typeof handle === "number" ? getBody(world, handle) : handle;
  if (!body || !body._actor) {
    return false;
  }
  
  const PhysX = world.module;
  const actor = body._actor;
  
  // Create new filter data from EntityFlags
  const newFilterData = createEntityFilterData(PhysX, entityFlags, world.filterData);
  
  // Update filter data on body object
  body.entityFlags = entityFlags;
  
  // Get all shapes from actor and update their filter data
  try {
    const nbShapes = actor.getNbShapes?.() || 0;
    if (nbShapes > 0 && PhysX.SupportFunctions?.PxActor_getShapes) {
      const shapes = PhysX.SupportFunctions.PxActor_getShapes(actor, nbShapes);
      for (let i = 0; i < nbShapes; i++) {
        const shape = shapes.at(i);
        if (shape && typeof shape.setSimulationFilterData === "function") {
          shape.setSimulationFilterData(newFilterData);
        }
      }
    }
  } catch (e) {
    console.warn('[PhysXPhysicsWorld] Failed to update body filter data:', e);
    return false;
  }
  
  return true;
}

export function updateWorldMaterial(world, materialOptions) {
  if (!world || !materialOptions || typeof materialOptions !== "object") {
    return;
  }

  let sf = world.materialStaticFriction;
  let df = world.materialDynamicFriction;
  let re = world.materialRestitution;

  if (materialOptions.staticFriction !== undefined) {
    sf = resolvePositive(materialOptions.staticFriction, sf || 0.5);
    world.materialStaticFriction = sf;
  }
  if (materialOptions.dynamicFriction !== undefined) {
    df = resolvePositive(materialOptions.dynamicFriction, df || 0.5);
    world.materialDynamicFriction = df;
  }
  if (materialOptions.restitution !== undefined) {
    re = resolvePositive(materialOptions.restitution, re || 0.5);
    world.materialRestitution = re;
  }

  const material = world.defaultMaterial;
  if (!material) {
    return;
  }

  if (sf !== undefined) {
    try {
      material.setStaticFriction(sf);
    } catch (e) {}
  }
  if (df !== undefined) {
    try {
      material.setDynamicFriction(df);
    } catch (e) {}
  }
  if (re !== undefined) {
    try {
      material.setRestitution(re);
    } catch (e) {}
  }
}

// Simple world-space raycast helper used by gameplay systems (e.g. lightning beams).
// Returns null if no hit or physics world not ready, otherwise:
//   { hit: true, distance, position: [x,y,z], normal: [x,y,z] | null, entityId }
export function raycastWorld(world, origin, direction, maxDistance) {
  if (!world || world.destroyed || !world.ready || !world.scene || !world.module) {
    return null;
  }

  const PhysX = world.module;
  if (!PhysX || !PhysX.PxVec3 || !PhysX.PxRaycastResult) {
    return null;
  }

  const ox = safeNumber(origin && origin[0], 0);
  const oy = safeNumber(origin && origin[1], 0);
  const oz = safeNumber(origin && origin[2], 0);

  let dx = safeNumber(direction && direction[0], 0);
  let dy = safeNumber(direction && direction[1], 0);
  let dz = safeNumber(direction && direction[2], 0);
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!Number.isFinite(len) || len <= 1e-5) {
    return null;
  }
  dx /= len;
  dy /= len;
  dz /= len;

  const maxDist = Number.isFinite(maxDistance) && maxDistance > 0
    ? maxDistance
    : 1000;

  let originVec = null;
  let dirVec = null;
  let hitFlags = null;
  let hitBuffer = null;

  try {
    originVec = new PhysX.PxVec3(ox, oy, oz);
    dirVec = new PhysX.PxVec3(dx, dy, dz);
    // Collect all touches: the fixed ten-hit buffer can truncate before the
    // nearest shape when a ray crosses a dense construction assembly.
    hitBuffer = new PhysX.PxRaycastResult();

    // Request position + normal data when possible
    if (PhysX.PxHitFlags && PhysX.PxHitFlagEnum) {
      const flagsValue = (PhysX.PxHitFlagEnum.ePOSITION | PhysX.PxHitFlagEnum.eNORMAL);
      hitFlags = new PhysX.PxHitFlags(flagsValue);
    }

    let didHit = false;
    if (hitFlags) {
      // Simulation PxFilterData is not a PxQueryFilterData. Let PhysX use its
      // default static/dynamic query filter instead of reading the wrong ABI.
      didHit = world.scene.raycast(originVec, dirVec, maxDist, hitBuffer, hitFlags);
    } else {
      didHit = world.scene.raycast(originVec, dirVec, maxDist, hitBuffer);
    }

    if (!didHit) {
      return null;
    }

    // Current bindings can return touch hits without a blocking hit. Select
    // the nearest result in either representation for the gameplay helper.
    let block = hitBuffer.hasBlock ? hitBuffer.block : null;
    for (let i = 0; i < hitBuffer.getNbAnyHits(); i++) {
      const hit = hitBuffer.getAnyHit(i);
      if (!block || hit.distance < block.distance) block = hit;
    }
    if (!block) {
      return null;
    }

    const hitDistance = block.distance;
    if (!Number.isFinite(hitDistance) || hitDistance <= 0) {
      return null;
    }

    const posVec = block.position;
    const normalVec = block.normal;

    const position = posVec
      ? [
          safeNumber(posVec.get_x(), ox + dx * hitDistance),
          safeNumber(posVec.get_y(), oy + dy * hitDistance),
          safeNumber(posVec.get_z(), oz + dz * hitDistance),
        ]
      : [ox + dx * hitDistance, oy + dy * hitDistance, oz + dz * hitDistance];

    const normal = normalVec
      ? [
          safeNumber(normalVec.get_x(), 0),
          safeNumber(normalVec.get_y(), 1),
          safeNumber(normalVec.get_z(), 0),
        ]
      : null;

    let entityId = null;
    const actor = block.actor;
    if (actor && actor.userData !== undefined) {
      entityId = actor.userData;
    }

    return {
      hit: true,
      distance: hitDistance,
      position,
      normal,
      entityId,
    };
  } catch (error) {
    try {
      console.error("[PHYSX] raycastWorld error", error);
    } catch (_) {}
    return null;
  } finally {
    try { if (hitFlags) PhysX.destroy(hitFlags); } catch (_) {}
    try { if (hitBuffer) PhysX.destroy(hitBuffer); } catch (_) {}
    try { if (originVec) PhysX.destroy(originVec); } catch (_) {}
    try { if (dirVec) PhysX.destroy(dirVec); } catch (_) {}
  }
}

export function stepPhysicsWorld(world, deltaTime) {
  if (!world || world.destroyed || !world.ready || !world.module || !world.scene) {
    return;
  }

  const PhysX = world.module;

  const dtValue = typeof deltaTime === "number" ? deltaTime : 0;
  if (!Number.isFinite(dtValue) || dtValue <= 0) {
    return;
  }

  const maxStep = world.maxStep;
  const maxSubSteps = world.maxSubSteps | 0;
  const clampedDt = dtValue > 0.25 ? 0.25 : dtValue;
  const steps = Math.min(maxSubSteps, Math.max(1, Math.ceil(clampedDt / maxStep)));
  const dt = clampedDt / steps;

  const scene = world.scene;

  for (let i = 0; i < steps; i++) {
    scene.simulate(dt);
    scene.fetchResults(true);
  }

  // Rust copies poses in the shared native heap; JS consumes each view before
  // velocity getters can allocate/grow that heap. Active actor filtering still
  // limits velocity readback to moving bodies.
  world._poseReadback?.update();
  // ── Readback: get velocities from PhysX into JS body objects ─────────
  // Fast path: use getActiveActors (only returns bodies that moved).
  // Fallback: iterate all bodies, skip static + sleeping.
  const hasActiveActors = PhysX.SupportFunctions &&
    typeof PhysX.SupportFunctions.PxScene_getActiveActors === "function";

  if (hasActiveActors) {
    _readbackActiveActors(world, PhysX, scene);
  } else {
    _readbackAllBodies(world, PhysX);
  }
}

/**
 * Fast readback path: use PhysX getActiveActors to only process bodies that moved.
 * Avoids iterating all bodies and checking isSleeping() on each.
 */
function _readbackActiveActors(world, PhysX, scene) {
  let activeList = null;
  try {
    activeList = PhysX.SupportFunctions.PxScene_getActiveActors(scene);
  } catch (_) {
    // API failed — fall back to full iteration
    _readbackAllBodies(world, PhysX);
    return;
  }

  if (!activeList) {
    return;
  }

  const count = activeList.size();
  const bodyMap = world._bodyByEntityId;

  for (let i = 0; i < count; i++) {
    let actor = null;
    try {
      actor = activeList.get(i);
    } catch (_) { continue; }
    if (!actor) continue;

    // Look up body via actor.userData (entityId)
    const entityId = actor.userData;
    const body = (entityId != null ? bodyMap.get(entityId) : null)
      ?? world._bodyByActorPtr.get(PhysX.getPointer(actor));
    if (!body) continue;

    _readbackBody(body, actor, !world._poseReadback);
  }
}

/**
 * Fallback readback: iterate all bodies, skip static + sleeping.
 */
function _readbackAllBodies(world, PhysX) {
  const hasIsSleeping = typeof PhysX.PxRigidDynamic === "function";

  for (const body of world.bodies.values()) {
    if (!body || !body._actor) continue;
    if (body.simMode === "static") continue;

    const actor = body._actor;

    if (hasIsSleeping && typeof actor.isSleeping === "function") {
      try {
        if (actor.isSleeping()) continue;
      } catch (_) {}
    }

    _readbackBody(body, actor, !world._poseReadback);
  }
}

/**
 * Read position, rotation, linear & angular velocity from a PhysX actor into a body object.
 */
function _readbackBody(body, actor, readPose = true) {
  try {
    if (readPose) {
      const pose = typeof actor.getGlobalPose === "function" ? actor.getGlobalPose() : null;
      if (!pose) return;

      const position = typeof pose.get_p === "function" ? pose.get_p() : null;
      if (position) {
        body.position[0] = safeNumber(position.get_x(), body.position[0]);
        body.position[1] = safeNumber(position.get_y(), body.position[1]);
        body.position[2] = safeNumber(position.get_z(), body.position[2]);
      }

      if (body.rotation && body.rotation.length >= 4 && typeof pose.get_q === "function") {
        const rotation = pose.get_q();
        if (rotation) {
          body.rotation[0] = safeNumber(rotation.get_x(), body.rotation[0]);
          body.rotation[1] = safeNumber(rotation.get_y(), body.rotation[1]);
          body.rotation[2] = safeNumber(rotation.get_z(), body.rotation[2]);
          body.rotation[3] = safeNumber(rotation.get_w(), body.rotation[3]);
        }
      }

    }
    if (body.linearVelocity && body.linearVelocity.length >= 3 &&
        typeof actor.getLinearVelocity === "function") {
      const linearVelocity = actor.getLinearVelocity();
      if (linearVelocity) {
        const vx = safeNumber(linearVelocity.get_x(), body.linearVelocity[0]);
        const vy = safeNumber(linearVelocity.get_y(), body.linearVelocity[1]);
        const vz = safeNumber(linearVelocity.get_z(), body.linearVelocity[2]);
        body.linearVelocity[0] = vx;
        body.linearVelocity[1] = vy;
        body.linearVelocity[2] = vz;
        if (body.velocity && body.velocity.length >= 3) {
          body.velocity[0] = vx;
          body.velocity[1] = vy;
          body.velocity[2] = vz;
        }
      }
    }

    if (body.angularVelocity && body.angularVelocity.length >= 3 &&
        typeof actor.getAngularVelocity === "function") {
      const angularVelocity = actor.getAngularVelocity();
      if (angularVelocity) {
        body.angularVelocity[0] = safeNumber(angularVelocity.get_x(), body.angularVelocity[0]);
        body.angularVelocity[1] = safeNumber(angularVelocity.get_y(), body.angularVelocity[1]);
        body.angularVelocity[2] = safeNumber(angularVelocity.get_z(), body.angularVelocity[2]);
      }
    }
  } catch (_) {}
}

function initializePhysXWorld(world, PhysX) {
  const version = PhysX.PHYSICS_VERSION;

  // Reuse shared foundation if available (PhysX only allows one per process)
  let allocator, errorCallback, foundation;
  if (sharedFoundation && sharedPhysX === PhysX) {
    allocator = sharedAllocator;
    errorCallback = sharedErrorCallback;
    foundation = sharedFoundation;
  } else {
    allocator = new PhysX.PxDefaultAllocator();
    errorCallback = new PhysX.PxDefaultErrorCallback();
    foundation = PhysX.CreateFoundation(version, allocator, errorCallback);
    // Cache for reuse
    sharedAllocator = allocator;
    sharedErrorCallback = errorCallback;
    sharedFoundation = foundation;
    sharedPhysX = PhysX;
  }

  const tolerances = new PhysX.PxTolerancesScale();
  const physics = PhysX.CreatePhysics(version, foundation, tolerances);

  const gravityVec = new PhysX.PxVec3(
    world.gravity[0],
    world.gravity[1],
    world.gravity[2]
  );
  const sceneDesc = new PhysX.PxSceneDesc(tolerances);
  sceneDesc.set_gravity(gravityVec);
  const cpuDispatcher = PhysX.DefaultCpuDispatcherCreate(0);
  sceneDesc.set_cpuDispatcher(cpuDispatcher);
  // Use PassThroughFilterShader so that pair flags stored in filterData.word2
  // (including eNOTIFY_TOUCH_FOUND) are actually applied to contact pairs.
  // DefaultFilterShader ignores word2 and never requests contact notifications,
  // which means the onContact callback never fires.
  if (PhysX.PassThroughFilterShaderImpl && PhysX.setupPassThroughFilterShader) {
    const filterShaderImpl = new PhysX.PassThroughFilterShaderImpl();
    world._filterShaderCallCount = 0;
    world._filterShaderSuppressCount = 0;
    world._filterShaderPassCount = 0;
    world._onContactCallCount = 0;
    world._onContactPairCount = 0;
    filterShaderImpl.filterShader = function (
      attributes0, fd0w0, fd0w1, fd0w2, fd0w3,
      attributes1, fd1w0, fd1w1, fd1w2, fd1w3
    ) {
      world._filterShaderCallCount++;
      // Check triggers
      const PxFilterObjectType_eTRIGGER = 1 << 4; // 16
      if ((attributes0 & PxFilterObjectType_eTRIGGER) || (attributes1 & PxFilterObjectType_eTRIGGER)) {
        filterShaderImpl.outputPairFlags =
          (PhysX.PxPairFlagEnum?.eNOTIFY_TOUCH_FOUND || 4) |
          (PhysX.PxPairFlagEnum?.eNOTIFY_TOUCH_LOST || 16) |
          (PhysX.PxPairFlagEnum?.eDETECT_DISCRETE_CONTACT || 512);
        return 0; // eDefault
      }

      // Check collision layer masking: word0 is group, word1 is mask
      if ((fd0w0 & fd1w1) === 0 && (fd1w0 & fd0w1) === 0) {
        world._filterShaderSuppressCount++;
        return 2; // eSUPPRESS
      }

      // Pass through pair flags from word2 of both filter datas (OR them together)
      const pairFlags = fd0w2 | fd1w2;
      filterShaderImpl.outputPairFlags = pairFlags;
      world._filterShaderPassCount++;
      // Log first few passes with details
      if (world._filterShaderPassCount <= 5) {
        console.log(`[PHYSX:FilterShader] PASS #${world._filterShaderPassCount} w2=[${fd0w2},${fd1w2}] pairFlags=0x${pairFlags.toString(16)} attrs=[${attributes0},${attributes1}]`);
      }
      return 0; // eDefault
    };
    PhysX.setupPassThroughFilterShader(sceneDesc, filterShaderImpl);
    world._filterShaderImpl = filterShaderImpl; // prevent GC
    console.log('[PHYSX] PassThroughFilterShader installed (contact notifications enabled)');
  } else {
    sceneDesc.set_filterShader(PhysX.DefaultFilterShader());
    console.warn('[PHYSX] PassThroughFilterShader not available — contact events will NOT fire');
  }
  
  // Enable TGS (Temporal Gauss-Seidel) solver - NVIDIA recommended over PGS
  // TGS benefits: Better convergence, handles high mass ratios, better joint accuracy
  // TGS subdivides timestep into substeps (1 per position iteration) for stability
  if (PhysX.PxSolverTypeEnum && typeof PhysX.PxSolverTypeEnum.eTGS !== "undefined") {
    try {
      sceneDesc.set_solverType(PhysX.PxSolverTypeEnum.eTGS);
      console.log("[PHYSX] Using TGS solver (recommended)");
    } catch (e) {
      console.warn("[PHYSX] Failed to enable TGS solver, using PGS fallback");
    }
  }
  
  if (PhysX.PxSceneFlags && PhysX.PxSceneFlagEnum) {
    try {
      const sceneFlags = new PhysX.PxSceneFlags(0);
      if (typeof PhysX.PxSceneFlagEnum.eENABLE_PCM !== "undefined") {
        sceneFlags.raise(PhysX.PxSceneFlagEnum.eENABLE_PCM);
      }
      if (typeof PhysX.PxSceneFlagEnum.eENABLE_STABILIZATION !== "undefined") {
        sceneFlags.raise(PhysX.PxSceneFlagEnum.eENABLE_STABILIZATION);
      }
      // Enable CCD at scene level to prevent fast-moving objects from tunneling
      if (typeof PhysX.PxSceneFlagEnum.eENABLE_CCD !== "undefined") {
        sceneFlags.raise(PhysX.PxSceneFlagEnum.eENABLE_CCD);
      }
      // Skip CCD resweep — saves a broadphase pass per CCD iteration
      if (typeof PhysX.PxSceneFlagEnum.eDISABLE_CCD_RESWEEP !== "undefined") {
        sceneFlags.raise(PhysX.PxSceneFlagEnum.eDISABLE_CCD_RESWEEP);
      }
      // Enable active actors list for efficient readback (only read bodies that moved)
      if (typeof PhysX.PxSceneFlagEnum.eENABLE_ACTIVE_ACTORS !== "undefined") {
        sceneFlags.raise(PhysX.PxSceneFlagEnum.eENABLE_ACTIVE_ACTORS);
      }
      sceneDesc.set_flags(sceneFlags);
      PhysX.destroy(sceneFlags);
    } catch (_) {}
  }
  
  const scene = physics.createScene(sceneDesc);

  // Configure CCD settings on the scene for better tunneling prevention
  // ccdMaxPasses: Number of CCD passes (default 1). Higher = more accurate but slower
  // Per NVIDIA docs: Increasing allows multiple collision resolutions per frame
  if (scene && typeof scene.setCCDMaxPasses === "function") {
    try {
      scene.setCCDMaxPasses(2); // Allow 2 CCD passes for better accuracy
    } catch (_) {}
  }
  
  // Set friction offset threshold for more stable friction behavior
  // Per NVIDIA docs: Helps with unstable contact configurations
  if (scene && typeof scene.setFrictionOffsetThreshold === "function") {
    try {
      scene.setFrictionOffsetThreshold(0.04);
    } catch (_) {}
  }

  const staticFriction = resolvePositive(world.materialStaticFriction, 0.5);
  const dynamicFriction = resolvePositive(world.materialDynamicFriction, 0.5);
  const restitution = resolvePositive(world.materialRestitution, 0.5);
  const material = physics.createMaterial(
    staticFriction,
    dynamicFriction,
    restitution,
  );
  const shapeFlags = new PhysX.PxShapeFlags(
    PhysX.PxShapeFlagEnum.eSIMULATION_SHAPE |
      PhysX.PxShapeFlagEnum.eVISUALIZATION
  );
  const shapeFlagsWithQuery = new PhysX.PxShapeFlags(
    PhysX.PxShapeFlagEnum.eSCENE_QUERY_SHAPE |
      PhysX.PxShapeFlagEnum.eSIMULATION_SHAPE |
      PhysX.PxShapeFlagEnum.eVISUALIZATION
  );
  // Filter data: word0=collision group, word1=collision mask, word2=pair flags for contact notifications
  // Enable contact notifications and CCD detection for fast-moving objects
  const pairFlags = (PhysX.PxPairFlagEnum?.eNOTIFY_TOUCH_FOUND || 4) | 
                    (PhysX.PxPairFlagEnum?.eSOLVE_CONTACT || 1) |
                    (PhysX.PxPairFlagEnum?.eDETECT_DISCRETE_CONTACT || 1024) |
                    (PhysX.PxPairFlagEnum?.eDETECT_CCD_CONTACT || 2048) |
                    (PhysX.PxPairFlagEnum?.eNOTIFY_CONTACT_POINTS || 512); // Required for extractContacts impulse data
  const filterData = new PhysX.PxFilterData(1, 1, pairFlags, 0);

  try {
    PhysX.destroy(sceneDesc);
  } catch (error) {
    console.error("PhysXPhysicsWorld: error destroying sceneDesc", error);
  }
  try {
    PhysX.destroy(gravityVec);
  } catch (error) {
    console.error("PhysXPhysicsWorld: error destroying gravityVec", error);
  }

  world.module = PhysX;
  world.version = version;
  world.allocator = allocator;
  world.errorCallback = errorCallback;
  world.foundation = foundation;
  world.tolerances = tolerances;
  world.physics = physics;
  world.scene = scene;
  world.defaultMaterial = material;
  world.shapeFlags = shapeFlags;
  world.shapeFlagsWithQuery = shapeFlagsWithQuery;
  world.filterData = filterData;
  world.cpuDispatcher = cpuDispatcher;
  if (
    PhysX.PxSimulationEventCallbackImpl &&
    typeof scene.setSimulationEventCallback === "function" &&
    PhysX.NativeArrayHelpers &&
    PhysX.NativeArrayHelpers.prototype
  ) {
    const callback = new PhysX.PxSimulationEventCallbackImpl();
    const helpers = PhysX.NativeArrayHelpers.prototype;

    // Pre-allocate contact point extraction buffer (reused across frames)
    let _contactPointBuf = null;
    const _MAX_EXTRACT = 8;
    try {
      if (PhysX.PxArray_PxContactPairPoint) {
        _contactPointBuf = new PhysX.PxArray_PxContactPairPoint(_MAX_EXTRACT);
      }
    } catch (_) {}
    console.log(`[PHYSX] Contact point buffer: ${_contactPointBuf ? 'OK' : 'NULL (no impulse data will be available)'} PxArray_PxContactPairPoint=${typeof PhysX.PxArray_PxContactPairPoint}`);

    // Resolve entity ID from a WASM actor object.
    // WASM callback actors are different JS wrapper objects than the originals,
    // so .userData (set on the original) won't survive. In webidl bindings,
    // .userData may return a void* wrapper (object) instead of the stored value.
    // Always prefer the stable ptr → entityId map; fall back to userData only
    // if it's a valid entity ID type (number).
    function _resolveEntityFromActor(actor) {
      if (!actor) return null;
      // 1. Stable ptr map (most reliable — works across wrapper objects)
      const ptr = (actor.$$ && actor.$$.ptr) ?? actor.ptr;
      if (ptr != null) {
        const eid = world._actorPtrToEntityId.get(ptr);
        if (eid != null) return eid;
      }
      // 2. Direct userData (only if it's a number — WASM webidl often returns
      //    a void* wrapper object here instead of the stored value)
      if (typeof actor.userData === 'number') return actor.userData;
      return null;
    }

    callback.onContact = function (pairHeader, pairs, nbPairs) {
      world._onContactCallCount++;
      if (!world.contactEvents || !helpers || !helpers.getContactPairAt) {
        return;
      }

      // pairHeader may be a raw WASM pointer (Number) in webidl bindings,
      // not a wrapped JS object. Wrap it if wrapPointer is available.
      let header = pairHeader;
      if (typeof pairHeader === 'number' && PhysX.wrapPointer && PhysX.PxContactPairHeader) {
        try { header = PhysX.wrapPointer(pairHeader, PhysX.PxContactPairHeader); } catch (_) {}
      }

      // Resolve actors from the (possibly wrapped) header.
      // PhysX WASM exposes C-style fixed arrays via various patterns depending
      // on the binding flavour (embind vs webidl).
      let actor0 = null, actor1 = null;
      if (header && typeof header === 'object') {
        if (typeof header.get_actors === 'function') {
          try { actor0 = header.get_actors(0); } catch (_) {}
          try { actor1 = header.get_actors(1); } catch (_) {}
        }
        if (!actor0 && header.actors) {
          const a = header.actors;
          if (typeof a.get === 'function') {
            try { actor0 = a.get(0); actor1 = a.get(1); } catch (_) {}
          } else if (typeof a.at === 'function') {
            try { actor0 = a.at(0); actor1 = a.at(1); } catch (_) {}
          } else {
            actor0 = a[0]; actor1 = a[1];
          }
        }
        if (!actor0 && header.actors_0 !== undefined) {
          actor0 = header.actors_0;
          actor1 = header.actors_1;
        }
      }

      let entityA = _resolveEntityFromActor(actor0);
      let entityB = _resolveEntityFromActor(actor1);

      // Diagnostic: log resolution details for first few contacts
      if (world._onContactCallCount <= 3) {
        const ptrMapSize = world._actorPtrToEntityId.size;
        const a0ptr = actor0 ? ((actor0.$$ && actor0.$$.ptr) ?? actor0.ptr) : null;
        const a1ptr = actor1 ? ((actor1.$$ && actor1.$$.ptr) ?? actor1.ptr) : null;
        console.log(`[PHYSX:onContact] #${world._onContactCallCount} nbPairs=${nbPairs} headerType=${typeof pairHeader} wrapped=${header !== pairHeader} actor0=${!!actor0}(ptr=${a0ptr}) actor1=${!!actor1}(ptr=${a1ptr}) eA=${entityA} eB=${entityB} ptrMap.size=${ptrMapSize}`);
      }

      for (let i = 0; i < nbPairs; i++) {
        const pair = helpers.getContactPairAt(pairs, i);
        if (!pair) {
          continue;
        }
        const contactCount =
          typeof pair.contactCount === "number" ? pair.contactCount : 0;
        world._onContactPairCount++;

        // Shape-based actor fallback: if header actors failed, try
        // getting actors from pair shapes → shape.getActor()
        let pairEntityA = entityA, pairEntityB = entityB;
        if (pairEntityA == null || pairEntityB == null) {
          try {
            for (let si = 0; si < 2; si++) {
              let shape = null;
              if (typeof pair.get_shapes === 'function') {
                shape = pair.get_shapes(si);
              } else if (pair.shapes) {
                const s = pair.shapes;
                if (typeof s.get === 'function') shape = s.get(si);
                else if (typeof s.at === 'function') shape = s.at(si);
                else shape = s[si];
              }
              if (!shape) continue;
              const shapeActor = typeof shape.getActor === 'function' ? shape.getActor() : null;
              const eid = _resolveEntityFromActor(shapeActor);
              if (si === 0 && pairEntityA == null) pairEntityA = eid;
              if (si === 1 && pairEntityB == null) pairEntityB = eid;
            }
          } catch (_) {}
        }

        // Extract actual contact points if buffer available
        let contactPoints = null;
        if (_contactPointBuf && contactCount > 0 && typeof pair.extractContacts === "function") {
          try {
            const buf = _contactPointBuf.begin();
            const n = pair.extractContacts(buf, Math.min(contactCount, _MAX_EXTRACT));
            if (n > 0) {
              contactPoints = [];
              for (let j = 0; j < n; j++) {
                const pt = _contactPointBuf.get(j);
                if (pt) {
                  const pos = pt.position;
                  const nrm = pt.normal;
                  const imp = pt.impulse;
                  contactPoints.push({
                    position: pos ? [pos.x, pos.y, pos.z] : null,
                    normal:   nrm ? [nrm.x, nrm.y, nrm.z] : null,
                    impulse:  imp ? [imp.x, imp.y, imp.z] : null,
                    separation: pt.separation || 0,
                  });
                }
              }
            }
          } catch (_) {
            // Extraction not supported — fall back to basic event
          }
        }

        world.contactEvents.push({
          entityA: pairEntityA,
          entityB: pairEntityB,
          contactCount,
          contactPoints,
        });
      }
    };

    callback.onTrigger = function (pairs, count) {
      if (!world.triggerEvents || !helpers || !helpers.getTriggerPairAt) {
        return;
      }

      for (let i = 0; i < count; i++) {
        const pair = helpers.getTriggerPairAt(pairs, i);
        if (!pair) {
          continue;
        }

        const triggerActor = pair.triggerActor;
        const otherActor = pair.otherActor;
        let triggerEntity =
          triggerActor && triggerActor.userData !== undefined
            ? triggerActor.userData
            : null;
        if (triggerEntity == null && triggerActor) {
          const ptr = (triggerActor.$$ && triggerActor.$$.ptr) ?? triggerActor.ptr;
          if (ptr != null) triggerEntity = world._actorPtrToEntityId.get(ptr) ?? null;
        }
        let otherEntity =
          otherActor && otherActor.userData !== undefined
            ? otherActor.userData
            : null;
        if (otherEntity == null && otherActor) {
          const ptr = (otherActor.$$ && otherActor.$$.ptr) ?? otherActor.ptr;
          if (ptr != null) otherEntity = world._actorPtrToEntityId.get(ptr) ?? null;
        }

        world.triggerEvents.push({
          triggerEntity,
          otherEntity,
        });
      }
    };

    scene.setSimulationEventCallback(callback);
    world._simulationEventCallback = callback;
  }

  ensureStandardColliderMeshes(world);

  world.ready = true;
}

function tryCreateActorForBody(world, body) {
  if (!world.ready || !world.module || !world.physics || !world.scene) {
    return;
  }
  if (body._actor) {
    return;
  }

  const PhysX = world.module;
  const physics = world.physics;
  const scene = world.scene;

  const pxPosition = new PhysX.PxVec3(
    body.position[0],
    body.position[1],
    body.position[2]
  );
  const pose = new PhysX.PxTransform(PhysX.PxIDENTITYEnum.PxIdentity);
  pose.set_p(pxPosition);

  let pxQuat = null;

  const shapeKind = body.colliderShape || "box";
  let geometry = null;
  const wantsMeshCollider =
    body.colliderMeshType === "convexMesh" ||
    body.colliderMeshType === "triangleMesh";

  const deferredDestroy = [];

  // If a mesh collider type + id is present and a cooked mesh is registered,
  // prefer that over primitive geometry.
  if (wantsMeshCollider) {
    const meshId = body.colliderMeshId || null;
    if (!meshId) {
      try {
        PhysX.destroy(pxPosition);
      } catch (_) {}
      try {
        PhysX.destroy(pose);
      } catch (_) {}
      try {
        const payload = JSON.stringify({
          handle: body.handle,
          colliderMeshType: body.colliderMeshType || null,
          colliderMeshId: body.colliderMeshId || null,
        });
        console.error("[PHYSX] Mesh collider requested but no meshId provided", payload);
      } catch (_) {
        console.error("[PHYSX] Mesh collider requested but no meshId provided");
      }
      return;
    }

    // On-the-fly convex mesh cooking: if vertices are provided and mesh isn't cooked yet
    if (body.colliderMeshType === "convexMesh" && 
        body.colliderVertices && 
        world.convexMeshes && 
        !world.convexMeshes.has(meshId)) {
      try {
        const mesh = cookAndRegisterConvexMeshForWorld(world, meshId, body.colliderVertices);
        if (mesh) {
          console.log(`[PHYSX] Cooked convex mesh on-the-fly: ${meshId}`);
        }
      } catch (e) {
        console.warn(`[PHYSX] Failed to cook convex mesh ${meshId}:`, e);
      }
    }

    if (body.colliderMeshType === "convexMesh" && world.convexMeshes) {
      const convex = world.convexMeshes.get(meshId) || null;
      if (convex) {
        const baseHe = getStandardColliderBaseHalfExtents(meshId);
        const he = Array.isArray(body.colliderHalfExtents)
          ? body.colliderHalfExtents
          : null;

        if (baseHe && he) {
          const bx = safeNumber(baseHe[0], 0.0);
          const by = safeNumber(baseHe[1], 0.0);
          const bz = safeNumber(baseHe[2], 0.0);
          const hx = safeNumber(he[0], bx || 1.0);
          const hy = safeNumber(he[1], by || 1.0);
          const hz = safeNumber(he[2], bz || 1.0);

          const sx = bx !== 0 ? hx / bx : 1.0;
          const sy = by !== 0 ? hy / by : 1.0;
          const sz = bz !== 0 ? hz / bz : 1.0;

          const scaleEps = 1e-4;
          const needsScale =
            Math.abs(sx - 1.0) > scaleEps ||
            Math.abs(sy - 1.0) > scaleEps ||
            Math.abs(sz - 1.0) > scaleEps;

          if (needsScale && PhysX.PxMeshScale && PhysX.PxVec3 && PhysX.PxQuat) {
            const scaleVec = new PhysX.PxVec3(sx, sy, sz);
            const scaleRot = new PhysX.PxQuat(0, 0, 0, 1);
            const meshScale = new PhysX.PxMeshScale(scaleVec, scaleRot);
            if (PhysX.PxConvexMeshGeometryFlags && PhysX.PxConvexMeshGeometryFlagEnum) {
              try {
                const flags = new PhysX.PxConvexMeshGeometryFlags(0);
                if (typeof PhysX.PxConvexMeshGeometryFlagEnum.eTIGHT_BOUNDS !== "undefined") {
                  flags.raise(PhysX.PxConvexMeshGeometryFlagEnum.eTIGHT_BOUNDS);
                }
                geometry = new PhysX.PxConvexMeshGeometry(convex, meshScale, flags);
                deferredDestroy.push(flags);
              } catch (_) {
                geometry = new PhysX.PxConvexMeshGeometry(convex, meshScale);
              }
            } else {
              geometry = new PhysX.PxConvexMeshGeometry(convex, meshScale);
            }
            deferredDestroy.push(meshScale, scaleVec, scaleRot);
          } else {
            if (PhysX.PxConvexMeshGeometryFlags && PhysX.PxConvexMeshGeometryFlagEnum) {
              try {
                const flags = new PhysX.PxConvexMeshGeometryFlags(0);
                if (typeof PhysX.PxConvexMeshGeometryFlagEnum.eTIGHT_BOUNDS !== "undefined") {
                  flags.raise(PhysX.PxConvexMeshGeometryFlagEnum.eTIGHT_BOUNDS);
                }
                geometry = new PhysX.PxConvexMeshGeometry(convex, undefined, flags);
                deferredDestroy.push(flags);
              } catch (_) {
                geometry = new PhysX.PxConvexMeshGeometry(convex);
              }
            } else {
              geometry = new PhysX.PxConvexMeshGeometry(convex);
            }
          }
        } else {
          if (PhysX.PxConvexMeshGeometryFlags && PhysX.PxConvexMeshGeometryFlagEnum) {
            try {
              const flags = new PhysX.PxConvexMeshGeometryFlags(0);
              if (typeof PhysX.PxConvexMeshGeometryFlagEnum.eTIGHT_BOUNDS !== "undefined") {
                flags.raise(PhysX.PxConvexMeshGeometryFlagEnum.eTIGHT_BOUNDS);
              }
              geometry = new PhysX.PxConvexMeshGeometry(convex, undefined, flags);
              deferredDestroy.push(flags);
            } catch (_) {
              geometry = new PhysX.PxConvexMeshGeometry(convex);
            }
          } else {
            geometry = new PhysX.PxConvexMeshGeometry(convex);
          }
        }
      }
    } else if (body.colliderMeshType === "triangleMesh" && world.triangleMeshes) {
      const tri = world.triangleMeshes.get(meshId) || null;
      if (tri) {
        const scale = Array.isArray(body.colliderHalfExtents) ? body.colliderHalfExtents : null;
        const hasScale =
          scale &&
          scale.length >= 3 &&
          (Math.abs(safeNumber(scale[0], 1) - 1) > 1e-6 ||
            Math.abs(safeNumber(scale[1], 1) - 1) > 1e-6 ||
            Math.abs(safeNumber(scale[2], 1) - 1) > 1e-6);

        let meshScale = null;
        if (hasScale && PhysX.PxMeshScale && PhysX.PxVec3 && PhysX.PxQuat) {
          try {
            const sx = safeNumber(scale[0], 1);
            const sy = safeNumber(scale[1], 1);
            const sz = safeNumber(scale[2], 1);
            const scaleVec = new PhysX.PxVec3(sx, sy, sz);
            const scaleRot = new PhysX.PxQuat(0, 0, 0, 1);
            meshScale = new PhysX.PxMeshScale(scaleVec, scaleRot);
            deferredDestroy.push(scaleVec, scaleRot);
          } catch (_) {
            meshScale = null;
          }
        }

        if (PhysX.PxMeshGeometryFlags && PhysX.PxMeshGeometryFlagEnum) {
          try {
            const flags = new PhysX.PxMeshGeometryFlags(0);
            if (typeof PhysX.PxMeshGeometryFlagEnum.eDOUBLE_SIDED !== "undefined") {
              flags.raise(PhysX.PxMeshGeometryFlagEnum.eDOUBLE_SIDED);
            }
            geometry = new PhysX.PxTriangleMeshGeometry(tri, meshScale || undefined, flags);
            deferredDestroy.push(flags);
          } catch (_) {
            geometry = new PhysX.PxTriangleMeshGeometry(tri, meshScale || undefined);
          }
        } else {
          geometry = new PhysX.PxTriangleMeshGeometry(tri, meshScale || undefined);
        }

        if (meshScale) {
          deferredDestroy.push(meshScale);
        }
      }
    }

    if (!geometry) {
      try {
        PhysX.destroy(pxPosition);
      } catch (_) {}
      try {
        PhysX.destroy(pose);
      } catch (_) {}
      try {
        const payload = JSON.stringify({
          handle: body.handle,
          colliderMeshType: body.colliderMeshType || null,
          colliderMeshId: body.colliderMeshId || null,
        });
        console.error("[PHYSX] Missing cooked mesh for collider", payload);
      } catch (_) {
        console.error("[PHYSX] Missing cooked mesh for collider");
      }
      return;
    }
  }

  // Fallback to primitive geometry only when no mesh collider is requested.
  if (!geometry && !wantsMeshCollider) {
    if (shapeKind === "sphere") {
      const radius = body.colliderRadius || 0.5;
      geometry = new PhysX.PxSphereGeometry(radius);
    } else if (shapeKind === "capsule") {
      const radius = body.colliderRadius || 0.5;
      const halfHeight = body.colliderHalfHeight ?? 0.5;
      geometry = new PhysX.PxCapsuleGeometry(radius, halfHeight);
    } else {
      const he = Array.isArray(body.colliderHalfExtents)
        ? body.colliderHalfExtents
        : [0.5, 0.5, 0.5];
      geometry = new PhysX.PxBoxGeometry(
        safeNumber(he[0], 0.5),
        safeNumber(he[1], 0.5),
        safeNumber(he[2], 0.5)
      );
    }
  }

  if (!geometry) {
    try {
      PhysX.destroy(pxPosition);
    } catch (_) {}
    try {
      PhysX.destroy(pose);
    } catch (_) {}
    try {
      const payload = JSON.stringify({
        handle: body.handle,
        colliderShape: body.colliderShape || null,
        colliderMeshType: body.colliderMeshType || null,
        colliderMeshId: body.colliderMeshId || null,
      });
      console.error("[PHYSX] Failed to create collider geometry for body", payload);
    } catch (_) {
      console.error("[PHYSX] Failed to create collider geometry for body");
    }
    return;
  }

  const isTrigger = body.colliderIsTrigger || false;
  const shapeFlags = isTrigger
    ? new PhysX.PxShapeFlags(
        PhysX.PxShapeFlagEnum.eSCENE_QUERY_SHAPE |
          PhysX.PxShapeFlagEnum.eTRIGGER_SHAPE
      )
    // Solid collision modes are also scene-query targets. This is required by
    // raycasts, character grounding, and Vehicle2 suspension road queries.
    : (world.shapeFlagsWithQuery || world.shapeFlags);

  // Debug: log what collider geometry we ended up creating for this body.
  try {
    const debugInfo = {
      handle: body.handle,
      simMode: body.simMode,
      colliderShape: body.colliderShape,
      colliderHalfExtents: body.colliderHalfExtents,
      colliderRadius: body.colliderRadius,
      colliderHalfHeight: body.colliderHalfHeight,
      colliderMeshType: body.colliderMeshType || null,
      colliderMeshId: body.colliderMeshId || null,
      geometryType:
        geometry instanceof PhysX.PxConvexMeshGeometry
          ? "convexMesh"
          : geometry instanceof PhysX.PxTriangleMeshGeometry
          ? "triangleMesh"
          : geometry instanceof PhysX.PxSphereGeometry
          ? "sphere"
          : geometry instanceof PhysX.PxCapsuleGeometry
          ? "capsule"
          : geometry instanceof PhysX.PxBoxGeometry
          ? "box"
          : "unknown",
    };
    // HtmlConsole joins console.debug args into a single string, so stringify
    // the object explicitly to avoid "[object Object]" spam.
    const payload = JSON.stringify(debugInfo);
    if (console.debug) {
      console.debug("[PHYSX] Created collider geometry", payload);
    }
  } catch (_) {
    // Debug only; ignore any logging errors.
  }

  let shapeMaterial = world.defaultMaterial;
  if (body.colliderMaterial && body.colliderMaterial.staticFriction !== null) {
    try {
      const sf = body.colliderMaterial.staticFriction !== null ? body.colliderMaterial.staticFriction : 0.5;
      const df = body.colliderMaterial.dynamicFriction !== null ? body.colliderMaterial.dynamicFriction : 0.5;
      const r = body.colliderMaterial.restitution !== null ? body.colliderMaterial.restitution : 0.5;
      shapeMaterial = physics.createMaterial(sf, df, r);
    } catch (_) {
      shapeMaterial = world.defaultMaterial;
    }
  }

  const shape = physics.createShape(
    geometry,
    shapeMaterial,
    true,
    shapeFlags
  );

  // Contact offset: distance at which contacts start generating
  // Keep at default 0.02 to avoid generating phantom contacts that push objects apart
  // NOTE: Previously increased to 0.04 but this caused aggressive depenetration
  if (shape && typeof shape.setContactOffset === "function") {
    try {
      shape.setContactOffset(0.02); // PhysX default - avoids aggressive push-out
    } catch (_) {}
  }
  // Rest offset: objects rest this distance apart (0 = touching)
  if (shape && typeof shape.setRestOffset === "function") {
    try {
      shape.setRestOffset(0.0); // Zero means shapes touch at rest, no gap
    } catch (_) {}
  }

  if (shapeMaterial !== world.defaultMaterial && shapeMaterial) {
    try {
      shapeMaterial.release();
    } catch (_) {}
  }

  if (
    shape &&
    body.colliderLocalOffset &&
    body.colliderLocalOffset.length >= 3 &&
    (Math.abs(body.colliderLocalOffset[0]) > 1e-6 ||
      Math.abs(body.colliderLocalOffset[1]) > 1e-6 ||
      Math.abs(body.colliderLocalOffset[2]) > 1e-6) &&
    typeof shape.setLocalPose === "function" &&
    PhysX.PxTransform &&
    PhysX.PxVec3
  ) {
    let localPose = null;
    let offsetVec = null;
    try {
      offsetVec = new PhysX.PxVec3(
        body.colliderLocalOffset[0],
        body.colliderLocalOffset[1],
        body.colliderLocalOffset[2]
      );
      localPose = new PhysX.PxTransform(PhysX.PxIDENTITYEnum.PxIdentity);
      localPose.set_p(offsetVec);
      shape.setLocalPose(localPose);
    } catch (_) {
    } finally {
      try { if (offsetVec) PhysX.destroy(offsetVec); } catch (_) {}
      try { if (localPose) PhysX.destroy(localPose); } catch (_) {}
    }
  }

  if (deferredDestroy.length) {
    for (let i = 0; i < deferredDestroy.length; i++) {
      try {
        PhysX.destroy(deferredDestroy[i]);
      } catch (_) {}
    }
  }

  const isStatic = body.simMode === "static";

  try {
    const rot = body.rotation;
    pxQuat = new PhysX.PxQuat(rot[0], rot[1], rot[2], rot[3]);
    pose.set_q(pxQuat);
  } catch (_) {}

  const actor = isStatic
    ? physics.createRigidStatic(pose)
    : physics.createRigidDynamic(pose);

  // Set kinematic flag if requested (only for non-static actors)
  if (!isStatic && body.simMode === "kinematic") {
    actor.setRigidBodyFlag(PhysX.PxRigidBodyFlagEnum.eKINEMATIC, true);
  }

  // Enable CCD for dynamic bodies to prevent tunneling at high speeds
  // Default to true for all dynamic bodies unless explicitly disabled
  if (!isStatic && body.simMode !== "kinematic") {
    const enableCCD = body.ccdEnabled !== false; // Default true if not specified
    if (enableCCD && typeof PhysX.PxRigidBodyFlagEnum.eENABLE_CCD !== "undefined") {
      try {
        actor.setRigidBodyFlag(PhysX.PxRigidBodyFlagEnum.eENABLE_CCD, true);
      } catch (_) {}
    }
    // Also enable speculative CCD as additional safeguard for very fast objects
    // Per NVIDIA docs: Speculative CCD catches fast angular motion that sweep-based CCD misses
    if (enableCCD && typeof PhysX.PxRigidBodyFlagEnum.eENABLE_SPECULATIVE_CCD !== "undefined") {
      try {
        actor.setRigidBodyFlag(PhysX.PxRigidBodyFlagEnum.eENABLE_SPECULATIVE_CCD, true);
      } catch (_) {}
    }
    // Set minCCDAdvanceCoefficient to reduce clipping at frame boundaries
    // Per NVIDIA docs: Default 0.15, lower = less clipping but less fluid motion
    // Using 0.1 for better anti-tunneling with minimal visual impact
    if (enableCCD && typeof actor.setMinCCDAdvanceCoefficient === "function") {
      try {
        actor.setMinCCDAdvanceCoefficient(0.1);
      } catch (_) {}
    }
    // Limit max depenetration velocity to prevent objects from being pushed apart too aggressively
    // Default is FLT_MAX which can cause objects to fly apart when overlapping
    // Setting to 2.0 m/s provides stable separation without explosive behavior
    if (typeof actor.setMaxDepenetrationVelocity === "function") {
      try {
        actor.setMaxDepenetrationVelocity(2.0);
      } catch (_) {}
    }
  }

  if (!isStatic) {
    if (typeof body.linearDamping === "number" && Number.isFinite(body.linearDamping) && typeof actor.setLinearDamping === "function") {
      try { actor.setLinearDamping(body.linearDamping); } catch (_) {}
    }
    if (typeof body.angularDamping === "number" && Number.isFinite(body.angularDamping) && typeof actor.setAngularDamping === "function") {
      try { actor.setAngularDamping(body.angularDamping); } catch (_) {}
    }
    // Increase max angular velocity for realistic spinning
    // Default PhysX 3.x was 7.0 (unrealistically slow), PhysX 4.0+ uses 100.0
    if (typeof actor.setMaxAngularVelocity === "function") {
      try { actor.setMaxAngularVelocity(50.0); } catch (_) {} // Allow fast spinning
    }
    // Sleep threshold: when a body's kinetic energy falls below this, it goes to sleep.
    // PhysX default is 0.05. We use 0.005 so bodies in precarious balance (ragdolls
    // teetering, objects on edges) stay awake long enough to topple naturally.
    if (typeof actor.setSleepThreshold === "function") {
      try { actor.setSleepThreshold(0.005); } catch (_) {}
    }
    // Stabilization threshold: helps piles/stacks converge to sleep faster.
    // Only effective with eENABLE_STABILIZATION scene flag (which we enable).
    // Keep low (0.01) so near-balanced bodies still get micro-perturbations
    // rather than freezing in unstable poses.
    if (typeof actor.setStabilizationThreshold === "function") {
      try { actor.setStabilizationThreshold(0.01); } catch (_) {}
    }
  }

  if (body.entityId !== null && body.entityId !== undefined) {
    actor.userData = body.entityId;
    // Store stable ptr → entityId mapping for contact callback resolution.
    // WASM wrapper objects in contact callbacks are different JS objects than
    // the original actor, so .userData won't survive — use ptr as stable key.
    // Check both embind ($$.ptr) and webidl (.ptr) pointer patterns.
    const ptr = (actor.$$ && actor.$$.ptr) ?? actor.ptr;
    if (ptr != null) {
      world._actorPtrToEntityId.set(ptr, body.entityId);
      body._actorPtr = ptr; // cache for cleanup in removeBody
    }
  }

  // Use per-entity filter data if EntityFlags are provided, otherwise use world default
  const entityFilterData = body.entityFlags 
    ? createEntityFilterData(PhysX, body.entityFlags, world.filterData)
    : world.filterData;
  shape.setSimulationFilterData(entityFilterData);
  
  // Clean up per-entity filter data if we created one
  if (body.entityFlags && entityFilterData !== world.filterData) {
    // Note: PxFilterData is a simple struct, may not need explicit destroy
    // but we track it for safety
  }
  
  actor.attachShape(shape);

  // Attach compound collider shapes if present
  if (body.compoundColliders && Array.isArray(body.compoundColliders)) {
    console.log(`[PHYSX] Attaching ${body.compoundColliders.length} compound colliders`);
    for (const cc of body.compoundColliders) {
      try {
        const ccShape = cc.shape || 'box';
        let ccGeometry = null;
        
        if (ccShape === 'box') {
          const he = cc.halfExtents || [0.5, 0.5, 0.5];
          ccGeometry = new PhysX.PxBoxGeometry(he[0], he[1], he[2]);
        } else if (ccShape === 'sphere') {
          ccGeometry = new PhysX.PxSphereGeometry(cc.radius || 0.5);
        } else if (ccShape === 'capsule') {
          ccGeometry = new PhysX.PxCapsuleGeometry(cc.radius || 0.5, cc.halfHeight || 0.5);
        }
        
        if (ccGeometry) {
          const ccPhysShape = physics.createShape(
            ccGeometry,
            world.defaultMaterial,
            true,
            world.shapeFlagsWithQuery || world.shapeFlags,
          );
          if (ccPhysShape) {
            // Set contact offset for compound collider shapes (same as primary shape)
            if (typeof ccPhysShape.setContactOffset === "function") {
              try { ccPhysShape.setContactOffset(0.02); } catch (_) {} // Default to avoid aggressive push-out
            }
            if (typeof ccPhysShape.setRestOffset === "function") {
              try { ccPhysShape.setRestOffset(0.0); } catch (_) {} // Zero gap at rest
            }
            // Set local pose (position and rotation offset)
            if (cc.localOffset || cc.localRotation) {
              const offset = cc.localOffset || [0, 0, 0];
              const rot = cc.localRotation || [0, 0, 0, 1];
              const offsetVec = new PhysX.PxVec3(offset[0], offset[1], offset[2]);
              const rotQuat = new PhysX.PxQuat(rot[0], rot[1], rot[2], rot[3]);
              const localPose = new PhysX.PxTransform(offsetVec, rotQuat);
              ccPhysShape.setLocalPose(localPose);
              PhysX.destroy(offsetVec);
              PhysX.destroy(rotQuat);
              PhysX.destroy(localPose);
            }
            ccPhysShape.setSimulationFilterData(entityFilterData);
            actor.attachShape(ccPhysShape);
            releaseOrDestroy(PhysX, ccPhysShape);
          }
          PhysX.destroy(ccGeometry);
        }
      } catch (e) {
        console.warn('[PHYSX] Failed to create compound collider shape:', e);
      }
    }
  }

  if (!isStatic && PhysX.PxRigidBodyExt) {
    if (typeof body.mass === "number" && Number.isFinite(body.mass) && body.mass > 0) {
      try { PhysX.PxRigidBodyExt.setMassAndUpdateInertia(actor, body.mass); } catch (_) {}
    } else if (typeof body.density === "number" && Number.isFinite(body.density) && body.density > 0) {
      try { PhysX.PxRigidBodyExt.updateMassAndInertia(actor, body.density); } catch (_) {}
    }
    
    if (typeof actor.setSolverIterationCounts === "function") {
      try {
        actor.setSolverIterationCounts(4, 1);
      } catch (_) {}
    }
  }

  if (!isStatic && body.linearVelocity && body.linearVelocity.length >= 3 && typeof actor.setLinearVelocity === "function") {
    let lv = null;
    try {
      lv = new PhysX.PxVec3(body.linearVelocity[0], body.linearVelocity[1], body.linearVelocity[2]);
      actor.setLinearVelocity(lv, true);
    } catch (_) {
    } finally {
      try { if (lv) PhysX.destroy(lv); } catch (_) {}
    }
  }

  if (!isStatic && body.angularVelocity && body.angularVelocity.length >= 3 && typeof actor.setAngularVelocity === "function") {
    let av = null;
    try {
      av = new PhysX.PxVec3(body.angularVelocity[0], body.angularVelocity[1], body.angularVelocity[2]);
      actor.setAngularVelocity(av, true);
    } catch (_) {
    } finally {
      try { if (av) PhysX.destroy(av); } catch (_) {}
    }
  }
  scene.addActor(actor);

  if (isTrigger && shapeFlags && shapeFlags !== world.shapeFlags) {
    try {
      PhysX.destroy(shapeFlags);
    } catch (_) {}
  }
  releaseOrDestroy(PhysX, shape);

  try {
    PhysX.destroy(geometry);
  } catch (error) {
    console.error("PhysXPhysicsWorld: error destroying geometry", error);
  }
  try {
    PhysX.destroy(pxPosition);
  } catch (error) {
    console.error("PhysXPhysicsWorld: error destroying pxPosition", error);
  }
  try {
    if (pxQuat) PhysX.destroy(pxQuat);
  } catch (_) {}
  try {
    PhysX.destroy(pose);
  } catch (error) {
    console.error("PhysXPhysicsWorld: error destroying pose", error);
  }

  body._actor = actor;
  body._actorPtr = PhysX.getPointer(actor);
  world._bodyByActorPtr.set(body._actorPtr, body);
  try {
    world._poseReadback?.add(body);
  } catch (error) {
    removeBody(world, body.handle);
    throw error;
  }
}

function resolveGravity(optionGravity) {
  if (!Array.isArray(optionGravity) || optionGravity.length < 3) {
    return [0, -9.81, 0];
  }
  return [
    safeNumber(optionGravity[0], 0),
    safeNumber(optionGravity[1], -9.81),
    safeNumber(optionGravity[2], 0),
  ];
}

function resolvePositive(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return n;
}

function resolveNonNegative(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return fallback;
  }
  return n;
}

function resolveInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  let i = n | 0;
  if (i < min) {
    i = min;
  } else if (i > max) {
    i = max;
  }
  return i;
}

function makeVec3(input, defaultValue) {
  if (!Array.isArray(input) || input.length < 3) {
    return defaultValue.slice();
  }
  return [
    safeNumber(input[0], defaultValue[0]),
    safeNumber(input[1], defaultValue[1]),
    safeNumber(input[2], defaultValue[2]),
  ];
}

function makeQuat(input, defaultValue) {
  if (!Array.isArray(input) || input.length < 4) {
    return defaultValue.slice();
  }
  const x = safeNumber(input[0], defaultValue[0]);
  const y = safeNumber(input[1], defaultValue[1]);
  const z = safeNumber(input[2], defaultValue[2]);
  const w = safeNumber(input[3], defaultValue[3]);
  const lenSq = x * x + y * y + z * z + w * w;
  if (!Number.isFinite(lenSq) || lenSq === 0) {
    return defaultValue.slice();
  }
  const invLen = 1 / Math.sqrt(lenSq);
  return [x * invLen, y * invLen, z * invLen, w * invLen];
}

function sanitizeSimMode(value) {
  if (value === "static" || value === "kinematic" || value === "dynamic") {
    return value;
  }
  return "dynamic";
}

function safeNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
