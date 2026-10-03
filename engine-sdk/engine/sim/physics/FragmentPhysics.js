/**
 * FragmentPhysics.js - Physics Integration for Mesh Fragments
 * 
 * Handles physics simulation for fracture fragments using PhysX.
 * Features:
 * - Convex hull generation for rigid body collision
 * - Mass distribution based on volume/material
 * - Structural connection graph for progressive collapse
 * - Fragment → particle conversion for small pieces
 */

import { MeshCutter, MeshFragment, Triangle, Vertex, Plane } from './MeshCutter.js';
import { VoronoiFracture, FRACTURE_PATTERNS } from './VoronoiFracture.js';
import { StructuralIntegritySolver, ANCHOR_TYPE } from './StructuralIntegrity.js';
import { HybridConnectivity } from '../../core/math/UnionFind.js';
import { decimateQEM } from './MeshDecimation.js';
import { legacyPrimeCoordinateXorHash3D } from '../../core/math/MathBits.js';
import { triangleArea } from '../../core/math/MathGeometry.js';
import {
    legacyLcgAdvanceState32,
    legacyLcgStateToFloat01,
    randomInTriangle,
} from '../../core/math/MathRandom.js';
import {
    createMeshParticleBuffers,
    generateMeshParticlesIntoParticlesState,
} from '../particles/MeshToParticlesCompute.js';
import { getActiveParticlesState } from '../particles/ParticlesStateRegistry.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Material densities (kg/m³) */
const MATERIAL_DENSITY = {
    stone: 2500,
    brick: 1800,
    concrete: 2400,
    wood: 600,
    metal: 7800,
    glass: 2500,
    default: 2000,
};

/** Minimum fragment size before converting to particles (meters) */
const MIN_FRAGMENT_SIZE = 0.2;

/** Maximum fragments per destruction event */
const MAX_FRAGMENTS = 32;

// ============================================================================
// STRUCTURAL CONNECTION
// ============================================================================

/**
 * Represents a connection between two fragments
 */
export class StructuralConnection {
    constructor(fragmentA, fragmentB, contactArea = 0, strength = 1.0) {
        this.fragmentA = fragmentA;
        this.fragmentB = fragmentB;
        this.contactArea = contactArea;
        this.strength = strength;  // 0-1, breaks when stress exceeds
        this.stress = 0;           // Current stress level
        this.broken = false;
    }
    
    /** Apply stress to connection */
    applyStress(amount) {
        this.stress += amount;
        if (this.stress >= this.strength) {
            this.broken = true;
        }
        return this.broken;
    }
    
    /** Reset stress (for iterative solvers) */
    resetStress() {
        this.stress = 0;
    }
}

// ============================================================================
// PHYSICS FRAGMENT
// ============================================================================

/**
 * A mesh fragment with physics properties
 */
export class PhysicsFragment {
    constructor(meshFragment, material = 'stone') {
        this.mesh = meshFragment;
        this.material = material;
        
        // Physics properties
        this.mass = 0;
        this.centerOfMass = [0, 0, 0];
        this.inertia = [1, 1, 1];  // Diagonal of inertia tensor
        
        // State
        this.position = [...meshFragment.centroid];
        this.rotation = [0, 0, 0, 1];  // Quaternion
        this.velocity = [0, 0, 0];
        this.angularVelocity = [0, 0, 0];
        
        // Connections
        this.connections = [];
        this.anchored = false;  // Connected to world (immovable)
        
        // PhysX actor reference
        this.physxActor = null;
        this.physxShape = null;
        
        // GPU render buffers
        this.vertexBuffer = null;
        this.indexBuffer = null;
        
        // Lifecycle
        this.age = 0;
        this.sleeping = false;
        this.markedForRemoval = false;
        
        this._computePhysicsProperties();
    }
    
    /** Compute mass and inertia from mesh */
    _computePhysicsProperties() {
        if (!this.mesh.bounds) this.mesh.computeBounds();
        if (!this.mesh.centroid) this.mesh.computeCentroid();
        
        const bounds = this.mesh.bounds;
        const size = [
            bounds.max[0] - bounds.min[0],
            bounds.max[1] - bounds.min[1],
            bounds.max[2] - bounds.min[2],
        ];
        
        // Approximate volume
        const volume = size[0] * size[1] * size[2];
        
        // Mass from density
        const density = MATERIAL_DENSITY[this.material] || MATERIAL_DENSITY.default;
        this.mass = volume * density;
        
        // Center of mass (use mesh centroid)
        this.centerOfMass = [...this.mesh.centroid];
        
        // Approximate inertia tensor (treat as box)
        const m = this.mass;
        this.inertia = [
            (m / 12) * (size[1] ** 2 + size[2] ** 2),
            (m / 12) * (size[0] ** 2 + size[2] ** 2),
            (m / 12) * (size[0] ** 2 + size[1] ** 2),
        ];
    }
    
