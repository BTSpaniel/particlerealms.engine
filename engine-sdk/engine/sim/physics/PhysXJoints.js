/**
 * PhysX Joint Creation API
 * Exposes D6, revolute, distance, and spherical joints for articulated bodies
 */

export function getPhysXJointCapabilities(world) {
  const caps = {
    ready: false,
    hasD6: false,
    hasRevolute: false,
    hasSpherical: false,
    hasDistance: false,
    reason: null,
  };

  if (!world || !world.ready || !world.module || !world.physics) {
    caps.reason = "world_not_ready";
    return caps;
  }

  const PhysX = world.module;
  caps.ready = true;
  const top = PhysX && PhysX.PxTopLevelFunctions && PhysX.PxTopLevelFunctions.prototype;
  caps.hasD6 = typeof PhysX.PxD6JointCreate === "function" || (top && typeof top.D6JointCreate === "function");
  caps.hasRevolute =
    typeof PhysX.PxRevoluteJointCreate === "function" || (top && typeof top.RevoluteJointCreate === "function");
  caps.hasSpherical =
    typeof PhysX.PxSphericalJointCreate === "function" || (top && typeof top.SphericalJointCreate === "function");
  caps.hasDistance =
    typeof PhysX.PxDistanceJointCreate === "function" || (top && typeof top.DistanceJointCreate === "function");

  if (!caps.hasD6) {
    caps.reason = "missing_PxD6JointCreate";
  }

  return caps;
}

/**
 * Create a D6 joint (6 degrees of freedom - most flexible joint type)
 * @param {Object} world - PhysX world
 * @param {Object} bodyA - First body (or null for world anchor)
 * @param {Object} bodyB - Second body
 * @param {Object} options - Joint configuration
 * @returns {Object} Joint handle with control methods
 */
