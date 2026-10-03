// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

function vec3(value, name) {
  if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || value.length < 3) throw new TypeError(`${name} requires three values`);
  const result = [Number(value[0]), Number(value[1]), Number(value[2])];
  if (!result.every(Number.isFinite)) throw new RangeError(`${name} must be finite`);
  return result;
}

function clamp01(value) { return Math.min(1, Math.max(0, value)); }

function normalizeQuaternion(value, name) {
  if ((!Array.isArray(value) && !ArrayBuffer.isView(value)) || value.length < 4) {
    throw new TypeError(`${name} requires four values`);
  }
  const result = Array.from(value).slice(0, 4).map(Number);
  if (!result.every(Number.isFinite)) throw new RangeError(`${name} must be finite`);
  const length = Math.hypot(...result);
  if (length <= 1e-12) throw new RangeError(`${name} cannot be zero`);
  return result.map(component => component / length);
}

function quaternionMatrix([x, y, z, w]) {
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}

function orientedWorldExtent(radius, matrix) {
  return [0, 1, 2].map(row => (
    Math.abs(matrix[row * 3]) * radius[0]
    + Math.abs(matrix[row * 3 + 1]) * radius[1]
    + Math.abs(matrix[row * 3 + 2]) * radius[2]
  ));
}

function inverseRotateVector(vector, matrix) {
  return [
    matrix[0] * vector[0] + matrix[3] * vector[1] + matrix[6] * vector[2],
    matrix[1] * vector[0] + matrix[4] * vector[1] + matrix[7] * vector[2],
    matrix[2] * vector[0] + matrix[5] * vector[1] + matrix[8] * vector[2],
  ];
}

/** CPU reference and bin-builder for semantic anisotropic oriented kernels. */
export class OrientedKernelSet {
  constructor(kernels = [], options = {}) {
    this.cellSize = Math.max(1e-6, Number(options.cellSize ?? 1));
    this.kernels = kernels.map((kernel, index) => normalizeKernel(kernel, index));
    this.bins = new Map();
    this.overflow = 0;
    this.maxPerBin = Math.max(1, options.maxPerBin ?? 1024);
    this.rebuildBins();
  }

  rebuildBins() {
    this.bins.clear(); this.overflow = 0;
    for (let i = 0; i < this.kernels.length; i++) {
      const kernel = this.kernels[i];
      const min = kernel.center.map((v, axis) => Math.floor((v - kernel.worldExtent[axis]) / this.cellSize));
      const max = kernel.center.map((v, axis) => Math.floor((v + kernel.worldExtent[axis]) / this.cellSize));
      for (let z = min[2]; z <= max[2]; z++) for (let y = min[1]; y <= max[1]; y++) for (let x = min[0]; x <= max[0]; x++) {
        const key = `${x},${y},${z}`; const bin = this.bins.get(key) || [];
        if (bin.length < this.maxPerBin) bin.push(i); else this.overflow++;
        this.bins.set(key, bin);
      }
    }
  }

  query(point) {
    const p = vec3(point, 'point');
    const key = p.map((v) => Math.floor(v / this.cellSize)).join(',');
    return (this.bins.get(key) || []).map((index) => this.kernels[index]);
  }

  evaluate(point) {
    const p = vec3(point, 'point');
    let density = 0; const color = [0, 0, 0];
    const kernels = this.query(p);
    for (const kernel of kernels) {
      const delta = p.map((value, axis) => value - kernel.center[axis]);
      const local = inverseRotateVector(delta, kernel.orientationMatrix);
      const q = local.map((value, axis) => value / kernel.radius[axis]);
      const weight = Math.exp(-0.5 * (q[0] ** 2 + q[1] ** 2 + q[2] ** 2)) * kernel.opacity;
      density += weight;
      color[0] += kernel.color[0] * weight; color[1] += kernel.color[1] * weight; color[2] += kernel.color[2] * weight;
    }
    if (density > 1e-12) { color[0] /= density; color[1] /= density; color[2] /= density; }
    return { density, color, count: kernels.length };
  }

  getStats() { return { kernels: this.kernels.length, bins: this.bins.size, overflow: this.overflow }; }
}

function normalizeKernel(kernel, index) {
  const center = vec3(kernel?.center, `kernel[${index}].center`);
  const radiusInput = kernel?.radius ?? [1, 1, 1];
  const radius = typeof radiusInput === 'number' ? [radiusInput, radiusInput, radiusInput] : vec3(radiusInput, `kernel[${index}].radius`);
  if (radius.some((v) => v <= 0)) throw new RangeError(`kernel[${index}] radius must be positive`);
  const orientation = normalizeQuaternion(kernel.orientation || [0, 0, 0, 1], `kernel[${index}].orientation`);
  const orientationMatrix = quaternionMatrix(orientation);
  return Object.freeze({
    id: String(kernel.id ?? index), center: Object.freeze(center), radius: Object.freeze(radius),
    orientation: Object.freeze(orientation),
    orientationMatrix: Object.freeze(orientationMatrix),
    worldExtent: Object.freeze(orientedWorldExtent(radius, orientationMatrix)),
    color: Object.freeze(vec3(kernel.color || [1, 1, 1], `kernel[${index}].color`)),
    opacity: clamp01(Number(kernel.opacity ?? 1)), motion: kernel.motion || null,
  });
}

