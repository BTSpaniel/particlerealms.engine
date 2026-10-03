// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * LayerMap.js - GPU Stratigraphic Terrain Data Structure
 * 
 * Implements the "Layer Map" from SoilMachine for volumetric terrain with:
 * - Multiple material layers per grid cell (stratigraphy)
 * - GPU-resident linked list structure using index-based "pointers"
 * - Support for caves, overhangs, and distinct soil layers
 * 
 * Based on: "Unified Procedural Geomorphology" specification
 * Reference: Nick McDonald's SoilMachine
 * 
 * Data Structure:
 * - Head Map: texture_storage_2d<r32uint> - Entry point per pixel
 * - Node Pool: array<LayerNode> - All layer segments
 * - Allocator: atomic<u32> - Next free index
 * - Lock Map: texture_storage_2d<r32uint> - Per-pixel spinlocks
 */

// ============================================================================
// CONSTANTS
// ============================================================================

export const MATERIAL_ID = {
    AIR: 0,
    BEDROCK: 1,
    GRAVEL: 2,
    SAND: 3,
    TOPSOIL: 4,
    WATER: 5,
    MAGMA: 6,
    CLAY: 7,
    LIMESTONE: 8,
    GRANITE: 9,
    OBSIDIAN: 10,
    ICE: 11,
};

// Material properties for simulation
export const MATERIAL_PROPERTIES = {
    [MATERIAL_ID.BEDROCK]:   { hardness: 1.0, talusAngle: 85, permeability: 0.01, density: 2.7 },
    [MATERIAL_ID.GRAVEL]:    { hardness: 0.6, talusAngle: 45, permeability: 0.80, density: 1.8 },
    [MATERIAL_ID.SAND]:      { hardness: 0.3, talusAngle: 30, permeability: 0.50, density: 1.6 },
    [MATERIAL_ID.TOPSOIL]:   { hardness: 0.2, talusAngle: 35, permeability: 0.30, density: 1.3 },
    [MATERIAL_ID.WATER]:     { hardness: 0.0, talusAngle: 0,  permeability: 1.00, density: 1.0 },
    [MATERIAL_ID.MAGMA]:     { hardness: 0.1, talusAngle: 5,  permeability: 0.05, density: 2.5 },
    [MATERIAL_ID.CLAY]:      { hardness: 0.4, talusAngle: 40, permeability: 0.10, density: 1.9 },
    [MATERIAL_ID.LIMESTONE]: { hardness: 0.7, talusAngle: 70, permeability: 0.20, density: 2.3 },
    [MATERIAL_ID.GRANITE]:   { hardness: 0.9, talusAngle: 80, permeability: 0.02, density: 2.6 },
    [MATERIAL_ID.OBSIDIAN]:  { hardness: 0.95, talusAngle: 88, permeability: 0.00, density: 2.4 },
    [MATERIAL_ID.ICE]:       { hardness: 0.5, talusAngle: 60, permeability: 0.00, density: 0.9 },
};

const NULL_PTR = 0xFFFFFFFF;
const NODE_STRIDE = 20;  // 5 x u32 per node (material, top_y, bottom_y, next, prev)
const MAX_NODES_PER_CHUNK = 65536;

// ============================================================================
// SHADER SOURCES
// ============================================================================

const LAYER_NODE_STRUCT = /* wgsl */ `
struct LayerNode {
    material_id: u32,   // Material type (see MATERIAL_ID)
    top_y: f32,         // Top elevation of this layer
    bottom_y: f32,      // Bottom elevation of this layer
    next_ptr: u32,      // Index to next node below (NULL_PTR = end)
    prev_ptr: u32,      // Index to previous node above (NULL_PTR = top)
}

const NULL_PTR: u32 = 0xFFFFFFFFu;
`;

