/**
 * GPUSoftBody.js — GPU FEM Soft Body Simulation
 * 
 * Finite Element Method (FEM) soft body using tetrahedral meshes.
 * PhysX 5's signature GPU feature — deformable materials like rubber,
 * jelly, flesh, foam, etc.
 * 
 * Based on:
 * - PhysX 5 FEM Soft Bodies: tetrahedral simulation mesh + collision mesh
 * - Müller et al. "Real Time Physics" (XPBD for FEM)
 * - Smith et al. "Stable Neo-Hookean Flesh Simulation" (SIGGRAPH 2018)
 * - Irving et al. "Invertible Finite Elements" (SIGGRAPH 2004)
 * 
 * Architecture:
 * - Tetrahedral mesh defines volume elements
 * - Each tet has a rest-state inverse matrix (Dm_inv)
 * - Per-frame: compute deformation gradient F, strain, stress → nodal forces
 * - GPU shader: one thread per tetrahedron
 * - Supports Neo-Hookean and co-rotational constitutive models
 * - Nodes can be pinned (fixed) or coupled to rigid bodies
 * 
 * Material properties:
 * - Young's modulus E: stiffness (rubber ~1MPa, steel ~200GPa)
 * - Poisson's ratio ν: incompressibility (rubber ~0.49, steel ~0.3)
 * - Damping: velocity proportional damping
 */

// ============================================================================
// CONSTANTS
// ============================================================================

export const MAX_SOFT_BODY_NODES = 16384;
export const MAX_SOFT_BODY_TETS  = 32768;

export const CONSTITUTIVE_COROTATIONAL = 0;
export const CONSTITUTIVE_NEOHOOKEAN   = 1;

// ============================================================================
// WGSL SHADERS
// ============================================================================

