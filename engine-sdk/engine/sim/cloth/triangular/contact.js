// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { vec3Sub as sub, vec3Cross as cross, vec3Dot as dot, vec3Length as length, vec3Scale as scale, vec3Add as add, vec3Lerp as lerp, vec3LerpInto, vec3SubInto, vec3Distance } from '../../../core/math/MathVec3.js';
import { triangleClosestPointWithWeights } from '../../../core/math/MathGeometry.js';
import { segmentClosestPointToSegment } from '../../../core/math/MathLine3.js';
import { AabbBvh } from '../../../core/math/AabbBvh.js';
import { planeIntersectSegment } from '../../../core/math/MathPlane.js';
import { clothError, clothNumber as number } from './materials.js';
import { setClothPosition } from './model.js';

const TOLERANCE = 1e-9;
const unit = (vector, fallback = [0, 1, 0]) => { const magnitude=length(vector);return magnitude>1e-15?scale(vector,1/magnitude):fallback; };
const vector = (value, name) => {
  if (!Array.isArray(value) || value.length !== 3) throw clothError('INVALID_COLLIDER', `${name} requires three coordinates`);
  return value.map(x => number(x, name, -1e6, 1e6));
};
const mm = (value, name) => vector(value, name).map(x => x / 1000);
const bounds = (points, padding = 0) => {
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const point of points)for(let axis=0;axis<3;axis++){min[axis]=Math.min(min[axis],point[axis]);max[axis]=Math.max(max[axis],point[axis]);}
  for(let axis=0;axis<3;axis++){min[axis]-=padding;max[axis]+=padding;}return {min,max};
};
const weighted = (points, weights) => [0, 1, 2].map(axis => points.reduce((total, p, i) => total + p[axis] * weights[i], 0));
const BINOMIAL = Array.from({ length: 9 }, (_, n) => Array.from({ length: n + 1 }, (_, k) => { let result = 1; for (let i = 1; i <= k; i++) result *= (n - i + 1) / i; return result; }));
const BERNSTEIN = BINOMIAL.map((row, n) => row.map((_, k) => Array.from({ length: k + 1 }, (_, i) => BINOMIAL[k][i] / row[i])));
const bounded = values => { const matrix = BERNSTEIN[values.length - 1], result = Array(values.length); for (let k = 0; k < values.length; k++) { let value = 0; for (let i = 0; i <= k; i++) value += values[i] * matrix[k][i]; result[k] = value; } return result; };
// Directed floating-point enclosures are used only for difficult CCD planes.
// Error follows each coordinate/product, rather than an unrelated long edge:
// almost-parallel edges otherwise lose their entire clearance to a global bound.
const enclosure = value => [value, value];
const outward = (low, high) => [low - (4 * Number.EPSILON * Math.abs(low) + Number.MIN_VALUE), high + (4 * Number.EPSILON * Math.abs(high) + Number.MIN_VALUE)];
const intervalAdd = (a, b) => a[0] === 0 && a[1] === 0 ? b : b[0] === 0 && b[1] === 0 ? a : outward(a[0] + b[0], a[1] + b[1]);
const intervalSubtract = (a, b) => intervalAdd(a, [-b[1], -b[0]]);
const intervalMultiply = (a, b) => {
  if ((a[0] === 0 && a[1] === 0) || (b[0] === 0 && b[1] === 0)) return [0, 0];
  const products = [a[0]*b[0], a[0]*b[1], a[1]*b[0], a[1]*b[1]];
  return outward(Math.min(...products), Math.max(...products));
};
const intervalDot = (a, b) => a.reduce((result, value, i) => intervalAdd(result, intervalMultiply(value, b[i])), [0, 0]);
const intervalCross = (a, b) => [0, 1, 2].map(i => intervalSubtract(intervalMultiply(a[(i+1)%3], b[(i+2)%3]), intervalMultiply(a[(i+2)%3], b[(i+1)%3])));
const intervalBounds = coefficients => BERNSTEIN[coefficients.length - 1].map(row => row.reduce((result, factor, i) => intervalAdd(result, intervalMultiply(coefficients[i], outward(factor, factor))), [0, 0]));

function certifiedMovingPlane(a, b, start, end, target) {
  const points = new Map([a, b].map(f => [f, [start, end].map(t => f.from.map((point, i) => point.map((value, axis) => intervalAdd(enclosure(value), intervalMultiply(enclosure(t), intervalSubtract(enclosure(f.to[i][axis]), enclosure(value)))))))]));
  const linear = (f, i, g, j) => {
    const first = points.get(f)[0][i].map((value, axis) => intervalSubtract(value, points.get(g)[0][j][axis]));
    const last = points.get(f)[1][i].map((value, axis) => intervalSubtract(value, points.get(g)[1][j][axis]));
    return [first, last.map((value, axis) => intervalSubtract(value, first[axis]))];
  };
  const displacement = linear(a, 0, b, 0);
  const first = a.from.length === 1 ? linear(b, 1, b, 0) : linear(a, 1, a, 0);
  const second = a.from.length === 1 ? linear(b, 2, b, 0) : linear(b, 1, b, 0);
  const normal = Array.from({length:3},()=>Array.from({length:3},()=>[0,0]));
  first.forEach((p,i)=>second.forEach((q,j)=>intervalCross(p,q).forEach((value,axis)=>{normal[i+j][axis]=intervalAdd(normal[i+j][axis],value);} )));
  if (normal[0].every(value=>value[0]===0 && value[1]===0)) normal.shift();
  const volume = Array.from({length:normal.length+1},()=>[0,0]), squared = Array.from({length:normal.length*2-1},()=>[0,0]);
  displacement.forEach((p,i)=>normal.forEach((q,j)=>{volume[i+j]=intervalAdd(volume[i+j],intervalDot(p,q));}));
  const signs=intervalBounds(volume);
  if (!signs.every(value=>value[0]>0) && !signs.every(value=>value[1]<0)) return false;
  normal.forEach((p,i)=>normal.forEach((q,j)=>{squared[i+j]=intervalAdd(squared[i+j],intervalDot(p,q));}));
  const difference=Array.from({length:volume.length*2-1},()=>[0,0]);
  volume.forEach((p,i)=>volume.forEach((q,j)=>{difference[i+j]=intervalAdd(difference[i+j],intervalMultiply(p,q));}));
  const radiusSquared=intervalMultiply(enclosure(target),enclosure(target));
  squared.forEach((value,i)=>{difference[i]=intervalSubtract(difference[i],intervalMultiply(radiusSquared,value));});
  return intervalBounds(difference).every(value=>value[0]>0);
}

