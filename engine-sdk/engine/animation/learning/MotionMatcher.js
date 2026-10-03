// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { MotionDataset } from './MotionDataset.js'
import { buildMotionFeatureIndex, fillRagdollFeature } from './MotionFeatures.js'
import { animationFrameWrap } from '../../core/math/AnimationTimeMath.js'

export class MotionMatcher {
  constructor(options = {}) {
    this.dataset = options.dataset instanceof MotionDataset ? options.dataset : new MotionDataset({ clips: options.clips || [] })
    this.rootJointName = options.rootJointName || null
    this.jointNames = Array.isArray(options.jointNames) ? options.jointNames.slice() : null
    this.ragdollBoneIndices = Array.isArray(options.ragdollBoneIndices) ? options.ragdollBoneIndices.slice() : []
    this.includeVelocities = options.includeVelocities !== false
    this.posWeight = Number.isFinite(options.posWeight) ? options.posWeight : 1
    this.velWeight = Number.isFinite(options.velWeight) ? options.velWeight : 0.15
    this.searchFrameStride = Math.max(1, (options.searchFrameStride | 0) || 2)
    this.matchIntervalSec = Number.isFinite(options.matchIntervalSec) ? options.matchIntervalSec : 0.15
    this.switchThreshold = Number.isFinite(options.switchThreshold) ? options.switchThreshold : 0.05
    this.blendTimeSec = Number.isFinite(options.blendTimeSec) ? options.blendTimeSec : 0.2
    this._index = null
    this._query = null
    this._current = null
    this._blend = null
    this._timeSinceMatch = 0
    this._tmpPoseA = null
    this._tmpPoseB = null
    this._tmpVelA = null
    this._tmpVelB = null
    this._tmpBlendPos = null
    this._tmpBlendVel = null
    this.rebuildIndex()
  }

  addClip(clip) {
    const added = this.dataset.addClip(clip)
    this.rebuildIndex()
    return added
  }

  getStatus() {
    return {
      clipCount: this.dataset.clipCount,
      frameCount: this.dataset.frameCount,
      stride: this._index?.stride || 0,
      current: this._current ? { ...this._current } : null,
    }
  }

  rebuildIndex() {
    if (this.dataset.clipCount === 0) {
      this._index = { entries: [], stride: 0 }
      this._query = null
      return this._index
    }
    const first = this.dataset.getClip(0)
    const jointNames = this.jointNames || first.jointNames.slice()
    const rootJointName = this.rootJointName || jointNames[0] || first.jointNames[0]
    this._index = buildMotionFeatureIndex(this.dataset, {
      rootJointName,
      jointNames,
      includeVelocities: this.includeVelocities,
      posWeight: this.posWeight,
      velWeight: this.velWeight,
    })
    this.jointNames = jointNames
    this.rootJointName = rootJointName
    this._query = new Float32Array(this._index.stride)
    const jointCount = jointNames.length
    this._tmpPoseA = new Float32Array(jointCount * 3)
    this._tmpPoseB = new Float32Array(jointCount * 3)
    this._tmpVelA = this.includeVelocities ? new Float32Array(jointCount * 3) : null
    this._tmpVelB = this.includeVelocities ? new Float32Array(jointCount * 3) : null
    this._tmpBlendPos = new Float32Array(jointCount * 3)
    this._tmpBlendVel = this.includeVelocities ? new Float32Array(jointCount * 3) : null
    return this._index
  }

  findBestMatchFromFeature(feature) {
    let bestScore = Infinity
    let bestClipIndex = 0
    let bestFrame = 0
    for (const entry of this._index.entries) {
      for (let f = 0; f < entry.frameCount; f += this.searchFrameStride) {
        const base = f * entry.stride
        let score = 0
        for (let k = 0; k < entry.stride; k++) {
          const d = entry.features[base + k] - feature[k]
          score += d * d
          if (score >= bestScore) break
        }
        if (score < bestScore) {
          bestScore = score
          bestClipIndex = entry.clipIndex
          bestFrame = f
        }
      }
    }
    return { clipIndex: bestClipIndex, frame: bestFrame, score: bestScore }
  }

  findBestMatch(ragdoll) {
    if (!this._query) return null
    if (this.ragdollBoneIndices.length !== this.jointNames.length) throw new Error('MotionMatcher: ragdollBoneIndices length must match jointNames length')
    fillRagdollFeature(ragdoll, this.ragdollBoneIndices, this._query, {
      includeVelocities: this.includeVelocities,
      posWeight: this.posWeight,
      velWeight: this.velWeight,
    })
    return this.findBestMatchFromFeature(this._query)
  }

  update(ragdoll, dt) {
    if (!this._index?.entries?.length) return null
    this._timeSinceMatch += Math.max(0, dt || 0)
    if (!this._current) {
      const best = this.findBestMatch(ragdoll)
      if (!best) return null
      this._current = { clipIndex: best.clipIndex, frame: best.frame, frameFloat: best.frame }
      this._timeSinceMatch = 0
    }
    this._advance(dt)
    if (this._timeSinceMatch >= this.matchIntervalSec && !this._blend) {
      this._timeSinceMatch = 0
      const best = this.findBestMatch(ragdoll)
      if (best) {
        const currentScore = this._scoreAt(this._current.clipIndex, Math.round(this._current.frameFloat), ragdoll)
        if (best.score + this.switchThreshold < currentScore) this._startBlend(best.clipIndex, best.frame)
      }
    }
    if (this._blend) {
      this._blend.t += Math.max(0, dt || 0)
      const a = this.blendTimeSec > 0 ? Math.min(1, this._blend.t / this.blendTimeSec) : 1
      if (a >= 1) {
        this._current = { clipIndex: this._blend.toClipIndex, frame: this._blend.toFrame, frameFloat: this._blend.toFrameFloat }
        this._blend = null
      }
    }
    return this.sampleCurrentTarget()
  }

