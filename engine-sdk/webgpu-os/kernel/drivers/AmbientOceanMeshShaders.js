// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { AMBIENT_RUNTIME_V3_FRAME_WGSL, AMBIENT_RUNTIME_V3_PRESENT_WGSL } from '../schema/AmbientRuntimeV3Contract.js';
import { assertAmbientNativeAppearanceFunctions, extractAmbientWgslFunctions } from '../schema/AmbientNativeAppearance.js';
import { AMBIENT_OCEAN_SURFACE_WGSL, AMBIENT_OCEAN_WHITEWATER_WGSL } from './AmbientOceanSurface.js';
import { noise3dWGSL } from '../../../engine/render/shaders/modules/chunks/noise3d.js';
import { waterFieldBindingsWGSL, WATER_FIELD_SAMPLE_WGSL } from '../../../engine/render/water/WaterFieldShaders.js';
import { readOceanWaterFieldRecipe } from '../../factory/apps/ambient-studio/AmbientOceanWaterField.js';
import { AMBIENT_COLLECTION_MATERIAL_TYPES_WGSL } from '../../factory/apps/ambient-studio/AmbientMaterialShaders.js';

const optics = extractAmbientWgslFunctions(AMBIENT_OCEAN_SURFACE_WGSL).filter(fn => ['ambientOceanSchlick', 'ambientOceanDistribution', 'ambientOceanMasking', 'ambientOceanVisibility', 'ambientOceanFresnel', 'ambientOceanMoonSpecular'].includes(fn.name)).map(fn => fn.source).join('\n');
const noise = extractAmbientWgslFunctions(AMBIENT_OCEAN_WHITEWATER_WGSL).filter(fn => ['ambientOceanFoamFract', 'ambientOceanFoamFract2', 'ambientOceanFoamHash', 'ambientOceanFoamNoise'].includes(fn.name)).map(fn => fn.source).join('\n');
const foamPatch = extractAmbientWgslFunctions(AMBIENT_OCEAN_WHITEWATER_WGSL).find(fn => fn.name === 'ambientOceanFoamPatch').source;
const cloudNoise = extractAmbientWgslFunctions(noise3dWGSL).filter(fn => ['noise3dFractScalar', 'noise3dFractVec', 'hash3d', 'noise3d', 'fbm3d'].includes(fn.name)).map(fn => fn.name === 'fbm3d' ? fn.source.replace('i < octaves', 'i < 4').replace('i = i + 1', 'i += 1').replace('value = value + amplitude', 'if (i >= octaves) { break; }\n    value = value + amplitude') : fn.source).join('\n');

/** Factory source only. The compiler persists these functions in connected
 * nodes; the renderer executes the saved source without a preset-name switch. */
