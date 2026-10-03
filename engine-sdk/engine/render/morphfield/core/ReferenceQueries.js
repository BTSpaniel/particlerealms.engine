// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { CSG_OPERATION, SOURCE_KIND } from './constants.js';
import { failMorphField } from './errors.js';
import { compareCanonicalStrings } from './serialization.js';
import { NexelScene } from './NexelScene.js';
import { normalizeTransform, normalizeVector3, transformDirection, transformPoint } from './Transform.js';
import {
  computeNexelBounds,
  normalizeNexelDescriptor,
  ORIENTED_KERNEL_SUPPORT_SQUARED_RADIUS,
} from './validation.js';

function length3(value) {
  return Math.hypot(value[0], value[1], value[2]);
}

function subtract3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function addScaled3(a, b, scale) {
  return [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale];
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize3(value, fallback = [0, 1, 0]) {
  const length = length3(value);
  return length > 1e-15 ? value.map(component => component / length) : [...fallback];
}

function pointAabbDistance(point, bounds) {
  let squared = 0;
  for (let axis = 0; axis < 3; axis++) {
    const delta = point[axis] < bounds.min[axis]
      ? bounds.min[axis] - point[axis]
      : point[axis] > bounds.max[axis]
        ? point[axis] - bounds.max[axis]
        : 0;
    squared += delta * delta;
  }
  return Math.sqrt(squared);
}

function pointInsideAabb(point, bounds) {
  return point[0] >= bounds.min[0] && point[0] <= bounds.max[0]
    && point[1] >= bounds.min[1] && point[1] <= bounds.max[1]
    && point[2] >= bounds.min[2] && point[2] <= bounds.max[2];
}

function evaluateGrid(source, point, outsideValue = 0) {
  const { min, max } = source.bounds;
  const dimensions = source.dimensions;
  const uvw = point.map((value, axis) => (value - min[axis]) / (max[axis] - min[axis]));
  if (uvw.some(value => value < 0 || value > 1)) return outsideValue;
  const cell = uvw.map((value, axis) => value * (dimensions[axis] - 1));
  const lower = cell.map((value, axis) => Math.min(Math.floor(value), dimensions[axis] - 2));
  const fraction = cell.map((value, axis) => value - lower[axis]);
  const index = (x, y, z) => x + dimensions[0] * (y + dimensions[1] * z);
  const sample = (dx, dy, dz) => source.values[index(lower[0] + dx, lower[1] + dy, lower[2] + dz)];
  const x00 = sample(0, 0, 0) * (1 - fraction[0]) + sample(1, 0, 0) * fraction[0];
  const x10 = sample(0, 1, 0) * (1 - fraction[0]) + sample(1, 1, 0) * fraction[0];
  const x01 = sample(0, 0, 1) * (1 - fraction[0]) + sample(1, 0, 1) * fraction[0];
  const x11 = sample(0, 1, 1) * (1 - fraction[0]) + sample(1, 1, 1) * fraction[0];
  const y0 = x00 * (1 - fraction[1]) + x10 * fraction[1];
  const y1 = x01 * (1 - fraction[1]) + x11 * fraction[1];
  return y0 * (1 - fraction[2]) + y1 * fraction[2];
}

function closestPointTriangle(point, a, b, c) {
  const ab = subtract3(b, a);
  const ac = subtract3(c, a);
  const ap = subtract3(point, a);
  const d1 = dot3(ab, ap);
  const d2 = dot3(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = subtract3(point, b);
  const d3 = dot3(ab, bp);
  const d4 = dot3(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const value = d1 / (d1 - d3);
    return addScaled3(a, ab, value);
  }
  const cp = subtract3(point, c);
  const d5 = dot3(ab, cp);
  const d6 = dot3(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const value = d2 / (d2 - d6);
    return addScaled3(a, ac, value);
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const value = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return addScaled3(b, subtract3(c, b), value);
  }
  const denominator = 1 / (va + vb + vc);
  const v = vb * denominator;
  const w = vc * denominator;
  return [
    a[0] + ab[0] * v + ac[0] * w,
    a[1] + ab[1] * v + ac[1] * w,
    a[2] + ab[2] * v + ac[2] * w,
  ];
}

function rayTriangle(origin, direction, a, b, c) {
  const edge1 = subtract3(b, a);
  const edge2 = subtract3(c, a);
  const p = cross3(direction, edge2);
  const determinant = dot3(edge1, p);
  if (Math.abs(determinant) < 1e-12) return Infinity;
  const inverse = 1 / determinant;
  const t = subtract3(origin, a);
  const u = dot3(t, p) * inverse;
  if (u < 0 || u > 1) return Infinity;
  const q = cross3(t, edge1);
  const v = dot3(direction, q) * inverse;
  if (v < 0 || u + v > 1) return Infinity;
  const distance = dot3(edge2, q) * inverse;
  return distance > 1e-10 ? distance : Infinity;
}

function indexedSurfaceDistance(source, point) {
  let minimumSquared = Infinity;
  const rayDirection = normalize3([1, 1.734723475976807e-7, 3.141592653589793e-7]);
  let crossings = 0;
  for (let triangle = 0; triangle < source.indices.length; triangle += 3) {
    const readPosition = index => source.positions.slice(index * 3, index * 3 + 3);
    const a = readPosition(source.indices[triangle]);
    const b = readPosition(source.indices[triangle + 1]);
    const c = readPosition(source.indices[triangle + 2]);
    const closest = closestPointTriangle(point, a, b, c);
    const delta = subtract3(point, closest);
    minimumSquared = Math.min(minimumSquared, dot3(delta, delta));
    if (source.closed && Number.isFinite(rayTriangle(point, rayDirection, a, b, c))) crossings += 1;
  }
  const distance = Math.sqrt(minimumSquared);
  return source.closed && (crossings & 1) === 1 ? -distance : distance;
}

function orientedKernelField(source, point) {
  let density = 0;
  for (const sample of source.samples) {
    const delta = subtract3(point, sample.position);
    const normalizedRadius = [
      delta[0] / sample.radii[0],
      delta[1] / sample.radii[1],
      delta[2] / sample.radii[2],
    ];
    const squaredRadius = dot3(normalizedRadius, normalizedRadius);
    if (squaredRadius <= ORIENTED_KERNEL_SUPPORT_SQUARED_RADIUS) {
      density += sample.weight * Math.exp(-0.5 * squaredRadius);
    }
  }
  return source.isoValue - density;
}

function localSignedDistance(source, point) {
  switch (source.kind) {
    case SOURCE_KIND.SPHERE:
      return length3(point) - source.radius;
    case SOURCE_KIND.BOX: {
      const q = point.map((value, axis) => Math.abs(value) - source.halfExtents[axis]);
      const outside = Math.hypot(Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0));
      return outside + Math.min(Math.max(q[0], q[1], q[2]), 0);
    }
    case SOURCE_KIND.CAPSULE: {
      const y = point[1] - Math.max(-source.halfHeight, Math.min(source.halfHeight, point[1]));
      return Math.hypot(point[0], y, point[2]) - source.radius;
    }
    case SOURCE_KIND.CSG: {
      const values = source.children.map(child => evaluateSourceDistance(child, point));
      if (source.operation === CSG_OPERATION.UNION) return Math.min(...values);
      if (source.operation === CSG_OPERATION.INTERSECTION) return Math.max(...values);
      return Math.max(values[0], -values[1]);
    }
    case SOURCE_KIND.SAMPLED_FIELD: {
      if (pointInsideAabb(point, source.bounds)) return evaluateGrid(source, point);
      const clamped = point.map((value, axis) => Math.max(source.bounds.min[axis], Math.min(source.bounds.max[axis], value)));
      return Math.max(evaluateGrid(source, clamped), 0) + pointAabbDistance(point, source.bounds);
    }
    case SOURCE_KIND.SPARSE_RESIDUAL:
      return evaluateSourceDistance(source.base, point) + evaluateGrid(source, point, 0);
    case SOURCE_KIND.ORIENTED_SAMPLES:
      return orientedKernelField(source, point);
    case SOURCE_KIND.INDEXED_SURFACE:
      return indexedSurfaceDistance(source, point);
    case SOURCE_KIND.MEDIUM:
      return pointAabbDistance(point, source.bounds);
    default:
      failMorphField('UNKNOWN_SOURCE_KIND', `Cannot evaluate source kind ${String(source.kind)}`);
  }
}

export function evaluateSourceDistance(source, pointValue) {
  const point = normalizeVector3(pointValue, 'point');
  const transform = normalizeTransform(source.transform);
  const localPoint = transformPoint(transform.inverseMatrix, point);
  return localSignedDistance(source, localPoint) * transform.scale;
}

export function evaluateNexelDistance(nexelValue, pointValue) {
  const nexel = nexelValue?.source ? nexelValue : normalizeNexelDescriptor(nexelValue);
  const point = normalizeVector3(pointValue, 'point');
  const transform = normalizeTransform(nexel.transform);
  const localPoint = transformPoint(transform.inverseMatrix, point);
  return evaluateSourceDistance(nexel.source, localPoint) * transform.scale;
}

function surfaceNormal(nexel, point, bounds) {
  const diagonal = Math.hypot(
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  );
  const epsilon = Math.max(1e-7, diagonal * 1e-6);
  const gradient = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    const low = [...point];
    const high = [...point];
    low[axis] -= epsilon;
    high[axis] += epsilon;
    gradient[axis] = (evaluateNexelDistance(nexel, high) - evaluateNexelDistance(nexel, low)) / (2 * epsilon);
  }
  return normalize3(gradient);
}

