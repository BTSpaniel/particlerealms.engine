import { random } from '../../core/math/MathRandom.js';

/**
 * MeshParticles.js - Debris Particle System from Destruction
 * 
 * Manages mesh debris generated from voxel destruction:
 * 1. Extracts disconnected clusters from connectivity analysis
 * 2. Generates meshes for each cluster via MC33
 * 3. Decimates meshes for performance
 * 4. Simulates physics (rigid body or PBD)
 * 5. Renders via instancing
 * 6. Manages lifecycle (despawn, pooling)
 * 
 * Integration points:
 * - ConnectivityCompute: Identifies floating voxel clusters
 * - MarchingCubesMesher: Generates mesh for cluster
 * - MeshDecimation: Reduces triangle count
 * - PBDSolver or rigid body: Physics simulation
 */

import { decimateGrid, decimateQEM, MeshDecimator } from './MeshDecimation.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Maximum active debris particles */
export const MAX_DEBRIS_PARTICLES = 1000;

/** LOD distance thresholds */
export const LOD_DISTANCES = [20, 50, 100];

/** LOD decimation ratios */
export const LOD_RATIOS = [1.0, 0.5, 0.25, 0.1];

/** Minimum voxels to create debris (smaller clusters become particles) */
export const MIN_CLUSTER_SIZE = 4;

/** Maximum voxels per debris chunk */
export const MAX_CLUSTER_SIZE = 512;

/** Debris lifetime in seconds */
export const DEFAULT_LIFETIME = 10;

/** Debris states */
export const DebrisState = {
    SPAWNING: 0,
    ACTIVE: 1,
    FADING: 2,
    DESPAWNED: 3,
};

// ============================================================================
// DEBRIS PARTICLE
// ============================================================================

/**
 * Single debris chunk with mesh, physics, and rendering state
 */
export class DebrisParticle {
    constructor() {
        // Identity
        this.id = -1;
        this.state = DebrisState.DESPAWNED;
        
        // Transform
        this.x = 0;
        this.y = 0;
        this.z = 0;
        this.rotation = [0, 0, 0, 1]; // Quaternion
        this.scale = 1.0;
        
        // Physics
        this.vx = 0;
        this.vy = 0;
        this.vz = 0;
        this.angularVelocity = [0, 0, 0];
        this.mass = 1.0;
        this.inertia = [1, 1, 1];
        
        // Mesh data (per LOD)
        this.meshLODs = []; // Array of { vertices, indices, vertexBuffer, indexBuffer }
        this.currentLOD = 0;
        this.boundingRadius = 1.0;
        this.centerOfMass = [0, 0, 0];
        
        // Voxel source
        this.voxelIndices = []; // Original voxel indices in chunk
        this.material = 0;
        
        // Lifecycle
        this.lifetime = DEFAULT_LIFETIME;
        this.age = 0;
        this.fadeAlpha = 1.0;
        
        // Rendering
        this.visible = true;
        this.castShadow = true;
    }
    
    /**
     * Reset for pool reuse
     */
    reset() {
        this.state = DebrisState.DESPAWNED;
        this.x = 0; this.y = 0; this.z = 0;
        this.vx = 0; this.vy = 0; this.vz = 0;
        this.rotation = [0, 0, 0, 1];
        this.angularVelocity = [0, 0, 0];
        this.age = 0;
        this.fadeAlpha = 1.0;
        this.meshLODs = [];
        this.voxelIndices = [];
    }
    
    /**
     * Initialize from cluster data
     * @param {Object} cluster - { voxelIndices, centerOfMass, boundingRadius, material }
     * @param {Object} mesh - { vertices, indices }
     * @param {number[]} initialVelocity 
     */
    initFromCluster(cluster, mesh, initialVelocity = [0, 0, 0]) {
        this.state = DebrisState.SPAWNING;
        
        // Position at center of mass
        this.x = cluster.centerOfMass[0];
        this.y = cluster.centerOfMass[1];
        this.z = cluster.centerOfMass[2];
        this.centerOfMass = [...cluster.centerOfMass];
        
        // Initial velocity with some randomness
        this.vx = initialVelocity[0] + (random() - 0.5) * 2;
        this.vy = initialVelocity[1] + (random() - 0.5) * 2;
        this.vz = initialVelocity[2] + (random() - 0.5) * 2;
        
        // Random angular velocity
        this.angularVelocity = [
            (random() - 0.5) * 4,
            (random() - 0.5) * 4,
            (random() - 0.5) * 4,
        ];
        
        // Copy cluster info
        this.voxelIndices = [...cluster.voxelIndices];
        this.material = cluster.material;
        this.boundingRadius = cluster.boundingRadius;
        
        // Mass from voxel count
        this.mass = cluster.voxelIndices.length;
        
        // Store base mesh as LOD 0
        this.meshLODs = [{ vertices: mesh.vertices, indices: mesh.indices }];
        
        this.age = 0;
        this.fadeAlpha = 1.0;
    }
    
