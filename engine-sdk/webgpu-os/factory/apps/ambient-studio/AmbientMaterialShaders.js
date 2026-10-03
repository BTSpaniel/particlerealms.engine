// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { AMBIENT_MATERIAL_CONTROLS } from '../../../kernel/schema/AmbientRecipeControls.js';
import { AMBIENT_OCEAN_SURFACE_WGSL, AMBIENT_OCEAN_WHITEWATER_WGSL } from '../../../kernel/drivers/AmbientOceanSurface.js';

/** Native translation of the supplied original six procedural materials.
 * The kernel owns all bindings, frame scheduling and final tone mapping.
 */
export const AMBIENT_COLLECTION_MATERIAL_TYPES_WGSL = `struct CollectionMaterial {
 resolution: vec4f, form: vec4f, compose: vec4f, finish: vec4f,
 c0: vec4f, c1: vec4f, c2: vec4f, c3: vec4f, pointer: vec4f,
}`;
const MATERIAL_WGSL = `
${AMBIENT_COLLECTION_MATERIAL_TYPES_WGSL}
// Original procedural materials. Analytic stylization, not fluid/depth reconstruction.
fn hash21(u: CollectionMaterial, _p:vec2f)->f32 {
var p = _p;
return fract(sin(dot(p,vec2f(127.1,311.7)))*43758.5453);}
fn noise2(u: CollectionMaterial, _p:vec2f)->f32 {
var p = _p;

 var i:vec2f = floor(p);var f:vec2f = fract(p);var w:vec2f = f*f*(vec2f(3.0)-2.0*f);
 return mix(mix(hash21(u,i),hash21(u,i+vec2f(1.0,0.0)),w.x),mix(hash21(u,i+vec2f(0.0,1.0)),hash21(u,i+vec2f(1.0,1.0)),w.x),w.y);
}
fn fbm(u: CollectionMaterial, _p:vec2f)->f32 {
var p = _p;

 var v:f32 = 0.0;var a:f32 = 0.5;
 for (var i = 0; i < 4; i += 1){v+=a*noise2(u,p);p=vec2f(p.x*1.62-p.y*1.17,p.x*1.17+p.y*1.62)+vec2f(5.2,3.7);a*=0.5;}
 return v;
}
fn rotate2(u: CollectionMaterial, _p:vec2f,_a:f32)->vec2f {
var p = _p;
var a = _a;
return vec2f(cos(a)*p.x-sin(a)*p.y,sin(a)*p.x+cos(a)*p.y);}
fn palette(u: CollectionMaterial, _x:f32)->vec3f {
var x = _x;

 var c:vec3f = mix(u.c0.rgb,u.c1.rgb,smoothstep(0.0,0.45,x));
 c=mix(c,u.c2.rgb,smoothstep(0.35,0.78,x));
 return mix(c,u.c3.rgb,smoothstep(0.76,1.0,x));
}
fn lum(u: CollectionMaterial, _c:vec3f)->f32 {
var c = _c;
return dot(c,vec3f(0.2126,0.7152,0.0722));}
fn silk(u: CollectionMaterial, _p:vec2f,_t:f32)->vec3f {
var p = _p;
var t = _t;

 var q:vec2f = rotate2(u,p,u.compose.x);q/=u.form.x;
 var s:f32 = u.compose.w*0.18;
 var curve:f32 = q.x*2.4+q.y*0.45+sin(q.y*3.4-t*.16+s)*(.28+u.form.z*1.65)+sin(q.x*1.8-q.y*1.6+t*.12)*.55;
 var wave:f32 = curve*3.1;
 var fold:f32 = 0.5+0.5*sin(wave);
 var micro:f32 = sin(wave*2.0+q.y*.7)*u.form.y*.16;
 var n:vec3f = normalize(vec3f(cos(wave)*(.7+u.form.z),cos(q.y*2.0-t*.16+s)*cos(wave)*.7,1.0+fold*.7));
 var l:vec3f = normalize(vec3f(-.6,-.75,1.4));
 var diffuse:f32 = max(dot(n,l),0.0);
 var spec:f32 = pow(max(dot(n,normalize(l+vec3f(0.0,0.0,1.0))),0.0),mix(8.0,65.0,u.form.w));
 var hue:f32 = .58+.26*sin(curve*.56+q.y*.8+s*.2)+micro;
 var c:vec3f = palette(u,clamp(hue,0.12,.92))*(.14+diffuse*.9)*(.5+.5*pow(fold,.38));
 c+=mix(u.c2.rgb,u.c3.rgb,.6)*spec*(.25+u.form.w*1.3);
 c+=u.c3.rgb*pow(1.0-fold,12.0)*(.06+u.form.w*.08);
 return c;
}
fn auroraField(u: CollectionMaterial, _p:vec2f,_t:f32)->vec3f {
var p = _p;
var t = _t;

 var a:vec2f = p-vec2f(-.52+sin(t*.13)*.18,.13+cos(t*.09)*.3);
 var b:vec2f = p-vec2f(.53+cos(t*.10)*.15,-.33);
 var c:vec2f = p-vec2f(.9,.43+sin(t*.17)*.12);
 var wa:f32 = exp(-dot(a,a)*2.1);var wb:f32 = exp(-dot(b,b)*2.6);var wc:f32 = exp(-dot(c,c)*3.0);
 return u.c0.rgb*.65+u.c1.rgb*wa*.95+u.c2.rgb*wb*1.1+u.c3.rgb*wc*.85;
}
fn glass(u: CollectionMaterial, _p:vec2f,_t:f32)->vec3f {
var p = _p;
var t = _t;

 var q:vec2f = rotate2(u,p,u.compose.x*.3);q/=u.form.x;
 var f:f32 = q.x*(16.0+u.form.y*55.0)+u.compose.w*.03;
 var nx:f32 = sin(f);var light:f32 = pow(max(0.0,cos(f-.9)),10.0);
 var reflected:vec2f = q+vec2f(nx*(.015+u.form.z*.15),cos(f)*.016);
 reflected+=vec2f(sin(q.y*2.0+t*.13)*u.form.z*.15,0.0);
 var col:vec3f = auroraField(u,reflected,t)*(0.85+.15*cos(f));
 col+=mix(u.c3.rgb,vec3f(1.0),.2)*light*u.form.w*.09;
 col+=auroraField(u,reflected+vec2f(.2,0.0),t)*pow(max(0.0,-cos(f)),18.0)*.09;
 return col;
}
fn smoothMin(u: CollectionMaterial, _a:f32,_b:f32,_k:f32)->f32 {
var a = _a;
var b = _b;
var k = _k;
var h:f32 = clamp(.5+.5*(b-a)/k,0.0,1.0);return mix(b,a,h)-k*h*(1.0-h);}
fn sculpture(u: CollectionMaterial, _p:vec3f,_t:f32)->f32 {
var p = _p;
var t = _t;

 var xy:vec2f = rotate2(u,p.xy,u.compose.x);p=vec3f(xy,p.z);
 var phase:f32 = t*.17+u.compose.w*.023;
 var d:f32 = length(p-vec3f(-.35+sin(phase)*.09,.1,.0))-.50;
 d=smoothMin(u,d,length(p-vec3f(.34,-.23+cos(phase)*.08,.10))-.47,.32+u.form.z*.22);
 d=smoothMin(u,d,length(p-vec3f(.17,.45,.03))-.34,.26);
 d=smoothMin(u,d,length(p-vec3f(-.41,-.48,.03))-.23,.22);
 return d+sin(p.x*7.0+phase)*sin(p.y*6.0)*sin(p.z*5.0)*u.form.y*.034;
}
fn environment(u: CollectionMaterial, _r:vec3f)->vec3f {
var r = _r;

 var band:f32 = pow(max(0.0,.5+.5*r.y),2.0);
 var box1:f32 = exp(-pow(abs((r.x+.25)*3.2),4.0)-pow(abs((r.y-.58)*7.0),4.0));
 var box2:f32 = exp(-pow(abs((r.x-.6)*7.0),4.0)-pow(abs((r.y+.12)*1.5),4.0));
 var floorLight:f32 = exp(-abs(r.y+.43)*22.0);
 return mix(u.c0.rgb*.28,u.c2.rgb*.7,band)+u.c3.rgb*box1*2.2+u.c1.rgb*box2*1.2+u.c3.rgb*floorLight*.42;
}
fn metal(u: CollectionMaterial, _p:vec2f,_t:f32)->vec3f {
var p = _p;
var t = _t;

 var ro:vec3f = vec3f(0.0,0.0,3.2);var rd:vec3f = normalize(vec3f(p/u.form.x*1.75,-2.7));
 var dist:f32 = 0.0;var stepD:f32 = 0.0;
 for (var i = 0; i < 64; i += 1){stepD=sculpture(u,ro+rd*dist,t);if(stepD<.001||dist>6.0){break;}dist+=stepD*.85;}
 var back:vec3f = u.c0.rgb*(.6+.5*exp(-dot(p,p)*1.5));
 back+=u.c1.rgb*.045*exp(-abs(p.y-.65)*8.0);
 if(dist>6.0){return back;}
 var x:vec3f = ro+rd*dist;var e:f32 = .002;
 var n:vec3f = normalize(vec3f(sculpture(u,x+vec3f(e,0.0,0.0),t)-sculpture(u,x-vec3f(e,0.0,0.0),t),sculpture(u,x+vec3f(0.0,e,0.0),t)-sculpture(u,x-vec3f(0.0,e,0.0),t),sculpture(u,x+vec3f(0.0,0.0,e),t)-sculpture(u,x-vec3f(0.0,0.0,e),t)));
 var reflected:vec3f = reflect(rd,n);var fres:f32 = pow(1.0-max(dot(-rd,n),0.0),4.0);
 var env:vec3f = environment(u,reflected);
 var diffuse:vec3f = mix(u.c1.rgb,u.c2.rgb,.6)*(.2+.5*max(0.0,dot(n,normalize(vec3f(-.5,-.7,1.0)))));
 var col:vec3f = mix(diffuse,env,.3+u.form.w*.7);
 col+=u.c3.rgb*fres*.28;
 return col;
}
fn ink(u: CollectionMaterial, _p:vec2f,_t:f32)->vec3f {
var p = _p;
var t = _t;

 var q:vec2f = rotate2(u,p,u.compose.x)/u.form.x*1.8+vec2f(u.compose.w*.07);
 var a:vec2f = vec2f(fbm(u,q+vec2f(t*.035,0.0)),fbm(u,q+vec2f(4.2,-t*.025)));
 var b:vec2f = vec2f(fbm(u,q+a*(2.0+u.form.z*4.0)+vec2f(1.7,9.2)),fbm(u,q+a*3.8+vec2f(8.3,2.8)));
 var f:f32 = fbm(u,q+b*(2.0+u.form.z*5.0));
 var lines:f32 = .5+.5*sin(f*(30.0+u.form.y*105.0)+a.x*4.0);
 var seam:f32 = pow(lines,28.0)*smoothstep(.28,.55,f);
 var pigment:f32 = clamp(f*1.55-.05,0.0,1.0);
 var col:vec3f = palette(u,pigment)*(.55+.5*b.x);
 col=mix(col,u.c0.rgb,smoothstep(.5,.96,lines)*.26*u.form.y);
 col+=u.c3.rgb*seam*u.form.w*.8;
 return col;
}
fn seaHeight(u: CollectionMaterial, _p:vec2f,_t:f32)->f32 {
var p = _p;
var t = _t;

 return sin(p.x*1.7+p.y*2.1-t*.7)*.6+sin(p.x*3.1-p.y*2.8+t*.48)*.26+sin(p.x*5.2+p.y*4.3-t*.9)*.13;
}
fn water(u: CollectionMaterial, _p:vec2f,_t:f32)->vec3f {
var p = _p;
var t = _t;

 var aspect:f32 = u.resolution.x / max(u.resolution.y, 1.0);
 var uv:vec2f = p/vec2f(aspect,1.0)+vec2f(.5);
 var horizon:f32 = .43;var depth:f32 = uv.y-horizon;
 var moonX:f32 = (u.compose.y-.5)*aspect;var mp:vec2f = p-vec2f(moonX,-.23);
 var moon:f32 = 1.0-smoothstep(.034,.039,length(mp));
 var halo:f32 = exp(-dot(mp,mp)*17.0);
 var sky:vec3f = mix(u.c0.rgb*.44,u.c1.rgb*.2,smoothstep(-.5,-.07,p.y))+u.c2.rgb*halo*.14+u.c3.rgb*moon*(.5+u.form.w);
 if(depth<0.0){return sky;}
 var z:f32 = 1.0/(depth+.065);var q:vec2f = vec2f(p.x*z, z*1.45)*u.form.x;
 q=rotate2(u,q,u.compose.x);t+=u.compose.w*.17;
 var h:f32 = seaHeight(u,q,t);var fine:f32 = sin(q.x*8.0+q.y*4.0+h*2.0-t)*sin(q.x*3.0-q.y*7.0+t*.5);
 var glint:f32 = pow(clamp(.5+.5*(h*.65+fine*u.form.y*.35),0.0,1.0),7.0);
 var road:f32 = exp(-pow(abs((p.x-moonX+h*.012*u.form.z)/(depth*.26+.018)),2.0));
 var col:vec3f = mix(u.c1.rgb*.15,u.c0.rgb*.6,smoothstep(0.0,.55,depth));
 col+=u.c2.rgb*glint*(.16+depth*.16);
 col+=u.c3.rgb*road*glint*(.7+u.form.w*2.8);
 col+=u.c1.rgb*exp(-depth*90.0)*.14;
 return col;
}
fn atmosphere(u: CollectionMaterial, _p:vec2f,_t:f32)->vec3f {
var p = _p;
var t = _t;

 p=rotate2(u,p,u.compose.x*.2);
 var aspect:f32 = u.resolution.x / max(u.resolution.y, 1.0);
 var sunX:f32 = (u.compose.y-.5)*aspect;
 var mp:vec2f = p-vec2f(sunX,-.22);
 var halo:f32 = exp(-dot(mp,mp)*3.2);
 var sun:f32 = 1.0-smoothstep(.065,.067,length(mp));
 var col:vec3f = mix(u.c0.rgb,u.c2.rgb*.55,clamp(p.y+.65,0.0,1.0));
 col+=u.c3.rgb*(halo*.28+sun*.75)*(.5+u.form.w*.8);
 for (var i = 0; i < 7; i += 1){
  var fi:f32 = f32(i);var parallax:f32 = (fi+1.0)*.007;
  var xx:f32 = p.x/u.form.x+u.compose.w*.06+sin(t*.07)*parallax;
  var ridge:f32 = -.03+fi*.067+sin(xx*(1.9+fi*.13)+fi*1.7)*(.055+u.form.z*.035);
  ridge+=(fbm(u,vec2f(xx*(2.2+fi*.38),fi*2.3))-0.5)*(.15+u.form.y*.23);
  var mask:f32 = smoothstep(ridge-.0015,ridge+.0015,p.y);
  var hill:vec3f = mix(u.c2.rgb*.55,u.c0.rgb*.36,fi/6.0);
  hill+=u.c3.rgb*halo*.07*(1.0-fi/7.0);
  col=mix(col,hill,mask);
 }
 return col;
}
`;

