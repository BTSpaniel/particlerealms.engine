// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleSpawnShapes.js - Spawn shape primitives for particle emission
 * 
 * Niagara/PopcornFX/Houdini parity: spawn particles in structured shapes
 * instead of just point + random spread.
 * 
 * Each function returns { position: [x,y,z], normal: [nx,ny,nz] }
 * Normal points outward from the shape surface — useful for initial velocity direction.
 * 
 * ⚠️ MULTIPLAYER: Uses deterministic RNG from AIRandom.js
 */

import { aiRng } from "../ai/AIRandom.js";

const TAU = Math.PI * 2;
const EPSILON = 1e-6;

// ============================================================================
// SPHERE
// ============================================================================

/**
 * Spawn inside or on a sphere
 * @param {number[]} center - [x, y, z]
 * @param {number} radius
 * @param {boolean} surfaceOnly - true = on surface, false = inside volume
 * @returns {{ position: number[], normal: number[] }}
 */
export function spawnSphere(center, radius, surfaceOnly = false) {
  // Uniform sphere distribution via rejection-free method
  const z = aiRng.float() * 2 - 1;
  const phi = aiRng.float() * TAU;
  const rxy = Math.sqrt(1 - z * z);
  const nx = rxy * Math.cos(phi);
  const ny = rxy * Math.sin(phi);
  const nz = z;

  const r = surfaceOnly ? radius : radius * Math.cbrt(aiRng.float());

  return {
    position: [center[0] + nx * r, center[1] + ny * r, center[2] + nz * r],
    normal: [nx, ny, nz],
  };
}

/**
 * Spawn on a hemisphere (oriented along axis)
 * @param {number[]} center
 * @param {number} radius
 * @param {number[]} axis - Hemisphere direction [x, y, z] (default up)
 * @param {boolean} surfaceOnly
 */
export function spawnHemisphere(center, radius, axis = [0, 1, 0], surfaceOnly = false) {
  const result = spawnSphere(center, radius, surfaceOnly);
  // Flip if on wrong side of hemisphere
  const dot = (result.normal[0] * axis[0] + result.normal[1] * axis[1] + result.normal[2] * axis[2]);
  if (dot < 0) {
    // Reflect across the plane perpendicular to axis
    const d2 = 2 * dot;
    result.position[0] -= d2 * axis[0] * (surfaceOnly ? radius : vecLen(result.position, center));
    result.position[1] -= d2 * axis[1] * (surfaceOnly ? radius : vecLen(result.position, center));
    result.position[2] -= d2 * axis[2] * (surfaceOnly ? radius : vecLen(result.position, center));
    result.normal[0] -= d2 * axis[0];
    result.normal[1] -= d2 * axis[1];
    result.normal[2] -= d2 * axis[2];
  }
  return result;
}

// ============================================================================
// BOX
// ============================================================================

/**
 * Spawn inside or on a box (AABB)
 * @param {number[]} min - [minX, minY, minZ]
 * @param {number[]} max - [maxX, maxY, maxZ]
 * @param {boolean} surfaceOnly
 */
export function spawnBox(min, max, surfaceOnly = false) {
  if (!surfaceOnly) {
    const x = min[0] + aiRng.float() * (max[0] - min[0]);
    const y = min[1] + aiRng.float() * (max[1] - min[1]);
    const z = min[2] + aiRng.float() * (max[2] - min[2]);
    return { position: [x, y, z], normal: [0, 1, 0] };
  }

  // Surface spawn: pick a random face weighted by area
  const sx = max[0] - min[0];
  const sy = max[1] - min[1];
  const sz = max[2] - min[2];
  const areaXY = sx * sy;
  const areaXZ = sx * sz;
  const areaYZ = sy * sz;
  const totalArea = 2 * (areaXY + areaXZ + areaYZ);
  const r = aiRng.float() * totalArea;

  let u = aiRng.float();
  let v = aiRng.float();

  if (r < areaYZ) {
    return { position: [min[0], min[1] + u * sy, min[2] + v * sz], normal: [-1, 0, 0] };
  } else if (r < 2 * areaYZ) {
    return { position: [max[0], min[1] + u * sy, min[2] + v * sz], normal: [1, 0, 0] };
  } else if (r < 2 * areaYZ + areaXZ) {
    return { position: [min[0] + u * sx, min[1], min[2] + v * sz], normal: [0, -1, 0] };
  } else if (r < 2 * areaYZ + 2 * areaXZ) {
    return { position: [min[0] + u * sx, max[1], min[2] + v * sz], normal: [0, 1, 0] };
  } else if (r < 2 * areaYZ + 2 * areaXZ + areaXY) {
    return { position: [min[0] + u * sx, min[1] + v * sy, min[2]], normal: [0, 0, -1] };
  } else {
    return { position: [min[0] + u * sx, min[1] + v * sy, max[2]], normal: [0, 0, 1] };
  }
}

