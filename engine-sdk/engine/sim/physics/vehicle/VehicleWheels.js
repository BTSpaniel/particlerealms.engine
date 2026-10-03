// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { tireForceExtension } from './VehicleBindings.js';
import { constraintSpringDamperCoefficients } from '../../../core/math/ConstraintMath.js';

const FRICTION_VS_SLIP = [[0.0, 1.0], [0.1, 1.0], [1.0, 1.0]];
const LOAD_FILTER = [[0.0, 0.2308], [3.0, 3.0]];

export function configureVehicleWheels(PhysX, topLevel, vehicle, config, alloc) {
  const base = vehicle.baseParams;
  const tireExtension = tireForceExtension(PhysX);
  if (!tireExtension) throw new Error('PhysX tire parameter extension is unavailable');

  const coordinates = alloc(new PhysX.PxArray_PxVec3(4));
  for (let wheel = 0; wheel < 4; wheel++) {
    const value = coordinates.get(wheel);
    value.x = config.wheelOffsets[wheel][0];
    value.y = config.wheelOffsets[wheel][1];
    value.z = config.wheelOffsets[wheel][2];
  }
  const sprungMasses = alloc(new PhysX.PxArray_PxReal(4));
  topLevel.VehicleComputeSprungMasses.call(
    topLevel, 4, coordinates, config.mass, PhysX.PxVehicleAxesEnum.eNegY, sprungMasses,
  );

  base.suspensionStateCalculationParams.suspensionJounceCalculationType =
    PhysX.PxVehicleSuspensionJounceCalculationTypeEnum.eSWEEP;
  base.suspensionStateCalculationParams.limitSuspensionExpansionVelocity = false;

  for (let index = 0; index < 4; index++) {
    const offset = config.wheelOffsets[index];
    const suspension = base.get_suspensionParams(index);
    suspension.suspensionAttachment = alloc(new PhysX.PxTransform(
      alloc(new PhysX.PxVec3(offset[0], offset[1], offset[2])),
      alloc(new PhysX.PxQuat(0, 0, 0, 1)),
    ));
    suspension.suspensionTravelDir = alloc(new PhysX.PxVec3(0, -1, 0));
    suspension.suspensionTravelDist = config.suspensionTravel;
    suspension.wheelAttachment = alloc(new PhysX.PxTransform(
      alloc(new PhysX.PxVec3(0, 0, 0)),
      alloc(new PhysX.PxQuat(0, 0, 0, 1)),
    ));

    const sprungMass = sprungMasses.get(index);
    const force = base.get_suspensionForceParams(index);
    const spring = constraintSpringDamperCoefficients({
      mode: 'frequency',
      frequencyHz: config.suspensionFreqHz,
      dampingRatio: 0.7,
      effectiveMass: sprungMass,
      timeStep: 1 / 120,
    });
    force.sprungMass = sprungMass;
    force.stiffness = spring.stiffness;
    force.damping = spring.damping;

    const tire = base.get_tireForceParams(index);
    tire.restLoad = (sprungMass + config.wheelMass) * 9.81;
    tire.longStiff = 24525 * (config.mass / 2014.4);
    tire.latStiffX = 0.01;
    tire.latStiffY = tire.restLoad * 21.0;
    tire.camberStiff = 0;
    for (let row = 0; row < FRICTION_VS_SLIP.length; row++) {
      tireExtension.setFrictionVsSlip.call(tireExtension, tire, row, 0, FRICTION_VS_SLIP[row][0]);
      tireExtension.setFrictionVsSlip.call(tireExtension, tire, row, 1, FRICTION_VS_SLIP[row][1]);
    }
    for (let row = 0; row < LOAD_FILTER.length; row++) {
      tireExtension.setLoadFilter.call(tireExtension, tire, row, 0, LOAD_FILTER[row][0]);
      tireExtension.setLoadFilter.call(tireExtension, tire, row, 1, LOAD_FILTER[row][1]);
    }

    const wheel = base.get_wheelParams(index);
    wheel.radius = config.wheelRadius;
    wheel.halfWidth = config.wheelWidth / 2;
    wheel.mass = config.wheelMass;
    wheel.moi = 0.5 * config.wheelMass * config.wheelRadius * config.wheelRadius;
    wheel.dampingRate = 0.25;
  }
}
