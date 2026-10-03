// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { packCloud, hash01, geometryFromCloud } from "./SpatialCore.js";
import { normalizeSpatialGeometryScene, spatialTerrainMeshDimensions, spatialTerrainMeshVertexCount, spatialWaterMeshVertexCount } from './SpatialDioramaSchema.js';
import { sampleTerrainHeightfield } from '../../../../../engine/world/generation/TerrainHeightfield.js';
import { createSpatialTree, spatialTreeSampleAllocation, spatialLeafSurface } from './SpatialTree.js';
import { normalizeSpatialCloudFrame } from './SpatialCameraRig.js';
import { createSphereGeometry } from '../../../../../engine/render/geometry/SphereGeometry.js';
import { spatialTerrainSurfaceHeight, spatialTerrainTriangleSampler, spatialTerrainChannelPath, spatialTerrainChannelDistance } from './SpatialTerrainSculpt.js';
import { srgbToLinearRgb, linearRgbToSrgb, rgbLerp } from '../../../../../engine/core/math/MathColor.js';
import { spatialLakeTriangles, spatialWaterfallTriangles, spatialRenderedBedClipper, spatialGeometryWorldTransform } from './SpatialWaterSurface.js';
import { SPATIAL_WATER_FOAM_FIELDS, SPATIAL_WATER_RESPONSE_FIELDS } from './SpatialWaterFoamSource.js';
/** An original fully 3D sampled environment, not a recovered photograph. */
function createSpatialDiorama(budget=42000,seed=7314){
 const data=[],rand=()=>hash01(++sequence+seed);let sequence=0;
 const add=(x,y,z,size,color,sy=size,normal=[0,1,0])=>{
  // Align each flattened splat with its actual surface, retaining 3D relief.
  const w=Math.sqrt(Math.max(.00001,(1+normal[1])*.5));
  data.push(x,y,z,size,sy,size,w,normal[2]/(2*w),0,-normal[0]/(2*w),...color,.96);
 };
 const noise=(x,z)=>{const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz,u=fx*fx*(3-2*fx),v=fz*fz*(3-2*fz),h=(a,b)=>hash01(a*173+b*7919+seed),a=h(ix,iz)*(1-u)+h(ix+1,iz)*u,b=h(ix,iz+1)*(1-u)+h(ix+1,iz+1)*u;return a*(1-v)+b*v;};
 const fbm=(x,z)=>{let total=0,weight=.5;for(let i=0;i<5;i++){total+=noise(x,z)*weight;const nx=x*1.73-z*1.17;x=nx+7.2;z=z*1.73+x*.13+3.4;weight*=.49;}return total;};
 const peaks=[[-1.25,1.35,1.9,.39],[-.67,2.0,2.8,.40],[.12,2.35,2.0,.44],[1.05,1.4,1.6,.43],[1.64,2.6,1.9,.52],[-1.83,2.55,1.7,.51]];
 const terrain=(x,z)=>{
  const warp=(fbm(x*3.0,z*3.0)-.5)*.18;let h=-.71;
  for(const[px,pz,ph,pw]of peaks){const radius=Math.hypot(x-px+warp,z-pz-warp*.5)/pw;h+=ph*Math.exp(-Math.pow(radius,1.65));}
  const rock=(fbm(x*13,z*11)-.5)*.18+Math.sin(x*33+z*21)*.013;
  h+=rock*Math.min(1,Math.max(0,(h+.7)*2));
  return h+.085*(fbm(x*2.5,z*2.5)-.5);
 };
 const nTerrain=Math.floor(budget*.63),footprint=.019*Math.sqrt(65536/Math.max(1024,budget));
 for(let i=0;i<nTerrain;i++){
  const x=rand()*4.55-2.275,z=rand()*4.0-.9,y=terrain(x,z);
  if(y<-.64)continue;
  const sx=(terrain(x+.008,z)-terrain(x-.008,z))/.016,sz=(terrain(x,z+.008)-terrain(x,z-.008))/.016,len=Math.hypot(sx,1,sz),normal=[-sx/len,1/len,-sz/len];
  let light=Math.max(0,normal[0]*-.58+normal[1]*.72+normal[2]*-.38),shadow=1;
  for(let j=1;j<=4;j++){const d=j*.07;if(terrain(x-d*.58,z-d*.38)>y+d*.72+.03)shadow*=.7;}
  light*=shadow;
  const strata=.78+.22*noise(x*32+y*23,z*31),green=Math.max(0,(normal[1]-.62)*2.4)*(1-Math.min(1,Math.max(0,y-1.1))),c=[.09+light*.45,.14+light*.42,.17+light*.32];
  for(let a=0;a<3;a++)c[a]=(c[a]*(1-green)+[.07,.18,.13][a]*green)*strata;
  // Uniform XZ samples cover progressively more surface on a cliff face.
  // Compensate that projected area so steep faces do not become a spotted cloud.
  add(x,y,z,footprint*Math.sqrt(len)*(.93+rand()*.14),c,footprint*.22,normal);
 }
 for(let i=0;i<budget*.20;i++){
  const x=rand()*4.4-2.2,z=rand()*3.8-1.0;if(terrain(x,z)>-.62)continue;
  const ripples=Math.sin(x*53+z*29)*Math.sin(z*77),road=Math.exp(-Math.pow((x-.4-z*.2)/.45,2)),glint=Math.pow(Math.max(0,ripples),8)*road;
  add(x,-.655+Math.sin(x*11+z*7)*.004,z,footprint*1.3,[.025+glint*.7,.095+glint*.4,.12+glint*.17],footprint*.15);
 }
 // Varied, branching pine crowns break the stone silhouettes at several scales.
 for(let tree=0;tree<95;tree++){
  const x=rand()*4-2,z=rand()*2.8-.65,y=terrain(x,z);if(y<-.61||y>1.2)continue;
  const height=.10+rand()*.24,warm=tree%7===0,c=warm?[.40,.21,.09]:[.055,.17,.13];
  for(let i=0;i<Math.max(30,Math.floor(budget*.0013));i++){
   const k=rand(),angle=rand()*Math.PI*2,r=(1-k)*height*(.28+.12*Math.sin(k*25))*Math.sqrt(rand());
   const sun=.7+Math.max(0,Math.cos(angle+2.4))*.8+rand()*.15;
   add(x+Math.cos(angle)*r,y+k*height,z+Math.sin(angle)*r,footprint*.55,c.map(v=>v*sun));
  }
 }
 // Tiny warm pavilion with solidly located roofs, columns and steps.
 const tx=.78,tz=.82,base=terrain(tx,tz)+.09;
 for(let i=0;i<2300;i++){const x=(rand()-.5)*.40,z=(rand()-.5)*.29,layer=i%2,r=Math.max(Math.abs(x)/.2,Math.abs(z)/.145),y=base+.25+layer*.17+.08*(1-r)+.035*r*r;add(tx+x,y,tz+z,.007,[.55+rand()*.2,.27+rand()*.18,.10+rand()*.05],.003);}
 for(let col=0;col<4;col++)for(let i=0;i<70;i++){const x=tx+(col%2?1:-1)*.145,z=tz+(col<2?1:-1)*.10;add(x,base+rand()*.28,z,.008,[.46,.22,.09]);}
 for(let i=0;i<650;i++){const angle=rand()*Math.PI*2,t=rand(),r=.025+rand()*.05;add(-.72+Math.cos(angle)*r,1.55-t*2.12,2.13+Math.sin(angle)*r,.01,[.36+rand()*.1,.65+rand()*.1,.66+rand()*.1],.023);}
 return packCloud(Float32Array.from(data),{name:'Jade sanctuary · procedural geometry',provenance:'Original procedural 3D eroded terrain, surface-aligned Gaussians, directional terrain shadows, water, branching foliage and pavilion. Not a trained or reconstructed scene.',warnings:[]});
}


