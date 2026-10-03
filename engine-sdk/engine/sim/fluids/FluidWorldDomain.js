// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// =============================================================================
// FLUID WORLD DOMAIN - Persistent world-scale fluid simulation domain
// =============================================================================
// Builds a fluid domain AABB from static colliders in the ECS world and
// creates a 3D solid mask texture for boundary handling.

import { createStorageBuffer, updateBuffer } from "../../core/gpu/GpuBuffer.js";

/**
 * Collider shape types that contribute to fluid boundaries
 */
const SOLID_SHAPES = new Set(["box", "sphere", "capsule", "convexMesh", "triangleMesh"]);

/**
 * Compute AABB for a collider in world space
 * @param {Object} collider - Collider component data
 * @param {Object} transform - Transform component data
 * @returns {Object} { min: [x,y,z], max: [x,y,z] }
 */
function computeColliderAABB(collider, transform) {
  const pos = transform?.position || [0, 0, 0];
  const scale = transform?.scale || [1, 1, 1];
  
  let halfExtents = [0.5, 0.5, 0.5];
  
  switch (collider.shape) {
    case "box":
      halfExtents = [
        collider.halfExtents[0] * scale[0],
        collider.halfExtents[1] * scale[1],
        collider.halfExtents[2] * scale[2],
      ];
      break;
    case "sphere":
      const r = collider.radius * Math.max(scale[0], scale[1], scale[2]);
      halfExtents = [r, r, r];
      break;
    case "capsule":
      const cr = collider.radius * Math.max(scale[0], scale[2]);
      const ch = (collider.halfHeight + collider.radius) * scale[1];
      halfExtents = [cr, ch, cr];
      break;
    default:
      // For mesh colliders, use a default size or query mesh bounds
      halfExtents = [1, 1, 1];
  }
  
  return {
    min: [pos[0] - halfExtents[0], pos[1] - halfExtents[1], pos[2] - halfExtents[2]],
    max: [pos[0] + halfExtents[0], pos[1] + halfExtents[1], pos[2] + halfExtents[2]],
  };
}

/**
 * Build fluid domain from ECS world colliders
 * @param {Object} ecsWorld - ECS world with component storage
 * @param {Object} options - Configuration options
 * @returns {Object} Domain info with bounds and collider list
 */
export function buildFluidDomainFromColliders(ecsWorld, options = {}) {
  const margin = options.margin || 2.0;
  const defaultBounds = options.defaultBounds || {
    min: [-1e9, -1e9, -1e9],
    max: [1e9, 1e9, 1e9],
  };
  
  // Query all entities with Collider + Transform + (optionally) static PhysicsBody
  const colliders = [];
  let domainMin = [Infinity, Infinity, Infinity];
  let domainMax = [-Infinity, -Infinity, -Infinity];
  
  if (ecsWorld?.entities) {
    for (const [entityId, entity] of ecsWorld.entities) {
      const collider = entity.Collider;
      const transform = entity.Transform;
      const physicsBody = entity.PhysicsBody;
      
      if (!collider || !transform) continue;
      
      // Only include static bodies or bodies without PhysicsBody (assumed static)
      const isStatic = !physicsBody || physicsBody.type === "static" || physicsBody.type === "kinematic";
      if (!isStatic) continue;
      
      // Skip triggers
      if (collider.isTrigger) continue;
      
      // Skip non-solid shapes
      if (!SOLID_SHAPES.has(collider.shape)) continue;
      
      const aabb = computeColliderAABB(collider, transform);
      
      colliders.push({
        entityId,
        shape: collider.shape,
        aabb,
        collider,
        transform,
      });
      
      // Expand domain bounds
      for (let i = 0; i < 3; i++) {
        domainMin[i] = Math.min(domainMin[i], aabb.min[i]);
        domainMax[i] = Math.max(domainMax[i], aabb.max[i]);
      }
    }
  }
  
  // Use default bounds if no colliders found
  if (colliders.length === 0) {
    domainMin = [...defaultBounds.min];
    domainMax = [...defaultBounds.max];
  } else {
    // Add margin
    for (let i = 0; i < 3; i++) {
      domainMin[i] -= margin;
      domainMax[i] += margin;
    }
  }
  
  return {
    min: domainMin,
    max: domainMax,
    colliders,
    size: [
      domainMax[0] - domainMin[0],
      domainMax[1] - domainMin[1],
      domainMax[2] - domainMin[2],
    ],
  };
}