const LAYER_MAP_BINDINGS = /* wgsl */ `
// Head map: entry point index for each (x, z) column
@group(0) @binding(0) var head_map: texture_storage_2d<r32uint, read_write>;

// Node pool: all layer nodes for this chunk
@group(0) @binding(1) var<storage, read_write> node_pool: array<LayerNode>;

// Allocator: next free index in node pool
@group(0) @binding(2) var<storage, read_write> allocator: atomic<u32>;

// Lock map: per-pixel spinlocks for safe list modification
@group(0) @binding(3) var lock_map: texture_storage_2d<r32uint, read_write>;

// Params
struct LayerMapParams {
    chunk_size: u32,        // Grid resolution (e.g., 64)
    max_nodes: u32,         // Maximum nodes in pool
    world_origin_x: f32,
    world_origin_z: f32,
    grid_scale: f32,        // World units per grid cell
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
}
@group(0) @binding(4) var<uniform> params: LayerMapParams;
`;

// Initialize layer map with bedrock foundation
const INIT_LAYER_MAP_SHADER = /* wgsl */ `
${LAYER_NODE_STRUCT}
${LAYER_MAP_BINDINGS}

@compute @workgroup_size(8, 8)
fn init_layer_map(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = gid.x;
    let z = gid.y;
    
    if (x >= params.chunk_size || z >= params.chunk_size) {
        return;
    }
    
    // Allocate a node for bedrock
    let node_idx = atomicAdd(&allocator, 1u);
    if (node_idx >= params.max_nodes) {
        return;  // Out of memory
    }
    
    // Create bedrock layer (fills from -inf to 0 by default)
    node_pool[node_idx] = LayerNode(
        1u,              // material_id = BEDROCK
        0.0,             // top_y (will be set by terrain gen)
        -1000.0,         // bottom_y (deep bedrock)
        NULL_PTR,        // next_ptr (no layer below)
        NULL_PTR,        // prev_ptr (this is top)
    );
    
    // Set head map to point to this node
    textureStore(head_map, vec2<i32>(i32(x), i32(z)), vec4<u32>(node_idx, 0u, 0u, 0u));
    
    // Initialize lock to unlocked
    textureStore(lock_map, vec2<i32>(i32(x), i32(z)), vec4<u32>(0u, 0u, 0u, 0u));
}
`;

// Add a new layer on top of existing stack
const ADD_LAYER_SHADER = /* wgsl */ `
${LAYER_NODE_STRUCT}
${LAYER_MAP_BINDINGS}

struct AddLayerRequest {
    x: u32,
    z: u32,
    material_id: u32,
    thickness: f32,
}

@group(1) @binding(0) var<storage, read> requests: array<AddLayerRequest>;
@group(1) @binding(1) var<uniform> request_count: u32;

// Spinlock acquire
fn acquire_lock(x: i32, z: i32) -> bool {
    // Try to set lock from 0 to 1
    let current = textureLoad(lock_map, vec2<i32>(x, z)).r;
    if (current != 0u) {
        return false;  // Already locked
    }
    textureStore(lock_map, vec2<i32>(x, z), vec4<u32>(1u, 0u, 0u, 0u));
    return true;
}

fn release_lock(x: i32, z: i32) {
    textureStore(lock_map, vec2<i32>(x, z), vec4<u32>(0u, 0u, 0u, 0u));
}

@compute @workgroup_size(64)
fn add_layer(@builtin(global_invocation_id) gid: vec3<u32>) {
    let req_idx = gid.x;
    if (req_idx >= request_count) {
        return;
    }
    
    let req = requests[req_idx];
    let x = i32(req.x);
    let z = i32(req.z);
    
    // Try to acquire lock (simple version - may need retry logic)
    if (!acquire_lock(x, z)) {
        return;  // Skip if locked (would need retry queue in production)
    }
    
    // Get current head
    let head_idx = textureLoad(head_map, vec2<i32>(x, z)).r;
    
    // Allocate new node
    let new_idx = atomicAdd(&allocator, 1u);
    if (new_idx >= params.max_nodes) {
        release_lock(x, z);
        return;  // Out of memory
    }
    
    // Get top_y from current head
    var new_bottom_y = 0.0;
    if (head_idx != NULL_PTR) {
        new_bottom_y = node_pool[head_idx].top_y;
        // Update old head's prev_ptr to point to new node
        node_pool[head_idx].prev_ptr = new_idx;
    }
    
    // Create new layer on top
    node_pool[new_idx] = LayerNode(
        req.material_id,
        new_bottom_y + req.thickness,  // top_y
        new_bottom_y,                   // bottom_y
        head_idx,                       // next_ptr (old head)
        NULL_PTR,                       // prev_ptr (this is new top)
    );
    
    // Update head map
    textureStore(head_map, vec2<i32>(x, z), vec4<u32>(new_idx, 0u, 0u, 0u));
    
    release_lock(x, z);
}
`;

