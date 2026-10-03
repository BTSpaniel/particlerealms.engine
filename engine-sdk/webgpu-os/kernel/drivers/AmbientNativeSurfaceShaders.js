// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { AMBIENT_OCEAN_SURFACE_WGSL, AMBIENT_OCEAN_WHITEWATER_WGSL } from './AmbientOceanSurface.js';

/** Render stages for the retained native simulations. Bindings and frame
 * authority remain in AmbientRuntimeV3StatefulLanes. */
export const NATIVE_CHROME_ART = `
struct MetaballState { positionRadius:vec4f, velocityPhase:vec4f }
@group(0) @binding(1) var<storage,read> metaballs:array<MetaballState>;
fn chromeSculpture(p:vec3f)->f32 {
 var distance=10.;
 for(var i=0u;i<u32(art_bodies);i+=1u) {
  let body=metaballs[i];
  let phase=body.velocityPhase.z;
  let center=vec3f((body.positionRadius.x-.5)*1.35,(.5-body.positionRadius.y)*1.12+sin(phase*1.7)*.08,sin(phase)*.17);
  let relative=p-center;
  let rotated=artRotate(relative.xy,.38+sin(phase)*.55);
  let axes=body.positionRadius.z*vec3f(1.75+sin(phase)*.35,1.04,1.24);
  let sphere=(length(vec3f(rotated,relative.z)/axes)-1.)*min(axes.x,min(axes.y,axes.z));
  distance=artSmoothMin(distance,sphere,.21*sqrt(art_cohesion));
 }
 return distance;
}
fn chromeStudio(direction:vec3f,roughness:f32)->vec3f {
 let d=normalize(direction);
 var color=mix(vec3f(.24,.28,.31),vec3f(.35,.41,.46),smoothstep(-.5,.9,d.y));
 let main=pow(max(dot(d,normalize(vec3f(-.35,.55,.75))),0.),mix(13.,5.,roughness));
 let panel=pow(max(dot(d,normalize(vec3f(.85,.21,-.46))),0.),mix(18.,7.,roughness));
 let strip=exp(-pow(abs((d.y+.17+d.x*.37)/( .07+roughness*.2)),2.))*smoothstep(-.95,-.4,d.z);
 let ground=pow(max(dot(d,normalize(vec3f(-.3,-.8,.45))),0.),5.);
 let sideTint=mix(vec3f(.72,1.05,1.35),ambientV3Frame.accentPrimary.rgb*1.1,.10*ambientV3Frame.accentPrimary.a);
 color+=vec3f(2.3,2.13,1.85)*main+sideTint*panel+vec3f(.7,.88,.98)*strip+vec3f(.37,.29,.20)*ground;
 color*=1.-smoothstep(.28,.55,d.x)*smoothstep(.1,.7,d.y)*.56;
 return color;
}
@fragment fn ambientV3LaneFragment(input:AmbientV3LaneVertexOut)->@location(0) vec4f {
 let aspect=ambientV3Frame.resolutionTime.x/max(ambientV3Frame.resolutionTime.y,1.);
 let fit=max(1.,1.55/aspect);
 let p=(input.uv-.5)*vec2f(aspect,-1.)*fit;
 let ro=vec3f(.0,.12,2.3); let rd=normalize(vec3f(p*.94,-1.72));
 var travel=.8; var hit=false; var point=ro;
 for(var step=0;step<56;step+=1) {
  point=ro+rd*travel; let distance=chromeSculpture(point);
  if(distance<.0013) {hit=true;break;}
  travel+=max(distance*.83,.001); if(travel>3.9) {break;}
 }
 let backdrop=mix(vec3f(.032,.044,.052),vec3f(.13,.145,.15),smoothstep(-.4,.65,-p.y));
 var color=backdrop;
 let floorHalo=exp(-dot((p-vec2f(0.,-.42))*vec2f(1.3,5.),(p-vec2f(0.,-.42))*vec2f(1.3,5.))*2.);
 color+=vec3f(.065,.064,.052)*floorHalo;
 if(hit) {
  let e=.002;
  let normal=normalize(vec3f(chromeSculpture(point+vec3f(e,0,0))-chromeSculpture(point-vec3f(e,0,0)),chromeSculpture(point+vec3f(0,e,0))-chromeSculpture(point-vec3f(0,e,0)),chromeSculpture(point+vec3f(0,0,e))-chromeSculpture(point-vec3f(0,0,e))));
  let roughness=art_metalRoughness;
  let reflected=reflect(rd,normal); let reflectedLight=chromeStudio(reflected,roughness);
  let ao=clamp(chromeSculpture(point+normal*.13)/.13,.15,1.);
  let facing=max(dot(normal,-rd),0.); let fresnel=.82+.18*pow(1.-facing,5.);
  let key=normalize(vec3f(-.45,.75,.8)); let halfVector=normalize(key-rd);
  let highlight=pow(max(dot(normal,halfVector),0.),mix(420.,45.,roughness));
  let micro=artNoise3(point*vec3f(180.,12.,180.));
  color=reflectedLight*fresnel*(.70+.30*ao)+vec3f(.65,.61,.54)*highlight;
  color*=.97+.03*micro;
 }
 return vec4f(color,1.);
}`;

