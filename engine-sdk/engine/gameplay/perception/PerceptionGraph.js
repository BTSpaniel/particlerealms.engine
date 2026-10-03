// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * PerceptionGraph — Controls what the player can perceive about NPCs.
 *
 * NPCs have hidden truth. The player sees tags based on perception skill,
 * distance, lighting, relationship, NPC deception, disguise, and domain effects.
 * Tags can be WRONG if the NPC is good at hiding.
 */

import { clamp as clampScalar } from '../../core/math/MathScalar.js'

export const PerceptionLevel = Object.freeze({
  NONE:      0,
  LOW:       1,
  MEDIUM:    2,
  HIGH:      3,
  VERY_HIGH: 4
})

export class PerceptionGraph {
  /**
   * @param {import('../../core/EntitySystem.js').EntitySystem} entitySystem
   */
  constructor(entitySystem) {
    this._entities = entitySystem
  }

  /**
   * Get perception tags for a target entity from the player's perspective.
   *
   * @param {string} playerId
   * @param {string} targetId
   * @param {object} context - { distance, lighting (0-1), inDomain }
   * @returns {object} { tags: string[], level: number, confidence: number }
   */
  perceive(playerId, targetId, context) {
    const player = this._entities.get(playerId)
    const target = this._entities.get(targetId)
    if (!player || !target) return { tags: [], level: 0, confidence: 0 }

    // Calculate effective perception level
    const level = this._calcLevel(player, target, context)
    const confidence = this._calcConfidence(level, target)

    // Generate tags based on level
    const tags = this._generateTags(target, level, player, confidence)

    return { tags, level, confidence }
  }

  /**
   * Get perception tags for ALL nearby entities.
   *
   * @param {string} playerId
   * @param {string[]} nearbyIds
   * @param {object} context
   * @returns {Map<string, object>} targetId → { tags, level, confidence }
   */
  perceiveAll(playerId, nearbyIds, context) {
    const results = new Map()
    for (const id of nearbyIds) {
      results.set(id, this.perceive(playerId, id, context))
    }
    return results
  }

  // ── Internal ──

  _calcLevel(player, target, ctx) {
    const baseSkill = player.skills.perception || 0
    const distance = ctx.distance || 5
    const lighting = ctx.lighting !== undefined ? ctx.lighting : 1.0

    // Base level from skill
    let level = 0
    if (baseSkill >= 8) level = PerceptionLevel.VERY_HIGH
    else if (baseSkill >= 5) level = PerceptionLevel.HIGH
    else if (baseSkill >= 2) level = PerceptionLevel.MEDIUM
    else level = PerceptionLevel.LOW

    // Distance penalty
    if (distance > 15) level = Math.max(0, level - 2)
    else if (distance > 8) level = Math.max(0, level - 1)

    // Lighting penalty
    if (lighting < 0.3) level = Math.max(0, level - 1)

    // Relationship bonus (knowing someone helps)
    const rel = player.relationships.edges[target.id]
    if (rel && (rel.familiarity || 0) > 50) level = Math.min(PerceptionLevel.VERY_HIGH, level + 1)

    // NPC deception skill reduces perception
    const deception = target.perception_profile.deceptionSkill || 0
    if (deception > 5 && level > PerceptionLevel.LOW) level--

    // Domain effects
    if (ctx.inDomain) level = Math.min(PerceptionLevel.VERY_HIGH, level + 1)

    return level
  }

  _calcConfidence(level, target) {
    const deception = target.perception_profile.deceptionSkill || 0
    const emotionalControl = target.perception_profile.emotionalControl || 0.5

    // Higher level = more confident, but deception reduces it
    let confidence = level * 0.25
    confidence -= deception * 0.05
    confidence -= emotionalControl * 0.1
    return Math.max(0.1, clampScalar(confidence, 0.1, 1.0))
  }

  _generateTags(target, level, player, confidence) {
    const tags = []
    const profile = target.perception_profile
    const identity = target.identity
    const mood = target.mood
    const health = target.health
    const resolve = target.resolve

    if (level >= PerceptionLevel.LOW) {
      // Basic: role, species
      tags.push(identity.role || 'Unknown')
      if (identity.species !== 'human') tags.push(identity.species)

      // Obvious mood (if not hidden well)
      if ((mood.fear || 0) > 60 && confidence > 0.3) tags.push('Nervous?')
      if ((mood.anger || 0) > 60 && confidence > 0.3) tags.push('Hostile?')
    }

    if (level >= PerceptionLevel.MEDIUM) {
      // Name
      tags.unshift(identity.name)

      // Mood with more detail
      if ((mood.fear || 0) > 40) tags.push('Scared')
      if ((mood.anger || 0) > 40) tags.push('Angry')
      if ((mood.joy || 0) > 60) tags.push('Happy')
      if ((mood.stress || 0) > 50) tags.push('Stressed')

      // Health
      if (health.hp < health.maxHp * 0.5) tags.push('Injured')
      if (health.wounds && health.wounds.length > 0) tags.push('Wounded')
    }

    if (level >= PerceptionLevel.HIGH) {
      // Relationship awareness
      const rel = target.relationships.edges[player.id]
      if (rel) {
        if ((rel.trust || 0) > 30) tags.push('Trusts You')
        if ((rel.trust || 0) < -20) tags.push('Distrusts You')
        if ((rel.fear || 0) > 30) tags.push('Fears You')
        if ((rel.love || 0) > 40) tags.push('Attached')
        if ((rel.hate || 0) > 30) tags.push('Hostile')
      }

      // Hidden mood
      if ((mood.hunger || 0) > 60) tags.push('Hungry')
      if (mood.fear > 30 && (target.perception_profile.emotionalControl || 0) > 0.6) {
        tags.push('Hiding Pain')
      }
    }

    if (level >= PerceptionLevel.VERY_HIGH) {
      // Deep perception: resolve, contracts, powers
      if (resolve.activePath) {
        tags.push(`${resolve.activePath} Resolve Forming`)
      }

      // Specific injuries
      if (health.wounds) {
        for (const w of health.wounds) {
          tags.push(`${w.location || 'Body'} Injured`)
        }
      }

      // Deception detection
      const deception = target.perception_profile.deceptionSkill || 0
      if (deception > 3) tags.push('Hiding Something')

      // Faction
      if (target.faction.memberships.length > 0) {
        const fac = target.faction.memberships[0]
        tags.push(`[${typeof fac === 'string' ? fac : fac.factionId}]`)
      }
    }

    // False tags from high deception NPCs
    if ((target.perception_profile.deceptionSkill || 0) > 6 && confidence < 0.5) {
      // Replace a real tag with a false one
      const falseReplacements = {
        'Scared': 'Calm',
        'Hostile': 'Friendly',
        'Distrusts You': 'Neutral',
        'Hiding Something': null  // remove it
      }
      for (let i = 0; i < tags.length; i++) {
        if (falseReplacements[tags[i]] !== undefined) {
          if (falseReplacements[tags[i]] === null) {
            tags.splice(i, 1)
            i--
          } else {
            tags[i] = falseReplacements[tags[i]]
          }
          break // Only one false tag per check
        }
      }
    }

    return tags
  }
}

export default PerceptionGraph
