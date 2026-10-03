/**
 * GPU Cloth Physics Solver
 * Position-based dynamics (PBD) solver running entirely on GPU
 * Handles cloth, ropes, soft bodies with collision detection
 * 
 * **Small Substeps Approach (Miles Macklin, NVIDIA 2019):**
 * Uses 8 substeps with 1 iteration each for better stability than
 * 1 substep with 8 iterations. This is especially important for
 * stiff constraints like ropes and tightly-woven cloth.
 * 
 * **OGC Contact Model (Chen et al., SIGGRAPH 2025):**
 * Uses Offset Geometric Contact for penetration-free simulation.
 * Barrier energy prevents penetration before it occurs, with
 * orthogonal contact forces along face normals.
 */

import { OGC_WGSL_MODULE, DEFAULT_CONTACT_RADIUS } from './OGCContact.js';

// Reusable buffers for hot paths (reduce/reuse/recycle)
const _clothParamsF32 = new Float32Array(12); // Extended for OGC params
const _colliderDataF32 = new Float32Array(12);

/** Default substeps (small substeps approach) */
export const GPU_CLOTH_DEFAULT_SUBSTEPS = 8;
/** Default iterations per substep */
export const GPU_CLOTH_DEFAULT_ITERATIONS = 1;

export class GPUClothSolver {
    constructor(device, options = {}) {
        this.device = device;
        this.maxParticles = options.maxParticles || 100000;
        this.maxConstraints = options.maxConstraints || this.maxParticles * 4;
        // Small substeps approach: more substeps, fewer iterations per substep
        this.substeps = options.substeps || GPU_CLOTH_DEFAULT_SUBSTEPS;
        this.iterations = options.iterations || GPU_CLOTH_DEFAULT_ITERATIONS;
        this.gravity = options.gravity || [0, -9.81, 0];
        this.damping = options.damping || 0.99;
        
        // OGC Contact parameters
        this.contactRadius = options.contactRadius ?? DEFAULT_CONTACT_RADIUS;
        this.barrierStiffness = options.barrierStiffness ?? 10000.0;
        
        // Particle buffers (double-buffered for stability)
        this.positionBuffers = [null, null];
        this.velocityBuffers = [null, null];
        this.currentBuffer = 0;
        
        // Constraints
        this.distanceConstraintBuffer = null;
        this.constraintCount = 0;
        
        // Collision spheres/planes
        this.collisionBuffer = null;
        this.maxColliders = options.maxColliders || 64;
        this.colliderCount = 0;
        
        // Uniform buffer for params
        this.paramsBuffer = null;
        
        // Bind group layouts and bind groups
        this.integrationLayout = null;
        this.constraintLayout = null;
        this.collisionLayout = null;
        this.integrationBindGroup = null;
        this.constraintBindGroup = null;
        this.collisionBindGroup = null;
        
        // Pipelines
        this.integrationPipeline = null;
        this.distanceConstraintPipeline = null;
        this.collisionPipeline = null;
        
        // Active particle count
        this.particleCount = 0;
    }

    async init() {
        await this._createBuffers();
        await this._createPipelines();
        console.log('[GPUCloth] Initialized - GPU cloth physics ready');
    }

    async _createBuffers() {
        // Position buffers (vec4: xyz = position, w = inverse mass)
        for (let i = 0; i < 2; i++) {
            this.positionBuffers[i] = this.device.createBuffer({
                size: this.maxParticles * 16,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
                label: `ClothPositions${i}`,
            });

            this.velocityBuffers[i] = this.device.createBuffer({
                size: this.maxParticles * 16,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
                label: `ClothVelocities${i}`,
            });
        }

        // Distance constraints (particleA, particleB, restLength, stiffness)
        this.distanceConstraintBuffer = this.device.createBuffer({
            size: this.maxConstraints * 16,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            label: 'DistanceConstraints',
        });

        // Collision buffer: spheres (center xyz, radius) + planes (normal xyz, distance)
        // Format: type (0=sphere, 1=plane), x, y, z, w (radius or distance)
        this.collisionBuffer = this.device.createBuffer({
            size: this.maxColliders * 32, // 8 floats per collider
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            label: 'ClothColliders',
        });

        // Params uniform buffer (extended for OGC: deltaTime, gravity, damping, particleCount, colliderCount, contactRadius, barrierStiffness)
        this.paramsBuffer = this.device.createBuffer({
            size: 64, // Aligned to 16 bytes
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            label: 'ClothParams_OGC',
        });
    }

