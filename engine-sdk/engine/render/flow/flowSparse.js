// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const FLOW_STENCIL_WORDS = 10;

/** Shared addressing for the native sparse density atlas. Bindings0–4 belong
 * to the completed snapshot; no address is derived from a presentation box. */
export function flowSparseWGSL(boundarySource = '', { boundaryCache = true } = {}) { return /* wgsl */`
${boundarySource}
@group(0) @binding(0) var field:texture_3d<f32>;
@group(0) @binding(1) var fieldSampler:sampler;
@group(0) @binding(2) var<storage,read> table:array<u32>;
@group(0) @binding(3) var<storage,read> params:array<u32>;
@group(0) @binding(4) var<uniform> worldToCell:vec4f;
${boundarySource && boundaryCache ? '@group(0) @binding(17) var<storage,read> boundaryStencils:array<u32>;' : ''}
fn blockSize()->vec3f { return vec3f(vec3u(params[0],params[1],params[2])+vec3u(1))/worldToCell.xyz; }
fn blockIndex(location:vec3i)->u32 {
    let bucket=vec3u(location)&vec3u(params[8],params[9],params[10]);
    let hash=(bucket.z<<params[13])|(bucket.y<<params[12])|bucket.x;
    for(var i=table[hash*2u];i<table[hash*2u+1u];i++) {
        let address=params[15]+4u*i;
        if(all(bitcast<vec3i>(vec3u(table[address],table[address+1u],table[address+2u]))==location)
            && table[address+3u]==params[32] && (table[params[18]+i]&0x80000000u)!=0u) { return i; }
    }
    return 0xffffffffu;
}
fn atlasOrigin(index:u32)->vec3u {
    let packed=table[params[18]+index];
    return vec3u(((packed<<1u)|1u)&4095u,((packed>>10u)|1u)&2047u,((packed>>20u)|1u)&2047u);
}
fn sampleFieldInBlock(world:vec3f,location:vec3i,index:u32)->vec4f {
    let cellPosition=world*worldToCell.xyz;
    ${boundarySource ? /* wgsl */`
    let firstDonor=floor(cellPosition-.5)+.5;
    ${boundaryCache ? /* wgsl */`
    let dimensions=vec3u(params[0],params[1],params[2])+vec3u(2);
    let localDonor=vec3i(floor(cellPosition-.5))-location*vec3i(dimensions-vec3u(1))+vec3i(1);
    let cachedBase=location*vec3i(dimensions-vec3u(1))+localDonor-vec3i(1);
    let cachedFirst=vec3f(cachedBase)+.5;
    var intersects=true;
    var stencil=0xffffffffu;
    if(boundaryStencils[0]!=0xffffffffu && all(localDonor>=vec3i(0)) && all(localDonor<vec3i(dimensions)) && all(cachedFirst==firstDonor)
        && all(world>=firstDonor/worldToCell.xyz) && all(world<=(firstDonor+1.)/worldToCell.xyz)) {
        let local=vec3u(localDonor);
        stencil=params[7]+${FLOW_STENCIL_WORDS}u*(index*dimensions.x*dimensions.y*dimensions.z+(local.z*dimensions.y+local.y)*dimensions.x+local.x);
        intersects=boundaryStencils[stencil]!=0u;
        if(boundaryStencils[stencil]==0xfffffffeu) {
            stencil=0xffffffffu;
            intersects=solidOverlapsBox(0u,firstDonor/worldToCell.xyz,(firstDonor+1.)/worldToCell.xyz);
        }
    } else {
        // Float coordinates at extreme world addresses can round differently
        // from integer block arithmetic. Retain the direct predicate there.
        intersects=solidOverlapsBox(0u,firstDonor/worldToCell.xyz,(firstDonor+1.)/worldToCell.xyz);
    }
    if(intersects) {` : 'if(solidOverlapsBox(0u,firstDonor/worldToCell.xyz,(firstDonor+1.)/worldToCell.xyz)) {'}
        return sampleBoundaryField(world${boundaryCache ? ',stencil' : ''});
    }` : ''}
    let local=cellPosition-vec3f(location)*vec3f(vec3u(params[0],params[1],params[2])+vec3u(1));
    return max(textureSampleLevel(field,fieldSampler,(vec3f(atlasOrigin(index))+local)/vec3f(textureDimensions(field)),0),vec4f(0));
}
fn sampleField(world:vec3f)->vec4f {
    let cellPosition=world*worldToCell.xyz;
    let location=vec3i(floor(cellPosition/vec3f(vec3u(params[0],params[1],params[2])+vec3u(1))));
    let index=blockIndex(location);
    if(index==0xffffffffu) { return vec4f(0); }
    // Native blocks include the one-texel border used by upstream's linear
    // accessor. Positions in cell units already carry the half-cell centre.
    return sampleFieldInBlock(world,location,index);
}
${boundarySource ? /* wgsl */`
fn boundaryCell(coordinate:vec3i)->vec4f {
    let block=vec3i(vec3u(params[0],params[1],params[2])+vec3u(1));
    let location=vec3i(floor(vec3f(coordinate)/vec3f(block)));
    let index=blockIndex(location);
    if(index==0xffffffffu) { return vec4f(0); }
    return textureLoad(field,vec3i(atlasOrigin(index))+coordinate-location*block,0);
}
${boundaryCache ? /* wgsl */`
fn stencilInside(world:vec3f,stencil:u32)->bool {
    if(stencil==0xffffffffu) { return solidInside(0u,world); }
    let count=boundaryStencils[stencil];
    if(count==0xffffffffu) { return solidInside(0u,world); }
    for(var candidate=0u;candidate<count;candidate++) {
        if(solidCandidateInside(boundaryStencils[stencil+2u+candidate],world)) { return true; }
    }
    return false;
}
fn stencilTrace(start:vec3f,end:vec3f,stencil:u32)->f32 {
    if(stencil==0xffffffffu) { return solidTrace(0u,start,end); }
    let count=boundaryStencils[stencil];
    if(count==0xffffffffu) { return solidTrace(0u,start,end); }
    var hit=1.;
    for(var candidate=0u;candidate<count;candidate++) {
        hit=min(hit,solidCandidateTrace(boundaryStencils[stencil+2u+candidate],start,end));
    }
    return hit;
}` : ''}
fn sampleBoundaryField(world:vec3f${boundaryCache ? ',stencil:u32' : ''})->vec4f {
    if(${boundaryCache ? 'stencilInside(world,stencil)' : 'solidInside(0u,world)'}) { return vec4f(0); }
    let cell=world*worldToCell.xyz-.5; let base=vec3i(floor(cell)); let fraction=fract(cell);
    var value=vec4f(0); var admitted=0.;
    for(var corner=0u;corner<8u;corner++) {
        let side=vec3i(i32(corner&1u),i32((corner>>1u)&1u),i32((corner>>2u)&1u));
        let coordinate=base+side; let donor=(vec3f(coordinate)+.5)/worldToCell.xyz;
        ${boundaryCache ? /* wgsl */`
        var inside=false;
        if(stencil!=0xffffffffu && boundaryStencils[stencil]!=0xffffffffu) {
            inside=(boundaryStencils[stencil+1u]&(1u<<corner))!=0u;
        } else { inside=solidInside(0u,donor); }
        if(inside || stencilTrace(world,donor,stencil)<1.) { continue; }
        ` : 'if(solidInside(0u,donor) || solidTrace(0u,world,donor)<1.) { continue; }'}
        let weights=select(1.-fraction,fraction,side==vec3i(1)); let weight=weights.x*weights.y*weights.z;
        admitted+=weight; value+=boundaryCell(coordinate)*weight;
    }
    // Empty sparse cells still carry their interpolation weight. Only a solid
    // donor or a segment entering a solid is removed from the normalization.
    return max(value/max(admitted,1.e-20),vec4f(0));
}
` : ''}
fn tileOrigin(index:u32)->vec3u {
    let tile=vec3u(params[33],params[34],params[35]);
    let grid=vec3u(params[36],params[37],params[38]);
    return vec3u(index%grid.x,(index/grid.x)%grid.y,index/(grid.x*grid.y))*tile;
}
fn nextBlockDistance(point:vec3f,direction:vec3f,location:vec3i)->f32 {
    let size=blockSize();
    let edge=(vec3f(location)+select(vec3f(0),vec3f(1),direction>vec3f(0)))*size;
    let distance=select(vec3f(1.e30),(edge-point)/select(vec3f(1),direction,abs(direction)>vec3f(1.e-8)),abs(direction)>vec3f(1.e-8));
    return max(.0001,min(distance.x,min(distance.y,distance.z))+.0001);
}
fn nextOccupiedDistance(point:vec3f,direction:vec3f)->f32 {
    let safe=select(vec3f(-1.e-20),vec3f(1.e-20),direction>=vec3f(0));
    let inverse=1./select(safe,direction,abs(direction)>vec3f(1.e-20));
    let size=blockSize(); var nearest=1.e30;
    // Bound the search by actual resident blocks, not empty world distance.
    for(var index=0u;index<params[7];index++) {
        let address=params[15]+4u*index;
        if(table[address+3u]!=params[32] || (table[params[18]+index]&0x80000000u)==0u) { continue; }
        let lower=vec3f(bitcast<vec3i>(vec3u(table[address],table[address+1u],table[address+2u])))*size;
        let a=(lower-point)*inverse; let b=(lower+size-point)*inverse;
        let begin3=min(a,b); let end3=max(a,b);
        let begin=max(0.,max(begin3.x,max(begin3.y,begin3.z)));
        let end=min(end3.x,min(end3.y,end3.z));
        if(end>begin) { nearest=min(nearest,begin+.0001); }
    }
    return nearest;
}
`; }
export const FLOW_SPARSE_WGSL = flowSparseWGSL();

