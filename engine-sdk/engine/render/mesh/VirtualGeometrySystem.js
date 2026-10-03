// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Virtual Geometry System - Nanite-style mesh rendering
 * Implements GPU-driven LOD, mesh cluster rendering, and software rasterization
 * Based on techniques from Unreal Engine 5's Nanite
 * Now powered by vGPU driver
 */

import { initVGPU } from '../../core/gpu/VirtualGPU.js';

// Reusable buffers for hot paths (reduce/reuse/recycle)
const _vgsCullParams = new Float32Array(64);

export class VirtualGeometrySystem {
    constructor(device, options = {}) {
        this.vgpu = initVGPU(device);
        this.device = device;
        this.maxClusters = options.maxClusters || 1000000;
        this.clusterSize = options.clusterSize || 128; // triangles per cluster
        
        // Cluster hierarchy (for LOD selection)
        this.clusterBuffer = null;
        this.hierarchyBuffer = null;
        
        // Vertex/index data
        this.vertexBuffer = null;
        this.indexBuffer = null;
        
        // Visibility buffers
        this.visibilityBuffer = null;
        this.visibleClustersBuffer = null;
        this.visibleCountBuffer = null;
        
        // Params buffer
        this.paramsBuffer = null;
        
        // Bind groups
        this.cullBindGroup = null;
        this.rasterBindGroup = null;
        
        // Hi-Z texture (passed in from renderer)
        this.hiZSampler = null;
        
        // Pipelines
        this.cullPipeline = null;
        this.rasterPipeline = null;
        this.shadePipeline = null;
        
        this.stats = {
            totalClusters: 0,
            visibleClusters: 0,
            renderedTriangles: 0,
            culledTriangles: 0,
        };
    }

    async init() {
        await this._createBuffers();
        await this._createPipelines();
        console.log('[VirtualGeometry] Initialized - Nanite-style rendering ready');
    }

    async _createBuffers() {
        // Cluster data buffer (position, bounds, LOD info) - 32 bytes per cluster
        this.clusterBuffer = this.vgpu.buffer.create({
            size: this.maxClusters * 32, usage: 'storage', label: 'ClusterBuffer'
        }).buffer;

        // Hierarchical LOD tree - 16 bytes per node
        this.hierarchyBuffer = this.vgpu.buffer.create({
            size: this.maxClusters * 16, usage: 'storage', label: 'HierarchyBuffer'
        }).buffer;

        // Visibility results (bit array)
        this.visibilityBuffer = this.vgpu.buffer.create({
            size: Math.ceil(this.maxClusters / 32) * 4, usage: 'storage', label: 'VisibilityBuffer'
        }).buffer;

        // Visible cluster list (for indirect draw)
        this.visibleClustersBuffer = this.vgpu.buffer.create({
            size: this.maxClusters * 4, usage: 'storage|indirect', label: 'VisibleClusters'
        }).buffer;

        // Visible count (atomic counter)
        this.visibleCountBuffer = this.vgpu.buffer.create({
            size: 4, usage: 'storage|indirect', label: 'VisibleCount'
        }).buffer;

        // Culling params uniform
        this.paramsBuffer = this.vgpu.buffer.create({
            size: 256, usage: 'uniform', label: 'CullParams'
        }).buffer;

        // Hi-Z sampler
        this.hiZSampler = this.device.createSampler({
            magFilter: 'nearest',
            minFilter: 'nearest',
            mipmapFilter: 'nearest',
            label: 'HiZ_Sampler',
        });
    }

