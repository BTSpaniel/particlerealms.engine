// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * LineToVoxel.js - Convert Line Networks to Voxel Density Fields
 * 
 * Generates voxelized structures from Bezier curve networks:
 * - Trees: Trunk + branches + roots
 * - Caves/Tunnels: Worm-carved passages
 * - Structures: Beams, supports, pipes
 * - Organic: Veins, roots, tendrils
 * 
 * Pipeline:
 * 1. Define curve network (nodes + connections)
 * 2. Build spatial acceleration structure
 * 3. For each voxel, compute distance to nearest curve
 * 4. Convert distance to density for MC meshing
 * 
 * Supports:
 * - Tapered curves (varying radius)
 * - Smooth blending at junctions
 * - Material assignment per curve
 * - GPU-accelerated field generation
 */

import { CubicBezier, BezierSpline, straightLine } from './BezierCurves.js';
import { 
    bezierDistanceCapsule, 
    multiCurveDistance, 
    smin, 
    curvesToSegments,
    curvesToGPUBuffer 
} from './BezierDistance.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default voxel resolution */
export const DEFAULT_RESOLUTION = 32;

/** Blend radius for smooth junctions */
export const DEFAULT_BLEND_RADIUS = 0.5;

/** Material IDs */
export const Materials = {
    AIR: 0,
    WOOD: 1,
    BARK: 2,
    STONE: 3,
    METAL: 4,
    ORGANIC: 5,
};

// ============================================================================
// LINE NETWORK NODE
// ============================================================================

/**
 * Node in a line network (branch point or endpoint)
 */
export class NetworkNode {
    /**
     * @param {number[]} position - [x, y, z]
     * @param {number} radius - Curve radius at this node
     * @param {number} material - Material ID
     */
    constructor(position, radius = 1.0, material = Materials.WOOD) {
        this.position = position;
        this.radius = radius;
        this.material = material;
        this.connections = []; // Indices of connected nodes
        this.isAnchor = false; // For structural connectivity
    }
}

/**
 * Edge connecting two nodes
 */
export class NetworkEdge {
    /**
     * @param {number} nodeA - Index of start node
     * @param {number} nodeB - Index of end node
     * @param {number[]} controlPoint1 - First control point (optional)
     * @param {number[]} controlPoint2 - Second control point (optional)
     */
    constructor(nodeA, nodeB, controlPoint1 = null, controlPoint2 = null) {
        this.nodeA = nodeA;
        this.nodeB = nodeB;
        this.controlPoint1 = controlPoint1;
        this.controlPoint2 = controlPoint2;
        this.material = Materials.WOOD;
    }
}

// ============================================================================
// LINE NETWORK
// ============================================================================

/**
 * Network of connected curves for voxelization
 */
export class LineNetwork {
    constructor() {
        this.nodes = [];
        this.edges = [];
        this.curves = []; // Generated CubicBezier curves
        this.dirty = true;
    }
    
    /**
     * Add a node to the network
     * @param {number[]} position 
     * @param {number} radius 
     * @param {number} material 
     * @returns {number} Node index
     */
    addNode(position, radius = 1.0, material = Materials.WOOD) {
        const idx = this.nodes.length;
        this.nodes.push(new NetworkNode(position, radius, material));
        this.dirty = true;
        return idx;
    }
    
    /**
     * Connect two nodes with a curve
     * @param {number} nodeA 
     * @param {number} nodeB 
     * @param {number[]} cp1 - Optional control point 1
     * @param {number[]} cp2 - Optional control point 2
     * @returns {number} Edge index
     */
    connect(nodeA, nodeB, cp1 = null, cp2 = null) {
        const idx = this.edges.length;
        const edge = new NetworkEdge(nodeA, nodeB, cp1, cp2);
        this.edges.push(edge);
        
        // Update node connections
        this.nodes[nodeA].connections.push(nodeB);
        this.nodes[nodeB].connections.push(nodeA);
        
        this.dirty = true;
        return idx;
    }
    
