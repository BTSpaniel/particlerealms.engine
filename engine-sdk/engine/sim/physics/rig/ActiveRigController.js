import { createArticulation, createChildLink, createRootLink, addArticulationToScene, getArticulationLinkTransforms, destroyArticulation } from '../PhysXArticulations.js';
import { createD6Joint } from '../PhysXJoints.js';
import { createRagdollSim } from '../../../assets/rig/RagdollSim.js';
import { ACTIVE_RIG_BACKENDS, ACTIVE_RIG_STATES, createActiveRigConfig, createDriveProfile, createPoseBufferFromRig } from './ActiveRigSchema.js';
import { BalanceController } from './BalanceController.js';
import { MuscleLayer } from './MuscleLayer.js';
import { PoseStateGraph } from './PoseStateGraph.js';
import { PoseBlendState, RetargetGraph, clonePoseBuffer } from './RetargetGraph.js';

export class ActiveRigController {
  constructor(options = {}) {
    this.world = options.world || null;
    this.rig = options.rig || { joints: [], links: [], parts: [] };
    this.config = createActiveRigConfig(options.config || options);
    this.backend = this.config.backend;
    this.instance = null;
    this.verletSim = null;
    this.links = new Map();
    this.joints = new Map();
    this.pose = createPoseBufferFromRig(this.rig);
    this.poseBlend = new PoseBlendState({ current: this.pose, target: this.pose, blendRate: options.blendRate ?? 10 });
    this.retarget = options.retargetGraph || RetargetGraph.fromJointNames(Object.keys(this.pose.joints));
    this.poseStates = options.poseStateGraph || new PoseStateGraph({
      initialState: options.initialPoseState || this.config.poseState || 'idle_stand',
      states: options.poseStates,
    });
    this.balance = new BalanceController(this.config.balance);
    this.muscles = new MuscleLayer({ massKg: this.config.massKg, preset: this.config.preset });
    const driveSource = this.rig.parts?.length ? this.rig.parts : this.rig.links?.length ? this.rig.links : this.rig.bodies?.length ? this.rig.bodies : this.rig.joints || [];
    this.driveProfile = createDriveProfile({
      joints: driveSource,
      massKg: this.config.massKg,
      preset: this.config.preset,
      frequencyHz: this.config.frequencyHz,
      dampingRatio: this.config.dampingRatio,
      driveMode: this.config.driveMode,
    });
    this.state = this.config.state;
    this.lastBalance = null;
  }

  // Fallback priority: PhysX reduced articulation → PhysX D6 ragdoll → Verlet/
  // PBD RagdollSim (no PhysX world needed) → kinematic-only (pose-driven, no
  // physics at all). Each tier only runs if the previous one is unavailable or
  // fails to initialize; `this.backend` is updated to reflect which tier is
  // actually active, so update()/applyDriveTargets()/readPhysicsPose()/destroy()
  // all branch correctly regardless of what the caller originally configured.
  initialize(world = this.world) {
    this.world = world;
    const wantArticulation = this.backend === ACTIVE_RIG_BACKENDS.articulation;
    const wantD6 = this.backend === ACTIVE_RIG_BACKENDS.d6;
    if (this.world && (wantArticulation || wantD6)) {
      if (wantArticulation && this.initializeArticulation()) return true;
      this.backend = ACTIVE_RIG_BACKENDS.d6;
      if (this.initializeD6Fallback()) return true;
    }
    this.backend = ACTIVE_RIG_BACKENDS.pbd;
    if (this.initializeVerletFallback()) return true;
    this.backend = ACTIVE_RIG_BACKENDS.none;
    this.state = ACTIVE_RIG_STATES.kinematic;
    return this.initializeKinematicOnly();
  }

  initializeArticulation() {
    const articulation = createArticulation(this.world, this.config.solver);
    if (!articulation) return false;
    const parts = this.rig.parts || this.rig.links || [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const id = part.id || part.name || `part_${i}`;
      const parentId = part.parentId ?? part.parent ?? null;
      const parent = parentId !== null && parentId !== -1 ? this.links.get(parentId) || this.links.get(parts[parentId]?.id || parts[parentId]?.name) : null;
      const options = {
        position: part.position || part.restPoseWorld?.position || [0, 0, 0],
        geometry: part.geometry || part.shape || defaultCapsule(part),
        material: part.material,
        density: part.density || 1,
        joint: this.createJointOptions(part, parts),
      };
      const link = parent ? createChildLink(articulation, parent, options) : createRootLink(articulation, options);
      if (link) this.links.set(id, link);
    }
    addArticulationToScene(articulation);
    this.instance = articulation;
    return true;
  }

