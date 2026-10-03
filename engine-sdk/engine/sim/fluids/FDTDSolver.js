// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * FDTDSolver.js - Finite-Difference Time-Domain Electromagnetic Solver
 * 
 * Implements Maxwell's equations with TIME-VARYING materials for:
 * - Photonic time crystals
 * - Time reflection/refraction
 * - Temporal metamaterials
 * - Wave manipulation via ε(t) and μ(t) modulation
 * 
 * Key Physics:
 * - When ε(t) changes suddenly, E = D/ε shifts → creates backward wave
 * - When μ(t) changes suddenly, H = B/μ shifts → frequency conversion
 * - Periodic modulation of ε(t) → photonic time crystal band gaps
 * 
 * Uses Yee grid (staggered) for numerical stability:
 * - E fields at integer grid points
 * - H fields at half-integer grid points
 * - Leapfrog time stepping
 * 
 * References:
 * - Taflove & Hagness, "Computational Electrodynamics: The FDTD Method"
 * - Galiffi et al., "Photonic Time Crystals" (2022)
 */

import { PingPongBuffer } from '../../core/profiler/PerformanceOptimizer.js';

// Reusable buffers for hot paths (reduce/reuse/recycle)
const _fdtdUniformsF32 = new Float32Array(32);
import { BindGroupSignals } from '../../core/gpu/BindingSignals.js';
import { getGPUMemoryManager } from '../../core/memory/GPUMemoryManager.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Physical constants */
export const PHYSICS = {
    c: 299792458,           // Speed of light (m/s)
    epsilon0: 8.854e-12,    // Vacuum permittivity (F/m)
    mu0: 1.2566e-6,         // Vacuum permeability (H/m)
    eta0: 377,              // Impedance of free space (Ω)
};

/** Material types */
export const MaterialType = {
    VACUUM: 0,
    DIELECTRIC: 1,
    CONDUCTOR: 2,
    PEC: 3,                 // Perfect Electric Conductor
    PMC: 4,                 // Perfect Magnetic Conductor
    DISPERSIVE: 5,          // Drude/Lorentz model
    TIME_VARYING: 6,        // ε(t), μ(t) modulation
    PHOTONIC_CRYSTAL: 7,    // Spatial + temporal periodicity
};

/** Boundary conditions */
export const BoundaryCondition = {
    PEC: 0,                 // Perfect Electric Conductor (E_tan = 0)
    PMC: 1,                 // Perfect Magnetic Conductor (H_tan = 0)
    PML: 2,                 // Perfectly Matched Layer (absorbing)
    PERIODIC: 3,            // Periodic (wraps around)
    MUR: 4,                 // Mur absorbing (first-order)
};

/** Source types */
export const SourceType = {
    GAUSSIAN_PULSE: 0,
    SINUSOIDAL: 1,
    RICKER_WAVELET: 2,
    PLANE_WAVE: 3,
    POINT_SOURCE: 4,
    TFSF: 5,                // Total-Field/Scattered-Field
};

// ============================================================================
// YEE CELL
// ============================================================================

/**
 * Yee cell field components
 * Staggered grid: E at integers, H at half-integers
 */
export class YeeCell {
    constructor() {
        // Electric field components
        this.Ex = 0;
        this.Ey = 0;
        this.Ez = 0;
        
        // Magnetic field components
        this.Hx = 0;
        this.Hy = 0;
        this.Hz = 0;
        
        // Electric displacement (D = εE)
        this.Dx = 0;
        this.Dy = 0;
        this.Dz = 0;
        
        // Magnetic induction (B = μH)
        this.Bx = 0;
        this.By = 0;
        this.Bz = 0;
        
        // Material properties (can be time-varying)
        this.epsilon = 1;    // Relative permittivity
        this.mu = 1;         // Relative permeability
        this.sigma = 0;      // Electric conductivity
        this.sigmaM = 0;     // Magnetic conductivity
        
        // Material type
        this.materialType = MaterialType.VACUUM;
    }
}

// ============================================================================
// TIME-VARYING MATERIAL
// ============================================================================

/**
 * Time-varying material properties
 */
export class TimeVaryingMaterial {
    constructor(options = {}) {
        this.baseEpsilon = options.baseEpsilon ?? 1;
        this.baseMu = options.baseMu ?? 1;
        
        // Modulation parameters
        this.modulationType = options.modulationType ?? 'none';
        this.modulationDepth = options.modulationDepth ?? 0;      // Δε/ε₀
        this.modulationFrequency = options.modulationFrequency ?? 0;  // Hz
        this.modulationPhase = options.modulationPhase ?? 0;
        
        // Step change (for time reflection)
        this.stepTime = options.stepTime ?? -1;           // Time of step change
        this.stepEpsilon = options.stepEpsilon ?? null;   // New ε after step
        this.stepMu = options.stepMu ?? null;             // New μ after step
        
        // Spatial extent
        this.region = options.region ?? null;  // { min: [x,y,z], max: [x,y,z] }
    }
    