    async _createPipelines() {
        // 1. Cluster Culling Pipeline (frustum, occlusion, LOD selection)
        const cullShader = this.vgpu.shader.compile('clusterCull', `
struct Cluster {
    boundingSphere: vec4<f32>,  // xyz = center, w = radius
    lodError: f32,
    lodParent: u32,
    triangleCount: u32,
    indexOffset: u32,
}

struct CullParams {
    viewProj: mat4x4<f32>,
    cameraPos: vec3<f32>,
    lodBias: f32,
    frustumPlanes: array<vec4<f32>, 6>,
}

@group(0) @binding(0) var<storage, read> clusters: array<Cluster>;
@group(0) @binding(1) var<storage, read_write> visibility: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> visibleList: array<u32>;
@group(0) @binding(3) var<storage, read_write> visibleCount: atomic<u32>;
@group(0) @binding(4) var<uniform> params: CullParams;
@group(0) @binding(5) var hiZTexture: texture_2d<f32>;

fn frustumCull(center: vec3<f32>, radius: f32) -> bool {
    for (var i = 0u; i < 6u; i++) {
        let plane = params.frustumPlanes[i];
        let dist = dot(plane.xyz, center) + plane.w;
        if (dist < -radius) {
            return false;
        }
    }
    return true;
}

fn selectLOD(clusterId: u32, distance: f32) -> bool {
    let cluster = clusters[clusterId];
    let screenError = cluster.lodError / distance;
    return screenError > params.lodBias;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let clusterId = gid.x;
    if (clusterId >= arrayLength(&clusters)) {
        return;
    }
    
    let cluster = clusters[clusterId];
    let center = cluster.boundingSphere.xyz;
    let radius = cluster.boundingSphere.w;
    
    // Frustum culling
    if (!frustumCull(center, radius)) {
        return;
    }
    
    // Distance-based LOD selection
    let distance = length(params.cameraPos - center);
    if (!selectLOD(clusterId, distance)) {
        return;
    }
    
    // Occlusion culling (Hi-Z)
    // TODO: Project bounds to screen space and check Hi-Z
    
    // Mark visible
    let wordIdx = clusterId / 32u;
    let bitIdx = clusterId % 32u;
    atomicOr(&visibility[wordIdx], 1u << bitIdx);
    
    // Add to visible list
    let idx = atomicAdd(&visibleCount, 1u);
    visibleList[idx] = clusterId;
}
            `);

        this.cullPipeline = this.vgpu.pipeline.compute({
            module: cullShader, entryPoint: 'main', label: 'ClusterCullPipeline'
        });
    }

    /**
     * Update culling parameters
     */
    updateCullParams(viewProj, cameraPos, frustumPlanes, lodBias = 1.0) {
        const data = _vgsCullParams;  // Reuse buffer
        
        // viewProj (16 floats)
        data.set(viewProj, 0);
        
        // cameraPos (3 floats + lodBias)
        data[16] = cameraPos[0];
        data[17] = cameraPos[1];
        data[18] = cameraPos[2];
        data[19] = lodBias;
        
        // frustumPlanes (6 * 4 = 24 floats)
        for (let i = 0; i < 6; i++) {
            data[20 + i * 4] = frustumPlanes[i][0];
            data[20 + i * 4 + 1] = frustumPlanes[i][1];
            data[20 + i * 4 + 2] = frustumPlanes[i][2];
            data[20 + i * 4 + 3] = frustumPlanes[i][3];
        }
        
        this.device.queue.writeBuffer(this.paramsBuffer, 0, data);
    }