// Erode top layer (remove material)
const ERODE_LAYER_SHADER = /* wgsl */ `
${LAYER_NODE_STRUCT}
${LAYER_MAP_BINDINGS}

struct ErodeRequest {
    x: u32,
    z: u32,
    amount: f32,
    _pad: u32,
}

@group(1) @binding(0) var<storage, read> requests: array<ErodeRequest>;
@group(1) @binding(1) var<uniform> request_count: u32;

@compute @workgroup_size(64)
fn erode_layer(@builtin(global_invocation_id) gid: vec3<u32>) {
    let req_idx = gid.x;
    if (req_idx >= request_count) {
        return;
    }
    
    let req = requests[req_idx];
    let x = i32(req.x);
    let z = i32(req.z);
    var remaining = req.amount;
    
    // Get current head
    var current_idx = textureLoad(head_map, vec2<i32>(x, z)).r;
    
    // Erode through layers until amount is exhausted
    while (remaining > 0.0 && current_idx != NULL_PTR) {
        let layer_thickness = node_pool[current_idx].top_y - node_pool[current_idx].bottom_y;
        
        if (remaining >= layer_thickness) {
            // Remove entire layer
            remaining -= layer_thickness;
            let next_idx = node_pool[current_idx].next_ptr;
            
            // Update head to next layer
            if (next_idx != NULL_PTR) {
                node_pool[next_idx].prev_ptr = NULL_PTR;
            }
            textureStore(head_map, vec2<i32>(x, z), vec4<u32>(next_idx, 0u, 0u, 0u));
            
            // Note: In production, we'd add current_idx to a free list
            current_idx = next_idx;
        } else {
            // Partial erosion - just lower top_y
            node_pool[current_idx].top_y -= remaining;
            remaining = 0.0;
        }
    }
}
`;

// Sample terrain height at a point (raycast down)
const SAMPLE_HEIGHT_SHADER = /* wgsl */ `
${LAYER_NODE_STRUCT}
${LAYER_MAP_BINDINGS}

struct SampleRequest {
    x: f32,
    z: f32,
    _pad0: f32,
    _pad1: f32,
}

struct SampleResult {
    height: f32,
    material_id: u32,
    layer_count: u32,
    _pad: u32,
}

@group(1) @binding(0) var<storage, read> requests: array<SampleRequest>;
@group(1) @binding(1) var<storage, read_write> results: array<SampleResult>;
@group(1) @binding(2) var<uniform> request_count: u32;

@compute @workgroup_size(64)
fn sample_height(@builtin(global_invocation_id) gid: vec3<u32>) {
    let req_idx = gid.x;
    if (req_idx >= request_count) {
        return;
    }
    
    let req = requests[req_idx];
    
    // Convert world to grid
    let gx = i32((req.x - params.world_origin_x) / params.grid_scale);
    let gz = i32((req.z - params.world_origin_z) / params.grid_scale);
    
    // Bounds check
    if (gx < 0 || gx >= i32(params.chunk_size) || gz < 0 || gz >= i32(params.chunk_size)) {
        results[req_idx] = SampleResult(0.0, 0u, 0u, 0u);
        return;
    }
    
    // Get head node
    let head_idx = textureLoad(head_map, vec2<i32>(gx, gz)).r;
    
    if (head_idx == NULL_PTR) {
        results[req_idx] = SampleResult(0.0, 0u, 0u, 0u);
        return;
    }
    
    // Count layers and get top surface
    var layer_count = 0u;
    var current_idx = head_idx;
    while (current_idx != NULL_PTR) {
        layer_count += 1u;
        current_idx = node_pool[current_idx].next_ptr;
    }
    
    let top_node = node_pool[head_idx];
    results[req_idx] = SampleResult(
        top_node.top_y,
        top_node.material_id,
        layer_count,
        0u,
    );
}
`;

