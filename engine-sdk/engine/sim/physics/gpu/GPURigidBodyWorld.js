/**
 * GPURigidBodyWorld.js — GPU Compute Rigid Body Physics World
 * 
 * Custom WebGPU compute-based rigid body simulation engine.
 * Runs broadphase, narrowphase, constraint solving, and integration
 * entirely on the GPU via WGSL compute shaders.
 * 
 * Architecture based on:
 * - TGS_Soft solver (Erin Catto, Box2D v3 Solver2D, Feb 2024)
 *   Sub-stepping + warm starting + soft constraints + relaxation
 * - XPBD compliance (Macklin 2016) for stiffness-independent constraints
 * - Small Steps (Macklin 2019) for sub-step contact updating
 * - PhysX 5 GPU rigid bodies: fixed pre-allocated buffers, D6-native joints
 * - Jolt + Box2D v3: simulation islands via union-find, per-island sleep
 * - Delta-position formulation (Catto) to avoid FP cancellation far from origin
 * - Graph-colored parallel Gauss-Seidel (Fratarcangeli et al.)
 * - GPU Gems 3 Ch.29: spatial hash broadphase, 27-neighbor cell queries
 * 
 * SoA buffer layout for cache-coherent GPU access.
 * All WGSL shaders embedded as template literals (matches codebase pattern).
 */

// ============================================================================
// CONSTANTS
// ============================================================================

export const MAX_BODIES    = 4096;
export const MAX_CONTACTS  = 16384;
export const MAX_PAIRS     = 32768;
export const MAX_JOINTS    = 2048;

export const SHAPE_SPHERE  = 0;
export const SHAPE_BOX     = 1;
export const SHAPE_CAPSULE = 2;
export const SHAPE_CONVEX  = 3;

export const SIM_DYNAMIC   = 0;
export const SIM_KINEMATIC = 1;
export const SIM_STATIC    = 2;

export const DEFAULT_SUBSTEPS       = 4;
export const DEFAULT_ITERATIONS     = 1;
export const DEFAULT_MAX_SUBSTEPS   = 8;
export const DEFAULT_SLEEP_FRAMES   = 60;
export const DEFAULT_SLEEP_THRESHOLD = 0.05; // m/s combined linear+angular
export const DEFAULT_MAX_DEPENETRATION_VEL = 3.0; // m/s (PhysX best practice)
export const DEFAULT_CONTACT_OFFSET  = 0.02; // m (PhysX default)
export const DEFAULT_REST_OFFSET     = 0.0;

// Body flags bitmask layout (u32):
// bits  0-1:  simMode (0=dynamic, 1=kinematic, 2=static)
// bit   2:    sleeping
// bit   3:    CCD enabled
// bits  8-15: collision layer (8 bits)
// bits 16-23: collision mask (8 bits)
// bit  24:    isTrigger
const FLAG_SIM_MASK     = 0x3;
const FLAG_SLEEPING     = 0x4;
const FLAG_CCD          = 0x8;
const FLAG_LAYER_SHIFT  = 8;
const FLAG_LAYER_MASK   = 0xFF00;
const FLAG_MASK_SHIFT   = 16;
const FLAG_MASK_MASK    = 0xFF0000;
const FLAG_TRIGGER      = 0x1000000;

// Bytes per body across all SoA buffers
// positions: 16, rotations: 16, velocities: 16, angularVels: 16,
// prevPos: 16, prevRot: 16, deltaPos: 16, deltaRot: 16,
// colliders: 64, flags: 4, forces: 16, torques: 16, sleepCounters: 4
// Total: ~232 bytes/body
const BODY_POSITION_STRIDE  = 16; // vec4 (xyz + invMass)
const BODY_ROTATION_STRIDE  = 16; // vec4 (quaternion xyzw)
const BODY_VELOCITY_STRIDE  = 16; // vec4 (linear xyz + pad)
const BODY_ANGVEL_STRIDE    = 16; // vec4 (angular xyz + pad)
const BODY_DELTAPOS_STRIDE  = 16; // vec4 (delta position xyz + pad)
const BODY_DELTAQUAT_STRIDE = 16; // vec4 (delta quaternion xyzw)
const BODY_COLLIDER_STRIDE  = 64; // shape(u32) + halfExtents(3xf32) + localOffset(3xf32) + friction(f32) + restitution(f32) + padding
const BODY_FLAGS_STRIDE     = 4;  // u32
const BODY_FORCE_STRIDE     = 16; // vec4 (xyz + pad)
const BODY_TORQUE_STRIDE    = 16; // vec4 (xyz + pad)
const BODY_SLEEP_STRIDE     = 4;  // u32 (frames below threshold)
const BODY_INERTIA_STRIDE   = 16; // vec4 (diagonal inertia tensor xyz + pad)

// Reusable CPU-side typed arrays for upload (reduce alloc)
const _paramsF32 = new Float32Array(32);
const _paramsU32 = new Uint32Array(_paramsF32.buffer);

// ============================================================================
// WGSL SHADERS
// ============================================================================

