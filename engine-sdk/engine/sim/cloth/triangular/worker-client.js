// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { cloneStrictJson } from '../../../core/schema/StrictJsonValue.js';
import { clothError } from './materials.js';
import { executeScopedClothProgram } from './scoped-compute.js';

/** One retained document per worker, owned and cancelled by the caller scope. */
export async function createTriangularClothWorker(descriptor, { signal, backend = 'javascript-reference', compute } = {}) {
  if(!['javascript-reference','webgpu-hybrid'].includes(backend))throw clothError('INVALID_BACKEND','Choose the reference or shared GPU cloth backend');
  if(backend==='webgpu-hybrid'&&!compute)throw clothError('GPU_BACKEND_UNAVAILABLE','The shared scoped compute service is required');
  if (signal?.aborted) throw clothError('CANCELLED', 'Cloth worker creation was cancelled');
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module', name: 'Triangular cloth reference' });
  let sequence = 0, active = null, disposed = false, current = null;
  const terminate = () => {
    if (disposed) return; disposed = true; worker.terminate(); signal?.removeEventListener('abort', terminate);
    if (active) { const request = active; active = null; request.gpuController.abort(); request.cleanup(); request.reject(clothError('DISPOSED', 'The cloth worker was disposed')); }
  };
  signal?.addEventListener('abort', terminate, { once: true });
  worker.onmessage = ({ data }) => {
    if (disposed || active?.id !== data.id) return;
    if(data.gpuRequest){
      const request=active;
      executeScopedClothProgram(compute,data.inputs,data.parameters,{signal:request.gpuController.signal}).then(result=>{
        if(!disposed&&active===request)worker.postMessage({id:data.id,gpuResponse:data.gpuRequest,result});
      },error=>{if(!disposed&&active===request)worker.postMessage({id:data.id,gpuResponse:data.gpuRequest,error:{code:error.code||'GPU_SOLVER_ERROR',message:error.message}});});
      return;
    }
    if (data.progress) {
      current = data.progress;
      try { active.onProgress?.(cloneStrictJson(current)); } catch (error) { console.error('[TriangularClothWorker] progress observer failed', error); }
      return;
    }
    const request = active; active = null; request.cleanup();
    if (data.error) request.reject(clothError(data.error.code, data.error.message, data.error.details));
    else { current = data.result; request.resolve(cloneStrictJson(current)); }
  };
  worker.onerror = event => {
    const request = active; request?.gpuController.abort(); active = null; request?.cleanup();
    request?.reject(clothError('WORKER_ERROR', event.message || 'The cloth worker failed')); terminate();
  };
  function request(operation, options = {}) {
    if (disposed) return Promise.reject(clothError('DISPOSED', 'The cloth worker was disposed'));
    if (active) return Promise.reject(clothError('BUSY', 'The cloth worker already has active work'));
    if (options.signal?.aborted) return Promise.resolve({ ...cloneStrictJson(current), status: 'cancelled', issues: [{ code: 'CANCELLED', message: 'Cloth work was cancelled before it started' }] });
    return new Promise((resolve, reject) => {
      const id = ++sequence, gpuController = new AbortController(), abort = () => {gpuController.abort();worker.postMessage({ id, operation: 'cancel' });};
      const { signal: jobSignal, onProgress, ...parameters } = options;
      active = { id, resolve, reject, onProgress, gpuController, cleanup: () => jobSignal?.removeEventListener('abort', abort) };
      jobSignal?.addEventListener('abort', abort, { once: true });
      try { worker.postMessage({ id, operation, ...(operation === 'init' ? { descriptor: cloneStrictJson(descriptor), backend } : { options: cloneStrictJson(parameters) }) }); }
      catch (error) { active.cleanup(); active = null; reject(error); }
    });
  }
  try { await request('init'); } catch (error) { terminate(); throw error; }
  return Object.freeze({ step: options => request('step', options), settle: options => request('settle', options), snapshot: () => cloneStrictJson(current), dispose: terminate });
}
