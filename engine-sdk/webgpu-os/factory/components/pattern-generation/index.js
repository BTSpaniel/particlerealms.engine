// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export { getPatternDesignSchema, validatePatternGeneration } from './schema.js';

/** Each request owns a native module worker so synchronous drafting is cancellable. */
export function createPatternGenerator({ workerUrl, validateRequest, version, signal, onLog } = {}) {
  if (!(typeof workerUrl === 'string' || workerUrl instanceof URL) || !String(workerUrl)) throw new TypeError('Provide the owned pattern worker URL.');
  if (typeof validateRequest !== 'function') throw new TypeError('Provide the pattern domain request validator.');
  if (typeof version !== 'string' || !version) throw new TypeError('Provide the pattern generator version.');
  let active = null;
  let destroyed = false;
  let sequence = 0;
  const log = event => {
    const receipt = { operation: 'pattern-generation', version, ...event };
    console.debug('[Factory:pattern-generation]', receipt);
    try { onLog?.(receipt); } catch { /* observer isolation */ }
  };
  const cancel = () => {
    active?.finish(new DOMException('Pattern generation cancelled.', 'AbortError'));
  };
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    signal?.removeEventListener('abort', destroy);
    cancel();
  };
  if (signal?.aborted) destroy();
  else signal?.addEventListener('abort', destroy, { once: true });

  async function generate(request = {}) {
    if (destroyed) throw new DOMException('Pattern generator closed.', 'AbortError');
    request.signal?.throwIfAborted();
    const input = validateRequest(request);
    cancel();
    const id = ++sequence;
    const started = performance.now();
    const worker = new Worker(workerUrl, { type: 'module', name: 'factory-pattern-generator' });
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer;
      const onAbort = () => finish(new DOMException('Pattern generation cancelled.', 'AbortError'));
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        request.signal?.removeEventListener('abort', onAbort);
        worker.terminate();
        if (active?.id === id) active = null;
        log({ stage: error ? (error.name === 'AbortError' ? 'cancelled' : 'failed') : 'complete',
          design: input.design, durationMs: Math.round(performance.now() - started), partCount: result?.pieces?.length || result?.meshes?.length || 0 });
        error ? reject(error) : resolve(result);
      };
      active = { id, finish };
      worker.onmessage = event => {
        const message = event.data;
        if (message?.id !== id) return;
        if (message.error) {
          const error = new Error(message.error.message);
          error.name = message.error.name || 'Error';
          if (typeof message.error.code === 'string') error.code = message.error.code;
          finish(error);
        } else finish(null, message.result);
      };
      worker.onerror = event => {
        event.preventDefault();
        finish(new Error('The local pattern generator could not load or run. Reopen the workspace and retry.'));
      };
      worker.onmessageerror = () => finish(new Error('The pattern generator returned an unreadable result.'));
      request.signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => finish(new Error('Pattern generation exceeded 60 seconds. Check the measurements and retry.')), 60000);
      log({ stage: 'start', design: input.design });
      if (destroyed || request.signal?.aborted) { onAbort(); return; }
      if (settled) return;
      try { worker.postMessage({ id, input }); } catch (error) { finish(error); }
    });
  }
  return { generate, cancel, destroy };
}
