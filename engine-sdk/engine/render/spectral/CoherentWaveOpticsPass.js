// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { initVGPU } from '../../core/gpu/VirtualGPU.js';
import {
  LEGACY_PCG32_WGSL,
  LEGACY_STANDALONE_RUNTIME_PCG_WGSL,
} from '../../core/math/MathBits.js';

const COHERENT_WAVE_ACCUM_WGSL = `
struct U{time:f32,aspect:f32,yaw:f32,pitch:f32,frame:u32,reset:f32,mode:f32,wavelength:f32,slitSep:f32,camX:f32,camY:f32,camZ:f32,screenDist:f32,slitWidth:f32,slitHeight:f32,fov:f32,debugViz:f32,fieldViz:f32,coherence:f32,moving:f32}
@group(0)@binding(0) var<uniform> u:U;
@group(0)@binding(1) var prevAccum:texture_2d<f32>;
@group(0)@binding(2) var prevSmp:sampler;
struct VO{@builtin(position) p:vec4f,@location(0) uv:vec2f}
struct BoxHit{t:f32,n:vec3f}
struct Hit{t:f32,n:vec3f,alb:vec3f,rough:f32,metal:f32,emis:vec3f}
@vertex fn vs(@builtin(vertex_index) i:u32)->VO{var o:VO;let x=f32(i%2u)*4.-1.;let y=f32(i/2u)*4.-1.;o.p=vec4f(x,y,0.,1.);o.uv=vec2f(x*.5+.5,-y*.5+.5);return o;}
${LEGACY_PCG32_WGSL}
${LEGACY_STANDALONE_RUNTIME_PCG_WGSL}
fn pcg(v:u32)->u32{return legacyStandaloneRuntimePcgHash32(v);}
fn rf(s:ptr<function,u32>)->f32{return legacyStandaloneRuntimePcgHashStepRandomFloat01(s);}
fn cmfX(lambda:f32)->f32{return 1.056*exp(-0.5*pow((lambda-599.8)/37.9,2.0))+0.362*exp(-0.5*pow((lambda-442.0)/16.0,2.0))-0.065*exp(-0.5*pow((lambda-501.1)/20.4,2.0));}
fn cmfY(lambda:f32)->f32{return 0.821*exp(-0.5*pow((lambda-568.8)/46.9,2.0))+0.286*exp(-0.5*pow((lambda-530.9)/16.3,2.0));}
fn cmfZ(lambda:f32)->f32{return 1.217*exp(-0.5*pow((lambda-437.0)/11.8,2.0))+0.681*exp(-0.5*pow((lambda-459.0)/26.0,2.0));}
fn xyzToLinearSrgb(xyz:vec3f)->vec3f{return vec3f(3.2406*xyz.x-1.5372*xyz.y-0.4986*xyz.z,-0.9689*xyz.x+1.8758*xyz.y+0.0415*xyz.z,0.0557*xyz.x-0.2040*xyz.y+1.0570*xyz.z);}
fn wavelengthToLinearRgb(wl:f32,value:f32)->vec3f{return max(xyzToLinearSrgb(vec3f(max(0.0,cmfX(wl))*value,max(0.0,cmfY(wl))*value,max(0.0,cmfZ(wl))*value)),vec3f(0.0));}
fn sinc(x:f32)->f32{if(abs(x)<0.0001){return 1.0;}return sin(x)/x;}
fn dGGX(h:f32,a:f32)->f32{let a2=a*a;let d=h*h*(a2-1.0)+1.0;return a2/(3.14159265*d*d+0.0001);}
fn gSmith(nv:f32,nl:f32,a:f32)->f32{let k=a*a*0.5;return(nv/(nv*(1.0-k)+k))*(nl/(nl*(1.0-k)+k));}
fn fSch(c:f32,F0:vec3f)->vec3f{return F0+(1.0-F0)*pow(1.0-c,5.0);}
fn sky(rd:vec3f,t:f32)->vec3f{let sd=max(dot(rd,normalize(vec3f(-0.54,0.62,-0.57))),0.0);let h=clamp(rd.y*0.5+0.5,0.0,1.0);var s=mix(vec3f(0.012,0.022,0.043),vec3f(0.0025,0.004,0.009),pow(1.0-h,1.65));s+=vec3f(0.04,0.22,0.28)*exp(-abs(rd.y)*7.0)*0.055+vec3f(1.0,0.60,0.30)*pow(sd,220.0)*1.7+vec3f(0.42,0.12,0.24)*pow(sd,18.0)*0.055;return s;}
fn lpos(li:i32,t:f32)->vec3f{return array<vec3f,3>(vec3f(-2.4,2.1,-1.5),vec3f(2.8,1.4,0.6),vec3f(0.35,2.7,2.0))[li];}
fn lcol(li:i32)->vec3f{return array<vec3f,3>(vec3f(0.18,0.72,1.0)*13.0,vec3f(1.0,0.42,0.12)*11.0,vec3f(0.82,0.16,0.64)*8.0)[li];}
fn missBox()->BoxHit{return BoxHit(-1.0,vec3f(0.0));}
fn hitBox(ro:vec3f,rd:vec3f,c:vec3f,b:vec3f)->BoxHit{let inv=vec3f(1.0)/rd;let t0=(c-b-ro)*inv;let t1=(c+b-ro)*inv;let tn=min(t0,t1);let tf=max(t0,t1);let tN=max(max(tn.x,tn.y),tn.z);let tF=min(min(tf.x,tf.y),tf.z);if(tN>tF||tF<0.001){return missBox();}let t=select(tF,tN,tN>0.001);let hp=ro+rd*t-c;let e=0.002;var n=vec3f(0.0,0.0,sign(hp.z));if(abs(abs(hp.x)-b.x)<e){n=vec3f(sign(hp.x),0.0,0.0);}else if(abs(abs(hp.y)-b.y)<e){n=vec3f(0.0,sign(hp.y),0.0);}return BoxHit(t,n);}
fn segDist(p:vec3f,a:vec3f,b:vec3f)->f32{let ab=b-a;let t=clamp(dot(p-a,ab)/max(dot(ab,ab),1e-6),0.0,1.0);return length(p-(a+ab*t));}
fn waveRibbon(p:vec3f,origin:vec3f,dir:vec3f,spacing:f32,width:f32)->f32{let axial=dot(p-origin,dir);let radial=length((p-origin)-dir*axial);let phase=fract(axial/spacing);let line=min(abs(phase),abs(phase-1.0));return exp(-radial*radial/(width*width))*exp(-line*line*95.0);}
fn debugOverlay(p:vec3f)->vec3f{
  let source=vec3f(0.0,0.12,-1.95);
  let plateZ=-0.45;
  let sx=u.slitSep*0.26;
  let slitL=vec3f(-sx,0.12,plateZ);
  let slitR=vec3f(sx,0.12,plateZ);
  let screenCenter=vec3f(0.0,0.15,3.25);
  let rayW=.045;
  let d0=segDist(p,source,slitL);
  let d1=segDist(p,source,slitR);
  let d2=segDist(p,slitL,screenCenter);
  let d3=segDist(p,slitR,screenCenter);
  let sourceGlow=exp(-dot(p-source,p-source)*42.0)*vec3f(0.35,0.85,1.8);
  let slitGlow=(exp(-dot(p-slitL,p-slitL)*130.0)+exp(-dot(p-slitR,p-slitR)*130.0))*vec3f(0.45,1.1,2.1);
  let rayColor=(exp(-d0*d0/(rayW*rayW))+exp(-d1*d1/(rayW*rayW)))*vec3f(0.14,0.42,1.05)+(exp(-d2*d2/(rayW*rayW))+exp(-d3*d3/(rayW*rayW)))*vec3f(0.16,0.9,1.35);
  let leftDir=normalize(screenCenter-slitL);
  let rightDir=normalize(screenCenter-slitR);
  let waveColor=waveRibbon(p,slitL,leftDir,0.34,0.085)*vec3f(0.16,0.85,1.7)+waveRibbon(p,slitR,rightDir,0.34,0.085)*vec3f(0.16,0.85,1.7)+waveRibbon(p,source,normalize(vec3f(0.0,0.0,1.0)),0.30,0.06)*vec3f(0.08,0.45,1.2);
  return sourceGlow+slitGlow+rayColor*0.38+waveColor*0.52;
}
fn screenSampleAtWavelength(p:vec3f,wl:f32,sourceWeight:f32)->vec3f{
  let xM=p.x*0.055;
  let yM=(p.y-0.15)*0.0025;
  let d=u.slitSep*0.00045;
  let lam=wl*1e-9;
  let L=u.screenDist;
  let rL=sqrt(L*L+(xM+d*0.5)*(xM+d*0.5)+yM*yM);
  let rR=sqrt(L*L+(xM-d*0.5)*(xM-d*0.5)+yM*yM);
  let rC=sqrt(L*L+xM*xM+yM*yM);
  let pathDelta=(-2.0*xM*d)/max(rR+rL,1e-7);
  let phase=6.2831853*pathDelta/max(lam,1e-9);
  let interference=0.5+0.5*clamp(u.coherence,0.0,1.0)*cos(phase);
  let sinThetaX=xM/max(rC,1e-7);
  let sinThetaY=yM/max(rC,1e-7);
  let slitEnv=pow(sinc(3.14159265*u.slitWidth*sinThetaX/max(lam,1e-9)),2.0);
  let heightEnv=pow(sinc(3.14159265*u.slitHeight*sinThetaY/max(lam,1e-9)),2.0);
  let beamProfile=exp(-(xM*xM)*2.4-yM*yM*6.5);
  let intensity=interference*2.65*slitEnv*heightEnv*sourceWeight*beamProfile;
  return wavelengthToLinearRgb(wl,intensity);
}
fn screenPattern(p:vec3f)->vec3f{
  if(u.mode>0.5){return screenSampleAtWavelength(p,clamp(u.wavelength,380.0,780.0),1.0);}
  var col=vec3f(0.0);
  var weightSum=0.0;
  for(var i=0;i<13;i=i+1){
    let wl=mix(410.0,690.0,f32(i)/12.0);
    let source=0.48+0.52*exp(-pow((wl-555.0)/118.0,2.0));
    col+=screenSampleAtWavelength(p,wl,source);
    weightSum+=source;
  }
  return col/max(weightSum,1e-4);
}
fn opticalFieldDensity(p:vec3f)->f32{
  let visibility=max(u.fieldViz,u.debugViz);
  if(visibility<=0.001||p.z< -2.25||p.z>3.32){return 0.0;}
  let wavelengthScale=clamp(u.wavelength/532.0,0.72,1.32);
  let spacing=0.245*wavelengthScale;
  if(p.z< -0.45){
    let radial=length(p.xy-vec2f(0.0,0.12));
    let phase=6.2831853*((p.z+1.95)/spacing-u.time*0.16);
    let crest=pow(0.5+0.5*cos(phase),18.0);
    let axial=smoothstep(-2.18,-1.92,p.z)*(1.0-smoothstep(-0.62,-0.45,p.z));
    return (0.035+crest*0.19)*exp(-radial*radial*38.0)*axial*visibility;
  }
  let sx=u.slitSep*0.26;
  let slitL=vec3f(-sx,0.12,-0.45);
  let slitR=vec3f(sx,0.12,-0.45);
  let rL=length(p-slitL);
  let rR=length(p-slitR);
  let phaseTime=u.time*0.16;
  let shellL=pow(0.5+0.5*cos(6.2831853*(rL/spacing-phaseTime)),22.0)/max(0.8,rL);
  let shellR=pow(0.5+0.5*cos(6.2831853*(rR/spacing-phaseTime)),22.0)/max(0.8,rR);
  let phaseCross=0.5+0.5*clamp(u.coherence,0.0,1.0)*cos(6.2831853*(rL-rR)/spacing);
  let sheet=exp(-abs(p.y-0.12)*2.8);
  let reach=smoothstep(-0.45,-0.24,p.z)*(1.0-smoothstep(3.12,3.30,p.z));
  return (shellL+shellR)*(0.035+phaseCross*0.12)*sheet*reach*visibility;
}
fn integrateOpticalField(ro:vec3f,rd:vec3f,tMax:f32)->vec3f{
  let visibility=max(u.fieldViz,u.debugViz);
  if(visibility<=0.001){return vec3f(0.0);}
  let span=max(0.0,min(tMax,9.0)-0.06);
  if(span<=0.0){return vec3f(0.0);}
  var sum=0.0;
  for(var step=0;step<10;step=step+1){
    let distance=(f32(step)+0.5)*(span/10.0)+0.06;
    sum+=opticalFieldDensity(ro+rd*distance);
  }
  let fieldColor=wavelengthToLinearRgb(clamp(u.wavelength,410.0,690.0),1.0)+vec3f(0.025,0.055,0.085);
  return fieldColor*sum*(span/10.0)*0.72;
}
fn scene(ro:vec3f,rd:vec3f)->Hit{
  var h=Hit(1e9,vec3f(0.0,1.0,0.0),vec3f(0.6),1.0,0.0,vec3f(0.0));
  let floorT=select(-1.0,(-1.1-ro.y)/rd.y,rd.y<-0.0001);
  if(floorT>0.001&&floorT<h.t){let fp=ro+rd*floorT;let grid=0.5+0.5*cos(fp.x*3.14159265)*cos(fp.z*3.14159265);h=Hit(floorT,vec3f(0.0,1.0,0.0),mix(vec3f(0.007,0.010,0.016),vec3f(0.018,0.026,0.036),grid*0.35),0.22,0.18,vec3f(0.0));}

  let screen=hitBox(ro,rd,vec3f(0.0,0.15,3.25),vec3f(3.0,1.55,0.045));
  if(screen.t>0.001&&screen.t<h.t){let sp=ro+rd*screen.t;let front=select(0.025,1.0,screen.n.z<0.0);h=Hit(screen.t,screen.n,vec3f(0.045,0.058,0.075),0.38,0.05,screenPattern(sp)*4.8*front+vec3f(0.002,0.003,0.006));}

  let frameTop=hitBox(ro,rd,vec3f(0.0,1.77,3.25),vec3f(3.17,0.075,0.12));
  if(frameTop.t>0.001&&frameTop.t<h.t){h=Hit(frameTop.t,frameTop.n,vec3f(0.18,0.095,0.035),0.27,0.82,vec3f(0.0));}
  let frameBottom=hitBox(ro,rd,vec3f(0.0,-1.47,3.25),vec3f(3.17,0.075,0.12));
  if(frameBottom.t>0.001&&frameBottom.t<h.t){h=Hit(frameBottom.t,frameBottom.n,vec3f(0.18,0.095,0.035),0.27,0.82,vec3f(0.0));}
  let frameLeft=hitBox(ro,rd,vec3f(-3.10,0.15,3.25),vec3f(0.075,1.55,0.12));
  if(frameLeft.t>0.001&&frameLeft.t<h.t){h=Hit(frameLeft.t,frameLeft.n,vec3f(0.18,0.095,0.035),0.27,0.82,vec3f(0.0));}
  let frameRight=hitBox(ro,rd,vec3f(3.10,0.15,3.25),vec3f(0.075,1.55,0.12));
  if(frameRight.t>0.001&&frameRight.t<h.t){h=Hit(frameRight.t,frameRight.n,vec3f(0.18,0.095,0.035),0.27,0.82,vec3f(0.0));}

  let plate=hitBox(ro,rd,vec3f(0.0,0.12,-0.45),vec3f(1.30,0.95,0.05));
  if(plate.t>0.001&&plate.t<h.t){let pp=ro+rd*plate.t-vec3f(0.0,0.12,-0.45);let sx=u.slitSep*0.26;let inSlit=(abs(abs(pp.x)-sx)<0.045)&&abs(pp.y)<0.58;if(!inSlit){h=Hit(plate.t,plate.n,vec3f(0.075,0.11,0.17),0.17,0.91,vec3f(0.0));}}
  let plateMount=hitBox(ro,rd,vec3f(0.0,-0.72,-0.45),vec3f(0.085,0.34,0.10));
  if(plateMount.t>0.001&&plateMount.t<h.t){h=Hit(plateMount.t,plateMount.n,vec3f(0.16,0.085,0.032),0.25,0.84,vec3f(0.0));}

  let laser=hitBox(ro,rd,vec3f(0.0,0.12,-1.95),vec3f(0.22,0.15,0.32));
  if(laser.t>0.001&&laser.t<h.t){h=Hit(laser.t,laser.n,vec3f(0.025,0.038,0.055),0.24,0.82,vec3f(0.0));}
  let lens=hitBox(ro,rd,vec3f(0.0,0.12,-1.615),vec3f(0.075,0.075,0.018));
  if(lens.t>0.001&&lens.t<h.t){h=Hit(lens.t,lens.n,vec3f(0.012,0.02,0.028),0.12,0.32,wavelengthToLinearRgb(u.wavelength,0.72));}
  let laserMount=hitBox(ro,rd,vec3f(0.0,-0.72,-1.95),vec3f(0.09,0.35,0.10));
  if(laserMount.t>0.001&&laserMount.t<h.t){h=Hit(laserMount.t,laserMount.n,vec3f(0.16,0.085,0.032),0.25,0.84,vec3f(0.0));}
  return h;
}
fn shadowOccluded(ro:vec3f,rd:vec3f,maxDistance:f32)->bool{
  let screen=hitBox(ro,rd,vec3f(0.0,0.15,3.25),vec3f(3.17,1.70,0.12));
  if(screen.t>0.001&&screen.t<maxDistance){return true;}
  let plate=hitBox(ro,rd,vec3f(0.0,0.12,-0.45),vec3f(1.30,0.95,0.05));
  if(plate.t>0.001&&plate.t<maxDistance){let pp=ro+rd*plate.t-vec3f(0.0,0.12,-0.45);let sx=u.slitSep*0.26;let inSlit=(abs(abs(pp.x)-sx)<0.045)&&abs(pp.y)<0.58;if(!inSlit){return true;}}
  let laser=hitBox(ro,rd,vec3f(0.0,0.12,-1.95),vec3f(0.22,0.15,0.32));
  if(laser.t>0.001&&laser.t<maxDistance){return true;}
  return false;
}
fn shadow(p:vec3f,L:vec3f,dist:f32)->f32{return select(1.0,0.0,shadowOccluded(p,L,dist-0.01));}
fn shade(p:vec3f,n:vec3f,V:vec3f,h:Hit,t:f32,castShadow:bool)->vec3f{let F0=mix(vec3f(0.04),h.alb,h.metal);let NoV=max(dot(n,V),0.001);var lo=vec3f(0.0);for(var li=0;li<3;li=li+1){let lp=lpos(li,t);let lv=lp-p;let dist=length(lv);let L=lv/dist;let H=normalize(V+L);let NoL=max(dot(n,L),0.0);let NoH=max(dot(n,H),0.0);let VoH=max(dot(V,H),0.0);let occ=select(1.0,shadow(p+n*0.01,L,dist),castShadow);let D=dGGX(NoH,max(h.rough,0.04));let G=gSmith(NoV,NoL,max(h.rough,0.04));let F=fSch(VoH,F0);lo+=((vec3f(1.0)-F)*(1.0-h.metal)*h.alb/3.14159265+D*G*F/(4.0*NoV*NoL+0.001))*lcol(li)*NoL*(1.0/(dist*dist+0.05))*occ;}let refl=reflect(-V,n);let Fenv=fSch(NoV,F0);lo+=(vec3f(1.0)-Fenv)*(1.0-h.metal)*h.alb*sky(n,t)*0.22+Fenv*sky(refl,t)*mix(1.0,0.08,h.rough*h.rough);return lo+h.emis;}
@fragment fn fs(i:VO)->@location(0) vec4f{
  let prevSample=textureSampleLevel(prevAccum,prevSmp,i.uv,0.0);
  let prev=select(prevSample.rgb,vec3f(0.0),u.reset>0.5);
  let cnt=select(prevSample.a,0.0,u.reset>0.5);
  let suv=vec2f((i.uv.x*2.0-1.0)*u.aspect,-(i.uv.y*2.0-1.0));
  let cp=cos(u.pitch);
  let sp=sin(u.pitch);
  let cy=cos(u.yaw);
  let sy=sin(u.yaw);
  let ro=vec3f(u.camX,u.camY,u.camZ);
  let fw=normalize(vec3f(sy*cp,sp,cy*cp));
  let rt=normalize(cross(vec3f(0.0,1.0,0.0),fw));
  let up=cross(fw,rt);
  var seed=u32(i.p.x)*1664525u+u32(i.p.y)*1013904223u+u.frame*747796405u;
  let lens=tan(u.fov*0.5);
  var jx=0.0;
  var jy=0.0;
  if(u.moving<0.5){let pixel=1.0/vec2f(textureDimensions(prevAccum,0));jx=(rf(&seed)-0.5)*2.0*pixel.x*u.aspect;jy=(rf(&seed)-0.5)*2.0*pixel.y;}
  let rd=normalize(fw+(suv.x+jx)*lens*rt+(suv.y+jy)*lens*up);
  let h=scene(ro,rd);
  var col=sky(rd,u.time);
  if(h.t<1e8){
    let p=ro+rd*h.t;
    let V=normalize(-rd);
    col=shade(p,h.n,V,h,u.time,true);
    if(u.debugViz>0.5){col+=debugOverlay(p);}
    if(h.rough<0.35||h.metal>0.2){
      let rrd=reflect(rd,h.n);
      let rh=scene(p+h.n*0.01,rrd);
      var rc=sky(rrd,u.time);
      if(rh.t<1e8){let rp=p+h.n*0.01+rrd*rh.t;rc=shade(rp,rh.n,normalize(-rrd),rh,u.time,false);if(u.debugViz>0.5){rc+=debugOverlay(rp);}}
      let Fr=fSch(max(dot(h.n,V),0.0),mix(vec3f(0.04),h.alb,h.metal));
      col=mix(col,rc,Fr*mix(0.78,0.22,h.rough));
    }
  }
  let volumeLimit=select(9.0,min(h.t,9.0),h.t<1e8);
  col+=integrateOpticalField(ro,rd,volumeLimit);
  col=clamp(col,vec3f(0.0),vec3f(20.0));
  let nextCount=min(cnt+1.0,256.0);
  let nextMean=mix(prev,col,1.0/max(nextCount,1.0));
  return vec4f(nextMean,nextCount);
}
`;