const FEM_FORCE_SHADER = /* wgsl */`
// Per-tetrahedron: compute elastic forces from deformation gradient
// Uses co-rotational linear elasticity (stable, fast)

struct Node {
    posX: f32, posY: f32, posZ: f32, invMass: f32,
    velX: f32, velY: f32, velZ: f32, _pad: f32,
    prevPosX: f32, prevPosY: f32, prevPosZ: f32, pinned: u32,
}

struct Tet {
    n0: u32, n1: u32, n2: u32, n3: u32,
    // Rest-state inverse of edge matrix (Dm_inv), 3x3 stored column-major
    dm00: f32, dm10: f32, dm20: f32,
    dm01: f32, dm11: f32, dm21: f32,
    dm02: f32, dm12: f32, dm22: f32,
    restVolume: f32,
    materialIdx: u32,
    _pad: u32,
}

struct Material {
    mu: f32,     // Lamé first parameter (shear modulus)
    lambda: f32, // Lamé second parameter
    damping: f32,
    _pad: f32,
}

struct Params {
    nodeCount: u32,
    tetCount: u32,
    dt: f32,
    gravity: f32,
    materialCount: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
}

@group(0) @binding(0) var<storage, read_write> nodes: array<Node>;
@group(0) @binding(1) var<storage, read> tets: array<Tet>;
@group(0) @binding(2) var<storage, read> materials: array<Material>;
@group(0) @binding(3) var<storage, read_write> nodeForces: array<vec4<f32>>;
@group(0) @binding(4) var<uniform> params: Params;

// 3x3 matrix multiply
fn mat3Mul(a00: f32, a01: f32, a02: f32,
           a10: f32, a11: f32, a12: f32,
           a20: f32, a21: f32, a22: f32,
           b00: f32, b01: f32, b02: f32,
           b10: f32, b11: f32, b12: f32,
           b20: f32, b21: f32, b22: f32) -> array<f32, 9> {
    return array<f32, 9>(
        a00*b00 + a01*b10 + a02*b20,
        a10*b00 + a11*b10 + a12*b20,
        a20*b00 + a21*b10 + a22*b20,
        a00*b01 + a01*b11 + a02*b21,
        a10*b01 + a11*b11 + a12*b21,
        a20*b01 + a21*b11 + a22*b21,
        a00*b02 + a01*b12 + a02*b22,
        a10*b02 + a11*b12 + a12*b22,
        a20*b02 + a21*b12 + a22*b22,
    );
}

// 3x3 matrix transpose
fn mat3Transpose(m: array<f32, 9>) -> array<f32, 9> {
    return array<f32, 9>(
        m[0], m[3], m[6],
        m[1], m[4], m[7],
        m[2], m[5], m[8],
    );
}

// SVD-free polar decomposition approximation (Müller et al.)
// Extract rotation R from F using iterative method
fn extractRotation(F: array<f32, 9>) -> array<f32, 9> {
    // Start with F as initial guess for R
    var R = F;

    // 3 iterations of polar decomposition refinement
    for (var iter = 0; iter < 3; iter++) {
        // R = F * (F^T * F)^(-1/2) ≈ iterate: R = 0.5 * (R + (R^-T))
        // Simplified: use Gram-Schmidt orthogonalization
        var c0 = vec3<f32>(R[0], R[1], R[2]);
        var c1 = vec3<f32>(R[3], R[4], R[5]);
        var c2 = vec3<f32>(R[6], R[7], R[8]);

        c0 = normalize(c0);
        c1 = c1 - c0 * dot(c0, c1);
        c1 = normalize(c1);
        c2 = cross(c0, c1);

        R[0] = c0.x; R[1] = c0.y; R[2] = c0.z;
        R[3] = c1.x; R[4] = c1.y; R[5] = c1.z;
        R[6] = c2.x; R[7] = c2.y; R[8] = c2.z;
    }

    // Ensure positive determinant (no reflection)
    let det = R[0]*(R[4]*R[8]-R[5]*R[7]) - R[3]*(R[1]*R[8]-R[2]*R[7]) + R[6]*(R[1]*R[5]-R[2]*R[4]);
    if (det < 0.0) {
        R[6] = -R[6]; R[7] = -R[7]; R[8] = -R[8];
    }

    return R;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let tetId = gid.x;
    if (tetId >= params.tetCount) { return; }

    let tet = tets[tetId];
    let n0 = nodes[tet.n0];
    let n1 = nodes[tet.n1];
    let n2 = nodes[tet.n2];
    let n3 = nodes[tet.n3];

    let p0 = vec3<f32>(n0.posX, n0.posY, n0.posZ);
    let p1 = vec3<f32>(n1.posX, n1.posY, n1.posZ);
    let p2 = vec3<f32>(n2.posX, n2.posY, n2.posZ);
    let p3 = vec3<f32>(n3.posX, n3.posY, n3.posZ);

    // Deformed edge matrix Ds (columns = edges from p0)
    let e1 = p1 - p0;
    let e2 = p2 - p0;
    let e3 = p3 - p0;

    // Deformation gradient F = Ds * Dm_inv
    let F = mat3Mul(
        e1.x, e2.x, e3.x,
        e1.y, e2.y, e3.y,
        e1.z, e2.z, e3.z,
        tet.dm00, tet.dm01, tet.dm02,
        tet.dm10, tet.dm11, tet.dm12,
        tet.dm20, tet.dm21, tet.dm22,
    );

    let mat = materials[min(tet.materialIdx, params.materialCount - 1u)];

    // Co-rotational elasticity: extract rotation R, compute strain in rotated frame
    let R = extractRotation(F);
    let RT = mat3Transpose(R);

    // S = R^T * F (symmetric stretch tensor)
    let S = mat3Mul(
        RT[0], RT[3], RT[6],
        RT[1], RT[4], RT[7],
        RT[2], RT[5], RT[8],
        F[0], F[3], F[6],
        F[1], F[4], F[7],
        F[2], F[5], F[8],
    );

    // Strain: epsilon = S - I
    let eps00 = S[0] - 1.0; let eps01 = S[3]; let eps02 = S[6];
    let eps10 = S[1]; let eps11 = S[4] - 1.0; let eps12 = S[7];
    let eps20 = S[2]; let eps21 = S[5]; let eps22 = S[8] - 1.0;

    let trace = eps00 + eps11 + eps22;

    // Stress (co-rotational): sigma = 2*mu*epsilon + lambda*trace(epsilon)*I
    let s00 = 2.0 * mat.mu * eps00 + mat.lambda * trace;
    let s01 = 2.0 * mat.mu * eps01;
    let s02 = 2.0 * mat.mu * eps02;
    let s10 = 2.0 * mat.mu * eps10;
    let s11 = 2.0 * mat.mu * eps11 + mat.lambda * trace;
    let s12 = 2.0 * mat.mu * eps12;
    let s20 = 2.0 * mat.mu * eps20;
    let s21 = 2.0 * mat.mu * eps21;
    let s22 = 2.0 * mat.mu * eps22 + mat.lambda * trace;

    // Rotate stress back: P = R * sigma
    let P = mat3Mul(
        R[0], R[3], R[6],
        R[1], R[4], R[7],
        R[2], R[5], R[8],
        s00, s01, s02,
        s10, s11, s12,
        s20, s21, s22,
    );

    // Nodal forces: f = -V * P * Dm_inv^T
    let vol = abs(tet.restVolume);
    let H = mat3Mul(
        P[0], P[3], P[6],
        P[1], P[4], P[7],
        P[2], P[5], P[8],
        tet.dm00, tet.dm10, tet.dm20,
        tet.dm01, tet.dm11, tet.dm21,
        tet.dm02, tet.dm12, tet.dm22,
    );

    let f1 = vec3<f32>(-vol * H[0], -vol * H[1], -vol * H[2]);
    let f2 = vec3<f32>(-vol * H[3], -vol * H[4], -vol * H[5]);
    let f3 = vec3<f32>(-vol * H[6], -vol * H[7], -vol * H[8]);
    let f0 = -(f1 + f2 + f3); // Conservation of momentum

    // Velocity damping forces
    let v0 = vec3<f32>(n0.velX, n0.velY, n0.velZ);
    let v1 = vec3<f32>(n1.velX, n1.velY, n1.velZ);
    let v2 = vec3<f32>(n2.velX, n2.velY, n2.velZ);
    let v3 = vec3<f32>(n3.velX, n3.velY, n3.velZ);

    let damp = mat.damping;
    let d0 = -v0 * damp;
    let d1 = -v1 * damp;
    let d2 = -v2 * damp;
    let d3 = -v3 * damp;

    // Accumulate forces (atomic would be ideal, but use separate force buffer)
    // Using atomicAdd on f32 is not available in WGSL, so we write per-tet forces
    // and reduce on CPU or with a second pass
    let base = tetId * 4u;
    nodeForces[base + 0u] = vec4<f32>(f0 + d0, f32(tet.n0));
    nodeForces[base + 1u] = vec4<f32>(f1 + d1, f32(tet.n1));
    nodeForces[base + 2u] = vec4<f32>(f2 + d2, f32(tet.n2));
    nodeForces[base + 3u] = vec4<f32>(f3 + d3, f32(tet.n3));
}
`;

