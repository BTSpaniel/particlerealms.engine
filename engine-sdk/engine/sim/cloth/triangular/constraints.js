// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { vec3Sub as sub, vec3Cross as cross, vec3Dot as dot, vec3Length as length, vec3Scale as scale, vec3Add as add } from '../../../core/math/MathVec3.js';
import { clothError, strainCompliance } from './materials.js';

const sumWeighted = (positions, ids, weights) => [0, 1, 2].map(axis => ids.reduce((total, id, i) => total + positions[id][axis] * weights[i], 0));

/** Analytic signed dihedral and gradient; flat physical panels have zero rest angle. */
export function clothBendState(positions, ids) {
  const [a, b, c, d] = ids.map(id => positions[id]), edge = sub(b, a), left = sub(c, a), right = sub(d, a);
  const n1 = cross(edge, left), n2 = cross(right, edge), eLength = length(edge), n1Length = length(n1), n2Length = length(n2);
  if (Math.min(eLength, n1Length, n2Length) < 1e-15) throw clothError('DEGENERATE_STATE', 'A bending hinge collapsed');
  const e = scale(edge, 1 / eLength), u = scale(n1, 1 / n1Length), v = scale(n2, 1 / n2Length);
  const value = Math.atan2(dot(e, cross(u, v)), Math.max(-1, Math.min(1, dot(u, v))));
  const dn1 = scale(cross(u, e), 1 / n1Length), dn2 = scale(cross(e, v), 1 / n2Length);
  const db = add(cross(left, dn1), cross(dn2, right)), dc = cross(dn1, edge), dd = cross(edge, dn2);
  return { value, gradients: [scale(add(add(db, dc), dd), -1), db, dc, dd] };
}

export function clothConstraintState(model, constraint) {
  const { positions } = model;
  if (constraint.kind === 'attachment') {
    const [child, a, b, c] = constraint.ids.map(id => positions[id]), first = sub(b, a), second = sub(c, a), raw = cross(first, second), magnitude = length(raw);
    if (magnitude < 1e-15) throw clothError('DEGENERATE_STATE', 'An attachment parent triangle collapsed');
    const normal = scale(raw, 1 / magnitude), basis = [0, 0, 0]; basis[constraint.axis] = 1;
    const dn = scale(sub(basis, scale(normal, normal[constraint.axis])), -constraint.normalOffset / magnitude);
    const db = cross(second, dn), dc = cross(dn, first), da = scale(add(db, dc), -1);
    const gradients = [basis, ...[da, db, dc].map((gradient, i) => sub(gradient, scale(basis, constraint.barycentric[i])))];
    const value = child[constraint.axis] - constraint.ids.slice(1).reduce((sum, id, i) => sum + positions[id][constraint.axis] * constraint.barycentric[i], 0) - constraint.normalOffset * normal[constraint.axis];
    return { value, gradients, compliance: constraint.compliance };
  }
  if (constraint.kind === 'bend') return { ...clothBendState(positions, constraint.ids), compliance: constraint.compliance };
  if (constraint.kind === 'seam') {
    const delta = sumWeighted(positions, constraint.ids, constraint.weights), value = length(delta);
    return { value, gradients: constraint.weights.map(weight => scale(delta, value > 1e-15 ? weight / value : 0)), compliance: constraint.compliance };
  }
  const triangle = constraint.triangle, warp = sumWeighted(positions, triangle.ids, triangle.warp), weft = sumWeighted(positions, triangle.ids, triangle.weft);
  const warpLength = length(warp), weftLength = length(weft);
  if (Math.min(warpLength, weftLength) < 1e-9) throw clothError('DEGENERATE_STATE', 'A physical grain direction collapsed', { triangle: triangle.index });
  const u = scale(warp, 1 / warpLength), v = scale(weft, 1 / weftLength);
  if (constraint.kind !== 'shear') {
    const isWarp = constraint.kind === 'warp', value = (isWarp ? warpLength : weftLength) - 1;
    return { value, gradients: (isWarp ? triangle.warp : triangle.weft).map(weight => scale(isWarp ? u : v, weight)),
      compliance: strainCompliance(isWarp ? triangle.material.warp : triangle.material.weft, value, triangle.area) };
  }
  const cosine = Math.max(-1, Math.min(1, dot(u, v))), sine = Math.sqrt(Math.max(0, 1 - cosine * cosine));
  if (sine < 1e-7) throw clothError('DEGENERATE_STATE', 'The panel strain frame became collinear', { triangle: triangle.index });
  const value = Math.asin(cosine), du = scale(sub(v, scale(u, cosine)), 1 / (warpLength * sine)), dv = scale(sub(u, scale(v, cosine)), 1 / (weftLength * sine));
  return { value, gradients: triangle.ids.map((id, i) => add(scale(du, triangle.warp[i]), scale(dv, triangle.weft[i]))), compliance: strainCompliance(triangle.material.shear, value, triangle.area, true) };
}

