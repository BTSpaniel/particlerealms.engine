// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { ensurePhysXModule } from './physics/PhysXModule.js';
import { PHYSICS_RUNTIME } from './PhysicsRuntimeDescriptor.js';
import { PhysXBulkRust } from './physics/addons/physx-bulk-rust.mjs';
import { FlowWasmWebGpuBridge, runFlowWebGpuRoundTrip } from './physics/addons/webgpu_bridge.mjs';
import { runAdvectionSmoke } from './physics/addons/advection_smoke.mjs';
import { BlastFamily } from './destruction/BlastFamily.js';
import { BlastAuthoring } from './destruction/BlastAuthoring.js';

export { PHYSICS_RUNTIME, ensurePhysXModule };
export { BlastFamily, BlastAuthoring };
export { BlastScene } from './destruction/BlastScene.js';
export { FlowPhysXCollision } from './FlowPhysXCollision.js';

/** Batch native actor poses in the same WASM heap as the Engine's PhysX world. */
export async function createPhysicsPoseBatch(options = {}) {
    return new PhysXBulkRust(await ensurePhysXModule(), options);
}

/** Borrow the caller's Engine/Playground device; closing never destroys that device. */
export async function createPhysicsGpuBridge({ device, adapter = null } = {}) {
    if (!device?.queue) throw new TypeError('An owned Engine GPU device is required');
    return new FlowWasmWebGpuBridge(await ensurePhysXModule(), adapter, device, false);
}

/** Use the installed boundary implementation for diagnostic/render queries.
 * The native addon stays external to the Engine JS bundle, just as its host. */
export async function flowSolidBoundaryShader(options = {}) {
    if (PHYSICS_RUNTIME.capabilities.flowSolidBoundaryAbi !== 1)
        throw new Error('Flow solid boundary shader requires installed boundary ABI 1');
    const { solidBoundaryWGSL } = await import('./physics/addons/flow_host_webgpu.mjs');
    if (typeof solidBoundaryWGSL !== 'function') throw new Error('Installed Flow boundary shader is missing');
    return solidBoundaryWGSL(options);
}

/** Run NVIDIA Flow's sparse host graph on the caller's configured GPU device.
 * Await each step before starting another. Dispose before releasing the device.
 * Output density/velocity textures are sparse atlases, valid until the next step.
 * A scene contains layers and sphere/box/points/mesh emitters. Geometry emitters
 * copy flat xyz positions, optional per-vertex velocities and triangle indices;
 * subsequent input changes require setScene. setColliders retains legacy
 * sphere/box velocity coupling. Boundary ABI 1 adds setSolidBoundaries and
 * the FlowPhysXCollision solidBoundaries option for transport/pressure barriers.
 * Scalar-source ABI 1 adds finite signed field deposits with actual GPU receipts.
 * Neither collision mode returns gas reaction forces to native rigid bodies.
 */
export async function createFlowSolver({ device, shaderRoot, maxBlocks = 128, cellSize = .15, scene } = {}) {
    const { FlowHostWebGpu } = await import('./physics/addons/flow_host_webgpu.mjs');
    const module = await ensurePhysXModule();
    if (PHYSICS_RUNTIME.capabilities.flowSceneAbi && module._pr_flow_host_scene_abi?.() !== PHYSICS_RUNTIME.capabilities.flowSceneAbi) {
        throw new Error('Flow scene ABI differs from the installed runtime manifest');
    }
    if (PHYSICS_RUNTIME.capabilities.flowGeometryAbi && module._pr_flow_host_geometry_abi?.() !== PHYSICS_RUNTIME.capabilities.flowGeometryAbi) {
        throw new Error('Flow geometry ABI differs from the installed runtime manifest');
    }
    if (PHYSICS_RUNTIME.capabilities.flowCollisionAbi && module._pr_flow_host_collision_abi?.() !== PHYSICS_RUNTIME.capabilities.flowCollisionAbi)
        throw new Error('Flow collision ABI differs from the installed runtime manifest');
    if (PHYSICS_RUNTIME.capabilities.flowSolidBoundaryAbi
        && module._pr_flow_host_solid_abi?.() !== PHYSICS_RUNTIME.capabilities.flowSolidBoundaryAbi)
        throw new Error('Flow solid boundary ABI differs from the installed runtime manifest');
    if (PHYSICS_RUNTIME.capabilities.flowScalarSourceAbi
        && module._pr_flow_host_scalar_abi?.() !== PHYSICS_RUNTIME.capabilities.flowScalarSourceAbi)
        throw new Error('Flow scalar source ABI differs from the installed runtime manifest');
    const solver = await FlowHostWebGpu.create(module, device,
        shaderRoot ?? new URL('./physics/flow-wgsl', import.meta.url).href, { maxBlocks, cellSize });
    try {
        if (scene !== undefined) solver.setScene(scene);
        return solver;
    } catch (error) { await solver.dispose(); throw error; }
}

