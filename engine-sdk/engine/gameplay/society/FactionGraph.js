// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * FactionGraph — Group souls with politics, reputation, and actions.
 *
 * Factions track: leader, values, laws, territory, resources, enemies/allies,
 * fear, morale, population, reputation toward player, domain users, crimes, contracts.
 */

let _nextFactionId = 1

export function createFaction(config) {
  return {
    id: config.id || `faction_${_nextFactionId++}`,
    name: config.name,
    leader: config.leader || null,
    values: config.values || [],
    laws: config.laws || [],
    territory: config.territory || [],
    food: config.food || 50,
    wealth: config.wealth || 50,
    enemies: config.enemies || [],
    allies: config.allies || [],
    fear: config.fear || 0,
    morale: config.morale || 50,
    population: config.population || 0,
    reputation: config.reputation || {},
    domainUsers: config.domainUsers || [],
    crimesAgainst: config.crimesAgainst || [],
    contractsEnforced: config.contractsEnforced || [],
    huntedEntities: config.huntedEntities || [],
    oppressedEntities: config.oppressedEntities || [],
    oppressionEvents: config.oppressionEvents || [],
    rebellionRisk: config.rebellionRisk || 0,
    warScore: config.warScore || 0,
    activeConflicts: config.activeConflicts || [],
    activeSieges: config.activeSieges || [],
    description: config.description || ''
  }
}

export const FactionAction = Object.freeze({
  TRADE:           'trade',
  RAID:            'raid',
  RECRUIT:         'recruit',
  ALLY:            'ally',
  DEMAND_TRIBUTE:  'demand_tribute',
  PUNISH_CRIME:    'punish_crime',
  OFFER_CONTRACT:  'offer_contract',
  DECLARE_WAR:     'declare_war',
  FLEE:            'flee',
  HUNT_DOMAIN:     'hunt_domain_users',
  SUPPORT_REDEEMER:'support_redeemers',
  SUPPRESS_REDEEMER:'suppress_redeemers'
})

export class FactionGraph {
  /**
   * @param {import('../events/EventGraph.js').EventGraph} eventGraph
   */
  constructor(eventGraph) {
    this._events = eventGraph
    /** @type {Map<string, object>} */
    this._factions = new Map()
    /** @type {Map<string, object>} */
    this._conflicts = new Map()
    /** @type {Map<string, object>} */
    this._territories = new Map()
    /** @type {Map<string, object>} */
    this._sieges = new Map()
  }

  /** Register a faction */
  add(faction) {
    const normalized = { ...faction, ...createFaction(faction) }
    this._factions.set(normalized.id, normalized)
    this._registerFactionTerritory(normalized)
    return normalized.id
  }

  /** Get faction by ID */
  get(id) { return this._factions.get(id) || null }

  /** Get all factions */
  getAll() { return [...this._factions.values()] }

  /**
   * Get reputation of an entity with a faction.
   * @param {string} factionId
   * @param {string} entityId
   * @returns {number} -100 to 100
   */
  getReputation(factionId, entityId) {
    const faction = this._factions.get(factionId)
    if (!faction) return 0
    return faction.reputation[entityId] || 0
  }

  /**
   * Modify reputation.
   * @param {string} factionId
   * @param {string} entityId
   * @param {number} delta
   */
  modifyReputation(factionId, entityId, delta) {
    const faction = this._factions.get(factionId)
    if (!faction) return
    faction.reputation[entityId] = Math.max(-100, Math.min(100, (faction.reputation[entityId] || 0) + delta))

    this._events.emit({
      type: 'faction.reputation_changed',
      sender: factionId,
      target: entityId,
      data: { factionId, delta, newValue: faction.reputation[entityId] },
      tags: ['faction', 'reputation'],
      description: `${faction.name} reputation with ${entityId}: ${delta > 0 ? '+' : ''}${delta} → ${faction.reputation[entityId]}`
    })
  }

  /**
   * Record a crime against a faction.
   * @param {string} factionId
   * @param {object} crime - { type, perpetrator, severity, witnesses }
   */
  recordCrime(factionId, crime) {
    const faction = this._factions.get(factionId)
    if (!faction) return
    faction.crimesAgainst.push({ ...crime, timestamp: Date.now() })
    this.modifyReputation(factionId, crime.perpetrator, -crime.severity * 5)
  }

