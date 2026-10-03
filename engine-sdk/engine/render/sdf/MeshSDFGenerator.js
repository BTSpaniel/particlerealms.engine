// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha


/**
 * MeshSDFGenerator - Hybrid universal mesh SDF system
 * 
 * Automatically generates SDF representations for any mesh:
 * 1. Auto-fit primitives (capsule/sphere/box) for simple meshes - FAST
 * 2. Triangle buffer sampling for complex meshes - FLEXIBLE
 * 3. 3D SDF texture baking for frequently used meshes - QUALITY
 * 
 * Integrates:
 * - MeshDecimation for high-poly mesh simplification
 * - Mesh validation/repair from ModelLoader patterns
 * - Voxelization acceleration for 3D SDF baking
 */

import { decimateQEM, decimateGrid } from '../../sim/physics/MeshDecimation.js';
import { BVHBuilder, createRaycastMesh } from '../../core/math/BVHAccel.js';
import { buildSourceSurfaceBVH } from '../../tools/rigging/SkinWeightTransfer.js';
import { 
    sdfSphere, sdfBox3D, sdfCylinder, sdfCapsule, sdfTorus, sdfCone,
    sdfUnion, sdfSmoothUnion, sdfSmoothIntersect, sdfSmoothSubtract,
    aabbFromPoints, aabbCenter, aabbSize, aabbMerge, aabbGrow,
    boundingSphereFromPoints, sphereAABB, aabbAABB,
    pointInAABB, pointInSphere,
    rayTriangle, rayAABB, raySphere
} from '../../core/math/MathGeometry.js';
import { 
    vec3, vec3Add, vec3Sub, vec3Scale, vec3Dot, vec3Cross, 
    vec3Length, vec3Normalize, quatRotateVec3
} from '../../core/math/EngineMath.js';
import { clamp, lerp, smoothstep, remap } from '../../core/math/MathScalar.js';
import { SpatialHash } from '../../core/math/SpatialHash.js';
import { SDFBakeCompute } from './SDFBakeCompute.js';

// ============================================================================
// MESH VALIDATION & REPAIR (from ModelLoader patterns)
// ============================================================================

/**
 * Validate and repair mesh data - removes invalid vertices and degenerate triangles
 */
export function validateMesh(positions, indices) {
    if (!positions || positions.length < 9) {
        return { positions: new Float32Array(0), indices: null, valid: false };
    }
    
    const vertexCount = Math.floor(positions.length / 3);
    const invalidVertex = new Uint8Array(vertexCount);
    let anyInvalid = false;
    
    // Check for NaN/Infinity vertices
    for (let i = 0; i < vertexCount; i++) {
        const o = i * 3;
        if (!Number.isFinite(positions[o]) || 
            !Number.isFinite(positions[o + 1]) || 
            !Number.isFinite(positions[o + 2])) {
            invalidVertex[i] = 1;
            anyInvalid = true;
        }
    }
    
    // Generate indices if not provided
    if (!indices) {
        const triVertexCount = vertexCount - (vertexCount % 3);
        indices = new Uint32Array(triVertexCount);
        for (let i = 0; i < triVertexCount; i++) indices[i] = i;
    }
    
    // Filter invalid triangles
    if (anyInvalid || indices) {
        const filtered = new Uint32Array(indices.length);
        let out = 0;
        for (let i = 0; i + 2 < indices.length; i += 3) {
            const a = indices[i], b = indices[i + 1], c = indices[i + 2];
            if (a >= vertexCount || b >= vertexCount || c >= vertexCount) continue;
            if (anyInvalid && (invalidVertex[a] || invalidVertex[b] || invalidVertex[c])) continue;
            // Skip degenerate triangles
            if (a === b || b === c || a === c) continue;
            filtered[out++] = a;
            filtered[out++] = b;
            filtered[out++] = c;
        }
        indices = filtered.slice(0, out);
    }
    
    return {
        positions: positions instanceof Float32Array ? positions : new Float32Array(positions),
        indices: indices instanceof Uint32Array ? indices : new Uint32Array(indices),
        valid: indices.length >= 3
    };
}

/**
 * Simplify high-poly mesh for faster SDF generation
 */
export function simplifyMesh(positions, indices, targetTriangles = 1000) {
    const currentTriangles = indices ? indices.length / 3 : positions.length / 9;
    
    if (currentTriangles <= targetTriangles) {
        return { positions, indices }; // Already simple enough
    }
    
    const targetRatio = targetTriangles / currentTriangles;
    
    // Use QEM for quality, grid for speed
    if (currentTriangles > 10000) {
        // Very high poly - use fast grid decimation first, then QEM
        const gridResult = decimateGrid(
            Array.from(positions), 
            indices ? Array.from(indices) : null, 
            0.02
        );
        if (gridResult.vertices.length / 3 > targetTriangles * 3) {
            const qemResult = decimateQEM(gridResult.vertices, gridResult.indices, targetRatio);
            return {
                positions: new Float32Array(qemResult.vertices),
                indices: new Uint32Array(qemResult.indices)
            };
        }
        return {
            positions: new Float32Array(gridResult.vertices),
            indices: new Uint32Array(gridResult.indices)
        };
    }
    
    // Medium poly - use QEM directly
    const result = decimateQEM(
        Array.from(positions),
        indices ? Array.from(indices) : null,
        targetRatio
    );
    
    return {
        positions: new Float32Array(result.vertices),
        indices: new Uint32Array(result.indices)
    };
}

