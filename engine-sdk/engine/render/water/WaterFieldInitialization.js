// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

const initializationDevices = new WeakMap();

/** Initialize a buffer through the same device owner's finite transfer permit.
 * The callback is synchronous and submits no command buffers. Frame writes
 * continue to use the caller's normal producer authority. */
export function writeWaterInitializationBuffer(device, buffer, data, bufferOffset = 0, dataOffset = 0, size = undefined) {
    if (!ArrayBuffer.isView(data) && !(data instanceof ArrayBuffer)) throw new TypeError('Water initialization requires buffer data.');
    const unit = ArrayBuffer.isView(data) ? (data.BYTES_PER_ELEMENT ?? 1) : 1;
    const byteOffset = dataOffset * unit;
    const byteLength = size === undefined ? data.byteLength - byteOffset : size * unit;
    if (!Number.isInteger(byteOffset) || !Number.isInteger(byteLength) || byteOffset < 0 || byteLength < 0 || byteOffset + byteLength > data.byteLength) {
        throw new RangeError('Water initialization data range is invalid.');
    }
    if (byteLength === 0) return;
    const write = () => device.queue.writeBuffer(buffer, bufferOffset, data, dataOffset, size);
    if (device.__isGpuFacade === true) {
        if (typeof device.runOneShot !== 'function') throw new Error('Water initialization requires finite transfer authority.');
        return device.runOneShot({ kind: 'transfer', maxOperations: 1, maxSubmissions: 0, maxBytes: byteLength, durationMs: 1000 }, write);
    }
    return write();
}

/** Allocation-only borrowed device: existing buffer/FFT helpers retain native
 * receivers while their initial uploads enter a bounded transfer permit. */
export function createWaterInitializationDevice(device) {
    if (device.__isGpuFacade !== true) return device;
    let borrowed = initializationDevices.get(device);
    if (borrowed) return borrowed;
    const methods = new Map();
    const originalQueue = device.queue;
    // The guarded device and queue expose immutable own methods. Forwarding
    // from fresh targets preserves their invariants while borrowing receivers.
    const queue = new Proxy(Object.create(null), { get(_target, key) {
        if (key === 'writeBuffer') return (buffer, offset, data, dataOffset = 0, size = undefined) =>
            writeWaterInitializationBuffer(device, buffer, data, offset, dataOffset, size);
        const value = Reflect.get(originalQueue, key, originalQueue);
        return typeof value === 'function' ? value.bind(originalQueue) : value;
    } });
    borrowed = new Proxy(Object.create(null), { get(_target, key) {
        if (key === 'queue') return queue;
        const value = Reflect.get(device, key, device);
        if (typeof value !== 'function') return value;
        if (!methods.has(key)) methods.set(key, value.bind(device));
        return methods.get(key);
    } });
    initializationDevices.set(device, borrowed);
    return borrowed;
}
