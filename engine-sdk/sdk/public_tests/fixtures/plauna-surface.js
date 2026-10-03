// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { resolveModule, sourceUrl, finishSuite } from '../resolver.js';
const { PlaunaSurfaceManager } = await resolveModule("plauna/surface/surface-manager.js", ["PlaunaSurfaceManager"]);

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function assertEqual(actual, expected, message) {
    const actualJson = JSON.stringify(actual);
    const expectedJson = JSON.stringify(expected);
    assert(actualJson === expectedJson, `${message}: expected ${expectedJson}, received ${actualJson}`);
}

function assertThrows(action, pattern, message) {
    let thrown = null;
    try {
        action();
    } catch (error) {
        thrown = error;
    }
    assert(thrown && pattern.test(String(thrown.message)), message);
}

function createGpuBridge(events) {
    return {
        failUpdate: false,
        createSurfaceResources(surface) {
            events.resourceCreates.push({ id: surface.id, width: surface.width, height: surface.height });
            return { id: `resources:${surface.id}` };
        },
        createSurfaceRenderer(surface) {
            const renderer = {
                destroyCount: 0,
                destroy() {
                    this.destroyCount += 1;
                    events.surfaceRendererDestroys.push(surface.id);
                }
            };
            events.surfaceRenderers.set(surface.id, renderer);
            return renderer;
        },
        updateSurfaceResources(surface) {
            events.resourceUpdates.push({ id: surface.id, bounds: { ...surface.bounds } });
            if (this.failUpdate) {
                throw new Error('synthetic resource update failure');
            }
            return surface.resources;
        },
        destroySurfaceResources(surface) {
            events.resourceDestroys.push(surface.id);
        }
    };
}

function createVgpu(events) {
    const disposable = (kind, extra = {}) => ({
        ...extra,
        destroyCount: 0,
        destroy() {
            this.destroyCount += 1;
            events.rendererResourceDestroys.push(kind);
        }
    });

    return {
        pipeline: {
            render() {
                events.pipelineCreates += 1;
                return disposable('pipeline', { gpuPipeline: {} });
            }
        },
        bindings: {
            defineLayout() {
                return {};
            },
            create() {
                events.bindGroupCreates += 1;
                return disposable('bind-group', { gpuBindGroup: {} });
            }
        },
        sampler: {
            create() {
                events.samplerCreates += 1;
                return disposable('sampler');
            }
        }
    };
}