export function normalizeClothColliders(descriptors) {
  if (!Array.isArray(descriptors) || descriptors.length > 128) throw clothError('INVALID_COLLIDER', 'At most 128 static collision shapes are supported');
  const identities = new Set();
  return descriptors.map(source => {
    if (typeof source.id !== 'string' || !source.id || identities.has(source.id)) throw clothError('INVALID_COLLIDER', 'Collision shapes need distinct identities');
    identities.add(source.id);
    const common = { id: source.id, kind: source.kind, friction: number(source.friction ?? .3, 'collider friction', 0, 5) };
    if (source.kind === 'plane') {
      const normal = vector(source.normal, 'plane normal'), magnitude = length(normal);
      if (magnitude < 1e-12) throw clothError('INVALID_COLLIDER', 'Plane normal must be nonzero');
      return { ...common, normal: scale(normal, 1 / magnitude), offset: number(source.offsetMm, 'plane offset mm') / 1000 };
    }
    if (source.kind === 'sphere') return { ...common, center: mm(source.centerMm, 'sphere center'), radius: number(source.radiusMm, 'sphere radius mm', .001, 1e6) / 1000 };
    if (source.kind === 'box') {
      const min = mm(source.minMm, 'box minimum'), max = mm(source.maxMm, 'box maximum');
      if (min.some((value, axis) => value >= max[axis])) throw clothError('INVALID_COLLIDER', 'An axis-aligned box needs positive extents');
      return { ...common, min, max };
    }
    if (source.kind === 'mesh') {
      if (!Array.isArray(source.positionsMm) || source.positionsMm.length < 3 || source.positionsMm.length > 20000 || !Array.isArray(source.triangles) || !source.triangles.length || source.triangles.length > 40000) throw clothError('INVALID_COLLIDER', 'Static mesh exceeds its geometry limits');
      const positions = source.positionsMm.map(p => mm(p, 'mesh position')), edges = new Map();
      const triangles = source.triangles.map(ids => {
        if (!Array.isArray(ids) || ids.length !== 3 || new Set(ids).size !== 3 || ids.some(id => !Number.isInteger(id) || id < 0 || id >= positions.length)) throw clothError('INVALID_COLLIDER', 'Static mesh triangle indices are invalid');
        if (length(cross(sub(positions[ids[1]], positions[ids[0]]), sub(positions[ids[2]], positions[ids[0]]))) < 1e-15) throw clothError('INVALID_COLLIDER', 'Static collision triangles must have positive area');
        for (let i = 0; i < 3; i++) { const edge = [ids[i], ids[(i + 1) % 3]]; edges.set([...edge].sort((a, b) => a - b).join(':'), edge); }
        return [...ids];
      });
      return { ...common, positions, triangles, edges: [...edges.values()] };
    }
    throw clothError('INVALID_COLLIDER', `Unsupported collision shape: ${source.kind}`);
  });
}

export function clothShapeDistance(shape, point) {
  if (shape.kind === 'plane') return { distance: dot(point, shape.normal) - shape.offset, normal: shape.normal };
  if (shape.kind === 'sphere') { const delta = sub(point, shape.center); return { distance: length(delta) - shape.radius, normal: unit(delta) }; }
  const closest = point.map((value, axis) => Math.max(shape.min[axis], Math.min(shape.max[axis], value))), delta = sub(point, closest), outside = length(delta);
  if (outside > 0) return { distance: outside, normal: scale(delta, 1 / outside) };
  let distance = Infinity, normal = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) for (const side of [0, 1]) {
    const gap = side ? shape.max[axis] - point[axis] : point[axis] - shape.min[axis];
    if (gap < distance) { distance = gap; normal = [0, 0, 0]; normal[axis] = side ? 1 : -1; }
  }
  return { distance: -distance, normal };
}

/** A Lipschitz speed bound advances conservatively, including solver movement. */
function conservativeContact(sample, speed, target, certifyInterval = null, proximity = TOLERANCE) {
  let t = 0, lastDistance = null;
  for (let iteration = 0; iteration < 64; iteration++) {
    const state = sample(t);
    lastDistance = state.distance;
    if (state.distance <= target + proximity) return { ...state, time: t };
    if (state.separatedThroughEnd) return null;
    if (t === 1 || speed < 1e-15) return null;
    if (iteration === 0 && certifyInterval?.(0, 1, state.normal)) return null;
    const advance = .9 * Math.max((state.distance - target) / speed, state.safeAdvance ?? 0);
    if (advance < 1e-12) return { ...state, time: t };
    t = Math.min(1, t + advance);
  }
  if (certifyInterval) {
    // A fast distant vertex can make the norm bound unhelpful near a local
    // contact. Ordered interval subdivision instead certifies complete swept
    // hulls, visiting the earliest interval first. This is a separate bounded
    // geometric test, not a larger conservative-advance iteration allowance.
    const intervals = [[t, 1]];
    for (let node = 0; node < 256 && intervals.length; node++) {
      const [start, end] = intervals.pop();
      if (certifyInterval(start, end)) continue;
      const state = sample(start);
      if (state.distance <= target + proximity || (end - start) * speed <= TOLERANCE) return { ...state, time: start };
      const midpoint = (start + end) / 2;
      if (midpoint <= start || midpoint >= end) throw clothError('CONTACT_BUDGET_EXHAUSTED', 'A swept contact interval cannot be subdivided safely', { start, end, speed });
      intervals.push([midpoint, end], [start, midpoint]);
    }
    if (!intervals.length) return null;
  }
  throw clothError('CONTACT_BUDGET_EXHAUSTED', `Swept contact could not be certified within 64 advances${certifyInterval ? ' and 256 interval checks' : ''}`, { time: t, lastDistance, target, speed });
}

/** Build the exact swept-hull support test shared by complete CCD and cached
 * separating-plane proofs. A candidate direction proves separation only when
 * ALL relative endpoints support it past the physical radius and the same
 * floating-point roundoff allowance.
 */
function sweptFeatureSupport(a, b, start, end, target) {
  const points = [];
  for (const t of [start, end]) for (let i = 0; i < a.from.length; i++) for (let j = 0; j < b.from.length; j++) points.push(sub(lerp(a.from[i], a.to[i], t), lerp(b.from[j], b.to[j], t)));
  // TOLERANCE is a proximity/response threshold, not extra physical thickness.
  // A separating hull needs to exclude the physical radius. Keep an absolute
  // roundoff allowance for interpolation, subtraction, normalization and dot
  // products: fewer than 32 rounded operations, conservatively doubled here.
  // Original-coordinate magnitudes cover cancellation under large translations.
  const coordinateScale = Math.max(target, ...[...a.from, ...a.to, ...b.from, ...b.to].map(point => point.reduce((sum, value) => sum + Math.abs(value), 0)));
  const separationMargin = 64 * Number.EPSILON * coordinateScale;
  const separates = candidate => {
    const magnitude = length(candidate); if (magnitude < 1e-30) return false;
    const normal = scale(candidate, 1 / magnitude);
    return points.every(point => dot(point, normal) > target + separationMargin);
  };
  return { points, separationMargin, separates };
}

/** The swept relative features lie inside the hull of at most eight endpoints.
 * Enumerating triangle candidates also covers edge/vertex closest features;
 * an interior origin can never pass the all-point support check.
 */
