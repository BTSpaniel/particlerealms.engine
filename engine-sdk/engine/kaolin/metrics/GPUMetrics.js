/**
 * GPUMetrics.js — WebGPU compute shader accelerated 3D distance metrics
 *
 * GPU-accelerated implementations of:
 *   - Chamfer Distance (bidirectional nearest-neighbor)
 *   - Hausdorff Distance (max nearest-neighbor)
 *   - Mean Distance / RMSE
 *
 * For each point in set A, a compute shader finds the nearest point in set B
 * using a brute-force O(N*M) scan parallelized across workgroups. Results are
 * reduced on the GPU via a parallel reduction pass.
 *
 * Falls back to CPU path (ChamferDistance.js / HausdorffDistance.js) if WebGPU
 * is unavailable or point counts are below the GPU-beneficial threshold (~2000).
 *
 * Usage:
 *   const gpu = new GPUMetrics(device);
 *   const result = await gpu.chamferDistance(pointsA, pointsB);
 */

const WORKGROUP_SIZE = 256;
const GPU_THRESHOLD = 2000; // Below this, CPU is faster

// ============================================================================
// GPU METRICS CLASS
// ============================================================================

export class GPUMetrics {
    /**
     * @param {GPUDevice} device — WebGPU device
     */
    constructor(device) {
        this.device = device;
        this._pipelines = {};
        this._initialized = false;
    }

    /**
     * Lazy-init pipelines on first use.
     */
    _ensureInit() {
        if (this._initialized) return;
        this._initialized = true;

        // ── Nearest-neighbor compute shader ─────────────────────────────
        // For each point in A, finds nearest point in B.
        // Output: per-point squared distance.
        const nnShader = this.device.createShaderModule({
            label: 'GPUMetrics_NN',
            code: `
                struct Params {
                    countA: u32,
                    countB: u32,
                    _pad0: u32,
                    _pad1: u32,
                }

                @group(0) @binding(0) var<uniform> params: Params;
                @group(0) @binding(1) var<storage, read> pointsA: array<f32>;
                @group(0) @binding(2) var<storage, read> pointsB: array<f32>;
                @group(0) @binding(3) var<storage, read_write> distOut: array<f32>;

                @compute @workgroup_size(${WORKGROUP_SIZE})
                fn nearestNeighbor(@builtin(global_invocation_id) gid: vec3u) {
                    let idx = gid.x;
                    if (idx >= params.countA) { return; }

                    let ax = pointsA[idx * 3u];
                    let ay = pointsA[idx * 3u + 1u];
                    let az = pointsA[idx * 3u + 2u];

                    var minDist2: f32 = 3.40282e+38; // FLT_MAX

                    for (var j: u32 = 0u; j < params.countB; j++) {
                        let dx = pointsB[j * 3u] - ax;
                        let dy = pointsB[j * 3u + 1u] - ay;
                        let dz = pointsB[j * 3u + 2u] - az;
                        let d2 = dx * dx + dy * dy + dz * dz;
                        minDist2 = min(minDist2, d2);
                    }

                    distOut[idx] = minDist2;
                }
            `,
        });

        // ── Parallel reduction shader (sum + max) ───────────────────────
        const reduceShader = this.device.createShaderModule({
            label: 'GPUMetrics_Reduce',
            code: `
                struct ReduceParams {
                    count: u32,
                    mode: u32,  // 0 = sum, 1 = max
                    _pad0: u32,
                    _pad1: u32,
                }

                @group(0) @binding(0) var<uniform> params: ReduceParams;
                @group(0) @binding(1) var<storage, read> input: array<f32>;
                @group(0) @binding(2) var<storage, read_write> output: array<f32>;

                var<workgroup> shared: array<f32, ${WORKGROUP_SIZE}>;

                @compute @workgroup_size(${WORKGROUP_SIZE})
                fn reduce(
                    @builtin(local_invocation_id) lid: vec3u,
                    @builtin(workgroup_id) wid: vec3u,
                ) {
                    let gid = wid.x * ${WORKGROUP_SIZE}u + lid.x;
                    let localId = lid.x;

                    // Load
                    if (gid < params.count) {
                        shared[localId] = input[gid];
                    } else {
                        if (params.mode == 0u) {
                            shared[localId] = 0.0;
                        } else {
                            shared[localId] = 0.0;
                        }
                    }
                    workgroupBarrier();

                    // Tree reduction
                    for (var stride: u32 = ${WORKGROUP_SIZE / 2}u; stride > 0u; stride >>= 1u) {
                        if (localId < stride) {
                            if (params.mode == 0u) {
                                shared[localId] += shared[localId + stride];
                            } else {
                                shared[localId] = max(shared[localId], shared[localId + stride]);
                            }
                        }
                        workgroupBarrier();
                    }

                    if (localId == 0u) {
                        output[wid.x] = shared[0];
                    }
                }
            `,
        });

        // ── Create pipeline layouts ─────────────────────────────────────
        const nnLayout = this.device.createBindGroupLayout({
            label: 'GPUMetrics_NN_Layout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            ],
        });

        const reduceLayout = this.device.createBindGroupLayout({
            label: 'GPUMetrics_Reduce_Layout',
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            ],
        });

