// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { prepareTriangularClothGpuBatch, validateTriangularClothGpuBatch, TRIANGULAR_CLOTH_CONSTRAINT_WGSL } from './gpu-constraints.js';
import { projectClothConstraint, clothConstraintState } from './constraints.js';
import { clothError, clothNumber } from './materials.js';
import { initializePrimitiveLifecycle, destroyPrimitiveLifecycle, assertCommandEncoder, createEncodeReceipt, acquireWorkspace } from '../../../core/gpu/GpuPrimitiveSupport.js';

const ADVECTION = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> positions: array<vec4f>;
@group(0) @binding(1) var<storage, read> velocities: array<vec4f>;
struct Motion { gravity: vec4f, controls: vec4f }
@group(0) @binding(2) var<uniform> motion: Motion;
@compute @workgroup_size(64)
fn advect(@builtin(global_invocation_id) invocation: vec3u) {
  let id=invocation.x;if(id>=arrayLength(&positions)){return;}
  let p=positions[id];if(p.w==0.0){return;}
  let h=motion.controls.x;let damping=motion.controls.y;
  positions[id]=vec4f(p.xyz+h*damping*velocities[id].xyz+h*h*motion.gravity.xyz,p.w);
}`;
const retainedLayouts=new WeakMap();

/** Same packed colors and constraint code as the independently tested primitive. */
export function prepareTriangularClothGpuProgram(model, h, {cacheTopology=false}={}) {
  const retained=cacheTopology?retainedLayouts.get(model):null;
  if(retained){
    const positions=new Float32Array(retained.positionWords),velocities=new Float32Array(retained.positionWords),constraints=new Uint8Array(retained.constraints),coefficients=new Float32Array(constraints.buffer);
    model.degreesOfFreedom.forEach((id,index)=>{positions.set([...model.positions[id],model.inverseMasses[id]],index*4);velocities.set(model.velocities[id],index*4);});
    for(const id of model.degreesOfFreedom)for(const value of model.positions[id])if(Math.abs(Math.fround(value)-value)>2e-6)throw clothError('GPU_PRECISION_UNSUPPORTED','Position conditioning requires the JavaScript reference');
    retained.constraintOrder.forEach((constraint,index)=>{coefficients[index*20+14]=constraint.lambda;coefficients[index*20+15]=h;});
    return {positions,velocities,constraints,curves:retained.curves.slice(),colors:retained.colors.slice(),vertexMapping:retained.vertexMapping,constraintOrder:retained.constraintOrder};
  }
  const batches=model.colors.filter(color=>color.length).map(color=>prepareTriangularClothGpuBatch(model,color,h));
  if(!batches.length)throw clothError('INVALID_GPU_BATCH','Cloth requires at least one material constraint');
  const constraintCount=batches.reduce((sum,batch)=>sum+batch.constraintCount,0),curveCount=batches.reduce((sum,batch)=>sum+batch.curves.length,0);
  const constraints=new Uint8Array(constraintCount*80),curves=new Float32Array(curveCount),colors=new Uint32Array(batches.length);
  let constraintOffset=0,curveOffset=0;
  batches.forEach((batch,index)=>{
    constraints.set(batch.constraints,constraintOffset*80);curves.set(batch.curves,curveOffset);colors[index]=batch.constraintCount;
    const words=new Uint32Array(constraints.buffer,constraintOffset*80,batch.constraintCount*20);
    for(let i=0;i<batch.constraintCount;i++)if(words[i*20+16]<=2)words[i*20+18]+=curveOffset/2;
    constraintOffset+=batch.constraintCount;curveOffset+=batch.curves.length;
  });
  const positions=batches[0].positions,velocities=new Float32Array(positions.length);
  for(const id of model.degreesOfFreedom)for(const value of model.positions[id])if(Math.abs(Math.fround(value)-value)>2e-6)throw clothError('GPU_PRECISION_UNSUPPORTED','Position conditioning requires the JavaScript reference');
  model.degreesOfFreedom.forEach((id,index)=>velocities.set(model.velocities[id],index*4));
  const result={positions,velocities,constraints,curves,colors,vertexMapping:batches[0].vertexMapping,constraintOrder:model.colors.flat()};
  if(cacheTopology)retainedLayouts.set(model,{positionWords:positions.length,constraints:constraints.slice(),curves:curves.slice(),colors:colors.slice(),vertexMapping:[...result.vertexMapping],constraintOrder:[...result.constraintOrder]});
  return result;
}

/** Validate the complete graph before allocation, including every color race. */
export function validateTriangularClothGpuProgram(input, parameters={}) {
  const {positions,velocities,constraints,curves,colors}=input;
  if(!(colors instanceof Uint32Array)||!colors.length||colors.length>4096||!(constraints instanceof Uint8Array)||constraints.byteOffset%4||constraints.byteLength%80||constraints.byteLength>300000*80||!(velocities instanceof Float32Array)||velocities.length!==positions?.length)throw clothError('INVALID_GPU_BATCH','Invalid bounded cloth program');
  const iterations=parameters.iterations??1;
  if(!Number.isInteger(iterations)||iterations<0||iterations>48||iterations===0&&parameters.advect!==true)throw clothError('INVALID_GPU_BATCH','Cloth programs require1–48 iterations, or an explicit advection-only pass');
  if(iterations*colors.length>16384)throw clothError('INVALID_GPU_BATCH','Cloth program exceeds the bounded dispatch count');
  const h=clothNumber(parameters.h,'substep seconds',1e-6,1),damping=clothNumber(parameters.damping??1,'damping',0,1),gravity=parameters.gravity??[0,0,0];
  if(!Array.isArray(gravity)||gravity.length!==3||gravity.some(value=>!Number.isFinite(value)||Math.abs(value)>1000)||[...velocities].some(value=>!Number.isFinite(value)||Math.abs(value)>1e6))throw clothError('INVALID_GPU_BATCH','Invalid bounded cloth motion');
  let offset=0;
  for(const count of colors){
    validateTriangularClothGpuBatch({positions,curves,constraints:constraints.subarray(offset*80,(offset+count)*80),constraintCount:count});offset+=count;
  }
  if(offset*80!==constraints.length)throw clothError('INVALID_GPU_BATCH','Cloth colors do not cover the packed constraints exactly');
  const coefficients=new Float32Array(constraints.buffer,constraints.byteOffset,constraints.byteLength/4);
  for(let i=15;i<coefficients.length;i+=20)if(Math.abs(coefficients[i]-h)>Math.max(1e-12,h*1e-6))throw clothError('INVALID_GPU_BATCH','Constraint and motion timesteps disagree');
  return {iterations,h,damping,gravity,advect:parameters.advect===true};
}

/** CPU operation adapter reconstructs records, then invokes the owned XPBD code. */
export function executeTriangularClothProgramJs(input, parameters={}) {
  const p=validateTriangularClothGpuProgram(input,parameters),{positions:packed,velocities,curves,colors}=input;
  const positions=Array.from({length:packed.length/4},(_,id)=>Array.from(packed.subarray(id*4,id*4+3))),inverseMasses=positions.map((_,id)=>packed[id*4+3]);
  const words=new Uint32Array(input.constraints.buffer,input.constraints.byteOffset,input.constraints.byteLength/4),floats=new Float32Array(input.constraints.buffer,input.constraints.byteOffset,input.constraints.byteLength/4);
  const kinds=['warp','weft','shear','bend','seam','attachment'],constraints=[];
  for(let index=0;index<input.constraints.length/80;index++){
    const base=index*20,kind=kinds[words[base+16]],ids=Array.from(words.subarray(base,base+words[base+17]));
    const c={kind,ids,lambda:floats[base+14],compliance:floats[base+13]};
    if(words[base+16]<=2){
      const points=Array.from({length:words[base+19]},(_,i)=>Array.from(curves.subarray((words[base+18]+i)*2,(words[base+18]+i+1)*2)));
      const curve={points};c.triangle={ids,warp:Array.from(floats.subarray(base+4,base+7)),weft:Array.from(floats.subarray(base+8,base+11)),area:floats[base+12],material:{warp:curve,weft:curve,shear:curve}};
    }else if(kind==='seam')c.weights=Array.from(floats.subarray(base+4,base+8));
    else if(kind==='attachment')Object.assign(c,{axis:words[base+18],normalOffset:floats[base+12],barycentric:Array.from(floats.subarray(base+4,base+7))});
    constraints.push(c);
  }
  const model={positions,inverseMasses,vertexDof:positions.map((_,id)=>id)},reports=new Float32Array(constraints.length*4);
  if(p.advect)positions.forEach((point,id)=>{if(inverseMasses[id])point.forEach((value,axis)=>{point[axis]=value+p.h*p.damping*velocities[id*4+axis]+p.h*p.h*p.gravity[axis];});});
  let iterationStart=positions.map(point=>[...point]);
  for(let iteration=0;iteration<p.iterations;iteration++){
    if(iteration===p.iterations-1)iterationStart=positions.map(point=>[...point]);
    let offset=0;
    for(const count of colors){for(let i=offset;i<offset+count;i++){reports[i*4]=clothConstraintState(model,constraints[i]).value;const maximum=projectClothConstraint(model,constraints[i],p.h);reports[i*4+1]=constraints[i].lambda;reports[i*4+2]=maximum;}offset+=count;}
  }
  const result=new Float32Array(packed),start=new Float32Array(packed),updated=new Uint8Array(input.constraints),coefficients=new Float32Array(updated.buffer);
  positions.forEach((point,id)=>{result.set(point,id*4);start.set(iterationStart[id],id*4);});constraints.forEach((c,i)=>{coefficients[i*20+14]=c.lambda;});
  return {value:{vertexCount:positions.length,constraintCount:constraints.length,iterations:p.iterations},outputs:{positions:result,iterationStart:start,constraints:updated,reports}};
}

/** Buffers and multipliers stay on the GPU throughout all colors/iterations. */
export class GpuTriangularClothProgram {
  constructor(device,options={}){
    initializePrimitiveLifecycle(this,device,options,'GpuTriangularClothProgram');this._slots=[];
    this.pipeline=device.createComputePipeline({label:this.label,layout:'auto',compute:{module:device.createShaderModule({code:TRIANGULAR_CLOTH_CONSTRAINT_WGSL}),entryPoint:'project'}});
    this.advection=device.createComputePipeline({label:`${this.label} advection`,layout:'auto',compute:{module:device.createShaderModule({code:ADVECTION}),entryPoint:'advect'}});
  }
  encode(encoder,input,parameters={}, {generation=this.generation}={}){
    this._assertAlive(generation);assertCommandEncoder(encoder);const p=validateTriangularClothGpuProgram(input,parameters);
    const slot=acquireWorkspace(this,this._slots,()=>({destroy(){}}),this.label),buffers=[];
    const upload=(data,name,usage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC)=>{
      const buffer=this.device.createBuffer({label:`${this.label} ${name}`,size:Math.max(4,data.byteLength),usage,mappedAtCreation:true});buffers.push(buffer);new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data.buffer,data.byteOffset,data.byteLength));buffer.unmap();return buffer;
    };
    try{
      const positions=upload(input.positions,'positions'),constraints=upload(input.constraints,'constraints'),curves=upload(input.curves,'curves'),reports=upload(new Float32Array(input.constraints.length/20),'reports');
      const iterationStart=upload(new Float32Array(input.positions.length),'final iteration origin',GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC);
      if(p.advect){
        const velocities=upload(input.velocities,'velocities'),motion=upload(new Float32Array([...p.gravity,0,p.h,p.damping,0,0]),'motion',GPUBufferUsage.UNIFORM);
        const bind=this.device.createBindGroup({layout:this.advection.getBindGroupLayout(0),entries:[positions,velocities,motion].map((buffer,binding)=>({binding,resource:{buffer}}))});
        const pass=encoder.beginComputePass();pass.setPipeline(this.advection);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(Math.ceil(input.positions.length/4/64));pass.end();
      }
      if(p.iterations===0)encoder.copyBufferToBuffer(positions,0,iterationStart,0,input.positions.byteLength);
      let offset=0;
      const groups=Array.from(input.colors,count=>{
        const range=upload(new Uint32Array([offset,count,0,0]),'color range',GPUBufferUsage.UNIFORM);offset+=count;
        return {count,bind:this.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[positions,constraints,curves,reports,range].map((buffer,binding)=>({binding,resource:{buffer}}))})};
      });
      for(let iteration=0;iteration<p.iterations;iteration++){
        if(iteration===p.iterations-1)encoder.copyBufferToBuffer(positions,0,iterationStart,0,input.positions.byteLength);
        for(const group of groups){const pass=encoder.beginComputePass();pass.setPipeline(this.pipeline);pass.setBindGroup(0,group.bind);pass.dispatchWorkgroups(Math.ceil(group.count/64));pass.end();}
      }
      return createEncodeReceipt(this,slot,buffers,{kind:'triangular-cloth-elastic-program',positions,iterationStart,constraints,reports,iterations:p.iterations,constraintCount:input.constraints.length/80});
    }catch(error){buffers.forEach(buffer=>buffer.destroy());slot.busy=false;throw error;}
  }
  destroy(){return destroyPrimitiveLifecycle(this,this._slots);}
}
