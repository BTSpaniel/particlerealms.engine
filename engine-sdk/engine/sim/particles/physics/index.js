// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * physics/index.js — Organized re-exports for GPU physics compute solvers.
 * New code should import from here. Original files remain in parent directory.
 */

// Orchestrator
export * from '../ParticleSimWorld.js';

// Forces
export * from './forces/index.js';

// Fluids
export * from './fluids/index.js';

// Constraints
export * from './constraints/index.js';

// Collision
export * from './collision/index.js';

// Compute utilities
export * from './compute/index.js';