    /**
     * Build Bezier curves from network
     */
    buildCurves() {
        this.curves = [];
        
        for (const edge of this.edges) {
            const nodeA = this.nodes[edge.nodeA];
            const nodeB = this.nodes[edge.nodeB];
            
            let curve;
            
            if (edge.controlPoint1 && edge.controlPoint2) {
                // Use explicit control points
                curve = new CubicBezier(
                    nodeA.position,
                    edge.controlPoint1,
                    edge.controlPoint2,
                    nodeB.position,
                    (nodeA.radius + nodeB.radius) / 2
                );
            } else {
                // Auto-generate control points for smooth curve
                const dir = [
                    nodeB.position[0] - nodeA.position[0],
                    nodeB.position[1] - nodeA.position[1],
                    nodeB.position[2] - nodeA.position[2],
                ];
                const len = Math.sqrt(dir[0]**2 + dir[1]**2 + dir[2]**2);
                const t = len / 3;
                
                const cp1 = [
                    nodeA.position[0] + dir[0] * 0.33,
                    nodeA.position[1] + dir[1] * 0.33,
                    nodeA.position[2] + dir[2] * 0.33,
                ];
                const cp2 = [
                    nodeA.position[0] + dir[0] * 0.67,
                    nodeA.position[1] + dir[1] * 0.67,
                    nodeB.position[2] + dir[2] * 0.67,
                ];
                
                curve = new CubicBezier(
                    nodeA.position, cp1, cp2, nodeB.position,
                    (nodeA.radius + nodeB.radius) / 2
                );
            }
            
            // Store material info
            curve.material = edge.material || nodeA.material;
            curve.startRadius = nodeA.radius;
            curve.endRadius = nodeB.radius;
            
            this.curves.push(curve);
        }
        
        this.dirty = false;
    }
    
    /**
     * Get all curves (builds if dirty)
     * @returns {CubicBezier[]}
     */
    getCurves() {
        if (this.dirty) {
            this.buildCurves();
        }
        return this.curves;
    }
    
    /**
     * Compute distance from point to network
     * @param {number[]} point 
     * @param {number} blendRadius - Smooth blending at junctions
     * @returns {number}
     */
    distanceAt(point, blendRadius = DEFAULT_BLEND_RADIUS) {
        const curves = this.getCurves();
        if (curves.length === 0) return Infinity;
        
        let result = bezierDistanceCapsule(point, curves[0], 16).distance;
        
        for (let i = 1; i < curves.length; i++) {
            const dist = bezierDistanceCapsule(point, curves[i], 16).distance;
            result = smin(result, dist, blendRadius);
        }
        
        return result;
    }
    
    /**
     * Get bounding box of network
     * @returns {{ min: number[], max: number[] }}
     */
    getBoundingBox() {
        if (this.nodes.length === 0) {
            return { min: [0, 0, 0], max: [0, 0, 0] };
        }
        
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        
        for (const node of this.nodes) {
            for (let i = 0; i < 3; i++) {
                min[i] = Math.min(min[i], node.position[i] - node.radius);
                max[i] = Math.max(max[i], node.position[i] + node.radius);
            }
        }
        
        return { min, max };
    }
}

// ============================================================================
// VOXELIZER
// ============================================================================

/**
 * Convert line network to voxel density field
 */
export class LineToVoxelizer {
    /**
     * @param {Object} options 
     */
    constructor(options = {}) {
        this.resolution = options.resolution ?? DEFAULT_RESOLUTION;
        this.blendRadius = options.blendRadius ?? DEFAULT_BLEND_RADIUS;
        this.padding = options.padding ?? 2;
    }
    
    /**
     * Generate density field from network
     * @param {LineNetwork} network 
     * @param {Object} bounds - Optional explicit bounds { min, max }
     * @returns {{ density: Float32Array, materials: Uint8Array, size: number[] }}
     */
    voxelize(network, bounds = null) {
        const curves = network.getCurves();
        
        // Compute bounds
        if (!bounds) {
            bounds = network.getBoundingBox();
            // Add padding
            for (let i = 0; i < 3; i++) {
                bounds.min[i] -= this.padding;
                bounds.max[i] += this.padding;
            }
        }
        
        const size = [
            Math.ceil(bounds.max[0] - bounds.min[0]),
            Math.ceil(bounds.max[1] - bounds.min[1]),
            Math.ceil(bounds.max[2] - bounds.min[2]),
        ];
        
        const totalVoxels = size[0] * size[1] * size[2];
        const density = new Float32Array(totalVoxels);
        const materials = new Uint8Array(totalVoxels);
        
        // Generate density field
        let idx = 0;
        for (let z = 0; z < size[2]; z++) {
            for (let y = 0; y < size[1]; y++) {
                for (let x = 0; x < size[0]; x++) {
                    const worldPos = [
                        bounds.min[0] + x + 0.5,
                        bounds.min[1] + y + 0.5,
                        bounds.min[2] + z + 0.5,
                    ];
                    
                    // Find closest curve and distance
                    let minDist = Infinity;
                    let closestMaterial = Materials.AIR;
                    
                    for (const curve of curves) {
                        const { distance } = bezierDistanceCapsule(worldPos, curve, 16);
                        if (distance < minDist) {
                            minDist = distance;
                            closestMaterial = curve.material || Materials.WOOD;
                        }
                    }
                    
                    // Convert distance to density (negative = inside)
                    // For MC: positive = solid, negative = air
                    density[idx] = -minDist;
                    materials[idx] = minDist < 0 ? closestMaterial : Materials.AIR;
                    
                    idx++;
                }
            }
        }
        
        return { density, materials, size, bounds };
    }
    
