// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { WATER_FOAM_KERNELS_WGSL } from '../../../engine/render/water/WaterFoamKernels.js';
import { waterFieldBindingsWGSL, WATER_FIELD_SAMPLE_WGSL } from '../../../engine/render/water/WaterFieldShaders.js';
import { writeWaterInitializationBuffer } from '../../../engine/render/water/WaterFieldInitialization.js';
import { extractAmbientWgslFunctions } from '../schema/AmbientNativeAppearance.js';
import { SPATIAL_WATER_RESPONSE_SOURCE } from '../../factory/apps/ambient-studio/spatial/SpatialWaterFoamSource.js';
import { spatialWaterContact, spatialWaterSourcePoint } from '../../factory/apps/ambient-studio/spatial/SpatialWaterSurface.js';
import { createSpatialMipGenerator, spatialMipLevelCount } from './SpatialAmbientMipmaps.js';
import { withErrorScope } from '../../../engine/core/gpu/GpuDebug.js';

const MAX_IMPACTS = 128, DOMAIN_BYTES = 64 * 16, FRAME_BYTES = 32;

/** Includes both histories, full linear mip chains and every owned buffer. */
export function spatialWaterFoamResourceBytes(domainData) {
    const layers = Math.max(1, domainData.domains.length), size = domainData.resolution;
    let texels = 0; for (let width = size; width >= 1; width >>= 1) texels += width * width;
    return layers * (texels * 16 + size * size * 4 + 96) + DOMAIN_BYTES + FRAME_BYTES + MAX_IMPACTS * 32;
}

