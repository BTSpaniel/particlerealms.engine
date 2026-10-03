// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { planAdaptivePreload } from '../inference/CacheGovernor.js';

self.onmessage = event => {
    const startedAt = performance.now();
    const { id, type, payload } = event.data ?? {};
    try {
        if (type !== 'plan-preload') throw new Error(`Unsupported LLM load planner task: ${type}`);
        const result = planPreload(payload ?? {});
        self.postMessage({ id, ok: true, result: { ...result, elapsedMs: performance.now() - startedAt } });
    } catch (error) {
        self.postMessage({ id, ok: false, error: error?.message ?? String(error) });
    }
};

function planPreload({ tensors = [], maxBytes = 0, adaptive = true } = {}) {
    return planAdaptivePreload(tensors, { maxBytes, adaptive });
}
