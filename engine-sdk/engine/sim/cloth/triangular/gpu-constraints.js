// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { initializePrimitiveLifecycle, destroyPrimitiveLifecycle, assertCommandEncoder, createEncodeReceipt, acquireWorkspace } from '../../../core/gpu/GpuPrimitiveSupport.js';
import { clothError, clothNumber, normalizeClothCurve } from './materials.js';

/** Shared-reference preparation. One batch must be a vertex-disjoint graph color. */
export function prepareTriangularClothGpuBatch(model, constraints, h) {
  clothNumber(h, 'substep seconds', 1e-6, 1);
  if (!Array.isArray(constraints) || !constraints.length || constraints.length > 20000) throw clothError('INVALID_GPU_BATCH', 'A cloth batch needs 1–20000 constraints');
  const occupied = new Set(), kinds = ['warp', 'weft', 'shear', 'bend', 'seam', 'attachment'], curvePoints = [], words = new ArrayBuffer(constraints.length * 80), floats = new Float32Array(words), integers = new Uint32Array(words);
  const compact = new Map(model.degreesOfFreedom.map((id, index) => [id, index])), vertexMapping = model.vertexDof.map(id => compact.get(id));
  const ownedConstraints=new Set(model.constraints);
  const positions = new Float32Array(compact.size * 4);
  for (const [id, index] of compact) positions.set([...model.positions[id], model.inverseMasses[id]], index * 4);
  constraints.forEach((constraint, i) => {
    if (!ownedConstraints.has(constraint) || constraint.ids.some(id => occupied.has(vertexMapping[id]))) throw clothError('INVALID_GPU_BATCH', 'GPU constraints must belong to the model and have disjoint physical vertices');
    constraint.ids.forEach(id => occupied.add(vertexMapping[id]));
    const base = i * 20, kind = kinds.indexOf(constraint.kind), triangle = constraint.triangle;
    if (kind < 0) throw clothError('UNSUPPORTED_GPU_CONSTRAINT', 'This GPU pass does not implement the requested constraint kind');
    integers.set([...constraint.ids.map(id => vertexMapping[id]), ...Array(4 - constraint.ids.length).fill(0)], base);
    floats.set([...(triangle?.warp || constraint.weights || constraint.barycentric || [0, 0, 0, 0]), 0].slice(0, 4), base + 4);
    floats.set([...(triangle?.weft || [0, 0, 0, 0]), 0].slice(0, 4), base + 8);
    floats.set([triangle?.area || constraint.normalOffset || 0, constraint.compliance || 0, constraint.lambda || 0, h], base + 12);
    const curve = triangle ? (kind === 0 ? triangle.material.warp : kind === 1 ? triangle.material.weft : triangle.material.shear).points : [];
    integers.set([kind, constraint.ids.length, kind === 5 ? constraint.axis : curvePoints.length / 2, curve.length], base + 16);
    curvePoints.push(...curve.flat());
  });
  return { sourceRevision: model.sourceRevision, positions, vertexMapping, constraints: new Uint8Array(words), curves: new Float32Array(curvePoints.length ? curvePoints : [0, 0]), constraintCount: constraints.length };
}

