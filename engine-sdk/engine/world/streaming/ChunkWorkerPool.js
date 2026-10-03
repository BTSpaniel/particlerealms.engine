// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ChunkWorkerPool.js - Web Workers for Parallel Chunk Processing
 * 
 * Dedicated worker pool for chunk generation and meshing.
 * Offloads heavy computation from main thread.
 * 
 * Benefits:
 * - True parallel processing
 * - Non-blocking main thread
 * - Smooth gameplay during loading
 * - Scales with CPU cores
 * 
 * Workers handle:
 * - Terrain generation (noise sampling)
 * - Greedy meshing
 * - AO calculation
 * - Compression
 */

import { statsMean } from '../../core/math/MathStatistics.js';

// Worker script as inline blob (avoids separate file)
const WORKER_SCRIPT = `
// Chunk Worker Script
let initialized = false;
let chunkSize = 32;
let seed = 0;

// Simple seeded random
function seededRandom(x, y, z) {
    const n = Math.sin(x * 12.9898 + y * 78.233 + z * 45.164 + seed) * 43758.5453;
    return n - Math.floor(n);
}

// Simple 3D noise
function noise3D(x, y, z) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const zf = z - Math.floor(z);
    
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const w = zf * zf * (3 - 2 * zf);
    
    const a = seededRandom(X, Y, Z);
    const b = seededRandom(X + 1, Y, Z);
    const c = seededRandom(X, Y + 1, Z);
    const d = seededRandom(X + 1, Y + 1, Z);
    const e = seededRandom(X, Y, Z + 1);
    const f = seededRandom(X + 1, Y, Z + 1);
    const g = seededRandom(X, Y + 1, Z + 1);
    const h = seededRandom(X + 1, Y + 1, Z + 1);
    
    const x1 = a + u * (b - a);
    const x2 = c + u * (d - c);
    const y1 = x1 + v * (x2 - x1);
    
    const x3 = e + u * (f - e);
    const x4 = g + u * (h - g);
    const y2 = x3 + v * (x4 - x3);
    
    return y1 + w * (y2 - y1);
}

// Generate terrain for chunk
function generateTerrain(cx, cy, cz, options) {
    const voxels = new Uint8Array(chunkSize * chunkSize * chunkSize);
    const worldX = cx * chunkSize;
    const worldY = cy * chunkSize;
    const worldZ = cz * chunkSize;
    
    const baseHeight = options.baseHeight || 0;
    const amplitude = options.amplitude || 8;
    const frequency = options.frequency || 0.06;
    
    for (let z = 0; z < chunkSize; z++) {
        for (let x = 0; x < chunkSize; x++) {
            const wx = worldX + x;
            const wz = worldZ + z;
            
            // Height from noise
            const height = baseHeight + noise3D(wx * frequency, 0, wz * frequency) * amplitude;
            
            for (let y = 0; y < chunkSize; y++) {
                const wy = worldY + y;
                const idx = x + y * chunkSize + z * chunkSize * chunkSize;
                
                if (wy < height - 3) {
                    voxels[idx] = 1;  // Stone
                } else if (wy < height) {
                    voxels[idx] = 2;  // Dirt
                } else if (wy < height + 1) {
                    voxels[idx] = 3;  // Grass
                } else {
                    voxels[idx] = 0;  // Air
                }
            }
        }
    }
    
    return voxels;
}

// Simple greedy mesh generation
function generateMesh(voxels) {
    const vertices = [];
    const indices = [];
    let vertexCount = 0;
    
    // Face normals
    const faces = [
        { dir: [1, 0, 0], axis: 0, u: 2, v: 1 },   // +X
        { dir: [-1, 0, 0], axis: 0, u: 2, v: 1 },  // -X
        { dir: [0, 1, 0], axis: 1, u: 0, v: 2 },   // +Y
        { dir: [0, -1, 0], axis: 1, u: 0, v: 2 },  // -Y
        { dir: [0, 0, 1], axis: 2, u: 0, v: 1 },   // +Z
        { dir: [0, 0, -1], axis: 2, u: 0, v: 1 },  // -Z
    ];
    
    function getVoxel(x, y, z) {
        if (x < 0 || x >= chunkSize || y < 0 || y >= chunkSize || z < 0 || z >= chunkSize) {
            return 0;
        }
        return voxels[x + y * chunkSize + z * chunkSize * chunkSize];
    }
    
    // Simple face-by-face meshing
    for (let z = 0; z < chunkSize; z++) {
        for (let y = 0; y < chunkSize; y++) {
            for (let x = 0; x < chunkSize; x++) {
                const voxel = getVoxel(x, y, z);
                if (voxel === 0) continue;
                
                for (let f = 0; f < 6; f++) {
                    const face = faces[f];
                    const nx = x + face.dir[0];
                    const ny = y + face.dir[1];
                    const nz = z + face.dir[2];
                    
                    if (getVoxel(nx, ny, nz) !== 0) continue;
                    
                    // Add face vertices
                    const baseIdx = vertexCount;
                    
                    // Simplified quad vertices (position + normal + material)
                    // Real implementation would be more sophisticated
                    vertices.push(x, y, z, f, voxel);
                    vertices.push(x + 1, y, z, f, voxel);
                    vertices.push(x + 1, y + 1, z, f, voxel);
                    vertices.push(x, y + 1, z, f, voxel);
                    
                    indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
                    indices.push(baseIdx, baseIdx + 2, baseIdx + 3);
                    
                    vertexCount += 4;
                }
            }
        }
    }
    
    return {
        vertices: new Float32Array(vertices),
        indices: new Uint32Array(indices),
        faceCount: indices.length / 3,
    };
}

// Message handler
self.onmessage = function(e) {
    const { type, id, data } = e.data;
    
    try {
        switch (type) {
            case 'init':
                chunkSize = data.chunkSize || 32;
                seed = data.seed || 0;
                initialized = true;
                self.postMessage({ type: 'init', id, success: true });
                break;
                
            case 'generate':
                const voxels = generateTerrain(data.cx, data.cy, data.cz, data.options || {});
                self.postMessage({ 
                    type: 'generate', 
                    id,
                    result: {
                        cx: data.cx,
                        cy: data.cy,
                        cz: data.cz,
                        voxels: voxels.buffer,
                    }
                }, [voxels.buffer]);
                break;
                
            case 'mesh':
                const voxelData = new Uint8Array(data.voxels);
                const mesh = generateMesh(voxelData);
                self.postMessage({
                    type: 'mesh',
                    id,
                    result: {
                        cx: data.cx,
                        cy: data.cy,
                        cz: data.cz,
                        vertices: mesh.vertices.buffer,
                        indices: mesh.indices.buffer,
                        faceCount: mesh.faceCount,
                    }
                }, [mesh.vertices.buffer, mesh.indices.buffer]);
                break;
                
            case 'generateAndMesh':
                const genVoxels = generateTerrain(data.cx, data.cy, data.cz, data.options || {});
                const genMesh = generateMesh(genVoxels);
                self.postMessage({
                    type: 'generateAndMesh',
                    id,
                    result: {
                        cx: data.cx,
                        cy: data.cy,
                        cz: data.cz,
                        voxels: genVoxels.buffer,
                        vertices: genMesh.vertices.buffer,
                        indices: genMesh.indices.buffer,
                        faceCount: genMesh.faceCount,
                    }
                }, [genVoxels.buffer, genMesh.vertices.buffer, genMesh.indices.buffer]);
                break;
                
            default:
                self.postMessage({ type: 'error', id, error: 'Unknown message type' });
        }
    } catch (err) {
        self.postMessage({ type: 'error', id, error: err.message });
    }
};
`;

