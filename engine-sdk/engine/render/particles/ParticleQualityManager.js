// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { statsMean } from '../../core/math/MathStatistics.js';

/**
 * ParticleQualityManager - Dynamic quality scaling for particle rendering
 * 
 * Monitors FPS and automatically adjusts particle quality to maintain performance.
 * When FPS drops, quality decreases (more culling). When FPS recovers, quality increases.
 * 
 * Quality Controls:
 *   - quality (0.0-1.0): Overall quality scalar, affects stochastic culling
 *   - lodBias (0.5-3.0): Distance LOD aggressiveness
 *   - cullThreshold (0-maxParticles): Emergency particle count limit
 * 
 * Usage:
 *   const qualityManager = createParticleQualityManager({ targetFps: 60 });
 *   
 *   // In render loop:
 *   qualityManager.update(currentFps, particleCount);
 *   const params = qualityManager.getParams();
 *   // Pass params.quality, params.lodBias, params.cullThreshold to shader
 */

/**
 * Create a particle quality manager
 * @param {Object} options
 * @param {number} options.targetFps - Target render FPS to maintain (default: 60)
 * @param {number} options.targetSimFps - Target sim FPS to maintain (default: 60)
 * @param {number} options.minFps - FPS threshold for emergency culling (default: 20)
 * @param {number} options.minSimFps - Sim FPS threshold for throttling (default: 50)
 * @param {number} options.maxParticles - Maximum particle count (for cullThreshold)
 * @param {Function} options.onQualityChange - Callback when quality changes significantly
 * @param {Function} options.onSimLag - Callback when sim rate drops below threshold
 */
