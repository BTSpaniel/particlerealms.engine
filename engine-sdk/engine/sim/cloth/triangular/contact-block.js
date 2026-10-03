// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { solveSparsePositive } from '../../../core/math/SparsePositiveSolver.js';
import { vec3Dot } from '../../../core/math/MathVec3.js';
import { setClothPosition } from './model.js';

/** A bounded mass-weighted simultaneous contact candidate. Acceptance remains
 * the caller's complete continuous geometry check, never this linearization.
 */
export async function projectClothContactBlock(model, { maximumCorrection, checkpoint }) {
  const rows=[...(model.contactLinearConstraints?.values()||[])];
  if(!rows.length||rows.length>2048)return { applied:false,reason:'contact-count' };
  const rhs=rows.map(row=>row.offset-row.ids.reduce((sum,id,i)=>sum+vec3Dot(row.gradients[i],model.positions[id]),0));
  let active=[];
  if(!rhs.some(value=>value>1e-12))return {applied:false,reason:'already-linear-feasible'};
  const vertexCount=model.clothVertexCount, proposal=new Float64Array(vertexCount*3),lambda=new Float64Array(rows.length);
  let solves=0;
  for(let pass=0;pass<48;pass++){
    await checkpoint();proposal.fill(0);
    rows.forEach((row,index)=>row.ids.forEach((id,j)=>{for(let axis=0;axis<3;axis++)proposal[id*3+axis]+=model.inverseMasses[id]*row.gradients[j][axis]*lambda[index];}));
    let worst=-1,residual=0;
    rows.forEach((row,index)=>{const violation=rhs[index]-row.ids.reduce((sum,id,i)=>sum+row.gradients[i].reduce((dot,value,axis)=>dot+value*proposal[id*3+axis],0),0);if(violation>residual){residual=violation;worst=index;}});
    if(residual<=2.5e-10){
      let maximum=0;for(const id of model.degreesOfFreedom)maximum=Math.max(maximum,Math.hypot(...proposal.subarray(id*3,id*3+3)));
      if(!Number.isFinite(maximum)||maximum>Math.max(1e-6,maximumCorrection*4))return {applied:false,reason:'candidate-bound'};
      for(const id of model.degreesOfFreedom)if(model.inverseMasses[id])setClothPosition(model,id,model.positions[id].map((value,axis)=>value+proposal[id*3+axis]));
      return {applied:true,maximumCorrection:maximum,activeContacts:active.length,passes:pass+1};
    }
    if(active.includes(worst))return {applied:false,reason:'linear-residual'};
    active.push(worst);
    while(active.length&&solves++<48){
    const diagonal=Float64Array.from(active,index=>rows[index].ids.reduce((sum,id,i)=>sum+model.inverseMasses[id]*vec3Dot(rows[index].gradients[i],rows[index].gradients[i]),0));
    if(diagonal.some(value=>!(value>0)))return {applied:false,reason:'fixed-contact'};
    const scratch=new Float64Array(vertexCount*3), multiply=values=>{
      scratch.fill(0);
      active.forEach((index,i)=>rows[index].ids.forEach((id,j)=>{for(let axis=0;axis<3;axis++)scratch[id*3+axis]+=rows[index].gradients[j][axis]*values[i];}));
      return Float64Array.from(active,(index,i)=>rows[index].ids.reduce((sum,id,j)=>sum+model.inverseMasses[id]*rows[index].gradients[j].reduce((dot,value,axis)=>dot+value*scratch[id*3+axis],0),0)+diagonal[i]*1e-10*values[i]);
    };
    const solved=await solveSparsePositive({multiply,diagonal:Float64Array.from(diagonal,value=>value*(1+1e-10)),rhs:Float64Array.from(active,index=>rhs[index]),maxIterations:48,tolerance:1e-12,checkpoint});
    if(solved.x.some(value=>!Number.isFinite(value)))return {applied:false,reason:'nonfinite-linear-candidate'};
    if(solved.x.every(value=>value>0)){active.forEach((index,i)=>{lambda[index]=solved.x[i];});break;}
    let fraction=1;active.forEach((index,i)=>{if(solved.x[i]<=0)fraction=Math.min(fraction,lambda[index]/(lambda[index]-solved.x[i]||1));});
    active.forEach((index,i)=>{lambda[index]+=fraction*(solved.x[i]-lambda[index]);});
    active=active.filter(index=>lambda[index]>0);
    }
    if(solves>=48)return {applied:false,reason:'active-set-budget'};
  }
  return {applied:false,reason:'active-set-budget'};
}