// ============================================================================
// JAVASCRIPT CLASS
// ============================================================================

/**
 * LayerMap - GPU-resident stratigraphic terrain data structure
 */
export class LayerMap {
    constructor(chunkSize = 64, maxNodes = MAX_NODES_PER_CHUNK) {
        this.device = null;
        this.initialized = false;
        
        this.chunkSize = chunkSize;
        this.maxNodes = maxNodes;
        this.gridScale = 1.0;  // World units per grid cell
        this.worldOrigin = [0, 0];
        
        // GPU resources
        this.headMapTexture = null;
        this.lockMapTexture = null;
        this.nodePoolBuffer = null;
        this.allocatorBuffer = null;
        this.paramsBuffer = null;
        
        // Pipelines
        this.initPipeline = null;
        this.addLayerPipeline = null;
        this.erodePipeline = null;
        this.samplePipeline = null;
        
        // Bind groups
        this.coreBindGroup = null;
        
        // Stats
        this.stats = {
            nodesAllocated: 0,
            layersAdded: 0,
            erosionEvents: 0,
        };
    }
    
    /**
     * Initialize GPU resources
     * @param {GPUDevice} device 
     */
    async init(device) {
        this.device = device;
        
        // Create head map texture (stores entry index for each column)
        this.headMapTexture = device.createTexture({
            label: 'LayerMap Head Map',
            size: [this.chunkSize, this.chunkSize],
            format: 'r32uint',
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
        });
        
        // Create lock map texture (spinlocks)
        this.lockMapTexture = device.createTexture({
            label: 'LayerMap Lock Map',
            size: [this.chunkSize, this.chunkSize],
            format: 'r32uint',
            usage: GPUTextureUsage.STORAGE_BINDING,
        });
        
        // Create node pool buffer
        // Each node: 5 x u32 = 20 bytes
        this.nodePoolBuffer = device.createBuffer({
            label: 'LayerMap Node Pool',
            size: this.maxNodes * NODE_STRIDE,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
        // Create allocator buffer (atomic counter)
        this.allocatorBuffer = device.createBuffer({
            label: 'LayerMap Allocator',
            size: 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });
        
        // Create params buffer
        this.paramsBuffer = device.createBuffer({
            label: 'LayerMap Params',
            size: 32,  // 8 x f32/u32
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        
        // Update params
        this._updateParams();
        
        // Create pipelines
        await this._createPipelines();
        
        // Create core bind group
        this._createBindGroup();
        
        this.initialized = true;
        console.log(`[LayerMap] Initialized ${this.chunkSize}x${this.chunkSize} grid, ${this.maxNodes} max nodes`);
    }
    
    /**
     * Update params buffer
     * @private
     */
    _updateParams() {
        const params = new ArrayBuffer(32);
        const u32View = new Uint32Array(params);
        const f32View = new Float32Array(params);
        
        u32View[0] = this.chunkSize;
        u32View[1] = this.maxNodes;
        f32View[2] = this.worldOrigin[0];
        f32View[3] = this.worldOrigin[1];
        f32View[4] = this.gridScale;
        f32View[5] = 0;  // padding
        f32View[6] = 0;
        f32View[7] = 0;
        
        this.device.queue.writeBuffer(this.paramsBuffer, 0, params);
    }
    
    /**
     * Create compute pipelines
     * @private
     */
    async _createPipelines() {
        // Init pipeline
        const initModule = this.device.createShaderModule({
            label: 'LayerMap Init Shader',
            code: INIT_LAYER_MAP_SHADER,
        });
        
        this.initPipeline = this.device.createComputePipeline({
            label: 'LayerMap Init Pipeline',
            layout: 'auto',
            compute: {
                module: initModule,
                entryPoint: 'init_layer_map',
            },
        });
        
        // Add layer pipeline
        const addModule = this.device.createShaderModule({
            label: 'LayerMap Add Layer Shader',
            code: ADD_LAYER_SHADER,
        });
        
        this.addLayerPipeline = this.device.createComputePipeline({
            label: 'LayerMap Add Layer Pipeline',
            layout: 'auto',
            compute: {
                module: addModule,
                entryPoint: 'add_layer',
            },
        });
        
        // Erode pipeline
        const erodeModule = this.device.createShaderModule({
            label: 'LayerMap Erode Shader',
            code: ERODE_LAYER_SHADER,
        });
        
        this.erodePipeline = this.device.createComputePipeline({
            label: 'LayerMap Erode Pipeline',
            layout: 'auto',
            compute: {
                module: erodeModule,
                entryPoint: 'erode_layer',
            },
        });
        
        // Sample pipeline
        const sampleModule = this.device.createShaderModule({
            label: 'LayerMap Sample Shader',
            code: SAMPLE_HEIGHT_SHADER,
        });
        
        this.samplePipeline = this.device.createComputePipeline({
            label: 'LayerMap Sample Pipeline',
            layout: 'auto',
            compute: {
                module: sampleModule,
                entryPoint: 'sample_height',
            },
        });
    }
    
    /**
     * Create core bind group
     * @private
     */
    _createBindGroup() {
        this.coreBindGroup = this.device.createBindGroup({
            label: 'LayerMap Core Bind Group',
            layout: this.initPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: this.headMapTexture.createView() },
                { binding: 1, resource: { buffer: this.nodePoolBuffer } },
                { binding: 2, resource: { buffer: this.allocatorBuffer } },
                { binding: 3, resource: this.lockMapTexture.createView() },
                { binding: 4, resource: { buffer: this.paramsBuffer } },
            ],
        });
    }
    
    /**
     * Initialize layer map with bedrock foundation
     * @param {GPUCommandEncoder} encoder 
     */
    initialize(encoder) {
        // Reset allocator
        this.device.queue.writeBuffer(this.allocatorBuffer, 0, new Uint32Array([0]));
        
        const pass = encoder.beginComputePass({ label: 'LayerMap Init' });
        pass.setPipeline(this.initPipeline);
        pass.setBindGroup(0, this.coreBindGroup);
        pass.dispatchWorkgroups(
            Math.ceil(this.chunkSize / 8),
            Math.ceil(this.chunkSize / 8)
        );
        pass.end();
        
        this.stats.nodesAllocated = this.chunkSize * this.chunkSize;
    }
    
    /**
     * Set world origin for coordinate conversion
     * @param {number} x 
     * @param {number} z 
     */
    setWorldOrigin(x, z) {
        this.worldOrigin = [x, z];
        this._updateParams();
    }
    
    /**
     * Set grid scale (world units per cell)
     * @param {number} scale 
     */
    setGridScale(scale) {
        this.gridScale = scale;
        this._updateParams();
    }
    
    /**
     * Get GPU resources for external use
     */
    getResources() {
        return {
            headMapTexture: this.headMapTexture,
            nodePoolBuffer: this.nodePoolBuffer,
            allocatorBuffer: this.allocatorBuffer,
            lockMapTexture: this.lockMapTexture,
            paramsBuffer: this.paramsBuffer,
        };
    }
    
    /**
     * Get material properties
     * @param {number} materialId 
     */
    static getMaterialProperties(materialId) {
        return MATERIAL_PROPERTIES[materialId] || MATERIAL_PROPERTIES[MATERIAL_ID.BEDROCK];
    }
    
    /**
     * Destroy GPU resources
     */
    destroy() {
        this.headMapTexture?.destroy();
        this.lockMapTexture?.destroy();
        this.nodePoolBuffer?.destroy();
        this.allocatorBuffer?.destroy();
        this.paramsBuffer?.destroy();
        this.initialized = false;
    }
}

export default LayerMap;
