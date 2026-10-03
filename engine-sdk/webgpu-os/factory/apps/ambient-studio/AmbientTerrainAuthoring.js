// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { TERRAIN_BAKE_DEFAULTS, normalizeTerrainBakeConfig } from '../../../../engine/world/generation/TerrainBake.js';
import { normalizeTerrainHeightfield, resampleTerrainHeightfield } from '../../../../engine/world/generation/TerrainHeightfield.js';

const DISPLAY_GRID = 64;

export const TERRAIN_GENERATION_PARAMETERS = Object.freeze([
    ['seed', 'Simulation seed', 0, 4294967295, 1], ['gridResolution', 'Simulation grid', 32, 128, 1],
    ['worldSize', 'Simulation extent (m)', 32, 4096, 1], ['plateCount', 'Tectonic plates', 2, 16, 1],
    ['baseRelief', 'Initial bedrock relief (m)', 1, 200, .1], ['baseFrequency', 'Initial range frequency', .002, .15, .001],
    ['segmentCount', 'Tectonic segments', 256, 8192, 1], ['tectonicSteps', 'Tectonic steps', 1, 512, 1],
    ['hydraulicSteps', 'Rain trajectory steps', 0, 512, 1], ['rainfall', 'Rain particles per batch', 0, 8192, 1],
    ['rainBatches', 'Rain batches', 1, 32, 1], ['erosionRate', 'Hydraulic erosion rate', 0, 1, .01],
    ['depositionRate', 'Sediment deposition rate', 0, 1, .01], ['inertia', 'Water gradient response', .01, 1, .01],
    ['thermalSteps', 'Talus transfer steps', 0, 256, 1],
    ['thermalMaterial', 'Surface · 1 rock / 2 gravel / 3 sand / 4 soil', 1, 4, 1], ['thermalTransferRate', 'Talus transfer rate', 0, 1, .01],
].map(([id, label, min, max, step]) => Object.freeze({ id, label, type: 'number', default: TERRAIN_BAKE_DEFAULTS[id], min, max, step })));

export function terrainGenerationConfig(node) {
    if (!Object.values(node?.params?.sources ?? {}).some(source => source.includes('particle-realms.engine-terrain-source.v1'))) return null;
    return normalizeTerrainBakeConfig(Object.fromEntries(TERRAIN_GENERATION_PARAMETERS.map(spec => [spec.id, node.params[spec.id]])));
}

/** Saved WGSL owns the compact samples. It needs no private texture binding,
 * runtime lookup or generator fallback, so copied/deleted/recreated nodes work. */
