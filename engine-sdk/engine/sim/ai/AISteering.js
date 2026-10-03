// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AISteering.js
 * 
 * ⚠️ MULTIPLAYER: Uses deterministic RNG from AIRandom.js
 * 
 * Uses AISchema.js for consistent steering agent definitions.
 */

import { aiRng } from './AIRandom.js';
import {
  STEERING_BEHAVIORS,
  STEERING_AGENT_SCHEMA,
  createDefaultSteeringAgent,
  validateSteeringAgent,
} from './AISchema.js';

/**
 * AISteering.js (original) - Steering Behaviors
 * 
 * Based on Craig Reynolds' autonomous steering behaviors:
 * - Seek, Flee, Arrive, Pursue, Evade
 * - Wander, Obstacle Avoidance
 * - Flocking (Separation, Alignment, Cohesion)
 * - Path Following, Flow Field
 */

import {
  vec3,
  vec3Add,
  vec3Sub,
  vec3Scale,
  vec3Dot,
  vec3Length,
  vec3Normalize,
  vec3Cross,
} from "../../core/math/EngineMath.js";

// Re-export schema types
export { STEERING_BEHAVIORS };

// ============================================================================
// STEERING AGENT
// ============================================================================

/**
 * Create a steering agent
 * Uses AISchema defaults for consistent configuration
 * @param {Object} config - Agent configuration
 * @returns {Object} Steering agent
 */
export function createSteeringAgent(config = {}) {
  // Validate and apply defaults from schema
  const { value: validated } = validateSteeringAgent(config);
  
  return {
    position: config.position ? [...config.position] : [0, 0, 0],
    velocity: config.velocity ? [...config.velocity] : [0, 0, 0],
    acceleration: [0, 0, 0],
    
    maxSpeed: validated.maxSpeed,
    maxForce: validated.maxForce,
    mass: validated.mass,
    
    // For wander behavior
    wanderAngle: 0,
    wanderRadius: validated.wanderRadius,
    wanderDistance: validated.wanderDistance,
    wanderJitter: validated.wanderJitter,
    
    // For obstacle avoidance
    avoidanceRadius: validated.avoidanceRadius,
    lookAheadDistance: validated.lookAheadDistance,
  };
}

/**
 * Apply steering force to agent
 * @param {Object} agent - Steering agent
 * @param {number[]} force - Force vector
 */
export function applyForce(agent, force) {
  // F = ma, so a = F/m
  const scaledForce = vec3Scale(force, 1 / agent.mass);
  agent.acceleration = vec3Add(agent.acceleration, scaledForce);
}

/**
 * Update agent physics
 * @param {Object} agent - Steering agent
 * @param {number} deltaTime - Delta time in seconds
 */
export function updateSteering(agent, deltaTime) {
  // Update velocity
  agent.velocity = vec3Add(agent.velocity, vec3Scale(agent.acceleration, deltaTime));
  
  // Limit speed
  const speed = vec3Length(agent.velocity);
  if (speed > agent.maxSpeed) {
    agent.velocity = vec3Scale(vec3Normalize(agent.velocity), agent.maxSpeed);
  }
  
  // Update position
  agent.position = vec3Add(agent.position, vec3Scale(agent.velocity, deltaTime));
  
  // Reset acceleration
  agent.acceleration = [0, 0, 0];
}

/**
 * Limit force magnitude
 * @param {number[]} force - Force vector
 * @param {number} max - Maximum magnitude
 * @returns {number[]} Limited force
 */
function limitForce(force, max) {
  const mag = vec3Length(force);
  if (mag > max) {
    return vec3Scale(vec3Normalize(force), max);
  }
  return force;
}

// ============================================================================
// BASIC BEHAVIORS
// ============================================================================

/**
 * Seek: steer toward target
 * @param {Object} agent - Steering agent
 * @param {number[]} target - Target position
 * @returns {number[]} Steering force
 */
export function seek(agent, target) {
  const desired = vec3Sub(target, agent.position);
  const desiredNorm = vec3Normalize(desired);
  const desiredVel = vec3Scale(desiredNorm, agent.maxSpeed);
  const steer = vec3Sub(desiredVel, agent.velocity);
  return limitForce(steer, agent.maxForce);
}

