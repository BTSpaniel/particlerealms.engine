// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * AIWorld.js
 * 
 * ⚠️ MULTIPLAYER: Uses deterministic RNG from AIRandom.js
 */

import { aiRng } from './AIRandom.js';

/**
 * AIWorld.js (original) - World State Simulation
 * 
 * Features:
 * - Time system (hours, days, seasons, years)
 * - Weather simulation
 * - Day/night cycle effects
 * - World events and disasters
 * - Environmental conditions
 */

// ============================================================================
// TIME SYSTEM
// ============================================================================

/** Seasons */
export const SEASON = {
  SPRING: "spring",
  SUMMER: "summer",
  FALL: "fall",
  WINTER: "winter",
};

/** Days of week */
export const DAY_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Months */
export const MONTH = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

/**
 * Create world time system
 * @param {Object} config - Time config
 * @returns {Object} World time
 */
export function createWorldTime(config = {}) {
  return {
    // Current time
    hour: config.hour ?? 12,        // 0-23
    minute: config.minute ?? 0,     // 0-59
    day: config.day ?? 1,           // 1-30
    month: config.month ?? 6,       // 1-12
    year: config.year ?? 1,
    
    // Derived
    dayOfYear: 0,
    totalDays: 0,
    totalHours: 0,
    
    // Configuration
    hoursPerDay: config.hoursPerDay ?? 24,
    daysPerMonth: config.daysPerMonth ?? 30,
    monthsPerYear: config.monthsPerYear ?? 12,
    
    // Time scale
    timeScale: config.timeScale ?? 1, // Real seconds per game minute
    
    // Callbacks
    onHourChange: null,
    onDayChange: null,
    onSeasonChange: null,
  };
}

/**
 * Advance world time
 * @param {Object} time - World time
 * @param {number} realDeltaSeconds - Real seconds elapsed
 * @returns {{hourChanged: boolean, dayChanged: boolean, seasonChanged: boolean}}
 */
export function advanceTime(time, realDeltaSeconds) {
  const gameMinutes = realDeltaSeconds / time.timeScale;
  const gameHours = gameMinutes / 60;
  
  const oldHour = time.hour;
  const oldDay = time.day;
  const oldSeason = getSeason(time);
  
  // Add time
  time.minute += gameMinutes;
  time.totalHours += gameHours;
  
  // Overflow minutes to hours
  while (time.minute >= 60) {
    time.minute -= 60;
    time.hour++;
  }
  
  // Overflow hours to days
  while (time.hour >= time.hoursPerDay) {
    time.hour -= time.hoursPerDay;
    time.day++;
    time.totalDays++;
  }
  
  // Overflow days to months
  while (time.day > time.daysPerMonth) {
    time.day -= time.daysPerMonth;
    time.month++;
  }
  
  // Overflow months to years
  while (time.month > time.monthsPerYear) {
    time.month -= time.monthsPerYear;
    time.year++;
  }
  
  // Calculate day of year
  time.dayOfYear = (time.month - 1) * time.daysPerMonth + time.day;
  
  const hourChanged = Math.floor(time.hour) !== Math.floor(oldHour) || time.day !== oldDay;
  const dayChanged = time.day !== oldDay;
  const newSeason = getSeason(time);
  const seasonChanged = newSeason !== oldSeason;
  
  // Fire callbacks
  if (hourChanged && time.onHourChange) time.onHourChange(time);
  if (dayChanged && time.onDayChange) time.onDayChange(time);
  if (seasonChanged && time.onSeasonChange) time.onSeasonChange(time, newSeason);
  
  return { hourChanged, dayChanged, seasonChanged };
}

/**
 * Get current season
 * @param {Object} time - World time
 * @returns {string} Season
 */
export function getSeason(time) {
  const yearProgress = time.dayOfYear / (time.daysPerMonth * time.monthsPerYear);
  
  if (yearProgress < 0.25) return SEASON.SPRING;
  if (yearProgress < 0.5) return SEASON.SUMMER;
  if (yearProgress < 0.75) return SEASON.FALL;
  return SEASON.WINTER;
}

/**
 * Get day/night phase
 * @param {Object} time - World time
 * @returns {{isDay: boolean, isDawn: boolean, isDusk: boolean, isNight: boolean, sunPosition: number}}
 */