// ============================================================================
// SDF TYPE CONSTANTS
// ============================================================================

// SDF type constants
export const SDF_TYPE = {
    SPHERE: 0,
    BOX: 1,
    CYLINDER: 2,
    CAPSULE: 3,
    TORUS: 4,
    // Dynamic types start at 100
    MESH_TRIANGLES: 100,
    MESH_BAKED_3D: 101,
};

/**
 * Analyze mesh and determine best SDF approach
 */
export function analyzeMesh(positions, indices) {
    const vertexCount = positions.length / 3;
    const triangleCount = indices ? indices.length / 3 : vertexCount / 3;
    
    // Compute bounds
    const bounds = computeBounds(positions);
    const size = [
        bounds.max[0] - bounds.min[0],
        bounds.max[1] - bounds.min[1],
        bounds.max[2] - bounds.min[2]
    ];
    const center = [
        (bounds.max[0] + bounds.min[0]) / 2,
        (bounds.max[1] + bounds.min[1]) / 2,
        (bounds.max[2] + bounds.min[2]) / 2
    ];
    
    // Compute aspect ratios
    const maxDim = Math.max(...size);
    const minDim = Math.min(...size);
    const aspectRatio = maxDim / Math.max(minDim, 0.001);
    
    // Determine dominant axis (for capsule fitting)
    let dominantAxis = 1; // Y by default
    if (size[0] >= size[1] && size[0] >= size[2]) dominantAxis = 0;
    else if (size[2] >= size[0] && size[2] >= size[1]) dominantAxis = 2;
    
    // Determine which axis is smallest (for disc detection)
    let minAxis = 1;
    if (size[0] <= size[1] && size[0] <= size[2]) minAxis = 0;
    else if (size[2] <= size[0] && size[2] <= size[1]) minAxis = 2;
    
    // Disc-like: one axis much smaller than the other two similar axes
    const sortedSizes = [...size].sort((a, b) => a - b);
    const isDisc = sortedSizes[0] / sortedSizes[1] < 0.5 && sortedSizes[1] / sortedSizes[2] > 0.7;
    
    // Detect hollow/tube shapes by analyzing vertex distribution
    const hollowInfo = detectHollowMesh(positions, indices, center, size, dominantAxis);
    
    return {
        vertexCount,
        triangleCount,
        bounds,
        size,
        center,
        aspectRatio,
        dominantAxis,
        minAxis,
        isSimple: triangleCount < 100,
        isElongated: aspectRatio > 2.5 && !isDisc,
        isFlat: minDim / maxDim < 0.15,
        isDisc,
        isHollow: hollowInfo.isHollow,
        isTube: hollowInfo.isTube,
        hollowRadius: hollowInfo.innerRadius,
        outerRadius: hollowInfo.outerRadius,
        wallThickness: hollowInfo.wallThickness,
    };
}

/**
 * Detect if mesh is hollow (tube, cylinder with hole, torus-like)
 * Analyzes vertex positions to find inner/outer radii
 */
function detectHollowMesh(positions, indices, center, size, dominantAxis) {
    const vertexCount = positions.length / 3;
    if (vertexCount < 8) {
        return { isHollow: false, isTube: false };
    }
    
    // Sample vertices and compute distance from center axis
    const radialDistances = [];
    const axisDistances = [];
    
    for (let i = 0; i < positions.length; i += 3) {
        let radialDist, axisDist;
        
        if (dominantAxis === 0) { // X axis
            radialDist = Math.sqrt(
                Math.pow(positions[i + 1] - center[1], 2) + 
                Math.pow(positions[i + 2] - center[2], 2)
            );
            axisDist = positions[i] - center[0];
        } else if (dominantAxis === 2) { // Z axis
            radialDist = Math.sqrt(
                Math.pow(positions[i] - center[0], 2) + 
                Math.pow(positions[i + 1] - center[1], 2)
            );
            axisDist = positions[i + 2] - center[2];
        } else { // Y axis (default)
            radialDist = Math.sqrt(
                Math.pow(positions[i] - center[0], 2) + 
                Math.pow(positions[i + 2] - center[2], 2)
            );
            axisDist = positions[i + 1] - center[1];
        }
        
        radialDistances.push(radialDist);
        axisDistances.push(axisDist);
    }
    
    // Find min/max radial distances
    const minRadial = Math.min(...radialDistances);
    const maxRadial = Math.max(...radialDistances);
    
    // Build histogram of radial distances to detect bimodal distribution (inner/outer)
    const buckets = 20;
    const bucketSize = (maxRadial - minRadial) / buckets;
    const histogram = new Array(buckets).fill(0);
    
    for (const r of radialDistances) {
        const bucket = Math.min(buckets - 1, Math.floor((r - minRadial) / bucketSize));
        histogram[bucket]++;
    }
    
    // Look for gap in histogram (indicates hollow center)
    let gapStart = -1, gapEnd = -1;
    let inGap = false;
    const threshold = vertexCount / (buckets * 3); // Low vertex count threshold
    
    for (let i = 0; i < buckets; i++) {
        if (histogram[i] < threshold && !inGap) {
            gapStart = i;
            inGap = true;
        } else if (histogram[i] >= threshold && inGap) {
            gapEnd = i;
            inGap = false;
            break;
        }
    }
    
    // Check if there's a significant hollow center
    const hasHole = minRadial > maxRadial * 0.15; // Inner radius > 15% of outer
    const hasGap = gapStart >= 0 && gapEnd > gapStart;
    const isHollow = hasHole || hasGap;
    
    // Detect tube (elongated hollow cylinder)
    const axisExtent = Math.max(...axisDistances) - Math.min(...axisDistances);
    const radialExtent = maxRadial - minRadial;
    const isTube = isHollow && axisExtent > radialExtent * 1.5;
    
    // Calculate wall thickness
    let innerRadius = minRadial;
    let outerRadius = maxRadial;
    
    if (hasGap) {
        innerRadius = minRadial + gapStart * bucketSize;
        outerRadius = minRadial + gapEnd * bucketSize;
    }
    
    const wallThickness = outerRadius - innerRadius;
    
    return {
        isHollow,
        isTube,
        innerRadius,
        outerRadius,
        wallThickness,
        axisExtent,
    };
}