  /**
   * Determine what action a faction would take toward an entity.
   * @param {string} factionId
   * @param {string} entityId
   * @returns {string|null} FactionAction
   */
  decideAction(factionId, entityId) {
    const faction = this._factions.get(factionId)
    if (!faction) return null

    const rep = faction.reputation[entityId] || 0

    if (rep < -60) return FactionAction.DECLARE_WAR
    if (rep < -30) return FactionAction.PUNISH_CRIME
    if (rep < -10) return FactionAction.DEMAND_TRIBUTE
    if (rep > 50) return FactionAction.ALLY
    if (rep > 20) return FactionAction.TRADE
    if (faction.population < 10 && rep > 0) return FactionAction.RECRUIT
    return null
  }

  declareConflict(factionA, factionB, cause = 'political_tension') {
    const a = this._factions.get(factionA)
    const b = this._factions.get(factionB)
    if (!a || !b) return null
    const id = [factionA, factionB].sort().join('_vs_')
    const existing = this._conflicts.get(id)
    if (existing) return existing

    this.setRelationship(factionA, factionB, 'enemy')
    const conflict = {
      id,
      factions: [factionA, factionB],
      cause,
      intensity: 10,
      fronts: [...new Set([...(a.territory || []), ...(b.territory || [])])],
      casualties: 0,
      pressure: { [factionA]: 0, [factionB]: 0 },
      startedAt: Date.now(),
      lastEscalatedAt: Date.now(),
      status: 'active'
    }
    this._conflicts.set(id, conflict)
    this._trackConflictMembership(conflict)

    this._events.emit({
      type: 'faction.conflict_declared',
      sender: factionA,
      target: factionB,
      data: { conflictId: id, cause, factions: conflict.factions },
      tags: ['faction', 'war', 'conflict'],
      description: `${a.name} and ${b.name} entered open conflict over ${cause}.`
    })

    return conflict
  }

  escalateConflict(conflictId, data = {}) {
    const conflict = this._conflicts.get(conflictId)
    if (!conflict || conflict.status !== 'active') return null
    const amount = Math.max(1, Math.abs(data.intensity || 5))
    conflict.intensity = Math.min(100, conflict.intensity + amount)
    conflict.casualties += Math.max(0, data.casualties || Math.floor(amount * 0.5))
    conflict.lastEscalatedAt = Date.now()

    for (const factionId of conflict.factions) {
      const faction = this._factions.get(factionId)
      if (!faction) continue
      const pressureDelta = Math.max(1, Math.floor(amount * 0.4))
      conflict.pressure[factionId] = (conflict.pressure[factionId] || 0) + pressureDelta
      faction.morale = Math.max(0, faction.morale - Math.max(1, Math.floor(amount * 0.1)))
      faction.warScore = Math.max(-100, Math.min(100, (faction.warScore || 0) + (data.advantage === factionId ? amount : -Math.floor(amount * 0.5))))
    }

    const contestedFront = data.front || data.location || conflict.fronts?.[0]
    if (data.advantage && contestedFront) {
      this.contestTerritory(contestedFront, data.advantage, {
        pressure: Math.max(1, Math.floor(amount * 0.8)),
        conflictId,
        source: data.source || 'conflict_escalation'
      })
    }

    this._events.emit({
      type: 'faction.conflict_escalated',
      data: { conflictId, intensity: conflict.intensity, casualties: conflict.casualties, source: data.source || 'unknown' },
      tags: ['faction', 'war', 'conflict'],
      description: `${conflictId} escalated to intensity ${conflict.intensity}.`
    })

    return conflict
  }

  getConflict(conflictId) { return this._conflicts.get(conflictId) || null }

  getConflicts() { return [...this._conflicts.values()] }

  getFactionConflicts(factionId) {
    return this.getConflicts().filter(conflict => conflict.factions.includes(factionId))
  }

  getSiege(siegeId) { return this._sieges.get(siegeId) || null }

  getSieges(filter = {}) {
    let sieges = [...this._sieges.values()]
    if (filter.status) sieges = sieges.filter(siege => siege.status === filter.status)
    if (filter.locationId) sieges = sieges.filter(siege => siege.locationId === filter.locationId)
    if (filter.factionId) sieges = sieges.filter(siege => siege.attackerId === filter.factionId || siege.defenderId === filter.factionId)
    return sieges
  }

