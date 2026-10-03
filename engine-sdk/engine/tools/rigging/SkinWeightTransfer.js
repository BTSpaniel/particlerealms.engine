// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { BVHBuilder, serializeBVHForGPU } from "../../core/math/BVHAccel.js";
import { mat4Identity } from "../../core/math/EngineMath.js";
import { mat4FromQuat, mat4TransformPoint } from "../../core/math/MathMat.js";

const EPS = 1e-12;

function d2PointAABB(p, bmin, bmax) {
  const dx = p[0] < bmin[0] ? (bmin[0] - p[0]) : (p[0] > bmax[0] ? (p[0] - bmax[0]) : 0);
  const dy = p[1] < bmin[1] ? (bmin[1] - p[1]) : (p[1] > bmax[1] ? (p[1] - bmax[1]) : 0);
  const dz = p[2] < bmin[2] ? (bmin[2] - p[2]) : (p[2] > bmax[2] ? (p[2] - bmax[2]) : 0);
  return dx * dx + dy * dy + dz * dz;
}

function closestPointBaryTri(p, a, b, c) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
  const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return { point: [a[0], a[1], a[2]], bary: [1, 0, 0] };

  const bpx = p[0] - b[0], bpy = p[1] - b[1], bpz = p[2] - b[2];
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return { point: [b[0], b[1], b[2]], bary: [0, 1, 0] };

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return { point: [a[0] + v * abx, a[1] + v * aby, a[2] + v * abz], bary: [1 - v, v, 0] };
  }

  const cpx = p[0] - c[0], cpy = p[1] - c[1], cpz = p[2] - c[2];
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return { point: [c[0], c[1], c[2]], bary: [0, 0, 1] };

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return { point: [a[0] + w * acx, a[1] + w * acy, a[2] + w * acz], bary: [1 - w, 0, w] };
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0) {
    const d43 = d4 - d3;
    const d56 = d5 - d6;
    if (d43 >= 0 && d56 >= 0) {
      const w = d43 / (d43 + d56);
      const bcx = c[0] - b[0], bcy = c[1] - b[1], bcz = c[2] - b[2];
      return { point: [b[0] + w * bcx, b[1] + w * bcy, b[2] + w * bcz], bary: [0, 1 - w, w] };
    }
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  const u = 1 - v - w;
  return {
    point: [a[0] * u + b[0] * v + c[0] * w, a[1] * u + b[1] * v + c[1] * w, a[2] * u + b[2] * v + c[2] * w],
    bary: [u, v, w],
  };
}

export function buildSourceSurfaceBVH(sourcePositions, sourceIndices) {
  if (!sourceIndices || sourceIndices.length < 3) {
    return { nodes: [], triIndices: [], triangles: [] };
  }
  const builder = new BVHBuilder();
  const bvh = builder.build(Array.from(sourcePositions), Array.from(sourceIndices));
  return bvh;
}

function findClosestOnSourceBVH(sourcePositions, sourceIndices, bvh, p) {
  if (!bvh || !bvh.nodes || bvh.nodes.length === 0) {
    return { tri: -1, bary: [1, 0, 0], point: [0, 0, 0], dist2: Infinity };
  }
  const nodes = bvh.nodes;
  const triIndices = bvh.triIndices;

  let bestTri = -1;
  let bestBary = [1, 0, 0];
  let bestPoint = [0, 0, 0];
  let bestDist2 = Infinity;

  const stack = new Uint32Array(256);
  let sp = 0;
  stack[sp++] = 0;

  while (sp > 0) {
    const nodeIdx = stack[--sp];
    const node = nodes[nodeIdx];
    if (d2PointAABB(p, node.min, node.max) >= bestDist2) continue;

    if (node.triCount > 0) {
      const first = node.leftChild_Or_FirstTri;
      for (let i = 0; i < node.triCount; i++) {
        const triIdx = triIndices[first + i];
        const i0 = (sourceIndices[triIdx * 3 + 0] * 3) | 0;
        const i1 = (sourceIndices[triIdx * 3 + 1] * 3) | 0;
        const i2 = (sourceIndices[triIdx * 3 + 2] * 3) | 0;
        const a = [sourcePositions[i0], sourcePositions[i0 + 1], sourcePositions[i0 + 2]];
        const b = [sourcePositions[i1], sourcePositions[i1 + 1], sourcePositions[i1 + 2]];
        const c = [sourcePositions[i2], sourcePositions[i2 + 1], sourcePositions[i2 + 2]];
        const cp = closestPointBaryTri(p, a, b, c);
        const dx = cp.point[0] - p[0];
        const dy = cp.point[1] - p[1];
        const dz = cp.point[2] - p[2];
        const dd = dx * dx + dy * dy + dz * dz;
        if (dd < bestDist2) {
          bestDist2 = dd;
          bestTri = triIdx;
          bestBary = cp.bary;
          bestPoint = cp.point;
        }
      }
    } else {
      const c1 = node.leftChild_Or_FirstTri;
      const c2 = c1 + 1;
      if (sp + 2 < stack.length) {
        stack[sp++] = c1;
        stack[sp++] = c2;
      }
    }
  }

  return { tri: bestTri, bary: bestBary, point: bestPoint, dist2: bestDist2 };
}

