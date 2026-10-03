// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

export const DefaultEngineConfig = {
  room: {
    size: 50,
    lightHeightOffset: 5, // LIGHT_CUBE_HEIGHT = size / 2 - offset
  },
  physics: {
    enabled: true,
    gravity: [0, -9.81, 0],
    gravityScale: 1.0,
    staticFriction: 0.5,
    dynamicFriction: 0.5,
    restitution: 0.5,
  },
  render: {
    cameraFarMultiplier: 4,
    initialCameraDistanceMult: 1.5,
    cameraDebugLogging: false,

    cameraMovementAccelerationSeconds: 0,

    cameraMovementDecelerationSeconds: 0,
    cameraGamepadLookRadiansPerSecond: 2.5,
    cameraZoomWheelSensitivity: 0.001,
    cameraGamepadZoomRate: 1.5,
    cameraMinZoomDistance: 1,
    cameraMaxZoomDistance: 1000,
    cameraCollisionEnabled: true,
    cameraCollisionClearance: 0.25,
    cameraCollisionTargetOffset: 0.5,
    cameraCollisionMinDistance: 0.25,
    cameraCollisionRecoverySeconds: 0.1,
    cameraFocusPadding: 1.1,
    cameraFocusTransitionSeconds: 0.25,
  },
  particles: {
    maxCount: 20000,
    workgroupSize: 256,
  },
  spawn: {
    ballRadius: 0.5,
    minSpawnDistance: 0.25,
    maxSpawnDistanceMultiplier: 2,
    grabHoldMs: 750,
  },
  // Audio engine settings
  audio: {
    masterVolume: 1.0,
    sfxVolume: 1.0,
    musicVolume: 0.7,
    ambientVolume: 0.8,
    voiceVolume: 1.0,
    uiVolume: 0.8,
    maxVoices: 64,
    spatialAudio: true,
    quality: 'high',       // 'low' (22050Hz), 'medium' (44100Hz), 'high' (48000Hz)
  },
  // High-performance resource management settings
  resources: {
    enabled: true,
    // Host Memory (RAM) - Slab allocators
    frameSlabSizeMB: 32,        // Per-frame scratch memory (resets each frame)
    stagingSlabSizeMB: 16,      // GPU staging buffer memory
    // GPU Memory (VRAM) - Ring buffers and buddy allocator
    uniformRingSizeMB: 8,       // Dynamic uniform data ring buffer
    vertexRingSizeMB: 16,       // Dynamic vertex/instance data
    geometryHeapSizeMB: 64,     // Static geometry (buddy allocator)
    textureBudgetMB: 512,       // Texture cache LRU budget
    // Scheduler
    maxParticles: 100000,       // SoA particle system capacity
    enableWorkers: false,       // Enable Web Worker job dispatch
    // Debug
    debug: false,               // Log memory stats
    logInterval: 5000,          // Memory report interval (ms), 0 = disabled
  },
};