function sweptFeatureSeparated(a, b, start, end, target, preferredNormal = null) {
  const { points, separationMargin, separates } = sweptFeatureSupport(a, b, start, end, target);
  if (preferredNormal && separates(preferredNormal)) return true;
  // A rotating closest feature often has a valid fixed separator near the
  // middle/end of the sweep even when the start normal fails. These cheap
  // candidates still require every swept hull point to pass the same bound.
  // Try them before allocating polynomial interval certificates.
  const type=a.from.length===1?'vertex-triangle':'edge-edge';
  for(const time of [end,(start+end)/2]){
    const left=a.from.map((point,i)=>lerp(point,a.to[i],time)),right=b.from.map((point,i)=>lerp(point,b.to[i],time));
    if(separates(closestFeatureState(left,right,type).normal))return true;
  }
  if (movingPlaneSeparated(a, b, start, end, target, true)) return true;
  for (let i = 0; i < points.length - 2; i++) for (let j = i + 1; j < points.length - 1; j++) for (let k = j + 1; k < points.length; k++) {
    // Thin swept hull faces can lose precision in barycentric reconstruction.
    // Their direct plane normals remain valid candidate certificates; both
    // orientations still have to pass the exact same all-point support test.
    const planeNormal = cross(sub(points[j], points[i]), sub(points[k], points[i]));
    if (separates(planeNormal) || separates(scale(planeNormal, -1))) return true;
    const closest = triangleClosestPointWithWeights([0, 0, 0], points[i], points[j], points[k]).point, magnitude = length(closest);
    if (magnitude <= target + separationMargin) continue;
    if (separates(closest)) return true;
  }
  return false;
}

/** Certify the distance from a linearly moving point to a moving plane.
 * The plane normal is quadratic and its signed volume is cubic. Bernstein
 * bounds certify the entire interval, including rotating planes for which the
 * convex hull of endpoint triangles contains spurious near-contact points.
 * Edge pairs use their common perpendicular, so this is sufficient (never
 * necessary) separation of their infinite lines. Degenerate planes fall back.
 */
function movingPlaneSeparated(a, b, start, end, target, includeBoundary = false) {
  const endpoints = new Map([a, b].map(f => [f, [f.from.map((p, i) => lerp(p, f.to[i], start)), f.from.map((p, i) => lerp(p, f.to[i], end))]]));
  const at = (f, i, t) => endpoints.get(f)[t === start ? 0 : 1][i];
  const linear = (f, i, g, j) => { const p = sub(at(f, i, start), at(g, j, start)); return [p, sub(sub(at(f, i, end), at(g, j, end)), p)]; };
  const displacement = linear(a, 0, b, 0);
  const first = a.from.length === 1 ? linear(b, 1, b, 0) : linear(a, 1, a, 0);
  const second = a.from.length === 1 ? linear(b, 2, b, 0) : linear(b, 1, b, 0);
  const normal = [cross(first[0], second[0]), add(cross(first[0], second[1]), cross(first[1], second[0])), cross(first[1], second[1])];
  // Exactly axis-parallel initial edges have a common perpendicular with a
  // removable t factor. Its limiting direction is a valid separating plane at
  // t=0 too. Do not infer exact parallelism from a rounded tiny cross product.
  const axis = first[0].findIndex(value => value !== 0), deflated = axis >= 0 && first[0].every((value,i)=>i===axis || value===0) && second[0].every((value,i)=>i===axis || value===0);
  if (deflated) normal.shift();
  const volume = Array(normal.length + 1).fill(0), normSquared = Array(normal.length * 2 - 1).fill(0);
  for (let i = 0; i < 2; i++) for (let j = 0; j < normal.length; j++) volume[i + j] += dot(displacement[i], normal[j]);
  for (let i = 0; i < normal.length; i++) for (let j = 0; j < normal.length; j++) normSquared[i + j] += dot(normal[i], normal[j]);
  const coefficients = Array(volume.length * 2 - 1).fill(0);
  for (let i = 0; i < volume.length; i++) for (let j = 0; j < volume.length; j++) coefficients[i + j] += volume[i] * volume[j];
  for (let i = 0; i < normSquared.length; i++) coefficients[i] -= target * target * normSquared[i];
  // A scale-aware roundoff envelope prevents zero-area planes and cancellation
  // from becoming separation certificates. No physical tolerance is inflated.
  const coordinateScale = Math.max(...[...a.from, ...a.to, ...b.from, ...b.to].flat().map(Math.abs), target);
  let crossScale = 0; for (let i=0;i<2;i++) for(let j=0;j<2;j++) if(!deflated || i+j>0) crossScale += length(first[i])*length(second[j]);
  const normalScale = normal.reduce((sum, value) => sum + length(value), 0);
  const volumeScale = volume.reduce((sum, value) => sum + Math.abs(value), 0);
  const volumeError = 512 * Number.EPSILON * Math.max(volumeScale, coordinateScale * crossScale);
  const squaredError = 512 * Number.EPSILON * Math.max(volumeScale * volumeScale, target * target * normalScale * normalScale) + 2 * volumeError * (volumeScale + volumeError);
  const signs = bounded(volume);
  if ((signs.every(value => value > volumeError) || signs.every(value => value < -volumeError)) && bounded(coefficients).every(value => value > squaredError)) return true;
  if (certifiedMovingPlane(a, b, start, end, target)) return true;
  if (!includeBoundary) return false;
  const polynomialCross = (left, right) => {
    const result = Array.from({ length: left.length + right.length - 1 }, () => [0, 0, 0]);
    left.forEach((p, i) => right.forEach((q, j) => { result[i + j] = add(result[i + j], cross(p, q)); })); return result;
  };
  const gaps = [];
  for (let i = 0; i < a.from.length; i++) for (let j = 0; j < b.from.length; j++) gaps.push(linear(a, i, b, j));
  const separated = candidate => {
    const magnitude = candidate.reduce((sum, value) => sum + length(value), 0);
    if (magnitude < 1e-30) return false;
    const squared = Array(candidate.length * 2 - 1).fill(0);
    candidate.forEach((p, i) => candidate.forEach((q, j) => { squared[i + j] += dot(p, q); }));
    for (const gap of gaps) {
      const projection = Array(candidate.length + 1).fill(0);
      gap.forEach((p, i) => candidate.forEach((q, j) => { projection[i + j] += dot(p, q); }));
      const error = 2048 * Number.EPSILON * coordinateScale * magnitude;
      if (!bounded(projection).every(value => value > error)) return false;
      const squareGap = Array(projection.length * 2 - 1).fill(0);
      projection.forEach((p, i) => projection.forEach((q, j) => { squareGap[i + j] += p * q; }));
      squared.forEach((value, i) => { squareGap[i] -= target * target * value; });
      const projectionScale = projection.reduce((sum, value) => sum + Math.abs(value), 0);
      const roundoff = 2048 * Number.EPSILON * (projectionScale * projectionScale + target * target * magnitude * magnitude) + 2 * error * (projectionScale + error);
      if (!bounded(squareGap).every(value => value > roundoff)) return false;
    }
    return true;
  };
  // Closest points can lie beyond an infinite line/plane. Moving endpoint and
  // edge-perpendicular axes certify those Voronoi regions without fixing their
  // barycentric coordinates at the start of the sweep.
  for (const gap of gaps) {
    if (separated(gap)) return true;
    for (const shape of [a, b]) for (let i = 0; i < shape.from.length; i++) for (let j = i + 1; j < shape.from.length; j++) {
      const edge = linear(shape, i, shape, j), axis = polynomialCross(edge, polynomialCross(gap, edge));
      if (separated(axis)) return true;
    }
  }
  return false;
}

