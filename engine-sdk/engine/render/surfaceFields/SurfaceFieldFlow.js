// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { createFlowSolver } from '../../sim/PhysicsRuntime.js';
import { surfaceFieldSolidDepths } from '../../sim/surfaceFields/SurfaceFieldWorld.js';
import { FlowSnapshot, FlowPresentation, FlowComputeScheduler, flowVolumeShaders, createFlowLighting, densityMetadata } from '../flow/index.js';
import { generateBlackbodyLUT, blackbodyWGSL } from '../shaders/modules/core/particles_blackbody.js';
import { beerLambertWGSL, phaseFunctionsWGSL } from '../shaders/modules/chunks/raymarching.js';
import { quatFromVectors, quatMultiply, quatNormalize, quatRotateVec3 } from '../../core/math/MathQuat.js';
import { perlin3D } from '../../core/math/MathNoise.js';
import { aabbFromPoints, aabbCenter, aabbHalfSize } from '../../core/math/MathGeometry.js';
import { createCheckedShaderModule, assertCheckedShaderModule } from '../../core/gpu/GpuShaderDiagnostics.js';

/** Authored concentration mapping only. Native Flow owns gas advection,
 * pressure, buoyancy, cooling and sparse fields. Existing material owners own
 * pine pyrolysis/char and oil reaction quantities. Wood volatile release drives
 * an optical flame projection; gas-phase volatile ignition is not solved here.
 * Zero native fuel prevents repeating the owner's completed oil reaction.
 * Flow normalized temperature and burn are display channels, not Kelvin or kg.
 */
export const SURFACE_FLOW_PROJECTION = Object.freeze({
    cellSizeM: .05, maxBlocks: 256, sourceHeightM: .1, sourceFootprintPaddingM: .025, nativeIntervalSeconds: .05, nativeTargetHz: 20, vorticity: 8,
    woodRateReferenceKgM2S: .012, oilRateReferenceKgM2S: .06,
    heatReferenceWM2: 100000, productReferenceKgM2S: .12, steamReferenceKgM2S: .02,
    normalizedBurnMax: .08, normalizedTemperatureMax: .85,
    scalarCouplingPerSecond: 24, smokeCouplingPerSecond: 8,
    airflow: Object.freeze({ velocityMPerSecond: Object.freeze([Object.freeze([2.8, .08, .7]), Object.freeze([2.1, .06, -.65]), Object.freeze([.4, 2.4, .03])]),
        couplingPerSecond: Object.freeze([6, 5, 4]), applyPostPressure: false, inletHalfSizeM: Object.freeze([.18, .2, .22]), broadHalfSizeLimitM: Object.freeze([1.1, .3, .7]), footprintMarginM: .18,
        gustAmplitudeMPerSecond: .75, inletVerticalGustMPerSecond: .12, gustRatePerSecond: 2.3,
        scope: 'Three velocity-only box inlets per active source footprint reuse the Blast & Flow oblique-inlet pattern. Coherent Engine Perlin gusts vary each inlet by at most .75 m/s per axis (.12 m/s vertically for side inlets) at completed native time. The broad inlet supplies an authored mean 2.4 m/s upward draft, matching the existing Blast inlet speed, bounded at 1.1 x .3 x .7 m half extents. Native pressure resolves the inlet velocities before native advection and vorticity evolve the gas. No scalar or fuel coupling is applied by the inlets.' }),
    scope: 'Measured finite reaction rates accumulate in Float64 and project as time-weighted averages at a 20 Hz native cadence, using current surface geometry. Point-sampled native source boxes include the retained .025 m horizontal reconstruction margin, avoiding empty samples between adjacent material tiles. Heat input integrals remain signed; the authored temperature target uses the positive part of their average. Display burn is bounded at .08 and temperature at .85 to fit the existing shared fire radiance response. Completed projection targets are scheduling records, not SI gas deposition receipts. All native fuel channels remain zero. Authored air inlets are present only while measured sources are active.',
});

const checkedArray = (array, length, name, nonnegative = true, allowFloat64 = false) => {
    if (!(array instanceof Float32Array || allowFloat64 && array instanceof Float64Array) || array.length !== length) throw new RangeError(`${name} requires ${length} finite${nonnegative ? ' nonnegative' : ''} values`);
    for (let index = 0; index < array.length; index++) {
        const value = array[index];
        if (!Number.isFinite(value) || nonnegative && value < 0) throw new RangeError(`${name} requires ${length} finite${nonnegative ? ' nonnegative' : ''} values`);
    }
};

