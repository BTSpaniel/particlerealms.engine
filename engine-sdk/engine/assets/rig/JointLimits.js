// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/rig/JointLimits.js — automatically derive per-joint movement
// limits (range of motion) from a model, the way Life's BodyAssembler does it:
// every joint gets a TYPE (ball / hinge / saddle / twist / root) plus a swing
// cone + twist limit (degrees → radians), and hinge joints get a bend AXIS taken
// from the bind-pose geometry (perpendicular to the parent→joint→child bend
// plane). Two paths:
//   • humanoid — role-based anatomical profile keyed by canonical bone slots.
//   • generic  — topology inference (children count + segment straightness) so
//     spiders, dogs, cats, birds, etc. get sensible limits with no template:
//     hub/limb-root joints → ball, straight mid-limb segments → hinge, leaves →
//     fixed. GPU-free + deterministic → gate-testable.

import { buildBindPose, jointPosition } from '../humanoid/SkinPose.js';
import { humanoidBonePosition } from '../humanoid/SkeletonHeal.js';
import {
  vec3Cross,
  vec3Dot,
  vec3Scale,
  vec3Sub,
} from '../../core/math/MathVec3.js';

export const JOINT_TYPE = Object.freeze({
  ROOT: 'root', BALL: 'ball', HINGE: 'hinge', SADDLE: 'saddle', TWIST: 'twist', FIXED: 'fixed',
});

const D2R = Math.PI / 180;
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Angle (radians) between two vectors. */
function angleBetween(a, b) {
  const la = len(a), lb = len(b);
  if (la < 1e-9 || lb < 1e-9) return 0;
  return Math.acos(Math.max(-1, Math.min(1, vec3Dot(a, b) / (la * lb))));
}

/**
 * Hinge bend axis = normal of the parent→joint→child plane (the axis a knee/elbow
 * actually bends about). Falls back to a perpendicular of the bone direction.
 */
export function hingeAxis(parentPos, jointPos, childPos) {
  if (parentPos && jointPos && childPos) {
    const ax = vec3Cross(vec3Sub(jointPos, parentPos), vec3Sub(childPos, jointPos));
    if (len(ax) > 1e-6) return norm(ax);
  }
  const dir = childPos && jointPos ? vec3Sub(childPos, jointPos) : (jointPos && parentPos ? vec3Sub(jointPos, parentPos) : [0, 1, 0]);
  const ref = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const a = vec3Cross(dir, ref);
  return len(a) > 1e-6 ? norm(a) : [1, 0, 0];
}

/**
 * Alias for `hingeAxis` — the joint bend-direction deriver, named for the
 * generic "derive*" family used by RagdollBuilder/CharacterPhysicsAsset.
 */
export const deriveBendDirection = hingeAxis;

/** Joint type carried by an anatomical profile (ball/hinge/saddle/twist/root). */
export function deriveJointType(prof) {
  return prof?.type ?? null;
}

/** Swing-cone half-angle (degrees) carried by a profile. */
export function deriveSwingCone(prof) {
  return prof?.swing ?? 0;
}

/**
 * Hinge bend-range (degrees). By Life's hinge convention this value is
 * carried in the profile's `twist` field (a hinge drives one axis), so this
 * is semantically distinct from `deriveTwistLimit` even though both read the
 * same underlying number for a hinge profile.
 */
export function deriveHingeLimit(prof) {
  return prof?.twist ?? 0;
}

/** Twist limit (degrees) for a non-hinge (ball/saddle/twist) profile. */
export function deriveTwistLimit(prof) {
  return prof?.twist ?? 0;
}

/**
 * Verify (and defensively enforce) left/right symmetry between two derived
 * limits — swing/twist degrees must match (anatomy is bilaterally symmetric);
 * axes are expected to differ (mirrored bind-pose geometry) and are left
 * untouched. Explicit, testable version of the symmetry `profileFor()`
 * already guarantees implicitly by stripping the left/right prefix before
 * profile lookup.
 * @param {object} leftLimit
 * @param {object} rightLimit
 * @returns {{ok:boolean, leftLimit:object, rightLimit:object}}
 */
export function mirrorLeftRightLimits(leftLimit, rightLimit) {
  if (!leftLimit || !rightLimit) return { ok: false, leftLimit, rightLimit };
  const ok = leftLimit.jointType === rightLimit.jointType
    && Math.abs(leftLimit.swingDeg - rightLimit.swingDeg) < 1e-6
    && Math.abs(leftLimit.twistDeg - rightLimit.twistDeg) < 1e-6;
  if (ok) return { ok, leftLimit, rightLimit };
  // Defensive: force the right side to match the left side's canonical values.
  const forced = {
    ...rightLimit,
    jointType: leftLimit.jointType,
    swingDeg: leftLimit.swingDeg, twistDeg: leftLimit.twistDeg,
    swingRad: leftLimit.swingRad, twistRad: leftLimit.twistRad,
  };
  return { ok, leftLimit, rightLimit: forced };
}

