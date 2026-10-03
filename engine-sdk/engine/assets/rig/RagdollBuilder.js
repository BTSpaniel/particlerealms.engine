// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/rig/RagdollBuilder.js — turn a detected skeleton + auto-derived
// joint limits into a RAGDOLL descriptor: one capsule body per bone (sized from
// the bone length, mass from its volume) plus a constrained joint to its parent
// using the JointLimits type + swing/twist + bend axis. Pure data (no physics
// engine here) so it can drive `sim/physics/PBDRagdoll` / articulations or the
// editor's ragdoll. Works for humanoids (canonical bones, incl. healed ones) and
// for any creature via generic topology. GPU-free + deterministic.

import { buildBindPose, jointPosition } from '../humanoid/SkinPose.js';
import { humanoidBonePosition, healSkeleton } from '../humanoid/SkeletonHeal.js';
import { HUMANOID_BONES } from '../humanoid/HumanoidRig.js';
import { deriveHumanoidJointLimits, deriveSkeletonJointLimits, JOINT_TYPE, inferDriveType } from './JointLimits.js';
import { vec3Lerp, vec3Sub } from '../../core/math/MathVec3.js';

const PI = Math.PI;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const capsuleVolume = (r, L) => PI * r * r * L + (4 / 3) * PI * r * r * r;

// Approximate capsule center (midpoint between the joint/bind position and
// the first child position, or the position itself for a leaf) — used only
// to express joint pivots in each body's own local space for frameA/frameB.
function boneCenter(position, kids) {
  return kids && kids[0] ? vec3Lerp(position, kids[0], 0.5) : position;
}

// D6 motion template per joint type — matches ActiveRigController's
// defaultD6Motion / StickmanActiveRigAdapter's createD6Motion convention: a
// shared-pivot ball-and-socket by default (linear axes locked, twist+swing
// limited), collapsed to a single swing axis for hinges.
function defaultMotion(jointType) {
  const isHinge = jointType === JOINT_TYPE.HINGE;
  return { x: 'locked', y: 'locked', z: 'locked', twist: 'limited', swingY: isHinge ? 'locked' : 'limited', swingZ: isHinge ? 'locked' : 'limited' };
}

// Capsule radius as a fraction of bone length, by role (torso thick, digits thin).
const RADIUS_RATIO = {
  hips: 0.22, spine: 0.22, chest: 0.24, upperChest: 0.24, neck: 0.30, head: 0.45,
  Shoulder: 0.12, UpperArm: 0.16, LowerArm: 0.13, Hand: 0.10,
  UpperLeg: 0.17, LowerLeg: 0.13, Foot: 0.10, Toes: 0.08,
};
export function radiusRatio(slot) {
  if (RADIUS_RATIO[slot] != null) return RADIUS_RATIO[slot];
  const bare = slot.replace(/^left|^right/, '');
  return RADIUS_RATIO[bare] ?? 0.15;
}

// Preferred parent chain per canonical bone (first present wins).
const HUM_PARENT = {
  spine: ['hips'], chest: ['spine', 'hips'], upperChest: ['chest', 'spine', 'hips'],
  neck: ['upperChest', 'chest', 'spine'], head: ['neck', 'upperChest', 'chest', 'spine'],
  leftShoulder: ['upperChest', 'chest', 'spine'], leftUpperArm: ['leftShoulder', 'upperChest', 'chest', 'spine'], leftLowerArm: ['leftUpperArm'], leftHand: ['leftLowerArm'],
  rightShoulder: ['upperChest', 'chest', 'spine'], rightUpperArm: ['rightShoulder', 'upperChest', 'chest', 'spine'], rightLowerArm: ['rightUpperArm'], rightHand: ['rightLowerArm'],
  leftUpperLeg: ['hips'], leftLowerLeg: ['leftUpperLeg'], leftFoot: ['leftLowerLeg'], leftToes: ['leftFoot'],
  rightUpperLeg: ['hips'], rightLowerLeg: ['rightUpperLeg'], rightFoot: ['rightLowerLeg'], rightToes: ['rightFoot'],
};

function makeBone(id, name, parentIndex, position, kids, slot, lim, density, parentBone) {
  const tip = kids[0] || null;
  const length = tip ? Math.max(1e-3, dist(position, tip)) : null;
  const L = length || 0.1;
  const radius = Math.max(0.01, L * (slot ? radiusRatio(slot) : 0.15));
  const halfHeight = Math.max(0.005, (length || L) / 2 - radius * 0.5);
  const jointType = lim?.jointType || (parentIndex < 0 ? 'root' : 'ball');
  const center = boneCenter(position, kids);
  // Joint-pivot anchors expressed in each body's own local space (position
  // minus that body's own capsule center) — frameB is this bone's side,
  // frameA is the parent's side of the SAME world pivot point (`position`,
  // which is by construction this bone's proximal/bind point == where it
  // attaches to its parent). Rotation left identity for now; a physics-aware
  // consumer (CharacterPhysicsAssetAdapter) refines orientation from `axis`.
  const frameB = parentIndex >= 0 ? { position: vec3Sub(position, center), rotation: [0, 0, 0, 1] } : null;
  const frameA = parentBone ? { position: vec3Sub(position, boneCenter(parentBone.position, parentBone.childPositions)), rotation: [0, 0, 0, 1] } : null;
  return {
    id, name, slot: slot || null, parentIndex,
    position, childPositions: kids,
    length: length || L, radius, halfHeight,
    mass: capsuleVolume(radius, length || L) * density,
    jointType,
    swingDeg: lim?.swingDeg ?? 45, twistDeg: lim?.twistDeg ?? 30,
    axis: lim?.axis || [0, 1, 0],
    synthesized: !!lim?.synthesized,
    motion: parentIndex >= 0 ? defaultMotion(jointType) : null,
    frameA, frameB,
    collisionGroup: slot || id,
    driveType: inferDriveType(slot || name),
  };
}

