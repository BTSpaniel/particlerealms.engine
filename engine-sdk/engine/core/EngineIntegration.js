// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * EngineIntegration.js - Integration helpers for existing game code
 * 
 * Provides easy integration of the high-performance resource management
 * system with the existing game engine.
 * 
 * ⚠️ MULTIPLAYER: Uses deterministic RNG from AIRandom.js
 */

import { resources, JobPriority, SoAContainer } from './ResourceManager.js';
import { aiRng } from '../sim/ai/AIRandom.js';

// ============================================================================
// PARTICLE SYSTEM SOA SCHEMA
// ============================================================================

/**
 * Schema for high-performance particle system using Structure of Arrays
 */
export const PARTICLE_SCHEMA = {
    // Position (xyz + padding)
    posX: { type: 'f32', size: 1 },
    posY: { type: 'f32', size: 1 },
    posZ: { type: 'f32', size: 1 },
    
    // Velocity
    velX: { type: 'f32', size: 1 },
    velY: { type: 'f32', size: 1 },
    velZ: { type: 'f32', size: 1 },
    
    // Properties
    life: { type: 'f32', size: 1 },
    maxLife: { type: 'f32', size: 1 },
    size: { type: 'f32', size: 1 },
    
    // Material/color
    material: { type: 'u8', size: 1 },
    flags: { type: 'u8', size: 1 },
};

/**
 * Schema for entity transforms using Structure of Arrays
 */
export const TRANSFORM_SCHEMA = {
    // Position
    posX: { type: 'f32', size: 1 },
    posY: { type: 'f32', size: 1 },
    posZ: { type: 'f32', size: 1 },
    
    // Rotation (quaternion)
    rotX: { type: 'f32', size: 1 },
    rotY: { type: 'f32', size: 1 },
    rotZ: { type: 'f32', size: 1 },
    rotW: { type: 'f32', size: 1 },
    
    // Scale
    scaleX: { type: 'f32', size: 1 },
    scaleY: { type: 'f32', size: 1 },
    scaleZ: { type: 'f32', size: 1 },
    
    // Flags
    dirty: { type: 'u8', size: 1 },
    visible: { type: 'u8', size: 1 },
};

// ============================================================================
// GAME LOOP INTEGRATION
// ============================================================================

/**
 * Initialize resource management for the game
 * Call this during game initialization after WebGPU device is ready
 * 
 * @param {GPUDevice} device - WebGPU device
 * @param {Object} options - Configuration options
 */
export async function initResourceManagement(device, options = {}) {
    await resources.init(device, {
        // Host memory
        frameSlabSize: options.frameSlabSize || 32 * 1024 * 1024,
        stagingSlabSize: options.stagingSlabSize || 16 * 1024 * 1024,
        createPools: true,
        
        // GPU memory
        uniformRingSize: options.uniformRingSize || 8 * 1024 * 1024,
        vertexRingSize: options.vertexRingSize || 16 * 1024 * 1024,
        geometryHeapSize: options.geometryHeapSize || 64 * 1024 * 1024,
        textureBudget: options.textureBudget || 512 * 1024 * 1024,
        
        // Workers (optional)
        workerScript: options.workerScript || null,
        
        // Debug
        debug: options.debug || false,
    });
    
    // Create particle container if requested
    if (options.maxParticles) {
        resources.getOrCreateContainer('particles', PARTICLE_SCHEMA, options.maxParticles);
    }
    
    // Create entity transforms container if requested
    if (options.maxEntities) {
        resources.getOrCreateContainer('transforms', TRANSFORM_SCHEMA, options.maxEntities);
    }
    
    console.log('[EngineIntegration] Resource management initialized');
    return resources;
}

/**
 * Frame wrapper that handles resource management automatically
 * 
 * Usage:
 * ```js
 * function gameLoop() {
 *     frameWrapper(() => {
 *         // Your game update code here
 *         updatePhysics();
 *         updateAI();
 *         render();
 *     });
 *     requestAnimationFrame(gameLoop);
 * }
 * ```
 * 
 * @param {Function} frameCallback - Your frame update function
 */
