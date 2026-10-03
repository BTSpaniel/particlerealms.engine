// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AIVehicle.js
 * 
 * ⚠️ MULTIPLAYER: Uses deterministic RNG from AIRandom.js
 */

import { aiRng } from './AIRandom.js';

/**
 * AIVehicle.js (original) - Vehicle and Traffic AI
 * 
 * Features:
 * - Vehicle control (steering, throttle, brake)
 * - Lane following and lane changing
 * - Traffic rules (signals, signs, right of way)
 * - Intersection handling
 * - Collision avoidance
 * - Pursuit and evasion driving
 */

import {
  vec3Sub,
  vec3Add,
  vec3Scale,
  vec3Length,
  vec3Normalize,
  vec3Dot,
} from "../../core/math/EngineMath.js";

// ============================================================================
// CONSTANTS
// ============================================================================

/** Vehicle behavior modes */
export const DRIVE_MODE = {
  NORMAL: "normal",           // Follow traffic rules
  AGGRESSIVE: "aggressive",   // Push limits, less caution
  CAUTIOUS: "cautious",       // Extra safe
  PURSUIT: "pursuit",         // Chasing target
  EVASION: "evasion",         // Fleeing
  PATROL: "patrol",           // Following patrol route
  PARKED: "parked",           // Stationary
};

/** Traffic light states */
export const TRAFFIC_LIGHT = {
  GREEN: "green",
  YELLOW: "yellow",
  RED: "red",
};

// ============================================================================
// VEHICLE DEFINITION
// ============================================================================

/**
 * Create vehicle definition
 * @param {Object} config - Vehicle config
 * @returns {Object} Vehicle definition
 */
export function createVehicleType(config) {
  return {
    id: config.id,
    name: config.name,
    
    // Physical properties
    maxSpeed: config.maxSpeed || 30,      // m/s
    acceleration: config.acceleration || 5,
    braking: config.braking || 10,
    
    // Handling
    maxSteeringAngle: config.maxSteeringAngle || Math.PI / 4,
    steeringSpeed: config.steeringSpeed || 2,   // rad/s
    turnRadius: config.turnRadius || 5,
    
    // Dimensions
    length: config.length || 4,
    width: config.width || 2,
    
    // AI parameters
    followDistance: config.followDistance || 10,
    reactionTime: config.reactionTime || 0.5,
  };
}

// ============================================================================
// VEHICLE INSTANCE
// ============================================================================

/**
 * Create vehicle instance
 * @param {Object} vehicleType - Vehicle type definition
 * @param {number[]} position - Starting position
 * @param {number} heading - Starting heading (radians)
 * @returns {Object} Vehicle instance
 */
export function createVehicle(vehicleType, position, heading = 0) {
  return {
    id: aiRng.uniqueId('vehicle'),
    type: vehicleType,
    
    // Physics state
    position: [...position],
    heading,                    // Radians, 0 = +X
    speed: 0,
    steeringAngle: 0,
    
    // Control inputs
    throttle: 0,               // 0-1
    brake: 0,                  // 0-1
    steeringInput: 0,          // -1 to 1
    
    // AI state
    mode: DRIVE_MODE.NORMAL,
    targetSpeed: 0,
    currentLane: null,
    targetLane: null,
    
    // Path following
    currentPath: [],
    pathIndex: 0,
    
    // Target tracking (for pursuit/evasion)
    pursuitTarget: null,
    
    // Awareness
    vehiclesAhead: [],
    obstaclesAhead: [],
    nearestTrafficLight: null,
    
    // Statistics
    distanceTraveled: 0,
    violations: 0,
  };
}

// ============================================================================
// VEHICLE PHYSICS
// ============================================================================

/**
 * Update vehicle physics
 * @param {Object} vehicle - Vehicle instance
 * @param {number} deltaTime - Seconds elapsed
 */