function packSourceInfluences8(j0, w0, j1, w1, vertexCount) {
  const joints8 = new Uint32Array(vertexCount * 8);
  const weights8 = new Float32Array(vertexCount * 8);
  for (let i = 0; i < vertexCount; i++) {
    const o8 = i * 8;
    const o4 = i * 4;
    joints8[o8 + 0] = (j0[o4 + 0] ?? 0) >>> 0;
    joints8[o8 + 1] = (j0[o4 + 1] ?? 0) >>> 0;
    joints8[o8 + 2] = (j0[o4 + 2] ?? 0) >>> 0;
    joints8[o8 + 3] = (j0[o4 + 3] ?? 0) >>> 0;
    weights8[o8 + 0] = w0[o4 + 0] ?? 0;
    weights8[o8 + 1] = w0[o4 + 1] ?? 0;
    weights8[o8 + 2] = w0[o4 + 2] ?? 0;
    weights8[o8 + 3] = w0[o4 + 3] ?? 0;
    joints8[o8 + 4] = (j1 ? (j1[o4 + 0] ?? 0) : 0) >>> 0;
    joints8[o8 + 5] = (j1 ? (j1[o4 + 1] ?? 0) : 0) >>> 0;
    joints8[o8 + 6] = (j1 ? (j1[o4 + 2] ?? 0) : 0) >>> 0;
    joints8[o8 + 7] = (j1 ? (j1[o4 + 3] ?? 0) : 0) >>> 0;
    weights8[o8 + 4] = w1 ? (w1[o4 + 0] ?? 0) : 0;
    weights8[o8 + 5] = w1 ? (w1[o4 + 1] ?? 0) : 0;
    weights8[o8 + 6] = w1 ? (w1[o4 + 2] ?? 0) : 0;
    weights8[o8 + 7] = w1 ? (w1[o4 + 3] ?? 0) : 0;
  }
  return { joints8, weights8 };
}

function combineInfluences8(joints8, weights8, vtx, scale, map) {
  const base = vtx * 8;
  for (let k = 0; k < 8; k++) {
    const w = weights8[base + k] * scale;
    if (!(w > 0)) continue;
    const j = joints8[base + k];
    map.set(j, (map.get(j) ?? 0) + w);
  }
}

function topKFromMap(map, k) {
  const entries = Array.from(map.entries());
  entries.sort((a, b) => b[1] - a[1]);
  const outJ = new Uint32Array(k);
  const outW = new Float32Array(k);
  let sum = 0;
  const n = Math.min(k, entries.length);
  for (let i = 0; i < n; i++) {
    outJ[i] = entries[i][0] >>> 0;
    outW[i] = entries[i][1];
    sum += outW[i];
  }
  if (sum > 0) {
    const inv = 1 / sum;
    for (let i = 0; i < n; i++) outW[i] *= inv;
  }
  return { joints: outJ, weights: outW };
}

function splitInfluences8(count, joints8, weights8) {
  const joints0 = new Uint16Array(count * 4);
  const weights0 = new Float32Array(count * 4);
  const joints1 = new Uint16Array(count * 4);
  const weights1 = new Float32Array(count * 4);

  for (let i = 0; i < count; i++) {
    const o8 = i * 8;
    const o4 = i * 4;
    joints0[o4 + 0] = joints8[o8 + 0] & 0xffff;
    joints0[o4 + 1] = joints8[o8 + 1] & 0xffff;
    joints0[o4 + 2] = joints8[o8 + 2] & 0xffff;
    joints0[o4 + 3] = joints8[o8 + 3] & 0xffff;
    weights0[o4 + 0] = weights8[o8 + 0];
    weights0[o4 + 1] = weights8[o8 + 1];
    weights0[o4 + 2] = weights8[o8 + 2];
    weights0[o4 + 3] = weights8[o8 + 3];
    joints1[o4 + 0] = joints8[o8 + 4] & 0xffff;
    joints1[o4 + 1] = joints8[o8 + 5] & 0xffff;
    joints1[o4 + 2] = joints8[o8 + 6] & 0xffff;
    joints1[o4 + 3] = joints8[o8 + 7] & 0xffff;
    weights1[o4 + 0] = weights8[o8 + 4];
    weights1[o4 + 1] = weights8[o8 + 5];
    weights1[o4 + 2] = weights8[o8 + 6];
    weights1[o4 + 3] = weights8[o8 + 7];
  }

  return { joints0, weights0, joints1, weights1 };
}

