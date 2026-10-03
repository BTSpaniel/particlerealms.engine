// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Browser ESM conversion of the supplied Ambient Studio depth reconstruction source.
 * Numeric algorithms and data contracts retain their original implementation. */
/** Calibrated RGB-D fusion, deliberately separate from neural depth estimation.
 * All input camera poses share one world frame. No per-image scale normalization.
 * Static-only fusion refuses to treat an arbitrary moving video as a static scan.
 */
import { decodeFloats,packCloud,covarianceToScaleRotation,normalize3,cross3 } from "./SpatialCore.js";
import { cloneStrictJson } from '../../../../../engine/core/schema/StrictJsonValue.js';
import { createSpatialCameraRig } from './SpatialCameraRig.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function number(x,label){if(typeof x!=='number'||!Number.isFinite(x))throw new TypeError(label+' must be finite');return x;}
function validateRGBDCameraPose(value){
 const m=cloneStrictJson(value,'$.cameraToWorld');if(!Array.isArray(m)||m.length!==16)throw new TypeError('Supply a row-major camera-to-world 4x4 pose.');m.forEach(x=>number(x,'camera pose'));
 if(Math.abs(m[12])+Math.abs(m[13])+Math.abs(m[14])+Math.abs(m[15]-1)>1e-5)throw new TypeError('Pose must be affine with bottom row 0,0,0,1.');
 const cols=[[m[0],m[4],m[8]],[m[1],m[5],m[9]],[m[2],m[6],m[10]]];for(let a=0;a<3;a++)for(let b=0;b<3;b++){const d=cols[a].reduce((s,x,k)=>s+x*cols[b][k],0);if(Math.abs(d-(a===b?1:0))>.01)throw new TypeError('Camera pose rotation must be orthonormal; align scale in the depth values.');}
 const det=cols[0].reduce((s,x,k)=>s+x*cross3(cols[1],cols[2])[k],0);if(det<.99)throw new TypeError('Camera pose must be a proper rotation.');return m;
}
function validateRGBDCapture(raw){
 if(!raw||raw.format!=='ambient.rgbd-capture'||raw.version!==1||raw.staticScene!==true)throw new TypeError('Fusion requires a declared static RGB-D capture. Moving objects must be excluded or reconstructed separately.');
 if(raw.coordinateSystem!=='opencv')throw new TypeError('Capture coordinates must explicitly use the documented OpenCV camera convention.');
 if(!Array.isArray(raw.views)||raw.views.length<1||raw.views.length>32)throw new TypeError('Use 1–32 calibrated RGB-D views per fusion job.');
 let bytes=0;const seen=new Set();const views=raw.views.map((v,i)=>{
  const id=String(v.id??i);if(seen.has(id))throw new TypeError('Capture view IDs must be unique.');seen.add(id);
  if(!Number.isInteger(v.width)||!Number.isInteger(v.height)||v.width<2||v.height<2||v.width>2048||v.height>2048)throw new TypeError('RGB-D frames must be 2–2048 pixels per side.');
  if(typeof v.rgb!=='string'||!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v.rgb))throw new TypeError('Capture RGB must be an embedded supported image.');
  if(typeof v.depth!=='string'||v.depth.length!==Math.ceil(v.width*v.height*4/3)*4)throw new TypeError('Capture depth needs one float32 camera-Z value per pixel.');
  if(!Array.isArray(v.intrinsics)||v.intrinsics.length!==4)throw new TypeError('Supply [fx, fy, cx, cy] in pixel units.');v.intrinsics.forEach(x=>number(x,'intrinsics'));if(v.intrinsics[0]<=0||v.intrinsics[1]<=0)throw new TypeError('Focal lengths must be positive.');
   const m=validateRGBDCameraPose(v.cameraToWorld);
  const unitScale=v.unitScale===undefined?1:number(v.unitScale,'depth unit scale');if(unitScale<=0||unitScale>1000)throw new TypeError('Invalid depth unit scale.');
  bytes+=v.rgb.length+v.depth.length+(v.confidence?.length??0);if(bytes>96*1024*1024)throw new TypeError('Capture exceeds 96 MiB.');
  return{id,name:String(v.name??id).slice(0,100),width:v.width,height:v.height,rgb:v.rgb,depth:v.depth,confidence:v.confidence??null,intrinsics:[...v.intrinsics],cameraToWorld:[...m],unitScale};
 });
 return{format:raw.format,version:1,staticScene:true,coordinateSystem:'opencv',views,depthProvenance:String(raw.depthProvenance??'Supplied depth; measurement provenance not verified.').slice(0,500)};
}
async function decodeImage(data){if(typeof Image==='undefined')return createImageBitmap(await(await fetch(data)).blob());return new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(new Error('Capture RGB image could not decode.'));i.src=data;});}
function transform(m,p,vector=false){return[m[0]*p[0]+m[1]*p[1]+m[2]*p[2]+(vector?0:m[3]),-(m[4]*p[0]+m[5]*p[1]+m[6]*p[2]+(vector?0:m[7])),m[8]*p[0]+m[9]*p[1]+m[10]*p[2]+(vector?0:m[11])];}
async function fuseRGBDCapture(raw,{budget=120000,voxel=.012,confidence=.15,onProgress=()=>{},signal=null}={}){
 const capture=validateRGBDCapture(raw);if(!Number.isFinite(voxel)||voxel<=0||voxel>2)throw new TypeError('Choose a positive voxel size in capture world units.');budget=clamp(Math.floor(budget),100,200000);
 const bins=new Map(),points=[];let accepted=0,rejected=0,fused=0,total=capture.views.reduce((s,v)=>s+v.width*v.height,0),step=Math.max(1,Math.ceil(Math.sqrt(total/(budget*3))));
 for(let vi=0;vi<capture.views.length;vi++){
  signal?.throwIfAborted();const v=capture.views[vi],d=decodeFloats(v.depth,v.width*v.height),conf=v.confidence?decodeFloats(v.confidence,d.length):null,image=await decodeImage(v.rgb);if(image.width!==v.width||image.height!==v.height)throw new Error('RGB dimensions must exactly match depth; resize calibration before import.');
  const pose=[...v.cameraToWorld];for(const k of [3,7,11])pose[k]*=v.unitScale;
  const c=typeof OffscreenCanvas==='function'?new OffscreenCanvas(v.width,v.height):document.createElement('canvas');c.width=v.width;c.height=v.height;const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);const rgba=ctx.getImageData(0,0,v.width,v.height).data,[fx,fy,cx,cy]=v.intrinsics;image.close?.();
  const cam=(x,y,z)=>[(x-cx)*z/fx,(y-cy)*z/fy,z];
  for(let y=0;y<v.height-1;y+=step)for(let x=0;x<v.width-1;x+=step){const i=y*v.width+x,z=d[i]*v.unitScale,weight=conf?clamp(conf[i],0,1):1;if(!(z>.001&&z<10000)||weight<confidence||rgba[i*4+3]<16){rejected++;continue;}
   const zx=d[i+1]*v.unitScale,zy=d[i+v.width]*v.unitScale;if(zx<=0||zy<=0||Math.abs(zx-z)>.05*z||Math.abs(zy-z)>.05*z){rejected++;continue;}
   const pc=cam(x,y,z),px=cam(x+1,y,zx),py=cam(x,y+1,zy),tx=transform(pose,px.map((a,k)=>(a-pc[k])*step),true),ty=transform(pose,py.map((a,k)=>(a-pc[k])*step),true),normal=normalize3(cross3(tx,ty)),position=transform(pose,pc),color=[rgba[i*4]/255,rgba[i*4+1]/255,rgba[i*4+2]/255],opacity=rgba[i*4+3]/255,cell=position.map(a=>Math.floor(a/voxel)),key=cell.join(','),candidates=bins.get(key)??[],nearby=[];for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++)for(let c=-1;c<=1;c++)nearby.push(...(bins.get([cell[0]+a,cell[1]+b,cell[2]+c].join(','))??[]));let existing=null;
   for(const index of nearby){const p=points[index],dist=position.reduce((s,a,k)=>s+(a-p.position[k])**2,0),ndot=normal.reduce((s,a,k)=>s+a*p.normal[k],0),cd=color.reduce((s,a,k)=>s+Math.abs(a-p.color[k]),0);if(dist<voxel*voxel&&ndot>.85&&cd<.5){existing=p;break;}}
   if(existing){const sum=existing.weight+weight,t=weight/sum;for(let k=0;k<3;k++){existing.position[k]+=(position[k]-existing.position[k])*t;existing.color[k]+=(color[k]-existing.color[k])*t;existing.normal[k]+=(normal[k]-existing.normal[k])*t;}existing.opacity+=(opacity-existing.opacity)*t;existing.normal=normalize3(existing.normal);existing.weight=Math.min(sum,20);fused++;continue;}
   if(points.length>=budget){rejected++;continue;}
   const sd=.43,sz=Math.min(Math.hypot(...tx),Math.hypot(...ty))*.18,C=(a,b)=>sd*sd*(tx[a]*tx[b]+ty[a]*ty[b])+normal[a]*normal[b]*sz*sz,cov=[C(0,0),C(0,1),C(0,2),C(1,1),C(1,2),C(2,2)],sr=covarianceToScaleRotation(cov);
   const p={position,color,normal,opacity,weight,scales:sr.scales,rotation:sr.rotation};candidates.push(points.length);bins.set(key,candidates);points.push(p);accepted++;
  }
  onProgress({view:vi+1,total:capture.views.length,points:points.length,fused,rejected});await new Promise(r=>setTimeout(r,0));
 }
 if(points.length<1)throw new Error('No geometrically valid depth samples survived fusion. Check units, intrinsics and confidence.');
 const data=new Float32Array(points.length*14);points.forEach((p,i)=>data.set([...p.position,...p.scales,...p.rotation,...p.color,p.opacity],i*14));
 const cloud=packCloud(data,{name:'Fused RGB-D scene',provenance:`${capture.views.length} calibrated static RGB-D views in one world frame. ${capture.depthProvenance}`,warnings:['Fusion uses supplied calibration; no neural depth or camera estimation ran.','Dynamic objects and unseen surfaces are not filled or hallucinated.']});
 return{cloud,report:{views:capture.views.length,accepted,points:points.length,fused,rejected,voxel,step,coordinateSystem:'right-up-forward',staticScene:true,sourceViews:capture.views.map(v=>({id:v.id,name:v.name,intrinsics:v.intrinsics,cameraToWorld:v.cameraToWorld,unitScale:v.unitScale}))}};
}

