// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/rig/RagdollSkinning.js — make the live MESH follow a ragdoll.
//
// The ragdoll sim (RagdollSim) only moves joint POSITIONS. To deform the skinned
// mesh with it we need a per-joint world transform. We build a ragdoll over the
// model's actual SKIN JOINTS (1:1 with the skin's joint slots, so vertex skin
// weights index straight into it) and, each frame, derive a per-bone rotation
// from the rest→current bone direction. Skinning is then the standard linear
// blend in SCENE space (the renderer applies importMatrix afterwards):
//
//   v' = Σ wⱼ · ( Rⱼ · (v − bindPosⱼ) + curPosⱼ )
//
// At the bind pose Rⱼ=I and curPos=bindPos, so v'=v (the baked mesh). This needs
// no inverse-bind matrices because jointBindWorld·IBM = I per joint. Pure JS.

import { buildBindPose, jointPosition } from '../humanoid/SkinPose.js';
import { deriveSkeletonJointLimits } from './JointLimits.js';
import { createRagdollSim } from './RagdollSim.js';
import {
  vec3Add,
  vec3Clone,
  vec3Cross,
  vec3Dot,
  vec3Negate,
  vec3Scale,
  vec3Sub,
} from '../../core/math/MathVec3.js';

const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1e-9; return [a[0] / l, a[1] / l, a[2] / l]; };
const IDENT3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// Row-major 3×3 rotation taking unit `a` → unit `b` (Rodrigues; handles parallel
// and antiparallel). r' = R·v with R[row*3+col].
function rotBetween(a, b) {
  const v = vec3Cross(a, b);
  const c = vec3Dot(a, b);
  if (c > 0.99999) return IDENT3.slice();
  if (c < -0.99999) {
    // 180°: rotate about any axis ⊥ a → R = 2·p⊗p − I
    const p = unit(Math.abs(a[1]) < 0.9 ? vec3Cross(a, [0, 1, 0]) : vec3Cross(a, [1, 0, 0]));
    return [2 * p[0] * p[0] - 1, 2 * p[0] * p[1], 2 * p[0] * p[2],
            2 * p[1] * p[0], 2 * p[1] * p[1] - 1, 2 * p[1] * p[2],
            2 * p[2] * p[0], 2 * p[2] * p[1], 2 * p[2] * p[2] - 1];
  }
  const k = 1 / (1 + c);
  const x = v[0], y = v[1], z = v[2];
  return [
    1 + k * (-(z * z + y * y)), -z + k * (x * y), y + k * (x * z),
    z + k * (x * y), 1 + k * (-(z * z + x * x)), -x + k * (y * z),
    -y + k * (x * z), x + k * (y * z), 1 + k * (-(y * y + x * x)),
  ];
}

/**
 * Build a ragdoll over a model's skin joints (1:1 with skin slot indices) and a
 * sim for it. Joint limits come from the humanoid rig where mapped, else generic
 * topology. Returns null when the model has no skin to drive.
 * @param {object} model EngineModel (must be baked: bakeSkinnedMeshes already ran)
 * @param {object} [opts] { gravityMag, importMatrix, damping, iterations, pinned }
 * @returns {{sim, bones, joints, childSlot, jointCount}|null}
 */
