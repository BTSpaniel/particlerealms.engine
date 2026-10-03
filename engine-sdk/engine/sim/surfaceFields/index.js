// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
export { createSurfaceFieldTopology, DEFAULT_SURFACE_DOMAINS, SURFACE_FIELD_CHANNELS, SURFACE_NO_NEIGHBOR } from './SurfaceFieldTopology.js';
export { loadSurfaceFieldMaterials, resolveSurfaceFieldMaterials, SURFACE_MATERIAL_IDS, SURFACE_CALCITE_MATERIAL_RESOURCE } from './SurfaceFieldMaterials.js';
export { SurfaceFieldWorld, createSurfaceFieldWorld, transportSurfaceWater, surfaceFieldSolidDepths, SURFACE_BRUSH_RATES } from './SurfaceFieldWorld.js';
export { encodeSurfaceFieldCheckpoint, decodeSurfaceFieldCheckpoint } from './SurfaceFieldCheckpoint.js';
export { SurfaceFieldChemicalInventory, SURFACE_OIL_PROFILE, SURFACE_ACID_PROFILE, SURFACE_LIQUID_CLOSURE, SURFACE_CHEMICAL_MOLAR_MASS_KG } from './SurfaceFieldChemistry.js';
export { SurfaceFieldStructure } from './SurfaceFieldStructure.js';
export { createSurfaceFieldMotion, surfaceFieldMotionPoint } from './SurfaceFieldMotion.js';
export { SurfaceFieldSupportGeometry } from './SurfaceFieldSupportGeometry.js';
export { SurfaceFieldSupports, SURFACE_SUPPORT_PROFILE } from './SurfaceFieldSupports.js';
export { SURFACE_IRON_PROFILE } from './SurfaceFieldChemistry.js';
export { createSurfaceFieldGpuRuntime, SURFACE_WATER_WGSL } from './SurfaceFieldGpu.js';
export { createSurfaceFieldWorker } from './SurfaceFieldWorkerClient.js';
