import { ACTIVE_RIG_BACKENDS, createActiveRigConfig, createDriveProfile, createPoseBufferFromRig } from './ActiveRigSchema.js';
import { RetargetGraph } from './RetargetGraph.js';

export function createActiveRigFromStickman(stickman = {}, options = {}) {
  const bodies = Array.isArray(stickman.bodies) ? stickman.bodies : [];
  const joints = Array.isArray(stickman.joints) ? stickman.joints : [];
  const jointsByChild = new Map(joints.map((joint, index) => [joint.child, { ...joint, index }]));
  const parts = bodies.map((body, index) => createPartFromBody(body, index, jointsByChild.get(index), options));
  const rigJoints = joints.map((joint, index) => createJointFromStickmanJoint(joint, index, bodies, options));
  const backend = options.backend || stickman.activeRig?.backend || ACTIVE_RIG_BACKENDS.articulation;
  const rig = {
    id: options.id || stickman.id || 'stickman_active_rig',
    name: options.name || stickman.name || 'Stickman Active Rig',
    backend,
    root: createRootFromBodies(bodies, options),
    parts,
    joints: rigJoints,
    bodies: parts,
    bonePairs: clonePairs(stickman.bonePairs),
    pose: createPoseBufferFromRig({ parts }),
    retarget: createStickmanRetargetGraph(bodies),
  };
  rig.driveProfile = createDriveProfile({
    joints: parts,
    massKg: options.massKg ?? stickman.activeRig?.massKg ?? 80,
    preset: options.preset || stickman.activeRig?.preset || 'HumanAverage',
    frequencyHz: options.frequencyHz ?? stickman.activeRig?.frequencyHz ?? 4.5,
    dampingRatio: options.dampingRatio ?? stickman.activeRig?.dampingRatio ?? 1,
    driveMode: options.driveMode || stickman.activeRig?.driveMode || 'acceleration',
  });
  return rig;
}

export function createActiveRigControllerOptionsFromStickman(stickman = {}, options = {}) {
  const rig = createActiveRigFromStickman(stickman, options);
  return {
    rig,
    retargetGraph: rig.retarget,
    initialPoseState: options.initialPoseState || stickman.activeRig?.poseState || 'idle_stand',
    config: createActiveRigConfig({
      backend: rig.backend,
      preset: options.preset || stickman.activeRig?.preset || 'HumanAverage',
      massKg: options.massKg ?? stickman.activeRig?.massKg ?? 80,
      frequencyHz: options.frequencyHz ?? stickman.activeRig?.frequencyHz ?? 4.5,
      dampingRatio: options.dampingRatio ?? stickman.activeRig?.dampingRatio ?? 1,
      driveMode: options.driveMode || stickman.activeRig?.driveMode || 'acceleration',
      poseState: options.initialPoseState || stickman.activeRig?.poseState || 'idle_stand',
      solver: {
        selfCollision: stickman.activeRig?.selfCollision ?? true,
        disableParentChildCollisions: stickman.activeRig?.disableParentChildCollisions ?? true,
      },
    }),
  };
}

export function createStickmanRetargetGraph(bodies = []) {
  const graph = new RetargetGraph();
  for (const body of bodies) {
    const name = body.name || body.id;
    if (!name) continue;
    graph.addAnimationToPhysics({ source: name, target: name });
    graph.addPhysicsToRender({ source: name, target: name });
  }
  return graph;
}

function createPartFromBody(body, index, joint, options) {
  const name = body.name || body.id || `body_${index}`;
  const parent = body.parent ?? joint?.parent ?? -1;
  return {
    id: name,
    name,
    index,
    parentId: parent,
    position: addVec3(body.position || [0, 0, 0], options.rootPosition || [0, 0, 0]),
    rotation: [...(body.rotation || [0, 0, 0, 1])],
    radius: body.radius ?? 0.05,
    length: body.length ?? 0.2,
    shape: {
      type: 'capsule',
      radius: body.radius ?? 0.05,
      halfHeight: Math.max(0.02, (body.length ?? 0.2) * 0.5),
    },
    geometry: {
      type: 'capsule',
      radius: body.radius ?? 0.05,
      halfHeight: Math.max(0.02, (body.length ?? 0.2) * 0.5),
    },
    density: body.density ?? options.density ?? 1,
    driveType: inferBodyDriveType(name),
    joint: createJointOptions(joint, name),
  };
}