export function terrainHeightfieldSource(value, { material = true, displayResolution = DISPLAY_GRID } = {}) {
    if (!Number.isInteger(displayResolution) || displayResolution < 32 || displayResolution > 72) throw new TypeError('Terrain display resolution must be an integer in [32,72]');
    const original = normalizeTerrainHeightfield(value);
    const grid = displayResolution;
    const field = resampleTerrainHeightfield(original, { width: grid, height: grid });
    const edge = grid - 1, lastCell = edge - 1, rowShift = Math.log2(grid);
    let low = Infinity, high = -Infinity;
    for (const number of field.heights) { low = Math.min(low, number); high = Math.max(high, number); }
    const range = Math.max(high - low, .000001);
    const packed = field.heights.map((height, index) => {
        const h = Math.round((height - low) / range * 65535);
        const flow = Math.round(field.flow[index] * 255);
        const word = h | flow << 16;
        // Decimal cells save source bytes at the denser display level. Preserve
        // the original64-grid literal spelling for exact saved-source receipts.
        return grid === DISPLAY_GRID ? `0x${word.toString(16)}u` : `${word}`;
    });
    const config = Object.fromEntries(TERRAIN_GENERATION_PARAMETERS.map(spec => [spec.id, `{{param:${spec.id}}}`]));
    const metadata = JSON.stringify(config).replace(/"(\{\{param:[^}]+\}\})"/g, '$1');
    // Keep each dynamically indexed literal small. A single large
    // constant array materializes a huge per-invocation local on some backends.
    // Keep the historical64-byte row address exact. Other bounded resolutions
    // use integer division/remainder rather than a fractional bit shift.
    const rowAddress = Number.isInteger(rowShift) ? `index >> ${rowShift}u` : `index / ${grid}u`;
    const columnAddress = Number.isInteger(rowShift) ? `index & ${edge}u` : `index % ${grid}u`;
    const rows = Array.from({ length: grid }, (_, row) => `case ${row}u: { let values=array<u32,${grid}>(${packed.slice(row * grid, row * grid + grid).join(',')}); value=values[${columnAddress}]; }`).join('\n');
    const source = `// particle-realms.engine-terrain-source.v1
// Generation inputs ${metadata}
// Display samples: ${grid}x${grid} bilinear resampling, 16-bit height / 8-bit relative drainage.${grid === DISPLAY_GRID ? '' : '\n// Requested display grid {{param:displayResolution}}; explicit regeneration is required.'}
// Baked from ${JSON.stringify(original.provenance ?? {})}
fn {{symbol}}_terrainCell(index:u32) -> vec2f {
 var value=0u;
 switch(${rowAddress}){${rows}\ndefault: {}}
 return vec2f(f32(value & 65535u) / 65535.0, f32((value >> 16u) & 255u) / 255.0);
}
fn artEngineTerrain(point:vec2f) -> vec2f {
 let q = clamp((point - vec2f(${field.bounds[0].toFixed(6)},${field.bounds[1].toFixed(6)})) / vec2f(${(field.bounds[2] - field.bounds[0]).toFixed(6)},${(field.bounds[3] - field.bounds[1]).toFixed(6)}) * ${edge}.0, vec2f(0.0), vec2f(${edge}.0));
 let cell = min(vec2u(floor(q)), vec2u(${lastCell})); let f = q - vec2f(cell);
 let at = cell.y * ${grid}u + cell.x;
 let a = mix({{symbol}}_terrainCell(at),{{symbol}}_terrainCell(at + 1u),f.x);
 let b = mix({{symbol}}_terrainCell(at + ${grid}u),{{symbol}}_terrainCell(at + ${grid + 1}u),f.x);
 return mix(a,b,f.y);
}
// Lighting uses a continuous finite difference of the same saved surface.
// This does not modify exact crossings, silhouettes or analytical trace normals.
fn artEngineTerrainShadingNormal(pointXZ:vec2f,boundsMin:vec2f,boundsSize:vec2f,relief:f32,radiusCells:f32)->vec3f{
 if(any(abs(boundsSize)<vec2f(.000001))){return vec3f(0.0,1.0,0.0);}
 let uv=clamp((pointXZ-boundsMin)/boundsSize,vec2f(0.0),vec2f(1.0));
 let radius=max(radiusCells,.05)/${edge}.0;let lo=max(uv-vec2f(radius),vec2f(0.0));let hi=min(uv+vec2f(radius),vec2f(1.0));
 let sampleMin=vec2f(${field.bounds[0].toFixed(6)},${field.bounds[1].toFixed(6)});let sampleSize=vec2f(${(field.bounds[2]-field.bounds[0]).toFixed(6)},${(field.bounds[3]-field.bounds[1]).toFixed(6)});
 let west=artEngineTerrain(vec2f(lo.x,uv.y)*sampleSize+sampleMin).x;let east=artEngineTerrain(vec2f(hi.x,uv.y)*sampleSize+sampleMin).x;
 let south=artEngineTerrain(vec2f(uv.x,lo.y)*sampleSize+sampleMin).x;let north=artEngineTerrain(vec2f(uv.x,hi.y)*sampleSize+sampleMin).x;
 let dx=relief*(east-west)/(max(hi.x-lo.x,.000001)*boundsSize.x);
 let dz=relief*(north-south)/(max(hi.y-lo.y,.000001)*boundsSize.y);
 return normalize(vec3f(-dx,1.0,-dz));
}
${terrainTraceSource(grid)}${material ? `
fn artTerrainCoordinate(u:CollectionMaterial,point:vec2f)->vec2f {
 return (point / u.form.x - vec2f(-{{param:width}}*.5,{{param:originZ}})) / vec2f({{param:width}},{{param:depth}}) * vec2f(${(field.bounds[2]-field.bounds[0]).toFixed(6)},${(field.bounds[3]-field.bounds[1]).toFixed(6)}) + vec2f(${field.bounds[0].toFixed(6)},${field.bounds[1].toFixed(6)});
}
fn artTerrainHeight(u:CollectionMaterial, point:vec2f) -> f32 {
 return {{param:floor}} + artEngineTerrain(artTerrainCoordinate(u,point)).x * {{param:relief}};
}
fn artTerrainFlow(u:CollectionMaterial, point:vec2f) -> f32 {
 return artEngineTerrain(artTerrainCoordinate(u,point)).y;
}
fn artTerrainTrace(u:CollectionMaterial,origin:vec3f,direction:vec3f,maxTravel:f32)->vec4f {
 return artEngineTerrainTrace(origin,direction,vec2f(-{{param:width}}*.5,{{param:originZ}})*u.form.x,vec2f({{param:width}},{{param:depth}})*u.form.x,{{param:floor}},{{param:relief}},maxTravel);
}
fn artTerrainShadingNormal(u:CollectionMaterial,point:vec2f)->vec3f {
 return artEngineTerrainShadingNormal(point,vec2f(-{{param:width}}*.5,{{param:originZ}})*u.form.x,vec2f({{param:width}},{{param:depth}})*u.form.x,{{param:relief}},{{param:normalRadius}});
}` : ''}
// particle-realms.engine-terrain-source.v1.end`;
    if (new TextEncoder().encode(source).byteLength > 70 * 1024) throw new TypeError('Terrain component source exceeds the bounded program budget');
    return source;
}