export const AMBIENT_OCEAN_LOOK_FUNCTIONS = /* wgsl */`
${optics}
${noise}
${foamPatch}
${cloudNoise}
fn oceanCamera()->vec4f { return vec4f(2.1,0.07,1.35,0.0); }
fn oceanMeshSettings()->vec4f { return vec4f(0.25,2000.0,1.0,1.0); }
fn oceanMeshDistance(fraction:f32)->f32 {
 let settings=oceanMeshSettings();let camera=oceanCamera();
 let nearDistance=max(clamp(settings.x,0.08,2.0),max(camera.x,0.4)*0.55/(1.0/max(camera.z,0.4)+max(sin(camera.y),0.0)));
 let farDistance=clamp(settings.y,100.0,4000.0);
 // Allocate rings in projected height: visible foreground receives triangles
 // instead of spending most rows below the camera or at a subpixel horizon.
 return nearDistance*farDistance/mix(farDistance,nearDistance,clamp(fraction,0.0,1.0));
}
fn oceanViewRay(uv:vec2f,aspect:f32)->vec3f {
 let camera=oceanCamera(); let pitch=clamp(camera.y,-0.35,0.6);
 let local=normalize(vec3f((uv.x*2.0-1.0)*aspect,1.0-uv.y*2.0,max(camera.z,0.4)));
 return vec3f(local.x,local.y*cos(pitch)-local.z*sin(pitch),local.y*sin(pitch)+local.z*cos(pitch));
}
fn oceanProject(world:vec3f,aspect:f32)->vec4f {
 let camera=oceanCamera();let pitch=clamp(camera.y,-0.35,0.6);
 let relative=world-vec3f(0.0,max(camera.x,0.4),camera.w);
 let eye=vec3f(relative.x,relative.y*cos(pitch)+relative.z*sin(pitch),relative.z*cos(pitch)-relative.y*sin(pitch));
 let farPlane=10000.0;let nearPlane=0.05;
 return vec4f(eye.x*max(camera.z,0.4)/max(aspect,0.1),eye.y*max(camera.z,0.4),farPlane*(eye.z-nearPlane)/(farPlane-nearPlane),eye.z);
}
fn oceanSunDirection()->vec3f { return normalize(vec3f(0.48,0.34,0.81)); }
fn oceanSunRadiance()->vec3f { return vec3f(5.0,4.6,3.8); }
fn oceanSunVisibility()->f32 {return oceanCloudLayer(oceanSunDirection(),3u).w;}
fn oceanCloudNoise(p:vec2f)->f32 {
 var q=p;var value=0.0;var weight=0.55;
 for(var i=0;i<5;i++){value+=ambientOceanFoamNoise(q)*weight;q=vec2f(q.x*1.71-q.y*1.19,q.x*1.19+q.y*1.71)+vec2f(7.8,3.1);weight*=0.48;}
 return value;
}
fn oceanCloudSettings()->vec4f { return vec4f(0.64,2.2,3.0,0.45); }
fn oceanCloudDensity(point:vec3f)->f32 {
 let settings=oceanCloudSettings();if(settings.x<=0.0){return 0.0;}
 let layer=smoothstep(0.0,0.18,point.y)*(1.0-smoothstep(0.55,1.0,point.y));
 let drift=ambientV3Frame.resolutionTime.z*ambientV3Frame.tone.x*0.002;
 let p=point*vec3f(settings.y,2.8,settings.y)+vec3f(settings.w+drift,0.0,settings.w*7.3);
 let shape=fbm3d(p,3);
 let threshold=mix(0.64,0.25,clamp(settings.x,0.0,1.0));
 return max(0.0,shape-threshold)*layer*settings.z;
}
fn oceanCloudLayer(direction:vec3f,steps:u32)->vec4f {
 // A finite cloud slab, lit through its density rather than a flat sky mask.
 let d=normalize(direction);if(d.y<=-0.12){return vec4f(0.0,0.0,0.0,1.0);}
 let settings=oceanCloudSettings();let horizonDetail=smoothstep(0.04,0.12,d.y);
 let cloudColor=vec3f(0.78,0.82,0.83);
 // At grazing angles the cloud slab becomes unresolved. Fade its variation
 // into average extinction instead of erasing the clouds into a clear band.
 let coverage=clamp(settings.x,0.0,1.0);let threshold=mix(0.64,0.25,coverage);
 let meanDensity=max(0.025*coverage,0.4375-threshold)*settings.z*0.45;
 let meanTransmission=exp(-meanDensity*24.0);
 let meanRadiance=(cloudColor*0.53+oceanSunRadiance()*0.10*exp(-meanDensity*1.1))*(1.0-meanTransmission);
 if(d.y<=0.0){
  let lowerFade=smoothstep(-0.12,0.0,d.y);
  return vec4f(meanRadiance*lowerFade,mix(1.0,meanTransmission,lowerFade));
 }
 let count=clamp(steps,1u,8u);let stride=1.0/f32(count);let light=oceanSunDirection();
 var transmission=1.0;var radiance=vec3f(0.0);
 for(var i=0u;i<8u;i+=1u){
  if(i>=count){break;}
  let height=(f32(i)+0.5)*stride;let point=vec3f(d.x*(0.75+height)/max(d.y,0.04),height,d.z*(0.75+height)/max(d.y,0.04));
  let density=oceanCloudDensity(point);let optical=density*stride/max(d.y,0.12)*3.2;
  var visibility=exp(-density*1.1);
  if(steps>3u){visibility=exp(-oceanCloudDensity(point+light*0.22)*1.8-oceanCloudDensity(point+light*0.55)*0.9);}
  let forward=pow(max(dot(d,light),0.0),8.0);
  let illumination=cloudColor*(0.28+0.5*height)+oceanSunRadiance()*(0.10+0.16*forward)*visibility;
  let opacity=1.0-exp(-optical);radiance+=transmission*opacity*illumination;transmission*=1.0-opacity;
 }
 return vec4f(mix(meanRadiance,radiance,horizonDetail),mix(meanTransmission,transmission,horizonDetail));
}
fn oceanClearSky(direction:vec3f)->vec3f {
 let d=normalize(direction);let height=clamp(d.y,0.0,1.0);
 let horizon=vec3f(0.52,0.68,0.74);let zenith=vec3f(0.11,0.32,0.54);
 var color=mix(horizon,zenith,pow(height,0.42));
 let sunlight=pow(max(dot(d,oceanSunDirection()),0.0),16.0);
 color+=oceanSunRadiance()*sunlight*0.018;
 return mix(vec3f(0.08,0.17,0.2),color,smoothstep(-0.12,0.01,d.y));
}
fn oceanAtmosphere(direction:vec3f)->vec3f {
 let clouds=oceanCloudLayer(direction,3u);
 return oceanClearSky(direction)*clouds.w+clouds.rgb;
}
fn oceanSky(direction:vec3f)->vec3f {
 let alignment=dot(normalize(direction),oceanSunDirection());
 let clouds=oceanCloudLayer(direction,8u);
 return oceanClearSky(direction)*clouds.w+clouds.rgb+oceanSunRadiance()*smoothstep(0.99994,0.999975,alignment)*2.0*oceanSunVisibility();
}
fn oceanWaterMaterial()->vec4f { return vec4f(0.014,0.105,0.135,0.14); }
fn oceanRippleSettings()->vec4f {return vec4f(0.16,1.0,1.15,1.0);}
fn oceanRippleDirection()->f32 {return 0.15;}
fn oceanRippleMode(index:u32)->vec4f {
 let i=f32(index);let settings=oceanRippleSettings();
 let wavelength=1.3*pow(0.76,i)*max(settings.y,0.3);let k=6.28318530718/wavelength;
 let angle=oceanRippleDirection()+sin(i*2.39996323+0.4)*settings.z;
 return vec4f(k*cos(angle),k*sin(angle),0.40824829,fract(i*0.75487766)*6.28318530718);
}
fn oceanRippleSlope(point:vec2f,time:f32,footprint:vec4f)->vec3f {
 let settings=oceanRippleSettings();let strength=settings.x*settings.w;
 var slope=vec2f(0.0);var variance=0.0;
 for(var i=0u;i<12u;i+=1u){
  let mode=oceanRippleMode(i);let k=length(mode.xy);if(k<=0.0){continue;}
  let phaseFootprint=max(abs(dot(mode.xy,footprint.xy)),abs(dot(mode.xy,footprint.zw)));
  let resolved=1.0-smoothstep(0.5,2.0,phaseFootprint);let amplitude=strength*mode.z;
  let phase=dot(point,mode.xy)-sqrt(9.81*k+0.000074*k*k*k)*time+mode.w;
  slope+=mode.xy/k*amplitude*cos(phase)*resolved;
  variance+=0.5*amplitude*amplitude*(1.0-resolved*resolved);
 }
 return vec3f(slope,variance);
}
fn oceanFoamColor(normal:vec3f)->vec3f {
 let indirect=oceanAtmosphere(vec3f(normal.x,max(normal.y,0.3),normal.z));
 return (indirect*0.75+oceanSunRadiance()*oceanSunVisibility()*(0.12+max(dot(normal,oceanSunDirection()),0.0)*0.20))*vec3f(0.94,0.97,1.0)*0.95;
}
fn oceanFoamCoverage(coverage:f32,point:vec2f,footprint:f32)->f32 {
 let amount=clamp(coverage,0.0,1.0);let scale=10.0;let breakup=0.85;
 if(amount<=0.0){return 0.0;}
 let frequency=scale*6.0;let resolved=1.0-smoothstep(0.5,2.0,max(footprint,0.0)*frequency);
 let p=point*frequency;let cell=floor(p);var nearestPore=10.0;
 for(var y=0;y<3;y+=1){for(var x=0;x<3;x+=1){
  let offset=vec2f(f32(x-1),f32(y-1));let seed=cell+offset;
  let center=offset+vec2f(hash3d(vec3f(seed,0.0)),hash3d(vec3f(seed+vec2f(47.1,19.7),1.0)))*0.75+vec2f(0.125);
  let radius=0.14+hash3d(vec3f(seed+vec2f(11.8,71.3),2.0))*0.22;
  nearestPore=min(nearestPore,length(center-fract(p))/radius);
 }}
 let poreEdge=clamp(max(footprint,0.0)*frequency*3.0,0.08,0.35);
 let pores=smoothstep(1.0-poreEdge,1.0+poreEdge,nearestPore);
 let clusterNoise=ambientOceanFoamNoise(point*1.1+vec2f(8.7,3.2));
 let edge=max(0.025,max(footprint,0.0)*1.8);
 let clusters=smoothstep(1.0-amount-edge,1.0-amount+edge,clusterNoise);
 // Smooth population onset prevents isolated bright pores from appearing
 // abruptly when a previously empty field receives a tiny foam deposit.
 let texture=clusters*(0.20+0.80*pores)*smoothstep(0.0,0.08,amount);
 // The stored field is bubble population. Near detail resolves into porous
 // crest fragments; unresolved bubbles return to their filtered population.
 return mix(amount*amount*0.55,texture,clamp(breakup,0.0,1.0)*resolved);
}
fn oceanWaterColor(world:vec3f,surfaceNormal:vec3f,view:vec3f,variance:f32,foam:f32)->vec3f {
 // Fine wave slopes must not shade the back of a visible mesh triangle.
 // Preserve detail except at grazing silhouettes, where its normal is bent
 // toward the actual rasterized surface rather than reflecting the underside.
 let footprint=vec4f(dpdx(world.xz),dpdy(world.xz));
 let ripple=oceanRippleSlope(world.xz,ambientV3Frame.resolutionTime.z*ambientV3Frame.tone.x,footprint);
 let detailed=normalize(surfaceNormal-vec3f(ripple.x,0.0,ripple.y)*max(surfaceNormal.y,0.05));
 let raw=cross(dpdx(world),dpdy(world));let plane=raw/max(length(raw),0.000001);
 let geometric=select(-plane,plane,dot(plane,view)>=0.0);
 let facingGeometry=max(dot(geometric,view),0.0);
 let detailWeight=clamp((facingGeometry-0.008)/max(facingGeometry-dot(detailed,view),0.00001),0.0,1.0);
 let normal=normalize(mix(geometric,detailed,detailWeight));
 let material=oceanWaterMaterial();let facing=max(dot(normal,view),0.001);
 let reflected=reflect(-view,normal);let slopeVariance=max(variance+ripple.z,0.0);
 let roughness=clamp(pow(pow(material.w,4.0)+slopeVariance*0.40,0.25),0.06,0.7);
 let axis=normalize(cross(reflected,select(vec3f(0.0,1.0,0.0),vec3f(1.0,0.0,0.0),abs(reflected.y)>0.95)));
 let across=cross(reflected,axis);let spread=roughness*roughness*0.85;
 let reflection=(oceanAtmosphere(reflected)*2.0+oceanAtmosphere(normalize(reflected+axis*spread))+oceanAtmosphere(normalize(reflected-axis*spread))+oceanAtmosphere(normalize(reflected+across*spread))+oceanAtmosphere(normalize(reflected-across*spread)))/6.0;
 let fresnel=ambientOceanFresnel(facing);
 let backlight=pow(max(dot(-view,oceanSunDirection()),0.0),5.0);
 let crest=smoothstep(-0.1,0.65,world.y)*backlight;
 let body=material.rgb*(0.5+0.5*max(normal.y,0.0))+vec3f(0.015,0.11,0.09)*crest;
 let glint=ambientOceanMoonSpecular(normal,view,oceanSunDirection(),roughness,0.0);
 let water=body*(1.0-fresnel)+reflection*fresnel+oceanSunRadiance()*oceanSunVisibility()*glint;
 if(foam<=0.0){return water;}
 return mix(water,oceanFoamColor(normal),clamp(foam,0.0,1.0));
}
fn oceanDisplayTransfer(color:vec3f)->vec3f {
 let linear=clamp(color,vec3f(0.0),vec3f(1.0));
 return select(linear*12.92,1.055*pow(linear,vec3f(1.0/2.4))-vec3f(0.055),linear>vec3f(0.0031308));
}
fn oceanSplashColor(normal:vec3f,view:vec3f,ageFraction:f32)->vec4f {
 let edge=pow(1.0-max(dot(normal,view),0.0),3.0);
 return vec4f(mix(oceanFoamColor(normal),oceanAtmosphere(reflect(-view,normal)),edge*0.25),0.72*(1.0-smoothstep(0.65,1.0,ageFraction)));
}
fn oceanSplashRadius()->f32 {return 0.025;}
fn oceanHaze(color:vec3f,direction:vec3f,distance:f32)->vec3f {
 let farFade=smoothstep(oceanMeshSettings().y*0.65,oceanMeshSettings().y*0.98,distance);
 return mix(color,oceanAtmosphere(direction),max(farFade,1.0-exp(-distance*0.0008)));
}
`;

