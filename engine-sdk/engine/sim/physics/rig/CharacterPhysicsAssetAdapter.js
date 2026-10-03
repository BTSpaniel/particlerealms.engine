// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/sim/physics/rig/CharacterPhysicsAssetAdapter.js — converts a
// CharacterPhysicsAsset (engine/assets/rig/CharacterPhysicsAsset.js) into the
// { parts, joints, bodies } rig shape ActiveRigController expects.
//
// This is the Phase 1 fix for the ragdoll stack's root-cause bug:
// StickmanActiveRigAdapter.js only ever read the hand-authored StickmanRagdoll
// ECS shape, completely disconnected from RagdollBuilder/JointLimits' output —
// meaning PhysX built joints from different axis/limit data than RagdollSim
// did, so systems disagreed about which way an elbow/knee should bend. This
// adapter reads the SAME asset.jointDefs (axis/swingDeg/twistDeg/motion/
// frameA/frameB) that RagdollSim consumes, so PhysX and the Verlet fallback
// now agree by construction.

import { ACTIVE_RIG_BACKENDS, createActiveRigConfig, createDriveProfile, createPoseBufferFromRig } from './ActiveRigSchema.js';
import { RetargetGraph } from './RetargetGraph.js';

/**
 * Build an ActiveRigController-compatible rig descriptor from a
 * CharacterPhysicsAsset.
 * @param {object} asset A CharacterPhysicsAsset (see engine/assets/rig/CharacterPhysicsAsset.js)
 * @param {object} [options]
 * @returns {object} rig — { id, name, backend, root, parts, joints, bodies, bonePairs, pose, retarget, driveProfile }
 */
export function createActiveRigFromCharacterPhysicsAsset(asset, options = {}) {
  const bodyDefs = Array.isArray(asset?.bodyDefs) ? asset.bodyDefs : [];
  const jointDefs = Array.isArray(asset?.jointDefs) ? asset.jointDefs : [];
  const jointByChildIndex = new Map(jointDefs.map((j) => [j.childIndex, j]));

  const parts = bodyDefs.map((bone) => createPartFromBodyDef(bone, jointByChildIndex.get(bone.index), options, bodyDefs));
  const rigJoints = jointDefs.map((joint, index) => createJointFromJointDef(joint, index, bodyDefs, options));
  const backend = options.backend || ACTIVE_RIG_BACKENDS.articulation;
  const root = bodyDefs.find((b) => b.parentIndex < 0) || bodyDefs[0] || null;

  const rig = {
    id: options.id || `character_active_rig_${asset?.skeletonFingerprint || 'unknown'}`,
    name: options.name || 'Character Active Rig',
    backend,
    root: {
      id: root?.slot || root?.id || 'root',
      position: addVec3(root?.position || [0, 0, 0], options.rootPosition || [0, 0, 0]),
      rotation: [0, 0, 0, 1],
    },
    parts,
    joints: rigJoints,
    bodies: parts,
    bonePairs: jointDefs.map((j) => [j.parentIndex, j.childIndex]),
    pose: createPoseBufferFromRig({ parts }),
    retarget: createRetargetGraphFromBodyDefs(bodyDefs),
  };
  rig.driveProfile = createDriveProfile({
    joints: parts,
    massKg: options.massKg ?? asset?.massProfile?.totalMassKg ?? 80,
    preset: options.preset || 'HumanAverage',
    frequencyHz: options.frequencyHz ?? 4.5,
    dampingRatio: options.dampingRatio ?? 1,
    driveMode: options.driveMode || 'acceleration',
  });
  return rig;
}

/**
 * Build the full option bag `new ActiveRigController(options)` expects,
 * from a CharacterPhysicsAsset — the CharacterPhysicsAsset equivalent of
 * `createActiveRigControllerOptionsFromStickman`.
 * @param {object} asset A CharacterPhysicsAsset
 * @param {object} [options]
 * @returns {object} { rig, retargetGraph, initialPoseState, config }
 */
export function createActiveRigControllerOptionsFromCharacterPhysicsAsset(asset, options = {}) {
  const rig = createActiveRigFromCharacterPhysicsAsset(asset, options);
  return {
    rig,
    retargetGraph: rig.retarget,
    initialPoseState: options.initialPoseState || 'idle_stand',
    config: createActiveRigConfig({
      backend: rig.backend,
      preset: options.preset || 'HumanAverage',
      massKg: options.massKg ?? asset?.massProfile?.totalMassKg ?? 80,
      frequencyHz: options.frequencyHz ?? 4.5,
      dampingRatio: options.dampingRatio ?? 1,
      driveMode: options.driveMode || 'acceleration',
      poseState: options.initialPoseState || 'idle_stand',
      solver: {
        selfCollision: options.selfCollision ?? true,
        disableParentChildCollisions: options.disableParentChildCollisions ?? true,
      },
    }),
  };
}