export function frameWrapper(frameCallback) {
    // Begin frame - resets allocators
    resources.beginFrame();
    
    try {
        // Process scheduled jobs
        const jobResult = resources.processJobs();
        
        // Run frame callback
        frameCallback(resources.deltaTime, resources);
        
        // Update registered systems
        resources.updateSystems();
        
    } finally {
        // End frame
        resources.endFrame();
    }
}

/**
 * Async frame wrapper for async game loops
 */
export async function frameWrapperAsync(frameCallback) {
    resources.beginFrame();
    
    try {
        resources.processJobs();
        await frameCallback(resources.deltaTime, resources);
        resources.updateSystems();
    } finally {
        resources.endFrame();
    }
}

// ============================================================================
// PARTICLE SYSTEM HELPERS
// ============================================================================

/**
 * High-performance particle emitter using SoA
 */
export class SoAParticleEmitter {
    /**
     * @param {string} containerName - Name of particle container
     * @param {number} maxParticles - Max particles (creates container if needed)
     */
    constructor(containerName = 'particles', maxParticles = 100000) {
        this.container = resources.getOrCreateContainer(
            containerName, 
            PARTICLE_SCHEMA, 
            maxParticles
        );
        this.maxParticles = maxParticles;
    }
    
    /**
     * Emit a single particle
     * @returns {number} Particle index, or -1 if full
     */
    emit(x, y, z, vx, vy, vz, life, material = 0, size = 1) {
        const idx = this.container.alloc();
        if (idx < 0) return -1;
        
        this.container.set('posX', idx, x);
        this.container.set('posY', idx, y);
        this.container.set('posZ', idx, z);
        this.container.set('velX', idx, vx);
        this.container.set('velY', idx, vy);
        this.container.set('velZ', idx, vz);
        this.container.set('life', idx, life);
        this.container.set('maxLife', idx, life);
        this.container.set('size', idx, size);
        this.container.set('material', idx, material);
        this.container.set('flags', idx, 1); // Active
        
        return idx;
    }
    
    /**
     * Emit burst of particles
     */
    emitBurst(x, y, z, count, speed, life, material = 0) {
        for (let i = 0; i < count; i++) {
            const angle = aiRng.float() * Math.PI * 2;
            const elevation = aiRng.range(-0.5, 0.5) * Math.PI;
            const s = speed * aiRng.range(0.5, 1.0);
            
            const vx = Math.cos(angle) * Math.cos(elevation) * s;
            const vy = Math.sin(elevation) * s;
            const vz = Math.sin(angle) * Math.cos(elevation) * s;
            
            this.emit(x, y, z, vx, vy, vz, life * aiRng.range(0.8, 1.2), material);
        }
    }
    
    /**
     * Update all particles (call each frame)
     * @param {number} dt - Delta time in seconds
     * @param {number} gravity - Gravity acceleration
     */
    update(dt, gravity = -9.8) {
        const posX = this.container.getArray('posX');
        const posY = this.container.getArray('posY');
        const posZ = this.container.getArray('posZ');
        const velX = this.container.getArray('velX');
        const velY = this.container.getArray('velY');
        const velZ = this.container.getArray('velZ');
        const life = this.container.getArray('life');
        
        const toRemove = [];
        
        this.container.forEach(idx => {
            // Update life
            life[idx] -= dt;
            
            if (life[idx] <= 0) {
                toRemove.push(idx);
                return;
            }
            
            // Apply gravity
            velY[idx] += gravity * dt;
            
            // Update position
            posX[idx] += velX[idx] * dt;
            posY[idx] += velY[idx] * dt;
            posZ[idx] += velZ[idx] * dt;
        });
        
        // Remove dead particles
        for (const idx of toRemove) {
            this.container.free(idx);
        }
    }
    