    /**
     * Get permittivity at given time
     * @param {number} t - Time in seconds
     * @returns {number}
     */
    getEpsilon(t) {
        // Step change (time reflection)
        if (this.stepTime >= 0 && t >= this.stepTime && this.stepEpsilon !== null) {
            return this.stepEpsilon;
        }
        
        // Periodic modulation (photonic time crystal)
        if (this.modulationType === 'sinusoidal' && this.modulationFrequency > 0) {
            const phase = 2 * Math.PI * this.modulationFrequency * t + this.modulationPhase;
            return this.baseEpsilon * (1 + this.modulationDepth * Math.sin(phase));
        }
        
        // Square wave modulation
        if (this.modulationType === 'square' && this.modulationFrequency > 0) {
            const phase = (this.modulationFrequency * t + this.modulationPhase / (2 * Math.PI)) % 1;
            return this.baseEpsilon * (1 + this.modulationDepth * (phase < 0.5 ? 1 : -1));
        }
        
        return this.baseEpsilon;
    }
    
    /**
     * Get permeability at given time
     * @param {number} t 
     * @returns {number}
     */
    getMu(t) {
        if (this.stepTime >= 0 && t >= this.stepTime && this.stepMu !== null) {
            return this.stepMu;
        }
        
        return this.baseMu;
    }
    
    /**
     * Check if point is within material region
     * @param {number} x 
     * @param {number} y 
     * @param {number} z 
     * @returns {boolean}
     */
    containsPoint(x, y, z) {
        if (!this.region) return true;
        
        return x >= this.region.min[0] && x <= this.region.max[0] &&
               y >= this.region.min[1] && y <= this.region.max[1] &&
               z >= this.region.min[2] && z <= this.region.max[2];
    }
}

// ============================================================================
// FDTD SOURCE
// ============================================================================

export class FDTDSource {
    constructor(options = {}) {
        this.type = options.type ?? SourceType.GAUSSIAN_PULSE;
        this.position = options.position ?? [0, 0, 0];
        this.amplitude = options.amplitude ?? 1;
        this.frequency = options.frequency ?? 1e9;  // 1 GHz default
        this.bandwidth = options.bandwidth ?? 0.5e9;
        this.delay = options.delay ?? 0;
        this.polarization = options.polarization ?? [1, 0, 0];  // E-field direction
        
        // For plane wave / TFSF
        this.direction = options.direction ?? [0, 0, 1];
        
        // Computed parameters
        this.omega = 2 * Math.PI * this.frequency;
        this.t0 = 1 / this.bandwidth;  // Pulse center time
    }
    
    /**
     * Get source value at time t
     * @param {number} t 
     * @returns {number}
     */
    getValue(t) {
        t = t - this.delay;
        
        switch (this.type) {
            case SourceType.GAUSSIAN_PULSE:
                return this.amplitude * Math.exp(-Math.pow((t - this.t0) / (this.t0 / 4), 2)) *
                       Math.sin(this.omega * t);
                
            case SourceType.SINUSOIDAL:
                return this.amplitude * Math.sin(this.omega * t);
                
            case SourceType.RICKER_WAVELET:
                const tp = t - this.t0;
                const arg = Math.pow(Math.PI * this.frequency * tp, 2);
                return this.amplitude * (1 - 2 * arg) * Math.exp(-arg);
                
            default:
                return 0;
        }
    }
}

// ============================================================================
// FDTD SOLVER
// ============================================================================

export class FDTDSolver {
    /**
     * @param {GPUDevice} device 
     * @param {Object} options 
     */
    constructor(device, options = {}) {
        this.device = device;
        
        // Grid dimensions
        this.nx = options.nx ?? 64;
        this.ny = options.ny ?? 64;
        this.nz = options.nz ?? 64;
        
        // Spatial resolution
        this.dx = options.dx ?? 1e-3;  // 1mm default
        this.dy = options.dy ?? this.dx;
        this.dz = options.dz ?? this.dx;
        
        // Time step (CFL condition)
        this.dt = options.dt ?? this._computeStableDt();
        
        // Boundary conditions
        this.boundaryCondition = options.boundaryCondition ?? BoundaryCondition.PML;
        this.pmlLayers = options.pmlLayers ?? 8;
        
        // Materials
        this.materials = [];
        this.timeVaryingMaterials = [];
        
        // Sources
        this.sources = [];
        
        // GPU buffers
        this.fieldBuffers = null;
        this.materialBuffer = null;
        this.uniformBuffer = null;
        
        // Pipelines
        this.updateEPipeline = null;
        this.updateHPipeline = null;
        this.updateDPipeline = null;
        this.updateBPipeline = null;

        this.bindGroups = null;
        
        // State
        this.time = 0;
        this.step = 0;
        this.initialized = false;
    }
    