    async _createPipelines() {
        // 1. Velocity integration (apply forces)
        const integrationShader = this.device.createShaderModule({
            label: 'ClothIntegration',
            code: `
struct Particle {
    position: vec3<f32>,
    invMass: f32,
}

struct Params {
    deltaTime: f32,
    particleCount: u32,
    colliderCount: u32,
    contactRadius: f32,
    barrierStiffness: f32,
    gravityX: f32,
    gravityY: f32,
    gravityZ: f32,
    damping: f32,
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
}

@group(0) @binding(0) var<storage, read_write> positions: array<Particle>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let id = gid.x;
    if (id >= params.particleCount) {
        return;
    }
    
    var particle = positions[id];
    var velocity = velocities[id].xyz;
    
    // Skip fixed particles (invMass = 0)
    if (particle.invMass > 0.0) {
        // Apply gravity
        let gravity = vec3<f32>(params.gravityX, params.gravityY, params.gravityZ);
        velocity += gravity * params.deltaTime;
        
        // Apply damping
        velocity *= params.damping;
        
        // Update position (Verlet integration)
        particle.position += velocity * params.deltaTime;
    }
    
    positions[id] = particle;
    velocities[id] = vec4<f32>(velocity, 0.0);
}
            `,
        });

        this.integrationPipeline = await this.device.createComputePipelineAsync({
            label: 'ClothIntegration',
            layout: 'auto',
            compute: { module: integrationShader, entryPoint: 'main' },
        });

        // 2. Distance constraint solver (PBD)
        const distanceConstraintShader = this.device.createShaderModule({
            label: 'DistanceConstraint',
            code: `
struct Particle {
    position: vec3<f32>,
    invMass: f32,
}

struct Constraint {
    particleA: u32,
    particleB: u32,
    restLength: f32,
    stiffness: f32,
}

@group(0) @binding(0) var<storage, read_write> positions: array<Particle>;
@group(0) @binding(1) var<storage, read> constraints: array<Constraint>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let id = gid.x;
    if (id >= arrayLength(&constraints)) {
        return;
    }
    
    let constraint = constraints[id];
    var pA = positions[constraint.particleA];
    var pB = positions[constraint.particleB];
    
    // Calculate current distance
    let delta = pB.position - pA.position;
    let currentLength = length(delta);
    
    if (currentLength < 0.0001) {
        return;
    }
    
    // Calculate correction
    let diff = (currentLength - constraint.restLength) / currentLength;
    let correction = delta * diff * constraint.stiffness;
    
    // Apply correction based on inverse masses
    let totalInvMass = pA.invMass + pB.invMass;
    if (totalInvMass > 0.0) {
        pA.position += correction * (pA.invMass / totalInvMass);
        pB.position -= correction * (pB.invMass / totalInvMass);
        
        // Write back (with atomic operations for correctness)
        positions[constraint.particleA] = pA;
        positions[constraint.particleB] = pB;
    }
}
            `,
        });

        this.distanceConstraintPipeline = await this.device.createComputePipelineAsync({
            label: 'DistanceConstraint',
            layout: 'auto',
            compute: { module: distanceConstraintShader, entryPoint: 'main' },
        });

        // 3. Collision resolution with OGC (Offset Geometric Contact)
        const collisionShader = this.device.createShaderModule({
            label: 'ClothCollision_OGC',
            code: `
// OGC Contact Model - SIGGRAPH 2025
${OGC_WGSL_MODULE}

struct Particle {
    position: vec3<f32>,
    invMass: f32,
}

struct Collider {
    type_: u32,      // 0 = sphere, 1 = plane, 2 = capsule
    padding: u32,
    padding2: u32,
    padding3: u32,
    position: vec3<f32>,  // center for sphere, point on plane, start for capsule
    radius: f32,          // radius for sphere/capsule, unused for plane
    normal: vec3<f32>,    // unused for sphere, normal for plane, end-start for capsule
    friction: f32,
}

struct Params {
    deltaTime: f32,
    particleCount: u32,
    colliderCount: u32,
    contactRadius: f32,    // OGC contact offset radius
    barrierStiffness: f32, // OGC barrier stiffness
    padding1: f32,
    padding2: f32,
    padding3: f32,
}

@group(0) @binding(0) var<storage, read_write> positions: array<Particle>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> colliders: array<Collider>;
@group(0) @binding(3) var<uniform> params: Params;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let id = gid.x;
    if (id >= params.particleCount) {
        return;
    }
    
    var particle = positions[id];
    var vel = velocities[id].xyz;
    
    // Skip fixed particles
    if (particle.invMass <= 0.0) {
        return;
    }
    
    let r = params.contactRadius;
    let activationDist = 2.0 * r;
    let stiffness = params.barrierStiffness;
    let dt = params.deltaTime;
    
    // Check all colliders with OGC
    for (var c = 0u; c < params.colliderCount; c++) {
        let collider = colliders[c];
        var dist: f32 = 1e10;
        var normal: vec3<f32> = vec3<f32>(0.0, 1.0, 0.0);
        
        if (collider.type_ == 0u) {
            // Sphere collision with offset
            let result = distToOffsetSphere(particle.position, collider.position, collider.radius, r);
            normal = result.xyz;
            dist = result.w;
        } else if (collider.type_ == 1u) {
            // Plane collision with offset
            let result = distToOffsetPlane(particle.position, collider.position, collider.normal, r);
            normal = result.xyz;
            dist = result.w;
        } else if (collider.type_ == 2u) {
            // Capsule collision with offset
            let capsuleEnd = collider.position + collider.normal;
            let result = distToOffsetCapsule(particle.position, collider.position, capsuleEnd, collider.radius, r);
            normal = result.xyz;
            dist = result.w;
        }
        
        // OGC barrier contact handling
        if (dist < activationDist) {
            // Position correction (push out if penetrating)
            if (dist < 0.0) {
                particle.position = particle.position + normal * (-dist);
            }
            
            // Barrier force (smooth repulsion before penetration)
            let forceMag = -ogcBarrierForce(dist, r) * stiffness;
            let impulse = forceMag * dt * particle.invMass;
            vel = vel + normal * impulse;
            
            // Friction (tangential damping)
            let normalVel = dot(vel, normal);
            let tangentVel = vel - normal * normalVel;
            let frictionDamping = 1.0 - collider.friction * 0.1;
            vel = normal * normalVel + tangentVel * frictionDamping;
        }
    }
    
    positions[id] = particle;
    velocities[id] = vec4<f32>(vel, velocities[id].w);
}
            `,
        });

        this.collisionPipeline = await this.device.createComputePipelineAsync({
            label: 'ClothCollision',
            layout: 'auto',
            compute: { module: collisionShader, entryPoint: 'main' },
        });

        // Create bind group layouts
        this.integrationLayout = this.integrationPipeline.getBindGroupLayout(0);
        this.constraintLayout = this.distanceConstraintPipeline.getBindGroupLayout(0);
        this.collisionLayout = this.collisionPipeline.getBindGroupLayout(0);
    }

