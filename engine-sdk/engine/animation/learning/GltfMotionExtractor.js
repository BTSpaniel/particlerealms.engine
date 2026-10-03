// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { MotionClip } from './MotionClip.js'
import { MotionDataset } from './MotionDataset.js'
import { SkeletonHierarchy } from './SkeletonHierarchy.js'
import { animationSampleChannel } from '../../core/math/AnimationTimeMath.js'
import { accessorElementCount, readAccessorArray } from '../../core/math/MeshAttributeMath.js'

export function extractMotionDatasetFromGltf(gltf, options = {}) {
  const skeleton = options.skeleton instanceof SkeletonHierarchy ? options.skeleton : SkeletonHierarchy.fromGltf(gltf, options)
  const clips = []
  const animations = Array.isArray(gltf?.animations) ? gltf.animations : []
  for (let i = 0; i < animations.length; i++) {
    clips.push(extractMotionClipFromGltf(gltf, i, { ...options, skeleton }))
  }
  return new MotionDataset({
    name: options.name || gltf?.asset?.generator || 'gltf_motion_dataset',
    clips,
    metadata: {
      source: 'gltf',
      animationCount: animations.length,
      skeleton: skeleton.toJSON(),
      ...(options.metadata || {}),
    },
  })
}

export function extractMotionClipFromGltf(gltf, animationIndex = 0, options = {}) {
  const skeleton = options.skeleton instanceof SkeletonHierarchy ? options.skeleton : SkeletonHierarchy.fromGltf(gltf, options)
  const animation = gltf?.animations?.[animationIndex]
  if (!animation) throw new Error(`GltfMotionExtractor: animation not found: ${animationIndex}`)
  const fps = Number.isFinite(options.fps) && options.fps > 0 ? options.fps : 60
  const channels = buildChannelRecords(gltf, animation, skeleton)
  let duration = 0
  for (const channel of channels) {
    const input = readAccessor(gltf, channel.sampler.input)
    if (input?.array?.length) duration = Math.max(duration, input.array[input.array.length - 1])
  }
  const frameCount = Math.max(1, Math.floor(duration * fps + 0.5) + 1)
  const jointCount = skeleton.jointCount
  const localPositions = new Float32Array(frameCount * jointCount * 3)
  const localRotations = new Float32Array(frameCount * jointCount * 4)
  const localScales = new Float32Array(frameCount * jointCount * 3)
  for (let f = 0; f < frameCount; f++) {
    for (let j = 0; j < jointCount; j++) {
      const srcP = j * 3
      const dstP = (f * jointCount + j) * 3
      localPositions[dstP + 0] = skeleton.localPositions[srcP + 0]
      localPositions[dstP + 1] = skeleton.localPositions[srcP + 1]
      localPositions[dstP + 2] = skeleton.localPositions[srcP + 2]
      localScales[dstP + 0] = skeleton.localScales[srcP + 0]
      localScales[dstP + 1] = skeleton.localScales[srcP + 1]
      localScales[dstP + 2] = skeleton.localScales[srcP + 2]
      const srcR = j * 4
      const dstR = (f * jointCount + j) * 4
      localRotations[dstR + 0] = skeleton.localRotations[srcR + 0]
      localRotations[dstR + 1] = skeleton.localRotations[srcR + 1]
      localRotations[dstR + 2] = skeleton.localRotations[srcR + 2]
      localRotations[dstR + 3] = skeleton.localRotations[srcR + 3]
    }
  }
  for (let f = 0; f < frameCount; f++) {
    const time = fps > 0 ? f / fps : 0
    for (const channel of channels) {
      const input = readAccessor(gltf, channel.sampler.input)
      const output = readAccessor(gltf, channel.sampler.output)
      if (!input || !output) continue
      const sample = animationSampleChannel(input.array, output.array, time, {
        elemCount: output.elemCount,
        path: channel.path,
        interpolation: channel.sampler.interpolation || 'LINEAR',
      }).value
      const joint = channel.jointIndex
      if (channel.path === 'translation') {
        const dst = (f * jointCount + joint) * 3
        localPositions[dst + 0] = sample[0]
        localPositions[dst + 1] = sample[1]
        localPositions[dst + 2] = sample[2]
      } else if (channel.path === 'rotation') {
        const dst = (f * jointCount + joint) * 4
        localRotations[dst + 0] = sample[0]
        localRotations[dst + 1] = sample[1]
        localRotations[dst + 2] = sample[2]
        localRotations[dst + 3] = sample[3]
      } else if (channel.path === 'scale') {
        const dst = (f * jointCount + joint) * 3
        localScales[dst + 0] = sample[0]
        localScales[dst + 1] = sample[1]
        localScales[dst + 2] = sample[2]
      }
    }
  }
  return new MotionClip({
    name: animation.name || `Animation_${animationIndex}`,
    fps,
    frameCount,
    jointNames: skeleton.jointNames,
    parentIndices: skeleton.parentIndices,
    localPositions,
    localRotations,
    localScales,
    metadata: {
      source: 'gltf',
      animationIndex,
      durationSeconds: duration,
      ...(options.metadata || {}),
    },
  })
}

