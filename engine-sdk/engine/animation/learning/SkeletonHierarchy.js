// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export class SkeletonHierarchy {
  constructor(options = {}) {
    const jointNames = Array.isArray(options.jointNames) ? options.jointNames : []
    const parentSource = options.parentIndices || []
    this.jointNames = jointNames.slice()
    this.parentIndices = parentSource instanceof Int16Array ? new Int16Array(parentSource) : Int16Array.from(parentSource)
    this.nodeIndices = options.nodeIndices instanceof Int32Array ? new Int32Array(options.nodeIndices) : Int32Array.from(options.nodeIndices || jointNames.map((_, i) => i))
    this.localPositions = options.localPositions ? new Float32Array(options.localPositions) : new Float32Array(jointNames.length * 3)
    this.localRotations = options.localRotations ? new Float32Array(options.localRotations) : makeIdentityRotations(jointNames.length)
    this.localScales = options.localScales ? new Float32Array(options.localScales) : makeUnitScales(jointNames.length)
    this.inverseBindMatrices = options.inverseBindMatrices ? new Float32Array(options.inverseBindMatrices) : null
    this.metadata = { ...(options.metadata || {}) }
    this.nameToIndex = new Map()
    for (let i = 0; i < this.jointNames.length; i++) this.nameToIndex.set(this.jointNames[i], i)
    if (this.parentIndices.length !== this.jointNames.length) throw new Error('SkeletonHierarchy: parent index count does not match joint count')
    if (this.localPositions.length !== this.jointNames.length * 3) throw new Error('SkeletonHierarchy: local position count does not match joint count')
    if (this.localRotations.length !== this.jointNames.length * 4) throw new Error('SkeletonHierarchy: local rotation count does not match joint count')
    if (this.localScales.length !== this.jointNames.length * 3) throw new Error('SkeletonHierarchy: local scale count does not match joint count')
  }

  get jointCount() {
    return this.jointNames.length
  }

  getJointIndex(name) {
    return this.nameToIndex.has(name) ? this.nameToIndex.get(name) : -1
  }

  getJointName(index) {
    return this.jointNames[index] || null
  }

  getParentIndex(index) {
    return this.parentIndices[index] ?? -1
  }

  createJointRemap(names) {
    if (!Array.isArray(names)) return new Int16Array(0)
    const out = new Int16Array(names.length)
    for (let i = 0; i < names.length; i++) out[i] = this.getJointIndex(names[i])
    return out
  }

  toJSON() {
    return {
      jointNames: this.jointNames.slice(),
      parentIndices: Array.from(this.parentIndices),
      nodeIndices: Array.from(this.nodeIndices),
      localPositions: Array.from(this.localPositions),
      localRotations: Array.from(this.localRotations),
      localScales: Array.from(this.localScales),
      metadata: { ...this.metadata },
    }
  }

  static fromJSON(data) {
    return new SkeletonHierarchy(data || {})
  }

  static fromModelData(modelData, options = {}) {
    const nodes = Array.isArray(modelData?.nodes) ? modelData.nodes : []
    const skin = options.skin || modelData?.skeleton || null
    const jointNodeIndices = Array.isArray(options.joints) ? options.joints.slice() : Array.from(skin?.joints || [])
    if (jointNodeIndices.length === 0) throw new Error('SkeletonHierarchy: model has no skin joints')
    return buildHierarchyFromNodes(nodes, jointNodeIndices, options)
  }

  static fromGltf(gltf, options = {}) {
    const nodes = Array.isArray(gltf?.nodes) ? gltf.nodes : []
    const skinIndex = Number.isInteger(options.skinIndex) ? options.skinIndex : 0
    const skin = options.skin || gltf?.skins?.[skinIndex] || null
    const jointNodeIndices = Array.from(options.joints || skin?.joints || [])
    if (jointNodeIndices.length === 0) throw new Error('SkeletonHierarchy: glTF has no skin joints')
    return buildHierarchyFromNodes(nodes, jointNodeIndices, { ...options, skinIndex })
  }
}

function buildHierarchyFromNodes(nodes, jointNodeIndices, options = {}) {
  const jointNodeToJoint = new Map()
  for (let i = 0; i < jointNodeIndices.length; i++) jointNodeToJoint.set(jointNodeIndices[i], i)
  const parentNodeOf = new Map()
  for (let i = 0; i < nodes.length; i++) {
    const children = Array.isArray(nodes[i]?.children) ? nodes[i].children : []
    for (const child of children) parentNodeOf.set(child, i)
  }
  const jointNames = []
  const parentIndices = new Int16Array(jointNodeIndices.length)
  const nodeIndices = new Int32Array(jointNodeIndices.length)
  const localPositions = new Float32Array(jointNodeIndices.length * 3)
  const localRotations = makeIdentityRotations(jointNodeIndices.length)
  const localScales = makeUnitScales(jointNodeIndices.length)
  for (let i = 0; i < jointNodeIndices.length; i++) {
    const nodeIndex = jointNodeIndices[i]
    const node = nodes[nodeIndex] || {}
    nodeIndices[i] = nodeIndex
    jointNames.push(node.name || `Joint_${i}`)
    let parentNode = parentNodeOf.get(nodeIndex)
    let parentJoint = -1
    while (parentNode !== undefined && parentNode !== null) {
      if (jointNodeToJoint.has(parentNode)) {
        parentJoint = jointNodeToJoint.get(parentNode)
        break
      }
      parentNode = parentNodeOf.get(parentNode)
    }
    parentIndices[i] = parentJoint
    const t = Array.isArray(node.translation) ? node.translation : [0, 0, 0]
    const r = Array.isArray(node.rotation) ? node.rotation : [0, 0, 0, 1]
    const s = Array.isArray(node.scale) ? node.scale : [1, 1, 1]
    localPositions[i * 3 + 0] = Number(t[0]) || 0
    localPositions[i * 3 + 1] = Number(t[1]) || 0
    localPositions[i * 3 + 2] = Number(t[2]) || 0
    localRotations[i * 4 + 0] = Number(r[0]) || 0
    localRotations[i * 4 + 1] = Number(r[1]) || 0
    localRotations[i * 4 + 2] = Number(r[2]) || 0
    localRotations[i * 4 + 3] = Number.isFinite(Number(r[3])) ? Number(r[3]) : 1
    localScales[i * 3 + 0] = Number.isFinite(Number(s[0])) ? Number(s[0]) : 1
    localScales[i * 3 + 1] = Number.isFinite(Number(s[1])) ? Number(s[1]) : 1
    localScales[i * 3 + 2] = Number.isFinite(Number(s[2])) ? Number(s[2]) : 1
  }
  return new SkeletonHierarchy({
    jointNames,
    parentIndices,
    nodeIndices,
    localPositions,
    localRotations,
    localScales,
    inverseBindMatrices: options.inverseBindMatrices || null,
    metadata: {
      source: options.source || 'gltf',
      skinIndex: options.skinIndex ?? 0,
      ...(options.metadata || {}),
    },
  })
}

function makeIdentityRotations(count) {
  const out = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) out[i * 4 + 3] = 1
  return out
}

function makeUnitScales(count) {
  const out = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    out[i * 3 + 0] = 1
    out[i * 3 + 1] = 1
    out[i * 3 + 2] = 1
  }
  return out
}

export default SkeletonHierarchy
