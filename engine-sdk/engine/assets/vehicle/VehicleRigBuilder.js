// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// engine/assets/vehicle/VehicleRigBuilder.js — assemble a VehicleAsset (spec §11).
//
// Vehicles are rigged, not merely loaded. This turns detected wheels + chassis
// into explicit runtime data: WheelSlots (with suspension/tire/drivetrain),
// front-axle steering, a compound-collider descriptor for the chassis (built via
// the engine's ConvexDecomposition on demand), and a confidence. Detection
// failures (e.g. wheels merged into the body) flag needsCorrection rather than
// guessing — the editor exposes every decision (rule 62).

import { detectWheels } from './WheelDetector.js';
import { detectChassis } from './ChassisDetector.js';
import { createWheelSlot, createVehicleAsset, DRIVETRAIN } from './WheelSlot.js';
import { statsMean } from '../../core/math/MathStatistics.js';

function slotFromCandidate(c, drivetrain) {
  const isFront = c.side?.startsWith('front');
  const isRear = c.side?.startsWith('rear');
  const driven = drivetrain === DRIVETRAIN.AWD || (drivetrain === DRIVETRAIN.FWD && isFront) || (drivetrain === DRIVETRAIN.RWD && isRear);
  return createWheelSlot({
    id: c.side || c.name,
    visualNode: c.nodeId,
    localCenter: c.localCenter,
    localPivot: c.localPivot,
    radius: c.radius,
    width: c.width,
    axleAxisLocal: c.axleAxisLocal,
    canSteer: !!isFront,
    driven,
    confidence: c.score,
    suspension: { restLength: Math.max(0.2, c.radius * 1.0) },
  });
}

/**
 * Build a vehicle rig for a model and attach it at model.rigs.vehicle.
 * @param {object} model EngineModel
 * @param {object} [opts] { drivetrain, massKg, physicsMode }
 * @returns {object} the VehicleAsset
 */
export function buildVehicleRig(model, opts = {}) {
  const authoredDriveMode = model?.metadata?.vehicleProfile?.driveMode;
  const authoredDrivetrain = authoredDriveMode === 'front-wheel' ? DRIVETRAIN.FWD
    : authoredDriveMode === 'rear-wheel' ? DRIVETRAIN.RWD
      : authoredDriveMode === 'all-wheel' ? DRIVETRAIN.AWD : null;
  const drivetrain = opts.drivetrain ?? authoredDrivetrain ?? DRIVETRAIN.RWD;
  const wheels = detectWheels(model, opts);
  const wheelNodeIds = wheels.map((w) => w.nodeId);
  const { chassisNode, bodyNodes, glassNodes, lightNodes, doorNodes } = detectChassis(model, wheelNodeIds);

  const wheelSlots = wheels.map((c) => slotFromCandidate(c, drivetrain));

  // Confidence: needs ≥3 wheels to be a credible vehicle; flag for correction otherwise.
  const wheelConf = wheels.length ? statsMean(wheels.map((wheel) => wheel.score)) : 0;
  const enough = wheels.length >= 3;
  const confidence = enough ? Math.min(1, wheelConf * (wheels.length >= 4 ? 1 : 0.8)) : wheelConf * 0.4;

  const asset = createVehicleAsset({
    chassisNode, bodyNodes, glassNodes, lightNodes, doorNodes,
    wheelSlots, drivetrain, physicsMode: opts.physicsMode,
    massKg: opts.massKg ?? model?.metadata?.vehicleProfile?.mass,
    confidence,
    needsCorrection: !enough,
    // Compound-collider descriptor: the chassis mesh is decomposed into convex
    // hulls by the engine's ConvexDecomposition when physics is instantiated.
    collisionProfile: chassisNode ? { kind: 'compound-convex', sourceNode: chassisNode, build: 'sim/physics/ConvexDecomposition' } : null,
  });

  model.rigs.vehicle = asset;
  model.metadata.vehicle = { wheelCount: wheels.length, confidence, needsCorrection: !enough };
  return asset;
}
