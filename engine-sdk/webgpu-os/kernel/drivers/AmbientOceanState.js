// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { PBF_KERNELS_WGSL, pbfKernelCoefficients, planPbfStepBatch } from '../../../engine/sim/fluids/PbfKernels.js';
import { OCEAN_SPECTRUM_TYPES_WGSL } from '../../../engine/render/water/OceanSpectrum.js';
import { AMBIENT_RUNTIME_V3_FRAME_WGSL } from '../schema/AmbientRuntimeV3Contract.js';
import { AMBIENT_COLLECTION_MATERIAL_TYPES_WGSL } from '../../factory/apps/ambient-studio/AmbientMaterialShaders.js';
import { waterFieldBindingsWGSL, WATER_FIELD_SAMPLE_WGSL } from '../../../engine/render/water/WaterFieldShaders.js';
import { WATER_FOAM_KERNELS_WGSL } from '../../../engine/render/water/WaterFoamKernels.js';

export const AMBIENT_OCEAN_STATE_LIMITS = Object.freeze({ particles: 256, foamSize: 128, fixedStep: 1 / 120, maximumSubsteps: 4, iterations: 3, stepUniformBytes: 1280 });
// Four particle buffers, density/lambda, finite-area impacts, controls,
// per-step uniforms and two RGBA16 foam histories; excludes host uniforms.
export const AMBIENT_OCEAN_STATE_RESOURCE_BYTES = 4 * 8192 + 2048 + 65536 + 64
    + AMBIENT_OCEAN_STATE_LIMITS.stepUniformBytes + 2 * 128 * 128 * 8;
export const AMBIENT_OCEAN_PARTICLE_WGSL = 'struct OceanParticle { positionAge:vec4f, velocityLife:vec4f }';

/** These value-only functions are factory seeds, persisted as editable nodes.
 * Runtime execution always uses functionsWGSL supplied by the saved project. */
export const OCEAN_STATE_DEFAULT_FUNCTIONS_WGSL = /* wgsl */`
fn oceanFoamDomain()->vec4f { return vec4f(-24.,0.,48.,96.); }
fn oceanFoamSettings()->vec4f { return vec4f(1.2,4.,.18,.08); }
fn oceanFoamProduction(surface:OceanSpectrumSample,point:vec2f,time:f32)->f32 {
 let settings=oceanFoamSettings();
 return settings.x*smoothstep(settings.z,settings.z+.18,max(0.,1.-surface.jacobian))*smoothstep(-.015,.10,surface.displacement.y);
}
fn oceanFoamVelocity(surface:OceanSpectrumSample,point:vec2f,time:f32)->vec2f {
 let drift=vec2f(.32,.9474175)*oceanFoamSettings().w;
 let determinant=surface.tangentX.x*surface.tangentZ.z-surface.tangentZ.x*surface.tangentX.z;
 return vec2f(surface.tangentZ.z*drift.x-surface.tangentZ.x*drift.y,-surface.tangentX.z*drift.x+surface.tangentX.x*drift.y)/max(.04,determinant);
}
fn oceanFoamDecay(coverage:f32,dt:f32,time:f32)->f32 {
 return coverage*exp(-dt/max(.01,oceanFoamSettings().y));
}
fn oceanSplashSettings()->vec4f { return vec4f(.75,2.8,.35,2.8); }
fn oceanInteractionSettings()->vec4f { return vec4f(1.,.35,.65,1.2); }
fn oceanSplashOrigin(uv:vec2f,aspect:f32,time:f32)->vec4f {
 let camera=oceanCamera(); let ray=oceanViewRay(uv,aspect);
 if(any(uv<vec2f(0.))||any(uv>vec2f(1.))||ray.y>=-.02) { return vec4f(0.); }
 let origin=vec3f(0.,max(.4,camera.x),camera.w);
 var travel=clamp(origin.y/-ray.y,0.,80.);
 for(var i=0;i<4;i+=1) {
  let point=origin+ray*travel;
  let surface=oceanSpectrumWorldSample(point.xz,time,.02);
  let residual=point.y-surface.position.y;
  let derivative=dot(ray,surface.normal)/max(surface.normal.y,.05);
  let safeDerivative=select(-max(abs(derivative),.03),max(abs(derivative),.03),derivative>=0.);
  travel=clamp(travel-clamp(residual/safeDerivative,-8.,8.),0.,80.);
 }
 let point=origin+ray*travel; let surface=oceanSpectrumWorldSample(point.xz,time,.02);
 return vec4f(surface.position,select(0.,1.,surface.residual<.05&&abs(point.y-surface.position.y)<.08));
}
fn oceanSplashForce(position:vec3f,velocity:vec3f,time:f32)->vec3f {
 return vec3f(0.,-9.81,0.)-velocity*.16;
}
fn oceanPointerImpulse(position:vec3f,pointerOrigin:vec4f,pointerVelocity:vec2f,held:f32,time:f32)->vec3f {
 let settings=oceanInteractionSettings();
 let offset=position-pointerOrigin.xyz;
 let envelope=exp(-dot(offset,offset)/max(.01,settings.w*settings.w))*pointerOrigin.w;
 return (vec3f(0.,settings.y*2.,0.)+vec3f(pointerVelocity.x,abs(pointerVelocity.y)*.35,pointerVelocity.y)*settings.z*(.5+held))*envelope;
}
fn oceanSplashEmission(surface:OceanSpectrumSample,time:f32)->f32 {
 return smoothstep(.18,.42,max(0.,1.-surface.jacobian))*smoothstep(.05,.35,surface.velocity.y);
}
fn oceanSplashRejoin(surface:OceanSpectrumSample,position:vec3f,velocity:vec3f)->f32 {
 return clamp(max(0.,dot(surface.velocity-velocity,surface.normal))*.16,0.,1.);
}
`;

