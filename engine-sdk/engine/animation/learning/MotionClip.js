// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { animationFrameWrap, animationSampleQuaternion, animationSampleScalar } from '../../core/math/AnimationTimeMath.js'
import { quatNormalize, quatMultiply } from '../../core/math/MathQuat.js'
import { mat4FromRotationTranslationScale, mat4MultiplyInto } from '../../core/math/MathMat.js'

const MAGIC = 0x31434c4d
const VERSION = 1

export class MotionClip {
  constructor(options = {}) {
    this.name = options.name || 'motion'
    this.fps = Number.isFinite(options.fps) && options.fps > 0 ? options.fps : 60
    this.frameCount = Math.max(1, options.frameCount | 0)
    this.jointNames = Array.isArray(options.jointNames) ? options.jointNames.slice() : []
    this.parentIndices = options.parentIndices instanceof Int16Array ? new Int16Array(options.parentIndices) : Int16Array.from(options.parentIndices || this.jointNames.map(() => -1))
    const positionSource = options.localPositions || options.translations || new Float32Array(this.frameCount * this.jointNames.length * 3)
    const rotationSource = options.localRotations || options.rotations || makeFrameIdentityRotations(this.frameCount, this.jointNames.length)
    this.localPositions = new Float32Array(positionSource)
    this.localRotations = new Float32Array(rotationSource)
    this.localScales = options.localScales ? new Float32Array(options.localScales) : null
    this.rootDeltas = options.rootDeltas ? new Float32Array(options.rootDeltas) : null
    this.metadata = { ...(options.metadata || {}) }
    this._validate()
    this._fillMissingRotations()
    if (!this.rootDeltas) this.rootDeltas = this.computeRootDeltas()
  }

  get jointCount() {
    return this.jointNames.length
  }

  get durationSeconds() {
    return this.frameCount / this.fps
  }

  _validate() {
    const joints = this.jointNames.length
    if (joints <= 0) throw new Error('MotionClip: jointNames must not be empty')
    if (this.parentIndices.length !== joints) throw new Error('MotionClip: parentIndices length must match joint count')
    if (this.localPositions.length !== this.frameCount * joints * 3) throw new Error('MotionClip: localPositions length does not match frame and joint count')
    if (this.localRotations.length !== this.frameCount * joints * 4) throw new Error('MotionClip: localRotations length does not match frame and joint count')
    if (this.localScales && this.localScales.length !== this.frameCount * joints * 3) throw new Error('MotionClip: localScales length does not match frame and joint count')
  }

  _fillMissingRotations() {
    for (let f = 0; f < this.frameCount; f++) {
      for (let j = 0; j < this.jointCount; j++) {
        const i = (f * this.jointCount + j) * 4
        const x = this.localRotations[i + 0]
        const y = this.localRotations[i + 1]
        const z = this.localRotations[i + 2]
        const w = this.localRotations[i + 3]
        const len = Math.hypot(x, y, z, w)
        if (len > 0.000001) {
          this.localRotations[i + 0] = x / len
          this.localRotations[i + 1] = y / len
          this.localRotations[i + 2] = z / len
          this.localRotations[i + 3] = w / len
        } else {
          this.localRotations[i + 0] = 0
          this.localRotations[i + 1] = 0
          this.localRotations[i + 2] = 0
          this.localRotations[i + 3] = 1
        }
      }
    }
  }