export { createSpatialDiorama };

function spatialGeometryWorld(params) {
 return spatialGeometryWorldTransform(params);
}
/** Reuse the exact accepted dry-ground placement for admission and emission.
 * A rejected submerged plant allocates neither vertices nor a hidden caster. */
function spatialGroundcoverPlacements(params,world,ground,randomSeed) {
 const omitted=new Set(params.omitPlants),placements=[];
 for(let plant=0;plant<Math.floor(params.count*params.density);plant++){
  if(omitted.has(plant))continue;
  let sample=0;const random=()=>hash01(randomSeed+plant*104729+(++sample)),x=(random()-.5)*params.width,z=(random()-.5)*params.depth,root=world(x,0,z);
  if(ground.contains&&!ground.contains(root[0],root[2]))continue;
  root[1]=params.y+ground(root[0],root[2]);if(root[1]<(params.minElevation??-Infinity))continue;
  placements.push({plant,root,random});
 }
 return placements;
}

/** Execute bounded geometry node data. Legacy projects above keep their exact
 * sequential generator; authored scenes use independent random streams per node. */
export function createSpatialGeometryScene(value, budget = 24576) {
 const scene=normalizeSpatialGeometryScene(value),data=[],groups=[],phases=[],ranges=[],mesh=[],meshRanges=[],treeWind=[],waterSpray=[],splatMaterials=[],meshWind=[],meshNormals=[],meshMaterials=[],trees=[],groundcover=[],waters=[];
 const rgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
 const hashId=id=>{let h=2166136261;for(const c of id)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};
 const weights={terrain:.63,water:.20,foliage:.15,tree:.15,roof:1150/24576,column:70/24576,waterfall:650/24576};
 const fields=new Map(),placements=new Map();
 for(const part of scene.parts)if(part.kind==='terrain')fields.set(part.id,terrainField(part.params));
 for(const part of scene.parts)if(part.kind==='groundcover'&&part.visible&&part.params.density>0&&part.params.opacity>0)placements.set(part.id,spatialGroundcoverPlacements(part.params,spatialGeometryWorld(part.params),fields.get(part.terrainId)??(()=>0),(part.params.seed^hashId(part.id))>>>0));
 const estimate=scene.parts.reduce((sum,part)=>{
  if(!part.visible||part.params.density===0)return sum;
  if(part.kind==='terrain'&&part.params.surfaceMesh===true)return sum+(part.params.opacity>0?spatialTerrainMeshVertexCount(part.params):0);
  if(part.kind==='rock')return sum+(part.params.opacity>0?part.params.radialSegments*part.params.heightSegments*6:0);
  if(part.kind==='water'&&part.params.surfaceMesh===true)return sum+(part.params.opacity>0?spatialWaterMeshVertexCount(part.params,scene.parts.find(candidate=>candidate.id===part.terrainId)?.params):0);
  if(part.kind==='waterfall'&&part.params.surfaceVersion===2)return sum+(part.params.opacity>0?(part.params.fallSegments??32)*(part.params.acrossSegments??8)*6+(part.params.sprayCount??96):0);
  if(part.kind==='groundcover')return sum+(part.params.opacity>0?placements.get(part.id).length*(part.params.species==='grass'?part.params.blades*12:24):0);
  if(part.kind==='tree'){const allocation=spatialTreeSampleAllocation(part.params,Math.floor(budget*weights.tree*part.params.density));return sum+(part.params.opacity>0?allocation.splats+allocation.meshVertices:0);}
  return sum+Math.ceil(budget*weights[part.kind]*part.params.density);
 },0);
 if(estimate>200000)throw new TypeError('Geometry nodes exceed the 200,000 sample/triangle vertex budget. Reduce sample density, mesh density or source count.');
 for(const part of scene.parts){
  if(!part.visible||part.params.density===0||['tree','rock','groundcover'].includes(part.kind)&&part.params.opacity===0||['water','waterfall'].includes(part.kind)&&(part.params.surfaceMesh===true||part.params.surfaceVersion===2)&&part.params.opacity===0)continue;
  const p=part.params,detail=p.detail??0,identity=hashId(part.id),randomSeed=(p.seed^identity)>>>0;let sequence=0;
  const rand=()=>hash01(randomSeed+(++sequence)),limit=Math.floor(budget*weights[part.kind]*p.density),start=data.length/14;
  const angle=p.yaw*Math.PI/180,cs=Math.cos(angle),sn=Math.sin(angle),footprint=.019*Math.sqrt(65536/Math.max(1024,budget*p.density));
  const world=spatialGeometryWorld(p);
  const ground=fields.get(part.terrainId)??(()=>0);
  if(['tree','rock','roof','column','waterfall'].includes(part.kind)&&ground.contains&&!ground.contains(p.groundX??p.x,p.groundZ??p.z)){
   ranges.push({id:part.id,groupId:identity,start,count:0});continue;
  }
  const add=(x,y,z,size,color,sy=size,normal=[0,1,0])=>{
   const position=world(x,y,z),n=[normal[0]*cs-normal[2]*sn,normal[1],normal[0]*sn+normal[2]*cs],w=Math.sqrt(Math.max(.00001,(1+n[1])*.5));
   const rotation=n[1]<-.99999?[0,1,0,0]:[w,n[2]/(2*w),0,-n[0]/(2*w)];
   data.push(...position,size*p.scale,sy*p.scale,size*p.scale,...rotation,...color,p.opacity);
   groups.push(identity);phases.push((identity+data.length/14-start)>>>0);treeWind.push(0,0,0,0,0,0,0,0);waterSpray.push(0,0,0,0,0,0,0,0);splatMaterials.push(0);
  };
  if(part.kind==='tree'){
   const tree=createSpatialTree(p,limit,world,ground(p.x,p.z)),meshStart=mesh.length/6;
   for(let i=0;i<tree.raw.length;i+=16384)data.push(...tree.raw.slice(i,i+16384));
   phases.push(...tree.phases);for(let i=0;i<tree.wind.length;i+=16384)treeWind.push(...tree.wind.slice(i,i+16384));
   splatMaterials.push(...tree.splatMaterials);
   for(let i=0;i<tree.raw.length/14;i++)waterSpray.push(0,0,0,0,0,0,0,0);
   for(let i=0;i<tree.raw.length/14;i++)groups.push(identity);
   for(let i=0;i<tree.mesh.length;i+=16384)mesh.push(...tree.mesh.slice(i,i+16384));
   for(let i=0;i<tree.meshNormals.length;i+=16384)meshNormals.push(...tree.meshNormals.slice(i,i+16384));
   for(let i=0;i<tree.meshWind.length;i+=16384)meshWind.push(...tree.meshWind.slice(i,i+16384));
   for(let i=0;i<tree.meshMaterials.length;i+=16384)meshMaterials.push(...tree.meshMaterials.slice(i,i+16384));
   meshRanges.push({id:part.id,groupId:identity,start:meshStart,count:tree.mesh.length/6});
   trees.push({id:part.id,groupId:identity,...tree.metadata,entities:tree.metadata.entities.map(entity=>({...entity,
    ...(entity.meshStart!=null?{meshStart:entity.meshStart+meshStart}:{}),...(entity.kind==='foliage'?{start:entity.start+start}:{})}))});
  }else if(part.kind==='groundcover'){
   const startVertex=mesh.length/6,entities=[],green=rgb(p.color),dry=rgb(p.tipColor);
   for(const {plant,root,random:prand} of placements.get(part.id)){
    const ownedStart=mesh.length/6;
    for(let blade=0;blade<(p.species==='grass'?p.blades:1);blade++){
     const heading=prand()*Math.PI*2,lean=.18+prand()*.38,height=p.height*(.65+prand()*.7)*p.scale;
     const u=p.species==='grass'?[Math.cos(heading)*lean,Math.sqrt(1-lean*lean),Math.sin(heading)*lean]:[Math.cos(heading),0,Math.sin(heading)];
     const n=p.species==='grass'?[Math.cos(heading)*u[1],-lean,Math.sin(heading)*u[1]]:[0,1,0];
     const attached=[root[0]+Math.cos(heading)*.018*p.scale,root[1]+.005,root[2]+Math.sin(heading)*.018*p.scale];
     const center=attached.map((value,axis)=>value+(p.species==='grass'?u[axis]*height*.5:0)),width=Math.min(.95,p.bladeWidth*p.scale/height);
     const color=green.map((value,axis)=>(value*(.7+prand()*.3)+dry[axis]*(.15+prand()*.15)));
     for(const vertex of spatialLeafSurface(center,u,n,height,width,p.curvature,p.species==='grass')){
      mesh.push(...vertex.local,...color);meshNormals.push(...vertex.normal);meshMaterials.push(3);
      meshWind.push(...attached,p.species==='grass'?Math.max(0,(vertex.local[1]-attached[1])/height):0,hash01(randomSeed+plant)*Math.PI*2,p.species==='grass'?p.windStrength:0,p.windFrequency,p.windDirection*Math.PI/180+angle);
     }
    }
    entities.push({id:`${part.id}.plant.${plant}`,index:plant,root,meshStart:ownedStart,meshCount:mesh.length/6-ownedStart});
   }
   meshRanges.push({id:part.id,groupId:identity,start:startVertex,count:mesh.length/6-startVertex});
   groundcover.push({id:part.id,groupId:identity,version:1,species:p.species,entities});
  }else if(part.kind==='rock'){
   const resolution=Math.min(1,Math.sqrt(p.density/2)),base=ground(p.x,p.z)/p.scale,startVertex=mesh.length/6,stone=rgb(p.color),moss=rgb(p.mossColor),source=createSphereGeometry(.5,Math.max(4,Math.round(p.radialSegments*resolution)),Math.max(3,Math.round(p.heightSegments*resolution))),vertices=[];
   for(let i=0;i<source.positions.length;i+=3){const n=source.normals.slice(i,i+3),deformation=1+p.roughness*(terrainNoise(n[0]*4.1+n[1]*2.3,n[2]*4.7,p.seed)*2-1);
    vertices.push(world(source.positions[i]*p.width*deformation,base+p.height*.32+source.positions[i+1]*p.height*deformation,source.positions[i+2]*p.depth*deformation));}
   for(let i=0;i<source.indices.length;i+=3){const face=source.indices.slice(i,i+3).map(index=>vertices[index]),a=face[1].map((value,axis)=>value-face[0][axis]),b=face[2].map((value,axis)=>value-face[0][axis]);
    const n=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],size=Math.hypot(...n);if(size<1e-8)continue;for(let axis=0;axis<3;axis++)n[axis]/=size;
    const center=world(0,base+p.height*.32,0);if(n.reduce((sum,value,axis)=>sum+value*(face[0][axis]-center[axis]),0)<0){for(let axis=0;axis<3;axis++)n[axis]*=-1;[face[1],face[2]]=[face[2],face[1]];}
    const wet=Math.max(0,n[1]) * p.moss,variation=.83+hash01(p.seed+i)*.25,color=stone.map((value,axis)=>(value*(1-wet)+moss[axis]*wet)*variation);
    // Saved opt-in changes only the rock material class; historical geometry,
    // source pigment, normals and topology retain their exact original bytes.
    for(const vertex of face){mesh.push(...vertex,...color);meshNormals.push(...n);meshWind.push(0,0,0,0,0,0,0,0);meshMaterials.push(p.surfaceProfile==='stone'?5:0);}}
   meshRanges.push({id:part.id,groupId:identity,start:startVertex,count:mesh.length/6-startVertex});
  }else
  if(part.kind==='terrain'){
   const height=terrainField({...p,x:0,y:0,z:0,yaw:0,scale:1}),rock=rgb(p.rockColor),vegetation=rgb(p.foliageColor);
   if(p.surfaceMesh===true){
    // Actual saved sample triangles share the same height sampler, transforms
    // and fixed framing as grounded props. No terrain splats obscure the faces.
    const startVertex=mesh.length/6,field=p.heightfield,{columns,rows}=spatialTerrainMeshDimensions(p);
    const [x0,z0,x1,z1]=field.bounds,dx=(x1-x0)/(columns-1),dz=(z1-z0)/(rows-1),vertices=[],normals=[];
    const push=(vertex,normal)=>{mesh.push(...vertex);meshNormals.push(...normal);meshWind.push(0,0,0,0,0,0,0,0);meshMaterials.push(1);};
    const azimuth=(p.lightAzimuth??-123)*Math.PI/180,elevation=(p.lightElevation??46)*Math.PI/180;
    const lightDirection=[Math.sin(azimuth)*Math.cos(elevation),Math.sin(elevation),Math.cos(azimuth)*Math.cos(elevation)];
    const localLight=[lightDirection[0]*cs+lightDirection[2]*sn,lightDirection[1],-lightDirection[0]*sn+lightDirection[2]*cs];
    if(p.opacity>0){
     for(let z=0;z<rows;z++)for(let x=0;x<columns;x++){
      const px=x0+x*dx,pz=z0+z*dz,y=height(px,pz);
      const radius=p.normalRadius??.5,nx=dx*radius,nz=dz*radius;
      const sx=(height(Math.min(x1,px+nx),pz)-height(Math.max(x0,px-nx),pz))/(Math.min(x1,px+nx)-Math.max(x0,px-nx));
      const sz=(height(px,Math.min(z1,pz+nz))-height(px,Math.max(z0,pz-nz)))/(Math.min(z1,pz+nz)-Math.max(z0,pz-nz));
      const length=Math.hypot(sx,1,sz),normal=[(-sx*cs+sz*sn)/length,1/length,(-sx*sn-sz*cs)/length];
      let direct=Math.max(0,normal.reduce((sum,value,index)=>sum+value*lightDirection[index],0)),shadow=1;
      for(let step=1;step<=4;step++){const distance=step*Math.max(dx,dz)*3;if(height(px+distance*localLight[0],pz+distance*localLight[2])>y+distance*localLight[1]+.01)shadow*=.65;}
      direct*=shadow;
      const forest=p.materialProfile==='forest',patch=terrainNoise(px*1.7*(p.materialScale??1),pz*1.6*(p.materialScale??1),p.seed),flow=sampleTerrainHeightfield(field,px,pz,'flow');
      const green=forest?Math.max(0,normal[1]-.30)*(p.groundCover??.7)*(.45+patch*.75+flow*.35):Math.max(0,(normal[1]-.62)*2.4)*(1-Math.min(1,Math.max(0,y-1.1))),strata=.88+.12*terrainNoise(px*12+y*9,pz*11,p.seed);
      const color=rock.map((value,index)=>Math.min(1,Math.max(0,(forest?(value*(1-green)+vegetation[index]*green):((value*(.42+direct*.84)+direct*[.20,.15,.08][index])*(1-green)+vegetation[index]*(.65+direct*.6)*green))*strata)));
      vertices.push([...world(px,y,pz),...color]);
      normals.push(normal);
     }
     for(let z=0;z<rows-1;z++)for(let x=0;x<columns-1;x++){
      const a=z*columns+x,b=a+1,c=a+columns,d=c+1;
      // Upward winding in the shared world-coordinate frame.
      for(const index of [a,c,b,b,c,d])push(vertices[index],normals[index]);
     }
     if(Object.hasOwn(p,'baseLevel')){
      // A saved base closes the sample tile; it shares the terrain's node ID,
      // transform and existing mesh buffer, including diagnostic views.
      const bottom=index=>{const x=x0+(index%columns)*dx,z=z0+Math.floor(index/columns)*dz;return[...world(x,p.baseLevel,z),...rock.map(value=>value*.38)];};
      const center=[...world((x0+x1)*.5,p.baseLevel,(z0+z1)*.5),...rock.map(value=>value*.38)];
      const side=(a,b)=>{const lowA=bottom(a),lowB=bottom(b);for(const vertex of[vertices[a],lowA,vertices[b],vertices[b],lowA,lowB,lowA,center,lowB])push(vertex,[0,-1,0]);};
      for(let x=0;x<columns-1;x++){side(x+1,x);side((rows-1)*columns+x,(rows-1)*columns+x+1);}
      for(let z=0;z<rows-1;z++){side(z*columns,(z+1)*columns);side((z+1)*columns+columns-1,z*columns+columns-1);}
     }
    }
    meshRanges.push({id:part.id,groupId:identity,start:startVertex,count:mesh.length/6-startVertex,columns,rows});
   }else{
   // Area-weighted surface cells put more samples on steep rock instead of
   // increasing their covariance until they smear across the cliff silhouette.
   // The optional saved choice leaves every earlier generator byte unchanged.
   const cells=[],resolution=96,dx=4.55/resolution,dz=4/resolution;let area=0;
   if(detail>0&&p.surfaceSampling===1){
    const heights=new Float32Array((resolution+1)*(resolution+1));
    for(let z=0;z<=resolution;z++)for(let x=0;x<=resolution;x++)heights[z*(resolution+1)+x]=height(x*dx-2.275,z*dz-.9);
    for(let z=0;z<resolution;z++)for(let x=0;x<resolution;x++){
     const a=heights[z*(resolution+1)+x],b=heights[z*(resolution+1)+x+1],c=heights[(z+1)*(resolution+1)+x],d=heights[(z+1)*(resolution+1)+x+1];
     if(Math.max(a,b,c,d)<-.64)continue;
     const sx=((b-a)+(d-c))/(2*dx),sz=((c-a)+(d-b))/(2*dz);
     area+=dx*dz*Math.hypot(sx,1,sz);cells.push({x:x*dx-2.275,z:z*dz-.9,end:area});
    }
   }
   for(let i=0;i<limit;i++){
    let x,z;
    if(cells.length){
     const target=(i+rand())/Math.max(1,limit)*area;let lo=0,hi=cells.length-1;
     while(lo<hi){const middle=(lo+hi)>>>1;if(cells[middle].end<target)lo=middle+1;else hi=middle;}
     x=cells[lo].x+rand()*dx;z=cells[lo].z+rand()*dz;
    }else{x=rand()*4.55-2.275;z=rand()*4-.9;}
    const y=height(x,z);if(y<-.64)continue;
    const sx=(height(x+.008,z)-height(x-.008,z))/.016,sz=(height(x,z+.008)-height(x,z-.008))/.016,len=Math.hypot(sx,1,sz),normal=[-sx/len,1/len,-sz/len];
    let light=Math.max(0,normal[0]*-.58+normal[1]*.72+normal[2]*-.38),shadow=1;
    for(let j=1;j<=4;j++){const d=j*.07;if(height(x-d*.58,z-d*.38)>y+d*.72+.03)shadow*=.7;}light*=shadow;
    const strata=.78+.22*terrainNoise(x*32+y*23,z*31,p.seed),green=Math.max(0,(normal[1]-.62)*2.4)*(1-Math.min(1,Math.max(0,y-1.1)));
    const seams=1-detail*(.12+.12*Math.sin(y*48+terrainNoise(x*7,z*8,p.seed)*3)),faceLight=light*(1-detail*.16),radius=cells.length?Math.sqrt(area/Math.max(1,limit))*(p.surfelWidth??.68)*(.93+rand()*.14):footprint*Math.sqrt(len)*(.93+rand()*.14)*(1-detail*.24);
    const shade=cells.length?rock.map((v,a)=>(v*(.52+faceLight*.80)+faceLight*[.22,.18,.105][a])*(1-green)+vegetation[a]*green):rock.map((v,a)=>((v+faceLight*[.45,.42,.32][a])*(1-green)+vegetation[a]*green));
    add(x,y,z,radius,shade.map(v=>v*strata*seams),cells.length?radius*.07:footprint*(.22-detail*.10),normal);
   }
   }
  }else if(part.kind==='water'){
   const color=rgb(p.color);
   if(p.surfaceVersion===2&&(p.surfaceDomain??'lake')==='lake'){
    const terrain=scene.parts.find(candidate=>candidate.id===part.terrainId),startVertex=mesh.length/6,origin=world(0,p.level,0),depthFade=(p.depthFade??.6)*p.scale;
    const deep=srgbToLinearRgb(color),shallow=srgbToLinearRgb(rgb(p.shallowColor??'#716b44')),bed=terrain?ground:()=>-Infinity;
    const wave=[...origin,(p.waterFieldEnabled===false?0:p.waveHeight)*p.scale,hash01(p.seed)*Math.PI*2,(p.waveFrequency??.6)/p.scale,(p.waveSpeed??.12)*p.scale,(p.waveDirection??35)*Math.PI/180+angle];
    const renderedBedClip=terrain?.params.surfaceMesh===true?spatialRenderedBedClipper(terrain.params,...Object.values(spatialTerrainMeshDimensions(terrain.params))):null;
    for(const triangle of spatialLakeTriangles(p,world,bed,ground.contains,renderedBedClip))for(const vertex of triangle){
     const pigment=p.surfaceProfile==='depth'?linearRgbToSrgb(rgbLerp(shallow,deep,1-Math.exp(-Math.max(0,origin[1]-bed(vertex[0],vertex[2]))/depthFade))):color;
     mesh.push(...vertex,...pigment);meshNormals.push(0,1,0);meshWind.push(...wave);meshMaterials.push(4);
    }
    meshRanges.push({id:part.id,groupId:identity,start:startVertex,count:mesh.length/6-startVertex});
    waters.push({id:part.id,kind:'lake',surfaceVersion:2,origin,glint:p.glint,meshStart:startVertex,meshCount:mesh.length/6-startVertex,roughness:p.roughness??.16,depthFade,foamStrength:p.foamStrength??.35,choppiness:p.choppiness??.25,domainYaw:angle,bedReliable:!!(terrain?.visible&&terrain.params.surfaceMesh&&terrain.params.opacity>0&&terrain.params.density>0),...(p.surfaceProfile==='depth'?{surfaceProfile:'depth',shallowColor:p.shallowColor??'#716b44'}:{})});
   }else if(p.surfaceMesh===true){
    const terrain=scene.parts.find(candidate=>candidate.id===part.terrainId),channel=terrain.params.channels[p.channelIndex??0];
    // Channel shape is shared source data. Water keeps the same absolute node
    // transform as every other geometry part; grounding alone uses terrain world.
    const points=channel.points,steps=p.channelSteps??16,across=p.acrossSegments??4,width=channel.halfWidth*.92,startVertex=mesh.length/6,origin=world(0,p.level,0),wave=[...origin,(p.surfaceVersion===2&&p.waterFieldEnabled===false?0:p.waveHeight)*p.scale,hash01(p.seed)*Math.PI*2,(p.waveFrequency??.6)/p.scale,(p.waveSpeed??.12)*p.scale,(p.waveDirection??35)*Math.PI/180+angle];
    const depthProfile=p.surfaceProfile==='depth',deep=depthProfile?srgbToLinearRgb(color):null,shallow=depthProfile?srgbToLinearRgb(rgb(p.shallowColor??'#716b44')):null,depthFade=(p.depthFade??.6)*p.scale;
    // The same rendered terrain triangles determine clipping and vertical bed
    // depth. A saved fade distance scales with this water node before framing;
    // metric reframing then scales both distances without changing the pigment.
    // This is depth-dependent opaque pigment, not a refracted bed image.
    const pigment=vertex=>depthProfile?linearRgbToSrgb(rgbLerp(shallow,deep,1-Math.exp(-Math.max(0,origin[1]-ground(vertex[0],vertex[2]))/depthFade))):color;
    const value=vertex=>ground(vertex[0],vertex[2])-origin[1]+p.waveHeight*p.scale;
    const edge=(a,b)=>{let lo=0,hi=1;const sign=value(a)<=0;for(let iteration=0;iteration<20;iteration++){const t=(lo+hi)*.5,point=a.map((v,axis)=>v+(b[axis]-v)*t);if((value(point)<=0)===sign)lo=t;else hi=t;}return a.map((v,axis)=>v+(b[axis]-v)*(lo+hi)*.5);};
    const face=vertices=>{
     const polygon=[];for(let index=0;index<vertices.length;index++){const a=vertices[index],b=vertices[(index+1)%vertices.length],insideA=value(a)<=0,insideB=value(b)<=0;if(insideA)polygon.push(a);if(insideA!==insideB)polygon.push(edge(a,b));}
     for(let at=1;at<polygon.length-1;at++)for(const vertex of[polygon[0],polygon[at],polygon[at+1]]){mesh.push(...vertex,...pigment(vertex));meshNormals.push(0,1,0);meshWind.push(...wave);meshMaterials.push(4);}
    };
    const grid=vertices=>{const rows=vertices.length/(across+1)-1;for(let row=0;row<rows;row++)for(let column=0;column<across;column++){const a=row*(across+1)+column,b=a+1,c=a+across+1,d=c+1;face([vertices[a],vertices[b],vertices[c]]);face([vertices[b],vertices[d],vertices[c]]);}};
    if(channel.smoothing>0){
     // One continuous ribbon uses neighbour tangents at shared spline rows.
     // Subdivisions remain per authored control segment, preserving the budget.
     const path=spatialTerrainChannelPath(channel,steps),vertices=[];
     for(let row=0;row<path.length;row++){const a=path[Math.max(0,row-1)],b=path[Math.min(path.length-1,row+1)],length=Math.max(.000001,Math.hypot(b[0]-a[0],b[1]-a[1])),right=[-(b[1]-a[1])/length,(b[0]-a[0])/length];
      for(let column=0;column<=across;column++){const offset=(column/across*2-1)*width;vertices.push(world(path[row][0]+right[0]*offset,p.level,path[row][1]+right[1]*offset));}}
     grid(vertices);
    }else for(let segment=1;segment<points.length;segment++){
     const a=points[segment-1],b=points[segment],length=Math.hypot(b[0]-a[0],b[1]-a[1]),right=[-(b[1]-a[1])/length,(b[0]-a[0])/length],vertices=[];
     for(let row=0;row<=steps;row++)for(let column=0;column<=across;column++){const t=row/steps,offset=(column/across*2-1)*width;vertices.push(world(a[0]+(b[0]-a[0])*t+right[0]*offset,p.level,a[1]+(b[1]-a[1])*t+right[1]*offset));}
     grid(vertices);
    }
    meshRanges.push({id:part.id,groupId:identity,start:startVertex,count:mesh.length/6-startVertex});
    waters.push({id:part.id,channelId:channel.id,origin,glint:p.glint,meshStart:startVertex,meshCount:mesh.length/6-startVertex,...(depthProfile?{surfaceProfile:'depth',roughness:p.roughness??.22,depthFade,shallowColor:p.shallowColor??'#716b44'}:{}),...(p.surfaceVersion===2?{kind:'river',surfaceVersion:2,roughness:p.roughness??.22,depthFade,foamStrength:p.foamStrength??.35,choppiness:p.choppiness??.25,domainYaw:angle,bedReliable:terrain.visible&&terrain.params.surfaceMesh===true&&terrain.params.opacity>0&&terrain.params.density>0}: {})});
   }else{
   for(let i=0;i<limit;i++){
    const bounds=p.bounds??[-2.2,-1,2.2,2.8],x=rand()*(bounds[2]-bounds[0])+bounds[0],z=rand()*(bounds[3]-bounds[1])+bounds[1],wp=world(x,0,z);if(part.terrainId&&(!ground.contains||ground.contains(wp[0],wp[2]))&&ground(wp[0],wp[2])>p.y+p.level*p.scale+.035)continue;
    const ripple=Math.sin(x*53+z*29+detail*Math.sin(z*11))*Math.sin(z*77+detail*Math.sin(x*6)*1.3),road=Math.exp(-Math.pow((x-.4-z*.2)/.45,2)),glint=Math.pow(Math.max(0,ripple),8)*road*p.glint;
    add(x,p.level+Math.sin(x*11+z*7)*p.waveHeight,z,footprint*(1.3-detail*.18),color.map((v,a)=>v+glint*[.7,.4,.17][a]),footprint*.15);
   }
   }
  }else if(part.kind==='foliage'){
   const omitted=new Set(p.omit),perTree=p.count?Math.floor(limit/p.count):0;
   for(let tree=0;tree<p.count;tree++){
    // Each instance has its own stream as well: omitting tree 3 retains tree 4.
    let n=0;const trand=()=>hash01(randomSeed+tree*104729+(++n));
    let x=trand()*4-2,z=trand()*2.8-.65,wp=world(x,0,z),groundY=ground(wp[0],wp[2]);
    if(detail>0&&Object.hasOwn(p,'slopeLimit')){
     // Every tree owns its placement stream, including rejected candidates.
     // Omission cannot relocate the remaining grove or change its identities.
     let accepted=false;
     for(let attempt=0;attempt<(p.placementAttempts??1);attempt++){
      if(attempt){x=trand()*4-2;z=trand()*2.8-.65;wp=world(x,0,z);groundY=ground(wp[0],wp[2]);}
      const sx=(ground(wp[0]+.015,wp[2])-ground(wp[0]-.015,wp[2]))/.03,sz=(ground(wp[0],wp[2]+.015)-ground(wp[0],wp[2]-.015))/.03;
      if((!ground.contains||ground.contains(wp[0],wp[2]))&&groundY>=p.minElevation&&groundY<=p.maxElevation&&Math.hypot(sx,sz)<=p.slopeLimit){accepted=true;break;}
     }
     if(!accepted)continue;
    }
    if(omitted.has(tree)||(ground.contains&&!ground.contains(wp[0],wp[2]))||groundY<p.minElevation||groundY>p.maxElevation)continue;
    const y=groundY/p.scale,height=p.height+trand()*p.variation,color=rgb(tree%7===0?p.warmColor:p.color);
    for(let i=0;i<perTree;i++){
     if(detail>0){
      // Surface samples describe a trunk and six overlapping branch whorls.
      // Their coherent tier edges survive the small Gaussian sampling budget.
      const theta=trand()*Math.PI*2,trunk=i<Math.max(4,Math.floor(perTree*.12)),tier=i%6,t=trand(),level=.18+tier*.115+t*.18;
      const k=trunk?trand()*.94:Math.min(.99,level),r=trunk?height*.022:height*(.265-tier*.036)*(1-t*.86),sun=.66+Math.max(0,Math.cos(theta+2.4))*.68;
      const normal=trunk?[Math.cos(theta),0,Math.sin(theta)]:[Math.cos(theta)*.42,.9075,Math.sin(theta)*.42];
      const tint=trunk?(p.trunkColor?rgb(p.trunkColor):[.17,.105,.057]):color.map(v=>v*sun*(.90+trand()*.16));
      add(x+Math.cos(theta)*r,y+k*height,z+Math.sin(theta)*r,footprint*(trunk?.19:.29),tint,footprint*.11,normal);
     }else{
      const k=trand(),theta=trand()*Math.PI*2,r=(1-k)*height*(.28+.12*Math.sin(k*25))*Math.sqrt(trand()),sun=.7+Math.max(0,Math.cos(theta+2.4))*.8+trand()*.15;
      add(x+Math.cos(theta)*r,y+k*height,z+Math.sin(theta)*r,footprint*.55,color.map(v=>v*sun));
     }
     phases[phases.length-1]=(identity+tree*104729+i)>>>0;
    }
   }
  }else if(part.kind==='roof'){
   const base=ground(p.groundX??p.x,p.groundZ??p.z)/p.scale,color=rgb(p.color),thickness=detail>0?(p.thickness??0):0;
   for(let i=0;i<limit;i++){
    let x=(rand()-.5)*p.width,z=(rand()-.5)*p.depth;
    const edge=detail>0&&i%5===0,side=thickness>0&&i%4===0,bottom=thickness>0&&i%11===0;
    if(edge||side){if(i%2===0)x=(i%4<2?1:-1)*p.width*.5;else z=(i%4<2?1:-1)*p.depth*.5;}
    const rx=Math.abs(x)/(p.width*.5),rz=Math.abs(z)/(p.depth*.5),r=Math.max(rx,rz),slope=-p.crown+2*p.eave*r,y=base+p.height+p.crown*(1-r)+p.eave*r*r-(side?rand()*thickness:bottom?thickness:edge?rand()*.018:0);
    const sx=rx>=rz?slope*Math.sign(x)/(p.width*.5):0,sz=rz>rx?slope*Math.sign(z)/(p.depth*.5):0,len=Math.hypot(sx,1,sz),normal=side?(rx>=rz?[Math.sign(x),0,0]:[0,0,Math.sign(z)]):bottom?[0,-1,0]:detail>0?[-sx/len,1/len,-sz/len]:[0,1,0];
    const tile=detail>0?.82+.14*Math.max(0,Math.sin((rx>=rz?z:x)*155))+(edge?-.13:0):1;
    const lamp=thickness>0?(side?.62:bottom?.42:.86+Math.max(0,normal[0]*-.58+normal[1]*.72+normal[2]*-.38)*.3):1;
    const radius=thickness>0?Math.sqrt((p.width*p.depth+2*(p.width+p.depth)*thickness)/Math.max(1,limit))*.48:.007*(1-detail*.35);
    add(x,y,z,radius,color.map((v,a)=>(v+rand()*[.2,.18,.05][a])*tile*lamp),thickness>0?radius*.08:.003*(1-detail*.4),normal);
   }
  }else if(part.kind==='column'){
   const base=ground(p.groundX??p.x,p.groundZ??p.z)/p.scale,color=rgb(p.color);
   for(let i=0;i<limit;i++){
    if(detail>0){const theta=rand()*Math.PI*2,y=base+p.baseHeight+(i+rand())/Math.max(1,limit)*p.height,normal=[Math.cos(theta),0,Math.sin(theta)];add(normal[0]*p.radius,y,normal[2]*p.radius,p.radius*.52,color.map(v=>v*(.65+Math.max(0,Math.cos(theta+2.4))*.4)),p.radius*.18,normal);}
    else add(0,base+p.baseHeight+rand()*p.height,0,p.radius,color);
   }
  }else if(part.kind==='waterfall'){
   const color=rgb(p.color),grounded=p.grounded===true,top=grounded&&fields.has(part.terrainId)?(ground(p.x,p.z)-p.y)/p.scale:0;
   const height=grounded?(fields.has(part.terrainId)?top+(p.y-(p.endLevel??-.655))/p.scale:0):p.height;
   if(p.surfaceVersion===2&&height>0){
    const startVertex=mesh.length/6,origin=world(0,top,0),endpoint=world(0,top-height,0),wave=[...origin,(p.waterFieldEnabled===false?0:p.waveHeight??.006)*p.scale,hash01(p.seed)*Math.PI*2,(p.waveFrequency??8)/p.scale,(p.waveSpeed??1.2)*p.scale,(p.waveDirection??90)*Math.PI/180];
    for(const triangle of spatialWaterfallTriangles(p,world,top,height))for(const vertex of triangle){mesh.push(...vertex,...color);meshNormals.push(-sn,0,cs);meshWind.push(...wave);meshMaterials.push(4);}
    meshRanges.push({id:part.id,groupId:identity,start:startVertex,count:mesh.length/6-startVertex});
    const receiver=scene.parts.find(candidate=>candidate.id===p.impactWaterId&&candidate.kind==='water'&&candidate.visible&&candidate.params.density>0&&candidate.params.opacity>0);
    let impactActive=false;
    if(receiver){const r=receiver.params,dx=(endpoint[0]-r.x)/r.scale,dz=(endpoint[2]-r.z)/r.scale,heading=-r.yaw*Math.PI/180,x=dx*Math.cos(heading)-dz*Math.sin(heading),z=dx*Math.sin(heading)+dz*Math.cos(heading),bounds=r.bounds??[-2.2,-1,2.2,2.8],receiverTerrain=scene.parts.find(candidate=>candidate.id===receiver.terrainId),channel=receiverTerrain?.params.channels?.[r.channelIndex??0],receiverBed=fields.get(receiver.terrainId),level=r.y+r.level*r.scale;
     const inside=(r.surfaceDomain==='river'||r.surfaceVersion!==2&&r.surfaceMesh===true)&&channel?spatialTerrainChannelDistance(channel,x,z)<=channel.halfWidth*.92:x>=bounds[0]&&x<=bounds[2]&&z>=bounds[1]&&z<=bounds[3];
     impactActive=inside&&Math.abs(endpoint[1]-level)<=Math.max(.05,p.radius*p.scale)&&(!receiverBed||(!receiverBed.contains||receiverBed.contains(endpoint[0],endpoint[2]))&&receiverBed(endpoint[0],endpoint[2])<level);
    }
    const sprayStart=data.length/14,sprayCount=impactActive?(p.sprayCount??96):0;
    for(let i=0;i<sprayCount;i++){const theta=rand()*Math.PI*2,radius=p.radius*(.3+Math.sqrt(rand())*2.2),lift=rand()*p.radius*2.8;add(Math.cos(theta)*radius,top-height+lift,Math.sin(theta)*radius,.008+rand()*.009,color.map(value=>Math.min(1,value*.35+.65)),.012+rand()*.015);splatMaterials[splatMaterials.length-1]=6;waterSpray.splice(waterSpray.length-8,8,...endpoint,(p.waveSpeed??1.2)*p.scale,hash01(randomSeed+i)*Math.PI*2,p.radius*p.scale,1.4,angle);}
    waters.push({id:part.id,kind:'waterfall',surfaceVersion:2,origin,endpoint,glint:p.glint??.55,roughness:p.roughness??.15,depthFade:p.radius*p.scale,meshStart:startVertex,meshCount:mesh.length/6-startVertex,foamStrength:p.foamStrength??.45,choppiness:0,domainYaw:angle,bedReliable:false,impactWaterId:p.impactWaterId??null,impactActive,sprayStart,sprayCount});
   }else for(let i=0;i<limit&&height>0;i++){
    if(detail>0){const stream=i%9,t=rand(),x=(stream/8-.5)*p.radius*1.7+Math.sin(t*15+stream)*p.radius*.07,z=(rand()-.5)*p.radius*.20;add(x,grounded?top-t*height:-t*p.height,z,.006,color.map(v=>v*(.84+rand()*.26)),.014,[0,0,-1]);}
    else{const theta=rand()*Math.PI*2,t=rand(),r=p.radius*(1/3+rand()*2/3);add(Math.cos(theta)*r,grounded?top-t*height:-t*p.height,Math.sin(theta)*r,.01,color.map(v=>v+rand()*.1),.023);}
   }
  }
  ranges.push({id:part.id,groupId:identity,start,count:data.length/14-start});
 }
 const raw=Float32Array.from(data),cloud=raw.length?packCloud(raw,{name:'Authored Gaussian geometry',provenance:'Executable terrain, water, foliage, pavilion and waterfall generator nodes. Each part has independent source data and transforms.',warnings:[]}):null;
 if(cloud){const bytes=new Uint8Array(Uint32Array.from(groups).buffer);let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));cloud.groups=btoa(binary);}
 if(data.length/14+mesh.length/6>200000)throw new TypeError('Generated geometry exceeds the200,000 sample/triangle vertex budget');
 const meshWaterGlint=new Float32Array(meshMaterials.length);for(const water of waters)meshWaterGlint.fill(water.glint,water.meshStart,water.meshStart+water.meshCount);
 const depthWaters=waters.filter(water=>water.surfaceProfile==='depth'||water.surfaceVersion===2),meshWaterRoughness=depthWaters.length?new Float32Array(meshMaterials.length).fill(-1):null;
 if(meshWaterRoughness)for(const water of depthWaters)meshWaterRoughness.fill(water.roughness,water.meshStart,water.meshStart+water.meshCount);
 const versionedWaters=waters.filter(water=>water.surfaceVersion===2),meshWaterFlags=versionedWaters.length?new Float32Array(meshMaterials.length):null,meshWaterParams=versionedWaters.length?new Float32Array(meshMaterials.length*4):null;
 for(const water of versionedWaters){const params=scene.parts.find(part=>part.id===water.id).params;water.opticsEnabled=params.waterOpticsEnabled!==false;
  if(params.foamVersion===1)water.foam=Object.fromEntries(SPATIAL_WATER_FOAM_FIELDS.map(key=>[key,params[key]]));
  if(params.waterResponseVersion===1)water.response=Object.fromEntries(SPATIAL_WATER_RESPONSE_FIELDS.map(key=>[key,params[key]]));
  for(let vertex=water.meshStart;vertex<water.meshStart+water.meshCount;vertex++){meshWaterFlags[vertex]=water.kind==='waterfall'?4:water.bedReliable&&water.opticsEnabled?3:2;meshWaterParams.set([water.foamStrength,water.choppiness,water.domainYaw,water.depthFade],vertex*4);}}
 return {cloud,raw,phaseIds:Uint32Array.from(phases),ranges,frame:scene.frame,...(meshRanges.length?{mesh:Float32Array.from(mesh),meshRanges}:{}),
  ...(waters.length?{meshWaterGlint}:{}),
  ...(meshWaterRoughness?{meshWaterRoughness}:{}),
  ...(meshWaterFlags?{meshWaterFlags,meshWaterParams,waterSpray:Float32Array.from(waterSpray)}:{}),
  ...(trees.length||scene.parts.some(part=>['rock','groundcover'].includes(part.kind)||part.kind==='water'&&part.params.surfaceMesh===true||part.kind==='waterfall'&&part.params.surfaceVersion===2)?{trees,groundcover,waters,treeWind:Float32Array.from(treeWind),splatMaterials:Uint8Array.from(splatMaterials),meshWind:Float32Array.from(meshWind),meshNormals:Float32Array.from(meshNormals),meshMaterials:Uint8Array.from(meshMaterials)}:{})};
}