/**
 * Compute axis-aligned bounding box
 */
export function computeBounds(positions) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    
    for (let i = 0; i < positions.length; i += 3) {
        min[0] = Math.min(min[0], positions[i]);
        min[1] = Math.min(min[1], positions[i + 1]);
        min[2] = Math.min(min[2], positions[i + 2]);
        max[0] = Math.max(max[0], positions[i]);
        max[1] = Math.max(max[1], positions[i + 1]);
        max[2] = Math.max(max[2], positions[i + 2]);
    }
    
    return { min, max };
}

/**
 * Auto-fit best primitive shape to mesh
 */
export function fitPrimitive(positions, indices) {
    const analysis = analyzeMesh(positions, indices);
    const { bounds, size, center, aspectRatio, dominantAxis, minAxis, isElongated, isFlat, isDisc,
            isHollow, isTube, hollowRadius, outerRadius, wallThickness } = analysis;
    
    // Hollow tube/cylinder -> use hollow cylinder SDF
    if (isHollow && (isTube || isDisc)) {
        const halfHeight = size[dominantAxis] / 2;
        // midRadius for hollow cylinder visualization
        const midRadius = (hollowRadius + outerRadius) / 2;
        
        return {
            type: 'cylinder',
            typeId: SDF_TYPE.CYLINDER,
            params: [midRadius, halfHeight, 0, 0], // r, h for hollow cylinder
            center,
            quality: 0.85,
            isHollow: true,
            innerRadius: hollowRadius,
            outerRadius: outerRadius,
            wallThickness,
        };
    }
    
    // Hollow ring/torus-like
    if (isHollow && !isTube && !isDisc) {
        const majorRadius = (hollowRadius + outerRadius) / 2;
        const minorRadius = wallThickness / 2;
        
        return {
            type: 'torus',
            typeId: SDF_TYPE.TORUS,
            params: [majorRadius, minorRadius, 0, 0],
            center,
            quality: 0.8,
            isHollow: true,
        };
    }
    
    // Disc-like mesh (gear, star, coin) -> cylinder
    if (isDisc) {
        const halfHeight = size[minAxis] / 2;
        const otherSizes = size.filter((_, i) => i !== minAxis);
        const radius = Math.max(...otherSizes) / 2;
        
        return {
            type: 'cylinder',
            typeId: SDF_TYPE.CYLINDER,
            params: [radius, halfHeight, 0, 0],
            center,
            quality: 0.75,
        };
    }
    
    // Flat mesh -> box
    if (isFlat) {
        return {
            type: 'box',
            typeId: SDF_TYPE.BOX,
            params: [size[0] / 2, size[1] / 2, size[2] / 2, 0],
            center,
            quality: 0.7,
        };
    }
    
    // Elongated mesh -> capsule
    if (isElongated) {
        const axisSize = size[dominantAxis];
        const otherSizes = size.filter((_, i) => i !== dominantAxis);
        const radius = Math.max(...otherSizes) / 2;
        const halfHeight = (axisSize / 2) - radius;
        
        return {
            type: 'capsule',
            typeId: SDF_TYPE.CAPSULE,
            params: [radius, Math.max(0, halfHeight), dominantAxis, 0],
            center,
            quality: 0.8,
            dominantAxis,
        };
    }
    
    // Check sphericity - sample vertices and measure distance from center
    const sphericity = computeSphericity(positions, center);
    
    // Sphere-like mesh
    if (sphericity > 0.85) {
        const radius = Math.max(...size) / 2;
        return {
            type: 'sphere',
            typeId: SDF_TYPE.SPHERE,
            params: [radius, 0, 0, 0],
            center,
            quality: sphericity,
        };
    }
    
    // Default to box
    return {
        type: 'box',
        typeId: SDF_TYPE.BOX,
        params: [size[0] / 2, size[1] / 2, size[2] / 2, 0],
        center,
        quality: 0.6,
    };
}