export const TRIANGULAR_CLOTH_CONSTRAINT_WGSL = /* wgsl */ `
struct Constraint {
  ids: vec4u,
  warp: vec4f,
  weft: vec4f,
  coefficients: vec4f,
  metadata: vec4u,
}
@group(0) @binding(0) var<storage, read_write> positions: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> constraints: array<Constraint>;
@group(0) @binding(2) var<storage, read> curves: array<vec2f>;
@group(0) @binding(3) var<storage, read_write> reports: array<vec4f>;
@group(0) @binding(4) var<uniform> range: vec4u;

@compute @workgroup_size(64)
fn project(@builtin(global_invocation_id) invocation: vec3u) {
  if (invocation.x >= range.y) { return; }
  let index = range.x + invocation.x;
  if (index >= arrayLength(&constraints)) { return; }
  if (reports[index].w != 0.0) { return; }
  let input = constraints[index]; let kind = input.metadata.x; let count = input.metadata.y;
  var p: array<vec3f, 4>; var g: array<vec3f, 4>; var inverse: array<f32, 4>;
  for (var i = 0u; i < count; i++) { let point = positions[input.ids[i]]; p[i] = point.xyz; inverse[i] = point.w; }
  var value = 0.0; var compliance = input.coefficients.y;
  if (kind <= 2u) {
    var warp = vec3f(0.0); var weft = vec3f(0.0);
    for (var i = 0u; i < 3u; i++) { warp += p[i] * input.warp[i]; weft += p[i] * input.weft[i]; }
    let lw = length(warp); let lf = length(weft);
    if (min(lw, lf) < 1e-9) { reports[index] = vec4f(0.0, 0.0, 0.0, 1.0); return; }
    let u = warp / lw; let v = weft / lf;
    if (kind == 0u || kind == 1u) {
      value = select(lw, lf, kind == 1u) - 1.0;
      for (var i = 0u; i < 3u; i++) { g[i] = select(u * input.warp[i], v * input.weft[i], kind == 1u); }
    } else {
      let cosine = clamp(dot(u, v), -1.0, 1.0); let sine = sqrt(max(0.0, 1.0 - cosine * cosine));
      if (sine < 1e-7) { reports[index] = vec4f(0.0, 0.0, 0.0, 1.0); return; }
      value = asin(cosine);
      let du = (v - cosine * u) / (lw * sine); let dv = (u - cosine * v) / (lf * sine);
      for (var i = 0u; i < 3u; i++) { g[i] = du * input.warp[i] + dv * input.weft[i]; }
    }
    let offset = input.metadata.z; let points = input.metadata.w;
    if (value < curves[offset].x - 1e-7 || value > curves[offset + points - 1u].x + 1e-7) { reports[index] = vec4f(value, 0.0, 0.0, 2.0); return; }
    var response = 0.0; var restSlope = 0.0; var sampled = false;
    for (var i = 1u; i < points; i++) {
      let a = curves[offset + i - 1u]; let b = curves[offset + i];
      if (a.x == 0.0 && i > 1u) { let previous = curves[offset + i - 2u]; restSlope = (b.y - previous.y) / (b.x - previous.x); }
      if (!sampled && value >= a.x && value <= b.x) { let slope = (b.y - a.y) / (b.x - a.x); response = select(a.y + (value - a.x) * slope, slope, kind == 2u); sampled = true; }
    }
    if (abs(value) < 1e-12) {
      if (kind == 2u) { compliance = 0.0; }
      else if (restSlope > 0.0) { compliance = 1.0 / (input.coefficients.x * restSlope); }
      else { constraints[index].coefficients.z = 0.0; reports[index] = vec4f(value, 0.0, 0.0, 0.0); return; }
    } else if (abs(response) < 1e-14) { constraints[index].coefficients.z = 0.0; reports[index] = vec4f(value, 0.0, 0.0, 0.0); return; }
    else { compliance = value / (input.coefficients.x * response); }
  } else if (kind == 3u) {
    let edge = p[1] - p[0]; let left = p[2] - p[0]; let right = p[3] - p[0];
    let n1 = cross(edge, left); let n2 = cross(right, edge); let le = length(edge); let l1 = length(n1); let l2 = length(n2);
    if (min(le, min(l1, l2)) < 1e-15) { reports[index] = vec4f(0.0, 0.0, 0.0, 1.0); return; }
    let e = edge / le; let u = n1 / l1; let v = n2 / l2;
    value = atan2(dot(e, cross(u, v)), clamp(dot(u, v), -1.0, 1.0));
    let dn1 = cross(u, e) / l1; let dn2 = cross(e, v) / l2;
    g[1] = cross(left, dn1) + cross(dn2, right); g[2] = cross(dn1, edge); g[3] = cross(edge, dn2); g[0] = -(g[1] + g[2] + g[3]);
  } else if (kind == 4u) {
    var delta = vec3f(0.0); for (var i = 0u; i < count; i++) { delta += p[i] * input.warp[i]; }
    value = length(delta);
    if (value > 1e-15) { for (var i = 0u; i < count; i++) { g[i] = delta * input.warp[i] / value; } }
  } else {
    let first = p[2] - p[1]; let second = p[3] - p[1]; let raw = cross(first, second); let magnitude = length(raw);
    if (magnitude < 1e-15) { reports[index] = vec4f(0.0, 0.0, 0.0, 1.0); return; }
    let normal = raw / magnitude; let axis = input.metadata.z; var basis = vec3f(0.0); basis[axis] = 1.0;
    let dn = -(basis - normal * normal[axis]) * input.coefficients.x / magnitude;
    let db = cross(second, dn); let dc = cross(dn, first); let da = -(db + dc);
    g[0] = basis; g[1] = da - basis * input.warp.x; g[2] = db - basis * input.warp.y; g[3] = dc - basis * input.warp.z;
    value = p[0][axis] - dot(vec3f(p[1][axis], p[2][axis], p[3][axis]), input.warp.xyz) - input.coefficients.x * normal[axis];
  }
  // Separate cut identities can refer to the same exact sewn physical point.
  // Combine their gradients before computing its mass contribution once.
  for (var i = 0u; i < count; i++) { for (var j = 0u; j < i; j++) { if (input.ids[i] == input.ids[j]) { g[j] += g[i]; g[i] = vec3f(0.0); break; } } }
  let alpha = compliance / (input.coefficients.w * input.coefficients.w);
  var denominator = alpha;
  for (var i = 0u; i < count; i++) { denominator += inverse[i] * dot(g[i], g[i]); }
  if (denominator < 1e-20) { reports[index] = vec4f(value, input.coefficients.z, 0.0, 0.0); return; }
  let deltaLambda = (-value - alpha * input.coefficients.z) / denominator;
  var maximum = 0.0;
  for (var i = 0u; i < count; i++) {
    var duplicate = false; for (var j = 0u; j < i; j++) { if (input.ids[j] == input.ids[i]) { duplicate = true; } } if (duplicate) { continue; }
    let correction = inverse[i] * deltaLambda * g[i]; maximum = max(maximum, length(correction));
    positions[input.ids[i]] = vec4f(p[i] + correction, inverse[i]);
  }
  reports[index] = vec4f(value, input.coefficients.z + deltaLambda, maximum, 0.0);
  constraints[index].coefficients.z = input.coefficients.z + deltaLambda;
}
`;