/**
 * Spawn inside or on a box defined by center + half-extents
 */
export function spawnBoxCenter(center, halfExtents, surfaceOnly = false) {
  return spawnBox(
    [center[0] - halfExtents[0], center[1] - halfExtents[1], center[2] - halfExtents[2]],
    [center[0] + halfExtents[0], center[1] + halfExtents[1], center[2] + halfExtents[2]],
    surfaceOnly,
  );
}

// ============================================================================
// CYLINDER
// ============================================================================

/**
 * Spawn inside or on a cylinder
 * @param {number[]} center - Center of cylinder
 * @param {number[]} axis - Cylinder axis direction (will be normalized)
 * @param {number} radius
 * @param {number} height - Total height (extends height/2 each direction from center)
 * @param {boolean} surfaceOnly
 */
export function spawnCylinder(center, axis, radius, height, surfaceOnly = false) {
  const ax = normalizeVec(axis);
  // Build orthonormal basis
  const { u: basisU, v: basisV } = orthonormalBasis(ax);

  const halfH = height * 0.5;
  const h = (aiRng.float() * 2 - 1) * halfH;
  const theta = aiRng.float() * TAU;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  let r, nx, ny, nz;
  if (surfaceOnly) {
    // Weight by area: caps vs barrel
    const capArea = Math.PI * radius * radius * 2;
    const barrelArea = TAU * radius * height;
    const total = capArea + barrelArea;
    const pick = aiRng.float() * total;

    if (pick < barrelArea) {
      // On barrel surface
      r = radius;
      nx = basisU[0] * cosT + basisV[0] * sinT;
      ny = basisU[1] * cosT + basisV[1] * sinT;
      nz = basisU[2] * cosT + basisV[2] * sinT;
    } else {
      // On cap
      r = radius * Math.sqrt(aiRng.float());
      const capSign = aiRng.float() < 0.5 ? -1 : 1;
      const capH = capSign * halfH;
      return {
        position: [
          center[0] + ax[0] * capH + (basisU[0] * cosT + basisV[0] * sinT) * r,
          center[1] + ax[1] * capH + (basisU[1] * cosT + basisV[1] * sinT) * r,
          center[2] + ax[2] * capH + (basisU[2] * cosT + basisV[2] * sinT) * r,
        ],
        normal: [ax[0] * capSign, ax[1] * capSign, ax[2] * capSign],
      };
    }
  } else {
    r = radius * Math.sqrt(aiRng.float());
    nx = basisU[0] * cosT + basisV[0] * sinT;
    ny = basisU[1] * cosT + basisV[1] * sinT;
    nz = basisU[2] * cosT + basisV[2] * sinT;
  }

  return {
    position: [
      center[0] + ax[0] * h + (basisU[0] * cosT + basisV[0] * sinT) * r,
      center[1] + ax[1] * h + (basisU[1] * cosT + basisV[1] * sinT) * r,
      center[2] + ax[2] * h + (basisU[2] * cosT + basisV[2] * sinT) * r,
    ],
    normal: [nx, ny, nz],
  };
}

// ============================================================================
// CONE
// ============================================================================

/**
 * Spawn inside or on a cone
 * @param {number[]} apex - Tip of the cone
 * @param {number[]} axis - Cone axis direction (from apex toward base)
 * @param {number} angle - Half-angle in radians
 * @param {number} height - Height from apex to base
 * @param {boolean} surfaceOnly
 */
