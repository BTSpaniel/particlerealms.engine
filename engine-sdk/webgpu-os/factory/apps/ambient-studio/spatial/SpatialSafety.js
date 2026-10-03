// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Browser ESM conversion of the supplied Ambient Studio depth reconstruction source.
 * Numeric algorithms and data contracts retain their original implementation. */
/** Original, bounded surface safeguards. Not an implementation of ARAP-L,
 * Toon3D, learned inpainting, or XPBD. The position stage uses inequality
 * projections; the footprint stage bounds principal stretch in the rest metric.
 * This deliberately separates missing-content treatment from geometric strain. */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function connectedDepth(z0,z1,pixelStep,settings) {
  const globalLimit=settings.edge*settings.depth;
  const limit=settings.surfaceSafety?Math.min(globalLimit,Math.max(1e-6,pixelStep)*settings.depthSlope):globalLimit;
  return Math.abs(z1-z0)<limit;
}
/** Compute the singular stretches of a 3x2 surface deformation relative to its
 * non-orthogonal rest tangents, then bound them without replacing its rotation.
 * Writes [a.xyz,b.xyz] into reusable out, returns [rawMax,rawMin,wasClamped]. */
function boundedDifferential(a,b,ra,rb,maxStretch=1.45,minStretch=.65,out=new Float64Array(6)) {
  const l=Math.hypot(ra[0],ra[1],ra[2]);
  if(l<1e-12){out.set(ra,0);out.set(rb,3);return[1,1,false];}
  const r01=(ra[0]*rb[0]+ra[1]*rb[1]+ra[2]*rb[2])/l;
  const r11=Math.sqrt(Math.max(0,rb[0]**2+rb[1]**2+rb[2]**2-r01*r01));
  if(r11<1e-12){out.set(ra,0);out.set(rb,3);return[1,1,false];}
  const f0=a[0]/l,f1=a[1]/l,f2=a[2]/l;
  const g0=(b[0]-f0*r01)/r11,g1=(b[1]-f1*r01)/r11,g2=(b[2]-f2*r01)/r11;
  const aa=f0*f0+f1*f1+f2*f2,ab=f0*g0+f1*g1+f2*g2,bb=g0*g0+g1*g1+g2*g2;
  const mid=(aa+bb)*.5,disc=Math.hypot((aa-bb)*.5,ab),hi=Math.sqrt(Math.max(0,mid+disc)),lo=Math.sqrt(Math.max(0,mid-disc));
  if(!Number.isFinite(hi)||lo<1e-7){out.set(ra,0);out.set(rb,3);return[hi,lo,true];}
  if(hi<=maxStretch&&lo>=minStretch){out.set(a,0);out.set(b,3);return[hi,lo,false];}
  const angle=.5*Math.atan2(2*ab,aa-bb),c=Math.cos(angle),s=Math.sin(angle),r0=clamp(hi,minStretch,maxStretch)/hi,r1=clamp(lo,minStretch,maxStretch)/lo;
  const h00=r0*c*c+r1*s*s,h01=(r0-r1)*c*s,h11=r0*s*s+r1*c*c;
  const A=[f0*h00+g0*h01,f1*h00+g1*h01,f2*h00+g2*h01];
  const B=[f0*h01+g0*h11,f1*h01+g1*h11,f2*h01+g2*h11];
  for(let j=0;j<3;j++){out[j]=A[j]*l;out[j+3]=A[j]*r01+B[j]*r11;}
  return[hi,lo,true];
}
/** Local upper-stretch constraints on centers, not just larger splats. Keeps
 * pinned points fixed, preserves canonical anchors, and removes separating
 * velocity along active constraints. Finite sweeps leave a reported residual.
 * Detached/shatter modes intentionally do not share this surface constraint. */
