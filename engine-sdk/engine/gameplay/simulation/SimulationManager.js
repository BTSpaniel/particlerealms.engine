// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SimulationManager — Controls simulation levels for all entities.
 *
 * Active:  Near player — full behavior, every tick
 * Warm:    Same town — slower updates, simplified drives
 * Cold:    Far away — daily summary simulation
 * Frozen:  No updates until touched by event
 *
 * Transition triggers: player proximity, event targeting, faction actions.
 */

export const SimLevel = Object.freeze({
  ACTIVE: 'active',
  WARM:   'warm',
  COLD:   'cold',
  FROZEN: 'frozen'
})

export class SimulationManager {
  /**
   * @param {object} entitySystem
   * @param {import('../ai/index.js').NPCBrain} npcBrain
   * @param {import('../social/index.js').SoulGraph} soulGraph
   * @param {import('../social/index.js').SoulGraphMessaging} messaging
   * @param {import('../ai/index.js').InstinctGraph} instinctGraph
   */
  constructor(entitySystem, npcBrain, soulGraph, messaging, instinctGraph) {
    this._entities = entitySystem
    this._brain = npcBrain
    this._soul = soulGraph
    this._messaging = messaging
    this._instinct = instinctGraph

    /** @type {number} Radius in world units for Active level */
    this.activeRadius = 10
    /** @type {number} Radius for Warm level */
    this.warmRadius = 30
    /** @type {number} Radius for Cold level */
    this.coldRadius = 100

    /** @type {number} Tick counter for staggered updates */
    this._tick = 0

    /** @type {number} Warm entities update every N ticks */
    this.warmTickRate = 10
    /** @type {number} Cold entities update every N ticks */
    this.coldTickRate = 60
  }

  /**
   * Update simulation levels based on player position, then tick active/warm entities.
   *
   * @param {number} playerX - Player world X
   * @param {number} playerZ - Player world Z
   * @param {object} context - Shared context { threats, opportunities, crimeNearby, activeBodies }
   */
  update(playerX, playerZ, context) {
    this._tick++

    // Update simulation levels
    for (const entity of this._entities.all()) {
      if (entity.id === 'player') continue

      const loc = entity.location.current
      if (!loc) {
        this._entities.setSimulationLevel(entity.id, SimLevel.FROZEN)
        continue
      }

      const bodyState = this._getActiveBodyState(entity.id, context?.activeBodies)
      const ex = bodyState?.position?.wx ?? (entity._worldX !== undefined ? entity._worldX : 15)
      const ez = bodyState?.position?.wz ?? (entity._worldZ !== undefined ? entity._worldZ : 15)

      const dist = Math.sqrt((playerX - ex) ** 2 + (playerZ - ez) ** 2)
      const importance = this._activeBodyImportance(bodyState)
      const effectiveDist = Math.max(0, dist - importance * this.activeRadius)

      let newLevel
      if (effectiveDist <= this.activeRadius) {
        newLevel = SimLevel.ACTIVE
      } else if (effectiveDist <= this.warmRadius) {
        newLevel = SimLevel.WARM
      } else if (effectiveDist <= this.coldRadius) {
        newLevel = SimLevel.COLD
      } else {
        newLevel = SimLevel.FROZEN
      }

      this._entities.setSimulationLevel(entity.id, newLevel)
    }

    // Tick active entities — full brain every tick
    const activeIds = this._entities.getActive()
    for (const id of activeIds) {
      if (id === 'player') continue
      const entity = this._entities.get(id)
      if (!entity || !entity.identity.alive) continue

      const nearbyEntities = this._getNearbyEntities(entity)
      const activeBody = this._getActiveBodyState(entity.id, context?.activeBodies)
      const situationTag = this._inferSituationTag(entity, activeBody, context)
      const fastInstinct = situationTag ? this._instinct.getInstinct(entity.id, situationTag) : null
      const entityContext = { ...context, nearbyEntities, activeBody, situationTag, fastInstinct }

      const result = this._brain.think(entity, entityContext)
      if (result.motorIntent) {
        context?.activeBodies?.setIntentMetadata?.(entity.id, result.motorIntent)
      }
      if (result.winner) {
        this._brain.execute(entity, result.winner, entityContext)
      }
    }

    // Tick warm entities — simplified, every N ticks
    if (this._tick % this.warmTickRate === 0) {
      const warmIds = this._entities.getBySimulationLevel(SimLevel.WARM)
      for (const id of warmIds) {
        const entity = this._entities.get(id)
        if (!entity || !entity.identity.alive) continue

        // Simplified: only instinct check, no full brain
        const defaultAction = this._instinct.getDefaultBehavior(id)
        entity.brain.activeInstinct = defaultAction

        // Slow mood drift toward baseline
        this._driftMood(entity, 0.02)
      }
    }

    // Tick cold entities — summary, every N ticks
    if (this._tick % this.coldTickRate === 0) {
      const coldIds = this._entities.getBySimulationLevel(SimLevel.COLD)
      for (const id of coldIds) {
        const entity = this._entities.get(id)
        if (!entity || !entity.identity.alive) continue

        // Summary: compress memories, drift mood heavily
        this._instinct.compressMemories(id)
        this._driftMood(entity, 0.1)
      }
    }

    // Process messaging every few ticks
    if (this._tick % 5 === 0) {
      this._messaging.processTick()
    }
  }