export function buildSkinnedRagdoll(model, opts = {}) {
  const skin = model.skins?.[0];
  const joints = skin && (skin.joints || skin.raw?.joints);
  if (!joints?.length) return null;

  const pose = buildBindPose(model);
  const byId = new Map((model.nodes || []).map((n) => [n.id, n]));
  // Skin weights reference JOINT SLOTS, not scene node indices. `slotOf` lets us
  // turn a glTF parent node chain back into the matching skin slot for simulation.
  const slotOf = new Map(); joints.forEach((idx, s) => slotOf.set(`node:${idx}`, s));

  // Limit priority: humanoid rig metadata when present; otherwise use generic
  // skeleton-derived limits so arbitrary imported creatures still get a ragdoll.
  const genLim = deriveSkeletonJointLimits(model, pose);
  const humRig = model.rigs?.humanoid;
  const humLim = humRig?.jointLimits;
  const nodeToCanon = new Map();
  if (humRig?.bones) for (const [canon, nodeId] of Object.entries(humRig.bones)) if (nodeId) nodeToCanon.set(nodeId, canon);

  // Build one ragdoll particle per skin joint. This preserves the exact joint slot
  // indices used by vertex weights, so no remapping is needed during skinning.
  const bones = joints.map((idx, s) => {
    const id = `node:${idx}`;
    const node = byId.get(id);
    let p = node?.parent; let pslot = -1;
    while (p) { if (slotOf.has(p)) { pslot = slotOf.get(p); break; } p = byId.get(p)?.parent; }
    const position = jointPosition(pose, id) || [0, 0, 0];
    const canon = nodeToCanon.get(id);
    const lim = (canon && humLim && humLim.get(canon)) ? humLim.get(canon) : genLim.get(id);
    // `parentIndex` points to another skin slot, not a node id. Root joints use -1.
    return {
      id, slot: s, parentIndex: pslot, position, label: canon || (node?.name) || id,
      jointType: lim?.jointType || (pslot < 0 ? 'root' : 'ball'),
      swingDeg: lim?.swingDeg ?? 45, twistDeg: lim?.twistDeg ?? 30,
    };
  });

  // Reference child per bone → defines the live bone rotation. Pick the child with
  // the LARGEST subtree (so the pelvis follows the spine, not a leg; an upper arm
  // follows the forearm, etc.) rather than just the first child in slot order.
  const n = bones.length;
  const kids = bones.map(() => []);
  for (let i = 0; i < n; i++) { const p = bones[i].parentIndex; if (p >= 0) kids[p].push(i); }
  const subSize = new Array(n).fill(0);
  const sizeOf = (i) => { if (subSize[i]) return subSize[i]; let s = 1; for (const c of kids[i]) s += sizeOf(c); subSize[i] = s; return s; };
  for (let i = 0; i < n; i++) sizeOf(i);
  const childSlot = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) { let best = -1; let bs = -1; for (const c of kids[i]) if (subSize[c] > bs) { bs = subSize[c]; best = c; } childSlot[i] = best; }

  // Anterior (body-facing) direction from the feet→toes — a reliable, geometry-only
  // forward axis. We use it to give knees/elbows a one-way bend: a knee flexes
  // POSTERIOR (−anterior), an elbow flexes ANTERIOR. The sim turns this `flexTarget`
  // into a signed hinge so the joint can't bend the wrong way.
  let anterior = null;
  if (humRig?.bones) {
    const jp = (slot) => { const nid = humRig.bones[slot]; return nid ? jointPosition(pose, nid) : null; };
    const dirs = [];
    for (const side of ['left', 'right']) { const f = jp(`${side}Foot`); const tp = jp(`${side}Toes`); if (f && tp) dirs.push(unit(vec3Sub(tp, f))); }
    if (dirs.length) anterior = unit(dirs.reduce((acc, d) => vec3Add(acc, d), [0, 0, 0]));
  }
  if (anterior) {
    for (const b of bones) {
      if (b.jointType !== 'hinge') continue;
      const canon = nodeToCanon.get(b.id) || '';
      if (canon.endsWith('LowerLeg')) b.flexTarget = vec3Negate(anterior);
      else if (canon.endsWith('LowerArm')) b.flexTarget = vec3Clone(anterior);
    }
  }

  // Anatomical hip swing cone, referenced to a pelvis frame that tracks the body.
  // A symmetric cone let the legs splay sideways to the limit and rest there
  // (spread-eagle). Instead we use an ELLIPTICAL cone about body-down with separate
  // limits: generous forward flexion, small back-extension, tight sideways
  // abduction. The frame = body-down (hips−spine) + body-lateral (R−L hip sockets);
  // anterior disambiguates forward via the feet→toes axis.
  if (humRig?.bones) {
    const canonIdx = (slot) => { for (let i = 0; i < n; i++) if (nodeToCanon.get(bones[i].id) === slot) return i; return -1; };
    const hipsIdx = canonIdx('hips');
    const upRefIdx = ['spine', 'chest', 'upperChest', 'neck', 'head'].map(canonIdx).find((i) => i >= 0) ?? -1;
    const lLegIdx = canonIdx('leftUpperLeg');
    const rLegIdx = canonIdx('rightUpperLeg');
    if (hipsIdx >= 0 && upRefIdx >= 0) {
      // Sign that makes cross(lateral, down) point ANTERIOR (forward), so we know
      // which side is flexion vs extension as the pelvis tumbles.
      let fwdSign = 1;
      if (anterior && lLegIdx >= 0 && rLegIdx >= 0) {
        const down0 = unit(vec3Sub(bones[hipsIdx].position, bones[upRefIdx].position));
        const lat0 = unit(vec3Sub(bones[rLegIdx].position, bones[lLegIdx].position));
        const fwd0 = vec3Cross(lat0, down0);
        fwdSign = vec3Dot(fwd0, anterior) >= 0 ? 1 : -1;
      }
      const ell = (anterior && lLegIdx >= 0 && rLegIdx >= 0)
        ? { lIdx: lLegIdx, rIdx: rLegIdx, fwdSign, maxFwd: 100, maxBack: 20, maxSide: 45 } : null;
      for (let i = 0; i < n; i++) {
        const cn = nodeToCanon.get(bones[i].id) || '';
        if (cn.endsWith('UpperLeg') && bones[i].jointType === 'ball' && childSlot[i] >= 0) {
          bones[i].swingCone = { aIdx: upRefIdx, bIdx: hipsIdx, half: bones[i].swingDeg ?? 70, child: childSlot[i], ...(ell || {}) };
        }
      }
    }
  }

  // Shoulder swing cone — CARRIED frame (Bullet/Unity-style rest-relative cone). In a
  // T-pose the arm points sideways, so a body-down cone is wrong; instead we store the
  // rest arm direction + a forward/up frame and rotate it each step by the parent
  // (clavicle) bone's swing so the limits track the torso. Elliptical: big forward
  // flexion, moderate back-extension, generous up/down abduction.
  if (anterior) {
    for (let i = 0; i < n; i++) {
      const cn = nodeToCanon.get(bones[i].id) || '';
      if (!cn.endsWith('UpperArm') || bones[i].jointType !== 'ball') continue;
      const child = childSlot[i]; if (child < 0) continue;
      const cp = bones[i].parentIndex; if (cp < 0) continue;           // clavicle/shoulder
      const cgp = bones[cp].parentIndex; if (cgp < 0) continue;        // upperChest/chest
      const center0 = unit(vec3Sub(bones[child].position, bones[i].position)); // rest arm dir (lateral)
      const d = vec3Dot(anterior, center0);
      let fwd0 = vec3Sub(anterior, vec3Scale(center0, d));
      const fl = Math.hypot(fwd0[0], fwd0[1], fwd0[2]); if (fl < 1e-4) continue; // arm ∥ anterior
      fwd0 = [fwd0[0] / fl, fwd0[1] / fl, fwd0[2] / fl];
      const lat0 = unit(vec3Cross(center0, fwd0)); // up/down axis (abduction/adduction)
      bones[i].swingCone = {
        child, half: bones[i].swingDeg ?? 90, maxFwd: 110, maxBack: 50, maxSide: 90,
        carry: { cp, cgp, center0, fwd0, lat0 },
      };
    }
  }

  // Gravity in SCENE space = render "down" mapped back through importMatrix's
  // rotation (column-major: inverse-rotate [0,-1,0]). Ground is the lowest joint.
  const M = opts.importMatrix;
  // The importer may rotate models into engine scene space. Gravity must follow the
  // rendered model's down direction, not always raw glTF -Y.
  let gravity = [0, -(opts.gravityMag ?? 9.8), 0];
  if (M) {
    const d = unit([-M[1], -M[5], -M[9]]); const g = opts.gravityMag ?? 9.8;
    gravity = vec3Scale(d, g);
  }
  const ground = Math.min(...bones.map((b) => b.position[1]));

  // Pass only the options RagdollSkinning actually needs to compute itself
  // (gravity/ground — scene- and import-orientation-specific, `damping` —
  // deliberately softer here than RagdollSim's own default) or pass straight
  // through unset (`undefined`) for everything else, letting RagdollSim.js
  // own every radius-scaled stability default in exactly one place. This
  // used to duplicate RagdollSim's own `radius0 * k` formulas against a
  // second, independently-computed `radius` — same value today only because
  // both compute it identically, but a real drift risk if either changed.
  const sim = createRagdollSim({ bones }, {
    gravity, ground, damping: opts.damping ?? 0.985,
    iterationsPerSubstep: opts.iterationsPerSubstep, substeps: opts.substeps,
    maxSubDt: opts.maxSubDt, maxFrameDt: opts.maxFrameDt,
    maxVelocity: opts.maxVelocity, maxHorizontalVelocity: opts.maxHorizontalVelocity, maxVerticalVelocity: opts.maxVerticalVelocity,
    velocityClampFactor: opts.velocityClampFactor,
    maxProjection: opts.maxProjection, angularProjection: opts.angularProjection, angularBias: opts.angularBias,
    hingeProjection: opts.hingeProjection, hingeBias: opts.hingeBias,
    maxDisplacement: opts.maxDisplacement, boundsRadius: opts.boundsRadius,
    clampBurstLimit: opts.clampBurstLimit, clampBurstDamping: opts.clampBurstDamping,
    selfCollision: opts.selfCollision, selfCollisionScale: opts.selfCollisionScale, selfCollisionIterations: opts.selfCollisionIterations,
    selfCollisionStrength: opts.selfCollisionStrength, selfCollisionProjection: opts.selfCollisionProjection,
    globalDrag: opts.globalDrag,
    warmupTime: opts.warmupTime, warmupDamping: opts.warmupDamping, warmupGravityScale: opts.warmupGravityScale,
    pinned: opts.pinned,
  });
  return { sim, bones, joints, childSlot, jointCount: bones.length };
}

