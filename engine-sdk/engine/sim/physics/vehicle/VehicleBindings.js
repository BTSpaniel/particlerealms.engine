// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// Vehicle2 WebIDL capability adapters. The generated declaration exposes
// several helpers as statics while the emitted JavaScript places them on the
// constructor prototype, so all vehicle code crosses that mismatch here.

const initializedVehicleModules = new WeakSet();

export function vehicleTopLevelFunctions(PhysX) {
  const type = PhysX?.PxVehicleTopLevelFunctions;
  if (!type) return null;
  const api = typeof type.InitVehicleExtension === 'function' ? type : type.prototype;
  if (!api || typeof api.InitVehicleExtension !== 'function'
    || typeof api.VehicleComputeSprungMasses !== 'function'
    || typeof api.VehicleUnitCylinderSweepMeshCreate !== 'function'
    || typeof api.VehicleUnitCylinderSweepMeshDestroy !== 'function') return null;
  return api;
}

export function tireForceExtension(PhysX) {
  const type = PhysX?.PxVehicleTireForceParamsExt;
  if (!type) return null;
  const api = typeof type.setFrictionVsSlip === 'function' ? type : type.prototype;
  return api && typeof api.setFrictionVsSlip === 'function' && typeof api.setLoadFilter === 'function'
    ? api
    : null;
}

export function ensureVehicleExtension(PhysX, foundation) {
  const topLevel = vehicleTopLevelFunctions(PhysX);
  if (!topLevel || !PhysX.EngineDriveVehicle) return null;
  if (initializedVehicleModules.has(PhysX)) return topLevel;
  if (!topLevel.InitVehicleExtension.call(topLevel, foundation)) return null;
  initializedVehicleModules.add(PhysX);
  return topLevel;
}

export function isPhysXVehicleSupported(world) {
  return !!(world?.module?.EngineDriveVehicle && vehicleTopLevelFunctions(world.module));
}

export function destroyTracked(PhysX, tracked) {
  for (const object of tracked.splice(0)) {
    try { PhysX.destroy(object); } catch (_) { /* already released */ }
  }
}
