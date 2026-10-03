// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { executeJsOperation, executeWasmOperation } from './ComputeOperations.js';
import { assertComputeContract, projectComputeContractValue } from './ComputeContracts.js';
import { assertCompute } from './ComputeErrors.js';

let context = null;
let ready = false;
let busy = false;

function validateInitialization(message) {
    const hasModule = message.module instanceof WebAssembly.Module;
    const hasMemory = message.memory instanceof WebAssembly.Memory;
    const shared = hasMemory && typeof SharedArrayBuffer !== 'undefined' && message.memory.buffer instanceof SharedArrayBuffer;
    assertComputeContract('worker-message', {
        type: 'init', workerId: message.workerId, backend: message.backend, variant: message.variant,
        hasModule, hasMemory, shared, memoryBytes: hasMemory ? message.memory.buffer.byteLength : 0,
        memoryDescriptor: message.memoryDescriptor, stackPointer: message.stackPointer,
        arenaStart: message.arenaStart, arenaEnd: message.arenaEnd, cancelOffset: message.cancelOffset,
    }, { code: 'COMPUTE_WORKER_INIT_FAILED' });
    assertCompute(message.backend === (message.variant === 'js' ? 'js' : `wasm-${message.variant}`),
        'COMPUTE_WORKER_INIT_FAILED', 'Compute worker backend and variant differ');
    if (message.backend === 'js') {
        assertCompute(!message.module && !message.memory && !message.memoryDescriptor && !message.sharedBuffer,
            'COMPUTE_WORKER_INIT_FAILED', 'JavaScript worker cannot attach executable or shared memory');
        return;
    }
    const threaded = message.variant.startsWith('threads');
    assertCompute(hasModule && (threaded ? hasMemory && shared && !message.memoryDescriptor : !message.memory && !!message.memoryDescriptor),
        'COMPUTE_WORKER_INIT_FAILED', 'Compute worker requires the selected native module and memory mode');
    const bytes = hasMemory ? message.memory.buffer.byteLength : message.memoryDescriptor.initial * 65536;
    assertCompute((hasMemory || message.memoryDescriptor.initial === message.memoryDescriptor.maximum)
        && message.cancelOffset % 4 === 0 && message.cancelOffset + 4 <= message.stackPointer - 1048576
        && message.stackPointer === message.arenaStart && message.arenaEnd > message.arenaStart && message.arenaEnd <= bytes,
    'COMPUTE_WORKER_INIT_FAILED', 'Compute worker stack, cancellation word and scratch arena overlap or exceed memory');
}

function cancelled() {
    return context?.cancelOffset && typeof SharedArrayBuffer !== 'undefined' && context.memory?.buffer instanceof SharedArrayBuffer
        && Atomics.load(new Int32Array(context.memory.buffer, context.cancelOffset, 1), 0) !== 0;
}

self.onmessage = async event => {
    const message = event.data || {};
    if (message.type === 'init') {
        try {
            assertCompute(!context && !ready && !busy, 'COMPUTE_WORKER_INIT_FAILED', 'Compute worker is already initialized');
            validateInitialization(message);
            context = { ...message };
            if (message.module) {
                context.memory = message.memory || (message.memoryDescriptor ? new WebAssembly.Memory(message.memoryDescriptor) : null);
                if (!(context.memory instanceof WebAssembly.Memory)) throw new Error('Compute worker requires its imported Wasm memory');
                context.instance = await WebAssembly.instantiate(message.module, { env: { memory: context.memory } });
                if (context.instance.exports.abi_version?.() !== 1) throw new Error('Compute worker ABI version mismatch');
                if (message.stackPointer !== undefined) {
                    if (!(context.instance.exports.__stack_pointer instanceof WebAssembly.Global)) throw new Error('Compute module does not export its stack pointer');
                    context.instance.exports.__stack_pointer.value = message.stackPointer;
                }
            }
            ready = true;
            self.postMessage({ type: 'ready', workerId: message.workerId, variant: message.variant || 'js' });
        } catch (error) {
            self.postMessage({ type: 'init-error', workerId: message.workerId, error: { message: error.message, code: error.code || 'COMPUTE_WORKER_INIT_FAILED' } });
        }
        return;
    }
    if (message.type !== 'job') return;
    const started = performance.now();
    try {
        if (!ready || busy) throw new Error('Compute worker is not ready for a job');
        assertComputeContract('worker-message', projectComputeContractValue(message), { code: 'COMPUTE_WORKER_FAILED' });
        assertCompute(message.data.backend === context.backend, 'COMPUTE_WORKER_FAILED', 'Compute job backend differs from its worker');
        busy = true;
        if (cancelled()) throw Object.assign(new Error('Compute job cancelled'), { code: 'COMPUTE_CANCELLED' });
        const result = context.instance && message.data.backend !== 'js'
            ? executeWasmOperation(message.data, context) : executeJsOperation(message.data);
        if (cancelled()) throw Object.assign(new Error('Compute job cancelled'), { code: 'COMPUTE_CANCELLED' });
        result.metrics = { ...result.metrics, computeMs: performance.now() - started, workerId: context.workerId };
        const transfers = [...new Set(Object.values(result.outputs || {}).map(value => value.buffer))];
        self.postMessage({ type: 'result', jobId: message.jobId, result }, transfers);
    } catch (error) {
        self.postMessage({ type: 'result', jobId: message.jobId, error: { name: error.name, message: error.message,
            code: error.code || 'COMPUTE_WORKER_FAILED' } });
    } finally { busy = false; }
};
