// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { validJointTypeSet, validateBoneTopology } from '../../../assets/rig/JointLimits.js'

// Single source of truth (engine/assets/rig/JointLimits.js JOINT_TYPE) — no
// more hand-duplicated copy that can silently drift from CharacterPhysicsAsset's.
const VALID_JOINT_TYPES = validJointTypeSet()
const VALID_DRIVE_MODES = new Set(['force', 'acceleration'])
const REQUIRED_ORGANS = ['heart', 'leftLung', 'rightLung', 'liver', 'kidneys']

export function validateBodyTemplate(template) {
  const warnings = []
  const bones = Array.isArray(template?.bones) ? template.bones : []
  const collisionGroups = new Set()
  const topology = validateBoneTopology(bones.map(bone => ({ id: bone?.id, parentId: bone?.parent ?? null })))
  const errors = [...topology.errors]
  const boneIds = topology.boneIds
  if (!template || typeof template !== 'object') errors.push('template_missing')
  if (template?.schema !== 'life.body.v1') warnings.push(`schema_unexpected:${template?.schema || 'missing'}`)
  if (bones.length === 0) errors.push('bones_missing')
  for (const bone of bones) {
    if (!bone?.id) continue
    if (!VALID_JOINT_TYPES.has(bone.joint)) errors.push(`joint_type_invalid:${bone.id}:${bone.joint}`)
    if (bone.limits) validateLimitBlock(bone.limits, `bone_limits:${bone.id}`, errors)
  }
  validateJointDefaults(template?.joints, errors, warnings)
  validateDriveDefaults(template?.drives, errors, warnings)
  validateCollisionRules(template?.collisionRules, boneIds, errors)
  collectCollisionGroups(template, collisionGroups)
  validateAnatomy(template?.anatomy, boneIds, collisionGroups, errors, warnings)
  validateSkeletonExtensions(template?.skeletonExtensions, boneIds, errors, warnings)
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    counts: {
      bones: boneIds.size,
      collisionGroups: collisionGroups.size,
      organs: Object.keys(template?.anatomy?.organs || {}).length,
      collisionShells: Object.keys(template?.anatomy?.collisionShells || {}).length,
      legDescriptors: Array.isArray(template?.skeletonExtensions?.legDescriptors) ? template.skeletonExtensions.legDescriptors.length : 0,
      sensorAnchors: Array.isArray(template?.skeletonExtensions?.sensorAnchors) ? template.skeletonExtensions.sensorAnchors.length : 0,
    },
  }
}

function validateJointDefaults(joints, errors, warnings) {
  if (!joints || typeof joints !== 'object') {
    errors.push('joints_missing')
    return
  }
  for (const jointType of VALID_JOINT_TYPES) {
    if (jointType === 'root') continue
    const joint = joints[jointType]
    if (!joint) {
      errors.push(`joint_default_missing:${jointType}`)
      continue
    }
    validateLimitBlock(joint, `joint:${jointType}`, errors)
    if (!Array.isArray(joint.axes) || joint.axes.length === 0) warnings.push(`joint_axes_missing:${jointType}`)
  }
}

function validateDriveDefaults(drives, errors, warnings) {
  if (!drives || typeof drives !== 'object') {
    errors.push('drives_missing')
    return
  }
  for (const jointType of VALID_JOINT_TYPES) {
    if (jointType === 'root') continue
    const drive = drives[jointType]
    if (!drive) {
      errors.push(`drive_missing:${jointType}`)
      continue
    }
    if (!VALID_DRIVE_MODES.has(drive.driveMode || 'force')) errors.push(`drive_mode_invalid:${jointType}:${drive.driveMode}`)
    for (const field of ['stiffness', 'damping', 'maxForce']) {
      if (!Number.isFinite(drive[field]) || drive[field] < 0) errors.push(`drive_${field}_invalid:${jointType}`)
    }
    if (drive.maxForce === 0) warnings.push(`drive_max_force_zero:${jointType}`)
  }
}

function validateCollisionRules(rules, boneIds, errors) {
  for (const pair of rules?.ignorePairs || []) validateBonePair(pair, boneIds, 'ignore_pair', errors)
  for (const pair of rules?.ignoreGroupsActive?.pairs || []) {
    if (!Array.isArray(pair) || pair.length !== 2 || !pair[0] || !pair[1]) errors.push('ignore_group_pair_invalid')
  }
}

function validateAnatomy(anatomy, boneIds, collisionGroups, errors, warnings) {
  if (!anatomy || typeof anatomy !== 'object') {
    errors.push('anatomy_missing')
    return
  }
  const thorax = anatomy.thorax || {}
  validateAttachmentList(thorax.ribCage?.attachmentBones, boneIds, 'thorax.ribCage', errors)
  validateAttachmentList(thorax.sternum?.attachmentBones, boneIds, 'thorax.sternum', errors)
  validateAttachmentList(thorax.diaphragm?.attachmentBones, boneIds, 'thorax.diaphragm', errors)
  const shells = anatomy.collisionShells || {}
  for (const [id, shell] of Object.entries(shells)) {
    if (!boneIds.has(shell.centerBone)) errors.push(`collision_shell_center_missing:${id}:${shell.centerBone}`)
    if (!Array.isArray(shell.radius) || shell.radius.length !== 3 || shell.radius.some(value => !Number.isFinite(value) || value <= 0)) errors.push(`collision_shell_radius_invalid:${id}`)
    if (shell.group) collisionGroups.add(shell.group)
  }
  const organs = anatomy.organs || {}
  for (const organId of REQUIRED_ORGANS) if (!organs[organId]) errors.push(`organ_required_missing:${organId}`)
  for (const [id, organ] of Object.entries(organs)) {
    if (!organ.container) errors.push(`organ_container_missing:${id}`)
    else if (!shells[organ.container] && !['upperAbdomen', 'retroperitoneal'].includes(organ.container)) warnings.push(`organ_container_unbacked:${id}:${organ.container}`)
    if (organ.collisionGroup) collisionGroups.add(organ.collisionGroup)
    validateAttachmentList(organ.attachmentBones, boneIds, `organ:${id}`, errors, true)
  }
}

