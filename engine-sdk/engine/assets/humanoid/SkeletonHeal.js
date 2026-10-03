// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/humanoid/SkeletonHeal.js — anatomy-aware, NON-DESTRUCTIVE skeleton
// repair. When a rig is missing or mislabels core bones, infer them from anatomy
// (the same heuristics auto-riggers use):
//   • Pelvis = the point between the two hip joints (and the retarget root must be
//     the pelvis, NOT a ground/root-motion bone — so a "Root"/Armature bone at the
//     floor is replaced by the leg-derived pelvis).
//   • Missing spine / chest / neck are interpolated along the hips→head chain.
//   • A missing left/right limb is MIRRORED from the present side across the body's
//     sagittal plane (auto-mirror).
// Inferred joints are written to `rig.synthesized` (slot → position) — the source
// model is never modified. `humanoidBonePosition()` returns the real joint if it
// exists, else the synthesized one.

import { buildBindPose, jointPosition } from './SkinPose.js';
import {
  vec3Dot,
  vec3Lerp,
  vec3Midpoint,
  vec3Scale,
  vec3SetComponent,
  vec3Sub,
} from '../../core/math/MathVec3.js';

const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

const SIDED = ['Shoulder', 'UpperArm', 'LowerArm', 'Hand', 'UpperLeg', 'LowerLeg', 'Foot', 'Toes'];

/** Real or synthesized world position for a canonical slot (or null). */
export function humanoidBonePosition(rig, slot, pose) {
  const id = rig?.bones?.[slot];
  const p = id ? jointPosition(pose, id) : null;
  return p || rig?.synthesized?.[slot] || null;
}

/**
 * Repair a humanoid rig in place (non-destructively): fills `rig.synthesized` with
 * inferred joints and `rig.healed` with a list of what was repaired.
 * @param {object} model EngineModel
 * @param {object} rig model.rigs.humanoid
 * @param {Map} [pose] node-hierarchy world map
 * @returns {{synthesized:object, healed:string[]}}
 */
export function healHumanoid(model, rig, pose) {
  pose = pose || buildBindPose(model);
  const real = {};
  for (const s of Object.keys(rig.bones || {})) { const p = jointPosition(pose, rig.bones[s]); if (p) real[s] = p; }
  const synth = {};
  const healed = [];
  const get = (s) => real[s] || synth[s] || null;

  // lateral (left↔right) axis from the widest bilateral pair available
  const lUL = real.leftUpperLeg; const rUL = real.rightUpperLeg;
  const lUA = real.leftUpperArm; const rUA = real.rightUpperArm;
  let lat = null;
  if (lUL && rUL) lat = norm(vec3Sub(lUL, rUL));
  else if (lUA && rUA) lat = norm(vec3Sub(lUA, rUA));

  // 1) Pelvis from the leg roots; replace a ground/root bone masquerading as hips.
  if (lUL && rUL) {
    const pelvis = vec3Midpoint(lUL, rUL);
    if (!real.hips) { synth.hips = pelvis; healed.push('hips←legs'); }
    else {
      const hipY = Math.max(lUL[1], rUL[1]);
      const legLen = real.leftFoot ? Math.abs(lUL[1] - real.leftFoot[1]) : 1;
      // hips far BELOW the hip joints ⇒ it's a floor/root bone, not the pelvis.
      if (real.hips[1] < hipY - 0.25 * legLen) { synth.hips = pelvis; healed.push('hips:root→pelvis'); }
    }
  }

  // 2) Interpolate a missing torso chain along hips→head.
  const hips = get('hips'); const head = get('head');
  if (hips && head) {
    if (!get('neck')) { synth.neck = vec3Lerp(hips, head, 0.85); healed.push('neck←interp'); }
    const neck = get('neck');
    if (neck) {
      if (!get('spine')) { synth.spine = vec3Lerp(hips, neck, 0.25); healed.push('spine←interp'); }
      if (!get('chest')) { synth.chest = vec3Lerp(hips, neck, 0.55); healed.push('chest←interp'); }
    }
  }

  // 3) Mirror a missing left/right limb across the sagittal plane.
  if (lat) {
    const center = get('hips') || get('spine') || [0, 0, 0];
    const mirror = (p) => { const d = 2 * vec3Dot(vec3Sub(p, center), lat); return vec3Sub(p, vec3Scale(lat, d)); };
    for (const part of SIDED) {
      for (const [a, b] of [['left', 'right'], ['right', 'left']]) {
        const dst = a + part; const src = b + part;
        if (!get(dst) && get(src)) { synth[dst] = mirror(get(src)); healed.push(`${dst}←mirror`); }
      }
    }
  }

  rig.synthesized = synth;
  rig.healed = healed;
  return { synthesized: synth, healed };
}