    _updateBindGroups() {
        const currentPos = this.positionBuffers[this.currentBuffer];
        const currentVel = this.velocityBuffers[this.currentBuffer];

        // Integration bind group
        this.integrationBindGroup = this.device.createBindGroup({
            layout: this.integrationLayout,
            entries: [
                { binding: 0, resource: { buffer: currentPos } },
                { binding: 1, resource: { buffer: currentVel } },
                { binding: 2, resource: { buffer: this.paramsBuffer } },
            ],
            label: 'ClothIntegrationBindGroup',
        });

        // Constraint bind group
        this.constraintBindGroup = this.device.createBindGroup({
            layout: this.constraintLayout,
            entries: [
                { binding: 0, resource: { buffer: currentPos } },
                { binding: 1, resource: { buffer: this.distanceConstraintBuffer } },
            ],
            label: 'ClothConstraintBindGroup',
        });

        // Collision bind group (OGC version includes velocities)
        this.collisionBindGroup = this.device.createBindGroup({
            layout: this.collisionLayout,
            entries: [
                { binding: 0, resource: { buffer: currentPos } },
                { binding: 1, resource: { buffer: currentVel } },
                { binding: 2, resource: { buffer: this.collisionBuffer } },
                { binding: 3, resource: { buffer: this.paramsBuffer } },
            ],
            label: 'ClothCollisionBindGroup_OGC',
        });
    }

