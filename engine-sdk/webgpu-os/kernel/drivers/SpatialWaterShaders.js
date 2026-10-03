// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { waterFieldBindingsWGSL, WATER_FIELD_SAMPLE_WGSL } from '../../../engine/render/water/WaterFieldShaders.js';
import { WATER_OPTICS_WGSL } from '../../../engine/render/water/WaterOptics.js';

/** Opt-in adapter over shared Engine field and optics. Legacy shader bytes and
 * saved two-wave nodes remain unchanged, even when mixed into a V2 scene. */
export function createSpatialWaterShader(base, { retainedFoam = false } = {}) {
    let code = base
        .replaceAll('id*3u', 'id*4u')
        .replace('return spatialShadowLight*vec4f(spatialMeshWind(vertex,position),1);', 'return spatialShadowLight*vec4f(spatialOpaqueMeshWind(vertex,position),1);')
        .replace('@location(5) optics:vec3f }', '@location(5) optics:vec3f,@location(6) @interpolate(flat,either) waterPivot:vec4f,@location(7) @interpolate(flat,either) waterWave:vec4f,@location(8) @interpolate(flat,either) waterParams:vec4f,@location(9) referencePoint:vec3f }')
        .replace('out.optics=spatialMeshOptics(vertex);', 'out.optics=spatialMeshOptics(vertex);let metadata=u32(scene.p[24].x)+vertex*4u;out.waterPivot=geometry[metadata];out.waterWave=geometry[metadata+1u];out.waterParams=geometry[metadata+3u];out.referencePoint=position;')
        .replace('var rgb=spatialSurfaceLight(in.color,in.world,shadingNormal,in.material,in.optics);', 'let waterDomain=spatialFiniteDomain(in.referencePoint,in.waterPivot,in.waterParams,in.optics.z);let waterDx=dpdx(waterDomain);let waterDy=dpdy(waterDomain);let legacyRgb=spatialSurfaceLight(in.color,in.world,shadingNormal,in.material,in.optics);var rgb=legacyRgb;if(in.material==4u&&in.optics.z>=2.){rgb=spatialFiniteWaterLight(in.color,in.world,in.referencePoint,in.waterPivot,in.waterWave,in.waterParams,in.optics,waterDx,waterDy);}')
        .replace('if(material==4u){return spatialWaterLight(', 'if(material==4u&&optics.z<2.){return spatialWaterLight(')
        .replace('if(spatialMeshMaterial(id)==4u){return point+vec3f(0,spatialWaterWave(point,pivot,wind).x,0);}', 'if(spatialMeshMaterial(id)==4u){let extra=geometry[base+3u];let flags=geometry[base+2u].z;if(flags>=2.){let domain=spatialFiniteDomain(point,pivot,extra,flags);let sample=waterFieldLocalSample(domain,scene.p[0].w,pivot.w,1./max(.0001,wind.y),wind.z,wind.w,wind.x);let offset=vec3f(sample.displacement.x*extra.y,sample.displacement.y,sample.displacement.z*extra.y);return point+spatialFiniteVector(offset,extra,flags);}return point+vec3f(0,spatialWaterWave(point,pivot,wind).x,0);}')
        .replace('if(spatialMeshMaterial(id)==4u){let wave=spatialWaterWave(point,pivot,wind);return normalize(vec3f(-wave.y,1.,-wave.z));}', 'if(spatialMeshMaterial(id)==4u){let extra=geometry[base+3u];let flags=geometry[base+2u].z;if(flags>=2.){let domain=spatialFiniteDomain(point,pivot,extra,flags);let sample=waterFieldLocalSample(domain,scene.p[0].w,pivot.w,1./max(.0001,wind.y),wind.z,wind.w,wind.x);return spatialFiniteNormal(sample,extra,flags);}let wave=spatialWaterWave(point,pivot,wind);return normalize(vec3f(-wave.y,1.,-wave.z));}')
        + waterFieldBindingsWGSL(2) + WATER_FIELD_SAMPLE_WGSL
        // The base already contains the authoritative engine dielectric kernel.
        + WATER_OPTICS_WGSL.replace(/fn fresnelDielectricExact\([^]*?\n\}/, '') + SPATIAL_FINITE_WATER_WGSL;
    if (retainedFoam) {
        code = code.replace('@location(9) referencePoint:vec3f }', '@location(9) referencePoint:vec3f,@location(10) @interpolate(flat,either) foamLayer:i32 }')
            .replace('out.referencePoint=position;', 'out.referencePoint=position;let rawFlags=out.optics.z;out.foamLayer=i32(floor(rawFlags/8.))-1;out.optics.z=rawFlags-floor(rawFlags/8.)*8.;')
            .replaceAll('let flags=geometry[base+2u].z;', 'let rawFlags=geometry[base+2u].z;let flags=rawFlags-floor(rawFlags/8.)*8.;')
            .replace('in.optics,waterDx,waterDy);', 'in.optics,waterDx,waterDy,in.foamLayer);')
            .replace('optics:vec3f,dx:vec2f,dy:vec2f)->vec3f {\n let q=', 'optics:vec3f,dx:vec2f,dy:vec2f,foamLayer:i32)->vec3f {\n let q=')
            .replace('let foam=clamp(max(compression,sample.breakingPotential*.2*localSteepness)*params.x,0.,.85);', 'let analyticFoam=clamp(max(compression,sample.breakingPotential*.2*localSteepness)*params.x,0.,.85);let foam=select(analyticFoam,clamp(spatialRetainedFoam(foamLayer,q,dx,dy,0.)*params.x,0.,.85),foamLayer>=0);');
        code += SPATIAL_RETAINED_FOAM_WGSL;
    }
    return code;
}

