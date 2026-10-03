import { createDriveAxis, getJointTorqueBudget, inferJointDriveType } from './ActiveRigSchema.js';

export const MUSCLE_GROUPS = {
  trunk: ['pelvis', 'spine', 'chest'],
  neck: ['neck', 'head'],
  leftArm: ['leftShoulder', 'leftUpperArm', 'leftForearm', 'leftHand', 'shoulder_l', 'elbow_l', 'wrist_l', 'hand_l'],
  rightArm: ['rightShoulder', 'rightUpperArm', 'rightForearm', 'rightHand', 'shoulder_r', 'elbow_r', 'wrist_r', 'hand_r'],
  leftLeg: ['leftThigh', 'leftShin', 'leftFoot', 'hip_l', 'knee_l', 'ankle_l', 'foot_l'],
  rightLeg: ['rightThigh', 'rightShin', 'rightFoot', 'hip_r', 'knee_r', 'ankle_r', 'foot_r'],
  hands: ['leftHand', 'rightHand', 'hand_l', 'hand_r'],
};

export class MuscleLayer {
  constructor(options = {}) {
    this.massKg = options.massKg ?? 80;
    this.preset = options.preset || 'HumanAverage';
    this.baseActivation = options.baseActivation ?? 0.75;
    this.activations = {
      trunk: this.baseActivation,
      neck: this.baseActivation,
      leftArm: this.baseActivation,
      rightArm: this.baseActivation,
      leftLeg: this.baseActivation,
      rightLeg: this.baseActivation,
      hands: this.baseActivation,
      ...(options.activations || {}),
    };
  }

  setActivation(group, value) {
    if (!MUSCLE_GROUPS[group]) return false;
    this.activations[group] = clamp01(value);
    return true;
  }

  applyIntent(intent = {}) {
    const brace = clamp01(intent.brace ?? 0);
    const attack = clamp01(intent.attack ?? 0);
    const gripL = clamp01(intent.grip_l ?? intent.gripL ?? 0);
    const gripR = clamp01(intent.grip_r ?? intent.gripR ?? 0);
    const knockout = clamp01(intent.knockout ?? 0);
    const limpScale = 1 - knockout * 0.92;
    this.activations.trunk = clamp01((this.baseActivation + brace * 0.25) * limpScale);
    this.activations.neck = clamp01((this.baseActivation + brace * 0.12) * limpScale);
    this.activations.leftArm = clamp01((this.baseActivation + attack * 0.22 + brace * 0.12) * limpScale);
    this.activations.rightArm = clamp01((this.baseActivation + attack * 0.22 + brace * 0.12) * limpScale);
    this.activations.leftLeg = clamp01((this.baseActivation + brace * 0.18) * limpScale);
    this.activations.rightLeg = clamp01((this.baseActivation + brace * 0.18) * limpScale);
    this.activations.hands = clamp01((this.baseActivation + Math.max(gripL, gripR) * 0.25) * limpScale);
    return { ...this.activations };
  }

  modulateDrives(drives = {}, intent = {}) {
    this.applyIntent(intent);
    const out = {};
    for (const [jointId, jointDrives] of Object.entries(drives)) {
      const activation = this.getJointActivation(jointId);
      const intentScale = getIntentScale(jointId, intent);
      out[jointId] = {};
      for (const [axisName, axis] of Object.entries(jointDrives || {})) {
        const maxForce = axis.maxForce || axis.forceLimit || getJointTorqueBudget(inferJointDriveType(jointId), this.massKg, this.preset);
        out[jointId][axisName] = createDriveAxis({
          ...axis,
          stiffness: (axis.stiffness || 0) * (0.25 + activation * 0.75) * intentScale,
          damping: (axis.damping || 0) * (0.45 + activation * 0.55),
          maxForce: maxForce * (0.1 + activation * 0.9) * intentScale,
        });
      }
    }
    return out;
  }

  getJointActivation(jointId) {
    let activation = this.baseActivation;
    for (const [group, joints] of Object.entries(MUSCLE_GROUPS)) {
      if (joints.includes(jointId)) activation = Math.max(activation, this.activations[group] ?? 0);
    }
    return clamp01(activation);
  }
}

function getIntentScale(jointId, intent) {
  const id = String(jointId).toLowerCase();
  const attack = clamp01(intent.attack ?? 0);
  const brace = clamp01(intent.brace ?? 0);
  const getUp = clamp01(intent.get_up ?? intent.getUp ?? 0);
  if (attack > 0 && (id.includes('shoulder') || id.includes('elbow') || id.includes('hand') || id.includes('wrist'))) return 1 + attack * 0.75;
  if (getUp > 0 && (id.includes('hip') || id.includes('knee') || id.includes('foot') || id.includes('pelvis'))) return 1 + getUp * 0.65;
  if (brace > 0) return 1 + brace * 0.35;
  return 1;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}
