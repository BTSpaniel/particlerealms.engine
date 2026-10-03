// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Native density fields own plume shape and extinction. Optional flame detail
 * attenuates native emission only; it cannot introduce an emitting source.
 * Optical coefficients and the normalized-temperature colour range are artistic
 * visualization settings; Flow's temperature channel is not calibrated Kelvin.
 */
import { flowSparseWGSL } from './flowSparse.js';
import { flowEmissionWGSL } from './flowLighting.js';
import { noise3dWGSL } from '../shaders/modules/chunks/noise3d.js';
import { colorMathWGSL } from '../shaders/modules/chunks/color_math.js';

/** Render-only, bounded flame structure. Advect the existing Engine value noise
 * upward at 1.75 m/s; native heat/burn gates still decide where fire can exist.
 * Temperature and burn can only decrease, and fuel/smoke pass through exactly. */
export const flowFireDetailWGSL = /* wgsl */`${noise3dWGSL}
fn flowFlameDetail(density:vec4f, point:vec3f, time:f32)->vec4f {
    if(density.x<=.1 || density.z<=.001) { return density; }
    let phase=point*vec3f(14.,4.,14.)-vec3f(0.,time*7.,0.);
    let detail=smoothstep(.22,.72,noise3d(phase));
    return vec4f(density.x*mix(.88,1.,detail),density.y,density.z*mix(.28,1.,detail),density.w);
}`;