/**
 * Flee: steer away from target
 * @param {Object} agent - Steering agent
 * @param {number[]} target - Target position to flee from
 * @returns {number[]} Steering force
 */
export function flee(agent, target) {
  const desired = vec3Sub(agent.position, target);
  const desiredNorm = vec3Normalize(desired);
  const desiredVel = vec3Scale(desiredNorm, agent.maxSpeed);
  const steer = vec3Sub(desiredVel, agent.velocity);
  return limitForce(steer, agent.maxForce);
}

/**
 * Arrive: seek with slowing near target
 * @param {Object} agent - Steering agent
 * @param {number[]} target - Target position
 * @param {number} slowingRadius - Distance to start slowing
 * @returns {number[]} Steering force
 */
export function arrive(agent, target, slowingRadius = 5) {
  const toTarget = vec3Sub(target, agent.position);
  const dist = vec3Length(toTarget);
  
  if (dist < 0.1) return [0, 0, 0];
  
  const desiredSpeed = dist < slowingRadius
    ? agent.maxSpeed * (dist / slowingRadius)
    : agent.maxSpeed;
  
  const desired = vec3Scale(vec3Normalize(toTarget), desiredSpeed);
  const steer = vec3Sub(desired, agent.velocity);
  return limitForce(steer, agent.maxForce);
}

/**
 * Pursue: seek predicted future position of moving target
 * @param {Object} agent - Steering agent
 * @param {number[]} targetPos - Target current position
 * @param {number[]} targetVel - Target velocity
 * @returns {number[]} Steering force
 */
export function pursue(agent, targetPos, targetVel) {
  const toTarget = vec3Sub(targetPos, agent.position);
  const dist = vec3Length(toTarget);
  
  // Predict based on distance
  const prediction = dist / agent.maxSpeed;
  const futurePos = vec3Add(targetPos, vec3Scale(targetVel, prediction));
  
  return seek(agent, futurePos);
}

/**
 * Evade: flee from predicted future position
 * @param {Object} agent - Steering agent
 * @param {number[]} targetPos - Pursuer position
 * @param {number[]} targetVel - Pursuer velocity
 * @returns {number[]} Steering force
 */
export function evade(agent, targetPos, targetVel) {
  const toTarget = vec3Sub(targetPos, agent.position);
  const dist = vec3Length(toTarget);
  
  const prediction = dist / agent.maxSpeed;
  const futurePos = vec3Add(targetPos, vec3Scale(targetVel, prediction));
  
  return flee(agent, futurePos);
}

// ============================================================================
// WANDER
// ============================================================================

/**
 * Wander: random steering
 * @param {Object} agent - Steering agent
 * @returns {number[]} Steering force
 */
export function wander(agent) {
  // Add random jitter to wander angle
  agent.wanderAngle += aiRng.range(-1, 1) * agent.wanderJitter;
  
  // Calculate circle center ahead of agent
  const velocity = vec3Length(agent.velocity) > 0.1 
    ? vec3Normalize(agent.velocity)
    : [0, 0, 1];
  const circleCenter = vec3Add(
    agent.position,
    vec3Scale(velocity, agent.wanderDistance)
  );
  
  // Calculate point on circle
  const displacement = [
    Math.cos(agent.wanderAngle) * agent.wanderRadius,
    0,
    Math.sin(agent.wanderAngle) * agent.wanderRadius,
  ];
  
  const target = vec3Add(circleCenter, displacement);
  return seek(agent, target);
}

// ============================================================================
// OBSTACLE AVOIDANCE
// ============================================================================

/**
 * Avoid obstacles using ray casting
 * @param {Object} agent - Steering agent
 * @param {Array<{center: number[], radius: number}>} obstacles - Sphere obstacles
 * @returns {number[]} Steering force
 */