/**
 * Per-bone frames for the current sim state: rotation (3×3 row-major), current
 * position, and bind position. Bones with no child inherit their parent's
 * rotation (so leaf verts swing with the limb).
 * @returns {{R:number[][], pos:number[][], bind:number[][]}}
 */
export function ragdollBoneFrames(state) {
  const pos = state.sim.positions();
  const n = state.bones.length;
  // Rebuild a rotation for each joint from its bind direction to its simulated live
  // direction. The physics solver owns positions only; this derives render frames.
  const R = new Array(n);
  for (let i = 0; i < n; i++) {
    const c = state.childSlot[i];
    if (c >= 0) {
      const rest = unit(vec3Sub(state.bones[c].position, state.bones[i].position));
      const cur = unit(vec3Sub(pos[c], pos[i]));
      R[i] = rotBetween(rest, cur);
    } else R[i] = null;
  }
  // Leaf joints have no child direction, so inherit the nearest parent rotation.
  // If there is no parent frame, use identity to keep bind-pose vertices unchanged.
  for (let i = 0; i < n; i++) { if (!R[i]) { const p = state.bones[i].parentIndex; R[i] = (p >= 0 && R[p]) ? R[p] : IDENT3.slice(); } }
  return { R, pos, bind: state.bones.map((b) => b.position) };
}

