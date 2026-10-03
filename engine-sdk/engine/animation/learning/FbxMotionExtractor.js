// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { loadMixamoFBXAscii } from '../../tools/animation/FBXAscii.js'
import { MotionClip } from './MotionClip.js'
import { MotionDataset } from './MotionDataset.js'

export function extractMotionClipFromFbxAscii(text, options = {}) {
  if (typeof text !== 'string') throw new Error('FbxMotionExtractor: FBX ASCII text must be a string')
  if (text.startsWith('Kaydara FBX Binary')) throw new Error('FbxMotionExtractor: binary FBX is not supported')
  const rootJointName = options.rootJointName || options.rootName || 'mixamorig:Hips'
  const sourceName = options.name || options.fileName || 'fbx_ascii_clip'
  const { skeleton, clip } = loadMixamoFBXAscii(text, {
    rootName: rootJointName,
    animStackName: options.animStackName || 'mixamo.com',
    fps: Number.isFinite(options.fps) && options.fps > 0 ? options.fps : 60,
    lengthScale: Number.isFinite(options.lengthScale) ? options.lengthScale : 1,
  })
  return new MotionClip({
    name: options.clipName || clip.name || sourceName,
    fps: clip.fps,
    frameCount: clip.frameCount,
    jointNames: clip.jointNames,
    parentIndices: clip.parentIndices,
    localPositions: clip.translations,
    localRotations: clip.rotations,
    metadata: {
      source: 'fbx-ascii',
      sourceName,
      rootJointName,
      durationSeconds: clip.durationSec,
      lengthScale: clip.lengthScale,
      unitScaleFactor: clip.unitScaleFactor,
      skeletonJointCount: skeleton.nodes.length,
      ...(options.metadata || {}),
    },
  })
}

export function extractMotionDatasetFromFbxAsciiEntries(entries, options = {}) {
  if (!Array.isArray(entries)) throw new Error('FbxMotionExtractor: entries must be an array')
  const clips = []
  for (const entry of entries) {
    const text = typeof entry === 'string' ? entry : entry?.text
    const name = typeof entry === 'string' ? undefined : entry?.name
    if (typeof text !== 'string') continue
    clips.push(extractMotionClipFromFbxAscii(text, {
      ...options,
      name: name || options.name,
      fileName: name || options.fileName,
      clipName: entry?.clipName || name || options.clipName,
    }))
  }
  return new MotionDataset({
    name: options.datasetName || options.name || 'fbx_ascii_motion_dataset',
    clips,
    metadata: {
      source: 'fbx-ascii',
      clipCount: clips.length,
      rootJointName: options.rootJointName || options.rootName || 'mixamorig:Hips',
      ...(options.metadata || {}),
    },
  })
}

export async function extractMotionDatasetFromFbxFiles(files, options = {}) {
  const entries = []
  for (const file of Array.from(files || [])) {
    const name = String(file?.name || '')
    if (name && !name.toLowerCase().endsWith('.fbx')) continue
    if (!file || typeof file.text !== 'function') continue
    entries.push({ name: name || 'fbx_ascii_clip.fbx', text: await file.text() })
  }
  entries.sort((a, b) => a.name.localeCompare(b.name))
  return extractMotionDatasetFromFbxAsciiEntries(entries, options)
}

export async function extractMotionDatasetFromFbxDirectoryHandle(dirHandle, options = {}) {
  if (!dirHandle || typeof dirHandle.values !== 'function') throw new Error('FbxMotionExtractor: missing directory handle')
  const files = []
  for await (const entry of dirHandle.values()) {
    if (entry.kind !== 'file') continue
    const name = String(entry.name || '')
    if (!name.toLowerCase().endsWith('.fbx')) continue
    const file = await entry.getFile()
    files.push(file)
  }
  return extractMotionDatasetFromFbxFiles(files, options)
}

export default {
  extractMotionClipFromFbxAscii,
  extractMotionDatasetFromFbxAsciiEntries,
  extractMotionDatasetFromFbxFiles,
  extractMotionDatasetFromFbxDirectoryHandle,
}