const INTEGRATE_SHADER = /* wgsl */`
// Semi-implicit Euler integration with quaternion update
// Uses delta-position formulation (Catto) for FP stability far from origin

struct Body {
    pos: vec3<f32>,     // xyz position
    invMass: f32,       // inverse mass (0 = static/kinematic)
}

struct Quat {
    x: f32, y: f32, z: f32, w: f32,
}

struct Params {
    gravityX: f32,
    gravityY: f32,
    gravityZ: f32,
    dt: f32,
    bodyCount: u32,
    maxVelocity: f32,
    maxAngularVelocity: f32,
    maxDepenetrationVel: f32,
}

@group(0) @binding(0) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> rotations: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> angularVelocities: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> deltaPositions: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read_write> deltaRotations: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read> externalForces: array<vec4<f32>>;
@group(0) @binding(7) var<storage, read> externalTorques: array<vec4<f32>>;
@group(0) @binding(8) var<storage, read> bodyFlags: array<u32>;
@group(0) @binding(9) var<storage, read> inertias: array<vec4<f32>>;
@group(0) @binding(10) var<uniform> params: Params;

fn quatMul(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
    return vec4<f32>(
        a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
        a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    );
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let id = gid.x;
    if (id >= params.bodyCount) { return; }

    let flags = bodyFlags[id];
    let simMode = flags & 3u;

    // Static bodies: zero deltas, skip
    if (simMode == 2u) {
        deltaPositions[id] = vec4<f32>(0.0);
        deltaRotations[id] = vec4<f32>(0.0, 0.0, 0.0, 1.0);
        return;
    }

    // Sleeping bodies: zero deltas, skip
    if ((flags & 4u) != 0u) {
        deltaPositions[id] = vec4<f32>(0.0);
        deltaRotations[id] = vec4<f32>(0.0, 0.0, 0.0, 1.0);
        return;
    }

    let invMass = positions[id].w;
    let invInertia = inertias[id].xyz;
    var vel = velocities[id].xyz;
    var angVel = angularVelocities[id].xyz;
    let q = rotations[id];

    // Kinematic: user-driven, just compute delta from velocity
    if (simMode == 1u) {
        let dp = vel * params.dt;
        deltaPositions[id] = vec4<f32>(dp, 0.0);
        // Quaternion integration: q' = q + 0.5 * w * q * dt
        let wQuat = vec4<f32>(angVel.x, angVel.y, angVel.z, 0.0);
        let dq = quatMul(wQuat, q) * 0.5 * params.dt;
        let newQ = normalize(q + dq);
        deltaRotations[id] = newQ;
        return;
    }

    // Dynamic body: apply gravity + external forces
    let gravity = vec3<f32>(params.gravityX, params.gravityY, params.gravityZ);
    let extForce = externalForces[id].xyz;
    let extTorque = externalTorques[id].xyz;

    // Semi-implicit Euler: update velocity first, then position
    vel += (gravity + extForce * invMass) * params.dt;
    angVel += extTorque * invInertia * params.dt;

    // Clamp velocities (prevent numerical explosion)
    let vLen = length(vel);
    if (vLen > params.maxVelocity) {
        vel = vel * (params.maxVelocity / vLen);
    }
    let avLen = length(angVel);
    if (avLen > params.maxAngularVelocity) {
        angVel = angVel * (params.maxAngularVelocity / avLen);
    }

    // Store updated velocities
    velocities[id] = vec4<f32>(vel, 0.0);
    angularVelocities[id] = vec4<f32>(angVel, 0.0);

    // Compute delta-position (Catto formulation)
    let dp = vel * params.dt;
    deltaPositions[id] = vec4<f32>(dp, 0.0);

    // Quaternion integration: q' = q + 0.5 * [angVel, 0] * q * dt
    let wQuat = vec4<f32>(angVel.x, angVel.y, angVel.z, 0.0);
    let dq = quatMul(wQuat, q) * 0.5 * params.dt;
    let newQ = normalize(q + dq);
    deltaRotations[id] = newQ;
}
`;

const APPLY_DELTAS_SHADER = /* wgsl */`
// Apply delta-positions to absolute positions + rotations
// Run ONCE at end of frame (not per substep) for FP accuracy (Catto)

struct Params {
    bodyCount: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
}

@group(0) @binding(0) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> rotations: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> deltaPositions: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> deltaRotations: array<vec4<f32>>;
@group(0) @binding(4) var<uniform> params: Params;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let id = gid.x;
    if (id >= params.bodyCount) { return; }

    let pos = positions[id];
    let dp = deltaPositions[id];
    positions[id] = vec4<f32>(pos.xyz + dp.xyz, pos.w); // preserve invMass in .w

    rotations[id] = normalize(deltaRotations[id]);
}
`;

const DERIVE_VELOCITY_SHADER = /* wgsl */`
// Derive velocities from position deltas (Catto delta-position formulation)
// v = deltaPos / dt
// ω = 2 * (qNew * qOld^-1).xyz / dt

struct Params {
    invDt: f32,
    bodyCount: u32,
    _pad0: u32,
    _pad1: u32,
}

@group(0) @binding(0) var<storage, read> deltaPositions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> prevRotations: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> curRotations: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> angularVelocities: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read> bodyFlags: array<u32>;
@group(0) @binding(6) var<uniform> params: Params;

fn quatMul(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
    return vec4<f32>(
        a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
        a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    );
}

fn quatConj(q: vec4<f32>) -> vec4<f32> {
    return vec4<f32>(-q.x, -q.y, -q.z, q.w);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let id = gid.x;
    if (id >= params.bodyCount) { return; }

    let flags = bodyFlags[id];
    let simMode = flags & 3u;
    if (simMode != 0u) { return; } // Only dynamic bodies
    if ((flags & 4u) != 0u) { return; } // Skip sleeping

    // Linear velocity from delta position
    let dp = deltaPositions[id].xyz;
    velocities[id] = vec4<f32>(dp * params.invDt, 0.0);

    // Angular velocity: ω = 2 * (qNew * qOld^-1).xyz / dt
    let qOld = prevRotations[id];
    let qNew = curRotations[id];
    let dq = quatMul(qNew, quatConj(qOld));
    // If dq.w < 0, flip to keep in same hemisphere
    var omega = dq.xyz * 2.0 * params.invDt;
    if (dq.w < 0.0) {
        omega = -omega;
    }
    angularVelocities[id] = vec4<f32>(omega, 0.0);
}
`;

const SLEEP_DETECT_SHADER = /* wgsl */`
// Per-body sleep counter update
// Body sleeps when velocity below threshold for N consecutive frames
// Actual island-level sleep decision is CPU-side

struct Params {
    sleepThreshold: f32,
    bodyCount: u32,
    _pad0: u32,
    _pad1: u32,
}

@group(0) @binding(0) var<storage, read> velocities: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> angularVelocities: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> sleepCounters: array<u32>;
@group(0) @binding(3) var<storage, read> bodyFlags: array<u32>;
@group(0) @binding(4) var<uniform> params: Params;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let id = gid.x;
    if (id >= params.bodyCount) { return; }

    let flags = bodyFlags[id];
    let simMode = flags & 3u;
    if (simMode != 0u) { return; } // Only dynamic bodies

    let v = velocities[id].xyz;
    let av = angularVelocities[id].xyz;
    let energy = length(v) + length(av);

    var counter = sleepCounters[id];
    if (energy < params.sleepThreshold) {
        counter = counter + 1u;
    } else {
        counter = 0u;
    }
    sleepCounters[id] = counter;
}
`;

const CLEAR_FORCES_SHADER = /* wgsl */`
// Zero out external forces and torques after they've been consumed

struct Params {
    bodyCount: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
}

@group(0) @binding(0) var<storage, read_write> externalForces: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> externalTorques: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let id = gid.x;
    if (id >= params.bodyCount) { return; }
    externalForces[id] = vec4<f32>(0.0);
    externalTorques[id] = vec4<f32>(0.0);
}
`;

// ============================================================================
// SIMULATION ISLANDS (CPU-side union-find)
// ============================================================================

class IslandManager {
    constructor(maxBodies) {
        this.parent = new Int32Array(maxBodies).fill(-1);
        this.rank = new Uint8Array(maxBodies);
        this.islandBodies = new Map(); // islandRoot → Set<bodyIndex>
        this.sleepingIslands = new Set(); // set of island roots that are asleep
    }

    reset(bodyCount) {
        for (let i = 0; i < bodyCount; i++) {
            this.parent[i] = i;
            this.rank[i] = 0;
        }
        this.islandBodies.clear();
        this.sleepingIslands.clear();
    }

    find(x) {
        // Path compression
        while (this.parent[x] !== x) {
            this.parent[x] = this.parent[this.parent[x]]; // path halving
            x = this.parent[x];
        }
        return x;
    }