function hornFit(xs, ys, allowScale) {
  const n = xs.length;
  if (n === 0) return { mat: mat4Identity(), rms: 0 };

  let cx0 = 0, cx1 = 0, cx2 = 0;
  let cy0 = 0, cy1 = 0, cy2 = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const y = ys[i];
    cx0 += x[0]; cx1 += x[1]; cx2 += x[2];
    cy0 += y[0]; cy1 += y[1]; cy2 += y[2];
  }
  const invN = 1 / n;
  cx0 *= invN; cx1 *= invN; cx2 *= invN;
  cy0 *= invN; cy1 *= invN; cy2 *= invN;

  let sxx = 0, sxy = 0, sxz = 0;
  let syx = 0, syy = 0, syz = 0;
  let szx = 0, szy = 0, szz = 0;
  let denomScale = 0;

  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const y = ys[i];
    const x0 = x[0] - cx0, x1 = x[1] - cx1, x2 = x[2] - cx2;
    const y0 = y[0] - cy0, y1 = y[1] - cy1, y2 = y[2] - cy2;
    sxx += x0 * y0; sxy += x0 * y1; sxz += x0 * y2;
    syx += x1 * y0; syy += x1 * y1; syz += x1 * y2;
    szx += x2 * y0; szy += x2 * y1; szz += x2 * y2;
    denomScale += x0 * x0 + x1 * x1 + x2 * x2;
  }

  const tr = sxx + syy + szz;
  const n00 = tr;
  const n01 = syz - szy;
  const n02 = szx - sxz;
  const n03 = sxy - syx;
  const n11 = sxx - syy - szz;
  const n12 = sxy + syx;
  const n13 = szx + sxz;
  const n22 = -sxx + syy - szz;
  const n23 = syz + szy;
  const n33 = -sxx - syy + szz;

  const M = [
    [n00, n01, n02, n03],
    [n01, n11, n12, n13],
    [n02, n12, n22, n23],
    [n03, n13, n23, n33],
  ];

  let v0 = 1, v1 = 0, v2 = 0, v3 = 0;
  for (let it = 0; it < 24; it++) {
    const x0 = M[0][0] * v0 + M[0][1] * v1 + M[0][2] * v2 + M[0][3] * v3;
    const x1 = M[1][0] * v0 + M[1][1] * v1 + M[1][2] * v2 + M[1][3] * v3;
    const x2 = M[2][0] * v0 + M[2][1] * v1 + M[2][2] * v2 + M[2][3] * v3;
    const x3 = M[3][0] * v0 + M[3][1] * v1 + M[3][2] * v2 + M[3][3] * v3;
    const len = Math.sqrt(x0 * x0 + x1 * x1 + x2 * x2 + x3 * x3);
    if (len < EPS) break;
    v0 = x0 / len; v1 = x1 / len; v2 = x2 / len; v3 = x3 / len;
  }

  const q = [v1, v2, v3, v0];
  let R = mat4FromQuat(q);

  let scale = 1;
  if (allowScale && denomScale > EPS) {
    let num = 0;
    for (let i = 0; i < n; i++) {
      const x = xs[i];
      const y = ys[i];
      const x0 = x[0] - cx0, x1 = x[1] - cx1, x2 = x[2] - cx2;
      const rx = R[0] * x0 + R[4] * x1 + R[8] * x2;
      const ry = R[1] * x0 + R[5] * x1 + R[9] * x2;
      const rz = R[2] * x0 + R[6] * x1 + R[10] * x2;
      const y0 = y[0] - cy0, y1 = y[1] - cy1, y2 = y[2] - cy2;
      num += rx * y0 + ry * y1 + rz * y2;
    }
    scale = num / denomScale;
    if (!Number.isFinite(scale) || Math.abs(scale) < EPS) scale = 1;
  }

  R = new Float32Array(R);
  R[0] *= scale; R[1] *= scale; R[2] *= scale;
  R[4] *= scale; R[5] *= scale; R[6] *= scale;
  R[8] *= scale; R[9] *= scale; R[10] *= scale;

  const rcx0 = R[0] * cx0 + R[4] * cx1 + R[8] * cx2;
  const rcx1 = R[1] * cx0 + R[5] * cx1 + R[9] * cx2;
  const rcx2 = R[2] * cx0 + R[6] * cx1 + R[10] * cx2;

  const out = new Float32Array(R);
  out[12] = cy0 - rcx0;
  out[13] = cy1 - rcx1;
  out[14] = cy2 - rcx2;

  let err = 0;
  for (let i = 0; i < n; i++) {
    const p = mat4TransformPoint(out, xs[i]);
    const dx = p[0] - ys[i][0];
    const dy = p[1] - ys[i][1];
    const dz = p[2] - ys[i][2];
    err += dx * dx + dy * dy + dz * dz;
  }

  return { mat: out, rms: Math.sqrt(err / n) };
}