    /** Check if fragment is too small (should become particles) */
    isTooSmall() {
        if (!this.mesh.bounds) return true;
        const bounds = this.mesh.bounds;
        const maxSize = Math.max(
            bounds.max[0] - bounds.min[0],
            bounds.max[1] - bounds.min[1],
            bounds.max[2] - bounds.min[2]
        );
        return maxSize < MIN_FRAGMENT_SIZE;
    }
    
    /** Get convex hull points for PhysX */
    getConvexHull() {
        if (!this.mesh.convexHull) {
            this.mesh.computeConvexHull();
        }
        return this.mesh.convexHull;
    }
    
    /** Apply impulse at point */
    applyImpulse(impulse, point) {
        // Linear impulse
        const invMass = 1 / this.mass;
        this.velocity[0] += impulse[0] * invMass;
        this.velocity[1] += impulse[1] * invMass;
        this.velocity[2] += impulse[2] * invMass;
        
        // Angular impulse (torque = r × F)
        const r = [
            point[0] - this.centerOfMass[0],
            point[1] - this.centerOfMass[1],
            point[2] - this.centerOfMass[2],
        ];
        const torque = [
            r[1] * impulse[2] - r[2] * impulse[1],
            r[2] * impulse[0] - r[0] * impulse[2],
            r[0] * impulse[1] - r[1] * impulse[0],
        ];
        
        this.angularVelocity[0] += torque[0] / this.inertia[0];
        this.angularVelocity[1] += torque[1] / this.inertia[1];
        this.angularVelocity[2] += torque[2] / this.inertia[2];
    }
    
    /** Check if fragment is at rest */
    isAtRest(threshold = 0.01) {
        const linearSpeed = Math.sqrt(
            this.velocity[0] ** 2 +
            this.velocity[1] ** 2 +
            this.velocity[2] ** 2
        );
        const angularSpeed = Math.sqrt(
            this.angularVelocity[0] ** 2 +
            this.angularVelocity[1] ** 2 +
            this.angularVelocity[2] ** 2
        );
        return linearSpeed < threshold && angularSpeed < threshold;
    }
}

// ============================================================================
// FRAGMENT MANAGER
// ============================================================================

/**
 * Manages all physics fragments in the world
 */
export class FragmentManager {
    constructor() {
        this.fragments = [];
        this.connections = [];
        this.device = null;
        this.physicsWorld = null;

        this.particlesState = null;
        this._particlesStateExplicit = false;
        
        // Tools
        this.voronoi = null;
        this.cutter = new MeshCutter();
        this.structuralSolver = new StructuralIntegritySolver();
        this.connectivity = null;  // HybridConnectivity for GPU-accelerated region detection
        
        // Callbacks
        this.onFragmentCreated = null;
        this.onFragmentDestroyed = null;
        this.onFragmentToParticles = null;
        this.onRegionCollapse = null;  // Called when disconnected region falls
        
        // Config
        this.maxFragments = 256;
        this.gravity = [0, -9.81, 0];
        this.sleepThreshold = 0.1;
        this.sleepDelay = 1.0;  // Seconds before sleeping
        this.useStructuralSolver = true;  // Enable structural integrity

        this.fragmentToParticlesOptions = null;
    }

    setParticlesState(particlesState) {
        this._particlesStateExplicit = true;
        if (particlesState && typeof particlesState === 'object') {
            this.particlesState = particlesState;
        } else {
            this.particlesState = null;
        }
    }

    setFragmentToParticlesOptions(options) {
        if (options && typeof options === 'object') {
            this.fragmentToParticlesOptions = options;
        } else {
            this.fragmentToParticlesOptions = null;
        }
    }
    
    /**
     * Initialize the fragment manager
     * @param {GPUDevice} device 
     * @param {Object} physicsWorld - PhysX world reference
     */
    async init(device, physicsWorld = null) {
        this.device = device;
        this.physicsWorld = physicsWorld;
        
        // Initialize Voronoi fracture system
        this.voronoi = new VoronoiFracture();
        await this.voronoi.init(device);
        
        // Initialize GPU-accelerated connectivity detection
        this.connectivity = new HybridConnectivity(device, 32);
        
        // Setup structural solver callbacks
        this.structuralSolver.onNodeBreak = (node) => {
            if (node.fragment) {
                this._convertToParticles(node.fragment, [0, -1, 0], 5);
                node.fragment.markedForRemoval = true;
            }
        };
        
        this.structuralSolver.onRegionDetach = (region) => {
            // Wake up all fragments in falling region
            for (const node of region.nodes) {
                if (node.fragment) {
                    node.fragment.sleeping = false;
                    node.fragment.velocity[1] = -2;  // Start falling
                }
            }
            if (this.onRegionCollapse) {
                this.onRegionCollapse(region);
            }
        };
        
        console.log('[FragmentManager] Initialized with structural solver');
    }
    
