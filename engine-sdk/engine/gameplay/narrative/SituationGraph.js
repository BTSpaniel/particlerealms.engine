// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * SituationGraph — Selects life pressure situations for the player.
 *
 * Situation buckets: family, survival, crime, faction, power, exploration,
 * social, build/dig, item soul, law, domain, revenge, redemption.
 *
 * Chooses situations based on player background, family state, location,
 * NPC relationships, faction reputation, active crimes, wealth, danger,
 * resolve path, recent failures/victories.
 */

export const SituationBucket = Object.freeze({
  FAMILY:      'family',
  SURVIVAL:    'survival',
  CRIME:       'crime',
  FACTION:     'faction',
  POWER:       'power',
  EXPLORATION: 'exploration',
  SOCIAL:      'social',
  BUILD_DIG:   'build_dig',
  ITEM_SOUL:   'item_soul',
  LAW:         'law',
  DOMAIN:      'domain',
  REVENGE:     'revenge',
  REDEMPTION:  'redemption'
})

export class SituationGraph {
  /**
   * @param {import('../events/EventGraph.js').EventGraph} eventGraph
   * @param {import('../../core/EntitySystem.js').EntitySystem} entitySystem
   */
  constructor(eventGraph, entitySystem) {
    this._events = eventGraph
    this._entities = entitySystem

    /** @type {string|null} Current active situation bucket */
    this.activeSituation = null

    /** @type {string[]} Recent situations (avoid repetition) */
    this._recent = []
    this.maxRecent = 5
  }

  /**
   * Evaluate which situation bucket should be active based on world state.
   *
   * @param {object} worldState
   * @returns {object} { bucket, score, reason }
   */
  evaluate(worldState) {
    const scores = {}

    // Family pressure
    scores[SituationBucket.FAMILY] = 0
    if (worldState.familyConflict) scores[SituationBucket.FAMILY] += 30
    if (worldState.familyInDanger) scores[SituationBucket.FAMILY] += 40
    if (worldState.resolveSeeds && worldState.resolveSeeds.includes('guardian')) scores[SituationBucket.FAMILY] += 10

    // Survival
    scores[SituationBucket.SURVIVAL] = 0
    scores[SituationBucket.SURVIVAL] += (worldState.playerHunger || 0) * 0.5
    if ((worldState.playerHp || 100) < 30) scores[SituationBucket.SURVIVAL] += 40
    if (worldState.foodShortage) scores[SituationBucket.SURVIVAL] += 25

    // Crime
    scores[SituationBucket.CRIME] = 0
    scores[SituationBucket.CRIME] += (worldState.unresolvedCrimes || 0) * 15
    if (worldState.wanted) scores[SituationBucket.CRIME] += 30

    // Faction
    scores[SituationBucket.FACTION] = 0
    if (worldState.factionAnger) scores[SituationBucket.FACTION] += worldState.factionAnger * 0.4
    if (worldState.factionDemand) scores[SituationBucket.FACTION] += 25

    // Power
    scores[SituationBucket.POWER] = 0
    if (worldState.contractReady) scores[SituationBucket.POWER] += 35
    scores[SituationBucket.POWER] += (worldState.resolveGrowth || 0) * 5

    // Exploration
    scores[SituationBucket.EXPLORATION] = 10 // always some pull
    if (worldState.nearDiscovery) scores[SituationBucket.EXPLORATION] += 25
    if (worldState.newAreaAvailable) scores[SituationBucket.EXPLORATION] += 20

    // Social
    scores[SituationBucket.SOCIAL] = 0
    if (worldState.companionConflict) scores[SituationBucket.SOCIAL] += 25
    if (worldState.npcNeedsHelp) scores[SituationBucket.SOCIAL] += 20

    // Build/Dig
    scores[SituationBucket.BUILD_DIG] = 0
    if (worldState.baseUnderAttack) scores[SituationBucket.BUILD_DIG] += 30
    if (worldState.resourcesNearby) scores[SituationBucket.BUILD_DIG] += 15

    // Item Soul
    scores[SituationBucket.ITEM_SOUL] = 0
    if (worldState.itemResonating) scores[SituationBucket.ITEM_SOUL] += 30

    // Law
    scores[SituationBucket.LAW] = 0
    if (worldState.lawEnforcementNearby) scores[SituationBucket.LAW] += 20
    scores[SituationBucket.LAW] += (worldState.suspicion || 0) * 0.3

    // Domain
    scores[SituationBucket.DOMAIN] = 0
    if (worldState.domainActive) scores[SituationBucket.DOMAIN] += 25
    if (worldState.domainRupture) scores[SituationBucket.DOMAIN] += 35

    // Revenge
    scores[SituationBucket.REVENGE] = 0
    if (worldState.revengeTarget) scores[SituationBucket.REVENGE] += 30

    // Redemption
    scores[SituationBucket.REDEMPTION] = 0
    if (worldState.oppressedNearby) scores[SituationBucket.REDEMPTION] += 25
    if (worldState.resolveSeeds && worldState.resolveSeeds.includes('redeemer')) scores[SituationBucket.REDEMPTION] += 15

    // Penalize recently used
    for (const recent of this._recent) {
      if (scores[recent] !== undefined) scores[recent] *= 0.5
    }

    // Find winner
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1])
    const winner = sorted[0]

    if (winner && winner[1] > 0) {
      this.activeSituation = winner[0]
      this._recent.push(winner[0])
      if (this._recent.length > this.maxRecent) this._recent.shift()

      return {
        bucket: winner[0],
        score: winner[1],
        reason: this._getReason(winner[0], worldState),
        allScores: scores
      }
    }

    return { bucket: SituationBucket.EXPLORATION, score: 10, reason: 'Nothing pressing. Explore.', allScores: scores }
  }

  _getReason(bucket, ws) {
    const reasons = {
      [SituationBucket.FAMILY]: 'Your family needs attention.',
      [SituationBucket.SURVIVAL]: 'Survival is the priority.',
      [SituationBucket.CRIME]: 'Your crimes are catching up.',
      [SituationBucket.FACTION]: 'A faction demands your attention.',
      [SituationBucket.POWER]: 'Your resolve is growing.',
      [SituationBucket.EXPLORATION]: 'The unknown calls.',
      [SituationBucket.SOCIAL]: 'Someone needs you.',
      [SituationBucket.BUILD_DIG]: 'Build or dig to survive.',
      [SituationBucket.ITEM_SOUL]: 'An item resonates with strange energy.',
      [SituationBucket.LAW]: 'The law is watching.',
      [SituationBucket.DOMAIN]: 'Reality bends nearby.',
      [SituationBucket.REVENGE]: 'Unfinished business.',
      [SituationBucket.REDEMPTION]: 'Someone needs to be freed.'
    }
    return reasons[bucket] || 'Something stirs.'
  }

  /** Get current state for debugging */
  getState() {
    return { activeSituation: this.activeSituation, recent: [...this._recent] }
  }
}

export default SituationGraph
