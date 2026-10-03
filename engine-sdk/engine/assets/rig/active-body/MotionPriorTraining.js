// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { extractMotionClipFromFbxAscii } from '../../../animation/learning/FbxMotionExtractor.js'
import { ACTION_SIZE, BONE_ORDER } from './NeuralMotor.js'
import { clampRange, lerp } from '../../../core/math/MathScalar.js'

export const ANI_MOTION_INDEX_FORMAT = 'particle.ani-motion-index'
export const ANI_MOTION_MANIFEST_FORMAT = 'particle.ani-motion-manifest'
export const ANI_MOTION_JSON_FORMAT = 'particle.ani-motion-json'
export const ANI_MOTION_HTTP_SCHEMA_VERSION = 2
export const ANI_MOTION_HTTP_READ_VERSIONS = Object.freeze([2, 1])

const FALLBACK_ANI_FILES = Object.freeze([
  'idle.fbx',
  'tpose.fbx',
  'backdowngettingup.fbx',
  'facedowngettingup.fbx',
  'walk1_subject1.fbx',
  'walk1_subject2.fbx',
  'walk1_subject5.fbx',
  'walk2_subject1.fbx',
  'walk2_subject3.fbx',
  'walk2_subject4.fbx',
  'walk3_subject1.fbx',
  'walk3_subject2.fbx',
  'walk3_subject3.fbx',
  'walk3_subject4.fbx',
  'walk3_subject5.fbx',
  'walk4_subject1.fbx',
])

const MIXAMO_JOINTS_BY_BONE = Object.freeze({
  pelvis: ['mixamorig:Hips', 'Hips', 'Hip', 'b_root'],
  spine: ['mixamorig:Spine', 'Spine', 'b_spine0'],
  spine1: ['mixamorig:Spine1', 'Spine1', 'b_spine1'],
  chest: ['mixamorig:Spine2', 'Spine2', 'Spine3', 'mixamorig:Chest', 'Chest', 'b_spine2', 'b_spine3'],
  neck: ['mixamorig:Neck', 'Neck', 'b_neck0'],
  head: ['mixamorig:Head', 'Head', 'b_head'],
  leftShoulder: ['mixamorig:LeftShoulder', 'LeftShoulder', 'b_l_shoulder', 'p_l_scap'],
  leftUpperArm: ['mixamorig:LeftArm', 'LeftArm', 'b_l_arm'],
  leftForearm: ['mixamorig:LeftForeArm', 'LeftForeArm', 'mixamorig:LeftForearm', 'LeftForearm', 'b_l_forearm'],
  leftHand: ['mixamorig:LeftHand', 'LeftHand', 'b_l_wrist', 'b_l_wrist_twist'],
  rightShoulder: ['mixamorig:RightShoulder', 'RightShoulder', 'b_r_shoulder', 'p_r_scap'],
  rightUpperArm: ['mixamorig:RightArm', 'RightArm', 'b_r_arm'],
  rightForearm: ['mixamorig:RightForeArm', 'RightForeArm', 'mixamorig:RightForearm', 'RightForearm', 'b_r_forearm'],
  rightHand: ['mixamorig:RightHand', 'RightHand', 'b_r_wrist', 'b_r_wrist_twist'],
  leftThigh: ['mixamorig:LeftUpLeg', 'LeftUpLeg', 'b_l_upleg'],
  leftShin: ['mixamorig:LeftLeg', 'LeftLeg', 'b_l_leg'],
  leftFoot: ['mixamorig:LeftFoot', 'LeftFoot', 'LeftToeBase', 'b_l_talocrural', 'b_l_subtalar', 'b_l_ball'],
  rightThigh: ['mixamorig:RightUpLeg', 'RightUpLeg', 'b_r_upleg'],
  rightShin: ['mixamorig:RightLeg', 'RightLeg', 'b_r_leg'],
  rightFoot: ['mixamorig:RightFoot', 'RightFoot', 'RightToeBase', 'b_r_talocrural', 'b_r_subtalar', 'b_r_ball'],
})

