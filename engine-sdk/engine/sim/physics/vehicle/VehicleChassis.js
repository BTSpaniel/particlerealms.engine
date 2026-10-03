// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { arrayAt } from './VehicleConfig.js';

export function configureVehicleChassis(PhysX, vehicle, config, alloc) {
  const base = vehicle.baseParams;
  const axes = PhysX.PxVehicleAxesEnum;
  base.frame.lngAxis = axes.ePosX;
  base.frame.latAxis = axes.eNegZ;
  base.frame.vrtAxis = axes.ePosY;
  base.scale.scale = 1;

  const axles = base.axleDescription;
  axles.setToDefault();
  axles.nbAxles = 2;
  axles.nbWheels = 4;
  axles.set_nbWheelsPerAxle(0, 2);
  axles.set_nbWheelsPerAxle(1, 2);
  axles.set_axleToWheelIds(0, 0);
  axles.set_axleToWheelIds(1, 2);
  for (let wheel = 0; wheel < 4; wheel++) axles.set_wheelIdsInAxleOrder(wheel, wheel);

  const [length, height, width] = config.chassisDims;
  base.rigidBodyParams.mass = config.mass;
  base.rigidBodyParams.moi = alloc(new PhysX.PxVec3(
    (config.mass / 12) * (height * height + width * width) * 0.8,
    (config.mass / 12) * (length * length + width * width),
    (config.mass / 12) * (length * length + height * height),
  ));

  const brake = arrayAt(base, 'brakeResponseParams', 0);
  brake.maxResponse = config.mass * 1.9;
  for (let wheel = 0; wheel < 4; wheel++) brake.set_wheelResponseMultipliers(wheel, 1);
  const handbrake = arrayAt(base, 'brakeResponseParams', 1);
  handbrake.maxResponse = config.mass * 1.25;
  handbrake.set_wheelResponseMultipliers(0, 0);
  handbrake.set_wheelResponseMultipliers(1, 0);
  handbrake.set_wheelResponseMultipliers(2, 1);
  handbrake.set_wheelResponseMultipliers(3, 1);

  base.steerResponseParams.maxResponse = config.maxSteerRad;
  base.steerResponseParams.set_wheelResponseMultipliers(0, 1);
  base.steerResponseParams.set_wheelResponseMultipliers(1, 1);
  base.steerResponseParams.set_wheelResponseMultipliers(2, 0);
  base.steerResponseParams.set_wheelResponseMultipliers(3, 0);
  const ackermann = arrayAt(base, 'ackermannParams', 0);
  ackermann.set_wheelIds(0, 0);
  ackermann.set_wheelIds(1, 1);
  ackermann.wheelBase = config.wheelBase;
  ackermann.trackWidth = config.track;
  ackermann.strength = 1;
}

export function initializeVehicleActor(PhysX, topLevel, world, vehicle, config, alloc) {
  const base = vehicle.baseParams;
  const integration = vehicle.physXParams;
  const roadQuery = alloc(new PhysX.PxQueryFilterData());
  const materialFriction = alloc(new PhysX.PxVehiclePhysXMaterialFriction());
  materialFriction.material = world.defaultMaterial;
  materialFriction.friction = 1.0;
  const centerPose = alloc(new PhysX.PxTransform(
    alloc(new PhysX.PxVec3(0, -config.chassisDims[1] * 0.15, 0)),
    alloc(new PhysX.PxQuat(0, 0, 0, 1)),
  ));
  const chassisGeometry = alloc(new PhysX.PxBoxGeometry(
    config.chassisDims[0] / 2, config.chassisDims[1] / 2, config.chassisDims[2] / 2,
  ));
  const shapePose = alloc(new PhysX.PxTransform(
    alloc(new PhysX.PxVec3(0, 0, 0)), alloc(new PhysX.PxQuat(0, 0, 0, 1)),
  ));
  integration.create(
    base.axleDescription, roadQuery, null, materialFriction, 1, 1.0,
    centerPose, chassisGeometry, shapePose,
    PhysX.PxVehiclePhysXRoadGeometryQueryTypeEnum.eRAYCAST,
  );

  const flags = PhysX.PxShapeFlagEnum;
  integration.physxActorShapeFlags = alloc(new PhysX.PxShapeFlags(
    flags.eSIMULATION_SHAPE | flags.eVISUALIZATION,
  ));
  // The chassis collides in the solver but is deliberately absent from scene
  // queries, otherwise each suspension ray can hit its own chassis before road.
  // Keep Vehicle2's helper-owned wheel/query defaults for the same reason.
  if (world.filterData) {
    integration.physxActorSimulationFilterData = world.filterData;
    integration.physxActorWheelSimulationFilterData = world.filterData;
  }

  const cookingParams = alloc(new PhysX.PxCookingParams(world.tolerances));
  const differential = PhysX.EngineDriveVehicleEnum?.eDIFFTYPE_FOURWHEELDRIVE ?? 1;
  if (!vehicle.initialize(world.physics, cookingParams, world.defaultMaterial, differential, true)) return null;

  const actor = vehicle.physXState.physxActor.rigidBody;
  actor.setGlobalPose(alloc(new PhysX.PxTransform(
    alloc(new PhysX.PxVec3(...config.position)),
    alloc(new PhysX.PxQuat(0, Math.sin(config.yaw / 2), 0, Math.cos(config.yaw / 2))),
  )), true);
  actor.setSolverIterationCounts?.(8, 2);
  actor.setMaxDepenetrationVelocity?.(8);
  if (PhysX.PxRigidBodyFlagEnum?.eENABLE_CCD !== undefined) {
    actor.setRigidBodyFlag?.(PhysX.PxRigidBodyFlagEnum.eENABLE_CCD, true);
  }
  world.scene.addActor(actor);

  const context = new PhysX.PxVehiclePhysXSimulationContext();
  context.setToDefault?.();
  context.frame.lngAxis = PhysX.PxVehicleAxesEnum.ePosX;
  context.frame.latAxis = PhysX.PxVehicleAxesEnum.eNegZ;
  context.frame.vrtAxis = PhysX.PxVehicleAxesEnum.ePosY;
  context.scale.scale = 1;
  context.gravity = alloc(new PhysX.PxVec3(...world.gravity));
  context.physxScene = world.scene;
  context.physxActorUpdateMode = PhysX.PxVehiclePhysXActorUpdateModeEnum.eAPPLY_ACCELERATION;
  const sweepMesh = topLevel.VehicleUnitCylinderSweepMeshCreate.call(
    topLevel, base.frame, world.physics, cookingParams,
  );
  if (sweepMesh) context.physxUnitCylinderSweepMesh = sweepMesh;
  return { actor, context, sweepMesh };
}