function shapeProject(model, previous, id, shape) {
  const start = previous[id], end = model.positions[id], radius = model.thicknesses[id] / 2;
  let hit;
  if(shape.kind==='plane'){
    // Plane clearance is affine over the complete segment. Use the shared
    // analytic intersection rather than asymptotically advancing at contact.
    const first=clothShapeDistance(shape,start),last=clothShapeDistance(shape,end);
    if(first.distance<=radius+TOLERANCE)hit={...first,time:0};
    else if(last.distance<=radius+TOLERANCE){
      const intersection=planeIntersectSegment([...shape.normal,-shape.offset-radius],start,end,0);
      hit=intersection?{normal:shape.normal,distance:radius,time:intersection.t}:{...last,time:1};
    }else return 0;
  }else hit = conservativeContact(t => clothShapeDistance(shape, lerp(start, end, t)), length(sub(end, start)), radius);
  if (!hit) return 0;
  const anchor = lerp(start, end, hit.time), gap = dot(sub(end, anchor), hit.normal) + hit.distance, correction = Math.max(0, radius - gap);
  if (correction <= TOLERANCE) return 0;
  if (!model.inverseMasses[id]) throw clothError('PIN_CONTACT_CONFLICT', 'A fixed vertex penetrates a collision shape', { vertex: id, colliderId: shape.id });
  const move = sub(end, start), tangent = sub(move, scale(hit.normal, dot(move, hit.normal))), tangentLength = length(tangent);
  const friction = Math.min(model.frictions[id], shape.friction), slide = tangentLength > 0 ? Math.min(1, friction * correction / tangentLength) : 0;
  setClothPosition(model, id, add(end, sub(scale(hit.normal, correction + TOLERANCE), scale(tangent, slide))));
  model.lastContact = { type: 'shape', vertex: id, colliderId: shape.id, correctionMm: correction * 1000, hitTime: hit.time };
  return correction;
}

const feature = (ids, from, to, model, fixed = false, friction = .3, identity = '') => ({ ids, from: ids.map(id => from[id]), to: ids.map(id => to[id]), identity,
  fixed, friction: fixed ? friction : Math.min(...ids.map(id => model.frictions[id])), radius: fixed ? 0 : Math.max(...ids.map(id => model.thicknesses[id])) / 2,
  pieces: fixed || !model.exclusions.size ? [] : [...new Set(ids.flatMap(id => [...model.vertexPieces[id]]))] });

function eligible(model, a, b) {
  if (a.fixed && b.fixed) return false;
  if (!a.fixed && !b.fixed) {
    if (a.ids.some(id => b.ids.some(other => model.neighbors[id].has(other)))) return false;
    if (model.restChartContact(a.ids,b.ids,a.radius+b.radius)) return false;
    if (model.exclusions.size && a.pieces.some(left => b.pieces.some(right => model.exclusions.has([left, right].sort().join('\u0000'))))) return false;
  }
  return true;
}

function closestFeatureState(left,right,type) {
  if(type==='vertex-triangle'){
    const closest=triangleClosestPointWithWeights(left[0],...right),delta=sub(left[0],closest.point),distance=length(delta);
    return {distance,normal:distance>1e-15?scale(delta,1/distance):unit(cross(sub(right[1],right[0]),sub(right[2],right[0]))),leftWeights:[1],rightWeights:closest.weights};
  }
  const closest=segmentClosestPointToSegment({a:left[0],b:left[1]},{a:right[0],b:right[1]}),delta=sub(closest.point1,closest.point2);
  return {distance:closest.distance,normal:closest.distance>1e-15?scale(delta,1/closest.distance):unit(cross(sub(left[1],left[0]),sub(right[1],right[0]))),leftWeights:[1-closest.s,closest.s],rightWeights:[1-closest.t,closest.t]};
}

function featureSweep(a, b, type) {
  const leftMotion = a.from.map((p, i) => sub(a.to[i], p)), rightMotion = b.from.map((p, i) => sub(b.to[i], p));
  // The velocity of any pair of barycentric points is a convex combination
  // of these cross-feature differences. This bound cancels common translation
  // but still covers every vertex of a deforming triangle or edge.
  let speed=0;for(const left of leftMotion)for(const right of rightMotion)speed=Math.max(speed,vec3Distance(left,right));
  const target = a.radius + b.radius;
  const left=a.from.map(()=>[0,0,0]),right=b.from.map(()=>[0,0,0]),scratch=[0,0,0];
  const sample = t => {
    for(let i=0;i<left.length;i++)vec3LerpInto(left[i],a.from[i],a.to[i],t);
    for(let i=0;i<right.length;i++)vec3LerpInto(right[i],b.from[i],b.to[i],t);
    const certify = state => {
      // Every cross-vertex projected gap is affine in time for this fixed normal.
      // Advance only until the first closing pair could reach the thickness.
      // Convex combinations cannot cross this separating plane earlier, even
      // when closest weights/features change. Nonclosing vertices add no limit.
      let safeAdvance = Infinity;
      for (let i = 0; i < left.length; i++) for (let j = 0; j < right.length; j++) {
        const clearance = dot(vec3SubInto(scratch,left[i], right[j]), state.normal) - target - TOLERANCE;
        const rate = dot(vec3SubInto(scratch,leftMotion[i], rightMotion[j]), state.normal);
        if (clearance <= 0) safeAdvance = 0;
        else if (rate < 0) safeAdvance = Math.min(safeAdvance, clearance / -rate);
      }
      state.safeAdvance = Number.isFinite(safeAdvance) ? safeAdvance : 1 - t;
      state.separatedThroughEnd = safeAdvance >= 1 - t;
      return state;
    };
    return certify(closestFeatureState(left,right,type));
  };
  const findContact = (radius, proximity = TOLERANCE) => {
    try { return conservativeContact(sample, speed, radius, (start, end, normal) => sweptFeatureSeparated(a, b, start, end, radius, normal || sample(start).normal), proximity); }
    catch (error) { error.details = { ...error.details, type, leftIds: a.ids, rightIds: b.ids, leftFixed: a.fixed, rightFixed: b.fixed, leftFrom: a.from, leftTo: a.to, rightFrom: b.from, rightTo: b.to }; throw error; }
  };
  return { target, speed, sample, findContact };
}

