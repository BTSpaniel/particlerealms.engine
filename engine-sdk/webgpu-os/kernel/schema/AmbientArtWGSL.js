// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Pure procedural primitives shared by authored art programs and native lanes.
 * No resources, entry points, clocks or GPU ownership live in this module. */
export const AMBIENT_ART_WGSL = `
fn artHash21(p: vec2f) -> f32 {
 var q = fract(vec3f(p.xyx) * 0.1031); q += dot(q, q.yzx + vec3f(33.33));
 return fract((q.x + q.y) * q.z);
}
fn artHash31(p: vec3f) -> f32 {
 var q = fract(p * 0.1031); q += dot(q, q.zyx + vec3f(31.32));
 return fract((q.x + q.y) * q.z);
}
fn artNoise2(p: vec2f) -> f32 {
 let i = floor(p); let f = fract(p); let u = f*f*f*(f*(f*6.0-15.0)+10.0);
 return mix(mix(artHash21(i), artHash21(i+vec2f(1,0)), u.x), mix(artHash21(i+vec2f(0,1)), artHash21(i+vec2f(1,1)), u.x), u.y);
}
fn artNoise3(p: vec3f) -> f32 {
 let i=floor(p); let f=fract(p); let u=f*f*f*(f*(f*6.0-15.0)+10.0);
 return mix(mix(mix(artHash31(i),artHash31(i+vec3f(1,0,0)),u.x),mix(artHash31(i+vec3f(0,1,0)),artHash31(i+vec3f(1,1,0)),u.x),u.y),mix(mix(artHash31(i+vec3f(0,0,1)),artHash31(i+vec3f(1,0,1)),u.x),mix(artHash31(i+vec3f(0,1,1)),artHash31(i+vec3f(1,1,1)),u.x),u.y),u.z);
}
fn artRotate(p: vec2f, angle: f32) -> vec2f {
 let c=cos(angle); let s=sin(angle); return vec2f(c*p.x-s*p.y,s*p.x+c*p.y);
}
fn artFbm2(point: vec2f) -> f32 {
 var p=point; var value=0.0; var amplitude=0.5;
 for(var octave=0;octave<5;octave+=1) { value+=amplitude*artNoise2(p); p=artRotate(p,0.63)*2.03+vec2f(7.1,11.7); amplitude*=0.49; }
 return value;
}
fn artFbm3(point: vec3f) -> f32 {
 var p=point; var value=0.0; var amplitude=0.5;
 for(var octave=0;octave<5;octave+=1) { value+=amplitude*artNoise3(p); p=vec3f(p.y+p.z*.31,p.z-p.x*.23,p.x+p.y*.17)*1.91+vec3f(7.1,11.7,3.2); amplitude*=0.49; }
 return value;
}
fn artWarp(p: vec2f, time: f32) -> vec2f {
 let q=vec2f(artFbm2(p+vec2f(time*.021,2.7)),artFbm2(p+vec2f(8.3,-time*.018)));
 return p+vec2f(artFbm2(p+q*2.4+vec2f(1.7,9.2)),artFbm2(p+q*2.4+vec2f(8.1,3.6)))*1.8;
}
fn artSdBox(p: vec3f, halfSize: vec3f) -> f32 {
 let q=abs(p)-halfSize; return length(max(q,vec3f(0)))+min(max(q.x,max(q.y,q.z)),0.0);
}
fn artSdTorus(p: vec3f, radii: vec2f) -> f32 { return length(vec2f(length(p.xz)-radii.x,p.y))-radii.y; }
fn artSmoothMin(a:f32,b:f32,k:f32)->f32 { let h=clamp(.5+.5*(b-a)/k,0.,1.); return mix(b,a,h)-k*h*(1.-h); }
fn artSegment(p:vec2f,a:vec2f,b:vec2f)->f32 { let d=b-a; return length(p-a-d*clamp(dot(p-a,d)/max(dot(d,d),.00001),0.,1.)); }
`;
