// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { createWaterFieldService } from '../../../engine/render/water/WaterFieldService.js';
import { createWaterFieldRecipe, createAnalyticWaterFieldRecipe, WATER_FIELD_MAX_BYTES } from '../../../engine/render/water/WaterFieldRecipe.js';
import { createNeutralWaterFieldBindings, WATER_FIELD_NEUTRAL_RESOURCE_BYTES } from '../../../engine/render/water/WaterFieldNeutral.js';
import { waterFieldResourceByteSize } from '../../../engine/render/water/WaterFieldMath.js';
import { waterFieldBindingsWGSL, WATER_FIELD_SAMPLE_WGSL } from '../../../engine/render/water/WaterFieldShaders.js';
import { WATER_FOAM_KERNELS_WGSL } from '../../../engine/render/water/WaterFoamKernels.js';
import { extractAmbientWgslFunctions } from '../schema/AmbientNativeAppearance.js';
import { hasFiniteAmbientWaterState, FINITE_WATER_RUNTIME_BEGIN, FINITE_WATER_RUNTIME_END } from '../schema/AmbientFiniteWaterContract.js';
import { createSpatialMipGenerator, spatialMipLevelCount } from './SpatialAmbientMipmaps.js';
import { withErrorScope } from '../../../engine/core/gpu/GpuDebug.js';

const CONTROL_BYTES = 64, CONTACT_BYTES = 32, RESOLUTION = 128;
const literal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?[fiu]?$/;

function readVector(functions, name) {
    const fn = functions.find(value => value.name === name);
    if (!fn || fn.signature.replace(/\s/g, '') !== `fn${name}()->vec4f`) throw new TypeError(`Finite water requires ${name}()->vec4f.`);
    const match = /^\s*return\s+vec4f\s*\(([^]*?)\)\s*;\s*$/.exec(fn.body);
    const tokens = match?.[1].split(',').map(value => value.trim());
    if (!tokens || ![1, 4].includes(tokens.length) || tokens.some(value => !literal.test(value))) throw new TypeError(`${name} must return a literal vec4f; edit its saved numeric controls.`);
    const values = tokens.map(value => Number(value.replace(/[fiu]$/, '')));
    if (!values.every(Number.isFinite)) throw new RangeError(`Nonfinite ${name}.`);
    return values.length === 1 ? Array(4).fill(values[0]) : values;
}