/**
 * Linear-blend skin a primitive into a standard interleaved [pos3,nrm3,uv2]
 * buffer (UVs at o+6/o+7 are left untouched). Writes scene-space positions so the
 * renderer's importMatrix lands them correctly. Mutates + returns `outInterleaved`.
 * @param {object} prim primitive with _bindPosition + attributes.{normal,joints,weights}
 * @param {object} frames ragdollBoneFrames() output
 * @param {number} jointCount number of ragdoll bones (skip weights beyond it)
 * @param {Float32Array} outInterleaved stride-8 buffer (pre-seeded with baked UVs)
 */
export function skinPrimitiveInterleaved(prim, frames, jointCount, outInterleaved) {
  const v = prim._bindPosition || prim.attributes.position;
  const nb = prim.attributes.normal;
  const jnt = prim.attributes.joints;
  const wgt = prim.attributes.weights;
  if (!v || !jnt || !wgt) return outInterleaved;
  const hasN = nb && nb.length === v.length;
  const vc = v.length / 3;
  const { R, pos: P, bind: B } = frames;
  // Standard four-weight linear blend skinning. Each joint transforms the bind
  // vertex around its bind joint position, then translates it to the live particle.
  for (let i = 0; i < vc; i++) {
    const px = v[i * 3], py = v[i * 3 + 1], pz = v[i * 3 + 2];
    let ox = 0, oy = 0, oz = 0, nx = 0, ny = 0, nz = 0, wsum = 0;
    for (let k = 0; k < 4; k++) {
      const w = wgt[i * 4 + k]; if (w <= 0) continue;
      const j = jnt[i * 4 + k]; if (j >= jointCount) continue;
      const r = R[j]; const b = B[j]; const p = P[j]; if (!r) continue;
      const rx = px - b[0], ry = py - b[1], rz = pz - b[2];
      ox += w * (r[0] * rx + r[1] * ry + r[2] * rz + p[0]);
      oy += w * (r[3] * rx + r[4] * ry + r[5] * rz + p[1]);
      oz += w * (r[6] * rx + r[7] * ry + r[8] * rz + p[2]);
      if (hasN) {
        const ix = nb[i * 3], iy = nb[i * 3 + 1], iz = nb[i * 3 + 2];
        nx += w * (r[0] * ix + r[1] * iy + r[2] * iz);
        ny += w * (r[3] * ix + r[4] * iy + r[5] * iz);
        nz += w * (r[6] * ix + r[7] * iy + r[8] * iz);
      }
      wsum += w;
    }
    const o = i * 8;
    if (wsum > 1e-6) { outInterleaved[o] = ox; outInterleaved[o + 1] = oy; outInterleaved[o + 2] = oz; }
    else { outInterleaved[o] = px; outInterleaved[o + 1] = py; outInterleaved[o + 2] = pz; }
    if (hasN) { const l = Math.hypot(nx, ny, nz) || 1; outInterleaved[o + 3] = nx / l; outInterleaved[o + 4] = ny / l; outInterleaved[o + 5] = nz / l; }
  }
  return outInterleaved;
}