function projectStrain(physics,settings,dt) {
  const g=physics.geometry,A=physics.anchors,O=physics.offset,V=physics.velocity,E=g.edges,M=g.mobility;
  if(!settings.surfaceSafety||!g.cols||settings.sequence||!['fabric','ripple'].includes(settings.mode)||dt<=0)return 0;
  const limit=settings.maxStretch,iterations=Math.round(settings.strainIterations??5);let corrected=0;
  for(let pass=0;pass<iterations;pass++){
    const reverse=pass&1;
    for(let q=0;q<E.length;q+=2){const e=reverse?E.length-2-q:q,i=E[e],j=E[e+1],a=i*3,b=j*3,w=M[i]+M[j];if(w<=1e-8)continue;
      const rx=A[b]-A[a],ry=A[b+1]-A[a+1],rz=A[b+2]-A[a+2],rest=Math.hypot(rx,ry,rz);if(rest<1e-8)continue;
      const dx=rx+O[b]-O[a],dy=ry+O[b+1]-O[a+1],dz=rz+O[b+2]-O[a+2],len=Math.hypot(dx,dy,dz),maximum=rest*limit;
      if(len<=maximum)continue;const k=(len-maximum)/(len*w),di=[dx*k,dy*k,dz*k];
      for(let axis=0;axis<3;axis++){O[a+axis]+=di[axis]*M[i];O[b+axis]-=di[axis]*M[j];}
      const separating=((V[b]-V[a])*dx+(V[b+1]-V[a+1])*dy+(V[b+2]-V[a+2])*dz)/(len*len*w);
      if(separating>0)for(let axis=0;axis<3;axis++){const n=[dx,dy,dz][axis]*separating;V[a+axis]+=n*M[i];V[b+axis]-=n*M[j];}
      corrected++;
    }
  }
  // Finite local sweeps are not a hard guarantee. If a drag is still infeasible,
  // apply an analytic per-connected-piece trust region rather than allow it to
  // tear indefinitely. This scales only the affected material component, not
  // every wallpaper or the camera. The exact edge root is recomputed each frame.
  if(!physics.components){const parent=new Uint32Array(g.count);for(let i=0;i<g.count;i++)parent[i]=i;
    const root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
    for(let e=0;e<E.length;e+=2){const a=root(E[e]),b=root(E[e+1]);if(a!==b)parent[b]=a;}
    for(let i=0;i<g.count;i++)parent[i]=root(i);physics.components=parent;physics.componentFactors=new Float64Array(g.count);}
  const factors=physics.componentFactors,component=physics.components;factors.fill(1);
  for(let e=0;e<E.length;e+=2){const i=E[e],j=E[e+1],a=i*3,b=j*3;
    const rx=A[b]-A[a],ry=A[b+1]-A[a+1],rz=A[b+2]-A[a+2],dx=O[b]-O[a],dy=O[b+1]-O[a+1],dz=O[b+2]-O[a+2];
    const aa=dx*dx+dy*dy+dz*dz,bb=2*(rx*dx+ry*dy+rz*dz),cc=(1-limit*limit)*(rx*rx+ry*ry+rz*rz);
    if(aa<1e-18||aa+bb+cc<=1e-12)continue;
    const disc=Math.sqrt(Math.max(0,bb*bb-4*aa*cc));
    const t=bb>=0?(-2*cc)/(bb+disc):(-bb+disc)/(2*aa);
    factors[component[i]]=Math.min(factors[component[i]],Math.max(0,t*(1-1e-6)));
  }
  physics.strainFallbackFactor=1;
  for(let i=0;i<g.count;i++){const scale=factors[component[i]];physics.strainFallbackFactor=Math.min(physics.strainFallbackFactor,scale);if(scale>=1)continue;const a=i*3;for(let k=0;k<3;k++){O[a+k]*=scale;V[a+k]*=scale;}}
  return corrected;
}
function strainSummary(physics) {
  const A=physics.anchors,O=physics.offset,E=physics.geometry.edges;let max=1,sum=0;
  for(let e=0;e<E.length;e+=2){const a=E[e]*3,b=E[e+1]*3,rx=A[b]-A[a],ry=A[b+1]-A[a+1],rz=A[b+2]-A[a+2],l=Math.hypot(rx,ry,rz);if(l<1e-8)continue;const r=Math.hypot(rx+O[b]-O[a],ry+O[b+1]-O[a+1],rz+O[b+2]-O[a+2])/l;max=Math.max(max,r);sum+=r;}
  return{maxEdgeStretch:max,meanEdgeStretch:E.length?sum/(E.length/2):1};
}
export {connectedDepth,boundedDifferential,projectStrain,strainSummary};