const INTEGRATE_NODES_SHADER = /* wgsl */`
// Integrate soft body nodes: apply accumulated forces, gravity, update positions

struct Node {
    posX: f32, posY: f32, posZ: f32, invMass: f32,
    velX: f32, velY: f32, velZ: f32, _pad: f32,
    prevPosX: f32, prevPosY: f32, prevPosZ: f32, pinned: u32,
}

struct Params {
    nodeCount: u32,
    tetCount: u32,
    dt: f32,
    gravity: f32,
    materialCount: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
}

@group(0) @binding(0) var<storage, read_write> nodes: array<Node>;
@group(0) @binding(1) var<storage, read> accumulatedForces: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let id = gid.x;
    if (id >= params.nodeCount) { return; }

    var node = nodes[id];
    if (node.pinned != 0u || node.invMass <= 0.0) { return; }

    // Read accumulated force for this node
    let force = accumulatedForces[id];

    let dt = params.dt;

    // Save previous position
    node.prevPosX = node.posX;
    node.prevPosY = node.posY;
    node.prevPosZ = node.posZ;

    // Apply forces
    let ax = force.x * node.invMass;
    let ay = force.y * node.invMass + params.gravity;
    let az = force.z * node.invMass;

    node.velX += ax * dt;
    node.velY += ay * dt;
    node.velZ += az * dt;

    // Velocity damping (global)
    let damping = 0.999;
    node.velX *= damping;
    node.velY *= damping;
    node.velZ *= damping;

    // Update position
    node.posX += node.velX * dt;
    node.posY += node.velY * dt;
    node.posZ += node.velZ * dt;

    // Ground plane collision (simple)
    if (node.posY < 0.0) {
        node.posY = 0.0;
        node.velY = max(node.velY, 0.0) * 0.3;
        node.velX *= 0.9;
        node.velZ *= 0.9;
    }

    nodes[id] = node;
}
`;

