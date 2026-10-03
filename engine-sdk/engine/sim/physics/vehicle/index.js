// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { destroyTracked, ensureVehicleExtension, isPhysXVehicleSupported } from './VehicleBindings.js';
import { resolveVehicleConfig } from './VehicleConfig.js';
import { configureVehicleChassis, initializeVehicleActor } from './VehicleChassis.js';
import { configureVehicleWheels } from './VehicleWheels.js';
import { configureVehicleEngine } from './VehicleEngine.js';
import { configureVehicleDrivetrain } from './VehicleDrivetrain.js';
import { createVehicleController } from './VehicleController.js';

export { isPhysXVehicleSupported };

/** Build a complete PhysX Vehicle2 car from independently owned subsystems. */
export function createPhysXVehicle(world, options = {}) {
  if (!world?.ready || !world.module || !world.physics || !world.scene) return null;
  const PhysX = world.module;
  const topLevel = ensureVehicleExtension(PhysX, world.foundation);
  if (!topLevel) return null;
  const config = resolveVehicleConfig(options);
  const tracked = [];
  const alloc = (object) => { tracked.push(object); return object; };
  let vehicle = null;
  let actorState = null;
  try {
    vehicle = new PhysX.EngineDriveVehicle();
    configureVehicleChassis(PhysX, vehicle, config, alloc);
    configureVehicleWheels(PhysX, topLevel, vehicle, config, alloc);
    configureVehicleEngine(vehicle, config);
    const gears = configureVehicleDrivetrain(PhysX, vehicle);
    actorState = initializeVehicleActor(PhysX, topLevel, world, vehicle, config, alloc);
    if (!actorState) throw new Error('Vehicle2 actor initialization failed');
    return createVehicleController({
      PhysX, world, topLevel, vehicle, tracked, config, gears, ...actorState,
    });
  } catch (error) {
    if (actorState?.actor) {
      try { world.scene.removeActor(actorState.actor); } catch (_) { /* not added */ }
    }
    if (actorState?.sweepMesh) {
      try { topLevel.VehicleUnitCylinderSweepMeshDestroy.call(topLevel, actorState.sweepMesh); } catch (_) { /* released */ }
    }
    try { vehicle?.destroyState?.(); } catch (_) { /* released */ }
    try { if (actorState?.context) PhysX.destroy(actorState.context); } catch (_) { /* released */ }
    destroyTracked(PhysX, tracked);
    console.error('[PhysXVehicle] setup failed:', error);
    return null;
  }
}
