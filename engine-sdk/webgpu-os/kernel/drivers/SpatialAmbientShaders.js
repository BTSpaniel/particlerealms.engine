// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { noise2dWGSL } from '../../../engine/render/shaders/modules/chunks/noise2d.js';
import { SunWGSL } from '../../../engine/render/atmosphere/CelestialSun.js';
import { ATMOSPHERE_UTILS_WGSL } from '../../../engine/render/atmosphere/AtmosphereUtils.js';
import { pbrMaterialsWGSL } from '../../../engine/render/shaders/modules/chunks/pbr_materials.js';

/** Native WGSL port of the experiment's covariance splatter and linear compositor. */
export const SPATIAL_SPLAT_WGSL = `
struct Scene { p: array<vec4f, 20> }
@group(0) @binding(0) var<uniform> scene: Scene;
@group(0) @binding(1) var<storage,read> geometry: array<vec4f>;
@group(0) @binding(2) var<storage,read> order: array<u32>;
@group(0) @binding(3) var<storage,read> sh: array<vec4f>;
@group(0) @binding(4) var sourceSampler: sampler;
@group(0) @binding(5) var sourceFrame: texture_2d<f32>;
@group(0) @binding(6) var historyFrames: texture_2d_array<f32>;
@group(0) @binding(7) var completedFrame: texture_2d<f32>;
@group(0) @binding(8) var completionMask: texture_2d<f32>;
@group(0) @binding(9) var motionMask: texture_2d<f32>;
fn linear(c:vec3f)->vec3f { return mix(c/12.92,pow((c+.055)/1.055,vec3f(2.4)),step(vec3f(.04045),c)); }
fn basis(d0:vec3f)->array<f32,16> {
 let d=normalize(d0);let x=d.x;let y=d.y;let z=d.z;let xx=x*x;let yy=y*y;let zz=z*z;
 return array<f32,16>(.2820947918,-.4886025119*y,.4886025119*z,-.4886025119*x,
 1.092548431*x*y,-1.092548431*y*z,.3153915653*(2*zz-xx-yy),-1.092548431*x*z,.5462742153*(xx-yy),
 -.5900435899*y*(3*xx-yy),2.890611443*x*y*z,-.4570457995*y*(4*zz-xx-yy),.3731763326*z*(2*zz-3*xx-3*yy),-.4570457995*x*(4*zz-xx-yy),1.445305722*z*(xx-yy),-.5900435899*x*(xx-3*yy));
}
struct Varying {
 @builtin(position) position:vec4f, @location(0) q:vec2f, @location(1) uv:vec2f,
 @location(2) pigment:vec4f, @location(3) normal:vec3f,
 @location(4) data:vec4f, @location(5) support:vec3f,
}
@vertex fn splatVertex(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Varying {
 let id=order[instance]; let a=geometry[id*10u];let b=geometry[id*10u+1u];let c=geometry[id*10u+2u];let col=geometry[id*10u+3u];
 let tu=geometry[id*10u+4u];let tv=geometry[id*10u+5u];let no=geometry[id*10u+6u];let misc=geometry[id*10u+7u];let velocity=geometry[id*10u+8u].xyz;
 let eye=scene.p[1].xyz;let view=transpose(mat3x3f(scene.p[2].xyz,scene.p[3].xyz,scene.p[4].xyz));let cp=view*(a.xyz-eye);
 let quad=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));let q=quad[vertex];
 var out:Varying;out.position=vec4f(3,3,2,1);out.q=vec2f(4);out.uv=vec2f(-1);out.pigment=vec4f(0);out.normal=no.xyz;out.data=vec4f(tu.w,cp.z,misc.z,0);out.support=vec3f(no.w,misc.w,select(0.,1.,c.z>=0.));
 if(cp.z<=.06 || (scene.p[9].w>0 && no.w<.0001)){return out;}
 var covariance=mat3x3f(vec3f(b.x,b.y,b.z),vec3f(b.y,b.w,c.x),vec3f(b.z,c.x,c.y))*scene.p[1].w*scene.p[1].w;
 covariance+=mat3x3f(velocity*velocity.x,velocity*velocity.y,velocity*velocity.z)*(scene.p[2].w*scene.p[2].w/12.);
 let cv=view*covariance*transpose(view);let resolution=scene.p[0].xy;let focal=scene.p[5].xy;
 let jx=vec3f(focal.x*resolution.x/cp.z,0,-focal.x*resolution.x*cp.x/(cp.z*cp.z));
 let jy=vec3f(0,focal.y*resolution.y/cp.z,-focal.y*resolution.y*cp.y/(cp.z*cp.z));
 var aa=dot(jx,cv*jx);let ab=dot(jx,cv*jy);var bb=dot(jy,cv*jy);let originalDet=max(aa*bb-ab*ab,0.);aa+=.25;bb+=.25;
 let compensation=sqrt(originalDet/max(aa*bb-ab*ab,.00001));let mid=.5*(aa+bb);let spread=sqrt(max(0.,.25*(aa-bb)*(aa-bb)+ab*ab));
 let rawMajor=max(.25,mid+spread);let rawMinor=max(.25,mid-spread);let cap=select(65536.,pow(min(resolution.x,resolution.y)*scene.p[4].w/3.,2.),scene.p[4].w>0);
 let major=min(cap,rawMajor);let minor=min(cap,rawMinor);var axis=select(vec2f(0,1),vec2f(1,0),aa>=bb);if(abs(ab)>.00001){axis=normalize(vec2f(ab,rawMajor-aa));}
 let offset=(axis*q.x*sqrt(major)+vec2f(-axis.y,axis.x)*q.y*sqrt(minor))*3.;
 let center=cp.xy/cp.z*focal*2.+vec2f(2.*(scene.p[5].z-.5),2.*(.5-scene.p[5].w));
 out.position=vec4f(center+offset/resolution*2.,clamp(100./99.95-5./(99.95*cp.z),0.,1.),1);
 out.q=q*3.;out.normal=normalize(no.xyz);out.pigment=col;
 if(scene.p[11].x>=0){let coefficients=u32(scene.p[11].y);let terms=basis(a.xyz-eye);var color=vec3f(.5);for(var k=0u;k<coefficients;k++){color+=terms[k]*sh[id*coefficients+k].rgb;}out.pigment=vec4f(clamp(color,vec3f(0),vec3f(64)),col.a);}
 out.pigment.a*=a.w*scene.p[3].w;out.uv=c.zw;
 if(out.uv.x>=0){let u=view*tu.xyz;let v=view*tv.xyz;let B=vec4f(dot(jx,u),dot(jy,u),dot(jx,v),dot(jy,v));let det=B.x*B.w-B.z*B.y;var delta=vec2f(0);if(abs(det)>.000001){delta=vec2f(B.w*offset.x-B.z*offset.y,-B.y*offset.x+B.x*offset.y)/det;}out.uv+=clamp(delta,-misc.xy*2.4,misc.xy*2.4);}
 out.data=vec4f(tu.w,cp.z,misc.z,compensation);return out;
}
@fragment fn splatFragment(in:Varying)->@location(0) vec4f {
 let radius=dot(in.q,in.q);if(radius>9.){discard;}var weight=exp(-.5*radius)*in.pigment.a;var rgb=in.pigment.rgb;
 // Texture eligibility comes from the canonical UV, not its expanded value:
 // a left-edge splat can interpolate to negative U without becoming a cloud.
 if(scene.p[6].w>0 && in.support.z>0){if(any(in.uv<vec2f(0))||any(in.uv>vec2f(1))){discard;}
 let a=textureSampleLevel(sourceFrame,sourceSampler,in.uv,0);var sampled=a;
 if(scene.p[6].z!=0){let b=textureSampleLevel(historyFrames,sourceSampler,in.uv,min(i32(in.data.x),i32(textureNumLayers(historyFrames))-1),0);let mixture=select(scene.p[7].x,1.,scene.p[6].z==1);sampled=mix(a,b,mixture);}rgb=sampled.rgb;weight*=sampled.a;
 if(scene.p[9].z>0){let cut=textureSampleLevel(completionMask,sourceSampler,in.uv,0).r;if(in.support.x>.0001){weight*=smoothstep(.02,.65,textureSampleLevel(motionMask,sourceSampler,in.uv,0).r);}else{rgb=mix(rgb,textureSampleLevel(completedFrame,sourceSampler,in.uv,0).rgb,cut);}}
 }
 if(scene.p[6].y==1){weight*=.75+.25*smoothstep(.1,.8,cos(in.q.x*2.5)*cos(in.q.y*2.5));}if(scene.p[6].y==2){weight*=exp(-in.q.y*in.q.y*1.2);}
 if(scene.p[8].y>0){let lum=dot(rgb,vec3f(.2126,.7152,.0722));var tint=mix(scene.p[14].rgb,scene.p[15].rgb,(lum-.66)/.34);if(lum<.33){tint=mix(scene.p[12].rgb,scene.p[13].rgb,lum/.33);}else if(lum<.66){tint=mix(scene.p[13].rgb,scene.p[14].rgb,(lum-.33)/.33);}rgb=mix(rgb,tint,scene.p[8].y);}
 let relief=.65+.55*max(0.,dot(in.normal,normalize(scene.p[19].xyz)));rgb=linear(rgb)*mix(1.,relief,scene.p[7].y);
 let depth=clamp((in.data.y-scene.p[7].w)/max(scene.p[8].x,.1),0.,1.);rgb=mix(rgb,linear(scene.p[18].rgb),depth*scene.p[7].z);
 if(scene.p[6].x==1){rgb=mix(vec3f(.88,.63,.16),vec3f(.025,.21,.38),depth);}else if(scene.p[6].x==2){rgb=in.normal*.5+.5;}else if(scene.p[6].x==3){rgb=.5+.5*cos(vec3f(in.data.z*31.7)+vec3f(0,2.094,4.188));}else if(scene.p[6].x==4){rgb=mix(vec3f(.85,.045,.10),vec3f(.02,.75,.5),in.support.y);weight=exp(-.5*radius)*.98;}
 weight=min(.985,weight*mix(mix(.8,1.,in.data.w),in.data.w,scene.p[8].w));if(weight<.002){discard;}return vec4f(rgb*weight,weight);
}
struct Quad { @builtin(position) position:vec4f, @location(0) uv:vec2f }
@vertex fn quadVertex(@builtin(vertex_index) id:u32)->Quad {let p=vec2f(f32((id<<1u)&2u),f32(id&2u));var o:Quad;o.position=vec4f(p*2.-1.,0,1);o.uv=vec2f(p.x,1.-p.y);return o;}
@fragment fn backingFragment(in:Quad)->@location(0) vec4f {
 var p=in.uv;let aspect=scene.p[0].x/scene.p[0].y;let sourceAspect=scene.p[10].x/scene.p[10].y;
 if(aspect>sourceAspect){p.y=(p.y-.5)*sourceAspect/aspect+.5;}else{p.x=(p.x-.5)*aspect/sourceAspect+.5;}
 if(scene.p[10].w>0){let ray=scene.p[4].xyz+scene.p[2].xyz*((in.uv.x-scene.p[5].z)/scene.p[5].x)+scene.p[3].xyz*((scene.p[5].w-in.uv.y)/scene.p[5].y);if(abs(ray.z)<.0001){discard;}let t=(scene.p[10].z-scene.p[1].z)/ray.z;if(t<=0){discard;}let point=scene.p[1].xyz+ray*t;p=vec2f(scene.p[17].z+scene.p[17].x*point.x/scene.p[10].z,scene.p[17].w-scene.p[17].y*point.y/scene.p[10].z);if(any(p<vec2f(0))||any(p>vec2f(1))){discard;}}
 var source=textureSampleLevel(sourceFrame,sourceSampler,p,0);
 if(scene.p[9].x==1){source=vec4f(0);for(var x=-2;x<=2;x++){for(var y=-2;y<=2;y++){source+=textureSampleLevel(sourceFrame,sourceSampler,p+vec2f(f32(x),f32(y))*.018,0)/25.;}}}
 else if(scene.p[9].x==3){let plate=textureSampleLevel(completedFrame,sourceSampler,p,0);source=mix(source,plate,textureSampleLevel(completionMask,sourceSampler,p,0).r);}
 let alpha=source.a*scene.p[9].y;return vec4f(linear(source.rgb)*alpha,alpha);
}
struct Mesh { @builtin(position) position:vec4f,@location(0) color:vec3f }
fn meshProjection(position:vec3f)->vec4f {
 let d=position-scene.p[1].xyz;let q=vec3f(dot(d,scene.p[2].xyz),dot(d,scene.p[3].xyz),dot(d,scene.p[4].xyz));
 return vec4f(q.xy*scene.p[5].xy*2.+vec2f(2.*(scene.p[5].z-.5),2.*(.5-scene.p[5].w))*q.z,100./99.95*q.z-5./99.95,q.z);
}
@vertex fn meshVertex(@location(0) position:vec3f,@location(1) color:vec3f)->Mesh {
 var out:Mesh;out.position=meshProjection(position);out.color=color;return out;
}
@fragment fn meshFragment(in:Mesh)->@location(0) vec4f {return vec4f(linear(in.color),1);}
// Authored terrain shares the6-float mesh buffer with the legacy picture
// frame, but owns its inspection output. Instance identity is the saved node
// group ID supplied by its draw range, rather than an extra private buffer.
// Every vertex in one draw has the same instance identity, so either provoking
// vertex is exact. Explicit 'either' also supports compatibility-mode devices.
struct TerrainMesh { @builtin(position) position:vec4f,@location(0) color:vec3f,@location(1) world:vec3f,@location(2) @interpolate(flat,either) identity:u32 }
@vertex fn terrainMeshVertex(@location(0) position:vec3f,@location(1) color:vec3f,@builtin(instance_index) identity:u32)->TerrainMesh {
 var out:TerrainMesh;out.position=meshProjection(position);out.color=color;out.world=position;out.identity=identity;return out;
}
@fragment fn terrainMeshFragment(in:TerrainMesh,@builtin(front_facing) front:bool)->@location(0) vec4f {
 // Screen derivatives reverse with the projected winding. The triangle's
 // facing is constant; a near-zero normal.y is not a stable orientation test
 // for the authored vertical walls or downward-facing closed bottom.
 let rawNormal=cross(dpdy(in.world),dpdx(in.world));let squaredLength=dot(rawNormal,rawNormal);let normal=select(vec3f(0,1,0),rawNormal*inverseSqrt(max(squaredLength,1e-20))*select(-1.,1.,front),squaredLength>1e-20);
 let distance=dot(in.world-scene.p[1].xyz,scene.p[4].xyz);let depth=clamp((distance-scene.p[7].w)/max(scene.p[8].x,.1),0.,1.);
 var rgb=linear(in.color);
 if(scene.p[6].x==1){rgb=mix(vec3f(.88,.63,.16),vec3f(.025,.21,.38),depth);}
 else if(scene.p[6].x==2){rgb=normal*.5+.5;}
 else if(scene.p[6].x==3){var id=(in.identity^61u)*(in.identity|1u);id^=id>>16u;id*=0x27d4eb2du;id^=id>>15u;rgb=.5+.5*cos(vec3f(f32(id)/4294967296.*31.7)+vec3f(0,2.094,4.188));}
 else if(scene.p[6].x==4){rgb=vec3f(.02,.75,.5);}
 // An opaque saved heightfield triangle has full supported coverage. The
 // existing present pass visualizes its actual alpha in Coverage inspection.
 return vec4f(rgb,1);
}
`;

