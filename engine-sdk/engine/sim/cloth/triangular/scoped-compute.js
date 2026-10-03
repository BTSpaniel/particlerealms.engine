// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { clothError } from './materials.js';

/** Uses the caller's existing operator/app-scoped compute authority. */
export async function executeScopedClothProgram(compute,inputs,parameters,{signal}={}) {
  if(!compute?.copyFrom||!compute?.submit||!compute?.wait||!compute?.readCopy)throw clothError('GPU_BACKEND_UNAVAILABLE','The shared scoped compute service is unavailable');
  const buffers=[],outputBuffers=[];let job;
  const cancelled=()=>{if(signal?.aborted)throw clothError('CANCELLED','Cloth GPU work was cancelled');};
  const abort=()=>{if(job)Promise.resolve(compute.cancel(job)).catch(()=>{});};
  signal?.addEventListener('abort',abort,{once:true});
  try{
    cancelled();const handles={};
    for(const name of ['positions','velocities','constraints','curves','colors']){cancelled();handles[name]=await compute.copyFrom(inputs[name]);buffers.push(handles[name]);}
    cancelled();job=await compute.submit('math.geometry.cloth-iteration@1',{inputs:handles,parameters,policy:{backend:'webgpu',precision:'f32',outputLocation:'cpu',timeoutMs:Math.max(1,Math.min(30000,Math.floor(parameters.budgetMs??30000))),priority:'background'}});
    if(signal?.aborted)abort();cancelled();const result=await compute.wait(job);cancelled();
    if(result?.error)throw clothError(result.error.code||'GPU_SOLVER_ERROR',result.error.message||'The cloth GPU operation failed');
    if(result?.backend!=='webgpu'||!result.outputs)throw clothError('GPU_BACKEND_UNAVAILABLE','The cloth candidate did not execute on the requested shared GPU backend');
    outputBuffers.push(...Object.values(result.outputs));const outputs={};
    for(const [name,handle] of Object.entries(result.outputs)){cancelled();outputs[name]=await compute.readCopy(handle);}
    cancelled();return outputs;
  }catch(error){
    if(error.code==='COMPUTE_TIMEOUT')throw clothError('BUDGET_EXHAUSTED','Cloth work reached its shared compute deadline');
    if(error.code==='COMPUTE_CANCELLED')throw clothError('CANCELLED','Cloth GPU work was cancelled');
    throw error;
  }finally{
    signal?.removeEventListener('abort',abort);
    for(const handle of [...outputBuffers,...buffers])await Promise.resolve(compute.releaseBuffer(handle)).catch(()=>{});
    if(job)await Promise.resolve(compute.releaseJob(job)).catch(()=>{});
  }
}
