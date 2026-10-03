// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { WOVEN_GPU_SOLVER } from './WovenClothGpuShaders.js';
import { createWovenPlyGraph } from './WovenPlyGraph.js';

/** GPU-owned woven state. The WovenCloth input is used only as an authoring
 * graph; its CPU step/contact methods are never called by this backend.
 */
export class GpuWovenCloth {
    static async create(device, cloth, construction = {}) {
        const result = new GpuWovenCloth(device, cloth, construction);
        try { await result.initialize(); return result; }
        catch (error) { result.destroy(); throw error; }
    }
    constructor(device, cloth, construction = {}) {
        this.construction = construction;
        this.device = device; this.cloth = cloth; this.buffers = []; this.disposed = false;
        this.steps = 0; this.nextBall = 0; this.pending = null; this.stats = { backend: 'webgpu-resident-woven', steps: 0 };
        this.broadPhase = true;
        this.batchDispatches = true;
        this.optimizedKernels = true;
    }
    buffer(data, label, usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC) {
        const size = typeof data === 'number' ? data : data.byteLength;
        const buffer = this.device.createBuffer({ label: `Woven ${label}`, size: Math.max(16, size), usage, mappedAtCreation: typeof data !== 'number' });
        this.buffers.push(buffer);
        if (typeof data !== 'number') { new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)); buffer.unmap(); }
        return buffer;
    }
    async initialize() {
        const cloth = this.cloth, device = this.device;
        const graph = createWovenPlyGraph(cloth, this.construction);
        const { colors, nodes:nodeData, links:linkData, cells:cellData } = graph;
        this.plyCount = graph.plyCount; this.twists = graph.twists; this.direction = graph.direction;
        this.strengthVariation = graph.strengthVariation; this.linkStride = 64;
        this.count = nodeData.length / 12 - 12; this.total = this.count + 12;
        this.crossingOffset = graph.crossingOffset;
        const edgeCount = graph.edgeCount, linkCount = linkData.byteLength / 64;
        this.nodeBuffer = this.buffer(nodeData, 'resident nodes'); this.linkBuffer = this.buffer(linkData, 'resident topology');
        this.cellBuffer = this.buffer(cellData, 'cells'); this.airBuffer = this.buffer(this.count * 16, 'air');
        this.deltaBuffer = this.buffer(this.total * 16, 'contact corrections'); this.receiptBuffer = this.buffer(96, 'receipt');
        this.boundTiles = Math.max(Math.ceil(this.total / 64), Math.ceil(edgeCount / 64));
        const boundRecords = Math.ceil(this.total / 64) + cloth.cells.length * 8 + edgeCount + Math.ceil(edgeCount / 64);
        // Reserve the mathematical worst case, never a lossy fixed-size queue.
        const candidates = Math.ceil(this.total / 64) * cloth.cells.length * 2 + Math.ceil(edgeCount / 64) * edgeCount;
        // Small meshes cost less to dispatch directly than to compact and copy.
        this.candidateCount = candidates >= 32768 && candidates <= Math.min(0xffffff, device.limits.maxComputeWorkgroupsPerDimension * 64)
            && (boundRecords + 1 + candidates) * 32 <= device.limits.maxStorageBufferBindingSize ? candidates : 0;
        this.boundsBuffer = this.buffer((boundRecords + 1 + this.candidateCount) * 32, 'swept bounds, face cache and contact candidates');
        this.indirectBuffer = this.buffer(16, 'contact dispatch arguments', GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST);
        this.curveBuffer = this.buffer(new Float32Array([...cloth.material.warp.points.flat(), ...cloth.material.weft.points.flat()]), 'directional sewing curves');
        this.uniform = this.buffer(96, 'parameters', GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
        this.parameters = new ArrayBuffer(96); this.u32 = new Uint32Array(this.parameters); this.f32 = new Float32Array(this.parameters);
        this.u32.set([this.count, linkCount, cloth.cells.length, 12, cloth.columns, cloth.rows, this.crossingOffset, edgeCount]);
        this.f32.set([1 / 480, -9.81, 0, 0, cloth.fiberProperties.damping, cloth.tearForce, graph.radius, cloth.width * cloth.height / this.count], 8);
        this.f32[19] = 1;
        this.u32.set([cloth.material.warp.points.length, cloth.material.weft.points.length, 0, 0], 20);
        this.u32[22] = this.candidateCount;
        device.queue.writeBuffer(this.uniform, 0, this.parameters);
        this.layout = device.createBindGroupLayout({ entries: Array.from({ length: 10 }, (_, binding) => ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type: [3, 7].includes(binding) ? 'uniform' : [2, 6, 9].includes(binding) ? 'read-only-storage' : 'storage' } })) });
        const shader = device.createShaderModule({ label: 'Resident woven physics', code: WOVEN_GPU_SOLVER });
        const info = await shader.getCompilationInfo();
        if (info.messages.some(m => m.type === 'error')) throw new Error(info.messages.filter(m => m.type === 'error').map(m => `${m.lineNum}: ${m.message}`).join('\n'));
        const layout = device.createPipelineLayout({ bindGroupLayouts: [this.layout] });
        this.pipelines = Object.fromEntries(await Promise.all(['integrate', 'resetLambda', 'distance', 'fracture', 'releaseCrossings', 'weave', 'featureBounds', 'tileBounds', 'contactCandidates', 'contactArguments', 'compactContact', 'clearContact', 'vertexTriangle', 'edgeContact', 'sphereYarn', 'spherePairs', 'applyContact', 'finish', 'edit', 'summarize'].map(async entryPoint => [entryPoint, await device.createComputePipelineAsync({ label: `Woven ${entryPoint}`, layout, compute: { module: shader, entryPoint } })])));
        const group = range => {
            const buffer = this.buffer(new Uint32Array([...range, 0, 0].slice(0, 4)), 'range', GPUBufferUsage.UNIFORM);
            return device.createBindGroup({ layout: this.layout, entries: [this.nodeBuffer, this.linkBuffer, this.cellBuffer, this.uniform, this.deltaBuffer, this.receiptBuffer, this.airBuffer, buffer, this.boundsBuffer, this.curveBuffer].map((buffer, binding) => ({ binding, resource: { buffer } })) });
        };
        this.groups = colors.map(color => ({ offset: color[0], count: color[1], bind: group(color) }));
        this.reverseGroups = [...this.groups].reverse();
        this.weaveGroups = Array.from({ length: 9 }, (_, i) => group([i, 0])); this.defaultGroup = group([0, 0]);
        this.weaveCounts = this.weaveGroups.map((_, i) => Math.ceil((cloth.columns - i % 3) / 3) * Math.ceil((cloth.rows - Math.floor(i / 3)) / 3) * this.plyCount);
        this.readBuffer = this.buffer(96, 'diagnostics readback', GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
        const initial = device.createCommandEncoder({ label: 'Woven initial receipt' });
        this.dispatch(initial, 'summarize', 1); device.queue.submit([initial.finish()]);
    }
    dispatch(encoder, name, x = this.total, y = 1, bind = this.defaultGroup) {
        const ownsPass = typeof encoder.beginComputePass === 'function';
        const pass = ownsPass ? encoder.beginComputePass({ label: `Woven ${name}` }) : encoder;
        pass.setPipeline(this.pipelines[name]); pass.setBindGroup(0, bind); pass.dispatchWorkgroups(Math.ceil(x / 64), y);
        if (ownsPass) pass.end();
    }
    dispatchContacts(encoder) {
        const ownsPass = typeof encoder.beginComputePass === 'function';
        const pass = ownsPass ? encoder.beginComputePass({ label: 'Woven compact contacts' }) : encoder;
        pass.setPipeline(this.pipelines.compactContact); pass.setBindGroup(0, this.defaultGroup);
        pass.dispatchWorkgroupsIndirect(this.indirectBuffer, 0);
        if (ownsPass) pass.end();
    }
    step({ wind = 0, air = false, tearForce = this.cloth.tearForce } = {}) {
        if (this.disposed) throw new Error('Woven GPU is disposed');
        if (![wind, tearForce].every(Number.isFinite) || tearForce <= 0 || Math.abs(wind) > 100) throw new RangeError('Invalid woven forces');
        this.f32[10] = wind; this.f32[11] = Number(air); this.f32[13] = tearForce; this.f32[16] = 0;
        this.f32[18] = Number(this.broadPhase);
        this.f32[19] = Number(this.optimizedKernels);
        this.device.queue.writeBuffer(this.uniform, 0, this.parameters);
        const encoder = this.device.createCommandEncoder({ label: 'Resident woven substeps' });
        // Dispatches remain ordered with storage dependencies between them.
        // One pass avoids hundreds of pass setup/teardown operations per step.
        let commands = this.batchDispatches ? encoder.beginComputePass({ label: 'Woven ordered solve' }) : encoder;
        for (let substep = 0; substep < 4; substep++) {
            this.dispatch(commands, 'integrate'); this.dispatch(commands, 'resetLambda', this.u32[1]);
            this.dispatch(commands, 'releaseCrossings', this.count / 2);
            for (let iteration = 0; iteration < 4; iteration++) {
                const groups = iteration % 2 ? this.reverseGroups : this.groups;
                for (const group of groups) this.dispatch(commands, 'distance', group.count, 1, group.bind);
                for (let i = 0; i < this.weaveGroups.length; i++) this.dispatch(commands, 'weave', this.optimizedKernels ? this.weaveCounts[i] : this.count / 2, 1, this.weaveGroups[i]);
            }
            this.dispatch(commands, 'fracture', this.u32[7]);
            this.dispatch(commands, 'releaseCrossings', this.count / 2);
            for (let iteration = 0; iteration < 4; iteration++) {
                if (this.broadPhase) {
                    this.dispatch(commands, 'featureBounds', Math.max(this.u32[2] * 2, this.u32[7]));
                    this.dispatch(commands, 'tileBounds', this.boundTiles);
                }
                this.dispatch(commands, 'clearContact');
                if (this.optimizedKernels && this.broadPhase && this.candidateCount) {
                    this.dispatch(commands, 'contactCandidates', this.candidateCount);
                    this.dispatch(commands, 'contactArguments', 1);
                    if (this.batchDispatches) commands.end();
                    // A separate indirect buffer avoids writable-storage/indirect
                    // usage aliasing. Only twelve GPU-owned bytes are copied.
                    encoder.copyBufferToBuffer(this.receiptBuffer, 84, this.indirectBuffer, 0, 12);
                    commands = this.batchDispatches ? encoder.beginComputePass({ label: 'Woven candidate solve' }) : encoder;
                    this.dispatchContacts(commands);
                } else {
                    this.dispatch(commands, 'vertexTriangle', this.total, this.u32[2] * 2);
                    this.dispatch(commands, 'edgeContact', this.u32[7], this.u32[7]);
                }
                this.dispatch(commands, 'sphereYarn', this.u32[7], 12);
                this.dispatch(commands, 'spherePairs', 12, 12);
                this.dispatch(commands, 'applyContact');
            }
            this.dispatch(commands, 'finish');
        }
        this.dispatch(commands, 'summarize', 1);
        if (this.batchDispatches) commands.end();
        this.device.queue.submit([encoder.finish()]); this.stats.steps = ++this.steps;
    }
    throwBall(position, velocity, { radius = .22, mass = .9 } = {}) {
        if (this.disposed) throw new Error('Woven GPU is disposed');
        if (![...position, ...velocity, radius, mass].every(Number.isFinite) || position.length !== 3 || velocity.length !== 3 || radius <= 0 || mass <= 0) throw new RangeError('Invalid GPU sphere');
        const id = this.count + this.nextBall++ % 12;
        this.device.queue.writeBuffer(this.nodeBuffer, id * 48, new Float32Array([...position, 1 / mass, ...position, radius, ...velocity, 0]));
    }
    edit(command, value) {
        if (this.disposed) throw new Error('Woven GPU is disposed');
        this.f32[16] = command; this.f32[17] = value;
        this.device.queue.writeBuffer(this.uniform, 0, this.parameters);
        const encoder = this.device.createCommandEncoder(); this.dispatch(encoder, 'edit', Math.max(this.count, this.u32[1]));
        this.dispatch(encoder, 'releaseCrossings', this.count / 2); this.dispatch(encoder, 'summarize', 1); this.device.queue.submit([encoder.finish()]);
    }
    releasePins() { this.edit(1, this.cloth.rest.find(p => p[3] > 0)[3] * this.plyCount); }
    cut() { this.edit(2, .3); }
    async readStats() {
        if (this.disposed || this.pending) return;
        this.pending = (async () => {
            const encoder = this.device.createCommandEncoder(); encoder.copyBufferToBuffer(this.receiptBuffer, 0, this.readBuffer, 0, 96); this.device.queue.submit([encoder.finish()]);
            await this.readBuffer.mapAsync(GPUMapMode.READ);
            try {
                const data = new Uint32Array(this.readBuffer.getMappedRange()), floats = new Float32Array(data.buffer);
                Object.assign(this.stats, { warpStrain: floats[16], weftStrain: floats[17], partialSegments: data[18], fastSegments: data[19], fastExposed: data[20], physicalPlies: this.plyCount * (this.cloth.columns + this.cloth.rows), contacts: data[1], selfContacts: data[2], broken: data[3], panels: data[4], speculativeContacts: data[5], invalidState: data[6], balls: data[7], ballSpeed: floats[8], airSpeed: floats[9], activeSegments: data[10], exposedSegments: data[11], releasedCrossings: data[12], maximumForce: floats[13], airImpulse: floats[14], ballImpulse: data[15] / 100000 });
            } finally { this.readBuffer.unmap(); }
        })();
        try { await this.pending; } finally { this.pending = null; }
        return this.stats;
    }
    async snapshot() {
        if (this.disposed) throw new Error('Woven GPU is disposed');
        const size = this.total * 48 + this.u32[1] * this.linkStride, buffer = this.device.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
        try {
            const encoder = this.device.createCommandEncoder(); encoder.copyBufferToBuffer(this.nodeBuffer, 0, buffer, 0, this.total * 48);
            encoder.copyBufferToBuffer(this.linkBuffer, 0, buffer, this.total * 48, this.u32[1] * this.linkStride); this.device.queue.submit([encoder.finish()]);
            await buffer.mapAsync(GPUMapMode.READ); const data = buffer.getMappedRange().slice(0); buffer.unmap(); return data;
        } finally { buffer.destroy(); }
    }
    destroy() { this.disposed = true; for (const buffer of this.buffers) buffer.destroy(); this.buffers.length = 0; }
}