export function estimateAlignmentICP(opts) {
  const {
    sourcePositions,
    sourceIndices,
    targetPositions,
    sourceBVH = null,
    initialTargetToSource = null,
    iterations = 10,
    sampleCount = 2048,
    maxCorrespondenceDistance = Infinity,
    allowScale = true,
  } = opts;

  const bvh = sourceBVH ?? buildSourceSurfaceBVH(sourcePositions, sourceIndices);
  let T = initialTargetToSource ?? mat4Identity();

  if (!bvh || !bvh.nodes || bvh.nodes.length === 0) {
    return T;
  }

  const targetCount = Math.floor(targetPositions.length / 3);
  const nSamp = Math.max(1, Math.min(sampleCount, targetCount));
  const step = Math.max(1, Math.floor(targetCount / nSamp));

  let lastRms = Infinity;

  for (let it = 0; it < iterations; it++) {
    const xs = [];
    const ys = [];

    for (let vi = 0; vi < targetCount; vi += step) {
      const x = [targetPositions[vi * 3 + 0], targetPositions[vi * 3 + 1], targetPositions[vi * 3 + 2]];
      const xS = mat4TransformPoint(T, x);
      const hit = findClosestOnSourceBVH(sourcePositions, sourceIndices, bvh, xS);
      if (hit.tri < 0) continue;
      const dist = Math.sqrt(hit.dist2);
      if (!(dist <= maxCorrespondenceDistance)) continue;
      xs.push(x);
      ys.push(hit.point);
      if (xs.length >= nSamp) break;
    }

    const fit = hornFit(xs, ys, allowScale);
    T = fit.mat;
    if (Math.abs(lastRms - fit.rms) < 1e-6) break;
    lastRms = fit.rms;
  }

  return T;
}

export function transferSkinWeightsCPU(opts) {
  const {
    sourcePositions,
    sourceIndices,
    sourceJoints0,
    sourceWeights0,
    sourceJoints1,
    sourceWeights1,
    targetPositions,
    targetToSource = null,
    autoAlign = false,
    icpIterations = 10,
    icpSampleCount = 2048,
    maxCorrespondenceDistance = Infinity,
    allowScale = true,
    sourceBVH = null,
  } = opts;

  const sourceVertexCount = Math.floor(sourcePositions.length / 3);
  const targetVertexCount = Math.floor(targetPositions.length / 3);

  const packed = packSourceInfluences8(sourceJoints0, sourceWeights0, sourceJoints1, sourceWeights1, sourceVertexCount);

  const bvh = sourceBVH ?? buildSourceSurfaceBVH(sourcePositions, sourceIndices);

  let T = targetToSource ?? mat4Identity();
  if (autoAlign) {
    T = estimateAlignmentICP({
      sourcePositions,
      sourceIndices,
      targetPositions,
      sourceBVH: bvh,
      initialTargetToSource: T,
      iterations: icpIterations,
      sampleCount: icpSampleCount,
      maxCorrespondenceDistance,
      allowScale,
    });
  }

  const outJoints8 = new Uint32Array(targetVertexCount * 8);
  const outWeights8 = new Float32Array(targetVertexCount * 8);

  if (!bvh || !bvh.nodes || bvh.nodes.length === 0) {
    return { ...splitInfluences8(targetVertexCount, outJoints8, outWeights8), targetToSource: T };
  }

  for (let ti = 0; ti < targetVertexCount; ti++) {
    const tp = [targetPositions[ti * 3 + 0], targetPositions[ti * 3 + 1], targetPositions[ti * 3 + 2]];
    const sp = mat4TransformPoint(T, tp);
    const hit = findClosestOnSourceBVH(sourcePositions, sourceIndices, bvh, sp);
    const o8 = ti * 8;
    if (hit.tri < 0) {
      for (let k = 0; k < 8; k++) { outJoints8[o8 + k] = 0; outWeights8[o8 + k] = 0; }
      continue;
    }

    const triBase = hit.tri * 3;
    const v0 = sourceIndices[triBase + 0];
    const v1 = sourceIndices[triBase + 1];
    const v2 = sourceIndices[triBase + 2];

    const map = new Map();
    combineInfluences8(packed.joints8, packed.weights8, v0, hit.bary[0], map);
    combineInfluences8(packed.joints8, packed.weights8, v1, hit.bary[1], map);
    combineInfluences8(packed.joints8, packed.weights8, v2, hit.bary[2], map);

    const top = topKFromMap(map, 8);
    for (let k = 0; k < 8; k++) {
      outJoints8[o8 + k] = top.joints[k];
      outWeights8[o8 + k] = top.weights[k];
    }
  }

  return { ...splitInfluences8(targetVertexCount, outJoints8, outWeights8), targetToSource: T };
}