export function updateVehiclePhysics(vehicle, deltaTime) {
  const type = vehicle.type;
  
  // Apply throttle/brake to speed
  if (vehicle.throttle > 0) {
    vehicle.speed += type.acceleration * vehicle.throttle * deltaTime;
  }
  if (vehicle.brake > 0) {
    // Arcade "brake-to-reverse": braking while already moving forward slows the
    // car normally; braking from a standstill (and not also throttling) shifts
    // into reverse instead of doing nothing (matches GTA/Need for Speed/most
    // Three.js vehicle demos, which use one brake/reverse control).
    if (vehicle.speed > 0.05 || vehicle.throttle > 0) {
      vehicle.speed -= type.braking * vehicle.brake * deltaTime;
    } else {
      vehicle.speed -= type.acceleration * vehicle.brake * deltaTime;
    }
  }
  
  // Natural deceleration
  vehicle.speed *= 0.99;
  
  // Clamp speed (forward up to maxSpeed, reverse up to 40% of maxSpeed)
  const reverseMaxSpeed = type.maxSpeed * 0.4;
  vehicle.speed = Math.max(-reverseMaxSpeed, Math.min(type.maxSpeed, vehicle.speed));
  
  // Apply steering
  const targetSteering = vehicle.steeringInput * type.maxSteeringAngle;
  const steeringDelta = targetSteering - vehicle.steeringAngle;
  vehicle.steeringAngle += Math.sign(steeringDelta) * 
    Math.min(Math.abs(steeringDelta), type.steeringSpeed * deltaTime);
  
  // Update heading based on steering and speed (abs() so reverse steers too —
  // sign of speed naturally flips the effective turn direction).
  if (Math.abs(vehicle.speed) > 0.1) {
    const turnRate = Math.tan(vehicle.steeringAngle) * vehicle.speed / type.length;
    vehicle.heading += turnRate * deltaTime;
  }
  
  // Normalize heading
  while (vehicle.heading > Math.PI) vehicle.heading -= Math.PI * 2;
  while (vehicle.heading < -Math.PI) vehicle.heading += Math.PI * 2;
  
  // Update position
  const moveX = Math.cos(vehicle.heading) * vehicle.speed * deltaTime;
  const moveZ = Math.sin(vehicle.heading) * vehicle.speed * deltaTime;
  
  vehicle.position[0] += moveX;
  vehicle.position[2] += moveZ;
  
  vehicle.distanceTraveled += vehicle.speed * deltaTime;
}

// ============================================================================
// AI DRIVING
// ============================================================================

/**
 * Update vehicle AI
 * @param {Object} vehicle - Vehicle instance
 * @param {Object} world - World data (roads, traffic, etc.)
 * @param {number} deltaTime - Seconds elapsed
 */
export function updateVehicleAI(vehicle, world, deltaTime) {
  switch (vehicle.mode) {
    case DRIVE_MODE.NORMAL:
      updateNormalDriving(vehicle, world, deltaTime);
      break;
      
    case DRIVE_MODE.PURSUIT:
      updatePursuit(vehicle, world, deltaTime);
      break;
      
    case DRIVE_MODE.EVASION:
      updateEvasion(vehicle, world, deltaTime);
      break;
      
    case DRIVE_MODE.PATROL:
      updatePatrol(vehicle, world, deltaTime);
      break;
      
    case DRIVE_MODE.PARKED:
      vehicle.throttle = 0;
      vehicle.brake = 1;
      break;
      
    default:
      updateNormalDriving(vehicle, world, deltaTime);
  }
}

/**
 * Normal driving behavior
 */
function updateNormalDriving(vehicle, world, deltaTime) {
  // Follow current path
  if (vehicle.currentPath.length > 0) {
    followPath(vehicle);
  }
  
  // Check for obstacles ahead
  const stopDistance = calculateStopDistance(vehicle);
  const obstacleAhead = findObstacleAhead(vehicle, world, stopDistance * 2);
  
  if (obstacleAhead) {
    // Slow down or stop
    const distToObstacle = obstacleAhead.distance;
    
    if (distToObstacle < stopDistance) {
      vehicle.brake = 1;
      vehicle.throttle = 0;
    } else if (distToObstacle < stopDistance * 2) {
      vehicle.throttle = 0.2;
      vehicle.brake = 0.3;
    }
  } else {
    // Accelerate to target speed
    speedControl(vehicle, vehicle.targetSpeed);
  }
  
  // Check traffic lights
  if (vehicle.nearestTrafficLight) {
    handleTrafficLight(vehicle, vehicle.nearestTrafficLight);
  }
}

