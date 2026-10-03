// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { cloneStrictJson } from '../../../core/schema/StrictJsonValue.js';
import { vec3Length as length } from '../../../core/math/MathVec3.js';
import { buildTriangularClothModel, setClothPosition, TRIANGULAR_CLOTH_LIMITS } from './model.js';
import { normalizeClothColliders, projectClothContacts, projectCachedClothContacts } from './contact.js';
import { clothConstraintDiagnostics, projectClothConstraint } from './constraints.js';
import { clothError, clothNumber } from './materials.js';
import { prepareTriangularClothGpuProgram } from './gpu-program.js';
import { projectClothContactBlock } from './contact-block.js';

export { TRIANGULAR_CLOTH_LIMITS } from './model.js';
export { normalizeClothMaterial } from './materials.js';
export { createTriangularClothWorker } from './worker-client.js';
const copy = positions => positions.map(value => [...value]);
const integer = (value, name, min, max) => { clothNumber(value, name, min, max); if (!Number.isInteger(value)) throw clothError('INVALID_INPUT', `${name} must be an integer`); return value; };
const later = () => new Promise(resolve => setTimeout(resolve, 0));

/** Retained SI reference solver. Results are numerical evidence, not sewn validation. */
export function createTriangularCloth(descriptor, {backend='javascript-reference',executeGpuProgram}={}) {
  if(!['javascript-reference','webgpu-hybrid'].includes(backend)||backend==='webgpu-hybrid'&&typeof executeGpuProgram!=='function')throw clothError('INVALID_BACKEND','The GPU hybrid requires an owned scoped projection service');
  const model = buildTriangularClothModel(descriptor, { weldExactSeams: true });
  model.colliders = normalizeClothColliders(model.colliders);
  let disposed = false, running = false, completedSteps = 0, status = 'ready', issues = [], elapsedMs = 0;
  let stableSteps = 0, stagnatedSteps = 0, previousMetric = Infinity;
  let previousKineticEnergy = 0, kineticEnergyRising = false, kineticDampingEvents = 0, relaxation = 'dynamic';
  let settlingIterations=model.configuration.iterations, solverIterations=model.configuration.iterations;
  let appliedDampingPerSecond=model.configuration.dampingPerSecond;
  let initialContactsPrepared=false, initialContactCorrectionMm=0;
  let contactCoupled=false;
  const execution={gpuPrograms:0,gpuElasticIterations:0,cpuElasticIterations:0,gpuAdvectionSubsteps:0,cpuAdvectionSubsteps:0};
  let diagnostics = { maximumSpeedMmPerSecond: 0, finalCorrectionMm: 0, maximumProjectionCorrectionMm: 0, contactCorrectionMm: 0, stableSteps: 0, ...clothConstraintDiagnostics(model) };
  const evidence = [...model.materials.values()].map(material => ({ id: material.id, role: material.role, estimated: material.estimated, model: material.model, provenance: material.source,
    compression: material.compression ? 'supplied curve retained; thickness-only contact in this solver' : 'not supplied' }));
  const snapshot = () => ({ schema: 'engine.triangular-cloth.v1', sourceRevision: model.sourceRevision, status,
    assemblySeed:model.descriptor.assemblySeed?cloneStrictJson(model.descriptor.assemblySeed):null,
    seamContactCollar:{...model.seamContactCollar},
    backend:execution.gpuPrograms?'webgpu-hybrid':'javascript-reference',requestedBackend:backend, execution:{...execution}, positionsMm: model.positions.map(p => p.map(x => x * 1000)), triangles: model.triangles.map(t => [...t.ids]),
    completedSteps, simulatedSeconds: completedSteps * model.configuration.outerStepSeconds, elapsedMs, relaxation, dampingPerSecond:appliedDampingPerSecond,kineticDampingEvents, solverIterations, initialContactCorrectionMm,
    diagnostics: cloneStrictJson(diagnostics), contactSolver:cloneStrictJson(model.contactStats||{}), issues: cloneStrictJson(issues), materials: cloneStrictJson(evidence),
    verification: { numerical: status === 'converged' ? 'settled' : 'not-settled', materials: evidence.some(value => value.estimated) ? 'estimated' : 'supplied', print: 'not-checked', sewnSample: 'not-checked' } });

  async function run(options = {}, settling = false) {
    if (disposed) throw clothError('DISPOSED', 'This cloth preview has been disposed');
    if (running) throw clothError('BUSY', 'A cloth step is already running');
    const limit = integer(settling ? options.maxSteps ?? TRIANGULAR_CLOTH_LIMITS.outerSteps : options.steps ?? 1, 'outer steps', 1, TRIANGULAR_CLOTH_LIMITS.outerSteps);
    const budgetMs = clothNumber(options.budgetMs ?? TRIANGULAR_CLOTH_LIMITS.wallMs, 'wall budget ms', 0, TRIANGULAR_CLOTH_LIMITS.wallMs);
    const signal = options.signal, start = performance.now(), deadline = start + budgetMs;
    const requestedRelaxation = settling ? options.relaxation ?? 'kinetic' : 'dynamic';
    appliedDampingPerSecond=settling?clothNumber(options.dampingPerSecond??model.configuration.dampingPerSecond,'static damping per second',0,100):model.configuration.dampingPerSecond;
    if (!['dynamic', 'kinetic', 'viscous'].includes(requestedRelaxation)) throw clothError('INVALID_INPUT', 'Choose kinetic or viscous static relaxation');
    if (relaxation !== requestedRelaxation) { previousKineticEnergy = 0; kineticEnergyRising = false; relaxation = requestedRelaxation; }
    let sliceStart = start, operations = 0, committed = snapshot();
    const check = () => {
      if (disposed || signal?.aborted) throw clothError('CANCELLED', 'Cloth work was cancelled');
      if (performance.now() >= deadline) throw clothError('BUDGET_EXHAUSTED', 'Cloth work reached its wall-clock budget', { operations, contact: model.lastContactTest || null });
    };
    const checkpoint = () => { if (++operations % 128 === 0) { check(); if (performance.now() - sliceStart >= 8) return later().then(() => { sliceStart = performance.now(); check(); }); } return null; };
    const gpuProjection=async(h,damping,batchIterations,advect)=>{
    const packed=prepareTriangularClothGpuProgram(model,h,{cacheTopology:true});
    const input=Object.fromEntries(['positions','velocities','constraints','curves','colors'].map(key=>[key,packed[key]]));
    const result=await executeGpuProgram(input,{h,damping,gravity:model.configuration.gravity,advect,iterations:batchIterations,budgetMs:Math.max(1,deadline-performance.now())},signal);check();
    if(!(result?.positions instanceof Float32Array)||result.positions.length!==packed.positions.length||!(result.iterationStart instanceof Float32Array)||result.iterationStart.length!==packed.positions.length||!(result.constraints instanceof Uint8Array)||result.constraints.length!==packed.constraints.length||!(result.reports instanceof Float32Array)||result.reports.length!==packed.constraintOrder.length*4)throw clothError('INVALID_GPU_RESULT','The scoped cloth result lost its physical vertex mapping');
    if([...result.positions,...result.iterationStart,...result.reports].some(value=>!Number.isFinite(value)))throw clothError('NONFINITE_STATE','The GPU cloth candidate is nonfinite');
    const iterationStart=model.positions.map((point,id)=>model.inverseMasses[id]?Array.from(result.iterationStart.subarray(packed.vertexMapping[id]*4,packed.vertexMapping[id]*4+3)):[...point]);
    for(const id of model.degreesOfFreedom)if(model.inverseMasses[id])setClothPosition(model,id,Array.from(result.positions.subarray(packed.vertexMapping[id]*4,packed.vertexMapping[id]*4+3)));
    const coefficients=new Float32Array(result.constraints.buffer,result.constraints.byteOffset,result.constraints.byteLength/4);
    let maximum=0;packed.constraintOrder.forEach((constraint,index)=>{if(result.reports[index*4+3]!==0)throw clothError('GPU_NUMERICAL_DOMAIN','A GPU material constraint cannot be evaluated');constraint.lambda=coefficients[index*20+14];maximum=Math.max(maximum,result.reports[index*4+2]);});
      execution.gpuPrograms++;execution.gpuElasticIterations+=batchIterations;execution.gpuAdvectionSubsteps+=advect?1:0;return {iterationStart,maximum};
    };
    running = true; status = 'running'; issues = [];
    console.debug('[TriangularCloth] run', { sourceRevision: model.sourceRevision, settling, limit, budgetMs, vertices: model.clothVertexCount, physicalVertices:model.degreesOfFreedom.length });
    try {
      check();
      for (let step = 0; step < limit; step++) {
        solverIterations=settling?settlingIterations:model.configuration.iterations;
        const before = copy(model.positions), velocitiesBefore = copy(model.velocities), diagnosticsBefore = diagnostics;
        const relaxationBefore={energy:previousKineticEnergy,rising:kineticEnergyRising,events:kineticDampingEvents,prepared:initialContactsPrepared,initialCorrection:initialContactCorrectionMm};
        try {
          if(!initialContactsPrepared){
            // Exact seam reduction can introduce tiny thickness-placement
            // overlaps. Establish a valid static origin before sweeping time;
            // CCD must never be asked to certify an already intersecting start.
            // This is bounded numerical preparation, not free-form untangling.
            const preparationLimit=Math.min(1e-6,Math.min(...model.thicknesses)*.01);
            for(let pass=0;pass<TRIANGULAR_CLOTH_LIMITS.maximumIterations;pass++){
              let moved=0;
              for(const correction of projectClothContacts(model,copy(model.positions),{continuous:false})){
                moved=Math.max(moved,correction);const pause=checkpoint();if(pause)await pause;
              }
              const displacement=Math.max(...model.degreesOfFreedom.map(id=>Math.hypot(...model.positions[id].map((value,axis)=>value-before[id][axis]))));
              if(displacement>preparationLimit)throw clothError('INITIAL_CONTACT_INFEASIBLE','Initial shell intersections exceed bounded thickness preparation',{correctionMm:displacement*1000,limitMm:preparationLimit*1000});
              initialContactCorrectionMm=displacement*1000;
              if(moved<=1e-9){initialContactsPrepared=true;console.debug('[TriangularCloth] initial contacts prepared',{sourceRevision:model.sourceRevision,passes:pass+1,correctionMm:initialContactCorrectionMm,limitMm:preparationLimit*1000});break;}
              if(pass===TRIANGULAR_CLOTH_LIMITS.maximumIterations-1)throw clothError('CONTACT_BUDGET_EXHAUSTED','Initial shell placement did not stabilize within the bounded preparation',{maximumPasses:TRIANGULAR_CLOTH_LIMITS.maximumIterations,correctionMm:displacement*1000});
            }
          }
          let finalCorrection = 0, maximumProjectionCorrection = 0, contactCorrection = 0, maximumSpeed = 0;
          const h = model.configuration.outerStepSeconds / model.configuration.substeps, damping = Math.exp(-appliedDampingPerSecond * h);
          for (let substep = 0; substep < model.configuration.substeps; substep++) {
            check(); const previous = copy(model.positions);
            // Coupled contacts require CPU interleaving. For those substeps,
            // retaining the whole local solve avoids GPU round trips that cost
            // more than its small projection workload. Counters expose the split.
            contactCoupled ||= Boolean(model.hadContactCandidates);
            const gpuElastic=backend==='webgpu-hybrid'&&!contactCoupled;
            if(!gpuElastic)execution.cpuAdvectionSubsteps++;
            for (const id of gpuElastic?[]:model.degreesOfFreedom) {
              if (model.inverseMasses[id]) for (let axis = 0; axis < 3; axis++) model.positions[id][axis] += h * model.velocities[id][axis] * damping + h * h * model.configuration.gravity[axis];
              const pause = checkpoint(); if (pause) await pause;
            }
            model.constraints.forEach(constraint => { constraint.lambda = 0; });
            // Iterative projections are candidate endpoints, not physical time
            // states. Keep the accepted substep origin while re-sweeping every
            // changed endpoint, including elastic/contact corrections. Starting
            // from a rejected crossed endpoint would block its corrective return.
            const sweptFrom = previous;
            for (let iteration = 0; iteration < solverIterations; iteration++) {
              let iterationStart = copy(model.positions);
              let maximum = 0;
              if(gpuElastic){
                const batchIterations=solverIterations-iteration,result=await gpuProjection(h,damping,batchIterations,iteration===0);
                iterationStart=result.iterationStart;maximum=result.maximum;
                iteration+=batchIterations-1;
              }else {execution.cpuElasticIterations++;for (const color of model.colors) for (const constraint of color) { maximum = Math.max(maximum, projectClothConstraint(model, constraint, h)); const pause = checkpoint(); if (pause) await pause; }}
              for (const correction of projectCachedClothContacts(model, sweptFrom)) { maximum = Math.max(maximum, correction); const pause=checkpoint(); if(pause)await pause; }
              // Elastic iterations are proposed endpoints, not time advances.
              // Certify the full proposed substep sweep, including every elastic
              // correction, and stabilize contacts before accepting physical time.
              const contactPasses = [];
              // Compare the final two complete coupled iterates. Comparing a
              // checked state against an unchecked elastic candidate mistakes
              // steady contact reactions for an unresolved physical residual.
              const contactLimit = iteration >= solverIterations - (settling ? Math.min(2,solverIterations) : 1) ? TRIANGULAR_CLOTH_LIMITS.maximumIterations : 0;
              if(contactLimit)model.contactLinearConstraints=new Map();
              for (let pass = 0; pass < contactLimit; pass++) {
                let moved = 0;
                let largestContact = null;
                for (const correction of projectClothContacts(model, sweptFrom)) { if (correction > moved) largestContact = model.lastContact; moved = Math.max(moved, correction); const pause = checkpoint(); if (pause) await pause; }
                contactPasses.push({ maximumCorrectionMm: moved * 1000, feature: largestContact });
                contactCorrection = Math.max(contactCorrection, moved); maximum = Math.max(maximum, moved);
                if (moved <= 1e-9) break;
                if(pass>=0&&pass<contactLimit-1){
                  const block=await projectClothContactBlock(model,{maximumCorrection:moved,checkpoint:async()=>{check();const pause=checkpoint();if(pause)await pause;}});
                  const contactStats=model.contactStats;
                  if(contactStats){
                    contactStats.blockAttempts=(contactStats.blockAttempts||0)+1;
                    if(block.applied)contactStats.blockApplied=(contactStats.blockApplied||0)+1;
                    else{
                      contactStats.blockRejected=(contactStats.blockRejected||0)+1;
                      contactStats.blockReasons??={};contactStats.blockReasons[block.reason]=(contactStats.blockReasons[block.reason]||0)+1;
                    }
                  }
                  contactPasses.at(-1).block=block.applied?{activeContacts:block.activeContacts,maximumCorrectionMm:block.maximumCorrection*1000}:{reason:block.reason};
                  if(block.applied){maximum=Math.max(maximum,block.maximumCorrection);contactCorrection=Math.max(contactCorrection,block.maximumCorrection);continue;}
                }
                // A corrected feature can reveal a different active contact.
                // Its larger residual is not evidence that the previous feature
                // stagnated. Keep the unchanged 48-pass ceiling and strict gate.
                if (pass === contactLimit - 1) throw clothError('CONTACT_BUDGET_EXHAUSTED', 'Contact corrections exhausted the bounded contact solve', { substep, iteration, maximumPasses: contactLimit, passes: contactPasses });
              }
              maximumProjectionCorrection = maximum;
              // Supporting contact reactions remain nonzero at equilibrium.
              // Convergence measures the residual of the complete iteration,
              // while keeping its largest constituent projection inspectable.
              finalCorrection = Math.max(...model.degreesOfFreedom.map(id => Math.hypot(...model.positions[id].map((value, axis) => value - iterationStart[id][axis]))));
            }
            for (const id of model.degreesOfFreedom) {
              const velocity = model.positions[id].map((value, axis) => (value - previous[id][axis]) / h);
              for (const member of model.vertexGroups.get(id)) model.velocities[member] = velocity;
              if (model.positions[id].some(value => !Number.isFinite(value)) || model.velocities[id].some(value => !Number.isFinite(value))) throw clothError('NONFINITE_STATE', 'Cloth positions or velocities became nonfinite');
              const pause = checkpoint(); if (pause) await pause;
            }
            // Static form finding observes energy peaks at physical substeps,
            // before a longer outer step can amplify a local contact oscillation.
            // Record the pre-reset speed; damping cannot manufacture stability.
            const speed=Math.max(...model.velocities.map(length))*1000;
            maximumSpeed=Math.max(maximumSpeed,speed);
            const kineticEnergy=model.masses.reduce((sum,mass,id)=>sum+.5*mass*length(model.velocities[id])**2,0);
            if(relaxation==='kinetic'&&kineticEnergyRising&&kineticEnergy<previousKineticEnergy*(1-1e-6)&&speed>=1){
              for(const id of model.degreesOfFreedom){const velocity=[0,0,0];for(const member of model.vertexGroups.get(id))model.velocities[member]=velocity;}
              previousKineticEnergy=0;kineticEnergyRising=false;kineticDampingEvents++;
            }else{kineticEnergyRising=kineticEnergy>previousKineticEnergy;previousKineticEnergy=kineticEnergy;}
          }
          check();
          const geometry = clothConstraintDiagnostics(model), speed = maximumSpeed;
          const acceptable = !geometry.issues.length && geometry.seamGapMm <= .5 && geometry.attachmentGapMm <= .5 && finalCorrection * 1000 < .05;
          stableSteps = acceptable && speed < 1 ? stableSteps + 1 : 0;
          const metric = Math.max(speed, finalCorrection * 1000, geometry.seamGapMm), change = Math.abs(metric - previousMetric);
          stagnatedSteps = !acceptable && change <= Math.max(1e-7, Math.abs(previousMetric) * 1e-6) ? stagnatedSteps + 1 : 0; previousMetric = metric;
          diagnostics = { ...geometry, maximumSpeedMmPerSecond: speed, finalCorrectionMm: finalCorrection * 1000, maximumProjectionCorrectionMm: maximumProjectionCorrection * 1000, contactCorrectionMm: contactCorrection * 1000, stableSteps };
          // Keep the authored initial iteration count. A static solve whose
          // residual is not falling sufficiently earns more iterations, bounded
          // by the same engineering ceiling and existing wall-clock deadline.
          if(settling&&diagnostics.finalCorrectionMm>=.05&&diagnostics.finalCorrectionMm>=diagnosticsBefore.finalCorrectionMm*.8){
            settlingIterations=Math.min(TRIANGULAR_CLOTH_LIMITS.maximumIterations,solverIterations+4);
            if(settlingIterations!==solverIterations)console.debug('[TriangularCloth] static iterations adapted',{sourceRevision:model.sourceRevision,previous:solverIterations,next:settlingIterations,residualMm:diagnostics.finalCorrectionMm});
          }else if(settling&&diagnostics.finalCorrectionMm<.04&&solverIterations>model.configuration.iterations){
            // Extra elastic iterations are a temporary response to a stalled
            // residual. Once the full coupled iterate is comfortably inside
            // the acceptance bound, return toward the authored count instead
            // of paying the maximum cost for every later stability step.
            settlingIterations=Math.max(model.configuration.iterations,solverIterations-4);
            console.debug('[TriangularCloth] static iterations relaxed',{sourceRevision:model.sourceRevision,previous:solverIterations,next:settlingIterations,residualMm:diagnostics.finalCorrectionMm});
          }
          issues = geometry.issues; completedSteps++; status = stableSteps >= 60 ? 'converged' : stagnatedSteps >= 120 ? 'stagnated' : 'stepped';
          committed = snapshot();
        } catch (error) { for (const id of model.degreesOfFreedom) setClothPosition(model, id, before[id]); model.velocities = velocitiesBefore; diagnostics = diagnosticsBefore; previousKineticEnergy=relaxationBefore.energy;kineticEnergyRising=relaxationBefore.rising;kineticDampingEvents=relaxationBefore.events;initialContactsPrepared=relaxationBefore.prepared;initialContactCorrectionMm=relaxationBefore.initialCorrection;throw error; }
        if (typeof options.onProgress === 'function') options.onProgress(snapshot());
        if (settling && (status === 'converged' || status === 'stagnated')) break;
        if (step + 1 < limit) { await later(); check(); sliceStart = performance.now(); }
        if (settling && step === limit - 1) status = 'budget-exhausted';
      }
    } catch (error) {
      status = error.code === 'CANCELLED' ? 'cancelled' : ['BUDGET_EXHAUSTED', 'CONTACT_BUDGET_EXHAUSTED'].includes(error.code) ? 'budget-exhausted' : 'infeasible';
      issues = [...(committed.issues || []), { code: error.code || 'SOLVER_ERROR', message: error.message, details: error.details || null }];
      console.debug('[TriangularCloth] stop', { sourceRevision: model.sourceRevision, status, code: error.code });
    } finally { running = false; elapsedMs = performance.now() - start; console.debug('[TriangularCloth] complete', { sourceRevision: model.sourceRevision, status, completedSteps, elapsedMs }); }
    return snapshot();
  }
  return Object.freeze({ step: options => run(options, false), settle: options => run(options, true), snapshot,
    dispose() { disposed = true; if (!running) status = 'disposed'; } });
}