export function avoidObstacles(agent, obstacles) {
  const speed = vec3Length(agent.velocity);
  if (speed < 0.1) return [0, 0, 0];
  
  const ahead = vec3Add(
    agent.position,
    vec3Scale(vec3Normalize(agent.velocity), agent.lookAheadDistance)
  );
  
  const aheadHalf = vec3Add(
    agent.position,
    vec3Scale(vec3Normalize(agent.velocity), agent.lookAheadDistance * 0.5)
  );
  
  // Find most threatening obstacle
  let nearestObstacle = null;
  let nearestDist = Infinity;
  
  for (const obs of obstacles) {
    const dist = vec3Length(vec3Sub(obs.center, agent.position));
    const effectiveRadius = obs.radius + agent.avoidanceRadius;
    
    // Check if ahead points are within obstacle
    const aheadDist = vec3Length(vec3Sub(ahead, obs.center));
    const halfDist = vec3Length(vec3Sub(aheadHalf, obs.center));
    const posDist = vec3Length(vec3Sub(agent.position, obs.center));
    
    const willCollide = aheadDist < effectiveRadius || 
                        halfDist < effectiveRadius ||
                        posDist < effectiveRadius;
    
    if (willCollide && dist < nearestDist) {
      nearestDist = dist;
      nearestObstacle = obs;
    }
  }
  
  if (!nearestObstacle) return [0, 0, 0];
  
  // Calculate avoidance force
  const avoidance = vec3Sub(ahead, nearestObstacle.center);
  return limitForce(vec3Scale(vec3Normalize(avoidance), agent.maxForce), agent.maxForce);
}

/**
 * Avoid walls using feeler rays
 * @param {Object} agent - Steering agent
 * @param {Array<{normal: number[], point: number[]}>} walls - Wall planes
 * @returns {number[]} Steering force
 */
export function avoidWalls(agent, walls) {
  const speed = vec3Length(agent.velocity);
  if (speed < 0.1) return [0, 0, 0];
  
  const forward = vec3Normalize(agent.velocity);
  const right = vec3Normalize(vec3Cross(forward, [0, 1, 0]));
  
  // Cast 3 feeler rays
  const feelers = [
    vec3Add(agent.position, vec3Scale(forward, agent.lookAheadDistance)),
    vec3Add(agent.position, vec3Add(
      vec3Scale(forward, agent.lookAheadDistance * 0.7),
      vec3Scale(right, agent.lookAheadDistance * 0.5)
    )),
    vec3Add(agent.position, vec3Add(
      vec3Scale(forward, agent.lookAheadDistance * 0.7),
      vec3Scale(right, -agent.lookAheadDistance * 0.5)
    )),
  ];
  
  let steer = [0, 0, 0];
  
  for (const feeler of feelers) {
    for (const wall of walls) {
      // Check if feeler crosses wall plane
      const toFeeler = vec3Sub(feeler, wall.point);
      const dist = vec3Dot(toFeeler, wall.normal);
      
      if (dist < agent.avoidanceRadius) {
        // Push away from wall
        const force = vec3Scale(wall.normal, (agent.avoidanceRadius - dist) * agent.maxForce);
        steer = vec3Add(steer, force);
      }
    }
  }
  
  return limitForce(steer, agent.maxForce);
}

// ============================================================================
// FLOCKING (BOIDS)
// ============================================================================

/**
 * Separation: steer away from nearby agents
 * @param {Object} agent - Steering agent
 * @param {Array<Object>} neighbors - Nearby agents
 * @param {number} separationRadius - Distance to separate from
 * @returns {number[]} Steering force
 */
export function separation(agent, neighbors, separationRadius = 3) {
  let steer = [0, 0, 0];
  let count = 0;
  
  for (const other of neighbors) {
    const diff = vec3Sub(agent.position, other.position);
    const dist = vec3Length(diff);
    
    if (dist > 0 && dist < separationRadius) {
      // Weight by distance (closer = stronger)
      const weighted = vec3Scale(vec3Normalize(diff), 1 / dist);
      steer = vec3Add(steer, weighted);
      count++;
    }
  }
  
  if (count > 0) {
    steer = vec3Scale(steer, 1 / count);
    steer = vec3Scale(vec3Normalize(steer), agent.maxSpeed);
    steer = vec3Sub(steer, agent.velocity);
  }
  
  return limitForce(steer, agent.maxForce);
}

