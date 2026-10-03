// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/** Browser ESM conversion of the supplied Ambient Studio depth reconstruction source.
 * Numeric algorithms and data contracts retain their original implementation. */
/* Original scene-specific neural background fitting. No external runtime/models.
 * Fourier-coordinate MLP, explicit backpropagation and Adam, masked supervision.
 * This is not semantic inpainting, depth estimation, Toon3D, or Deep Image Prior's CNN.
 */
function createNeuralPlateLibrary(){
'use strict';
const FORMAT='ambient.neural-background', VERSION=1;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function random(seed){let s=seed>>>0;return()=>{s+=0x6d2b79f5;let t=s;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
function features(x,y,bandwidth=1,out=new Float64Array(30)){
 x=x*2-1;y=y*2-1;out[0]=x;out[1]=y;out[2]=x*y;out[3]=x*x;out[4]=y*y;out[5]=1;
 let k=6;for(const f of [1,2,4,8])for(const v of [x,y]){const a=v*Math.PI*f*bandwidth;out[k++]=Math.sin(a);out[k++]=Math.cos(a);}
 for(const [a,b]of [[1,1],[1,-1],[2,1],[1,2]]){const p=(a*x+b*y)*Math.PI*bandwidth;out[k++]=Math.sin(p);out[k++]=Math.cos(p);}return out;
}
function createModel({seed=7314,bandwidth=1,width=40,hidden=32}={}){
 if(!Number.isFinite(bandwidth)||bandwidth<.1||bandwidth>2)throw new TypeError('Bandwidth must be 0.1–2.');
 if(![24,32,40,48,64].includes(width)||![16,24,32,40,48].includes(hidden))throw new TypeError('Unsupported bounded network width.');
 const sizes=[30,width,hidden,3],rng=random(seed),layers=[];
 for(let l=0;l<3;l++){const ni=sizes[l],no=sizes[l+1],weights=new Float64Array(ni*no),bias=new Float64Array(no),scale=Math.sqrt(6/(ni+no));for(let j=0;j<weights.length;j++)weights[j]=(rng()*2-1)*scale;layers.push({ni,no,weights,bias});}
 return{format:FORMAT,version:VERSION,seed:seed>>>0,bandwidth,sizes,layers,steps:0};
}
function workspace(m){return{a:[new Float64Array(30),...m.layers.map(l=>new Float64Array(l.no))],delta:m.layers.map(l=>new Float64Array(l.no))};}
function forward(m,f,ws){ws.a[0].set(f);for(let k=0;k<3;k++){const l=m.layers[k],src=ws.a[k],out=ws.a[k+1];for(let j=0;j<l.no;j++){let sum=l.bias[j],o=j*l.ni;for(let i=0;i<l.ni;i++)sum+=l.weights[o+i]*src[i];out[j]=k<2?Math.tanh(sum):sum;}}return ws.a[3];}
function gradsFor(m){return m.layers.map(l=>({weights:new Float64Array(l.weights.length),bias:new Float64Array(l.no)}));}
function accumulate(m,f,target,g,ws,weight=1){const out=forward(m,f,ws),d=ws.delta;let loss=0;for(let c=0;c<3;c++){const e=out[c]-target[c];loss+=e*e/3;d[2][c]=2*e/3*weight;}
 for(let k=2;k>=0;k--){const l=m.layers[k],src=ws.a[k],gg=g[k];if(k>0)d[k-1].fill(0);for(let j=0;j<l.no;j++){const dj=d[k][j],o=j*l.ni;gg.bias[j]+=dj;for(let i=0;i<l.ni;i++){gg.weights[o+i]+=dj*src[i];if(k>0)d[k-1][i]+=l.weights[o+i]*dj;}}if(k>0)for(let i=0;i<l.ni;i++)d[k-1][i]*=1-ws.a[k][i]*ws.a[k][i];}return loss;
}
function serialize(m,meta={}){return{format:FORMAT,version:VERSION,seed:m.seed,bandwidth:m.bandwidth,sizes:[...m.sizes],steps:m.steps,layers:m.layers.map(l=>({weights:Array.from(l.weights),bias:Array.from(l.bias)})),metadata:meta};}
function deserialize(raw){if(!raw||raw.format!==FORMAT||raw.version!==VERSION||!Array.isArray(raw.sizes)||raw.sizes.length!==4||raw.sizes[0]!==30||raw.sizes[3]!==3)throw new TypeError('Unsupported neural background model.');const m=createModel({seed:raw.seed,bandwidth:raw.bandwidth,width:raw.sizes[1],hidden:raw.sizes[2]});if(!Array.isArray(raw.layers)||raw.layers.length!==3)throw new TypeError('Model layer count mismatch.');for(let k=0;k<3;k++){const dst=m.layers[k],src=raw.layers[k];for(const key of ['weights','bias']){const v=src?.[key];if(!Array.isArray(v)||v.length!==dst[key].length||v.some(x=>typeof x!=='number'||!Number.isFinite(x)||Math.abs(x)>100))throw new TypeError('Invalid model parameter data.');dst[key].set(v);}}m.steps=Number.isSafeInteger(raw.steps)&&raw.steps>=0?Math.min(raw.steps,100000):0;return m;}
function validateInput(input){const{width:w,height:h,pixels,mask}=input;if(!Number.isInteger(w)||!Number.isInteger(h)||w<8||h<8||w>1024||h>1024||w*h>262144)throw new TypeError('Training image must be 8–1024 per axis, at most 262144 pixels.');if(!pixels||pixels.length!==w*h*4||!mask||mask.length!==w*h)throw new TypeError('Pixel or mask dimensions mismatch.');for(let i=0;i<mask.length;i++)if(!Number.isFinite(mask[i])||mask[i]<0||mask[i]>1)throw new TypeError('Mask must be in 0–1.');for(const v of pixels)if(!Number.isFinite(v)||v<0||v>255)throw new TypeError('Pixels must be finite RGBA bytes.');}
function fingerprint(input){let hash=2166136261;const add=v=>{hash^=v;hash=Math.imul(hash,16777619);};for(const v of [input.width,input.height]){add(v&255);add(v>>>8);}for(let i=0;i<input.mask.length;i++){add(Math.round(input.mask[i]*255));if(input.mask[i]<.01)for(let c=0;c<4;c++)add(input.pixels[i*4+c]);}return(hash>>>0).toString(16).padStart(8,'0');}
class Trainer{
 constructor(input,options={}){
  validateInput(input);this.input=input;this.rng=random(options.seed??7314);this.model=options.model?deserialize(options.model):createModel(options);this.ws=workspace(this.model);this.grad=gradsFor(this.model);this.m=gradsFor(this.model);this.v=gradsFor(this.model);this.stepCount=0;this.batch=clamp(Math.round(options.batch??128),16,512);if(!Number.isFinite(this.batch))throw new TypeError('Invalid batch size.');this.lr=clamp(Number(options.learningRate??.003),.00005,.03);if(!Number.isFinite(this.lr))throw new TypeError('Invalid learning rate.');this.history=[];this.best=Infinity;this.bestStep=0;this.bestWeights=null;this.cancelled=false;this.known=[];this.validation=[];let hidden=0;const split=random((options.seed??7314)^0xabc123),n=input.width*input.height;
  for(let i=0;i<n;i++){if(input.mask[i]>.01||input.pixels[i*4+3]<250){hidden++;continue;} // Never supervise from foreground, uncertain mask edges, or transparent pixels.
   if(split()<.10)this.validation.push(i);else this.known.push(i);}
  if(this.known.length<64||this.validation.length<8)throw new Error('Not enough visible background to train. Leave at least 80 opaque background pixels.');
  this.featureCache=new Float32Array(n*30);const f=new Float64Array(30);for(const i of [...this.known,...this.validation]){features((i%input.width+.5)/input.width,(Math.floor(i/input.width)+.5)/input.height,this.model.bandwidth,f);this.featureCache.set(f,i*30);}this.target=new Float64Array(3);
  this.meta={task:'per-image masked RGB completion',sourceFingerprint:fingerprint(input),fingerprintAlgorithm:'FNV-1a non-security provenance label',width:input.width,height:input.height,observedTrainingPixels:this.known.length,observedValidationPixels:this.validation.length,excludedPixels:hidden,validation:'Seeded holdout of observed background only; NOT hidden-region ground truth.',backend:'JavaScript Float64 CPU; Adam + explicit reverse-mode gradients',seed:options.seed??7314};
  this.record();
 }
 sample(id){const p=this.input.pixels,k=id*4;for(let c=0;c<3;c++)this.target[c]=p[k+c]/255;return this.featureCache.subarray(id*30,id*30+30);}
 evaluate(ids,limit=2048){let sum=0,n=0;const step=Math.max(1,Math.floor(ids.length/limit));for(let j=0;j<ids.length;j+=step){const f=this.sample(ids[j]),out=forward(this.model,f,this.ws);for(let c=0;c<3;c++)sum+=(out[c]-this.target[c])**2/3;n++;}return sum/n;}
 record(){const val=this.evaluate(this.validation),train=this.evaluate(this.known);const record={step:this.stepCount,trainingMSE:train,validationMSE:val};this.history.push(record);if(val<this.best){this.best=val;this.bestStep=this.stepCount;this.bestWeights=this.model.layers.map(l=>({weights:new Float64Array(l.weights),bias:new Float64Array(l.bias)}));}return record;}
 step(count=1){if(this.cancelled)throw new Error('Training cancelled.');for(let it=0;it<count;it++){
  for(const g of this.grad){g.weights.fill(0);g.bias.fill(0);}for(let j=0;j<this.batch;j++){const id=this.known[Math.floor(this.rng()*this.known.length)];accumulate(this.model,this.sample(id),this.target,this.grad,this.ws,1/this.batch);}
  this.stepCount++;this.model.steps++;const bc1=1-Math.pow(.9,this.stepCount),bc2=1-Math.pow(.999,this.stepCount);for(let k=0;k<3;k++)for(const key of ['weights','bias']){const par=this.model.layers[k][key],grad=this.grad[k][key],m=this.m[k][key],v=this.v[k][key];for(let j=0;j<par.length;j++){const g=clamp(grad[j]+(key==='weights'?1e-6*par[j]:0),-1,1);m[j]=.9*m[j]+.1*g;v[j]=.999*v[j]+.001*g*g;par[j]-=this.lr*(m[j]/bc1)/(Math.sqrt(v[j]/bc2)+1e-8);}}}
  return this.stepCount;
 }
 finish(){this.record();for(let k=0;k<3;k++){this.model.layers[k].weights.set(this.bestWeights[k].weights);this.model.layers[k].bias.set(this.bestWeights[k].bias);}this.model.steps=this.bestStep;return serialize(this.model,{...this.meta,attemptedSteps:this.stepCount,bestStep:this.bestStep,history:this.history,limitations:['Unknown pixels are synthesized, not recovered observations.','No semantics, unseen backsides, calibration or geometry are learned.','Large unfamiliar holes can blur or invent the wrong structure.']});}
}
function predict(model,width,height){const m=model.layers?.[0]?.ni?model:deserialize(model);if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>4194304)throw new TypeError('Invalid prediction dimensions.');const pixels=new Uint8ClampedArray(width*height*4),ws=workspace(m),f=ws.a[0];for(let y=0;y<height;y++)for(let x=0;x<width;x++){features((x+.5)/width,(y+.5)/height,m.bandwidth,f);const rgb=forward(m,f,ws),k=(y*width+x)*4;for(let c=0;c<3;c++)pixels[k+c]=Math.round(clamp(rgb[c],0,1)*255);pixels[k+3]=255;}return pixels;}
function complete(input,model,{seamCorrection=true}={}){
 validateInput(input);const out=predict(model,input.width,input.height),{width:w,height:h,pixels}=input;const mask=Float32Array.from(input.mask,(v,i)=>pixels[i*4+3]<250?1:v);
 // Classical screened-Poisson residual continuation fixes seams. This does not
 // train extra weights or know masked ground truth. Known pixels are copied.
 if(seamCorrection){const residual=new Float32Array(w*h*3);for(let i=0;i<mask.length;i++)if(mask[i]<.01)for(let c=0;c<3;c++)residual[i*3+c]=pixels[i*4+c]-out[i*4+c];
  for(let iter=0;iter<180;iter++)for(let color=0;color<2;color++)for(let y=0;y<h;y++)for(let x=(y+color)&1;x<w;x+=2){const i=y*w+x;if(mask[i]<.01)continue;const neighbors=[x?i-1:i,x<w-1?i+1:i,y?i-w:i,y<h-1?i+w:i];for(let c=0;c<3;c++){let sum=0;for(const j of neighbors)sum+=residual[j*3+c];const target=sum/4.025;residual[i*3+c]+=1.45*(target-residual[i*3+c]);}}
  for(let i=0;i<mask.length;i++)if(mask[i]>.01)for(let c=0;c<3;c++)out[i*4+c]+=residual[i*3+c];
 }
 for(let i=0;i<mask.length;i++){const t=mask[i];for(let c=0;c<3;c++)out[i*4+c]=Math.round(out[i*4+c]*t+pixels[i*4+c]*(1-t));out[i*4+3]=255;}return out;
}
function supportDistance(mask,w,h){const d=new Float32Array(w*h);for(let i=0;i<d.length;i++)d[i]=mask[i]<.01?0:1e6;for(let y=0;y<h;y++)for(let x=0;x<w;x++){let i=y*w+x;if(x)d[i]=Math.min(d[i],d[i-1]+1);if(y)d[i]=Math.min(d[i],d[i-w]+1);}for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){let i=y*w+x;if(x<w-1)d[i]=Math.min(d[i],d[i+1]+1);if(y<h-1)d[i]=Math.min(d[i],d[i+w]+1);}return d;}
return{FORMAT,VERSION,features,random,createModel,workspace,forward,gradsFor,accumulate,serialize,deserialize,Trainer,predict,complete,validateInput,fingerprint,supportDistance};
}

