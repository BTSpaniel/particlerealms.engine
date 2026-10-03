// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export function createWorldSim(options = {}) {
  const name = typeof options.name === "string" ? options.name : "WorldSim";

  const terrainOptions = options.terrain || {};
  let terrain = null;
  const terrainType =
    typeof terrainOptions.type === "string" && terrainOptions.type.length
      ? terrainOptions.type
      : "heightfield";

  if (terrainType === "chunked_heightfield") {
    terrain = createChunkedTerrain(terrainOptions);
  } else if (terrainType === "none") {
    terrain = null;
  } else {
    terrain = createHeightfieldTerrain(terrainOptions);
  }

  const dayLengthRaw = options.dayLengthSeconds;
  let dayLengthSeconds = 600;
  if (
    typeof dayLengthRaw === "number" &&
    Number.isFinite(dayLengthRaw) &&
    dayLengthRaw > 0.1
  ) {
    dayLengthSeconds = dayLengthRaw;
  }

  let initialTimeOfDay = 0;
  const todRaw = options.timeOfDay;
  if (typeof todRaw === "number" && Number.isFinite(todRaw)) {
    if (todRaw > 1.5) {
      initialTimeOfDay = (todRaw % 24) / 24;
    } else if (todRaw >= 0 && todRaw <= 1) {
      initialTimeOfDay = todRaw;
    }
  }

  const weatherOptions = options.weather || {};
  const weatherType =
    typeof weatherOptions.type === "string" && weatherOptions.type.length
      ? weatherOptions.type
      : "clear";
  const intensityRaw = weatherOptions.intensity;
  const intensity =
    typeof intensityRaw === "number" && Number.isFinite(intensityRaw)
      ? Math.max(0, intensityRaw)
      : 0;

  const clock = {
    timeOfDay: initialTimeOfDay,
    dayLengthSeconds,
    totalElapsedSeconds: 0,
    dayCount: 0,
  };

  const weather = {
    type: weatherType,
    intensity,
  };

  const worldSim = {
    name,
    terrain,
    clock,
    weather,
  };

  return worldSim;
}

export function destroyWorldSim(worldSim) {
  if (!worldSim || typeof worldSim !== "object") {
    return;
  }
  worldSim.terrain = null;
  worldSim.clock = null;
  worldSim.weather = null;
}

export function stepWorldSim(worldSim, deltaSeconds, options = {}) {
  if (!worldSim || !worldSim.clock) {
    return;
  }

  const dtRaw = Number(deltaSeconds);
  if (!Number.isFinite(dtRaw) || dtRaw <= 0) {
    return;
  }

  const clock = worldSim.clock;
  const dayLength = Number(clock.dayLengthSeconds);
  const dayLengthSeconds =
    Number.isFinite(dayLength) && dayLength > 0.001 ? dayLength : 600;

  clock.totalElapsedSeconds += dtRaw;

  let timeOfDay =
    typeof clock.timeOfDay === "number" && Number.isFinite(clock.timeOfDay)
      ? clock.timeOfDay
      : 0;

  const increment = dtRaw / dayLengthSeconds;
  timeOfDay += increment;

  let dayCount = clock.dayCount | 0;
  while (timeOfDay >= 1) {
    timeOfDay -= 1;
    dayCount += 1;
  }

  if (timeOfDay < 0) {
    const wholeDays = Math.ceil(-timeOfDay);
    timeOfDay += wholeDays;
    dayCount = Math.max(0, dayCount - wholeDays);
  }

  clock.timeOfDay = timeOfDay;
  clock.dayCount = dayCount;

  const autoWeather =
    options && typeof options.autoWeather === "boolean"
      ? options.autoWeather
      : false;

  if (autoWeather && worldSim.weather) {
    updateWeather(worldSim.weather, clock, dtRaw);
  }
}

