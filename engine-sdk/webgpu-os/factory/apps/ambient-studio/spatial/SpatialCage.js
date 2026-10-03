// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Browser ESM conversion of the supplied Ambient Studio depth reconstruction source.
 * Numeric algorithms and data contracts retain their original implementation. */
/* Coarse, component-aware deformation graph, bound to detailed source splats.
 * The constraint solve uses XPBD distance constraints (compliance / dt² and
 * accumulated multipliers). Pooling/binding and the existing final hard stretch
 * limiter are engineering additions, NOT a reproduction of ARAP-L or Frosting.
 */
function buildCage(g,spacing=8,joinPaintedRegion=false){
 if(!g.cols||!g.rows)return null;spacing=Math.max(2,Math.min(24,Math.round(spacing)));
 const parent=Uint32Array.from({length:g.count},(_,i)=>i),find=i=>{let j=i;while(parent[j]!==j)j=parent[j];while(parent[i]!==i){let k=parent[i];parent[i]=j;i=k;}return j;};
 // An explicit foreground mask is an author-declared object region. Its cage may
 // span a steep depth boundary INSIDE that region, but never cross into pinned
 // background. Keep the detailed surface's original depth edges unchanged.
 const links=Array.from(g.edges);
 if(joinPaintedRegion){for(let i=0;i<g.count;i++){if(g.mobility[i]<=.0001)continue;const x=i%g.cols,y=Math.floor(i/g.cols);for(const j of [x+1<g.cols?i+1:-1,y+1<g.rows?i+g.cols:-1])if(j>=0&&g.mobility[j]>.0001)links.push(i,j);}}
 for(let e=0;e<links.length;e+=2){const a=find(links[e]),b=find(links[e+1]);if(a!==b)parent[b]=a;}
 const nodes=[],lookup=new Map(),owner=new Uint32Array(g.count),groups=new Uint32Array(g.count),key=(c,x,y)=>c+':'+x+':'+y;
 for(let i=0;i<g.count;i++){const c=groups[i]=find(i),x=i%g.cols,y=Math.floor(i/g.cols),bx=Math.floor(x/spacing),by=Math.floor(y/spacing),k=key(c,bx,by);let n=lookup.get(k);if(n===undefined){n=nodes.length;lookup.set(k,n);nodes.push({rest:[0,0,0],cx:0,cy:0,count:0,mobility:0,pinned:false,c,bx,by});}owner[i]=n;const node=nodes[n];for(let a=0;a<3;a++)node.rest[a]+=g.anchor[i*3+a];node.cx+=x;node.cy+=y;node.count++;node.mobility+=g.mobility[i];if(g.mobility[i]<.0001)node.pinned=true;}
 for(const n of nodes){for(let a=0;a<3;a++)n.rest[a]/=n.count;n.cx/=n.count;n.cy/=n.count;n.invMass=n.pinned?0:n.mobility/n.count;}
 const seen=new Set(),edges=[],rest=[];for(let e=0;e<links.length;e+=2){let a=owner[links[e]],b=owner[links[e+1]];if(a===b)continue;if(a>b)[a,b]=[b,a];const k=a+':'+b;if(seen.has(k))continue;seen.add(k);edges.push(a,b);rest.push(Math.hypot(...nodes[a].rest.map((v,i)=>v-nodes[b].rest[i])));}
 const ids=new Uint32Array(g.count*4),weights=new Float32Array(g.count*4);
 for(let i=0;i<g.count;i++){const node=nodes[owner[i]],x=i%g.cols,y=Math.floor(i/g.cols),candidates=[];for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++){const n=lookup.get(key(node.c,node.bx+a,node.by+b));if(n===undefined)continue;const d=(x-nodes[n].cx)**2+(y-nodes[n].cy)**2;candidates.push([n,d]);}candidates.sort((a,b)=>a[1]-b[1]);let sum=0;for(let j=0;j<4;j++){const c=candidates[j]??[owner[i],Infinity],w=Number.isFinite(c[1])?1/(c[1]+spacing*spacing*.09):0;ids[i*4+j]=c[0];weights[i*4+j]=w;sum+=w;}for(let j=0;j<4;j++)weights[i*4+j]/=sum;}
 return{nodes,spacing,joinPaintedRegion,owner,ids,weights,edges:Uint32Array.from(edges),rest:Float64Array.from(rest),lambda:new Float64Array(rest.length),offset:new Float64Array(nodes.length*3),previous:new Float32Array(g.count*3)};
}
function solveDistance(pos,ia,ib,ra,rb,rest,ma,mb,compliance,dt,lambda){
 const a=ia*3,b=ib*3,dx=rb[0]+pos[b]-ra[0]-pos[a],dy=rb[1]+pos[b+1]-ra[1]-pos[a+1],dz=rb[2]+pos[b+2]-ra[2]-pos[a+2],length=Math.hypot(dx,dy,dz);
 if(length<1e-10||ma+mb===0)return lambda;const alpha=compliance/(dt*dt),dl=(-(length-rest)-alpha*lambda)/(ma+mb+alpha);for(let k=0;k<3;k++){const v=[dx,dy,dz][k]/length;pos[a+k]-=ma*dl*v;pos[b+k]+=mb*dl*v;}return lambda+dl;
}
function projectCage(phy,s,dt){
 if(!s.cageEnabled||!['fabric','ripple'].includes(s.mode)||s.sequence||!phy.geometry.cols||dt<=0)return null;
 const g=phy.geometry;if(!phy.cage||phy.cage.spacing!==Math.round(s.cageSpacing)||phy.cage.joinPaintedRegion!==s.isolateMask)phy.cage=buildCage(g,s.cageSpacing,s.isolateMask);const c=phy.cage;if(!c)return null;c.previous.set(phy.offset);c.offset.fill(0);c.lambda.fill(0);
 for(let i=0;i<g.count;i++){const node=c.nodes[c.owner[i]],k=c.owner[i]*3;if(!node.invMass)continue;for(let a=0;a<3;a++)c.offset[k+a]+=phy.offset[i*3+a]/node.count;}
 const h=Math.min(.1,Math.max(1e-4,dt));for(let it=0;it<Math.max(4,s.strainIterations*2);it++)for(let e=0;e<c.rest.length;e++){const a=c.edges[e*2],b=c.edges[e*2+1],A=c.nodes[a],B=c.nodes[b];c.lambda[e]=solveDistance(c.offset,a,b,A.rest,B.rest,c.rest[e],A.invMass,B.invMass,s.cageCompliance,h,c.lambda[e]);}
 for(let i=0;i<g.count;i++){const k=i*3;if(g.mobility[i]<.0001){phy.offset[k]=phy.offset[k+1]=phy.offset[k+2]=0;phy.velocity[k]=phy.velocity[k+1]=phy.velocity[k+2]=0;continue;}for(let a=0;a<3;a++){let v=0;for(let j=0;j<4;j++)v+=c.offset[c.ids[i*4+j]*3+a]*c.weights[i*4+j];const newOffset=phy.offset[k+a]+(v-phy.offset[k+a])*s.cageStrength;phy.velocity[k+a]=Math.max(-8,Math.min(8,phy.velocity[k+a]+(newOffset-phy.offset[k+a])/h*.3));phy.offset[k+a]=newOffset;}}
 return{nodes:c.nodes.length,edges:c.rest.length,method:'XPBD coarse distance graph + local Gaussian binding'};
}
export {buildCage,solveDistance,projectCage};