    /**
     * Generate LOD meshes
     * @param {MeshDecimator} decimator 
     */
    generateLODs(decimator) {
        if (this.meshLODs.length === 0) return;
        
        const baseMesh = this.meshLODs[0];
        
        for (let i = 1; i < LOD_RATIOS.length; i++) {
            const ratio = LOD_RATIOS[i];
            decimator.targetRatio = ratio;
            
            const decimated = decimator.decimate(baseMesh.vertices, baseMesh.indices);
            this.meshLODs.push({
                vertices: decimated.vertices,
                indices: decimated.indices,
            });
        }
    }
    
    /**
     * Update LOD based on camera distance
     * @param {number} cameraDistance 
     */
    updateLOD(cameraDistance) {
        let lod = 0;
        for (let i = 0; i < LOD_DISTANCES.length; i++) {
            if (cameraDistance > LOD_DISTANCES[i]) {
                lod = i + 1;
            }
        }
        this.currentLOD = Math.min(lod, this.meshLODs.length - 1);
    }
    
    /**
     * Get current mesh for rendering
     */
    getCurrentMesh() {
        return this.meshLODs[this.currentLOD] || this.meshLODs[0];
    }
}

// ============================================================================
// MESH PARTICLE SYSTEM
// ============================================================================

export class MeshParticleSystem {
    /**
     * @param {Object} options 
     */
    constructor(options = {}) {
        this.maxParticles = options.maxParticles ?? MAX_DEBRIS_PARTICLES;
        this.gravity = options.gravity ?? [0, -9.8, 0];
        this.groundY = options.groundY ?? 0;
        this.damping = options.damping ?? 0.98;
        this.bounciness = options.bounciness ?? 0.3;
        
        // Particle pool
        this.particles = [];
        this.activeCount = 0;
        this.freeList = [];
        
        // Initialize pool
        for (let i = 0; i < this.maxParticles; i++) {
            const p = new DebrisParticle();
            p.id = i;
            this.particles.push(p);
            this.freeList.push(i);
        }
        
        // Decimator for LOD generation
        this.decimator = new MeshDecimator({ method: 'grid' });
        
        // Stats
        this.stats = {
            active: 0,
            spawned: 0,
            despawned: 0,
            totalTriangles: 0,
        };
        
        // GPU resources (for instanced rendering)
        this.instanceBuffer = null;
        this.device = null;
    }
    