/**
 * Infer a coarse drive role (neck/shoulder/elbow/wrist/spineUpper/pelvis/hip/
 * knee/ankle/toe/default) from a bone/slot name via string matching. Shared
 * so RagdollBuilder, CharacterPhysicsAsset, and future adapters don't each
 * reimplement this heuristic independently.
 * @param {string} name
 * @returns {string}
 */
export function inferDriveType(name = '') {
  const id = String(name).toLowerCase();
  if (id.includes('neck') || id.includes('head')) return 'neck';
  if (id.includes('shoulder') || id.includes('upperarm')) return 'shoulder';
  if (id.includes('forearm') || id.includes('lowerarm') || id.includes('elbow')) return 'elbow';
  if (id.includes('hand') || id.includes('wrist')) return 'wrist';
  if (id.includes('spine') || id.includes('chest')) return 'spineUpper';
  if (id.includes('hips') || id.includes('pelvis')) return 'pelvis';
  if (id.includes('thigh') || id.includes('upperleg') || id.includes('hip')) return 'hip';
  if (id.includes('shin') || id.includes('lowerleg') || id.includes('knee')) return 'knee';
  if (id.includes('foot') || id.includes('ankle')) return 'ankle';
  if (id.includes('toe')) return 'toe';
  return 'default';
}

function makeLimit(type, swingDeg, twistDeg, axis, extra = {}) {
  return {
    jointType: type,
    swingDeg, twistDeg,
    swingRad: swingDeg * D2R, twistRad: twistDeg * D2R,
    compliance: extra.compliance ?? 0.0001,
    axis: axis || [1, 0, 0],          // hinge bend axis, or bone twist axis for ball
    ...extra,
  };
}

// ── Humanoid anatomical profile (role → joint type + ROM in degrees) ─────────
// Hinge bend range is carried in twistDeg (a hinge drives one axis), matching
// Life's hinge→twist-axis convention; swing is kept small for hinges.
const HUMANOID_PROFILE = {
  hips: { type: JOINT_TYPE.ROOT, swing: 0, twist: 0 },
  spine: { type: JOINT_TYPE.SADDLE, swing: 20, twist: 15 },
  chest: { type: JOINT_TYPE.SADDLE, swing: 15, twist: 12 },
  upperChest: { type: JOINT_TYPE.SADDLE, swing: 10, twist: 8 },
  neck: { type: JOINT_TYPE.BALL, swing: 35, twist: 45 },
  head: { type: JOINT_TYPE.BALL, swing: 30, twist: 50 },
  Shoulder: { type: JOINT_TYPE.SADDLE, swing: 25, twist: 10 },
  UpperArm: { type: JOINT_TYPE.BALL, swing: 90, twist: 90 },
  LowerArm: { type: JOINT_TYPE.HINGE, swing: 5, twist: 145 }, // elbow
  Hand: { type: JOINT_TYPE.SADDLE, swing: 60, twist: 25 },     // wrist
  UpperLeg: { type: JOINT_TYPE.BALL, swing: 75, twist: 40 },   // hip
  LowerLeg: { type: JOINT_TYPE.HINGE, swing: 5, twist: 150 },  // knee
  Foot: { type: JOINT_TYPE.SADDLE, swing: 45, twist: 20 },     // ankle
  Toes: { type: JOINT_TYPE.HINGE, swing: 5, twist: 40 },
};

