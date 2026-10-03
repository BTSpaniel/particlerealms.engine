// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * HumanoidRigBuilder — Builds a physics-ready humanoid rig (skeleton, bodies,
 * joints, mass profile, drive profile) from entity phenotype data.
 *
 * Produces a StickmanRagdoll-compatible component that ActiveBodySystem can
 * spawn as a PhysX articulation via the engine's ActiveRigController.
 *
 * Moved from editor/people-preview/PeoplePhenotypeRig.js into the game
 * simulation layer so any game entity can have an active body.
 */

// ─── HUMANOID SKELETON JOINTS (meters, Y-up) ────────────────────────────────

const HUMANOID_JOINTS = [
  { id: 'pelvis',      position: [0, 0.95, 0] },
  { id: 'spine',       position: [0, 1.18, 0] },
  { id: 'chest',       position: [0, 1.42, 0] },
  { id: 'neck',        position: [0, 1.62, 0] },
  { id: 'head',        position: [0, 1.82, 0] },
  { id: 'shoulder_l',  position: [-0.24, 1.43, 0] },
  { id: 'elbow_l',     position: [-0.44, 1.12, 0] },
  { id: 'wrist_l',     position: [-0.48, 0.86, 0] },
  { id: 'hand_l',      position: [-0.49, 0.76, 0] },
  { id: 'shoulder_r',  position: [0.24, 1.43, 0] },
  { id: 'elbow_r',     position: [0.44, 1.12, 0] },
  { id: 'wrist_r',     position: [0.48, 0.86, 0] },
  { id: 'hand_r',      position: [0.49, 0.76, 0] },
  { id: 'hip_l',       position: [-0.13, 0.9, 0] },
  { id: 'knee_l',      position: [-0.15, 0.48, 0] },
  { id: 'ankle_l',     position: [-0.16, 0.12, 0] },
  { id: 'foot_l',      position: [-0.21, 0.04, 0.14] },
  { id: 'hip_r',       position: [0.13, 0.9, 0] },
  { id: 'knee_r',      position: [0.15, 0.48, 0] },
  { id: 'ankle_r',     position: [0.16, 0.12, 0] },
  { id: 'foot_r',      position: [0.21, 0.04, 0.14] },
]

// ─── BODY BONE DEFINITIONS ──────────────────────────────────────────────────

const BODY_BONES = [
  { name: 'pelvis',        from: 'pelvis',     to: 'spine',     parent: -1,              radius: 0.11,  driveType: 'pelvis',     massGroup: 'pelvis' },
  { name: 'spine',         from: 'spine',      to: 'chest',     parent: 'pelvis',        radius: 0.10,  driveType: 'spineUpper', massGroup: 'abdomen' },
  { name: 'chest',         from: 'chest',      to: 'neck',      parent: 'spine',         radius: 0.12,  driveType: 'spineUpper', massGroup: 'thorax' },
  { name: 'neck',          from: 'neck',       to: 'head',      parent: 'chest',         radius: 0.055, driveType: 'neck',       massGroup: 'headNeck' },
  { name: 'head',          from: 'neck',       to: 'head',      parent: 'neck',          radius: 0.13,  lengthScale: 0.72, driveType: 'neck', massGroup: 'headNeck' },
  { name: 'leftUpperArm',  from: 'shoulder_l', to: 'elbow_l',   parent: 'chest',         radius: 0.055, driveType: 'shoulder',   massGroup: 'upperArm' },
  { name: 'leftForearm',   from: 'elbow_l',    to: 'wrist_l',   parent: 'leftUpperArm',  radius: 0.045, driveType: 'elbow',      massGroup: 'forearm' },
  { name: 'leftHand',      from: 'wrist_l',    to: 'hand_l',    parent: 'leftForearm',   radius: 0.052, driveType: 'wrist',      massGroup: 'hand' },
  { name: 'rightUpperArm', from: 'shoulder_r', to: 'elbow_r',   parent: 'chest',         radius: 0.055, driveType: 'shoulder',   massGroup: 'upperArm' },
  { name: 'rightForearm',  from: 'elbow_r',    to: 'wrist_r',   parent: 'rightUpperArm', radius: 0.045, driveType: 'elbow',      massGroup: 'forearm' },
  { name: 'rightHand',     from: 'wrist_r',    to: 'hand_r',    parent: 'rightForearm',  radius: 0.052, driveType: 'wrist',      massGroup: 'hand' },
  { name: 'leftThigh',     from: 'hip_l',      to: 'knee_l',    parent: 'pelvis',        radius: 0.07,  driveType: 'hip',        massGroup: 'thigh' },
  { name: 'leftShin',      from: 'knee_l',     to: 'ankle_l',   parent: 'leftThigh',     radius: 0.055, driveType: 'knee',       massGroup: 'shank' },
  { name: 'leftFoot',      from: 'ankle_l',    to: 'foot_l',    parent: 'leftShin',      radius: 0.055, driveType: 'ankle',      massGroup: 'foot' },
  { name: 'rightThigh',    from: 'hip_r',      to: 'knee_r',    parent: 'pelvis',        radius: 0.07,  driveType: 'hip',        massGroup: 'thigh' },
  { name: 'rightShin',     from: 'knee_r',     to: 'ankle_r',   parent: 'rightThigh',    radius: 0.055, driveType: 'knee',       massGroup: 'shank' },
  { name: 'rightFoot',     from: 'ankle_r',    to: 'foot_r',    parent: 'rightShin',     radius: 0.055, driveType: 'ankle',      massGroup: 'foot' },
]