/**
 * Pursuit driving behavior
 */
function updatePursuit(vehicle, world, deltaTime) {
  if (!vehicle.pursuitTarget) {
    vehicle.mode = DRIVE_MODE.NORMAL;
    return;
  }
  
  const targetPos = vehicle.pursuitTarget.position;
  const toTarget = vec3Sub(targetPos, vehicle.position);
  const targetAngle = Math.atan2(toTarget[2], toTarget[0]);
  
  // Steer toward target
  const angleDiff = normalizeAngle(targetAngle - vehicle.heading);
  vehicle.steeringInput = Math.max(-1, Math.min(1, angleDiff * 2));
  
  // Full throttle, less brake
  vehicle.throttle = 0.9;
  vehicle.brake = 0;
  
  // Still avoid crashes
  const obstacleAhead = findObstacleAhead(vehicle, world, 20);
  if (obstacleAhead && obstacleAhead.distance < 10) {
    vehicle.brake = 0.5;
  }
}

/**
 * Evasion driving behavior
 */
function updateEvasion(vehicle, world, deltaTime) {
  if (!vehicle.pursuitTarget) {
    vehicle.mode = DRIVE_MODE.NORMAL;
    return;
  }
  
  const threatPos = vehicle.pursuitTarget.position;
  const awayFromThreat = vec3Normalize(vec3Sub(vehicle.position, threatPos));
  const targetAngle = Math.atan2(awayFromThreat[2], awayFromThreat[0]);
  
  // Add some randomness for unpredictability
  const randomOffset = aiRng.range(-0.25, 0.25);
  
  // Steer away
  const angleDiff = normalizeAngle(targetAngle - vehicle.heading + randomOffset);
  vehicle.steeringInput = Math.max(-1, Math.min(1, angleDiff * 2));
  
  // Full throttle
  vehicle.throttle = 1.0;
  vehicle.brake = 0;
}

/**
 * Patrol driving behavior
 */
function updatePatrol(vehicle, world, deltaTime) {
  if (vehicle.currentPath.length === 0) {
    return;
  }
  
  followPath(vehicle);
  speedControl(vehicle, vehicle.type.maxSpeed * 0.6);
  
  // Loop patrol route
  if (vehicle.pathIndex >= vehicle.currentPath.length - 1) {
    vehicle.pathIndex = 0;
  }
}

// ============================================================================
// PATH FOLLOWING
// ============================================================================

/**
 * Follow path waypoints
 */
function followPath(vehicle) {
  if (vehicle.pathIndex >= vehicle.currentPath.length) {
    return;
  }
  
  const waypoint = vehicle.currentPath[vehicle.pathIndex];
  const toWaypoint = vec3Sub(waypoint, vehicle.position);
  const distToWaypoint = vec3Length(toWaypoint);
  
  // Check if we've reached waypoint
  if (distToWaypoint < 5) {
    vehicle.pathIndex++;
    return;
  }
  
  // Steer toward waypoint
  const targetAngle = Math.atan2(toWaypoint[2], toWaypoint[0]);
  const angleDiff = normalizeAngle(targetAngle - vehicle.heading);
  
  vehicle.steeringInput = Math.max(-1, Math.min(1, angleDiff * 3));
}

/**
 * Set vehicle path
 * @param {Object} vehicle - Vehicle
 * @param {Array<number[]>} path - Path waypoints
 */
export function setVehiclePath(vehicle, path) {
  vehicle.currentPath = path;
  vehicle.pathIndex = 0;
}