    union(a, b) {
        let ra = this.find(a);
        let rb = this.find(b);
        if (ra === rb) return;
        // Union by rank
        if (this.rank[ra] < this.rank[rb]) { const t = ra; ra = rb; rb = t; }
        this.parent[rb] = ra;
        if (this.rank[ra] === this.rank[rb]) this.rank[ra]++;
    }

    buildIslands(bodyCount, staticFlags) {
        this.islandBodies.clear();
        for (let i = 0; i < bodyCount; i++) {
            // Static bodies don't belong to islands
            if ((staticFlags[i] & FLAG_SIM_MASK) === SIM_STATIC) continue;
            const root = this.find(i);
            if (!this.islandBodies.has(root)) {
                this.islandBodies.set(root, []);
            }
            this.islandBodies.get(root).push(i);
        }
    }

    /** Check if all bodies in an island have sleep counters >= threshold */
    checkIslandSleep(islandRoot, sleepCounters, sleepFrames) {
        const bodies = this.islandBodies.get(islandRoot);
        if (!bodies || bodies.length === 0) return true;
        for (const idx of bodies) {
            if (sleepCounters[idx] < sleepFrames) return false;
        }
        return true;
    }

    wakeIsland(islandRoot, flagsArray, sleepCounters) {
        this.sleepingIslands.delete(islandRoot);
        const bodies = this.islandBodies.get(islandRoot);
        if (!bodies) return;
        for (const idx of bodies) {
            flagsArray[idx] &= ~FLAG_SLEEPING;
            sleepCounters[idx] = 0;
        }
    }

    sleepIsland(islandRoot, flagsArray) {
        this.sleepingIslands.add(islandRoot);
        const bodies = this.islandBodies.get(islandRoot);
        if (!bodies) return;
        for (const idx of bodies) {
            flagsArray[idx] |= FLAG_SLEEPING;
        }
    }
}

// ============================================================================
// GPU RIGID BODY WORLD
// ============================================================================

export class GPURigidBodyWorld {
    /**
     * @param {GPUDevice} device - WebGPU device
     * @param {Object} options - World configuration
     */
    constructor(device, options = {}) {
        this.device = device;
        this.ready = false;
        this.destroyed = false;

        // Config
        this.gravity = options.gravity || [0, -9.81, 0];
        this.substeps = options.substeps ?? DEFAULT_SUBSTEPS;
        this.iterations = options.iterations ?? DEFAULT_ITERATIONS;
        this.maxSubSteps = options.maxSubSteps ?? DEFAULT_MAX_SUBSTEPS;
        this.maxBodies = options.maxBodies ?? MAX_BODIES;
        this.maxContacts = options.maxContacts ?? MAX_CONTACTS;
        this.maxPairs = options.maxPairs ?? MAX_PAIRS;
        this.maxJoints = options.maxJoints ?? MAX_JOINTS;
        this.sleepFrames = options.sleepFrames ?? DEFAULT_SLEEP_FRAMES;
        this.sleepThreshold = options.sleepThreshold ?? DEFAULT_SLEEP_THRESHOLD;
        this.maxVelocity = options.maxVelocity ?? 100.0;
        this.maxAngularVelocity = options.maxAngularVelocity ?? 50.0;
        this.maxDepenetrationVel = options.maxDepenetrationVel ?? DEFAULT_MAX_DEPENETRATION_VEL;
        this.contactOffset = options.contactOffset ?? DEFAULT_CONTACT_OFFSET;
        this.restOffset = options.restOffset ?? DEFAULT_REST_OFFSET;
        this.enableIslands = options.enableIslands !== false;
        this.enableSleep = options.enableSleep !== false;

        // Material defaults
        this.defaultMaterial = {
            staticFriction: options.material?.staticFriction ?? 0.5,
            dynamicFriction: options.material?.dynamicFriction ?? 0.5,
            restitution: options.material?.restitution ?? 0.2,
        };

        // Body management
        this.bodyCount = 0;
        this.freeHandles = [];         // recycled handles
        this.bodyDescriptions = [];    // CPU-side body metadata per handle

        // CPU shadow arrays (updated from GPU readback)
        this._cpuPositions = new Float32Array(this.maxBodies * 4);
        this._cpuRotations = new Float32Array(this.maxBodies * 4);
        this._cpuVelocities = new Float32Array(this.maxBodies * 4);
        this._cpuAngularVelocities = new Float32Array(this.maxBodies * 4);
        this._cpuFlags = new Uint32Array(this.maxBodies);
        this._cpuSleepCounters = new Uint32Array(this.maxBodies);
        this._cpuInertias = new Float32Array(this.maxBodies * 4);

        // CPU-side collider data for upload
        this._cpuColliders = new Float32Array(this.maxBodies * (BODY_COLLIDER_STRIDE / 4));
        this._cpuCollidersDirty = false;

        // CPU-side force accumulation
        this._cpuForces = new Float32Array(this.maxBodies * 4);
        this._cpuTorques = new Float32Array(this.maxBodies * 4);
        this._forcesDirty = false;

        // Simulation islands
        this.islands = new IslandManager(this.maxBodies);

        // GPU Buffers (created in init)
        this._buffers = {};

        // Pipelines (created in init)
        this._pipelines = {};
        this._bindGroups = {};

        // Readback staging
        this._readbackBuffer = null;
        this._readbackPending = false;

        // Stats
        this.stats = {
            bodyCount: 0,
            awakeBodyCount: 0,
            islandCount: 0,
            sleepingIslandCount: 0,
            contactCount: 0,
            stepTimeMs: 0,
        };

        // Contact events (filled during step, consumed by user)
        this.contactEvents = [];
        this.triggerEvents = [];
    }

    async init() {
        if (this.destroyed) return;
        this._createBuffers();
        await this._createPipelines();
        this.ready = true;
        console.log(`[GPURigidBodyWorld] Initialized — maxBodies=${this.maxBodies}, substeps=${this.substeps}`);
    }

    // ========================================================================
    // BUFFER CREATION
    // ========================================================================