const SKELETON_EXTENSIONS = {
  mode: 'metadataOnly',
  spineSegments: ['lumbar', 'thoracicLower', 'thoracicUpper'],
  structuralBones: [
    'leftClavicle', 'rightClavicle',
    'leftToe', 'rightToe',
    'leftThumb', 'leftIndexFinger', 'leftMiddleFinger',
    'rightThumb', 'rightIndexFinger', 'rightMiddleFinger',
  ],
}

// ─── MASS & TORQUE CONSTANTS ────────────────────────────────────────────────

const MASS_FRACTIONS = {
  headNeck: 0.081, thorax: 0.216, abdomen: 0.139, pelvis: 0.142,
  upperArm: 0.028, forearm: 0.016, hand: 0.006,
  thigh: 0.100, shank: 0.0465, foot: 0.0145,
}

const TORQUE_PER_KG = {
  neck: 0.22, shoulder: 0.75, elbow: 0.55, wrist: 0.18,
  spineUpper: 0.90, pelvis: 1.40, hip: 1.80, knee: 1.60, ankle: 0.70,
}

// ─── DEFAULT PHENOTYPE (for entities with no explicit phenotype) ─────────────

const DEFAULT_PHENOTYPE = {
  heightScale: 1.0,
  widthScale: 1.0,
  headScale: 1.0,
  limbScale: 1.0,
  massScale: 1.0,
  strengthScale: 1.0,
  balanceScale: 1.0,
  physicsPreset: 'HumanAverage',
}

// ─── PUBLIC API ─────────────────────────────────────────────────────────────

/**
 * Build a complete humanoid rig from entity data.
 *
 * @param {object} config
 * @param {string} config.id          - Entity ID
 * @param {string} config.name        - Entity display name
 * @param {object} [config.phenotype] - Body scales (heightScale, widthScale, etc.)
 * @param {string} [config.mode]      - 'poweredBody' | 'kinematicFollow' | 'animatedOnly'
 * @returns {{ skeleton, massProfile, driveProfile, stickman, activeRig }}
 */
export function buildHumanoidRig(config) {
  const id = config.id || 'unknown'
  const name = config.name || 'Unknown'
  const pheno = { ...DEFAULT_PHENOTYPE, ...config.phenotype }
  const mode = normalizeMode(config.mode)

  const skeleton = buildSkeleton(pheno)
  const massProfile = buildMassProfile(pheno)
  const driveProfile = buildDriveProfile(pheno, massProfile.massKg)
  const { bodies, joints, bonePairs, activeRig } = buildRigRecipe(id, name, pheno, skeleton, massProfile, driveProfile, mode)

  return {
    skeleton,
    massProfile,
    driveProfile,
    stickman: { bodies, joints, bonePairs, activeRig, kinematic: mode !== 'poweredBody' },
    activeRig,
  }
}

/**
 * Build a spawn-ready payload for ActiveBodySystem.
 */
