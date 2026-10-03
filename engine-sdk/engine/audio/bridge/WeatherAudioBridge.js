// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * WeatherAudioBridge.js - Weather/Time → Ambient Audio
 * 
 * Crossfades ambient audio loops based on WorldTime day/night cycle,
 * seasons, and weather conditions.
 */

// ============================================================================
// AMBIENT SOUND MAP
// ============================================================================

const TIME_OF_DAY_SOUNDS = {
  dawn:     { ambient: 'ambient_dawn',     volume: 0.4 },
  morning:  { ambient: 'ambient_birds',    volume: 0.5 },
  midday:   { ambient: 'ambient_day',      volume: 0.3 },
  afternoon:{ ambient: 'ambient_day',      volume: 0.35 },
  dusk:     { ambient: 'ambient_dusk',     volume: 0.4 },
  evening:  { ambient: 'ambient_crickets', volume: 0.5 },
  night:    { ambient: 'ambient_night',    volume: 0.6 },
  midnight: { ambient: 'ambient_night',    volume: 0.5 },
};

const WEATHER_SOUNDS = {
  clear:      { ambient: null,              volume: 0 },
  rain_light: { ambient: 'weather_rain_light', volume: 0.4 },
  rain_heavy: { ambient: 'weather_rain_heavy', volume: 0.7 },
  thunder:    { ambient: 'weather_thunder',     volume: 0.8 },
  wind_light: { ambient: 'weather_wind_light',  volume: 0.3 },
  wind_heavy: { ambient: 'weather_wind_heavy',  volume: 0.6 },
  snow:       { ambient: 'weather_snow',        volume: 0.2 },
};

// ============================================================================
// CREATION
// ============================================================================

/**
 * Create a weather audio bridge.
 * @param {Object} config
 * @param {number} config.crossfadeTime - Seconds to crossfade between ambients (default 3.0)
 * @returns {Object}
 */
export function createWeatherAudioBridge(config = {}) {
  return {
    crossfadeTime: config.crossfadeTime ?? 3.0,
    currentTimeOfDay: null,
    currentWeather: null,
    activeTimeAmbient: null,   // Source ID
    activeWeatherAmbient: null, // Source ID
    _lastUpdate: 0,
    updateInterval: 5.0, // Check every 5 seconds
  };
}

// ============================================================================
// UPDATE
// ============================================================================

/**
 * Tick weather audio — check time of day and weather, crossfade ambients.
 * @param {Object} bridge
 * @param {Object} worldTime - WorldTime state (from WorldTime.js)
 * @param {string} weather - Current weather condition key
 * @param {number} currentTime - Engine time
 * @returns {Object[]} Array of trigger configs (start/stop ambient sources)
 */
export function tickWeatherAudio(bridge, worldTime, weather, currentTime) {
  if (!bridge) return [];

  if (currentTime - bridge._lastUpdate < bridge.updateInterval) return [];
  bridge._lastUpdate = currentTime;

  const triggers = [];

  // Determine time of day from worldTime
  const timeOfDay = _getTimeOfDay(worldTime);
  if (timeOfDay && timeOfDay !== bridge.currentTimeOfDay) {
    const sound = TIME_OF_DAY_SOUNDS[timeOfDay];
    if (sound && sound.ambient) {
      // Stop old ambient
      if (bridge.activeTimeAmbient != null) {
        triggers.push({ action: 'stop', sourceId: bridge.activeTimeAmbient, fadeOut: bridge.crossfadeTime });
      }
      // Start new
      triggers.push({
        action: 'play',
        eventId: sound.ambient,
        volume: sound.volume,
        bus: 'ambient',
        loop: true,
        priority: 1,
        _storeAs: 'timeAmbient',
      });
    }
    bridge.currentTimeOfDay = timeOfDay;
  }

  // Weather layer
  const weatherKey = weather || 'clear';
  if (weatherKey !== bridge.currentWeather) {
    const wsound = WEATHER_SOUNDS[weatherKey];
    // Stop old weather ambient
    if (bridge.activeWeatherAmbient != null) {
      triggers.push({ action: 'stop', sourceId: bridge.activeWeatherAmbient, fadeOut: bridge.crossfadeTime });
      bridge.activeWeatherAmbient = null;
    }
    // Start new if not clear
    if (wsound && wsound.ambient) {
      triggers.push({
        action: 'play',
        eventId: wsound.ambient,
        volume: wsound.volume,
        bus: 'ambient',
        loop: true,
        priority: 1,
        _storeAs: 'weatherAmbient',
      });
    }
    bridge.currentWeather = weatherKey;
  }

  return triggers;
}

// ============================================================================
// DESTROY
// ============================================================================

export function destroyWeatherAudioBridge(bridge) {
  if (!bridge) return;
  bridge.currentTimeOfDay = null;
  bridge.currentWeather = null;
}

// ============================================================================
// INTERNAL
// ============================================================================

function _getTimeOfDay(worldTime) {
  if (!worldTime) return 'midday';
  // If worldTime has an hour property or getHour() method
  let hour = 12;
  if (typeof worldTime.getHour === 'function') {
    hour = worldTime.getHour();
  } else if (worldTime.hour != null) {
    hour = worldTime.hour;
  } else if (worldTime.calendar?.hour != null) {
    hour = worldTime.calendar.hour;
  }

  if (hour >= 5 && hour < 7) return 'dawn';
  if (hour >= 7 && hour < 10) return 'morning';
  if (hour >= 10 && hour < 14) return 'midday';
  if (hour >= 14 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 19) return 'dusk';
  if (hour >= 19 && hour < 22) return 'evening';
  if (hour >= 22 || hour < 1) return 'night';
  return 'midnight';
}