export const NATIVE_RIPPLE_ART = `
@group(0) @binding(1) var<storage,read> rippleState:array<vec2f>;
${AMBIENT_OCEAN_SURFACE_WGSL}
${AMBIENT_OCEAN_WHITEWATER_WGSL}
fn seaWaveSettings()->vec4f {
 return vec4f(12.,.42*art_waveHeight,.48,.52);
}
fn seaWindSettings()->vec2f {
 return vec2f(1.05,.22);
}
fn seaSurface(p:vec2f,time:f32,pixelFootprint:f32)->vec4f {
 return ambientOceanSample(p,time,pixelFootprint,seaWaveSettings(),seaWindSettings());
}
fn seaHeightBound(footprint:f32)->f32 {
 return ambientOceanHeightBound(footprint,seaWaveSettings(),seaWindSettings());
}
fn seaRayBounds(direction:vec2f,footprint:f32)->vec2f {
 return ambientOceanRayBounds(direction,footprint,seaWaveSettings(),seaWindSettings());
}
// Keep the original saved-program ABI while new scenes also displace the hit.
fn seaGradient(p:vec2f,time:f32,pixelFootprint:f32)->vec2f {
 return seaSurface(p,time,pixelFootprint).yz;
}
fn seaCameraSettings()->vec3f {
 return vec3f(1.7,.39,1.);
}
fn seaPixelFootprint(travel:f32,cameraHeight:f32,focal:f32,resolution:f32)->f32 {
 return max(.002,travel*travel/max(cameraHeight*focal*resolution,1.));
}
fn seaIntersection(origin:vec3f,ray:vec3f,time:f32,footprint:f32)->f32 {
 let descent=max(-ray.y,.0001); let bound=seaHeightBound(footprint);
 let entry=min(2400.,max(0.,(origin.y-bound)/descent));
 let exit=min(2400.,(origin.y+bound)/descent);
 let bounds=seaRayBounds(ray.xz,footprint);
 var travel=entry; var previous=entry;
 // Both advances stay before the next crossing under the authored bounds.
 // A sub-millimetre minimum permits a sign bracket instead of asymptotic stops.
 for(var step=0;step<128;step+=1) {
  let point=origin+ray*travel;
  let surface=seaSurface(point.xz,time,footprint);
  let residual=point.y-surface.x;
  if(residual<=0.) { break; }
  let derivative=ray.y-dot(surface.yz,ray.xz);
  previous=travel;
  travel=min(exit,travel+ambientOceanRayAdvance(residual,derivative,descent,bounds));
  if(travel<=previous) { break; }
 }
 let last=origin+ray*travel;
 // If the iteration budget or view limit is reached, keep the last finite
 // forward estimate; never jump across the surface to an unrelated rear root.
 if(last.y-seaSurface(last.xz,time,footprint).x>0.) { return travel; }
 var lower=previous; var upper=travel;
 for(var step=0;step<8;step+=1) {
  let middle=(lower+upper)*.5; let point=origin+ray*middle;
  if(point.y-seaSurface(point.xz,time,footprint).x>0.) { lower=middle; } else { upper=middle; }
 }
 return (lower+upper)*.5;
}
fn seaSky(direction:vec3f)->vec3f {
 let elevation=max(direction.y,0.);
 let horizonGlow=exp(-elevation*9.);
 let zenith=mix(vec3f(.022,.047,.087),ambientV3Frame.accentPrimary.rgb*.13,.10*ambientV3Frame.accentPrimary.a);
 return mix(zenith,vec3f(.18,.255,.30),horizonGlow)+vec3f(.011,.019,.023)*exp(-elevation*2.);
}
fn seaMoonDirection(aspect:f32)->vec3f {
 let camera=seaCameraSettings();
 let moonDirection=normalize(vec3f((.68-.5)*aspect,camera.y-.19,camera.z));
 return moonDirection;
}
fn seaMoonRadiance(direction:vec3f,aspect:f32)->vec3f {
 let moonPoint=direction-seaMoonDirection(aspect);
 let moonDistance=length(moonPoint);
 return vec3f(1.25,1.21,1.02)*(1.-smoothstep(.015,.017,moonDistance))+vec3f(.055,.071,.084)*exp(-moonDistance*19.);
}
fn seaMoonLight(normal:vec3f,view:vec3f,roughness:f32,variance:f32,aspect:f32)->vec3f {
 let specular=ambientOceanMoonSpecular(normal,view,seaMoonDirection(aspect),roughness,variance);
 return vec3f(1.4,1.3,1.04)*min(specular*.08,5.);
}
fn seaOptics()->vec4f {
 return vec4f(vec3f(.04,.11,.14)*(.5+.5/(1.+1.)),.16);
}
fn seaReflectionVisibility(direction:vec3f)->vec3f {
 return mix(seaOptics().rgb,seaSky(direction),smoothstep(-.05,0.,direction.y));
}
fn seaReflection(direction:vec3f,roughness:f32,variance:f32)->vec3f {
 let pole=select(vec3f(0.,1.,0.),vec3f(1.,0.,0.),abs(direction.y)>.98);
 let tangent=normalize(cross(pole,direction)); let bitangent=cross(direction,tangent);
 let spread=clamp(roughness*roughness+sqrt(max(variance,0.))*.25,.003,.5);
 return seaReflectionVisibility(direction)*.55+(seaReflectionVisibility(normalize(direction+tangent*spread))+seaReflectionVisibility(normalize(direction-tangent*spread))+seaReflectionVisibility(normalize(direction+bitangent*spread))+seaReflectionVisibility(normalize(direction-bitangent*spread)))*.1125;
}
fn seaWhitewater(point:vec2f,time:f32,footprint:f32)->f32 {
 return ambientOceanWhitewater(point,time,footprint,seaWaveSettings(),seaWindSettings(),vec4f(.65,.17,3.5,2.8),.12);
}
fn seaFoamMaterial(water:vec3f,normal:vec3f,coverage:f32)->vec3f {
 // Air-filled patches are matte: coverage replaces the complete water BRDF,
 // including moon glints, rather than adding another metallic-looking light.
 let diffuse=vec3f(.46,.55,.58)*(.7+.3*max(normal.y,0.));
 return mix(water,diffuse,clamp(coverage,0.,1.));
}
fn seaMist(distance:f32)->f32 {
 return (1.-exp(-distance*.003))*.72;
}
@fragment fn ambientV3LaneFragment(input:AmbientV3LaneVertexOut)->@location(0) vec4f {
 let uv=input.uv; let aspect=ambientV3Frame.resolutionTime.x/max(ambientV3Frame.resolutionTime.y,1.);
 let time=artTime(); let camera=seaCameraSettings(); let horizon=camera.y;
 let origin=vec3f(0.,camera.x,0.);
 let ray=normalize(vec3f((uv.x-.5)*aspect,horizon-uv.y,camera.z));
 var color=seaSky(ray)+seaMoonRadiance(ray,aspect);
 let stars=floor(uv*vec2f(550.,320.)); let local=fract(uv*vec2f(550.,320.))-.5;
 color+=vec3f(.35,.44,.53)*exp(-dot(local,local)*180.)*smoothstep(.994,.999,artHash21(stars))*step(uv.y,horizon-.05);
 let ridge=horizon-.016-(artFbm2(vec2f(uv.x*8.2,4.3))-.25)*.055;
 color=mix(color,vec3f(.047,.085,.103),smoothstep(ridge-.002,ridge+.002,uv.y));
 if(uv.y>horizon) {
  let planeTravel=min(2400.,camera.x/max(-ray.y,.0001));
  let footprint=seaPixelFootprint(planeTravel,camera.x,camera.z,ambientV3Frame.resolutionTime.y);
  let distance=seaIntersection(origin,ray,time,footprint);
  let point=origin+ray*distance;
  let surface=seaSurface(point.xz,time,footprint);
  var gradient=surface.yz;
  let base=(u32(ambientV3Frame.effects.z)&1u)*256u;
  let sample=min(254u,u32(uv.x*255.));
  let simulation=rippleState[base+sample];
  let slope=rippleState[base+sample+1u].x-simulation.x;
  gradient+=vec2f(slope*2.,simulation.x*.12);
  if(ambientV3Frame.clickActivity.z<3.) {
   let delta=(uv-ambientV3Frame.clickActivity.xy)*vec2f(aspect,1.);
   let radius=length(delta); let age=ambientV3Frame.clickActivity.z;
   let envelope=exp(-pow((radius-age*.075)*36.,2.))*exp(-age*1.2);
   gradient+=delta/max(radius,.001)*cos(radius*140.-age*8.)*envelope*.11*art_rippleStrength;
  }
  let normal=normalize(vec3f(-gradient.x,1.,-gradient.y));
  let view=-ray;
  let reflected=reflect(-view,normal);
  let fresnel=ambientOceanFresnel(max(dot(normal,view),0.));
  let optics=seaOptics();
  let sky=seaReflection(reflected,optics.w,surface.w);
  let crestScatter=smoothstep(-.14,.24,surface.x)*(.5+.5*normal.y);
  color=optics.rgb*(.65+.35*normal.y+crestScatter*.32)*(1.-fresnel)+sky*fresnel;
  color+=seaMoonLight(normal,view,optics.w,surface.w,aspect);
  let foam=seaWhitewater(point.xz,time,footprint);
  color=seaFoamMaterial(color,normal,foam);
  color=mix(color,seaSky(normalize(vec3f(ray.x,.008,ray.z))),seaMist(distance));
 }
 return vec4f(color,1.);
}`;