/** Trivial identity retarget graph (physics joint id === render bone id/slot). */
export function createRetargetGraphFromBodyDefs(bodyDefs = []) {
  const graph = new RetargetGraph();
  for (const bone of bodyDefs) {
    const name = bone.slot || bone.id;
    if (!name) continue;
    graph.addAnimationToPhysics({ source: name, target: name });
    graph.addPhysicsToRender({ source: name, target: name });
  }
  return graph;
}

function createPartFromBodyDef(bone, joint, options, bodyDefs = null) {
  const name = bone.slot || bone.id;
  // Capsule LOCAL POSE: PxCapsuleGeometry's long axis is local X. Orient the
  // capsule along the bone segment (toward the first child, or away from the
  // parent for leaf bones) and center it at the segment midpoint — an unposed
  // capsule sticks out sideways from the joint, interpenetrating neighbors at
  // spawn and spinning the articulation with depenetration impulses.
  let localPose = null;
  if (Array.isArray(bodyDefs)) {
    const child = bodyDefs.find((b) => b.parentIndex === bone.index);
    const parent = bone.parentIndex >= 0 ? bodyDefs[bone.parentIndex] : null;
    let dir = null;
    if (child) dir = subVec3(child.position, bone.position);
    else if (parent) dir = subVec3(bone.position, parent.position); // leaf: extend outward
    const l = dir ? Math.hypot(dir[0], dir[1], dir[2]) : 0;
    if (l > 1e-6) {
      const half = Math.min(bone.halfHeight ?? l * 0.5, l * 0.5);
      const t = half / l;
      localPose = {
        position: [dir[0] * t, dir[1] * t, dir[2] * t],
        rotation: quatFromXAxisToVec(dir),
      };
    }
  }
  const capsule = { type: 'capsule', radius: bone.radius, halfHeight: bone.halfHeight, ...(localPose ? { localPose } : {}) };
  return {
    id: name,
    name,
    index: bone.index,
    parentId: bone.parentIndex,
    position: addVec3(bone.position, options.rootPosition || [0, 0, 0]),
    rotation: [0, 0, 0, 1],
    radius: bone.radius,
    length: bone.length,
    shape: capsule,
    geometry: capsule,
    density: options.density ?? 1,
    driveType: bone.driveType,
    joint: joint ? createJointOptions(joint) : null,
  };
}

/** Shortest-arc quaternion rotating +X onto v ([x,y,z,w]; identity if degenerate). */
function quatFromXAxisToVec(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  if (l < 1e-6) return [0, 0, 0, 1];
  const x = v[0] / l, y = v[1] / l, z = v[2] / l;
  if (x > 0.99999) return [0, 0, 0, 1];
  if (x < -0.99999) return [0, 0, 1, 0];
  const qx = 0, qy = -z, qz = y, qw = 1 + x;
  const n = Math.hypot(qx, qy, qz, qw);
  return [qx / n, qy / n, qz / n, qw / n];
}

function subVec3(a, b) {
  return [(a?.[0] || 0) - (b?.[0] || 0), (a?.[1] || 0) - (b?.[1] || 0), (a?.[2] || 0) - (b?.[2] || 0)];
}

function createJointFromJointDef(joint, index, bodyDefs, options) {
  return {
    id: `${joint.parentId}_${joint.childId}`,
    name: `${joint.parentId}_${joint.childId}`,
    parent: joint.parentId,
    child: joint.childId,
    type: joint.jointType === 'hinge' ? 'revolute' : 'spherical',
    jointType: joint.jointType,
    index,
    driveType: bodyDefs[joint.childIndex]?.driveType,
    // Same frameA/frameB RagdollBuilder computed — position-only local
    // anchors at the shared joint pivot (see RagdollBuilder.js comments).
    frameA: joint.frameA || { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    frameB: joint.frameB || { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    motion: joint.motion,
    // Same axis/swingDeg/twistDeg RagdollSim consumes (via CharacterPhysicsAsset
    // ← RagdollBuilder ← JointLimits) — this is the actual root-cause fix.
    axis: joint.axis,
    twistLimit: { lower: -joint.twistDeg, upper: joint.twistDeg },
    swingLimit: { yAngle: joint.swingDeg, zAngle: joint.swingDeg },
    enableCollision: options.enableJointCollision ?? false,
  };
}

function createJointOptions(joint) {
  return {
    type: joint.jointType === 'hinge' ? 'revolute' : 'spherical',
    parentAnchor: joint.frameA?.position || [0, 0, 0],
    childAnchor: joint.frameB?.position || [0, 0, 0],
    limits: { swingDeg: joint.swingDeg, twistDeg: joint.twistDeg, axis: joint.axis },
  };
}

function addVec3(a, b) {
  return [(a?.[0] || 0) + (b?.[0] || 0), (a?.[1] || 0) + (b?.[1] || 0), (a?.[2] || 0) + (b?.[2] || 0)];
}