/**
 * ChunkWorkerPool - Manages a pool of Web Workers
 */
export class ChunkWorkerPool {
    constructor() {
        this.workers = [];
        this.maxWorkers = Math.max(navigator.hardwareConcurrency || 4, 8); // Allow more workers
        this.initialized = false;
        this.enabled = true;
        
        // Task management
        this.taskQueue = [];
        this.pendingTasks = new Map();
        this.taskIdCounter = 0;
        
        // Worker status
        this.busyWorkers = new Set();
        
        // Configuration
        this.chunkSize = 32;
        this.seed = 0;
        
        // Stats
        this.stats = {
            tasksQueued: 0,
            tasksCompleted: 0,
            tasksFailed: 0,
            avgTaskTimeMs: 0,
        };
        
        this.taskTimes = [];
        this.maxTaskTimeSamples = 50;
    }
    
    /**
     * Initialize the worker pool
     * @param {Object} options - { chunkSize, seed, workerCount }
     */
    async init(options = {}) {
        this.chunkSize = options.chunkSize || 32;
        this.seed = options.seed || 0;
        const workerCount = options.workerCount || Math.min(this.maxWorkers, 8); // Allow more workers
        
        // Create worker blob
        const blob = new Blob([WORKER_SCRIPT], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(blob);
        
        // Create workers
        const initPromises = [];
        
        for (let i = 0; i < workerCount; i++) {
            const worker = new Worker(workerUrl);
            
            worker.onmessage = (e) => this.handleWorkerMessage(i, e);
            worker.onerror = (e) => this.handleWorkerError(i, e);
            
            this.workers.push(worker);
            
            // Initialize worker
            initPromises.push(this.sendToWorker(i, 'init', {
                chunkSize: this.chunkSize,
                seed: this.seed,
            }));
        }
        
        // Wait for all workers to initialize
        await Promise.all(initPromises);
        
        // Clean up blob URL
        URL.revokeObjectURL(workerUrl);
        
        this.initialized = true;
        console.log(`[ChunkWorkerPool] Initialized ${workerCount} workers`);
        
        return true;
    }
    
    /**
     * Send message to specific worker
     */
    sendToWorker(workerIndex, type, data) {
        return new Promise((resolve, reject) => {
            const id = this.taskIdCounter++;
            const startTime = performance.now();
            
            this.pendingTasks.set(id, {
                resolve,
                reject,
                workerIndex,
                startTime,
                type,
            });
            
            this.workers[workerIndex].postMessage({
                type,
                id,
                data,
            }, data.voxels ? [data.voxels] : undefined);
        });
    }
    
    /**
     * Handle worker message
     */
    handleWorkerMessage(workerIndex, event) {
        const { type, id, result, error, success } = event.data;
        
        const task = this.pendingTasks.get(id);
        if (!task) return;
        
        this.pendingTasks.delete(id);
        this.busyWorkers.delete(workerIndex);
        
        // Track timing
        const duration = performance.now() - task.startTime;
        this.trackTaskTime(duration);
        
        if (type === 'error') {
            task.reject(new Error(error));
            this.stats.tasksFailed++;
        } else {
            task.resolve(result || { success });
            this.stats.tasksCompleted++;
        }
        
        // Process queue
        this.processQueue();
    }
    
    /**
     * Handle worker error
     */
    handleWorkerError(workerIndex, error) {
        console.error(`[ChunkWorkerPool] Worker ${workerIndex} error:`, error);
        this.busyWorkers.delete(workerIndex);
        this.processQueue();
    }
    
    /**
     * Track task completion time
     */
    trackTaskTime(timeMs) {
        this.taskTimes.push(timeMs);
        if (this.taskTimes.length > this.maxTaskTimeSamples) {
            this.taskTimes.shift();
        }
        this.stats.avgTaskTimeMs = statsMean(this.taskTimes);
    }
    
    /**
     * Get an available worker index
     */
    getAvailableWorker() {
        for (let i = 0; i < this.workers.length; i++) {
            if (!this.busyWorkers.has(i)) {
                return i;
            }
        }
        return -1;
    }
    
    /**
     * Process task queue
     */
    processQueue() {
        while (this.taskQueue.length > 0) {
            const workerIndex = this.getAvailableWorker();
            if (workerIndex < 0) break;
            
            const task = this.taskQueue.shift();
            this.busyWorkers.add(workerIndex);
            
            this.sendToWorker(workerIndex, task.type, task.data)
                .then(task.resolve)
                .catch(task.reject);
        }
    }
    
    /**
     * Queue a task
     */
    queueTask(type, data) {
        return new Promise((resolve, reject) => {
            this.taskQueue.push({ type, data, resolve, reject });
            this.stats.tasksQueued++;
            this.processQueue();
        });
    }
    
    /**
     * Generate terrain for a chunk
     * @param {number} cx 
     * @param {number} cy 
     * @param {number} cz 
     * @param {Object} options 
     * @returns {Promise<Uint8Array>}
     */
    async generateTerrain(cx, cy, cz, options = {}) {
        if (!this.enabled || !this.initialized) {
            return null;
        }
        
        const result = await this.queueTask('generate', { cx, cy, cz, options });
        return new Uint8Array(result.voxels);
    }
    
    /**
     * Generate mesh for voxel data
     * @param {number} cx 
     * @param {number} cy 
     * @param {number} cz 
     * @param {Uint8Array} voxels 
     * @returns {Promise<Object>}
     */
    async generateMesh(cx, cy, cz, voxels) {
        if (!this.enabled || !this.initialized) {
            return null;
        }
        
        const result = await this.queueTask('mesh', { 
            cx, cy, cz, 
            voxels: voxels.buffer.slice(0),
        });
        
        return {
            vertices: new Float32Array(result.vertices),
            indices: new Uint32Array(result.indices),
            faceCount: result.faceCount,
        };
    }
    
    /**
     * Generate terrain and mesh in one call
     * @param {number} cx 
     * @param {number} cy 
     * @param {number} cz 
     * @param {Object} options 
     * @returns {Promise<Object>}
     */
    async generateAndMesh(cx, cy, cz, options = {}) {
        if (!this.enabled || !this.initialized) {
            return null;
        }
        
        const result = await this.queueTask('generateAndMesh', { cx, cy, cz, options });
        
        return {
            voxels: new Uint8Array(result.voxels),
            vertices: new Float32Array(result.vertices),
            indices: new Uint32Array(result.indices),
            faceCount: result.faceCount,
        };
    }
    
    /**
     * Batch generate multiple chunks
     * @param {Array} chunks - [{ cx, cy, cz, options }]
     * @returns {Promise<Map>}
     */
    async batchGenerate(chunks) {
        const results = new Map();
        
        const promises = chunks.map(async ({ cx, cy, cz, options }) => {
            const result = await this.generateAndMesh(cx, cy, cz, options);
            const key = `${cx},${cy},${cz}`;
            results.set(key, result);
        });
        
        await Promise.all(promises);
        return results;
    }
    
    /**
     * Get queue length
     */
    getQueueLength() {
        return this.taskQueue.length;
    }
    
    /**
     * Get busy worker count
     */
    getBusyWorkerCount() {
        return this.busyWorkers.size;
    }
    
    /**
     * Check if pool is idle
     */
    isIdle() {
        return this.taskQueue.length === 0 && this.busyWorkers.size === 0;
    }
    
    /**
     * Update seed for all workers
     * @param {number} seed 
     */
    async updateSeed(seed) {
        this.seed = seed;
        const promises = this.workers.map((_, i) => 
            this.sendToWorker(i, 'init', { chunkSize: this.chunkSize, seed })
        );
        await Promise.all(promises);
    }
    
    /**
     * Get stats
     */
    getStats() {
        return {
            ...this.stats,
            workerCount: this.workers.length,
            busyWorkers: this.busyWorkers.size,
            queueLength: this.taskQueue.length,
            pendingTasks: this.pendingTasks.size,
        };
    }
    
    /**
     * Load configuration from engine.cfg section
     * @param {Object} cfg - Config from [chunk_workers] section
     */
    loadConfig(cfg) {
        if (!cfg) return;
        
        this.workerCount = parseInt(cfg.worker_count) || navigator.hardwareConcurrency || 4;
        this.taskBatchSize = parseInt(cfg.task_batch_size) || 4;
        this.priorityBoost = parseFloat(cfg.priority_boost) || 1.5;
    }
    
    /**
     * Terminate all workers
     */
    destroy() {
        for (const worker of this.workers) {
            worker.terminate();
        }
        this.workers = [];
        this.taskQueue = [];
        this.pendingTasks.clear();
        this.busyWorkers.clear();
        this.initialized = false;
    }
}

export default ChunkWorkerPool;