// ── Generic creatures (spiders / dogs / cats / birds) ────────────────────────
// No canonical slots — repair by BILATERAL SYMMETRY: find the sagittal plane, and
// if a limb exists on one side but not its mirror, synthesize the mirrored chain.

/** Joint nodes: skin joints if present, else all nodes. */
function jointNodes(model) {
  const ids = new Set();
  for (const skin of model.skins || []) for (const j of (skin.joints || skin.raw?.joints || [])) ids.add(`node:${j}`);
  return ids.size ? (model.nodes || []).filter((n) => ids.has(n.id)) : (model.nodes || []);
}

/**
 * Find the skeleton's plane of bilateral symmetry.
 * @returns {{lateralAxis:number, center:number[], size:number, tol:number, score:number, unpaired:string[]}|null}
 */
export function analyzeSymmetry(model, pose) {
  pose = pose || buildBindPose(model);
  const nodes = jointNodes(model);
  const idset = new Set(nodes.map((n) => n.id));
  const pts = nodes.map((n) => ({ id: n.id, p: jointPosition(pose, n.id), parent: n.parent })).filter((x) => x.p);
  if (pts.length < 4) return null;
  // Anchor the sagittal plane at the skeleton ROOT(s), not the centroid — a missing
  // limb shifts the centroid (toward the present side) and corrupts the mirror.
  const roots = pts.filter((x) => !(x.parent && idset.has(x.parent)));
  const base = roots.length ? roots : pts;
  const C = [0, 0, 0];
  for (const { p } of base) { C[0] += p[0]; C[1] += p[1]; C[2] += p[2]; }
  C[0] /= base.length; C[1] /= base.length; C[2] /= base.length;
  let size = 0; for (const { p } of pts) size = Math.max(size, len(vec3Sub(p, C)));
  const tol = Math.max(1e-4, size * 0.06);

  let best = { lateralAxis: 0, center: C, size, tol, score: -1, unpaired: [] };
  for (let k = 0; k < 3; k++) {
    let matched = 0; const unpaired = [];
    for (const a of pts) {
      const m = vec3SetComponent(a.p, k, 2 * C[k] - a.p[k]); // reflect across the plane perpendicular to axis k
      let bd = tol; let hit = false;
      for (const b of pts) { if (b.id === a.id) continue; if (len(vec3Sub(b.p, m)) < bd) { bd = len(vec3Sub(b.p, m)); hit = true; } }
      if (hit) matched++;
      else if (Math.abs(a.p[k] - C[k]) > tol * 1.5) unpaired.push(a.id); // off-centre with no mirror
    }
    const score = matched / pts.length;
    if (score > best.score) best = { lateralAxis: k, center: C, size, tol, score, unpaired };
  }
  return best;
}

/**
 * Heal a generic skeleton by mirroring limbs that exist on only one side.
 * @returns {{synthesized:object[], healed:string[], symmetry:object|null}}
 *   synthesized = [{ id, mirroredFrom, parentId, position, name }]
 */
export function healSkeleton(model, pose) {
  pose = pose || buildBindPose(model);
  const sym = analyzeSymmetry(model, pose);
  if (!sym) return { synthesized: [], healed: [], symmetry: null };
  const k = sym.lateralAxis; const C = sym.center;
  const byId = new Map((model.nodes || []).map((n) => [n.id, n]));
  const inSet = new Set(jointNodes(model).map((n) => n.id));
  const mirror = (p) => vec3SetComponent(p, k, 2 * C[k] - p[k]);

  const unpaired = new Set(sym.unpaired);
  // Roots of unpaired subtrees = unpaired joints whose parent isn't itself unpaired.
  const roots = sym.unpaired.filter((id) => { const n = byId.get(id); return !(n?.parent && unpaired.has(n.parent)); });

  const synthesized = []; const healed = []; const map = new Map(); // origId → synthId
  for (const rootId of roots) {
    const stack = [rootId];
    while (stack.length) {
      const id = stack.pop(); const n = byId.get(id); const pos = jointPosition(pose, id);
      if (!n || !pos) continue;
      const parentOrig = n.parent && inSet.has(n.parent) ? n.parent : null;
      const parentId = parentOrig && map.has(parentOrig) ? map.get(parentOrig) : parentOrig; // mirror within subtree, else the (shared, central) parent
      const sid = `synth:mirror:${id}`;
      map.set(id, sid);
      synthesized.push({ id: sid, mirroredFrom: id, parentId, position: mirror(pos), name: `${n.name || id}.mirror` });
      for (const c of n.children || []) if (inSet.has(c)) stack.push(c);
    }
    healed.push(`mirror:${byId.get(rootId)?.name || rootId}`);
  }

  model.metadata = model.metadata || {};
  model.metadata.skeletonHeal = { lateralAxis: 'XYZ'[k], symmetry: Math.round(sym.score * 100), mirroredLimbs: roots.length, synthesized: synthesized.length };
  return { synthesized, healed, symmetry: sym };
}
