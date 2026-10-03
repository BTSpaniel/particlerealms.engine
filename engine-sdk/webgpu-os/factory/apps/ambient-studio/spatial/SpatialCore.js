// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Browser ESM conversion of the supplied Ambient Studio depth reconstruction source.
 * Numeric algorithms and data contracts retain their original implementation. */
/**
 * Spatial scene contract and renderer-independent 3D dynamics.
 * Original implementation. RGB-D lifting is not trained 4D reconstruction.
 * Coordinates: +X right, +Y up, +Z away from the reference camera.
 * A persistent index is a particle identity; its canonical anchor is never
 * replaced by a simulated position. Sequence motion and artistic offsets are separate.
 */
import { connectedDepth,boundedDifferential,projectStrain,strainSummary } from "./SpatialSafety.js";
import { projectCage } from "./SpatialCage.js";
import * as NP from "./NeuralPlate.js";
import * as DEPTH from "./DepthEngine.js";
import { createSpatialResponse, normalizeSpatialResponse, normalizeSpatialCameraResponse, normalizeSpatialAudioEnvelope, sampleSpatialGestures, LEGACY_SPATIAL_RESPONSE } from './SpatialResponse.js';
import { normalizeSpatialCameraRig, normalizeSpatialCloudFrame, spatialCameraRigFor } from './SpatialCameraRig.js';
import { normalizeSpatialRenderingOptions } from './SpatialRenderingOptions.js';
import { normalizeSpatialObjectEdits, decodeGroups } from './SpatialObjectEdits.js';
const SPATIAL_VERSION = 1;
const SPATIAL_MODES = Object.freeze({
  flow:'Liquid volume', shatter:'Shatter & rebuild', echo:'Temporal stream',
  fabric:'Elastic structure', ripple:'Surface ripples', orbit:'Orbital gather'
});
const SPATIAL_PARAMS = Object.freeze({
  idleDrift:{label:'Slow surface drift · scene units',min:0,max:.16,step:.002,default:0},
  framingX:{label:'Composition · horizontal',min:-.5,max:.5,step:.005,default:0},
  framingY:{label:'Composition · vertical',min:-.5,max:.5,step:.005,default:0},
  coverMargin:{label:'Cover motion margin · source fraction',min:0,max:.3,step:.005,default:0},
  lightAzimuth:{label:'Key light · horizontal angle',min:-180,max:180,step:1,default:-147},
  lightElevation:{label:'Key light · elevation',min:-80,max:80,step:1,default:40},
  responseAmount:{label:'Response amount',min:0,max:1,step:.01,default:.5},
  depthMinConfidence:{label:'Minimum supported depth',min:0,max:.95,step:.01,default:0},
  depthAntialias:{label:'Gaussian antialiasing',min:0,max:1,step:.01,default:1},
  cageSpacing:{label:'Cage sample spacing',min:2,max:24,step:1,default:8},
  cageCompliance:{label:'Cage compliance · softer →',min:0,max:.003,step:.00001,default:.00002},
  cageStrength:{label:'Bind particles to cage',min:0,max:1,step:.01,default:1},
  completionDepth:{label:'Background-plane distance',min:3,max:16,step:.1,default:6},
  maxStretch:{label:'Maximum local stretch',min:1.05,max:3,step:.01,default:1.45},
  depthSlope:{label:'Depth-edge slope tolerance',min:.25,max:12,step:.05,default:2.5},
  strainIterations:{label:'Structure solver passes',min:1,max:12,step:1,default:5},
  footprintLimit:{label:'Maximum splat radius · screen fraction',min:.01,max:.2,step:.005,default:.06},
  backingOpacity:{label:'Coverage backing opacity',min:0,max:1,step:.01,default:1},
  count:{label:'Gaussian budget',min:1024,max:160000,step:1024,default:49152},
  depth:{label:'Depth range · scene units',min:.05,max:3.5,step:.01,default:1.7},
  near:{label:'Near surface distance',min:1,max:8,step:.05,default:2.6},
  fov:{label:'Source field of view',min:5,max:150,step:1,default:45},
  size:{label:'Gaussian coverage',min:.45,max:2.8,step:.01,default:1.6},
  thickness:{label:'Normal-axis thickness',min:.05,max:1,step:.01,default:.26},
  opacity:{label:'Pigment opacity',min:.15,max:1,step:.01,default:.97},
  spring:{label:'Identity / source attachment',min:.4,max:28,step:.1,default:10},
  cohesion:{label:'Neighborhood structure',min:0,max:1,step:.01,default:.76},
  edge:{label:'Separate depth boundaries',min:.02,max:.6,step:.01,default:.16},
  damping:{label:'Drag / energy loss',min:.5,max:12,step:.1,default:4},
  force:{label:'3D interaction force',min:0,max:3,step:.01,default:1},
  radius:{label:'Brush radius',min:.025,max:.5,step:.005,default:.16},
  maxDisplacement:{label:'Identity envelope',min:.02,max:2.5,step:.01,default:.7},
  turbulence:{label:'Idle 3D currents',min:0,max:1,step:.01,default:.08},
  lifetime:{label:'Texture lifetime · seconds',min:.4,max:10,step:.1,default:3.6},
  echoes:{label:'Old-frame mixture',min:0,max:1,step:.01,default:.55},
  shutter:{label:'3D velocity shutter',min:0,max:.3,step:.002,default:.025},
  lighting:{label:'Surface relief lighting',min:0,max:1,step:.01,default:.32},
  haze:{label:'Depth atmosphere',min:0,max:.8,step:.01,default:.08},
  paletteMix:{label:'Palette tint · source preserved at zero',min:0,max:1,step:.01,default:0},
  exposure:{label:'Pigment exposure',min:-2,max:2,step:.01,default:0},
  box:{label:'Physical frame depth',min:0,max:1,step:.01,default:.35},
  yaw:{label:'Camera orbit · horizontal',min:-180,max:180,step:.1,default:0},
  pitch:{label:'Camera orbit · vertical',min:-85,max:85,step:.1,default:0},
  zoom:{label:'Camera dolly',min:.45,max:2.2,step:.01,default:1},
  sourceRate:{label:'Source playback rate',min:.1,max:3,step:.05,default:1},
  sourceScrub:{label:'Source time · normalized',min:0,max:1,step:.001,default:0}
});
const SPATIAL_WORLDS = [
 ['spatial-vista','Gaussian sanctuary','ripple','A dimensional pigment landscape. Orbit the actual depth field; disturb the surface without moving the camera.'],
 ['spatial-flow','Volumetric emulsion','flow','Source-textured Gaussians travel through a 3D current, anchored to the original structure.'],
 ['spatial-shatter','Spatial fragments','shatter','Ray-picked fragments scatter in three dimensions, then restore their canonical positions.'],
 ['spatial-echo','Spatial temporal ribbons','echo','Persistent 3D anchors with pinned video-frame cohorts and velocity-shaped covariance.'],
 ['spatial-fabric','Spatial photo fabric','fabric','Grab a surface in world space. Depth-aware neighborhood constraints keep nearby structure together.'],
 ['spatial-cloud','Gaussian scene explorer','orbit','Import real Gaussian PLY / SPLAT assets or inspect the included procedural 3D scene.']
].map(([id,name,mode,description])=>({id,name,spatialMode:mode,backend:'spatial',category:'Spatial scenes',tag:'3D GAUSSIANS · DEPTH & IDENTITY',description,palette:['#122b35','#3e9398','#e3b85b','#fff1c4'],params:{daylight:.5,weather:.3,warmth:.4,motion:.55,depth:0,grain:0,vignette:0},layers:[['source','Spatial Gaussian scene',0]]}));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=(n,label)=>{if(typeof n!=='number'||!Number.isFinite(n))throw new TypeError(label+' must be finite.');return n;};
// Optional additions must remain absent in older serialized plans: their hashes
// and the previous renderer constants are part of the saved wallpaper contract.
const SPATIAL_ART_FIELDS = Object.freeze(['idleDrift','framingX','framingY','coverMargin','lightAzimuth','lightElevation','paletteShadow','paletteMid','paletteLight','paletteHighlight','hazeColor']);
function spatialDefaults(mode='ripple') {
  return {version:1,stabilityVersion:1,surfaceSafety:true,backing:'soft',mode:SPATIAL_MODES[mode]?mode:'ripple',
    ...Object.fromEntries(Object.entries(SPATIAL_PARAMS).map(([k,d])=>[k,d.default])),
    source:'example',mediaAsset:null,depthAsset:null,maskAsset:null,responseSource:'off',
    paletteShadow:'#122b35',paletteMid:'#3e9398',paletteLight:'#e3b85b',paletteHighlight:'#fff1c4',hazeColor:'#1c3b47',
    cageEnabled:false,isolateMask:false,learnedPlate:null,completionMask:null,completionModel:null,completionProjection:'plane',depthField:null,depthEdgeSampling:true,depthCamera:false,
    depthConvention:'near-white',texture:'live',shape:'gaussian',view:'color',fit:'contain',
    sourcePlayback:'timeline',lockCamera:true,frame:true,frameColor:'#ced4c9',cloud:null,sequence:null,
    ...(mode==='echo'?{texture:'echo',shutter:.085,cohesion:.48}:{}),
    ...(mode==='shatter'?{cohesion:.22,spring:4,damping:2.6,force:1.2}:{}),
    ...(mode==='fabric'?{cohesion:.95,spring:13,force:.9}:{}),
    ...(mode==='orbit'?{source:'diorama',lockCamera:false,count:42000,zoom:.92,frame:false}: {})};
}
function normalizeSpatial(raw,mode='ripple') {
  const s=spatialDefaults(mode);if(raw==null)return s;
  // Previously saved projects retain their exact old renderer until explicitly repaired.
  if(raw.stabilityVersion===undefined){s.stabilityVersion=0;s.surfaceSafety=false;s.backing='none';}
  else if(raw.stabilityVersion!==0&&raw.stabilityVersion!==1)throw new TypeError('Unsupported surface stability version.');else s.stabilityVersion=raw.stabilityVersion;
  if(typeof raw!=='object'||Array.isArray(raw)||raw.version!==1)throw new TypeError('Unsupported spatial scene settings.');
  // These optional fields are graph-owned. Absent fields retain legacy bytes
  // and the original dynamics; new source nodes explicitly select version 1.
  if(raw.responseVersion!==undefined){if(raw.responseVersion!==1)throw new TypeError('Unsupported spatial response version');s.responseVersion=1;}
  if(raw.response!==undefined)s.response=normalizeSpatialResponse(raw.response);
  if(raw.cameraResponse!==undefined)s.cameraResponse=normalizeSpatialCameraResponse(raw.cameraResponse);
  if(raw.audioEnvelope!==undefined)s.audioEnvelope=normalizeSpatialAudioEnvelope(raw.audioEnvelope);
  if(raw.cameraRig!==undefined)s.cameraRig=normalizeSpatialCameraRig(raw.cameraRig);
  if(raw.cloudFrame!==undefined)s.cloudFrame=normalizeSpatialCloudFrame(raw.cloudFrame);
  if(raw.objectEdits!==undefined)s.objectEdits=normalizeSpatialObjectEdits(raw.objectEdits);
  if(raw.sourceClip!=null)s.sourceClip=normalizeSpatialSourceClip(raw.sourceClip);
  Object.assign(s,normalizeSpatialRenderingOptions(raw));
  for(const[k,d]of Object.entries(SPATIAL_PARAMS))if(raw[k]!==undefined)s[k]=clamp(finite(raw[k],k),d.min,d.max);
  for(const key of SPATIAL_ART_FIELDS)if(!Object.hasOwn(raw,key))delete s[key];
  s.count=Math.round(s.count);
  if(raw.depthAntialias===undefined)s.depthAntialias=0;
  if(raw.depthField!=null)s.depthField=DEPTH.validate(raw.depthField);
  for(const[k,choices]of Object.entries({responseSource:['off','os','audio'],backing:['none','soft','source','learned'],completionProjection:['screen','plane'],mode:Object.keys(SPATIAL_MODES),source:['example','media','diorama','cloud'],depthConvention:['near-white','far-white'],texture:['live','birth','echo'],shape:['gaussian','grain','streak'],view:['color','depth','normals','identity','coverage','confidence'],fit:['contain','cover'],sourcePlayback:['timeline','pingpong','scrub']})) {
    if(raw[k]!==undefined){if(!choices.includes(raw[k]))throw new TypeError('Unsupported spatial '+k);s[k]=raw[k];}
  }
  for(const k of ['lockCamera','frame','surfaceSafety','cageEnabled','isolateMask','depthEdgeSampling','depthCamera'])if(raw[k]!==undefined){if(typeof raw[k]!=='boolean')throw new TypeError(k+' must be boolean.');s[k]=raw[k];}
  if(raw.frameColor!==undefined){if(!/^#[0-9a-f]{6}$/i.test(raw.frameColor))throw new TypeError('Invalid frame color');s.frameColor=raw.frameColor;}
  for(const key of ['paletteShadow','paletteMid','paletteLight','paletteHighlight','hazeColor'])if(raw[key]!==undefined){if(!/^#[0-9a-f]{6}$/i.test(raw[key]))throw new TypeError('Invalid spatial '+key);s[key]=raw[key].toLowerCase();}
  for(const k of ['mediaAsset','depthAsset','maskAsset','learnedPlate','completionMask'])if(raw[k]!=null){if(typeof raw[k]!=='string'||!/^asset-[\w-]{1,80}$/.test(raw[k]))throw new TypeError('Invalid spatial asset');s[k]=raw[k];}
  if(raw.completionModel!=null){const m=NP.deserialize(raw.completionModel);const md=raw.completionModel.metadata??{};s.completionModel=NP.serialize(m,{task:'per-image masked RGB completion',sourceFingerprint:String(md.sourceFingerprint??'').slice(0,64),width:Number(md.width)||0,height:Number(md.height)||0,observedTrainingPixels:Number(md.observedTrainingPixels)||0,observedValidationPixels:Number(md.observedValidationPixels)||0,excludedPixels:Number(md.excludedPixels)||0,attemptedSteps:Math.min(100000,Number(md.attemptedSteps)||0),bestStep:m.steps,validation:'Holdout of observed support, not hidden-region ground truth.',history:Array.isArray(md.history)?md.history.slice(0,300).map(h=>({step:Math.max(0,Math.min(100000,Number(h.step)||0)),trainingMSE:Math.max(0,Math.min(100,Number(h.trainingMSE)||0)),validationMSE:Math.max(0,Math.min(100,Number(h.validationMSE)||0))})):[]});}
  if(s.backing==='learned'&&!s.learnedPlate)throw new TypeError('A learned backing requires a baked plate asset.');
  if(raw.cloud!=null)s.cloud=validateCloud(raw.cloud);
  // Native projects may keep their cloud in a content-addressed asset. Its
  // resolved count is checked again by SpatialAmbientAssets before playback.
  if(raw.sequence!=null)s.sequence=validateSequence(raw.sequence,s.cloud?.count??raw.sequence.count);
  if(s.source==='cloud'&&!s.cloud)throw new TypeError('The spatial scene has no Gaussian asset.');
  if(s.source==='media'&&!s.mediaAsset)throw new TypeError('The spatial source image/video is missing.');
  return s;
}
/** Explicit authored opt-in; never silently retints or deforms a historical scan. */
function createFaithfulSpatialSettings(settings=spatialDefaults('orbit'),{sourceKind='captured'}={}) {
  if(!['captured','procedural','image-relief','panorama'].includes(sourceKind))throw new TypeError('Unsupported faithful source kind');
  return normalizeSpatial({...settings,renderVersion:1,renderProfile:'faithful',lighting:0,haze:0,paletteMix:0,exposure:0,opacity:1,size:1,
    ...(sourceKind==='procedural'?{}:{fogDensity:0,fogHeight:0,skyMode:'none'}),
    idleDrift:0,turbulence:0,force:0,shutter:0,echoes:0,texture:'live',backing:'none',frame:false,
    responseVersion:1,response:createSpatialResponse(settings.mode??'orbit',{neutral:true})},settings.mode??'orbit');
}
function encodeFloats(a) {
  const bytes=new Uint8Array(a.buffer,a.byteOffset,a.byteLength);let out='';
  for(let i=0;i<bytes.length;i+=32768)out+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return btoa(out);
}
function decodeFloats(text,expected,maxBytes=64*1024*1024) {
  if(typeof text!=='string'||text.length>maxBytes*4/3+8||!(/^[A-Za-z0-9+/]*={0,2}$/).test(text))throw new TypeError('Invalid or oversized float buffer.');
  const str=atob(text);if(str.length!==expected*4)throw new TypeError('Float buffer length does not match the declared count.');
  const bytes=new Uint8Array(str.length);for(let i=0;i<str.length;i++)bytes[i]=str.charCodeAt(i);
  const values=new Float32Array(bytes.buffer);for(const v of values)if(!Number.isFinite(v))throw new TypeError('Non-finite Gaussian data.');return values;
}
/** Double-precision translation of a local Float32 payload into source world space. */
function normalizeSpatialOrigin(value) {
  if(!Array.isArray(value)||value.length!==3)throw new TypeError('Spatial origin needs three finite coordinates.');
  return Array.from(value,x=>finite(x,'Spatial origin'));
}
/** Optional source-owned trim; null end follows the decoded source duration. */
function normalizeSpatialSourceClip(value) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['startSeconds','endSeconds'].includes(key)))throw new TypeError('Source clip needs startSeconds and endSeconds.');
  const startSeconds=finite(value.startSeconds,'Source clip start'),endSeconds=value.endSeconds;
  if(startSeconds<0||endSeconds!==null&&(typeof endSeconds!=='number'||!Number.isFinite(endSeconds)||endSeconds<=startSeconds))throw new TypeError('Source clip end must follow its nonnegative start, or be null for the full source.');
  return {startSeconds,endSeconds};
}
/** Canonical splat layout: xyz, linear-positive scales, quaternion wxyz,
 * display-space rgb, linear opacity. With an origin, xyz is already local to it;
 * subtract world coordinates before calling this packer, never after Float32 conversion. */
function packCloud(data,metadata={},options={}) {
  if(!(data instanceof Float32Array))data=Float32Array.from(data);
  if(data.length%14)throw new TypeError('Gaussian layout must have 14 floats per point.');
  return validateCloud({format:'ambient.gaussians',version:1,count:data.length/14,data:encodeFloats(data),metadata,...(options.origin!==undefined?{origin:options.origin}:{})});
}
function validateCloud(v) {
  if(!v||v.format!=='ambient.gaussians'||v.version!==1||!Number.isSafeInteger(v.count)||v.count<1||v.count>200000)throw new TypeError('Gaussian asset supports 1–200,000 splats.');
  if(typeof v.data!=='string'||v.data.length!==Math.ceil(v.count*14*4/3)*4)throw new TypeError('Gaussian buffer length mismatch.');
  const m=v.metadata??{},metadata={name:String(m.name??'Gaussian asset').slice(0,160),provenance:String(m.provenance??'imported').slice(0,1000),warnings:Array.isArray(m.warnings)?m.warnings.slice(0,12).map(x=>String(x).slice(0,300)):[],coordinateSystem:'right-up-forward'};
  if(v.groups!==undefined&&(typeof v.groups!=='string'||v.groups.length!==Math.ceil(v.count*4/3)*4))throw new TypeError('Object groups must match Gaussian count.');
  if(v.confidence!=null){const q=DEPTH.decodeFloats(v.confidence,v.count);if(q.some(v=>v<0||v>1))throw new TypeError('Gaussian confidence must be in [0,1]');}
  let sh=null;if(v.sphericalHarmonics!=null){const h=v.sphericalHarmonics;if(!Number.isInteger(h.degree)||h.degree<0||h.degree>3||typeof h.data!=='string'||h.data.length!==Math.ceil(v.count*(h.degree+1)**2*3*4/3)*4)throw new TypeError('Invalid SH degree or coefficient layout.');sh={degree:h.degree,data:h.data};}
  return {format:v.format,version:1,count:v.count,data:v.data,metadata,...(v.groups?{groups:v.groups}:{}),...(sh?{sphericalHarmonics:sh}:{}),...(v.confidence?{confidence:v.confidence}:{}),...(v.origin!==undefined?{origin:normalizeSpatialOrigin(v.origin)}:{})};
}
function unpackCloud(v) {
  v=validateCloud(v);const a=decodeFloats(v.data,v.count*14);
  for(let i=0;i<v.count;i++){const k=i*14;
    for(let j=0;j<3;j++)if(Math.abs(a[k+j])>1e7||a[k+3+j]<=0||a[k+3+j]>1e5)throw new TypeError('Gaussian scale/position outside supported limits.');
    const q=Math.hypot(...a.subarray(k+6,k+10));if(q<1e-8)throw new TypeError('Zero Gaussian quaternion.');for(let j=6;j<10;j++)a[k+j]/=q;
    for(let j=10;j<14;j++)a[k+j]=clamp(a[k+j],0,1);
  }return a;
}
function validateSequence(v,count) {
  if(!v||v.format!=='ambient.gaussian-motion'||v.version!==1||v.count!==count||!Array.isArray(v.frames)||v.frames.length<2||v.frames.length>120)throw new TypeError('Motion needs 2–120 ID-aligned frames matching its cloud.');
  let last=-Infinity,bytes=0;const fields={positions:3,rotations:4,scales:3,colors:3,opacities:1};if(v.shDegree!==undefined){if(!Number.isInteger(v.shDegree)||v.shDegree<0||v.shDegree>3)throw new TypeError('Invalid motion SH degree.');fields.sh=(v.shDegree+1)**2*3;}
  if(v.frames.some(f=>f.sh)&&v.shDegree===undefined)throw new TypeError('Motion SH samples need an explicit degree.');
  const frames=v.frames.map(f=>{finite(f.time,'Frame timestamp');if(f.time<0||f.time<=last)throw new TypeError('Motion timestamps must be strictly increasing.');last=f.time;const out={time:f.time};
    for(const[key,channels]of Object.entries(fields)){if(key==='positions'||f[key]!=null){if(typeof f[key]!=='string'||f[key].length!==Math.ceil(count*channels*4/3)*4)throw new TypeError('Motion '+key+' must retain every canonical particle ID.');out[key]=f[key];bytes+=f[key].length;}}return out;});
  for(const key of Object.keys(fields))if(frames.some(f=>f[key])&&!frames.every(f=>f[key]))throw new TypeError(key+' samples must be supplied for every motion frame.');
  if(bytes>64*1024*1024)throw new TypeError('Motion data exceeds 64 MiB.');
  // An absent origin retains the original absolute-world position convention.
  return{format:v.format,version:1,count,loop:v.loop===true,frames,...(v.shDegree!==undefined?{shDegree:v.shDegree}:{}),provenance:String(v.provenance??'Prepared motion; stable IDs asserted by producer.').slice(0,1000),...(v.origin!==undefined?{origin:normalizeSpatialOrigin(v.origin)}:{})};
}
function quatCovariance(sx,sy,sz,qw,qx,qy,qz) {
  const r=[1-2*(qy*qy+qz*qz),2*(qx*qy-qw*qz),2*(qx*qz+qw*qy),2*(qx*qy+qw*qz),1-2*(qx*qx+qz*qz),2*(qy*qz-qw*qx),2*(qx*qz-qw*qy),2*(qy*qz+qw*qx),1-2*(qx*qx+qy*qy)];
  const s=[sx*sx,sy*sy,sz*sz],c=(i,j)=>r[i*3]*r[j*3]*s[0]+r[i*3+1]*r[j*3+1]*s[1]+r[i*3+2]*r[j*3+2]*s[2];
  return[c(0,0),c(0,1),c(0,2),c(1,1),c(1,2),c(2,2)];
}
/** Finite capture playback is explicit: hold, manual inspection, or ping-pong.
 * Ping-pong is a user-selected playback effect, not a claim of seamless capture. */
function sequenceSourceTime(settings,time){
 const f=settings.sequence?.frames;if(!f?.length)return time;
 const start=f[0].time,end=f.at(-1).time,span=end-start,rate=settings.sourceRate??1;
 if(settings.sourcePlayback==='scrub')return start+span*(settings.sourceScrub??0);
 if(settings.sourcePlayback==='pingpong'&&span>0){const t=((Math.max(0,time)*rate)%(2*span));return start+(t<=span?t:2*span-t);}
 return start+Math.max(0,time)*rate;
}
function gaussianSurfaceNormal(scales,q){
 const [w,x,y,z]=q;let a=0;if(scales[1]<scales[a])a=1;if(scales[2]<scales[a])a=2;
 const cols=[[1-2*(y*y+z*z),2*(x*y+w*z),2*(x*z-w*y)],[2*(x*y-w*z),1-2*(x*x+z*z),2*(y*z+w*x)],[2*(x*z+w*y),2*(y*z-w*x),1-2*(x*x+y*y)]];
 const n=normalize3(cols[a]);return n[2]>0?n.map(v=>-v):n;
}
function normalize3(a) {const n=Math.hypot(...a)||1;return a.map(x=>x/n);}
function cross3(a,b){return[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
function dot3(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
function cameraFor(settings,aspect,sourceAspect=aspect,center=[0,0,3.4],baseDistance=null,reference=null,coverBounds=null) {
  if(settings.cameraRig)return spatialCameraRigFor(settings,aspect,sourceAspect);
  const response=settings.cameraResponse,limits=settings.lockCamera?response?.lockedYawLimit??18:response?.yawLimit??180,pitchLimit=settings.lockCamera?response?.lockedPitchLimit??12:response?.pitchLimit??85;
  const yaw=clamp(settings.yaw,-limits,limits)*Math.PI/180,pitch=clamp(settings.pitch,-pitchLimit,pitchLimit)*Math.PI/180;
  const distance=(baseDistance??center[2])/settings.zoom;
  const eye=[center[0]+Math.sin(yaw)*Math.cos(pitch)*distance,center[1]+Math.sin(pitch)*distance,center[2]-Math.cos(yaw)*Math.cos(pitch)*distance];
  const forward=normalize3(center.map((x,i)=>x-eye[i])),right=normalize3(cross3([0,1,0],forward)),up=cross3(forward,right);
  let fy=1/(2*Math.tan(settings.fov*Math.PI/360));const fit=settings.fit==='contain'?Math.min(1,aspect/sourceAspect):Math.max(1,aspect/sourceAspect);fy*=fit;
  const cx=(reference?.cx!==undefined?.5+(reference.cx-.5)*fit*sourceAspect/aspect:.5)+(settings.framingX??0),cy=(reference?.cy!==undefined?.5+(reference.cy-.5)*fit:.5)+(settings.framingY??0);
  const camera={eye,right,up,forward,fx:fy/aspect*(reference?.ratio??1),fy,cx,cy,center,distance,aspect,yaw,pitch};
  if(settings.fit==='cover'&&coverBounds&&(settings.framingX!==undefined||settings.framingY!==undefined)) {
    // A translated/tilted cover plane needs more margin than aspect-fit alone.
    // Find the focal scale that contains all four viewport corners inside each
    // extreme depth plane. Intermediate source depths stay within these bounds.
    const sourceFy=1/(2*Math.tan(settings.fov*Math.PI/360)),sourceFx=sourceFy/sourceAspect;
    const corners=[[0-cx,0-cy],[1-cx,0-cy],[1-cx,1-cy],[0-cx,1-cy]];
    let scale=1;
    for(const z of [coverBounds.near,coverBounds.far]) {
      const quad=[[0,0],[1,0],[1,1],[0,1]].map(([u,v])=>{const p=projectPoint(unprojectPixel(u,v,z,sourceFx,sourceFy),camera);return[p[0]-cx,p[1]-cy];});
      for(let i=0;i<4;i++) {
        const a=quad[i],b=quad[(i+1)%4],area=a[0]*b[1]-a[1]*b[0],dx=b[0]-a[0],dy=b[1]-a[1];
        if(area>1e-9)for(const p of corners)scale=Math.max(scale,-(dx*p[1]-dy*p[0])/area);
      }
    }
    const margin=Math.min(8,scale*1.008);camera.fx*=margin;camera.fy*=margin;
  }
  // Reserve source pixels beyond the canvas for authored surface motion. This
  // optical crop follows cover fitting (dolly zoom can be canceled by that
  // solver); it changes neither ribbon forces nor canonical Gaussian geometry.
  // Older cameras omit the field and retain the exact previous projection.
  if(settings.fit==='cover'&&settings.coverMargin>0){const reserve=1/(1-2*settings.coverMargin);camera.fx*=reserve;camera.fy*=reserve;}
  return camera;
}
function projectPoint(p,camera) {const d=p.map((v,i)=>v-camera.eye[i]),z=dot3(d,camera.forward);return[(camera.cx??.5)+camera.fx*dot3(d,camera.right)/z,(camera.cy??.5)-camera.fy*dot3(d,camera.up)/z,z];}
function unprojectPixel(u,v,z,fx,fy,cx=.5,cy=.5) {return[(u-cx)*z/fx,(cy-v)*z/fy,z];}
function rayFor(u,v,camera) {return{origin:camera.eye,direction:normalize3(camera.forward.map((x,i)=>x+camera.right[i]*(u-(camera.cx??.5))/camera.fx+camera.up[i]*((camera.cy??.5)-v)/camera.fy))};}
function planeHit(ray,point,normal) {const denominator=dot3(ray.direction,normal);if(Math.abs(denominator)<1e-7)return null;const t=dot3(point.map((x,i)=>x-ray.origin[i]),normal)/denominator;if(t<=0)return null;return ray.origin.map((x,i)=>x+t*ray.direction[i]);}
function hash01(i){let x=Math.imul(i^61,i|1);x^=x>>>16;x=Math.imul(x,0x27d4eb2d);return((x^(x>>>15))>>>0)/4294967296;}
function depthAt(map,u,v,invert=false) {
  if(!map)return .5;const x=clamp(u*map.width-.5,0,map.width-1),y=clamp(v*map.height-.5,0,map.height-1),ix=Math.floor(x),iy=Math.floor(y),j=iy*map.width+ix;
  if(map.edgeAware){const weights=[(1-x+ix)*(1-y+iy),(x-ix)*(1-y+iy),(1-x+ix)*(y-iy),(x-ix)*(y-iy)],ids=[j,iy*map.width+Math.min(ix+1,map.width-1),Math.min(iy+1,map.height-1)*map.width+ix,Math.min(iy+1,map.height-1)*map.width+Math.min(ix+1,map.width-1)];let nearest=0;for(let k=1;k<4;k++)if(weights[k]>weights[nearest])nearest=k;const reference=map.values[ids[nearest]];let sum=0,total=0;for(let k=0;k<4;k++){const value=map.values[ids[k]],delta=Math.abs(value-reference),w=weights[k]*(delta>(map.edgeThreshold??.08)?.00001:1);sum+=value*w;total+=w;}const v=total>1e-9?sum/total:reference;return invert?1-v:v;}
  const a=map.values[j],b=map.values[iy*map.width+Math.min(ix+1,map.width-1)],c=map.values[Math.min(iy+1,map.height-1)*map.width+ix],d=map.values[Math.min(iy+1,map.height-1)*map.width+Math.min(ix+1,map.width-1)];
  const f=(a*(1-(x-ix))+b*(x-ix))*(1-(y-iy))+(c*(1-(x-ix))+d*(x-ix))*(y-iy);return invert?1-f:f;
}
/** RGB-D lifting: neighboring samples share metric geometry, not a random z offset.
 * Edges across distinct depth surfaces are deliberately omitted. */
function liftDepthField(settings,aspect,depthMap=null,maskMap=null,seed=7314) {
  const cols=Math.max(8,Math.floor(Math.sqrt(settings.count*aspect))),rows=Math.max(8,Math.floor(settings.count/cols)),count=cols*rows;
  const tangentU=new Float32Array(count*3),tangentV=new Float32Array(count*3);
  const anchor=new Float32Array(count*3),covariance=new Float32Array(count*6),uv=new Float32Array(count*2),mobility=new Float32Array(count),colors=new Float32Array(count*4).fill(1),normals=new Float32Array(count*3),edges=[];
  const fy=1/(2*Math.tan(settings.fov*Math.PI/360)),fx=fy/aspect,range=settings.depth;
  for(let i=0;i<count;i++){
    const col=i%cols,row=Math.floor(i/cols),u=(col+.5)/cols,v=(row+.5)/rows;
    const z=settings.near+(1-depthAt(depthMap,u,v,!settings.depthField&&settings.depthConvention==='far-white'))*range;
    anchor.set(unprojectPixel(u,v,z,fx,fy),i*3);uv.set([u,v],i*2);mobility[i]=maskMap?depthAt(maskMap,u,v):1;
    if(depthMap?.confidence){const conf=depthAt({width:depthMap.width,height:depthMap.height,values:depthMap.confidence},u,v);if(conf<=0||conf<(settings.depthMinConfidence??0)){colors[i*4+3]=0;mobility[i]=0;}}

  }
  for(let i=0;i<count;i++){
    const x=i%cols,y=Math.floor(i/cols),k=i*3,z=anchor[k+2];
    const izx=y*cols+Math.min(x+1,cols-1),izy=Math.min(y+1,rows-1)*cols+x;
    const baseX=z/fx/cols,baseY=z/fy/rows;
    // Match the true source-surface differential. Clamping a continuous slope
    // to one pixel creates comb gaps under orbit. Only reject a depth break.
    const u=uv[i*2],v=uv[i*2+1],dx=anchor[izx*3+2]-z,dy=anchor[izy*3+2]-z;
    const dzx=connectedDepth(z,z+dx,baseX,settings)?dx:0,dzy=connectedDepth(z,z+dy,baseY,settings)?dy:0;
    const tx=[baseX+(u-.5)*dzx/fx,(.5-v)*dzx/fy,dzx],ty=[(u-.5)*dzy/fx,-baseY+(.5-v)*dzy/fy,dzy],n=normalize3(cross3(tx,ty));
    normals.set(n,k);
    tangentU.set(tx.map(v=>v*cols),k);tangentV.set(ty.map(v=>v*rows),k);
    const sd=.43,sz=Math.min(baseX,baseY)*settings.thickness*.43;
    const C=(a,b)=>sd*sd*(tx[a]*tx[b]+ty[a]*ty[b])+n[a]*n[b]*sz*sz;
    covariance.set([C(0,0),C(0,1),C(0,2),C(1,1),C(1,2),C(2,2)],i*6);
    for(const j of [x+1<cols?i+1:-1,y+1<rows?i+cols:-1,...(settings.surfaceSafety?[x+1<cols&&y+1<rows?i+cols+1:-1,x>0&&y+1<rows?i+cols-1:-1]:[])])if(j>=0){const dc=Math.abs(j%cols-x),dr=Math.abs(Math.floor(j/cols)-y),step=Math.hypot(dc*baseX,dr*baseY);if(colors[i*4+3]>0&&colors[j*4+3]>0&&connectedDepth(z,anchor[j*3+2],step,settings)&&(!settings.isolateMask||(mobility[i]>.0001)===(mobility[j]>.0001)))edges.push(i,j);}
  }
  return{confidence:depthMap?.confidence?Float32Array.from(uv.filter((_,i)=>i%2===0),(u,i)=>depthAt({width:depthMap.width,height:depthMap.height,values:depthMap.confidence},u,uv[i*2+1])):null,count,anchor,covariance,uv,mobility,colors,normals,tangentU,tangentV,edges:Uint32Array.from(edges),cols,rows,sourceAspect:aspect,center:[0,0,settings.near+range*.5],baseDistance:settings.near+range*.5,source:'depth',provenance:depthMap?'RGB-D lifting; depth provenance is stored in the project':'Flat source plane; no depth estimation performed'};
}
function geometryFromCloud(cloud,budget=160000,referenceField=null,fixedFrame=null,cloudFrame=null) {
  if(cloudFrame&&(!Number.isFinite(budget)||budget<1))throw new TypeError('Metric cloud sampling needs a positive finite budget.');
  const coordinateOrigin=cloud.origin===undefined?null:normalizeSpatialOrigin(cloud.origin);
  const rawConfidence=cloud.confidence?DEPTH.decodeFloats(cloud.confidence,cloud.count):null;const raw=unpackCloud(cloud),rawGroups=decodeGroups(cloud.groups,cloud.count),skip=Math.max(1,Math.ceil(cloud.count/budget)),count=cloudFrame?Math.min(cloud.count,Math.floor(budget)):Math.ceil(cloud.count/skip),anchor=new Float32Array(count*3),covariance=new Float32Array(count*6),colors=new Float32Array(count*4),normals=new Float32Array(count*3),uv=new Float32Array(count*2).fill(-1),mobility=new Float32Array(count).fill(1),sourceIds=new Uint32Array(count),groups=new Uint32Array(count);
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];for(let i=0;i<cloud.count;i++)for(let a=0;a<3;a++){lo[a]=Math.min(lo[a],raw[i*14+a]);hi[a]=Math.max(hi[a],raw[i*14+a]);}
  let origin=lo.map((x,i)=>(x+hi[i])*.5),span=Math.max(...lo.map((x,i)=>hi[i]-x),.001),scale=2.8/span;const center=[0,0,3.4];let translation=center,referenceIntrinsics=null,sourceAspect=16/9;
  if(referenceField?.K){const rf=referenceField,K=rf.K,zs=[];for(let i=0;i<cloud.count;i+=skip){const z=raw[i*14+2]+(coordinateOrigin?.[2]??0);if(z>0)zs.push(z);}zs.sort((a,b)=>a-b);if(!zs.length)throw new TypeError('Reference camera requires positive camera-Z geometry.');scale=3.4/zs[Math.floor(zs.length/2)];origin=coordinateOrigin?coordinateOrigin.map(x=>-x):[0,0,0];translation=[0,0,0];sourceAspect=rf.width/rf.height;referenceIntrinsics={ratio:K[0]/K[1],cx:(K[2]+.5)/rf.width,cy:(K[3]+.5)/rf.height};}

  if(fixedFrame){origin=[...fixedFrame.origin];if(coordinateOrigin||fixedFrame.coordinateOrigin)origin=origin.map((x,a)=>x+((fixedFrame.coordinateOrigin?.[a]??0)-(coordinateOrigin?.[a]??0)));scale=fixedFrame.scale;translation=[...fixedFrame.center];}
  if(cloudFrame){const metric=normalizeSpatialCloudFrame(cloudFrame);origin=coordinateOrigin?metric.origin.map((x,a)=>x-coordinateOrigin[a]):[...metric.origin];scale=metric.unitScale;translation=[0,0,0];for(let axis=0;axis<3;axis++)center[axis]=((lo[axis]+hi[axis])*.5-origin[axis])*scale;}
  const sh=cloud.sphericalHarmonics,shStride=sh?(sh.degree+1)**2*3:0,rawSH=sh?decodeFloats(sh.data,cloud.count*shStride):null,sphericalHarmonics=sh?{degree:sh.degree,values:new Float32Array(count*shStride)}:null;
  for(let dst=0;dst<count;dst++){const i=cloudFrame?Math.floor((dst+.5)*cloud.count/count):dst*skip,k=i*14;sourceIds[dst]=i;groups[dst]=rawGroups[i];anchor.set([0,1,2].map(a=>(raw[k+a]-origin[a])*scale+translation[a]),dst*3);covariance.set(quatCovariance(...Array.from(raw.subarray(k+3,k+6)).map(x=>x*scale),...raw.subarray(k+6,k+10)),dst*6);colors.set(raw.subarray(k+10,k+14),dst*4);normals.set(gaussianSurfaceNormal(raw.subarray(k+3,k+6),raw.subarray(k+6,k+10)),dst*3);if(sh)sphericalHarmonics.values.set(rawSH.subarray(i*shStride,(i+1)*shStride),dst*shStride);}
  return{confidence:rawConfidence?Float32Array.from(sourceIds,i=>rawConfidence[i]):null,count,anchor,covariance,colors,normals,uv,mobility,sourceIds,groups,sphericalHarmonics,edges:neighborEdges(anchor,.13,groups),sourceAspect,referenceIntrinsics,center,baseDistance:cloudFrame?Math.max(span*scale,1e-3):3.4,cols:0,rows:0,source:'cloud',normalization:{origin,scale,center:translation,...(coordinateOrigin?{coordinateOrigin}:{})},...(cloudFrame?{worldFrame:normalizeSpatialCloudFrame(cloudFrame)}:{}),raw,provenance:cloud.metadata.provenance};
}
function neighborEdges(positions,cell=.1,groups=null) {
 const bins=new Map(),key=(x,y,z)=>x+','+y+','+z,edges=[];
 for(let i=0;i<positions.length/3;i++){const k=i*3,x=Math.floor(positions[k]/cell),y=Math.floor(positions[k+1]/cell),z=Math.floor(positions[k+2]/cell);let found=0;
   for(let a=-1;a<=1&&found<4;a++)for(let b=-1;b<=1&&found<4;b++)for(let c=-1;c<=1&&found<4;c++)for(const j of bins.get(key(x+a,y+b,z+c))??[]){const d=(positions[k]-positions[j*3])**2+(positions[k+1]-positions[j*3+1])**2+(positions[k+2]-positions[j*3+2])**2;if(d<cell*cell&&(!groups||groups[i]===groups[j])){edges.push(i,j);found++;if(found>=4)break;}}
   const q=key(x,y,z),list=bins.get(q)??[];if(list.length<24)list.push(i);bins.set(q,list);
 }return Uint32Array.from(edges);
}
class SpatialPhysics {
 constructor(geometry){this.geometry=geometry;this.phases=Float32Array.from({length:geometry.count},(_,i)=>hash01(geometry.phaseIds?.[i]??i)*6.2831853);this.offset=new Float32Array(geometry.count*3);this.velocity=new Float32Array(geometry.count*3);this.anchors=new Float32Array(geometry.anchor);this.last=null;this.lastSerial=0;this.hit=null;this.grab=null;this.clickHit=null;this.steps=0;this.maxOffset=0;this.sequenceCache=null;this.motionTime=0;this.currentCovariance=null;this.currentNormals=null;}
 reset(){this.offset.fill(0);this.velocity.fill(0);this.last=null;this.hit=null;this.grab=null;this.clickHit=null;this.lastSerial=0;this.maxOffset=0;if(this.currentCovariance){this.currentCovariance.set(this.geometry.covariance);this.currentNormals?.set(this.geometry.normals);this.currentTangentU?.set(this.geometry.tangentU);this.currentTangentV?.set(this.geometry.tangentV);}}
 setSequence(sequence,time){if(!sequence)return;if(this.sequenceCache?.source!==sequence){this.sequenceCache={source:sequence,frames:sequence.frames.map(f=>{const out={time:f.time};for(const[k,n]of Object.entries({positions:3,rotations:4,scales:3,colors:3,opacities:1,...(sequence.shDegree!==undefined?{sh:(sequence.shDegree+1)**2*3}:{})}))if(f[k])out[k]=decodeFloats(f[k],sequence.count*n);return out;})};}
   const frames=this.sequenceCache.frames,end=frames.at(-1).time,start=frames[0].time;
   const t=sequence.loop&&end>start?start+((time-start)%(end-start)+(end-start))%(end-start):clamp(time,start,end);this.motionTime=t;
   let b=frames.findIndex(f=>f.time>=t);if(b<0)b=frames.length-1;const a=Math.max(0,b-1),mix=b===a?0:(t-frames[a].time)/(frames[b].time-frames[a].time),g=this.geometry,A=frames[a],B=frames[b];
   if(A.rotations||A.scales){this.currentCovariance??=new Float32Array(g.count*6);this.currentNormals??=new Float32Array(g.count*3);}
   if(A.colors||A.opacities)this.currentColors??=new Float32Array(g.colors);if(A.sh)this.currentSH??={degree:sequence.shDegree,values:new Float32Array(g.count*(sequence.shDegree+1)**2*3)};
   const positionOrigin=sequence.origin||g.normalization?.coordinateOrigin?[0,1,2].map(a=>(sequence.origin?.[a]??0)-(g.normalization?.coordinateOrigin?.[a]??0)):null;
   for(let i=0;i<g.count;i++){const id=g.sourceIds?.[i]??i,object=g.objectTransforms?.get(g.groups[i]);if(A.sh){const n=(sequence.shDegree+1)**2*3;for(let j=0;j<n;j++)this.currentSH.values[i*n+j]=A.sh[id*n+j]*(1-mix)+B.sh[id*n+j]*mix;}for(let axis=0;axis<3;axis++){let source=A.positions[id*3+axis]*(1-mix)+B.positions[id*3+axis]*mix;if(positionOrigin)source+=positionOrigin[axis];const v=object?object.center[axis]+(source-object.center[axis])*object.scale+object.translation[axis]:source;this.anchors[i*3+axis]=g.normalization?(v-g.normalization.origin[axis])*g.normalization.scale+g.normalization.center[axis]:v;}
    if(this.currentCovariance&&g.raw){const q=A.rotations?slerpQuaternion(A.rotations.subarray(id*4,id*4+4),B.rotations.subarray(id*4,id*4+4),mix):Array.from(g.raw.subarray(id*14+6,id*14+10)),scale=g.normalization?.scale??1,sc=[0,1,2].map(k=>(A.scales?Math.exp(Math.log(A.scales[id*3+k])*(1-mix)+Math.log(B.scales[id*3+k])*mix)*(object?.scale??1):g.raw[id*14+3+k])*scale);this.currentCovariance.set(quatCovariance(...sc,...q),i*6);this.currentNormals.set(gaussianSurfaceNormal(sc,q),i*3);}
    if(this.currentColors){for(let k=0;k<3;k++)this.currentColors[i*4+k]=A.colors?clamp(A.colors[id*3+k]*(1-mix)+B.colors[id*3+k]*mix,0,1):g.colors[i*4+k];this.currentColors[i*4+3]=A.opacities?clamp(A.opacities[id]*(1-mix)+B.opacities[id]*mix,0,1)*(object?.opacity??1):g.colors[i*4+3];}
   }
 }
 pick(frame,camera,radius){
  const p=frame.pointer??[.5,.5,0],g=this.geometry,A=this.anchors,O=this.offset,col=this.currentColors??g.colors;
  const eye=camera.eye,F=camera.forward,U=camera.up,V=camera.right,fx=camera.fx,fy=camera.fy,aspect=camera.aspect,limit=radius*radius*.18;
  let best=-1,score=Infinity;
  for(let i=0;i<g.count;i++){if(g.mobility[i]<.01||col[i*4+3]<.1)continue;const k=i*3,x=A[k]+O[k]-eye[0],y=A[k+1]+O[k+1]-eye[1],z=A[k+2]+O[k+2]-eye[2],depth=x*F[0]+y*F[1]+z*F[2];if(depth<=.05)continue;const sx=((camera.cx??.5)+fx*(x*V[0]+y*V[1]+z*V[2])/depth-p[0])*aspect,sy=(camera.cy??.5)-fy*(x*U[0]+y*U[1]+z*U[2])/depth-p[1],dist=sx*sx+sy*sy,cost=dist+depth*.000025;if(dist<limit&&cost<score){best=i;score=cost;}}
  return best;
 }
 step(time,s,frame,camera,audio={},frozen=false){
   if(s.sequence)this.setSequence(s.sequence,sequenceSourceTime(s,s.sourceTime??time));
   let dt=this.last===null?0:clamp(time-this.last,0,.1);if(this.last!==null&&time<this.last-.02){this.reset();dt=0;}this.last=time;if(frozen)dt=0;
   const active=!frozen&&frame?.pointer?.[2]&&s.force>0,pressed=active&&frame.pressed===true,serial=frame?.serial??0,fresh=pressed&&serial!==this.lastSerial;
   if(active){if(!this.grab||fresh||!pressed){const id=this.pick(frame,camera,s.radius);if(id>=0){const k=id*3;this.hit={id,point:[this.anchors[k]+this.offset[k],this.anchors[k+1]+this.offset[k+1],this.anchors[k+2]+this.offset[k+2]]};}else if(!pressed)this.hit=null;}
     if(fresh&&this.hit)this.grab={...this.hit,point:[...this.hit.point],normal:[...camera.forward],anchor:[...this.hit.point]};
   }else if(!pressed)this.hit=null;
   if(!pressed)this.grab=null;
   const hit=this.grab??this.hit,ray=active?rayFor(frame.pointer[0],frame.pointer[1],camera):null,target=hit&&ray?planeHit(ray,hit.point,this.grab?.normal??camera.forward):null;
   const g=this.geometry,n=g.count,off=this.offset,vel=this.velocity,anchors=this.anchors,sub=Math.max(1,Math.ceil(dt/(1/90))),h=dt/sub;
   const response=s.response??LEGACY_SPATIAL_RESPONSE,coeff=response.modes;
   const pressGain=response.pressureBase+clamp(frame?.pointer?.[3]??.5,0,1)*response.pressureAmount;
   const freshResponse=!frozen&&!frame?.suppressed&&serial>0&&serial!==this.lastSerial;
   let samples;
   if(s.response){
     samples=s.force>0?sampleSpatialGestures(response,s.mode,frame,freshResponse,frozen):[];
     if(frame?.suppressed||serial>0&&serial!==this.lastSerial)this.clickHit=null;
     if(freshResponse&&samples.some(sample=>sample.event==='click')){
       const id=this.pick({pointer:[...frame.anchor,1]},camera,s.radius);
       if(id>=0){const point=Array.from(this.anchors.subarray(id*3,id*3+3),(v,j)=>v+off[id*3+j]);this.clickHit=planeHit(rayFor(frame.anchor[0],frame.anchor[1],camera),point,camera.forward);}
     }
     samples=samples.map(sample=>({...sample,target:sample.event==='click'?this.clickHit:target,grab:sample.event==='press'?this.grab:null,fresh:sample.event==='click'&&freshResponse}));
   }else samples=target?[{effect:s.mode,strength:1,pressed,fresh,target,grab:this.grab,impulse:false}]:[];
   const mv=frame?.velocity??[0,0];
   samples=samples.filter(sample=>sample.target).map(sample=>{
     const rworld=Math.max(.01,(projectPoint(sample.target,camera)[2]/camera.fy)*s.radius);
     return {...sample,rworld,r2:rworld*rworld,sv:camera.right.map((x,j)=>(x*mv[0]-camera.up[j]*mv[1])*rworld*response.velocityScale)};
   });
   for(let substep=0;substep<sub;substep++){
    for(let i=0;i<n;i++){
     const k=i*3,m=g.mobility[i];if(m<=.0001){off[k]=off[k+1]=off[k+2]=vel[k]=vel[k+1]=vel[k+2]=0;continue;}
     let ax=-off[k]*s.spring,ay=-off[k+1]*s.spring,az=-off[k+2]*s.spring;
     for(const sample of samples){
       if(sample.impulse&&(substep!==0||dt<=0))continue;
       const {target,rworld,r2,sv}=sample,mode=sample.effect,c=coeff[mode],gain=sample.pressed?pressGain:0;
       const px=anchors[k]+off[k]-target[0],py=anchors[k+1]+off[k+1]-target[1],pz=anchors[k+2]+off[k+2]-target[2],dist=px*px+py*py+pz*pz,w=Math.exp(-dist/(r2*response.falloff))*s.force*m*sample.strength;
       let fx=0,fy=0,fz=0;
       if(mode==='flow'){fx=(-py*c.swirl+sv[0]*c.velocity-px*gain*c.pull)*w;fy=(px*c.swirl+sv[1]*c.velocity-py*gain*c.pull)*w;fz=(Math.sin((px+py)*c.waveFrequency)*c.waveAmplitude+sv[2]*c.velocity-pz*gain*c.depthPull)*w;}
       else if(mode==='shatter'){
         if(sample.fresh&&substep===0&&dt>0){vel[k]+=(px+c.scatter*(hash01(i)-.5))*w*c.impulse*pressGain;vel[k+1]+=(py+c.scatter*(hash01(i+1)-.5))*w*c.impulse*pressGain;vel[k+2]+=(pz-c.depthBias)*w*c.depthImpulse*pressGain;}
         if(!sample.impulse){fx=px*w*c.repulsion;fy=py*w*c.repulsion;fz=pz*w*c.repulsion;}
       }
       else if(mode==='fabric'){
         if(sample.grab&&sample.pressed){const ap=sample.grab.anchor,dx=anchors[k]-ap[0],dy=anchors[k+1]-ap[1],dz=anchors[k+2]-ap[2],grab=Math.exp(-(dx*dx+dy*dy+dz*dz)/(r2*c.grabFalloff))*s.force*m*sample.strength;fx=((target[0]-ap[0])-off[k])*grab*c.grab*pressGain;fy=((target[1]-ap[1])-off[k+1])*grab*c.grab*pressGain;fz=((target[2]-ap[2]-c.depthBias)-off[k+2])*grab*c.grab*pressGain;}else fz=-w*c.hoverDepth;
       }
       else if(mode==='ripple'){const d=Math.sqrt(dist),wave=Math.sin(d/rworld*c.frequency-time*c.speed)*(sample.pressed?c.pressAmplitude*pressGain:c.hoverAmplitude);fx=g.normals[k]*wave*w;fy=g.normals[k+1]*wave*w;fz=g.normals[k+2]*wave*w;}
       else if(mode==='orbit'){fx=(-px*c.pullX-pz*c.swirl+sv[0])*(c.hoverGain+gain)*w;fy=(-py*c.pullY+Math.sin(time*c.waveSpeed+px*c.waveFrequency)*c.waveAmplitude)*(c.hoverGain+gain)*w;fz=(-pz*c.pullZ+px*c.swirl+sv[2])*(c.hoverGain+gain)*w;}
       else{const delay=c.delay+(i%c.cohorts)/c.cohorts*c.delaySpread;fx=(sv[0]*c.velocity*delay-py*c.swirl)*w;fy=(sv[1]*c.velocity*delay+px*c.swirl)*w;fz=(sv[2]*c.depthVelocity-c.pressDepth*gain*delay)*w;}
       if(sample.impulse){vel[k]+=fx;vel[k+1]+=fy;vel[k+2]+=fz;}else{ax+=fx;ay+=fy;az+=fz;}
     }
     const phase=this.phases[i],turb=s.turbulence*.016;
     ax+=Math.sin(anchors[k+1]*4+time*.5+phase)*turb*m;ay+=Math.cos(anchors[k]*4-time*.4+phase)*turb*m;
     // A slow coherent target field moves connected regions together. It is
     // independent of pointer input and still obeys the identity envelope,
     // pinned-mask mobility, strain projection and reduced-motion freeze.
     const drift=(s.idleDrift??0)*s.spring*m;
     if(drift>0){const wave=time*.34+anchors[k+1]*.9+anchors[k+2]*.35;ax+=Math.sin(wave)*drift;ay+=Math.cos(time*.27+anchors[k]*.8)*drift*.42;az+=Math.sin(wave*.7+anchors[k]*.6)*drift*.28;}
     const bands=response.audio[s.mode],bass=audio.bass??0,mid=audio.mid??0,high=audio.treble??0,onset=audio.onset??0;
     if(s.mode==='flow'||s.mode==='orbit'){ax-=anchors[k+1]*bass*bands.bass;ay+=anchors[k]*mid*bands.mid;az+=Math.sin(anchors[k]*4+time)*high*bands.treble;}
     else if(s.mode==='shatter'){ax+=anchors[k]*onset*bands.onset;ay+=anchors[k+1]*onset*bands.onset;az-=onset*bands.onsetDepth+bass*bands.bass;}
     else if(s.mode==='fabric'||s.mode==='ripple'){const bend=Math.sin((g.uv[i*2]||0)*Math.PI)*Math.sin((g.uv[i*2+1]||0)*Math.PI);az-=bend*bass*bands.bass;ay+=high*Math.sin(anchors[k]*12+time)*bands.treble;}
     else{ax+=mid*bands.mid*Math.sin(anchors[k+1]*3+time);az+=high*bands.treble*Math.sin(i%coeff.echo.cohorts);}
     const damping=Math.exp(-s.damping*h);vel[k]=(vel[k]+ax*h)*damping;vel[k+1]=(vel[k+1]+ay*h)*damping;vel[k+2]=(vel[k+2]+az*h)*damping;
     off[k]+=vel[k]*h;off[k+1]+=vel[k+1]*h;off[k+2]+=vel[k+2]*h;
    }
    // Rest-neighborhood correction acts on the offset field. This preserves
    // the canonical depth break and cannot stitch foreground to background.
    const cohesion=s.cohesion*(s.mode==='shatter'?coeff.shatter.cohesionScale:1)*(1-Math.exp(-h*16));
    if(cohesion>0)for(let e=0;e<g.edges.length;e+=2){const a=g.edges[e],b=g.edges[e+1],ka=a*3,kb=b*3,ma=g.mobility[a],mb=g.mobility[b],weight=cohesion*.5;for(let axis=0;axis<3;axis++){const delta=(off[kb+axis]-off[ka+axis])*weight;off[ka+axis]+=delta*ma;off[kb+axis]-=delta*mb;}}
    this.maxOffset=0;
    for(let i=0;i<n;i++){const k=i*3,length=Math.hypot(off[k],off[k+1],off[k+2]);if(length>s.maxDisplacement){const factor=s.maxDisplacement/length;off[k]*=factor;off[k+1]*=factor;off[k+2]*=factor;for(let a=0;a<3;a++)vel[k+a]*=.7;}this.maxOffset=Math.max(this.maxOffset,Math.min(length,s.maxDisplacement));}
   }
   if(dt>0){this.steps+=sub;if(fresh||s.response&&serial>0)this.lastSerial=serial;}
   this.cageStats=projectCage(this,s,dt);
   this.correctedEdges=projectStrain(this,s,dt);
   if(s.surfaceSafety){this.maxOffset=0;for(let k=0;k<off.length;k+=3)this.maxOffset=Math.max(this.maxOffset,Math.hypot(off[k],off[k+1],off[k+2]));}
   this.updateSurfaceDifferential(s);
 }
 /** Push the actual surface differential into covariance and texture tangents.
  * A translated center alone leaves holes while stretching a textured surface.
  * Breaks are tested in canonical depth; pinned particles retain their shape. */
 updateSurfaceDifferential(s){
  const g=this.geometry;if(!g.cols||s.sequence)return;
  if(this.maxOffset<1e-7&&!this.currentCovariance)return;
  this.currentCovariance??=new Float32Array(g.covariance);this.currentNormals??=new Float32Array(g.normals);
  this.currentTangentU??=new Float32Array(g.tangentU);this.currentTangentV??=new Float32Array(g.tangentV);
  const cols=g.cols,rows=g.rows,off=this.offset,A=g.anchor,TU=g.tangentU,TV=g.tangentV,C=this.currentCovariance,N=this.currentNormals,U=this.currentTangentU,V=this.currentTangentV;
  const bounded=new Float64Array(6),ra=new Float64Array(3),rb=new Float64Array(3),da=new Float64Array(3),db=new Float64Array(3);
  this.clampedFootprints=0;this.rawPrincipalStretch=1;
  const detached=s.surfaceSafety&&['shatter','orbit','echo'].includes(s.mode);
  const edgeLimit=s.edge*s.depth,fy=1/(2*Math.tan(s.fov*Math.PI/360)),fx=fy/g.sourceAspect,sd=.43*.43;
  for(let i=0;i<g.count;i++){
   const k=i*3,c=i*6;
   if(g.mobility[i]<.0001||this.maxOffset<1e-7||detached){for(let a=0;a<6;a++)C[c+a]=g.covariance[c+a];for(let a=0;a<3;a++){N[k+a]=g.normals[k+a];U[k+a]=TU[k+a];V[k+a]=TV[k+a];}continue;}
   const x=i%cols,y=Math.floor(i/cols),jx=(x+1<cols?i+1:i-1)*3,jy=(y+1<rows?i+cols:i-cols)*3,sx=x+1<cols?1:-1,sy=y+1<rows?1:-1;
   const dx=connectedDepth(A[k+2],A[jx+2],A[k+2]/fx/cols,s)&&(!s.isolateMask||(g.mobility[i]>.0001)===(g.mobility[jx/3]>.0001))?sx:0,dy=connectedDepth(A[k+2],A[jy+2],A[k+2]/fy/rows,s)&&(!s.isolateMask||(g.mobility[i]>.0001)===(g.mobility[jy/3]>.0001))?sy:0;
   let ax=TU[k]/cols+(off[jx]-off[k])*dx,ay=TU[k+1]/cols+(off[jx+1]-off[k+1])*dx,az=TU[k+2]/cols+(off[jx+2]-off[k+2])*dx,bx=TV[k]/rows+(off[jy]-off[k])*dy,by=TV[k+1]/rows+(off[jy+1]-off[k+1])*dy,bz=TV[k+2]/rows+(off[jy+2]-off[k+2])*dy;
   if(s.surfaceSafety){
    for(let j=0;j<3;j++){ra[j]=TU[k+j]/cols;rb[j]=TV[k+j]/rows;}da.set([ax,ay,az]);db.set([bx,by,bz]);
    const metric=boundedDifferential(da,db,ra,rb,s.maxStretch,.65,bounded);this.rawPrincipalStretch=Math.max(this.rawPrincipalStretch,metric[0]);if(metric[2])this.clampedFootprints++;
    [ax,ay,az,bx,by,bz]=bounded;
   }
   const nx=ay*bz-az*by,ny=az*bx-ax*bz,nz=ax*by-ay*bx,len=Math.hypot(nx,ny,nz)||1,rx=nx/len,ry=ny/len,rz=nz/len,z=A[k+2],sigma=Math.min(z/fx/cols,z/fy/rows)*s.thickness*.43,ss=sigma*sigma;
   C[c]=sd*(ax*ax+bx*bx)+rx*rx*ss;C[c+1]=sd*(ax*ay+bx*by)+rx*ry*ss;C[c+2]=sd*(ax*az+bx*bz)+rx*rz*ss;C[c+3]=sd*(ay*ay+by*by)+ry*ry*ss;C[c+4]=sd*(ay*az+by*bz)+ry*rz*ss;C[c+5]=sd*(az*az+bz*bz)+rz*rz*ss;
   N[k]=rx;N[k+1]=ry;N[k+2]=rz;U[k]=ax*cols;U[k+1]=ay*cols;U[k+2]=az*cols;V[k]=bx*rows;V[k+1]=by*rows;V[k+2]=bz*rows;
  }
 }
 snapshot(){return{offset:Array.from(this.offset),velocity:Array.from(this.velocity),last:this.last,lastSerial:this.lastSerial,steps:this.steps,hit:this.hit?JSON.parse(JSON.stringify(this.hit)):null,grab:this.grab?JSON.parse(JSON.stringify(this.grab)):null,...(this.clickHit?{clickHit:[...this.clickHit]}:{}),maxOffset:this.maxOffset,motionTime:this.motionTime};}
 restore(s){if(s?.offset?.length!==this.offset.length||s?.velocity?.length!==this.velocity.length)throw new TypeError('Spatial snapshot count mismatch');this.offset.set(s.offset);this.velocity.set(s.velocity);this.last=s.last;this.lastSerial=s.lastSerial;this.steps=s.steps;this.hit=s.hit??null;this.grab=s.grab??null;this.clickHit=s.clickHit??null;this.maxOffset=s.maxOffset??0;this.motionTime=s.motionTime??0;}
}

function slerpQuaternion(a,b,t){let qa=Array.from(a),qb=Array.from(b),na=Math.hypot(...qa),nb=Math.hypot(...qb);if(na<1e-8||nb<1e-8)throw new TypeError('Zero motion quaternion.');qa=qa.map(v=>v/na);qb=qb.map(v=>v/nb);let dot=qa.reduce((s,v,i)=>s+v*qb[i],0);if(dot<0){qb=qb.map(v=>-v);dot=-dot;}if(dot>.9995){const q=qa.map((v,i)=>v*(1-t)+qb[i]*t),n=Math.hypot(...q);return q.map(v=>v/n);}const theta=Math.acos(Math.min(1,dot)),aWeight=Math.sin((1-t)*theta)/Math.sin(theta),bWeight=Math.sin(t*theta)/Math.sin(theta);return qa.map((v,i)=>v*aWeight+qb[i]*bWeight);}
/** Symmetric eigendecomposition for interoperable PLY export, no diagonal approximation. */
function covarianceToScaleRotation(c){
 const a=[[c[0],c[1],c[2]],[c[1],c[3],c[4]],[c[2],c[4],c[5]]],v=[[1,0,0],[0,1,0],[0,0,1]];
 for(let iter=0;iter<16;iter++){let p=0,q=1;for(const [i,j]of [[0,2],[1,2]])if(Math.abs(a[i][j])>Math.abs(a[p][q])){p=i;q=j;}if(Math.abs(a[p][q])<1e-15)break;
  const angle=.5*Math.atan2(2*a[p][q],a[q][q]-a[p][p]),co=Math.cos(angle),si=Math.sin(angle),app=a[p][p],aqq=a[q][q],apq=a[p][q];
  a[p][p]=co*co*app-2*si*co*apq+si*si*aqq;a[q][q]=si*si*app+2*si*co*apq+co*co*aqq;a[p][q]=a[q][p]=0;
  for(let k=0;k<3;k++){if(k!==p&&k!==q){const x=a[k][p],y=a[k][q];a[k][p]=a[p][k]=co*x-si*y;a[k][q]=a[q][k]=si*x+co*y;}const x=v[k][p],y=v[k][q];v[k][p]=co*x-si*y;v[k][q]=si*x+co*y;}
 }
 const scales=[0,1,2].map(i=>Math.sqrt(Math.max(a[i][i],1e-14))),trace=v[0][0]+v[1][1]+v[2][2];let q;
 if(trace>0){const s=Math.sqrt(trace+1)*2;q=[s/4,(v[2][1]-v[1][2])/s,(v[0][2]-v[2][0])/s,(v[1][0]-v[0][1])/s];}
 else{let i=0;if(v[1][1]>v[i][i])i=1;if(v[2][2]>v[i][i])i=2;const j=(i+1)%3,k=(i+2)%3,s=Math.sqrt(1+v[i][i]-v[j][j]-v[k][k])*2;q=[(v[k][j]-v[j][k])/s,0,0,0];q[i+1]=s/4;q[j+1]=(v[j][i]+v[i][j])/s;q[k+1]=(v[k][i]+v[i][k])/s;}
 const n=Math.hypot(...q);return{scales,rotation:q.map(v=>v/n)};
}

/** Exact float32 depth ordering in O(4N), preserving canonical IDs on ties.
 * Unlike comparison sorting, this needs no per-point JavaScript comparator. */
function radixDepthOrder(depths,order,scratch,keys,counts){
 const bits=new Uint32Array(depths.buffer,depths.byteOffset,depths.length),n=depths.length;
 if(order.length!==n||scratch.length!==n||keys.length!==n||counts.length<256)throw new TypeError('Depth-sort scratch layout mismatch.');
 for(let i=0;i<n;i++){let b=depths[i]===0?0:bits[i];keys[i]=~((b&0x80000000)?~b:(b^0x80000000));order[i]=i;}
 let source=order,dest=scratch;
 for(let byte=0;byte<4;byte++){counts.fill(0);const shift=byte*8;for(let i=0;i<n;i++)counts[(keys[source[i]]>>>shift)&255]++;let sum=0;for(let i=0;i<256;i++){const c=counts[i];counts[i]=sum;sum+=c;}for(let i=0;i<n;i++){const id=source[i];dest[counts[(keys[id]>>>shift)&255]++]=id;}[source,dest]=[dest,source];}
 return order;
}

export {SPATIAL_VERSION,SPATIAL_MODES,SPATIAL_PARAMS,SPATIAL_ART_FIELDS,SPATIAL_WORLDS,spatialDefaults,normalizeSpatial,normalizeSpatialSourceClip,createFaithfulSpatialSettings,encodeFloats,decodeFloats,normalizeSpatialOrigin,packCloud,validateCloud,unpackCloud,validateSequence,quatCovariance,sequenceSourceTime,gaussianSurfaceNormal,normalize3,cross3,dot3,cameraFor,projectPoint,rayFor,planeHit,unprojectPixel,hash01,depthAt,liftDepthField,geometryFromCloud,neighborEdges,SpatialPhysics,slerpQuaternion,covarianceToScaleRotation,decodeGroups,radixDepthOrder};
