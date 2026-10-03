import { blendPoseBuffers, clonePoseBuffer } from './RetargetGraph.js';

export const DEFAULT_POSE_STATES = {
  idle_stand: {
    id: 'idle_stand',
    blendTime: 0.18,
    strengthScale: 1,
    dampingScale: 1.0,
    stiffnessScale: 1.0,
    blendMode: 'linear',
    offsets: {},
  },
  guard: {
    id: 'guard',
    blendTime: 0.12,
    strengthScale: 1.05,
    dampingScale: 1.1,
    stiffnessScale: 1.05,
    blendMode: 'additive',
    offsets: {},
  },
  brace: {
    id: 'brace',
    blendTime: 0.08,
    strengthScale: 1.25,
    dampingScale: 1.35,
    stiffnessScale: 1.2,
    blendMode: 'override',
    offsets: {},
  },
  attack: {
    id: 'attack',
    blendTime: 0.10,
    strengthScale: 1.15,
    dampingScale: 0.9,
    stiffnessScale: 1.1,
    blendMode: 'additive',
    offsets: {},
  },
  recover: {
    id: 'recover',
    blendTime: 0.2,
    strengthScale: 1.1,
    dampingScale: 1.2,
    stiffnessScale: 1.1,
    blendMode: 'linear',
    offsets: {},
  },
  getup: {
    id: 'getup',
    blendTime: 0.18,
    strengthScale: 1.2,
    dampingScale: 1.15,
    stiffnessScale: 1.15,
    blendMode: 'override',
    offsets: {},
  },
};

export class PoseStateGraph {
  constructor(options = {}) {
    this.states = new Map();
    this.currentStateId = options.initialState || 'idle_stand';
    this.previousStateId = this.currentStateId;
    this.transitionTime = 0;
    this.transitionDuration = 0.18;
    this.lastOutputMeta = { strengthScale: 1, dampingScale: 1, stiffnessScale: 1, blendMode: 'linear', state: this.currentStateId };
    const states = options.states || DEFAULT_POSE_STATES;
    for (const state of Object.values(states)) this.addState(state);
  }

  addState(state) {
    if (!state?.id) return this;
    this.states.set(state.id, normalizePoseState(state));
    return this;
  }

  setState(stateId) {
    if (!stateId || stateId === this.currentStateId || !this.states.has(stateId)) return false;
    this.previousStateId = this.currentStateId;
    this.currentStateId = stateId;
    this.transitionTime = 0;
    this.transitionDuration = this.states.get(stateId)?.blendTime ?? 0.18;
    return true;
  }

  update(dt, basePose, intent = {}) {
    const requested = resolveRequestedPoseState(intent, this.currentStateId);
    this.setState(requested);
    this.transitionTime += Math.max(0, dt || 0);
    const alpha = this.transitionDuration > 0 ? clamp01(this.transitionTime / this.transitionDuration) : 1;
    const previous = this.applyState(basePose, this.previousStateId);
    const current = this.applyState(basePose, this.currentStateId);
    const output = blendPoseBuffers(previous, current, smoothstep(alpha));
    const currentState = this.states.get(this.currentStateId);
    this.lastOutputMeta = {
      state: this.currentStateId,
      strengthScale: currentState?.strengthScale ?? 1,
      dampingScale: currentState?.dampingScale ?? 1,
      stiffnessScale: currentState?.stiffnessScale ?? 1,
      blendMode: currentState?.blendMode ?? 'linear',
    };
    return output;
  }

  applyState(basePose, stateId) {
    const out = clonePoseBuffer(basePose);
    const state = this.states.get(stateId) || this.states.get('idle_stand');
    if (!state) return out;
    for (const [jointId, offset] of Object.entries(state.offsets)) {
      const joint = out.joints[jointId];
      if (!joint) continue;
      const position = offset.position || [0, 0, 0];
      joint.targetPosition = [
        (joint.position?.[0] || 0) + position[0],
        (joint.position?.[1] || 0) + position[1],
        (joint.position?.[2] || 0) + position[2],
      ];
      if (offset.rotation) joint.targetRotation = [...offset.rotation];
      if (offset.weight !== undefined) joint.weight = offset.weight;
    }
    return out;
  }

  getMeta() {
    return { ...this.lastOutputMeta };
  }
}

export function createPoseStateGraph(options = {}) {
  return new PoseStateGraph(options);
}

export function resolveRequestedPoseState(intent = {}, fallback = 'idle_stand') {
  if (intent.poseState && DEFAULT_POSE_STATES[intent.poseState]) return intent.poseState;
  if ((intent.get_up ?? 0) > 0.2) return 'getup';
  if ((intent.recover ?? 0) > 0.2) return 'recover';
  if ((intent.attack ?? 0) > 0.2) return 'attack';
  if ((intent.brace ?? 0) > 0.2) return 'brace';
  if ((intent.guard ?? 0) > 0.2) return 'guard';
  return DEFAULT_POSE_STATES[fallback] ? fallback : 'idle_stand';
}

function normalizePoseState(state) {
  return {
    id: state.id,
    blendTime: state.blendTime ?? 0.18,
    strengthScale: state.strengthScale ?? 1,
    dampingScale: state.dampingScale ?? 1,
    stiffnessScale: state.stiffnessScale ?? 1,
    blendMode: state.blendMode ?? 'linear',
    offsets: state.offsets || {},
  };
}

function smoothstep(t) {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}