  sample(frameFloat, out = null) {
    const joints = this.jointCount
    const target = out || {
      positions: new Float32Array(joints * 3),
      rotations: new Float32Array(joints * 4),
      scales: this.localScales ? new Float32Array(joints * 3) : null,
    }
    if (!target.positions || target.positions.length < joints * 3) target.positions = new Float32Array(joints * 3)
    if (!target.rotations || target.rotations.length < joints * 4) target.rotations = new Float32Array(joints * 4)
    if (this.localScales && (!target.scales || target.scales.length < joints * 3)) target.scales = new Float32Array(joints * 3)
    if (!this.localScales) target.scales = null
    const frameReport = animationFrameWrap(frameFloat, this.frameCount)
    const f0 = frameReport.floor
    const f1 = frameReport.next
    const t = frameReport.alpha
    for (let j = 0; j < joints; j++) {
      const p0 = (f0 * joints + j) * 3
      const p1 = (f1 * joints + j) * 3
      const po = j * 3
      target.positions[po + 0] = animationSampleScalar(this.localPositions[p0 + 0], this.localPositions[p1 + 0], t)
      target.positions[po + 1] = animationSampleScalar(this.localPositions[p0 + 1], this.localPositions[p1 + 1], t)
      target.positions[po + 2] = animationSampleScalar(this.localPositions[p0 + 2], this.localPositions[p1 + 2], t)
      const r0 = (f0 * joints + j) * 4
      const r1 = (f1 * joints + j) * 4
      const q = animationSampleQuaternion(
        [this.localRotations[r0 + 0], this.localRotations[r0 + 1], this.localRotations[r0 + 2], this.localRotations[r0 + 3]],
        [this.localRotations[r1 + 0], this.localRotations[r1 + 1], this.localRotations[r1 + 2], this.localRotations[r1 + 3]],
        t
      )
      const ro = j * 4
      target.rotations[ro + 0] = q[0]
      target.rotations[ro + 1] = q[1]
      target.rotations[ro + 2] = q[2]
      target.rotations[ro + 3] = q[3]
      if (this.localScales && target.scales) {
        target.scales[po + 0] = animationSampleScalar(this.localScales[p0 + 0], this.localScales[p1 + 0], t)
        target.scales[po + 1] = animationSampleScalar(this.localScales[p0 + 1], this.localScales[p1 + 1], t)
        target.scales[po + 2] = animationSampleScalar(this.localScales[p0 + 2], this.localScales[p1 + 2], t)
      }
    }
    return target
  }

  sampleWorld(frameFloat, out = null) {
    const joints = this.jointCount
    const local = this.sample(frameFloat, out?._local || {})
    const target = out || {}
    target._local = local
    if (!target.positions || target.positions.length < joints * 3) target.positions = new Float32Array(joints * 3)
    if (!target.rotations || target.rotations.length < joints * 4) target.rotations = new Float32Array(joints * 4)
    if (!target.matrices || target.matrices.length < joints * 16) target.matrices = new Float32Array(joints * 16)
    if (!target._localMatrices || target._localMatrices.length < joints * 16) target._localMatrices = new Float32Array(joints * 16)
    if (!target._visited || target._visited.length < joints) target._visited = new Uint8Array(joints)
    target._visited.fill(0, 0, joints)
    const tmp = target._tmpMat || (target._tmpMat = new Float32Array(16))
    for (let j = 0; j < joints; j++) {
      const po = j * 3
      const ro = j * 4
      const scale = local.scales ? [local.scales[po + 0], local.scales[po + 1], local.scales[po + 2]] : [1, 1, 1]
      const localMat = mat4FromRotationTranslationScale(
        [local.rotations[ro + 0], local.rotations[ro + 1], local.rotations[ro + 2], local.rotations[ro + 3]],
        [local.positions[po + 0], local.positions[po + 1], local.positions[po + 2]],
        scale
      )
      copyMat(target._localMatrices, j * 16, localMat)
    }
    const computeJoint = (j) => {
      if (target._visited[j]) return
      target._visited[j] = 1
      const ro = j * 4
      const parent = this.parentIndices[j]
      if (parent >= 0) {
        computeJoint(parent)
        mat4MultiplyInto(tmp, target.matrices.subarray(parent * 16, parent * 16 + 16), target._localMatrices.subarray(j * 16, j * 16 + 16))
        copyMat(target.matrices, j * 16, tmp)
        const pro = parent * 4
        const q = quatNormalize(quatMultiply(
          [target.rotations[pro + 0], target.rotations[pro + 1], target.rotations[pro + 2], target.rotations[pro + 3]],
          [local.rotations[ro + 0], local.rotations[ro + 1], local.rotations[ro + 2], local.rotations[ro + 3]]
        ))
        target.rotations[ro + 0] = q[0]
        target.rotations[ro + 1] = q[1]
        target.rotations[ro + 2] = q[2]
        target.rotations[ro + 3] = q[3]
      } else {
        copyMat(target.matrices, j * 16, target._localMatrices.subarray(j * 16, j * 16 + 16))
        target.rotations[ro + 0] = local.rotations[ro + 0]
        target.rotations[ro + 1] = local.rotations[ro + 1]
        target.rotations[ro + 2] = local.rotations[ro + 2]
        target.rotations[ro + 3] = local.rotations[ro + 3]
      }
      const po = j * 3
      target.positions[po + 0] = target.matrices[j * 16 + 12]
      target.positions[po + 1] = target.matrices[j * 16 + 13]
      target.positions[po + 2] = target.matrices[j * 16 + 14]
    }
    for (let j = 0; j < joints; j++) computeJoint(j)
    return target
  }

