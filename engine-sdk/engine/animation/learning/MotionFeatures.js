// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { mat4Inverse } from '../../core/math/EngineMath.js'
import { mat4MultiplyInto } from '../../core/math/MathMat.js'

export function buildJointPositionDataset(clip, options = {}) {
  const rootJointName = options.rootJointName || clip.jointNames[0]
  const space = options.space || 'root'
  const includeVelocities = options.includeVelocities !== false
  const jointNames = Array.isArray(options.jointNames) && options.jointNames.length ? options.jointNames.slice() : clip.jointNames.slice()
  const jointIndices = new Int16Array(jointNames.length)
  for (let i = 0; i < jointNames.length; i++) {
    const idx = clip.jointNames.indexOf(jointNames[i])
    if (idx < 0) throw new Error(`MotionFeatures: joint not found: ${jointNames[i]}`)
    jointIndices[i] = idx
  }
  const rootIndex = clip.jointNames.indexOf(rootJointName)
  if (space === 'root' && rootIndex < 0) throw new Error(`MotionFeatures: root joint not found: ${rootJointName}`)
  const frameCount = clip.frameCount
  const jointCount = jointIndices.length
  const positions = new Float32Array(frameCount * jointCount * 3)
  const velocities = includeVelocities ? new Float32Array(frameCount * jointCount * 3) : null
  const rootInv = new Float32Array(16)
  const tmp = new Float32Array(16)
  const world = { positions: null, rotations: null, matrices: null, _local: null }
  const dt = clip.fps > 0 ? 1 / clip.fps : 0
  for (let f = 0; f < frameCount; f++) {
    clip.sampleWorld(f, world)
    if (space === 'root') {
      const rm = world.matrices.subarray(rootIndex * 16, rootIndex * 16 + 16)
      const inv = mat4Inverse(rm)
      for (let k = 0; k < 16; k++) rootInv[k] = inv[k]
    }
    for (let ji = 0; ji < jointCount; ji++) {
      const j = jointIndices[ji]
      let x = world.positions[j * 3 + 0]
      let y = world.positions[j * 3 + 1]
      let z = world.positions[j * 3 + 2]
      if (space === 'root') {
        mat4MultiplyInto(tmp, rootInv, world.matrices.subarray(j * 16, j * 16 + 16))
        x = tmp[12]
        y = tmp[13]
        z = tmp[14]
      }
      const out = (f * jointCount + ji) * 3
      positions[out + 0] = x
      positions[out + 1] = y
      positions[out + 2] = z
      if (velocities) {
        if (f === 0 || dt <= 0) {
          velocities[out + 0] = 0
          velocities[out + 1] = 0
          velocities[out + 2] = 0
        } else {
          const prev = ((f - 1) * jointCount + ji) * 3
          velocities[out + 0] = (positions[out + 0] - positions[prev + 0]) / dt
          velocities[out + 1] = (positions[out + 1] - positions[prev + 1]) / dt
          velocities[out + 2] = (positions[out + 2] - positions[prev + 2]) / dt
        }
      }
    }
  }
  return {
    fps: clip.fps,
    dt,
    frameCount,
    space,
    rootJointName,
    rootIndex,
    jointNames,
    jointIndices,
    positions,
    velocities,
  }
}

export function buildMotionFeatureIndex(dataset, options = {}) {
  const includeVelocities = options.includeVelocities !== false
  const posWeight = Number.isFinite(options.posWeight) ? options.posWeight : 1
  const velWeight = Number.isFinite(options.velWeight) ? options.velWeight : 0.15
  const entries = []
  let stride = 0
  for (let clipIndex = 0; clipIndex < dataset.clipCount; clipIndex++) {
    const clip = dataset.getClip(clipIndex)
    const jointDataset = buildJointPositionDataset(clip, options)
    const jointCount = jointDataset.jointIndices.length
    const featureStride = jointCount * 3 * (includeVelocities && jointDataset.velocities ? 2 : 1)
    if (stride === 0) stride = featureStride
    if (featureStride !== stride) throw new Error('MotionFeatures: all feature entries must share stride')
    const features = new Float32Array(jointDataset.frameCount * featureStride)
    for (let f = 0; f < jointDataset.frameCount; f++) {
      let o = f * featureStride
      for (let j = 0; j < jointCount; j++) {
        const i = (f * jointCount + j) * 3
        features[o++] = jointDataset.positions[i + 0] * posWeight
        features[o++] = jointDataset.positions[i + 1] * posWeight
        features[o++] = jointDataset.positions[i + 2] * posWeight
      }
      if (includeVelocities && jointDataset.velocities) {
        for (let j = 0; j < jointCount; j++) {
          const i = (f * jointCount + j) * 3
          features[o++] = jointDataset.velocities[i + 0] * velWeight
          features[o++] = jointDataset.velocities[i + 1] * velWeight
          features[o++] = jointDataset.velocities[i + 2] * velWeight
        }
      }
    }
    entries.push({ clipIndex, clipName: clip.name, clip, dataset: jointDataset, features, frameCount: jointDataset.frameCount, jointCount, stride: featureStride })
  }
  return { entries, stride, includeVelocities, posWeight, velWeight }
}

export function fillRagdollFeature(ragdoll, boneIndices, out, options = {}) {
  const includeVelocities = options.includeVelocities !== false
  const posWeight = Number.isFinite(options.posWeight) ? options.posWeight : 1
  const velWeight = Number.isFinite(options.velWeight) ? options.velWeight : 0.15
  const root = ragdoll?.getBone?.(options.rootBoneIndex ?? 0)
  const rootPos = root?.position
  const rootVel = root?.velocity
  if (!rootPos) {
    out.fill(0)
    return out
  }
  let o = 0
  for (const boneIndex of boneIndices) {
    const bone = ragdoll.getBone(boneIndex)
    const p = bone?.position
    out[o++] = ((p?.[0] ?? rootPos[0]) - rootPos[0]) * posWeight
    out[o++] = ((p?.[1] ?? rootPos[1]) - rootPos[1]) * posWeight
    out[o++] = ((p?.[2] ?? rootPos[2]) - rootPos[2]) * posWeight
  }
  if (includeVelocities) {
    for (const boneIndex of boneIndices) {
      const bone = ragdoll.getBone(boneIndex)
      const v = bone?.velocity
      out[o++] = ((v?.[0] ?? 0) - (rootVel?.[0] ?? 0)) * velWeight
      out[o++] = ((v?.[1] ?? 0) - (rootVel?.[1] ?? 0)) * velWeight
      out[o++] = ((v?.[2] ?? 0) - (rootVel?.[2] ?? 0)) * velWeight
    }
  }
  return out
}

export default {
  buildJointPositionDataset,
  buildMotionFeatureIndex,
  fillRagdollFeature,
}
