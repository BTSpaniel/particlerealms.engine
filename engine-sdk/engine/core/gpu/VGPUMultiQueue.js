// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Multi-Queue Abstraction - Separate graphics/compute/transfer queues when available
 */

export class VGPUMultiQueue {
    constructor(vgpu) {
        this._vgpu = vgpu;
        this._device = vgpu.device;
        
        // WebGPU currently only exposes a single queue
        // This abstraction prepares for future multi-queue support
        this._queues = {
            graphics: new VirtualQueue(this, 'graphics', vgpu.queue),
            compute: new VirtualQueue(this, 'compute', vgpu.queue),
            transfer: new VirtualQueue(this, 'transfer', vgpu.queue),
        };
        
        // Queue priorities (for future scheduling)
        this._priorities = {
            graphics: 1.0,
            compute: 0.8,
            transfer: 0.5,
        };
        
        // Pending work per queue
        this._pendingWork = {
            graphics: [],
            compute: [],
            transfer: [],
        };
        
        // Synchronization
        this._fences = new Map();
        this._nextFenceId = 0;
        this._destroyed = false;
        this._generation = 0;
        this._destroyError = null;
    }

    get vgpu() {
        this._assertAlive();
        return this._vgpu;
    }

    get device() {
        this._assertAlive();
        return this._device;
    }

    /**
     * Get a specific queue
     * @param {'graphics'|'compute'|'transfer'} type - Queue type
     */
    getQueue(type) {
        this._assertAlive();
        return this._queues[type] || this._queues.graphics;
    }

    /**
     * Get the graphics queue (primary)
     */
    get graphics() {
        this._assertAlive();
        return this._queues.graphics;
    }

    /**
     * Get the compute queue
     */
    get compute() {
        this._assertAlive();
        return this._queues.compute;
    }

    /**
     * Get the transfer/copy queue
     */
    get transfer() {
        this._assertAlive();
        return this._queues.transfer;
    }

    /**
     * Submit work to a specific queue
     * @param {'graphics'|'compute'|'transfer'} queueType
     * @param {GPUCommandBuffer[]} commandBuffers
     * @returns {number} Fence ID
     */
    submit(queueType, commandBuffers) {
        this._assertAlive();
        const queue = this._queues[queueType];
        if (!queue) {
            console.warn(`[MultiQueue] Unknown queue type: ${queueType}`);
            return -1;
        }
        
        return queue.submit(commandBuffers);
    }

    /**
     * Submit graphics work
     */
    submitGraphics(commandBuffers) {
        return this.submit('graphics', commandBuffers);
    }

    /**
     * Submit compute work
     */
    submitCompute(commandBuffers) {
        return this.submit('compute', commandBuffers);
    }

    /**
     * Submit transfer/copy work
     */
    submitTransfer(commandBuffers) {
        return this.submit('transfer', commandBuffers);
    }

    /**
     * Create a fence for synchronization
     * @returns {Fence}
     */
    createFence() {
        this._assertAlive();
        const id = this._nextFenceId++;
        const fence = new Fence(this, id);
        this._fences.set(id, fence);
        return fence;
    }

    /**
     * Wait for a fence to complete
     * @param {Fence|number} fence
     */
    waitFence(fence) {
        this._assertAlive();
        const fenceObj = typeof fence === 'number' ? this._fences.get(fence) : fence;
        return fenceObj ? fenceObj.wait() : Promise.resolve();
    }

    /**
     * Signal a fence from a queue
     */
    signalFence(fence, queueType = 'graphics') {
        this._assertAlive();
        const fenceObj = typeof fence === 'number' ? this._fences.get(fence) : fence;
        if (fenceObj) {
            fenceObj.signal(queueType);
        }
    }

    /**
     * Create a cross-queue dependency
     * @param {string} fromQueue - Source queue
     * @param {string} toQueue - Destination queue
     * @param {number} fenceId - Fence to wait on
     */
    addDependency(fromQueue, toQueue, fenceId) {
        this._assertAlive();
        const targetQueue = this._queues[toQueue];
        if (targetQueue) {
            targetQueue.addWait(fenceId);
        }
    }

    /**
     * Execute async compute work
     */
    async dispatchAsync(computeWork) {
        this._assertAlive();
        const encoder = this._device.createCommandEncoder({ label: 'AsyncCompute' });
        this._assertAlive();
        computeWork(encoder);
        this._assertAlive();
        const commandBuffer = encoder.finish();
        this._assertAlive();
        
        const fence = this.createFence();
        this.submitCompute([commandBuffer]);
        this.signalFence(fence, 'compute');
        
        return fence;
    }

