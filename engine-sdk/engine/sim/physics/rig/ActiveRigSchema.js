export const ACTIVE_RIG_BACKENDS = {
  articulation: 'articulation',
  d6: 'd6',
  pbd: 'pbd',
  none: 'none', // no physics backend at all — pose-driven/kinematic-only fallback
};

export const ACTIVE_RIG_STATES = {
  inactive: 'inactive',
  kinematic: 'kinematic',
  active: 'active',
  stumbling: 'stumbling',
  fallen: 'fallen',
  recovering: 'recovering',
  knockedOut: 'knocked_out',
};

export const DRIVE_MODES = {
  acceleration: 'acceleration',
  force: 'force',
  none: 'none',
};

export const POSE_BLEND_MODES = {
  linear: 'linear',
  additive: 'additive',
  override: 'override',
};

export const ACTIVE_RIG_AXES = ['eTWIST', 'eSWING1', 'eSWING2', 'eX', 'eY', 'eZ'];

export const HUMAN_MASS_FRACTIONS = {
  headNeck: 0.081,
  thorax: 0.216,
  abdomen: 0.139,
  pelvis: 0.142,
  upperArm: 0.028,
  forearm: 0.016,
  hand: 0.006,
  thigh: 0.100,
  shank: 0.0465,
  foot: 0.0145,
};

export const HUMAN_JOINT_TORQUE_NM_PER_KG = {
  neck: { min: 0.12, avg: 0.22, max: 0.40 },
  shoulder: { min: 0.35, avg: 0.75, max: 1.40 },
  elbow: { min: 0.25, avg: 0.55, max: 1.00 },
  wrist: { min: 0.08, avg: 0.18, max: 0.40 },
  spineLower: { min: 0.50, avg: 1.20, max: 2.50 },
  spineUpper: { min: 0.35, avg: 0.90, max: 1.80 },
  pelvis: { min: 0.60, avg: 1.40, max: 3.00 },
  hip: { min: 0.80, avg: 1.80, max: 3.50 },
  knee: { min: 0.70, avg: 1.60, max: 3.00 },
  ankle: { min: 0.25, avg: 0.70, max: 1.50 },
  toe: { min: 0.03, avg: 0.08, max: 0.18 },
  finger: { min: 0.005, avg: 0.015, max: 0.040 },
};

export const ACTIVE_RIG_PRESETS = {
  HumanWeak: { strengthScale: 0.70, dampingScale: 1.08, stiffnessScale: 0.82 },
  HumanAverage: { strengthScale: 1.00, dampingScale: 1.00, stiffnessScale: 1.00 },
  HumanAthletic: { strengthScale: 1.35, dampingScale: 0.95, stiffnessScale: 1.16 },
  RobotSmall: { strengthScale: 0.85, dampingScale: 1.20, stiffnessScale: 1.35, torqueCap: 23.7 },
  RobotMedium: { strengthScale: 1.40, dampingScale: 1.10, stiffnessScale: 1.55 },
  RobotHeavy: { strengthScale: 2.50, dampingScale: 1.30, stiffnessScale: 2.00 },
  Boss: { strengthScale: 4.00, dampingScale: 1.15, stiffnessScale: 2.35 },
};

export const DEFAULT_ACTIVE_RIG_CONFIG = {
  backend: ACTIVE_RIG_BACKENDS.articulation,
  state: ACTIVE_RIG_STATES.active,
  preset: 'HumanAverage',
  massKg: 80,
  driveMode: DRIVE_MODES.acceleration,
  frequencyHz: 4.5,
  dampingRatio: 1.0,
  solver: {
    positionIterations: 16,
    velocityIterations: 4,
    selfCollision: true,
    disableParentChildCollisions: true,
  },
  balance: {
    enabled: true,
    pelvisJoint: 'pelvis',
    chestJoint: 'chest',
    footJoints: ['leftFoot', 'rightFoot', 'foot_l', 'foot_r'],
    supportRadius: 0.18,
    stumbleThreshold: 0.28,
    fallThreshold: 0.58,
  },
};

export function createDriveAxis(options = {}) {
  return {
    driveMode: options.driveMode || DRIVE_MODES.acceleration,
    stiffness: options.stiffness ?? 0,
    damping: options.damping ?? 0,
    maxForce: options.maxForce ?? options.forceLimit ?? 0,
    targetPosition: options.targetPosition ?? 0,
    targetVelocity: options.targetVelocity ?? 0,
    armature: options.armature ?? 0,
  };
}