export const AMBIENT_MATERIAL_DEFINITIONS = Object.freeze([
    material('pearlescent-silk', 'Pearlescent silk', 'Light caught in a slow, iridescent fold.', 0, 3184, ['#101629', '#768dec', '#c9a6e7', '#ffe0bb'], { angle: -24, scale: 0.92, warp: 0.62, gloss: 0.72, exposure: 0.25 }),
    material('aurora-glass', 'Aurora glass', 'A sculpted glass lens bends soft studio light.', 1, 6247, ['#1d1238', '#a060c2', '#f59b88', '#ffe3a8'], { scale: 1.06, warp: 0.62, gloss: 0.68, detail: 0.54, speed: 0.22 }),
    material('liquid-metal', 'Liquid metal', 'A liquid sculpture under soft studio light.', 2, 7812, ['#080c14', '#526782', '#aabacb', '#edf2f3'], { warp: 0.4, detail: 0.35, gloss: 0.83, speed: 0.25, angle: -14 }),
    material('mineral-ink', 'Mineral ink', 'Pigment currents with a fine mineral seam.', 3, 1298, ['#031d27', '#1c96a9', '#64d9b8', '#e0f5e6'], { scale: 1.08, warp: 0.65, detail: 0.48, gloss: 0.4, speed: 0.16, angle: 16 }),
    material('moonlit-water', 'Moonlit water', 'A silver path across an unhurried ocean.', 4, 5471, ['#101629', '#768dec', '#c9a6e7', '#ffe0bb'], { detail: 0.62, warp: 0.35, gloss: 0.62, speed: 0.22, focusX: 0.67, vignette: 0.18 }),
    material('atmospheric-depth', 'Atmospheric depth', 'Sunlit mountain faces above a winding, mist-filled valley.', 5, 9321, ['#211b31', '#675791', '#d58a58', '#ffe1a0'], { scale: 0.8, detail: 0.35, warp: 0.4, gloss: 0.45, speed: 0.12, focusX: 0.68, vignette: 0.12 }),
]);

export const AMBIENT_MATERIAL_CONTROL_SPECS = AMBIENT_MATERIAL_CONTROLS;