const DEG = (r) => +(r * 180 / Math.PI).toFixed(1);
const r2 = (x) => +x.toFixed(3);
// Compact quaternion readout for debug tables. The renderer uses matrices; the
// quaternion is only telemetry so weird flips are easier to spot in logs.
function quatFromMat3(m) {
  const t = m[0] + m[4] + m[8];
  let x; let y; let z; let w;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; w = 0.25 * s; x = (m[7] - m[5]) / s; y = (m[2] - m[6]) / s; z = (m[3] - m[1]) / s; }
  else if (m[0] > m[4] && m[0] > m[8]) { const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2; w = (m[7] - m[5]) / s; x = 0.25 * s; y = (m[1] + m[3]) / s; z = (m[2] + m[6]) / s; }
  else if (m[4] > m[8]) { const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2; w = (m[2] - m[6]) / s; x = (m[1] + m[3]) / s; y = 0.25 * s; z = (m[5] + m[7]) / s; }
  else { const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2; w = (m[3] - m[1]) / s; x = (m[2] + m[6]) / s; y = (m[5] + m[7]) / s; z = 0.25 * s; }
  return [r2(x), r2(y), r2(z), r2(w)];
}

/**
 * One-time STATIC report of a built ragdoll: every joint's type + auto-detected
 * limits, and the full constraint breakdown (bone sticks, hub bracing, ROM, signed
 * hinges, swing cones). Prints rich console.tables when available; always returns a
 * one-line summary string (also handed to `logFn` for the in-app console).
 */