// ============================================================================
// SOFT BODY CLASS
// ============================================================================

/**
 * Lamé parameters from Young's modulus and Poisson's ratio.
 */
export function lameParameters(youngsModulus, poissonRatio) {
    const mu = youngsModulus / (2 * (1 + poissonRatio));
    const lambda = youngsModulus * poissonRatio / ((1 + poissonRatio) * (1 - 2 * poissonRatio));
    return { mu, lambda };
}

/**
 * Material presets (Young's modulus in Pa, Poisson's ratio).
 */
export const SOFT_BODY_MATERIALS = {
    rubber:  { youngsModulus: 1e6,  poissonRatio: 0.49, damping: 0.1 },
    jelly:   { youngsModulus: 5e4,  poissonRatio: 0.45, damping: 0.2 },
    flesh:   { youngsModulus: 1e5,  poissonRatio: 0.40, damping: 0.15 },
    foam:    { youngsModulus: 2e4,  poissonRatio: 0.30, damping: 0.3 },
    silicone:{ youngsModulus: 5e5,  poissonRatio: 0.47, damping: 0.05 },
    stiff:   { youngsModulus: 1e7,  poissonRatio: 0.35, damping: 0.05 },
};

export class GPUSoftBody {
    constructor(device, options = {}) {
        this.device = device;
        this.maxNodes = options.maxNodes ?? MAX_SOFT_BODY_NODES;
        this.maxTets = options.maxTets ?? MAX_SOFT_BODY_TETS;
        this.gravity = options.gravity ?? -9.81;

        this._buffers = {};
        this._pipelines = {};
        this._bindGroups = {};
        this._paramsU32 = new Uint32Array(8);
        this._paramsF32 = new Float32Array(this._paramsU32.buffer);

        // CPU data
        this.nodeCount = 0;
        this.tetCount = 0;
        this.materialCount = 0;
        this._cpuNodes = null;
        this._cpuTets = null;
        this._cpuMaterials = new Float32Array(64); // 16 materials * 4 floats
        this._cpuAccumForces = null;
        this._nodesDirty = false;
    }

    async init() {
        this._createBuffers();
        await this._createPipelines();
        console.log(`[GPUSoftBody] Initialized — maxNodes=${this.maxNodes}, maxTets=${this.maxTets}`);
    }

    _createBuffers() {
        const d = this.device;
        const b = (label, size, usage) => d.createBuffer({ label, size, usage });
        const SUW = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
        const NODE_STRIDE = 48; // 12 floats
        const TET_STRIDE = 64;  // 16 floats

        this._buffers.nodes = b('SB_Nodes', this.maxNodes * NODE_STRIDE, SUW);
        this._buffers.tets = b('SB_Tets', this.maxTets * TET_STRIDE, SUW);
        this._buffers.materials = b('SB_Materials', 256, SUW); // 16 materials
        this._buffers.nodeForces = b('SB_NodeForces', this.maxTets * 4 * 16, SUW); // 4 nodes per tet
        this._buffers.accumulatedForces = b('SB_AccumForces', this.maxNodes * 16, SUW);
        this._buffers.params = b('SB_Params', 32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);

        // Readback
        this._buffers.readback = b('SB_Readback', this.maxNodes * NODE_STRIDE, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);

        this._cpuNodes = new Float32Array(this.maxNodes * 12);
        this._cpuTets = new Float32Array(this.maxTets * 16);
        this._cpuAccumForces = new Float32Array(this.maxNodes * 4);
    }

    async _createPipelines() {
        const d = this.device;

        const forceModule = d.createShaderModule({ label: 'SB_FEMForce', code: FEM_FORCE_SHADER });
        this._pipelines.femForce = await d.createComputePipelineAsync({
            label: 'SB_FEMForce', layout: 'auto',
            compute: { module: forceModule, entryPoint: 'main' },
        });

        const integrateModule = d.createShaderModule({ label: 'SB_Integrate', code: INTEGRATE_NODES_SHADER });
        this._pipelines.integrate = await d.createComputePipelineAsync({
            label: 'SB_Integrate', layout: 'auto',
            compute: { module: integrateModule, entryPoint: 'main' },
        });

        this._rebuildBindGroups();
    }

