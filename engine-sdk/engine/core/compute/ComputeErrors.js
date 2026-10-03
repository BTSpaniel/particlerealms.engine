// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Stable failures shared by host, worker and isolated-package compute clients. */
export class ComputeError extends Error {
    constructor(code, message, details = null) {
        super(message);
        this.name = 'ComputeError';
        this.code = code;
        if (details !== null) this.details = details;
    }
}

export function computeFailure(error, code = 'COMPUTE_FAILED') {
    if (error instanceof ComputeError) return error;
    return new ComputeError(error?.code || code, String(error?.message ?? error ?? code));
}

export function assertCompute(condition, code, message) {
    if (!condition) throw new ComputeError(code, message);
}

export function throwIfComputeAborted(signal) {
    if (signal?.aborted) throw computeFailure(signal.reason, 'COMPUTE_CANCELLED');
}

/** Stop waiting promptly even when browser compilation or GPU completion cannot be preempted. */
export function awaitComputeAbort(promise, signal) {
    throwIfComputeAborted(signal);
    if (!signal) return promise;
    return new Promise((resolve, reject) => {
        const abort = () => { signal.removeEventListener('abort', abort); reject(computeFailure(signal.reason, 'COMPUTE_CANCELLED')); };
        signal.addEventListener('abort', abort, { once: true });
        Promise.resolve(promise).then(value => { signal.removeEventListener('abort', abort); resolve(value); },
            error => { signal.removeEventListener('abort', abort); reject(error); });
    });
}