export const SPATIAL_PRESENT_WGSL = `
struct Scene { p:array<vec4f,20> }
@group(0) @binding(0) var<uniform> scene:Scene;
@group(0) @binding(1) var image:texture_2d<f32>;
@group(0) @binding(2) var imageSampler:sampler;
struct Quad { @builtin(position) position:vec4f,@location(0) uv:vec2f }
@vertex fn presentVertex(@builtin(vertex_index) id:u32)->Quad {let p=vec2f(f32((id<<1u)&2u),f32(id&2u));var o:Quad;o.position=vec4f(p*2.-1.,0,1);o.uv=vec2f(p.x,1.-p.y);return o;}
@fragment fn presentFragment(in:Quad)->@location(0) vec4f {
 let a=textureSampleLevel(image,imageSampler,in.uv,0);if(scene.p[6].x==5){return vec4f(mix(vec3f(.78,.05,.12),vec3f(.12,.76,.48),smoothstep(.02,.98,a.a)),1);}
 var rgb=a.rgb/max(a.a,.0001)*exp2(scene.p[8].z);let peak=max(rgb.r,max(rgb.g,rgb.b));rgb/=1.+max(0.,peak-1.)*.55;
 rgb=mix(rgb*12.92,1.055*pow(max(rgb,vec3f(0)),vec3f(1./2.4))-.055,step(vec3f(.0031308),rgb));
 return vec4f(rgb*a.a+scene.p[16].rgb*(1.-a.a),1);
}
`;