function buildChannelRecords(gltf, animation, skeleton) {
  const out = []
  for (const channel of animation.channels || []) {
    const target = channel.target || {}
    const jointIndex = findJointByNodeIndex(skeleton, target.node)
    if (jointIndex < 0) continue
    const sampler = animation.samplers?.[channel.sampler]
    if (!sampler) continue
    if (target.path !== 'translation' && target.path !== 'rotation' && target.path !== 'scale') continue
    out.push({ jointIndex, path: target.path, sampler })
  }
  return out
}

function findJointByNodeIndex(skeleton, nodeIndex) {
  for (let i = 0; i < skeleton.nodeIndices.length; i++) {
    if (skeleton.nodeIndices[i] === nodeIndex) return i
  }
  return -1
}

function readAccessor(gltf, accessorIndex) {
  const accessor = gltf?.accessors?.[accessorIndex]
  if (!accessor) return null
  const bufferView = gltf.bufferViews?.[accessor.bufferView]
  if (!bufferView) return null
  const bufferDef = gltf.buffers?.[bufferView.buffer ?? 0]
  const source = resolveBufferSource(gltf, bufferView.buffer ?? 0, bufferDef)
  if (!source) return null
  const elemCount = accessorElementCount(accessor.type)
  const out = readAccessorArray(source, accessor, bufferView, { output: 'float32' })
  if (!out) return null
  return { array: out, elemCount, count: accessor.count }
}

function resolveBufferSource(gltf, bufferIndex, bufferDef) {
  if (gltf._buffers?.[bufferIndex]) return gltf._buffers[bufferIndex]
  if (gltf.buffersData?.[bufferIndex]) return gltf.buffersData[bufferIndex]
  if (gltf.buffersBinary?.[bufferIndex]) return gltf.buffersBinary[bufferIndex]
  if (bufferDef?.extras?._bytes) return bufferDef.extras._bytes
  if (typeof bufferDef?.uri === 'string' && bufferDef.uri.startsWith('data:')) return decodeDataUri(bufferDef.uri)
  return null
}

function decodeDataUri(uri) {
  const comma = uri.indexOf(',')
  if (comma < 0) return new Uint8Array(0)
  const meta = uri.slice(0, comma)
  const body = uri.slice(comma + 1)
  if (meta.includes(';base64')) {
    if (typeof atob === 'function') {
      const text = atob(body)
      const out = new Uint8Array(text.length)
      for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 255
      return out
    }
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(body, 'base64'))
  }
  return new TextEncoder().encode(decodeURIComponent(body))
}

export default {
  extractMotionClipFromGltf,
  extractMotionDatasetFromGltf,
}
