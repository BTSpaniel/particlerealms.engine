// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * ParticleIndirectDispatch.js - GPU-driven indirect draw + dispatch
 * 
 * Replaces CPU-side particle count tracking for rendering and compute dispatch.
 * A small "scan alive" compute pass runs once per frame, atomically counting alive
 * particles and finding the highest alive slot. A "finalize" micro-pass writes
 * the results into draw indirect and dispatch indirect buffers.
 * 
 * Benefits:
 * - Eliminates CPU→GPU sync for particle counts
 * - drawIndirect uses GPU-computed instance count
 * - dispatchWorkgroupsIndirect uses GPU-computed workgroup count
 * - Prepares infrastructure for full alive list compaction (Phase 3)
 * 
 * Ref: Wicked Engine GPU particle architecture, UE5 Niagara indirect dispatch
 */

import { createUniformBuffer, updateBuffer } from "../../core/gpu/GpuBuffer.js";
import { labelResource } from "../../core/gpu/GpuDebug.js";

// ============================================================================
// SCAN + FINALIZE SHADER
// ============================================================================

const INDIRECT_DISPATCH_SHADER = `
struct ScanParams {
    maxSlots: u32,
    workgroupSize: u32,
    _pad0: u32,
    _pad1: u32,
}

// Counters buffer: aliveCount (u32) + highestAliveSlot (u32) + freeCount (u32) + reserved (u32)
// Must be zeroed by CPU before each scan
@group(0) @binding(0) var<uniform> params: ScanParams;
@group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> velocities: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> counters: array<atomic<u32>>;
// counters[0] = aliveCount, counters[1] = highestAliveSlot, counters[2] = freeCount

// Alive list: compact array of alive particle slot indices
@group(0) @binding(6) var<storage, read_write> aliveList: array<u32>;
// Free list: compact array of dead particle slot indices (for GPU event spawn)
@group(0) @binding(8) var<storage, read_write> freeList: array<u32>;

@compute @workgroup_size(256)
fn scanAlive(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= params.maxSlots) { return; }

    let age = positions[i].w;
    let lifetime = velocities[i].w;

    // Alive check (same as dead particle early-out in other shaders)
    if (age < lifetime) {
        let writeIdx = atomicAdd(&counters[0], 1u);
        atomicMax(&counters[1], i);
        aliveList[writeIdx] = i;
    } else if (lifetime > 0.0) {
        // Dead particle with valid lifetime → add to free list for slot reuse
        let freeIdx = atomicAdd(&counters[2], 1u);
        freeList[freeIdx] = i;
    }
}

// Draw indirect buffer layout: vertexCount, instanceCount, firstVertex, firstInstance
// Dispatch indirect buffer layout: workgroupsX, workgroupsY, workgroupsZ
@group(0) @binding(4) var<storage, read_write> drawArgs: array<u32>;
@group(0) @binding(5) var<storage, read_write> dispatchArgs: array<u32>;
// Alive-count dispatch args: for compute passes using alive list indirection
@group(0) @binding(7) var<storage, read_write> aliveDispatchArgs: array<u32>;

@compute @workgroup_size(1)
fn finalizeIndirect() {
    let aliveCount = atomicLoad(&counters[0]);
    let highestSlot = atomicLoad(&counters[1]);
    let slotCount = select(0u, highestSlot + 1u, aliveCount > 0u);

    // Draw indirect args: use aliveCount for instanced rendering
    // Emitter particles occupy sequential low-index slots (0..N), so instance_index
    // maps directly to the correct buffer slot. Rope/PBD particles at high slots (99748+)
    // are excluded because aliveCount only covers the draw range, not the full slot range.
    drawArgs[0] = 6u;          // vertexCount (6 = 2 triangles per quad)
    drawArgs[1] = aliveCount;  // instanceCount
    drawArgs[2] = 0u;          // firstVertex
    drawArgs[3] = 0u;          // firstInstance

    // Slot-range dispatch args (for passes that iterate all slots)
    let wgSize = max(params.workgroupSize, 1u);
    dispatchArgs[0] = (slotCount + wgSize - 1u) / wgSize;
    dispatchArgs[1] = 1u;
    dispatchArgs[2] = 1u;

    // Alive-count dispatch args (for passes using alive list indirection)
    aliveDispatchArgs[0] = (aliveCount + wgSize - 1u) / wgSize;
    aliveDispatchArgs[1] = 1u;
    aliveDispatchArgs[2] = 1u;
}
`;

