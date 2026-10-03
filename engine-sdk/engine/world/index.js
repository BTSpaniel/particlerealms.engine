// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * engine/world/index.js - World Systems Barrel Export
 */

// World Schema (unified type definitions)
export {
  BIOME_TYPES,
  CLIMATE_PARAMS,
  CLIMATE_SCHEMA,
  BIOME_SCHEMA,
  NOISE_SCHEMA,
  EROSION_TYPES,
  TERRAIN_SCHEMA,
  CHUNK_SIZES,
  ZONE_TYPES,
  CHUNK_STREAMING_SCHEMA,
  WEATHER_TYPES,
  WEATHER_SCHEMA,
  TIME_PHASES,
  WORLD_TIME_SCHEMA,
  WORLD_CONFIG_SCHEMA,
  getBiomeTypeId,
  getBiomeTypeName,
  validateTerrain,
  validateWeather,
  validateWorldConfig,
  createDefaultTerrain,
  createDefaultWeather,
  createDefaultWorldConfig,
  createClimateFromPosition,
  getBiomeFromClimate,
  getWeatherPreset,
  getTimePhase,
} from './WorldSchema.js';

// Time systems (core engine - day/night/seasons)
export { TICKS_PER_SECOND, TICK_DURATION_MS, TIMESCALE, SEASON, MOON_PHASE, CALENDAR_CONFIG, GameDate, HierarchicalTimingWheel, WorldTimeSystem, WorldTimeSystem as WorldTime } from './WorldTime.js';

// Planet/coordinates
export { PlanetaryWorld, FACE, DEFAULT_PLANET_RADIUS, SHELL_THICKNESS, ascProject, ascInverse, faceToDirection, planetaryToWorld, worldToPlanetary, getGravityDirection, getUpDirection, planetaryChunkKey, parsePlanetaryChunkKey, worldToPlanetaryChunk, PlanetaryWorld as PlanetaryCoords } from './PlanetaryCoords.js';
export {
    SECTOR_SIZE,
    SECTOR_HALF,
    SECTOR_INV,
    MAX_SAFE_SECTOR,
    HierarchicalPosition,
    BigHierarchicalPosition,
    getSectorsInRadius,
    parseSectorKey,
    getChunkKeyHierarchical,
    worldToHierarchical,
    hierarchicalToWorld,
    toCameraSpace,
} from './HierarchicalCoords.js';
export {
    REBASE_THRESHOLD,
    REBASE_SNAP,
    FloatingOrigin,
    shiftObjects,
    shiftPosition,
} from './FloatingOrigin.js';
export {
    G as GRAVITATIONAL_CONSTANT,
    DEFAULT_PLANET_MASS,
    DEFAULT_ROTATION_PERIOD,
    MIN_GRAVITY,
    splitDouble,
    combineDouble,
    DoubleVec3,
    Quaternion as PlanetQuaternion,
    Planet,
    PlanetarySystem,
} from './PlanetPhysics.js';
export { SurfaceAttachment } from './SurfaceAttachment.js';

// Zone management
export { ZoneManager } from './ZoneManager.js';

// Re-export from subdirectories
export * from './generation/index.js';
export * from './streaming/index.js';
export * from './storage/index.js';