function renamedSource(source, prefix) {
    const names = extractAmbientWgslFunctions(source).map(value => value.name);
    let result = source;
    for (const name of names) result = result.replace(new RegExp(`\\b${name}\\b`, 'g'), `${prefix}${name}`);
    return result;
}
function ownerFunctions(domains) {
    const source = [], cases = { production: [], transport: [], decay: [], impact: [], response: [] };
    for (const { water, layer } of domains) {
        const prefix = `finite${layer}_`;
        source.push(renamedSource(water.foam.foamSourceWGSL, prefix));
        source.push(renamedSource(water.response?.waterResponseSourceWGSL ?? SPATIAL_WATER_RESPONSE_SOURCE, prefix));
        const calls = { production: 'spatialFoamProduction(compression,breaking,height,time,settings)', transport: 'spatialFoamTransport(current,time,drift)', decay: 'spatialFoamDecay(coverage,dt,time,lifetime)', impact: 'spatialFoamImpact(distance,radius,amount,time)', response: 'spatialWaterContactAmount(kind,strength,time,controls)' };
        for (const [kind, call] of Object.entries(calls)) cases[kind].push(`if(layer==${layer}u){return ${prefix}${call};}`);
    }
    return source.join('\n') + `
fn finiteProduction(layer:u32,compression:f32,breaking:f32,height:f32,time:f32,settings:vec4f)->f32{${cases.production.join('')}return 0.;}
fn finiteTransport(layer:u32,current:vec2f,time:f32,drift:vec2f)->vec2f{${cases.transport.join('')}return vec2f(0);}
fn finiteDecay(layer:u32,coverage:f32,dt:f32,time:f32,lifetime:f32)->f32{${cases.decay.join('')}return 0.;}
fn finiteImpact(layer:u32,distance:f32,radius:f32,amount:f32,time:f32)->f32{${cases.impact.join('')}return 0.;}
fn finiteResponse(layer:u32,kind:f32,strength:f32,time:f32,controls:vec4f)->f32{${cases.response.join('')}return 0.;}
`;
}
function shader(domains) { return waterFieldBindingsWGSL(1) + WATER_FIELD_SAMPLE_WGSL + WATER_FOAM_KERNELS_WGSL + ownerFunctions(domains) + /* wgsl */`
struct FiniteFoamFrame { timing:vec4f, counts:vec4u }
struct FiniteFoamOwner { domain:vec4f,pivot:vec4f,wave:vec4f,settings:vec4f,drift:vec4f,response:vec4f }
@group(0) @binding(0) var<uniform> finiteFrame:FiniteFoamFrame;
@group(0) @binding(1) var<storage,read> finiteOwners:array<FiniteFoamOwner>;
@group(0) @binding(2) var<storage,read> finiteMask:array<u32>;
@group(0) @binding(3) var<storage,read> finiteImpacts:array<vec4f>;
@group(0) @binding(4) var finiteHistory:texture_2d_array<f32>;
@group(0) @binding(5) var finiteDestination:texture_storage_2d_array<rgba16float,write>;
fn finiteFetch(cell:vec2i,layer:u32)->vec4f {
 let size=i32(finiteFrame.counts.x);if(any(cell<vec2i(0))||any(cell>=vec2i(size))){return vec4f(0);}
 return textureLoad(finiteHistory,cell,i32(layer),0);
}
fn finiteHistoryAt(uv:vec2f,layer:u32)->vec4f {
 let point=uv*f32(finiteFrame.counts.x)-.5;let cell=vec2i(floor(point));let fraction=fract(point);
 return mix(mix(finiteFetch(cell,layer),finiteFetch(cell+vec2i(1,0),layer),fraction.x),mix(finiteFetch(cell+vec2i(0,1),layer),finiteFetch(cell+vec2i(1,1),layer),fraction.x),fraction.y);
}
@compute @workgroup_size(8,8) fn finiteFoamStep(@builtin(global_invocation_id) gid:vec3u) {
 let size=finiteFrame.counts.x;let layer=gid.z;if(any(gid.xy>=vec2u(size))||layer>=finiteFrame.counts.y){return;}
 let owner=finiteOwners[layer];let supported=finiteMask[(layer*size+gid.y)*size+gid.x]>0u;
 if(!supported||owner.settings.w<=0.){textureStore(finiteDestination,vec2i(gid.xy),i32(layer),vec4f(0));return;}
 let uv=(vec2f(gid.xy)+.5)/f32(size);let point=owner.domain.xy+uv*owner.domain.zw;
 let time=finiteFrame.timing.x;let dt=finiteFrame.timing.y;
 let sample=waterFieldLocalSample(point,time,owner.pivot.w,1./max(.0001,owner.wave.y),owner.wave.z,owner.wave.w,owner.wave.x);
 let mappedX=(sample.tangentX-vec3f(1,0,0))*vec3f(owner.drift.w,1,owner.drift.w)+vec3f(1,0,0);
 let mappedZ=(sample.tangentZ-vec3f(0,0,1))*vec3f(owner.drift.w,1,owner.drift.w)+vec3f(0,0,1);
 let jacobian=mappedX.x*mappedZ.z-mappedZ.x*mappedX.z;
 let current=select(sample.current,vec2f(0,owner.wave.z),owner.response.w>.5);
 let transport=clamp(finiteTransport(layer,current,time,owner.drift.xy),vec2f(-8),vec2f(8));
 let history=select(finiteHistoryAt(waterFoamBacktrace(uv,transport,dt,owner.domain.zw),layer),vec4f(0),finiteFrame.counts.w>0u);
 let production=clamp(finiteProduction(layer,max(0.,1.-jacobian),sample.breakingPotential,sample.displacement.y,time,owner.settings),0.,8.);
 let decayed=clamp(finiteDecay(layer,history.x,dt,time,owner.settings.z),0.,1.);var impact=0.;
 for(var i=0u;i<128u;i+=1u){if(i>=finiteFrame.counts.z){break;}let contact=finiteImpacts[i*2u];let contactInfo=finiteImpacts[i*2u+1u];
  if(u32(contactInfo.x)==layer){let amount=select(contact.w,finiteResponse(layer,contactInfo.y,contact.w,time,owner.response),contactInfo.y>0.5);
   impact+=finiteImpact(layer,length(point-contact.xy),max(contact.z,max(owner.domain.z,owner.domain.w)/f32(size)),amount*owner.drift.z,time);}
 }
 let population=clamp(waterFoamPopulation(decayed,production,clamp(impact,0.,2.),dt),0.,1.);
 let age=waterFoamAge(history.y,production,impact,dt);
 textureStore(finiteDestination,vec2i(gid.xy),i32(layer),vec4f(population,age,production,1));
}
`; }

