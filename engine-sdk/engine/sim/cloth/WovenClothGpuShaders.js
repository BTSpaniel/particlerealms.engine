// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Resident yarn ABI. Positions and contact scratch never pass through JS. */
export const WOVEN_GPU_COMMON = /* wgsl */ `
struct Node { p: vec4f, previous: vec4f, velocity: vec4f }
struct Link { ids: vec4u, material: vec4f, flags: vec4u, response: vec4f }
struct Cell { ids: vec4u, edges: vec4u }
struct Params { counts: vec4u, grid: vec4u, motion: vec4f, material: vec4f, command: vec4f, curves:vec4u }
@group(0) @binding(0) var<storage,read_write> nodes: array<Node>;
@group(0) @binding(1) var<storage,read_write> links: array<Link>;
@group(0) @binding(2) var<storage,read> cells: array<Cell>;
@group(0) @binding(3) var<uniform> params: Params;
fn plyCount()->u32 { return params.counts.x/(params.grid.x*params.grid.y*2u); }
fn nodeId(grid:u32,family:u32,ply:u32)->u32 { return (grid*2u+family)*plyCount()+ply; }
fn gridId(node:u32)->u32 { return node/(2u*plyCount()); }
fn yarnFamily(node:u32)->u32 { return (node/plyCount())%2u; }
fn intactLayer(cell:u32,ply:u32)->bool {
  let edges=cells[cell].edges+vec4u(ply);
  return links[edges.x].flags.x==0u && links[edges.y].flags.x==0u && links[edges.z].flags.x==0u && links[edges.w].flags.x==0u;
}
fn liveLayers(cell:u32)->u32 { var count=0u;for(var p=0u;p<plyCount();p++){if(intactLayer(cell,p)){count++;}}return count; }
fn intact(cell:u32)->bool { return liveLayers(cell)>0u; }
fn bundleIntact(link:u32)->bool { for(var p=0u;p<plyCount();p++){if(links[link+p].flags.x==0u){return true;}}return false; }
fn layerPoint(id:u32,p:u32)->vec3f { return .5*(nodes[nodeId(id,0u,p)].p.xyz+nodes[nodeId(id,1u,p)].p.xyz); }
fn midpoint(id:u32)->vec3f { var v=vec3f(0);for(var p=0u;p<plyCount();p++){v+=layerPoint(id,p);}return v/f32(plyCount()); }
fn facePoint(cell:u32,id:u32,old:bool)->vec3f {
  var v=vec3f(0);var count=0.;
  for(var p=0u;p<plyCount();p++){if(!intactLayer(cell,p)){continue;}
    for(var family=0u;family<2u;family++){let n=nodes[nodeId(id,family,p)];v+=select(n.p.xyz,n.previous.xyz,old);count+=1.;}}
  return v/max(count,1.);
}
fn covered(link:u32)->bool {
  let id=gridId(links[link].ids.x);let x=i32(id%params.grid.x);let y=i32(id/params.grid.x);let ply=link%plyCount();
  for(var dy=-1;dy<=0;dy++){for(var dx=-1;dx<=0;dx++){
    let cx=x+dx;let cy=y+dy;if(cx<0||cy<0||cx>=i32(params.grid.x)-1||cy>=i32(params.grid.y)-1){continue;}
    let ci=u32(cy)*(params.grid.x-1u)+u32(cx);if(any(cells[ci].edges+vec4u(ply)==vec4u(link))&&intactLayer(ci,ply)){return true;}
  }}return false;
}
fn unit(v:vec3f, fallback:vec3f) -> vec3f { let l=length(v);return select(fallback,v/max(l,1e-12),l>1e-10); }
fn triangleWeights(p:vec3f,a:vec3f,b:vec3f,c:vec3f) -> vec3f {
  let ab=b-a;let ac=c-a;let ap=p-a;let d1=dot(ab,ap);let d2=dot(ac,ap);
  if(d1<=0. && d2<=0.){return vec3f(1,0,0);}
  let bp=p-b;let d3=dot(ab,bp);let d4=dot(ac,bp);
  if(d3>=0. && d4<=d3){return vec3f(0,1,0);}
  let vc=d1*d4-d3*d2;if(vc<=0. && d1>=0. && d3<=0.){let v=d1/max(d1-d3,1e-20);return vec3f(1.-v,v,0);}
  let cp=p-c;let d5=dot(ab,cp);let d6=dot(ac,cp);
  if(d6>=0. && d5<=d6){return vec3f(0,0,1);}
  let vb=d5*d2-d1*d6;if(vb<=0. && d2>=0. && d6<=0.){let w=d2/max(d2-d6,1e-20);return vec3f(1.-w,0,w);}
  let va=d3*d6-d5*d4;if(va<=0. && d4-d3>=0. && d5-d6>=0.){let w=(d4-d3)/max(d4-d3+d5-d6,1e-20);return vec3f(0,1.-w,w);}
  let sum=va+vb+vc;if(abs(sum)<1e-20){return vec3f(1,0,0);}return vec3f(va,vb,vc)/sum;
}
`;

