// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { runEngine, runWorker, runPlauna, runEditor, runAGI, runOS } from './scenarios.js';

const mode = document.documentElement.dataset.sdkMode;
const profile = document.documentElement.dataset.sdkProfile;
const parameters = new URLSearchParams(location.search);
const selected = parameters.get('case') || 'engine';
const stage = document.querySelector('#stage');
const output = document.querySelector('#result');
const cleanupButton = document.querySelector('#cleanup-example');
const runButton = document.querySelector('#run-example');
const sdkRoot = new URL('../', document.baseURI);
const descriptions = {
    engine: 'Create an ECS entity, simulate a native PhysX body, and render its retained transform with Engine mesh helpers.',
    worker: 'Apply water in a real Surface Field worker, run WebGPU transport, and round-trip a retained checkpoint.',
    plauna: 'Render a retained Plauna button, dispatch a native DOM click, and verify its StateStore projection.',
    editor: 'Create, save, reopen, modify, and reopen an Editor project using the existing IndexedDB storage API.',
    agi: 'Use AGI ComputeGraph to execute vector addition on WebGPU and scale the resulting Float32Array.',
    os: 'Explicitly boot a local app through the OS in its required temporary credentialless demo partition.',
};
const receipt = window.__SDK_EXAMPLE_RESULT__ = {
    status: 'running', case: selected, mode, checks: [], cleanup: { status: 'pending' },
};
const resources = [];
let cleanupPromise = null;
let started = false;

function render() {
    output.textContent = JSON.stringify(receipt, null, 2);
    output.setAttribute('role', receipt.status === 'failed' || receipt.status === 'unsupported' ? 'alert' : 'status');
}

function check(name, passed, detail = null) {
    if (!passed) throw new Error(`Example assertion failed: ${name}`);
    receipt.checks.push({ name, passed: true, detail });
    render();
}

function own(name, release) {
    resources.push({ name, release });
}

async function cleanup() {
    if (cleanupPromise) return cleanupPromise;
    cleanupButton.disabled = true;
    cleanupPromise = (async () => {
        const failures = [];
        const released = [];
        for (const resource of resources.splice(0).reverse()) {
            try {
                await resource.release();
                released.push(resource.name);
            } catch (error) {
                failures.push(`${resource.name}: ${error.message}`);
            }
        }
        receipt.cleanup = { status: failures.length ? 'failed' : 'passed', released, failures };
        render();
        if (failures.length) throw new Error(failures.join('; '));
        return receipt.cleanup;
    })();
    return cleanupPromise;
}
window.__SDK_EXAMPLE_CLEANUP__ = cleanup;
cleanupButton.addEventListener('click', () => cleanup().catch(fail));
window.addEventListener('pagehide', () => { void cleanup().catch(error => console.error('[SDK example] cleanup failed', error)); }, { once: true });

function fail(error) {
    receipt.status = error.name === 'UnsupportedBrowserError' ? 'unsupported' : 'failed';
    receipt.error = { name: error.name, message: error.message };
    console.error('[SDK example]', selected, mode, error);
    render();
}

function unsupported(message) {
    const error = new Error(message);
    error.name = 'UnsupportedBrowserError';
    throw error;
}