  startSiege(locationId, attackerId, defenderId = null, data = {}) {
    const attacker = this._factions.get(attackerId)
    if (!locationId || !attacker) return null
    const territory = this._ensureTerritory(locationId, defenderId || data.defenderId || null)
    const resolvedDefenderId = defenderId || territory.controllerId || territory.ownerId
    const defender = this._factions.get(resolvedDefenderId)
    if (!defender || attackerId === resolvedDefenderId) return null

    const id = data.id || `${locationId}_${attackerId}_siege`
    const existing = this._sieges.get(id)
    if (existing && existing.status === 'active') return existing

    const conflict = data.conflictId
      ? this._conflicts.get(data.conflictId)
      : this.declareConflict(attackerId, resolvedDefenderId, data.cause || 'siege')
    const siege = {
      id,
      locationId,
      attackerId,
      defenderId: resolvedDefenderId,
      conflictId: conflict?.id || data.conflictId || null,
      status: 'active',
      progress: Math.max(0, Math.min(100, data.progress || 0)),
      pressure: Math.max(0, Math.min(100, data.pressure || 0)),
      fortification: Math.max(0, Math.min(100, data.fortification ?? territory.stability ?? 100)),
      supply: Math.max(0, Math.min(100, data.supply ?? 100)),
      casualties: Math.max(0, data.casualties || 0),
      startedAt: Date.now(),
      lastAdvancedAt: Date.now()
    }
    this._sieges.set(id, siege)
    this._trackSiegeMembership(siege)
    territory.siegeId = id
    territory.conflictId = siege.conflictId || territory.conflictId
    territory.contestedBy = [...new Set([...(territory.contestedBy || []), attackerId])]

    this._events.emit({
      type: 'faction.siege_started',
      sender: attackerId,
      target: resolvedDefenderId,
      location: locationId,
      data: { siegeId: id, locationId, attackerId, defenderId: resolvedDefenderId, conflictId: siege.conflictId, fortification: siege.fortification, supply: siege.supply },
      tags: ['faction', 'war', 'siege', 'territory'],
      description: `${attacker.name} began a siege of ${locationId}.`
    })

    return siege
  }

  progressSiege(siegeId, data = {}) {
    const siege = this._sieges.get(siegeId)
    if (!siege || siege.status !== 'active') return null
    const attacker = this._factions.get(siege.attackerId)
    const defender = this._factions.get(siege.defenderId)
    const territory = this._ensureTerritory(siege.locationId, siege.defenderId)
    if (!attacker || !defender) return null

    const assault = Math.max(0, data.assault ?? data.pressure ?? 10)
    const blockade = Math.max(0, data.blockade ?? Math.floor(assault * 0.5))
    const relief = Math.max(0, data.relief || 0)
    const pressureDelta = Math.max(0, assault + Math.floor(blockade * 0.5) - relief)
    const fortificationDamage = Math.max(0, Math.floor(pressureDelta * 0.45))
    const supplyDamage = Math.max(0, Math.floor(blockade * 0.6) + Math.floor(assault * 0.15))
    const progressDelta = Math.max(1, Math.floor(pressureDelta * 0.6) + (siege.supply <= 25 ? 8 : 0) + (siege.fortification <= 25 ? 8 : 0))

    siege.pressure = Math.max(0, Math.min(100, siege.pressure + pressureDelta))
    siege.fortification = Math.max(0, siege.fortification - fortificationDamage)
    siege.supply = Math.max(0, siege.supply - supplyDamage)
    siege.progress = Math.max(0, Math.min(100, siege.progress + progressDelta))
    siege.casualties += Math.max(0, data.casualties ?? Math.floor(pressureDelta * 0.4))
    siege.lastAdvancedAt = Date.now()
    territory.stability = Math.max(0, Math.min(100, siege.fortification))
    territory.siegeId = siege.id
    territory.conflictId = siege.conflictId || territory.conflictId
    defender.food = Math.max(0, (defender.food || 0) - Math.max(1, Math.floor(supplyDamage * 0.2)))
    defender.morale = Math.max(0, (defender.morale || 0) - Math.max(1, Math.floor(progressDelta * 0.15)))
    attacker.morale = Math.max(0, (attacker.morale || 0) - Math.max(0, Math.floor((siege.casualties || 0) * 0.02)))

    this._events.emit({
      type: 'faction.siege_progressed',
      sender: siege.attackerId,
      target: siege.defenderId,
      location: siege.locationId,
      data: { siegeId, locationId: siege.locationId, progress: siege.progress, pressure: siege.pressure, fortification: siege.fortification, supply: siege.supply, casualties: siege.casualties, source: data.source || 'siege_progress' },
      tags: ['faction', 'war', 'siege', 'territory'],
      description: `${siege.locationId} siege advanced to ${siege.progress}.`
    })

    if (siege.progress >= 100 || siege.fortification <= 0 || siege.supply <= 0) {
      return this._resolveSiegeCapture(siege, data.source || 'siege_breakthrough')
    }

    return siege
  }