    /**
     * Generate density at single point
     * @param {LineNetwork} network 
     * @param {number[]} point 
     * @returns {number}
     */
    densityAt(network, point) {
        return -network.distanceAt(point, this.blendRadius);
    }
}

// ============================================================================
// PROCEDURAL GENERATORS
// ============================================================================

/**
 * Generate a simple tree structure
 * @param {Object} options 
 * @returns {LineNetwork}
 */
export function generateTree(options = {}) {
    const {
        trunkHeight = 10,
        trunkRadius = 1.5,
        branchCount = 5,
        branchLength = 6,
        branchRadius = 0.8,
        seed = 12345,
    } = options;
    
    const network = new LineNetwork();
    
    // Simple seeded random
    let s = seed;
    const random = () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
    };
    
    // Trunk
    const base = network.addNode([0, 0, 0], trunkRadius * 1.2, Materials.BARK);
    const top = network.addNode([0, trunkHeight, 0], trunkRadius * 0.8, Materials.WOOD);
    network.connect(base, top);
    network.nodes[base].isAnchor = true;
    
    // Branches
    for (let i = 0; i < branchCount; i++) {
        const t = 0.4 + random() * 0.5; // Height along trunk
        const y = trunkHeight * t;
        const angle = random() * Math.PI * 2;
        const pitch = Math.PI * 0.1 + random() * Math.PI * 0.3;
        
        const branchStart = network.addNode(
            [0, y, 0],
            branchRadius,
            Materials.WOOD
        );
        
        const dx = Math.cos(angle) * Math.cos(pitch) * branchLength;
        const dy = Math.sin(pitch) * branchLength;
        const dz = Math.sin(angle) * Math.cos(pitch) * branchLength;
        
        const branchEnd = network.addNode(
            [dx, y + dy, dz],
            branchRadius * 0.4,
            Materials.WOOD
        );
        
        // Control points for natural curve
        const cp1 = [dx * 0.3, y + dy * 0.2, dz * 0.3];
        const cp2 = [dx * 0.7, y + dy * 0.6, dz * 0.7];
        
        network.connect(branchStart, branchEnd, cp1, cp2);
    }
    
    return network;
}

/**
 * Generate root system
 * @param {Object} options 
 * @returns {LineNetwork}
 */
export function generateRoots(options = {}) {
    const {
        rootCount = 6,
        rootLength = 8,
        rootRadius = 0.6,
        depth = 5,
        spread = 4,
        seed = 54321,
    } = options;
    
    const network = new LineNetwork();
    
    let s = seed;
    const random = () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
    };
    
    // Central anchor point
    const center = network.addNode([0, 0, 0], rootRadius * 1.5, Materials.WOOD);
    network.nodes[center].isAnchor = true;
    
    // Main roots
    for (let i = 0; i < rootCount; i++) {
        const angle = (i / rootCount) * Math.PI * 2 + random() * 0.3;
        const endX = Math.cos(angle) * spread * (0.8 + random() * 0.4);
        const endZ = Math.sin(angle) * spread * (0.8 + random() * 0.4);
        const endY = -depth * (0.7 + random() * 0.6);
        
        const rootEnd = network.addNode(
            [endX, endY, endZ],
            rootRadius * 0.3,
            Materials.WOOD
        );
        
        // Curved path downward
        const cp1 = [endX * 0.3, -1, endZ * 0.3];
        const cp2 = [endX * 0.7, endY * 0.5, endZ * 0.7];
        
        network.connect(center, rootEnd, cp1, cp2);
    }
    
    return network;
}

/**
 * Generate cave/tunnel network
 * @param {Object} options 
 * @returns {LineNetwork}
 */
