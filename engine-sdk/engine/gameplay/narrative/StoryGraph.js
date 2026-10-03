// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * StoryGraph — Storylet engine for LIFE.
 *
 * Stories are storylets, not one fixed script. A storylet is a small reusable
 * story event that triggers when conditions are true.
 *
 * Each storylet has: trigger conditions, cast, stakes, choices,
 * consequences, memories, and graph updates.
 */

import { uniformDistribution } from '../../core/math/MathRandom.js'

let _nextStoryletId = 1

export const StoryletRarity = Object.freeze({
  COMMON: 'common',
  UNCOMMON: 'uncommon',
  RARE: 'rare',
  LEGENDARY: 'legendary'
})

const RARITY_WEIGHTS = Object.freeze({
  [StoryletRarity.COMMON]: 1.0,
  [StoryletRarity.UNCOMMON]: 0.65,
  [StoryletRarity.RARE]: 0.35,
  [StoryletRarity.LEGENDARY]: 0.15
})

/**
 * Create a storylet definition.
 *
 * @param {object} config
 * @param {string} config.id - Unique storylet ID
 * @param {string} config.name - Human-readable name
 * @param {string[]} config.tags - Content tags
 * @param {function} config.canTrigger - (worldState) => boolean
 * @param {function} config.execute - (worldState, cast) => { narrative, consequences, memories }
 * @param {function} [config.selectCast] - (worldState) => object — pick NPCs to fill roles
 * @param {number} [config.cooldown=60000] - Min ms between fires
 * @param {number} [config.priority=5] - Higher = checked first
 * @param {number} [config.maxFires=0] - 0 = unlimited
 * @param {string} [config.description]
 */
export function createStorylet(config) {
  return {
    id: config.id || `storylet_${_nextStoryletId++}`,
    name: config.name || 'Unnamed Storylet',
    tags: config.tags || [],
    canTrigger: config.canTrigger || (() => true),
    execute: config.execute || (() => ({})),
    selectCast: config.selectCast || null,
    cultureVariants: config.cultureVariants || {},
    locationVariants: config.locationVariants || {},
    relationshipVariants: config.relationshipVariants || {},
    cooldown: config.cooldown !== undefined ? config.cooldown : 60000,
    priority: config.priority || 5,
    rarity: config.rarity || StoryletRarity.COMMON,
    maxFires: config.maxFires || 0,
    description: config.description || '',
    // Runtime state
    fireCount: 0,
    lastFired: 0
  }
}

export class StoryGraph {
  /**
   * @param {import('../events/EventGraph.js').EventGraph} eventGraph
   * @param {object} [debugger_]
   * @param {object} [options]
   * @param {() => number} [options.random] source of randomness in [0, 1).
   *   Defaults to `Math.random`. Inject a seeded stream when storylet
   *   selection must be reproducible — e.g. an authoritative multiplayer host
   *   whose peers have to agree on which storylet fired, or a replay.
   * @param {() => number} [options.now] millisecond clock used for cooldowns.
   *   Defaults to `Date.now`. Inject a simulation clock when eligibility must
   *   not depend on wall-clock time; with the default, a paused or slow frame
   *   changes which storylets are available, which is fine for ambient flavour
   *   and wrong for anything the simulation depends on.
   */
  constructor(eventGraph, debugger_, options = {}) {
    this._events = eventGraph
    this._debugger = debugger_ || null
    this._random = options.random || Math.random
    this._now = options.now || (() => Date.now())

    /** @type {Map<string, object>} Registered storylets */
    this._storylets = new Map()

    /** @type {string[]} Recently used storylet IDs (for repetition control) */
    this._recentlyUsed = []
    this.maxRecent = 20

    /** @type {number} Tick counter */
    this._tick = 0
  }