    /**
     * Execute async transfer work
     */
    async transferAsync(transferWork) {
        this._assertAlive();
        const encoder = this._device.createCommandEncoder({ label: 'AsyncTransfer' });
        this._assertAlive();
        transferWork(encoder);
        this._assertAlive();
        const commandBuffer = encoder.finish();
        this._assertAlive();
        
        const fence = this.createFence();
        this.submitTransfer([commandBuffer]);
        this.signalFence(fence, 'transfer');
        
        return fence;
    }

    /**
     * Get queue statistics
     */
    getStats() {
        this._assertAlive();
        return {
            graphics: this._queues.graphics.getStats(),
            compute: this._queues.compute.getStats(),
            transfer: this._queues.transfer.getStats(),
            activeFences: this._fences.size,
        };
    }

    /**
     * Flush all queues
     */
    flushAll() {
        this._assertAlive();
        for (const queue of Object.values(this._queues)) {
            queue.flush();
        }
    }

    _cancellationError(reason = 'destroyed') {
        const error = new Error(`[MultiQueue] ${reason}`);
        error.name = 'AbortError';
        error.code = 'VGPU_MULTI_QUEUE_DESTROYED';
        return error;
    }

    _assertAlive() {
        if (this._destroyed) throw this._destroyError || this._cancellationError();
    }

    destroy() {
        if (this._destroyed) return false;
        this._destroyed = true;
        this._generation++;
        const error = this._cancellationError();
        this._destroyError = error;
        const fences = [...this._fences.values()];
        this._fences.clear();
        for (const fence of fences) fence.destroy(error);
        for (const queue of Object.values(this._queues)) queue.destroy(error);
        for (const work of Object.values(this._pendingWork)) work.length = 0;
        this._vgpu = null;
        this._device = null;
        return true;
    }
}

/**
 * Virtual queue - wraps the single WebGPU queue with queue-type semantics
 */
class VirtualQueue {
    constructor(multiQueue, type, gpuQueue) {
        this._multiQueue = multiQueue;
        this.type = type;
        this._gpuQueue = gpuQueue;
        
        this._pendingSubmits = [];
        this._waitFences = [];
        this._submitCount = 0;
        this._totalCommands = 0;
        this._destroyed = false;
        this._destroyError = null;
    }

    get multiQueue() {
        this._assertAlive();
        return this._multiQueue;
    }

    get gpuQueue() {
        this._assertAlive();
        return this._gpuQueue;
    }

    /**
     * Submit command buffers
     */
    submit(commandBuffers) {
        this._assertAlive();
        // In WebGPU, all queues share the same underlying queue
        // But we track separately for future multi-queue support
        this._gpuQueue.submit(commandBuffers);
        this._submitCount++;
        this._totalCommands += commandBuffers.length;
        
        return this._submitCount;
    }

    /**
     * Write to buffer
     */
    writeBuffer(buffer, offset, data, dataOffset, size) {
        this._assertAlive();
        this._gpuQueue.writeBuffer(buffer, offset, data, dataOffset, size);
    }

    /**
     * Write to texture
     */
    writeTexture(destination, data, dataLayout, size) {
        this._assertAlive();
        this._gpuQueue.writeTexture(destination, data, dataLayout, size);
    }

    /**
     * Copy external image to texture
     */
    copyExternalImageToTexture(source, destination, size) {
        this._assertAlive();
        this._gpuQueue.copyExternalImageToTexture(source, destination, size);
    }

    /**
     * Add a fence to wait on before next submit
     */
    addWait(fenceId) {
        this._assertAlive();
        this._waitFences.push(fenceId);
    }

    /**
     * Flush any pending work
     */
    flush() {
        this._assertAlive();
        // WebGPU handles this automatically, but track for debugging
        this._waitFences = [];
    }

    /**
     * Get queue stats
     */
    getStats() {
        this._assertAlive();
        return {
            type: this.type,
            submitCount: this._submitCount,
            totalCommands: this._totalCommands,
            pendingWaits: this._waitFences.length,
        };
    }

    _assertAlive() {
        if (this._destroyed || this._multiQueue?._destroyed) {
            throw this._destroyError || this._multiQueue?._destroyError || new Error('[MultiQueue] Queue destroyed');
        }
    }

