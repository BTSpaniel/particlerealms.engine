// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { Tokenizer } from '../runtime/Tokenizer.js';

let tokenizer = null;

self.onmessage = event => {
    const { id, type, payload } = event.data ?? {};
    const startedAt = performance.now();
    try {
        if (type === 'init') {
            tokenizer = new Tokenizer(payload?.state ?? {});
            tokenizer.info();
            self.postMessage({ id, ok: true, result: { ready: true }, elapsedMs: performance.now() - startedAt });
            return;
        }
        if (type !== 'prepare' || !tokenizer) throw new Error('Tokenizer worker is not initialized');
        const promptText = String(payload?.promptText ?? '');
        const prefixText = String(payload?.prefixText ?? '');
        const bosToken = String(payload?.bosToken ?? '<bos>');
        const promptTokenIds = tokenizer.encode(promptText, { addBos: !promptText.startsWith(bosToken) });
        const prefixTokenIds = prefixText
            ? tokenizer.encode(prefixText, { addBos: !prefixText.startsWith(bosToken) })
            : [];
        self.postMessage({
            id,
            ok: true,
            result: { promptTokenIds, prefixTokenIds, worker: true, cache: tokenizer.cacheStats() },
            elapsedMs: performance.now() - startedAt,
        });
    } catch (error) {
        self.postMessage({ id, ok: false, error: error?.message ?? String(error), elapsedMs: performance.now() - startedAt });
    }
};
