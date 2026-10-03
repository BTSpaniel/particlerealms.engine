/**
 * MLSMPMSolver.js - Moving Least Squares Material Point Method
 * 
 * Hybrid Lagrangian-Eulerian simulation for:
 * - Soft body deformation (jelly, flesh)
 * - Fracturing materials (snow, sand)
 * - Fluid-solid interaction
 * - Large deformation scenarios
 * 
 * Algorithm Overview:
 * 1. P2G (Particle to Grid): Transfer mass/momentum using quadratic B-splines
 * 2. Grid Update: Apply forces, boundaries, compute velocities
 * 3. G2P (Grid to Particle): Gather velocity, update deformation gradient
 * 4. Advection: Move particles
 * 
 * Key Features:
 * - Fixed-point atomics for P2G scatter (WebGPU has no f32 atomics)
 * - SoA (Structure of Arrays) for GPU coalescing
 * - Multiple constitutive models (Neo-Hookean, Fixed Corotated, Snow)
 * 
 * Performance Target: 100k particles < 10ms
 */

// Reusable buffers for hot paths (reduce/reuse/recycle)
const _mpmUniformsF32 = new Float32Array(8);
const _mpmCountU32 = new Uint32Array(1);

import { 
    FIXED_SCALE, 
    PARTICLE_LAYOUT, 
    GRID_CELL_LAYOUT,
} from '../../core/gpu/BufferLayouts.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Grid cell size (1 unit typical) */
export const CELL_SIZE = 1.0;

/** Default grid dimensions */
export const DEFAULT_GRID_SIZE = 64;

/** Quadratic B-spline support radius (3 cells) */
export const SPLINE_RADIUS = 3;

/** Constitutive model types */
export const ConstitutiveModel = {
    NEO_HOOKEAN: 0,
    FIXED_COROTATED: 1,
    SNOW: 2,
    FLUID: 3,
};

/** Material presets */
export const MaterialPresets = {
    JELLY: {
        model: ConstitutiveModel.NEO_HOOKEAN,
        E: 1000,      // Young's modulus (stiffness)
        nu: 0.3,      // Poisson's ratio
        density: 1000,
    },
    SNOW: {
        model: ConstitutiveModel.SNOW,
        E: 14000,
        nu: 0.2,
        density: 400,
        thetaC: 0.025,  // Critical compression
        thetaS: 0.0075, // Critical stretch
        hardening: 10,
    },
    SAND: {
        model: ConstitutiveModel.FIXED_COROTATED,
        E: 3500,
        nu: 0.3,
        density: 1500,
        friction: 0.5,
    },
    FLESH: {
        model: ConstitutiveModel.FIXED_COROTATED,
        E: 5000,
        nu: 0.45,
        density: 1050,
    },
};

// ============================================================================
// PARTICLE CLASS (CPU-side)
// ============================================================================

export class MPMParticle {
    constructor(x = 0, y = 0, z = 0) {
        // Position
        this.x = x;
        this.y = y;
        this.z = z;
        
        // Velocity
        this.vx = 0;
        this.vy = 0;
        this.vz = 0;
        
        // Mass and volume
        this.mass = 1.0;
        this.volume = 1.0;
        
        // Deformation gradient (3x3 matrix, column-major)
        // Initialized to identity
        this.F = [
            1, 0, 0,
            0, 1, 0,
            0, 0, 1,
        ];
        
        // Affine momentum matrix (APIC)
        this.C = [
            0, 0, 0,
            0, 0, 0,
            0, 0, 0,
        ];
        
        // Material properties
        this.material = MaterialPresets.JELLY;
        
        // Plasticity (for snow/sand)
        this.Jp = 1.0; // Plastic Jacobian
    }
    
    /**
     * Compute Lamé parameters from Young's modulus and Poisson's ratio
     */
    getLameParams() {
        const E = this.material.E;
        const nu = this.material.nu;
        const mu = E / (2 * (1 + nu));
        const lambda = E * nu / ((1 + nu) * (1 - 2 * nu));
        return { mu, lambda };
    }
}

// ============================================================================
// GRID CELL (CPU-side for debugging)
// ============================================================================

