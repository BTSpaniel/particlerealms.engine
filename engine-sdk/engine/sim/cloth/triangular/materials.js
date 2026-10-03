// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { cloneStrictJson } from '../../../core/schema/StrictJsonValue.js';

const statuses = new Set(['measured', 'sourced', 'estimated']);
const roles = new Set(['outer', 'lining', 'mesh', 'interfacing', 'batting', 'foam', 'fabric', 'insert']);
const estimate = value => ({ value, status: 'estimated', source: 'Explicit generic preview preset; not a measured fabric' });
const curve = points => ({ points, status: 'estimated', source: 'Explicit generic preview preset; not a measured fabric' });
const presets = {
  'woven-light': { mass: .18, thickness: .35, bend: .00002, friction: .35, warp: 1200, weft: 800, shear: 8 },
  'stretch-knit': { mass: .22, thickness: .7, bend: .00001, friction: .4, warp: 45, weft: 30, shear: 3 },
  'foam-spacer': { mass: .12, thickness: 3, bend: .0001, friction: .45, warp: 60, weft: 60, shear: 4 },
};

export function clothError(code, message, details = null) {
  const error = new Error(message); error.name = 'TriangularClothError'; error.code = code; error.details = details; return error;
}
export function clothNumber(value, name, min = -1e9, max = 1e9) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw clothError('INVALID_INPUT', `${name} must be finite in [${min}, ${max}]`);
  return value;
}
function property(value, name, min, max) {
  if (!value || !statuses.has(value.status)) throw clothError('MATERIAL_DATA_REQUIRED', `${name} needs a value and measured, sourced, or estimated status`);
  if (value.status !== 'estimated' && (typeof value.source !== 'string' || !value.source.trim())) throw clothError('MATERIAL_SOURCE_REQUIRED', `${name} requires its measurement or source reference`);
  return clothNumber(value.value, name, min, max);
}
export function normalizeClothCurve(input, name, { energy = false, compression = false, angleUnit = 'degrees' } = {}) {
  if (!input || !statuses.has(input.status) || !Array.isArray(input.points) || input.points.length < 3 || input.points.length > 128) throw clothError('MATERIAL_DATA_REQUIRED', `${name} needs 3–128 ordered physical curve samples and provenance`);
  if (input.status !== 'estimated' && !input.source?.trim()) throw clothError('MATERIAL_SOURCE_REQUIRED', `${name} requires a source reference`);
  if(!['degrees','radians'].includes(angleUnit))throw clothError('INVALID_INPUT','Physical curves require degrees or radians');
  const angleScale=angleUnit==='radians'?Math.PI/180:1;
  let previousX = -Infinity, previousY = -Infinity;
  const points = input.points.map((point, i) => {
    if (!Array.isArray(point) || point.length !== 2) throw clothError('INVALID_INPUT', `${name} sample ${i} must contain two numbers`);
    const x = clothNumber(point[0], name, energy ? -89*angleScale : compression ? 0 : -.99, energy ? 89*angleScale : compression ? .99 : 10), y = clothNumber(point[1], name, energy || compression ? 0 : -1e9, 1e9);
    if (x <= previousX || (!energy && y < previousY)) throw clothError('INVALID_INPUT', `${name} samples must have increasing abscissae and nondecreasing traction/pressure`);
    if (!energy && x * y < 0) throw clothError('INVALID_INPUT', `${name} response must oppose strain`);
    previousX = x; previousY = y; return [energy&&angleUnit==='degrees' ? x * Math.PI / 180 : x, y];
  });
  if (!points.some(([x, y]) => x === 0 && y === 0) || points[0][0] > 0 || points.at(-1)[0] <= 0 || (!compression && points[0][0] >= 0)) throw clothError('INVALID_INPUT', `${name} must include zero response at rest and both supported signs`);
  if (energy) for (let i = 1; i < points.length; i++) if ((points[i][1] - points[i - 1][1]) * (points[i][0] + points[i - 1][0]) < 0) throw clothError('INVALID_INPUT', `${name} energy must increase away from rest`);
  return { points, status: input.status, source: input.source || null };
}

