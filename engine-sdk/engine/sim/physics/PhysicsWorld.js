import { 
  SIM_MODES, 
  COLLIDER_SHAPES,
  PHYSICS_WORLD_SCHEMA,
  createDefaultPhysicsWorld,
  validatePhysicsBody,
  validateCollider,
} from './PhysicsSchema.js';

export function createPhysicsWorld(options = {}) {
  // Use PhysicsSchema defaults
  const defaults = createDefaultPhysicsWorld();
  
  const gravityOpt = options.gravity;
  const gravity = Array.isArray(gravityOpt) && gravityOpt.length >= 3
    ? [
        normalizeNumber(gravityOpt[0], 0),
        normalizeNumber(gravityOpt[1], defaults.gravity[1]),
        normalizeNumber(gravityOpt[2], 0),
      ]
    : [...defaults.gravity];

  const bounce = typeof options.bounce === "number" ? options.bounce : defaults.bounce;
  const maxStep = normalizePositiveNumber(options.maxStep, defaults.maxStep);
  const maxSubSteps = normalizeInt(options.maxSubSteps, defaults.maxSubSteps, 1, 16);
  const bounds = resolveBounds(options.bounds);

  return {
    gravity,
    bounce,
    maxStep,
    maxSubSteps,
    nextBodyHandle: 1,
    bodies: new Map(),
    bounds,
  };
}

export { createPhysicsWorld as PhysicsWorld };

export function destroyPhysicsWorld(physicsWorld) {
  if (!physicsWorld) {
    return;
  }
  physicsWorld.bodies.clear();
}

export function createBody(physicsWorld, desc) {
  if (!physicsWorld) {
    throw new Error("createBody: physicsWorld is required");
  }

  const handle = physicsWorld.nextBodyHandle | 0;
  physicsWorld.nextBodyHandle = handle + 1;

  const modeValue = desc && typeof desc.simMode === "string" ? desc.simMode : "dynamic";
  const simMode =
    modeValue === "static" || modeValue === "kinematic" || modeValue === "dynamic"
      ? modeValue
      : "dynamic";

  const colliderDesc = desc && typeof desc.collider === "object" ? desc.collider : null;
  let colliderShape = null;
  let colliderHalfExtents = null;
  let colliderRadius = 0;
  let colliderHalfHeight = 0;

  if (colliderDesc) {
    const shapeValue = typeof colliderDesc.shape === "string" ? colliderDesc.shape : "box";
    if (shapeValue === "box" || shapeValue === "sphere" || shapeValue === "capsule") {
      colliderShape = shapeValue;
    }
    if (Array.isArray(colliderDesc.halfExtents) && colliderDesc.halfExtents.length >= 3) {
      const hx = normalizePositiveNumber(colliderDesc.halfExtents[0], 0.5);
      const hy = normalizePositiveNumber(colliderDesc.halfExtents[1], 0.5);
      const hz = normalizePositiveNumber(colliderDesc.halfExtents[2], 0.5);
      colliderHalfExtents = [hx, hy, hz];
    }
    if (colliderDesc.radius !== undefined) {
      colliderRadius = normalizePositiveNumber(colliderDesc.radius, 0.5);
    }
    if (colliderDesc.halfHeight !== undefined) {
      colliderHalfHeight = normalizePositiveNumber(colliderDesc.halfHeight, 0.5);
    }
  }

  const body = {
    handle,
    simMode,
    position: toVec3(desc && desc.position, [0, 0, 0]),
    rotation: toQuat(desc && desc.rotation, [0, 0, 0, 1]),
    linearVelocity: toVec3(desc && desc.linearVelocity, [0, 0, 0]),
    angularVelocity: toVec3(desc && desc.angularVelocity, [0, 0, 0]),
    userData: desc && Object.prototype.hasOwnProperty.call(desc, "userData") ? desc.userData : null,
    colliderShape,
    colliderHalfExtents,
    colliderRadius,
    colliderHalfHeight,
  };

  physicsWorld.bodies.set(handle, body);
  return body;
}

export function getBody(physicsWorld, handle) {
  if (!physicsWorld) {
    return null;
  }
  if (typeof handle !== "number") {
    return null;
  }
  return physicsWorld.bodies.get(handle) || null;
}

export function removeBody(physicsWorld, handle) {
  if (!physicsWorld) {
    return false;
  }
  if (typeof handle !== "number") {
    return false;
  }
  return physicsWorld.bodies.delete(handle);
}