    destroy(error = null) {
        if (this._destroyed) return false;
        this._destroyed = true;
        this._destroyError = error || this._multiQueue?._destroyError || new Error('[MultiQueue] Queue destroyed');
        this._pendingSubmits.length = 0;
        this._waitFences.length = 0;
        this._gpuQueue = null;
        this._multiQueue = null;
        return true;
    }
}

/**
 * Fence for cross-queue synchronization
 */
class Fence {
    constructor(multiQueue, id) {
        this._multiQueue = multiQueue;
        this.id = id;
        this._signaled = false;
        this._signaledFrom = null;
        this._waitOperations = new Set();
        this._destroyed = false;
        this._destroyError = null;
        this._generation = multiQueue._generation;
        this._signalPromise = new Promise(resolve => { this._resolveSignal = resolve; });
    }

    get multiQueue() {
        if (this._destroyed || this._multiQueue?._destroyed) {
            throw this._destroyError || this._multiQueue?._destroyError || new Error('[MultiQueue] Fence destroyed');
        }
        return this._multiQueue;
    }

    /**
     * Signal this fence
     */
    signal(fromQueue) {
        if (this._destroyed || this._multiQueue?._destroyed) return false;
        if (this._signaled) return true;
        this._signaled = true;
        this._signaledFrom = fromQueue;
        this._resolveSignal();
        return true;
    }

    /**
     * Wait for this fence
     */
    wait() {
        if (this._destroyed || this._multiQueue?._destroyed) {
            return Promise.reject(this._destroyError || this._multiQueue?._destroyError);
        }
        if (this._signaled) return Promise.resolve();

        let resolvePublic;
        let rejectPublic;
        let cancelWait;
        const operation = {
            generation: this._generation,
            settled: false,
            cancelled: false,
            promise: null,
            cancellation: null,
        };
        operation.promise = new Promise((resolve, reject) => {
            resolvePublic = resolve;
            rejectPublic = reject;
        });
        operation.resolve = resolvePublic;
        operation.reject = rejectPublic;
        operation.cancellation = new Promise(resolve => { cancelWait = resolve; });
        operation.cancelWait = cancelWait;
        this._waitOperations.add(operation);

        const gpuQueue = this._multiQueue._vgpu?.queue || this._multiQueue._device?.queue;
        const rawWork = Promise.resolve()
            .then(() => {
                if (!this._isWaitCurrent(operation)) throw this._destroyError || new Error('[MultiQueue] Fence wait invalidated');
                return gpuQueue.onSubmittedWorkDone();
            })
            .then(
                () => ({ status: 'resolved' }),
                error => ({ status: 'rejected', error }),
            );
        const rawOutcome = Promise.all([rawWork, this._signalPromise]).then(
            ([work]) => work,
            error => ({ status: 'rejected', error }),
        );
        void Promise.race([
            rawOutcome,
            operation.cancellation.then(error => ({ status: 'cancelled', error })),
        ]).then(outcome => {
            if (outcome.status === 'cancelled' || !this._isWaitCurrent(operation)) return;
            if (outcome.status === 'rejected') this._settleWait(operation, outcome.error);
            else this._settleWait(operation, null);
        });
        return operation.promise;
    }

    _isWaitCurrent(operation) {
        return Boolean(operation)
            && !operation.settled
            && !operation.cancelled
            && !this._destroyed
            && !(this._multiQueue?._destroyed)
            && operation.generation === this._generation
            && this._waitOperations.has(operation);
    }

    _settleWait(operation, error) {
        if (!operation || operation.settled) return false;
        operation.settled = true;
        this._waitOperations.delete(operation);
        if (error) operation.reject(error);
        else operation.resolve();
        return true;
    }

    destroy(error = null) {
        if (this._destroyed) return false;
        this._destroyed = true;
        this._generation++;
        this._destroyError = error || this._multiQueue?._destroyError || new Error('[MultiQueue] Fence destroyed');
        this._resolveSignal();
        const waits = [...this._waitOperations];
        this._waitOperations.clear();
        for (const operation of waits) operation.cancelled = true;
        for (const operation of waits) {
            operation.cancelWait(this._destroyError);
            this._settleWait(operation, this._destroyError);
        }
        this._multiQueue = null;
        return true;
    }

    /**
     * Check if signaled
     */
    isSignaled() {
        return this._signaled;
    }

    /**
     * Get the queue that signaled this fence
     */
    getSignaledFrom() {
        return this._signaledFrom;
    }
}

export { VirtualQueue, Fence };
