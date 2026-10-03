// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AICrowd.js
 * 
 * ⚠️ MULTIPLAYER: Uses deterministic RNG from AIRandom.js
 */

import { aiRng } from './AIRandom.js';

/**
 * AICrowd.js (original) - Large-Scale Crowd Simulation
 * 
 * Features:
 * - Mass crowd movement and flow
 * - Panic and stampede simulation
 * - Social forces model
 * - Bottleneck and congestion handling
 * - Event-driven crowd behavior (concerts, riots, evacuations)
 */

import {
  vec3Sub,
  vec3Add,
  vec3Scale,
  vec3Length,
  vec3Normalize,
} from "../../core/math/EngineMath.js";

// ============================================================================
// CONSTANTS
// ============================================================================

/** Crowd behavior modes */
export const CROWD_BEHAVIOR = {
  NORMAL: "normal",           // Walking around
  GATHERING: "gathering",     // Moving toward event
  DISPERSING: "dispersing",   // Leaving area
  PANIC: "panic",             // Fleeing in fear
  STAMPEDE: "stampede",       // Dangerous crush
  PROTESTING: "protesting",   // Organized movement
  QUEUING: "queuing",         // Waiting in line
  WATCHING: "watching",       // Observing event
};

/** Individual agent states */
export const AGENT_STATE = {
  IDLE: "idle",
  WALKING: "walking",
  RUNNING: "running",
  PUSHING: "pushing",
  FALLEN: "fallen",
  INJURED: "injured",
  DEAD: "dead",
};

// ============================================================================
// SOCIAL FORCES MODEL
// ============================================================================

/**
 * Calculate social force (Helbing model)
 * @param {Object} agent - Agent
 * @param {Array} neighbors - Nearby agents
 * @param {Array} walls - Wall segments
 * @param {number[]} goal - Goal position
 * @returns {number[]} Force vector
 */
export function calculateSocialForce(agent, neighbors, walls, goal) {
  const force = [0, 0, 0];
  
  // 1. Desired velocity force (toward goal)
  if (goal) {
    const toGoal = vec3Sub(goal, agent.position);
    const dist = vec3Length(toGoal);
    if (dist > 0.1) {
      const desiredVel = vec3Scale(vec3Normalize(toGoal), agent.desiredSpeed);
      const velDiff = vec3Sub(desiredVel, agent.velocity);
      const driveForce = vec3Scale(velDiff, 1 / agent.relaxationTime);
      force[0] += driveForce[0];
      force[2] += driveForce[2];
    }
  }
  
  // 2. Repulsion from other agents
  for (const other of neighbors) {
    if (other.id === agent.id) continue;
    
    const diff = vec3Sub(agent.position, other.position);
    const dist = vec3Length(diff);
    const minDist = agent.radius + other.radius;
    
    if (dist < minDist * 3 && dist > 0.01) {
      const dir = vec3Normalize(diff);
      
      // Exponential repulsion
      const repulsion = agent.repulsionStrength * Math.exp((minDist - dist) / agent.repulsionRange);
      force[0] += dir[0] * repulsion;
      force[2] += dir[2] * repulsion;
      
      // Physical pushing force if overlapping
      if (dist < minDist) {
        const pushForce = agent.bodyForce * (minDist - dist);
        force[0] += dir[0] * pushForce;
        force[2] += dir[2] * pushForce;
      }
    }
  }
  
  // 3. Repulsion from walls
  for (const wall of walls) {
    const wallForce = calculateWallForce(agent, wall);
    force[0] += wallForce[0];
    force[2] += wallForce[2];
  }
  
  return force;
}

/**
 * Calculate repulsion from wall
 */
function calculateWallForce(agent, wall) {
  // Wall defined as {start, end, normal}
  const toWall = projectPointOnSegment(agent.position, wall.start, wall.end);
  const diff = vec3Sub(agent.position, toWall);
  const dist = vec3Length(diff);
  
  if (dist < agent.radius * 3 && dist > 0.01) {
    const dir = vec3Normalize(diff);
    const repulsion = agent.wallRepulsion * Math.exp((agent.radius - dist) / 0.5);
    return [dir[0] * repulsion, 0, dir[2] * repulsion];
  }
  
  return [0, 0, 0];
}