    /**
     * Fracture a mesh at impact point
     * @param {Object} mesh - Source mesh { triangles: Triangle[] }
     * @param {number[]} impactPoint - [x, y, z]
     * @param {number[]} impactDirection - Normalized direction
     * @param {number} impactForce - Force magnitude
     * @param {Object} options - Fracture options
     * @returns {PhysicsFragment[]} Created fragments
     */
    async fractureMesh(mesh, impactPoint, impactDirection, impactForce, options = {}) {
        const {
            pattern = 'SHATTER',
            fragmentCount = 8,
            radius = 2.0,
            material = 'stone',
        } = options;
        
        // Limit fragment count
        const targetCount = Math.min(fragmentCount, MAX_FRAGMENTS);
        
        // Compute Voronoi diagram
        const voronoiResult = await this.voronoi.computeFracture(
            impactPoint,
            radius,
            pattern,
            targetCount
        );
        
        // Cut mesh into exact Voronoi cells using bisecting-plane clipping.
        // This properly splits triangles across cell boundaries, producing correct
        // fragments even from low-poly meshes (e.g. 12-triangle cube).
        const fragmentMap = this.cutter.cutByVoronoiExact(mesh.triangles, voronoiResult.seeds);
        
        // Create physics fragments
        const physicsFragments = [];
        
        for (const [cellId, meshFrag] of fragmentMap) {
            const physFrag = new PhysicsFragment(meshFrag, material);
            
            // Skip tiny fragments
            if (physFrag.isTooSmall()) {
                this._convertToParticles(physFrag, impactDirection, impactForce);
                continue;
            }
            
            // Apply initial velocity based on impact
            const dirFromImpact = [
                physFrag.centerOfMass[0] - impactPoint[0],
                physFrag.centerOfMass[1] - impactPoint[1],
                physFrag.centerOfMass[2] - impactPoint[2],
            ];
            const dist = Math.sqrt(
                dirFromImpact[0] ** 2 +
                dirFromImpact[1] ** 2 +
                dirFromImpact[2] ** 2
            ) || 1;
            
            // Velocity falloff with distance
            const velocityScale = impactForce / physFrag.mass * Math.exp(-dist / radius);
            physFrag.velocity = [
                dirFromImpact[0] / dist * velocityScale + impactDirection[0] * velocityScale * 0.5,
                dirFromImpact[1] / dist * velocityScale + impactDirection[1] * velocityScale * 0.5 + 2,
                dirFromImpact[2] / dist * velocityScale + impactDirection[2] * velocityScale * 0.5,
            ];
            
            // Deterministic angular velocity based on fragment position (multiplayer sync)
            const angHash = legacyPrimeCoordinateXorHash3D(
                Math.floor(physFrag.position[0]),
                Math.floor(physFrag.position[1]),
                Math.floor(physFrag.position[2])
            );
            const ar1 = (angHash % 1000) / 1000;
            const ar2 = ((angHash * 31) % 1000) / 1000;
            const ar3 = ((angHash * 37) % 1000) / 1000;
            physFrag.angularVelocity = [
                (ar1 - 0.5) * 5,
                (ar2 - 0.5) * 5,
                (ar3 - 0.5) * 5,
            ];
            
            // Create GPU buffers
            if (this.device) {
                this._createFragmentBuffers(physFrag);
            }
            
            // Add to PhysX if available
            if (this.physicsWorld) {
                this._addToPhysX(physFrag);
            }
            
            physicsFragments.push(physFrag);
            this.fragments.push(physFrag);
            
            if (this.onFragmentCreated) {
                this.onFragmentCreated(physFrag);
            }
        }
        
        // Build connection graph
        this._buildConnectionGraph(physicsFragments);
        
        return physicsFragments;
    }
    
    /**
     * Update all fragments
     * @param {number} dt - Delta time
     */
    update(dt) {
        // Run structural integrity solver first
        if (this.useStructuralSolver && this.structuralSolver.stats.nodeCount > 0) {
            this.structuralSolver.update(dt);
        }
        
        const toRemove = [];
        
        for (const frag of this.fragments) {
            if (frag.markedForRemoval) {
                toRemove.push(frag);
                continue;
            }
            
            frag.age += dt;
            
            // Skip if sleeping
            if (frag.sleeping) continue;
            
            // Skip if PhysX is handling physics
            if (frag.physxActor) {
                this._syncFromPhysX(frag);
                continue;
            }
            
            // Simple physics integration (used when PhysX unavailable)
            // Apply gravity
            frag.velocity[0] += this.gravity[0] * dt;
            frag.velocity[1] += this.gravity[1] * dt;
            frag.velocity[2] += this.gravity[2] * dt;
            
            // Update position
            frag.position[0] += frag.velocity[0] * dt;
            frag.position[1] += frag.velocity[1] * dt;
            frag.position[2] += frag.velocity[2] * dt;
            
            // Simple ground collision
            if (frag.position[1] < 0) {
                frag.position[1] = 0;
                frag.velocity[1] = -frag.velocity[1] * 0.3;  // Bounce
                frag.velocity[0] *= 0.8;  // Friction
                frag.velocity[2] *= 0.8;
            }
            
            // Check for sleep
            if (frag.isAtRest(this.sleepThreshold) && frag.age > this.sleepDelay) {
                frag.sleeping = true;
            }
            
            // Remove if fallen too far
            if (frag.position[1] < -100) {
                frag.markedForRemoval = true;
            }
        }
        
        // Remove marked fragments
        for (const frag of toRemove) {
            this._removeFragment(frag);
        }
    }
    
