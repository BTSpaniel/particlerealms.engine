// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * @deprecated Use PhysicsChain instead. This file re-exports for backward compatibility.
 */
import { PhysicsChainDefinition, createPhysicsChain } from "./PhysicsChain.js";

/** @deprecated Use PhysicsChainDefinition */
export const PhysicsRopeDefinition = PhysicsChainDefinition;

/** @deprecated Use createPhysicsChain */
export function createPhysicsRope(initial) {
    return createPhysicsChain(initial);
}