export function stepPhysicsWorld(physicsWorld, deltaSeconds) {
  if (!physicsWorld) {
    return;
  }
  const dtValue = typeof deltaSeconds === "number" ? deltaSeconds : 0;
  if (!Number.isFinite(dtValue) || dtValue <= 0) {
    return;
  }

  const maxStep = physicsWorld.maxStep;
  const maxSubSteps = physicsWorld.maxSubSteps | 0;
  const clampedDt = dtValue > 0.25 ? 0.25 : dtValue;
  const steps = Math.min(maxSubSteps, Math.max(1, Math.ceil(clampedDt / maxStep)));
  const dt = clampedDt / steps;

  const gravity = physicsWorld.gravity;
  const gx = gravity[0];
  const gy = gravity[1];
  const gz = gravity[2];
  const bounce = physicsWorld.bounce;
  const bounds = physicsWorld.bounds || null;

  for (let s = 0; s < steps; s++) {
    for (const body of physicsWorld.bodies.values()) {
      if (!body) {
        continue;
      }
      const mode = body.simMode;
      if (mode === "static") {
        continue;
      }

      const lv = body.linearVelocity;
      if (mode === "dynamic") {
        lv[0] += gx * dt;
        lv[1] += gy * dt;
        lv[2] += gz * dt;
      }

      const p = body.position;
      p[0] += lv[0] * dt;
      p[1] += lv[1] * dt;
      p[2] += lv[2] * dt;

      if (mode === "dynamic") {
        if (bounds) {
          applyBoundsCollision(bounds, bounce, body);
        } else if (p[1] < 0) {
          // Legacy simple floor collision for worlds without bounds
          p[1] = 0;
          if (lv[1] < 0) {
            lv[1] = -lv[1] * bounce;
            if (Math.abs(lv[1]) < 0.01) {
              lv[1] = 0;
            }
          }
        }
      }
    }

    if (bounce > 0) {
      resolveBodyBodyCollisions(physicsWorld, bounce);
    }
  }
}

function normalizeNumber(value, defaultValue) {
  const n = Number(value);
  return Number.isFinite(n) ? n : defaultValue;
}

function normalizePositiveNumber(value, defaultValue) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return defaultValue;
  }
  return n;
}

function normalizeInt(value, defaultValue, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return defaultValue;
  }
  const i = n | 0;
  if (i < min) {
    return min;
  }
  if (i > max) {
    return max;
  }
  return i;
}

function resolveBounds(boundsOpt) {
  if (!boundsOpt || typeof boundsOpt !== "object") {
    return null;
  }
  const min = toBoundsVec3(boundsOpt.min);
  const max = toBoundsVec3(boundsOpt.max);
  let hasAny = false;
  for (let i = 0; i < 3; i++) {
    if (Number.isFinite(min[i]) || Number.isFinite(max[i])) {
      hasAny = true;
      break;
    }
  }
  if (!hasAny) {
    return null;
  }
  return { min, max };
}

function getBodyRadius(body) {
  if (!body) {
    return 0;
  }
  if (typeof body.colliderRadius === "number" && body.colliderRadius > 0) {
    return body.colliderRadius;
  }
  const ud = body.userData;
  if (ud && typeof ud === "object" && Object.prototype.hasOwnProperty.call(ud, "radius")) {
    const r = Number(ud.radius);
    if (Number.isFinite(r) && r > 0) {
      return r;
    }
  }
  return 0;
}

function toBoundsVec3(input) {
  if (!Array.isArray(input)) {
    return [NaN, NaN, NaN];
  }
  const x = Number(input[0]);
  const y = Number(input[1]);
  const z = Number(input[2]);
  return [
    Number.isFinite(x) ? x : NaN,
    Number.isFinite(y) ? y : NaN,
    Number.isFinite(z) ? z : NaN,
  ];
}