const SPATIAL_RETAINED_FOAM_WGSL = /* wgsl */`
struct SpatialFoamDomains { values:array<vec4f,64> }
@group(3) @binding(3) var spatialFoamHistory:texture_2d_array<f32>;
@group(3) @binding(4) var spatialFoamSampler:sampler;
@group(3) @binding(5) var<uniform> spatialFoamDomains:SpatialFoamDomains;
fn spatialRetainedFoam(layer:i32,q:vec2f,dx:vec2f,dy:vec2f,fallback:f32)->f32 {
 if(layer<0){return fallback;}
 let domain=spatialFoamDomains.values[u32(layer)];let uv=(q-domain.xy)/domain.zw;
 let sx=dx/domain.zw;let sy=dy/domain.zw;let size=vec2f(textureDimensions(spatialFoamHistory));
 let major=select(sy,sx,dot(sx,sx)>dot(sy,sy));let minor=min(length(sx*size),length(sy*size));
 let level=clamp(log2(max(1.,minor)),0.,f32(textureNumLevels(spatialFoamHistory)-1u));
 let count=select(4u,8u,length(major*size)>4.*max(1.,minor));var coverage=0.;
 for(var i=0u;i<8u;i++){if(i>=count){break;}let offset=(f32(i)+.5)/f32(count)-.5;let sampleUv=uv+major*offset;
  if(all(sampleUv>=vec2f(0))&&all(sampleUv<=vec2f(1))){coverage+=textureSampleLevel(spatialFoamHistory,spatialFoamSampler,sampleUv,layer,level).x;}}
 return clamp(coverage/f32(count),0.,1.);
}
`;