/**
 * Alignment: steer toward average heading of neighbors
 * @param {Object} agent - Steering agent
 * @param {Array<Object>} neighbors - Nearby agents
 * @param {number} alignmentRadius - Neighborhood radius
 * @returns {number[]} Steering force
 */
export function alignment(agent, neighbors, alignmentRadius = 5) {
  let avgVel = [0, 0, 0];
  let count = 0;
  
  for (const other of neighbors) {
    const dist = vec3Length(vec3Sub(agent.position, other.position));
    
    if (dist > 0 && dist < alignmentRadius) {
      avgVel = vec3Add(avgVel, other.velocity);
      count++;
    }
  }
  
  if (count > 0) {
    avgVel = vec3Scale(avgVel, 1 / count);
    avgVel = vec3Scale(vec3Normalize(avgVel), agent.maxSpeed);
    const steer = vec3Sub(avgVel, agent.velocity);
    return limitForce(steer, agent.maxForce);
  }
  
  return [0, 0, 0];
}

/**
 * Cohesion: steer toward center of neighbors
 * @param {Object} agent - Steering agent
 * @param {Array<Object>} neighbors - Nearby agents
 * @param {number} cohesionRadius - Neighborhood radius
 * @returns {number[]} Steering force
 */
export function cohesion(agent, neighbors, cohesionRadius = 8) {
  let center = [0, 0, 0];
  let count = 0;
  
  for (const other of neighbors) {
    const dist = vec3Length(vec3Sub(agent.position, other.position));
    
    if (dist > 0 && dist < cohesionRadius) {
      center = vec3Add(center, other.position);
      count++;
    }
  }
  
  if (count > 0) {
    center = vec3Scale(center, 1 / count);
    return seek(agent, center);
  }
  
  return [0, 0, 0];
}

/**
 * Combined flocking behavior
 * @param {Object} agent - Steering agent
 * @param {Array<Object>} neighbors - Nearby agents
 * @param {Object} weights - Behavior weights
 * @returns {number[]} Combined steering force
 */
export function flock(agent, neighbors, weights = {}) {
  const w = {
    separation: weights.separation ?? 1.5,
    alignment: weights.alignment ?? 1.0,
    cohesion: weights.cohesion ?? 1.0,
  };
  
  const sep = separation(agent, neighbors);
  const ali = alignment(agent, neighbors);
  const coh = cohesion(agent, neighbors);
  
  let steer = [0, 0, 0];
  steer = vec3Add(steer, vec3Scale(sep, w.separation));
  steer = vec3Add(steer, vec3Scale(ali, w.alignment));
  steer = vec3Add(steer, vec3Scale(coh, w.cohesion));
  
  return limitForce(steer, agent.maxForce);
}

// ============================================================================
// PATH FOLLOWING
// ============================================================================

/**
 * Follow a path
 * @param {Object} agent - Steering agent
 * @param {Array<number[]>} path - Array of waypoints
 * @param {number} pathRadius - Radius to consider "on path"
 * @returns {{force: number[], waypointIndex: number}}
 */
export function followPath(agent, path, pathRadius = 2) {
  if (path.length === 0) return { force: [0, 0, 0], waypointIndex: 0 };
  
  // Find closest point on path
  let closestDist = Infinity;
  let closestSegment = 0;
  let closestPoint = path[0];
  
  for (let i = 0; i < path.length - 1; i++) {
    const projection = projectPointOnSegment(agent.position, path[i], path[i + 1]);
    const dist = vec3Length(vec3Sub(agent.position, projection.point));
    
    if (dist < closestDist) {
      closestDist = dist;
      closestSegment = i;
      closestPoint = projection.point;
    }
  }
  
  // Target point ahead on path
  let targetIndex = closestSegment;
  let target = closestPoint;
  
  // Move ahead on path
  const lookAhead = agent.lookAheadDistance;
  let remaining = lookAhead;
  
  for (let i = closestSegment; i < path.length - 1 && remaining > 0; i++) {
    const segmentLen = vec3Length(vec3Sub(path[i + 1], path[i]));
    if (remaining > segmentLen) {
      remaining -= segmentLen;
      targetIndex = i + 1;
    } else {
      const t = remaining / segmentLen;
      target = vec3Add(path[i], vec3Scale(vec3Sub(path[i + 1], path[i]), t));
      break;
    }
  }
  
  // If past end, seek last point
  if (targetIndex >= path.length - 1) {
    target = path[path.length - 1];
  }
  
  // Only steer if off path
  if (closestDist > pathRadius) {
    return { force: seek(agent, target), waypointIndex: targetIndex };
  }
  
  return { force: seek(agent, target), waypointIndex: targetIndex };
}

