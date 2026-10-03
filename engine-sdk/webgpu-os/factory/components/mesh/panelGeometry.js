// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { orientation2DReport } from '../../../../engine/core/math/RobustNumericMath.js';
import { meshPosition } from './physicalMesh.js';

const orientation = (a, b, c) => orientation2DReport(a, b, c).determinant;
const xy = (positions, index) => positions.slice(index * 2, index * 2 + 2);
const strictInside = (p, tri) => tri.every((a, k) => orientation(a, tri[(k + 1) % 3], p) > 1e-10);

/** Check positive triangle area and global injectivity using bounded spatial bins. */
export function checkPanelEmbedding(mesh, positions, { maxPairs = 2000000, check = () => {} } = {}) {
  if (positions.length !== mesh.vertexIds.length * 2 || !Array.from(positions).every(Number.isFinite)) return { valid: false, code: 'invalid-embedding', message: 'Physical 2D coordinates are invalid' };
  const triangles = [], min = [Infinity, Infinity], max = [-Infinity, -Infinity];
  for (let f = 0; f < mesh.faceIds.length; f++) {
    if (f % 1024 === 0) check();
    const indices = mesh.triangles.slice(f * 3, f * 3 + 3), points = indices.map(i => xy(positions, i));
    if (!(orientation(...points) > 1e-10)) return { valid: false, code: 'flipped-face', faceId: mesh.faceIds[f], message: 'Flattening contains a flipped or collapsed triangle' };
    const box = { min: [0, 1].map(a => Math.min(...points.map(p => p[a]))), max: [0, 1].map(a => Math.max(...points.map(p => p[a]))) };
    for (let a = 0; a < 2; a++) { min[a] = Math.min(min[a], box.min[a]); max[a] = Math.max(max[a], box.max[a]); }
    triangles.push({ indices, points, box });
  }
  const cell = Math.max(1e-6, Math.max(max[0] - min[0], max[1] - min[1]) / Math.max(1, Math.sqrt(triangles.length))), bins = new Map(), seen = new Set();
  let pairs = 0, memberships = 0;
  for (let f = 0; f < triangles.length; f++) {
    check(); const current = triangles[f], low = current.box.min.map((v, a) => Math.floor((v - min[a]) / cell)), high = current.box.max.map((v, a) => Math.floor((v - min[a]) / cell));
    for (let x = low[0]; x <= high[0]; x++) for (let y = low[1]; y <= high[1]; y++) {
      if (++memberships > maxPairs) return { valid: false, code: 'overlap-budget', message: 'Overlap verification exceeded its spatial budget' };
      if (memberships % 1024 === 0) check();
      const key = `${x},${y}`, bin = bins.get(key) ?? [];
      for (const previous of bin) {
        const pair = `${previous},${f}`; if (seen.has(pair)) continue; seen.add(pair);
        if (++pairs > maxPairs) return { valid: false, code: 'overlap-budget', message: 'Overlap verification exceeded its pair budget' };
        if (pairs % 1024 === 0) check();
        const other = triangles[previous];
        if ([0, 1].some(a => current.box.min[a] >= other.box.max[a] || current.box.max[a] <= other.box.min[a])) continue;
        let overlap = current.points.some(p => strictInside(p, other.points)) || other.points.some(p => strictInside(p, current.points));
        for (let a = 0; a < 3 && !overlap; a++) for (let b = 0; b < 3 && !overlap; b++) {
          const p = current.points[a], q = current.points[(a + 1) % 3], r = other.points[b], s = other.points[(b + 1) % 3];
          overlap = orientation(p, q, r) * orientation(p, q, s) < -1e-16 && orientation(r, s, p) * orientation(r, s, q) < -1e-16;
        }
        // Coincident triangles can share all boundary coordinates without strict edge crossings.
        if (!overlap) { const center = [0, 1].map(a => current.points.reduce((sum, p) => sum + p[a], 0) / 3); overlap = strictInside(center, other.points); }
        if (overlap) return { valid: false, code: 'overlap', faceIds: [mesh.faceIds[previous], mesh.faceIds[f]], message: 'Physical panels overlap themselves' };
      }
      bin.push(f); bins.set(key, bin);
    }
  }
  return { valid: true, pairs };
}

/** Strain is the 2D cutting chart → retained 3D concept deformation, in its authored grain frame. */
export function panelStrainReport(mesh, positions, { grainAngleDegrees = 90, materialBudget = null } = {}) {
  if (!Number.isFinite(grainAngleDegrees)) throw new TypeError('Grain angle must be finite');
  const angle = grainAngleDegrees * Math.PI / 180, warp = [Math.cos(angle), Math.sin(angle)], weft = [-warp[1], warp[0]], faces = [];
  for (let f = 0; f < mesh.faceIds.length; f++) {
    const indices = mesh.triangles.slice(f * 3, f * 3 + 3), [a, b, c] = indices.map(i => xy(positions, i)), [p, q, r] = indices.map(i => meshPosition(mesh, i));
    const x1 = b[0] - a[0], y1 = b[1] - a[1], x2 = c[0] - a[0], y2 = c[1] - a[1], determinant = x1 * y2 - x2 * y1;
    const dx = p.map((v, i) => ((q[i] - v) * y2 - (r[i] - v) * y1) / determinant), dy = p.map((v, i) => (-(q[i] - v) * x2 + (r[i] - v) * x1) / determinant);
    const w = dx.map((v, i) => v * warp[0] + dy[i] * warp[1]), t = dx.map((v, i) => v * weft[0] + dy[i] * weft[1]);
    const wl = Math.hypot(...w), tl = Math.hypot(...t), cosine = Math.max(-1, Math.min(1, w.reduce((sum, v, i) => sum + v * t[i], 0) / (wl * tl)));
    faces.push({ faceId: mesh.faceIds[f], warp: wl - 1, weft: tl - 1, shearDegrees: Math.abs(90 - Math.acos(cosine) * 180 / Math.PI) });
  }
  if (materialBudget != null) {
    if (typeof materialBudget.source !== 'string' || !materialBudget.source || !Number.isFinite(materialBudget.maxShearDegrees) || materialBudget.maxShearDegrees < 0 || materialBudget.maxShearDegrees >= 90 || ['warp', 'weft'].some(axis => ![materialBudget[axis]?.min, materialBudget[axis]?.max].every(Number.isFinite) || materialBudget[axis].min <= -1 || materialBudget[axis].min > materialBudget[axis].max)) throw new TypeError('Material suitability needs sourced directional engineering-strain intervals and a shear limit');
  }
  const exceeded = materialBudget ? faces.filter(face => ['warp', 'weft'].some(axis => face[axis] < materialBudget[axis].min - 1e-9 || face[axis] > materialBudget[axis].max + 1e-9) || face.shearDegrees > materialBudget.maxShearDegrees + 1e-7) : [];
  return { faces, suitability: !materialBudget ? 'unknown' : exceeded.length ? 'budget-exceeded' : 'within-supplied-budget', exceededFaceIds: exceeded.map(face => face.faceId), source: materialBudget?.source ?? null, physicalFitVerified: false };
}