// ============================================================================
// SYSTEM
// ============================================================================

/**
 * Create the indirect dispatch system.
 * @param {GPUDevice} device
 * @param {number} maxParticles - Maximum particle count
 * @param {number} workgroupSize - Workgroup size for compute shaders (default 256)
 */
export function createIndirectDispatchSystem(device, maxParticles, workgroupSize = 256) {
    const shaderModule = device.createShaderModule({
        label: "IndirectDispatch.shader",
        code: INDIRECT_DISPATCH_SHADER,
    });

    // Params uniform (16 bytes)
    const paramsBuffer = createUniformBuffer(device, 16, { label: "IndirectDispatch.params" });
    labelResource(paramsBuffer, "IndirectDispatch.params");
    const paramsData = new Uint32Array([maxParticles, workgroupSize, 0, 0]);
    updateBuffer(device, paramsBuffer, paramsData, 0);

    // Counter buffer: 4 × u32 (aliveCount, highestAliveSlot, freeCount, reserved)
    // STORAGE + COPY_DST so CPU can zero it each frame
    const counterBuffer = device.createBuffer({
        label: "IndirectDispatch.counters",
        size: 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    labelResource(counterBuffer, "IndirectDispatch.counters");

    // Free list buffer: compact array of dead particle indices (for GPU event spawn)
    const freeListBuffer = device.createBuffer({
        label: "IndirectDispatch.freeList",
        size: maxParticles * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    labelResource(freeListBuffer, "IndirectDispatch.freeList");

    // Alive list buffer: compact array of alive particle indices (maxParticles × u32)
    const aliveListBuffer = device.createBuffer({
        label: "IndirectDispatch.aliveList",
        size: maxParticles * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    labelResource(aliveListBuffer, "IndirectDispatch.aliveList");

    // Draw indirect buffer: 4 × u32 (vertexCount, instanceCount, firstVertex, firstInstance)
    const drawIndirectBuffer = device.createBuffer({
        label: "IndirectDispatch.drawIndirect",
        size: 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
    });
    labelResource(drawIndirectBuffer, "IndirectDispatch.drawIndirect");
    // Initialize with safe defaults (0 instances)
    device.queue.writeBuffer(drawIndirectBuffer, 0, new Uint32Array([6, 0, 0, 0]));

    // Dispatch indirect buffer: 3 × u32 (workgroupsX, workgroupsY, workgroupsZ)
    const dispatchIndirectBuffer = device.createBuffer({
        label: "IndirectDispatch.dispatchIndirect",
        size: 12,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
    });
    labelResource(dispatchIndirectBuffer, "IndirectDispatch.dispatchIndirect");
    // Initialize with 0 workgroups
    device.queue.writeBuffer(dispatchIndirectBuffer, 0, new Uint32Array([0, 1, 1]));

    // Alive-count dispatch indirect buffer: dispatches only aliveCount threads
    const aliveDispatchBuffer = device.createBuffer({
        label: "IndirectDispatch.aliveDispatch",
        size: 12,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
    });
    labelResource(aliveDispatchBuffer, "IndirectDispatch.aliveDispatch");
    device.queue.writeBuffer(aliveDispatchBuffer, 0, new Uint32Array([0, 1, 1]));

    // Scan pipeline
    const scanPipeline = device.createComputePipeline({
        label: "IndirectDispatch.scanPipeline",
        layout: "auto",
        compute: { module: shaderModule, entryPoint: "scanAlive" },
    });

    // Finalize pipeline
    const finalizePipeline = device.createComputePipeline({
        label: "IndirectDispatch.finalizePipeline",
        layout: "auto",
        compute: { module: shaderModule, entryPoint: "finalizeIndirect" },
    });

    console.log(`[IndirectDispatch] GPU-driven indirect draw + dispatch initialized (maxSlots: ${maxParticles}, wgSize: ${workgroupSize}, aliveList: ${(maxParticles * 4 / 1024).toFixed(0)}KB)`);
    return {
        paramsBuffer,
        counterBuffer,
        aliveListBuffer,
        freeListBuffer,
        drawIndirectBuffer,
        dispatchIndirectBuffer,
        aliveDispatchBuffer,
        scanPipeline,
        finalizePipeline,
        scanBindGroup: null,
        finalizeBindGroup: null,
        maxParticles,
        workgroupSize,
        _zeroData: new Uint32Array([0, 0, 0, 0]),
    };
}

/**
 * Initialize bind groups. Call after position/velocity buffers are available.
 */
export function initIndirectDispatchBindGroups(system, device, positionsBuffer, velocitiesBuffer) {
    if (!system) return;

    // Scan bind group (bindings 0-3, 6)
    system.scanBindGroup = device.createBindGroup({
        label: "IndirectDispatch.scanBindGroup",
        layout: system.scanPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: system.paramsBuffer } },
            { binding: 1, resource: { buffer: positionsBuffer } },
            { binding: 2, resource: { buffer: velocitiesBuffer } },
            { binding: 3, resource: { buffer: system.counterBuffer } },
            { binding: 6, resource: { buffer: system.aliveListBuffer } },
            { binding: 8, resource: { buffer: system.freeListBuffer } },
        ],
    });

    // Finalize bind group (bindings used by finalizeIndirect: 0, 3, 4, 5, 7)
    system.finalizeBindGroup = device.createBindGroup({
        label: "IndirectDispatch.finalizeBindGroup",
        layout: system.finalizePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: system.paramsBuffer } },
            { binding: 3, resource: { buffer: system.counterBuffer } },
            { binding: 4, resource: { buffer: system.drawIndirectBuffer } },
            { binding: 5, resource: { buffer: system.dispatchIndirectBuffer } },
            { binding: 7, resource: { buffer: system.aliveDispatchBuffer } },
        ],
    });
}