export class GridCell {
    constructor() {
        this.mass = 0;
        this.vx = 0;
        this.vy = 0;
        this.vz = 0;
        // Momentum (before velocity computation)
        this.mx = 0;
        this.my = 0;
        this.mz = 0;
    }
    
    reset() {
        this.mass = 0;
        this.vx = 0;
        this.vy = 0;
        this.vz = 0;
        this.mx = 0;
        this.my = 0;
        this.mz = 0;
    }
}

// ============================================================================
// B-SPLINE WEIGHT FUNCTIONS
// ============================================================================

/**
 * Quadratic B-spline weight
 * @param {number} x - Distance in grid cells
 * @returns {number} Weight
 */
export function quadraticBSpline(x) {
    const ax = Math.abs(x);
    if (ax < 0.5) {
        return 0.75 - ax * ax;
    } else if (ax < 1.5) {
        const t = 1.5 - ax;
        return 0.5 * t * t;
    }
    return 0;
}

/**
 * Quadratic B-spline derivative
 * @param {number} x 
 * @returns {number}
 */
export function quadraticBSplineGrad(x) {
    const ax = Math.abs(x);
    const sign = x < 0 ? -1 : 1;
    if (ax < 0.5) {
        return -2 * x;
    } else if (ax < 1.5) {
        return sign * (ax - 1.5);
    }
    return 0;
}

/**
 * Compute 3D weight and gradient for a particle-grid pair
 */
export function computeWeight(px, py, pz, gx, gy, gz, cellSize = 1.0) {
    const dx = (px - gx * cellSize) / cellSize;
    const dy = (py - gy * cellSize) / cellSize;
    const dz = (pz - gz * cellSize) / cellSize;
    
    const wx = quadraticBSpline(dx);
    const wy = quadraticBSpline(dy);
    const wz = quadraticBSpline(dz);
    
    const weight = wx * wy * wz;
    
    const dwx = quadraticBSplineGrad(dx) / cellSize;
    const dwy = quadraticBSplineGrad(dy) / cellSize;
    const dwz = quadraticBSplineGrad(dz) / cellSize;
    
    const gradWeight = [
        dwx * wy * wz,
        wx * dwy * wz,
        wx * wy * dwz,
    ];
    
    return { weight, gradWeight };
}

// ============================================================================
// MLS-MPM SOLVER
// ============================================================================

export class MLSMPMSolver {
    /**
     * @param {GPUDevice} device 
     * @param {Object} options 
     */
    constructor(device, options = {}) {
        this.device = device;
        
        this.gridSize = options.gridSize ?? DEFAULT_GRID_SIZE;
        this.cellSize = options.cellSize ?? CELL_SIZE;
        this.gravity = options.gravity ?? [0, -9.8, 0];
        this.dt = options.dt ?? 1/60;
        this.substeps = options.substeps ?? 4;
        
        // CPU particles (for initialization/debugging)
        this.particles = [];
        this.maxParticles = options.maxParticles ?? 100000;
        
        // GPU resources
        this.initialized = false;
        this.particleBuffers = null;
        this.gridBuffer = null;
        this.uniformBuffer = null;
        
        // Pipelines
        this.p2gPipeline = null;
        this.gridUpdatePipeline = null;
        this.g2pPipeline = null;
        this.clearGridPipeline = null;
        
        // Bind groups
        this.bindGroup = null;
    }
    