  liftSiege(siegeId, data = {}) {
    const siege = this._sieges.get(siegeId)
    if (!siege || siege.status !== 'active') return null
    siege.status = 'lifted'
    siege.endedAt = Date.now()
    const territory = this._territories.get(siege.locationId)
    if (territory?.siegeId === siegeId) territory.siegeId = null
    this._untrackSiegeMembership(siege)

    this._events.emit({
      type: 'faction.siege_lifted',
      sender: siege.defenderId,
      target: siege.attackerId,
      location: siege.locationId,
      data: { siegeId, locationId: siege.locationId, attackerId: siege.attackerId, defenderId: siege.defenderId, source: data.source || 'siege_lifted' },
      tags: ['faction', 'war', 'siege', 'territory'],
      description: `${siege.locationId} siege was lifted.`
    })

    return siege
  }

  getTerritory(locationId) { return this._territories.get(locationId) || null }

  getTerritories() { return [...this._territories.values()] }

  getControlledTerritories(factionId) {
    return this.getTerritories().filter(territory => territory.controllerId === factionId)
  }

  contestTerritory(locationId, claimantId, data = {}) {
    const claimant = this._factions.get(claimantId)
    if (!locationId || !claimant) return null
    const territory = this._ensureTerritory(locationId, data.ownerId || data.defenderId || null)
    const pressure = Math.max(1, Math.abs(data.pressure || data.amount || 10))
    territory.claimants[claimantId] = Math.min(100, (territory.claimants[claimantId] || 0) + pressure)
    territory.stability = Math.max(0, territory.stability - Math.max(1, Math.floor(pressure * 0.5)))
    territory.contestedBy = Object.keys(territory.claimants)
      .filter(id => id !== territory.controllerId && territory.claimants[id] > 0)
    if (data.conflictId) territory.conflictId = data.conflictId

    this._events.emit({
      type: 'faction.territory_contested',
      sender: claimantId,
      target: territory.controllerId,
      data: {
        locationId,
        claimantId,
        controllerId: territory.controllerId,
        conflictId: territory.conflictId,
        pressure: territory.claimants[claimantId],
        stability: territory.stability
      },
      tags: ['faction', 'territory', 'war'],
      description: `${claimant.name} pressed control over ${locationId}.`
    })

    const controlThreshold = data.controlThreshold ?? 60
    if (territory.controllerId !== claimantId && territory.claimants[claimantId] >= controlThreshold && territory.stability <= 40) {
      return this.transferTerritory(locationId, claimantId, { conflictId: territory.conflictId, source: data.source || 'territory_contest' })
    }

    return territory
  }

  transferTerritory(locationId, controllerId, data = {}) {
    const controller = this._factions.get(controllerId)
    if (!locationId || !controller) return null
    const territory = this._ensureTerritory(locationId, data.ownerId || controllerId)
    const previousController = territory.controllerId
    if (previousController === controllerId) return territory

    territory.controllerId = controllerId
    territory.claimants[controllerId] = 100
    territory.stability = Math.max(45, Math.min(100, data.stability ?? territory.stability + 20))
    territory.contestedBy = territory.contestedBy.filter(id => id !== controllerId)
    if (data.conflictId) territory.conflictId = data.conflictId
    territory.lastChangedAt = Date.now()
    this._syncFactionTerritory(locationId, previousController, controllerId)

    this._events.emit({
      type: 'faction.territory_control_changed',
      sender: controllerId,
      target: previousController,
      data: {
        locationId,
        previousController,
        controllerId,
        ownerId: territory.ownerId,
        conflictId: territory.conflictId,
        source: data.source || 'territory_transfer'
      },
      tags: ['faction', 'territory', 'war', 'control'],
      description: `${controller.name} took control of ${locationId}.`
    })

    return territory
  }

  _trackConflictMembership(conflict) {
    for (const factionId of conflict.factions) {
      const faction = this._factions.get(factionId)
      if (!faction) continue
      if (!faction.activeConflicts.includes(conflict.id)) faction.activeConflicts.push(conflict.id)
    }
  }

  _trackSiegeMembership(siege) {
    for (const factionId of [siege.attackerId, siege.defenderId]) {
      const faction = this._factions.get(factionId)
      if (!faction) continue
      faction.activeSieges = faction.activeSieges || []
      if (!faction.activeSieges.includes(siege.id)) faction.activeSieges.push(siege.id)
    }
  }

  _untrackSiegeMembership(siege) {
    for (const factionId of [siege.attackerId, siege.defenderId]) {
      const faction = this._factions.get(factionId)
      if (!faction?.activeSieges) continue
      faction.activeSieges = faction.activeSieges.filter(id => id !== siege.id)
    }
  }

