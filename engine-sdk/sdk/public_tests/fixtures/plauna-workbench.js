// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { resolveModule, sourceUrl, finishSuite } from '../resolver.js';
const {
    buildBackdropController,
    mountPlaunaWorkbenchLab,
} = await resolveModule("plauna/lab/workbench-lab.js", ["buildBackdropController", "mountPlaunaWorkbenchLab"]);

const tests = [];

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

async function withTimeout(promise, label, timeoutMs = 5000) {
    let timer = 0;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    });
    try { return await Promise.race([promise, timeout]); }
    finally { clearTimeout(timer); }
}

async function test(name, body) {
    try {
        await body();
        tests.push({ name, passed: true });
    } catch (error) {
        tests.push({ name, passed: false, error: error?.stack || String(error) });
    }
}

await test('backdrop destroy releases a late standalone lease without publication', async () => {
    const acquisition = deferred();
    const canvas = document.createElement('canvas');
    let releases = 0;
    const controller = buildBackdropController(canvas, {
        info() {}, warn() {}, error() {},
    }, {
        gpuLeaseFactory: () => acquisition.promise,
        format: 'bgra8unorm',
    });
    const first = controller.initialize();
    const second = controller.initialize();
    assert(first === second, 'backdrop initialization was not single-flight');
    assert(controller.destroy() && controller.destroy() === false,
        'backdrop destroy was not idempotent');
    acquisition.resolve({
        device: { queue: {} },
        release() { releases += 1; },
    });
    let error = null;
    try { await first; } catch (caught) { error = caught; }
    assert(error?.code === 'PLAUNA_BACKDROP_DESTROYED',
        'destroyed backdrop accepted its late acquisition');
    assert(releases === 1, `late backdrop lease was released ${releases} times`);
});

await test('successful backdrop initialization is sequentially idempotent', async () => {
    const canvas = document.createElement('canvas');
    const context = { configure() {}, unconfigure() {} };
    canvas.getContext = type => type === 'webgpu' ? context : null;
    let acquisitions = 0;
    let releases = 0;
    let bufferDestroys = 0;
    const device = {
        queue: { writeBuffer() {}, submit() {} },
        createShaderModule() { return {}; },
        createBuffer() { return { destroy() { bufferDestroys += 1; } }; },
        createRenderPipeline() { return { getBindGroupLayout() { return {}; } }; },
        createBindGroup() { return {}; },
    };
    const controller = buildBackdropController(canvas, {
        info() {}, warn() {}, error() {},
    }, {
        gpuLeaseFactory: async () => {
            acquisitions += 1;
            return { device, ownership: 'standalone-fallback', release() { releases += 1; } };
        },
        format: 'bgra8unorm',
    });
    assert(await controller.initialize() && await controller.initialize(),
        'successful backdrop could not be re-read as initialized');
    assert(acquisitions === 1, `sequential initialize acquired ${acquisitions} leases`);
    controller.destroy();
    assert(releases === 1 && bufferDestroys === 1,
        'initialized backdrop resources were not released exactly once');
});

await test('workbench boot is fenced and every installed interaction is removed', async () => {
    const root = document.createElement('div');
    const statusElement = document.createElement('div');
    document.body.append(root, statusElement);
    let backdropDestroyCount = 0;
    let backdropInitializeCount = 0;
    let backdropResizeCount = 0;
    let appDestroyCount = 0;
    let infoCount = 0;
    const components = new Map();
    const textService = {
        measureCache: new Map(),
        prepare(text, options = {}) { return { text: String(text), options }; },
        measure(handle) {
            return { width: handle.text.length * 7, ascent: 10, descent: 3 };
        },
        layout(handle, width) {
            return {
                width: Math.min(width, Math.max(8, handle.text.length * 7)),
                height: 20,
                lineCount: 1,
                lines: [handle.text],
                metrics: { baseline: 14 },
            };
        },
    };
    const app = {
        initialized: true,
        workspaces: new Map(),
        textService,
        themeManager: {
            setTheme() {},
            getCurrentTheme() { return null; },
        },
        surfaceManager: { getAllSurfaces() { return []; } },
        registerView() {}, registerSurface() {}, addAdvancedLayoutToInspector() {},
        createSurface(descriptor) { return descriptor; },
        destroy() { appDestroyCount += 1; },
    };
    const logger = {
        info() { infoCount += 1; },
        warn() {},
        error() {},
    };
    const lab = mountPlaunaWorkbenchLab({
        root,
        statusElement,
        logger,
        backdropController: {
            initialize() { backdropInitializeCount += 1; return Promise.resolve(true); },
            resize() { backdropResizeCount += 1; },
            render() {},
            destroy() { backdropDestroyCount += 1; return true; },
        },
        initializePlauna: () => Promise.resolve(app),
        createWorld: () => ({}),
        createEntity: () => 1,
        setEntityComponent(_world, entity, name, value) { components.set(`${entity}:${name}`, value); },
        getEntityComponent(_world, entity, name) { return components.get(`${entity}:${name}`); },
    });
    const firstBoot = lab.boot();
    const secondBoot = lab.boot();
    assert(firstBoot === secondBoot, 'workbench boot was not single-flight');
    assert(await withTimeout(firstBoot, 'workbench boot'), 'workbench boot did not complete');
    assert(await lab.boot() && backdropInitializeCount === 1,
        'sequential workbench boot repeated backdrop/application initialization');

    const designButton = root.querySelector('[data-design]');
    assert(designButton, 'fixture could not locate a design interaction');
    const beforeActiveClick = infoCount;
    designButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    assert(infoCount > beforeActiveClick, 'workbench interaction was not installed');

    assert(lab.destroy() && lab.destroy() === false, 'workbench destroy was not idempotent');
    const afterDestroyInfo = infoCount;
    const afterDestroyResize = backdropResizeCount;
    designButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    window.dispatchEvent(new Event('resize'));
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: 1, clientY: innerHeight - 1 }));
    await new Promise(resolve => setTimeout(resolve, 150));
    assert(infoCount === afterDestroyInfo && backdropResizeCount === afterDestroyResize,
        'destroyed workbench retained root/window/document interactions');
    assert(backdropDestroyCount === 1 && appDestroyCount === 1,
        'workbench did not tear down backdrop and Plauna app exactly once');
    root.remove();
    statusElement.remove();
});


export const suiteResult = finishSuite('plauna-workbench', tests);
