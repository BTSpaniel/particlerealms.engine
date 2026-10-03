// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
import { particleEllipsoidWGSL } from '../shaders/modules/chunks/particle_ellipsoid.js';
import { SURFACE_RUNOFF_GRAVITY } from '../../sim/surfaceFields/SurfaceFieldRunoff.js';

/** Depth-correct SPH ellipsoid optics for retained airborne liquid parcels.
 * Composed with the surface material shader to share its optical properties.
 * The GPU evaluates trajectories; the chemical owner alone deposits mass.
 */
export const SURFACE_FIELD_RUNOFF_WGSL = /* wgsl */`
${particleEllipsoidWGSL}
struct RunoffParcel { originBirth:vec4f, velocityImpact:vec4f, optical:vec4f, destinationVolume:vec4f }
@group(0) @binding(11) var<storage,read> runoffParcels:array<RunoffParcel>;
struct RunoffVertex {
 @builtin(position) clip:vec4f,
 @location(0) position:vec3f,
 @location(1) @interpolate(flat) center:vec3f,
 @location(2) @interpolate(flat) radii:vec3f,
 @location(3) @interpolate(flat) optical:vec4f,
 @location(4) @interpolate(flat) valid:u32,
}
@vertex fn runoffVertex(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->RunoffVertex {
 let parcel=runoffParcels[instance];
 let time=frame.controls.w;
 let age=clamp(time-parcel.originBirth.w,0.0,max(0.0,parcel.velocityImpact.w-parcel.originBirth.w));
 let gravity=vec3f(0,-${SURFACE_RUNOFF_GRAVITY.toFixed(8)},0);
 let center=select(parcel.originBirth.xyz+parcel.velocityImpact.xyz*age+gravity*(.5*age*age),
  parcel.destinationVolume.xyz,time>=parcel.velocityImpact.w);
 let speed=length(parcel.velocityImpact.xyz+gravity*age);
 // A bounded, volume-preserving ellipsoid, not an enlarged opaque point.
 let stretch=1.0+min(.65,speed*.12);
 let radii=parcel.optical.x*vec3f(inverseSqrt(stretch),stretch,inverseSqrt(stretch));
 let right=normalize(vec3f(frame.vp[0].x,frame.vp[1].x,frame.vp[2].x));
 let up=normalize(vec3f(frame.vp[0].y,frame.vp[1].y,frame.vp[2].y));
 let q=QUAD[vertex];
 let position=center+(right*q.x+up*q.y)*max(radii.x,radii.y)*1.08;
 var out:RunoffVertex;
 out.position=position;out.center=center;out.radii=radii;out.optical=parcel.optical;
 out.valid=select(0u,1u,time>=parcel.originBirth.w && parcel.optical.x>0.0);
 out.clip=frame.vp*vec4f(position,1);return out;
}
struct RunoffFragment { @location(0) color:vec4f, @builtin(frag_depth) depth:f32 }
@fragment fn runoffFragment(in:RunoffVertex)->RunoffFragment {
 if(in.valid==0u || frame.viewportMode.z>.5){discard;}
 let ray=normalize(in.position-frame.eyeTime.xyz);
 let hit=intersectParticleEllipsoid(frame.eyeTime.xyz-in.center,ray,vec3f(1,0,0),vec3f(0,1,0),vec3f(0,0,1),in.radii);
 if(hit.w<.5){discard;}
 let point=frame.eyeTime.xyz+ray*hit.x;
 let normal=normalize((point-in.center)/(in.radii*in.radii));
 let clip=frame.vp*vec4f(point,1);
 let facing=max(dot(normal,-ray),.001);
 let oil=clamp(in.optical.y,0.0,1.0);let acid=clamp(in.optical.z/.30,0.0,1.0);
 let ior=mix(mix(1.333,ACID_IOR,acid),OIL_IOR,oil);
 let f0=pow((ior-1.0)/(ior+1.0),2.0);
 let fresnel=fresnelSchlickF0(facing,f0);
 let screenUV=in.clip.xy/frame.viewportMode.xy;
 let offset=normal.xz*min(.025,in.optical.x*.32);
 let transmitted=textureSampleLevel(scene,sceneSampler,clamp(screenUV+offset,vec2f(.002),vec2f(.998)),0).rgb;
 let absorption=mix(mix(vec3f(.38,.105,.035),ACID_ABSORPTION*45.0,acid),OIL_ABSORPTION*800.0,oil);
 let chord=max(0.0,hit.z-max(0.0,hit.y));
 let transmission=exp(-absorption*chord);
 let tint=mix(mix(vec3f(.018,.19,.25),ACID_COLOR,acid),OIL_COLOR,oil);
 var color=mix(tint,transmitted,transmission);
 color=mix(color,environment(reflect(ray,normal)),fresnel);
 // The shared environment already contains the finite key reflection.
 let fireOffset=surfaceFireLight.centreRadius.xyz-point;
 let fireDistance=length(fireOffset);
 if(surfaceFireLight.radiance.w>0.0 && fireDistance>.00001){
  let irradiance=min(vec3f(16),surfaceFireLight.radiance.rgb/max(fireDistance*fireDistance,surfaceFireLight.centreRadius.w*surfaceFireLight.centreRadius.w));
  color+=evaluatePBR(vec3f(.025),0.0,.12,normal,-ray,fireOffset/fireDistance)*irradiance;
 }
 var out:RunoffFragment;out.color=vec4f(color,1);out.depth=clamp(clip.z/clip.w,0.0,1.0);return out;
}
`;
