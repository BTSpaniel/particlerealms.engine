// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { FLOW_BOUNDS_WGSL, FLOW_STENCIL_WORDS, flowQueryWGSL, flowBoundaryStencilWGSL } from './flowSparse.js';
import { createSolidBoundaryOracle } from './solidBoundaryOracle.js';

/** Owns immutable-to-the-solver GPU copies of the last completed native field.
 * Snapshot copies precede the next native step on the same GPU queue. Ordinary
 * presentation never maps a buffer or stretches the sparse grid into a box. */
export class FlowSnapshot {
    static async create(device, shadowShader, boundarySource = '') {
        const cache = new FlowSnapshot(device, !!boundarySource);
        try {
            for (const [name, source, entryPoint = 'main'] of [['bounds', FLOW_BOUNDS_WGSL], ['query', flowQueryWGSL(boundarySource)], ['shadow', shadowShader],
                ...(boundarySource ? [['stencilBlocks', flowBoundaryStencilWGSL(boundarySource), 'blocks'],
                    ['stencils', flowBoundaryStencilWGSL(boundarySource), 'stencils']] : [])]) {
                const module = device.createShaderModule({ label: `Flow sparse ${name}`, code: source });
                const errors = (await module.getCompilationInfo()).messages.filter(message => message.type === 'error');
                if (errors.length) throw new Error(errors.map(message => `${name}:${message.lineNum}: ${message.message}`).join('\n'));
                cache[`${name}Pipeline`] = await device.createComputePipelineAsync({ label: `Flow sparse ${name}`, layout: 'auto', compute: { module, entryPoint } });
            }
            return cache;
        } catch (error) { cache.dispose(); throw error; }
    }
    constructor(device, solidBoundaries = false) {
        this.device = device; this.frame = -1; this.generation = 0; this.bytes = 0; this.copiedBytes = 0;
        this.solidBoundaries = solidBoundaries;
        this.params = new Uint32Array(40); this.scaleData = new Float32Array(4);
        try {
            this.metadata = device.createBuffer({ label: 'Flow snapshot metadata', size: 160, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
            this.scale = device.createBuffer({ label: 'Flow snapshot world scale', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
            this.bounds = device.createBuffer({ label: 'Flow snapshot active bounds', size: 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
            this.sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
        } catch (error) { this.dispose(); throw error; }
    }
    entries({ sampler = true } = {}) {
        return [{ binding: 0, resource: this.volumeView }, ...(sampler ? [{ binding: 1, resource: this.sampler }] : []),
            ...[this.table, this.metadata, this.scale].map((buffer, index) => ({ binding: index + 2, resource: { buffer } })),
            ...(this.solidBoundaries ? [{ binding: 16, resource: { buffer: this.boundaries } },
                { binding: 17, resource: { buffer: this.boundaryStencils } }] : [])];
    }
    /** Small, persistent GPU queries for surface heat exchange. This reads only
     * the requested values, never the native atlas or sparse table. The caller
     * serializes sampling with snapshot updates and owns the physical cadence. */
    async sample(positions) {
        if (this.frame < 0) throw new Error('No completed Flow snapshot');
        if (this.queryPending) throw new Error('Await the preceding Flow surface query');
        if (!positions || !positions.length || positions.length % 3 || !Array.from(positions).every(Number.isFinite))
            throw new RangeError('Flow surface queries need finite xyz positions');
        const count = positions.length / 3, bytes = count * 16, { device } = this;
        if (bytes > device.limits.maxStorageBufferBindingSize) throw new RangeError('Flow surface queries exceed the GPU storage limit');
        this.queryPending = true;
        try {
            if (!this.queryBuffers || this.queryCapacity < count) {
                const capacity = Math.min(Math.floor(device.limits.maxStorageBufferBindingSize / 16), 2 ** Math.ceil(Math.log2(count)));
                const owned = [];
                try {
                    for (const [label, usage] of [
                        ['positions', GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST],
                        ['values', GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC],
                        ['readback', GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST],
                    ]) owned.push(device.createBuffer({ label: `Flow surface ${label}`, size: capacity * 16, usage }));
                } catch (error) { for (const buffer of owned) buffer.destroy(); throw error; }
                for (const buffer of this.queryBuffers ?? []) buffer.destroy();
                this.queryBuffers = owned; this.queryCapacity = capacity;
                this.queryPositions = new Float32Array(capacity * 4);
            }
            const [queries, values, readback] = this.queryBuffers;
            for (let index = 0; index < count; ++index)
                for (let axis = 0; axis < 3; ++axis) this.queryPositions[index * 4 + axis] = positions[index * 3 + axis];
            device.queue.writeBuffer(queries, 0, this.queryPositions.subarray(0, count * 4));
            const group = device.createBindGroup({ layout: this.queryPipeline.getBindGroupLayout(0), entries: [...this.entries(),
                { binding: 5, resource: { buffer: queries, size: bytes } }, { binding: 6, resource: { buffer: values, size: bytes } }] });
            const encoder = device.createCommandEncoder({ label: 'Sample completed Flow at solid surfaces' });
            const pass = encoder.beginComputePass(); pass.setPipeline(this.queryPipeline); pass.setBindGroup(0, group);
            pass.dispatchWorkgroups(Math.ceil(count / 32)); pass.end();
            encoder.copyBufferToBuffer(values, 0, readback, 0, bytes); device.queue.submit([encoder.finish()]);
            await readback.mapAsync(GPUMapMode.READ, 0, bytes);
            const result = new Float32Array(readback.getMappedRange(0, bytes).slice(0));
            readback.unmap();
            if (!result.every(Number.isFinite)) throw new Error('Flow surface sample is nonfinite');
            return { frame: this.frame, values: result, readbackBytes: bytes };
        } finally {
            if (this.queryBuffers?.[2].mapState === 'mapped') this.queryBuffers[2].unmap();
            this.queryPending = false;
        }
    }
    update(output, frame, metadata, scale, boundaryGeometry = null) {
        const { device } = this, size = output.density.size, tableSize = output.sparse.size;
        const boundary = this.solidBoundaries ? output.boundaries : null;
        if (this.solidBoundaries && (boundary?.abi !== 1 || !boundary.buffer || boundary.size < 32 || boundary.size % 16))
            throw new Error('Completed Flow density requires its matching ABI1 solid geometry');
        // Canonical shape records are immutable once submitted by the adapter;
        // retain that generation for diagnostics instead of mapping GPU tables
        // during presentation. The independent oracle is built only on demand.
        this.boundaryGeometry = boundaryGeometry;
        if (boundary && (!this.boundaries || this.boundaries.size < boundary.size)) {
            const buffer = device.createBuffer({ label: 'Completed Flow exact solid boundaries', size: boundary.size,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
            this.boundaries?.destroy(); this.boundaries = buffer; ++this.generation;
        }
        const stencilCells = [0, 1, 2].reduce((count, axis) => count * (metadata[axis] + 2), 1);
        const requestedStencilBytes = Math.max(4, 4 * metadata[7] * (1 + FLOW_STENCIL_WORDS * stencilCells));
        this.stencilFallback = !Number.isSafeInteger(requestedStencilBytes)
            || requestedStencilBytes > Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize);
        const stencilBytes = this.stencilFallback ? 4 : requestedStencilBytes;
        if (boundary && (!this.boundaryStencils || this.boundaryStencils.size < stencilBytes)) {
            const buffer = device.createBuffer({ label: 'Completed Flow exact donor-stencil classification', size: stencilBytes,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
            this.boundaryStencils?.destroy(); this.boundaryStencils = buffer; ++this.generation;
        }
        const tile = [0, 1, 2].map(axis => ((metadata[axis] + 1) >> 2) + 2);
        const gridWidth = Math.max(1, Math.ceil(Math.cbrt(metadata[7]))), grid = [gridWidth, gridWidth, Math.max(1, Math.ceil(metadata[7] / (gridWidth * gridWidth)))];
        const lightSize = tile.map((value, axis) => value * grid[axis]);
        if (lightSize.some(value => value > device.limits.maxTextureDimension3D)) throw new RangeError('Sparse Flow light atlas exceeds the GPU 3D texture limit');
        const densityChanged = !this.texture || size.some((value, axis) => value !== this.size[axis]);
        const tableChanged = !this.table || tableSize !== this.tableSize;
        const lightChanged = !this.light || lightSize.some((value, axis) => value !== this.lightSize[axis]);
        if (densityChanged || tableChanged || lightChanged) {
            const owned = [];
            try {
                let { texture, table, light, volumeView, lightView } = this;
                if (densityChanged) {
                    texture = device.createTexture({ label: 'Completed Flow native density atlas', size, dimension: '3d', format: 'rgba32float',
                        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC }); owned.push(texture);
                    volumeView = texture.createView();
                }
                if (tableChanged) {
                    table = device.createBuffer({ label: 'Completed Flow native sparse table', size: tableSize,
                        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC }); owned.push(table);
                }
                if (lightChanged) {
                    light = device.createTexture({ label: 'Flow per-block coarse lighting atlas', size: lightSize, dimension: '3d', format: 'rgba16float',
                        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING }); owned.push(light);
                    lightView = light.createView();
                }
                // Active block counts often resize only the light atlas. Keep
                // unrelated copies and views alive, including on allocation failure.
                if (densityChanged) this.texture?.destroy();
                if (tableChanged) this.table?.destroy();
                if (lightChanged) this.light?.destroy();
                Object.assign(this, { texture, table, light, key: `${size.join(',')}:${tableSize}:${lightSize.join(',')}`, size: [...size], tableSize, lightSize,
                    volumeView, lightView });
                this.generation++;
            } catch (error) { for (const resource of owned) resource.destroy(); throw error; }
        }
        this.params.set(metadata); this.params.set(tile, 33); this.params.set(grid, 36);
        this.params[39] = device.limits.maxComputeWorkgroupsPerDimension * 64;
        this.scaleData.set(scale); this.nativeLevel = [...output.level]; this.layer = { ...output.layers.find(layer => layer.id === 0) };
        this.bytes = size.reduce((a, b) => a * b, 16) + tableSize + lightSize.reduce((a, b) => a * b, 8) + 208
            + (this.boundaries?.size ?? 0) + (this.boundaryStencils?.size ?? 0);
        device.queue.writeBuffer(this.metadata, 0, this.params); device.queue.writeBuffer(this.scale, 0, this.scaleData);
        device.queue.writeBuffer(this.bounds, 0, new Int32Array([2147483647, 2147483647, 2147483647, 0, -2147483648, -2147483648, -2147483648, 0]));
        // Cache capacity limits acceleration only. The original full BVH path
        // remains exact even when this device cannot store all local records.
        if (boundary && this.stencilFallback) device.queue.writeBuffer(this.boundaryStencils, 0, new Uint32Array([0xffffffff]));
        const encoder = device.createCommandEncoder({ label: 'Snapshot completed native Flow without a world clip' });
        encoder.copyTextureToTexture({ texture: output.density.texture }, { texture: this.texture }, size);
        encoder.copyBufferToBuffer(output.sparse.buffer, 0, this.table, 0, tableSize);
        if (boundary) encoder.copyBufferToBuffer(boundary.buffer, 0, this.boundaries, 0, boundary.size);
        if (metadata[7]) {
            if (this.updateBindings?.generation !== this.generation) {
                const bounds = device.createBindGroup({ layout: this.boundsPipeline.getBindGroupLayout(0), entries: [
                    { binding: 0, resource: { buffer: this.table } }, { binding: 1, resource: { buffer: this.metadata } }, { binding: 2, resource: { buffer: this.bounds } },
                ] });
                const shadow = device.createBindGroup({ layout: this.shadowPipeline.getBindGroupLayout(0), entries: [
                    ...this.entries(), { binding: 5, resource: this.lightView }, { binding: 6, resource: { buffer: this.bounds } },
                ] });
                const stencils = {};
                if (boundary) for (const name of ['stencilBlocks', 'stencils'])
                    stencils[name] = device.createBindGroup({ layout: this[`${name}Pipeline`].getBindGroupLayout(0),
                        entries: this.entries().filter(entry => [2, 3, 4, 16, 17].includes(entry.binding)) });
                this.updateBindings = { generation: this.generation, bounds, shadow, ...stencils };
            }
            if (boundary && !this.stencilFallback) for (const [name, label, invocations] of [
                ['stencilBlocks', 'Classify completed Flow boundary blocks', metadata[7]],
                ['stencils', 'Cache completed Flow donor-stencil overlap', metadata[7] * stencilCells],
            ]) {
                const pipeline = this[`${name}Pipeline`];
                const pass = encoder.beginComputePass({ label });
                const groups = Math.ceil(invocations / 64), limit = device.limits.maxComputeWorkgroupsPerDimension;
                pass.setPipeline(pipeline); pass.setBindGroup(0, this.updateBindings[name]);
                pass.dispatchWorkgroups(Math.min(groups, limit), Math.ceil(groups / limit)); pass.end();
            }
            const boundsPass = encoder.beginComputePass({ label: 'Reduce native sparse active-block bounds' });
            boundsPass.setPipeline(this.boundsPipeline); boundsPass.setBindGroup(0, this.updateBindings.bounds); boundsPass.dispatchWorkgroups(Math.ceil(metadata[7] / 64)); boundsPass.end();
            const shadowPass = encoder.beginComputePass({ label: 'Light every native sparse block' });
            shadowPass.setPipeline(this.shadowPipeline); shadowPass.setBindGroup(0, this.updateBindings.shadow);
            shadowPass.dispatchWorkgroups(Math.ceil(metadata[7] * tile.reduce((a, b) => a * b, 1) / 64)); shadowPass.end();
        }
        device.queue.submit([encoder.finish()]);
        this.copiedBytes += size.reduce((a, b) => a * b, 16) + tableSize + (boundary?.size ?? 0);
        this.frame = frame;
    }
    /** Explicit paused diagnostic. Independently reconstruct the eight virtual
     * cells on the CPU and compare arbitrary-world queries using renderer code. */
    async evidence(positions) {
        if (this.frame < 0) throw new Error('No completed Flow snapshot');
        if (!positions || positions.length < 3 || positions.length % 3 || positions.length > 96 || !Array.from(positions).every(Number.isFinite))
            throw new RangeError('Density evidence needs1–32 finite xyz positions');
        if (this.solidBoundaries && !this.boundaryGeometry) throw new Error('Solid density evidence needs the matching canonical geometry generation');
        const solids = this.solidBoundaries ? createSolidBoundaryOracle(this.boundaryGeometry) : null;
        const { device } = this, points = Array.from({ length: positions.length / 3 }, (_, index) => Array.from(positions).slice(index * 3, index * 3 + 3));
        const owned = [], create = (size, usage) => { const buffer = device.createBuffer({ size, usage }); owned.push(buffer); return buffer; };
        try {
            const queries = create(points.length * 16, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
            const values = create(points.length * 16, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
            const queryData = new Float32Array(points.length * 4); points.forEach((point, index) => queryData.set(point, index * 4));
            device.queue.writeBuffer(queries, 0, queryData);
            const [width, height, depth] = this.size, pitch = Math.ceil(width * 16 / 256) * 256;
            const usage = GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ;
            const resultRead = create(points.length * 16, usage), tableRead = create(this.tableSize, usage), atlasRead = create(pitch * height * depth, usage), boundsRead = create(32, usage);
            const encoder = device.createCommandEncoder({ label: 'Observe arbitrary-world sparse Flow' });
            const group = device.createBindGroup({ layout: this.queryPipeline.getBindGroupLayout(0), entries: [...this.entries(),
                { binding: 5, resource: { buffer: queries } }, { binding: 6, resource: { buffer: values } }] });
            const pass = encoder.beginComputePass(); pass.setPipeline(this.queryPipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(Math.ceil(points.length / 32)); pass.end();
            encoder.copyBufferToBuffer(values, 0, resultRead, 0, points.length * 16);
            encoder.copyBufferToBuffer(this.table, 0, tableRead, 0, this.tableSize);
            encoder.copyTextureToBuffer({ texture: this.texture }, { buffer: atlasRead, bytesPerRow: pitch, rowsPerImage: height }, this.size);
            encoder.copyBufferToBuffer(this.bounds, 0, boundsRead, 0, 32); device.queue.submit([encoder.finish()]);
            await Promise.all([resultRead, tableRead, atlasRead, boundsRead].map(buffer => buffer.mapAsync(GPUMapMode.READ)));
            const table = new Uint32Array(tableRead.getMappedRange()), atlas = new Float32Array(atlasRead.getMappedRange()), actual = new Float32Array(resultRead.getMappedRange());
            const level = this.nativeLevel, block = level.slice(0, 3).map(value => 2 * (value + 1));
            const mappings = Math.ceil((level[17] + level[7]) / 32) * 32;
            const cell = coordinate => {
                const location = coordinate.map((value, axis) => Math.floor(value / block[axis]));
                const bucket = location.map((value, axis) => value & level[8 + axis]);
                const hash = ((bucket[2] << level[13]) | (bucket[1] << level[12]) | bucket[0]) >>> 0;
                for (let i = table[hash * 2]; i < table[hash * 2 + 1]; i++) {
                    const address = level[15] + i * 4;
                    if (location.some((value, axis) => value !== (table[address + axis] | 0)) || table[address + 3] !== this.layer.layerAndLevel) continue;
                    const packed = table[mappings + i]; if (!(packed & 0x80000000)) return [0, 0, 0, 0];
                    const local = coordinate.map((value, axis) => ((value % block[axis]) + block[axis]) % block[axis]);
                    const texel = [((packed * 2 + 1) + local[0]) & 4095, (((packed >>> 10) | 1) + local[1]) & 2047, (((packed >>> 20) | 1) + local[2]) & 2047];
                    const offset = (texel[2] * height + texel[1]) * pitch / 4 + texel[0] * 4;
                    return [...atlas.subarray(offset, offset + 4)];
                }
                return [0, 0, 0, 0];
            };
            const samples = points.map((point, index) => {
                const coordinate = point.map((value, axis) => value * block[axis] / this.layer.blockSizeWorld[axis] - .5), base = coordinate.map(Math.floor);
                const fraction = coordinate.map((value, axis) => value - base[axis]), expected = [0, 0, 0, 0];
                const inside = solids?.pointInside(point) ?? false;
                let admitted = 0;
                for (let corner = 0; corner < 8; corner++) {
                    if (inside) break;
                    const side = [corner & 1, (corner >> 1) & 1, (corner >> 2) & 1];
                    const weight = side.reduce((value, bit, axis) => value * (bit ? fraction[axis] : 1 - fraction[axis]), 1);
                    const voxel = base.map((part, axis) => part + side[axis]);
                    const donor = voxel.map((value, axis) => (value + .5) * this.layer.blockSizeWorld[axis] / block[axis]);
                    if (solids && (solids.pointInside(donor) || solids.segmentEnters(point, donor))) continue;
                    admitted += weight;
                    const value = cell(voxel);
                    value.forEach((part, channel) => { expected[channel] += weight * part; });
                }
                if (solids && admitted > 0) expected.forEach((value, channel) => { expected[channel] = value / admitted; });
                const observed = [...actual.subarray(index * 4, index * 4 + 4)];
                if (![...observed, ...expected].every(Number.isFinite)) throw new Error('Nonfinite sparse density evidence');
                return { requestedPosition: point, worldPosition: point, voxel: base, actual: observed, expected, insideSolid: inside, admittedWeight: admitted,
                    maximumError: Math.max(...observed.map((value, channel) => Math.abs(value - Math.max(0, expected[channel])))) };
            });
            // Observation-only witness search in real resident cells. These
            // positions let tests query genuine gas beyond former display bounds
            // without injecting diagnostic values into the native simulation.
            const witnesses = {};
            for (let index = 0; index < level[7]; index++) {
                const address = level[15] + index * 4, packed = table[mappings + index];
                if (table[address + 3] !== this.layer.layerAndLevel || !(packed & 0x80000000)) continue;
                const location = [0, 1, 2].map(axis => table[address + axis] | 0);
                const origin = [((packed * 2 + 1) & 4095), ((packed >>> 10) | 1) & 2047, ((packed >>> 20) | 1) & 2047];
                for (let z = 0; z < block[2]; z++) for (let y = 0; y < block[1]; y++) for (let x = 0; x < block[0]; x++) {
                    const offset = ((origin[2] + z) * height + origin[1] + y) * pitch / 4 + (origin[0] + x) * 4;
                    const smoke = atlas[offset + 3], burn = atlas[offset + 2], score = Math.max(smoke, burn);
                    if (score < 1e-5) continue;
                    const position = [x, y, z].map((value, axis) => (location[axis] + (value + .5) / block[axis]) * this.layer.blockSizeWorld[axis]);
                    const kinds = [];
                    if (position[1] > 5.5) kinds.push('aboveFormerCeiling');
                    if (position[0] < .8 || position[0] > 5 || Math.abs(position[2]) > 1.5) kinds.push('outsideFormerSides');
                    if (location.some(value => value < 0)) kinds.push('negativeBlock');
                    if ([x, y, z].some((value, axis) => value === 0 || value === block[axis] - 1)) kinds.push('activeBlockEdge');
                    for (const kind of kinds) if (!witnesses[kind] || score > witnesses[kind].score)
                        witnesses[kind] = { worldPosition: position, nativeValues: [...atlas.subarray(offset, offset + 4)], score };
                }
            }
            const bound = [...new Int32Array(boundsRead.getMappedRange())];
            return { frame: this.frame, densityFrame: this.frame, channels: ['temperature', 'fuel', 'burn', 'smoke'], nativeAtlasSize: [...this.size],
                representation: 'native-sparse-atlas', worldBounds: { lower: bound.slice(0, 3).map((value, axis) => value * this.layer.blockSizeWorld[axis]),
                    upper: bound.slice(4, 7).map((value, axis) => value * this.layer.blockSizeWorld[axis]), activeBlocks: bound[3] },
                witnesses, maximumError: Math.max(...samples.map(sample => sample.maximumError)), samples };
        } finally { for (const buffer of owned) { if (buffer.mapState === 'mapped') buffer.unmap(); buffer.destroy(); } }
    }
    dispose() {
        for (const resource of [this.texture, this.table, this.light, this.metadata, this.scale, this.bounds, this.boundaries, this.boundaryStencils]) resource?.destroy();
        for (const buffer of this.queryBuffers ?? []) buffer.destroy();
        this.queryBuffers = null; this.updateBindings = null;
        this.frame = -1; this.bytes = 0;
    }
}