// Canonical bone chains (for parent/child geometry → hinge axes).
const HUMANOID_CHAINS = [
  ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head'],
  ['upperChest', 'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand'],
  ['upperChest', 'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand'],
  ['hips', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes'],
  ['hips', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes'],
];

function profileFor(slot) {
  if (HUMANOID_PROFILE[slot]) return HUMANOID_PROFILE[slot];
  const bare = slot.replace(/^left|^right/, '');
  return HUMANOID_PROFILE[bare] || null;
}

/**
 * Derive joint limits for a humanoid rig.
 * @param {object} model EngineModel (with model.rigs.humanoid)
 * @param {Map} [pose] bind-pose map (built if omitted)
 * @returns {Map<string, object>} canonical slot → limit
 */
export function deriveHumanoidJointLimits(model, pose) {
  const hum = model.rigs?.humanoid;
  const out = new Map();
  if (!hum) return out;
  pose = pose || buildBindPose(model);
  const pos = (slot) => humanoidBonePosition(hum, slot, pose); // real OR healed/synthesized

  // Body lateral (left↔right) axis — the anatomical bend axis for elbows/knees.
  // In a straight T-pose the geometric bend plane is degenerate, so this lateral
  // hint (projected ⊥ to the bone) gives a stable, correct hinge axis.
  const lUL = pos('leftUpperLeg'); const rUL = pos('rightUpperLeg');
  const lUA = pos('leftUpperArm'); const rUA = pos('rightUpperArm');
  const lateral = (lUL && rUL) ? norm(vec3Sub(lUL, rUL)) : ((lUA && rUA) ? norm(vec3Sub(lUA, rUA)) : null);

  // Build a parent/child slot lookup (including healed slots) for axis geometry.
  const present = (s) => !!pos(s);
  const parentSlot = {}; const childSlot = {};
  for (const chain of HUMANOID_CHAINS) {
    const list = chain.filter(present);
    for (let i = 0; i < list.length; i++) {
      if (i > 0) parentSlot[list[i]] = list[i - 1];
      if (i < list.length - 1 && !childSlot[list[i]]) childSlot[list[i]] = list[i + 1];
    }
  }

  const slots = new Set([...Object.keys(hum.bones || {}), ...Object.keys(hum.synthesized || {})]);
  for (const slot of slots) {
    const prof = profileFor(slot);
    if (!prof) continue;
    const jp = pos(slot); const pp = pos(parentSlot[slot]); const cp = pos(childSlot[slot]);
    let axis;
    if (prof.type === JOINT_TYPE.HINGE) {
      // Anatomical hinge: the lateral axis made perpendicular to the bone. Fall
      // back to the geometric bend-plane normal when there's no lateral hint.
      const boneDir = (cp && jp) ? norm(vec3Sub(cp, jp)) : (jp && pp ? norm(vec3Sub(jp, pp)) : [0, 1, 0]);
      if (lateral) {
        const proj = vec3Sub(lateral, vec3Scale(boneDir, vec3Dot(lateral, boneDir)));
        axis = len(proj) > 1e-3 ? norm(proj) : hingeAxis(pp, jp, cp);
      } else axis = hingeAxis(pp, jp, cp);
    } else if (cp && jp) axis = norm(vec3Sub(cp, jp)); // bone (twist) axis for ball/saddle
    else axis = [0, 1, 0];
    const swingDeg = deriveSwingCone(prof);
    const twistDeg = prof.type === JOINT_TYPE.HINGE ? deriveHingeLimit(prof) : deriveTwistLimit(prof);
    out.set(slot, makeLimit(deriveJointType(prof), swingDeg, twistDeg, axis, { nodeId: hum.bones?.[slot] || null, parentSlot: parentSlot[slot] || null, synthesized: !hum.bones?.[slot] }));
  }

  // Explicit, testable symmetry pass (defensive; a no-op today since
  // profileFor() already guarantees this by construction).
  for (const slot of [...out.keys()]) {
    if (!slot.startsWith('left')) continue;
    const rightSlot = 'right' + slot.slice(4);
    if (!out.has(rightSlot)) continue;
    const { leftLimit, rightLimit } = mirrorLeftRightLimits(out.get(slot), out.get(rightSlot));
    out.set(slot, leftLimit);
    out.set(rightSlot, rightLimit);
  }
  return out;
}

// ── Generic topology inference (any creature) ────────────────────────────────
const GENERIC = {
  hinge: { swing: 5, twist: 120 },
  ball: { swing: 70, twist: 40 },
  hub: { swing: 45, twist: 30 },
};
const STRAIGHT_RAD = 50 * D2R; // bend below this ⇒ a straight mid-limb segment ⇒ hinge

/** Joint nodes: skin joints if present, else all nodes. */
function jointNodes(model) {
  const ids = new Set();
  for (const skin of model.skins || []) for (const j of (skin.joints || skin.raw?.joints || [])) ids.add(`node:${j}`);
  return ids.size ? (model.nodes || []).filter((n) => ids.has(n.id)) : (model.nodes || []);
}

/**
 * Derive joint limits for ANY skeleton by topology + geometry (spiders, dogs,
 * cats, birds…). No names required.
 * @returns {Map<string, object>} nodeId → limit
 */
export function deriveSkeletonJointLimits(model, pose) {
  pose = pose || buildBindPose(model);
  const byId = new Map((model.nodes || []).map((n) => [n.id, n]));
  const nodes = jointNodes(model);
  const inSet = new Set(nodes.map((n) => n.id));
  const out = new Map();

  const childJoints = (n) => (n.children || []).filter((c) => inSet.has(c));

  for (const n of nodes) {
    const jp = jointPosition(pose, n.id);
    const parent = n.parent && inSet.has(n.parent) ? byId.get(n.parent) : null;
    const pp = parent ? jointPosition(pose, parent.id) : null;
    const kids = childJoints(n);
    const cp = kids.length ? jointPosition(pose, kids[0]) : null;
    const parentKids = parent ? childJoints(parent).length : 0;

    let type; let prof;
    if (!parent) { type = JOINT_TYPE.ROOT; prof = { swing: 0, twist: 0 }; }
    else if (kids.length === 0) { type = JOINT_TYPE.FIXED; prof = { swing: 0, twist: 0 }; }
    else if (parentKids >= 3) { type = JOINT_TYPE.BALL; prof = GENERIC.ball; } // limb root off a hub (spider coxa / hip / shoulder)
    else if (kids.length >= 2) { type = JOINT_TYPE.BALL; prof = GENERIC.hub; } // a branch point
    else { // single child: hinge if the segment is roughly straight, else ball
      const bend = (pp && cp) ? angleBetween(vec3Sub(jp, pp), vec3Sub(cp, jp)) : 0;
      if (bend <= STRAIGHT_RAD) { type = JOINT_TYPE.HINGE; prof = GENERIC.hinge; }
      else { type = JOINT_TYPE.BALL; prof = GENERIC.ball; }
    }

    const axis = type === JOINT_TYPE.HINGE ? hingeAxis(pp, jp, cp)
      : (cp && jp ? norm(vec3Sub(cp, jp)) : [0, 1, 0]);
    out.set(n.id, makeLimit(type, prof.swing, prof.twist, axis, { nodeId: n.id, parentNode: parent?.id || null }));
  }
  return out;
}

/**
 * The set of valid joint-type strings (`root`/`ball`/`hinge`/`saddle`/`twist`/
 * `fixed`) as a `Set`, for membership checks — single source of truth so a
 * validator never hand-declares its own copy that can silently drift from
 * `JOINT_TYPE` (this is exactly how `CharacterPhysicsAsset.js` and Life's
 * `BodySpecValidator.js` used to each keep their own disconnected copy).
 * @returns {Set<string>}
 */
export function validJointTypeSet() {
  return new Set(Object.values(JOINT_TYPE));
}

/**
 * Shared bone-topology structural validation — the literally-duplicated core
 * every ragdoll/body validator needs (bone id uniqueness, parent-reference
 * resolution), extracted once so `CharacterPhysicsAsset.validateCharacterPhysicsAsset`
 * and Life's `BodySpecValidator.validateBodyTemplate` can never silently
 * drift apart on these checks again. Each caller still owns its own
 * shape-specific checks (mass/position for CharacterPhysicsAsset;
 * anatomy/ligaments/skeleton extensions for Life).
 * @param {{id:string, parentId:(string|null)}[]} bones normalized bone list
 * @returns {{errors:string[], boneIds:Set<string>}}
 */
export function validateBoneTopology(bones) {
  const errors = [];
  const boneIds = new Set();
  for (const bone of bones || []) {
    if (!bone?.id) { errors.push('bone_id_missing'); continue; }
    if (boneIds.has(bone.id)) errors.push(`bone_duplicate:${bone.id}`);
    boneIds.add(bone.id);
  }
  for (const bone of bones || []) {
    if (bone?.parentId != null && !boneIds.has(bone.parentId)) {
      errors.push(`bone_parent_missing:${bone.id}->${bone.parentId}`);
    }
  }
  return { errors, boneIds };
}

/** Count joint types in a limit map (for inspectors/gates). */
export function countTypes(limits) {
  const c = { root: 0, ball: 0, hinge: 0, saddle: 0, twist: 0, fixed: 0 };
  for (const l of limits.values()) c[l.jointType] = (c[l.jointType] || 0) + 1;
  return c;
}

/**
 * Auto-derive and attach joint limits to a model. Humanoid path when a humanoid
 * rig is present, otherwise generic topology inference.
 * @returns {{ limits:Map, species:'humanoid'|'generic', counts:object }}
 */
export function buildJointLimits(model, opts = {}) {
  const pose = buildBindPose(model);
  const humanoid = !!model.rigs?.humanoid && !opts.forceGeneric;
  const limits = humanoid ? deriveHumanoidJointLimits(model, pose) : deriveSkeletonJointLimits(model, pose);
  const counts = countTypes(limits);
  const result = { limits, species: humanoid ? 'humanoid' : 'generic', counts };
  if (humanoid) model.rigs.humanoid.jointLimits = limits;
  else { model.metadata = model.metadata || {}; model.metadata.jointLimits = { species: 'generic', counts }; model.rigs = model.rigs || {}; }
  if (model.metadata) model.metadata.jointLimitsSummary = { species: result.species, counts };
  return result;
}
