// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Browser ESM conversion of the supplied Ambient Studio depth reconstruction source.
 * Numeric algorithms and data contracts retain their original implementation. */
/** Real spherical-harmonic basis through degree 3, in the standard 3DGS order.
 * Mathematical basis convention checked against the authors' sh_utils.py.
 * Coefficients retain view-dependent appearance, rather than baking every view
 * to its DC color. See THIRD-PARTY-NOTICES.md for the basis reference/license.
 */
import { decodeFloats,encodeFloats,unpackCloud } from "./SpatialCore.js";
function shBasis(direction,degree=3){
 const l=Math.hypot(...direction)||1,[x,y,z]=direction.map(v=>v/l),xx=x*x,yy=y*y,zz=z*z;
 const a=[.28209479177387814,-.4886025119029199*y,.4886025119029199*z,-.4886025119029199*x,
  1.0925484305920792*x*y,-1.0925484305920792*y*z,.31539156525252005*(2*zz-xx-yy),-1.0925484305920792*x*z,.5462742152960396*(xx-yy),
  -.5900435899266435*y*(3*xx-yy),2.890611442640554*x*y*z,-.4570457994644658*y*(4*zz-xx-yy),.3731763325901154*z*(2*zz-3*xx-3*yy),-.4570457994644658*x*(4*zz-xx-yy),1.445305721320277*z*(xx-yy),-.5900435899266435*x*(xx-3*yy)];
 return a.slice(0,(degree+1)**2);
}
function evaluateSH(coefficients,degree,direction){const b=shBasis(direction,degree),color=[.5,.5,.5];for(let i=0;i<b.length;i++)for(let c=0;c<3;c++)color[c]+=b[i]*coefficients[i*3+c];return color;}
function cloudSH(cloud,degree=cloud.sphericalHarmonics?.degree??0){
 const width=(degree+1)**2*3,out=new Float32Array(cloud.count*width);
 if(cloud.sphericalHarmonics){const oldDegree=cloud.sphericalHarmonics.degree,oldWidth=(oldDegree+1)**2*3,values=decodeFloats(cloud.sphericalHarmonics.data,cloud.count*oldWidth);for(let i=0;i<cloud.count;i++)out.set(values.subarray(i*oldWidth,i*oldWidth+Math.min(oldWidth,width)),i*width);}
 else{const a=unpackCloud(cloud);for(let i=0;i<cloud.count;i++)for(let c=0;c<3;c++)out[i*width+c]=(a[i*14+10+c]-.5)/.28209479177387814;}
 return out;
}
/** Rotate a radiance field together with a registered geometric scene.
 * A small double-precision change-of-basis solve is done once per transform.
 * Rotation is band diagonal; per-splat work uses only nonzero band terms. */
function shYawMatrix(degree,yaw){
 if(!Number.isInteger(degree)||degree<0||degree>3||!Number.isFinite(yaw))throw new TypeError('Invalid SH rotation.');
 const n=(degree+1)**2,gram=Array.from({length:n},()=>new Float64Array(n)),cross=Array.from({length:n},()=>new Float64Array(n)),angle=yaw*Math.PI/180,co=Math.cos(angle),si=Math.sin(angle),samples=96;
 for(let i=0;i<samples;i++){const z=1-2*(i+.5)/samples,r=Math.sqrt(Math.max(0,1-z*z)),theta=i*2.399963229728653,x=r*Math.cos(theta),y=r*Math.sin(theta),a=shBasis([x,y,z],degree),b=shBasis([co*x-si*z,y,si*x+co*z],degree);for(let k=0;k<n;k++)for(let j=0;j<n;j++){gram[k][j]+=a[k]*a[j];cross[k][j]+=a[k]*b[j];}}
 const m=gram.map((row,i)=>Float64Array.from([...row,...cross[i]]));
 for(let i=0;i<n;i++){let pivot=i;for(let j=i+1;j<n;j++)if(Math.abs(m[j][i])>Math.abs(m[pivot][i]))pivot=j;[m[i],m[pivot]]=[m[pivot],m[i]];const d=m[i][i];if(Math.abs(d)<1e-10)throw new Error('Degenerate SH rotation solve.');for(let j=0;j<2*n;j++)m[i][j]/=d;for(let k=0;k<n;k++)if(k!==i){const f=m[k][i];for(let j=0;j<2*n;j++)m[k][j]-=m[i][j]*f;}}
 return m.map(row=>Array.from(row.subarray(n)).map(v=>Math.abs(v)<1e-10?0:v));
}
function rotateSHYaw(coefficients,degree,yaw){if(Math.abs(yaw%360)<1e-10)return new Float32Array(coefficients);const n=(degree+1)**2,stride=n*3;if(coefficients.length%stride)throw new TypeError('SH stride mismatch');const m=shYawMatrix(degree,yaw),terms=m.map(row=>row.flatMap((v,i)=>v?[i,v]:[])),out=new Float32Array(coefficients.length);
 for(let base=0;base<out.length;base+=stride)for(let k=0;k<n;k++){const row=terms[k];for(let j=0;j<row.length;j+=2){const old=base+row[j]*3,f=row[j+1];for(let c=0;c<3;c++)out[base+k*3+c]+=coefficients[old+c]*f;}}
 return out;
}
const SH_VERTEX_GLSL=`
uniform sampler2D shData;uniform int shWidth,shDegree,shCoefficients;
vec3 shCoeff(int id,int k){int a=id*shCoefficients+k;return texelFetch(shData,ivec2(a%shWidth,a/shWidth),0).rgb;}
vec3 gaussianRadiance(int id,vec3 direction){vec3 d=normalize(direction);float x=d.x,y=d.y,z=d.z,xx=x*x,yy=y*y,zz=z*z;vec3 c=vec3(.5)+.28209479177387814*shCoeff(id,0);
if(shDegree>0){c+=-.4886025119029199*y*shCoeff(id,1)+.4886025119029199*z*shCoeff(id,2)-.4886025119029199*x*shCoeff(id,3);}
if(shDegree>1){c+=1.0925484305920792*x*y*shCoeff(id,4)-1.0925484305920792*y*z*shCoeff(id,5)+.31539156525252005*(2.*zz-xx-yy)*shCoeff(id,6)-1.0925484305920792*x*z*shCoeff(id,7)+.5462742152960396*(xx-yy)*shCoeff(id,8);}
if(shDegree>2){c+=-.5900435899266435*y*(3.*xx-yy)*shCoeff(id,9)+2.890611442640554*x*y*z*shCoeff(id,10)-.4570457994644658*y*(4.*zz-xx-yy)*shCoeff(id,11)+.3731763325901154*z*(2.*zz-3.*xx-3.*yy)*shCoeff(id,12)-.4570457994644658*x*(4.*zz-xx-yy)*shCoeff(id,13)+1.445305721320277*z*(xx-yy)*shCoeff(id,14)-.5900435899266435*x*(xx-3.*yy)*shCoeff(id,15);}
return clamp(c,vec3(0),vec3(64));}
`;

export {shBasis,evaluateSH,cloudSH,shYawMatrix,rotateSHYaw,SH_VERTEX_GLSL};
