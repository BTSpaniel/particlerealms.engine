// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { destroyTracked } from './VehicleBindings.js';

const DRIVE_MODES = new Set(['neutral', 'forward', 'reverse']);

function clamp01(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }

export function createVehicleController({
  PhysX, world, topLevel, vehicle, actor, context, sweepMesh, tracked, config, gears,
}) {
  let driveMode = 'neutral';
  let destroyed = false;
  vehicle.transmissionCommandState.targetGear = gears.neutral;
  vehicle.commandState.nbBrakes = 2;

  const selectGear = (mode) => {
    driveMode = DRIVE_MODES.has(mode) ? mode : 'neutral';
    vehicle.transmissionCommandState.targetGear = driveMode === 'forward'
      ? gears.automatic
      : driveMode === 'reverse' ? gears.reverse : gears.neutral;
  };

  return {
    vehicle,
    actor,
    wheelRadius: config.wheelRadius,
    wheelOffsets: config.wheelOffsets,
    get driveMode() { return driveMode; },
    setDriveMode: selectGear,
    setReverse(reverse) { selectGear(reverse ? 'reverse' : 'forward'); },
    setControls(throttle, brakeValue, steer, handbrakeValue = 0) {
      const commands = vehicle.commandState;
      commands.throttle = driveMode === 'neutral' ? 0 : clamp01(throttle);
      const idleHold = driveMode === 'neutral' && commands.throttle === 0 ? 0.22 : 0;
      commands.set_brakes(0, Math.max(idleHold, clamp01(brakeValue)));
      commands.set_brakes(1, clamp01(handbrakeValue));
      commands.steer = Math.max(-1, Math.min(1, Number(steer) || 0));
    },
    step(dt) {
      if (!destroyed && dt > 0) vehicle.step(dt, context);
    },
    readPose() {
      const pose = actor.getGlobalPose();
      const velocity = actor.getLinearVelocity?.();
      const quaternion = [pose.q.x, pose.q.y, pose.q.z, pose.q.w];
      const yaw = Math.atan2(
        2 * (pose.q.w * pose.q.y + pose.q.x * pose.q.z),
        1 - 2 * (pose.q.y * pose.q.y + pose.q.x * pose.q.x),
      );
      const wheels = [];
      for (let index = 0; index < 4; index++) {
        const rigidBody = vehicle.baseState.get_wheelRigidBody1dStates(index);
        const suspension = vehicle.baseState.get_suspensionStates?.(index);
        const road = vehicle.baseState.get_roadGeomStates?.(index);
        const grip = vehicle.baseState.get_tireGripStates?.(index);
        wheels.push({
          rotationAngle: rigidBody?.rotationAngle ?? 0,
          rotationSpeed: rigidBody?.rotationSpeed ?? 0,
          steer: index < 2 ? vehicle.commandState.steer * config.maxSteerRad : 0,
          jounce: suspension?.jounce ?? 0,
          separation: suspension?.separation ?? 0,
          grounded: road?.hitState === true,
          roadFriction: road?.friction ?? 0,
          tireLoad: grip?.load ?? 0,
          tireFriction: grip?.friction ?? 0,
        });
      }
      const gearbox = vehicle.engineDriveState?.gearboxState;
      const engine = vehicle.engineDriveState?.engineState;
      const gearIndex = gearbox?.currentGear ?? gears.neutral;
      const gear = gearIndex === gears.reverse ? 'R'
        : gearIndex === gears.neutral ? 'N' : String(gearIndex - gears.neutral);
      return {
        position: [pose.p.x, pose.p.y, pose.p.z],
        linearVelocity: velocity ? [velocity.x, velocity.y, velocity.z] : [0, 0, 0],
        quaternion,
        yaw,
        wheels,
        gear,
        gearIndex,
        rpm: (engine?.rotationSpeed ?? 0) * 60 / (2 * Math.PI),
        driveMode,
      };
    },
    reset(position, yaw = 0) {
      const point = new PhysX.PxVec3(position[0], position[1], position[2]);
      const rotation = new PhysX.PxQuat(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
      const pose = new PhysX.PxTransform(point, rotation);
      const zero = new PhysX.PxVec3(0, 0, 0);
      actor.setGlobalPose(pose, true);
      actor.setLinearVelocity?.(zero, true);
      actor.setAngularVelocity?.(zero, true);
      selectGear('neutral');
      PhysX.destroy(point);
      PhysX.destroy(rotation);
      PhysX.destroy(pose);
      PhysX.destroy(zero);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      try { world.scene.removeActor(actor); } catch (_) { /* scene gone */ }
      try {
        if (sweepMesh) topLevel.VehicleUnitCylinderSweepMeshDestroy.call(topLevel, sweepMesh);
      } catch (_) { /* released */ }
      try { vehicle.destroyState?.(); } catch (_) { /* released */ }
      try { PhysX.destroy(context); } catch (_) { /* released */ }
      destroyTracked(PhysX, tracked);
    },
  };
}