        this._pipelines.nn = this.device.createComputePipeline({
            label: 'GPUMetrics_NN_Pipeline',
            layout: this.device.createPipelineLayout({ bindGroupLayouts: [nnLayout] }),
            compute: { module: nnShader, entryPoint: 'nearestNeighbor' },
        });

        this._pipelines.reduce = this.device.createComputePipeline({
            label: 'GPUMetrics_Reduce_Pipeline',
            layout: this.device.createPipelineLayout({ bindGroupLayouts: [reduceLayout] }),
            compute: { module: reduceShader, entryPoint: 'reduce' },
        });

        this._nnLayout = nnLayout;
        this._reduceLayout = reduceLayout;
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    /**
     * GPU-accelerated Chamfer Distance.
     * @param {Float32Array} pointsA — stride 3
     * @param {Float32Array} pointsB — stride 3
     * @param {Object} options
     * @param {boolean} options.squared — return squared distances (default true)
     * @returns {Promise<{ distance: number, aToB: number, bToA: number }>}
     */
    async chamferDistance(pointsA, pointsB, options = {}) {
        const nA = (pointsA.length / 3) | 0;
        const nB = (pointsB.length / 3) | 0;
        const squared = options.squared ?? true;

        if (nA < GPU_THRESHOLD && nB < GPU_THRESHOLD) {
            return this._cpuChamfer(pointsA, pointsB, options);
        }

        this._ensureInit();

        const aToB = await this._gpuDirectionalDistance(pointsA, nA, pointsB, nB, 'sum');
        const bToA = await this._gpuDirectionalDistance(pointsB, nB, pointsA, nA, 'sum');

        const aToBMean = aToB / nA;
        const bToAMean = bToA / nB;

        return {
            distance: squared ? (aToBMean + bToAMean) : (Math.sqrt(aToBMean) + Math.sqrt(bToAMean)),
            aToB: squared ? aToBMean : Math.sqrt(aToBMean),
            bToA: squared ? bToAMean : Math.sqrt(bToAMean),
        };
    }

    /**
     * GPU-accelerated Hausdorff Distance.
     * @param {Float32Array} pointsA — stride 3
     * @param {Float32Array} pointsB — stride 3
     * @returns {Promise<{ distance: number, aToB: number, bToA: number }>}
     */
    async hausdorffDistance(pointsA, pointsB) {
        const nA = (pointsA.length / 3) | 0;
        const nB = (pointsB.length / 3) | 0;

        if (nA < GPU_THRESHOLD && nB < GPU_THRESHOLD) {
            return this._cpuHausdorff(pointsA, pointsB);
        }

        this._ensureInit();

        const maxAtoB = await this._gpuDirectionalDistance(pointsA, nA, pointsB, nB, 'max');
        const maxBtoA = await this._gpuDirectionalDistance(pointsB, nB, pointsA, nA, 'max');

        const aToBDist = Math.sqrt(maxAtoB);
        const bToADist = Math.sqrt(maxBtoA);

        return {
            distance: Math.max(aToBDist, bToADist),
            aToB: aToBDist,
            bToA: bToADist,
        };
    }

    /**
     * GPU-accelerated RMSE (Root Mean Squared Error of nearest-neighbor distances).
     * @param {Float32Array} pointsA — stride 3
     * @param {Float32Array} pointsB — stride 3
     * @returns {Promise<number>}
     */
    async rmse(pointsA, pointsB) {
        const nA = (pointsA.length / 3) | 0;
        const nB = (pointsB.length / 3) | 0;

        if (nA < GPU_THRESHOLD && nB < GPU_THRESHOLD) {
            const { rmse } = await import('./HausdorffDistance.js');
            return rmse(pointsA, pointsB);
        }

        this._ensureInit();

        const sumSqA = await this._gpuDirectionalDistance(pointsA, nA, pointsB, nB, 'sum');
        const sumSqB = await this._gpuDirectionalDistance(pointsB, nB, pointsA, nA, 'sum');

        return Math.sqrt((sumSqA / nA + sumSqB / nB) / 2);
    }

    // ========================================================================
    // INTERNAL GPU DISPATCH
    // ========================================================================