  initializeD6Fallback() {
    const bodies = this.rig.bodies || this.rig.parts || [];
    const joints = this.rig.joints || [];
    for (const jointDef of joints) {
      const bodyA = this.resolveBodyHandle(bodies, jointDef.parent ?? jointDef.bodyA);
      const bodyB = this.resolveBodyHandle(bodies, jointDef.child ?? jointDef.bodyB);
      if (!bodyB) continue;
      const joint = createD6Joint(this.world, bodyA, bodyB, {
        frameA: jointDef.frameA || { position: jointDef.anchorA || [0, 0, 0], rotation: jointDef.rotationA || [0, 0, 0, 1] },
        frameB: jointDef.frameB || { position: jointDef.anchorB || [0, 0, 0], rotation: jointDef.rotationB || [0, 0, 0, 1] },
        motion: jointDef.motion || defaultD6Motion(jointDef),
        drive: this.toD6DriveConfig(this.driveProfile[jointDef.id || jointDef.name] || jointDef.drive),
        twistLimit: jointDef.twistLimit,
        swingLimit: jointDef.swingLimit,
        constraintFlags: { collisionEnabled: Boolean(jointDef.enableCollision), improvedSlerp: true },
      });
      this.joints.set(jointDef.id || jointDef.name || `${jointDef.parent}_${jointDef.child}`, joint);
    }
    this.instance = { bodies, joints: this.joints };
    return this.joints.size > 0;
  }

  /**
   * Build a passive Verlet/PBD ragdoll (engine/assets/rig/RagdollSim.js) from
   * the rig's parts. Works with EITHER adapter's part shape (both set
   * `part.parentId` as a numeric index): full fidelity (real axis/swingDeg/
   * twistDeg, hinge-vs-ball) when the rig came from
   * CharacterPhysicsAssetAdapter; generic ball joints when it came from the
   * legacy StickmanActiveRigAdapter (whose `part.joint.limits` are PhysX-D6-
   * axis-keyed, not swingDeg/twistDeg/axis). RagdollSim is intentionally
   * passive (no muscle/drive concept) — this tier is a physical fallback, not
   * an active-motor replacement.
   */
  initializeVerletFallback() {
    const parts = this.rig.parts || this.rig.links || this.rig.bodies || [];
    if (!parts.length) return false;
    const bones = parts.map((part) => {
      const parentIndex = part.parentId != null && part.parentId !== -1 ? part.parentId : -1;
      const limits = part.joint?.limits;
      const hasRagdollLimits = limits && typeof limits.swingDeg === 'number';
      return {
        position: part.position || [0, 0, 0],
        parentIndex,
        jointType: parentIndex < 0 ? 'root' : hasRagdollLimits ? (part.joint.type === 'revolute' ? 'hinge' : 'ball') : 'ball',
        swingDeg: hasRagdollLimits ? limits.swingDeg : 45,
        twistDeg: hasRagdollLimits ? limits.twistDeg : 30,
        axis: hasRagdollLimits ? limits.axis : [0, 1, 0],
      };
    });
    this.verletSim = createRagdollSim({ bones }, {
      gravity: this.config.gravity || [0, -9.8, 0],
      ground: this.config.ground ?? null,
    });
    this.instance = this.verletSim;
    return true;
  }

  /** Last-resort tier: no physics at all, purely pose-driven. Always succeeds. */
  initializeKinematicOnly() {
    this.instance = null;
    return true;
  }

  setTargetPose(pose, options = {}) {
    const physicsPose = options.space === 'physics' ? clonePoseBuffer(pose) : this.retarget.mapAnimToPhys(pose, this.pose);
    this.poseBlend.setTarget(physicsPose);
  }

  snapToPose(pose, options = {}) {
    const physicsPose = options.space === 'physics' ? clonePoseBuffer(pose) : this.retarget.mapAnimToPhys(pose, this.pose);
    this.pose = clonePoseBuffer(physicsPose);
    this.poseBlend.snap(physicsPose);
    this.applyPoseImmediate(this.pose);
  }

  update(dt = 1 / 60, intent = {}) {
    const blendedPose = this.poseBlend.update(dt);
    const poseStateTarget = this.poseStates.update(dt, blendedPose, intent);
    const poseStateMeta = this.poseStates.getMeta();
    this.lastBalance = this.balance.update(this.pose, dt, intent);
    const balancedPose = this.balance.applyToPose(poseStateTarget, this.lastBalance, intent.balance ?? 1);
    if (this.backend === ACTIVE_RIG_BACKENDS.pbd && this.verletSim) {
      this.verletSim.step(dt); // passive fallback — no drives to apply, just integrate
    } else {
      const drives = scaleDriveProfile(this.muscles.modulateDrives(this.driveProfile, intent), poseStateMeta);
      this.applyDriveTargets(balancedPose, drives);
    }
    this.pose = this.readPhysicsPose() || balancedPose;
    this.state = this.lastBalance.state || ACTIVE_RIG_STATES.active;
    return {
      state: this.state,
      pose: this.pose,
      renderPose: this.retarget.mapPhysToRender(this.pose),
      balance: this.lastBalance,
      poseState: poseStateMeta,
    };
  }