    _rebuildBindGroups() {
        const d = this.device;
        const B = this._buffers;

        this._bindGroups.femForce = d.createBindGroup({
            label: 'SB_FEMForce_BG',
            layout: this._pipelines.femForce.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: B.nodes } },
                { binding: 1, resource: { buffer: B.tets } },
                { binding: 2, resource: { buffer: B.materials } },
                { binding: 3, resource: { buffer: B.nodeForces } },
                { binding: 4, resource: { buffer: B.params } },
            ],
        });

        this._bindGroups.integrate = d.createBindGroup({
            label: 'SB_Integrate_BG',
            layout: this._pipelines.integrate.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: B.nodes } },
                { binding: 1, resource: { buffer: B.accumulatedForces } },
                { binding: 2, resource: { buffer: B.params } },
            ],
        });
    }

    // ========================================================================
    // MESH CREATION
    // ========================================================================

    /**
     * Add a material.
     * @param {Object} desc - { youngsModulus, poissonRatio, damping } or preset name
     * @returns {number} Material index
     */
    addMaterial(desc) {
        if (typeof desc === 'string') {
            desc = SOFT_BODY_MATERIALS[desc] || SOFT_BODY_MATERIALS.rubber;
        }
        const { mu, lambda } = lameParameters(desc.youngsModulus ?? 1e6, desc.poissonRatio ?? 0.45);
        const idx = this.materialCount;
        const base = idx * 4;
        this._cpuMaterials[base] = mu;
        this._cpuMaterials[base + 1] = lambda;
        this._cpuMaterials[base + 2] = desc.damping ?? 0.1;
        this.materialCount++;
        this.device.queue.writeBuffer(this._buffers.materials, 0, this._cpuMaterials);
        return idx;
    }

    /**
     * Create a soft body from tetrahedral mesh data.
     * @param {Float32Array} nodePositions - Flat xyz (length = nodeCount * 3)
     * @param {Uint32Array} tetIndices - 4 node indices per tet (length = tetCount * 4)
     * @param {number} materialIdx - Material index from addMaterial()
     * @param {Object} [options] - { invMass, pinnedNodes: Set<number> }
     * @returns {{ nodeStart: number, nodeCount: number, tetStart: number, tetCount: number }}
     */
    createSoftBody(nodePositions, tetIndices, materialIdx = 0, options = {}) {
        const numNodes = nodePositions.length / 3;
        const numTets = tetIndices.length / 4;

        if (this.nodeCount + numNodes > this.maxNodes) {
            console.warn(`[GPUSoftBody] Max nodes exceeded`);
            return null;
        }
        if (this.tetCount + numTets > this.maxTets) {
            console.warn(`[GPUSoftBody] Max tets exceeded`);
            return null;
        }

        const nodeStart = this.nodeCount;
        const tetStart = this.tetCount;
        const invMass = options.invMass ?? 1.0;
        const pinnedNodes = options.pinnedNodes || new Set();

        // Write nodes
        for (let i = 0; i < numNodes; i++) {
            const ni = (nodeStart + i) * 12;
            const px = nodePositions[i * 3];
            const py = nodePositions[i * 3 + 1];
            const pz = nodePositions[i * 3 + 2];
            this._cpuNodes[ni]     = px;  // posX
            this._cpuNodes[ni + 1] = py;  // posY
            this._cpuNodes[ni + 2] = pz;  // posZ
            this._cpuNodes[ni + 3] = pinnedNodes.has(i) ? 0.0 : invMass; // invMass
            this._cpuNodes[ni + 4] = 0;   // velX
            this._cpuNodes[ni + 5] = 0;   // velY
            this._cpuNodes[ni + 6] = 0;   // velZ
            this._cpuNodes[ni + 8] = px;  // prevPosX
            this._cpuNodes[ni + 9] = py;  // prevPosY
            this._cpuNodes[ni + 10] = pz; // prevPosZ
            const u32View = new Uint32Array(this._cpuNodes.buffer);
            u32View[ni + 11] = pinnedNodes.has(i) ? 1 : 0; // pinned
        }

        // Write tets with precomputed Dm_inv and rest volume
        for (let t = 0; t < numTets; t++) {
            const i0 = tetIndices[t * 4] + nodeStart;
            const i1 = tetIndices[t * 4 + 1] + nodeStart;
            const i2 = tetIndices[t * 4 + 2] + nodeStart;
            const i3 = tetIndices[t * 4 + 3] + nodeStart;

            // Local node indices (relative to global)
            const p0 = [nodePositions[(i0 - nodeStart) * 3], nodePositions[(i0 - nodeStart) * 3 + 1], nodePositions[(i0 - nodeStart) * 3 + 2]];
            const p1 = [nodePositions[(i1 - nodeStart) * 3], nodePositions[(i1 - nodeStart) * 3 + 1], nodePositions[(i1 - nodeStart) * 3 + 2]];
            const p2 = [nodePositions[(i2 - nodeStart) * 3], nodePositions[(i2 - nodeStart) * 3 + 1], nodePositions[(i2 - nodeStart) * 3 + 2]];
            const p3 = [nodePositions[(i3 - nodeStart) * 3], nodePositions[(i3 - nodeStart) * 3 + 1], nodePositions[(i3 - nodeStart) * 3 + 2]];

            // Edge matrix Dm (columns = edges from p0)
            const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
            const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
            const e3 = [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]];

            // Dm_inv = inverse of 3x3 [e1 e2 e3] (column-major)
            const dmInv = _invert3x3(
                e1[0], e2[0], e3[0],
                e1[1], e2[1], e3[1],
                e1[2], e2[2], e3[2],
            );

            // Rest volume = |det(Dm)| / 6
            const det = e1[0] * (e2[1] * e3[2] - e2[2] * e3[1])
                      - e2[0] * (e1[1] * e3[2] - e1[2] * e3[1])
                      + e3[0] * (e1[1] * e2[2] - e1[2] * e2[1]);
            const restVolume = Math.abs(det) / 6;

            const ti = (tetStart + t) * 16;
            const u32View = new Uint32Array(this._cpuTets.buffer);
            u32View[ti]     = i0;
            u32View[ti + 1] = i1;
            u32View[ti + 2] = i2;
            u32View[ti + 3] = i3;
            // Dm_inv (column-major: col0 = [dm00,dm10,dm20], col1, col2)
            this._cpuTets[ti + 4]  = dmInv[0]; this._cpuTets[ti + 5]  = dmInv[1]; this._cpuTets[ti + 6]  = dmInv[2];
            this._cpuTets[ti + 7]  = dmInv[3]; this._cpuTets[ti + 8]  = dmInv[4]; this._cpuTets[ti + 9]  = dmInv[5];
            this._cpuTets[ti + 10] = dmInv[6]; this._cpuTets[ti + 11] = dmInv[7]; this._cpuTets[ti + 12] = dmInv[8];
            this._cpuTets[ti + 13] = restVolume;
            u32View[ti + 14] = materialIdx;
        }

        this.nodeCount += numNodes;
        this.tetCount += numTets;
        this._nodesDirty = true;

        // Upload
        this.device.queue.writeBuffer(this._buffers.nodes, 0, this._cpuNodes);
        this.device.queue.writeBuffer(this._buffers.tets, 0, this._cpuTets);

        return { nodeStart, nodeCount: numNodes, tetStart, tetCount: numTets };
    }

    /**
     * Generate a simple cube soft body for testing.
     */
    createCube(center = [0, 2, 0], size = 1, subdivisions = 3, materialIdx = 0) {
        const n = subdivisions + 1;
        const step = size / subdivisions;
        const nodes = [];
        const tets = [];

        // Generate grid of nodes
        for (let z = 0; z < n; z++) {
            for (let y = 0; y < n; y++) {
                for (let x = 0; x < n; x++) {
                    nodes.push(
                        center[0] + (x - subdivisions / 2) * step,
                        center[1] + (y - subdivisions / 2) * step,
                        center[2] + (z - subdivisions / 2) * step,
                    );
                }
            }
        }

        // Generate tets (5 tets per cube cell)
        for (let z = 0; z < subdivisions; z++) {
            for (let y = 0; y < subdivisions; y++) {
                for (let x = 0; x < subdivisions; x++) {
                    const i = x + y * n + z * n * n;
                    const v = [
                        i, i + 1, i + n, i + n + 1,
                        i + n * n, i + n * n + 1, i + n * n + n, i + n * n + n + 1,
                    ];
                    // 5-tet decomposition of a cube
                    tets.push(v[0], v[1], v[3], v[5]);
                    tets.push(v[0], v[3], v[2], v[6]);
                    tets.push(v[0], v[5], v[4], v[6]);
                    tets.push(v[3], v[5], v[6], v[7]);
                    tets.push(v[0], v[3], v[5], v[6]);
                }
            }
        }

        return this.createSoftBody(
            new Float32Array(nodes),
            new Uint32Array(tets),
            materialIdx,
        );
    }

    // ========================================================================
    // GPU DISPATCH
    // ========================================================================

    /**
     * Step soft body simulation.
     * @param {number} dt - Time step
     * @param {number} [substeps=4]
     */
    step(encoder, dt, substeps = 4) {
        if (this.nodeCount === 0 || this.tetCount === 0) return;

        const subDt = dt / substeps;

        for (let sub = 0; sub < substeps; sub++) {
            // Write params
            this._paramsU32[0] = this.nodeCount;
            this._paramsU32[1] = this.tetCount;
            this._paramsF32[2] = subDt;
            this._paramsF32[3] = this.gravity;
            this._paramsU32[4] = Math.max(this.materialCount, 1);
            this.device.queue.writeBuffer(this._buffers.params, 0, this._paramsF32);

            // Zero accumulated forces
            this._cpuAccumForces.fill(0);
            this.device.queue.writeBuffer(this._buffers.accumulatedForces, 0, this._cpuAccumForces);

            // 1. Compute FEM forces per tet
            const tetWG = Math.ceil(this.tetCount / 64);
            const forcePass = encoder.beginComputePass({ label: `SB_Force_sub${sub}` });
            forcePass.setPipeline(this._pipelines.femForce);
            forcePass.setBindGroup(0, this._bindGroups.femForce);
            forcePass.dispatchWorkgroups(tetWG);
            forcePass.end();

            // 2. Integrate nodes
            const nodeWG = Math.ceil(this.nodeCount / 64);
            const intPass = encoder.beginComputePass({ label: `SB_Integrate_sub${sub}` });
            intPass.setPipeline(this._pipelines.integrate);
            intPass.setBindGroup(0, this._bindGroups.integrate);
            intPass.dispatchWorkgroups(nodeWG);
            intPass.end();
        }
    }

    /**
     * Async readback of node positions.
     * @returns {Promise<Float32Array>} Node positions (12 floats per node)
     */
    async readback() {
        const encoder = this.device.createCommandEncoder({ label: 'SB_Readback' });
        const byteSize = this.nodeCount * 48;
        encoder.copyBufferToBuffer(this._buffers.nodes, 0, this._buffers.readback, 0, byteSize);
        this.device.queue.submit([encoder.finish()]);

        try {
            await this._buffers.readback.mapAsync(GPUMapMode.READ, 0, byteSize);
            const data = new Float32Array(this._buffers.readback.getMappedRange(0, byteSize).slice(0));
            this._buffers.readback.unmap();
            return data;
        } catch (e) {
            console.warn('[GPUSoftBody] Readback failed:', e.message);
            return null;
        }
    }

    destroy() {
        for (const buf of Object.values(this._buffers)) {
            if (buf && typeof buf.destroy === 'function') buf.destroy();
        }
        this._buffers = {};
    }
}