const SPATIAL_FINITE_WATER_WGSL = /* wgsl */`
@group(3) @binding(0) var spatialOpaqueColor:texture_2d<f32>;
@group(3) @binding(1) var spatialOpaqueDepth:texture_2d<f32>;
@group(3) @binding(2) var spatialOpaqueDepthSampler:sampler;
// An R32 capture retains raster depth exactly, including on compatibility
// adapters that prohibit raw depth-texture reads in fragment shaders.
fn spatialFiniteDepth(pixel:vec2i)->f32 {
 let dimensions=vec2f(textureDimensions(spatialOpaqueDepth));return textureSampleLevel(spatialOpaqueDepth,spatialOpaqueDepthSampler,(vec2f(pixel)+.5)/dimensions,0.0).r;
}
@fragment fn spatialOpaqueDepthFragment(@builtin(position) pixel:vec4f)->@location(0) f32 {return pixel.z;}
fn spatialFiniteDomain(point:vec3f,pivot:vec4f,params:vec4f,flags:f32)->vec2f {
 let delta=point-pivot.xyz;if(flags>3.5){return vec2f(dot(delta.xz,vec2f(cos(params.z),sin(params.z))),-delta.y);}return delta.xz;
}
fn spatialFiniteVector(value:vec3f,params:vec4f,flags:f32)->vec3f {
 if(flags>3.5){let along=vec3f(cos(params.z),0,sin(params.z));let normal=vec3f(-sin(params.z),0,cos(params.z));return along*value.x+normal*value.y+vec3f(0,-1,0)*value.z;}return value;
}
fn spatialFiniteNormal(sample:WaterFieldSample,params:vec4f,flags:f32)->vec3f {
 let field=spatialFiniteFinish(sample,params);return normalize(spatialFiniteVector(field.normal,params,flags));
}
fn spatialFiniteFinish(sample:WaterFieldSample,params:vec4f)->WaterFieldSample {
 let gain=vec3f(params.y,1,params.y);return waterFieldFinish(sample.sourceCoordinate,sample.displacement*gain,sample.velocity*gain,(sample.tangentX-vec3f(1,0,0))*gain,(sample.tangentZ-vec3f(0,0,1))*gain,sample.parameterSlopeCovariance,sample.breakingPotential,sample.compressionRate*params.y,sample.depth,sample.current);
}
fn spatialOpaqueMeshWind(id:u32,point:vec3f)->vec3f {
 if(scene.p[24].y<.5){return point;}let base=u32(scene.p[24].x)+id*4u;let pivot=geometry[base];let wind=geometry[base+1u];
 if(spatialMeshMaterial(id)==4u){return point;}
 let angle=pivot.w*wind.y*(sin(scene.p[0].z*wind.z+wind.x)*.72+sin(scene.p[0].z*wind.z*.43+wind.x*1.7)*.28);
 return pivot.xyz+spatialWindRotate(point-pivot.xyz,angle,wind.w);
}
fn spatialViewDepth(depth:f32)->f32 {let near=scene.p[22].z;let far=scene.p[22].w;return near*far/max(.000001,far-depth*(far-near));}
fn spatialScreenRay(uv:vec2f)->vec3f {return scene.p[4].xyz+scene.p[2].xyz*((uv.x-scene.p[5].z)/scene.p[5].x)+scene.p[3].xyz*((scene.p[5].w-uv.y)/scene.p[5].y);}
fn spatialProjectedUv(world:vec3f)->vec2f {let clip=meshProjection(world);return vec2f(clip.x/clip.w*.5+.5,.5-clip.y/clip.w*.5);}
// A two-step depth-supported refracted lookup. Invalid/missing/foreground hits
// return zero support, and the caller retains its authored scattering fallback.
fn spatialFiniteTransmission(world:vec3f,normal:vec3f,flags:f32)->vec4f {
 if(flags<2.5||flags>3.5){return vec4f(0);}
 let uv=spatialProjectedUv(world);let dimensions=vec2f(textureDimensions(spatialOpaqueDepth));let inset=vec2f(1.5)/dimensions;
 if(any(uv<inset)||any(uv>vec2f(1)-inset)){return vec4f(0);}
 let pixel=vec2i(uv*dimensions);let depth=spatialFiniteDepth(pixel);let waterDepth=dot(world-scene.p[1].xyz,scene.p[4].xyz);
 if(depth>=.999999){return vec4f(0);}let bedDepth=spatialViewDepth(depth);if(bedDepth<=waterDepth+.001){return vec4f(0);}
 let view=normalize(scene.p[1].xyz-world);let ray=refract(-view,normal,1./1.333);let denominator=dot(ray,scene.p[4].xyz);
 if(denominator<=.0001){return vec4f(0);}
 var distance=(bedDepth-waterDepth)/denominator;var lookup=spatialProjectedUv(world+ray*distance);
 for(var iteration=0u;iteration<2u;iteration++){
  if(any(lookup<inset)||any(lookup>vec2f(1)-inset)){return vec4f(0);}
  let candidateDepth=spatialFiniteDepth(vec2i(lookup*dimensions));if(candidateDepth>=.999999){return vec4f(0);}
  let candidateViewDepth=spatialViewDepth(candidateDepth);if(candidateViewDepth<=waterDepth+.001){return vec4f(0);}
  distance=(candidateViewDepth-waterDepth)/denominator;lookup=spatialProjectedUv(world+ray*distance);
 }
 if(any(lookup<inset)||any(lookup>vec2f(1)-inset)){return vec4f(0);}
 let hitDepth=spatialFiniteDepth(vec2i(lookup*dimensions));let projectedDepth=dot(world+ray*distance-scene.p[1].xyz,scene.p[4].xyz);
 if(hitDepth>=.999999||abs(spatialViewDepth(hitDepth)-projectedDepth)>max(.05,distance*.2)){return vec4f(0);}
 let color=textureSampleLevel(spatialOpaqueColor,sourceSampler,lookup,0);if(color.a<.99){return vec4f(0);}
 return vec4f(color.rgb/max(.0001,color.a),max(.001,distance));
}
fn spatialFiniteSky(view:vec3f,n:vec3f,covariance:vec3f,dx:vec2f,dy:vec2f)->vec3f {
 if(scene.p[30].w<.5){return linear(scene.p[16].rgb);}
 let sequence=array<u32,8>(0u,4u,2u,6u,1u,5u,3u,7u);var radiance=vec3f(0);
 for(var i=0u;i<8u;i++){
  let xi=vec2f((f32(i)+.5)/8.,(f32(sequence[i])+.5)/8.);let halfVector=waterBeckmannSampleNormal(n,covariance,xi);let ray=reflect(-view,halfVector);let weight=waterBeckmannReflectionWeight(n,view,halfVector,covariance);
  if(weight>0.){let footprint=max(length(dx),length(dy))*scene.p[29].y/max(.075,ray.y);radiance+=spatialFiniteSkyRadiance(ray,footprint)*weight;}
 }
 return radiance/8.;
}
// The common sky retains its visible sun. Reflection quadrature integrates
// its ambient component; the same sun disk is integrated once by Beckmann.
fn spatialFiniteSkyRadiance(ray:vec3f,footprint:f32)->vec3f {
 let sun=normalize(scene.p[19].xyz);
 let direct=sunDisc(ray,sun,scene.p[29].w,linear(scene.p[28].rgb),scene.p[28].w)*smoothstep(-.02,.02,sun.y);
 return max(spatialSkyRadiance(ray,footprint)-direct,vec3f(0));
}
fn spatialFiniteWaterLight(color:vec3f,world:vec3f,referencePoint:vec3f,pivot:vec4f,wave:vec4f,params:vec4f,optics:vec3f,dx:vec2f,dy:vec2f)->vec3f {
 let q=spatialFiniteDomain(referencePoint,pivot,params,optics.z);let sample=spatialFiniteFinish(waterFieldLocalSampleGrad(q,scene.p[0].w,pivot.w,1./max(.0001,wave.y),wave.z,wave.w,wave.x,dx,dy),params);
 let view=normalize(scene.p[1].xyz-world);let baseNormal=normalize(spatialFiniteVector(sample.normal,params,optics.z));let n=select(baseNormal,-baseNormal,dot(baseNormal,view)<0.);
 let tangent=waterTangent(n);let across=cross(tangent,n);let sourceX=spatialFiniteVector(vec3f(1,0,0),params,optics.z);let sourceZ=spatialFiniteVector(vec3f(0,0,1),params,optics.z);
 let a=vec2f(dot(sourceX,tangent),dot(sourceZ,tangent));let b=vec2f(dot(sourceX,across),dot(sourceZ,across));let c=sample.slopeCovariance;
 let covariance=vec3f(c.x*a.x*a.x+2.*c.y*a.x*a.y+c.z*a.y*a.y,c.x*a.x*b.x+c.y*(a.x*b.y+a.y*b.x)+c.z*a.y*b.y,c.x*b.x*b.x+2.*c.y*b.x*b.y+c.z*b.y*b.y);
 let compression=max(0.,(.65-sample.jacobian)/.65);
 let localSteepness=clamp(sqrt(max(0.,dot(sample.slopeMean,sample.slopeMean)+sample.slopeCovariance.x+sample.slopeCovariance.z)),0.,1.);
 let foam=clamp(max(compression,sample.breakingPotential*.2*localSteepness)*params.x,0.,.85);let filtered=waterSlopeCovariance(covariance,waterPerceptualRoughnessVariance(clamp(optics.y,.03,.8))+foam*.06);
 let reflection=spatialFiniteSky(view,n,filtered,dx,dy);let light=normalize(scene.p[19].xyz);let keyPower=select(1.,scene.p[28].w/3.,scene.p[30].w>.5);
 let key=linear(scene.p[28].rgb)*waterFiniteDiscSpecular(n,view,light,filtered,scene.p[29].w)*keyPower*optics.x;
 let facing=clamp(dot(n,view),0.,1.);let reflectance=clamp(fresnelDielectricExact(facing,1.333)*optics.x,0.,1.);
 let albedo=linear(color);let transmitted=spatialFiniteTransmission(world,n,optics.z);let attenuation=exp(-vec3f(.65,.28,.15)*transmitted.w/max(.05,params.w));
 let ambient=mix(linear(scene.p[27].rgb),linear(scene.p[26].rgb),.5)*scene.p[26].w;let scattering=albedo*(vec3f(.12)+ambient*.23+linear(scene.p[28].rgb)*max(0.,dot(n,light))*.12*keyPower);
 let under=select(scattering,transmitted.rgb*attenuation+scattering*(vec3f(1)-attenuation),transmitted.w>0.);
 let water=under*(1.-reflectance)+reflection*optics.x+key;let foamLight=vec3f(.72,.79,.78)*(vec3f(.28)+ambient*.45+linear(scene.p[28].rgb)*max(0.,dot(n,light))*.28*keyPower);
 return mix(water,foamLight,foam);
}
`;