/** XPBD accumulated multiplier, reset at each substep (Macklin et al., 2016). */
export function projectClothConstraint(model, constraint, h) {
  const state = clothConstraintState(model, constraint);
  if (state.compliance == null) { constraint.lambda = 0; return 0; }
  const gradients = new Map();
  constraint.ids.forEach((id, i) => { const root = model.vertexDof[id]; gradients.set(root, gradients.has(root) ? add(gradients.get(root), state.gradients[i]) : state.gradients[i]); });
  const alpha = state.compliance / (h * h), denominator = alpha + [...gradients].reduce((sum, [id, gradient]) => sum + model.inverseMasses[id] * dot(gradient, gradient), 0);
  if (denominator < 1e-20) return 0;
  const deltaLambda = (-state.value - alpha * constraint.lambda) / denominator;
  if (!Number.isFinite(deltaLambda)) throw clothError('NONFINITE_STATE', 'A cloth multiplier became nonfinite');
  constraint.lambda += deltaLambda;
  let maximum = 0;
  for (const [id, gradient] of gradients) {
    const correction = scale(gradient, model.inverseMasses[id] * deltaLambda);
    maximum = Math.max(maximum, length(correction));
    for (let axis = 0; axis < 3; axis++) model.positions[id][axis] += correction[axis];
  }
  return maximum;
}

export function clothConstraintDiagnostics(model) {
  const issues = [], attachmentSquares = new Map(), maxima = { warpStrain: 0, weftStrain: 0, shearDegrees: 0, bendDegrees: 0, seamGapMm: 0, attachmentGapMm: 0 };
  for (const constraint of model.constraints) {
    const { value } = clothConstraintState(model, constraint), absolute = Math.abs(value);
    if (constraint.kind === 'attachment') attachmentSquares.set(constraint.id, (attachmentSquares.get(constraint.id) || 0) + value * value);
    else if (constraint.kind === 'seam') maxima.seamGapMm = Math.max(maxima.seamGapMm, absolute * 1000);
    else if (constraint.kind === 'bend') maxima.bendDegrees = Math.max(maxima.bendDegrees, absolute * 180 / Math.PI);
    else {
      const key = constraint.kind === 'shear' ? 'shearDegrees' : `${constraint.kind}Strain`, display = constraint.kind === 'shear' ? absolute * 180 / Math.PI : absolute;
      maxima[key] = Math.max(maxima[key], display);
      const budget = constraint.triangle.material.budgets?.[constraint.kind === 'shear' ? 'shearDegrees' : `${constraint.kind}${value < 0 ? 'Compression' : 'Extension'}`];
      if (budget && display > budget.value + 1e-9) issues.push({ code: 'MATERIAL_BUDGET_EXCEEDED', triangle: constraint.triangle.index, materialId: constraint.triangle.material.id, direction: constraint.kind, value: display, limit: budget.value });
    }
  }
  for (const value of attachmentSquares.values()) maxima.attachmentGapMm = Math.max(maxima.attachmentGapMm, Math.sqrt(value) * 1000);
  return { ...maxima, issues };
}