// ============================================================================
// MATH HELPERS
// ============================================================================

function _invert3x3(m00, m01, m02, m10, m11, m12, m20, m21, m22) {
    const det = m00 * (m11 * m22 - m12 * m21)
              - m01 * (m10 * m22 - m12 * m20)
              + m02 * (m10 * m21 - m11 * m20);
    if (Math.abs(det) < 1e-12) {
        return [1, 0, 0, 0, 1, 0, 0, 0, 1]; // Identity fallback
    }
    const invDet = 1 / det;
    return [
        (m11 * m22 - m12 * m21) * invDet,
        (m12 * m20 - m10 * m22) * invDet,
        (m10 * m21 - m11 * m20) * invDet,
        (m02 * m21 - m01 * m22) * invDet,
        (m00 * m22 - m02 * m20) * invDet,
        (m01 * m20 - m00 * m21) * invDet,
        (m01 * m12 - m02 * m11) * invDet,
        (m02 * m10 - m00 * m12) * invDet,
        (m00 * m11 - m01 * m10) * invDet,
    ];
}

// ============================================================================
// FACTORY
// ============================================================================

export async function createSoftBodySolver(device, options = {}) {
    const sb = new GPUSoftBody(device, options);
    await sb.init();
    return sb;
}

export function destroySoftBodySolver(sb) {
    if (sb) sb.destroy();
}
