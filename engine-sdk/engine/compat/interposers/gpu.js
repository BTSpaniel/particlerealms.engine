// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

const shimState = new WeakMap();

function report(onError, type, message) {
    try { onError?.({ type, message: String(message || '') }); } catch (_) {}
}

function wrapQueueSubmit(device, metrics) {
    const queue = device?.queue;
    if (!queue || typeof queue.submit !== 'function') return () => {};
    const original = queue.submit.bind(queue);
    const wrapped = buffers => {
        if (metrics) metrics.gpuSubmits = (metrics.gpuSubmits ?? 0) + 1;
        return original(buffers);
    };
    try {
        queue.submit = wrapped;
        return () => {
            try { if (queue.submit === wrapped) queue.submit = original; } catch (_) {}
        };
    } catch (_) {
        return () => {};
    }
}

function gpuShimDisposedError() {
    const error = new Error('GPU compatibility shim has been disposed');
    error.code = 'GPU_COMPAT_SHIM_DISPOSED';
    return error;
}

function assertShimCurrent(state, lifecycleEpoch) {
    if (state.destroyed || state.lifecycleEpoch !== lifecycleEpoch) {
        throw gpuShimDisposedError();
    }
}

function retireOwnedDevice(state, device) {
    if (!device || state.retiredDevices.has(device)) return false;
    state.retiredDevices.add(device);
    try { state.queueRestorers.get(device)?.(); } catch (_) {}
    try { device.destroy?.(); } catch (_) {}
    state.queueRestorers.delete(device);
    state.ownedDevices.delete(device);
    return true;
}

function wrapAdapter(adapter, state, lifecycleEpoch, ownsDevices) {
    const facadeTarget = Object.create(Object.getPrototypeOf(adapter));
    return new Proxy(facadeTarget, {
        get(_target, property) {
            if (property === 'requestDevice') {
                return async (descriptor = {}) => {
                    assertShimCurrent(state, lifecycleEpoch);
                    // Required WebGPU capabilities keep their normal semantics.
                    // A compatibility layer must not silently weaken them.
                    const device = await adapter.requestDevice(descriptor);
                    if (state.destroyed || state.lifecycleEpoch !== lifecycleEpoch) {
                        if (ownsDevices) retireOwnedDevice(state, device);
                        throw gpuShimDisposedError();
                    }
                    if (!ownsDevices) return device;

                    state.ownedDevices.add(device);
                    state.queueRestorers.set(device, wrapQueueSubmit(device, state.metrics));
                    device.lost?.then(info => {
                        if (state.destroyed || state.lifecycleEpoch !== lifecycleEpoch) return;
                        if (info?.reason !== 'destroyed') {
                            report(state.onError, 'gpu-device-lost', info?.message || 'dedicated compatibility device lost');
                        }
                    }).catch(error => {
                        if (state.destroyed || state.lifecycleEpoch !== lifecycleEpoch) return;
                        report(state.onError, 'gpu-device-lost', error?.message || error);
                    });
                    return device;
                };
            }
            const value = adapter[property];
            return typeof value === 'function' ? value.bind(adapter) : value;
        },
    });
}

/**
 * Create a per-realm navigator.gpu shim with an explicit ownership policy.
 *
 * In WebGPU OS, `gpuHost.policy === 'shared-kernel'` returns broker facades and
 * never calls the ambient navigator.gpu acquisition path. Standalone compat
 * runtimes use a dedicated-owned device and destroy it during realm teardown.
 */
export function makeGpuShim({ metrics, onError, gpuHost = null, appId = '' } = {}) {
    const realGpu = globalThis.navigator?.gpu;
    if (!realGpu && gpuHost?.policy !== 'shared-kernel') return null;
    const state = {
        metrics,
        onError,
        gpuHost,
        appId: String(appId),
        policy: gpuHost?.policy === 'shared-kernel' ? 'shared-kernel' : 'dedicated-owned',
        ownedDevices: new Set(),
        queueRestorers: new Map(),
        retiredDevices: new WeakSet(),
        lifecycleEpoch: 0,
        destroyed: false,
    };
    const shim = {
        __compat: true,
        ownershipPolicy: state.policy,
        getPreferredCanvasFormat: realGpu?.getPreferredCanvasFormat
            ? (...args) => realGpu.getPreferredCanvasFormat(...args)
            : () => gpuHost?.format || 'bgra8unorm',
        get wgslLanguageFeatures() { return realGpu?.wgslLanguageFeatures; },
        async requestAdapter(options = {}) {
            const lifecycleEpoch = state.lifecycleEpoch;
            assertShimCurrent(state, lifecycleEpoch);
            if (state.policy === 'shared-kernel') {
                const adapter = await state.gpuHost.requestAdapter(state.appId, options);
                assertShimCurrent(state, lifecycleEpoch);
                return adapter ? wrapAdapter(adapter, state, lifecycleEpoch, false) : null;
            }
            const adapter = await realGpu.requestAdapter(options);
            assertShimCurrent(state, lifecycleEpoch);
            return adapter ? wrapAdapter(adapter, state, lifecycleEpoch, true) : null;
        },
    };
    shimState.set(shim, state);
    return Object.freeze(shim);
}