export function flowVolumeShaders({ phaseFunctionsWGSL, beerLambertWGSL, blackbodyWGSL, boundarySource = '', boundaryCache = true, fireDetail = false }) {
    if (typeof fireDetail !== 'boolean') throw new TypeError('Flow fire detail must be a boolean');
    const sparse = flowSparseWGSL(boundarySource, { boundaryCache });
    const common = /* wgsl */`
const PI=3.14159265359;
const EPSILON=.000001;
const LIGHT_DIRECTION=vec3f(-.49277,.821285,.28745);
${beerLambertWGSL}
fn extinction(field:vec4f)->f32 { return max(field.w,0.)*1.8+max(field.z,0.)*.16; }
`;
    const shadow = /* wgsl */`${common}
${sparse}
@group(0) @binding(5) var lightVolume:texture_storage_3d<rgba16float,write>;
@group(0) @binding(6) var<storage,read> bounds:array<i32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u) {
    let tile=vec3u(params[33],params[34],params[35]);
    let tileCells=tile.x*tile.y*tile.z; let index=id.x/tileCells;
    if(index>=params[7]) { return; }
    let address=params[15]+4u*index;
    let offset=id.x%tileCells;
    let local=vec3u(offset%tile.x,(offset/tile.x)%tile.y,offset/(tile.x*tile.y));
    let destination=tileOrigin(index)+local;
    if(table[address+3u]!=params[32] || (table[params[18]+index]&0x80000000u)==0u) {
        textureStore(lightVolume,destination,vec4f(0,0,0,1)); return;
    }
    let location=bitcast<vec3i>(vec3u(table[address],table[address+1u],table[address+2u]));
    let size=blockSize();
    let point=(vec3f(location)+(vec3f(local)-.5)/vec3f(tile-vec3u(2)))*size;
    let lower=vec3f(vec3i(bounds[0],bounds[1],bounds[2]))*size;
    let upper=vec3f(vec3i(bounds[4],bounds[5],bounds[6]))*size;
    let exit3=max((lower-point)/LIGHT_DIRECTION,(upper-point)/LIGHT_DIRECTION);
    let end=max(0.,min(exit3.x,min(exit3.y,exit3.z)));
    var distance=.5*min(size.x/f32(tile.x-2u),min(size.y/f32(tile.y-2u),size.z/f32(tile.z-2u)));
    let stepLength=2./max(worldToCell.x,max(worldToCell.y,worldToCell.z));
    var opticalDepth=0.;
    loop {
        if(distance>=end || opticalDepth>8.) { break; }
        let samplePoint=point+LIGHT_DIRECTION*distance;
        let sampleLocation=vec3i(floor(samplePoint/size));
        if(blockIndex(sampleLocation)==0xffffffffu) {
            let next=distance+nextOccupiedDistance(samplePoint,LIGHT_DIRECTION);
            if(next<=distance) { break; } distance=next; continue;
        }
        let segment=min(stepLength,end-distance);
        opticalDepth+=extinction(sampleField(samplePoint+LIGHT_DIRECTION*.5*segment))*segment;
        let nextDistance=distance+segment;
        if(nextDistance<=distance) { break; } distance=nextDistance;
    }
    textureStore(lightVolume,destination,vec4f(0,0,0,exp(-opticalDepth)));
}`;
    const raymarch = /* wgsl */`${common}
${phaseFunctionsWGSL}
${flowEmissionWGSL(blackbodyWGSL)}
${colorMathWGSL}
${fireDetail ? flowFireDetailWGSL : ''}
struct Camera {
    viewProjection:mat4x4f,
    eye:vec4f, right:vec4f, up:vec4f, forward:vec4f,
    view:vec4f, effect:vec4f, upper:vec4f, options:vec4f,
}
${sparse}
@group(0) @binding(5) var<uniform> camera:Camera;
@group(0) @binding(6) var sceneDepth:texture_depth_2d;
@group(0) @binding(7) var lightVolume:texture_3d<f32>;
@group(0) @binding(8) var colourMap:texture_1d<f32>;
@group(0) @binding(9) var<storage,read> bounds:array<i32>;
@group(0) @binding(10) var cachedColour:texture_2d<f32>;
@group(0) @binding(11) var cachedDepth:texture_2d<f32>;
@group(0) @binding(12) var completedColour:texture_2d<f32>;
struct Vertex { @builtin(position) position:vec4f, @location(0) uv:vec2f }
@vertex fn vertex(@builtin(vertex_index) id:u32)->Vertex {
    let corner=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
    var output:Vertex; output.position=vec4f(corner[id],0,1); output.uv=corner[id]*.5+.5; return output;
}
// Only the background sentinel changes; projection-based reconstruction
// already supports both forward and reversed depth.
fn backgroundDepth(depth:f32)->bool {
    return select(depth>=1.,depth<=0.,camera.effect.y>.5);
}
fn march(uv:vec2f,depth:f32)->vec4f {
    let ndc=uv*2.-1.;
    let direction=normalize(camera.forward.xyz+camera.right.xyz*ndc.x*camera.view.z*camera.view.w+camera.up.xyz*ndc.y*camera.view.w);
    let safeDirection=select(vec3f(-1.e-7),vec3f(1.e-7),direction>=vec3f(0));
    let inverseDirection=1./select(safeDirection,direction,abs(direction)>vec3f(1.e-7));
    if(bounds[3]==0) { return vec4f(0); }
    let size=blockSize();
    let lower=vec3f(vec3i(bounds[0],bounds[1],bounds[2]))*size;
    let upper=vec3f(vec3i(bounds[4],bounds[5],bounds[6]))*size;
    let slab0=(lower-camera.eye.xyz)*inverseDirection;
    let slab1=(upper-camera.eye.xyz)*inverseDirection;
    let near3=min(slab0,slab1); let far3=max(slab0,slab1);
    let begin=max(0.,max(near3.x,max(near3.y,near3.z)));
    var end=min(far3.x,min(far3.y,far3.z));
    if(!backgroundDepth(depth)) {
        let originClip=camera.viewProjection*vec4f(camera.eye.xyz,1);
        let directionClip=camera.viewProjection*vec4f(direction,0);
        let divisor=depth*directionClip.w-directionClip.z;
        if(abs(divisor)>1.e-7) {
            let solidDistance=(originClip.z-depth*originClip.w)/divisor;
            if(solidDistance>0.) { end=min(end,solidDistance); }
        }
    }
    if(end<=begin) { return vec4f(0); }
    // Two samples per displayed/native density cell, with the final partial
    // segment integrated exactly. No frame-dependent jitter when paused.
    let stepLength=.5/max(worldToCell.x,max(worldToCell.y,worldToCell.z));
    let phase=4.*PI*phaseHG(dot(direction,LIGHT_DIRECTION),.25);
    var radiance=vec3f(0); var transmission=1.;
    var distance=begin;
    loop {
        if(distance>=end || transmission<.005) { break; }
        let rayPoint=camera.eye.xyz+direction*(distance+.0001);
        let location=vec3i(floor(rayPoint/size));
        let index=blockIndex(location);
        if(index==0xffffffffu) {
            let next=distance+nextOccupiedDistance(rayPoint,direction);
            if(next<=distance) { break; } distance=next; continue;
        }
        let segment=min(stepLength,end-distance);
        let point=camera.eye.xyz+direction*(distance+.5*segment);
        let sampleLocation=vec3i(floor(point/size));
        var density:vec4f;
        if(all(sampleLocation==location)) { density=sampleFieldInBlock(point,location,index); }
        else { density=sampleField(point); }
        let sigma=extinction(density);
        let stepTransmission=beerLambert(sigma,segment);
        let tile=vec3u(params[33],params[34],params[35]);
        let lightCoordinate=(point/size-vec3f(location))*vec3f(tile-vec3u(2))+vec3f(1);
        let light=textureSampleLevel(lightVolume,fieldSampler,(vec3f(tileOrigin(index))+lightCoordinate)/vec3f(textureDimensions(lightVolume)),0).a;
        let soot=density.w*1.8;
        let scattering=soot*.62*(vec3f(.07,.075,.08)+vec3f(.8,.76,.68)*light*phase);
        // Existing Engine blackbody colours map the normalized temperature to
        // a visual1000–2600K ramp, not a claimed thermodynamic measurement.
        // No fuel or heat alone can glow: native burn must be nonzero.
        // The opt-in reconstruction only erodes this measured emitting volume.
        // The gain is a display exposure; no simulation or extinction changes.
        let emission=emittedRadiance(${fireDetail ? 'flowFlameDetail(density,point,camera.effect.x)' : 'density'})${fireDetail ? '*2.1' : ''};
        let integral=select(segment,(1.-stepTransmission)/max(sigma,.000001),sigma>.000001);
        radiance+=transmission*(scattering+emission)*integral;
        transmission*=stepTransmission;
        let nextDistance=distance+segment;
        if(nextDistance<=distance) { break; } distance=nextDistance;
    }
    // Emission may exceed alpha, as premultiplied volumetric emission should.
    // The Engine HDR shoulder retains variation in the hot core instead of
    // exponentially saturating an extended flame into a uniform yellow patch.
    // Compress display radiance once; the simulation values remain untouched.
    return vec4f(colorToneMapACES(radiance),1.-transmission);
}
fn opaqueDepth(uv:vec2f)->f32 {
    let pixel=vec2i(vec2f(uv.x,1.-uv.y)*camera.view.xy+camera.options.xy);
    return textureLoad(sceneDepth,clamp(pixel,vec2i(0),vec2i(textureDimensions(sceneDepth))-vec2i(1)),0);
}
fn linearDepth(depth:f32)->f32 {
    if(backgroundDepth(depth)) { return 1.e20; }
    let origin=camera.viewProjection*vec4f(camera.eye.xyz,1);
    let forward=camera.viewProjection*vec4f(camera.forward.xyz,0);
    return abs((origin.z-depth*origin.w)/(depth*forward.w-forward.z));
}
struct CachedVolume { @location(0) colour:vec4f, @location(1) depth:f32 }
@fragment fn cacheFragment(input:Vertex)->CachedVolume {
    let depth=opaqueDepth(input.uv);
    var result:CachedVolume; result.colour=march(input.uv,depth); result.depth=depth; return result;
}
@fragment fn refineFragment(input:Vertex)->@location(0) vec4f {
    return march(input.uv,opaqueDepth(input.uv));
}
@fragment fn compositeFragment(input:Vertex)->@location(0) vec4f {
    let uv=vec2f(input.uv.x,1.-input.uv.y);
    let size=vec2i(textureDimensions(cachedColour));
    // Full quality already marched this exact output pixel with its own opaque
    // depth. Preserve that result without a second filtered reconstruction.
    if(all(size==vec2i(camera.view.xy))) {
        return textureLoad(cachedColour,clamp(vec2i(uv*vec2f(size)),vec2i(0),size-vec2i(1)),0);
    }
    let pixel=uv*vec2f(size)-.5; let base=vec2i(floor(pixel)); let weight=fract(pixel);
    let depth=opaqueDepth(input.uv); let distance=linearDepth(depth);
    var colour=vec4f(0); var needsExact=false;
    for(var corner=0;corner<4;corner++) {
        let offset=vec2i(corner&1,corner>>1);
        let tap=clamp(base+offset,vec2i(0),size-vec2i(1));
        let tapDepth=textureLoad(cachedDepth,tap,0).r;
        let compatible=(backgroundDepth(depth) && backgroundDepth(tapDepth)) ||
            (!backgroundDepth(depth) && !backgroundDepth(tapDepth) && abs(linearDepth(tapDepth)-distance)<=max(.015,.025*distance));
        let part=select(vec2f(1)-weight,weight,offset==vec2i(1));
        colour+=textureLoad(cachedColour,tap,0)*part.x*part.y;
        needsExact=needsExact || !compatible;
    }
    // Silhouettes use the original full-resolution ray and opaque depth rather
    // than leaking background smoke over a foreground object or blurring it.
    if(needsExact) { return march(input.uv,depth); }
    return colour;
}
@fragment fn displayFragment(input:Vertex)->@location(0) vec4f {
    let size=vec2i(textureDimensions(completedColour));
    let pixel=vec2i(vec2f(input.uv.x,1.-input.uv.y)*vec2f(size));
    return textureLoad(completedColour,clamp(pixel,vec2i(0),size-vec2i(1)),0);
}`;
    return { shadow, raymarch };
}