    /**
     * Apply damage to structural connections
     * @param {number[]} point - Damage point
     * @param {number} radius - Damage radius
     * @param {number} amount - Damage amount
     */
    applyDamage(point, radius, amount) {
        for (const conn of this.connections) {
            if (conn.broken) continue;
            
            // Check if connection is within damage radius
            const midpoint = [
                (conn.fragmentA.centerOfMass[0] + conn.fragmentB.centerOfMass[0]) / 2,
                (conn.fragmentA.centerOfMass[1] + conn.fragmentB.centerOfMass[1]) / 2,
                (conn.fragmentA.centerOfMass[2] + conn.fragmentB.centerOfMass[2]) / 2,
            ];
            
            const dx = midpoint[0] - point[0];
            const dy = midpoint[1] - point[1];
            const dz = midpoint[2] - point[2];
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            
            if (dist < radius) {
                const falloff = 1 - dist / radius;
                conn.applyStress(amount * falloff);
                
                if (conn.broken) {
                    // Wake up connected fragments
                    conn.fragmentA.sleeping = false;
                    conn.fragmentB.sleeping = false;
                }
            }
        }
    }
    
    /** Create cell lookup function from seeds */
    _createCellLookup(seeds, center, radius) {
        return (point) => {
            let nearest = 0;
            let nearestDistSq = Infinity;
            
            for (const seed of seeds) {
                const dx = point[0] - seed.x;
                const dy = point[1] - seed.y;
                const dz = point[2] - seed.z;
                const distSq = dx * dx + dy * dy + dz * dz;
                
                if (distSq < nearestDistSq) {
                    nearestDistSq = distSq;
                    nearest = seed.id;
                }
            }
            
            return nearest;
        };
    }
    