    _createBuffers() {
        const d = this.device;
        const n = this.maxBodies;
        const b = (label, size, usage) => d.createBuffer({ label, size, usage });
        const SU = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC;
        const SUW = SU | GPUBufferUsage.COPY_DST;

        this._buffers.positions        = b('RB_Positions',      n * BODY_POSITION_STRIDE,  SUW);
        this._buffers.rotations        = b('RB_Rotations',      n * BODY_ROTATION_STRIDE,  SUW);
        this._buffers.velocities       = b('RB_Velocities',     n * BODY_VELOCITY_STRIDE,  SUW);
        this._buffers.angularVelocities= b('RB_AngularVels',    n * BODY_ANGVEL_STRIDE,    SUW);
        this._buffers.deltaPositions   = b('RB_DeltaPos',       n * BODY_DELTAPOS_STRIDE,  SUW);
        this._buffers.deltaRotations   = b('RB_DeltaQuat',      n * BODY_DELTAQUAT_STRIDE, SUW);
        this._buffers.prevRotations    = b('RB_PrevRot',        n * BODY_ROTATION_STRIDE,  SUW);
        this._buffers.colliders        = b('RB_Colliders',      n * BODY_COLLIDER_STRIDE,  SUW);
        this._buffers.bodyFlags        = b('RB_Flags',          n * BODY_FLAGS_STRIDE,     SUW);
        this._buffers.externalForces   = b('RB_ExtForces',      n * BODY_FORCE_STRIDE,     SUW);
        this._buffers.externalTorques  = b('RB_ExtTorques',     n * BODY_TORQUE_STRIDE,    SUW);
        this._buffers.sleepCounters    = b('RB_SleepCounters',  n * BODY_SLEEP_STRIDE,     SUW);
        this._buffers.inertias         = b('RB_Inertias',       n * BODY_INERTIA_STRIDE,   SUW);

        // Params uniform buffers (one per shader that needs params)
        this._buffers.integrateParams  = b('RB_IntParams',   64, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
        this._buffers.applyDeltaParams = b('RB_ApplyParams',  16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
        this._buffers.deriveVelParams  = b('RB_DeriveParams', 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
        this._buffers.sleepParams      = b('RB_SleepParams',  16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
        this._buffers.clearForceParams = b('RB_ClearFParams', 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);

        // Readback staging buffer (positions + rotations + velocities + angularVelocities + flags + sleepCounters)
        const readbackSize = n * (BODY_POSITION_STRIDE + BODY_ROTATION_STRIDE + BODY_VELOCITY_STRIDE + BODY_ANGVEL_STRIDE + BODY_FLAGS_STRIDE + BODY_SLEEP_STRIDE);
        this._readbackBuffer = b('RB_Readback', readbackSize, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
        this._readbackSize = readbackSize;

        // Initialize rotations to identity quaternion (0,0,0,1)
        const identityQuat = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) identityQuat[i * 4 + 3] = 1.0;
        d.queue.writeBuffer(this._buffers.rotations, 0, identityQuat);
        d.queue.writeBuffer(this._buffers.deltaRotations, 0, identityQuat);
        d.queue.writeBuffer(this._buffers.prevRotations, 0, identityQuat);

        // Initialize CPU shadow rotations
        this._cpuRotations.set(identityQuat);
    }

    // ========================================================================
    // PIPELINE CREATION
    // ========================================================================

    async _createPipelines() {
        const d = this.device;
        const mkModule = (label, code) => d.createShaderModule({ label, code });
        const mkPipeline = async (label, module) => d.createComputePipelineAsync({
            label, layout: 'auto', compute: { module, entryPoint: 'main' },
        });

        const integrateModule    = mkModule('RB_Integrate', INTEGRATE_SHADER);
        const applyDeltasModule  = mkModule('RB_ApplyDeltas', APPLY_DELTAS_SHADER);
        const deriveVelModule    = mkModule('RB_DeriveVel', DERIVE_VELOCITY_SHADER);
        const sleepDetectModule  = mkModule('RB_SleepDetect', SLEEP_DETECT_SHADER);
        const clearForcesModule  = mkModule('RB_ClearForces', CLEAR_FORCES_SHADER);

        this._pipelines.integrate    = await mkPipeline('RB_Integrate', integrateModule);
        this._pipelines.applyDeltas  = await mkPipeline('RB_ApplyDeltas', applyDeltasModule);
        this._pipelines.deriveVel    = await mkPipeline('RB_DeriveVel', deriveVelModule);
        this._pipelines.sleepDetect  = await mkPipeline('RB_SleepDetect', sleepDetectModule);
        this._pipelines.clearForces  = await mkPipeline('RB_ClearForces', clearForcesModule);

        // Create bind groups
        this._rebuildBindGroups();
    }

    _rebuildBindGroups() {
        const d = this.device;
        const B = this._buffers;
        const P = this._pipelines;

        this._bindGroups.integrate = d.createBindGroup({
            label: 'RB_Integrate_BG',
            layout: P.integrate.getBindGroupLayout(0),
            entries: [
                { binding: 0,  resource: { buffer: B.positions } },
                { binding: 1,  resource: { buffer: B.rotations } },
                { binding: 2,  resource: { buffer: B.velocities } },
                { binding: 3,  resource: { buffer: B.angularVelocities } },
                { binding: 4,  resource: { buffer: B.deltaPositions } },
                { binding: 5,  resource: { buffer: B.deltaRotations } },
                { binding: 6,  resource: { buffer: B.externalForces } },
                { binding: 7,  resource: { buffer: B.externalTorques } },
                { binding: 8,  resource: { buffer: B.bodyFlags } },
                { binding: 9,  resource: { buffer: B.inertias } },
                { binding: 10, resource: { buffer: B.integrateParams } },
            ],
        });

        this._bindGroups.applyDeltas = d.createBindGroup({
            label: 'RB_ApplyDeltas_BG',
            layout: P.applyDeltas.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: B.positions } },
                { binding: 1, resource: { buffer: B.rotations } },
                { binding: 2, resource: { buffer: B.deltaPositions } },
                { binding: 3, resource: { buffer: B.deltaRotations } },
                { binding: 4, resource: { buffer: B.applyDeltaParams } },
            ],
        });

        this._bindGroups.deriveVel = d.createBindGroup({
            label: 'RB_DeriveVel_BG',
            layout: P.deriveVel.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: B.deltaPositions } },
                { binding: 1, resource: { buffer: B.prevRotations } },
                { binding: 2, resource: { buffer: B.rotations } },
                { binding: 3, resource: { buffer: B.velocities } },
                { binding: 4, resource: { buffer: B.angularVelocities } },
                { binding: 5, resource: { buffer: B.bodyFlags } },
                { binding: 6, resource: { buffer: B.deriveVelParams } },
            ],
        });

        this._bindGroups.sleepDetect = d.createBindGroup({
            label: 'RB_SleepDetect_BG',
            layout: P.sleepDetect.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: B.velocities } },
                { binding: 1, resource: { buffer: B.angularVelocities } },
                { binding: 2, resource: { buffer: B.sleepCounters } },
                { binding: 3, resource: { buffer: B.bodyFlags } },
                { binding: 4, resource: { buffer: B.sleepParams } },
            ],
        });

        this._bindGroups.clearForces = d.createBindGroup({
            label: 'RB_ClearForces_BG',
            layout: P.clearForces.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: B.externalForces } },
                { binding: 1, resource: { buffer: B.externalTorques } },
                { binding: 2, resource: { buffer: B.clearForceParams } },
            ],
        });
    }

    // ========================================================================
    // BODY MANAGEMENT (CPU-side, uploaded to GPU)
    // ========================================================================

    /**
     * Create a rigid body.
     * @param {Object} desc - Body descriptor
     * @returns {number} Handle (index into arrays)
     */
    createBody(desc = {}) {
        if (this.destroyed) return -1;

        let handle;
        if (this.freeHandles.length > 0) {
            handle = this.freeHandles.pop();
        } else {
            handle = this.bodyCount;
            if (handle >= this.maxBodies) {
                console.warn(`[GPURigidBodyWorld] MAX_BODIES (${this.maxBodies}) exceeded — body discarded`);
                return -1;
            }
            this.bodyCount++;
        }

        // Parse descriptor
        const simMode = desc.simMode === 'kinematic' ? SIM_KINEMATIC
            : desc.simMode === 'static' ? SIM_STATIC
            : SIM_DYNAMIC;
        const mass = desc.mass ?? 1.0;
        const invMass = simMode === SIM_DYNAMIC ? (mass > 0 ? 1.0 / mass : 0.0) : 0.0;

        const pos = desc.position || [0, 0, 0];
        const rot = desc.rotation || [0, 0, 0, 1]; // quaternion xyzw
        const layer = desc.collisionLayer ?? 0xFF;
        const mask = desc.collisionMask ?? 0xFF;

        // Build flags
        let flags = simMode;
        flags |= (layer << FLAG_LAYER_SHIFT);
        flags |= (mask << FLAG_MASK_SHIFT);
        if (desc.isTrigger) flags |= FLAG_TRIGGER;
        if (desc.enableCCD) flags |= FLAG_CCD;

        // Collider shape
        const collider = desc.collider || {};
        const shapeStr = collider.shape || desc.colliderShape || 'box';
        let shapeType = SHAPE_BOX;
        if (shapeStr === 'sphere') shapeType = SHAPE_SPHERE;
        else if (shapeStr === 'capsule') shapeType = SHAPE_CAPSULE;
        else if (shapeStr === 'convex' || shapeStr === 'convexMesh') shapeType = SHAPE_CONVEX;

        const he = collider.halfExtents || desc.colliderHalfExtents || [0.5, 0.5, 0.5];
        const radius = collider.radius || desc.colliderRadius || 0.5;
        const halfHeight = collider.halfHeight || desc.colliderHalfHeight || 0.5;
        const localOffset = collider.localOffset || [0, 0, 0];
        const mat = collider.material || desc.material || this.defaultMaterial;
        const friction = mat.dynamicFriction ?? mat.staticFriction ?? 0.5;
        const restitution = mat.restitution ?? 0.2;

        // Compute inertia tensor (diagonal approximation)
        const inertia = this._computeInertia(shapeType, mass, he, radius, halfHeight);

        // Write CPU shadow arrays
        const p4 = handle * 4;
        this._cpuPositions[p4]     = pos[0];
        this._cpuPositions[p4 + 1] = pos[1];
        this._cpuPositions[p4 + 2] = pos[2];
        this._cpuPositions[p4 + 3] = invMass;

        this._cpuRotations[p4]     = rot[0];
        this._cpuRotations[p4 + 1] = rot[1];
        this._cpuRotations[p4 + 2] = rot[2];
        this._cpuRotations[p4 + 3] = rot[3];

        this._cpuVelocities[p4]     = 0;
        this._cpuVelocities[p4 + 1] = 0;
        this._cpuVelocities[p4 + 2] = 0;
        this._cpuVelocities[p4 + 3] = 0;

        this._cpuAngularVelocities[p4]     = 0;
        this._cpuAngularVelocities[p4 + 1] = 0;
        this._cpuAngularVelocities[p4 + 2] = 0;
        this._cpuAngularVelocities[p4 + 3] = 0;

        this._cpuFlags[handle] = flags;
        this._cpuSleepCounters[handle] = 0;

        this._cpuInertias[p4]     = inertia[0];
        this._cpuInertias[p4 + 1] = inertia[1];
        this._cpuInertias[p4 + 2] = inertia[2];
        this._cpuInertias[p4 + 3] = 0;

        // Collider data (16 floats = 64 bytes per body)
        const ci = handle * 16;
        const colliderView = new Uint32Array(this._cpuColliders.buffer);
        colliderView[ci] = shapeType;
        this._cpuColliders[ci + 1] = he[0];
        this._cpuColliders[ci + 2] = he[1];
        this._cpuColliders[ci + 3] = he[2];
        this._cpuColliders[ci + 4] = radius;
        this._cpuColliders[ci + 5] = halfHeight;
        this._cpuColliders[ci + 6] = localOffset[0];
        this._cpuColliders[ci + 7] = localOffset[1];
        this._cpuColliders[ci + 8] = localOffset[2];
        this._cpuColliders[ci + 9] = friction;
        this._cpuColliders[ci + 10] = restitution;
        // ci+11..15 padding

        this._cpuCollidersDirty = true;

        // Store description for CPU queries
        this.bodyDescriptions[handle] = {
            handle,
            simMode: desc.simMode || 'dynamic',
            mass,
            shapeType: shapeStr,
            entityId: desc.entityId,
            active: true,
        };

        // Upload to GPU
        this._uploadBody(handle);

        this.stats.bodyCount = this._countActiveBodies();
        return handle;
    }

    /**
     * Remove a body by handle.
     */
    removeBody(handle) {
        if (handle < 0 || handle >= this.bodyCount) return;
        if (!this.bodyDescriptions[handle]?.active) return;

        this.bodyDescriptions[handle].active = false;
        this.freeHandles.push(handle);

        // Zero out on GPU (make static with zero mass)
        this._cpuFlags[handle] = SIM_STATIC;
        this._cpuPositions[handle * 4 + 3] = 0; // invMass = 0
        this._uploadBody(handle);

        this.stats.bodyCount = this._countActiveBodies();
    }

    /**
     * Get body state from CPU shadow (1-frame lag from GPU readback).
     */
    getBody(handle) {
        if (handle < 0 || handle >= this.bodyCount) return null;
        const desc = this.bodyDescriptions[handle];
        if (!desc?.active) return null;

        const p4 = handle * 4;
        return {
            handle,
            position: [this._cpuPositions[p4], this._cpuPositions[p4 + 1], this._cpuPositions[p4 + 2]],
            rotation: [this._cpuRotations[p4], this._cpuRotations[p4 + 1], this._cpuRotations[p4 + 2], this._cpuRotations[p4 + 3]],
            linearVelocity: [this._cpuVelocities[p4], this._cpuVelocities[p4 + 1], this._cpuVelocities[p4 + 2]],
            angularVelocity: [this._cpuAngularVelocities[p4], this._cpuAngularVelocities[p4 + 1], this._cpuAngularVelocities[p4 + 2]],
            simMode: desc.simMode,
            mass: desc.mass,
            sleeping: (this._cpuFlags[handle] & FLAG_SLEEPING) !== 0,
            entityId: desc.entityId,
        };
    }

    /**
     * Set body to kinematic or dynamic.
     */
    setBodyKinematic(handle, enabled) {
        if (handle < 0 || handle >= this.bodyCount) return;
        const desc = this.bodyDescriptions[handle];
        if (!desc?.active) return;

        const newMode = enabled ? SIM_KINEMATIC : SIM_DYNAMIC;
        this._cpuFlags[handle] = (this._cpuFlags[handle] & ~FLAG_SIM_MASK) | newMode;
        desc.simMode = enabled ? 'kinematic' : 'dynamic';

        // Update invMass
        if (enabled) {
            this._cpuPositions[handle * 4 + 3] = 0;
        } else {
            this._cpuPositions[handle * 4 + 3] = desc.mass > 0 ? 1.0 / desc.mass : 0;
        }

        this._uploadBody(handle);
    }

    /**
     * Apply external force to a body (accumulated until next step).
     */
    applyForce(handle, fx, fy, fz) {
        if (handle < 0 || handle >= this.bodyCount) return;
        const p4 = handle * 4;
        this._cpuForces[p4]     += fx;
        this._cpuForces[p4 + 1] += fy;
        this._cpuForces[p4 + 2] += fz;
        this._forcesDirty = true;

        // Wake island containing this body
        if (this.enableIslands) {
            const root = this.islands.find(handle);
            if (this.islands.sleepingIslands.has(root)) {
                this.islands.wakeIsland(root, this._cpuFlags, this._cpuSleepCounters);
                this._uploadFlags();
            }
        }
    }

    /**
     * Apply external torque to a body (accumulated until next step).
     */
    applyTorque(handle, tx, ty, tz) {
        if (handle < 0 || handle >= this.bodyCount) return;
        const p4 = handle * 4;
        this._cpuTorques[p4]     += tx;
        this._cpuTorques[p4 + 1] += ty;
        this._cpuTorques[p4 + 2] += tz;
        this._forcesDirty = true;
    }

    /**
     * Set body position directly (for kinematic or teleportation).
     */
    setBodyPosition(handle, x, y, z) {
        if (handle < 0 || handle >= this.bodyCount) return;
        const p4 = handle * 4;
        this._cpuPositions[p4] = x;
        this._cpuPositions[p4 + 1] = y;
        this._cpuPositions[p4 + 2] = z;
        this.device.queue.writeBuffer(this._buffers.positions, handle * BODY_POSITION_STRIDE, this._cpuPositions, p4, 4);
    }

    /**
     * Set body rotation directly (quaternion xyzw).
     */
    setBodyRotation(handle, x, y, z, w) {
        if (handle < 0 || handle >= this.bodyCount) return;
        const p4 = handle * 4;
        this._cpuRotations[p4] = x;
        this._cpuRotations[p4 + 1] = y;
        this._cpuRotations[p4 + 2] = z;
        this._cpuRotations[p4 + 3] = w;
        this.device.queue.writeBuffer(this._buffers.rotations, handle * BODY_ROTATION_STRIDE, this._cpuRotations, p4, 4);
    }

    /**
     * Set body linear velocity directly.
     */
    setBodyVelocity(handle, vx, vy, vz) {
        if (handle < 0 || handle >= this.bodyCount) return;
        const p4 = handle * 4;
        this._cpuVelocities[p4] = vx;
        this._cpuVelocities[p4 + 1] = vy;
        this._cpuVelocities[p4 + 2] = vz;
        this.device.queue.writeBuffer(this._buffers.velocities, handle * BODY_VELOCITY_STRIDE, this._cpuVelocities, p4, 4);
    }

    // ========================================================================
    // STEPPING
    // ========================================================================

    /**
     * Step the physics world.
     * Dispatches GPU compute shaders for integration, broadphase, narrowphase,
     * constraint solving, velocity derivation, and sleep detection.
     * 
     * @param {number} dt - Total time step (seconds)
     * @param {Object} [broadphase] - GPUBroadphase instance (optional)
     * @param {Object} [narrowphase] - GPUNarrowphase instance (optional)
     * @param {Object} [solver] - GPUConstraintSolver instance (optional)
     */
    step(dt, broadphase = null, narrowphase = null, solver = null) {
        if (!this.ready || this.destroyed || this.bodyCount === 0) return;

        const t0 = performance.now();

        // Cap dt to avoid "well of despair"
        const maxDt = (1 / 60) * this.maxSubSteps;
        const clampedDt = Math.min(dt, maxDt);
        const subDt = clampedDt / this.substeps;

        // Upload accumulated forces
        if (this._forcesDirty) {
            this.device.queue.writeBuffer(this._buffers.externalForces, 0, this._cpuForces);
            this.device.queue.writeBuffer(this._buffers.externalTorques, 0, this._cpuTorques);
            this._forcesDirty = false;
        }

        // Upload colliders if dirty
        if (this._cpuCollidersDirty) {
            this.device.queue.writeBuffer(this._buffers.colliders, 0, this._cpuColliders);
            this._cpuCollidersDirty = false;
        }

        const encoder = this.device.createCommandEncoder({ label: 'RB_Step' });
        const wgCount = Math.ceil(this.bodyCount / 64);

        // Save previous rotations for velocity derivation
        encoder.copyBufferToBuffer(
            this._buffers.rotations, 0,
            this._buffers.prevRotations, 0,
            this.bodyCount * BODY_ROTATION_STRIDE,
        );

        // == BROADPHASE (once per frame, not per substep) ==
        if (broadphase) {
            broadphase.dispatch(encoder, this.bodyCount, this._buffers);
        }

        // == NARROWPHASE (once per frame, contacts reused across substeps) ==
        if (narrowphase && broadphase) {
            narrowphase.dispatch(encoder, broadphase, this._buffers);
        }

        // == SUBSTEP LOOP ==
        for (let s = 0; s < this.substeps; s++) {
            // 1. Integration (apply gravity + forces, compute delta positions)
            this._writeIntegrateParams(subDt);
            const intPass = encoder.beginComputePass({ label: `RB_Integrate_s${s}` });
            intPass.setPipeline(this._pipelines.integrate);
            intPass.setBindGroup(0, this._bindGroups.integrate);
            intPass.dispatchWorkgroups(wgCount);
            intPass.end();

            // 2. Constraint solving (contacts + joints)
            if (solver && narrowphase) {
                solver.dispatch(encoder, s, subDt, this._buffers, narrowphase);
            }
        }

        // == POST-SUBSTEP: Apply accumulated deltas to absolute positions ==
        this._writeApplyDeltaParams();
        const applyPass = encoder.beginComputePass({ label: 'RB_ApplyDeltas' });
        applyPass.setPipeline(this._pipelines.applyDeltas);
        applyPass.setBindGroup(0, this._bindGroups.applyDeltas);
        applyPass.dispatchWorkgroups(wgCount);
        applyPass.end();

        // == DERIVE VELOCITIES from delta positions ==
        this._writeDeriveVelParams(subDt);
        const derivePass = encoder.beginComputePass({ label: 'RB_DeriveVel' });
        derivePass.setPipeline(this._pipelines.deriveVel);
        derivePass.setBindGroup(0, this._bindGroups.deriveVel);
        derivePass.dispatchWorkgroups(wgCount);
        derivePass.end();

        // == SLEEP DETECTION ==
        if (this.enableSleep) {
            this._writeSleepParams();
            const sleepPass = encoder.beginComputePass({ label: 'RB_SleepDetect' });
            sleepPass.setPipeline(this._pipelines.sleepDetect);
            sleepPass.setBindGroup(0, this._bindGroups.sleepDetect);
            sleepPass.dispatchWorkgroups(wgCount);
            sleepPass.end();
        }

        // == CLEAR FORCES ==
        this._writeClearForceParams();
        const clearPass = encoder.beginComputePass({ label: 'RB_ClearForces' });
        clearPass.setPipeline(this._pipelines.clearForces);
        clearPass.setBindGroup(0, this._bindGroups.clearForces);
        clearPass.dispatchWorkgroups(wgCount);
        clearPass.end();

        // == READBACK (async copy to staging buffer) ==
        this._encodeReadback(encoder);

        // Submit
        this.device.queue.submit([encoder.finish()]);

        // Zero CPU force accumulators
        this._cpuForces.fill(0);
        this._cpuTorques.fill(0);

        this.stats.stepTimeMs = performance.now() - t0;
    }

    // ========================================================================
    // READBACK
    // ========================================================================

    _encodeReadback(encoder) {
        const n = this.bodyCount;
        let offset = 0;

        // positions
        encoder.copyBufferToBuffer(this._buffers.positions, 0, this._readbackBuffer, offset, n * BODY_POSITION_STRIDE);
        offset += n * BODY_POSITION_STRIDE;

        // rotations
        encoder.copyBufferToBuffer(this._buffers.rotations, 0, this._readbackBuffer, offset, n * BODY_ROTATION_STRIDE);
        offset += n * BODY_ROTATION_STRIDE;

        // velocities
        encoder.copyBufferToBuffer(this._buffers.velocities, 0, this._readbackBuffer, offset, n * BODY_VELOCITY_STRIDE);
        offset += n * BODY_VELOCITY_STRIDE;

        // angular velocities
        encoder.copyBufferToBuffer(this._buffers.angularVelocities, 0, this._readbackBuffer, offset, n * BODY_ANGVEL_STRIDE);
        offset += n * BODY_ANGVEL_STRIDE;

        // flags
        encoder.copyBufferToBuffer(this._buffers.bodyFlags, 0, this._readbackBuffer, offset, n * BODY_FLAGS_STRIDE);
        offset += n * BODY_FLAGS_STRIDE;

        // sleep counters
        encoder.copyBufferToBuffer(this._buffers.sleepCounters, 0, this._readbackBuffer, offset, n * BODY_SLEEP_STRIDE);
    }

    /**
     * Async readback GPU → CPU shadow arrays.
     * Call once per frame AFTER step(). Updates getBody() data.
     */
    async readbackAsync() {
        if (this._readbackPending || this.bodyCount === 0 || this.destroyed) return;
        this._readbackPending = true;

        try {
            await this._readbackBuffer.mapAsync(GPUMapMode.READ);
            const mapped = new Float32Array(this._readbackBuffer.getMappedRange().slice(0));
            this._readbackBuffer.unmap();

            const n = this.bodyCount;
            let fOffset = 0;

            // positions (vec4)
            this._cpuPositions.set(mapped.subarray(fOffset, fOffset + n * 4));
            fOffset += n * 4;

            // rotations (vec4)
            this._cpuRotations.set(mapped.subarray(fOffset, fOffset + n * 4));
            fOffset += n * 4;

            // velocities (vec4)
            this._cpuVelocities.set(mapped.subarray(fOffset, fOffset + n * 4));
            fOffset += n * 4;

            // angular velocities (vec4)
            this._cpuAngularVelocities.set(mapped.subarray(fOffset, fOffset + n * 4));
            fOffset += n * 4;

            // flags (u32) — read as uint32 from float32 buffer
            const flagsU32 = new Uint32Array(mapped.buffer, fOffset * 4, n);
            this._cpuFlags.set(flagsU32);
            fOffset += n; // u32 = 1 float-sized slot

            // sleep counters (u32)
            const sleepU32 = new Uint32Array(mapped.buffer, fOffset * 4, n);
            this._cpuSleepCounters.set(sleepU32);

            // Island sleep management (CPU-side)
            if (this.enableIslands && this.enableSleep) {
                this._updateIslandSleep();
            }

            // Update stats
            let awake = 0;
            for (let i = 0; i < n; i++) {
                const desc = this.bodyDescriptions[i];
                if (desc?.active && (this._cpuFlags[i] & FLAG_SIM_MASK) === SIM_DYNAMIC) {
                    if (!(this._cpuFlags[i] & FLAG_SLEEPING)) awake++;
                }
            }
            this.stats.awakeBodyCount = awake;
            this.stats.islandCount = this.islands.islandBodies.size;
            this.stats.sleepingIslandCount = this.islands.sleepingIslands.size;
        } catch (e) {
            console.warn('[GPURigidBodyWorld] Readback failed:', e.message);
        } finally {
            this._readbackPending = false;
        }
    }

    // ========================================================================
    // ISLAND SLEEP (CPU-side, after readback)
    // ========================================================================

    _updateIslandSleep() {
        const n = this.bodyCount;

        // Rebuild islands from contact/joint graph
        this.islands.reset(n);

        // TODO: union bodies connected by contacts and joints
        // For now, each dynamic body is its own island
        // This will be wired when broadphase/narrowphase provide contact pairs

        this.islands.buildIslands(n, this._cpuFlags);

        let flagsDirty = false;
        for (const [root, bodies] of this.islands.islandBodies) {
            if (this.islands.sleepingIslands.has(root)) continue;

            if (this.islands.checkIslandSleep(root, this._cpuSleepCounters, this.sleepFrames)) {
                this.islands.sleepIsland(root, this._cpuFlags);
                flagsDirty = true;
            }
        }

        if (flagsDirty) {
            this._uploadFlags();
        }
    }

    // ========================================================================
    // PARAM WRITING (CPU → GPU uniform buffers)
    // ========================================================================

    _writeIntegrateParams(dt) {
        _paramsF32[0] = this.gravity[0];
        _paramsF32[1] = this.gravity[1];
        _paramsF32[2] = this.gravity[2];
        _paramsF32[3] = dt;
        _paramsU32[4] = this.bodyCount;
        _paramsF32[5] = this.maxVelocity;
        _paramsF32[6] = this.maxAngularVelocity;
        _paramsF32[7] = this.maxDepenetrationVel;
        this.device.queue.writeBuffer(this._buffers.integrateParams, 0, _paramsF32, 0, 8);
    }

    _writeApplyDeltaParams() {
        _paramsU32[0] = this.bodyCount;
        _paramsU32[1] = 0;
        _paramsU32[2] = 0;
        _paramsU32[3] = 0;
        this.device.queue.writeBuffer(this._buffers.applyDeltaParams, 0, _paramsU32, 0, 4);
    }

    _writeDeriveVelParams(subDt) {
        _paramsF32[0] = subDt > 0 ? 1.0 / subDt : 0;
        _paramsU32[1] = this.bodyCount;
        _paramsU32[2] = 0;
        _paramsU32[3] = 0;
        this.device.queue.writeBuffer(this._buffers.deriveVelParams, 0, _paramsF32, 0, 4);
    }

    _writeSleepParams() {
        _paramsF32[0] = this.sleepThreshold;
        _paramsU32[1] = this.bodyCount;
        _paramsU32[2] = 0;
        _paramsU32[3] = 0;
        this.device.queue.writeBuffer(this._buffers.sleepParams, 0, _paramsF32, 0, 4);
    }

    _writeClearForceParams() {
        _paramsU32[0] = this.bodyCount;
        _paramsU32[1] = 0;
        _paramsU32[2] = 0;
        _paramsU32[3] = 0;
        this.device.queue.writeBuffer(this._buffers.clearForceParams, 0, _paramsU32, 0, 4);
    }

    // ========================================================================
    // UPLOAD HELPERS
    // ========================================================================

    _uploadBody(handle) {
        const d = this.device;
        const p4 = handle * 4;

        d.queue.writeBuffer(this._buffers.positions, handle * BODY_POSITION_STRIDE,
            this._cpuPositions, p4, 4);
        d.queue.writeBuffer(this._buffers.rotations, handle * BODY_ROTATION_STRIDE,
            this._cpuRotations, p4, 4);
        d.queue.writeBuffer(this._buffers.velocities, handle * BODY_VELOCITY_STRIDE,
            this._cpuVelocities, p4, 4);
        d.queue.writeBuffer(this._buffers.angularVelocities, handle * BODY_ANGVEL_STRIDE,
            this._cpuAngularVelocities, p4, 4);
        d.queue.writeBuffer(this._buffers.bodyFlags, handle * BODY_FLAGS_STRIDE,
            this._cpuFlags, handle, 1);
        d.queue.writeBuffer(this._buffers.sleepCounters, handle * BODY_SLEEP_STRIDE,
            this._cpuSleepCounters, handle, 1);
        d.queue.writeBuffer(this._buffers.inertias, handle * BODY_INERTIA_STRIDE,
            this._cpuInertias, p4, 4);

        // Also upload delta rotations as initial quaternion
        d.queue.writeBuffer(this._buffers.deltaRotations, handle * BODY_DELTAQUAT_STRIDE,
            this._cpuRotations, p4, 4);
        d.queue.writeBuffer(this._buffers.prevRotations, handle * BODY_ROTATION_STRIDE,
            this._cpuRotations, p4, 4);

        // Collider upload (per-body slice)
        d.queue.writeBuffer(this._buffers.colliders, handle * BODY_COLLIDER_STRIDE,
            this._cpuColliders, handle * 16, 16);
    }

    _uploadFlags() {
        this.device.queue.writeBuffer(this._buffers.bodyFlags, 0, this._cpuFlags, 0, this.bodyCount);
    }

    // ========================================================================
    // INERTIA COMPUTATION
    // ========================================================================

    _computeInertia(shapeType, mass, halfExtents, radius, halfHeight) {
        if (mass <= 0) return [0, 0, 0];
        const m = mass;
        let ix, iy, iz;

        switch (shapeType) {
            case SHAPE_SPHERE: {
                const r2 = radius * radius;
                ix = iy = iz = (2 / 5) * m * r2;
                break;
            }
            case SHAPE_BOX: {
                const sx = halfExtents[0] * 2, sy = halfExtents[1] * 2, sz = halfExtents[2] * 2;
                ix = (1 / 12) * m * (sy * sy + sz * sz);
                iy = (1 / 12) * m * (sx * sx + sz * sz);
                iz = (1 / 12) * m * (sx * sx + sy * sy);
                break;
            }
            case SHAPE_CAPSULE: {
                const r = radius, h = halfHeight * 2;
                // Approximate as cylinder
                ix = iz = (1 / 12) * m * (3 * r * r + h * h);
                iy = (1 / 2) * m * r * r;
                break;
            }
            default: {
                // Fallback: use bounding box
                const sx = halfExtents[0] * 2, sy = halfExtents[1] * 2, sz = halfExtents[2] * 2;
                ix = (1 / 12) * m * (sy * sy + sz * sz);
                iy = (1 / 12) * m * (sx * sx + sz * sz);
                iz = (1 / 12) * m * (sx * sx + sy * sy);
            }
        }

        // Return INVERSE inertia (what the shader uses)
        return [
            ix > 0 ? 1 / ix : 0,
            iy > 0 ? 1 / iy : 0,
            iz > 0 ? 1 / iz : 0,
        ];
    }

    _countActiveBodies() {
        let count = 0;
        for (let i = 0; i < this.bodyCount; i++) {
            if (this.bodyDescriptions[i]?.active) count++;
        }
        return count;
    }

    // ========================================================================
    // CLEANUP
    // ========================================================================

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.ready = false;

        for (const buf of Object.values(this._buffers)) {
            if (buf && typeof buf.destroy === 'function') buf.destroy();
        }
        if (this._readbackBuffer) this._readbackBuffer.destroy();

        this._buffers = {};
        this._pipelines = {};
        this._bindGroups = {};
        this.bodyDescriptions = [];

        console.log('[GPURigidBodyWorld] Destroyed');
    }
}

