// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * engine/core/profiler/index.js - Profiling & Performance Barrel Export
 */

// Dual RNG (sync vs visual random)
export {
    DualRNG,
    getGlobalRNG,
    initGlobalRNG,
    positionHash,
} from './DualRNG.js';

// Frame budget
export {
    FrameBudgetManager,
    getFrameBudgetManager,
    shouldSkipWork,
    DEFAULT_BUDGETS,
} from './FrameBudgetManager.js';

// Performance optimization
export { PerformanceOptimizer } from './PerformanceOptimizer.js';

// Gameplay profiler (existing)
export { GameplayProfiler } from './GameplayProfiler.js';