const U = globalThis.GPUBufferUsage ?? { COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128 };
const T = globalThis.GPUTextureUsage ?? { COPY_SRC: 1, TEXTURE_BINDING: 4, STORAGE_BINDING: 8 };
const K = pbfKernelCoefficients(.20);
const literal = value => Number(value).toExponential(12);
const PHYSICS = /* wgsl */`
${PBF_KERNELS_WGSL}
const OCEAN_PBF_H:f32=.20;
const OCEAN_PBF_MASS:f32=.512;
const OCEAN_PBF_RHO:f32=1000.;
const OCEAN_PBF_POLY6:f32=${literal(K.poly6)};
const OCEAN_PBF_SPIKY:f32=${literal(K.spiky)};
fn oceanPbfKernel(displacement:vec3f)->f32 { return pbfPoly6(dot(displacement,displacement),.04,OCEAN_PBF_POLY6); }
fn oceanPbfGradient(displacement:vec3f)->vec3f { return pbfSpikyGradient(displacement,OCEAN_PBF_H,OCEAN_PBF_SPIKY); }
fn oceanParticleAlive(particle:OceanParticle)->bool { return particle.velocityLife.w>0. && particle.positionAge.w>=0. && particle.positionAge.w<particle.velocityLife.w; }
fn oceanStateFinite(value:vec3f)->bool { return all(abs(value)<vec3f(100000.)); }
fn oceanStateHash(value:f32)->f32 { return fract(sin(value*12.9898+78.233)*43758.5453); }
`;
const HEADER = /* wgsl */`
${AMBIENT_RUNTIME_V3_FRAME_WGSL}
${AMBIENT_OCEAN_PARTICLE_WGSL}
struct OceanStep { dynamics:vec4f }
@group(0) @binding(0) var<uniform> ambientV3Frame:AmbientV3Frame;
@group(0) @binding(1) var<uniform> oceanStep:OceanStep;
`;

/** Resource-writing entry points remain host-owned. The supplied pure functions
 * are shared with the actual mesh renderer; there is no second wave model. */