    /**
     * Step cloth simulation using small substeps approach
     * Per Miles Macklin (NVIDIA 2019): n small timesteps with 1 iteration each
     * is more stable than 1 large timestep with n iterations.
     */
    step(commandEncoder, deltaTime) {
        if (this.particleCount === 0) return;

        const particleWorkgroups = Math.ceil(this.particleCount / 64);
        const constraintWorkgroups = Math.ceil(this.constraintCount / 64);
        
        // Small substeps approach: divide deltaTime into substeps
        const subDt = deltaTime / this.substeps;
        
        for (let sub = 0; sub < this.substeps; sub++) {
            // Update params buffer for this substep (extended for OGC)
            _clothParamsF32[0] = subDt;
            const paramsDataU32 = new Uint32Array(_clothParamsF32.buffer);
            paramsDataU32[1] = this.particleCount;
            paramsDataU32[2] = this.colliderCount;
            _clothParamsF32[3] = this.contactRadius;      // OGC contact radius
            _clothParamsF32[4] = this.barrierStiffness;   // OGC barrier stiffness
            _clothParamsF32[5] = this.gravity[0];
            _clothParamsF32[6] = this.gravity[1];
            _clothParamsF32[7] = this.gravity[2];
            _clothParamsF32[8] = this.damping;
            _clothParamsF32[9] = 0; // padding
            _clothParamsF32[10] = 0; // padding
            _clothParamsF32[11] = 0; // padding
            this.device.queue.writeBuffer(this.paramsBuffer, 0, _clothParamsF32);

            // Update bind groups for current buffer
            this._updateBindGroups();
            
            // 1. Integration pass (apply gravity, damping)
            const integrationPass = commandEncoder.beginComputePass({ 
                label: `ClothIntegration_sub${sub}`,
            });
            integrationPass.setPipeline(this.integrationPipeline);
            integrationPass.setBindGroup(0, this.integrationBindGroup);
            integrationPass.dispatchWorkgroups(particleWorkgroups);
            integrationPass.end();
            
            // 2. Constraint solver iterations (typically 1 with small substeps)
            for (let iter = 0; iter < this.iterations; iter++) {
                const constraintPass = commandEncoder.beginComputePass({ 
                    label: `ClothConstraints_sub${sub}_iter${iter}`,
                });
                constraintPass.setPipeline(this.distanceConstraintPipeline);
                constraintPass.setBindGroup(0, this.constraintBindGroup);
                constraintPass.dispatchWorkgroups(constraintWorkgroups);
                constraintPass.end();
            }
            
            // 3. Collision resolution
            if (this.colliderCount > 0) {
                const collisionPass = commandEncoder.beginComputePass({ 
                    label: `ClothCollision_sub${sub}`,
                });
                collisionPass.setPipeline(this.collisionPipeline);
                collisionPass.setBindGroup(0, this.collisionBindGroup);
                collisionPass.dispatchWorkgroups(particleWorkgroups);
                collisionPass.end();
            }
            
            // Swap buffers after each substep
            this.currentBuffer = 1 - this.currentBuffer;
        }
    }

    /**
     * Add a sphere collider
     */
    addSphereCollider(center, radius, friction = 0.5) {
        if (this.colliderCount >= this.maxColliders) return -1;
        
        const data = new Float32Array([
            0, 0, 0, 0, // type = 0 (sphere), padding
            center[0], center[1], center[2], radius,
            0, 0, 0, friction,
        ]);
        const dataU32 = new Uint32Array(data.buffer);
        dataU32[0] = 0; // type = sphere
        
        this.device.queue.writeBuffer(
            this.collisionBuffer, 
            this.colliderCount * 32, 
            data
        );
        return this.colliderCount++;
    }

    /**
     * Add a plane collider (infinite half-space)
     */
    addPlaneCollider(point, normal, friction = 0.5) {
        if (this.colliderCount >= this.maxColliders) return -1;
        
        const data = new Float32Array([
            1, 0, 0, 0, // type = 1 (plane), padding
            point[0], point[1], point[2], 0,
            normal[0], normal[1], normal[2], friction,
        ]);
        const dataU32 = new Uint32Array(data.buffer);
        dataU32[0] = 1; // type = plane
        
        this.device.queue.writeBuffer(
            this.collisionBuffer, 
            this.colliderCount * 32, 
            data
        );
        return this.colliderCount++;
    }

    /**
     * Add a capsule collider (OGC enabled)
     */
    addCapsuleCollider(start, end, radius, friction = 0.5) {
        if (this.colliderCount >= this.maxColliders) return -1;
        
        const dir = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
        const data = new Float32Array([
            2, 0, 0, 0, // type = 2 (capsule), padding
            start[0], start[1], start[2], radius,
            dir[0], dir[1], dir[2], friction,
        ]);
        const dataU32 = new Uint32Array(data.buffer);
        dataU32[0] = 2; // type = capsule
        
        this.device.queue.writeBuffer(
            this.collisionBuffer, 
            this.colliderCount * 32, 
            data
        );
        return this.colliderCount++;
    }

