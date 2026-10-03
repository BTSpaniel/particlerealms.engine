// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { WATER_FIELD_DENSITY_WGSL } from '../../../../engine/render/water/WaterFieldShaders.js';
import { normalizeWaterFieldRecipe } from '../../../../engine/render/water/WaterFieldRecipe.js';
import { WATER_OPTICS_WGSL, WATER_VISIBLE_OPTICS_WGSL } from '../../../../engine/render/water/WaterOptics.js';
import { extractAmbientWgslFunctions } from '../../../kernel/schema/AmbientNativeAppearance.js';

const token = id => `{{param:${id}}}`;

/** Saved recipe metadata lives inside its owning function, so graph source
 * serialization, hashing, edits and deletion treat it like every other node.
 * The renderer reads this versioned contract, never the preset's display name.
 */
export function oceanWaterFieldFactorySource(look) {
    const density = WATER_FIELD_DENSITY_WGSL.replace('fn waterFieldSpectralDensity(', 'fn waterFieldWindDensity(');
    return `${density}
fn oceanWaterFieldRecipe()->u32 {
 /*@ambient-water-field:{"version":2,"model":"spectral-wind-v2","seed":${look.seed},"parameters":{"significantWaveHeight":${token('height')},"windSpeed":${token('wind')},"windDirection":${token('direction')},"directionalSpread":${look.spread},"depth":${token('depth')},"choppiness":${token('choppiness')},"minimumWavelength":0.15,"maximumWavelength":80,"shortWaveDamping":0.035}}*/
 return 2u;
}
fn waterFieldSpectralDensity(k:vec2f,wind:vec4f,spectrum:vec4f)->f32 {
 let detail=waterFieldDetailSettings();let fine=smoothstep(3.14159265359,17.9519580205,length(k));
 let selectedWind=vec4f(wind.x,mix(wind.y,waterFieldDetailDirection(),fine),mix(wind.z,detail.z,fine),wind.w);
 return waterFieldWindDensity(k*mix(1.0,max(detail.y,0.3),fine),selectedWind,spectrum)*mix(1.0,max(detail.x,0.0)*detail.w,fine);
}
fn waterFieldDetailSettings()->vec4f {return vec4f(1.0,1.0,0.65,1.0);}
fn waterFieldDetailDirection()->f32 {return 0.15;}
fn oceanFromWaterField(s:WaterFieldSample)->OceanSpectrumSample {
 return OceanSpectrumSample(s.displacement,s.tangentX,s.tangentZ,s.normal,s.velocity,s.jacobian,s.unresolvedVariance,s.sourceCoordinate,s.position,s.residual);
}
fn oceanClipmapCoordinate(local:vec4f)->vec4f {
 let camera=oceanCamera();let settings=oceanMeshSettings();let base=clamp(settings.x*0.5,0.04,1.0);let spacing=base*local.z;
 var point=local.xy*base;let radius=max(abs(point.x),abs(point.y));let inner=1024.0*base;let extent=2048.0*base;
 let stretch=clamp((radius-inner)/max(inner,0.001),0.0,1.0);
 if(local.w>5.5&&radius>inner){point*=(radius+max(0.0,settings.y-extent)*stretch*stretch)/max(radius,0.001);}
 let half=32.0*spacing;let morph=smoothstep(half-4.0*spacing,half,max(abs(local.x),abs(local.y))*base);
 let footprint=spacing*mix(1.0,2.0,morph)*select(1.0,1.0+2.0*max(0.0,settings.y-extent)/max(inner,0.001)*stretch,local.w>5.5)/max(settings.z,0.25);
 point+=vec2f(0.0,floor(camera.w/base)*base);
 return vec4f(point,max(footprint,base),settings.w);
}
${WATER_OPTICS_WGSL}
${WATER_VISIBLE_OPTICS_WGSL}
fn oceanCloudDensityFiltered(point:vec3f,footprint:f32)->f32 {
 let settings=oceanCloudSettings();if(settings.x<=0.0){return 0.0;}
 let layer=smoothstep(0.0,0.18,point.y)*(1.0-smoothstep(0.55,1.0,point.y));
 let drift=ambientV3Frame.resolutionTime.z*ambientV3Frame.tone.x*0.002;
 let p=point*vec3f(settings.y,2.8,settings.y)+vec3f(settings.w+drift,0.0,settings.w*7.3);
 let width=max(footprint,0.0)*max(settings.y,2.8);var shape=0.0;var frequency=1.0;var amplitude=0.5;
 for(var i=0u;i<3u;i+=1u){
  let resolved=1.0-smoothstep(0.35,1.25,width*frequency);
  shape+=amplitude*mix(0.5,noise3d(p*frequency),resolved);frequency*=2.0;amplitude*=0.5;
 }
 let threshold=mix(0.64,0.25,clamp(settings.x,0.0,1.0));return max(0.0,shape-threshold)*layer*settings.z;
}
fn oceanCloudLayerFiltered(direction:vec3f,angularFootprint:f32)->vec4f {
 let d=normalize(direction);if(d.y<=-0.12){return vec4f(0.0,0.0,0.0,1.0);}
 let settings=oceanCloudSettings();let horizonDetail=smoothstep(0.04,0.12,d.y);let cloudColor=vec3f(0.78,0.82,0.83);
 let coverage=clamp(settings.x,0.0,1.0);let threshold=mix(0.64,0.25,coverage);
 let meanDensity=max(0.025*coverage,0.4375-threshold)*settings.z*0.45;
 let meanTransmission=exp(-meanDensity*24.0);
 let meanRadiance=(cloudColor*0.53+oceanSunRadiance()*0.10*exp(-meanDensity*1.1))*(1.0-meanTransmission);
 if(d.y<=0.0){let fade=smoothstep(-0.12,0.0,d.y);return vec4f(meanRadiance*fade,mix(1.0,meanTransmission,fade));}
 var transmission=1.0;var radiance=vec3f(0.0);let light=oceanSunDirection();let denominator=max(d.y,0.04);
 for(var i=0u;i<3u;i+=1u){
  let height=(f32(i)+0.5)/3.0;let point=vec3f(d.x*(0.75+height)/denominator,height,d.z*(0.75+height)/denominator);
  // The cloud slab's projective ray expands a reflected angular cone into a
  // spatial footprint. Filter the incident radiance before BRDF quadrature.
  let width=max(angularFootprint,0.0)*(0.75+height)*(1.0/denominator+length(d.xz)/(denominator*denominator));
  let density=oceanCloudDensityFiltered(point,width);let optical=density/max(d.y,0.12)*1.06666666667;
  let forward=pow(max(dot(d,light),0.0),8.0);
  let illumination=cloudColor*(0.28+0.5*height)+oceanSunRadiance()*(0.10+0.16*forward)*exp(-density*1.1);
  let opacity=1.0-exp(-optical);radiance+=transmission*opacity*illumination;transmission*=1.0-opacity;
 }
 return vec4f(mix(meanRadiance,radiance,horizonDetail),mix(meanTransmission,transmission,horizonDetail));
}
fn oceanAtmosphereFiltered(direction:vec3f,angularFootprint:f32)->vec3f {
 let clouds=oceanCloudLayerFiltered(direction,angularFootprint);return oceanClearSky(direction)*clouds.w+clouds.rgb;
}
fn oceanLightDiscRadius()->f32 {return 0.00465;}
fn oceanWaterColorField(world:vec3f,rest:vec2f,field:WaterFieldSample,view:vec3f,foam:f32,age:f32)->vec3f {
 let n=field.normal;let material=oceanWaterMaterial();
 let covariance=waterSlopeCovariance(waterWorldSlopeCovariance(n,field.slopeCovariance),waterPerceptualRoughnessVariance(material.w));
 // Normal-footprint variation is already integrated in the field's slope
 // moments. Adding derivatives of that filtered mean would count it twice
 // and imprint quad/texel derivative boundaries on the cloud reflection.
 let pixelCone=max(length(dpdx(view)),length(dpdy(view)));
 let quadratureCone=sqrt(max(covariance.x+covariance.z,0.0));
 var reflected=vec3f(0.0);
 for(var i=0u;i<4u;i+=1u){
  let xi=vec2f((f32(i)+0.5)/4.0,fract(f32(i)*0.61803398875+0.125));
  let halfVector=waterBeckmannSampleVisibleNormal(n,view,covariance,xi);let direction=reflect(-view,halfVector);
  reflected+=oceanAtmosphereFiltered(direction,max(pixelCone,quadratureCone))*waterBeckmannVisibleReflectionWeight(n,view,halfVector,covariance);
 }
 let facing=max(dot(n,view),0.0);let fresnel=fresnelDielectricExact(facing,1.333);
 let backlight=pow(max(dot(-view,oceanSunDirection()),0.0),5.0);
 let crest=smoothstep(-0.1,0.65,world.y)*backlight;
 let body=material.rgb*(0.5+0.5*max(n.y,0.0))+vec3f(0.015,0.11,0.09)*crest;
 let direct=waterFiniteDiscRadianceSpecular(n,view,oceanSunDirection(),covariance,oceanLightDiscRadius());
 let water=body*(1.0-fresnel)+reflected*0.25+oceanSunRadiance()*oceanSunVisibility()*direct;
 let aged=clamp(foam,0.0,1.0)*mix(1.0,0.65,smoothstep(0.0,8.0,age));
 return mix(water,oceanFoamColor(n),aged);
}`;
}

export function readOceanWaterFieldRecipe(source) {
    const functions = extractAmbientWgslFunctions(source), names = new Set(functions.map(fn => fn.name));
    if (!names.has('oceanFromWaterField')) return null;
    const marker = /\/\*@ambient-water-field:([^]*?)\*\//.exec(source);
    const descriptor = marker ? JSON.parse(marker[1]) : { version: 2, model: 'spectral-wind-v2', seed: 5471, parameters: { significantWaveHeight: 0 } };
    const density = functions.filter(fn => ['waterFieldSpectralDensity', 'waterFieldWindDensity', 'waterFieldDetailSettings', 'waterFieldDetailDirection'].includes(fn.name)).map(fn => fn.source).join('\n');
    return normalizeWaterFieldRecipe({ ...descriptor, sourceWGSL: density });
}