    /** Convert small fragment to particles */
    _convertToParticles(fragment, direction, force) {
        const opts = this.fragmentToParticlesOptions || null;
        const useGpuParticleEngine = !!(opts && opts.useGpuParticleEngine);

        if (useGpuParticleEngine && !this._particlesStateExplicit && !this.particlesState) {
            const autoState = getActiveParticlesState();
            if (autoState && typeof autoState === 'object') {
                this.particlesState = autoState;
            }
        }

        const hasGpuTarget = !!(useGpuParticleEngine && this.particlesState && this.particlesState.world);
        if (!this.onFragmentToParticles && !hasGpuTarget) {
            return;
        }

        const particles = [];
        const triCount = fragment && fragment.mesh && fragment.mesh.triangles ? fragment.mesh.triangles.length : 0;
        const count = Math.max(1, Math.floor(triCount / 2));

        const mode = opts && typeof opts.mode === 'string' ? opts.mode : 'center';
        const decimateFirst = !!(opts && opts.decimateFirst);
        const generateDecimatedMeshLODs = !!(opts && opts.generateDecimatedMeshLODs);

            let sampleMesh = null;
            let meshLODs = null;
            let surfaceSampler = null;

            if (mode === 'surface' || decimateFirst || generateDecimatedMeshLODs || useGpuParticleEngine) {
                const baseMesh = meshFragmentToIndexedMesh(fragment.mesh, opts);
                sampleMesh = baseMesh;

                if (decimateFirst) {
                    const targetRatio = Number.isFinite(opts && opts.targetRatio) ? opts.targetRatio : 0.1;
                    const maxIterations = Number.isFinite(opts && opts.maxIterations) ? opts.maxIterations : Infinity;
                    const preventUVSeamCollapse = opts && opts.preventUVSeamCollapse !== undefined ? !!opts.preventUVSeamCollapse : true;
                    const uvSeamThreshold = Number.isFinite(opts && opts.uvSeamThreshold) ? opts.uvSeamThreshold : 1e-5;

                    const decimated = decimateQEM(baseMesh.positions, baseMesh.indices, targetRatio, maxIterations, {
                        uvs: baseMesh.uvs,
                        preventUVSeamCollapse,
                        uvSeamThreshold,
                        boneWeightPenalty: 0,
                    });

                    sampleMesh = {
                        positions: decimated.vertices instanceof Float32Array ? decimated.vertices : new Float32Array(decimated.vertices),
                        indices: decimated.indices instanceof Uint32Array ? decimated.indices : new Uint32Array(decimated.indices),
                        uvs: decimated.uvs || null,
                    };
                }

                if (sampleMesh && sampleMesh.positions && sampleMesh.indices) {
                    surfaceSampler = createMeshSurfaceSampler(sampleMesh.positions, sampleMesh.indices);
                }

                if (generateDecimatedMeshLODs) {
                    const ratios = Array.isArray(opts && opts.lodRatios) ? opts.lodRatios : [1.0, 0.5, 0.25, 0.1];
                    const maxIterations = Number.isFinite(opts && opts.maxIterations) ? opts.maxIterations : Infinity;
                    const preventUVSeamCollapse = opts && opts.preventUVSeamCollapse !== undefined ? !!opts.preventUVSeamCollapse : true;
                    const uvSeamThreshold = Number.isFinite(opts && opts.uvSeamThreshold) ? opts.uvSeamThreshold : 1e-5;

                    meshLODs = [];
                    for (let ri = 0; ri < ratios.length; ri++) {
                        const r = ratios[ri];
                        if (ri === 0 || r >= 0.999) {
                            meshLODs.push({
                                positions: baseMesh.positions,
                                indices: baseMesh.indices,
                                uvs: baseMesh.uvs,
                                ratio: 1.0,
                            });
                            continue;
                        }
                        const dec = decimateQEM(baseMesh.positions, baseMesh.indices, r, maxIterations, {
                            uvs: baseMesh.uvs,
                            preventUVSeamCollapse,
                            uvSeamThreshold,
                            boneWeightPenalty: 0,
                        });
                        meshLODs.push({
                            positions: dec.vertices instanceof Float32Array ? dec.vertices : new Float32Array(dec.vertices),
                            indices: dec.indices instanceof Uint32Array ? dec.indices : new Uint32Array(dec.indices),
                            uvs: dec.uvs || null,
                            ratio: r,
                        });
                    }
                }
            }

            if (
                useGpuParticleEngine &&
                this.particlesState &&
                this.particlesState.world &&
                sampleMesh &&
                sampleMesh.positions &&
                sampleMesh.indices
            ) {
                try {
                    const positions = sampleMesh.positions;
                    const indices = sampleMesh.indices;

                    let totalArea = 0;
                    for (let ti = 0; ti + 2 < indices.length; ti += 3) {
                        const i0 = indices[ti + 0] | 0;
                        const i1 = indices[ti + 1] | 0;
                        const i2 = indices[ti + 2] | 0;

                        const ax = positions[i0 * 3 + 0];
                        const ay = positions[i0 * 3 + 1];
                        const az = positions[i0 * 3 + 2];
                        const bx = positions[i1 * 3 + 0];
                        const by = positions[i1 * 3 + 1];
                        const bz = positions[i1 * 3 + 2];
                        const cx = positions[i2 * 3 + 0];
                        const cy = positions[i2 * 3 + 1];
                        const cz = positions[i2 * 3 + 2];

                        const abx = bx - ax;
                        const aby = by - ay;
                        const abz = bz - az;
                        const acx = cx - ax;
                        const acy = cy - ay;
                        const acz = cz - az;
                        const cxp = aby * acz - abz * acy;
                        const cyp = abz * acx - abx * acz;
                        const czp = abx * acy - aby * acx;
                        totalArea += 0.5 * Math.sqrt(cxp * cxp + cyp * cyp + czp * czp);
                    }

                    const targetCount = Number.isFinite(opts && opts.targetCount) ? (opts.targetCount | 0) : count;
                    const density = Number.isFinite(opts && opts.density)
                        ? Number(opts.density)
                        : (totalArea > 1e-12 ? targetCount / totalArea : 0);

                    const meshForGpu = {
                        label: 'FragmentToParticles',
                        vertexData: positions,
                        vertexStride: 12,
                        attributes: [
                            {
                                name: 'position',
                                location: 0,
                                offset: 0,
                                format: 'float32x3',
                            },
                        ],
                        indexData: indices,
                    };

                    const meshBuffers = createMeshParticleBuffers(this.particlesState.world.device, meshForGpu);

                    const baseVel = [
                        direction[0] * force * 0.1,
                        direction[1] * force * 0.1,
                        direction[2] * force * 0.1,
                    ];

                    const seed = Number.isFinite(opts && opts.seed)
                        ? (opts.seed >>> 0)
                        : legacyPrimeCoordinateXorHash3D(
                            Math.floor(fragment.centerOfMass[0] * 100),
                            Math.floor(fragment.centerOfMass[1] * 100),
                            Math.floor(fragment.centerOfMass[2] * 100)
                        );

                    const renderMode = Number.isFinite(opts && opts.renderMode) ? (opts.renderMode | 0) : 2;
                    const shape = Number.isFinite(opts && opts.shape) ? (opts.shape | 0) : 0;
                    const behavior = Number.isFinite(opts && opts.behavior) ? (opts.behavior | 0) : 0;

                    const lifetime = Number.isFinite(opts && opts.lifetime) ? Number(opts.lifetime) : 7.5;
                    const velJitter = Number.isFinite(opts && opts.velJitter) ? Number(opts.velJitter) : 2.0;
                    const size = Number.isFinite(opts && opts.size) ? Number(opts.size) : 4.0;

                    generateMeshParticlesIntoParticlesState(this.particlesState, meshBuffers, {
                        density,
                        minPerTri: 0,
                        maxPerTri: Number.isFinite(opts && opts.maxPerTri) ? (opts.maxPerTri | 0) : 4,
                        size,
                        lifetime,
                        velJitter,
                        baseVel,
                        seed,
                        renderMode,
                        shape,
                        behavior,
                        updateSlotInfo: true,
                        currentTime: performance.now() * 0.001,
                    }).finally(() => {
                        const dev = this.particlesState && this.particlesState.world && this.particlesState.world.device;
                        if (dev && dev.queue && typeof dev.queue.onSubmittedWorkDone === 'function') {
                            dev.queue.onSubmittedWorkDone().then(() => {
                                if (meshBuffers.vertexBuffer && typeof meshBuffers.vertexBuffer.destroy === 'function') {
                                    meshBuffers.vertexBuffer.destroy();
                                }
                                if (meshBuffers.indexBuffer && typeof meshBuffers.indexBuffer.destroy === 'function') {
                                    meshBuffers.indexBuffer.destroy();
                                }
                            }).catch(() => {});
                        }
                    });

                    if (this.onFragmentToParticles) {
                        const meta = (sampleMesh || meshLODs) ? { sampleMesh, meshLODs } : null;
                        if (meta) {
                            this.onFragmentToParticles(particles, meta);
                        } else {
                            this.onFragmentToParticles(particles);
                        }
                    }

                    return;
                } catch (err) {
                }
            }
            
            for (let i = 0; i < count; i++) {
                // Deterministic random based on fragment position + index (multiplayer sync)
                const pHash = (legacyPrimeCoordinateXorHash3D(
                    Math.floor(fragment.centerOfMass[0] * 100),
                    Math.floor(fragment.centerOfMass[1] * 100),
                    Math.floor(fragment.centerOfMass[2] * 100)
                ) ^ (i * 12345)) >>> 0;

                const rng = makeLCGRng(pHash);
                const pr1 = rng();
                const pr2 = rng();
                const pr3 = rng();
                const pr4 = rng();
                const pr5 = rng();
                const pr6 = rng();
                const pr7 = rng();

                let px = fragment.centerOfMass[0] + (pr1 - 0.5) * 0.2;
                let py = fragment.centerOfMass[1] + (pr2 - 0.5) * 0.2;
                let pz = fragment.centerOfMass[2] + (pr3 - 0.5) * 0.2;

                if (surfaceSampler) {
                    const p = surfaceSampler.sample(rng);
                    if (p) {
                        px = p[0] + (rng() - 0.5) * 0.02;
                        py = p[1] + (rng() - 0.5) * 0.02;
                        pz = p[2] + (rng() - 0.5) * 0.02;
                    }
                }
                
                particles.push({
                    x: px,
                    y: py,
                    z: pz,
                    vx: direction[0] * force * 0.1 + (pr4 - 0.5) * 2,
                    vy: direction[1] * force * 0.1 + pr5 * 3,
                    vz: direction[2] * force * 0.1 + (pr6 - 0.5) * 2,
                    material: fragment.material,
                    mass: fragment.mass / count,
                    life: 5 + pr7 * 5,
                });
            }

        if (this.onFragmentToParticles) {
            const meta = (sampleMesh || meshLODs) ? { sampleMesh, meshLODs } : null;
            if (meta) {
                this.onFragmentToParticles(particles, meta);
            } else {
                this.onFragmentToParticles(particles);
            }
        }
    }
    
