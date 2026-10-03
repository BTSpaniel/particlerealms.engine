// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export class FacePool {
    constructor(opts = {}) {
        this.device = null;
        this.initialized = false;

        this.facesCapacity = opts.facesCapacity ?? 1024 * 1024;
        this.buffer = null;

        this.freeBlocks = [{ offset: 0, size: this.facesCapacity }];

        this.allocatedFaces = 0;
        this.peakAllocatedFaces = 0;
    }

    async init(device) {
        this.device = device;
        this._ensureBufferCapacity(this.facesCapacity);
        this.initialized = true;
    }

    _ensureBufferCapacity(requiredFaces) {
        const requiredBytes = requiredFaces * 4;

        if (this.buffer && this.buffer.size >= requiredBytes) {
            return;
        }

        let newCapacityFaces = this.facesCapacity;
        while (newCapacityFaces * 4 < requiredBytes) {
            newCapacityFaces *= 2;
        }

        const newBuffer = this.device.createBuffer({
            label: 'FacePool Buffer',
            size: newCapacityFaces * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });

        if (this.buffer) {
            const encoder = this.device.createCommandEncoder();
            encoder.copyBufferToBuffer(this.buffer, 0, newBuffer, 0, this.buffer.size);
            this.device.queue.submit([encoder.finish()]);
            try { this.buffer.destroy(); } catch (_) { /* ignore */ }
        }

        const oldCapacity = this.facesCapacity;
        this.facesCapacity = newCapacityFaces;
        this.buffer = newBuffer;

        if (newCapacityFaces > oldCapacity) {
            this._addFreeBlock(oldCapacity, newCapacityFaces - oldCapacity);
        }
    }

    _addFreeBlock(offset, size) {
        if (size <= 0) return;

        this.freeBlocks.push({ offset, size });
        this._mergeFreeBlocks();
    }

    _mergeFreeBlocks() {
        this.freeBlocks.sort((a, b) => a.offset - b.offset);

        const merged = [];
        for (const b of this.freeBlocks) {
            if (merged.length === 0) {
                merged.push({ offset: b.offset, size: b.size });
                continue;
            }

            const last = merged[merged.length - 1];
            if (last.offset + last.size === b.offset) {
                last.size += b.size;
            } else {
                merged.push({ offset: b.offset, size: b.size });
            }
        }

        this.freeBlocks = merged;
    }

    allocate(faceCount) {
        if (!this.initialized) return null;
        if (faceCount <= 0) return null;

        this._ensureBufferCapacity(this.allocatedFaces + faceCount);

        let bestIndex = -1;
        let bestSize = Infinity;
        for (let i = 0; i < this.freeBlocks.length; i++) {
            const b = this.freeBlocks[i];
            if (b.size >= faceCount && b.size < bestSize) {
                bestIndex = i;
                bestSize = b.size;
            }
        }

        if (bestIndex < 0) {
            this._ensureBufferCapacity(this.facesCapacity + faceCount);
            return this.allocate(faceCount);
        }

        const block = this.freeBlocks[bestIndex];
        const alloc = {
            offsetFaces: block.offset,
            capacityFaces: faceCount,
        };

        block.offset += faceCount;
        block.size -= faceCount;
        if (block.size <= 0) {
            this.freeBlocks.splice(bestIndex, 1);
        }

        this.allocatedFaces += faceCount;
        this.peakAllocatedFaces = Math.max(this.peakAllocatedFaces, this.allocatedFaces);

        return alloc;
    }

    free(alloc) {
        if (!alloc) return;

        const size = alloc.capacityFaces ?? 0;
        if (size <= 0) return;

        this._addFreeBlock(alloc.offsetFaces ?? 0, size);
        this.allocatedFaces = Math.max(0, this.allocatedFaces - size);
    }

    copyFrom(commandEncoder, srcBuffer, srcOffsetBytes, alloc, faceCount) {
        if (!this.initialized || !commandEncoder || !srcBuffer || !alloc || faceCount <= 0) return;

        const bytes = faceCount * 4;
        const dstOffsetBytes = alloc.offsetFaces * 4;
        commandEncoder.copyBufferToBuffer(srcBuffer, srcOffsetBytes, this.buffer, dstOffsetBytes, bytes);
    }

    destroy() {
        try { this.buffer?.destroy(); } catch (_) { /* ignore */ }
        this.buffer = null;
        this.initialized = false;
        this.freeBlocks = [];
    }
}