  /**
   * Register a storylet.
   * @param {object} storylet - From createStorylet()
   */
  register(storylet) {
    this._storylets.set(storylet.id, storylet)
    if (this._debugger) {
      this._debugger.registerStorylet({
        id: storylet.id,
        name: storylet.name,
        conditions: [
          { name: 'canTrigger', check: (ws) => ({ passed: storylet.canTrigger(ws) }) },
          { name: 'cooldown', check: () => {
            const elapsed = this._now() - storylet.lastFired
            return { passed: elapsed >= storylet.cooldown, value: elapsed, required: storylet.cooldown }
          }},
          { name: 'maxFires', check: () => ({
            passed: storylet.maxFires === 0 || storylet.fireCount < storylet.maxFires,
            value: storylet.fireCount, required: storylet.maxFires
          })},
          { name: 'not_recently_used', check: () => ({
            passed: !this._recentlyUsed.includes(storylet.id)
          })}
        ],
        tags: storylet.tags,
        cooldown: storylet.cooldown
      })
    }
  }

  /**
   * Register multiple storylets at once.
   * @param {object[]} storylets
   */
  registerAll(storylets) {
    for (const s of storylets) this.register(s)
  }

  /**
   * Check all storylets and fire the best eligible one.
   *
   * @param {object} worldState - Current world context
   * @returns {object|null} Fired storylet result, or null if nothing eligible
   */
  tick(worldState) {
    this._tick++

    // Find all eligible storylets
    const eligible = []
    const now = this._now()

    for (const [, storylet] of this._storylets) {
      // Max fires check
      if (storylet.maxFires > 0 && storylet.fireCount >= storylet.maxFires) continue
      // Cooldown check
      if (now - storylet.lastFired < storylet.cooldown) continue
      // Recently used check
      if (this._recentlyUsed.includes(storylet.id)) continue
      // Condition check
      try {
        if (!storylet.canTrigger(worldState)) continue
      } catch (e) {
        continue
      }

      eligible.push(storylet)
    }

    if (eligible.length === 0) return null

    const storylet = this._selectByPriorityAndRarity(eligible)
    return this._fire(storylet, worldState)
  }

  /**
   * Force-fire a specific storylet (for testing / debug).
   *
   * @param {string} storyletId
   * @param {object} worldState
   * @returns {object|null}
   */
  forceFire(storyletId, worldState) {
    const storylet = this._storylets.get(storyletId)
    if (!storylet) return null
    return this._fire(storylet, worldState)
  }

  /**
   * Get all registered storylet IDs and names.
   * @returns {object[]}
   */
  getAll() {
    const out = []
    for (const [, s] of this._storylets) {
      out.push({ id: s.id, name: s.name, fireCount: s.fireCount, tags: s.tags, priority: s.priority, rarity: s.rarity, cultureVariantCount: Object.keys(s.cultureVariants || {}).length, locationVariantCount: Object.keys(s.locationVariants || {}).length, relationshipVariantCount: Object.keys(s.relationshipVariants || {}).length })
    }
    return out
  }

  /** Get count of registered storylets */
  get size() { return this._storylets.size }

  // ── Internal ──

  _fire(storylet, worldState) {
    // Select cast if available
    let cast = null
    if (storylet.selectCast) {
      try { cast = storylet.selectCast(worldState) } catch (e) { cast = null }
    }

    // Execute
    let result
    try {
      result = storylet.execute(worldState, cast) || {}
      result = this._applyCultureVariant(storylet, worldState, result)
      result = this._applyLocationVariant(storylet, worldState, result)
      result = this._applyRelationshipVariant(storylet, worldState, result)
    } catch (e) {
      result = { error: e.message }
    }

    // Update state
    storylet.fireCount++
    storylet.lastFired = this._now()

    // Track recently used
    this._recentlyUsed.push(storylet.id)
    if (this._recentlyUsed.length > this.maxRecent) this._recentlyUsed.shift()

    // Emit event
    this._events.emit({
      type: 'storylet.fired',
      data: { storyletId: storylet.id, name: storylet.name, cast, result },
      tags: ['narrative', 'storylet', ...storylet.tags],
      description: result.narrative || `Storylet "${storylet.name}" fired.`
    })

    // Debugger
    if (this._debugger) {
      this._debugger.recordFire(storylet.id, { cast, result })
    }

    return { storyletId: storylet.id, name: storylet.name, cast, ...result }
  }