function validateSkeletonExtensions(extensions, boneIds, errors, warnings) {
  if (!extensions) return
  for (const segment of extensions.spineSegments || []) {
    if (!boneIds.has(segment.parent)) errors.push(`spine_segment_parent_missing:${segment.id}:${segment.parent}`)
    if (!boneIds.has(segment.driverBone)) errors.push(`spine_segment_driver_missing:${segment.id}:${segment.driverBone}`)
  }
  for (const bone of extensions.structuralBones || []) {
    if (!bone.id) errors.push('structural_bone_id_missing')
    if (!boneIds.has(bone.parent)) errors.push(`structural_bone_parent_missing:${bone.id}:${bone.parent}`)
    if (!boneIds.has(bone.driverBone)) errors.push(`structural_bone_driver_missing:${bone.id}:${bone.driverBone}`)
    if (!VALID_JOINT_TYPES.has(bone.joint)) errors.push(`structural_bone_joint_invalid:${bone.id}:${bone.joint}`)
    if (!bone.collisionGroup) warnings.push(`structural_bone_collision_group_missing:${bone.id}`)
  }
  for (const leg of extensions.legDescriptors || []) {
    if (!leg.id) errors.push('leg_descriptor_id_missing')
    if (!leg.name) warnings.push(`leg_descriptor_name_missing:${leg.id || 'unknown'}`)
    if (leg.side != null && !['left', 'right', 'center', 'radial'].includes(leg.side)) errors.push(`leg_descriptor_side_invalid:${leg.id}:${leg.side}`)
    if (!Number.isFinite(leg.order)) errors.push(`leg_descriptor_order_invalid:${leg.id}`)
    for (const field of ['rootBone', 'midBone', 'footBone']) {
      if (!leg[field]) errors.push(`leg_descriptor_${field}_missing:${leg.id || 'unknown'}`)
      else if (!boneIds.has(leg[field])) warnings.push(`leg_descriptor_${field}_metadata_only:${leg.id}:${leg[field]}`)
    }
    if (leg.supportPoint != null && (!Array.isArray(leg.supportPoint) || leg.supportPoint.length !== 3 || leg.supportPoint.some(value => !Number.isFinite(value)))) errors.push(`leg_descriptor_support_point_invalid:${leg.id}`)
  }
  for (const anchor of extensions.sensorAnchors || []) {
    if (!anchor.id) errors.push('sensor_anchor_id_missing')
    if (!anchor.role) errors.push(`sensor_anchor_role_missing:${anchor.id || 'unknown'}`)
    if (!boneIds.has(anchor.driverBone)) errors.push(`sensor_anchor_driver_missing:${anchor.id}:${anchor.driverBone}`)
    if (anchor.parent && !boneIds.has(anchor.parent)) errors.push(`sensor_anchor_parent_missing:${anchor.id}:${anchor.parent}`)
    if (anchor.referenceBone && !boneIds.has(anchor.referenceBone)) errors.push(`sensor_anchor_reference_missing:${anchor.id}:${anchor.referenceBone}`)
    if (anchor.side != null && anchor.side !== 'left' && anchor.side !== 'right') errors.push(`sensor_anchor_side_invalid:${anchor.id}:${anchor.side}`)
    if (!Array.isArray(anchor.localOffset) || anchor.localOffset.length !== 3 || anchor.localOffset.some(value => !Number.isFinite(value))) errors.push(`sensor_anchor_offset_invalid:${anchor.id}`)
  }
}

function validateLimitBlock(limits, label, errors) {
  for (const field of ['swingDeg', 'twistDeg']) {
    if (!Number.isFinite(limits[field]) || limits[field] < 0 || limits[field] > 180) errors.push(`${label}_${field}_invalid`)
  }
  if (limits.compliance != null && (!Number.isFinite(limits.compliance) || limits.compliance < 0)) errors.push(`${label}_compliance_invalid`)
}

function validateBonePair(pair, boneIds, label, errors) {
  if (!Array.isArray(pair) || pair.length !== 2) {
    errors.push(`${label}_invalid`)
    return
  }
  for (const id of pair) if (!boneIds.has(id)) errors.push(`${label}_bone_missing:${id}`)
}

function validateAttachmentList(list, boneIds, label, errors, optional = false) {
  if (list == null && optional) return
  if (!Array.isArray(list)) {
    errors.push(`attachment_list_invalid:${label}`)
    return
  }
  for (const boneId of list) if (!boneIds.has(boneId)) errors.push(`attachment_bone_missing:${label}:${boneId}`)
}

function collectCollisionGroups(template, groups) {
  for (const bone of template?.bones || []) if (bone.collisionGroup) groups.add(bone.collisionGroup)
  for (const pair of template?.collisionRules?.ignoreGroupsActive?.pairs || []) for (const group of pair) groups.add(group)
}