export function validateTriangularClothGpuBatch(batch) {
  if (!(batch?.positions instanceof Float32Array) || batch.positions.length % 4 || batch.positions.length < 12 || batch.positions.length > 80000 || !(batch.constraints instanceof Uint8Array) || batch.constraints.length !== batch.constraintCount * 80 || !(batch.curves instanceof Float32Array) || !Number.isInteger(batch.constraintCount) || batch.constraintCount < 1 || batch.constraintCount > 20000) throw clothError('INVALID_GPU_BATCH', 'Invalid packed triangular cloth batch');
  if ([...batch.positions, ...batch.curves].some(value => !Number.isFinite(value))) throw clothError('INVALID_GPU_BATCH', 'Nonfinite GPU cloth input');
  for (let i = 3; i < batch.positions.length; i += 4) if (batch.positions[i] < 0) throw clothError('INVALID_GPU_BATCH', 'Inverse masses must be nonnegative');
  const words = new Uint32Array(batch.constraints.buffer, batch.constraints.byteOffset, batch.constraints.byteLength / 4), coefficients = new Float32Array(batch.constraints.buffer, batch.constraints.byteOffset, batch.constraints.byteLength / 4), occupied = new Set();
  for (let i = 0; i < batch.constraintCount; i++) {
    const base = i * 20, count = words[base + 17], kind = words[base + 16];
    if (kind > 5 || count !== (kind <= 2 ? 3 : 4) || (kind === 5 && words[base + 18] > 2) || (kind <= 2 && (coefficients[base + 12] <= 0 || words[base + 19] < 3 || 2 * (words[base + 18] + words[base + 19]) > batch.curves.length)) || coefficients[base + 13] < 0 || coefficients[base + 15] <= 0) throw clothError('INVALID_GPU_BATCH', 'Packed constraint metadata is invalid');
    const local = new Set();
    for (let j = 0; j < count; j++) { const id = words[base + j]; if (id >= batch.positions.length / 4 || occupied.has(id)) throw clothError('INVALID_GPU_BATCH', 'A GPU color references missing or shared vertices'); local.add(id); }
    for (const id of local) occupied.add(id);
    for (let j = 4; j < 16; j++) if (!Number.isFinite(coefficients[base + j])) throw clothError('INVALID_GPU_BATCH', 'Packed constraint values are nonfinite');
    if(kind<=2){
      const points=Array.from({length:words[base+19]},(_,index)=>Array.from(batch.curves.subarray((words[base+18]+index)*2,(words[base+18]+index+1)*2)));
      normalizeClothCurve({status:'estimated',points},'Packed physical material curve',{energy:kind===2,angleUnit:'radians'});
    }
  }
  return batch;
}