function projectPointOnSegment(point, a, b) {
  const ab = vec3Sub(b, a);
  const ap = vec3Sub(point, a);
  const abLen = vec3Length(ab);
  if (abLen < 0.001) return [...a];
  
  const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[2] * ab[2]) / (abLen * abLen)));
  return [a[0] + ab[0] * t, a[1], a[2] + ab[2] * t];
}

// ============================================================================
// CROWD AGENT
// ============================================================================

/**
 * Create crowd agent
 * @param {number[]} position - Position
 * @param {Object} config - Config
 * @returns {Object} Agent
 */
export function createCrowdAgent(position, config = {}) {
  return {
    id: aiRng.uniqueId('agent'),
    
    // Physical
    position: [...position],
    velocity: [0, 0, 0],
    radius: config.radius ?? 0.3,
    mass: config.mass ?? 80,
    
    // Movement
    desiredSpeed: config.desiredSpeed ?? 1.4, // m/s (average walk)
    maxSpeed: config.maxSpeed ?? 5, // m/s (sprint)
    relaxationTime: config.relaxationTime ?? 0.5,
    
    // Forces
    repulsionStrength: config.repulsionStrength ?? 2.1,
    repulsionRange: config.repulsionRange ?? 0.3,
    bodyForce: config.bodyForce ?? 120,
    wallRepulsion: config.wallRepulsion ?? 10,
    
    // State
    state: AGENT_STATE.IDLE,
    behavior: CROWD_BEHAVIOR.NORMAL,
    
    // Goals
    currentGoal: null,
    goalQueue: [],
    
    // Panic
    panicLevel: 0,
    
    // Group
    groupId: null,
    
    // Stats
    pressure: 0, // Crowd pressure felt
    fallTimer: 0,
  };
}

// ============================================================================
// CROWD SYSTEM
// ============================================================================

/**
 * Create crowd system
 * @param {Object} config - Config
 * @returns {Object} Crowd system
 */
export function createCrowdSystem(config = {}) {
  return {
    agents: new Map(),
    walls: [],
    
    // Points of interest
    attractors: [],   // {position, strength, radius}
    repulsors: [],    // {position, strength, radius}
    exits: [],        // {position, width}
    
    // Global state
    globalBehavior: CROWD_BEHAVIOR.NORMAL,
    panicSource: null,
    
    // Spatial partitioning
    gridSize: config.gridSize ?? 2,
    grid: new Map(),
    
    // Configuration
    maxAgents: config.maxAgents ?? 10000,
    
    // Statistics
    avgSpeed: 0,
    avgPressure: 0,
    fallenCount: 0,
    crushRisk: 0,
  };
}

/**
 * Add agent to crowd
 * @param {Object} crowd - Crowd system
 * @param {Object} agent - Agent
 */
export function addCrowdAgent(crowd, agent) {
  crowd.agents.set(agent.id, agent);
  updateAgentGrid(crowd, agent);
}

/**
 * Remove agent from crowd
 * @param {Object} crowd - Crowd system
 * @param {string} agentId - Agent ID
 */
export function removeCrowdAgent(crowd, agentId) {
  crowd.agents.delete(agentId);
}

/**
 * Add wall to crowd system
 * @param {Object} crowd - Crowd system
 * @param {number[]} start - Wall start
 * @param {number[]} end - Wall end
 */
export function addCrowdWall(crowd, start, end) {
  const dir = vec3Normalize(vec3Sub(end, start));
  const normal = [-dir[2], 0, dir[0]]; // Perpendicular
  crowd.walls.push({ start, end, normal });
}

/**
 * Add attractor (draws crowd)
 * @param {Object} crowd - Crowd system
 * @param {number[]} position - Position
 * @param {number} strength - Pull strength
 * @param {number} radius - Effect radius
 */
