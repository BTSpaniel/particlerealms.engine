// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { attachInspectorPanel } from "./InspectorPanel.js";

export function attachPhysicsSandboxInspector(options) {
  const {
    getWorld,
    onSelectionChanged,
    logger,
    getSpawnState,
    spawnObjectAtPosition,
    spawnParticlesAtPosition,
    setPendingSpawnType,
    setGhostOffset,
    setSpawnPreviewProps,
    getShaderState,
    setShaderState,
    getLightState,
    setLightState,
    getPhysicsState,
    setPhysicsState,
    onRemoveEntity,
    // Stats for performance monitoring
    getStats,
    // Emitter editing
    getSelectedEmitter,
    // Engine config editing
    getConfig,
    setConfig,
    // Optional: friendly entity label helper
    getEntityLabel,
  } = options || {};

  if (typeof getWorld !== "function") {
    throw new Error("attachPhysicsSandboxInspector: getWorld is required");
  }

  const safeLogger = logger || null;

  return attachInspectorPanel({
    getWorld,
    onSelectionChanged,
    onRemoveEntity,
    spawn: {
      modes: [
        // Geometry spawners
        { id: "cube", label: "Cube (Cyan)" },
        { id: "sphere", label: "Sphere (Magenta)" },
        { id: "plane", label: "Plane (Pink)" },
        { id: "cylinder", label: "Cylinder (Green)" },
        { id: "pillar", label: "Pillar (Tall Green)" },
        // Particle emitters - 4 States of Matter
        { id: "emitter_gas", label: "💨 Gas Emitter" },
        { id: "emitter_liquid", label: "💧 Liquid Emitter" },
        { id: "emitter_solid", label: "🧊 Solid Emitter" },
        { id: "emitter_plasma", label: "⚡ Plasma Emitter" },
      ],
      onSpawn: (modeId, { world, spawnerProps }) => {
        if (typeof getSpawnState !== "function") {
          return;
        }
        // Need at least one spawn function
        const canSpawnObjects = typeof spawnObjectAtPosition === "function";
        const canSpawnParticles = typeof spawnParticlesAtPosition === "function";
        if (!canSpawnObjects && !canSpawnParticles) {
          return;
        }

        const state = getSpawnState();
        if (!state || !state.pendingSpawnPosition) {
          return;
        }

        const {
          pendingSpawnPosition,
          baseSpawnPosition,
          ghostOffset,
          pendingSpawnType,
        } = state;

        // Check if we have a valid spawn position
        if (!pendingSpawnPosition || !Array.isArray(pendingSpawnPosition) || pendingSpawnPosition.length < 3) {
          if (safeLogger && typeof safeLogger.warn === "function") {
            safeLogger.warn("[SPAWN] No valid spawn position - click on floor first");
          }
          return;
        }

        const spawnPos = [
          pendingSpawnPosition[0],
          pendingSpawnPosition[1],
          pendingSpawnPosition[2],
        ];

        let ghostPos = null;
        if (
          baseSpawnPosition &&
          Array.isArray(baseSpawnPosition) &&
          baseSpawnPosition.length >= 3 &&
          Array.isArray(ghostOffset) &&
          ghostOffset.length >= 3
        ) {
          ghostPos = [
            baseSpawnPosition[0] + ghostOffset[0],
            baseSpawnPosition[1] + ghostOffset[1],
            baseSpawnPosition[2] + ghostOffset[2],
          ];
        }

        if (safeLogger && typeof safeLogger.info === "function") {
          if (ghostPos) {
            safeLogger.info(
              `[SPAWN] Ghost position: (${ghostPos[0].toFixed(2)}, ${ghostPos[1].toFixed(2)}, ${ghostPos[2].toFixed(2)})`,
            );
          }
          safeLogger.info(
            `[SPAWN] Spawn position: (${spawnPos[0].toFixed(2)}, ${spawnPos[1].toFixed(2)}, ${spawnPos[2].toFixed(2)})`,
          );
        }

        // Handle particle emitter spawning
        if (modeId && modeId.startsWith("emitter_")) {
          const defaultEmitterType = modeId.replace("emitter_", "");
          const effectiveType =
            spawnerProps && typeof spawnerProps.type === "string" && spawnerProps.type.trim()
              ? spawnerProps.type.trim()
              : defaultEmitterType;
          if (typeof spawnParticlesAtPosition === "function") {
            const emitterProps = {
              ...(spawnerProps || {}),
              type: effectiveType,
            };

            let aimDirection = null;
            const useAimDirection =
              spawnerProps &&
              Object.prototype.hasOwnProperty.call(spawnerProps, "useAimDirection")
                ? !!spawnerProps.useAimDirection
                : true;

            if (useAimDirection) {
              if (
                baseSpawnPosition &&
                Array.isArray(baseSpawnPosition) &&
                baseSpawnPosition.length >= 3 &&
                Array.isArray(ghostOffset) &&
                ghostOffset.length >= 3
              ) {
                const gx = baseSpawnPosition[0] + ghostOffset[0];
                const gy = baseSpawnPosition[1] + ghostOffset[1];
                const gz = baseSpawnPosition[2] + ghostOffset[2];
                const dx = gx - spawnPos[0];
                const dy = gy - spawnPos[1];
                const dz = gz - spawnPos[2];
                const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
                if (len > 1e-4) {
                  aimDirection = [dx / len, dy / len, dz / len];
                }
              }

              if (aimDirection) {
                emitterProps.direction = aimDirection;
              }
            }
            spawnParticlesAtPosition(spawnPos, emitterProps);
            if (safeLogger && typeof safeLogger.info === "function") {
              safeLogger.info(`[SPAWN] Created ${effectiveType} emitter at (${spawnPos[0].toFixed(2)}, ${spawnPos[1].toFixed(2)}, ${spawnPos[2].toFixed(2)})`);
            }
          } else {
            if (safeLogger && typeof safeLogger.warn === "function") {
              safeLogger.warn("[SPAWN] Particle spawning not available");
            }
          }
          return;
        }

        // Object spawning
        if (!canSpawnObjects) {
          if (safeLogger && typeof safeLogger.warn === "function") {
            safeLogger.warn("[SPAWN] Object spawning not available");
          }
          return;
        }
        
        const spawnType = pendingSpawnType || modeId || "cube";
        if (safeLogger && typeof safeLogger.info === "function") {
          safeLogger.info(
            `[SPAWN] Using spawn type: ${spawnType} (modeId=${modeId})`,
          );
        }

        spawnObjectAtPosition(spawnPos, spawnType, spawnerProps);
      },
      onSelect: (modeId) => {
        if (typeof setPendingSpawnType === "function") {
          setPendingSpawnType(modeId);
        }
      },
      setSpawnPreviewProps,
    },
    render: {
      modes: [
        { id: "standard", label: "Standard (Default)" },
        { id: "pbr", label: "PBR (Metallic/Roughness)" },
        { id: "toon", label: "Toon Shading" },
        { id: "unlit", label: "Unlit (Debug)" },
      ],
      getShaderState: () => (typeof getShaderState === "function" ? getShaderState() : {}),
      setShaderState: (patch) => {
        if (typeof setShaderState === "function") {
          setShaderState(patch);
        }
      },
      lightMax: 20,
      getLightState: () =>
        typeof getLightState === "function" ? getLightState() : { intensity: 0 },
      setLightState: (patch) => {
        if (typeof setLightState === "function") {
          setLightState(patch);
        }
      },
    },
    physics: {
      getPhysicsState: () =>
        typeof getPhysicsState === "function"
          ? getPhysicsState()
          : {
              enabled: true,
              gravityScale: 1,
              staticFriction: 0.5,
              dynamicFriction: 0.5,
              restitution: 0.5,
            },
      setPhysicsState: (patch) => {
        if (typeof setPhysicsState === "function") {
          setPhysicsState(patch);
        }
      },
    },
    // Stats panel for FPS, particle count, entity count, emitter count
    stats: typeof getStats === "function" ? { getStats } : null,
    // Emitter settings panel (shows when emitter selected)
    emitter: typeof getSelectedEmitter === "function" ? { getSelectedEmitter } : null,
    // Engine config editor
    engine: (typeof getConfig === "function" && typeof setConfig === "function")
      ? { getConfig, setConfig } : null,
    // Entity list labeling
    getEntityLabel,
  });
}