/** Deterministic reference integrator using a certified extinction majorant. */
export function integrateMedium(ray, evaluateMedium, options = {}) {
  if (typeof evaluateMedium !== 'function') throw new TypeError('evaluateMedium must be a function');
  const origin = vec3(ray.origin, 'ray.origin'); const direction = vec3(ray.direction, 'ray.direction');
  const length = Math.hypot(...direction);
  if (length <= 1e-12) throw new RangeError('ray.direction cannot be zero');
  direction[0] /= length; direction[1] /= length; direction[2] /= length;
  const tMin = Number(ray.tMin ?? 0); const tMax = Number(ray.tMax);
  const majorant = Number(options.extinctionMajorant);
  if (!Number.isFinite(tMin) || !Number.isFinite(tMax) || tMax < tMin) throw new RangeError('Invalid ray interval');
  if (!Number.isFinite(majorant) || majorant < 0) throw new RangeError('A finite non-negative extinction majorant is required');
  const steps = Math.max(1, Math.min(options.maxSteps ?? 256, Math.ceil((tMax - tMin) / Math.max(options.stepSize ?? 0.05, 1e-6))));
  const dt = (tMax - tMin) / steps; let transmittance = 1; const radiance = [0, 0, 0];
  for (let i = 0; i < steps && transmittance > 1e-4; i++) {
    const t = tMin + (i + 0.5) * dt;
    const sample = evaluateMedium([origin[0] + direction[0] * t, origin[1] + direction[1] * t, origin[2] + direction[2] * t], t) || {};
    const extinction = Math.max(0, Number(sample.extinction ?? sample.density ?? 0));
    if (!Number.isFinite(extinction) || extinction > majorant + 1e-6) throw new Error('Medium sample exceeds its certified extinction majorant');
    const emission = vec3(sample.emission || [0, 0, 0], 'medium emission');
    const absorbed = 1 - Math.exp(-extinction * dt);
    radiance[0] += transmittance * emission[0] * absorbed;
    radiance[1] += transmittance * emission[1] * absorbed;
    radiance[2] += transmittance * emission[2] * absorbed;
    transmittance *= 1 - absorbed;
  }
  return { radiance, transmittance: clamp01(transmittance), steps };
}

/** Four exact sorted layers followed by a bounded weighted-blended tail. */
export class LayeredOITAccumulator {
  constructor(maxExactLayers = 4) {
    this.maxExactLayers = Math.max(1, maxExactLayers | 0);
    this.clear();
  }

  clear() {
    this.layers = [];
    this.tailColor = [0, 0, 0]; this.tailWeight = 0; this.tailRevealage = 1; this.overflow = 0;
  }

  add(depth, color, alpha) {
    const d = Number(depth); const c = vec3(color, 'fragment color'); const a = clamp01(Number(alpha));
    if (!Number.isFinite(d) || !Number.isFinite(a)) throw new RangeError('Fragment depth/alpha must be finite');
    const fragment = { depth: d, color: c, alpha: a };
    this.layers.push(fragment); this.layers.sort((left, right) => left.depth - right.depth);
    if (this.layers.length > this.maxExactLayers) this._addTail(this.layers.pop());
  }

  _addTail(fragment) {
    const weight = Math.max(1e-3, Math.min(3e3, fragment.alpha * 8 + 0.01));
    this.tailColor[0] += fragment.color[0] * fragment.alpha * weight;
    this.tailColor[1] += fragment.color[1] * fragment.alpha * weight;
    this.tailColor[2] += fragment.color[2] * fragment.alpha * weight;
    this.tailWeight += fragment.alpha * weight;
    this.tailRevealage *= 1 - fragment.alpha;
    this.overflow++;
  }

  resolve(background = [0, 0, 0]) {
    let color = vec3(background, 'background');
    if (this.tailWeight > 1e-8) {
      const tail = this.tailColor.map((value) => value / this.tailWeight);
      const alpha = 1 - clamp01(this.tailRevealage);
      color = tail.map((value, axis) => value * alpha + color[axis] * (1 - alpha));
    }
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const layer = this.layers[i]; color = layer.color.map((value, axis) => value * layer.alpha + color[axis] * (1 - layer.alpha));
    }
    return { color, exactLayers: this.layers.length, tailFragments: this.overflow };
  }
}
