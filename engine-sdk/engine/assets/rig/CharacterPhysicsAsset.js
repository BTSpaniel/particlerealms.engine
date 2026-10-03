// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/rig/CharacterPhysicsAsset.js — the single generated packaging
// layer for a character's physics structure. This is NOT a new generator: it
// wraps `buildRagdoll()` (RagdollBuilder.js) + `buildJointLimits()`
// (JointLimits.js) and repackages their output into one serializable schema
// that every consumer (ActiveRigController/PhysX, RagdollSim, RagdollSkinning,
// Life's BodyAssembler, RealmForge's compilers, legacy PBDRagdoll wrapper) can
// read instead of inventing its own bone/joint shape. GPU-free + deterministic.
//
// Schema fields: skeletonFingerprint, boneMap, bodyDefs, jointDefs,
// jointLimits, massProfile, collisionFilters, driveProfiles, skinningOffsets,
// particleCageDef (reserved for the future flesh-cage system), validationReport.

import { buildRagdoll } from './RagdollBuilder.js';
import { buildJointLimits, JOINT_TYPE, inferDriveType } from './JointLimits.js';
import {
  checksumHex32,
  fnv1aStringCodeUnit32,
} from '../../core/math/ChecksumMath.js';

export const CHARACTER_PHYSICS_ASSET_SCHEMA_VERSION = 1;

const VALID_JOINT_TYPES = new Set(Object.values(JOINT_TYPE));

// Re-exported from JointLimits.js — single source of truth (also used by
// RagdollBuilder.js so every bone's `driveType` field already agrees).
export { inferDriveType };

/**
 * Stable fingerprint for a bone topology — same skeleton shape (names +
 * parent links, order-independent per bone but position-stable) hashes the
 * same way twice. Used to detect when a cached CharacterPhysicsAsset can be
 * reused vs. must be rebuilt.
 * @param {object[]} bodyDefs
 * @returns {string}
 */
export function computeSkeletonFingerprint(bodyDefs) {
  const sig = bodyDefs.map((b) => `${b.id}|${b.parentIndex}|${b.slot || ''}`).join('\n');
  return checksumHex32(fnv1aStringCodeUnit32(sig));
}

/**
 * Build a `CharacterPhysicsAsset` for a model. Humanoid path when a humanoid
 * rig is present, otherwise generic topology — identical branch selection to
 * `buildRagdoll()`, which this function delegates to.
 * @param {object} model EngineModel
 * @param {object} [opts] Passed through to `buildRagdoll`/`buildJointLimits` (density, massKg, heal, forceGeneric, …)
 * @returns {object} CharacterPhysicsAsset
 */
export function createCharacterPhysicsAsset(model, opts = {}) {
  // Derive limits first so a humanoid rig caches them on `model.rigs.humanoid.jointLimits`
  // — buildHumanoidRagdoll() below picks that cache up instead of re-deriving.
  const limitsResult = buildJointLimits(model, opts);
  const rd = buildRagdoll(model, opts);

  const boneMap = {};
  const bodyDefs = rd.bones.map((bone, index) => {
    if (bone.slot) boneMap[bone.slot] = index;
    boneMap[bone.id] = index;
    return {
      index,
      id: bone.id,
      name: bone.name,
      slot: bone.slot || null,
      parentIndex: bone.parentIndex,
      position: bone.position,
      length: bone.length,
      radius: bone.radius,
      halfHeight: bone.halfHeight,
      mass: bone.mass,
      synthesized: !!bone.synthesized,
      collisionGroup: bone.collisionGroup,
      driveType: bone.driveType,
    };
  });

  const jointDefs = [];
  for (const bone of rd.bones) {
    if (bone.parentIndex < 0) continue;
    jointDefs.push({
      parentIndex: bone.parentIndex,
      childIndex: boneMap[bone.id],
      parentId: rd.bones[bone.parentIndex].slot || rd.bones[bone.parentIndex].id,
      childId: bone.slot || bone.id,
      jointType: bone.jointType,
      swingDeg: bone.swingDeg,
      twistDeg: bone.twistDeg,
      axis: bone.axis,
      motion: bone.motion,
      frameA: bone.frameA,
      frameB: bone.frameB,
    });
  }

  // Re-key the raw JointLimits map (richer per-slot data: swingRad/twistRad/
  // compliance/parentSlot/synthesized) as a plain object for serializability.
  const jointLimits = {};
  for (const [key, limit] of limitsResult.limits.entries()) {
    jointLimits[key] = { ...limit };
  }

  const massProfile = { totalMassKg: rd.massKg, perBone: {} };
  for (const bone of bodyDefs) massProfile.perBone[bone.id] = bone.mass;

  // Default collision policy: ignore collision between directly connected
  // parent/child bones (standard ragdoll practice — capsules overlap at joints).
  const collisionFilters = jointDefs.map((j) => [j.parentId, j.childId]);

  const driveProfiles = {};
  for (const bone of bodyDefs) driveProfiles[bone.id] = { driveType: bone.driveType };

  const skinningOffsets = {};
  for (const bone of bodyDefs) skinningOffsets[bone.id] = { bindPosition: bone.position };

  const asset = {
    schemaVersion: CHARACTER_PHYSICS_ASSET_SCHEMA_VERSION,
    source: rd.source,
    skeletonFingerprint: computeSkeletonFingerprint(bodyDefs),
    boneMap,
    bodyDefs,
    jointDefs,
    jointLimits,
    massProfile,
    collisionFilters,
    driveProfiles,
    skinningOffsets,
    particleCageDef: null, // reserved — flesh-cage system is a future phase
    validationReport: null,
  };
  asset.validationReport = validateCharacterPhysicsAsset(asset);
  return asset;
}