function createHeightfieldTerrain(options = {}) {
  const type = "heightfield";

  const resolutionXRaw = options.resolutionX;
  const resolutionZRaw = options.resolutionZ;
  const defaultResolution = 128;

  const resolutionX =
    typeof resolutionXRaw === "number" &&
    Number.isFinite(resolutionXRaw) &&
    resolutionXRaw >= 1
      ? resolutionXRaw | 0
      : defaultResolution;
  const resolutionZ =
    typeof resolutionZRaw === "number" &&
    Number.isFinite(resolutionZRaw) &&
    resolutionZRaw >= 1
      ? resolutionZRaw | 0
      : defaultResolution;

  const cellSizeRaw = options.cellSize;
  const defaultCellSize = 2;
  const cellSize =
    typeof cellSizeRaw === "number" &&
    Number.isFinite(cellSizeRaw) &&
    cellSizeRaw > 0.01
      ? cellSizeRaw
      : defaultCellSize;

  const sizeXRaw = options.sizeX;
  const sizeZRaw = options.sizeZ;

  const sizeX =
    typeof sizeXRaw === "number" &&
    Number.isFinite(sizeXRaw) &&
    sizeXRaw > 0
      ? sizeXRaw
      : resolutionX * cellSize;
  const sizeZ =
    typeof sizeZRaw === "number" &&
    Number.isFinite(sizeZRaw) &&
    sizeZRaw > 0
      ? sizeZRaw
      : resolutionZ * cellSize;

  const originXRaw = options.originX;
  const originZRaw = options.originZ;
  const originX =
    typeof originXRaw === "number" && Number.isFinite(originXRaw)
      ? originXRaw
      : -sizeX * 0.5;
  const originZ =
    typeof originZRaw === "number" && Number.isFinite(originZRaw)
      ? originZRaw
      : -sizeZ * 0.5;

  const heights = new Float32Array((resolutionX + 1) * (resolutionZ + 1));

  const amplitudeRaw = options.amplitude;
  const amplitude =
    typeof amplitudeRaw === "number" && Number.isFinite(amplitudeRaw)
      ? amplitudeRaw
      : 5;

  const frequencyRaw = options.frequency;
  const frequency =
    typeof frequencyRaw === "number" && Number.isFinite(frequencyRaw)
      ? frequencyRaw
      : 0.05;

  for (let zIndex = 0; zIndex <= resolutionZ; zIndex++) {
    const tZ = zIndex / resolutionZ;
    const worldZ = originZ + tZ * sizeZ;
    for (let xIndex = 0; xIndex <= resolutionX; xIndex++) {
      const tX = xIndex / resolutionX;
      const worldX = originX + tX * sizeX;
      const h =
        Math.sin(worldX * frequency) * Math.cos(worldZ * frequency) * amplitude;
      const idx = zIndex * (resolutionX + 1) + xIndex;
      heights[idx] = h;
    }
  }

  return {
    type,
    sizeX,
    sizeZ,
    cellSize,
    resolutionX,
    resolutionZ,
    originX,
    originZ,
    heights,
  };
}