    /**
     * Initialize GPU resources
     */
    async init() {
        const totalGridCells = this.gridSize ** 3;
        
        // Particle buffers (SoA layout)
        // Position: vec4 (xyz + padding)
        this.positionBuffer = this.device.createBuffer({
            label: 'MPM Particle Positions',
            size: this.maxParticles * 16,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });
        
        // Velocity: vec4 (xyz + padding)
        this.velocityBuffer = this.device.createBuffer({
            label: 'MPM Particle Velocities',
            size: this.maxParticles * 16,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
        // Deformation gradient F: mat3x3 (padded to 48 bytes)
        this.deformationBuffer = this.device.createBuffer({
            label: 'MPM Deformation Gradients',
            size: this.maxParticles * 48,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
        // Affine momentum C: mat3x3 (padded to 48 bytes)
        this.affineBuffer = this.device.createBuffer({
            label: 'MPM Affine Momentum',
            size: this.maxParticles * 48,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
        // Mass and volume: vec2 per particle
        this.massVolumeBuffer = this.device.createBuffer({
            label: 'MPM Mass/Volume',
            size: this.maxParticles * 8,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
        // Material properties per particle
        this.materialBuffer = this.device.createBuffer({
            label: 'MPM Materials',
            size: this.maxParticles * 16, // mu, lambda, model, Jp
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
        // Grid buffer (fixed-point for atomic scatter)
        // Per cell: mass (i32), momentum xyz (i32 × 3) = 16 bytes
        this.gridBuffer = this.device.createBuffer({
            label: 'MPM Grid',
            size: totalGridCells * 16,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
        // Grid velocity buffer (f32 after momentum→velocity conversion)
        this.gridVelocityBuffer = this.device.createBuffer({
            label: 'MPM Grid Velocities',
            size: totalGridCells * 16,
            usage: GPUBufferUsage.STORAGE,
        });
        
        // Uniform buffer
        this.uniformBuffer = this.device.createBuffer({
            label: 'MPM Uniforms',
            size: 64,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        
        // Particle count buffer
        this.countBuffer = this.device.createBuffer({
            label: 'MPM Particle Count',
            size: 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        
        await this._createPipelines();
        
        this.initialized = true;
        console.log(`[MLSMPMSolver] Initialized: grid ${this.gridSize}³, max ${this.maxParticles} particles`);
    }
    
    async _createPipelines() {
        // Shader modules would be created here
        // For now, we store the shader code references
        this.shaderCode = {
            p2g: 'mpm_p2g.wgsl',
            grid: 'mpm_grid.wgsl',
            g2p: 'mpm_g2p.wgsl',
        };
    }
    
    /**
     * Add a particle
     * @returns {MPMParticle}
     */
    addParticle(x, y, z, material = MaterialPresets.JELLY) {
        if (this.particles.length >= this.maxParticles) {
            console.warn('[MLSMPMSolver] Max particles reached');
            return null;
        }
        
        const p = new MPMParticle(x, y, z);
        p.material = material;
        p.mass = material.density * p.volume;
        this.particles.push(p);
        return p;
    }
    
    /**
     * Add a box of particles
     */
    addBox(minX, minY, minZ, maxX, maxY, maxZ, spacing = 0.5, material = MaterialPresets.JELLY) {
        const particles = [];
        
        for (let z = minZ; z <= maxZ; z += spacing) {
            for (let y = minY; y <= maxY; y += spacing) {
                for (let x = minX; x <= maxX; x += spacing) {
                    const p = this.addParticle(x, y, z, material);
                    if (p) particles.push(p);
                }
            }
        }
        
        return particles;
    }
    
    /**
     * Upload particles to GPU
     */
    uploadParticles() {
        const n = this.particles.length;
        
        // Position buffer
        const positions = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) {
            const p = this.particles[i];
            positions[i * 4 + 0] = p.x;
            positions[i * 4 + 1] = p.y;
            positions[i * 4 + 2] = p.z;
            positions[i * 4 + 3] = 0;
        }
        this.device.queue.writeBuffer(this.positionBuffer, 0, positions);
        
        // Velocity buffer
        const velocities = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) {
            const p = this.particles[i];
            velocities[i * 4 + 0] = p.vx;
            velocities[i * 4 + 1] = p.vy;
            velocities[i * 4 + 2] = p.vz;
            velocities[i * 4 + 3] = 0;
        }
        this.device.queue.writeBuffer(this.velocityBuffer, 0, velocities);
        
        // Deformation gradient buffer (identity matrices)
        const deformations = new Float32Array(n * 12); // 3x3 padded to 3x4
        for (let i = 0; i < n; i++) {
            const p = this.particles[i];
            const offset = i * 12;
            // Column-major 3x3 padded to 3x4
            deformations[offset + 0] = p.F[0];
            deformations[offset + 1] = p.F[1];
            deformations[offset + 2] = p.F[2];
            deformations[offset + 3] = 0;
            deformations[offset + 4] = p.F[3];
            deformations[offset + 5] = p.F[4];
            deformations[offset + 6] = p.F[5];
            deformations[offset + 7] = 0;
            deformations[offset + 8] = p.F[6];
            deformations[offset + 9] = p.F[7];
            deformations[offset + 10] = p.F[8];
            deformations[offset + 11] = 0;
        }
        this.device.queue.writeBuffer(this.deformationBuffer, 0, deformations);
        
        // Affine momentum (zeros)
        const affine = new Float32Array(n * 12);
        this.device.queue.writeBuffer(this.affineBuffer, 0, affine);
        
        // Mass/volume
        const massVolume = new Float32Array(n * 2);
        for (let i = 0; i < n; i++) {
            const p = this.particles[i];
            massVolume[i * 2 + 0] = p.mass;
            massVolume[i * 2 + 1] = p.volume;
        }
        this.device.queue.writeBuffer(this.massVolumeBuffer, 0, massVolume);
        
        // Material properties
        const materials = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) {
            const p = this.particles[i];
            const { mu, lambda } = p.getLameParams();
            materials[i * 4 + 0] = mu;
            materials[i * 4 + 1] = lambda;
            materials[i * 4 + 2] = p.material.model;
            materials[i * 4 + 3] = p.Jp;
        }
        this.device.queue.writeBuffer(this.materialBuffer, 0, materials);
        
        // Particle count
        const count = new Uint32Array([n]);
        this.device.queue.writeBuffer(this.countBuffer, 0, count);
    }
    
    /**
     * Update uniform buffer
     */
    updateUniforms() {
        // Reuse module-level buffer
        _mpmUniformsF32[0] = this.gravity[0];
        _mpmUniformsF32[1] = this.gravity[1];
        _mpmUniformsF32[2] = this.gravity[2];
        _mpmUniformsF32[3] = this.dt / this.substeps;
        _mpmUniformsF32[4] = this.gridSize;
        _mpmUniformsF32[5] = this.cellSize;
        _mpmUniformsF32[6] = FIXED_SCALE;
        _mpmUniformsF32[7] = this.particles.length;
        this.device.queue.writeBuffer(this.uniformBuffer, 0, _mpmUniformsF32);
    }
    
    /**
     * Step simulation (CPU fallback for debugging)
     */
    stepCPU() {
        const subDt = this.dt / this.substeps;
        
        for (let sub = 0; sub < this.substeps; sub++) {
            this._p2gCPU(subDt);
            this._gridUpdateCPU(subDt);
            this._g2pCPU(subDt);
        }
    }
    
    _p2gCPU(dt) {
        // Reset grid
        const gridSize = this.gridSize;
        const grid = [];
        for (let i = 0; i < gridSize ** 3; i++) {
            grid.push(new GridCell());
        }
        this._grid = grid;
        
        // Scatter particles to grid
        for (const p of this.particles) {
            const baseX = Math.floor(p.x / this.cellSize);
            const baseY = Math.floor(p.y / this.cellSize);
            const baseZ = Math.floor(p.z / this.cellSize);
            
            // Compute stress from deformation gradient
            const stress = this._computeStress(p);
            
            // Loop over 3x3x3 neighborhood
            for (let dz = -1; dz <= 1; dz++) {
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const gx = baseX + dx;
                        const gy = baseY + dy;
                        const gz = baseZ + dz;
                        
                        if (gx < 0 || gx >= gridSize ||
                            gy < 0 || gy >= gridSize ||
                            gz < 0 || gz >= gridSize) continue;
                        
                        const { weight, gradWeight } = computeWeight(
                            p.x, p.y, p.z,
                            gx, gy, gz,
                            this.cellSize
                        );
                        
                        if (weight < 1e-10) continue;
                        
                        const cellIdx = gx + gy * gridSize + gz * gridSize * gridSize;
                        const cell = grid[cellIdx];
                        
                        // Mass transfer
                        cell.mass += p.mass * weight;
                        
                        // Momentum transfer (APIC)
                        const dpos = [
                            (gx * this.cellSize - p.x),
                            (gy * this.cellSize - p.y),
                            (gz * this.cellSize - p.z),
                        ];
                        
                        // v + C * dpos
                        const affineVel = [
                            p.vx + p.C[0]*dpos[0] + p.C[3]*dpos[1] + p.C[6]*dpos[2],
                            p.vy + p.C[1]*dpos[0] + p.C[4]*dpos[1] + p.C[7]*dpos[2],
                            p.vz + p.C[2]*dpos[0] + p.C[5]*dpos[1] + p.C[8]*dpos[2],
                        ];
                        
                        cell.mx += p.mass * weight * affineVel[0];
                        cell.my += p.mass * weight * affineVel[1];
                        cell.mz += p.mass * weight * affineVel[2];
                        
                        // Force from stress
                        const force = [
                            -p.volume * (stress[0]*gradWeight[0] + stress[3]*gradWeight[1] + stress[6]*gradWeight[2]),
                            -p.volume * (stress[1]*gradWeight[0] + stress[4]*gradWeight[1] + stress[7]*gradWeight[2]),
                            -p.volume * (stress[2]*gradWeight[0] + stress[5]*gradWeight[1] + stress[8]*gradWeight[2]),
                        ];
                        
                        cell.mx += force[0] * dt;
                        cell.my += force[1] * dt;
                        cell.mz += force[2] * dt;
                    }
                }
            }
        }
    }
    
    _computeStress(p) {
        const { mu, lambda } = p.getLameParams();
        const F = p.F;
        
        // Simple Neo-Hookean for now
        // P = mu * (F - F^-T) + lambda * log(J) * F^-T
        const J = this._det3x3(F);
        const Finv = this._inv3x3(F);
        const FinvT = this._transpose3x3(Finv);
        
        const logJ = Math.log(Math.max(J, 0.01));
        
        const stress = [];
        for (let i = 0; i < 9; i++) {
            stress[i] = mu * (F[i] - FinvT[i]) + lambda * logJ * FinvT[i];
        }
        
        // Cauchy stress = P * F^T / J
        const FT = this._transpose3x3(F);
        const cauchy = this._mul3x3(stress, FT);
        for (let i = 0; i < 9; i++) {
            cauchy[i] /= J;
        }
        
        return cauchy;
    }
    
    _gridUpdateCPU(dt) {
        const grid = this._grid;
        const gridSize = this.gridSize;
        
        for (let i = 0; i < grid.length; i++) {
            const cell = grid[i];
            if (cell.mass < 1e-10) continue;
            
            // Convert momentum to velocity
            cell.vx = cell.mx / cell.mass;
            cell.vy = cell.my / cell.mass;
            cell.vz = cell.mz / cell.mass;
            
            // Apply gravity
            cell.vx += this.gravity[0] * dt;
            cell.vy += this.gravity[1] * dt;
            cell.vz += this.gravity[2] * dt;
            
            // Boundary conditions
            const gz = Math.floor(i / (gridSize * gridSize));
            const gy = Math.floor((i % (gridSize * gridSize)) / gridSize);
            const gx = i % gridSize;
            
            // Ground
            if (gy < 3 && cell.vy < 0) cell.vy = 0;
            // Walls
            if (gx < 3 && cell.vx < 0) cell.vx = 0;
            if (gx > gridSize - 4 && cell.vx > 0) cell.vx = 0;
            if (gz < 3 && cell.vz < 0) cell.vz = 0;
            if (gz > gridSize - 4 && cell.vz > 0) cell.vz = 0;
        }
    }
    
    _g2pCPU(dt) {
        const grid = this._grid;
        const gridSize = this.gridSize;
        
        for (const p of this.particles) {
            const baseX = Math.floor(p.x / this.cellSize);
            const baseY = Math.floor(p.y / this.cellSize);
            const baseZ = Math.floor(p.z / this.cellSize);
            
            // Reset velocity and affine
            p.vx = 0; p.vy = 0; p.vz = 0;
            p.C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
            
            // Gather from grid
            for (let dz = -1; dz <= 1; dz++) {
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const gx = baseX + dx;
                        const gy = baseY + dy;
                        const gz = baseZ + dz;
                        
                        if (gx < 0 || gx >= gridSize ||
                            gy < 0 || gy >= gridSize ||
                            gz < 0 || gz >= gridSize) continue;
                        
                        const { weight, gradWeight } = computeWeight(
                            p.x, p.y, p.z,
                            gx, gy, gz,
                            this.cellSize
                        );
                        
                        if (weight < 1e-10) continue;
                        
                        const cellIdx = gx + gy * gridSize + gz * gridSize * gridSize;
                        const cell = grid[cellIdx];
                        
                        // Gather velocity
                        p.vx += weight * cell.vx;
                        p.vy += weight * cell.vy;
                        p.vz += weight * cell.vz;
                        
                        // APIC affine matrix
                        const dpos = [
                            gx * this.cellSize - p.x,
                            gy * this.cellSize - p.y,
                            gz * this.cellSize - p.z,
                        ];
                        
                        // C += w * v * dpos^T * (4/dx^2)
                        const scale = 4 / (this.cellSize * this.cellSize);
                        p.C[0] += weight * cell.vx * dpos[0] * scale;
                        p.C[1] += weight * cell.vy * dpos[0] * scale;
                        p.C[2] += weight * cell.vz * dpos[0] * scale;
                        p.C[3] += weight * cell.vx * dpos[1] * scale;
                        p.C[4] += weight * cell.vy * dpos[1] * scale;
                        p.C[5] += weight * cell.vz * dpos[1] * scale;
                        p.C[6] += weight * cell.vx * dpos[2] * scale;
                        p.C[7] += weight * cell.vy * dpos[2] * scale;
                        p.C[8] += weight * cell.vz * dpos[2] * scale;
                    }
                }
            }
            
            // Advect position
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.z += p.vz * dt;
            
            // Update deformation gradient
            // F_new = (I + dt * C) * F_old
            const I_plus_dtC = [
                1 + dt * p.C[0], dt * p.C[1], dt * p.C[2],
                dt * p.C[3], 1 + dt * p.C[4], dt * p.C[5],
                dt * p.C[6], dt * p.C[7], 1 + dt * p.C[8],
            ];
            p.F = this._mul3x3(I_plus_dtC, p.F);
        }
    }
    
    // Matrix helpers
    _det3x3(m) {
        return m[0]*(m[4]*m[8] - m[5]*m[7]) - m[3]*(m[1]*m[8] - m[2]*m[7]) + m[6]*(m[1]*m[5] - m[2]*m[4]);
    }
    
    _inv3x3(m) {
        const det = this._det3x3(m);
        if (Math.abs(det) < 1e-10) return [1,0,0,0,1,0,0,0,1];
        const invDet = 1 / det;
        return [
            (m[4]*m[8] - m[5]*m[7]) * invDet,
            (m[2]*m[7] - m[1]*m[8]) * invDet,
            (m[1]*m[5] - m[2]*m[4]) * invDet,
            (m[5]*m[6] - m[3]*m[8]) * invDet,
            (m[0]*m[8] - m[2]*m[6]) * invDet,
            (m[2]*m[3] - m[0]*m[5]) * invDet,
            (m[3]*m[7] - m[4]*m[6]) * invDet,
            (m[1]*m[6] - m[0]*m[7]) * invDet,
            (m[0]*m[4] - m[1]*m[3]) * invDet,
        ];
    }
    
    _transpose3x3(m) {
        return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
    }
    
    _mul3x3(a, b) {
        return [
            a[0]*b[0] + a[3]*b[1] + a[6]*b[2],
            a[1]*b[0] + a[4]*b[1] + a[7]*b[2],
            a[2]*b[0] + a[5]*b[1] + a[8]*b[2],
            a[0]*b[3] + a[3]*b[4] + a[6]*b[5],
            a[1]*b[3] + a[4]*b[4] + a[7]*b[5],
            a[2]*b[3] + a[5]*b[4] + a[8]*b[5],
            a[0]*b[6] + a[3]*b[7] + a[6]*b[8],
            a[1]*b[6] + a[4]*b[7] + a[7]*b[8],
            a[2]*b[6] + a[5]*b[7] + a[8]*b[8],
        ];
    }
    
    /**
     * Destroy GPU resources
     */
    destroy() {
        this.positionBuffer?.destroy();
        this.velocityBuffer?.destroy();
        this.deformationBuffer?.destroy();
        this.affineBuffer?.destroy();
        this.massVolumeBuffer?.destroy();
        this.materialBuffer?.destroy();
        this.gridBuffer?.destroy();
        this.gridVelocityBuffer?.destroy();
        this.uniformBuffer?.destroy();
        this.countBuffer?.destroy();
        this.initialized = false;
    }
}

export default MLSMPMSolver;