function validateProjectionState(topology, { fields, emissions, auxiliary, flowSources, oilBurnRates = null, poses = null, tiltX = 0, tiltZ = 0, erosionScale = 1, timeSeconds = 0 } = {}) {
    const count = topology?.count;
    if (!Number.isFinite(timeSeconds) || timeSeconds < 0) throw new RangeError('Surface gas time must be finite and nonnegative');
    if (!count || !Array.isArray(topology.domains) || !Number.isFinite(tiltX) || !Number.isFinite(tiltZ) || !Number.isFinite(erosionScale) || erosionScale < 1 || erosionScale > 1000) throw new RangeError('Invalid retained surface Flow geometry');
    checkedArray(fields, count * 8, 'Surface Flow fields'); checkedArray(emissions, count * 2, 'Native surface emissions', true, true);
    checkedArray(auxiliary, count * 8, 'Retained surface auxiliary fields'); checkedArray(flowSources, count * 4, 'Measured native gas sources', false, true);
    if (oilBurnRates) checkedArray(oilBurnRates, count, 'Averaged oil reaction rates', true, true);
    for (let i = 0; i < count; i++) if (flowSources[i * 4 + 2] < 0 || flowSources[i * 4 + 3] < 0) throw new RangeError('Native gas product and steam rates must be nonnegative');
    if (poses) {
        checkedArray(poses, count * 8, 'Native leaf poses', false);
        for (let i = 0; i < count; i++) {
            const k = i * 8, norm = Math.hypot(poses[k + 4], poses[k + 5], poses[k + 6], poses[k + 7]);
            if ((poses[k + 3] !== 0 && poses[k + 3] !== 1) || Math.abs(norm - 1) > .02) throw new RangeError('Native Flow source poses require binary visibility and unit rotations');
        }
    }
}

const supportQuantities = row => [row.volatileKgPerSecond, row.oilBurnKgPerSecond, row.woodGasHeatW ?? row.gasHeatW,
    row.oilGasHeatW ?? 0, row.oilProductKgPerSecond ?? 0, row.steamKgPerSecond];
function validateSupportSources(rows = []) {
    if (!Array.isArray(rows) || rows.length > 128) throw new RangeError('Surface Flow accepts at most 128 measured support segments');
    const ids = new Set();
    for (const row of rows) {
        const id = `${row.id}:${row.segment}`;
        if (typeof row.id !== 'string' || !Number.isInteger(row.segment) || row.segment < 0 || ids.has(id)
            || ![row.a, row.b].every(p => Array.isArray(p) && p.length === 3 && p.every(v => Number.isFinite(v) && Math.abs(v) <= 1e6))
            || Math.hypot(...row.b.map((v, k) => v - row.a[k])) > 100
            || !Number.isFinite(row.radiusM) || row.radiusM <= 0 || row.radiusM > 1 || supportQuantities(row).some((v, i) => !Number.isFinite(v) || i !== 2 && i !== 3 && v < 0)) throw new RangeError('Invalid measured support gas source');
        ids.add(id);
    }
}

/** Pure projection used by acceptance tests and the live native scene. There
 * are no fixed pilots, periodic sources, inferred ignition or source rate caps.
 * Only optical concentrations are bounded; rate totals remain measured SI.
 * Float64 rate arrays preserve averaged inputs before native f32 packing.
 */