export const AMBIENT_OCEAN_MESH_MAX_RINGS = 128;
export const AMBIENT_OCEAN_MESH_MAX_SEGMENTS = 192;

/** Trusted resource declarations and entrypoints. Struct/sample source is
 * supplied by the engine spectrum ABI; all artistic functions come from nodes. */
export function buildAmbientOceanMeshSources(plan, typesWGSL) {
    const functions = plan?.appearance?.renderFunctions;
    assertAmbientNativeAppearanceFunctions(functions);
    // Saved graphs keep their original source. Older documents can omit newer
    // authoring hooks; retain their previous entrypoint behavior in that case.
    const authored = new Set(extractAmbientWgslFunctions(functions).map(fn => fn.name));
    const waterFieldRecipe = readOceanWaterFieldRecipe(functions);
    const frame = `${AMBIENT_RUNTIME_V3_FRAME_WGSL}\n@group(0) @binding(0) var<uniform> ambientV3Frame:AmbientV3Frame;`;
    const fieldSource = waterFieldRecipe ? `${waterFieldBindingsWGSL(1)}\n${WATER_FIELD_SAMPLE_WGSL}\nvar<private> oceanCurrentField:WaterFieldSample;\nvar<private> oceanCurrentFoamAge:f32;` : '';
    const valueTypes = /\bCollectionMaterial\b/.test(functions) ? AMBIENT_COLLECTION_MATERIAL_TYPES_WGSL : '';
    const shared = `${frame}\n${typesWGSL}\n${valueTypes}\n${fieldSource}\n${functions}`;
    const geometry = waterFieldRecipe ? /* wgsl */`
struct OceanMeshVertex { @builtin(position) position:vec4f, @location(0) rest:vec2f, @location(1) world:vec3f, }
@vertex fn oceanMeshVertex(@location(0) local:vec4f)->OceanMeshVertex {
 let coordinate=oceanClipmapCoordinate(local);let rest=coordinate.xy;
 let aspect=ambientV3Frame.resolutionTime.x/max(ambientV3Frame.resolutionTime.y,1.0);
 let wave=oceanSpectrumSample(rest,ambientV3Frame.resolutionTime.z,coordinate.z);
 var output:OceanMeshVertex;output.rest=rest;output.world=vec3f(rest.x,0.0,rest.y)+wave.displacement;
 output.position=oceanProject(output.world,aspect);
 if(coordinate.w<=0.0){output.position=vec4f(2.0,2.0,2.0,1.0);}return output;
}
` : /* wgsl */`
struct OceanMeshVertex { @builtin(position) position:vec4f, @location(0) rest:vec2f, @location(1) world:vec3f, }
@vertex fn oceanMeshVertex(@builtin(vertex_index) index:u32)->OceanMeshVertex {
 let settings=oceanMeshSettings();let camera=oceanCamera();let aspect=ambientV3Frame.resolutionTime.x/max(ambientV3Frame.resolutionTime.y,1.0);
 let detail=clamp(settings.z,0.25,1.0);
 let segments=u32(clamp(ambientV3Frame.resolutionTime.x*detail/7.0,48.0,192.0));
 let rings=u32(clamp(ambientV3Frame.resolutionTime.y*detail/5.0,40.0,128.0));
 let quad=index/6u;let corner=array<vec2u,6>(vec2u(0,0),vec2u(1,0),vec2u(1,1),vec2u(0,0),vec2u(1,1),vec2u(0,1))[index%6u];
 let row=quad/segments;let column=quad%segments;
 var output:OceanMeshVertex;
 if(row>=rings||settings.w<=0.0){output.position=vec4f(2.0,2.0,2.0,1.0);output.rest=vec2f(0.0);output.world=vec3f(0.0);return output;}
 ${authored.has('oceanMeshDistance') ? 'let fraction=f32(row+corner.y)/f32(rings);let distance=oceanMeshDistance(fraction);' : 'let radialRatio=clamp(settings.y,100.0,4000.0)/clamp(settings.x,0.08,2.0);let distance=clamp(settings.x,0.08,2.0)*pow(radialRatio,f32(row+corner.y)/f32(rings));'}
 let halfAngle=min(1.53,atan(aspect/max(camera.z,0.4))+0.25);
 let angle=(f32(column+corner.x)/f32(segments)*2.0-1.0)*halfAngle;
 let rest=vec2f(sin(angle)*distance,cos(angle)*distance+camera.w);
 ${authored.has('oceanMeshDistance') ? 'let previous=oceanMeshDistance(max(0.0,fraction-1.0/f32(rings)));let next=oceanMeshDistance(min(1.0,fraction+1.0/f32(rings)));let footprint=max((next-previous)*0.5,distance*halfAngle*2.0/f32(segments))*0.65;' : 'let footprint=max(distance*(pow(radialRatio,1.0/f32(rings))-1.0),distance*halfAngle*2.0/f32(segments))*0.65;'}
 let time=ambientV3Frame.resolutionTime.z*ambientV3Frame.tone.x;
 let wave=oceanSpectrumSample(rest,time,footprint);
 output.world=vec3f(rest.x,0.0,rest.y)+wave.displacement;
 output.position=oceanProject(output.world,aspect);output.rest=rest;return output;
}
`;
    const render = /* wgsl */`
@group(0) @binding(1) var oceanFoamTexture:texture_2d<f32>;
fn oceanReadFoam(rest:vec2f)->f32 {
 let domain=oceanFoamDomain();let uv=(rest-domain.xy)/max(domain.zw,vec2f(0.1));
 let size=vec2i(textureDimensions(oceanFoamTexture));let pixel=uv*vec2f(size)-vec2f(0.5);let base=vec2i(floor(pixel));let f=fract(pixel);
 let a=textureLoad(oceanFoamTexture,clamp(base,vec2i(0),size-1),0).x;
 let b=textureLoad(oceanFoamTexture,clamp(base+vec2i(1,0),vec2i(0),size-1),0).x;
 let c=textureLoad(oceanFoamTexture,clamp(base+vec2i(0,1),vec2i(0),size-1),0).x;
 let d=textureLoad(oceanFoamTexture,clamp(base+vec2i(1,1),vec2i(0),size-1),0).x;
 let edge=smoothstep(0.0,0.035,min(min(uv.x,uv.y),min(1.0-uv.x,1.0-uv.y)));
 return mix(mix(a,b,f.x),mix(c,d,f.x),f.y)*edge;
}
@fragment fn oceanMeshFragment(input:OceanMeshVertex)->@location(0) vec4f {
 let footprint=max(length(dpdx(input.rest)),length(dpdy(input.rest)));
 let time=ambientV3Frame.resolutionTime.z*ambientV3Frame.tone.x;
 ${waterFieldRecipe ? 'oceanCurrentField=waterFieldSampleGrad(input.rest,time,dpdx(input.rest),dpdy(input.rest));let wave=oceanFromWaterField(oceanCurrentField);oceanCurrentFoamAge=oceanReadFoamAge(input.rest);' : authored.has('oceanSpectrumSampleGrad') ? 'let wave=oceanSpectrumSampleGrad(input.rest,time,dpdx(input.rest),dpdy(input.rest));' : 'let wave=oceanSpectrumSample(input.rest,time,footprint);'}
 let camera=oceanCamera();let eye=vec3f(0.0,max(camera.x,0.4),camera.w);
 let view=normalize(eye-input.world);let normal=wave.normal;
 ${waterFieldRecipe ? `// Resolve normals against the rasterized facet at grazing silhouettes.
 let raw=cross(dpdx(input.world),dpdy(input.world));let plane=raw/max(length(raw),0.000001);
 let geometric=select(-plane,plane,dot(plane,view)>=0.0);let facing=max(dot(geometric,view),0.0);
 let weight=clamp((facing-0.008)/max(facing-dot(normal,view),0.00001),0.0,1.0);
 oceanCurrentField.normal=normalize(mix(geometric,normal,weight));` : ''}
 ${authored.has('oceanFoamCoverage') ? 'let foam=oceanFoamCoverage(oceanReadFoam(input.rest),input.rest,footprint);' : 'let foam=oceanReadFoam(input.rest);'}
 let color=oceanWaterColor(input.world,normal,view,wave.unresolvedVariance,foam);
 return vec4f(oceanHaze(color,normalize(input.world-eye),length(eye-input.world)),1.0);
}
`;
    const foamAge = waterFieldRecipe ? /* wgsl */`
fn oceanReadFoamAge(rest:vec2f)->f32 {
 let domain=oceanFoamDomain();let uv=(rest-domain.xy)/max(domain.zw,vec2f(0.1));
 let size=vec2i(textureDimensions(oceanFoamTexture));let pixel=uv*vec2f(size)-vec2f(0.5);let base=vec2i(floor(pixel));let f=fract(pixel);
 let a=textureLoad(oceanFoamTexture,clamp(base,vec2i(0),size-1),0).y;
 let b=textureLoad(oceanFoamTexture,clamp(base+vec2i(1,0),vec2i(0),size-1),0).y;
 let c=textureLoad(oceanFoamTexture,clamp(base+vec2i(0,1),vec2i(0),size-1),0).y;
 let d=textureLoad(oceanFoamTexture,clamp(base+vec2i(1,1),vec2i(0),size-1),0).y;
 return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
` : '';
    const sky = /* wgsl */`
@vertex fn oceanSkyVertex(@builtin(vertex_index) index:u32)->@builtin(position) vec4f {
 let p=array<vec2f,3>(vec2f(-1.0,-1.0),vec2f(3.0,-1.0),vec2f(-1.0,3.0))[index];return vec4f(p,0.999999,1.0);
}
@fragment fn oceanSkyFragment(@builtin(position) pixel:vec4f)->@location(0) vec4f {
 let size=ambientV3Frame.resolutionTime.xy;return vec4f(oceanSky(oceanViewRay(pixel.xy/size,size.x/max(size.y,1.0))),1.0);
}
`;
    const splashes = /* wgsl */`
struct OceanSplashParticle {positionAge:vec4f,velocityLife:vec4f,}
@group(0) @binding(2) var<storage,read> oceanSplashParticles:array<OceanSplashParticle>;
struct OceanSplashVertex { @builtin(position) position:vec4f,@location(0) local:vec2f,@location(1) center:vec3f,@location(2) age:f32,@location(3) radius:f32, }
@vertex fn oceanSplashVertex(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->OceanSplashVertex {
 let particle=oceanSplashParticles[instance];let corner=array<vec2f,6>(vec2f(-1.0,-1.0),vec2f(1.0,-1.0),vec2f(1.0,1.0),vec2f(-1.0,-1.0),vec2f(1.0,1.0),vec2f(-1.0,1.0))[vertex];
 let camera=oceanCamera();let aspect=ambientV3Frame.resolutionTime.x/max(ambientV3Frame.resolutionTime.y,1.0);let pitch=clamp(camera.y,-0.35,0.6);
 let radius=clamp(oceanSplashRadius(),0.001,0.15);let world=particle.positionAge.xyz+vec3f(corner.x,corner.y*cos(pitch),corner.y*sin(pitch))*radius;
 var out:OceanSplashVertex;out.position=oceanProject(world,aspect);out.local=corner;out.center=particle.positionAge.xyz;
 out.age=particle.positionAge.w/max(particle.velocityLife.w,0.0001);out.radius=radius;
 if(particle.velocityLife.w<=0.0||particle.positionAge.w<0.0||out.age>=1.0||oceanSplashSettings().x<=0.0){out.position=vec4f(2.0,2.0,2.0,1.0);}return out;
}
struct OceanSplashFragment { @location(0) color:vec4f,@builtin(frag_depth) depth:f32, }
@fragment fn oceanSplashFragment(input:OceanSplashVertex)->OceanSplashFragment {
 let r2=dot(input.local,input.local);if(r2>=1.0){discard;}
 let camera=oceanCamera();let pitch=clamp(camera.y,-0.35,0.6);let height=sqrt(1.0-r2);
 let normal=vec3f(input.local.x,input.local.y*cos(pitch)+height*sin(pitch),input.local.y*sin(pitch)-height*cos(pitch));
 let world=input.center+normal*input.radius;let eye=vec3f(0.0,max(camera.x,0.4),camera.w);let view=normalize(eye-world);
 let clip=oceanProject(world,ambientV3Frame.resolutionTime.x/max(ambientV3Frame.resolutionTime.y,1.0));
 var out:OceanSplashFragment;out.depth=clamp(clip.z/clip.w,0.0,1.0);out.color=oceanSplashColor(normal,view,input.age);return out;
}
`;
    const present = `${shared}\n${AMBIENT_RUNTIME_V3_PRESENT_WGSL}
@group(0) @binding(1) var oceanColor:texture_2d<f32>;
${sky.slice(0, sky.indexOf('@fragment'))}
@fragment fn oceanPresent(@builtin(position) pixel:vec4f)->@location(0) vec4f {
 let size=vec2i(textureDimensions(oceanColor));let uv=pixel.xy/ambientV3Frame.resolutionTime.xy;let color=textureLoad(oceanColor,clamp(vec2i(uv*vec2f(size)),vec2i(0),size-1),0).rgb;
 let graded=ambientV3Grade(${authored.has('oceanDisplayTransferAt') ? 'oceanDisplayTransferAt(color,uv)' : 'color'},uv,pixel.xy,ambientV3Frame.tone.y,ambientV3Frame.tone.z,ambientV3Frame.tone.w);
 return vec4f(${authored.has('oceanDisplayTransfer') ? 'oceanDisplayTransfer(graded)' : 'graded'},1.0);
}`;
    return Object.freeze({ render: `${shared}\n${geometry}\n${render}\n${foamAge}\n${sky}\n${splashes}`, present, functions, waterFieldRecipe });
}