const REFINED_WGSL = `
fn materialContact(u: CollectionMaterial, p: vec2f) -> f32 {
 let uv = p / vec2f(u.resolution.x / max(u.resolution.y, 1.0), 1.0) + vec2f(0.5);
 let delta = uv - u.pointer.xy;
 return exp(-dot(delta, delta) / 0.015) * u.pointer.z;
}
fn refinedSilk(u: CollectionMaterial, p: vec2f, t: f32) -> vec3f {
 var color = silk(u, p, t);
 let q = rotate2(u, p, u.compose.x) / u.form.x;
 let fiberPhase = q.y * 920.0 + sin(q.x * 3.1) * 8.0;
 let resolved = 1.0 - smoothstep(0.75, 2.5, fwidth(fiberPhase));
 let fibers = sin(fiberPhase) * resolved * 0.005 * u.form.y;
 color += mix(u.c2.rgb, u.c3.rgb, 0.58) * fibers;
 return color * (0.96 + 0.04 * smoothstep(-0.6, 0.5, q.x)) + u.c3.rgb * materialContact(u, p) * 0.008;
}
fn refinedGlass(u: CollectionMaterial, p: vec2f, t: f32) -> vec3f {
 let aspect = u.resolution.x / max(u.resolution.y, 1.0);
 let uv = p / vec2f(aspect, 1.0) + vec2f(0.5);
 let contact = materialContact(u, p);
 let q = rotate2(u, p - (uv - u.pointer.xy) * contact * 0.45 * vec2f(aspect, 1.0), u.compose.x * 0.3) / u.form.x;
 let phase = q.x * (16.0 + u.form.y * 55.0) + u.compose.w * 0.03;
 let cylinder = sin(phase); let slope = cos(phase);
 let lens = q + vec2f(cylinder * (0.036 + u.form.z * 0.16) + sin(q.y * 2.2 + t * 0.11) * u.form.z * 0.13, slope * 0.024);
 let dispersion = 0.004 + u.form.w * 0.011;
 let a = auroraField(u, lens + vec2f(dispersion * cylinder, 0.0), t);
 let b = auroraField(u, lens - vec2f(dispersion * cylinder, 0.0), t);
 var color = vec3f(a.r, auroraField(u, lens, t).g, b.b);
 color *= (0.90 + 0.10 * cos(q.y * 1.6 + q.x * 0.5)) * (0.72 + 0.28 * sqrt(max(0.0, 1.0 - cylinder * cylinder)));
 let panel = exp(-pow(abs((lens.y + 0.22 + lens.x * 0.22) / 0.18), 2.0));
 color += mix(u.c2.rgb, u.c3.rgb, 0.65) * panel * 0.14;
 color += u.c3.rgb * exp(-pow(abs((slope - 0.72) / 0.23), 2.0)) * (0.025 + u.form.w * 0.14);
 color += mix(u.c1.rgb, u.c3.rgb, 0.5) * pow(max(0.0, 1.0 - abs(sin(phase + 0.18))), 19.0) * 0.035;
 return color * (0.96 - 0.09 * pow(max(0.0, -slope), 4.0));
}
fn studioMetalSdf(u: CollectionMaterial, point: vec3f, t: f32) -> f32 {
 var p = point;
 let magnet = (u.pointer.xy - vec2f(0.5) - vec2f((u.compose.y - 0.5) * 0.35, 0.0)) * vec2f(u.resolution.x / max(u.resolution.y, 1.0), 1.0) * 1.588 / u.form.x;
 let delta = p.xy - magnet;
 p.z -= exp(-dot(delta, delta) / 0.15) * u.pointer.z * 0.08;
 p = vec3f(rotate2(u, p.xy, u.compose.x * 0.65), p.z);
 let q = p.xy * vec2f(0.91, 1.09); let angle = atan2(q.y, q.x);
 let phase = t * 0.09 + u.compose.w * 0.013;
 let center = 0.64 + 0.06 * sin(angle * 3.0 + phase) + 0.03 * cos(angle * 5.0 - phase * 0.7) * u.form.y;
 let z = 0.12 * sin(angle * 2.0 + phase) + 0.07 * cos(angle * 3.0 - phase);
 let tube = 0.19 + 0.05 * sin(angle + phase * 0.4) + u.form.z * 0.053;
 let distance = length(vec2f(length(q) - center, p.z - z)) - tube;
 return smoothMin(u, distance, length(p - vec3f(-0.43, -0.37, 0.06)) - 0.265, 0.20);
}
fn refinedMetal(u: CollectionMaterial, p: vec2f, t: f32) -> vec3f {
 let ro = vec3f(0.0, 0.0, 3.2); let rd = normalize(vec3f(p / u.form.x * 1.34, -2.7));
 var travel = 0.0; var hit = false;
 for (var i = 0; i < 72; i += 1) {
  let distance = studioMetalSdf(u, ro + rd * travel, t);
  if (distance < 0.001) { hit = true; break; }
  travel += max(0.0005, distance * 0.8); if (travel > 5.0) { break; }
 }
 var background = u.c0.rgb * (0.58 + 0.24 * exp(-dot(p, p) * 1.6));
 background *= 1.0 - exp(-pow(abs(p.x / 0.65), 2.0) - pow(abs((p.y - 0.39) / 0.055), 2.0)) * 0.45;
 if (!hit) { return background; }
 let x = ro + rd * travel; let e = 0.0014;
 let normal = normalize(vec3f(
  studioMetalSdf(u, x + vec3f(e, 0.0, 0.0), t) - studioMetalSdf(u, x - vec3f(e, 0.0, 0.0), t),
  studioMetalSdf(u, x + vec3f(0.0, e, 0.0), t) - studioMetalSdf(u, x - vec3f(0.0, e, 0.0), t),
  studioMetalSdf(u, x + vec3f(0.0, 0.0, e), t) - studioMetalSdf(u, x - vec3f(0.0, 0.0, e), t)));
 let r = reflect(rd, normal); let ndv = clamp(dot(-rd, normal), 0.0, 1.0);
 // WGSL pow has no defined result for a negative base, even with an even exponent.
 let upper = exp(-pow(abs((r.y + 0.26 * r.x - 0.42) / 0.22), 4.0));
 let side = exp(-pow(abs((r.x + 0.61 - r.y * 0.24) / 0.10), 4.0));
 let warm = exp(-pow(abs((r.y + 0.40) / 0.12), 4.0));
 let reflected = u.c0.rgb * 0.30 + u.c2.rgb * (0.07 + 0.10 * max(r.y, 0.0)) + u.c3.rgb * (upper * 0.9 + warm * 0.24) + u.c1.rgb * side * 0.60;
 let diffuse = mix(u.c1.rgb, u.c2.rgb, 0.5) * (0.1 + 0.18 * max(0.0, normal.y));
 var color = mix(diffuse, reflected * (0.66 + 0.34 * pow(1.0 - ndv, 5.0)), 0.4 + u.form.w * 0.6);
 color *= clamp(0.75 + x.z * 0.55, 0.55, 1.0);
 return color + mix(u.c2.rgb, u.c3.rgb, 0.55) * pow(1.0 - ndv, 3.0) * 0.050;
}
fn refinedInk(u: CollectionMaterial, p: vec2f, t: f32) -> vec3f {
 let aspect = u.resolution.x / max(u.resolution.y, 1.0);
 let delta = p / vec2f(aspect, 1.0) + vec2f(0.5) - u.pointer.xy;
 let stir = vec2f(-delta.y, delta.x) * materialContact(u, p) * 1.2;
 let q = rotate2(u, p - stir * vec2f(aspect, 1.0), u.compose.x) / u.form.x * 1.45 + vec2f(u.compose.w * 0.07);
 let a = vec2f(fbm(u, q + vec2f(t * 0.035, 0.0)), fbm(u, q + vec2f(4.2, -t * 0.025)));
 let b = vec2f(fbm(u, q + a * (2.0 + u.form.z * 3.0) + vec2f(1.7, 9.2)), fbm(u, q + a * 3.8 + vec2f(8.3, 2.8)));
 let field = fbm(u, q + b * (2.0 + u.form.z * 4.0));
 var color = palette(u, clamp(smoothstep(0.19, 0.77, field) * 0.91 + 0.04, 0.0, 1.0)) * (0.52 + 0.38 * b.x);
 let phase = field * (18.0 + u.form.y * 53.0) + a.x * 4.0; let line = sin(phase);
 let aa = max(fwidth(line), 0.001);
 let seam = (1.0 - smoothstep(0.075 - aa, 0.075 + aa, abs(line))) * (1.0 - smoothstep(0.28, 1.4, fwidth(phase))) * smoothstep(0.35, 0.6, fbm(u, q * 0.6 + vec2f(8.0, 0.0)));
 color *= 0.8 + 0.2 * smoothstep(0.2, 0.4, abs(line));
 return color + u.c3.rgb * seam * (0.06 + u.form.w * 0.19) + u.c2.rgb * pow(0.5 + 0.5 * sin(field * 9.0 - a.y), 3.0) * 0.042;
}
`;

/** Values are validated numbers; authored WGSL cannot introduce a binding. */
export function createLegacyAmbientMaterialSource(id, settings = {}) {
    const definition = AMBIENT_MATERIAL_DEFINITIONS.find(entry => entry.id === id);
    if (!definition) throw new RangeError(`Unknown material '${id}'.`);
    const params = { ...definition.params };
    for (const [key, spec] of Object.entries(AMBIENT_MATERIAL_CONTROL_SPECS)) {
        const value = Number(settings[key]);
        if (Number.isFinite(value)) params[key] = Math.min(spec.max, Math.max(spec.min, value));
    }
    const vector = values => `vec4f(${values.map(number).join(', ')})`;
    const colors = definition.palette.map(color => vector([...hexRgb(color), 1]));
    const fn = ['refinedSilk', 'refinedGlass', 'refinedMetal', 'refinedInk', 'water', 'atmosphere'][definition.index];
    return `${MATERIAL_WGSL}\n${REFINED_WGSL}\nfn paintAmbient(uv: vec2f, frame: AmbientV3Frame) -> vec4f {
 let time = select(frame.resolutionTime.z * frame.tone.x, 0.0, frame.effects.w > 0.5);
 let pointer = vec4f(frame.pointer.xy, frame.pointerState.x * frame.effects.x * (1.0 - frame.effects.w), 0.0);
 let u = CollectionMaterial(vec4f(frame.resolutionTime.xy, time, ${number(definition.index)}),
  ${vector([params.scale, params.detail, params.warp, params.gloss])},
  ${vector([params.angle * Math.PI / 180, params.focusX, params.quiet, definition.seed])},
  ${vector([0, params.grain, params.vignette, 1])}, ${colors.join(', ')}, pointer);
 let aspect = frame.resolutionTime.x / max(frame.resolutionTime.y, 1.0);
 var p = (vec2f(uv.x, 1.0 - uv.y) - vec2f(0.5)) * vec2f(aspect, 1.0);
 p.x -= (u.compose.y - 0.5) * aspect * 0.35;
 p += (pointer.xy - vec2f(0.5)) * pointer.z * 0.035;
 var color = ${fn}(u, p, time);
 let quiet = 1.0 - smoothstep(0.0, max(0.001, u.compose.z), uv.x);
 color = mix(color, u.c0.rgb * 0.5, quiet * min(1.0, u.compose.z * 2.8));
 color *= clamp(1.0 - dot(uv - vec2f(0.5), uv - vec2f(0.5)) * u.finish.z * 2.6, 0.2, 1.0);
 color += vec3f((hash21(u, uv * frame.resolutionTime.xy + vec2f(u.compose.w)) - 0.5) * u.finish.y * 0.18);
 return vec4f(max(color, vec3f(0.0)), 1.0);
}`.trim();
}