/**
 * Create a 3D solid mask texture from colliders
 * Each cell is 0 (fluid) or 1 (solid)
 */
export function createSolidMaskTexture(device, domain, gridSize) {
  const [gx, gy, gz] = gridSize;
  const cellCount = gx * gy * gz;
  
  // Create 3D texture
  const texture = device.createTexture({
    label: "FluidDomain.solidMask",
    size: [gx, gy, gz],
    format: "r8uint",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING,
    dimension: "3d",
  });
  
  // Generate mask data on CPU (could be done on GPU for complex scenes)
  const maskData = new Uint8Array(cellCount);
  
  const cellSize = [
    domain.size[0] / gx,
    domain.size[1] / gy,
    domain.size[2] / gz,
  ];
  
  for (const colliderInfo of domain.colliders) {
    const aabb = colliderInfo.aabb;
    
    // Convert AABB to grid coordinates
    const minCell = [
      Math.floor((aabb.min[0] - domain.min[0]) / cellSize[0]),
      Math.floor((aabb.min[1] - domain.min[1]) / cellSize[1]),
      Math.floor((aabb.min[2] - domain.min[2]) / cellSize[2]),
    ];
    const maxCell = [
      Math.ceil((aabb.max[0] - domain.min[0]) / cellSize[0]),
      Math.ceil((aabb.max[1] - domain.min[1]) / cellSize[1]),
      Math.ceil((aabb.max[2] - domain.min[2]) / cellSize[2]),
    ];
    
    // Clamp to grid bounds
    for (let i = 0; i < 3; i++) {
      minCell[i] = Math.max(0, minCell[i]);
      maxCell[i] = Math.min([gx, gy, gz][i], maxCell[i]);
    }
    
    // Fill cells (simple AABB rasterization)
    // For more accurate shapes, we'd need per-shape rasterization
    for (let z = minCell[2]; z < maxCell[2]; z++) {
      for (let y = minCell[1]; y < maxCell[1]; y++) {
        for (let x = minCell[0]; x < maxCell[0]; x++) {
          const idx = z * gx * gy + y * gx + x;
          
          // Check if cell center is inside collider
          const cellCenter = [
            domain.min[0] + (x + 0.5) * cellSize[0],
            domain.min[1] + (y + 0.5) * cellSize[1],
            domain.min[2] + (z + 0.5) * cellSize[2],
          ];
          
          if (isPointInCollider(cellCenter, colliderInfo)) {
            maskData[idx] = 1;
          }
        }
      }
    }
  }
  
  // Upload to GPU
  device.queue.writeTexture(
    { texture },
    maskData,
    { bytesPerRow: gx, rowsPerImage: gy },
    [gx, gy, gz]
  );
  
  return {
    texture,
    view: texture.createView({ dimension: "3d" }),
    gridSize,
    domain,
  };
}

/**
 * Check if a point is inside a collider (simplified)
 */
