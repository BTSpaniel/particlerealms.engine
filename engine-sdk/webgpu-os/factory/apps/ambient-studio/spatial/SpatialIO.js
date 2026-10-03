// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Browser ESM conversion of the supplied Ambient Studio depth reconstruction source.
 * Numeric algorithms and data contracts retain their original implementation. */
import { cloudSH,rotateSHYaw } from "./SpatialSH.js";
import { packCloud,unpackCloud,decodeGroups,encodeFloats,decodeFloats,validateCloud,normalizeSpatialOrigin } from "./SpatialCore.js";
const C0=.28209479177387814;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
/** Uncompressed standard 3DGS PLY, including view-dependent SH degree 0–3.
 * Unsupported SH orders are explicitly rejected. Compressed/vendor PLY layouts fail closed. */
function readGaussianPLY(buffer,name='Imported PLY',options={}) {
  const bytes=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);
  if(bytes.byteLength>128*1024*1024)throw new Error('PLY exceeds the 128 MiB import limit.');
  const max=Math.min(bytes.length,1024*1024),prefix=new TextDecoder().decode(bytes.subarray(0,max)),match=/end_header\r?\n/.exec(prefix);
  if(!prefix.startsWith('ply')||!match)throw new Error('Not a supported PLY header.');
  const header=prefix.slice(0,match.index+match[0].length),offset=new TextEncoder().encode(header).length;
  let format=null,count=0,current=null,stride=0,prior=0;const properties=[];
  const authoredOrigins=header.split(/\r?\n/).filter(line=>/^comment spatial_origin(?:\s|$)/.test(line));
  if(authoredOrigins.length>1)throw new TypeError('PLY contains duplicate spatial origins.');
  const authoredOrigin=authoredOrigins.length?normalizeSpatialOrigin(authoredOrigins[0].trim().split(/\s+/).slice(2).map(Number)):null;
  const requestedOrigin=options.origin??authoredOrigin;
  let origin=requestedOrigin==='auto'?authoredOrigin:requestedOrigin===null?null:requestedOrigin===undefined?null:normalizeSpatialOrigin(requestedOrigin);
  const types={float:['getFloat32',4],float32:['getFloat32',4],double:['getFloat64',8],float64:['getFloat64',8],uchar:['getUint8',1],uint8:['getUint8',1],char:['getInt8',1],int8:['getInt8',1],short:['getInt16',2],int16:['getInt16',2],ushort:['getUint16',2],uint16:['getUint16',2],int:['getInt32',4],int32:['getInt32',4],uint:['getUint32',4],uint32:['getUint32',4]};
  for(const line of header.split(/\r?\n/)){const t=line.trim().split(/\s+/);if(t[0]==='format')format=t[1];else if(t[0]==='element'){current=t[1];if(current==='vertex'){count=Number(t[2]);}else if(!count&&Number(t[2])>0)prior++;}else if(t[0]==='property'&&current==='vertex'){if(t[1]==='list'||!types[t[1]])throw new Error('Unsupported vertex PLY property.');properties.push({name:t[2],type:t[1],offset:stride});stride+=types[t[1]][1];}}
  if(prior)throw new Error('PLY must place its vertex element before populated auxiliary elements.');
  if(!['ascii','binary_little_endian','binary_big_endian'].includes(format)||!Number.isSafeInteger(count)||count<1||count>2000000)throw new Error('Unsupported PLY format or point count.');
  const names=properties.map(p=>p.name),has=name=>names.includes(name);for(const k of ['x','y','z'])if(!has(k))throw new Error('PLY is missing '+k);
  if(!has('scale_0')&&!has('red')&&!has('f_dc_0'))throw new Error('Compressed/vendor PLY is unsupported; export an uncompressed Gaussian PLY first.');
  const rest=names.filter(n=>/^f_rest_\d+$/.test(n)).length,degree=rest?Math.sqrt(rest/3+1)-1:0;if(rest&&(!Number.isInteger(degree)||degree>3||!has('f_dc_0')||Array.from({length:rest},(_,i)=>'f_rest_'+i).some(k=>!has(k))))throw new TypeError('Unsupported or incomplete spherical harmonic layout.');const coeff=(degree+1)**2;
  const step=Math.max(1,Math.ceil(count/200000)),kept=Math.ceil(count/step),data=new Float32Array(kept*14),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),lines=format==='ascii'?new TextDecoder().decode(bytes.subarray(offset)).trim().split(/\r?\n/):null;
  const sh=has('f_dc_0')?new Float32Array(kept*coeff*3):null,groups=has('spatial_group')?new Uint32Array(kept):null,confidence=has('spatial_confidence')?new Float32Array(kept):null;
  if(format!=='ascii'&&offset+stride*count>bytes.byteLength)throw new Error('Truncated binary PLY.');if(lines&&lines.length<count)throw new Error('Truncated ASCII PLY.');
  for(let i=0,dst=0;i<count;i+=step,dst++){
    const values=Object.create(null),parts=lines?lines[i].trim().split(/\s+/):null;
    properties.forEach((p,j)=>{const n=parts?Number(parts[j]):view[types[p.type][0]](offset+i*stride+p.offset,format!=='binary_big_endian');if(!Number.isFinite(n))throw new Error('Non-finite PLY property at vertex '+i);values[p.name]=n;});
    // Preserve source doubles through origin subtraction, before Float32Array.set.
    if(requestedOrigin==='auto'&&!origin)origin=[values.x,values.y,values.z];
    if(groups){const group=values.spatial_group;if(!Number.isInteger(group)||group<0||group>4294967295)throw new TypeError('Invalid PLY spatial group.');groups[dst]=group;}
    if(confidence){const value=values.spatial_confidence;if(value<0||value>1)throw new TypeError('Invalid PLY spatial confidence.');confidence[dst]=value;}
    const gaussian=has('scale_0'),sc=[0,1,2].map(j=>gaussian?Math.exp(clamp(values['scale_'+j]??-5,-18,12)):Math.max(1e-5,values.radius??.01)),q=[0,1,2,3].map(j=>values['rot_'+j]??(j===0?1:0)),qn=Math.hypot(...q);if(qn<1e-8)throw new Error('PLY contains a zero quaternion.');
    const color=has('f_dc_0')?[0,1,2].map(j=>clamp(.5+C0*values['f_dc_'+j],0,1)):['red','green','blue'].map(k=>clamp((values[k]??128)/255,0,1));
    if(has('spatial_opacity')&&(values.spatial_opacity<0||values.spatial_opacity>1))throw new TypeError('Invalid PLY spatial opacity.');
    const alpha=has('spatial_opacity')?values.spatial_opacity:gaussian?1/(1+Math.exp(-clamp(values.opacity??4,-30,30))):clamp((values.alpha??255)/255,0,1);
    if(sh){for(let c=0;c<3;c++){sh[dst*coeff*3+c]=values['f_dc_'+c];for(let j=1;j<coeff;j++)sh[dst*coeff*3+j*3+c]=values['f_rest_'+(c*(coeff-1)+j-1)];}}
    const position=[values.x,values.y,values.z];
    data.set([...(origin?position.map((x,a)=>x-origin[a]):position),...sc,...q.map(v=>v/qn),...color,alpha],dst*14);
  }
  const warnings=[];if(step>1)warnings.push('Deterministic stride decimation retained '+kept+' of '+count+' Gaussians.');if(!has('scale_0'))warnings.push('Point-cloud PLY: isotropic footprints were assigned; these are not trained Gaussian covariances.');
  const cloud=packCloud(data,{name,provenance:'Imported uncompressed '+format+' PLY. Original coordinates, order and SH coefficients retained.',warnings},origin?{origin}:{});if(sh)cloud.sphericalHarmonics={degree,data:encodeFloats(sh)};if(groups)cloud.groups=encodeFloats(groups);if(confidence)cloud.confidence=encodeFloats(confidence);if(origin)console.debug('[SpatialIO] Imported local Gaussian coordinates',{count:kept,origin:[...origin]});return validateCloud(cloud);
}
function readSplat(buffer,name='Imported SPLAT') {
 const b=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);if(!b.length||b.length%32||b.length>64*1024*1024)throw new Error('SPLAT must contain bounded 32-byte records.');const view=new DataView(b.buffer,b.byteOffset,b.byteLength),count=b.length/32,step=Math.max(1,Math.ceil(count/200000)),out=new Float32Array(Math.ceil(count/step)*14);
 for(let i=0,j=0;i<count;i+=step,j++){const k=i*32,p=j*14;for(let a=0;a<6;a++){const v=view.getFloat32(k+a*4,true);if(!Number.isFinite(v)||(a>2&&v<=0))throw new Error('Invalid SPLAT position/scale.');out[p+a]=v;}const q=[28,29,30,31].map(a=>(b[k+a]-128)/128),n=Math.hypot(...q)||1;out.set(q.map(x=>x/n),p+6);out.set([b[k+24]/255,b[k+25]/255,b[k+26]/255,b[k+27]/255],p+10);}
 return packCloud(out,{name,provenance:'Imported 32-byte Gaussian SPLAT records.',warnings:step>1?['Downsampled to the 200,000-splat import limit.']:[]});
}
function writeGaussianPLY(cloud) {
 const data=unpackCloud(cloud),count=data.length/14,degree=cloud.sphericalHarmonics?.degree??0,n=(degree+1)**2,sh=cloudSH(cloud,degree),props=['x','y','z','f_dc_0','f_dc_1','f_dc_2',...Array.from({length:(n-1)*3},(_,i)=>'f_rest_'+i),'opacity','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3'];
 const origin=cloud.origin===undefined?null:normalizeSpatialOrigin(cloud.origin),groups=cloud.groups===undefined?null:decodeGroups(cloud.groups,count),confidence=cloud.confidence===undefined?null:decodeFloats(cloud.confidence,count);
 if(groups)props.push('spatial_group');if(confidence)props.push('spatial_confidence');if(origin)props.push('spatial_opacity');
 const types=props.map((name,j)=>origin&&j<3?'double':name==='spatial_group'?'uint':'float'),stride=types.reduce((sum,type)=>sum+(type==='double'?8:4),0);
 const header='ply\nformat binary_little_endian 1.0\ncomment Ambient Studio canonical export; SH degree '+degree+'; original world coordinates\n'+(origin?'comment spatial_origin '+origin.join(' ')+'\n':'')+'element vertex '+count+'\n'+props.map((name,j)=>'property '+types[j]+' '+name+'\n').join('')+'end_header\n',h=new TextEncoder().encode(header),b=new Uint8Array(h.length+count*stride);b.set(h);const v=new DataView(b.buffer);
 for(let i=0;i<count;i++){const k=i*14,a=clamp(data[k+13],1e-6,1-1e-6),position=Array.from(data.subarray(k,k+3),(x,j)=>origin?x+origin[j]:x),values=[...position,...sh.subarray(i*n*3,i*n*3+3)];if(position.some(x=>!Number.isFinite(x)))throw new TypeError('Export world coordinates must be finite.');for(let c=0;c<3;c++)for(let j=1;j<n;j++)values.push(sh[i*n*3+j*3+c]);values.push(Math.log(a/(1-a)),...[3,4,5].map(j=>Math.log(data[k+j])),...data.subarray(k+6,k+10));if(groups)values.push(groups[i]);if(confidence)values.push(confidence[i]);if(origin)values.push(data[k+13]);let at=h.length+i*stride;values.forEach((x,j)=>{const type=types[j];v[type==='double'?'setFloat64':type==='uint'?'setUint32':'setFloat32'](at,x,true);at+=type==='double'?8:4;});}if(origin)console.debug('[SpatialIO] Exported double world coordinates',{count,origin:[...origin]});return b;
}
/** Merge assets already expressed in the same world frame. This intentionally
 * does not call unrelated images 'registered', and does not average moving objects. */
