// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { pbrMaterialsWGSL } from '../shaders/modules/chunks/pbr_materials.js';

// Reuse the engine dielectric implementation, keeping the water library pure
// so its functions can be persisted and independently edited in source nodes.
export function extractWaterDielectricFresnel(source) {
    if (typeof source !== 'string') throw new TypeError('Engine dielectric Fresnel source must be text.');
    // Keep offsets while masking WGSL's line and nested block comments. Shader
    // bundling removes line breaks; the function ends at its balanced brace.
    let clean = '', block = 0, line = false;
    for (let i = 0; i < source.length; i++) {
        const pair = source.slice(i, i + 2), char = source[i];
        if (line) { if (char === '\n' || char === '\r') line = false; clean += ' '; }
        else if (pair === '/*') { block++; clean += '  '; i++; }
        else if (block && pair === '*/') { block--; clean += '  '; i++; }
        else if (block) clean += ' ';
        else if (pair === '//') { line = true; clean += '  '; i++; }
        else clean += char;
    }
    if (block) throw new Error('Engine dielectric Fresnel source has an unclosed comment.');
    const head = /\bfn\s+fresnelDielectricExact\s*\([^{}]*\)\s*->\s*f32\s*\{/.exec(clean);
    if (!head) throw new Error('Engine dielectric Fresnel source is unavailable.');
    let depth = 1, end = head.index + head[0].length;
    while (end < clean.length && depth) {
        if (clean[end] === '{') depth++;
        else if (clean[end] === '}') depth--;
        end++;
    }
    if (depth) throw new Error('Engine dielectric Fresnel function has an unclosed body.');
    return source.slice(head.index, end);
}

const dielectric = extractWaterDielectricFresnel(pbrMaterialsWGSL);

export const WATER_OPTICS_WGSL = /* wgsl */`
${dielectric}
fn waterPerceptualRoughnessVariance(roughness:f32)->f32 {
 let alpha=clamp(roughness,0.0,1.0)*clamp(roughness,0.0,1.0);
 return 0.5*alpha*alpha;
}
fn waterSlopeCovariance(value:vec3f,baseVariance:f32)->vec3f {
 let diagonal=max(max(value.xz,vec2f(0.0))+vec2f(max(baseVariance,0.0)),vec2f(0.00002));
 let correlation=clamp(value.y,-sqrt(diagonal.x*diagonal.y)*0.999,sqrt(diagonal.x*diagonal.y)*0.999);
 return vec3f(diagonal.x,correlation,diagonal.y);
}
fn waterBeckmannDistribution(halfT:vec3f,covariance:vec3f)->f32 {
 if(halfT.z<=0.0){return 0.0;}
 let c=waterSlopeCovariance(covariance,0.0);let determinant=max(c.x*c.z-c.y*c.y,1e-12);
 let slope=halfT.xy/max(halfT.z,0.00001);
 let quadratic=(c.z*slope.x*slope.x-2.0*c.y*slope.x*slope.y+c.x*slope.y*slope.y)/determinant;
 return exp(-0.5*quadratic)/(6.28318530718*sqrt(determinant)*pow(halfT.z,4.0));
}
fn waterErf(value:f32)->f32 {
 let x=abs(value);let t=1.0/(1.0+0.3275911*x);
 let polynomial=(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t;
 return sign(value)*(1.0-polynomial*exp(-x*x));
}
fn waterBeckmannLambda(directionT:vec3f,covariance:vec3f)->f32 {
 if(directionT.z<=0.0){return 100000.0;}
 let variance=max(0.0,covariance.x*directionT.x*directionT.x+2.0*covariance.y*directionT.x*directionT.y+covariance.z*directionT.y*directionT.y);
 if(variance<1e-12){return 0.0;}
 let a=directionT.z/sqrt(2.0*variance);
 if(a>8.0){return 0.0;}
 return max(0.0,0.5*(waterErf(a)-1.0)+exp(-a*a)/(3.54490770181*max(a,0.00001)));
}
fn waterTangent(normal:vec3f)->vec3f {
 let reference=select(vec3f(1.0,0.0,0.0),vec3f(0.0,0.0,1.0),abs(normal.x)>0.95);
 return normalize(reference-normal*dot(reference,normal));
}
fn waterWorldSlopeCovariance(normal:vec3f,value:vec3f)->vec3f {
 let t=waterTangent(normal);let b=cross(t,normal);let scale=normal.y*normal.y;
 return vec3f(scale*(t.x*t.x*value.x+2.0*t.x*t.z*value.y+t.z*t.z*value.z),
  scale*(t.x*b.x*value.x+(t.x*b.z+t.z*b.x)*value.y+t.z*b.z*value.z),
  scale*(b.x*b.x*value.x+2.0*b.x*b.z*value.y+b.z*b.z*value.z));
}
fn waterBeckmannSampleNormal(normal:vec3f,covariance:vec3f,xi:vec2f)->vec3f {
 let c=waterSlopeCovariance(covariance,0.0);let a=sqrt(c.x);let b=c.y/a;let d=sqrt(max(c.z-b*b,1e-12));
 let radius=sqrt(-2.0*log(max(1.0-clamp(xi.x,0.0,0.999999),1e-6)));let angle=6.28318530718*xi.y;
 let gaussian=radius*vec2f(cos(angle),sin(angle));let slope=vec2f(a*gaussian.x,b*gaussian.x+d*gaussian.y);
 let tangent=waterTangent(normal);return normalize(normal+tangent*slope.x+cross(tangent,normal)*slope.y);
}
fn waterBeckmannReflectionWeight(normal:vec3f,view:vec3f,halfVector:vec3f,covariance:vec3f)->f32 {
 let light=reflect(-view,halfVector);let ndv=dot(normal,view);let ndl=dot(normal,light);let ndh=dot(normal,halfVector);
 if(ndv<=0.0||ndl<=0.0||ndh<=0.0){return 0.0;}
 let tangent=waterTangent(normal);let across=cross(tangent,normal);let c=waterSlopeCovariance(covariance,0.0);
 let v=vec3f(dot(view,tangent),dot(view,across),ndv);let l=vec3f(dot(light,tangent),dot(light,across),ndl);
 let masking=1.0/(1.0+waterBeckmannLambda(v,c)+waterBeckmannLambda(l,c));
 return fresnelDielectricExact(clamp(dot(view,halfVector),0.0,1.0),1.333)*masking*max(dot(view,halfVector),0.0)/max(ndv*ndh,1e-8);
}
fn waterBeckmannBrdf(normal:vec3f,view:vec3f,light:vec3f,covariance:vec3f)->f32 {
 let ndv=dot(normal,view);let ndl=dot(normal,light);
 if(ndv<=0.0||ndl<=0.0){return 0.0;}
 let tangent=waterTangent(normal);let across=cross(tangent,normal);
 let sum=view+light;if(dot(sum,sum)<1e-12){return 0.0;}let halfVector=normalize(sum);
 let h=vec3f(dot(halfVector,tangent),dot(halfVector,across),dot(halfVector,normal));
 let v=vec3f(dot(view,tangent),dot(view,across),ndv);let l=vec3f(dot(light,tangent),dot(light,across),ndl);
 let c=waterSlopeCovariance(covariance,0.0);
 let masking=1.0/(1.0+waterBeckmannLambda(v,c)+waterBeckmannLambda(l,c));
 let fresnel=fresnelDielectricExact(clamp(dot(view,halfVector),0.0,1.0),1.333);
 return fresnel*waterBeckmannDistribution(h,c)*masking/max(4.0*ndv*ndl,1e-8);
}
fn waterFiniteDiscSpecular(normal:vec3f,view:vec3f,light:vec3f,covariance:vec3f,angularRadius:f32)->f32 {
 let tangent=waterTangent(light);let across=cross(tangent,light);var value=0.0;
 for(var i=0u;i<8u;i+=1u){
  let radius=sqrt((f32(i)+0.5)/8.0)*max(angularRadius,0.0);let angle=f32(i)*2.39996322973;
  let direction=normalize(light+tangent*cos(angle)*radius+across*sin(angle)*radius);
  value+=waterBeckmannBrdf(normal,view,direction,covariance)*max(0.0,dot(normal,direction));
 }
 return value/8.0;
}
`;

export const WATER_VISIBLE_OPTICS_WGSL = /* wgsl */`
// Integrate incident radiance over a uniform solid-angle spherical cap.
// The earlier helper above returns an averaged directional response; saved
// programs retain that convention. New radiance-valued lights use this integral.
fn waterFiniteDiscRadianceSpecular(normal:vec3f,view:vec3f,light:vec3f,covariance:vec3f,angularRadius:f32)->f32 {
 let angular=clamp(angularRadius,0.0,1.57079632679);
 let halfSine=sin(angular*0.5);let oneMinusCos=2.0*halfSine*halfSine;
 let solidAngle=6.28318530718*oneMinusCos;
 let tangent=waterTangent(light);let across=cross(tangent,light);var value=0.0;
 for(var i=0u;i<8u;i+=1u){
  let cosine=1.0-((f32(i)+0.5)/8.0)*oneMinusCos;
  let sine=sqrt(max(0.0,(1.0-cosine)*(1.0+cosine)));let angle=f32(i)*2.39996322973;
  let direction=light*cosine+(tangent*cos(angle)+across*sin(angle))*sine;
  value+=waterBeckmannBrdf(normal,view,direction,covariance)*max(0.0,dot(normal,direction));
 }
 return value*(solidAngle/8.0);
}
// Original inversion of the projected Gaussian visible-area CDF. Retain the
// NDF sampler above because previously saved source uses its distinct weight.
fn waterGaussianCdf(value:f32)->f32 {return 0.5*(1.0+waterErf(value*0.707106781187));}
fn waterGaussianDensity(value:f32)->f32 {return 0.398942280401*exp(-0.5*value*value);}
fn waterGaussianQuantile(probability:f32)->f32 {
 let p=clamp(probability,0.00001,0.99999);let x=2.0*p-1.0;
 let logarithm=log(max(1.0-x*x,1e-12));let term=4.3307467508+0.5*logarithm;
 var value=sign(x)*sqrt(max(0.0,2.0*(sqrt(term*term-logarithm/0.147)-term)));
 for(var i=0u;i<2u;i+=1u){value-=(waterGaussianCdf(value)-p)/max(waterGaussianDensity(value),1e-8);}
 return value;
}
fn waterVisibleProjectedSlope(a:f32,probability:f32)->f32 {
 let p=clamp(probability,0.00001,0.99999);let lowerMass=waterGaussianCdf(-a);
 let boundaryDensity=waterGaussianDensity(a);let normalization=a*waterGaussianCdf(a)+boundaryDensity;
 var lower=max(-a,-8.0);var upper=8.0;
 let gaussian=waterGaussianQuantile(p);let rayleigh=sqrt(-2.0*log(1.0-p));
 var value=(a*gaussian+rayleigh)/(a+1.0);
 let boundaryStep=sqrt(2.0*normalization*p/max(boundaryDensity,1e-30));
 if(p<0.05&&boundaryStep<1.5){value=-a+boundaryStep;}
 value=clamp(value,lower+0.000001,upper-0.000001);
 for(var i=0u;i<6u;i+=1u){
  let density=waterGaussianDensity(value);
  let cdf=(a*(waterGaussianCdf(value)-lowerMass)+boundaryDensity-density)/normalization;
  let error=cdf-p;if(abs(error)<0.0000001){break;}
  if(error<0.0){lower=value;}else{upper=value;}
  let candidate=value-error/max((a+value)*density/normalization,1e-8);
  if(candidate>=lower&&candidate<=upper){value=candidate;}else{value=0.5*(lower+upper);}
 }
 return value;
}
fn waterBeckmannSampleVisibleNormal(normal:vec3f,view:vec3f,covariance:vec3f,xi:vec2f)->vec3f {
 let ndv=dot(normal,view);if(ndv<=0.0){return normal;}
 let tangent=waterTangent(normal);let across=cross(tangent,normal);let c=waterSlopeCovariance(covariance,0.0);
 let xx=sqrt(c.x);let yx=c.y/xx;let yy=sqrt(max(c.z-yx*yx,1e-12));
 let u=vec2f(dot(view,tangent),dot(view,across));let projected=vec2f(xx*u.x+yx*u.y,yy*u.y);
 let sigma=length(projected);var gaussian=vec2f(0.0,waterGaussianQuantile(xi.y));
 if(sigma>0.0000001){
  let along=projected/sigma;let perpendicular=vec2f(-along.y,along.x);
  gaussian=along*waterVisibleProjectedSlope(ndv/sigma,xi.x)+perpendicular*gaussian.y;
 }else{gaussian.x=waterGaussianQuantile(xi.x);}
 let slope=vec2f(xx*gaussian.x,yx*gaussian.x+yy*gaussian.y);
 return normalize(normal+tangent*slope.x+across*slope.y);
}
fn waterBeckmannVisibleReflectionWeight(normal:vec3f,view:vec3f,halfVector:vec3f,covariance:vec3f)->f32 {
 let light=reflect(-view,halfVector);let ndv=dot(normal,view);let ndl=dot(normal,light);
 if(ndv<=0.0||ndl<=0.0||dot(normal,halfVector)<=0.0||dot(view,halfVector)<=0.0){return 0.0;}
 let tangent=waterTangent(normal);let across=cross(tangent,normal);let c=waterSlopeCovariance(covariance,0.0);
 let v=vec3f(dot(view,tangent),dot(view,across),ndv);let l=vec3f(dot(light,tangent),dot(light,across),ndl);
 let viewLambda=waterBeckmannLambda(v,c);let lightLambda=waterBeckmannLambda(l,c);
 return fresnelDielectricExact(clamp(dot(view,halfVector),0.0,1.0),1.333)*(1.0+viewLambda)/(1.0+viewLambda+lightLambda);
}
`;

/** CPU reference for the normalized Gaussian slope NDF, including LEAN errata. */
export function waterBeckmannDistribution(halfVector, covariance) {
    const [x, y, z] = halfVector;
    if (z <= 0) return 0;
    const xx = Math.max(covariance[0], .00002), zz = Math.max(covariance[2], .00002);
    const xz = Math.max(-Math.sqrt(xx * zz) * .999, Math.min(Math.sqrt(xx * zz) * .999, covariance[1]));
    const determinant = Math.max(xx * zz - xz * xz, 1e-12), sx = x / Math.max(z, .00001), sy = y / Math.max(z, .00001);
    return Math.exp(-.5 * (zz * sx * sx - 2 * xz * sx * sy + xx * sy * sy) / determinant) / (2 * Math.PI * Math.sqrt(determinant) * z ** 4);
}