// LIFE convention places each bone particle at the *distal* end of the named
// segment (see Life/data/poses/README.md). Geno/LAFAN skeletons follow the
// same naming as Mixamo but expose every distal joint separately, so we can
// pick the joint that physically lies at LIFE's particle position. This
// fixes the one-joint upstream drift produced by the legacy Mixamo aliases
// when running NPZ clips through the motion prior teacher.
const GENO_DISTAL_JOINTS_BY_BONE = Object.freeze({
  pelvis: ['Hips', 'mixamorig:Hips'],
  spine: ['Spine1', 'mixamorig:Spine1'],
  spine1: ['Spine2', 'mixamorig:Spine2'],
  chest: ['Spine3', 'Spine2', 'mixamorig:Spine3', 'mixamorig:Spine2'],
  neck: ['Neck', 'mixamorig:Neck'],
  head: ['Head', 'mixamorig:Head'],
  leftShoulder: ['LeftArm', 'mixamorig:LeftArm'],
  leftUpperArm: ['LeftForeArm', 'mixamorig:LeftForeArm', 'mixamorig:LeftForearm', 'LeftForearm'],
  leftForearm: ['LeftHand', 'mixamorig:LeftHand'],
  leftHand: ['LeftHand', 'mixamorig:LeftHand'],
  rightShoulder: ['RightArm', 'mixamorig:RightArm'],
  rightUpperArm: ['RightForeArm', 'mixamorig:RightForeArm', 'mixamorig:RightForearm', 'RightForearm'],
  rightForearm: ['RightHand', 'mixamorig:RightHand'],
  rightHand: ['RightHand', 'mixamorig:RightHand'],
  leftThigh: ['LeftLeg', 'mixamorig:LeftLeg'],
  leftShin: ['LeftFoot', 'mixamorig:LeftFoot'],
  leftFoot: ['LeftToeBase', 'mixamorig:LeftToeBase', 'LeftFoot', 'mixamorig:LeftFoot'],
  rightThigh: ['RightLeg', 'mixamorig:RightLeg'],
  rightShin: ['RightFoot', 'mixamorig:RightFoot'],
  rightFoot: ['RightToeBase', 'mixamorig:RightToeBase', 'RightFoot', 'mixamorig:RightFoot'],
})

function isGenoStyleSkeleton(jointNames) {
  if (!Array.isArray(jointNames) || jointNames.length === 0) return false
  const set = new Set(jointNames.map(name => String(name)))
  let geno = 0
  for (const name of ['Hips', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'Spine1', 'Spine2', 'LeftArm', 'LeftForeArm', 'LeftHand']) {
    if (set.has(name)) geno++
  }
  return geno >= 6
}

const CATEGORY_WEIGHT = Object.freeze({ stand: 0.07, walk: 0.25, getup: 0.18, act: 0.08 })

export function createAniMotionPriorState() {
  return {
    status: 'idle',
    clips: [],
    byCategory: { stand: [], walk: [], getup: [], act: [] },
    files: [],
    totalFiles: 0,
    parsedFiles: 0,
    failedFiles: 0,
    errors: [],
    baseUrl: '/ani',
    promise: null,
    startedAt: 0,
    loadedAt: 0,
  }
}

export function getAniMotionPriorReport(state) {
  if (!state) return { status: 'missing', clips: 0 }
  return {
    status: state.status,
    baseUrl: state.baseUrl,
    totalFiles: state.totalFiles,
    parsedFiles: state.parsedFiles,
    failedFiles: state.failedFiles,
    clips: state.clips.length,
    categories: {
      stand: state.byCategory.stand.length,
      walk: state.byCategory.walk.length,
      getup: state.byCategory.getup.length,
      act: state.byCategory.act.length,
    },
    files: state.files.slice(0, 12),
    errors: state.errors.slice(-8),
  }
}

export async function loadAniMotionPrior(state, options = {}) {
  if (!state) throw new Error('MotionPriorTraining: missing state')
  if (state.status === 'loading' && state.promise) return state.promise
  if (state.status === 'ready' && !options.reload) return getAniMotionPriorReport(state)
  state.status = 'loading'
  state.startedAt = performanceNow()
  state.clips = []
  state.byCategory = { stand: [], walk: [], getup: [], act: [] }
  state.files = []
  state.totalFiles = 0
  state.parsedFiles = 0
  state.failedFiles = 0
  state.errors = []
  state.promise = loadAniMotionPriorInternal(state, options)
  return state.promise
}