function normalizeMass(bones, target) {
  let total = bones.reduce((a, b) => a + b.mass, 0);
  if (target && total > 0) { const k = target / total; for (const b of bones) b.mass *= k; total = target; }
  return total;
}

/** Build a ragdoll from a humanoid rig (canonical bones, including healed ones). */
export function buildHumanoidRagdoll(model, rig, pose, opts = {}) {
  pose = pose || buildBindPose(model);
  const density = opts.density ?? 985;
  const limits = rig.jointLimits || deriveHumanoidJointLimits(model, pose);
  const pos = (s) => humanoidBonePosition(rig, s, pose);
  const has = (s) => !!pos(s);
  const order = HUMANOID_BONES.filter(has); // top-down → parents before children
  const parentOf = (s) => { for (const p of (HUM_PARENT[s] || [])) if (has(p)) return p; return null; };
  const childrenBy = {};
  for (const s of order) { const p = parentOf(s); if (p) (childrenBy[p] = childrenBy[p] || []).push(s); }

  const index = new Map(); const bones = [];
  for (const slot of order) {
    const parent = parentOf(slot);
    const parentIndex = parent != null ? (index.get(parent) ?? -1) : -1;
    const kids = (childrenBy[slot] || []).map(pos).filter(Boolean);
    const bone = makeBone(rig.bones?.[slot] || `synth:${slot}`, slot, parentIndex, pos(slot), kids, slot, limits.get(slot), density, parentIndex >= 0 ? bones[parentIndex] : null);
    index.set(slot, bones.length); bones.push(bone);
  }
  const massKg = normalizeMass(bones, opts.massKg);
  return { bones, jointCount: bones.length, massKg, source: 'humanoid' };
}

/** Build a ragdoll from any skeleton by generic topology (spiders, dogs, …). */
export function buildGenericRagdoll(model, pose, opts = {}) {
  pose = pose || buildBindPose(model);
  const density = opts.density ?? 985;
  const limits = deriveSkeletonJointLimits(model, pose);
  const ids = new Set();
  for (const skin of model.skins || []) for (const j of (skin.joints || skin.raw?.joints || [])) ids.add(`node:${j}`);
  const byId = new Map((model.nodes || []).map((n) => [n.id, n]));
  let nodes = ids.size ? (model.nodes || []).filter((n) => ids.has(n.id)) : (model.nodes || []);
  const inSet = new Set(nodes.map((n) => n.id));
  const depth = (n) => { let d = 0; let c = n; while (c && c.parent && inSet.has(c.parent) && d < 64) { c = byId.get(c.parent); d++; } return d; };
  nodes = nodes.slice().sort((a, b) => depth(a) - depth(b)); // parents before children

  const childrenBy = {};
  for (const n of nodes) { const p = n.parent && inSet.has(n.parent) ? n.parent : null; if (p) (childrenBy[p] = childrenBy[p] || []).push(n.id); }

  const index = new Map(); const bones = [];
  for (const n of nodes) {
    const p = jointPosition(pose, n.id); if (!p) continue;
    const parentId = n.parent && inSet.has(n.parent) ? n.parent : null;
    const parentIndex = parentId != null ? (index.get(parentId) ?? -1) : -1;
    const kids = (childrenBy[n.id] || []).map((id) => jointPosition(pose, id)).filter(Boolean);
    const bone = makeBone(n.id, n.name || n.id, parentIndex, p, kids, null, limits.get(n.id), density, parentIndex >= 0 ? bones[parentIndex] : null);
    index.set(n.id, bones.length); bones.push(bone);
  }

  // Append healed (mirrored) limbs so a creature missing a leg gets it back.
  const synth = opts.synthesized || [];
  const synthKids = {};
  for (const s of synth) if (s.parentId) (synthKids[s.parentId] = synthKids[s.parentId] || []).push(s.position);
  for (const s of synth) {
    const parentIndex = s.parentId != null ? (index.get(s.parentId) ?? -1) : -1;
    const bone = makeBone(s.id, s.name || s.id, parentIndex, s.position, synthKids[s.id] || [], null, null, density, parentIndex >= 0 ? bones[parentIndex] : null);
    bone.synthesized = true;
    index.set(s.id, bones.length); bones.push(bone);
  }

  const massKg = normalizeMass(bones, opts.massKg);
  return { bones, jointCount: bones.length, massKg, source: 'generic' };
}

/**
 * Build a ragdoll for a model and attach it at model.rigs.ragdoll. Humanoid path
 * when a humanoid rig is present, otherwise generic topology.
 * @returns {{bones:object[], jointCount:number, massKg:number, source:string}}
 */
export function buildRagdoll(model, opts = {}) {
  const pose = buildBindPose(model);
  let rd;
  if (model.rigs?.humanoid) {
    rd = buildHumanoidRagdoll(model, model.rigs.humanoid, pose, opts);
  } else {
    // Generic creature: heal symmetry first (mirror any missing limb) unless the
    // caller opted out, then include the synthesized limbs as ragdoll bodies.
    const heal = opts.heal === false ? { synthesized: [] } : healSkeleton(model, pose);
    rd = buildGenericRagdoll(model, pose, { ...opts, synthesized: heal.synthesized });
  }
  model.rigs = model.rigs || {};
  model.rigs.ragdoll = rd;
  model.metadata = model.metadata || {};
  model.metadata.ragdoll = { source: rd.source, bodies: rd.bones.length, massKg: Math.round(rd.massKg) };
  return rd;
}