async function until(predicate, description, timeoutMs = 30000) {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
        const value = predicate();
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out: ${description}`);
}

async function gpu() {
    if (!isSecureContext || !navigator.gpu) unsupported('WebGPU requires a supported browser on HTTPS or localhost. Use python serve_sdk.py and enable browser WebGPU support.');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) unsupported('The browser exposes WebGPU but no GPU adapter is available. Check browser GPU diagnostics.');
    const device = await adapter.requestDevice();
    let destroyed = false;
    const onError = event => fail(event.error || new Error('Uncaptured GPU error'));
    device.addEventListener('uncapturederror', onError);
    void device.lost.then(info => {
        if (!destroyed) fail(new Error(`WebGPU device lost: ${info.reason}: ${info.message}`));
    });
    own('WebGPU device', async () => {
        try { await device.queue.onSubmittedWorkDone(); }
        finally {
            destroyed = true;
            device.removeEventListener('uncapturederror', onError);
            device.destroy();
        }
        const lost = await device.lost;
        if (lost.reason !== 'destroyed') throw new Error(`Unexpected device teardown reason: ${lost.reason}`);
    });
    return { adapter, device };
}

async function api() {
    if (mode === 'compiled') {
        await until(() => globalThis.__PE_RUNTIME_READY, 'verified compiled runtime promise');
        const runtime = await globalThis.__PE_RUNTIME_READY;
        if (!runtime || typeof runtime.createWorld !== 'function') throw new Error('The verified runtime does not expose Engine public exports');
        return { engine: runtime, plauna: runtime.Plauna, editor: runtime.Editor, agi: runtime.AGI, os: runtime.WebGPUOS };
    }
    const engine = await import(new URL('engine/EngineBootstrap.js', sdkRoot).href);
    if (selected === 'engine' || selected === 'worker') return { engine };
    const entry = { plauna: 'plauna/index.js', editor: 'editor/js/modules/ProjectStorage.js', agi: 'agi/index.js', os: 'webgpu-os/index.js' }[selected];
    if (!entry) throw new Error(`Unknown SDK example: ${selected}`);
    return { engine, [selected]: await import(new URL(entry, sdkRoot).href) };
}

async function start() {
    if (started) return;
    started = true;
    runButton.disabled = true;
    try {
        if (!descriptions[selected]) throw new Error(`Unknown SDK example: ${selected}`);
        const response = await fetch(new URL('manifest.json', sdkRoot));
        if (!response.ok) throw new Error(`SDK receipt HTTP ${response.status}`);
        const manifest = await response.json();
        if (manifest.profile !== profile || !manifest.bundle) throw new Error('SDK profile receipt is unavailable');
        const capability = { plauna: 'include_plauna', editor: 'include_editor', agi: 'include_agi', os: 'include_webgpu_os' }[selected];
        if (capability && !manifest.bundle[capability]) throw new Error(`${selected} is not included in this SDK; choose a package with that subsystem`);
        const reportError = error => {
            fail(error);
            void cleanup().catch(cleanupError => console.error('[SDK example] cleanup failed', cleanupError));
        };
        const context = { stage, sdkRoot, check, own, gpu, until, unsupported, receipt, reportError };
        if (selected === 'os' && parameters.get('frame') !== '1') {
            if (!('credentialless' in HTMLIFrameElement.prototype)) unsupported('The OS demo requires Chromium credentialless iframe support.');
            const frame = document.createElement('iframe');
            frame.title = 'Temporary WebGPU OS SDK app';
            frame.credentialless = true;
            const url = new URL(location.href);
            url.searchParams.set('frame', '1');
            frame.src = url.href;
            stage.append(frame);
            own('Credentialless OS demo frame', async () => {
                const child = frame.contentWindow;
                if (typeof child?.__SDK_EXAMPLE_CLEANUP__ === 'function') {
                    await child.__SDK_EXAMPLE_CLEANUP__();
                    if (child.__SDK_EXAMPLE_RESULT__?.cleanup?.status !== 'passed') throw new Error('OS child cleanup failed');
                }
                frame.remove();
            });
            const childResult = await until(() => {
                const value = frame.contentWindow?.__SDK_EXAMPLE_RESULT__;
                return value && value.status !== 'running' ? value : null;
            }, 'OS app boot and mount', 120000);
            if (childResult.status !== 'passed') throw new Error(childResult.error?.message || `OS demo ${childResult.status}`);
            for (const entry of childResult.checks) check(entry.name, entry.passed, entry.detail);
        } else {
            const runtime = await api();
            const operation = { engine: runEngine, worker: runWorker, plauna: runPlauna, editor: runEditor, agi: runAGI, os: runOS }[selected];
            await operation(runtime, context);
        }
        if (receipt.status !== 'failed') receipt.status = 'passed';
        cleanupButton.disabled = Boolean(cleanupPromise);
        render();
    } catch (error) {
        fail(error);
        try { await cleanup(); } catch (cleanupError) { console.error('[SDK example] cleanup failed', cleanupError); }
    }
}

document.querySelector('#title').textContent = `${selected.toUpperCase()} · ${mode} SDK example`;
document.querySelector('#description').textContent = descriptions[selected] || 'Unknown example';
document.title = `${selected} · ${mode} SDK example`;
render();
if (selected === 'os' && parameters.get('frame') !== '1') {
    runButton.hidden = false;
    runButton.addEventListener('click', start, { once: true });
} else {
    void start();
}