export function generateTunnel(options = {}) {
    const {
        startPoint = [0, 0, 0],
        direction = [1, 0, 0],
        length = 50,
        radius = 3,
        waviness = 2,
        segments = 8,
        seed = 99999,
    } = options;
    
    const network = new LineNetwork();
    
    let s = seed;
    const random = () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
    };
    
    // Normalize direction
    const len = Math.sqrt(direction[0]**2 + direction[1]**2 + direction[2]**2);
    const dir = [direction[0]/len, direction[1]/len, direction[2]/len];
    
    // Generate path points
    const points = [startPoint];
    let prevNode = network.addNode(startPoint, radius, Materials.STONE);
    network.nodes[prevNode].isAnchor = true;
    
    for (let i = 1; i <= segments; i++) {
        const t = i / segments;
        const basePos = [
            startPoint[0] + dir[0] * length * t,
            startPoint[1] + dir[1] * length * t,
            startPoint[2] + dir[2] * length * t,
        ];
        
        // Add waviness
        const offset = [
            (random() - 0.5) * waviness * 2,
            (random() - 0.5) * waviness * 2,
            (random() - 0.5) * waviness * 2,
        ];
        
        const pos = [
            basePos[0] + offset[0],
            basePos[1] + offset[1],
            basePos[2] + offset[2],
        ];
        
        const nodeRadius = radius * (0.8 + random() * 0.4);
        const node = network.addNode(pos, nodeRadius, Materials.STONE);
        network.connect(prevNode, node);
        
        prevNode = node;
    }
    
    return network;
}

// ============================================================================
// GPU VOXELIZER
// ============================================================================

/**
 * GPU-accelerated line network voxelizer
 */
export class GPULineVoxelizer {
    /**
     * @param {GPUDevice} device 
     */
    constructor(device) {
        this.device = device;
        this.initialized = false;
        
        this.segmentBuffer = null;
        this.densityBuffer = null;
        this.uniformBuffer = null;
        this.pipeline = null;
        this.bindGroup = null;
    }
    
    /**
     * Initialize GPU resources
     * @param {LineNetwork} network 
     * @param {number[]} gridSize 
     */
    async init(network, gridSize) {
        const curves = network.getCurves();
        const { vertices, radii, segmentCount } = curvesToSegments(curves, 16);
        
        // Segment vertex buffer
        this.segmentBuffer = this.device.createBuffer({
            label: 'Line Segments',
            size: vertices.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(this.segmentBuffer, 0, vertices);
        
        // Radii buffer
        this.radiiBuffer = this.device.createBuffer({
            label: 'Segment Radii',
            size: radii.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(this.radiiBuffer, 0, radii);
        
        // Density output buffer
        const totalVoxels = gridSize[0] * gridSize[1] * gridSize[2];
        this.densityBuffer = this.device.createBuffer({
            label: 'Density Field',
            size: totalVoxels * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        
        // Uniforms
        this.uniformBuffer = this.device.createBuffer({
            label: 'Voxelizer Uniforms',
            size: 32,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        
        const uniformData = new Uint32Array([
            gridSize[0], gridSize[1], gridSize[2],
            segmentCount,
        ]);
        this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);
        
        this.gridSize = gridSize;
        this.segmentCount = segmentCount;
        this.initialized = true;
    }
    
    /**
     * Run voxelization on GPU
     * @returns {GPUCommandBuffer}
     */
    voxelize() {
        if (!this.initialized) {
            throw new Error('GPULineVoxelizer not initialized');
        }
        
        // Would dispatch compute shader here
        // Using bezier_distance.wgsl generateDensityFromSegments
        
        const encoder = this.device.createCommandEncoder();
        // ... dispatch commands
        return encoder.finish();
    }
    
    /**
     * Read back density field
     * @returns {Promise<Float32Array>}
     */
    async readDensity() {
        const totalVoxels = this.gridSize[0] * this.gridSize[1] * this.gridSize[2];
        const readBuffer = this.device.createBuffer({
            size: totalVoxels * 4,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
        
        const encoder = this.device.createCommandEncoder();
        encoder.copyBufferToBuffer(this.densityBuffer, 0, readBuffer, 0, totalVoxels * 4);
        this.device.queue.submit([encoder.finish()]);
        
        await readBuffer.mapAsync(GPUMapMode.READ);
        const data = new Float32Array(readBuffer.getMappedRange().slice(0));
        readBuffer.unmap();
        readBuffer.destroy();
        
        return data;
    }
    
    destroy() {
        this.segmentBuffer?.destroy();
        this.radiiBuffer?.destroy();
        this.densityBuffer?.destroy();
        this.uniformBuffer?.destroy();
        this.initialized = false;
    }
}

export default {
    LineNetwork,
    NetworkNode,
    NetworkEdge,
    LineToVoxelizer,
    GPULineVoxelizer,
    generateTree,
    generateRoots,
    generateTunnel,
    Materials,
};