function createChunkedTerrain(options = {}) {
  const type = "chunked_heightfield";

  const originXRaw = options.originX;
  const originZRaw = options.originZ;
  const chunkSizeXRaw = options.chunkSizeX;
  const chunkSizeZRaw = options.chunkSizeZ;
  const resolutionXRaw = options.resolutionX;
  const resolutionZRaw = options.resolutionZ;

  const defaultChunkSize = 256;
  const defaultResolution = 128;

  const chunkSizeX =
    typeof chunkSizeXRaw === "number" &&
    Number.isFinite(chunkSizeXRaw) &&
    chunkSizeXRaw > 0.01
      ? chunkSizeXRaw
      : defaultChunkSize;
  const chunkSizeZ =
    typeof chunkSizeZRaw === "number" &&
    Number.isFinite(chunkSizeZRaw) &&
    chunkSizeZRaw > 0.01
      ? chunkSizeZRaw
      : defaultChunkSize;

  const resolutionX =
    typeof resolutionXRaw === "number" &&
    Number.isFinite(resolutionXRaw) &&
    resolutionXRaw >= 1
      ? resolutionXRaw | 0
      : defaultResolution;
  const resolutionZ =
    typeof resolutionZRaw === "number" &&
    Number.isFinite(resolutionZRaw) &&
    resolutionZRaw >= 1
      ? resolutionZRaw | 0
      : defaultResolution;

  const sizeX = chunkSizeX;
  const sizeZ = chunkSizeZ;

  const originX =
    typeof originXRaw === "number" && Number.isFinite(originXRaw)
      ? originXRaw
      : -sizeX * 0.5;
  const originZ =
    typeof originZRaw === "number" && Number.isFinite(originZRaw)
      ? originZRaw
      : -sizeZ * 0.5;

  const amplitudeRaw =
    options.defaultParams && options.defaultParams.amplitude;
  const frequencyRaw =
    options.defaultParams && options.defaultParams.frequency;

  const amplitude =
    typeof amplitudeRaw === "number" && Number.isFinite(amplitudeRaw)
      ? amplitudeRaw
      : 5;
  const frequency =
    typeof frequencyRaw === "number" && Number.isFinite(frequencyRaw)
      ? frequencyRaw
      : 0.05;

  const defaultParams = {
    amplitude,
    frequency,
  };

  const autoGenerateChunks =
    options && typeof options.autoGenerateChunks === "boolean"
      ? options.autoGenerateChunks
      : true;

  const chunks = new Map();

  const onChunkMissing =
    options && typeof options.onChunkMissing === "function"
      ? options.onChunkMissing
      : null;

  return {
    type,
    originX,
    originZ,
    chunkSizeX,
    chunkSizeZ,
    resolutionX,
    resolutionZ,
    defaultParams,
    autoGenerateChunks,
    chunks,
    onChunkMissing,
  };
}

function getChunkKey(cx, cz) {
  return `${cx},${cz}`;
}

function getTerrainChunk(terrain, cx, cz) {
  if (!terrain || !terrain.chunks) {
    return null;
  }
  return terrain.chunks.get(getChunkKey(cx, cz)) || null;
}

function generateProceduralChunk(terrain, cx, cz) {
  const resolutionX = terrain.resolutionX | 0;
  const resolutionZ = terrain.resolutionZ | 0;
  if (resolutionX <= 0 || resolutionZ <= 0) {
    return null;
  }

  const chunkSizeX = terrain.chunkSizeX;
  const chunkSizeZ = terrain.chunkSizeZ;
  if (!(chunkSizeX > 0) || !(chunkSizeZ > 0)) {
    return null;
  }

  const originX = terrain.originX + cx * chunkSizeX;
  const originZ = terrain.originZ + cz * chunkSizeZ;

  const sizeX = chunkSizeX;
  const sizeZ = chunkSizeZ;

  const heights = new Float32Array((resolutionX + 1) * (resolutionZ + 1));

  const params = terrain.defaultParams || {};
  const amplitude =
    typeof params.amplitude === "number" && Number.isFinite(params.amplitude)
      ? params.amplitude
      : 5;
  const frequency =
    typeof params.frequency === "number" && Number.isFinite(params.frequency)
      ? params.frequency
      : 0.05;

  for (let zIndex = 0; zIndex <= resolutionZ; zIndex++) {
    const tZ = zIndex / resolutionZ;
    const worldZ = originZ + tZ * sizeZ;
    for (let xIndex = 0; xIndex <= resolutionX; xIndex++) {
      const tX = xIndex / resolutionX;
      const worldX = originX + tX * sizeX;
      const h =
        Math.sin(worldX * frequency) * Math.cos(worldZ * frequency) * amplitude;
      const idx = zIndex * (resolutionX + 1) + xIndex;
      heights[idx] = h;
    }
  }

  return {
    cx,
    cz,
    originX,
    originZ,
    sizeX,
    sizeZ,
    resolutionX,
    resolutionZ,
    heights,
  };
}

function getOrCreateTerrainChunk(terrain, cx, cz) {
  if (!terrain) {
    return null;
  }

  const existing = getTerrainChunk(terrain, cx, cz);
  if (existing) {
    return existing;
  }

  if (terrain.autoGenerateChunks === false) {
    if (typeof terrain.onChunkMissing === "function") {
      terrain.onChunkMissing(cx, cz, "sample");
    }
    return null;
  }

  const chunk = generateProceduralChunk(terrain, cx, cz);
  if (chunk && terrain.chunks) {
    terrain.chunks.set(getChunkKey(cx, cz), chunk);
  }
  return chunk;
}