export function spawnCone(apex, axis, angle, height, surfaceOnly = false) {
  const ax = normalizeVec(axis);
  const { u: basisU, v: basisV } = orthonormalBasis(ax);

  // Random height along cone (cube root for uniform volume, linear for surface)
  const t = surfaceOnly ? aiRng.float() : Math.cbrt(aiRng.float());
  const h = t * height;
  const maxR = Math.tan(angle) * h;

  const theta = aiRng.float() * TAU;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  const r = surfaceOnly ? maxR : maxR * Math.sqrt(aiRng.float());

  const radialDir = [
    basisU[0] * cosT + basisV[0] * sinT,
    basisU[1] * cosT + basisV[1] * sinT,
    basisU[2] * cosT + basisV[2] * sinT,
  ];

  // Cone surface normal: perpendicular to slant surface
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const normal = [
    radialDir[0] * cosA + ax[0] * (-sinA),
    radialDir[1] * cosA + ax[1] * (-sinA),
    radialDir[2] * cosA + ax[2] * (-sinA),
  ];

  return {
    position: [
      apex[0] + ax[0] * h + radialDir[0] * r,
      apex[1] + ax[1] * h + radialDir[1] * r,
      apex[2] + ax[2] * h + radialDir[2] * r,
    ],
    normal,
  };
}

// ============================================================================
// RING / TORUS
// ============================================================================

/**
 * Spawn on a ring (circle in 3D space)
 * @param {number[]} center
 * @param {number[]} axis - Ring normal direction
 * @param {number} radius - Ring radius
 * @param {number} thickness - Spread around the ring (0 = thin line)
 */
export function spawnRing(center, axis, radius, thickness = 0) {
  const ax = normalizeVec(axis);
  const { u: basisU, v: basisV } = orthonormalBasis(ax);

  const theta = aiRng.float() * TAU;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  // Radial direction on the ring plane
  const radialDir = [
    basisU[0] * cosT + basisV[0] * sinT,
    basisU[1] * cosT + basisV[1] * sinT,
    basisU[2] * cosT + basisV[2] * sinT,
  ];

  const r = radius + (thickness > 0 ? (aiRng.float() * 2 - 1) * thickness : 0);

  return {
    position: [
      center[0] + radialDir[0] * r,
      center[1] + radialDir[1] * r,
      center[2] + radialDir[2] * r,
    ],
    normal: radialDir,
  };
}

/**
 * Spawn inside or on a torus
 * @param {number[]} center
 * @param {number[]} axis - Torus normal
 * @param {number} majorRadius - Distance from center to tube center
 * @param {number} minorRadius - Tube radius
 * @param {boolean} surfaceOnly
 */
export function spawnTorus(center, axis, majorRadius, minorRadius, surfaceOnly = false) {
  const ax = normalizeVec(axis);
  const { u: basisU, v: basisV } = orthonormalBasis(ax);

  const theta = aiRng.float() * TAU; // Angle around torus ring
  const phi = aiRng.float() * TAU;   // Angle around tube cross-section

  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);

  // Radial direction from torus center to tube center
  const ringDir = [
    basisU[0] * cosT + basisV[0] * sinT,
    basisU[1] * cosT + basisV[1] * sinT,
    basisU[2] * cosT + basisV[2] * sinT,
  ];

  const r = surfaceOnly ? minorRadius : minorRadius * Math.sqrt(aiRng.float());

  // Point on tube cross-section: outward radial + axis
  const tubeOffset = [
    ringDir[0] * cosP * r + ax[0] * sinP * r,
    ringDir[1] * cosP * r + ax[1] * sinP * r,
    ringDir[2] * cosP * r + ax[2] * sinP * r,
  ];

  // Normal at surface: direction from tube center to point
  const normal = normalizeVec([
    ringDir[0] * cosP + ax[0] * sinP,
    ringDir[1] * cosP + ax[1] * sinP,
    ringDir[2] * cosP + ax[2] * sinP,
  ]);

  return {
    position: [
      center[0] + ringDir[0] * majorRadius + tubeOffset[0],
      center[1] + ringDir[1] * majorRadius + tubeOffset[1],
      center[2] + ringDir[2] * majorRadius + tubeOffset[2],
    ],
    normal,
  };
}