export function buildAmbientOceanStateSources(functionsWGSL, typesWGSL = OCEAN_SPECTRUM_TYPES_WGSL, waterField = false) {
    if (typeof functionsWGSL !== 'string' || !functionsWGSL.trim()) throw new TypeError('Ocean state requires saved source functions.');
    const authoredSplashPlacement = waterField && /\bfn\s+oceanSplashPlacement\s*\(/.test(functionsWGSL) && /\bfn\s+oceanSplashLaunch\s*\(/.test(functionsWGSL);
    const field = waterField ? `${waterFieldBindingsWGSL(1)}\n${WATER_FIELD_SAMPLE_WGSL}\nvar<private> oceanCurrentField:WaterFieldSample;\nvar<private> oceanCurrentFoamAge:f32;` : '';
    const valueTypes = /\bCollectionMaterial\b/.test(functionsWGSL) ? AMBIENT_COLLECTION_MATERIAL_TYPES_WGSL : '';
    const header = `${HEADER}\n${typesWGSL}\n${valueTypes}\n${field}\n${functionsWGSL}\n${PHYSICS}\n`;
    return Object.freeze({
        controls: header + /* wgsl */`
@group(0) @binding(2) var<storage,read_write> controls:array<vec4f>;
@compute @workgroup_size(1) fn oceanStateControls() {
 let time=oceanStep.dynamics.x; let aspect=ambientV3Frame.resolutionTime.x/max(1.,ambientV3Frame.resolutionTime.y);
 controls[0]=vec4f(0.); controls[1]=vec4f(0.); controls[2]=vec4f(0.); controls[3]=vec4f(0.);
 let settings=oceanSplashSettings(); if(settings.x<=0.||settings.y<=0.) { return; }
 if(ambientV3Frame.effects.w>.5) { return; }
 let pointerInfluence=clamp(ambientV3Frame.effects.x,0.,2.);
 let interaction=oceanInteractionSettings();
 if(pointerInfluence>0.&&ambientV3Frame.pointerState.x>.5&&(interaction.y>0.||interaction.z>0.)) {
  let origin=oceanSplashOrigin(ambientV3Frame.pointer.xy,aspect,time);
  controls[0]=vec4f(origin.xyz,origin.w*pointerInfluence);
 }
 if(pointerInfluence>0.&&oceanStep.dynamics.z>.5&&interaction.x>0.) {
  let origin=oceanSplashOrigin(ambientV3Frame.clickActivity.xy,aspect,time);
  controls[1]=vec4f(origin.xyz,origin.w*clamp(interaction.x,0.,4.)*pointerInfluence);
 }
 if(oceanStep.dynamics.w>.5) {
  let cycle=floor(time*1.1); let camera=oceanCamera();
  ${waterField ? `// Search the actual crest field. Empty/flat water cannot emit spray.
  var eligible=0.0;var birth=vec3f(0.0);var inherited=vec3f(0.0);
  for(var z=0u;z<8u;z+=1u){for(var x=0u;x<16u;x+=1u){
   let q=vec2f((f32(x)+0.5)*1.0-8.0,camera.w+3.0+(f32(z)+0.5)*1.0);
   let surface=oceanSpectrumSample(q,time,0.125);let amount=clamp(oceanSplashEmission(surface,time),0.0,1.0);
   if(amount>eligible){eligible=amount;birth=surface.position;inherited=surface.velocity;}
  }}
  controls[2]=vec4f(birth,eligible);controls[3]=vec4f(inherited,f32(u32(max(cycle,0.0))%4u));` : `let q=vec2f((oceanStateHash(cycle+11.)-.5)*9.,camera.w+4.+oceanStateHash(cycle+29.)*7.);
  let surface=oceanSpectrumSample(q,time,.02);
  controls[2]=vec4f(surface.position,clamp(oceanSplashEmission(surface,time),0.,1.));
  controls[3]=vec4f(surface.velocity,f32(u32(max(cycle,0.))%4u));`}
 }
}`,
        predict: header + /* wgsl */`
@group(0) @binding(2) var<storage,read> sourceParticles:array<OceanParticle>;
@group(0) @binding(3) var<storage,read_write> predictedParticles:array<OceanParticle>;
@group(0) @binding(4) var<storage,read> controls:array<vec4f>;
@compute @workgroup_size(64) fn oceanStatePredict(@builtin(global_invocation_id) gid:vec3u) {
 let index=gid.x; if(index>=256u) { return; }
 let time=oceanStep.dynamics.x; let dt=oceanStep.dynamics.y;
 let settings=oceanSplashSettings(); var particle=sourceParticles[index];
 if(settings.x<=0.||settings.y<=0.) { predictedParticles[index]=OceanParticle(vec4f(0.),vec4f(0.)); return; }
 if(!oceanParticleAlive(particle)) {
  particle=OceanParticle(vec4f(0.),vec4f(0.));
  let click=controls[1]; let crest=controls[2];
  let isClick=click.w>0.; let isCrest=crest.w>.1&&index/64u==u32(controls[3].w);
  if(!isClick&&!isCrest) { predictedParticles[index]=particle; return; }
  ${authoredSplashPlacement ? `let origin=select(crest,click,isClick);let impact=select(0.0,1.0,isClick);
  let placement=oceanSplashPlacement(origin,controls[3].xyz,index,time,impact);
  if(placement.w<=0.0||!oceanStateFinite(placement.xyz)){predictedParticles[index]=particle;return;}
  let surface=oceanSpectrumWorldSample(placement.xz,time,0.125);
  let velocity=oceanSplashLaunch(surface,vec4f(origin.xyz,placement.w),index,time,impact);
  if(!oceanStateFinite(velocity)){predictedParticles[index]=particle;return;}
  particle=OceanParticle(vec4f(placement.xyz,0.0),vec4f(clamp(velocity,vec3f(-12.0),vec3f(12.0)),clamp(settings.y,0.1,8.0)));` : `let origin=select(crest,click,isClick); let local=index%64u;
  let cell=vec3f(f32(local%4u),f32((local/4u)%4u),f32(local/16u))-vec3f(1.5);
  let bankOffset=select(vec3f(0.),vec3f(f32(index/64u%2u)-.5,0.,f32(index/128u)-.5)*.32,isClick);
  let spread=clamp(settings.z/.35,.4,2.);
  let offset=(cell*.08+bankOffset)*spread;
  let point=origin.xyz+offset+vec3f(0.,.23*spread,0.);
  let outward=vec3f(offset.x,.6+oceanStateHash(f32(index)+time)*.45,offset.z);
  let inherited=select(controls[3].xyz,vec3f(0.),isClick);
  let velocity=inherited+outward*clamp(settings.w,0.,8.)*clamp(settings.x*origin.w,0.,3.);
  particle=OceanParticle(vec4f(point,0.),vec4f(velocity,clamp(settings.y,.1,8.)));`}
 }
 let force=oceanSplashForce(particle.positionAge.xyz,particle.velocityLife.xyz,time)+oceanPointerImpulse(particle.positionAge.xyz,controls[0],ambientV3Frame.pointer.zw,ambientV3Frame.pointerState.y,time);
 let acceleration=select(vec3f(0.),clamp(force,vec3f(-40.),vec3f(40.)),oceanStateFinite(force));
 let velocity=clamp(particle.velocityLife.xyz+acceleration*dt,vec3f(-12.),vec3f(12.));
 predictedParticles[index]=OceanParticle(vec4f(particle.positionAge.xyz+velocity*dt,particle.positionAge.w+dt),vec4f(velocity,particle.velocityLife.w));
}`,
        density: header + /* wgsl */`
@group(0) @binding(2) var<storage,read> particles:array<OceanParticle>;
@group(0) @binding(3) var<storage,read_write> densityLambda:array<vec2f>;
@compute @workgroup_size(64) fn oceanStateDensity(@builtin(global_invocation_id) gid:vec3u) {
 let index=gid.x; if(index>=256u) { return; }
 let particle=particles[index]; if(!oceanParticleAlive(particle)) { densityLambda[index]=vec2f(0.); return; }
 var density=OCEAN_PBF_MASS*oceanPbfKernel(vec3f(0.)); var gradientSelf=vec3f(0.); var gradientSquares=0.;
 for(var j=0u;j<256u;j+=1u) {
  if(j==index||!oceanParticleAlive(particles[j])) { continue; }
  let displacement=particle.positionAge.xyz-particles[j].positionAge.xyz;
  if(dot(displacement,displacement)>=.04) { continue; }
  density+=OCEAN_PBF_MASS*oceanPbfKernel(displacement);
  let gradient=(OCEAN_PBF_MASS/OCEAN_PBF_RHO)*oceanPbfGradient(displacement);
  gradientSelf+=gradient; gradientSquares+=dot(gradient,gradient);
 }
 gradientSquares+=dot(gradientSelf,gradientSelf);
 let ratio=density/OCEAN_PBF_RHO;
 densityLambda[index]=vec2f(pbfDensityLambda(ratio,gradientSquares,.00008),ratio);
}`,
        project: header + /* wgsl */`
@group(0) @binding(2) var<storage,read> sourceParticles:array<OceanParticle>;
@group(0) @binding(3) var<storage,read> densityLambda:array<vec2f>;
@group(0) @binding(4) var<storage,read_write> destinationParticles:array<OceanParticle>;
@compute @workgroup_size(64) fn oceanStateProject(@builtin(global_invocation_id) gid:vec3u) {
 let index=gid.x; if(index>=256u) { return; }
 var particle=sourceParticles[index]; if(!oceanParticleAlive(particle)) { destinationParticles[index]=particle; return; }
 var correction=vec3f(0.); let ownLambda=densityLambda[index].x;
 let reference=pbfPoly6(.0036,.04,OCEAN_PBF_POLY6);
 for(var j=0u;j<256u;j+=1u) {
  if(j==index||!oceanParticleAlive(sourceParticles[j])) { continue; }
  let displacement=particle.positionAge.xyz-sourceParticles[j].positionAge.xyz;
  let distanceSquared=dot(displacement,displacement); if(distanceSquared<=.00000001||distanceSquared>=.04) { continue; }
  let pressure=pbfArtificialPressure(oceanPbfKernel(displacement),reference,.0015);
  correction+=(ownLambda+densityLambda[j].x+pressure)*(OCEAN_PBF_MASS/OCEAN_PBF_RHO)*oceanPbfGradient(displacement);
 }
 correction*=min(1.,.035/max(length(correction),.000001));
 if(oceanStateFinite(correction)) { particle.positionAge=vec4f(particle.positionAge.xyz+correction,particle.positionAge.w); }
 destinationParticles[index]=particle;
}`,
        finalize: header + /* wgsl */`
@group(0) @binding(2) var<storage,read> previousParticles:array<OceanParticle>;
@group(0) @binding(3) var<storage,read> projectedParticles:array<OceanParticle>;
@group(0) @binding(4) var<storage,read> densityLambda:array<vec2f>;
@group(0) @binding(5) var<storage,read_write> destinationParticles:array<OceanParticle>;
@compute @workgroup_size(64) fn oceanStateFinalize(@builtin(global_invocation_id) gid:vec3u) {
 let index=gid.x; if(index>=256u) { return; }
 var particle=projectedParticles[index];
 if(!oceanParticleAlive(particle)) { destinationParticles[index]=OceanParticle(vec4f(0.),vec4f(0.)); return; }
 let previous=previousParticles[index]; let dt=max(oceanStep.dynamics.y,.000001);
 var velocity=particle.velocityLife.xyz;
 if(oceanParticleAlive(previous)) { velocity=(particle.positionAge.xyz-previous.positionAge.xyz)/dt; }
 var smoothing=vec3f(0.);
 for(var j=0u;j<256u;j+=1u) {
  if(j==index||!oceanParticleAlive(projectedParticles[j])) { continue; }
  let displacement=particle.positionAge.xyz-projectedParticles[j].positionAge.xyz;
  if(dot(displacement,displacement)>=.04) { continue; }
  let rho=max(.2,densityLambda[j].y)*OCEAN_PBF_RHO;
  smoothing+=(projectedParticles[j].velocityLife.xyz-particle.velocityLife.xyz)*(OCEAN_PBF_MASS/rho)*oceanPbfKernel(displacement);
 }
 velocity=clamp(velocity+smoothing*.018,vec3f(-12.),vec3f(12.));
 let surface=oceanSpectrumWorldSample(particle.positionAge.xz,oceanStep.dynamics.x,.02);
 let signedHeight=dot(particle.positionAge.xyz-surface.position,surface.normal);
 if(surface.residual<.05&&signedHeight<=.018&&dot(velocity-surface.velocity,surface.normal)<=0.) {
  let deposit=clamp(oceanSplashRejoin(surface,particle.positionAge.xyz,velocity),0.,1.);
  // A negative age tags this one-step reentry. The impact pass consumes its
  // material coordinate before prediction removes this dead pool slot.
  destinationParticles[index]=OceanParticle(vec4f(surface.sourceCoordinate,0.,-max(deposit,.000001)),vec4f(0.)); return;
 }
 if(!oceanStateFinite(particle.positionAge.xyz)||!oceanStateFinite(velocity)||abs(particle.positionAge.y)>40.) {
  destinationParticles[index]=OceanParticle(vec4f(0.),vec4f(0.)); return;
 }
 destinationParticles[index]=OceanParticle(particle.positionAge,vec4f(velocity,particle.velocityLife.w));
}`,
        impacts: header + WATER_FOAM_KERNELS_WGSL + /* wgsl */`
@group(0) @binding(2) var<storage,read> particles:array<OceanParticle>;
@group(0) @binding(3) var<storage,read_write> impacts:array<atomic<u32>>;
@compute @workgroup_size(64) fn oceanStateImpacts(@builtin(global_invocation_id) gid:vec3u) {
 let index=gid.x; if(index>=256u) { return; }
 let particle=particles[index]; if(particle.positionAge.w>=0.||particle.velocityLife.w>0.) { return; }
 let domain=oceanFoamDomain(); let uv=(particle.positionAge.xy-domain.xy)/max(domain.zw,vec2f(.01));
 if(any(uv<vec2f(0.))||any(uv>=vec2f(1.))) { return; }
 ${waterField ? `let cell=vec2i(floor(uv*128.0));let deposit=clamp(-particle.positionAge.w,0.0,1.0)*4096.0;
 // A finite 3x3 footprint conserves each deposited population away from edges.
 for(var y=-1;y<=1;y+=1){for(var x=-1;x<=1;x+=1){
  let at=cell+vec2i(x,y);if(any(at<vec2i(0))||any(at>=vec2i(128))){continue;}
  let weight=waterFoamNineCellWeight(vec2i(x,y));
  atomicAdd(&impacts[u32(at.y)*128u+u32(at.x)],u32(deposit*weight));
 }}` : 'let cell=vec2u(uv*128.); atomicAdd(&impacts[cell.y*128u+cell.x],u32(clamp(-particle.positionAge.w,0.,1.)*4096.));'}
}`,
        foam: header + WATER_FOAM_KERNELS_WGSL + /* wgsl */`
@group(0) @binding(2) var sourceFoam:texture_2d<f32>;
@group(0) @binding(3) var destinationFoam:texture_storage_2d<rgba16float,write>;
@group(0) @binding(4) var<storage,read> impacts:array<u32>;
fn oceanFoamFetch(cell:vec2i)->vec4f {
 if(any(cell<vec2i(0))||any(cell>=vec2i(128))) { return vec4f(0.); }
 return textureLoad(sourceFoam,cell,0);
}
fn oceanFoamHistory(uv:vec2f)->vec4f {
 let p=uv*128.-.5; let cell=vec2i(floor(p)); let f=fract(p);
 return mix(mix(oceanFoamFetch(cell),oceanFoamFetch(cell+vec2i(1,0)),f.x),mix(oceanFoamFetch(cell+vec2i(0,1)),oceanFoamFetch(cell+vec2i(1,1)),f.x),f.y);
}
@compute @workgroup_size(8,8) fn oceanStateFoam(@builtin(global_invocation_id) gid:vec3u) {
 if(any(gid.xy>=vec2u(128))) { return; }
 let settings=oceanFoamSettings();
 if(settings.y<=0.) { textureStore(destinationFoam,vec2i(gid.xy),vec4f(0.)); return; }
 let domain=oceanFoamDomain(); let uv=(vec2f(gid.xy)+.5)/128.; let point=domain.xy+uv*domain.zw;
 let footprint=max(domain.z,domain.w)/128.; let time=oceanStep.dynamics.x; let dt=oceanStep.dynamics.y;
 let surface=oceanSpectrumSample(point,time,footprint);
 let velocity=oceanFoamVelocity(surface,point,time);
 let drift=select(vec2f(0.),clamp(velocity,vec2f(-8.),vec2f(8.)),all(abs(velocity)<vec2f(100000.)));
 let history=oceanFoamHistory(waterFoamBacktrace(uv,drift,dt,domain.zw));
 let decayed=clamp(oceanFoamDecay(history.x,dt,time),0.,1.);
 let production=clamp(oceanFoamProduction(surface,point,time),0.,8.);
 let impact=min(2.,f32(impacts[gid.y*128u+gid.x])/4096.);
 let coverage=waterFoamPopulation(decayed,production,impact,dt);
 let age=waterFoamAge(history.y,production,impact,dt);
 textureStore(destinationFoam,vec2i(gid.xy),vec4f(clamp(coverage,0.,1.),age,production,0.));
}`,
        clearFoam: /* wgsl */`
@group(0) @binding(0) var destination:texture_storage_2d<rgba16float,write>;
@compute @workgroup_size(8,8) fn oceanStateClearFoam(@builtin(global_invocation_id) gid:vec3u) {
 if(all(gid.xy<vec2u(128))) { textureStore(destination,vec2i(gid.xy),vec4f(0.)); }
}`,
    });
}

const ENTRY_POINTS = { controls: 'oceanStateControls', predict: 'oceanStatePredict', density: 'oceanStateDensity', project: 'oceanStateProject', finalize: 'oceanStateFinalize', impacts: 'oceanStateImpacts', foam: 'oceanStateFoam', clearFoam: 'oceanStateClearFoam' };
const STORAGE_LAYOUTS = { controls: ['storage'], predict: ['read-only-storage', 'storage', 'read-only-storage'], density: ['read-only-storage', 'storage'], project: ['read-only-storage', 'read-only-storage', 'storage'], finalize: ['read-only-storage', 'read-only-storage', 'read-only-storage', 'storage'], impacts: ['read-only-storage', 'storage'] };

/** Pure frame admission shared by the native encoder and CPU timing checks. */
export function planAmbientOceanStateFrame({ frame = {}, simulationTime, deltaSeconds, paused = false, suspended = false, reset = false, accumulator = 0, lastClick = 0, lastCycle = -1, previousTime = 0 } = {}) {
    const frozen = suspended || paused || Number(frame.effects?.[3]) > 0;
    const time = Number(simulationTime ?? frame.resolutionTime?.[2] ?? previousTime);
    const requestedDelta = Number(deltaSeconds ?? frame.resolutionTime?.[3] ?? 0);
    if (!Number.isFinite(time) || !Number.isFinite(requestedDelta) || time < 0 || requestedDelta < 0) throw new TypeError('Ocean state requires finite nonnegative time and delta.');
    const dt = frozen ? 0 : requestedDelta;
    const batch = planPbfStepBatch({ accumulatorSeconds: reset ? 0 : accumulator, frameDeltaSeconds: dt, fixedStepSeconds: 1 / 120, maximumSubsteps: 4 });
    const steps = frozen ? 0 : batch.substeps;
    const click = Math.max(0, Math.floor(Number(frame.pointerState?.[3]) || 0));
    const cycle = Math.floor(time * 1.1);
    const uniforms = new Float32Array(1280 / 4);
    for (let step = 0; step < steps; step++) {
        uniforms[step * 64] = Math.max(0, time - batch.simulatedSeconds + (step + 1) / 120);
        uniforms[step * 64 + 1] = 1 / 120;
        uniforms[step * 64 + 2] = step === 0 && click > 0 && click !== lastClick ? 1 : 0;
        uniforms[step * 64 + 3] = step === 0 && cycle !== (reset ? -1 : lastCycle) ? 1 : 0;
    }
    uniforms[256] = time; uniforms[257] = Math.min(dt, .1);
    return Object.freeze({ frozen, time, dt, batch, steps, click, cycle, uniforms });
}

/** Fixed local patch: PBF solves density constraints among a complete bounded
 * neighbor set. Emission/reentry exchange material with the prescribed ocean;
 * this is not a globally mass-conserving ocean-fluid simulation. */
export async function createAmbientOceanState({ device, uniformBuffer, functionsWGSL, typesWGSL, signal, waterFieldLayout = null, initialClickSerial = 0 } = {}) {
    if (!device?.createComputePipeline || !uniformBuffer) throw new TypeError('Ocean state requires the current shared GPU device and frame uniform buffer.');
    if(!Number.isSafeInteger(initialClickSerial)||initialClickSerial<0)throw new TypeError('Ocean state needs a nonnegative canonical click baseline.');
    const sources = buildAmbientOceanStateSources(functionsWGSL, typesWGSL, Boolean(waterFieldLayout));
    const pipelines = {}, layouts = {}, buffers = [], textures = [];
    const destroyOwned = () => { for (const resource of [...buffers, ...textures]) { try { resource.destroy(); } catch {} } };
    try {
        for (const [name, code] of Object.entries(sources)) {
            signal?.throwIfAborted();
            const module = device.createShaderModule({ label: `ambient-ocean-state-${name}`, code });
            const info = await module.getCompilationInfo?.();
            const error = info?.messages?.find(item => item.type === 'error');
            if (error) throw new Error(`Ocean ${name} shader: ${error.message} (line ${error.lineNum ?? '?'})`);
            let entries;
            if (name === 'clearFoam') entries = [{ binding: 0, visibility: 4, storageTexture: { access: 'write-only', format: 'rgba16float' } }];
            else {
                entries = [{ binding: 0, visibility: 4, buffer: { type: 'uniform' } }, { binding: 1, visibility: 4, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 16 } }];
                if (name === 'foam') entries.push({ binding: 2, visibility: 4, texture: { sampleType: 'unfilterable-float' } }, { binding: 3, visibility: 4, storageTexture: { access: 'write-only', format: 'rgba16float' } }, { binding: 4, visibility: 4, buffer: { type: 'read-only-storage' } });
                else entries.push(...STORAGE_LAYOUTS[name].map((type, index) => ({ binding: index + 2, visibility: 4, buffer: { type } })));
            }
            layouts[name] = device.createBindGroupLayout({ label: `ambient-ocean-${name}-layout`, entries });
            const descriptor = { label: `ambient-ocean-${name}-pipeline`, layout: device.createPipelineLayout({ bindGroupLayouts: [layouts[name], ...(waterFieldLayout && name !== 'clearFoam' ? [waterFieldLayout] : [])] }), compute: { module, entryPoint: ENTRY_POINTS[name] } };
            pipelines[name] = device.createComputePipelineAsync ? await device.createComputePipelineAsync(descriptor) : device.createComputePipeline(descriptor);
        }
        signal?.throwIfAborted();
        const buffer = (name, size, usage = U.STORAGE | U.COPY_DST | U.COPY_SRC) => { const result = device.createBuffer({ label: `ambient-ocean-${name}`, size, usage }); buffers.push(result); return result; };
        const state = [buffer('particles-a', 8192), buffer('particles-b', 8192)];
        const predicted = [buffer('predicted-a', 8192), buffer('predicted-b', 8192)];
        const densityLambda = buffer('density-lambda', 2048), impacts = buffer('impacts', 65536), controls = buffer('state-controls', 64);
        const stepUniform = buffer('step-uniforms', 1280, U.UNIFORM | U.COPY_DST);
        const foam = [0, 1].map(index => { const result = device.createTexture({ label: `ambient-ocean-foam-${index}`, size: { width: 128, height: 128 }, format: 'rgba16float', usage: T.TEXTURE_BINDING | T.STORAGE_BINDING | T.COPY_SRC }); textures.push(result); return result; });
        const foamViews = foam.map(texture => texture.createView());
        const group = (name, resources) => device.createBindGroup({ label: `ambient-ocean-${name}-bindings`, layout: layouts[name], entries: [
            ...(name === 'clearFoam' ? [] : [{ binding: 0, resource: { buffer: uniformBuffer } }, { binding: 1, resource: { buffer: stepUniform, size: 16 } }]),
            ...resources.map((resource, index) => ({ binding: index + (name === 'clearFoam' ? 0 : 2), resource })),
        ] });
        const b = resource => ({ buffer: resource });
        const groups = {
            controls: group('controls', [b(controls)]),
            predict: state.map(source => group('predict', [b(source), b(predicted[0]), b(controls)])),
            density: predicted.map(source => group('density', [b(source), b(densityLambda)])),
            project: predicted.map((source, index) => group('project', [b(source), b(densityLambda), b(predicted[1 - index])])),
            finalize: state.map((source, index) => group('finalize', [b(source), b(predicted[1]), b(densityLambda), b(state[1 - index])])),
            impacts: state.map(source => group('impacts', [b(source), b(impacts)])),
            foam: foamViews.map((source, index) => group('foam', [source, foamViews[1 - index], b(impacts)])),
            clearFoam: foamViews.map(view => group('clearFoam', [view])),
        };
        let disposed = false, suspended = false, initialized = false, resetPending = true, generation = 0;
        let stateIndex = 0, foamIndex = 0, accumulator = 0, lastClick = initialClickSerial, lastCycle = -1, pending = null;
        let submittedSteps = 0, submittedFrames = 0, droppedSeconds = 0, lastSimulationTime = 0;
        let fieldBindGroup = null;
        const dispatch = (encoder, name, bindings, offset = 0, x = 4, y = 1) => {
            const pass = encoder.beginComputePass({ label: `ambient-ocean-${name}` }); pass.setPipeline(pipelines[name]);
            if (name === 'clearFoam') pass.setBindGroup(0, bindings); else pass.setBindGroup(0, bindings, [offset]);
            if (waterFieldLayout && name !== 'clearFoam') pass.setBindGroup(1, fieldBindGroup);
            pass.dispatchWorkgroups(x, y); pass.end();
        };
        console.debug('[AmbientOceanState][create][complete]', { particles: 256, foamSize: 128, storageBytes: AMBIENT_OCEAN_STATE_RESOURCE_BYTES - 262144, textureBytes: 262144 });
        return Object.freeze({
            encode(encoder, options = {}) {
                if (disposed) throw new Error('Ocean state is disposed.');
                if (!encoder?.beginComputePass || !encoder?.clearBuffer) throw new TypeError('Ocean state requires the caller command encoder.');
                if (pending) throw new Error('Commit the previous ocean state encoding before encoding another frame.');
                fieldBindGroup = options.waterFieldBindGroup ?? null;
                if (waterFieldLayout && !fieldBindGroup) throw new TypeError('Ocean state requires this frame’s coherent water field bindings.');
                const reset = resetPending || !initialized;
                const { frozen: paused, time, dt, batch, steps, click, cycle, uniforms } = planAmbientOceanStateFrame({ ...options, suspended, reset, accumulator, lastClick, lastCycle, previousTime: lastSimulationTime });
                const startState = reset ? 0 : stateIndex, startFoam = reset ? 0 : foamIndex;
                let nextState = startState, nextFoam = startFoam;
                if (reset) {
                    for (const target of [...state, ...predicted, densityLambda, impacts, controls]) encoder.clearBuffer(target);
                    for (const bindings of groups.clearFoam) dispatch(encoder, 'clearFoam', bindings, 0, 16, 16);
                } else if (dt > 0) encoder.clearBuffer(impacts);
                if (dt > 0 || steps > 0) {
                    device.queue.writeBuffer(stepUniform, 0, uniforms);
                    for (let step = 0; step < steps; step++) {
                        const offset = step * 256;
                        dispatch(encoder, 'controls', groups.controls, offset, 1);
                        dispatch(encoder, 'predict', groups.predict[nextState], offset);
                        let prediction = 0;
                        for (let iteration = 0; iteration < 3; iteration++) {
                            dispatch(encoder, 'density', groups.density[prediction], offset);
                            dispatch(encoder, 'project', groups.project[prediction], offset);
                            prediction = 1 - prediction;
                        }
                        dispatch(encoder, 'finalize', groups.finalize[nextState], offset);
                        nextState = 1 - nextState;
                        dispatch(encoder, 'impacts', groups.impacts[nextState], offset);
                    }
                    dispatch(encoder, 'foam', groups.foam[startFoam], 1024, 16, 16);
                    nextFoam = 1 - startFoam;
                }
                const token = { generation, stateIndex: nextState, foamIndex: nextFoam };
                pending = token;
                // Getters expose these encoded destinations immediately so the
                // mesh/spray can consume them later in this same command buffer.
                return () => {
                    if (disposed || pending !== token || generation !== token.generation) return false;
                    stateIndex = nextState; foamIndex = nextFoam; initialized = true; resetPending = false; pending = null;
                    accumulator = paused ? (reset ? 0 : accumulator) : batch.remainingSeconds;
                    if (steps > 0) { lastClick = click; lastCycle = cycle; }
                    submittedSteps += steps; submittedFrames++; droppedSeconds += paused ? 0 : batch.droppedSeconds; lastSimulationTime = time;
                    return true;
                };
            },
            getFoamView() { return foamViews[pending?.foamIndex ?? foamIndex]; },
            getParticleBuffer() { return state[pending?.stateIndex ?? stateIndex]; },
            resources() { return Object.freeze({ particleState: [...state], particlePredicted: [...predicted], densityLambda, impacts, controls, stepUniform, foamTextures: [...foam] }); },
            // Encoding alone owns no simulation state. A failed caller submit
            // must release only this uncommitted destination selection, keeping
            // the committed clock, event counters and any queued reset intact.
            abortFrame() { if (disposed || !pending) return false; pending = null; return true; },
            reset() { if (disposed) return false; generation++; pending = null; resetPending = true; console.debug('[AmbientOceanState][reset][queued]', { generation }); return true; },
            setSuspended(value) { suspended = value === true; },
            oneShotBudget() { return { operations: 1, bytes: 1280 }; },
            resourceCounts() { return { buffers: disposed ? 0 : 8, textures: disposed ? 0 : 2, persistentBuffers: disposed ? 0 : 7, persistentTextures: disposed ? 0 : 2 }; },
            diagnostics() { return Object.freeze({ particleCapacity: 256, foamSize: 128, fixedStepSeconds: 1 / 120, densityIterations: 3, maximumSubsteps: 4, submittedSteps, submittedFrames, droppedSeconds, simulationTime: lastSimulationTime, stateIndex, foamIndex, initialized, suspended, pendingSubmission: Boolean(pending), resetPending, generation }); },
            dispose() { if (disposed) return false; disposed = true; generation++; pending = null; destroyOwned(); console.debug('[AmbientOceanState][dispose][complete]'); return true; },
        });
    } catch (error) {
        destroyOwned(); console.warn('[AmbientOceanState][create][error]', error); throw error;
    }
}