/** Exact eight-donor broad-phase results, rebuilt from each completed snapshot.
 * The block test only rejects definitely clear space. Near any solid, the
 * original point/segment predicates still decide every interpolation donor. */
export const flowBoundaryStencilWGSL = boundarySource => /* wgsl */`
${boundarySource}
@group(0) @binding(2) var<storage,read> table:array<u32>;
@group(0) @binding(3) var<storage,read> params:array<u32>;
@group(0) @binding(4) var<uniform> worldToCell:vec4f;
@group(0) @binding(17) var<storage,read_write> boundaryStencils:array<u32>;
@compute @workgroup_size(64) fn blocks(@builtin(global_invocation_id) id:vec3u) {
    if(id.x>=params[7]) { return; }
    let address=params[15]+4u*id.x;
    if(table[address+3u]!=params[32] || (table[params[18]+id.x]&0x80000000u)==0u) {
        boundaryStencils[id.x]=0u; return;
    }
    let location=vec3f(bitcast<vec3i>(vec3u(table[address],table[address+1u],table[address+2u])));
    let size=vec3f(vec3u(params[0],params[1],params[2])+vec3u(1));
    let lower=(location*size-.5)/worldToCell.xyz;
    let upper=((location+1.)*size+.5)/worldToCell.xyz;
    let rounding=.00000762939453125*(vec3f(1)+abs(lower)+abs(upper));
    boundaryStencils[id.x]=u32(solidOverlapsBox(0u,lower-rounding,upper+rounding));
}
@compute @workgroup_size(64) fn stencils(@builtin(global_invocation_id) id:vec3u) {
    let dimensions=vec3u(params[0],params[1],params[2])+vec3u(2);
    let count=dimensions.x*dimensions.y*dimensions.z;
    let invocation=id.x+id.y*params[39];
    let index=invocation/count;
    if(index>=params[7]) { return; }
    let destination=params[7]+invocation*${FLOW_STENCIL_WORDS}u;
    if(boundaryStencils[index]==0u) { boundaryStencils[destination]=0u; return; }
    let address=params[15]+4u*index;
    let location=bitcast<vec3i>(vec3u(table[address],table[address+1u],table[address+2u]));
    let offset=invocation%count;
    let local=vec3u(offset%dimensions.x,(offset/dimensions.x)%dimensions.y,offset/(dimensions.x*dimensions.y));
    let base=location*vec3i(dimensions-vec3u(1))+vec3i(local)-vec3i(1);
    let first=vec3f(base)+.5;
    let lower=first/worldToCell.xyz;let upper=(first+1.)/worldToCell.xyz;
    // A rounded donor outside this box cannot use its candidate proof, even
    // when the collector reports clear space. Preserve the original path.
    for(var corner=0u;corner<8u;corner++) {
        let side=vec3i(i32(corner&1u),i32((corner>>1u)&1u),i32((corner>>2u)&1u));
        let donor=(vec3f(base+side)+.5)/worldToCell.xyz;
        if(any(donor<lower) || any(donor>upper)) { boundaryStencils[destination]=0xfffffffeu;return; }
    }
    let candidates=solidStencilCandidates(0u,lower,upper);
    boundaryStencils[destination]=candidates.count;
    if(candidates.count==0u || candidates.count==0xffffffffu) { return; }
    for(var candidate=0u;candidate<candidates.count;candidate++) {
        boundaryStencils[destination+2u+candidate]=candidates.nodes[candidate];
    }
    var insideBits=0u;
    for(var corner=0u;corner<8u;corner++) {
        let side=vec3i(i32(corner&1u),i32((corner>>1u)&1u),i32((corner>>2u)&1u));
        let donor=(vec3f(base+side)+.5)/worldToCell.xyz;
        for(var candidate=0u;candidate<candidates.count;candidate++) {
            if(solidCandidateInside(candidates.nodes[candidate],donor)) { insideBits|=1u<<corner;break; }
        }
    }
    boundaryStencils[destination+1u]=insideBits;
}`;