export function createParticleQualityManager(options = {}) {
  const targetFps = options.targetFps || 60;
  const targetSimFps = options.targetSimFps || 60;
  const minFps = options.minFps || 20;
  const minSimFps = options.minSimFps || 50;
  const maxParticles = options.maxParticles || 10000;
  const onQualityChange = options.onQualityChange || null;
  const onSimLag = options.onSimLag || null;
  
  // Current quality state
  let quality = 1.0;           // 0.0 = aggressive culling, 1.0 = full quality
  let lodBias = 1.0;           // 0.5 = minimal LOD, 3.0 = aggressive LOD
  let cullThreshold = 0;       // 0 = no limit, >0 = max particles to render
  let emissionThrottle = 1.0;  // 0.0-1.0 multiplier for emission rate
  
  // FPS tracking with exponential moving average
  let smoothFps = targetFps;
  let smoothSimFps = targetSimFps;
  const fpsAlpha = 0.1;        // Smoothing factor (lower = smoother)
  
  // Quality adjustment rates
  const qualityDecreaseRate = 0.05;  // How fast to decrease quality when lagging
  const qualityIncreaseRate = 0.02;  // How fast to recover quality (slower)
  
  // Emergency mode tracking
  let emergencyMode = false;
  let simLagMode = false;
  let emergencyFrames = 0;
  let simLagFrames = 0;
  let lastQualityLevel = "high";
  
  // Performance history for trend detection
  const fpsHistory = [];
  const simFpsHistory = [];
  const historyLength = 30;    // 0.5 seconds at 60fps
  
  /**
   * Update quality based on current FPS and sim FPS
   * @param {number} currentFps - Current measured render FPS
   * @param {number} particleCount - Current active particle count
   * @param {number} currentSimFps - Current measured simulation FPS (optional)
   */
  function update(currentFps, particleCount = 0, currentSimFps = null) {
    // Smooth render FPS with EMA
    smoothFps = smoothFps * (1 - fpsAlpha) + currentFps * fpsAlpha;
    
    // Smooth sim FPS if provided
    if (currentSimFps !== null) {
      smoothSimFps = smoothSimFps * (1 - fpsAlpha) + currentSimFps * fpsAlpha;
      
      // Track sim FPS history
      simFpsHistory.push(smoothSimFps);
      if (simFpsHistory.length > historyLength) {
        simFpsHistory.shift();
      }
      
      // ===== SIM LAG DETECTION =====
      if (smoothSimFps < minSimFps) {
        if (!simLagMode) {
          simLagMode = true;
          simLagFrames = 0;
          if (onSimLag) {
            onSimLag({ simFps: smoothSimFps, entering: true });
          }
        }
        simLagFrames++;
        
        // Progressive emission throttle based on how far below threshold
        const simDeficit = 1.0 - (smoothSimFps / minSimFps);
        emissionThrottle = Math.max(0.1, 1.0 - simDeficit * 1.5);
        
        // If sim is really struggling, also reduce quality
        if (smoothSimFps < minSimFps * 0.6) {
          quality = Math.max(0.3, quality - qualityDecreaseRate);
        }
      } else {
        // Exiting sim lag mode
        if (simLagMode && smoothSimFps > minSimFps * 1.1) {
          simLagFrames = Math.max(0, simLagFrames - 2);
          if (simLagFrames === 0) {
            simLagMode = false;
            emissionThrottle = Math.min(1.0, emissionThrottle + 0.1);
            if (onSimLag) {
              onSimLag({ simFps: smoothSimFps, entering: false });
            }
          }
        }
        // Slowly recover emission throttle when not lagging
        if (!simLagMode) {
          emissionThrottle = Math.min(1.0, emissionThrottle + 0.02);
        }
      }
    }
    
    // Track render FPS history for trend detection
    fpsHistory.push(smoothFps);
    if (fpsHistory.length > historyLength) {
      fpsHistory.shift();
    }
    
    // Detect FPS trend (are we getting better or worse?)
    const recentAvg = statsMean(fpsHistory.slice(-10));
    const olderAvg = statsMean(fpsHistory.slice(0, 10));
    const trend = recentAvg - olderAvg; // Positive = improving, negative = degrading
    
    // Calculate FPS ratio (how far from target)
    const fpsRatio = smoothFps / targetFps;
    
    // ===== EMERGENCY MODE =====
    // If FPS drops below minFps, enter emergency mode
    if (smoothFps < minFps) {
      emergencyMode = true;
      emergencyFrames++;
      
      // Progressive emergency response
      if (emergencyFrames > 10) {
        // Nuclear option: hard limit particle count
        cullThreshold = Math.max(100, particleCount * 0.3);
      } else {
        // First response: aggressive quality drop
        quality = Math.max(0.2, quality - qualityDecreaseRate * 2);
        lodBias = Math.min(3.0, lodBias + 0.1);
      }
    } else {
      // Exit emergency mode gradually
      if (emergencyMode && smoothFps > targetFps * 0.8) {
        emergencyFrames = Math.max(0, emergencyFrames - 1);
        if (emergencyFrames === 0) {
          emergencyMode = false;
          cullThreshold = 0;  // Remove hard limit
        }
      }
    }
    
    // ===== NORMAL QUALITY ADJUSTMENT =====
    if (!emergencyMode) {
      if (fpsRatio < 0.9) {
        // Below 90% of target: decrease quality
        const deficit = 1.0 - fpsRatio;
        quality = Math.max(0.3, quality - qualityDecreaseRate * deficit * 2);
        lodBias = Math.min(2.5, lodBias + 0.02);
      } else if (fpsRatio > 1.0 && trend >= 0) {
        // At or above target and stable/improving: slowly recover quality
        quality = Math.min(1.0, quality + qualityIncreaseRate);
        lodBias = Math.max(1.0, lodBias - 0.01);
      }
    }
    
    // Determine quality level for logging
    let qualityLevel;
    if (quality > 0.9) qualityLevel = "high";
    else if (quality > 0.6) qualityLevel = "medium";
    else if (quality > 0.3) qualityLevel = "low";
    else qualityLevel = "emergency";
    
    // Notify on significant quality change
    if (qualityLevel !== lastQualityLevel && onQualityChange) {
      onQualityChange({
        quality,
        lodBias,
        cullThreshold,
        level: qualityLevel,
        fps: smoothFps,
        particleCount,
        emergencyMode
      });
    }
    lastQualityLevel = qualityLevel;
  }
  
  /**
   * Get current quality parameters for shader
   * @returns {Object} { quality, lodBias, cullThreshold, emissionThrottle }
   */
  function getParams() {
    return {
      quality,
      lodBias,
      cullThreshold,
      emissionThrottle
    };
  }
  
  /**
   * Get current quality stats for debugging
   * @returns {Object} Full quality state
   */
  function getStats() {
    return {
      quality: quality.toFixed(2),
      lodBias: lodBias.toFixed(2),
      cullThreshold: Math.round(cullThreshold),
      emissionThrottle: emissionThrottle.toFixed(2),
      smoothFps: smoothFps.toFixed(1),
      smoothSimFps: smoothSimFps.toFixed(1),
      emergencyMode,
      simLagMode,
      level: lastQualityLevel
    };
  }
  
  /**
   * Force quality to a specific level (for testing/debugging)
   * @param {number} newQuality - 0.0 to 1.0
   */
  function setQuality(newQuality) {
    quality = Math.max(0, Math.min(1, newQuality));
  }
  
  /**
   * Reset quality to maximum
   */
  function reset() {
    quality = 1.0;
    lodBias = 1.0;
    cullThreshold = 0;
    emissionThrottle = 1.0;
    emergencyMode = false;
    simLagMode = false;
    emergencyFrames = 0;
    simLagFrames = 0;
    smoothFps = targetFps;
    smoothSimFps = targetSimFps;
    fpsHistory.length = 0;
    simFpsHistory.length = 0;
    lastQualityLevel = "high";
  }
  
  return {
    update,
    getParams,
    getStats,
    setQuality,
    reset,
    // Expose for direct access if needed
    get quality() { return quality; },
    get lodBias() { return lodBias; },
    get cullThreshold() { return cullThreshold; },
    get emissionThrottle() { return emissionThrottle; },
    get emergencyMode() { return emergencyMode; },
    get simLagMode() { return simLagMode; },
    get smoothSimFps() { return smoothSimFps; },
  };
}

/**
 * Default quality presets
 */
export const QUALITY_PRESETS = {
  ultra: { quality: 1.0, lodBias: 0.5, cullThreshold: 0 },
  high: { quality: 1.0, lodBias: 1.0, cullThreshold: 0 },
  medium: { quality: 0.7, lodBias: 1.5, cullThreshold: 0 },
  low: { quality: 0.5, lodBias: 2.0, cullThreshold: 5000 },
  potato: { quality: 0.3, lodBias: 3.0, cullThreshold: 2000 },
};