/**
 * Compute how sphere-like a mesh is (0-1)
 */
function computeSphericity(positions, center) {
    if (positions.length < 9) return 0;
    
    // Compute average distance from center
    let totalDist = 0;
    const vertexCount = positions.length / 3;
    
    for (let i = 0; i < positions.length; i += 3) {
        const dx = positions[i] - center[0];
        const dy = positions[i + 1] - center[1];
        const dz = positions[i + 2] - center[2];
        totalDist += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    
    const avgDist = totalDist / vertexCount;
    if (avgDist < 0.001) return 0;
    
    // Compute variance of distance
    let variance = 0;
    for (let i = 0; i < positions.length; i += 3) {
        const dx = positions[i] - center[0];
        const dy = positions[i + 1] - center[1];
        const dz = positions[i + 2] - center[2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        variance += (dist - avgDist) * (dist - avgDist);
    }
    variance /= vertexCount;
    
    // Sphericity = 1 - normalized standard deviation
    const stdDev = Math.sqrt(variance);
    return Math.max(0, 1 - (stdDev / avgDist));
}

/**
 * Fit multiple capsules to a mesh (for ragdoll bodies)
 */
export function fitCapsules(positions, indices, maxCapsules = 8) {
    const analysis = analyzeMesh(positions, indices);
    const capsules = [];
    
    // Simple case: single capsule
    if (analysis.isElongated || analysis.triangleCount < 50) {
        const fit = fitPrimitive(positions, indices);
        if (fit.type === 'capsule') {
            capsules.push(fit);
            return capsules;
        }
    }
    
    // For complex meshes, use K-means clustering along dominant axis
    const { dominantAxis, bounds, size } = analysis;
    const segments = Math.min(maxCapsules, Math.ceil(size[dominantAxis] / 0.3));
    
    // Segment vertices along dominant axis
    const segmentSize = size[dominantAxis] / segments;
    const segmentVertices = Array.from({ length: segments }, () => []);
    
    for (let i = 0; i < positions.length; i += 3) {
        const axisPos = positions[i + dominantAxis];
        const segIdx = Math.min(
            segments - 1,
            Math.floor((axisPos - bounds.min[dominantAxis]) / segmentSize)
        );
        segmentVertices[segIdx].push([
            positions[i],
            positions[i + 1],
            positions[i + 2]
        ]);
    }
    
    // Fit capsule to each segment
    for (let s = 0; s < segments; s++) {
        const verts = segmentVertices[s];
        if (verts.length < 3) continue;
        
        // Compute segment center and radius
        let cx = 0, cy = 0, cz = 0;
        for (const v of verts) {
            cx += v[0]; cy += v[1]; cz += v[2];
        }
        cx /= verts.length; cy /= verts.length; cz /= verts.length;
        
        // Compute max distance from axis
        let maxRadius = 0;
        for (const v of verts) {
            const offsets = [v[0] - cx, v[1] - cy, v[2] - cz];
            offsets[dominantAxis] = 0;
            const dist = Math.sqrt(offsets[0] ** 2 + offsets[1] ** 2 + offsets[2] ** 2);
            maxRadius = Math.max(maxRadius, dist);
        }
        
        const segmentStart = bounds.min[dominantAxis] + s * segmentSize;
        const segmentEnd = segmentStart + segmentSize;
        const halfHeight = (segmentEnd - segmentStart) / 2;
        
        capsules.push({
            type: 'capsule',
            typeId: SDF_TYPE.CAPSULE,
            params: [maxRadius, halfHeight, dominantAxis, 0],
            center: [cx, cy, cz],
            quality: 0.7,
        });
    }
    
    return capsules;
}

/**
 * Generate triangle buffer data for GPU SDF sampling
 */
export function generateTriangleBuffer(positions, indices) {
    const triangles = [];
    
    if (indices) {
        for (let i = 0; i < indices.length; i += 3) {
            const i0 = indices[i] * 3;
            const i1 = indices[i + 1] * 3;
            const i2 = indices[i + 2] * 3;
            
            triangles.push(
                positions[i0], positions[i0 + 1], positions[i0 + 2], 0,
                positions[i1], positions[i1 + 1], positions[i1 + 2], 0,
                positions[i2], positions[i2 + 1], positions[i2 + 2], 0
            );
        }
    } else {
        for (let i = 0; i < positions.length; i += 9) {
            triangles.push(
                positions[i], positions[i + 1], positions[i + 2], 0,
                positions[i + 3], positions[i + 4], positions[i + 5], 0,
                positions[i + 6], positions[i + 7], positions[i + 8], 0
            );
        }
    }
    
    return new Float32Array(triangles);
}

/**
 * Bake 3D SDF texture from mesh using BVH acceleration
 */
export function bakeSDF3D(positions, indices, resolution = 32) {
    const bounds = computeBounds(positions);
    const padding = 0.1;
    
    // Expand bounds slightly
    const min = bounds.min.map(v => v - padding);
    const max = bounds.max.map(v => v + padding);
    const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    
    // Build triangle list with BVH for acceleration
    const triangles = [];
    const triBounds = []; // AABB per triangle for BVH queries
    
    if (indices) {
        for (let i = 0; i < indices.length; i += 3) {
            const i0 = indices[i] * 3, i1 = indices[i + 1] * 3, i2 = indices[i + 2] * 3;
            const v0 = [positions[i0], positions[i0 + 1], positions[i0 + 2]];
            const v1 = [positions[i1], positions[i1 + 1], positions[i1 + 2]];
            const v2 = [positions[i2], positions[i2 + 1], positions[i2 + 2]];
            triangles.push([v0, v1, v2]);
            triBounds.push(aabbFromPoints([v0, v1, v2]));
        }
    } else {
        for (let i = 0; i < positions.length; i += 9) {
            const v0 = [positions[i], positions[i + 1], positions[i + 2]];
            const v1 = [positions[i + 3], positions[i + 4], positions[i + 5]];
            const v2 = [positions[i + 6], positions[i + 7], positions[i + 8]];
            triangles.push([v0, v1, v2]);
            triBounds.push(aabbFromPoints([v0, v1, v2]));
        }
    }
    
    // Build spatial grid for faster neighbor queries
    const cellSize = Math.max(...size) / 8;
    const triGrid = buildTriangleGrid(triangles, triBounds, min, size, cellSize);
    
    // Generate SDF grid
    const sdfData = new Float32Array(resolution * resolution * resolution);
    
    // Check if mesh is watertight (closed) by testing a point far outside
    const testPoint = [min[0] - size[0] * 10, min[1], min[2]];
    const meshIsClosed = !isPointInsideMesh(testPoint, triangles);
    
    console.log(`[bakeSDF3D] Baking ${resolution}^3 SDF, triangles: ${triangles.length}, closed: ${meshIsClosed}`);
    
    let insideCount = 0;
    for (let z = 0; z < resolution; z++) {
        for (let y = 0; y < resolution; y++) {
            for (let x = 0; x < resolution; x++) {
                const px = min[0] + (x + 0.5) / resolution * size[0];
                const py = min[1] + (y + 0.5) / resolution * size[1];
                const pz = min[2] + (z + 0.5) / resolution * size[2];
                
                // Find closest distance using spatial grid
                const minDist = findClosestDistanceGrid([px, py, pz], triangles, triGrid, min, cellSize);
                
                // Sign determination - only for closed meshes
                let inside = false;
                if (meshIsClosed) {
                    inside = isPointInsideMesh([px, py, pz], triangles);
                    if (inside) insideCount++;
                }
                
                const idx = x + y * resolution + z * resolution * resolution;
                // For open meshes, use small negative offset to create thin shell
                sdfData[idx] = inside ? -minDist : (meshIsClosed ? minDist : minDist - 0.02);
            }
        }
    }
    
    console.log(`[bakeSDF3D] Complete. Inside voxels: ${insideCount}/${resolution**3}`);
    
    // Apply 3x3x3 box blur to smooth SDF and reduce artifacts
    const smoothedData = new Float32Array(sdfData.length);
    for (let z = 0; z < resolution; z++) {
        for (let y = 0; y < resolution; y++) {
            for (let x = 0; x < resolution; x++) {
                let sum = 0, count = 0;
                for (let dz = -1; dz <= 1; dz++) {
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            const nx = x + dx, ny = y + dy, nz = z + dz;
                            if (nx >= 0 && nx < resolution && ny >= 0 && ny < resolution && nz >= 0 && nz < resolution) {
                                sum += sdfData[nx + ny * resolution + nz * resolution * resolution];
                                count++;
                            }
                        }
                    }
                }
                smoothedData[x + y * resolution + z * resolution * resolution] = sum / count;
            }
        }
    }
    
    return {
        data: smoothedData,
        resolution,
        min,
        max,
        size,
    };
}