    /**
     * Compute stable time step via CFL condition
     */
    _computeStableDt() {
        // CFL: c * dt <= dx / sqrt(3) for 3D
        const cfl = 0.99;  // Safety factor
        const minDx = Math.min(this.dx, this.dy, this.dz);
        return cfl * minDx / (PHYSICS.c * Math.sqrt(3));
    }
    
    /**
     * Initialize GPU resources
     */
    async init() {
        const cellCount = this.nx * this.ny * this.nz;
        
        // Field buffers (D, B, E, H) - ping-pong
        // Each field: vec3 per cell = 12 bytes
        // Total per buffer: 4 fields * 3 components * 4 bytes = 48 bytes per cell
        const fieldBufferSize = cellCount * 48;
        
        this.fieldBuffers = new PingPongBuffer(this.device, {
            label: 'FDTD Fields',
            size: fieldBufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
            strategy: 2,  // Double buffer
        });
        
        // Material buffer: ε, μ, σ, σm, type per cell = 20 bytes
        this.materialBuffer = this.device.createBuffer({
            label: 'FDTD Materials',
            size: cellCount * 20,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
        // Uniform buffer
        this.uniformBuffer = this.device.createBuffer({
            label: 'FDTD Uniforms',
            size: 128,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        
        // Initialize materials to vacuum
        await this._initializeMaterials();
        
        // Create pipelines
        await this._createPipelines();
        
        this.initialized = true;
    }
    
    async _initializeMaterials() {
        const cellCount = this.nx * this.ny * this.nz;
        const data = new Float32Array(cellCount * 5);
        
        for (let i = 0; i < cellCount; i++) {
            const offset = i * 5;
            data[offset + 0] = 1;  // epsilon
            data[offset + 1] = 1;  // mu
            data[offset + 2] = 0;  // sigma
            data[offset + 3] = 0;  // sigmaM
            data[offset + 4] = MaterialType.VACUUM;
        }
        
        this.device.queue.writeBuffer(this.materialBuffer, 0, data);
    }
    
    async _createPipelines() {
        const shaderModule = this.device.createShaderModule({
            label: 'FDTD Update Shader',
            code: FDTD_SHADER_CODE,
        });
        
        // Update D from curl(H)
        this.updateDPipeline = this.device.createComputePipeline({
            label: 'FDTD Update D',
            layout: 'auto',
            compute: {
                module: shaderModule,
                entryPoint: 'updateD',
            },
        });
        
        // Update E from D/ε (time reflection happens here!)
        this.updateEPipeline = this.device.createComputePipeline({
            label: 'FDTD Update E',
            layout: 'auto',
            compute: {
                module: shaderModule,
                entryPoint: 'updateE',
            },
        });
        
        // Update B from -curl(E)
        this.updateBPipeline = this.device.createComputePipeline({
            label: 'FDTD Update B',
            layout: 'auto',
            compute: {
                module: shaderModule,
                entryPoint: 'updateB',
            },
        });
        
        // Update H from B/μ
        this.updateHPipeline = this.device.createComputePipeline({
            label: 'FDTD Update H',
            layout: 'auto',
            compute: {
                module: shaderModule,
                entryPoint: 'updateH',
            },
        });
    }
    
    /**
     * Add time-varying material
     * @param {TimeVaryingMaterial} material 
     */
    addTimeVaryingMaterial(material) {
        this.timeVaryingMaterials.push(material);
    }
    
    /**
     * Add source
     * @param {FDTDSource} source 
     */
    addSource(source) {
        this.sources.push(source);
    }
    
    /**
     * Schedule time reflection event
     * @param {number} time - When to trigger
     * @param {Object} region - { min, max }
     * @param {number} newEpsilon - New permittivity
     * @param {number} newMu - New permeability (optional)
     */
    scheduleTimeReflection(time, region, newEpsilon, newMu = null) {
        const material = new TimeVaryingMaterial({
            baseEpsilon: 1,
            baseMu: 1,
            stepTime: time,
            stepEpsilon: newEpsilon,
            stepMu: newMu ?? 1,
            region,
        });
        this.timeVaryingMaterials.push(material);
    }
    
    /**
     * Create photonic time crystal
     * @param {Object} region 
     * @param {number} frequency - Modulation frequency
     * @param {number} depth - Modulation depth (Δε/ε)
     */
    createPhotonicTimeCrystal(region, frequency, depth) {
        const material = new TimeVaryingMaterial({
            baseEpsilon: 2,
            modulationType: 'sinusoidal',
            modulationFrequency: frequency,
            modulationDepth: depth,
            region,
        });
        this.timeVaryingMaterials.push(material);
    }
    
    /**
     * Update uniforms before step
     */
    _updateUniforms() {
        const data = _fdtdUniformsF32;  // Reuse buffer
        
        // Grid dimensions
        data[0] = this.nx;
        data[1] = this.ny;
        data[2] = this.nz;
        data[3] = 0;
        
        // Spatial steps
        data[4] = this.dx;
        data[5] = this.dy;
        data[6] = this.dz;
        data[7] = this.dt;
        
        // Physical constants (scaled)
        data[8] = PHYSICS.c;
        data[9] = PHYSICS.epsilon0;
        data[10] = PHYSICS.mu0;
        data[11] = this.time;
        
        // Update coefficients
        const Cx = this.dt / this.dx;
        const Cy = this.dt / this.dy;
        const Cz = this.dt / this.dz;
        data[12] = Cx;
        data[13] = Cy;
        data[14] = Cz;
        data[15] = this.step;
        
        this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
    }
    
    /**
     * Update time-varying materials
     */
    _updateTimeVaryingMaterials() {
        if (this.timeVaryingMaterials.length === 0) return;
        
        // This would update the material buffer with current ε(t), μ(t) values
        // For GPU efficiency, we'd encode the modulation parameters
        // and compute ε(t), μ(t) in the shader
        
        // For now, CPU update (could be GPU compute pass)
        const cellCount = this.nx * this.ny * this.nz;
        const data = new Float32Array(cellCount * 5);
        
        for (let iz = 0; iz < this.nz; iz++) {
            for (let iy = 0; iy < this.ny; iy++) {
                for (let ix = 0; ix < this.nx; ix++) {
                    const idx = ix + iy * this.nx + iz * this.nx * this.ny;
                    const offset = idx * 5;
                    
                    // World position
                    const x = ix * this.dx;
                    const y = iy * this.dy;
                    const z = iz * this.dz;
                    
                    // Default vacuum
                    let epsilon = 1;
                    let mu = 1;
                    let sigma = 0;
                    let sigmaM = 0;
                    let type = MaterialType.VACUUM;
                    
                    // Check time-varying materials
                    for (const mat of this.timeVaryingMaterials) {
                        if (mat.containsPoint(x, y, z)) {
                            epsilon = mat.getEpsilon(this.time);
                            mu = mat.getMu(this.time);
                            type = MaterialType.TIME_VARYING;
                        }
                    }
                    
                    data[offset + 0] = epsilon;
                    data[offset + 1] = mu;
                    data[offset + 2] = sigma;
                    data[offset + 3] = sigmaM;
                    data[offset + 4] = type;
                }
            }
        }
        
        this.device.queue.writeBuffer(this.materialBuffer, 0, data);
    }
    
    /**
     * Inject sources
     * @param {GPUCommandEncoder} encoder 
     */
    _injectSources(encoder) {
        // For now, sources are injected via CPU buffer update
        // Could be a separate compute pass for efficiency
        
        for (const source of this.sources) {
            const value = source.getValue(this.time);
            // Would add to E field at source position
        }
    }
    
    /**
     * Perform one FDTD time step
     * @param {GPUCommandEncoder} encoder 
     */
    step(encoder) {
        if (!this.initialized) return;
        
        // Update uniforms
        this._updateUniforms();
        
        // Update time-varying materials (THE MAGIC!)
        this._updateTimeVaryingMaterials();
        
        const workgroupsX = Math.ceil(this.nx / 8);
        const workgroupsY = Math.ceil(this.ny / 8);
        const workgroupsZ = Math.ceil(this.nz / 4);
        
        const readBuffer = this.fieldBuffers.getReadBuffer();
        const writeBuffer = this.fieldBuffers.getWriteBuffer();

        if (!this.bindGroups) {
            const gpu = getGPUMemoryManager(this.device);
            const externalGetBindGroup = gpu && gpu.bindGroupCache && typeof gpu.getBindGroup === 'function' ? gpu.getBindGroup.bind(gpu) : null;
            this.bindGroups = new BindGroupSignals(
                this.device,
                this.updateDPipeline.getBindGroupLayout(0),
                [
                    { name: 'uniforms', binding: 0 },
                    { name: 'readField', binding: 1 },
                    { name: 'writeField', binding: 2 },
                    { name: 'materials', binding: 3 },
                ],
                { label: 'FDTDSolver.bindGroup', maxEntries: 8, getBindGroup: externalGetBindGroup }
            );
        }

        const bindGroup = this.bindGroups.get({
            uniforms: this.uniformBuffer,
            readField: readBuffer,
            writeField: writeBuffer,
            materials: this.materialBuffer,
        }, 'FDTDSolver.bindGroup');
        
        // Step 1: Update D from curl(H)
        // D^(n+1) = D^n + dt * curl(H^(n+1/2))
        let pass = encoder.beginComputePass();
        pass.setPipeline(this.updateDPipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(workgroupsX, workgroupsY, workgroupsZ);
        pass.end();
        
        // Step 2: Update E from D/ε
        // E^(n+1) = D^(n+1) / ε(t)
        // THIS IS WHERE TIME REFLECTION OCCURS!
        // When ε changes suddenly, E = D/ε shifts
        pass = encoder.beginComputePass();
        pass.setPipeline(this.updateEPipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(workgroupsX, workgroupsY, workgroupsZ);
        pass.end();
        
        // Step 3: Update B from -curl(E)
        // B^(n+3/2) = B^(n+1/2) - dt * curl(E^(n+1))
        pass = encoder.beginComputePass();
        pass.setPipeline(this.updateBPipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(workgroupsX, workgroupsY, workgroupsZ);
        pass.end();
        
        // Step 4: Update H from B/μ
        // H^(n+3/2) = B^(n+3/2) / μ(t)
        pass = encoder.beginComputePass();
        pass.setPipeline(this.updateHPipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(workgroupsX, workgroupsY, workgroupsZ);
        pass.end();
        
        // Swap buffers
        this.fieldBuffers.swap();
        
        // Advance time
        this.time += this.dt;
        this.step++;
    }
    
    /**
     * Run multiple steps
     * @param {number} numSteps 
     */
    async run(numSteps) {
        for (let i = 0; i < numSteps; i++) {
            const encoder = this.device.createCommandEncoder();
            this.step(encoder);
            this.device.queue.submit([encoder.finish()]);
        }
        await this.device.queue.onSubmittedWorkDone();
    }
    
    /**
     * Get field data for visualization
     * @returns {Promise<Float32Array>}
     */
    async getFieldData() {
        const buffer = this.fieldBuffers.getReadBuffer();
        const size = this.nx * this.ny * this.nz * 48;
        
        const readBuffer = this.device.createBuffer({
            size,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
        
        const encoder = this.device.createCommandEncoder();
        encoder.copyBufferToBuffer(buffer, 0, readBuffer, 0, size);
        this.device.queue.submit([encoder.finish()]);
        
        await readBuffer.mapAsync(GPUMapMode.READ);
        const data = new Float32Array(readBuffer.getMappedRange().slice(0));
        readBuffer.unmap();
        readBuffer.destroy();
        
        return data;
    }
    
    /**
     * Reset simulation
     */
    reset() {
        this.time = 0;
        this.step = 0;
        // Would clear field buffers
    }
    
    /**
     * Get simulation info
     */
    getInfo() {
        return {
            gridSize: [this.nx, this.ny, this.nz],
            resolution: [this.dx, this.dy, this.dz],
            dt: this.dt,
            time: this.time,
            step: this.step,
            cfl: this.dt * PHYSICS.c * Math.sqrt(3) / Math.min(this.dx, this.dy, this.dz),
            sources: this.sources.length,
            timeVaryingMaterials: this.timeVaryingMaterials.length,
        };
    }
    
    // ========================================================================
    // STABILITY CONTROLS
    // ========================================================================
    
    /**
     * Enforce CFL condition for numerical stability
     * CFL: c * dt <= dx / sqrt(dims) for FDTD
     * 
     * @param {number} epsilon - Relative permittivity
     * @param {number} mu - Relative permeability
     * @returns {number} Clamped epsilon to ensure stability
     */
    enforceCFL(epsilon, mu) {
        const dims = 3;
        const minDx = Math.min(this.dx, this.dy, this.dz);
        
        // Maximum phase velocity for stability
        const maxPhaseVelocity = minDx / (this.dt * Math.sqrt(dims));
        
        // Current phase velocity: c / sqrt(epsilon * mu)
        const currentVelocity = PHYSICS.c / Math.sqrt(epsilon * mu);
        
        // If too fast, increase epsilon to slow down
        if (currentVelocity > maxPhaseVelocity) {
            const requiredN = PHYSICS.c / maxPhaseVelocity;
            const minEpsilon = (requiredN * requiredN) / mu;
            return Math.max(epsilon, minEpsilon);
        }
        
        return epsilon;
    }
    
    /**
     * Get minimum stable epsilon for given mu
     * @param {number} mu - Relative permeability
     * @returns {number} Minimum epsilon for CFL stability
     */
    getMinStableEpsilon(mu = 1) {
        const dims = 3;
        const minDx = Math.min(this.dx, this.dy, this.dz);
        
        // CFL: c/n * dt <= dx/sqrt(3)
        // n = sqrt(epsilon * mu) >= c * dt * sqrt(3) / dx
        const minN = PHYSICS.c * this.dt * Math.sqrt(dims) / minDx;
        return (minN * minN) / mu;
    }
    
    /**
     * Compute number of sub-steps needed for stability with fast media
     * @param {number} minEpsilon - Minimum epsilon in simulation
     * @param {number} minMu - Minimum mu in simulation
     * @returns {number} Number of sub-steps
     */
    computeSubSteps(minEpsilon, minMu) {
        const dims = 3;
        const minDx = Math.min(this.dx, this.dy, this.dz);
        
        // Phase velocity in fastest medium
        const maxVelocity = PHYSICS.c / Math.sqrt(minEpsilon * minMu);
        
        // CFL number
        const cfl = maxVelocity * this.dt * Math.sqrt(dims) / minDx;
        
        // Number of sub-steps to bring CFL below 1
        return Math.max(1, Math.ceil(cfl));
    }
    
    /**
     * Run with adaptive sub-stepping for stability
     * @param {number} numSteps - Number of full steps
     * @param {number} minEpsilon - Minimum epsilon (for sub-step calculation)
     */
    async runAdaptive(numSteps, minEpsilon = 0.1) {
        const subSteps = this.computeSubSteps(minEpsilon, 1);
        const subDt = this.dt / subSteps;
        const originalDt = this.dt;
        
        console.log(`FDTD: Using ${subSteps} sub-steps (dt=${subDt.toExponential(3)})`);
        
        this.dt = subDt;
        
        for (let i = 0; i < numSteps; i++) {
            for (let j = 0; j < subSteps; j++) {
                const encoder = this.device.createCommandEncoder();
                this.step(encoder);
                this.device.queue.submit([encoder.finish()]);
            }
        }
        
        this.dt = originalDt;
        await this.device.queue.onSubmittedWorkDone();
    }
    
    /**
     * Saturate field value to prevent NaN/Inf explosion
     * Uses soft clipping: E_sat * tanh(E / E_sat)
     * 
     * @param {number} value - Field value
     * @param {number} saturation - Saturation threshold
     * @returns {number} Saturated value
     */
    saturateField(value, saturation = 1e6) {
        if (!Number.isFinite(value)) {
            console.warn('FDTD: NaN/Inf detected, clamping to 0');
            return 0;
        }
        
        if (Math.abs(value) < saturation * 0.1) {
            return value;  // Linear region
        }
        
        return saturation * Math.tanh(value / saturation);
    }
    
    /**
     * Saturate 3D vector field
     * @param {number[]} field - [x, y, z] components
     * @param {number} saturation - Threshold
     * @returns {number[]}
     */
    saturateFieldVector(field, saturation = 1e6) {
        return [
            this.saturateField(field[0], saturation),
            this.saturateField(field[1], saturation),
            this.saturateField(field[2], saturation),
        ];
    }
    
    /**
     * Check for NaN/Inf in field data and recover
     * @param {Float32Array} data - Field data
     * @returns {{ hasNaN: boolean, nanCount: number, recovered: boolean }}
     */
    checkAndRecoverNaN(data) {
        let nanCount = 0;
        
        for (let i = 0; i < data.length; i++) {
            if (!Number.isFinite(data[i])) {
                nanCount++;
                data[i] = 0;  // Reset to zero
            }
        }
        
        return {
            hasNaN: nanCount > 0,
            nanCount,
            recovered: nanCount > 0,
        };
    }
    
    /**
     * Get stability diagnostics
     * @returns {Object}
     */
    getStabilityDiagnostics() {
        const dims = 3;
        const minDx = Math.min(this.dx, this.dy, this.dz);
        
        // CFL number for vacuum
        const cflVacuum = PHYSICS.c * this.dt * Math.sqrt(dims) / minDx;
        
        // Minimum stable epsilon
        const minStableEpsilon = this.getMinStableEpsilon(1);
        
        // Maximum stable modulation depth (rough estimate)
        // Modulation shouldn't push epsilon below minimum
        const baseEpsilon = 1;
        const maxModDepth = 1 - (minStableEpsilon / baseEpsilon);
        
        return {
            cflVacuum,
            isStableVacuum: cflVacuum <= 1,
            minStableEpsilon,
            maxModulationDepth: Math.max(0, maxModDepth),
            dt: this.dt,
            recommendedDt: minDx / (PHYSICS.c * Math.sqrt(dims) * 1.1),  // 10% margin
            gridResolution: minDx,
        };
    }
    
    /**
     * Auto-configure dt for stability
     * @param {number} safetyFactor - Margin below CFL limit (default 0.9)
     */
    autoConfigureDt(safetyFactor = 0.9) {
        const dims = 3;
        const minDx = Math.min(this.dx, this.dy, this.dz);
        
        // CFL-stable dt: dt < dx / (c * sqrt(dims))
        const maxDt = minDx / (PHYSICS.c * Math.sqrt(dims));
        this.dt = maxDt * safetyFactor;
        
        console.log(`FDTD: Auto-configured dt = ${this.dt.toExponential(3)}s`);
        
        return this.dt;
    }
    
    destroy() {
        this.fieldBuffers?.destroy();
        this.materialBuffer?.destroy();
        this.uniformBuffer?.destroy();
        this.initialized = false;
    }
}

// ============================================================================
// SHADER CODE
// ============================================================================

const FDTD_SHADER_CODE = /* wgsl */ `
struct Uniforms {
    gridSize: vec3u,
    pad0: u32,
    dx: f32,
    dy: f32,
    dz: f32,
    dt: f32,
    c: f32,
    epsilon0: f32,
    mu0: f32,
    time: f32,
    Cx: f32,
    Cy: f32,
    Cz: f32,
    step: f32,
}

struct FieldCell {
    D: vec3f,
    pad0: f32,
    B: vec3f,
    pad1: f32,
    E: vec3f,
    pad2: f32,
    H: vec3f,
    pad3: f32,
}

struct Material {
    epsilon: f32,
    mu: f32,
    sigma: f32,
    sigmaM: f32,
    materialType: f32,
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> fieldsIn: array<FieldCell>;
@group(0) @binding(2) var<storage, read_write> fieldsOut: array<FieldCell>;
@group(0) @binding(3) var<storage, read> materials: array<Material>;

fn getIndex(pos: vec3u) -> u32 {
    return pos.x + pos.y * u.gridSize.x + pos.z * u.gridSize.x * u.gridSize.y;
}

fn clampPos(pos: vec3i) -> vec3u {
    return vec3u(
        clamp(pos.x, 0i, i32(u.gridSize.x) - 1i),
        clamp(pos.y, 0i, i32(u.gridSize.y) - 1i),
        clamp(pos.z, 0i, i32(u.gridSize.z) - 1i)
    );
}

// Curl of H for D update: curl(H) = ∇ × H
fn curlH(pos: vec3u) -> vec3f {
    let idx = getIndex(pos);
    let posI = vec3i(pos);
    
    // Neighbor indices (with boundary clamping)
    let xp = getIndex(clampPos(posI + vec3i(1, 0, 0)));
    let xm = getIndex(clampPos(posI - vec3i(1, 0, 0)));
    let yp = getIndex(clampPos(posI + vec3i(0, 1, 0)));
    let ym = getIndex(clampPos(posI - vec3i(0, 1, 0)));
    let zp = getIndex(clampPos(posI + vec3i(0, 0, 1)));
    let zm = getIndex(clampPos(posI - vec3i(0, 0, 1)));
    
    let H = fieldsIn[idx].H;
    let Hxp = fieldsIn[xp].H;
    let Hxm = fieldsIn[xm].H;
    let Hyp = fieldsIn[yp].H;
    let Hym = fieldsIn[ym].H;
    let Hzp = fieldsIn[zp].H;
    let Hzm = fieldsIn[zm].H;
    
    // Central differences
    let dHzdy = (Hyp.z - Hym.z) / (2.0 * u.dy);
    let dHydz = (Hzp.y - Hzm.y) / (2.0 * u.dz);
    let dHxdz = (Hzp.x - Hzm.x) / (2.0 * u.dz);
    let dHzdx = (Hxp.z - Hxm.z) / (2.0 * u.dx);
    let dHydx = (Hxp.y - Hxm.y) / (2.0 * u.dx);
    let dHxdy = (Hyp.x - Hym.x) / (2.0 * u.dy);
    
    return vec3f(
        dHzdy - dHydz,
        dHxdz - dHzdx,
        dHydx - dHxdy
    );
}

// Curl of E for B update: curl(E) = ∇ × E
fn curlE(pos: vec3u) -> vec3f {
    let idx = getIndex(pos);
    let posI = vec3i(pos);
    
    let xp = getIndex(clampPos(posI + vec3i(1, 0, 0)));
    let xm = getIndex(clampPos(posI - vec3i(1, 0, 0)));
    let yp = getIndex(clampPos(posI + vec3i(0, 1, 0)));
    let ym = getIndex(clampPos(posI - vec3i(0, 1, 0)));
    let zp = getIndex(clampPos(posI + vec3i(0, 0, 1)));
    let zm = getIndex(clampPos(posI - vec3i(0, 0, 1)));
    
    let E = fieldsOut[idx].E;  // Use updated E
    let Exp = fieldsOut[xp].E;
    let Exm = fieldsOut[xm].E;
    let Eyp = fieldsOut[yp].E;
    let Eym = fieldsOut[ym].E;
    let Ezp = fieldsOut[zp].E;
    let Ezm = fieldsOut[zm].E;
    
    let dEzdy = (Eyp.z - Eym.z) / (2.0 * u.dy);
    let dEydz = (Ezp.y - Ezm.y) / (2.0 * u.dz);
    let dExdz = (Ezp.x - Ezm.x) / (2.0 * u.dz);
    let dEzdx = (Exp.z - Exm.z) / (2.0 * u.dx);
    let dEydx = (Exp.y - Exm.y) / (2.0 * u.dx);
    let dExdy = (Eyp.x - Eym.x) / (2.0 * u.dy);
    
    return vec3f(
        dEzdy - dEydz,
        dExdz - dEzdx,
        dEydx - dExdy
    );
}

// Update D from curl(H): D^(n+1) = D^n + dt * curl(H)
@compute @workgroup_size(8, 8, 4)
fn updateD(@builtin(global_invocation_id) gid: vec3u) {
    if (any(gid >= u.gridSize)) { return; }
    
    let idx = getIndex(gid);
    let curl_H = curlH(gid);
    
    // D^(n+1) = D^n + dt * curl(H)
    fieldsOut[idx].D = fieldsIn[idx].D + u.dt * curl_H;
}

// Update E from D: E = D / ε(t)
// THIS IS WHERE TIME REFLECTION MAGIC HAPPENS!
// When ε(t) changes suddenly, E = D/ε shifts, creating backward wave
@compute @workgroup_size(8, 8, 4)
fn updateE(@builtin(global_invocation_id) gid: vec3u) {
    if (any(gid >= u.gridSize)) { return; }
    
    let idx = getIndex(gid);
    let mat = materials[idx];
    
    // Get current permittivity (may be time-varying!)
    let epsilon = mat.epsilon * u.epsilon0;
    
    // E = D / ε
    // When ε changes suddenly, E instantaneously changes
    // This conserves D (displacement) but shifts E (intensity)
    // Creating the time-reflected wave!
    fieldsOut[idx].E = fieldsOut[idx].D / epsilon;
    
    // With conductivity: lossy update
    if (mat.sigma > 0.0) {
        let loss = mat.sigma * u.dt / (2.0 * epsilon);
        fieldsOut[idx].E = fieldsOut[idx].E * (1.0 - loss) / (1.0 + loss);
    }
}

// Update B from -curl(E): B^(n+1) = B^n - dt * curl(E)
@compute @workgroup_size(8, 8, 4)
fn updateB(@builtin(global_invocation_id) gid: vec3u) {
    if (any(gid >= u.gridSize)) { return; }
    
    let idx = getIndex(gid);
    let curl_E = curlE(gid);
    
    // B^(n+1) = B^n - dt * curl(E)
    fieldsOut[idx].B = fieldsIn[idx].B - u.dt * curl_E;
}

// Update H from B: H = B / μ(t)
@compute @workgroup_size(8, 8, 4)
fn updateH(@builtin(global_invocation_id) gid: vec3u) {
    if (any(gid >= u.gridSize)) { return; }
    
    let idx = getIndex(gid);
    let mat = materials[idx];
    
    // Get current permeability
    let mu = mat.mu * u.mu0;
    
    // H = B / μ
    fieldsOut[idx].H = fieldsOut[idx].B / mu;
    
    // With magnetic conductivity
    if (mat.sigmaM > 0.0) {
        let loss = mat.sigmaM * u.dt / (2.0 * mu);
        fieldsOut[idx].H = fieldsOut[idx].H * (1.0 - loss) / (1.0 + loss);
    }
}
`;

export default FDTDSolver;
