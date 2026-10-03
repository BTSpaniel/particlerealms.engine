// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { TectonicSimulation } from './TectonicSimulation.js';
import { HydraulicErosion } from './HydraulicErosion.js';
import { ThermalErosion } from './ThermalErosion.js';
import { normalizeTerrainHeightfield } from './TerrainHeightfield.js';
import { NOISE_LIBRARY_WGSL } from './TerrainNoiseLibrary.js';

export const TERRAIN_BAKE_DEFAULTS = Object.freeze({ seed: 9321, gridResolution: 96, worldSize: 160,
    baseRelief: 38, baseFrequency: .012, plateCount: 6, segmentCount: 4096, tectonicSteps: 32, hydraulicSteps: 160, rainfall: 1024,
    rainBatches: 4, erosionRate: .08, depositionRate: .25, inertia: .35, thermalSteps: 32, thermalMaterial: 2, thermalTransferRate: .18 });
const RULES = {
    seed: [0, 4294967295, true], gridResolution: [32, 128, true], worldSize: [32, 4096],
    baseRelief: [1, 200], baseFrequency: [.002, .15],
    plateCount: [2, 16, true], segmentCount: [256, 8192, true], tectonicSteps: [1, 512, true],
    hydraulicSteps: [0, 512, true], rainfall: [0, 8192, true], rainBatches: [1, 32, true],
    erosionRate: [0, 1], depositionRate: [0, 1], inertia: [.01, 1], thermalSteps: [0, 256, true], thermalMaterial: [1, 4, true], thermalTransferRate: [0, 1],
};

export function normalizeTerrainBakeConfig(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !Object.hasOwn(RULES, key))) throw new TypeError('Invalid terrain bake configuration');
    const config = Object.fromEntries(Object.entries(RULES).map(([key, [min, max, integer]]) => {
        const number = value[key] ?? TERRAIN_BAKE_DEFAULTS[key];
        if (!Number.isFinite(number) || number < min || number > max || integer && !Number.isInteger(number)) throw new TypeError(`Terrain ${key} is outside its authored bounds`);
        return [key, number];
    }));
    // Plate centers use signed 32-bit sums at 1000 units per metre. Bound the
    // worst case even when all segments belong to a single plate.
    if (config.worldSize * config.segmentCount * 1000 > 4000000000) throw new TypeError('Terrain extent and segment count exceed the tectonic accumulator range');
    return config;
}

/** Run actual engine compute systems once and return portable, exact samples.
 * The caller supplies its authorized device/one-shot scope; no device is acquired
 * or destroyed here. A failed/aborted bake never returns an invented landscape. */