    /** Create GPU buffers for fragment rendering */
    _createFragmentBuffers(fragment) {
        const arrays = fragment.mesh.toArrays();
        
        fragment.vertexBuffer = this.device.createBuffer({
            label: `Fragment ${fragment.mesh.cellId} Vertices`,
            size: arrays.vertices.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(fragment.vertexBuffer, 0, arrays.vertices);
        
        fragment.indexBuffer = this.device.createBuffer({
            label: `Fragment ${fragment.mesh.cellId} Indices`,
            size: arrays.indices.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(fragment.indexBuffer, 0, arrays.indices);
        
        fragment.indexCount = arrays.indexCount;
    }
    
    /** Add fragment to PhysX world */
    _addToPhysX(fragment) {
        // This would create PhysX rigid body using convex hull
        // Implementation depends on PhysX wrapper API
        // fragment.physxActor = this.physicsWorld.createDynamicActor(...)
    }
    
    /** Sync fragment state from PhysX */
    _syncFromPhysX(fragment) {
        // This would read position/rotation from PhysX actor
        // Implementation depends on PhysX wrapper API
    }
    
    /** Build connection graph between fragments */
    _buildConnectionGraph(fragments) {
        // Also build structural solver graph if enabled
        if (this.useStructuralSolver) {
            this.structuralSolver.buildFromFragments(fragments, 2.0);
        }
        
        // Check each pair for proximity
        for (let i = 0; i < fragments.length; i++) {
            for (let j = i + 1; j < fragments.length; j++) {
                const a = fragments[i];
                const b = fragments[j];
                
                // Check if bounds overlap
                if (!this._boundsOverlap(a.mesh.bounds, b.mesh.bounds, 0.1)) {
                    continue;
                }
                
                // Create connection
                const contactArea = this._estimateContactArea(a, b);
                const connection = new StructuralConnection(a, b, contactArea);
                
                a.connections.push(connection);
                b.connections.push(connection);
                this.connections.push(connection);
            }
        }
    }
    
    /** Check if two bounding boxes overlap */
    _boundsOverlap(a, b, tolerance = 0) {
        return !(
            a.max[0] + tolerance < b.min[0] || a.min[0] - tolerance > b.max[0] ||
            a.max[1] + tolerance < b.min[1] || a.min[1] - tolerance > b.max[1] ||
            a.max[2] + tolerance < b.min[2] || a.min[2] - tolerance > b.max[2]
        );
    }
    
    /** Estimate contact area between fragments */
    _estimateContactArea(a, b) {
        // Simplified: use minimum face area of overlap
        const overlapX = Math.max(0,
            Math.min(a.mesh.bounds.max[0], b.mesh.bounds.max[0]) -
            Math.max(a.mesh.bounds.min[0], b.mesh.bounds.min[0])
        );
        const overlapY = Math.max(0,
            Math.min(a.mesh.bounds.max[1], b.mesh.bounds.max[1]) -
            Math.max(a.mesh.bounds.min[1], b.mesh.bounds.min[1])
        );
        const overlapZ = Math.max(0,
            Math.min(a.mesh.bounds.max[2], b.mesh.bounds.max[2]) -
            Math.max(a.mesh.bounds.min[2], b.mesh.bounds.min[2])
        );
        
        return Math.min(overlapX * overlapY, overlapY * overlapZ, overlapX * overlapZ);
    }
    
    /** Remove a fragment */
    _removeFragment(fragment) {
        const idx = this.fragments.indexOf(fragment);
        if (idx >= 0) {
            this.fragments.splice(idx, 1);
        }
        
        // Clean up connections
        for (const conn of fragment.connections) {
            const connIdx = this.connections.indexOf(conn);
            if (connIdx >= 0) {
                this.connections.splice(connIdx, 1);
            }
        }
        
        // Destroy GPU buffers
        fragment.vertexBuffer?.destroy();
        fragment.indexBuffer?.destroy();
        
        // Remove from PhysX
        // fragment.physxActor?.release();
        
        if (this.onFragmentDestroyed) {
            this.onFragmentDestroyed(fragment);
        }
    }
    
    /**
     * Load configuration from engine.cfg section
     * @param {Object} cfg - Config from [fragment_physics] section
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.enabled = cfg.enabled !== false;
        this.maxFragments = parseInt(cfg.max_fragments) || 500;
        this.lifetime = parseFloat(cfg.lifetime) || 10.0;
        this.collisionEnabled = cfg.collision_enabled !== false;
        this.gravity = parseFloat(cfg.gravity) || 1.0;
    }
    
    /** Destroy all resources */
    destroy() {
        for (const frag of this.fragments) {
            frag.vertexBuffer?.destroy();
            frag.indexBuffer?.destroy();
        }
        this.fragments = [];
        this.connections = [];
        this.voronoi?.destroy();
    }
}

export default FragmentManager;

function makeLCGRng(seed) {
    let state = seed >>> 0;
    return () => {
        state = legacyLcgAdvanceState32(state);
        return legacyLcgStateToFloat01(state);
    };
}

export function meshFragmentToIndexedMesh(meshFragment, options = null) {
    const includeCaps = options && options.includeCaps !== undefined ? !!options.includeCaps : true;
    const weldVertices = options && options.weldVertices !== undefined ? !!options.weldVertices : true;
    const eps = Number.isFinite(options && options.weldEpsilon) ? options.weldEpsilon : 1e-5;

    const tris = [];
    if (meshFragment && meshFragment.triangles) {
        for (const t of meshFragment.triangles) tris.push(t);
    }
    if (includeCaps && meshFragment && meshFragment.capTriangles) {
        for (const t of meshFragment.capTriangles) tris.push(t);
    }

    if (!weldVertices) {
        const positions = new Float32Array(tris.length * 3 * 3);
        const uvs = new Float32Array(tris.length * 3 * 2);
        const indices = new Uint32Array(tris.length * 3);
        let v = 0;
        let ui = 0;
        for (let ti = 0; ti < tris.length; ti++) {
            const tri = tris[ti];
            for (let k = 0; k < 3; k++) {
                const vert = tri.vertices[k];
                positions[v * 3 + 0] = vert.position[0];
                positions[v * 3 + 1] = vert.position[1];
                positions[v * 3 + 2] = vert.position[2];
                uvs[ui + 0] = vert.uv[0];
                uvs[ui + 1] = vert.uv[1];
                indices[ti * 3 + k] = v;
                v++;
                ui += 2;
            }
        }
        return { positions, indices, uvs };
    }

    const keyToIndex = new Map();
    const positionsOut = [];
    const uvsOut = [];
    const indicesOut = [];

    const q = (x) => Math.round(x / eps);

    for (const tri of tris) {
        for (let k = 0; k < 3; k++) {
            const v = tri.vertices[k];
            const px = v.position[0];
            const py = v.position[1];
            const pz = v.position[2];
            const u = v.uv ? v.uv[0] : 0;
            const vv = v.uv ? v.uv[1] : 0;

            const key = `${q(px)},${q(py)},${q(pz)},${q(u)},${q(vv)}`;
            let idx = keyToIndex.get(key);
            if (idx === undefined) {
                idx = positionsOut.length / 3;
                keyToIndex.set(key, idx);
                positionsOut.push(px, py, pz);
                uvsOut.push(u, vv);
            }
            indicesOut.push(idx);
        }
    }

    return {
        positions: new Float32Array(positionsOut),
        indices: new Uint32Array(indicesOut),
        uvs: new Float32Array(uvsOut),
    };
}

function samplePointOnIndexedMesh(positions, indices, rng) {
    if (!positions || !indices || indices.length < 3) return null;
    const triCount = Math.floor(indices.length / 3);
    if (triCount <= 0) return null;

    const areas = new Float64Array(triCount);
    let totalArea = 0;

    for (let t = 0; t < triCount; t++) {
        const i0 = indices[t * 3 + 0] | 0;
        const i1 = indices[t * 3 + 1] | 0;
        const i2 = indices[t * 3 + 2] | 0;

        const a = [positions[i0 * 3 + 0], positions[i0 * 3 + 1], positions[i0 * 3 + 2]];
        const b = [positions[i1 * 3 + 0], positions[i1 * 3 + 1], positions[i1 * 3 + 2]];
        const c = [positions[i2 * 3 + 0], positions[i2 * 3 + 1], positions[i2 * 3 + 2]];

        const area = triangleArea(a, b, c);
        const safeArea = Number.isFinite(area) && area > 0 ? area : 0;
        areas[t] = safeArea;
        totalArea += safeArea;
    }

    if (!(totalArea > 0)) {
        const t = Math.floor(rng() * triCount) | 0;
        const i0 = indices[t * 3 + 0] | 0;
        const i1 = indices[t * 3 + 1] | 0;
        const i2 = indices[t * 3 + 2] | 0;
        const a = [positions[i0 * 3 + 0], positions[i0 * 3 + 1], positions[i0 * 3 + 2]];
        const b = [positions[i1 * 3 + 0], positions[i1 * 3 + 1], positions[i1 * 3 + 2]];
        const c = [positions[i2 * 3 + 0], positions[i2 * 3 + 1], positions[i2 * 3 + 2]];
        return randomInTriangle(a, b, c, rng);
    }

    let r = rng() * totalArea;
    let chosen = 0;
    for (let t = 0; t < triCount; t++) {
        r -= areas[t];
        if (r <= 0) {
            chosen = t;
            break;
        }
    }

    const i0 = indices[chosen * 3 + 0] | 0;
    const i1 = indices[chosen * 3 + 1] | 0;
    const i2 = indices[chosen * 3 + 2] | 0;
    const a = [positions[i0 * 3 + 0], positions[i0 * 3 + 1], positions[i0 * 3 + 2]];
    const b = [positions[i1 * 3 + 0], positions[i1 * 3 + 1], positions[i1 * 3 + 2]];
    const c = [positions[i2 * 3 + 0], positions[i2 * 3 + 1], positions[i2 * 3 + 2]];
    return randomInTriangle(a, b, c, rng);
}

function createMeshSurfaceSampler(positions, indices) {
    if (!positions || !indices || indices.length < 3) {
        return null;
    }

    const triCount = Math.floor(indices.length / 3);
    if (triCount <= 0) {
        return null;
    }

    const cdf = new Float64Array(triCount);
    let totalArea = 0;

    for (let t = 0; t < triCount; t++) {
        const i0 = indices[t * 3 + 0] | 0;
        const i1 = indices[t * 3 + 1] | 0;
        const i2 = indices[t * 3 + 2] | 0;

        const a = [positions[i0 * 3 + 0], positions[i0 * 3 + 1], positions[i0 * 3 + 2]];
        const b = [positions[i1 * 3 + 0], positions[i1 * 3 + 1], positions[i1 * 3 + 2]];
        const c = [positions[i2 * 3 + 0], positions[i2 * 3 + 1], positions[i2 * 3 + 2]];

        const area = triangleArea(a, b, c);
        const safeArea = Number.isFinite(area) && area > 0 ? area : 0;
        totalArea += safeArea;
        cdf[t] = totalArea;
    }

    return {
        sample: (rng) => {
            if (!(totalArea > 0)) {
                return samplePointOnIndexedMesh(positions, indices, rng);
            }

            const r = rng() * totalArea;
            let lo = 0;
            let hi = triCount - 1;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (r <= cdf[mid]) hi = mid;
                else lo = mid + 1;
            }

            const t = lo;
            const i0 = indices[t * 3 + 0] | 0;
            const i1 = indices[t * 3 + 1] | 0;
            const i2 = indices[t * 3 + 2] | 0;
            const a = [positions[i0 * 3 + 0], positions[i0 * 3 + 1], positions[i0 * 3 + 2]];
            const b = [positions[i1 * 3 + 0], positions[i1 * 3 + 1], positions[i1 * 3 + 2]];
            const c = [positions[i2 * 3 + 0], positions[i2 * 3 + 1], positions[i2 * 3 + 2]];
            return randomInTriangle(a, b, c, rng);
        },
    };
}
