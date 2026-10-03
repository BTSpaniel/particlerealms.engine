// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { createSurfaceFieldTopology } from './SurfaceFieldTopology.js';
import { createSurfaceFieldWorld } from './SurfaceFieldWorld.js';

// One exact material owner uses either borrowed serial transport or its own
// liquid-only device. Neither mode creates another material authority.
let world = null, active = null, activeTask = null, transportWait = null;
let gpuOwner = null, gpuRuntime = null, transportMode = 'borrowed', adapterInfo = null;
let closing = false, deviceFailure = null;
const errors = error => ({ name: error.name, message: error.message });
const log = (message, detail) => postMessage({ log: { message, detail } });
const transportInfo = () => ({ mode: transportMode, ownedBytes: gpuRuntime?.bytes ?? 0,
    steps: gpuRuntime?.steps ?? 0, adapter: adapterInfo, deviceDestroyed: gpuOwner?.destroyed ?? false });
const alive = () => { if (closing || deviceFailure) throw deviceFailure ?? new Error('Surface worker disposed'); };

function failDevice(error) {
    if (closing || deviceFailure) return;
    deviceFailure = error;
    gpuRuntime?.dispose(); gpuOwner?.destroy();
    postMessage({ fatal: errors(error), transportInfo: transportInfo() });
}

async function initializeOwnedTransport(topology) {
    const [{ GpuDevice }, { createSurfaceFieldGpuRuntime }] = await Promise.all([
        import('../../core/gpu/GpuDevice.js'), import('./SurfaceFieldGpu.js'),
    ]);
    alive();
    gpuOwner = await GpuDevice.create({ profile: 'baseline-render', adapterOptions: { powerPreference: 'high-performance' },
        label: 'Surface worker liquid transport', deviceDescriptor: {
            requiredFeatures: [], requiredLimits: { maxStorageBuffersPerShaderStage: 8 },
        } });
    alive();
    // Modern WebGPU exposes this on info; older implementations used adapter.
    // An unknown capability is not evidence of a native hardware device.
    const fallback = gpuOwner.adapter?.info?.isFallbackAdapter ?? gpuOwner.adapter?.isFallbackAdapter;
    if (fallback !== false) throw new Error(fallback ? 'Surface worker requires a non-fallback GPU adapter' : 'Surface worker cannot verify a non-fallback GPU adapter');
    adapterInfo = { ...gpuOwner.adapterInfo, isFallbackAdapter: fallback };
    gpuOwner.onDeviceLost(info => failDevice(new Error(`Surface worker GPU device lost: ${info.message || info.reason}`)));
    gpuOwner.device.addEventListener('uncapturederror', event => failDevice(new Error(`Surface worker GPU error: ${event.error?.message || 'unknown'}`)));
    gpuRuntime = await createSurfaceFieldGpuRuntime({ device: gpuOwner.device, topology, logger: log });
    alive();
    log('owned liquid GPU ready', transportInfo());
}

function projection(stats = world.stats(), supportFrame = world.supportFrame) {
    const carbonate = new Float64Array(world.topology.count);
    // Structural projection needs the exact retained mineral mass, not the
    // full temperature/phase derivation performed by chemicals.cell().
    for (const [i, state] of world.chemicals.states) carbonate[i] = state.conserved.speciesMassKg['species:CaCO3'] ?? 0;
    return { fields: world.fields.slice(), auxiliary: world.auxiliary.slice(), emissions: world.emissions.slice(),
        flowSources: world.flowSources.slice(), structuralState: world.structuralState.slice(), liquidProperties: world.liquidProperties.slice(), runoff: world.runoff, carbonate,
        supportFrame, supportLoads: world.supportLoads,
        initialCarbonateKg: world.chemicals.initialCarbonateKg.slice(), stats,
        ledger: { ...world.ledger }, options: { ...world.options }, steps: world.steps, timeSeconds: world.timeSeconds };
}

function transport(input) {
    alive();
    if (transportMode === 'worker-gpu') return gpuRuntime.transport(input);
    if (transportWait) return Promise.reject(new Error('Surface transport is already pending'));
    return new Promise((resolve, reject) => {
        transportWait = { resolve, reject };
        // Prepared fields are disposable; head offsets are retained scratch.
        const fields = input.fields.slice(), headOffsets = input.headOffsets.slice();
        try { postMessage({ id: active, transport: { ...input, fields, headOffsets } }, [fields.buffer, headOffsets.buffer]); }
        catch (error) { transportWait = null; reject(error); }
    });
}

async function runOperation(id, operation, payload) {
    active = id;
    try {
        alive();
        let value;
        if (operation === 'init') {
            if (world) throw new Error('Surface worker already initialized');
            transportMode = payload.transportMode ?? 'borrowed';
            if (!['borrowed', 'worker-gpu'].includes(transportMode)) throw new RangeError('Invalid surface worker transport mode');
            const topology = createSurfaceFieldTopology(payload.topology);
            if (transportMode === 'worker-gpu') await initializeOwnedTransport(topology);
            alive();
            world = createSurfaceFieldWorld({ topology, materials: payload.materials, logger: log, runoff: payload.runoff ?? false, supports: payload.supports ?? false });
            value = { frame: projection() };
        } else {
            if (!world) throw new Error('Surface worker is not initialized');
            if (operation === 'step') {
                const stats = await world.stepAsync(payload.dt, payload.options, transport);
                value = { frame: projection(stats) };
            } else if (operation === 'brush') {
                const affected = world.applyBrush(payload);
                value = { frame: projection(), affected };
            } else if (operation === 'configure-supports') {
                world.configureSupports(payload); value = { frame: projection() };
            } else if (operation === 'support-brush') {
                world.applySupportBrush(payload); value = { frame: projection() };
            } else if (operation === 'support-brushes') {
                const supportFrame = world.applySupportBrushes(payload);
                value = { frame: projection(undefined, supportFrame) };
            } else if (operation === 'restore') {
                world.restore(payload); value = { frame: projection() };
            } else if (operation === 'snapshot') value = { snapshot: world.snapshot() };
            else throw new Error(`Unknown surface worker operation: ${operation}`);
        }
        alive();
        value.transportInfo = transportInfo();
        const transfers = value.frame ? Object.values(value.frame).filter(ArrayBuffer.isView).map(array => array.buffer) : [];
        postMessage({ id, value }, transfers);
    } catch (error) { postMessage({ id, error: errors(error) }); }
    finally { active = null; }
}

self.onmessage = async ({ data }) => {
    if (data.operation === 'dispose') {
        if (closing) return;
        closing = true;
        if (transportWait) { transportWait.reject(new Error('Surface worker disposed')); transportWait = null; }
        // Destroying buffers/device cancels an outstanding map. Wait for its
        // material continuation before retiring the Float64 authority.
        gpuRuntime?.dispose(); gpuOwner?.destroy();
        await activeTask;
        gpuRuntime?.dispose(); gpuOwner?.destroy(); world?.dispose(); world = null;
        postMessage({ id: data.id, value: { disposed: true, transportInfo: transportInfo() } });
        self.close();
        return;
    }
    if (closing) return;
    if (data.transportResult || data.transportError) {
        if (data.id !== active || !transportWait) return;
        const wait = transportWait; transportWait = null;
        if (data.transportError) wait.reject(new Error(data.transportError)); else wait.resolve(data.transportResult);
        return;
    }
    const { id, operation, payload } = data;
    if (active !== null) { postMessage({ id, error: errors(new Error('Surface worker is busy')) }); return; }
    activeTask = runOperation(id, operation, payload);
    await activeTask;
};
