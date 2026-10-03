// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { pbrMaterialsWGSL } from '../shaders/modules/chunks/pbr_materials.js';
import { beerLambertWGSL } from '../shaders/modules/chunks/raymarching.js';
import { noise2dWGSL } from '../shaders/modules/chunks/noise2d.js';
import { phaseVFXWGSL } from '../shaders/modules/core/particles_phase_vfx.js';
import { LEGACY_PCG32_WGSL } from '../../core/math/MathBits.js';
import oilVisual from '../../sim/particles/substances/materials/oil/visual.js';
import acidVisual from '../../sim/particles/substances/materials/acid/visual.js';
import { SURFACE_ACID_PROFILE } from '../../sim/surfaceFields/SurfaceFieldChemistry.js';
import { quaternionWGSL } from '../shaders/modules/chunks/quaternion.js';

const scalar = value => Number(value).toFixed(8);
const vector = values => `vec3f(${values.map(scalar).join(',')})`;
// The PBR chunk already defines the shared PCG functions. Reuse the native
// phase bubble implementation while composing that shared dependency once.
const surfacePhaseVfx = phaseVFXWGSL.replace(LEGACY_PCG32_WGSL, '');

/** Reuses the Engine PBR and optical kernels. Surface state supplies material
 * changes; native Flow owns volumetric fire and smoke presentation.
 */
