import { ACTIVE_RIG_STATES } from './ActiveRigSchema.js';

export class BalanceController {
  constructor(options = {}) {
    this.config = {
      pelvisJoint: options.pelvisJoint || 'pelvis',
      chestJoint: options.chestJoint || 'chest',
      footJoints: options.footJoints || ['leftFoot', 'rightFoot', 'foot_l', 'foot_r'],
      supportRadius: options.supportRadius ?? 0.18,
      stumbleThreshold: options.stumbleThreshold ?? 0.28,
      fallThreshold: options.fallThreshold ?? 0.58,
      recoveryRate: options.recoveryRate ?? 1.8,
    };
    this.state = {
      balanceError: 0,
      supportCenter: [0, 0, 0],
      centerOfMass: [0, 0, 0],
      correction: [0, 0, 0],
      groundedFeet: 0,
      state: ACTIVE_RIG_STATES.active,
    };
  }

  update(physicsPose, dt = 1 / 60, intent = {}) {
    const joints = physicsPose?.joints || {};
    const feet = this.config.footJoints.map(id => joints[id]).filter(Boolean);
    const supportCenter = averagePositions(feet.map(foot => foot.position));
    const centerOfMass = estimateCenterOfMass(joints, physicsPose?.root?.position || [0, 0, 0]);
    const dx = centerOfMass[0] - supportCenter[0];
    const dz = centerOfMass[2] - supportCenter[2];
    const horizontalError = Math.hypot(dx, dz);
    const radius = Math.max(0.001, this.config.supportRadius + Math.max(0, feet.length - 1) * 0.05);
    const normalizedError = horizontalError / radius;
    const balancePriority = intent.balance ?? 1;
    const recovery = Math.max(0, dt) * this.config.recoveryRate * balancePriority;
    this.state.balanceError = Math.max(0, this.state.balanceError + (normalizedError - this.state.balanceError) * Math.min(1, recovery));
    this.state.supportCenter = supportCenter;
    this.state.centerOfMass = centerOfMass;
    this.state.groundedFeet = feet.length;
    this.state.correction = horizontalError > 0.0001 ? [-dx / horizontalError * this.state.balanceError, 0, -dz / horizontalError * this.state.balanceError] : [0, 0, 0];
    this.state.state = this.resolveState(intent);
    return { ...this.state, correction: [...this.state.correction], supportCenter: [...supportCenter], centerOfMass: [...centerOfMass] };
  }

  applyToPose(targetPose, balanceState = this.state, weight = 1) {
    const out = clonePoseLike(targetPose);
    const amount = Math.max(0, weight) * Math.min(1.5, balanceState.balanceError || 0);
    const pelvis = out.joints[this.config.pelvisJoint];
    const chest = out.joints[this.config.chestJoint];
    if (pelvis) {
      pelvis.targetPosition[0] += balanceState.correction[0] * amount * 0.08;
      pelvis.targetPosition[2] += balanceState.correction[2] * amount * 0.08;
    }
    if (chest) {
      chest.targetPosition[0] += balanceState.correction[0] * amount * 0.14;
      chest.targetPosition[2] += balanceState.correction[2] * amount * 0.14;
    }
    return out;
  }

  resolveState(intent = {}) {
    if (intent.knockout > 0.5) return ACTIVE_RIG_STATES.knockedOut;
    if (this.state.groundedFeet === 0 || this.state.balanceError > this.config.fallThreshold) return ACTIVE_RIG_STATES.fallen;
    if (this.state.balanceError > this.config.stumbleThreshold) return ACTIVE_RIG_STATES.stumbling;
    if (intent.get_up > 0.2) return ACTIVE_RIG_STATES.recovering;
    return ACTIVE_RIG_STATES.active;
  }
}

export function estimateCenterOfMass(joints = {}, fallback = [0, 0, 0]) {
  const weights = {
    pelvis: 0.142,
    spine: 0.139,
    chest: 0.216,
    head: 0.081,
    leftUpperArm: 0.028,
    rightUpperArm: 0.028,
    leftForearm: 0.016,
    rightForearm: 0.016,
    leftHand: 0.006,
    rightHand: 0.006,
    leftThigh: 0.100,
    rightThigh: 0.100,
    leftShin: 0.0465,
    rightShin: 0.0465,
    leftFoot: 0.0145,
    rightFoot: 0.0145,
    thigh_l: 0.100,
    thigh_r: 0.100,
    calf_l: 0.0465,
    calf_r: 0.0465,
    foot_l: 0.0145,
    foot_r: 0.0145,
  };
  let total = 0;
  const sum = [0, 0, 0];
  for (const [id, joint] of Object.entries(joints)) {
    const weight = weights[id] ?? 0.02;
    const p = joint.position || joint.targetPosition || fallback;
    sum[0] += p[0] * weight;
    sum[1] += p[1] * weight;
    sum[2] += p[2] * weight;
    total += weight;
  }
  if (total <= 0) return [...fallback];
  return [sum[0] / total, sum[1] / total, sum[2] / total];
}

function averagePositions(positions) {
  if (!positions.length) return [0, 0, 0];
  const sum = [0, 0, 0];
  for (const p of positions) {
    sum[0] += p[0];
    sum[1] += p[1];
    sum[2] += p[2];
  }
  return [sum[0] / positions.length, sum[1] / positions.length, sum[2] / positions.length];
}

function clonePoseLike(pose) {
  const out = {
    root: { position: [...(pose?.root?.position || [0, 0, 0])], rotation: [...(pose?.root?.rotation || [0, 0, 0, 1])] },
    joints: {},
  };
  for (const [id, joint] of Object.entries(pose?.joints || {})) {
    out.joints[id] = {
      ...joint,
      position: [...(joint.position || [0, 0, 0])],
      rotation: [...(joint.rotation || [0, 0, 0, 1])],
      targetPosition: [...(joint.targetPosition || joint.position || [0, 0, 0])],
      targetRotation: [...(joint.targetRotation || joint.rotation || [0, 0, 0, 1])],
      targetVelocity: [...(joint.targetVelocity || [0, 0, 0])],
    };
  }
  return out;
}