const COHERENT_WAVE_LEGACY_DISPLAY_WGSL = `
@group(0)@binding(0) var accTex:texture_2d<f32>;
@group(0)@binding(1) var accSmp:sampler;
struct VO{@builtin(position) p:vec4f,@location(0) uv:vec2f}
@vertex fn vs(@builtin(vertex_index) i:u32)->VO{var o:VO;let x=f32(i%2u)*4.-1.;let y=f32(i/2u)*4.-1.;o.p=vec4f(x,y,0.,1.);o.uv=vec2f(x*.5+.5,-y*.5+.5);return o;}
fn acc4(uv:vec2f)->vec4f{let s=textureSampleLevel(accTex,accSmp,uv,0.0);return vec4f(s.rgb/max(s.a,1.0),s.a);}
fn acc(uv:vec2f)->vec3f{return acc4(uv).rgb;}
fn lum(c:vec3f)->f32{return dot(c,vec3f(0.2126,0.7152,0.0722));}
fn bright(c:vec3f)->vec3f{return max(c-vec3f(0.9),vec3f(0.0));}
fn ew(a:vec3f,b:vec3f,s:f32)->f32{return exp(-abs(lum(a)-lum(b))*s-length(a-b)*s*0.32);}
@fragment fn fs(i:VO)->@location(0)vec4f{let px=1.0/vec2f(textureDimensions(accTex,0));let center4=acc4(i.uv);let center=center4.rgb;let screenR=dot(i.uv*2.0-1.0,i.uv*2.0-1.0);let adaptiveSigma=max(0.08,mix(0.18,0.34,smoothstep(10.0,28.0,center4.a))-smoothstep(0.35,1.1,screenR)*0.08);var sSum=vec3f(0.0);var tw=0.0;var lumSum=0.0;var lumSq=0.0;for(var jj=-3;jj<=3;jj=jj+1){for(var ii=-3;ii<=3;ii=ii+1){let off=vec2f(f32(ii),f32(jj));let c4=acc4(i.uv+off*px);let c=c4.rgb;let aMatch=exp(-abs(c4.a-center4.a)*0.035);let cw=exp(-dot(off,off)*adaptiveSigma)*exp(-length(c-center)*0.52)*aMatch*(0.35+0.65*smoothstep(1.0,12.0,c4.a));let clum=lum(c);sSum+=c*cw;tw+=cw;lumSum+=clum*cw;lumSq+=clum*clum*cw;}}let spatialCol=sSum/tw;let localLum=lumSum/tw;let localVar=max(0.0,lumSq/tw-localLum*localLum);let ctr=textureSample(accTex,accSmp,i.uv);let cR=acc(i.uv+vec2f(px.x,0.0));let cL=acc(i.uv+vec2f(-px.x,0.0));let cU=acc(i.uv+vec2f(0.0,px.y));let cD=acc(i.uv+vec2f(0.0,-px.y));let cUR=acc(i.uv+px);let cUL=acc(i.uv+vec2f(-px.x,px.y));let cDR=acc(i.uv+vec2f(px.x,-px.y));let cDL=acc(i.uv-px);let nAvg=(cR+cL+cU+cD+cUR+cUL+cDR+cDL)*0.125;let p2=px*2.0;let p4=px*4.0;let cR2=acc(i.uv+vec2f(p2.x,0.0));let cL2=acc(i.uv+vec2f(-p2.x,0.0));let cU2=acc(i.uv+vec2f(0.0,p2.y));let cD2=acc(i.uv+vec2f(0.0,-p2.y));let cR4=acc(i.uv+vec2f(p4.x,0.0));let cL4=acc(i.uv+vec2f(-p4.x,0.0));let cU4=acc(i.uv+vec2f(0.0,p4.y));let cD4=acc(i.uv+vec2f(0.0,-p4.y));var coneSum=center*0.30;var coneW=0.30;let wR=ew(center,cR,2.4)*0.105;let wL=ew(center,cL,2.4)*0.105;let wU=ew(center,cU,2.4)*0.105;let wD=ew(center,cD,2.4)*0.105;let wUR=ew(center,cUR,2.2)*0.055;let wUL=ew(center,cUL,2.2)*0.055;let wDR=ew(center,cDR,2.2)*0.055;let wDL=ew(center,cDL,2.2)*0.055;let wR2=ew(center,cR2,1.55)*0.060;let wL2=ew(center,cL2,1.55)*0.060;let wU2=ew(center,cU2,1.55)*0.060;let wD2=ew(center,cD2,1.55)*0.060;let wR4=ew(center,cR4,1.05)*0.032;let wL4=ew(center,cL4,1.05)*0.032;let wU4=ew(center,cU4,1.05)*0.032;let wD4=ew(center,cD4,1.05)*0.032;coneSum+=cR*wR+cL*wL+cU*wU+cD*wD+cUR*wUR+cUL*wUL+cDR*wDR+cDL*wDL+cR2*wR2+cL2*wL2+cU2*wU2+cD2*wD2+cR4*wR4+cL4*wL4+cU4*wU4+cD4*wD4;coneW+=wR+wL+wU+wD+wUR+wUL+wDR+wDL+wR2+wL2+wU2+wD2+wR4+wL4+wU4+wD4;let coneCol=coneSum/coneW;let nMin=min(min(min(cR,cL),min(cU,cD)),min(min(cUR,cUL),min(cDR,cDL)));let nMax=max(max(max(cR,cL),max(cU,cD)),max(max(cUR,cUL),max(cDR,cDL)));let nPad=vec3f(0.08)+abs(nAvg)*0.32;let historyTrust=smoothstep(3.0,22.0,ctr.a);let highlightSplit=smoothstep(0.75,2.2,lum(center))*smoothstep(0.06,0.55,length(center-nAvg));let gaussianBlend=clamp(smoothstep(0.0015,0.055,localVar)+smoothstep(0.30,1.1,screenR)*0.34+(1.0-historyTrust)*0.42,0.0,1.0);let voxelBlend=clamp(gaussianBlend*0.58+smoothstep(0.018,0.12,localVar)*0.28,0.0,1.0);let reconCol=mix(spatialCol,coneCol,voxelBlend);let speckle=clamp(smoothstep(0.16,1.15,length(center-reconCol))*(1.0-historyTrust*0.7)+highlightSplit*0.55+gaussianBlend*0.35,0.0,1.0);let matched=mix(clamp(center,nMin-nPad,nMax+nPad),center,historyTrust*0.65);let perPixel=mix(matched,reconCol,speckle*0.86);let enhancement=max(vec3f(0.0),perPixel-reconCol);let alpha=smoothstep(0.0,16.0,ctr.a);let sharp=perPixel-spatialCol;var bloom=vec3f(0.0);let bloomBase=mix(reconCol,perPixel,0.58);bloom+=bright(bloomBase)*1.15;bloom+=(bright(cR)+bright(cL)+bright(cU)+bright(cD))*0.14;bloom+=(bright(cUR)+bright(cUL)+bright(cDR)+bright(cDL))*0.09;let hotCore=smoothstep(0.85,2.4,lum(bloomBase));var col=mix(perPixel,reconCol,gaussianBlend*0.50)+enhancement*alpha*0.36+sharp*0.025*alpha+bloom*mix(0.07,0.13,hotCore);col*=vec3f(1.04,1.01,0.96);col=(col*(2.51*col+0.03))/(col*(2.43*col+0.59)+0.14);col=pow(clamp(col,vec3f(0.0),vec3f(1.0)),vec3f(0.92));col=pow(clamp(col,vec3f(0.0),vec3f(1.0)),vec3f(0.4545));let vd=length((i.uv*2.0-1.0));col*=1.0-smoothstep(0.72,1.55,vd)*0.36;return vec4f(col,1.0);}
`;

