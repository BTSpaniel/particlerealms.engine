// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { inspectFiniteAmbientWater, createFiniteAmbientWaterLane } from './FiniteAmbientWaterLane.js';
import { AMBIENT_WATER_RESIDENCY_LIMIT_BYTES, ambientWaterResidentBytes,
    reserveAmbientWaterConstructionAfterRetirements, updateAmbientWaterResidency,
    retainAmbientWaterRetirement } from './AmbientRuntimeV3Residency.js';

/** Borrow the caller's device, frame buffer, encoder and submission. A request
 * owns its reservation from admission through constructor cleanup and the
 * caller device's completion fence, including cancellation during compilation. */
export function createAmbientFiniteWaterHost(options) {
    const inspected=inspectFiniteAmbientWater(options.sourceWGSL);
    if(!inspected) return null;
    const {device}=options, controller=new AbortController(), owner={};
    let lane=null,disposed=false,reserved=false,retirement=null,finishConstruction;
    const construction=new Promise(resolve=>{finishConstruction=resolve;});
    const abort=()=>controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort',abort,{once:true});
    if(options.signal?.aborted) abort();
    const retire=()=>{
        if(retirement||!reserved) return;
        // Constructor initialization may issue bounded uploads after logical
        // cancellation. Its physical fence must follow those final uploads.
        const completion=construction.then(()=>device.queue.onSubmittedWorkDone?.()??Promise.resolve());
        const settled=construction.then(()=>lane?.whenSettled?.());
        retirement=Promise.all([completion,settled]);
        void retirement.catch(()=>{});
        retainAmbientWaterRetirement(device,owner,Math.ceil(lane?.resourceBytes??inspected.resourceBytes),completion,settled);
    };
    const ready=(async()=>{
        try {
            await reserveAmbientWaterConstructionAfterRetirements(device,owner,inspected.resourceBytes,
                {fullEnvelope:true,signal:controller.signal});
            reserved=true;
            controller.signal.throwIfAborted();
            const budgetBytes=AMBIENT_WATER_RESIDENCY_LIMIT_BYTES-ambientWaterResidentBytes(device,owner);
            lane=await createFiniteAmbientWaterLane({...options,budgetBytes,signal:controller.signal});
            controller.signal.throwIfAborted();
            if(disposed) throw new Error('Finite water host was disposed during construction.');
            updateAmbientWaterResidency(device,owner,Math.ceil(lane.resourceBytes));
            console.debug('[AmbientFiniteWaterHost][ready]', {bytes:lane.resourceBytes,version:inspected.version});
            return lane;
        } catch(error) {
            disposed=true;lane?.dispose();retire();
            throw error;
        } finally {finishConstruction();options.signal?.removeEventListener('abort',abort);}
    })();
    return Object.freeze({
        ready,
        get lane(){return lane;},
        get shaderSource(){return lane?.shaderSource;},
        get pipelineLayout(){return lane?.pipelineLayout;},
        get resourceBytes(){return lane?.resourceBytes??inspected.resourceBytes;},
        encode(encoder,frame){return lane.encode(encoder,frame);},
        oneShotBudget(){const budget=lane?.oneShotBudget?.();return {operations:budget?.writeOperations??0,bytes:budget?.writeBytes??0};},
        diagnostics(){return lane?.diagnostics?.()??{constructing:true,resourceBytes:inspected.resourceBytes};},
        dispose(){
            if(disposed) return false;
            disposed=true;controller.abort();lane?.dispose();retire();
            console.debug('[AmbientFiniteWaterHost][dispose]', {constructing:!lane});
            return true;
        },
    });
}