export function addAttractor(crowd, position, strength, radius) {
  crowd.attractors.push({ position, strength, radius, id: aiRng.uniqueId('attr') });
}

/**
 * Trigger panic
 * @param {Object} crowd - Crowd system
 * @param {number[]} source - Panic source position
 * @param {number} radius - Panic radius
 * @param {number} intensity - Panic intensity 0-1
 */
export function triggerPanic(crowd, source, radius, intensity = 1) {
  crowd.panicSource = { position: source, radius, intensity };
  crowd.globalBehavior = CROWD_BEHAVIOR.PANIC;
  
  for (const [, agent] of crowd.agents) {
    const dist = vec3Length(vec3Sub(agent.position, source));
    if (dist < radius) {
      agent.panicLevel = Math.max(agent.panicLevel, intensity * (1 - dist / radius));
      agent.behavior = CROWD_BEHAVIOR.PANIC;
      agent.desiredSpeed = agent.maxSpeed * (0.5 + agent.panicLevel * 0.5);
    }
  }
}

/**
 * Set evacuation mode
 * @param {Object} crowd - Crowd system
 */
export function triggerEvacuation(crowd) {
  crowd.globalBehavior = CROWD_BEHAVIOR.DISPERSING;
  
  for (const [, agent] of crowd.agents) {
    agent.behavior = CROWD_BEHAVIOR.DISPERSING;
    // Find nearest exit
    if (crowd.exits.length > 0) {
      let nearestExit = crowd.exits[0];
      let nearestDist = Infinity;
      
      for (const exit of crowd.exits) {
        const dist = vec3Length(vec3Sub(exit.position, agent.position));
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestExit = exit;
        }
      }
      
      agent.currentGoal = nearestExit.position;
    }
  }
}

// ============================================================================
// SPATIAL GRID
// ============================================================================

function getGridKey(x, z, gridSize) {
  const gx = Math.floor(x / gridSize);
  const gz = Math.floor(z / gridSize);
  return `${gx},${gz}`;
}

function updateAgentGrid(crowd, agent) {
  const key = getGridKey(agent.position[0], agent.position[2], crowd.gridSize);
  
  if (!crowd.grid.has(key)) {
    crowd.grid.set(key, new Set());
  }
  crowd.grid.get(key).add(agent.id);
}

function getNearbyAgents(crowd, position, radius) {
  const nearby = [];
  const gridRadius = Math.ceil(radius / crowd.gridSize);
  const cx = Math.floor(position[0] / crowd.gridSize);
  const cz = Math.floor(position[2] / crowd.gridSize);
  
  for (let dx = -gridRadius; dx <= gridRadius; dx++) {
    for (let dz = -gridRadius; dz <= gridRadius; dz++) {
      const key = `${cx + dx},${cz + dz}`;
      const cell = crowd.grid.get(key);
      if (cell) {
        for (const id of cell) {
          const agent = crowd.agents.get(id);
          if (agent) {
            const dist = vec3Length(vec3Sub(agent.position, position));
            if (dist < radius) {
              nearby.push(agent);
            }
          }
        }
      }
    }
  }
  
  return nearby;
}

// ============================================================================
// UPDATE
// ============================================================================

/**
 * Update crowd simulation
 * @param {Object} crowd - Crowd system
 * @param {number} deltaTime - Seconds
 */