export function createPreviousAmbientMaterialSource(id, settings = {}) {
    let source = createLegacyAmbientMaterialSource(id, settings);
    const change = (before, after) => {
        if (!source.includes(before)) throw new Error(`Material source '${id}' changed at '${before.slice(0, 48)}'`);
        source = source.replaceAll(before, after);
    };
    if (id === 'pearlescent-silk') {
        change('var spec:f32 = pow(max(dot(n,normalize(l+vec3f(0.0,0.0,1.0))),0.0),mix(8.0,65.0,u.form.w));', 'let halfLight = normalize(l + vec3f(0.0, 0.0, 1.0));\n var spec:f32 = pow(max(dot(n, halfLight), 0.0), mix(8.0, 65.0, u.form.w));\n let grazing = pow(1.0 - max(n.z, 0.0), 3.0);\n let satin = pow(max(1.0 - abs(dot(normalize(vec3f(-n.y, n.x, 0.2)), halfLight)), 0.0), 16.0) * grazing;\n spec += satin * 0.16;');
    } else if (id === 'aurora-glass') {
        change('let cylinder = sin(phase); let slope = cos(phase);', 'let fluteResolution = 1.0 - smoothstep(0.7, 2.5, fwidth(phase));\n let cylinder = sin(phase) * fluteResolution; let slope = cos(phase) * fluteResolution;');
    } else if (id === 'liquid-metal') {
        change('let ro = vec3f(0.0, 0.0, 3.2); let rd = normalize(vec3f(p / u.form.x * 1.34, -2.7));', 'let ro = vec3f(0.0, 0.0, 3.2);\n let objectFit = max(1.0, 1.70 / (u.resolution.x / max(u.resolution.y, 1.0)));\n let rd = normalize(vec3f(p * objectFit / u.form.x * 1.34, -2.7));');
        change('return color + mix(u.c2.rgb, u.c3.rgb, 0.55) * pow(1.0 - ndv, 3.0) * 0.050;', 'let cavity = smoothstep(0.04, 0.24, studioMetalSdf(u, x + normal * 0.22, t));\n return color * (0.82 + cavity * 0.18) + mix(u.c2.rgb, u.c3.rgb, 0.55) * pow(1.0 - ndv, 3.0) * 0.050;');
    } else if (id === 'mineral-ink') {
        change('return color + u.c3.rgb * seam * (0.06 + u.form.w * 0.19)', 'let pooling = smoothstep(0.02, 0.25, abs(line));\n color *= 0.88 + 0.12 * pooling;\n return color + u.c3.rgb * seam * (0.06 + u.form.w * 0.19)');
    } else if (id === 'moonlit-water') {
        change('var glint:f32 = pow(clamp(.5+.5*(h*.65+fine*u.form.y*.35),0.0,1.0),7.0);', 'let footprint = z * z * 1.45 * u.form.x / max(u.resolution.y, 1.0);\n fine *= 1.0 - smoothstep(0.12, 0.7, footprint);\n var glint:f32 = pow(clamp(.5+.5*(h*.65+fine*u.form.y*.35),0.0,1.0),7.0);');
        change('col+=u.c1.rgb*exp(-depth*90.0)*.14;', 'col+=u.c1.rgb*exp(-depth*90.0)*.14;\n let horizonMist = exp(-depth * 22.0);\n col = mix(col, mix(u.c1.rgb, u.c2.rgb, 0.38) * 0.14, horizonMist * 0.28);');
    } else if (id === 'atmospheric-depth') {
        change('var mask:f32 = smoothstep(ridge-.0015,ridge+.0015,p.y);', 'let edgeWidth = max(fwidth(p.y - ridge), 0.0007);\n var mask:f32 = smoothstep(ridge-edgeWidth,ridge+edgeWidth,p.y);');
        change('hill+=u.c3.rgb*halo*.07*(1.0-fi/7.0);', 'hill+=u.c3.rgb*halo*.07*(1.0-fi/7.0);\n let aerial = exp(-fi * 0.36) * 0.22;\n hill = mix(hill, mix(u.c2.rgb, u.c3.rgb, 0.32) * 0.5, aerial);');
    }
    return source;
}