    /**
     * Get particle data for GPU upload
     * @returns {{ positions: Float32Array, count: number }}
     */
    getGPUData() {
        const count = this.container.count;
        
        // Allocate from frame slab (zero allocation)
        const positions = resources.allocFloat32(count * 4); // vec4 per particle
        
        const posX = this.container.getArray('posX');
        const posY = this.container.getArray('posY');
        const posZ = this.container.getArray('posZ');
        const size = this.container.getArray('size');
        
        let writeIdx = 0;
        this.container.forEach(idx => {
            positions[writeIdx++] = posX[idx];
            positions[writeIdx++] = posY[idx];
            positions[writeIdx++] = posZ[idx];
            positions[writeIdx++] = size[idx];
        });
        
        return { positions, count };
    }
    
    /**
     * Get statistics
     */
    getStats() {
        return this.container.getStats();
    }
}

// ============================================================================
// RENDER COMMAND HELPERS
// ============================================================================

/**
 * Render command builder using object pools
 */
export class RenderCommandBuilder {
    constructor() {
        this.commands = [];
    }
    
    /**
     * Add a draw command
     */
    addDraw(pipeline, bindGroup, vertexBuffer, indexBuffer, indexCount, sortKey = 0) {
        const cmd = resources.poolAlloc('renderCmd');
        if (!cmd) {
            console.warn('[RenderCommandBuilder] Command pool exhausted');
            return;
        }
        
        cmd.type = 1; // Draw indexed
        cmd.pipeline = pipeline;
        cmd.bindGroup = bindGroup;
        cmd.vertexBuffer = vertexBuffer;
        cmd.indexBuffer = indexBuffer;
        cmd.indexCount = indexCount;
        cmd.sortKey = sortKey;
        
        this.commands.push(cmd);
    }
    
    /**
     * Sort commands by sort key
     */
    sort() {
        // Radix sort would be better for large counts, but JS sort is fine for typical use
        this.commands.sort((a, b) => a.sortKey - b.sortKey);
    }
    
    /**
     * Execute all commands
     * @param {GPURenderPassEncoder} pass
     */
    execute(pass) {
        let currentPipeline = null;
        let currentBindGroup = null;
        
        for (const cmd of this.commands) {
            // Minimize state changes
            if (cmd.pipeline !== currentPipeline) {
                pass.setPipeline(cmd.pipeline);
                currentPipeline = cmd.pipeline;
            }
            
            if (cmd.bindGroup !== currentBindGroup) {
                pass.setBindGroup(0, cmd.bindGroup);
                currentBindGroup = cmd.bindGroup;
            }
            
            pass.setVertexBuffer(0, cmd.vertexBuffer);
            pass.setIndexBuffer(cmd.indexBuffer, 'uint32');
            pass.drawIndexed(cmd.indexCount);
        }
    }
    
    /**
     * Clear and return commands to pool
     */
    clear() {
        for (const cmd of this.commands) {
            resources.poolFree('renderCmd', cmd);
        }
        this.commands.length = 0;
    }
}

// ============================================================================
// JOB HELPERS
// ============================================================================

/**
 * Submit physics job to scheduler
 */
export function submitPhysicsJob(callback, data = null) {
    return resources.submitJob(callback, JobPriority.CRITICAL, {
        label: 'Physics',
        data,
    });
}

/**
 * Submit AI job to scheduler
 */
export function submitAIJob(callback, data = null) {
    return resources.submitJob(callback, JobPriority.HIGH, {
        label: 'AI',
        data,
    });
}

/**
 * Submit streaming/loading job to scheduler
 */
export function submitStreamingJob(callback, data = null) {
    return resources.submitJob(callback, JobPriority.LOW, {
        label: 'Streaming',
        data,
    });
}

/**
 * Submit background cleanup job
 */
export function submitCleanupJob(callback, data = null) {
    return resources.submitJob(callback, JobPriority.IDLE, {
        label: 'Cleanup',
        data,
    });
}

// ============================================================================
// EXPORTS
// ============================================================================

export { resources, JobPriority };

export default {
    initResourceManagement,
    frameWrapper,
    frameWrapperAsync,
    SoAParticleEmitter,
    RenderCommandBuilder,
    submitPhysicsJob,
    submitAIJob,
    submitStreamingJob,
    submitCleanupJob,
    resources,
    PARTICLE_SCHEMA,
    TRANSFORM_SCHEMA,
};