    /**
     * Create bind group for culling pass
     */
    _createCullBindGroup(hiZTexture) {
        return this.device.createBindGroup({
            layout: this.cullPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.clusterBuffer } },
                { binding: 1, resource: { buffer: this.visibilityBuffer } },
                { binding: 2, resource: { buffer: this.visibleClustersBuffer } },
                { binding: 3, resource: { buffer: this.visibleCountBuffer } },
                { binding: 4, resource: { buffer: this.paramsBuffer } },
                { binding: 5, resource: hiZTexture.createView() },
            ],
            label: 'CullBindGroup',
        });
    }

    /**
     * Execute cluster culling and LOD selection
     */
    cullClusters(commandEncoder, hiZTexture) {
        if (this.stats.totalClusters === 0) return;

        // Clear visibility buffer and count
        commandEncoder.clearBuffer(this.visibilityBuffer);
        commandEncoder.clearBuffer(this.visibleCountBuffer);

        // Create bind group
        this.cullBindGroup = this._createCullBindGroup(hiZTexture);
        
        const pass = commandEncoder.beginComputePass({ 
            label: 'ClusterCull',
        });
        
        pass.setPipeline(this.cullPipeline);
        pass.setBindGroup(0, this.cullBindGroup);
        
        const workgroups = Math.ceil(this.stats.totalClusters / 64);
        pass.dispatchWorkgroups(workgroups);
        
        pass.end();
    }

    /**
     * Get visible clusters buffer for indirect draw
     */
    getVisibleClustersBuffer() {
        return this.visibleClustersBuffer;
    }

    /**
     * Get visible count buffer for indirect draw
     */
    getVisibleCountBuffer() {
        return this.visibleCountBuffer;
    }

    /**
     * Build cluster hierarchy from mesh
     * Uses a simple greedy clustering algorithm based on spatial locality
     */
    buildClusterHierarchy(positions, indices) {
        console.log('[VirtualGeometry] Building cluster hierarchy...');
        
        const triangleCount = indices.length / 3;
        const clusters = [];
        
        // Simple spatial clustering based on triangle centroids
        let currentCluster = {
            triangles: [],
            center: [0, 0, 0],
            radius: 0,
            lodError: 0,
        };

        for (let i = 0; i < triangleCount; i++) {
            const i0 = indices[i * 3];
            const i1 = indices[i * 3 + 1];
            const i2 = indices[i * 3 + 2];
            
            // Calculate triangle centroid
            const centroid = [
                (positions[i0 * 3] + positions[i1 * 3] + positions[i2 * 3]) / 3,
                (positions[i0 * 3 + 1] + positions[i1 * 3 + 1] + positions[i2 * 3 + 1]) / 3,
                (positions[i0 * 3 + 2] + positions[i1 * 3 + 2] + positions[i2 * 3 + 2]) / 3,
            ];

            currentCluster.triangles.push({ i0, i1, i2, centroid });
            
            // Cluster is full, finalize it
            if (currentCluster.triangles.length >= this.clusterSize) {
                this._finalizeCluster(currentCluster, positions);
                clusters.push(currentCluster);
                currentCluster = { triangles: [], center: [0, 0, 0], radius: 0, lodError: 0 };
            }
        }

        // Don't forget the last partial cluster
        if (currentCluster.triangles.length > 0) {
            this._finalizeCluster(currentCluster, positions);
            clusters.push(currentCluster);
        }

        // Upload cluster data to GPU
        this._uploadClusters(clusters);
        
        this.stats.totalClusters = clusters.length;
        console.log(`[VirtualGeometry] Created ${clusters.length} clusters from ${triangleCount} triangles`);
        
        return clusters.length;
    }

    _finalizeCluster(cluster, positions) {
        // Calculate cluster center (average of triangle centroids)
        let cx = 0, cy = 0, cz = 0;
        for (const tri of cluster.triangles) {
            cx += tri.centroid[0];
            cy += tri.centroid[1];
            cz += tri.centroid[2];
        }
        cx /= cluster.triangles.length;
        cy /= cluster.triangles.length;
        cz /= cluster.triangles.length;
        cluster.center = [cx, cy, cz];

        // Calculate bounding radius
        let maxDist = 0;
        for (const tri of cluster.triangles) {
            const dx = tri.centroid[0] - cx;
            const dy = tri.centroid[1] - cy;
            const dz = tri.centroid[2] - cz;
            maxDist = Math.max(maxDist, Math.sqrt(dx*dx + dy*dy + dz*dz));
        }
        cluster.radius = maxDist * 1.2; // Add some margin

        // Calculate LOD error (geometric error for LOD selection)
        // Higher error = more detail needed = render at closer distances
        cluster.lodError = cluster.radius / this.clusterSize;
    }

    _uploadClusters(clusters) {
        // Pack cluster data: vec4 boundingSphere, f32 lodError, u32 lodParent, u32 triCount, u32 indexOffset
        const clusterData = new Float32Array(clusters.length * 8);
        const clusterDataU32 = new Uint32Array(clusterData.buffer);
        
        for (let i = 0; i < clusters.length; i++) {
            const c = clusters[i];
            const offset = i * 8;
            
            clusterData[offset + 0] = c.center[0];
            clusterData[offset + 1] = c.center[1];
            clusterData[offset + 2] = c.center[2];
            clusterData[offset + 3] = c.radius;
            clusterData[offset + 4] = c.lodError;
            clusterDataU32[offset + 5] = 0xFFFFFFFF; // No parent (root LOD)
            clusterDataU32[offset + 6] = c.triangles.length;
            clusterDataU32[offset + 7] = i * this.clusterSize * 3; // Index offset
        }
        
        this.device.queue.writeBuffer(this.clusterBuffer, 0, clusterData);
    }

    getStats() {
        return this.stats;
    }

    destroy() {
        if (this.clusterBuffer) this.clusterBuffer.destroy();
        if (this.hierarchyBuffer) this.hierarchyBuffer.destroy();
        if (this.visibilityBuffer) this.visibilityBuffer.destroy();
        if (this.visibleClustersBuffer) this.visibleClustersBuffer.destroy();
    }
}