async function loadAniMotionPriorInternal(state, options) {
  try {
    const discovered = await discoverAniMotionFiles(options)
    state.baseUrl = discovered.baseUrl
    const clips = prioritizeAniClips(discovered.clips)
    const maxClips = normalizeMaxClips(options.maxClips)
    const selected = clips.slice(0, maxClips)
    state.files = selected.map(clip => clip.file)
    state.totalFiles = clips.length
    for (let i = 0; i < selected.length; i++) {
      const descriptor = selected[i]
      const file = descriptor.file
      try {
        const url = descriptor.url || `${state.baseUrl.replace(/\/$/, '')}/${encodePath(file)}`
        const res = await fetch(url, { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const clip = descriptor.format === 'npz'
          ? createAi4AnimationMotionClipFromJson(await res.json(), file)
          : extractMotionClipFromFbxAscii(await readFbxTextResponse(res), { fileName: file, clipName: file, fps: options.fps || 60 })
        const runtime = createRuntimeMotionClip(clip, file)
        if (!runtime) throw new Error('no usable humanoid joint coverage')
        state.clips.push(runtime)
        state.byCategory[runtime.category].push(runtime)
        state.parsedFiles++
      } catch (err) {
        state.failedFiles++
        state.errors.push(`${file}: ${err?.message || err}`)
      }
      if ((i & 3) === 3) await sleep(0)
    }
    state.loadedAt = performanceNow()
    state.status = state.clips.length > 0 ? 'ready' : 'empty'
    return getAniMotionPriorReport(state)
  } catch (err) {
    state.status = 'error'
    state.errors.push(err?.message || String(err))
    return getAniMotionPriorReport(state)
  }
}

export function mixAniMotionTeacher(teacher, state, entry, ragdoll, bonesByName, intent = null, options = {}) {
  if (!teacher || !state || state.status !== 'ready' || entry?.bodyKind === 'animal') return null
  const kind = resolvePriorKind(entry, intent)
  const list = state.byCategory[kind].length > 0 ? state.byCategory[kind] : state.clips
  if (!list.length) return null
  const runtime = selectRuntimeClip(list, entry)
  const sampled = sampleRuntimeMotionTargets(runtime, entry, ragdoll, bonesByName, intent, kind, options)
  if (!sampled || sampled.coverage < 0.45) return null
  const stable = options.stable ?? true
  if (!stable) return null
  const baseWeight = Number.isFinite(options.weight) ? options.weight : (CATEGORY_WEIGHT[kind] ?? 0.08)
  const weight = clampRange(baseWeight, 0, 0.25)
  if (weight <= 0) return null
  const prior = sampled.teacher
  const mask = sampled.mask
  for (let boneIndex = 0; boneIndex < BONE_ORDER.length; boneIndex++) {
    if (!mask[boneIndex]) continue
    const base = boneIndex * 3
    teacher[base] = teacher[base] * (1 - weight) + prior[base] * weight
    teacher[base + 1] = teacher[base + 1] * (1 - weight) + prior[base + 1] * weight
    teacher[base + 2] = teacher[base + 2] * (1 - weight) + prior[base + 2] * weight
  }
  return {
    applied: true,
    kind,
    clip: runtime.name,
    weight,
    coverage: sampled.coverage,
    frame: sampled.frame,
    loadedClips: state.clips.length,
  }
}

async function discoverAniMotionFiles(options = {}) {
  const apiUrl = options.apiUrl || '/api/ani'
  const fallbackBaseUrl = options.baseUrl || '/ani'
  const fromApi = await tryJsonFileList(apiUrl)
  if (fromApi.clips.length > 0) return fromApi
  const fromManifest = await tryJsonFileList(`${fallbackBaseUrl.replace(/\/$/, '')}/manifest.json`)
  if (fromManifest.clips.length > 0) return { ...fromManifest, baseUrl: fromManifest.baseUrl || fallbackBaseUrl }
  const fromDirectory = await tryDirectoryListing(fallbackBaseUrl)
  if (fromDirectory.clips.length > 0) return fromDirectory
  return { baseUrl: fallbackBaseUrl, clips: FALLBACK_ANI_FILES.map(file => motionClipDescriptor(file, fallbackBaseUrl)) }
}

async function tryJsonFileList(url) {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return { baseUrl: '/ani', clips: [] }
    const json = normalizeAniMotionIndexEnvelope(await res.json())
    const baseUrl = json.baseUrl || '/ani'
    const npzBaseUrl = json.npzBaseUrl || '/api/ani/npz'
    const rawClips = Array.isArray(json) ? json : json.clips
    const clips = sanitizeClipList(rawClips, { baseUrl, npzBaseUrl })
    if (clips.length > 0) return { baseUrl, clips }
    const files = sanitizeFileList(Array.isArray(json) ? json : json.files)
    return { baseUrl, clips: files.map(file => motionClipDescriptor(file, baseUrl, npzBaseUrl)) }
  } catch (error) {
    if (error?.code === 'FUTURE_SCHEMA_VERSION' || error?.code === 'UNKNOWN_SCHEMA_VERSION') throw error
    return { baseUrl: '/ani', clips: [] }
  }
}

export function normalizeAniMotionIndexEnvelope(input) {
  if (Array.isArray(input)) return input
  if (!input || typeof input !== 'object') throw aniMotionSchemaError('INVALID_ENVELOPE', 'ANI motion index must be an object or legacy array')
  const version = readAniMotionSchemaVersion(input.schemaVersion, 'ANI motion index')
  if (version === ANI_MOTION_HTTP_SCHEMA_VERSION
    && input.format !== ANI_MOTION_INDEX_FORMAT
    && input.format !== ANI_MOTION_MANIFEST_FORMAT) {
    throw aniMotionSchemaError('INVALID_FORMAT', 'ANI motion index has an unsupported format discriminator')
  }
  return input
}

async function tryDirectoryListing(baseUrl) {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/`, { cache: 'no-store' })
    if (!res.ok) return { baseUrl, clips: [] }
    const text = await res.text()
    const files = []
    const re = /href=["']([^"']+\.fbx)["']/gi
    let m = re.exec(text)
    while (m) {
      files.push(decodeURIComponent(m[1].split('/').pop()))
      m = re.exec(text)
    }
    return { baseUrl, clips: sanitizeFileList(files).map(file => motionClipDescriptor(file, baseUrl)) }
  } catch (_) {
    return { baseUrl, clips: [] }
  }
}

function sanitizeFileList(files) {
  const out = []
  const seen = new Set()
  for (const file of Array.isArray(files) ? files : []) {
    const name = String(file || '').split(/[\\/]/).filter(Boolean).join('/')
    const lower = name.toLowerCase()
    if (!name || name.split('/').includes('..')) continue
    if (!lower.endsWith('.fbx') && !lower.endsWith('.npz')) continue
    if (seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out.sort((a, b) => a.localeCompare(b))
}

function sanitizeClipList(clips, urls) {
  const out = []
  const seen = new Set()
  for (const item of Array.isArray(clips) ? clips : []) {
    const descriptor = motionClipDescriptor(item, urls.baseUrl, urls.npzBaseUrl)
    if (!descriptor || seen.has(`${descriptor.format}:${descriptor.file}`)) continue
    seen.add(`${descriptor.format}:${descriptor.file}`)
    out.push(descriptor)
  }
  return out
}

function motionClipDescriptor(item, baseUrl = '/ani', npzBaseUrl = '/api/ani/npz') {
  if (item && typeof item === 'object' && item.schemaVersion !== undefined) {
    readAniMotionSchemaVersion(item.schemaVersion, 'ANI motion clip')
  }
  const rawFile = typeof item === 'string' ? item : item?.file
  const file = String(rawFile || '').split(/[\\/]/).filter(Boolean).join('/')
  if (!file || file.split('/').includes('..')) return null
  const lower = file.toLowerCase()
  if (!lower.endsWith('.fbx') && !lower.endsWith('.npz')) return null
  const format = typeof item === 'object' && item?.format ? String(item.format).toLowerCase() : (lower.endsWith('.npz') ? 'npz' : 'fbx')
  if (format !== 'npz' && format !== 'fbx') return null
  const url = typeof item === 'object' && item?.url
    ? String(item.url)
    : format === 'npz'
      ? `${npzBaseUrl.replace(/\/$/, '')}/${encodePath(file.replace(/^npz\//i, ''))}`
      : `${baseUrl.replace(/\/$/, '')}/${encodePath(file)}`
  return { file, format, url }
}

function prioritizeAniClips(clips) {
  const priority = (clip) => {
    const name = clip.file.toLowerCase()
    const formatBias = clip.format === 'npz' ? -10 : 0
    const n = name.toLowerCase()
    if (n.includes('idle') || n.includes('tpose')) return formatBias + 0
    if (n.includes('walk') || n.includes('run') || n.includes('jog')) return formatBias + 1
    if (n.includes('getup') || n.includes('fall') || n.includes('ground') || n.includes('backdown') || n.includes('facedown')) return formatBias + 2
    if (n.includes('obstacle') || n.includes('jump')) return formatBias + 3
    return formatBias + 4
  }
  return clips.slice().sort((a, b) => priority(a) - priority(b) || a.file.localeCompare(b.file))
}

function normalizeMaxClips(maxClips) {
  if (maxClips === 'all') return Number.MAX_SAFE_INTEGER
  const n = Number(maxClips)
  if (Number.isFinite(n) && n > 0) return Math.floor(n)
  return 96
}

async function readFbxTextResponse(res) {
  const text = await res.text()
  if (!text || text.startsWith('Kaydara FBX Binary')) throw new Error('unsupported FBX payload')
  return text
}

export function createAi4AnimationMotionClipFromJson(json, fileName) {
  if (!json || typeof json !== 'object') throw new Error('invalid AI4AnimationPy motion payload')
  if (json.error) throw new Error(json.detail ? `${json.error}: ${json.detail}` : json.error)
  const schemaVersion = readAniMotionSchemaVersion(json.schemaVersion, 'ANI motion JSON')
  if (schemaVersion === ANI_MOTION_HTTP_SCHEMA_VERSION && json.format !== ANI_MOTION_JSON_FORMAT) {
    throw aniMotionSchemaError('INVALID_FORMAT', 'ANI motion JSON has an unsupported format discriminator')
  }
  const jointNames = normalizeJointNames(json.jointNames || json.boneNames)
  const jointCount = jointNames.length
  const frameCount = Number(json.frameCount)
  if (!Number.isSafeInteger(frameCount) || frameCount < 1) throw aniMotionSchemaError('INVALID_FRAME_COUNT', 'AI4AnimationPy NPZ frameCount must be a positive integer')
  if (jointCount <= 0) throw new Error('AI4AnimationPy NPZ has no bone names')
  const positions = new Float32Array(json.positions || [])
  if (positions.length !== frameCount * jointCount * 3) {
    throw new Error(`AI4AnimationPy NPZ positions length mismatch: ${positions.length} != ${frameCount * jointCount * 3}`)
  }
  if (!positions.every(Number.isFinite)) throw aniMotionSchemaError('NON_FINITE_VALUE', 'AI4AnimationPy NPZ positions must be finite')
  const rotations = json.quaternions ? new Float32Array(json.quaternions) : makeIdentityRotations(frameCount, jointCount)
  if (rotations.length !== frameCount * jointCount * 4 || !rotations.every(Number.isFinite)) {
    throw aniMotionSchemaError('INVALID_QUATERNIONS', 'AI4AnimationPy NPZ quaternions must be finite and match the declared shape')
  }
  const parentIndices = Int16Array.from(Array.isArray(json.parentIndices) ? json.parentIndices : makeParentIndicesFromNames(jointNames, json.parentNames))
  if (parentIndices.length !== jointCount || parentIndices.some((parent, index) => parent < -1 || parent >= jointCount || parent === index)) {
    throw aniMotionSchemaError('INVALID_PARENT_INDICES', 'AI4AnimationPy NPZ parent indices are invalid')
  }
  const fps = Number(json.fps || json.framerate)
  if (!Number.isFinite(fps) || fps <= 0) throw aniMotionSchemaError('INVALID_FRAMERATE', 'AI4AnimationPy NPZ framerate must be finite and positive')
  return {
    name: json.name || fileName || 'ai4animationpy_npz',
    fps,
    frameCount,
    jointNames,
    parentIndices,
    localPositions: positions,
    localRotations: rotations,
    metadata: {
      source: json.source || 'ai4animationpy-npz',
      sourceName: fileName || json.file || json.name,
      schemaVersion,
      sourceSchemaVersion: json.sourceSchemaVersion ?? 1,
    },
    sampleWorld(frameFloat, out = null) {
      return sampleAi4AnimationWorldFrame(this, frameFloat, out)
    },
  }
}

function readAniMotionSchemaVersion(rawVersion, artifact) {
  const version = rawVersion === undefined ? 1 : rawVersion
  if (!Number.isSafeInteger(version) || version < 1) {
    throw aniMotionSchemaError('UNKNOWN_SCHEMA_VERSION', `${artifact} schema version is invalid`)
  }
  if (version > ANI_MOTION_HTTP_SCHEMA_VERSION) {
    throw aniMotionSchemaError('FUTURE_SCHEMA_VERSION', `${artifact} schema version ${version} is newer than supported version ${ANI_MOTION_HTTP_SCHEMA_VERSION}`)
  }
  if (!ANI_MOTION_HTTP_READ_VERSIONS.includes(version)) {
    throw aniMotionSchemaError('UNKNOWN_SCHEMA_VERSION', `${artifact} schema version ${version} is not supported`)
  }
  return version
}

function aniMotionSchemaError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

function normalizeJointNames(names) {
  return Array.isArray(names) ? names.map(name => String(name)) : []
}

function makeParentIndicesFromNames(jointNames, parentNames) {
  const lookup = new Map(jointNames.map((name, index) => [name, index]))
  return jointNames.map((_, index) => {
    const parent = Array.isArray(parentNames) ? String(parentNames[index] ?? '') : ''
    return lookup.has(parent) ? lookup.get(parent) : -1
  })
}

function makeIdentityRotations(frameCount, jointCount) {
  const out = new Float32Array(frameCount * jointCount * 4)
  for (let i = 0; i < frameCount * jointCount; i++) out[i * 4 + 3] = 1
  return out
}

function sampleAi4AnimationWorldFrame(clip, frameFloat, out = null) {
  const joints = clip.jointNames.length
  const target = out || {}
  if (!target.positions || target.positions.length < joints * 3) target.positions = new Float32Array(joints * 3)
  if (!target.rotations || target.rotations.length < joints * 4) target.rotations = new Float32Array(joints * 4)
  const wrapped = wrapFrame(frameFloat, clip.frameCount)
  const f0 = Math.floor(wrapped)
  const f1 = (f0 + 1) % clip.frameCount
  const t = wrapped - f0
  for (let j = 0; j < joints; j++) {
    const p0 = (f0 * joints + j) * 3
    const p1 = (f1 * joints + j) * 3
    const po = j * 3
    target.positions[po] = lerp(clip.localPositions[p0], clip.localPositions[p1], t)
    target.positions[po + 1] = lerp(clip.localPositions[p0 + 1], clip.localPositions[p1 + 1], t)
    target.positions[po + 2] = lerp(clip.localPositions[p0 + 2], clip.localPositions[p1 + 2], t)
    const r0 = (f0 * joints + j) * 4
    const ro = j * 4
    target.rotations[ro] = clip.localRotations[r0]
    target.rotations[ro + 1] = clip.localRotations[r0 + 1]
    target.rotations[ro + 2] = clip.localRotations[r0 + 2]
    target.rotations[ro + 3] = clip.localRotations[r0 + 3]
  }
  return target
}

function createRuntimeMotionClip(clip, fileName) {
  const jointLookup = makeJointLookup(clip.jointNames)
  const jointIndices = new Int16Array(BONE_ORDER.length)
  jointIndices.fill(-1)
  let mapped = 0
  const geno = isGenoStyleSkeleton(clip.jointNames)
  const jointMap = geno ? GENO_DISTAL_JOINTS_BY_BONE : MIXAMO_JOINTS_BY_BONE
  const fallbackMap = geno ? MIXAMO_JOINTS_BY_BONE : null
  for (let i = 0; i < BONE_ORDER.length; i++) {
    const candidates = jointMap[BONE_ORDER[i]] || []
    let idx = findJointIndex(jointLookup, candidates)
    if (idx < 0 && fallbackMap) idx = findJointIndex(jointLookup, fallbackMap[BONE_ORDER[i]] || [])
    jointIndices[i] = idx
    if (idx >= 0) mapped++
  }
  const rootIndex = jointIndices[BONE_ORDER.indexOf('pelvis')]
  if (rootIndex < 0 || mapped < 8) return null
  const runtime = {
    name: fileName || clip.name,
    category: classifyAniMotionFile(fileName || clip.name),
    clip,
    skeletonStyle: geno ? 'geno' : 'mixamo',
    jointIndices,
    rootIndex,
    sourceSpan: 1,
    phaseOffset: hashString(fileName || clip.name) % Math.max(1, clip.frameCount || 1),
    sampleOut: null,
  }
  runtime.sourceSpan = estimateSourceSpan(runtime)
  if (!(runtime.sourceSpan > 0.001)) return null
  return runtime
}

function makeJointLookup(jointNames) {
  const lookup = new Map()
  for (let i = 0; i < jointNames.length; i++) {
    const name = jointNames[i]
    lookup.set(name, i)
    lookup.set(name.toLowerCase(), i)
    lookup.set(name.replace(/^mixamorig:/, ''), i)
    lookup.set(name.replace(/^mixamorig:/, '').toLowerCase(), i)
  }
  return lookup
}

function findJointIndex(lookup, candidates) {
  for (const name of candidates) {
    if (lookup.has(name)) return lookup.get(name)
    const lower = name.toLowerCase()
    if (lookup.has(lower)) return lookup.get(lower)
    const stripped = name.replace(/^mixamorig:/, '')
    if (lookup.has(stripped)) return lookup.get(stripped)
    if (lookup.has(stripped.toLowerCase())) return lookup.get(stripped.toLowerCase())
  }
  return -1
}

function estimateSourceSpan(runtime) {
  const clip = runtime.clip
  const frames = [0, Math.floor((clip.frameCount - 1) * 0.25), Math.floor((clip.frameCount - 1) * 0.5), Math.floor((clip.frameCount - 1) * 0.75), clip.frameCount - 1]
  let span = 0
  for (const frame of frames) {
    const sampled = clip.sampleWorld(frame, runtime.sampleOut || {})
    runtime.sampleOut = sampled
    const p = sampled.positions
    const rootBase = runtime.rootIndex * 3
    const rx = p[rootBase], ry = p[rootBase + 1], rz = p[rootBase + 2]
    for (let i = 0; i < runtime.jointIndices.length; i++) {
      const j = runtime.jointIndices[i]
      if (j < 0) continue
      const base = j * 3
      const dx = p[base] - rx
      const dy = p[base + 1] - ry
      const dz = p[base + 2] - rz
      const d = Math.hypot(dx, dy, dz)
      if (Number.isFinite(d) && d > span) span = d
    }
  }
  return span
}

function classifyAniMotionFile(fileName) {
  const n = String(fileName || '').toLowerCase()
  if (n.includes('idle') || n.includes('tpose')) return 'stand'
  if (n.includes('walk') || n.includes('run') || n.includes('jog')) return 'walk'
  if (n.includes('getup') || n.includes('fall') || n.includes('ground') || n.includes('backdown') || n.includes('facedown')) return 'getup'
  return 'act'
}

function resolvePriorKind(entry, intent) {
  if (entry?.state === 'getup' || entry?.state === 'fallen') return 'getup'
  if (intent?.type === 'walk' || entry?.state === 'locomotion') return 'walk'
  if (intent?.type === 'stand' || entry?.state === 'idle' || entry?.state === 'stumble') return 'stand'
  return 'act'
}

function selectRuntimeClip(list, entry) {
  const t = entry?.stateTimer || 0
  const seed = hashString(entry?.entityId || 'body')
  const idx = Math.abs(seed + Math.floor(t / 4)) % list.length
  return list[idx]
}

function sampleRuntimeMotionTargets(runtime, entry, ragdoll, bonesByName, intent, kind, options) {
  const clip = runtime.clip
  const t = Math.max(0, entry?.stateTimer || 0)
  const speedScale = kind === 'walk' ? clampRange((intent?.desiredSpeed || entry?.navState?.speed || 1) / 1.5, 0.35, 1.8) : 1
  const frame = (t * clip.fps * speedScale + runtime.phaseOffset) % Math.max(1, clip.frameCount)
  const sampled = clip.sampleWorld(frame, runtime.sampleOut || {})
  runtime.sampleOut = sampled
  const pelvis = bonesByName?.pelvis?.particle || ragdoll?.bones?.[0]?.particle
  if (!pelvis) return null
  const yaw = resolveEntryYaw(entry, intent)
  const sideX = Math.cos(yaw)
  const sideZ = -Math.sin(yaw)
  const fwdX = Math.sin(yaw)
  const fwdZ = Math.cos(yaw)
  const targetSpan = Math.max(0.45, (entry?.measurements?.height || 1.8) * 0.58)
  const scale = clampRange(targetSpan / Math.max(0.001, runtime.sourceSpan), 0.001, 3.0)
  const groundY = entry?.anchorPosition?.[1] ?? 0
  const sourcePositions = sampled.positions
  const rootBase = runtime.rootIndex * 3
  const rx = sourcePositions[rootBase]
  const ry = sourcePositions[rootBase + 1]
  const rz = sourcePositions[rootBase + 2]
  const teacher = new Float32Array(ACTION_SIZE)
  const mask = new Uint8Array(BONE_ORDER.length)
  let covered = 0
  for (let i = 0; i < BONE_ORDER.length; i++) {
    const boneName = BONE_ORDER[i]
    if (boneName === 'pelvis') continue
    const sourceIndex = runtime.jointIndices[i]
    const bone = bonesByName?.[boneName]
    const p = bone?.particle
    if (sourceIndex < 0 || !p) continue
    const base = sourceIndex * 3
    const relX = sourcePositions[base] - rx
    const relY = sourcePositions[base + 1] - ry
    const relZ = sourcePositions[base + 2] - rz
    if (!Number.isFinite(relX + relY + relZ)) continue
    let tx = pelvis.x + (sideX * relX + fwdX * relZ) * scale
    let ty = pelvis.y + relY * scale
    let tz = pelvis.z + (sideZ * relX + fwdZ * relZ) * scale
    if (boneName.endsWith('Foot')) ty = Math.max(ty, groundY + 0.05)
    if (boneName.endsWith('Hand') && kind === 'getup') ty = Math.max(ty, groundY + 0.03)
    const out = i * 3
    const rate = options.rate ?? 0.10
    teacher[out] = clampRange((tx - p.x) * rate, -0.18, 0.18)
    teacher[out + 1] = clampRange((ty - p.y) * rate, -0.18, 0.18)
    teacher[out + 2] = clampRange((tz - p.z) * rate, -0.18, 0.18)
    mask[i] = 1
    covered++
  }
  return { teacher, mask, coverage: covered / Math.max(1, BONE_ORDER.length - 1), frame }
}

function resolveEntryYaw(entry, intent) {
  const dx = intent?.targetDirX
  const dz = intent?.targetDirZ
  if (Number.isFinite(dx) && Number.isFinite(dz) && Math.hypot(dx, dz) > 0.01) return Math.atan2(dx, dz)
  return entry?.getupYaw ?? entry?.navState?.facing ?? 0
}

function hashString(value) {
  let h = 0x811c9dc5
  const s = String(value || '')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function wrapFrame(frame, frameCount) {
  if (frameCount <= 1) return 0
  let f = Number.isFinite(frame) ? frame : 0
  f %= frameCount
  if (f < 0) f += frameCount
  return f
}

function encodePath(path) {
  return String(path || '').split('/').map(part => encodeURIComponent(part)).join('/')
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function performanceNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
}