export const NATIVE_QUANTUM_ART = `
@group(0) @binding(1) var quantumField:texture_2d<f32>;
@fragment fn ambientV3LaneFragment(input:AmbientV3LaneVertexOut)->@location(0) vec4f {
 let dimensions=textureDimensions(quantumField);
 let state=textureLoad(quantumField,clamp(vec2i(input.uv*vec2f(dimensions)),vec2i(0),vec2i(dimensions)-vec2i(1)),0);
 let aspect=ambientV3Frame.resolutionTime.x/max(ambientV3Frame.resolutionTime.y,1.);
 let fit=max(1.,1.28/aspect);
 let p=(input.uv-.5)*vec2f(aspect,1.)*fit*2.5;
 let time=artTime();
 let rotated=artRotate(p,.34+sin(time*.017)*.08);
 var color=vec3f(.009,.018,.028); var transmittance=1.;
 let jitter=artHash21(floor(input.uv*ambientV3Frame.resolutionTime.xy));
 for(var step=0;step<52;step+=1) {
  let depth=(f32(step)+jitter)*.050-1.3;
  var q=vec3f(rotated,depth); q=vec3f(q.x,artRotate(q.yz,.82));
  let angle=atan2(q.y,q.x); let radius=length(q.xy);
  let bend=.10*sin(angle*3.+time*.04)+.035*sin(angle*7.-time*.031);
  let section=vec2f(radius-(.66+bend),q.z+.10*sin(angle*2.+time*.025));
  let crossAngle=atan2(section.y,section.x);
  let tube=length(section*vec2f(1.,1.25));
  let sectionDistance=(tube-.145)*27.; let envelope=exp(-sectionDistance*sectionDistance);
  let wave=angle*(7.+art_fringeScale*4.)+crossAngle*3.+time*.11+state.x*.3;
  let ribbon=pow(.5+.5*sin(wave),14.);
  let fine=pow(.5+.5*sin(wave*3.1+crossAngle*5.),30.);
  let density=envelope*(.026+ribbon*.24+fine*.045)*(.45+art_coherence*.65);
  let tint=mix(mix(vec3f(.045,.52,.63),vec3f(1.15,.56,.13),.5+.5*sin(angle-.45)),ambientV3Frame.accentPrimary.rgb*.85,clamp(state.z*.22,0.,.18)*ambientV3Frame.accentPrimary.a);
  let inner=exp(-pow(tube*15.,2.));
  color+=transmittance*(tint*density*3.8+vec3f(.29,.46,.51)*inner*.012);
  transmittance*=max(1.-density*.78,0.);
 }
 return vec4f(color,1.);
}`;
