// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * WorldSchema.js - Unified JSON Schema for World Generation
 * 
 * Defines consistent data structures for:
 * - Biome types and properties
 * - Climate parameters
 * - Terrain generation settings
 * - Chunk/zone configurations
 * - Weather and time systems
 * 
 * All world generation code should use these schemas for consistency.
 */

// ============================================================================
// BIOME TYPES
// ============================================================================

/**
 * Biome type definitions
 */
export const BIOME_TYPES = {
  ocean: { id: 0, label: "Ocean", color: [0.1, 0.3, 0.6], isWater: true },
  beach: { id: 1, label: "Beach", color: [0.9, 0.85, 0.6], isWater: false },
  plains: { id: 2, label: "Plains", color: [0.5, 0.7, 0.3], isWater: false },
  forest: { id: 3, label: "Forest", color: [0.2, 0.5, 0.2], isWater: false },
  desert: { id: 4, label: "Desert", color: [0.9, 0.8, 0.5], isWater: false },
  tundra: { id: 5, label: "Tundra", color: [0.7, 0.75, 0.8], isWater: false },
  mountains: { id: 6, label: "Mountains", color: [0.5, 0.5, 0.55], isWater: false },
  swamp: { id: 7, label: "Swamp", color: [0.3, 0.4, 0.25], isWater: false },
  jungle: { id: 8, label: "Jungle", color: [0.1, 0.4, 0.15], isWater: false },
  taiga: { id: 9, label: "Taiga", color: [0.25, 0.4, 0.35], isWater: false },
  savanna: { id: 10, label: "Savanna", color: [0.7, 0.6, 0.3], isWater: false },
  mesa: { id: 11, label: "Mesa", color: [0.8, 0.5, 0.3], isWater: false },
  icePlains: { id: 12, label: "Ice Plains", color: [0.9, 0.95, 1.0], isWater: false },
  mushroom: { id: 13, label: "Mushroom Island", color: [0.6, 0.4, 0.6], isWater: false },
  river: { id: 14, label: "River", color: [0.2, 0.4, 0.7], isWater: true },
  lake: { id: 15, label: "Lake", color: [0.15, 0.35, 0.65], isWater: true },
  volcanic: { id: 16, label: "Volcanic", color: [0.3, 0.2, 0.2], isWater: false },
  deepOcean: { id: 17, label: "Deep Ocean", color: [0.05, 0.15, 0.4], isWater: true },
};

/**
 * Get biome type ID from name
 */
export function getBiomeTypeId(biomeName) {
  return BIOME_TYPES[biomeName]?.id ?? BIOME_TYPES.plains.id;
}

/**
 * Get biome type name from ID
 */
export function getBiomeTypeName(biomeId) {
  for (const [name, biome] of Object.entries(BIOME_TYPES)) {
    if (biome.id === biomeId) return name;
  }
  return "plains";
}

// ============================================================================
// CLIMATE PARAMETERS
// ============================================================================

/**
 * Climate parameter ranges (0-1)
 */
export const CLIMATE_PARAMS = {
  temperature: { id: 0, label: "Temperature", desc: "0=freezing, 1=hot", default: 0.5 },
  humidity: { id: 1, label: "Humidity", desc: "0=arid, 1=wet", default: 0.5 },
  continentalness: { id: 2, label: "Continentalness", desc: "0=ocean, 1=inland", default: 0.5 },
  erosion: { id: 3, label: "Erosion", desc: "0=peaks, 1=flat plains", default: 0.5 },
  weirdness: { id: 4, label: "Weirdness", desc: "0=normal, 1=unusual biomes", default: 0.5 },
};

/**
 * Climate schema for biome selection
 */
export const CLIMATE_SCHEMA = {
  name: "Climate",
  fields: {
    temperature: { type: "number", default: 0.5, min: 0, max: 1, desc: "Temperature (0=cold, 1=hot)" },
    humidity: { type: "number", default: 0.5, min: 0, max: 1, desc: "Humidity (0=dry, 1=wet)" },
    continentalness: { type: "number", default: 0.5, min: 0, max: 1, desc: "Distance from ocean" },
    erosion: { type: "number", default: 0.5, min: 0, max: 1, desc: "Erosion level" },
    weirdness: { type: "number", default: 0.5, min: 0, max: 1, desc: "Unusual terrain factor" },
  },
};

// ============================================================================
// BIOME SCHEMA
// ============================================================================

/**
 * Biome definition schema
 */