export function disposeGpuShim(shim) {
    const state = shimState.get(shim);
    if (!state || state.destroyed) return false;
    state.destroyed = true;
    state.lifecycleEpoch += 1;
    for (const device of state.ownedDevices) {
        retireOwnedDevice(state, device);
    }
    state.queueRestorers.clear();
    state.ownedDevices.clear();
    try { state.gpuHost?.releaseApp?.(state.appId); } catch (_) {}
    shimState.delete(shim);
    return true;
}

function documentProxyFor(realDocument, patchCanvas) {
    return new Proxy(realDocument, {
        get(target, property) {
            if (property === 'createElement') {
                return (tagName, options) => {
                    const element = target.createElement(tagName, options);
                    if (String(tagName).toLowerCase() === 'canvas') patchCanvas(element);
                    return element;
                };
            }
            if (property === 'createElementNS') {
                return (namespace, qualifiedName, options) => {
                    const element = target.createElementNS(namespace, qualifiedName, options);
                    if (String(qualifiedName).toLowerCase() === 'canvas') patchCanvas(element);
                    return element;
                };
            }
            const value = target[property];
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
}

/**
 * Patch only canvases owned by one compatibility realm. The returned document
 * proxy also patches synchronously-created canvases before guest code can call
 * getContext('webgpu').
 */
export function installGpuCanvasBridge({ realm, gpuHost, appId, onError } = {}) {
    if (gpuHost?.policy !== 'shared-kernel' || !realm?.container) return null;
    const patched = new Map();
    const wrappedContexts = new WeakMap();
    let destroyed = false;

    const wrapContext = (canvas, context) => {
        let wrapped = wrappedContexts.get(context);
        if (wrapped) return wrapped;
        wrapped = new Proxy({}, {
            get(_target, property) {
                if (property === 'canvas') return canvas;
                if (destroyed) {
                    if (property === 'getConfiguration') return () => null;
                    if (property === 'unconfigure') return () => false;
                    if (typeof context[property] === 'function') {
                        return () => { throw new Error('GPU compatibility canvas bridge has been released'); };
                    }
                    return undefined;
                }
                if (property === 'configure') {
                    return descriptor => {
                        if (!descriptor || typeof descriptor !== 'object') {
                            throw new TypeError('GPUCanvasContext.configure requires a descriptor');
                        }
                        gpuHost.configureCanvas({
                            appId,
                            canvas,
                            context,
                            facade: descriptor.device,
                            descriptor,
                        });
                    };
                }
                if (property === 'getConfiguration') {
                    return () => gpuHost.configurationFor({ appId, canvas, context });
                }
                if (property === 'unconfigure') {
                    return () => gpuHost.unconfigureCanvas({ appId, canvas, context });
                }
                const value = context[property];
                return typeof value === 'function' ? value.bind(context) : value;
            },
        });
        wrappedContexts.set(context, wrapped);
        return wrapped;
    };

    const patchCanvas = canvas => {
        if (destroyed || !canvas || patched.has(canvas) || typeof canvas.getContext !== 'function') return canvas;
        const ownDescriptor = Object.getOwnPropertyDescriptor(canvas, 'getContext');
        const original = canvas.getContext.bind(canvas);
        const replacement = (type, options) => {
            const context = original(type, options);
            return type === 'webgpu' && context ? wrapContext(canvas, context) : context;
        };
        try {
            Object.defineProperty(canvas, 'getContext', {
                configurable: true,
                writable: true,
                value: replacement,
            });
            patched.set(canvas, { ownDescriptor });
        } catch (error) {
            report(onError, 'gpu-canvas-interpose', error?.message || error);
        }
        return canvas;
    };

    realm.container.querySelectorAll?.('canvas').forEach(patchCanvas);
    const observer = typeof MutationObserver === 'function'
        ? new MutationObserver(records => {
            for (const record of records) {
                for (const node of record.addedNodes || []) {
                    if (node?.tagName === 'CANVAS') patchCanvas(node);
                    node?.querySelectorAll?.('canvas').forEach(patchCanvas);
                }
            }
        })
        : null;
    observer?.observe(realm.container, { childList: true, subtree: true });

    const destroy = () => {
        if (destroyed) return false;
        destroyed = true;
        try { observer?.disconnect(); } catch (_) {}
        for (const [canvas, record] of patched) {
            try {
                if (record.ownDescriptor) Object.defineProperty(canvas, 'getContext', record.ownDescriptor);
                else delete canvas.getContext;
            } catch (_) {}
        }
        patched.clear();
        try { gpuHost.releaseApp?.(appId); } catch (_) {}
        return true;
    };
    return Object.freeze({
        document: documentProxyFor(globalThis.document, patchCanvas),
        patchCanvas,
        destroy,
    });
}