function applyBoundsCollision(bounds, bounce, body) {
  const p = body.position;
  const lv = body.linearVelocity;
  const min = bounds.min;
  const max = bounds.max;

  const radius = getBodyRadius(body);

  const eps = 0.01;

  // X axis (left/right walls)
  if (Number.isFinite(min[0]) && p[0] - radius < min[0]) {
    p[0] = min[0] + radius;
    if (lv[0] < 0) {
      lv[0] = -lv[0] * bounce;
      if (Math.abs(lv[0]) < eps) {
        lv[0] = 0;
      }
    }
  }
  if (Number.isFinite(max[0]) && p[0] + radius > max[0]) {
    p[0] = max[0] - radius;
    if (lv[0] > 0) {
      lv[0] = -lv[0] * bounce;
      if (Math.abs(lv[0]) < eps) {
        lv[0] = 0;
      }
    }
  }

  // Y axis (floor / optional ceiling)
  if (Number.isFinite(min[1]) && p[1] - radius < min[1]) {
    p[1] = min[1] + radius;
    if (lv[1] < 0) {
      lv[1] = -lv[1] * bounce;
      if (Math.abs(lv[1]) < eps) {
        lv[1] = 0;
      }
    }
  }
  if (Number.isFinite(max[1]) && p[1] + radius > max[1]) {
    p[1] = max[1] - radius;
    if (lv[1] > 0) {
      lv[1] = -lv[1] * bounce;
      if (Math.abs(lv[1]) < eps) {
        lv[1] = 0;
      }
    }
  }

  // Z axis (front/back walls)
  if (Number.isFinite(min[2]) && p[2] - radius < min[2]) {
    p[2] = min[2] + radius;
    if (lv[2] < 0) {
      lv[2] = -lv[2] * bounce;
      if (Math.abs(lv[2]) < eps) {
        lv[2] = 0;
      }
    }
  }
  if (Number.isFinite(max[2]) && p[2] + radius > max[2]) {
    p[2] = max[2] - radius;
    if (lv[2] > 0) {
      lv[2] = -lv[2] * bounce;
      if (Math.abs(lv[2]) < eps) {
        lv[2] = 0;
      }
    }
  }
}

function resolveBodyBodyCollisions(physicsWorld, bounce) {
  if (!physicsWorld) {
    return;
  }
  const bodies = Array.from(physicsWorld.bodies.values());
  const count = bodies.length;
  if (count <= 1) {
    return;
  }
  const eps = 1e-4;

  for (let i = 0; i < count; i++) {
    const a = bodies[i];
    if (!a || a.simMode !== "dynamic") {
      continue;
    }
    const ra = getBodyRadius(a);
    if (ra <= 0) {
      continue;
    }
    const pa = a.position;
    const va = a.linearVelocity;

    for (let j = i + 1; j < count; j++) {
      const b = bodies[j];
      if (!b || b.simMode !== "dynamic") {
        continue;
      }
      const rb = getBodyRadius(b);
      if (rb <= 0) {
        continue;
      }
      const pb = b.position;
      const vb = b.linearVelocity;

      let dx = pb[0] - pa[0];
      let dy = pb[1] - pa[1];
      let dz = pb[2] - pa[2];
      const distSq = dx * dx + dy * dy + dz * dz;
      const minDist = ra + rb;
      if (minDist <= 0 || distSq >= minDist * minDist) {
        continue;
      }

      let dist = Math.sqrt(distSq);
      let nx;
      let ny;
      let nz;
      if (dist > eps) {
        nx = dx / dist;
        ny = dy / dist;
        nz = dz / dist;
      } else {
        nx = 0;
        ny = 1;
        nz = 0;
        dist = minDist;
      }

      const penetration = minDist - dist;
      const halfMove = penetration * 0.5;
      pa[0] -= nx * halfMove;
      pa[1] -= ny * halfMove;
      pa[2] -= nz * halfMove;
      pb[0] += nx * halfMove;
      pb[1] += ny * halfMove;
      pb[2] += nz * halfMove;

      const rvx = vb[0] - va[0];
      const rvy = vb[1] - va[1];
      const rvz = vb[2] - va[2];
      const relVelAlongNormal = rvx * nx + rvy * ny + rvz * nz;
      if (relVelAlongNormal < 0) {
        const impulse = -(1 + bounce) * relVelAlongNormal * 0.5;
        va[0] -= nx * impulse;
        va[1] -= ny * impulse;
        va[2] -= nz * impulse;
        vb[0] += nx * impulse;
        vb[1] += ny * impulse;
        vb[2] += nz * impulse;
      }
    }
  }
}

function toVec3(input, defaultValue) {
  if (!Array.isArray(input)) {
    return defaultValue.slice();
  }
  const x = normalizeNumber(input[0], defaultValue[0]);
  const y = normalizeNumber(input[1], defaultValue[1]);
  const z = normalizeNumber(input[2], defaultValue[2]);
  return [x, y, z];
}

function toQuat(input, defaultValue) {
  if (!Array.isArray(input)) {
    return defaultValue.slice();
  }
  const x = normalizeNumber(input[0], defaultValue[0]);
  const y = normalizeNumber(input[1], defaultValue[1]);
  const z = normalizeNumber(input[2], defaultValue[2]);
  const w = normalizeNumber(input[3], defaultValue[3]);
  const q = [x, y, z, w];
  const lenSq =
    q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3];
  if (!Number.isFinite(lenSq) || lenSq === 0) {
    return defaultValue.slice();
  }
  const invLen = 1 / Math.sqrt(lenSq);
  return [
    q[0] * invLen,
    q[1] * invLen,
    q[2] * invLen,
    q[3] * invLen,
  ];
}