export function buildSurfaceFieldFlowScene(topology, state = {}) {
    validateProjectionState(topology, state);
    validateSupportSources(state.supports);
    const { fields, emissions, auxiliary, flowSources, oilBurnRates = null, poses = null, tiltX = 0, tiltZ = 0, erosionScale = 1, timeSeconds = 0 } = state;
    const count = topology.count, p = SURFACE_FLOW_PROJECTION;
    const emitters = [], footprints = new Map(), rates = { woodVolatileKgPerSecond: 0, oilBurnKgPerSecond: 0, gasHeatW: 0, oilProductKgPerSecond: 0, steamKgPerSecond: 0 };
    for (let i = 0; i < count; i++) {
        const k = i * 8, f = i * 4, d = topology.domains[topology.meta[k + 4]], area = topology.meta[k + 3];
        const wood = emissions[i * 2], oil = oilBurnRates?.[i] ?? auxiliary[k + 4], products = flowSources[f + 2], steam = flowSources[f + 3];
        const heat = Math.max(0, flowSources[f]) + Math.max(0, flowSources[f + 1]);
        rates.woodVolatileKgPerSecond += wood * area; rates.oilBurnKgPerSecond += oil * area; rates.gasHeatW += heat * area;
        rates.oilProductKgPerSecond += products * area; rates.steamKgPerSecond += steam * area;
        if (!(wood > 0 || oil > 0 || heat > 0 || products > 0 || steam > 0) || poses && poses[k + 3] < .5) continue;
        const concentration = p.normalizedBurnMax * -Math.expm1(-wood / p.woodRateReferenceKgM2S - oil / p.oilRateReferenceKgM2S);
        const smoke = Math.min(1.5, .28 * (1 - Math.exp(-wood / p.woodRateReferenceKgM2S)) + .2 * (1 - Math.exp(-products / p.productReferenceKgM2S)) + .8 * (1 - Math.exp(-steam / p.steamReferenceKgM2S)));
        const temperature = p.normalizedTemperatureMax * Math.pow(-Math.expm1(-heat / p.heatReferenceWM2), .25);
        const sx = d.receiveRunoff || d.material === 'calcite' ? 0 : tiltX, sz = d.receiveRunoff || d.material === 'calcite' ? 0 : tiltZ;
        const slopeX = d.tiltX + sx, slopeZ = d.tiltZ + sz;
        const normalLength = Math.hypot(slopeX, 1, slopeZ), normal = [-slopeX / normalLength, 1 / normalLength, -slopeZ / normalLength];
        const rotation = poses ? quatNormalize(Array.from(poses.slice(k + 4, k + 8))) : [0, 0, 0, 1];
        const substrateDepth = topology.meta[k + 7];
        const recession = surfaceFieldSolidDepths(topology, auxiliary, i, { calciteDepthScale: Math.round(erosionScale) }).removedDepthM;
        const local = [0, substrateDepth * .5 + sx * (topology.meta[k] - d.center[0]) + sz * (topology.meta[k + 2] - d.center[2]) - recession + auxiliary[k] + auxiliary[k + 1], 0];
        const worldOffset = quatRotateVec3(local, rotation), worldNormal = quatRotateVec3(normal, rotation);
        const pivot = poses ? Array.from(poses.slice(k, k + 3)) : [topology.meta[k], topology.meta[k + 1] - substrateDepth * .5, topology.meta[k + 2]];
        const position = pivot.map((value, axis) => value + worldOffset[axis] + worldNormal[axis] * p.sourceHeightM * .55);
        const domainIndex = topology.meta[k + 4];
        if (!footprints.has(domainIndex)) footprints.set(domainIndex, []);
        footprints.get(domainIndex).push(position);
        emitters.push({ id: i + 1, layer: 0, type: 'box', enabled: true, position,
            halfSize: [d.size[0] / topology.n * .5 + p.sourceFootprintPaddingM, p.sourceHeightM * .5, d.size[1] / topology.n * .5 + p.sourceFootprintPaddingM],
            quaternion: quatNormalize(quatMultiply(rotation, quatFromVectors([0, 1, 0], normal))), velocity: [0, 0, 0],
            fuel: 0, temperature, burn: concentration, smoke, divergence: 0,
            coupleRateVelocity: 0, coupleRateFuel: 0, coupleRateTemperature: p.scalarCouplingPerSecond,
            coupleRateBurn: p.scalarCouplingPerSecond, coupleRateSmoke: p.smokeCouplingPerSecond, coupleRateDivergence: 0 });
    }
    // Native Flow's installed emitter table is fixed at 1024. In the unusual
    // fully active surface case, coarsen two existing optical boxes to make
    // room; measured SI totals below remain complete, never truncated.
    let aggregatedBoxes = 0;
    for (const [index, row] of (state.supports ?? []).entries()) {
        const q = supportQuantities(row), length = Math.hypot(...row.b.map((v, k) => v - row.a[k]));
        rates.woodVolatileKgPerSecond += q[0]; rates.oilBurnKgPerSecond += q[1]; rates.gasHeatW += Math.max(0, q[2]) + Math.max(0, q[3]);
        rates.oilProductKgPerSecond += q[4]; rates.steamKgPerSecond += q[5];
        if (!q.some(v => v > 0)) continue;
        while (emitters.length >= 1024) {
            const b = emitters.pop(), a = emitters[emitters.length - 1];
            const points = [a, b].flatMap(e => [-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z => {
                const delta = quatRotateVec3([x * e.halfSize[0], y * e.halfSize[1], z * e.halfSize[2]], e.quaternion);
                return e.position.map((v, k) => v + delta[k]);
            }))));
            const bounds = aabbFromPoints(points), va = a.halfSize.reduce((v, x) => v * x, 1), vb = b.halfSize.reduce((v, x) => v * x, 1);
            for (const channel of ['temperature', 'burn', 'smoke']) a[channel] = (a[channel] * va + b[channel] * vb) / (va + vb);
            a.position = aabbCenter(bounds); a.halfSize = aabbHalfSize(bounds); a.quaternion = [0, 0, 0, 1]; aggregatedBoxes++;
        }
        const area = Math.max(1e-6, 2 * Math.PI * row.radiusM * length), wood = q[0] / area, oil = q[1] / area, heat = (Math.max(0, q[2]) + Math.max(0, q[3])) / area;
        const position = row.a.map((v, k) => (v + row.b[k]) * .5);
        emitters.push({ id: count + topology.domains.length * 3 + index + 1, layer: 0, type: 'box', enabled: true, position,
            halfSize: [Math.max(.04, row.radiusM + .025), Math.max(.025, length * .5), Math.max(.04, row.radiusM + .025)],
            quaternion: length > 1e-8 ? quatFromVectors([0, 1, 0], row.b.map((v, k) => (v - row.a[k]) / length)) : [0, 0, 0, 1], velocity: [0, 0, 0],
            fuel: 0, burn: p.normalizedBurnMax * -Math.expm1(-wood / p.woodRateReferenceKgM2S - oil / p.oilRateReferenceKgM2S),
            temperature: p.normalizedTemperatureMax * Math.pow(-Math.expm1(-heat / p.heatReferenceWM2), .25),
            smoke: Math.min(1.5, .28 * -Math.expm1(-wood / p.woodRateReferenceKgM2S) + .2 * -Math.expm1(-q[4] / area / p.productReferenceKgM2S) + .8 * -Math.expm1(-q[5] / area / p.steamReferenceKgM2S)),
            divergence: 0, coupleRateVelocity: 0, coupleRateFuel: 0, coupleRateTemperature: p.scalarCouplingPerSecond,
            coupleRateBurn: p.scalarCouplingPerSecond, coupleRateSmoke: p.smokeCouplingPerSecond, coupleRateDivergence: 0 });
    }
    const materialSourceCount = emitters.length;
    if (materialSourceCount > 1024) throw new RangeError('Active surface gas sources exceed the installed native Flow scene limit of 1024; no measured sources were discarded');
    // The original Blast & Flow scene uses two oblique air inlets and a broad
    // low draft. Apply that same native velocity-emitter pattern around current
    // measured source footprints. All scalar coupling is zero, so cold air can
    // neither ignite material nor create a permanent fire or smoke source.
    for (const [domain, positions] of footprints) {
        const bounds = aabbFromPoints(positions), center = aabbCenter(bounds), half = aabbHalfSize(bounds), air = p.airflow;
        const margin = air.footprintMarginM, broadHalf = [Math.min(half[0] + margin, air.broadHalfSizeLimitM[0]), air.broadHalfSizeLimitM[1], Math.min(half[2] + margin, air.broadHalfSizeLimitM[2])];
        const upstream = center[0] - broadHalf[0];
        const inletPositions = [[upstream, center[1] + .08, center[2] - broadHalf[2]],
            [upstream + .25, center[1] + .03, center[2] + broadHalf[2]], [center[0], center[1] + .12, center[2]]];
        for (let inlet = 0; inlet < 3; inlet++) {
            // Measured sources always have priority over authored air. The
            // installed capacity remains valid for all 1024 material emitters.
            if (emitters.length === 1024) continue;
            // Bounded coherent air gusts enter the native pressure/advection solve.
            // They change no measured mass, heat, burn, smoke or fuel target.
            const velocity = air.velocityMPerSecond[inlet].map((speed, axis) => speed
                + (axis === 1 && inlet < 2 ? air.inletVerticalGustMPerSecond : air.gustAmplitudeMPerSecond)
                * Math.max(-1, Math.min(1, perlin3D(timeSeconds * air.gustRatePerSecond,
                    domain * 3.17 + inlet * 1.71 + .37, axis * 7.13 + .19))));
            emitters.push({ id: count + domain * 3 + inlet + 1, layer: 0, type: 'box', enabled: true, applyPostPressure: air.applyPostPressure,
                position: inletPositions[inlet], halfSize: inlet < 2 ? [...air.inletHalfSizeM] : broadHalf,
                quaternion: [0, 0, 0, 1], velocity, coupleRateVelocity: air.couplingPerSecond[inlet],
                temperature: 0, fuel: 0, smoke: 0, burn: 0, divergence: 0,
                coupleRateTemperature: 0, coupleRateFuel: 0, coupleRateSmoke: 0, coupleRateBurn: 0, coupleRateDivergence: 0 });
        }
    }
    const airflowEmitterCount = emitters.length - materialSourceCount, airflowSkippedCount = footprints.size * 3 - airflowEmitterCount;
    return { scene: { layers: [{ id: 0, cellSize: p.cellSizeM, gravity: [0, -9.81, 0], pressure: true, combustion: true, vorticity: p.vorticity }], emitters }, rates,
        materialSourceCount, airflowEmitterCount, airflowSkippedCount, aggregatedBoxes,
        airflowSkippedReason: airflowSkippedCount ? 'Installed 1024-emitter limit; all measured material sources retained' : null };
}