// ============================================================================
// SPEED CONTROL
// ============================================================================

/**
 * Control speed to match target
 */
function speedControl(vehicle, targetSpeed) {
  const speedDiff = targetSpeed - vehicle.speed;
  
  if (speedDiff > 1) {
    vehicle.throttle = Math.min(1, speedDiff * 0.2);
    vehicle.brake = 0;
  } else if (speedDiff < -1) {
    vehicle.throttle = 0;
    vehicle.brake = Math.min(1, -speedDiff * 0.2);
  } else {
    vehicle.throttle = 0.1;
    vehicle.brake = 0;
  }
}

/**
 * Calculate stopping distance
 */
function calculateStopDistance(vehicle) {
  // s = v²/2a + reaction time distance
  const reactionDist = vehicle.speed * vehicle.type.reactionTime;
  const brakingDist = (vehicle.speed * vehicle.speed) / (2 * vehicle.type.braking);
  return reactionDist + brakingDist + 2; // +2 safety margin
}

// ============================================================================
// OBSTACLE DETECTION
// ============================================================================

/**
 * Find obstacle ahead of vehicle
 * @param {Object} vehicle - Vehicle
 * @param {Object} world - World data
 * @param {number} maxDistance - Max check distance
 * @returns {{type: string, distance: number, entity: Object}|null}
 */
function findObstacleAhead(vehicle, world, maxDistance) {
  const forward = [Math.cos(vehicle.heading), 0, Math.sin(vehicle.heading)];
  
  let nearest = null;
  let nearestDist = maxDistance;
  
  // Check other vehicles
  if (world.vehicles) {
    for (const other of world.vehicles) {
      if (other.id === vehicle.id) continue;
      
      const toOther = vec3Sub(other.position, vehicle.position);
      const dist = vec3Length(toOther);
      
      if (dist > nearestDist) continue;
      
      // Check if in front
      const dotForward = vec3Dot(vec3Normalize(toOther), forward);
      if (dotForward < 0.7) continue; // Not in front
      
      nearestDist = dist;
      nearest = { type: "vehicle", distance: dist, entity: other };
    }
  }
  
  // Check static obstacles
  if (world.obstacles) {
    for (const obs of world.obstacles) {
      const toObs = vec3Sub(obs.position, vehicle.position);
      const dist = vec3Length(toObs);
      
      if (dist > nearestDist) continue;
      
      const dotForward = vec3Dot(vec3Normalize(toObs), forward);
      if (dotForward < 0.7) continue;
      
      nearestDist = dist;
      nearest = { type: "obstacle", distance: dist, entity: obs };
    }
  }
  
  return nearest;
}

// ============================================================================
// TRAFFIC LIGHTS
// ============================================================================

/**
 * Handle traffic light
 */
function handleTrafficLight(vehicle, light) {
  const distToLight = vec3Length(vec3Sub(light.position, vehicle.position));
  const stopDistance = calculateStopDistance(vehicle);
  
  switch (light.state) {
    case TRAFFIC_LIGHT.RED:
      if (distToLight < stopDistance * 2) {
        vehicle.brake = 0.8;
        vehicle.throttle = 0;
      }
      break;
      
    case TRAFFIC_LIGHT.YELLOW:
      // Stop if we can, otherwise proceed
      if (distToLight > stopDistance) {
        vehicle.brake = 0.6;
        vehicle.throttle = 0;
      }
      break;
      
    case TRAFFIC_LIGHT.GREEN:
      // Proceed normally
      break;
  }
}

// ============================================================================
// TRAFFIC SYSTEM
// ============================================================================

/**
 * Create traffic system
 * @param {Object} config - Config
 * @returns {Object} Traffic system
 */
export function createTrafficSystem(config = {}) {
  return {
    vehicles: new Map(),
    trafficLights: [],
    roads: [],
    intersections: [],
    
    // Spawning
    spawnPoints: [],
    despawnPoints: [],
    maxVehicles: config.maxVehicles || 50,
    spawnRate: config.spawnRate || 0.1, // Per second
    
    // Statistics
    totalSpawned: 0,
    totalDespawned: 0,
  };
}