/** Execute native fracture, independent transfer/advection oracles and a coupled Flow run. */
export async function verifyPhysicsExtensions({ device, adapter, shaderRoot } = {}) {
    if (!device?.queue || !adapter) throw new TypeError('Borrow an Engine GPU device and its adapter');
    const module = await ensurePhysXModule();
    if (module._pr_blast_smoke() !== 0) throw new Error('Blast native fracture/split check failed');
    let blastAuthoring = { status: 'UNAVAILABLE', reason: 'Native convex Voronoi authoring ABI 1 is required' };
    if (module._pr_blast_authoring_abi?.() === 1) {
        const authored = new BlastAuthoring(module).fracture({
            positions: [-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1],
            indices: [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5],
            sites: [-.5, 0, 0, .5, 0, 0],
        });
        if (authored.chunks.length !== 2 || authored.bonds.length !== 1
            || authored.chunks.some(chunk => Math.abs(chunk.volume - 4) > 1e-4)
            || Math.abs(authored.bondAreasM2[0] - 4) > 1e-4)
            throw new Error('Native Blast Voronoi geometry differs from the two-site cube oracle');
        const family = new BlastFamily(module, authored);
        try {
            const split = family.damage(0, 8);
            if (new Set(split).size !== 2) throw new Error('Authored native bond failed to split its family');
            blastAuthoring = { status: 'PASS', abi: 1, backend: 'cpu-wasm', chunks: 2,
                volumesM3: authored.chunks.map(chunk => chunk.volume), bondAreaM2: authored.bondAreasM2[0],
                triangles: authored.chunks.map(chunk => chunk.geometry.indices.length / 3), nativeSplit: 'PASS' };
        } finally { family.dispose(); }
    }
    let blastStress = { status: 'UNAVAILABLE', reason: 'Native Blast stress ABI 1 is required' };
    if (module._pr_blast_stress_abi?.() === 1) {
        const families = module._pr_blast_live_families();
        const family = new BlastFamily(module, {
            chunks: [-.5, .5].map(x => ({ position: [x, 0, 0], volume: 1 })), bonds: [[0, 1]],
            health: 1, bondAreasM2: [.01], stress: { densityKgM3: 1, anchoredChunks: [0], settings: {
                maxSolverIterationsPerFrame: 1000,
                compressionElasticLimitPa: 900, compressionFatalLimitPa: 1100,
                tensionElasticLimitPa: 900, tensionFatalLimitPa: 1100,
                shearElasticLimitPa: 900, shearFatalLimitPa: 1100,
            } },
        });
        let restored;
        try {
            const elastic = family.updateStress([0, 0, 0, 8, 0, 0]);
            const partial = family.updateStress([0, 0, 0, 10, 0, 0]);
            if (!elastic.converged || !partial.converged || Math.abs(elastic.remainingAreasM2[0] - .01) > 1e-7
                || Math.abs(partial.remainingAreasM2[0] - .005) > 1e-7 || new Set(partial.groups).size !== 1)
                throw new Error('Native Blast stress does not match the force/area fracture thresholds');
            restored = BlastFamily.restore(module, family.snapshot());
            const original = family.updateStress([0, 0, 0, 20, 0, 0]);
            const replay = restored.updateStress([0, 0, 0, 20, 0, 0]);
            if (new Set(original.groups).size !== 2 || new Set(replay.groups).size !== 2
                || original.remainingAreasM2[0] !== 0 || replay.remainingAreasM2[0] !== 0)
                throw new Error('Blast stress replay changed the fracture continuation');
            blastStress = { status: 'PASS', abi: 1, backend: 'scalar-cpu-wasm', initialAreaM2: .01,
                elasticLoadN: 8, partialLoadN: 10, partialAreaM2: partial.remainingAreasM2[0],
                fractureLoadN: 20, groups: original.groups, replay: 'PASS' };
        } finally { restored?.dispose(); family.dispose(); }
        if (module._pr_blast_live_families() !== families) throw new Error('Blast stress verification leaked a native family');
    }
    const transfer = await runFlowWebGpuRoundTrip(module, { device, adapter, count: 4097 });
    const advection = device.features.has('float32-filterable')
        ? await runAdvectionSmoke(module, shaderRoot ?? new URL('./physics/flow-wgsl', import.meta.url).href, { device, adapter })
        : { status: 'UNAVAILABLE', reason: 'The borrowed device does not enable float32-filterable' };
    let flowSolver = { status: 'UNAVAILABLE', reason: 'Flow needs float32-filterable and 1024-lane compute limits' };
    let flowScenes = { status: 'UNAVAILABLE', reason: 'Flow scene ABI 1 and a supported GPU are required' };
    let flowGeometry = { status: 'UNAVAILABLE', reason: 'Flow geometry ABI 1 and eleven storage buffers per shader stage are required' };
    let flowCollision = { status: 'UNAVAILABLE', reason: 'Flow collision ABI 1 and a supported GPU are required' };
    if (device.features.has('float32-filterable') && device.limits.maxComputeInvocationsPerWorkgroup >= 1024
        && device.limits.maxComputeWorkgroupSizeX >= 1024) {
        // The scene transition retains sparse blocks from the first phase until
        // Flow retires them. Budget for both new layers and those existing blocks.
        const solver = await createFlowSolver({ device, shaderRoot, maxBlocks: 64 });
        try {
            for (let frame = 0; frame < 8; frame++) await solver.step(1 / 60);
            if (!solver.stats.activeBlocks || !Object.keys(solver.stats.passes).some(name => name.includes('PressureSubtract'))) throw new Error('Flow coupled graph did not produce active pressure-projected blocks');
            flowSolver = { status: 'PASS', ...structuredClone(solver.stats) };
            if (module._pr_flow_host_scene_abi?.() === 1) {
                const layer = { cellSize: .15, gravity: [0, 0, 0], pressure: false, combustion: false, vorticity: 0 };
                const emitter = { position: [0, 0, 0], temperature: 0, fuel: 0, smoke: .5, coupleRateSmoke: 2, coupleRateVelocity: 100 };
                solver.setScene({ layers: [{ ...layer, id: 7 }, { ...layer, id: 11 }], emitters: [
                    { ...emitter, id: 1, layer: 7, type: 'sphere', radius: .45, velocity: [2, 0, 0] },
                    { ...emitter, id: 2, layer: 11, type: 'box', halfSize: [.45, .3, .45], velocity: [-3, 0, 0] },
                ] });
                for (let frame = 0; frame < 8; frame++) await solver.step(1 / 60);
                const positions = new Float32Array([0, 0, 0, 1000, 1000, 1000]);
                const sphere = await solver.sampleVelocity(positions, { layer: 7 });
                const box = await solver.sampleVelocity(positions, { layer: 11 });
                if (!(sphere[0] > .1 && box[0] < -.1) || ![...sphere, ...box].every(Number.isFinite)
                    || sphere.slice(3).some(value => value !== 0) || box.slice(3).some(value => value !== 0)) {
                    throw new Error(`Flow scene layers did not retain independent sphere/box velocities: ${JSON.stringify({ sphere: [...sphere], box: [...box], blocks: solver.stats.activeBlocks, layers: solver.output?.layers })}`);
                }
                flowScenes = { status: 'PASS', abi: 1, frames: 8, layers: [7, 11], emitterTypes: ['sphere', 'box'],
                    activeBlocks: solver.stats.activeBlocks, maxBlocks: 64,
                    sphereVelocity: [...sphere.slice(0, 3)], boxVelocity: [...box.slice(0, 3)], missingCellsZero: true };
                if (module._pr_flow_host_collision_abi?.() === 1) {
                    const collider = { id: 1, layer: 7, type: 'sphere', radius: .35, coupleRateVelocity: 5000 };
                    solver.setColliders([collider]); await solver.step(1 / 60);
                    const stopped = await solver.sampleVelocity([0, 0, 0], { layer: 7 });
                    const independent = await solver.sampleVelocity([0, 0, 0], { layer: 11 });
                    solver.setColliders([{ ...collider, position: [.01, 0, 0] }]); await solver.step(1 / 60);
                    const moving = await solver.sampleVelocity([.01, 0, 0], { layer: 7 });
                    if (Math.max(...Array.from(stopped, Math.abs)) > .04 || independent[0] > -.1 || Math.abs(moving[0] - .6) > .04)
                        throw new Error(`Native Flow obstacles failed static, motion or layer isolation: ${JSON.stringify({ stopped: [...stopped], moving: [...moving], independent: [...independent] })}`);
                    flowCollision = { status: 'PASS', abi: 1, mode: 'one-way-native-velocity-obstacle',
                        stationaryVelocity: [...stopped], translatingVelocity: [...moving], independentLayerVelocity: [...independent] };
                }
            }
        } finally { await solver.dispose(); }
        if (module._pr_flow_host_geometry_abi?.() === 1 && device.limits.maxStorageBuffersPerShaderStage >= 11) {
            const common = { temperature: 0, fuel: 0, smoke: .5, coupleRateVelocity: 5000, coupleRateSmoke: 5000 };
            const geometry = await createFlowSolver({ device, shaderRoot, maxBlocks: 128, cellSize: .1, scene: {
                layers: [13, 17].map(id => ({ id, cellSize: .1, gravity: [0, 0, 0], pressure: false, combustion: false, vorticity: 0 })),
                emitters: [
                    { ...common, id: 1, layer: 13, type: 'points', positions: [-1.5, .1, .1], velocity: [.8, 0, 0] },
                    { ...common, id: 2, layer: 17, type: 'mesh', position: [1.3, .1, 0],
                        positions: [-.6, -.6, 0, .6, -.6, 0, .6, .6, 0, -.6, .6, 0],
                        indices: [0, 1, 2, 0, 2, 3], minDistance: -.15, maxDistance: .15, velocity: [0, .6, 0] },
                ],
            } });
            try {
                for (let frame = 0; frame < 8; frame++) await geometry.step(1 / 60);
                const positions = [-1.5, .1, .1, 1.3, .1, .1, 1000, 1000, 1000];
                const points = await geometry.sampleVelocity(positions, { layer: 13 });
                const mesh = await geometry.sampleVelocity(positions, { layer: 17 });
                const expected = [[.8, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, .6, 0, 0, 0, 0]];
                const maximumError = Math.max(...[points, mesh].flatMap((values, layer) => Array.from(values, (value, index) => Math.abs(value - expected[layer][index]))));
                const passes = Object.entries(geometry.stats.passes).filter(([name]) => /EmitterPoint|EmitterMesh/.test(name));
                if (!Number.isFinite(maximumError) || maximumError > .02
                    || !passes.some(([name, count]) => name.includes('EmitterPoint3CS') && count > 0)
                    || !passes.some(([name, count]) => name.includes('EmitterMeshApplyCS') && count > 0))
                    throw new Error(`Native Flow point/mesh emission failed: ${JSON.stringify({ points: [...points], mesh: [...mesh], maximumError })}`);
                flowGeometry = { status: 'PASS', abi: 1, frames: geometry.stats.frames, layers: [13, 17],
                    emitterTypes: ['points', 'mesh'], pointsVelocity: [...points.slice(0, 3)], meshVelocity: [...mesh.slice(3, 6)],
                    maximumError, activeBlocks: geometry.stats.activeBlocks, passes: Object.fromEntries(passes) };
            } finally { await geometry.dispose(); }
        }
    }
    return { sdkVersion: PHYSICS_RUNTIME.sdkVersion, blastFractureSplit: 'PASS', blastAuthoring, blastStress,
        transfer, advection, flowSolver, flowScenes, flowGeometry, flowCollision };
}
