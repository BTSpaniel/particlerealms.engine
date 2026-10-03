// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export function createSoftTissueState(anatomy = null) {
  const shells = anatomy?.collisionShells || {}
  const out = Object.create(null)
  for (const [id, shell] of Object.entries(shells)) {
    out[id] = {
      id,
      shape: shell.shape || 'ellipsoid',
      centerBone: shell.centerBone || null,
      radius: Array.isArray(shell.radius) ? [...shell.radius] : [0.1, 0.1, 0.1],
      group: shell.group || 'softTissue',
      stiffness: shell.group === 'rib' ? 18 : 9,
      damping: shell.group === 'rib' ? 0.82 : 0.72,
      displacement: [0, 0, 0],
      velocity: [0, 0, 0],
      compression: 0,
      strain: 0,
      model: 'massSpring',
      advancedModel: 'femDeferred',
    }
  }
  return out
}

export function stepSoftTissue(state, inputs = {}, dt = 0) {
  if (!state || dt <= 0) return state
  const boneMotion = inputs.boneMotion || null
  const diaphragm = inputs.diaphragm || null
  const motorActivity = Math.max(0, Math.min(1, inputs.motorActivity ?? 0))
  for (const shell of Object.values(state)) {
    const motion = shell.centerBone ? boneMotion?.[shell.centerBone] : null
    const drive = estimateDrive(shell, motion, diaphragm, motorActivity)
    const stiffness = shell.stiffness
    const damping = shell.damping
    for (let i = 0; i < 3; i++) {
      const accel = (drive[i] - shell.displacement[i]) * stiffness - shell.velocity[i] * damping
      shell.velocity[i] += accel * dt
      shell.displacement[i] += shell.velocity[i] * dt
    }
    const mag = Math.hypot(shell.displacement[0], shell.displacement[1], shell.displacement[2])
    const radiusScale = Math.max(0.001, (shell.radius[0] + shell.radius[1] + shell.radius[2]) / 3)
    shell.strain = round3(Math.min(1, mag / radiusScale))
    shell.compression = round3(Math.max(0, -shell.displacement[1] / Math.max(0.001, shell.radius[1])))
  }
  return state
}

export function getSoftTissueReadback(state) {
  if (!state) return null
  const out = Object.create(null)
  for (const [id, shell] of Object.entries(state)) {
    out[id] = {
      id,
      shape: shell.shape,
      centerBone: shell.centerBone,
      radius: [...shell.radius],
      group: shell.group,
      displacement: [...shell.displacement],
      compression: shell.compression,
      strain: shell.strain,
      model: shell.model,
      advancedModel: shell.advancedModel,
    }
  }
  return out
}

export function sampleSoftTissueBoneMotion(ragdoll = null) {
  const out = Object.create(null)
  for (const bone of ragdoll?.bones || []) {
    const p = bone?.particle
    if (!p || !bone.name) continue
    out[bone.name] = {
      velocity: [p.vx || 0, p.vy || 0, p.vz || 0],
      fatigue: p._fatigue || 0,
    }
  }
  return out
}

function estimateDrive(shell, motion, diaphragm, motorActivity) {
  const velocity = motion?.velocity || [0, 0, 0]
  const fatigue = motion?.fatigue || 0
  const breath = shell.id === 'ribCage' ? diaphragm?.ribExpansion ?? 0 : shell.id === 'abdomen' ? diaphragm?.abdominalPressure ?? 0 : 0
  return [
    Math.max(-0.08, Math.min(0.08, velocity[0] * 0.012 + motorActivity * 0.006)),
    Math.max(-0.08, Math.min(0.08, velocity[1] * 0.01 + breath * 0.12 - fatigue * 0.01)),
    Math.max(-0.08, Math.min(0.08, velocity[2] * 0.012)),
  ]
}

function round3(v) {
  return Math.round(v * 1000) / 1000
}