/**
 * Update traffic system
 * @param {Object} traffic - Traffic system
 * @param {number} deltaTime - Seconds elapsed
 */
export function updateTrafficSystem(traffic, deltaTime) {
  const world = {
    vehicles: Array.from(traffic.vehicles.values()),
    obstacles: [],
  };
  
  // Update all vehicles
  for (const [id, vehicle] of traffic.vehicles) {
    // Update AI
    updateVehicleAI(vehicle, world, deltaTime);
    
    // Update physics
    updateVehiclePhysics(vehicle, deltaTime);
    
    // Check for despawn
    for (const despawn of traffic.despawnPoints) {
      const dist = vec3Length(vec3Sub(despawn.position, vehicle.position));
      if (dist < despawn.radius) {
        traffic.vehicles.delete(id);
        traffic.totalDespawned++;
        break;
      }
    }
  }
  
  // Update traffic lights
  for (const light of traffic.trafficLights) {
    updateTrafficLight(light, deltaTime);
  }
  
  // Spawn new vehicles
  if (traffic.vehicles.size < traffic.maxVehicles && aiRng.chance(traffic.spawnRate * deltaTime)) {
    spawnTrafficVehicle(traffic);
  }
}

/**
 * Update traffic light cycle
 */
function updateTrafficLight(light, deltaTime) {
  light.timer += deltaTime;
  
  if (light.timer >= light.duration) {
    light.timer = 0;
    
    // Cycle to next state
    switch (light.state) {
      case TRAFFIC_LIGHT.GREEN:
        light.state = TRAFFIC_LIGHT.YELLOW;
        light.duration = 3;
        break;
      case TRAFFIC_LIGHT.YELLOW:
        light.state = TRAFFIC_LIGHT.RED;
        light.duration = light.redDuration || 30;
        break;
      case TRAFFIC_LIGHT.RED:
        light.state = TRAFFIC_LIGHT.GREEN;
        light.duration = light.greenDuration || 30;
        break;
    }
  }
}

/**
 * Spawn traffic vehicle
 */
function spawnTrafficVehicle(traffic) {
  if (traffic.spawnPoints.length === 0) return;
  
  const spawn = aiRng.pick(traffic.spawnPoints);
  const vehicleType = createVehicleType({
    id: "car",
    name: "Car",
    maxSpeed: aiRng.range(15, 25),
  });
  
  const vehicle = createVehicle(vehicleType, spawn.position, spawn.heading);
  vehicle.targetSpeed = vehicle.type.maxSpeed * aiRng.range(0.6, 0.9);
  
  if (spawn.path) {
    setVehiclePath(vehicle, spawn.path);
  }
  
  traffic.vehicles.set(vehicle.id, vehicle);
  traffic.totalSpawned++;
}

// ============================================================================
// UTILITIES
// ============================================================================

function normalizeAngle(angle) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

// ============================================================================
// PRESET VEHICLE TYPES
// ============================================================================

export const PRESET_VEHICLES = {
  sedan: createVehicleType({ id: "sedan", name: "Sedan", maxSpeed: 40, acceleration: 4, length: 4.5, width: 1.8 }),
  truck: createVehicleType({ id: "truck", name: "Truck", maxSpeed: 30, acceleration: 2.5, length: 8, width: 2.5, turnRadius: 8 }),
  sports: createVehicleType({ id: "sports", name: "Sports Car", maxSpeed: 60, acceleration: 8, length: 4, width: 1.9, steeringSpeed: 3 }),
  motorcycle: createVehicleType({ id: "motorcycle", name: "Motorcycle", maxSpeed: 50, acceleration: 6, length: 2, width: 0.8, turnRadius: 2 }),
  bus: createVehicleType({ id: "bus", name: "Bus", maxSpeed: 25, acceleration: 2, length: 12, width: 2.5, turnRadius: 10 }),
};