// GPU baker instance (lazy initialized)
let gpuBaker = null;

/**
 * Initialize GPU SDF baker
 * @param {GPUDevice} device - WebGPU device
 */
export async function initGPUBaker(device) {
    if (!gpuBaker && device) {
        gpuBaker = new SDFBakeCompute(device);
        await gpuBaker.initialize();
        console.log('[MeshSDFGenerator] GPU SDF baker initialized');
    }
    return gpuBaker;
}

/**
 * Check if GPU baking is available
 */
export function hasGPUBaker() {
    return gpuBaker !== null && gpuBaker.initialized;
}

/**
 * Bake 3D SDF texture using GPU compute (~100x faster)
 * Falls back to CPU if GPU not available
 */
export async function bakeSDF3DGPU(positions, indices, resolution = 32) {
    const bounds = computeBounds(positions);
    const padding = 0.1;
    
    const min = bounds.min.map(v => v - padding);
    const max = bounds.max.map(v => v + padding);
    const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    
    // Use GPU if available
    if (gpuBaker && gpuBaker.initialized) {
        const gpuIndices = indices instanceof Uint32Array ? indices : new Uint32Array(indices);
        const gpuPositions = positions instanceof Float32Array ? positions : new Float32Array(positions);
        
        const data = await gpuBaker.bake(gpuPositions, gpuIndices, resolution, { min, max });
        
        return {
            data,
            resolution,
            min,
            max,
            size,
            gpuAccelerated: true,
        };
    }
    
    // Fallback to CPU
    console.log('[MeshSDFGenerator] GPU baker not available, using CPU fallback');
    return bakeSDF3D(positions, indices, resolution);
}