// Compact presenter for the moving laboratory. The legacy reconstruction above
// is retained as shader-source compatibility evidence, but this path performs
// only nine edge-aware HDR fetches instead of the previous wide gather.
const COHERENT_WAVE_DISPLAY_WGSL = `
@group(0)@binding(0) var accTex:texture_2d<f32>;
@group(0)@binding(1) var accSmp:sampler;
struct VO{@builtin(position) p:vec4f,@location(0) uv:vec2f}
@vertex fn vs(@builtin(vertex_index) i:u32)->VO{var o:VO;let x=f32(i%2u)*4.-1.;let y=f32(i/2u)*4.-1.;o.p=vec4f(x,y,0.,1.);o.uv=vec2f(x*.5+.5,-y*.5+.5);return o;}
fn sampleAccum(uv:vec2f)->vec4f{return textureSampleLevel(accTex,accSmp,uv,0.0);}
fn luminance(c:vec3f)->f32{return dot(c,vec3f(0.2126,0.7152,0.0722));}
fn edgeWeight(center:vec3f,candidate:vec3f,spatial:f32)->f32{
  let lumDelta=abs(luminance(center)-luminance(candidate));
  return spatial*exp(-lumDelta*4.2-length(center-candidate)*0.62);
}
fn bloomPrefilter(c:vec3f)->vec3f{
  let peak=max(c.r,max(c.g,c.b));
  let soft=clamp((peak-0.72)/0.92,0.0,1.0);
  return c*soft*soft/max(peak,1e-4);
}
fn pbrNeutral(colorInput:vec3f)->vec3f{
  var color=max(colorInput,vec3f(0.0));
  let startCompression=0.76;
  let darkest=min(color.r,min(color.g,color.b));
  let offset=select(0.04,darkest-6.25*darkest*darkest,darkest<0.08);
  color-=vec3f(offset);
  let peak=max(color.r,max(color.g,color.b));
  if(peak<startCompression){return color;}
  let distance=1.0-startCompression;
  let newPeak=1.0-distance*distance/(peak+distance-startCompression);
  color*=newPeak/max(peak,1e-5);
  let desaturation=1.0-1.0/(0.15*(peak-newPeak)+1.0);
  return mix(color,vec3f(newPeak),desaturation);
}
fn linearToSrgb(c:vec3f)->vec3f{
  let low=c*12.92;
  let high=1.055*pow(max(c,vec3f(0.0)),vec3f(1.0/2.4))-0.055;
  return select(low,high,c>vec3f(0.0031308));
}
@fragment fn fs(i:VO)->@location(0)vec4f{
  let px=1.0/vec2f(textureDimensions(accTex,0));
  let c4=sampleAccum(i.uv);
  let center=c4.rgb;
  let east=sampleAccum(i.uv+vec2f(px.x,0.0)).rgb;
  let west=sampleAccum(i.uv-vec2f(px.x,0.0)).rgb;
  let north=sampleAccum(i.uv+vec2f(0.0,px.y)).rgb;
  let south=sampleAccum(i.uv-vec2f(0.0,px.y)).rgb;
  let northeast=sampleAccum(i.uv+px*1.75).rgb;
  let northwest=sampleAccum(i.uv+vec2f(-px.x,px.y)*1.75).rgb;
  let southeast=sampleAccum(i.uv+vec2f(px.x,-px.y)*1.75).rgb;
  let southwest=sampleAccum(i.uv-px*1.75).rgb;
  let w0=0.34;
  let we=edgeWeight(center,east,0.10);
  let ww=edgeWeight(center,west,0.10);
  let wn=edgeWeight(center,north,0.10);
  let ws=edgeWeight(center,south,0.10);
  let wne=edgeWeight(center,northeast,0.065);
  let wnw=edgeWeight(center,northwest,0.065);
  let wse=edgeWeight(center,southeast,0.065);
  let wsw=edgeWeight(center,southwest,0.065);
  let weightSum=w0+we+ww+wn+ws+wne+wnw+wse+wsw;
  let filtered=(center*w0+east*we+west*ww+north*wn+south*ws+northeast*wne+northwest*wnw+southeast*wse+southwest*wsw)/max(weightSum,1e-4);
  let historyTrust=smoothstep(2.0,24.0,c4.a);
  let resolved=mix(filtered,center,0.68+historyTrust*0.27);
  var bloom=bloomPrefilter(center)*0.30;
  bloom+=(bloomPrefilter(east)+bloomPrefilter(west)+bloomPrefilter(north)+bloomPrefilter(south))*0.095;
  bloom+=(bloomPrefilter(northeast)+bloomPrefilter(northwest)+bloomPrefilter(southeast)+bloomPrefilter(southwest))*0.055;
  let centered=i.uv*2.0-1.0;
  let vignette=1.0-smoothstep(0.68,1.48,length(centered))*0.28;
  let linearColor=(resolved+bloom*0.22)*1.85*vignette;
  let mapped=(linearColor*(2.51*linearColor+0.03))/(linearColor*(2.43*linearColor+0.59)+0.14);
  let encoded=linearToSrgb(clamp(mapped,vec3f(0.0),vec3f(1.0)));
  return vec4f(encoded,1.0);
}
`;