export function buildActiveBodyPayload(config, worldPosition = [0, 0, 0]) {
  const rig = buildHumanoidRig({ ...config, mode: 'poweredBody' })
  return {
    entity: {
      id: config.id,
      components: {
        Transform: { position: [...worldPosition], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        StickmanRagdoll: rig.stickman,
      },
    },
    mode: 'poweredBody',
  }
}

// ─── SKELETON BUILDER ───────────────────────────────────────────────────────

function buildSkeleton(pheno) {
  const joints = HUMANOID_JOINTS.map(joint => {
    const isArm = joint.id.includes('shoulder') || joint.id.includes('elbow') || joint.id.includes('wrist') || joint.id.includes('hand')
    const isLeg = joint.id.includes('hip') || joint.id.includes('knee') || joint.id.includes('ankle') || joint.id.includes('foot')
    const headMul = joint.id === 'head' ? pheno.headScale : 1
    return {
      id: joint.id,
      position: [
        r(joint.position[0] * pheno.widthScale * (isArm || isLeg ? pheno.limbScale : 1)),
        r(joint.position[1] * pheno.heightScale * headMul),
        r(joint.position[2] * pheno.widthScale),
      ],
    }
  })
  return { root: 'pelvis', coordinateSpace: 'meters_y_up', joints, extensions: { ...SKELETON_EXTENSIONS } }
}

// ─── MASS PROFILE ───────────────────────────────────────────────────────────

function buildMassProfile(pheno) {
  const massKg = r(80 * pheno.massScale)
  return {
    preset: pheno.physicsPreset,
    massKg,
    strengthScale: pheno.strengthScale,
    balanceScale: pheno.balanceScale,
    groups: Object.fromEntries(Object.entries(MASS_FRACTIONS).map(([k, f]) => [k, r(massKg * f)])),
  }
}

// ─── DRIVE PROFILE ──────────────────────────────────────────────────────────

function buildDriveProfile(pheno, massKg) {
  const frequencyHz = r(4.5 * pheno.balanceScale)
  const dampingRatio = r(1.0 + (1.0 - pheno.balanceScale) * 0.2)
  const drives = {}
  for (const bone of BODY_BONES) {
    const maxForce = r((TORQUE_PER_KG[bone.driveType] || 0.75) * massKg * pheno.strengthScale)
    drives[bone.name] = {
      driveType: bone.driveType,
      eTWIST:  driveAxis(frequencyHz, dampingRatio, maxForce),
      eSWING1: driveAxis(frequencyHz, dampingRatio, maxForce),
      eSWING2: driveAxis(frequencyHz, dampingRatio, maxForce),
    }
  }
  return { preset: pheno.physicsPreset, driveMode: 'acceleration', frequencyHz, dampingRatio, drives }
}

// ─── RIG RECIPE ─────────────────────────────────────────────────────────────

function buildRigRecipe(id, name, pheno, skeleton, massProfile, driveProfile, mode) {
  const jointsById = new Map(skeleton.joints.map(j => [j.id, j]))

  const bodies = BODY_BONES.map((bone, index) => {
    const from = jointsById.get(bone.from)
    const to = jointsById.get(bone.to)
    const length = dist(from?.position, to?.position) * (bone.lengthScale ?? 1)
    return {
      name: bone.name, index,
      parent: bone.parent,
      sourceBone: [bone.from, bone.to],
      position: mid(from?.position, to?.position),
      rotation: [0, 0, 0, 1],
      radius: r(bone.radius * pheno.widthScale),
      length: r(Math.max(0.08, length)),
      driveType: bone.driveType,
      geometry: { type: 'capsule', radius: r(bone.radius * pheno.widthScale), halfHeight: r(Math.max(0.04, length * 0.5)) },
    }
  })

  // Resolve parent names → indices
  const nameToIdx = new Map(bodies.map((b, i) => [b.name, i]))
  for (const body of bodies) body.parent = body.parent === -1 ? -1 : nameToIdx.get(body.parent) ?? -1

  const joints = bodies.map((body, childIdx) => {
    if (body.parent === -1) return null
    return {
      id: `${bodies[body.parent].name}_${body.name}`,
      parent: body.parent, child: childIdx,
      type: isHinge(body.name) ? 'hinge' : 'ball',
      driveType: body.driveType,
    }
  }).filter(Boolean)

  const bonePairs = joints.map(j => [j.parent, j.child])

  const preset = toRuntimePreset(pheno.physicsPreset)
  const activeRig = {
    enabled: mode === 'poweredBody',
    backend: 'articulation',
    preset,
    massKg: massProfile.massKg,
    frequencyHz: driveProfile.frequencyHz,
    dampingRatio: driveProfile.dampingRatio,
    driveMode: driveProfile.driveMode,
    poseState: 'idle_stand',
    intent: { balance: 1, guard: 0, brace: 0, attack: 0, knockout: 0 },
    selfCollision: true,
    disableParentChildCollisions: true,
    skeletonExtensions: { ...SKELETON_EXTENSIONS },
  }

  return { bodies, joints, bonePairs, activeRig }
}

// ─── UTILITIES ──────────────────────────────────────────────────────────────

function driveAxis(frequencyHz, dampingRatio, maxForce) {
  const omega = frequencyHz * Math.PI * 2
  return { driveMode: 'acceleration', stiffness: r(omega * omega), damping: r(2 * dampingRatio * omega), maxForce, targetPosition: 0, targetVelocity: 0, armature: 0 }
}

function isHinge(name) { return name.includes('Shin') || name.includes('Forearm') || name.includes('Hand') || name.includes('Foot') }
function toRuntimePreset(p) { return (p === 'HumanWeak' || p === 'HumanAverage' || p === 'HumanAthletic' || p === 'HumanLarge') ? p : 'HumanAverage' }
function normalizeMode(m) { return (m === 'kinematicFollow' || m === 'poweredBody') ? m : 'animatedOnly' }
function dist(a = [0,0,0], b = [0,0,0]) { return Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]) }
function mid(a = [0,0,0], b = [0,0,0]) { return [r((a[0]+b[0])*0.5), r((a[1]+b[1])*0.5), r((a[2]+b[2])*0.5)] }
function r(v) { return Math.round(v * 1000) / 1000 }