function featureProject(model, a, b, type, continuous = true, originState = null) {
  model.lastContactTest = { type, leftIds: a.ids, rightIds: b.ids };
  model.lastContactActive=false;
  model.lastContactNear=false;
  // Earlier responses in this pass replace position arrays. Re-read endpoints
  // so subsequent contact geometry uses the current proposed configuration.
  if (!a.fixed) a = { ...a, to: a.ids.map(id => model.positions[id]) };
  if (!b.fixed) b = { ...b, to: b.ids.map(id => model.positions[id]) };
  // Cached closest-feature constraints accelerate elastic iterations. They are
  // only candidate endpoints: a complete fresh swept BVH/CCD pass still gates
  // acceptance of every physical substep, including new or changing features.
  if (!continuous) {
    // A currently touching pair has an oriented side established by the last
    // accepted physical state. Preserve it during elastic iterations: unsigned
    // endpoint distance alone can push a crossed layer farther through its
    // neighbour and leave the continuous gate to undo a whole iteration.
    if (originState && originState.distance <= a.radius + b.radius + Math.max(1e-6,(a.radius+b.radius)*.1)) {
      const gap = dot(sub(weighted(a.to, originState.leftWeights), weighted(b.to, originState.rightWeights)), originState.normal);
      const amount = a.radius + b.radius - gap;
      if (amount > TOLERANCE) { model.lastContactActive = true; return projectFeatureResponse(model, a, b, type, originState, amount); }
    }
    const endpoint=closestFeatureState(a.to,b.to,type), correction=a.radius+b.radius-endpoint.distance;
    model.lastContactActive=correction>=-TOLERANCE;
    return correction>TOLERANCE?projectFeatureResponse(model,a,b,type,endpoint,correction):0;
  }
  const {target,speed,sample,findContact}=featureSweep(a,b,type);
  const hit = findContact(target);
  if (!hit) {
    // A separated diagonal feature can overlap the swept AABB while remaining
    // just outside its physical shell. Retain only that narrow collar for the
    // elastic iterations: their endpoint corrections may close it before the
    // next complete CCD gate. Distant broad-phase candidates stay uncached.
    model.lastContactNear=closestFeatureState(a.to,b.to,type).distance<=2*target+TOLERANCE;
    return 0;
  }
  model.lastContactActive=true;
  const current = value => value.fixed ? value.to : value.ids.map(id => model.positions[id]);
  const correction = Math.max(0, target - dot(sub(weighted(current(a), hit.leftWeights), weighted(current(b), hit.rightWeights)), hit.normal));
  if (correction <= TOLERANCE) {
    // A touching feature's original closest weights may move away while a
    // different part crosses later (for example a tilting/sliding triangle).
    // Search for a violation beyond the SAME 1 nm response acceptance before
    // dismissing that sweep. Pure contact-tangent motion has no such violation.
    const violationRadius = Math.max(0, target - TOLERANCE);
    if (sweptFeatureSeparated(a, b, 0, 1, violationRadius, hit.normal)) return 0;
    const laterHit = findContact(violationRadius, 0);
    if (!laterHit) return 0;
    const endpointCorrection = Math.max(0, target - dot(sub(weighted(current(a), laterHit.leftWeights), weighted(current(b), laterHit.rightWeights)), laterHit.normal));
    // Endpoint positions can already lie outside while the swept features dip
    // through contact between them. A displacement at the endpoint contributes
    // t times that displacement at the hit. Search a bounded separating normal
    // response before sacrificing the whole feature's safe tangential motion.
    // Every candidate must independently pass the unchanged full CCD gate.
    const responseLimit=Math.max(endpointCorrection,speed);
    let required=endpointCorrection;
    for(let probe=1;probe<=8;probe++){
      const time=laterHit.time+(1-laterHit.time)*probe/8,state=sample(time);
      const left=a.from.map((point,i)=>lerp(point,a.to[i],time)),right=b.from.map((point,i)=>lerp(point,b.to[i],time));
      required=Math.max(required,(target-dot(sub(weighted(left,state.leftWeights),weighted(right,state.rightWeights)),laterHit.normal))/Math.max(time,1e-12));
    }
    let amount=Math.min(responseLimit,Math.max(required,2*TOLERANCE/Math.max(laterHit.time,1e-12)));
    for(let attempt=0;attempt<4&&amount>TOLERANCE;attempt++){
      const projected=projectFeatureResponse(model,a,b,type,laterHit,amount,true,true);
      if(projected!=null)return projected;
      if(amount===responseLimit)break;amount=Math.min(responseLimit,amount*2);
    }
    let maximumMovement = 0;
    for (const f of [a, b]) if (!f.fixed) for (let i = 0; i < f.ids.length; i++) {
      const id = f.ids[i], destination = lerp(f.from[i], f.to[i], laterHit.time), movement = length(sub(model.positions[id], destination));
      if (!model.inverseMasses[id] && movement > TOLERANCE) throw clothError('PIN_CONTACT_CONFLICT', 'A continuous contact requires moving a fixed feature', { vertex: id });
      if (model.inverseMasses[id]) { setClothPosition(model, id, destination); maximumMovement = Math.max(maximumMovement, movement); }
    }
    model.lastContact = { type, leftIds: a.ids, rightIds: b.ids, correctionMm: maximumMovement * 1000, hitTime: laterHit.time, response: 'conservative-feature-clamp' };
    return maximumMovement;
  }
  return projectFeatureResponse(model, a, b, type, hit, correction);
}