/** One saved, shared solver for the exact compact bilinear display surface.
 * The signed X/Z extent permits either authoring orientation without resampling.
 * xyz is the analytical surface normal, w is travel; w=-1 denotes no crossing. */
function terrainTraceSource(grid) {
    const edge = grid - 1, lastCell = grid - 2;
    const traceLoop = grid <= 64 ? `for(var stepIndex=0;stepIndex<${grid * 2};stepIndex+=1){` : `for(var stepBatch=0;stepBatch<2;stepBatch+=1){for(var stepIndex=0;stepIndex<${grid};stepIndex+=1){`;
    return `
fn {{symbol}}_terrainPatch(cell:vec2u)->vec4f{
 let at=cell.y*${grid}u+cell.x;
 let a={{symbol}}_terrainCell(at).x;let b={{symbol}}_terrainCell(at+1u).x;
 let c={{symbol}}_terrainCell(at+${grid}u).x;let d={{symbol}}_terrainCell(at+${grid + 1}u).x;
 return vec4f(a,b-a,c-a,d-b-c+a);
}
fn {{symbol}}_terrainSlab(origin:f32,direction:f32,low:f32,high:f32)->vec2f{
 if(abs(direction)<.0000001){if(origin<low||origin>high){return vec2f(1.0,-1.0);}return vec2f(-100000.0,100000.0);}
 let a=(low-origin)/direction;let b=(high-origin)/direction;return vec2f(min(a,b),max(a,b));
}
fn {{symbol}}_terrainRoot(a:f32,b:f32,c:f32,interval:f32)->f32{
 if(c<=0.0){return 0.0;}var first=100000.0;
 if(abs(a)<.0000001){if(abs(b)>.0000001){let t=-c/b;if(t>=0.0&&t<=interval){first=t;}}}
 else{let discriminant=b*b-4.0*a*c;if(discriminant>=0.0){
  let q=-.5*(b+select(-1.0,1.0,b>=0.0)*sqrt(discriminant));
  let t0=select(-b/(2.0*a),q/a,abs(q)>.0000001);let t1=select(t0,c/select(1.0,q,abs(q)>.0000001),abs(q)>.0000001);
  if(t0>=0.0&&t0<=interval){first=t0;}if(t1>=0.0&&t1<=interval){first=min(first,t1);}
 }}return first;
}
fn {{symbol}}_terrainTraceNormal(f:vec2f,cellShape:vec4f,extent:vec2f,relief:f32)->vec3f{
 let dx=relief*(cellShape.y+cellShape.w*f.y)*${edge}.0/extent.x;
 let dz=relief*(cellShape.z+cellShape.w*f.x)*${edge}.0/extent.y;
 return normalize(vec3f(-dx,1.0,-dz));
}
fn artEngineTerrainTrace(origin:vec3f,direction:vec3f,boundsMin:vec2f,boundsSize:vec2f,base:f32,relief:f32,maxTravel:f32)->vec4f{
 let miss=vec4f(0.0,0.0,0.0,-1.0);
 if(abs(boundsSize.x)<.000001||abs(boundsSize.y)<.000001||relief<0.0||maxTravel<=0.0){return miss;}
 let low=min(boundsMin,boundsMin+boundsSize);let high=max(boundsMin,boundsMin+boundsSize);
 let x={{symbol}}_terrainSlab(origin.x,direction.x,low.x,high.x);
 let y={{symbol}}_terrainSlab(origin.y,direction.y,base,base+relief);
 let z={{symbol}}_terrainSlab(origin.z,direction.z,low.y,high.y);
 var travel=max(.001,max(x.x,max(y.x,z.x)));let end=min(maxTravel,min(x.y,min(y.y,z.y)));if(travel>end){return miss;}
 let q0=(origin.xz-boundsMin)/boundsSize*${edge}.0;let dq=direction.xz/boundsSize*${edge}.0;
 let startQ=clamp(q0+dq*travel,vec2f(0.0),vec2f(${edge}.0));var cell=clamp(floor(startQ),vec2f(0.0),vec2f(${lastCell}.0));
 // Only an exact starting grid edge chooses the preceding cell for a negative ray.
 // Subsequent crossings advance this integer cell explicitly, without a distance bias.
 if(dq.x<0.0&&startQ.x==cell.x&&cell.x>0.0){cell.x-=1.0;}
 if(dq.y<0.0&&startQ.y==cell.y&&cell.y>0.0){cell.y-=1.0;}
 // This bounded ${edge}-by-${edge} bilinear field needs at most ${edge * 2 + 1} visited cells.
 // Height along one cell is quadratic, including crossings between its edges.
 ${traceLoop}
  if(travel>end||any(cell<vec2f(0.0))||any(cell>vec2f(${lastCell}.0))){break;}let p=origin+direction*travel;let q=clamp(q0+dq*travel,vec2f(0.0),vec2f(${edge}.0));
  let f=q-cell;let cellShape={{symbol}}_terrainPatch(vec2u(cell));
  let edge=cell+select(vec2f(0.0),vec2f(1.0),dq>=vec2f(0.0));
  var nextX=100000.0;var nextZ=100000.0;
  if(dq.x!=0.0){nextX=(edge.x-q0.x)/dq.x;}if(dq.y!=0.0){nextZ=(edge.y-q0.y)/dq.y;}
  let next=min(end,min(nextX,nextZ));let interval=max(next-travel,0.0);
  let a=-relief*cellShape.w*dq.x*dq.y;
  let b=direction.y-relief*(cellShape.y*dq.x+cellShape.z*dq.y+cellShape.w*(f.x*dq.y+f.y*dq.x));
  let c=p.y-base-relief*(cellShape.x+cellShape.y*f.x+cellShape.z*f.y+cellShape.w*f.x*f.y);
  let root={{symbol}}_terrainRoot(a,b,c,interval);if(root<=interval){
   let hitQ=clamp(q+dq*root,vec2f(0.0),vec2f(${edge}.0));
   return vec4f({{symbol}}_terrainTraceNormal(hitQ-cell,cellShape,boundsSize,relief),travel+root);
  }
  if(next>=end){break;}
  if(nextX<=nextZ){cell.x+=sign(dq.x);}if(nextZ<=nextX){cell.y+=sign(dq.y);}
  travel=max(travel,next);
 }${grid > 64 ? '}' : ''}return miss;
}`;
}

/** Convert simulation units to display coordinates without inventing geometry. */
export function terrainDisplayField(value, bounds = [-18, -3, 18, 51]) {
    const field = normalizeTerrainHeightfield(value);
    return { ...field, bounds: [...bounds] };
}

/** A scaled copy of the same measured field grounds all Gaussian scene parts. */
export function terrainSpatialField(value, { bounds = [-2.275, -.9, 2.275, 3.1], minHeight = 0, maxHeight = .9 } = {}) {
    const field = normalizeTerrainHeightfield(value), low = Math.min(...field.heights), high = Math.max(...field.heights);
    if (!Number.isFinite(minHeight) || !Number.isFinite(maxHeight) || minHeight < 0 || maxHeight < minHeight || maxHeight > 10000) throw new TypeError('Invalid saved spatial terrain height range');
    return normalizeTerrainHeightfield({ ...field, bounds, heights: field.heights.map(height => minHeight + (height - low) / Math.max(high - low, .000001) * (maxHeight - minHeight)) });
}