// The prior generators are kept byte-stable for saved generated-source migration.
// These functions remain pure paint sources: no resources, bindings, or hidden state.
const SCULPTED_MATERIAL_WGSL = `
fn artGaussian(x: f32, width: f32) -> f32 { let q = x / width; return exp(-q * q); }
fn artSilkHeight(u: CollectionMaterial, point: vec2f, t: f32) -> f32 {
 let q = point + vec2f(sin(t * 0.055) * 0.024, cos(t * 0.047) * 0.017);
 let bend = q.x - sin(q.y * 2.35 + 0.42) * (0.13 + u.form.z * 0.16) - q.y * q.y * 0.21;
 let opening = 0.085 + 0.085 * smoothstep(-0.45, 0.50, q.y);
 let primary = 0.26 * artGaussian(bend - 0.13, opening) - 0.14 * artGaussian(bend + 0.045, opening * 0.65);
 let secondary = 0.17 * artGaussian(bend + 0.43 + q.y * 0.14, 0.21) - 0.11 * artGaussian(bend + 0.27 + q.y * 0.10, 0.070);
 let farFold = 0.11 * artGaussian(bend - 0.55 + q.y * 0.11, 0.25);
 let drape = -q.x * 0.065 + sin(q.y * 1.45) * 0.045;
 return primary + secondary + farFold + drape;
}
fn sculptedSilk(u: CollectionMaterial, point: vec2f, t: f32) -> vec3f {
 let q = rotate2(u, point, u.compose.x) / u.form.x;
 let h = artSilkHeight(u, q, t); let e = 0.0018;
 let gradient = vec2f(artSilkHeight(u, q + vec2f(e, 0.0), t) - artSilkHeight(u, q - vec2f(e, 0.0), t), artSilkHeight(u, q + vec2f(0.0, e), t) - artSilkHeight(u, q - vec2f(0.0, e), t)) / (2.0 * e);
 let normal = normalize(vec3f(-gradient, 1.0));
 let key = normalize(vec3f(-0.55, -0.65, 1.2)); let fill = normalize(vec3f(0.8, 0.2, 0.6));
 var visibility = 1.0;
 for (var i = 1; i < 5; i += 1) {
  let d = f32(i) * 0.045;
  visibility = min(visibility, 1.0 - clamp((artSilkHeight(u, q + key.xy * d, t) - h - key.z * d) * 7.0, 0.0, 0.75));
 }
 let incidence = clamp(dot(normal, key), 0.0, 1.0);
 let grazing = pow(1.0 - clamp(normal.z, 0.0, 1.0), 2.0);
 let filmPhase = 2.8 + normal.x * 2.5 + normal.y * 1.7 + h * 1.5;
 let film = 0.5 + 0.5 * cos(vec3f(0.2, 2.25, 4.4) + vec3f(filmPhase));
 let pearl = mix(u.c2.rgb, u.c3.rgb, 0.57) * 0.80;
 let tint = mix(u.c1.rgb, u.c2.rgb, film.b) * (0.74 + film * 0.26);
 let pigment = mix(pearl, tint, 0.13 + grazing * 0.35);
 let halfKey = normalize(key + vec3f(0.0, 0.0, 1.0));
 let specular = pow(max(dot(normal, halfKey), 0.0), 24.0 + u.form.w * 100.0);
 let tangent = normalize(vec3f(1.0, 0.0, gradient.x));
 let anisotropy = pow(max(0.0, 1.0 - abs(dot(tangent, halfKey))), 14.0) * grazing;
 var color = pigment * (0.055 + 0.88 * incidence * visibility + 0.065 * max(dot(normal, fill), 0.0));
 color += mix(u.c3.rgb, vec3f(0.78, 0.91, 1.0), film.r) * (specular * (0.35 + u.form.w * 0.65) + anisotropy * 0.32);
 color += mix(u.c0.rgb, u.c1.rgb, 0.12) * (0.15 + 0.14 * (1.0 - visibility));
 let fiberPhase = (q.y + q.x * 0.17 + h * 0.16) * 1250.0;
 let fiberAA = 1.0 - smoothstep(0.8, 2.5, fwidth(fiberPhase));
 color *= 1.0 + sin(fiberPhase) * fiberAA * u.form.y * 0.025;
 return color + u.c3.rgb * materialContact(u, point) * 0.022;
}
fn artGlassSdf(u: CollectionMaterial, point: vec3f, t: f32) -> f32 {
 var p = point;
 p = vec3f(rotate2(u, p.xy, -0.28 + u.compose.x * 0.35), p.z);
 p.x -= sin(p.y * 2.7 + t * 0.045) * (0.12 + u.form.z * 0.12);
 let twist = p.y * 0.48 + sin(t * 0.04) * 0.06;
 p = vec3f(rotate2(u, p.xz, twist).x, p.y, rotate2(u, p.xz, twist).y);
 let radii = vec3f(0.49, 0.77, 0.28);
 let k0 = length(p / radii); let k1 = length(p / (radii * radii));
 let ellipsoid = k0 * (k0 - 1.0) / max(k1, 0.001);
 let cutA = dot(p, normalize(vec3f(0.42, -0.18, 1.0))) - (0.26 - u.form.y * 0.055);
 let cutB = dot(p, normalize(vec3f(-0.55, 0.30, 1.0))) - (0.28 - u.form.y * 0.055);
 let faceted = -smoothMin(u, smoothMin(u, -ellipsoid, -cutA, 0.035), -cutB, 0.035);
 let drop = length((p - vec3f(0.42, -0.39, -0.025)) / vec3f(1.0, 1.22, 0.9)) - 0.23;
 return smoothMin(u, faceted, drop, 0.16);
}
fn artGlassBackdrop(u: CollectionMaterial, p: vec2f, t: f32) -> vec3f {
 let arc = p.y - 0.20 * sin(p.x * 2.1 + t * 0.045) + p.x * 0.35;
 let warm = artGaussian(arc + 0.15, 0.26);
 let cool = artGaussian(arc - 0.36, 0.35);
 let bloom = exp(-dot(p - vec2f(-0.48, -0.28), p - vec2f(-0.48, -0.28)) * 2.4);
 let vein = artGaussian(arc + 0.10 + sin(p.x * 2.8) * 0.12, 0.036);
 let blue = mix(u.c1.rgb, vec3f(0.12, 0.48, 0.66), 0.48);
 let amber = mix(u.c2.rgb, u.c3.rgb, 0.65);
 return u.c0.rgb * 0.30 + blue * (0.025 + 0.12 * cool) + amber * warm * 0.16 + u.c3.rgb * bloom * 0.095 + amber * vein * 0.23;
}
fn sculptedGlass(u: CollectionMaterial, point: vec2f, t: f32) -> vec3f {
 let aspect = u.resolution.x / max(u.resolution.y, 1.0);
 let fit = max(1.0, 0.88 / aspect);
 let ro = vec3f(0.0, 0.0, 3.1); let rd = normalize(vec3f(point * fit / u.form.x * 1.75, -2.8));
 var travel = 0.0; var hit = false;
 for (var i = 0; i < 64; i += 1) { let d = artGlassSdf(u, ro + rd * travel, t); if (d < 0.0008) { hit = true; break; } travel += max(d * 0.76, 0.0005); if (travel > 5.2) { break; } }
 let backdrop = artGlassBackdrop(u, point, t);
 if (!hit) { return backdrop; }
 let p = ro + rd * travel; let e = 0.0015;
 let n = normalize(vec3f(artGlassSdf(u, p + vec3f(e, 0.0, 0.0), t) - artGlassSdf(u, p - vec3f(e, 0.0, 0.0), t), artGlassSdf(u, p + vec3f(0.0, e, 0.0), t) - artGlassSdf(u, p - vec3f(0.0, e, 0.0), t), artGlassSdf(u, p + vec3f(0.0, 0.0, e), t) - artGlassSdf(u, p - vec3f(0.0, 0.0, e), t)));
 let refraction = refract(rd, n, 1.0 / 1.47);
 var thickness = 0.012;
 for (var i = 0; i < 36; i += 1) { let inside = p + refraction * thickness; let distance = artGlassSdf(u, inside, t); if (distance > -0.0008 && thickness > 0.020) { break; } thickness += max(abs(distance) * 0.72, 0.002); if (thickness > 1.6) { break; } }
 let exitPoint = p + refraction * thickness;
 let exitNormal = normalize(vec3f(artGlassSdf(u, exitPoint + vec3f(e, 0.0, 0.0), t) - artGlassSdf(u, exitPoint - vec3f(e, 0.0, 0.0), t), artGlassSdf(u, exitPoint + vec3f(0.0, e, 0.0), t) - artGlassSdf(u, exitPoint - vec3f(0.0, e, 0.0), t), artGlassSdf(u, exitPoint + vec3f(0.0, 0.0, e), t) - artGlassSdf(u, exitPoint - vec3f(0.0, 0.0, e), t)));
 let transmission = refract(refraction, -exitNormal, 1.47);
 let outgoing = select(transmission, reflect(refraction, -exitNormal), dot(transmission, transmission) < 0.001);
 let backDistance = max(0.0, (exitPoint.z + 1.4) / max(-outgoing.z, 0.1));
 let lens = (exitPoint.xy + outgoing.xy * backDistance) * (2.8 / (4.5 * 1.75)) * u.form.x / fit;
 let spread = (0.005 + 0.022 * u.form.w) * (1.0 - n.z * n.z);
 let red = artGlassBackdrop(u, lens + n.xy * spread, t).r;
 let green = artGlassBackdrop(u, lens, t).g;
 let blue = artGlassBackdrop(u, lens - n.xy * spread, t).b;
 let fresnel = 0.04 + 0.96 * pow(1.0 - clamp(dot(-rd, n), 0.0, 1.0), 5.0);
 let r = reflect(rd, n);
 let longBox = exp(-pow(abs((r.x + 0.52 + r.y * 0.20) / 0.10), 2.0) - pow(abs((r.y + 0.08) / 0.72), 4.0));
 let broadBox = exp(-pow(abs((r.y + r.x * 0.22 - 0.44) / 0.31), 2.0));
 let edgeBox = artGaussian(r.x - r.y * 0.55 - 0.58, 0.045);
 let absorption = exp(-vec3f(0.10, 0.06, 0.035) * thickness);
 var color = vec3f(red, green, blue) * absorption * (1.0 - fresnel * 0.65);
 color += mix(u.c1.rgb, u.c3.rgb, 0.40) * broadBox * (0.018 + fresnel * 0.28);
 color += u.c3.rgb * (longBox * (0.025 + u.form.w * 0.30) + edgeBox * fresnel * 0.72);
 let interior = artGaussian(lens.y + sin(lens.x * 2.0) * 0.18, 0.022);
 color += mix(u.c2.rgb, u.c3.rgb, 0.4) * interior * (0.04 + 0.12 * u.form.z);
 return color;
}
fn sculptedInk(u: CollectionMaterial, point: vec2f, t: f32) -> vec3f {
 let aspect = u.resolution.x / max(u.resolution.y, 1.0);
 let delta = point / vec2f(aspect, 1.0) + vec2f(0.5) - u.pointer.xy;
 let stir = vec2f(-delta.y, delta.x) * materialContact(u, point) * 0.9;
 var q = rotate2(u, point - stir * vec2f(aspect, 1.0), u.compose.x) / u.form.x * 1.70;
 let center = q - vec2f(0.15, 0.18);
 q = rotate2(u, center, 1.75 * exp(-dot(center, center) * 1.2)) + vec2f(0.15, 0.18);
 q += vec2f(t * 0.012, -t * 0.009);
 let a = vec2f(fbm(u, q * 1.45 + vec2f(2.7, 8.1)), fbm(u, q * 1.45 + vec2f(7.3, 1.4)));
 let flow = q + (a - vec2f(0.5)) * (1.1 + u.form.z * 2.0);
 let b = vec2f(fbm(u, flow * 2.8 + vec2f(1.3, 9.0)), fbm(u, flow * 2.8 + vec2f(6.7, 3.4)));
 let warped = flow + (b - vec2f(0.5)) * 0.66;
 let field = fbm(u, warped * 2.5);
 let mainCurrent = artGaussian(flow.y + 0.16 * sin(flow.x * 2.4) - 0.12, 0.36);
 let body = smoothstep(0.25, 0.67, field) * (0.50 + 0.50 * mainCurrent);
 let deep = u.c0.rgb * vec3f(0.60, 0.75, 1.10);
 let teal = u.c1.rgb * vec3f(0.60, 0.89, 0.95);
 let jade = u.c2.rgb * vec3f(0.43, 0.73, 0.66);
 var color = mix(deep, teal, smoothstep(0.13, 0.48, body));
 color = mix(color, jade, smoothstep(0.54, 0.88, body));
 let deposition = fbm(u, warped * 8.0 + b * 2.0);
 let foam = smoothstep(0.60, 0.76, field + deposition * 0.14) * (0.50 + 0.50 * deposition);
 color = mix(color, u.c3.rgb * vec3f(0.79, 0.92, 0.79), foam * 0.72);
 let fibers = noise2(u, warped * vec2f(7.0, 115.0) + b * 12.0);
 let granulation = noise2(u, warped * 86.0);
 color *= 0.75 + 0.32 * deposition + (fibers - 0.5) * 0.13 * u.form.y;
 let edgeWidth = max(fwidth(field) * 1.4, 0.0020);
 let vein = (1.0 - smoothstep(0.011, 0.011 + edgeWidth, abs(field - 0.485))) * smoothstep(0.20, 0.65, mainCurrent);
 let goldWash = smoothstep(0.52, 0.66, field + deposition * 0.11) * mainCurrent * smoothstep(0.28, 0.63, b.x);
 let gold = u.c3.rgb * vec3f(1.10, 0.65, 0.20);
 color = mix(color, gold * (0.45 + granulation * 0.33), goldWash * 0.76);
 let grainPoint = warped * (230.0 + u.form.y * 280.0);
 let mineral = smoothstep(0.88, 0.98, hash21(u, floor(grainPoint))) * smoothstep(0.39, 0.54, field) * (1.0 - smoothstep(0.56, 0.66, field)) * (0.20 + mainCurrent * 0.80);
 let relief = tanh((dpdx(field) - dpdy(field)) * min(u.resolution.x, u.resolution.y) * 0.035) * 0.09;
 color *= 0.92 + relief;
 color += gold * (vein * (0.25 + u.form.w * 0.75) + mineral * (0.28 + u.form.w * 0.58));
 return color;
}
fn artEllipsoid(p: vec3f, radii: vec3f) -> f32 {
 let a = length(p / radii); let b = length(p / (radii * radii));
 return a * (a - 1.0) / max(b, 0.001);
}
fn artMetalSdf(u: CollectionMaterial, point: vec3f, t: f32) -> f32 {
 var p = vec3f(rotate2(u, point.xy, u.compose.x * 0.6 - 0.17), point.z);
 let turn = 0.12 * sin(t * 0.06);
 let xz = rotate2(u, p.xz, turn); p = vec3f(xz.x, p.y, xz.y);
 let flow = sin(p.y * 4.2 + t * 0.08) * (0.025 + u.form.z * 0.045);
 p.x += flow;
 let body = artEllipsoid(p - vec3f(-0.18, 0.10, 0.0), vec3f(0.52, 0.59, 0.32));
 let shoulder = artEllipsoid(p - vec3f(0.36, -0.26, 0.02), vec3f(0.35, 0.38, 0.27));
 let foot = artEllipsoid(p - vec3f(-0.35, 0.49, -0.06), vec3f(0.43, 0.22, 0.28));
 var shape = smoothMin(u, smoothMin(u, body, shoulder, 0.25), foot, 0.21);
 let channel = artEllipsoid(p - vec3f(0.01, 0.01, 0.35), vec3f(0.22, 0.39, 0.25));
 shape = -smoothMin(u, -shape, channel, 0.065);
 let magnet = (u.pointer.xy - vec2f(0.5)) * vec2f(u.resolution.x / max(u.resolution.y, 1.0), 1.0);
 let delta = p.xy - magnet;
 return shape - exp(-dot(delta, delta) * 12.0) * u.pointer.z * 0.025;
}
fn artStudioEnvironment(u: CollectionMaterial, direction: vec3f, roughness: f32) -> vec3f {
 let r = normalize(direction);
 let top = smoothstep(-0.65, 0.85, r.y);
 let neutral = mix(u.c1.rgb * 0.24, u.c2.rgb * 0.65, top);
 let keyWidth = 0.16 + roughness * 0.32;
 let key = exp(-pow(abs((r.x + 0.30) / 0.51), 4.0) - pow(abs((r.y - 0.50) / keyWidth), 4.0));
 let strip = exp(-pow(abs((r.x - 0.61) / (0.048 + roughness * 0.15)), 2.0) - pow(abs((r.y + 0.08) / 0.66), 4.0));
 let lower = exp(-pow(abs((r.y + 0.64) / 0.23), 2.0) - pow(abs((r.x + 0.15) / 0.75), 4.0));
 let flag = exp(-pow(abs((r.x + 0.60 + r.y * 0.22) / 0.22), 4.0));
 let warm = mix(u.c3.rgb, vec3f(1.0, 0.72, 0.47), 0.16);
 return neutral * (1.0 - flag * 0.68) + u.c3.rgb * key * 1.70 + u.c2.rgb * strip * 1.02 + warm * lower * 0.43;
}
fn sculptedMetal(u: CollectionMaterial, point: vec2f, t: f32) -> vec3f {
 let aspect = u.resolution.x / max(u.resolution.y, 1.0);
 let fit = max(1.0, 1.10 / aspect);
 let ro = vec3f(0.0, 0.0, 3.2); let rd = normalize(vec3f(point * fit / u.form.x * 1.75, -2.8));
 var travel = 0.0; var hit = false;
 for (var i = 0; i < 72; i += 1) {
  let distance = artMetalSdf(u, ro + rd * travel, t);
  if (distance < 0.0008) { hit = true; break; }
  travel += max(0.0004, distance * 0.72); if (travel > 5.3) { break; }
 }
 let sweep = exp(-dot(point - vec2f(-0.36, -0.14), point - vec2f(-0.36, -0.14)) * 1.8);
 var background = u.c0.rgb * 0.72 + u.c2.rgb * (0.032 + sweep * 0.066);
 let shadow = exp(-pow(abs(point.x / 0.40), 2.0) - pow(abs((point.y - 0.36) / 0.060), 2.0));
 background *= 1.0 - shadow * 0.56;
 if (!hit) { return background; }
 let x = ro + rd * travel; let e = 0.0014;
 var normal = normalize(vec3f(artMetalSdf(u, x + vec3f(e, 0.0, 0.0), t) - artMetalSdf(u, x - vec3f(e, 0.0, 0.0), t), artMetalSdf(u, x + vec3f(0.0, e, 0.0), t) - artMetalSdf(u, x - vec3f(0.0, e, 0.0), t), artMetalSdf(u, x + vec3f(0.0, 0.0, e), t) - artMetalSdf(u, x - vec3f(0.0, 0.0, e), t)));
 let finishNoise = noise2(u, x.xy * 155.0 + x.z * 22.0);
 let brushFootprint = 780.0 * fit * 1.75 / (max(u.resolution.y, 1.0) * u.form.x);
 let brushed = sin(x.y * 780.0 + x.x * 14.0) * (1.0 - smoothstep(0.9, 2.5, brushFootprint));
 normal = normalize(normal + vec3f(finishNoise - 0.5, brushed * 0.3, 0.0) * (0.003 + u.form.y * 0.006));
 let roughness = 0.10 + (1.0 - u.form.w) * 0.26;
 let reflected = artStudioEnvironment(u, reflect(rd, normal), roughness);
 let grazing = pow(1.0 - clamp(dot(-rd, normal), 0.0, 1.0), 5.0);
 var occlusion = 1.0;
 for (var i = 1; i < 4; i += 1) { let d = 0.04 * f32(i); occlusion -= max(0.0, d - artMetalSdf(u, x + normal * d, t)) * 0.90; }
 let polish = mix(u.c2.rgb, u.c3.rgb, 0.46);
 var color = reflected * mix(polish * 0.78, vec3f(1.0), grazing) * clamp(occlusion, 0.52, 1.0);
 color += u.c1.rgb * 0.028 + u.c3.rgb * pow(max(dot(normal, normalize(vec3f(-0.45, -0.65, 1.0))), 0.0), 80.0) * 0.08;
 return color;
}
// Height plus analytic slope. Frequency attenuation follows the projected pixel
// footprint so distant ripples converge into a stable reflection, not a laser grid.
fn artOceanSurface(u: CollectionMaterial, point: vec2f, t: f32, footprint: f32) -> vec3f {
 var p = point; var height = 0.0; var slope = vec2f(0.0); var frequency = 0.76; var amplitude = 0.16;
 let disturbance = vec2f(noise2(u, p * 0.27), noise2(u, p * 0.23 + vec2f(7.0, 3.0))) - vec2f(0.5);
 p += disturbance * 1.7;
 var direction = normalize(vec2f(0.72, 0.45));
 for (var i = 0; i < 8; i += 1) {
  let phase = dot(p, direction) * frequency - t * (0.40 + sqrt(frequency) * 0.48) + f32(i) * 1.93 + noise2(u, p * 0.16 + f32(i) * 5.7) * 2.1;
  let resolved = 1.0 - smoothstep(0.50, 2.0, frequency * footprint);
  let wave = sin(phase); let crest = exp(wave - 1.0);
  height += (crest - 0.46) * amplitude * resolved;
  let derivative = direction * cos(phase) * crest * amplitude * frequency * resolved;
  slope += derivative;
  p += direction * cos(phase) * amplitude * (0.32 + u.form.z * 0.50);
  direction = rotate2(u, direction, 1.1 + f32(i) * 1.73);
  frequency *= 1.83; amplitude *= 0.52;
 }
 return vec3f(height, slope);
}
fn artNightSky(u: CollectionMaterial, direction: vec3f, moonDirection: vec3f, t: f32) -> vec3f {
 let elevation = max(direction.y, 0.0);
 let horizon = exp(-elevation * 5.0);
 let dark = u.c0.rgb * vec3f(0.33, 0.52, 0.72);
 let blue = mix(u.c1.rgb, vec3f(0.22, 0.42, 0.53), 0.64);
 var sky = dark + blue * (0.075 + horizon * 0.17);
 let moonDot = clamp(dot(direction, moonDirection), 0.0, 1.0);
 let moonAngle = sqrt(max(0.0, 2.0 - 2.0 * moonDot));
 let moonMask = 1.0 - smoothstep(0.0140, 0.0160, moonAngle);
 let lunar = 0.75 + 0.25 * fbm(u, direction.xz * 580.0 + vec2f(4.0, 3.0));
 sky += u.c3.rgb * (moonMask * lunar * 0.82 + exp(-moonAngle * moonAngle * 140.0) * 0.040 + exp(-moonAngle * 8.0) * 0.025);
 let cloudPoint = direction.xz / max(0.18, direction.y + 0.27) * 2.2 + vec2f(t * 0.006, 0.0);
 let cloud = fbm(u, cloudPoint * vec2f(1.0, 2.3));
 let veil = smoothstep(0.47, 0.68, cloud) * smoothstep(0.0, 0.09, elevation) * 0.32;
 sky = mix(sky, blue * 0.24 + u.c3.rgb * pow(moonDot, 12.0) * 0.07, veil);
 return sky;
}
fn sculptedWater(u: CollectionMaterial, point: vec2f, t: f32) -> vec3f {
 let ro = vec3f(0.0, 1.55, 0.0);
 let rd = normalize(vec3f(point.x, -point.y - 0.070, 1.24));
 let aspect = u.resolution.x / max(u.resolution.y, 1.0);
 let moonDirection = normalize(vec3f((u.compose.y - 0.5) * aspect * 0.68, 0.25, 1.24));
 let sky = artNightSky(u, rd, moonDirection, t);
 if (rd.y >= -0.002) { return sky; }
 var travel = min(700.0, -ro.y / rd.y);
 var position = ro + rd * travel;
 let rotation = u.compose.x * 0.20;
 var q = rotate2(u, position.xz, rotation) * u.form.x;
 let footprint = max(0.002, travel * travel * 0.72 / max(u.resolution.y, 1.0));
 let first = artOceanSurface(u, q, t, footprint);
 travel = clamp((first.x - ro.y) / rd.y, 0.0, 700.0);
 position = ro + rd * travel; q = rotate2(u, position.xz, rotation) * u.form.x;
 let surface = artOceanSurface(u, q, t, footprint);
 let slope = rotate2(u, surface.yz, -rotation) * (0.64 + u.form.y * 0.75);
 let micro = (vec2f(noise2(u, q * 7.5), noise2(u, q * 8.9 + vec2f(7.0, 3.0))) - vec2f(0.5)) * (1.0 - smoothstep(0.10, 0.55, footprint)) * 0.09;
 let normal = normalize(vec3f(-slope.x + micro.x, 1.0, -slope.y + micro.y));
 let reflection = reflect(rd, normal);
 let fresnel = 0.025 + 0.975 * pow(1.0 - clamp(dot(-rd, normal), 0.0, 1.0), 5.0);
 let reflectionSky = artNightSky(u, reflection, moonDirection, t);
 let deep = mix(u.c0.rgb, vec3f(0.006, 0.048, 0.059), 0.66);
 var color = mix(deep * (0.62 + surface.x * 0.30), reflectionSky, 0.18 + fresnel * 0.82);
 let halfLight = normalize(moonDirection - rd);
 let roughness = 0.064 + (1.0 - u.form.w) * 0.12 + min(footprint, 1.0) * 0.018;
 let ndh = max(dot(normal, halfLight), 0.0);
 let alpha = roughness * roughness; let denominator = max(0.00001, ndh * ndh * (alpha - 1.0) + 1.0);
 let specular = alpha / (3.14159265 * denominator * denominator);
 let silver = mix(u.c3.rgb, vec3f(0.70, 0.88, 0.95), 0.60);
 color += silver * min(specular * 0.015, 1.10) * (0.30 + u.form.w * 0.60);
 let foam = smoothstep(0.105, 0.18, surface.x) * smoothstep(0.18, 0.45, length(slope)) * (1.0 - smoothstep(10.0, 55.0, travel));
 color += silver * foam * 0.028;
 let mist = 1.0 - exp(-travel * 0.0022);
 let horizonSky = artNightSky(u, normalize(vec3f(rd.x, 0.002, rd.z)), moonDirection, t);
 return mix(color, horizonSky, mist * 0.86);
}
fn artTerrainHeight(u: CollectionMaterial, point: vec2f) -> f32 {
 let p = point / u.form.x;
 let left = exp(-dot((p - vec2f(-4.2, 10.0)) / vec2f(5.6, 9.0), (p - vec2f(-4.2, 10.0)) / vec2f(5.6, 9.0)));
 let right = exp(-dot((p - vec2f(5.8, 17.0)) / vec2f(6.0, 10.0), (p - vec2f(5.8, 17.0)) / vec2f(6.0, 10.0)));
 let distant = exp(-dot((p - vec2f(-1.5, 29.0)) / vec2f(12.0, 9.0), (p - vec2f(-1.5, 29.0)) / vec2f(12.0, 9.0)));
 let mass = left * 2.6 + right * 6.2 + distant * 5.4;
 var q = p * 0.34; var ridge = 0.0; var weight = 0.58; var previous = 1.0;
 for (var i = 0; i < 5; i += 1) {
  let value = 1.0 - abs(noise2(u, q) * 2.0 - 1.0);
  let folded = value * value;
  ridge += folded * weight * previous;
  previous = mix(0.60, 1.0, folded);
  q = vec2f(q.x * 1.68 - q.y * 1.14, q.x * 1.14 + q.y * 1.68) + vec2f(4.7, 1.8);
  weight *= 0.48;
 }
 let valley = exp(-pow(abs((p.x - sin(p.y * 0.19) * 1.5) / 2.0), 2.0));
 let broadRock = noise2(u, p * 0.23 + vec2f(3.2, 1.7));
 let massif = mass * (0.58 + broadRock * 0.28) * (1.0 - valley * 0.72);
 let erosion = (ridge - 0.42) * (0.35 + mass * (0.18 + u.form.z * 0.07));
 let channels = abs(noise2(u, p * vec2f(3.8, 0.87) + vec2f(ridge * 1.8)) - 0.5) * 0.10 * mass;
 return max(0.05, 0.16 + massif + erosion - channels);
}
fn artDaySky(u: CollectionMaterial, rd: vec3f, light: vec3f, t: f32) -> vec3f {
 let elevation = clamp(rd.y, 0.0, 1.0); let haze = exp(-elevation * 4.5);
 let cool = mix(u.c1.rgb, vec3f(0.25, 0.45, 0.62), 0.68);
 let warm = mix(u.c3.rgb, vec3f(0.97, 0.84, 0.66), 0.55);
 var sky = mix(cool * 0.73, vec3f(0.61, 0.69, 0.73), haze * 0.69);
 let solar = max(dot(rd, light), 0.0);
 sky += warm * pow(solar, 36.0) * 0.18;
 let p = rd.xz / max(0.20, rd.y + 0.35) * 2.0 + vec2f(t * 0.007, -t * 0.002);
 let cloud = fbm(u, p * vec2f(1.0, 1.7));
 let coverage = smoothstep(0.50, 0.72, cloud) * smoothstep(-0.01, 0.12, rd.y);
 let cloudLight = smoothstep(0.40, 0.65, fbm(u, p * vec2f(1.0, 1.7) + vec2f(-0.12, 0.04)));
 return mix(sky, mix(cool * 0.80, mix(warm, vec3f(0.92), 0.45), cloudLight), coverage * 0.78);
}
fn sculptedAtmosphere(u: CollectionMaterial, point: vec2f, t: f32) -> vec3f {
 let p = rotate2(u, point, u.compose.x * 0.08);
 let ro = vec3f(0.0, 3.0, -3.2);
 let rd = normalize(vec3f(p.x * 1.08, -p.y - 0.035, 1.32));
 let light = normalize(vec3f(-0.68 + (u.compose.y - 0.5) * 0.6, 0.38, -0.58));
 let sky = artDaySky(u, rd, light, t);
 var travel = 1.0; var previous = travel; var hit = false;
 for (var i = 0; i < 64; i += 1) {
  let location = ro + rd * travel;
  let separation = location.y - artTerrainHeight(u, location.xz);
  if (separation < 0.00025 * travel) { hit = true; break; }
  previous = travel; travel += clamp(separation * 0.22, 0.035, 1.0);
  if (travel > 76.0 || location.y > 10.0) { break; }
 }
 // A height field is not a distance field. Grazing rays can make arbitrarily
 // small adaptive progress; complete the remaining interval before calling a miss.
 if (!hit && travel < 76.0 && (ro + rd * travel).y < 10.0) {
  let coverageStep = max(0.20, (76.0 - travel) / 126.0);
  for (var i = 0; i < 128; i += 1) {
   // Resolve the first crossing within each interval. Testing only its ends can
   // jump across a narrow ridge and alternate between near and far surfaces.
   for (var subdivision = 0; subdivision < 8; subdivision += 1) {
    let location = ro + rd * travel;
    if (location.y <= artTerrainHeight(u, location.xz)) { hit = true; break; }
    previous = travel; travel += coverageStep * 0.125;
    if (travel > 76.0 || location.y > 10.0) { break; }
   }
   if (hit || travel > 76.0 || (ro + rd * travel).y > 10.0) { break; }
  }
 }
 if (!hit) { return sky; }
 for (var i = 0; i < 8; i += 1) { let middle = (previous + travel) * 0.5; let location = ro + rd * middle; if (location.y > artTerrainHeight(u, location.xz)) { previous = middle; } else { travel = middle; } }
 let location = ro + rd * travel;
 let epsilon = max(0.012, travel * 0.0008);
 let dx = artTerrainHeight(u, location.xz + vec2f(epsilon, 0.0)) - artTerrainHeight(u, location.xz - vec2f(epsilon, 0.0));
 let dz = artTerrainHeight(u, location.xz + vec2f(0.0, epsilon)) - artTerrainHeight(u, location.xz - vec2f(0.0, epsilon));
 var normal = normalize(vec3f(-dx, 2.0 * epsilon, -dz));
 let weathering = fbm(u, location.xz * 3.2 + location.y * 0.80);
 let scree = noise2(u, location.xz * (24.0 + u.form.y * 40.0));
 normal = normalize(normal + vec3f((scree - 0.5) * 0.09, 0.0, (weathering - 0.5) * 0.12));
 let rock = mix(vec3f(0.12, 0.16, 0.17), vec3f(0.43, 0.38, 0.29), weathering);
 let forest = mix(vec3f(0.035, 0.10, 0.090), vec3f(0.16, 0.23, 0.13), weathering);
 var albedo = mix(rock, forest, smoothstep(0.55, 0.88, normal.y) * (1.0 - smoothstep(2.1, 4.1, location.y)));
 let snowLine = 3.30 + noise2(u, location.xz * 1.3) * 0.80;
 let snow = smoothstep(snowLine, snowLine + 0.48, location.y) * smoothstep(0.30, 0.74, normal.y);
 albedo = mix(albedo, vec3f(0.75, 0.81, 0.83), snow * 0.84);
 var visibility = 1.0;
 for (var i = 1; i < 6; i += 1) { let d = f32(i) * 0.38; let samplePoint = location + light * d; let clearance = samplePoint.y - artTerrainHeight(u, samplePoint.xz); visibility = min(visibility, clamp(clearance / (d * 0.24), 0.0, 1.0)); }
 let diffuse = max(dot(normal, light), 0.0) * visibility;
 let sunlight = mix(u.c3.rgb, vec3f(1.0, 0.87, 0.66), 0.70);
 let skylight = vec3f(0.38, 0.54, 0.67) * (0.16 + normal.y * 0.12);
 var color = albedo * (skylight + sunlight * diffuse * (1.15 + u.form.w * 0.95));
 color *= 0.83 + weathering * 0.24 + scree * u.form.y * 0.10;
 let altitudeFog = exp(-max(location.y - 0.6, 0.0) * 0.58);
 let mist = (1.0 - exp(-travel * (0.014 + altitudeFog * 0.025))) * 0.88;
 let fogColor = mix(vec3f(0.38, 0.52, 0.61), sunlight * 0.72, pow(max(dot(rd, light), 0.0), 6.0));
 color = mix(color, fogColor, mist);
 let driftingMist = fbm(u, location.xz * 0.16 + vec2f(t * 0.014, 0.0)) * altitudeFog * (1.0 - exp(-travel * 0.020));
 return mix(color, fogColor, driftingMist * 0.14);
}
`;