export function createD6Joint(world, bodyA, bodyB, options = {}) {
  if (!world || !world.ready || !world.module || !world.physics) {
    throw new Error('PhysX world not ready');
  }
  if (!bodyB || !bodyB._actor) {
    throw new Error('bodyB must have a valid PhysX actor');
  }

  const PhysX = world.module;
  const physics = world.physics;

  const actorA = bodyA && bodyA._actor ? bodyA._actor : null;
  const actorB = bodyB._actor;

  // Local frames for the joint attachment points
  const frameA = options.frameA || { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  const frameB = options.frameB || { position: [0, 0, 0], rotation: [0, 0, 0, 1] };

  const poseA = new PhysX.PxTransform(PhysX.PxIDENTITYEnum.PxIdentity);
  const posA = new PhysX.PxVec3(frameA.position[0], frameA.position[1], frameA.position[2]);
  const quatA = new PhysX.PxQuat(frameA.rotation[0], frameA.rotation[1], frameA.rotation[2], frameA.rotation[3]);
  poseA.set_p(posA);
  poseA.set_q(quatA);

  const poseB = new PhysX.PxTransform(PhysX.PxIDENTITYEnum.PxIdentity);
  const posB = new PhysX.PxVec3(frameB.position[0], frameB.position[1], frameB.position[2]);
  const quatB = new PhysX.PxQuat(frameB.rotation[0], frameB.rotation[1], frameB.rotation[2], frameB.rotation[3]);
  poseB.set_p(posB);
  poseB.set_q(quatB);

  // PhysX WASM uses PxD6JointCreate as a global function
  const top = PhysX && PhysX.PxTopLevelFunctions && PhysX.PxTopLevelFunctions.prototype;
  const createFn =
    (typeof PhysX.PxD6JointCreate === 'function' && PhysX.PxD6JointCreate) ||
    (top && typeof top.D6JointCreate === 'function' && top.D6JointCreate);
  if (!createFn) {
    throw new Error('PhysX module missing D6JointCreate');
  }
  const joint = createFn(physics, actorA, poseA, actorB, poseB);

  // Configure motion constraints
  const motionConfig = options.motion || {};
  
  // X, Y, Z linear motion (eLOCKED, eLIMITED, eFREE)
  if (motionConfig.x !== undefined) {
    joint.setMotion(PhysX.PxD6AxisEnum.eX, getMotionEnum(PhysX, motionConfig.x));
  }
  if (motionConfig.y !== undefined) {
    joint.setMotion(PhysX.PxD6AxisEnum.eY, getMotionEnum(PhysX, motionConfig.y));
  }
  if (motionConfig.z !== undefined) {
    joint.setMotion(PhysX.PxD6AxisEnum.eZ, getMotionEnum(PhysX, motionConfig.z));
  }

  // Twist (rotation around X) and Swing (rotation around Y/Z)
  if (motionConfig.twist !== undefined) {
    joint.setMotion(PhysX.PxD6AxisEnum.eTWIST, getMotionEnum(PhysX, motionConfig.twist));
  }
  if (motionConfig.swingY !== undefined) {
    joint.setMotion(PhysX.PxD6AxisEnum.eSWING1, getMotionEnum(PhysX, motionConfig.swingY));
  }
  if (motionConfig.swingZ !== undefined) {
    joint.setMotion(PhysX.PxD6AxisEnum.eSWING2, getMotionEnum(PhysX, motionConfig.swingZ));
  }

  // Set limits if provided
  if (options.linearLimit !== undefined) {
    const limit = new PhysX.PxJointLinearLimit(world.tolerances, options.linearLimit);
    if (typeof joint.setDistanceLimit === 'function') joint.setDistanceLimit(limit);
    else joint.setLinearLimit(limit);
    PhysX.destroy(limit);
  }

  if (options.twistLimit !== undefined) {
    const lower = options.twistLimit.lower || -Math.PI / 4;
    const upper = options.twistLimit.upper || Math.PI / 4;
    const limit = new PhysX.PxJointAngularLimitPair(lower, upper);
    joint.setTwistLimit(limit);
    PhysX.destroy(limit);
  }

  if (options.swingLimit !== undefined) {
    const yAngle = options.swingLimit.yAngle || Math.PI / 4;
    const zAngle = options.swingLimit.zAngle || Math.PI / 4;
    const limit = new PhysX.PxJointLimitCone(yAngle, zAngle);
    joint.setSwingLimit(limit);
    PhysX.destroy(limit);
  }

  // Configure drive (motor) if provided
  if (options.drive) {
    configureDrive(PhysX, joint, options.drive);
  }

  if (options.constraintFlags && typeof joint.setConstraintFlag === "function") {
    const flags = options.constraintFlags;
    const enumFlags = PhysX && PhysX.PxConstraintFlagEnum ? PhysX.PxConstraintFlagEnum : null;
    if (flags.collisionEnabled !== undefined) {
      if (enumFlags && enumFlags.eCOLLISION_ENABLED !== undefined) {
        joint.setConstraintFlag(
          enumFlags.eCOLLISION_ENABLED,
          !!flags.collisionEnabled
        );
      }
    }
    if (flags.improvedSlerp !== undefined) {
      if (enumFlags && enumFlags.eIMPROVED_SLERP !== undefined) {
        joint.setConstraintFlag(
          enumFlags.eIMPROVED_SLERP,
          !!flags.improvedSlerp
        );
      }
    }
    if (flags.disablePreprocessing !== undefined) {
      if (enumFlags && enumFlags.eDISABLE_PREPROCESSING !== undefined) {
        joint.setConstraintFlag(
          enumFlags.eDISABLE_PREPROCESSING,
          !!flags.disablePreprocessing
        );
      }
    }
  }

  // Cleanup temp objects
  PhysX.destroy(posA);
  PhysX.destroy(quatA);
  PhysX.destroy(poseA);
  PhysX.destroy(posB);
  PhysX.destroy(quatB);
  PhysX.destroy(poseB);

  return {
    _joint: joint,
    setDrivePosition(position, rotation) {
      const pose = new PhysX.PxTransform(PhysX.PxIDENTITYEnum.PxIdentity);
      const pos = new PhysX.PxVec3(position[0], position[1], position[2]);
      const quat = new PhysX.PxQuat(rotation[0], rotation[1], rotation[2], rotation[3]);
      pose.set_p(pos);
      pose.set_q(quat);
      joint.setDrivePosition(pose, true);
      PhysX.destroy(pos);
      PhysX.destroy(quat);
      PhysX.destroy(pose);
    },
    setDriveVelocity(linear, angular) {
      const linVel = new PhysX.PxVec3(linear[0], linear[1], linear[2]);
      const angVel = new PhysX.PxVec3(angular[0], angular[1], angular[2]);
      joint.setDriveVelocity(linVel, angVel);
      PhysX.destroy(linVel);
      PhysX.destroy(angVel);
    },
    destroy() {
      if (this._joint) {
        this._joint.release();
        this._joint = null;
      }
    }
  };
}

/**
 * Create a revolute joint (hinge joint - 1 rotational DOF)
 * @param {Object} world - PhysX world
 * @param {Object} bodyA - First body
 * @param {Object} bodyB - Second body
 * @param {Object} options - Joint configuration
 * @returns {Object} Joint handle
 */
export function createRevoluteJoint(world, bodyA, bodyB, options = {}) {
  if (!world || !world.ready || !world.module || !world.physics) {
    throw new Error('PhysX world not ready');
  }
  if (!bodyB || !bodyB._actor) {
    throw new Error('bodyB must have a valid PhysX actor');
  }

  const PhysX = world.module;
  const physics = world.physics;

  const actorA = bodyA && bodyA._actor ? bodyA._actor : null;
  const actorB = bodyB._actor;

  const frameA = options.frameA || { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  const frameB = options.frameB || { position: [0, 0, 0], rotation: [0, 0, 0, 1] };

  const poseA = new PhysX.PxTransform(PhysX.PxIDENTITYEnum.PxIdentity);
  const posA = new PhysX.PxVec3(frameA.position[0], frameA.position[1], frameA.position[2]);
  const quatA = new PhysX.PxQuat(frameA.rotation[0], frameA.rotation[1], frameA.rotation[2], frameA.rotation[3]);
  poseA.set_p(posA);
  poseA.set_q(quatA);

  const poseB = new PhysX.PxTransform(PhysX.PxIDENTITYEnum.PxIdentity);
  const posB = new PhysX.PxVec3(frameB.position[0], frameB.position[1], frameB.position[2]);
  const quatB = new PhysX.PxQuat(frameB.rotation[0], frameB.rotation[1], frameB.rotation[2], frameB.rotation[3]);
  poseB.set_p(posB);
  poseB.set_q(quatB);

  const top = PhysX && PhysX.PxTopLevelFunctions && PhysX.PxTopLevelFunctions.prototype;
  const createFn =
    (typeof PhysX.PxRevoluteJointCreate === 'function' && PhysX.PxRevoluteJointCreate) ||
    (top && typeof top.RevoluteJointCreate === 'function' && top.RevoluteJointCreate);
  if (!createFn) {
    throw new Error('PhysX module missing RevoluteJointCreate');
  }
  const joint = createFn(physics, actorA, poseA, actorB, poseB);

  // Set limits if provided
  if (options.limit) {
    const lower = options.limit.lower || -Math.PI / 2;
    const upper = options.limit.upper || Math.PI / 2;
    const limit = new PhysX.PxJointAngularLimitPair(lower, upper);
    joint.setLimit(limit);
    joint.setRevoluteJointFlag(PhysX.PxRevoluteJointFlagEnum.eLIMIT_ENABLED, true);
    PhysX.destroy(limit);
  }

  // Enable motor if provided
  if (options.motor) {
    joint.setDriveVelocity(options.motor.targetVelocity || 0);
    joint.setDriveForceLimit(options.motor.forceLimit || 1000);
    joint.setRevoluteJointFlag(PhysX.PxRevoluteJointFlagEnum.eDRIVE_ENABLED, true);
  }

  PhysX.destroy(posA);
  PhysX.destroy(quatA);
  PhysX.destroy(poseA);
  PhysX.destroy(posB);
  PhysX.destroy(quatB);
  PhysX.destroy(poseB);

  return {
    _joint: joint,
    setMotorVelocity(velocity) {
      joint.setDriveVelocity(velocity);
    },
    getAngle() {
      return joint.getAngle();
    },
    destroy() {
      if (this._joint) {
        this._joint.release();
        this._joint = null;
      }
    }
  };
}

/**
 * Create a spherical joint (ball-and-socket - 3 rotational DOF)
 * @param {Object} world - PhysX world
 * @param {Object} bodyA - First body
 * @param {Object} bodyB - Second body
 * @param {Object} options - Joint configuration
 * @returns {Object} Joint handle
 */
export function createSphericalJoint(world, bodyA, bodyB, options = {}) {
  if (!world || !world.ready || !world.module || !world.physics) {
    throw new Error('PhysX world not ready');
  }
  if (!bodyB || !bodyB._actor) {
    throw new Error('bodyB must have a valid PhysX actor');
  }

  const PhysX = world.module;
  const physics = world.physics;

  const actorA = bodyA && bodyA._actor ? bodyA._actor : null;
  const actorB = bodyB._actor;

  const frameA = options.frameA || { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  const frameB = options.frameB || { position: [0, 0, 0], rotation: [0, 0, 0, 1] };

  const poseA = new PhysX.PxTransform(PhysX.PxIDENTITYEnum.PxIdentity);
  const posA = new PhysX.PxVec3(frameA.position[0], frameA.position[1], frameA.position[2]);
  const quatA = new PhysX.PxQuat(frameA.rotation[0], frameA.rotation[1], frameA.rotation[2], frameA.rotation[3]);
  poseA.set_p(posA);
  poseA.set_q(quatA);

  const poseB = new PhysX.PxTransform(PhysX.PxIDENTITYEnum.PxIdentity);
  const posB = new PhysX.PxVec3(frameB.position[0], frameB.position[1], frameB.position[2]);
  const quatB = new PhysX.PxQuat(frameB.rotation[0], frameB.rotation[1], frameB.rotation[2], frameB.rotation[3]);
  poseB.set_p(posB);
  poseB.set_q(quatB);

  const top = PhysX && PhysX.PxTopLevelFunctions && PhysX.PxTopLevelFunctions.prototype;
  const createFn =
    (typeof PhysX.PxSphericalJointCreate === 'function' && PhysX.PxSphericalJointCreate) ||
    (top && typeof top.SphericalJointCreate === 'function' && top.SphericalJointCreate);
  if (!createFn) {
    throw new Error('PhysX module missing SphericalJointCreate');
  }
  const joint = createFn(physics, actorA, poseA, actorB, poseB);

  // Set cone limit if provided
  if (options.limit) {
    const yAngle = options.limit.yAngle || Math.PI / 4;
    const zAngle = options.limit.zAngle || Math.PI / 4;
    const limit = new PhysX.PxJointLimitCone(yAngle, zAngle);
    joint.setLimitCone(limit);
    joint.setSphericalJointFlag(PhysX.PxSphericalJointFlagEnum.eLIMIT_ENABLED, true);
    PhysX.destroy(limit);
  }

  PhysX.destroy(posA);
  PhysX.destroy(quatA);
  PhysX.destroy(poseA);
  PhysX.destroy(posB);
  PhysX.destroy(quatB);
  PhysX.destroy(poseB);

  return {
    _joint: joint,
    destroy() {
      if (this._joint) {
        this._joint.release();
        this._joint = null;
      }
    }
  };
}

/**
 * Create a distance joint (maintains distance between two points)
 * @param {Object} world - PhysX world
 * @param {Object} bodyA - First body
 * @param {Object} bodyB - Second body
 * @param {Object} options - Joint configuration
 * @returns {Object} Joint handle
 */
export function createDistanceJoint(world, bodyA, bodyB, options = {}) {
  if (!world || !world.ready || !world.module || !world.physics) {
    throw new Error('PhysX world not ready');
  }
  if (!bodyB || !bodyB._actor) {
    throw new Error('bodyB must have a valid PhysX actor');
  }

  const PhysX = world.module;
  const physics = world.physics;

  const actorA = bodyA && bodyA._actor ? bodyA._actor : null;
  const actorB = bodyB._actor;

  const frameA = options.frameA || { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  const frameB = options.frameB || { position: [0, 0, 0], rotation: [0, 0, 0, 1] };

  const poseA = new PhysX.PxTransform(PhysX.PxIDENTITYEnum.PxIdentity);
  const posA = new PhysX.PxVec3(frameA.position[0], frameA.position[1], frameA.position[2]);
  poseA.set_p(posA);

  const poseB = new PhysX.PxTransform(PhysX.PxIDENTITYEnum.PxIdentity);
  const posB = new PhysX.PxVec3(frameB.position[0], frameB.position[1], frameB.position[2]);
  poseB.set_p(posB);

  const top = PhysX && PhysX.PxTopLevelFunctions && PhysX.PxTopLevelFunctions.prototype;
  const createFn =
    (typeof PhysX.PxDistanceJointCreate === 'function' && PhysX.PxDistanceJointCreate) ||
    (top && typeof top.DistanceJointCreate === 'function' && top.DistanceJointCreate);
  if (!createFn) {
    throw new Error('PhysX module missing DistanceJointCreate');
  }
  const joint = createFn(physics, actorA, poseA, actorB, poseB);

  // Set distance constraints
  if (options.minDistance !== undefined) {
    joint.setMinDistance(options.minDistance);
    joint.setDistanceJointFlag(PhysX.PxDistanceJointFlagEnum.eMIN_DISTANCE_ENABLED, true);
  }
  if (options.maxDistance !== undefined) {
    joint.setMaxDistance(options.maxDistance);
    joint.setDistanceJointFlag(PhysX.PxDistanceJointFlagEnum.eMAX_DISTANCE_ENABLED, true);
  }

  // Set spring parameters if provided
  if (options.spring) {
    joint.setStiffness(options.spring.stiffness || 100);
    joint.setDamping(options.spring.damping || 10);
    joint.setDistanceJointFlag(PhysX.PxDistanceJointFlagEnum.eSPRING_ENABLED, true);
  }

  PhysX.destroy(posA);
  PhysX.destroy(poseA);
  PhysX.destroy(posB);
  PhysX.destroy(poseB);

  return {
    _joint: joint,
    destroy() {
      if (this._joint) {
        this._joint.release();
        this._joint = null;
      }
    }
  };
}

// Helper functions

function getMotionEnum(PhysX, motion) {
  if (motion === 'locked') return PhysX.PxD6MotionEnum.eLOCKED;
  if (motion === 'limited') return PhysX.PxD6MotionEnum.eLIMITED;
  if (motion === 'free') return PhysX.PxD6MotionEnum.eFREE;
  return PhysX.PxD6MotionEnum.eLOCKED;
}

function configureDrive(PhysX, joint, driveConfig) {
  const angularConfig = PhysX.PxD6AngularDriveConfigEnum;
  if (angularConfig && typeof joint.setAngularDriveConfig === 'function') {
    joint.setAngularDriveConfig(driveConfig.slerp ? angularConfig.eSLERP : angularConfig.eSWING_TWIST);
  }
  // X, Y, Z linear drives
  if (driveConfig.x) {
    setD6Drive(PhysX, joint, PhysX.PxD6DriveEnum.eX, driveConfig.x);
  }
  if (driveConfig.y) {
    setD6Drive(PhysX, joint, PhysX.PxD6DriveEnum.eY, driveConfig.y);
  }
  if (driveConfig.z) {
    setD6Drive(PhysX, joint, PhysX.PxD6DriveEnum.eZ, driveConfig.z);
  }

  // Swing (rotation around Y/Z) drive
  if (driveConfig.swing && !(angularConfig && driveConfig.slerp)) {
    if (PhysX.PxD6DriveEnum.eSWING !== undefined) {
      setD6Drive(PhysX, joint, PhysX.PxD6DriveEnum.eSWING, driveConfig.swing);
    } else {
      // PhysX 5.10+ splits the old shared swing drive into two axes.
      setD6Drive(PhysX, joint, PhysX.PxD6DriveEnum.eSWING1, driveConfig.swing);
      setD6Drive(PhysX, joint, PhysX.PxD6DriveEnum.eSWING2, driveConfig.swing);
    }
  }

  if (driveConfig.swing1 && !(angularConfig && driveConfig.slerp) && PhysX.PxD6DriveEnum.eSWING1 !== undefined) {
    setD6Drive(PhysX, joint, PhysX.PxD6DriveEnum.eSWING1, driveConfig.swing1);
  }

  if (driveConfig.swing2 && !(angularConfig && driveConfig.slerp) && PhysX.PxD6DriveEnum.eSWING2 !== undefined) {
    setD6Drive(PhysX, joint, PhysX.PxD6DriveEnum.eSWING2, driveConfig.swing2);
  }

  // Twist (rotation around X) drive
  if (driveConfig.twist && !(angularConfig && driveConfig.slerp)) {
    setD6Drive(PhysX, joint, PhysX.PxD6DriveEnum.eTWIST, driveConfig.twist);
  }

  // SLERP (spherical linear interpolation) drive for rotation
  if (driveConfig.slerp) {
    setD6Drive(PhysX, joint, PhysX.PxD6DriveEnum.eSLERP, driveConfig.slerp);
  }
}

function setD6Drive(PhysX, joint, driveEnum, config) {
  if (driveEnum === undefined || !config) return;
  const isAcceleration = config.isAcceleration ?? (config.driveMode === "acceleration");
  const drive = new PhysX.PxD6JointDrive(
    config.stiffness || 0,
    config.damping || 0,
    config.forceLimit ?? config.maxForce ?? Number.MAX_VALUE,
    isAcceleration
  );
  try {
    joint.setDrive(driveEnum, drive);
  } finally {
    PhysX.destroy(drive);
  }
}