export const WOVEN_GPU_SOLVER = WOVEN_GPU_COMMON + /* wgsl */ `
struct Delta { x: atomic<i32>, y: atomic<i32>, z: atomic<i32>, count: atomic<u32> }
@group(0) @binding(4) var<storage,read_write> deltas: array<Delta>;
@group(0) @binding(5) var<storage,read_write> receipt: array<atomic<u32>>;
@group(0) @binding(6) var<storage,read> air: array<vec4f>;
@group(0) @binding(7) var<uniform> range: vec4u;
struct Bounds { low:vec4f, high:vec4f }
@group(0) @binding(8) var<storage,read_write> bounds:array<Bounds>;
@group(0) @binding(9) var<storage,read> curves:array<vec2f>;
const SCALE=1000000.;

fn nodeTileCount()->u32{return (arrayLength(&nodes)+63u)/64u;}
fn faceOffset()->u32{return nodeTileCount();}
fn edgeOffset()->u32{return faceOffset()+params.counts.z*2u;}
fn edgeTileOffset()->u32{return edgeOffset()+params.grid.w;}
fn faceCacheOffset()->u32{return edgeTileOffset()+(params.grid.w+63u)/64u;}
fn candidateOffset()->u32{return faceCacheOffset()+params.counts.z*6u+1u;}
fn contactPoint(face:u32,corner:u32,old:bool)->vec3f{
  if(params.command.w>0. && params.command.z>0.){
    let point=bounds[faceCacheOffset()+face*3u+corner];return select(point.high.xyz,point.low.xyz,old);
  }
  let ids=cells[face/2u].ids;let tri=select(ids.xyz,vec3u(ids.x,ids.z,ids.w),face%2u==1u);
  return facePoint(face/2u,tri[corner],old);
}
fn separated(a:Bounds,b:Bounds)->bool{return any(a.low.xyz>b.high.xyz)||any(b.low.xyz>a.high.xyz);}
fn emptyBounds()->Bounds{return Bounds(vec4f(1e30),vec4f(-1e30));}
// Rebuilt before EVERY contact iteration: both swept endpoints participate,
// including corrections from the preceding iteration. No stale motion bounds.
@compute @workgroup_size(64) fn featureBounds(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;
  if(i<params.counts.z*2u){
    var box=emptyBounds();
    if(intact(i/2u)){
      let corners=cells[i/2u].ids;let tri=select(corners.xyz,vec3u(corners.x,corners.z,corners.w),i%2u==1u);
      for(var j=0u;j<3u;j++){let p=facePoint(i/2u,tri[j],false);let old=facePoint(i/2u,tri[j],true);box.low=vec4f(min(box.low.xyz,min(p,old)),0);box.high=vec4f(max(box.high.xyz,max(p,old)),0);
        if(params.command.w>0.){bounds[faceCacheOffset()+i*3u+j]=Bounds(vec4f(old,0),vec4f(p,0));}}
      // Padding protects against opposite rounding in the narrow phase.
      box.low-=vec4f(1e-5);box.high+=vec4f(1e-5);
    }
    bounds[faceOffset()+i]=box;
  }
  if(i<params.grid.w){
    var box=emptyBounds();let link=links[i];
    if(link.flags.x==0u){
      let a=nodes[link.ids.x];let b=nodes[link.ids.y];let radius=vec3f(params.material.z+1e-5);
      box=Bounds(vec4f(min(min(a.p.xyz,a.previous.xyz),min(b.p.xyz,b.previous.xyz))-radius,0),vec4f(max(max(a.p.xyz,a.previous.xyz),max(b.p.xyz,b.previous.xyz))+radius,0));
    }
    bounds[edgeOffset()+i]=box;
  }
}
@compute @workgroup_size(64) fn tileBounds(@builtin(global_invocation_id) gid:vec3u){
  let tile=gid.x;
  if(tile<nodeTileCount()){
    var box=emptyBounds();
    for(var id=tile*64u;id<min((tile+1u)*64u,arrayLength(&nodes));id++){
      let n=nodes[id];if(id>=params.counts.x&&n.p.w==0.){continue;}
      let radius=vec3f(select(params.material.z+.01,n.previous.w+params.material.z,id>=params.counts.x)+1e-5);
      box.low=vec4f(min(box.low.xyz,min(n.p.xyz,n.previous.xyz)-radius),0);box.high=vec4f(max(box.high.xyz,max(n.p.xyz,n.previous.xyz)+radius),0);
    }
    bounds[tile]=box;
  }
  if(tile<(params.grid.w+63u)/64u){
    var box=emptyBounds();
    for(var id=tile*64u;id<min((tile+1u)*64u,params.grid.w);id++){let edge=bounds[edgeOffset()+id];box.low=min(box.low,edge.low);box.high=max(box.high,edge.high);}
    bounds[edgeTileOffset()+tile]=box;
  }
}

@compute @workgroup_size(64) fn integrate(@builtin(global_invocation_id) gid:vec3u) {
  let id=gid.x;if(id>=arrayLength(&nodes)){return;}
  var n=nodes[id];n.previous=vec4f(n.p.xyz,n.previous.w);
  if(n.p.w>0.){
    let h=params.motion.x;
    var v=n.velocity.xyz;
    if(id<params.counts.x && params.motion.w>0.) {
      let d=air[id].xyz-v;
      let blend=1.-exp(-.5*1.225*params.material.w*length(d)*n.p.w*h);
      v+=d*blend;
      n.velocity.w+=length(d*blend)/n.p.w;
    }
    v=(v+vec3f(0,params.motion.y,params.motion.z)*h)*pow(select(.998,params.material.x,id<params.counts.x),h*60.);
    n.p=vec4f(n.p.xyz+v*h,n.p.w);n.velocity=vec4f(v,n.velocity.w+select(0.,h,id>=params.counts.x));
    if(id>=params.counts.x && n.velocity.w>12.){n.p.w=0.;}
  }
  nodes[id]=n;
}
@compute @workgroup_size(64) fn resetLambda(@builtin(global_invocation_id) gid:vec3u) {
  if(gid.x<params.counts.y){links[gid.x].material.z=0.;}
}
@compute @workgroup_size(64) fn distance(@builtin(global_invocation_id) gid:vec3u) {
  if(gid.x>=range.y){return;}let i=range.x+gid.x;var c=links[i];
  if(c.flags.x!=0u){return;}
  if(c.flags.y>=2u && (links[c.ids.z].flags.x!=0u || links[c.ids.w].flags.x!=0u)){links[i].material.z=0.;return;}
  if(c.flags.y==3u && (links[c.flags.z].flags.x!=0u || links[c.flags.w].flags.x!=0u)){links[i].material.z=0.;return;}
  let a=nodes[c.ids.x].p;let b=nodes[c.ids.y].p;let d=b.xyz-a.xyz;let l=length(d);let w=a.w+b.w;
  if(l<1e-7 || w==0.){return;}
  var compliance=c.material.y;
  if(c.flags.y==0u){
    let strain=(l-c.material.x)/c.material.x;
    let weft=yarnFamily(c.ids.x)==1u;let offset=select(0u,params.curves.x,weft);let count=select(params.curves.x,params.curves.y,weft);
    let bounded=clamp(strain,curves[offset].x,curves[offset+count-1u].x);var traction=0.;var slope=0.;
    for(var sample=1u;sample<count;sample++){let a=curves[offset+sample-1u];let b=curves[offset+sample];if(bounded<=b.x){slope=(b.y-a.y)/(b.x-a.x);traction=a.y+(bounded-a.x)*slope;break;}}
    if(abs(bounded)>1e-8&&abs(traction)<1e-12){links[i].material.z=0.;links[i].response=vec4f(c.response.xy,strain,0.);return;}
    // Same secant compliance and SI traction curves as sewing; convert the
    // directional sheet response to this ply's tributary material width.
    compliance=select(c.material.x/(max(slope,1e-12)*c.response.y),c.material.x*bounded/(c.response.y*select(1.,traction,abs(traction)>1e-12)),abs(bounded)>1e-8);
    links[i].response.z=strain;
  }
  let alpha=compliance/(params.motion.x*params.motion.x);
  let change=(-(l-c.material.x)-alpha*c.material.z)/(w+alpha);
  let lambda=c.material.z+change;links[i].material.z=lambda;
  if(c.flags.y==0u){links[i].response.w=max(0.,-lambda)/(params.motion.x*params.motion.x);}
  let correction=d*(change/l);
  nodes[c.ids.x].p=vec4f(a.xyz-correction*a.w,a.w);nodes[c.ids.y].p=vec4f(b.xyz+correction*b.w,b.w);
}
// Failure uses the settled multiplier, not an intermediate colored solve.
// Only this individual ply segment changes topology; adjacent chains retain
// their own capacities, multipliers and remaining connections.
@compute @workgroup_size(64) fn fracture(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;if(i>=params.grid.w){return;}let c=links[i];if(c.flags.x!=0u){return;}
  if(c.response.w>params.material.y*c.response.x && c.response.z>0.){links[i].flags.x=1u;}
}
@compute @workgroup_size(64) fn releaseCrossings(@builtin(global_invocation_id) gid:vec3u) {
  let ply=gid.x%plyCount();let i=gid.x/plyCount();if(i>=params.grid.x*params.grid.y){return;}
  let x=i%params.grid.x;let y=i/params.grid.x;var supported=false;
  for(var dy=-1;dy<=0;dy++){for(var dx=-1;dx<=0;dx++){
    let cx=i32(x)+dx;let cy=i32(y)+dy;
    if(cx>=0 && cy>=0 && cx<i32(params.grid.x)-1 && cy<i32(params.grid.y)-1){supported=supported || intactLayer(u32(cy)*(params.grid.x-1u)+u32(cx),ply);}
  }}
  if(!supported){links[params.grid.z+i*plyCount()+ply].flags.x=1u;}
}
// Nine non-overlapping 3x3 neighborhoods; all normal-defining masses receive
// their reaction, as in the CPU woven constraint (no camera-space offsets).
@compute @workgroup_size(64) fn weave(@builtin(global_invocation_id) gid:vec3u) {
  let ply=gid.x%plyCount();var index=gid.x/plyCount();
  if(params.command.w>0.){
    let column=range.x%3u;let row=range.x/3u;let width=(params.grid.x-column+2u)/3u;
    let x=column+(index%width)*3u;let y=row+(index/width)*3u;if(y>=params.grid.y){return;}index=y*params.grid.x+x;
  }
  if(index>=params.grid.x*params.grid.y){return;}
  let x=index%params.grid.x;let y=index/params.grid.x;
  if((x%3u)+3u*(y%3u)!=range.x || links[params.grid.z+index*plyCount()+ply].flags.x!=0u){return;}
  var ids:array<u32,18>;var g:array<vec3f,18>;var size=0u;
  for(var dy=-1;dy<=1;dy++){for(var dx=-1;dx<=1;dx++){
    let cx=i32(x)+dx;let cy=i32(y)+dy;
    if(cx>=0 && cy>=0 && cx<i32(params.grid.x) && cy<i32(params.grid.y)){
      let base=nodeId(u32(cy)*params.grid.x+u32(cx),0u,ply);ids[size]=base;ids[size+1u]=base+plyCount();size+=2u;
    }
  }}
  var faces:array<u32,4>;var us:array<vec3f,4>;var vs:array<vec3f,4>;var count=0u;var normal=vec3f(0);
  for(var dy=-1;dy<=0;dy++){for(var dx=-1;dx<=0;dx++){
    let cx=i32(x)+dx;let cy=i32(y)+dy;
    if(cx<0 || cy<0 || cx>=i32(params.grid.x)-1 || cy>=i32(params.grid.y)-1){continue;}
    let ci=u32(cy)*(params.grid.x-1u)+u32(cx);if(!intactLayer(ci,ply)){continue;}
    let corners=cells[ci].ids;let u=layerPoint(corners.w,ply)-layerPoint(corners.x,ply);let v=layerPoint(corners.y,ply)-layerPoint(corners.x,ply);
    normal+=cross(u,v);faces[count]=ci;us[count]=u;vs[count]=v;count++;
  }}
  let magnitude=length(normal);if(magnitude<1e-10){return;}normal/=magnitude;
  let d=nodes[nodeId(index,0u,ply)].p.xyz-nodes[nodeId(index,1u,ply)].p.xyz;
  let restProjection=links[params.grid.z+index*plyCount()+ply].material.w;let sign=select(-1.,1.,restProjection>=0.);let projection=dot(d,normal);
  let value=sign*projection-abs(restProjection);if(value>=0.){return;}
  for(var j=0u;j<size;j++){if(ids[j]==nodeId(index,0u,ply)){g[j]+=sign*normal;}if(ids[j]==nodeId(index,1u,ply)){g[j]-=sign*normal;}}
  let derivative=sign*(d-normal*projection)/magnitude;
  for(var f=0u;f<count;f++){
    let corners=cells[faces[f]].ids;let a=cross(vs[f],derivative);let b=cross(derivative,us[f]);
    for(var j=0u;j<size;j++){
      let crossId=gridId(ids[j]);
      if(crossId==corners.x){g[j]-=.5*(a+b);}if(crossId==corners.w){g[j]+=.5*a;}if(crossId==corners.y){g[j]+=.5*b;}
    }
  }
  var denominator=1e-7/(params.motion.x*params.motion.x);
  for(var j=0u;j<size;j++){denominator+=nodes[ids[j]].p.w*dot(g[j],g[j]);}
  let change=-value/denominator;
  for(var j=0u;j<size;j++){let p=nodes[ids[j]].p;nodes[ids[j]].p=vec4f(p.xyz+change*p.w*g[j],p.w);}
}
@compute @workgroup_size(64) fn clearContact(@builtin(global_invocation_id) gid:vec3u){
  if(gid.x==0u){atomicStore(&receipt[0],0u);atomicStore(&receipt[21],0u);}
  if(gid.x>=arrayLength(&deltas)){return;}
  atomicStore(&deltas[gid.x].x,0);atomicStore(&deltas[gid.x].y,0);atomicStore(&deltas[gid.x].z,0);atomicStore(&deltas[gid.x].count,0u);
}
// Compact only swept-box overlaps. Every possible tile/feature pair has a
// reserved slot, so dense folds cannot overflow or silently lose collisions.
@compute @workgroup_size(64) fn contactCandidates(@builtin(global_invocation_id) gid:vec3u){
  let i=gid.x;if(i>=params.curves.z){return;}
  let vertexPairs=nodeTileCount()*params.counts.z*2u;let edge=i>=vertexPairs;
  let pair=select(i,i-vertexPairs,edge);let features=select(params.counts.z*2u,params.grid.w,edge);
  let tile=pair/features;let feature=pair%features;
  if(edge && tile*64u>=feature){return;}
  let a=select(tile,edgeTileOffset()+tile,edge);let b=select(faceOffset()+feature,edgeOffset()+feature,edge);
  if(separated(bounds[a],bounds[b])){return;}
  let index=atomicAdd(&receipt[21],1u);
  bounds[candidateOffset()+index]=Bounds(vec4f(f32(tile),f32(feature),f32(u32(edge)),0),vec4f(0));
}
@compute @workgroup_size(1) fn contactArguments(){
  let count=atomicLoad(&receipt[21]);bounds[candidateOffset()-1u].low=vec4f(f32(count),0,0,0);
  atomicStore(&receipt[21],min(count,256u));atomicStore(&receipt[22],(count+255u)/256u);atomicStore(&receipt[23],1u);
}
fn addDelta(id:u32,v:vec3f){
  if(nodes[id].p.w==0.){return;}
  atomicAdd(&deltas[id].x,i32(round(v.x*SCALE)));atomicAdd(&deltas[id].y,i32(round(v.y*SCALE)));atomicAdd(&deltas[id].z,i32(round(v.z*SCALE)));
  let count=atomicAdd(&deltas[id].count,1u)+1u;atomicMax(&receipt[0],count);
}
fn gridConnected(a:u32,b:u32)->bool {
  let lo=min(a,b);let hi=max(a,b);let x=lo%params.grid.x;let y=lo/params.grid.x;
  if(hi-lo==1u && x+1u<params.grid.x){
    let row=min(y,params.grid.y-2u);let ci=row*(params.grid.x-1u)+x;
    return bundleIntact(cells[ci].edges[select(2u,3u,y==params.grid.y-1u)]);
  }
  if(hi-lo==params.grid.x){
    let col=min(x,params.grid.x-2u);let ci=y*(params.grid.x-1u)+col;
    return bundleIntact(cells[ci].edges[select(0u,1u,x==params.grid.x-1u)]);
  }
  return false;
}
fn nearGrid(a:u32,b:u32)->bool {
  let ax=a%params.grid.x;let ay=a/params.grid.x;let bx=b%params.grid.x;let by=b/params.grid.x;
  let delta=abs(vec2i(i32(ax),i32(ay))-vec2i(i32(bx),i32(by)));
  if(delta.x+delta.y>2){return false;}
  if(a==b){return bundleIntact(params.grid.z+a*plyCount());}
  if(delta.x+delta.y==1){return gridConnected(a,b);}
  if(ax==bx||ay==by){let middle=(a+b)/2u;return gridConnected(a,middle)&&gridConnected(middle,b);}
  let first=ay*params.grid.x+bx;let second=by*params.grid.x+ax;
  return (bundleIntact(params.grid.z+first*plyCount())&&gridConnected(a,first)&&gridConnected(first,b)) || (bundleIntact(params.grid.z+second*plyCount())&&gridConnected(a,second)&&gridConnected(second,b));
}
// Conservative advancement over linear substep trajectories. A relative-speed
// bound prevents fast projectiles and remote folded vertices tunnelling.
fn contactVertexTriangle(vertex:u32,face:u32){
  if(vertex>=arrayLength(&nodes) || face>=params.counts.z*2u){return;}
  if(params.command.z>0. && separated(bounds[vertex/64u],bounds[faceOffset()+face])){return;}
  let ci=face/2u;if(!intact(ci)){return;}
  let corners=cells[ci].ids;let tri=select(corners.xyz,vec3u(corners.x,corners.z,corners.w),face%2u==1u);
  let ball=vertex>=params.counts.x;
  if(ball && nodes[vertex].p.w==0.){return;}
  if(!ball && (nearGrid(gridId(vertex),tri.x)||nearGrid(gridId(vertex),tri.y)||nearGrid(gridId(vertex),tri.z))){return;}
  let a0=contactPoint(face,0u,true);let b0=contactPoint(face,1u,true);let c0=contactPoint(face,2u,true);
  let a1=contactPoint(face,0u,false);let b1=contactPoint(face,1u,false);let c1=contactPoint(face,2u,false);
  let start=nodes[vertex].previous.xyz;let end=nodes[vertex].p.xyz;
  let radius=select(params.material.z+.01,nodes[vertex].previous.w+params.material.z,ball);
  let lo=min(min(min(a0,b0),c0),min(min(a1,b1),c1))-vec3f(radius);
  let hi=max(max(max(a0,b0),c0),max(max(a1,b1),c1))+vec3f(radius);
  if(any(min(start,end)>hi)||any(max(start,end)<lo)){return;}
  let motion=end-start;let speed=max(length(motion-(a1-a0)),max(length(motion-(b1-b0)),length(motion-(c1-c0))));
  var t=0.;var weights=vec3f(1,0,0);var normal=vec3f(0,0,1);var found=false;
  for(var iteration=0u;iteration<32u;iteration++){
    let a=mix(a0,a1,t);let b=mix(b0,b1,t);let c=mix(c0,c1,t);let p=mix(start,end,t);
    weights=triangleWeights(p,a,b,c);let delta=p-(a*weights.x+b*weights.y+c*weights.z);let gap=length(delta);
    normal=unit(delta,unit(cross(b-a,c-a),vec3f(0,0,1)));
    if(gap<=radius+1e-6){found=true;break;}
    if(speed<1e-10){return;}
    t+=(gap-radius)/speed*.9;if(t>1.){return;}
  }
  // A grazing trajectory may converge slowly. Retain its separating plane
  // speculatively instead of dropping an unresolved candidate (tunnelling).
  if(!found){atomicAdd(&receipt[5],1u);}
  let value=radius-dot(end-(a1*weights.x+b1*weights.y+c1*weights.z),normal);if(value<=0.){return;}
  var inverse=nodes[vertex].p.w;let share=1./(2.*f32(liveLayers(ci)));
  for(var j=0u;j<3u;j++){for(var p=0u;p<plyCount();p++){if(!intactLayer(ci,p)){continue;}
    inverse+=share*share*weights[j]*weights[j]*(nodes[nodeId(tri[j],0u,p)].p.w+nodes[nodeId(tri[j],1u,p)].p.w);}}
  if(inverse<=0.){return;}
  let change=normal*((value+1e-7)/inverse);addDelta(vertex,change*nodes[vertex].p.w);
  for(var j=0u;j<3u;j++){for(var p=0u;p<plyCount();p++){if(!intactLayer(ci,p)){continue;}
    for(var family=0u;family<2u;family++){let id=nodeId(tri[j],family,p);addDelta(id,-change*share*weights[j]*nodes[id].p.w);}}}
  atomicAdd(&receipt[select(2u,1u,ball)],1u);
}
fn segmentWeights(a:vec3f,b:vec3f,c:vec3f,d:vec3f)->vec2f{
  let u=b-a;let v=d-c;let r=a-c;let aa=dot(u,u);let bb=dot(u,v);let cc=dot(v,v);let dd=dot(u,r);let ee=dot(v,r);
  var s=0.;var t=0.;let determinant=aa*cc-bb*bb;
  if(determinant>1e-18){s=clamp((bb*ee-cc*dd)/determinant,0.,1.);}
  if(cc>1e-18){t=(bb*s+ee)/cc;}
  if(t<0.){t=0.;s=clamp(-dd/max(aa,1e-18),0.,1.);}else if(t>1.){t=1.;s=clamp((bb-dd)/max(aa,1e-18),0.,1.);}
  return vec2f(s,t);
}
fn contactEdges(li:u32,ri:u32){
  if(li>=params.grid.w || ri>=params.grid.w || li>=ri){return;}
  if(params.command.z>0. && separated(bounds[edgeTileOffset()+li/64u],bounds[edgeOffset()+ri])){return;}
  let l=links[li];let r=links[ri];if(l.flags.y!=0u||r.flags.y!=0u||l.flags.x!=0u||r.flags.x!=0u){return;}
  if(l.ids.x==r.ids.x||l.ids.x==r.ids.y||l.ids.y==r.ids.x||l.ids.y==r.ids.y){return;}
  if(nearGrid(gridId(l.ids.x),gridId(r.ids.x))||nearGrid(gridId(l.ids.x),gridId(r.ids.y))||nearGrid(gridId(l.ids.y),gridId(r.ids.x))||nearGrid(gridId(l.ids.y),gridId(r.ids.y))){return;}
  let a0=nodes[l.ids.x].previous.xyz;let b0=nodes[l.ids.y].previous.xyz;let c0=nodes[r.ids.x].previous.xyz;let d0=nodes[r.ids.y].previous.xyz;
  let a=nodes[l.ids.x].p;let b=nodes[l.ids.y].p;let c=nodes[r.ids.x].p;let d=nodes[r.ids.y].p;let radius=2.*params.material.z;
  if(any(min(min(a0,b0),min(a.xyz,b.xyz))>max(max(c0,d0),max(c.xyz,d.xyz))+vec3f(radius))||any(min(min(c0,d0),min(c.xyz,d.xyz))>max(max(a0,b0),max(a.xyz,b.xyz))+vec3f(radius))){return;}
  let speed=max(max(length((a.xyz-a0)-(c.xyz-c0)),length((a.xyz-a0)-(d.xyz-d0))),max(length((b.xyz-b0)-(c.xyz-c0)),length((b.xyz-b0)-(d.xyz-d0))));
  var t=0.;var weights=vec2f(0);var normal=vec3f(0,0,1);var found=false;
  for(var iter=0u;iter<32u;iter++){
    let at=mix(a0,a.xyz,t);let bt=mix(b0,b.xyz,t);let ct=mix(c0,c.xyz,t);let dt=mix(d0,d.xyz,t);
    weights=segmentWeights(at,bt,ct,dt);let delta=mix(at,bt,weights.x)-mix(ct,dt,weights.y);let gap=length(delta);
    normal=unit(delta,unit(cross(bt-at,dt-ct),vec3f(0,0,1)));
    if(gap<=radius+1e-6){found=true;break;}if(speed<1e-10){return;}t+=(gap-radius)/speed*.9;if(t>1.){return;}
  }
  if(!found){atomicAdd(&receipt[5],1u);}
  let value=radius-dot(mix(a.xyz,b.xyz,weights.x)-mix(c.xyz,d.xyz,weights.y),normal);if(value<=0.){return;}
  let w=vec4f(1.-weights.x,weights.x,weights.y-1.,-weights.y);let inverse=dot(w*w,vec4f(a.w,b.w,c.w,d.w));if(inverse<=0.){return;}
  let change=normal*((value+1e-7)/inverse);
  addDelta(l.ids.x,change*w.x*a.w);addDelta(l.ids.y,change*w.y*b.w);addDelta(r.ids.x,change*w.z*c.w);addDelta(r.ids.y,change*w.w*d.w);atomicAdd(&receipt[2],1u);
}
@compute @workgroup_size(64) fn vertexTriangle(@builtin(global_invocation_id) gid:vec3u){contactVertexTriangle(gid.x,gid.y);}
@compute @workgroup_size(64) fn edgeContact(@builtin(global_invocation_id) gid:vec3u){contactEdges(gid.x,gid.y);}
@compute @workgroup_size(64) fn compactContact(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
  let index=group.x+group.y*256u;if(index>=u32(bounds[candidateOffset()-1u].low.x)){return;}
  let candidate=vec4u(bounds[candidateOffset()+index].low);let id=candidate.x*64u+lane;
  if(candidate.z==0u){contactVertexTriangle(id,candidate.y);}else{contactEdges(id,candidate.y);}
}
// Exposed yarn capsules continue colliding after their sheet cells tear.
@compute @workgroup_size(64) fn sphereYarn(@builtin(global_invocation_id) gid:vec3u){
  let li=gid.x;let id=params.counts.x+gid.y;if(li>=params.grid.w||id>=arrayLength(&nodes)){return;}
  let link=links[li];let sphere=nodes[id];if(link.flags.x!=0u||sphere.p.w==0.||covered(li)){return;}
  let a=nodes[link.ids.x];let b=nodes[link.ids.y];let radius=sphere.previous.w+params.material.z;
  let lo=min(min(a.p.xyz,b.p.xyz),min(a.previous.xyz,b.previous.xyz))-vec3f(radius);
  let hi=max(max(a.p.xyz,b.p.xyz),max(a.previous.xyz,b.previous.xyz))+vec3f(radius);
  if(any(min(sphere.p.xyz,sphere.previous.xyz)>hi)||any(max(sphere.p.xyz,sphere.previous.xyz)<lo)){return;}
  let motion=sphere.p.xyz-sphere.previous.xyz;
  let speed=max(length(motion-(a.p.xyz-a.previous.xyz)),length(motion-(b.p.xyz-b.previous.xyz)));
  var t=0.;var weight=0.;var normal=vec3f(0,0,1);var found=false;
  for(var iteration=0u;iteration<32u;iteration++){
    let at=mix(a.previous.xyz,a.p.xyz,t);let bt=mix(b.previous.xyz,b.p.xyz,t);let p=mix(sphere.previous.xyz,sphere.p.xyz,t);
    let edge=bt-at;weight=clamp(dot(p-at,edge)/max(dot(edge,edge),1e-20),0.,1.);
    let delta=p-mix(at,bt,weight);let gap=length(delta);normal=unit(delta,vec3f(0,0,1));
    if(gap<=radius+1e-6){found=true;break;}if(speed<1e-10){return;}t+=(gap-radius)/speed*.9;if(t>1.){return;}
  }
  if(!found){atomicAdd(&receipt[5],1u);}
  let value=radius-dot(sphere.p.xyz-mix(a.p.xyz,b.p.xyz,weight),normal);if(value<=0.){return;}
  let wa=1.-weight;let inverse=sphere.p.w+wa*wa*a.p.w+weight*weight*b.p.w;
  let change=normal*((value+1e-7)/inverse);
  addDelta(id,change*sphere.p.w);addDelta(link.ids.x,-change*wa*a.p.w);addDelta(link.ids.y,-change*weight*b.p.w);atomicAdd(&receipt[1],1u);
}
@compute @workgroup_size(64) fn spherePairs(@builtin(global_invocation_id) gid:vec3u){
  let ai=params.counts.x+gid.x;let bi=params.counts.x+gid.y;if(ai>=bi||bi>=arrayLength(&nodes)){return;}
  let a=nodes[ai];let b=nodes[bi];if(a.p.w==0.||b.p.w==0.){return;}
  let start=a.previous.xyz-b.previous.xyz;let end=a.p.xyz-b.p.xyz;let motion=end-start;let radius=a.previous.w+b.previous.w;
  let cc=dot(start,start)-radius*radius;var t=0.;
  if(cc>0.){let aa=dot(motion,motion);let bb=dot(start,motion);let disc=bb*bb-aa*cc;if(aa<1e-20||bb>=0.||disc<0.){return;}t=(-bb-sqrt(disc))/aa;if(t>1.){return;}}
  let normal=unit(start+motion*t,vec3f(1,0,0));let value=radius-dot(end,normal);if(value<=0.){return;}
  let change=normal*(value/(a.p.w+b.p.w));addDelta(ai,change*a.p.w);addDelta(bi,-change*b.p.w);atomicAdd(&receipt[1],1u);
}
@compute @workgroup_size(64) fn applyContact(@builtin(global_invocation_id) gid:vec3u){
  let id=gid.x;if(id>=arrayLength(&nodes)){return;}
  let d=vec3f(f32(atomicLoad(&deltas[id].x)),f32(atomicLoad(&deltas[id].y)),f32(atomicLoad(&deltas[id].z)));
  let p=nodes[id].p;let correction=d/(SCALE*f32(max(1u,atomicLoad(&receipt[0]))));nodes[id].p=vec4f(p.xyz+correction,p.w);
  if(id>=params.counts.x && p.w>0.){atomicAdd(&receipt[15],u32(round(length(correction)/(params.motion.x*p.w)*100000.)));}
}
@compute @workgroup_size(64) fn finish(@builtin(global_invocation_id) gid:vec3u){
  let id=gid.x;if(id>=arrayLength(&nodes)){return;}
  var n=nodes[id];if(n.p.w==0.){return;}
  let floor=select(params.material.z,n.previous.w,id>=params.counts.x);
  var velocity=(n.p.xyz-n.previous.xyz)/params.motion.x;
  if(n.p.y<floor){
    n.p.y=floor;
    velocity.y=select(max(0.,velocity.y),max(0.,-velocity.y*.35),id>=params.counts.x);
    velocity.x*=.96;velocity.z*=.96;
  }
  n.velocity=vec4f(velocity,n.velocity.w);nodes[id]=n;
  // Exponent bits detect both infinities and NaNs; comparisons miss NaNs.
  if(any((bitcast<vec3u>(n.p.xyz)&vec3u(0x7f800000u))==vec3u(0x7f800000u)) || any((bitcast<vec3u>(n.velocity.xyz)&vec3u(0x7f800000u))==vec3u(0x7f800000u)) || any(abs(n.p.xyz)>vec3f(10000.)) || any(abs(n.velocity.xyz)>vec3f(10000.))){atomicStore(&receipt[6],1u);}
}
@compute @workgroup_size(64) fn edit(@builtin(global_invocation_id) gid:vec3u){
  let id=gid.x;
  if(params.command.x==1. && id<params.counts.x){nodes[id].p.w=params.command.y;}
  if(params.command.x==2. && id<params.counts.y && links[id].flags.y==0u){
    let centre=midpoint(params.grid.x*(params.grid.y/2u)+params.grid.x/2u);let c=links[id];
    let a=nodes[c.ids.x].p.xyz;let b=nodes[c.ids.y].p.xyz;let d=b-a;let t=clamp(dot(centre-a,d)/max(dot(d,d),1e-15),0.,1.);
    if(length(centre-a-t*d)<params.command.y){links[id].flags.x=1u;}
  }
}
// One workgroup reduces diagnostics in parallel; no extra storage binding or
// position readback. The serial mode remains available for equivalence checks.
var<workgroup> summaryCounts:array<vec4u,192>;
var<workgroup> summaryValues:array<vec4f,128>;
@compute @workgroup_size(64) fn summarize(@builtin(local_invocation_index) lane:u32){
  let stride=select(1u,64u,params.command.w>0.);
  let first=select(select(0xffffffffu,0u,lane==0u),lane,params.command.w>0.);
  var broken=0u;var panels=0u;var balls=0u;var speed=0.;var liveEdges=0u;var exposed=0u;var released=0u;var airSpeed=0.;var force=0.;var warpStrain=0.;var weftStrain=0.;var partial=0u;var fastSegments=0u;var fastExposed=0u;var airImpulse=0.;
  for(var i=first;i<params.counts.y;i+=stride){
    if(links[i].flags.y==0u){if(links[i].flags.x!=0u){broken++;}else{liveEdges++;if(!covered(i)){exposed++;}}force=max(force,links[i].response.w);if(links[i].flags.x==0u){if(yarnFamily(links[i].ids.x)==0u){warpStrain=max(warpStrain,links[i].response.z);}else{weftStrain=max(weftStrain,links[i].response.z);}}}
    if(links[i].flags.y==1u && links[i].flags.x!=0u){released++;}
  }
  for(var bundle=first;bundle<params.grid.w/plyCount();bundle+=stride){
    let i=bundle*plyCount();
    var count=0u;var visible=0u;var attached=true;for(var p=0u;p<plyCount();p++){let edge=links[i+p];if(edge.flags.x!=0u){count++;}else if(!covered(i+p)){visible++;}if(links[edge.flags.z].flags.x!=0u||links[edge.flags.w].flags.x!=0u){attached=false;}}
    if(count>0u&&count<plyCount()){partial++;}fastSegments+=select(plyCount()-count,1u,count==0u&&attached);
    fastExposed+=select(visible,1u,count==0u&&attached&&visible==plyCount());
  }
  for(var i=first;i<params.counts.x;i+=stride){airSpeed=max(airSpeed,length(air[i].xyz));airImpulse+=nodes[i].velocity.w;}
  for(var i=first;i<params.counts.z;i+=stride){if(intact(i)){panels++;}}
  for(var slot=first;slot<params.counts.w;slot+=stride){let i=params.counts.x+slot;if(nodes[i].p.w>0.){balls++;speed=max(speed,length(nodes[i].velocity.xyz));}}
  summaryCounts[lane]=vec4u(broken,panels,balls,liveEdges);
  summaryCounts[64u+lane]=vec4u(exposed,released,partial,fastSegments);
  summaryCounts[128u+lane]=vec4u(fastExposed,0,0,0);
  summaryValues[lane]=vec4f(speed,airSpeed,force,warpStrain);
  summaryValues[64u+lane]=vec4f(weftStrain,airImpulse,0,0);
  workgroupBarrier();
  for(var width=32u;width>0u;width/=2u){
    if(lane<width){
      for(var part=0u;part<3u;part++){summaryCounts[part*64u+lane]+=summaryCounts[part*64u+lane+width];}
      summaryValues[lane]=max(summaryValues[lane],summaryValues[lane+width]);
      let a=summaryValues[64u+lane];let b=summaryValues[64u+lane+width];summaryValues[64u+lane]=vec4f(max(a.x,b.x),a.y+b.y,0,0);
    }workgroupBarrier();
  }
  if(lane!=0u){return;}
  let counts=summaryCounts[0];broken=counts.x;panels=counts.y;balls=counts.z;liveEdges=counts.w;
  let more=summaryCounts[64];exposed=more.x;released=more.y;partial=more.z;fastSegments=more.w;fastExposed=summaryCounts[128].x;
  let values=summaryValues[0];speed=values.x;airSpeed=values.y;force=values.z;warpStrain=values.w;
  weftStrain=summaryValues[64].x;airImpulse=summaryValues[64].y;
  atomicStore(&receipt[19],fastSegments);atomicStore(&receipt[20],fastExposed);
  atomicStore(&receipt[16],bitcast<u32>(warpStrain));atomicStore(&receipt[17],bitcast<u32>(weftStrain));atomicStore(&receipt[18],partial);
  atomicStore(&receipt[14],bitcast<u32>(airImpulse));
  atomicStore(&receipt[3],broken);atomicStore(&receipt[4],panels);atomicStore(&receipt[7],balls);atomicStore(&receipt[8],bitcast<u32>(speed));
  atomicStore(&receipt[9],bitcast<u32>(airSpeed));atomicStore(&receipt[10],liveEdges);atomicStore(&receipt[11],exposed);atomicStore(&receipt[12],released);atomicStore(&receipt[13],bitcast<u32>(force));
}
`;
