// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/vehicle/WheelSlot.js — vehicle rig schemas (spec §11).
//
// A vehicle is NOT a mesh: it's a visual model + chassis collider + wheel slots
// + suspension + tire model + drivetrain. Wheel runtime data is explicit and
// separate from the visible wheel mesh (matching Jolt/Unity wheel colliders), so
// visuals follow physics rather than the other way around.

/**
 * A wheel slot: the runtime data for one wheel, decoupled from its visual mesh.
 */
export function createWheelSlot(init = {}) {
  init = init || {};
  return {
    id: init.id ?? 'wheel',
    visualNode: init.visualNode ?? null,
    hubNode: init.hubNode ?? null,

    localCenter: init.localCenter ?? [0, 0, 0],
    localPivot: init.localPivot ?? [0, 0, 0], // mesh-local hub center (spin pivot)
    radius: init.radius ?? 0.34,
    width: init.width ?? 0.22,

    axleAxisLocal: init.axleAxisLocal ?? [1, 0, 0],
    steerAxisLocal: init.steerAxisLocal ?? [0, 1, 0],
    suspensionAxisLocal: init.suspensionAxisLocal ?? [0, -1, 0],

    canSteer: init.canSteer ?? false,
    driven: init.driven ?? false,
    brake: init.brake ?? true,

    suspension: createSuspension(init.suspension),
    tire: createTireProfile(init.tire),

    meshCorrectionRotation: init.meshCorrectionRotation ?? [0, 0, 0, 1],
    confidence: init.confidence ?? 0.5,
  };
}

export function createSuspension(init = {}) {
  init = init || {};
  return {
    restLength: init.restLength ?? 0.35,
    travel: init.travel ?? 0.2,
    stiffness: init.stiffness ?? 35000,  // N/m
    damping: init.damping ?? 4500,       // N·s/m
  };
}

export function createTireProfile(init = {}) {
  init = init || {};
  return {
    gripLongitudinal: init.gripLongitudinal ?? 1.0,
    gripLateral: init.gripLateral ?? 0.95,
    slipStiffness: init.slipStiffness ?? 12,
    rollingResistance: init.rollingResistance ?? 0.015,
  };
}

export const DRIVETRAIN = Object.freeze({ FWD: 'fwd', RWD: 'rwd', AWD: 'awd' });
export const WHEEL_PHYSICS_MODE = Object.freeze({
  RAYCAST: 'raycast', SPHERECAST: 'spherecast', SHAPECAST: 'shapecast', ARTICULATED: 'articulated',
});

/**
 * The assembled vehicle rig produced by VehicleRigBuilder. It references the
 * model's nodes/meshes and carries explicit runtime data; it can drive the
 * engine's GPUVehicle physics or the CPU WheelPhysics fallback.
 */
export function createVehicleAsset(init = {}) {
  init = init || {};
  return {
    chassisNode: init.chassisNode ?? null,
    bodyNodes: init.bodyNodes ?? [],
    glassNodes: init.glassNodes ?? [],
    lightNodes: init.lightNodes ?? [],
    doorNodes: init.doorNodes ?? [],

    wheelSlots: init.wheelSlots ?? [],
    drivetrain: init.drivetrain ?? DRIVETRAIN.RWD,
    physicsMode: init.physicsMode ?? WHEEL_PHYSICS_MODE.RAYCAST,

    collisionProfile: init.collisionProfile ?? null, // compound hull descriptor (built on demand)
    massKg: init.massKg ?? 1200,
    confidence: init.confidence ?? 0,
    needsCorrection: init.needsCorrection ?? false,
  };
}