// ============================================================================
// CONVENIENCE FACTORY FUNCTIONS (PhysX-compatible API shape)
// ============================================================================

/**
 * Create a GPU physics world.
 * @param {GPUDevice} device
 * @param {Object} options
 * @returns {Promise<GPURigidBodyWorld>}
 */
export async function createGPUPhysicsWorld(device, options = {}) {
    const world = new GPURigidBodyWorld(device, options);
    await world.init();
    return world;
}

export function destroyGPUPhysicsWorld(world) {
    if (world) world.destroy();
}

export function gpuCreateBody(world, desc) {
    return world.createBody(desc);
}

export function gpuRemoveBody(world, handle) {
    world.removeBody(handle);
}

export function gpuGetBody(world, handle) {
    return world.getBody(handle);
}

export function gpuSetBodyKinematic(world, handle, enabled) {
    world.setBodyKinematic(handle, enabled);
}

export function gpuApplyForce(world, handle, fx, fy, fz) {
    world.applyForce(handle, fx, fy, fz);
}

export function gpuApplyTorque(world, handle, tx, ty, tz) {
    world.applyTorque(handle, tx, ty, tz);
}

/**
 * Step the GPU physics world.
 * @param {GPURigidBodyWorld} world
 * @param {number} dt - Time step in seconds
 * @param {Object} [broadphase] - GPUBroadphase instance
 * @param {Object} [narrowphase] - GPUNarrowphase instance
 * @param {Object} [solver] - GPUConstraintSolver instance
 */
export function gpuStepWorld(world, dt, broadphase, narrowphase, solver) {
    world.step(dt, broadphase, narrowphase, solver);
}

export async function gpuReadbackAsync(world) {
    await world.readbackAsync();
}