export function updateCrowd(crowd, deltaTime) {
  // Clear and rebuild grid
  crowd.grid.clear();
  for (const [, agent] of crowd.agents) {
    updateAgentGrid(crowd, agent);
  }
  
  // Reset stats
  let totalSpeed = 0;
  let totalPressure = 0;
  crowd.fallenCount = 0;
  
  // Update each agent
  for (const [, agent] of crowd.agents) {
    if (agent.state === AGENT_STATE.DEAD) continue;
    
    // Handle fallen agents
    if (agent.state === AGENT_STATE.FALLEN) {
      agent.fallTimer += deltaTime;
      if (agent.fallTimer > 3) {
        agent.state = AGENT_STATE.WALKING;
        agent.fallTimer = 0;
      }
      crowd.fallenCount++;
      continue;
    }
    
    // Get nearby agents
    const neighbors = getNearbyAgents(crowd, agent.position, 3);
    
    // Calculate goal based on behavior
    let goal = agent.currentGoal;
    
    if (agent.behavior === CROWD_BEHAVIOR.PANIC && crowd.panicSource) {
      // Flee from panic source
      const awayFromPanic = vec3Normalize(vec3Sub(agent.position, crowd.panicSource.position));
      goal = vec3Add(agent.position, vec3Scale(awayFromPanic, 10));
    } else if (agent.behavior === CROWD_BEHAVIOR.GATHERING && crowd.attractors.length > 0) {
      // Move toward nearest attractor
      let nearest = crowd.attractors[0];
      let nearestDist = Infinity;
      for (const attr of crowd.attractors) {
        const dist = vec3Length(vec3Sub(attr.position, agent.position));
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = attr;
        }
      }
      goal = nearest.position;
    }
    
    // Calculate forces
    const force = calculateSocialForce(agent, neighbors, crowd.walls, goal);
    
    // Apply force to velocity
    const accel = vec3Scale(force, 1 / agent.mass);
    agent.velocity[0] += accel[0] * deltaTime;
    agent.velocity[2] += accel[2] * deltaTime;
    
    // Limit speed
    const speed = vec3Length(agent.velocity);
    if (speed > agent.maxSpeed) {
      agent.velocity = vec3Scale(agent.velocity, agent.maxSpeed / speed);
    }
    
    // Update position
    agent.position[0] += agent.velocity[0] * deltaTime;
    agent.position[2] += agent.velocity[2] * deltaTime;
    
    // Calculate pressure (from neighbors)
    agent.pressure = 0;
    for (const other of neighbors) {
      if (other.id === agent.id) continue;
      const dist = vec3Length(vec3Sub(other.position, agent.position));
      const minDist = agent.radius + other.radius;
      if (dist < minDist * 1.5) {
        agent.pressure += (minDist * 1.5 - dist) * 100;
      }
    }
    
    // Fall if too much pressure
    if (agent.pressure > 500 && aiRng.chance(0.01)) {
      agent.state = AGENT_STATE.FALLEN;
      agent.velocity = [0, 0, 0];
    }
    
    // Update state
    agent.state = speed < 0.1 ? AGENT_STATE.IDLE : 
                  speed < 2 ? AGENT_STATE.WALKING : AGENT_STATE.RUNNING;
    
    // Decay panic
    agent.panicLevel = Math.max(0, agent.panicLevel - deltaTime * 0.1);
    if (agent.panicLevel < 0.1) {
      agent.behavior = crowd.globalBehavior;
    }
    
    totalSpeed += speed;
    totalPressure += agent.pressure;
  }
  
  // Update stats
  const count = crowd.agents.size;
  crowd.avgSpeed = count > 0 ? totalSpeed / count : 0;
  crowd.avgPressure = count > 0 ? totalPressure / count : 0;
  crowd.crushRisk = Math.min(1, crowd.avgPressure / 300);
}

/**
 * Get crowd statistics
 * @param {Object} crowd - Crowd system
 * @returns {Object} Stats
 */
export function getCrowdStats(crowd) {
  let panickedCount = 0;
  let injuredCount = 0;
  
  for (const [, agent] of crowd.agents) {
    if (agent.panicLevel > 0.5) panickedCount++;
    if (agent.state === AGENT_STATE.INJURED) injuredCount++;
  }
  
  return {
    totalAgents: crowd.agents.size,
    averageSpeed: crowd.avgSpeed,
    averagePressure: crowd.avgPressure,
    fallenAgents: crowd.fallenCount,
    panickedAgents: panickedCount,
    injuredAgents: injuredCount,
    crushRisk: crowd.crushRisk,
    behavior: crowd.globalBehavior,
  };
}