/** Fixed source framing avoids translating the remaining scene when a prop is
 * deleted. Empty authoring graphs render an empty scene, never a hidden sample. */
export function geometryFromSpatialScene(scene,budget,cloudFrame=null){
 const generated=createSpatialGeometryScene(scene,budget),metric=cloudFrame?normalizeSpatialCloudFrame(cloudFrame):null;
 const frame=metric?{...generated.frame,origin:metric.origin}:generated.frame,scale=metric?metric.unitScale:2.8/frame.span,center=metric?[0,0,0]:[0,0,3.4];
 const geometry=generated.cloud?geometryFromCloud(generated.cloud,200000,null,{origin:frame.origin,scale,center},metric):{count:0,anchor:new Float32Array(),covariance:new Float32Array(),colors:new Float32Array(),normals:new Float32Array(),uv:new Float32Array(),mobility:new Float32Array(),sourceIds:new Uint32Array(),groups:new Uint32Array(),edges:new Uint32Array(),phaseIds:new Uint32Array(),sourceAspect:16/9,center,baseDistance:3.4,cols:0,rows:0,source:'cloud',raw:generated.raw,provenance:'Empty authored geometry scene',normalization:{origin:frame.origin,scale,center},...(metric?{worldFrame:metric}:{}),ranges:[]};
 if(generated.mesh){geometry.mesh=new Float32Array(generated.mesh);for(let at=0;at<geometry.mesh.length;at+=6)for(let axis=0;axis<3;axis++)geometry.mesh[at+axis]=(geometry.mesh[at+axis]-frame.origin[axis])*scale+center[axis];geometry.meshRanges=generated.meshRanges;}
 if(generated.trees){
  const transformWind=(value,materials=null)=>{const result=new Float32Array(value);for(let at=0;at<result.length;at+=8){for(let axis=0;axis<3;axis++)result[at+axis]=(result[at+axis]-frame.origin[axis])*scale+center[axis];if(materials?.[at/8]===4){result[at+3]*=scale;result[at+5]/=scale;result[at+6]*=scale;}}return result;};
  const transformPoint=value=>value.map((coordinate,axis)=>(coordinate-frame.origin[axis])*scale+center[axis]);
  geometry.treeWind=transformWind(generated.treeWind);geometry.meshWind=transformWind(generated.meshWind,generated.meshMaterials);geometry.meshNormals=generated.meshNormals;geometry.meshMaterials=generated.meshMaterials;geometry.splatMaterials=generated.splatMaterials;
  geometry.groundcover=generated.groundcover.map(patch=>({...patch,entities:patch.entities.map(entity=>({...entity,root:transformPoint(entity.root)}))}));
  geometry.waters=generated.waters.map(water=>({...water,origin:transformPoint(water.origin),...(water.endpoint?{endpoint:transformPoint(water.endpoint)}:{}),...(water.surfaceProfile==='depth'||water.surfaceVersion===2?{depthFade:water.depthFade*scale}:{}),...(water.foam?{foam:{...water.foam,foamDriftX:water.foam.foamDriftX*scale,foamDriftZ:water.foam.foamDriftZ*scale}}:{}),...(water.response?{response:{...water.response,waterClickRadius:water.response.waterClickRadius*scale}}:{})}));
  if(generated.meshWaterGlint)geometry.meshWaterGlint=generated.meshWaterGlint;
  if(generated.meshWaterRoughness)geometry.meshWaterRoughness=generated.meshWaterRoughness;
  if(generated.meshWaterFlags){geometry.meshWaterFlags=generated.meshWaterFlags;geometry.meshWaterParams=new Float32Array(generated.meshWaterParams);for(let at=3;at<geometry.meshWaterParams.length;at+=4)geometry.meshWaterParams[at]*=scale;}
  if(generated.waterSpray){geometry.waterSpray=new Float32Array(generated.waterSpray);for(let at=0;at<geometry.waterSpray.length;at+=8){if(geometry.waterSpray[at+5]<=0)continue;for(let axis=0;axis<3;axis++)geometry.waterSpray[at+axis]=(geometry.waterSpray[at+axis]-frame.origin[axis])*scale+center[axis];geometry.waterSpray[at+3]*=scale;geometry.waterSpray[at+5]*=scale;}}
  geometry.trees=generated.trees.map(tree=>({...tree,entities:tree.entities.map(entity=>({...entity,
   ...(Array.isArray(entity.start)?{start:transformPoint(entity.start)}:{}),...(Array.isArray(entity.end)?{end:transformPoint(entity.end)}:{}),...(entity.radius!=null?{radius:entity.radius*scale}:{})}))}));
 }
 geometry.phaseIds=generated.phaseIds;if(generated.cloud||generated.mesh)geometry.ranges=generated.ranges;return geometry;
}
function terrainNoise(x,z,seed){const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz,u=fx*fx*(3-2*fx),v=fz*fz*(3-2*fz),h=(a,b)=>hash01(a*173+b*7919+seed),a=h(ix,iz)*(1-u)+h(ix+1,iz)*u,b=h(ix,iz+1)*(1-u)+h(ix+1,iz+1)*u;return a*(1-v)+b*v;}
/** Explicit saved terrace rows grade the measured field, with a smooth outer
 * transition. Empty/absent grading leaves every sampled height unchanged. */