function isPointInCollider(point, colliderInfo) {
  const { collider, transform } = colliderInfo;
  const pos = transform?.position || [0, 0, 0];
  const scale = transform?.scale || [1, 1, 1];
  
  // Relative position
  const rel = [
    point[0] - pos[0],
    point[1] - pos[1],
    point[2] - pos[2],
  ];
  
  switch (collider.shape) {
    case "box": {
      const he = collider.halfExtents;
      return Math.abs(rel[0]) <= he[0] * scale[0] &&
             Math.abs(rel[1]) <= he[1] * scale[1] &&
             Math.abs(rel[2]) <= he[2] * scale[2];
    }
    case "sphere": {
      const r = collider.radius * Math.max(scale[0], scale[1], scale[2]);
      const d2 = rel[0]*rel[0] + rel[1]*rel[1] + rel[2]*rel[2];
      return d2 <= r * r;
    }
    case "capsule": {
      const r = collider.radius * Math.max(scale[0], scale[2]);
      const hh = collider.halfHeight * scale[1];
      // Capsule is aligned along Y axis
      const cy = Math.max(-hh, Math.min(hh, rel[1]));
      const dx = rel[0];
      const dy = rel[1] - cy;
      const dz = rel[2];
      const d2 = dx*dx + dy*dy + dz*dz;
      return d2 <= r * r;
    }
    default:
      // For mesh colliders, fall back to AABB check
      const aabb = colliderInfo.aabb;
      return point[0] >= aabb.min[0] && point[0] <= aabb.max[0] &&
             point[1] >= aabb.min[1] && point[1] <= aabb.max[1] &&
             point[2] >= aabb.min[2] && point[2] <= aabb.max[2];
  }
}

/**
 * Create a world fluid domain with solid mask
 */
export function createWorldFluidDomain(device, ecsWorld, options = {}) {
  const gridSize = options.gridSize || [64, 48, 64];
  
  // Build domain from colliders
  const domain = buildFluidDomainFromColliders(ecsWorld, options);
  
  // Create solid mask texture
  const solidMask = createSolidMaskTexture(device, domain, gridSize);
  
  // Create params buffer for shaders
  const paramsBuffer = device.createBuffer({
    label: "FluidDomain.params",
    size: 64, // 16 floats
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  
  return {
    device,
    domain,
    solidMask,
    gridSize,
    paramsBuffer,
    // Bounds for easy access
    worldMin: domain.min,
    worldMax: domain.max,
    worldSize: domain.size,
  };
}

/**
 * Update world fluid domain params buffer
 */
export function updateWorldFluidDomainParams(worldDomain) {
  if (!worldDomain || !worldDomain.device) return;
  
  const [gx, gy, gz] = worldDomain.gridSize;
  const params = new Float32Array([
    worldDomain.worldMin[0],
    worldDomain.worldMin[1],
    worldDomain.worldMin[2],
    0, // padding
    worldDomain.worldMax[0],
    worldDomain.worldMax[1],
    worldDomain.worldMax[2],
    0, // padding
    gx, gy, gz,
    worldDomain.worldSize[0] / gx, // cellSize
    worldDomain.worldSize[1] / gy,
    worldDomain.worldSize[2] / gz,
    0, 0, // padding
  ]);
  
  worldDomain.device.queue.writeBuffer(worldDomain.paramsBuffer, 0, params);
}

/**
 * Destroy world fluid domain
 */
export function destroyWorldFluidDomain(worldDomain) {
  if (!worldDomain) return;
  worldDomain.solidMask?.texture?.destroy();
  worldDomain.paramsBuffer?.destroy();
}

/**
 * Rebuild solid mask when scene changes
 */
export function rebuildSolidMask(worldDomain, ecsWorld) {
  if (!worldDomain || !worldDomain.device) return;
  
  // Rebuild domain
  const domain = buildFluidDomainFromColliders(ecsWorld, {
    defaultBounds: {
      min: worldDomain.worldMin,
      max: worldDomain.worldMax,
    },
  });
  
  // Destroy old texture
  worldDomain.solidMask?.texture?.destroy();
  
  // Create new mask
  worldDomain.solidMask = createSolidMaskTexture(
    worldDomain.device,
    domain,
    worldDomain.gridSize
  );
  
  worldDomain.domain = domain;
  worldDomain.worldMin = domain.min;
  worldDomain.worldMax = domain.max;
  worldDomain.worldSize = domain.size;
  
  updateWorldFluidDomainParams(worldDomain);
}

export default {
  buildFluidDomainFromColliders,
  createSolidMaskTexture,
  createWorldFluidDomain,
  updateWorldFluidDomainParams,
  destroyWorldFluidDomain,
  rebuildSolidMask,
};