  _resolveSiegeCapture(siege, source = 'siege_breakthrough') {
    if (!siege || siege.status !== 'active') return siege || null
    siege.status = 'captured'
    siege.progress = 100
    siege.endedAt = Date.now()
    this._untrackSiegeMembership(siege)
    const territory = this.transferTerritory(siege.locationId, siege.attackerId, {
      conflictId: siege.conflictId,
      source,
      stability: Math.max(20, siege.fortification)
    })
    if (territory) {
      territory.siegeId = null
      territory.stability = Math.max(20, territory.stability)
      territory.contestedBy = territory.contestedBy.filter(id => id !== siege.attackerId)
    }

    this._events.emit({
      type: 'faction.siege_resolved',
      sender: siege.attackerId,
      target: siege.defenderId,
      location: siege.locationId,
      data: { siegeId: siege.id, locationId: siege.locationId, attackerId: siege.attackerId, defenderId: siege.defenderId, status: siege.status, conflictId: siege.conflictId, source },
      tags: ['faction', 'war', 'siege', 'territory'],
      description: `${siege.attackerId} captured ${siege.locationId} after a siege.`
    })

    return siege
  }

  _registerFactionTerritory(faction) {
    for (const locationId of faction.territory || []) {
      const existing = this._territories.get(locationId)
      if (existing) {
        if (!existing.ownerId) existing.ownerId = faction.id
        if (!existing.controllerId) existing.controllerId = faction.id
        existing.claimants[faction.id] = Math.max(existing.claimants[faction.id] || 0, existing.controllerId === faction.id ? 100 : 0)
        continue
      }
      this._territories.set(locationId, {
        id: locationId,
        ownerId: faction.id,
        controllerId: faction.id,
        claimants: { [faction.id]: 100 },
        stability: 100,
        contestedBy: [],
        conflictId: null,
        lastChangedAt: Date.now()
      })
    }
  }

  _ensureTerritory(locationId, ownerId = null) {
    const existing = this._territories.get(locationId)
    if (existing) return existing
    const owner = ownerId && this._factions.has(ownerId) ? ownerId : null
    const territory = {
      id: locationId,
      ownerId: owner,
      controllerId: owner,
      claimants: owner ? { [owner]: 100 } : {},
      stability: 100,
      contestedBy: [],
      conflictId: null,
      lastChangedAt: Date.now()
    }
    this._territories.set(locationId, territory)
    if (owner) {
      const faction = this._factions.get(owner)
      if (faction && !faction.territory.includes(locationId)) faction.territory.push(locationId)
    }
    return territory
  }

  _syncFactionTerritory(locationId, previousController, nextController) {
    const previous = this._factions.get(previousController)
    if (previous) previous.territory = previous.territory.filter(id => id !== locationId)
    const next = this._factions.get(nextController)
    if (next && !next.territory.includes(locationId)) next.territory.push(locationId)
  }

  /**
   * Get relationship between two factions.
   * @param {string} factionA
   * @param {string} factionB
   * @returns {string} 'ally', 'enemy', 'neutral', 'vassal'
   */
  getRelationship(factionA, factionB) {
    const a = this._factions.get(factionA)
    if (!a) return 'neutral'
    if (a.allies.includes(factionB)) return 'ally'
    if (a.enemies.includes(factionB)) return 'enemy'
    return 'neutral'
  }

  /**
   * Set relationship between two factions.
   * @param {string} factionA
   * @param {string} factionB
   * @param {'ally'|'enemy'|'neutral'} rel
   */
  setRelationship(factionA, factionB, rel) {
    const a = this._factions.get(factionA)
    const b = this._factions.get(factionB)
    if (!a || !b) return

    // Clean old
    a.allies = a.allies.filter(x => x !== factionB)
    a.enemies = a.enemies.filter(x => x !== factionB)
    b.allies = b.allies.filter(x => x !== factionA)
    b.enemies = b.enemies.filter(x => x !== factionA)

    if (rel === 'ally') { a.allies.push(factionB); b.allies.push(factionA) }
    if (rel === 'enemy') { a.enemies.push(factionB); b.enemies.push(factionA) }

    this._events.emit({
      type: 'faction.relationship_changed',
      data: { factionA, factionB, relationship: rel },
      tags: ['faction'],
      description: `${a.name} and ${b.name} are now ${rel}.`
    })
  }

  /** Get count */
  get size() { return this._factions.size }

  /** Clear */
  clear() {
    this._factions.clear()
    this._conflicts.clear()
    this._territories.clear()
    this._sieges.clear()
  }
}

export default FactionGraph
