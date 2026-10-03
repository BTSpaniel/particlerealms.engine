// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { MotionClip } from './MotionClip.js'

export class MotionDataset {
  constructor(options = {}) {
    this.name = options.name || 'motion_dataset'
    this.clips = []
    this.metadata = { ...(options.metadata || {}) }
    this.stats = null
    if (Array.isArray(options.clips)) {
      for (const clip of options.clips) this.addClip(clip)
    }
    if (options.stats) this.stats = cloneStats(options.stats)
  }

  get clipCount() {
    return this.clips.length
  }

  get frameCount() {
    let total = 0
    for (const clip of this.clips) total += clip.frameCount || 0
    return total
  }

  addClip(clip) {
    const motionClip = clip instanceof MotionClip ? clip : new MotionClip(clip)
    this.clips.push(motionClip)
    this.stats = null
    return motionClip
  }

  getClip(indexOrName) {
    if (typeof indexOrName === 'number') return this.clips[indexOrName] || null
    return this.clips.find(clip => clip.name === indexOrName) || null
  }

  removeClip(indexOrName) {
    const index = typeof indexOrName === 'number' ? indexOrName : this.clips.findIndex(clip => clip.name === indexOrName)
    if (index < 0 || index >= this.clips.length) return null
    const removed = this.clips.splice(index, 1)[0]
    this.stats = null
    return removed
  }

  computeStats(options = {}) {
    const includeRotations = options.includeRotations !== false
    let posCount = 0
    let rotCount = 0
    const posMean = new Float64Array(3)
    const posM2 = new Float64Array(3)
    const rotMean = new Float64Array(4)
    const rotM2 = new Float64Array(4)
    for (const clip of this.clips) {
      for (let i = 0; i < clip.localPositions.length; i += 3) {
        posCount++
        updateMoments(posMean, posM2, posCount, clip.localPositions, i, 3)
      }
      if (includeRotations) {
        for (let i = 0; i < clip.localRotations.length; i += 4) {
          rotCount++
          updateMoments(rotMean, rotM2, rotCount, clip.localRotations, i, 4)
        }
      }
    }
    const stats = {
      position: finishMoments(posMean, posM2, posCount),
      rotation: includeRotations ? finishMoments(rotMean, rotM2, rotCount) : null,
      clipCount: this.clipCount,
      frameCount: this.frameCount,
    }
    this.stats = stats
    return cloneStats(stats)
  }

  toManifest() {
    return {
      name: this.name,
      metadata: { ...this.metadata },
      stats: this.stats ? cloneStats(this.stats) : null,
      clips: this.clips.map(clip => clip.toJSON()),
    }
  }

  toBinaryBundle() {
    return {
      manifest: this.toManifest(),
      clips: this.clips.map(clip => ({ name: clip.name, buffer: clip.toBinary() })),
    }
  }

  static fromBinaryBundle(bundle) {
    const manifest = bundle?.manifest || {}
    const dataset = new MotionDataset({ name: manifest.name, metadata: manifest.metadata || {}, stats: manifest.stats || null })
    for (const item of bundle?.clips || []) dataset.addClip(MotionClip.fromBinary(item.buffer))
    if (manifest.stats) dataset.stats = cloneStats(manifest.stats)
    return dataset
  }
}

function updateMoments(mean, m2, count, values, offset, width) {
  for (let k = 0; k < width; k++) {
    const x = values[offset + k]
    const delta = x - mean[k]
    mean[k] += delta / count
    const delta2 = x - mean[k]
    m2[k] += delta * delta2
  }
}

function finishMoments(mean, m2, count) {
  const width = mean.length
  const outMean = new Float32Array(width)
  const outStd = new Float32Array(width)
  for (let k = 0; k < width; k++) {
    outMean[k] = count > 0 ? mean[k] : 0
    outStd[k] = count > 1 ? Math.sqrt(Math.max(0, m2[k] / (count - 1))) : 0
  }
  return { mean: Array.from(outMean), std: Array.from(outStd), count }
}

function cloneStats(stats) {
  return stats == null ? null : JSON.parse(JSON.stringify(stats))
}

export default MotionDataset