  applyDriveTargets(pose, drives = this.driveProfile) {
    if (this.backend === ACTIVE_RIG_BACKENDS.articulation) {
      for (const [id, link] of this.links) {
        const jointPose = pose.joints[id];
        if (!link?._joint || !jointPose) continue;
        const axes = drives[id] || this.driveProfile[id] || {};
        for (const [axisName, axisDrive] of Object.entries(axes)) {
          this.applyArticulationAxis(link._joint, axisName, axisDrive, jointPose);
        }
      }
    } else if (this.backend === ACTIVE_RIG_BACKENDS.d6) {
      for (const [id, joint] of this.joints) {
        const jointPose = pose.joints[id];
        if (!joint || !jointPose) continue;
        joint.setDrivePosition?.(jointPose.targetPosition || [0, 0, 0], jointPose.targetRotation || [0, 0, 0, 1]);
        joint.setDriveVelocity?.(jointPose.targetVelocity || [0, 0, 0], [0, 0, 0]);
      }
    }
  }

  applyPoseImmediate(pose) {
    this.applyDriveTargets(pose, this.driveProfile);
  }

  readPhysicsPose() {
    if (this.backend === ACTIVE_RIG_BACKENDS.articulation && this.instance) {
      const transforms = getArticulationLinkTransforms(this.instance);
      if (!transforms.length) return null;
      const out = clonePoseBuffer(this.pose);
      const ids = [...this.links.keys()];
      for (let i = 0; i < transforms.length; i++) {
        const id = ids[i];
        if (!id || !out.joints[id]) continue;
        out.joints[id].position = [...transforms[i].position];
        out.joints[id].rotation = [...transforms[i].rotation];
      }
      return out;
    }
    if (this.backend === ACTIVE_RIG_BACKENDS.pbd && this.verletSim) {
      const positions = this.verletSim.positions();
      if (!positions?.length) return null;
      const out = clonePoseBuffer(this.pose);
      const parts = this.rig.parts || this.rig.links || this.rig.bodies || [];
      for (let i = 0; i < positions.length; i++) {
        const id = parts[i]?.id || parts[i]?.name;
        if (!id || !out.joints[id]) continue;
        // Position-only readback — RagdollSim's Verlet particles don't carry
        // per-bone rotation; a physics-aware skinner (RagdollSkinning.js's
        // ragdollBoneFrames) would derive it from neighboring particles if
        // rendered rotation is needed. Rotation stays at its last value.
        out.joints[id].position = [...positions[i]];
      }
      return out;
    }
    return null;
  }

  destroy() {
    if (this.backend === ACTIVE_RIG_BACKENDS.articulation && this.instance) destroyArticulation(this.instance);
    if (this.backend === ACTIVE_RIG_BACKENDS.d6) {
      for (const joint of this.joints.values()) joint.destroy?.();
    }
    this.instance = null;
    this.verletSim = null;
    this.links.clear();
    this.joints.clear();
  }

  createJointOptions(part, parts = null) {
    const id = part.id || part.name;
    // Joint frames: the pivot sits at the CHILD link's origin. Links are
    // created with identity rotation at their world bind positions, so the
    // parent-local anchor is simply (childPos - parentPos). Defaulting BOTH
    // anchors to [0,0,0] (the old behavior) welds every child link's origin
    // onto its parent's origin — the whole articulation instantly compresses
    // into a heap under gravity.
    let defaultParentAnchor = [0, 0, 0];
    const parentRef = part.parentId ?? part.parent;
    if (parts && parentRef != null && parentRef !== -1 && Array.isArray(part.position)) {
      const parentPart = typeof parentRef === 'number'
        ? parts[parentRef]
        : parts.find((p) => (p.id || p.name) === parentRef);
      if (Array.isArray(parentPart?.position)) {
        defaultParentAnchor = [
          part.position[0] - parentPart.position[0],
          part.position[1] - parentPart.position[1],
          part.position[2] - parentPart.position[2],
        ];
      }
    }
    return {
      type: part.joint?.type || part.jointType || 'spherical',
      parentAnchor: part.joint?.parentAnchor || part.parentAnchor || defaultParentAnchor,
      childAnchor: part.joint?.childAnchor || part.childAnchor || [0, 0, 0],
      limits: part.joint?.limits || part.limits,
      drives: part.joint?.drives || this.driveProfile[id],
    };
  }