function sourceMedium(source, point) {
  const transform = normalizeTransform(source.transform);
  const localPoint = transformPoint(transform.inverseMatrix, point);
  if (source.kind === SOURCE_KIND.MEDIUM && pointInsideAabb(localPoint, source.bounds)) {
    return {
      density: source.density,
      extinction: source.extinction,
      emission: [...source.emission],
      transmittancePerMeter: Math.exp(-source.density * source.extinction),
    };
  }
  return { density: 0, extinction: 0, emission: [0, 0, 0], transmittancePerMeter: 1 };
}

function resolveSceneInput(input) {
  if (input instanceof NexelScene) return input.values();
  if (Array.isArray(input)) return input.map((entry, index) => normalizeNexelDescriptor(entry, `nexels[${index}]`));
  if (Array.isArray(input?.descriptors)) return input.descriptors;
  if (Array.isArray(input?.nexels)) return NexelScene.fromJSON(input).values();
  failMorphField('INVALID_REFERENCE_SCENE', 'Reference evaluator requires a NexelScene, compiled scene, or descriptor array');
}

export class MorphFieldReferenceEvaluator {
  constructor(sceneOrCompiled) {
    this.descriptors = resolveSceneInput(sceneOrCompiled).slice()
      .sort((a, b) => compareCanonicalStrings(a.id, b.id));
    this.byId = new Map(this.descriptors.map((descriptor, index) => [descriptor.id, { descriptor, index }]));
  }

