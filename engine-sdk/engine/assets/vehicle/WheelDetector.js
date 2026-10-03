// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/vehicle/WheelDetector.js — find wheels (spec §11).
//
// Detection chain (cheap → expensive), each a HINT with a confidence, never an
// assertion: name match → cylinder geometry → symmetry / low-corner position →
// (editor correction). Wheels that are merged into the body mesh won't be found
// here and fall through to the editor (see VehicleRigBuilder.needsCorrection).

import { computeWorldMatrices, transformPoint } from './VehicleMath.js';
import { aabbCenter, aabbSize } from '../../core/math/MathGeometry.js';
import { statsMean } from '../../core/math/MathStatistics.js';

const NAME_RE = /wheel|tire|tyre|rim/i;
// Controls and drivetrain parts may contain the token "wheel" without being a
// road wheel. Exclude those semantic names before geometry scoring so a round
// steering wheel cannot become a fifth suspension slot.
const NON_ROAD_WHEEL_RE = /(?:^|[_\s-])(steering|fly|idler|pulley)[_\s-]*wheel(?:$|[_\s-])/i;

function meshLocalBounds(model, meshId) {
  const mesh = model.meshes.find((m) => m.id === meshId);
  if (!mesh) return null;
  let min = [Infinity, Infinity, Infinity]; let max = [-Infinity, -Infinity, -Infinity]; let any = false;
  for (const pid of mesh.primitives) {
    const prim = model.primitives.find((p) => p.id === pid);
    if (!prim?.bounds) continue;
    any = true;
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], prim.bounds.min[i]); max[i] = Math.max(max[i], prim.bounds.max[i]); }
  }
  return any ? { min, max } : null;
}

function worldAABB(matrix, local) {
  let min = [Infinity, Infinity, Infinity]; let max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const corner = [(i & 1) ? local.max[0] : local.min[0], (i & 2) ? local.max[1] : local.min[1], (i & 4) ? local.max[2] : local.min[2]];
    const w = transformPoint(matrix, corner);
    for (let c = 0; c < 3; c++) { if (w[c] < min[c]) min[c] = w[c]; if (w[c] > max[c]) max[c] = w[c]; }
  }
  const bounds = { min, max };
  bounds.center = aabbCenter(bounds);
  bounds.size = aabbSize(bounds);
  return bounds;
}

/** Cylinder-likeness in [0,1]: two similar large extents (diameter) + one thin (width). */
function cylinderScore(size) {
  const s = [...size].sort((a, b) => b - a);
  if (s[0] <= 1e-6) return 0;
  const diameterMatch = Math.max(0, 1 - Math.abs(s[0] - s[1]) / s[0]);   // top two similar
  const thinness = Math.max(0, 1 - s[2] / s[0]);                          // smallest is thin
  // A real cylinder needs the two large extents to be close; otherwise it's a
  // box/slab, not a wheel (keeps the chassis from scoring as a wheel).
  if (diameterMatch > 0.8) return Math.min(1, 0.5 + thinness * 0.5);
  return diameterMatch * thinness * 0.4;
}

/**
 * The axle axis = the extent most DIFFERENT from the other two. A wheel's two
 * "diameter" extents are near-equal; the remaining odd axis is the axle. This is
 * the thin width for a single wheel, OR the long lateral run for a coaxial wheel
 * PAIR baked into one mesh (e.g. "BackWheels") — both rear wheels share one axle
 * line, so a single spin about it rotates both correctly in place.
 */
function oddAxisIndex(e) {
  const d01 = Math.abs(e[0] - e[1]), d02 = Math.abs(e[0] - e[2]), d12 = Math.abs(e[1] - e[2]);
  if (d01 <= d02 && d01 <= d12) return 2; // 0 & 1 are the similar diameter pair
  if (d02 <= d01 && d02 <= d12) return 1; // 0 & 2 are the diameter pair
  return 0;                                // 1 & 2 are the diameter pair
}

function sideFromName(name) {
  const n = name.toLowerCase();
  let lr = /(_l\b|\bl\b|left|fl|rl|\.l)/.test(n) ? 'left' : (/(_r\b|\br\b|right|fr|rr|\.r)/.test(n) ? 'right' : null);
  let fb = /(front|fwd|fl|fr)/.test(n) ? 'front' : (/(rear|back|rl|rr)/.test(n) ? 'rear' : null);
  return { lr, fb };
}

/**
 * Detect wheel candidates in a model.
 * @returns {Array<{nodeId, name, worldCenter, localCenter, radius, width, score, side, source}>}
 */
export function detectWheels(model, opts = {}) {
  const world = computeWorldMatrices(model);
  const raw = [];
  for (const node of model.nodes || []) {
    if (!node.mesh) continue;
    if (NON_ROAD_WHEEL_RE.test(node.name || '')) continue;
    const local = meshLocalBounds(model, node.mesh);
    if (!local) continue;
    const aabb = worldAABB(world.get(node.id), local);
    const nameHit = NAME_RE.test(node.name || '');
    const cyl = cylinderScore(aabb.size);
    const score = (nameHit ? 0.6 : 0) + cyl * 0.5;
    if (score < (opts.threshold ?? 0.4)) continue;
    // Axle = the odd local axis (the wheel spins about it); pivot = mesh-local
    // bounds center so visual spin happens around the hub. The odd-axis rule also
    // handles a coaxial wheel pair merged into one mesh (axle = the long run).
    const ls = aabbSize(local);
    const axle = oddAxisIndex(ls);
    const axleAxisLocal = [axle === 0 ? 1 : 0, axle === 1 ? 1 : 0, axle === 2 ? 1 : 0];
    const localPivot = aabbCenter(local);
    // Radius from the DIAMETER (the two non-axle world extents), never the axle
    // run — so a merged pair reports the wheel radius, not half the axle length.
    const diameter = Math.max(...[0, 1, 2].filter((i) => i !== axle).map((i) => aabb.size[i]));
    raw.push({
      nodeId: node.id, name: node.name || node.id,
      worldCenter: aabb.center, localCenter: aabb.center,
      radius: diameter / 2, width: aabb.size[axle],
      axleAxisLocal, localPivot,
      score, nameHit, cyl, _name: sideFromName(node.name || ''),
    });
  }

  // Assign sides: name hints win; otherwise position relative to the wheel cluster
  // centroid. Geometry fallback assumes the conventional right-handed, +Z-forward,
  // +Y-up layout, where right = forward × up = +Z × +Y = -X, so LEFT = +X. This
  // keeps L/R consistent with the +Z = front assumption (named wheels override).
  if (raw.length) {
    const cx = statsMean(raw.map((wheel) => wheel.worldCenter[0]));
    const cz = statsMean(raw.map((wheel) => wheel.worldCenter[2]));
    for (const w of raw) {
      const lr = w._name.lr || (w.worldCenter[0] > cx ? 'left' : 'right');
      const fb = w._name.fb || (w.worldCenter[2] >= cz ? 'front' : 'rear');
      w.side = `${fb}-${lr}`;
      w.source = w.nameHit ? 'name' : 'geometry';
      delete w._name;
    }
  }
  return raw.sort((a, b) => b.score - a.score);
}