const WEIGHT_TRANSFER_WGSL = /* wgsl */ `
struct BVHNode {
  min: vec3<f32>,
  leftChild_Or_FirstTri: u32,
  max: vec3<f32>,
  triCount: u32,
}

struct Triangle {
  v0: vec4<f32>,
  v1: vec4<f32>,
  v2: vec4<f32>,
}

struct Params {
  targetToSource: mat4x4<f32>,
  targetVertexCount: u32,
  nodeCount: u32,
  triangleCount: u32,
  _pad0: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> nodes: array<BVHNode>;
@group(0) @binding(2) var<storage, read> bvhTriIndices: array<u32>;
@group(0) @binding(3) var<storage, read> triangles: array<Triangle>;
@group(0) @binding(4) var<storage, read> sourceIndices: array<u32>;
@group(0) @binding(5) var<storage, read> sourceJoints8: array<u32>;
@group(0) @binding(6) var<storage, read> sourceWeights8: array<f32>;
@group(0) @binding(7) var<storage, read> targetPos: array<vec4<f32>>;
@group(0) @binding(8) var<storage, read_write> outJoints8: array<u32>;
@group(0) @binding(9) var<storage, read_write> outWeights8: array<f32>;

fn dist2PointAABB(p: vec3<f32>, bmin: vec3<f32>, bmax: vec3<f32>) -> f32 {
  let dx = select(0.0, bmin.x - p.x, p.x < bmin.x) + select(0.0, p.x - bmax.x, p.x > bmax.x);
  let dy = select(0.0, bmin.y - p.y, p.y < bmin.y) + select(0.0, p.y - bmax.y, p.y > bmax.y);
  let dz = select(0.0, bmin.z - p.z, p.z < bmin.z) + select(0.0, p.z - bmax.z, p.z > bmax.z);
  return dx * dx + dy * dy + dz * dz;
}

struct ClosestTri {
  triIdx: u32,
  bary: vec3<f32>,
  dist2: f32,
  found: u32,
}

fn closestPointBaryTriangle(p: vec3<f32>, a: vec3<f32>, b: vec3<f32>, c: vec3<f32>) -> vec3<f32> {
  let ab = b - a;
  let ac = c - a;
  let ap = p - a;
  let d1 = dot(ab, ap);
  let d2 = dot(ac, ap);
  if (d1 <= 0.0 && d2 <= 0.0) { return vec3<f32>(1.0, 0.0, 0.0); }
  let bp = p - b;
  let d3 = dot(ab, bp);
  let d4 = dot(ac, bp);
  if (d3 >= 0.0 && d4 <= d3) { return vec3<f32>(0.0, 1.0, 0.0); }
  let vc = d1 * d4 - d3 * d2;
  if (vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0) {
    let v = d1 / (d1 - d3);
    return vec3<f32>(1.0 - v, v, 0.0);
  }
  let cp = p - c;
  let d5 = dot(ab, cp);
  let d6 = dot(ac, cp);
  if (d6 >= 0.0 && d5 <= d6) { return vec3<f32>(0.0, 0.0, 1.0); }
  let vb = d5 * d2 - d1 * d6;
  if (vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0) {
    let w = d2 / (d2 - d6);
    return vec3<f32>(1.0 - w, 0.0, w);
  }
  let va = d3 * d6 - d5 * d4;
  if (va <= 0.0) {
    let d43 = d4 - d3;
    let d56 = d5 - d6;
    if (d43 >= 0.0 && d56 >= 0.0) {
      let w = d43 / (d43 + d56);
      return vec3<f32>(0.0, 1.0 - w, w);
    }
  }
  let denom = 1.0 / (va + vb + vc);
  let v = vb * denom;
  let w = vc * denom;
  let u = 1.0 - v - w;
  return vec3<f32>(u, v, w);
}

fn baryPoint(a: vec3<f32>, b: vec3<f32>, c: vec3<f32>, bary: vec3<f32>) -> vec3<f32> {
  return a * bary.x + b * bary.y + c * bary.z;
}

fn findClosestTriangle(p: vec3<f32>) -> ClosestTri {
  var best: ClosestTri;
  best.triIdx = 0u;
  best.bary = vec3<f32>(1.0, 0.0, 0.0);
  best.dist2 = 1e30;
  best.found = 0u;

  if (params.nodeCount == 0u) {
    return best;
  }

  var stack: array<u32, 64>;
  var sp: u32 = 0u;
  var nodeIdx: u32 = 0u;

  loop {
    let node = nodes[nodeIdx];
    if (dist2PointAABB(p, node.min, node.max) >= best.dist2) {
      if (sp == 0u) { break; }
      sp = sp - 1u;
      nodeIdx = stack[sp];
      continue;
    }

    if (node.triCount > 0u) {
      for (var i: u32 = 0u; i < node.triCount; i = i + 1u) {
        let triIdx = bvhTriIndices[node.leftChild_Or_FirstTri + i];
        if (triIdx >= params.triangleCount) { continue; }
        let tri = triangles[triIdx];
        let a = tri.v0.xyz;
        let b = tri.v1.xyz;
        let c = tri.v2.xyz;
        let bary = closestPointBaryTriangle(p, a, b, c);
        let q = baryPoint(a, b, c, bary);
        let d = q - p;
        let d2 = dot(d, d);
        if (d2 < best.dist2) {
          best.dist2 = d2;
          best.triIdx = triIdx;
          best.bary = bary;
          best.found = 1u;
        }
      }

      if (sp == 0u) { break; }
      sp = sp - 1u;
      nodeIdx = stack[sp];
      continue;
    }

    let child1 = node.leftChild_Or_FirstTri;
    let child2 = node.leftChild_Or_FirstTri + 1u;
    let d1 = dist2PointAABB(p, nodes[child1].min, nodes[child1].max);
    let d2 = dist2PointAABB(p, nodes[child2].min, nodes[child2].max);
    var near = child1;
    var far = child2;
    var dn = d1;
    var df = d2;
    if (d1 > d2) {
      near = child2;
      far = child1;
      dn = d2;
      df = d1;
    }

    if (dn >= best.dist2) {
      if (sp == 0u) { break; }
      sp = sp - 1u;
      nodeIdx = stack[sp];
    } else {
      nodeIdx = near;
      if (df < best.dist2 && sp < 64u) {
        stack[sp] = far;
        sp = sp + 1u;
      }
    }
  }

  return best;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let vi = gid.x;
  if (vi >= params.targetVertexCount) { return; }

  let outBase = vi * 8u;
  let tp = targetPos[vi].xyz;
  let sp4 = params.targetToSource * vec4<f32>(tp, 1.0);
  let sp = sp4.xyz / sp4.w;

  let best = findClosestTriangle(sp);
  if (best.found == 0u) {
    for (var k: u32 = 0u; k < 8u; k = k + 1u) {
      outJoints8[outBase + k] = 0u;
      outWeights8[outBase + k] = 0.0;
    }
    return;
  }

  let triBase = best.triIdx * 3u;
  let v0 = sourceIndices[triBase + 0u];
  let v1 = sourceIndices[triBase + 1u];
  let v2 = sourceIndices[triBase + 2u];

  var tmpJ: array<u32, 24>;
  var tmpW: array<f32, 24>;
  var n: u32 = 0u;

  for (var corner: u32 = 0u; corner < 3u; corner = corner + 1u) {
    let vtx = select(v0, select(v1, v2, corner == 2u), corner != 0u);
    let s = select(best.bary.x, select(best.bary.y, best.bary.z, corner == 2u), corner != 0u);
    let base = vtx * 8u;

    for (var k: u32 = 0u; k < 8u; k = k + 1u) {
      let w = sourceWeights8[base + k] * s;
      if (!(w > 0.0)) { continue; }
      let j = sourceJoints8[base + k];

      var found: bool = false;
      for (var t: u32 = 0u; t < n; t = t + 1u) {
        if (tmpJ[t] == j) {
          tmpW[t] = tmpW[t] + w;
          found = true;
        }
      }
      if (!found && n < 24u) {
        tmpJ[n] = j;
        tmpW[n] = w;
        n = n + 1u;
      }
    }
  }

  var selJ: array<u32, 8>;
  var selW: array<f32, 8>;
  var sum: f32 = 0.0;

  for (var kk: u32 = 0u; kk < 8u; kk = kk + 1u) {
    var bw: f32 = 0.0;
    var bi: u32 = 0u;
    for (var t: u32 = 0u; t < n; t = t + 1u) {
      if (tmpW[t] > bw) { bw = tmpW[t]; bi = t; }
    }
    if (!(bw > 0.0)) {
      selJ[kk] = 0u;
      selW[kk] = 0.0;
    } else {
      selJ[kk] = tmpJ[bi];
      selW[kk] = bw;
      sum = sum + bw;
      tmpW[bi] = -1.0;
    }
  }

  if (sum > 0.0) {
    let inv = 1.0 / sum;
    for (var kk: u32 = 0u; kk < 8u; kk = kk + 1u) {
      selW[kk] = selW[kk] * inv;
    }
  }

  for (var kk: u32 = 0u; kk < 8u; kk = kk + 1u) {
    outJoints8[outBase + kk] = selJ[kk];
    outWeights8[outBase + kk] = selW[kk];
  }
}
`;

