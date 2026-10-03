import { createCubeGeometry, createSphereGeometry, createPlaneGeometry, createCylinderGeometry, createConeGeometry, createCapsuleGeometry, createTorusGeometry } from "../../render/geometry/PrimitiveGeometry.js";
import { cookAndRegisterConvexMeshForWorld } from "./PhysXMeshCooking.js";

/**
 * Create a beveled cylinder geometry for physics - chamfered edges prevent tilting on sharp corners
 * @param {number} radius - Cylinder radius
 * @param {number} height - Cylinder height  
 * @param {number} segments - Number of radial segments
 * @param {number} bevelSize - Size of the bevel/chamfer at top and bottom edges
 */
function createBeveledCylinderGeometry(radius = 0.5, height = 1.0, segments = 48, bevelSize = 0.08) {
  const positions = [];
  const halfHeight = height / 2;
  const bevelHeight = bevelSize;
  const bevelInset = bevelSize;
  
  // Create rings of vertices for the beveled cylinder:
  // 1. Bottom center (slightly raised)
  // 2. Bottom bevel ring (inset from edge)
  // 3. Bottom outer ring (at full radius, raised by bevel)
  // 4. Top outer ring (at full radius, lowered by bevel)
  // 5. Top bevel ring (inset from edge)
  // 6. Top center (slightly lowered)
  
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    
    // Bottom center point (small radius at very bottom)
    positions.push(cos * (radius - bevelInset), -halfHeight, sin * (radius - bevelInset));
    
    // Bottom outer ring (full radius but raised by bevel amount)
    positions.push(cos * radius, -halfHeight + bevelHeight, sin * radius);
    
    // Top outer ring (full radius but lowered by bevel amount)
    positions.push(cos * radius, halfHeight - bevelHeight, sin * radius);
    
    // Top center point (small radius at very top)
    positions.push(cos * (radius - bevelInset), halfHeight, sin * (radius - bevelInset));
  }
  
  // Add center points for top and bottom caps
  positions.push(0, -halfHeight, 0);  // Bottom center
  positions.push(0, halfHeight, 0);   // Top center
  
  return { positions };
}

export const StandardColliderMeshIds = {
  UnitCubeConvex: "engine:collider:convex:unit_cube",
  UnitSphereConvex: "engine:collider:convex:unit_sphere",
  UnitCapsuleConvex: "engine:collider:convex:unit_capsule",
  UnitCylinderConvex: "engine:collider:convex:unit_cylinder",
  UnitConeConvex: "engine:collider:convex:unit_cone",
  UnitTorusConvex: "engine:collider:convex:unit_torus",
  Plane3x3Convex: "engine:collider:convex:plane_3x3",
};

export function getStandardColliderBaseHalfExtents(meshId) {
  if (!meshId) {
    return null;
  }
  switch (meshId) {
    case StandardColliderMeshIds.UnitCubeConvex:
      // createCubeGeometry(1) => positions in [-0.5,0.5] so half-extents are [0.5,0.5,0.5]
      return [0.5, 0.5, 0.5];
    case StandardColliderMeshIds.UnitSphereConvex:
      // createSphereGeometry(0.5, ...) => radius 0.5 so half-extents are [0.5,0.5,0.5]
      return [0.5, 0.5, 0.5];
    case StandardColliderMeshIds.UnitCylinderConvex:
      // createCylinderGeometry(0.5, 1) => radius 0.5, height 1 so half-extents are [0.5,0.5,0.5]
      return [0.5, 0.5, 0.5];
    case StandardColliderMeshIds.UnitConeConvex:
      // createConeGeometry(0.5, 1) => radius 0.5, height 1 so half-extents are [0.5,0.5,0.5]
      return [0.5, 0.5, 0.5];
    case StandardColliderMeshIds.UnitCapsuleConvex:
      // createCapsuleGeometry(0.3, 1) => radius 0.3, height 1 so half-extents are [0.3,0.5,0.3]
      return [0.3, 0.5, 0.3];
    case StandardColliderMeshIds.UnitTorusConvex:
      // createTorusGeometry(0.4, 0.15) => major 0.4, minor 0.15 so half-extents are [0.55,0.15,0.55]
      return [0.55, 0.15, 0.55];
    case StandardColliderMeshIds.Plane3x3Convex:
      // createPlaneGeometry(3) => X/Z in [-1.5,1.5], thin plate in Y
      return [1.5, 0.0, 1.5];
    default:
      return null;
  }
}

export { ensureStandardColliderMeshes as StandardColliderMeshes };

function hasMesh(world, mapName, meshId) {
  if (!world || !meshId) {
    return false;
  }
  const map = world[mapName];
  if (!map || typeof map.get !== "function") {
    return false;
  }
  return !!map.get(meshId);
}