    /**
     * Initialize GPU resources
     * @param {GPUDevice} device 
     */
    initGPU(device) {
        this.device = device;
        
        // Instance data: mat4 transform + vec4 color = 20 floats = 80 bytes
        this.instanceBuffer = device.createBuffer({
            label: 'Debris Instance Buffer',
            size: this.maxParticles * 80,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
    }
    
    /**
     * Spawn debris from a cluster
     * @param {Object} cluster - From connectivity analysis
     * @param {Object} mesh - Generated mesh { vertices, indices }
     * @param {number[]} velocity - Initial velocity
     * @returns {DebrisParticle|null}
     */
    spawn(cluster, mesh, velocity = [0, 0, 0]) {
        if (this.freeList.length === 0) {
            // Pool exhausted - despawn oldest
            this._despawnOldest();
        }
        
        if (this.freeList.length === 0) return null;
        
        const id = this.freeList.pop();
        const particle = this.particles[id];
        
        particle.reset();
        particle.initFromCluster(cluster, mesh, velocity);
        particle.generateLODs(this.decimator);
        particle.state = DebrisState.ACTIVE;
        
        this.activeCount++;
        this.stats.spawned++;
        
        return particle;
    }
    
    /**
     * Spawn multiple debris from connectivity result
     * @param {Map<number, number[]>} components - componentId → voxelIndices
     * @param {Function} meshGenerator - (voxelIndices) => { vertices, indices }
     * @param {Function} getCenterOfMass - (voxelIndices) => [x, y, z]
     * @param {number[]} baseVelocity 
     */
    spawnFromConnectivity(components, meshGenerator, getCenterOfMass, baseVelocity = [0, 0, 0]) {
        const spawned = [];
        
        for (const [componentId, voxelIndices] of components) {
            // Skip tiny clusters
            if (voxelIndices.length < MIN_CLUSTER_SIZE) continue;
            
            // Skip huge clusters (keep as static)
            if (voxelIndices.length > MAX_CLUSTER_SIZE) continue;
            
            // Generate mesh for this cluster
            const mesh = meshGenerator(voxelIndices);
            if (!mesh || mesh.indices.length === 0) continue;
            
            // Compute cluster properties
            const centerOfMass = getCenterOfMass(voxelIndices);
            const boundingRadius = this._computeBoundingRadius(mesh.vertices, centerOfMass);
            
            const cluster = {
                voxelIndices,
                centerOfMass,
                boundingRadius,
                material: 0, // TODO: Get from voxels
            };
            
            const particle = this.spawn(cluster, mesh, baseVelocity);
            if (particle) {
                spawned.push(particle);
            }
        }
        
        return spawned;
    }
    
    /**
     * Update all particles
     * @param {number} dt - Delta time
     * @param {number[]} cameraPos - For LOD
     */
    update(dt, cameraPos = [0, 0, 0]) {
        let totalTriangles = 0;
        let active = 0;
        
        for (const particle of this.particles) {
            if (particle.state === DebrisState.DESPAWNED) continue;
            
            // Update age
            particle.age += dt;
            
            // Handle states
            switch (particle.state) {
                case DebrisState.SPAWNING:
                    particle.state = DebrisState.ACTIVE;
                    break;
                    
                case DebrisState.ACTIVE:
                    if (particle.age > particle.lifetime * 0.8) {
                        particle.state = DebrisState.FADING;
                    }
                    break;
                    
                case DebrisState.FADING:
                    particle.fadeAlpha = 1 - (particle.age - particle.lifetime * 0.8) / (particle.lifetime * 0.2);
                    if (particle.fadeAlpha <= 0) {
                        this._despawn(particle);
                        continue;
                    }
                    break;
            }
            
            // Physics update
            this._updatePhysics(particle, dt);
            
            // LOD update
            const dx = particle.x - cameraPos[0];
            const dy = particle.y - cameraPos[1];
            const dz = particle.z - cameraPos[2];
            const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
            particle.updateLOD(dist);
            
            // Cull if too far
            particle.visible = dist < 200;
            
            // Stats
            if (particle.visible) {
                const mesh = particle.getCurrentMesh();
                if (mesh) {
                    totalTriangles += mesh.indices.length / 3;
                }
            }
            
            active++;
        }
        
        this.activeCount = active;
        this.stats.active = active;
        this.stats.totalTriangles = totalTriangles;
    }
    
    _updatePhysics(particle, dt) {
        // Apply gravity
        particle.vy += this.gravity[1] * dt;
        
        // Apply damping
        particle.vx *= this.damping;
        particle.vy *= this.damping;
        particle.vz *= this.damping;
        
        // Integrate position
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.z += particle.vz * dt;
        
        // Ground collision
        if (particle.y - particle.boundingRadius < this.groundY) {
            particle.y = this.groundY + particle.boundingRadius;
            particle.vy = -particle.vy * this.bounciness;
            
            // Friction
            particle.vx *= 0.8;
            particle.vz *= 0.8;
            particle.angularVelocity[0] *= 0.9;
            particle.angularVelocity[1] *= 0.9;
            particle.angularVelocity[2] *= 0.9;
        }
        
        // Integrate rotation (simplified)
        this._integrateRotation(particle, dt);
    }
    
    _integrateRotation(particle, dt) {
        const [wx, wy, wz] = particle.angularVelocity;
        const [qx, qy, qz, qw] = particle.rotation;
        
        // Quaternion derivative: q' = 0.5 * w * q
        const dqx = 0.5 * dt * (wx * qw + wy * qz - wz * qy);
        const dqy = 0.5 * dt * (wy * qw + wz * qx - wx * qz);
        const dqz = 0.5 * dt * (wz * qw + wx * qy - wy * qx);
        const dqw = 0.5 * dt * (-wx * qx - wy * qy - wz * qz);
        
        particle.rotation[0] = qx + dqx;
        particle.rotation[1] = qy + dqy;
        particle.rotation[2] = qz + dqz;
        particle.rotation[3] = qw + dqw;
        
        // Normalize
        const len = Math.sqrt(
            particle.rotation[0]**2 + particle.rotation[1]**2 +
            particle.rotation[2]**2 + particle.rotation[3]**2
        );
        if (len > 0.0001) {
            particle.rotation[0] /= len;
            particle.rotation[1] /= len;
            particle.rotation[2] /= len;
            particle.rotation[3] /= len;
        }
    }
    
    _despawn(particle) {
        particle.state = DebrisState.DESPAWNED;
        this.freeList.push(particle.id);
        this.activeCount--;
        this.stats.despawned++;
    }
    
    _despawnOldest() {
        let oldest = null;
        let maxAge = 0;
        
        for (const particle of this.particles) {
            if (particle.state !== DebrisState.DESPAWNED && particle.age > maxAge) {
                maxAge = particle.age;
                oldest = particle;
            }
        }
        
        if (oldest) {
            this._despawn(oldest);
        }
    }
    
    _computeBoundingRadius(vertices, center) {
        let maxDist = 0;
        
        for (let i = 0; i < vertices.length; i += 3) {
            const dx = vertices[i] - center[0];
            const dy = vertices[i + 1] - center[1];
            const dz = vertices[i + 2] - center[2];
            const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
            maxDist = Math.max(maxDist, dist);
        }
        
        return maxDist;
    }
    
    /**
     * Get instance data for GPU rendering
     * @returns {Float32Array}
     */
    getInstanceData() {
        const data = new Float32Array(this.activeCount * 20);
        let offset = 0;
        
        for (const particle of this.particles) {
            if (particle.state === DebrisState.DESPAWNED || !particle.visible) continue;
            
            // Build transform matrix from position + quaternion + scale
            const matrix = this._buildMatrix(
                particle.x, particle.y, particle.z,
                particle.rotation,
                particle.scale
            );
            
            // Copy 16 floats (mat4)
            for (let i = 0; i < 16; i++) {
                data[offset + i] = matrix[i];
            }
            
            // Color + alpha (4 floats)
            data[offset + 16] = 1.0; // R
            data[offset + 17] = 1.0; // G
            data[offset + 18] = 1.0; // B
            data[offset + 19] = particle.fadeAlpha; // A
            
            offset += 20;
        }
        
        return data.slice(0, offset);
    }
    
    _buildMatrix(x, y, z, q, s) {
        const [qx, qy, qz, qw] = q;
        
        // Quaternion to rotation matrix
        const xx = qx * qx, xy = qx * qy, xz = qx * qz, xw = qx * qw;
        const yy = qy * qy, yz = qy * qz, yw = qy * qw;
        const zz = qz * qz, zw = qz * qw;
        
        // Column-major 4x4 matrix
        return new Float32Array([
            s * (1 - 2 * (yy + zz)), s * 2 * (xy + zw), s * 2 * (xz - yw), 0,
            s * 2 * (xy - zw), s * (1 - 2 * (xx + zz)), s * 2 * (yz + xw), 0,
            s * 2 * (xz + yw), s * 2 * (yz - xw), s * (1 - 2 * (xx + yy)), 0,
            x, y, z, 1,
        ]);
    }
    
    /**
     * Upload instance data to GPU
     */
    uploadInstances() {
        if (!this.device || !this.instanceBuffer) return;
        
        const data = this.getInstanceData();
        if (data.length > 0) {
            this.device.queue.writeBuffer(this.instanceBuffer, 0, data);
        }
    }
    
    /**
     * Get active particles for rendering
     * @returns {DebrisParticle[]}
     */
    getActiveParticles() {
        return this.particles.filter(p => 
            p.state !== DebrisState.DESPAWNED && p.visible
        );
    }
    
    /**
     * Clear all particles
     */
    clear() {
        for (const particle of this.particles) {
            if (particle.state !== DebrisState.DESPAWNED) {
                this._despawn(particle);
            }
        }
    }
    
    /**
     * Destroy GPU resources
     */
    destroy() {
        this.instanceBuffer?.destroy();
        this.instanceBuffer = null;
    }
    
    /**
     * Get stats
     */
    getStats() {
        return { ...this.stats };
    }
}

export { MeshParticleSystem as MeshParticles };

export default MeshParticleSystem;