function updateWeather(weather, clock, deltaSeconds) {
  if (!weather || !clock) {
    return;
  }

  const t = clock.timeOfDay;
  if (!(t >= 0 && t <= 1)) {
    return;
  }

  const nightFactor = t < 0.25 || t > 0.75 ? 1 : 0;
  const targetIntensity = nightFactor * 0.5;

  const current =
    typeof weather.intensity === "number" && Number.isFinite(weather.intensity)
      ? weather.intensity
      : 0;

  const speed = 0.1;
  const delta = (targetIntensity - current) * Math.min(1, deltaSeconds * speed);
  const nextIntensity = current + delta;

  weather.intensity = nextIntensity;
  weather.type = nextIntensity > 0.25 ? "rain" : "clear";
}

export function sampleTerrainHeight(worldSim, worldX, worldZ) {
  if (!worldSim || !worldSim.terrain) {
    return 0;
  }
  const terrain = worldSim.terrain;

  if (terrain.type === "heightfield") {
    return sampleSingleHeightfield(terrain, worldX, worldZ);
  }
  if (terrain.type === "chunked_heightfield") {
    return sampleChunkedTerrainHeight(terrain, worldX, worldZ);
  }

  return 0;
}

function sampleSingleHeightfield(terrain, worldX, worldZ) {
  if (!terrain || terrain.type !== "heightfield" || !terrain.heights) {
    return 0;
  }

  const x = Number(worldX);
  const z = Number(worldZ);
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    return 0;
  }

  const { originX, originZ, sizeX, sizeZ, resolutionX, resolutionZ } = terrain;

  if (!(sizeX > 0) || !(sizeZ > 0) || resolutionX <= 0 || resolutionZ <= 0) {
    return 0;
  }

  const localX = (x - originX) / sizeX;
  const localZ = (z - originZ) / sizeZ;

  if (localX <= 0 || localZ <= 0 || localX >= 1 || localZ >= 1) {
    const clampedX = Math.min(1, Math.max(0, localX));
    const clampedZ = Math.min(1, Math.max(0, localZ));
    return sampleTerrainHeightNormalized(terrain, clampedX, clampedZ);
  }

  return sampleTerrainHeightNormalized(terrain, localX, localZ);
}

function sampleChunkedTerrainHeight(terrain, worldX, worldZ) {
  if (!terrain || terrain.type !== "chunked_heightfield") {
    return 0;
  }

  const x = Number(worldX);
  const z = Number(worldZ);
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    return 0;
  }

  const relX = x - terrain.originX;
  const relZ = z - terrain.originZ;
  const chunkSizeX = terrain.chunkSizeX;
  const chunkSizeZ = terrain.chunkSizeZ;
  if (!(chunkSizeX > 0) || !(chunkSizeZ > 0)) {
    return 0;
  }

  const cx = Math.floor(relX / chunkSizeX);
  const cz = Math.floor(relZ / chunkSizeZ);

  const chunk = getOrCreateTerrainChunk(terrain, cx, cz);
  if (!chunk || !chunk.heights) {
    return 0;
  }

  const localX = (x - chunk.originX) / chunk.sizeX;
  const localZ = (z - chunk.originZ) / chunk.sizeZ;

  const nx = Math.min(1, Math.max(0, localX));
  const nz = Math.min(1, Math.max(0, localZ));

  return sampleTerrainHeightNormalized(chunk, nx, nz);
}