export const BIOME_SCHEMA = {
  name: "Biome",
  fields: {
    id: { type: "number", required: true, desc: "Unique biome ID" },
    name: { type: "string", required: true, desc: "Display name" },
    surfaceMaterial: { type: "number", default: 0, desc: "Surface block material ID" },
    subsurfaceMaterial: { type: "number", default: 0, desc: "Below-surface material ID" },
    depth: { type: "number", default: 0.1, min: 0, max: 1, desc: "Base terrain height" },
    scale: { type: "number", default: 0.1, min: 0, max: 1, desc: "Terrain variation scale" },
    climate: { type: "array", default: [0.5, 0.5, 0.5, 0.5, 0.5], desc: "[temp, humid, cont, eros, weird]" },
    treeDensity: { type: "number", default: 0, min: 0, max: 1, desc: "Tree spawn density" },
    grassDensity: { type: "number", default: 0, min: 0, max: 1, desc: "Grass spawn density" },
    waterLevel: { type: "number", default: 0, desc: "Local water level override" },
  },
};

// ============================================================================
// TERRAIN GENERATION
// ============================================================================

/**
 * Noise parameters schema
 */
export const NOISE_SCHEMA = {
  name: "Noise",
  fields: {
    octaves: { type: "number", default: 6, min: 1, max: 16, desc: "Noise octaves (detail levels)" },
    persistence: { type: "number", default: 0.5, min: 0, max: 1, desc: "Amplitude falloff per octave" },
    lacunarity: { type: "number", default: 2.0, min: 1, max: 4, desc: "Frequency multiplier per octave" },
    scale: { type: "number", default: 100, min: 1, desc: "Base noise scale" },
    offset: { type: "vec3", default: [0, 0, 0], desc: "Noise sample offset" },
  },
};

/**
 * Erosion types
 */
export const EROSION_TYPES = {
  none: { id: 0, label: "None", desc: "No erosion" },
  thermal: { id: 1, label: "Thermal", desc: "Rock breakdown from temperature" },
  hydraulic: { id: 2, label: "Hydraulic", desc: "Water-based erosion" },
  wind: { id: 3, label: "Wind", desc: "Wind erosion (deserts)" },
};

/**
 * Terrain generation schema
 */
export const TERRAIN_SCHEMA = {
  name: "Terrain",
  fields: {
    seed: { type: "number", default: 42069, desc: "World seed" },
    seaLevel: { type: "number", default: 0, desc: "Sea level height" },
    baseHeight: { type: "number", default: 0, desc: "Base terrain height" },
    heightScale: { type: "number", default: 64, min: 1, desc: "Max height variation" },
    
    // Noise settings
    noiseOctaves: { type: "number", default: 6, min: 1, max: 16 },
    noisePersistence: { type: "number", default: 0.5, min: 0, max: 1 },
    noiseLacunarity: { type: "number", default: 2.0, min: 1, max: 4 },
    
    // Cave generation
    caveThreshold: { type: "number", default: 0.5, min: 0, max: 1, desc: "Cave density threshold" },
    caveScale: { type: "number", default: 50, min: 1, desc: "Cave noise scale" },
    tunnelFrequency: { type: "number", default: 0.02, min: 0, desc: "Tunnel frequency" },
    
    // Erosion
    erosionIterations: { type: "number", default: 10000, min: 0, desc: "Erosion simulation steps" },
    erosionStrength: { type: "number", default: 0.3, min: 0, max: 1, desc: "Erosion intensity" },
  },
};

// ============================================================================
// CHUNK/ZONE SYSTEM
// ============================================================================

/**
 * Chunk sizes
 */
export const CHUNK_SIZES = {
  small: { size: 16, label: "Small (16³)" },
  medium: { size: 32, label: "Medium (32³)" },
  large: { size: 64, label: "Large (64³)" },
};

/**
 * Zone types for streaming
 */
export const ZONE_TYPES = {
  active: { id: 0, label: "Active", desc: "Fully simulated", priority: 0 },
  loaded: { id: 1, label: "Loaded", desc: "In memory, reduced simulation", priority: 1 },
  cached: { id: 2, label: "Cached", desc: "Compressed in memory", priority: 2 },
  unloaded: { id: 3, label: "Unloaded", desc: "On disk only", priority: 3 },
};

/**
 * Chunk streaming schema
 */
export const CHUNK_STREAMING_SCHEMA = {
  name: "ChunkStreaming",
  fields: {
    viewDistance: { type: "number", default: 8, min: 1, max: 32, desc: "Render distance in chunks" },
    loadDistance: { type: "number", default: 12, min: 1, max: 48, desc: "Load distance in chunks" },
    unloadDistance: { type: "number", default: 16, min: 1, max: 64, desc: "Unload distance in chunks" },
    maxChunksPerFrame: { type: "number", default: 4, min: 1, desc: "Max chunks to load per frame" },
    priorityBias: { type: "number", default: 1.0, min: 0, desc: "Forward direction priority" },
    lodLevels: { type: "number", default: 4, min: 1, max: 8, desc: "LOD level count" },
  },
};

// ============================================================================
// WEATHER SYSTEM
// ============================================================================

/**
 * Weather types
 */
