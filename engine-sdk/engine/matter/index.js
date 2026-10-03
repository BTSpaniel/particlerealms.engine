// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Unified real-world matter platform.
 *
 * Material evidence, mutable region state, physical models, solver adapters,
 * topology events, and conservation receipts are intentionally separate.
 */

export * from './contracts/MatterContracts.js';
export * from './catalog/EngineMatterCatalog.js';
export * from './models/MatterModelRegistry.js';
export * from './coupling/MatterDependencyGraph.js';
export * from './coupling/MatterCouplingScheduler.js';
export * from './state/MatterStateStore.js';
export * from './state/MatterConservationLedger.js';
export * from './transformations/MatterOperators.js';
export * from './adapters/CompositeMaterialMatterAdapter.js';
export * from './adapters/MatterBackendAdapterRegistry.js';
export * from './codec/index.js';
export * from './runtime/index.js';
export * from './fluid/index.js';
export * from './structural/index.js';
export * from './transcoding/index.js';
export * from './fabric/index.js';
export * from './MatterKernel.js';