// ============================================================================
// LINE / EDGE
// ============================================================================

/**
 * Spawn along a line segment
 * @param {number[]} a - Start point
 * @param {number[]} b - End point
 * @param {number} thickness - Spread perpendicular to line (0 = on line)
 */
export function spawnLine(a, b, thickness = 0) {
  const t = aiRng.float();
  const px = a[0] + (b[0] - a[0]) * t;
  const py = a[1] + (b[1] - a[1]) * t;
  const pz = a[2] + (b[2] - a[2]) * t;

  // Direction along line
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (thickness > 0 && len > EPSILON) {
    const dir = [dx / len, dy / len, dz / len];
    const { u: basisU, v: basisV } = orthonormalBasis(dir);
    const angle = aiRng.float() * TAU;
    const r = aiRng.float() * thickness;
    return {
      position: [
        px + (basisU[0] * Math.cos(angle) + basisV[0] * Math.sin(angle)) * r,
        py + (basisU[1] * Math.cos(angle) + basisV[1] * Math.sin(angle)) * r,
        pz + (basisU[2] * Math.cos(angle) + basisV[2] * Math.sin(angle)) * r,
      ],
      normal: [0, 1, 0],
    };
  }

  return {
    position: [px, py, pz],
    normal: len > EPSILON ? [dx / len, dy / len, dz / len] : [0, 1, 0],
  };
}

// ============================================================================
// DISC
// ============================================================================

/**
 * Spawn on a disc (filled circle in 3D space)
 * @param {number[]} center
 * @param {number[]} normal - Disc facing direction
 * @param {number} radius
 * @param {number} innerRadius - Hollow inner radius (0 = solid disc)
 */
export function spawnDisc(center, normal, radius, innerRadius = 0) {
  const ax = normalizeVec(normal);
  const { u: basisU, v: basisV } = orthonormalBasis(ax);

  const theta = aiRng.float() * TAU;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  // Uniform distribution on annulus: r = sqrt(lerp(inner^2, outer^2, t))
  const rSq = innerRadius * innerRadius + aiRng.float() * (radius * radius - innerRadius * innerRadius);
  const r = Math.sqrt(rSq);

  return {
    position: [
      center[0] + (basisU[0] * cosT + basisV[0] * sinT) * r,
      center[1] + (basisU[1] * cosT + basisV[1] * sinT) * r,
      center[2] + (basisU[2] * cosT + basisV[2] * sinT) * r,
    ],
    normal: ax,
  };
}

// ============================================================================
// GRID
// ============================================================================

/**
 * Spawn at grid positions (deterministic placement, good for walls/floors of particles)
 * @param {number[]} origin - Grid origin corner
 * @param {number[]} axisU - Direction + length of U axis
 * @param {number[]} axisV - Direction + length of V axis
 * @param {number} countU - Points along U
 * @param {number} countV - Points along V
 * @param {number} index - Which grid point (0 to countU*countV-1)
 * @param {number} jitter - Random offset as fraction of cell size (0 = perfect grid)
 */
export function spawnGrid(origin, axisU, axisV, countU, countV, index, jitter = 0) {
  const iu = index % countU;
  const iv = Math.floor(index / countU) % countV;

  const tu = countU > 1 ? iu / (countU - 1) : 0.5;
  const tv = countV > 1 ? iv / (countV - 1) : 0.5;

  let ju = 0, jv = 0;
  if (jitter > 0) {
    const cellU = 1 / Math.max(countU - 1, 1);
    const cellV = 1 / Math.max(countV - 1, 1);
    ju = (aiRng.float() - 0.5) * cellU * jitter;
    jv = (aiRng.float() - 0.5) * cellV * jitter;
  }

  const u = tu + ju;
  const v = tv + jv;

  // Normal = cross product of axes
  const normal = normalizeVec([
    axisU[1] * axisV[2] - axisU[2] * axisV[1],
    axisU[2] * axisV[0] - axisU[0] * axisV[2],
    axisU[0] * axisV[1] - axisU[1] * axisV[0],
  ]);

  return {
    position: [
      origin[0] + axisU[0] * u + axisV[0] * v,
      origin[1] + axisU[1] * u + axisV[1] * v,
      origin[2] + axisU[2] * u + axisV[2] * v,
    ],
    normal,
  };
}