  /**
   * Force-wake an entity (e.g. when an event targets it).
   * @param {string} entityId
   */
  wake(entityId) {
    this._entities.setSimulationLevel(entityId, SimLevel.ACTIVE)
  }

  /**
   * Get simulation stats.
   * @returns {object}
   */
  getStats() {
    return {
      tick: this._tick,
      active: this._entities.getBySimulationLevel(SimLevel.ACTIVE).length,
      warm: this._entities.getBySimulationLevel(SimLevel.WARM).length,
      cold: this._entities.getBySimulationLevel(SimLevel.COLD).length,
      frozen: this._entities.getBySimulationLevel(SimLevel.FROZEN).length,
      pendingMessages: this._messaging.pendingCount
    }
  }

  // ── Internal ──

  _getNearbyEntities(entity) {
    const loc = entity.location.current
    if (!loc) return []
    return this._entities.getAtLocation(loc)
      .map(id => this._entities.get(id))
      .filter(e => e && e.id !== entity.id && e.identity.alive)
  }

  _getActiveBodyState(entityId, activeBodies) {
    if (!activeBodies) return null
    const position = activeBodies.getPelvisPosition?.(entityId) || null
    const readback = activeBodies.getReadback?.(entityId) || null
    if (!position && !readback) return null
    return {
      position,
      state: readback?.state ?? null,
      balanceState: readback?.balanceState ?? null,
      poseState: readback?.poseState ?? null,
      groundedFeet: readback?.groundedFeet ?? null,
      balanceError: readback?.balanceError ?? 0,
    }
  }

  _activeBodyImportance(bodyState) {
    if (!bodyState) return 0
    let importance = 0.2
    const state = bodyState.state
    if (state === 'stumble') importance = Math.max(importance, 0.7)
    if (state === 'fallen' || state === 'getup' || state === 'ko') importance = Math.max(importance, 1.0)
    if ((bodyState.balanceError ?? 0) > 0.28) importance = Math.max(importance, 0.6)
    if ((bodyState.balanceError ?? 0) > 0.58) importance = Math.max(importance, 0.9)
    return importance
  }

  _inferSituationTag(entity, activeBody, context) {
    if (activeBody?.state === 'fallen' || activeBody?.state === 'getup' || activeBody?.state === 'ko') return 'sees_injury'
    if ((activeBody?.balanceError ?? 0) > 0.58) return 'sees_danger'
    if (context?.crimeNearby) return 'sees_crime'
    if (Array.isArray(context?.threats) && context.threats.some(t => t && t.id !== entity.id)) return 'sees_enemy'
    return null
  }

  _driftMood(entity, rate) {
    const m = entity.mood
    // Drift all mood values toward 50 (baseline) at the given rate
    for (const key of ['fear', 'anger', 'stress', 'joy', 'hope']) {
      if (m[key] !== undefined) {
        m[key] += (50 - m[key]) * rate
      }
    }
    // Drift hunger up slowly
    m.hunger = Math.min(100, (m.hunger || 0) + rate * 5)
  }
}

export default SimulationManager