/** Retain the reference captured pinhole view in the same Y-up frame as fusion. */
function cameraRigFromRGBDCapture(raw,{viewId=null}={}){
 const capture=validateRGBDCapture(raw),view=viewId===null?capture.views[0]:capture.views.find(value=>value.id===viewId);if(!view)throw new TypeError('Requested reference capture view is missing');
 const depths=decodeFloats(view.depth,view.width*view.height),confidence=view.confidence?decodeFloats(view.confidence,depths.length):null,supported=[];let sum=0,count=0;
 const step=Math.max(1,Math.floor(depths.length/24000));for(let i=0;i<depths.length;i+=step)if(depths[i]>0&&(!confidence||confidence[i]>.15)){supported.push(depths[i]*view.unitScale);sum+=confidence?confidence[i]:1;count++;}
 if(!supported.length)throw new TypeError('Reference capture has no supported positive metric depth');supported.sort((a,b)=>a-b);const focus=supported[Math.floor(supported.length/2)],farDepth=supported.at(-1),m=view.cameraToWorld,eye=[m[3]*view.unitScale,-m[7]*view.unitScale,m[11]*view.unitScale],forward=[m[2],-m[6],m[10]],up=normalize3([-m[1],m[5],-m[9]]);
 let baseline=0;for(const other of capture.views){const pose=other.cameraToWorld,position=[pose[3]*other.unitScale,-pose[7]*other.unitScale,pose[11]*other.unitScale];baseline=Math.max(baseline,Math.hypot(...position.map((value,axis)=>value-eye[axis])));}
 return createSpatialCameraRig({mode:'world',position:eye,target:eye.map((value,axis)=>value+forward[axis]*focus),up,unitScale:1,eyeHeight:0,near:Math.max(.00001,focus*.001),far:Math.max(farDepth*2+baseline,focus+.001),
  intrinsics:{fx:view.intrinsics[0],fy:view.intrinsics[1],cx:view.intrinsics[2],cy:view.intrinsics[3],width:view.width,height:view.height},
  source:{kind:'captured',confidence:sum/count,maxTranslation:Math.max(baseline,focus*.1),maxYaw:capture.views.length===1?18:180,maxPitch:capture.views.length===1?12:85}});
}

export {validateRGBDCapture,validateRGBDCameraPose,fuseRGBDCapture,cameraRigFromRGBDCapture};