export async function bakeTerrainHeightfield(device, options = {}, { signal, onProgress } = {}) {
    const config = normalizeTerrainBakeConfig(options), size = config.gridResolution;
    const owned = [], tectonics = new TectonicSimulation(), hydrology = new HydraulicErosion(), thermal = new ThermalErosion();
    const check = () => { if (signal?.aborted) throw signal.reason ?? new DOMException('Terrain bake aborted', 'AbortError'); };
    const progress = (phase, current, total) => { check(); onProgress?.({ phase, current, total }); };
    // OS facades admit finite synchronous queue work. Awaiting GPU completion
    // happens outside each scope; no callback leaks asynchronous authority.
    const scoped = action => typeof device.runOneShot === 'function'
        ? device.runOneShot({ kind: 'job', maxOperations: 32, maxSubmissions: 1, maxBytes: 8 * 1024 * 1024, durationMs: 1000 }, action)
        : action();
    const initialize = async action => { let pending; scoped(() => { pending = action(); }); await pending; check(); };
    const submit = async encode => {
        check(); let completion;
        scoped(() => { const encoder = device.createCommandEncoder({ label: 'terrain-bake' }); encode(encoder);
            device.queue.submit([encoder.finish()]); completion = device.queue.onSubmittedWorkDone(); });
        await completion; check();
    };
    const readBuffer = async (source, bytes, Type = Float32Array) => {
        const buffer = device.createBuffer({ label: 'terrain-bake-readback', size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }); owned.push(buffer);
        await submit(encoder => encoder.copyBufferToBuffer(source, 0, buffer, 0, bytes));
        await buffer.mapAsync(GPUMapMode.READ);
        try { return new Type(buffer.getMappedRange().slice(0)); } finally { buffer.unmap(); }
    };
    const readTexture = async texture => {
        const stride = Math.ceil(size * 4 / 256) * 256;
        const buffer = device.createBuffer({ label: 'terrain-bake-height-readback', size: stride * size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }); owned.push(buffer);
        await submit(encoder => encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: stride }, [size, size]));
        await buffer.mapAsync(GPUMapMode.READ);
        try {
            const padded = new Float32Array(buffer.getMappedRange()), values = new Float32Array(size * size);
            for (let row = 0; row < size; row++) values.set(padded.subarray(row * stride / 4, row * stride / 4 + size), row * size);
            return values;
        } finally { buffer.unmap(); }
    };
    try {
        check();
        // The world generator's existing seeded mountain/noise library authors
        // the initial bedrock. Tectonic motion then evolves this coherent field,
        // rather than randomly assigning unrelated elevations to tiny segments.
        const initialTexture = device.createTexture({ label: 'terrain-bake-initial-bedrock', size: [size, size], format: 'r32float',
            usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING }); owned.push(initialTexture);
        const baseModule = device.createShaderModule({ label: 'engine-mountain-bedrock', code: `${NOISE_LIBRARY_WGSL}
@group(0) @binding(0) var output: texture_storage_2d<r32float,write>;
@compute @workgroup_size(8,8)
fn seed_mountains(@builtin(global_invocation_id) gid:vec3u) {
 if(gid.x>=${size}u || gid.y>=${size}u){return;}
 let world=(vec2f(gid.xy)/${size}.0-vec2f(.5))*${config.worldSize.toFixed(6)};
 let point=vec3f(world.x,0.0,world.y)*${config.baseFrequency.toFixed(6)};
 let warped=domainWarp(point,${config.seed}u,.65,.45);
 let ridges=clamp((ridgedFbm(warped,${config.seed}u,4,2.0,.38)-.58)/.4,0.0,1.0);
 let ranges=clamp(fbm(warped*.4,${(config.seed + 73) >>> 0}u,3,2.0,.5)*1.8+.5,.0,1.0);
 let height=2.0+${config.baseRelief.toFixed(6)}*pow(ridges,1.6)*(.15+.85*ranges);
 textureStore(output,vec2i(gid.xy),vec4f(height,0.0,0.0,1.0));
}` });
        const baseInfo = await baseModule.getCompilationInfo();
        if (baseInfo.messages.some(message => message.type === 'error')) throw new Error(baseInfo.messages.filter(message => message.type === 'error').map(message => message.message).join('\n'));
        const basePipeline = await device.createComputePipelineAsync({ layout: 'auto', compute: { module: baseModule, entryPoint: 'seed_mountains' } });
        const baseGroup = device.createBindGroup({ layout: basePipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: initialTexture.createView() }] });
        await submit(encoder => { const pass = encoder.beginComputePass(); pass.setPipeline(basePipeline); pass.setBindGroup(0, baseGroup); pass.dispatchWorkgroups(Math.ceil(size / 8), Math.ceil(size / 8)); pass.end(); });
        const initialHeights = await readTexture(initialTexture);
        const extent = config.worldSize / 2, lastSample = extent - config.worldSize / size;
        tectonics.config = { ...tectonics.config, worldSize: config.worldSize, gridResolution: size,
            plateCount: config.plateCount, segmentCount: config.segmentCount, seed: config.seed, rigidity: 0, mantleStrength: .5 };
        await initialize(() => tectonics.init(device));
        scoped(() => tectonics.initializeTerrain({ heightfield: { width: size, height: size, bounds: [-extent, -extent, lastSample, lastSample], heights: Array.from(initialHeights) } }));
        for (let start = 0; start < config.tectonicSteps; start += 8) {
            await submit(encoder => { for (let i = start; i < Math.min(start + 8, config.tectonicSteps); i++) tectonics.step(encoder); });
            progress('tectonics', Math.min(start + 8, config.tectonicSteps), config.tectonicSteps);
        }
        const texture = device.createTexture({ label: 'terrain-bake-eroded-height', size: [size, size], format: 'r32float',
            usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING }); owned.push(texture);
        await submit(encoder => encoder.copyTextureToTexture({ texture: tectonics.getHeightmapTexture() }, { texture }, [size, size]));
        const tectonicHeights = await readTexture(texture);
        if (tectonicHeights.some(value => !Number.isFinite(value) || Math.abs(value) > 10000)) throw new Error('Tectonic terrain produced invalid heights');
        // Subduction legitimately generates negative elevations. The erosion
        // systems measure material above a zero bedrock floor, so translate the
        // measured field uniformly, retaining its original datum in provenance.
        const elevationOffset = 1 - Math.min(...tectonicHeights);
        const before = Float32Array.from(tectonicHeights, value => value + elevationOffset);
        scoped(() => device.queue.writeTexture({ texture }, before, { bytesPerRow: size * 4 }, [size, size]));
        hydrology.config = { ...hydrology.config, terrainSize: size, terrainScale: config.worldSize / size,
            terrainOrigin: [-config.worldSize / 2, -config.worldSize / 2], seed: config.seed,
            erosionRate: config.erosionRate, depositionRate: config.depositionRate, inertia: config.inertia };
        await initialize(() => hydrology.init(device, texture));
        for (let batch = 0; batch < config.rainBatches && config.hydraulicSteps && config.rainfall; batch++) {
            scoped(() => hydrology.reset({ preserveFlow: true }));
            await submit(encoder => hydrology.spawnParticles(encoder, 0, 0, config.worldSize / 2, config.rainfall, (config.seed + batch * 2654435761) >>> 0));
            for (let start = 0; start < config.hydraulicSteps; start += 8) {
                await submit(encoder => { for (let i = start; i < Math.min(start + 8, config.hydraulicSteps); i++) hydrology.step(encoder, texture.createView(), texture); });
            }
            await submit(encoder => hydrology.settleParticles(encoder, texture));
            progress('hydraulic', batch + 1, config.rainBatches);
        }
        const hydraulic = await readTexture(texture);
        const materialMap = device.createTexture({ label: 'terrain-bake-weathered-material', size: [size, size], format: 'r32uint', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST }); owned.push(materialMap);
        scoped(() => device.queue.writeTexture({ texture: materialMap }, new Uint32Array(size * size).fill(config.thermalMaterial), { bytesPerRow: size * 4 }, [size, size]));
        thermal.config = { ...thermal.config, gridSize: size, gridScale: config.worldSize / size, transferRate: config.thermalTransferRate, iterations: config.thermalSteps };
        await initialize(() => thermal.init(device, texture, materialMap));
        for (let start = 0; start < config.thermalSteps; start += 8) {
            await submit(encoder => thermal.step(encoder, Math.min(8, config.thermalSteps - start)));
            progress('thermal', Math.min(start + 8, config.thermalSteps), config.thermalSteps);
        }
        const heights = config.thermalSteps ? await readTexture(thermal.getHeightmapTexture()) : hydraulic;
        const visits = await readBuffer(hydrology.getStreamMapBuffer(), size * size * 4, Uint32Array);
        let maximumFlow = 0;
        for (const value of visits) maximumFlow = Math.max(maximumFlow, value);
        const flow = Array.from(visits, value => maximumFlow ? Math.log1p(value) / Math.log1p(maximumFlow) : 0);
        const sum = values => values.reduce((total, value) => total + value, 0);
        const change = (a, b) => a.reduce((total, value, i) => total + Math.abs(value - b[i]), 0);
        const field = normalizeTerrainHeightfield({ version: 1, width: size, height: size, bounds: [-extent, -extent, lastSample, lastSample],
            heights: Array.from(heights), flow, provenance: { generator: 'particle-realms.engine-terrain-bake.v1', config,
                stages: ['GPUWorldGenerator.noise', 'TectonicSimulation', 'HydraulicErosion', 'ThermalErosion'],
                engineParameters: { tectonicRigidity: 0, mantleStrength: .5, flowMeaning: 'log-normalized cumulative rain-particle cell visits' },
                diagnostics: { tectonicHeightMin: Math.min(...tectonicHeights), tectonicHeightMax: Math.max(...tectonicHeights), elevationOffset,
                    hydraulicAbsoluteHeightChange: change(before, hydraulic), thermalAbsoluteHeightChange: change(hydraulic, heights),
                    hydraulicHeightSumBefore: sum(before), hydraulicHeightSumAfter: sum(hydraulic),
                    thermalHeightSumBefore: sum(hydraulic), thermalHeightSumAfter: sum(heights),
                    flowVisits: visits.reduce((total, value) => total + value, 0), maximumCellVisits: maximumFlow } } });
        progress('complete', 1, 1); return field;
    } finally {
        thermal.destroy(); hydrology.destroy(); tectonics.destroy();
        owned.reverse().forEach(resource => resource.destroy());
    }
}