/**
 * Build spatial grid for triangles
 */
function buildTriangleGrid(triangles, triBounds, worldMin, worldSize, cellSize) {
    const gridSize = [
        Math.ceil(worldSize[0] / cellSize),
        Math.ceil(worldSize[1] / cellSize),
        Math.ceil(worldSize[2] / cellSize)
    ];
    const grid = new Map();
    
    for (let i = 0; i < triangles.length; i++) {
        const tb = triBounds[i];
        const minCell = [
            Math.floor((tb.min[0] - worldMin[0]) / cellSize),
            Math.floor((tb.min[1] - worldMin[1]) / cellSize),
            Math.floor((tb.min[2] - worldMin[2]) / cellSize)
        ];
        const maxCell = [
            Math.floor((tb.max[0] - worldMin[0]) / cellSize),
            Math.floor((tb.max[1] - worldMin[1]) / cellSize),
            Math.floor((tb.max[2] - worldMin[2]) / cellSize)
        ];
        
        for (let z = minCell[2]; z <= maxCell[2]; z++) {
            for (let y = minCell[1]; y <= maxCell[1]; y++) {
                for (let x = minCell[0]; x <= maxCell[0]; x++) {
                    const key = `${x},${y},${z}`;
                    if (!grid.has(key)) grid.set(key, []);
                    grid.get(key).push(i);
                }
            }
        }
    }
    
    return { grid, gridSize, cellSize };
}

/**
 * Find closest distance using spatial grid
 */
function findClosestDistanceGrid(p, triangles, triGrid, worldMin, cellSize) {
    const { grid } = triGrid;
    const cellX = Math.floor((p[0] - worldMin[0]) / cellSize);
    const cellY = Math.floor((p[1] - worldMin[1]) / cellSize);
    const cellZ = Math.floor((p[2] - worldMin[2]) / cellSize);
    
    let minDist = Infinity;
    const checked = new Set();
    
    // Search expanding shell of cells
    for (let radius = 0; radius <= 3 && minDist > radius * cellSize; radius++) {
        for (let dz = -radius; dz <= radius; dz++) {
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    if (Math.abs(dx) !== radius && Math.abs(dy) !== radius && Math.abs(dz) !== radius) continue;
                    
                    const key = `${cellX + dx},${cellY + dy},${cellZ + dz}`;
                    const tris = grid.get(key);
                    if (!tris) continue;
                    
                    for (const i of tris) {
                        if (checked.has(i)) continue;
                        checked.add(i);
                        const d = pointToTriangleDistance(p, triangles[i]);
                        minDist = Math.min(minDist, d);
                    }
                }
            }
        }
    }
    
    // Fallback to full search if grid didn't find anything close
    if (minDist === Infinity) {
        for (let i = 0; i < triangles.length; i++) {
            const d = pointToTriangleDistance(p, triangles[i]);
            minDist = Math.min(minDist, d);
        }
    }
    
    return minDist;
}

/**
 * Point to triangle distance
 */
function pointToTriangleDistance(p, tri) {
    const [a, b, c] = tri;
    
    // Edge vectors
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    
    const d1 = dot(ab, ap);
    const d2 = dot(ac, ap);
    if (d1 <= 0 && d2 <= 0) return dist(p, a);
    
    const bp = [p[0] - b[0], p[1] - b[1], p[2] - b[2]];
    const d3 = dot(ab, bp);
    const d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) return dist(p, b);
    
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        return dist(p, [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]]);
    }
    
    const cp = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    const d5 = dot(ab, cp);
    const d6 = dot(ac, cp);
    if (d6 >= 0 && d5 <= d6) return dist(p, c);
    
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
        const w = d2 / (d2 - d6);
        return dist(p, [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]]);
    }
    
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
        const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
        const bc = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
        return dist(p, [b[0] + w * bc[0], b[1] + w * bc[1], b[2] + w * bc[2]]);
    }
    
    const denom = 1 / (va + vb + vc);
    const v = vb * denom;
    const w = vc * denom;
    return dist(p, [
        a[0] + ab[0] * v + ac[0] * w,
        a[1] + ab[1] * v + ac[1] * w,
        a[2] + ab[2] * v + ac[2] * w
    ]);
}