export function frequencyToDrive({ frequencyHz = 4.5, dampingRatio = 1.0, effectiveMass = 1, mode = DRIVE_MODES.acceleration } = {}) {
  const omega = Math.max(0, frequencyHz) * Math.PI * 2;
  if (mode === DRIVE_MODES.force) {
    return {
      stiffness: effectiveMass * omega * omega,
      damping: 2 * dampingRatio * effectiveMass * omega,
    };
  }
  return {
    stiffness: omega * omega,
    damping: 2 * dampingRatio * omega,
  };
}

export function getJointTorqueBudget(jointType, massKg = 80, presetName = 'HumanAverage', tier = 'avg') {
  const baseline = HUMAN_JOINT_TORQUE_NM_PER_KG[jointType] || HUMAN_JOINT_TORQUE_NM_PER_KG.shoulder;
  const preset = ACTIVE_RIG_PRESETS[presetName] || ACTIVE_RIG_PRESETS.HumanAverage;
  const raw = massKg * (baseline[tier] ?? baseline.avg) * preset.strengthScale;
  return preset.torqueCap ? Math.min(raw, preset.torqueCap) : raw;
}

export function createDriveProfile({ joints = [], massKg = 80, preset = 'HumanAverage', frequencyHz = 4.5, dampingRatio = 1.0, driveMode = DRIVE_MODES.acceleration } = {}) {
  const presetDef = ACTIVE_RIG_PRESETS[preset] || ACTIVE_RIG_PRESETS.HumanAverage;
  const drives = {};
  for (const joint of joints) {
    const jointType = joint.driveType || inferJointDriveType(joint.id || joint.name || joint.type);
    const torque = getJointTorqueBudget(jointType, massKg, preset);
    const base = frequencyToDrive({ frequencyHz, dampingRatio, effectiveMass: Math.max(0.001, joint.effectiveMass || 1), mode: driveMode });
    drives[joint.id || joint.name] = {
      eTWIST: createDriveAxis({ driveMode, stiffness: base.stiffness * presetDef.stiffnessScale, damping: base.damping * presetDef.dampingScale, maxForce: torque }),
      eSWING1: createDriveAxis({ driveMode, stiffness: base.stiffness * presetDef.stiffnessScale, damping: base.damping * presetDef.dampingScale, maxForce: torque }),
      eSWING2: createDriveAxis({ driveMode, stiffness: base.stiffness * presetDef.stiffnessScale, damping: base.damping * presetDef.dampingScale, maxForce: torque }),
    };
  }
  return drives;
}

export function createPoseBufferFromRig(rig = {}) {
  const joints = {};
  const source = rig.parts?.length ? rig.parts : rig.links?.length ? rig.links : rig.bodies?.length ? rig.bodies : rig.joints || [];
  for (const joint of source) {
    const id = joint.id || joint.name;
    if (!id) continue;
    joints[id] = {
      id,
      position: [...(joint.position || [0, 0, 0])],
      rotation: [...(joint.rotation || [0, 0, 0, 1])],
      targetPosition: [...(joint.targetPosition || joint.position || [0, 0, 0])],
      targetRotation: [...(joint.targetRotation || joint.rotation || [0, 0, 0, 1])],
      targetVelocity: [...(joint.targetVelocity || [0, 0, 0])],
      weight: joint.weight ?? 1,
    };
  }
  return {
    root: {
      position: [...(rig.root?.position || [0, 0, 0])],
      rotation: [...(rig.root?.rotation || [0, 0, 0, 1])],
    },
    joints,
  };
}

export function createActiveRigConfig(options = {}) {
  return {
    ...DEFAULT_ACTIVE_RIG_CONFIG,
    ...options,
    solver: { ...DEFAULT_ACTIVE_RIG_CONFIG.solver, ...(options.solver || {}) },
    balance: { ...DEFAULT_ACTIVE_RIG_CONFIG.balance, ...(options.balance || {}) },
  };
}

export function inferJointDriveType(name = '') {
  const id = String(name).toLowerCase();
  if (id.includes('neck') || id.includes('head')) return 'neck';
  if (id.includes('shoulder')) return 'shoulder';
  if (id.includes('elbow')) return 'elbow';
  if (id.includes('wrist') || id.includes('hand')) return 'wrist';
  if (id.includes('spine') || id.includes('chest')) return 'spineUpper';
  if (id.includes('pelvis') || id.includes('root')) return 'pelvis';
  if (id.includes('hip') || id.includes('thigh')) return 'hip';
  if (id.includes('knee') || id.includes('shin')) return 'knee';
  if (id.includes('ankle') || id.includes('foot')) return 'ankle';
  if (id.includes('toe')) return 'toe';
  if (id.includes('finger')) return 'finger';
  return 'shoulder';
}
