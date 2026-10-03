// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * LawGraph — Crime, witnesses, punishment, and justice.
 *
 * Different cities and factions have different laws.
 * Tracks: witnesses, evidence, suspicion, reputation.
 * Punishment: bounty, exile, prison, revenge, retaliation.
 */

import { createRule, RuleCategory, RuleEffect } from '../rules/index.js'

let _nextCrimeId = 1

export const CrimeType = Object.freeze({
  THEFT:      'theft',
  ASSAULT:    'assault',
  MURDER:     'murder',
  TRESPASS:   'trespass',
  VANDALISM:  'vandalism',
  FRAUD:      'fraud',
  DOMAIN_USE: 'domain_use'
})

export const PunishmentType = Object.freeze({
  FINE:        'fine',
  BOUNTY:      'bounty',
  EXILE:       'exile',
  PRISON:      'prison',
  REVENGE:     'revenge',
  RETALIATION: 'retaliation'
})

export function createCrimeRecord(config) {
  return {
    id: _nextCrimeId++,
    type: config.type,
    perpetrator: config.perpetrator,
    victim: config.victim || null,
    location: config.location || null,
    witnesses: config.witnesses || [],
    evidence: config.evidence || 0.5,
    suspicion: config.suspicion || {},
    timestamp: Date.now(),
    resolved: false,
    punishment: null
  }
}

export class LawGraph {
  /**
   * @param {import('../rules/index.js').RuleGraph} ruleGraph
   * @param {import('../events/index.js').EventGraph} eventGraph
   * @param {import('./FactionGraph.js').FactionGraph} factionGraph
   */
  constructor(ruleGraph, eventGraph, factionGraph) {
    this._rules = ruleGraph
    this._events = eventGraph
    this._factions = factionGraph

    /** @type {object[]} All crime records */
    this._crimes = []

    /** @type {Map<string, object>} Law sets by location/faction ID */
    this._lawSets = new Map()

    /** @type {Map<string, number>} Suspicion: "entityId:crimeType" → level (0-100) */
    this._suspicion = new Map()
  }

  /**
   * Define laws for a location or faction.
   *
   * @param {string} id - Location or faction ID
   * @param {object} laws - { crimeType: { severity, punishment, enforced } }
   */
  defineLaws(id, laws) {
    this._lawSets.set(id, laws)

    // Register denial rules in RuleGraph for each enforced crime
    for (const [crimeType, law] of Object.entries(laws)) {
      if (!law.enforced) continue

      this._rules.addRule(createRule({
        name: `law_${id}_${crimeType}`,
        category: RuleCategory.LAW_FACTION,
        source: id,
        effect: RuleEffect.DENY,
        condition: (action) => action.type === crimeType,
        tags: ['law', 'crime', crimeType],
        description: `${id} law: ${crimeType} is punishable (severity: ${law.severity}).`,
        specificity: law.severity
      }))
    }
  }

  /**
   * Report a crime. Creates a record, notifies witnesses, adjusts suspicion.
   *
   * @param {object} config - { type, perpetrator, victim, location, witnesses }
   * @returns {object} Crime record
   */
  reportCrime(config) {
    const crime = createCrimeRecord(config)
    this._crimes.push(crime)

    // Raise suspicion
    const key = `${crime.perpetrator}:${crime.type}`
    this._suspicion.set(key, Math.min(100, (this._suspicion.get(key) || 0) + 30 * crime.evidence))

    // General suspicion on perpetrator
    const genKey = `${crime.perpetrator}:general`
    this._suspicion.set(genKey, Math.min(100, (this._suspicion.get(genKey) || 0) + 15))

    // Determine punishment from location laws
    const laws = this._lawSets.get(crime.location)
    if (laws && laws[crime.type]) {
      crime.punishment = laws[crime.type].punishment
    }

    // Notify faction if victim belongs to one
    if (this._factions && crime.victim) {
      for (const faction of this._factions.getAll()) {
        // Check if victim is in faction territory or faction population
        if (faction.territory.includes(crime.location)) {
          this._factions.recordCrime(faction.id, {
            type: crime.type,
            perpetrator: crime.perpetrator,
            severity: crime.evidence * 5,
            witnesses: crime.witnesses
          })
        }
      }
    }

    this._events.emit({
      type: 'crime.reported',
      sender: crime.witnesses[0] || 'system',
      target: crime.perpetrator,
      data: {
        crimeId: crime.id,
        crimeType: crime.type,
        victim: crime.victim,
        witnesses: crime.witnesses.length,
        evidence: crime.evidence,
        punishment: crime.punishment
      },
      location: crime.location,
      witnesses: crime.witnesses,
      tags: ['crime', 'law', crime.type],
      description: `Crime reported: ${crime.type} by ${crime.perpetrator}${crime.victim ? ' against ' + crime.victim : ''}`
    })

    return crime
  }

  /**
   * Check suspicion level for an entity.
   * @param {string} entityId
   * @param {string} [crimeType] - Specific crime, or 'general'
   * @returns {number} 0-100
   */
  getSuspicion(entityId, crimeType) {
    const key = `${entityId}:${crimeType || 'general'}`
    return this._suspicion.get(key) || 0
  }

  /**
   * Check if an entity is wanted (suspicion > threshold).
   * @param {string} entityId
   * @returns {boolean}
   */
  isWanted(entityId) {
    return this.getSuspicion(entityId, 'general') > 50
  }

  /**
   * Get all unresolved crimes by a perpetrator.
   * @param {string} entityId
   * @returns {object[]}
   */
  getCrimesBy(entityId) {
    return this._crimes.filter(c => c.perpetrator === entityId && !c.resolved)
  }

  /**
   * Get all unresolved crimes at a location.
   * @param {string} location
   * @returns {object[]}
   */
  getCrimesAt(location) {
    return this._crimes.filter(c => c.location === location && !c.resolved)
  }

  /**
   * Resolve a crime (punished, forgiven, etc.).
   * @param {number} crimeId
   * @param {string} resolution
   */
  resolveCrime(crimeId, resolution) {
    const crime = this._crimes.find(c => c.id === crimeId)
    if (!crime) return
    crime.resolved = true

    // Reduce suspicion
    const key = `${crime.perpetrator}:${crime.type}`
    this._suspicion.set(key, Math.max(0, (this._suspicion.get(key) || 0) - 40))

    this._events.emit({
      type: 'crime.resolved',
      target: crime.perpetrator,
      data: { crimeId, resolution },
      tags: ['crime', 'law'],
      description: `Crime #${crimeId} resolved: ${resolution}`
    })
  }

  /**
   * Decay suspicion over time. Call periodically.
   * @param {number} [rate=1]
   */
  decaySuspicion(rate) {
    const r = rate || 1
    for (const [key, value] of this._suspicion) {
      const newVal = Math.max(0, value - r)
      if (newVal <= 0) this._suspicion.delete(key)
      else this._suspicion.set(key, newVal)
    }
  }

  /** Get total crime count */
  get crimeCount() { return this._crimes.length }

  /** Get unresolved count */
  get unresolvedCount() { return this._crimes.filter(c => !c.resolved).length }

  /** Clear */
  clear() {
    this._crimes = []
    this._lawSets.clear()
    this._suspicion.clear()
  }
}

export default LawGraph