export function getDayPhase(time) {
  const hour = time.hour + time.minute / 60;
  
  // Sunrise/sunset times vary by season
  const season = getSeason(time);
  let sunrise = 6, sunset = 18;
  
  switch (season) {
    case SEASON.SUMMER:
      sunrise = 5; sunset = 21;
      break;
    case SEASON.WINTER:
      sunrise = 7; sunset = 17;
      break;
  }
  
  const isDawn = hour >= sunrise - 1 && hour < sunrise + 1;
  const isDusk = hour >= sunset - 1 && hour < sunset + 1;
  const isDay = hour >= sunrise && hour < sunset;
  const isNight = !isDay && !isDawn && !isDusk;
  
  // Sun position (0 = horizon, 1 = zenith)
  let sunPosition = 0;
  if (isDay) {
    const dayLength = sunset - sunrise;
    const dayProgress = (hour - sunrise) / dayLength;
    sunPosition = Math.sin(dayProgress * Math.PI);
  }
  
  return { isDay, isDawn, isDusk, isNight, sunPosition, sunrise, sunset };
}

/**
 * Get formatted time string
 * @param {Object} time - World time
 * @returns {string} Formatted time
 */
export function formatTime(time) {
  const h = Math.floor(time.hour);
  const m = Math.floor(time.minute);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

/**
 * Get formatted date string
 * @param {Object} time - World time
 * @returns {string} Formatted date
 */
export function formatDate(time) {
  const dayOfWeek = DAY_OF_WEEK[time.totalDays % 7];
  const monthName = MONTH[time.month - 1] || `Month ${time.month}`;
  return `${dayOfWeek}, ${monthName} ${time.day}, Year ${time.year}`;
}

// ============================================================================
// WEATHER SYSTEM
// ============================================================================

/** Weather types */
export const WEATHER_TYPE = {
  CLEAR: "clear",
  CLOUDY: "cloudy",
  OVERCAST: "overcast",
  RAIN: "rain",
  HEAVY_RAIN: "heavy_rain",
  THUNDERSTORM: "thunderstorm",
  SNOW: "snow",
  BLIZZARD: "blizzard",
  FOG: "fog",
  SANDSTORM: "sandstorm",
};

/**
 * Create weather system
 * @param {Object} config - Weather config
 * @returns {Object} Weather system
 */
export function createWeatherSystem(config = {}) {
  return {
    currentWeather: config.initialWeather || WEATHER_TYPE.CLEAR,
    temperature: config.initialTemp || 20, // Celsius
    humidity: config.initialHumidity || 0.5, // 0-1
    windSpeed: config.initialWind || 5, // km/h
    windDirection: config.initialWindDir || 0, // Degrees
    
    // Transition
    targetWeather: null,
    transitionProgress: 0,
    transitionDuration: 2, // Hours
    
    // Configuration per biome
    biomeType: config.biome || "temperate",
    
    // Weather history
    forecast: [], // Next 24 hours
    
    // Effects
    visibility: 1.0,
    precipitation: 0,
  };
}

/**
 * Update weather
 * @param {Object} weather - Weather system
 * @param {Object} time - World time
 * @param {number} deltaHours - Hours elapsed
 */
export function updateWeather(weather, time, deltaHours) {
  const season = getSeason(time);
  
  // Update temperature based on time of day and season
  const dayPhase = getDayPhase(time);
  let baseTemp = 15;
  
  switch (season) {
    case SEASON.SUMMER: baseTemp = 25; break;
    case SEASON.WINTER: baseTemp = 0; break;
    case SEASON.SPRING: baseTemp = 12; break;
    case SEASON.FALL: baseTemp = 10; break;
  }
  
  // Day/night variation
  const tempVariation = dayPhase.isDay ? 5 + dayPhase.sunPosition * 5 : -5;
  weather.temperature = baseTemp + tempVariation + aiRng.range(-1, 1);
  
  // Handle weather transition
  if (weather.targetWeather) {
    weather.transitionProgress += deltaHours / weather.transitionDuration;
    
    if (weather.transitionProgress >= 1) {
      weather.currentWeather = weather.targetWeather;
      weather.targetWeather = null;
      weather.transitionProgress = 0;
    }
  }
  
  // Random weather changes
  if (!weather.targetWeather && aiRng.chance(0.02 * deltaHours)) {
    weather.targetWeather = generateNextWeather(weather, season);
  }
  
  // Update wind
  weather.windDirection += aiRng.range(-5, 5) * deltaHours;
  weather.windDirection = (weather.windDirection + 360) % 360;
  weather.windSpeed += aiRng.range(-2.5, 2.5) * deltaHours;
  weather.windSpeed = Math.max(0, Math.min(100, weather.windSpeed));
  
  // Update visibility and precipitation
  updateWeatherEffects(weather);
}

/**
 * Generate next weather type
 */
function generateNextWeather(weather, season) {
  const current = weather.currentWeather;
  
  // Transition probabilities based on current weather
  const transitions = {
    [WEATHER_TYPE.CLEAR]: [WEATHER_TYPE.CLOUDY, WEATHER_TYPE.FOG],
    [WEATHER_TYPE.CLOUDY]: [WEATHER_TYPE.CLEAR, WEATHER_TYPE.OVERCAST, WEATHER_TYPE.RAIN],
    [WEATHER_TYPE.OVERCAST]: [WEATHER_TYPE.CLOUDY, WEATHER_TYPE.RAIN, WEATHER_TYPE.THUNDERSTORM],
    [WEATHER_TYPE.RAIN]: [WEATHER_TYPE.HEAVY_RAIN, WEATHER_TYPE.CLOUDY, WEATHER_TYPE.THUNDERSTORM],
    [WEATHER_TYPE.HEAVY_RAIN]: [WEATHER_TYPE.RAIN, WEATHER_TYPE.THUNDERSTORM],
    [WEATHER_TYPE.THUNDERSTORM]: [WEATHER_TYPE.HEAVY_RAIN, WEATHER_TYPE.RAIN],
    [WEATHER_TYPE.SNOW]: [WEATHER_TYPE.CLOUDY, WEATHER_TYPE.BLIZZARD],
    [WEATHER_TYPE.BLIZZARD]: [WEATHER_TYPE.SNOW, WEATHER_TYPE.CLOUDY],
    [WEATHER_TYPE.FOG]: [WEATHER_TYPE.CLEAR, WEATHER_TYPE.CLOUDY],
  };
  
  let options = transitions[current] || [WEATHER_TYPE.CLEAR];
  
  // Season modifications
  if (season === SEASON.WINTER && weather.temperature < 2) {
    options = options.map(w => 
      w === WEATHER_TYPE.RAIN ? WEATHER_TYPE.SNOW : 
      w === WEATHER_TYPE.HEAVY_RAIN ? WEATHER_TYPE.BLIZZARD : w
    );
  }
  
  return aiRng.pick(options);
}

/**
 * Update weather effects
 */
function updateWeatherEffects(weather) {
  switch (weather.currentWeather) {
    case WEATHER_TYPE.CLEAR:
      weather.visibility = 1.0;
      weather.precipitation = 0;
      break;
    case WEATHER_TYPE.CLOUDY:
      weather.visibility = 0.9;
      weather.precipitation = 0;
      break;
    case WEATHER_TYPE.OVERCAST:
      weather.visibility = 0.7;
      weather.precipitation = 0;
      break;
    case WEATHER_TYPE.RAIN:
      weather.visibility = 0.6;
      weather.precipitation = 0.3;
      break;
    case WEATHER_TYPE.HEAVY_RAIN:
      weather.visibility = 0.3;
      weather.precipitation = 0.7;
      break;
    case WEATHER_TYPE.THUNDERSTORM:
      weather.visibility = 0.2;
      weather.precipitation = 0.8;
      break;
    case WEATHER_TYPE.SNOW:
      weather.visibility = 0.5;
      weather.precipitation = 0.4;
      break;
    case WEATHER_TYPE.BLIZZARD:
      weather.visibility = 0.1;
      weather.precipitation = 0.9;
      break;
    case WEATHER_TYPE.FOG:
      weather.visibility = 0.2;
      weather.precipitation = 0;
      break;
  }
}

/**
 * Get weather effects on gameplay
 * @param {Object} weather - Weather system
 * @returns {Object} Gameplay modifiers
 */
export function getWeatherEffects(weather) {
  return {
    visibilityRange: weather.visibility,
    movementSpeedMod: weather.precipitation > 0.5 ? 0.7 : 1.0,
    soundRangeMod: weather.precipitation > 0.3 ? 0.8 : 1.0,
    trackingDifficulty: weather.precipitation > 0.5 ? 2 : 1,
    fireStartDifficulty: weather.precipitation > 0.1 ? weather.precipitation * 3 : 0,
    coldDamage: weather.temperature < 0 ? Math.abs(weather.temperature) * 0.1 : 0,
    heatDamage: weather.temperature > 40 ? (weather.temperature - 40) * 0.1 : 0,
  };
}

// ============================================================================
// WORLD EVENTS
// ============================================================================

/** Event types */
export const EVENT_TYPE = {
  // Natural
  EARTHQUAKE: "earthquake",
  FLOOD: "flood",
  DROUGHT: "drought",
  WILDFIRE: "wildfire",
  PLAGUE: "plague",
  METEOR: "meteor",
  
  // Social
  FESTIVAL: "festival",
  MARKET_DAY: "market_day",
  TOURNAMENT: "tournament",
  CORONATION: "coronation",
  FUNERAL: "funeral",
  WEDDING: "wedding",
  
  // Conflict
  RAID: "raid",
  INVASION: "invasion",
  REBELLION: "rebellion",
  SIEGE: "siege",
  
  // Supernatural
  ECLIPSE: "eclipse",
  AURORA: "aurora",
  BLOOD_MOON: "blood_moon",
};

/**
 * Create world event
 * @param {Object} config - Event config
 * @returns {Object} World event
 */
export function createWorldEvent(config) {
  return {
    id: config.id || aiRng.uniqueId('event'),
    type: config.type,
    name: config.name || config.type,
    description: config.description || "",
    
    // Timing
    startTime: config.startTime || 0,
    duration: config.duration || 24, // Hours
    
    // Location
    location: config.location || null, // {x, z} or region name
    radius: config.radius || 100,
    
    // Effects
    effects: config.effects || {}, // {effectType: value}
    
    // State
    isActive: false,
    progress: 0,
    
    // Callbacks
    onStart: config.onStart || null,
    onEnd: config.onEnd || null,
    onTick: config.onTick || null,
  };
}

/**
 * Create world event manager
 * @returns {Object} Event manager
 */
export function createEventManager() {
  return {
    scheduledEvents: [],
    activeEvents: new Map(),
    pastEvents: [],
    maxPastEvents: 100,
  };
}

/**
 * Schedule world event
 * @param {Object} manager - Event manager
 * @param {Object} event - Event to schedule
 */
export function scheduleEvent(manager, event) {
  manager.scheduledEvents.push(event);
  manager.scheduledEvents.sort((a, b) => a.startTime - b.startTime);
}

/**
 * Update world events
 * @param {Object} manager - Event manager
 * @param {number} currentTime - Current game time (total hours)
 * @param {number} deltaHours - Hours elapsed
 * @returns {{started: Array, ended: Array}}
 */
export function updateEvents(manager, currentTime, deltaHours) {
  const started = [];
  const ended = [];
  
  // Check scheduled events
  while (manager.scheduledEvents.length > 0 && 
         manager.scheduledEvents[0].startTime <= currentTime) {
    const event = manager.scheduledEvents.shift();
    event.isActive = true;
    manager.activeEvents.set(event.id, event);
    started.push(event);
    
    if (event.onStart) event.onStart(event);
  }
  
  // Update active events
  for (const [id, event] of manager.activeEvents) {
    event.progress += deltaHours / event.duration;
    
    if (event.onTick) event.onTick(event, deltaHours);
    
    if (event.progress >= 1) {
      event.isActive = false;
      manager.activeEvents.delete(id);
      manager.pastEvents.push(event);
      ended.push(event);
      
      if (event.onEnd) event.onEnd(event);
      
      if (manager.pastEvents.length > manager.maxPastEvents) {
        manager.pastEvents.shift();
      }
    }
  }
  
  return { started, ended };
}

// ============================================================================
// COMPLETE WORLD STATE
// ============================================================================

/**
 * Create complete world state
 * @param {Object} config - Configuration
 * @returns {Object} World state
 */
export function createWorldState(config = {}) {
  return {
    time: createWorldTime(config.time),
    weather: createWeatherSystem(config.weather),
    events: createEventManager(),
    
    // Global flags/variables
    flags: new Map(),
    variables: new Map(),
    
    // Regions/zones
    regions: new Map(),
  };
}

/**
 * Update world state
 * @param {Object} world - World state
 * @param {number} realDeltaSeconds - Real seconds elapsed
 * @returns {Object} Changes that occurred
 */
export function updateWorldState(world, realDeltaSeconds) {
  const timeChanges = advanceTime(world.time, realDeltaSeconds);
  
  const deltaGameHours = realDeltaSeconds / world.time.timeScale / 3600;
  
  updateWeather(world.weather, world.time, deltaGameHours);
  const eventChanges = updateEvents(world.events, world.time.totalHours, deltaGameHours);
  
  return {
    time: timeChanges,
    events: eventChanges,
    weather: world.weather.currentWeather,
  };
}