/**
 * Project point onto line segment
 * @param {number[]} point - Point to project
 * @param {number[]} a - Segment start
 * @param {number[]} b - Segment end
 * @returns {{point: number[], t: number}} Projected point and parameter
 */
function projectPointOnSegment(point, a, b) {
  const ab = vec3Sub(b, a);
  const ap = vec3Sub(point, a);
  const abLen = vec3Length(ab);
  
  if (abLen < 0.001) return { point: [...a], t: 0 };
  
  const t = Math.max(0, Math.min(1, vec3Dot(ap, ab) / (abLen * abLen)));
  const projected = vec3Add(a, vec3Scale(ab, t));
  
  return { point: projected, t };
}

// ============================================================================
// FLOW FIELD
// ============================================================================

/**
 * Create a flow field
 * @param {number} width - Grid width
 * @param {number} height - Grid height
 * @param {number} cellSize - Cell size in world units
 * @returns {Object} Flow field
 */
export function createFlowField(width, height, cellSize) {
  return {
    width,
    height,
    cellSize,
    // Each cell stores a 2D direction [x, z]
    data: new Float32Array(width * height * 2),
  };
}

/**
 * Set flow field cell direction
 * @param {Object} field - Flow field
 * @param {number} x - Cell X
 * @param {number} y - Cell Y
 * @param {number} dirX - Direction X
 * @param {number} dirZ - Direction Z
 */
export function setFlowDirection(field, x, y, dirX, dirZ) {
  if (x < 0 || y < 0 || x >= field.width || y >= field.height) return;
  const idx = (y * field.width + x) * 2;
  field.data[idx] = dirX;
  field.data[idx + 1] = dirZ;
}

/**
 * Get flow direction at world position
 * @param {Object} field - Flow field
 * @param {number} worldX - World X
 * @param {number} worldZ - World Z
 * @returns {number[]} Direction [x, 0, z]
 */
export function getFlowDirection(field, worldX, worldZ) {
  const x = Math.floor(worldX / field.cellSize);
  const y = Math.floor(worldZ / field.cellSize);
  
  if (x < 0 || y < 0 || x >= field.width || y >= field.height) {
    return [0, 0, 0];
  }
  
  const idx = (y * field.width + x) * 2;
  return [field.data[idx], 0, field.data[idx + 1]];
}

/**
 * Follow flow field
 * @param {Object} agent - Steering agent
 * @param {Object} field - Flow field
 * @returns {number[]} Steering force
 */
export function followFlowField(agent, field) {
  const dir = getFlowDirection(field, agent.position[0], agent.position[2]);
  
  if (vec3Length(dir) < 0.001) return [0, 0, 0];
  
  const desired = vec3Scale(vec3Normalize(dir), agent.maxSpeed);
  const steer = vec3Sub(desired, agent.velocity);
  
  return limitForce(steer, agent.maxForce);
}

/**
 * Generate flow field toward target
 * @param {Object} field - Flow field
 * @param {number} targetX - Target world X
 * @param {number} targetZ - Target world Z
 */
export function generateFlowFieldToTarget(field, targetX, targetZ) {
  const tx = Math.floor(targetX / field.cellSize);
  const tz = Math.floor(targetZ / field.cellSize);
  
  for (let y = 0; y < field.height; y++) {
    for (let x = 0; x < field.width; x++) {
      const dx = tx - x;
      const dz = tz - y;
      const len = Math.sqrt(dx * dx + dz * dz);
      
      if (len > 0.001) {
        setFlowDirection(field, x, y, dx / len, dz / len);
      } else {
        setFlowDirection(field, x, y, 0, 0);
      }
    }
  }
}