function sampleTerrainHeightNormalized(source, nx, nz) {
  const resolutionX = source.resolutionX | 0;
  const resolutionZ = source.resolutionZ | 0;
  const heights = source.heights;

  if (!heights || resolutionX <= 0 || resolutionZ <= 0) {
    return 0;
  }

  const fx = nx * resolutionX;
  const fz = nz * resolutionZ;

  let x0 = Math.floor(fx);
  let z0 = Math.floor(fz);
  let x1 = x0 + 1;
  let z1 = z0 + 1;

  if (x0 < 0) x0 = 0;
  if (z0 < 0) z0 = 0;
  if (x1 > resolutionX) x1 = resolutionX;
  if (z1 > resolutionZ) z1 = resolutionZ;

  const tx = fx - x0;
  const tz = fz - z0;

  const idx00 = z0 * (resolutionX + 1) + x0;
  const idx10 = z0 * (resolutionX + 1) + x1;
  const idx01 = z1 * (resolutionX + 1) + x0;
  const idx11 = z1 * (resolutionX + 1) + x1;

  const h00 = heights[idx00];
  const h10 = heights[idx10];
  const h01 = heights[idx01];
  const h11 = heights[idx11];

  const h0 = h00 + (h10 - h00) * tx;
  const h1 = h01 + (h11 - h01) * tx;

  return h0 + (h1 - h0) * tz;
}

export function getWorldSimSnapshot(worldSim) {
  if (!worldSim) {
    return null;
  }
  const clock = worldSim.clock || {};
  const terrain = worldSim.terrain || {};
  const weather = worldSim.weather || {};

  const terrainType = terrain.type || "none";

  let sizeX = 0;
  let sizeZ = 0;
  let resolutionX = 0;
  let resolutionZ = 0;
  let originX = 0;
  let originZ = 0;

  if (terrainType === "heightfield") {
    sizeX = typeof terrain.sizeX === "number" ? terrain.sizeX : 0;
    sizeZ = typeof terrain.sizeZ === "number" ? terrain.sizeZ : 0;
    resolutionX = terrain.resolutionX | 0;
    resolutionZ = terrain.resolutionZ | 0;
    originX =
      typeof terrain.originX === "number" && Number.isFinite(terrain.originX)
        ? terrain.originX
        : 0;
    originZ =
      typeof terrain.originZ === "number" && Number.isFinite(terrain.originZ)
        ? terrain.originZ
        : 0;
  } else if (terrainType === "chunked_heightfield") {
    sizeX =
      typeof terrain.chunkSizeX === "number" &&
      Number.isFinite(terrain.chunkSizeX)
        ? terrain.chunkSizeX
        : 0;
    sizeZ =
      typeof terrain.chunkSizeZ === "number" &&
      Number.isFinite(terrain.chunkSizeZ)
        ? terrain.chunkSizeZ
        : 0;
    resolutionX = terrain.resolutionX | 0;
    resolutionZ = terrain.resolutionZ | 0;
    originX =
      typeof terrain.originX === "number" && Number.isFinite(terrain.originX)
        ? terrain.originX
        : 0;
    originZ =
      typeof terrain.originZ === "number" && Number.isFinite(terrain.originZ)
        ? terrain.originZ
        : 0;
  } else if (terrainType === "chunked_heightfield") {
    sizeX =
      typeof terrain.chunkSizeX === "number" &&
      Number.isFinite(terrain.chunkSizeX)
        ? terrain.chunkSizeX
        : 0;
    sizeZ =
      typeof terrain.chunkSizeZ === "number" &&
      Number.isFinite(terrain.chunkSizeZ)
        ? terrain.chunkSizeZ
        : 0;
    resolutionX = terrain.resolutionX | 0;
    resolutionZ = terrain.resolutionZ | 0;
    originX =
      typeof terrain.originX === "number" && Number.isFinite(terrain.originX)
        ? terrain.originX
        : 0;
    originZ =
      typeof terrain.originZ === "number" && Number.isFinite(terrain.originZ)
        ? terrain.originZ
        : 0;
  }

  return {
    name: worldSim.name || "WorldSim",
    clock: {
      timeOfDay:
        typeof clock.timeOfDay === "number" && Number.isFinite(clock.timeOfDay)
          ? clock.timeOfDay
          : 0,
      dayLengthSeconds:
        typeof clock.dayLengthSeconds === "number" &&
        Number.isFinite(clock.dayLengthSeconds)
          ? clock.dayLengthSeconds
          : 0,
      totalElapsedSeconds:
        typeof clock.totalElapsedSeconds === "number" &&
        Number.isFinite(clock.totalElapsedSeconds)
          ? clock.totalElapsedSeconds
          : 0,
      dayCount: clock.dayCount | 0,
    },
    terrain: {
      type: terrainType,
      sizeX,
      sizeZ,
      resolutionX,
      resolutionZ,
      originX,
      originZ,
    },
    weather: {
      type: weather.type || "clear",
      intensity:
        typeof weather.intensity === "number" &&
        Number.isFinite(weather.intensity)
          ? weather.intensity
          : 0,
    },
  };
}