  sampleCurrentTarget() {
    if (!this._current) return null
    if (!this._blend) {
      const entry = this._index.entries[this._current.clipIndex]
      this._sampleDatasetPose(entry.dataset, this._current.frameFloat, this._tmpBlendPos, this._tmpBlendVel)
      return this._target(entry, this._tmpBlendPos, this._tmpBlendVel)
    }
    const a = this.blendTimeSec > 0 ? Math.min(1, this._blend.t / this.blendTimeSec) : 1
    const fromEntry = this._index.entries[this._blend.fromClipIndex]
    const toEntry = this._index.entries[this._blend.toClipIndex]
    this._sampleDatasetPose(fromEntry.dataset, this._blend.fromFrameFloat, this._tmpPoseA, this._tmpVelA)
    this._sampleDatasetPose(toEntry.dataset, this._blend.toFrameFloat, this._tmpPoseB, this._tmpVelB)
    for (let i = 0; i < this._tmpBlendPos.length; i++) this._tmpBlendPos[i] = this._tmpPoseA[i] * (1 - a) + this._tmpPoseB[i] * a
    if (this._tmpBlendVel && this._tmpVelA && this._tmpVelB) {
      for (let i = 0; i < this._tmpBlendVel.length; i++) this._tmpBlendVel[i] = this._tmpVelA[i] * (1 - a) + this._tmpVelB[i] * a
    }
    return this._target(toEntry, this._tmpBlendPos, this._tmpBlendVel)
  }

  _target(entry, positions, velocities) {
    return {
      jointNames: this.jointNames.slice(),
      ragdollBoneIndices: this.ragdollBoneIndices.slice(),
      fps: entry.dataset.fps,
      clipIndex: entry.clipIndex,
      clipName: entry.clipName,
      positions,
      velocities,
    }
  }

  _advance(dt) {
    const step = Math.max(0, dt || 0)
    if (this._current) {
      const entry = this._index.entries[this._current.clipIndex]
      this._current.frameFloat = animationFrameWrap(this._current.frameFloat + step * (entry?.dataset?.fps || 60), entry?.frameCount || 1).frame
    }
    if (this._blend) {
      const entry = this._index.entries[this._blend.toClipIndex]
      this._blend.toFrameFloat = animationFrameWrap(this._blend.toFrameFloat + step * (entry?.dataset?.fps || 60), entry?.frameCount || 1).frame
    }
  }

  _startBlend(toClipIndex, toFrame) {
    this._blend = {
      t: 0,
      fromClipIndex: this._current.clipIndex,
      fromFrameFloat: this._current.frameFloat,
      toClipIndex,
      toFrame,
      toFrameFloat: toFrame,
    }
  }

  _sampleDatasetPose(dataset, frameFloat, outPos, outVel) {
    const frameCount = dataset.frameCount | 0
    const jointCount = dataset.jointIndices.length
    const frameReport = animationFrameWrap(frameFloat, frameCount)
    const f0 = frameReport.floor
    const f1 = frameReport.next
    const t = frameReport.alpha
    for (let j = 0; j < jointCount; j++) {
      const i0 = (f0 * jointCount + j) * 3
      const i1 = (f1 * jointCount + j) * 3
      const o = j * 3
      outPos[o + 0] = dataset.positions[i0 + 0] * (1 - t) + dataset.positions[i1 + 0] * t
      outPos[o + 1] = dataset.positions[i0 + 1] * (1 - t) + dataset.positions[i1 + 1] * t
      outPos[o + 2] = dataset.positions[i0 + 2] * (1 - t) + dataset.positions[i1 + 2] * t
      if (outVel && dataset.velocities) {
        outVel[o + 0] = dataset.velocities[i0 + 0] * (1 - t) + dataset.velocities[i1 + 0] * t
        outVel[o + 1] = dataset.velocities[i0 + 1] * (1 - t) + dataset.velocities[i1 + 1] * t
        outVel[o + 2] = dataset.velocities[i0 + 2] * (1 - t) + dataset.velocities[i1 + 2] * t
      }
    }
  }

  _scoreAt(clipIndex, frameIndex, ragdoll) {
    if (!this._query) return Infinity
    fillRagdollFeature(ragdoll, this.ragdollBoneIndices, this._query, {
      includeVelocities: this.includeVelocities,
      posWeight: this.posWeight,
      velWeight: this.velWeight,
    })
    const entry = this._index.entries[clipIndex]
    if (!entry) return Infinity
    const frame = ((frameIndex | 0) % entry.frameCount + entry.frameCount) % entry.frameCount
    const base = frame * entry.stride
    let score = 0
    for (let k = 0; k < entry.stride; k++) {
      const d = entry.features[base + k] - this._query[k]
      score += d * d
    }
    return score
  }
}

export default MotionMatcher
