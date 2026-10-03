// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { cloneStrictJson } from '../../../core/schema/StrictJsonValue.js';
import { buildTriangularClothModel, TRIANGULAR_CLOTH_LIMITS } from './model.js';
import { normalizeClothColliders, projectClothContacts } from './contact.js';
import { clothConstraintDiagnostics, clothConstraintState, projectClothConstraint } from './constraints.js';
import { clothError, clothNumber } from './materials.js';

/** Validate a caller-authored assembled pose without changing physical rest data.
 * This is an initial geometry seed, never a prediction of finished dimensions.
 * Failed candidates are discarded; the original descriptor remains untouched.
 */
export async function prepareClothAssemblySeed(descriptor,{positionsMm,kind,sourceRevision,maximumCorrectionMm=1,budgetMs=2000,signal}={}){
  if(sourceRevision!==descriptor.sourceRevision||typeof kind!=='string'||!kind.trim())throw clothError('INVALID_ASSEMBLY_SEED','The assembly seed requires its source revision and construction provenance');
  clothNumber(maximumCorrectionMm,'assembly seed correction mm',0,10);clothNumber(budgetMs,'assembly seed budget ms',1,TRIANGULAR_CLOTH_LIMITS.wallMs);
  const candidate=cloneStrictJson(descriptor);candidate.positionsMm=cloneStrictJson(positionsMm);
  const start=performance.now(),deadline=start+budgetMs,model=buildTriangularClothModel(candidate,{weldExactSeams:true}),origin=model.positions.map(point=>[...point]);model.colliders=normalizeClothColliders(model.colliders);
  const check=()=>{if(signal?.aborted)throw clothError('CANCELLED','Assembly seed preparation was cancelled');if(performance.now()>=deadline)throw clothError('BUDGET_EXHAUSTED','Assembly seed preparation reached its bounded deadline');};
  let maximumCorrection=0,passes=0,ready=false,operations=0,lastMovement=0,lastContact=null;
  for(;passes<TRIANGULAR_CLOTH_LIMITS.maximumIterations;passes++){
    check();let moved=0;
    // Authored attachment offsets must remain connected in the starting pose.
    // Exact sewn endpoint constraints were already reduced by the shared model.
    for(const constraint of model.constraints.filter(value=>value.kind==='attachment'||value.kind==='seam')){constraint.lambda=0;moved=Math.max(moved,projectClothConstraint(model,constraint,1/240));}
    for(const correction of projectClothContacts(model,model.positions.map(point=>[...point]),{continuous:false})){
      if(correction>moved)lastContact=model.lastContact;moved=Math.max(moved,correction);if(++operations%128===0){check();await new Promise(resolve=>setTimeout(resolve,0));}
    }
    maximumCorrection=Math.max(...model.degreesOfFreedom.map(id=>Math.hypot(...model.positions[id].map((value,axis)=>value-origin[id][axis]))))*1000;
    if(maximumCorrection>maximumCorrectionMm)throw clothError('ASSEMBLY_SEED_INFEASIBLE','The proposed initial assembly cannot clear its intersections within the declared correction bound',{maximumCorrectionMm:maximumCorrection,limitMm:maximumCorrectionMm,passes:passes+1,lastMovementMm:moved*1000,lastContact});
    lastMovement=moved;if(moved<=1e-9){ready=true;passes++;break;}
  }
  if(!ready)throw clothError('ASSEMBLY_SEED_INFEASIBLE','The proposed initial assembly did not clear its contact and attachment constraints',{passes,maximumCorrectionMm:maximumCorrection,lastMovementMm:lastMovement*1000,lastContact});
  check();let diagnostics;
  try{diagnostics=clothConstraintDiagnostics(model);}catch(error){
    const violating=[];
    for(const constraint of model.constraints)if(constraint.triangle){
      try{clothConstraintState(model,constraint);}catch(failure){
        const triangle=constraint.triangle;violating.push({kind:constraint.kind,triangle:triangle.index,ids:triangle.ids,pieceId:triangle.pieceId,materialId:triangle.material.id,positionsMm:triangle.ids.map(id=>model.positions[id].map(value=>value*1000)),restPositionsMm:triangle.ids.map(id=>model.rest[id].map(value=>value*1000)),code:failure.code,details:failure.details});
        if(violating.length>=4)break;
      }
    }
    error.details={...error.details,maximumCorrectionMm:maximumCorrection,passes,lastContact,lastMovementMm:lastMovement*1000,violatingTriangles:violating};throw error;
  }
  if(diagnostics.issues.length||diagnostics.seamGapMm>.5||diagnostics.attachmentGapMm>.5)throw clothError('ASSEMBLY_SEED_INFEASIBLE','The initial assembly is outside its supplied material or connection limits',{diagnostics});
  candidate.positionsMm=model.positions.map(point=>point.map(value=>value*1000));
  candidate.assemblySeed={schema:'engine.cloth-assembly-seed.v1',kind,sourceRevision,status:'collision-free-start',maximumCorrectionMm:maximumCorrection,passes,elapsedMs:performance.now()-start,diagnostics,finishedDimensionsVerified:false,restGeometryPreserved:true};
  console.debug('[TriangularCloth] assembly seed accepted',{sourceRevision,kind,passes,maximumCorrectionMm:maximumCorrection,elapsedMs:candidate.assemblySeed.elapsedMs});
  return candidate;
}