export const FLOW_BOUNDS_WGSL = /* wgsl */`
@group(0) @binding(0) var<storage,read> table:array<u32>;
@group(0) @binding(1) var<storage,read> params:array<u32>;
@group(0) @binding(2) var<storage,read_write> bounds:array<atomic<i32>,8>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u) {
    if(id.x>=params[7]) { return; }
    let address=params[15]+4u*id.x;
    if(table[address+3u]!=params[32] || (table[params[18]+id.x]&0x80000000u)==0u) { return; }
    for(var axis=0u;axis<3u;axis++) {
        let coordinate=bitcast<i32>(table[address+axis]);
        atomicMin(&bounds[axis],coordinate); atomicMax(&bounds[axis+4u],coordinate+1);
    }
    atomicAdd(&bounds[3],1);
}`;

export const flowQueryWGSL = (boundarySource = '', options = {}) => /* wgsl */`${flowSparseWGSL(boundarySource, options)}
@group(0) @binding(5) var<storage,read> queries:array<vec4f>;
@group(0) @binding(6) var<storage,read_write> values:array<vec4f>;
@compute @workgroup_size(32) fn main(@builtin(global_invocation_id) id:vec3u) {
    if(id.x<arrayLength(&queries)) { values[id.x]=sampleField(queries[id.x].xyz); }
}`;
export const FLOW_QUERY_WGSL = flowQueryWGSL();