export function ensureStandardColliderMeshes(world) {
  if (!world || world.destroyed || !world.module || !world.tolerances) {
    console.warn('[StandardColliderMeshes] World not ready, skipping mesh cooking');
    return;
  }
  if (world._standardColliderMeshesInitialized) {
    console.log('[StandardColliderMeshes] Already initialized');
    return;
  }
  world._standardColliderMeshesInitialized = true;
  console.log('[StandardColliderMeshes] Cooking standard convex meshes...');

  const ids = StandardColliderMeshIds;

  try {
    if (!hasMesh(world, "convexMeshes", ids.UnitCubeConvex)) {
      const cubeGeometry = createCubeGeometry(1);
      const positions = cubeGeometry && cubeGeometry.positions
        ? cubeGeometry.positions
        : null;
      if (positions && positions.length >= 9) {
        const mesh = cookAndRegisterConvexMeshForWorld(world, ids.UnitCubeConvex, positions);
        if (!mesh) {
          console.error("[PHYSX] Failed to cook standard UnitCube convex collider");
        }
      }
    }
  } catch (error) {
    console.error("[PHYSX] Error cooking standard UnitCube convex collider", error);
  }

  try {
    if (!hasMesh(world, "convexMeshes", ids.UnitSphereConvex)) {
      const sphereGeometry = createSphereGeometry(0.5, 16, 12);
      const positions = sphereGeometry && sphereGeometry.positions
        ? sphereGeometry.positions
        : null;
      if (positions && positions.length >= 9) {
        const mesh = cookAndRegisterConvexMeshForWorld(world, ids.UnitSphereConvex, positions);
        if (!mesh) {
          console.error("[PHYSX] Failed to cook standard UnitSphere convex collider");
        }
      }
    }
  } catch (error) {
    console.error("[PHYSX] Error cooking standard UnitSphere convex collider", error);
  }

  try {
    if (!hasMesh(world, "convexMeshes", ids.UnitCylinderConvex)) {
      // Use BEVELED cylinder - chamfered edges prevent tilting on sharp 90° corners
      const cylinderGeometry = createBeveledCylinderGeometry(0.5, 1.0, 48, 0.1);
      const positions = cylinderGeometry && cylinderGeometry.positions
        ? cylinderGeometry.positions
        : null;
      if (positions && positions.length >= 9) {
        const mesh = cookAndRegisterConvexMeshForWorld(world, ids.UnitCylinderConvex, positions);
        if (!mesh) {
          console.error("[PHYSX] Failed to cook standard UnitCylinder convex collider");
        }
      }
    }
  } catch (error) {
    console.error("[PHYSX] Error cooking standard UnitCylinder convex collider", error);
  }

  try {
    if (!hasMesh(world, "convexMeshes", ids.UnitConeConvex)) {
      // Use 48 segments for smoother cone collision
      const coneGeometry = createConeGeometry(0.5, 1.0, 48);
      const positions = coneGeometry && coneGeometry.positions
        ? coneGeometry.positions
        : null;
      if (positions && positions.length >= 9) {
        const mesh = cookAndRegisterConvexMeshForWorld(world, ids.UnitConeConvex, positions);
        if (mesh) {
          console.log(`[StandardColliderMeshes] Cooked UnitCone: ${ids.UnitConeConvex}`);
        } else {
          console.error("[PHYSX] Failed to cook standard UnitCone convex collider");
        }
      }
    }
  } catch (error) {
    console.error("[PHYSX] Error cooking standard UnitCone convex collider", error);
  }

  try {
    if (!hasMesh(world, "convexMeshes", ids.UnitCapsuleConvex)) {
      const capsuleGeometry = createCapsuleGeometry(0.3, 1.0, 16, 8);
      const positions = capsuleGeometry && capsuleGeometry.positions
        ? capsuleGeometry.positions
        : null;
      if (positions && positions.length >= 9) {
        const mesh = cookAndRegisterConvexMeshForWorld(world, ids.UnitCapsuleConvex, positions);
        if (!mesh) {
          console.error("[PHYSX] Failed to cook standard UnitCapsule convex collider");
        }
      }
    }
  } catch (error) {
    console.error("[PHYSX] Error cooking standard UnitCapsule convex collider", error);
  }

  try {
    if (!hasMesh(world, "convexMeshes", ids.UnitTorusConvex)) {
      const torusGeometry = createTorusGeometry(0.4, 0.15, 24, 12);
      const positions = torusGeometry && torusGeometry.positions
        ? torusGeometry.positions
        : null;
      if (positions && positions.length >= 9) {
        const mesh = cookAndRegisterConvexMeshForWorld(world, ids.UnitTorusConvex, positions);
        if (!mesh) {
          console.error("[PHYSX] Failed to cook standard UnitTorus convex collider");
        }
      }
    }
  } catch (error) {
    console.error("[PHYSX] Error cooking standard UnitTorus convex collider", error);
  }

  try {
    if (!hasMesh(world, "convexMeshes", ids.Plane3x3Convex)) {
      const planeGeometry = createPlaneGeometry(3);
      const positions = planeGeometry && planeGeometry.positions
        ? planeGeometry.positions
        : null;
      if (positions && positions.length >= 9) {
        const mesh = cookAndRegisterConvexMeshForWorld(world, ids.Plane3x3Convex, positions);
        if (!mesh) {
          console.error("[PHYSX] Failed to cook standard Plane3x3 convex collider");
        }
      }
    }
  } catch (error) {
    console.error("[PHYSX] Error cooking standard Plane3x3 convex collider", error);
  }
}
