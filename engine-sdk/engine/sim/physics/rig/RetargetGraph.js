import { lerp } from '../../../core/math/MathScalar.js';

export class RetargetGraph {
  constructor(options = {}) {
    this.animToPhys = new Map();
    this.physToRender = new Map();
    this.defaultWeight = options.defaultWeight ?? 1;
    this.rootMap = options.rootMap || { animation: 'root', physics: 'pelvis', render: 'root' };
    for (const mapping of options.animToPhys || []) this.addAnimationToPhysics(mapping);
    for (const mapping of options.physToRender || []) this.addPhysicsToRender(mapping);
  }

  addAnimationToPhysics(mapping) {
    const source = mapping.source || mapping.animation || mapping.from;
    const target = mapping.target || mapping.physics || mapping.to;
    if (!source || !target) return this;
    this.animToPhys.set(source, normalizeMapping(source, target, mapping, this.defaultWeight));
    return this;
  }

  addPhysicsToRender(mapping) {
    const source = mapping.source || mapping.physics || mapping.from;
    const target = mapping.target || mapping.render || mapping.to;
    if (!source || !target) return this;
    this.physToRender.set(source, normalizeMapping(source, target, mapping, this.defaultWeight));
    return this;
  }

  mapAnimToPhys(animationPose, basePhysicsPose = null) {
    const out = clonePoseBuffer(basePhysicsPose || createEmptyPoseBuffer());
    const sourceJoints = animationPose?.joints || {};
    for (const [sourceId, mapping] of this.animToPhys) {
      const source = sourceJoints[sourceId];
      if (!source) continue;
      const current = out.joints[mapping.target] || createPoseJoint(mapping.target);
      out.joints[mapping.target] = applyMapping(source, current, mapping);
    }
    if (animationPose?.root) out.root = cloneTransform(animationPose.root);
    return out;
  }

  mapPhysToRender(physicsPose, baseRenderPose = null) {
    const out = clonePoseBuffer(baseRenderPose || createEmptyPoseBuffer());
    const sourceJoints = physicsPose?.joints || {};
    for (const [sourceId, mapping] of this.physToRender) {
      const source = sourceJoints[sourceId];
      if (!source) continue;
      const current = out.joints[mapping.target] || createPoseJoint(mapping.target);
      out.joints[mapping.target] = applyMapping(source, current, mapping);
    }
    if (physicsPose?.root) out.root = cloneTransform(physicsPose.root);
    return out;
  }

  static fromJointNames(jointNames = []) {
    const graph = new RetargetGraph();
    for (const name of jointNames) {
      graph.addAnimationToPhysics({ source: name, target: name });
      graph.addPhysicsToRender({ source: name, target: name });
    }
    return graph;
  }
}

export class PoseBlendState {
  constructor(options = {}) {
    this.current = clonePoseBuffer(options.current || createEmptyPoseBuffer());
    this.target = clonePoseBuffer(options.target || this.current);
    this.blendRate = options.blendRate ?? 8;
  }

  setTarget(pose) {
    this.target = clonePoseBuffer(pose || createEmptyPoseBuffer());
  }

  snap(pose) {
    this.current = clonePoseBuffer(pose || createEmptyPoseBuffer());
    this.target = clonePoseBuffer(this.current);
  }

  update(dt) {
    const alpha = 1 - Math.exp(-Math.max(0, dt || 0) * this.blendRate);
    this.current = blendPoseBuffers(this.current, this.target, alpha);
    return this.current;
  }
}

export function createEmptyPoseBuffer() {
  return {
    root: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    joints: {},
  };
}

export function createPoseJoint(id, options = {}) {
  return {
    id,
    position: [...(options.position || [0, 0, 0])],
    rotation: [...(options.rotation || [0, 0, 0, 1])],
    targetPosition: [...(options.targetPosition || options.position || [0, 0, 0])],
    targetRotation: [...(options.targetRotation || options.rotation || [0, 0, 0, 1])],
    targetVelocity: [...(options.targetVelocity || [0, 0, 0])],
    weight: options.weight ?? 1,
  };
}

export function clonePoseBuffer(pose) {
  const out = createEmptyPoseBuffer();
  if (!pose) return out;
  out.root = cloneTransform(pose.root || out.root);
  for (const [id, joint] of Object.entries(pose.joints || {})) {
    out.joints[id] = createPoseJoint(id, joint);
  }
  return out;
}