    /**
     * Run nearest-neighbor compute + reduction in one direction.
     * @param {Float32Array} src - Source points (stride 3)
     * @param {number} nSrc - Source point count
     * @param {Float32Array} dst - Target points (stride 3)
     * @param {number} nDst - Target point count
     * @param {string} reduceMode - 'sum' or 'max'
     * @returns {Promise<number>} Reduced result (sum or max of squared distances)
     */
    async _gpuDirectionalDistance(src, nSrc, dst, nDst, reduceMode) {
        const device = this.device;

        // Create buffers
        const paramsData = new Uint32Array([nSrc, nDst, 0, 0]);
        const paramsBuf = device.createBuffer({
            size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(paramsBuf, 0, paramsData);

        const srcBuf = device.createBuffer({
            size: src.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(srcBuf, 0, src);

        const dstBuf = device.createBuffer({
            size: dst.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(dstBuf, 0, dst);

        const distBuf = device.createBuffer({
            size: nSrc * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });

        // NN pass
        const nnBG = device.createBindGroup({
            layout: this._nnLayout,
            entries: [
                { binding: 0, resource: { buffer: paramsBuf } },
                { binding: 1, resource: { buffer: srcBuf } },
                { binding: 2, resource: { buffer: dstBuf } },
                { binding: 3, resource: { buffer: distBuf } },
            ],
        });

        const enc = device.createCommandEncoder();
        const nnPass = enc.beginComputePass();
        nnPass.setPipeline(this._pipelines.nn);
        nnPass.setBindGroup(0, nnBG);
        nnPass.dispatchWorkgroups(Math.ceil(nSrc / WORKGROUP_SIZE));
        nnPass.end();

        // Reduction pass(es)
        let currentBuf = distBuf;
        let currentCount = nSrc;
        const modeVal = reduceMode === 'max' ? 1 : 0;
        const tempBuffers = [];

        while (currentCount > 1) {
            const numGroups = Math.ceil(currentCount / WORKGROUP_SIZE);
            const outBuf = device.createBuffer({
                size: numGroups * 4,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
            });
            tempBuffers.push(outBuf);

            const rParamsData = new Uint32Array([currentCount, modeVal, 0, 0]);
            const rParamsBuf = device.createBuffer({
                size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
            device.queue.writeBuffer(rParamsBuf, 0, rParamsData);
            tempBuffers.push(rParamsBuf);

            const rBG = device.createBindGroup({
                layout: this._reduceLayout,
                entries: [
                    { binding: 0, resource: { buffer: rParamsBuf } },
                    { binding: 1, resource: { buffer: currentBuf } },
                    { binding: 2, resource: { buffer: outBuf } },
                ],
            });

            const rPass = enc.beginComputePass();
            rPass.setPipeline(this._pipelines.reduce);
            rPass.setBindGroup(0, rBG);
            rPass.dispatchWorkgroups(numGroups);
            rPass.end();

            currentBuf = outBuf;
            currentCount = numGroups;
        }

        // Read back final result
        const readBuf = device.createBuffer({
            size: 4,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
        enc.copyBufferToBuffer(currentBuf, 0, readBuf, 0, 4);

        device.queue.submit([enc.finish()]);

        await readBuf.mapAsync(GPUMapMode.READ);
        const result = new Float32Array(readBuf.getMappedRange())[0];
        readBuf.unmap();

        // Cleanup
        paramsBuf.destroy();
        srcBuf.destroy();
        dstBuf.destroy();
        distBuf.destroy();
        readBuf.destroy();
        for (const buf of tempBuffers) buf.destroy();

        return result;
    }

    // ========================================================================
    // CPU FALLBACKS
    // ========================================================================

    async _cpuChamfer(pointsA, pointsB, options) {
        const { chamferDistance } = await import('./ChamferDistance.js');
        return chamferDistance(pointsA, pointsB, options);
    }

    async _cpuHausdorff(pointsA, pointsB) {
        const { hausdorffDistance } = await import('./HausdorffDistance.js');
        return { distance: hausdorffDistance(pointsA, pointsB), aToB: 0, bToA: 0 };
    }

    /**
     * Destroy cached pipelines.
     */
    destroy() {
        this._pipelines = {};
        this._initialized = false;
    }
}

// ============================================================================
// CONVENIENCE FACTORY
// ============================================================================

let _instance = null;

/**
 * Get or create a singleton GPUMetrics instance.
 * @param {GPUDevice} device
 * @returns {GPUMetrics}
 */
export function getGPUMetrics(device) {
    if (!_instance || _instance.device !== device) {
        _instance?.destroy();
        _instance = new GPUMetrics(device);
    }
    return _instance;
}