export function exportWorldSimState(worldSim, options = {}) {
  if (!worldSim) {
    return null;
  }

  const includeTerrainHeights =
    options && typeof options.includeTerrainHeights === "boolean"
      ? options.includeTerrainHeights
      : false;

  const snapshot = getWorldSimSnapshot(worldSim);
  if (!snapshot) {
    return null;
  }

  const terrain = worldSim.terrain || {};
  const terrainState = {
    type: snapshot.terrain.type,
    sizeX: snapshot.terrain.sizeX,
    sizeZ: snapshot.terrain.sizeZ,
    resolutionX: snapshot.terrain.resolutionX,
    resolutionZ: snapshot.terrain.resolutionZ,
    originX: snapshot.terrain.originX,
    originZ: snapshot.terrain.originZ,
  };

  if (includeTerrainHeights) {
    if (terrain.type === "heightfield" && terrain.heights) {
      const cellSize =
        typeof terrain.cellSize === "number" &&
        Number.isFinite(terrain.cellSize)
          ? terrain.cellSize
          : 0;
      terrainState.cellSize = cellSize;
      terrainState.heightData = Array.from(terrain.heights);
    } else if (terrain.type === "chunked_heightfield") {
      terrainState.chunkSizeX =
        typeof terrain.chunkSizeX === "number" &&
        Number.isFinite(terrain.chunkSizeX)
          ? terrain.chunkSizeX
          : 0;
      terrainState.chunkSizeZ =
        typeof terrain.chunkSizeZ === "number" &&
        Number.isFinite(terrain.chunkSizeZ)
          ? terrain.chunkSizeZ
          : 0;
      terrainState.chunks = [];
      if (terrain.chunks && typeof terrain.chunks.forEach === "function") {
        terrain.chunks.forEach((chunk) => {
          if (!chunk || !chunk.heights) {
            return;
          }
          terrainState.chunks.push({
            cx: chunk.cx | 0,
            cz: chunk.cz | 0,
            originX:
              typeof chunk.originX === "number" &&
              Number.isFinite(chunk.originX)
                ? chunk.originX
                : 0,
            originZ:
              typeof chunk.originZ === "number" &&
              Number.isFinite(chunk.originZ)
                ? chunk.originZ
                : 0,
            sizeX:
              typeof chunk.sizeX === "number" && Number.isFinite(chunk.sizeX)
                ? chunk.sizeX
                : 0,
            sizeZ:
              typeof chunk.sizeZ === "number" && Number.isFinite(chunk.sizeZ)
                ? chunk.sizeZ
                : 0,
            resolutionX: chunk.resolutionX | 0,
            resolutionZ: chunk.resolutionZ | 0,
            heights: Array.from(chunk.heights),
          });
        });
      }
    }
  }

  return {
    name: typeof worldSim.name === "string" ? worldSim.name : "WorldSim",
    clock: snapshot.clock,
    weather: snapshot.weather,
    terrain: terrainState,
  };
}