// ============================================================================
// UNIFIED SPAWN INTERFACE
// ============================================================================

/**
 * Spawn a particle using a shape configuration object
 * @param {Object} shape - Shape config from emitter: { type, ...params }
 * @param {number[]} emitterPos - Emitter world position (added as offset)
 * @param {number} index - Particle index (for grid shapes)
 * @returns {{ position: number[], normal: number[] }}
 */
export function spawnFromShape(shape, emitterPos, index = 0) {
  if (!shape || !shape.type) {
    // Default: point spawn at emitter position with small random offset
    return {
      position: [
        emitterPos[0] + (aiRng.float() - 0.5) * 0.5,
        emitterPos[1] + aiRng.float() * 0.1,
        emitterPos[2] + (aiRng.float() - 0.5) * 0.5,
      ],
      normal: [0, 1, 0],
    };
  }

  const c = shape.center || emitterPos;
  const ax = shape.axis || [0, 1, 0];
  const surf = shape.surfaceOnly || false;

  switch (shape.type) {
    case 'sphere':
      return spawnSphere(c, shape.radius || 1, surf);
    case 'hemisphere':
      return spawnHemisphere(c, shape.radius || 1, ax, surf);
    case 'box':
      if (shape.halfExtents) return spawnBoxCenter(c, shape.halfExtents, surf);
      return spawnBox(shape.min || [-1,-1,-1], shape.max || [1,1,1], surf);
    case 'cylinder':
      return spawnCylinder(c, ax, shape.radius || 1, shape.height || 2, surf);
    case 'cone':
      return spawnCone(c, ax, shape.angle || Math.PI / 6, shape.height || 2, surf);
    case 'ring':
      return spawnRing(c, ax, shape.radius || 1, shape.thickness || 0);
    case 'torus':
      return spawnTorus(c, ax, shape.majorRadius || 1, shape.minorRadius || 0.3, surf);
    case 'line':
      return spawnLine(shape.a || c, shape.b || [c[0], c[1] + 2, c[2]], shape.thickness || 0);
    case 'disc':
      return spawnDisc(c, shape.normal || ax, shape.radius || 1, shape.innerRadius || 0);
    case 'grid':
      return spawnGrid(
        c, shape.axisU || [1,0,0], shape.axisV || [0,0,1],
        shape.countU || 10, shape.countV || 10, index, shape.jitter || 0,
      );
    default:
      return spawnFromShape(null, emitterPos, index);
  }
}

// ============================================================================
// VELOCITY FROM SHAPE NORMAL
// ============================================================================

/**
 * Generate initial velocity from spawn shape result
 * @param {number[]} normal - Outward normal from spawn shape
 * @param {number} speed - Base speed
 * @param {number} spread - Random spread angle (0 = perfectly aligned with normal, 1 = hemisphere)
 * @returns {number[]} velocity [vx, vy, vz]
 */
export function velocityFromNormal(normal, speed, spread = 0.2) {
  if (spread <= EPSILON) {
    return [normal[0] * speed, normal[1] * speed, normal[2] * speed];
  }

  // Perturb normal by spread amount
  const jx = (aiRng.float() - 0.5) * 2 * spread;
  const jy = (aiRng.float() - 0.5) * 2 * spread;
  const jz = (aiRng.float() - 0.5) * 2 * spread;
  const dx = normal[0] + jx;
  const dy = normal[1] + jy;
  const dz = normal[2] + jz;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < EPSILON) return [0, speed, 0];

  const inv = speed / len;
  return [dx * inv, dy * inv, dz * inv];
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

function normalizeVec(v) {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (len < EPSILON) return [0, 1, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function vecLen(a, b) {
  const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function orthonormalBasis(n) {
  // Duff et al. (2017) - robust orthonormal basis from a single vector
  const sign = n[2] >= 0 ? 1 : -1;
  const a = -1 / (sign + n[2]);
  const b = n[0] * n[1] * a;
  return {
    u: [1 + sign * n[0] * n[0] * a, sign * b, -sign * n[0]],
    v: [b, sign + n[1] * n[1] * a, -n[1]],
  };
}