export function createAmbientMaterialSource(id, settings = {}) {
    const source = createPreviousAmbientMaterialSource(id, settings);
    const functions = {
        'pearlescent-silk': ['refinedSilk', 'sculptedSilk'],
        'aurora-glass': ['refinedGlass', 'sculptedGlass'],
        'liquid-metal': ['refinedMetal', 'sculptedMetal'],
        'mineral-ink': ['refinedInk', 'sculptedInk'],
        'moonlit-water': ['water', 'sculptedWater'],
        'atmospheric-depth': ['atmosphere', 'sculptedAtmosphere'],
    };
    const replacement = functions[id];
    if (!replacement) return source;
    return `${SCULPTED_MATERIAL_WGSL}\n${source}`.replace(`var color = ${replacement[0]}(u, p, time);`, `var color = ${replacement[1]}(u, p, time);`);
}

/** New factory graphs save this complete ocean program as editable source.
 * Historical source generators above stay byte-stable for graph migration. */
export const AMBIENT_OCEAN_MATERIAL_WGSL = /* wgsl */`
${AMBIENT_OCEAN_SURFACE_WGSL}
${AMBIENT_OCEAN_WHITEWATER_WGSL}
fn artOceanWaveSettings(u: CollectionMaterial) -> vec4f {
 return vec4f(12.0, 0.32, 0.48, 0.52);
}
fn artOceanWindSettings(u: CollectionMaterial) -> vec2f {
 return vec2f(1.20, 0.22);
}
fn artOceanSample(u: CollectionMaterial, point: vec2f, t: f32, footprint: f32) -> vec4f {
 return ambientOceanSample(point, t, footprint, artOceanWaveSettings(u), artOceanWindSettings(u));
}
fn artOceanHeightBound(u: CollectionMaterial, footprint: f32) -> f32 {
 return ambientOceanHeightBound(footprint, artOceanWaveSettings(u), artOceanWindSettings(u));
}
fn artOceanRayBounds(u: CollectionMaterial, direction: vec2f, footprint: f32) -> vec2f {
 return ambientOceanRayBounds(direction, footprint, artOceanWaveSettings(u), artOceanWindSettings(u));
}
fn artOceanWhitewater(u: CollectionMaterial, point: vec2f, t: f32, footprint: f32) -> f32 {
 return ambientOceanWhitewater(point, t, footprint, artOceanWaveSettings(u), artOceanWindSettings(u), vec4f(0.65, 0.17, 3.5, 2.8), 0.12);
}
fn artOceanFoamMaterial(water: vec3f, normal: vec3f, coverage: f32) -> vec3f {
 // Matte aerated water replaces the underlying mirror, including its glint.
 let diffuse = vec3f(0.46, 0.55, 0.58) * (0.70 + 0.30 * max(normal.y, 0.0));
 return mix(water, diffuse, clamp(coverage, 0.0, 1.0));
}
fn artOceanReflectionRay(u: CollectionMaterial, direction: vec3f, moonDirection: vec3f, t: f32, body: vec3f) -> vec3f {
 // Downward rays encounter the ocean, not a second luminous sky horizon.
 let skyVisibility = smoothstep(-0.025, 0.025, direction.y);
 return mix(body, artNightSky(u, direction, moonDirection, t), skyVisibility);
}
fn artOceanReflection(u: CollectionMaterial, direction: vec3f, moonDirection: vec3f, t: f32, body: vec3f, roughness: f32, variance: f32) -> vec3f {
 let pole = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(direction.y) > 0.98);
 let tangent = normalize(cross(pole, direction)); let bitangent = cross(direction, tangent);
 let spread = clamp(roughness * roughness + sqrt(max(variance, 0.0)) * 0.25, 0.003, 0.5);
 let center = artOceanReflectionRay(u, direction, moonDirection, t, body);
 let along = artOceanReflectionRay(u, normalize(direction + tangent * spread), moonDirection, t, body) + artOceanReflectionRay(u, normalize(direction - tangent * spread), moonDirection, t, body);
 let across = artOceanReflectionRay(u, normalize(direction + bitangent * spread), moonDirection, t, body) + artOceanReflectionRay(u, normalize(direction - bitangent * spread), moonDirection, t, body);
 return center * 0.55 + (along + across) * 0.1125;
}
fn artOceanIntersection(u: CollectionMaterial, origin: vec3f, ray: vec3f, t: f32, footprint: f32) -> f32 {
 let descent = max(-ray.y, 0.0001); let bound = artOceanHeightBound(u, footprint);
 let plane = min(700.0, origin.y / descent);
 if (bound < 0.000001) { return plane; }
 let near = clamp((origin.y - bound) / descent, 0.0, 700.0);
 let far = clamp((origin.y + bound) / descent, 0.0, 700.0);
 let rotation = u.compose.x * 0.20; let scale = max(u.form.x, 0.1);
 let localRay = rotate2(u, ray.xz, rotation) * scale;
 let bounds = artOceanRayBounds(u, localRay, footprint);
 var travel = near; var previous = near;
 // Conservative advances locate the first crossing, including grazing crests.
 // The sub-millimetre floor obtains a sign bracket instead of asymptotic stops.
 for (var i = 0; i < 128; i += 1) {
  let location = origin + ray * travel;
  let surface = artOceanSample(u, rotate2(u, location.xz, rotation) * scale, t, footprint);
  let residual = location.y - surface.x;
  if (residual <= 0.0) { break; }
  let derivative = ray.y - dot(surface.yz, localRay);
  previous = travel;
  travel = min(far, travel + ambientOceanRayAdvance(residual, derivative, descent, bounds));
  if (travel <= previous) { break; }
 }
 let last = origin + ray * travel;
 if (last.y > artOceanSample(u, rotate2(u, last.xz, rotation) * scale, t, footprint).x) { return travel; }
 var low = previous; var high = travel;
 for (var i = 0; i < 8; i += 1) {
  let middle = (low + high) * 0.5;
  let location = origin + ray * middle;
  let surface = artOceanSample(u, rotate2(u, location.xz, rotation) * scale, t, footprint);
  if (location.y > surface.x) { low = middle; } else { high = middle; }
 }
 return (low + high) * 0.5;
}
fn sculptedWater(u: CollectionMaterial, point: vec2f, t: f32) -> vec3f {
 let ro = vec3f(0.0, 1.55, 0.0);
 let rd = normalize(vec3f(point.x, -point.y - 0.070, 1.24));
 let aspect = u.resolution.x / max(u.resolution.y, 1.0);
 let moonDirection = normalize(vec3f((u.compose.y - 0.5) * aspect * 0.68, 0.25, 1.24));
 let sky = artNightSky(u, rd, moonDirection, t);
 if (rd.y >= -0.002) { return sky; }
 let plane = min(700.0, -ro.y / rd.y);
 let rotation = u.compose.x * 0.20;
 let scale = max(u.form.x, 0.1);
 let footprint = max(0.001, plane * scale / (max(u.resolution.y, 1.0) * max(-rd.y, 0.025)));
 // Solve the same filtered heightfield that supplies the shading derivatives.
 // Keeping this footprint fixed during the solve avoids changing LOD mid-ray.
 let travel = artOceanIntersection(u, ro, rd, t, footprint);
 let position = ro + rd * travel;
 let q = rotate2(u, position.xz, rotation) * scale;
 let surface = artOceanSample(u, q, t, footprint);
 let slope = rotate2(u, surface.yz, -rotation) * scale;
 let normal = normalize(vec3f(-slope.x, 1.0, -slope.y));
 let reflection = reflect(rd, normal);
 let fresnel = ambientOceanFresnel(dot(-rd, normal));
 // The disk's energy is integrated by the filtered BRDF below. Reflect the same
 // cloud/sky environment without reflecting a second unfiltered moon image.
 var reflectionMaterial = u;
 reflectionMaterial.c3.a = 0.0;
 let deep = mix(u.c0.rgb * 0.32, vec3f(0.008, 0.030, 0.043), 0.68);
 let crestLight = smoothstep(-0.14, 0.24, surface.x) * max(dot(normal, moonDirection), 0.0);
 let body = deep * (0.80 + crestLight * 0.85) + vec3f(0.008, 0.021, 0.026) * crestLight;
 let roughness = 0.12 + (1.0 - u.form.w) * 0.07;
 let reflectionSky = artOceanReflection(reflectionMaterial, reflection, moonDirection, t, body, roughness, surface.w * scale * scale);
 var color = mix(body, reflectionSky, fresnel);
 let specular = ambientOceanMoonSpecular(normal, -rd, moonDirection, roughness, surface.w * scale * scale);
 let silver = mix(u.c3.rgb, vec3f(0.70, 0.88, 0.95), 0.60);
 color += silver * min(specular * 0.08, 0.42);
 let foam = artOceanWhitewater(u, q, t, footprint);
 color = artOceanFoamMaterial(color, normal, foam);
 let mist = 1.0 - exp(-travel * 0.0022);
 let horizonSky = artNightSky(u, normalize(vec3f(rd.x, 0.002, rd.z)), moonDirection, t);
 return mix(color, horizonSky, mist * 0.86);
}
`;

function material(id, name, description, index, seed, palette, overrides) {
    return Object.freeze({ id, name, description, index, seed, palette: Object.freeze(palette), params: Object.freeze({ scale: 1, detail: 0.5, warp: 0.5, gloss: 0.65, speed: 0.3, angle: 0, focusX: 0.55, quiet: 0, exposure: 0, grain: 0.018, vignette: 0.15, pointerInfluence: 0.25, ...overrides }) });
}
function number(value) { const text = Number(value).toFixed(6); return text.replace(/0+$/, '').replace(/\.$/, '.0'); }
function hexRgb(value) { return [1, 3, 5].map(offset => parseInt(value.slice(offset, offset + 2), 16) / 255); }