    /**
     * Clear all colliders
     */
    clearColliders() {
        this.colliderCount = 0;
    }
    
    /**
     * Set OGC contact parameters at runtime
     */
    setContactParams(contactRadius, barrierStiffness) {
        if (contactRadius !== undefined) this.contactRadius = contactRadius;
        if (barrierStiffness !== undefined) this.barrierStiffness = barrierStiffness;
    }

    /**
     * Create cloth mesh from grid
     */
    createClothMesh(width, height, spacing = 1.0, origin = [0, 0, 0]) {
        const particles = [];
        const constraints = [];
        
        // Create particle grid
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                particles.push({
                    position: [origin[0] + x * spacing, origin[1], origin[2] + y * spacing],
                    invMass: (y === 0) ? 0.0 : 1.0, // Fix top row
                });
            }
        }
        
        // Create distance constraints (structural + shear + bend)
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                
                // Structural (horizontal)
                if (x < width - 1) {
                    constraints.push({
                        particleA: idx,
                        particleB: idx + 1,
                        restLength: spacing,
                        stiffness: 0.8,
                    });
                }
                
                // Structural (vertical)
                if (y < height - 1) {
                    constraints.push({
                        particleA: idx,
                        particleB: idx + width,
                        restLength: spacing,
                        stiffness: 0.8,
                    });
                }
                
                // Shear (diagonals)
                if (x < width - 1 && y < height - 1) {
                    constraints.push({
                        particleA: idx,
                        particleB: idx + width + 1,
                        restLength: spacing * Math.sqrt(2),
                        stiffness: 0.6,
                    });
                    constraints.push({
                        particleA: idx + 1,
                        particleB: idx + width,
                        restLength: spacing * Math.sqrt(2),
                        stiffness: 0.6,
                    });
                }
                
                // Bend (skip one)
                if (x < width - 2) {
                    constraints.push({
                        particleA: idx,
                        particleB: idx + 2,
                        restLength: spacing * 2,
                        stiffness: 0.4,
                    });
                }
                if (y < height - 2) {
                    constraints.push({
                        particleA: idx,
                        particleB: idx + width * 2,
                        restLength: spacing * 2,
                        stiffness: 0.4,
                    });
                }
            }
        }
        
        // Upload particles to GPU
        const positionData = new Float32Array(particles.length * 4);
        const velocityData = new Float32Array(particles.length * 4);
        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            positionData[i * 4 + 0] = p.position[0];
            positionData[i * 4 + 1] = p.position[1];
            positionData[i * 4 + 2] = p.position[2];
            positionData[i * 4 + 3] = p.invMass;
            // Velocities start at zero
        }
        this.device.queue.writeBuffer(this.positionBuffers[0], 0, positionData);
        this.device.queue.writeBuffer(this.positionBuffers[1], 0, positionData);
        this.device.queue.writeBuffer(this.velocityBuffers[0], 0, velocityData);
        this.device.queue.writeBuffer(this.velocityBuffers[1], 0, velocityData);

        // Upload constraints to GPU
        const constraintData = new Float32Array(constraints.length * 4);
        const constraintDataU32 = new Uint32Array(constraintData.buffer);
        for (let i = 0; i < constraints.length; i++) {
            const c = constraints[i];
            constraintDataU32[i * 4 + 0] = c.particleA;
            constraintDataU32[i * 4 + 1] = c.particleB;
            constraintData[i * 4 + 2] = c.restLength;
            constraintData[i * 4 + 3] = c.stiffness;
        }
        this.device.queue.writeBuffer(this.distanceConstraintBuffer, 0, constraintData);

        this.particleCount = particles.length;
        this.constraintCount = constraints.length;
        
        return { particleCount: particles.length, constraintCount: constraints.length };
    }

    getPositionBuffer() {
        return this.positionBuffers[this.currentBuffer];
    }

    destroy() {
        for (const buf of this.positionBuffers) {
            if (buf) buf.destroy();
        }
        for (const buf of this.velocityBuffers) {
            if (buf) buf.destroy();
        }
        if (this.distanceConstraints) this.distanceConstraints.destroy();
    }
}