const api=createNeuralPlateLibrary();
api.workerSource=()=>"const NP=("+createNeuralPlateLibrary.toString()+")();"+`
onmessage=e=>{if(e.data.type==='predict'){try{const model=e.data.model;NP.deserialize(model);const pixels=NP.complete(e.data.input,model);postMessage({type:'done',model,pixels},[pixels.buffer]);}catch(err){postMessage({type:'error',message:err.message});}return;}if(e.data.type!=='train')return;try{const input=e.data.input,opt=e.data.options,trainer=new NP.Trainer(input,opt),steps=Math.max(100,Math.min(12000,Math.round(opt.steps||3500)));
function tick(){try{trainer.step(Math.min(25,steps-trainer.stepCount));if(trainer.stepCount%50===0){const rec=trainer.record();postMessage({type:'progress',step:rec.step,loss:rec.validationMSE,history:trainer.history});}if(trainer.stepCount<steps)setTimeout(tick,0);else{const model=trainer.finish(),pixels=NP.complete(input,model);postMessage({type:'done',model,pixels},[pixels.buffer]);}}catch(err){postMessage({type:'error',message:err.message});}}tick();}catch(err){postMessage({type:'error',message:err.message});}};`;

export const { FORMAT,VERSION,features,random,createModel,workspace,forward,gradsFor,accumulate,serialize,deserialize,Trainer,predict,complete,validateInput,fingerprint,supportDistance,workerSource } = api;
export { createNeuralPlateLibrary };
export default api;

