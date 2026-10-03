// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

// Stable, side-effect-free compute surface. Providers and raw worker ABI remain internal.
export { ComputeRuntime, createComputeRuntime } from './ComputeRuntime.js';
export { listComputeOperations, getComputeOperation, COMPUTE_OPERATION_VERSION } from './ComputeOperations.js';
export { detectWasmCapabilities, detectWasmSimd, detectWasmThreads } from './WasmCapabilities.js';
export { ComputeError } from './ComputeErrors.js';
export { getComputeContract, validateComputeContract, COMPUTE_CONTRACT_SCHEMA_VERSION, COMPUTE_CONTRACT_SOURCE_HASH } from './ComputeContracts.js';