function projectFeatureResponse(model, a, b, type, hit, correction, requireCertificate = false, rigidFeature = false) {
  const current = value => value.fixed ? value.to : value.ids.map(id => model.positions[id]);
  const entries = [a, b].flatMap((f, side) => {
    if(f.fixed || rigidFeature&&f.ids.some(id=>!model.inverseMasses[id]))return [];
    const mass=rigidFeature?f.ids.reduce((sum,id)=>sum+1/model.inverseMasses[id],0):0;
    return f.ids.map((id,i)=>({id,weight:(side?-1:1)*(rigidFeature?1/(model.inverseMasses[id]*mass):(side?hit.rightWeights[i]:hit.leftWeights[i]))}));
  });
  const denominator = entries.reduce((sum, value) => sum + model.inverseMasses[value.id] * value.weight ** 2, 0);
  if (denominator <= 0) throw clothError('PIN_CONTACT_CONFLICT', 'Fixed cloth features overlap', { vertices: entries.map(entry => entry.id) });
  const movement = sub(sub(weighted(current(a), hit.leftWeights), weighted(a.from, hit.leftWeights)), sub(weighted(current(b), hit.rightWeights), weighted(b.from, hit.rightWeights)));
  const tangent = sub(movement, scale(hit.normal, dot(movement, hit.normal))), tangentLength = length(tangent), frictionScale = tangentLength > 0 ? Math.min(1, Math.min(a.friction, b.friction) * correction / tangentLength) : 0;
  const response = sub(scale(hit.normal, correction + TOLERANCE), scale(tangent, frictionScale));
  const proposed = new Map(entries.map(({ id, weight }) => [id, add(model.positions[id], scale(response, model.inverseMasses[id] * weight / denominator))]));
  if (requireCertificate) {
    const updated = f => f.fixed ? f : { ...f, to: f.ids.map(id => proposed.get(id) || model.positions[id]) };
    const left=updated(a),right=updated(b),radius=Math.max(0,a.radius+b.radius-TOLERANCE);
    if (!sweptFeatureSeparated(left,right,0,1,radius,hit.normal)) {
      // A single separating plane is sufficient, not necessary. Reuse the full
      // bounded CCD/interval path before discarding a safe normal response and
      // clamping unrelated tangential motion of the entire feature.
      try { if(featureSweep(left,right,type).findContact(radius,0))return null; }
      catch(error){if(error.code==='CONTACT_BUDGET_EXHAUSTED')return null;throw error;}
    }
  }
  model.lastContact = { type, leftIds: a.ids, rightIds: b.ids, correctionMm: correction * 1000, hitTime: hit.time, response:requireCertificate?(rigidFeature?'certified-rigid-normal':'certified-normal'):'normal' };
  if (model.collectContactConstraints) {
    const gradients = new Map();
    for (const [f, weights, sign] of [[a, hit.leftWeights, 1], [b, hit.rightWeights, -1]]) if (!f.fixed) f.ids.forEach((id, i) => {
      const root=model.vertexDof[id];if(!model.inverseMasses[root])return;
      const gradient=scale(hit.normal,weights[i]*sign);gradients.set(root,gradients.has(root)?add(gradients.get(root),gradient):gradient);
    });
    const ids=[...gradients.keys()], values=[...gradients.values()], gap=dot(sub(weighted(current(a),hit.leftWeights),weighted(current(b),hit.rightWeights)),hit.normal);
    const offset=a.radius+b.radius+TOLERANCE-gap+ids.reduce((sum,id,i)=>sum+dot(values[i],model.positions[id]),0);
    if(ids.length)model.contactLinearConstraints.set(JSON.stringify([type,a.ids,b.ids,a.fixed,b.fixed]),{ids,gradients:values,offset});
  }
  for (const [id, position] of proposed) setClothPosition(model, id, position);
  return correction;
}

const CONTACT_SWEEP_PRUNE_FEATURE_LIMIT = 768;
const assignContactSweepOrder = collection => collection.map((value, originalOrder) => ({ value, originalOrder }))
  .sort((a, b) => a.value.bounds.min[0] - b.value.bounds.min[0] || a.originalOrder - b.originalOrder)
  .map(({ value }, sweepOrder) => { value.sweepOrder = sweepOrder; return value; });
const overlapsContactAxes = (a, b) => a.min[1] <= b.max[1] && a.max[1] >= b.min[1] && a.min[2] <= b.max[2] && a.max[2] >= b.min[2];

/** Exact bounded sweep-and-prune for small cloth feature sets. The active set
 * stays in ascending sweep order, so yielded pairs already match the reference
 * (major, minor) Gauss-Seidel order and need no candidate array or final sort.
 * A null yield is a cooperative checkpoint rather than a candidate.
 */
function* sweepAndPruneContactPairs(left, right, type, allowed, vertexTriangleCertificateCount, metrics) {
  const same = left === right;
  const tagged = same
    ? left.map((value, sourceIndex) => ({ value, sourceIndex, kind: 0, originalOrder: sourceIndex }))
    : [...left.map((value, sourceIndex) => ({ value, sourceIndex, kind: 0, originalOrder: sourceIndex })), ...right.map((value, sourceIndex) => ({ value, sourceIndex, kind: 1, originalOrder: left.length + sourceIndex }))];
  tagged.sort((a, b) => a.value.bounds.min[0] - b.value.bounds.min[0] || a.originalOrder - b.originalOrder);
  tagged.forEach((entry, sweepOrder) => { entry.value.sweepOrder = sweepOrder; entry.sweepOrder = sweepOrder; });
  const active = [], emitted = {};
  for (const current of tagged) {
    let retained = 0;
    for (const entry of active) if (entry.value.bounds.max[0] >= current.value.bounds.min[0]) active[retained++] = entry;
    active.length = retained;
    for (const prior of active) {
      metrics.activeComparisons++;
      if (metrics.activeComparisons % 128 === 0) yield null;
      if ((!same && current.kind === prior.kind) || !overlapsContactAxes(current.value.bounds, prior.value.bounds)) continue;
      metrics.aabbOverlaps++;
      if (type === 'vertex-triangle') {
        const vertex = current.kind === 0 ? current : prior, triangle = current.kind === 1 ? current : prior;
        if (!allowed(vertex.value, triangle.value)) continue;
        Object.assign(emitted, { a: vertex.value, b: triangle.value, certificateLeft: vertex.value, certificateRight: triangle.value,
          certificateKey: vertex.sourceIndex * right.length + triangle.sourceIndex, major: current.sweepOrder, minor: prior.sweepOrder });
      } else {
        const lowIndex = Math.min(current.sourceIndex, prior.sourceIndex), highIndex = Math.max(current.sourceIndex, prior.sourceIndex);
        const certificateLeft = left[lowIndex], certificateRight = right[highIndex];
        if (!allowed(certificateLeft, certificateRight)) continue;
        Object.assign(emitted, { a: current.value, b: prior.value, certificateLeft, certificateRight,
          certificateKey: vertexTriangleCertificateCount + lowIndex * right.length + highIndex, major: current.sweepOrder, minor: prior.sweepOrder });
      }
      metrics.eligiblePairs++;
      yield emitted;
    }
    active.push(current);
  }
}

/** Bounded sweep-and-prune handles interactive cloth; the shared Engine BVH is
 * retained for large imported meshes. Both paths emit the same ordered pairs. */