export class SkinWeightTransferGPU {
  constructor(device, limits = {}) {
    this.device = device;
    this.maxSourceVertices = limits.maxSourceVertices ?? 131072;
    this.maxTriangles = limits.maxTriangles ?? 262144;
    this.maxNodes = limits.maxNodes ?? (this.maxTriangles * 2);
    this.maxTargetVertices = limits.maxTargetVertices ?? 131072;

    this.pipeline = null;
    this.bindGroupLayout = null;

    this.paramsBuffer = null;
    this.nodesBuffer = null;
    this.bvhTriIndicesBuffer = null;
    this.trianglesBuffer = null;
    this.sourceIndexBuffer = null;
    this.sourceJoints8Buffer = null;
    this.sourceWeights8Buffer = null;
    this.targetPosBuffer = null;
    this.outJoints8Buffer = null;
    this.outWeights8Buffer = null;
    this.readbackJoints = null;
    this.readbackWeights = null;

    this._params = new ArrayBuffer(80);
    this._pf = new Float32Array(this._params);
    this._pv = new DataView(this._params);
  }

  async init() {
    const device = this.device;
    const module = device.createShaderModule({ code: WEIGHT_TRANSFER_WGSL });

    this.bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 9, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      ],
    });

    this.pipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] }),
      compute: { module, entryPoint: "main" },
    });

    this.paramsBuffer = device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    this.nodesBuffer = device.createBuffer({ size: this.maxNodes * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.bvhTriIndicesBuffer = device.createBuffer({ size: this.maxTriangles * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.trianglesBuffer = device.createBuffer({ size: this.maxTriangles * 48, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });

    this.sourceIndexBuffer = device.createBuffer({ size: this.maxTriangles * 3 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.sourceJoints8Buffer = device.createBuffer({ size: this.maxSourceVertices * 8 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.sourceWeights8Buffer = device.createBuffer({ size: this.maxSourceVertices * 8 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.targetPosBuffer = device.createBuffer({ size: this.maxTargetVertices * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.outJoints8Buffer = device.createBuffer({ size: this.maxTargetVertices * 8 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    this.outWeights8Buffer = device.createBuffer({ size: this.maxTargetVertices * 8 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    this.readbackJoints = device.createBuffer({ size: this.maxTargetVertices * 8 * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    this.readbackWeights = device.createBuffer({ size: this.maxTargetVertices * 8 * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  }

  async transfer(opts) {
    const {
      sourcePositions,
      sourceIndices,
      sourceJoints0,
      sourceWeights0,
      sourceJoints1,
      sourceWeights1,
      targetPositions,
      targetToSource = null,
      autoAlign = false,
      icpIterations = 10,
      icpSampleCount = 2048,
      maxCorrespondenceDistance = Infinity,
      allowScale = true,
      returnGpuBuffers = false,
      sourceBVH = null,
    } = opts;

    const device = this.device;
    const sourceVertexCount = Math.floor(sourcePositions.length / 3);
    const triangleCount = Math.floor(sourceIndices.length / 3);
    const targetVertexCount = Math.floor(targetPositions.length / 3);

    if (sourceVertexCount > this.maxSourceVertices) throw new Error("SkinWeightTransferGPU: source vertex capacity exceeded");
    if (triangleCount > this.maxTriangles) throw new Error("SkinWeightTransferGPU: triangle capacity exceeded");
    if (targetVertexCount > this.maxTargetVertices) throw new Error("SkinWeightTransferGPU: target vertex capacity exceeded");

    const packed = packSourceInfluences8(sourceJoints0, sourceWeights0, sourceJoints1, sourceWeights1, sourceVertexCount);

    let T = targetToSource ?? mat4Identity();
    if (autoAlign) {
      const bvh = sourceBVH ?? buildSourceSurfaceBVH(sourcePositions, sourceIndices);
      T = estimateAlignmentICP({
        sourcePositions,
        sourceIndices,
        targetPositions,
        sourceBVH: bvh,
        initialTargetToSource: T,
        iterations: icpIterations,
        sampleCount: icpSampleCount,
        maxCorrespondenceDistance,
        allowScale,
      });
    }

    const targetPos4 = new Float32Array(targetVertexCount * 4);
    for (let i = 0; i < targetVertexCount; i++) {
      targetPos4[i * 4 + 0] = targetPositions[i * 3 + 0];
      targetPos4[i * 4 + 1] = targetPositions[i * 3 + 1];
      targetPos4[i * 4 + 2] = targetPositions[i * 3 + 2];
      targetPos4[i * 4 + 3] = 1;
    }

    let nodeCount = 0;
    if (triangleCount > 0) {
      const bvh = sourceBVH ?? buildSourceSurfaceBVH(sourcePositions, sourceIndices);
      const gpu = serializeBVHForGPU(bvh);
      nodeCount = bvh.nodes.length;
      if (nodeCount > this.maxNodes) throw new Error("SkinWeightTransferGPU: BVH node capacity exceeded");
      device.queue.writeBuffer(this.nodesBuffer, 0, gpu.nodeBuffer);
      device.queue.writeBuffer(this.bvhTriIndicesBuffer, 0, gpu.triIndexBuffer);
      device.queue.writeBuffer(this.trianglesBuffer, 0, gpu.triangleBuffer);
    }

    device.queue.writeBuffer(this.sourceIndexBuffer, 0, sourceIndices);
    device.queue.writeBuffer(this.sourceJoints8Buffer, 0, packed.joints8);
    device.queue.writeBuffer(this.sourceWeights8Buffer, 0, packed.weights8);
    device.queue.writeBuffer(this.targetPosBuffer, 0, targetPos4);

    for (let i = 0; i < 16; i++) this._pf[i] = T[i];
    this._pv.setUint32(64, targetVertexCount >>> 0, true);
    this._pv.setUint32(68, nodeCount >>> 0, true);
    this._pv.setUint32(72, triangleCount >>> 0, true);
    this._pv.setUint32(76, 0, true);
    device.queue.writeBuffer(this.paramsBuffer, 0, this._params);

    const bindGroup = device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuffer } },
        { binding: 1, resource: { buffer: this.nodesBuffer } },
        { binding: 2, resource: { buffer: this.bvhTriIndicesBuffer } },
        { binding: 3, resource: { buffer: this.trianglesBuffer } },
        { binding: 4, resource: { buffer: this.sourceIndexBuffer } },
        { binding: 5, resource: { buffer: this.sourceJoints8Buffer } },
        { binding: 6, resource: { buffer: this.sourceWeights8Buffer } },
        { binding: 7, resource: { buffer: this.targetPosBuffer } },
        { binding: 8, resource: { buffer: this.outJoints8Buffer } },
        { binding: 9, resource: { buffer: this.outWeights8Buffer } },
      ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(targetVertexCount / 64));
    pass.end();

    if (returnGpuBuffers) {
      device.queue.submit([encoder.finish()]);
      return { outJoints8Buffer: this.outJoints8Buffer, outWeights8Buffer: this.outWeights8Buffer, targetToSource: T, targetVertexCount };
    }

    encoder.copyBufferToBuffer(this.outJoints8Buffer, 0, this.readbackJoints, 0, targetVertexCount * 8 * 4);
    encoder.copyBufferToBuffer(this.outWeights8Buffer, 0, this.readbackWeights, 0, targetVertexCount * 8 * 4);
    device.queue.submit([encoder.finish()]);

    await this.readbackJoints.mapAsync(GPUMapMode.READ, 0, targetVertexCount * 8 * 4);
    await this.readbackWeights.mapAsync(GPUMapMode.READ, 0, targetVertexCount * 8 * 4);

    const joints8 = new Uint32Array(this.readbackJoints.getMappedRange(0, targetVertexCount * 8 * 4).slice(0));
    const weights8 = new Float32Array(this.readbackWeights.getMappedRange(0, targetVertexCount * 8 * 4).slice(0));

    this.readbackJoints.unmap();
    this.readbackWeights.unmap();

    return { ...splitInfluences8(targetVertexCount, joints8, weights8), targetToSource: T };
  }
}

export async function transferSkinWeightsGPU(device, opts, limits = {}) {
  const xfer = new SkinWeightTransferGPU(device, limits);
  await xfer.init();
  return xfer.transfer(opts);
}