function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function dist(a, b) { 
    const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Ray casting to determine inside/outside
 */
function isPointInsideMesh(p, triangles) {
    let crossings = 0;
    const rayDir = [1, 0.0001, 0.0001]; // Slight offset to avoid edge cases
    
    for (const tri of triangles) {
        if (rayTriangleIntersect(p, rayDir, tri)) {
            crossings++;
        }
    }
    
    return (crossings % 2) === 1;
}

function rayTriangleIntersect(origin, dir, tri) {
    const [a, b, c] = tri;
    const edge1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const edge2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    
    const h = cross(dir, edge2);
    const det = dot(edge1, h);
    
    if (Math.abs(det) < 1e-8) return false;
    
    const f = 1 / det;
    const s = [origin[0] - a[0], origin[1] - a[1], origin[2] - a[2]];
    const u = f * dot(s, h);
    
    if (u < 0 || u > 1) return false;
    
    const q = cross(s, edge1);
    const v = f * dot(dir, q);
    
    if (v < 0 || u + v > 1) return false;
    
    const t = f * dot(edge2, q);
    return t > 0;
}

function cross(a, b) {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ];
}

/**
 * Generate hybrid SDF for a mesh - automatically chooses best approach
 * Now with mesh validation, simplification, and voxel acceleration
 */
export function generateMeshSDF(positions, indices, options = {}) {
    const {
        maxTrianglesForPrimitive = 200,
        maxTrianglesForTriangleBuffer = 5000,
        bakingResolution = 32,
        forceMethod = null, // 'primitive', 'triangles', 'baked'
        validate = true,
        simplify = true,
        simplifyTarget = 2000, // Max triangles for triangle buffer / baking
    } = options;
    
    // Step 1: Validate mesh
    let validPositions = positions;
    let validIndices = indices;
    if (validate) {
        const validated = validateMesh(positions, indices);
        if (!validated.valid) {
            // Return fallback box for invalid mesh
            return {
                method: 'primitive',
                primitive: { type: 'box', typeId: SDF_TYPE.BOX, params: [0.5, 0.5, 0.5, 0], center: [0, 0, 0], quality: 0 },
                analysis: { vertexCount: 0, triangleCount: 0, bounds: { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] } },
                wasInvalid: true,
            };
        }
        validPositions = validated.positions;
        validIndices = validated.indices;
    }
    
    const analysis = analyzeMesh(validPositions, validIndices);
    
    // Determine method
    let method = forceMethod;
    if (!method) {
        if (analysis.triangleCount <= maxTrianglesForPrimitive) {
            method = 'primitive';
        } else if (analysis.triangleCount <= maxTrianglesForTriangleBuffer) {
            method = 'triangles';
        } else {
            method = 'baked';
        }
    }
    
    // Step 2: Simplify for triangle buffer or baking
    let processedPositions = validPositions;
    let processedIndices = validIndices;
    let wasSimplified = false;
    
    if (simplify && (method === 'triangles' || method === 'baked') && analysis.triangleCount > simplifyTarget) {
        const simplified = simplifyMesh(validPositions, validIndices, simplifyTarget);
        processedPositions = simplified.positions;
        processedIndices = simplified.indices;
        wasSimplified = true;
    }
    
    const result = {
        method,
        analysis,
        wasSimplified,
        originalTriangles: analysis.triangleCount,
        processedTriangles: processedIndices ? processedIndices.length / 3 : processedPositions.length / 9,
    };
    
    switch (method) {
        case 'primitive':
            result.primitive = fitPrimitive(validPositions, validIndices);
            break;
            
        case 'triangles':
            result.triangleBuffer = generateTriangleBuffer(processedPositions, processedIndices);
            result.triangleCount = result.processedTriangles;
            result.bounds = analysis.bounds;
            break;
            
        case 'baked':
            result.bakedSDF = bakeSDF3D(processedPositions, processedIndices, bakingResolution);
            break;
    }
    
    return result;
}

/**
 * SDF cache for frequently used meshes
 */
const sdfCache = new Map();

/**
 * Get or generate cached SDF for a mesh
 */
export function getCachedMeshSDF(meshId, positions, indices, options = {}) {
    const cacheKey = `${meshId}_${options.forceMethod || 'auto'}_${options.bakingResolution || 32}`;
    
    if (sdfCache.has(cacheKey)) {
        return sdfCache.get(cacheKey);
    }
    
    const sdf = generateMeshSDF(positions, indices, options);
    sdfCache.set(cacheKey, sdf);
    
    // Limit cache size
    if (sdfCache.size > 100) {
        const firstKey = sdfCache.keys().next().value;
        sdfCache.delete(firstKey);
    }
    
    return sdf;
}

/**
 * Clear SDF cache
 */
export function clearSDFCache() {
    sdfCache.clear();
}

/**
 * Async version of generateMeshSDF with GPU acceleration
 * Use this for high-resolution baking (64³+)
 */