export class CoherentWaveOpticsPass {
  constructor(device, options = {}) {
    this.device = device;
    this.vgpu = initVGPU(device);
    this.width = Math.max(1, options.width || 1);
    this.height = Math.max(1, options.height || 1);
    this.format = options.format || 'bgra8unorm';
    this.uniformBuffer = null;
    this.sampler = null;
    this.accumPipeline = null;
    this.displayPipeline = null;
    this.accumTextures = [null, null];
    this.accumBindGroups = [null, null];
    this.displayBindGroups = [null, null];
    this.accumBGL = null;
    this.displayBGL = null;
    this.ping = 0;
    this.frameIndex = 0;
    this.initialized = false;
    this._uniformData = new Float32Array(20);
  }

  init(width = this.width, height = this.height, format = this.format) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.format = format;
    this.uniformBuffer = this.device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    const accumModule = this.device.createShaderModule({ label: 'CoherentWaveOpticsPass.accum', code: COHERENT_WAVE_ACCUM_WGSL });
    const displayModule = this.device.createShaderModule({ label: 'CoherentWaveOpticsPass.display', code: COHERENT_WAVE_DISPLAY_WGSL });
    this.accumBGL = this.device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    ] });
    this.displayBGL = this.device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    ] });
    this.accumPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.accumBGL] }),
      vertex: { module: accumModule, entryPoint: 'vs' },
      fragment: { module: accumModule, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
      primitive: { topology: 'triangle-list' },
    });
    this.displayPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.displayBGL] }),
      vertex: { module: displayModule, entryPoint: 'vs' },
      fragment: { module: displayModule, entryPoint: 'fs', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });
    this._rebuildTextures();
    this.initialized = true;
  }

  _createAccumTexture(label) {
    return this.device.createTexture({
      label,
      size: [this.width, this.height],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
  }

  _rebuildTextures() {
    this.accumTextures[0]?.destroy();
    this.accumTextures[1]?.destroy();
    this.accumTextures[0] = this._createAccumTexture('CoherentWaveOpticsPass.accum0');
    this.accumTextures[1] = this._createAccumTexture('CoherentWaveOpticsPass.accum1');
    this.accumBindGroups[0] = this.device.createBindGroup({ layout: this.accumBGL, entries: [
      { binding: 0, resource: { buffer: this.uniformBuffer } },
      { binding: 1, resource: this.accumTextures[0].createView() },
      { binding: 2, resource: this.sampler },
    ] });
    this.accumBindGroups[1] = this.device.createBindGroup({ layout: this.accumBGL, entries: [
      { binding: 0, resource: { buffer: this.uniformBuffer } },
      { binding: 1, resource: this.accumTextures[1].createView() },
      { binding: 2, resource: this.sampler },
    ] });
    this.displayBindGroups[0] = this.device.createBindGroup({ layout: this.displayBGL, entries: [
      { binding: 0, resource: this.accumTextures[0].createView() },
      { binding: 1, resource: this.sampler },
    ] });
    this.displayBindGroups[1] = this.device.createBindGroup({ layout: this.displayBGL, entries: [
      { binding: 0, resource: this.accumTextures[1].createView() },
      { binding: 1, resource: this.sampler },
    ] });
    this.ping = 0;
    this.frameIndex = 0;
  }

  resize(width, height, format = this.format) {
    const nextWidth = Math.max(1, width);
    const nextHeight = Math.max(1, height);
    const formatChanged = format !== this.format;
    const sizeChanged = nextWidth !== this.width || nextHeight !== this.height;
    if (!formatChanged && !sizeChanged) return;
    this.width = nextWidth;
    this.height = nextHeight;
    this.format = format;
    if (formatChanged && this.initialized) {
      const displayModule = this.device.createShaderModule({ label: 'CoherentWaveOpticsPass.display', code: COHERENT_WAVE_DISPLAY_WGSL });
      this.displayPipeline = this.device.createRenderPipeline({
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.displayBGL] }),
        vertex: { module: displayModule, entryPoint: 'vs' },
        fragment: { module: displayModule, entryPoint: 'fs', targets: [{ format: this.format }] },
        primitive: { topology: 'triangle-list' },
      });
    }
    if (this.initialized) this._rebuildTextures();
  }

  render(commandEncoder, targetView, options = {}) {
    if (!this.initialized) this.init(options.width || this.width, options.height || this.height, options.format || this.format);
    this.resize(options.width || this.width, options.height || this.height, options.format || this.format);
    if (options.reset) this.frameIndex = 0;
    const d = this._uniformData;
    d[0] = options.time || 0;
    d[1] = (options.width || this.width) / Math.max(1, options.height || this.height);
    d[2] = options.yaw || 0;
    d[3] = options.pitch || 0;
    new Uint32Array(d.buffer)[4] = this.frameIndex >>> 0;
    d[5] = options.reset ? 1 : 0;
    d[6] = options.mode || 0;
    d[7] = options.wavelength || 532;
    d[8] = options.slitSeparation || 1;
    const cameraPosition = options.cameraPosition || [0, 0.36, -4.9];
    d[9] = cameraPosition[0] || 0;
    d[10] = cameraPosition[1] || 0;
    d[11] = cameraPosition[2] || 0;
    d[12] = options.screenDistance || 3.7;
    d[13] = options.slitWidth || 0.00009;
    d[14] = options.slitHeight || 0.0016;
    d[15] = options.fov || Math.PI / 3;
    d[16] = options.debugViz ? 1 : 0;
    d[17] = (options.fieldViz ?? options.debugViz) ? 1 : 0;
    d[18] = Math.max(0, Math.min(1, Number.isFinite(options.coherence) ? options.coherence : 1));
    d[19] = options.moving ? 1 : 0;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, d);
    const readIdx = this.ping;
    const writeIdx = 1 - readIdx;
    const accumPass = commandEncoder.beginRenderPass({
      colorAttachments: [{ view: this.accumTextures[writeIdx].createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
    });
    accumPass.setPipeline(this.accumPipeline);
    accumPass.setBindGroup(0, this.accumBindGroups[readIdx]);
    accumPass.draw(3);
    accumPass.end();
    const displayPass = commandEncoder.beginRenderPass({
      colorAttachments: [{ view: targetView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0.008, g: 0.01, b: 0.018, a: 1 } }],
    });
    displayPass.setPipeline(this.displayPipeline);
    displayPass.setBindGroup(0, this.displayBindGroups[writeIdx]);
    displayPass.draw(3);
    displayPass.end();
    this.ping = writeIdx;
    this.frameIndex += 1;
    return Math.min(this.frameIndex, 256);
  }

  destroy() {
    this.uniformBuffer?.destroy();
    this.accumTextures[0]?.destroy();
    this.accumTextures[1]?.destroy();
    this.uniformBuffer = null;
    this.sampler = null;
    this.accumPipeline = null;
    this.displayPipeline = null;
    this.accumTextures = [null, null];
    this.accumBindGroups = [null, null];
    this.displayBindGroups = [null, null];
    this.initialized = false;
  }
}

export function createCoherentWaveOpticsPass(device, options) {
  return new CoherentWaveOpticsPass(device, options);
}