function densityClosure(functions, root = 'waterFieldSpectralDensity') {
    const byName = new Map(functions.map(value => [value.name, value])), selected = new Set();
    const visit = name => {
        if (selected.has(name)) return;
        const fn = byName.get(name); if (!fn) return;
        selected.add(name);
        for (const call of fn.body.matchAll(/\b(\w+)\s*\(/g)) if (byName.has(call[1])) visit(call[1]);
    };
    visit(root);
    return functions.filter(fn => selected.has(fn.name)).map(fn => fn.source).join('\n');
}

export function finiteAmbientWaterHistoryBytes(size = RESOLUTION) {
    if (![64, 128].includes(size)) throw new RangeError('Finite foam resolution must be64 or128.');
    let texels = 0; for (let width = size; width >= 1; width >>= 1) texels += width * width;
    return texels * 16 + CONTROL_BYTES + CONTACT_BYTES;
}

/** Source inspection is allocation-free, allowing the canonical host ledger
 * to reserve the complete constructor envelope before its first GPU object. */
export function inspectFiniteAmbientWater(sourceWGSL) {
    if (!hasFiniteAmbientWaterState(sourceWGSL)) return null;
    const functions = extractAmbientWgslFunctions(sourceWGSL), domain = readVector(functions, 'ambientFiniteWaterDomain');
    if (domain[2] !== domain[3] || domain[2] < .25 || domain[2] > 8192 || domain.slice(0,2).some(value => Math.abs(value) > 4096)) throw new RangeError('Finite water requires a bounded square physical domain.');
    const waves = readVector(functions, 'ambientFiniteWaterWaves'), wind = readVector(functions, 'ambientFiniteWaterWind'), current = readVector(functions, 'ambientFiniteWaterCurrent');
    const seedFn = functions.find(value => value.name === 'ambientFiniteWaterSeed');
    const seedText = seedFn?.body.match(/^\s*return\s+(?:u32\(\s*)?([\d.]+)u?\s*\)?\s*;\s*$/)?.[1];
    const seed = Number(seedText); if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new TypeError('Finite water seed must be a literal uint32.');
    for (const name of ['ambientWaterField', 'ambientFiniteWaterMask', 'ambientFiniteWaterCoordinate', 'ambientFiniteWaterFlow', 'ambientFiniteWaterFoamSettings', 'ambientFiniteWaterFoamProduction', 'ambientFiniteWaterFoamDecay', 'ambientFiniteWaterFoamImpact', 'ambientFiniteWaterResponse', 'ambientFiniteWaterContact']) {
        if (!functions.some(value => value.name === name)) throw new TypeError(`Finite water is missing its saved owner function ${name}.`);
    }
    const modelFn = functions.find(value=>value.name==='ambientFiniteWaterFieldModel');
    const model = modelFn ? Number(modelFn.body.match(/^\s*return\s+([12])u\s*;\s*$/)?.[1]) : 1;
    if(![1,2].includes(model))throw new TypeError('Unsupported finite water field model.');
    const source = densityClosure(functions,model===2?'ambientFiniteSavedField':'waterFieldSpectralDensity');
    if (!source && waves[0] !== 0) throw new TypeError('Nonzero finite waves require their saved field source owner.');
    const parameters={significantWaveHeight:waves[0],minimumWavelength:waves[1],maximumWavelength:waves[2],depth:waves[3],
        windSpeed:wind[0],windDirection:wind[1],directionalSpread:wind[2],shortWaveDamping:wind[3],flow:current.slice(0,2),choppiness:current[2]};
    const fieldRecipe = !source ? null : model===1 ? createWaterFieldRecipe({seed,parameters,sourceWGSL:source}) : createAnalyticWaterFieldRecipe({seed,parameters,cacheDomainLength:domain[2],sourceWGSL:source+`
fn waterFieldSourceSample(q:vec2f,time:f32)->WaterFieldSourceSample {
 let field=ambientFiniteSavedField(q,time,0.0);return WaterFieldSourceSample(field.displacement,field.tangentX,field.tangentZ,field.velocity);
}`});
    const fieldBytes = fieldRecipe ? waterFieldResourceByteSize(RESOLUTION,fieldRecipe.model).totalBytes : WATER_FIELD_NEUTRAL_RESOURCE_BYTES;
    return Object.freeze({ version:1, domain:Object.freeze(domain), resolution:RESOLUTION, foamResolution:RESOLUTION, fieldRecipe, fieldBytes,
        resourceBytes:fieldBytes+finiteAmbientWaterHistoryBytes(RESOLUTION) });
}

function runtimeShader(builtSource, flavor, model) {
    const begin = builtSource.indexOf(FINITE_WATER_RUNTIME_BEGIN), end = builtSource.indexOf(FINITE_WATER_RUNTIME_END);
    if (begin < 0 || end < begin || begin !== builtSource.lastIndexOf(FINITE_WATER_RUNTIME_BEGIN)) throw new TypeError('Finite water requires the checked host ABI block.');
    const authored = builtSource.slice(0,begin)+builtSource.slice(end+FINITE_WATER_RUNTIME_END.length);
    const savedNames = new Set(extractAmbientWgslFunctions(authored).map(fn=>fn.name)), aliases = new Map();
    // An explicitly upgraded raw evaluator can still own waterFieldFinish (or
    // a modified sampling helper). Keep its saved bytes and rename only the
    // colliding derived library, including its internal calls. Programs without
    // a collision retain the exact same generated shader.
    for (const fn of extractAmbientWgslFunctions(WATER_FIELD_SAMPLE_WGSL)) if(savedNames.has(fn.name)) {
        const alias='ambientFiniteHost_'+fn.name;
        if(savedNames.has(alias))throw new TypeError(`Saved source redeclares derived water helper ${alias}.`);
        aliases.set(fn.name,alias);
    }
    const sampling=WATER_FIELD_SAMPLE_WGSL.replace(/\b[A-Za-z_]\w*\b/g,name=>aliases.get(name)??name);
    // The canonical value structure is already authored by the field slot.
    const bindings = waterFieldBindingsWGSL(1).replace(/struct WaterFieldSample\s*\{[^]*?\}\s*/, '');
    const runtime = bindings + sampling + WATER_FOAM_KERNELS_WGSL + /* wgsl */`
struct AmbientFiniteFrame { timing:vec4f,pointer:vec4f,click:vec4f,state:vec4u }
@group(2) @binding(0) var<uniform> ambientFiniteFrame:AmbientFiniteFrame;
@group(2) @binding(1) var ambientFiniteSampler:sampler;
@group(2) @binding(2) var ambientFiniteHistory:texture_2d_array<f32>;
@group(2) @binding(3) var ambientFiniteDestination:texture_storage_2d_array<rgba16float,write>;
@group(2) @binding(4) var<storage,read_write> ambientFiniteContactRecord:array<vec4f>;
fn ambientFiniteSharedField(q:vec2f,time:f32,footprint:f32)->WaterFieldSample{return ${aliases.get('waterFieldSample')??'waterFieldSample'}(q,time,footprint);}
${flavor === 'v3' ? 'fn ambientFiniteWaterFrame()->AmbientV3Frame{return ambientV3Frame;}' : ''}
${extractAmbientWgslFunctions(builtSource).some(fn=>fn.name==='ambientFiniteWaterAuthoredImpact')?'':'fn ambientFiniteWaterAuthoredImpact(point:vec2f,time:f32,dt:f32,footprint:f32)->f32{return 0.0;}'}
fn ambientFiniteWaterCoverage(q:vec2f,time:f32,footprint:f32)->f32 {
 let domain=ambientFiniteWaterDomain();let uv=(q-domain.xy)/domain.zw;
 if(any(uv<vec2f(0))||any(uv>vec2f(1))){return 0.;}
 let cells=footprint*f32(ambientFiniteFrame.state.x)/domain.z;let lod=max(0.,log2(max(cells,1.)));
 return clamp(textureSampleLevel(ambientFiniteHistory,ambientFiniteSampler,uv,0,lod).x,0.,1.);
}
fn ambientFiniteFetch(cell:vec2i)->vec4f {
 let size=i32(ambientFiniteFrame.state.x);if(any(cell<vec2i(0))||any(cell>=vec2i(size))){return vec4f(0);}
 return textureLoad(ambientFiniteHistory,cell,0,0);
}
fn ambientFiniteHistoryAt(uv:vec2f)->vec4f {
 let p=uv*f32(ambientFiniteFrame.state.x)-.5;let cell=vec2i(floor(p));let f=fract(p);
 return mix(mix(ambientFiniteFetch(cell),ambientFiniteFetch(cell+vec2i(1,0)),f.x),mix(ambientFiniteFetch(cell+vec2i(0,1)),ambientFiniteFetch(cell+vec2i(1,1)),f.x),f.y);
}
@compute @workgroup_size(1) fn ambientFiniteContactStep() {
 ambientFiniteContactRecord[0]=vec4f(0);ambientFiniteContactRecord[1]=vec4f(0);
 let response=ambientFiniteWaterResponse();if(response.w<=0.||ambientFiniteFrame.state.z>0u){return;}
 let fresh=ambientFiniteFrame.click.w>0.;let pointerPressed=ambientFiniteFrame.pointer.z>0.&&ambientFiniteFrame.pointer.w>0.;
 let amount=select(response.z*ambientFiniteFrame.timing.y,response.x,fresh);
 if((!fresh&&!pointerPressed)||amount<=0.){return;}
 let uv=select(ambientFiniteFrame.pointer.xy,ambientFiniteFrame.click.xy,fresh);
 let hit=ambientFiniteWaterContact(uv,ambientFiniteFrame.timing.zw,ambientFiniteFrame.timing.x);
 let domain=ambientFiniteWaterDomain();let inside=all(hit.xy>=domain.xy)&&all(hit.xy<=domain.xy+domain.zw);
 if(hit.z<=0.||!inside||ambientFiniteWaterMask(hit.xy,ambientFiniteFrame.timing.x)<=0.){return;}
 ambientFiniteContactRecord[0]=vec4f(hit.xy,max(response.y,domain.z/f32(ambientFiniteFrame.state.x)),amount);
 ambientFiniteContactRecord[1]=vec4f(1,select(2.,1.,fresh),0,0);
}
@compute @workgroup_size(8,8) fn ambientFiniteFoamStep(@builtin(global_invocation_id) gid:vec3u) {
 let size=ambientFiniteFrame.state.x;if(any(gid.xy>=vec2u(size))){return;}
 let domain=ambientFiniteWaterDomain();let uv=(vec2f(gid.xy)+.5)/f32(size);let q=domain.xy+uv*domain.zw;
 let time=ambientFiniteFrame.timing.x;let dt=ambientFiniteFrame.timing.y;let settings=ambientFiniteWaterFoamSettings();
 let mask=clamp(ambientFiniteWaterMask(q,time),0.,1.);
 if(mask<=0.||settings.x<=0.){textureStore(ambientFiniteDestination,vec2i(gid.xy),0,vec4f(0));return;}
 ${model==='analytic-cache-v2'?'let coordinate=ambientFiniteWaterCoordinate(q,time);let field=ambientWaterField(coordinate.xy,time,domain.z/f32(size)*max(abs(coordinate.z),abs(coordinate.w)));':'let field=ambientWaterField(q,time,domain.z/f32(size));'}
 let current=clamp(ambientFiniteWaterFlow(q,time),vec2f(-100),vec2f(100));
 let history=select(ambientFiniteHistoryAt(waterFoamBacktrace(uv,current,dt,domain.zw)),vec4f(0),ambientFiniteFrame.state.y>0u);
 let production=clamp(ambientFiniteWaterFoamProduction(field,time,settings),0.,8.)*mask;
 let decayed=clamp(ambientFiniteWaterFoamDecay(history.x,dt,time,settings.w),0.,1.);var impact=0.;
 if(ambientFiniteContactRecord[1].x>0.){let contact=ambientFiniteContactRecord[0];impact=clamp(ambientFiniteWaterFoamImpact(length(q-contact.xy),contact.z,contact.w,time),0.,2.);}
 if(dt>0.){impact=clamp(impact+clamp(ambientFiniteWaterAuthoredImpact(q,time,dt,domain.z/f32(size)),0.,2.)*settings.x,0.,2.);}
 let coverage=clamp(waterFoamPopulation(decayed,production,impact*mask,dt),0.,1.);
 let age=waterFoamAge(history.y,production,impact,dt);
 textureStore(ambientFiniteDestination,vec2i(gid.xy),0,vec4f(coverage,age,production,mask));
}
`;
    return builtSource.slice(0,begin)+runtime+builtSource.slice(end+FINITE_WATER_RUNTIME_END.length);
}

/** Borrowed-device adapter. Construction never submits work; every simulation
 * update and mip is recorded into, and committed by, the canonical host frame. */
export async function createFiniteAmbientWaterLane({device,sourceWGSL,builtSource,frameBuffer,frameFlavor='v3',budgetBytes=WATER_FIELD_MAX_BYTES,signal,initialClickSerial=0}={}) {
    const config=inspectFiniteAmbientWater(sourceWGSL);if(!config)return null;
    if(!['v3','program'].includes(frameFlavor)||!frameBuffer)throw new TypeError('Finite water requires its canonical host frame binding.');
    if(config.resourceBytes>Math.min(budgetBytes,WATER_FIELD_MAX_BYTES))throw new RangeError('Finite water constructor exceeds its admitted budget.');
    if(!Number.isSafeInteger(initialClickSerial)||initialClickSerial<0)throw new TypeError('Finite water needs a nonnegative canonical click baseline.');
    let field=null,prepared=null,pending=null,disposed=false,initialized=false,index=0,lastTime=null,lastSerial=initialClickSerial,committedFrames=0;
    const owned=[],own=value=>{owned.push(value);return value;};
    const cleanup=()=>{pending?.abort();owned.splice(0).reverse().forEach(value=>value.destroy());field?.dispose();};
    try {
        signal?.throwIfAborted();
        field=config.fieldRecipe?createWaterFieldService({device,recipe:config.fieldRecipe,maxBytes:config.fieldBytes,label:'AmbientFiniteWaterField'}):createNeutralWaterFieldBindings({device,label:'AmbientFiniteNeutralField'});
        const fieldOrigin=config.fieldRecipe?.model==='analytic-cache-v2'?[config.domain[0]+config.domain[2]*.5,config.domain[1]+config.domain[3]*.5]:[0,0];
        if(config.fieldRecipe)prepared=await field.prepare({time:0,resolution:RESOLUTION,origin:fieldOrigin});
        const fieldBindings=field.getBindings(prepared),levels=spatialMipLevelCount(RESOLUTION,RESOLUTION);
        const controls=own(device.createBuffer({label:'ambient-finite-water-controls',size:CONTROL_BYTES,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}));
        const contact=own(device.createBuffer({label:'ambient-finite-water-recorded-contact',size:CONTACT_BYTES,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}));
        const histories=[0,1].map(value=>own(device.createTexture({label:`ambient-finite-water-density-age-${value}`,size:[RESOLUTION,RESOLUTION,1],format:'rgba16float',textureBindingViewDimension:'2d-array',mipLevelCount:levels,
            usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC})));
        const sampler=device.createSampler({minFilter:'linear',magFilter:'linear',mipmapFilter:'linear',addressModeU:'clamp-to-edge',addressModeV:'clamp-to-edge'});
        const frameLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:7,buffer:{type:'uniform',minBindingSize:frameFlavor==='v3'?128:64}}]});
        const foamLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:6,buffer:{type:'uniform',minBindingSize:CONTROL_BYTES}},
            {binding:1,visibility:6,sampler:{type:'filtering'}},{binding:2,visibility:6,texture:{sampleType:'float',viewDimension:'2d-array'}},
            {binding:3,visibility:4,storageTexture:{access:'write-only',format:'rgba16float',viewDimension:'2d-array'}},{binding:4,visibility:4,buffer:{type:'storage',minBindingSize:CONTACT_BYTES}}]});
        const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[frameLayout,fieldBindings.layout,foamLayout]});
        const frameGroup=device.createBindGroup({layout:frameLayout,entries:[{binding:0,resource:{buffer:frameBuffer}}]});
        const groups=histories.map((texture,value)=>device.createBindGroup({layout:foamLayout,entries:[{binding:0,resource:{buffer:controls}},{binding:1,resource:sampler},
            {binding:2,resource:texture.createView({dimension:'2d-array'})},{binding:3,resource:histories[1-value].createView({dimension:'2d-array',baseMipLevel:0,mipLevelCount:1})},{binding:4,resource:{buffer:contact}}]}));
        const shaderSource=runtimeShader(builtSource,frameFlavor,config.fieldRecipe?.model),module=device.createShaderModule({label:'ambient-finite-water-state',code:shaderSource});
        const info=await module.getCompilationInfo?.(),error=info?.messages?.find(value=>value.type==='error');if(error)throw new Error(`Finite water:${error.lineNum}:${error.linePos}:${error.message}`);
        const pipelines=[];for(const entryPoint of ['ambientFiniteContactStep','ambientFiniteFoamStep'])pipelines.push(await withErrorScope(device,()=>device.createComputePipelineAsync({label:entryPoint,layout:pipelineLayout,compute:{module,entryPoint}})));
        const mips=await createSpatialMipGenerator(device,{format:'rgba16float',linearValues:true});signal?.throwIfAborted();
        const actualBytes=field.resourceBytes+finiteAmbientWaterHistoryBytes(RESOLUTION);if(actualBytes>config.resourceBytes)throw new Error('Finite water physical resource ledger underestimated its allocation.');
        console.debug('[FiniteAmbientWaterLane][ready]',{version:1,model:config.fieldRecipe?.model??'neutral-v2',resourceBytes:actualBytes});
        return Object.freeze({shaderSource,pipelineLayout,frameLayout,resourceBytes:actualBytes,
            encode(encoder,{time,delta=0,paused=false,width=1,height=1,pointer={}}={}) {
                if(disposed||pending)throw new Error('Finite water requires a live, settled host frame.');
                if(!Number.isFinite(time)||!Number.isFinite(delta))throw new TypeError('Finite water needs the canonical finite shader time.');
                const dt=initialized&&!paused?Math.min(.1,Math.max(0,time-(lastTime??time))):0;
                const serial=Math.max(0,Math.floor(pointer.clickSerial??0)),fresh=!paused&&serial!==0&&serial!==lastSerial;
                const update=!initialized||(!paused&&(dt>0||fresh));let fieldToken=null,next=index;
                try {
                    if(config.fieldRecipe){prepared=field.prepareFrame({time,origin:fieldOrigin,update:!initialized||time!==lastTime});fieldToken=field.encode(encoder,prepared);}
                    if(update){
                        const data=new ArrayBuffer(CONTROL_BYTES);new Float32Array(data).set([time,dt,Math.max(1,width),Math.max(1,height),pointer.x??.5,pointer.y??.5,pointer.active?1:0,pointer.pressed?1:0,pointer.clickX??pointer.x??.5,pointer.clickY??pointer.y??.5,serial,fresh?1:0]);
                        new Uint32Array(data).set([RESOLUTION,initialized?0:1,paused?1:0,0],12);device.queue.writeBuffer(controls,0,data);
                        for(let passIndex=0;passIndex<2;passIndex++){const pass=encoder.beginComputePass({label:passIndex===0?'ambient-finite-recorded-contact':'ambient-finite-retained-foam'});
                            pass.setPipeline(pipelines[passIndex]);pass.setBindGroup(0,frameGroup);pass.setBindGroup(1,field.getBindings(prepared).bindGroup);pass.setBindGroup(2,groups[index]);pass.dispatchWorkgroups(passIndex===0?1:RESOLUTION/8,passIndex===0?1:RESOLUTION/8);pass.end();}
                        next=1-index;mips.encode(encoder,histories[next],0,true);
                    }
                    let settled=false;const token={bind(pass){pass.setBindGroup(1,field.getBindings(prepared).bindGroup);pass.setBindGroup(2,groups[next]);},
                        commit(){if(settled||pending!==token)throw new Error('Finite water commit is stale.');settled=true;pending=null;fieldToken?.commit();index=next;initialized=true;lastTime=time;if(!paused&&serial!==0)lastSerial=serial;committedFrames++;},
                        abort(){if(settled)return;settled=true;if(pending===token)pending=null;fieldToken?.abort();}};pending=token;return token;
                }catch(error){fieldToken?.abort();throw error;}
            },
            reset(){if(pending)throw new Error('Cannot reset an unsubmitted water frame.');initialized=false;lastTime=null;},
            diagnostics(){return {version:1,field:field.diagnostics(),residentBytes:actualBytes,domain:config.domain,resolution:RESOLUTION,initialized,time:lastTime,densityAgeIndex:index,lastConsumedClickSerial:lastSerial,committedFrames,pendingSubmission:!!pending};},
            resources(){return {histories:[...histories],controls,contact,field};},
            resourceCounts(){const counts=field.resourceCounts();return {buffers:counts.buffers+2,textures:counts.textures+2};},
            oneShotBudget(){const r=prepared?.resource,fieldOps=r?r.domainGroups.length*(r.fft?2+r.fft.passCount:1)+r.mipPasses.length*2:0;
                return {operations:fieldOps+2+levels-1+1+(r?4:0),bytes:CONTROL_BYTES+(r?352:0),writeOperations:1+(r?4:0),writeBytes:CONTROL_BYTES+(r?352:0)};},
            whenSettled(){return field.whenSettled?.()??Promise.resolve();},
            dispose(){if(disposed)return;disposed=true;cleanup();},
        });
    }catch(error){cleanup();await field?.whenSettled?.();console.warn('[FiniteAmbientWaterLane][failed]',error);throw error;}
}