function createJointFromStickmanJoint(joint, index, bodies, options) {
  const childBody = bodies[joint.child] || {};
  const parentBody = bodies[joint.parent] || {};
  const childName = childBody.name || childBody.id || `body_${joint.child}`;
  const parentName = parentBody.name || parentBody.id || `body_${joint.parent}`;
  return {
    id: joint.id || `${parentName}_${childName}`,
    name: joint.name || `${parentName}_${childName}`,
    parent: parentName,
    child: childName,
    type: joint.type === 'hinge' ? 'revolute' : 'spherical',
    jointType: joint.type || 'ball',
    index,
    driveType: inferBodyDriveType(childName),
    frameA: joint.frameA || { position: joint.anchorA || [0, 0, 0], rotation: joint.rotationA || [0, 0, 0, 1] },
    frameB: joint.frameB || { position: joint.anchorB || [0, 0, 0], rotation: joint.rotationB || [0, 0, 0, 1] },
    motion: joint.motion || createD6Motion(joint),
    enableCollision: options.enableJointCollision ?? false,
  };
}

function createJointOptions(joint, childName) {
  if (!joint) return null;
  return {
    type: joint.type === 'hinge' ? 'revolute' : 'spherical',
    parentAnchor: joint.anchorA || [0, 0, 0],
    childAnchor: joint.anchorB || [0, 0, 0],
    limits: joint.limits || createDefaultLimits(joint, childName),
  };
}

function createD6Motion(joint) {
  if (joint.type === 'hinge') return { x: 'locked', y: 'locked', z: 'locked', twist: 'limited', swingY: 'locked', swingZ: 'locked' };
  return { x: 'locked', y: 'locked', z: 'locked', twist: 'limited', swingY: 'limited', swingZ: 'limited' };
}

function createDefaultLimits(joint, childName) {
  const id = String(childName).toLowerCase();
  if (joint.type === 'hinge' || id.includes('elbow') || id.includes('knee')) {
    return { eTWIST: { motion: 'limited', lower: 0, upper: 2.5 } };
  }
  return {
    eTWIST: { motion: 'limited' },
    eSWING1: { motion: 'limited' },
    eSWING2: { motion: 'limited' },
  };
}

function createRootFromBodies(bodies, options = {}) {
  const root = bodies.find(body => (body.parent ?? -1) === -1) || bodies[0];
  return {
    id: root?.name || root?.id || 'root',
    position: addVec3(root?.position || [0, 0, 0], options.rootPosition || [0, 0, 0]),
    rotation: [...(root?.rotation || [0, 0, 0, 1])],
  };
}

function clonePairs(pairs) {
  return Array.isArray(pairs) ? pairs.map(pair => [...pair]) : [];
}

function inferBodyDriveType(name = '') {
  const id = String(name).toLowerCase();
  if (id.includes('neck') || id.includes('head')) return 'neck';
  if (id.includes('shoulder') || id.includes('upperarm')) return 'shoulder';
  if (id.includes('forearm') || id.includes('elbow')) return 'elbow';
  if (id.includes('hand') || id.includes('wrist')) return 'wrist';
  if (id.includes('spine') || id.includes('chest')) return 'spineUpper';
  if (id.includes('pelvis')) return 'pelvis';
  if (id.includes('thigh') || id.includes('hip')) return 'hip';
  if (id.includes('shin') || id.includes('knee')) return 'knee';
  if (id.includes('foot') || id.includes('ankle')) return 'ankle';
  return 'shoulder';
}

function addVec3(a, b) {
  return [(a?.[0] || 0) + (b?.[0] || 0), (a?.[1] || 0) + (b?.[1] || 0), (a?.[2] || 0) + (b?.[2] || 0)];
}