  computeRootDeltas(rootIndex = 0) {
    const out = new Float32Array(this.frameCount * 3)
    for (let f = 1; f < this.frameCount; f++) {
      const prev = ((f - 1) * this.jointCount + rootIndex) * 3
      const cur = (f * this.jointCount + rootIndex) * 3
      out[f * 3 + 0] = this.localPositions[cur + 0] - this.localPositions[prev + 0]
      out[f * 3 + 1] = this.localPositions[cur + 1] - this.localPositions[prev + 1]
      out[f * 3 + 2] = this.localPositions[cur + 2] - this.localPositions[prev + 2]
    }
    return out
  }

  toJSON() {
    return {
      name: this.name,
      fps: this.fps,
      frameCount: this.frameCount,
      jointNames: this.jointNames.slice(),
      parentIndices: Array.from(this.parentIndices),
      metadata: { ...this.metadata },
      hasLocalScales: !!this.localScales,
    }
  }

  toBinary() {
    const arrays = [
      ['parentIndices', this.parentIndices],
      ['localPositions', this.localPositions],
      ['localRotations', this.localRotations],
      ['rootDeltas', this.rootDeltas],
    ]
    if (this.localScales) arrays.push(['localScales', this.localScales])
    const header = {
      ...this.toJSON(),
      arrays: arrays.map(([name, array]) => ({ name, type: array.constructor.name, byteLength: array.byteLength, length: array.length })),
    }
    const headerBytes = new TextEncoder().encode(JSON.stringify(header))
    const headerPadded = align4(headerBytes.length)
    let total = 12 + headerPadded
    for (const [, array] of arrays) total += align4(array.byteLength)
    const buffer = new ArrayBuffer(total)
    const view = new DataView(buffer)
    view.setUint32(0, MAGIC, true)
    view.setUint32(4, VERSION, true)
    view.setUint32(8, headerBytes.length, true)
    new Uint8Array(buffer, 12, headerBytes.length).set(headerBytes)
    let offset = 12 + headerPadded
    for (const [, array] of arrays) {
      new Uint8Array(buffer, offset, array.byteLength).set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength))
      offset += align4(array.byteLength)
    }
    return buffer
  }

  static fromBinary(buffer) {
    const view = new DataView(buffer)
    if (view.getUint32(0, true) !== MAGIC) throw new Error('MotionClip: invalid binary magic')
    if (view.getUint32(4, true) !== VERSION) throw new Error('MotionClip: unsupported binary version')
    const headerLength = view.getUint32(8, true)
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 12, headerLength)))
    const values = {}
    let offset = 12 + align4(headerLength)
    for (const spec of header.arrays || []) {
      const bytes = buffer.slice(offset, offset + spec.byteLength)
      values[spec.name] = typedArrayFromName(spec.type, bytes)
      offset += align4(spec.byteLength)
    }
    return new MotionClip({
      name: header.name,
      fps: header.fps,
      frameCount: header.frameCount,
      jointNames: header.jointNames,
      parentIndices: values.parentIndices,
      localPositions: values.localPositions,
      localRotations: values.localRotations,
      localScales: values.localScales || null,
      rootDeltas: values.rootDeltas || null,
      metadata: header.metadata || {},
    })
  }
}

function typedArrayFromName(type, buffer) {
  switch (type) {
    case 'Int16Array': return new Int16Array(buffer)
    case 'Int32Array': return new Int32Array(buffer)
    case 'Uint16Array': return new Uint16Array(buffer)
    case 'Uint32Array': return new Uint32Array(buffer)
    case 'Float32Array': return new Float32Array(buffer)
    default: throw new Error(`MotionClip: unsupported typed array type ${type}`)
  }
}

function copyMat(out, offset, m) {
  for (let i = 0; i < 16; i++) out[offset + i] = m[i]
}

function align4(n) {
  return (n + 3) & ~3
}

function makeFrameIdentityRotations(frameCount, jointCount) {
  const out = new Float32Array(frameCount * jointCount * 4)
  for (let f = 0; f < frameCount; f++) {
    for (let j = 0; j < jointCount; j++) out[(f * jointCount + j) * 4 + 3] = 1
  }
  return out
}

export default MotionClip