/**
 * Validate a CharacterPhysicsAsset's internal consistency (indices resolve,
 * joint types known, mass/limit values finite). Follows the same
 * `{ ok, errors, warnings, counts }` pattern as Life's `BodySpecValidator.js`,
 * adapted to this schema's shape.
 * @param {object} asset
 * @returns {{ok:boolean, errors:string[], warnings:string[], counts:object}}
 */
export function validateCharacterPhysicsAsset(asset) {
  const errors = [];
  const warnings = [];
  if (!asset || typeof asset !== 'object') {
    errors.push('asset_missing');
    return { ok: false, errors, warnings, counts: {} };
  }

  const bodyDefs = Array.isArray(asset.bodyDefs) ? asset.bodyDefs : [];
  if (bodyDefs.length === 0) errors.push('bodyDefs_missing');

  const ids = new Set();
  for (const bone of bodyDefs) {
    if (!bone.id) { errors.push('bone_id_missing'); continue; }
    if (ids.has(bone.id)) errors.push(`bone_duplicate:${bone.id}`);
    ids.add(bone.id);
    if (bone.slot) ids.add(bone.slot); // jointDefs/collisionFilters key by slot-or-id
    if (bone.parentIndex >= 0 && (bone.parentIndex < 0 || bone.parentIndex >= bodyDefs.length)) {
      errors.push(`bone_parent_index_out_of_range:${bone.id}`);
    }
    if (!Number.isFinite(bone.mass) || bone.mass <= 0) errors.push(`bone_mass_invalid:${bone.id}`);
    if (!Array.isArray(bone.position) || bone.position.length !== 3) errors.push(`bone_position_invalid:${bone.id}`);
  }

  const jointDefs = Array.isArray(asset.jointDefs) ? asset.jointDefs : [];
  for (const joint of jointDefs) {
    if (!VALID_JOINT_TYPES.has(joint.jointType)) errors.push(`joint_type_invalid:${joint.childId}:${joint.jointType}`);
    if (!Number.isFinite(joint.swingDeg) || joint.swingDeg < 0 || joint.swingDeg > 180) errors.push(`joint_swing_invalid:${joint.childId}`);
    if (!Number.isFinite(joint.twistDeg) || joint.twistDeg < 0 || joint.twistDeg > 180) errors.push(`joint_twist_invalid:${joint.childId}`);
    if (!Array.isArray(joint.axis) || joint.axis.length !== 3) errors.push(`joint_axis_invalid:${joint.childId}`);
    if (joint.parentId && !ids.has(joint.parentId)) errors.push(`joint_parent_missing:${joint.parentId}`);
    if (joint.childId && !ids.has(joint.childId)) errors.push(`joint_child_missing:${joint.childId}`);
  }

  const massProfile = asset.massProfile || {};
  if (!Number.isFinite(massProfile.totalMassKg) || massProfile.totalMassKg <= 0) errors.push('mass_profile_total_invalid');
  for (const [id, mass] of Object.entries(massProfile.perBone || {})) {
    if (!Number.isFinite(mass) || mass <= 0) errors.push(`mass_profile_bone_invalid:${id}`);
  }

  for (const [id] of Object.entries(asset.driveProfiles || {})) {
    if (!ids.has(id)) warnings.push(`drive_profile_orphaned:${id}`);
  }

  let synthesizedCount = 0;
  for (const bone of bodyDefs) if (bone.synthesized) synthesizedCount++;

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    counts: {
      bones: bodyDefs.length,
      joints: jointDefs.length,
      synthesized: synthesizedCount,
    },
  };
}