export const WEATHER_TYPES = {
  clear: { id: 0, label: "Clear", precipitation: 0, cloudCover: 0.1, windStrength: 0.2 },
  cloudy: { id: 1, label: "Cloudy", precipitation: 0, cloudCover: 0.7, windStrength: 0.3 },
  rain: { id: 2, label: "Rain", precipitation: 0.5, cloudCover: 0.9, windStrength: 0.4 },
  heavyRain: { id: 3, label: "Heavy Rain", precipitation: 1.0, cloudCover: 1.0, windStrength: 0.6 },
  snow: { id: 4, label: "Snow", precipitation: 0.5, cloudCover: 0.8, windStrength: 0.3 },
  blizzard: { id: 5, label: "Blizzard", precipitation: 1.0, cloudCover: 1.0, windStrength: 0.9 },
  fog: { id: 6, label: "Fog", precipitation: 0, cloudCover: 0.5, windStrength: 0.1, fogDensity: 0.8 },
  thunderstorm: { id: 7, label: "Thunderstorm", precipitation: 0.8, cloudCover: 1.0, windStrength: 0.8, lightning: true },
  sandstorm: { id: 8, label: "Sandstorm", precipitation: 0, cloudCover: 0.3, windStrength: 1.0, particleDensity: 0.9 },
};

/**
 * Weather schema
 */
export const WEATHER_SCHEMA = {
  name: "Weather",
  fields: {
    type: { type: "enum", enum: Object.keys(WEATHER_TYPES), default: "clear", desc: "Weather type" },
    intensity: { type: "number", default: 1.0, min: 0, max: 1, desc: "Weather intensity" },
    windDirection: { type: "vec2", default: [1, 0], desc: "Wind direction XZ" },
    windSpeed: { type: "number", default: 5, min: 0, desc: "Wind speed (m/s)" },
    temperature: { type: "number", default: 20, desc: "Temperature (°C)" },
    humidity: { type: "number", default: 0.5, min: 0, max: 1, desc: "Air humidity" },
    transitionTime: { type: "number", default: 60, min: 0, desc: "Weather transition time (s)" },
  },
};

// ============================================================================
// TIME SYSTEM
// ============================================================================

/**
 * Time of day phases
 */
export const TIME_PHASES = {
  night: { id: 0, label: "Night", startHour: 0, sunIntensity: 0, ambientMult: 0.1 },
  dawn: { id: 1, label: "Dawn", startHour: 5, sunIntensity: 0.3, ambientMult: 0.4 },
  morning: { id: 2, label: "Morning", startHour: 7, sunIntensity: 0.8, ambientMult: 0.8 },
  noon: { id: 3, label: "Noon", startHour: 11, sunIntensity: 1.0, ambientMult: 1.0 },
  afternoon: { id: 4, label: "Afternoon", startHour: 14, sunIntensity: 0.9, ambientMult: 0.9 },
  dusk: { id: 5, label: "Dusk", startHour: 18, sunIntensity: 0.4, ambientMult: 0.5 },
  evening: { id: 6, label: "Evening", startHour: 20, sunIntensity: 0.1, ambientMult: 0.2 },
};

/**
 * World time schema
 */
export const WORLD_TIME_SCHEMA = {
  name: "WorldTime",
  fields: {
    dayLengthMinutes: { type: "number", default: 20, min: 1, desc: "Real minutes per game day" },
    startTime: { type: "number", default: 8, min: 0, max: 24, desc: "Starting hour of day" },
    startDay: { type: "number", default: 1, min: 1, desc: "Starting day" },
    yearLength: { type: "number", default: 365, min: 1, desc: "Days per year" },
    seasonCount: { type: "number", default: 4, min: 1, max: 12, desc: "Number of seasons" },
    pauseWhenInactive: { type: "boolean", default: true, desc: "Pause time when game inactive" },
  },
};

// ============================================================================
// WORLD CONFIG SCHEMA
// ============================================================================

/**
 * Complete world configuration
 */
export const WORLD_CONFIG_SCHEMA = {
  name: "WorldConfig",
  fields: {
    seed: { type: "number", default: 42069, desc: "World seed" },
    name: { type: "string", default: "New World", desc: "World name" },
    
    // Size
    worldRadius: { type: "number", default: 180000, desc: "Planet radius (km)" },
    chunkSize: { type: "number", default: 32, desc: "Chunk size" },
    
    // Generation
    seaLevel: { type: "number", default: 0, desc: "Sea level" },
    heightScale: { type: "number", default: 64, desc: "Max height" },
    
    // Simulation
    enableWeather: { type: "boolean", default: true, desc: "Enable weather system" },
    enableDayNight: { type: "boolean", default: true, desc: "Enable day/night cycle" },
    enableErosion: { type: "boolean", default: false, desc: "Enable terrain erosion" },
    
    // Multiplayer
    isMultiplayer: { type: "boolean", default: false, desc: "Multiplayer world" },
    maxPlayers: { type: "number", default: 8, min: 1, desc: "Max players" },
  },
};

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate terrain config
 */