export async function createSurfaceFieldFlow(options) {
    const flow = new SurfaceFieldFlow(options);
    try { await flow.initialize(); return flow; }
    catch (error) {
        flow.log('initialization failed', { level: 'error', message: error.message });
        try { await flow.dispose(); } catch (cleanupError) { flow.log('initialization cleanup failed', { level: 'error', message: cleanupError.message }); }
        throw error;
    }
}

/** Borrowed-device native Flow presentation. Await each step and disposal;
 * drawing samples the last completed sparse snapshot while a step is pending.
 */
class SurfaceFieldFlow {
    constructor({ device, format = 'bgra8unorm', topology, logger } = {}) {
        if (!device?.queue || !topology?.count) throw new TypeError('Surface Flow requires a borrowed device and retained topology');
        Object.assign(this, { device, format, topology, logger, disposed: false, pending: null, disposal: null });
        this.stats = { status: 'starting', frames: 0, nativeFrames: 0, materialUpdates: 0, materialSeconds: 0, nativeSeconds: 0,
            pendingSourceSeconds: 0, cadenceSkippedMaterialUpdates: 0, nativeIntervalSeconds: SURFACE_FLOW_PROJECTION.nativeIntervalSeconds, activeBlocks: 0, densityFrames: 0, renderedFrames: 0, raymarchedFrames: 0, cachedFrames: 0,
            sourceCount: 0, materialSourceCount: 0, airflowEmitterCount: 0, airflowSkippedCount: 0, airflowSkippedReason: null, sourceRates: {}, lastScheduledAverageRates: {}, latestMaterialSourceRates: {}, representation: 'native-sparse-atlas', projection: SURFACE_FLOW_PROJECTION, fuelConcentration: 0,
            fireDetail: 'bounded-optical-erosion-of-native-emission', fieldPhysics: 'native-Flow-advection-pressure-buoyancy-cooling', SIQuantitiesOwner: 'native-surface-material-and-chemical-owners' };
        this.metadataData = new Uint32Array(33); this.scaleData = new Float32Array(4);
        this.sourceSeconds = 0;
        this.supportIntegrals = new Map();
        this.emissionIntegrals = new Float64Array(topology.count * 2); this.gasIntegrals = new Float64Array(topology.count * 4); this.oilIntegrals = new Float64Array(topology.count);
        this.averagedEmissions = new Float64Array(this.emissionIntegrals.length); this.averagedGas = new Float64Array(this.gasIntegrals.length); this.averagedOil = new Float64Array(this.oilIntegrals.length);
        this.stats.sourceProjectionIntegrals = { scope: 'Input-rate integration and completed target scheduling only; native ordinary emitter concentration is not an SI delivery receipt.',
            observed: Array(6).fill(0), completedTargets: Array(6).fill(0), pending: Array(6).fill(0), retiredTargets: Array(6).fill(0), balanceResidual: Array(6).fill(0),
            channels: ['woodVolatileKg', 'oilBurnKg', 'woodGasHeatJ', 'oilGasHeatJ', 'oilProductKg', 'steamKg'] };
    }
    log(message, detail = {}) { if (typeof this.logger === 'function') this.logger(`[SurfaceFieldFlow] ${message}`, detail); else this.logger?.[detail.level ?? 'debug']?.(message, detail); }
    alive() { if (this.disposed) throw new Error('Surface Flow is disposed'); }
    get bytes() {
        if (this.stats.status === 'disposed') return 0;
        const queryBytes = this.snapshot?.queryBuffers?.reduce((sum, buffer) => sum + buffer.size, 0) ?? 0;
        return (this.solver?.stats.allocatedBytes ?? 0) + (this.snapshot ? Math.max(208, this.snapshot.bytes) : 0) + queryBytes
            + (this.presentation ? 192 + (this.stats.presentationBytes ?? 0) : 0) + (this.colourBytes ?? 0) + (this.fireLighting ? 32 : 0) + (this.computeScheduler?.bytes ?? 0);
    }
    get lightBuffer() { return this.fireLighting?.buffer ?? null; }
    get lighting() {
        const s = this.snapshot;
        return s?.frame >= 0 ? { volumeView: s.volumeView, sampler: s.sampler, colourView: this.colourView, lightView: s.lightView,
            table: s.table, metadata: s.metadata, scale: s.scale, bounds: s.bounds, generation: s.generation } : null;
    }
    async initialize() {
        this.log('initializing existing native Flow fire pipeline');
        const p = SURFACE_FLOW_PROJECTION;
        // Leave queue headroom for the 120 FPS renderer and the independent
        // liquid readbacks while the material worker advances concurrently.
        // Native tail diagnostic: max 0.131072 ms plus one 0.065536 ms
        // timer quantum, with 25% margin = 0.24576 ms. This is configured
        // measured admission guidance, not a portable hardware upper bound.
        this.computeScheduler = new FlowComputeScheduler(this.device, { texturePool: true, computeBudgetMs: 2,
            maxInFlightSubmissions: 2, readbackTailBudget: { maxCopyBytes: 2048, maxTimingBytes: 1024, estimatedGpuMs: .25 } });
        this.solver = await createFlowSolver({ device: this.computeScheduler.device, maxBlocks: p.maxBlocks, cellSize: p.cellSizeM,
            scene: { layers: [{ id: 0, cellSize: p.cellSizeM, gravity: [0, -9.81, 0], pressure: true, combustion: true, vorticity: p.vorticity }], emitters: [] } });
        const lut = generateBlackbodyLUT(1000, 2600), colors = new Uint8Array(lut.size * 4);
        for (let i = 0; i < lut.size; i++) { for (let channel = 0; channel < 3; channel++) colors[i * 4 + channel] = Math.round(lut.data[i * 4 + channel] * 255); colors[i * 4 + 3] = 255; }
        this.colourMap = this.device.createTexture({ label: 'Surface native Flow Engine blackbody ramp', dimension: '1d', size: [lut.size], format: 'rgba8unorm-srgb', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING });
        this.colourBytes = colors.byteLength; this.device.queue.writeTexture({ texture: this.colourMap }, colors, {}, [lut.size]); this.colourView = this.colourMap.createView();
        const shaders = flowVolumeShaders({ phaseFunctionsWGSL, beerLambertWGSL, blackbodyWGSL, fireDetail: true });
        this.snapshot = await FlowSnapshot.create(this.device, shaders.shadow);
        this.presentation = await FlowPresentation.create(this.device, this.format, shaders.raymarch, { targetFPS: 120 });
        this.fireLighting = await createFlowLighting({ device: this.device, makeShader: async (code, label) => {
            const module = createCheckedShaderModule(this.device, { code, label }); await assertCheckedShaderModule(module); return module;
        } });
        this.stats.computeScheduling = this.computeScheduler.stats;
        this.stats.status = 'running'; this.log('native Flow pipeline ready', { bytes: this.bytes, projection: p.scope,
            computeBudgetMs: this.stats.computeScheduling.broker.computeBudgetMs });
    }
    async step(dt, state) {
        this.alive(); if (this.pending) throw new Error('Await the preceding native surface Flow step');
        if (this.stats.status === 'failed') throw new Error('Native surface Flow failed; replace the instance before admitting more sources');
        if (!Number.isFinite(dt) || dt <= 0 || dt > .1) throw new RangeError('Native surface Flow timestep must be in (0,.1]');
        validateProjectionState(this.topology, state);
        validateSupportSources(state.supports);
        const supportIds = new Set((state.supports ?? []).map(row => `${row.id}:${row.segment}`));
        for (const [id, integral] of this.supportIntegrals) if (integral.quantities.some(value => value !== 0)) supportIds.add(id);
        if (supportIds.size > 128) throw new RangeError('Pending support source identities exceed their bounded projection capacity');
        for (const id of this.supportIntegrals.keys()) if (!supportIds.has(id)) this.supportIntegrals.delete(id);
        const ledger = this.stats.sourceProjectionIntegrals, update = Array(6).fill(0); let positiveHeat = 0;
        for (let i = 0; i < this.topology.count; i++) {
            const e = i * 2, g = i * 4, area = this.topology.meta[i * 8 + 3], oil = state.oilBurnRates?.[i] ?? state.auxiliary[i * 8 + 4];
            for (let channel = 0; channel < 2; channel++) this.emissionIntegrals[e + channel] += state.emissions[e + channel] * dt;
            for (let channel = 0; channel < 4; channel++) this.gasIntegrals[g + channel] += state.flowSources[g + channel] * dt;
            this.oilIntegrals[i] += oil * dt;
            const quantities = [state.emissions[e], oil, state.flowSources[g], state.flowSources[g + 1], state.flowSources[g + 2], state.flowSources[g + 3]];
            for (let channel = 0; channel < 6; channel++) update[channel] += quantities[channel] * dt * area;
            positiveHeat += (Math.max(0, state.flowSources[g]) + Math.max(0, state.flowSources[g + 1])) * area;
        }
        for (const row of state.supports ?? []) {
            const id = `${row.id}:${row.segment}`;
            let integral = this.supportIntegrals.get(id);
            const retainedRow = { ...row, a: [...row.a], b: [...row.b] };
            if (!integral) { integral = { row: retainedRow, quantities: new Float64Array(6) }; this.supportIntegrals.set(id, integral); }
            integral.row = retainedRow;
            const quantities = supportQuantities(row);
            for (let channel = 0; channel < 6; channel++) { integral.quantities[channel] += quantities[channel] * dt; update[channel] += quantities[channel] * dt; }
            positiveHeat += Math.max(0, quantities[2]) + Math.max(0, quantities[3]);
        }
        for (let channel = 0; channel < 6; channel++) { ledger.observed[channel] += update[channel]; ledger.pending[channel] += update[channel]; }
        this.sourceSeconds += dt; this.stats.materialUpdates++; this.stats.materialSeconds += dt; this.stats.pendingSourceSeconds = this.sourceSeconds;
        this.stats.latestMaterialSourceRates = { woodVolatileKgPerSecond: update[0] / dt, oilBurnKgPerSecond: update[1] / dt,
            gasHeatW: positiveHeat, oilProductKgPerSecond: update[4] / dt, steamKgPerSecond: update[5] / dt };
        ledger.balanceResidual = ledger.observed.map((value, channel) => value - ledger.completedTargets[channel] - ledger.pending[channel]);
        // Retain every input rate until a completed native tick. The Engine's
        // bounded catch-up planner discards excess time and is intentionally
        // not used for source integration. At most one native step is needed:
        // admitted dt <= .1 and the preceding remainder is below .05 seconds.
        if (this.sourceSeconds + 1e-12 < SURFACE_FLOW_PROJECTION.nativeIntervalSeconds) { this.stats.cadenceSkippedMaterialUpdates++; return this.stats; }
        const duration = this.sourceSeconds, nativeDt = Math.min(.1, duration), fraction = nativeDt / duration;
        for (let i = 0; i < this.emissionIntegrals.length; i++) this.averagedEmissions[i] = this.emissionIntegrals[i] / duration;
        for (let i = 0; i < this.gasIntegrals.length; i++) this.averagedGas[i] = this.gasIntegrals[i] / duration;
        for (let i = 0; i < this.oilIntegrals.length; i++) this.averagedOil[i] = this.oilIntegrals[i] / duration;
        const supports = [...this.supportIntegrals.values()].map(({ row, quantities: q }) => ({ ...row,
            volatileKgPerSecond: q[0] / duration, oilBurnKgPerSecond: q[1] / duration,
            woodGasHeatW: q[2] / duration, oilGasHeatW: q[3] / duration, gasHeatW: (q[2] + q[3]) / duration,
            oilProductKgPerSecond: q[4] / duration, steamKgPerSecond: q[5] / duration }));
        const started = performance.now();
        try {
            const projected = buildSurfaceFieldFlowScene(this.topology, { ...state, supports, timeSeconds: this.stats.nativeSeconds + nativeDt * .5, emissions: this.averagedEmissions, flowSources: this.averagedGas, oilBurnRates: this.averagedOil });
            this.solver.setScene(projected.scene);
            if (this.stats.sourceCount !== projected.scene.emitters.length) this.log('measured gas source set changed', { sources: projected.scene.emitters.length, rates: projected.rates });
            this.stats.sourceCount = projected.scene.emitters.length; this.stats.sourceRates = projected.rates;
            this.stats.materialSourceCount = projected.materialSourceCount; this.stats.airflowEmitterCount = projected.airflowEmitterCount;
            this.stats.airflowSkippedCount = projected.airflowSkippedCount; this.stats.airflowSkippedReason = projected.airflowSkippedReason;
            this.stats.aggregatedOpticalBoxes = projected.aggregatedBoxes;
            this.stats.lastScheduledAverageRates = { ...projected.rates }; this.stats.lastAveragingWindowSeconds = duration;
            this.stats.lastScheduledAtMaterialUpdate = this.stats.materialUpdates;
            this.pending = this.computeScheduler.run(() => this.solver.step(nativeDt));
            const output = await this.pending;
            // These are completed scheduling targets, not guessed native mass
            // or heat receipts. Commit only after the actual solver succeeds.
            const remainder = 1 - fraction;
            for (let channel = 0; channel < 6; channel++) { ledger.completedTargets[channel] += ledger.pending[channel] * fraction; ledger.pending[channel] *= remainder; }
            for (const integrals of [this.emissionIntegrals, this.gasIntegrals, this.oilIntegrals]) {
                if (remainder === 0) integrals.fill(0);
                else for (let i = 0; i < integrals.length; i++) integrals[i] *= remainder;
            }
            for (const { quantities } of this.supportIntegrals.values()) {
                if (remainder === 0) quantities.fill(0);
                else for (let i = 0; i < quantities.length; i++) quantities[i] *= remainder;
            }
            this.sourceSeconds = Math.max(0, duration - nativeDt); this.stats.pendingSourceSeconds = this.sourceSeconds;
            this.stats.nativeSeconds += nativeDt; this.stats.lastNativeDeltaSeconds = nativeDt; this.stats.nativeFrames = this.solver.stats.frames;
            ledger.balanceResidual = ledger.observed.map((value, channel) => value - ledger.completedTargets[channel] - ledger.pending[channel]);
            const layer = output?.layers?.find(item => item.id === 0);
            if (!output?.density || !output?.sparse || !layer) throw new Error('Native surface Flow did not return its completed density field');
            densityMetadata(output, this.metadataData, this.scaleData); this.metadataData[32] = layer.layerAndLevel;
            for (let axis = 0; axis < 3; axis++) this.scaleData[axis] /= layer.blockSizeWorld[axis];
            this.scaleData[3] = this.solver.stats.activeBlocks > 0 ? 1 : 0;
            this.snapshot.update(output, this.solver.stats.frames, this.metadataData, this.scaleData);
            this.presentation.observeStep(performance.now() - started);
            Object.assign(this.stats, { status: 'running', frames: this.solver.stats.frames, activeBlocks: this.solver.stats.activeBlocks,
                dispatches: this.solver.stats.dispatches, allocatedBytes: this.solver.stats.allocatedBytes, snapshotBytes: this.snapshot.bytes,
                nativePasses: { ...this.solver.stats.passes }, nativeAtlasSize: [...this.snapshot.size] });
            this.stats.densityFrames++; return this.stats;
        } catch (error) { this.stats.status = 'failed'; this.stats.reason = error.message; throw error; }
        finally { this.stats.computeScheduling = this.computeScheduler.stats; this.pending = null; }
    }
    observePresentation(sample) { if (!this.disposed) this.presentation.observePresentation(sample); }
    encodeLighting(encoder, timing) { if (!this.disposed && this.snapshot.frame >= 0) this.fireLighting.encode(encoder, this, timing); }
    draw(encoder, colorView, depthView, { vp, eye, right, up, forward, width, height, tanHalfFov, quality = 0, paused = false, sceneRevision = this.stats.frames, timing, queueDepth = 0, queueCapacity = 2, focus, reverseZ = false } = {}) {
        this.alive(); if (this.snapshot.frame < 0) return;
        if (vp?.length !== 16 || [eye, right, up, forward].some(vector => vector?.length !== 3) || ![...vp, ...eye, ...right, ...up, ...forward, width, height, tanHalfFov].every(Number.isFinite) || tanHalfFov <= 0 || width < 1 || height < 1) throw new RangeError('Native Flow presentation requires finite camera rays');
        const mode = quality === 0 ? 'auto' : quality >= 5 ? 'full' : quality >= 4 ? 'high' : quality >= 2 ? 'balanced' : 'performance';
        this.presentation.setQuality(mode);
        this.presentation.draw(encoder, colorView, depthView, { viewProjection: vp, eye, right, up, forward, width, height, aspect: width / height, tanHalfFov, timeSeconds: this.stats.nativeSeconds, paused, sceneRevision, timing, queueDepth, queueCapacity, focus, reverseZ }, this.snapshot, this.colourView, this.stats);
    }
    async sampleDensity(positions) {
        this.alive(); if (this.pending) throw new Error('Await surface Flow step before querying'); this.pending = this.snapshot.sample(positions);
        try { return await this.pending; } finally { this.pending = null; }
    }
    async readDensityEvidence(positions) {
        this.alive(); if (this.pending) throw new Error('Await surface Flow step before evidence'); this.pending = this.snapshot.evidence(positions);
        try { return await this.pending; } finally { this.pending = null; }
    }
    dispose() {
        if (this.disposal) return this.disposal;
        this.disposed = true;
        this.disposal = (async () => {
            try { await this.pending; } catch { /* step owns the reported failure */ }
            if (this.sourceSeconds > 0) {
                const ledger = this.stats.sourceProjectionIntegrals;
                ledger.retiredOnDispose = [...ledger.pending];
                ledger.retirementReason = 'Surface Flow instance disposed or replaced before its next native cadence';
                this.log('retired outstanding display projection targets', { seconds: this.sourceSeconds, quantities: ledger.retiredOnDispose });
                for (let channel = 0; channel < 6; channel++) { ledger.retiredTargets[channel] += ledger.pending[channel]; ledger.pending[channel] = 0; }
                ledger.balanceResidual = ledger.observed.map((value, channel) => value - ledger.completedTargets[channel] - ledger.retiredTargets[channel]);
                this.sourceSeconds = 0; this.stats.pendingSourceSeconds = 0;
                for (const integrals of [this.emissionIntegrals, this.gasIntegrals, this.oilIntegrals]) integrals.fill(0);
            }
            this.supportIntegrals.clear();
            let failure;
            try { await this.solver?.dispose(); } catch (error) { failure = error; }
            try { await this.computeScheduler?.dispose(); } catch (error) { failure ??= error; }
            finally {
                this.snapshot?.dispose(); this.presentation?.dispose(); this.colourMap?.destroy(); this.fireLighting?.dispose();
                this.stats.computeScheduling = this.computeScheduler?.stats ?? null;
                this.stats.status = 'disposed'; this.log('released owned native Flow resources');
            }
            if (failure) throw failure;
        })();
        return this.disposal;
    }
}