function* projectClothContacts(model, previous, { continuous = true, retainSolverState = true, reuseCertifiedSeparations = true, broadPhase = 'auto', captureBroadPhasePairs = null } = {}) {
  const started=performance.now();
  if (!['auto', 'sweep-and-prune', 'bvh'].includes(broadPhase)) throw clothError('INVALID_INPUT', `Unknown cloth contact broad phase: ${broadPhase}`);
  if (captureBroadPhasePairs != null && !Array.isArray(captureBroadPhasePairs)) throw clothError('INVALID_INPUT', 'captureBroadPhasePairs must be an array');
  model.collectContactConstraints=continuous && retainSolverState;
  if(!continuous||!model.contactLinearConstraints)model.contactLinearConstraints=new Map();
  const reuseCertificates=continuous&&reuseCertifiedSeparations;
  const priorCertificates=reuseCertificates&&model.contactCertificateOrigin===previous?model.contactCertificates||new Map():new Map();
  const nextCertificates=new Map();
  // During one sweptFrom phase, advection is complete and every solver
  // correction replaces a point array through setClothPosition. Point identity
  // is therefore a conservative, allocation-free unchanged-endpoint proof.
  // A numerically identical replacement intentionally invalidates the cache.
  const endpointReferences=value=>value.fixed?[...value.to]:value.ids.map(id=>model.positions[id]);
  const sameEndpoints=(snapshot,value)=>snapshot.length===value.ids.length&&snapshot.every((point,index)=>point===(value.fixed?value.to[index]:model.positions[value.ids[index]]));
  // Exact sewn aliases share one physical trajectory. Repeating the same
  // contact feature for each cutting-panel identity adds contradictory ordering
  // and work, but no extra geometry. Retain distinct thickness, friction and
  // exclusion policies; only physically identical features are consolidated.
  if (!model.contactTopology) {
    const unique = rows => {
      const seen = new Set();
      return rows.filter(ids => {
        const physical = ids.map(id => model.vertexDof[id]).sort((a, b) => a - b);
        const key = JSON.stringify([physical, Math.max(...ids.map(id => model.thicknesses[id])), Math.min(...ids.map(id => model.frictions[id])), model.exclusions.size ? [...new Set(ids.flatMap(id => [...model.vertexPieces[id]]))].sort() : []]);
        if (seen.has(key)) return false; seen.add(key); return true;
      });
    };
    model.contactTopology = { vertices: unique(Array.from({ length: model.clothVertexCount }, (_, id) => [id])), edges: unique(model.edges) };
  }
  for (const [id] of model.contactTopology.vertices) for (const shape of model.colliders) if (shape.kind !== 'mesh') yield shapeProject(model, previous, id, shape);
  const vertices = [], triangles = [], edges = [];
  if (model.configuration.selfContact || model.colliders.some(shape => shape.kind === 'mesh')) {
    model.contactTopology.vertices.forEach((ids,index)=>vertices.push(feature(ids, previous, model.positions, model,false,.3,`cloth:vertex:${index}`)));
    model.triangles.forEach((triangle,index)=>triangles.push(feature(triangle.ids, previous, model.positions, model,false,.3,`cloth:triangle:${index}`)));
    model.contactTopology.edges.forEach((edge,index)=>edges.push(feature(edge, previous, model.positions, model,false,.3,`cloth:edge:${index}`)));
  }
  for (const shape of model.colliders) if (shape.kind === 'mesh') {
    for (let id = 0; id < shape.positions.length; id++) vertices.push(feature([id], shape.positions, shape.positions, model, true, shape.friction,`collider:${shape.id}:vertex:${id}`));
    shape.triangles.forEach((ids,index)=>triangles.push(feature(ids, shape.positions, shape.positions, model, true, shape.friction,`collider:${shape.id}:triangle:${index}`)));
    shape.edges.forEach((ids,index)=>edges.push(feature(ids, shape.positions, shape.positions, model, true, shape.friction,`collider:${shape.id}:edge:${index}`)));
  }
  let candidates = 0, visits = 0, activeCached = 0, nearCached = 0, certificateHits = 0, certificateMisses = 0, certificateInvalidations = 0, certificateWarmAttempts = 0, certificateWarmHits = 0, certificateWarmMisses = 0;
  const broadPhaseReports=[];
  const cachedPairs=[];
  const allowed = (a, b) => (model.configuration.selfContact || a.fixed || b.fixed) && eligible(model, a, b);
  const vertexTriangleCertificateCount=vertices.length*triangles.length;
  for (const [left, right, type] of [[vertices, triangles, 'vertex-triangle'], [edges, edges, 'edge-edge']]) {
    const collection = left === right ? left : [...left, ...right];
    for (const value of collection) value.bounds = bounds([...value.from, ...value.to], value.radius);
    const selectedBroadPhase=broadPhase==='auto'?(collection.length<=CONTACT_SWEEP_PRUNE_FEATURE_LIMIT?'sweep-and-prune':'bvh'):broadPhase;
    if(selectedBroadPhase==='sweep-and-prune'&&collection.length>CONTACT_SWEEP_PRUNE_FEATURE_LIMIT)throw clothError('CONTACT_BUDGET_EXHAUSTED',`Sweep-and-prune is bounded to ${CONTACT_SWEEP_PRUNE_FEATURE_LIMIT} features`,{type,features:collection.length});
    const broadPhaseReport={type,broadPhase:selectedBroadPhase,features:collection.length,leftFeatures:left.length,rightFeatures:right.length,activeComparisons:0,aabbOverlaps:0,eligiblePairs:0};
    broadPhaseReports.push(broadPhaseReport);
    let pairSource;
    if(selectedBroadPhase==='sweep-and-prune')pairSource=sweepAndPruneContactPairs(left,right,type,allowed,vertexTriangleCertificateCount,broadPhaseReport);
    else{
      assignContactSweepOrder(collection);
      model.contactTrees ??= new Map();
      let tree = model.contactTrees.get(type);
      if (!tree || tree.leafCount !== right.length) { tree = new AabbBvh(right.map((value, index) => ({ id: String(index).padStart(6, '0'), sourceIndex: index, bounds: value.bounds }))); model.contactTrees.set(type, tree); }
      else tree.refit(right.map(value => value.bounds));
      const pairs = [];
      for (let index = 0; index < left.length; index++) {
        const a = left[index];
        for (const leaf of tree.queryAabb(a.bounds, { ordered: false })) {
          broadPhaseReport.aabbOverlaps++;
          const b = right[leaf.sourceIndex];
          if ((type === 'edge-edge' && leaf.sourceIndex <= index) || !allowed(a, b)) { if (++visits % 128 === 0) yield 0; continue; }
          if (candidates+pairs.length+1 > 500000) throw clothError('CONTACT_BUDGET_EXHAUSTED', 'The swept contact candidate budget was exhausted');
          broadPhaseReport.eligiblePairs++;
          pairs.push({ a: type === 'edge-edge' && a.sweepOrder < b.sweepOrder ? b : a, b: type === 'edge-edge' && a.sweepOrder < b.sweepOrder ? a : b,
            certificateLeft:a,certificateRight:b,certificateKey:(type==='edge-edge'?vertexTriangleCertificateCount:0)+index*right.length+leaf.sourceIndex,
            major: Math.max(a.sweepOrder, b.sweepOrder), minor: Math.min(a.sweepOrder, b.sweepOrder) });
        }
        if (++visits % 128 === 0) yield 0;
      }
      // BVH traversal order is an implementation detail. Restore the exact
      // deterministic order emitted directly by the small-collection sweep.
      pairs.sort((a, b) => a.major - b.major || a.minor - b.minor);
      pairSource=pairs;
    }
    for (const pair of pairSource) {
      if(pair===null){yield 0;continue;}
      if (++candidates > 500000) throw clothError('CONTACT_BUDGET_EXHAUSTED', 'The swept contact candidate budget was exhausted');
      const {certificateLeft,certificateRight,certificateKey:key}=pair;
      captureBroadPhasePairs?.push({type,certificateKey:key,major:pair.major,minor:pair.minor,left:certificateLeft.identity,right:certificateRight.identity});
      const certificate=priorCertificates.get(key);
      if(certificate&&sameEndpoints(certificate.left,certificateLeft)&&sameEndpoints(certificate.right,certificateRight)){
        nextCertificates.set(key,certificate);certificateHits++;
        // Reusing an exact separation proof must preserve the narrow contact
        // collar retained for the following elastic iteration.
        if(retainSolverState&&(certificate.active||certificate.near)){
          cachedPairs.push({...pair,type});
          if(certificate.active)activeCached++;else nearCached++;
        }
        if(++visits%128===0)yield 0;
        continue;
      }
      if(certificate){
        certificateInvalidations++;
        if(Array.isArray(certificate.normal)){
          certificateWarmAttempts++;
          // A solver correction replaces the changed endpoint array. Rebuild
          // only this candidate's current sweep, then test the preceding
          // closest-feature normal against the same exact all-hull support
          // inequality used by full CCD. Failure falls through to full CCD.
          const current=value=>value.fixed?value:{...value,to:value.ids.map(id=>model.positions[id])};
          const left=current(certificateLeft),right=current(certificateRight),target=left.radius+right.radius;
          if(sweptFeatureSupport(left,right,0,1,target).separates(certificate.normal)){
            const endpoint=closestFeatureState(left.to,right.to,type),near=endpoint.distance<=2*target+TOLERANCE;
            const refreshed={left:endpointReferences(certificateLeft),right:endpointReferences(certificateRight),active:false,near,normal:endpoint.normal};
            nextCertificates.set(key,refreshed);certificateWarmHits++;
            model.lastContactTest={type,leftIds:left.ids,rightIds:right.ids};model.lastContactActive=false;model.lastContactNear=near;
            if(retainSolverState&&near){cachedPairs.push({...pair,type});nearCached++;}
            if(++visits%128===0)yield 0;
            continue;
          }
          certificateWarmMisses++;
        }
      }
      certificateMisses++;
      const correction=featureProject(model,pair.a,pair.b,type,continuous);
      if(correction===0&&reuseCertificates){
        const left=certificateLeft.fixed?certificateLeft:{...certificateLeft,to:certificateLeft.ids.map(id=>model.positions[id])};
        const right=certificateRight.fixed?certificateRight:{...certificateRight,to:certificateRight.ids.map(id=>model.positions[id])};
        nextCertificates.set(key,{left:endpointReferences(certificateLeft),right:endpointReferences(certificateRight),active:model.lastContactActive,near:model.lastContactNear,normal:closestFeatureState(left.to,right.to,type).normal});
      }
      // Cached projections only need the contact manifold established by this
      // certified sweep. Replaying every overlapping BVH candidate on every
      // elastic iteration makes separated nested layers scale quadratically;
      // new contacts are still discovered by the unchanged full CCD gate
      // before the physical substep is accepted.
      if(retainSolverState&&(model.lastContactActive||model.lastContactNear)){
        cachedPairs.push({...pair,type});
        if(model.lastContactActive)activeCached++;else nearCached++;
      }
      if(correction>0||++visits%128===0)yield correction;
    }
  }
  model.contactPairs=cachedPairs;
  model.contactCertificateOrigin=previous;model.contactCertificates=nextCertificates;
  const stats=model.contactStats??={fullPasses:0,cachedPasses:0,fullCandidates:0,retainedPairs:0,activePairs:0,nearPairs:0,fullMs:0,cachedPairVisits:0,cachedMs:0};
  stats.fullPasses++;stats.fullCandidates+=candidates;stats.retainedPairs+=cachedPairs.length;stats.activePairs+=activeCached;stats.nearPairs+=nearCached;stats.fullMs+=performance.now()-started;
  stats.sweepAndPrunePasses=(stats.sweepAndPrunePasses||0)+broadPhaseReports.filter(report=>report.broadPhase==='sweep-and-prune').length;
  stats.bvhPasses=(stats.bvhPasses||0)+broadPhaseReports.filter(report=>report.broadPhase==='bvh').length;
  stats.broadPhaseComparisons=(stats.broadPhaseComparisons||0)+broadPhaseReports.reduce((sum,report)=>sum+report.activeComparisons,0);
  stats.broadPhaseAabbOverlaps=(stats.broadPhaseAabbOverlaps||0)+broadPhaseReports.reduce((sum,report)=>sum+report.aabbOverlaps,0);
  stats.certificateHits=(stats.certificateHits||0)+certificateHits;stats.certificateMisses=(stats.certificateMisses||0)+certificateMisses;stats.certificateInvalidations=(stats.certificateInvalidations||0)+certificateInvalidations;
  stats.certificateWarmAttempts=(stats.certificateWarmAttempts||0)+certificateWarmAttempts;stats.certificateWarmHits=(stats.certificateWarmHits||0)+certificateWarmHits;stats.certificateWarmMisses=(stats.certificateWarmMisses||0)+certificateWarmMisses;
  const selectedBroadPhases=[...new Set(broadPhaseReports.map(report=>report.broadPhase))];
  stats.last={candidates,retainedPairs:cachedPairs.length,activePairs:activeCached,nearPairs:nearCached,broadPhase:selectedBroadPhases.length===1?selectedBroadPhases[0]:'mixed',broadPhaseFeatureLimit:CONTACT_SWEEP_PRUNE_FEATURE_LIMIT,broadPhaseReports,certificateHits,certificateMisses,certificateInvalidations,certificateWarmAttempts,certificateWarmHits,certificateWarmMisses};
  model.collectContactConstraints=false;
  model.hadContactCandidates ||= candidates>0;
  yield 0;
}

function* projectCachedClothContacts(model, previous) {
  const started=performance.now();let visits=0;
  const updated=f=>f.fixed?f:{...f,from:f.ids.map(id=>previous[id])};
  const pairs=model.contactPairs||[];
  for(const pair of pairs){
    const a=updated(pair.a),b=updated(pair.b);
    if(pair.originReference!==previous){pair.originReference=previous;pair.originState=closestFeatureState(a.from,b.from,pair.type);}
    const correction=featureProject(model,a,b,pair.type,false,pair.originState);if(correction>0||++visits%128===0)yield correction;
  }
  const stats=model.contactStats??={fullPasses:0,cachedPasses:0,fullCandidates:0,retainedPairs:0,activePairs:0,nearPairs:0,fullMs:0,cachedPairVisits:0,cachedMs:0};
  stats.cachedPasses++;stats.cachedPairVisits+=pairs.length;stats.cachedMs+=performance.now()-started;
}

export { projectClothContacts, projectCachedClothContacts };