/** Versioned composition grades unpremultiplied scene radiance as before,
 * then composites against the saved background in linear light. One transfer
 * encodes the final opaque result; the historical shader remains unchanged. */
export const SPATIAL_IMMERSIVE_PRESENT_WGSL = SPATIAL_PRESENT_WGSL
    .replace('struct Scene { p:array<vec4f,20> }', `struct Scene { p:array<vec4f,20> }
fn spatialPresentLinear(c:vec3f)->vec3f { return mix(c/12.92,pow((c+.055)/1.055,vec3f(2.4)),step(vec3f(.04045),c)); }`)
    .replace('rgb=mix(rgb*12.92,', 'rgb=rgb*a.a+spatialPresentLinear(scene.p[16].rgb)*(1.-a.a);\n rgb=mix(rgb*12.92,')
    .replace('return vec4f(rgb*a.a+scene.p[16].rgb*(1.-a.a),1);', 'return vec4f(rgb,1);');

/** Versioned additions leave the original shader string unchanged for saved v1 scenes. */
const IMMERSIVE_SHADER_FUNCTIONS = `
${noise2dWGSL}
${SunWGSL}
${ATMOSPHERE_UTILS_WGSL}
${pbrMaterialsWGSL}
@group(1) @binding(0) var<uniform> spatialShadowLight:mat4x4f;
@vertex fn spatialShadowMeshVertex(@location(0) position:vec3f,@builtin(vertex_index) vertex:u32)->@builtin(position) vec4f {
 return spatialShadowLight*vec4f(spatialMeshWind(vertex,position),1);
}
// A saved artistic sky uses engine noise, sun and atmospheric phase functions.
// Cloud density is a directional layer, not a reconstructed volume or LUT sky.
fn spatialSkyCoordinate(ray:vec3f)->vec2f {
 return ray.xz/max(.075,ray.y)*scene.p[29].y+vec2f(scene.p[0].z*scene.p[29].z,scene.p[0].z*scene.p[29].z*.37);
}
// Both the background and a generated water interface see this same authored
// directional radiance. The caller supplies derivatives before any branching.
fn spatialSkyRadiance(ray:vec3f,footprint:f32)->vec3f {
 let sun=normalize(scene.p[19].xyz);let altitude=max(0.,ray.y);
 // Horizon scatter occupies an angular band. The earlier power curve kept
 // most of an eye-level view near the pale horizon even well above it.
 let horizon=exp(-altitude/(.035+scene.p[27].w*.22));
 var rgb=mix(linear(scene.p[26].rgb),linear(scene.p[27].rgb),horizon)*scene.p[26].w;
 let mu=dot(ray,sun);let phase=cornetteShanksMiePhase(mu,.76);
 rgb+=linear(scene.p[28].rgb)*min(2.,phase*.06)*scene.p[27].w;
 let coordinate=spatialSkyCoordinate(ray);let filtered=mix(fbm2d(coordinate),.5,smoothstep(.3,1.5,footprint));
 let cloud=smoothstep(1.-scene.p[29].x,.16+1.-scene.p[29].x,filtered)*smoothstep(.025,.14,ray.y);
 let cloudLight=linear(scene.p[27].rgb)*(.72+.35*max(0.,mu));rgb=mix(rgb,cloudLight*scene.p[26].w,cloud*.85);
 rgb+=sunDisc(ray,sun,scene.p[29].w,linear(scene.p[28].rgb),scene.p[28].w)*smoothstep(-.02,.02,sun.y);
 return max(rgb,vec3f(0));
}
@fragment fn skyFragment(in:Quad)->@location(0) vec4f {
 let ray=normalize(scene.p[4].xyz+scene.p[2].xyz*((in.uv.x-scene.p[5].z)/scene.p[5].x)+scene.p[3].xyz*((scene.p[5].w-in.uv.y)/scene.p[5].y));
 let coordinate=spatialSkyCoordinate(ray);let footprint=max(length(dpdx(coordinate)),length(dpdy(coordinate)));
 return vec4f(spatialSkyRadiance(ray,footprint),1);
}
fn spatialMeshMaterial(id:u32)->u32 {if(scene.p[24].y<.5){return 0u;}return u32(geometry[u32(scene.p[24].x)+id*3u+2u].w);}
fn spatialSurfaceFactors(material:u32)->vec4f {
 var factors=vec4f(1);factors=select(factors,scene.p[31],material==1u);factors=select(factors,scene.p[32],material==2u);return select(factors,scene.p[33],material==5u);
}
// World-aligned stone uses all three projections, so vertical faces receive
// the same authored grain scale as upward faces without stretched UVs. Each
// frequency attenuates against derivatives of its own scaled coordinates.
fn spatialStoneProjection(p:vec2f,footprint:f32)->f32 {
 let coarse=mix(noise2d(p),.5,smoothstep(.3,1.5,footprint));
 let fine=mix(noise2d(p*4.),.5,smoothstep(.3,1.5,footprint*4.));return coarse*.7+fine*.3;
}
fn spatialFilteredFbm(p:vec2f,footprint:f32)->f32 {
 var result=0.;var amplitude=.5;var frequency=1.;for(var octave=0;octave<4;octave++){
  result+=amplitude*mix(noise2d(p*frequency),.5,smoothstep(.3,1.5,footprint*frequency));frequency*=2.;amplitude*=.5;
 }return result;
}
fn spatialSurfaceLight(color:vec3f,world:vec3f,normal:vec3f,material:u32,optics:vec3f)->vec3f {
 var n=normalize(normal);
 // Filter procedural detail against its actual projected footprint.
 let groundP=world.xz*3.5*scene.p[31].x;let barkP=vec2f(world.x+world.z,world.y)*vec2f(36.,2.)*scene.p[32].x;
 let groundFootprint=max(length(dpdx(groundP)),length(dpdy(groundP)));let barkFootprint=max(length(dpdx(barkP)),length(dpdy(barkP)));
 let stoneP=world*3.8*scene.p[33].x;let stoneDx=dpdx(stoneP);let stoneDy=dpdy(stoneP);
 // Derivatives are evaluated before divergent material selection. The noise
 // helpers themselves contain no derivatives and run only for their owner.
 var groundNoise=.5;if(material==1u){
  // Keep the historical neutral frequency exact; an authored frequency change
  // filters every octave against its own footprint before accumulation.
  var groundFbm=0.;if(scene.p[31].x==1.){groundFbm=fbm2d(groundP);}else{groundFbm=spatialFilteredFbm(groundP,groundFootprint);}
  let groundCoarse=mix(groundFbm,.5,smoothstep(.3,1.5,groundFootprint));
  let groundFine=mix(noise2d(groundP*12.),.5,smoothstep(.3,1.5,groundFootprint*12.));groundNoise=groundCoarse*.64+groundFine*.36;
 }
 var barkNoise=.5;if(material==2u){barkNoise=mix(noise2d(barkP),.5,smoothstep(.3,1.5,barkFootprint));}
 var stoneNoise=.5;if(material==5u){
  let stoneX=spatialStoneProjection(stoneP.yz,max(length(stoneDx.yz),length(stoneDy.yz)));
  let stoneY=spatialStoneProjection(stoneP.xz,max(length(stoneDx.xz),length(stoneDy.xz)));
  let stoneZ=spatialStoneProjection(stoneP.xy,max(length(stoneDx.xy),length(stoneDy.xy)));
  let projectionWeight=pow(abs(n),vec3f(4));stoneNoise=dot(vec3f(stoneX,stoneY,stoneZ),projectionWeight)/max(.0001,dot(projectionWeight,vec3f(1)));
 }
 let factors=spatialSurfaceFactors(material);let micro=select(select(groundNoise,barkNoise,material==2u),stoneNoise,material==5u);
 let detail=scene.p[30].x*select(0.,factors.y,material==1u || material==2u || material==5u);
 let albedo=linear(color)*max(0.,1.+(micro-.5)*detail*1.7);
 // Derive metre-scale bump normals in the actual world tangent plane. Detail
 // follows camera projection and the filtering fades unresolved fine grain.
 let height=micro*detail*select(select(.055,.012,material==2u),.025,material==5u)*scene.p[34].x;
 let positionDx=dpdx(world);let positionDy=dpdy(world);let heightDx=dpdx(height);let heightDy=dpdy(height);
 let tangentX=cross(positionDy,n);let tangentY=cross(n,positionDx);let determinant=dot(positionDx,tangentX);
 let safeDeterminant=select(1.,determinant,abs(determinant)>1e-10);
 let surfaceGradient=(tangentX*heightDx+tangentY*heightDy)/safeDeterminant;
 n=normalize(n-select(vec3f(0),surfaceGradient,abs(determinant)>1e-10));
 // Evaluate reflection gradients uniformly before the material branch. The
 // directional sky and optical BRDF are then only evaluated for actual water.
 let view=normalize(scene.p[1].xyz-world);let waterNormal=select(n,-n,dot(n,view)<0.);let reflectionCoordinate=spatialSkyCoordinate(reflect(-view,waterNormal));
 let reflectionFootprint=max(length(dpdx(reflectionCoordinate)),length(dpdy(reflectionCoordinate)));
 let waterNormalDx=dpdx(waterNormal);let waterNormalDy=dpdy(waterNormal);let viewDx=dpdx(view);let viewDy=dpdy(view);
 if(material==4u){return spatialWaterLight(linear(color),world,n,optics,reflectionFootprint,waterNormalDx,waterNormalDy,viewDx,viewDy);}
 return spatialMaterialLight(albedo,world,n,material);
}
// Eight deterministic Engine GGX half-vectors approximate filtering the saved
// directional sky. This is bounded sampled sky radiance, not a prefiltered IBL
// cube, scene reflection, refraction or visibility-aware GI. Every ray obtains
// its own sky footprint from the uniformly evaluated normal/view gradients;
// no screen derivatives occur inside this material-dependent sampling branch.
fn spatialWaterSky(view:vec3f,n:vec3f,roughness:f32,normalDx:vec3f,normalDy:vec3f,viewDx:vec3f,viewDy:vec3f,baseFootprint:f32)->vec3f {
 let sequence=array<u32,8>(0u,4u,2u,6u,1u,5u,3u,7u);var radiance=vec3f(0);var weight=0.;
 for(var sample=0u;sample<8u;sample++){
  let xi=vec2f((f32(sample)+.5)/8.,(f32(sequence[sample])+.5)/8.);let halfVector=sampleGGX(n,roughness,xi);
  let ray=reflect(-view,halfVector);let validWeight=max(0.,dot(n,ray))*select(0.,1.,dot(view,halfVector)>0.);
  if(validWeight>0.){
   let halfDx=sampleGGX(normalize(n+normalDx),roughness,xi);let halfDy=sampleGGX(normalize(n+normalDy),roughness,xi);
   let rayDx=reflect(-normalize(view+viewDx),halfDx);let rayDy=reflect(-normalize(view+viewDy),halfDy);let coordinate=spatialSkyCoordinate(ray);
   let footprint=max(length(spatialSkyCoordinate(rayDx)-coordinate),length(spatialSkyCoordinate(rayDy)-coordinate));
   radiance+=spatialSkyRadiance(ray,footprint)*validWeight;weight+=validWeight;
  }
 }
 if(weight>.00001){return radiance/weight;}return spatialSkyRadiance(reflect(-view,n),baseFootprint);
}
// Actual displaced water uses the Engine dielectric Fresnel and GGX kernels.
// This is reflection of the saved sky, not scene SSR, refraction or a fluid
// solver. The saved water albedo supplies a bounded opaque scattering term.
fn spatialWaterLight(albedo:vec3f,world:vec3f,normal:vec3f,optics:vec3f,footprint:f32,normalDx:vec3f,normalDy:vec3f,viewDx:vec3f,viewDy:vec3f)->vec3f {
 let view=normalize(scene.p[1].xyz-world);let n=select(normal,-normal,dot(normal,view)<0.);let facing=max(.001,dot(n,view));
 let reflected=reflect(-view,n);let glint=optics.x;let roughness=select(.07,clamp(optics.y,.03,.8),optics.z>.5);
 var sky=linear(scene.p[16].rgb);if(scene.p[30].w>.5){
  if(optics.z>.5){sky=spatialWaterSky(view,n,roughness,normalDx,normalDy,viewDx,viewDy,footprint);}else{sky=spatialSkyRadiance(reflected,footprint);}
 }
 let light=normalize(scene.p[19].xyz);let halfSum=light+view;let halfVector=halfSum*inverseSqrt(max(1e-12,dot(halfSum,halfSum)));let ndl=max(0.,dot(n,light));
 let distribution=distributionGGX(max(0.,dot(n,halfVector)),roughness);let masking=geometrySmith(facing,ndl,roughness);
 let ior=1.333;let f0=pow((ior-1.)/(ior+1.),2.);let reflectance=clamp(fresnelSchlickF0(facing,f0)*glint,0.,1.);
 let keyFresnel=fresnelSchlickF0(max(0.,dot(view,halfVector)),f0);
 let specular=min(6.,distribution*masking*keyFresnel/max(.001,4.*facing*max(ndl,.001)))*ndl;
 let keyPower=select(1.,scene.p[28].w/3.,scene.p[30].w>.5);let key=linear(scene.p[28].rgb)*specular*keyPower*glint;
 let ambient=mix(linear(scene.p[27].rgb),linear(scene.p[26].rgb),.5)*scene.p[26].w;
 let scattering=albedo*(vec3f(.08)+ambient*.18+linear(scene.p[28].rgb)*ndl*.12*keyPower);
 return scattering*(1.-reflectance)+sky*reflectance+key;
}
// BRDF has no derivatives: finite generated leaves may evaluate it after the
// coverage discard while opaque detail evaluates its gradients uniformly.
fn spatialMaterialLight(albedo:vec3f,world:vec3f,normal:vec3f,material:u32)->vec3f {
 let light=normalize(scene.p[19].xyz);let view=normalize(scene.p[1].xyz-world);var n=normalize(normal);n=select(n,-n,material==3u && dot(n,view)<0.);
 let diffuse=.24+.96*max(0.,dot(n,light))+select(0.,scene.p[23].x*max(0.,dot(-n,light)),material==3u);let halfSum=light+view;let halfVector=halfSum*inverseSqrt(max(1e-12,dot(halfSum,halfSum)));let factors=spatialSurfaceFactors(material);let roughness=clamp(scene.p[30].y*factors.z,.03,1.);
 let a2=pow(roughness,4.);let ndh=max(0.,dot(n,halfVector));let denominator=max(.0001,ndh*ndh*(a2-1.)+1.);
 let distribution=a2/(3.14159265359*denominator*denominator);let ndv=max(.001,dot(n,view));let ndl=max(0.,dot(n,light));let k=pow(roughness+1.,2.)/8.;
 let geometryTerm=ndv/(ndv*(1.-k)+k)*ndl/(ndl*(1.-k)+k);let fresnel=.04+.96*pow(1.-max(0.,dot(view,halfVector)),5.);
 let specular=min(2.,distribution*geometryTerm*fresnel/max(.001,4.*ndv*max(ndl,.001)))*ndl*scene.p[30].z*factors.w;
 // Saved procedural sky supplies hemisphere illumination, an explicit local
 // approximation rather than visibility-aware GI. Captured radiance and the
 // historical missing-sky path retain their existing diffuse response.
 let hemisphere=mix(linear(scene.p[27].rgb),linear(scene.p[26].rgb),clamp(n.y*.5+.5,0.,1.));
 let skyAmbient=(vec3f(.06)+hemisphere*.28)*scene.p[26].w;
 let sunPower=scene.p[28].w/3.;let transmission=select(0.,scene.p[23].x*max(0.,dot(-n,light)),material==3u);
 let sunDiffuse=linear(scene.p[28].rgb)*(.96*ndl+transmission)*sunPower;
 let irradiance=select(vec3f(diffuse),skyAmbient+sunDiffuse,scene.p[30].w>.5);
 let specularPower=select(1.,sunPower,scene.p[30].w>.5);
 return albedo*mix(vec3f(1),irradiance,scene.p[21].z)+linear(scene.p[28].rgb)*specular*specularPower*scene.p[21].z;
}
fn spatialFog(rgb:vec3f,world:vec3f,cameraDepth:f32)->vec3f {
 if(scene.p[20].w<.5){let amount=clamp((cameraDepth-scene.p[7].w)/max(scene.p[8].x,.1),0.,1.)*scene.p[7].z;return mix(rgb,linear(scene.p[18].rgb),amount);}
 let distance=length(world-scene.p[1].xyz);var density=scene.p[22].x;
 if(scene.p[22].y>0.){density*=exp(-max(0.,.5*(world.y+scene.p[1].y))/scene.p[22].y);}
 return mix(rgb,linear(scene.p[18].rgb),1.-exp(-min(24.,density*distance)));
}
fn spatialWindRotate(value:vec3f,angle:f32,direction:f32)->vec3f {
 let axis=vec3f(-sin(direction),0.,cos(direction));let c=cos(angle);let s=sin(angle);
 return value*c+cross(axis,value)*s+axis*dot(axis,value)*(1.-c);
}
fn spatialMeshWind(id:u32,point:vec3f)->vec3f {
 if(scene.p[24].y<.5){return point;}let base=u32(scene.p[24].x)+id*3u;let pivot=geometry[base];let wind=geometry[base+1u];
 if(spatialMeshMaterial(id)==4u){return point+vec3f(0,spatialWaterWave(point,pivot,wind).x,0);}
 let angle=pivot.w*wind.y*(sin(scene.p[0].z*wind.z+wind.x)*.72+sin(scene.p[0].z*wind.z*.43+wind.x*1.7)*.28);
 return pivot.xyz+spatialWindRotate(point-pivot.xyz,angle,wind.w);
}
// Height and slope share the identical two authored travelling waves. Units
// are metres, cycles/metre and metres/second after source metric transforms.
fn spatialWaterWave(point:vec3f,pivot:vec4f,wave:vec4f)->vec3f {
 let direction=vec2f(cos(wave.w),sin(wave.w));let secondary=vec2f(cos(wave.w+.9),sin(wave.w+.9));let k=6.28318530718*wave.y;
 let phase=k*(dot(point.xz-pivot.xz,direction)-scene.p[0].z*wave.z)+wave.x;
 let phase2=k*1.73*(dot(point.xz-pivot.xz,secondary)-scene.p[0].z*wave.z*.67)+wave.x*1.31;
 let height=pivot.w*(.7*sin(phase)+.3*sin(phase2));let slope=pivot.w*k*(.7*cos(phase)*direction+.519*cos(phase2)*secondary);
 return vec3f(height,slope);
}
fn spatialMeshNormal(id:u32,point:vec3f)->vec3f {
 if(scene.p[24].y<.5){return vec3f(0);}let base=u32(scene.p[24].x)+id*3u;let pivot=geometry[base];let wind=geometry[base+1u];
 if(spatialMeshMaterial(id)==4u){let wave=spatialWaterWave(point,pivot,wind);return normalize(vec3f(-wave.y,1.,-wave.z));}
 let angle=pivot.w*wind.y*(sin(scene.p[0].z*wind.z+wind.x)*.72+sin(scene.p[0].z*wind.z*.43+wind.x*1.7)*.28);
 return spatialWindRotate(geometry[base+2u].xyz,angle,wind.w);
}
fn spatialMeshOptics(id:u32)->vec3f {if(scene.p[24].y<.5 || spatialMeshMaterial(id)!=4u){return vec3f(0);}return geometry[u32(scene.p[24].x)+id*3u+2u].xyz;}
fn spatialPanorama(ray0:vec3f,gradient:f32)->vec4f {
 let ray=normalize(ray0);let dimensions=vec2f(textureDimensions(sourceFrame));var uv:vec2f;var lod:f32;
 if(scene.p[20].y<1.5){
  uv=vec2f(.5+atan2(ray.x,ray.z)/6.28318530718,acos(clamp(ray.y,-1.,1.))/3.14159265359);
  lod=max(0.,log2(max(1.,gradient*dimensions.x/6.28318530718)))*scene.p[21].y;
 }else{
  let a=abs(ray);var face=0.;var p=vec2f(0);var denominator=1.;
  if(a.x>=a.y && a.x>=a.z){denominator=a.x;if(ray.x>0.){face=0.;p=vec2f(-ray.z,-ray.y);}else{face=1.;p=vec2f(ray.z,-ray.y);}}
  else if(a.y>=a.z){denominator=a.y;if(ray.y>0.){face=2.;p=vec2f(ray.x,ray.z);}else{face=3.;p=vec2f(ray.x,-ray.z);}}
  else{denominator=a.z;if(ray.z>0.){face=4.;p=vec2f(ray.x,-ray.y);}else{face=5.;p=vec2f(-ray.x,-ray.y);}}
  lod=max(0.,log2(max(1.,gradient*dimensions.y*.5)))*scene.p[21].y;
  let inset=min(.5,.5*exp2(ceil(lod))/dimensions.y);p=clamp(p/max(denominator,.00001)*.5+.5,vec2f(inset),vec2f(1.-inset));uv=vec2f((face+p.x)/6.,p.y);
 }
 return textureSampleLevel(sourceFrame,sourceSampler,uv,lod);
}
`;