async function verifyBoundsIdsUpdatesAndHitTesting(checks) {
    const manager = new PlaunaSurfaceManager();
    await manager.initialize();

    const bounded = manager.create({
        id: 'bounded',
        bounds: { x: 10, y: 20, width: 120, height: 80 },
        metadata: { owner: 'test' }
    });
    assertEqual(
        manager.getSurfaceBounds(bounded),
        { x: 10, y: 20, width: 120, height: 80 },
        'explicit bounds were not preserved'
    );
    assert(bounded.width === 120 && bounded.height === 80, 'surface dimensions were not projected');
    checks.push('explicit bounds and dimensions');

    const dimensioned = manager.create({
        id: 'dimensioned',
        x: -5,
        y: 7,
        dimensions: [48, 24]
    });
    assertEqual(
        manager.getSurfaceBounds('dimensioned'),
        { x: -5, y: 7, width: 48, height: 24 },
        'dimension array was not preserved'
    );
    const generatedA = manager.create({});
    const generatedB = manager.create({});
    assert(generatedA.id !== generatedB.id, 'generated surface IDs collided');
    assertThrows(
        () => manager.create({ id: 'bounded' }),
        /already exists/,
        'duplicate explicit surface ID did not fail closed'
    );
    assert(manager.getSurface('bounded') === bounded, 'duplicate admission replaced the original surface');
    checks.push('collision-safe IDs');

    const updateResult = manager.updateSurface('bounded', {
        bounds: { x: 15, width: 140 },
        metadata: { state: 'updated' }
    });
    assert(updateResult === bounded, 'surface update replaced object identity');
    assertEqual(
        manager.getSurfaceBounds(bounded),
        { x: 15, y: 20, width: 140, height: 80 },
        'partial bounds update discarded untouched fields'
    );
    assertEqual(
        bounded.metadata,
        { owner: 'test', state: 'updated' },
        'metadata update did not merge safely'
    );
    const stableBounds = manager.getSurfaceBounds(bounded);
    assertThrows(
        () => manager.updateSurface('bounded', { id: 'replacement' }),
        /cannot be updated/,
        'surface ID mutation was accepted'
    );
    assertThrows(
        () => manager.updateSurface('bounded', { resources: {} }),
        /cannot be updated/,
        'surface resource ownership mutation was accepted'
    );
    assertThrows(
        () => manager.updateSurface('bounded', { bounds: { width: 0 } }),
        /surface bounds\.width/,
        'invalid dimensions were accepted'
    );
    assertEqual(manager.getSurfaceBounds(bounded), stableBounds, 'failed update partially mutated bounds');
    const poisoned = JSON.parse('{"__proto__":{"polluted":true}}');
    assertThrows(
        () => manager.updateSurface('bounded', poisoned),
        /cannot be updated/,
        'prototype key was accepted as a surface update'
    );
    assert({}.polluted === undefined, 'surface update polluted Object.prototype');
    checks.push('atomic allowlisted updates');

    const hitManager = new PlaunaSurfaceManager();
    await hitManager.initialize();
    const low = hitManager.create({
        id: 'low',
        shape: 'rect',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        zIndex: 1
    });
    const high = hitManager.create({
        id: 'high',
        shape: 'circle',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        zIndex: 5
    });
    hitManager.create({
        id: 'hidden',
        shape: 'rect',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        zIndex: 10,
        visible: false
    });
    hitManager.create({
        id: 'inert',
        shape: 'rect',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        zIndex: 20,
        interactive: false
    });
    assert(hitManager.hitTest(50, 50)?.surface === high, 'topmost interactive surface was not selected');
    assert(hitManager.hitTest('low', 50, 50)?.surface === low, 'targeted hitTest compatibility changed');
    assert(hitManager.hitTest('high', 0, 0) === null, 'circle corner produced a false hit');

    const rounded = hitManager.create({
        id: 'rounded',
        shape: 'rounded-rect',
        bounds: { x: 120, y: 0, width: 100, height: 80 },
        cornerRadius: 20
    });
    assert(hitManager.hitTest('rounded', 121, 1) === null, 'rounded corner produced a false hit');
    assert(hitManager.hitTest('rounded', 170, 40)?.surface === rounded, 'rounded rect center missed');

    const ellipse = hitManager.create({
        id: 'ellipse',
        shape: 'ellipse',
        bounds: { x: 240, y: 0, width: 120, height: 60 }
    });
    assert(hitManager.hitTest('ellipse', 240, 0) === null, 'ellipse corner produced a false hit');
    assert(hitManager.hitTest('ellipse', 300, 30)?.surface === ellipse, 'ellipse center missed');

    hitManager.setVisible('high', false);
    assert(hitManager.hitTest(50, 50)?.surface === low, 'hidden high-z surface blocked a lower surface');
    const tie = hitManager.create({
        id: 'tie',
        shape: 'rect',
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        zIndex: 1
    });
    assert(hitManager.hitTest(null, 50, 50)?.surface === tie, 'later equal-z surface was not topmost');
    checks.push('shape-aware topmost hit testing');

    manager.destroy();
    hitManager.destroy();
}