function sampleLocalTerrainHeight(p,x,z){
 return spatialTerrainSurfaceHeight(p,x,z);
}
/** Sample the exact rendered [a,c,b]/[b,c,d] triangles, including reduced
 * density and the96-grid bound. Bilinear interpolation is only used to author
 * their vertices; a saddle between four samples is not a bilinear surface. */
function terrainMeshGrid(p){
 const{columns,rows}=spatialTerrainMeshDimensions(p);return spatialTerrainTriangleSampler(p,columns,rows);
}
function terrainField(p){
 if(p.heightfield){
  const angle=-p.yaw*Math.PI/180,cs=Math.cos(angle),sn=Math.sin(angle),grid=p.surfaceMesh===true?terrainMeshGrid(p):null;
  const height=(worldX,worldZ)=>{const dx=(worldX-p.x)/p.scale,dz=(worldZ-p.z)/p.scale,x=dx*cs-dz*sn,z=dx*sn+dz*cs;return p.y+(p.baseHeight+(grid?grid.sample(x,z):sampleLocalTerrainHeight(p,x,z)))*p.scale;};
  if(grid)height.contains=(worldX,worldZ)=>{const dx=(worldX-p.x)/p.scale,dz=(worldZ-p.z)/p.scale,x=dx*cs-dz*sn,z=dx*sn+dz*cs,b=p.heightfield.bounds;return x>=b[0]&&x<=b[2]&&z>=b[1]&&z<=b[3];};
  return height;
 }
 const fbm=(x,z)=>{let total=0,weight=.5;for(let i=0;i<5;i++){total+=terrainNoise(x,z,p.seed)*weight;const nx=x*1.73-z*1.17;x=nx+7.2;z=z*1.73+x*.13+3.4;weight*=.49;}return total;};
 const angle=-p.yaw*Math.PI/180,cs=Math.cos(angle),sn=Math.sin(angle);
 return(worldX,worldZ)=>{const dx=(worldX-p.x)/p.scale,dz=(worldZ-p.z)/p.scale,x=dx*cs-dz*sn,z=dx*sn+dz*cs,warp=(fbm(x*3,z*3)-.5)*.18;let h=p.baseHeight;
  const detail=p.detail??0;
  if(detail>0){let summits=0,highest=0;for(const[px,pz,ph,pw]of p.peaks){const radius=Math.hypot(x-px+warp,z-pz-warp*.5)/pw;const peak=ph*Math.exp(-Math.pow(radius,1.65+detail*.80));summits+=peak;highest=Math.max(highest,peak);}h+=summits*(1-detail*.82)+highest*detail*.82;}
  else for(const[px,pz,ph,pw]of p.peaks){const radius=Math.hypot(x-px+warp,z-pz-warp*.5)/pw;h+=ph*Math.exp(-Math.pow(radius,1.65));}
  h+=((fbm(x*13,z*11)-.5)*.18+Math.sin(x*33+z*21)*.013)*Math.min(1,Math.max(0,(h+.7)*2))*p.erosion;
  if(detail>0){const flutes=Math.sin(x*37+fbm(x*4,z*4)*5)*Math.sin(z*29+fbm(x*2,z*3)*3);h-=detail*Math.max(0,flutes)*.12*Math.min(1,Math.max(0,(h+.65)*2));}
  return p.y+(h+.085*(fbm(x*2.5,z*2.5)-.5))*p.scale;
 };
}
