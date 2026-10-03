// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

import { randomElement } from '../../core/math/MathRandom.js'
import { clamp as clampScalar } from '../../core/math/MathScalar.js'

/**
 * WorldDirector — Controls pacing and selects world events.
 *
 * Watches: player stress, supplies, family conflict, recent fights, deaths,
 * victories, crew size, base strength, faction anger, unresolved crimes,
 * resolve growth, domain activity.
 *
 * Selects events to create: pressure → relief → pressure → consequence.
 * Not constant chaos.
 */

export const DirectorEventType = Object.freeze({
  RAID:           'raid',
  FAMINE:         'famine',
  BETRAYAL:       'betrayal',
  ILLNESS:        'illness',
  RESCUE:         'rescue',
  TRADE_OFFER:    'trade_offer',
  FAMILY_CRISIS:  'family_crisis',
  FACTION_DEMAND: 'faction_demand',
  STORM:          'storm',
  DISCOVERY:      'underground_discovery',
  ITEM_AWAKENING: 'item_awakening',
  CONTRACT_TEST:  'contract_test',
  DOMAIN_RUPTURE: 'domain_rupture',
  CALM:           'calm'
})

export class WorldDirector {
  /**
   * @param {import('../events/EventGraph.js').EventGraph} eventGraph
   * @param {import('../../core/EntitySystem.js').EntitySystem} entitySystem
   */
  constructor(eventGraph, entitySystem) {
    this._events = eventGraph
    this._entities = entitySystem

    /** @type {number} Tick counter */
    this._tick = 0

    /** @type {number} Ticks between director checks */
    this.checkInterval = 300 // ~5 seconds at 60fps

    /** @type {string} Current pacing state: pressure or relief */
    this._pacingState = 'relief'

    /** @type {number} Events since last pacing flip */
    this._eventsSincePacingFlip = 0

    /** @type {number} Min events before pacing can flip */
    this._minEventsBeforeFlip = 2

    /** @type {object|null} Last director event */
    this.lastEvent = null

    /** @type {string[]} Recently fired event types (avoid repetition) */
    this._recentTypes = []
  }

  /**
   * Evaluate world state and potentially fire a director event.
   * Call every tick — internally throttles to checkInterval.
   *
   * @param {object} worldState - { playerStress, playerHunger, crewSize, recentFights, recentDeaths, unresolvedCrimes, resolveGrowth }
   * @returns {object|null} Fired event or null
   */
  tick(worldState) {
    this._tick++
    if (this._tick % this.checkInterval !== 0) return null

    // Evaluate tension level
    const tension = this._evaluateTension(worldState)

    // Decide pacing
    this._eventsSincePacingFlip++

    if (this._pacingState === 'relief' && tension < 30 && this._eventsSincePacingFlip >= this._minEventsBeforeFlip) {
      // Time for pressure
      this._pacingState = 'pressure'
      this._eventsSincePacingFlip = 0
    } else if (this._pacingState === 'pressure' && tension > 70 && this._eventsSincePacingFlip >= this._minEventsBeforeFlip) {
      // Time for relief
      this._pacingState = 'relief'
      this._eventsSincePacingFlip = 0
    }

    // Select event based on pacing
    const eventType = this._selectEvent(worldState, tension)
    if (!eventType) return null

    // Don't repeat recent types
    if (this._recentTypes.includes(eventType) && eventType !== DirectorEventType.CALM) {
      return null
    }

    // Fire
    const result = this._fireEvent(eventType, worldState)
    this.lastEvent = result

    this._recentTypes.push(eventType)
    if (this._recentTypes.length > 5) this._recentTypes.shift()

    return result
  }

  /**
   * Get current director state for debugging.
   * @returns {object}
   */
  getState() {
    return {
      tick: this._tick,
      pacingState: this._pacingState,
      eventsSinceFlip: this._eventsSincePacingFlip,
      lastEvent: this.lastEvent,
      recentTypes: [...this._recentTypes]
    }
  }

  // ── Internal ──

  _evaluateTension(ws) {
    let tension = 0
    tension += (ws.playerStress || 0) * 0.3
    tension += (ws.playerHunger || 0) * 0.2
    tension += (ws.recentFights || 0) * 10
    tension += (ws.recentDeaths || 0) * 20
    tension += (ws.unresolvedCrimes || 0) * 8
    tension -= (ws.crewSize || 0) * 5
    tension -= (ws.resolveGrowth || 0) * 3
    return Math.max(0, clampScalar(tension, 0, 100))
  }

  _selectEvent(ws, tension) {
    if (this._pacingState === 'pressure') {
      // High tension events
      const pool = []
      if ((ws.playerHunger || 0) > 60) pool.push(DirectorEventType.FAMINE)
      if ((ws.unresolvedCrimes || 0) > 0) pool.push(DirectorEventType.FACTION_DEMAND)
      if ((ws.recentFights || 0) > 2) pool.push(DirectorEventType.RAID)
      if (Math.random() < 0.2) pool.push(DirectorEventType.BETRAYAL)
      if (Math.random() < 0.15) pool.push(DirectorEventType.ILLNESS)
      if (Math.random() < 0.1) pool.push(DirectorEventType.STORM)

      if (pool.length === 0) pool.push(DirectorEventType.RAID)
      return randomElement(pool, Math.random)
    } else {
      // Relief events
      const pool = []
      pool.push(DirectorEventType.CALM)
      if (Math.random() < 0.3) pool.push(DirectorEventType.TRADE_OFFER)
      if (Math.random() < 0.2) pool.push(DirectorEventType.RESCUE)
      if (Math.random() < 0.15) pool.push(DirectorEventType.DISCOVERY)
      if ((ws.resolveGrowth || 0) > 3) pool.push(DirectorEventType.CONTRACT_TEST)

      return randomElement(pool, Math.random)
    }
  }

  _fireEvent(type, ws) {
    const descriptions = {
      [DirectorEventType.RAID]: 'Raiders have been spotted approaching the area.',
      [DirectorEventType.FAMINE]: 'Food supplies are running dangerously low.',
      [DirectorEventType.BETRAYAL]: 'Someone you trusted has been spreading lies.',
      [DirectorEventType.ILLNESS]: 'A sickness is spreading through the town.',
      [DirectorEventType.RESCUE]: 'A traveler nearby needs help.',
      [DirectorEventType.TRADE_OFFER]: 'A merchant caravan has arrived with goods to trade.',
      [DirectorEventType.FAMILY_CRISIS]: 'Your family needs you. Something has happened.',
      [DirectorEventType.FACTION_DEMAND]: 'A faction representative demands an audience.',
      [DirectorEventType.STORM]: 'Dark clouds gather. A storm is coming.',
      [DirectorEventType.DISCOVERY]: 'You\'ve found an entrance to something underground.',
      [DirectorEventType.ITEM_AWAKENING]: 'One of your items is resonating with strange energy.',
      [DirectorEventType.CONTRACT_TEST]: 'Your resolve is being tested. Stay true to your path.',
      [DirectorEventType.DOMAIN_RUPTURE]: 'The air shimmers. Reality feels thin here.',
      [DirectorEventType.CALM]: 'A moment of peace. The world is quiet.'
    }

    const desc = descriptions[type] || 'Something happens.'

    this._events.emit({
      type: `director.${type}`,
      data: { directorEvent: type, pacingState: this._pacingState },
      tags: ['director', 'world', type],
      description: desc
    })

    return { type, description: desc, pacingState: this._pacingState, tick: this._tick }
  }
}

export default WorldDirector