export function validateTerrain(config) {
  const errors = [];
  const result = { ...config };
  const schema = TERRAIN_SCHEMA.fields;
  
  for (const [key, field] of Object.entries(schema)) {
    if (result[key] === undefined) {
      result[key] = field.default;
    } else if (typeof result[key] !== "number") {
      result[key] = field.default;
      errors.push(`Invalid ${key}: expected number`);
    } else {
      if (field.min !== undefined && result[key] < field.min) result[key] = field.min;
      if (field.max !== undefined && result[key] > field.max) result[key] = field.max;
    }
  }
  
  return { valid: errors.length === 0, errors, value: result };
}

/**
 * Validate weather config
 */
export function validateWeather(config) {
  const errors = [];
  const result = { ...config };
  
  if (!WEATHER_TYPES[config.type]) {
    result.type = "clear";
    errors.push(`Invalid weather type: ${config.type}`);
  }
  
  if (typeof config.intensity !== "number" || config.intensity < 0 || config.intensity > 1) {
    result.intensity = 1.0;
  }
  
  if (typeof config.windSpeed !== "number" || config.windSpeed < 0) {
    result.windSpeed = 5;
  }
  
  return { valid: errors.length === 0, errors, value: result };
}

/**
 * Validate world config
 */
export function validateWorldConfig(config) {
  const errors = [];
  const result = { ...config };
  const schema = WORLD_CONFIG_SCHEMA.fields;
  
  for (const [key, field] of Object.entries(schema)) {
    if (result[key] === undefined) {
      result[key] = field.default;
    }
  }
  
  // Validate seed
  if (typeof result.seed !== "number") {
    result.seed = 42069;
  }
  
  // Validate chunk size
  if (![16, 32, 64].includes(result.chunkSize)) {
    result.chunkSize = 32;
  }
  
  return { valid: errors.length === 0, errors, value: result };
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create default terrain config
 */
export function createDefaultTerrain() {
  const result = {};
  for (const [key, field] of Object.entries(TERRAIN_SCHEMA.fields)) {
    result[key] = field.default;
  }
  return result;
}

/**
 * Create default weather
 */
export function createDefaultWeather() {
  return {
    type: "clear",
    intensity: 1.0,
    windDirection: [1, 0],
    windSpeed: 5,
    temperature: 20,
    humidity: 0.5,
    transitionTime: 60,
  };
}

/**
 * Create default world config
 */
export function createDefaultWorldConfig(seed = Date.now()) {
  return {
    seed,
    name: "New World",
    worldRadius: 180000,
    chunkSize: 32,
    seaLevel: 0,
    heightScale: 64,
    enableWeather: true,
    enableDayNight: true,
    enableErosion: false,
    isMultiplayer: false,
    maxPlayers: 8,
  };
}

/**
 * Create climate from biome position
 */
export function createClimateFromPosition(latitude, altitude, oceanDistance) {
  const lat = Math.abs(latitude); // 0-90 degrees
  
  return {
    temperature: Math.max(0, 1 - lat / 90 - altitude / 10000),
    humidity: Math.max(0, 1 - oceanDistance / 1000),
    continentalness: Math.min(1, oceanDistance / 500),
    erosion: 0.5,
    weirdness: 0.5,
  };
}

/**
 * Get biome from climate
 */
export function getBiomeFromClimate(climate) {
  // Simple biome selection based on temperature and humidity
  const { temperature, humidity, continentalness } = climate;
  
  if (continentalness < 0.2) return "ocean";
  if (continentalness < 0.3) return "beach";
  
  if (temperature < 0.2) {
    return humidity > 0.5 ? "taiga" : "icePlains";
  }
  if (temperature < 0.4) {
    return humidity > 0.7 ? "swamp" : "tundra";
  }
  if (temperature < 0.6) {
    if (humidity > 0.7) return "forest";
    if (humidity > 0.4) return "plains";
    return "savanna";
  }
  if (temperature < 0.8) {
    if (humidity > 0.8) return "jungle";
    if (humidity > 0.4) return "savanna";
    return "desert";
  }
  
  return humidity > 0.3 ? "mesa" : "desert";
}

/**
 * Get weather preset
 */
export function getWeatherPreset(typeName) {
  return WEATHER_TYPES[typeName] || WEATHER_TYPES.clear;
}

/**
 * Get time phase for hour
 */
export function getTimePhase(hour) {
  const phases = Object.entries(TIME_PHASES).sort((a, b) => b[1].startHour - a[1].startHour);
  for (const [name, phase] of phases) {
    if (hour >= phase.startHour) return name;
  }
  return "night";
}