/** Caller owns submission/readback. This pass does not claim GPU contact/settling. */
export class GpuTriangularClothConstraintPass {
  constructor(device, options = {}) {
    initializePrimitiveLifecycle(this, device, options, 'GpuTriangularClothConstraintPass'); this._slots = [];
    const module = device.createShaderModule({ label: `${this.label} shader`, code: TRIANGULAR_CLOTH_CONSTRAINT_WGSL });
    this.pipeline = device.createComputePipeline({ label: this.label, layout: 'auto', compute: { module, entryPoint: 'project' } });
  }
  encode(encoder, batch, { generation = this.generation } = {}) {
    this._assertAlive(generation); assertCommandEncoder(encoder);
    validateTriangularClothGpuBatch(batch);
    const slot = acquireWorkspace(this, this._slots, () => ({ destroy() {} }), this.label), buffers = [];
    const upload = (data, label, output = false, uniform = false) => {
      const buffer = this.device.createBuffer({ label: `${this.label} ${label}`, size: Math.max(4, data.byteLength), usage: (uniform ? GPUBufferUsage.UNIFORM : GPUBufferUsage.STORAGE) | (output ? GPUBufferUsage.COPY_SRC : 0), mappedAtCreation: true });
      buffers.push(buffer); new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)); buffer.unmap(); return buffer;
    };
    try {
      const positions = upload(batch.positions, 'positions', true), constraints = upload(batch.constraints, 'constraints'), curves = upload(batch.curves, 'curves'), reports = upload(new Float32Array(batch.constraintCount * 4), 'diagnostics', true), range = upload(new Uint32Array([0, batch.constraintCount, 0, 0]), 'range', false, true);
      const bindGroup = this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [positions, constraints, curves, reports, range].map((buffer, binding) => ({ binding, resource: { buffer } })) });
      const pass = encoder.beginComputePass({ label: this.label }); pass.setPipeline(this.pipeline); pass.setBindGroup(0, bindGroup); pass.dispatchWorkgroups(Math.ceil(batch.constraintCount / 64)); pass.end();
      return createEncodeReceipt(this, slot, buffers, { kind: 'triangular-cloth-constraint-color', sourceRevision: batch.sourceRevision, positions, vertexMapping: batch.vertexMapping, reports, constraintCount: batch.constraintCount });
    } catch (error) { buffers.forEach(buffer => buffer.destroy()); slot.busy = false; throw error; }
  }
  destroy() { return destroyPrimitiveLifecycle(this, this._slots); }
}
