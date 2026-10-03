// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createTriangularCloth } from './index.js';
let simulation = null, active = null;
let gpuSequence=0;const gpuPending=new Map();
const executeGpuProgram=(inputs,parameters,signal)=>new Promise((resolve,reject)=>{
  const gpuRequest=++gpuSequence,id=active?.id;
  const abort=()=>{gpuPending.delete(gpuRequest);reject(Object.assign(new Error('Cloth GPU work was cancelled'),{code:'CANCELLED'}));};
  if(signal?.aborted){abort();return;}
  gpuPending.set(gpuRequest,{id,resolve,reject,cleanup:()=>signal?.removeEventListener('abort',abort)});signal?.addEventListener('abort',abort,{once:true});
  self.postMessage({id,gpuRequest,inputs,parameters});
});
self.onmessage = async ({ data }) => {
  const { id, operation } = data;
  if(data.gpuResponse){const request=gpuPending.get(data.gpuResponse);if(request?.id!==id)return;gpuPending.delete(data.gpuResponse);request.cleanup();if(data.error)request.reject(Object.assign(new Error(data.error.message),{code:data.error.code}));else request.resolve(data.result);return;}
  if (operation === 'cancel') { if (active?.id === id) active.controller.abort(); return; }
  try {
    if (operation === 'init') {
      if (simulation) throw new Error('The cloth worker is already initialized');
      simulation = createTriangularCloth(data.descriptor,{backend:data.backend,executeGpuProgram}); self.postMessage({ id, result: simulation.snapshot() }); return;
    }
    if (!simulation || !['step', 'settle'].includes(operation)) throw new Error('Invalid cloth worker operation');
    if (active) throw new Error('The cloth worker already has active work');
    const controller = new AbortController(); active = { id, controller }; let lastProgress = 0;
    const result = await simulation[operation]({ ...data.options, signal: controller.signal, onProgress(snapshot) {
      if (performance.now() - lastProgress < 50) return; lastProgress = performance.now(); self.postMessage({ id, progress: snapshot });
    } });
    active = null; self.postMessage({ id, result });
  } catch (error) { if (active?.id === id) active = null; self.postMessage({ id, error: { name: error.name, code: error.code || 'WORKER_ERROR', message: error.message, details: error.details || null } }); }
};