  applyArticulationAxis(joint, axisName, axisDrive, jointPose) {
    const PhysX = this.world?.module;
    if (!PhysX?.PxArticulationAxisEnum || !joint) return;
    const axis = PhysX.PxArticulationAxisEnum[axisName] ?? PhysX.PxArticulationAxisEnum[`e${String(axisName).toUpperCase()}`];
    if (axis === undefined) return;
    if (axisDrive && typeof joint.setDriveParams === 'function') {
      this.setArticulationDriveParams(PhysX, joint, axis, axisDrive);
    }
    if (axisDrive?.targetPosition !== undefined && typeof joint.setDriveTarget === 'function') joint.setDriveTarget(axis, axisDrive.targetPosition, true);
    else if (typeof joint.setDriveTarget === 'function') joint.setDriveTarget(axis, axisTargetFromPose(axisName, jointPose), true);
    if (axisDrive?.targetVelocity !== undefined && typeof joint.setDriveVelocity === 'function') joint.setDriveVelocity(axis, axisDrive.targetVelocity, true);
  }

  setArticulationDriveParams(PhysX, joint, axis, axisDrive) {
    try {
      const driveType = getArticulationDriveType(PhysX, axisDrive.driveMode || this.config.driveMode);
      const drive = PhysX.PxArticulationDrive.length >= 4
        ? new PhysX.PxArticulationDrive(axisDrive.stiffness || 0, axisDrive.damping || 0, axisDrive.maxForce ?? axisDrive.forceLimit ?? 0, driveType)
        : new PhysX.PxArticulationDrive();
      drive.stiffness = axisDrive.stiffness || 0;
      drive.damping = axisDrive.damping || 0;
      drive.maxForce = axisDrive.maxForce ?? axisDrive.forceLimit ?? 0;
      if (drive.driveType !== undefined) drive.driveType = driveType;
      joint.setDriveParams(axis, drive);
      if (axisDrive.armature !== undefined && typeof joint.setArmature === 'function') joint.setArmature(axis, axisDrive.armature);
      PhysX.destroy(drive);
    } catch (_) {}
  }

  toD6DriveConfig(axisDrives = {}) {
    return {
      twist: axisDrives.eTWIST || axisDrives.twist,
      swing1: axisDrives.eSWING1 || axisDrives.swing1,
      swing2: axisDrives.eSWING2 || axisDrives.swing2,
      swing: axisDrives.eSWING,
      slerp: axisDrives.slerp,
    };
  }

  resolveBodyHandle(bodies, ref) {
    if (ref === null || ref === undefined || ref === -1) return null;
    if (typeof ref === 'object') return ref;
    const body = typeof ref === 'number' ? bodies[ref] : bodies.find(item => item.id === ref || item.name === ref);
    return body?._actor ? body : body?.handle || null;
  }
}

export function createActiveRigController(options = {}) {
  const controller = new ActiveRigController(options);
  if (options.autoInitialize !== false && options.world) controller.initialize(options.world);
  return controller;
}

function axisTargetFromPose(axisName, jointPose) {
  const p = jointPose.targetPosition || jointPose.position || [0, 0, 0];
  if (axisName === 'eX') return p[0];
  if (axisName === 'eY') return p[1];
  if (axisName === 'eZ') return p[2];
  return 0;
}

function defaultCapsule(part) {
  if (part.radius || part.length || part.halfHeight) {
    return { type: 'capsule', radius: part.radius || 0.05, halfHeight: part.halfHeight || Math.max(0.02, (part.length || 0.2) * 0.5) };
  }
  return { type: 'sphere', radius: 0.08 };
}

function defaultD6Motion(jointDef) {
  if (jointDef.type === 'hinge' || jointDef.jointType === 'hinge') {
    return { x: 'locked', y: 'locked', z: 'locked', twist: 'limited', swingY: 'locked', swingZ: 'locked' };
  }
  return { x: 'locked', y: 'locked', z: 'locked', twist: 'limited', swingY: 'limited', swingZ: 'limited' };
}

function getArticulationDriveType(PhysX, driveMode = 'acceleration') {
  if (!PhysX.PxArticulationDriveTypeEnum) return undefined;
  if (driveMode === 'force') return PhysX.PxArticulationDriveTypeEnum.eFORCE;
  if (driveMode === 'none') return PhysX.PxArticulationDriveTypeEnum.eNONE;
  return PhysX.PxArticulationDriveTypeEnum.eACCELERATION;
}

function scaleDriveProfile(drives, meta = {}) {
  const strength = meta.strengthScale ?? 1;
  const damping = meta.dampingScale ?? 1;
  const out = {};
  for (const [jointId, axisMap] of Object.entries(drives || {})) {
    out[jointId] = {};
    for (const [axisName, axis] of Object.entries(axisMap || {})) {
      out[jointId][axisName] = {
        ...axis,
        stiffness: (axis.stiffness || 0) * strength,
        damping: (axis.damping || 0) * damping,
        maxForce: (axis.maxForce ?? axis.forceLimit ?? 0) * strength,
      };
    }
  }
  return out;
}