  _selectByPriorityAndRarity(eligible) {
    let highestPriority = -Infinity
    for (const storylet of eligible) {
      if (storylet.priority > highestPriority) highestPriority = storylet.priority
    }

    // Sorted by id so the weighted walk below consumes the band in a stable
    // order. Without this the outcome depends on Map insertion order, i.e. on
    // the order storylets happened to be registered in — which is reproducible
    // within one process and not across two, so an injected seeded stream
    // would still produce divergent results between peers.
    const band = eligible
      .filter(storylet => storylet.priority === highestPriority)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const totalWeight = band.reduce((sum, storylet) => sum + (RARITY_WEIGHTS[storylet.rarity] || RARITY_WEIGHTS[StoryletRarity.COMMON]), 0)
    let roll = uniformDistribution(0, totalWeight, this._random)
    for (const storylet of band) {
      roll -= RARITY_WEIGHTS[storylet.rarity] || RARITY_WEIGHTS[StoryletRarity.COMMON]
      if (roll <= 0) return storylet
    }
    return band[0]
  }

  _applyCultureVariant(storylet, worldState, result) {
    const variants = storylet.cultureVariants || {}
    const culture = worldState.culture || worldState.playerCulture || worldState.originCulture
    const variant = variants[culture] || variants.default
    if (!variant) return result
    const narrative = typeof variant === 'function' ? variant(worldState, result) : variant
    if (!narrative) return result
    return { ...result, narrative, cultureVariant: culture || 'default' }
  }

  _applyLocationVariant(storylet, worldState, result) {
    const variants = storylet.locationVariants || {}
    const location = worldState.location || worldState.currentLocation || worldState.playerLocation || worldState.locationId
    const variant = variants[location] || variants[worldState.region] || variants.default
    if (!variant) return result
    const narrative = typeof variant === 'function' ? variant(worldState, result) : variant
    if (!narrative) return result
    return { ...result, narrative, locationVariant: location || worldState.region || 'default' }
  }

  _applyRelationshipVariant(storylet, worldState, result) {
    const variants = storylet.relationshipVariants || {}
    const tone = this._getRelationshipTone(worldState)
    const variant = variants[tone] || variants.default
    if (!variant) return result
    const narrative = typeof variant === 'function' ? variant(worldState, result) : variant
    if (!narrative) return result
    return { ...result, narrative, relationshipVariant: tone }
  }

  _getRelationshipTone(worldState) {
    const explicitTone = this._normalizeRelationshipTone(worldState.relationshipTone)
      || this._normalizeRelationshipTone(worldState.relationshipLevel)
      || this._normalizeRelationshipTone(worldState.opinion)
    if (explicitTone) return explicitTone

    const trust = worldState.trust ?? worldState.relationshipTrust ?? worldState.companionTrust ?? 0
    const love = worldState.love ?? worldState.relationshipLove ?? 0
    const hate = worldState.hate ?? worldState.relationshipHate ?? 0
    const fear = worldState.fear ?? worldState.relationshipFear ?? 0

    if (love > 50) return 'beloved'
    if (hate > 40 || trust < -20) return 'hostile'
    if (fear > 40 || trust < 0) return 'wary'
    if (trust > 40) return 'trusted'
    if (trust > 10) return 'friendly'
    return 'neutral'
  }

  _normalizeRelationshipTone(tone) {
    if (!tone) return null

    const aliases = {
      beloved: 'beloved',
      trusted: 'trusted',
      trusted_ally: 'trusted',
      ally: 'friendly',
      friendly: 'friendly',
      friend: 'friendly',
      neutral: 'neutral',
      stranger: 'neutral',
      wary: 'wary',
      distrusted: 'wary',
      feared: 'wary',
      hostile: 'hostile',
      enemy: 'hostile'
    }

    return aliases[tone] || tone
  }

  /** Clear all storylets */
  clear() {
    this._storylets.clear()
    this._recentlyUsed = []
  }
}

export default StoryGraph
