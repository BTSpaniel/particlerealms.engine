// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * BodyAssembler — Data-driven ragdoll spec from body template + part catalog.
 *
 * Reads:
 *   - data/bodies/humanoid_default.json (bone hierarchy + collision rules)
 *   - data/parts/construction_volumes/*.json (per-part collision metadata)
 *
 * Produces a `RagdollSpec` consumable by ActiveBodySystem:
 *   {
 *     bones: [{ id, parent, partId, side, joint, collision, mass }, ...]
 *     ignorePairs: Set<"a|b"> // bone-pair keys for self-collision exclusion
 *     ignoreGroupsActive: Set<"groupA|groupB">
 *     joints: { ball: {...}, hinge: {...}, ... }
 *     drives: { ball: {...}, hinge: {...}, ... }
 *     anatomy: { thorax, organs, collisionShells }
 *     skeletonExtensions: { mode, spineSegments, structuralBones }
 *   }
 *
 * This is the single source of truth for ragdoll structure. Edit the JSON
 * files to change the body without touching code.
 */

let _bodyTemplateCache = null

/**
 * Load the humanoid body template (cached after first call).
 */
export async function loadBodyTemplate(url = '/data/bodies/humanoid_default.json') {
  if (_bodyTemplateCache) return _bodyTemplateCache
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to load body template: ${response.status}`)
  _bodyTemplateCache = await response.json()
  return _bodyTemplateCache
}

/**
 * Build a ragdoll spec from a body template + part catalog.
 * @param {object} template - From loadBodyTemplate()
 * @param {object} partCatalog - From loadPartCatalog() — has .parts Map
 * @param {object} options - { preset: 'HumanAverage' | 'HumanWeak' | ... }
 * @returns {object} RagdollSpec
 */
export function assembleBody(template, partCatalog, options = {}) {
  const presetName = options.preset || 'HumanAverage'
  const preset = template.presets?.[presetName] || { strengthMul: 1, massMul: 1 }
  const anatomy = normalizeAnatomy(template.anatomy)
  const partUseCounts = countPartUses(template.bones)

  // Resolve each bone — look up its part, extract collision data
  const bones = template.bones.map(boneDef => {
    const part = boneDef.part ? partCatalog.parts.get(boneDef.part) : null
    const collision = part?.collision || synthesizeCollision(boneDef, part)
    const useCount = boneDef.part ? (partUseCounts.get(boneDef.part) || 1) : 1
    const mass = ((collision?.mass || 1.0) / useCount) * preset.massMul

    return {
      id: boneDef.id,
      parent: boneDef.parent,
      partId: boneDef.part,
      side: boneDef.side,
      joint: boneDef.joint,
      jointType: boneDef.joint,
      socket: boneDef.socket,
      fraction: boneDef.fraction,
      collision: collision ? { ...collision } : null,
      mass,
      // Resolved drive params (from joint type + preset)
      drive: resolveDriveParams(boneDef.joint, template.drives, preset),
      driveAxes: resolveDriveAxes(boneDef.joint, template.drives, preset),
      jointLimits: resolveJointLimits(boneDef.joint, template.joints, boneDef.limits),
    }
  })

  // Build ignore-pair set for self-collision filter
  const ignorePairs = new Set()
  const rules = template.collisionRules?.ignorePairs || []
  for (const [a, b] of rules) {
    ignorePairs.add(pairKey(a, b))
  }

  // Build group-pair ignore set for active mode
  const ignoreGroupsActive = new Set()
  const groupRules = template.collisionRules?.ignoreGroupsActive?.pairs || []
  for (const [a, b] of groupRules) {
    ignoreGroupsActive.add(pairKey(a, b))
  }

  // Build bone id → group lookup
  const groupByBone = new Map()
  for (const bone of bones) {
    const group = bone.collision?.group || 'unknown'
    groupByBone.set(bone.id, group)
  }

  return {
    templateId: template.id,
    bones,
    ignorePairs,
    ignoreGroupsActive,
    groupByBone,
    driveByBone: new Map(bones.map(bone => [bone.id, bone.drive])),
    driveAxesByBone: new Map(bones.map(bone => [bone.id, bone.driveAxes])),
    jointLimitsByBone: new Map(bones.map(bone => [bone.id, bone.jointLimits])),
    joints: template.joints || {},
    drives: template.drives || {},
    ligaments: template.ligaments || {},
    muscleModel: { ...(template.muscleModel || {}) },
    anatomy,
    attachments: buildAttachmentIndex(anatomy),
    collisionShells: anatomy.collisionShells || {},
    measurements: buildMeasurementHints(partCatalog),
    skeletonExtensions: normalizeSkeletonExtensions(template.skeletonExtensions),
    sensorAnchors: normalizeSensorAnchors(template.skeletonExtensions?.sensorAnchors),
    boneAliases: { ...(template.boneAliases || {}) },
    preset: { name: presetName, ...preset },
  }
}

/**
 * Test if two bones should collide given a ragdoll spec.
 * @param {object} spec - From assembleBody()
 * @param {string} boneA - bone id
 * @param {string} boneB - bone id
 * @param {boolean} isActive - true if body is in active mode (vs ragdolled)
 * @returns {boolean}
 */
export function shouldBonesCollide(spec, boneA, boneB, isActive) {
  // Adjacent bones never collide (handled by parent-child)
  const a = spec.bones.find(b => b.id === boneA)
  const b = spec.bones.find(b => b.id === boneB)
  if (!a || !b) return false
  if (a.parent === boneB || b.parent === boneA) return false

  // Explicit ignore pairs
  if (spec.ignorePairs.has(pairKey(boneA, boneB))) return false

  // In active mode: also check group-level exclusions
  if (isActive) {
    const groupA = spec.groupByBone.get(boneA)
    const groupB = spec.groupByBone.get(boneB)
    if (groupA && groupB && spec.ignoreGroupsActive.has(pairKey(groupA, groupB))) return false
  }

  return true
}

/**
 * Get bone IDs that are foot contacts (for ground sensing / balance).
 */
export function getFootBones(spec) {
  return spec.bones.filter(b => b.collision?.isFootContact).map(b => b.id)
}

/**
 * Get a bone by id.
 */
export function getBone(spec, id) {
  return spec.bones.find(b => b.id === id) || null
}

// ─── INTERNALS ──────────────────────────────────────────────────────────────

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

function countPartUses(bones) {
  const counts = new Map()
  for (const bone of bones || []) {
    if (!bone.part) continue
    counts.set(bone.part, (counts.get(bone.part) || 0) + 1)
  }
  return counts
}

function synthesizeCollision(boneDef, part) {
  // Fallback when a bone has no part or part has no collision data.
  // Shoulders are often virtual bones (no part) — use a sphere.
  if (boneDef.id.includes('Shoulder')) {
    return { shape: 'sphere', radius: 0.06, group: 'core', mass: 0.7 }
  }
  return null
}

function normalizeAnatomy(anatomy) {
  if (!anatomy || typeof anatomy !== 'object') {
    return { thorax: {}, organs: {}, collisionShells: {} }
  }
  return {
    thorax: anatomy.thorax || {},
    organs: anatomy.organs || {},
    collisionShells: anatomy.collisionShells || {},
  }
}

function normalizeSkeletonExtensions(extensions) {
  if (!extensions || typeof extensions !== 'object') {
    return { mode: 'none', spineSegments: [], structuralBones: [], legDescriptors: [], sensorAnchors: [] }
  }
  return {
    mode: extensions.mode || 'metadataOnly',
    spineSegments: Array.isArray(extensions.spineSegments) ? extensions.spineSegments.map(seg => ({ ...seg })) : [],
    structuralBones: Array.isArray(extensions.structuralBones) ? extensions.structuralBones.map(bone => ({ ...bone })) : [],
    legDescriptors: normalizeLegDescriptors(extensions.legDescriptors),
    sensorAnchors: normalizeSensorAnchors(extensions.sensorAnchors),
  }
}

function normalizeLegDescriptors(descriptors) {
  if (!Array.isArray(descriptors)) return []
  return descriptors.map(descriptor => ({
    ...descriptor,
    supportPoint: Array.isArray(descriptor.supportPoint) ? [...descriptor.supportPoint] : undefined,
  }))
}

function normalizeSensorAnchors(anchors) {
  if (!Array.isArray(anchors)) return []
  return anchors.map(anchor => ({
    ...anchor,
    localOffset: Array.isArray(anchor.localOffset) ? [...anchor.localOffset] : [0, 0, 0],
  }))
}

function buildAttachmentIndex(anatomy) {
  const out = new Map()
  const add = (id, bones = []) => {
    if (!id) return
    out.set(id, Array.isArray(bones) ? [...bones] : [])
  }
  const thorax = anatomy.thorax || {}
  add('ribCage', thorax.ribCage?.attachmentBones)
  add(thorax.sternum?.id || 'sternum', thorax.sternum?.attachmentBones)
  add(thorax.diaphragm?.id || 'diaphragm', thorax.diaphragm?.attachmentBones)
  for (const [id, organ] of Object.entries(anatomy.organs || {})) {
    add(id, organ.attachmentBones || [organ.container].filter(Boolean))
  }
  return out
}

function buildMeasurementHints(partCatalog) {
  const part = id => partCatalog?.parts?.get(id) || null
  const rib = part('tapered_rib_block_01')
  const pelvis = part('tapered_pelvis_block_01')
  const head = part('rounded_cube_head_01')
  const neck = part('cylinder_neck_01')
  const upperArm = part('cylinder_upper_arm_01')
  const forearm = part('tapered_forearm_01')
  const hand = part('mitten_hand_01')
  const thigh = part('cylinder_thigh_01')
  const shin = part('tapered_calf_01')
  const foot = part('wedge_foot_01')

  return {
    height: 1.85,
    shoulderWidth: socketSpanX(rib, 'shoulder_l', 'shoulder_r') ?? 0.76,
    hipWidth: socketSpanX(pelvis, 'hip_l', 'hip_r') ?? 0.36,
    torsoLength: primaryLength(rib) ?? 0.86,
    neckLength: primaryLength(neck) ?? 0.24,
    headRadius: head?.collision?.radius ?? 0.13,
    upperArmLength: primaryLength(upperArm) ?? 0.64,
    forearmLength: primaryLength(forearm) ?? 0.56,
    handLength: socketOffsetY(hand, 'wrist') ?? 0.10,
    thighLength: primaryLength(thigh) ?? 0.68,
    shinLength: primaryLength(shin) ?? 0.62,
    footLength: verticalSize(foot) ?? 0.22,
  }
}

function primaryLength(part) {
  const g = part?.geometry?.[0]
  return g?.length ?? g?.height ?? g?.size?.y ?? null
}

function verticalSize(part) {
  const g = part?.geometry?.[0]
  return g?.size?.y ?? g?.height ?? g?.length ?? null
}

function socketSpanX(part, a, b) {
  const ax = part?.sockets?.[a]?.x
  const bx = part?.sockets?.[b]?.x
  if (typeof ax !== 'number' || typeof bx !== 'number') return null
  return Math.abs(ax - bx)
}

function socketOffsetY(part, socket) {
  const y = part?.sockets?.[socket]?.y
  return typeof y === 'number' ? Math.abs(y) : null
}

function resolveDriveParams(jointType, drives, preset) {
  const base = drives?.[jointType] || { stiffness: 300, damping: 20, maxForce: 50 }
  return {
    driveMode: base.driveMode || 'force',
    stiffness: base.stiffness,
    damping: base.damping,
    maxForce: base.maxForce * (preset.strengthMul || 1),
  }
}

function resolveDriveAxes(jointType, drives, preset) {
  const base = resolveDriveParams(jointType, drives, preset)
  const axes = {
    twist: jointType === 'hinge' || jointType === 'twist',
    swing1: jointType === 'ball' || jointType === 'saddle',
    swing2: jointType === 'ball' || jointType === 'saddle',
  }
  return {
    twist: axes.twist ? { ...base, axis: 'twist' } : null,
    swing1: axes.swing1 ? { ...base, axis: 'swing1' } : null,
    swing2: axes.swing2 ? { ...base, axis: 'swing2' } : null,
  }
}

function resolveJointLimits(jointType, joints, overrides = null) {
  const base = { ...(joints?.[jointType] || { swingDeg: 45, twistDeg: 30, compliance: 0.0001 }), ...(overrides || {}) }
  return {
    ...base,
    swingRad: base.swingRad ?? ((base.swingDeg ?? 45) * Math.PI / 180),
    twistRad: base.twistRad ?? ((base.twistDeg ?? 30) * Math.PI / 180),
  }
}