export function logSkinnedRagdoll(state, logFn) {
  const { bones, sim, jointCount } = state;
  const out = (typeof logFn === 'function') ? logFn : () => {};
  const distAll = sim.constraints || [];
  const hubN = distAll.filter((c) => c.hub).length;
  const boneN = distAll.length - hubN;
  const types = {}; for (const b of bones) types[b.jointType] = (types[b.jointType] || 0) + 1;
  const typeStr = Object.entries(types).map(([k, v]) => `${v} ${k}`).join(' · ');
  const summary = `ragdoll built: ${jointCount} joints (${typeStr}) — ${boneN} bone + ${hubN} hub sticks, `
    + `${sim.angleConstraints.length} ROM, ${sim.hingeConstraints.length} hinge, ${sim.coneConstraints.length} cone`;
  out(summary);
  if (typeof console === 'undefined') return summary;
  /* eslint-disable no-console */
  const titleCss = 'background:linear-gradient(90deg,#5eead4,#38bdf8);color:#04111a;font-weight:700;padding:2px 10px;border-radius:5px';
  const headCss = 'color:#7dd3fc;font-weight:700';
  // EXPANDED group (not collapsed) so the full build report is visible at a glance.
  (console.group || console.log).call(console, '%c RAGDOLL %c ' + summary, titleCss, 'color:#9bbcd1');
  console.log('%cmethod: position-based Verlet + signed hinges + elliptical swing cones (Bullet/Unity/PhysX-style)', 'color:#64748b;font-style:italic');
  if (console.table) {
    console.log('%c● joints — type · ROM(swing/twist°) · one-way hinge · swing cone', headCss);
    console.table(bones.map((b, i) => ({
      idx: i, joint: b.label, type: b.jointType, swingDeg: b.swingDeg, twistDeg: b.twistDeg,
      parent: b.parentIndex >= 0 ? bones[b.parentIndex].label : '—',
      oneWayHinge: b.flexTarget ? '⟲ yes' : '',
      swingCone: b.swingCone ? (b.swingCone.maxFwd != null ? `${b.swingCone.carry ? 'arm' : 'hip'} ellipse fwd${b.swingCone.maxFwd}/back${b.swingCone.maxBack}/side${b.swingCone.maxSide}°` : `cone ${b.swingCone.half}°`) : '',
    })));
    if (sim.hingeConstraints.length) {
      console.log('%c● signed hinges (knees/elbows) — flex ONE way only', headCss);
      console.table(sim.hingeConstraints.map((c) => ({ joint: bones[c.p].label, child: bones[c.i].label, maxBendDeg: DEG(c.hi) })));
    }
    if (sim.coneConstraints.length) {
      console.log('%c● swing cones (hips/shoulders) — anatomical, tracks the body frame', headCss);
      console.table(sim.coneConstraints.map((c) => {
        const frame = c.carry ? `carried via ${bones[c.cgp].label}→${bones[c.cp].label}` : (c.aIdx != null ? `${bones[c.bIdx].label}→${bones[c.aIdx].label}` : '—');
        return c.maxFwd != null
          ? { joint: bones[c.p].label, child: bones[c.child].label, kind: c.carry ? 'arm' : 'hip', flexFwd: DEG(c.maxFwd) + '°', extendBack: DEG(c.maxBack) + '°', side: DEG(c.maxSide) + '°', frame }
          : { joint: bones[c.p].label, child: bones[c.child].label, kind: 'cone', halfAngle: DEG(c.half) + '°', frame };
      }));
    }
  }
  console.log('%clegend: live stats show bend/swing vs limit with a bar — green inside, yellow = ON LIMIT, red = VIOLATION', 'color:#64748b;font-style:italic');
  console.groupEnd && console.groupEnd();
  /* eslint-enable no-console */
  return summary;
}

/**
 * LIVE per-frame measurement: each hinge's current bend, each cone's current swing,
 * and each ROM constraint's grandparent distance — all vs their limits, with an `ok`
 * flag. Use it to PROVE the limits hold during simulation (and to spot violations).
 * @returns {{hinges:object[], cones:object[], roms:object[], violations:number}}
 */