async function verifyGpuAndRendererLifecycle(checks) {
    const events = {
        resourceCreates: [],
        resourceUpdates: [],
        resourceDestroys: [],
        surfaceRenderers: new Map(),
        surfaceRendererDestroys: [],
        rendererResourceDestroys: [],
        pipelineCreates: 0,
        bindGroupCreates: 0,
        samplerCreates: 0
    };
    const bridge = createGpuBridge(events);
    const manager = new PlaunaSurfaceManager({ gpuBridge: bridge });
    await manager.initialize();

    const gpuSurface = manager.create({
        id: 'gpu',
        bounds: { x: 2, y: 3, width: 320, height: 180 }
    });
    assertEqual(
        events.resourceCreates,
        [{ id: 'gpu', width: 320, height: 180 }],
        'GPU bridge did not receive authored dimensions'
    );
    assertThrows(
        () => manager.create({ id: 'gpu' }),
        /already exists/,
        'duplicate GPU surface ID was accepted'
    );
    assert(events.resourceCreates.length === 1, 'duplicate admission allocated GPU resources');

    bridge.failUpdate = true;
    assertThrows(
        () => manager.updateSurface('gpu', { bounds: { width: 640 } }),
        /synthetic resource update failure/,
        'GPU update failure was not reported'
    );
    assert(gpuSurface.width === 320, 'failed GPU update mutated the public surface');
    bridge.failUpdate = false;
    manager.updateSurface('gpu', { bounds: { width: 640 } });
    assert(gpuSurface.width === 640, 'successful GPU bounds update was not committed');
    checks.push('GPU bounds and atomic updates');

    globalThis.GPUShaderStage = globalThis.GPUShaderStage || Object.freeze({ FRAGMENT: 2 });
    const renderer = manager.createRenderer(createVgpu(events));
    await renderer.initialize();
    await renderer.initialize();
    renderer.addSurface(gpuSurface);
    renderer.addSurface(gpuSurface);
    assert(renderer.surfaces.length === 1, 'renderer retained a duplicate surface reference');
    assert(events.pipelineCreates === 1 && events.bindGroupCreates === 1 && events.samplerCreates === 1,
        'renderer initialization was not idempotent');

    assert(manager.destroySurface('gpu') === true, 'first surface destroy did not report success');
    assert(manager.destroySurface('gpu') === false, 'second surface destroy was not a no-op');
    assert(events.resourceDestroys.length === 1, 'surface resources were destroyed more than once');
    assert(events.surfaceRendererDestroys.length === 1, 'surface-owned renderer was destroyed more than once');
    assert(renderer.surfaces.length === 0, 'destroyed surface remained in a renderer');

    manager.create({ id: 'remaining', width: 64, height: 32 });
    manager.destroy();
    manager.destroy();
    assert(events.resourceDestroys.length === 2, 'manager destroy did not clean the remaining surface exactly once');
    assert(events.surfaceRendererDestroys.length === 2,
        'manager destroy did not clean remaining surface renderers exactly once');
    assertEqual(
        events.rendererResourceDestroys.sort(),
        ['bind-group', 'pipeline', 'sampler'],
        'renderer GPU resources were not destroyed exactly once'
    );
    assert(manager.surfaces.size === 0 && manager.renderers.size === 0,
        'manager retained surface or renderer ownership after destroy');
    assert(!manager.initialized, 'manager remained initialized after destroy');
    checks.push('idempotent surface and renderer cleanup');
}

export async function runPlaunaSurfaceManagerTests() {
    const checks = [];
    try {
        await verifyBoundsIdsUpdatesAndHitTesting(checks);
        await verifyGpuAndRendererLifecycle(checks);
    } catch (error) { return {passed:false, checks, error:String(error?.stack || error)}; }
    return Object.freeze({ passed: true, checks: Object.freeze([...checks]) });
}

const result = await runPlaunaSurfaceManagerTests();
const expectedNames = ["explicit bounds and dimensions", "collision-safe IDs", "atomic allowlisted updates", "shape-aware topmost hit testing", "GPU bounds and atomic updates", "idempotent surface and renderer cleanup"];
export const suiteResult = finishSuite('plauna-surface', expectedNames.map((name, index) => ({name, passed:result.checks.includes(name), status:result.checks.includes(name) ? 'PASS' : index===result.checks.length ? 'FAIL' : 'NOT_RUN', error:result.error})));
