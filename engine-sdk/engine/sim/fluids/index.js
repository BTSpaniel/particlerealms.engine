// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * engine/sim/fluids/index.js - Fluid Simulation Barrel Export
 */

// Core fluid simulation
export { FluidSimulator } from './FluidSimulation.js';

// Reformulated compressible Navier–Stokes (shear + longitudinal viscosity)
export {
  createCompressibleNSSolver,
  setNSMaterials,
  setNSField,
  stepCompressibleNS,
  nsFieldBuffers,
  readNSDiagnostics,
  destroyCompressibleNSSolver,
  NS_MAX_MATERIALS,
  NS_MAX_SOURCES,
  NS_FLAG_IMMOVABLE,
  NS_FLAG_FLUID,
  NS_FLAG_PHASE,
  NS_FLAG_GAS,
  NS_SOURCE_MELT,
  NS_SOURCE_SOLID,
  NS_SOURCE_INFLOW,
  NS_SOURCE_HEAT,
  NS_SOURCE_ACOUSTIC,
  NS_SOURCE_CLEAR,
  NS_SOURCE_WALL_VELOCITY,
} from './CompressibleNavierStokes.js';

// Wave physics (FDTD)
export { FDTDSolver } from './FDTDSolver.js';

// Photonics
export { PhotonicCrystal } from './PhotonicCrystal.js';
export { PhasorRays } from './PhasorRays.js';

// Existing fluid systems
export { FluidSimWorld } from './FluidSimWorld.js';
export { FluidCpuWorld } from './FluidCpuWorld.js';
export { FluidMPM } from './FluidMPM.js';
export { FluidPhaseChange } from './FluidPhaseChange.js';
export { FluidBoundary } from './FluidBoundary.js';
export { FluidSourceSplat } from './FluidSourceSplat.js';
export { FluidWorldDomain } from './FluidWorldDomain.js';
export { FluidConfig } from './FluidConfig.js';