  #resolve(selector) {
    if (typeof selector === 'number') {
      if (!Number.isInteger(selector) || selector < 0 || selector >= this.descriptors.length) {
        failMorphField('NEXEL_INDEX_RANGE', `Nexel index ${selector} is out of range`);
      }
      return this.descriptors[selector];
    }
    if (typeof selector === 'string') {
      const result = this.byId.get(selector);
      if (!result) failMorphField('UNKNOWN_NEXEL', `Unknown Nexel id: ${selector}`);
      return result.descriptor;
    }
    if (selector?.source) return selector;
    failMorphField('INVALID_NEXEL_SELECTOR', 'Expected a Nexel id, packed index, or descriptor');
  }

  evalBound(selector) {
    const nexel = this.#resolve(selector);
    const bounds = computeNexelBounds(nexel);
    return Object.freeze({ nexelId: nexel.id, min: Object.freeze([...bounds.min]), max: Object.freeze([...bounds.max]) });
  }

  evalSurface(selector, pointValue) {
    const nexel = this.#resolve(selector);
    if (nexel.source.kind === SOURCE_KIND.MEDIUM) {
      return Object.freeze({ nexelId: nexel.id, supported: false, distance: Infinity, inside: false, normal: Object.freeze([0, 1, 0]) });
    }
    const point = normalizeVector3(pointValue, 'point');
    const distance = evaluateNexelDistance(nexel, point);
    const bounds = computeNexelBounds(nexel);
    return Object.freeze({
      nexelId: nexel.id,
      supported: true,
      distance,
      fieldValue: distance,
      inside: distance < 0,
      normal: Object.freeze(surfaceNormal(nexel, point, bounds)),
    });
  }

  evalMedium(selector, pointValue) {
    const nexel = this.#resolve(selector);
    const point = normalizeVector3(pointValue, 'point');
    const transform = normalizeTransform(nexel.transform);
    const result = sourceMedium(nexel.source, transformPoint(transform.inverseMatrix, point));
    return Object.freeze({
      nexelId: nexel.id,
      density: result.density,
      extinction: result.extinction,
      emission: Object.freeze(result.emission),
      transmittancePerMeter: result.transmittancePerMeter,
    });
  }

  evalMaterial(selector) {
    const nexel = this.#resolve(selector);
    return Object.freeze({ nexelId: nexel.id, material: nexel.material });
  }

  evalMotion(selector, time = 0) {
    const nexel = this.#resolve(selector);
    const seconds = Number(time);
    if (!Number.isFinite(seconds)) failMorphField('INVALID_TIME', 'Motion query time must be finite');
    const motion = nexel.motion;
    if (!motion) {
      return Object.freeze({ nexelId: nexel.id, supported: false, displacement: Object.freeze([0, 0, 0]), velocity: Object.freeze([0, 0, 0]) });
    }
    const clampedTime = Math.max(0, Math.min(motion.validDuration, seconds));
    const displacement = motion.velocity.map((velocity, axis) => velocity * clampedTime + 0.5 * motion.acceleration[axis] * clampedTime * clampedTime);
    const velocity = motion.velocity.map((value, axis) => value + motion.acceleration[axis] * clampedTime);
    return Object.freeze({
      nexelId: nexel.id,
      supported: true,
      time: clampedTime,
      displacement: Object.freeze(displacement),
      velocity: Object.freeze(velocity),
      angularVelocity: motion.angularVelocity,
    });
  }

  evalCollision(selector, pointValue, radius = 0) {
    const nexel = this.#resolve(selector);
    const queryRadius = Number(radius);
    if (!Number.isFinite(queryRadius) || queryRadius < 0) failMorphField('INVALID_COLLISION_RADIUS', 'Collision radius must be non-negative and finite');
    if (!nexel.collision || nexel.source.kind === SOURCE_KIND.MEDIUM) {
      return Object.freeze({ nexelId: nexel.id, supported: false, contact: false, distance: Infinity, penetration: 0, normal: Object.freeze([0, 1, 0]) });
    }
    const surface = this.evalSurface(nexel, pointValue);
    const distance = surface.distance - queryRadius;
    return Object.freeze({
      nexelId: nexel.id,
      supported: true,
      contact: distance <= nexel.collision.contactOffset,
      distance,
      penetration: Math.max(nexel.collision.restOffset - distance, 0),
      normal: surface.normal,
      contactOffset: nexel.collision.contactOffset,
      restOffset: nexel.collision.restOffset,
      layer: nexel.collision.layer,
      mask: nexel.collision.mask,
    });
  }

  queryNearestSurface(pointValue, maximumDistance = Infinity) {
    const point = normalizeVector3(pointValue, 'point');
    const limit = Number(maximumDistance);
    if (!(limit >= 0) || Number.isNaN(limit)) failMorphField('INVALID_DISTANCE_LIMIT', 'maximumDistance must be non-negative');
    let best = null;
    for (const nexel of this.descriptors) {
      if (nexel.source.kind === SOURCE_KIND.MEDIUM) continue;
      const bounds = computeNexelBounds(nexel);
      if (pointAabbDistance(point, bounds) > limit) continue;
      const surface = this.evalSurface(nexel, point);
      // The scene field is a hard union, matching evalScene() on the GPU.
      // Absolute-nearest selection would expose internal overlap boundaries.
      if (!best || surface.distance < best.distance
          || (surface.distance === best.distance
            && compareCanonicalStrings(surface.nexelId, best.nexelId) < 0)) {
        best = surface;
      }
    }
    return best && Math.abs(best.distance) <= limit ? best : null;
  }

  traceRay(originValue, directionValue, options = {}) {
    const origin = normalizeVector3(originValue, 'origin');
    const direction = normalize3(normalizeVector3(directionValue, 'direction'), [0, 0, -1]);
    const maximumDistance = Number(options.maximumDistance ?? 10_000);
    const maximumSteps = Number(options.maximumSteps ?? 256);
    const epsilon = Number(options.epsilon ?? 1e-5);
    if (!(maximumDistance > 0) || !Number.isInteger(maximumSteps) || maximumSteps < 1 || !(epsilon > 0)) {
      failMorphField('INVALID_TRACE_OPTIONS', 'Ray trace limits must be positive');
    }
    let distanceAlongRay = Math.max(0, Number(options.minimumDistance ?? 0));
    let previousField = Infinity;
    let previousDistance = distanceAlongRay;
    for (let step = 0; step < maximumSteps && distanceAlongRay <= maximumDistance; step++) {
      const point = addScaled3(origin, direction, distanceAlongRay);
      const surface = this.queryNearestSurface(point, Infinity);
      if (!surface) return null;
      const field = surface.distance;
      if (Math.abs(field) <= epsilon) {
        return Object.freeze({ ...surface, point: Object.freeze(point), rayDistance: distanceAlongRay, steps: step + 1 });
      }
      if (Number.isFinite(previousField) && ((field < 0) !== (previousField < 0))) {
        let low = previousDistance;
        let high = distanceAlongRay;
        let highSurface = surface;
        for (let iteration = 0; iteration < 32 && high - low > epsilon; iteration++) {
          const middle = (low + high) * 0.5;
          const middlePoint = addScaled3(origin, direction, middle);
          const middleSurface = this.queryNearestSurface(middlePoint, Infinity);
          if (!middleSurface) break;
          if ((middleSurface.distance < 0) === (previousField < 0)) low = middle;
          else {
            high = middle;
            highSurface = middleSurface;
          }
        }
        const pointAtHit = addScaled3(origin, direction, high);
        return Object.freeze({ ...highSurface, point: Object.freeze(pointAtHit), rayDistance: high, steps: step + 1, bracketed: true });
      }
      previousDistance = distanceAlongRay;
      previousField = field;
      distanceAlongRay += Math.max(Math.abs(field), epsilon * 0.5);
    }
    return null;
  }
}

export function createMorphFieldReferenceEvaluator(sceneOrCompiled) {
  return new MorphFieldReferenceEvaluator(sceneOrCompiled);
}
