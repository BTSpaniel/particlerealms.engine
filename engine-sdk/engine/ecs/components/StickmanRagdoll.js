// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { defineComponentType } from "./ComponentRegistry.js";

const defaults = {
  bodies: null,
  joints: null,
  bonePairs: null,
  kinematic: true,
  activeRig: null,
  activeRigState: null,
};

function normalize(input) {
  const src = input && typeof input === "object" ? input : {};
  const bodies = Array.isArray(src.bodies) ? src.bodies : null;
  const joints = Array.isArray(src.joints) ? src.joints : null;
  const bonePairs = Array.isArray(src.bonePairs) ? src.bonePairs : null;
  const kinematic = typeof src.kinematic === "boolean" ? src.kinematic : defaults.kinematic;
  const activeRig = src.activeRig && typeof src.activeRig === "object" ? normalizeActiveRig(src.activeRig) : defaults.activeRig;
  const activeRigState = src.activeRigState && typeof src.activeRigState === "object" ? { ...src.activeRigState } : defaults.activeRigState;
  return {
    bodies,
    joints,
    bonePairs,
    kinematic,
    activeRig,
    activeRigState,
  };
}

function normalizeActiveRig(input) {
  return {
    enabled: input.enabled !== false,
    backend: input.backend || "articulation",
    preset: input.preset || "HumanAverage",
    massKg: typeof input.massKg === "number" ? input.massKg : 80,
    frequencyHz: typeof input.frequencyHz === "number" ? input.frequencyHz : 4.5,
    dampingRatio: typeof input.dampingRatio === "number" ? input.dampingRatio : 1.0,
    driveMode: input.driveMode || "acceleration",
    poseState: input.poseState || "idle_stand",
    intent: input.intent && typeof input.intent === "object" ? { ...input.intent } : {},
    selfCollision: input.selfCollision !== false,
    disableParentChildCollisions: input.disableParentChildCollisions !== false,
  };
}

function validate(value) {
  return normalize(value);
}

export const StickmanRagdollDefinition = defineComponentType({
  name: "StickmanRagdoll",
  version: 1,
  defaults,
  normalize,
  validate,
});

export function createStickmanRagdoll(initial) {
  return StickmanRagdollDefinition.create(initial);
}