/**
 * Execute the scan + finalize passes. Run ONCE per frame, before any other particle work.
 * After this call, drawIndirectBuffer and dispatchIndirectBuffer contain GPU-computed values.
 */
export function executeIndirectScan(system, device, options = {}) {
    if (!system || !system.scanBindGroup || !system.finalizeBindGroup) return;

    // Zero counter buffer (CPU write, 8 bytes — negligible cost)
    device.queue.writeBuffer(system.counterBuffer, 0, system._zeroData);

    const externalEncoder = options && options.encoder ? options.encoder : null;
    const encoder = externalEncoder || device.createCommandEncoder({ label: "IndirectDispatch.encoder" });

    // Pass 1: Scan alive particles (parallel, 1 thread per slot)
    const scanPass = encoder.beginComputePass({ label: "IndirectDispatch.scan" });
    scanPass.setPipeline(system.scanPipeline);
    scanPass.setBindGroup(0, system.scanBindGroup);
    scanPass.dispatchWorkgroups(Math.ceil(system.maxParticles / 256));
    scanPass.end();

    // Pass 2: Finalize indirect args (single thread)
    const finalizePass = encoder.beginComputePass({ label: "IndirectDispatch.finalize" });
    finalizePass.setPipeline(system.finalizePipeline);
    finalizePass.setBindGroup(0, system.finalizeBindGroup);
    finalizePass.dispatchWorkgroups(1);
    finalizePass.end();

    if (!externalEncoder) {
        device.queue.submit([encoder.finish()]);
    }
    return { encoded: true, submitted: !externalEncoder };
}

/**
 * Update maxSlots (e.g., when particle capacity changes).
 */
export function updateIndirectMaxSlots(system, device, maxSlots) {
    if (!system) return;
    system.maxParticles = maxSlots;
    const paramsData = new Uint32Array([maxSlots, system.workgroupSize, 0, 0]);
    updateBuffer(device, system.paramsBuffer, paramsData, 0);
}

/**
 * Destroy indirect dispatch system resources.
 */
export function destroyIndirectDispatchSystem(system) {
    if (!system) return;
    if (system.paramsBuffer) system.paramsBuffer.destroy();
    if (system.counterBuffer) system.counterBuffer.destroy();
    if (system.aliveListBuffer) system.aliveListBuffer.destroy();
    if (system.freeListBuffer) system.freeListBuffer.destroy();
    if (system.drawIndirectBuffer) system.drawIndirectBuffer.destroy();
    if (system.dispatchIndirectBuffer) system.dispatchIndirectBuffer.destroy();
    if (system.aliveDispatchBuffer) system.aliveDispatchBuffer.destroy();
    system.scanBindGroup = null;
    system.finalizeBindGroup = null;
}