export const SPATIAL_IMMERSIVE_SPLAT_WGSL = SPATIAL_SPLAT_WGSL
    .replace('array<vec4f, 20>', 'array<vec4f, 35>')
    .replace('@location(4) data:vec4f, @location(5) support:vec3f,', '@location(4) data:vec4f, @location(5) support:vec3f, @location(6) world:vec3f,')
    .replace('@location(6) world:vec3f,', '@location(6) world:vec3f, @location(7) @interpolate(flat,either) material:u32,')
    .replace('var out:Varying;out.position=', 'var out:Varying;out.world=a.xyz;out.material=u32(tv.w);out.position=')
    .replace('if(cp.z<=.06 ||', 'if(cp.z<=scene.p[22].z ||')
    .replace('clamp(100./99.95-5./(99.95*cp.z),0.,1.)', 'clamp(scene.p[22].w/(scene.p[22].w-scene.p[22].z)-scene.p[22].w*scene.p[22].z/((scene.p[22].w-scene.p[22].z)*cp.z),0.,1.)')
    .replace('let radius=dot(in.q,in.q);', 'let uvDx=dpdx(in.uv);let uvDy=dpdy(in.uv);let mediaDimensions=vec2f(textureDimensions(sourceFrame));let mediaLod=max(0.,log2(max(1.,max(length(uvDx*mediaDimensions),length(uvDy*mediaDimensions)))))*scene.p[21].y;let radius=dot(in.q,in.q);')
    .replace('if(radius>9.){discard;}var weight=exp(-.5*radius)*in.pigment.a;', 'let leafEdge=max(.02,fwidth(radius));let leafCoverage=1.-smoothstep(4.-leafEdge,4.+leafEdge,radius);if(radius>9.){discard;}var weight=select(exp(-.5*radius),leafCoverage,in.material==3u)*in.pigment.a;')
    .replace('sourceSampler,in.uv,0);var sampled=a;', 'sourceSampler,in.uv,mediaLod);var sampled=a;')
    .replace('i32(textureNumLayers(historyFrames))-1),0);', 'i32(textureNumLayers(historyFrames))-1),max(0.,mediaLod+log2(f32(textureDimensions(historyFrames).x)/f32(textureDimensions(sourceFrame).x))));')
    .replace('rgb=mix(rgb,linear(scene.p[18].rgb),depth*scene.p[7].z);', 'rgb=spatialFog(rgb,in.world,in.data.y);')
    .replace('let relief=.65+.55*max(0.,dot(in.normal,normalize(scene.p[19].xyz)));rgb=linear(rgb)*mix(1.,relief,scene.p[7].y);', 'let relief=.65+.55*max(0.,dot(in.normal,normalize(scene.p[19].xyz)));let leafLight=spatialMaterialLight(linear(rgb),in.world,in.normal,3u);rgb=select(linear(rgb)*mix(1.,relief,scene.p[7].y),leafLight,in.material==3u);')
    .replace('var p=in.uv;let aspect=', 'let screenRay=scene.p[4].xyz+scene.p[2].xyz*((in.uv.x-scene.p[5].z)/scene.p[5].x)+scene.p[3].xyz*((scene.p[5].w-in.uv.y)/scene.p[5].y);let direction=normalize(screenRay);let rayGradient=max(length(dpdx(direction)),length(dpdy(direction)));let backingGradient=max(length(dpdx(in.uv)*vec2f(textureDimensions(sourceFrame))),length(dpdy(in.uv)*vec2f(textureDimensions(sourceFrame))));if(scene.p[20].y>.5){let panorama=spatialPanorama(direction,rayGradient);return vec4f(linear(panorama.rgb)*panorama.a,panorama.a);}var p=in.uv;let aspect=')
    .replace('var source=textureSampleLevel(sourceFrame,sourceSampler,p,0);', 'let planeMagnification=select(1.,1./max(.0001,screenRay.z*screenRay.z),scene.p[10].w>0.);let backingLod=max(0.,log2(max(1.,backingGradient*planeMagnification)))*scene.p[21].y;var source=textureSampleLevel(sourceFrame,sourceSampler,p,backingLod);')
    .replace('100./99.95*q.z-5./99.95', 'scene.p[22].w/(scene.p[22].w-scene.p[22].z)*q.z-scene.p[22].w*scene.p[22].z/(scene.p[22].w-scene.p[22].z)')
    .replace('@location(2) @interpolate(flat,either) identity:u32 }', '@location(2) @interpolate(flat,either) identity:u32,@location(3) smoothNormal:vec3f,@location(4) @interpolate(flat,either) material:u32,@location(5) optics:vec3f }')
    .replace('@builtin(instance_index) identity:u32)->TerrainMesh', '@builtin(instance_index) identity:u32,@builtin(vertex_index) vertex:u32)->TerrainMesh')
    .replace('out.position=meshProjection(position);out.color=color;out.world=position;out.identity=identity;', 'out.world=spatialMeshWind(vertex,position);out.position=meshProjection(out.world);out.color=color;out.identity=identity;out.smoothNormal=spatialMeshNormal(vertex,position);out.material=spatialMeshMaterial(vertex);out.optics=spatialMeshOptics(vertex);')
    .replace('var rgb=linear(in.color);', 'let smoothLength=dot(in.smoothNormal,in.smoothNormal);let shadingNormal=select(normal,in.smoothNormal*inverseSqrt(max(smoothLength,1e-20)),smoothLength>1e-12);var rgb=spatialSurfaceLight(in.color,in.world,shadingNormal,in.material,in.optics);rgb=spatialFog(rgb,in.world,distance);')
    + IMMERSIVE_SHADER_FUNCTIONS;