/** Retained density and age inside the host's device, encoder and phase clock. */
export async function createSpatialWaterFoam({ device, geometry, domainData, fieldLayout, signal, initialClickSerial = 0 }) {
    const { domains, masks, resolution } = domainData;
    if (!domains.length) return null;
    const bytes = spatialWaterFoamResourceBytes(domainData), resources = [];
    const own = resource => { resources.push(resource); return resource; };
    if(!Number.isSafeInteger(initialClickSerial)||initialClickSerial<0)throw new TypeError('Spatial water needs a nonnegative canonical click baseline.');
    let disposed = false, initialized = false, index = 0, lastTime = null, lastSerial = initialClickSerial, pending = null, committedImpacts = 0, submittedFrames = 0;
    try {
        signal?.throwIfAborted();
        const makeBuffer = (label, size, usage) => own(device.createBuffer({ label: `ambient-spatial-foam-${label}`, size, usage: usage | GPUBufferUsage.COPY_DST }));
        const frame = makeBuffer('frame', FRAME_BYTES, GPUBufferUsage.UNIFORM), owners = makeBuffer('owners', domains.length * 96, GPUBufferUsage.STORAGE), mask = makeBuffer('mask', masks.byteLength, GPUBufferUsage.STORAGE);
        const impacts = makeBuffer('recorded-impacts', MAX_IMPACTS * 32, GPUBufferUsage.STORAGE), renderDomains = makeBuffer('render-domains', DOMAIN_BYTES, GPUBufferUsage.UNIFORM);
        const ownerData = new Float32Array(domains.length * 24), displayDomains = new Float32Array(64 * 4);
        for (const { water, layer, minimum, extent, wave } of domains) {
            const settings = water.foam, response = water.response, at = layer * 24;
            ownerData.set([...minimum, ...extent, ...wave.slice(0,4), ...wave.slice(4), settings.foamProduction, settings.foamThreshold, settings.foamLifetime, settings.foamStrength,
                settings.foamDriftX, settings.foamDriftZ, settings.foamImpactGain, water.choppiness ?? .25,
                response?.waterClickGain ?? 0, response?.waterPointerGain ?? 0, response?.waterClickRadius ?? .08, water.kind === 'waterfall' ? 1 : 0], at);
            displayDomains.set([...minimum, ...extent], layer * 4);
        }
        writeWaterInitializationBuffer(device, owners, ownerData); writeWaterInitializationBuffer(device, mask, masks); writeWaterInitializationBuffer(device, renderDomains, displayDomains);
        const levels = spatialMipLevelCount(resolution,resolution);
        const histories = [0,1].map(value => own(device.createTexture({ label: `ambient-spatial-foam-history-${value}`, size: [resolution,resolution,domains.length], format: 'rgba16float', mipLevelCount: levels,
            textureBindingViewDimension: '2d-array', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })));
        const views = histories.map(texture => texture.createView({ dimension: '2d-array' }));
        const sampler = device.createSampler({ minFilter:'linear',magFilter:'linear',mipmapFilter:'linear',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge' });
        const layout = device.createBindGroupLayout({ entries: [
            { binding:0,visibility:4,buffer:{type:'uniform'} }, ...[1,2,3].map(binding=>({binding,visibility:4,buffer:{type:'read-only-storage'}})),
            {binding:4,visibility:4,texture:{sampleType:'unfilterable-float',viewDimension:'2d-array'}},
            {binding:5,visibility:4,storageTexture:{access:'write-only',format:'rgba16float',viewDimension:'2d-array'}},
        ] });
        const module = device.createShaderModule({ label:'ambient-spatial-retained-foam',code:shader(domains) });
        const info = await module.getCompilationInfo?.();const error=info?.messages?.find(value=>value.type==='error');if(error)throw new Error(`Spatial foam:${error.lineNum}:${error.linePos}:${error.message}`);
        const descriptor={label:'ambient-spatial-retained-foam',layout:device.createPipelineLayout({bindGroupLayouts:[layout,fieldLayout]}),compute:{module,entryPoint:'finiteFoamStep'}};
        const pipeline = await withErrorScope(device, () => device.createComputePipelineAsync?.(descriptor) ?? device.createComputePipeline(descriptor));
        const groups=histories.map((texture,value)=>device.createBindGroup({layout,entries:[...[frame,owners,mask,impacts].map((buffer,binding)=>({binding,resource:{buffer}})),
            {binding:4,resource:texture.createView({dimension:'2d-array',baseMipLevel:0,mipLevelCount:1})},
            {binding:5,resource:histories[1-value].createView({dimension:'2d-array',baseMipLevel:0,mipLevelCount:1})}]}));
        const mipGenerator=await createSpatialMipGenerator(device,{format:'rgba16float',linearValues:true});
        signal?.throwIfAborted();
        console.debug('[SpatialWaterFoam][ready]',{owners:domains.length,resolution,bytes});
        return Object.freeze({ resourceBytes:bytes, domains, views, sampler, renderDomains,
            encode(encoder,{time,fieldBindings,camera,input,frozen=false}) {
                if(disposed||pending)throw new Error('Finite foam requires a live committed host frame');
                const dt=initialized&&!frozen&&lastTime!==null?Math.max(0,Math.min(.1,time-lastTime)):0;
                if(initialized&&(frozen||dt===0))return {view:views[index],commit(){},abort(){}};
                const records=[];const record=(layer,source,radius,amount,kind=0)=>{if(records.length<MAX_IMPACTS&&amount>0)records.push([...source,radius,amount,layer,kind,0,0]);};
                if(dt>0)for(const fall of geometry.waters.filter(water=>water.kind==='waterfall'&&water.impactActive&&water.impactWaterId)){
                    const receiver=domains.find(value=>value.water.id===fall.impactWaterId);if(!receiver)continue;
                    const source=spatialWaterSourcePoint(receiver.water,fall.endpoint),waveAt=fall.meshStart*8;
                    const radius=Math.max(resolution>0?Math.min(...receiver.extent)/resolution:0,fall.depthFade);
                    record(receiver.layer,source,radius,dt*Math.max(0,geometry.meshWind[waveAt+6]),0);
                }
                const serial=Math.max(0,input?.serial??0),fresh=serial!==0&&serial!==lastSerial;
                const enabledContact = domains.some(value => value.water.response && (fresh ? value.water.response.waterClickGain > 0 : value.water.response.waterPointerGain > 0));
                const pointerActive = input?.pointer?.[2] > 0;
                if(!frozen&&input&&!input.suppressed&&enabledContact&&(fresh||pointerActive)){
                    const contact=spatialWaterContact(geometry,camera,fresh?input.anchor:input.pointer.slice(0,2));
                    const owner=contact&&domains.find(value=>value.water.id===contact.water.id);
                    if(owner&&owner.water.response){const response=owner.water.response;record(owner.layer,contact.source,response.waterClickRadius,fresh?1:dt,fresh?1:2);}
                }
                const recordData=new Float32Array(MAX_IMPACTS*8);records.forEach((value,at)=>recordData.set(value,at*8));device.queue.writeBuffer(impacts,0,recordData);
                const packed=new ArrayBuffer(FRAME_BYTES);new Float32Array(packed).set([time,dt,0,0]);new Uint32Array(packed).set([resolution,domains.length,records.length,initialized?0:1],4);device.queue.writeBuffer(frame,0,packed);
                const pass=encoder.beginComputePass({label:'ambient-spatial-retained-foam'});pass.setPipeline(pipeline);pass.setBindGroup(0,groups[index]);pass.setBindGroup(1,fieldBindings);pass.dispatchWorkgroups(Math.ceil(resolution/8),Math.ceil(resolution/8),domains.length);pass.end();
                const next=1-index;for(let layer=0;layer<domains.length;layer++)mipGenerator.encode(encoder,histories[next],layer,true);
                let settled=false;const token={view:views[next],commit(){if(settled||pending!==token)throw new Error('Finite foam commit is stale');settled=true;pending=null;index=next;initialized=true;lastTime=time;if(!frozen&&serial!==0)lastSerial=serial;committedImpacts+=records.length;submittedFrames++;},abort(){if(settled)return;settled=true;if(pending===token)pending=null;}};
                pending=token;return token;
            },
            reset(){if(pending)throw new Error('Cannot reset in-flight foam');initialized=false;lastTime=null;},
            diagnostics(){return {version:1,owners:domains.length,resolution,residentBytes:bytes,initialized,time:lastTime,densityAgeIndex:index,recordedImpacts:committedImpacts,submittedFrames,pendingSubmission:!!pending};},
            resources(){return {histories:[...histories],frame,owners,mask,impacts,renderDomains};},
            resourceCounts(){return {buffers:5,textures:2};},
            dispose(){if(disposed)return;disposed=true;pending?.abort();resources.splice(0).reverse().forEach(value=>value.destroy());},
        });
    } catch(error){resources.reverse().forEach(value=>value.destroy());console.warn('[SpatialWaterFoam][failed]',error);throw error;}
}