export async function generateMeshSDFAsync(positions, indices, options = {}) {
    const {
        maxTrianglesForPrimitive = 200,
        maxTrianglesForTriangleBuffer = 5000,
        bakingResolution = 32,
        forceMethod = null,
        validate = true,
        simplify = true,
        simplifyTarget = 2000,
        useGPU = true, // Enable GPU acceleration by default
    } = options;
    
    // Validate
    let validPositions = positions;
    let validIndices = indices;
    if (validate) {
        const validated = validateMesh(positions, indices);
        if (!validated.valid) {
            return {
                method: 'primitive',
                primitive: { type: 'box', typeId: SDF_TYPE.BOX, params: [0.5, 0.5, 0.5, 0], center: [0, 0, 0], quality: 0 },
                analysis: { vertexCount: 0, triangleCount: 0, bounds: { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] } },
                wasInvalid: true,
            };
        }
        validPositions = validated.positions;
        validIndices = validated.indices;
    }
    
    const analysis = analyzeMesh(validPositions, validIndices);
    
    let method = forceMethod;
    if (!method) {
        if (analysis.triangleCount <= maxTrianglesForPrimitive) {
            method = 'primitive';
        } else if (analysis.triangleCount <= maxTrianglesForTriangleBuffer) {
            method = 'triangles';
        } else {
            method = 'baked';
        }
    }
    
    // Simplify if needed
    let processedPositions = validPositions;
    let processedIndices = validIndices;
    let wasSimplified = false;
    
    if (simplify && (method === 'triangles' || method === 'baked') && analysis.triangleCount > simplifyTarget) {
        const simplified = simplifyMesh(validPositions, validIndices, simplifyTarget);
        processedPositions = simplified.positions;
        processedIndices = simplified.indices;
        wasSimplified = true;
    }
    
    const result = {
        method,
        analysis,
        wasSimplified,
        originalTriangles: analysis.triangleCount,
        processedTriangles: processedIndices ? processedIndices.length / 3 : processedPositions.length / 9,
    };
    
    switch (method) {
        case 'primitive':
            result.primitive = fitPrimitive(validPositions, validIndices);
            break;
            
        case 'triangles':
            result.triangleBuffer = generateTriangleBuffer(processedPositions, processedIndices);
            result.triangleCount = result.processedTriangles;
            result.bounds = analysis.bounds;
            break;
            
        case 'baked':
            // Use GPU if available and enabled
            if (useGPU && hasGPUBaker()) {
                result.bakedSDF = await bakeSDF3DGPU(processedPositions, processedIndices, bakingResolution);
            } else {
                result.bakedSDF = bakeSDF3D(processedPositions, processedIndices, bakingResolution);
            }
            break;
    }
    
    return result;
}

/**
 * WGSL shader code for triangle buffer SDF sampling
 */
export const TRIANGLE_SDF_WGSL = `
// Point to triangle distance (Barycentric method)
fn sdfTriangle(p: vec3<f32>, a: vec3<f32>, b: vec3<f32>, c: vec3<f32>) -> f32 {
    let ab = b - a; let ac = c - a; let ap = p - a;
    let d1 = dot(ab, ap); let d2 = dot(ac, ap);
    if (d1 <= 0.0 && d2 <= 0.0) { return length(p - a); }
    
    let bp = p - b;
    let d3 = dot(ab, bp); let d4 = dot(ac, bp);
    if (d3 >= 0.0 && d4 <= d3) { return length(p - b); }
    
    let vc = d1 * d4 - d3 * d2;
    if (vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0) {
        let v = d1 / (d1 - d3);
        return length(p - (a + v * ab));
    }
    
    let cp = p - c;
    let d5 = dot(ab, cp); let d6 = dot(ac, cp);
    if (d6 >= 0.0 && d5 <= d6) { return length(p - c); }
    
    let vb = d5 * d2 - d1 * d6;
    if (vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0) {
        let w = d2 / (d2 - d6);
        return length(p - (a + w * ac));
    }
    
    let va = d3 * d6 - d5 * d4;
    if (va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0) {
        let w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
        let bc = c - b;
        return length(p - (b + w * bc));
    }
    
    let denom = 1.0 / (va + vb + vc);
    let v = vb * denom;
    let w = vc * denom;
    return length(p - (a + ab * v + ac * w));
}

// Sample mesh triangles for SDF (requires triangle buffer binding)
fn sdfMeshTriangles(p: vec3<f32>, triBuffer: ptr<storage, array<vec4<f32>>>, triCount: u32) -> f32 {
    var minDist: f32 = 1e10;
    for (var i: u32 = 0u; i < triCount; i++) {
        let idx = i * 3u;
        let a = (*triBuffer)[idx].xyz;
        let b = (*triBuffer)[idx + 1u].xyz;
        let c = (*triBuffer)[idx + 2u].xyz;
        minDist = min(minDist, sdfTriangle(p, a, b, c));
    }
    return minDist;
}
`;

/**
 * WGSL shader code for 3D texture SDF sampling
 */
export const BAKED_SDF_WGSL = `
// Sample baked 3D SDF texture
fn sdfBaked3D(p: vec3<f32>, sdfTex: texture_3d<f32>, sdfSampler: sampler, 
              boundsMin: vec3<f32>, boundsSize: vec3<f32>) -> f32 {
    let uvw = (p - boundsMin) / boundsSize;
    if (any(uvw < vec3<f32>(0.0)) || any(uvw > vec3<f32>(1.0))) {
        // Outside bounds - return distance to bounds
        let clamped = clamp(p, boundsMin, boundsMin + boundsSize);
        return length(p - clamped);
    }
    return textureSampleLevel(sdfTex, sdfSampler, uvw, 0.0).r;
}
`;
