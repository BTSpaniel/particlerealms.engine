// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Task Scheduler System - Unified Exports
 * 
 * Cooperative multitasking for WebGPU applications:
 * - TaskScheduler: Frame-budget-aware job execution
 * - WorkerPool: Parallel job dispatch via Web Workers
 * - Job priorities and dependency tracking
 */

export {
    TaskScheduler,
    Job,
    JobPriority,
    WorkerPool,
    scheduler,
    workerTemplate,
} from './TaskScheduler.js';