export const SURFACE_FIELD_RENDER_WGSL = /* wgsl */`
${pbrMaterialsWGSL}
${beerLambertWGSL}
${noise2dWGSL}
${surfacePhaseVfx}
${quaternionWGSL}
const OIL_COLOR:vec3f=${vector(oilVisual.color)};
const OIL_ABSORPTION:vec3f=${vector(oilVisual.absorption)};
const OIL_IOR:f32=${scalar(oilVisual.refraction)};
const ACID_COLOR:vec3f=${vector(acidVisual.color)};
const ACID_ABSORPTION:vec3f=${vector(acidVisual.absorption)};
const ACID_IOR:f32=${scalar(acidVisual.refraction)};
const ACID_REFERENCE_REACTION_RATE:f32=${scalar(SURFACE_ACID_PROFILE.carbonateRateKgM2Second)};
struct Cell { a:vec4f, b:vec4f }
struct Domain { center:vec4f, sizeStep:vec4f, colorMetallic:vec4f, roughTilt:vec4f }
struct Frame { vp:mat4x4f, eyeTime:vec4f, viewportMode:vec4f, controls:vec4f, brush:vec4f, counts:vec4u, detail:vec4u, inverseVP:mat4x4f }
@group(0) @binding(0) var<uniform> frame:Frame;
@group(0) @binding(1) var<storage,read> fields:array<Cell>;
@group(0) @binding(2) var<storage,read> metadata:array<Cell>;
@group(0) @binding(3) var<storage,read> domains:array<Domain>;
@group(0) @binding(4) var<storage,read> addresses:array<u32>;
// HCl mass fraction, aqueous temperature K, total aqueous depth m, oil coverage.
@group(0) @binding(5) var<storage,read> liquidProperties:array<vec4f>;
// Auxiliary retained owner state: oil depth, total aqueous depth, removed solid
// depth, carbonate reaction rate; oil burn rate, CO2 rate, remaining native
// pine dry-solid depth and initial native pine substrate depth.
@group(0) @binding(6) var<storage,read> auxiliary:array<Cell>;
// Native rigid leaf center/visibility and relative quaternion, by storage cell.
@group(0) @binding(7) var<storage,read> poses:array<Cell>;
@group(0) @binding(8) var scene:texture_2d<f32>;
@group(0) @binding(9) var sceneSampler:sampler;
struct SurfaceFireLight { centreRadius:vec4f, radiance:vec4f }
@group(0) @binding(10) var<storage,read> surfaceFireLight:SurfaceFireLight;
struct Vertex {
 @builtin(position) clip:vec4f,
 @location(0) position:vec3f,
 @location(1) normal:vec3f,
 @location(2) uv:vec2f,
 @location(3) @interpolate(flat) cell:u32,
 @location(4) @interpolate(flat) domain:u32,
 @location(5) effect:vec2f,
 @location(6) materialPosition:vec3f,
 @location(7) @interpolate(flat) clipPlane:vec4f,
}
const QUAD:array<vec2f,6>=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));
fn address(d:u32,x:i32,z:i32)->u32 {let n=i32(frame.counts.x);return addresses[d*frame.counts.x*frame.counts.x+u32(clamp(z,0,n-1)*n+clamp(x,0,n-1))];}
fn tilt(d:Domain)->vec2f {return d.roughTilt.yz+frame.controls.yz*d.center.w;}
fn cellHeight(d:Domain,position:vec2f)->f32 {return d.center.y+dot(position-d.center.xz,tilt(d));}
fn liquidDepth(i:u32)->f32 {return auxiliary[i].a.x+auxiliary[i].a.y;}
fn liquidCorner(d:u32,x:i32,z:i32)->f32 {
 return .25*(liquidDepth(address(d,x-1,z-1))+liquidDepth(address(d,x,z-1))+liquidDepth(address(d,x-1,z))+liquidDepth(address(d,x,z)));
}
fn removedDepth(i:u32)->f32 {
 if(metadata[i].b.z<.5 && auxiliary[i].b.w>0.0){return clamp(auxiliary[i].b.w-auxiliary[i].b.z,0.0,metadata[i].b.w);}
 return min(auxiliary[i].a.z,metadata[i].b.w);
}
fn hasSolid(i:u32)->bool {
 if(poses[i].a.w<.5){return false;}
 if(metadata[i].b.z<.5 && auxiliary[i].b.w>0.0){return auxiliary[i].b.z>0.0;}
 return auxiliary[i].a.z<metadata[i].b.w*(1.0-.00001);
}
fn etchScale(i:u32)->f32 {
 let domain=domains[u32(metadata[i].b.x)];
 return select(1.0,f32(max(1u,frame.detail.w)),domain.roughTilt.w>=2.5);
}
fn restPivot(i:u32)->vec3f {return metadata[i].a.xyz-vec3f(0,metadata[i].b.w*.5,0);}
fn leafPoint(i:u32,position:vec3f)->vec3f {return poses[i].a.xyz+rotatePointOrigin(position-restPivot(i),quatNormalize(poses[i].b));}
fn leafDirection(i:u32,direction:vec3f)->vec3f {return rotateDirection(direction,quatNormalize(poses[i].b));}
fn environment(direction:vec3f)->vec3f {
 let horizon=pow(1.0-abs(direction.y),3.0);
 // A finite sky/key source gives small curved interfaces a resolvable
 // reflection. Callers still weight this radiance by their material Fresnel.
 let sky=mix(vec3f(.08,.105,.14),vec3f(.45,.58,.72),clamp(direction.y*.5+.5,0.0,1.0));
 let light=pow(max(dot(direction,normalize(vec3f(-.4,1.0,-.2))),0.0),18.0);
 let window=pow(max(dot(direction,normalize(vec3f(.4,.5,1.0))),0.0),8.0);
 return sky+horizon*vec3f(.11,.12,.11)+light*vec3f(2.4,2.55,2.7)+window*vec3f(5.0,5.5,6.0);
}
fn heatColor(t:f32)->vec3f {
 let a=clamp((t-293.15)/1100.0,0.0,1.0);
 return mix(vec3f(.05,.15,.35),mix(vec3f(.95,.2,.035),vec3f(1.0,.95,.7),smoothstep(.4,1.0,a)),sqrt(a));
}
fn surfaceVertexValue(vertex:u32,instance:u32)->Vertex {
 let n=frame.counts.x;let domain=instance/(n*n);let local=instance%(n*n);let x=i32(local%n);let z=i32(local/n);
 let index=address(domain,x,z);let d=domains[domain];let state=fields[index];let q=QUAD[vertex%6u];
 let center=metadata[index].a.xz;var pos=center+q*d.sizeStep.zw*.5;
 let removed=removedDepth(index)*etchScale(index);let thickness=metadata[index].b.w*etchScale(index);
 var planeCenter=center;
 var result:Vertex;result.position=vec3f(pos.x,cellHeight(d,pos)-removed,pos.y);
 result.normal=normalize(vec3f(-tilt(d).x,1.0,-tilt(d).y));
 if(vertex>=6u){
  let side=(vertex-6u)/6u;var boundary=false;var neighbor=index;
  if(side==0u){planeCenter=center+vec2f(-.5,0)*d.sizeStep.zw;pos=center+vec2f(-.5,q.x*.5)*d.sizeStep.zw;result.normal=vec3f(-1,0,0);boundary=x==0;neighbor=address(domain,x-1,z);}
  if(side==1u){planeCenter=center+vec2f(.5,0)*d.sizeStep.zw;pos=center+vec2f(.5,q.x*.5)*d.sizeStep.zw;result.normal=vec3f(1,0,0);boundary=x==i32(n)-1;neighbor=address(domain,x+1,z);}
  if(side==2u){planeCenter=center+vec2f(0,-.5)*d.sizeStep.zw;pos=center+vec2f(q.x*.5,-.5)*d.sizeStep.zw;result.normal=vec3f(0,0,-1);boundary=z==0;neighbor=address(domain,x,z-1);}
  if(side==3u){planeCenter=center+vec2f(0,.5)*d.sizeStep.zw;pos=center+vec2f(q.x*.5,.5)*d.sizeStep.zw;result.normal=vec3f(0,0,1);boundary=z==i32(n)-1;neighbor=address(domain,x,z+1);}
  let shift=poses[index].a.xyz-restPivot(index);let neighborShift=poses[neighbor].a.xyz-restPivot(neighbor);
  let separated=length(shift-neighborShift)>.0005 || abs(dot(poses[index].b,poses[neighbor].b))<.9999;
  let bottom=select(removedDepth(neighbor)*etchScale(neighbor),thickness,boundary||separated);
  result.position=vec3f(pos.x,cellHeight(d,pos)-removed-(.5-q.y*.5)*max(0.0,bottom-removed),pos.y);
  if(bottom<=removed+.0000001){result.position=vec3f(center.x,cellHeight(d,center)-removed,center.y);}
 }
 result.materialPosition=result.position;result.position=leafPoint(index,result.position);result.normal=leafDirection(index,result.normal);
 // Each physical face has one plane, independent of its provoking vertex.
 // Transform that plane, not snapped viewport vertices, into clip space.
 let planeOrigin=leafPoint(index,vec3f(planeCenter.x,cellHeight(d,planeCenter)-removed,planeCenter.y));
 let worldPlane=vec4f(result.normal,-dot(result.normal,planeOrigin));
 let clipPlane=transpose(frame.inverseVP)*worldPlane;
 result.clipPlane=select(clipPlane,vec4f(0),any((bitcast<vec4u>(clipPlane)&vec4u(0x7f800000u))==vec4u(0x7f800000u)));
 result.clip=frame.vp*vec4f(result.position,1);
 result.uv=(pos-d.center.xz)/d.sizeStep.xy+.5;result.cell=index;result.domain=domain;result.effect=vec2f(0);return result;
}
@vertex fn surfaceVertex(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Vertex {
 return surfaceVertexValue(vertex,instance);
}
struct SurfaceFragment { @location(0) color:vec4f, @builtin(frag_depth) depth:f32 }
@fragment fn surfaceFragment(in:Vertex)->SurfaceFragment {
 let s=fields[in.cell];let d=domains[in.domain];let mode=u32(frame.viewportMode.z);var albedo=d.colorMetallic.rgb;
 let aux=auxiliary[in.cell];let thickness=metadata[in.cell].b.w;
 if(!hasSolid(in.cell)){discard;}
 var depth=in.clip.z;
 if(in.clipPlane.z!=0.0){
  let ndc=in.clip.xy/frame.viewportMode.xy*vec2f(2,-2)+vec2f(-1,1);
  let numerator=-(dot(in.clipPlane.xy,ndc)+in.clipPlane.w);
  // A finite plane hit outside [0,1] is outside the clip volume.
  // Comparing before division also avoids overflowing edge-on ratios.
  if((bitcast<u32>(numerator)&0x7f800000u)!=0x7f800000u){
   if((numerator<0.0 && in.clipPlane.z>0.0) || (numerator>0.0 && in.clipPlane.z<0.0) || abs(numerator)>abs(in.clipPlane.z)){discard;}
   depth=numerator/in.clipPlane.z;
  }
 }
 let erosion=clamp(removedDepth(in.cell)/thickness,0.0,1.0);
 let detail=frame.viewportMode.w;let wood=d.roughTilt.w<.5;
 var noise=.5;var grain=1.0;
 if(detail>=2.0){
  noise=noise2d(in.materialPosition.xz*34.0);
  let fiber=in.materialPosition.x*140.0+noise2d(in.materialPosition.xz*vec2f(1.8,.6))*3.2;
  grain=.975+.025*sin(fiber);
 }
 if(detail>=4.0){noise=mix(noise,noise2d(in.materialPosition.xz*110.0),.18);grain+=(noise2d(in.materialPosition.xz*vec2f(18.0,1.2))-.5)*.025;}
 albedo*=select(.975+noise*.05,grain,wood);
 albedo*=1.0-erosion*.16;albedo=mix(albedo,albedo*vec3f(.88,.91,.82),clamp(aux.a.w*100.0,0.0,.3));
 let wet=clamp(s.b.y*1.8+aux.a.y*85.0,0.0,1.0);albedo*=1.0-wet*.38;
 let residue=clamp(select(0.0,s.a.w,wood)+s.b.x*.85,0.0,1.0);albedo=mix(albedo,vec3f(.022,.017,.013),residue);
 albedo=mix(albedo,vec3f(.075,.055,.035),clamp(s.a.y*5.0,0.0,.55));
 let roughness=clamp(d.roughTilt.x+residue*.25+erosion*.24-wet*.3,.12,1.0);
 let view=normalize(frame.eyeTime.xyz-in.position);let light=normalize(vec3f(-.4,1.0,-.2));
 let normal=normalize(in.normal+vec3f((noise-.5)*residue*.12,0.0,(grain-1.0)*residue*.2));
 var color=albedo*vec3f(.15,.18,.22)+evaluatePBR(albedo,d.colorMetallic.w*(1.0-residue),roughness,normal,view,light)*vec3f(2.7,2.4,2.0);
 let fireOffset=surfaceFireLight.centreRadius.xyz-in.position;
 let fireDistance=length(fireOffset);
 if(surfaceFireLight.radiance.w>0.0 && fireDistance>.00001){
  let irradiance=min(vec3f(24),surfaceFireLight.radiance.rgb/max(fireDistance*fireDistance,surfaceFireLight.centreRadius.w*surfaceFireLight.centreRadius.w));
  color+=evaluatePBR(albedo,d.colorMetallic.w*(1.0-residue),roughness,normal,view,fireOffset/fireDistance)*irradiance;
 }
 if(mode==1u){color=mix(vec3f(.035,.045,.055),vec3f(.04,.6,1),clamp(s.a.x*100.0,0.0,1.0));}
 if(mode==2u){color=heatColor(s.a.z);}
 if(mode==3u){color=mix(vec3f(.02,.025,.03),vec3f(1,.63,.12),clamp(s.a.y*8.0,0.0,1.0));}
 if(mode==4u){color=mix(vec3f(.14,.3,.18),vec3f(.96,.12,.06),s.a.w);}
 if(mode==5u){color=mix(vec3f(.07,.07,.09),vec3f(.17,.69,.87),clamp(s.b.y*3.0,0.0,1.0));}
 if(mode==6u){color=mix(vec3f(.65,.64,.55),vec3f(.008),s.b.x);}
 var edge=min(min(in.uv.x,in.uv.y),min(1.0-in.uv.x,1.0-in.uv.y));
 if(frame.counts.w==1u){edge=min(edge,min(abs(in.uv.x-.5),abs(in.uv.y-.5)));}
 if(frame.controls.x>.5 && edge<.65/f32(frame.counts.x)){color=mix(color,vec3f(.1,.8,.95),.68);}
 let brushLocal=rotatePointOrigin(frame.brush.xyz-poses[in.cell].a.xyz,quatConjugate(quatNormalize(poses[in.cell].b)))+restPivot(in.cell);
 let brushDistance=length(in.materialPosition.xz-brushLocal.xz);
 if(frame.brush.w>0.0 && abs(brushDistance-frame.brush.w)<.007){color=mix(color,vec3f(1,.85,.35),.75);}
 var out:SurfaceFragment;out.color=vec4f(color,1);out.depth=depth;return out;
}
// Optical effervescence, driven only by the retained carbonate reaction. The
// total CO2 channel also contains oil exhaust and cannot identify acid attack.
// XY perturb the liquid normal; Z is pale bubble coverage; W is activity.
// This does not create gas, heat, mineral loss or an additional liquid volume.
fn acidReactionOptics(position:vec2f,time:f32,liquid:vec4f,retained:vec4f,detail:f32)->vec4f {
 if(liquid.x<=0.0 || liquid.z<=0.0 || retained.w<=0.0 || liquid.w>=1.0){return vec4f(0);}
 let activity=clamp(retained.w/ACID_REFERENCE_REACTION_RATE,0.0,1.0)
  *smoothstep(.000005,.00006,liquid.z)*(1.0-clamp(liquid.w,0.0,1.0));
 let phase=time*(.85+.65*activity);
 let coarse=bubblePattern(fract(position*5.0+vec2f(.19,.43)),phase,1.0);
 var fine=0.0;var disturbance=vec2f(0);
 if(detail>=2.0){
  fine=bubblePattern(fract(position*17.0+vec2f(.57,.13)),phase*1.37+2.6,1.0);
  disturbance=vec2f(sin(position.x*41.0+position.y*17.0+phase*5.1),
   cos(position.y*37.0-position.x*13.0-phase*4.3))*.065*activity;
 }
 let rim=smoothstep(.05,.42,coarse)*(1.0-smoothstep(.55,.98,coarse));
 let bubbles=clamp(coarse*.58+rim*.34+fine*.43,0.0,.85)*activity;
 return vec4f(disturbance,bubbles,activity);
}
@vertex fn waterVertex(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Vertex {
 var out=surfaceVertexValue(vertex,instance);out.position=out.materialPosition;
 let d=domains[out.domain];let n=frame.counts.x;let local=instance%(n*n);
 let x=i32(local%n);let z=i32(local/n);let q=QUAD[vertex];let cornerX=x+select(0,1,q.x>0.0);let cornerZ=z+select(0,1,q.y>0.0);
 let depth=liquidCorner(out.domain,cornerX,cornerZ);
 var dx=0.0;var dz=0.0;var ripple=0.0;
 if(frame.viewportMode.w>=2.0){
  dx=(liquidCorner(out.domain,cornerX+1,cornerZ)-liquidCorner(out.domain,cornerX-1,cornerZ))/(2.0*d.sizeStep.z);
  dz=(liquidCorner(out.domain,cornerX,cornerZ+1)-liquidCorner(out.domain,cornerX,cornerZ-1))/(2.0*d.sizeStep.w);
 }
 if(frame.viewportMode.w>=4.0){ripple=sin(out.position.x*14.0+frame.eyeTime.w*1.4)*sin(out.position.z*11.0-frame.eyeTime.w*1.1)*min(depth,.002)*.22;}
 out.position.y=cellHeight(d,out.position.xz)-removedDepth(out.cell)*etchScale(out.cell)+depth+.00015+ripple;
 out.normal=leafDirection(out.cell,normalize(vec3f(-tilt(d).x-dx,1.0,-tilt(d).y-dz)));out.effect=vec2f(depth,0);
 out.materialPosition=out.position;out.position=leafPoint(out.cell,out.position);
 out.clip=frame.vp*vec4f(out.position,1);return out;
}
@fragment fn waterFragment(in:Vertex)->@location(0) vec4f {
 let depth=in.effect.x;if(depth<.000025 || frame.viewportMode.z>.5){discard;}
 let aux=auxiliary[in.cell];let liquid=liquidProperties[in.cell];
 if(!hasSolid(in.cell)){discard;}
 // The HCl tint is a concentration diagnostic, including dilution and reagent
 // exhaustion. Oil occupies a separate upper film; extra water cannot dilute it.
 let acid=clamp(liquid.x/.30,0.0,1.0);let oil=clamp(liquid.w,0.0,1.0);
 let aqueousDepth=max(0.0,liquid.z);let oilDepth=max(0.0,aux.a.x);
 var rippleNormal=vec3f(0);
 if(frame.viewportMode.w>=2.0){
  let damp=smoothstep(.0001,.003,depth);let time=frame.eyeTime.w;
  rippleNormal.x=sin(in.materialPosition.x*23.0+in.materialPosition.z*8.0+time*1.9)*.026*damp;
  rippleNormal.z=cos(in.materialPosition.z*19.0-in.materialPosition.x*7.0-time*1.4)*.023*damp;
  if(frame.viewportMode.w>=4.0){rippleNormal+=vec3f(sin(in.materialPosition.z*61.0+time*3.1),0,cos(in.materialPosition.x*57.0-time*2.7))*.009*damp;}
 }
 let acidReaction=acidReactionOptics(in.materialPosition.xz,frame.eyeTime.w,liquid,aux.a,frame.viewportMode.w);
 rippleNormal+=vec3f(acidReaction.x,0,acidReaction.y);
 let normal=normalize(in.normal+leafDirection(in.cell,rippleNormal));let view=normalize(frame.eyeTime.xyz-in.position);let facing=max(dot(normal,view),.001);
 let screenUV=in.clip.xy/frame.viewportMode.xy;
 let offset=normal.xz*clamp(depth*1.8+.002,0.0,.025);
 let refracted=textureSampleLevel(scene,sceneSampler,clamp(screenUV+offset,vec2f(.002),vec2f(.998)),0).rgb;
 let aqueousAbsorption=mix(vec3f(14,5,2),ACID_ABSORPTION*45.0,acid);
 let transmission=exp(-aqueousAbsorption*aqueousDepth/facing);
 let aqueousIor=mix(1.333,ACID_IOR,acid);let ior=mix(aqueousIor,OIL_IOR,oil);let f0=pow((ior-1.0)/(ior+1.0),2.0);
 let reflection=environment(reflect(-view,normal));let fresnel=fresnelSchlickF0(facing,f0);
 let light=normalize(vec3f(-.4,1.0,-.2));let gloss=mix(mix(260.0,160.0,acid),80.0,oil);
 let glint=pow(max(dot(reflect(-light,normal),view),0.0),gloss)*2.2;
 let tint=mix(vec3f(.045,.16,.2),ACID_COLOR,acid);
 let acidTintWeight=acid*.42*(1.0-exp(-aqueousDepth*800.0));
 var color=mix(tint,refracted,transmission*(1.0-acidTintWeight));
 // CO2 interfaces scatter reflected light; they are not green emission or
 // lasting foam after the finite reagent/mineral reaction has stopped.
 color=mix(color,vec3f(.83,.89,.82),acidReaction.z);
 let oilTransmission=exp(-OIL_ABSORPTION*800.0*oilDepth/facing);
 color=mix(color,mix(OIL_COLOR,color,oilTransmission),oil);
 return vec4f(mix(color,reflection,fresnel)+glint*vec3f(1,.9,.7),1);
}
@vertex fn rainVertex(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Vertex {
 let domain=frame.detail.y;let d=domains[domain];let q=QUAD[vertex];
 // Lifetime and position use different PCG draws. Reusing X/Z as phase and
 // speed places every drop on moving diagonal sheets, despite hashed seeds.
 var random=legacyPcgHash32(instance*7919u+domain*104729u+93u);
 let offset=legacyPcgHashStepRandomFloat01(&random);
 let rate=mix(1.6,2.35,legacyPcgHashStepRandomFloat01(&random));
 let age=max(0.0,frame.controls.w)*rate+offset;let phase=fract(age);
 // Recycle at a fresh position only after the fall and impact finish. Within
 // a lifetime, X/Z stay fixed and world gravity defines the streak axis.
 random=legacyPcgHash32(random^(u32(floor(age))*277803737u));
 let u=legacyPcgHashStepRandomFloat01(&random);let v=legacyPcgHashStepRandomFloat01(&random);
 let shape=legacyPcgHashStepRandomFloat01(&random);
 let uv=vec2f(u,v)*.96+.02;let xz=d.center.xz+(uv-.5)*d.sizeStep.xy;
 let cell=address(domain,i32(uv.x*f32(frame.counts.x)),i32(uv.y*f32(frame.counts.x)));
 let surfaceY=cellHeight(d,xz)-removedDepth(cell)*etchScale(cell)+liquidDepth(cell)+.0004;
 let impact=leafPoint(cell,vec3f(xz.x,surfaceY,xz.y));let halfLength=mix(.035,.065,shape);
 let base=impact+vec3f(0,(1.0-min(1.0,phase/.88))*1.8+halfLength,0);
 let right=pbrNormalizeOrFallback(vec3f(frame.eyeTime.z-base.z,0,base.x-frame.eyeTime.x),vec3f(1,0,0));
 var world=base+right*q.x*mix(.002,.0032,shape)+vec3f(0,q.y*halfLength,0);
 let splash=phase>=.88;
 if(splash){
  let radius=mix(.004,.042,(phase-.88)/.12);let local=xz+q*radius;
  world=leafPoint(cell,vec3f(local.x,surfaceY+dot(local-xz,tilt(d)),local.y));
 }
 var out:Vertex;out.clip=frame.vp*vec4f(world,1);out.position=world;out.materialPosition=world;out.normal=vec3f(0,1,0);out.uv=q*.5+.5;
 out.cell=cell;out.domain=domain;
 out.effect=vec2f(phase,select(0.0,1.0,splash));return out;
}
@fragment fn rainFragment(in:Vertex)->@location(0) vec4f {
 if(metadata[in.cell].b.y<.5){discard;}
 if(in.effect.y>.5){
  if(!hasSolid(in.cell)){discard;}
  let age=clamp((in.effect.x-.88)/.12,0.0,1.0);let circle=length(in.uv*2.0-1.0);
  let ring=1.0-smoothstep(.045,.16,abs(circle-.72));
  return vec4f(.63,.81,.92,ring*(1.0-age)*.28);
 }
 let alpha=(1.0-abs(in.uv.x*2.0-1.0))*smoothstep(0.0,.12,in.uv.y)*(1.0-smoothstep(.76,1.0,in.uv.y))*.48;
 return vec4f(.64,.81,.93,alpha);
}
struct Fullscreen { @builtin(position) clip:vec4f, @location(0) uv:vec2f }
@vertex fn fullscreenVertex(@builtin(vertex_index) index:u32)->Fullscreen {
 let uv=vec2f(f32((index<<1u)&2u),f32(index&2u));var out:Fullscreen;
 out.clip=vec4f(uv*vec2f(2,-2)+vec2f(-1,1),.9999,1);out.uv=uv;return out;
}
@fragment fn skyFragment(in:Fullscreen)->@location(0) vec4f {
 let color=mix(vec3f(.023,.032,.045),vec3f(.08,.12,.17),1.0-in.uv.y);
 return vec4f(color,1);
}
@fragment fn copyFragment(in:Fullscreen)->@location(0) vec4f {return textureSampleLevel(scene,sceneSampler,in.uv,0);}
`;