export function blendPoseBuffers(a, b, t) {
  const alpha = clamp01(t);
  const out = createEmptyPoseBuffer();
  out.root = {
    position: lerpVec(a?.root?.position || [0, 0, 0], b?.root?.position || [0, 0, 0], alpha),
    rotation: normalizeQuat(nlerpQuat(a?.root?.rotation || [0, 0, 0, 1], b?.root?.rotation || [0, 0, 0, 1], alpha)),
  };
  const ids = new Set([...Object.keys(a?.joints || {}), ...Object.keys(b?.joints || {})]);
  for (const id of ids) {
    const ja = a?.joints?.[id] || createPoseJoint(id);
    const jb = b?.joints?.[id] || ja;
    out.joints[id] = {
      id,
      position: lerpVec(ja.position, jb.position, alpha),
      rotation: normalizeQuat(nlerpQuat(ja.rotation, jb.rotation, alpha)),
      targetPosition: lerpVec(ja.targetPosition, jb.targetPosition, alpha),
      targetRotation: normalizeQuat(nlerpQuat(ja.targetRotation, jb.targetRotation, alpha)),
      targetVelocity: lerpVec(ja.targetVelocity, jb.targetVelocity, alpha),
      weight: lerp(ja.weight ?? 1, jb.weight ?? 1, alpha),
    };
  }
  return out;
}

export function poseFromJointArray(joints = []) {
  const pose = createEmptyPoseBuffer();
  for (const joint of joints) {
    const id = joint.id || joint.name;
    if (!id) continue;
    pose.joints[id] = createPoseJoint(id, joint);
  }
  return pose;
}

function normalizeMapping(source, target, mapping, defaultWeight) {
  return {
    source,
    target,
    weight: mapping.weight ?? defaultWeight,
    positionOffset: [...(mapping.positionOffset || [0, 0, 0])],
    rotationOffset: [...(mapping.rotationOffset || [0, 0, 0, 1])],
    mirrorX: Boolean(mapping.mirrorX),
  };
}

function applyMapping(source, current, mapping) {
  const mapped = createPoseJoint(mapping.target, current);
  const sourcePosition = mapping.mirrorX ? [-(source.position?.[0] || 0), source.position?.[1] || 0, source.position?.[2] || 0] : [...(source.position || [0, 0, 0])];
  const sourceTarget = mapping.mirrorX ? [-(source.targetPosition?.[0] || sourcePosition[0]), source.targetPosition?.[1] ?? sourcePosition[1], source.targetPosition?.[2] ?? sourcePosition[2]] : [...(source.targetPosition || sourcePosition)];
  mapped.position = lerpVec(mapped.position, addVec(sourcePosition, mapping.positionOffset), mapping.weight);
  mapped.targetPosition = lerpVec(mapped.targetPosition, addVec(sourceTarget, mapping.positionOffset), mapping.weight);
  mapped.rotation = normalizeQuat(nlerpQuat(mapped.rotation, source.rotation || [0, 0, 0, 1], mapping.weight));
  mapped.targetRotation = normalizeQuat(nlerpQuat(mapped.targetRotation, source.targetRotation || source.rotation || [0, 0, 0, 1], mapping.weight));
  mapped.targetVelocity = lerpVec(mapped.targetVelocity, source.targetVelocity || [0, 0, 0], mapping.weight);
  mapped.weight = Math.max(mapped.weight ?? 0, source.weight ?? mapping.weight);
  return mapped;
}

function cloneTransform(transform) {
  return {
    position: [...(transform?.position || [0, 0, 0])],
    rotation: [...(transform?.rotation || [0, 0, 0, 1])],
  };
}

function addVec(a, b) {
  return [(a?.[0] || 0) + (b?.[0] || 0), (a?.[1] || 0) + (b?.[1] || 0), (a?.[2] || 0) + (b?.[2] || 0)];
}

function lerpVec(a, b, t) {
  return [lerp(a?.[0] || 0, b?.[0] || 0, t), lerp(a?.[1] || 0, b?.[1] || 0, t), lerp(a?.[2] || 0, b?.[2] || 0, t)];
}

function nlerpQuat(a, b, t) {
  const qb = dotQuat(a, b) < 0 ? [-b[0], -b[1], -b[2], -b[3]] : b;
  return [lerp(a?.[0] || 0, qb?.[0] || 0, t), lerp(a?.[1] || 0, qb?.[1] || 0, t), lerp(a?.[2] || 0, qb?.[2] || 0, t), lerp(a?.[3] ?? 1, qb?.[3] ?? 1, t)];
}

function normalizeQuat(q) {
  const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

function dotQuat(a, b) {
  return (a?.[0] || 0) * (b?.[0] || 0) + (a?.[1] || 0) * (b?.[1] || 0) + (a?.[2] || 0) * (b?.[2] || 0) + (a?.[3] ?? 1) * (b?.[3] ?? 1);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}