export function ragdollDebugStats(state) {
  const { bones, sim } = state;
  const pos = sim.positions();
  const frames = ragdollBoneFrames(state);
  const simStats = sim.stats ? sim.stats() : null;
  const dt = Math.max(simStats?.dt || 0, 1e-6);
  // Usage is "how close to the limit" while error is "how far beyond the limit".
  // This keeps harmless ON LIMIT states separate from actual VIOLATION states.
  const usage = (v, lim) => lim > 1e-6 ? +Math.min(100, 100 * v / lim).toFixed(0) : 0;
  const error = (v, lim) => lim > 1e-6 && v > lim ? +(100 * (v - lim) / lim).toFixed(1) : 0;
  const limitState = (v, lim, eps) => v > lim + eps ? 'VIOLATION' : (v >= lim - eps ? 'ON LIMIT' : 'OK');
  const hinges = (sim.hingeConstraints || []).map((c) => {
    const t = unit(vec3Sub(pos[c.p], pos[c.gp]));
    const s = unit(vec3Sub(pos[c.i], pos[c.p]));
    const bend = Math.acos(Math.max(-1, Math.min(1, vec3Dot(t, s))));
    const bendDeg = DEG(bend); const limitDeg = DEG(c.hi); const stateName = limitState(bendDeg, limitDeg, 3);
    return { kind: 'hinge', joint: bones[c.p].label, valueDeg: bendDeg, bendDeg, limitDeg, usagePct: usage(bendDeg, limitDeg), errorPct: error(bendDeg, limitDeg), state: stateName, ok: stateName !== 'VIOLATION' };
  });
  const cones = (sim.coneStatus ? sim.coneStatus() : []).map((c) => {
    const swingDeg = +c.swingDeg.toFixed(1); const limitDeg = +c.limitDeg.toFixed(1); const stateName = limitState(swingDeg, limitDeg, 3);
    return { kind: 'cone', joint: bones[c.p].label, valueDeg: swingDeg, swingDeg, limitDeg, usagePct: usage(swingDeg, limitDeg), errorPct: error(swingDeg, limitDeg), state: stateName, ok: stateName !== 'VIOLATION' };
  });
  const roms = (sim.angleConstraints || []).map((c) => {
    const d = Math.hypot(pos[c.i][0] - pos[c.gp][0], pos[c.i][1] - pos[c.gp][1], pos[c.i][2] - pos[c.gp][2]);
    const loBad = d < c.dMin - 0.006; const hiBad = d > c.dMax + 0.006;
    const nearMin = Math.abs(d - c.dMin) <= 0.006; const nearMax = Math.abs(d - c.dMax) <= 0.006;
    const lim = hiBad || nearMax ? c.dMax : c.dMin;
    const usagePct = Math.max(usage(d, c.dMax), usage(c.dMin, Math.max(d, 1e-6)));
    const stateName = loBad || hiBad ? 'VIOLATION' : (nearMin ? 'ON MIN' : (nearMax ? 'ON MAX' : 'OK'));
    const errorPct = hiBad ? error(d, c.dMax) : (loBad ? error(c.dMin, Math.max(d, 1e-6)) : 0);
    return { kind: 'rom', from: bones[c.gp].label, to: bones[c.i].label, joint: `${bones[c.gp].label}→${bones[c.i].label}`, d: r2(d), min: r2(c.dMin), max: r2(c.dMax), limit: r2(lim), usagePct, errorPct, state: stateName, ok: stateName !== 'VIOLATION' };
  });
  // Per-bone pose telemetry mirrors the live solver state: position, implicit
  // Verlet velocity, derived orientation, and parent/child labels for diagnostics.
  const bonePoses = bones.map((b, i) => {
    const part = sim.particles?.[i]; const prev = part?.prev || pos[i]; const p = pos[i]; const R = frames.R[i] || IDENT3;
    const vx = (p[0] - prev[0]) / dt; const vy = (p[1] - prev[1]) / dt; const vz = (p[2] - prev[2]) / dt;
    const parent = b.parentIndex >= 0 ? bones[b.parentIndex]?.label : '—';
    const child = state.childSlot?.[i] >= 0 ? bones[state.childSlot[i]]?.label : '—';
    return { idx: i, joint: b.label, type: b.jointType, parent, child, px: r2(p[0]), py: r2(p[1]), pz: r2(p[2]), vx: r2(vx), vy: r2(vy), vz: r2(vz), speed: r2(Math.hypot(vx, vy, vz)), q: quatFromMat3(R).join(','), r00: r2(R[0]), r01: r2(R[1]), r02: r2(R[2]), r10: r2(R[3]), r11: r2(R[4]), r12: r2(R[5]), r20: r2(R[6]), r21: r2(R[7]), r22: r2(R[8]) };
  });
  const all = [...hinges, ...cones, ...roms];
  const violationsList = all.filter((x) => x.ok === false);
  const onLimitList = all.filter((x) => x.ok !== false && String(x.state).startsWith('ON'));
  const worst = (arr) => arr.reduce((m, x) => (!m || (x.errorPct || 0) > (m.errorPct || 0) || ((x.errorPct || 0) === (m.errorPct || 0) && (x.usagePct || 0) > (m.usagePct || 0))) ? x : m, null);
  return { hinges, cones, roms, bonePoses, stability: simStats, violations: violationsList.length, onLimit: onLimitList.length, violationsList, onLimitList, worst: { hinge: worst(hinges), cone: worst(cones), rom: worst(roms), any: worst(all) } };
}