/** Public values retain provenance; numerical values use SI units only. */
export function normalizeClothMaterial(input) {
  const source = cloneStrictJson(input), preset = source.estimatedPreset == null ? null : presets[source.estimatedPreset];
  if (typeof source.id !== 'string' || !source.id || (source.estimatedPreset != null && !preset)) throw clothError('INVALID_INPUT', 'Material identity or explicit preview preset is invalid');
  if (!roles.has(source.role)) throw clothError('INVALID_INPUT', `Unsupported sheet construction role: ${source.role}`);
  if (preset) {
    source.arealMassKgM2 ??= estimate(preset.mass); source.thicknessMm ??= estimate(preset.thickness);
    source.bendingNm ??= estimate(preset.bend); source.friction ??= estimate(preset.friction);
    source.warp ??= curve([[-.8, -.8 * preset.warp], [0, 0], [.1, .1 * preset.warp], [2, 2 * preset.warp]]);
    source.weft ??= curve([[-.8, -.8 * preset.weft], [0, 0], [.1, .1 * preset.weft], [2, 2 * preset.weft]]);
    source.shearEnergy ??= curve([-85, -45, -15, 0, 15, 45, 85].map(angle => [angle, .5 * preset.shear * (angle * Math.PI / 180) ** 2]));
  }
  const mass = property(source.arealMassKgM2, 'arealMassKgM2', 1e-6, 100), thickness = property(source.thicknessMm, 'thicknessMm', .001, 100) / 1000;
  const bending = property(source.bendingNm, 'bendingNm', 0, 1000), friction = property(source.friction, 'friction', 0, 5);
  const warp = normalizeClothCurve(source.warp, 'warp traction N/m'), weft = normalizeClothCurve(source.weft, 'weft traction N/m'), shear = normalizeClothCurve(source.shearEnergy, 'shear energy J/m²', { energy: true });
  const compression = source.compressionPressure ? normalizeClothCurve(source.compressionPressure, 'compression pressure Pa', { compression: true }) : null;
  const budgets = source.budgets || null;
  if (budgets) {
    for (const key of ['warpExtension', 'warpCompression', 'weftExtension', 'weftCompression']) property(budgets[key], key, 0, 10);
    property(budgets.shearDegrees, 'shearDegrees', 0, 89);
  }
  const estimated = [source.arealMassKgM2, source.thicknessMm, source.bendingNm, source.friction, warp, weft, shear, compression, ...Object.values(budgets || {})].some(value => value?.status === 'estimated');
  return { id: source.id, role: source.role, source, mass, thickness, bending, friction, warp, weft, shear, compression, budgets, estimated,
    model: ['foam', 'batting'].includes(source.role) ? 'fixed-thickness shell spacer; compression response is not solved' : source.role === 'mesh' ? 'homogenized directional sheet; pores are appearance only' : 'directional sheet shell' };
}

/** Piecewise physical curves never extrapolate beyond the declared range. */
export function sampleClothCurve(curve, x, energy = false) {
  const points = curve.points;
  if (x < points[0][0] - 1e-9 || x > points.at(-1)[0] + 1e-9) throw clothError('UNSUPPORTED_MATERIAL_RANGE', 'Strain or shear is outside the supplied physical curve', { value: x, minimum: points[0][0], maximum: points.at(-1)[0] });
  x = Math.max(points[0][0], Math.min(points.at(-1)[0], x));
  for (let i = 1; i < points.length; i++) if (x <= points[i][0]) {
    const [a, av] = points[i - 1], [b, bv] = points[i], slope = (bv - av) / (b - a);
    return energy ? x === 0 ? 0 : slope : av + (x - a) * slope;
  }
  return energy ? 0 : points.at(-1)[1];
}

/** C is dimensionless strain/angle; area times traction is energy (N·m). */
export function strainCompliance(materialCurve, strain, areaM2, energy = false) {
  if (Math.abs(strain) < 1e-12) {
    if (energy) return 0;
    const points = materialCurve.points, zero = points.findIndex(([x]) => x === 0);
    const before = points[zero - 1], after = points[zero + 1];
    const slope = (after[1] - before[1]) / (after[0] - before[0]);
    return slope > 0 ? 1 / (areaM2 * slope) : null;
  }
  const response = sampleClothCurve(materialCurve, strain, energy);
  if (Math.abs(response) < 1e-14) return null;
  const compliance = strain / (areaM2 * response);
  if (!(compliance >= 0) || !Number.isFinite(compliance)) throw clothError('INVALID_MATERIAL_ENERGY', 'Physical curve gives a negative or nonfinite compliance');
  return compliance;
}
