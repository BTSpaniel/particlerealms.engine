// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Executed capability probes, usable in windows and module workers without WebGPU. */
const TYPE = [1, 5, 1, 96, 0, 1, 127];
const HEADER = [0, 97, 115, 109, 1, 0, 0, 0];
const FUNCTION = [3, 2, 1, 0];
const EXPORT = [7, 7, 1, 3, 114, 117, 110, 0, 0];

function probe(body, imports = [], importObject = {}) {
    try {
        if (typeof WebAssembly === 'undefined') return false;
        const bytes = new Uint8Array([...HEADER, ...TYPE, ...imports, ...FUNCTION, ...EXPORT,
            10, body.length + 2, 1, body.length, ...body]);
        if (!WebAssembly.validate(bytes)) return false;
        return new WebAssembly.Instance(new WebAssembly.Module(bytes), importObject).exports.run() === 42;
    } catch (_) { return false; }
}

export function detectWasmSimd() {
    // v128.const i32x4(42,0,0,0), followed by i32x4.extract_lane 0.
    return probe([0, 253, 12, 42, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 253, 27, 0, 11]);
}

export function detectWasmThreads() {
    try {
        if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined'
            || typeof Atomics === 'undefined' || typeof WebAssembly === 'undefined') return false;
        const memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
        Atomics.store(new Int32Array(memory.buffer), 0, 42);
        // Import env.memory with shared limits, and execute i32.atomic.load.
        const imports = [2, 16, 1, 3, 101, 110, 118, 6, 109, 101, 109, 111, 114, 121, 2, 3, 1, 1];
        return probe([0, 65, 0, 254, 16, 2, 0, 11], imports, { env: { memory } });
    } catch (_) { return false; }
}

export function detectWasmCapabilities() {
    const scalar = probe([0, 65, 42, 11]);
    const simd = scalar && detectWasmSimd();
    const threads = scalar && detectWasmThreads();
    return Object.freeze({ wasm: scalar, scalar, simd, threads, threadsSimd: simd && threads,
        workers: typeof Worker !== 'undefined', crossOriginIsolated: globalThis.crossOriginIsolated === true,
        sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined' });
}

export const probeWasmCapabilities = detectWasmCapabilities;