export function createWorldSimFromState(state) {
  if (!state || typeof state !== "object") {
    return null;
  }

  const options = {};
  options.name = typeof state.name === "string" ? state.name : "WorldSim";

  const clock = state.clock || {};
  const dayLengthRaw = clock.dayLengthSeconds;
  if (
    typeof dayLengthRaw === "number" &&
    Number.isFinite(dayLengthRaw) &&
    dayLengthRaw > 0.1
  ) {
    options.dayLengthSeconds = dayLengthRaw;
  }
  const todRaw = clock.timeOfDay;
  if (typeof todRaw === "number" && Number.isFinite(todRaw)) {
    options.timeOfDay = todRaw;
  }

  const weather = state.weather || {};
  options.weather = {
    type:
      typeof weather.type === "string" && weather.type.length
        ? weather.type
        : "clear",
    intensity:
      typeof weather.intensity === "number" &&
      Number.isFinite(weather.intensity)
        ? weather.intensity
        : 0,
  };

  const terrainState = state.terrain || {};
  const terrainType = terrainState.type || "none";

  if (terrainType === "heightfield") {
    options.terrain = {
      type: "heightfield",
      sizeX:
        typeof terrainState.sizeX === "number" &&
        Number.isFinite(terrainState.sizeX)
          ? terrainState.sizeX
          : undefined,
      sizeZ:
        typeof terrainState.sizeZ === "number" &&
        Number.isFinite(terrainState.sizeZ)
          ? terrainState.sizeZ
          : undefined,
      resolutionX: terrainState.resolutionX | 0,
      resolutionZ: terrainState.resolutionZ | 0,
      originX:
        typeof terrainState.originX === "number" &&
        Number.isFinite(terrainState.originX)
          ? terrainState.originX
          : undefined,
      originZ:
        typeof terrainState.originZ === "number" &&
        Number.isFinite(terrainState.originZ)
          ? terrainState.originZ
          : undefined,
      cellSize:
        typeof terrainState.cellSize === "number" &&
        Number.isFinite(terrainState.cellSize)
          ? terrainState.cellSize
          : undefined,
    };
  } else if (terrainType === "chunked_heightfield") {
    options.terrain = {
      type: "chunked_heightfield",
      originX:
        typeof terrainState.originX === "number" &&
        Number.isFinite(terrainState.originX)
          ? terrainState.originX
          : undefined,
      originZ:
        typeof terrainState.originZ === "number" &&
        Number.isFinite(terrainState.originZ)
          ? terrainState.originZ
          : undefined,
      chunkSizeX:
        typeof terrainState.chunkSizeX === "number" &&
        Number.isFinite(terrainState.chunkSizeX)
          ? terrainState.chunkSizeX
          : undefined,
      chunkSizeZ:
        typeof terrainState.chunkSizeZ === "number" &&
        Number.isFinite(terrainState.chunkSizeZ)
          ? terrainState.chunkSizeZ
          : undefined,
      resolutionX: terrainState.resolutionX | 0,
      resolutionZ: terrainState.resolutionZ | 0,
      defaultParams: terrainState.defaultParams || undefined,
      autoGenerateChunks: true,
    };
  } else {
    options.terrain = { type: "none" };
  }

  const worldSim = createWorldSim(options);

  if (
    terrainType === "heightfield" &&
    worldSim &&
    worldSim.terrain &&
    worldSim.terrain.type === "heightfield" &&
    Array.isArray(terrainState.heightData)
  ) {
    const target = worldSim.terrain;
    const expectedLength = (target.resolutionX + 1) * (target.resolutionZ + 1);
    if (terrainState.heightData.length === expectedLength) {
      target.heights.set(terrainState.heightData);
    }
  } else if (
    terrainType === "chunked_heightfield" &&
    worldSim &&
    worldSim.terrain &&
    worldSim.terrain.type === "chunked_heightfield" &&
    Array.isArray(terrainState.chunks)
  ) {
    const terrain = worldSim.terrain;
    for (let i = 0; i < terrainState.chunks.length; i++) {
      const src = terrainState.chunks[i];
      if (!src || !Array.isArray(src.heights)) {
        continue;
      }
      const cx = src.cx | 0;
      const cz = src.cz | 0;
      const chunk = generateProceduralChunk(terrain, cx, cz);
      if (!chunk) {
        continue;
      }
      const expectedLength =
        (chunk.resolutionX + 1) * (chunk.resolutionZ + 1);
      if (src.heights.length === expectedLength) {
        chunk.heights.set(src.heights);
      }
      terrain.chunks.set(getChunkKey(cx, cz), chunk);
    }
  }

  return worldSim;
}