function mergeRegisteredClouds(first,second,{translation=[0,0,0],scale=1,yaw=0}={}) {
 if(!Number.isFinite(scale)||scale<=0||scale>100||translation.length!==3||!translation.every(Number.isFinite)||!Number.isFinite(yaw))throw new TypeError('Invalid registration transform.');
 const a=unpackCloud(first),b=unpackCloud(second),n=(a.length+b.length)/14;if(n>200000)throw new Error('Merged cloud exceeds 200,000 Gaussians.');const t=yaw*Math.PI/180,cos=Math.cos(t),sin=Math.sin(t),qw=Math.cos(t/2),qy=Math.sin(t/2);
 const origin=first.origin??second.origin;let offset=translation;
 if(origin){const ao=first.origin??[0,0,0],bo=second.origin??[0,0,0];for(let i=0;i<a.length;i+=14)for(let axis=0;axis<3;axis++)a[i+axis]+=ao[axis]-origin[axis];offset=[bo[0]*scale*cos+bo[2]*scale*sin-origin[0]+translation[0],bo[1]*scale-origin[1]+translation[1],-bo[0]*scale*sin+bo[2]*scale*cos-origin[2]+translation[2]];}
 for(let i=0;i<b.length;i+=14){const x=b[i]*scale,z=b[i+2]*scale;b[i]=x*cos+z*sin+offset[0];b[i+1]=b[i+1]*scale+offset[1];b[i+2]=-x*sin+z*cos+offset[2];for(let j=3;j<6;j++)b[i+j]*=scale;const [w,xx,y,zz]=b.subarray(i+6,i+10);b.set([qw*w-qy*y,qw*xx+qy*zz,qw*y+qy*w,qw*zz-qy*xx],i+6);}
 const out=new Float32Array(a.length+b.length);out.set(a);out.set(b,a.length);const merged=packCloud(out,{name:first.metadata.name+' + '+second.metadata.name,provenance:'Registered merge; explicit transform '+JSON.stringify({translation,scale,yaw}),warnings:[...first.metadata.warnings,...second.metadata.warnings,'Registration is supplied by the user; no automatic visual matching was performed.']},origin?{origin}:{});const ga=decodeGroups(first.groups,first.count),gb=decodeGroups(second.groups,second.count),groups=new Uint32Array(n),renumber=new Map();let serial=0;for(let i=0;i<ga.length;i++){const key='a:'+ga[i];if(!renumber.has(key))renumber.set(key,serial++);groups[i]=renumber.get(key);}for(let i=0;i<gb.length;i++){const key='b:'+gb[i];if(!renumber.has(key))renumber.set(key,serial++);groups[ga.length+i]=renumber.get(key);}merged.groups=encodeFloats(groups);if(first.sphericalHarmonics||second.sphericalHarmonics){const degree=Math.max(first.sphericalHarmonics?.degree??0,second.sphericalHarmonics?.degree??0),sa=cloudSH(first,degree),sb=rotateSHYaw(cloudSH(second,degree),degree,yaw),all=new Float32Array(sa.length+sb.length);all.set(sa);all.set(sb,sa.length);merged.sphericalHarmonics={degree,data:encodeFloats(all)};}return validateCloud(merged);
}

export {readGaussianPLY,readSplat,writeGaussianPLY,mergeRegisteredClouds};
